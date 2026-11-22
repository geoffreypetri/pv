// Règles métier : lignes, statuts, écarts, import (doublons, correspondance), export.
// Module pur : testable sous Node (voir tests/model.test.js).

import { STATUTS, STATUT_LABELS, CYCLE, IMPORT_FIELDS, normalizeLine } from './schema.js';
import { round2, parseAmount, normalizeKey, safeFilePart } from './format.js';

const nowIso = () => new Date().toISOString();
const newId = () => globalThis.crypto.randomUUID();

/* ---------- Lignes ---------- */

export function createLine(fields, { mois, importId = null, source = {} } = {}) {
  const now = nowIso();
  return normalizeLine({
    id: newId(),
    mois,
    collaborateur: String(fields.collaborateur ?? '').trim(),
    fournisseur: String(fields.fournisseur ?? '').trim(),
    commande: String(fields.commande ?? '').trim(),
    poste: String(fields.poste ?? '').trim(),
    montantAttendu: fields.montantAttendu ?? null,
    statut: STATUTS.ATTENDU,
    historique: [{ date: now, statut: STATUTS.ATTENDU, detail: importId ? 'Import' : 'Création manuelle' }],
    importId,
    source,
    creeLe: now,
    modifieLe: now,
  });
}

/** Écart = montant PV − montant attendu (null si l'un des deux manque). */
export function computeEcart(line) {
  if (line.montantPV === null || line.montantPV === undefined) return null;
  if (line.montantAttendu === null || line.montantAttendu === undefined) return null;
  return round2(line.montantPV - line.montantAttendu);
}

export function hasEcart(line, tolerance = 0) {
  const e = computeEcart(line);
  return e !== null && Math.abs(e) > tolerance + 1e-9;
}

function touch(line) {
  line.modifieLe = nowIso();
}

function pushStatus(line, statut, detail = '') {
  line.statut = statut;
  const entry = { date: nowIso(), statut };
  if (detail) entry.detail = detail;
  line.historique.push(entry);
  touch(line);
}

/** Dépôt (ou remplacement) d'un PV : enregistre le fichier et le montant, passe à « PV reçu ». */
export function applyPV(line, { fichierPV, montantPV, commentaire }) {
  if (![STATUTS.ATTENDU, STATUTS.PV_RECU, STATUTS.LITIGE].includes(line.statut)) {
    throw new Error(`Impossible de déposer un PV sur une ligne au statut « ${STATUT_LABELS[line.statut]} ».`);
  }
  const m = parseAmount(montantPV);
  if (m === null || Number.isNaN(m)) throw new Error('Montant du PV invalide.');
  const replacing = !!line.fichierPV;
  line.fichierPV = fichierPV;
  line.montantPV = m;
  if (commentaire !== undefined) line.commentaire = commentaire;
  if (line.statut === STATUTS.LITIGE) {
    pushStatus(line, STATUTS.LITIGE, replacing ? 'PV remplacé' : 'PV déposé');
  } else {
    pushStatus(line, STATUTS.PV_RECU, replacing ? 'PV remplacé' : '');
  }
}

export function validate(line) {
  if (line.statut !== STATUTS.PV_RECU) throw new Error('Seule une ligne « PV reçu » peut être validée.');
  if (line.montantPV === null) throw new Error('Montant du PV manquant.');
  pushStatus(line, STATUTS.VALIDE);
}

export function setBR(line, { numeroBR, dateBR }) {
  if (line.statut !== STATUTS.VALIDE) throw new Error('Le BR ne peut être saisi que sur une ligne « Validé ».');
  const num = String(numeroBR ?? '').trim();
  if (!num) throw new Error('Numéro de BR obligatoire.');
  line.numeroBR = num;
  line.dateBR = dateBR || new Date().toISOString().slice(0, 10);
  pushStatus(line, STATUTS.BR_CREE, `BR ${num}`);
}

export function setLitige(line, motif = '') {
  if (line.statut === STATUTS.LITIGE) return;
  pushStatus(line, STATUTS.LITIGE, motif);
}

/** Statut à retrouver en sortie de litige : le dernier statut non-litige de l'historique. */
export function statutAvantLitige(line) {
  for (let i = line.historique.length - 1; i >= 0; i--) {
    const s = line.historique[i].statut;
    if (s !== STATUTS.LITIGE) return s;
  }
  return line.fichierPV ? STATUTS.PV_RECU : STATUTS.ATTENDU;
}

export function leverLitige(line) {
  if (line.statut !== STATUTS.LITIGE) return;
  let s = statutAvantLitige(line);
  // Si un PV a été déposé pendant le litige, on reprend au moins à « PV reçu ».
  if (s === STATUTS.ATTENDU && line.fichierPV) s = STATUTS.PV_RECU;
  pushStatus(line, s, 'Litige levé');
}

/** Statut précédent dans le cycle (pour corriger une erreur), ou null. */
export function previousStatus(line) {
  const i = CYCLE.indexOf(line.statut);
  if (i <= 1) return null; // pas de retour depuis « Attendu » / « PV reçu » (remplacer le PV à la place)
  return CYCLE[i - 1];
}

export function revertStatus(line) {
  const prev = previousStatus(line);
  if (!prev) throw new Error('Aucune étape précédente.');
  if (line.statut === STATUTS.BR_CREE) {
    line.numeroBR = '';
    line.dateBR = '';
  }
  pushStatus(line, prev, 'Retour à l\'étape précédente');
}

/* ---------- Tableau de bord ---------- */

export function linesForMonth(lines, mois) {
  return lines.filter((l) => l.mois === mois);
}

export function countByStatus(lines) {
  const counts = { attendu: 0, pv_recu: 0, valide: 0, br_cree: 0, litige: 0, total: lines.length };
  for (const l of lines) counts[l.statut] = (counts[l.statut] || 0) + 1;
  return counts;
}

export function totals(lines) {
  let attendu = 0, pv = 0;
  for (const l of lines) {
    attendu += l.montantAttendu || 0;
    pv += l.montantPV || 0;
  }
  return { attendu: round2(attendu), pv: round2(pv) };
}

/** File « à faire » : ce qui reste à traiter pour chaque étape. */
export const TODO_GROUPS = Object.freeze([
  { key: 'manquants', label: 'PV manquants', statut: STATUTS.ATTENDU },
  { key: 'aValider', label: 'À valider', statut: STATUTS.PV_RECU },
  { key: 'brACreer', label: 'BR à créer', statut: STATUTS.VALIDE },
  { key: 'litiges', label: 'Litiges', statut: STATUTS.LITIGE },
]);

export function filterLines(lines, { q = '', fournisseur = '', statut = '' } = {}) {
  const needle = normalizeKey(q);
  return lines.filter((l) => {
    if (fournisseur && l.fournisseur !== fournisseur) return false;
    if (statut && l.statut !== statut) return false;
    if (needle) {
      const hay = normalizeKey([l.collaborateur, l.fournisseur, l.commande, l.poste, l.numeroBR, l.commentaire].join(' '));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

const STATUT_ORDER = { litige: 0, pv_recu: 1, valide: 2, attendu: 3, br_cree: 4 };

export function sortLines(lines) {
  return [...lines].sort((a, b) =>
    (STATUT_ORDER[a.statut] - STATUT_ORDER[b.statut]) ||
    a.fournisseur.localeCompare(b.fournisseur, 'fr') ||
    a.collaborateur.localeCompare(b.collaborateur, 'fr'));
}

export function monthsInData(lines) {
  return [...new Set(lines.map((l) => l.mois))].sort().reverse();
}

/* ---------- PV : nom de fichier ---------- */

/** « AAAA-MM_Fournisseur_Collaborateur.pdf » (caractères sûrs). */
export function pvFileName(line, suffix = '') {
  return `${line.mois}_${safeFilePart(line.fournisseur)}_${safeFilePart(line.collaborateur)}${suffix}.pdf`;
}

/** Chemin relatif au dossier de travail. */
export function pvPath(line, suffix = '') {
  return `PV/${line.mois}/${pvFileName(line, suffix)}`;
}

/* ---------- Import ---------- */

const SYNONYMS = {
  collaborateur: ['collaborateur', 'ressource', 'nom ressource', 'consultant', 'intervenant', 'prestataire', 'nom', 'agent'],
  fournisseur: ['fournisseur', 'societe', 'raison sociale', 'prestataire societe', 'vendor', 'supplier', 'titulaire'],
  commande: ['commande', 'n commande', 'no commande', 'numero commande', 'num commande', 'bon de commande', 'bdc', 'po', 'purchase order', 'ref commande'],
  poste: ['poste', 'poste commande', 'poste de commande', 'item', 'ligne commande', 'position'],
  montantAttendu: ['montant', 'montant attendu', 'montant mensuel', 'montant ht', 'montant prevu', 'cout', 'cout mensuel', 'amount', 'total ht'],
};

const cleanHeader = (h) => normalizeKey(h).replace(/[°º#.:_\-/()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Propose une correspondance champ → en-tête à partir des noms de colonnes. */
export function guessMapping(headers, saved = {}) {
  const mapping = {};
  const used = new Set();
  for (const f of IMPORT_FIELDS) {
    if (saved[f.key] && headers.includes(saved[f.key])) {
      mapping[f.key] = saved[f.key];
      used.add(saved[f.key]);
    }
  }
  for (const f of IMPORT_FIELDS) {
    if (mapping[f.key]) continue;
    const syn = SYNONYMS[f.key];
    let best = null, bestScore = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const c = cleanHeader(h);
      let score = 0;
      for (const s of syn) {
        if (c === s) score = Math.max(score, 3);
        else if (c.startsWith(s + ' ') || c.endsWith(' ' + s)) score = Math.max(score, 2);
        else if (c.includes(s) && s.length > 3) score = Math.max(score, 1);
      }
      if (score > bestScore) { best = h; bestScore = score; }
    }
    if (best) { mapping[f.key] = best; used.add(best); }
  }
  return mapping;
}

/**
 * Applique la correspondance aux lignes brutes (objets { en-tête: valeur }).
 * @returns {{ valid: Array<{fields, source, rowNumber}>, invalid: Array<{rowNumber, errors}> }}
 */
export function mapRows(rows, mapping, { firstRowNumber = 2 } = {}) {
  const valid = [], invalid = [];
  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
  rows.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    const values = Object.values(row).map((v) => String(v ?? '').trim());
    if (values.every((v) => v === '')) return; // ligne vide : ignorée silencieusement
    const fields = {}, errors = [];
    for (const f of IMPORT_FIELDS) {
      const h = mapping[f.key];
      const raw = h ? row[h] : '';
      if (f.key === 'montantAttendu') {
        const m = parseAmount(raw);
        if (m === null) errors.push('montant attendu vide');
        else if (Number.isNaN(m)) errors.push(`montant illisible « ${raw} »`);
        fields[f.key] = Number.isNaN(m) ? null : m;
      } else {
        fields[f.key] = String(raw ?? '').trim();
        if (f.required && !fields[f.key]) errors.push(`${f.label.toLowerCase()} vide`);
      }
    }
    const source = {};
    for (const [k, v] of Object.entries(row)) if (!mappedHeaders.has(k) && v !== '' && v !== null) source[k] = v;
    if (errors.length) invalid.push({ rowNumber, errors, fields });
    else valid.push({ fields, source, rowNumber });
  });
  return { valid, invalid };
}

/** Clé de doublon : collaborateur + commande + mois. */
export function duplicateKey({ collaborateur, commande }, mois) {
  return `${mois}|${normalizeKey(collaborateur)}|${normalizeKey(commande)}`;
}

/**
 * Compare les lignes importées aux lignes existantes du mois.
 * @returns {{ nouvelles, doublons: Array<{incoming, existing, changes}> }}
 */
export function planImport(existingLines, validRows, mois) {
  const index = new Map();
  for (const l of existingLines) if (l.mois === mois) index.set(duplicateKey(l, mois), l);
  const seen = new Set();
  const nouvelles = [], doublons = [];
  for (const r of validRows) {
    const key = duplicateKey(r.fields, mois);
    const existing = index.get(key);
    if (existing) {
      doublons.push({ incoming: r, existing, changes: diffImportFields(existing, r.fields) });
    } else if (seen.has(key)) {
      // Doublon à l'intérieur du fichier importé : on garde la première occurrence.
      doublons.push({ incoming: r, existing: null, changes: [], inFile: true });
    } else {
      seen.add(key);
      nouvelles.push(r);
    }
  }
  return { nouvelles, doublons };
}

function diffImportFields(existing, fields) {
  const changes = [];
  for (const k of ['fournisseur', 'poste', 'montantAttendu']) {
    const a = existing[k] ?? '', b = fields[k] ?? '';
    if (k === 'montantAttendu' ? round2(a || 0) !== round2(b || 0) : String(a) !== String(b)) {
      changes.push({ champ: k, avant: existing[k], apres: fields[k] });
    }
  }
  return changes;
}

/** Met à jour une ligne existante depuis l'import (sans toucher au statut, au PV ni au BR). */
export function updateFromImport(line, fields, importId) {
  line.fournisseur = fields.fournisseur || line.fournisseur;
  line.poste = fields.poste ?? line.poste;
  line.montantAttendu = fields.montantAttendu;
  line.importId = importId;
  line.historique.push({ date: nowIso(), statut: line.statut, detail: 'Mise à jour par import' });
  touch(line);
}

/* ---------- Export ---------- */

export const EXPORT_COLUMNS = Object.freeze([
  { key: 'mois', label: 'Mois' },
  { key: 'collaborateur', label: 'Collaborateur' },
  { key: 'fournisseur', label: 'Fournisseur' },
  { key: 'commande', label: 'N° commande' },
  { key: 'poste', label: 'Poste' },
  { key: 'montantAttendu', label: 'Montant attendu', type: 'euro' },
  { key: 'montantPV', label: 'Montant PV', type: 'euro' },
  { key: 'ecart', label: 'Écart', type: 'euro' },
  { key: 'statut', label: 'Statut' },
  { key: 'numeroBR', label: 'N° BR' },
  { key: 'dateBR', label: 'Date BR', type: 'date' },
  { key: 'datePV', label: 'PV reçu le', type: 'date' },
  { key: 'dateValidation', label: 'Validé le', type: 'date' },
  { key: 'fichierPV', label: 'Fichier PV' },
  { key: 'commentaire', label: 'Commentaire' },
]);

function lastDateOf(line, statut) {
  for (let i = line.historique.length - 1; i >= 0; i--) {
    if (line.historique[i].statut === statut) return line.historique[i].date;
  }
  return '';
}

/** Lignes prêtes pour l'export (valeurs brutes : nombres, dates ISO, libellés). */
export function exportRows(lines) {
  return sortLines(lines).map((l) => ({
    mois: l.mois,
    collaborateur: l.collaborateur,
    fournisseur: l.fournisseur,
    commande: l.commande,
    poste: l.poste,
    montantAttendu: l.montantAttendu,
    montantPV: l.montantPV,
    ecart: computeEcart(l),
    statut: STATUT_LABELS[l.statut] || l.statut,
    numeroBR: l.numeroBR,
    dateBR: l.dateBR,
    datePV: lastDateOf(l, STATUTS.PV_RECU),
    dateValidation: lastDateOf(l, STATUTS.VALIDE),
    fichierPV: l.fichierPV,
    commentaire: l.commentaire,
  }));
}

/** Remplit un modèle d'URL SAP : « …?po={commande} » → « …?po=4500001234 ». */
export function fillTemplate(template, line) {
  if (!template) return '';
  return template.replace(/\{(commande|poste|br)\}/g, (_, k) =>
    encodeURIComponent(k === 'br' ? line.numeroBR || '' : line[k] || ''));
}

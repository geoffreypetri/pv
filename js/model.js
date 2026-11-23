// Règles métier : lignes, statuts, écarts, import (doublons, correspondance), export.
// Module pur : testable sous Node (voir tests/model.test.js).

import { STATUTS, STATUT_LABELS, CYCLE, IMPORT_FIELDS, normalizeLine } from './schema.js';
import { round2, parseAmount, parseDay, formatDay, normalizeKey, safeFilePart } from './format.js';

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
      const hay = normalizeKey([l.collaborateur, l.fournisseur, l.commande, l.poste, l.prestation, l.numeroBR, l.commentaire].join(' '));
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

/** Mois affiché au démarrage : le mois courant s'il a des lignes, sinon le plus récent mois renseigné. */
export function defaultMonth(lines, current) {
  if (lines.some((l) => l.mois === current)) return current;
  const past = monthsInData(lines).filter((m) => m <= current);
  return past[0] || monthsInData(lines)[0] || current;
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
  collaborateur: ['collaborateur', 'ressource', 'nom ressource', 'consultant', 'intervenant', 'nom'],
  fournisseur: ['fournisseur', 'societe', 'raison sociale', 'vendor', 'supplier', 'titulaire'],
  commande: ['numeros de commande associes', 'numero de commande associe', 'commande', 'n commande', 'no commande', 'numero commande', 'num commande', 'bon de commande', 'bdc', 'po', 'ref commande'],
  poste: ['poste', 'poste commande', 'poste de commande', 'ligne commande', 'position'],
  montantAttendu: ['total ht', 'montant', 'montant attendu', 'montant mensuel', 'montant ht', 'total periode ht', 'cout', 'amount'],
  debut: ['de', 'debut periode', 'debut', 'date debut', 'du'],
  fin: ['a', 'fin periode', 'fin', 'date fin', 'au'],
  quantite: ['quantite', 'jours', 'nb jours', 'nombre de jours', 'qte'],
  prixUnitaire: ['p u h t', 'pu ht', 'prix unitaire', 'tjm', 'taux journalier'],
  libelle: ['libelle budget', 'ligne budget', 'ligne budgetaire', 'imputation', 'element de travail'],
};

const cleanHeader = (h) => normalizeKey(h).replace(/[°º#.:_\-/()]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Propose une correspondance champ → en-tête à partir des noms de colonnes.
 * Les colonnes vides dans l'échantillon `rows` sont écartées (ex. « Commande » vide, « Numéros de commande associés » rempli).
 */
export function guessMapping(headers, saved = {}, rows = []) {
  const mapping = {};
  const used = new Set();
  const sample = rows.slice(0, 200);
  const filled = (h) => !sample.length || sample.some((r) => r[h] !== '' && r[h] !== null && r[h] !== undefined && r[h] !== 0);
  for (const f of IMPORT_FIELDS) {
    if (saved[f.key] && headers.includes(saved[f.key])) {
      mapping[f.key] = saved[f.key];
      used.add(saved[f.key]);
    }
  }
  for (const f of IMPORT_FIELDS) {
    if (mapping[f.key]) continue;
    const syn = SYNONYMS[f.key] || [];
    let best = null, bestScore = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const c = cleanHeader(h);
      let score = 0;
      syn.forEach((s, i) => {
        const rank = (syn.length - i) / syn.length; // les premiers synonymes sont préférés
        if (c === s) score = Math.max(score, 10 + rank);
        else if (s.length > 2 && (c.startsWith(s + ' ') || c.endsWith(' ' + s))) score = Math.max(score, 5 + rank);
        else if (s.length > 3 && c.includes(s)) score = Math.max(score, 2 + rank);
      });
      if (score && !filled(h)) score -= 9; // colonne vide : seulement en dernier recours
      if (score > bestScore) { best = h; bestScore = score; }
    }
    if (best && bestScore > 0) { mapping[f.key] = best; used.add(best); }
  }
  return mapping;
}

/**
 * Découpe une référence de commande : « 3000000101-10-Prestation de … » → commande, poste, libellé.
 * Une valeur sans ce format est renvoyée telle quelle comme n° de commande.
 */
export function parseCommande(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{5,})\s*[-/ ]\s*(\d{1,5})(?:\s*[-/]\s*(.*))?$/);
  if (m) return { commande: m[1], poste: m[2], prestation: (m[3] || '').trim() };
  return { commande: s, poste: '', prestation: '' };
}

const num = (v) => {
  const n = parseAmount(v);
  return n === null || Number.isNaN(n) ? null : n;
};

/**
 * Lit les lignes brutes (objets { en-tête: valeur }) selon la correspondance.
 * @returns {{ valid: Array<{fields, source, rowNumber}>, invalid: Array<{rowNumber, errors, fields}> }}
 *   fields : collaborateur, fournisseur, commande, poste, prestation, montant, quantite, prixUnitaire, libelle, debut, fin
 */
export function mapRows(rows, mapping, { firstRowNumber = 2 } = {}) {
  const valid = [], invalid = [];
  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
  const get = (row, key) => (mapping[key] ? row[mapping[key]] : '');
  rows.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    if (Object.values(row).every((v) => String(v ?? '').trim() === '')) return; // ligne vide
    const errors = [];
    const cmd = parseCommande(get(row, 'commande'));
    const posteCol = String(get(row, 'poste') ?? '').trim();
    const fields = {
      collaborateur: String(get(row, 'collaborateur') ?? '').trim(),
      fournisseur: String(get(row, 'fournisseur') ?? '').trim(),
      commande: cmd.commande,
      poste: posteCol || cmd.poste,
      prestation: cmd.prestation,
      montant: null,
      quantite: num(get(row, 'quantite')),
      prixUnitaire: num(get(row, 'prixUnitaire')),
      libelle: String(get(row, 'libelle') ?? '').trim(),
      debut: parseDay(get(row, 'debut')),
      fin: parseDay(get(row, 'fin')),
    };
    const m = parseAmount(get(row, 'montantAttendu'));
    if (m === null) errors.push('montant vide');
    else if (Number.isNaN(m)) errors.push(`montant illisible « ${get(row, 'montantAttendu')} »`);
    else fields.montant = m;
    if (!fields.collaborateur) errors.push('sans collaborateur');
    if (!fields.commande) errors.push('sans n° de commande');
    if (!fields.fournisseur) errors.push('sans fournisseur');
    if (fields.debut === null) errors.push(`date de début illisible « ${get(row, 'debut')} »`);
    if (fields.fin === null) errors.push(`date de fin illisible « ${get(row, 'fin')} »`);
    const source = {};
    for (const [k, v] of Object.entries(row)) if (!mappedHeaders.has(k) && v !== '' && v !== null) source[k] = v;
    if (errors.length) invalid.push({ rowNumber, errors, fields });
    else valid.push({ fields, source, rowNumber });
  });
  return { valid, invalid };
}

/** Résume les motifs de rejet : [{ motif, count }] (ex. « sans n° de commande » × 164). */
export function summarizeInvalid(invalid) {
  const m = new Map();
  for (const r of invalid) {
    const k = r.errors.join(', ');
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([motif, count]) => ({ motif, count })).sort((a, b) => b.count - a.count);
}

/** Périodes (De → A) présentes dans les lignes valides, de la plus récente à la plus ancienne. */
export function listPeriods(validRows) {
  const m = new Map();
  for (const r of validRows) {
    const { debut, fin } = r.fields;
    if (!debut) continue;
    const key = `${debut}|${fin}`;
    const e = m.get(key) || { debut, fin, mois: debut.slice(0, 7), lignes: 0, montant: 0 };
    e.lignes++;
    e.montant = round2(e.montant + r.fields.montant);
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.debut.localeCompare(a.debut) || b.fin.localeCompare(a.fin));
}

/** Clé de regroupement / doublon : collaborateur + commande + poste (+ mois). */
const groupKey = (f) => `${normalizeKey(f.collaborateur)}|${normalizeKey(f.commande)}|${normalizeKey(f.poste)}`;

/**
 * Additionne les imputations d'une période par collaborateur × commande × poste.
 * @param period { debut, fin } ou null (toutes les lignes, fichier sans dates)
 * @returns Array<{ fields: { collaborateur, fournisseur, commande, poste, prestation, montantAttendu, jours, periode }, details, source, rowNumbers }>
 */
export function aggregate(validRows, period = null) {
  const groups = new Map();
  for (const r of validRows) {
    const f = r.fields;
    if (period && (f.debut !== period.debut || f.fin !== period.fin)) continue;
    const key = groupKey(f);
    let g = groups.get(key);
    if (!g) {
      g = {
        fields: {
          collaborateur: f.collaborateur, fournisseur: f.fournisseur, commande: f.commande, poste: f.poste,
          prestation: f.prestation, montantAttendu: 0, jours: null,
          periode: period ? { debut: period.debut, fin: period.fin } : (f.debut ? { debut: f.debut, fin: f.fin } : null),
        },
        details: [], source: r.source, rowNumbers: [], fournisseurs: new Set(),
      };
      groups.set(key, g);
    }
    g.fournisseurs.add(f.fournisseur);
    g.fields.montantAttendu = round2(g.fields.montantAttendu + f.montant);
    if (f.quantite !== null) g.fields.jours = round2((g.fields.jours || 0) + f.quantite);
    if (!g.fields.prestation && f.prestation) g.fields.prestation = f.prestation;
    g.details.push({ libelle: f.libelle, quantite: f.quantite, prixUnitaire: f.prixUnitaire, montant: f.montant, ligne: r.rowNumber });
    g.rowNumbers.push(r.rowNumber);
  }
  return [...groups.values()].map(({ fournisseurs, ...g }) => {
    g.fields.fournisseur = [...fournisseurs].join(' / ');
    return g;
  }).sort((a, b) => a.fields.fournisseur.localeCompare(b.fields.fournisseur, 'fr') || a.fields.collaborateur.localeCompare(b.fields.collaborateur, 'fr'));
}

/** Clé de doublon : collaborateur + commande + poste + mois. */
export function duplicateKey(f, mois) {
  return `${mois}|${groupKey(f)}`;
}

/**
 * Compare les lignes à importer (agrégées) aux lignes existantes du mois.
 * @returns {{ nouvelles, doublons: Array<{incoming, existing, changes}> }}
 */
export function planImport(existingLines, items, mois) {
  const index = new Map();
  for (const l of existingLines) if (l.mois === mois) index.set(duplicateKey(l, mois), l);
  const seen = new Set();
  const nouvelles = [], doublons = [];
  for (const r of items) {
    const key = duplicateKey(r.fields, mois);
    const existing = index.get(key);
    if (existing) {
      doublons.push({ incoming: r, existing, changes: diffImportFields(existing, r.fields) });
    } else if (seen.has(key)) {
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
  for (const k of ['fournisseur', 'montantAttendu', 'jours']) {
    const a = existing[k] ?? '', b = fields[k] ?? '';
    const differs = k === 'fournisseur' ? String(a) !== String(b) : round2(a || 0) !== round2(b || 0);
    if (differs) changes.push({ champ: k, avant: existing[k], apres: fields[k] });
  }
  return changes;
}

/** Crée une ligne « Attendu » à partir d'un élément agrégé. */
export function lineFromImport(item, mois, importId) {
  const l = createLine(item.fields, { mois, importId, source: item.source });
  Object.assign(l, {
    prestation: item.fields.prestation || '',
    jours: item.fields.jours ?? null,
    periode: item.fields.periode ?? null,
    details: item.details || [],
  });
  return l;
}

/** Met à jour une ligne existante depuis l'import (sans toucher au statut, au PV ni au BR). */
export function updateFromImport(line, fields, importId, details = null) {
  line.fournisseur = fields.fournisseur || line.fournisseur;
  if (fields.poste !== undefined) line.poste = fields.poste || line.poste;
  line.montantAttendu = fields.montantAttendu;
  if (fields.jours !== undefined) line.jours = fields.jours;
  if (fields.periode) line.periode = fields.periode;
  if (fields.prestation) line.prestation = fields.prestation;
  if (details) line.details = details;
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
  { key: 'prestation', label: 'Prestation' },
  { key: 'periode', label: 'Période' },
  { key: 'jours', label: 'Jours', type: 'number' },
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
    prestation: l.prestation,
    periode: l.periode ? `${formatDay(l.periode.debut)} → ${formatDay(l.periode.fin)}` : '',
    jours: l.jours,
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

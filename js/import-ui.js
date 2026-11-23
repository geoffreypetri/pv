// Import de l'export Abraxio = synchronisation (Abraxio est la source de vérité) :
//  1. lecture du fichier ; correspondance des colonnes (demandée seulement si la correspondance
//     mémorisée ne convient pas, ou sur demande) ;
//  2. toutes les périodes sont lues : les imputations sont additionnées par mois × collaborateur ×
//     commande × poste ;
//  3. récapitulatif avant application : créations, mises à jour (Abraxio écrase), lignes « BR créé »
//     divergentes (jamais modifiées, signalées), lignes absentes d'Abraxio (signalées), lignes ignorées ;
//  4. application, copie du fichier brut dans imports/.

import { h, modal, field, toast, pickFile, icon } from './ui.js';
import { state, mutate, assertWritable } from './store.js';
import { readWorkbook } from './excel.js';
import * as S from './storage.js';
import * as M from './model.js';
import { IMPORT_FIELDS, STATUT_LABELS } from './schema.js';
import { formatEuro, monthLabel, safeFilePart, fileStamp, isValidMonth, formatDay, formatJours, normalizeKey, currentMonth } from './format.js';

const ACCEPT = '.xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';

export async function startImport(file = null) {
  try { assertWritable(); } catch (e) { return toast(e.message, 'error'); }
  if (!file) file = await pickFile(ACCEPT);
  if (!file) return;
  let sheets;
  try {
    sheets = await readWorkbook(file);
  } catch (e) {
    console.error(e);
    return toast(`Lecture du fichier impossible : ${e.message}`, 'error', 8000);
  }
  if (!sheets.length) return toast('Le fichier ne contient aucun tableau exploitable.', 'error');

  // Correspondance mémorisée utilisable telle quelle ?
  let cfg = savedConfig(sheets);
  for (;;) {
    if (!cfg) {
      cfg = await stepMapping(file, sheets);
      if (!cfg) return;
    }
    const { valid, invalid } = M.mapRows(cfg.sheet.rows, cfg.mapping, { firstRowNumber: cfg.sheet.headerRow + 1 });
    if (!valid.length) {
      toast('Aucune ligne exploitable avec cette correspondance de colonnes.', 'error', 7000);
      cfg = null;
      continue;
    }
    const items = M.aggregate(valid, { mois: cfg.mois });
    const plan = M.planSync(state.data.lignes, items, { tolerance: Number(state.data.config.toleranceEcart) || 0 });
    const r = await stepReview({ file, cfg, plan, valid, invalid, items });
    if (r === 'mapping') { cfg = null; continue; }
    if (!r) return;
    await applyImport({ file, cfg, plan, invalid, items });
    return;
  }
}

/** Feuille + correspondance mémorisées, si elles s'appliquent à ce fichier. */
function savedConfig(sheets) {
  const mapping = state.data.config.importMapping || {};
  const sheet = sheets[defaultSheetIndex(sheets)];
  const required = IMPORT_FIELDS.filter((f) => f.required).every((f) => mapping[f.key]);
  const allPresent = Object.values(mapping).every((h) => sheet.headers.includes(h));
  if (!required || !allPresent || !mapping.debut || !mapping.fin) return null;
  return { sheet, mapping, remember: true, mois: null, auto: true };
}

function defaultSheetIndex(sheets) {
  const saved = state.data.config.importSheet;
  let i = saved ? sheets.findIndex((s) => s.name === saved) : -1;
  if (i < 0) i = sheets.findIndex((s) => /consomm/i.test(normalizeKey(s.name)));
  return i < 0 ? 0 : i;
}

/* ---------- Étape « colonnes » ---------- */

function stepMapping(file, sheets) {
  const saved = state.data.config.importMapping || {};
  let sheet = sheets[defaultSheetIndex(sheets)];
  const sheetSelect = sheets.length > 1
    ? h('select', {}, sheets.map((s, i) => h('option', { value: i, text: `${s.name} (${s.rows.length} lignes)`, selected: s === sheet })))
    : null;
  const mois = h('input', { type: 'month', value: currentMonth() });
  const moisField = field('Mois concerné', mois, 'Fichier sans colonnes de période : choisissez le mois des lignes importées.');
  const selects = {};
  const mapGrid = h('div', { class: 'form-grid' });
  const preview = h('div', { class: 'table-wrap preview' });
  const info = h('p', { class: 'muted small' });
  const remember = h('input', { type: 'checkbox', checked: true });

  function buildSelects() {
    const guess = M.guessMapping(sheet.headers, saved, sheet.rows);
    mapGrid.replaceChildren();
    for (const f of IMPORT_FIELDS) {
      const sel = h('select', { onchange: renderPreview },
        h('option', { value: '', text: f.required ? '— choisir —' : '— aucune —' }),
        sheet.headers.map((hd) => h('option', { value: hd, text: hd, selected: guess[f.key] === hd })));
      selects[f.key] = sel;
      mapGrid.append(field(`${f.label}${f.required ? ' *' : ''}`, sel, f.hint || ''));
    }
    info.textContent = `${sheet.rows.length} lignes, en-têtes en ligne ${sheet.headerRow}.`;
    renderPreview();
  }

  function currentMapping() {
    const m = {};
    for (const f of IMPORT_FIELDS) if (selects[f.key].value) m[f.key] = selects[f.key].value;
    return m;
  }

  function renderPreview() {
    const m = currentMapping();
    moisField.hidden = !!m.debut;
    const sample = M.mapRows(sheet.rows.slice(0, 40), m, { firstRowNumber: sheet.headerRow + 1 });
    const rows = [...sample.valid.map((r) => ({ ...r, ok: true })), ...sample.invalid].sort((a, b) => a.rowNumber - b.rowNumber).slice(0, 6);
    const cols = [
      ['Ligne', (r) => r.rowNumber],
      ['Collaborateur', (r) => r.fields.collaborateur],
      ['Fournisseur', (r) => r.fields.fournisseur],
      ['Commande', (r) => r.fields.commande + (r.fields.poste ? ` / ${r.fields.poste}` : '')],
      ['Période', (r) => (r.fields.debut ? `${formatDay(r.fields.debut)} → ${formatDay(r.fields.fin)}` : '')],
      ['Jours', (r) => formatJours(r.fields.quantite)],
      ['Montant', (r) => formatEuro(r.fields.montant)],
      ['Libellé', (r) => r.fields.libelle],
      ['', (r) => (r.ok ? '' : `Ignorée : ${r.errors.join(', ')}`)],
    ];
    preview.replaceChildren(h('table', { class: 'grid small' },
      h('thead', {}, h('tr', {}, cols.map(([t]) => h('th', { text: t })))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.ok ? '' : 'muted' }, cols.map(([, f]) => h('td', { text: String(f(r) ?? '') })))))));
  }

  if (sheetSelect) sheetSelect.addEventListener('change', () => { sheet = sheets[Number(sheetSelect.value)]; buildSelects(); });
  buildSelects();

  return modal({
    title: 'Import Abraxio — colonnes',
    wide: true,
    body: h('div', {},
      h('p', {}, 'Fichier : ', h('strong', { text: file.name })),
      sheetSelect ? field('Feuille', sheetSelect) : null,
      info,
      h('h3', { text: 'Colonne du fichier → champ de l\'application' }),
      mapGrid,
      moisField,
      h('label', { class: 'check' }, remember, ' Mémoriser la feuille et les colonnes pour les prochains imports'),
      h('h3', { text: 'Aperçu des premières lignes' }),
      preview),
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Suivant', variant: 'primary', onClick: () => {
        const mapping = currentMapping();
        const missing = IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
        if (missing.length) throw new Error(`Champs obligatoires sans colonne : ${missing.join(', ')}.`);
        const used = Object.values(mapping);
        if (new Set(used).size !== used.length) throw new Error('Une même colonne est associée à plusieurs champs.');
        if (!!mapping.debut !== !!mapping.fin) throw new Error('Associez les deux colonnes de période (De et A), ou aucune.');
        if (!mapping.debut && !isValidMonth(mois.value)) throw new Error('Choisissez le mois concerné.');
        return { sheet, mapping, remember: remember.checked, mois: mapping.debut ? null : mois.value };
      } },
    ],
  });
}

/* ---------- Étape « récapitulatif » ---------- */

const fmtChange = (c) => {
  const v = (x) => (c.champ === 'montantAttendu' ? formatEuro(x) : c.champ === 'jours' ? formatJours(x)
    : c.champ === 'periode' ? (x ? `${formatDay(x.debut)} → ${formatDay(x.fin)}` : '∅') : String(x ?? '') || '∅');
  return c.champ === 'details' ? 'Détail des imputations' : `${c.label} : ${v(c.avant)} → ${v(c.apres)}`;
};

function stepReview({ file, cfg, plan, valid, invalid, items }) {
  const rejets = M.summarizeInvalid(invalid);
  const moisTxt = plan.moisCouverts.length
    ? `${monthLabel(plan.moisCouverts[0])} → ${monthLabel(plan.moisCouverts.at(-1))}` : '—';
  const total = items.reduce((a, i) => a + i.fields.montantAttendu, 0);
  const nbReval = plan.modifications.filter((m) => m.revalidation).length;
  const nouvellesAbsentes = plan.absentes.filter((l) => l.alerteAbraxio?.type !== 'absente');

  const sections = [
    { key: 'creations', label: 'Nouvelles', count: plan.creations.length, render: () => itemsTable(plan.creations.map((it) => ({ it }))) },
    { key: 'modifications', label: 'Mises à jour', count: plan.modifications.length, render: () => itemsTable(plan.modifications.map((m) => ({ it: m.item, line: m.line, changes: m.changes, note: m.revalidation ? 'Repasse à « PV reçu » : à revalider' : '' }))) },
    { key: 'protegees', label: 'BR créé — divergences', count: plan.protegees.length, tone: 'warn', render: () => itemsTable(plan.protegees.map((p) => ({ it: p.item, line: p.line, changes: p.changes, note: 'Non modifiée (BR créé) : divergence signalée' }))) },
    { key: 'absentes', label: 'Absentes d\'Abraxio', count: plan.absentes.length, tone: 'warn', render: () => linesTable(plan.absentes) },
    { key: 'identiques', label: 'Inchangées', count: plan.identiques.length, render: () => itemsTable(plan.identiques.map((x) => ({ it: x.item, line: x.line }))) },
    { key: 'ignorees', label: 'Lignes ignorées', count: invalid.length, render: () => ignoredTable(invalid) },
  ];
  const panel = h('div', { class: 'tab-panel' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  let current = sections.find((s) => s.count && s.key !== 'identiques' && s.key !== 'ignorees') || sections[0];
  function show(sec) {
    current = sec;
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.key === sec.key);
    panel.replaceChildren(sec.count ? sec.render() : h('p', { class: 'muted empty', text: 'Aucune ligne.' }));
  }
  for (const sec of sections) {
    tabs.append(h('button', { type: 'button', class: `tab ${sec.tone && sec.count ? 'tab-' + sec.tone : ''}`, role: 'tab', dataset: { key: sec.key }, onclick: () => show(sec) },
      sec.label, h('span', { class: 'tab-count', text: sec.count })));
  }
  show(current);

  const nothing = !plan.creations.length && !plan.modifications.length && !plan.protegees.length && !nouvellesAbsentes.length && !plan.reapparues.length;

  return modal({
    title: 'Import Abraxio — récapitulatif',
    className: 'modal-xwide',
    body: h('div', {},
      h('p', { class: 'muted' }, h('strong', { text: file.name }), ` · feuille « ${cfg.sheet.name} » · ${valid.length} imputations · ${items.length} lignes de PV · ${moisTxt} · ${formatEuro(total)}`),
      h('div', { class: 'callout' }, icon('alert'), h('span', {},
        'Abraxio fait foi : les nouvelles valeurs remplacent les anciennes, sauf sur les lignes « BR créé », qui ne sont jamais modifiées (la divergence est seulement signalée). '
        + 'Le statut, le PV déposé, le n° de BR et le commentaire ne sont pas touchés.'
        + (nbReval ? ` ${nbReval} ligne(s) « Validé » repasseront à « PV reçu » car leur écart devient non nul.` : ''))),
      rejets.length ? h('p', { class: 'muted small' }, `Ignorées : ${rejets.map((r) => `${r.count} ${r.motif}`).join(' ; ')}.`) : null,
      tabs,
      panel),
    buttons: [
      { label: 'Modifier les colonnes', value: 'mapping', start: true },
      { label: 'Annuler', value: null },
      { label: nothing ? 'Déjà à jour' : 'Appliquer', variant: 'primary', onClick: () => {
        if (nothing) throw new Error('Les données sont déjà à jour : rien à appliquer.');
        return true;
      } },
    ],
  });
}

function itemsTable(rows) {
  const trs = [];
  for (const { it, line, changes, note } of rows) {
    const f = it.fields;
    const toggle = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, `${it.details.length} imputation${it.details.length > 1 ? 's' : ''}`, icon('chevronDown', { size: 14 }));
    const tr = h('tr', { class: 'row-toggle' },
      h('td', { class: 'nowrap', text: monthLabel(f.mois) }),
      h('td', {}, h('div', { class: 'cell-main', text: f.collaborateur }), f.prestation ? h('div', { class: 'cell-sub', text: f.prestation }) : null),
      h('td', { text: f.fournisseur }),
      h('td', {}, h('div', { text: f.commande }), f.poste ? h('div', { class: 'cell-sub', text: f.poste }) : null),
      h('td', { class: 'num', text: formatJours(f.jours) }),
      h('td', { class: 'num', text: formatEuro(f.montantAttendu) }),
      h('td', {},
        line ? h('div', { class: 'small' }, h('span', { class: `badge badge-${line.statut}`, text: STATUT_LABELS[line.statut] })) : null,
        changes?.length ? h('ul', { class: 'changes' }, changes.map((c) => h('li', { text: fmtChange(c) }))) : null,
        note ? h('div', { class: 'cell-sub warn-text', text: note }) : null),
      h('td', {}, toggle));
    const sub = h('tr', { class: 'detail-row', hidden: true }, h('td', { colSpan: 8 }, detailsTable(it.details, f)));
    tr.addEventListener('click', () => { sub.hidden = !sub.hidden; tr.classList.toggle('open', !sub.hidden); });
    trs.push(tr, sub);
  }
  return h('div', { class: 'table-wrap review' }, h('table', { class: 'grid small' },
    h('thead', {}, h('tr', {}, ['Mois', 'Collaborateur', 'Fournisseur', 'Commande', 'Jours', 'Montant', 'Changements', ''].map((t, i) => h('th', { class: i === 4 || i === 5 ? 'num' : '', text: t })))),
    h('tbody', {}, trs)));
}

function linesTable(lines) {
  return h('div', { class: 'table-wrap review' }, h('table', { class: 'grid small' },
    h('thead', {}, h('tr', {}, ['Mois', 'Collaborateur', 'Fournisseur', 'Commande', 'Montant attendu', 'Statut'].map((t) => h('th', { text: t })))),
    h('tbody', {}, lines.map((l) => h('tr', {},
      h('td', { class: 'nowrap', text: monthLabel(l.mois) }),
      h('td', { text: l.collaborateur }),
      h('td', { text: l.fournisseur }),
      h('td', { text: l.commande + (l.poste ? ` / ${l.poste}` : '') }),
      h('td', { class: 'num', text: formatEuro(l.montantAttendu) }),
      h('td', {}, h('span', { class: `badge badge-${l.statut}`, text: STATUT_LABELS[l.statut] })))))),
  h('p', { class: 'muted small', text: 'Ces lignes sont conservées et marquées « Absente d\'Abraxio » : filtrez sur « Alertes Abraxio » pour les retrouver et les supprimer si besoin.' }));
}

function ignoredTable(invalid) {
  const shown = invalid.slice(0, 300);
  return h('div', { class: 'table-wrap review' }, h('table', { class: 'grid small' },
    h('thead', {}, h('tr', {}, ['Ligne', 'Collaborateur', 'Fournisseur', 'Montant', 'Motif'].map((t) => h('th', { text: t })))),
    h('tbody', {}, shown.map((r) => h('tr', {},
      h('td', { class: 'num', text: r.rowNumber }),
      h('td', { text: r.fields.collaborateur || '—' }),
      h('td', { text: r.fields.fournisseur || '—' }),
      h('td', { class: 'num', text: formatEuro(r.fields.montant) }),
      h('td', { class: 'muted', text: r.errors.join(', ') }))))),
  invalid.length > shown.length ? h('p', { class: 'muted small', text: `… et ${invalid.length - shown.length} autres.` }) : null);
}

/** Tableau des imputations additionnées (utilisé aussi dans la fiche d'une ligne). */
export function detailsTable(details, totals = {}) {
  return h('table', { class: 'grid small details' },
    h('thead', {}, h('tr', {},
      h('th', { text: 'Libellé' }), h('th', { class: 'num', text: 'Jours' }), h('th', { class: 'num', text: 'Prix unitaire' }),
      h('th', { class: 'num', text: 'Montant HT' }), h('th', { class: 'num', text: 'Ligne' }))),
    h('tbody', {}, details.map((d) => h('tr', {},
      h('td', { text: d.libelle || '—' }),
      h('td', { class: 'num', text: formatJours(d.quantite) }),
      h('td', { class: 'num', text: formatEuro(d.prixUnitaire) }),
      h('td', { class: 'num', text: formatEuro(d.montant) }),
      h('td', { class: 'num muted', text: d.ligne ?? '' })))),
    details.length > 1 ? h('tfoot', {}, h('tr', {},
      h('td', { text: 'Total' }),
      h('td', { class: 'num', text: formatJours(totals.jours) }),
      h('td'),
      h('td', { class: 'num', text: formatEuro(totals.montantAttendu) }),
      h('td'))) : null);
}

/* ---------- Application ---------- */

async function applyImport({ file, cfg, plan, invalid, items }) {
  const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || ['.xlsx'])[0].toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const copyPath = `imports/${fileStamp(new Date(), true)}_${safeFilePart(baseName, 60)}${ext}`;
  try {
    await S.copyInto(state.dir, copyPath, file);
  } catch (e) {
    return toast(`Copie du fichier dans imports/ impossible : ${e.message}`, 'error', 8000);
  }
  const importId = globalThis.crypto.randomUUID();
  try {
    await mutate((d) => {
      M.applySync(d, plan, importId);
      if (cfg.remember) {
        d.config.importMapping = cfg.mapping;
        d.config.importSheet = cfg.sheet.name;
      }
      d.imports.push({
        id: importId,
        date: new Date().toISOString(),
        fichierOrigine: file.name,
        feuille: cfg.sheet.name,
        copie: copyPath,
        mois: plan.moisCouverts,
        lignes: items.length,
        lignesCreees: plan.creations.length,
        lignesMisesAJour: plan.modifications.length,
        lignesInchangees: plan.identiques.length,
        divergencesBR: plan.protegees.length,
        absentes: plan.absentes.length,
        lignesFichierIgnorees: invalid.length,
      });
    });
  } catch (e) {
    return toast(e.message, 'error', 8000);
  }
  const parts = [`${plan.creations.length} créée(s)`, `${plan.modifications.length} mise(s) à jour`];
  if (plan.protegees.length) parts.push(`${plan.protegees.length} divergence(s) sur BR créé`);
  if (plan.absentes.length) parts.push(`${plan.absentes.length} absente(s) d'Abraxio`);
  toast(`Import terminé : ${parts.join(', ')}.`, 'success', 7000);
}

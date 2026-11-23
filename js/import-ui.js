// Import d'un export Abraxio (feuille « Données Consommé ») :
//  1. correspondance des colonnes (mémorisée),
//  2. choix de la période (colonnes De / A) et revue : les imputations de la période sont
//     additionnées par collaborateur × commande × poste, avec le détail listé pour vérification,
//  3. création des lignes « Attendu » (ou mise à jour des doublons), copie du fichier brut dans imports/.

import { h, modal, field, toast, pickFile } from './ui.js';
import { state, mutate, assertWritable, notify } from './store.js';
import { readWorkbook } from './excel.js';
import * as S from './storage.js';
import * as M from './model.js';
import { IMPORT_FIELDS } from './schema.js';
import { formatEuro, monthLabel, safeFilePart, fileStamp, isValidMonth, formatDay, formatJours, normalizeKey } from './format.js';

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

  const step1 = await stepMapping(file, sheets);
  if (!step1) return;
  const { sheet, mapping, remember, mois: moisManuel } = step1;
  const { valid, invalid } = M.mapRows(sheet.rows, mapping, { firstRowNumber: sheet.headerRow + 1 });
  if (!valid.length) return toast('Aucune ligne exploitable avec cette correspondance de colonnes.', 'error', 7000);
  const step2 = await stepReview({ valid, invalid, moisManuel });
  if (!step2) return;
  await applyImport({ file, sheet, mapping, remember, ...step2 });
}

/* ---------- Étape 1 : correspondance des colonnes ---------- */

function defaultSheetIndex(sheets) {
  const saved = state.data.config.importSheet;
  let i = saved ? sheets.findIndex((s) => s.name === saved) : -1;
  if (i < 0) i = sheets.findIndex((s) => /consomm/i.test(normalizeKey(s.name)));
  return i < 0 ? 0 : i;
}

function stepMapping(file, sheets) {
  const saved = state.data.config.importMapping || {};
  let sheet = sheets[defaultSheetIndex(sheets)];
  const sheetSelect = sheets.length > 1
    ? h('select', {}, sheets.map((s, i) => h('option', { value: i, text: `${s.name} (${s.rows.length} lignes)`, selected: s === sheet })))
    : null;
  const mois = h('input', { type: 'month', value: state.mois });
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

/* ---------- Étape 2 : période et revue ---------- */

const CHAMP_LABELS = { fournisseur: 'Fournisseur', montantAttendu: 'Montant', jours: 'Jours' };
const fmtVal = (k, v) => (k === 'montantAttendu' ? formatEuro(v) : k === 'jours' ? formatJours(v) : String(v ?? '') || '∅');

function stepReview({ valid, invalid, moisManuel }) {
  const periods = moisManuel ? [] : M.listPeriods(valid);
  const periodSelect = periods.length
    ? h('select', {}, periods.map((p, i) => h('option', {
      value: i,
      text: `${formatDay(p.debut)} → ${formatDay(p.fin)}  —  ${p.lignes} imputations, ${formatEuro(p.montant)}`,
    })))
    : null;
  const content = h('div');
  let current = null; // { period, mois, items, plan, choices }

  function compute() {
    const period = periods.length ? periods[Number(periodSelect.value)] : null;
    const mois = period ? period.mois : moisManuel;
    const items = M.aggregate(valid, period);
    const plan = M.planImport(state.data.lignes, items, mois);
    const choices = new Map();
    for (const d of plan.doublons) if (d.existing) choices.set(d, d.changes.length ? 'maj' : 'ignorer');
    current = { period, mois, items, plan, choices };
    render();
  }

  function render() {
    const { period, mois, items, plan, choices } = current;
    const dupOf = new Map(plan.doublons.map((d) => [d.incoming, d]));
    const total = items.reduce((a, i) => a + i.fields.montantAttendu, 0);
    const nbImputations = items.reduce((a, i) => a + i.details.length, 0);
    const autres = valid.length - nbImputations;
    const realDups = plan.doublons.filter((d) => d.existing);

    const rows = [];
    for (const it of items) {
      const d = dupOf.get(it);
      let action;
      if (!d) action = h('span', { class: 'badge badge-pv_recu', text: 'Nouvelle' });
      else if (d.inFile) action = h('span', { class: 'muted small', text: 'Doublon dans le fichier' });
      else {
        const sel = h('select', { class: 'select-small', onchange: () => choices.set(d, sel.value), onclick: (e) => e.stopPropagation() },
          h('option', { value: 'ignorer', text: d.changes.length ? 'Ignorer' : 'Déjà importée', selected: choices.get(d) === 'ignorer' }),
          h('option', { value: 'maj', text: 'Mettre à jour', selected: choices.get(d) === 'maj', disabled: !d.changes.length }));
        action = h('div', {}, sel, d.changes.length
          ? h('div', { class: 'cell-sub', text: d.changes.map((c) => `${CHAMP_LABELS[c.champ]} : ${fmtVal(c.champ, c.avant)} → ${fmtVal(c.champ, c.apres)}`).join(' · ') })
          : null);
      }
      const f = it.fields;
      const toggle = h('button', { type: 'button', class: 'btn btn-ghost btn-small', text: `${it.details.length} ligne${it.details.length > 1 ? 's' : ''} ▸` });
      const tr = h('tr', { class: 'row-toggle' },
        h('td', {}, h('div', { class: 'cell-main', text: f.collaborateur }), f.prestation ? h('div', { class: 'cell-sub', text: f.prestation }) : null),
        h('td', { text: f.fournisseur }),
        h('td', {}, h('div', { text: f.commande }), f.poste ? h('div', { class: 'cell-sub', text: f.poste }) : null),
        h('td', { class: 'num', text: formatJours(f.jours) }),
        h('td', { class: 'num', text: formatEuro(f.montantAttendu) }),
        h('td', {}, toggle),
        h('td', {}, action));
      const sub = h('tr', { class: 'detail-row', hidden: true }, h('td', { colSpan: 7 }, detailsTable(it.details, f)));
      const flip = () => { sub.hidden = !sub.hidden; toggle.textContent = toggle.textContent.replace(/[▸▾]/, sub.hidden ? '▸' : '▾'); };
      tr.addEventListener('click', flip);
      rows.push(tr, sub);
    }

    const rejets = M.summarizeInvalid(invalid);
    content.replaceChildren(...[
      h('ul', { class: 'import-summary' },
        h('li', {}, h('strong', { text: items.length }), ` ligne(s) de PV pour ${monthLabel(mois)}, total `, h('strong', { text: formatEuro(total) }),
          ` — somme de ${nbImputations} imputation(s)`),
        h('li', {}, h('strong', { text: plan.nouvelles.length }), ' nouvelle(s), ', h('strong', { text: realDups.length }), ' déjà présente(s) pour ce mois'),
        autres > 0 ? h('li', { class: 'muted' }, `${autres} imputation(s) d'autres périodes non concernée(s)`) : null,
        rejets.length ? h('li', { class: 'muted' }, `${invalid.length} ligne(s) du fichier ignorée(s) : `,
          rejets.map((r) => `${r.count} ${r.motif}`).join(' ; ')) : null),
      realDups.length ? h('p', {}, 'Lignes déjà présentes : ',
        h('button', { type: 'button', class: 'btn btn-small', text: 'Tout ignorer', onclick: () => setAll('ignorer') }), ' ',
        h('button', { type: 'button', class: 'btn btn-small', text: 'Tout mettre à jour', onclick: () => setAll('maj') }),
        h('span', { class: 'muted small', text: '  La mise à jour ne modifie ni le statut, ni le PV, ni le BR.' })) : null,
      h('p', { class: 'muted small', text: 'Cliquez sur une ligne pour voir les imputations additionnées.' }),
      h('div', { class: 'table-wrap review' }, h('table', { class: 'grid small' },
        h('thead', {}, h('tr', {}, ['Collaborateur', 'Fournisseur', 'Commande', 'Jours', 'Montant', 'Détail', 'Action'].map((t, i) => h('th', { class: i === 3 || i === 4 ? 'num' : '', text: t })))),
        h('tbody', {}, rows),
        h('tfoot', {}, h('tr', {},
          h('td', { colSpan: 3, text: 'Total' }),
          h('td', { class: 'num', text: formatJours(items.reduce((a, i) => a + (i.fields.jours || 0), 0)) }),
          h('td', { class: 'num', text: formatEuro(total) }),
          h('td', { colSpan: 2 })))))].filter(Boolean));
  }

  function setAll(v) {
    for (const d of current.plan.doublons) if (d.existing && (v === 'ignorer' || d.changes.length)) current.choices.set(d, v);
    render();
  }

  if (periodSelect) periodSelect.addEventListener('change', compute);
  compute();

  return modal({
    title: 'Import Abraxio — période',
    wide: true,
    className: 'modal-xwide',
    body: h('div', {},
      periodSelect ? field('Période à importer (colonnes De → A)', periodSelect, 'Le mois des lignes créées est celui du début de la période.') : null,
      content),
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Importer', variant: 'primary', onClick: () => {
        const toUpdate = current.plan.doublons.filter((d) => d.existing && current.choices.get(d) === 'maj');
        if (!current.plan.nouvelles.length && !toUpdate.length) throw new Error('Rien à importer (toutes les lignes sont déjà présentes ou ignorées).');
        return { ...current, toUpdate, nbInvalid: invalid.length };
      } },
    ],
  });
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

/* ---------- Étape 3 : application ---------- */

async function applyImport({ file, sheet, mapping, remember, period, mois, plan, toUpdate, nbInvalid }) {
  const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || ['.xlsx'])[0].toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const copyPath = `imports/${mois}_${fileStamp(new Date(), true)}_${safeFilePart(baseName, 60)}${ext}`;
  try {
    await S.copyInto(state.dir, copyPath, file);
  } catch (e) {
    return toast(`Copie du fichier dans imports/ impossible : ${e.message}`, 'error', 8000);
  }
  const importId = globalThis.crypto.randomUUID();
  try {
    await mutate((d) => {
      for (const it of plan.nouvelles) d.lignes.push(M.lineFromImport(it, mois, importId));
      for (const dup of toUpdate) M.updateFromImport(dup.existing, dup.incoming.fields, importId, dup.incoming.details);
      if (remember) {
        d.config.importMapping = mapping;
        d.config.importSheet = sheet.name;
      }
      d.imports.push({
        id: importId,
        date: new Date().toISOString(),
        mois,
        periode: period ? { debut: period.debut, fin: period.fin } : null,
        fichierOrigine: file.name,
        feuille: sheet.name,
        copie: copyPath,
        lignesCreees: plan.nouvelles.length,
        lignesMisesAJour: toUpdate.length,
        lignesIgnorees: plan.doublons.length - toUpdate.length,
        lignesFichierIgnorees: nbInvalid,
      });
    });
  } catch (e) {
    return toast(e.message, 'error', 8000);
  }
  state.mois = mois;
  state.filters = { q: '', fournisseur: '', statut: '' };
  notify();
  toast(`Import terminé : ${plan.nouvelles.length} ligne(s) créée(s), ${toUpdate.length} mise(s) à jour.`, 'success', 6000);
}

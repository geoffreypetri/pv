// Import d'un export Abraxio : lecture, correspondance des colonnes, choix du mois,
// détection des doublons, création des lignes « Attendu », copie du fichier brut dans imports/.

import { h, modal, field, toast, pickFile } from './ui.js';
import { state, mutate, assertWritable, notify } from './store.js';
import { readWorkbook } from './excel.js';
import * as S from './storage.js';
import * as M from './model.js';
import { IMPORT_FIELDS } from './schema.js';
import { formatEuro, monthLabel, safeFilePart, fileStamp, isValidMonth, parseAmount } from './format.js';

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

  const mappingStep = await stepMapping(file, sheets);
  if (!mappingStep) return;
  const { sheet, mapping, mois } = mappingStep;
  const { valid, invalid } = M.mapRows(sheet.rows, mapping, { firstRowNumber: sheet.headerRow + 1 });
  const plan = M.planImport(state.data.lignes, valid, mois);
  const decision = await stepReview(plan, invalid, mois);
  if (!decision) return;
  await applyImport(file, mois, mapping, plan, decision, invalid.length);
}

/* ---------- Étape 1 : correspondance des colonnes ---------- */

function stepMapping(file, sheets) {
  const saved = state.data.config.importMapping || {};
  let sheet = sheets[0];
  const sheetSelect = sheets.length > 1
    ? h('select', {}, sheets.map((s, i) => h('option', { value: i, text: `${s.name} (${s.rows.length} lignes)` })))
    : null;
  const mois = h('input', { type: 'month', value: state.mois, required: true });
  const selects = {};
  const mapGrid = h('div', { class: 'form-grid' });
  const preview = h('div', { class: 'table-wrap preview' });
  const remember = h('input', { type: 'checkbox', checked: true });

  function buildSelects() {
    const guess = M.guessMapping(sheet.headers, saved);
    mapGrid.replaceChildren();
    for (const f of IMPORT_FIELDS) {
      const sel = h('select', { onchange: renderPreview },
        h('option', { value: '', text: f.required ? '— choisir —' : '— aucune —' }),
        sheet.headers.map((hd) => h('option', { value: hd, text: hd, selected: guess[f.key] === hd })));
      selects[f.key] = sel;
      mapGrid.append(field(`${f.label}${f.required ? ' *' : ''}`, sel));
    }
    renderPreview();
  }

  function currentMapping() {
    const m = {};
    for (const f of IMPORT_FIELDS) if (selects[f.key].value) m[f.key] = selects[f.key].value;
    return m;
  }

  function renderPreview() {
    const m = currentMapping();
    const rows = sheet.rows.slice(0, 5);
    preview.replaceChildren(h('table', { class: 'grid small' },
      h('thead', {}, h('tr', {}, IMPORT_FIELDS.map((f) => h('th', { text: f.label })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, IMPORT_FIELDS.map((f) => {
        const v = m[f.key] ? r[m[f.key]] : '';
        const amount = f.key === 'montantAttendu' ? parseAmount(v) : null;
        return h('td', { text: amount !== null && !Number.isNaN(amount) ? formatEuro(amount) : String(v ?? '') });
      }))))));
  }

  if (sheetSelect) sheetSelect.addEventListener('change', () => { sheet = sheets[Number(sheetSelect.value)]; buildSelects(); });
  buildSelects();

  return modal({
    title: 'Import Abraxio — correspondance des colonnes',
    wide: true,
    body: h('div', {},
      h('p', {}, 'Fichier : ', h('strong', { text: file.name }), ` — ${sheet.rows.length} lignes, en-têtes en ligne ${sheet.headerRow}.`),
      sheetSelect ? field('Feuille', sheetSelect) : null,
      field('Mois concerné', mois, 'Les lignes importées seront créées pour ce mois, au statut « Attendu ».'),
      h('h3', { text: 'Colonne du fichier → champ de l\'application' }),
      mapGrid,
      h('label', { class: 'check' }, remember, ' Mémoriser cette correspondance pour les prochains imports'),
      h('h3', { text: 'Aperçu (5 premières lignes)' }),
      preview),
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Analyser', variant: 'primary', onClick: () => {
        const mapping = currentMapping();
        const missing = IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
        if (missing.length) throw new Error(`Champs obligatoires sans colonne : ${missing.join(', ')}.`);
        const used = Object.values(mapping);
        if (new Set(used).size !== used.length) throw new Error('Une même colonne est associée à plusieurs champs.');
        if (!isValidMonth(mois.value)) throw new Error('Choisissez le mois concerné.');
        return { sheet, mapping: { ...mapping, _remember: remember.checked }, mois: mois.value };
      } },
    ],
  });
}

/* ---------- Étape 2 : revue (nouvelles lignes, doublons, erreurs) ---------- */

const CHAMP_LABELS = { fournisseur: 'Fournisseur', poste: 'Poste', montantAttendu: 'Montant attendu' };
const fmtVal = (k, v) => (k === 'montantAttendu' ? formatEuro(v) : String(v ?? '') || '∅');

function stepReview(plan, invalid, mois) {
  const realDups = plan.doublons.filter((d) => d.existing);
  const inFile = plan.doublons.filter((d) => d.inFile);
  const choices = new Map(); // doublon → 'ignorer' | 'maj'
  realDups.forEach((d) => choices.set(d, d.changes.length ? 'maj' : 'ignorer'));

  const dupRows = realDups.map((d) => {
    const sel = h('select', { onchange: () => choices.set(d, sel.value) },
      h('option', { value: 'ignorer', text: 'Ignorer', selected: choices.get(d) === 'ignorer' }),
      h('option', { value: 'maj', text: 'Mettre à jour', selected: choices.get(d) === 'maj', disabled: !d.changes.length }));
    return h('tr', {},
      h('td', { text: d.existing.collaborateur }),
      h('td', { text: d.existing.commande }),
      h('td', {}, d.changes.length
        ? d.changes.map((c) => h('div', { text: `${CHAMP_LABELS[c.champ]} : ${fmtVal(c.champ, c.avant)} → ${fmtVal(c.champ, c.apres)}` }))
        : h('span', { class: 'muted', text: 'Identique' })),
      h('td', {}, sel));
  });

  const setAll = (v) => {
    realDups.forEach((d) => { if (v === 'ignorer' || d.changes.length) choices.set(d, v); });
    dupRows.forEach((tr, i) => { tr.querySelector('select').value = choices.get(realDups[i]); });
  };

  return modal({
    title: `Import Abraxio — ${monthLabel(mois)}`,
    wide: true,
    body: h('div', {},
      h('ul', { class: 'import-summary' },
        h('li', {}, h('strong', { text: plan.nouvelles.length }), ' nouvelle(s) ligne(s) « Attendu » à créer'),
        h('li', {}, h('strong', { text: realDups.length }), ' doublon(s) avec des lignes existantes (même collaborateur + commande + mois)'),
        inFile.length ? h('li', {}, h('strong', { text: inFile.length }), ' doublon(s) à l\'intérieur du fichier (ignorés)') : null,
        invalid.length ? h('li', { class: 'warning' }, h('strong', { text: invalid.length }), ' ligne(s) incomplète(s) ignorée(s)') : null),
      realDups.length ? h('div', {},
        h('h3', { text: 'Doublons' }),
        h('p', {}, 'Tout : ',
          h('button', { type: 'button', class: 'btn btn-small', text: 'Ignorer', onclick: () => setAll('ignorer') }), ' ',
          h('button', { type: 'button', class: 'btn btn-small', text: 'Mettre à jour', onclick: () => setAll('maj') }),
          h('span', { class: 'muted small', text: '  La mise à jour ne modifie ni le statut, ni le PV, ni le BR.' })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid small' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Collaborateur' }), h('th', { text: 'Commande' }), h('th', { text: 'Différences' }), h('th', { text: 'Action' }))),
          h('tbody', {}, dupRows)))) : null,
      invalid.length ? h('details', {},
        h('summary', { text: 'Voir les lignes ignorées' }),
        h('ul', { class: 'small' }, invalid.map((r) => h('li', { text: `Ligne ${r.rowNumber} : ${r.errors.join(', ')}` })))) : null),
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Importer', variant: 'primary', onClick: () => {
        const toUpdate = realDups.filter((d) => choices.get(d) === 'maj');
        if (!plan.nouvelles.length && !toUpdate.length) throw new Error('Rien à importer (toutes les lignes sont ignorées).');
        return { toUpdate };
      } },
    ],
  });
}

/* ---------- Étape 3 : application ---------- */

async function applyImport(file, mois, mapping, plan, { toUpdate }, nbInvalid) {
  const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || ['.xlsx'])[0].toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const copyPath = `imports/${mois}_${fileStamp(new Date(), true)}_${safeFilePart(baseName, 60)}${ext}`;
  try {
    await S.copyInto(state.dir, copyPath, file);
  } catch (e) {
    return toast(`Copie du fichier dans imports/ impossible : ${e.message}`, 'error', 8000);
  }
  const remember = mapping._remember;
  delete mapping._remember;
  const importId = globalThis.crypto.randomUUID();
  try {
    await mutate((d) => {
      for (const r of plan.nouvelles) d.lignes.push(M.createLine(r.fields, { mois, importId, source: r.source }));
      for (const dup of toUpdate) M.updateFromImport(dup.existing, dup.incoming.fields, importId);
      if (remember) d.config.importMapping = mapping;
      d.imports.push({
        id: importId,
        date: new Date().toISOString(),
        mois,
        fichierOrigine: file.name,
        copie: copyPath,
        lignesCreees: plan.nouvelles.length,
        lignesMisesAJour: toUpdate.length,
        lignesIgnorees: plan.doublons.length - toUpdate.length + nbInvalid,
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

// Point d'entrée : démarrage, accès au dossier de travail, tableau de bord du mois, export.

import { h, clear, toast } from './ui.js';
import { state, subscribe, notify, openWorkdir, setReadOnly, APP_VERSION } from './store.js';
import * as S from './storage.js';
import * as M from './model.js';
import { STATUTS, STATUT_LABELS, CYCLE } from './schema.js';
import { formatEuro, monthLabel, addMonths, currentMonth, formatDate } from './format.js';
import { buildExport } from './excel.js';
import { startImport } from './import-ui.js';
import { depositPV, openPV, validateLine, sapSheet, lineDetail, addLine, statusBadge, ecartView } from './line-ui.js';
import { openSettings } from './settings-ui.js';
import { initServiceWorker, initInstallButton } from './update.js';

const $ = (id) => document.getElementById(id);

/* ---------- Démarrage ---------- */

async function boot() {
  $('appVersion').textContent = `${APP_VERSION.version} (${APP_VERSION.date})`;
  initServiceWorker();
  initInstallButton($('btnInstall'));
  bindToolbar();
  preventFileDropOutsideRows();
  subscribe(render);

  if (!S.isSupported()) {
    showWelcome('unsupported');
    return;
  }

  // Une seule fenêtre en écriture à la fois (onglet + application installée par exemple).
  const exclusive = await acquireInstanceLock();
  if (!exclusive) {
    setReadOnly('l\'application est déjà ouverte dans une autre fenêtre. Fermez-la puis rechargez celle-ci pour modifier les données.');
  }

  const saved = await S.getSavedDir();
  if (!saved) return showWelcome('first');
  if (await S.checkPermission(saved)) return open(saved);
  showWelcome('permission', saved);
}

function acquireInstanceLock() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request('suivi-pv-instance', { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return null; }
      resolve(true);
      return new Promise(() => {}); // verrou conservé tant que la page est ouverte
    });
  });
}

async function open(dir) {
  try {
    const r = await openWorkdir(dir);
    if (r.created) toast(`Dossier initialisé : ${dir.name}/data.json créé.`, 'success');
    if (r.backup) toast(`Données mises à jour vers le nouveau format. Ancien fichier sauvegardé : ${r.backup}`, 'info', 8000);
    showDashboard();
  } catch (e) {
    console.error(e);
    showWelcome('error', dir, e.message);
  }
}

async function chooseFolder() {
  try {
    const dir = await S.pickWorkdir();
    await open(dir);
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Accès au dossier impossible : ${e.message}`, 'error', 8000);
  }
}

/* ---------- Écran d'accueil ---------- */

function showWelcome(mode, dir = null, message = '') {
  $('dashboard').hidden = true;
  $('toolbar').hidden = true;
  const w = clear($('welcome'));
  w.hidden = false;
  const card = h('div', { class: 'welcome-card' }, h('img', { src: 'icons/icon.svg', alt: '', class: 'welcome-logo' }), h('h1', { text: 'Suivi PV' }));
  if (mode === 'unsupported') {
    card.append(h('p', { text: 'Ce navigateur ne permet pas d\'accéder à un dossier local. Utilisez Microsoft Edge (ou Chrome) récent sur ordinateur.' }));
  } else if (mode === 'first') {
    card.append(
      h('p', { text: 'Choisissez le dossier de travail où seront rangées toutes les données (par exemple dans votre OneDrive professionnel).' }),
      h('p', { class: 'muted small', text: 'Un sous-dossier « Suivi-PV » y sera créé s\'il n\'existe pas. Les données ne quittent jamais votre poste.' }),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', text: 'Choisir le dossier de travail…', onclick: chooseFolder }));
  } else if (mode === 'permission') {
    card.append(
      h('p', {}, 'Autorisez l\'accès au dossier ', h('strong', { text: dir.name }), ' pour continuer.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', text: `Ouvrir « ${dir.name} »`,
        onclick: async () => { if (await S.checkPermission(dir, true)) open(dir); else toast('Accès refusé.', 'error'); } }),
      h('p', {}, h('button', { type: 'button', class: 'btn btn-ghost', text: 'Choisir un autre dossier…', onclick: chooseFolder })));
  } else if (mode === 'error') {
    card.append(
      h('p', { class: 'error-text', text: message }),
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Réessayer', onclick: () => open(dir) }), ' ',
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Choisir un autre dossier…', onclick: chooseFolder }));
  }
  w.append(card);
  render();
}

function showDashboard() {
  $('welcome').hidden = true;
  $('dashboard').hidden = false;
  $('toolbar').hidden = false;
  render();
}

/* ---------- Barre d'outils ---------- */

function bindToolbar() {
  $('btnImport').addEventListener('click', () => startImport());
  $('btnAddLine').addEventListener('click', () => addLine());
  $('btnExport').addEventListener('click', exportMonth);
  $('btnSettings').addEventListener('click', () => openSettings({ onChangeFolder: async () => {
    document.querySelector('dialog[open] .modal-header .icon-btn')?.click();
    await chooseFolder();
  } }));
  $('monthPrev').addEventListener('click', () => setMonth(addMonths(state.mois, -1)));
  $('monthNext').addEventListener('click', () => setMonth(addMonths(state.mois, 1)));
  $('monthSelect').addEventListener('change', (e) => setMonth(e.target.value));
  $('search').addEventListener('input', (e) => { state.filters.q = e.target.value; renderTable(); });
  $('filterFournisseur').addEventListener('change', (e) => { state.filters.fournisseur = e.target.value; render(); });
  $('filterStatut').addEventListener('change', (e) => { state.filters.statut = e.target.value; render(); });
  $('filterReset').addEventListener('click', () => { state.filters = { q: '', fournisseur: '', statut: '' }; render(); });
}

function setMonth(m) {
  state.mois = m;
  state.filters.fournisseur = '';
  notify();
}

/* ---------- Rendu ---------- */

function render() {
  renderFooter();
  renderReadOnly();
  if (!state.data || $('dashboard').hidden) return;
  renderMonthSelect();
  const lines = M.linesForMonth(state.data.lignes, state.mois);
  renderCounters(lines);
  renderTodo(lines);
  renderFilters(lines);
  renderTable();
  for (const id of ['btnImport', 'btnAddLine']) $(id).disabled = state.readOnly;
  $('btnExport').disabled = !lines.length;
}

function renderFooter() {
  const s = state.save;
  const el = $('saveStatus');
  el.className = `save-status save-${s.status}`;
  el.textContent = {
    idle: state.data ? 'Données chargées' : '',
    saving: 'Enregistrement…',
    saved: `Enregistré à ${s.at?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    error: `Erreur d'enregistrement : ${s.error}`,
  }[s.status];
  $('folderName').textContent = state.dir ? `Dossier : ${state.dir.name}` : '';
}

function renderReadOnly() {
  const b = $('readonlyBanner');
  b.hidden = !state.readOnly;
  if (state.readOnly) b.textContent = `Lecture seule : ${state.readOnlyReason}`;
}

function renderMonthSelect() {
  const months = new Set(M.monthsInData(state.data.lignes));
  months.add(currentMonth());
  months.add(state.mois);
  const sel = $('monthSelect');
  sel.replaceChildren(...[...months].sort().reverse().map((m) => {
    const n = state.data.lignes.filter((l) => l.mois === m).length;
    return h('option', { value: m, selected: m === state.mois, text: `${monthLabel(m)}${n ? ` (${n})` : ''}` });
  }));
}

function renderCounters(lines) {
  const c = M.countByStatus(lines);
  const t = M.totals(lines);
  const done = c.br_cree;
  const pct = c.total ? Math.round((done / c.total) * 100) : 0;
  const cards = [...CYCLE, STATUTS.LITIGE].map((s) => h('button', {
    type: 'button',
    class: `counter counter-${s} ${state.filters.statut === s ? 'active' : ''}`,
    title: `Filtrer : ${STATUT_LABELS[s]}`,
    onclick: () => { state.filters.statut = state.filters.statut === s ? '' : s; render(); },
  }, h('span', { class: 'counter-value', text: c[s] }), h('span', { class: 'counter-label', text: STATUT_LABELS[s] })));
  clear($('counters')).append(
    h('div', { class: 'counter-cards' }, cards),
    h('div', { class: 'progress-box' },
      h('div', { class: 'progress-text' },
        h('strong', { text: `${done} / ${c.total}` }), ' BR créés',
        h('span', { class: 'muted', text: ` — attendu ${formatEuro(t.attendu)}, PV reçus ${formatEuro(t.pv)}` })),
      h('div', { class: 'progress', role: 'progressbar', attrs: { 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 } },
        h('div', { class: 'progress-bar' }))));
  // Largeur via le CSSOM (autorisé par la politique de sécurité, contrairement à l'attribut style)
  $('counters').querySelector('.progress-bar').style.width = `${pct}%`;
}

function renderTodo(lines) {
  const c = M.countByStatus(lines);
  const items = M.TODO_GROUPS.filter((g) => c[g.statut] > 0);
  const box = clear($('todo'));
  if (!lines.length) {
    box.append(h('p', { class: 'empty' }, `Aucune ligne pour ${monthLabel(state.mois)}. `,
      state.readOnly ? null : h('button', { type: 'button', class: 'btn btn-primary', text: 'Importer l\'export Abraxio…', onclick: () => startImport() })));
    return;
  }
  if (!items.length) {
    box.append(h('p', { class: 'todo-done', text: `Tout est traité pour ${monthLabel(state.mois)} ✓` }));
    return;
  }
  box.append(h('span', { class: 'todo-title', text: 'À faire :' }),
    ...items.map((g) => h('button', {
      type: 'button',
      class: `chip chip-${g.statut} ${state.filters.statut === g.statut ? 'active' : ''}`,
      onclick: () => { state.filters.statut = state.filters.statut === g.statut ? '' : g.statut; render(); },
    }, `${g.label} `, h('span', { class: 'chip-count', text: c[g.statut] }))));
}

function renderFilters(lines) {
  const fournisseurs = [...new Set(lines.map((l) => l.fournisseur))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (state.filters.fournisseur && !fournisseurs.includes(state.filters.fournisseur)) state.filters.fournisseur = '';
  $('filterFournisseur').replaceChildren(h('option', { value: '', text: 'Tous les fournisseurs' }),
    ...fournisseurs.map((f) => h('option', { value: f, text: f, selected: f === state.filters.fournisseur })));
  $('filterStatut').replaceChildren(h('option', { value: '', text: 'Tous les statuts' }),
    ...Object.entries(STATUT_LABELS).map(([k, v]) => h('option', { value: k, text: v, selected: k === state.filters.statut })));
  if ($('search').value !== state.filters.q) $('search').value = state.filters.q;
  const active = state.filters.q || state.filters.fournisseur || state.filters.statut;
  $('filterReset').hidden = !active;
}

function renderTable() {
  if (!state.data) return;
  const all = M.linesForMonth(state.data.lignes, state.mois);
  const lines = M.sortLines(M.filterLines(all, state.filters));
  const tbody = clear($('linesBody'));
  $('resultCount').textContent = all.length ? `${lines.length} ligne(s) sur ${all.length}` : '';
  if (!lines.length && all.length) {
    tbody.append(h('tr', {}, h('td', { colSpan: 8, class: 'empty', text: 'Aucune ligne ne correspond aux filtres.' })));
    return;
  }
  for (const l of lines) tbody.append(lineRow(l));
}

function mainAction(l) {
  if (state.readOnly) return null;
  const btn = (label, fn, variant = '') => h('button', { type: 'button', class: `btn btn-small ${variant}`, text: label,
    onclick: (e) => { e.stopPropagation(); fn(); } });
  switch (l.statut) {
    case STATUTS.ATTENDU: return btn('Déposer le PV…', () => depositPV(l.id));
    case STATUTS.PV_RECU: return btn('Valider', () => validateLine(l.id), 'btn-primary');
    case STATUTS.VALIDE: return btn('Prêt pour SAP', () => sapSheet(l.id), 'btn-primary');
    case STATUTS.BR_CREE: return h('span', { class: 'muted small', text: `BR ${l.numeroBR}${l.dateBR ? ` du ${formatDate(l.dateBR)}` : ''}` });
    case STATUTS.LITIGE: return btn('Voir le litige', () => lineDetail(l.id), 'btn-warn');
    default: return null;
  }
}

function lineRow(l) {
  const pvBtn = l.fichierPV
    ? h('button', { type: 'button', class: 'icon-btn pv-open', title: `Ouvrir le PV (${l.fichierPV})`, attrs: { 'aria-label': 'Ouvrir le PV' },
      onclick: (e) => { e.stopPropagation(); openPV(l.id); } }, 'PDF')
    : null;
  const tr = h('tr', {
    class: `row row-${l.statut} ${M.hasEcart(l, Number(state.data.config.toleranceEcart) || 0) ? 'row-ecart' : ''}`,
    dataset: { id: l.id },
    tabIndex: 0,
    title: state.readOnly ? '' : 'Cliquer pour le détail — glisser un PDF ici pour déposer le PV',
    onclick: () => lineDetail(l.id),
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === tr) lineDetail(l.id); },
  },
  h('td', {}, h('div', { class: 'cell-main', text: l.collaborateur }), l.commentaire ? h('div', { class: 'cell-sub', text: l.commentaire }) : null),
  h('td', { text: l.fournisseur }),
  h('td', {}, h('div', { text: l.commande }), l.poste ? h('div', { class: 'cell-sub', text: `poste ${l.poste}` }) : null),
  h('td', { class: 'num', text: formatEuro(l.montantAttendu) }),
  h('td', { class: 'num' }, l.montantPV === null ? h('span', { class: 'muted', text: '—' }) : formatEuro(l.montantPV)),
  h('td', { class: 'num' }, ecartView(l)),
  h('td', {}, statusBadge(l.statut)),
  h('td', { class: 'actions' }, pvBtn, mainAction(l)));

  if (!state.readOnly) {
    tr.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      tr.classList.add('drop-target');
    });
    tr.addEventListener('dragleave', (e) => { if (!tr.contains(e.relatedTarget)) tr.classList.remove('drop-target'); });
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tr.classList.remove('drop-target');
      const file = e.dataTransfer.files[0];
      if (file) depositPV(l.id, file);
    });
  }
  return tr;
}

/** Empêche le navigateur d'ouvrir un fichier lâché à côté d'une ligne. */
function preventFileDropOutsideRows() {
  document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    if (!state.data) return;
    const f = e.dataTransfer.files[0];
    if (/\.(xlsx|xls|xlsm|csv)$/i.test(f.name)) startImport(f);
    else toast('Déposez le PDF directement sur la ligne du collaborateur concerné.', 'warn');
  });
}

/* ---------- Export ---------- */

async function exportMonth() {
  const lines = M.linesForMonth(state.data.lignes, state.mois);
  if (!lines.length) return;
  const bytes = buildExport(lines, state.mois);
  const name = `Suivi-PV_${state.mois}.xlsx`;
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        startIn: state.dir || 'documents',
        types: [{ description: 'Classeur Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      toast(`Export enregistré : ${handle.name}`, 'success');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('showSaveFilePicker indisponible, téléchargement classique.', e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- Avertissement en quittant pendant un enregistrement ---------- */

window.addEventListener('beforeunload', (e) => {
  if (state.save.status === 'saving' || state.save.status === 'error') {
    e.preventDefault();
    e.returnValue = '';
  }
});

boot();

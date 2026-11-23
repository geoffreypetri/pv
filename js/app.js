// Point d'entrée : démarrage, accès au dossier de travail, vue « à plat » filtrable, export.

import { h, clear, toast, copyable, icon, multiSelect } from './ui.js';
import { state, subscribe, openWorkdir, setReadOnly, APP_VERSION, defaultFilters } from './store.js';
import * as S from './storage.js';
import * as M from './model.js';
import { STATUTS, STATUT_LABELS, CYCLE } from './schema.js';
import { formatEuro, monthLabel, currentMonth, formatJours } from './format.js';
import { buildExport } from './excel.js';
import { startImport } from './import-ui.js';
import { depositPV, openPV, validateLine, sapSheet, lineDetail, addLine, statusBadge, ecartView, alerteText } from './line-ui.js';
import { openSettings } from './settings-ui.js';
import { initServiceWorker } from './update.js';

const $ = (id) => document.getElementById(id);

/* ---------- Démarrage ---------- */

async function boot() {
  $('appVersion').textContent = `${APP_VERSION.version} (${APP_VERSION.date})`;
  initServiceWorker();
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
    state.filters = defaultFilters();
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

/* ---------- Barre d'outils et filtres ---------- */

const TOLERANCE = () => Number(state.data?.config?.toleranceEcart) || 0;
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const shortMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
};

let msMois, msFournisseurs, msStatuts;

function bindToolbar() {
  for (const b of document.querySelectorAll('[data-icon]')) b.prepend(icon(b.dataset.icon));
  $('btnImport').addEventListener('click', () => startImport());
  $('btnAddLine').addEventListener('click', () => addLine());
  $('btnExport').addEventListener('click', exportView);
  $('btnSettings').addEventListener('click', () => openSettings({ onChangeFolder: async () => {
    document.querySelector('dialog[open] .modal-header .btn')?.click();
    await chooseFolder();
  } }));

  const search = $('search');
  search.parentElement.prepend(icon('search', { size: 16 }));
  search.addEventListener('input', () => { state.filters.q = search.value; renderView(); });
  $('filterAnnee').addEventListener('change', (e) => { state.filters.annee = e.target.value; state.filters.mois = []; renderView(); });
  msMois = multiSelect({ label: 'Mois', allLabel: 'Tous', onChange: (v) => { state.filters.mois = v; renderView(); } });
  msFournisseurs = multiSelect({ label: 'Fournisseur', allLabel: 'Tous', onChange: (v) => { state.filters.fournisseurs = v; renderView(); } });
  msStatuts = multiSelect({ label: 'Statut', allLabel: 'Tous', onChange: (v) => { state.filters.statuts = v; renderView(); } });
  $('filterMois').replaceWith(msMois.el);
  $('filterFournisseurs').replaceWith(msFournisseurs.el);
  $('filterStatuts').replaceWith(msStatuts.el);
  $('filterAlertes').addEventListener('change', (e) => { state.filters.alertes = e.target.checked; renderView(); });
  $('filterReset').addEventListener('click', () => { state.filters = { ...defaultFilters(), annee: '' }; renderView(); });
}

/* ---------- Rendu ---------- */

function render() {
  renderFooter();
  renderReadOnly();
  if (!state.data || $('dashboard').hidden) return;
  for (const id of ['btnImport', 'btnAddLine']) $(id).disabled = state.readOnly;
  renderView();
}

/** Lignes après tous les filtres sauf `except` (pour proposer les valeurs disponibles). */
function filtered(except = null) {
  const f = { ...state.filters };
  if (except) f[except] = Array.isArray(f[except]) ? [] : except === 'alertes' ? false : '';
  return M.filterLines(state.data.lignes, f);
}

function renderView() {
  if (!state.data) return;
  renderFilters();
  const visible = filtered();
  renderSummary(filtered('statuts'));
  renderTodo(filtered('statuts'));
  renderTable(visible);
  $('btnExport').disabled = !visible.length;
}

function renderFilters() {
  const f = state.filters;
  const lines = state.data.lignes;
  const years = M.yearsInData(lines);
  const current = currentMonth().slice(0, 4);
  if (!years.includes(current)) years.unshift(current);
  if (f.annee && !years.includes(f.annee)) years.push(f.annee);
  $('filterAnnee').replaceChildren(h('option', { value: '', text: 'Toutes les années' }),
    ...years.sort().reverse().map((y) => h('option', { value: y, text: `Année ${y}`, selected: y === f.annee })));
  if (!f.annee) $('filterAnnee').value = '';

  const count = (arr, key) => arr.reduce((m, l) => m.set(key(l), (m.get(key(l)) || 0) + 1), new Map());
  const forMois = count(filtered('mois'), (l) => l.mois);
  msMois.setOptions([...forMois.keys()].sort().reverse().map((m) => ({
    value: m, label: capitalize(f.annee ? monthLabel(m).replace(/ \d{4}$/, '') : monthLabel(m)), short: shortMonth(m), count: forMois.get(m),
  })), f.mois);
  const forF = count(filtered('fournisseurs'), (l) => l.fournisseur);
  msFournisseurs.setOptions([...forF.keys()].sort((a, b) => a.localeCompare(b, 'fr')).map((x) => ({ value: x, label: x, count: forF.get(x) })), f.fournisseurs);
  const forS = count(filtered('statuts'), (l) => l.statut);
  msStatuts.setOptions(Object.entries(STATUT_LABELS).map(([k, v]) => ({ value: k, label: v, count: forS.get(k) || 0 })), f.statuts);

  const nbAlertes = filtered('alertes').filter((l) => l.alerteAbraxio).length;
  $('filterAlertesWrap').hidden = !nbAlertes && !f.alertes;
  $('filterAlertes').checked = f.alertes;
  $('filterAlertesLabel').textContent = `Alertes Abraxio (${nbAlertes})`;
  if ($('search').value !== f.q) $('search').value = f.q;
  const d = defaultFilters();
  $('filterReset').hidden = f.q === d.q && f.annee === d.annee && !f.mois.length && !f.fournisseurs.length && !f.statuts.length && !f.alertes;
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

function renderSummary(lines) {
  const c = M.countByStatus(lines);
  const t = M.totals(lines);
  const pct = c.total ? Math.round((c.br_cree / c.total) * 100) : 0;
  const sel = new Set(state.filters.statuts);
  const toggle = (s) => {
    const set = new Set(state.filters.statuts);
    if (set.size === 1 && set.has(s)) set.clear(); else { set.clear(); set.add(s); }
    state.filters.statuts = [...set];
    renderView();
  };
  const cards = [...CYCLE, STATUTS.LITIGE].map((s) => h('button', {
    type: 'button',
    class: `counter counter-${s} ${sel.size === 1 && sel.has(s) ? 'active' : ''}`,
    title: `Filtrer : ${STATUT_LABELS[s]}`,
    onclick: () => toggle(s),
  }, h('span', { class: 'counter-value', text: c[s] }), h('span', { class: 'counter-label', text: STATUT_LABELS[s] })));
  const bar = h('div', { class: 'progress-bar' });
  bar.style.width = `${pct}%`;
  clear($('summary')).append(
    h('div', { class: 'counter-cards' }, cards),
    h('div', { class: 'progress-box' },
      h('div', { class: 'progress-text' },
        h('strong', { text: `${c.br_cree} / ${c.total}` }), ' BR créés',
        h('span', { class: 'muted', text: ` · attendu ${formatEuro(t.attendu)} · PV reçus ${formatEuro(t.pv)}` })),
      h('div', { class: 'progress', role: 'progressbar', attrs: { 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 } }, bar)));
}

function renderTodo(lines) {
  const c = M.countByStatus(lines);
  const items = M.TODO_GROUPS.filter((g) => c[g.statut] > 0);
  const box = clear($('todo'));
  if (!state.data.lignes.length) {
    box.append(h('div', { class: 'empty-state' },
      h('p', { text: 'Aucune ligne pour l\'instant.' }),
      state.readOnly ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => startImport() }, icon('upload'), 'Importer l\'export Abraxio')));
    return;
  }
  if (!lines.length) return;
  if (!items.length) {
    box.append(h('p', { class: 'todo-done' }, icon('check'), ' Tout est traité dans cette sélection'));
    return;
  }
  const sel = state.filters.statuts;
  box.append(h('span', { class: 'todo-title', text: 'À faire' }),
    ...items.map((g) => h('button', {
      type: 'button',
      class: `chip chip-${g.statut} ${sel.length === 1 && sel[0] === g.statut ? 'active' : ''}`,
      onclick: () => { state.filters.statuts = sel.length === 1 && sel[0] === g.statut ? [] : [g.statut]; renderView(); },
    }, g.label, h('span', { class: 'chip-count', text: c[g.statut] }))));
}

const COLUMNS = [
  { key: 'collaborateur', label: 'Collaborateur' },
  { key: 'fournisseur', label: 'Fournisseur' },
  { key: 'commande', label: 'Commande' },
  { key: 'montantAttendu', label: 'Attendu', num: true },
  { key: 'montantPV', label: 'Montant PV', num: true },
  { key: 'ecart', label: 'Écart', num: true },
  { key: 'statut', label: 'Statut' },
  { key: null, label: '' },
];

function renderHead() {
  const { key, dir } = state.sort;
  $('linesHead').replaceChildren(...COLUMNS.map((c) => {
    if (!c.key) return h('th', { class: 'actions' });
    const active = key === c.key;
    const btn = h('button', { type: 'button', class: `th-sort ${active ? 'active' : ''}`, title: 'Trier' },
      c.label, icon(active && dir === 'desc' ? 'chevronDown' : 'chevronUp', { size: 12 }));
    btn.addEventListener('click', () => {
      if (!active) state.sort = { key: c.key, dir: c.num ? 'desc' : 'asc' };
      else if (dir === (c.num ? 'desc' : 'asc')) state.sort = { key: c.key, dir: c.num ? 'asc' : 'desc' };
      else state.sort = { key: null, dir: 'asc' };
      renderView();
    });
    return h('th', { class: c.num ? 'num' : '', attrs: { 'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' } }, btn);
  }));
}

/** Mois repliés dans le tableau (état de la session). */
const collapsed = new Set();

function renderTable(visible) {
  renderHead();
  // Tri demandé à l'intérieur de chaque mois ; les mois du plus récent au plus ancien (tri stable).
  const lines = M.sortLines(visible, state.sort).sort((a, b) => b.mois.localeCompare(a.mois));
  const tbody = clear($('linesBody'));
  const total = state.data.lignes.length;
  $('resultCount').textContent = total ? `${lines.length} ligne${lines.length > 1 ? 's' : ''} sur ${total}.` : '';
  if (!lines.length && total) {
    tbody.append(h('tr', {}, h('td', { colSpan: COLUMNS.length, class: 'empty' }, 'Aucune ligne ne correspond aux filtres. ',
      h('button', { type: 'button', class: 'link-btn', text: 'Réinitialiser les filtres', onclick: () => $('filterReset').click() }))));
    return;
  }
  const frag = document.createDocumentFragment();
  let i = 0;
  while (i < lines.length) {
    const mois = lines[i].mois;
    let j = i;
    while (j < lines.length && lines[j].mois === mois) j++;
    const group = lines.slice(i, j);
    frag.append(groupRow(mois, group));
    if (!collapsed.has(mois)) for (const l of group) frag.append(lineRow(l));
    i = j;
  }
  tbody.append(frag);
}

function groupRow(mois, group) {
  const c = M.countByStatus(group);
  const t = M.totals(group);
  const open = !collapsed.has(mois);
  const tr = h('tr', { class: `group-row ${open ? 'open' : ''}`, tabIndex: 0, attrs: { 'aria-expanded': String(open) } },
    h('td', { colSpan: COLUMNS.length },
      h('div', { class: 'group-head' },
        icon('chevronDown', { size: 14 }),
        h('span', { class: 'group-title', text: capitalize(monthLabel(mois)) }),
        h('span', { class: 'group-meta', text: `${group.length} ligne${group.length > 1 ? 's' : ''} · ${formatEuro(t.attendu)} · ${c.br_cree}/${group.length} BR créés` }))));
  const toggle = () => { if (open) collapsed.add(mois); else collapsed.delete(mois); renderTable(filtered()); };
  tr.addEventListener('click', toggle);
  tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  return tr;
}

function mainAction(l) {
  if (state.readOnly) return null;
  const btn = (label, fn, variant = '') => h('button', { type: 'button', class: `btn btn-sm ${variant}`, text: label,
    onclick: (e) => { e.stopPropagation(); fn(); } });
  switch (l.statut) {
    case STATUTS.ATTENDU: return btn('Déposer le PV', () => depositPV(l.id));
    case STATUTS.PV_RECU: return btn('Valider', () => validateLine(l.id), 'btn-primary');
    case STATUTS.VALIDE: return btn('Prêt pour SAP', () => sapSheet(l.id), 'btn-primary');
    case STATUTS.BR_CREE: return h('span', { class: 'br-cell' }, h('span', { class: 'muted', text: 'BR ' }), copyable(l.numeroBR, { label: 'Copier le n° de BR' }));
    case STATUTS.LITIGE: return btn('Voir le litige', () => lineDetail(l.id), 'btn-danger-ghost');
    default: return null;
  }
}

function lineRow(l) {
  const pvBtn = l.fichierPV
    ? h('button', { type: 'button', class: 'btn btn-icon btn-sm btn-ghost', title: `Ouvrir le PV (${l.fichierPV})`, attrs: { 'aria-label': 'Ouvrir le PV' },
      onclick: (e) => { e.stopPropagation(); openPV(l.id); } }, icon('file'))
    : h('span', { class: 'btn-icon-placeholder' });
  const tr = h('tr', {
    class: `row row-${l.statut} ${M.hasEcart(l, TOLERANCE()) ? 'row-ecart' : ''} ${l.alerteAbraxio ? 'row-alerte' : ''}`,
    dataset: { id: l.id },
    tabIndex: 0,
    onclick: () => lineDetail(l.id),
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === tr) lineDetail(l.id); },
  },
  h('td', {}, h('div', { class: 'cell-main', text: l.collaborateur }), l.commentaire ? h('div', { class: 'cell-sub', text: l.commentaire }) : null),
  h('td', { text: l.fournisseur }),
  h('td', {}, copyable(l.commande, { label: 'Copier le n° de commande' }), l.poste ? h('div', { class: 'cell-sub', title: l.poste, text: l.poste }) : null),
  h('td', { class: 'num' }, h('div', { text: formatEuro(l.montantAttendu) }),
    l.jours !== null ? h('div', { class: 'cell-sub', title: l.details?.length ? `Somme de ${l.details.length} imputation(s)` : '', text: `${formatJours(l.jours)}${l.details?.length > 1 ? ` · ${l.details.length} lignes` : ''}` }) : null),
  h('td', { class: 'num' }, l.montantPV === null ? h('span', { class: 'muted', text: '—' }) : formatEuro(l.montantPV)),
  h('td', { class: 'num' }, ecartView(l)),
  h('td', {}, h('span', { class: 'status-cell' }, statusBadge(l.statut), alerteIcon(l))),
  h('td', { class: 'actions' }, h('div', { class: 'actions-inner' }, pvBtn, mainAction(l))));

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

function alerteIcon(l) {
  if (!l.alerteAbraxio) return null;
  return h('span', { class: 'alerte', title: alerteText(l) }, icon('alert', { size: 14 }));
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

/* ---------- Export de la vue filtrée ---------- */

function exportLabel() {
  const f = state.filters;
  if (f.mois.length === 1) return f.mois[0];
  return f.annee || 'tout';
}

async function exportView() {
  const lines = M.sortLines(filtered(), state.sort);
  if (!lines.length) return;
  const label = exportLabel();
  const bytes = buildExport(lines, label);
  const name = `Suivi-PV_${label}.xlsx`;
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
      toast(`Export enregistré : ${handle.name} (${lines.length} lignes)`, 'success');
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

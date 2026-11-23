// Paramètres : dossier de travail, tolérance d'écart, modèles d'URL SAP, correspondance d'import, sauvegarde.

import { h, modal, field, toast, confirmDialog } from './ui.js';
import { state, mutate, APP_VERSION } from './store.js';
import * as S from './storage.js';
import { SCHEMA_VERSION, IMPORT_FIELDS } from './schema.js';
import { parseAmount, fileStamp, formatDateTime } from './format.js';

export async function openSettings({ onChangeFolder }) {
  const cfg = state.data.config;
  const ro = state.readOnly;
  const tol = h('input', { type: 'text', inputMode: 'decimal', class: 'input-narrow', value: String(cfg.toleranceEcart ?? 0).replace('.', ','), disabled: ro });
  const sapCmd = h('input', { type: 'text', value: cfg.sapUrlTemplates?.commande || '', placeholder: 'https://…{commande}…', disabled: ro });
  const sapBr = h('input', { type: 'text', value: cfg.sapUrlTemplates?.br || '', placeholder: 'https://…{br}…', disabled: ro });
  const mapping = cfg.importMapping || {};
  const lastImports = [...state.data.imports].slice(-5).reverse();

  const backupBtn = h('button', { type: 'button', class: 'btn btn-sm', text: 'Créer une copie de sauvegarde maintenant', disabled: ro,
    onclick: async () => {
      try {
        const name = `data.backup-${fileStamp()}.json`;
        await S.writeJson(state.dir, name, state.data);
        toast(`Copie enregistrée : ${name}`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    } });

  const resetMapping = h('button', { type: 'button', class: 'btn btn-sm', text: 'Oublier la correspondance', disabled: ro || !Object.keys(mapping).length,
    onclick: async () => {
      if (!(await confirmDialog('La correspondance des colonnes sera redemandée au prochain import.'))) return;
      await mutate((d) => { d.config.importMapping = {}; });
      resetMapping.disabled = true;
      mapList.replaceWith(h('p', { class: 'muted', text: 'Aucune correspondance mémorisée.' }));
    } });

  const mapList = Object.keys(mapping).length
    ? h('dl', { class: 'summary' }, IMPORT_FIELDS.filter((f) => mapping[f.key]).flatMap((f) => [h('dt', { text: f.label }), h('dd', { text: mapping[f.key] })]))
    : h('p', { class: 'muted', text: 'Aucune correspondance mémorisée.' });

  await modal({
    title: 'Paramètres',
    wide: true,
    body: h('div', { class: 'settings' },
      h('h3', { text: 'Dossier de travail' }),
      h('p', {}, h('strong', { text: state.dir?.name || '—' }),
        h('span', { class: 'muted small', text: `  — ${state.data.lignes.length} lignes, ${state.data.imports.length} imports, format de données v${SCHEMA_VERSION}` })),
      h('p', {}, h('button', { type: 'button', class: 'btn btn-sm', text: 'Changer de dossier…', onclick: () => onChangeFolder() }), ' ', backupBtn),
      h('h3', { text: 'Contrôle des montants' }),
      field('Écart toléré (€)', tol, 'Un écart PV / attendu inférieur ou égal à cette valeur n\'est pas signalé. 0 = tout écart est signalé.'),
      h('h3', { text: 'Liens SAP (facultatif)' }),
      h('p', { class: 'muted small', text: 'Modèles d\'URL stockés uniquement dans data.json. Variables disponibles : {commande}, {poste}, {br}.' }),
      h('div', { class: 'form-grid' }, field('Ouvrir une commande', sapCmd), field('Ouvrir un BR', sapBr)),
      h('h3', { text: 'Correspondance des colonnes d\'import' }),
      mapList,
      h('p', {}, resetMapping),
      lastImports.length ? h('div', {},
        h('h3', { text: 'Derniers imports' }),
        h('ul', { class: 'small' }, lastImports.map((i) => h('li', { text: `${formatDateTime(i.date)} — ${Array.isArray(i.mois) ? `${i.mois[0]} → ${i.mois.at(-1)}` : i.mois} — ${i.fichierOrigine} : ${i.lignesCreees} créée(s), ${i.lignesMisesAJour} mise(s) à jour${i.absentes ? `, ${i.absentes} absente(s)` : ''}` })))) : null,
      h('p', { class: 'muted small', text: `Suivi PV ${APP_VERSION.version} (${APP_VERSION.date})` })),
    buttons: ro ? [{ label: 'Fermer', value: null }] : [
      { label: 'Fermer', value: null },
      { label: 'Enregistrer', variant: 'primary', onClick: async () => {
        const t = parseAmount(tol.value);
        if (t === null || Number.isNaN(t) || t < 0) throw new Error('Écart toléré invalide.');
        await mutate((d) => {
          d.config.toleranceEcart = t;
          d.config.sapUrlTemplates = { commande: sapCmd.value.trim(), br: sapBr.value.trim() };
        });
        toast('Paramètres enregistrés.', 'success');
      } },
    ],
  });
}

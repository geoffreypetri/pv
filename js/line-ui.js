// Actions sur une ligne : dépôt de PV, ouverture, validation, fiche « Prêt pour SAP », détail.

import { h, modal, confirmDialog, field, copyText, toast, pickFile } from './ui.js';
import { state, mutate, assertWritable, findLine } from './store.js';
import * as S from './storage.js';
import * as M from './model.js';
import { STATUTS, STATUT_LABELS } from './schema.js';
import { formatEuro, formatForSap, formatDate, formatDateTime, parseAmount, monthLabel, isoDay, isValidMonth } from './format.js';

const tolerance = () => Number(state.data?.config?.toleranceEcart) || 0;

export function statusBadge(statut) {
  return h('span', { class: `badge badge-${statut}`, text: STATUT_LABELS[statut] || statut });
}

/** Élément affichant l'écart (mis en évidence s'il dépasse la tolérance). */
export function ecartView(line) {
  const e = M.computeEcart(line);
  if (e === null) return h('span', { class: 'muted', text: '—' });
  const bad = M.hasEcart(line, tolerance());
  return h('span', { class: bad ? 'ecart ecart-bad' : 'ecart ecart-ok', title: bad ? 'Écart entre PV et montant attendu' : 'Conforme' },
    bad ? `${e > 0 ? '+' : ''}${formatEuro(e)}` : '✓ 0');
}

const isPdf = (file) => file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));

function summary(line) {
  return h('dl', { class: 'summary' },
    h('dt', { text: 'Collaborateur' }), h('dd', { text: line.collaborateur }),
    h('dt', { text: 'Fournisseur' }), h('dd', { text: line.fournisseur }),
    h('dt', { text: 'Commande' }), h('dd', { text: line.commande + (line.poste ? ` / poste ${line.poste}` : '') }),
    h('dt', { text: 'Mois' }), h('dd', { text: monthLabel(line.mois) }),
    h('dt', { text: 'Montant attendu' }), h('dd', { text: formatEuro(line.montantAttendu) }));
}

/** Champ montant avec aperçu de l'écart en direct. */
function amountInput(line, initial) {
  const input = h('input', { type: 'text', inputMode: 'decimal', class: 'amount-input', autocomplete: 'off',
    value: initial === null || initial === undefined ? '' : String(initial).replace('.', ','), placeholder: '0,00' });
  const preview = h('span', { class: 'ecart-preview' });
  const update = () => {
    const m = parseAmount(input.value);
    if (m === null) { preview.textContent = ''; preview.className = 'ecart-preview'; return; }
    if (Number.isNaN(m)) { preview.textContent = 'Montant illisible'; preview.className = 'ecart-preview ecart-bad'; return; }
    const e = M.computeEcart({ montantPV: m, montantAttendu: line.montantAttendu });
    const bad = e !== null && Math.abs(e) > tolerance() + 1e-9;
    preview.textContent = e === null ? '' : bad ? `Écart : ${e > 0 ? '+' : ''}${formatEuro(e)}` : 'Conforme au montant attendu ✓';
    preview.className = `ecart-preview ${bad ? 'ecart-bad' : 'ecart-ok'}`;
  };
  input.addEventListener('input', update);
  update();
  const same = h('button', { type: 'button', class: 'btn btn-small', text: '= montant attendu',
    title: 'Reprendre le montant attendu', onclick: () => { input.value = String(line.montantAttendu ?? '').replace('.', ','); update(); input.focus(); } });
  return { input, wrap: h('div', { class: 'amount-row' }, input, same, preview) };
}

/* ---------- Dépôt de PV ---------- */

/** Chemin libre pour le PV de la ligne (suffixe _2, _3… si un autre PV porte déjà ce nom). */
async function freePvPath(line) {
  for (let i = 1; i < 100; i++) {
    const path = M.pvPath(line, i === 1 ? '' : `_${i}`);
    if (line.fichierPV === path) return path;
    const usedByOther = state.data.lignes.some((l) => l.id !== line.id && l.fichierPV === path);
    if (!usedByOther && !(await S.exists(state.dir, path))) return path;
  }
  throw new Error('Impossible de trouver un nom de fichier libre.');
}

export async function depositPV(lineId, file) {
  try { assertWritable(); } catch (e) { return toast(e.message, 'error'); }
  const line = findLine(lineId);
  if (!line) return;
  if (!file) {
    file = await pickFile('application/pdf,.pdf');
    if (!file) return;
  }
  if (!isPdf(file)) return toast('Seuls les fichiers PDF sont acceptés.', 'error');
  if (![STATUTS.ATTENDU, STATUTS.PV_RECU, STATUTS.LITIGE].includes(line.statut)) {
    return toast(`Cette ligne est au statut « ${STATUT_LABELS[line.statut]} ». Revenez à l'étape précédente (fiche de la ligne) pour remplacer le PV.`, 'error', 7000);
  }
  const target = await freePvPath(line);
  const amount = amountInput(line, line.montantPV);
  const comment = h('textarea', { rows: 2, value: line.commentaire, placeholder: 'Facultatif' });
  const ok = await modal({
    title: 'Dépôt du PV',
    body: h('div', {},
      summary(line),
      h('p', { class: 'file-target' }, h('strong', { text: file.name }), ' sera copié sous ', h('code', { text: target })),
      line.fichierPV ? h('p', { class: 'warning', text: `Un PV est déjà enregistré (${line.fichierPV}) : il sera remplacé.` }) : null,
      field('Montant du PV (€)', amount.wrap),
      field('Commentaire', comment)),
    buttons: [
      { label: 'Annuler', value: false },
      { label: 'Enregistrer le PV', variant: 'primary', onClick: async () => {
        const m = parseAmount(amount.input.value);
        if (m === null || Number.isNaN(m)) throw new Error('Saisissez le montant indiqué sur le PV.');
        await S.copyInto(state.dir, target, file);
        await mutate(() => M.applyPV(line, { fichierPV: target, montantPV: m, commentaire: comment.value.trim() }));
        return true;
      } },
    ],
  });
  if (ok) {
    if (M.hasEcart(line, tolerance())) toast(`PV enregistré — écart de ${formatEuro(M.computeEcart(line))} à vérifier.`, 'warn', 6000);
    else toast('PV enregistré, montant conforme.', 'success');
  }
}

export async function openPV(lineId) {
  const line = findLine(lineId);
  if (!line?.fichierPV) return;
  // La fenêtre est ouverte immédiatement (geste utilisateur) pour ne pas être bloquée.
  const win = window.open('', '_blank');
  try {
    const file = await S.readFile(state.dir, line.fichierPV);
    const url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (e) {
    win?.close();
    toast(e.name === 'NotFoundError' ? `Fichier introuvable : ${line.fichierPV}` : `Ouverture impossible : ${e.message}`, 'error', 7000);
  }
}

/* ---------- Validation et BR ---------- */

export async function validateLine(lineId) {
  try { assertWritable(); } catch (e) { return toast(e.message, 'error'); }
  const line = findLine(lineId);
  if (!line) return;
  if (M.hasEcart(line, tolerance())) {
    const e = M.computeEcart(line);
    const go = await confirmDialog(
      `Le montant du PV (${formatEuro(line.montantPV)}) diffère du montant attendu (${formatEuro(line.montantAttendu)}).\n`
      + `Écart : ${e > 0 ? '+' : ''}${formatEuro(e)}.\n\nValider quand même ?`,
      { title: 'Écart détecté', okLabel: 'Valider malgré l\'écart', danger: true });
    if (!go) return;
  }
  try {
    await mutate(() => M.validate(line));
  } catch (e) {
    return toast(e.message, 'error');
  }
  await sapSheet(lineId);
}

function copyRow(label, value, display = value) {
  const btn = h('button', { type: 'button', class: 'btn btn-small copy-btn', text: 'Copier', disabled: !value });
  btn.addEventListener('click', () => copyText(value, btn));
  return h('div', { class: 'copy-row' },
    h('span', { class: 'copy-label', text: label }),
    h('span', { class: 'copy-value', text: display || '—' }),
    btn);
}

export async function sapSheet(lineId) {
  const line = findLine(lineId);
  if (!line) return;
  const tpl = state.data.config.sapUrlTemplates?.commande;
  const br = h('input', { type: 'text', autocomplete: 'off', placeholder: 'N° du bon de réception', value: line.numeroBR });
  const date = h('input', { type: 'date', value: line.dateBR || isoDay() });
  const editable = line.statut === STATUTS.VALIDE && !state.readOnly;
  const montant = line.montantPV ?? line.montantAttendu;
  await modal({
    title: 'Prêt pour SAP',
    body: h('div', {},
      h('p', { class: 'muted' }, `${line.collaborateur} — ${line.fournisseur} — ${monthLabel(line.mois)}`),
      h('div', { class: 'copy-list' },
        copyRow('N° de commande', line.commande),
        copyRow('Poste', line.poste),
        copyRow('Montant', formatForSap(montant), `${formatEuro(montant)}  (copié : ${formatForSap(montant)})`)),
      tpl ? h('p', {}, h('a', { href: M.fillTemplate(tpl, line), target: '_blank', rel: 'noopener noreferrer', class: 'btn btn-small' }, 'Ouvrir la commande dans SAP ↗')) : null,
      editable
        ? h('div', { class: 'form-grid' }, field('N° de BR', br), field('Date du BR', date))
        : line.numeroBR ? h('p', {}, `BR ${line.numeroBR} du ${formatDate(line.dateBR)}`) : null),
    buttons: editable
      ? [
        { label: 'Plus tard', value: null },
        { label: 'Enregistrer le BR', variant: 'primary', onClick: async () => {
          await mutate(() => M.setBR(line, { numeroBR: br.value, dateBR: date.value }));
          toast(`BR ${line.numeroBR} enregistré.`, 'success');
        } },
      ]
      : [{ label: 'Fermer', value: null }],
  });
}

/* ---------- Litige ---------- */

export async function litige(lineId) {
  try { assertWritable(); } catch (e) { return toast(e.message, 'error'); }
  const line = findLine(lineId);
  if (!line) return;
  if (line.statut === STATUTS.LITIGE) {
    if (await confirmDialog(`Lever le litige et revenir au statut « ${STATUT_LABELS[M.statutAvantLitige(line)]} » ?`, { okLabel: 'Lever le litige' })) {
      await mutate(() => M.leverLitige(line));
    }
    return;
  }
  const motif = h('textarea', { rows: 3, placeholder: 'Ex. : montant contesté, PV non signé…' });
  await modal({
    title: 'Signaler un litige',
    body: h('div', {}, summary(line), field('Motif', motif)),
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Passer en litige', variant: 'danger', onClick: () => mutate(() => {
        const m = motif.value.trim();
        M.setLitige(line, m);
        if (m) line.commentaire = line.commentaire ? `${line.commentaire}\n${m}` : m;
      }) },
    ],
  });
}

/* ---------- Détail / édition d'une ligne ---------- */

function lineForm(line) {
  const f = {
    collaborateur: h('input', { type: 'text', value: line.collaborateur }),
    fournisseur: h('input', { type: 'text', value: line.fournisseur, attrs: { list: 'fournisseurs-list' } }),
    commande: h('input', { type: 'text', value: line.commande }),
    poste: h('input', { type: 'text', value: line.poste }),
    montantAttendu: h('input', { type: 'text', inputMode: 'decimal', value: line.montantAttendu === null ? '' : String(line.montantAttendu).replace('.', ',') }),
    commentaire: h('textarea', { rows: 3, value: line.commentaire }),
  };
  const list = h('datalist', { id: 'fournisseurs-list' },
    [...new Set(state.data.lignes.map((l) => l.fournisseur))].sort().map((x) => h('option', { value: x })));
  const node = h('div', { class: 'form-grid' },
    list,
    field('Collaborateur *', f.collaborateur),
    field('Fournisseur *', f.fournisseur),
    field('N° de commande *', f.commande),
    field('Poste', f.poste),
    field('Montant attendu (€) *', f.montantAttendu),
    h('div', { class: 'span-2' }, field('Commentaire', f.commentaire)));
  const read = () => {
    const v = {
      collaborateur: f.collaborateur.value.trim(),
      fournisseur: f.fournisseur.value.trim(),
      commande: f.commande.value.trim(),
      poste: f.poste.value.trim(),
      montantAttendu: parseAmount(f.montantAttendu.value),
      commentaire: f.commentaire.value.trim(),
    };
    if (!v.collaborateur || !v.fournisseur || !v.commande) throw new Error('Collaborateur, fournisseur et n° de commande sont obligatoires.');
    if (v.montantAttendu === null || Number.isNaN(v.montantAttendu)) throw new Error('Montant attendu invalide.');
    return v;
  };
  if (state.readOnly) Object.values(f).forEach((x) => (x.disabled = true));
  return { node, read, inputs: f };
}

function duplicateOf(fields, mois, exceptId) {
  const key = M.duplicateKey(fields, mois);
  return state.data.lignes.find((l) => l.id !== exceptId && M.duplicateKey(l, l.mois) === key);
}

export async function addLine() {
  try { assertWritable(); } catch (e) { return toast(e.message, 'error'); }
  const form = lineForm(M.createLine({}, { mois: state.mois }));
  const mois = h('input', { type: 'month', value: state.mois, required: true });
  const created = await modal({
    title: 'Ajouter une ligne',
    body: h('div', {}, field('Mois', mois), form.node),
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Ajouter', variant: 'primary', onClick: async () => {
        const v = form.read();
        if (!isValidMonth(mois.value)) throw new Error('Mois invalide.');
        if (duplicateOf(v, mois.value)) throw new Error('Une ligne existe déjà pour ce collaborateur, cette commande et ce mois.');
        const line = M.createLine(v, { mois: mois.value });
        line.commentaire = v.commentaire;
        await mutate((d) => d.lignes.push(line));
        return line;
      } },
    ],
  });
  if (created) toast('Ligne ajoutée.', 'success');
  return created;
}

export async function lineDetail(lineId) {
  const line = findLine(lineId);
  if (!line) return;
  const form = lineForm(line);
  const ro = state.readOnly;

  // Champs spécifiques au statut
  const pvAmount = amountInput(line, line.montantPV);
  const canEditPV = !ro && line.fichierPV && [STATUTS.PV_RECU, STATUTS.LITIGE].includes(line.statut);
  pvAmount.input.disabled = !canEditPV;
  const brNum = h('input', { type: 'text', value: line.numeroBR, disabled: ro || line.statut !== STATUTS.BR_CREE });
  const brDate = h('input', { type: 'date', value: line.dateBR, disabled: ro || line.statut !== STATUTS.BR_CREE });

  // Actions : ferment la fiche puis lancent l'action.
  let next = null;
  const act = (label, fn, variant = '') => h('button', { type: 'button', class: `btn btn-small ${variant ? 'btn-' + variant : ''}`, text: label,
    onclick: () => { next = fn; dlgClose(); } });
  const actions = [];
  if (line.fichierPV) actions.push(h('button', { type: 'button', class: 'btn btn-small', text: 'Ouvrir le PV', onclick: () => openPV(line.id) }));
  if (!ro) {
    if ([STATUTS.ATTENDU, STATUTS.PV_RECU, STATUTS.LITIGE].includes(line.statut)) actions.push(act(line.fichierPV ? 'Remplacer le PV…' : 'Déposer le PV…', () => depositPV(line.id)));
    if (line.statut === STATUTS.PV_RECU) actions.push(act('Valider', () => validateLine(line.id), 'primary'));
    if (line.statut === STATUTS.VALIDE) actions.push(act('Prêt pour SAP / saisir le BR', () => sapSheet(line.id), 'primary'));
    actions.push(line.statut === STATUTS.LITIGE ? act('Lever le litige', () => litige(line.id)) : act('Signaler un litige', () => litige(line.id), 'warn'));
    if (M.previousStatus(line)) {
      actions.push(act(`Revenir à « ${STATUT_LABELS[M.previousStatus(line)]} »`, async () => {
        if (await confirmDialog(line.statut === STATUTS.BR_CREE ? 'Le n° et la date de BR seront effacés. Continuer ?' : 'Revenir à l\'étape précédente ?')) {
          await mutate(() => M.revertStatus(line));
        }
      }));
    }
    actions.push(act('Supprimer la ligne', () => deleteLine(line.id), 'danger-ghost'));
  } else if (line.statut === STATUTS.VALIDE || line.statut === STATUTS.BR_CREE) {
    actions.push(h('button', { type: 'button', class: 'btn btn-small', text: 'Fiche SAP', onclick: () => sapSheet(line.id) }));
  }

  const history = h('ol', { class: 'history' },
    [...line.historique].reverse().map((e) => h('li', {},
      h('time', { text: formatDateTime(e.date) }), ' ', statusBadge(e.statut), e.detail ? h('span', { class: 'muted', text: ` ${e.detail}` }) : null)));

  let dlgClose = () => {};
  const body = h('div', { class: 'detail' },
    h('div', { class: 'detail-head' }, statusBadge(line.statut), ' ', ecartView(line),
      line.fichierPV ? h('code', { class: 'muted small', text: line.fichierPV }) : h('span', { class: 'muted small', text: 'Aucun PV déposé' })),
    h('div', { class: 'detail-actions' }, actions),
    h('h3', { text: 'Informations' }),
    form.node,
    h('h3', { text: 'PV et BR' }),
    h('div', { class: 'form-grid' },
      h('div', { class: 'span-2' }, field('Montant du PV (€)', pvAmount.wrap, canEditPV ? '' : 'Modifiable quand la ligne est « PV reçu » ou « Litige ».')),
      field('N° de BR', brNum),
      field('Date du BR', brDate)),
    h('h3', { text: 'Historique' }),
    history);

  await modal({
    onOpen: (api) => { dlgClose = () => api.close(null); },
    title: `${line.collaborateur} — ${monthLabel(line.mois)}`,
    wide: true,
    body,
    buttons: ro ? [{ label: 'Fermer', value: null }] : [
      { label: 'Fermer', value: null },
      { label: 'Enregistrer', variant: 'primary', onClick: async () => {
        const v = form.read();
        if (duplicateOf(v, line.mois, line.id)) throw new Error('Une autre ligne existe déjà pour ce collaborateur, cette commande et ce mois.');
        let montantPV = line.montantPV;
        if (canEditPV) {
          montantPV = parseAmount(pvAmount.input.value);
          if (montantPV === null || Number.isNaN(montantPV)) throw new Error('Montant du PV invalide.');
        }
        if (line.statut === STATUTS.BR_CREE && !brNum.value.trim()) throw new Error('Numéro de BR obligatoire.');
        await mutate(() => {
          Object.assign(line, v, { montantPV });
          if (line.statut === STATUTS.BR_CREE) { line.numeroBR = brNum.value.trim(); line.dateBR = brDate.value; }
          line.modifieLe = new Date().toISOString();
        });
        toast('Modifications enregistrées.', 'success');
      } },
    ],
  });
  if (next) await next();
}

export async function deleteLine(lineId) {
  const line = findLine(lineId);
  if (!line) return;
  const ok = await confirmDialog(
    `Supprimer définitivement la ligne de ${line.collaborateur} (${monthLabel(line.mois)}) ?`
    + (line.fichierPV ? `\nLe fichier PV (${line.fichierPV}) reste dans le dossier.` : ''),
    { title: 'Supprimer la ligne', okLabel: 'Supprimer', danger: true });
  if (!ok) return;
  await mutate((d) => { d.lignes = d.lignes.filter((l) => l.id !== lineId); });
  toast('Ligne supprimée.');
}

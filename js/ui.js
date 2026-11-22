// Petits utilitaires d'interface : création d'éléments, boîtes de dialogue, notifications.
// Les données utilisateur sont toujours insérées via textContent (jamais innerHTML).

/**
 * h('button', { class: 'btn', onclick: fn, disabled: true }, 'Texte', enfant…)
 * Les clés commençant par « on » sont des écouteurs ; « dataset » et « attrs » sont des objets.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/* ---------- Notifications ---------- */

export function toast(message, type = 'info', ms = 4500) {
  let zone = document.getElementById('toasts');
  if (!zone) {
    zone = h('div', { id: 'toasts', class: 'toasts', attrs: { 'aria-live': 'polite' } });
    document.body.append(zone);
  }
  const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  zone.append(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/* ---------- Boîtes de dialogue ---------- */

/**
 * Ouvre une boîte de dialogue modale.
 * buttons : [{ label, value, variant: 'primary'|'danger'|'', onClick?: async () => valeur | false }]
 * onOpen({ close, dialog }) : appelé à l'ouverture (permet de fermer depuis le contenu).
 *   - onClick retourne false → la boîte reste ouverte ; une exception est affichée dans la boîte.
 * Résout avec la valeur du bouton, ou null si annulée (Échap, bouton Annuler).
 */
export function modal({ title, body, buttons = [{ label: 'Fermer', value: null }], wide = false, className = '', onOpen = null }) {
  return new Promise((resolve) => {
    const error = h('p', { class: 'modal-error', role: 'alert', hidden: true });
    const footer = h('footer', { class: 'modal-actions' });
    const dlg = h('dialog', { class: `modal ${wide ? 'modal-wide' : ''} ${className}` },
      h('header', { class: 'modal-header' },
        h('h2', { text: title }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Fermer', attrs: { 'aria-label': 'Fermer' }, onclick: () => done(null) }, '✕')),
      h('div', { class: 'modal-body' }, body),
      error,
      footer);

    let finished = false;
    function done(value) {
      if (finished) return;
      finished = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    }

    for (const b of buttons) {
      const btn = h('button', { type: 'button', class: `btn ${b.variant ? 'btn-' + b.variant : ''}`, text: b.label });
      btn.addEventListener('click', async () => {
        if (!b.onClick) return done(b.value ?? null);
        error.hidden = true;
        footer.querySelectorAll('button').forEach((x) => (x.disabled = true));
        try {
          const r = await b.onClick();
          if (r === false) return;
          done(r === undefined ? b.value ?? null : r);
        } catch (e) {
          console.debug(e);
          error.textContent = e.message || String(e);
          error.hidden = false;
        } finally {
          footer.querySelectorAll('button').forEach((x) => (x.disabled = false));
        }
      });
      footer.append(btn);
    }

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    // Entrée dans un champ simple = bouton principal
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        const primary = footer.querySelector('.btn-primary');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    });
    document.body.append(dlg);
    dlg.showModal();
    if (onOpen) onOpen({ close: done, dialog: dlg });
    const focusable = dlg.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea');
    (focusable || footer.querySelector('.btn-primary') || footer.querySelector('button'))?.focus();
  });
}

export async function confirmDialog(message, { title = 'Confirmation', okLabel = 'Confirmer', danger = false } = {}) {
  const r = await modal({
    title,
    body: h('p', { class: 'pre-line', text: message }),
    buttons: [
      { label: 'Annuler', value: false },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return r === true;
}

/** Champ de formulaire étiqueté. */
export function field(label, input, hint = '') {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    input,
    hint ? h('small', { class: 'field-hint', text: hint }) : null);
}

/** Copie dans le presse-papiers avec retour visuel sur le bouton. */
export async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Copié ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1500);
    }
  } catch {
    toast('Copie impossible : autorisez l\'accès au presse-papiers.', 'error');
  }
}

/** Ouvre le sélecteur de fichiers et résout avec le fichier choisi (ou null). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

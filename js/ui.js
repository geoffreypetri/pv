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
  // Au plus 3 notifications visibles : les plus anciennes disparaissent.
  while (zone.children.length > 3) zone.firstElementChild.remove();
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
        h('button', { class: 'btn btn-icon btn-ghost btn-sm', type: 'button', title: 'Fermer', attrs: { 'aria-label': 'Fermer' }, onclick: () => done(null) }, icon('x'))),
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
      const btn = h('button', { type: 'button', class: `btn ${b.variant ? 'btn-' + b.variant : ''} ${b.start ? 'btn-start' : ''}`, text: b.label });
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


/* ---------- Icônes (SVG en ligne, trait 2 px, 24 × 24) ---------- */

const ICONS = {
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  alert: '<path d="m10.3 3.9-8.2 14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-3.1l-8.2-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
};

export function icon(name, { size = 16, title = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');
  svg.classList.add('icon');
  svg.innerHTML = (title ? `<title>${title.replace(/[<&>]/g, '')}</title>` : '') + (ICONS[name] || '');
  return svg;
}

/* ---------- Copie au survol ---------- */

async function writeClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      btn.classList.add('copied');
      btn.replaceChildren(icon('check', { size: 14 }));
      setTimeout(() => { btn.classList.remove('copied'); btn.replaceChildren(icon('copy', { size: 14 })); }, 1300);
    }
    return true;
  } catch {
    toast('Copie impossible : autorisez l\'accès au presse-papiers.', 'error');
    return false;
  }
}

function copyButton(getText, label) {
  const btn = h('button', { type: 'button', class: 'copy-btn', title: label, attrs: { 'aria-label': label } }, icon('copy', { size: 14 }));
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = getText();
    if (t) writeClipboard(t, btn);
  });
  return btn;
}

/**
 * Valeur affichée avec une icône « copier » qui apparaît au survol (tableaux, fiches).
 * Le clic sur l'icône copie la valeur sans déclencher l'action de la ligne.
 */
export function copyable(text, { label = 'Copier' } = {}) {
  if (!text) return h('span', { class: 'muted', text: '—' });
  return h('span', { class: 'copy-inline' }, h('span', { class: 'copy-text', text }), copyButton(() => text, label));
}

/** Champ de saisie avec une icône « copier » à l'intérieur, visible au survol ou au focus. */
export function withCopy(input, { label = 'Copier' } = {}) {
  return h('div', { class: 'input-copy' }, input, copyButton(() => input.value.trim(), label));
}

/** Champ en lecture seule (valeur à reporter ailleurs, ex. SAP) avec copie au survol. */
export function copyField(value, { label = 'Copier', mono = true } = {}) {
  const input = h('input', { type: 'text', readOnly: true, value: value ?? '', class: mono ? 'mono' : '' });
  return withCopy(input, { label });
}

/** Ancienne API : copie avec retour visuel sur un bouton texte. */
export async function copyText(text, btn) {
  return writeClipboard(text, null).then((ok) => {
    if (ok && btn) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1300);
    }
  });
}

/* ---------- Liste à choix multiples ---------- */

/**
 * Liste déroulante à cases à cocher.
 * options : [{ value, label }] ; onChange(values[]).
 * Aucune case cochée = « tous ».
 */
export function multiSelect({ label, allLabel = 'Tous', options = [], values = [], onChange, width = null }) {
  const selected = new Set(values);
  const text = h('span', { class: 'ms-text' });
  const trigger = h('button', { type: 'button', class: 'control ms-trigger', attrs: { 'aria-haspopup': 'listbox', 'aria-expanded': 'false' } },
    h('span', { class: 'ms-label', text: label }), text, icon('chevronDown', { size: 14 }));
  const panel = h('div', { class: 'ms-panel', hidden: true, role: 'listbox', attrs: { 'aria-multiselectable': 'true' } });
  const root = h('div', { class: 'ms' }, trigger, panel);
  if (width) root.style.minWidth = width;

  function refreshText() {
    const labels = options.filter((o) => selected.has(o.value)).map((o) => o.short || o.label);
    text.textContent = !labels.length ? allLabel : labels.length <= 2 ? labels.join(', ') : `${labels.length} sélectionnés`;
    trigger.classList.toggle('has-value', labels.length > 0);
  }
  function buildPanel() {
    panel.replaceChildren(
      h('div', { class: 'ms-actions' },
        h('button', { type: 'button', class: 'link-btn', text: 'Tout', onclick: () => { selected.clear(); options.forEach((o) => selected.add(o.value)); sync(); } }),
        h('button', { type: 'button', class: 'link-btn', text: 'Aucun', onclick: () => { selected.clear(); sync(); } })),
      ...(options.length ? options.map((o) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(o.value) });
        cb.addEventListener('change', () => { if (cb.checked) selected.add(o.value); else selected.delete(o.value); sync(false); });
        return h('label', { class: 'ms-option' }, cb, h('span', { text: o.label }), o.count !== undefined ? h('span', { class: 'ms-count', text: o.count }) : null);
      }) : [h('p', { class: 'muted small ms-empty', text: 'Aucune valeur' })]));
  }
  function sync(rebuild = true) {
    if (rebuild) buildPanel();
    refreshText();
    onChange?.([...selected]);
  }
  function open(v) {
    panel.hidden = !v;
    trigger.setAttribute('aria-expanded', String(v));
    root.classList.toggle('open', v);
    if (v) buildPanel();
  }
  trigger.addEventListener('click', () => open(panel.hidden));
  // composedPath() : chemin au moment du clic (l'élément cliqué peut avoir été remplacé depuis).
  document.addEventListener('click', (e) => { if (!e.composedPath().includes(root)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); trigger.focus(); } });
  refreshText();
  return {
    el: root,
    /** Met à jour les options (en conservant la sélection encore valide). */
    setOptions(opts, vals = [...selected]) {
      const same = opts.length === options.length && opts.every((o, i) => o.value === options[i].value);
      options = opts;
      selected.clear();
      vals.filter((v) => opts.some((o) => o.value === v)).forEach((v) => selected.add(v));
      refreshText();
      // Liste ouverte : on ne la reconstruit que si les valeurs proposées ont changé (garde le focus).
      if (!panel.hidden && !same) buildPanel();
    },
    get values() { return [...selected]; },
  };
}

/** Ouvre le sélecteur de fichiers et résout avec le fichier choisi (ou null). */
export function pickFile(accept, { multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true, multiple });
    input.addEventListener('change', () => { resolve(multiple ? [...input.files] : input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

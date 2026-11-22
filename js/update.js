// Service worker : enregistrement, détection des mises à jour, bannière « Nouvelle version ».
// Bouton « Installer l'application » (beforeinstallprompt).
// Jamais de rechargement sans action de l'utilisateur.

import { h, toast } from './ui.js';
import { isSaving, whenSaved } from './store.js';

const CHECK_INTERVAL = 60 * 60 * 1000; // toutes les heures

let reloadRequested = false;

export async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reg;
  try {
    reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch (e) {
    console.warn('Service worker non enregistré :', e);
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });

  const onWaiting = (worker) => {
    if (worker && navigator.serviceWorker.controller) showUpdateBanner(worker);
  };
  if (reg.waiting) onWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    nw?.addEventListener('statechange', () => {
      if (nw.state === 'installed') onWaiting(nw);
    });
  });

  const check = () => reg.update().catch(() => { /* hors ligne : on réessaiera */ });
  check();
  setInterval(check, CHECK_INTERVAL);
}

/** Demande au nouveau service worker sa version et ses notes (extraites du CHANGELOG). */
function askInfo(worker) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    worker.postMessage({ type: 'GET_INFO' }, [ch.port2]);
  });
}

async function showUpdateBanner(worker) {
  const banner = document.getElementById('updateBanner');
  if (!banner) return;
  const info = await askInfo(worker);
  const version = info?.version ? ` ${info.version}` : '';
  const notes = info?.notes || [];
  const reloadBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Recharger' });
  reloadBtn.addEventListener('click', async () => {
    if (document.querySelector('dialog[open]')) {
      toast('Terminez ou fermez la saisie en cours avant de recharger.', 'warn');
      return;
    }
    if (isSaving()) {
      reloadBtn.disabled = true;
      reloadBtn.textContent = 'Enregistrement…';
      await whenSaved().catch(() => {});
    }
    reloadRequested = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  });
  banner.replaceChildren(
    h('div', { class: 'banner-text' },
      h('strong', { text: `Nouvelle version${version} disponible` }),
      notes.length ? h('ul', { class: 'banner-notes' }, notes.map((n) => h('li', { text: n }))) : null),
    h('div', { class: 'banner-actions' },
      reloadBtn,
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Plus tard', onclick: () => { banner.hidden = true; } })));
  banner.hidden = false;
}

export function initInstallButton(button) {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    button.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    button.hidden = true;
    toast('Application installée.', 'success');
  });
}

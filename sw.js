// Service worker de Suivi PV.
// Met en cache UNIQUEMENT les fichiers de l'application (app shell), jamais de données métier :
// celles-ci sont lues/écrites directement dans le dossier local, sans passer par le réseau.

importScripts('version.js');

const VERSION = self.APP_VERSION.version;
const CACHE_PREFIX = 'suivi-pv-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;

// Liste des fichiers de l'application. Le test tests/sw.test.js vérifie qu'elle est complète.
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.js',
  'CHANGELOG.md',
  'css/app.css',
  'js/app.js',
  'js/excel.js',
  'js/format.js',
  'js/import-ui.js',
  'js/line-ui.js',
  'js/model.js',
  'js/schema.js',
  'js/settings-ui.js',
  'js/storage.js',
  'js/store.js',
  'js/ui.js',
  'js/update.js',
  'vendor/xlsx.full.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

// En développement local, on privilégie le réseau pour voir les modifications immédiatement.
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));

self.addEventListener('install', (event) => {
  // Pas de skipWaiting() ici : la nouvelle version attend le clic « Recharger » de l'utilisateur.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(fromCacheOrNetwork(new URL('index.html', self.registration.scope).href, req));
    return;
  }
  url.search = '';
  if (SHELL_URLS.has(url.href)) event.respondWith(fromCacheOrNetwork(url.href, req));
  // Toute autre requête : comportement réseau normal, rien n'est mis en cache.
});

async function fromCacheOrNetwork(cacheKey, req) {
  const cache = await caches.open(CACHE);
  if (DEV) {
    try {
      return await fetch(req, { cache: 'no-store' });
    } catch {
      return (await cache.match(cacheKey)) || Response.error();
    }
  }
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  return fetch(req);
}

/** Extrait les puces de la section « ## [version] » du CHANGELOG. */
function changelogNotes(text, version, max = 8) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s*\\[?${version.replace(/\./g, '\\.')}\\]?`).test(l));
  if (start < 0) return [];
  const notes = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const m = lines[i].match(/^\s*[-*]\s+(.*)$/);
    if (m) notes.push(m[1].replace(/\*\*|`/g, '').trim());
  }
  return notes.slice(0, max);
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (msg.type === 'GET_INFO') {
    const port = event.ports[0];
    event.waitUntil((async () => {
      let notes = [];
      try {
        const res = await (await caches.open(CACHE)).match(new URL('CHANGELOG.md', self.registration.scope).href);
        if (res) notes = changelogNotes(await res.text(), VERSION);
      } catch { /* notes facultatives */ }
      port?.postMessage({ version: VERSION, date: self.APP_VERSION.date, notes });
    })());
  }
});

// Accès au dossier de travail (File System Access API) et mémorisation du handle (IndexedDB).
// Aucune donnée métier n'est envoyée sur le réseau : tout est lu/écrit dans le dossier choisi.

export const WORKDIR_NAME = 'Suivi-PV';
export const DATA_FILE = 'data.json';

const DB_NAME = 'suivi-pv';
const STORE = 'handles';
const KEY = 'workdir';

/* ---------- IndexedDB : uniquement le handle du dossier ---------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getSavedDir = () => idb('readonly', (s) => s.get(KEY)).catch(() => null);
export const saveDir = (handle) => idb('readwrite', (s) => s.put(handle, KEY));
export const forgetDir = () => idb('readwrite', (s) => s.delete(KEY));

/* ---------- Dossier de travail ---------- */

export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Demande à l'utilisateur de choisir le dossier de travail.
 * S'il choisit un dossier « Suivi-PV » (ou contenant déjà data.json), il est utilisé tel quel ;
 * sinon un sous-dossier « Suivi-PV » y est créé.
 */
export async function pickWorkdir() {
  const picked = await window.showDirectoryPicker({ id: 'suivi-pv', mode: 'readwrite', startIn: 'documents' });
  let dir = picked;
  const hasData = await exists(picked, DATA_FILE);
  if (picked.name !== WORKDIR_NAME && !hasData) {
    dir = await picked.getDirectoryHandle(WORKDIR_NAME, { create: true });
  }
  await saveDir(dir);
  return dir;
}

/** Vérifie (et si `request`, demande) la permission lecture/écriture. */
export async function checkPermission(handle, request = false) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (request && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

/** Crée l'arborescence attendue (imports/, PV/). */
export async function ensureStructure(dir) {
  await dir.getDirectoryHandle('imports', { create: true });
  await dir.getDirectoryHandle('PV', { create: true });
}

/* ---------- Fichiers ---------- */

function splitPath(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.')) throw new Error(`Chemin invalide : ${path}`);
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
}

async function resolveDir(root, dirs, create) {
  let d = root;
  for (const name of dirs) d = await d.getDirectoryHandle(name, { create });
  return d;
}

export async function getFileHandle(root, path, create = false) {
  const { dirs, name } = splitPath(path);
  const d = await resolveDir(root, dirs, create);
  return d.getFileHandle(name, { create });
}

export async function exists(root, path) {
  try {
    await getFileHandle(root, path);
    return true;
  } catch (e) {
    if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return false;
    throw e;
  }
}

export async function readFile(root, path) {
  const h = await getFileHandle(root, path);
  return h.getFile();
}

/** Lit un fichier texte ; null s'il n'existe pas. */
export async function readText(root, path) {
  try {
    return await (await readFile(root, path)).text();
  } catch (e) {
    if (e.name === 'NotFoundError') return null;
    throw e;
  }
}

/**
 * Écriture atomique : Chromium écrit dans un fichier temporaire (« <nom>.crswap »)
 * et ne remplace le fichier cible qu'à la fermeture réussie du flux (close()).
 * En cas d'erreur, le flux est abandonné et le fichier d'origine reste intact.
 */
export async function writeFile(root, path, content) {
  const h = await getFileHandle(root, path, true);
  const w = await h.createWritable({ keepExistingData: false });
  try {
    await w.write(content);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch { /* déjà fermé */ }
    throw e;
  }
  return h;
}

/** Écrit un JSON puis le relit pour vérifier qu'il est complet et valide. */
export async function writeJson(root, path, obj) {
  const text = JSON.stringify(obj, null, 2);
  await writeFile(root, path, text);
  const check = await readText(root, path);
  if (check !== text) throw new Error(`Vérification de l'écriture de ${path} échouée.`);
  JSON.parse(check);
}

/** Copie un fichier (File/Blob) vers un chemin du dossier de travail. */
export async function copyInto(root, path, blob) {
  await writeFile(root, path, blob);
}

export async function removeFile(root, path) {
  const { dirs, name } = splitPath(path);
  const d = await resolveDir(root, dirs, false);
  await d.removeEntry(name);
}

// État de l'application et sauvegarde automatique de data.json.

import * as S from './storage.js';
import { migrate, createEmptyData, SCHEMA_VERSION } from './schema.js';
import { currentMonth, fileStamp } from './format.js';

export const APP_VERSION = globalThis.APP_VERSION || { version: '0.0.0', date: '' };

export function defaultFilters() {
  return { q: '', annee: currentMonth().slice(0, 4), mois: [], fournisseurs: [], statuts: [], alertes: false };
}

export const state = {
  dir: null,            // FileSystemDirectoryHandle du dossier Suivi-PV
  data: null,           // contenu de data.json
  readOnly: false,
  readOnlyReason: '',
  // Vue « à plat » : filtres combinables (le mois est un filtre comme les autres).
  filters: defaultFilters(),
  sort: { key: null, dir: 'asc' },
  save: { status: 'idle', at: null, error: null }, // idle | saving | saved | error
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { for (const fn of listeners) fn(state); }

export function setReadOnly(reason) {
  state.readOnly = true;
  state.readOnlyReason = reason;
  notify();
}

export function assertWritable() {
  if (state.readOnly) throw new Error(`Lecture seule : ${state.readOnlyReason}`);
  if (!state.dir || !state.data) throw new Error('Aucun dossier de travail ouvert.');
}

export const findLine = (id) => state.data.lignes.find((l) => l.id === id);

/**
 * Ouvre un dossier de travail : crée la structure, lit (ou crée) data.json,
 * applique les migrations (après sauvegarde de l'ancien fichier).
 * @returns {{ created?: boolean, backup?: string, fromVersion?: number }}
 */
export async function openWorkdir(dir) {
  state.dir = dir;
  state.data = null;
  if (!state.readOnly) await S.ensureStructure(dir);
  const text = await S.readText(dir, S.DATA_FILE);
  if (text === null) {
    if (state.readOnly) throw new Error('data.json introuvable et application en lecture seule.');
    state.data = createEmptyData(APP_VERSION.version);
    await saveNow();
    notify();
    return { created: true };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Le fichier data.json est illisible (JSON invalide). Restaurez une version précédente '
      + '(historique des versions OneDrive ou fichier data.backup-*.json) puis rechargez.');
  }
  const r = migrate(raw);
  state.data = r.data;
  if (r.readOnly) {
    state.readOnly = true;
    state.readOnlyReason = `les données ont été enregistrées par une version plus récente de l'application `
      + `(format ${r.fromVersion}, cette version gère le format ${SCHEMA_VERSION}). Rechargez l'application pour la mettre à jour.`;
    notify();
    return { fromVersion: r.fromVersion };
  }
  if (r.migrated && !state.readOnly) {
    const backup = `data.backup-${fileStamp()}.json`;
    await S.writeFile(dir, backup, text);
    await saveNow();
    notify();
    return { backup, fromVersion: r.fromVersion };
  }
  notify();
  return {};
}

/* ---------- Sauvegarde ---------- */

let saving = null;
let pending = false;

async function writeData() {
  const d = state.data;
  d.app = { ...d.app, enregistreAvec: APP_VERSION.version, enregistreLe: new Date().toISOString() };
  await S.writeJson(state.dir, S.DATA_FILE, d);
}

/** Enregistre maintenant (les appels concurrents sont regroupés et sérialisés). */
export function saveNow() {
  if (saving) { pending = true; return saving; }
  saving = (async () => {
    state.save = { ...state.save, status: 'saving', error: null };
    notify();
    try {
      do {
        pending = false;
        await writeData();
      } while (pending);
      state.save = { status: 'saved', at: new Date(), error: null };
    } catch (e) {
      console.error(e);
      state.save = { status: 'error', at: state.save.at, error: e.message || String(e) };
      throw e;
    } finally {
      saving = null;
      notify();
    }
  })();
  return saving;
}

export const isSaving = () => !!saving;
export const whenSaved = () => saving || Promise.resolve();

/**
 * Applique une modification aux données puis enregistre automatiquement.
 * La fonction reçoit `state.data` ; si elle lève une exception, rien n'est enregistré.
 */
export async function mutate(fn) {
  assertWritable();
  const result = fn(state.data);
  notify();
  try {
    await saveNow();
  } catch (e) {
    throw new Error(`Modification non enregistrée : ${e.message}`);
  }
  return result;
}

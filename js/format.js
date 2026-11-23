// Formatage et analyse des valeurs (montants, dates, mois, noms de fichiers).
// Module pur : aucune dépendance au navigateur, testable sous Node.

const euroFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const numFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Arrondi au centime (évite les erreurs de virgule flottante). */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 1234.5 → « 1 234,50 € » ; null/undefined → chaîne vide. */
export function formatEuro(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  return euroFmt.format(Number(n));
}

/** 1234.5 → « 1 234,50 » (sans symbole). */
export function formatNumber(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  return numFmt.format(Number(n));
}

/** Format à coller dans SAP : « 1234,50 » (virgule décimale, pas de séparateur de milliers). */
export function formatForSap(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return round2(n).toFixed(2).replace('.', ',');
}

/**
 * Analyse un montant saisi ou importé : nombre, « 1 234,56 € », « 1234.56 », « 1.234,56 »…
 * Retourne un nombre arrondi au centime, null si vide, NaN si illisible.
 */
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value) : NaN;
  let s = String(value).trim();
  if (s === '') return null;
  s = s.replace(/[\s  ]/g, '').replace(/€|eur(os?)?/gi, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    if ((s.match(/,/g) || []).length > 1) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = round2(parseFloat(s));
  return negative ? -n : n;
}

/** ISO → « 22/11/2026 ». */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR');
}

/** ISO → « 22/11/2026 14:05 ». */
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date → « 2026-11-22 » (date locale). */
export function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date → « 20261122-1405 » (horodatage pour noms de fichiers). */
export function fileStamp(d = new Date(), withSeconds = false) {
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return withSeconds ? base + pad(d.getSeconds()) : base;
}

/** Mois courant « AAAA-MM ». */
export function currentMonth(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function isValidMonth(m) {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

/** Décale un mois « AAAA-MM » de n mois. */
export function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return currentMonth(d);
}

/** « 2026-11 » → « novembre 2026 ». */
export function monthLabel(m) {
  if (!isValidMonth(m)) return m || '';
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** Clé de comparaison : sans accents, minuscules, espaces normalisés. */
export function normalizeKey(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Partie de nom de fichier sûre : sans accents, lettres/chiffres/tirets uniquement.
 * « Société Générale & Cie » → « Societe-Generale-Cie ».
 */
export function safeFilePart(s, maxLength = 40) {
  const cleaned = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return cleaned || 'inconnu';
}

/**
 * Normalise une date en « AAAA-MM-JJ » : objet Date, « AAAA-MM-JJ… », « JJ/MM/AAAA »
 * ou numéro de série Excel. Retourne '' si vide, null si illisible.
 */
export function parseDay(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === 'number') {
    if (value < 1 || value > 2958465) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** « 2026-10-01 » → « 01/10/2026 ». */
export function formatDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day || '';
}

/** Formate un nombre de jours : 12 → « 12 j », 2.86 → « 2,86 j ». */
export function formatJours(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n))} j`;
}

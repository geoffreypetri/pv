// Lecture des exports Abraxio (Excel/CSV) et écriture de l'export mensuel.
// Utilise SheetJS (vendor/xlsx.full.min.js, variable globale XLSX), entièrement en local.

import { EXPORT_COLUMNS, exportRows } from './model.js';

const XLSX = () => {
  if (!globalThis.XLSX) throw new Error('Bibliothèque SheetJS non chargée.');
  return globalThis.XLSX;
};

/** Décode un CSV : UTF-8 si valide, sinon Windows-1252 (exports Excel français). */
function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Devine le séparateur d'un CSV (; , ou tabulation) d'après les premières lignes. */
function guessSeparator(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of sample) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Lit un fichier et retourne ses feuilles.
 * @returns {Promise<Array<{ name, headers: string[], rows: object[], headerRow: number }>>}
 */
export async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const isCsv = /\.(csv|txt)$/i.test(file.name);
  let wb;
  if (isCsv) {
    const text = decodeText(buffer);
    wb = XLSX().read(text, { type: 'string', FS: guessSeparator(text), raw: true, dense: true });
  } else {
    // Pas de cellDates : les dates sont converties sans fuseau horaire (voir fixDates).
    wb = XLSX().read(buffer, { type: 'array', cellNF: true, dense: true });
  }
  return wb.SheetNames.map((name) => sheetToTable(name, wb.Sheets[name])).filter((s) => s.headers.length);
}

/**
 * Remplace les dates Excel par des chaînes « AAAA-MM-JJ » calculées sans fuseau horaire
 * (sinon le 1er du mois peut devenir le dernier jour du mois précédent en heure française).
 */
function fixDates(sheet) {
  const X = XLSX();
  const pad = (n) => String(n).padStart(2, '0');
  const fix = (cell) => {
    if (!cell) return;
    // Un texte (ex. l'en-tête « De ») peut porter le format date de sa colonne : on l'ignore.
    if (cell.t === 's') { delete cell.z; return; }
    if (cell.t === 'n' && cell.z && X.SSF.is_date(cell.z)) {
      const p = X.SSF.parse_date_code(cell.v);
      if (!p) return;
      cell.t = 's';
      cell.v = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
      delete cell.w;
      delete cell.z;
    } else if (cell.t === 'd' && cell.v instanceof Date) {
      const d = cell.v;
      cell.t = 's';
      cell.v = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      delete cell.w;
      delete cell.z;
    }
  };
  if (Array.isArray(sheet['!data'])) sheet['!data'].forEach((row) => row?.forEach(fix));
  else for (const k of Object.keys(sheet)) if (k[0] !== '!') fix(sheet[k]);
}

function sheetToTable(name, sheet) {
  fixDates(sheet);
  const matrix = XLSX().utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  // Ligne d'en-tête : première ligne comportant au moins 2 cellules non vides.
  const headerIndex = matrix.findIndex((r) => r.filter((c) => String(c).trim() !== '').length >= 2);
  if (headerIndex < 0) return { name, headers: [], rows: [], headerRow: 0 };
  const seen = new Map();
  const headers = matrix[headerIndex].map((h, i) => {
    let label = String(h).trim() || `Colonne ${i + 1}`;
    const n = seen.get(label) || 0;
    seen.set(label, n + 1);
    if (n) label = `${label} (${n + 1})`;
    return label;
  });
  const rows = matrix.slice(headerIndex + 1).map((r) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = r[i] ?? '';
    });
    return o;
  });
  return { name, headers, rows, headerRow: headerIndex + 1 };
}

/** Construit le classeur d'export d'un mois. Retourne un Uint8Array (.xlsx). */
export function buildExport(lines, mois) {
  const X = XLSX();
  const data = exportRows(lines);
  const aoa = [EXPORT_COLUMNS.map((c) => c.label)];
  for (const r of data) {
    aoa.push(EXPORT_COLUMNS.map((c) => {
      const v = r[c.key];
      if (v === null || v === undefined || v === '') return null;
      if (c.type === 'date') return new Date(`${String(v).slice(0, 10)}T12:00:00`);
      return v;
    }));
  }
  const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
  // Formats des cellules : euros et dates à la française.
  const range = X.utils.decode_range(ws['!ref']);
  EXPORT_COLUMNS.forEach((c, ci) => {
    if (!c.type) return;
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[X.utils.encode_cell({ r, c: ci })];
      if (!cell) continue;
      cell.z = c.type === 'euro' ? '#,##0.00 "€"' : c.type === 'number' ? '0.##' : 'dd/mm/yyyy';
    }
  });
  ws['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: c.type ? 14 : Math.max(12, c.label.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, `PV ${mois}`);

  // Feuille « Détail » : les imputations additionnées pour chaque ligne, pour vérification.
  const det = [['Collaborateur', 'Fournisseur', 'N° commande', 'Poste', 'Libellé', 'Jours', 'Prix unitaire HT', 'Montant HT', 'Ligne du fichier importé']];
  for (const l of lines) {
    for (const d of l.details || []) {
      det.push([l.collaborateur, l.fournisseur, l.commande, l.poste, d.libelle, d.quantite ?? null, d.prixUnitaire ?? null, d.montant ?? null, d.ligne ?? null]);
    }
  }
  if (det.length > 1) {
    const wd = X.utils.aoa_to_sheet(det);
    for (let r = 1; r < det.length; r++) {
      for (const c of [6, 7]) { const cell = wd[X.utils.encode_cell({ r, c })]; if (cell) cell.z = '#,##0.00 "€"'; }
    }
    wd['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 13 }, { wch: 6 }, { wch: 50 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
    wd['!autofilter'] = { ref: wd['!ref'] };
    X.utils.book_append_sheet(wb, wd, 'Détail');
  }
  return new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx', compression: true }));
}

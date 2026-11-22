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
    wb = XLSX().read(buffer, { type: 'array', cellDates: true, dense: true });
  }
  return wb.SheetNames.map((name) => sheetToTable(name, wb.Sheets[name])).filter((s) => s.headers.length);
}

function sheetToTable(name, sheet) {
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
      let v = r[i] ?? '';
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      o[h] = v;
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
      if (c.type === 'date') return new Date(v);
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
      cell.z = c.type === 'euro' ? '#,##0.00 "€"' : 'dd/mm/yyyy';
    }
  });
  ws['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: c.type ? 14 : Math.max(12, c.label.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, `PV ${mois}`);
  return new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx', compression: true }));
}

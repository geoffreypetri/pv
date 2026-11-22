// Génère exemple-abraxio.xlsx : ~10 lignes FICTIVES pour tester l'import.
// Usage : node scripts/make-example.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

// Charge la copie locale de SheetJS (script navigateur) dans un contexte isolé.
const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), ctx);
const XLSX = ctx.XLSX;

// Noms volontairement fictifs — ne jamais mettre de vraies données ici (repo public).
const rows = [
  ['Ressource', 'Fournisseur', 'N° commande', 'Poste', 'Montant mensuel HT', 'Date début', 'Date fin', 'Jours prévus'],
  ['Alice Exemple', 'Prestataire Alpha', '4500000101', '10', 9450, '2026-01-01', '2026-12-31', 21],
  ['Bruno Fictif', 'Prestataire Alpha', '4500000101', '20', 8820, '2026-01-01', '2026-12-31', 21],
  ['Chloé Démo', 'Société Bêta Conseil', '4500000102', '10', 10500, '2026-03-01', '2026-12-31', 21],
  ['David Test', 'Société Bêta Conseil', '4500000103', '10', 7350.5, '2026-06-01', '2027-05-31', 21],
  ['Émilie Modèle', 'Gamma Services', '4500000104', '10', 6300, '2026-01-01', '2026-12-31', 20],
  ['François Essai', 'Gamma Services', '4500000104', '20', 6300, '2026-01-01', '2026-12-31', 20],
  ['Gaëlle Sample', 'Delta Ingénierie', '4500000105', '10', 11550, '2026-09-01', '2027-08-31', 21],
  ['Hugo Factice', 'Delta Ingénierie', '4500000105', '20', 9975, '2026-09-01', '2027-08-31', 19],
  ['Inès Imaginaire', 'Epsilon Digital', '4500000106', '10', 5040, '2026-01-01', '2026-12-31', 12],
  ['Jules Prototype', 'Epsilon Digital', '4500000107', '', 8400, '2026-04-01', '2027-03-31', 20],
];
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 7 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
for (let r = 1; r < rows.length; r++) ws[XLSX.utils.encode_cell({ r, c: 4 })].z = '#,##0.00 "€"';
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Export');
writeFileSync(new URL('../exemple-abraxio.xlsx', import.meta.url), new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true })));
console.log('exemple-abraxio.xlsx généré (10 lignes fictives).');

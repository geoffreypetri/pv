// Génère exemple-abraxio.xlsx : export FICTIF qui reproduit la structure de l'export Abraxio
// (feuille « Données Consommé », une ligne par imputation, périodes De / A).
// Usage : node scripts/make-example.mjs
//
// Ne jamais mettre de vraies données ici : le dépôt est public.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { Buffer, Uint8Array, ArrayBuffer, TextDecoder };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), ctx);
const XLSX = ctx.XLSX;

const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const PERIODES = [
  { de: serial(2026, 9, 1), a: serial(2026, 9, 30), factor: 1 },
  { de: serial(2026, 10, 1), a: serial(2026, 10, 31), factor: 0.9 },
];

// Collaborateur, fournisseur, référence commande « n°-poste-libellé », TJM, répartition des jours par ligne budgétaire.
const PRESTAS = [
  ['Alice Exemple', 'PRESTATAIRE ALPHA-100001', '3000000101-10-Prestation de Développement Full stack', 520, { 'Run - Application A': 6, 'Projet Migration': 12, 'Projet Supervision': 3 }],
  ['Bruno Fictif', 'PRESTATAIRE ALPHA-100001', '3000000102-10-Prestation de Développement Front', 480, { 'Run - Application A': 4, 'Projet Migration': 14 }],
  ['Chloé Démo', 'SOCIÉTÉ BÊTA CONSEIL', '3000000103-10-Prestation de Business Analyst', 610, { 'Projet Migration': 20 }],
  ['David Test', 'SOCIÉTÉ BÊTA CONSEIL', '3000000104-20-Prestation de Lead Tech', 690, { 'Run - Application B': 5, 'Projet Supervision': 10, 'Projet Migration': 4 }],
  ['Émilie Modèle', 'GAMMA SERVICES-200002', '3000000105-10-Prestation de Intégration devops', 550, { 'Run - Application A': 8, 'Run - Application B': 8, 'Projet Supervision': 3 }],
  ['François Essai', 'GAMMA SERVICES-200002', '3000000105-20-Prestation de Support', 410, { 'Run - Application B': 21 }],
  ['Gaëlle Sample', 'DELTA INGÉNIERIE', '3000000106-10-Prestation de Expertise Technique', 720, { 'Projet Supervision': 9, 'Projet Migration': 9 }],
  ['Hugo Factice', 'DELTA INGÉNIERIE', '3000000107-10-Prestation de Appui au Pilotage', 640, { 'Run - Application A': 2, 'Run - Application B': 2, 'Projet Migration': 6, 'Projet Supervision': 6 }],
  ['Inès Imaginaire', 'EPSILON DIGITAL', '3000000108-10-Prestation de Développement Back', 505, { 'Projet Migration': 17.5 }],
  ['Jules Prototype', 'EPSILON DIGITAL', '3000000109-10-Prestation de Tests', 450, { 'Run - Application A': 10, 'Projet Supervision': 9 }],
];

const HEADERS = ['Id Conso', 'Id Commande', 'Type facture', 'Date', 'Fournisseur', 'Ref Fournisseur', 'Id collaborateur', 'Collaborateur',
  'Numéros de commande associés', 'Libellé', 'Montant HT', 'P.U.H.T.', 'Par', 'Quantité', 'De', 'A', 'Total HT',
  'Début période', 'Fin période', 'Total période HT', 'Commande', 'Ref Commande', 'Catégorie', 'Libellé budget', 'Run / Build'];

const rows = [HEADERS];
let id = 1;
const push = (o) => rows.push(HEADERS.map((h) => o[h] ?? ''));
for (const p of PERIODES) {
  PRESTAS.forEach(([collab, fourn, cmd, tjm, rep], i) => {
    for (const [libBudget, jours] of Object.entries(rep)) {
      const q = Math.round(jours * p.factor * 2) / 2;
      const total = Math.round(q * tjm * 100) / 100;
      push({ 'Id Conso': `CONSO-${String(id++).padStart(5, '0')}`, 'Type facture': 'Temps', Date: p.a, Fournisseur: fourn,
        'Id collaborateur': `ID-${String(i + 1).padStart(4, '0')}`, Collaborateur: collab, 'Numéros de commande associés': cmd, Libellé: collab,
        'Montant HT': 0, 'P.U.H.T.': tjm, Par: 'JxH', Quantité: q, De: p.de, A: p.a, 'Total HT': total,
        'Début période': p.de, 'Fin période': p.a, 'Total période HT': total, Catégorie: 'Prestations externes',
        'Libellé budget': libBudget, 'Run / Build': libBudget.startsWith('Run') ? 'Run' : 'Build' });
    }
  });
  // Profil interne (pas de commande) et provision d'astreinte (pas de collaborateur) : à ignorer à l'import.
  push({ 'Id Conso': `CONSO-${String(id++).padStart(5, '0')}`, 'Type facture': 'Temps', Date: p.a, Collaborateur: 'Interne Exemple', Libellé: 'Interne Exemple',
    'Montant HT': 0, 'P.U.H.T.': 577.08, Par: 'JxH', Quantité: 2.86, De: p.de, A: p.a, 'Total HT': 1650.45, 'Début période': p.de, 'Fin période': p.a,
    'Total période HT': 1650.45, Catégorie: 'Profils internes', 'Libellé budget': 'Main-d\'œuvre interne', 'Run / Build': 'Run' });
  push({ 'Id Conso': `CONSO-${String(id++).padStart(5, '0')}`, 'Type facture': 'Facture', Date: p.a + 5, Fournisseur: 'GAMMA SERVICES-200002',
    Libellé: '3000000105/20/4100000001/Provision pour astreinte 5%', 'Montant HT': 412.5, 'P.U.H.T.': 0, Quantité: '', De: p.de, A: p.a,
    'Total HT': 412.5, 'Début période': p.de, 'Fin période': p.a, 'Total période HT': 412.5, Catégorie: 'Prestations externes',
    'Libellé budget': 'Run - Application B', 'Run / Build': 'Run' });
}

const ws = XLSX.utils.aoa_to_sheet(rows);
const dateCols = ['Date', 'De', 'A', 'Début période', 'Fin période'].map((h) => HEADERS.indexOf(h));
const euroCols = ['Montant HT', 'P.U.H.T.', 'Total HT', 'Total période HT'].map((h) => HEADERS.indexOf(h));
for (let r = 1; r < rows.length; r++) {
  for (const c of dateCols) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = 'm/d/yy'; }
  for (const c of euroCols) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = '#,##0.00'; }
}
ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(10, Math.min(40, h.length + 4)) }));
ws['!cols'][HEADERS.indexOf('Numéros de commande associés')] = { wch: 52 };

const identite = XLSX.utils.aoa_to_sheet([['Champ', 'Valeur'], ['Export', 'Fictif, généré pour les tests de Suivi PV'], ['Données', 'Aucune donnée réelle']]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, identite, 'Identité');
XLSX.utils.book_append_sheet(wb, ws, 'Données Consommé');
writeFileSync(new URL('../exemple-abraxio.xlsx', import.meta.url), new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true })));
console.log(`exemple-abraxio.xlsx généré : ${rows.length - 1} lignes fictives, 2 périodes (septembre et octobre 2026).`);

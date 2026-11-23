// Tests des règles métier — exécuter : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { parseAmount, parseDay, formatEuro, formatForSap, safeFilePart, addMonths, monthLabel } from '../js/format.js';

const mk = (over = {}) => M.createLine(
  { collaborateur: 'Alice Martin', fournisseur: 'Société Fictive & Cie', commande: '4500000001', poste: '10', montantAttendu: 1000, ...over },
  { mois: '2026-11' });

test('parseAmount : formats français et anglais', () => {
  assert.equal(parseAmount('1 234,56 €'), 1234.56);
  assert.equal(parseAmount('1 234,5'), 1234.5);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1234.56'), 1234.56);
  assert.equal(parseAmount(1234.567), 1234.57);
  assert.equal(parseAmount('-50'), -50);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
});

test('formatage euro et SAP', () => {
  assert.equal(formatEuro(1234.5).replace(/\s/g, ' '), '1 234,50 €');
  assert.equal(formatForSap(1234.5), '1234,50');
});

test('mois : décalage et libellé', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthLabel('2026-11'), 'novembre 2026');
});

test('nom de fichier PV sûr', () => {
  assert.equal(safeFilePart('Société Fictive & Cie'), 'Societe-Fictive-Cie');
  assert.equal(safeFilePart('  ../../etc  '), 'etc');
  assert.equal(safeFilePart(''), 'inconnu');
  assert.equal(M.pvFileName(mk()), '2026-11_Societe-Fictive-Cie_Alice-Martin.pdf');
  assert.equal(M.pvPath(mk(), '_2'), 'PV/2026-11/2026-11_Societe-Fictive-Cie_Alice-Martin_2.pdf');
});

test('cycle complet : Attendu → PV reçu → Validé → BR créé, avec historique', () => {
  const l = mk();
  assert.equal(l.statut, 'attendu');
  M.applyPV(l, { fichierPV: 'PV/x.pdf', montantPV: '1 000,00' });
  assert.equal(l.statut, 'pv_recu');
  assert.equal(M.computeEcart(l), 0);
  M.validate(l);
  assert.equal(l.statut, 'valide');
  assert.throws(() => M.setBR(l, { numeroBR: ' ' }), /obligatoire/);
  M.setBR(l, { numeroBR: '5000012345', dateBR: '2026-11-22' });
  assert.equal(l.statut, 'br_cree');
  assert.deepEqual(l.historique.map((h) => h.statut), ['attendu', 'pv_recu', 'valide', 'br_cree']);
});

test('transitions interdites', () => {
  const l = mk();
  assert.throws(() => M.validate(l));
  assert.throws(() => M.setBR(l, { numeroBR: '1' }));
  assert.throws(() => M.applyPV(l, { fichierPV: 'x', montantPV: 'abc' }), /invalide/);
});

test('écart et tolérance', () => {
  const l = mk();
  M.applyPV(l, { fichierPV: 'x', montantPV: 1050.1 });
  assert.equal(M.computeEcart(l), 50.1);
  assert.equal(M.hasEcart(l), true);
  assert.equal(M.hasEcart(l, 100), false);
});

test('litige à tout moment puis retour au statut précédent', () => {
  const l = mk();
  M.applyPV(l, { fichierPV: 'x', montantPV: 900 });
  M.setLitige(l, 'Montant contesté');
  assert.equal(l.statut, 'litige');
  M.applyPV(l, { fichierPV: 'y', montantPV: 1000 }); // PV corrigé pendant le litige
  assert.equal(l.statut, 'litige');
  M.leverLitige(l);
  assert.equal(l.statut, 'pv_recu');
  const l2 = mk();
  M.setLitige(l2);
  M.leverLitige(l2);
  assert.equal(l2.statut, 'attendu');
});

test('retour à l\'étape précédente efface le BR', () => {
  const l = mk();
  M.applyPV(l, { fichierPV: 'x', montantPV: 1000 });
  M.validate(l);
  M.setBR(l, { numeroBR: '42' });
  M.revertStatus(l);
  assert.equal(l.statut, 'valide');
  assert.equal(l.numeroBR, '');
  assert.equal(M.previousStatus(mk()), null);
});

test('compteurs, filtres et tri', () => {
  const a = mk(), b = mk({ collaborateur: 'Bruno Durand', fournisseur: 'Autre Fictif' });
  M.applyPV(b, { fichierPV: 'x', montantPV: 1 });
  const c = M.countByStatus([a, b]);
  assert.equal(c.attendu, 1); assert.equal(c.pv_recu, 1); assert.equal(c.total, 2);
  assert.equal(M.filterLines([a, b], { q: 'bruno' }).length, 1);
  assert.equal(M.filterLines([a, b], { q: 'societe' }).length, 1);
  assert.equal(M.filterLines([a, b], { statut: 'attendu' })[0], a);
  assert.equal(M.sortLines([a, b])[0], b); // « à valider » avant « attendu »
});

test('correspondance automatique : format Abraxio « Données Consommé »', () => {
  const headers = ['Id Commande', 'Type facture', 'Fournisseur', 'Ref Fournisseur', 'Id collaborateur', 'Collaborateur',
    'Numéros de commande associés', 'Libellé', 'Montant HT', 'P.U.H.T.', 'Par', 'Quantité', 'De', 'A', 'Total HT',
    'Début période', 'Fin période', 'Total période HT', 'Commande', 'Ref Commande', 'Libellé budget', 'Fournisseur budget'];
  const row = Object.fromEntries(headers.map((h) => [h, '']));
  Object.assign(row, { Fournisseur: 'Alpha-1', Collaborateur: 'Alice', 'Numéros de commande associés': '3000000001-10-Dev', 'Montant HT': 0,
    'P.U.H.T.': 500, Quantité: 2, De: '2026-10-01', A: '2026-10-31', 'Total HT': 1000, 'Libellé budget': 'Run' });
  const m = M.guessMapping(headers, {}, [row]);
  assert.equal(m.collaborateur, 'Collaborateur');
  assert.equal(m.fournisseur, 'Fournisseur');
  assert.equal(m.commande, 'Numéros de commande associés'); // « Commande » est vide
  assert.equal(m.montantAttendu, 'Total HT');
  assert.equal(m.debut, 'De');
  assert.equal(m.fin, 'A');
  assert.equal(m.quantite, 'Quantité');
  assert.equal(m.prixUnitaire, 'P.U.H.T.');
  assert.equal(m.libelle, 'Libellé budget');
  assert.equal(m.poste, undefined);
});

test('correspondance automatique : format simple et correspondance mémorisée prioritaire', () => {
  const headers = ['Nom ressource', 'Fournisseur', 'N° commande', 'Poste', 'Montant mensuel HT', 'Divers'];
  const m = M.guessMapping(headers);
  assert.equal(m.collaborateur, 'Nom ressource');
  assert.equal(m.commande, 'N° commande');
  assert.equal(m.poste, 'Poste');
  assert.equal(m.montantAttendu, 'Montant mensuel HT');
  assert.equal(M.guessMapping(headers, { collaborateur: 'Divers' }).collaborateur, 'Divers');
});

test('parseCommande : « commande-poste-libellé »', () => {
  assert.deepEqual(M.parseCommande('3000000101-10-Prestation de Développement Full stack'),
    { commande: '3000000101', poste: '10', prestation: 'Prestation de Développement Full stack' });
  assert.deepEqual(M.parseCommande('4500000001'), { commande: '4500000001', poste: '', prestation: '' });
  assert.deepEqual(M.parseCommande(4500000001), { commande: '4500000001', poste: '', prestation: '' });
  assert.deepEqual(M.parseCommande(''), { commande: '', poste: '', prestation: '' });
});

test('parseDay : formats de date sans décalage de fuseau', () => {
  assert.equal(parseDay('2026-10-01'), '2026-10-01');
  assert.equal(parseDay('01/10/2026'), '2026-10-01');
  assert.equal(parseDay(46296), '2026-10-01'); // numéro de série Excel
  assert.equal(parseDay(new Date(2026, 9, 1)), '2026-10-01');
  assert.equal(parseDay(''), '');
  assert.equal(parseDay('31/02/2026'), null);
  assert.equal(parseDay('n/a'), null);
});

const MAP = { collaborateur: 'C', fournisseur: 'F', commande: 'N', montantAttendu: 'T', debut: 'De', fin: 'A', quantite: 'Q', prixUnitaire: 'PU', libelle: 'L' };
const R = (C, N, T, Q, L, De = '2026-10-01', A = '2026-10-31', F = 'Alpha-1') => ({ C, F, N, T, Q, PU: Q ? T / Q : '', L, De, A, X: 'autre' });
const ROWS = [
  R('Alice', '3000000001-10-Dev', 1000, 2, 'Run'),
  R('Alice', '3000000001-10-Dev', 2500, 5, 'Projet A'),
  R('Alice', '3000000001-10-Dev', 500.25, 1, 'Projet B'),
  R('Bruno', '3000000002-20-Expertise', 4400, 8, 'Run', '2026-10-01', '2026-10-31', 'Beta-2'),
  R('Alice', '3000000001-10-Dev', 900, 2, 'Run', '2026-09-01', '2026-09-30'),
  R('Interne', '', 1650.45, 2.86, 'MO interne', '2026-10-01', '2026-10-31', ''),
  R('', '', 475, '', 'Provision astreinte'),
  { C: '', F: '', N: '', T: '', Q: '', PU: '', L: '', De: '', A: '', X: '' },
];

test('mapRows : lignes valides, motifs de rejet, colonnes source conservées', () => {
  const { valid, invalid } = M.mapRows(ROWS, MAP);
  assert.equal(valid.length, 5);
  assert.equal(valid[0].fields.commande, '3000000001');
  assert.equal(valid[0].fields.poste, '10');
  assert.equal(valid[0].fields.prestation, 'Dev');
  assert.deepEqual(valid[0].source, { X: 'autre' });
  assert.equal(invalid.length, 2); // la ligne vide est ignorée silencieusement
  assert.deepEqual(M.summarizeInvalid(invalid).map((x) => x.motif), ['sans n° de commande, sans fournisseur', 'sans collaborateur, sans n° de commande']);
  assert.equal(invalid[0].rowNumber, 7);
});

test('périodes détectées, de la plus récente à la plus ancienne', () => {
  const { valid } = M.mapRows(ROWS, MAP);
  const p = M.listPeriods(valid);
  assert.deepEqual(p.map((x) => `${x.debut}>${x.fin}:${x.lignes}`), ['2026-10-01>2026-10-31:4', '2026-09-01>2026-09-30:1']);
  assert.equal(p[0].mois, '2026-10');
  assert.equal(p[0].montant, 8400.25);
});

test('agrégation par période : somme des imputations, détail conservé', () => {
  const { valid } = M.mapRows(ROWS, MAP);
  const items = M.aggregate(valid, { debut: '2026-10-01', fin: '2026-10-31' });
  assert.equal(items.length, 2);
  const alice = items.find((i) => i.fields.collaborateur === 'Alice');
  assert.equal(alice.fields.montantAttendu, 4000.25);
  assert.equal(alice.fields.jours, 8);
  assert.deepEqual(alice.fields.periode, { debut: '2026-10-01', fin: '2026-10-31' });
  assert.deepEqual(alice.details.map((d) => d.libelle), ['Run', 'Projet A', 'Projet B']);
  assert.deepEqual(alice.details.map((d) => d.montant), [1000, 2500, 500.25]);
  assert.equal(alice.details[0].prixUnitaire, 500);
  // Sans période : tout le fichier
  assert.equal(M.aggregate(valid, null).find((i) => i.fields.collaborateur === 'Alice').fields.montantAttendu, 4900.25);
  const l = M.lineFromImport(alice, '2026-10', 'imp');
  assert.equal(l.statut, 'attendu');
  assert.equal(l.details.length, 3);
  assert.equal(l.jours, 8);
  assert.equal(l.prestation, 'Dev');
});

test('détection des doublons (collaborateur + commande + poste + mois)', () => {
  const existing = [mk()];
  const items = [
    { fields: { collaborateur: 'alice  MARTIN', fournisseur: 'X', commande: '4500000001', poste: '10', montantAttendu: 1200, jours: 2 } },
    { fields: { collaborateur: 'Alice Martin', fournisseur: 'X', commande: '4500000001', poste: '20', montantAttendu: 1200 } },
    { fields: { collaborateur: 'Chloé', fournisseur: 'X', commande: '4500000002', poste: '', montantAttendu: 500 } },
    { fields: { collaborateur: 'Chloe', fournisseur: 'X', commande: '4500000002', poste: '', montantAttendu: 500 } },
  ];
  const plan = M.planImport(existing, items, '2026-11');
  assert.equal(plan.nouvelles.length, 2);
  assert.equal(plan.doublons.length, 2);
  assert.equal(plan.doublons[0].existing, existing[0]);
  assert.deepEqual(plan.doublons[0].changes.map((c) => c.champ), ['fournisseur', 'montantAttendu', 'jours']);
  assert.equal(plan.doublons[1].inFile, true);
  assert.equal(M.planImport(existing, items, '2026-12').nouvelles.length, 3);
});

test('mise à jour par import : statut et PV conservés, détail remplacé', () => {
  const l = mk();
  M.applyPV(l, { fichierPV: 'x.pdf', montantPV: 1000 });
  M.updateFromImport(l, { fournisseur: 'Nouveau', poste: '20', montantAttendu: 1100, jours: 2 }, 'imp1', [{ libelle: 'Run', montant: 1100 }]);
  assert.equal(l.statut, 'pv_recu');
  assert.equal(l.fichierPV, 'x.pdf');
  assert.equal(l.montantAttendu, 1100);
  assert.equal(l.jours, 2);
  assert.equal(l.details.length, 1);
  assert.equal(M.computeEcart(l), -100);
});

test('export : colonnes et valeurs calculées', () => {
  const l = mk();
  M.applyPV(l, { fichierPV: 'x.pdf', montantPV: 990 });
  const [row] = M.exportRows([l]);
  assert.equal(row.ecart, -10);
  assert.equal(row.statut, 'PV reçu');
  assert.ok(row.datePV);
  for (const c of M.EXPORT_COLUMNS) assert.ok(c.key in row, c.key);
});

test('modèle d\'URL SAP', () => {
  const l = mk();
  assert.equal(M.fillTemplate('https://sap.example/po?n={commande}&p={poste}', l), 'https://sap.example/po?n=4500000001&p=10');
  assert.equal(M.fillTemplate('', l), '');
});

test('mois affiché au démarrage', () => {
  const L = (mois) => ({ mois });
  assert.equal(M.defaultMonth([L('2026-10'), L('2026-11')], '2026-11'), '2026-11');
  assert.equal(M.defaultMonth([L('2026-09'), L('2026-10')], '2026-11'), '2026-10');
  assert.equal(M.defaultMonth([L('2027-01')], '2026-11'), '2027-01');
  assert.equal(M.defaultMonth([], '2026-11'), '2026-11');
});

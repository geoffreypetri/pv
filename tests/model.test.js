// Tests des règles métier — exécuter : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { parseAmount, formatEuro, formatForSap, safeFilePart, addMonths, monthLabel } from '../js/format.js';

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

test('correspondance automatique des colonnes', () => {
  const headers = ['Nom ressource', 'Fournisseur', 'N° commande', 'Poste', 'Montant mensuel HT', 'Divers'];
  const m = M.guessMapping(headers);
  assert.equal(m.collaborateur, 'Nom ressource');
  assert.equal(m.fournisseur, 'Fournisseur');
  assert.equal(m.commande, 'N° commande');
  assert.equal(m.poste, 'Poste');
  assert.equal(m.montantAttendu, 'Montant mensuel HT');
  // La correspondance mémorisée est prioritaire
  assert.equal(M.guessMapping(headers, { collaborateur: 'Divers' }).collaborateur, 'Divers');
});

test('mapRows : lignes valides, invalides, vides ; colonnes source conservées', () => {
  const mapping = { collaborateur: 'C', fournisseur: 'F', commande: 'N', poste: 'P', montantAttendu: 'M' };
  const rows = [
    { C: 'Alice', F: 'F1', N: 4500000001, P: 10, M: '1 000,00', X: 'jours: 20' },
    { C: '', F: 'F1', N: '1', P: '', M: '10' },
    { C: '', F: '', N: '', P: '', M: '' },
    { C: 'Bob', F: 'F2', N: '2', P: '', M: 'n/a' },
  ];
  const { valid, invalid } = M.mapRows(rows, mapping);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].fields.commande, '4500000001');
  assert.equal(valid[0].fields.montantAttendu, 1000);
  assert.deepEqual(valid[0].source, { X: 'jours: 20' });
  assert.equal(invalid.length, 2);
  assert.equal(invalid[0].rowNumber, 3);
  assert.match(invalid[1].errors[0], /illisible/);
});

test('détection des doublons (collaborateur + commande + mois)', () => {
  const existing = [mk()];
  const rows = [
    { fields: { collaborateur: 'alice  MARTIN', fournisseur: 'X', commande: '4500000001', poste: '10', montantAttendu: 1200 } },
    { fields: { collaborateur: 'Chloé', fournisseur: 'X', commande: '4500000002', poste: '', montantAttendu: 500 } },
    { fields: { collaborateur: 'Chloe', fournisseur: 'X', commande: '4500000002', poste: '', montantAttendu: 500 } },
  ];
  const plan = M.planImport(existing, rows, '2026-11');
  assert.equal(plan.nouvelles.length, 1);
  assert.equal(plan.doublons.length, 2);
  assert.equal(plan.doublons[0].existing, existing[0]);
  assert.deepEqual(plan.doublons[0].changes.map((c) => c.champ), ['fournisseur', 'montantAttendu']);
  assert.equal(plan.doublons[1].inFile, true);
  // Autre mois : pas de doublon
  assert.equal(M.planImport(existing, rows, '2026-12').nouvelles.length, 2);
});

test('mise à jour par import : statut et PV conservés', () => {
  const l = mk();
  M.applyPV(l, { fichierPV: 'x.pdf', montantPV: 1000 });
  M.updateFromImport(l, { fournisseur: 'Nouveau', poste: '20', montantAttendu: 1100 }, 'imp1');
  assert.equal(l.statut, 'pv_recu');
  assert.equal(l.fichierPV, 'x.pdf');
  assert.equal(l.montantAttendu, 1100);
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

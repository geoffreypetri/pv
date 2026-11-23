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
  assert.equal(M.filterLines([a, b], { statuts: ['attendu'] })[0], a);
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

test('poste : extrait de « commande-poste », prioritaire sur une colonne Poste', () => {
  const m = { collaborateur: 'C', fournisseur: 'F', commande: 'N', poste: 'P', montantAttendu: 'T' };
  const r = (N, P) => M.mapRows([{ C: 'Alice', F: 'Alpha', N, P, T: 100 }], m).valid[0].fields;
  assert.deepEqual([r('3000000101-20-Prestation', '').commande, r('3000000101-20-Prestation', '').poste], ['3000000101', '20-Prestation']);
  assert.equal(r('3000000101-20-Prestation', '99').poste, '20-Prestation');
  assert.equal(r('3000000101-10', '').poste, '10');
  assert.equal(r('3000000101', '30').poste, '30'); // pas de poste dans la commande : colonne Poste
});

test('parseCommande : « commande-poste-libellé »', () => {
  assert.deepEqual(M.parseCommande('3000000101-10-Prestation de Développement Full stack'),
    { commande: '3000000101', poste: '10-Prestation de Développement Full stack', prestation: '' });
  assert.equal(M.parseCommande('3000000101-20-Prestation de business analyse - lot 2').poste, '20-Prestation de business analyse - lot 2');
  assert.equal(M.parseCommande('3000000101-10').poste, '10');
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
  assert.equal(valid[0].fields.poste, '10-Dev');
  assert.equal(valid[0].fields.prestation, '');
  assert.deepEqual(valid[0].source, { X: 'autre' });
  assert.equal(invalid.length, 2); // la ligne vide est ignorée silencieusement
  assert.deepEqual(M.summarizeInvalid(invalid).map((x) => x.motif), ['sans n° de commande, sans fournisseur', 'sans collaborateur, sans n° de commande']);
  assert.equal(invalid[0].rowNumber, 7);
});

test('agrégation : toutes les périodes, une ligne par mois × collaborateur × commande × poste', () => {
  const { valid } = M.mapRows(ROWS, MAP);
  const items = M.aggregate(valid);
  assert.deepEqual(items.map((i) => `${i.fields.mois} ${i.fields.collaborateur}`), ['2026-10 Alice', '2026-10 Bruno', '2026-09 Alice']);
  const alice = items[0];
  assert.equal(alice.fields.montantAttendu, 4000.25);
  assert.equal(alice.fields.jours, 8);
  assert.deepEqual(alice.fields.periode, { debut: '2026-10-01', fin: '2026-10-31' });
  assert.deepEqual(alice.details.map((d) => d.libelle), ['Run', 'Projet A', 'Projet B']);
  assert.equal(alice.details[0].prixUnitaire, 500);
  assert.equal(items[2].fields.montantAttendu, 900);
  // Fichier sans période : mois fourni
  const sansDates = M.mapRows(ROWS.map(({ De, A, ...r }) => r), { ...MAP, debut: undefined, fin: undefined }).valid;
  assert.deepEqual(M.aggregate(sansDates, { mois: '2026-08' }).map((i) => i.fields.mois), ['2026-08', '2026-08']);
  const l = M.lineFromImport(alice, '2026-10', 'imp');
  assert.equal(l.statut, 'attendu');
  assert.equal(l.details.length, 3);
  assert.equal(l.poste, '10-Dev');
});

/* ---------- Synchronisation ---------- */

const item = (over = {}, details = [{ libelle: 'Run', quantite: 2, prixUnitaire: 500, montant: 1000 }]) => ({
  fields: { mois: '2026-11', collaborateur: 'Alice Martin', fournisseur: 'Société Fictive & Cie', commande: '4500000001', poste: '10',
    prestation: '', montantAttendu: 1000, jours: 2, periode: { debut: '2026-11-01', fin: '2026-11-30' }, ...over },
  details, source: {},
});
const imported = (over = {}) => {
  const l = M.lineFromImport(item(over), over.mois || '2026-11', 'imp0');
  return l;
};
const sync = (lines, items, opts) => {
  const plan = M.planSync(lines, items, opts);
  const data = { lignes: lines };
  M.applySync(data, plan, 'imp1');
  return { plan, data };
};

test('sync : création des lignes absentes de l\'application', () => {
  const { plan, data } = sync([], [item(), item({ collaborateur: 'Bruno', mois: '2026-10' })]);
  assert.equal(plan.creations.length, 2);
  assert.deepEqual(plan.moisCouverts, ['2026-10', '2026-11']);
  assert.deepEqual(data.lignes.map((l) => l.mois), ['2026-11', '2026-10']);
});

test('sync : Abraxio écrase les données existantes (statut, PV, commentaire conservés)', () => {
  const l = imported();
  M.applyPV(l, { fichierPV: 'x.pdf', montantPV: 1000, commentaire: 'note' });
  l.fournisseur = 'Saisie manuelle';
  const { plan } = sync([l], [item({ montantAttendu: 1100, jours: 2.2, collaborateur: 'ALICE MARTIN' },
    [{ libelle: 'Run', quantite: 2.2, prixUnitaire: 500, montant: 1100 }])]);
  assert.equal(plan.modifications.length, 1);
  assert.deepEqual(plan.modifications[0].changes.map((c) => c.champ), ['collaborateur', 'fournisseur', 'montantAttendu', 'jours', 'details']);
  assert.equal(l.collaborateur, 'ALICE MARTIN');
  assert.equal(l.fournisseur, 'Société Fictive & Cie');
  assert.equal(l.montantAttendu, 1100);
  assert.equal(l.details[0].montant, 1100);
  assert.equal(l.statut, 'pv_recu');
  assert.equal(l.fichierPV, 'x.pdf');
  assert.equal(l.commentaire, 'note');
  assert.equal(M.computeEcart(l), -100);
  assert.match(l.historique.at(-1).detail, /Mis à jour depuis Abraxio : Collaborateur, Fournisseur, Montant attendu/);
});

test('sync : ligne identique → rien ne change', () => {
  const l = imported();
  const before = JSON.stringify(l.historique);
  const { plan } = sync([l], [item()]);
  assert.equal(plan.identiques.length, 1);
  assert.equal(plan.modifications.length, 0);
  assert.equal(JSON.stringify(l.historique), before);
});

test('sync : ligne « BR créé » jamais modifiée, divergence signalée puis levée', () => {
  const l = imported();
  M.applyPV(l, { fichierPV: 'x.pdf', montantPV: 1000 });
  M.validate(l);
  M.setBR(l, { numeroBR: '42' });
  const { plan } = sync([l], [item({ montantAttendu: 1200 })]);
  assert.equal(plan.protegees.length, 1);
  assert.equal(l.montantAttendu, 1000);
  assert.equal(l.statut, 'br_cree');
  assert.equal(l.alerteAbraxio.type, 'divergence');
  assert.deepEqual(l.alerteAbraxio.changes.map((c) => [c.champ, c.avant, c.apres]), [['montantAttendu', 1000, 1200]]);
  sync([l], [item()]);
  assert.equal(l.alerteAbraxio, null);
});

test('sync : ligne « Validé » dont l\'écart devient non nul → repasse à « PV reçu »', () => {
  const l = imported();
  M.applyPV(l, { fichierPV: 'x.pdf', montantPV: 1000 });
  M.validate(l);
  const { plan } = sync([l], [item({ montantAttendu: 1050 })]);
  assert.equal(plan.modifications[0].revalidation, true);
  assert.equal(l.statut, 'pv_recu');
  assert.match(l.historique.at(-1).detail, /à revalider/);
  // Écart dans la tolérance, ou changement sans effet sur l'écart : le statut reste « Validé »
  const l2 = imported();
  M.applyPV(l2, { fichierPV: 'x.pdf', montantPV: 1000 });
  M.validate(l2);
  sync([l2], [item({ montantAttendu: 1005 })], { tolerance: 10 });
  assert.equal(l2.statut, 'valide');
  sync([l2], [item({ montantAttendu: 1000, prestation: 'Renommée' })]);
  assert.equal(l2.statut, 'valide');
});

test('sync : lignes absentes d\'Abraxio signalées (mois couverts, lignes importées seulement)', () => {
  const restee = imported({ collaborateur: 'Restée' });
  const disparue = imported({ collaborateur: 'Disparue' });
  const autreMois = imported({ collaborateur: 'Autre mois', mois: '2026-01' });
  const manuelle = M.createLine({ collaborateur: 'Manuelle', fournisseur: 'X', commande: '1', montantAttendu: 1 }, { mois: '2026-11' });
  const { plan } = sync([restee, disparue, autreMois, manuelle], [item({ collaborateur: 'Restée' })]);
  assert.deepEqual(plan.absentes, [disparue]);
  assert.equal(disparue.alerteAbraxio.type, 'absente');
  assert.equal(autreMois.alerteAbraxio, null);
  assert.equal(manuelle.alerteAbraxio, null);
  const n = disparue.historique.length;
  sync([restee, disparue], [item({ collaborateur: 'Restée' })]); // toujours absente : pas de nouvel historique
  assert.equal(disparue.historique.length, n);
  const { plan: p2 } = sync([restee, disparue], [item({ collaborateur: 'Restée' }), item({ collaborateur: 'Disparue' })]);
  assert.deepEqual(p2.reapparues, [disparue]);
  assert.equal(disparue.alerteAbraxio, null);
});

test('sync : litige modifié comme les autres statuts non finaux', () => {
  const l = imported();
  M.setLitige(l, 'x');
  sync([l], [item({ montantAttendu: 900 })]);
  assert.equal(l.montantAttendu, 900);
  assert.equal(l.statut, 'litige');
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

test('vue à plat : filtres année, mois, fournisseurs, statuts, alertes et tri par colonne', () => {
  const L = (mois, collaborateur, fournisseur, statut, montantAttendu, alerte = null) =>
    ({ ...mk({ collaborateur, fournisseur, montantAttendu }), mois, statut, alerteAbraxio: alerte });
  const lines = [
    L('2026-10', 'Alice', 'F1', 'attendu', 100),
    L('2026-11', 'Bruno', 'F2', 'br_cree', 300, { type: 'divergence' }),
    L('2025-12', 'Chloé', 'F1', 'pv_recu', 200),
  ];
  const names = (ls) => ls.map((l) => l.collaborateur).join(',');
  assert.equal(names(M.filterLines(lines, { annee: '2026' })), 'Alice,Bruno');
  assert.equal(names(M.filterLines(lines, { mois: ['2026-10', '2025-12'] })), 'Alice,Chloé');
  assert.equal(names(M.filterLines(lines, { fournisseurs: ['F1'] })), 'Alice,Chloé');
  assert.equal(names(M.filterLines(lines, { statuts: ['br_cree', 'pv_recu'] })), 'Bruno,Chloé');
  assert.equal(names(M.filterLines(lines, { alertes: true })), 'Bruno');
  assert.equal(names(M.filterLines(lines, { annee: '2026', fournisseurs: ['F1'] })), 'Alice');
  assert.equal(names(M.sortLines(lines)), 'Bruno,Alice,Chloé'); // mois décroissant
  assert.equal(names(M.sortLines(lines, { key: 'montantAttendu', dir: 'desc' })), 'Bruno,Chloé,Alice');
  assert.equal(names(M.sortLines(lines, { key: 'collaborateur' })), 'Alice,Bruno,Chloé');
  assert.deepEqual(M.yearsInData(lines), ['2026', '2025']);
});

test('nom de fichier PV : « <commande>_<fournisseur>_AAAA-MM.pdf »', () => {
  const l = mk({ commande: '3000000101', fournisseur: 'Société Fictive & Cie' });
  assert.equal(M.pvFileName(l), '3000000101_Societe-Fictive-Cie_2026-11.pdf');
  assert.equal(M.pvPath(l, '_2'), 'PV/2026-11/3000000101_Societe-Fictive-Cie_2026-11_2.pdf');
});

test('lecture du n° de commande et du mois dans le nom d\'un PV', () => {
  const p = (n) => { const r = M.parsePvFileName(n); return `${r.commande}|${r.mois}`; };
  assert.equal(p('3000000101_PRESTATAIRE-ALPHA_2026-10.pdf'), '3000000101|2026-10');
  assert.equal(p('PV 3000000101 octobre 2026.pdf'), '3000000101|2026-10');
  assert.equal(p('PV_Août-2026_3000000101.PDF'), '3000000101|2026-08');
  assert.equal(p('3000000101-202610.pdf'), '3000000101|2026-10');
  assert.equal(p('PV 10-2026 cde 3000000101.pdf'), '3000000101|2026-10');
  assert.equal(p('scan0001.pdf'), '|');
  assert.equal(p('3000000101.pdf'), '3000000101|');
});

test('rapprochement PV ↔ lignes par commande et mois', () => {
  const a = { ...mk({ commande: '3000000101' }), mois: '2026-10' };
  const b = { ...mk({ commande: '3000000101' }), mois: '2026-09' };
  const c = { ...mk({ commande: '3000000102' }), mois: '2026-10' };
  const r = M.matchPv([a, b, c], { commande: '3000000101', mois: '2026-10' });
  assert.deepEqual([r.exactes, r.memeCommande, r.memeMois], [[a], [b], [c]]);
  assert.equal(M.matchPv([a, b, c], { commande: '', mois: '' }).exactes.length, 0);
});

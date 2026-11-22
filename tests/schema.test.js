// Tests des migrations de data.json — exécuter : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, createEmptyData, SCHEMA_VERSION, MIGRATIONS } from '../js/schema.js';

test('des données vierges sont déjà au schéma courant', () => {
  const r = migrate(createEmptyData('0.1.0'));
  assert.equal(r.migrated, false);
  assert.equal(r.readOnly, false);
  assert.equal(r.data.schemaVersion, SCHEMA_VERSION);
});

test('schéma 0 (sans schemaVersion) → 1 : champs complétés, données conservées', () => {
  const v0 = { lignes: [{ id: 'a', mois: '2026-10', collaborateur: 'Alice Test', montantAttendu: 1000 }] };
  const r = migrate(v0, { target: 1 });
  assert.equal(r.fromVersion, 0);
  assert.equal(r.migrated, true);
  assert.equal(r.data.schemaVersion, 1);
  const l = r.data.lignes[0];
  assert.equal(l.collaborateur, 'Alice Test');
  assert.equal(l.montantAttendu, 1000);
  assert.equal(l.statut, 'attendu');
  assert.deepEqual(l.historique, []);
  assert.equal(l.montantPV, null);
  assert.deepEqual(r.data.config.importMapping, {});
  assert.deepEqual(r.data.commandes, {});
  assert.ok(Array.isArray(r.data.imports));
});

test('la migration ne modifie pas l\'objet d\'origine', () => {
  const v0 = { lignes: [{ id: 'a', mois: '2026-10' }] };
  const copy = structuredClone(v0);
  migrate(v0, { target: 1 });
  assert.deepEqual(v0, copy);
});

test('la configuration existante est conservée et complétée', () => {
  const v0 = { config: { importMapping: { collaborateur: 'Nom' } } };
  const r = migrate(v0, { target: 1 });
  assert.equal(r.data.config.importMapping.collaborateur, 'Nom');
  assert.equal(r.data.config.toleranceEcart, 0);
});

test('les migrations successives s\'enchaînent dans l\'ordre', () => {
  const migrations = {
    ...MIGRATIONS,
    2: (d) => ({ ...d, lignes: d.lignes.map((l) => ({ ...l, jours: l.jours ?? null })) }),
    3: (d) => ({ ...d, renomme: true }),
  };
  const r = migrate({ lignes: [{ id: 'x', mois: '2026-01' }] }, { target: 3, migrations });
  assert.equal(r.data.schemaVersion, 3);
  assert.equal(r.data.lignes[0].jours, null);
  assert.equal(r.data.renomme, true);
  assert.equal(r.fromVersion, 0);
});

test('une migration manquante lève une erreur explicite', () => {
  assert.throws(() => migrate({ schemaVersion: 1 }, { target: 2 }), /Migration manquante vers le schéma 2/);
});

test('données écrites par une version plus récente → lecture seule, données intactes', () => {
  const futur = { schemaVersion: SCHEMA_VERSION + 1, lignes: [{ nouveauChamp: 1 }] };
  const r = migrate(futur);
  assert.equal(r.readOnly, true);
  assert.equal(r.migrated, false);
  assert.equal(r.data, futur);
});

test('contenu invalide refusé', () => {
  assert.throws(() => migrate(null));
  assert.throws(() => migrate([]));
});

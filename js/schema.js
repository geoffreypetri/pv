// Format de data.json : version du schéma, données vierges et migrations.
// Module pur : testable sous Node (voir tests/schema.test.js).
//
// RÈGLE : toute modification du format de data.json doit
//   1. incrémenter SCHEMA_VERSION,
//   2. ajouter MIGRATIONS[nouvelleVersion] = (data) => data transformé,
//   3. ajouter un test dans tests/schema.test.js.

export const SCHEMA_VERSION = 3;

export const STATUTS = Object.freeze({
  ATTENDU: 'attendu',
  PV_RECU: 'pv_recu',
  VALIDE: 'valide',
  BR_CREE: 'br_cree',
  LITIGE: 'litige',
});

export const STATUT_LABELS = Object.freeze({
  attendu: 'Attendu',
  pv_recu: 'PV reçu',
  valide: 'Validé',
  br_cree: 'BR créé',
  litige: 'Litige',
});

/** Ordre « normal » du cycle de vie (le litige est possible à tout moment). */
export const CYCLE = Object.freeze(['attendu', 'pv_recu', 'valide', 'br_cree']);

/**
 * Champs de l'app alimentés par l'import Abraxio (« Données Consommé ») :
 * une ligne du fichier = une imputation (collaborateur, période, jours × tarif = montant).
 * Les imputations d'une même période sont additionnées par collaborateur × commande × poste.
 */
export const IMPORT_FIELDS = Object.freeze([
  { key: 'collaborateur', label: 'Collaborateur', required: true },
  { key: 'fournisseur', label: 'Fournisseur', required: true },
  { key: 'commande', label: 'N° de commande', required: true, hint: 'Format Abraxio « commande-poste-libellé » : le poste (10, 20…) est extrait automatiquement.' },
  { key: 'poste', label: 'Poste de commande', required: false, hint: 'Facultatif : le poste est lu dans « commande-poste » quand il y figure.' },
  { key: 'montantAttendu', label: 'Montant HT', required: true },
  { key: 'debut', label: 'Début de période (De)', required: false },
  { key: 'fin', label: 'Fin de période (A)', required: false },
  { key: 'quantite', label: 'Quantité (jours)', required: false },
  { key: 'prixUnitaire', label: 'Prix unitaire HT', required: false },
  { key: 'libelle', label: 'Libellé du détail', required: false, hint: 'Ex. ligne budgétaire, affiché dans le détail.' },
]);

export function defaultConfig() {
  return {
    // Correspondance champ de l'app → en-tête de colonne du fichier importé.
    importMapping: {},
    // Feuille du classeur à importer (mémorisée avec la correspondance).
    importSheet: '',
    // Écart toléré (en euros) avant de signaler une différence PV / attendu.
    toleranceEcart: 0,
    // Modèles d'URL SAP (optionnels, jamais codés en dur). Variables : {commande} {poste} {br}
    sapUrlTemplates: { commande: '', br: '' },
  };
}

export function createEmptyData(appVersion = '') {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    app: { creeAvec: appVersion, creeLe: now, enregistreAvec: appVersion, enregistreLe: now },
    config: defaultConfig(),
    imports: [],
    lignes: [],
    // Réservé V2 (suivi de consommation) : informations par commande,
    // indexées par n° de commande (montant total, date de fin…).
    commandes: {},
  };
}

/** Complète une ligne avec tous les champs attendus (valeurs par défaut). */
export function normalizeLine(l) {
  return {
    id: l.id,
    mois: l.mois,
    collaborateur: l.collaborateur ?? '',
    fournisseur: l.fournisseur ?? '',
    commande: l.commande ?? '',
    poste: l.poste ?? '',
    montantAttendu: l.montantAttendu ?? null,
    // Libellé de la prestation (ex. extrait de « 3000000101-10-Prestation de … »).
    prestation: l.prestation ?? '',
    // Total des jours importés et période couverte (« De » / « A »).
    jours: l.jours ?? null,
    periode: l.periode ?? null,
    // Imputations additionnées pour obtenir le montant attendu : { libelle, quantite, prixUnitaire, montant, ligne }.
    details: Array.isArray(l.details) ? l.details : [],
    montantPV: l.montantPV ?? null,
    statut: l.statut ?? STATUTS.ATTENDU,
    numeroBR: l.numeroBR ?? '',
    dateBR: l.dateBR ?? '',
    fichierPV: l.fichierPV ?? '',
    commentaire: l.commentaire ?? '',
    historique: Array.isArray(l.historique) ? l.historique : [],
    importId: l.importId ?? null,
    // Alerte de synchronisation : null | { type: 'absente' | 'divergence', date, importId, changes? }
    //  - absente : la ligne n'est plus dans le dernier export Abraxio ;
    //  - divergence : ligne « BR créé » (non modifiable) dont les données diffèrent d'Abraxio.
    alerteAbraxio: l.alerteAbraxio ?? null,
    // Colonnes du fichier source non mappées (utile pour les évolutions : jours facturés…).
    source: l.source ?? {},
    creeLe: l.creeLe ?? null,
    modifieLe: l.modifieLe ?? null,
  };
}

/**
 * Migrations : MIGRATIONS[n] transforme des données au schéma n-1 en schéma n.
 * Le schéma 0 désigne un fichier sans `schemaVersion` (ancien ou créé à la main).
 */
export const MIGRATIONS = {
  1: (d) => {
    const base = createEmptyData();
    return {
      ...base,
      ...d,
      app: { ...base.app, ...(d.app || {}) },
      config: { ...defaultConfig(), ...(d.config || {}) },
      imports: Array.isArray(d.imports) ? d.imports : [],
      lignes: (Array.isArray(d.lignes) ? d.lignes : []).map(normalizeLine),
      commandes: d.commandes && typeof d.commandes === 'object' ? d.commandes : {},
    };
  },
  // v2 : import par période avec détail des imputations additionnées.
  2: (d) => ({
    ...d,
    config: { importSheet: '', ...d.config },
    lignes: (Array.isArray(d.lignes) ? d.lignes : []).map((l) => ({
      ...l,
      prestation: l.prestation ?? '',
      jours: l.jours ?? null,
      periode: l.periode ?? null,
      details: Array.isArray(l.details) ? l.details : [],
    })),
  }),
  // v3 : synchronisation avec Abraxio (alerte « absente » / « divergence »).
  3: (d) => ({
    ...d,
    lignes: (Array.isArray(d.lignes) ? d.lignes : []).map((l) => ({ ...l, alerteAbraxio: l.alerteAbraxio ?? null })),
  }),
};

/**
 * Prépare des données lues sur disque.
 * @returns {{ data, fromVersion, migrated: boolean, readOnly: boolean }}
 *   - migrated : des migrations ont été appliquées (sauvegarder l'ancien fichier avant d'écrire) ;
 *   - readOnly : données écrites par une version plus récente de l'app.
 */
export function migrate(raw, { target = SCHEMA_VERSION, migrations = MIGRATIONS } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Contenu de data.json invalide (objet JSON attendu).');
  }
  const fromVersion = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
  if (fromVersion > target) {
    return { data: raw, fromVersion, migrated: false, readOnly: true };
  }
  let data = structuredClone(raw);
  for (let v = fromVersion + 1; v <= target; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new Error(`Migration manquante vers le schéma ${v}.`);
    data = step(data);
    data.schemaVersion = v;
  }
  return { data, fromVersion, migrated: fromVersion !== target, readOnly: false };
}

# Suivi PV

Application web installable (PWA) pour suivre chaque mois les **PV de service fait** des fournisseurs de prestation :
import des lignes attendues depuis Abraxio, dépôt et contrôle des PV, validation, préparation du **BR** (bon de réception)
dans SAP, export Excel.

**Les données restent strictement sur le poste.** L'application est un simple site statique : elle lit et écrit les
fichiers d'un dossier local choisi par l'utilisateur (par exemple dans OneDrive). Aucune donnée métier n'est envoyée
sur le réseau, stockée dans le dépôt ou mise en cache par le navigateur. Pas d'analytics, pas d'appel externe
(une politique de sécurité `Content-Security-Policy` l'impose dans `index.html`).

- Navigateur : **Microsoft Edge** récent sous Windows (ou Chrome). Firefox et Safari ne sont pas pris en charge
  (ils n'offrent pas l'accès aux dossiers locaux).
- Technologies : HTML, CSS, JavaScript (modules ES), aucun framework, aucune étape de build.
  Seule bibliothèque : [SheetJS](https://sheetjs.com) 0.20.3, copiée dans `vendor/` (licence Apache 2.0, `vendor/xlsx.LICENSE`).

---

## Sommaire

1. [Installer l'application](#1-installer-lapplication)
2. [Premier lancement](#2-premier-lancement)
3. [Déroulé mensuel](#3-déroulé-mensuel)
4. [Sauvegarde des données](#4-sauvegarde-des-données)
5. [Me remplacer : ce qu'il faut savoir](#5-me-remplacer--ce-quil-faut-savoir)
6. [Développement](#6-développement)
7. [Publier une nouvelle version](#7-publier-une-nouvelle-version)
8. [Organisation du code et format des données](#8-organisation-du-code-et-format-des-données)

---

## 1. Installer l'application

1. Ouvrir dans Edge l'adresse de l'application : `https://<utilisateur>.github.io/<dépôt>/`.
2. Cliquer sur l'icône **« Application disponible »** (⊕) à droite de la barre d'adresse, ou passer par le menu `…`
   → *Applications* → *Installer Suivi PV*.
3. L'application s'ouvre dans sa propre fenêtre et apparaît dans le menu Démarrer. Elle fonctionne aussi hors ligne.

Les mises à jour arrivent toutes seules : quand une nouvelle version est publiée, une bannière
**« Nouvelle version X.Y.Z disponible »** apparaît avec la liste des nouveautés. Cliquer sur **Recharger** quand on
n'a pas de saisie en cours (l'application ne se recharge jamais d'elle-même).

## 2. Premier lancement

1. Cliquer sur **« Choisir le dossier de travail… »** et sélectionner un dossier de votre OneDrive professionnel
   (par exemple `OneDrive - <Entreprise>\Documents`). Accepter la demande d'accès en lecture/écriture.
2. L'application crée (ou reprend) le dossier `Suivi-PV` :

   ```
   Suivi-PV/
     data.json          ← toutes les lignes de tous les mois + configuration
     data.backup-*.json ← copies de sécurité (avant migration, ou manuelles)
     imports/           ← copie brute de chaque export Abraxio importé
     PV/AAAA-MM/        ← PDF des PV rangés et renommés
   ```

   Si vous choisissez directement un dossier nommé `Suivi-PV` (ou contenant déjà un `data.json`), il est utilisé tel quel.
3. Aux lancements suivants, le dossier est retrouvé automatiquement. Edge peut redemander l'autorisation d'accès :
   cliquer sur **« Ouvrir « Suivi-PV » »** puis accepter.

Pour essayer sans vraies données, importer le fichier `exemple-abraxio.xlsx` fourni : un export fictif qui reproduit la
structure de l'export Abraxio (feuille « Données Consommé », deux périodes, 10 collaborateurs).

## 3. Déroulé mensuel

Statuts d'une ligne (un collaborateur × un mois) :
**Attendu → PV reçu → Validé → BR créé**, et **Litige** possible à tout moment.

| Étape | Action dans l'application |
|---|---|
| **1. Import** (début de mois, ou dès qu'Abraxio change) | **Importer Abraxio** → choisir l'export Excel complet (voir ci-dessous). Au premier import, vérifier la feuille et les colonnes (elles sont ensuite mémorisées et l'étape est sautée). Le **récapitulatif** liste par onglets les lignes nouvelles, mises à jour, « BR créé » divergentes, absentes d'Abraxio, inchangées et ignorées ; cliquer sur une ligne affiche les imputations additionnées → **Appliquer**. Le fichier brut est copié dans `imports/`. |
| **2. Réception des PV** | **Glisser-déposer les PDF n'importe où dans la fenêtre** (un ou plusieurs à la fois), ou bouton **Déposer des PV**. Chaque PV est rattaché à sa ligne grâce au **n° de commande** et au **mois** (AAAA-MM, ou mois en lettres + année) lus dans le nom du fichier. Sans correspondance, une alerte l'indique et propose de choisir la ligne (lignes de la même commande ou du même mois en tête). On peut aussi lâcher le PDF directement sur une ligne. Saisir ensuite le montant figurant sur le PV : l'écart avec le montant attendu s'affiche en direct. Le PDF est rangé dans `PV/AAAA-MM/` sous le nom `<n° de commande>_<fournisseur>_AAAA-MM.pdf`. La ligne passe à « PV reçu » ; un écart non nul apparaît en rouge. L'icône document rouvre le PV. |
| **3. Validation** | Bouton **Valider** (confirmation demandée en cas d'écart). La fiche **« Prêt pour SAP »** s'ouvre : n° de commande, poste et montant, à copier avec l'icône qui apparaît au survol de chaque champ (le montant est copié au format `1234,50`). |
| **4. BR dans SAP** | Créer le BR dans SAP, puis saisir le **n° de BR** (et sa date) dans la fiche → la ligne passe à « BR créé ». |
| **Litige** | Cliquer sur la ligne → **Signaler un litige** (motif conservé dans le commentaire et l'historique). **Lever le litige** ramène la ligne à son statut précédent. |
| **Export** | **Exporter** : classeur Excel des lignes affichées (filtres appliqués) avec toutes les colonnes utiles (mois, période, jours, montants, écart, statut, BR, dates, chemin du PV, commentaire) et une feuille « Détail » des imputations. |

### L'export Abraxio

Exporter le budget depuis Abraxio, puis l'importer tel quel. L'application lit la feuille **« Données Consommé »** :
une ligne = une imputation de temps d'un collaborateur sur une période (colonnes **De** et **A**), avec
`Quantité` (jours) × `P.U.H.T.` = `Total HT`, ventilée par ligne budgétaire.

| Champ de l'application | Colonne Abraxio |
|---|---|
| Collaborateur | `Collaborateur` |
| Fournisseur | `Fournisseur` |
| N° de commande et poste | `Numéros de commande associés` (format `<commande>-<poste>`, par ex. `3000000101-10-Prestation de …` → commande `3000000101`, poste `10-Prestation de …`) |
| Montant HT | `Total HT` |
| Période | `De` et `A` |
| Jours / prix unitaire | `Quantité` / `P.U.H.T.` |
| Libellé du détail | `Libellé budget` |

Toutes les périodes du fichier sont importées en une fois. Les imputations sont **additionnées par mois ×
collaborateur × commande × poste** (le mois est celui de la colonne `De`) : le montant attendu est la somme des
`Total HT`, les jours la somme des `Quantité`. Chaque imputation reste listée (libellé, jours,
prix unitaire, montant, n° de ligne dans le fichier) dans l'écran d'import, dans la fiche de la ligne et dans la
feuille « Détail » de l'export Excel, pour pouvoir vérifier.

Sont ignorées (et décomptées dans l'écran d'import) : les lignes **sans n° de commande** (profils internes) et
**sans collaborateur** (factures, par exemple les provisions d'astreinte).

Un fichier plus simple (une ligne par collaborateur, sans colonnes De/A) reste accepté : le mois est alors demandé.

#### Abraxio fait foi

Chaque import **synchronise** l'application avec Abraxio :

- **ligne absente de l'application** → créée au statut « Attendu » ;
- **ligne existante** (même mois, collaborateur, commande et poste) → les données d'Abraxio **remplacent** celles de
  l'application (collaborateur, fournisseur, poste, prestation, montant attendu, jours, période, détail). Le statut, le
  PV déposé, le montant du PV, le n° de BR et le commentaire ne sont pas touchés. Une ligne « Validé » dont l'écart
  devient non nul **repasse à « PV reçu »** pour être revalidée ;
- **ligne « BR créé »** (état final) → **jamais modifiée**. Si Abraxio indique d'autres valeurs, la ligne reçoit une
  alerte « divergence » qui détaille les différences ;
- **ligne importée précédemment mais absente du nouvel export** (pour un mois couvert par l'export) → conservée et
  marquée **« Absente d'Abraxio »** : à vous de la supprimer si besoin. Les lignes créées à la main ne sont jamais
  concernées.

Les lignes en alerte portent une icône ⚠ dans la colonne Statut ; le filtre **Alertes Abraxio** les regroupe.
Les alertes disparaissent d'elles-mêmes quand un import ultérieur redevient cohérent.

### Le tableau

Toutes les lignes sont dans **un seul tableau**, comme dans Excel, **groupées par mois** (un clic sur l'en-tête d'un mois le replie ; l'en-tête indique le nombre de lignes, le total attendu et les BR créés). Filtres combinables :
**recherche** (collaborateur, commande, BR, commentaire), **Année** (année en cours à l'ouverture), **Mois**,
**Fournisseur** et **Statut** (plusieurs valeurs possibles), **Alertes Abraxio**. Un clic sur un en-tête de colonne trie
le tableau à l'intérieur de chaque mois (croissant, décroissant, puis tri par défaut : lignes à traiter en premier).
Les compteurs par statut, l'avancement des BR et la file **« À faire »** (PV manquants / à valider / BR à créer /
litiges) portent sur les lignes filtrées ; un clic sur un compteur filtre sur ce statut.

Cliquer sur une ligne ouvre sa **fiche détaillée** : modification des informations, du montant PV, du BR, commentaire,
historique daté des changements de statut, retour à l'étape précédente en cas d'erreur, suppression.
**Nouvelle ligne** permet de créer une ligne manuellement (prestation absente de l'export).

Chaque modification est **enregistrée automatiquement** dans `data.json` (état affiché dans le pied de page).

**Copier** : au survol du n° de commande, du n° de BR (tableau, fiches) ou des champs de la fiche « Prêt pour SAP »,
une icône de copie apparaît à l'intérieur du champ ; un clic copie la valeur (une coche confirme la copie).

## 4. Sauvegarde des données

- **Toutes les données sont dans le dossier `Suivi-PV`.** Le sauvegarder suffit ; placé dans OneDrive, il bénéficie de
  la synchronisation et de l'**historique des versions** OneDrive (clic droit sur `data.json` → *Historique des versions*).
- Écriture sûre : Edge écrit d'abord dans un fichier temporaire (`data.json.crswap`) et ne remplace `data.json`
  qu'une fois l'écriture terminée ; l'application relit ensuite le fichier pour vérifier qu'il est complet.
- **Paramètres → Créer une copie de sauvegarde maintenant** écrit `data.backup-AAAAMMJJ-HHMM.json`.
- Lors d'une mise à jour qui change le format des données, l'ancien fichier est automatiquement sauvegardé
  (`data.backup-AAAAMMJJ-HHMM.json`) avant conversion.
- **Restaurer** : fermer l'application, remplacer `data.json` par la copie voulue (renommée en `data.json`), relancer.
- N'ouvrir l'application que dans **une seule fenêtre** à la fois : une deuxième fenêtre s'ouvre en lecture seule.
  Éviter aussi d'utiliser le même dossier depuis deux ordinateurs en même temps (pas de fusion des modifications).

## 5. Me remplacer : ce qu'il faut savoir

1. **Accès au dossier** : demander l'accès (partage OneDrive/SharePoint) au dossier `Suivi-PV`, ou en recevoir une copie.
2. **Ouvrir l'application** dans Edge à l'adresse habituelle, l'installer si besoin, puis *Choisir le dossier de travail*
   en désignant ce dossier `Suivi-PV`. Tout l'historique (lignes, PV, imports) est retrouvé.
3. **Chaque mois** : importer l'export Abraxio complet (il fait foi), puis suivre le [déroulé mensuel](#3-déroulé-mensuel).
   La file « À faire » indique ce qui reste ; le filtre « Alertes Abraxio » montre les lignes à examiner.
4. **Export Abraxio** : la correspondance des colonnes est mémorisée ; si le format de l'export change, l'écran de
   correspondance le signale (colonnes non trouvées) — il suffit de refaire le choix. *Paramètres* montre la
   correspondance actuelle.
5. **En cas de problème** :
   - « Lecture seule : version plus récente » → recharger l'application (Ctrl+F5) pour obtenir la dernière version.
   - « Lecture seule : déjà ouverte dans une autre fenêtre » → fermer l'autre fenêtre/onglet, recharger.
   - « data.json illisible » → restaurer une version précédente (voir [Sauvegarde](#4-sauvegarde-des-données)).
   - « Erreur d'enregistrement » dans le pied de page → vérifier que OneDrive est connecté et le dossier accessible,
     puis refaire la dernière action.
6. Aucune donnée n'est stockée ailleurs que dans ce dossier : vider le cache d'Edge ou désinstaller l'application ne
   supprime rien d'important (il faudra seulement re-choisir le dossier).

## 6. Développement

Prérequis : un navigateur Chromium et, pour les tests, Node.js ≥ 20. Aucune dépendance à installer.

```bash
python -m http.server 8080
```

ou

```bash
npx serve .
```

puis ouvrir <http://localhost:8080/>. Sur `localhost`, le service worker privilégie le réseau : les modifications
du code sont visibles en rechargeant la page.

Tests unitaires (formatage, règles métier, migrations du format de données, cohérence du service worker) :

```bash
npm test
```

Scripts utiles (`scripts/`) :

| Commande | Rôle |
|---|---|
| `node scripts/release.mjs patch "Note"` | Prépare une version (voir ci-dessous). |
| `node scripts/make-example.mjs` | Régénère `exemple-abraxio.xlsx` (données fictives). |
| `node scripts/make-icons.mjs` | Régénère les icônes PNG depuis `icons/icon.svg` (nécessite Playwright). |

### Règles du dépôt public

- **Jamais** de nom réel (collaborateur, fournisseur, entreprise), d'URL interne ni d'export réel dans le code, les
  exemples, les tests ou les messages de commit. Utiliser des noms manifestement fictifs.
- Les URL SAP éventuelles se configurent dans *Paramètres* (stockées dans `data.json`), jamais dans le code.
- `.gitignore` exclut `*.xlsx`, `*.xls`, `*.csv`, `*.pdf`, `data*.json` et `Suivi-PV/` (seul `exemple-abraxio.xlsx` est
  autorisé). Le workflow de déploiement échoue si un tel fichier est versionné.

## 7. Publier une nouvelle version

1. Pendant le développement, noter les changements sous `## [Non publié]` dans `CHANGELOG.md` (facultatif).
2. Préparer la version :

   ```bash
   node scripts/release.mjs patch "Correction de l'export"
   ```

   (`patch` = correction, `minor` = nouvelle fonctionnalité, `major` = changement important, ou un numéro `X.Y.Z`.)
   Le script met à jour `version.js` (numéro + date) et ajoute l'entrée au `CHANGELOG.md`.
3. Vérifier, lancer `npm test`, puis :

   ```bash
   git commit -am "Version X.Y.Z" && git push
   ```

4. Le push sur `main` déclenche le workflow **GitHub Actions** (`.github/workflows/deploy.yml`) : tests, garde-fou
   « aucun fichier de données », puis publication sur GitHub Pages. Les utilisateurs voient la bannière de mise à jour
   au lancement suivant ou dans l'heure.

> **Toujours incrémenter la version** pour publier : c'est le changement de `version.js` qui fait détecter la mise à
> jour par le service worker et qui renomme son cache (`suivi-pv-X.Y.Z`, l'ancien est supprimé à l'activation).

Configuration initiale (une seule fois) : *Settings → Pages → Build and deployment → Source : **GitHub Actions***.

Si un fichier est ajouté dans `js/` ou `css/`, l'ajouter aussi à la liste `SHELL` de `sw.js` (un test le vérifie).

## 8. Organisation du code et format des données

```
index.html              page unique
manifest.webmanifest    manifeste PWA (nom, icônes, couleurs)
sw.js                   service worker : cache de l'app shell uniquement, mises à jour
version.js              numéro de version + date (seule source de vérité)
CHANGELOG.md            journal des versions (affiché dans la bannière de mise à jour)
css/app.css
js/
  app.js                démarrage, tableau de bord, export
  store.js              état, ouverture du dossier, sauvegarde automatique
  storage.js            File System Access API + mémorisation du dossier (IndexedDB)
  schema.js             format de data.json, version du schéma, migrations      (pur, testé)
  model.js              règles métier : statuts, écarts, doublons, import/export (pur, testé)
  format.js             montants, dates, mois, noms de fichiers                  (pur, testé)
  excel.js              lecture des exports Abraxio, écriture de l'export (SheetJS)
  import-ui.js          écrans d'import
  line-ui.js            dépôt de PV, validation, fiche SAP, fiche détaillée
  settings-ui.js        paramètres
  update.js             enregistrement du service worker, bannière, bouton d'installation
  ui.js                 utilitaires d'interface (dialogues, notifications)
vendor/xlsx.full.min.js SheetJS 0.20.3
icons/                  icône SVG + PNG 192/512 + maskable
tests/                  tests Node (node --test)
scripts/                release, génération de l'exemple et des icônes
exemple-abraxio.xlsx    export fictif pour les essais
```

### `data.json`

```jsonc
{
  "schemaVersion": 3,                         // version du format (voir js/schema.js)
  "app": { "creeAvec": "0.1.0", "creeLe": "…", "enregistreAvec": "0.1.0", "enregistreLe": "…" },
  "config": {
    "importMapping": {                        // champ de l'app ← en-tête de colonne du fichier importé
      "collaborateur": "Collaborateur", "fournisseur": "Fournisseur",
      "commande": "Numéros de commande associés", "montantAttendu": "Total HT",
      "debut": "De", "fin": "A", "quantite": "Quantité", "prixUnitaire": "P.U.H.T.", "libelle": "Libellé budget"
    },
    "importSheet": "Données Consommé",       // feuille importée
    "toleranceEcart": 0,                      // écart toléré en euros avant signalement
    "sapUrlTemplates": { "commande": "", "br": "" }   // modèles d'URL facultatifs : {commande} {poste} {br}
  },
  "imports": [
    { "id": "…", "date": "2026-11-03T09:12:00.000Z", "fichierOrigine": "export.xlsx", "feuille": "Données Consommé",
      "copie": "imports/20261103-091200_export.xlsx", "mois": ["2026-01", "…", "2026-10"],
      "lignes": 398, "lignesCreees": 42, "lignesMisesAJour": 3, "lignesInchangees": 353,
      "divergencesBR": 0, "absentes": 0, "lignesFichierIgnorees": 182 }
  ],
  "lignes": [
    {
      "id": "3f0c…",                          // UUID
      "mois": "2026-10",
      "collaborateur": "Alice Exemple",
      "fournisseur": "PRESTATAIRE ALPHA-100001",
      "commande": "3000000101",
      "poste": "10",
      "prestation": "Prestation de Développement Full stack",
      "periode": { "debut": "2026-10-01", "fin": "2026-10-31" },   // colonnes De / A
      "jours": 19,                            // somme des jours importés
      "montantAttendu": 9880,                 // euros (nombre, 2 décimales) = somme des imputations
      "details": [                            // imputations additionnées (pour vérification)
        { "libelle": "Run - Application A", "quantite": 5.5, "prixUnitaire": 520, "montant": 2860, "ligne": 24 },
        { "libelle": "Projet Migration", "quantite": 11, "prixUnitaire": 520, "montant": 5720, "ligne": 25 },
        { "libelle": "Projet Supervision", "quantite": 2.5, "prixUnitaire": 520, "montant": 1300, "ligne": 26 }
      ],
      "montantPV": 9450,                      // null tant que le PV n'est pas reçu ; l'écart est calculé
      "statut": "br_cree",                    // attendu | pv_recu | valide | br_cree | litige
      "numeroBR": "5000123456",
      "dateBR": "2026-11-22",
      "fichierPV": "PV/2026-10/2026-10_PRESTATAIRE-ALPHA-100001_Alice-Exemple.pdf",
      "commentaire": "",
      "historique": [                         // changements de statut datés
        { "date": "2026-11-03T09:12:00.000Z", "statut": "attendu", "detail": "Import" },
        { "date": "2026-11-15T10:01:00.000Z", "statut": "pv_recu" },
        { "date": "2026-11-15T10:02:00.000Z", "statut": "valide" },
        { "date": "2026-11-22T14:30:00.000Z", "statut": "br_cree", "detail": "BR 5000123456" }
      ],
      "importId": "…",                        // dernier import ayant confirmé la ligne (null si créée à la main)
      "alerteAbraxio": null,                  // ou { "type": "absente" | "divergence", "date", "changes": [...] }
      "source": { "Type facture": "Temps" },  // colonnes non mappées de la 1re imputation (pour les évolutions)
      "creeLe": "…", "modifieLe": "…"
    }
  ],
  "commandes": {}                             // réservé : suivi de consommation par commande (V2)
}
```

**Évolution du format** : au chargement, si `schemaVersion` est inférieur à la version du code, l'ancien fichier est
sauvegardé (`data.backup-AAAAMMJJ-HHMM.json`) puis les migrations de `js/schema.js` sont appliquées dans l'ordre.
S'il est supérieur (fichier écrit par une version plus récente), l'application passe en lecture seule et demande de
recharger. Pour changer le format : incrémenter `SCHEMA_VERSION`, ajouter `MIGRATIONS[n]` et un test dans
`tests/schema.test.js`.

**Prévu pour la suite** (hors V1) : suivi de consommation par commande (`commandes`), relances fournisseurs,
contrôle des jours facturés par rapport aux jours ouvrés (les colonnes de l'export non utilisées sont conservées dans
`source`).

## Licence

[MIT](LICENSE). SheetJS : Apache 2.0.

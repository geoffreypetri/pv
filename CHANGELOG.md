# Journal des modifications

Format : une section `## [X.Y.Z] - AAAA-MM-JJ` par version, avec une liste à puces.
Les puces de la dernière version s'affichent dans la bannière « Nouvelle version disponible ».
Notez les changements à venir sous `## [Non publié]` : `node scripts/release.mjs` les déplacera.

## [Non publié]

## [0.3.0] - 2026-11-23
- Import de l'export Abraxio par période (colonnes De et A), feuille « Données Consommé » détectée automatiquement
- Les imputations d'une période sont additionnées par collaborateur et commande, avec le détail listé pour vérification
- N° de commande et poste lus dans « Numéros de commande associés » (format commande-poste-libellé)
- Jours et détail des imputations visibles dans le tableau, la fiche de la ligne et l'export Excel (feuille « Détail »)
- Lignes sans commande (profils internes) ou sans collaborateur (factures) ignorées et décomptées
- Correction : les dates Excel ne glissent plus d'un jour selon le fuseau horaire
- Au démarrage, affichage du dernier mois renseigné si le mois courant est vide

## [0.2.1] - 2026-11-22
- N° de commande et n° de BR copiables d'un clic dans le tableau et les fiches
- Colonne Commande : le poste s'affiche seul sous le n° de commande
- Suppression du bouton « Installer l'application » (installation par le menu d'Edge)

## [0.2.0] - 2026-11-22
- Nouvelle interface : plus sobre, palette neutre, statuts en pastilles
- Mode sombre automatique selon le réglage de Windows
- Nouvelle icône

## [0.1.0] - 2026-11-22
- Première version : import Abraxio (Excel/CSV) avec correspondance des colonnes et détection des doublons
- Tableau de bord mensuel : compteurs par statut, file « à faire », recherche et filtres
- Dépôt des PV par glisser-déposer, renommage et rangement dans PV/AAAA-MM/
- Validation, fiche « Prêt pour SAP » avec copie des champs, saisie du n° de BR
- Export Excel du mois
- Application installable, fonctionnement hors ligne, bannière de mise à jour

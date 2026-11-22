# Journal des modifications

Format : une section `## [X.Y.Z] - AAAA-MM-JJ` par version, avec une liste à puces.
Les puces de la dernière version s'affichent dans la bannière « Nouvelle version disponible ».
Notez les changements à venir sous `## [Non publié]` : `node scripts/release.mjs` les déplacera.

## [Non publié]

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

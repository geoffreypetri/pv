# Journal des modifications

Format : une section `## [X.Y.Z] - AAAA-MM-JJ` par version, avec une liste à puces.
Les puces de la dernière version s'affichent dans la bannière « Nouvelle version disponible ».
Notez les changements à venir sous `## [Non publié]` : `node scripts/release.mjs` les déplacera.

## [Non publié]

## [0.5.3] - 2026-11-23
- Suppression des effets de flou (en-tête, fond des fenêtres) qui pouvaient rendre le curseur de texte blanc, donc invisible, sous Windows

## [0.5.2] - 2026-11-23
- Tableau : le n° de BR s'affiche sous le statut « BR créé » (copiable au survol)

## [0.5.1] - 2026-11-23
- Tableau : bouton « PV » à la place de l'icône de fichier pour ouvrir le PV
- Retour aux curseurs standard de Windows dans les champs de saisie

## [0.5.0] - 2026-11-23
- Curseur de la souris toujours visible au survol des champs de saisie
- PV rangés sous le nom « <n° de commande>_<fournisseur>_AAAA-MM.pdf »
- Dépôt des PV n'importe où dans la fenêtre (un ou plusieurs fichiers) ou par le bouton « Déposer des PV » : rattachement automatique par le n° de commande et le mois lus dans le nom du fichier
- Alerte si aucune ligne ne correspond, avec choix manuel de la ligne (même commande ou même mois en tête)
- Avertissement si le nom du fichier indique une autre commande ou un autre mois que la ligne choisie

## [0.4.1] - 2026-11-23
- Poste : tout le texte qui suit le n° de commande (ex. « 10-Prestation de … »), y compris pour les lignes déjà importées
- Tableau groupé par mois (en-têtes repliables avec nombre de lignes, total et BR créés) à la place de la colonne Mois
- Historique de la fiche aligné en colonnes (date, statut, détail)
- Curseur de saisie toujours visible dans les champs

## [0.4.0] - 2026-11-23
- L'import intègre toutes les périodes de l'export Abraxio en une fois
- Abraxio fait foi : les données importées remplacent les données existantes, sauf sur les lignes « BR créé »
- Lignes « BR créé » divergentes et lignes absentes du nouvel export signalées par une alerte (filtre « Alertes Abraxio »)
- Une ligne « Validé » dont l'écart devient non nul après import repasse à « PV reçu »
- Récapitulatif d'import par onglets : nouvelles, mises à jour, divergences, absentes, inchangées, ignorées
- Vue à plat : un seul tableau avec colonne Mois, filtres Année, Mois, Fournisseur et Statut à choix multiples
- Tri par colonne ; l'export Excel reprend les lignes affichées
- Interface harmonisée (boutons, listes, champs, icônes) et copie par icône au survol des champs
- Le poste extrait de « commande-poste » (ex. 3000000101-20) prime sur une éventuelle colonne Poste

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

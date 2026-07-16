# Shadowrun Bank Planner

Plan interactif de banque pour une run Shadowrun — le MJ construit le plan (étages, pièces,
dispositifs de sécurité, rondes, couvertures multi-canaux) et les joueurs le consultent en temps réel,
filtré par ce que le MJ a révélé.

**Application :** https://ethoril.github.io/shadowrunbank/

- **Mode joueur** (défaut, sans login) : lecture seule, mise à jour en direct via Firestore.
- **Mode MJ** : bouton `🔑 Admin` → login Google (email admin), édition complète + contrôle
  de la révélation.

## Stack

Statique pur (GitHub Pages), zéro build. Firebase v10+ (Auth Google + Firestore) via CDN,
chargé en module ES derrière `window.Cloud` ; le reste en scripts classiques. Fallback
`localStorage` si le cloud est indisponible.

Feuille de route active et modèle v2 : [development_plan_v2.md](development_plan_v2.md).
Le fichier [implementation_plan.md](implementation_plan.md) conserve l'historique de la v1.

## Développement local

Servir le dossier en HTTP (les modules ES ne chargent pas en `file://`) :

```
python -m http.server 8000
```

puis ouvrir `http://localhost:8000/`. Sans réseau, l'appli fonctionne en mode éditeur local
(`localStorage`). `test_smoke.html` contient les tests smoke (à ouvrir dans un navigateur).

La suite automatisée de phase 8 s'exécute avec `pnpm test` : tests unitaires du modèle, puis
tests d'intégration Chromium incluant les 200 smoke tests, les formats tablette et un conflit
entre deux clients simulés. `pnpm build` prépare exactement l'artefact statique dans `_site/`.

Le schéma v2 est migré automatiquement depuis les données v1. Une copie locale de sécurité
est créée avant migration ; les sauvegardes Firestore utilisent des révisions transactionnelles
et signalent explicitement les conflits entre machines.

Le moteur de couverture prend en charge les cônes, faisceaux, rectangles, cercles et seuils,
avec canal de détection, balayage et révélation indépendante. Une couverture sélectionnée en mode
MJ expose directement sur la carte ses poignées de portée, orientation, largeur, rayon ou ouverture ;
chaque geste reste annulable et les poignées demeurent accessibles au bord de la grille.

La palette comprend des décors structurels, du mobilier et des éléments au sol. Leurs dimensions,
rotation, visibilité et canaux occultés sont éditables ; les couvertures réagissent immédiatement
aux obstacles optiques, infrarouges, laser ou astraux.

Le catalogue de sécurité propose seize dispositifs spécialisés, des contrôles d’accès aux entités
astrales. Chaque type possède ses capacités, son profil d’état et ses paramètres de couverture par
défaut ; les zones adaptées sont créées automatiquement au placement.

Les pions PJ disposent d’un déplacement tactile séparé du document du plan. Escaliers, ascenseurs,
échelles, trappes et passages relient leurs points entre étages ; l’arrivée révèle durablement la
salle et les éléments réellement visibles selon les mêmes règles d’occlusion que les couvertures.
Les découvertes peuvent être réinitialisées par étage ou globalement sans effacer les révélations MJ.

L'éditeur conserve les 50 dernières actions locales. Les boutons du header et les raccourcis
`⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z` permettent d'annuler ou rétablir une action logique complète
(peinture, glisser-déposer ou saisie). Dispositifs et décors sont duplicables ; les waypoints
de ronde peuvent être déplacés sur la carte, supprimés, réordonnés ou inversés. `⌘/Ctrl+C` et
`⌘/Ctrl+V` copient puis collent un dispositif ou un décor sur l'étage courant. Les couvertures
peuvent retrouver en un clic les paramètres par défaut de leur type ou être ajustées visuellement.

La mise en page est responsive sur ordinateur et tablette. Le mode MJ conserve trois colonnes sur
MacBook, puis transforme les outils et l'inspecteur en tiroirs sur ordinateur compact ; en portrait,
ces tiroirs remontent depuis le bas. En mode joueur, la carte reste prioritaire et l'inspecteur suit
le même principe, avec des commandes tactiles de 44 px. Les panneaux Versions et Conflit deviennent
des modales contenues aux petites largeurs. La matrice automatisée couvre 1440×900, 1280×800,
1024×768, 768×1024 ainsi que la tablette cible en 2304×1440 et 1440×2304 natifs.

Le bouton `⛨ Versions` ouvre les 15 dernières sauvegardes locales et Firestore. Il permet de créer,
restaurer ou supprimer une version ; une copie de l'état courant est automatiquement conservée avant
toute restauration. Les copies cloud vivent dans `plans/main/snapshots`. Un workflow GitHub Pages
manuel rejoue toute la suite de tests avant publication. Depuis le 16 juillet 2026, la source Pages
du dépôt est configurée sur GitHub Actions : ce workflow manuel est donc l’unique voie de
publication. Voir [docs/production-runbook.md](docs/production-runbook.md).

## Sécurité

Les règles Firestore ([firestore.rules](firestore.rules)) sont la vraie protection : lecture
publique, plan et configuration réservés à l’email admin, déplacement joueur limité aux coordonnées
des pions et création limitée aux découvertes. À déployer dans Firebase après chaque modification.

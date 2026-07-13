# Plan d'implémentation — Shadowrun Bank Planner

## Vision

Application web statique (GitHub Pages, repo `Ethoril/shadowrunbank`) permettant au MJ de
construire le plan d'une banque (étages, pièces, dispositifs de sécurité) et aux joueurs de
le consulter en temps réel pour préparer et suivre leur run.

- **Mode admin (MJ)** : login Google, email admin hardcodé. Construction complète du plan +
  contrôle de ce qui est révélé aux joueurs + changement d'état des dispositifs en cours de mission.
- **Mode joueur** : aucun login. Lecture seule, temps réel (`onSnapshot`). Ne voit que ce que
  le MJ a révélé.
- **CSS / mise en scène** : on conserve intégralement le style du POC (`test.html`) — palette
  cyan/vert néon, Share Tech Mono, grid overlay, animations pulse/glitch, câbles SVG animés.

## Décisions actées

| Sujet | Décision |
|---|---|
| Dessin des pièces | Peinture de cases sur le quadrillage (formes libres, L, T…) |
| Visibilité joueur | Révélation progressive par le MJ (flag `revealed` par étage / pièce / entité) |
| Interaction joueur | Lecture seule + temps réel (onSnapshot) |
| Firebase | **Nouveau projet dédié** (à créer — voir « Actions côté MJ ») |
| Quadrillage | **Grille logique fixe** (24×16 cases par défaut, dimensionnable par étage à terme), mise à l'échelle de l'écran au rendu. Le quadrillage 30px du POC devient purement visuel ; les coordonnées (cases des pièces, positions d'entités) sont exprimées dans la grille logique → plan identique chez le MJ et les joueurs quelle que soit la taille de fenêtre |
| Stack | Statique pur, SDK Firebase modulaire v10+ via CDN, zéro build (même pattern que ennemi-interieur) |

## Architecture des fichiers

```
shadowrunbank/
├── index.html              # Page unique : header, palette outils, carte, inspecteur
├── css/
│   └── style.css           # CSS du POC extrait + ajouts (éditeur pièces, auth, reveal)
├── js/
│   ├── firebase-init.js    # Module ES : config Firebase + ADMIN_EMAIL + exports app/auth/db
│   ├── cloud.js            # Module ES : pont window.Cloud (auth Google + save/subscribe Firestore)
│   │                       #   → remplace le auth.js prévu ; seul point d'entrée module, le reste
│   │                       #   de l'appli reste en scripts classiques (fallback local si échec)
│   ├── store.js            # État global, (dé)sérialisation, save Firestore debounced, onSnapshot
│   ├── map.js              # Rendu : grille, pièces (cases peintes), entités, câbles SVG
│   ├── editor.js           # Mode admin : gestion étages, peinture/gomme de pièces, placement entités
│   ├── inspector.js        # Panneau droit : propriétés entité / pièce / étage, liaisons, reveal
│   └── main.js             # Bootstrap : watchAuth → bascule UI admin/joueur, wiring
├── firestore.rules         # Règles de sécu (commitées, à coller dans la console)
├── implementation_plan.md  # Ce fichier
└── test.html               # POC d'origine (conservé pour référence)
```

## Modèle de données (Firestore)

Un seul document par plan → 1 lecture, temps réel simple, sauvegarde atomique.
Document `plans/main` (le `planId` reste paramétrable pour de futurs runs) :

```js
{
  name: "Banque Zürich-Orbital",
  updatedAt: serverTimestamp(),
  grid: { cols: 24, rows: 16, cellSize: 30 },   // quadrillage logique commun
  floors: [
    { id: "f_xxx", name: "Niv 0 : Public", order: 0, revealed: true }
  ],
  rooms: [
    { id: "r_xxx", floorId: "f_xxx", name: "Hall Public",
      cells: ["3,2","4,2","4,3", ...],           // cases peintes "col,row"
      revealed: true }
  ],
  entities: [
    { id: "e_xxx", floorId: "f_xxx", type: "camera",
      name: "CAM_412", state: "active" | "hacked" | "offline",
      networkId: "e_yyy" | "",                   // liaison nœud réseau (cascade d'état conservée)
      x: 10.2, y: 5.7,                           // placement libre en unités de grille logique
      revealed: false,
      note: "",                                  // note MJ / info legwork, visible si révélée
      patrol: {                                  // OPTIONNEL — éléments mobiles uniquement
        points: [{ x: 3.5, y: 2 }, ...],         // waypoints en unités de grille (≥ 2 points)
        loop: true,                              // ronde en boucle vs aller-retour
        moving: false,                           // true = l'entité SE DÉPLACE le long de la ronde
        speed: 1.0,                              // vitesse en cases/seconde
        anchorAt: 0,                             // timestamp de départ (epoch ms) → position déterministe
        revealed: false                          // révélé indépendamment de l'entité
      } | null,
      vision: {                                  // OPTIONNEL — types avec vision (caméra…)
        direction: 45,                           // azimut du centre du cône en degrés
        angle: 60,                               // ouverture du cône en degrés
        range: 6,                                // portée en cases logiques
        sweep: {                                 // OPTIONNEL — balayage du cône
          from: 10, to: 80,                      // bornes d'oscillation en degrés
          period: 8,                             // durée d'un aller-retour en secondes
          anchorAt: 0                            // timestamp de départ → angle déterministe
        } | null,
        revealed: false                          // révélé indépendamment de l'entité
      } | null
    }
  ]
}
```

La cascade d'état du POC (nœud piraté → appareils liés piratés) est conservée telle quelle.

**Animation déterministe partagée** (rondes et balayages) : la position d'un garde en ronde et
l'angle d'une caméra en balayage sont des fonctions pures du temps —
`f(Date.now() - anchorAt, speed, points)` — calculées localement par chaque client via
`requestAnimationFrame`. Aucune écriture Firestore pendant le mouvement : MJ et joueurs voient
la même chose au même moment, et activer/stopper une ronde ne coûte qu'une écriture
(`moving` + `anchorAt`). À l'arrêt, la position figée est réécrite dans `x`/`y`.

## Fonctionnalités

### Mode admin

1. **Auth** : bouton discret `🔑 Admin` dans le header → `signInWithPopup(GoogleAuthProvider)` ;
   `user.email === ADMIN_EMAIL` → UI d'édition. Sinon message de refus + déconnexion.
2. **Étages** : ajouter / supprimer (avec confirmation, supprime pièces + entités de l'étage) /
   renommer / réordonner. Rendu en onglets comme le POC.
3. **Pièces — peinture de cases** :
   - Outil « Dessiner pièce » : clic-glisser peint les cases de la pièce courante ; outil gomme
     pour retirer des cases ; nouvelle pièce = nouvelle couleur de zone discrète.
   - Contour de pièce calculé (bordure uniquement sur les arêtes extérieures des cases,
     par comparaison de voisinage) pour un rendu net dans le style du POC.
   - Nom de la pièce affiché dans la zone, éditable via l'inspecteur.
4. **Entités** : palette du POC (nœud réseau, caméra, tourelle, barrière mana) **étendue**
   (proposition : porte magsec, garde/patrouille, drone, capteur, ascenseur — catalogue dans
   `map.js`, trivial à enrichir). Placement libre en %, snap optionnel à la grille.
   Déplacement par drag en mode sélection (amélioration vs POC).
5. **Chemins de ronde (éléments mobiles)** : les types marqués `mobile: true` dans le
   catalogue (garde, drone — extensible aux futurs types) peuvent recevoir un chemin de ronde
   **optionnel** : une entité mobile sans chemin reste parfaitement valide (cas où les PJ
   apprennent l'existence d'un garde avant de connaître son cheminement).
   - Édition : entité mobile sélectionnée → bouton « Tracer ronde » dans l'inspecteur ;
     chaque clic sur la carte ajoute un waypoint ; option boucle (retour au 1er point) ou
     aller-retour ; boutons « Effacer la ronde » et fin de tracé.
   - Rendu : polyligne pointillée dans la couleur de l'entité + points aux waypoints,
     même couche SVG que les câbles réseau.
   - **Ronde animée** : bouton ▶/⏸ dans l'inspecteur — l'icône se déplace le long du chemin
     à `speed` cases/s, en boucle ou aller-retour, **sous les yeux des joueurs** (animation
     déterministe partagée, voir modèle de données). État `offline` = immobile.
   - Révélation (phase 4) : flag `patrol.revealed` **indépendant** de `revealed` de l'entité —
     le MJ peut révéler le garde sans révéler sa ronde, puis la ronde plus tard.
6. **Cônes de vision (caméras & co)** : les types marqués `hasVision: true` dans le catalogue
   (caméra d'abord ; extensible : tourelle, drone, garde…) peuvent recevoir un cône **optionnel**.
   - Paramètres : direction, ouverture (degrés), portée (cases) — édités dans l'inspecteur
     (poignée de rotation sur la carte en bonus).
   - **Occlusion par les murs** : les arêtes extérieures des pièces (contours déjà calculés
     pour le rendu) servent de segments opaques ; le cône est découpé par lancer de rayons
     (polygone de visibilité 2D, clippé à l'ouverture et à la portée). Un coin de mur casse
     donc la ligne de vue. Rendu : polygone SVG translucide couleur de l'entité.
   - **Balayage** : oscillation optionnelle de la direction entre deux bornes sur une période
     donnée (`sweep`), animée en déterministe partagé comme les rondes. Recalcul du polygone
     à chaque frame, throttlé (~30 fps, étage courant uniquement).
   - États : `offline` → pas de cône ; `hacked` → cône re-stylé (vert/glitch) = flux compromis.
   - Révélation (phase 4) : flag `vision.revealed` indépendant — les PJ peuvent connaître la
     caméra sans connaître sa couverture.
   - Combinaison future : entité mobile + vision (drone qui patrouille en regardant devant lui,
     direction = tangente du chemin) — le modèle le permet, pas prioritaire.
7. **Inspecteur** : selon la sélection (entité / pièce / étage) — nom, état, liaison réseau,
   note MJ, chemin de ronde (si type mobile), cône de vision (si type `hasVision`),
   **toggle 👁 Révélé / Caché**, suppression.
8. **Sauvegarde** : automatique, debounce 1,5 s, `setDoc(plans/main, {...}, updatedAt)` ;
   indicateur « ☁ Sauvegardé / Sauvegarde… / ⚠ Erreur » dans le header (pattern fiche-cloud).
9. **Vue « comme les joueurs »** : toggle permettant au MJ de prévisualiser le plan filtré.

### Mode joueur (défaut, sans login)

- `onSnapshot(plans/main)` → rendu live : filtre `revealed` sur étages, pièces, entités.
- Les états (piraté, hors-ligne…), câbles réseau entre entités révélées, animations : visibles
  en direct pendant la mission.
- Chemins de ronde : affichés uniquement si l'entité **et** sa ronde sont révélées
  (`revealed && patrol.revealed`) ; si `moving`, l'icône se déplace en direct à l'écran
  (animation déterministe locale, synchrone avec l'écran du MJ).
- Cônes de vision : affichés si `revealed && vision.revealed`, avec occlusion et balayage
  identiques à la vue MJ.
- Clic sur une entité révélée → inspecteur en lecture seule (nom, type, état, note révélée).
- Aucun contrôle d'édition rendu dans le DOM (et écriture bloquée par les règles Firestore).

## Sécurité (firestore.rules)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /plans/{planId} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.token.email == 'ethoril@gmail.com';
    }
  }
}
```

Le check email côté client n'est que de l'UX ; la vraie protection est ici.

## Phases de réalisation

**Phase 1 — Refonte structurelle (sans Firebase)**
Éclater `test.html` en `index.html` + `css/style.css` + modules JS. Iso-fonctionnel avec le POC
(placement entités, inspecteur, liaisons, cascade). Persistance temporaire en `localStorage`
pour développer sans réseau. ✔ Vérifiable en ouvrant `index.html` en local.

**Phase 2 — Éditeur de plan**
Étages dynamiques (CRUD + onglets), peinture/gomme de pièces avec contours calculés, nommage,
drag des entités, catalogue étendu. Toujours sur `localStorage`.

**Phase 2b — Chemins de ronde** *(ajout au CdC du 2026-07-13)*
Flag `mobile` dans le catalogue, tracé de waypoints depuis l'inspecteur, rendu polyligne SVG,
champ `patrol` optionnel dans le modèle, **animation de déplacement** le long de la ronde
(moteur d'animation déterministe partagé — servira aussi aux balayages).
Indépendante de la phase 3, toujours sur `localStorage`.

**Phase 2c — Cônes de vision** *(ajout au CdC du 2026-07-13)*
Flag `hasVision`, champ `vision` optionnel, extraction des segments de murs depuis les contours
de pièces, polygone de visibilité par lancer de rayons, rendu SVG translucide, balayage animé
(réutilise le moteur de la 2b). Indépendante de la phase 3, toujours sur `localStorage`.

**Backlog — Murs intérieurs & objets occultants** *(ajout au CdC du 2026-07-13, non planifié)*
Aujourd'hui seuls les contours de pièces cassent les lignes de vue. À terme : pouvoir tracer des
murs intérieurs (segments posés sur les arêtes de la grille, ex. cloison au milieu d'une pièce)
et placer des objets occultants (caisse, pilier, comptoir — footprint de cases ou segment) qui
alimentent la même liste de segments opaques que les contours (`computeWalls`) — le raycasting
des cônes les prendra en compte sans modification. Modèle pressenti : `walls: [{ floorId,
x1,y1,x2,y2, revealed }]` + flag `blocksVision` sur certains types d'entités.

**Phase 3 — Firebase** ✔ *(réalisée le 2026-07-13)*
`firebase-init.js` + `cloud.js` (pattern ennemi-interieur adapté : modules ES isolés derrière
`window.Cloud` + événement `cloud-ready`), bascule admin/joueur via `watchAuth`
(`body.player-mode`, `Store.ui.readOnly`, garde-fous éditeur/inspecteur), `store.js` : save
debounced localStorage + Firestore, `onSnapshot` avec écho local ignoré (`hasPendingWrites`) et
conflits résolus via `updatedAt`. Migration du plan `localStorage` → Firestore au premier login
admin (doc `plans/main` absent → push). Si `cloud.js` ne charge pas (`file://`, hors-ligne),
l'appli retombe en mode éditeur localStorage. Vérifié le 2026-07-13 : lecture publique OK,
écriture anonyme rejetée (403), mode joueur end-to-end en headless.

**Phase 4 — Système de révélation + mode joueur** ✔ *(réalisée le 2026-07-13)*
Vue joueur centralisée dans `store.js` (`isPlayerView()` = mode joueur OU prévisualisation MJ ;
`visibleFloors/Rooms/Entities`, `ensureVisibleView()` répare étage courant + sélection à chaque
rendu). Filtre de rendu : pièces/entités/onglets filtrés, ronde si `revealed && patrol.revealed`,
cône si `revealed && vision.revealed`, câble si ses deux extrémités sont révélées. L'occlusion
des cônes utilise TOUS les murs (géométrie réelle, révélée ou non). Toggles 👁 dans l'inspecteur
(entité, ronde, cône, pièce, étage). Vue MJ : les éléments cachés restent visibles mais marqués
(pointillés/atténués). Prévisualisation via bouton « 👁 Vue joueurs » dans le header (cadre
orangé, étage courant restauré en sortie). Inspecteur joueur : nom/type/état/note + ronde et
cône seulement si révélés. Vérifié le 2026-07-13 : 71/71 tests smoke en Edge headless.
Ajout (2026-07-14) : onglet **« Visibilité »** dans le panneau de gauche (`js/visibility.js`) —
arbre repliable Étage → Pièce → Dispositif → (Ronde / Cône) avec un œil 👁/🚫 par ligne pour
révéler/cacher sans sélectionner sur la carte, + boutons « Tout révéler / Tout cacher ». Clic sur
un libellé = sélection de l'élément sur la carte. Masqué en vue joueur/prévisualisation.

**Phase 5 — Déploiement** ✔ *(réalisée le 2026-07-13)*
Repo git initialisé (`.claude/` ignoré), poussé sur `Ethoril/shadowrunbank`, GitHub Pages activé
via l'API (branche `main`, racine) → **https://ethoril.github.io/shadowrunbank/**. Vérifié le
2026-07-13 : site en ligne (HTTP 200, boot en mode joueur), suite smoke 71/71 PASS exécutée sur
l'URL déployée, règles Firestore actives en prod (lecture publique OK, écriture anonyme 403).
Reste au MJ : ajouter `ethoril.github.io` aux domaines autorisés Firebase Auth, puis 1er login
admin **depuis `localhost:8000`** pour publier le plan de dev (`plans/main` n'existe pas encore ;
la migration pousse le `localStorage` de l'origine courante — un login sur le site déployé
publierait le plan par défaut). Test croisé MJ/joueur à faire à ce moment-là.

## Actions côté MJ (bloquantes pour la phase 3)

1. Créer le projet Firebase (console.firebase.google.com) — nom libre, ex. `shadowrun-bank`.
2. Activer **Authentication → Google** et **Firestore** (mode production).
3. **Authentication → Settings → Authorized domains** : ajouter `ethoril.github.io`.
4. Récupérer la config web (Project settings → Add app → Web) et me la transmettre.
5. Confirmer l'email admin (supposé : `ethoril@gmail.com`).
6. Coller `firestore.rules` dans la console (je fournis le fichier).

Les phases 1 et 2 ne dépendent de rien — elles peuvent démarrer immédiatement.

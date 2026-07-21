# Plan d'évolution — pièces épurées, inspecteur permanent, déplacement par portée

But : trois évolutions d'usage demandées le 2026-07-21.

1. **E1 — Pièces sans couleur** : enlever la teinte des pièces, garder le style, passer sur des
   contours de murs blancs.
2. **E2 — Inspecteur permanent** (vue joueur / tablette) : bouton « ⓘ Infos » en haut à droite, aperçu
   permanent en dessous, réductible (juste le bouton) ou agrandissable ; **plus d'ouverture au clic**,
   **plus de surimpression**.
3. **E3 — Déplacement par zone de portée** : un PJ ne se déplace plus au doigt ; à la sélection (clic),
   une zone de déplacement possible s'affiche (6 cases de base, ajustable par le MJ pion par pion), qui
   respecte les obstacles (mur, porte verrouillée…).

> **État : rédigé, développement non commencé.** Document de travail à exécuter dans une ou plusieurs
> sessions dédiées. Format calqué sur `docs/perf-plan.md`. Chaque point liste : état actuel · objectif ·
> conception · fichiers · effort/risque · vérification.
>
> Conventions repo à respecter : le build (`scripts/build-site.mjs`) tamponne seul les `?v=` (ne pas
> rebumper à la main) ; `pnpm test` (unit + intégration Playwright) doit rester vert ; compléter le
> journal `development_plan_v2.md` (une ligne par changement + commit de renseignement du hash).

---

## Décisions actées (2026-07-21)

- **E1** : « murs blancs » = **contours de pièces seulement**. Le tracé des salles devient blanc et le
  remplissage teinté disparaît (fond neutre très léger conservé pour la sélection / le « caché »). Le
  style est conservé : trait plein vs pointillé selon révélé/caché, surbrillance à la sélection. Les
  **décors** (mur/porte/vitre/mobilier du catalogue) **gardent leurs couleurs actuelles**.
- **E2** : refonte de l'inspecteur **en vue joueur / tablette uniquement**. En MJ bureau l'inspecteur est
  déjà une colonne permanente de la grille — on n'y touche pas (hors éventuel déplacement cosmétique du
  bouton).
- **E3** : la contrainte de portée s'applique **aux joueurs** ; **le MJ garde le placement libre** (clic
  n'importe où / glisser) mais voit la même zone en repère. Forme de la zone = **distance octile**
  (8 directions, diagonale = 1,5 case), sans coupe d'angle à travers un coin de mur.
- **E3 — modèle d'obstacles (précisé le 2026-07-21)** : le **zonage des pièces = murs infranchissables**
  (les arêtes de `computeWalls`, y compris entre deux pièces adjacentes). Une frontière n'est franchissable
  que si une **porte** (ou une ouverture/passage) est **à cheval** dessus **et n'est pas verrouillée**.
  S'ajoutent, à l'intérieur, les décors bloquants isolés (grille, vitre, pilier, mobilier) et les bords de
  grille.

---

## E1 — Pièces sans couleur (contours blancs)

### État actuel

- Une pièce ne porte qu'un champ de couleur : `hue` (nombre 0-360). Aucun `color`/`type`/`roomType`.
  Palette source `ROOM_HUES` (`store.js:1549`), attribuée en rotation à la création (`store.js:1557`),
  plus des teintes en dur dans le plan par défaut (`store.js:533-546`). La validation n'exige pas `hue`
  (`store.js:423-427`) → champ neutralisable/supprimable sans casser la migration.
- Toute la couleur est calculée en JS (styles inline, aucune couleur de pièce en CSS) à partir de `hue`,
  en exactement 5 points :
  - `map.js:509` — fond des cases : `hsla(${room.hue}, 90%, 60%, …)`.
  - `map.js:510` — bordure/contour des cases (le « mur ») : `2px solid|dashed hsla(${room.hue}, 90%, 60%, …)`.
  - `map.js:564` — couleur du libellé de pièce : `hsla(${it.hue}, 70%, 72%, 0.9)`.
  - `inspector.js:706` — couleur du badge « PIÈCE ».
  - `visibility.js:308` — couleur de la ligne de pièce dans l'arbre de visibilité.
- Le contour n'est posé que sur les arêtes sans voisin de la même pièce (`map.js:518-523`, application
  `map.js:553-556`) : cette logique de tracé est conservée telle quelle.
- `#overlay-svg` ne dessine jamais les murs/pièces (uniquement cônes, rondes, câbles) — rien à toucher là.

### Objectif

Contours de pièces **blancs**, remplissage teinté **supprimé**, **style identique** (épaisseur 2px,
plein pour révélé / pointillé pour caché, surbrillance à la sélection). Décors inchangés.

### Conception

- `map.js:510` (le point clé) — remplacer la teinte par du blanc en conservant épaisseur, plein/pointillé
  et les paliers d'alpha :
  `2px ${hidden ? 'dashed' : 'solid'} rgba(255,255,255, ${isSelected ? 1 : hidden ? 0.4 : 0.7})`.
- `map.js:509` — remplacer le fond teinté par un fond **neutre quasi nul**, juste assez pour distinguer
  sélection et « caché » :
  `rgba(255,255,255, ${isSelected ? 0.10 : hidden ? 0.03 : 0.05})` (ajuster à l'œil ; on peut viser 0
  pour les révélées si un remplissage nul est préféré).
- `map.js:564` — libellé en blanc cassé : `rgba(230,235,240,0.9)`.
- `inspector.js:706` et `visibility.js:308` — neutraliser les mêmes conversions (blanc/gris). Note :
  toutes les pièces devenant blanches, la pastille de couleur de l'arbre de visibilité ne distingue plus
  les salles ; le **nom** reste le repère (déjà affiché) — passer la pastille en gris neutre.
- **Données** : garder le champ `hue` en place (simplement ignoré au rendu) → **aucune migration, aucun
  risque**. Nettoyage optionnel ultérieur (retrait de `ROOM_HUES`, de l'affectation `hue:` et des `hue:`
  en dur) — non nécessaire pour l'effet visuel.

### Fichiers

`js/map.js` (`renderRooms`, l.509-510, 564), `js/inspector.js` (l.706), `js/visibility.js` (l.308).
Aucun changement CSS requis (tout est inline). Aucun changement de données.

### Effort / risque

**Effort** faible (≈ 5 lignes). **Risque** faible, purement visuel.

### Vérification

- Smoke/unit : `renderRooms` ne produit plus de `hsla(` dépendant du `hue` pour le contour (assert sur la
  chaîne de style d'une case).
- Manuel : sur la carte, contours blancs nets, pointillé conservé pour les pièces cachées, surbrillance de
  sélection lisible ; libellés lisibles sur fond sombre ; décors toujours colorés.

---

## E2 — Inspecteur permanent réductible (vue joueur / tablette)

### État actuel

- L'inspecteur n'a **pas** de `open/close/toggle` propre : l'ouverture est pilotée par des classes sur
  `document.body` (`inspector-open`) dans `main.js` : `wireInspectorDrawer` (`main.js:108-129`),
  `openInspectorDrawer` (`main.js:147-151`), `closeDrawers` (`main.js:142-145`), `toggleDrawer`
  (`main.js:153-159`).
- **Desktop MJ** : l'inspecteur est **déjà une colonne permanente** de la grille
  (`.app-container` grid-template-columns, `style.css:184-190`) — pas d'overlay. **Hors périmètre.**
- **Vue joueur / tablette** : l'inspecteur est un **tiroir en surimpression** :
  `body.player-mode #inspector-panel { position:fixed; right:0; transform:translateX(105%); }`
  (`style.css:1124-1138`), rendu visible par `body.player-mode.inspector-open` (`style.css:1139`) ;
  variante tablette portrait en tiroir bas (`style.css:1189-1204`).
- **Ouverture au clic** : chaque handler de sélection appelle `Inspector.render()` ; en vue joueur,
  `render()` **ouvre le tiroir** via `openPlayerDrawer()` (logique `inspector.js:75-89`, appui
  `inspector.js:61-67`). Un tap sur pion sans déplacement force l'ouverture : `render({ forceOpen: true })`
  (`editor.js:838-840`).
- **Surimpression** : `#panel-backdrop` (`index.html:142`) devient un voile plein écran activé par
  `body.player-mode.inspector-open #panel-backdrop` (`style.css:1167-1182`) ; clic → `closeDrawers`
  (`main.js:120`).
- **Bouton joueur** : `#player-inspector-toggle` (« ⓘ Infos », `index.html:140`) est positionné **en bas à
  droite** au-dessus des contrôles de zoom (`style.css:1148-1165`), listener → `toggleDrawer('inspector')`
  (`main.js:115`), masqué quand le tiroir est ouvert (`style.css:1166`).
- Contenu : `render(options)` (`inspector.js:69-109`) vide `#inspector-body`, lit `Store.ui.selection`
  (seule source de « quel élément afficher »), et en vue joueur dispatche vers `renderReadOnly`
  (`inspector.js:114-189`).

### Objectif

En vue joueur / tablette, l'inspecteur devient un **encart accosté en haut à droite, toujours présent**,
avec **trois états** :

- **réduit** : seul le bouton « ⓘ Infos » est visible ;
- **aperçu** (défaut) : petite carte avec le contenu de la sélection (scroll interne) ;
- **agrandi** : grande carte avec tout le contenu.

Et surtout : **la sélection d'un élément ne change plus l'état d'ouverture** (le clic remplit le contenu
en place, sans jamais surgir), et **plus de voile de surimpression**.

### Conception

- **Découpler contenu et ouverture** dans `inspector.js` : `render()` continue de (re)remplir
  `#inspector-body` depuis `Store.ui.selection`, mais **ne touche plus** à l'état ouvert/réduit. Supprimer
  la branche d'auto-ouverture (`inspector.js:75-89`, `openPlayerDrawer` `inspector.js:61-67`) et le
  `forceOpen` du tap pion (`editor.js:838-840`). Les 6 handlers de clic (`editor.js:846-917`) restent
  inchangés : ils posent `Store.ui.selection` + appellent `render()`, qui ne fait plus que rafraîchir la
  carte en place.
- **Nouvel état d'affichage** (remplace la logique tiroir en vue joueur) : un attribut porté par le body,
  ex. `data-inspector="collapsed|compact|full"` (défaut `compact`), piloté par un petit contrôleur dans
  `main.js` (remplace `toggleDrawer/closeDrawers/openInspectorDrawer` **pour la vue joueur** ; les tiroirs
  MJ-tablette restent inchangés). État persisté en `localStorage` (comme les autres préférences UI).
- **Contenu identique, taille variable** : `compact` et `full` affichent le même `renderReadOnly` ; seule
  la **taille** de la carte change (hauteur/scroll). On évite ainsi d'écrire un second rendu.
  → « aperçu = petit », « agrandi = grand », « réduit = bouton seul ».
- **Repositionnement** :
  - `#player-inspector-toggle` monte **en haut à droite** (`style.css:1148-1165` à réécrire ; veiller à ne
    pas chevaucher l'en-tête / le bouton plein écran → l'ancrer sous le header, coin haut-droit de la zone
    carte).
  - `#inspector-panel` en vue joueur passe de `position:fixed + translateX(105%)` (`style.css:1124-1138`,
    portrait `1189-1204`) à une **carte accostée haut-droite** (`position:fixed; top:…; right:…;`), sans
    transform hors-écran, avec `max-height`/`max-width` relatifs au viewport et scroll interne. Trois
    tailles pilotées par `data-inspector`.
  - En **réduit**, la carte est masquée et seul le bouton reste ; en `compact`/`full`, le bouton fait
    partie de l'en-tête de la carte (ou reste au-dessus).
- **Contrôles** : dans l'en-tête de la carte, un chevron « réduire » (→ `collapsed`) et un bouton
  agrandir/rétrécir (`⤢`/`⤡`, bascule `compact`↔`full`). Le bouton `#inspector-close` (le `×`) est
  réaffecté à « réduire » en vue joueur. Le bouton `ⓘ` quand réduit rouvre en `compact`.
- **Suppression de la surimpression** (vue joueur) : neutraliser l'activation du voile
  `body.player-mode.inspector-open #panel-backdrop` (`style.css:1167-1182`) et le listener associé
  (`main.js:120`) pour la vue joueur. La carte étant accostée (pas plein écran), la carte doit rester
  **cliquable** tandis que la carte-jeu **reste interactive derrière/à côté** (pas de capture d'événements
  hors de la carte). ⚠️ le `#panel-backdrop` sert aussi au tiroir **Outils** en tablette **MJ** : ne le
  retirer que pour la vue joueur, pas globalement.
- **Non-régression MJ bureau** : la colonne permanente et son `×`/toggles ne changent pas.

### Fichiers

`index.html` (placement de `#player-inspector-toggle` / en-tête de carte), `js/inspector.js` (découplage
`render`, retrait `openPlayerDrawer`/branche 75-89), `js/editor.js` (retrait `forceOpen` l.838-840),
`js/main.js` (contrôleur d'état réduit/aperçu/agrandi pour la vue joueur ; retrait listener backdrop
joueur l.120), `css/style.css` (bouton haut-droite, carte accostée 3 tailles, neutralisation backdrop
joueur).

### Effort / risque

**Effort** moyen. **Risque** moyen : responsive tablette (portrait/paysage), s'assurer que la carte
agrandie ne masque pas toute la carte-jeu et scrolle correctement ; vérifier que retirer le voile joueur
ne casse pas le tiroir Outils MJ-tablette (voile partagé).

### Vérification

- Intégration Playwright (émulation tablette) : en vue joueur, le bouton est en haut à droite ; cliquer un
  élément **n'ouvre/n'agrandit pas** l'encart (le contenu change en place) ; les contrôles cyclent
  `réduit → aperçu → agrandi` ; **aucun voile** n'apparaît ; la carte reste manipulable pendant que
  l'encart est visible.
- Unit : contrôleur d'état (transitions collapsed↔compact↔full, persistance localStorage).
- Manuel tablette : portrait et paysage, chevauchement header/plein écran, lisibilité du contenu agrandi.

---

## E3 — Déplacement par zone de portée

### État actuel

- **Token PJ** (`store.js` `normalizeToken` l.247-264, `addToken` l.1184-1193) : `id, name, shortLabel,
  color, icon, floorId, x, y (flottants en cases, centre de case, bornés [0.5, cols-0.5]/[0.5, rows-0.5]),
  playerMovable, visible, locked, updatedAt`. **Aucun champ de portée/vitesse** (`patrol.speed` existe mais
  concerne les entités PNJ/drones, pas les pions).
- Tokens **stockés séparément du plan** (tableau `tokens`, clé `shadowrunbank_tokens_v1`, sous-collection
  cloud `plans/main/tokens`) → un déplacement ne réécrit pas le plan.
- **Déplacement actuel = drag** (dans `editor.js`, pas `map.js`) : `onTokenPointerDown` (`editor.js:872-884`,
  `playerCanMove` l.877) → `applyDragMove` branche token (`editor.js:753-761`) écrit `x/y` et
  `MapView.moveTokenDiv` → `onPointerUp` (`editor.js:810-822`) `Store.commitTokenPosition` +
  `Exploration.handleTokenRelease`. Un tap sans déplacement est déjà distingué (`editor.js:838`).
  **Aucun test d'obstacle** : le pion se pose librement, seulement borné à la grille.
- **Grille** : `plan.grid = {cols, rows, cellSize}` (défaut 24×16 ; `store.js:527`). `cellPx` recalculé au
  rendu (`layoutBoard`, `map.js:81-93`). Helpers : `gridPosFromEvent` (`map.js:128-135`), `cellFromEvent`
  (`map.js:145-151`), `setLayerPos` (`map.js:47-51`).
- **Obstacles** : ⚠️ **aucune logique de collision n'existe** ; `blocksMovement` est stocké mais jamais
  consommé (n'apparaît qu'en affichage : badge « Obstacle » `inspector.js:42`, case `inspector.js:655-656`).
  Quatre briques réutilisables :
  - **Murs = zonage des pièces** : `computeWalls(floorId)` (`map.js:159-198`) parcourt les cellules de
    chaque pièce et pose une arête sur toute frontière vers une cellule **hors de cette pièce** (l.171-174) —
    donc **room↔room et room↔vide** produisent des arêtes (dédoublonnées via `Set`). C'est exactement le
    modèle « le zonage représente des murs infranchissables » confirmé par le MJ. Les arêtes sont sur des
    lignes de grille entières, en coordonnées cases (unités avant fusion : `horiz` ligne `r` → colonnes,
    `vert` ligne `c` → rangées).
  - **Portes / ouvertures à cheval** : géométrie déjà présente pour « décor à cheval sur un mur » —
    `decorTouchesRoom` (`exploration.js:26-44`, `CROSS_WALL_HALF_SPAN=0.55`, empreinte `x,y,width,height` +
    rotation à 90°) et `elevatorDoorTouchesRoom` (`exploration.js:50-74`). Modèle direct pour trouver la/les
    arête(s) qu'une porte perce.
  - **Verrouillage** : `Store.isAccessOpen(item)` (`store.js:1397-1400`) → ouvert si le contrôleur lié
    (`accessEntityId` → maglock/scanner, `store.js:89,142-143`) n'est **pas** à l'état `active`
    (`getEffectiveState` l.1381-1386). Déjà appliqué aux transitions verticales (`exploration.js:158-159`).
  - **Décors bloquants isolés** : catalogue `pillar/glass/grid` (`catalog.js:149-154`) + mobilier
    (`catalog.js:161-175`), `blocksMovement:true`, empreinte `x,y,width,height,rotation`
    (`store.js:normalizeDecor` l.121-146). Pour les barrières internes non alignées au zonage. Le socle
    géométrique `raySegment` (`map.js:201-210`) et le patron d'occulteurs (`computeOccluders`) restent
    disponibles si un test par rayon est préféré aux arêtes.
- **Aucun pathfinding / cases atteignables / BFS** n'existe (grep exhaustif négatif).
- **PJ vs autres** : distinction structurelle (tableau `tokens` dédié), pas de champ « type ». Le droit de
  bouger dépend du **mode de vue** : `isPlayerView()` (`store.js:1428`), `playerCanMove` (`editor.js:877`).
- **Règles cloud** : mise à jour joueur limitée à `floorId/x/y/updatedAt` (`firestore.rules:19-27`) ;
  création/config réservées au MJ (`isAdmin`).

### Objectif

- Ajouter une **portée de déplacement** par pion (défaut **6**, ajustable par le MJ, pion par pion).
- En **vue joueur** : le drag est remplacé par **clic pour sélectionner → une zone atteignable s'affiche →
  clic sur une case de la zone pour s'y déplacer**. On ne peut atteindre qu'une case de la zone.
- La zone **respecte les obstacles** : le **zonage des pièces fait mur** (arêtes de `computeWalls`), sauf
  là où une **porte / ouverture est à cheval** sur la frontière **et n'est pas verrouillée**. S'y ajoutent
  les décors bloquants internes (vitre, grille, pilier, mobilier) et les bords de grille.
- **MJ** : garde le placement libre (drag / clic n'importe où), et voit la zone en repère (sans contrainte).
- Forme de la zone : **distance octile** (8 directions, orthogonale = 1 case, diagonale = 1,5), sans coupe
  d'angle à travers un coin de mur.

### Conception

**1. Donnée `movementRange` (défaut 6).**
- Ajouter `movementRange` dans `normalizeToken` (`store.js:247-264`, défaut 6, entier borné ex. 0-40) et
  `addToken` (`store.js:1184-1193`).
- Champ éditable **MJ** dans l'inspecteur pion (`inspector.js:783-829`, près de « Déplaçable par les
  joueurs » l.820) : un `numberInput` « Portée de déplacement (cases) », `save()` (re-rend les pions et
  recalcule la zone si ce pion est sélectionné).
- **Migration : néant** — les pions existants reçoivent 6 à la normalisation au chargement. Inclus
  automatiquement dans l'export JSON.
- **Cloud : aucune règle à changer** — `movementRange` est un champ de **config**, écrit par le MJ via
  `saveToken` (autorisé par `isAdmin`) ; les joueurs restent limités à `floorId/x/y/updatedAt`
  (`firestore.rules:19-27`) et ne peuvent donc pas le modifier. ✔ correspond à « ajustable côté MJ ».

**2. Carte d'obstacles — arêtes bloquées + cases bloquées (nouveau, `map.js`).**
Modèle **par arêtes de grille** (plus robuste et direct que le ray-casting pour un déplacement sur cases,
et réutilise tel quel l'itération de `computeWalls`).

- **Arêtes de mur** : refactorer/dupliquer `computeWalls` pour exposer les **arêtes unitaires avant
  fusion** (`horiz` ligne `r` → colonnes, `vert` ligne `c` → rangées, l.160-176) → ensemble
  `blockedEdges`. Une arête sépare deux cases orthogonalement adjacentes (ou une case et l'extérieur).
- **Perçage par porte / ouverture** : pour chaque décor **passant à cheval** sur une frontière, **retirer**
  l'arête (ou les arêtes) qu'il couvre de `blockedEdges`. Est « passant » :
  - un décor `opening` (« ouverture / passage », `blocksMovement:false`, `catalog.js:152`) — toujours ;
  - une **porte** (`opaque_door`) **non verrouillée** : passante ssi `!decor.accessEntityId` (porte simple,
    ouvrable à la main) **ou** `isAccessOpen(decor)` (contrôleur non `active`). Une porte **verrouillée**
    (`accessEntityId` + contrôleur `active`) **laisse l'arête bloquée**.
  - Détection de l'arête percée : l'empreinte de la porte (axe fin < 1 = axe qui traverse le mur) donne
    l'orientation ; la ligne de grille = arrondi du centre sur cet axe ; l'étendue sur l'axe long = les
    colonnes/rangées couvertes. Réutiliser la géométrie de `decorTouchesRoom` (`exploration.js:26-44`).
- **Cases bloquées** : décors `blocksMovement:true` **isolés** (grille, vitre, pilier, mobilier) et cabines
  d'ascenseur → marquer les **cases** dont le centre tombe dans l'empreinte (même empreinte `x,y,w,h,rot`)
  comme non-entrables. (Les portes/murs, eux, agissent sur les arêtes, pas les cases.)
- **Bords de grille** : traités comme arêtes bloquées implicites (une case hors `[0,cols)×[0,rows)` est
  invalide).
- Cache invalidé par `Store.getMutationSeq()` (+ époque locale au changement d'état d'un contrôleur d'accès),
  même patron que le cache d'occulteurs.

**3. Calcul de la zone atteignable — `reachableCells(token)` (nouveau).**
- Dijkstra borné depuis la case de départ `(floor(token.x), floor(token.y))`, **8-connexité**, coûts
  **1 (orthogonal) / 1,5 (diagonal)**, coût cumulé ≤ `movementRange`.
- Pas **orthogonal** `A→B` autorisé ssi `B` est dans la grille, `B` n'est pas une **case bloquée**, et
  l'**arête** `A–B` n'est pas dans `blockedEdges`.
- Pas **diagonal** `A→B` autorisé ssi `B` valide/non bloquée **et** les **deux arêtes orthogonales** formant
  le coin sont ouvertes (anti-coupe d'angle : on ne se faufile pas entre deux murs qui se touchent).
- Coût négligeable (grille ~384 cases, frontière bornée par la portée). Recalcul quand : sélection d'un
  pion, changement d'étage du pion, mutation du plan (`getMutationSeq`), changement d'état d'un contrôleur
  d'accès. Mémoïsation par `(tokenId, floorId, movementRange, mutationSeq)`.

**4. Interaction.**
- **Vue joueur** (`isPlayerView()`), pion `playerMovable && !locked` :
  - `onTokenPointerDown` (`editor.js:872-884`) **n'ouvre plus de drag de position** ; il ne fait que
    **sélectionner** le pion → la zone s'affiche.
  - Nouveau comportement au clic sur le plateau (dans `onBoardPointerDown`/un handler dédié) : si un pion
    est sélectionné et que le clic tombe sur une **case atteignable** (`cellFromEvent` `map.js:145-151` +
    appartenance à `reachableCells`) → déplacer le pion au **centre** de cette case, `commitTokenPosition`
    (`store.js:1170-1182`) + `Exploration.handleTokenRelease` (découvertes), puis recalcul de la zone à la
    nouvelle position.
  - Clic **hors zone** → désélection (zone masquée) ; clic sur un autre pion → sélection de l'autre.
  - Le **drag de pion est désactivé en vue joueur** (plus de « au doigt »).
- **Vue MJ** : `onTokenPointerDown` conserve le **drag libre** existant ; la zone du pion sélectionné
  s'affiche **en repère** (aucune contrainte, aucun blocage de drop).
- **Animation** (optionnel, polish) : glissement du pion vers la case cible (transition `transform`, en
  réutilisant `setLayerPos`), ou pose instantanée en v1.

**5. Rendu de la zone.**
- Nouvelle couche `#move-zone-layer` dans le plateau (`index.html`, sous `#tokens-layer`, au-dessus de
  `#rooms-layer`), rendue via `reconcileLayer` comme les autres couches, appelée depuis `render()`
  (`map.js`, near l.1287).
- Une `div.move-zone-cell` par case atteignable (positionnée comme les cases de pièce), `pointer-events:
  none` (le hit-test passe par `cellFromEvent` + l'ensemble atteignable, pas par des écouteurs par case) :
  teinte semi-transparente à la couleur du pion + fine bordure ; éventuel liseré plus marqué sur la
  frontière. CSS à ajouter dans `style.css`.
- La couche n'est peuplée que si un pion est sélectionné (et, en repère MJ, idem).

**Hors périmètre v1** :
- Déplacement **inter-étages** via la zone : la zone est **mono-étage** ; atteindre/toucher une transition
  continue de passer par la modale existante (`transition-dialog.js`).
- Coûts de terrain variables, difficulté, points d'action multiples — non traités.
- Verticalité / lignes de vue 3D — hors sujet (déjà hors périmètre du projet).

### Fichiers

`js/store.js` (`normalizeToken`, `addToken`), `js/inspector.js` (champ portée dans `renderToken`),
`js/map.js` (exposer les arêtes unitaires de `computeWalls`, `computeBlockedEdges` + cases bloquées +
perçage porte, `reachableCells`, couche de rendu, appel dans `render`), `js/editor.js`
(`onTokenPointerDown` : sélection sans drag en vue joueur ; handler de clic-pour-déplacer sur case
atteignable), `js/exploration.js` (réutilisation `handleTokenRelease` ; la géométrie `decorTouchesRoom`
sert de patron au perçage), `index.html` (`#move-zone-layer`), `css/style.css` (`.move-zone-cell`).
`firestore.rules` : **inchangé**.

### Effort / risque

**Effort** élevé (c'est le gros morceau : carte d'arêtes + perçage porte + graphe + interaction + rendu).
**Risque** moyen-élevé :
- justesse du **perçage de porte** (identifier la bonne arête depuis une empreinte fine et tournée à 90°) —
  d'où la réutilisation de la géométrie éprouvée `decorTouchesRoom` ;
- cas limites du zonage : pièces non contiguës, cases hors de toute pièce (couloirs non zonés → sans arêtes
  donc librement traversables : à confirmer que c'est le comportement voulu) ;
- non-régression du drag MJ et de la synchro cloud multi-écrans.

### Vérification

- **Unit** : `computeBlockedEdges` (frontière de zonage room↔room et room↔vide bloque le pas ; une porte
  simple ou `opening` à cheval **perce** l'arête ; une porte **verrouillée** la laisse bloquée ; `glass`,
  `grid`, mobilier marquent leur **case** comme bloquée) ; `reachableCells` (portée 6 octile sur pièce vide
  → ensemble attendu ; un mur de zonage réduit l'ensemble et une porte ouverte le prolonge dans la pièce
  voisine ; bornes de grille respectées ; diagonale ne coupe pas un coin de mur ; ajustement de
  `movementRange` change la taille).
- **Intégration Playwright** : vue joueur → sélection d'un PJ affiche la zone ; clic sur case atteignable
  déplace le pion et **persiste** la position ; clic hors zone ne déplace pas / désélectionne ; le drag
  joueur ne bouge plus le pion ; vue MJ → drag libre toujours opérationnel + zone affichée en repère.
- **Manuel tablette** : fluidité de l'affichage de la zone, précision du clic à différents zooms, portes
  verrouillées/ouvertes respectées, synchro entre deux écrans.

---

## Ordre recommandé

**E1 → E2 → E3.**

- **E1** est quasi gratuit et sans risque : à livrer en premier (gain visuel immédiat).
- **E2** est indépendant d'E1 et d'E3 ; le faire avant E3 met en place l'inspecteur permanent qui
  accueillera la portée du pion.
- **E3** est le chantier majeur ; le découper en sous-lots : (a) donnée `movementRange` + champ MJ,
  (b) `computeMovementBlockers` + tests unitaires, (c) `reachableCells` + tests, (d) rendu de la zone,
  (e) interaction clic-pour-déplacer + désactivation du drag joueur, (f) repère MJ.

## Tests / garde-fous

- `pnpm test` (unit + intégration Playwright) vert après chaque lot.
- Vérifs manuelles tablette (vue joueur) après E2 et E3 : inspecteur accosté sans voile, zone de
  déplacement, portes verrouillées, synchro multi-écrans.
- Convention repo : `?v=` tamponnés par le build (pas de bump manuel) ; compléter le journal
  `development_plan_v2.md` (une ligne par changement + commit de renseignement du hash).

## Avancement

- **E1 — livré** (2026-07-21) : commit `f10ceec`, hash journal `47a19f6`. Remplissage retenu = blanc
  léger 5 % (décision utilisateur).
- **E2 — livré** (2026-07-21) : commit `20e08e4`, hash journal `bd7b010`. Contrôles retenus = deux boutons
  distincts (⤢/⤡ agrandir-rétrécir + × réaffecté à « réduire »).
- **E3 — non commencé** : chantier majeur, à faire dans une session dédiée (sous-lots a→f, cf. « Ordre
  recommandé »).

## Points encore ouverts (mineurs, à trancher au fil de l'eau)

- **E1 — tranché** : remplissage des pièces révélées à **5 % de blanc** (léger voile).
- **E2 — tranché** : **deux boutons distincts** (⤢/⤡ + × « réduire »), pas de bouton cyclique unique.
- **E3 — tranchés (2026-07-21)** :
  - Les **cases hors de toute pièce** (couloir non zoné) sont **librement traversables** (pas d'arête de
    zonage) — comportement voulu, confirmé.
  - Une **porte simple sans maglock** est **passante par défaut** (ouvrable à la main) ; seule une porte
    **verrouillée** (maglock `active`) bloque — confirmé.
- **E3 — reste ouvert** : animation de glissement du pion vers la case cible — v1 instantanée, polish
  ultérieur ?

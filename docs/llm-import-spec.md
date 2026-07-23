# SPEC MACHINE — Shadowrun Bank Planner : génération d'un plan importable (schéma v2)

> Audience : LLM chargé de produire un JSON de plan complet, importable tel quel via le bouton
> **Importer** de l'application (remplace le plan courant après backup automatique).
> Pipeline d'import : `migratePlan()` (normalisation/clamps) → `validatePlan()` (rejet si erreurs).
> Les champs omis mais normalisables sont auto-remplis ; les champs listés REQUIRED provoquent un rejet.

## 1. Concept de l'outil

Plan tactique multi-étages pour une run Shadowrun. Le **MJ** construit : étages, pièces (cellules
peintes sur grille), dispositifs de sécurité (entités avec états piratables, réseaux, rondes,
zones de couverture multi-canaux), décors (obstacles bloquant mouvement/vision), liaisons
verticales (escaliers, ascenseurs…). Les **joueurs** voient uniquement ce qui est `revealed:true`
ou découvert par leurs pions (exploration + occlusion géométrique). Une caméra `hacked` donne
un flux temporaire aux joueurs sur sa pièce/étage.

## 2. Objet racine (tous REQUIRED)

```jsonc
{
  "schemaVersion": 2,          // exactement 2
  "revision": 0,               // int >= 0 ; 0 pour un nouvel import
  "name": "string non vide",
  "updatedAt": 1750000000000,  // nombre (ms epoch)
  "grid": { "cols": 24, "rows": 16, "cellSize": 30 },  // ints > 0, cellSize px > 0
  "floors": [], "rooms": [], "entities": [], "decors": [], "transitions": []
}
```

### Système de coordonnées
- Grille de `cols × rows` cellules. Cellule = (col, row), origine (0,0) en haut-gauche.
- **Entités / endpoints de transition** : x,y flottants = position libre, clampés à [0.5, cols−0.5] × [0.5, rows−0.5]. Centre de la cellule (c,r) = (c+0.5, r+0.5).
- **Décors** : x,y = centre du rectangle, clampé [0, cols] × [0, rows] ; width/height en cellules ; rotation multiple de 90 (arrondi forcé).
- **Cellules de pièce** : chaînes `"col,row"` (ints).
- **IDs** : chaînes non vides, uniques (obligatoire pour floors ; fortement recommandé partout). Convention : `f_*`, `r_*`, `e_*`, `d_*`, `tr_*`, `ep_*`.

## 3. floors

```jsonc
{ "id": "f_rdc", "name": "Niv 0 : Public", "order": 0, "revealed": true }
```
- `id`, unique — REQUIRED. `order` : int, **croissant = étage plus BAS** (Niv 0 → order 0, Niv −1 → order 1). Ordres contigus 0..n−1 recommandés.
- `revealed:false` = invisible aux joueurs tant que non découvert.

## 4. rooms

```jsonc
{ "id": "r_hall", "floorId": "f_rdc", "name": "Hall", "hue": 130,
  "cells": ["6,1","6,2","7,1"], "revealed": true }
```
- REQUIRED : `id`, `floorId` existant, `cells` (array). `hue` : 0–360 (teinte de la pièce).
- Une cellule appartient à UNE pièce max par étage — ne pas dupliquer une cellule dans deux pièces.
- Helper mental : rectangle (c0,r0,w,h) → toutes les `"c,r"` avec c∈[c0,c0+w), r∈[r0,r0+h).

## 5. entities (dispositifs de sécurité)

```jsonc
{
  "id": "e_cam1", "floorId": "f_rdc", "type": "camera",
  "name": "CAM_101", "state": "active",       // voir profils d'état §5.2
  "networkId": "",                              // id d'un network_node ou ""
  "x": 6.5, "y": 1.5,
  "revealed": false, "autoDiscover": true,      // autoDiscover: découvrable par exploration des pions
  "privateNote": "note MJ", "playerInfo": "info joueurs",  // strings (auto-"" si omis)
  "patrol": null,                               // §5.4
  "coverage": { ... }                           // §5.3, ou null
}
```
REQUIRED : `id`, `floorId` existant, `x`/`y` finis. Si `coverage` non-null : shape+channel valides et direction/angle/range/width/radius numériques (la migration remplit les manquants si l'objet existe).

### 5.1 Catalogue des types (21)

| type | cat. | capacités clés | coverage défaut | profil état |
|---|---|---|---|---|
| `steel_grate` | structure | blocksMovement | — | structural |
| `mad_gate` | access | réseau, accessControl, seuil détection | threshold/magnetic r0.75 w2 | access |
| `maglock` | access | réseau, accessControl | — | access |
| `retina_scanner` | access | réseau, accessControl, biometric | — | access |
| `dna_analyzer` | access | réseau, accessControl, biometric | — | access |
| `elevator` | access | réseau, accessControl (lier via `transition.accessEntityId`) | — | access |
| `camera` | detection | réseau, sweep, flux joueur si hacked | cone/optical 60° r6 | electronic |
| `infrared_motion_sensor` | detection | réseau | cone/infrared 90° r6 | electronic |
| `detection_laser` | detection | réseau, autoDiscover:false | beam/laser r8 w0.25 | electronic |
| `pressure_plate` | detection | réseau, autoDiscover:false | rectangle/pressure r2 w2 | electronic |
| `sensor` | detection | réseau, autoDiscover:false, générique sans zone | — | electronic |
| `micro_security_drone` | defense | réseau, patrouille, sweep | cone/optical 70° r4 | drone |
| `combat_drone` | defense | réseau, patrouille, sweep, armé | cone/optical 80° r7 | drone |
| `automatic_turret` | defense | réseau, sweep, armé | cone/optical 90° r8 | drone |
| `armed_guard` | personnel | patrouille, armé (PAS réseau) | cone/optical 100° r5 | personnel |
| `swat` | personnel | patrouille, armé (PAS réseau), unité d'assaut | cone/optical 100° r5 | personnel |
| `bank_employee` | personnel | patrouille, non armé, sans zone de détection | — | personnel |
| `civilian` | personnel | patrouille, non armé, sans zone de détection | — | personnel |
| `security_mage` | magic | patrouille, perception astrale | circle/astral rad5 | magical |
| `patrol_spirit` | magic | patrouille, astral | circle/astral rad4 | magical |
| `network_node` | utility | maître de réseau (cascade d'état) | — | electronic |

Alias legacy acceptés (auto-résolus) : `turret`→automatic_turret, `guard`→armed_guard.
`drone` (générique) existe aussi (cone/optical 60° r6).

### 5.2 États — toujours l'une de : `"active"` | `"hacked"` | `"offline"`
Sémantique par profil : electronic Actif/Piraté/Hors-ligne · personnel Vigilant/Alerté/Neutralisé · magical Actif/Perturbé/Dissipé · access **Verrouillé/Ouvert/Désactivé** · drone Actif/Piraté/Neutralisé · structural Intacte/Ouverte/Détruite.
**Réseau** : si `networkId` pointe vers un `network_node` dont state ≠ active, l'appareil hérite de l'état du nœud (état effectif). Le nœud doit être une entité `network_node` (n'importe quel étage).

### 5.3 coverage (zone de détection)

```jsonc
{ "shape": "cone", "channel": "optical",
  "direction": 90,   // degrés, 0 = est, sens horaire, clamp [-360,360]
  "angle": 60,       // cone : ouverture, clamp [10,180]
  "range": 6,        // cone/beam/rectangle/threshold : portée, clamp [0.5,30]
  "width": 1,        // beam/rectangle/threshold : largeur, clamp [0.25,20]
  "radius": 4,       // circle, clamp [0.5,30]
  "sweep": null,     // ou { "from": 45, "to": 135, "period": 8, "anchorAt": 0 } (balayage angulaire, period s ∈[1,60])
  "revealed": false  // la ZONE peut être révélée indépendamment de l'entité
}
```
- shapes : `cone` (direction+angle+range) · `beam` (direction+range+width) · `rectangle` (direction+range=longueur+width) · `circle` (radius) · `threshold` (range+width, portique) . Inclure tous les champs numériques (les non-pertinents sont ignorés mais validés numériques).
- channels : `optical` `infrared` `laser` `magnetic` `pressure` `astral`.
- **Occlusion** : les décors/entités dont `blocksVision` contient le canal découpent la zone en temps réel (murs = optical+infrared+laser ; mana_barrier = astral). pressure/magnetic ne sont pas occlus par les murs par nature de leurs valeurs blocksVision.
- `coverage:null` = pas de zone. À l'import, aucune zone n'est créée automatiquement : **fournir explicitement coverage** pour tout type détecteur (utiliser les défauts du tableau §5.1).

### 5.4 patrol (ronde — pour les types mobiles : drones, garde, mage, esprit)

```jsonc
{ "points": [{ "x": 6.5, "y": 1.5 }, { "x": 10.5, "y": 1.5 }],
  "loop": true,      // true = boucle fermée, false = aller-retour
  "moving": false,   // false à l'import ; le MJ démarre en jeu
  "speed": 1,        // cellules/s, clamp [0.1,10]
  "anchorAt": 0,
  "revealed": false  // tracé de ronde visible des joueurs ou non
}
```
Premier point = position de départ (mettre = x,y de l'entité). ≥2 points pour pouvoir démarrer.

## 6. decors

```jsonc
{ "id": "d_mur1", "floorId": "f_rdc", "type": "wall", "name": "Mur nord",
  "x": 3.5, "y": 1.0, "width": 5, "height": 0.35, "rotation": 0,
  "revealed": false, "autoDiscover": true,
  "accessEntityId": "",
  "blocksMovement": true, "blocksVision": ["optical","infrared","laser"],
  "privateNote": "", "playerInfo": "" }
```
REQUIRED : `id`, `floorId`, `type`, x, y, width, height, rotation numériques ; `blocksVision` ⊂ canaux §5.3.
`blocksMovement`/`blocksVision`/`autoDiscover` surchargent le défaut catalogue (auto-remplis sinon).
`accessEntityId` peut référencer un `maglock`, `retina_scanner` ou `dna_analyzer` du plan. Le décor
est affiché **VERROUILLÉ** lorsque l’état effectif du contrôle est `active`, et **OUVERT** lorsque
le contrôle est `hacked` ou `offline` (y compris par héritage de l’état d’un nœud réseau).

Catalogue (type : w×h défaut | M=blocksMovement | V=blocksVision opaque(optical,infrared,laser) | layer floor = sous les entités) :

- **structural** : `wall` 3×0.35 M V · `pillar` 1×1 M V · `opaque_door` 1×0.35 M V · `opening` 1.5×0.25 (floor, passage dans un mur) · `glass` 2×0.2 M (vitre : bloque mouvement, PAS la vision) · `grid` 2×0.2 M (grille : idem) · `mana_barrier` 3×0.35 M (floor, mur invisible : bloque le passage, blocksVision:[astral], autoDiscover:false → reste caché des joueurs)
- **furniture** : `counter` 3×1 M V · `desk` 2×1 M · `cabinet` 1×0.75 M V · `shelf` 2×0.6 M V · `safe` 1.5×1.5 M V autoDiscover:false · `crate` 1×1 M · `server_rack` 1×2 M V · `planter` 2×0.75 M V
- **floor** : `chair` 0.6×0.6 M · `bench` 2×0.7 M · `rug` 3×2 · `floor_marking` 2×0.35 · `small_furniture` 1×1 M · `visual_element` 2×2
- LEGACY, ne pas générer : `stairs`, `elevator_decor` (remplacés par les transitions).

Pattern murs d'une pièce : un décor `wall` par segment (horizontal : width=longueur height=0.35 ; vertical : rotation 90 avec width=longueur). Placer des `opening`/`opaque_door` sur les passages.

## 7. transitions (liaisons verticales)

Communes : `id` REQUIRED, `type` ∈ `stairs|elevator|ladder|hatch|passage`, `name`, `state` ∈ `active|offline`, `revealed`, `accessEntityId` (id d'une entité accessControl conditionnant le passage, ou `""`), `endpoints` REQUIRED.

Endpoint : `{ "id": "ep_1", "floorId": "f_x", "x": 2.5, "y": 2.5, "label": "Niv 0" }` — floorId doit exister.

### stairs
```jsonc
{ "id":"tr_esc1", "type":"stairs", "name":"Escalier de service", "state":"active",
  "revealed":false, "accessEntityId":"", "direction":"both",   // REQUIRED : up|down|both
  "endpoints":[ {…f_rdc…}, {…f_ss1…} ] }
```
**Exactement 2 endpoints** (règle moteur). `direction` = sens de circulation autorisé (up = monter seulement, etc. ; rappel : order plus grand = plus bas).

### elevator
```jsonc
{ "id":"tr_asc1", "type":"elevator", "name":"Ascenseur principal", "state":"active",
  "revealed":false, "accessEntityId":"e_elev_lock",
  "cabin": { "width":2, "height":2, "rotation":0, "doorSide":"south" },  // REQUIRED ; doorSide: north|south|east|west
  "minFloorOrder": null, "maxFloorOrder": null,   // null = suit les extrêmes du plan ; int = borne figée
  "endpoints":[ { "id":"ep_a","floorId":"f_rdc","x":12.5,"y":2.5,"label":"Niv 0","hasDoor":true }, … ] }
```
- La gaine traverse tous les étages de la plage ; **tous les endpoints partagent x,y du premier** (forcé à la normalisation). Un endpoint max par étage. `hasDoor:false` = la gaine passe sans desservir.
- La cabine est dessinée automatiquement sur chaque étage de la plage (pas de décor à créer).

### ladder / hatch / passage
Comme stairs mais : champ `bidirectional` (bool, défaut true) au lieu de `direction`, nombre d'endpoints libre.

**Gameplay** : un pion joueur déplacé sur un endpoint franchit la liaison (si state active, sens autorisé, contrôle d'accès `accessEntityId` à l'état ouvert/désactivé) ; l'arrivée révèle durablement la pièce d'arrivée et ce qui est visible (occlusion réelle, `autoDiscover:true` requis pour chaque élément).

## 8. Hors périmètre du JSON de plan

`tokens` (pions PJ) et `discoveries` (mémoire d'exploration) sont stockés séparément (localStorage/Firestore), **jamais dans le plan importé** — ne pas les inclure. Pour info, un pion = `{id,name,shortLabel(≤3),color #rrggbb,icon,floorId,x,y,playerMovable,visible,locked}` ; icônes : `runner street-samurai rigger decker technomancer mystic-adept mage face infiltrator`.

## 9. Checklist de génération (ordre conseillé)

1. Grille : choisir cols×rows (défaut 24×16, cellSize 30). Tout doit tenir dedans (clamps silencieux sinon → éléments écrasés au bord).
2. Floors avec order 0..n−1 (0 = le plus haut). Révéler l'étage d'entrée uniquement.
3. Rooms : partitionner chaque étage en pièces (cellules exclusives), hues variées (190,130,30,280,330,60,210,0,100,250).
4. Decors : murs périmétriques + cloisons + portes/ouvertures, puis mobilier.
5. Entities : réseaux (`network_node` d'abord), puis dispositifs avec `networkId`, coverage explicite (défauts §5.1), directions orientées vers les zones à couvrir, patrouilles pour les mobiles.
6. Transitions entre étages ; lier les contrôles d'accès via `accessEntityId`.
7. Cohérence finale : tous les floorId/networkId/accessEntityId référencent des ids existants ; pour un décor, `accessEntityId` cible uniquement un `maglock`, `retina_scanner` ou `dna_analyzer` ; ids uniques ; `revealed:false` par défaut sauf zone d'entrée.

## 10. Squelette minimal valide

```json
{
  "schemaVersion": 2, "revision": 0, "name": "Run X", "updatedAt": 1750000000000,
  "grid": { "cols": 24, "rows": 16, "cellSize": 30 },
  "floors": [ { "id": "f_0", "name": "Niv 0", "order": 0, "revealed": true } ],
  "rooms": [ { "id": "r_1", "floorId": "f_0", "name": "Hall", "hue": 190,
               "cells": ["1,1","2,1","1,2","2,2"], "revealed": true } ],
  "entities": [ { "id": "e_1", "floorId": "f_0", "type": "camera", "name": "CAM_101",
                  "state": "active", "networkId": "", "x": 1.5, "y": 1.5,
                  "revealed": false, "autoDiscover": true, "privateNote": "", "playerInfo": "",
                  "patrol": null,
                  "coverage": { "shape": "cone", "channel": "optical", "direction": 45,
                                "angle": 60, "range": 6, "width": 1, "radius": 4,
                                "sweep": null, "revealed": false } } ],
  "decors": [], "transitions": []
}
```

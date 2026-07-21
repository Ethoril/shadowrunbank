# Plan de performance — carte & déplacement de pion

But : éliminer la latence résiduelle, en priorité **pendant le déplacement d'un pion PJ**
(le geste le plus sensible), puis fluidifier le rendu général (zoom / pan / édition).

Ce document est un plan de travail à exécuter dans une session dédiée. Chaque point liste :
symptôme/cause · correctif · fichiers concernés · impact attendu · effort/risque · vérification.

> **État au 2026-07-21 : P1 → P5 implémentés** (voir « Déjà fait » ci-dessous et le journal
> `development_plan_v2.md`). Reste **P6** (culling par viewport), optionnel, à n'envisager que si la
> latence persiste sur de très grands plans. Tests unitaires 40/40 verts + smoke rendu hors navigateur
> (réutilisation des nœuds, cache des cônes) ; **intégration Playwright à confirmer en CI** et
> **vérifications tablette manuelles** (drag, zoom molette + pinch, focus depuis l'arbre, rondes,
> overlay caméras/câbles) restent à faire.

---

## Déjà fait (ne pas refaire)

- **P1 — Layout thrashing du drag supprimé** : la géométrie du plateau (`rect` + `cellPx`) est figée au
  premier mouvement du geste (`dragGeom` dans `editor.js`) et rafraîchie sur scroll/resize ; plus de
  `getBoundingClientRect()` par `pointermove`. Les `pointermove` sont **coalescés** en une seule mise à
  jour par frame (rAF), vidée de force au `pointerup` pour ne jamais perdre la position finale.
  `MapView.gridPosFromEvent(e, cache)` accepte désormais la géométrie figée ; `captureBoardGeometry()`
  l'expose.
- **P2 — Éléments mobiles positionnés en `transform`** : entités, pions, décors, cabines et points de
  transition sont placés via `translate3d(var(--tx), var(--ty), 0)` (composité GPU, plus de reflow au
  déplacement) au lieu de `left/top` ; helper `setLayerPos`. `will-change: transform` sur l'élément en
  cours de drag (retiré au rendu suivant). Les keyframes d'état et le hover/`selected` portent aussi la
  position pour ne pas ramener l'élément en 0,0. Les cases/labels de pièce restent en `left/top`.
- **P3 — Cônes recalculés seulement s'ils bougent** : `renderCoverages` mémorise la géométrie de chaque
  couverture (`coveragePolyCache`) sous une signature (jeton d'occulteurs + `cellPx` + position + cap +
  cotes). Un cône statique n'est plus ray-casté à chaque frame ; le cache tombe avec `invalidateOccluders`.
  Stat de contrôle : `MapView.getCoverageCacheStats()`.
- **P4 — Drop et re-rendus mid-drag allégés** : au relâchement d'un pion sans changement d'étage, la vue
  MJ fait un simple `settleTokenDrag` (le pion est déjà posé, rien d'autre ne dépend de sa position) ;
  la vue joueur garde un `render()` pour révéler les découvertes. Pendant un drag actif,
  `updateCameraFeedVisibility` ne relance plus les re-rendus de couches pilotés par le flux caméra
  (resynchronisés au relâchement) ; les cônes qui balaient continuent de s'animer.
- **P5 — Rendu DOM incrémental** : `renderRooms/Decors/Entities/Tokens/Transitions` réconcilient leurs
  nœuds par clé (`reconcileLayer`, pendant HTML de `reconcileSvgGroup`) au lieu de `innerHTML=''` +
  recréation. Les nœuds (et leurs écouteurs `pointerdown`, et leurs images) sont réutilisés ; `className`
  + styles réaffectés à chaque frame, enfants reconstruits seulement si une signature de contenu change.
  `renderOverlay` réutilise ses groupes SVG. La couche « obstacles » réconcilie décors **et** cabines
  dans une liste unifiée.

### Antérieur

- **Cache d'occulteurs par jeton** (`map.js` `computeOccluders`) : validité = compteur de mutations
  `Store.getMutationSeq` + époque locale `invalidateOccluders`, au lieu d'un `JSON.stringify` de tout
  l'étage à chaque appel. Le cache reste valide pendant l'animation.
- **Boucle rAF au repos** (`anim.js`) : `Anim.refresh` met en cache la liste des entités réellement
  animées (rondes en mouvement / balayages) et la boucle s'arrête quand elle est vide.
- **Overlay SVG réconcilié** (`map.js` `renderCoverages`, `renderCables`, helper `reconcileSvgGroup`) :
  réutilisation des nœuds + mise à jour d'attributs au lieu d'un `innerHTML=''` + recréation par frame.

---

## Diagnostic du lag pendant le drag de pion (avant P1–P5)

Chaîne par `pointermove` (voir `editor.js` `onPointerMove`, branche `kind === 'token'`) :

1. `MapView.gridPosFromEvent(e)` appelle **`board().getBoundingClientRect()`** → une **lecture de layout
   forcée à CHAQUE move**.
2. On écrit ensuite `token.x/y` puis `MapView.moveTokenDiv()` qui pose **`style.left/top`** → **écriture
   de layout**.
   → Lecture + écriture de layout entrelacées à chaque move = **layout thrashing**.
3. En parallèle, si l'étage a des caméras qui balaient ou des rondes, la boucle rAF exécute
   `renderCoverages` (ray-casting de **tous** les cônes, même statiques) + `renderCables` +
   `updateCameraFeedVisibility` à ~30 fps, **en concurrence** avec le drag.
4. Au relâchement (`onPointerUp`), le pion déclenche `MapView.render()` (reconstruction complète du DOM)
   ou `Exploration.handleTokenRelease → App.renderAll()` → **à-coup en fin de geste**.

Les points ci-dessous sont ordonnés par rapport gain/effort pour ce scénario précis.

---

## P1 — Supprimer le layout thrashing du drag (cheap, gros gain, risque faible)

> ✅ **Fait (2026-07-21).** Voir « Déjà fait » ci-dessus. Description d'origine conservée pour référence.

**Cause.** `gridPosFromEvent` fait un `getBoundingClientRect()` par move (lecture layout), intercalé avec
l'écriture `left/top` de `moveTokenDiv`.

**Correctif.**
- Mémoriser le rect du plateau + `cellPx` **au début du drag** (dans le `dragSession`), et calculer la
  position grille à partir de ce rect mis en cache au lieu de relire `getBoundingClientRect` à chaque move.
  Invalider le cache sur `scroll` du wrapper, zoom et `resize`.
- **Coalescer** les `pointermove` : ne traiter qu'une mise à jour par frame via `requestAnimationFrame`
  (stocker le dernier event, l'appliquer dans le rAF), au lieu de réagir à chaque event brut.

**Fichiers.** `editor.js` (`onPointerMove`, création du `dragSession`, `onBoardPointerDown`) ;
`map.js` (`gridPosFromEvent` — variante acceptant un rect en cache, ou exposer le cache).

**Impact.** Élevé sur la fluidité du drag. **Effort.** Faible-moyen. **Risque.** Faible.

**Vérif.** DevTools › Performance pendant un drag : les barres « Recalculate Style / Layout » par frame
doivent chuter ; plus de « Forced reflow » signalé.

---

## P2 — Positionner les éléments mobiles en `transform` au lieu de `left/top`

> ✅ **Fait (2026-07-21).** Voir « Déjà fait » ci-dessus. Description d'origine conservée pour référence.

**Cause.** `setEntityScreenPos`, `moveTokenDiv`, `moveEntityDiv`, `moveDecorDiv` et le placement initial dans
`renderEntities/renderTokens/renderDecors` utilisent `left/top` → layout + paint à chaque frame. Idem pour
l'animation des rondes.

**Correctif.** Utiliser `transform: translate3d(x*cellPx, y*cellPx, 0)` (composité GPU, pas de reflow).
Poser `will-change: transform` sur l'élément en cours de drag/animation, le retirer à la fin.
Attention : le plateau est mis à l'échelle via `cellPx` (pas un `transform` CSS), donc vérifier que
`focusElement`/`scrollIntoView`, le hit-test (`gridPosFromEvent`) et le zoom restent cohérents avec des
positions en transform.

**Fichiers.** `map.js` (les `move*Div`, `setEntityScreenPos`, placement initial des couches).

**Impact.** Élevé (drag ET animation des rondes). **Effort.** Moyen. **Risque.** Moyen (touche tout le
positionnement ; bien tester zoom + scroll + focus).

**Vérif.** Performance : les frames d'animation/drag ne doivent plus contenir de « Layout », seulement
« Composite Layers ».

---

## P3 — Ne recalculer que les cônes qui changent (ray-casting)

> ✅ **Fait (2026-07-21)** pour `renderCoverages`. Voir « Déjà fait » ci-dessus. Le ray-casting de
> `cameraFeedSnapshot` (flux caméra piratée) n'est pas encore mémorisé — piste restante si besoin.

**Cause.** `renderCoverages` recalcule le polygone de **chaque** couverture par frame via `conePolygon`
(ray-casting contre tous les segments de murs) — y compris les caméras **statiques**, dont le cône ne
change jamais. Une seule caméra qui balaie déclenche le recalcul de tous les cônes de l'étage.

**Correctif.** Mémoriser les points de polygone par entité et ne recalculer que si l'entité bouge/balaie
(ronde en cours, `sweep`) ou si la géométrie a changé (`Store.getMutationSeq` / occluderToken).
Un cône statique se calcule une fois puis est réutilisé (seuls ses attributs de style peuvent changer).

**Fichiers.** `map.js` (`renderCoverages`) ; éventuellement `updateCameraFeedVisibility` /
`cameraFeedSnapshot` (le `isLineBlocked` fait aussi du ray-casting — à mémoriser/éviter quand rien n'a bougé).

**Impact.** Élevé sur un plan de banque (beaucoup de caméras statiques + quelques mobiles).
**Effort.** Moyen. **Risque.** Moyen (bien invalider le cache de polygones quand un porteur bouge).

---

## P4 — Rendre le relâchement et les re-rendus mid-drag légers

> ✅ **Fait (2026-07-21).** Voir « Déjà fait » ci-dessus. Description d'origine conservée pour référence.

**Cause.** À la fin d'un drag, `onPointerUp` appelle `MapView.render()` (reconstruction complète) ou
`handleTokenRelease → renderAll` → à-coup. À vérifier aussi : est-ce que déplacer le pion dans/hors d'un
cône de caméra piratée fait basculer `updateCameraFeedVisibility` vers un `renderEntities → renderOverlay`
complet **pendant** le drag ?

**Correctif.** Au drop, ne mettre à jour que la position validée du pion + les couches réellement affectées
(découvertes) au lieu d'un `render()` complet ; pendant un drag actif, limiter `updateCameraFeedVisibility`
à une mise à jour légère. Se fond en partie dans P5.

**Fichiers.** `editor.js` (`onPointerUp`) ; `map.js` (`render`, `updateCameraFeedVisibility`).

**Impact.** Moyen (supprime l'à-coup de fin de geste et d'éventuels à-coups mid-drag). **Effort.** Moyen.
**Risque.** Moyen.

---

## P5 — Rendu DOM incrémental (le gros gain général)

> ✅ **Fait (2026-07-21).** Voir « Déjà fait » ci-dessus. Description d'origine conservée pour référence.

**Cause.** `render()` détruit et recrée toutes les couches (`renderRooms`, `renderDecors`, `renderEntities`,
`renderTokens`, `renderTransitions`) à chaque action : sélection, zoom, édition, drop, découverte.

**Correctif.** Appliquer le même patron de réconciliation par clé que l'overlay SVG (`reconcileSvgGroup`
déjà en place) aux couches HTML : réutiliser les nœuds existants (clé = `data-id`), mettre à jour
position/classes/contenu, n'ajouter/retirer que le diff. Attention aux écouteurs `pointerdown` posés par
élément (les préserver en réutilisant le nœud).

**Fichiers.** `map.js` (`renderRooms`, `renderDecors`, `renderEntities`, `renderTokens`, `renderTransitions`).

**Impact.** Le plus élevé globalement (zoom, pan, sélection, édition, drop). **Effort.** Élevé.
**Risque.** Moyen-élevé (régressions visuelles ; tester chaque couche).

---

## P6 — (Optionnel, après P5) Culling par viewport

Ne rendre que les cases/éléments dans la zone visible du wrapper (zoomé, le plateau déborde). Plus gros
chantier ; à envisager seulement si la latence persiste sur de très grands plans après P5.

---

## Ordre recommandé

**P1 → P3 → P2 → P4 → P5** (→ P6 si nécessaire).
P1 est rapide et vise directement le thrashing du drag ; P3 coupe le coût de l'animation concurrente ;
P2 met le drag/anim sur le compositeur ; P4/P5 traitent les reconstructions.

## Mesure

- DevTools › Performance sur la tablette (ou desktop en émulation tactile) : enregistrer un drag de pion
  **avec des caméras actives**. Chercher les longues barres Layout / Recalculate Style / Paint et les
  « Forced reflow » (P1/P2), le scripting dans `renderCoverages`/`computeOccluders` (P3).
- Repère utile déjà exposé : `MapView.getOccluderCacheStats()` (`{entries, builds}`) — `builds` ne doit pas
  grimper pendant l'animation.
- Éventuellement instrumenter `renderCoverages` avec un compteur de frames + `performance.now()` en dev.

## Tests / garde-fous

- `pnpm test` (unit + intégration Playwright) doit rester vert.
- Vérifs manuelles tablette après chaque point : drag de pion fluide, zoom molette + pinch, focus depuis
  l'arbre de visibilité (`focusElement` + `scrollIntoView`), rondes animées correctes, overlay caméras/câbles
  identique visuellement.
- Convention repo : bump auto des `?v=` par le build (ne pas rebumper à la main) ; journal
  `development_plan_v2.md` à compléter (une ligne par changement + commit de renseignement du hash).

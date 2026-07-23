/* ============================================================
   map.js — Rendu de la carte : grille logique mise à l'échelle,
   pièces (cases peintes + contours calculés), entités, overlay
   SVG (couvertures, chemins de ronde, câbles réseau).
   Le catalogue déclaratif et ses capacités vivent dans catalog.js.
   ============================================================ */

const MapView = (() => {

    const catalog = EntityCatalog.types;

    const HACKED_COLOR = '#4af626';

    let cellPx = 30;  // taille d'une case logique à l'écran, recalculée à chaque rendu
    let zoom = 1;     // facteur appliqué à la taille "plein cadre" (1 = tout l'étage visible)
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 6;
    let walls = [];   // segments de murs de l'étage courant (coordonnées grille)
    const occluderCache = new Map();
    let occluderBuilds = 0;
    // Géométrie des cônes/faisceaux mémorisée par entité (points en pixels).
    // Un cône statique (caméra fixe, pas de balayage) garde la même signature
    // d'une frame à l'autre → on ne relance PAS le ray-casting (conePolygon)
    // à 30 fps. Vidé dès que la géométrie occultante change (invalidateOccluders).
    const coveragePolyCache = new Map();
    let coverageBuilds = 0;
    // La géométrie occultante (murs, décors/entités bloquant la vue, cabines)
    // ne change qu'à l'édition, jamais pendant l'animation des rondes/balayages.
    // On invalide donc explicitement via un compteur d'époque au lieu de
    // recalculer une signature JSON de tout l'étage à chaque appel (coûteux à
    // 30 fps sur tablette, une fois par entité à couverture).
    let occluderEpoch = 0;
    // Cartes d'obstacles de déplacement (E3), mémorisées par étage, invalidées
    // au même jeton que les occulteurs (mutations du plan + époque locale).
    const movementBlockerCache = new Map(); // floorId → { token, blockers }
    const reachableCache = new Map();        // tokenId → { key, cells }
    let lastCameraFeedSignature = '';
    const ROOM_OCCLUSION_CHANNELS = new Set(['optical', 'infrared', 'laser']);
    // La gaine d'ascenseur générée occulte comme un décor opaque (7.8),
    // y compris sur les étages qu'elle traverse sans porte.
    const CABIN_OCCLUSION_CHANNELS = new Set(['optical', 'infrared', 'laser']);
    const CABIN_COLOR = '#5c6bc0';

    const board = () => document.getElementById('board');
    const svgGroup = id => document.getElementById(id);
    const iconSrc = key => 'assets/icons/map/' + key + '.png';

    /* Position d'un élément mobile via transform (composité GPU) plutôt que
       left/top (reflow). --tx/--ty (centre en pixels) sont consommés par le
       `transform` du CSS ; les changer ne déclenche qu'un recompositing. */
    function setLayerPos(el, x, y) {
        if (!el) return;
        el.style.setProperty('--tx', (x * cellPx) + 'px');
        el.style.setProperty('--ty', (y * cellPx) + 'px');
    }

    function appendCatalogIcon(container, key, className, fallbackLabel, fallbackClassName) {
        const fallback = () => {
            if (!fallbackLabel || container.querySelector('.' + fallbackClassName)) return;
            const label = document.createElement('span');
            label.className = fallbackClassName;
            label.textContent = fallbackLabel;
            container.appendChild(label);
        };
        if (!key) {
            fallback();
            return null;
        }
        const image = document.createElement('img');
        image.className = className;
        image.src = iconSrc(key);
        image.alt = '';
        image.draggable = false;
        image.addEventListener('error', () => {
            image.remove();
            fallback();
        }, { once: true });
        container.appendChild(image);
        return image;
    }

    /* --- Dimensionnement : la grille logique remplit le wrapper en cases carrées.
       Au-delà du zoom 1, le plateau déborde et le wrapper devient scrollable
       (pan à la molette-clic ou aux ascenseurs). --- */
    function layoutBoard() {
        const wrapper = document.getElementById('map-wrapper');
        const grid = Store.getPlan().grid;
        const w = wrapper.clientWidth, h = wrapper.clientHeight;
        const fitPx = Math.max(8, Math.floor(Math.min(w / grid.cols, h / grid.rows)));
        cellPx = Math.max(8, Math.round(fitPx * zoom));
        const bw = cellPx * grid.cols, bh = cellPx * grid.rows;
        const b = board();
        b.style.width = bw + 'px';
        b.style.height = bh + 'px';
        b.style.left = Math.max(0, Math.floor((w - bw) / 2)) + 'px';
        b.style.top = Math.max(0, Math.floor((h - bh) / 2)) + 'px';
        b.style.backgroundSize = cellPx + 'px ' + cellPx + 'px';
    }

    /* --- Zoom : re-rendu complet à la nouvelle taille de case, puis le point
       grille sous l'ancre (coordonnées client) est remis sous l'ancre en
       ajustant le scroll du wrapper. Sans ancre : centre de la vue. --- */
    function setZoom(value, anchorX, anchorY) {
        const wrapper = document.getElementById('map-wrapper');
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
        if (Math.abs(next - zoom) < 1e-3) return;
        const viewRect = wrapper.getBoundingClientRect();
        const ax = anchorX === undefined ? viewRect.left + wrapper.clientWidth / 2 : anchorX;
        const ay = anchorY === undefined ? viewRect.top + wrapper.clientHeight / 2 : anchorY;
        const before = gridPosFromEvent({ clientX: ax, clientY: ay });
        zoom = next;
        render();
        const rect = board().getBoundingClientRect();
        wrapper.scrollLeft += Math.round(rect.left + before.x * cellPx - ax);
        wrapper.scrollTop += Math.round(rect.top + before.y * cellPx - ay);
    }

    function zoomBy(factor, anchorX, anchorY) {
        setZoom(zoom * factor, anchorX, anchorY);
    }

    function resetZoom() {
        setZoom(ZOOM_MIN);
    }

    /* Coordonnées grille (flottantes) depuis un événement souris.
       `cache` = { rect, cellPx } optionnel : pendant un drag, on fige la
       géométrie du plateau au début du geste pour ne PAS relire
       getBoundingClientRect() (lecture de layout) à chaque déplacement —
       c'est ce qui, entrelacé avec l'écriture left/top, provoquait le
       layout thrashing. Sans cache, comportement inchangé. */
    function gridPosFromEvent(e, cache) {
        const rect = cache ? cache.rect : board().getBoundingClientRect();
        const px = cache ? cache.cellPx : cellPx;
        return {
            x: (e.clientX - rect.left) / px,
            y: (e.clientY - rect.top) / px
        };
    }

    /* Fige la géométrie courante du plateau (rect écran + taille de case)
       pour la durée d'un drag. À rafraîchir si le wrapper défile, si l'on
       zoome ou si la fenêtre est redimensionnée. */
    function captureBoardGeometry() {
        return { rect: board().getBoundingClientRect(), cellPx };
    }

    /* Case entière (col/row) depuis un événement souris, null si hors grille */
    function cellFromEvent(e) {
        const grid = Store.getPlan().grid;
        const pos = gridPosFromEvent(e);
        const col = Math.floor(pos.x), row = Math.floor(pos.y);
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
        return { col, row };
    }

    /* ============================================================
       Murs : les arêtes extérieures des pièces (mêmes arêtes que
       les contours rendus) servent de segments opaques pour la
       couverture. Runs colinéaires fusionnés, dédoublonnés entre
       pièces adjacentes.
       ============================================================ */
    /* Arêtes unitaires du zonage AVANT fusion : pour chaque frontière de pièce
       (room↔room ou room↔vide), une arête sur la ligne de grille correspondante.
       `horiz` : ligne y → Set des colonnes c (arête [c, c+1] entre les cases
       (c, y-1) et (c, y)). `vert` : ligne x → Set des rangées r (arête entre
       (x-1, r) et (x, r)). Base commune de `computeWalls` (occlusion) et de
       `computeBlockedEdges` (déplacement E3). */
    function computeWallEdges(floorId) {
        const horiz = new Map();
        const vert = new Map();
        const addRun = (map, line, pos) => {
            if (!map.has(line)) map.set(line, new Set());
            map.get(line).add(pos);
        };
        Store.floorRooms(floorId).forEach(room => {
            const cellSet = new Set(room.cells);
            room.cells.forEach(key => {
                const [c, r] = key.split(',').map(Number);
                if (!cellSet.has(c + ',' + (r - 1))) addRun(horiz, r, c);
                if (!cellSet.has(c + ',' + (r + 1))) addRun(horiz, r + 1, c);
                if (!cellSet.has((c - 1) + ',' + r)) addRun(vert, c, r);
                if (!cellSet.has((c + 1) + ',' + r)) addRun(vert, c + 1, r);
            });
        });
        return { horiz, vert };
    }

    function computeWalls(floorId) {
        const { horiz, vert } = computeWallEdges(floorId);
        const segs = [];
        const merge = (map, horizontal) => {
            map.forEach((set, line) => {
                const sorted = [...set].sort((a, b) => a - b);
                let start = null, prev = null;
                const push = (a, b) => segs.push(horizontal
                    ? { x1: a, y1: line, x2: b + 1, y2: line }
                    : { x1: line, y1: a, x2: line, y2: b + 1 });
                sorted.forEach(v => {
                    if (start === null) { start = prev = v; return; }
                    if (v === prev + 1) { prev = v; return; }
                    push(start, prev);
                    start = prev = v;
                });
                if (start !== null) push(start, prev);
            });
        };
        merge(horiz, true);
        merge(vert, false);
        return segs;
    }

    /* ============================================================
       Obstacles de déplacement (E3) — modèle par ARÊTES de grille
       (mur = frontière infranchissable) + CASES non-entrables
       (obstacles massifs), consommé par `reachableCells`.

       Convention de clé d'arête (une arête sépare deux cases
       orthogonalement adjacentes) :
       - `H:L:c` = arête horizontale sur la ligne y=L, colonne c →
         bloque le pas entre (c, L-1) et (c, L) ;
       - `V:L:r` = arête verticale sur la ligne x=L, rangée r →
         bloque le pas entre (L-1, r) et (L, r).
       Ces clés coïncident avec les runs unitaires de computeWallEdges.
       ============================================================ */

    /* Empreinte d'un décor après rotation : largeur/hauteur effectives en
       cases (quart de tour = axes échangés), comme decorTouchesRoom. */
    function decorFootprint(decor) {
        const quarterTurn = Math.abs(Math.round(decor.rotation / 90)) % 2 === 1;
        return {
            w: quarterTurn ? decor.height : decor.width,
            h: quarterTurn ? decor.width : decor.height
        };
    }

    /* Rôle d'un décor vis-à-vis du déplacement (modèle du plan E3) :
       - 'gate' : porte/ouverture — peut PERCER une arête de zonage si
                  franchissable, ou la maintenir bloquée si verrouillée ;
       - 'cell' : tout autre décor bloquant (vitre, grille, pilier, mobilier)
                  → rend non-entrables les cases de son empreinte ;
       - 'none' : n'entrave pas le déplacement.
       Les MURS viennent uniquement du zonage des pièces (computeWallEdges) ;
       un décor n'agit jamais sur les arêtes en dehors des portes. */
    function decorMovementRole(decor) {
        if (decor.type === 'opaque_door' || decor.type === 'opening') return 'gate';
        return DecorCatalog.get(decor.type).blocksMovement ? 'cell' : 'none';
    }

    /* Une porte est franchissable si c'est une ouverture (toujours), une porte
       simple sans contrôleur d'accès (ouvrable à la main) ou une porte dont le
       contrôleur n'est pas actif (verrou ouvert/piraté). Une porte verrouillée
       (maglock actif) laisse l'arête bloquée. */
    function isDoorPassable(decor) {
        if (decor.type === 'opening') return true;
        return !decor.accessEntityId || Store.isAccessOpen(decor);
    }

    /* Arêtes de grille traversées par un décor fin/porte. L'axe le plus fin
       donne l'orientation ; la ligne de grille = arrondi du centre sur cet
       axe ; l'étendue sur l'axe long = colonnes/rangées couvertes. */
    function decorStraddledEdges(decor) {
        const { w, h } = decorFootprint(decor);
        const keys = [];
        if (h < w) { // barrière horizontale (fine en Y) → arêtes horizontales
            const line = Math.round(decor.y);
            const min = Math.floor(decor.x - w / 2);
            const max = Math.ceil(decor.x + w / 2) - 1;
            for (let c = min; c <= max; c++) keys.push('H:' + line + ':' + c);
        } else {     // barrière verticale (fine en X) → arêtes verticales
            const line = Math.round(decor.x);
            const min = Math.floor(decor.y - h / 2);
            const max = Math.ceil(decor.y + h / 2) - 1;
            for (let r = min; r <= max; r++) keys.push('V:' + line + ':' + r);
        }
        return keys;
    }

    /* Cases dont le CENTRE tombe dans l'empreinte (obstacle massif). */
    function footprintCells(cx, cy, w, h) {
        const keys = [];
        const minCol = Math.floor(cx - w / 2), maxCol = Math.ceil(cx + w / 2) - 1;
        const minRow = Math.floor(cy - h / 2), maxRow = Math.ceil(cy + h / 2) - 1;
        for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
                if (Math.abs((c + 0.5) - cx) <= w / 2 + 1e-9
                    && Math.abs((r + 0.5) - cy) <= h / 2 + 1e-9) keys.push(c + ',' + r);
            }
        }
        return keys;
    }

    /* Carte d'obstacles de l'étage : { edges:Set, cells:Set }. Zonage des
       pièces = murs ; décors fins = arêtes ; portes franchissables = arêtes
       percées ; obstacles massifs = cases. */
    function computeBlockedEdges(floorId) {
        const cached = movementBlockerCache.get(floorId);
        const token = occluderToken();
        if (cached && cached.token === token) return cached.blockers;

        const edges = new Set();
        const cells = new Set();
        const { horiz, vert } = computeWallEdges(floorId);
        horiz.forEach((set, line) => set.forEach(c => edges.add('H:' + line + ':' + c)));
        vert.forEach((set, line) => set.forEach(r => edges.add('V:' + line + ':' + r)));

        const pierced = [];
        Store.floorDecors(floorId).forEach(decor => {
            const role = decorMovementRole(decor);
            if (role === 'none') return;
            if (role === 'cell') {
                const { w, h } = decorFootprint(decor);
                footprintCells(decor.x, decor.y, w, h).forEach(k => cells.add(k));
                return;
            }
            // role === 'gate' : la porte agit sur l'arête de zonage qu'elle
            // chevauche — percée si franchissable, laissée bloquée sinon.
            const straddled = decorStraddledEdges(decor);
            if (isDoorPassable(decor)) pierced.push(...straddled);
            else straddled.forEach(k => edges.add(k)); // porte verrouillée = mur
        });
        // Les percements sont appliqués en dernier : une porte franchissable
        // ouvre l'arête même si une barrière la posait au même endroit.
        pierced.forEach(k => edges.delete(k));

        // Les cabines d'ascenseur ne sont PAS des cases bloquées : elles sont
        // « boardables ». Le pion doit pouvoir atteindre le point de passage
        // pour déclencher la modale de transition (déplacement inter-étages,
        // hors périmètre de la zone mono-étage).

        const blockers = { edges, cells };
        movementBlockerCache.set(floorId, { token, blockers });
        return blockers;
    }

    /* Coût octile : orthogonal = 1, diagonal ≈ 1,5. Dijkstra borné depuis la
       case du pion, 8-connexité, respect des arêtes/cases bloquées et
       anti-coupe d'angle (une diagonale exige ses deux arêtes orthogonales
       ouvertes). Renvoie un Set de clés "c,r" (case de départ incluse). */
    const DIAG_COST = 1.5;
    function reachableCells(token) {
        if (!token) return new Set();
        const grid = Store.getPlan().grid;
        const range = Number.isFinite(token.movementRange) ? token.movementRange : 6;
        const startC = Math.floor(token.x), startR = Math.floor(token.y);
        const cacheKey = token.floorId + '|' + startC + ',' + startR + '|' + range + '|' + occluderToken();
        const cached = reachableCache.get(token.id);
        if (cached && cached.key === cacheKey) return cached.cells;

        const { edges, cells: blockedCells } = computeBlockedEdges(token.floorId);
        const inGrid = (c, r) => c >= 0 && r >= 0 && c < grid.cols && r < grid.rows;
        const cellBlocked = (c, r) => blockedCells.has(c + ',' + r);
        // Arête ouverte entre deux cases orthogonalement adjacentes.
        const edgeOpen = (c, r, nc, nr) => {
            if (nr === r - 1) return !edges.has('H:' + r + ':' + c);       // nord
            if (nr === r + 1) return !edges.has('H:' + (r + 1) + ':' + c); // sud
            if (nc === c - 1) return !edges.has('V:' + c + ':' + r);       // ouest
            if (nc === c + 1) return !edges.has('V:' + (c + 1) + ':' + r); // est
            return false;
        };

        const result = new Set();
        if (!inGrid(startC, startR) || cellBlocked(startC, startR)) return result;
        const best = new Map();
        const startKey = startC + ',' + startR;
        best.set(startKey, 0);
        // File de priorité minimaliste (grille ~384 cases, frontière petite).
        const frontier = [{ c: startC, r: startR, d: 0 }];
        while (frontier.length) {
            let bi = 0;
            for (let i = 1; i < frontier.length; i++) if (frontier[i].d < frontier[bi].d) bi = i;
            const cur = frontier.splice(bi, 1)[0];
            const curKey = cur.c + ',' + cur.r;
            if (cur.d > (best.get(curKey) ?? Infinity)) continue;
            result.add(curKey);
            for (let dc = -1; dc <= 1; dc++) {
                for (let dr = -1; dr <= 1; dr++) {
                    if (!dc && !dr) continue;
                    const nc = cur.c + dc, nr = cur.r + dr;
                    if (!inGrid(nc, nr) || cellBlocked(nc, nr)) continue;
                    const diagonal = dc !== 0 && dr !== 0;
                    if (diagonal) {
                        // Anti-coupe d'angle : les deux arêtes orthogonales du
                        // coin doivent être ouvertes (on ne se faufile pas
                        // entre deux murs qui se touchent).
                        if (!edgeOpen(cur.c, cur.r, cur.c + dc, cur.r)
                            || !edgeOpen(cur.c, cur.r, cur.c, cur.r + dr)) continue;
                    } else if (!edgeOpen(cur.c, cur.r, nc, nr)) continue;
                    const nd = cur.d + (diagonal ? DIAG_COST : 1);
                    if (nd > range + 1e-9) continue;
                    const nKey = nc + ',' + nr;
                    if (nd < (best.get(nKey) ?? Infinity)) {
                        best.set(nKey, nd);
                        frontier.push({ c: nc, r: nr, d: nd });
                    }
                }
            }
        }
        reachableCache.set(token.id, { key: cacheKey, cells: result });
        return result;
    }

    /* Intersection rayon (p, d normalisé) × segment w → distance t, ou null */
    function raySegment(px, py, dx, dy, w) {
        const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-9) return null; // parallèles
        const ax = w.x1 - px, ay = w.y1 - py;
        const t = (ax * ey - ay * ex) / denom;
        const u = (ax * dy - ay * dx) / denom;
        if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) return t;
        return null;
    }

    /* Distance du premier mur touché par le rayon d'angle absolu `a`, bornée à
       `range`. Brique de base du découpage des cônes/faisceaux. */
    function castRay(cx, cy, a, range, wallSegs) {
        const dx = Math.cos(a), dy = Math.sin(a);
        let t = range;
        for (const w of wallSegs) {
            const hit = raySegment(cx, cy, dx, dy, w);
            if (hit !== null && hit < t) t = hit;
        }
        return t;
    }

    /* Polygone de visibilité du cône. Angles en degrés : 0 = est, 90 = sud.
       Retour en coordonnées grille.

       Échantillonnage angulaire régulier (le corps des murs) COMPLÉTÉ par un
       rayon vers chaque coin d'occulteur situé dans le cône, doublé d'un rayon
       de part et d'autre (±EPS). Sans ces rayons de coin, un cône qui balaie
       voyait le rayon régulier le plus proche d'une arête basculer d'une frame
       à l'autre entre « touche l'obstacle » (court) et « le manque » (pleine
       portée) : un pic apparaissait/disparaissait sur le bord (clignotement).
       Les rayons de coin épinglent la silhouette exacte, stable quel que soit
       le cap ; les rayons réguliers, eux, glissent le long du mur sans à-coup. */
    function conePolygon(cx, cy, dirDeg, angleDeg, range, wallSegs) {
        const EPS = 5e-4; // ~0,03° : encadre chaque coin sans le chevaucher
        const center = dirDeg * Math.PI / 180;
        const half = angleDeg * Math.PI / 180 / 2;
        const startA = center - half;
        const span = 2 * half;

        const steps = Math.max(16, Math.ceil(angleDeg / 2)); // ~1 rayon / 2°
        const angles = [];
        for (let i = 0; i <= steps; i++) angles.push(startA + (span * i) / steps);

        // Rayons vers les coins d'occulteurs à portée et dans l'ouverture.
        const range2 = range * range;
        for (const w of wallSegs) {
            for (let e = 0; e < 2; e += 1) {
                const ex = e ? w.x2 : w.x1, ey = e ? w.y2 : w.y1;
                const ddx = ex - cx, ddy = ey - cy;
                if (ddx * ddx + ddy * ddy > range2) continue;
                let d = Math.atan2(ddy, ddx) - center;
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                if (Math.abs(d) > half + EPS) continue;
                const a = center + d;
                angles.push(a - EPS, a, a + EPS);
            }
        }

        // Tri par écart angulaire depuis le bord d'attaque : chaque sommet étant
        // le premier contact de son rayon, le polygone reste en étoile (simple).
        const offset = a => {
            let d = a - startA;
            while (d < 0) d += 2 * Math.PI;
            while (d >= 2 * Math.PI) d -= 2 * Math.PI;
            return d;
        };
        angles.sort((p, q) => offset(p) - offset(q));

        const pts = [[cx, cy]];
        for (const a of angles) {
            const t = castRay(cx, cy, a, range, wallSegs);
            pts.push([cx + Math.cos(a) * t, cy + Math.sin(a) * t]);
        }
        return pts;
    }

    function clippedRayLength(cx, cy, dirDeg, range, wallSegs) {
        const a = dirDeg * Math.PI / 180;
        const dx = Math.cos(a), dy = Math.sin(a);
        let length = range;
        for (const wall of wallSegs) {
            const hit = raySegment(cx, cy, dx, dy, wall);
            if (hit !== null && hit < length) length = hit;
        }
        return length;
    }

    function orientedRectangle(cx, cy, dirDeg, length, width, centered) {
        const a = dirDeg * Math.PI / 180;
        const dx = Math.cos(a), dy = Math.sin(a);
        const px = -dy, py = dx;
        const start = centered ? -length / 2 : 0;
        const end = centered ? length / 2 : length;
        const halfWidth = width / 2;
        return [
            [cx + dx * start + px * halfWidth, cy + dy * start + py * halfWidth],
            [cx + dx * end + px * halfWidth, cy + dy * end + py * halfWidth],
            [cx + dx * end - px * halfWidth, cy + dy * end - py * halfWidth],
            [cx + dx * start - px * halfWidth, cy + dy * start - py * halfWidth]
        ];
    }

    function beamPolygon(cx, cy, dirDeg, range, width, wallSegs) {
        return orientedRectangle(cx, cy, dirDeg,
            clippedRayLength(cx, cy, dirDeg, range, wallSegs), width, false);
    }

    function rectanglePolygon(cx, cy, dirDeg, range, width) {
        return orientedRectangle(cx, cy, dirDeg, range, width, false);
    }

    function thresholdPolygon(cx, cy, dirDeg, depth, width) {
        return orientedRectangle(cx, cy, dirDeg, depth, width, true);
    }

    function polygonSegments(points) {
        return points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            return { x1: point[0], y1: point[1], x2: next[0], y2: next[1] };
        });
    }

    function pointOnSegment(point, start, end) {
        const cross = (point[1] - start[1]) * (end[0] - start[0])
            - (point[0] - start[0]) * (end[1] - start[1]);
        if (Math.abs(cross) > 1e-7) return false;
        return point[0] >= Math.min(start[0], end[0]) - 1e-7
            && point[0] <= Math.max(start[0], end[0]) + 1e-7
            && point[1] >= Math.min(start[1], end[1]) - 1e-7
            && point[1] <= Math.max(start[1], end[1]) + 1e-7;
    }

    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (pointOnSegment(point, polygon[j], polygon[i])) return true;
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];
            const crosses = (yi > point[1]) !== (yj > point[1])
                && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi;
            if (crosses) inside = !inside;
        }
        return inside;
    }

    function segmentIntersects(a, b, c, d) {
        const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1])
            - (q[1] - p[1]) * (r[0] - p[0]);
        const o1 = orient(a, b, c), o2 = orient(a, b, d);
        const o3 = orient(c, d, a), o4 = orient(c, d, b);
        if (((o1 > 1e-7 && o2 < -1e-7) || (o1 < -1e-7 && o2 > 1e-7))
            && ((o3 > 1e-7 && o4 < -1e-7) || (o3 < -1e-7 && o4 > 1e-7))) return true;
        return (Math.abs(o1) <= 1e-7 && pointOnSegment(c, a, b))
            || (Math.abs(o2) <= 1e-7 && pointOnSegment(d, a, b))
            || (Math.abs(o3) <= 1e-7 && pointOnSegment(a, c, d))
            || (Math.abs(o4) <= 1e-7 && pointOnSegment(b, c, d));
    }

    function polygonsIntersect(a, b) {
        if (a.some(point => pointInPolygon(point, b))
            || b.some(point => pointInPolygon(point, a))) return true;
        for (let ai = 0; ai < a.length; ai += 1) {
            const an = (ai + 1) % a.length;
            for (let bi = 0; bi < b.length; bi += 1) {
                if (segmentIntersects(a[ai], a[an], b[bi], b[(bi + 1) % b.length])) return true;
            }
        }
        return false;
    }

    // Jeton de validité = mutations du plan (Store) + époque locale (glisser
    // d'occulteur sans mutation immédiate). Comparaison entière/chaîne bon marché,
    // au lieu d'une signature JSON de tout l'étage à chaque appel.
    function occluderToken() {
        const seq = typeof Store.getMutationSeq === 'function' ? Store.getMutationSeq() : 0;
        return seq + '#' + occluderEpoch;
    }

    function computeOccluders(floorId, channel) {
        const key = floorId + ':' + channel;
        const token = occluderToken();
        const cached = occluderCache.get(key);
        if (cached && cached.token === token) return cached.segments;

        const segments = ROOM_OCCLUSION_CHANNELS.has(channel) ? computeWalls(floorId) : [];
        Store.floorDecors(floorId).forEach(decor => {
            if (Store.isAccessOpen(decor) || !decor.blocksVision.includes(channel)) return;
            const points = orientedRectangle(decor.x, decor.y, decor.rotation,
                decor.width, decor.height, true);
            segments.push(...polygonSegments(points));
        });
        Store.floorEntities(floorId).forEach(ent => {
            if (Store.getEffectiveState(ent) === 'offline'
                || !EntityCatalog.get(ent.type).blocksVision.includes(channel)) return;
            segments.push(...polygonSegments(orientedRectangle(ent.x, ent.y, 0, 1, 1, true)));
        });
        if (CABIN_OCCLUSION_CHANNELS.has(channel)) {
            Store.elevatorCabinsOnFloor(floorId).forEach(cabin => {
                segments.push(...polygonSegments(orientedRectangle(cabin.x, cabin.y,
                    cabin.rotation, cabin.width, cabin.height, true)));
            });
        }

        occluderBuilds += 1;
        occluderCache.set(key, { token, segments });
        return segments;
    }

    // Marque la géométrie occultante comme périmée : les prochains appels à
    // computeOccluders reconstruiront (une fois par canal) puis re-cacheront.
    function invalidateOccluders() {
        occluderEpoch += 1;
        // La forme des cônes dépend des occulteurs : leur cache tombe avec eux.
        coveragePolyCache.clear();
    }

    /* Vue live fournie par les caméras piratées. Rien n'est écrit dans les
       découvertes : si un mobile sort du cône, il disparaît immédiatement. */
    function cameraFeedSnapshot(floorId, now) {
        const at = now === undefined ? Date.now() : now;
        const roomIds = new Set(), entityIds = new Set();
        const decorIds = new Set(), transitionIds = new Set();
        const cameras = Store.cameraFeedCameras(floorId);

        cameras.forEach(camera => {
            const position = Anim.effectivePos(camera, at);
            const coverage = camera.coverage;
            const polygon = conePolygon(position.x, position.y,
                Anim.coverageDirection(camera, at), coverage.angle, coverage.range,
                computeOccluders(floorId, coverage.channel || 'optical'));
            const room = Store.roomAt(floorId, Math.floor(position.x), Math.floor(position.y));
            if (room) roomIds.add(room.id);

            Store.floorEntities(floorId).forEach(entity => {
                if (entity.id === camera.id) return;
                const target = Anim.effectivePos(entity, at);
                if (pointInPolygon([target.x, target.y], polygon)) entityIds.add(entity.id);
            });
            Store.floorDecors(floorId).forEach(decor => {
                const target = orientedRectangle(decor.x, decor.y, decor.rotation,
                    decor.width, decor.height, true);
                if (polygonsIntersect(target, polygon)) decorIds.add(decor.id);
            });
            Store.getPlan().transitions.forEach(transition => {
                if (transition.type === 'hatch') return;
                if (transition.endpoints.some(endpoint => endpoint.floorId === floorId
                    && pointInPolygon([endpoint.x, endpoint.y], polygon))) {
                    transitionIds.add(transition.id);
                }
            });
        });

        const sorted = set => [...set].sort();
        const snapshot = {
            floorId,
            cameraIds: cameras.map(camera => camera.id).sort(),
            roomIds: sorted(roomIds),
            entityIds: sorted(entityIds),
            decorIds: sorted(decorIds),
            transitionIds: sorted(transitionIds)
        };
        snapshot.signature = JSON.stringify(snapshot);
        return snapshot;
    }

    function isCameraFeedVisible(item, kind, now) {
        if (!item || !Store.isPlayerView()) return false;
        if (kind === 'floor' || kind === 'room') return Store.isCameraFeedRevealed(item, kind);
        const floor = Store.currentFloor();
        const floorId = item.floorId || (floor && floor.id);
        if (!floorId) return false;
        const snapshot = cameraFeedSnapshot(floorId, now);
        if (kind === 'entity') return snapshot.entityIds.includes(item.id);
        if (kind === 'decor') return snapshot.decorIds.includes(item.id);
        if (kind === 'transition') return snapshot.transitionIds.includes(item.id);
        return false;
    }

    function feedSnapshot(floorId, now, snapshot) {
        if (!Store.isPlayerView()) return null;
        return snapshot || cameraFeedSnapshot(floorId, now);
    }

    function cameraVisibleItems(items, kind, snapshot) {
        if (!snapshot) return items;
        const ids = new Set(snapshot[kind + 'Ids']);
        return items.filter(item => Store.isEffectivelyRevealed(item, kind) || ids.has(item.id));
    }

    function isLineBlocked(floorId, from, to, channel, targetMargin) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (distance < 1e-6) return false;
        const dx = (to.x - from.x) / distance;
        const dy = (to.y - from.y) / distance;
        const limit = Math.max(0, distance - (targetMargin == null ? 0.35 : targetMargin));
        return computeOccluders(floorId, channel || 'optical').some(segment => {
            const hit = raySegment(from.x, from.y, dx, dy, segment);
            return hit !== null && hit < limit;
        });
    }

    /* Réconciliation d'une couche HTML par clé — pendant de reconcileSvgGroup
       pour le SVG. On RÉUTILISE les nœuds existants au lieu de vider la couche
       (`innerHTML = ''`) et tout recréer à chaque rendu. Bénéfices :
       - les écouteurs pointerdown posés à la création sont conservés (une
         seule attache par nœud) ;
       - les images ne sont ni détruites ni redécodées ;
       - plus de churn DOM/GC sur zoom / pan / sélection / drop / édition.
       Contrats :
       - keyOf(item)   : clé stable (id d'entité, de pion, de case…) ;
       - create(item)  : crée le conteneur nu + attache l'écouteur (une fois) ;
       - update(el,item): réaffecte className + styles à chaque frame (bon
         marché, jamais de classe/état oublié) et ne reconstruit les enfants
         que si une signature de contenu (`data-sig`) a changé.
       L'ordre du tableau `items` est réimposé (insertBefore ne déplace qu'en
       cas de besoin) : l'empilement reste identique à un rendu complet. */
    function reconcileLayer(layer, items, keyOf, create, update) {
        const existing = new Map();
        Array.from(layer.children).forEach(child => {
            const key = child.dataset.key;
            if (key === undefined) { child.remove(); return; }
            existing.set(key, child);
        });
        const seen = new Set();
        let anchor = null;
        items.forEach(item => {
            const key = keyOf(item);
            if (seen.has(key)) return; // clé dupliquée : on ignore le doublon
            seen.add(key);
            let el = existing.get(key);
            if (!el) {
                el = create(item);
                el.dataset.key = key;
            }
            update(el, item);
            const next = anchor ? anchor.nextSibling : layer.firstChild;
            if (el !== next) layer.insertBefore(el, next);
            anchor = el;
        });
        existing.forEach((el, key) => { if (!seen.has(key)) el.remove(); });
    }

    /* --- Rendu des pièces : cases peintes, bordure sur les arêtes extérieures --- */
    function renderRooms() {
        const layer = document.getElementById('rooms-layer');
        if (!layer) return;
        const floor = Store.currentFloor();
        const sel = Store.ui.selection;
        const items = [];
        if (floor) {
            Store.visibleRooms(floor.id).forEach(room => {
                const isSelected = sel && sel.kind === 'room' && sel.id === room.id;
                const hidden = !Store.isEffectivelyRevealed(room, 'room');
                const cellSet = new Set(room.cells);
                // Pièces épurées (E1) : contours blancs, remplissage neutre quasi nul.
                // Le champ `hue` est conservé en donnée mais n'intervient plus au rendu.
                const fill = `rgba(255,255,255, ${isSelected ? 0.10 : hidden ? 0.03 : 0.05})`;
                const edge = `2px ${hidden ? 'dashed' : 'solid'} rgba(255,255,255, ${isSelected ? 1 : hidden ? 0.4 : 0.7})`;

                let labelCol = Infinity, labelRow = Infinity;
                room.cells.forEach(key => {
                    const [c, r] = key.split(',').map(Number);
                    if (r < labelRow || (r === labelRow && c < labelCol)) { labelRow = r; labelCol = c; }
                    items.push({
                        kind: 'cell', key: 'c:' + c + ',' + r, roomId: room.id, c, r, fill, edge,
                        // Contour calculé : bordure uniquement si pas de voisin dans la même pièce
                        top: !cellSet.has(c + ',' + (r - 1)),
                        bottom: !cellSet.has(c + ',' + (r + 1)),
                        left: !cellSet.has((c - 1) + ',' + r),
                        right: !cellSet.has((c + 1) + ',' + r)
                    });
                });

                if (room.cells.length > 0) {
                    // Le libellé part de la première case de la ligne la plus
                    // haute. Sur une pièce irrégulière, on le limite au segment
                    // continu réellement disponible afin qu'il ne déborde pas
                    // dans une autre zone.
                    let labelCellWidth = 1;
                    while (cellSet.has((labelCol + labelCellWidth) + ',' + labelRow)) {
                        labelCellWidth++;
                    }
                    items.push({
                        kind: 'label', key: 'l:' + room.id, roomId: room.id, name: room.name,
                        hidden, labelCol, labelRow, labelCellWidth, hue: room.hue
                    });
                }
            });
        }
        reconcileLayer(layer, items, it => it.key,
            () => document.createElement('div'),
            (div, it) => {
                if (it.kind === 'cell') {
                    div.className = 'room-cell';
                    div.dataset.roomId = it.roomId;
                    div.style.left = (it.c * cellPx) + 'px';
                    div.style.top = (it.r * cellPx) + 'px';
                    div.style.width = cellPx + 'px';
                    div.style.height = cellPx + 'px';
                    div.style.background = it.fill;
                    div.style.borderTop = it.top ? it.edge : '';
                    div.style.borderBottom = it.bottom ? it.edge : '';
                    div.style.borderLeft = it.left ? it.edge : '';
                    div.style.borderRight = it.right ? it.edge : '';
                } else {
                    div.className = 'room-label' + (it.hidden ? ' unrevealed' : '');
                    div.dataset.roomId = it.roomId;
                    div.textContent = it.name;
                    div.style.left = (it.labelCol * cellPx + 5) + 'px';
                    div.style.top = (it.labelRow * cellPx + 4) + 'px';
                    div.style.width = Math.max(1, it.labelCellWidth * cellPx - 10) + 'px';
                    div.style.color = `rgba(230,235,240,0.9)`;
                }
            });
    }

    /* --- Rendu des décors, séparé entre sol et obstacles ---
       Les deux couches sont réconciliées par clé. La couche « obstacles »
       héberge à la fois les décors et les cabines d'ascenseur : on la
       réconcilie donc à partir d'une liste unifiée (clés `decor:` / `cabin:`)
       pour qu'aucune des deux familles n'efface l'autre. */
    function renderDecors(now, snapshot) {
        const floorLayer = document.getElementById('decors-floor-layer');
        const obstacleLayer = document.getElementById('decors-layer');
        if (!floorLayer || !obstacleLayer) return;
        const passThrough = Store.ui.activeTool !== 'select';
        floorLayer.classList.toggle('pass-through', passThrough);
        obstacleLayer.classList.toggle('pass-through', passThrough);

        const floor = Store.currentFloor();
        const feed = floor ? feedSnapshot(floor.id, now, snapshot) : null;
        const decors = !floor ? []
            : Store.isPlayerView()
                ? cameraVisibleItems(Store.floorDecors(floor.id), 'decor', feed)
                : Store.visibleDecors(floor.id);
        const floorItems = [];
        const obstacleItems = [];
        decors.forEach(decor => {
            const item = { kind: 'decor', key: 'decor:' + decor.id, decor };
            (DecorCatalog.get(decor.type).layer === 'floor' ? floorItems : obstacleItems).push(item);
        });
        if (floor) {
            visibleCabins(floor, feed).forEach(cabin =>
                obstacleItems.push({ kind: 'cabin', key: 'cabin:' + cabin.transition.id, cabin }));
        }
        reconcileLayer(floorLayer, floorItems, it => it.key, createDecorItem, updateDecorItem);
        reconcileLayer(obstacleLayer, obstacleItems, it => it.key, createDecorItem, updateDecorItem);
    }

    /* Cabines à afficher sur l'étage (7.8). Vue joueur : seulement avec porte
       sur l'étage courant et transition révélée (ou vue via un flux caméra).
       Vue MJ : toute la plage desservie, en fantôme là où il n'y a pas de porte. */
    function visibleCabins(floor, feed) {
        return Store.elevatorCabinsOnFloor(floor.id).filter(cabin => {
            if (!Store.isPlayerView()) return true;
            if (!cabin.hasDoor) return false;
            const revealed = Store.isEndpointRevealed(cabin.transition, cabin.endpoint);
            return revealed || !!(feed && feed.transitionIds.includes(cabin.transition.id));
        });
    }

    function createDecorItem(it) {
        const div = document.createElement('div');
        if (it.kind === 'decor') {
            const decorId = it.decor.id;
            div.dataset.id = decorId;
            div.addEventListener('pointerdown', event => {
                event.stopPropagation();
                Editor.onDecorPointerDown(event, decorId);
            });
        } else {
            // Cabine : l'endpoint (donc la cible du drag) est relu dans le
            // dataset au clic, jamais figé dans la fermeture.
            div.addEventListener('pointerdown', event => {
                event.stopPropagation();
                Editor.onTransitionPointerDown(event, div.dataset.transitionId,
                    div.dataset.endpointId || null);
            });
        }
        return div;
    }

    function updateDecorItem(div, it) {
        if (it.kind === 'decor') updateDecorEl(div, it.decor);
        else updateCabinEl(div, it.cabin);
    }

    function updateDecorEl(div, decor) {
        const definition = DecorCatalog.get(decor.type);
        const accessOpen = Store.isAccessOpen(decor);
        const selection = Store.ui.selection;
        div.className = 'decor'
            + (definition.layer === 'floor' ? ' floor-decor' : '')
            + (decor.blocksVision.length ? ' blocks-vision' : '')
            + (accessOpen ? ' access-open' : '')
            + (Store.isPlayerView() || Store.isEffectivelyRevealed(decor, 'decor') ? '' : ' unrevealed')
            + (selection && selection.kind === 'decor' && selection.id === decor.id ? ' selected' : '');
        setLayerPos(div, decor.x, decor.y);
        div.style.width = (decor.width * cellPx) + 'px';
        div.style.height = (decor.height * cellPx) + 'px';
        div.style.color = definition.color;
        div.style.setProperty('--decor-rotation', decor.rotation + 'deg');
        div.title = decor.name + (decor.accessEntityId
            ? (accessOpen ? ' — OUVERT' : ' — VERROUILLÉ') : '');
        const sig = 'd|' + (definition.icon || '') + '|' + (definition.label || '') + '|' + (accessOpen ? '1' : '0');
        if (div.dataset.sig !== sig) {
            div.dataset.sig = sig;
            div.textContent = '';
            appendCatalogIcon(div, definition.icon, 'decor-icon', definition.label, 'decor-label');
            if (accessOpen) {
                const badge = document.createElement('span');
                badge.className = 'decor-access-state';
                badge.textContent = 'OUVERT';
                div.appendChild(badge);
            }
        }
    }

    function updateCabinEl(div, cabin) {
        const transition = cabin.transition;
        // Révélation par arrêt : la porte de cet étage n'apparaît que si son
        // propre point est dévoilé/découvert (ou vu via une caméra).
        const revealed = Store.isEndpointRevealed(transition, cabin.endpoint);
        const selection = Store.ui.selection;
        div.className = 'decor elevator-cabin'
            + (cabin.hasDoor ? '' : ' ghost')
            + (Store.isPlayerView() || revealed ? '' : ' unrevealed')
            + (selection && selection.kind === 'transition'
                && selection.id === transition.id ? ' selected' : '');
        div.dataset.transitionId = transition.id;
        div.dataset.endpointId = cabin.endpoint ? cabin.endpoint.id : '';
        setLayerPos(div, cabin.x, cabin.y);
        div.style.width = (cabin.width * cellPx) + 'px';
        div.style.height = (cabin.height * cellPx) + 'px';
        div.style.color = CABIN_COLOR;
        div.style.setProperty('--decor-rotation', cabin.rotation + 'deg');
        div.title = transition.name + (cabin.hasDoor ? '' : ' — gaine sans porte');
        const sig = 'c|' + (cabin.hasDoor ? 'door-' + cabin.doorSide : 'nodoor');
        if (div.dataset.sig !== sig) {
            div.dataset.sig = sig;
            div.textContent = '';
            appendCatalogIcon(div, 'elevator-decor', 'decor-icon', 'ELV', 'decor-label');
            if (cabin.hasDoor) {
                const door = document.createElement('div');
                door.className = 'elevator-cabin-door door-' + cabin.doorSide;
                div.appendChild(door);
            }
        }
    }

    const TRANSITION_LABELS = { stairs: 'ESC', elevator: 'ELV', ladder: 'ECH', hatch: 'TRP', passage: 'PAS' };
    const TRANSITION_ICONS = { stairs: 'stairs', elevator: 'elevator', ladder: 'ladder', hatch: 'hatch', passage: 'opening' };

    function renderTransitions(now, snapshot) {
        const layer = document.getElementById('transitions-layer');
        if (!layer) return;
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');
        const floor = Store.currentFloor();
        const feed = floor ? feedSnapshot(floor.id, now, snapshot) : null;
        // La visibilité se décide point par point : un endpoint dévoilé (ou
        // découvert, ou vu via caméra) apparaît sans exposer les autres points
        // de la même transition. On part donc de toutes les transitions ayant
        // un point sur l'étage et on filtre endpoint par endpoint plus bas.
        const items = [];
        if (floor) {
            Store.getPlan().transitions.filter(transition =>
                transition.endpoints.some(endpoint => endpoint.floorId === floor.id)).forEach(transition => {
                const cameraSeen = !!(feed && feed.transitionIds.includes(transition.id));
                transition.endpoints.filter(endpoint => endpoint.floorId === floor.id).forEach(endpoint => {
                    // Sans porte, la gaine seule occupe l'étage. Même le MJ ne
                    // voit pas d'icône d'arrêt, pour éviter toute ambiguïté.
                    const doorless = transition.type === 'elevator' && endpoint.hasDoor === false;
                    if (doorless) return;
                    const revealed = Store.isEndpointRevealed(transition, endpoint) || cameraSeen;
                    if (Store.isPlayerView() && !revealed) return;
                    items.push({ key: 'ep:' + transition.id + ':' + endpoint.id, transition, endpoint, revealed });
                });
            });
        }
        reconcileLayer(layer, items, it => it.key,
            it => {
                const div = document.createElement('div');
                div.dataset.transitionId = it.transition.id;
                div.dataset.endpointId = it.endpoint.id;
                div.addEventListener('pointerdown', event => {
                    event.stopPropagation();
                    Editor.onTransitionPointerDown(event, div.dataset.transitionId, div.dataset.endpointId);
                });
                return div;
            },
            (div, it) => updateTransitionEl(div, it));
    }

    function updateTransitionEl(div, it) {
        const { transition, endpoint, revealed } = it;
        const transitionIcon = TRANSITION_ICONS[transition.type];
        // 7.9 : l'icône d'escalier reflète le sens autorisé depuis cet endpoint.
        const exit = transition.type === 'stairs'
            ? Store.stairsExitDirection(transition, endpoint) : null;
        div.className = 'transition-endpoint state-' + transition.state
            + (transitionIcon ? ' has-icon' : '')
            + (Store.ui.selection && Store.ui.selection.kind === 'transition'
                && Store.ui.selection.id === transition.id ? ' selected' : '')
            + (Store.isPlayerView() || revealed ? '' : ' unrevealed');
        setLayerPos(div, endpoint.x, endpoint.y);
        div.dataset.symbol = TRANSITION_LABELS[transition.type] || 'TR';
        const letter = Store.endpointLetter(transition, endpoint);
        div.title = transition.name + (endpoint.label ? ' — ' + endpoint.label : '')
            + (letter ? ' (' + letter + ')' : '')
            + (transition.type !== 'stairs' ? '' : exit === 'up' ? ' — monte'
                : exit === 'down' ? ' — descend' : exit ? '' : ' — sans issue depuis cet étage');
        // Enfants reconstruits à chaque rendu : peu de points par étage, et cela
        // préserve la bascule has-icon ↔ symbole ::after gérée à l'échec de
        // chargement de l'icône.
        div.textContent = '';
        if (transitionIcon) {
            const image = appendCatalogIcon(div, transitionIcon, 'transition-icon', '', 'transition-label');
            if (image) image.addEventListener('error', () => div.classList.remove('has-icon'), { once: true });
        }
        if (transition.type === 'stairs') {
            const badge = document.createElement('span');
            badge.className = 'transition-direction' + (exit ? '' : ' blocked');
            badge.textContent = exit === 'up' ? '↑'
                : exit === 'down' ? '↓' : exit === 'both' ? '⇅' : '✕';
            div.appendChild(badge);
        }
    }

    function renderTokens() {
        const layer = document.getElementById('tokens-layer');
        if (!layer) return;
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');
        const floor = Store.currentFloor();
        const tokens = floor ? Store.visibleTokens(floor.id) : [];
        reconcileLayer(layer, tokens, token => token.id,
            token => {
                const tokenId = token.id;
                const div = document.createElement('div');
                div.dataset.id = tokenId;
                div.addEventListener('pointerdown', event => {
                    event.stopPropagation();
                    Editor.onTokenPointerDown(event, tokenId);
                });
                return div;
            },
            (div, token) => {
                div.className = 'runner-token'
                    + (token.locked ? ' locked' : '')
                    + (token.visible ? '' : ' unrevealed')
                    + (Store.ui.selection && Store.ui.selection.kind === 'token'
                        && Store.ui.selection.id === token.id ? ' selected' : '');
                setLayerPos(div, token.x, token.y);
                div.style.color = token.color;
                div.style.borderColor = token.color;
                div.title = token.name;
                const tokenIcon = /^[a-z0-9-]+$/.test(token.icon || '') ? token.icon : 'runner';
                const sig = 'tok|' + tokenIcon + '|' + token.shortLabel;
                if (div.dataset.sig !== sig) {
                    div.dataset.sig = sig;
                    div.textContent = '';
                    appendCatalogIcon(div, tokenIcon, 'token-icon', '', 'token-icon-fallback');
                    const label = document.createElement('span');
                    label.className = 'token-label';
                    label.textContent = token.shortLabel;
                    div.appendChild(label);
                }
            });
    }

    /* --- Zone de déplacement (E3) : cases atteignables du pion sélectionné.
       En vue joueur, contrainte réelle (seul un PJ mobile l'affiche) ; en vue
       MJ, simple repère (le placement reste libre). Couche non interactive :
       le hit-test passe par cellFromEvent + l'ensemble atteignable. --- */
    function renderMoveZone() {
        const layer = document.getElementById('move-zone-layer');
        if (!layer) return;
        const sel = Store.ui.selection;
        const floor = Store.currentFloor();
        const items = [];
        if (floor && sel && sel.kind === 'token') {
            const token = Store.findToken(sel.id);
            const movableInPlayer = token && token.playerMovable && !token.locked;
            const shows = token && token.floorId === floor.id
                && (!Store.isPlayerView() || (token.visible && movableInPlayer));
            if (shows) {
                const startKey = Math.floor(token.x) + ',' + Math.floor(token.y);
                reachableCells(token).forEach(key => {
                    const [c, r] = key.split(',').map(Number);
                    items.push({ key, c, r, origin: key === startKey, color: token.color });
                });
            }
        }
        reconcileLayer(layer, items, it => it.key,
            () => document.createElement('div'),
            (div, it) => {
                div.className = 'move-zone-cell' + (it.origin ? ' origin' : '');
                div.style.left = (it.c * cellPx) + 'px';
                div.style.top = (it.r * cellPx) + 'px';
                div.style.width = cellPx + 'px';
                div.style.height = cellPx + 'px';
                div.style.setProperty('--zone-color', it.color);
            });
    }

    /* --- Rendu des entités --- */
    function renderEntities(now, snapshot) {
        const layer = document.getElementById('entities-layer');
        if (!layer) return;
        // Les entités ne captent la souris qu'en mode sélection (sinon elles gêneraient la peinture/tracé)
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');
        const floor = Store.currentFloor();
        if (!floor) {
            reconcileLayer(layer, [], ent => ent.id, createEntityEl, () => {});
            return;
        }
        const at = now === undefined ? Date.now() : now;
        const feed = feedSnapshot(floor.id, at, snapshot);
        const entities = Store.isPlayerView()
            ? cameraVisibleItems(Store.floorEntities(floor.id), 'entity', feed)
            : Store.visibleEntities(floor.id);
        reconcileLayer(layer, entities, ent => ent.id, createEntityEl,
            (div, ent) => updateEntityEl(div, ent, at));
        renderOverlay();
    }

    function createEntityEl(ent) {
        const entId = ent.id;
        const div = document.createElement('div');
        div.dataset.id = entId;
        div.addEventListener('pointerdown', e => {
            e.stopPropagation();
            Editor.onEntityPointerDown(e, entId);
        });
        return div;
    }

    function updateEntityEl(div, ent, at) {
        const def = EntityCatalog.get(ent.type);
        const pos = Anim.effectivePos(ent, at);
        const sel = Store.ui.selection;
        div.className = 'entity state-' + Store.getEffectiveState(ent)
            + (Store.isPlayerView() || Store.isEffectivelyRevealed(ent, 'entity') ? '' : ' unrevealed')
            + (sel && sel.kind === 'entity' && sel.id === ent.id ? ' selected' : '');
        setLayerPos(div, pos.x, pos.y);
        div.style.color = def.color;
        div.style.borderColor = def.color;
        div.title = ent.name;
        const sig = 'e|' + (def.icon || '') + '|' + (def.label || '');
        if (div.dataset.sig !== sig) {
            div.dataset.sig = sig;
            div.textContent = '';
            appendCatalogIcon(div, def.icon, 'entity-icon', def.label, 'entity-label');
        }
    }

    /* --- Overlay SVG : couvertures (fond), rondes, câbles (dessus) --- */
    const SVG_NS = 'http://www.w3.org/2000/svg';

    /* Réconcilie les enfants d'un groupe SVG à partir d'une liste de descripteurs,
       en RÉUTILISANT les nœuds existants (simple mise à jour d'attributs) au lieu
       de tout détruire puis recréer à chaque frame. Divise nettement le churn
       DOM/GC pendant l'animation (cônes qui balaient, câbles qui suivent).
       spec = { key, tag, attrs:{name:value|null}, data:{clé:valeur} }.
       L'ordre de peinture n'étant pas significatif pour ces overlays translucides,
       on ne le réimpose pas ; les nœuds dont la clé disparaît sont retirés. */
    function reconcileSvgGroup(group, specs) {
        const existing = new Map();
        Array.from(group.children).forEach(child => {
            const key = child.getAttribute('data-key');
            if (key === null) { child.remove(); return; }
            existing.set(key, child);
        });
        const seen = new Set();
        specs.forEach(spec => {
            seen.add(spec.key);
            let el = existing.get(spec.key);
            if (!el || el.tagName !== spec.tag) {
                if (el) el.remove();
                el = document.createElementNS(SVG_NS, spec.tag);
                el.setAttribute('data-key', spec.key);
                group.appendChild(el);
            }
            Object.entries(spec.attrs).forEach(([name, value]) => {
                if (value === null || value === undefined) el.removeAttribute(name);
                else el.setAttribute(name, value);
            });
            if (spec.data) Object.entries(spec.data).forEach(([k, v]) => { el.dataset[k] = v; });
        });
        existing.forEach((el, key) => { if (!seen.has(key)) el.remove(); });
    }

    function renderOverlay() {
        const svg = document.getElementById('overlay-svg');
        if (!svg) return;
        // Groupes créés une seule fois et réutilisés (dans l'ordre = ordre de
        // peinture). Les nœuds réconciliés (couvertures, câbles) survivent ainsi
        // aussi aux rendus complets, pas seulement aux frames d'animation.
        ['g-coverages', 'g-coverage-handles', 'g-patrols', 'g-cables'].forEach(id => {
            if (!document.getElementById(id)) {
                const g = document.createElementNS(SVG_NS, 'g');
                g.id = id;
                svg.appendChild(g);
            }
        });
        const now = Date.now();
        renderCoverages(now);
        renderPatrols();
        renderCables(now);
    }

    /* Couvertures génériques. Les cônes et faisceaux sont découpés par les murs. */
    function renderCoverages(now) {
        const g = svgGroup('g-coverages');
        if (!g) return;
        const floor = Store.currentFloor();
        if (!Store.getOverlayPreferences().coverages || !floor) {
            reconcileSvgGroup(g, []);
            renderCoverageHandles(now);
            return;
        }

        const specs = [];
        Store.visibleEntities(floor.id).forEach(ent => {
            if (!ent.coverage) return;
            // La couverture conserve son réglage MJ indépendant, mais un cône
            // peut aussi avoir été découvert avec son porteur dans une salle.
            const coverageRevealed = ent.coverage.revealed
                || Store.isDiscovered('coverage', ent.id);
            if (Store.isPlayerView() && !coverageRevealed) return;
            const effState = Store.getEffectiveState(ent);
            if (effState === 'offline') return;
            const def = EntityCatalog.get(ent.type);
            const color = effState === 'hacked' ? HACKED_COLOR : def.color;
            // Vue MJ : couverture encore cachée aux joueurs → tracé atténué
            const hidden = !Store.isPlayerView()
                && !(Store.isEffectivelyRevealed(ent, 'entity') && coverageRevealed);

            const pos = Anim.effectivePos(ent, now);
            const coverage = ent.coverage;
            const dir = Anim.coverageDirection(ent, now);

            // Signature géométrique = tout ce qui déplace/redécoupe le polygone :
            // occulteurs (jeton), échelle (cellPx), position, cap, forme et cotes.
            // Identique d'une frame à l'autre pour un cône statique → cache hit.
            const geomSig = occluderToken() + '|' + cellPx + '|' + pos.x + '|' + pos.y
                + '|' + dir + '|' + coverage.shape + '|' + coverage.range
                + '|' + coverage.width + '|' + coverage.angle + '|' + coverage.radius
                + '|' + coverage.channel;
            let cached = coveragePolyCache.get(ent.id);
            if (!cached || cached.sig !== geomSig) {
                const occluders = computeOccluders(floor.id, coverage.channel);
                const geom = {};
                if (coverage.shape === 'circle' && occluders.length === 0) {
                    geom.tag = 'circle';
                    geom.attrs = { cx: pos.x * cellPx, cy: pos.y * cellPx, r: coverage.radius * cellPx };
                } else {
                    let points;
                    if (coverage.shape === 'beam') {
                        points = beamPolygon(pos.x, pos.y, dir, coverage.range, coverage.width, occluders);
                    } else if (coverage.shape === 'rectangle') {
                        points = rectanglePolygon(pos.x, pos.y, dir, coverage.range, coverage.width);
                    } else if (coverage.shape === 'threshold') {
                        points = thresholdPolygon(pos.x, pos.y, dir, coverage.range, coverage.width);
                    } else if (coverage.shape === 'circle') {
                        points = conePolygon(pos.x, pos.y, 0, 360, coverage.radius, occluders);
                    } else {
                        points = conePolygon(pos.x, pos.y, dir, coverage.angle, coverage.range, occluders);
                    }
                    geom.tag = 'polygon';
                    geom.attrs = { points: points.map(point =>
                        (point[0] * cellPx) + ',' + (point[1] * cellPx)).join(' ') };
                }
                coverageBuilds += 1;
                cached = { sig: geomSig, tag: geom.tag, attrs: geom.attrs };
                coveragePolyCache.set(ent.id, cached);
            }

            // Le style (couleur/opacité/pointillé) dépend de l'état et de la
            // révélation, pas de la géométrie : recalculé à chaque frame (bon
            // marché), fusionné avec la géométrie mémorisée.
            const attrs = Object.assign({
                fill: color,
                'fill-opacity': hidden ? '0.05' : effState === 'hacked' ? '0.14' : '0.10',
                stroke: color,
                'stroke-opacity': hidden ? '0.25' : '0.45',
                'stroke-width': coverage.shape === 'beam' ? '1.5' : '1',
                // toujours défini (jamais retiré) pour un nœud réutilisé d'une frame à l'autre
                'stroke-dasharray': hidden ? '4 4' : 'none'
            }, cached.attrs);
            specs.push({
                key: ent.id, tag: cached.tag, attrs,
                data: { entityId: ent.id, shape: coverage.shape, channel: coverage.channel }
            });
        });

        reconcileSvgGroup(g, specs);
        renderCoverageHandles(now);
    }

    const renderCones = renderCoverages;

    function coverageHandlePoint(ent, distance, direction) {
        const radians = direction * Math.PI / 180;
        return {
            x: ent.x + Math.cos(radians) * distance,
            y: ent.y + Math.sin(radians) * distance
        };
    }

    function constrainCoverageHandlePoint(point) {
        const grid = Store.getPlan().grid;
        const margin = 22 / cellPx;
        return {
            x: Math.min(grid.cols - margin, Math.max(margin, point.x)),
            y: Math.min(grid.rows - margin, Math.max(margin, point.y))
        };
    }

    function appendCoverageHandle(group, ent, handle, point, origin, label, value) {
        const visiblePoint = constrainCoverageHandlePoint(point);
        const visibleOrigin = constrainCoverageHandlePoint(origin);
        const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guide.classList.add('coverage-handle-guide');
        guide.setAttribute('x1', visibleOrigin.x * cellPx);
        guide.setAttribute('y1', visibleOrigin.y * cellPx);
        guide.setAttribute('x2', visiblePoint.x * cellPx);
        guide.setAttribute('y2', visiblePoint.y * cellPx);
        group.appendChild(guide);

        const control = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        control.classList.add('coverage-handle', 'coverage-handle-' + handle);
        control.dataset.entityId = ent.id;
        control.dataset.handle = handle;
        control.setAttribute('transform', `translate(${visiblePoint.x * cellPx} ${visiblePoint.y * cellPx})`);
        control.setAttribute('role', 'slider');
        control.setAttribute('aria-label', label);
        control.setAttribute('aria-valuetext', String(value));

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = label + ' : ' + value;
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hitArea.classList.add('coverage-handle-hit');
        hitArea.setAttribute('r', '22');
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.classList.add('coverage-handle-dot');
        dot.setAttribute('r', '6');
        control.append(title, hitArea, dot);
        control.addEventListener('pointerdown', event =>
            Editor.onCoverageHandlePointerDown(event, ent.id, handle));
        group.appendChild(control);
    }

    /* Poignées d'édition de la couverture sélectionnée. Elles n'existent qu'en
       mode MJ et restent indépendantes du polygone afin de conserver une cible
       tactile confortable, même pour un laser très fin. */
    function renderCoverageHandles(now) {
        const group = svgGroup('g-coverage-handles');
        if (!group) return;
        group.innerHTML = '';
        if (!Store.getOverlayPreferences().coverages) return;
        if (Store.isPlayerView() || Store.ui.activeTool !== 'select') return;
        const selection = Store.ui.selection;
        if (!selection || selection.kind !== 'entity') return;
        const ent = Store.findEntity(selection.id);
        const floor = Store.currentFloor();
        if (!ent || !ent.coverage || !floor || ent.floorId !== floor.id) return;

        const coverage = ent.coverage;
        const at = now === undefined ? Date.now() : now;
        const direction = Anim.coverageDirection(ent, at);
        const origin = Anim.effectivePos(ent, at);
        if (coverage.shape === 'circle') {
            appendCoverageHandle(group, ent, 'radius',
                coverageHandlePoint(origin, coverage.radius, 0), origin,
                'Rayon de la zone', coverage.radius + ' cases');
            return;
        }

        const axisDistance = coverage.shape === 'threshold' ? coverage.range / 2 : coverage.range;
        appendCoverageHandle(group, ent, 'axis',
            coverageHandlePoint(origin, axisDistance, direction), origin,
            coverage.shape === 'threshold' ? 'Orientation et profondeur' : 'Orientation et portée',
            coverage.range + ' cases · ' + Math.round(direction) + '°');

        if (['beam', 'rectangle', 'threshold'].includes(coverage.shape)) {
            const forward = coverage.shape === 'threshold' ? 0 : coverage.range / 2;
            const widthOrigin = coverageHandlePoint(origin, forward, direction);
            appendCoverageHandle(group, ent, 'width',
                coverageHandlePoint(widthOrigin, coverage.width / 2, direction + 90), widthOrigin,
                'Largeur de la zone', coverage.width + ' cases');
        }

        if (coverage.shape === 'cone') {
            appendCoverageHandle(group, ent, 'angle',
                coverageHandlePoint(origin, coverage.range, direction - coverage.angle / 2), origin,
                'Ouverture du cône', coverage.angle + '°');
        }
    }

    /* Chemins de ronde : polyligne pointillée + waypoints */
    function renderPatrols() {
        const g = svgGroup('g-patrols');
        if (!g) return;
        g.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        const sel = Store.ui.selection;

        Store.visibleEntities(floor.id).forEach(ent => {
            if (!ent.patrol || ent.patrol.points.length === 0) return;
            // Vue joueur : la ronde a son propre flag, indépendant de l'entité
            if (Store.isPlayerView() && !ent.patrol.revealed) return;
            const def = EntityCatalog.get(ent.type);
            const isSelected = sel && sel.kind === 'entity' && sel.id === ent.id;
            // Vue MJ : ronde encore cachée aux joueurs → atténuée
            const hidden = !Store.isPlayerView() && !(ent.revealed && ent.patrol.revealed);
            const opacity = isSelected ? 0.9 : hidden ? 0.22 : 0.45;

            const pts = ent.patrol.points;
            if (pts.length >= 2) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                const coords = pts.map(p => (p.x * cellPx) + ',' + (p.y * cellPx));
                if (ent.patrol.loop) coords.push((pts[0].x * cellPx) + ',' + (pts[0].y * cellPx));
                line.setAttribute('points', coords.join(' '));
                line.setAttribute('fill', 'none');
                line.setAttribute('stroke', def.color);
                line.setAttribute('stroke-opacity', opacity);
                line.setAttribute('stroke-width', '1.5');
                line.setAttribute('stroke-dasharray', '4 6');
                g.appendChild(line);
            }
            pts.forEach((p, i) => {
                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                dot.setAttribute('cx', p.x * cellPx);
                dot.setAttribute('cy', p.y * cellPx);
                dot.setAttribute('r', isSelected && !Store.isPlayerView() ? 7 : (i === 0 ? 4 : 2.5));
                dot.setAttribute('fill', def.color);
                dot.setAttribute('fill-opacity', opacity);
                dot.dataset.entityId = ent.id;
                dot.dataset.waypointIndex = i;
                if (isSelected && !Store.isPlayerView()) {
                    dot.classList.add('patrol-waypoint');
                    dot.setAttribute('stroke', '#ffffff');
                    dot.setAttribute('stroke-width', '1.5');
                    dot.addEventListener('pointerdown', event =>
                        Editor.onWaypointPointerDown(event, ent.id, i));
                }
                g.appendChild(dot);
            });
        });
    }

    /* Câbles réseau (cascade d'état conservée), extrémités = positions effectives */
    function renderCables(now) {
        const g = svgGroup('g-cables');
        if (!g) return;
        const floor = Store.currentFloor();
        if (!Store.getOverlayPreferences().networkLinks || !floor) {
            reconcileSvgGroup(g, []);
            return;
        }
        if (now === undefined) now = Date.now();
        // Vue joueur : un câble n'apparaît que si ses DEUX extrémités sont
        // révélées — garanti par la recherche du nœud dans la liste filtrée.
        const ents = Store.visibleEntities(floor.id);

        const specs = [];
        ents.forEach(ent => {
            if (ent.type === 'network_node' || !ent.networkId) return;
            const node = ents.find(n => n.id === ent.networkId);
            if (!node) return;

            const a = Anim.effectivePos(ent, now);
            const b = Anim.effectivePos(node, now);
            const effectiveState = Store.getEffectiveState(node);
            const stroke = effectiveState === 'active' ? 'rgba(74, 246, 38, 0.4)'
                : effectiveState === 'hacked' ? 'rgba(255, 179, 0, 0.6)'
                : 'rgba(82, 120, 116, 0.2)';
            specs.push({ key: ent.id, tag: 'line', attrs: {
                class: 'network-cable',
                x1: a.x * cellPx, y1: a.y * cellPx, x2: b.x * cellPx, y2: b.y * cellPx,
                stroke, 'stroke-width': '1.5'
            } });
        });

        reconcileSvgGroup(g, specs);
    }

    /* Position écran directe (drag / animation), sans reconstruire la couche */
    function setEntityScreenPos(entityId, x, y) {
        setLayerPos(document.querySelector(`.entity[data-id="${entityId}"]`), x, y);
    }

    /* Déplacement pendant un drag : position + câbles + couvertures suivent */
    function moveEntityDiv(entityId, x, y) {
        const div = document.querySelector(`.entity[data-id="${entityId}"]`);
        if (div) {
            setLayerPos(div, x, y);
            div.classList.add('dragging');
        }
        // Glisser une entité occultante (barrière de mana) déplace un occulteur
        // sans passer par render() : on force la reconstruction pour ce cadre.
        invalidateOccluders();
        renderCables();
        renderCoverages(Date.now());
    }

    function moveDecorDiv(decorId, x, y) {
        const div = document.querySelector(`.decor[data-id="${decorId}"]`);
        if (div) {
            setLayerPos(div, x, y);
            div.classList.add('dragging');
        }
        // Idem : un décor opaque déplacé doit re-découper les cônes en direct.
        invalidateOccluders();
        renderCoverages(Date.now());
    }

    function moveTokenDiv(tokenId, x, y) {
        const div = document.querySelector(`.runner-token[data-id="${tokenId}"]`);
        if (div) {
            setLayerPos(div, x, y);
            div.classList.add('dragging');
        }
    }

    /* Fin de drag d'un pion sans reconstruire la carte : le pion est déjà à sa
       position finale (posée pendant le glisser) et rien d'autre sur la carte
       ne dépend de sa position (les cônes/câbles suivent les dispositifs, pas
       les pions). On retire juste l'état de drag. Utilisé en vue MJ ; en vue
       joueur, un render() complet reste nécessaire pour révéler les
       découvertes faites en chemin. */
    function settleTokenDrag(tokenId) {
        const div = document.querySelector(`.runner-token[data-id="${tokenId}"]`);
        if (div) div.classList.remove('dragging');
    }

    function moveTransitionEndpointDiv(transitionId, endpointId, x, y) {
        const div = document.querySelector(`.transition-endpoint[data-transition-id="${transitionId}"][data-endpoint-id="${endpointId}"]`);
        if (div) {
            setLayerPos(div, x, y);
            div.classList.add('dragging');
        }
        // La gaine suit son endpoint pendant le drag (coordonnées partagées).
        setLayerPos(document.querySelector(`.elevator-cabin[data-transition-id="${transitionId}"]`), x, y);
    }

    function updateSelectionClasses() {
        const selection = Store.ui.selection;
        document.querySelectorAll('.entity[data-id]').forEach(element => {
            element.classList.toggle('selected', !!selection
                && selection.kind === 'entity' && selection.id === element.dataset.id);
        });
        document.querySelectorAll('.decor[data-id]').forEach(element => {
            element.classList.toggle('selected', !!selection
                && selection.kind === 'decor' && selection.id === element.dataset.id);
        });
        document.querySelectorAll('.runner-token[data-id]').forEach(element => {
            element.classList.toggle('selected', !!selection
                && selection.kind === 'token' && selection.id === element.dataset.id);
        });
        document.querySelectorAll('.transition-endpoint[data-transition-id], .elevator-cabin[data-transition-id]').forEach(element => {
            element.classList.toggle('selected', !!selection
                && selection.kind === 'transition'
                && selection.id === element.dataset.transitionId);
        });
        // La zone de déplacement dépend du pion sélectionné : elle suit la
        // sélection sans imposer un render() complet (sélection sans drag).
        renderMoveZone();
        renderCoverageHandles(Date.now());
    }

    function render() {
        // Un rendu complet suit toute mutation (édition, changement d'état,
        // sync distante) : c'est le point sûr pour périmer les occulteurs.
        invalidateOccluders();
        layoutBoard();
        const now = Date.now();
        const floor = Store.currentFloor();
        const feed = floor && Store.isPlayerView()
            ? cameraFeedSnapshot(floor.id, now) : null;
        lastCameraFeedSignature = feed ? feed.signature : '';
        renderRooms();
        renderMoveZone();
        renderDecors(now, feed);
        renderTransitions(now, feed);
        walls = floor ? computeOccluders(floor.id, 'optical') : [];
        renderEntities(now, feed); // appelle renderOverlay()
        renderTokens();
        const wrapper = document.getElementById('map-wrapper');
        const tool = Store.ui.activeTool;
        wrapper.className = 'map-wrapper'
            + (tool === 'paint' ? ' tool-paint' : '')
            + (tool === 'erase' ? ' tool-erase' : '')
            + (tool === 'patrol' ? ' tool-patrol' : '')
            + (tool === 'token' ? ' tool-token' : '')
            + (tool.startsWith('transition:') ? ' tool-transition' : '')
            + (EntityCatalog.types[tool] ? ' tool-place' : '')
            + (tool.startsWith('decor:') ? ' tool-decor' : '');
        // Resynchronise la boucle d'animation avec l'étage/les états rendus.
        if (typeof Anim !== 'undefined' && typeof Anim.refresh === 'function') Anim.refresh();
    }

    /* Appelé par la boucle d'animation : ne reconstruit les couches que
       lorsqu'un élément entre ou sort réellement d'un flux caméra. */
    function updateCameraFeedVisibility(now) {
        // Pendant un drag actif, on ne relance pas les re-rendus de couches
        // pilotés par le flux caméra (renderEntities/decors/…) : ils entreraient
        // en concurrence avec le geste. Le flux se resynchronise au relâchement
        // (render() en vue joueur). Les cônes qui balaient continuent, eux, de
        // s'animer via renderCoverages dans la boucle.
        if (typeof Editor !== 'undefined' && Editor.isPointerDragging()) return false;
        const floor = Store.currentFloor();
        const snapshot = floor && Store.isPlayerView()
            ? cameraFeedSnapshot(floor.id, now) : null;
        const signature = snapshot ? snapshot.signature : '';
        if (signature === lastCameraFeedSignature) return false;
        lastCameraFeedSignature = signature;
        const previousFloorId = floor && floor.id;
        Store.ensureVisibleView();
        const currentFloor = Store.currentFloor();
        if (!currentFloor || currentFloor.id !== previousFloorId) {
            render();
            return true;
        }
        renderRooms();
        renderDecors(now, snapshot);
        renderTransitions(now, snapshot);
        renderEntities(now, snapshot);
        return true;
    }

    function focusElement(kind, id) {
        let candidates = [];
        let dataProperty = 'id';
        if (kind === 'entity') candidates = document.querySelectorAll('.entity[data-id]');
        else if (kind === 'decor') candidates = document.querySelectorAll('.decor[data-id]');
        else if (kind === 'token') candidates = document.querySelectorAll('.runner-token[data-id]');
        else if (kind === 'transition') {
            candidates = document.querySelectorAll('.transition-endpoint[data-transition-id]');
            dataProperty = 'transitionId';
        } else if (kind === 'room') {
            candidates = document.querySelectorAll('.room-label[data-room-id]');
            dataProperty = 'roomId';
        }
        const target = kind === 'floor' ? board()
            : [...candidates].find(element => element.dataset[dataProperty] === id);
        if (!target) return false;
        // Zoomé ailleurs : ramène l'élément dans la zone visible avant le pulse
        if (target !== board()) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        target.classList.remove('map-focus-pulse');
        void target.offsetWidth;
        target.classList.add('map-focus-pulse');
        setTimeout(() => target.classList.remove('map-focus-pulse'), 1200);
        return true;
    }

    return {
        catalog, render, renderDecors, renderTransitions, renderTokens,
        renderEntities, renderOverlay, renderCoverages, renderCoverageHandles,
        renderCones, renderPatrols, renderCables,
        gridPosFromEvent, captureBoardGeometry, cellFromEvent, moveEntityDiv, moveDecorDiv, moveTokenDiv, settleTokenDrag,
        moveTransitionEndpointDiv, updateSelectionClasses, setEntityScreenPos,
        conePolygon, beamPolygon, rectanglePolygon, thresholdPolygon,
        computeOccluders, invalidateOccluders, isLineBlocked,
        computeBlockedEdges, reachableCells, renderMoveZone,
        pointInPolygon, cameraFeedSnapshot, isCameraFeedVisible,
        updateCameraFeedVisibility,
        focusElement,
        setZoom, zoomBy, resetZoom,
        getZoom: () => zoom,
        getZoomRange: () => ({ min: ZOOM_MIN, max: ZOOM_MAX }),
        getOccluderCacheStats: () => ({ entries: occluderCache.size, builds: occluderBuilds }),
        getCoverageCacheStats: () => ({ entries: coveragePolyCache.size, builds: coverageBuilds }),
        getWalls: () => walls
    };
})();

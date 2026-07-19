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
    let lastCameraFeedSignature = '';
    const ROOM_OCCLUSION_CHANNELS = new Set(['optical', 'infrared', 'laser']);
    // La gaine d'ascenseur générée occulte comme un décor opaque (7.8),
    // y compris sur les étages qu'elle traverse sans porte.
    const CABIN_OCCLUSION_CHANNELS = new Set(['optical', 'infrared', 'laser']);
    const CABIN_COLOR = '#5c6bc0';

    const board = () => document.getElementById('board');
    const svgGroup = id => document.getElementById(id);
    const iconSrc = key => 'assets/icons/map/' + key + '.png';

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

    /* Coordonnées grille (flottantes) depuis un événement souris */
    function gridPosFromEvent(e) {
        const rect = board().getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / cellPx,
            y: (e.clientY - rect.top) / cellPx
        };
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
    function computeWalls(floorId) {
        const horiz = new Map(); // ligne y → Set des colonnes c (run unitaire [c, c+1])
        const vert = new Map();  // ligne x → Set des rangées r (run unitaire [r, r+1])
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

    /* Polygone de visibilité du cône par échantillonnage angulaire.
       Angles en degrés : 0 = est, 90 = sud. Retour en coordonnées grille. */
    function conePolygon(cx, cy, dirDeg, angleDeg, range, wallSegs) {
        const steps = Math.max(16, Math.ceil(angleDeg / 2)); // ~1 rayon / 2°
        const startA = (dirDeg - angleDeg / 2) * Math.PI / 180;
        const stepA = (angleDeg * Math.PI / 180) / steps;
        const pts = [[cx, cy]];
        for (let i = 0; i <= steps; i++) {
            const a = startA + i * stepA;
            const dx = Math.cos(a), dy = Math.sin(a);
            let t = range;
            for (const w of wallSegs) {
                const hit = raySegment(cx, cy, dx, dy, w);
                if (hit !== null && hit < t) t = hit;
            }
            pts.push([cx + dx * t, cy + dy * t]);
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

    function occluderSignature(floorId, channel) {
        const rooms = ROOM_OCCLUSION_CHANNELS.has(channel)
            ? Store.floorRooms(floorId).map(room => [room.id, room.cells]) : [];
        const decors = Store.floorDecors(floorId)
            .filter(decor => !Store.isAccessOpen(decor) && decor.blocksVision.includes(channel))
            .map(decor => [decor.id, decor.x, decor.y, decor.width, decor.height, decor.rotation]);
        const entities = Store.floorEntities(floorId)
            .filter(ent => Store.getEffectiveState(ent) !== 'offline'
                && EntityCatalog.get(ent.type).blocksVision.includes(channel))
            .map(ent => [ent.id, ent.x, ent.y, ent.state]);
        const cabins = CABIN_OCCLUSION_CHANNELS.has(channel)
            ? Store.elevatorCabinsOnFloor(floorId).map(cabin =>
                [cabin.transition.id, cabin.x, cabin.y, cabin.width, cabin.height, cabin.rotation])
            : [];
        return JSON.stringify([rooms, decors, entities, cabins]);
    }

    function computeOccluders(floorId, channel) {
        const key = floorId + ':' + channel;
        const signature = occluderSignature(floorId, channel);
        const cached = occluderCache.get(key);
        if (cached && cached.signature === signature) return cached.segments;

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
        occluderCache.set(key, { signature, segments });
        return segments;
    }

    function invalidateOccluders() {
        occluderCache.clear();
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

    /* --- Rendu des pièces : cases peintes, bordure sur les arêtes extérieures --- */
    function renderRooms() {
        const layer = document.getElementById('rooms-layer');
        layer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        const sel = Store.ui.selection;

        Store.visibleRooms(floor.id).forEach(room => {
            const isSelected = sel && sel.kind === 'room' && sel.id === room.id;
            const hidden = !Store.isEffectivelyRevealed(room, 'room');
            const cellSet = new Set(room.cells);
            const fill = `hsla(${room.hue}, 90%, 60%, ${isSelected ? 0.22 : hidden ? 0.04 : 0.09})`;
            const edge = `2px ${hidden ? 'dashed' : 'solid'} hsla(${room.hue}, 90%, 60%, ${isSelected ? 1 : hidden ? 0.4 : 0.65})`;

            let labelCol = Infinity, labelRow = Infinity;
            room.cells.forEach(key => {
                const [c, r] = key.split(',').map(Number);
                if (r < labelRow || (r === labelRow && c < labelCol)) { labelRow = r; labelCol = c; }

                const div = document.createElement('div');
                div.className = 'room-cell';
                div.dataset.roomId = room.id;
                div.style.left = (c * cellPx) + 'px';
                div.style.top = (r * cellPx) + 'px';
                div.style.width = cellPx + 'px';
                div.style.height = cellPx + 'px';
                div.style.background = fill;
                // Contour calculé : bordure uniquement si pas de voisin dans la même pièce
                if (!cellSet.has(c + ',' + (r - 1))) div.style.borderTop = edge;
                if (!cellSet.has(c + ',' + (r + 1))) div.style.borderBottom = edge;
                if (!cellSet.has((c - 1) + ',' + r)) div.style.borderLeft = edge;
                if (!cellSet.has((c + 1) + ',' + r)) div.style.borderRight = edge;
                layer.appendChild(div);
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
                const label = document.createElement('div');
                label.className = 'room-label' + (hidden ? ' unrevealed' : '');
                label.dataset.roomId = room.id;
                label.textContent = room.name;
                label.style.left = (labelCol * cellPx + 5) + 'px';
                label.style.top = (labelRow * cellPx + 4) + 'px';
                label.style.width = Math.max(1, labelCellWidth * cellPx - 10) + 'px';
                label.style.color = `hsla(${room.hue}, 70%, 72%, 0.9)`;
                layer.appendChild(label);
            }
        });
    }

    /* --- Rendu des décors, séparé entre sol et obstacles --- */
    function renderDecors(now, snapshot) {
        const floorLayer = document.getElementById('decors-floor-layer');
        const obstacleLayer = document.getElementById('decors-layer');
        if (!floorLayer || !obstacleLayer) return;
        floorLayer.innerHTML = '';
        obstacleLayer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        const passThrough = Store.ui.activeTool !== 'select';
        floorLayer.classList.toggle('pass-through', passThrough);
        obstacleLayer.classList.toggle('pass-through', passThrough);
        const selection = Store.ui.selection;

        const feed = feedSnapshot(floor.id, now, snapshot);
        const decors = Store.isPlayerView()
            ? cameraVisibleItems(Store.floorDecors(floor.id), 'decor', feed)
            : Store.visibleDecors(floor.id);
        decors.forEach(decor => {
            const definition = DecorCatalog.get(decor.type);
            const accessOpen = Store.isAccessOpen(decor);
            const div = document.createElement('div');
            div.className = 'decor'
                + (definition.layer === 'floor' ? ' floor-decor' : '')
                + (decor.blocksVision.length ? ' blocks-vision' : '')
                + (accessOpen ? ' access-open' : '')
                + (Store.isPlayerView() || Store.isEffectivelyRevealed(decor, 'decor') ? '' : ' unrevealed');
            if (selection && selection.kind === 'decor' && selection.id === decor.id) {
                div.classList.add('selected');
            }
            div.dataset.id = decor.id;
            div.style.left = (decor.x * cellPx) + 'px';
            div.style.top = (decor.y * cellPx) + 'px';
            div.style.width = (decor.width * cellPx) + 'px';
            div.style.height = (decor.height * cellPx) + 'px';
            div.style.color = definition.color;
            div.style.setProperty('--decor-rotation', decor.rotation + 'deg');
            div.title = decor.name + (decor.accessEntityId
                ? (accessOpen ? ' — OUVERT' : ' — VERROUILLÉ') : '');
            appendCatalogIcon(div, definition.icon, 'decor-icon', definition.label, 'decor-label');
            if (accessOpen) {
                const badge = document.createElement('span');
                badge.className = 'decor-access-state';
                badge.textContent = 'OUVERT';
                div.appendChild(badge);
            }
            div.addEventListener('pointerdown', event => {
                event.stopPropagation();
                Editor.onDecorPointerDown(event, decor.id);
            });
            (definition.layer === 'floor' ? floorLayer : obstacleLayer).appendChild(div);
        });
        renderElevatorCabins(obstacleLayer, floor, feed);
    }

    /* Cabines d'ascenseur générées depuis les transitions (7.8) : la
       géométrie est celle de `cabin`, la position celle des endpoints.
       Vue joueur : seulement avec porte sur l'étage courant et transition
       révélée (ou vue via un flux caméra). Vue MJ : la gaine apparaît sur
       toute la plage desservie, en fantôme quand il n'y a pas de porte. */
    function renderElevatorCabins(layer, floor, feed) {
        const selection = Store.ui.selection;
        Store.elevatorCabinsOnFloor(floor.id).forEach(cabin => {
            const transition = cabin.transition;
            // Révélation par arrêt : la porte de cet étage n'apparaît que si
            // son propre point est dévoilé/découvert (ou vu via une caméra).
            const revealed = Store.isEndpointRevealed(transition, cabin.endpoint);
            if (Store.isPlayerView()) {
                if (!cabin.hasDoor) return;
                if (!revealed && !(feed && feed.transitionIds.includes(transition.id))) return;
            }
            const div = document.createElement('div');
            div.className = 'decor elevator-cabin'
                + (cabin.hasDoor ? '' : ' ghost')
                + (Store.isPlayerView() || revealed ? '' : ' unrevealed')
                + (selection && selection.kind === 'transition'
                    && selection.id === transition.id ? ' selected' : '');
            div.dataset.transitionId = transition.id;
            div.style.left = (cabin.x * cellPx) + 'px';
            div.style.top = (cabin.y * cellPx) + 'px';
            div.style.width = (cabin.width * cellPx) + 'px';
            div.style.height = (cabin.height * cellPx) + 'px';
            div.style.color = CABIN_COLOR;
            div.style.setProperty('--decor-rotation', cabin.rotation + 'deg');
            div.title = transition.name + (cabin.hasDoor ? '' : ' — gaine sans porte');
            appendCatalogIcon(div, 'elevator-decor', 'decor-icon', 'ELV', 'decor-label');
            if (cabin.hasDoor) {
                const door = document.createElement('div');
                door.className = 'elevator-cabin-door door-' + cabin.doorSide;
                div.appendChild(door);
            }
            div.addEventListener('pointerdown', event => {
                event.stopPropagation();
                Editor.onTransitionPointerDown(event, transition.id,
                    cabin.endpoint ? cabin.endpoint.id : null);
            });
            layer.appendChild(div);
        });
    }

    function renderTransitions(now, snapshot) {
        const layer = document.getElementById('transitions-layer');
        if (!layer) return;
        layer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');
        const labels = { stairs: 'ESC', elevator: 'ELV', ladder: 'ECH', hatch: 'TRP', passage: 'PAS' };
        const icons = { stairs: 'stairs', elevator: 'elevator', ladder: 'ladder', hatch: 'hatch', passage: 'opening' };
        const feed = feedSnapshot(floor.id, now, snapshot);
        // La visibilité se décide point par point : un endpoint dévoilé (ou
        // découvert, ou vu via caméra) apparaît sans exposer les autres points
        // de la même transition. On part donc de toutes les transitions ayant
        // un point sur l'étage et on filtre endpoint par endpoint plus bas.
        const transitions = Store.getPlan().transitions.filter(transition =>
            transition.endpoints.some(endpoint => endpoint.floorId === floor.id));
        transitions.forEach(transition => {
            const cameraSeen = !!(feed && feed.transitionIds.includes(transition.id));
            transition.endpoints.filter(endpoint => endpoint.floorId === floor.id).forEach(endpoint => {
                // Sans porte, la gaine seule occupe l'étage. Même le MJ ne
                // voit pas d'icône d'arrêt, pour éviter toute ambiguïté.
                const doorless = transition.type === 'elevator' && endpoint.hasDoor === false;
                if (doorless) return;
                const revealed = Store.isEndpointRevealed(transition, endpoint) || cameraSeen;
                if (Store.isPlayerView() && !revealed) return;
                const div = document.createElement('div');
                div.className = 'transition-endpoint state-' + transition.state
                    + (Store.ui.selection && Store.ui.selection.kind === 'transition'
                        && Store.ui.selection.id === transition.id ? ' selected' : '')
                    + (Store.isPlayerView() || revealed ? '' : ' unrevealed');
                div.dataset.transitionId = transition.id;
                div.dataset.endpointId = endpoint.id;
                div.style.left = (endpoint.x * cellPx) + 'px';
                div.style.top = (endpoint.y * cellPx) + 'px';
                div.dataset.symbol = labels[transition.type] || 'TR';
                const letter = Store.endpointLetter(transition, endpoint);
                div.title = transition.name + (endpoint.label ? ' — ' + endpoint.label : '')
                    + (letter ? ' (' + letter + ')' : '');
                const transitionIcon = icons[transition.type];
                if (transitionIcon) {
                    div.classList.add('has-icon');
                    const image = appendCatalogIcon(div, transitionIcon, 'transition-icon', '', 'transition-label');
                    if (image) image.addEventListener('error', () => div.classList.remove('has-icon'), { once: true });
                }
                if (transition.type === 'stairs') {
                    // 7.9 : l'icône reflète le sens autorisé depuis cet endpoint.
                    const exit = Store.stairsExitDirection(transition, endpoint);
                    const badge = document.createElement('span');
                    badge.className = 'transition-direction' + (exit ? '' : ' blocked');
                    badge.textContent = exit === 'up' ? '↑'
                        : exit === 'down' ? '↓' : exit === 'both' ? '⇅' : '✕';
                    div.appendChild(badge);
                    div.title += exit === 'up' ? ' — monte'
                        : exit === 'down' ? ' — descend'
                        : exit ? '' : ' — sans issue depuis cet étage';
                }
                div.addEventListener('pointerdown', event => {
                    event.stopPropagation();
                    Editor.onTransitionPointerDown(event, transition.id, endpoint.id);
                });
                layer.appendChild(div);
            });
        });
    }

    function renderTokens() {
        const layer = document.getElementById('tokens-layer');
        if (!layer) return;
        layer.innerHTML = '';
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');
        const floor = Store.currentFloor();
        if (!floor) return;
        Store.visibleTokens(floor.id).forEach(token => {
            const div = document.createElement('div');
            div.className = 'runner-token'
                + (token.locked ? ' locked' : '')
                + (token.visible ? '' : ' unrevealed')
                + (Store.ui.selection && Store.ui.selection.kind === 'token'
                    && Store.ui.selection.id === token.id ? ' selected' : '');
            div.dataset.id = token.id;
            div.style.left = (token.x * cellPx) + 'px';
            div.style.top = (token.y * cellPx) + 'px';
            div.style.color = token.color;
            div.style.borderColor = token.color;
            const tokenIcon = /^[a-z0-9-]+$/.test(token.icon || '') ? token.icon : 'runner';
            appendCatalogIcon(div, tokenIcon, 'token-icon', '', 'token-icon-fallback');
            const label = document.createElement('span');
            label.className = 'token-label';
            label.textContent = token.shortLabel;
            div.appendChild(label);
            div.title = token.name;
            div.addEventListener('pointerdown', event => {
                event.stopPropagation();
                Editor.onTokenPointerDown(event, token.id);
            });
            layer.appendChild(div);
        });
    }

    /* --- Rendu des entités --- */
    function renderEntities(now, snapshot) {
        const layer = document.getElementById('entities-layer');
        layer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        const sel = Store.ui.selection;
        const at = now === undefined ? Date.now() : now;
        const feed = feedSnapshot(floor.id, at, snapshot);
        const entities = Store.isPlayerView()
            ? cameraVisibleItems(Store.floorEntities(floor.id), 'entity', feed)
            : Store.visibleEntities(floor.id);

        // Les entités ne captent la souris qu'en mode sélection (sinon elles gêneraient la peinture/tracé)
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');

        entities.forEach(ent => {
            const def = EntityCatalog.get(ent.type);
            const pos = Anim.effectivePos(ent, at);
            const div = document.createElement('div');
            div.className = 'entity state-' + Store.getEffectiveState(ent)
                + (Store.isPlayerView() || Store.isEffectivelyRevealed(ent, 'entity') ? '' : ' unrevealed');
            div.dataset.id = ent.id;
            div.style.left = (pos.x * cellPx) + 'px';
            div.style.top = (pos.y * cellPx) + 'px';
            div.style.color = def.color;
            div.style.borderColor = def.color;
            appendCatalogIcon(div, def.icon, 'entity-icon', def.label, 'entity-label');
            div.title = ent.name;
            if (sel && sel.kind === 'entity' && sel.id === ent.id) div.classList.add('selected');

            div.addEventListener('pointerdown', e => {
                e.stopPropagation();
                Editor.onEntityPointerDown(e, ent.id);
            });

            layer.appendChild(div);
        });

        renderOverlay();
    }

    /* --- Overlay SVG : couvertures (fond), rondes, câbles (dessus) --- */
    function renderOverlay() {
        const svg = document.getElementById('overlay-svg');
        svg.innerHTML = '';
        ['g-coverages', 'g-coverage-handles', 'g-patrols', 'g-cables'].forEach(id => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.id = id;
            svg.appendChild(g);
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
        g.innerHTML = '';
        if (!Store.getOverlayPreferences().coverages) return;
        const floor = Store.currentFloor();
        if (!floor) return;

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
            const occluders = computeOccluders(floor.id, coverage.channel);
            let shape;
            if (coverage.shape === 'circle' && occluders.length === 0) {
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                shape.setAttribute('cx', pos.x * cellPx);
                shape.setAttribute('cy', pos.y * cellPx);
                shape.setAttribute('r', coverage.radius * cellPx);
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
                shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                shape.setAttribute('points', points.map(point =>
                    (point[0] * cellPx) + ',' + (point[1] * cellPx)).join(' '));
            }
            shape.dataset.entityId = ent.id;
            shape.dataset.shape = coverage.shape;
            shape.dataset.channel = coverage.channel;
            shape.setAttribute('fill', color);
            shape.setAttribute('fill-opacity', hidden ? '0.05' : effState === 'hacked' ? '0.14' : '0.10');
            shape.setAttribute('stroke', color);
            shape.setAttribute('stroke-opacity', hidden ? '0.25' : '0.45');
            shape.setAttribute('stroke-width', coverage.shape === 'beam' ? '1.5' : '1');
            if (hidden) shape.setAttribute('stroke-dasharray', '4 4');
            g.appendChild(shape);
        });

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
        g.innerHTML = '';
        if (!Store.getOverlayPreferences().networkLinks) return;
        const floor = Store.currentFloor();
        if (!floor) return;
        if (now === undefined) now = Date.now();
        // Vue joueur : un câble n'apparaît que si ses DEUX extrémités sont
        // révélées — garanti par la recherche du nœud dans la liste filtrée.
        const ents = Store.visibleEntities(floor.id);

        ents.forEach(ent => {
            if (ent.type === 'network_node' || !ent.networkId) return;
            const node = ents.find(n => n.id === ent.networkId);
            if (!node) return;

            const a = Anim.effectivePos(ent, now);
            const b = Anim.effectivePos(node, now);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'network-cable');
            line.setAttribute('x1', a.x * cellPx);
            line.setAttribute('y1', a.y * cellPx);
            line.setAttribute('x2', b.x * cellPx);
            line.setAttribute('y2', b.y * cellPx);

            const effectiveState = Store.getEffectiveState(node);
            if (effectiveState === 'active') {
                line.setAttribute('stroke', 'rgba(74, 246, 38, 0.4)');
            } else if (effectiveState === 'hacked') {
                line.setAttribute('stroke', 'rgba(255, 179, 0, 0.6)');
            } else {
                line.setAttribute('stroke', 'rgba(82, 120, 116, 0.2)');
            }
            line.setAttribute('stroke-width', '1.5');
            g.appendChild(line);
        });
    }

    /* Position écran directe (drag / animation), sans reconstruire la couche */
    function setEntityScreenPos(entityId, x, y) {
        const div = document.querySelector(`.entity[data-id="${entityId}"]`);
        if (div) {
            div.style.left = (x * cellPx) + 'px';
            div.style.top = (y * cellPx) + 'px';
        }
    }

    /* Déplacement pendant un drag : position + câbles + couvertures suivent */
    function moveEntityDiv(entityId, x, y) {
        const div = document.querySelector(`.entity[data-id="${entityId}"]`);
        if (div) {
            div.style.left = (x * cellPx) + 'px';
            div.style.top = (y * cellPx) + 'px';
            div.classList.add('dragging');
        }
        renderCables();
        renderCoverages(Date.now());
    }

    function moveDecorDiv(decorId, x, y) {
        const div = document.querySelector(`.decor[data-id="${decorId}"]`);
        if (div) {
            div.style.left = (x * cellPx) + 'px';
            div.style.top = (y * cellPx) + 'px';
            div.classList.add('dragging');
        }
        renderCoverages(Date.now());
    }

    function moveTokenDiv(tokenId, x, y) {
        const div = document.querySelector(`.runner-token[data-id="${tokenId}"]`);
        if (div) {
            div.style.left = (x * cellPx) + 'px';
            div.style.top = (y * cellPx) + 'px';
            div.classList.add('dragging');
        }
    }

    function moveTransitionEndpointDiv(transitionId, endpointId, x, y) {
        const div = document.querySelector(`.transition-endpoint[data-transition-id="${transitionId}"][data-endpoint-id="${endpointId}"]`);
        if (div) {
            div.style.left = (x * cellPx) + 'px';
            div.style.top = (y * cellPx) + 'px';
            div.classList.add('dragging');
        }
        // La gaine suit son endpoint pendant le drag (coordonnées partagées).
        const cabin = document.querySelector(`.elevator-cabin[data-transition-id="${transitionId}"]`);
        if (cabin) {
            cabin.style.left = (x * cellPx) + 'px';
            cabin.style.top = (y * cellPx) + 'px';
        }
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
        renderCoverageHandles(Date.now());
    }

    function render() {
        layoutBoard();
        const now = Date.now();
        const floor = Store.currentFloor();
        const feed = floor && Store.isPlayerView()
            ? cameraFeedSnapshot(floor.id, now) : null;
        lastCameraFeedSignature = feed ? feed.signature : '';
        renderRooms();
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
    }

    /* Appelé par la boucle d'animation : ne reconstruit les couches que
       lorsqu'un élément entre ou sort réellement d'un flux caméra. */
    function updateCameraFeedVisibility(now) {
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
        gridPosFromEvent, cellFromEvent, moveEntityDiv, moveDecorDiv, moveTokenDiv,
        moveTransitionEndpointDiv, updateSelectionClasses, setEntityScreenPos,
        conePolygon, beamPolygon, rectanglePolygon, thresholdPolygon,
        computeOccluders, invalidateOccluders, isLineBlocked,
        pointInPolygon, cameraFeedSnapshot, isCameraFeedVisible,
        updateCameraFeedVisibility,
        focusElement,
        setZoom, zoomBy, resetZoom,
        getZoom: () => zoom,
        getZoomRange: () => ({ min: ZOOM_MIN, max: ZOOM_MAX }),
        getOccluderCacheStats: () => ({ entries: occluderCache.size, builds: occluderBuilds }),
        getWalls: () => walls
    };
})();

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
    let walls = [];   // segments de murs de l'étage courant (coordonnées grille)
    const occluderCache = new Map();
    let occluderBuilds = 0;
    const ROOM_OCCLUSION_CHANNELS = new Set(['optical', 'infrared', 'laser']);

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

    /* --- Dimensionnement : la grille logique remplit le wrapper en cases carrées --- */
    function layoutBoard() {
        const wrapper = document.getElementById('map-wrapper');
        const grid = Store.getPlan().grid;
        const w = wrapper.clientWidth, h = wrapper.clientHeight;
        cellPx = Math.max(8, Math.floor(Math.min(w / grid.cols, h / grid.rows)));
        const bw = cellPx * grid.cols, bh = cellPx * grid.rows;
        const b = board();
        b.style.width = bw + 'px';
        b.style.height = bh + 'px';
        b.style.left = Math.floor((w - bw) / 2) + 'px';
        b.style.top = Math.floor((h - bh) / 2) + 'px';
        b.style.backgroundSize = cellPx + 'px ' + cellPx + 'px';
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

    function occluderSignature(floorId, channel) {
        const rooms = ROOM_OCCLUSION_CHANNELS.has(channel)
            ? Store.floorRooms(floorId).map(room => [room.id, room.cells]) : [];
        const decors = Store.floorDecors(floorId)
            .filter(decor => decor.blocksVision.includes(channel))
            .map(decor => [decor.id, decor.x, decor.y, decor.width, decor.height, decor.rotation]);
        const entities = Store.floorEntities(floorId)
            .filter(ent => Store.getEffectiveState(ent) !== 'offline'
                && EntityCatalog.get(ent.type).blocksVision.includes(channel))
            .map(ent => [ent.id, ent.x, ent.y, ent.state]);
        return JSON.stringify([rooms, decors, entities]);
    }

    function computeOccluders(floorId, channel) {
        const key = floorId + ':' + channel;
        const signature = occluderSignature(floorId, channel);
        const cached = occluderCache.get(key);
        if (cached && cached.signature === signature) return cached.segments;

        const segments = ROOM_OCCLUSION_CHANNELS.has(channel) ? computeWalls(floorId) : [];
        Store.floorDecors(floorId).forEach(decor => {
            if (!decor.blocksVision.includes(channel)) return;
            const points = orientedRectangle(decor.x, decor.y, decor.rotation,
                decor.width, decor.height, true);
            segments.push(...polygonSegments(points));
        });
        Store.floorEntities(floorId).forEach(ent => {
            if (Store.getEffectiveState(ent) === 'offline'
                || !EntityCatalog.get(ent.type).blocksVision.includes(channel)) return;
            segments.push(...polygonSegments(orientedRectangle(ent.x, ent.y, 0, 1, 1, true)));
        });

        occluderBuilds += 1;
        occluderCache.set(key, { signature, segments });
        return segments;
    }

    function invalidateOccluders() {
        occluderCache.clear();
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
                const label = document.createElement('div');
                label.className = 'room-label' + (hidden ? ' unrevealed' : '');
                label.dataset.roomId = room.id;
                label.textContent = room.name;
                label.style.left = (labelCol * cellPx + 5) + 'px';
                label.style.top = (labelRow * cellPx + 4) + 'px';
                label.style.color = `hsla(${room.hue}, 70%, 72%, 0.9)`;
                layer.appendChild(label);
            }
        });
    }

    /* --- Rendu des décors, séparé entre sol et obstacles --- */
    function renderDecors() {
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

        Store.visibleDecors(floor.id).forEach(decor => {
            const definition = DecorCatalog.get(decor.type);
            const div = document.createElement('div');
            div.className = 'decor'
                + (definition.layer === 'floor' ? ' floor-decor' : '')
                + (decor.blocksVision.length ? ' blocks-vision' : '')
                + (Store.isEffectivelyRevealed(decor, 'decor') ? '' : ' unrevealed');
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
            div.title = decor.name;
            appendCatalogIcon(div, definition.icon, 'decor-icon', definition.label, 'decor-label');
            div.addEventListener('pointerdown', event => {
                event.stopPropagation();
                Editor.onDecorPointerDown(event, decor.id);
            });
            (definition.layer === 'floor' ? floorLayer : obstacleLayer).appendChild(div);
        });
    }

    function renderTransitions() {
        const layer = document.getElementById('transitions-layer');
        if (!layer) return;
        layer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');
        const labels = { stairs: 'ESC', elevator: 'ELV', ladder: 'ECH', hatch: 'TRP', passage: 'PAS' };
        const icons = { stairs: 'stairs', elevator: 'elevator', ladder: 'ladder', hatch: 'hatch', passage: 'opening' };
        Store.visibleTransitions(floor.id).forEach(transition => {
            transition.endpoints.filter(endpoint => endpoint.floorId === floor.id).forEach(endpoint => {
                const div = document.createElement('div');
                div.className = 'transition-endpoint state-' + transition.state
                    + (Store.ui.selection && Store.ui.selection.kind === 'transition'
                        && Store.ui.selection.id === transition.id ? ' selected' : '')
                    + (Store.isEffectivelyRevealed(transition, 'transition') ? '' : ' unrevealed');
                div.dataset.transitionId = transition.id;
                div.dataset.endpointId = endpoint.id;
                div.style.left = (endpoint.x * cellPx) + 'px';
                div.style.top = (endpoint.y * cellPx) + 'px';
                div.dataset.symbol = labels[transition.type] || 'TR';
                div.title = transition.name + (endpoint.label ? ' — ' + endpoint.label : '');
                const transitionIcon = icons[transition.type];
                if (transitionIcon) {
                    div.classList.add('has-icon');
                    const image = appendCatalogIcon(div, transitionIcon, 'transition-icon', '', 'transition-label');
                    if (image) image.addEventListener('error', () => div.classList.remove('has-icon'), { once: true });
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
    function renderEntities() {
        const layer = document.getElementById('entities-layer');
        layer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        const sel = Store.ui.selection;
        const now = Date.now();

        // Les entités ne captent la souris qu'en mode sélection (sinon elles gêneraient la peinture/tracé)
        layer.classList.toggle('pass-through', Store.ui.activeTool !== 'select');

        Store.visibleEntities(floor.id).forEach(ent => {
            const def = EntityCatalog.get(ent.type);
            const pos = Anim.effectivePos(ent, now);
            const div = document.createElement('div');
            div.className = 'entity state-' + Store.getEffectiveState(ent)
                + (Store.isEffectivelyRevealed(ent, 'entity') ? '' : ' unrevealed');
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
        const floor = Store.currentFloor();
        if (!floor) return;

        Store.visibleEntities(floor.id).forEach(ent => {
            if (!ent.coverage) return;
            // Vue joueur : la couverture a son propre flag, indépendant de l'entité
            if (Store.isPlayerView() && !ent.coverage.revealed) return;
            const effState = Store.getEffectiveState(ent);
            if (effState === 'offline') return;
            const def = EntityCatalog.get(ent.type);
            const color = effState === 'hacked' ? HACKED_COLOR : def.color;
            // Vue MJ : couverture encore cachée aux joueurs → tracé atténué
            const hidden = !Store.isPlayerView() && !(ent.revealed && ent.coverage.revealed);

            const pos = Anim.effectivePos(ent, now);
            const coverage = ent.coverage;
            const dir = Anim.sweepDirection(coverage, now);
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
        if (Store.isPlayerView() || Store.ui.activeTool !== 'select') return;
        const selection = Store.ui.selection;
        if (!selection || selection.kind !== 'entity') return;
        const ent = Store.findEntity(selection.id);
        const floor = Store.currentFloor();
        if (!ent || !ent.coverage || !floor || ent.floorId !== floor.id) return;

        const coverage = ent.coverage;
        const at = now === undefined ? Date.now() : now;
        const direction = Anim.sweepDirection(coverage, at);
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
        document.querySelectorAll('.transition-endpoint[data-transition-id]').forEach(element => {
            element.classList.toggle('selected', !!selection
                && selection.kind === 'transition'
                && selection.id === element.dataset.transitionId);
        });
        renderCoverageHandles(Date.now());
    }

    function render() {
        layoutBoard();
        renderRooms();
        renderDecors();
        renderTransitions();
        const floor = Store.currentFloor();
        walls = floor ? computeOccluders(floor.id, 'optical') : [];
        renderEntities(); // appelle renderOverlay()
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
        focusElement,
        getOccluderCacheStats: () => ({ entries: occluderCache.size, builds: occluderBuilds }),
        getWalls: () => walls
    };
})();

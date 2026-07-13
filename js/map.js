/* ============================================================
   map.js — Rendu de la carte : grille logique mise à l'échelle,
   pièces (cases peintes + contours calculés), entités, overlay
   SVG (cônes de vision, chemins de ronde, câbles réseau).
   Catalogue des dispositifs (trivial à enrichir) :
     mobile: true    → peut recevoir un chemin de ronde
     hasVision: true → peut recevoir un cône de vision
   ============================================================ */

const MapView = (() => {

    /* --- Catalogue des dispositifs de sécurité --- */
    const catalog = {
        network_node: { label: 'NET', color: '#ffb300', name: 'Nœud Réseau' },
        camera:       { label: 'CAM', color: '#ff2a2a', name: 'Caméra Optique', hasVision: true },
        turret:       { label: 'TRT', color: '#ff5722', name: 'Tourelle Sécu' },
        barrier:      { label: 'BAR', color: '#bd00ff', name: 'Barrière Mana' },
        maglock:      { label: 'MAG', color: '#00d2ff', name: 'Porte Magsec' },
        guard:        { label: 'GRD', color: '#4af626', name: 'Garde / Patrouille', mobile: true },
        drone:        { label: 'DRN', color: '#ff2a9d', name: 'Drone', mobile: true },
        sensor:       { label: 'SNS', color: '#9dff00', name: 'Capteur' },
        elevator:     { label: 'ELV', color: '#8899ff', name: 'Ascenseur' }
    };

    const HACKED_COLOR = '#4af626';

    let cellPx = 30;  // taille d'une case logique à l'écran, recalculée à chaque rendu
    let walls = [];   // segments de murs de l'étage courant (coordonnées grille)

    const board = () => document.getElementById('board');
    const svgGroup = id => document.getElementById(id);

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
       vision. Runs colinéaires fusionnés, dédoublonnés entre
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

    /* --- Rendu des pièces : cases peintes, bordure sur les arêtes extérieures --- */
    function renderRooms() {
        const layer = document.getElementById('rooms-layer');
        layer.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;
        const sel = Store.ui.selection;

        Store.visibleRooms(floor.id).forEach(room => {
            const isSelected = sel && sel.kind === 'room' && sel.id === room.id;
            const hidden = !room.revealed; // vue MJ uniquement (filtré en vue joueur)
            const cellSet = new Set(room.cells);
            const fill = `hsla(${room.hue}, 90%, 60%, ${isSelected ? 0.22 : hidden ? 0.04 : 0.09})`;
            const edge = `2px ${hidden ? 'dashed' : 'solid'} hsla(${room.hue}, 90%, 60%, ${isSelected ? 1 : hidden ? 0.4 : 0.65})`;

            let labelCol = Infinity, labelRow = Infinity;
            room.cells.forEach(key => {
                const [c, r] = key.split(',').map(Number);
                if (r < labelRow || (r === labelRow && c < labelCol)) { labelRow = r; labelCol = c; }

                const div = document.createElement('div');
                div.className = 'room-cell';
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
                label.textContent = room.name;
                label.style.left = (labelCol * cellPx + 5) + 'px';
                label.style.top = (labelRow * cellPx + 4) + 'px';
                label.style.color = `hsla(${room.hue}, 70%, 72%, 0.9)`;
                layer.appendChild(label);
            }
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
            const def = catalog[ent.type] || { label: '???', color: '#888' };
            const pos = Anim.effectivePos(ent, now);
            const div = document.createElement('div');
            div.className = 'entity state-' + Store.getEffectiveState(ent)
                + (ent.revealed ? '' : ' unrevealed');
            div.dataset.id = ent.id;
            div.style.left = (pos.x * cellPx) + 'px';
            div.style.top = (pos.y * cellPx) + 'px';
            div.style.color = def.color;
            div.style.borderColor = def.color;
            div.innerText = def.label;
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

    /* --- Overlay SVG : cônes (fond), rondes, câbles (dessus) --- */
    function renderOverlay() {
        const svg = document.getElementById('overlay-svg');
        svg.innerHTML = '';
        ['g-cones', 'g-patrols', 'g-cables'].forEach(id => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.id = id;
            svg.appendChild(g);
        });
        const now = Date.now();
        renderCones(now);
        renderPatrols();
        renderCables(now);
    }

    /* Cônes de vision, découpés par les murs. offline = pas de cône, hacked = vert. */
    function renderCones(now) {
        const g = svgGroup('g-cones');
        if (!g) return;
        g.innerHTML = '';
        const floor = Store.currentFloor();
        if (!floor) return;

        Store.visibleEntities(floor.id).forEach(ent => {
            if (!ent.vision) return;
            // Vue joueur : le cône a son propre flag, indépendant de l'entité
            if (Store.isPlayerView() && !ent.vision.revealed) return;
            const effState = Store.getEffectiveState(ent);
            if (effState === 'offline') return;
            const def = catalog[ent.type] || { color: '#888' };
            const color = effState === 'hacked' ? HACKED_COLOR : def.color;
            // Vue MJ : cône encore caché aux joueurs → tracé en pointillés atténués
            const hidden = !Store.isPlayerView() && !(ent.revealed && ent.vision.revealed);

            const pos = Anim.effectivePos(ent, now);
            const dir = Anim.sweepDirection(ent.vision, now);
            const pts = conePolygon(pos.x, pos.y, dir, ent.vision.angle, ent.vision.range, walls);

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts.map(p => (p[0] * cellPx) + ',' + (p[1] * cellPx)).join(' '));
            poly.setAttribute('fill', color);
            poly.setAttribute('fill-opacity', hidden ? '0.05' : effState === 'hacked' ? '0.14' : '0.10');
            poly.setAttribute('stroke', color);
            poly.setAttribute('stroke-opacity', hidden ? '0.25' : '0.45');
            poly.setAttribute('stroke-width', '1');
            if (hidden) poly.setAttribute('stroke-dasharray', '4 4');
            g.appendChild(poly);
        });
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
            const def = catalog[ent.type] || { color: '#888' };
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
                dot.setAttribute('r', i === 0 ? 4 : 2.5);
                dot.setAttribute('fill', def.color);
                dot.setAttribute('fill-opacity', opacity);
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

    /* Déplacement pendant un drag : position + câbles + cônes suivent */
    function moveEntityDiv(entityId, x, y) {
        const div = document.querySelector(`.entity[data-id="${entityId}"]`);
        if (div) {
            div.style.left = (x * cellPx) + 'px';
            div.style.top = (y * cellPx) + 'px';
            div.classList.add('dragging');
        }
        renderCables();
        renderCones(Date.now());
    }

    function render() {
        layoutBoard();
        renderRooms();
        const floor = Store.currentFloor();
        walls = floor ? computeWalls(floor.id) : [];
        renderEntities(); // appelle renderOverlay()
        const wrapper = document.getElementById('map-wrapper');
        const tool = Store.ui.activeTool;
        wrapper.className = 'map-wrapper'
            + (tool === 'paint' ? ' tool-paint' : '')
            + (tool === 'erase' ? ' tool-erase' : '')
            + (tool === 'patrol' ? ' tool-patrol' : '')
            + (catalog[tool] ? ' tool-place' : '');
    }

    return {
        catalog, render, renderEntities, renderOverlay, renderCones, renderPatrols, renderCables,
        gridPosFromEvent, cellFromEvent, moveEntityDiv, setEntityScreenPos,
        conePolygon, getWalls: () => walls
    };
})();

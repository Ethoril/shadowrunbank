/* ============================================================
   store.js — État global, (dé)sérialisation, persistance.
   localStorage = cache local systématique ; si le cloud est
   actif (module cloud.js chargé) et que l'utilisateur est
   admin, chaque sauvegarde part aussi dans Firestore.
   ============================================================ */

const Store = (() => {
    const STORAGE_KEY = 'shadowrunbank_plan_v1';
    const SAVE_DEBOUNCE_MS = 800;

    let plan = null;
    let saveTimer = null;
    let cloudActive = false; // true dès que main.js a branché window.Cloud

    /* --- État UI (non persisté) --- */
    const ui = {
        currentFloorId: null,
        activeTool: 'select',          // select | paint | erase | patrol | <type d'entité>
        selection: null,               // { kind: 'entity'|'room'|'floor', id } | null
        snapToGrid: false,
        patrolEditId: null,            // entité dont on trace la ronde (outil 'patrol')
        readOnly: false,               // true = mode joueur (cloud actif sans login admin)
        preview: false                 // true = MJ en prévisualisation « vue joueur »
    };

    function uid(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* --- Plan par défaut : reprend la banque du POC sur la grille logique 24×16 --- */
    function rect(c0, r0, w, h) {
        const cells = [];
        for (let c = c0; c < c0 + w; c++)
            for (let r = r0; r < r0 + h; r++)
                cells.push(c + ',' + r);
        return cells;
    }

    function defaultPlan() {
        const f0 = uid('f'), f1 = uid('f'), f2 = uid('f');
        return {
            name: 'Banque Zürich-Orbital',
            updatedAt: Date.now(),
            grid: { cols: 24, rows: 16, cellSize: 30 },
            floors: [
                { id: f0, name: 'Niv 0 : Public', order: 0, revealed: true },
                { id: f1, name: 'Niv -1 : Serveurs', order: 1, revealed: false },
                { id: f2, name: 'Niv -2 : Voûte', order: 2, revealed: false }
            ],
            rooms: [
                { id: uid('r'), floorId: f0, name: 'Portes Tournantes', hue: 190, cells: rect(1, 1, 5, 14), revealed: true },
                { id: uid('r'), floorId: f0, name: 'Hall Public', hue: 130, cells: rect(6, 1, 12, 9), revealed: true },
                { id: uid('r'), floorId: f0, name: 'Guichets', hue: 30, cells: rect(18, 1, 5, 9), revealed: true },
                { id: uid('r'), floorId: f0, name: 'Bureaux Clients', hue: 280, cells: rect(6, 10, 17, 5), revealed: true },
                { id: uid('r'), floorId: f1, name: 'Couloir Administratif', hue: 190, cells: rect(1, 1, 22, 4), revealed: false },
                { id: uid('r'), floorId: f1, name: 'Salle des Serveurs', hue: 30, cells: rect(1, 5, 11, 6), revealed: false },
                { id: uid('r'), floorId: f1, name: 'Salle de Repos', hue: 130, cells: rect(12, 5, 11, 6), revealed: false },
                { id: uid('r'), floorId: f1, name: 'Gaine Ventilation', hue: 280, cells: rect(1, 11, 22, 4), revealed: false },
                { id: uid('r'), floorId: f2, name: "Sas d'Accès Blindé", hue: 190, cells: rect(1, 1, 22, 4), revealed: false },
                { id: uid('r'), floorId: f2, name: 'Zone de Tri', hue: 30, cells: rect(1, 5, 8, 10), revealed: false },
                { id: uid('r'), floorId: f2, name: 'Grande Voûte', hue: 280, cells: rect(9, 5, 14, 6), revealed: false },
                { id: uid('r'), floorId: f2, name: 'COFFRE 734', hue: 60, cells: rect(9, 11, 14, 4), revealed: false }
            ],
            entities: []
        };
    }

    /* --- Chargement --- */
    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                plan = JSON.parse(raw);
            }
        } catch (e) {
            console.error('Plan localStorage illisible, réinitialisation.', e);
        }
        if (!plan || !Array.isArray(plan.floors)) {
            plan = defaultPlan();
        }
        const first = sortedFloors()[0];
        ui.currentFloorId = first ? first.id : null;
        return plan;
    }

    /* --- Sauvegarde (debounce) --- */
    function setSaveStatus(status, text) {
        const el = document.getElementById('save-status');
        if (!el) return;
        el.className = status;
        el.textContent = text;
    }

    function touch() {
        plan.updatedAt = Date.now();
        setSaveStatus('saving', '☁ Sauvegarde…');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    }

    function saveNow() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
        } catch (e) {
            console.error('Échec de sauvegarde localStorage', e);
        }
        if (cloudActive && !ui.readOnly && window.Cloud) {
            window.Cloud.savePlan(plan)
                .then(() => setSaveStatus('saved', '☁ Sauvegardé'))
                .catch(e => {
                    console.error('Échec de sauvegarde Firestore', e);
                    setSaveStatus('error', '⚠ Erreur cloud');
                });
        } else {
            setSaveStatus('saved', '💾 Sauvegardé (local)');
        }
    }

    /* --- Cloud (phase 3) --- */
    function setCloudActive(v) { cloudActive = v; }
    function isCloudActive() { return cloudActive; }

    /* Remplace le plan par la version Firestore et répare l'état UI
       (étage courant / sélection / tracé de ronde devenus orphelins). */
    function applyRemotePlan(remote) {
        plan = remote;
        if (!plan.floors.find(f => f.id === ui.currentFloorId)) {
            const first = sortedFloors()[0];
            ui.currentFloorId = first ? first.id : null;
        }
        const sel = ui.selection;
        if (sel) {
            const exists = sel.kind === 'entity' ? findEntity(sel.id)
                : sel.kind === 'room' ? findRoom(sel.id)
                : findFloor(sel.id);
            if (!exists) ui.selection = null;
        }
        if (ui.patrolEditId && !findEntity(ui.patrolEditId)) ui.patrolEditId = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
        } catch (e) { /* cache local seulement */ }
    }

    /* --- Accesseurs --- */
    function getPlan() { return plan; }

    function sortedFloors() {
        return [...plan.floors].sort((a, b) => a.order - b.order);
    }

    function currentFloor() {
        return plan.floors.find(f => f.id === ui.currentFloorId) || null;
    }

    function floorRooms(floorId) {
        return plan.rooms.filter(r => r.floorId === floorId);
    }

    function floorEntities(floorId) {
        return plan.entities.filter(e => e.floorId === floorId);
    }

    function findEntity(id) { return plan.entities.find(e => e.id === id); }
    function findRoom(id) { return plan.rooms.find(r => r.id === id); }
    function findFloor(id) { return plan.floors.find(f => f.id === id); }

    /* Cascade d'état du POC : un appareil lié à un nœud non-actif hérite de son état */
    function getEffectiveState(ent) {
        if (ent.type === 'network_node' || !ent.networkId) return ent.state;
        const parentNode = findEntity(ent.networkId);
        if (parentNode && parentNode.state !== 'active') return parentNode.state;
        return ent.state;
    }

    /* ============================================================
       Visibilité (phase 4) — vue joueur = mode joueur OU
       prévisualisation MJ : seul ce qui est `revealed` existe.
       Les murs (occlusion des cônes) ne sont PAS filtrés : la
       géométrie réelle découpe la vision, révélée ou non.
       ============================================================ */
    function isPlayerView() { return ui.readOnly || ui.preview; }

    function visibleFloors() {
        const floors = sortedFloors();
        return isPlayerView() ? floors.filter(f => f.revealed) : floors;
    }

    function visibleRooms(floorId) {
        const rooms = floorRooms(floorId);
        return isPlayerView() ? rooms.filter(r => r.revealed) : rooms;
    }

    function visibleEntities(floorId) {
        const ents = floorEntities(floorId);
        return isPlayerView() ? ents.filter(e => e.revealed) : ents;
    }

    /* Répare l'état UI quand la vue change : étage courant absent ou
       masqué → premier étage visible ; sélection invisible → purgée. */
    function ensureVisibleView() {
        const floors = visibleFloors();
        if (!floors.find(f => f.id === ui.currentFloorId)) {
            ui.currentFloorId = floors.length ? floors[0].id : null;
        }
        if (!isPlayerView() || !ui.selection) return;
        const sel = ui.selection;
        let visible = false;
        if (sel.kind === 'entity') { const e = findEntity(sel.id); visible = !!(e && e.revealed); }
        else if (sel.kind === 'room') { const r = findRoom(sel.id); visible = !!(r && r.revealed); }
        else if (sel.kind === 'floor') { const f = findFloor(sel.id); visible = !!(f && f.revealed); }
        if (!visible) ui.selection = null;
    }

    /* --- Mutations : étages --- */
    function addFloor(name) {
        const maxOrder = plan.floors.reduce((m, f) => Math.max(m, f.order), -1);
        const floor = { id: uid('f'), name: name || 'Niveau ' + (plan.floors.length + 1), order: maxOrder + 1, revealed: false };
        plan.floors.push(floor);
        touch();
        return floor;
    }

    function deleteFloor(floorId) {
        if (plan.floors.length <= 1) return false;
        plan.rooms = plan.rooms.filter(r => r.floorId !== floorId);
        // Déconnecte les appareils liés à des nœuds de l'étage supprimé
        const removedIds = new Set(plan.entities.filter(e => e.floorId === floorId).map(e => e.id));
        plan.entities = plan.entities.filter(e => e.floorId !== floorId);
        plan.entities.forEach(e => { if (removedIds.has(e.networkId)) e.networkId = ''; });
        plan.floors = plan.floors.filter(f => f.id !== floorId);
        sortedFloors().forEach((f, i) => f.order = i);
        if (ui.currentFloorId === floorId) ui.currentFloorId = sortedFloors()[0].id;
        touch();
        return true;
    }

    function moveFloor(floorId, delta) {
        const floors = sortedFloors();
        const idx = floors.findIndex(f => f.id === floorId);
        const target = idx + delta;
        if (idx < 0 || target < 0 || target >= floors.length) return;
        [floors[idx].order, floors[target].order] = [floors[target].order, floors[idx].order];
        touch();
    }

    /* --- Mutations : pièces --- */
    const ROOM_HUES = [190, 130, 30, 280, 330, 60, 210, 0, 100, 250];

    function addRoom(floorId) {
        const used = floorRooms(floorId).length;
        const room = {
            id: uid('r'),
            floorId: floorId,
            name: 'Pièce ' + (used + 1),
            hue: ROOM_HUES[used % ROOM_HUES.length],
            cells: [],
            revealed: false
        };
        plan.rooms.push(room);
        touch();
        return room;
    }

    /* Peint une case dans une pièce ; la retire de toute autre pièce du même étage */
    function paintCell(room, col, row) {
        const key = col + ',' + row;
        floorRooms(room.floorId).forEach(r => {
            if (r.id !== room.id) {
                const i = r.cells.indexOf(key);
                if (i !== -1) r.cells.splice(i, 1);
            }
        });
        if (!room.cells.includes(key)) {
            room.cells.push(key);
            touch();
            return true;
        }
        return false;
    }

    /* Efface une case ; renvoie la pièce supprimée si elle est devenue vide */
    function eraseCell(floorId, col, row) {
        const key = col + ',' + row;
        for (const r of floorRooms(floorId)) {
            const i = r.cells.indexOf(key);
            if (i !== -1) {
                r.cells.splice(i, 1);
                let deletedRoom = null;
                if (r.cells.length === 0) {
                    plan.rooms = plan.rooms.filter(x => x.id !== r.id);
                    deletedRoom = r;
                }
                touch();
                return { changed: true, deletedRoom };
            }
        }
        return { changed: false, deletedRoom: null };
    }

    function deleteRoom(roomId) {
        plan.rooms = plan.rooms.filter(r => r.id !== roomId);
        touch();
    }

    function roomAt(floorId, col, row) {
        const key = col + ',' + row;
        return floorRooms(floorId).find(r => r.cells.includes(key)) || null;
    }

    /* --- Mutations : entités --- */
    function addEntity(type, floorId, x, y, defaultName) {
        const ent = {
            id: uid('e'),
            floorId: floorId,
            type: type,
            name: defaultName + '_' + Math.floor(Math.random() * 900 + 100),
            state: 'active',
            networkId: '',
            x: x,
            y: y,
            revealed: false,
            note: '',
            patrol: null,
            vision: null
        };
        plan.entities.push(ent);
        touch();
        return ent;
    }

    /* --- Mutations : chemins de ronde --- */
    function createPatrol(ent) {
        ent.patrol = {
            points: [{ x: ent.x, y: ent.y }], // 1er waypoint = position actuelle
            loop: true,
            moving: false,
            speed: 1,
            anchorAt: 0,
            revealed: false
        };
        touch();
        return ent.patrol;
    }

    function clearPatrol(ent) {
        stopPatrol(ent);
        ent.patrol = null;
        touch();
    }

    function startPatrol(ent) {
        if (!ent.patrol || ent.patrol.points.length < 2) return false;
        ent.patrol.moving = true;
        ent.patrol.anchorAt = Date.now();
        touch();
        return true;
    }

    /* Stoppe la ronde en figeant la position animée dans x/y */
    function stopPatrol(ent) {
        if (!ent.patrol || !ent.patrol.moving) return;
        const pos = Anim.patrolPosition(ent.patrol, Date.now());
        if (pos) {
            ent.x = Math.round(pos.x * 100) / 100;
            ent.y = Math.round(pos.y * 100) / 100;
        }
        ent.patrol.moving = false;
        touch();
    }

    /* --- Mutations : cônes de vision --- */
    function createVision(ent) {
        ent.vision = { direction: 0, angle: 60, range: 6, sweep: null, revealed: false };
        touch();
        return ent.vision;
    }

    function clearVision(ent) {
        ent.vision = null;
        touch();
    }

    function setSweep(ent, enabled) {
        if (!ent.vision) return;
        if (enabled) {
            ent.vision.sweep = {
                from: ent.vision.direction - 45,
                to: ent.vision.direction + 45,
                period: 8,
                anchorAt: Date.now()
            };
        } else {
            // fige la direction courante du balayage
            ent.vision.direction = Math.round(Anim.sweepDirection(ent.vision, Date.now()));
            ent.vision.sweep = null;
        }
        touch();
    }

    function deleteEntity(entityId) {
        plan.entities = plan.entities.filter(e => e.id !== entityId);
        plan.entities.forEach(e => { if (e.networkId === entityId) e.networkId = ''; });
        touch();
    }

    return {
        ui, load, touch, saveNow, setSaveStatus,
        setCloudActive, isCloudActive, applyRemotePlan,
        getPlan, sortedFloors, currentFloor, floorRooms, floorEntities,
        findEntity, findRoom, findFloor, getEffectiveState,
        isPlayerView, visibleFloors, visibleRooms, visibleEntities, ensureVisibleView,
        addFloor, deleteFloor, moveFloor,
        addRoom, paintCell, eraseCell, deleteRoom, roomAt,
        addEntity, deleteEntity,
        createPatrol, clearPatrol, startPatrol, stopPatrol,
        createVision, clearVision, setSweep
    };
})();

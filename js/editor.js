/* ============================================================
   editor.js — Mode admin : palette d'outils, gestion des étages
   (onglets CRUD), peinture/gomme de pièces, placement et drag
   des entités.
   ============================================================ */

const Editor = (() => {

    let paintSession = null; // { mode: 'paint'|'erase', room }
    let dragSession = null;  // { entityId, moved }

    /* --- Outils --- */
    function setTool(tool) {
        if (Store.isPlayerView()) tool = 'select'; // vue joueur : consultation uniquement
        Store.ui.activeTool = tool;
        if (tool !== 'patrol') Store.ui.patrolEditId = null;
        if (tool !== 'select' && tool !== 'patrol') {
            // La sélection d'entité n'a pas de sens pendant le placement/peinture,
            // mais on garde la sélection de pièce (la peinture cible la pièce courante)
            // et l'entité dont on trace la ronde.
            const sel = Store.ui.selection;
            if (sel && sel.kind === 'entity') Store.ui.selection = null;
        }
        renderTools();
        MapView.render();
        Inspector.render();
    }

    /* --- Tracé de ronde (activé depuis l'inspecteur) --- */
    function startPatrolEdit(entityId) {
        Store.ui.patrolEditId = entityId;
        Store.ui.selection = { kind: 'entity', id: entityId };
        setTool('patrol');
        setTicker('TRACÉ DE RONDE // CLIQUE SUR LA CARTE POUR AJOUTER DES WAYPOINTS — ÉCHAP POUR FINIR');
    }

    function endPatrolEdit() {
        setTool('select');
        setTicker('TRACÉ DE RONDE TERMINÉ');
    }

    function renderTools() {
        const structure = document.getElementById('tools-structure');
        structure.innerHTML = '';
        structure.appendChild(toolButton('select', '⊹ Mode Sélection', '#00d2ff'));
        structure.appendChild(toolButton('paint', '✏ Dessiner Pièce', '#4af626'));
        structure.appendChild(toolButton('erase', '⌫ Gomme', '#ff2a2a'));

        const newRoomBtn = document.createElement('button');
        newRoomBtn.className = 'tool-btn';
        newRoomBtn.innerHTML = '<span class="icon-preview" style="background:#527874"></span> [+] Nouvelle Pièce';
        newRoomBtn.addEventListener('click', () => {
            const floor = Store.currentFloor();
            if (!floor) return;
            const room = Store.addRoom(floor.id);
            Store.ui.selection = { kind: 'room', id: room.id };
            setTool('paint');
            setTicker('NOUVELLE PIÈCE // PEINS SES CASES SUR LA GRILLE');
        });
        structure.appendChild(newRoomBtn);

        const snap = document.createElement('label');
        snap.className = 'tool-option';
        snap.innerHTML = `<input type="checkbox" ${Store.ui.snapToGrid ? 'checked' : ''}> Snap grille (0.5)`;
        snap.querySelector('input').addEventListener('change', e => {
            Store.ui.snapToGrid = e.target.checked;
        });
        structure.appendChild(snap);

        const devices = document.getElementById('tools-entities');
        devices.innerHTML = '';
        Object.entries(MapView.catalog).forEach(([type, def]) => {
            devices.appendChild(toolButton(type, '[+] ' + def.name, def.color));
        });
    }

    function toolButton(tool, text, color) {
        const btn = document.createElement('button');
        btn.className = 'tool-btn' + (Store.ui.activeTool === tool ? ' active' : '');
        btn.innerHTML = `<span class="icon-preview" style="background:${color}"></span> ${text}`;
        btn.addEventListener('click', () => setTool(tool));
        return btn;
    }

    /* --- Onglets d'étages --- */
    function renderTabs() {
        const tabs = document.getElementById('floor-tabs');
        tabs.innerHTML = '';
        Store.visibleFloors().forEach(floor => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn' + (floor.id === Store.ui.currentFloorId ? ' active' : '')
                + (!floor.revealed ? ' tab-hidden' : '');
            btn.textContent = floor.name;
            btn.title = 'Clic : afficher — Re-clic : propriétés de l\'étage';
            btn.addEventListener('click', () => {
                if (Store.ui.currentFloorId === floor.id) {
                    // Re-clic sur l'onglet actif → propriétés de l'étage dans l'inspecteur
                    Store.ui.selection = { kind: 'floor', id: floor.id };
                    Inspector.render();
                } else {
                    switchFloor(floor.id);
                }
            });
            tabs.appendChild(btn);
        });

        if (Store.isPlayerView()) return; // vue joueur : pas de création d'étage

        const add = document.createElement('button');
        add.className = 'tab-btn tab-add';
        add.textContent = '+ Étage';
        add.addEventListener('click', () => {
            const floor = Store.addFloor();
            Store.ui.currentFloorId = floor.id;
            Store.ui.selection = { kind: 'floor', id: floor.id };
            App.renderAll();
        });
        tabs.appendChild(add);
    }

    function switchFloor(floorId) {
        Store.ui.currentFloorId = floorId;
        Store.ui.selection = null;
        if (Store.ui.activeTool === 'patrol') {
            Store.ui.activeTool = 'select';
            Store.ui.patrolEditId = null;
        }
        App.renderAll();
    }

    /* --- Interactions carte (pointer events sur le plateau) --- */
    function wireBoard() {
        const boardEl = document.getElementById('board');
        boardEl.addEventListener('pointerdown', onBoardPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    }

    function snapCoord(v) {
        if (Store.ui.snapToGrid) return Math.round(v * 2) / 2;
        return Math.round(v * 10) / 10;
    }

    function onBoardPointerDown(e) {
        const tool = Store.ui.activeTool;
        const floor = Store.currentFloor();
        if (!floor) return;
        if (Store.isPlayerView() && tool !== 'select') return;

        if (tool === 'select') {
            // Sélection de pièce par hit-test sur la case cliquée
            const cell = MapView.cellFromEvent(e);
            let room = cell ? Store.roomAt(floor.id, cell.col, cell.row) : null;
            if (room && Store.isPlayerView() && !room.revealed) room = null; // invisible aux joueurs
            Store.ui.selection = room ? { kind: 'room', id: room.id } : null;
            MapView.render();
            Inspector.render();
            return;
        }

        if (tool === 'paint') {
            const sel = Store.ui.selection;
            let room = (sel && sel.kind === 'room') ? Store.findRoom(sel.id) : null;
            if (!room || room.floorId !== floor.id) {
                room = Store.addRoom(floor.id);
                Store.ui.selection = { kind: 'room', id: room.id };
                Inspector.render();
            }
            paintSession = { mode: 'paint', room };
            paintAt(e);
            return;
        }

        if (tool === 'erase') {
            paintSession = { mode: 'erase', room: null };
            paintAt(e);
            return;
        }

        if (tool === 'patrol') {
            const ent = Store.findEntity(Store.ui.patrolEditId);
            if (!ent || !ent.patrol || ent.floorId !== floor.id) {
                endPatrolEdit();
                return;
            }
            const pos = MapView.gridPosFromEvent(e);
            const grid = Store.getPlan().grid;
            ent.patrol.points.push({
                x: snapCoord(Math.min(Math.max(pos.x, 0), grid.cols)),
                y: snapCoord(Math.min(Math.max(pos.y, 0), grid.rows))
            });
            Store.touch();
            MapView.renderOverlay();
            Inspector.render(); // met à jour le compteur de waypoints
            return;
        }

        if (MapView.catalog[tool]) {
            // Placement d'un dispositif
            const pos = MapView.gridPosFromEvent(e);
            const grid = Store.getPlan().grid;
            const x = snapCoord(Math.min(Math.max(pos.x, 0), grid.cols));
            const y = snapCoord(Math.min(Math.max(pos.y, 0), grid.rows));
            const ent = Store.addEntity(tool, floor.id, x, y, MapView.catalog[tool].label);
            Store.ui.selection = { kind: 'entity', id: ent.id };
            setTool('select'); // repasse en sélection après placement, comme le POC
            setTicker('DISPOSITIF DÉPLOYÉ // ' + ent.name);
        }
    }

    function paintAt(e) {
        if (!paintSession) return;
        const floor = Store.currentFloor();
        const cell = MapView.cellFromEvent(e);
        if (!cell || !floor) return;

        if (paintSession.mode === 'paint') {
            if (Store.paintCell(paintSession.room, cell.col, cell.row)) {
                MapView.render();
            }
        } else {
            const res = Store.eraseCell(floor.id, cell.col, cell.row);
            if (res.changed) {
                if (res.deletedRoom) {
                    const sel = Store.ui.selection;
                    if (sel && sel.kind === 'room' && sel.id === res.deletedRoom.id) {
                        Store.ui.selection = null;
                        Inspector.render();
                    }
                    setTicker('PIÈCE EFFACÉE // ' + res.deletedRoom.name.toUpperCase());
                }
                MapView.render();
            }
        }
    }

    function onPointerMove(e) {
        if (paintSession) {
            paintAt(e);
            return;
        }
        if (dragSession) {
            const ent = Store.findEntity(dragSession.entityId);
            if (!ent) { dragSession = null; return; }
            const pos = MapView.gridPosFromEvent(e);
            const grid = Store.getPlan().grid;
            ent.x = snapCoord(Math.min(Math.max(pos.x, 0), grid.cols));
            ent.y = snapCoord(Math.min(Math.max(pos.y, 0), grid.rows));
            dragSession.moved = true;
            MapView.moveEntityDiv(ent.id, ent.x, ent.y);
        }
    }

    function onPointerUp() {
        if (paintSession) {
            paintSession = null;
        }
        if (dragSession) {
            if (dragSession.moved) {
                Store.touch();
                MapView.renderEntities();
            }
            dragSession = null;
        }
    }

    /* Appelé par map.js au pointerdown sur une icône d'entité (mode sélection uniquement) */
    function onEntityPointerDown(e, entityId) {
        if (Store.ui.activeTool !== 'select') return;
        Store.ui.selection = { kind: 'entity', id: entityId };
        const ent = Store.findEntity(entityId);
        // Pas de drag en vue joueur, ni pendant une ronde (l'animation pilote la position)
        if (!Store.isPlayerView() && !(ent && ent.patrol && ent.patrol.moving)) {
            dragSession = { entityId, moved: false };
        }
        MapView.renderEntities();
        Inspector.render();
    }

    /* --- Clavier : Suppr = supprimer la sélection, Échap = finir le tracé --- */
    function wireKeyboard() {
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && Store.ui.activeTool === 'patrol') {
                endPatrolEdit();
                return;
            }
            if (e.key !== 'Delete' || Store.isPlayerView()) return;
            const target = e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            const sel = Store.ui.selection;
            if (!sel) return;
            if (sel.kind === 'entity') Inspector.deleteSelectedEntity();
            else if (sel.kind === 'room') Inspector.deleteSelectedRoom();
        });
    }

    function setTicker(text) {
        const el = document.getElementById('status-ticker');
        if (el) el.textContent = text;
    }

    return { setTool, renderTools, renderTabs, switchFloor, wireBoard, wireKeyboard,
             onEntityPointerDown, setTicker, startPatrolEdit, endPatrolEdit };
})();

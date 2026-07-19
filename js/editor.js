/* ============================================================
   editor.js — Mode admin : palette d'outils, gestion des étages
   (onglets CRUD), peinture/gomme de pièces, placement et drag
   des entités.
   ============================================================ */

const Editor = (() => {

    let paintSession = null; // { mode: 'paint'|'erase', room }
    let dragSession = null;  // déplacement d'élément, waypoint ou poignée de couverture
    let clipboard = null;    // { kind: 'entity'|'decor', data } — non persisté

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
            if (sel && ['entity', 'decor', 'token', 'transition'].includes(sel.kind)) Store.ui.selection = null;
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
        structure.appendChild(toolButton('token', '◉ Nouveau pion PJ', '#00d2ff', 'runner'));

        // 7.11 : la nature de la liaison se choisit dès la création. Un
        // ascenseur pose sa gaine avec un arrêt (et une porte) sur chaque
        // étage ; les autres types gardent le flux point par point.
        const transitionsGroup = document.createElement('details');
        transitionsGroup.className = 'tool-category';
        transitionsGroup.open = true;
        const transitionsTitle = document.createElement('summary');
        transitionsTitle.textContent = 'Transitions';
        transitionsGroup.appendChild(transitionsTitle);
        const transitionsList = document.createElement('div');
        transitionsList.className = 'tool-category-list';
        [
            ['stairs', '◆ Escalier', 'stairs'],
            ['elevator', '◆ Ascenseur', 'elevator'],
            ['ladder', '◆ Échelle', 'ladder'],
            ['hatch', '◆ Trappe', 'hatch'],
            ['passage', '◆ Passage', 'opening']
        ].forEach(([type, label, icon]) => {
            transitionsList.appendChild(toolButton('transition:new:' + type, label, '#ffe66d', icon));
        });
        transitionsGroup.appendChild(transitionsList);
        structure.appendChild(transitionsGroup);

        const clipboardActions = document.createElement('div');
        clipboardActions.className = 'clipboard-actions';
        const copyButton = document.createElement('button');
        copyButton.className = 'btn-secondary';
        copyButton.textContent = '⧉ Copier';
        copyButton.title = 'Copier le dispositif ou décor sélectionné (⌘/Ctrl+C)';
        copyButton.addEventListener('click', copySelection);
        const pasteButton = document.createElement('button');
        pasteButton.className = 'btn-secondary';
        pasteButton.textContent = '▣ Coller';
        pasteButton.title = 'Coller sur l’étage courant (⌘/Ctrl+V)';
        pasteButton.addEventListener('click', pasteClipboard);
        clipboardActions.append(copyButton, pasteButton);
        structure.appendChild(clipboardActions);

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

        const resetButton = document.createElement('button');
        resetButton.className = 'btn-action';
        resetButton.textContent = '🗑 Tout supprimer (plan vierge)';
        resetButton.title = 'Repart d’une feuille blanche : étages, pièces, dispositifs, décors, '
            + 'transitions, pions et découvertes sont supprimés après confirmation';
        resetButton.addEventListener('click', resetPlanFromScratch);
        structure.appendChild(resetButton);

        const devices = document.getElementById('tools-entities');
        devices.innerHTML = '';
        EntityCatalog.categories.forEach(category => {
            const entries = EntityCatalog.entries(category.id);
            if (!entries.length) return;
            const group = document.createElement('details');
            group.className = 'tool-category';
            group.open = true;
            const title = document.createElement('summary');
            title.textContent = category.label;
            group.appendChild(title);
            const list = document.createElement('div');
            list.className = 'tool-category-list';
            entries.forEach(([type, def]) => {
                list.appendChild(toolButton(type, '[+] ' + def.name, def.color, def.icon));
            });
            group.appendChild(list);
            devices.appendChild(group);
        });

        const decors = document.getElementById('tools-decors');
        if (decors) {
            decors.innerHTML = '';
            DecorCatalog.categories.forEach(category => {
                const group = document.createElement('details');
                group.className = 'tool-category';
                group.open = category.id !== 'floor';
                const title = document.createElement('summary');
                title.textContent = category.label;
                group.appendChild(title);
                const list = document.createElement('div');
                list.className = 'tool-category-list';
                DecorCatalog.entries(category.id)
                    .filter(([, definition]) => !definition.legacy)
                    .forEach(([type, definition]) => {
                        list.appendChild(toolButton('decor:' + type, '[+] ' + definition.name, definition.color, definition.icon));
                    });
                group.appendChild(list);
                decors.appendChild(group);
            });

            const purgeButton = document.createElement('button');
            purgeButton.className = 'btn-secondary';
            purgeButton.textContent = '🧹 Purger les décors escalier / cabine';
            purgeButton.title = 'Supprime les anciens décors « Escalier » et « Cabine d’ascenseur », '
                + 'remplacés par le rendu généré depuis les transitions (7.10)';
            purgeButton.addEventListener('click', purgeLegacyTransitionDecors);
            decors.appendChild(purgeButton);
        }
    }

    /* Remise à zéro MJ : récapitule ce qui sera perdu, crée une version de
       restauration locale, puis repart d'un plan vierge (pions et
       découvertes compris). L'action reste annulable via l'historique
       pour le plan lui-même. */
    function resetPlanFromScratch() {
        if (Store.isPlayerView()) return;
        const plan = Store.getPlan();
        const counts = [
            [plan.floors.length, 'étage(s)'],
            [plan.rooms.length, 'pièce(s)'],
            [plan.entities.length, 'dispositif(s)'],
            [plan.decors.length, 'décor(s)'],
            [plan.transitions.length, 'transition(s)'],
            [Store.getTokens().length, 'pion(s) PJ'],
            [Store.getDiscoveries().length, 'découverte(s)']
        ].filter(([count]) => count > 0)
            .map(([count, label]) => '— ' + count + ' ' + label).join('\n');
        if (!confirm('Repartir d\'une feuille blanche ?\n\nSeront supprimés :\n'
            + (counts || '— (plan déjà vide)')
            + '\n\nUne version de restauration locale sera créée avant la suppression.')) return;
        Store.backupCurrentPlan('avant-remise-a-zero');
        Store.resetPlan();
        setTool('select');
        App.renderAll();
        setTicker('PLAN RÉINITIALISÉ // FEUILLE BLANCHE');
    }

    /* 7.10 : suppression des décors historiques rendus obsolètes par la
       cabine générée. Jamais silencieuse : un récapitulatif groupé liste
       chaque décor, étage par étage, avant toute suppression effective. */
    function purgeLegacyTransitionDecors() {
        if (Store.isPlayerView()) return;
        const items = Store.listLegacyTransitionDecors();
        if (!items.length) {
            setTicker('AUCUN DÉCOR ESCALIER / CABINE À SUPPRIMER');
            return;
        }
        const lines = items.map(item => '— Le décor « ' + item.decor.name + ' » de l\'étage « '
            + (item.floor ? item.floor.name : 'Étage inconnu') + ' » sera supprimé.').join('\n');
        if (!confirm('Ces décors sont remplacés par le rendu généré depuis les transitions :\n\n'
            + lines + '\n\nConfirmer la suppression ?')) return;
        Store.backupCurrentPlan('purge-decors-liaisons');
        const removed = Store.purgeLegacyTransitionDecors();
        const sel = Store.ui.selection;
        if (sel && sel.kind === 'decor' && !Store.findDecor(sel.id)) Store.ui.selection = null;
        App.renderAll();
        setTicker('PURGE // ' + removed + ' DÉCOR(S) SUPPRIMÉ(S)');
    }

    function toolButton(tool, text, color, icon) {
        const btn = document.createElement('button');
        btn.className = 'tool-btn' + (Store.ui.activeTool === tool ? ' active' : '');
        const preview = document.createElement('span');
        preview.className = 'icon-preview' + (icon ? ' has-image' : ' color-dot');
        preview.style.color = color;
        if (icon) {
            const image = document.createElement('img');
            image.src = 'assets/icons/map/' + icon + '.png';
            image.alt = '';
            image.draggable = false;
            image.addEventListener('error', () => {
                preview.classList.remove('has-image');
                preview.classList.add('color-dot');
                image.remove();
            }, { once: true });
            preview.appendChild(image);
        }
        const label = document.createElement('span');
        label.textContent = text;
        btn.append(preview, label);
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
                + (!Store.isEffectivelyRevealed(floor, 'floor') ? ' tab-hidden' : '');
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

    function startTransitionEndpoint(transitionId) {
        const transition = Store.findTransition(transitionId);
        if (!transition || Store.isPlayerView()) return;
        Store.ui.selection = { kind: 'transition', id: transition.id };
        setTool('transition:' + transition.id);
        setTicker('TRANSITION // CHOISIS UN POINT SUR UN ÉTAGE');
    }

    /* --- Interactions carte (pointer events sur le plateau) --- */
    function wireBoard() {
        const boardEl = document.getElementById('board');
        boardEl.addEventListener('pointerdown', onBoardPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }

    function snapCoord(v) {
        if (Store.ui.snapToGrid) return Math.round(v * 2) / 2;
        return Math.round(v * 10) / 10;
    }

    function clampEntityPos(pos, grid) {
        return {
            x: snapCoord(Math.min(Math.max(pos.x, 0.5), Math.max(0.5, grid.cols - 0.5))),
            y: snapCoord(Math.min(Math.max(pos.y, 0.5), Math.max(0.5, grid.rows - 0.5)))
        };
    }

    function clampDecorPos(pos, decor, grid) {
        const quarterTurn = Math.abs(Math.round(decor.rotation / 90)) % 2 === 1;
        const halfWidth = (quarterTurn ? decor.height : decor.width) / 2;
        const halfHeight = (quarterTurn ? decor.width : decor.height) / 2;
        return {
            x: snapCoord(Math.min(Math.max(pos.x, halfWidth), Math.max(halfWidth, grid.cols - halfWidth))),
            y: snapCoord(Math.min(Math.max(pos.y, halfHeight), Math.max(halfHeight, grid.rows - halfHeight)))
        };
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function snapCoverageValue(value, step, min, max) {
        return clamp(Math.round(value / step) * step, min, max);
    }

    function normalizeAngle(angle) {
        let normalized = angle % 360;
        if (normalized > 180) normalized -= 360;
        if (normalized <= -180) normalized += 360;
        return normalized;
    }

    function updateCoverageFromPointer(session, pos) {
        const ent = Store.findEntity(session.id);
        const coverage = ent && ent.coverage;
        if (!coverage) return false;
        let stoppedPatrol = false;
        if (session.hadMovingPatrol) {
            Store.stopPatrol(ent);
            session.hadMovingPatrol = false;
            stoppedPatrol = true;
        }
        const before = JSON.stringify(coverage);
        const dx = pos.x - ent.x;
        const dy = pos.y - ent.y;
        const distance = Math.hypot(dx, dy);

        if (session.hadSweep) {
            coverage.direction = session.frozenDirection;
            coverage.sweep = null;
        }

        if (session.handle === 'axis') {
            coverage.direction = snapCoverageValue(
                normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI), 5, -180, 180);
            const range = coverage.shape === 'threshold' ? distance * 2 : distance;
            coverage.range = snapCoverageValue(range, 0.5, 0.5, 30);
        } else if (session.handle === 'width') {
            const radians = coverage.direction * Math.PI / 180;
            const perpendicular = -Math.sin(radians) * dx + Math.cos(radians) * dy;
            coverage.width = snapCoverageValue(Math.abs(perpendicular) * 2, 0.25, 0.25, 20);
        } else if (session.handle === 'radius') {
            coverage.radius = snapCoverageValue(distance, 0.5, 0.5, 30);
        } else if (session.handle === 'angle') {
            const pointerDirection = Math.atan2(dy, dx) * 180 / Math.PI;
            const delta = Math.abs(normalizeAngle(pointerDirection - coverage.direction));
            coverage.angle = snapCoverageValue(delta * 2, 5, 10, 180);
        }

        return stoppedPatrol || JSON.stringify(coverage) !== before;
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
            if (room && Store.isPlayerView() && !Store.isEffectivelyRevealed(room, 'room')) room = null;
            Store.ui.selection = room ? { kind: 'room', id: room.id } : null;
            MapView.render();
            Inspector.render();
            return;
        }

        if (tool === 'paint') {
            Store.beginTransaction('Peindre une pièce');
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
            Store.beginTransaction('Effacer des cases');
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

        if (tool === 'token') {
            const pos = clampEntityPos(MapView.gridPosFromEvent(e), Store.getPlan().grid);
            const token = Store.addToken(floor.id, pos.x, pos.y);
            Store.ui.selection = { kind: 'token', id: token.id };
            setTool('select');
            setTicker('PION PJ CRÉÉ // ' + token.name.toUpperCase());
            return;
        }

        if (tool.startsWith('transition:')) {
            const requestedId = tool.slice('transition:'.length);
            const isNew = requestedId.startsWith('new');
            let transition = isNew ? null : Store.findTransition(requestedId);
            const createdType = isNew ? (requestedId.split(':')[1] || 'stairs') : null;
            if (!transition) transition = Store.addTransition(createdType || 'stairs');
            const pos = clampEntityPos(MapView.gridPosFromEvent(e), Store.getPlan().grid);
            Store.ui.selection = { kind: 'transition', id: transition.id };
            setTool('select');
            // Un nouvel ascenseur dessert d'emblée tous les étages, porte
            // ouverte partout : le MJ retire ensuite les portes non voulues.
            if (createdType === 'elevator') {
                Store.populateElevatorStops(transition, pos.x, pos.y);
                setTicker('ASCENSEUR CRÉÉ // PORTE SUR CHAQUE ÉTAGE — À AJUSTER DANS L\'INSPECTEUR');
                return;
            }
            const endpoint = Store.addTransitionEndpoint(transition, floor.id, pos.x, pos.y);
            if (!endpoint) {
                const range = Store.elevatorFloorRange(transition);
                const outOfRange = transition.type === 'elevator' && range
                    && (floor.order < range.min || floor.order > range.max);
                setTicker(transition.type === 'stairs'
                    ? 'REFUSÉ // UN ESCALIER RELIE EXACTEMENT DEUX ENDPOINTS'
                    : outOfRange
                        ? 'REFUSÉ // ÉTAGE HORS DESSERTE DE L\'ASCENSEUR'
                        : 'REFUSÉ // UN SEUL ARRÊT PAR ÉTAGE POUR UN ASCENSEUR');
            } else {
                setTicker('POINT DE TRANSITION AJOUTÉ // ' + transition.name.toUpperCase());
            }
            return;
        }

        if (tool.startsWith('decor:')) {
            const type = tool.slice('decor:'.length);
            const pos = MapView.gridPosFromEvent(e);
            const grid = Store.getPlan().grid;
            const definition = DecorCatalog.get(type);
            const preview = { width: definition.width, height: definition.height, rotation: 0 };
            const bounded = clampDecorPos(pos, preview, grid);
            const decor = Store.addDecor(type, floor.id, bounded.x, bounded.y);
            Store.ui.selection = { kind: 'decor', id: decor.id };
            setTool('select');
            setTicker('DÉCOR PLACÉ // ' + decor.name.toUpperCase());
            return;
        }

        if (EntityCatalog.types[tool]) {
            // Placement d'un dispositif
            const pos = MapView.gridPosFromEvent(e);
            const grid = Store.getPlan().grid;
            const bounded = clampEntityPos(pos, grid);
            const ent = Store.addEntity(tool, floor.id, bounded.x, bounded.y, EntityCatalog.get(tool).label);
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
            const pos = MapView.gridPosFromEvent(e);
            const grid = Store.getPlan().grid;
            if (dragSession.kind === 'decor') {
                const decor = Store.findDecor(dragSession.id);
                if (!decor) { dragSession = null; return; }
                const bounded = clampDecorPos(pos, decor, grid);
                decor.x = bounded.x;
                decor.y = bounded.y;
                dragSession.moved = true;
                MapView.moveDecorDiv(decor.id, decor.x, decor.y);
            } else if (dragSession.kind === 'entity') {
                const ent = Store.findEntity(dragSession.id);
                if (!ent) { dragSession = null; return; }
                const bounded = clampEntityPos(pos, grid);
                ent.x = bounded.x;
                ent.y = bounded.y;
                dragSession.moved = true;
                MapView.moveEntityDiv(ent.id, ent.x, ent.y);
            } else if (dragSession.kind === 'token') {
                const token = Store.findToken(dragSession.id);
                if (!token) { dragSession = null; return; }
                const bounded = clampEntityPos(pos, grid);
                token.x = bounded.x;
                token.y = bounded.y;
                dragSession.moved = true;
                MapView.moveTokenDiv(token.id, token.x, token.y);
                if (typeof Exploration !== 'undefined') Exploration.observeTokenMove(token);
            } else if (dragSession.kind === 'transition') {
                const transition = Store.findTransition(dragSession.id);
                const endpoint = transition && transition.endpoints.find(item => item.id === dragSession.endpointId);
                if (!endpoint) { dragSession = null; return; }
                const bounded = clampEntityPos(pos, grid);
                endpoint.x = bounded.x;
                endpoint.y = bounded.y;
                // 7.8 : la gaine d'un ascenseur est solidaire — déplacer un
                // endpoint déplace toute la liaison, sur tous les étages.
                if (transition.type === 'elevator') {
                    transition.endpoints.forEach(item => {
                        item.x = bounded.x;
                        item.y = bounded.y;
                    });
                }
                dragSession.moved = true;
                MapView.moveTransitionEndpointDiv(transition.id, endpoint.id, endpoint.x, endpoint.y);
            } else if (dragSession.kind === 'waypoint') {
                const ent = Store.findEntity(dragSession.id);
                const point = ent && ent.patrol && ent.patrol.points[dragSession.index];
                if (!point) { Store.cancelTransaction(); dragSession = null; return; }
                point.x = snapCoord(Math.min(Math.max(pos.x, 0), grid.cols));
                point.y = snapCoord(Math.min(Math.max(pos.y, 0), grid.rows));
                dragSession.moved = true;
                MapView.renderPatrols();
            } else if (dragSession.kind === 'coverage') {
                const changed = updateCoverageFromPointer(dragSession, pos);
                dragSession.moved = dragSession.moved || changed;
                if (changed) MapView.renderCoverages(Date.now());
            }
        }
    }

    function onPointerUp() {
        if (paintSession) {
            paintSession = null;
            Store.endTransaction();
        }
        if (dragSession) {
            const completed = dragSession;
            if (completed.moved && completed.kind === 'token') {
                const token = Store.findToken(completed.id);
                if (token) {
                    Store.commitTokenPosition(token);
                    const changedFloor = typeof Exploration !== 'undefined'
                        && Exploration.handleTokenRelease(token);
                    if (!changedFloor) MapView.render();
                }
            } else if (completed.moved) {
                const label = completed.kind === 'waypoint' ? 'Déplacer un waypoint'
                    : completed.kind === 'coverage' ? 'Ajuster une zone de couverture'
                    : 'Déplacer un élément';
                Store.touch(label);
                Store.endTransaction();
                MapView.render();
                if (completed.kind === 'coverage') Inspector.render();
            } else if (completed.kind !== 'token') {
                Store.endTransaction();
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
            Store.beginTransaction('Déplacer un dispositif');
            dragSession = { kind: 'entity', id: entityId, moved: false };
            capturePointer(e);
        }
        MapView.updateSelectionClasses();
        Inspector.render();
    }

    function onDecorPointerDown(e, decorId) {
        if (Store.ui.activeTool !== 'select') return;
        Store.ui.selection = { kind: 'decor', id: decorId };
        if (!Store.isPlayerView()) {
            Store.beginTransaction('Déplacer un décor');
            dragSession = { kind: 'decor', id: decorId, moved: false };
            capturePointer(e);
        }
        MapView.updateSelectionClasses();
        Inspector.render();
    }

    function onTokenPointerDown(e, tokenId) {
        if (Store.ui.activeTool !== 'select') return;
        const token = Store.findToken(tokenId);
        if (!token) return;
        Store.ui.selection = { kind: 'token', id: tokenId };
        const playerCanMove = Store.ui.readOnly && !Store.ui.preview && token.playerMovable && !token.locked;
        if (!Store.isPlayerView() || playerCanMove) {
            dragSession = { kind: 'token', id: tokenId, moved: false };
            capturePointer(e);
        }
        MapView.updateSelectionClasses();
        Inspector.render();
    }

    function onTransitionPointerDown(e, transitionId, endpointId) {
        if (Store.ui.activeTool !== 'select') return;
        Store.ui.selection = { kind: 'transition', id: transitionId };
        // Cabine fantôme sans endpoint sur cet étage : sélection seule.
        if (endpointId && !Store.isPlayerView()) {
            Store.beginTransaction('Déplacer une transition');
            dragSession = { kind: 'transition', id: transitionId, endpointId, moved: false };
            capturePointer(e);
        }
        MapView.updateSelectionClasses();
        Inspector.render();
    }

    function capturePointer(event) {
        if (!event.currentTarget || !event.currentTarget.setPointerCapture) return;
        try { event.currentTarget.setPointerCapture(event.pointerId); }
        catch (_) { /* capture facultative selon le navigateur */ }
    }

    function onWaypointPointerDown(e, entityId, index) {
        if (Store.isPlayerView() || Store.ui.activeTool !== 'select') return;
        const ent = Store.findEntity(entityId);
        if (!ent || !ent.patrol || !ent.patrol.points[index]) return;
        e.preventDefault();
        e.stopPropagation();
        if (ent.patrol.moving) Store.stopPatrol(ent);
        Store.ui.selection = { kind: 'entity', id: entityId };
        Store.beginTransaction('Déplacer un waypoint');
        dragSession = { kind: 'waypoint', id: entityId, index, moved: false };
        capturePointer(e);
        Inspector.render();
    }

    function onCoverageHandlePointerDown(e, entityId, handle) {
        if (Store.isPlayerView() || Store.ui.activeTool !== 'select') return;
        const ent = Store.findEntity(entityId);
        if (!ent || !ent.coverage || !['axis', 'width', 'radius', 'angle'].includes(handle)) return;
        e.preventDefault();
        e.stopPropagation();
        Store.ui.selection = { kind: 'entity', id: entityId };
        Store.beginTransaction('Ajuster une zone de couverture');
        dragSession = {
            kind: 'coverage',
            id: entityId,
            handle,
            moved: false,
            hadMovingPatrol: !!(ent.patrol && ent.patrol.moving),
            hadSweep: !!ent.coverage.sweep,
            frozenDirection: Anim.coverageDirection(ent, Date.now())
        };
        capturePointer(e);
    }

    function duplicateSelection() {
        if (Store.isPlayerView()) return false;
        const sel = Store.ui.selection;
        if (!sel) return false;
        let copy = null;
        if (sel.kind === 'entity') copy = Store.duplicateEntity(Store.findEntity(sel.id));
        else if (sel.kind === 'decor') copy = Store.duplicateDecor(Store.findDecor(sel.id));
        else if (sel.kind === 'token') copy = Store.duplicateToken(Store.findToken(sel.id));
        if (!copy) return false;
        Store.ui.selection = { kind: sel.kind, id: copy.id };
        App.renderAll();
        setTicker('DUPLICATION // ' + (copy.name || '').toUpperCase());
        return true;
    }

    function copySelection() {
        if (Store.isPlayerView()) return false;
        const sel = Store.ui.selection;
        if (!sel || !['entity', 'decor'].includes(sel.kind)) {
            setTicker('COPIE IMPOSSIBLE // SÉLECTIONNE UN DISPOSITIF OU UN DÉCOR');
            return false;
        }
        const source = sel.kind === 'entity' ? Store.findEntity(sel.id) : Store.findDecor(sel.id);
        if (!source) return false;
        clipboard = { kind: sel.kind, data: JSON.parse(JSON.stringify(source)) };
        setTicker('COPIÉ // ' + source.name.toUpperCase());
        return true;
    }

    function pasteClipboard() {
        if (Store.isPlayerView() || !clipboard) {
            setTicker('PRESSE-PAPIERS VIDE // COPIE D’ABORD UN DISPOSITIF OU UN DÉCOR');
            return false;
        }
        const floor = Store.currentFloor();
        if (!floor) return false;
        const source = JSON.parse(JSON.stringify(clipboard.data));
        source.floorId = floor.id;
        const copy = clipboard.kind === 'entity'
            ? Store.duplicateEntity(source)
            : Store.duplicateDecor(source);
        if (!copy) return false;
        Store.ui.selection = { kind: clipboard.kind, id: copy.id };
        App.renderAll();
        setTicker('COLLÉ SUR ' + floor.name.toUpperCase() + ' // ' + copy.name.toUpperCase());
        return true;
    }

    function applyHistory(direction) {
        const label = direction === 'redo' ? Store.redo() : Store.undo();
        if (!label) return false;
        App.renderAll();
        setTicker((direction === 'redo' ? 'RÉTABLI // ' : 'ANNULÉ // ') + label.toUpperCase());
        return true;
    }

    /* --- Clavier : Suppr = supprimer la sélection, Échap = finir le tracé --- */
    function wireKeyboard() {
        window.addEventListener('keydown', e => {
            const target = e.target;
            const editingField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
                || target.tagName === 'SELECT' || target.isContentEditable);
            const command = e.metaKey || e.ctrlKey;
            if (command && e.key.toLowerCase() === 'z' && !editingField && !Store.isPlayerView()) {
                e.preventDefault();
                applyHistory(e.shiftKey ? 'redo' : 'undo');
                return;
            }
            if (command && e.key.toLowerCase() === 'y' && !editingField && !Store.isPlayerView()) {
                e.preventDefault();
                applyHistory('redo');
                return;
            }
            if (command && e.key.toLowerCase() === 'd' && !editingField && !Store.isPlayerView()) {
                e.preventDefault();
                duplicateSelection();
                return;
            }
            if (command && e.key.toLowerCase() === 'c' && !editingField && !Store.isPlayerView()) {
                e.preventDefault();
                copySelection();
                return;
            }
            if (command && e.key.toLowerCase() === 'v' && !editingField && !Store.isPlayerView()) {
                e.preventDefault();
                pasteClipboard();
                return;
            }
            if (e.key === 'Escape' && Store.ui.activeTool === 'patrol') {
                endPatrolEdit();
                return;
            }
            if (e.key !== 'Delete' || Store.isPlayerView()) return;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            const sel = Store.ui.selection;
            if (!sel) return;
            if (sel.kind === 'entity') Inspector.deleteSelectedEntity();
            else if (sel.kind === 'room') Inspector.deleteSelectedRoom();
            else if (sel.kind === 'decor') Inspector.deleteSelectedDecor();
            else if (sel.kind === 'token') Inspector.deleteSelectedToken();
            else if (sel.kind === 'transition') Inspector.deleteSelectedTransition();
        });
    }

    function setTicker(text) {
        const el = document.getElementById('status-ticker');
        if (el) el.textContent = text;
    }

    return { setTool, renderTools, renderTabs, switchFloor, wireBoard, wireKeyboard,
             onEntityPointerDown, onDecorPointerDown, onTokenPointerDown, onTransitionPointerDown,
             onWaypointPointerDown, onCoverageHandlePointerDown,
             duplicateSelection, copySelection, pasteClipboard, applyHistory,
             setTicker, startPatrolEdit, endPatrolEdit, startTransitionEndpoint };
})();

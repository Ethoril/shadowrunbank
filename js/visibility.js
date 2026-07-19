/* ============================================================
   visibility.js — Onglet « Visibilité » du panneau de gauche.
   Arbre repliable Étage → Pièce → Dispositif → (Ronde / Couverture)
   avec un œil 👁/🚫 par ligne pour révéler/cacher aux joueurs
   sans avoir à sélectionner chaque élément sur la carte.
   ============================================================ */

const Visibility = (() => {

    // Nœuds repliés (par id) — conservé entre deux rendus pour ne pas
    // « déplier » l'arbre à chaque toggle. Tout est déplié par défaut.
    const collapsed = new Set();

    /* Rafraîchit la carte + les onglets d'étage après un changement de
       flag `revealed` (la carte ne rend que l'étage courant, mais l'état
       des cases à cocher de l'arbre, lui, couvre tous les étages). */
    function refreshMap() {
        MapView.render();
        Editor.renderTabs();
    }

    /* Case à cocher œil, mise à jour sur place (pas de reconstruction
       de l'arbre → pas de saut de défilement). `obj` porte `revealed`.
       L'œil reflète la visibilité EFFECTIVE (révélé MJ ou découvert par
       un pion) ; « cacher » un élément découvert retire aussi sa
       découverte, sinon il resterait visible des joueurs. */
    function eyeButton(obj, title, property = 'revealed', discovery = null) {
        const isOn = () => !!obj[property]
            || !!(discovery && Store.isDiscovered(discovery.kind, discovery.elementId));
        const btn = document.createElement('button');
        btn.className = 'vis-eye';
        btn.title = title;
        const paint = () => {
            btn.classList.toggle('revealed', isOn());
            btn.textContent = isOn() ? '👁' : '🚫';
            btn.setAttribute('aria-pressed', isOn() ? 'true' : 'false');
        };
        paint();
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const next = !isOn();
            obj[property] = next;
            if (!next && discovery) Store.removeDiscovery(discovery.kind, discovery.elementId);
            if (property === 'visible' && obj.id && Store.findToken(obj.id)) Store.saveToken(obj);
            else Store.touch();
            paint();
            refreshMap();
            render();
        });
        return btn;
    }

    /* Une ligne de l'arbre : chevron (si enfants), œil, libellé.
       `onSelect` (optionnel) sélectionne l'élément sur la carte. */
    function row(depth, id, hasChildren, revealObj, eyeTitle, labelText, color, onSelect,
        property = 'revealed', discoveryKind = '', discoveryElementId = revealObj.id) {
        const el = document.createElement('div');
        el.className = 'vis-row';
        el.dataset.nodeId = id;
        el.style.paddingLeft = (depth * 16) + 'px';

        const caret = document.createElement('span');
        caret.className = 'vis-caret';
        if (hasChildren) {
            caret.textContent = collapsed.has(id) ? '▸' : '▾';
            caret.addEventListener('click', e => {
                e.stopPropagation();
                if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
                render();
            });
        } else {
            caret.classList.add('leaf');
        }
        el.appendChild(caret);

        el.appendChild(eyeButton(revealObj, eyeTitle, property,
            discoveryKind ? { kind: discoveryKind, elementId: discoveryElementId } : null));

        const label = document.createElement('span');
        label.className = 'vis-label';
        if (color) {
            const dot = document.createElement('span');
            dot.className = 'vis-dot';
            dot.style.background = color;
            label.appendChild(dot);
        }
        const discovery = discoveryKind && Store.getDiscoveries().find(item =>
            item.kind === discoveryKind && item.elementId === discoveryElementId);
        const discovered = !!discovery;
        const manual = !!revealObj[property];
        const effective = manual || discovered;
        label.appendChild(document.createTextNode(labelText));
        if (discovery) {
            const token = Store.findToken(discovery.discoveredBy);
            label.title = 'Découvert par ' + (token ? token.name : discovery.discoveredBy);
        }
        if (!effective) label.classList.add('is-hidden');
        if (discovered) el.classList.add('vis-discovered');
        if (onSelect) {
            label.classList.add('clickable');
            label.addEventListener('click', onSelect);
        }
        el.appendChild(label);

        const status = document.createElement('span');
        status.className = 'vis-status ' + (manual ? 'manual' : discovered ? 'discovered' : 'hidden');
        status.textContent = manual ? (discovered ? 'MJ + découvert' : 'MJ')
            : discovered ? 'Découvert' : 'Caché';
        status.title = manual
            ? 'Visible car révélé manuellement par le MJ'
            : discovered ? 'Visible car découvert automatiquement par un pion'
                : 'Invisible pour les joueurs';
        el.appendChild(status);

        return el;
    }

    /* Cellule occupée par un dispositif → pièce contenante (ou null). */
    function roomOfEntity(ent) {
        const col = Math.floor(ent.x), r = Math.floor(ent.y);
        return Store.roomAt(ent.floorId, col, r);
    }

    function selectOnMap(kind, id) {
        return e => {
            e.stopPropagation();
            const selected = kind === 'floor' ? Store.findFloor(id)
                : kind === 'room' ? Store.findRoom(id)
                : kind === 'decor' ? Store.findDecor(id)
                : kind === 'token' ? Store.findToken(id)
                : kind === 'transition' ? Store.findTransition(id)
                : Store.findEntity(id);
            const floorId = kind === 'floor' ? id : selected && selected.floorId;
            let targetFloorId = floorId;
            if (kind === 'transition' && selected) {
                const currentEndpoint = selected.endpoints.find(endpoint => endpoint.floorId === Store.ui.currentFloorId);
                targetFloorId = (currentEndpoint || selected.endpoints[0] || {}).floorId;
            }
            if (targetFloorId && Store.findFloor(targetFloorId)) Store.ui.currentFloorId = targetFloorId;
            Store.ui.selection = { kind, id };
            Editor.renderTabs();
            MapView.render();
            Inspector.render();
            render();
            requestAnimationFrame(() => MapView.focusElement(kind, id));
        };
    }

    function appendEntityRows(container, ents, depth) {
        ents.forEach(ent => {
            const def = EntityCatalog.get(ent.type);
            const hasChildren = !!(ent.patrol || ent.coverage);
            const selected = isSelected('entity', ent.id);
            const r = row(depth, ent.id, hasChildren, ent, 'Révéler / cacher ce dispositif',
                ent.name, def.color, selectOnMap('entity', ent.id), 'revealed', 'entity');
            if (selected) r.classList.add('selected');
            container.appendChild(r);

            if (hasChildren && !collapsed.has(ent.id)) {
                if (ent.patrol) {
                    container.appendChild(row(depth + 1, ent.id + '_patrol', false,
                        ent.patrol, 'Révéler / cacher la ronde', '➰ Ronde', null,
                        selectOnMap('entity', ent.id)));
                }
                if (ent.coverage) {
                    container.appendChild(row(depth + 1, ent.id + '_coverage', false,
                        ent.coverage, 'Révéler / cacher la couverture',
                        '📡 ' + ent.coverage.shape + ' · ' + ent.coverage.channel, null,
                        selectOnMap('entity', ent.id), 'revealed', 'coverage', ent.id));
                }
            }
        });
    }

    function appendDecorBranch(container, floor, decors) {
        if (!decors.length) return;
        const branchId = floor.id + '_decors';
        const head = document.createElement('div');
        head.className = 'vis-row vis-branch-head';
        head.style.paddingLeft = '16px';
        const caret = document.createElement('span');
        caret.className = 'vis-caret';
        caret.textContent = collapsed.has(branchId) ? '▸' : '▾';
        caret.addEventListener('click', () => {
            if (collapsed.has(branchId)) collapsed.delete(branchId); else collapsed.add(branchId);
            render();
        });
        head.appendChild(caret);
        const label = document.createElement('span');
        label.className = 'vis-label';
        label.textContent = 'Décors (' + decors.length + ')';
        head.appendChild(label);
        container.appendChild(head);
        if (collapsed.has(branchId)) return;

        decors.forEach(decor => {
            const definition = DecorCatalog.get(decor.type);
            const decorRow = row(2, decor.id, false, decor, 'Révéler / cacher ce décor',
                decor.name, definition.color, selectOnMap('decor', decor.id), 'revealed', 'decor');
            if (isSelected('decor', decor.id)) decorRow.classList.add('selected');
            container.appendChild(decorRow);
        });
    }

    function appendTokenBranch(container, floor, tokens) {
        if (!tokens.length) return;
        const branchId = floor.id + '_tokens';
        const head = branchHead(branchId, 'Pions PJ (' + tokens.length + ')');
        container.appendChild(head);
        if (collapsed.has(branchId)) return;
        tokens.forEach(token => {
            const tokenRow = row(2, token.id, false, token, 'Afficher / masquer ce pion',
                token.name, token.color, selectOnMap('token', token.id), 'visible');
            if (isSelected('token', token.id)) tokenRow.classList.add('selected');
            container.appendChild(tokenRow);
        });
    }

    function appendTransitionBranch(container, floor, transitions) {
        if (!transitions.length) return;
        const branchId = floor.id + '_transitions';
        container.appendChild(branchHead(branchId, 'Transitions (' + transitions.length + ')'));
        if (collapsed.has(branchId)) return;
        transitions.forEach(transition => {
            // Une ligne par point de passage présent sur cet étage. Une trappe
            // ou un passage peut en avoir plusieurs sur le même étage : chacun a
            // sa ligne et sa lettre (a, b, c…) pour concorder avec l'inspecteur
            // et l'info-bulle carte. L'œil dévoile CE point, pas la transition
            // entière ; la découverte reste indexée sur la transition.
            transition.endpoints.filter(item => item.floorId === floor.id).forEach(endpoint => {
                const letter = Store.endpointLetter(transition, endpoint);
                const label = transition.name + (letter ? ' ' + letter : '');
                const transitionRow = row(2, floor.id + '_' + transition.id + '_' + endpoint.id, false,
                    endpoint, 'Révéler / cacher ce point de passage', label, '#ffe66d',
                    selectOnMap('transition', transition.id), 'revealed', 'endpoint', endpoint.id);
                if (isSelected('transition', transition.id)) transitionRow.classList.add('selected');
                container.appendChild(transitionRow);
            });
        });
    }

    function branchHead(id, text) {
        const head = document.createElement('div');
        head.className = 'vis-row vis-branch-head';
        head.style.paddingLeft = '16px';
        const caret = document.createElement('span');
        caret.className = 'vis-caret';
        caret.textContent = collapsed.has(id) ? '▸' : '▾';
        caret.addEventListener('click', () => {
            if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
            render();
        });
        head.appendChild(caret);
        const label = document.createElement('span');
        label.className = 'vis-label';
        label.textContent = text;
        head.appendChild(label);
        return head;
    }

    function isSelected(kind, id) {
        const s = Store.ui.selection;
        return !!(s && s.kind === kind && s.id === id);
    }

    function render() {
        const tree = document.getElementById('visibility-tree');
        if (!tree) return;
        // L'onglet est masqué en mode joueur / prévisualisation (panneau caché).
        if (Store.isPlayerView()) { tree.innerHTML = ''; return; }
        tree.innerHTML = '';

        Store.sortedFloors().forEach(floor => {
            const rooms = Store.floorRooms(floor.id);
            const ents = Store.floorEntities(floor.id);
            const decors = Store.floorDecors(floor.id);
            const tokens = Store.floorTokens(floor.id);
            const transitions = Store.getPlan().transitions.filter(transition =>
                transition.endpoints.some(endpoint => endpoint.floorId === floor.id));
            const hasChildren = rooms.length > 0 || ents.length > 0 || decors.length > 0
                || tokens.length > 0 || transitions.length > 0;

            const fRow = row(0, floor.id, hasChildren, floor, "Révéler / cacher l'étage",
                floor.name, null, selectOnMap('floor', floor.id), 'revealed', 'floor');
            fRow.classList.add('vis-floor');
            if (isSelected('floor', floor.id)) fRow.classList.add('selected');
            tree.appendChild(fRow);

            if (!hasChildren || collapsed.has(floor.id)) return;

            // Dispositifs regroupés par pièce contenante ; le reste en « Hors pièce ».
            const byRoom = new Map();
            const orphans = [];
            ents.forEach(ent => {
                const rm = roomOfEntity(ent);
                if (rm) {
                    if (!byRoom.has(rm.id)) byRoom.set(rm.id, []);
                    byRoom.get(rm.id).push(ent);
                } else {
                    orphans.push(ent);
                }
            });

            rooms.forEach(rm => {
                const inRoom = byRoom.get(rm.id) || [];
                const rmHasChildren = inRoom.length > 0;
                const rRow = row(1, rm.id, rmHasChildren, rm, 'Révéler / cacher la pièce',
                    rm.name, `hsl(${rm.hue}, 80%, 65%)`, selectOnMap('room', rm.id),
                    'revealed', 'room');
                if (isSelected('room', rm.id)) rRow.classList.add('selected');
                tree.appendChild(rRow);
                if (rmHasChildren && !collapsed.has(rm.id)) {
                    appendEntityRows(tree, inRoom, 2);
                }
            });

            if (orphans.length) {
                const head = document.createElement('div');
                head.className = 'vis-row vis-orphan-head';
                head.style.paddingLeft = '16px';
                head.textContent = '· Hors pièce';
                tree.appendChild(head);
                appendEntityRows(tree, orphans, 2);
            }
            appendDecorBranch(tree, floor, decors);
            appendTokenBranch(tree, floor, tokens);
            appendTransitionBranch(tree, floor, transitions);
        });

        if (!tree.children.length) {
            const empty = document.createElement('div');
            empty.className = 'inspector-hint';
            empty.textContent = 'Aucun étage.';
            tree.appendChild(empty);
        }
    }

    /* Tout révéler / tout cacher : étages, pièces, dispositifs, rondes et couvertures. */
    function setAll(value) {
        const plan = Store.getPlan();
        plan.floors.forEach(f => f.revealed = value);
        plan.rooms.forEach(r => r.revealed = value);
        plan.decors.forEach(decor => decor.revealed = value);
        plan.transitions.forEach(transition =>
            transition.endpoints.forEach(endpoint => { endpoint.revealed = value; }));
        Store.getTokens().forEach(token => { token.visible = value; Store.saveToken(token); });
        plan.entities.forEach(e => {
            e.revealed = value;
            if (e.patrol) e.patrol.revealed = value;
            if (e.coverage) e.coverage.revealed = value;
        });
        Store.touch();
        refreshMap();
        render();
    }

    /* Bascule d'onglet du panneau de gauche (Outils / Visibilité). */
    function init() {
        const tabs = document.querySelectorAll('.panel-tab');
        tabs.forEach(tab => tab.addEventListener('click', () => {
            const name = tab.dataset.tab;
            tabs.forEach(t => t.classList.toggle('active', t === tab));
            document.getElementById('tab-tools').style.display = name === 'tools' ? '' : 'none';
            document.getElementById('tab-visibility').style.display = name === 'visibility' ? '' : 'none';
            if (name === 'visibility') render();
        }));

        const revealAll = document.getElementById('vis-reveal-all');
        const hideAll = document.getElementById('vis-hide-all');
        const resetFloor = document.getElementById('vis-reset-floor');
        const resetAll = document.getElementById('vis-reset-all');
        if (revealAll) revealAll.addEventListener('click', () => {
            if (confirm('Révéler tout le plan, y compris les étages, rondes et couvertures cachés ?')) {
                setAll(true);
            }
        });
        if (hideAll) hideAll.addEventListener('click', () => setAll(false));
        if (resetFloor) resetFloor.addEventListener('click', () => {
            const floor = Store.currentFloor();
            if (floor && confirm('Effacer les découvertes automatiques de « ' + floor.name + ' » ?')) {
                Store.resetDiscoveries(floor.id);
                App.renderAll();
            }
        });
        if (resetAll) resetAll.addEventListener('click', () => {
            if (confirm('Effacer toutes les découvertes automatiques de la partie ?')) {
                Store.resetDiscoveries();
                App.renderAll();
            }
        });
    }

    return { init, render };
})();

/* ============================================================
   visibility.js — Onglet « Visibilité » du panneau de gauche.
   Arbre repliable Étage → Pièce → Dispositif → (Ronde / Cône)
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
       de l'arbre → pas de saut de défilement). `obj` porte `revealed`. */
    function eyeButton(obj, title) {
        const btn = document.createElement('button');
        btn.className = 'vis-eye';
        btn.title = title;
        const paint = () => {
            btn.classList.toggle('revealed', !!obj.revealed);
            btn.textContent = obj.revealed ? '👁' : '🚫';
            btn.setAttribute('aria-pressed', obj.revealed ? 'true' : 'false');
        };
        paint();
        btn.addEventListener('click', e => {
            e.stopPropagation();
            obj.revealed = !obj.revealed;
            Store.touch();
            paint();
            refreshMap();
        });
        return btn;
    }

    /* Une ligne de l'arbre : chevron (si enfants), œil, libellé.
       `onSelect` (optionnel) sélectionne l'élément sur la carte. */
    function row(depth, id, hasChildren, revealObj, eyeTitle, labelText, color, onSelect) {
        const el = document.createElement('div');
        el.className = 'vis-row';
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

        el.appendChild(eyeButton(revealObj, eyeTitle));

        const label = document.createElement('span');
        label.className = 'vis-label';
        if (color) {
            const dot = document.createElement('span');
            dot.className = 'vis-dot';
            dot.style.background = color;
            label.appendChild(dot);
        }
        label.appendChild(document.createTextNode(labelText));
        if (!revealObj.revealed) label.classList.add('is-hidden');
        if (onSelect) {
            label.classList.add('clickable');
            label.addEventListener('click', onSelect);
        }
        el.appendChild(label);

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
            Store.ui.selection = { kind, id };
            MapView.render();
            Inspector.render();
            render();
        };
    }

    function appendEntityRows(container, ents, depth) {
        ents.forEach(ent => {
            const def = MapView.catalog[ent.type] || { name: ent.type, color: '#888' };
            const hasChildren = !!(ent.patrol || ent.vision);
            const selected = isSelected('entity', ent.id);
            const r = row(depth, ent.id, hasChildren, ent, 'Révéler / cacher ce dispositif',
                ent.name, def.color, selectOnMap('entity', ent.id));
            if (selected) r.classList.add('selected');
            container.appendChild(r);

            if (hasChildren && !collapsed.has(ent.id)) {
                if (ent.patrol) {
                    container.appendChild(row(depth + 1, ent.id + '_patrol', false,
                        ent.patrol, 'Révéler / cacher la ronde', '➰ Ronde', null,
                        selectOnMap('entity', ent.id)));
                }
                if (ent.vision) {
                    container.appendChild(row(depth + 1, ent.id + '_vision', false,
                        ent.vision, 'Révéler / cacher le cône de vision', '📡 Cône', null,
                        selectOnMap('entity', ent.id)));
                }
            }
        });
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
            const hasChildren = rooms.length > 0 || ents.length > 0;

            const fRow = row(0, floor.id, hasChildren, floor, "Révéler / cacher l'étage",
                floor.name, null, selectOnMap('floor', floor.id));
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
                    rm.name, `hsl(${rm.hue}, 80%, 65%)`, selectOnMap('room', rm.id));
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
        });

        if (!tree.children.length) {
            const empty = document.createElement('div');
            empty.className = 'inspector-hint';
            empty.textContent = 'Aucun étage.';
            tree.appendChild(empty);
        }
    }

    /* Tout révéler / tout cacher : étages, pièces, dispositifs + rondes/cônes. */
    function setAll(value) {
        const plan = Store.getPlan();
        plan.floors.forEach(f => f.revealed = value);
        plan.rooms.forEach(r => r.revealed = value);
        plan.entities.forEach(e => {
            e.revealed = value;
            if (e.patrol) e.patrol.revealed = value;
            if (e.vision) e.vision.revealed = value;
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
        if (revealAll) revealAll.addEventListener('click', () => setAll(true));
        if (hideAll) hideAll.addEventListener('click', () => setAll(false));
    }

    return { init, render };
})();

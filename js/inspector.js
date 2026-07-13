/* ============================================================
   inspector.js — Panneau droit : propriétés de la sélection
   (entité / pièce / étage), liaisons réseau, suppression.
   Le toggle Révélé/Caché arrive en phase 4.
   ============================================================ */

const Inspector = (() => {

    const panel = () => document.getElementById('inspector-body');

    function field(labelText, inputEl) {
        const wrap = document.createElement('div');
        wrap.className = 'inspector-field';
        const label = document.createElement('label');
        label.textContent = labelText;
        wrap.appendChild(label);
        wrap.appendChild(inputEl);
        return wrap;
    }

    function textInput(value, onInput) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.addEventListener('input', () => onInput(input.value));
        return input;
    }

    function render() {
        const body = panel();
        body.innerHTML = '';
        const sel = Store.ui.selection;

        if (!sel) {
            const hint = document.createElement('div');
            hint.className = 'inspector-hint';
            hint.textContent = 'Sélectionne un élément sur la carte (entité ou pièce), ou re-clique sur un onglet d\'étage, pour modifier ses propriétés.';
            body.appendChild(hint);
            return;
        }

        if (Store.isPlayerView()) return renderReadOnly(body, sel);

        if (sel.kind === 'entity') renderEntity(body, Store.findEntity(sel.id));
        else if (sel.kind === 'room') renderRoom(body, Store.findRoom(sel.id));
        else if (sel.kind === 'floor') renderFloor(body, Store.findFloor(sel.id));
    }

    /* --- Vue joueur : consultation sans aucun contrôle d'édition.
       Seuls les éléments révélés sont sélectionnables ; la ronde et
       le cône n'apparaissent que si leur propre flag est révélé. --- */
    function renderReadOnly(body, sel) {
        const STATE_LABELS = { active: 'Actif / Sécurisé', hacked: 'Piraté (Hacked)', offline: 'Hors-ligne (Offline)' };
        const roText = (label, value) => {
            const span = document.createElement('span');
            span.textContent = value;
            body.appendChild(field(label, span));
        };

        if (sel.kind === 'entity') {
            const ent = Store.findEntity(sel.id);
            if (!ent || !ent.revealed) { Store.ui.selection = null; return render(); }
            const def = MapView.catalog[ent.type] || { name: ent.type, color: '#888' };
            const type = document.createElement('span');
            type.className = 'ins-type-badge';
            type.textContent = def.name.toUpperCase();
            type.style.color = def.color;
            body.appendChild(field('Type :', type));
            roText('Nom :', ent.name);
            roText('Statut :', STATE_LABELS[Store.getEffectiveState(ent)] || ent.state);
            if (ent.note) roText('Info :', ent.note);
            if (ent.patrol && ent.patrol.revealed) {
                roText('Ronde :', ent.patrol.points.length + ' waypoint(s) — '
                    + (ent.patrol.moving ? '▶ en déplacement' : '⏸ à l\'arrêt'));
            }
            if (ent.vision && ent.vision.revealed) {
                roText('Vision :', ent.vision.angle + '° / portée ' + ent.vision.range + ' cases'
                    + (ent.vision.sweep ? ' — balayage' : ''));
            }
        } else if (sel.kind === 'room') {
            const room = Store.findRoom(sel.id);
            if (!room || !room.revealed) { Store.ui.selection = null; return render(); }
            roText('Pièce :', room.name);
        } else if (sel.kind === 'floor') {
            const floor = Store.findFloor(sel.id);
            if (!floor || !floor.revealed) { Store.ui.selection = null; return render(); }
            roText('Étage :', floor.name);
        }

        const hint = document.createElement('div');
        hint.className = 'inspector-hint';
        hint.textContent = Store.ui.preview
            ? 'Prévisualisation — ce que voient les joueurs.'
            : 'Mode joueur — lecture seule.';
        body.appendChild(hint);
    }

    /* --- Entité --- */
    function renderEntity(body, ent) {
        if (!ent) { Store.ui.selection = null; return render(); }
        const def = MapView.catalog[ent.type] || { name: ent.type, color: '#888' };

        const type = document.createElement('span');
        type.className = 'ins-type-badge';
        type.textContent = def.name.toUpperCase();
        type.style.color = def.color;
        body.appendChild(field("Type d'entité :", type));

        body.appendChild(field("Nom de l'élément :", textInput(ent.name, v => {
            ent.name = v;
            Store.touch();
            MapView.renderEntities();
        })));

        const stateSelect = document.createElement('select');
        [['active', 'Actif / Sécurisé'], ['hacked', 'Piraté (Hacked)'], ['offline', 'Hors-ligne (Offline)']].forEach(([v, t]) => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = t;
            if (ent.state === v) opt.selected = true;
            stateSelect.appendChild(opt);
        });
        stateSelect.addEventListener('change', () => {
            ent.state = stateSelect.value;
            Store.touch();
            MapView.renderEntities(); // met à jour styles + cascades instantanément
        });
        body.appendChild(field('Statut opérationnel :', stateSelect));

        // Liaison réseau : uniquement pour les appareils (pas les nœuds eux-mêmes)
        if (ent.type !== 'network_node') {
            const netSelect = document.createElement('select');
            const none = document.createElement('option');
            none.value = ''; none.textContent = '[Aucun - Autonome]';
            netSelect.appendChild(none);
            Store.floorEntities(ent.floorId)
                .filter(e => e.type === 'network_node')
                .forEach(n => {
                    const opt = document.createElement('option');
                    opt.value = n.id; opt.textContent = n.name;
                    if (ent.networkId === n.id) opt.selected = true;
                    netSelect.appendChild(opt);
                });
            netSelect.addEventListener('change', () => {
                ent.networkId = netSelect.value;
                Store.touch();
                MapView.renderEntities();
            });
            body.appendChild(field('Liaison Nœud Réseau :', netSelect));
        }

        const note = document.createElement('textarea');
        note.value = ent.note || '';
        note.placeholder = 'Info legwork, comportement, mot de passe volé…';
        note.addEventListener('input', () => {
            ent.note = note.value;
            Store.touch();
        });
        body.appendChild(field('Note MJ :', note));

        body.appendChild(revealToggle('Dispositif', ent, () => MapView.renderEntities()));

        if (def.mobile) renderPatrolSection(body, ent);
        if (def.hasVision) renderVisionSection(body, ent);

        body.appendChild(sep());
        body.appendChild(dangerButton("Supprimer l'élément", deleteSelectedEntity));
    }

    /* --- Section ronde (types mobiles) --- */
    function renderPatrolSection(body, ent) {
        body.appendChild(sep());
        body.appendChild(sectionTitle('➰ Chemin de ronde'));

        if (!ent.patrol) {
            const hint = document.createElement('div');
            hint.className = 'inspector-hint';
            hint.textContent = 'Aucune ronde connue (optionnel).';
            body.appendChild(hint);
            body.appendChild(secondaryButton('Tracer une ronde', () => {
                Store.createPatrol(ent);
                Editor.startPatrolEdit(ent.id);
            }));
            return;
        }

        const p = ent.patrol;
        const tracing = Store.ui.activeTool === 'patrol' && Store.ui.patrolEditId === ent.id;

        const info = document.createElement('span');
        info.textContent = p.points.length + ' waypoint(s) — ' + (p.moving ? '▶ en ronde' : '⏸ à l\'arrêt');
        info.style.color = p.moving ? 'var(--success)' : 'var(--text-muted)';
        body.appendChild(field('État :', info));

        if (tracing) {
            const hint = document.createElement('div');
            hint.className = 'inspector-hint';
            hint.textContent = 'Clique sur la carte pour ajouter des waypoints (Échap pour finir).';
            body.appendChild(hint);
            body.appendChild(secondaryButton('✔ Terminer le tracé', () => Editor.endPatrolEdit()));
        } else {
            const speed = numberInput(p.speed, 0.1, 10, 0.1, v => {
                p.speed = v;
                if (p.moving) p.anchorAt = Date.now(); // évite le saut de position
                Store.touch();
            });
            body.appendChild(field('Vitesse (cases/s) :', speed));

            body.appendChild(checkboxField('Boucle (sinon aller-retour)', p.loop, v => {
                p.loop = v;
                if (p.moving) p.anchorAt = Date.now();
                Store.touch();
                MapView.renderOverlay();
            }));

            const row = document.createElement('div');
            row.className = 'btn-row';
            row.appendChild(secondaryButton(p.moving ? '⏸ Stopper' : '▶ Démarrer', () => {
                if (p.moving) {
                    Store.stopPatrol(ent);
                    MapView.renderEntities();
                } else if (!Store.startPatrol(ent)) {
                    alert('Il faut au moins 2 waypoints pour lancer la ronde.');
                }
                render();
            }));
            row.appendChild(secondaryButton('✏ Tracé', () => {
                if (p.moving) Store.stopPatrol(ent);
                Editor.startPatrolEdit(ent.id);
            }));
            body.appendChild(row);

            // Révélé indépendamment de l'entité : les PJ peuvent connaître
            // le garde sans connaître son cheminement.
            body.appendChild(revealToggle('Ronde', p, () => MapView.renderOverlay()));

            body.appendChild(secondaryButton('✖ Effacer la ronde', () => {
                Store.clearPatrol(ent);
                MapView.renderEntities();
                render();
            }));
        }
    }

    /* --- Section cône de vision (types hasVision) --- */
    function renderVisionSection(body, ent) {
        body.appendChild(sep());
        body.appendChild(sectionTitle('📡 Cône de vision'));

        if (!ent.vision) {
            const hint = document.createElement('div');
            hint.className = 'inspector-hint';
            hint.textContent = 'Aucun cône défini (optionnel).';
            body.appendChild(hint);
            body.appendChild(secondaryButton('Ajouter un cône de vision', () => {
                Store.createVision(ent);
                MapView.renderCones(Date.now());
                render();
            }));
            return;
        }

        const v = ent.vision;
        const refresh = () => MapView.renderCones(Date.now());

        if (!v.sweep) {
            body.appendChild(field('Direction (° — 0 = est, 90 = sud) :',
                numberInput(v.direction, -360, 360, 5, val => { v.direction = val; Store.touch(); refresh(); })));
        }
        body.appendChild(field('Ouverture (°) :',
            numberInput(v.angle, 10, 180, 5, val => { v.angle = val; Store.touch(); refresh(); })));
        body.appendChild(field('Portée (cases) :',
            numberInput(v.range, 1, 30, 1, val => { v.range = val; Store.touch(); refresh(); })));

        body.appendChild(checkboxField('Balayage (cône mobile)', !!v.sweep, enabled => {
            Store.setSweep(ent, enabled);
            refresh();
            render();
        }));

        if (v.sweep) {
            const row = document.createElement('div');
            row.className = 'btn-row';
            const fromWrap = field('De (°) :', numberInput(v.sweep.from, -360, 360, 5, val => { v.sweep.from = val; Store.touch(); }));
            const toWrap = field('À (°) :', numberInput(v.sweep.to, -360, 360, 5, val => { v.sweep.to = val; Store.touch(); }));
            row.appendChild(fromWrap);
            row.appendChild(toWrap);
            body.appendChild(row);
            body.appendChild(field('Période (s, aller-retour) :',
                numberInput(v.sweep.period, 1, 60, 1, val => { v.sweep.period = val; Store.touch(); })));
        }

        // Révélé indépendamment de l'entité : caméra connue ≠ couverture connue.
        body.appendChild(revealToggle('Cône', v, refresh));

        body.appendChild(secondaryButton('✖ Supprimer le cône', () => {
            Store.clearVision(ent);
            refresh();
            render();
        }));
    }

    /* --- Pièce --- */
    function renderRoom(body, room) {
        if (!room) { Store.ui.selection = null; return render(); }

        const type = document.createElement('span');
        type.className = 'ins-type-badge';
        type.textContent = 'PIÈCE';
        type.style.color = `hsl(${room.hue}, 80%, 65%)`;
        body.appendChild(field('Type :', type));

        body.appendChild(field('Nom de la pièce :', textInput(room.name, v => {
            room.name = v;
            Store.touch();
            MapView.render();
        })));

        const size = document.createElement('span');
        size.textContent = room.cells.length + ' case(s)';
        body.appendChild(field('Surface :', size));

        const hint = document.createElement('div');
        hint.className = 'inspector-hint';
        hint.textContent = 'Outil ✏ pour ajouter des cases à cette pièce, ⌫ pour en retirer.';
        body.appendChild(hint);

        body.appendChild(revealToggle('Pièce', room, () => MapView.render()));

        body.appendChild(sep());
        body.appendChild(dangerButton('Supprimer la pièce', deleteSelectedRoom));
    }

    /* --- Étage --- */
    function renderFloor(body, floor) {
        if (!floor) { Store.ui.selection = null; return render(); }

        const type = document.createElement('span');
        type.className = 'ins-type-badge';
        type.textContent = 'ÉTAGE';
        body.appendChild(field('Type :', type));

        body.appendChild(field("Nom de l'étage :", textInput(floor.name, v => {
            floor.name = v;
            Store.touch();
            Editor.renderTabs();
        })));

        const stats = document.createElement('span');
        stats.textContent = Store.floorRooms(floor.id).length + ' pièce(s), '
            + Store.floorEntities(floor.id).length + ' dispositif(s)';
        body.appendChild(field('Contenu :', stats));

        const orderRow = document.createElement('div');
        orderRow.className = 'btn-row';
        const up = document.createElement('button');
        up.className = 'btn-secondary';
        up.textContent = '◀ Avancer';
        up.addEventListener('click', () => { Store.moveFloor(floor.id, -1); Editor.renderTabs(); });
        const down = document.createElement('button');
        down.className = 'btn-secondary';
        down.textContent = 'Reculer ▶';
        down.addEventListener('click', () => { Store.moveFloor(floor.id, 1); Editor.renderTabs(); });
        orderRow.appendChild(up);
        orderRow.appendChild(down);
        body.appendChild(field('Ordre des onglets :', orderRow));

        body.appendChild(revealToggle('Étage', floor, () => Editor.renderTabs()));

        body.appendChild(sep());
        body.appendChild(dangerButton("Supprimer l'étage", () => {
            const nbRooms = Store.floorRooms(floor.id).length;
            const nbEnts = Store.floorEntities(floor.id).length;
            if (!confirm(`Supprimer « ${floor.name} » ?\n${nbRooms} pièce(s) et ${nbEnts} dispositif(s) seront supprimés.`)) return;
            if (!Store.deleteFloor(floor.id)) {
                alert('Impossible de supprimer le dernier étage.');
                return;
            }
            Store.ui.selection = null;
            App.renderAll();
        }));
    }

    /* --- Suppressions (aussi appelées par la touche Suppr) --- */
    function deleteSelectedEntity() {
        const sel = Store.ui.selection;
        if (!sel || sel.kind !== 'entity') return;
        Store.deleteEntity(sel.id);
        Store.ui.selection = null;
        MapView.renderEntities();
        render();
    }

    function deleteSelectedRoom() {
        const sel = Store.ui.selection;
        if (!sel || sel.kind !== 'room') return;
        const room = Store.findRoom(sel.id);
        if (room && room.cells.length > 0 && !confirm(`Supprimer la pièce « ${room.name} » ?`)) return;
        Store.deleteRoom(sel.id);
        Store.ui.selection = null;
        MapView.render();
        render();
    }

    function sep() {
        const hr = document.createElement('hr');
        hr.className = 'ins-sep';
        return hr;
    }

    function sectionTitle(text) {
        const div = document.createElement('div');
        div.className = 'ins-section-title';
        div.textContent = text;
        return div;
    }

    function numberInput(value, min, max, step, onChange) {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = value;
        input.min = min; input.max = max; input.step = step;
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        });
        return input;
    }

    /* Toggle 👁 Révélé / Caché — `obj` porte un flag `revealed`
       (entité, pièce, étage, mais aussi patrol ou vision). */
    function revealToggle(labelText, obj, onChange) {
        const btn = document.createElement('button');
        const paint = () => {
            btn.className = 'btn-reveal' + (obj.revealed ? ' revealed' : '');
            btn.textContent = obj.revealed
                ? '👁 ' + labelText + ' révélé aux joueurs'
                : '🚫 ' + labelText + ' caché — cliquer pour révéler';
        };
        paint();
        btn.addEventListener('click', () => {
            obj.revealed = !obj.revealed;
            Store.touch();
            paint();
            if (onChange) onChange();
        });
        return btn;
    }

    function checkboxField(labelText, checked, onChange) {
        const label = document.createElement('label');
        label.className = 'tool-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + labelText));
        return label;
    }

    function secondaryButton(text, onClick) {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function dangerButton(text, onClick) {
        const btn = document.createElement('button');
        btn.className = 'btn-action';
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        return btn;
    }

    return { render, deleteSelectedEntity, deleteSelectedRoom };
})();

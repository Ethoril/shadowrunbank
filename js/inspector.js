/* ============================================================
   inspector.js — Panneau droit : propriétés de la sélection
   (entité / pièce / étage), liaisons réseau, suppression.
   Le toggle Révélé/Caché arrive en phase 4.
   ============================================================ */

const Inspector = (() => {

    const panel = () => document.getElementById('inspector-body');
    let lastPlayerSelection = '';

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
        groupContinuousInput(input, 'Modifier un texte');
        return input;
    }

    function capabilitySummary(definition) {
        const labels = [];
        if (definition.networkable) labels.push('Réseau');
        if (definition.accessControl) labels.push('Contrôle d’accès');
        if (definition.biometric) labels.push('Biométrique');
        if (definition.canPatrol) labels.push('Ronde');
        if (definition.coverageType !== 'none') {
            labels.push(definition.coverageType + ' · ' + definition.coverageChannel);
        }
        if (definition.canSweep) labels.push('Balayage');
        if (definition.armed) labels.push('Armé');
        if (definition.blocksMovement) labels.push('Obstacle');
        if (definition.blocksVision.length) labels.push('Bloque ' + definition.blocksVision.join(', '));
        if (definition.magical) labels.push('Magique');
        return labels.join(' · ') || 'Autonome';
    }

    function appendDiscoveryOrigin(body, kind, item) {
        if (!item) return;
        const discovery = Store.getDiscoveries().find(entry =>
            entry.kind === kind && entry.elementId === item.id);
        if (!discovery) return;
        const token = Store.findToken(discovery.discoveredBy);
        const value = document.createElement('span');
        value.className = 'ins-capabilities';
        value.textContent = 'Découvert par ' + (token ? token.name : discovery.discoveredBy)
            + (discovery.discoveredAt ? ' · ' + new Date(discovery.discoveredAt).toLocaleString('fr-FR') : '');
        body.appendChild(field('Origine de visibilité :', value));
    }

    function render() {
        const body = panel();
        body.innerHTML = '';
        const sel = Store.ui.selection;

        if (Store.isPlayerView()) {
            const selectionKey = sel ? sel.kind + ':' + sel.id : '';
            if (selectionKey && selectionKey !== lastPlayerSelection) {
                if (window.App && typeof App.openInspectorDrawer === 'function') {
                    App.openInspectorDrawer();
                } else {
                    document.body.classList.add('inspector-open');
                }
            }
            lastPlayerSelection = selectionKey;
        } else {
            lastPlayerSelection = '';
        }

        if (!sel) {
            const hint = document.createElement('div');
            hint.className = 'inspector-hint';
            hint.textContent = Store.isPlayerView()
                ? 'Sélectionne un élément révélé sur la carte pour consulter ses informations.'
                : 'Sélectionne un élément sur la carte (entité ou pièce), ou re-clique sur un onglet d\'étage, pour modifier ses propriétés.';
            body.appendChild(hint);
            return;
        }

        if (Store.isPlayerView()) return renderReadOnly(body, sel);

        if (sel.kind === 'entity') renderEntity(body, Store.findEntity(sel.id));
        else if (sel.kind === 'room') renderRoom(body, Store.findRoom(sel.id));
        else if (sel.kind === 'decor') renderDecor(body, Store.findDecor(sel.id));
        else if (sel.kind === 'floor') renderFloor(body, Store.findFloor(sel.id));
        else if (sel.kind === 'token') renderToken(body, Store.findToken(sel.id));
        else if (sel.kind === 'transition') renderTransition(body, Store.findTransition(sel.id));
    }

    /* --- Vue joueur : consultation sans aucun contrôle d'édition.
       Seuls les éléments révélés sont sélectionnables ; la ronde et
       la couverture n'apparaissent que si leur propre flag est révélé. --- */
    function renderReadOnly(body, sel) {
        const roText = (label, value) => {
            const span = document.createElement('span');
            span.textContent = value;
            body.appendChild(field(label, span));
        };

        if (sel.kind === 'entity') {
            const ent = Store.findEntity(sel.id);
            if (!ent || !Store.isEffectivelyRevealed(ent, 'entity')) { Store.ui.selection = null; return render(); }
            const def = EntityCatalog.get(ent.type);
            const type = document.createElement('span');
            type.className = 'ins-type-badge';
            type.textContent = def.name.toUpperCase();
            type.style.color = def.color;
            body.appendChild(field('Type :', type));
            roText('Capacités :', capabilitySummary(def));
            roText('Nom :', ent.name);
            const stateLabels = Object.fromEntries(EntityCatalog.statesFor(ent.type));
            roText('Statut :', stateLabels[Store.getEffectiveState(ent)] || ent.state);
            if (ent.playerInfo) roText('Info :', ent.playerInfo);
            if (ent.patrol && ent.patrol.revealed) {
                roText('Ronde :', ent.patrol.points.length + ' waypoint(s) — '
                    + (ent.patrol.moving ? '▶ en déplacement' : '⏸ à l\'arrêt'));
            }
            if (ent.coverage && ent.coverage.revealed) {
                const c = ent.coverage;
                const extent = c.shape === 'circle'
                    ? 'rayon ' + c.radius + ' cases'
                    : 'portée ' + c.range + ' cases';
                roText('Couverture :', c.shape + ' / ' + c.channel + ' — ' + extent
                    + (c.sweep ? ' — balayage' : ''));
            }
        } else if (sel.kind === 'decor') {
            const decor = Store.findDecor(sel.id);
            if (!decor || !Store.isEffectivelyRevealed(decor, 'decor')) { Store.ui.selection = null; return render(); }
            const definition = DecorCatalog.get(decor.type);
            roText('Décor :', definition.name);
            roText('Nom :', decor.name);
            if (decor.playerInfo) roText('Info :', decor.playerInfo);
        } else if (sel.kind === 'room') {
            const room = Store.findRoom(sel.id);
            if (!room || !Store.isEffectivelyRevealed(room, 'room')) { Store.ui.selection = null; return render(); }
            roText('Pièce :', room.name);
        } else if (sel.kind === 'floor') {
            const floor = Store.findFloor(sel.id);
            if (!floor || !Store.isEffectivelyRevealed(floor, 'floor')) { Store.ui.selection = null; return render(); }
            roText('Étage :', floor.name);
        } else if (sel.kind === 'token') {
            const token = Store.findToken(sel.id);
            if (!token || !token.visible) { Store.ui.selection = null; return render(); }
            roText('Pion :', token.name);
            roText('Identifiant :', token.shortLabel);
            roText('Déplacement :', token.locked ? 'Verrouillé' : (token.playerMovable ? 'Autorisé' : 'Réservé au MJ'));
        } else if (sel.kind === 'transition') {
            const transition = Store.findTransition(sel.id);
            if (!transition || !Store.isEffectivelyRevealed(transition, 'transition')) {
                Store.ui.selection = null; return render();
            }
            roText('Transition :', transition.name);
            roText('Type :', transitionTypeLabels()[transition.type] || transition.type);
            roText('Statut :', transition.state === 'active' ? 'Active' : 'Hors ligne');
            if (transition.type === 'stairs') {
                roText('Sens :', stairsDirectionLabels()[transition.direction] || 'Monte et descend');
            }
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
        const def = EntityCatalog.get(ent.type);

        const type = document.createElement('span');
        type.className = 'ins-type-badge';
        type.textContent = def.name.toUpperCase();
        type.style.color = def.color;
        body.appendChild(field("Type d'entité :", type));
        appendDiscoveryOrigin(body, 'entity', ent);

        const capabilities = document.createElement('span');
        capabilities.className = 'ins-capabilities';
        capabilities.textContent = capabilitySummary(def);
        body.appendChild(field('Capacités :', capabilities));

        body.appendChild(field("Nom de l'élément :", textInput(ent.name, v => {
            ent.name = v;
            Store.touch();
            MapView.renderEntities();
        })));

        const stateSelect = document.createElement('select');
        EntityCatalog.statesFor(ent.type).forEach(([v, t]) => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = t;
            if (ent.state === v) opt.selected = true;
            stateSelect.appendChild(opt);
        });
        stateSelect.addEventListener('change', () => {
            Store.setEntityState(ent, stateSelect.value);
            MapView.renderEntities(); // met à jour styles + cascades instantanément
            render();
        });
        body.appendChild(field('Statut opérationnel :', stateSelect));

        // Liaison réseau : uniquement pour les appareils (pas les nœuds eux-mêmes)
        if (def.networkable) {
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

        const privateNote = document.createElement('textarea');
        privateNote.value = ent.privateNote || '';
        privateNote.placeholder = 'Info legwork, comportement, mot de passe volé…';
        privateNote.addEventListener('input', () => {
            ent.privateNote = privateNote.value;
            Store.touch();
        });
        groupContinuousInput(privateNote, 'Modifier une note privée');
        body.appendChild(field('Note privée MJ :', privateNote));

        const playerInfo = document.createElement('textarea');
        playerInfo.value = ent.playerInfo || '';
        playerInfo.placeholder = 'Information visible par les joueurs après révélation…';
        playerInfo.addEventListener('input', () => {
            ent.playerInfo = playerInfo.value;
            Store.touch();
        });
        groupContinuousInput(playerInfo, 'Modifier une information joueur');
        body.appendChild(field('Information joueurs :', playerInfo));

        body.appendChild(checkboxField('Découverte automatique', ent.autoDiscover !== false, value => {
            ent.autoDiscover = value;
            Store.touch();
        }));

        body.appendChild(revealToggle('Dispositif', ent, () => MapView.renderEntities()));

        if (def.canPatrol) renderPatrolSection(body, ent);
        if (def.coverageType !== 'none') renderCoverageSection(body, ent, def);

        body.appendChild(sep());
        const actions = document.createElement('div');
        actions.className = 'btn-row';
        actions.appendChild(secondaryButton('Dupliquer', () => {
            const copy = Store.duplicateEntity(ent);
            Store.ui.selection = { kind: 'entity', id: copy.id };
            App.renderAll();
        }));
        actions.appendChild(dangerButton("Supprimer", deleteSelectedEntity));
        body.appendChild(actions);
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
                Store.setPatrolSpeed(ent, v);
            });
            body.appendChild(field('Vitesse (cases/s) :', speed));

            body.appendChild(checkboxField('Boucle (sinon aller-retour)', p.loop, v => {
                Store.setPatrolLoop(ent, v);
                MapView.renderOverlay();
                MapView.renderEntities();
                render();
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

            renderWaypointEditor(body, ent);

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

    function renderWaypointEditor(body, ent) {
        const points = ent.patrol.points;
        body.appendChild(sectionTitle('Waypoints éditables'));
        const hint = document.createElement('div');
        hint.className = 'inspector-hint';
        hint.textContent = 'Fais glisser un point cerclé sur la carte, ou change son ordre ici.';
        body.appendChild(hint);

        const list = document.createElement('div');
        list.className = 'waypoint-list';
        points.forEach((point, index) => {
            const row = document.createElement('div');
            row.className = 'waypoint-row';
            const label = document.createElement('span');
            label.textContent = (index + 1) + '. ' + point.x + ', ' + point.y;
            row.appendChild(label);
            const controls = document.createElement('div');
            controls.className = 'waypoint-actions';
            const up = secondaryButton('↑', () => {
                Store.movePatrolPoint(ent, index, index - 1);
                MapView.renderOverlay(); render();
            });
            up.title = 'Monter ce waypoint';
            up.disabled = index === 0;
            const down = secondaryButton('↓', () => {
                Store.movePatrolPoint(ent, index, index + 1);
                MapView.renderOverlay(); render();
            });
            down.title = 'Descendre ce waypoint';
            down.disabled = index === points.length - 1;
            const remove = dangerButton('×', () => {
                Store.removePatrolPoint(ent, index);
                MapView.renderOverlay(); render();
            });
            remove.title = 'Supprimer ce waypoint';
            controls.appendChild(up);
            controls.appendChild(down);
            controls.appendChild(remove);
            row.appendChild(controls);
            list.appendChild(row);
        });
        body.appendChild(list);

        const actions = document.createElement('div');
        actions.className = 'btn-row';
        const removeLast = secondaryButton('− Dernier', () => {
            Store.removePatrolPoint(ent, ent.patrol.points.length - 1);
            MapView.renderOverlay(); render();
        });
        removeLast.disabled = points.length === 0;
        actions.appendChild(removeLast);
        const reverse = secondaryButton('⇄ Inverser', () => {
            Store.reversePatrol(ent);
            MapView.renderOverlay(); render();
        });
        reverse.disabled = points.length < 2;
        actions.appendChild(reverse);
        body.appendChild(actions);
    }

    /* --- Section couverture (pilotée par les capacités du catalogue) --- */
    function renderCoverageSection(body, ent, def) {
        body.appendChild(sep());
        body.appendChild(sectionTitle('📡 Zone de couverture'));

        if (!ent.coverage) {
            const hint = document.createElement('div');
            hint.className = 'inspector-hint';
            hint.textContent = 'Aucune couverture définie (optionnel).';
            body.appendChild(hint);
            body.appendChild(secondaryButton('Ajouter la couverture', () => {
                Store.createCoverage(ent);
                MapView.renderCoverages(Date.now());
                render();
            }));
            return;
        }

        const c = ent.coverage;
        const refresh = () => MapView.renderCoverages(Date.now());
        const shapeLabels = {
            cone: 'Cône', beam: 'Faisceau', rectangle: 'Rectangle',
            circle: 'Cercle', threshold: 'Seuil'
        };
        const channelLabels = {
            optical: 'Optique', infrared: 'Infrarouge', laser: 'Laser',
            magnetic: 'Magnétique', pressure: 'Pression', astral: 'Astral'
        };

        body.appendChild(field('Forme :', selectInput(shapeLabels, c.shape, value => {
            c.shape = value;
            if (value === 'circle') c.sweep = null;
            Store.touch();
            refresh();
            render();
        })));
        body.appendChild(field('Canal :', selectInput(channelLabels, c.channel, value => {
            c.channel = value;
            Store.touch();
            refresh();
        })));

        const directional = c.shape !== 'circle';
        if (directional && !c.sweep) {
            body.appendChild(field('Direction (° — 0 = est, 90 = sud) :',
                numberInput(c.direction, -360, 360, 5, val => { c.direction = val; Store.touch(); refresh(); })));
        }
        if (c.shape === 'cone') {
            body.appendChild(field('Ouverture (°) :',
                numberInput(c.angle, 10, 180, 5, val => { c.angle = val; Store.touch(); refresh(); })));
        }
        if (c.shape !== 'circle') {
            body.appendChild(field(c.shape === 'threshold' ? 'Profondeur (cases) :' : 'Portée (cases) :',
                numberInput(c.range, 0.5, 30, 0.5, val => { c.range = val; Store.touch(); refresh(); })));
        }
        if (['beam', 'rectangle', 'threshold'].includes(c.shape)) {
            body.appendChild(field('Largeur (cases) :',
                numberInput(c.width, 0.25, 20, 0.25, val => { c.width = val; Store.touch(); refresh(); })));
        }
        if (c.shape === 'circle') {
            body.appendChild(field('Rayon (cases) :',
                numberInput(c.radius, 0.5, 30, 0.5, val => { c.radius = val; Store.touch(); refresh(); })));
        }

        if (def.canSweep && directional) {
            body.appendChild(checkboxField('Balayage', !!c.sweep, enabled => {
                Store.setCoverageSweep(ent, enabled);
                refresh();
                render();
            }));
        }

        if (c.sweep) {
            const row = document.createElement('div');
            row.className = 'btn-row';
            const fromWrap = field('De (°) :', numberInput(c.sweep.from, -360, 360, 5, val => { c.sweep.from = val; Store.touch(); }));
            const toWrap = field('À (°) :', numberInput(c.sweep.to, -360, 360, 5, val => { c.sweep.to = val; Store.touch(); }));
            row.appendChild(fromWrap);
            row.appendChild(toWrap);
            body.appendChild(row);
            body.appendChild(field('Période (s, aller-retour) :',
                numberInput(c.sweep.period, 1, 60, 1, val => { c.sweep.period = val; Store.touch(); })));
        }

        // Révélé indépendamment de l'entité : caméra connue ≠ couverture connue.
        body.appendChild(revealToggle('Couverture', c, refresh));

        const coverageActions = document.createElement('div');
        coverageActions.className = 'btn-row';
        coverageActions.appendChild(secondaryButton('↺ Valeurs par défaut', () => {
            Store.resetCoverage(ent);
            refresh();
            render();
        }));
        coverageActions.appendChild(secondaryButton('✖ Supprimer', () => {
            Store.clearCoverage(ent);
            refresh();
            render();
        }));
        body.appendChild(coverageActions);
    }

    /* --- Décor --- */
    function renderDecor(body, decor) {
        if (!decor) { Store.ui.selection = null; return render(); }
        const definition = DecorCatalog.get(decor.type);
        const type = document.createElement('span');
        type.className = 'ins-type-badge';
        type.textContent = definition.name.toUpperCase();
        type.style.color = definition.color;
        body.appendChild(field('Type de décor :', type));
        appendDiscoveryOrigin(body, 'decor', decor);

        const refresh = () => {
            Store.touch();
            MapView.render();
            Visibility.render();
        };
        const fitToGrid = () => {
            const grid = Store.getPlan().grid;
            const quarterTurn = Math.abs(Math.round(decor.rotation / 90)) % 2 === 1;
            const halfWidth = (quarterTurn ? decor.height : decor.width) / 2;
            const halfHeight = (quarterTurn ? decor.width : decor.height) / 2;
            decor.x = Math.min(Math.max(decor.x, halfWidth), Math.max(halfWidth, grid.cols - halfWidth));
            decor.y = Math.min(Math.max(decor.y, halfHeight), Math.max(halfHeight, grid.rows - halfHeight));
        };

        body.appendChild(field('Nom :', textInput(decor.name, value => {
            decor.name = value;
            Store.touch();
            MapView.renderDecors();
            Visibility.render();
        })));
        body.appendChild(field('Largeur (cases) :',
            numberInput(decor.width, 0.5, Store.getPlan().grid.cols, 0.25, value => {
                decor.width = value; fitToGrid(); refresh();
            })));
        body.appendChild(field('Hauteur (cases) :',
            numberInput(decor.height, 0.25, Store.getPlan().grid.rows, 0.25, value => {
                decor.height = value; fitToGrid(); refresh();
            })));
        body.appendChild(field('Rotation :', selectInput({
            0: '0°', 90: '90°', 180: '180°', 270: '270°'
        }, String(((decor.rotation % 360) + 360) % 360), value => {
            decor.rotation = Number(value); fitToGrid(); refresh();
        })));

        body.appendChild(checkboxField('Bloque le déplacement', decor.blocksMovement, value => {
            decor.blocksMovement = value;
            refresh();
        }));
        body.appendChild(sectionTitle('Canaux bloqués'));
        const channelLabels = {
            optical: 'Optique', infrared: 'Infrarouge', laser: 'Laser',
            magnetic: 'Magnétique', pressure: 'Pression', astral: 'Astral'
        };
        Object.entries(channelLabels).forEach(([channel, label]) => {
            body.appendChild(checkboxField(label, decor.blocksVision.includes(channel), enabled => {
                if (enabled && !decor.blocksVision.includes(channel)) decor.blocksVision.push(channel);
                if (!enabled) decor.blocksVision = decor.blocksVision.filter(value => value !== channel);
                refresh();
            }));
        });

        const privateNote = document.createElement('textarea');
        privateNote.value = decor.privateNote || '';
        privateNote.placeholder = 'Informations réservées au MJ…';
        privateNote.addEventListener('input', () => { decor.privateNote = privateNote.value; Store.touch(); });
        groupContinuousInput(privateNote, 'Modifier une note privée');
        body.appendChild(field('Note privée MJ :', privateNote));

        const playerInfo = document.createElement('textarea');
        playerInfo.value = decor.playerInfo || '';
        playerInfo.placeholder = 'Information visible après révélation…';
        playerInfo.addEventListener('input', () => { decor.playerInfo = playerInfo.value; Store.touch(); });
        groupContinuousInput(playerInfo, 'Modifier une information joueur');
        body.appendChild(field('Information joueurs :', playerInfo));

        body.appendChild(checkboxField('Découverte automatique', decor.autoDiscover !== false, value => {
            decor.autoDiscover = value;
            Store.touch();
        }));
        body.appendChild(revealToggle('Décor', decor, () => MapView.render()));
        body.appendChild(sep());
        const actions = document.createElement('div');
        actions.className = 'btn-row';
        actions.appendChild(secondaryButton('Dupliquer', () => {
            const copy = Store.duplicateDecor(decor);
            Store.ui.selection = { kind: 'decor', id: copy.id };
            App.renderAll();
        }));
        actions.appendChild(dangerButton('Supprimer', deleteSelectedDecor));
        body.appendChild(actions);
    }

    /* --- Pièce --- */
    function renderRoom(body, room) {
        if (!room) { Store.ui.selection = null; return render(); }

        const type = document.createElement('span');
        type.className = 'ins-type-badge';
        type.textContent = 'PIÈCE';
        type.style.color = `hsl(${room.hue}, 80%, 65%)`;
        body.appendChild(field('Type :', type));
        appendDiscoveryOrigin(body, 'room', room);

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
        appendDiscoveryOrigin(body, 'floor', floor);

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

    /* --- Pions PJ (stockés séparément du plan pour permettre les déplacements joueurs) --- */
    function renderToken(body, token) {
        if (!token) { Store.ui.selection = null; return render(); }
        const save = (rerenderAll = false) => {
            Store.saveToken(token);
            if (rerenderAll) App.renderAll();
            else MapView.renderTokens();
        };

        const badge = document.createElement('span');
        badge.className = 'ins-type-badge';
        badge.textContent = 'PION PERSONNAGE';
        badge.style.color = token.color;
        body.appendChild(field('Type :', badge));
        body.appendChild(field('Nom :', textInput(token.name, value => { token.name = value; save(); })));
        body.appendChild(field('Libellé court :', textInput(token.shortLabel, value => {
            token.shortLabel = value.slice(0, 4).toUpperCase(); save();
        })));
        body.appendChild(field('Couleur :', colorInput(token.color, value => {
            token.color = value; badge.style.color = value; save();
        })));
        body.appendChild(field('Icône :', selectInput({
            runner: 'Runner',
            'street-samurai': 'Samouraï des rues',
            rigger: 'Rigger',
            decker: 'Decker',
            technomancer: 'Technomancien',
            'mystic-adept': 'Adepte mystique',
            mage: 'Mage',
            face: 'Face',
            infiltrator: 'Infiltrateur'
        }, token.icon, value => { token.icon = value; save(); })));

        const floorOptions = {};
        Store.sortedFloors().forEach(floor => floorOptions[floor.id] = floor.name);
        body.appendChild(field('Étage :', selectInput(floorOptions, token.floorId, value => {
            token.floorId = value; save(true);
        })));
        body.appendChild(checkboxField('Déplaçable par les joueurs', token.playerMovable, value => {
            token.playerMovable = value; save();
        }));
        body.appendChild(checkboxField('Verrouiller temporairement', token.locked, value => {
            token.locked = value; save();
        }));
        body.appendChild(checkboxField('Visible des joueurs', token.visible, value => {
            token.visible = value; save(); Visibility.render();
        }));

        const buttons = document.createElement('div');
        buttons.className = 'btn-row';
        buttons.appendChild(secondaryButton('Dupliquer', () => {
            const copy = Store.duplicateToken(token);
            Store.ui.selection = { kind: 'token', id: copy.id };
            App.renderAll();
        }));
        buttons.appendChild(dangerButton('Supprimer', deleteSelectedToken));
        body.appendChild(sep());
        body.appendChild(buttons);
    }

    function transitionTypeLabels() {
        return {
            stairs: 'Escalier', elevator: 'Ascenseur', ladder: 'Échelle',
            hatch: 'Trappe', passage: 'Passage'
        };
    }

    /* --- Transitions multi-étages --- */
    function stairsDirectionLabels() {
        return { both: 'Monte et descend', up: 'Monte uniquement', down: 'Descend uniquement' };
    }

    function cabinDoorSideLabels() {
        return { north: 'Nord', south: 'Sud', east: 'Est', west: 'Ouest' };
    }

    function renderTransition(body, transition) {
        if (!transition) { Store.ui.selection = null; return render(); }
        const refresh = (full = false) => {
            Store.touch();
            if (full) App.renderAll(); else { MapView.renderTransitions(); Visibility.render(); }
        };
        const badge = document.createElement('span');
        badge.className = 'ins-type-badge';
        badge.textContent = 'TRANSITION MULTI-ÉTAGES';
        body.appendChild(field('Type :', badge));
        appendDiscoveryOrigin(body, 'transition', transition);
        body.appendChild(field('Nom :', textInput(transition.name, value => {
            transition.name = value; refresh();
        })));
        body.appendChild(field('Nature :', selectInput(transitionTypeLabels(), transition.type, value => {
            if (!Store.setTransitionType(transition, value)) {
                alert('Un escalier relie exactement deux endpoints : retire des points de passage avant de changer la nature.');
            }
            App.renderAll();
        })));
        body.appendChild(field('État :', selectInput({ active: 'Active', offline: 'Hors ligne' },
            transition.state, value => { transition.state = value; refresh(); })));
        if (transition.type === 'stairs') {
            // 7.9 : le sens remplace « bidirectionnelle » pour les escaliers.
            body.appendChild(field('Sens :', selectInput(stairsDirectionLabels(),
                transition.direction, value => {
                    Store.setStairsDirection(transition, value);
                    App.renderAll();
                })));
        } else {
            body.appendChild(checkboxField('Bidirectionnelle', transition.bidirectional, value => {
                transition.bidirectional = value; refresh();
            }));
        }
        body.appendChild(revealToggle('Transition', transition, () => {
            MapView.renderTransitions(); Visibility.render();
        }));

        const accessOptions = { '': '[Aucun verrou associé]' };
        Store.getPlan().entities.filter(entity => EntityCatalog.get(entity.type).accessControl)
            .forEach(entity => accessOptions[entity.id] = entity.name);
        body.appendChild(field("Contrôle d'accès :", selectInput(accessOptions,
            transition.accessEntityId || '', value => {
                transition.accessEntityId = value; refresh();
            })));

        if (transition.type === 'elevator') renderElevatorSections(body, transition);

        body.appendChild(sep());
        body.appendChild(sectionTitle('Points de passage'));
        transition.endpoints.forEach((endpoint, index) => {
            const floor = Store.findFloor(endpoint.floorId);
            const line = document.createElement('div');
            line.className = 'btn-row transition-endpoint-row';
            const name = document.createElement('span');
            name.textContent = (index + 1) + '. ' + (floor ? floor.name : 'Étage inconnu')
                + ' · ' + endpoint.x + ',' + endpoint.y;
            line.appendChild(name);
            if (transition.type === 'elevator') {
                // 7.8 : sans porte, pas d'arrêt — mais la gaine occupe l'étage.
                line.appendChild(checkboxField('Porte', endpoint.hasDoor !== false, value => {
                    endpoint.hasDoor = value;
                    Store.touch('Modifier une porte d\'ascenseur');
                    App.renderAll();
                }));
            }
            line.appendChild(secondaryButton('Retirer', () => {
                Store.removeTransitionEndpoint(transition, endpoint.id);
                if (!Store.findTransition(transition.id)) Store.ui.selection = null;
                App.renderAll();
            }));
            body.appendChild(line);
        });
        if (transition.type === 'stairs' && transition.endpoints.length >= 2) {
            const note = document.createElement('div');
            note.className = 'inspector-hint';
            note.textContent = 'Un escalier relie exactement deux endpoints.';
            body.appendChild(note);
        } else {
            body.appendChild(secondaryButton('+ Ajouter un point sur la carte', () => {
                Editor.startTransitionEndpoint(transition.id);
            }));
        }
        body.appendChild(sep());
        body.appendChild(dangerButton('Supprimer la transition', deleteSelectedTransition));
    }

    /* 7.8 : géométrie de la gaine (unique pour toute la liaison) et bornes
       de desserte de l'ascenseur. */
    function renderElevatorSections(body, transition) {
        body.appendChild(sep());
        body.appendChild(sectionTitle('Cabine (commune à tous les étages)'));
        body.appendChild(field('Largeur :', numberInput(transition.cabin.width, 0.5, 8, 0.5, value => {
            transition.cabin.width = value; Store.touch(); App.renderAll();
        })));
        body.appendChild(field('Hauteur :', numberInput(transition.cabin.height, 0.5, 8, 0.5, value => {
            transition.cabin.height = value; Store.touch(); App.renderAll();
        })));
        body.appendChild(field('Rotation :', selectInput({ 0: '0°', 90: '90°', 180: '180°', 270: '270°' },
            String(((transition.cabin.rotation % 360) + 360) % 360), value => {
                transition.cabin.rotation = Number(value); Store.touch(); App.renderAll();
            })));
        body.appendChild(field('Porte côté :', selectInput(cabinDoorSideLabels(),
            transition.cabin.doorSide, value => {
                transition.cabin.doorSide = value; Store.touch(); App.renderAll();
            })));

        body.appendChild(sep());
        body.appendChild(sectionTitle('Desserte'));
        const floors = Store.sortedFloors();
        const boundField = (label, which) => {
            const autoLabel = which === 'min'
                ? 'Auto (premier étage du plan)' : 'Auto (dernier étage du plan)';
            const options = { auto: autoLabel };
            floors.forEach(floor => options[String(floor.order)] = floor.name);
            const current = which === 'min' ? transition.minFloorOrder : transition.maxFloorOrder;
            body.appendChild(field(label, selectInput(options,
                current === null || current === undefined ? 'auto' : String(current), value => {
                    const order = value === 'auto' ? null : Number(value);
                    // Resserrer une borne supprime les arrêts hors plage,
                    // après confirmation explicite (7.10).
                    const dropped = Store.elevatorEndpointsOutOfRange(transition, which, order);
                    if (dropped.length) {
                        const lines = dropped.map(endpoint => {
                            const floor = Store.findFloor(endpoint.floorId);
                            return '— L\'arrêt « ' + (floor ? floor.name : 'Étage inconnu')
                                + ' » sera supprimé de cet ascenseur.';
                        }).join('\n');
                        if (!confirm('Resserrer la desserte ?\n\n' + lines)) {
                            return render();
                        }
                    }
                    Store.setElevatorBound(transition, which, order);
                    if (!Store.findTransition(transition.id)) Store.ui.selection = null;
                    App.renderAll();
                })));
        };
        boundField('Étage min :', 'min');
        boundField('Étage max :', 'max');
        if (transition.endpoints.length > 0) {
            body.appendChild(secondaryButton('+ Créer les arrêts manquants (porte partout)', () => {
                const added = Store.populateElevatorStops(transition);
                App.renderAll();
                Editor.setTicker(added
                    ? 'DESSERTE COMPLÉTÉE // ' + added + ' ARRÊT(S) AJOUTÉ(S)'
                    : 'DESSERTE DÉJÀ COMPLÈTE');
            }));
        }
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

    function deleteSelectedDecor() {
        const sel = Store.ui.selection;
        if (!sel || sel.kind !== 'decor') return;
        Store.deleteDecor(sel.id);
        Store.ui.selection = null;
        MapView.render();
        Visibility.render();
        render();
    }

    function deleteSelectedToken() {
        const sel = Store.ui.selection;
        if (!sel || sel.kind !== 'token') return;
        Store.deleteToken(sel.id);
        Store.ui.selection = null;
        App.renderAll();
    }

    function deleteSelectedTransition() {
        const sel = Store.ui.selection;
        if (!sel || sel.kind !== 'transition') return;
        Store.deleteTransition(sel.id);
        Store.ui.selection = null;
        App.renderAll();
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
        groupContinuousInput(input, 'Modifier une valeur');
        return input;
    }

    function selectInput(options, value, onChange) {
        const select = document.createElement('select');
        Object.entries(options).forEach(([optionValue, label]) => {
            const option = document.createElement('option');
            option.value = optionValue;
            option.textContent = label;
            option.selected = optionValue === value;
            select.appendChild(option);
        });
        select.addEventListener('change', () => onChange(select.value));
        return select;
    }

    function colorInput(value, onChange) {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#00d2ff';
        input.addEventListener('input', () => onChange(input.value));
        groupContinuousInput(input, 'Modifier une couleur');
        return input;
    }

    function groupContinuousInput(input, label) {
        input.addEventListener('focus', () => Store.beginTransaction(label));
        input.addEventListener('blur', () => Store.endTransaction());
        return input;
    }

    /* Toggle 👁 Révélé / Caché — `obj` porte un flag `revealed`
       (entité, pièce, étage, mais aussi ronde ou couverture). */
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

    return { render, deleteSelectedEntity, deleteSelectedRoom, deleteSelectedDecor,
        deleteSelectedToken, deleteSelectedTransition };
})();

/* ============================================================
   main.js — Bootstrap : chargement du plan, wiring, rendu,
   et (phase 3) branchement Firebase : auth Google → bascule
   admin/joueur, onSnapshot temps réel, migration du plan
   localStorage → Firestore au premier login admin.
   ============================================================ */

const App = (() => {

    let isAdmin = false;             // session admin confirmée (email === ADMIN_EMAIL)
    let remoteExists = null;         // null = inconnu, false = doc absent, true = doc présent
    let floorBeforePreview = null;   // étage restauré en sortant de la prévisualisation
    let authResolved = false;
    let pendingRemoteSnapshot = null;
    let pendingRemoteTokens = null;
    let pendingRemoteDiscoveries = null;
    let tokenBootstrapResolved = false;
    let discoveryBootstrapResolved = false;
    let collectionBootstrapAllowed = false;
    let lastPlayerView = null;

    function renderAll() {
        Store.ensureVisibleView();
        updateViewChrome();
        Editor.renderTabs();
        Editor.renderTools();
        MapView.render();
        Inspector.render();
        Visibility.render();
    }

    /* Classes du body + bouton de prévisualisation selon la vue courante */
    function updateViewChrome() {
        const playerView = Store.isPlayerView();
        document.body.classList.toggle('player-mode', playerView);
        document.body.classList.toggle('preview-mode', Store.ui.preview);
        if (lastPlayerView !== null && lastPlayerView !== playerView) closeDrawers();
        lastPlayerView = playerView;
        const btn = document.getElementById('preview-btn');
        if (btn) {
            btn.style.display = Store.ui.readOnly ? 'none' : '';
            btn.textContent = Store.ui.preview ? '✏ Retour édition' : '👁 Vue joueurs';
        }
        const importBtn = document.getElementById('import-btn');
        if (importBtn) importBtn.style.display = Store.ui.readOnly ? 'none' : '';
        const snapshotBtn = document.getElementById('snapshot-btn');
        if (snapshotBtn) snapshotBtn.style.display = Store.ui.readOnly ? 'none' : '';
        const snapshotPanel = document.getElementById('snapshot-panel');
        if (snapshotPanel && Store.ui.readOnly) snapshotPanel.hidden = true;
        updateOverlayControls();
        updateHistoryControls();
    }

    function updateOverlayControls() {
        const preferences = Store.getOverlayPreferences();
        const controls = {
            'toggle-coverages': preferences.coverages,
            'toggle-network-links': preferences.networkLinks
        };
        Object.entries(controls).forEach(([id, visible]) => {
            const button = document.getElementById(id);
            if (!button) return;
            button.setAttribute('aria-pressed', visible ? 'true' : 'false');
        });
    }

    function wireOverlayControls() {
        const bindings = {
            'toggle-coverages': 'coverages',
            'toggle-network-links': 'networkLinks'
        };
        Object.entries(bindings).forEach(([id, key]) => {
            const button = document.getElementById(id);
            if (!button) return;
            button.addEventListener('click', () => {
                const next = !Store.getOverlayPreferences()[key];
                Store.setOverlayVisibility(key, next);
                updateOverlayControls();
                MapView.renderOverlay();
            });
        });
        updateOverlayControls();
    }

    function updateHistoryControls() {
        const state = Store.getHistoryState();
        const undo = document.getElementById('undo-btn');
        const redo = document.getElementById('redo-btn');
        if (undo) {
            undo.disabled = !state.canUndo;
            undo.title = state.canUndo ? 'Annuler : ' + state.undoLabel : 'Rien à annuler';
        }
        if (redo) {
            redo.disabled = !state.canRedo;
            redo.title = state.canRedo ? 'Rétablir : ' + state.redoLabel : 'Rien à rétablir';
        }
    }

    function wireHistoryControls() {
        const undo = document.getElementById('undo-btn');
        const redo = document.getElementById('redo-btn');
        if (undo) undo.addEventListener('click', () => Editor.applyHistory('undo'));
        if (redo) redo.addEventListener('click', () => Editor.applyHistory('redo'));
        document.addEventListener('history-change', updateHistoryControls);
        updateHistoryControls();
    }

    function wireInspectorDrawer() {
        const playerToggle = document.getElementById('player-inspector-toggle');
        const toolsToggle = document.getElementById('tools-toggle');
        const inspectorToggle = document.getElementById('inspector-toggle');
        const toolsClose = document.getElementById('tools-close');
        const inspectorClose = document.getElementById('inspector-close');
        const backdrop = document.getElementById('panel-backdrop');
        if (playerToggle) playerToggle.addEventListener('click', () => toggleDrawer('inspector'));
        if (toolsToggle) toolsToggle.addEventListener('click', () => toggleDrawer('tools'));
        if (inspectorToggle) inspectorToggle.addEventListener('click', () => toggleDrawer('inspector'));
        if (toolsClose) toolsClose.addEventListener('click', closeDrawers);
        if (inspectorClose) inspectorClose.addEventListener('click', closeDrawers);
        if (backdrop) backdrop.addEventListener('click', closeDrawers);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape'
                && (document.body.classList.contains('tools-open')
                    || document.body.classList.contains('inspector-open'))) {
                closeDrawers();
            }
        });
        updateDrawerControls();
    }

    function updateDrawerControls() {
        const toolsOpen = document.body.classList.contains('tools-open');
        const inspectorOpen = document.body.classList.contains('inspector-open');
        const toolsToggle = document.getElementById('tools-toggle');
        const inspectorToggle = document.getElementById('inspector-toggle');
        const playerToggle = document.getElementById('player-inspector-toggle');
        if (toolsToggle) toolsToggle.setAttribute('aria-expanded', toolsOpen ? 'true' : 'false');
        if (inspectorToggle) inspectorToggle.setAttribute('aria-expanded', inspectorOpen ? 'true' : 'false');
        if (playerToggle) playerToggle.setAttribute('aria-expanded', inspectorOpen ? 'true' : 'false');
    }

    function closeDrawers() {
        document.body.classList.remove('tools-open', 'inspector-open');
        updateDrawerControls();
    }

    function openInspectorDrawer() {
        document.body.classList.remove('tools-open');
        document.body.classList.add('inspector-open');
        updateDrawerControls();
    }

    function toggleDrawer(name) {
        const className = name === 'tools' ? 'tools-open' : 'inspector-open';
        const open = !document.body.classList.contains(className);
        closeDrawers();
        if (open) document.body.classList.add(className);
        updateDrawerControls();
    }

    /* --- Prévisualisation MJ : le plan filtré comme le voient les joueurs --- */
    function togglePreview() {
        if (!Store.ui.preview) {
            floorBeforePreview = Store.ui.currentFloorId;
            Store.ui.preview = true;
            if (Store.ui.activeTool !== 'select') {
                Store.ui.activeTool = 'select';
                Store.ui.patrolEditId = null;
            }
            Editor.setTicker('PRÉVISUALISATION // CE QUE VOIENT LES JOUEURS');
        } else {
            Store.ui.preview = false;
            if (floorBeforePreview && Store.findFloor(floorBeforePreview)) {
                Store.ui.currentFloorId = floorBeforePreview;
            }
            Editor.setTicker('MODE ÉDITION // PLAN COMPLET');
        }
        renderAll();
    }

    /* --- Bascule admin / joueur --- */
    function setAdminMode(admin) {
        isAdmin = admin;
        Store.ui.readOnly = !admin;
        if (!admin) Store.ui.preview = false;
        if (Store.isPlayerView() && Store.ui.activeTool !== 'select') {
            Store.ui.activeTool = 'select';
            Store.ui.patrolEditId = null;
        }
        renderAll();
    }

    function updateAuthUi(user) {
        const btn = document.getElementById('auth-btn');
        const chip = document.getElementById('auth-user');
        if (!btn) return;
        btn.style.display = '';
        if (user) {
            btn.textContent = '🔓 Déconnexion';
            chip.textContent = user.email;
        } else {
            btn.textContent = '🔑 Admin';
            chip.textContent = '';
        }
    }

    function wireAuthButton() {
        const btn = document.getElementById('auth-btn');
        btn.addEventListener('click', () => {
            if (btn.textContent.includes('Déconnexion')) {
                Cloud.logout();
                return;
            }
            Cloud.login().catch(e => {
                console.warn('Login annulé ou refusé', e);
                Editor.setTicker('LOGIN ANNULÉ // ' + (e.code || e.message || ''));
            });
        });
    }

    function showConflictPanel() {
        const panel = document.getElementById('conflict-panel');
        if (panel) panel.hidden = false;
    }

    function hideConflictPanel() {
        const panel = document.getElementById('conflict-panel');
        if (panel) panel.hidden = true;
    }

    function downloadLocalPlan() {
        const blob = new Blob([Store.exportJson()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const date = new Date().toISOString().replace(/[:.]/g, '-');
        link.href = url;
        link.download = 'shadowrunbank-plan-local-' + date + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function wireConflictPanel() {
        const useRemote = document.getElementById('conflict-use-remote');
        const exportLocal = document.getElementById('conflict-export-local');
        const forceLocal = document.getElementById('conflict-force-local');
        if (!useRemote || !exportLocal || !forceLocal) return;

        useRemote.addEventListener('click', () => {
            if (Store.resolveConflictWithRemote()) {
                hideConflictPanel();
                renderAll();
                Store.setSaveStatus('saved', '☁ Version distante chargée');
                Editor.setTicker('CONFLIT RÉSOLU // VERSION DISTANTE CHARGÉE');
            }
        });
        exportLocal.addEventListener('click', downloadLocalPlan);
        forceLocal.addEventListener('click', () => {
            if (!confirm('Remplacer la version distante par cette version locale ?')) return;
            hideConflictPanel();
            Editor.setTicker('RÉSOLUTION DU CONFLIT // ÉCRITURE FORCÉE');
            Store.resolveConflictWithLocal();
        });
        document.addEventListener('plan-save-conflict', showConflictPanel);
    }

    function wireExportButton() {
        const button = document.getElementById('export-btn');
        if (button) button.addEventListener('click', downloadLocalPlan);
    }

    function wireSnapshotButton() {
        const button = document.getElementById('snapshot-btn');
        const panel = document.getElementById('snapshot-panel');
        const create = document.getElementById('snapshot-create');
        const refresh = document.getElementById('snapshot-refresh');
        const close = document.getElementById('snapshot-close');
        const localList = document.getElementById('snapshot-local-list');
        const cloudList = document.getElementById('snapshot-cloud-list');
        if (!button || !panel || !create || !refresh || !close || !localList || !cloudList) return;

        function formatDate(value) {
            if (!value) return 'date inconnue';
            return new Intl.DateTimeFormat('fr-FR', {
                dateStyle: 'short', timeStyle: 'medium'
            }).format(new Date(value));
        }

        function emptyList(container, text) {
            container.replaceChildren();
            const empty = document.createElement('div');
            empty.className = 'snapshot-empty';
            empty.textContent = text;
            container.appendChild(empty);
        }

        function addSnapshotRow(container, snapshot, handlers) {
            const row = document.createElement('div');
            row.className = 'snapshot-row';
            const info = document.createElement('div');
            info.className = 'snapshot-row-info';
            const name = document.createElement('b');
            name.textContent = snapshot.label;
            const meta = document.createElement('small');
            meta.textContent = formatDate(snapshot.createdAt)
                + (snapshot.sourceRevision === undefined ? '' : ' · rév. ' + snapshot.sourceRevision);
            info.append(name, meta);

            const restore = document.createElement('button');
            restore.className = 'btn-secondary';
            restore.textContent = 'Restaurer';
            restore.disabled = snapshot.valid === false || !snapshot.plan;
            restore.addEventListener('click', handlers.restore);

            const remove = document.createElement('button');
            remove.className = 'btn-secondary snapshot-delete';
            remove.textContent = 'Suppr.';
            remove.addEventListener('click', handlers.remove);
            row.append(info, restore, remove);
            container.appendChild(row);
        }

        async function refreshLists() {
            const local = Store.listBackups();
            localList.replaceChildren();
            if (!local.length) emptyList(localList, 'Aucune version locale.');
            local.forEach(snapshot => addSnapshotRow(localList, snapshot, {
                restore: () => {
                    if (!confirm('Restaurer cette version locale ? La version actuelle sera sauvegardée.')) return;
                    if (!Store.restoreBackup(snapshot.key)) {
                        alert('Cette version locale est illisible.');
                        return;
                    }
                    renderAll();
                    refreshLists();
                    Editor.setTicker('VERSION LOCALE RESTAURÉE // ' + snapshot.label.toUpperCase());
                },
                remove: () => {
                    if (!confirm('Supprimer définitivement cette version locale ?')) return;
                    Store.deleteBackup(snapshot.key);
                    refreshLists();
                }
            }));

            if (!Store.isCloudActive() || !window.Cloud
                || typeof window.Cloud.listSnapshots !== 'function') {
                emptyList(cloudList, 'Cloud indisponible — les versions locales restent accessibles.');
                return;
            }
            emptyList(cloudList, 'Chargement…');
            try {
                const remote = await window.Cloud.listSnapshots();
                cloudList.replaceChildren();
                if (!remote.length) emptyList(cloudList, 'Aucune version cloud.');
                remote.forEach(snapshot => addSnapshotRow(cloudList, snapshot, {
                    restore: () => {
                        if (!snapshot.plan) return;
                        if (!confirm('Restaurer cette version cloud ? La version actuelle sera sauvegardée.')) return;
                        const restored = JSON.parse(JSON.stringify(snapshot.plan));
                        restored.revision = Number.isInteger(Store.getPlan().revision)
                            ? Store.getPlan().revision : 0;
                        Store.backupCurrentPlan('avant-restauration-cloud');
                        Store.replacePlan(restored);
                        renderAll();
                        refreshLists();
                        Editor.setTicker('VERSION CLOUD RESTAURÉE // ' + snapshot.label.toUpperCase());
                    },
                    remove: async () => {
                        if (!confirm('Supprimer définitivement cette version cloud ?')) return;
                        await window.Cloud.deleteSnapshot(snapshot.id);
                        refreshLists();
                    }
                }));
            } catch (error) {
                console.error('Lecture des snapshots impossible', error);
                emptyList(cloudList, 'Versions cloud indisponibles pour le moment.');
            }
        }

        button.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) refreshLists();
        });
        close.addEventListener('click', () => { panel.hidden = true; });
        refresh.addEventListener('click', refreshLists);
        create.addEventListener('click', async () => {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const label = 'manuel-' + stamp;
            create.disabled = true;
            Store.backupCurrentPlan(label);
            try {
                if (Store.isCloudActive() && window.Cloud
                    && typeof window.Cloud.createSnapshot === 'function') {
                    const result = await window.Cloud.createSnapshot(Store.getPlan(), label);
                    Editor.setTicker('SNAPSHOT FIRESTORE CRÉÉ // ' + result.id);
                } else {
                    Editor.setTicker('SNAPSHOT LOCAL CRÉÉ // ' + label.toUpperCase());
                }
            } catch (error) {
                console.error('Création du snapshot impossible', error);
                Editor.setTicker('SNAPSHOT CLOUD REFUSÉ // COPIE LOCALE CONSERVÉE');
                alert('Le snapshot Firestore a échoué. Une copie locale a été conservée.');
            } finally {
                create.disabled = false;
                refreshLists();
            }
        });
    }

    function wireImportButton() {
        const button = document.getElementById('import-btn');
        const input = document.getElementById('import-file');
        if (!button || !input) return;

        button.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const source = JSON.parse(await file.text());
                const prepared = Store.preparePlan(source);
                const candidate = prepared.plan;
                const summary = [
                    'Plan : ' + candidate.name,
                    'Schéma source : v' + prepared.migratedFrom + ' → v' + candidate.schemaVersion,
                    candidate.floors.length + ' étage(s)',
                    candidate.rooms.length + ' pièce(s)',
                    candidate.entities.length + ' dispositif(s)',
                    candidate.decors.length + ' décor(s)',
                    '',
                    'Remplacer le plan local actuel par cet import ?'
                ].join('\n');
                if (!confirm(summary)) return;

                Store.backupCurrentPlan('avant_import');
                Store.replacePlan(candidate);
                hideConflictPanel();
                renderAll();
                Editor.setTicker('IMPORT JSON VALIDÉ // SAUVEGARDE EN ATTENTE');
            } catch (error) {
                console.error('Import JSON refusé', error);
                alert('Import impossible : ' + (error.message || 'fichier JSON invalide'));
            } finally {
                input.value = '';
            }
        });
    }

    function setRetryCloudVisible(visible) {
        const button = document.getElementById('retry-cloud-btn');
        if (button) button.hidden = !visible;
    }

    function wireRetryCloudButton() {
        const button = document.getElementById('retry-cloud-btn');
        if (!button) return;
        button.addEventListener('click', () => {
            Store.handlePageHide();
            button.disabled = true;
            button.textContent = '↻ Reconnexion…';
            Editor.setTicker('RECONNEXION CLOUD // RECHARGEMENT SÉCURISÉ');
            window.location.reload();
        });
        document.addEventListener('plan-save-offline', () => setRetryCloudVisible(true));
        document.addEventListener('plan-save-synced', () => setRetryCloudVisible(false));
    }

    /* --- Réception d'un snapshot Firestore --- */
    function processRemotePlan(remote) {
        if (!remote) {
            remoteExists = false;
            collectionBootstrapAllowed = true;
            // Migration : le doc n'existe pas encore et on est admin → on pousse le plan local
            if (isAdmin) {
                Store.saveNow();
                Editor.setTicker('MIGRATION // PLAN LOCAL POUSSÉ VERS FIRESTORE');
            } else {
                Store.setSaveStatus('saved', '📡 Connecté — plan pas encore publié');
            }
            return;
        }

        remoteExists = true;
        collectionBootstrapAllowed = remote.schemaVersion !== 2;
        let normalizedRemote;
        try {
            normalizedRemote = Store.preparePlan(remote).plan;
        } catch (error) {
            console.error('Plan Firestore invalide — version locale conservée', error);
            Store.setSaveStatus('error', '⚠ Plan distant invalide');
            Editor.setTicker('PLAN DISTANT INVALIDE // VERSION LOCALE CONSERVÉE');
            return;
        }

        const local = Store.getPlan();
        const localRevision = Number.isInteger(local.revision) ? local.revision : 0;
        const remoteRevision = normalizedRemote.revision;

        if (isAdmin && Store.hasPendingChanges()) {
            if (remoteRevision !== localRevision
                || normalizedRemote.updatedAt > local.updatedAt) {
                Store.markRemoteConflict(normalizedRemote);
                Editor.setTicker('CONFLIT // MODIFICATION DISTANTE DÉTECTÉE');
            } else {
                Store.saveNow();
            }
            return;
        }

        if (isAdmin && (remoteRevision < localRevision
            || (remoteRevision === localRevision && normalizedRemote.updatedAt <= local.updatedAt))) {
            Store.setSaveStatus('saved', '☁ Synchronisé — r' + localRevision);
            return;
        }

        if (!isAdmin && Store.hasPendingChanges()) {
            Store.backupCurrentPlan('avant_synchro_joueur');
        }

        Store.applyRemotePlan(normalizedRemote);
        hideConflictPanel();
        setRetryCloudVisible(false);
        renderAll();
        Store.setSaveStatus('saved', isAdmin ? '☁ Synchronisé' : '📡 Synchronisé');
    }

    function onRemotePlan(remote, hasPendingWrites) {
        if (hasPendingWrites) return; // écho local de notre propre transaction
        if (!authResolved) {
            pendingRemoteSnapshot = { remote };
            return;
        }
        processRemotePlan(remote);
    }

    function processRemoteTokens(tokens) {
        const canBootstrap = !tokenBootstrapResolved;
        tokenBootstrapResolved = true;
        if (isAdmin && collectionBootstrapAllowed && canBootstrap
            && tokens.length === 0 && Store.getTokens().length > 0) {
            Store.getTokens().forEach(token => Cloud.saveToken(token));
            return;
        }
        Store.applyRemoteTokens(tokens);
        renderAll();
    }

    function processRemoteDiscoveries(discoveries) {
        const canBootstrap = !discoveryBootstrapResolved;
        discoveryBootstrapResolved = true;
        if (isAdmin && collectionBootstrapAllowed && canBootstrap
            && discoveries.length === 0 && Store.getDiscoveries().length > 0) {
            Store.getDiscoveries().forEach(discovery => Cloud.saveDiscovery(discovery));
            return;
        }
        Store.applyRemoteDiscoveries(discoveries);
        renderAll();
    }

    /* --- Branchement du cloud (appelé quand window.Cloud est disponible) --- */
    function wireCloud() {
        Store.setCloudActive(true);
        wireAuthButton();

        // Cloud actif → lecture seule par défaut, en attendant le verdict de watchAuth
        setAdminMode(false);
        Store.setSaveStatus('saving', '📡 Connexion au cloud…');

        Cloud.watchAuth(user => {
            if (user && !Cloud.isAdmin(user)) {
                alert('Compte non autorisé : ' + user.email + '\nSeul le MJ peut éditer le plan.');
                Cloud.logout();
                return;
            }
            const admin = Cloud.isAdmin(user);
            authResolved = true;
            updateAuthUi(user);
            const wasAdmin = isAdmin;
            setAdminMode(admin);
            Editor.setTicker(admin ? 'ACCÈS OVERLORD ACCORDÉ // MODE ÉDITION'
                                   : 'MODE JOUEUR // LECTURE SEULE TEMPS RÉEL');
            // Login admin après un premier snapshot "doc absent" → migration
            if (admin && !wasAdmin && remoteExists === false) {
                Store.saveNow();
                Editor.setTicker('MIGRATION // PLAN LOCAL POUSSÉ VERS FIRESTORE');
            }
            if (pendingRemoteSnapshot) {
                const pending = pendingRemoteSnapshot;
                pendingRemoteSnapshot = null;
                processRemotePlan(pending.remote);
            } else if (admin && Store.hasPendingChanges()) {
                Store.saveNow();
                Editor.setTicker('REPRISE // SAUVEGARDE LOCALE EN ATTENTE');
            }
            if (pendingRemoteTokens) {
                const pending = pendingRemoteTokens;
                pendingRemoteTokens = null;
                processRemoteTokens(pending);
            }
            if (pendingRemoteDiscoveries) {
                const pending = pendingRemoteDiscoveries;
                pendingRemoteDiscoveries = null;
                processRemoteDiscoveries(pending);
            }
        });

        Cloud.subscribePlan(onRemotePlan, err => {
            console.error('onSnapshot en échec — retour au mode local', err);
            Store.setCloudActive(false);
            setAdminMode(true); // pas de cloud → on retrouve l'éditeur local
            Store.setSaveStatus('error', '⚠ Cloud indisponible (mode local)');
            setRetryCloudVisible(true);
            Editor.setTicker('CLOUD INDISPONIBLE // VÉRIFIER RÈGLES FIRESTORE');
        });

        Cloud.subscribeTokens((tokens, hasPendingWrites) => {
            if (hasPendingWrites) return;
            if (!authResolved) { pendingRemoteTokens = tokens; return; }
            processRemoteTokens(tokens);
        }, err => {
            console.warn('Synchronisation des pions indisponible', err);
            Editor.setTicker('PIONS HORS-LIGNE // POSITIONS CONSERVÉES LOCALEMENT');
        });

        Cloud.subscribeDiscoveries((discoveries, hasPendingWrites) => {
            if (hasPendingWrites) return;
            if (!authResolved) { pendingRemoteDiscoveries = discoveries; return; }
            processRemoteDiscoveries(discoveries);
        }, err => {
            console.warn('Synchronisation des découvertes indisponible', err);
        });
    }

    function boot() {
        Store.load();
        Store.setSaveStatus('saved', '💾 Plan local chargé');

        Editor.wireBoard();
        Editor.wireKeyboard();
        Visibility.init();
        wireConflictPanel();
        wireExportButton();
        wireSnapshotButton();
        wireImportButton();
        wireRetryCloudButton();
        wireHistoryControls();
        wireInspectorDrawer();
        wireOverlayControls();

        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) previewBtn.addEventListener('click', togglePreview);

        window.addEventListener('resize', () => {
            if (window.innerWidth > 1600
                || (window.innerWidth > 1180 && window.innerHeight < window.innerWidth)) {
                closeDrawers();
            }
            MapView.render();
        });
        window.addEventListener('pagehide', Store.handlePageHide);

        renderAll();
        Anim.start();
        Editor.setTicker('SYSTEM_READY // PLAN OPÉRATIONNEL');

        // cloud.js (module) s'exécute avant DOMContentLoaded quand il charge ;
        // on couvre aussi le cas d'un chargement tardif ou absent (file://).
        if (window.Cloud) wireCloud();
        else document.addEventListener('cloud-ready', wireCloud, { once: true });
    }

    document.addEventListener('DOMContentLoaded', boot);

    return { renderAll, openInspectorDrawer, closeDrawers, isAdmin: () => isAdmin };
})();

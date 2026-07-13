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

    function renderAll() {
        Store.ensureVisibleView();
        updateViewChrome();
        Editor.renderTabs();
        Editor.renderTools();
        MapView.render();
        Inspector.render();
    }

    /* Classes du body + bouton de prévisualisation selon la vue courante */
    function updateViewChrome() {
        document.body.classList.toggle('player-mode', Store.isPlayerView());
        document.body.classList.toggle('preview-mode', Store.ui.preview);
        const btn = document.getElementById('preview-btn');
        if (btn) {
            btn.style.display = Store.ui.readOnly ? 'none' : '';
            btn.textContent = Store.ui.preview ? '✏ Retour édition' : '👁 Vue joueurs';
        }
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

    /* --- Réception d'un snapshot Firestore --- */
    function onRemotePlan(remote, hasPendingWrites) {
        if (hasPendingWrites) return; // écho local de notre propre setDoc

        if (!remote) {
            remoteExists = false;
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
        // Admin : n'écrase le plan local que si la version distante est plus récente
        // (édition depuis un autre poste). Joueur : adopte toujours la version distante.
        if (isAdmin && remote.updatedAt <= Store.getPlan().updatedAt) {
            Store.setSaveStatus('saved', '☁ Synchronisé');
            return;
        }

        Store.applyRemotePlan(remote);
        renderAll();
        Store.setSaveStatus('saved', isAdmin ? '☁ Synchronisé' : '📡 Synchronisé');
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
        });

        Cloud.subscribePlan(onRemotePlan, err => {
            console.error('onSnapshot en échec — retour au mode local', err);
            Store.setCloudActive(false);
            setAdminMode(true); // pas de cloud → on retrouve l'éditeur local
            Store.setSaveStatus('error', '⚠ Cloud indisponible (mode local)');
            Editor.setTicker('CLOUD INDISPONIBLE // VÉRIFIER RÈGLES FIRESTORE');
        });
    }

    function boot() {
        Store.load();
        Store.setSaveStatus('saved', '💾 Plan local chargé');

        Editor.wireBoard();
        Editor.wireKeyboard();

        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) previewBtn.addEventListener('click', togglePreview);

        window.addEventListener('resize', () => MapView.render());

        renderAll();
        Anim.start();
        Editor.setTicker('SYSTEM_READY // PLAN OPÉRATIONNEL');

        // cloud.js (module) s'exécute avant DOMContentLoaded quand il charge ;
        // on couvre aussi le cas d'un chargement tardif ou absent (file://).
        if (window.Cloud) wireCloud();
        else document.addEventListener('cloud-ready', wireCloud, { once: true });
    }

    document.addEventListener('DOMContentLoaded', boot);

    return { renderAll, isAdmin: () => isAdmin };
})();

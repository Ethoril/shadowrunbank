/* ============================================================
   store.js — État global, (dé)sérialisation, persistance.
   localStorage = cache local systématique ; si le cloud est
   actif (module cloud.js chargé) et que l'utilisateur est
   admin, chaque sauvegarde part aussi dans Firestore.
   ============================================================ */

const Store = (() => {
    const STORAGE_KEY = 'shadowrunbank_plan_v1';
    const MIGRATION_BACKUP_PREFIX = 'shadowrunbank_plan_backup_';
    const DIRTY_KEY = 'shadowrunbank_plan_dirty_v2';
    const TOKENS_KEY = 'shadowrunbank_tokens_v1';
    const DISCOVERIES_KEY = 'shadowrunbank_discoveries_v1';
    const OVERLAY_PREFS_KEY = 'shadowrunbank_overlay_preferences_v1';
    const INSPECTOR_STATE_KEY = 'shadowrunbank_inspector_state_v1';
    const INSPECTOR_STATES = ['collapsed', 'compact', 'full'];
    const CURRENT_SCHEMA_VERSION = 2;
    const SAVE_DEBOUNCE_MS = 800;
    const HISTORY_LIMIT = 50;
    const BACKUP_LIMIT = 15;

    let plan = null;
    // Compteur monotone incrémenté à chaque mutation du plan. Sert de jeton de
    // cache bon marché (ex. occulteurs de map.js) : la géométrie ne change qu'ici,
    // jamais pendant l'animation temporelle des rondes/balayages.
    let mutationSeq = 0;
    let saveTimer = null;
    let cloudActive = false; // true dès que main.js a branché window.Cloud
    let dirty = false;
    let saveInFlight = false;
    let saveQueued = false;
    let queuedForce = false;
    let activeSavePromise = Promise.resolve();
    let conflict = null;
    let tokens = [];
    let discoveries = [];
    let historyPast = [];
    let historyFuture = [];
    let historyBaseline = null;
    let transactionDepth = 0;
    let transactionBefore = null;
    let transactionLabel = '';

    /* --- État UI (non persisté) --- */
    const ui = {
        currentFloorId: null,
        activeTool: 'select',          // select | paint | erase | patrol | <type d'entité>
        selection: null,               // { kind: 'entity'|'room'|'floor', id } | null
        snapToGrid: false,
        patrolEditId: null,            // entité dont on trace la ronde (outil 'patrol')
        readOnly: false,               // true = mode joueur (cloud actif sans login admin)
        preview: false,                // true = MJ en prévisualisation « vue joueur »
        overlayPreferences: {
            gm: { coverages: true, networkLinks: true },
            player: { coverages: true, networkLinks: true }
        },
        // Encart d'inspecteur en vue joueur/tablette (E2) : réduit / aperçu / agrandi.
        inspectorViewState: 'compact'
    };

    function uid(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function cloneData(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function comparablePlan(value) {
        if (!value) return '';
        const copy = cloneData(value);
        delete copy.updatedAt;
        delete copy.revision;
        return JSON.stringify(copy);
    }

    function plansDiffer(a, b) {
        return comparablePlan(a) !== comparablePlan(b);
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    const COVERAGE_SHAPES = ['cone', 'beam', 'rectangle', 'circle', 'threshold'];
    const COVERAGE_CHANNELS = ['optical', 'infrared', 'laser', 'magnetic', 'pressure', 'astral'];
    const DECOR_ACCESS_CONTROL_TYPES = ['maglock', 'retina_scanner', 'dna_analyzer'];

    function coverageDefaults(ent, source) {
        const definition = typeof EntityCatalog !== 'undefined'
            ? EntityCatalog.get(ent.type) : { coverageType: 'cone', coverageChannel: 'optical' };
        const legacy = isPlainObject(source) ? source : {};
        const preset = isPlainObject(definition.defaultCoverage) ? definition.defaultCoverage : {};
        const defaultShape = COVERAGE_SHAPES.includes(definition.coverageType)
            ? definition.coverageType : 'cone';
        const shape = COVERAGE_SHAPES.includes(legacy.shape) ? legacy.shape : defaultShape;
        const defaultChannel = COVERAGE_CHANNELS.includes(definition.coverageChannel)
            ? definition.coverageChannel : 'optical';
        return {
            shape,
            channel: COVERAGE_CHANNELS.includes(legacy.channel) ? legacy.channel : defaultChannel,
            direction: clampNumber(legacy.direction, -360, 360, preset.direction || 0),
            angle: clampNumber(legacy.angle, 10, 180, preset.angle || 60),
            range: clampNumber(legacy.range, 0.5, 30,
                preset.range || (shape === 'threshold' ? 1 : 6)),
            width: clampNumber(legacy.width, 0.25, 20,
                preset.width || (shape === 'rectangle' ? 2 : 1)),
            radius: clampNumber(legacy.radius, 0.5, 30, preset.radius || 4),
            sweep: isPlainObject(legacy.sweep) ? {
                from: clampNumber(legacy.sweep.from, -360, 360, -45),
                to: clampNumber(legacy.sweep.to, -360, 360, 45),
                period: clampNumber(legacy.sweep.period, 1, 60, 8),
                anchorAt: Number.isFinite(legacy.sweep.anchorAt) ? legacy.sweep.anchorAt : Date.now()
            } : null,
            revealed: legacy.revealed === true
        };
    }

    function normalizeDecor(decor) {
        const definition = typeof DecorCatalog !== 'undefined'
            ? DecorCatalog.get(decor.type) : {
                name: 'Décor', width: 1, height: 1, autoDiscover: true,
                blocksMovement: false, blocksVision: []
            };
        decor.type = typeof decor.type === 'string' ? decor.type : 'visual_element';
        if (typeof decor.name !== 'string' || !decor.name) decor.name = definition.name;
        decor.rotation = Math.round(clampNumber(decor.rotation, -360, 360, 0) / 90) * 90;
        decor.revealed = decor.revealed === true;
        decor.autoDiscover = typeof decor.autoDiscover === 'boolean'
            ? decor.autoDiscover : definition.autoDiscover;
        decor.blocksMovement = typeof decor.blocksMovement === 'boolean'
            ? decor.blocksMovement : definition.blocksMovement;
        const channels = Array.isArray(decor.blocksVision)
            ? decor.blocksVision : definition.blocksVision;
        decor.blocksVision = [...new Set(channels.filter(channel => COVERAGE_CHANNELS.includes(channel)))];
        if (typeof decor.privateNote !== 'string') {
            decor.privateNote = typeof decor.note === 'string' ? decor.note : '';
        }
        if (typeof decor.playerInfo !== 'string') decor.playerInfo = '';
        decor.accessEntityId = typeof decor.accessEntityId === 'string'
            ? decor.accessEntityId : '';
        delete decor.note;
        return decor;
    }

    const TRANSITION_TYPES = ['stairs', 'elevator', 'ladder', 'hatch', 'passage'];
    const STAIRS_DIRECTIONS = ['up', 'down', 'both'];
    const CABIN_DOOR_SIDES = ['north', 'south', 'east', 'west'];
    const SHARED_POSITION_TRANSITION_TYPES = new Set(['stairs', 'ladder', 'elevator']);

    /* `floors` (optionnel) sert à convertir l'ancien `bidirectional: false`
       d'un escalier en sens up/down relatif à l'ordre des étages. */
    function normalizeTransition(transition, grid, floors) {
        transition.type = TRANSITION_TYPES.includes(transition.type) ? transition.type : 'stairs';
        if (typeof transition.name !== 'string' || !transition.name) transition.name = 'Nouvelle liaison';
        transition.state = transition.state === 'offline' ? 'offline' : 'active';
        // La révélation aux joueurs vit désormais sur chaque endpoint (un
        // point de passage par étage) et non sur la transition entière : le MJ
        // dévoile un point sans exposer les autres. Migration : un ancien
        // `transition.revealed` global rejaillit une fois sur tous les points,
        // puis le drapeau global est retiré pour ne pas se réappliquer au
        // rechargement (sinon masquer un point serait annulé à chaque save).
        const legacyRevealed = transition.revealed === true;
        delete transition.revealed;
        transition.accessEntityId = typeof transition.accessEntityId === 'string'
            ? transition.accessEntityId : '';
        transition.endpoints = Array.isArray(transition.endpoints) ? transition.endpoints : [];
        transition.endpoints = transition.endpoints.filter(isPlainObject).map(endpoint => ({
            id: typeof endpoint.id === 'string' && endpoint.id ? endpoint.id : uid('ep'),
            floorId: typeof endpoint.floorId === 'string' ? endpoint.floorId : '',
            x: clampNumber(endpoint.x, 0.5, Math.max(0.5, grid.cols - 0.5), 0.5),
            y: clampNumber(endpoint.y, 0.5, Math.max(0.5, grid.rows - 0.5), 0.5),
            label: typeof endpoint.label === 'string' ? endpoint.label : '',
            hasDoor: endpoint.hasDoor !== false,
            revealed: endpoint.revealed === true || legacyRevealed
        }));

        if (transition.type === 'stairs') {
            // 7.9 : `direction` remplace `bidirectional` pour les escaliers.
            if (!STAIRS_DIRECTIONS.includes(transition.direction)) {
                transition.direction = transition.bidirectional === false
                    ? legacyStairsDirection(transition, floors) : 'both';
            }
            delete transition.bidirectional;
        } else {
            transition.bidirectional = transition.bidirectional !== false;
            delete transition.direction;
        }

        if (transition.type === 'elevator') {
            // 7.8 : la gaine est définie une seule fois pour toute la liaison.
            const cabin = isPlainObject(transition.cabin) ? transition.cabin : {};
            transition.cabin = {
                width: clampNumber(cabin.width, 0.5, grid.cols, 2),
                height: clampNumber(cabin.height, 0.5, grid.rows, 2),
                rotation: Math.round(clampNumber(cabin.rotation, -360, 360, 0) / 90) * 90,
                doorSide: CABIN_DOOR_SIDES.includes(cabin.doorSide) ? cabin.doorSide : 'south'
            };
            transition.minFloorOrder = Number.isInteger(transition.minFloorOrder)
                ? transition.minFloorOrder : null;
            transition.maxFloorOrder = Number.isInteger(transition.maxFloorOrder)
                ? transition.maxFloorOrder : null;
            // La gaine ne se déplace pas latéralement : x/y identiques partout.
            const anchor = transition.endpoints[0];
            if (anchor) {
                transition.endpoints.forEach(endpoint => {
                    endpoint.x = anchor.x;
                    endpoint.y = anchor.y;
                });
            }
        } else {
            delete transition.cabin;
            delete transition.minFloorOrder;
            delete transition.maxFloorOrder;
            transition.endpoints.forEach(endpoint => { delete endpoint.hasDoor; });
        }
        if (SHARED_POSITION_TRANSITION_TYPES.has(transition.type)) {
            const anchor = transition.endpoints[0];
            if (anchor) {
                transition.endpoints.forEach(endpoint => {
                    endpoint.x = anchor.x;
                    endpoint.y = anchor.y;
                });
            }
        }
        return transition;
    }

    /* L'ancien `bidirectional: false` n'autorisait le passage que depuis le
       premier endpoint ; on le traduit en sens vertical quand c'est possible. */
    function legacyStairsDirection(transition, floors) {
        if (!Array.isArray(floors) || transition.endpoints.length < 2) return 'both';
        const orderOf = floorId => {
            const floor = floors.find(item => isPlainObject(item) && item.id === floorId);
            return floor && Number.isFinite(floor.order) ? floor.order : null;
        };
        const source = orderOf(transition.endpoints[0].floorId);
        const target = orderOf(transition.endpoints[1].floorId);
        if (source === null || target === null || source === target) return 'both';
        // Ordre croissant = étage plus bas : aller vers un ordre plus grand,
        // c'est descendre.
        return source < target ? 'down' : 'up';
    }

    function normalizeToken(token) {
        const grid = plan ? plan.grid : { cols: 24, rows: 16 };
        return {
            id: typeof token.id === 'string' && token.id ? token.id : uid('token'),
            name: typeof token.name === 'string' && token.name ? token.name : 'Runner',
            shortLabel: typeof token.shortLabel === 'string' && token.shortLabel
                ? token.shortLabel.slice(0, 3).toUpperCase() : 'PJ',
            color: /^#[0-9a-f]{6}$/i.test(token.color || '') ? token.color : '#00d2ff',
            icon: typeof token.icon === 'string' ? token.icon : 'runner',
            floorId: typeof token.floorId === 'string' ? token.floorId : '',
            x: clampNumber(token.x, 0.5, Math.max(0.5, grid.cols - 0.5), 0.5),
            y: clampNumber(token.y, 0.5, Math.max(0.5, grid.rows - 0.5), 0.5),
            playerMovable: token.playerMovable !== false,
            visible: token.visible !== false,
            locked: token.locked === true,
            updatedAt: Number.isFinite(token.updatedAt) ? token.updatedAt : Date.now()
        };
    }

    function migratePlan(source) {
        if (!isPlainObject(source)) throw new Error('Le plan doit être un objet JSON.');

        const inputVersion = source.schemaVersion == null ? 1 : Number(source.schemaVersion);
        if (!Number.isInteger(inputVersion) || inputVersion < 1) {
            throw new Error('Version de schéma invalide.');
        }
        if (inputVersion > CURRENT_SCHEMA_VERSION) {
            throw new Error('Ce plan utilise un schéma plus récent que cette application.');
        }

        const migrated = cloneData(source);
        const migratedFrom = inputVersion;

        if (inputVersion === 1) {
            migrated.schemaVersion = 2;
            migrated.revision = Number.isInteger(migrated.revision) && migrated.revision >= 0
                ? migrated.revision : 0;
            migrated.decors = Array.isArray(migrated.decors) ? migrated.decors : [];
            migrated.transitions = Array.isArray(migrated.transitions) ? migrated.transitions : [];
            if (Array.isArray(migrated.entities)) {
                migrated.entities.forEach(ent => {
                    if (!isPlainObject(ent)) return;
                    if (typeof ent.privateNote !== 'string') {
                        ent.privateNote = typeof ent.note === 'string' ? ent.note : '';
                    }
                    if (typeof ent.playerInfo !== 'string') ent.playerInfo = '';
                    delete ent.note;
                });
            }
        }

        migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
        if (!Number.isInteger(migrated.revision) || migrated.revision < 0) migrated.revision = 0;
        if (!Array.isArray(migrated.decors)) migrated.decors = [];
        if (!Array.isArray(migrated.transitions)) migrated.transitions = [];
        if (Array.isArray(migrated.entities)) {
            migrated.entities.forEach(ent => {
                if (!isPlainObject(ent)) return;
                if (typeof EntityCatalog !== 'undefined') {
                    ent.type = EntityCatalog.resolveType(ent.type);
                    const definition = EntityCatalog.get(ent.type);
                    if (typeof ent.autoDiscover !== 'boolean') ent.autoDiscover = definition.autoDiscover;
                }
                if (typeof ent.privateNote !== 'string') {
                    ent.privateNote = typeof ent.note === 'string' ? ent.note : '';
                }
                if (typeof ent.playerInfo !== 'string') ent.playerInfo = '';
                delete ent.note;

                // Les plans v1 stockaient uniquement un cône dans `vision`.
                // On le conserve comme sauvegarde de migration, mais tout le
                // moteur v2 lit désormais la couverture générique.
                if (!isPlainObject(ent.coverage) && isPlainObject(ent.vision)) {
                    ent.coverage = coverageDefaults(ent, ent.vision);
                } else if (isPlainObject(ent.coverage)) {
                    ent.coverage = coverageDefaults(ent, ent.coverage);
                }
            });
        }
        migrated.decors.forEach(decor => {
            if (isPlainObject(decor)) normalizeDecor(decor);
        });

        const grid = migrated.grid;
        if (isPlainObject(grid) && Number.isFinite(grid.cols) && Number.isFinite(grid.rows)) {
            const maxX = Math.max(0.5, grid.cols - 0.5);
            const maxY = Math.max(0.5, grid.rows - 0.5);
            (Array.isArray(migrated.entities) ? migrated.entities : []).forEach(ent => {
                if (!isPlainObject(ent)) return;
                ent.x = clampNumber(ent.x, 0.5, maxX, 0.5);
                ent.y = clampNumber(ent.y, 0.5, maxY, 0.5);
                if (isPlainObject(ent.patrol)) {
                    ent.patrol.speed = clampNumber(ent.patrol.speed, 0.1, 10, 1);
                    ent.patrol.loop = ent.patrol.loop !== false;
                    ent.patrol.moving = ent.patrol.moving === true;
                    if (Array.isArray(ent.patrol.points)) {
                        ent.patrol.points.forEach(point => {
                            if (!isPlainObject(point)) return;
                            point.x = clampNumber(point.x, 0, grid.cols, 0);
                            point.y = clampNumber(point.y, 0, grid.rows, 0);
                        });
                    }
                }
                if (isPlainObject(ent.coverage)) ent.coverage = coverageDefaults(ent, ent.coverage);
            });
            migrated.decors.forEach(decor => {
                if (!isPlainObject(decor)) return;
                const definition = typeof DecorCatalog !== 'undefined'
                    ? DecorCatalog.get(decor.type) : { width: 1, height: 1 };
                decor.x = clampNumber(decor.x, 0, grid.cols, 0);
                decor.y = clampNumber(decor.y, 0, grid.rows, 0);
                decor.width = clampNumber(decor.width, 0.5, grid.cols, definition.width || 1);
                decor.height = clampNumber(decor.height, 0.25, grid.rows, definition.height || 1);
            });
            migrated.transitions.forEach(transition => {
                if (isPlainObject(transition)) {
                    normalizeTransition(transition, grid,
                        Array.isArray(migrated.floors) ? migrated.floors : []);
                }
            });
        }

        return { plan: migrated, migratedFrom };
    }

    function validatePlan(candidate) {
        const errors = [];
        if (!isPlainObject(candidate)) return ['Le plan doit être un objet JSON.'];
        if (candidate.schemaVersion !== CURRENT_SCHEMA_VERSION) {
            errors.push('schemaVersion doit valoir ' + CURRENT_SCHEMA_VERSION + '.');
        }
        if (!Number.isInteger(candidate.revision) || candidate.revision < 0) {
            errors.push('revision doit être un entier positif ou nul.');
        }
        if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
            errors.push('name doit être une chaîne non vide.');
        }
        if (!Number.isFinite(candidate.updatedAt)) errors.push('updatedAt doit être un nombre.');

        const grid = candidate.grid;
        if (!isPlainObject(grid)
            || !Number.isInteger(grid.cols) || grid.cols <= 0
            || !Number.isInteger(grid.rows) || grid.rows <= 0
            || !Number.isFinite(grid.cellSize) || grid.cellSize <= 0) {
            errors.push('grid doit définir cols, rows et cellSize avec des valeurs positives.');
        }

        ['floors', 'rooms', 'entities', 'decors', 'transitions'].forEach(key => {
            if (!Array.isArray(candidate[key])) errors.push(key + ' doit être un tableau.');
        });
        if (errors.length) return errors;

        const floorIds = new Set();
        candidate.floors.forEach((floor, index) => {
            if (!isPlainObject(floor) || typeof floor.id !== 'string' || !floor.id) {
                errors.push('floors[' + index + '] doit avoir un identifiant.');
                return;
            }
            if (floorIds.has(floor.id)) errors.push('Identifiant d\'étage dupliqué : ' + floor.id + '.');
            floorIds.add(floor.id);
        });

        const validateFloorReference = (items, label) => items.forEach((item, index) => {
            if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id) {
                errors.push(label + '[' + index + '] doit avoir un identifiant.');
            }
            if (!isPlainObject(item) || !floorIds.has(item.floorId)) {
                errors.push(label + '[' + index + '] référence un étage inconnu.');
            }
        });
        validateFloorReference(candidate.rooms, 'rooms');
        validateFloorReference(candidate.entities, 'entities');
        validateFloorReference(candidate.decors, 'decors');
        const entityById = new Map(candidate.entities
            .filter(isPlainObject).map(entity => [entity.id, entity]));

        candidate.rooms.forEach((room, index) => {
            if (!isPlainObject(room) || !Array.isArray(room.cells)) {
                errors.push('rooms[' + index + '].cells doit être un tableau.');
            }
        });
        candidate.entities.forEach((ent, index) => {
            if (!isPlainObject(ent)) return;
            if (!Number.isFinite(ent.x) || !Number.isFinite(ent.y)) {
                errors.push('entities[' + index + '] doit avoir des coordonnées numériques.');
            }
            if (typeof ent.privateNote !== 'string' || typeof ent.playerInfo !== 'string') {
                errors.push('entities[' + index + '] doit séparer privateNote et playerInfo.');
            }
            if (ent.coverage != null) {
                if (!isPlainObject(ent.coverage)
                    || !COVERAGE_SHAPES.includes(ent.coverage.shape)
                    || !COVERAGE_CHANNELS.includes(ent.coverage.channel)) {
                    errors.push('entities[' + index + '].coverage doit définir une forme et un canal valides.');
                } else {
                    ['direction', 'angle', 'range', 'width', 'radius'].forEach(key => {
                        if (!Number.isFinite(ent.coverage[key])) {
                            errors.push('entities[' + index + '].coverage.' + key + ' doit être numérique.');
                        }
                    });
                }
            }
        });
        candidate.decors.forEach((decor, index) => {
            if (!isPlainObject(decor)) return;
            if (typeof decor.type !== 'string' || !decor.type
                || !Number.isFinite(decor.x) || !Number.isFinite(decor.y)
                || !Number.isFinite(decor.width) || !Number.isFinite(decor.height)
                || !Number.isFinite(decor.rotation)) {
                errors.push('decors[' + index + '] doit définir type, position, dimensions et rotation.');
            }
            if (!Array.isArray(decor.blocksVision)
                || decor.blocksVision.some(channel => !COVERAGE_CHANNELS.includes(channel))) {
                errors.push('decors[' + index + '].blocksVision contient un canal invalide.');
            }
            if (typeof decor.privateNote !== 'string' || typeof decor.playerInfo !== 'string') {
                errors.push('decors[' + index + '] doit séparer privateNote et playerInfo.');
            }
            if (typeof decor.accessEntityId !== 'string') {
                errors.push('decors[' + index + '].accessEntityId doit être une chaîne.');
            } else if (decor.accessEntityId) {
                const access = entityById.get(decor.accessEntityId);
                if (!access || !DECOR_ACCESS_CONTROL_TYPES.includes(access.type)) {
                    errors.push('decors[' + index + '] référence un contrôle d’accès incompatible.');
                }
            }
        });
        candidate.transitions.forEach((transition, index) => {
            if (!isPlainObject(transition) || typeof transition.id !== 'string' || !transition.id
                || !TRANSITION_TYPES.includes(transition.type)
                || !Array.isArray(transition.endpoints)) {
                errors.push('transitions[' + index + '] doit définir un type et des endpoints.');
                return;
            }
            transition.endpoints.forEach((endpoint, endpointIndex) => {
                if (!isPlainObject(endpoint) || typeof endpoint.id !== 'string'
                    || !floorIds.has(endpoint.floorId)
                    || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) {
                    errors.push('transitions[' + index + '].endpoints[' + endpointIndex + '] est invalide.');
                }
            });
            if (transition.type === 'stairs' && !STAIRS_DIRECTIONS.includes(transition.direction)) {
                errors.push('transitions[' + index + '].direction doit valoir up, down ou both.');
            }
            if (transition.type === 'elevator') {
                const cabin = transition.cabin;
                if (!isPlainObject(cabin) || !Number.isFinite(cabin.width)
                    || !Number.isFinite(cabin.height) || !Number.isFinite(cabin.rotation)
                    || !CABIN_DOOR_SIDES.includes(cabin.doorSide)) {
                    errors.push('transitions[' + index + '].cabin doit définir largeur, hauteur, rotation et côté de porte.');
                }
            }
        });

        return errors;
    }

    function preparePlan(source) {
        const result = migratePlan(source);
        const errors = validatePlan(result.plan);
        if (errors.length) throw new Error('Plan invalide : ' + errors.join(' '));
        return result;
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
            schemaVersion: CURRENT_SCHEMA_VERSION,
            revision: 0,
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
            entities: [],
            decors: [],
            transitions: []
        };
    }

    /* --- Chargement --- */
    function load() {
        let raw = null;
        try {
            dirty = localStorage.getItem(DIRTY_KEY) === '1';
            raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const prepared = preparePlan(parsed);
                plan = prepared.plan;
                if (prepared.migratedFrom < CURRENT_SCHEMA_VERSION) {
                    localStorage.setItem(MIGRATION_BACKUP_PREFIX + Date.now(), raw);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
                    setDirty(true);
                }
            }
        } catch (e) {
            console.error('Plan localStorage illisible, réinitialisation.', e);
            if (raw) {
                try { localStorage.setItem(MIGRATION_BACKUP_PREFIX + 'invalid_' + Date.now(), raw); }
                catch (backupError) { /* stockage indisponible */ }
            }
        }
        if (!plan) {
            plan = defaultPlan();
        }
        pruneBackups();
        try {
            const storedTokens = JSON.parse(localStorage.getItem(TOKENS_KEY) || '[]');
            tokens = Array.isArray(storedTokens) ? storedTokens.map(normalizeToken) : [];
        } catch (error) {
            tokens = [];
        }
        try {
            const storedDiscoveries = JSON.parse(localStorage.getItem(DISCOVERIES_KEY) || '[]');
            discoveries = Array.isArray(storedDiscoveries) ? storedDiscoveries.filter(isPlainObject) : [];
            if (migrateTransitionDiscoveries()) persistDiscoveries();
        } catch (error) {
            discoveries = [];
        }
        loadOverlayPreferences();
        loadInspectorViewState();
        const first = sortedFloors()[0];
        ui.currentFloorId = first ? first.id : null;
        resetHistory();
        return plan;
    }

    function loadOverlayPreferences() {
        const defaults = {
            gm: { coverages: true, networkLinks: true },
            player: { coverages: true, networkLinks: true }
        };
        try {
            const stored = JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY) || '{}');
            Object.keys(defaults).forEach(profile => {
                Object.keys(defaults[profile]).forEach(key => {
                    if (stored && stored[profile] && typeof stored[profile][key] === 'boolean') {
                        defaults[profile][key] = stored[profile][key];
                    }
                });
            });
        } catch (error) { /* préférences locales facultatives */ }
        ui.overlayPreferences = defaults;
    }

    function getOverlayPreferences() {
        return ui.overlayPreferences[isPlayerView() ? 'player' : 'gm'];
    }

    function setOverlayVisibility(key, visible) {
        if (!['coverages', 'networkLinks'].includes(key)) return false;
        getOverlayPreferences()[key] = !!visible;
        try {
            localStorage.setItem(OVERLAY_PREFS_KEY, JSON.stringify(ui.overlayPreferences));
        } catch (error) { /* le filtre reste actif pour la session */ }
        return true;
    }

    function loadInspectorViewState() {
        try {
            const stored = localStorage.getItem(INSPECTOR_STATE_KEY);
            if (INSPECTOR_STATES.includes(stored)) ui.inspectorViewState = stored;
        } catch (error) { /* préférence locale facultative */ }
    }

    function getInspectorViewState() {
        return ui.inspectorViewState;
    }

    function setInspectorViewState(state) {
        if (!INSPECTOR_STATES.includes(state)) return false;
        ui.inspectorViewState = state;
        try {
            localStorage.setItem(INSPECTOR_STATE_KEY, state);
        } catch (error) { /* l'état reste actif pour la session */ }
        return true;
    }

    /* --- Sauvegarde locale et file cloud séquentielle --- */
    function setSaveStatus(status, text) {
        const el = document.getElementById('save-status');
        if (!el) return;
        el.className = status;
        el.textContent = text;
    }

    function notifyHistoryChange() {
        if (typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('history-change', { detail: getHistoryState() }));
        }
    }

    function resetHistory() {
        historyPast = [];
        historyFuture = [];
        transactionDepth = 0;
        transactionBefore = null;
        transactionLabel = '';
        historyBaseline = plan ? cloneData(plan) : null;
        notifyHistoryChange();
    }

    function pushHistory(label, before, after) {
        if (!before || !after || !plansDiffer(before, after)) return false;
        historyPast.push({
            label: label || 'Modification',
            before: cloneData(before),
            after: cloneData(after)
        });
        if (historyPast.length > HISTORY_LIMIT) historyPast.shift();
        historyFuture = [];
        notifyHistoryChange();
        return true;
    }

    function markPlanDirty() {
        mutationSeq += 1;
        plan.updatedAt = Date.now();
        setDirty(true);
        setSaveStatus('dirty', '● Modifications locales');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    }

    /* `touch` est appelé après une mutation. Le baseline conserve donc l'état
       précédent ; une transaction permet de regrouper peinture, drag ou saisie. */
    function touch(label) {
        markPlanDirty();
        if (transactionDepth > 0) return;
        const after = cloneData(plan);
        pushHistory(label, historyBaseline, after);
        historyBaseline = after;
    }

    function beginTransaction(label) {
        if (ui.readOnly) return false;
        if (transactionDepth === 0) {
            transactionBefore = historyBaseline ? cloneData(historyBaseline) : cloneData(plan);
            transactionLabel = label || 'Modification';
        }
        transactionDepth += 1;
        return true;
    }

    function endTransaction() {
        if (transactionDepth === 0) return false;
        transactionDepth -= 1;
        if (transactionDepth > 0) return false;
        const after = cloneData(plan);
        const changed = pushHistory(transactionLabel, transactionBefore, after);
        historyBaseline = after;
        transactionBefore = null;
        transactionLabel = '';
        return changed;
    }

    function cancelTransaction() {
        if (transactionDepth === 0) return false;
        transactionDepth = 0;
        transactionBefore = null;
        transactionLabel = '';
        historyBaseline = cloneData(plan);
        return true;
    }

    function transaction(label, mutation) {
        if (!beginTransaction(label)) return false;
        try {
            const result = mutation();
            endTransaction();
            return result;
        } catch (error) {
            cancelTransaction();
            throw error;
        }
    }

    function restoreHistorySnapshot(snapshot) {
        const revision = Number.isInteger(plan.revision) ? plan.revision : 0;
        plan = preparePlan(snapshot).plan;
        plan.revision = revision;
        repairUiAfterPlanChange();
        historyBaseline = cloneData(plan);
        markPlanDirty();
        persistLocal();
    }

    function undo() {
        if (ui.readOnly || transactionDepth > 0 || historyPast.length === 0) return false;
        const entry = historyPast.pop();
        historyFuture.push(entry);
        restoreHistorySnapshot(entry.before);
        notifyHistoryChange();
        return entry.label;
    }

    function redo() {
        if (ui.readOnly || transactionDepth > 0 || historyFuture.length === 0) return false;
        const entry = historyFuture.pop();
        historyPast.push(entry);
        restoreHistorySnapshot(entry.after);
        notifyHistoryChange();
        return entry.label;
    }

    function getHistoryState() {
        const undoEntry = historyPast[historyPast.length - 1];
        const redoEntry = historyFuture[historyFuture.length - 1];
        return {
            canUndo: !ui.readOnly && !!undoEntry,
            canRedo: !ui.readOnly && !!redoEntry,
            undoLabel: undoEntry ? undoEntry.label : '',
            redoLabel: redoEntry ? redoEntry.label : '',
            length: historyPast.length
        };
    }

    function setDirty(value) {
        dirty = !!value;
        try {
            if (dirty) localStorage.setItem(DIRTY_KEY, '1');
            else if (typeof localStorage.removeItem === 'function') localStorage.removeItem(DIRTY_KEY);
            else localStorage.setItem(DIRTY_KEY, '0');
        } catch (e) {
            console.warn('Impossible de mettre à jour le marqueur de sauvegarde.', e);
        }
    }

    function persistLocal() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
            return true;
        } catch (e) {
            console.error('Échec de sauvegarde localStorage', e);
            setSaveStatus('error', '⚠ Sauvegarde locale impossible');
            return false;
        }
    }

    function dispatchSaveEvent(name, detail) {
        if (typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent(name, { detail }));
        }
    }

    function notifyConflict(remote, source) {
        conflict = { remote: preparePlan(remote).plan, source: source || 'remote' };
        setDirty(true);
        setSaveStatus('conflict', '⚠ Conflit de sauvegarde');
        dispatchSaveEvent('plan-save-conflict', conflict);
        return conflict;
    }

    function saveNow(options) {
        const force = !!(options && options.force);
        clearTimeout(saveTimer);
        saveTimer = null;
        persistLocal();

        if (!cloudActive || ui.readOnly || !window.Cloud) {
            setSaveStatus(dirty ? 'offline' : 'saved',
                dirty ? '💾 Local — cloud en attente' : '💾 Sauvegardé (local)');
            if (dirty) dispatchSaveEvent('plan-save-offline');
            return Promise.resolve({ localOnly: true });
        }

        if (saveInFlight) {
            saveQueued = true;
            queuedForce = queuedForce || force;
            return activeSavePromise;
        }

        const snapshot = cloneData(plan);
        saveInFlight = true;
        conflict = null;
        setSaveStatus('saving', '☁ Sauvegarde…');

        activeSavePromise = Promise.resolve(window.Cloud.savePlan(snapshot, { force }))
            .then(result => {
                const newRevision = result && Number.isInteger(result.revision)
                    ? result.revision : snapshot.revision + 1;
                plan.revision = Math.max(plan.revision || 0, newRevision);

                const changedDuringSave = plan.updatedAt !== snapshot.updatedAt;
                if (changedDuringSave) saveQueued = true;
                setDirty(changedDuringSave || saveQueued);
                persistLocal();
                setSaveStatus(dirty ? 'saving' : 'saved',
                    dirty ? '☁ Nouvelle sauvegarde en attente…' : '☁ Synchronisé — r' + plan.revision);
                if (!dirty) dispatchSaveEvent('plan-save-synced', { revision: plan.revision });
                return { revision: newRevision };
            })
            .catch(error => {
                setDirty(true);
                if (error && error.code === 'revision-conflict' && error.remotePlan) {
                    notifyConflict(error.remotePlan, 'transaction');
                } else {
                    console.warn('Sauvegarde Firestore différée', error);
                    setSaveStatus('offline', '⚠ Hors ligne — copie locale conservée');
                    dispatchSaveEvent('plan-save-offline', { error });
                }
                return { error };
            })
            .finally(() => {
                saveInFlight = false;
                const retry = saveQueued && !conflict;
                const retryForce = queuedForce;
                saveQueued = false;
                queuedForce = false;
                if (retry) setTimeout(() => saveNow({ force: retryForce }), 0);
            });

        return activeSavePromise;
    }

    function handlePageHide() {
        clearTimeout(saveTimer);
        saveTimer = null;
        persistLocal();
        if (dirty || saveInFlight) setDirty(true);
    }

    function hasPendingChanges() { return dirty; }
    function isSaveInFlight() { return saveInFlight; }
    function getConflict() { return conflict; }

    function markRemoteConflict(remote) {
        return notifyConflict(remote, 'snapshot');
    }

    function resolveConflictWithRemote() {
        if (!conflict) return false;
        const remote = conflict.remote;
        conflict = null;
        applyRemotePlan(remote);
        return true;
    }

    function resolveConflictWithLocal() {
        if (!conflict) return Promise.resolve(false);
        conflict = null;
        setDirty(true);
        return saveNow({ force: true });
    }

    function backupCurrentPlan(label) {
        try {
            const createdAt = Date.now();
            const safeLabel = String(label || 'manual').replace(/[^a-z0-9_-]+/gi, '-');
            const key = MIGRATION_BACKUP_PREFIX + safeLabel + '_' + createdAt;
            localStorage.setItem(key, JSON.stringify(plan));
            pruneBackups();
            return key;
        } catch (error) {
            console.error('Échec de création de la sauvegarde locale', error);
            return false;
        }
    }

    function listBackups() {
        const backups = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key || !key.startsWith(MIGRATION_BACKUP_PREFIX)) continue;
            const suffix = key.slice(MIGRATION_BACKUP_PREFIX.length);
            const timestamp = suffix.match(/(\d+)$/);
            const createdAt = timestamp ? Number(timestamp[1]) : 0;
            const label = timestamp
                ? suffix.slice(0, -timestamp[1].length).replace(/_$/, '')
                : suffix;
            try {
                const source = JSON.parse(localStorage.getItem(key));
                backups.push({
                    key,
                    label: label || 'migration',
                    createdAt,
                    plan: preparePlan(source).plan,
                    valid: true
                });
            } catch (error) {
                backups.push({ key, label: label || 'invalide', createdAt, plan: null, valid: false });
            }
        }
        return backups.sort((a, b) => b.createdAt - a.createdAt);
    }

    function pruneBackups(limit = BACKUP_LIMIT) {
        listBackups().slice(Math.max(0, limit)).forEach(backup => {
            localStorage.removeItem(backup.key);
        });
    }

    function restoreBackup(key) {
        const backup = listBackups().find(item => item.key === key);
        if (!backup || !backup.valid || !backup.plan) return false;
        const restoredPlan = cloneData(backup.plan);
        restoredPlan.revision = Number.isInteger(plan.revision) ? plan.revision : 0;
        backupCurrentPlan('avant-restauration');
        replacePlan(restoredPlan);
        return true;
    }

    function deleteBackup(key) {
        if (!key || !key.startsWith(MIGRATION_BACKUP_PREFIX)) return false;
        localStorage.removeItem(key);
        return true;
    }

    function exportJson() {
        return JSON.stringify(plan, null, 2);
    }

    /* --- Cloud (phase 3) --- */
    function setCloudActive(v) { cloudActive = v; }
    function isCloudActive() { return cloudActive; }

    /* Remplace le plan par la version Firestore et répare l'état UI
       (étage courant / sélection / tracé de ronde devenus orphelins). */
    function repairUiAfterPlanChange() {
        if (!plan.floors.find(f => f.id === ui.currentFloorId)) {
            const first = sortedFloors()[0];
            ui.currentFloorId = first ? first.id : null;
        }
        const sel = ui.selection;
        if (sel) {
            const exists = sel.kind === 'entity' ? findEntity(sel.id)
                : sel.kind === 'room' ? findRoom(sel.id)
                : sel.kind === 'decor' ? findDecor(sel.id)
                : sel.kind === 'token' ? findToken(sel.id)
                : sel.kind === 'transition' ? findTransition(sel.id)
                : findFloor(sel.id);
            if (!exists) ui.selection = null;
        }
        if (ui.patrolEditId && !findEntity(ui.patrolEditId)) ui.patrolEditId = null;
    }

    function applyRemotePlan(remote) {
        plan = preparePlan(remote).plan;
        repairUiAfterPlanChange();
        conflict = null;
        setDirty(false);
        persistLocal();
        resetHistory();
    }

    function replacePlan(source) {
        return transaction('Importer un plan', () => {
            plan = preparePlan(source).plan;
            repairUiAfterPlanChange();
            conflict = null;
            touch('Importer un plan');
            persistLocal();
            return plan;
        });
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

    function floorDecors(floorId) {
        return plan.decors.filter(decor => decor.floorId === floorId);
    }

    function findEntity(id) { return plan.entities.find(e => e.id === id); }
    function findRoom(id) { return plan.rooms.find(r => r.id === id); }
    function findDecor(id) { return plan.decors.find(decor => decor.id === id); }
    function findFloor(id) { return plan.floors.find(f => f.id === id); }
    function getTokens() { return tokens; }
    function floorTokens(floorId) { return tokens.filter(token => token.floorId === floorId); }
    function findToken(id) { return tokens.find(token => token.id === id); }
    function findTransition(id) { return plan.transitions.find(transition => transition.id === id); }

    /* ============================================================
       Transitions verticales (7.8 / 7.9). Convention du plan :
       `floor.order` croissant = étage plus bas (Niv 0 avant Niv -1).
       ============================================================ */

    /* Bornes effectives de desserte d'un ascenseur, en valeurs d'ordre
       d'étage ; une borne `null` suit les étages extrêmes du plan. */
    function elevatorFloorRange(transition) {
        if (!transition || transition.type !== 'elevator') return null;
        const orders = plan.floors.map(floor => floor.order).filter(Number.isFinite);
        if (!orders.length) return null;
        return {
            min: Number.isInteger(transition.minFloorOrder)
                ? transition.minFloorOrder : Math.min(...orders),
            max: Number.isInteger(transition.maxFloorOrder)
                ? transition.maxFloorOrder : Math.max(...orders)
        };
    }

    /* Cabines calculées pour un étage : la géométrie vient de `cabin`,
       la position des endpoints (identique sur toute la liaison). La gaine
       est présente sur tout étage compris dans la plage, avec ou sans porte. */
    function elevatorCabinsOnFloor(floorId) {
        const floor = findFloor(floorId);
        if (!floor) return [];
        return plan.transitions
            .filter(transition => transition.type === 'elevator' && transition.endpoints.length > 0)
            .map(transition => {
                const range = elevatorFloorRange(transition);
                if (!range || floor.order < range.min || floor.order > range.max) return null;
                const endpoint = transition.endpoints.find(item => item.floorId === floorId) || null;
                const anchor = transition.endpoints[0];
                return {
                    transition,
                    x: anchor.x,
                    y: anchor.y,
                    width: transition.cabin.width,
                    height: transition.cabin.height,
                    rotation: transition.cabin.rotation,
                    doorSide: transition.cabin.doorSide,
                    endpoint,
                    hasDoor: !!(endpoint && endpoint.hasDoor)
                };
            })
            .filter(Boolean);
    }

    /* Une borne figée désigne un étage via son ordre ; quand les ordres
       changent (suppression ou réordonnancement d'étage), on remappe les
       bornes pour qu'elles continuent de désigner les mêmes étages.
       `previousByOrder` est la photo ancien ordre → id prise avant la
       mutation. Si l'étage désigné a disparu, la borne se rabat sur
       l'étage conservé le plus proche à l'intérieur de l'ancienne plage. */
    function captureFloorOrders() {
        const byOrder = new Map();
        plan.floors.forEach(floor => byOrder.set(floor.order, floor.id));
        return byOrder;
    }

    function remapElevatorBounds(previousByOrder) {
        const newOrderOf = floorId => {
            const floor = findFloor(floorId);
            return floor ? floor.order : null;
        };
        const remap = (bound, side) => {
            if (!Number.isInteger(bound)) return bound;
            const keptId = previousByOrder.get(bound);
            const followed = keptId ? newOrderOf(keptId) : null;
            if (followed !== null) return followed;
            const candidates = [...previousByOrder.entries()]
                .filter(([oldOrder]) => side === 'min' ? oldOrder > bound : oldOrder < bound)
                .map(([, floorId]) => newOrderOf(floorId))
                .filter(order => order !== null);
            if (!candidates.length) return null;
            return side === 'min' ? Math.min(...candidates) : Math.max(...candidates);
        };
        plan.transitions.forEach(transition => {
            if (transition.type !== 'elevator') return;
            transition.minFloorOrder = remap(transition.minFloorOrder, 'min');
            transition.maxFloorOrder = remap(transition.maxFloorOrder, 'max');
            if (Number.isInteger(transition.minFloorOrder)
                && Number.isInteger(transition.maxFloorOrder)
                && transition.minFloorOrder > transition.maxFloorOrder) {
                [transition.minFloorOrder, transition.maxFloorOrder]
                    = [transition.maxFloorOrder, transition.minFloorOrder];
            }
        });
    }

    /* Sens de sortie disponible depuis un endpoint d'escalier. Avec une
       desserte multi-étages, `both` signifie que des destinations existent
       au-dessus et au-dessous de l'étage courant. */
    function stairsExitDirection(transition, sourceEndpoint) {
        if (!transition || transition.type !== 'stairs' || !sourceEndpoint) return null;
        const sourceFloor = findFloor(sourceEndpoint.floorId);
        if (!sourceFloor) return null;
        const targets = transition.endpoints
            .filter(item => item.id !== sourceEndpoint.id)
            .map(item => findFloor(item.floorId))
            .filter(Boolean);
        const hasUp = targets.some(floor => floor.order < sourceFloor.order);
        const hasDown = targets.some(floor => floor.order > sourceFloor.order);
        const allowsUp = transition.direction !== 'down' && hasUp;
        const allowsDown = transition.direction !== 'up' && hasDown;
        return allowsUp && allowsDown ? 'both' : allowsUp ? 'up' : allowsDown ? 'down' : null;
    }

    function persistTokens() {
        try { localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)); }
        catch (error) { console.warn('Sauvegarde locale des pions impossible', error); }
    }

    function applyRemoteTokens(remoteTokens) {
        tokens = Array.isArray(remoteTokens) ? remoteTokens.map(normalizeToken) : [];
        persistTokens();
    }

    function saveToken(token) {
        token.updatedAt = Date.now();
        persistTokens();
        if (cloudActive && window.Cloud && typeof window.Cloud.saveToken === 'function' && !ui.readOnly) {
            return window.Cloud.saveToken(cloneData(token)).catch(error => {
                console.warn('Configuration du pion conservée localement', error);
                return { error };
            });
        }
        return Promise.resolve({ localOnly: true });
    }

    function commitTokenPosition(token) {
        token.updatedAt = Date.now();
        persistTokens();
        if (cloudActive && window.Cloud && typeof window.Cloud.updateTokenPosition === 'function') {
            return window.Cloud.updateTokenPosition({
                id: token.id, floorId: token.floorId, x: token.x, y: token.y, updatedAt: token.updatedAt
            }).catch(error => {
                console.warn('Position du pion conservée localement', error);
                return { error };
            });
        }
        return Promise.resolve({ localOnly: true });
    }

    function addToken(floorId, x, y, name) {
        const token = normalizeToken({
            id: uid('token'), name: name || 'Runner ' + (tokens.length + 1),
            shortLabel: 'PJ', color: '#00d2ff', icon: 'runner', floorId, x, y,
            playerMovable: true, visible: true, locked: false, updatedAt: Date.now()
        });
        tokens.push(token);
        saveToken(token);
        return token;
    }

    function duplicateToken(source) {
        const token = addToken(source.floorId, source.x + 0.5, source.y + 0.5, source.name + ' copie');
        token.shortLabel = source.shortLabel;
        token.color = source.color;
        token.icon = source.icon;
        token.playerMovable = source.playerMovable;
        token.visible = source.visible;
        token.locked = source.locked;
        saveToken(token);
        return token;
    }

    function deleteToken(tokenId) {
        tokens = tokens.filter(token => token.id !== tokenId);
        persistTokens();
        if (cloudActive && window.Cloud && typeof window.Cloud.deleteToken === 'function' && !ui.readOnly) {
            window.Cloud.deleteToken(tokenId).catch(error => console.warn('Suppression du pion différée', error));
        }
    }

    function discoveryKey(kind, elementId) { return kind + '_' + elementId; }
    function getDiscoveries() { return discoveries; }
    function isDiscovered(kind, elementId) {
        const key = discoveryKey(kind, elementId);
        return discoveries.some(discovery => discovery.id === key
            || (discovery.kind === kind && discovery.elementId === elementId));
    }

    /* Une caméra piratée fournit un flux temporaire aux joueurs. Le nœud
       réseau est pris en compte via getEffectiveState, comme pour le rendu. */
    function cameraFeedCameras(floorId) {
        if (!plan) return [];
        return plan.entities.filter(ent => ent.floorId === floorId
            && ent.type === 'camera'
            && ent.coverage && ent.coverage.shape === 'cone'
            && getEffectiveState(ent) === 'hacked');
    }

    function isCameraFeedRevealed(item, kind) {
        if (!item) return false;
        if (kind === 'floor') return cameraFeedCameras(item.id).length > 0;
        if (kind === 'room') {
            return cameraFeedCameras(item.floorId).some(camera =>
                roomAt(camera.floorId, Math.floor(camera.x), Math.floor(camera.y)) === item);
        }
        return false;
    }

    /* Un point de passage est visible aux joueurs s'il est dévoilé
       individuellement par le MJ, ou si un pion a découvert CE point
       (en l'empruntant ou en voyant la cabine d'ascenseur de son étage).
       Les anciennes découvertes au niveau transition sont migrées vers
       les points de leur étage au chargement ; la clause de repli couvre
       un enregistrement pas encore migré (plan distant pas encore reçu).
       Le flux caméra, temporaire, est géré au niveau transition côté carte. */
    function isEndpointRevealed(transition, endpoint) {
        return !!(endpoint && (endpoint.revealed
            || isDiscovered('endpoint', endpoint.id)
            || (transition && isDiscovered('transition', transition.id))));
    }

    /* Lettre distinctive d'un point quand une même transition possède
       plusieurs points sur le même étage (trappe/passage) : a, b, c… dans
       l'ordre des endpoints. Renvoie '' s'il n'y en a qu'un sur l'étage,
       auquel cas le nom de l'étage suffit à l'identifier. Partagé par
       l'inspecteur et l'info-bulle carte pour que les lettres concordent. */
    function endpointLetter(transition, endpoint) {
        if (!transition || !endpoint) return '';
        const sameFloor = transition.endpoints.filter(item => item.floorId === endpoint.floorId);
        if (sameFloor.length < 2) return '';
        const index = sameFloor.indexOf(endpoint);
        return index < 0 ? '' : String.fromCharCode(97 + index);
    }

    /* Au niveau transition : « effectivement révélée » = au moins un point
       visible. Sert aux vérifications globales (sélection, interaction). */
    function isEffectivelyRevealed(item, kind) {
        if (kind === 'transition') {
            return !!(item && ((Array.isArray(item.endpoints)
                    && item.endpoints.some(endpoint => isEndpointRevealed(item, endpoint)))
                || (isPlayerView() && isCameraFeedRevealed(item, kind))));
        }
        return !!(item && (item.revealed || isDiscovered(kind, item.id)
            || (isPlayerView() && isCameraFeedRevealed(item, kind))));
    }
    function persistDiscoveries() {
        try { localStorage.setItem(DISCOVERIES_KEY, JSON.stringify(discoveries)); }
        catch (error) { console.warn('Sauvegarde locale des découvertes impossible', error); }
    }
    function applyRemoteDiscoveries(remoteDiscoveries) {
        discoveries = Array.isArray(remoteDiscoveries) ? remoteDiscoveries.filter(isPlainObject) : [];
        migrateTransitionDiscoveries();
        persistDiscoveries();
    }

    /* Migration : la découverte d'une liaison était enregistrée au niveau
       transition et révélait d'un coup TOUS ses points sur tous les étages,
       même jamais visités. Elle est désormais par point de passage. Les
       anciens enregistrements sont éclatés vers les seuls points de l'étage
       où la découverte a eu lieu (`floorId` de l'enregistrement) ; les
       autres sorties redeviennent cachées. Un enregistrement dont la
       transition n'est pas (encore) dans le plan est conservé tel quel et
       sera migré à la prochaine passe. Côté MJ connecté, la conversion est
       poussée au cloud pour que tous les écrans convergent — MAIS un
       enregistrement récent n'est pas supprimé du cloud : il vient
       probablement d'un écran qui tourne encore l'ancienne version du code
       (onglet jamais rechargé, cache) et le lui retirer ferait « disparaître »
       sa découverte sous ses yeux à chaque tentative. Il sera purgé une fois
       vieux, quand tous les écrans auront rechargé. */
    const LEGACY_DISCOVERY_GRACE_MS = 6 * 60 * 60 * 1000;
    function migrateTransitionDiscoveries() {
        const legacy = discoveries.filter(discovery => discovery.kind === 'transition'
            && findTransition(discovery.elementId));
        if (!legacy.length) return false;
        const additions = [];
        legacy.forEach(discovery => {
            const transition = findTransition(discovery.elementId);
            transition.endpoints
                .filter(endpoint => endpoint.floorId === discovery.floorId)
                .forEach(endpoint => {
                    if (isDiscovered('endpoint', endpoint.id)) return;
                    additions.push({
                        id: discoveryKey('endpoint', endpoint.id), kind: 'endpoint',
                        elementId: endpoint.id, floorId: endpoint.floorId,
                        discoveredBy: discovery.discoveredBy, discoveredAt: discovery.discoveredAt
                    });
                });
        });
        const legacyIds = new Set(legacy.map(discovery => discovery.id));
        discoveries = discoveries.filter(discovery => !legacyIds.has(discovery.id)).concat(additions);
        if (cloudActive && window.Cloud && !ui.readOnly) {
            if (typeof window.Cloud.saveDiscovery === 'function') {
                additions.forEach(discovery => window.Cloud.saveDiscovery(cloneData(discovery))
                    .catch(error => console.warn('Migration de découverte conservée localement', error)));
            }
            const stale = legacy.filter(discovery =>
                Date.now() - (discovery.discoveredAt || 0) > LEGACY_DISCOVERY_GRACE_MS);
            if (stale.length && typeof window.Cloud.deleteDiscoveries === 'function') {
                window.Cloud.deleteDiscoveries(stale.map(discovery => discovery.id)).catch(error =>
                    console.warn('Suppression des découvertes migrées différée', error));
            }
        }
        return true;
    }

    /* Retire une découverte automatique précise (œil MJ « cacher » sur un
       élément que les pions avaient découvert). */
    function removeDiscovery(kind, elementId) {
        const key = discoveryKey(kind, elementId);
        const before = discoveries.length;
        discoveries = discoveries.filter(discovery => discovery.id !== key);
        if (discoveries.length === before) return false;
        persistDiscoveries();
        if (cloudActive && window.Cloud && typeof window.Cloud.deleteDiscoveries === 'function' && !ui.readOnly) {
            window.Cloud.deleteDiscoveries([key]).catch(error =>
                console.warn('Suppression de la découverte différée', error));
        }
        return true;
    }
    function addDiscovery(kind, item, tokenId, floorId) {
        if (!item || isDiscovered(kind, item.id)) return false;
        const discovery = {
            id: discoveryKey(kind, item.id), kind, elementId: item.id,
            floorId: floorId || item.floorId || item.id, discoveredBy: tokenId,
            discoveredAt: Date.now()
        };
        discoveries.push(discovery);
        persistDiscoveries();
        if (cloudActive && window.Cloud && typeof window.Cloud.saveDiscovery === 'function') {
            window.Cloud.saveDiscovery(cloneData(discovery)).catch(error =>
                console.warn('Découverte conservée localement', error));
        }
        return true;
    }
    function resetDiscoveries(floorId) {
        const removed = discoveries.filter(discovery => !floorId || discovery.floorId === floorId);
        discoveries = discoveries.filter(discovery => floorId && discovery.floorId !== floorId);
        persistDiscoveries();
        if (cloudActive && window.Cloud && typeof window.Cloud.deleteDiscoveries === 'function' && !ui.readOnly) {
            window.Cloud.deleteDiscoveries(removed.map(discovery => discovery.id)).catch(error =>
                console.warn('Réinitialisation des découvertes différée', error));
        }
        return removed.length;
    }

    /* Cascade d'état du POC : un appareil lié à un nœud non-actif hérite de son état */
    function getEffectiveState(ent) {
        if (ent.type === 'network_node' || !ent.networkId) return ent.state;
        const parentNode = findEntity(ent.networkId);
        if (parentNode && parentNode.state !== 'active') return parentNode.state;
        return ent.state;
    }

    function isDecorAccessController(ent) {
        return !!ent && DECOR_ACCESS_CONTROL_TYPES.includes(ent.type);
    }

    function getAccessController(item) {
        if (!item || !item.accessEntityId) return null;
        return findEntity(item.accessEntityId) || null;
    }

    function isAccessOpen(item) {
        const controller = getAccessController(item);
        return !!controller && getEffectiveState(controller) !== 'active';
    }

    function isPatrolBlockedState(state) {
        return state === 'offline' || state === 'neutralized';
    }

    function setEntityState(ent, state) {
        const affected = [ent];
        if (ent.type === 'network_node') {
            plan.entities.forEach(child => {
                if (child.networkId === ent.id) affected.push(child);
            });
        }
        if (isPatrolBlockedState(state)) {
            affected.forEach(item => {
                if (item.patrol && item.patrol.moving) stopPatrol(item);
            });
        }
        ent.state = state;
        touch();
    }

    /* ============================================================
       Visibilité (phase 4) — vue joueur = mode joueur OU
       prévisualisation MJ : seul ce qui est `revealed` existe.
       Les murs (occlusion des cônes) ne sont PAS filtrés : la
       géométrie réelle découpe la couverture, révélée ou non.
       ============================================================ */
    function isPlayerView() { return ui.readOnly || ui.preview; }

    function visibleFloors() {
        const floors = sortedFloors();
        return isPlayerView() ? floors.filter(f => isEffectivelyRevealed(f, 'floor')) : floors;
    }

    function visibleRooms(floorId) {
        const rooms = floorRooms(floorId);
        return isPlayerView() ? rooms.filter(r => isEffectivelyRevealed(r, 'room')) : rooms;
    }

    function visibleEntities(floorId) {
        const ents = floorEntities(floorId);
        return isPlayerView() ? ents.filter(e => isEffectivelyRevealed(e, 'entity')) : ents;
    }

    function visibleDecors(floorId) {
        const decors = floorDecors(floorId);
        return isPlayerView() ? decors.filter(decor => isEffectivelyRevealed(decor, 'decor')) : decors;
    }

    function visibleTokens(floorId) {
        const items = floorTokens(floorId);
        return isPlayerView() ? items.filter(token => token.visible) : items;
    }

    function visibleTransitions(floorId) {
        return plan.transitions.filter(transition =>
            transition.endpoints.some(endpoint => endpoint.floorId === floorId)
            && (!isPlayerView() || isEffectivelyRevealed(transition, 'transition')));
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
        if (sel.kind === 'entity') { const e = findEntity(sel.id); visible = isEffectivelyRevealed(e, 'entity') || isCameraFeedVisible(e, 'entity'); }
        else if (sel.kind === 'room') { const r = findRoom(sel.id); visible = isEffectivelyRevealed(r, 'room'); }
        else if (sel.kind === 'decor') { const d = findDecor(sel.id); visible = isEffectivelyRevealed(d, 'decor') || isCameraFeedVisible(d, 'decor'); }
        else if (sel.kind === 'floor') { const f = findFloor(sel.id); visible = isEffectivelyRevealed(f, 'floor'); }
        else if (sel.kind === 'token') { const token = findToken(sel.id); visible = !!(token && token.visible); }
        else if (sel.kind === 'transition') { const transition = findTransition(sel.id); visible = isEffectivelyRevealed(transition, 'transition') || isCameraFeedVisible(transition, 'transition'); }
        if (!visible) ui.selection = null;
    }

    function isCameraFeedVisible(item, kind) {
        return !!(item && typeof MapView !== 'undefined'
            && typeof MapView.isCameraFeedVisible === 'function'
            && MapView.isCameraFeedVisible(item, kind, Date.now()));
    }

    /* --- Mutations : étages --- */
    function addFloor(name) {
        const maxOrder = plan.floors.reduce((m, f) => Math.max(m, f.order), -1);
        const floor = { id: uid('f'), name: name || 'Niveau ' + (plan.floors.length + 1), order: maxOrder + 1, revealed: false };
        plan.floors.push(floor);
        // 7.8 (amendé) : toute gaine dont la borne correspondante est
        // automatique s'étend au nouvel étage, porte ouverte par défaut —
        // le MJ retire les portes non désirées depuis l'inspecteur. Une
        // borne figée explicitement n'est pas dépassée.
        plan.transitions.forEach(transition => {
            if (transition.type !== 'elevator' || Number.isInteger(transition.maxFloorOrder)) return;
            const anchor = transition.endpoints[0];
            if (!anchor || transition.endpoints.some(item => item.floorId === floor.id)) return;
            transition.endpoints.push({
                id: uid('ep'), floorId: floor.id, x: anchor.x, y: anchor.y,
                label: floor.name, hasDoor: true, revealed: false
            });
        });
        touch();
        return floor;
    }

    function deleteFloor(floorId) {
        if (plan.floors.length <= 1) return false;
        const previousOrders = captureFloorOrders();
        plan.rooms = plan.rooms.filter(r => r.floorId !== floorId);
        plan.decors = plan.decors.filter(decor => decor.floorId !== floorId);
        plan.transitions.forEach(transition => {
            transition.endpoints = transition.endpoints.filter(endpoint => endpoint.floorId !== floorId);
        });
        plan.transitions = plan.transitions.filter(transition => transition.endpoints.length > 0);
        tokens = tokens.filter(token => token.floorId !== floorId);
        persistTokens();
        // Déconnecte les appareils liés à des nœuds de l'étage supprimé
        const removedIds = new Set(plan.entities.filter(e => e.floorId === floorId).map(e => e.id));
        plan.entities = plan.entities.filter(e => e.floorId !== floorId);
        plan.entities.forEach(e => { if (removedIds.has(e.networkId)) e.networkId = ''; });
        plan.decors.forEach(decor => {
            if (removedIds.has(decor.accessEntityId)) decor.accessEntityId = '';
        });
        plan.transitions.forEach(transition => {
            if (removedIds.has(transition.accessEntityId)) transition.accessEntityId = '';
        });
        plan.floors = plan.floors.filter(f => f.id !== floorId);
        sortedFloors().forEach((f, i) => f.order = i);
        remapElevatorBounds(previousOrders);
        if (ui.currentFloorId === floorId) ui.currentFloorId = sortedFloors()[0].id;
        touch();
        return true;
    }

    function moveFloor(floorId, delta) {
        const floors = sortedFloors();
        const idx = floors.findIndex(f => f.id === floorId);
        const target = idx + delta;
        if (idx < 0 || target < 0 || target >= floors.length) return;
        const previousOrders = captureFloorOrders();
        [floors[idx].order, floors[target].order] = [floors[target].order, floors[idx].order];
        remapElevatorBounds(previousOrders);
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

    /* --- Mutations : décors --- */
    function addDecor(type, floorId, x, y) {
        const definition = typeof DecorCatalog !== 'undefined'
            ? DecorCatalog.get(type) : { name: 'Décor', width: 1, height: 1 };
        const decor = normalizeDecor({
            id: uid('d'), floorId, type,
            name: definition.name,
            x, y,
            width: definition.width,
            height: definition.height,
            rotation: 0,
            revealed: false,
            autoDiscover: definition.autoDiscover,
            blocksMovement: definition.blocksMovement,
            blocksVision: [...definition.blocksVision],
            accessEntityId: '',
            privateNote: '',
            playerInfo: ''
        });
        plan.decors.push(decor);
        touch();
        return decor;
    }

    function duplicateDecor(source) {
        if (!source) return null;
        const decor = cloneData(source);
        decor.id = uid('d');
        decor.name = source.name + ' copie';
        decor.x = clampNumber(source.x + 0.5, 0, plan.grid.cols, source.x);
        decor.y = clampNumber(source.y + 0.5, 0, plan.grid.rows, source.y);
        normalizeDecor(decor);
        plan.decors.push(decor);
        touch('Dupliquer un décor');
        return decor;
    }

    function deleteDecor(decorId) {
        plan.decors = plan.decors.filter(decor => decor.id !== decorId);
        touch();
    }

    /* --- Mutations : transitions multi-étages --- */
    function addTransition(type, name) {
        const transition = normalizeTransition({
            id: uid('tr'), type: type || 'stairs', name: name || 'Nouvelle liaison',
            bidirectional: true, state: 'active', revealed: false,
            accessEntityId: '', endpoints: []
        }, plan.grid, plan.floors);
        plan.transitions.push(transition);
        touch();
        return transition;
    }

    /* Renvoie null sans muter si l'ajout est refusé. Escaliers, échelles et
       ascenseurs partagent une position unique sur tous les étages reliés. */
    function addTransitionEndpoint(transition, floorId, x, y, label) {
        if (SHARED_POSITION_TRANSITION_TYPES.has(transition.type)
            && transition.endpoints.some(item => item.floorId === floorId)) return null;
        if (transition.type === 'elevator') {
            const floor = findFloor(floorId);
            const range = elevatorFloorRange(transition);
            if (!floor || (range && (floor.order < range.min || floor.order > range.max))) return null;
        }
        const anchor = SHARED_POSITION_TRANSITION_TYPES.has(transition.type)
            ? transition.endpoints[0] : null;
        const endpoint = {
            id: uid('ep'), floorId,
            x: clampNumber(anchor ? anchor.x : x, 0.5, Math.max(0.5, plan.grid.cols - 0.5), 0.5),
            y: clampNumber(anchor ? anchor.y : y, 0.5, Math.max(0.5, plan.grid.rows - 0.5), 0.5),
            label: label || (findFloor(floorId) ? findFloor(floorId).name : ''),
            revealed: false
        };
        if (transition.type === 'elevator') endpoint.hasDoor = true;
        transition.endpoints.push(endpoint);
        touch();
        return endpoint;
    }

    function setTransitionFloorConnected(transition, floorId, connected, x, y) {
        if (!transition || !['stairs', 'ladder'].includes(transition.type)
            || !findFloor(floorId)) return false;
        const existing = transition.endpoints.find(endpoint => endpoint.floorId === floorId);
        if (connected) {
            if (existing) return false;
            return !!addTransitionEndpoint(transition, floorId, x, y);
        }
        if (!existing || transition.endpoints.length <= 1) return false;
        transition.endpoints = transition.endpoints.filter(endpoint => endpoint.id !== existing.id);
        touch('Modifier les étages raccordés');
        return true;
    }

    /* Crée les arrêts manquants d'un ascenseur sur tous les étages de sa
       desserte, porte ouverte par défaut : le MJ retire ensuite les portes
       qu'il ne veut pas (ascenseur des étages pairs, etc.). Les x/y du
       premier arrêt servent d'ancre à toute la gaine. */
    function populateElevatorStops(transition, x, y) {
        if (!transition || transition.type !== 'elevator') return 0;
        const range = elevatorFloorRange(transition);
        if (!range) return 0;
        const anchor = transition.endpoints[0];
        const anchorX = clampNumber(anchor ? anchor.x : x, 0.5, Math.max(0.5, plan.grid.cols - 0.5), 0.5);
        const anchorY = clampNumber(anchor ? anchor.y : y, 0.5, Math.max(0.5, plan.grid.rows - 0.5), 0.5);
        let added = 0;
        sortedFloors().forEach(floor => {
            if (floor.order < range.min || floor.order > range.max) return;
            if (transition.endpoints.some(item => item.floorId === floor.id)) return;
            transition.endpoints.push({
                id: uid('ep'), floorId: floor.id, x: anchorX, y: anchorY,
                label: floor.name, hasDoor: true, revealed: false
            });
            added += 1;
        });
        if (added) touch('Créer les arrêts d\'un ascenseur');
        return added;
    }

    function setElevatorStopEnabled(transition, floorId, enabled, x, y) {
        if (!transition || transition.type !== 'elevator') return false;
        const floor = findFloor(floorId);
        const range = elevatorFloorRange(transition);
        if (!floor || !range || floor.order < range.min || floor.order > range.max) return false;
        let endpoint = transition.endpoints.find(item => item.floorId === floorId);
        if (!endpoint && enabled) {
            endpoint = addTransitionEndpoint(transition, floorId, x, y);
            return !!endpoint;
        }
        if (!endpoint || endpoint.hasDoor === enabled) return false;
        endpoint.hasDoor = enabled;
        touch('Modifier un arrêt d\'ascenseur');
        return true;
    }

    /* Changement de nature : renormalise les champs spécifiques au type et
       aligne les positions lors d'un passage vers escalier ou échelle. */
    function setTransitionType(transition, type) {
        if (!TRANSITION_TYPES.includes(type) || transition.type === type) return false;
        transition.type = type;
        normalizeTransition(transition, plan.grid, plan.floors);
        touch('Changer la nature d\'une liaison');
        return true;
    }

    function setStairsDirection(transition, direction) {
        if (!transition || transition.type !== 'stairs'
            || !STAIRS_DIRECTIONS.includes(direction)) return false;
        transition.direction = direction;
        touch('Changer le sens d\'un escalier');
        return true;
    }

    /* Endpoints qui sortiraient de la plage si la borne était modifiée —
       utilisé pour la confirmation avant `setElevatorBound`. */
    function elevatorEndpointsOutOfRange(transition, which, order) {
        if (!transition || transition.type !== 'elevator') return [];
        const probe = {
            type: 'elevator',
            minFloorOrder: which === 'min' ? order : transition.minFloorOrder,
            maxFloorOrder: which === 'max' ? order : transition.maxFloorOrder
        };
        const range = elevatorFloorRange(probe);
        if (!range) return [];
        return transition.endpoints.filter(endpoint => {
            const floor = findFloor(endpoint.floorId);
            return !floor || floor.order < range.min || floor.order > range.max;
        });
    }

    /* Applique une borne de desserte (`null` = automatique) et supprime les
       endpoints hors plage. Renvoie les endpoints supprimés. */
    function setElevatorBound(transition, which, order) {
        if (!transition || transition.type !== 'elevator') return null;
        const removed = elevatorEndpointsOutOfRange(transition, which, order);
        transition[which === 'min' ? 'minFloorOrder' : 'maxFloorOrder']
            = Number.isInteger(order) ? order : null;
        if (removed.length) {
            const ids = new Set(removed.map(endpoint => endpoint.id));
            transition.endpoints = transition.endpoints.filter(endpoint => !ids.has(endpoint.id));
        }
        touch('Modifier la desserte d\'un ascenseur');
        return removed;
    }

    /* 7.10 : décors historiques rendus obsolètes par la cabine générée.
       La suppression est un outil MJ explicite, jamais une migration
       silencieuse ; la confirmation se fait côté interface. */
    const LEGACY_TRANSITION_DECOR_TYPES = ['elevator_decor', 'stairs'];

    function listLegacyTransitionDecors() {
        return plan.decors
            .filter(decor => LEGACY_TRANSITION_DECOR_TYPES.includes(decor.type))
            .map(decor => ({ decor, floor: findFloor(decor.floorId) || null }))
            .sort((a, b) => {
                const orderA = a.floor ? a.floor.order : Infinity;
                const orderB = b.floor ? b.floor.order : Infinity;
                return orderA - orderB || a.decor.name.localeCompare(b.decor.name);
            });
    }

    function purgeLegacyTransitionDecors() {
        const items = listLegacyTransitionDecors();
        if (!items.length) return 0;
        return transaction('Supprimer les décors de liaison obsolètes', () => {
            const ids = new Set(items.map(item => item.decor.id));
            plan.decors = plan.decors.filter(decor => !ids.has(decor.id));
            touch('Supprimer les décors de liaison obsolètes');
            return items.length;
        });
    }

    /* Remise à zéro complète : plan vierge (un seul étage vide, nom et
       grille conservés, révision cloud préservée pour la synchronisation),
       pions et découvertes supprimés. La confirmation et la sauvegarde
       préalable sont à la charge de l'interface. */
    function resetPlan() {
        const result = transaction('Tout supprimer', () => {
            const fresh = {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                revision: Number.isInteger(plan.revision) ? plan.revision : 0,
                name: plan.name,
                updatedAt: Date.now(),
                grid: cloneData(plan.grid),
                floors: [{ id: uid('f'), name: 'Niveau 1', order: 0, revealed: true }],
                rooms: [], entities: [], decors: [], transitions: []
            };
            plan = preparePlan(fresh).plan;
            repairUiAfterPlanChange();
            conflict = null;
            touch('Tout supprimer');
            persistLocal();
            return plan;
        });
        tokens.slice().forEach(token => deleteToken(token.id));
        resetDiscoveries();
        return result;
    }

    function removeTransitionEndpoint(transition, endpointId) {
        transition.endpoints = transition.endpoints.filter(endpoint => endpoint.id !== endpointId);
        if (transition.endpoints.length === 0) deleteTransition(transition.id);
        else touch();
    }

    function deleteTransition(transitionId) {
        plan.transitions = plan.transitions.filter(transition => transition.id !== transitionId);
        touch();
    }

    /* --- Mutations : entités --- */
    function addEntity(type, floorId, x, y, defaultName) {
        const resolvedType = typeof EntityCatalog !== 'undefined'
            ? EntityCatalog.resolveType(type) : type;
        const definition = typeof EntityCatalog !== 'undefined'
            ? EntityCatalog.get(resolvedType) : { autoDiscover: true };
        const ent = {
            id: uid('e'),
            floorId: floorId,
            type: resolvedType,
            name: defaultName + '_' + Math.floor(Math.random() * 900 + 100),
            state: 'active',
            networkId: '',
            x: x,
            y: y,
            revealed: false,
            autoDiscover: definition.autoDiscover,
            privateNote: '',
            playerInfo: '',
            patrol: null,
            coverage: null
        };
        if (definition.coverageType && definition.coverageType !== 'none') {
            ent.coverage = coverageDefaults(ent, {});
        }
        plan.entities.push(ent);
        touch();
        return ent;
    }

    function duplicateEntity(source) {
        if (!source) return null;
        const ent = cloneData(source);
        ent.id = uid('e');
        ent.name = source.name + ' copie';
        ent.x = clampNumber(source.x + 0.5, 0.5, Math.max(0.5, plan.grid.cols - 0.5), source.x);
        ent.y = clampNumber(source.y + 0.5, 0.5, Math.max(0.5, plan.grid.rows - 0.5), source.y);
        if (ent.patrol) {
            ent.patrol.moving = false;
            ent.patrol.anchorAt = 0;
            ent.patrol.points = ent.patrol.points.map(point => ({
                x: clampNumber(point.x + 0.5, 0, plan.grid.cols, point.x),
                y: clampNumber(point.y + 0.5, 0, plan.grid.rows, point.y)
            }));
        }
        plan.entities.push(ent);
        touch('Dupliquer un dispositif');
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
        return transaction('Effacer une ronde', () => {
            stopPatrol(ent);
            ent.patrol = null;
            touch('Effacer une ronde');
        });
    }

    function removePatrolPoint(ent, index) {
        if (!ent || !ent.patrol || index < 0 || index >= ent.patrol.points.length) return false;
        return transaction('Supprimer un waypoint', () => {
            if (ent.patrol.moving) stopPatrol(ent);
            ent.patrol.points.splice(index, 1);
            touch('Supprimer un waypoint');
            return true;
        });
    }

    function movePatrolPoint(ent, fromIndex, toIndex) {
        if (!ent || !ent.patrol || fromIndex < 0 || toIndex < 0
            || fromIndex >= ent.patrol.points.length || toIndex >= ent.patrol.points.length
            || fromIndex === toIndex) return false;
        return transaction('Réordonner les waypoints', () => {
            if (ent.patrol.moving) stopPatrol(ent);
            const point = ent.patrol.points.splice(fromIndex, 1)[0];
            ent.patrol.points.splice(toIndex, 0, point);
            touch('Réordonner les waypoints');
            return true;
        });
    }

    function reversePatrol(ent) {
        if (!ent || !ent.patrol || ent.patrol.points.length < 2) return false;
        return transaction('Inverser la ronde', () => {
            if (ent.patrol.moving) stopPatrol(ent);
            ent.patrol.points.reverse();
            touch('Inverser la ronde');
            return true;
        });
    }

    function startPatrol(ent) {
        if (!ent.patrol || ent.patrol.points.length < 2) return false;
        if (isPatrolBlockedState(getEffectiveState(ent))) return false;
        ent.patrol.moving = true;
        ent.patrol.anchorAt = Date.now();
        touch();
        return true;
    }

    /* Stoppe la ronde en figeant la position animée dans x/y */
    function stopPatrol(ent) {
        if (!ent.patrol || !ent.patrol.moving) return;
        const pose = Anim.patrolPose(ent.patrol, Date.now());
        if (pose) {
            ent.x = Math.round(pose.x * 100) / 100;
            ent.y = Math.round(pose.y * 100) / 100;
            // Une fois arrêté, le mobile continue de regarder dans la dernière
            // direction parcourue. Le balayage conserve son amplitude relative.
            if (pose.direction !== null && ent.coverage && ent.coverage.shape === 'cone') {
                const previousDirection = ent.coverage.direction;
                ent.coverage.direction = pose.direction;
                if (ent.coverage.sweep) {
                    ent.coverage.sweep.from = pose.direction
                        + (ent.coverage.sweep.from - previousDirection);
                    ent.coverage.sweep.to = pose.direction
                        + (ent.coverage.sweep.to - previousDirection);
                }
            }
        }
        ent.patrol.moving = false;
        touch();
    }

    function setPatrolSpeed(ent, speed, now) {
        if (!ent.patrol) return false;
        const nextSpeed = Math.max(0.1, Math.min(10, Number(speed) || 1));
        const p = ent.patrol;
        const at = Number.isFinite(now) ? now : Date.now();
        if (p.moving) {
            const previousSpeed = p.speed > 0 ? p.speed : 1;
            const elapsed = (at - (p.anchorAt || at)) / 1000;
            p.anchorAt = at - (elapsed * previousSpeed / nextSpeed) * 1000;
        }
        p.speed = nextSpeed;
        touch();
        return true;
    }

    function setPatrolLoop(ent, loop) {
        if (!ent.patrol) return false;
        return transaction('Modifier le parcours de ronde', () => {
            if (ent.patrol.moving) stopPatrol(ent);
            ent.patrol.loop = !!loop;
            touch('Modifier le parcours de ronde');
            return true;
        });
    }

    /* --- Mutations : zones de couverture --- */
    function createCoverage(ent) {
        ent.coverage = coverageDefaults(ent, {});
        touch();
        return ent.coverage;
    }

    function clearCoverage(ent) {
        ent.coverage = null;
        touch();
    }

    function resetCoverage(ent) {
        const revealed = !!(ent.coverage && ent.coverage.revealed);
        ent.coverage = coverageDefaults(ent, {});
        ent.coverage.revealed = revealed;
        touch('Réinitialiser une couverture');
        return ent.coverage;
    }

    function setCoverageSweep(ent, enabled) {
        if (!ent.coverage) return;
        if (enabled) {
            ent.coverage.sweep = {
                from: ent.coverage.direction - 45,
                to: ent.coverage.direction + 45,
                period: 8,
                anchorAt: Date.now()
            };
        } else {
            // fige la direction courante du balayage
            ent.coverage.direction = Math.round(Anim.coverageDirection(ent, Date.now()));
            ent.coverage.sweep = null;
        }
        touch();
    }

    // Compatibilité temporaire pour les extensions qui utilisaient l'API v1.
    const createVision = createCoverage;
    const clearVision = clearCoverage;
    const setSweep = setCoverageSweep;

    function deleteEntity(entityId) {
        plan.entities = plan.entities.filter(e => e.id !== entityId);
        plan.entities.forEach(e => { if (e.networkId === entityId) e.networkId = ''; });
        plan.decors.forEach(decor => {
            if (decor.accessEntityId === entityId) decor.accessEntityId = '';
        });
        plan.transitions.forEach(transition => {
            if (transition.accessEntityId === entityId) transition.accessEntityId = '';
        });
        touch();
    }

    return {
        ui, load, touch, saveNow, setSaveStatus, handlePageHide,
        transaction, beginTransaction, endTransaction, cancelTransaction,
        undo, redo, getHistoryState, resetHistory,
        setCloudActive, isCloudActive, applyRemotePlan,
        hasPendingChanges, isSaveInFlight, getConflict, markRemoteConflict,
        resolveConflictWithRemote, resolveConflictWithLocal,
        backupCurrentPlan, listBackups, restoreBackup, deleteBackup,
        exportJson, replacePlan,
        CURRENT_SCHEMA_VERSION, createDefaultPlan: defaultPlan,
        migratePlan, validatePlan, preparePlan,
        getPlan, sortedFloors, currentFloor, floorRooms, floorEntities, floorDecors,
        getTokens, floorTokens, getDiscoveries,
        findEntity, findRoom, findDecor, findFloor, findToken, findTransition,
        getEffectiveState, setEntityState,
        isDecorAccessController, getAccessController, isAccessOpen,
        getOverlayPreferences, setOverlayVisibility,
        getInspectorViewState, setInspectorViewState,
        isPlayerView, isDiscovered, isEffectivelyRevealed, isEndpointRevealed, endpointLetter,
        cameraFeedCameras, isCameraFeedRevealed,
        visibleFloors, visibleRooms, visibleEntities, visibleDecors, visibleTokens, visibleTransitions,
        ensureVisibleView,
        applyRemoteTokens, saveToken, commitTokenPosition, addToken, duplicateToken, deleteToken,
        applyRemoteDiscoveries, addDiscovery, removeDiscovery, resetDiscoveries,
        addFloor, deleteFloor, moveFloor,
        addRoom, paintCell, eraseCell, deleteRoom, roomAt,
        addDecor, duplicateDecor, deleteDecor,
        addTransition, addTransitionEndpoint, setTransitionFloorConnected,
        removeTransitionEndpoint, deleteTransition,
        populateElevatorStops, setElevatorStopEnabled,
        setTransitionType, setStairsDirection, stairsExitDirection,
        elevatorFloorRange, elevatorCabinsOnFloor,
        elevatorEndpointsOutOfRange, setElevatorBound,
        listLegacyTransitionDecors, purgeLegacyTransitionDecors, resetPlan,
        addEntity, duplicateEntity, deleteEntity,
        createPatrol, clearPatrol, startPatrol, stopPatrol,
        setPatrolSpeed, setPatrolLoop, removePatrolPoint, movePatrolPoint, reversePatrol,
        createCoverage, clearCoverage, resetCoverage, setCoverageSweep,
        createVision, clearVision, setSweep,
        getMutationSeq: () => mutationSeq
    };
})();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function makeStorage() {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
        clear: () => values.clear(),
        key: index => [...values.keys()][index] || null,
        get length() { return values.size; }
    };
}

function loadApplicationCore() {
    const localStorage = makeStorage();
    const context = vm.createContext({
        console,
        localStorage,
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
        },
        document: {
            getElementById: () => null,
            dispatchEvent: () => true
        },
        window: {}
    });
    context.window = context;
    ['catalog.js', 'anim.js', 'store.js', 'map.js', 'exploration.js'].forEach(file => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), context, {
            filename: file
        });
    });
    return {
        context,
        Store: vm.runInContext('Store', context),
        Anim: vm.runInContext('Anim', context),
        MapView: vm.runInContext('MapView', context),
        EntityCatalog: vm.runInContext('EntityCatalog', context),
        Exploration: vm.runInContext('Exploration', context)
    };
}

test('la fixture de production v1 migre sans perdre sa géométrie', () => {
    const { Store } = loadApplicationCore();
    const source = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/plan-v1-production.json'), 'utf8'));
    const cellCount = source.rooms.reduce((sum, room) => sum + room.cells.length, 0);
    const result = Store.preparePlan(source);
    assert.equal(result.migratedFrom, 1);
    assert.equal(result.plan.schemaVersion, 2);
    assert.equal(result.plan.rooms.reduce((sum, room) => sum + room.cells.length, 0), cellCount);
    assert.deepEqual(result.plan.floors.map(item => item.id), source.floors.map(item => item.id));
});

test('un plan irrécupérable est rejeté', () => {
    const { Store } = loadApplicationCore();
    assert.throws(() => Store.preparePlan({ schemaVersion: 2 }), /Plan invalide/);
    assert.throws(() => Store.preparePlan({ schemaVersion: 999 }), /schéma plus récent/);
});

test('une transaction de saisie produit une seule entrée annulable', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const original = Store.getPlan().name;
    Store.beginTransaction('Renommer le plan');
    Store.getPlan().name = 'Intermédiaire'; Store.touch();
    Store.getPlan().name = 'Final'; Store.touch();
    Store.endTransaction();
    assert.equal(Store.getHistoryState().length, 1);
    assert.equal(Store.undo(), 'Renommer le plan');
    assert.equal(Store.getPlan().name, original);
    assert.equal(Store.redo(), 'Renommer le plan');
    assert.equal(Store.getPlan().name, 'Final');
});

test('l’état de l’encart d’inspecteur se valide et persiste (E2)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    // Défaut = aperçu (compact).
    assert.equal(Store.getInspectorViewState(), 'compact');
    // Transitions valides acceptées.
    assert.equal(Store.setInspectorViewState('full'), true);
    assert.equal(Store.getInspectorViewState(), 'full');
    assert.equal(Store.setInspectorViewState('collapsed'), true);
    assert.equal(Store.getInspectorViewState(), 'collapsed');
    // Valeur inconnue rejetée sans changer l'état courant.
    assert.equal(Store.setInspectorViewState('huge'), false);
    assert.equal(Store.getInspectorViewState(), 'collapsed');
    // Persistance : un rechargement relit l'état depuis localStorage.
    Store.setInspectorViewState('full');
    Store.load();
    assert.equal(Store.getInspectorViewState(), 'full');
});

test('l’historique conserve au plus cinquante actions', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    for (let index = 0; index < 55; index += 1) {
        Store.getPlan().name = 'Action ' + index;
        Store.touch('Action ' + index);
    }
    assert.equal(Store.getHistoryState().length, 50);
});

test('la duplication d’un dispositif et d’un décor crée des objets indépendants', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    const entity = Store.addEntity('guard', floor.id, 3, 3, 'Garde');
    entity.privateNote = 'secret';
    const entityCopy = Store.duplicateEntity(entity);
    assert.notEqual(entityCopy.id, entity.id);
    assert.equal(entityCopy.privateNote, 'secret');
    assert.equal(entityCopy.x, 3.5);

    const decor = Store.addDecor('counter', floor.id, 5, 5);
    decor.playerInfo = 'guichet';
    const decorCopy = Store.duplicateDecor(decor);
    assert.notEqual(decorCopy.id, decor.id);
    assert.equal(decorCopy.playerInfo, 'guichet');
});

test('les versions locales sont limitées à quinze et restaurables', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    for (let index = 0; index < 20; index += 1) {
        Store.getPlan().name = 'Version ' + index;
        Store.backupCurrentPlan('test-' + index);
    }
    const backups = Store.listBackups();
    assert.equal(backups.length, 15);
    const version = backups.find(item => item.plan.name === 'Version 10');
    assert.ok(version);
    Store.getPlan().name = 'Version courante';
    assert.equal(Store.restoreBackup(version.key), true);
    assert.equal(Store.getPlan().name, 'Version 10');
});

test('une couverture retrouve ses valeurs catalogue sans perdre sa visibilité', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    const camera = Store.addEntity('camera', floor.id, 3, 3, 'Caméra');
    camera.coverage.shape = 'beam';
    camera.coverage.range = 19;
    camera.coverage.revealed = true;
    Store.resetCoverage(camera);
    assert.equal(camera.coverage.shape, 'cone');
    assert.equal(camera.coverage.range, 6);
    assert.equal(camera.coverage.revealed, true);
});

test('les waypoints sont supprimables, réordonnables et inversables', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    const guard = Store.addEntity('guard', floor.id, 2, 2, 'Garde');
    Store.createPatrol(guard);
    guard.patrol.points.push({ x: 4, y: 4 }, { x: 8, y: 6 });
    assert.equal(Store.movePatrolPoint(guard, 2, 1), true);
    assert.equal(guard.patrol.points[1].x, 8);
    assert.equal(Store.reversePatrol(guard), true);
    assert.equal(guard.patrol.points[0].x, 4);
    assert.equal(Store.removePatrolPoint(guard, 1), true);
    assert.equal(guard.patrol.points.length, 2);
});

test('les calculs de ronde et de couverture restent déterministes', () => {
    const { Anim, MapView } = loadApplicationCore();
    const patrol = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        loop: false,
        moving: true,
        speed: 1,
        anchorAt: 0
    };
    const position = Anim.patrolPosition(patrol, 5000);
    assert.equal(position.x, 5);
    assert.equal(position.y, 0);
    const cone = MapView.conePolygon(5, 5, 0, 60, 4, []);
    assert.ok(cone.length > 3);
    assert.equal(cone[0][0], 5);
    assert.equal(cone[0][1], 5);
});

test('le cap de ronde suit les virages et s’inverse sur le trajet retour', () => {
    const { Anim } = loadApplicationCore();
    const loop = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        loop: true,
        moving: true,
        speed: 1,
        anchorAt: 0
    };
    assert.equal(Anim.patrolPose(loop, 5000).direction, 0);
    assert.equal(Anim.patrolPose(loop, 15000).direction, 90);

    const shuttle = { ...loop, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], loop: false };
    const returning = Anim.patrolPose(shuttle, 15000);
    assert.equal(returning.x, 5);
    assert.equal(returning.direction, 180);
});

test('le cône d’un mobile regarde devant pendant toute sa ronde', () => {
    const { Store, Anim } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    const guard = Store.addEntity('armed_guard', floor.id, 0, 0, 'Garde');
    guard.coverage.direction = 35;
    guard.patrol = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        loop: true,
        moving: true,
        speed: 1,
        anchorAt: 0,
        revealed: false
    };

    assert.equal(Anim.coverageDirection(guard, 5000), 0);
    assert.equal(Anim.coverageDirection(guard, 15000), 90);

    guard.coverage.sweep = { from: 25, to: 45, period: 8, anchorAt: 0 };
    // À mi-course du balayage, le décalage est +10° autour du devant sud.
    assert.equal(Anim.coverageDirection(guard, 12000), 100);
});

test('arrêter une ronde conserve la dernière orientation du mobile', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    const guard = Store.addEntity('armed_guard', floor.id, 0, 0, 'Garde');
    guard.patrol = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        loop: false,
        moving: true,
        speed: 1,
        anchorAt: Date.now() - 15000,
        revealed: false
    };
    Store.stopPatrol(guard);
    assert.equal(guard.coverage.direction, 180);
    assert.ok(Math.abs(guard.x - 5) < 0.1);
});

test('une caméra piratée ouvre temporairement sa pièce et montre seulement son cône', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[1];
    const room = Store.roomAt(floor.id, 5, 7);
    Store.ui.preview = true;
    Store.ui.currentFloorId = floor.id;

    const camera = Store.addEntity('camera', floor.id, 5, 7, 'Caméra piratée');
    camera.state = 'hacked';
    camera.coverage.direction = 0;
    const visibleGuard = Store.addEntity('armed_guard', floor.id, 8, 7, 'Garde visible');
    const hiddenGuard = Store.addEntity('armed_guard', floor.id, 5, 9.5, 'Garde hors champ');
    const visibleDecor = Store.addDecor('floor_marking', floor.id, 9, 7);
    const hiddenDecor = Store.addDecor('floor_marking', floor.id, 5, 9.5);
    const transition = Store.addTransition('stairs', 'Escalier filmé');
    Store.addTransitionEndpoint(transition, floor.id, 10, 7);
    const hatch = Store.addTransition('hatch', 'Trappe filmée');
    Store.addTransitionEndpoint(hatch, floor.id, 10, 7);

    const snapshot = MapView.cameraFeedSnapshot(floor.id, 0);
    assert.ok(Store.isEffectivelyRevealed(floor, 'floor'));
    assert.ok(Store.isEffectivelyRevealed(room, 'room'));
    assert.ok(!snapshot.entityIds.includes(camera.id));
    assert.ok(snapshot.entityIds.includes(visibleGuard.id));
    assert.ok(!snapshot.entityIds.includes(hiddenGuard.id));
    assert.ok(snapshot.decorIds.includes(visibleDecor.id));
    assert.ok(!snapshot.decorIds.includes(hiddenDecor.id));
    assert.ok(snapshot.transitionIds.includes(transition.id));
    assert.ok(!snapshot.transitionIds.includes(hatch.id), 'les flux caméra ne doivent pas dévoiler les trappes');

    camera.state = 'active';
    assert.ok(!Store.isEffectivelyRevealed(floor, 'floor'));
    assert.ok(!Store.isEffectivelyRevealed(room, 'room'));
    assert.equal(MapView.cameraFeedSnapshot(floor.id, 0).entityIds.length, 0);
});

test('le flux hérite du piratage réseau et les mobiles disparaissent en sortant du cône', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[1];
    Store.ui.preview = true;
    Store.ui.currentFloorId = floor.id;

    const node = Store.addEntity('network_node', floor.id, 3, 7, 'Nœud piraté');
    node.state = 'hacked';
    const camera = Store.addEntity('camera', floor.id, 5, 7, 'Caméra liée');
    camera.networkId = node.id;
    camera.coverage.direction = 0;
    const guard = Store.addEntity('armed_guard', floor.id, 7, 7, 'Garde mobile');
    guard.patrol = {
        points: [{ x: 7, y: 7 }, { x: 7, y: 12 }],
        loop: false,
        moving: true,
        speed: 1,
        anchorAt: 0,
        revealed: false
    };

    assert.equal(Store.getEffectiveState(camera), 'hacked');
    assert.ok(MapView.cameraFeedSnapshot(floor.id, 0).entityIds.includes(guard.id));
    assert.ok(!MapView.cameraFeedSnapshot(floor.id, 4000).entityIds.includes(guard.id));

    node.state = 'active';
    assert.equal(MapView.cameraFeedSnapshot(floor.id, 0).cameraIds.length, 0);
});

test('la gaine d’un ascenseur partage strictement ses coordonnées (7.8)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Ascenseur de service');
    assert.deepEqual({ ...elevator.cabin }, { width: 2, height: 2, rotation: 0, doorSide: 'south' });
    assert.equal(elevator.minFloorOrder, null);
    assert.equal(elevator.maxFloorOrder, null);

    const first = Store.addTransitionEndpoint(elevator, floors[0].id, 12, 8);
    const second = Store.addTransitionEndpoint(elevator, floors[1].id, 3, 4);
    assert.equal(first.hasDoor, true);
    assert.equal(second.x, 12);
    assert.equal(second.y, 8);
    // Un seul arrêt par étage.
    assert.equal(Store.addTransitionEndpoint(elevator, floors[0].id, 5, 5), null);
});

test('créer un étage étend les ascenseurs à borne automatique (7.8)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const auto = Store.addTransition('elevator', 'Gaine auto');
    Store.addTransitionEndpoint(auto, floors[0].id, 12, 8);
    const frozen = Store.addTransition('elevator', 'Gaine figée');
    Store.addTransitionEndpoint(frozen, floors[0].id, 4, 4);
    frozen.maxFloorOrder = floors[floors.length - 1].order;

    const added = Store.addFloor('Niv -3 : Annexe');
    const extended = auto.endpoints.find(endpoint => endpoint.floorId === added.id);
    assert.ok(extended, 'la gaine automatique doit desservir le nouvel étage');
    assert.equal(extended.hasDoor, true, 'porte ouverte par défaut, à retirer par le MJ');
    assert.equal(extended.x, 12);
    assert.equal(extended.y, 8);
    assert.ok(!frozen.endpoints.some(endpoint => endpoint.floorId === added.id),
        'une borne figée ne doit pas être dépassée');
});

test('resserrer une borne de desserte supprime les arrêts hors plage (7.8)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Ascenseur principal');
    floors.forEach(floor => Store.addTransitionEndpoint(elevator, floor.id, 12, 8));
    assert.equal(elevator.endpoints.length, 3);

    const dropped = Store.elevatorEndpointsOutOfRange(elevator, 'max', floors[1].order);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].floorId, floors[2].id);
    const removed = Store.setElevatorBound(elevator, 'max', floors[1].order);
    assert.equal(removed.length, 1);
    assert.equal(elevator.endpoints.length, 2);
    assert.equal(elevator.maxFloorOrder, floors[1].order);

    // La cabine reste calculée sur les étages desservis, avec ou sans porte.
    elevator.endpoints[1].hasDoor = false;
    const cabins = Store.elevatorCabinsOnFloor(floors[1].id);
    assert.equal(cabins.length, 1);
    assert.equal(cabins[0].hasDoor, false);
    assert.equal(Store.elevatorCabinsOnFloor(floors[2].id).length, 0);
});

test('la gaine générée occulte comme un décor opaque (7.8)', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    const from = { x: 10, y: 5 }, to = { x: 14, y: 5 };
    assert.equal(MapView.isLineBlocked(floor.id, from, to, 'optical', 0), false);
    const elevator = Store.addTransition('elevator', 'Gaine opaque');
    Store.addTransitionEndpoint(elevator, floor.id, 12, 5);
    assert.equal(MapView.isLineBlocked(floor.id, from, to, 'optical', 0), true);
});

test('escaliers et échelles partagent leur position sur les étages cochés', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const stairs = Store.addTransition('stairs', 'Escalier de service');
    assert.equal(stairs.direction, 'both');
    Store.addTransitionEndpoint(stairs, floors[0].id, 4, 6);
    Store.addTransitionEndpoint(stairs, floors[1].id, 9, 2);
    assert.equal(Store.setTransitionFloorConnected(stairs, floors[2].id, true), true);
    assert.equal(stairs.endpoints.length, 3);
    stairs.endpoints.forEach(endpoint => {
        assert.equal(endpoint.x, 4);
        assert.equal(endpoint.y, 6);
    });
    assert.equal(Store.addTransitionEndpoint(stairs, floors[2].id, 12, 12), null,
        'un étage ne peut être raccordé qu’une fois');
    assert.equal(Store.setTransitionFloorConnected(stairs, floors[1].id, false), true);
    assert.equal(stairs.endpoints.some(endpoint => endpoint.floorId === floors[1].id), false);

    const ladder = Store.addTransition('ladder', 'Échelle technique');
    Store.addTransitionEndpoint(ladder, floors[0].id, 7, 3);
    Store.setTransitionFloorConnected(ladder, floors[2].id, true);
    assert.deepEqual(Array.from(ladder.endpoints, endpoint => [endpoint.x, endpoint.y]),
        [[7, 3], [7, 3]]);

    // La dernière coche ne peut pas être retirée : la liaison reste éditable.
    assert.equal(Store.setTransitionFloorConnected(ladder, floors[2].id, false), true);
    assert.equal(Store.setTransitionFloorConnected(ladder, floors[0].id, false), false);
    assert.equal(ladder.endpoints.length, 1);
});

test('plusieurs points d’une trappe sur un même étage reçoivent une lettre a, b, c', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const hatch = Store.addTransition('hatch', 'Trappe double');
    const a = Store.addTransitionEndpoint(hatch, floors[0].id, 3, 3);
    const b = Store.addTransitionEndpoint(hatch, floors[0].id, 8, 8);
    const other = Store.addTransitionEndpoint(hatch, floors[1].id, 5, 5);

    // Deux points sur floors[0] → a puis b dans l'ordre des endpoints.
    assert.equal(Store.endpointLetter(hatch, a), 'a');
    assert.equal(Store.endpointLetter(hatch, b), 'b');
    // Seul point de son étage → pas de lettre, le nom d'étage suffit.
    assert.equal(Store.endpointLetter(hatch, other), '');

    // Retirer le premier point : le survivant redevient l'unique point (sans lettre).
    Store.removeTransitionEndpoint(hatch, a.id);
    assert.equal(Store.endpointLetter(hatch, b), '');
});

test('le sens d’un escalier s’applique aux deux étages reliés (7.9)', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors(); // order croissant = étage plus bas
    const stairs = Store.addTransition('stairs', 'Escalier borgne');
    const upper = Store.addTransitionEndpoint(stairs, floors[0].id, 4, 6);
    const lower = Store.addTransitionEndpoint(stairs, floors[1].id, 4, 2);

    assert.equal(Store.stairsExitDirection(stairs, upper), 'down');
    assert.equal(Store.stairsExitDirection(stairs, lower), 'up');

    Store.setStairsDirection(stairs, 'up');
    assert.equal(Store.stairsExitDirection(stairs, upper), null);
    assert.equal(Store.stairsExitDirection(stairs, lower), 'up');
    assert.equal(Exploration.destinationsFor(stairs, upper).length, 0);
    assert.deepEqual(Array.from(Exploration.destinationsFor(stairs, lower), item => item.id), [upper.id]);

    Store.setStairsDirection(stairs, 'down');
    assert.deepEqual(Array.from(Exploration.destinationsFor(stairs, upper), item => item.id), [lower.id]);
    assert.equal(Exploration.destinationsFor(stairs, lower).length, 0);
});

test('l’ancien bidirectional:false d’un escalier migre en sens vertical (7.9)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const base = JSON.parse(Store.exportJson());
    const [upperFloor, lowerFloor] = [...base.floors].sort((a, b) => a.order - b.order);
    base.transitions.push({
        id: 'tr_legacy', type: 'stairs', name: 'Descente legacy', bidirectional: false,
        state: 'active', revealed: false, accessEntityId: '',
        endpoints: [
            { id: 'ep_a', floorId: upperFloor.id, x: 4, y: 6, label: '' },
            { id: 'ep_b', floorId: lowerFloor.id, x: 4, y: 2, label: '' }
        ]
    });
    const prepared = Store.preparePlan(base).plan;
    const migrated = prepared.transitions.find(item => item.id === 'tr_legacy');
    // endpoints[0] (étage haut) était le seul départ autorisé : on descend.
    assert.equal(migrated.direction, 'down');
    assert.equal(migrated.bidirectional, undefined);
});

test('un arrêt d’ascenseur sans porte n’est jamais une destination (7.8)', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Monte-charge');
    const a = Store.addTransitionEndpoint(elevator, floors[0].id, 12, 8);
    const b = Store.addTransitionEndpoint(elevator, floors[1].id, 12, 8);
    const c = Store.addTransitionEndpoint(elevator, floors[2].id, 12, 8);
    c.hasDoor = false;
    assert.deepEqual(Array.from(Exploration.destinationsFor(elevator, a), item => item.id), [b.id]);

    const token = Store.addToken(floors[0].id, 12, 8);
    assert.equal(Exploration.moveThroughTransition(token, elevator, a, c), false);
    assert.equal(Exploration.moveThroughTransition(token, elevator, a, b), true);
    assert.equal(token.floorId, floors[1].id);
});

test('emprunter une trappe ne révèle que les points traversés', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const hatch = Store.addTransition('hatch', 'Trappe à trois sorties');
    const a = Store.addTransitionEndpoint(hatch, floors[0].id, 3, 3);
    const b = Store.addTransitionEndpoint(hatch, floors[0].id, 8, 8);
    const c = Store.addTransitionEndpoint(hatch, floors[1].id, 5, 5);

    const token = Store.addToken(floors[0].id, 3, 3);
    assert.equal(Exploration.moveThroughTransition(token, hatch, a, c), true);
    // Départ et arrivée visibles, la troisième sortie reste cachée.
    assert.equal(Store.isEndpointRevealed(hatch, a), true);
    assert.equal(Store.isEndpointRevealed(hatch, c), true);
    assert.equal(Store.isEndpointRevealed(hatch, b), false);

    // L'œil MJ peut re-cacher un point découvert par les pions.
    assert.equal(Store.removeDiscovery('endpoint', a.id), true);
    assert.equal(Store.isEndpointRevealed(hatch, a), false);
});

test('les anciennes découvertes de transition migrent vers les points de leur étage', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const hatch = Store.addTransition('hatch', 'Trappe héritée');
    const a = Store.addTransitionEndpoint(hatch, floors[0].id, 3, 3);
    const b = Store.addTransitionEndpoint(hatch, floors[1].id, 5, 5);
    // Ancien enregistrement global (niveau transition), découvert sur floors[0].
    Store.applyRemoteDiscoveries([{
        id: 'transition_' + hatch.id, kind: 'transition', elementId: hatch.id,
        floorId: floors[0].id, discoveredBy: 'pion-legacy', discoveredAt: 123
    }]);
    // Seul le point de l'étage de la découverte reste visible.
    assert.equal(Store.isEndpointRevealed(hatch, a), true);
    assert.equal(Store.isEndpointRevealed(hatch, b), false);
    assert.ok(Store.getDiscoveries().every(item => item.kind !== 'transition'),
        'l’enregistrement global est remplacé par des découvertes par point');
});

test('la migration ne purge du cloud que les découvertes de transition anciennes', () => {
    const { context, Store } = loadApplicationCore();
    const deleted = [];
    const saved = [];
    context.window.Cloud = {
        saveDiscovery: discovery => { saved.push(discovery.id); return Promise.resolve({}); },
        deleteDiscoveries: ids => { deleted.push(...ids); return Promise.resolve({}); },
        savePlan: () => Promise.resolve({ revision: 1 })
    };
    Store.load();
    Store.setCloudActive(true);
    const floors = Store.sortedFloors();
    const hatch = Store.addTransition('hatch', 'Trappe mixte');
    Store.addTransitionEndpoint(hatch, floors[0].id, 3, 3);
    Store.addTransitionEndpoint(hatch, floors[1].id, 5, 5);

    // Enregistrement récent : écrit par un écran encore sur l'ancienne
    // version — converti localement mais conservé au cloud (sinon sa
    // découverte lui « disparaît » sous les yeux).
    Store.applyRemoteDiscoveries([{
        id: 'transition_' + hatch.id, kind: 'transition', elementId: hatch.id,
        floorId: floors[0].id, discoveredBy: 'vieux-client', discoveredAt: Date.now()
    }]);
    assert.deepEqual(deleted, []);
    assert.ok(saved.length >= 1, 'les découvertes par point sont poussées');
    assert.ok(Store.getDiscoveries().every(item => item.kind !== 'transition'));

    // Enregistrement ancien (> période de grâce) : purgé du cloud.
    Store.applyRemoteDiscoveries([{
        id: 'transition_' + hatch.id, kind: 'transition', elementId: hatch.id,
        floorId: floors[0].id, discoveredBy: 'vieux-client',
        discoveredAt: Date.now() - 7 * 60 * 60 * 1000
    }]);
    assert.deepEqual(deleted, ['transition_' + hatch.id]);
    Store.setCloudActive(false);
});

test('un groupe de PJ embarque ensemble et arrive en couronne sans empilement', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Cabine de service');
    const a = Store.addTransitionEndpoint(elevator, floors[0].id, 12, 8);
    const b = Store.addTransitionEndpoint(elevator, floors[1].id, 12, 8);
    const group = [
        Store.addToken(floors[0].id, 12, 8, 'Meneur'),
        Store.addToken(floors[0].id, 12.5, 8, 'Second'),
        Store.addToken(floors[0].id, 11.5, 8.5, 'Troisième')
    ];
    assert.equal(Exploration.moveGroupThroughTransition(group, elevator, a, b), 3);
    const spots = new Set();
    group.forEach(token => {
        assert.equal(token.floorId, floors[1].id);
        spots.add(token.x + '_' + token.y);
    });
    assert.equal(spots.size, 3, 'chaque pion a sa propre case d’arrivée');
    // Le meneur arrive exactement sur le point de passage.
    assert.deepEqual({ x: group[0].x, y: group[0].y }, { x: b.x, y: b.y });

    // Transition hors ligne : personne ne bouge.
    elevator.state = 'offline';
    assert.equal(Exploration.moveGroupThroughTransition(group, elevator, b, a), 0);
    group.forEach(token => assert.equal(token.floorId, floors[1].id));
});

test('la purge des décors escalier / cabine est explicite et complète (7.10)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    Store.addDecor('elevator_decor', floors[1].id, 5, 5);
    Store.addDecor('stairs', floors[0].id, 8, 8);
    const kept = Store.addDecor('counter', floors[0].id, 2, 2);

    const listed = Store.listLegacyTransitionDecors();
    assert.equal(listed.length, 2);
    // Récapitulatif trié par étage pour la boîte de confirmation.
    assert.equal(listed[0].floor.id, floors[0].id);
    assert.equal(listed[1].floor.id, floors[1].id);

    assert.equal(Store.purgeLegacyTransitionDecors(), 2);
    assert.equal(Store.listLegacyTransitionDecors().length, 0);
    assert.ok(Store.findDecor(kept.id), 'les autres décors sont conservés');
    assert.equal(Store.undo(), 'Supprimer les décors de liaison obsolètes');
});

test('un nouvel ascenseur dessert tous les étages avec porte par défaut (7.11)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Ascenseur des étages pairs');
    assert.equal(Store.populateElevatorStops(elevator, 12, 8), floors.length);
    assert.equal(elevator.endpoints.length, floors.length);
    elevator.endpoints.forEach(endpoint => {
        assert.equal(endpoint.hasDoor, true);
        assert.equal(endpoint.x, 12);
        assert.equal(endpoint.y, 8);
    });
    // Idempotent : un second appel ne duplique aucun arrêt.
    assert.equal(Store.populateElevatorStops(elevator), 0);

    // Le MJ retire ensuite les portes non désirées (étages « impairs »).
    elevator.endpoints[1].hasDoor = false;
    const cabins = Store.elevatorCabinsOnFloor(floors[1].id);
    assert.equal(cabins[0].hasDoor, false, 'la gaine reste présente, sans arrêt praticable');

    // Une desserte bornée ne se peuple que dans sa plage.
    const partial = Store.addTransition('elevator', 'Ascenseur borné');
    Store.addTransitionEndpoint(partial, floors[0].id, 4, 4);
    Store.setElevatorBound(partial, 'max', floors[1].order);
    assert.equal(Store.populateElevatorStops(partial), 1);
    assert.ok(!partial.endpoints.some(endpoint => endpoint.floorId === floors[2].id));
});

test('désactiver des arrêts d’ascenseur persiste sans recréer la desserte', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Ascenseur sélectif');
    Store.populateElevatorStops(elevator, 8, 8);

    assert.equal(Store.setElevatorStopEnabled(elevator, floors[1].id, false), true);
    assert.equal(Store.setElevatorStopEnabled(elevator, floors[2].id, false), true);
    assert.equal(elevator.endpoints.find(item => item.floorId === floors[1].id).hasDoor, false);
    assert.equal(elevator.endpoints.find(item => item.floorId === floors[2].id).hasDoor, false);

    const reloaded = Store.preparePlan(JSON.parse(Store.exportJson())).plan;
    const persisted = reloaded.transitions.find(item => item.id === elevator.id);
    assert.equal(persisted.endpoints.find(item => item.floorId === floors[1].id).hasDoor, false);
    assert.equal(persisted.endpoints.find(item => item.floorId === floors[2].id).hasDoor, false);
    assert.equal(Store.populateElevatorStops(elevator), 0,
        'les niveaux sans arrêt conservent leur endpoint de gaine et ne sont pas recréés');
});

test('les bornes figées suivent leurs étages quand les ordres changent (7.8)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const [a, b] = Store.sortedFloors(); // ordres 0 et 1
    const elevator = Store.addTransition('elevator', 'Ascenseur borné');
    Store.addTransitionEndpoint(elevator, a.id, 12, 8);
    Store.addTransitionEndpoint(elevator, b.id, 12, 8);
    Store.setElevatorBound(elevator, 'max', b.order); // figée sur l'étage B

    // Un étage hors desserte figée ne peut pas recevoir d'arrêt.
    const outside = Store.sortedFloors()[2];
    assert.equal(Store.addTransitionEndpoint(elevator, outside.id, 12, 8), null);

    // Supprimer A renumérote les ordres : la borne continue de désigner B.
    Store.deleteFloor(a.id);
    assert.equal(Store.findFloor(b.id).order, 0);
    assert.equal(elevator.maxFloorOrder, 0);

    // Réordonner B ne change pas les étages desservis : la borne le suit.
    Store.moveFloor(b.id, 1);
    assert.equal(Store.findFloor(b.id).order, 1);
    assert.equal(elevator.maxFloorOrder, 1);
});

test('une borne dont l’étage disparaît se rabat sur la plage restante (7.8)', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const [a, b] = Store.sortedFloors();
    const elevator = Store.addTransition('elevator', 'Ascenseur amputé');
    Store.addTransitionEndpoint(elevator, a.id, 12, 8);
    Store.addTransitionEndpoint(elevator, b.id, 12, 8);
    Store.setElevatorBound(elevator, 'max', b.order);

    // L'étage désigné par la borne est supprimé : rabat sur A, sans
    // étendre la desserte vers les étages qui n'étaient pas servis.
    Store.deleteFloor(b.id);
    assert.equal(elevator.maxFloorOrder, Store.findFloor(a.id).order);
    assert.deepEqual(Array.from(elevator.endpoints, item => item.floorId), [a.id]);
    assert.equal(Store.elevatorCabinsOnFloor(Store.sortedFloors()[1].id).length, 0);
});

test('la remise à zéro MJ repart d’une feuille blanche restaurable', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[0];
    Store.getPlan().revision = 7;
    Store.addEntity('camera', floor.id, 3, 3, 'Caméra');
    Store.addDecor('counter', floor.id, 5, 5);
    const transition = Store.addTransition('stairs', 'Escalier');
    Store.addTransitionEndpoint(transition, floor.id, 4, 4);
    const token = Store.addToken(floor.id, 2, 2);
    Store.addDiscovery('floor', floor, token.id);
    const nameBefore = Store.getPlan().name;
    const roomsBefore = Store.getPlan().rooms.length;
    assert.ok(roomsBefore > 0);

    const fresh = Store.resetPlan();
    assert.equal(fresh.floors.length, 1);
    assert.equal(fresh.floors[0].revealed, true);
    assert.equal(fresh.rooms.length, 0);
    assert.equal(fresh.entities.length, 0);
    assert.equal(fresh.decors.length, 0);
    assert.equal(fresh.transitions.length, 0);
    assert.equal(fresh.revision, 7, 'la révision cloud est préservée');
    assert.equal(fresh.name, nameBefore, 'le nom du plan est conservé');
    assert.equal(Store.getTokens().length, 0);
    assert.equal(Store.getDiscoveries().length, 0);
    assert.equal(Store.ui.currentFloorId, fresh.floors[0].id);

    // Le plan (mais pas les pions) reste annulable via l'historique.
    assert.equal(Store.undo(), 'Tout supprimer');
    assert.equal(Store.getPlan().rooms.length, roomsBefore);
});

test('le catalogue expose tous les dispositifs attendus', () => {
    const { EntityCatalog } = loadApplicationCore();
    const types = Object.keys(EntityCatalog.types);
    assert.ok(types.length >= 16);
    ['camera', 'armed_guard', 'bank_employee', 'civilian', 'network_node', 'mana_barrier'].forEach(type => {
        assert.ok(EntityCatalog.types[type], type + ' absent du catalogue');
    });
    ['bank_employee', 'civilian'].forEach(type => {
        const definition = EntityCatalog.get(type);
        assert.equal(definition.canPatrol, true, type + ' doit pouvoir patrouiller');
        assert.equal(definition.armed, false, type + ' ne doit pas être armé');
        assert.equal(definition.coverageType, 'none', type + ' ne doit pas avoir de zone de détection');
        assert.equal(definition.stateProfile, 'personnel');
    });
});

test('le sens d’un escalier filtre une desserte de plusieurs étages', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floors = Store.sortedFloors();
    const stairs = Store.addTransition('stairs', 'Escalier central');
    const upper = Store.addTransitionEndpoint(stairs, floors[0].id, 6, 6);
    const middle = Store.addTransitionEndpoint(stairs, floors[1].id, 1, 1);
    const lower = Store.addTransitionEndpoint(stairs, floors[2].id, 2, 2);

    assert.equal(Store.stairsExitDirection(stairs, middle), 'both');
    assert.deepEqual(Array.from(Exploration.destinationsFor(stairs, middle), item => item.id),
        [upper.id, lower.id]);
    Store.setStairsDirection(stairs, 'up');
    assert.equal(Store.stairsExitDirection(stairs, middle), 'up');
    assert.deepEqual(Array.from(Exploration.destinationsFor(stairs, middle), item => item.id),
        [upper.id]);
    Store.setStairsDirection(stairs, 'down');
    assert.deepEqual(Array.from(Exploration.destinationsFor(stairs, middle), item => item.id),
        [lower.id]);
});

test('entrer dans une salle révèle les catégories évidentes et garde les autres dissimulées', () => {
    const { Store, MapView, EntityCatalog, Exploration } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[1];
    const token = Store.addToken(floor.id, 5, 7);

    const visibleTypes = [
        'steel_grate', 'mad_gate', 'maglock', 'retina_scanner', 'dna_analyzer',
        'elevator', 'camera', 'combat_drone', 'armed_guard', 'bank_employee',
        'civilian', 'network_node'
    ];
    const hiddenTypes = [
        'infrared_motion_sensor', 'detection_laser', 'pressure_plate', 'sensor',
        'micro_security_drone', 'automatic_turret', 'drone', 'security_mage',
        'mana_barrier', 'patrol_spirit'
    ];
    const visible = visibleTypes.map(type => Store.addEntity(type, floor.id, 5, 7, type));
    const hidden = hiddenTypes.map(type => Store.addEntity(type, floor.id, 5, 7, type));
    const decors = ['wall', 'safe', 'floor_marking'].map(type =>
        Store.addDecor(type, floor.id, 5, 7));
    const elevator = Store.addTransition('elevator', 'Ascenseur adjacent');
    Store.addTransitionEndpoint(elevator, floor.id, 5, 4);
    const stairs = Store.addTransition('stairs', 'Escalier dans la salle');
    const stairsEp = Store.addTransitionEndpoint(stairs, floor.id, 5, 7);
    const ladder = Store.addTransition('ladder', 'Échelle dans la salle');
    const ladderEp = Store.addTransitionEndpoint(ladder, floor.id, 5, 7);
    const passage = Store.addTransition('passage', 'Passage dans la salle');
    const passageEp = Store.addTransitionEndpoint(passage, floor.id, 5, 7);
    const hatch = Store.addTransition('hatch', 'Trappe dans la salle');
    const hatchEp = Store.addTransitionEndpoint(hatch, floor.id, 5, 7);
    const doorlessElevator = Store.addTransition('elevator', 'Gaine sans porte');
    const doorlessEndpoint = Store.addTransitionEndpoint(doorlessElevator, floor.id, 7, 4);
    doorlessEndpoint.hasDoor = false;
    const remoteElevator = Store.addTransition('elevator', 'Ascenseur éloigné');
    Store.addTransitionEndpoint(remoteElevator, floor.id, 15, 4);

    // Simule aussi un ancien plan où un décor avait été explicitement marqué
    // non découvrable : sa présence dans la salle prime désormais.
    decors[1].autoDiscover = false;
    MapView.isLineBlocked = () => true;
    Exploration.discoverFromToken(token);

    visible.forEach(entity => {
        assert.equal(Store.isDiscovered('entity', entity.id), true, entity.type);
        assert.equal(EntityCatalog.get(entity.type).autoDiscover, true, entity.type);
    });
    visible.filter(entity => entity.coverage && entity.coverage.shape === 'cone')
        .forEach(entity => assert.equal(Store.isDiscovered('coverage', entity.id), true,
            'cône de ' + entity.type));
    hidden.forEach(entity => {
        assert.equal(Store.isDiscovered('entity', entity.id), false, entity.type);
        assert.equal(EntityCatalog.get(entity.type).autoDiscover, false, entity.type);
    });
    decors.forEach(decor => {
        assert.equal(Store.isDiscovered('decor', decor.id), true, decor.type);
    });
    // La découverte d'une liaison à vue (cabine, escalier, échelle, passage)
    // est par point de passage : seul l'arrêt de l'étage visité devient visible.
    assert.equal(Store.isEndpointRevealed(elevator, elevator.endpoints[0]), true,
        'la porte sud touche la salle découverte');
    assert.equal(Store.isEndpointRevealed(stairs, stairsEp), true,
        'l’escalier situé dans la pièce est révélé automatiquement');
    assert.equal(Store.isEndpointRevealed(ladder, ladderEp), true,
        'l’échelle située dans la pièce est révélée automatiquement');
    assert.equal(Store.isEndpointRevealed(passage, passageEp), true,
        'le passage situé dans la pièce est révélé automatiquement');
    assert.equal(Store.isEndpointRevealed(hatch, hatchEp), false,
        'une trappe dissimulée reste cachée même dans la pièce visitée');
    assert.equal(Store.isEffectivelyRevealed(doorlessElevator, 'transition'), false,
        'une gaine sans porte reste cachée');
    assert.equal(Store.isEffectivelyRevealed(remoteElevator, 'transition'), false,
        'un ascenseur éloigné reste caché');
});

test('une porte dans un mur est révélée depuis les DEUX salles qu’elle sépare', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[1];
    const roomA = Store.addRoom(floor.id);
    Store.paintCell(roomA, 5, 7);
    const roomB = Store.addRoom(floor.id);
    Store.paintCell(roomB, 6, 7);
    // Salles côte à côte, mur vertical à x=6. Porte tournée le long du mur
    // (rotation 90°) et calée dans la salle B : son corps de 0,35 tient tout
    // entier dans la case (6,7), son empreinte réelle ne touche jamais la
    // salle A. Elle doit pourtant être révélée depuis A comme depuis B.
    const door = Store.addDecor('opaque_door', floor.id, 6.5, 7.5);
    door.rotation = 90;
    assert.equal(Store.roomAt(floor.id, 6, 7).id, roomB.id);

    const tokenA = Store.addToken(floor.id, 5, 7);
    Exploration.discoverFromToken(tokenA);
    assert.equal(Store.isDiscovered('decor', door.id), true,
        'la porte est révélée depuis la salle A, de l’autre côté du mur');

    Store.resetDiscoveries();
    const tokenB = Store.addToken(floor.id, 6, 7);
    Exploration.discoverFromToken(tokenB);
    assert.equal(Store.isDiscovered('decor', door.id), true,
        'et toujours révélée depuis la salle B qui contient son corps');
});

test('une étagère contre un mur n’est pas révélée depuis la pièce voisine', () => {
    const { Store, Exploration } = loadApplicationCore();
    Store.load();
    const floor = Store.sortedFloors()[1];
    const roomA = Store.addRoom(floor.id);
    Store.paintCell(roomA, 5, 7);
    const roomB = Store.addRoom(floor.id);
    Store.paintCell(roomB, 6, 7);
    // Étagère (mobilier fin, 2 × 0,6) plaquée contre le mur vertical x=6,
    // côté salle B : tournée le long du mur, son corps tient dans la case
    // (6,7). Contrairement à une porte, elle vit DANS la salle B et ne doit
    // pas être visible depuis la salle A de l'autre côté du mur.
    const shelf = Store.addDecor('shelf', floor.id, 6.3, 7.5);
    shelf.rotation = 90;

    const tokenA = Store.addToken(floor.id, 5, 7);
    Exploration.discoverFromToken(tokenA);
    assert.equal(Store.isDiscovered('decor', shelf.id), false,
        'invisible depuis la salle A, séparée par le mur');

    Store.resetDiscoveries();
    const tokenB = Store.addToken(floor.id, 6, 7);
    Exploration.discoverFromToken(tokenB);
    assert.equal(Store.isDiscovered('decor', shelf.id), true,
        'révélée depuis sa propre salle B');
});

test('un décor lié à un contrôle d’accès reflète son état effectif', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.currentFloor();
    const node = Store.addEntity('network_node', floor.id, 2.5, 2.5, 'Nœud');
    const maglock = Store.addEntity('maglock', floor.id, 3.5, 2.5, 'Verrou');
    const door = Store.addDecor('opaque_door', floor.id, 4.5, 2.5);
    door.accessEntityId = maglock.id;
    maglock.networkId = node.id;

    assert.equal(Store.isDecorAccessController(maglock), true);
    assert.equal(Store.getAccessController(door), maglock);
    assert.equal(Store.isAccessOpen(door), false);

    Store.setEntityState(maglock, 'hacked');
    assert.equal(Store.isAccessOpen(door), true, 'un verrou ouvert ouvre le décor');
    Store.setEntityState(maglock, 'active');
    Store.setEntityState(node, 'offline');
    assert.equal(Store.isAccessOpen(door), true, 'la cascade réseau désactive aussi le verrou');

    Store.deleteEntity(maglock.id);
    assert.equal(door.accessEntityId, '', 'la suppression nettoie la liaison');
});

test('les filtres de carte MJ et joueurs sont indépendants', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    assert.deepEqual({ ...Store.getOverlayPreferences() }, {
        coverages: true, networkLinks: true
    });
    Store.setOverlayVisibility('coverages', false);
    assert.equal(Store.getOverlayPreferences().coverages, false);

    Store.ui.preview = true;
    assert.deepEqual({ ...Store.getOverlayPreferences() }, {
        coverages: true, networkLinks: true
    });
    Store.setOverlayVisibility('networkLinks', false);

    Store.ui.preview = false;
    assert.deepEqual({ ...Store.getOverlayPreferences() }, {
        coverages: false, networkLinks: true
    });
});

/* ============================================================
   E3 — Déplacement par zone de portée
   ============================================================ */

test('E3 : un pion reçoit une portée de déplacement de 6 par défaut', () => {
    const { Store } = loadApplicationCore();
    Store.load();
    const floor = Store.addFloor('E3');
    const token = Store.addToken(floor.id, 5.5, 5.5);
    assert.equal(token.movementRange, 6);
    // Un pion importé sans le champ le reçoit aussi à la normalisation.
    Store.applyRemoteTokens([{ id: 't-legacy', floorId: floor.id, x: 2, y: 2 }]);
    assert.equal(Store.findToken('t-legacy').movementRange, 6);
});

test('E3 : computeBlockedEdges — le zonage des pièces fait mur', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.addFloor('E3');
    const room = Store.addRoom(floor.id);
    Store.paintCell(room, 5, 7); // pièce d'une seule case
    const { edges } = MapView.computeBlockedEdges(floor.id);
    // Les quatre frontières room↔vide sont des arêtes bloquées.
    assert.ok(edges.has('V:5:7') && edges.has('V:6:7'), 'murs gauche/droite');
    assert.ok(edges.has('H:7:5') && edges.has('H:8:5'), 'murs haut/bas');

    // Frontière room↔room : deux pièces adjacentes bloquent aussi le pas.
    const roomB = Store.addRoom(floor.id);
    Store.paintCell(roomB, 6, 7);
    assert.ok(MapView.computeBlockedEdges(floor.id).edges.has('V:6:7'),
        'la frontière entre deux pièces adjacentes reste un mur');
});

test('E3 : une porte franchissable perce le mur, une porte verrouillée non', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.addFloor('E3');
    const roomA = Store.addRoom(floor.id);
    Store.paintCell(roomA, 4, 7); Store.paintCell(roomA, 5, 7);
    const roomB = Store.addRoom(floor.id);
    Store.paintCell(roomB, 6, 7); Store.paintCell(roomB, 7, 7);
    const token = Store.addToken(floor.id, 4.5, 7.5);

    // Sans porte : le mur de zonage V:6:7 confine le pion à la pièce A.
    let reach = MapView.reachableCells(token);
    assert.ok(reach.has('4,7') && reach.has('5,7'), 'la pièce A est atteignable');
    assert.ok(!reach.has('6,7'), 'le mur bloque le passage vers la pièce B');

    // Porte simple (sans verrou) à cheval sur V:6:7 → passage ouvert.
    const door = Store.addDecor('opaque_door', floor.id, 6, 7.5);
    door.rotation = 90;
    reach = MapView.reachableCells(token);
    assert.ok(reach.has('6,7') && reach.has('7,7'),
        'une porte franchissable ouvre le passage vers la pièce B');

    // Verrou actif sur la porte → de nouveau infranchissable.
    const maglock = Store.addEntity('maglock', floor.id, 6, 6.5, 'Verrou');
    door.accessEntityId = maglock.id;
    reach = MapView.reachableCells(token);
    assert.ok(!reach.has('6,7'), 'une porte verrouillée laisse le mur bloqué');

    // Verrou piraté → porte franchissable de nouveau.
    Store.setEntityState(maglock, 'hacked');
    reach = MapView.reachableCells(token);
    assert.ok(reach.has('6,7'), 'déverrouiller la porte rouvre le passage');
});

test('E3 : un décor bloquant rend sa case non-entrable', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.addFloor('E3');
    const token = Store.addToken(floor.id, 5.5, 5.5); // zone non zonée → libre
    Store.addDecor('pillar', floor.id, 7.5, 5.5); // pilier centré sur (7,5)
    const { cells } = MapView.computeBlockedEdges(floor.id);
    assert.ok(cells.has('7,5'), 'la case du pilier est marquée bloquée');
    const reach = MapView.reachableCells(token);
    assert.ok(!reach.has('7,5'), 'le pion ne peut pas entrer sur la case du pilier');
    assert.ok(reach.has('6,5') && reach.has('8,5'), 'les cases voisines restent atteignables');

    // Une vitre (2 × 0,2) posée au centre d'une rangée bloque ses cases.
    Store.addDecor('glass', floor.id, 10.5, 5.5);
    const glassCells = MapView.computeBlockedEdges(floor.id).cells;
    assert.ok(glassCells.has('10,5'), 'la vitre bloque sa case');
});

test('E3 : reachableCells — portée octile bornée, sans coupe d’angle', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.addFloor('E3');
    const token = Store.addToken(floor.id, 12.5, 8.5); // large zone libre
    token.movementRange = 6;

    const cells = MapView.reachableCells(token);
    assert.ok(cells.has('12,8'), 'la case de départ est incluse');
    assert.ok(cells.has('18,8'), '6 pas orthogonaux → atteignable');
    assert.ok(!cells.has('19,8'), '7 pas orthogonaux → hors de portée');
    assert.ok(cells.has('16,12'), '4 diagonales (coût 6) → atteignable');
    assert.ok(!cells.has('17,13'), '5 diagonales (coût 7,5) → hors de portée');

    // Réduire la portée réduit l'ensemble atteignable.
    token.movementRange = 2;
    const small = MapView.reachableCells(token);
    assert.ok(small.has('14,8') && !small.has('15,8'), 'portée 2 : 2 pas max');
    assert.ok(small.size < cells.size, 'une portée plus faible réduit la zone');
});

test('E3 : une diagonale ne se faufile pas entre deux murs qui se touchent', () => {
    const { Store, MapView } = loadApplicationCore();
    Store.load();
    const floor = Store.addFloor('E3');
    // Deux pièces qui ne se touchent QUE par un coin (diagonale).
    const roomA = Store.addRoom(floor.id);
    Store.paintCell(roomA, 4, 7); Store.paintCell(roomA, 5, 7);
    const roomB = Store.addRoom(floor.id);
    Store.paintCell(roomB, 6, 6); Store.paintCell(roomB, 7, 6);
    const token = Store.addToken(floor.id, 4.5, 7.5);
    token.movementRange = 6;
    const reach = MapView.reachableCells(token);
    assert.ok(reach.has('4,7') && reach.has('5,7'), 'la pièce A reste atteignable');
    assert.ok(!reach.has('6,6'),
        'le coin partagé (murs sur les deux arêtes) ne laisse pas passer la diagonale');
});

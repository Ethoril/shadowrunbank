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
    ['catalog.js', 'anim.js', 'store.js', 'map.js'].forEach(file => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), context, {
            filename: file
        });
    });
    return {
        context,
        Store: vm.runInContext('Store', context),
        Anim: vm.runInContext('Anim', context),
        MapView: vm.runInContext('MapView', context),
        EntityCatalog: vm.runInContext('EntityCatalog', context)
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

    const snapshot = MapView.cameraFeedSnapshot(floor.id, 0);
    assert.ok(Store.isEffectivelyRevealed(floor, 'floor'));
    assert.ok(Store.isEffectivelyRevealed(room, 'room'));
    assert.ok(!snapshot.entityIds.includes(camera.id));
    assert.ok(snapshot.entityIds.includes(visibleGuard.id));
    assert.ok(!snapshot.entityIds.includes(hiddenGuard.id));
    assert.ok(snapshot.decorIds.includes(visibleDecor.id));
    assert.ok(!snapshot.decorIds.includes(hiddenDecor.id));
    assert.ok(snapshot.transitionIds.includes(transition.id));

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

test('le catalogue expose tous les dispositifs attendus', () => {
    const { EntityCatalog } = loadApplicationCore();
    const types = Object.keys(EntityCatalog.types);
    assert.ok(types.length >= 16);
    ['camera', 'armed_guard', 'network_node', 'mana_barrier'].forEach(type => {
        assert.ok(EntityCatalog.types[type], type + ' absent du catalogue');
    });
});

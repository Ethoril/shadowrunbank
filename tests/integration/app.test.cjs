const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

let server;
let baseUrl;
let browser;
let remotePlan;
let remoteTokens = [];
let remoteDiscoveries = [];

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', chunk => { body += chunk; });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });
}

async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/__test-cloud/plan') {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET') {
            response.end(JSON.stringify(remotePlan));
            return;
        }
        if (request.method === 'POST') {
            const incoming = JSON.parse(await readBody(request));
            const remoteRevision = Number.isInteger(remotePlan && remotePlan.revision)
                ? remotePlan.revision : 0;
            if (!incoming.force && incoming.plan.revision !== remoteRevision) {
                response.statusCode = 409;
                response.end(JSON.stringify({ remotePlan }));
                return;
            }
            remotePlan = { ...incoming.plan, schemaVersion: 2, revision: remoteRevision + 1 };
            response.end(JSON.stringify({ revision: remotePlan.revision }));
            return;
        }
        response.statusCode = 405;
        response.end('{}');
        return;
    }

    if (url.pathname === '/__test-cloud/tokens') {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET') {
            response.end(JSON.stringify(remoteTokens));
            return;
        }
        if (request.method === 'POST') {
            const token = JSON.parse(await readBody(request));
            const previous = remoteTokens.find(item => item.id === token.id) || {};
            remoteTokens = remoteTokens.filter(item => item.id !== token.id)
                .concat({ ...previous, ...token });
            response.end('{}');
            return;
        }
        if (request.method === 'DELETE') {
            const { id } = JSON.parse(await readBody(request));
            remoteTokens = remoteTokens.filter(item => item.id !== id);
            response.end('{}');
            return;
        }
        response.statusCode = 405;
        response.end('{}');
        return;
    }

    if (url.pathname === '/__test-cloud/discoveries') {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET') {
            response.end(JSON.stringify(remoteDiscoveries));
            return;
        }
        if (request.method === 'POST') {
            const discovery = JSON.parse(await readBody(request));
            remoteDiscoveries = remoteDiscoveries
                .filter(item => item.id !== discovery.id).concat(discovery);
            response.end('{}');
            return;
        }
        if (request.method === 'DELETE') {
            const { ids } = JSON.parse(await readBody(request));
            remoteDiscoveries = remoteDiscoveries.filter(item => !ids.includes(item.id));
            response.end('{}');
            return;
        }
        response.statusCode = 405;
        response.end('{}');
        return;
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filename = path.resolve(ROOT, '.' + requested);
    if (!filename.startsWith(ROOT + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.statusCode = 404;
        response.end('Not found');
        return;
    }
    response.setHeader('Content-Type', MIME[path.extname(filename)] || 'application/octet-stream');
    fs.createReadStream(filename).pipe(response);
}

function mockCloudScript() {
    if (location.search.includes('stale-local=1')) {
        localStorage.setItem('shadowrunbank_tokens_v1', JSON.stringify([{
            id: 'token-stale', name: 'Runner local périmé', shortLabel: 'RS',
            color: '#00d2ff', icon: 'runner', floorId: 'f_mrjazc0tos95t',
            x: 2.5, y: 2.5, playerMovable: true, visible: true, locked: false
        }]));
        localStorage.setItem('shadowrunbank_discoveries_v1', JSON.stringify([{
            id: 'room-stale', kind: 'room', elementId: 'r_mrjazc0tjak55',
            floorId: 'f_mrjazc0tos95t', discoveredBy: 'token-stale'
        }]));
    }
    window.Cloud = (() => {
        const channel = new BroadcastChannel('shadowrunbank-test-cloud');
        const planListeners = new Set();
        const tokenListeners = new Set();
        const discoveryListeners = new Set();
        const notifyPlan = async () => {
            const response = await fetch('/__test-cloud/plan');
            const plan = await response.json();
            planListeners.forEach(listener => listener(plan, false));
        };
        const notifyTokens = async () => {
            const response = await fetch('/__test-cloud/tokens');
            const tokens = await response.json();
            tokenListeners.forEach(listener => listener(tokens, false));
        };
        const notifyDiscoveries = async () => {
            const response = await fetch('/__test-cloud/discoveries');
            const discoveries = await response.json();
            discoveryListeners.forEach(listener => listener(discoveries, false));
        };
        channel.addEventListener('message', event => {
            if (event.data === 'tokens-updated') notifyTokens();
            else if (event.data === 'discoveries-updated') notifyDiscoveries();
            else notifyPlan();
        });
        async function writeCollection(path, value, message) {
            await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
            channel.postMessage(message);
            return {};
        }
        return {
            ADMIN_EMAIL: 'admin@example.test',
            isAdmin: user => !!user && user.email === 'admin@example.test',
            login: async () => {},
            logout: async () => {},
            watchAuth(callback) {
                queueMicrotask(() => callback(location.search.includes('admin=1')
                    ? { email: 'admin@example.test' } : null));
                return () => {};
            },
            async savePlan(plan, options = {}) {
                const response = await fetch('/__test-cloud/plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plan, force: options.force === true })
                });
                const result = await response.json();
                if (response.status === 409) {
                    const error = new Error('Conflit simulé');
                    error.code = 'revision-conflict';
                    error.remotePlan = result.remotePlan;
                    throw error;
                }
                channel.postMessage('plan-updated');
                return result;
            },
            subscribePlan(callback, onError) {
                planListeners.add(callback);
                notifyPlan().catch(onError);
                return () => planListeners.delete(callback);
            },
            subscribeTokens(callback, onError) {
                tokenListeners.add(callback);
                notifyTokens().catch(onError);
                return () => tokenListeners.delete(callback);
            },
            subscribeDiscoveries(callback, onError) {
                discoveryListeners.add(callback);
                notifyDiscoveries().catch(onError);
                return () => discoveryListeners.delete(callback);
            },
            saveToken(token) {
                return writeCollection('/__test-cloud/tokens', token, 'tokens-updated');
            },
            updateTokenPosition(position) {
                return writeCollection('/__test-cloud/tokens', position, 'tokens-updated');
            },
            async deleteToken(id) {
                if (location.search.includes('stale-delete=1')) await notifyTokens();
                await fetch('/__test-cloud/tokens', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                if (location.search.includes('stale-delete=1')) await notifyTokens();
                channel.postMessage('tokens-updated');
                return {};
            },
            saveDiscovery(discovery) {
                return writeCollection(
                    '/__test-cloud/discoveries', discovery, 'discoveries-updated');
            },
            async deleteDiscoveries(ids) {
                if (location.search.includes('stale-delete=1')) await notifyDiscoveries();
                await fetch('/__test-cloud/discoveries', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                if (location.search.includes('stale-delete=1')) await notifyDiscoveries();
                channel.postMessage('discoveries-updated');
                return {};
            },
            createSnapshot: async () => ({ id: 'snapshot-test' }),
            listSnapshots: async () => [],
            deleteSnapshot: async () => ({})
        };
    })();
}

test.before(async () => {
    remotePlan = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/plan-v1-production.json'), 'utf8'));
    remotePlan.revision = 0;
    server = http.createServer((request, response) => {
        handleRequest(request, response).catch(error => {
            response.statusCode = 500;
            response.end(error.stack);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const options = { headless: true };
    if (fs.existsSync(CHROME_PATH)) options.executablePath = CHROME_PATH;
    browser = await chromium.launch(options);
});

test.after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test('la suite smoke complète passe dans un vrai navigateur', async () => {
    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/test_smoke.html');
    await page.waitForFunction(() => document.querySelector('#test-results').textContent.includes('PASS'));
    const results = await page.locator('#test-results').innerText();
    assert.equal(results.split('\n').filter(line => line.startsWith('PASS')).length, 200);
    assert.equal(results.includes('FAIL'), false);
    assert.equal(results.includes('ERROR'), false);
    await context.close();
});

test('les accès liés et filtres de carte restent distincts entre MJ et joueurs', async () => {
    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');
    const ids = await page.evaluate(() => {
        const floor = Store.currentFloor();
        floor.revealed = true;
        const node = Store.addEntity('network_node', floor.id, 2.5, 2.5, 'Nœud test');
        const camera = Store.addEntity('camera', floor.id, 5.5, 2.5, 'Caméra test');
        const maglock = Store.addEntity('maglock', floor.id, 7.5, 2.5, 'Maglock test');
        const door = Store.addDecor('opaque_door', floor.id, 8.5, 2.5);
        [node, camera, maglock, door].forEach(item => { item.revealed = true; });
        camera.networkId = node.id;
        camera.coverage.revealed = true;
        door.accessEntityId = maglock.id;
        Store.setEntityState(maglock, 'hacked');
        App.renderAll();
        return { door: door.id };
    });

    await page.locator(`.decor[data-id="${ids.door}"]`).waitFor();
    assert.equal(await page.locator(`.decor[data-id="${ids.door}"]`).getAttribute('class')
        .then(value => value.includes('access-open')), true);
    assert.equal(await page.locator(`.decor[data-id="${ids.door}"] .decor-access-state`).innerText(), 'OUVERT');
    assert.ok(await page.locator('#g-coverages > *').count() > 0);
    assert.ok(await page.locator('#g-cables .network-cable').count() > 0);

    await page.locator('#toggle-coverages').click();
    assert.equal(await page.locator('#g-coverages > *').count(), 0);
    assert.ok(await page.locator('#g-cables .network-cable').count() > 0);

    await page.locator('#preview-btn').click();
    assert.equal(await page.locator('#toggle-coverages').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#toggle-network-links').getAttribute('aria-pressed'), 'true');
    await page.locator('#toggle-network-links').click();
    assert.equal(await page.locator('#g-cables .network-cable').count(), 0);

    await page.locator('#preview-btn').click();
    assert.equal(await page.locator('#toggle-coverages').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#toggle-network-links').getAttribute('aria-pressed'), 'true');
    assert.ok(await page.locator('#g-cables .network-cable').count() > 0);
    await context.close();
});

test('annuler et rétablir fonctionnent depuis le header', async () => {
    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');
    await page.evaluate(() => {
        Store.getPlan().name = 'Nom modifié en intégration';
        Store.touch('Renommer en intégration');
    });
    await page.locator('#undo-btn').click();
    assert.equal(await page.evaluate(() => Store.getPlan().name === 'Nom modifié en intégration'), false);
    await page.locator('#redo-btn').click();
    assert.equal(await page.evaluate(() => Store.getPlan().name), 'Nom modifié en intégration');

    const backupsBefore = await page.evaluate(() => Object.keys(localStorage)
        .filter(key => key.startsWith('shadowrunbank_plan_backup_')).length);
    await page.locator('#snapshot-btn').click();
    await page.locator('#snapshot-panel:not([hidden])').waitFor({ state: 'visible' });
    await page.locator('#snapshot-create').click();
    const snapshotState = await page.evaluate(() => ({
        backups: Object.keys(localStorage)
            .filter(key => key.startsWith('shadowrunbank_plan_backup_')).length,
        ticker: document.querySelector('#status-ticker').textContent
    }));
    assert.equal(snapshotState.backups, backupsBefore + 1);
    assert.match(snapshotState.ticker, /SNAPSHOT LOCAL CRÉÉ/);
    await page.evaluate(() => {
        Store.getPlan().name = 'Nom après snapshot';
        Store.touch('Renommer après snapshot');
    });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#snapshot-local-list .snapshot-row .btn-secondary').first().click();
    assert.equal(await page.evaluate(() => Store.getPlan().name), 'Nom modifié en intégration');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('plan-save-offline')));
    assert.equal(await page.locator('#retry-cloud-btn').isVisible(), true);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('plan-save-synced')));
    assert.equal(await page.locator('#retry-cloud-btn').isVisible(), false);

    const pasted = await page.evaluate(() => {
        const floor = Store.currentFloor();
        const source = Store.addEntity('camera', floor.id, 3, 3, 'Caméra test');
        Store.ui.selection = { kind: 'entity', id: source.id };
        App.renderAll();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
        return {
            count: Store.floorEntities(floor.id).filter(item => item.name.startsWith(source.name)).length,
            selection: Store.ui.selection
        };
    });
    assert.equal(pasted.count, 2);
    assert.equal(pasted.selection.kind, 'entity');
    await context.close();
});

test('l’arbre distingue une découverte automatique d’une révélation MJ', async () => {
    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');
    const entityId = await page.evaluate(() => {
        const floor = Store.currentFloor();
        const entity = Store.addEntity('camera', floor.id, 4, 4, 'Caméra découverte');
        entity.revealed = false;
        Store.addDiscovery('entity', entity, 'pion-test', floor.id);
        App.renderAll();
        return entity.id;
    });
    await page.locator('.panel-tab[data-tab="visibility"]').click();
    const row = page.locator(`.vis-row[data-node-id="${entityId}"]`);
    assert.equal(await row.locator('.vis-status').innerText(), 'DÉCOUVERT');
    await row.locator('.vis-label').click();
    await page.waitForFunction(id => document.querySelector(`.entity[data-id="${id}"]`)
        .classList.contains('map-focus-pulse'), entityId);
    await context.close();
});

test('une caméra piratée affiche un flux limité à son cône dans la vue joueurs', async () => {
    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');
    const ids = await page.evaluate(() => {
        const floor = Store.sortedFloors()[1];
        const room = Store.roomAt(floor.id, 5, 7);
        const node = Store.addEntity('network_node', floor.id, 3, 7, 'Nœud du flux');
        node.state = 'hacked';
        const camera = Store.addEntity('camera', floor.id, 5, 7, 'Caméra du flux');
        camera.networkId = node.id;
        camera.coverage.direction = 0;
        const inside = Store.addEntity('armed_guard', floor.id, 8, 7, 'Dans le flux');
        const outside = Store.addEntity('armed_guard', floor.id, 5, 9.5, 'Hors du flux');
        const decor = Store.addDecor('floor_marking', floor.id, 9, 7);
        const transition = Store.addTransition('stairs', 'Escalier dans le flux');
        Store.addTransitionEndpoint(transition, floor.id, 10, 7);
        Store.ui.preview = true;
        Store.ui.currentFloorId = floor.id;
        App.renderAll();
        return {
            floor: floor.id, room: room.id, node: node.id, camera: camera.id,
            inside: inside.id, outside: outside.id, decor: decor.id,
            transition: transition.id
        };
    });

    assert.equal(await page.evaluate(() => Store.currentFloor().id), ids.floor);
    assert.equal(await page.locator(`.room-label[data-room-id="${ids.room}"]`).count(), 1);
    assert.equal(await page.locator(`.entity[data-id="${ids.camera}"]`).count(), 0);
    assert.equal(await page.locator(`.entity[data-id="${ids.inside}"]`).count(), 1);
    assert.equal(await page.locator(`.entity[data-id="${ids.outside}"]`).count(), 0);
    assert.equal(await page.locator(`.decor[data-id="${ids.decor}"]`).count(), 1);
    assert.equal(await page.locator(`.transition-endpoint[data-transition-id="${ids.transition}"]`).count(), 1);

    await page.evaluate(nodeId => {
        Store.findEntity(nodeId).state = 'active';
        App.renderAll();
    }, ids.node);
    assert.notEqual(await page.evaluate(() => Store.currentFloor().id), ids.floor);
    assert.equal(await page.locator(`.entity[data-id="${ids.inside}"]`).count(), 0);
    await context.close();
});

test('les couches transparentes laissent sélectionner et déplacer les éléments', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');
    const ids = await page.evaluate(() => {
        const floor = Store.currentFloor();
        const entity = Store.addEntity('camera', floor.id, 5, 5, 'Caméra interaction');
        const decor = Store.addDecor('counter', floor.id, 9, 5);
        const token = Store.addToken(floor.id, 13, 5);
        token.playerMovable = true;
        token.locked = false;
        Store.ui.activeTool = 'select';
        App.renderAll();
        return { entity: entity.id, decor: decor.id, token: token.id };
    });

    async function centerOf(selector) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, selector + ' sans géométrie');
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }

    const entitySelector = `.entity[data-id="${ids.entity}"]`;
    const entityCenter = await centerOf(entitySelector);
    assert.equal(await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y).classList.contains('entity'), entityCenter), true);
    await page.mouse.move(entityCenter.x, entityCenter.y);
    await page.mouse.down();
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => Store.ui.selection), { kind: 'entity', id: ids.entity });

    const decorSelector = `.decor[data-id="${ids.decor}"]`;
    const decorCenter = await centerOf(decorSelector);
    assert.equal(await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y).classList.contains('decor'), decorCenter), true);
    await page.mouse.move(decorCenter.x, decorCenter.y);
    await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => Store.ui.selection), { kind: 'decor', id: ids.decor });
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => Store.ui.selection), { kind: 'decor', id: ids.decor });

    const tokenSelector = `.runner-token[data-id="${ids.token}"]`;
    const tokenCenter = await centerOf(tokenSelector);
    const before = await page.evaluate(id => {
        const token = Store.findToken(id);
        return { x: token.x, y: token.y };
    }, ids.token);
    await page.mouse.move(tokenCenter.x, tokenCenter.y);
    await page.mouse.down();
    await page.mouse.move(tokenCenter.x + 80, tokenCenter.y + 45, { steps: 5 });
    await page.mouse.up();
    const after = await page.evaluate(id => {
        const token = Store.findToken(id);
        return { x: token.x, y: token.y, selection: Store.ui.selection };
    }, ids.token);
    assert.notDeepEqual({ x: after.x, y: after.y }, before);
    assert.deepEqual(after.selection, { kind: 'token', id: ids.token });

    await page.evaluate(() => {
        Store.ui.selection = null;
        Store.ui.readOnly = true;
        App.renderAll();
    });
    const playerTokenCenter = await centerOf(tokenSelector);
    const playerBefore = await page.evaluate(id => {
        const token = Store.findToken(id);
        return { x: token.x, y: token.y };
    }, ids.token);
    await page.mouse.move(playerTokenCenter.x, playerTokenCenter.y);
    await page.mouse.down();
    await page.mouse.move(playerTokenCenter.x - 70, playerTokenCenter.y + 35, { steps: 5 });
    await page.mouse.up();
    const playerAfter = await page.evaluate(id => {
        const token = Store.findToken(id);
        return { x: token.x, y: token.y };
    }, ids.token);
    assert.notDeepEqual(playerAfter, playerBefore);
    await context.close();
});

test('les poignées règlent directement faisceaux, zones et seuils', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');

    const ids = await page.evaluate(() => {
        const floor = Store.currentFloor();
        const laser = Store.addEntity('detection_laser', floor.id, 5, 5, 'Laser réglable');
        Object.assign(laser.coverage, { direction: 0, range: 3, width: 0.5, sweep: null });
        const circle = Store.addEntity('security_mage', floor.id, 14, 5, 'Zone astrale');
        circle.coverage.radius = 2;
        const threshold = Store.addEntity('mad_gate', floor.id, 10, 10, 'Seuil orientable');
        Object.assign(threshold.coverage, { direction: 0, range: 1, width: 2, sweep: null });
        const cone = Store.addEntity('camera', floor.id, 1, 1, 'Cône réglable au bord');
        Object.assign(cone.coverage, { direction: -135, range: 10, angle: 60, sweep: null });
        Store.ui.selection = { kind: 'entity', id: laser.id };
        App.renderAll();
        return { laser: laser.id, circle: circle.id, threshold: threshold.id, cone: cone.id };
    });

    async function dragHandle(selector, gridX, gridY) {
        const handle = page.locator(selector);
        const box = await handle.boundingBox();
        assert.ok(box, selector + ' sans géométrie');
        const target = await page.evaluate(({ x, y }) => {
            const board = document.querySelector('#board').getBoundingClientRect();
            const grid = Store.getPlan().grid;
            return {
                x: board.left + x * board.width / grid.cols,
                y: board.top + y * board.height / grid.rows
            };
        }, { x: gridX, y: gridY });
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 6 });
        await page.mouse.up();
    }

    const laserAxis = `#g-coverage-handles .coverage-handle-axis[data-entity-id="${ids.laser}"]`;
    const laserWidth = `#g-coverage-handles .coverage-handle-width[data-entity-id="${ids.laser}"]`;
    assert.equal(await page.locator(laserAxis).count(), 1);
    assert.equal(await page.locator(laserWidth).count(), 1);
    await dragHandle(laserAxis, 9, 5);
    await dragHandle(laserWidth, 7, 6);
    let coverage = await page.evaluate(id => ({ ...Store.findEntity(id).coverage }), ids.laser);
    assert.equal(coverage.direction, 0);
    assert.equal(coverage.range, 4);
    assert.equal(coverage.width, 2);
    await page.locator('#undo-btn').click();
    coverage = await page.evaluate(id => ({ ...Store.findEntity(id).coverage }), ids.laser);
    assert.equal(coverage.range, 4);
    assert.equal(coverage.width, 0.5);
    await page.locator('#redo-btn').click();
    coverage = await page.evaluate(id => ({ ...Store.findEntity(id).coverage }), ids.laser);
    assert.equal(coverage.width, 2);

    await page.evaluate(id => {
        Store.ui.selection = { kind: 'entity', id };
        MapView.renderCoverageHandles(Date.now());
    }, ids.circle);
    const radius = `#g-coverage-handles .coverage-handle-radius[data-entity-id="${ids.circle}"]`;
    assert.equal(await page.locator(radius).count(), 1);
    await dragHandle(radius, 17.5, 5);
    coverage = await page.evaluate(id => ({ ...Store.findEntity(id).coverage }), ids.circle);
    assert.equal(coverage.radius, 3.5);

    await page.evaluate(id => {
        Store.ui.selection = { kind: 'entity', id };
        MapView.renderCoverageHandles(Date.now());
    }, ids.threshold);
    const thresholdAxis = `#g-coverage-handles .coverage-handle-axis[data-entity-id="${ids.threshold}"]`;
    const thresholdWidth = `#g-coverage-handles .coverage-handle-width[data-entity-id="${ids.threshold}"]`;
    assert.equal(await page.locator(thresholdAxis).count(), 1);
    assert.equal(await page.locator(thresholdWidth).count(), 1);
    await dragHandle(thresholdAxis, 11.5, 11.5);
    coverage = await page.evaluate(id => ({ ...Store.findEntity(id).coverage }), ids.threshold);
    assert.equal(coverage.direction, 45);
    assert.equal(coverage.range, 4);

    const coneHandles = await page.evaluate(id => {
        Store.ui.selection = { kind: 'entity', id };
        MapView.renderCoverageHandles(Date.now());
        return [...document.querySelectorAll('#g-coverage-handles .coverage-handle')]
            .map(handle => handle.dataset.handle).sort();
    }, ids.cone);
    assert.deepEqual(coneHandles, ['angle', 'axis']);
    const coneBounds = await page.evaluate(() => {
        const board = document.querySelector('#board').getBoundingClientRect();
        const handles = [...document.querySelectorAll('#g-coverage-handles .coverage-handle')]
            .map(handle => handle.getBoundingClientRect());
        return handles.map(handle => ({
            left: handle.left - board.left,
            top: handle.top - board.top,
            right: board.right - handle.right,
            bottom: board.bottom - handle.bottom
        }));
    });
    assert.ok(coneBounds.every(bounds => Object.values(bounds).every(value => value >= -0.5)),
        JSON.stringify(coneBounds));

    assert.equal(await page.evaluate(() => {
        Store.ui.readOnly = true;
        App.renderAll();
        return document.querySelectorAll('#g-coverage-handles .coverage-handle').length;
    }), 0);
    await context.close();
});

test('un geste tactile respecte le verrou puis confirme une transition', async () => {
    const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: true
    });
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.goto(baseUrl + '/index.html');
    const ids = await page.evaluate(() => {
        const sourceFloor = Store.currentFloor();
        const targetFloor = Store.addFloor('Destination tactile');
        const transition = Store.addTransition('stairs', 'Escalier tactile');
        transition.revealed = true;
        const source = Store.addTransitionEndpoint(transition, sourceFloor.id, 11, 5);
        const destination = Store.addTransitionEndpoint(transition, targetFloor.id, 6, 6);
        const token = Store.addToken(sourceFloor.id, 7, 5);
        token.playerMovable = true;
        token.locked = true;
        Store.ui.readOnly = true;
        Store.ui.selection = null;
        App.renderAll();
        return {
            token: token.id,
            transition: transition.id,
            sourceEndpoint: source.id,
            targetFloor: targetFloor.id,
            destination: { x: destination.x, y: destination.y }
        };
    });

    async function touchDrag(start, end) {
        const point = (x, y) => ({ x: Math.round(x), y: Math.round(y), id: 1,
            radiusX: 6, radiusY: 6, force: 1 });
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [point(start.x, start.y)]
        });
        for (let step = 1; step <= 5; step += 1) {
            const ratio = step / 5;
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [point(
                    start.x + (end.x - start.x) * ratio,
                    start.y + (end.y - start.y) * ratio
                )]
            });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }

    async function centerOf(selector) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, selector + ' sans géométrie tactile');
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }

    const tokenSelector = `.runner-token[data-id="${ids.token}"]`;
    let tokenCenter = await centerOf(tokenSelector);
    const lockedBefore = await page.evaluate(id => {
        const token = Store.findToken(id);
        return { x: token.x, y: token.y };
    }, ids.token);
    await touchDrag(tokenCenter, { x: tokenCenter.x + 90, y: tokenCenter.y + 45 });
    const lockedAfter = await page.evaluate(id => {
        const token = Store.findToken(id);
        return { x: token.x, y: token.y };
    }, ids.token);
    assert.deepEqual(lockedAfter, lockedBefore);

    await page.evaluate(id => {
        Store.findToken(id).locked = false;
        Store.ui.selection = null;
        App.closeDrawers();
        window.__touchPointerLog = [];
        ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(type => {
            window.addEventListener(type, event => window.__touchPointerLog.push({
                type,
                pointerType: event.pointerType,
                target: event.target.className || event.target.id || event.target.tagName
            }), true);
        });
        App.renderAll();
    }, ids.token);
    tokenCenter = await centerOf(tokenSelector);
    const endpointCenter = await centerOf(
        `.transition-endpoint[data-transition-id="${ids.transition}"]`);
    let confirmation = '';
    page.once('dialog', async dialog => {
        confirmation = dialog.message();
        await dialog.accept();
    });
    await touchDrag(tokenCenter, endpointCenter);
    await page.waitForTimeout(250);
    const arrival = await page.evaluate(id => {
        const token = Store.findToken(id);
        return {
            floorId: token.floorId,
            x: token.x,
            y: token.y,
            currentFloorId: Store.ui.currentFloorId,
            pointerLog: window.__touchPointerLog
        };
    }, ids.token);
    assert.equal(arrival.floorId, ids.targetFloor,
        JSON.stringify({ confirmation, arrival, expected: ids }));
    assert.match(confirmation, /Escalier tactile/);
    assert.equal(arrival.currentFloorId, ids.targetFloor);
    assert.equal(arrival.x, ids.destination.x);
    assert.equal(arrival.y, ids.destination.y);
    assert.ok(arrival.pointerLog.some(event =>
        event.type === 'pointerdown' && event.pointerType === 'touch'));
    assert.ok(arrival.pointerLog.some(event =>
        event.type === 'pointerup' && event.pointerType === 'touch'));
    await context.close();
});

test('le mode MJ passe des colonnes aux tiroirs sans perdre la carte', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');

    let metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        toolsWidth: document.querySelector('#tools-panel').getBoundingClientRect().width,
        inspectorWidth: document.querySelector('#inspector-panel').getBoundingClientRect().width,
        mapWidth: document.querySelector('#map-wrapper').getBoundingClientRect().width,
        drawerToggle: getComputedStyle(document.querySelector('.layout-controls')).display
    }));
    assert.equal(metrics.overflow, 0);
    assert.ok(metrics.toolsWidth >= 200);
    assert.ok(metrics.inspectorWidth >= 260);
    assert.ok(metrics.mapWidth >= 880);
    assert.equal(metrics.drawerToggle, 'none');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(100);
    metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        toolsWidth: document.querySelector('#tools-panel').getBoundingClientRect().width,
        inspectorWidth: document.querySelector('#inspector-panel').getBoundingClientRect().width,
        mapWidth: document.querySelector('#map-wrapper').getBoundingClientRect().width,
        drawerToggle: getComputedStyle(document.querySelector('.layout-controls')).display
    }));
    assert.equal(metrics.overflow, 0);
    assert.ok(metrics.toolsWidth >= 200);
    assert.ok(metrics.inspectorWidth >= 260);
    assert.ok(metrics.mapWidth >= 700);
    assert.equal(metrics.drawerToggle, 'none');

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(250);
    metrics = await page.evaluate(() => {
        const tools = document.querySelector('#tools-panel').getBoundingClientRect();
        const controls = [...document.querySelectorAll(
            'header h1, .header-right > :not(.history-controls):not(.layout-controls), '
            + '.history-controls button, .layout-controls button')]
            .filter(element => {
                const rect = element.getBoundingClientRect();
                return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0;
            }).map(element => element.getBoundingClientRect());
        const overlaps = controls.some((a, index) => controls.slice(index + 1).some(b =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
        return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            toolsRight: tools.right,
            mapWidth: document.querySelector('#map-wrapper').getBoundingClientRect().width,
            mapHeight: document.querySelector('#map-wrapper').getBoundingClientRect().height,
            drawerToggle: getComputedStyle(document.querySelector('.layout-controls')).display,
            headerOverlap: overlaps
        };
    });
    assert.equal(metrics.overflow, 0);
    assert.ok(metrics.toolsRight <= 2, JSON.stringify(metrics));
    assert.ok(metrics.mapWidth > 990);
    assert.ok(metrics.mapHeight > 450);
    assert.notEqual(metrics.drawerToggle, 'none');
    assert.equal(metrics.headerOverlap, false);

    await page.locator('#tools-toggle').click();
    await page.waitForTimeout(250);
    metrics = await page.evaluate(() => {
        const tools = document.querySelector('#tools-panel').getBoundingClientRect();
        return {
            bodyOpen: document.body.classList.contains('tools-open'),
            toolsLeft: Math.round(tools.left),
            backdrop: getComputedStyle(document.querySelector('#panel-backdrop')).pointerEvents
        };
    });
    assert.equal(metrics.bodyOpen, true);
    assert.equal(metrics.toolsLeft, 0);
    assert.equal(metrics.backdrop, 'auto');
    await page.locator('#panel-backdrop').click({ position: { x: 700, y: 300 } });
    assert.equal(await page.evaluate(() => document.body.classList.contains('tools-open')), false);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.locator('#inspector-toggle').click();
    await page.waitForTimeout(250);
    metrics = await page.evaluate(() => {
        const drawer = document.querySelector('#inspector-panel').getBoundingClientRect();
        const controls = [...document.querySelectorAll(
            'header h1, .header-right > :not(.history-controls):not(.layout-controls), '
            + '.history-controls button, .layout-controls button')]
            .filter(element => {
                const rect = element.getBoundingClientRect();
                return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0;
            }).map(element => element.getBoundingClientRect());
        const overlaps = controls.some((a, index) => controls.slice(index + 1).some(b =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
        return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            drawerLeft: Math.round(drawer.left),
            drawerBottom: Math.round(drawer.bottom),
            drawerWidth: Math.round(drawer.width),
            viewportHeight: document.documentElement.clientHeight,
            headerOverlap: overlaps
        };
    });
    assert.equal(metrics.overflow, 0);
    assert.equal(metrics.drawerLeft, 0);
    assert.equal(metrics.drawerBottom, metrics.viewportHeight);
    assert.equal(metrics.drawerWidth, 768);
    assert.equal(metrics.headerOverlap, false);
    await page.locator('#inspector-close').click();

    await page.locator('#snapshot-btn').click();
    metrics = await page.evaluate(() => {
        const panel = document.querySelector('#snapshot-panel').getBoundingClientRect();
        return {
            left: panel.left,
            right: panel.right,
            top: panel.top,
            bottom: panel.bottom,
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight
        };
    });
    assert.ok(metrics.left >= 0 && metrics.top >= 0);
    assert.ok(metrics.right <= metrics.width && metrics.bottom <= metrics.height);
    await context.close();
});

test('les deux orientations de la tablette cible restent sans débordement', async () => {
    const context = await browser.newContext({ viewport: { width: 2304, height: 1440 } });
    await context.route('**/js/cloud.js*', route => route.abort());
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html');
    await page.evaluate(() => { Store.ui.readOnly = true; App.renderAll(); });
    let metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mapWidth: document.querySelector('#map-wrapper').getBoundingClientRect().width,
        toggleHeight: document.querySelector('#player-inspector-toggle').getBoundingClientRect().height
    }));
    assert.equal(metrics.overflow, 0);
    assert.ok(metrics.mapWidth > 2200);
    assert.ok(metrics.toggleHeight >= 44);
    await page.locator('#player-inspector-toggle').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('inspector-open')), true);

    await page.setViewportSize({ width: 1440, height: 2304 });
    metrics = await page.evaluate(() => {
        const drawer = document.querySelector('#inspector-panel').getBoundingClientRect();
        return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            drawerBottom: Math.round(drawer.bottom),
            viewportHeight: document.documentElement.clientHeight,
            drawerWidth: Math.round(drawer.width)
        };
    });
    assert.equal(metrics.overflow, 0);
    assert.equal(metrics.drawerBottom, metrics.viewportHeight);
    assert.equal(metrics.drawerWidth, 1440);

    await page.evaluate(() => App.closeDrawers());
    await page.setViewportSize({ width: 1024, height: 768 });
    metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mapWidth: document.querySelector('#map-wrapper').getBoundingClientRect().width,
        mapHeight: document.querySelector('#map-wrapper').getBoundingClientRect().height
    }));
    assert.equal(metrics.overflow, 0);
    assert.ok(metrics.mapWidth > 990);
    assert.ok(metrics.mapHeight > 600);

    await page.setViewportSize({ width: 768, height: 1024 });
    metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mapWidth: document.querySelector('#map-wrapper').getBoundingClientRect().width,
        mapHeight: document.querySelector('#map-wrapper').getBoundingClientRect().height
    }));
    assert.equal(metrics.overflow, 0);
    assert.ok(metrics.mapWidth > 740);
    assert.ok(metrics.mapHeight > 850);
    await context.close();
});

test('deux écrans synchronisent la position d’un pion et les découvertes', async () => {
    remotePlan = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/plan-v1-production.json'), 'utf8'));
    remotePlan.revision = 0;
    remoteTokens = [{
        id: 'token-sync', name: 'Runner synchronisé', shortLabel: 'RS',
        color: '#00d2ff', icon: 'runner', floorId: 'f_mrjazc0tos95t',
        x: 2.5, y: 2.5, playerMovable: true, visible: true, locked: false,
        updatedAt: Date.now()
    }];
    remoteDiscoveries = [];

    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    await context.addInitScript(mockCloudScript);
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([
        first.goto(baseUrl + '/index.html'),
        second.goto(baseUrl + '/index.html')
    ]);
    await Promise.all([
        first.waitForFunction(() => Store.ui.readOnly && !!Store.findToken('token-sync')),
        second.waitForFunction(() => Store.ui.readOnly && !!Store.findToken('token-sync'))
    ]);

    await first.evaluate(async () => {
        const token = Store.findToken('token-sync');
        token.x = 8.5;
        token.y = 6.5;
        await Store.commitTokenPosition(token);
    });
    await second.waitForFunction(() => {
        const token = Store.findToken('token-sync');
        return token && token.x === 8.5 && token.y === 6.5;
    });
    const syncedToken = await second.evaluate(() => ({ ...Store.findToken('token-sync') }));
    assert.equal(syncedToken.name, 'Runner synchronisé');
    assert.equal(syncedToken.playerMovable, true);

    const discoveredId = await first.evaluate(() => {
        const entity = Store.floorEntities('f_mrjazc0tos95t')[0];
        Store.addDiscovery('entity', entity, 'token-sync', entity.floorId);
        return entity.id;
    });
    await second.waitForFunction(id => Store.isDiscovered('entity', id), discoveredId);
    assert.equal(await second.evaluate(id => Store.isDiscovered('entity', id), discoveredId), true);
    await context.close();
});

test('supprimer les dernières données ne relance pas leur migration', async () => {
    remotePlan = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/plan-v1-production.json'), 'utf8'));
    remotePlan.revision = 0;
    remoteTokens = [{
        id: 'token-delete', name: 'Runner à supprimer', shortLabel: 'RS',
        color: '#00d2ff', icon: 'runner', floorId: 'f_mrjazc0tos95t',
        x: 2.5, y: 2.5, playerMovable: true, visible: true, locked: false,
        updatedAt: Date.now()
    }];
    remoteDiscoveries = [{
        id: 'room-delete', kind: 'room', elementId: 'r_mrjazc0tjak55',
        floorId: 'f_mrjazc0tos95t', discoveredBy: 'token-delete',
        discoveredAt: Date.now()
    }];

    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    await context.addInitScript(mockCloudScript);
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html?admin=1&stale-delete=1');
    await page.waitForFunction(() => !Store.ui.readOnly
        && Store.getTokens().length === 1 && Store.getDiscoveries().length === 1);

    await page.evaluate(() => {
        Store.deleteToken('token-delete');
        Store.resetDiscoveries();
    });
    await page.waitForFunction(() => Store.getTokens().length === 0
        && Store.getDiscoveries().length === 0);
    await page.waitForTimeout(100);
    assert.equal(remoteTokens.length, 0);
    assert.equal(remoteDiscoveries.length, 0);
    await context.close();
});

test('un plan v2 vide ignore les anciennes données locales au rechargement', async () => {
    remotePlan = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/plan-v1-production.json'), 'utf8'));
    remotePlan.schemaVersion = 2;
    remotePlan.revision = 9;
    remoteTokens = [];
    remoteDiscoveries = [];

    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    await context.addInitScript(mockCloudScript);
    const page = await context.newPage();
    await page.goto(baseUrl + '/index.html?admin=1&stale-local=1');
    await page.waitForFunction(() => !Store.ui.readOnly
        && Store.getPlan().schemaVersion === 2
        && Store.getTokens().length === 0
        && Store.getDiscoveries().length === 0);
    await page.waitForTimeout(100);
    assert.equal(remoteTokens.length, 0);
    assert.equal(remoteDiscoveries.length, 0);
    await context.close();
});

test('deux clients détectent un conflit de révision avant écrasement', async () => {
    remotePlan = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'tests/fixtures/plan-v1-production.json'), 'utf8'));
    remotePlan.revision = 0;
    const context = await browser.newContext();
    await context.route('**/js/cloud.js*', route => route.abort());
    await context.addInitScript(mockCloudScript);
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([
        first.goto(baseUrl + '/index.html?admin=1'),
        second.goto(baseUrl + '/index.html?admin=1')
    ]);
    await Promise.all([
        first.waitForFunction(() => !Store.ui.readOnly && Store.getPlan().revision === 0),
        second.waitForFunction(() => !Store.ui.readOnly && Store.getPlan().revision === 0)
    ]);

    await second.evaluate(() => {
        Store.getPlan().name = 'Modification concurrente B';
        Store.touch('Modification concurrente B');
    });
    await first.evaluate(async () => {
        Store.getPlan().name = 'Modification concurrente A';
        Store.touch('Modification concurrente A');
        await Store.saveNow();
    });
    await second.locator('#conflict-panel:not([hidden])').waitFor({ state: 'visible' });
    assert.match(await second.locator('#save-status').innerText(), /Conflit/);
    assert.equal(await second.evaluate(() => Store.getPlan().name), 'Modification concurrente B');
    await context.close();
});

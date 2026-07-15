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
    window.Cloud = (() => {
        const channel = new BroadcastChannel('shadowrunbank-test-cloud');
        const listeners = new Set();
        const notify = async () => {
            const response = await fetch('/__test-cloud/plan');
            const plan = await response.json();
            listeners.forEach(listener => listener(plan, false));
        };
        channel.addEventListener('message', notify);
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
                listeners.add(callback);
                notify().catch(onError);
                return () => listeners.delete(callback);
            },
            subscribeTokens(callback) { queueMicrotask(() => callback([], false)); return () => {}; },
            subscribeDiscoveries(callback) { queueMicrotask(() => callback([], false)); return () => {}; },
            saveToken: async () => ({}),
            updateTokenPosition: async () => ({}),
            deleteToken: async () => ({}),
            saveDiscovery: async () => ({}),
            deleteDiscoveries: async () => ({}),
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

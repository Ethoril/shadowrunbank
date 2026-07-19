import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '_site');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'index.html'), path.join(output, 'index.html'));
await cp(path.join(root, 'css'), path.join(output, 'css'), { recursive: true });
await cp(path.join(root, 'js'), path.join(output, 'js'), { recursive: true });
await mkdir(path.join(output, 'assets', 'icons'), { recursive: true });
await cp(path.join(root, 'assets', 'icons', 'map'), path.join(output, 'assets', 'icons', 'map'), { recursive: true });

await stampAssetVersions(path.join(output, 'index.html'));

console.log('Site statique prêt dans _site/');

// Cache-busting automatique : réécrit `?v=<hash>` sur chaque asset local (js/css)
// référencé dans index.html d'après le hash de son contenu. Toute modification
// d'un fichier change son URL, donc le navigateur recharge la version à jour —
// plus besoin d'incrémenter les numéros de version à la main.
async function stampAssetVersions(indexPath) {
    const assetRef = /(src|href)="((?:js|css)\/[^"?]+)(?:\?v=[^"]*)?"/g;
    let html = await readFile(indexPath, 'utf8');
    const hashes = new Map();
    for (const [, , assetPath] of html.matchAll(assetRef)) {
        if (hashes.has(assetPath)) continue;
        const content = await readFile(path.join(output, assetPath));
        hashes.set(assetPath, createHash('sha256').update(content).digest('hex').slice(0, 10));
    }
    html = html.replace(assetRef, (_match, attr, assetPath) =>
        `${attr}="${assetPath}?v=${hashes.get(assetPath)}"`);
    await writeFile(indexPath, html);
}

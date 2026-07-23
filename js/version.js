/* ============================================================
   version.js — Indicateur de build.

   Affiche dans le header la version chargée et détecte si une
   version plus récente est déployée (cache navigateur, ou GitHub
   Pages qui sert encore l'ancien index.html). Répond à la question
   « suis-je sur la dernière version ou sur du cache ? ».

   Fonctionnement :
   - <meta name="app-build"> porte l'identifiant du build EMBARQUÉ
     dans la page (écrit au build par build-site.mjs).
   - version.json (à la racine du site, écrit au build) porte
     l'identifiant du DERNIER build déployé, servi sans cache.
   - Si les deux diffèrent → la page affichée est périmée : on
     propose un rechargement.
   ============================================================ */
(function () {
    const meta = document.querySelector('meta[name="app-build"]');
    const build = (meta && meta.content && meta.content.trim()) || 'dev';
    window.__BUILD__ = build;
    console.info('%c[BUILD] ' + build, 'color:#39d0ff;font-weight:bold');

    const badge = document.getElementById('app-version');
    if (!badge) return;
    badge.hidden = false;

    const short = value => String(value).split(/\s|·/)[0].slice(0, 10);

    function setState(state, text, title) {
        badge.dataset.state = state;
        badge.textContent = text;
        badge.title = title || '';
    }

    // Build non déployé (source brute ou ouverture en file://) : aucun
    // version.json à comparer, on affiche juste « dev » sans contrôle.
    if (build === 'dev' || location.protocol === 'file:') {
        setState('dev', 'v_dev', 'Build de développement (non déployé)');
        return;
    }

    setState('checking', '⋯ v_' + short(build), 'Vérification de la version en cours…');

    let checking = false;
    async function check() {
        if (checking) return;
        checking = true;
        try {
            // no-store + cache-buster : on veut la vérité du serveur, pas le cache.
            const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const latest = await res.json();
            if (latest && latest.build && latest.build !== build) {
                setState('stale', '⟳ Nouvelle version — Recharger',
                    'Version affichée : ' + build
                    + '\nDernière déployée : ' + latest.build
                    + '\nCliquer pour recharger.');
            } else {
                setState('fresh', '🟢 v_' + short(build), 'À jour · build ' + build);
            }
        } catch (err) {
            // Réseau coupé ou version.json absent : on n'affirme rien, on montre
            // seulement le build chargé.
            setState('unknown', 'v_' + short(build),
                'Build ' + build + ' · contrôle de version indisponible');
        } finally {
            checking = false;
        }
    }

    badge.addEventListener('click', () => {
        if (badge.dataset.state === 'stale') location.reload();
    });

    // Contrôle au chargement, puis à chaque retour sur l'onglet (sans timer :
    // couvre le cas « onglet resté ouvert pendant un déploiement »).
    check();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && badge.dataset.state !== 'stale') check();
    });
})();

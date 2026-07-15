# Tests

La phase 8 sépare désormais deux niveaux de contrôle :

- `tests/unit/` vérifie le modèle, la migration, l’historique, le catalogue et les calculs purs ;
- `tests/integration/` lance l’application dans Chromium, exécute les 200 smoke tests, contrôle
  les deux orientations de la tablette et simule un conflit entre deux clients ;
- `test_smoke.html` reste ouvrable directement pour un diagnostic visuel rapide.

Installation puis exécution :

```sh
pnpm install
pnpm test
```

Sur macOS, la suite d’intégration utilise Google Chrome installé dans `/Applications` par défaut.
La variable `CHROME_PATH` permet de choisir un autre exécutable. En CI, Playwright fournit Chromium.

# Shadowrun Bank Planner

Plan interactif de banque pour une run Shadowrun — le MJ construit le plan (étages, pièces,
dispositifs de sécurité, rondes, cônes de vision) et les joueurs le consultent en temps réel,
filtré par ce que le MJ a révélé.

**Application :** https://ethoril.github.io/shadowrunbank/

- **Mode joueur** (défaut, sans login) : lecture seule, mise à jour en direct via Firestore.
- **Mode MJ** : bouton `🔑 Admin` → login Google (email admin), édition complète + contrôle
  de la révélation.

## Stack

Statique pur (GitHub Pages), zéro build. Firebase v10+ (Auth Google + Firestore) via CDN,
chargé en module ES derrière `window.Cloud` ; le reste en scripts classiques. Fallback
`localStorage` si le cloud est indisponible.

Détails d'architecture et modèle de données : [implementation_plan.md](implementation_plan.md).

## Développement local

Servir le dossier en HTTP (les modules ES ne chargent pas en `file://`) :

```
python -m http.server 8000
```

puis ouvrir `http://localhost:8000/`. Sans réseau, l'appli fonctionne en mode éditeur local
(`localStorage`). `test_smoke.html` contient les tests smoke (à ouvrir dans un navigateur).

## Sécurité

Les règles Firestore ([firestore.rules](firestore.rules)) sont la vraie protection : lecture
publique, écriture réservée à l'email admin. À coller dans la console Firebase à chaque
modification.

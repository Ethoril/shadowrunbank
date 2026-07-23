# Runbook de migration et déploiement v2

La migration Firestore reste volontairement manuelle (voir §2). Le déploiement applicatif, lui,
est automatique depuis le 21 juillet 2026.

> **État du dépôt au 2026-07-23 :** la source GitHub Pages est configurée sur **GitHub Actions**.
> Tout push sur `main` déclenche le workflow **Déploiement GitHub Pages**
> (`.github/workflows/deploy-pages.yml`) : suite de tests, puis build et publication si elle passe.
> Le déclenchement manuel (`workflow_dispatch`) reste disponible pour republier sans nouveau commit.

## 1. Préparation

1. Vérifier que `pnpm test` et `pnpm build` passent sur la révision candidate.
2. Vérifier que le document `plans/main` exporté correspond à
   `tests/fixtures/plan-v1-production.json` ou documenter les différences récentes.
3. Exporter `plans/main` depuis Firebase et conserver le JSON hors du dépôt.
4. Déployer d’abord les règles `firestore.rules` ajoutant les sous-collections `tokens`,
   `discoveries` et `snapshots` : `firebase deploy --only firestore:rules`.
5. Ouvrir la version candidate en local, se connecter en MJ et utiliser **⛨ Snapshot**.
6. Vérifier dans Firestore la présence du snapshot, son `sourceRevision` et son plan complet.

## 2. Migration contrôlée

1. Ne laisser qu’un seul écran MJ connecté pendant la migration.
2. Charger la version candidate, sans modifier le plan, et vérifier la lecture v1.
3. Exporter une seconde copie JSON depuis l’application.
4. Effectuer la première sauvegarde MJ : elle migre le document en schéma v2 et incrémente sa révision.
5. Recharger immédiatement et contrôler étages, pièces, dispositifs, rondes, couvertures et révélations.
6. Vérifier les pions, transitions et collections de découvertes séparément.
7. En cas d’écart, ne pas poursuivre : restaurer l’export JSON ou le champ `plan` du snapshot pre-v2.

## 3. Déploiement

1. Fusionner la révision candidate sur `main` seulement après réussite du workflow **Tests** (pull
   request).
2. Le push sur `main` déclenche automatiquement **Déploiement GitHub Pages** : il rejoue toute la
   suite de tests puis publie `_site` si elle passe, sans confirmation supplémentaire.
3. Tester d’abord le mode joueur sans connexion, puis le mode MJ sur MacBook.
4. Tester la tablette physique 2304×1440 : drag d’un pion, transition d’étage et tiroir d’informations.
5. Garder l’ancien export et le snapshot jusqu’à la fin de la session de jeu suivante.

## 4. Retour arrière

1. Republier la dernière révision Git connue comme stable : `git revert` puis push sur `main`
   (redéclenche le déploiement automatique), ou lancer manuellement le workflow sur cette révision
   (`workflow_dispatch`).
2. Si les données ont été altérées, importer le JSON pre-v2 depuis le mode MJ.
3. Si l’import local est impossible, recopier dans `plans/main` le champ `plan` du snapshot Firestore.
4. Vérifier la révision et recharger un écran joueur avant de rouvrir l’édition.

## Contrôles qui restent physiques

- rendu réel sur le MacBook cible ;
- manipulation tactile sur la tablette 2304×1440 ;
- synchronisation Firestore réelle entre les deux appareils ;
- validation visuelle après publication GitHub Pages.

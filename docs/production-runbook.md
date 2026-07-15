# Runbook de migration et déploiement v2

Cette procédure est volontairement manuelle. Elle évite qu’un push de code déclenche seul une
migration Firestore ou une publication GitHub Pages.

## 1. Préparation

1. Vérifier que `pnpm test` et `pnpm build` passent sur la révision candidate.
2. Vérifier que le document `plans/main` exporté correspond à
   `tests/fixtures/plan-v1-production.json` ou documenter les différences récentes.
3. Exporter `plans/main` depuis Firebase et conserver le JSON hors du dépôt.
4. Déployer d’abord les règles `firestore.rules` ajoutant `plans/main/snapshots`.
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

## 3. Déploiement progressif

1. Fusionner la révision candidate seulement après réussite du workflow **Tests**.
2. Dans GitHub Actions, lancer **Déploiement progressif GitHub Pages** manuellement.
3. Saisir exactement `DEPLOY`. Le workflow rejoue tous les tests avant de publier `_site`.
4. Tester d’abord le mode joueur sans connexion, puis le mode MJ sur MacBook.
5. Tester la tablette physique 2304×1440 : drag d’un pion, transition d’étage et tiroir d’informations.
6. Garder l’ancien export et le snapshot jusqu’à la fin de la session de jeu suivante.

## 4. Retour arrière

1. Republier la dernière révision Git connue comme stable via le workflow manuel.
2. Si les données ont été altérées, importer le JSON pre-v2 depuis le mode MJ.
3. Si l’import local est impossible, recopier dans `plans/main` le champ `plan` du snapshot Firestore.
4. Vérifier la révision et recharger un écran joueur avant de rouvrir l’édition.

## Contrôles qui restent physiques

- rendu réel sur le MacBook cible ;
- manipulation tactile sur la tablette 2304×1440 ;
- synchronisation Firestore réelle entre les deux appareils ;
- validation visuelle après publication GitHub Pages.

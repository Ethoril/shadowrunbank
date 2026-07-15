# Fixtures de référence

`plan-v1-production.json` est une copie en lecture seule du document
`plans/main` récupérée depuis Firestore le 15 juillet 2026. Le champ technique
Firestore `savedAt` est volontairement exclu ; toutes les données applicatives,
les identifiants et la géométrie du plan sont conservés.

Cette fixture ne doit pas être modifiée lors des migrations : les tests vérifient
que le schéma v1 reste lisible et qu'il peut être converti sans perte vers le
schéma v2.

# Shadowrun Bank Planner — Feuille de route v2

> Plan validé le 15 juillet 2026.
>
> Ce document est la feuille de route de référence pour la prochaine évolution
> du projet. Le fichier `implementation_plan.md` reste l'historique de la v1.

## Légende

- [ ] À faire
- [x] Terminé
- **Bloquant** : doit être terminé avant la phase suivante
- **Optionnel** : peut être reporté sans empêcher la livraison

---

## 1. Objectifs

Faire évoluer l'application actuelle sans réécriture complète afin de disposer de :

- un éditeur fiable sur MacBook pour le MJ ;
- une consultation confortable sur tablette pour les joueurs ;
- une synchronisation sûre entre plusieurs machines ;
- des données validées, migrables et restaurables ;
- des décors participant au calcul des champs de vision ;
- un système générique de zones de détection ;
- l'ensemble des dispositifs de sécurité physiques, électroniques et magiques ;
- des pions PJ déplaçables au doigt pendant la partie ;
- des escaliers, ascenseurs et autres points de transition liés entre les étages ;
- une révélation automatique des salles et éléments effectivement découverts par les PJ ;
- des sauvegardes, un historique minimal et une fonction annuler/rétablir.

## 2. Décisions actées

- Un seul plan actif est nécessaire pour le moment : **plans/main**.
- La protection contre un joueur inspectant Firestore ou le code n'est pas une priorité.
- Le mode joueur cible une tablette, principalement en paysage.
- Le mode MJ cible un MacBook ou un écran d'ordinateur équivalent.
- Aucun travail spécifique n'est demandé pour les smartphones.
- La navigation complète au clavier n'est pas prioritaire.
- Les notes réservées au MJ doivent être séparées des informations visibles par les joueurs.
- Plusieurs banques, campagnes ou plans ne sont pas nécessaires pour cette version.
- Les décors doivent pouvoir influer sur les champs de vision.
- Le MJ crée et configure les pions PJ.
- Les joueurs peuvent déplacer les pions autorisés depuis la tablette.
- Les changements d'étage passent par des points de transition explicitement liés.
- Entrer dans une salle cachée la révèle durablement.
- Les dispositifs et personnages visibles depuis le pion sont découverts automatiquement.
- Les rondes et champs de détection restent sous contrôle du MJ et ne sont pas
  automatiquement révélés avec leur propriétaire.

## 3. Périmètre

### Inclus

- Un plan Firestore unique.
- Mode MJ complet sur ordinateur.
- Mode joueur tactile sur tablette.
- Décors visuels et occultants.
- Pions PJ tactiles synchronisés en temps réel.
- Escaliers, ascenseurs et transitions multi-étages.
- Exploration et révélation automatique par ligne de vue.
- Détection optique, infrarouge, laser, magnétique, physique et astrale.
- Notes MJ et informations joueurs séparées dans l'interface.
- Migration transparente des données actuelles.
- Export et import JSON.
- Historique de versions.
- Annuler et rétablir.
- Résolution explicite des conflits de sauvegarde.

### Hors périmètre

- Protection contre l'inspection technique des données par les joueurs.
- Interface dédiée aux téléphones.
- Plusieurs banques ou campagnes.
- Collaboration simultanée de plusieurs MJ.
- Gestion tactique complète des combats.
- Simulation détaillée de la hauteur ou des lignes de vue en 3D.

---

## 4. Architecture cible des données

## 4.1 Version du schéma

Le plan doit recevoir une version et une révision explicites.

~~~js
{
  schemaVersion: 2,
  revision: 12,
  updatedAt: "...",
  grid: {},
  floors: [],
  rooms: [],
  entities: [],
  decors: [],
  transitions: []
}
~~~

Au chargement :

1. lire le plan ;
2. valider sa structure ;
3. migrer une ancienne version ;
4. normaliser les champs manquants ;
5. restaurer une sauvegarde ou afficher une erreur exploitable si le plan est irrécupérable.

## 4.2 Notes MJ et informations joueurs

Remplacer le champ ambigu **note** par :

~~~js
{
  privateNote: "Informations réservées au MJ",
  playerInfo: "Informations visibles lorsque l'élément est révélé"
}
~~~

Règles de migration :

- l'ancien champ **note** devient **privateNote** ;
- **playerInfo** démarre vide ;
- seule **playerInfo** apparaît dans l'inspecteur joueur ;
- les deux champs restent modifiables depuis l'inspecteur MJ.

## 4.3 Capacités génériques

Le catalogue ne doit plus dépendre uniquement de **mobile** et **hasVision**.

~~~js
{
  id: "camera",
  category: "detection",
  label: "Caméra",
  icon: "CAM",
  color: "#ff2a2a",

  networkable: true,
  canPatrol: false,
  coverageType: "cone",
  coverageChannel: "optical",
  canSweep: true,
  blocksMovement: false,
  blocksVision: [],
  autoDiscover: true,
  stateProfile: "electronic"
}
~~~

Capacités prévues :

- **networkable**
- **canPatrol**
- **coverageType**
- **coverageChannel**
- **canSweep**
- **blocksMovement**
- **blocksVision**
- **accessControl**
- **magical**
- **stateProfile**

## 4.4 Profils d'état

Les libellés doivent correspondre à la nature de l'élément.

| Profil | États proposés |
|---|---|
| Électronique | Actif, piraté, hors ligne |
| Personnel | Vigilant, alerté, neutralisé |
| Magique | Actif, perturbé, dissipé ou banni |
| Accès / barrière | Verrouillé, ouvert, désactivé |
| Drone / tourelle | Actif, piraté, neutralisé |

Le stockage peut utiliser des valeurs communes, mais l'interface doit afficher des
libellés adaptés au profil.

---

## 5. Moteur générique de couverture

Le champ **vision** actuel doit évoluer vers un objet **coverage** plus général.

~~~js
coverage: {
  shape: "cone",
  channel: "optical",
  direction: 45,
  angle: 60,
  range: 8,
  width: 1,
  radius: 4,
  sweep: null,
  revealed: false
}
~~~

## 5.1 Formes

| Forme | Usage |
|---|---|
| cone | Caméra, garde, tourelle, drone |
| beam | Laser de détection |
| rectangle | Plaque de pression ou zone technique |
| circle | Détection astrale ou capteur omnidirectionnel |
| threshold | Portique MAD ou passage contrôlé |
| none | Scanner rétinien, analyse ADN, maglock |

## 5.2 Canaux

| Canal | Exemples |
|---|---|
| optical | Caméras, gardes, drones, tourelles |
| infrared | Détecteurs de mouvement infrarouge |
| laser | Lasers de détection |
| magnetic | Portiques MAD |
| pressure | Plaques de pression |
| astral | Mages, esprits et barrières de mana |

## 5.3 Occlusion

Le moteur doit exposer une fonction conceptuelle :

~~~js
computeOccluders(floorId, channel)
~~~

Elle combine :

- les contours des pièces ;
- les décors occultants ;
- les barrières physiques ;
- les barrières magiques ;
- ultérieurement, les portes et ouvertures.

Règles :

- les murs et décors opaques bloquent l'optique, l'infrarouge et les lasers ;
- les grilles d'acier bloquent le déplacement mais restent visibles au travers ;
- les barrières de mana bloquent ou délimitent l'astral ;
- les décors bas ou purement visuels ne bloquent rien ;
- les plaques de pression et portiques ne dépendent pas de la ligne de vue.

---

## 6. Décors

## 6.1 Modèle

~~~js
{
  id: "d_xxx",
  floorId: "f_xxx",
  type: "counter",
  name: "Comptoir d'accueil",

  x: 8,
  y: 4,
  width: 4,
  height: 1,
  rotation: 0,

  revealed: true,
  autoDiscover: true,
  blocksMovement: true,
  blocksVision: ["optical", "infrared", "laser"],

  privateNote: "",
  playerInfo: ""
}
~~~

## 6.2 Catalogue initial

### Structurels

- [ ] Mur ou cloison
- [ ] Pilier
- [ ] Porte opaque
- [ ] Ouverture ou passage
- [ ] Vitre
- [ ] Grille
- [ ] Escalier
- [ ] Ascenseur existant

### Mobilier occultant

- [ ] Comptoir
- [ ] Bureau
- [ ] Armoire
- [ ] Étagère
- [ ] Coffre ou coffre-fort
- [ ] Caisse
- [ ] Serveur ou baie informatique
- [ ] Grande plante ou séparation opaque

### Décor non occultant

- [ ] Chaise
- [ ] Banc
- [ ] Tapis
- [ ] Marquage au sol
- [ ] Petit mobilier
- [ ] Élément purement visuel

## 6.3 Outils d'édition

- [ ] Palette de décors dédiée
- [ ] Placement
- [ ] Déplacement
- [ ] Largeur et hauteur
- [ ] Rotation par pas de 90 degrés
- [ ] Duplication
- [ ] Suppression
- [ ] Révélation aux joueurs
- [ ] Choix des canaux de vision bloqués
- [ ] Choix du blocage de déplacement
- [ ] Notes MJ et informations joueurs

## 6.4 Ordre de rendu

1. Grille.
2. Pièces.
3. Décors au sol.
4. Décors et obstacles.
5. Zones de détection.
6. Rondes et câbles.
7. Dispositifs et personnages.

Les segments occultants doivent être recalculés uniquement lorsqu'une pièce, un
décor ou une barrière change.

---

## 7. Pions PJ et transitions entre étages

## 7.1 Pions PJ

Les pions PJ sont distincts des dispositifs de sécurité. Le MJ contrôle leur
création et leur configuration, tandis que les joueurs peuvent uniquement déplacer
les pions autorisés.

Modèle proposé :

~~~js
{
  id: "token_xxx",
  name: "Razor",
  shortLabel: "RZ",
  color: "#00d2ff",
  icon: "runner",

  floorId: "f_xxx",
  x: 8.5,
  y: 4.5,

  playerMovable: true,
  visible: true,
  locked: false,
  updatedAt: "..."
}
~~~

Fonctions MJ :

- [ ] Créer un pion
- [ ] Nommer le personnage
- [ ] Choisir couleur, initiales ou icône
- [ ] Placer et déplacer le pion
- [ ] Autoriser ou interdire le déplacement joueur
- [ ] Verrouiller temporairement le pion
- [ ] Téléporter manuellement le pion vers un étage
- [ ] Masquer ou afficher le pion
- [ ] Dupliquer et supprimer le pion

Fonctions joueur :

- [ ] Sélectionner un pion autorisé au toucher
- [ ] Le déplacer par glisser-déposer
- [ ] Conserver un mouvement fluide localement
- [ ] Enregistrer la position au relâchement
- [ ] Recevoir en direct les déplacements effectués sur les autres écrans
- [ ] Annuler visuellement le déplacement si le pion est verrouillé

Contraintes tactiles :

- zone interactive d'au moins 44 px ;
- utilisation de Pointer Events et de pointer capture ;
- aucune sélection accidentelle de la carte pendant le drag ;
- position limitée aux bornes de la grille ;
- snap optionnel à la demi-case ;
- priorité au déplacement du pion lorsqu'il est touché.

La première version n'impose pas de collisions strictes avec les murs. Une assistance
optionnelle pourra ensuite empêcher un pion de traverser les éléments portant
**blocksMovement**.

## 7.2 Stockage et synchronisation des pions

Les positions des pions ne doivent pas provoquer la réécriture du document complet du
plan. Elles seront stockées dans une sous-collection dédiée :

~~~text
plans/main/tokens/{tokenId}
~~~

Règles visées :

- lecture publique des pions ;
- création, suppression et configuration réservées au MJ ;
- mise à jour joueur limitée à **floorId**, **x**, **y** et **updatedAt** ;
- aucune modification joueur du nom, de la couleur ou des permissions ;
- validation des types et des limites numériques.

La découverte persistante utilise une seconde sous-collection :

~~~text
plans/main/discoveries/{elementKey}
~~~

Chaque document représente une découverte idempotente :

~~~js
{
  kind: "room",
  elementId: "r_xxx",
  floorId: "f_xxx",
  discoveredBy: "token_xxx",
  discoveredAt: "..."
}
~~~

La visibilité effective devient :

~~~text
révélé manuellement par le MJ OU découvert pendant l'exploration
~~~

Le MJ peut supprimer les découvertes pour réinitialiser une scène, sans modifier
les réglages de révélation manuelle du plan.

Stratégie de déplacement :

- rendu local à chaque frame pendant le drag ;
- une écriture Firestore au relâchement ;
- optionnellement une écriture intermédiaire limitée à quelques fois par seconde ;
- abonnement temps réel séparé du document principal ;
- le déplacement d'un pion ne modifie pas la révision du plan.

## 7.3 Points de transition

Un point de transition représente un escalier, un ascenseur, une échelle, une trappe
ou tout autre passage reliant plusieurs étages.

~~~js
{
  id: "tr_xxx",
  type: "elevator",
  name: "Ascenseur de service",
  bidirectional: true,
  state: "active",
  revealed: true,

  endpoints: [
    { id: "ep_a", floorId: "f_ground", x: 12, y: 8, label: "Rez-de-chaussée" },
    { id: "ep_b", floorId: "f_servers", x: 12, y: 8, label: "Sous-sol serveurs" },
    { id: "ep_c", floorId: "f_vault", x: 12, y: 8, label: "Voûte" }
  ]
}
~~~

Le tableau **endpoints** permet :

- un escalier reliant deux étages ;
- un ascenseur desservant plusieurs étages ;
- une transition à sens unique ;
- plusieurs points d'arrivée possibles.

## 7.4 Création des liens

Parcours MJ proposé :

1. choisir l'outil « Point de transition » ;
2. placer le premier point sur un étage ;
3. créer une nouvelle liaison ou choisir une liaison existante ;
4. changer d'étage ;
5. placer le point lié ;
6. nommer la liaison et choisir son type ;
7. ajouter d'autres arrêts si nécessaire.

Outils :

- [ ] Créer une liaison
- [ ] Ajouter un endpoint à une liaison
- [ ] Retirer un endpoint
- [ ] Déplacer un endpoint
- [ ] Renommer la liaison
- [ ] Choisir escalier, ascenseur, échelle, trappe ou passage
- [ ] Choisir sens unique ou bidirectionnel
- [ ] Activer ou désactiver la liaison
- [ ] Révéler ou cacher la liaison
- [ ] Associer éventuellement un maglock ou un contrôle d'accès

L'ascenseur existant doit pouvoir être converti en liaison sans supprimer
automatiquement les anciennes données.

## 7.5 Utilisation en partie

Lorsqu'un pion est relâché dans la zone d'activation d'un endpoint :

1. détecter la transition ;
2. afficher une confirmation tactile ;
3. pour un ascenseur, afficher les destinations disponibles ;
4. vérifier que la liaison est active et que la destination est autorisée ;
5. déplacer le pion vers les coordonnées de l'endpoint choisi ;
6. changer son **floorId** ;
7. basculer la tablette vers l'étage d'arrivée ;
8. appliquer les règles d'exploration à l'étage d'arrivée ;
9. synchroniser la nouvelle position et les découvertes.

Le déplacement ne doit jamais être automatique au simple survol : la confirmation
évite les changements d'étage accidentels.

Une destination encore inconnue peut être utilisée si la transition elle-même est
révélée et autorisée. Elle peut être affichée comme « Destination inconnue ». À
l'arrivée, l'étage et la salle d'arrivée sont révélés.

## 7.6 Exploration et révélation automatique

Le déplacement d'un pion constitue une action d'exploration.

Lorsqu'un pion entre dans une salle non révélée :

1. détecter le franchissement pendant le drag ou à l'arrivée d'une transition ;
2. révéler l'étage si nécessaire ;
3. révéler durablement la salle ;
4. calculer les lignes de vue optiques depuis le pion ;
5. révéler les décors, dispositifs et personnages visibles portant
   **autoDiscover: true** ;
6. persister ces découvertes dans la sous-collection dédiée ;
7. synchroniser immédiatement le résultat sur les autres écrans.

La ligne de vue réutilise le moteur d'occlusion :

- murs et décors opaques bloquent la découverte ;
- un objet derrière une armoire reste caché ;
- une grille d'acier laisse voir ce qui se trouve derrière ;
- seuls les éléments de la salle nouvellement explorée sont évalués dans la
  première version ;
- un élément déjà découvert ne génère pas une nouvelle écriture.

Comportement des éléments :

- gardes, mages, esprits, drones, tourelles et caméras visibles sont découverts ;
- mobilier et décors évidents peuvent être découverts automatiquement ;
- plaques de pression, lasers invisibles et capteurs dissimulés peuvent conserver
  **autoDiscover: false** ;
- le MJ peut modifier **autoDiscover** individuellement dans l'inspecteur ;
- la découverte d'une caméra ne révèle pas automatiquement son cône ;
- la découverte d'un garde ne révèle pas automatiquement son chemin de ronde ;
- **playerInfo** devient visible quand l'élément est découvert ;
- **privateNote** reste absente de l'interface joueur.

Pendant un drag, la découverte est déclenchée une seule fois lors du premier
franchissement de chaque salle. Si le pion traverse plusieurs salles, chacune est
traitée. Une découverte effectuée reste acquise même si le pion revient en arrière.

Contrôles MJ :

- [ ] Activer ou désactiver la découverte automatique d'un élément
- [ ] Distinguer révélation manuelle et découverte en partie
- [ ] Réinitialiser les découvertes d'un étage
- [ ] Réinitialiser toutes les découvertes
- [ ] Révéler ou cacher manuellement sans supprimer l'historique de découverte
- [ ] Voir quel pion a découvert un élément

## 7.7 Critères de validation

- [ ] Un pion se déplace correctement au doigt
- [ ] Le MJ peut verrouiller son déplacement
- [ ] Deux écrans voient la nouvelle position après relâchement
- [ ] Un escalier relie exactement deux endpoints
- [ ] Un ascenseur dessert au moins trois étages
- [ ] Une destination inconnue autorisée peut être rejointe
- [ ] Une transition désactivée ne peut pas être utilisée
- [ ] Le changement d'étage place le pion au bon endpoint
- [ ] La tablette affiche automatiquement l'étage d'arrivée
- [ ] L'étage et la salle d'arrivée sont révélés si nécessaire
- [ ] Entrer dans une salle cachée la révèle sur tous les écrans
- [ ] Une caméra visible dans la salle est découverte
- [ ] Un garde masqué par un décor opaque reste caché
- [ ] Une caméra découverte ne révèle pas automatiquement son cône
- [ ] Un garde découvert ne révèle pas automatiquement sa ronde
- [ ] Aucun déplacement de pion n'écrase une modification du plan

---

## 8. Catalogue de sécurité cible

| Élément | Identifiant proposé | Comportement | État |
|---|---|---|---|
| Portique MAD | mad_gate | Seuil magnétique, réseau | À faire |
| Maglock | maglock | Contrôle d'accès | Partiel |
| Scanner rétinien | retina_scanner | Contrôle biométrique ponctuel | À faire |
| Analyse ADN | dna_analyzer | Contrôle biométrique ponctuel | À faire |
| Caméra | camera | Cône optique, balayage | Existant |
| Détecteur infrarouge | infrared_motion_sensor | Cône ou zone infrarouge | À faire |
| Laser de détection | detection_laser | Faisceau arrêté par les obstacles | À faire |
| Plaque de pression | pressure_plate | Zone rectangulaire au sol | À faire |
| Micro-drone de sécurité | micro_security_drone | Mobile, ronde, petit cône | À faire |
| Drone de combat | combat_drone | Mobile, ronde, cône, profil armé | À faire |
| Tourelle automatique | automatic_turret | Cône optique, balayage, profil armé | Partiel |
| Garde armé | armed_guard | Mobile, ronde, perception | Partiel |
| Mage de sécurité | security_mage | Mobile, ronde, perception astrale | À faire |
| Grille d'acier | steel_grate | Barrière de déplacement | À faire |
| Barrière de mana | mana_barrier | Barrière astrale | Partiel |
| Esprit de patrouille | patrol_spirit | Mobile, ronde, détection astrale | À faire |

Éléments utilitaires conservés :

- [x] Nœud réseau
- [x] Ascenseur
- [x] Capteur générique temporaire

## 8.1 Migration des types existants

- [ ] **camera** reste **camera**
- [ ] **maglock** reste **maglock**
- [ ] **turret** devient **automatic_turret**
- [ ] **barrier** devient **mana_barrier**
- [ ] **guard** devient **armed_guard**
- [ ] **drone** reste « Drone à préciser » jusqu'au choix du MJ
- [ ] **sensor** reste générique jusqu'à reclassement manuel
- [ ] Préserver identifiants, positions, révélations, rondes et liaisons réseau

---

## 9. Robustesse des sauvegardes

## 9.1 File séquentielle

- [ ] Une seule écriture Firestore à la fois
- [ ] Mise en attente d'une nouvelle sauvegarde si une écriture est en cours
- [ ] Envoi automatique de la version la plus récente après confirmation
- [ ] États d'interface distincts :
  - modification locale ;
  - sauvegarde en cours ;
  - synchronisé ;
  - conflit ;
  - hors ligne.

## 9.2 Révisions et conflits

- [ ] Ajouter une révision serveur
- [ ] Sauvegarder avec une transaction Firestore
- [ ] Refuser une écriture basée sur une ancienne révision
- [ ] Proposer en cas de conflit :
  - charger la version distante ;
  - forcer la version locale avec confirmation ;
  - exporter la version locale avant remplacement.

## 9.3 Fermeture de page

- [ ] Écrire immédiatement le plan local lors de **pagehide**
- [ ] Conserver un marqueur **dirty** si Firestore n'a pas confirmé
- [ ] Reprendre la synchronisation au prochain démarrage

## 9.4 Sauvegardes et historique

- [ ] Export JSON manuel
- [ ] Import JSON avec validation et prévisualisation
- [ ] Sauvegarde automatique avant migration
- [ ] Snapshots nommés ou horodatés
- [ ] Conservation des 10 à 20 dernières versions importantes

---

## 10. Corrections fonctionnelles immédiates

- [ ] Arrêter et figer une ronde lorsque l'entité passe hors ligne ou est neutralisée
- [ ] Préserver la position courante lors d'un changement de vitesse
- [ ] Préserver la position courante lors du passage boucle / aller-retour
- [ ] Changer automatiquement d'étage depuis l'arbre Visibilité
- [ ] Séparer notes MJ et informations joueurs
- [ ] Sauvegarder localement à la fermeture
- [ ] Reconnecter Firestore ou afficher une action claire après une erreur
- [ ] Empêcher les dispositifs de sortir visuellement de la grille
- [ ] Normaliser portée, angle, vitesse et dimensions
- [ ] Demander confirmation avant « Tout révéler »
- [ ] Adapter le texte de l'inspecteur vide au mode joueur

---

## 11. Annuler, rétablir et productivité MJ

## 11.1 Transactions d'édition

Introduire un point d'entrée commun :

~~~js
Store.transaction("Déplacement caméra", () => {
  // mutation du plan
});
~~~

Une entrée d'historique doit représenter une action logique :

- un drag complet ;
- une session de peinture ;
- une suppression ;
- une modification de visibilité ;
- un déplacement ou redimensionnement de décor ;
- une modification de ronde.

## 11.2 Historique local

- [ ] Annuler
- [ ] Rétablir
- [ ] Limiter l'historique à environ 50 actions
- [ ] Grouper la saisie continue d'un même champ
- [ ] Ne pas enregistrer les frames d'animation

## 11.3 Outils complémentaires

- [ ] Dupliquer un dispositif
- [ ] Dupliquer un décor
- [ ] Copier et coller
- [ ] Supprimer le dernier waypoint
- [ ] Déplacer un waypoint
- [ ] Réordonner ou inverser une ronde
- [ ] Réinitialiser une couverture
- [ ] Centrer la carte sur un élément sélectionné dans l'arbre

---

## 12. Interface cible

## 12.1 MacBook MJ

- [ ] Palette regroupée en catégories :
  - Structure ;
  - Accès ;
  - Détection ;
  - Défense ;
  - Personnel ;
  - Magie ;
  - Décors.
- [ ] Catégories repliables
- [ ] Inspecteur dynamique selon les capacités
- [ ] Boutons Annuler, Rétablir et Export dans le header
- [ ] Arbre Visibilité enrichi avec décors et couvertures

## 12.2 Tablette joueur

Cibles :

- 1024 × 768 en paysage ;
- 768 × 1024 en portrait acceptable.

Travaux :

- [ ] Donner la priorité à la carte
- [ ] Transformer l'inspecteur en panneau ou tiroir refermable
- [ ] Agrandir les zones tactiles à environ 40–44 px
- [ ] Simplifier le header en mode joueur
- [ ] Vérifier l'absence de débordement horizontal
- [ ] Tester les changements d'étage au toucher
- [ ] Tester le déplacement tactile des pions
- [ ] Tester la confirmation des transitions
- [ ] Ne pas développer de mise en page spécifique au smartphone

---

## 13. Répartition technique

### store.js

- [ ] Schéma v2
- [ ] Validation
- [ ] Migrations
- [ ] Collection **decors**
- [ ] Collection **transitions**
- [ ] Accesseurs et état local des pions
- [ ] Registre local des découvertes
- [ ] Calcul de visibilité effective : manuel ou découvert
- [ ] Transactions d'édition
- [ ] Annuler et rétablir
- [ ] File de sauvegarde
- [ ] Révisions

### map.js

- [ ] Rendu des décors
- [ ] Rendu et drag tactile des pions
- [ ] Rendu des endpoints de transition
- [ ] Détection des salles traversées par un pion
- [ ] Tests de ligne de vue entre pion et éléments découvrables
- [ ] Moteur de couverture générique
- [ ] Occlusion par canal
- [ ] Cache des segments occultants
- [ ] Faisceaux, rectangles, cercles et seuils

### editor.js

- [ ] Palette catégorisée
- [ ] Placement des décors
- [ ] Rotation et redimensionnement
- [ ] Outils de zones et faisceaux
- [ ] Outil de création des transitions
- [ ] Création et configuration des pions
- [ ] Édition des waypoints

### inspector.js

- [ ] Champs générés selon les capacités
- [ ] Notes MJ et informations joueurs
- [ ] Profils d'état
- [ ] Paramètres des couvertures
- [ ] Paramètres d'occlusion
- [ ] Inspecteur de pion
- [ ] Inspecteur de transition
- [ ] Réglage **autoDiscover**
- [ ] Affichage de l'origine d'une révélation

### visibility.js

- [ ] Navigation vers l'étage sélectionné
- [ ] Branches Décors et Couvertures
- [ ] Branche Transitions
- [ ] Indication révélation manuelle ou découverte
- [ ] Commandes de réinitialisation des découvertes
- [ ] Actions globales avec confirmation
- [ ] Indication claire du contenu révélé

### cloud.js

- [ ] Transactions Firestore
- [ ] Révisions
- [ ] Conflits
- [ ] Snapshots
- [ ] Reconnexion
- [ ] Reprise des sauvegardes locales
- [ ] Abonnement temps réel aux pions
- [ ] Écriture légère des positions de pions
- [ ] Abonnement temps réel aux découvertes
- [ ] Écriture idempotente des découvertes

### firestore.rules

- [ ] Écriture toujours réservée au MJ
- [ ] Validation minimale de **schemaVersion**
- [ ] Validation minimale de **revision**
- [ ] Autorisation de la collection de snapshots
- [ ] Écriture joueur limitée aux coordonnées des pions
- [ ] Création joueur limitée aux documents de découverte

### css/style.css

- [ ] Palette catégorisée
- [ ] Mise en page MacBook
- [ ] Mise en page tablette paysage
- [ ] Mise en page tablette portrait
- [ ] Tiroir de l'inspecteur joueur
- [ ] Cibles tactiles des pions et transitions

---

## 14. Phases de réalisation

## Phase 0 — Sécurisation de l'existant

Durée indicative : 0,5 à 1 jour.

- [ ] Exporter le plan actuel
- [ ] Créer une fixture de référence
- [ ] Ajouter **schemaVersion**
- [ ] Figer les tests de non-régression

**Critère de sortie :** le plan actuel peut être restauré intégralement.

## Phase 1 — Robustesse et corrections

Durée indicative : 2 à 3 jours.

- [ ] Validation et migration
- [ ] Notes privées et informations joueurs
- [ ] File de sauvegarde
- [ ] Révisions et conflits
- [ ] Sauvegarde à la fermeture
- [ ] Corrections des rondes
- [ ] Correction de l'arbre Visibilité
- [ ] Export et import JSON

**Critère de sortie :** deux machines ne peuvent plus s'écraser silencieusement.

## Phase 2 — Catalogue et capacités génériques

Durée indicative : 1 à 2 jours.

- [ ] Nouveau catalogue
- [ ] Catégories
- [ ] Profils d'état
- [ ] Adaptateur pour les anciens types
- [ ] Inspecteur piloté par les capacités

**Critère de sortie :** un nouveau dispositif peut être ajouté sans disperser de
conditions particulières dans plusieurs fichiers.

## Phase 3 — Moteur de couverture

Durée indicative : 2 à 3 jours.

- [ ] Cônes génériques
- [ ] Faisceaux
- [ ] Rectangles
- [ ] Cercles
- [ ] Seuils
- [ ] Canaux de détection
- [ ] Révélation indépendante

**Critère de sortie :** chaque forme est éditable, révélable et correctement rendue.

## Phase 4 — Décors et occlusion

Durée indicative : 2 à 3 jours.

- [ ] Modèle des décors
- [ ] Palette
- [ ] Placement
- [ ] Déplacement
- [ ] Rotation
- [ ] Redimensionnement
- [ ] Rendu
- [ ] Occlusion
- [ ] Cache des segments
- [ ] Visibilité joueur

**Critère de sortie :** placer une armoire ou un comptoir modifie immédiatement le
champ de vision d'une caméra.

## Phase 5 — Catalogue de sécurité complet

Durée indicative : 2 à 4 jours.

Ordre conseillé :

1. accès et barrières ;
2. capteurs statiques ;
3. défenses armées ;
4. personnel et entités magiques ;
5. migration des anciens drones et capteurs.

**Critère de sortie :** les seize éléments demandés sont disponibles, configurables,
sauvegardables et révélables.

## Phase 6 — Pions PJ, transitions et exploration

Durée indicative : 3 à 4 jours.

- [ ] Sous-collection Firestore des pions
- [ ] Création et configuration MJ
- [ ] Drag tactile joueur
- [ ] Synchronisation temps réel
- [ ] Modèle des transitions
- [ ] Outil de liaison multi-étages
- [ ] Escaliers à deux endpoints
- [ ] Ascenseurs multi-étages
- [ ] Confirmation tactile de changement d'étage
- [ ] Détection des salles traversées
- [ ] Révélation persistante des salles découvertes
- [ ] Ligne de vue depuis les pions
- [ ] Découverte automatique des éléments visibles
- [ ] Réinitialisation MJ des découvertes
- [ ] Règles Firestore limitées aux coordonnées

**Critère de sortie :** un joueur déplace son pion sur la tablette, utilise un
escalier ou un ascenseur, apparaît au bon point sur l'étage d'arrivée et révèle
uniquement la salle et les éléments réellement visibles, sans réécrire le plan.

## Phase 7 — Productivité et interface

Durée indicative : 2 à 3 jours.

- [ ] Annuler et rétablir
- [ ] Duplication
- [ ] Waypoints éditables
- [ ] Palette repliable
- [ ] Tablette paysage
- [ ] Tablette portrait
- [ ] Inspecteur joueur en tiroir

**Critère de sortie :** l'édition reste fluide malgré l'augmentation du catalogue.

## Phase 8 — Tests et déploiement

Durée indicative : 2 jours.

- [ ] Tests unitaires
- [ ] Tests d'intégration
- [ ] Test réel MacBook et tablette
- [ ] Test de conflit entre deux machines
- [ ] Migration du plan Firestore
- [ ] Déploiement progressif

Ordre de grandeur total : **14 à 22 jours de développement concentré**, selon le
niveau de finition graphique des décors et des nouveaux dispositifs.

---

## 15. Plan de tests

## 15.1 Modèle et migration

- [ ] Migration du schéma actuel vers v2
- [ ] Champs absents
- [ ] Valeurs invalides
- [ ] Préservation des identifiants
- [ ] Rejet d'un plan irrécupérable
- [ ] Export puis import sans perte

## 15.2 Sauvegardes

- [ ] Deux modifications successives rapides
- [ ] Modification pendant une sauvegarde
- [ ] Fermeture avant la fin du debounce
- [ ] Conflit entre deux machines
- [ ] Coupure puis retour du réseau
- [ ] Restauration d'une version précédente

## 15.3 Rondes

- [ ] Entité hors ligne réellement immobile
- [ ] Changement de vitesse sans téléportation
- [ ] Passage boucle / aller-retour sans saut
- [ ] Déplacement de waypoint
- [ ] Suppression de waypoint

## 15.4 Couvertures et décors

- [ ] Cône optique bloqué par un décor
- [ ] Infrarouge bloqué par une cloison
- [ ] Laser arrêté au premier obstacle
- [ ] Plaque de pression indépendante de la vision
- [ ] Grille d'acier transparente optiquement
- [ ] Barrière de mana bloquant uniquement l'astral
- [ ] Décor non occultant sans effet

## 15.5 Pions et transitions

- [ ] Création, modification et suppression d'un pion par le MJ
- [ ] Déplacement tactile autorisé
- [ ] Déplacement refusé quand le pion est verrouillé
- [ ] Synchronisation sur deux écrans
- [ ] Écriture limitée aux coordonnées
- [ ] Escalier bidirectionnel
- [ ] Passage à sens unique
- [ ] Ascenseur à trois étages
- [ ] Destination inconnue autorisée
- [ ] Transition désactivée
- [ ] Arrivée au bon endpoint
- [ ] Changement automatique de l'étage affiché
- [ ] Révélation automatique d'une salle à l'entrée
- [ ] Révélation de l'étage après une transition vers une zone inconnue
- [ ] Découverte d'un dispositif en ligne de vue
- [ ] Élément occulté restant caché
- [ ] Élément avec **autoDiscover: false** restant caché
- [ ] Cône et ronde restant indépendants de la découverte
- [ ] Découverte synchronisée sur deux écrans

## 15.6 Catalogue

Pour chaque type :

- [ ] placement ;
- [ ] sélection ;
- [ ] changement d'état ;
- [ ] liaison réseau si applicable ;
- [ ] ronde si applicable ;
- [ ] couverture si applicable ;
- [ ] révélation MJ et joueur ;
- [ ] sauvegarde et rechargement.

## 15.7 Interfaces cibles

- [ ] MacBook 1280 × 800
- [ ] MacBook 1440 × 900
- [ ] Tablette 1024 × 768 paysage
- [ ] Tablette 768 × 1024 portrait
- [ ] Manipulation tactile
- [ ] Drag tactile des pions
- [ ] Changement d'étage par endpoint
- [ ] Absence de débordement horizontal
- [ ] Inspecteur joueur refermable

---

## 16. Procédure de migration en production

1. Exporter manuellement le document Firestore actuel.
2. Créer un snapshot **pre-v2** horodaté.
3. Déployer une version capable de lire les schémas v1 et v2.
4. Tester la lecture du plan actuel sans écriture.
5. Se connecter en MJ.
6. Lancer la migration v1 vers v2.
7. Vérifier les étages, pièces, entités, rondes, cônes et révélations.
8. Reclasser manuellement les anciens drones et capteurs génériques.
9. Convertir les anciens ascenseurs utiles en transitions liées.
10. Vérifier les pions et leurs permissions de déplacement.
11. Initialiser la collection de découvertes sans révéler de nouvel élément.
12. Vérifier l'exploration d'une salle de test.
13. Vérifier la tablette en mode joueur.
14. Autoriser ensuite les nouvelles modifications.

Une migration ne doit jamais supprimer immédiatement les champs v1 avant validation
du premier chargement v2.

---

## 17. Définition de terminé

Une phase est terminée lorsque :

- ses cases fonctionnelles sont cochées ;
- ses critères de sortie sont satisfaits ;
- les tests existants passent ;
- les nouveaux comportements ont des tests ;
- aucune erreur de console n'apparaît ;
- la sauvegarde et le rechargement ont été vérifiés ;
- le mode MJ et le mode joueur ont été testés ;
- la documentation et ce fichier sont mis à jour.

## 18. Ordre recommandé

1. Robustesse et migration.
2. Notes MJ et informations joueurs.
3. Corrections des bugs actuels.
4. Catalogue générique.
5. Moteur de couverture.
6. Décors occultants.
7. Nouveaux dispositifs.
8. Pions PJ et transitions entre étages.
9. Annuler, rétablir et sauvegardes.
10. Adaptation tablette.
11. Tests croisés et déploiement.

Le point architectural central est de construire le moteur générique de capacités et
de couverture avant d'ajouter les seize dispositifs. Cela évitera de multiplier les
cas particuliers et gardera le projet simple à maintenir.

---

## 19. Journal d'avancement

| Date | Phase | Travail réalisé | Commit |
|---|---|---|---|
| 2026-07-15 | Planification | Feuille de route v2 créée et validée | À renseigner |

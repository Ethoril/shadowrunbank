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

- [x] Mur ou cloison
- [x] Pilier
- [x] Porte opaque
- [x] Ouverture ou passage
- [x] Vitre
- [x] Grille
- [x] Escalier
- [x] Ascenseur existant

### Mobilier occultant

- [x] Comptoir
- [x] Bureau
- [x] Armoire
- [x] Étagère
- [x] Coffre ou coffre-fort
- [x] Caisse
- [x] Serveur ou baie informatique
- [x] Grande plante ou séparation opaque

### Décor non occultant

- [x] Chaise
- [x] Banc
- [x] Tapis
- [x] Marquage au sol
- [x] Petit mobilier
- [x] Élément purement visuel

## 6.3 Outils d'édition

- [x] Palette de décors dédiée
- [x] Placement
- [x] Déplacement
- [x] Largeur et hauteur
- [x] Rotation par pas de 90 degrés
- [x] Duplication
- [x] Suppression
- [x] Révélation aux joueurs
- [x] Choix des canaux de vision bloqués
- [x] Choix du blocage de déplacement
- [x] Notes MJ et informations joueurs

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

- [x] Créer un pion
- [x] Nommer le personnage
- [x] Choisir couleur, initiales ou icône
- [x] Placer et déplacer le pion
- [x] Autoriser ou interdire le déplacement joueur
- [x] Verrouiller temporairement le pion
- [x] Téléporter manuellement le pion vers un étage
- [x] Masquer ou afficher le pion
- [x] Dupliquer et supprimer le pion

Fonctions joueur :

- [x] Sélectionner un pion autorisé au toucher
- [x] Le déplacer par glisser-déposer
- [x] Conserver un mouvement fluide localement
- [x] Enregistrer la position au relâchement
- [x] Recevoir en direct les déplacements effectués sur les autres écrans
- [x] Refuser le déplacement si le pion est verrouillé

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

- [x] Créer une liaison
- [x] Ajouter un endpoint à une liaison
- [x] Retirer un endpoint
- [x] Déplacer un endpoint
- [x] Renommer la liaison
- [x] Choisir escalier, ascenseur, échelle, trappe ou passage
- [x] Choisir sens unique ou bidirectionnel
- [x] Activer ou désactiver la liaison
- [x] Révéler ou cacher la liaison
- [x] Associer éventuellement un maglock ou un contrôle d'accès

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

- [x] Activer ou désactiver la découverte automatique d'un élément
- [x] Distinguer révélation manuelle et découverte en partie
- [x] Réinitialiser les découvertes d'un étage
- [x] Réinitialiser toutes les découvertes
- [x] Révéler ou cacher manuellement sans supprimer l'historique de découverte
- [x] Voir quel pion a découvert un élément

## 7.7 Critères de validation

- [x] Un pion se déplace correctement au doigt
- [x] Le MJ peut verrouiller son déplacement
- [ ] Deux écrans voient la nouvelle position après relâchement — à valider après déploiement des règles
- [x] Un escalier relie exactement deux endpoints
- [x] Un ascenseur dessert au moins trois étages
- [x] Une destination inconnue autorisée peut être rejointe
- [x] Une transition désactivée ne peut pas être utilisée
- [x] Le changement d'étage place le pion au bon endpoint
- [x] La tablette affiche automatiquement l'étage d'arrivée
- [x] L'étage et la salle d'arrivée sont révélés si nécessaire
- [ ] Entrer dans une salle cachée la révèle sur tous les écrans — à valider après déploiement des règles
- [x] Une caméra visible dans la salle est découverte
- [x] Un garde masqué par un décor opaque reste caché
- [x] Une caméra découverte ne révèle pas automatiquement son cône
- [x] Un garde découvert ne révèle pas automatiquement sa ronde
- [x] Aucun déplacement de pion n'écrase une modification du plan

---

## 8. Catalogue de sécurité cible

| Élément | Identifiant proposé | Comportement | État |
|---|---|---|---|
| Portique MAD | mad_gate | Seuil magnétique, réseau | Terminé |
| Maglock | maglock | Contrôle d'accès | Terminé |
| Scanner rétinien | retina_scanner | Contrôle biométrique ponctuel | Terminé |
| Analyse ADN | dna_analyzer | Contrôle biométrique ponctuel | Terminé |
| Caméra | camera | Cône optique, balayage | Terminé |
| Détecteur infrarouge | infrared_motion_sensor | Cône ou zone infrarouge | Terminé |
| Laser de détection | detection_laser | Faisceau arrêté par les obstacles | Terminé |
| Plaque de pression | pressure_plate | Zone rectangulaire au sol | Terminé |
| Micro-drone de sécurité | micro_security_drone | Mobile, ronde, petit cône | Terminé |
| Drone de combat | combat_drone | Mobile, ronde, cône, profil armé | Terminé |
| Tourelle automatique | automatic_turret | Cône optique, balayage, profil armé | Terminé |
| Garde armé | armed_guard | Mobile, ronde, perception | Terminé |
| Mage de sécurité | security_mage | Mobile, ronde, perception astrale | Terminé |
| Grille d'acier | steel_grate | Barrière de déplacement | Terminé |
| Barrière de mana | mana_barrier | Barrière astrale | Terminé |
| Esprit de patrouille | patrol_spirit | Mobile, ronde, détection astrale | Terminé |

Éléments utilitaires conservés :

- [x] Nœud réseau
- [x] Ascenseur
- [x] Capteur générique temporaire

## 8.1 Migration des types existants

- [x] **camera** reste **camera**
- [x] **maglock** reste **maglock**
- [x] **turret** devient **automatic_turret**
- [x] **barrier** devient **mana_barrier**
- [x] **guard** devient **armed_guard**
- [x] **drone** reste « Drone à préciser » jusqu'au choix du MJ
- [x] **sensor** reste générique jusqu'à reclassement manuel
- [x] Préserver identifiants, positions, révélations, rondes et liaisons réseau

---

## 9. Robustesse des sauvegardes

## 9.1 File séquentielle

- [x] Une seule écriture Firestore à la fois
- [x] Mise en attente d'une nouvelle sauvegarde si une écriture est en cours
- [x] Envoi automatique de la version la plus récente après confirmation
- [x] États d'interface distincts :
  - modification locale ;
  - sauvegarde en cours ;
  - synchronisé ;
  - conflit ;
  - hors ligne.

## 9.2 Révisions et conflits

- [x] Ajouter une révision serveur
- [x] Sauvegarder avec une transaction Firestore
- [x] Refuser une écriture basée sur une ancienne révision
- [x] Proposer en cas de conflit :
  - charger la version distante ;
  - forcer la version locale avec confirmation ;
  - exporter la version locale avant remplacement.

## 9.3 Fermeture de page

- [x] Écrire immédiatement le plan local lors de **pagehide**
- [x] Conserver un marqueur **dirty** si Firestore n'a pas confirmé
- [x] Reprendre la synchronisation au prochain démarrage

## 9.4 Sauvegardes et historique

- [x] Export JSON manuel
- [x] Import JSON avec validation et prévisualisation
- [x] Sauvegarde automatique avant migration
- [x] Snapshots nommés ou horodatés
- [x] Conservation des 10 à 20 dernières versions importantes

---

## 10. Corrections fonctionnelles immédiates

- [x] Arrêter et figer une ronde lorsque l'entité passe hors ligne ou est neutralisée
- [x] Préserver la position courante lors d'un changement de vitesse
- [x] Préserver la position courante lors du passage boucle / aller-retour
- [x] Changer automatiquement d'étage depuis l'arbre Visibilité
- [x] Séparer notes MJ et informations joueurs
- [x] Sauvegarder localement à la fermeture
- [x] Reconnecter Firestore ou afficher une action claire après une erreur
- [x] Empêcher les dispositifs de sortir visuellement de la grille
- [x] Normaliser portée, angle, vitesse et dimensions
- [x] Demander confirmation avant « Tout révéler »
- [x] Adapter le texte de l'inspecteur vide au mode joueur

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

- [x] Annuler
- [x] Rétablir
- [x] Limiter l'historique à environ 50 actions
- [x] Grouper la saisie continue d'un même champ
- [x] Ne pas enregistrer les frames d'animation

## 11.3 Outils complémentaires

- [x] Dupliquer un dispositif
- [x] Dupliquer un décor
- [x] Copier et coller
- [x] Supprimer le dernier waypoint
- [x] Déplacer un waypoint
- [x] Réordonner ou inverser une ronde
- [x] Réinitialiser une couverture
- [x] Centrer et focaliser la carte sur un élément sélectionné dans l'arbre

---

## 12. Interface cible

## 12.1 MacBook MJ

- [x] Palette regroupée en catégories :
  - Structure ;
  - Accès ;
  - Détection ;
  - Défense ;
  - Personnel ;
  - Magie ;
  - Décors.
- [x] Catégories repliables
- [x] Inspecteur dynamique selon les capacités
- [x] Boutons Annuler, Rétablir et Export dans le header
- [x] Arbre Visibilité enrichi avec décors
- [x] Arbre Visibilité enrichi avec couvertures

## 12.2 Tablette joueur

Cibles :

- **2304 × 1440 en paysage** (résolution native de la tablette retenue) ;
- **1440 × 2304 en portrait** ;
- viewport logique haute densité également pris en charge (par exemple 1152 × 720 à DPR 2).

Travaux :

- [x] Donner la priorité à la carte
- [x] Transformer l'inspecteur en panneau ou tiroir refermable
- [x] Agrandir les zones tactiles à environ 40–44 px
- [x] Simplifier le header en mode joueur
- [x] Vérifier l'absence de débordement horizontal
- [ ] Tester les changements d'étage au toucher
- [ ] Tester le déplacement tactile des pions
- [ ] Tester la confirmation des transitions
- [ ] Ne pas développer de mise en page spécifique au smartphone

---

## 13. Répartition technique

### store.js

- [x] Schéma v2
- [x] Validation
- [x] Migrations
- [x] Collection **decors**
- [x] Collection **transitions**
- [x] Accesseurs et état local des pions
- [x] Registre local des découvertes
- [x] Calcul de visibilité effective : manuel ou découvert
- [x] Transactions d'édition
- [x] Annuler et rétablir
- [x] File de sauvegarde
- [x] Révisions

### map.js

- [x] Rendu des décors
- [x] Rendu et drag tactile des pions
- [x] Rendu des endpoints de transition
- [x] Détection des salles traversées par un pion
- [x] Tests de ligne de vue entre pion et éléments découvrables
- [x] Moteur de couverture générique
- [x] Occlusion par canal
- [x] Cache des segments occultants
- [x] Faisceaux, rectangles, cercles et seuils

### editor.js

- [x] Palette catégorisée
- [x] Placement des décors
- [x] Rotation et redimensionnement
- [ ] Outils de zones et faisceaux
- [x] Outil de création des transitions
- [x] Création et configuration des pions
- [x] Édition des waypoints

### inspector.js

- [x] Champs générés selon les capacités
- [x] Notes MJ et informations joueurs
- [x] Profils d'état
- [x] Paramètres des couvertures
- [x] Paramètres d'occlusion
- [x] Inspecteur de pion
- [x] Inspecteur de transition
- [x] Réglage **autoDiscover**
- [x] Affichage de l'origine d'une révélation

### visibility.js

- [x] Navigation vers l'étage sélectionné
- [x] Branche Décors
- [x] Branches Couvertures
- [x] Branche Transitions
- [x] Indication révélation manuelle ou découverte
- [x] Commandes de réinitialisation des découvertes
- [x] Actions globales avec confirmation
- [x] Indication claire du contenu révélé

### cloud.js

- [x] Transactions Firestore
- [x] Révisions
- [x] Conflits
- [x] Snapshots
- [x] Reconnexion sécurisée avec conservation locale avant rechargement
- [x] Reprise des sauvegardes locales
- [x] Abonnement temps réel aux pions
- [x] Écriture légère des positions de pions
- [x] Abonnement temps réel aux découvertes
- [x] Écriture idempotente des découvertes

### firestore.rules

- [x] Document principal et configuration toujours réservés au MJ
- [x] Validation minimale de **schemaVersion**
- [x] Validation minimale de **revision**
- [x] Autorisation de la collection de snapshots
- [x] Écriture joueur limitée aux coordonnées des pions
- [x] Création joueur limitée aux documents de découverte

### css/style.css

- [x] Palette catégorisée
- [x] Mise en page MacBook
- [x] Mise en page tablette paysage
- [x] Mise en page tablette portrait
- [x] Tiroir de l'inspecteur joueur
- [x] Cibles tactiles des pions et transitions

---

## 14. Phases de réalisation

## Phase 0 — Sécurisation de l'existant

Durée indicative : 0,5 à 1 jour.

- [x] Exporter le plan actuel
- [x] Créer une fixture de référence
- [x] Ajouter **schemaVersion**
- [x] Figer les tests de non-régression

**Critère de sortie :** le plan actuel peut être restauré intégralement.

## Phase 1 — Robustesse et corrections

Durée indicative : 2 à 3 jours.

- [x] Validation et migration
- [x] Notes privées et informations joueurs
- [x] File de sauvegarde
- [x] Révisions et conflits
- [x] Sauvegarde à la fermeture
- [x] Corrections des rondes
- [x] Correction de l'arbre Visibilité
- [x] Export et import JSON

**Critère de sortie :** deux machines ne peuvent plus s'écraser silencieusement.

## Phase 2 — Catalogue et capacités génériques

Durée indicative : 1 à 2 jours.

- [x] Nouveau catalogue
- [x] Catégories
- [x] Profils d'état
- [x] Adaptateur pour les anciens types
- [x] Inspecteur piloté par les capacités

**Critère de sortie :** un nouveau dispositif peut être ajouté sans disperser de
conditions particulières dans plusieurs fichiers.

## Phase 3 — Moteur de couverture

Durée indicative : 2 à 3 jours.

- [x] Cônes génériques
- [x] Faisceaux
- [x] Rectangles
- [x] Cercles
- [x] Seuils
- [x] Canaux de détection
- [x] Révélation indépendante

**Critère de sortie :** chaque forme est éditable, révélable et correctement rendue.

## Phase 4 — Décors et occlusion

Durée indicative : 2 à 3 jours.

- [x] Modèle des décors
- [x] Palette
- [x] Placement
- [x] Déplacement
- [x] Rotation
- [x] Redimensionnement
- [x] Rendu
- [x] Occlusion
- [x] Cache des segments
- [x] Visibilité joueur

**Critère de sortie :** placer une armoire ou un comptoir modifie immédiatement le
champ de vision d'une caméra.

## Phase 5 — Catalogue de sécurité complet

Durée indicative : 2 à 4 jours.

Ordre conseillé :

- [x] Accès et barrières
- [x] Capteurs statiques
- [x] Défenses armées
- [x] Personnel et entités magiques
- [x] Migration des anciens drones et capteurs

**Critère de sortie :** les seize éléments demandés sont disponibles, configurables,
sauvegardables et révélables.

## Phase 6 — Pions PJ, transitions et exploration

Durée indicative : 3 à 4 jours.

- [x] Sous-collection Firestore des pions
- [x] Création et configuration MJ
- [x] Drag tactile joueur
- [x] Synchronisation temps réel
- [x] Modèle des transitions
- [x] Outil de liaison multi-étages
- [x] Escaliers à deux endpoints
- [x] Ascenseurs multi-étages
- [x] Confirmation tactile de changement d'étage
- [x] Détection des salles traversées
- [x] Révélation persistante des salles découvertes
- [x] Ligne de vue depuis les pions
- [x] Découverte automatique des éléments visibles
- [x] Réinitialisation MJ des découvertes
- [x] Règles Firestore limitées aux coordonnées

**Critère de sortie :** un joueur déplace son pion sur la tablette, utilise un
escalier ou un ascenseur, apparaît au bon point sur l'étage d'arrivée et révèle
uniquement la salle et les éléments réellement visibles, sans réécrire le plan.

## Phase 7 — Productivité et interface

Durée indicative : 2 à 3 jours.

- [x] Annuler et rétablir
- [x] Duplication
- [x] Copier/coller entre étages
- [x] Gestion et restauration des 15 dernières versions
- [x] Réinitialisation des couvertures
- [x] Focalisation depuis l'arbre Visibilité
- [x] Waypoints éditables
- [x] Palette repliable
- [x] Tablette paysage
- [x] Tablette portrait
- [x] Inspecteur joueur en tiroir

**Critère de sortie :** l'édition reste fluide malgré l'augmentation du catalogue.

## Phase 8 — Tests et déploiement

Durée indicative : 2 jours.

- [x] Tests unitaires
- [x] Tests d'intégration
- [x] Simulation automatisée d'un conflit entre deux clients
- [ ] Test réel MacBook et tablette
- [ ] Test de conflit entre deux machines
- [ ] Migration du plan Firestore
- [ ] Déploiement progressif

Ordre de grandeur total : **14 à 22 jours de développement concentré**, selon le
niveau de finition graphique des décors et des nouveaux dispositifs.

---

## 15. Plan de tests

## 15.1 Modèle et migration

- [x] Migration du schéma actuel vers v2
- [x] Champs absents
- [x] Valeurs invalides
- [x] Préservation des identifiants
- [x] Rejet d'un plan irrécupérable
- [x] Export puis import sans perte

## 15.2 Sauvegardes

- [x] Deux modifications successives rapides
- [x] Modification pendant une sauvegarde
- [x] Fermeture avant la fin du debounce
- [x] Conflit entre deux machines
- [x] Coupure puis retour du réseau
- [x] Restauration d'une version précédente

## 15.3 Rondes

- [x] Entité hors ligne réellement immobile
- [x] Changement de vitesse sans téléportation
- [x] Passage boucle / aller-retour sans saut
- [x] Déplacement de waypoint
- [x] Suppression de waypoint

## 15.4 Couvertures et décors

- [x] Cône optique bloqué par un décor
- [x] Infrarouge bloqué par une cloison
- [x] Laser arrêté au premier obstacle
- [x] Plaque de pression indépendante de la vision
- [x] Grille d'acier transparente optiquement
- [x] Barrière de mana bloquant uniquement l'astral
- [x] Décor non occultant sans effet

## 15.5 Pions et transitions

- [x] Création, modification et suppression d'un pion par le MJ
- [x] Déplacement tactile autorisé
- [x] Déplacement refusé quand le pion est verrouillé
- [ ] Synchronisation sur deux écrans
- [x] Écriture limitée aux coordonnées
- [x] Escalier bidirectionnel
- [x] Passage à sens unique
- [x] Ascenseur à trois étages
- [x] Destination inconnue autorisée
- [x] Transition désactivée
- [x] Arrivée au bon endpoint
- [x] Changement automatique de l'étage affiché
- [x] Révélation automatique d'une salle à l'entrée
- [x] Révélation de l'étage après une transition vers une zone inconnue
- [x] Découverte d'un dispositif en ligne de vue
- [x] Élément occulté restant caché
- [x] Élément avec **autoDiscover: false** restant caché
- [x] Cône et ronde restant indépendants de la découverte
- [ ] Découverte synchronisée sur deux écrans

## 15.6 Catalogue

Pour chaque type :

- [x] placement ;
- [x] sélection ;
- [x] changement d'état ;
- [x] liaison réseau si applicable ;
- [x] ronde si applicable ;
- [x] couverture si applicable ;
- [x] révélation MJ et joueur ;
- [x] sauvegarde et rechargement.

## 15.7 Interfaces cibles

- [ ] MacBook 1280 × 800
- [ ] MacBook 1440 × 900
- [x] Simulation responsive 2304 × 1440 paysage
- [x] Simulation responsive 1440 × 2304 portrait
- [ ] Validation sur la tablette physique
- [ ] Manipulation tactile
- [ ] Drag tactile des pions
- [ ] Changement d'étage par endpoint
- [x] Absence de débordement horizontal
- [x] Inspecteur joueur refermable

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
| 2026-07-15 | Phase 0 / Phase 1 | Export Firestore de référence, schéma v2, migration validée et séparation des notes | À renseigner |
| 2026-07-15 | Phase 1 | File séquentielle, révisions transactionnelles, reprise locale et résolution des conflits | À renseigner |
| 2026-07-15 | Phase 2 | Catalogue déclaratif, catégories, profils d'état et migration des anciens types | À renseigner |
| 2026-07-15 | Phase 3 | Moteur de couverture, cinq formes, canaux, inspecteur dynamique et révélation indépendante | À renseigner |
| 2026-07-15 | Phase 4 | Catalogue de décors, édition géométrique, rendu multicouche, occlusion par canal et cache | À renseigner |
| 2026-07-15 | Phase 5 | Seize dispositifs configurés, couvertures spécialisées et cycles de vie testés | À renseigner |
| 2026-07-15 | Phase 6 | Pions PJ, transitions multi-étages, exploration et découvertes persistantes | À renseigner |
| 2026-07-15 | Phase 7 | Historique, duplication, waypoints éditables et interfaces tablette | À renseigner |
| 2026-07-15 | Phase 8 | Tests unitaires/intégration, snapshot et workflows CI/déploiement manuel préparés | À renseigner |

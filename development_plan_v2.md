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
- [x] Deux écrans voient la nouvelle position après relâchement — validé en production le 2026-07-16
- [x] Un escalier ou une échelle partage une position unique sur tous les étages cochés
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

## 7.8 Cabine d'ascenseur : placement hors salle et partage entre étages

> **Statut : implémenté le 2026-07-19** — modèle `cabin`/`hasDoor`/bornes dans
> `store.js`, rendu généré et occlusion dans `map.js`, inspecteur dédié,
> extension automatique à la création d'étage. Tests unitaires ajoutés.

Constat : la cabine d'ascenseur (**elevator_decor**) et l'escalier visuel
(**stairs**) sont aujourd'hui de simples décors placés à la main, étage par étage,
sans lien avec la transition logique (**transition** de type **elevator**/**stairs**).
Rien n'empêche techniquement de sortir une cabine des cellules d'une salle, mais
comme la cabine et la porte sont gérées comme deux décors indépendants sans
géométrie partagée, le seul flux pratique aujourd'hui est de poser la cabine à
cheval sur la salle.

Cible : fusionner la représentation visuelle de la cabine avec la transition
elle-même, pour que la géométrie ne soit définie qu'une fois et se répercute
automatiquement partout où l'ascenseur dessert un étage.

~~~js
{
  id: "tr_xxx",
  type: "elevator",
  name: "Ascenseur de service",
  bidirectional: true,
  state: "active",
  revealed: true,

  // Géométrie de la gaine, définie une seule fois pour toute la liaison,
  // identique (x, y compris) sur tous les étages desservis
  cabin: { width: 2, height: 2, rotation: 0, doorSide: "south" },

  // Bornes de desserte : null = suit automatiquement l'étage le plus haut / le
  // plus bas existant ; une valeur explicite fige la borne (choisie dans un
  // sélecteur d'étages de l'inspecteur de l'ascenseur)
  minFloorOrder: null,
  maxFloorOrder: null,

  endpoints: [
    { id: "ep_a", floorId: "f_ground", x: 12, y: 8, label: "Rez-de-chaussée", hasDoor: true },
    { id: "ep_b", floorId: "f_servers", x: 12, y: 8, label: "Sous-sol serveurs", hasDoor: true },
    { id: "ep_c", floorId: "f_vault", x: 12, y: 8, label: "Voûte", hasDoor: false }
  ]
}
~~~

Règles :

- la cabine n'est plus un décor autonome dans **plan.decors** : elle est calculée
  et dessinée sur chaque étage à partir de **cabin** et des coordonnées de
  l'endpoint de cet étage ;
- la cabine peut être placée entièrement en dehors des cellules d'une salle,
  dans une zone non peinte (gaine) ; seule la porte touche le mur de la salle
  desservie ;
- **x/y sont strictement identiques sur tous les endpoints d'un même ascenseur**,
  sans exception ni correction ponctuelle par étage — une gaine réelle ne se
  déplace pas latéralement ;
- **doorSide** (nord/sud/est/ouest, relatif à la rotation de la cabine) détermine
  le côté où la porte est dessinée pour toute la liaison ;
- **hasDoor** (par endpoint) contrôle à la fois l'affichage de la porte et la
  possibilité de s'arrêter à cet étage : sans porte, l'étage n'apparaît jamais
  comme destination, mais la gaine occulte et bloque quand même le mouvement à
  cet étage, comme n'importe quel décor opaque ;
- côté joueur, la cabine et sa porte ne sont rendues que si **hasDoor** est vrai
  sur l'étage courant (et sous réserve des règles habituelles de révélation) ;
  côté MJ, la gaine reste visible sur tous les étages compris entre
  **minFloorOrder** et **maxFloorOrder** (en fantôme si sans porte), pour
  faciliter l'alignement ;
- l'inspecteur de l'ascenseur propose un sélecteur d'étage minimum et d'étage
  maximum, initialisé par défaut sur le plus bas et le plus haut étage du plan ;
  resserrer une borne supprime les endpoints désormais hors plage, après
  confirmation (« L'arrêt {étage} sera supprimé de cet ascenseur ») ;
- à la création d'un étage (**Store.addFloor**), chaque transition **elevator**
  existante dont la borne correspondante est encore automatique (**null**) reçoit
  un nouvel endpoint sur ce nouvel étage, aux mêmes coordonnées que ses voisins,
  avec **hasDoor: true** par défaut *(amendé le 2026-07-19 : porte ouverte
  partout par défaut, le MJ retire celles qu'il ne veut pas — même logique à la
  création d'un ascenseur, voir 7.11)* ; un ascenseur dont une borne a été figée
  explicitement n'est pas étendu au-delà.

## 7.9 Escaliers : sens de circulation

> **Statut : implémenté le 2026-07-19** — `direction` remplace `bidirectional`
> pour les escaliers (migration de l'ancien `bidirectional: false` incluse),
> logique de déplacement, badge de sens sur l'icône et menu joueur adaptés.
> Convention verticale retenue : `floor.order` croissant = étage plus bas
> (Niv 0 avant Niv -1), conforme au plan de production.

Cible : pouvoir déclarer qu'un escalier ne monte que dans un sens, descend
uniquement, ou fonctionne dans les deux sens, et que ce sens s'applique de façon
cohérente à tous les étages raccordés.

~~~js
{
  id: "tr_xxx",
  type: "stairs",
  name: "Escalier de service",
  direction: "up" | "down" | "both",
  endpoints: [
    { id: "ep_a", floorId: "f_ground", x: 4, y: 6 },
    { id: "ep_b", floorId: "f_1", x: 4, y: 6 },
    { id: "ep_c", floorId: "f_2", x: 4, y: 6 }
  ]
}
~~~

Règles :

- **direction** remplace **bidirectional** pour le type **stairs** (« both »
  équivaut à l'ancien **bidirectional: true**) ; les autres types de transition
  conservent **bidirectional** tel quel ;
- le sens se lit par rapport à l'ordre des étages (**floor.order**) : « up »
  n'autorise le passage que de l'endpoint sur l'étage le plus bas vers celui du
  plus haut ; « down » uniquement l'inverse ;
- les escaliers et échelles proposent une liste d'étages à cocher et partagent
  strictement les mêmes coordonnées sur chaque étage raccordé ;
- avec plusieurs étages, « up » ne propose que les destinations supérieures,
  « down » uniquement les destinations inférieures et « both » les deux ;
- l'affichage de l'icône et le menu de confirmation joueur reflètent le sens
  autorisé depuis l'endpoint où se trouve le pion (flèche montante, descendante,
  ou les deux) ; l'étage sans issue via cet escalier ne propose pas cette
  transition comme destination ;
- changer **direction** depuis n'importe quel endpoint met à jour la transition
  entière, donc les deux étages concernés, sans qu'il soit possible que les deux
  extrémités se contredisent.

## 7.10 Décisions prises (2026-07-19)

> **Statut : implémenté le 2026-07-19** — coordonnées strictement partagées,
> sélecteur min/max avec confirmation de suppression des arrêts hors plage,
> outil MJ « Purger les décors escalier / cabine » (avec sauvegarde locale
> préalable et récapitulatif groupé), `doorSide` explicite, validation qui
> **Amendé le 2026-07-19 :** escaliers et échelles utilisent désormais une
> position partagée et une desserte multi-étages par cases à cocher. Les décors `elevator_decor`
> et `stairs` sont retirés de la palette (marqués `legacy`) mais restent
> rendus sur les plans existants tant que la purge n'a pas été lancée.

- **Alignement inter-étages.** Pas de décalage possible entre étages : les
  coordonnées de la cabine sont strictement identiques sur tous les endpoints
  d'un même ascenseur.
- **Gaine qui ne dessert pas toute la hauteur du bâtiment.** Résolu par le
  sélecteur d'étage minimum/maximum de l'inspecteur de l'ascenseur
  (**minFloorOrder**/**maxFloorOrder**), par défaut sur tout le bâtiment ;
  resserrer une borne supprime les endpoints désormais hors plage.
- **Décors existants (elevator_decor, stairs) posés à la main.** Ils doivent
  disparaître au profit du rendu généré par la transition, mais jamais
  silencieusement : une boîte de confirmation liste chaque décor concerné
  avant suppression, du type « Le décor {nom} de l'étage {étage} sera
  supprimé », étage par étage, avant toute suppression effective. Cette
  étape est un outil déclenché par le MJ (pas une migration automatique
  silencieuse au chargement), dans le même esprit prudent que le reste des
  migrations de ce projet (section 16).
- **doorSide explicite plutôt que déduit de la rotation.** Confirmé tel que
  proposé en 7.8.
- **Escaliers et échelles multi-étages.** La limite historique de deux endpoints
  est supprimée : l'inspecteur affiche les étages raccordés sous forme de cases
  à cocher et chaque item reste à la même position sur tous ces étages.

## 7.11 Reste à cadrer avant développement

- ~~Adapter ou compléter le parcours « Créer une liaison » (7.4).~~ **Traité le
  2026-07-19 :** la palette Structure propose la nature dès la création
  (Escalier, Ascenseur, Échelle, Trappe, Passage). Créer un ascenseur pose la
  gaine en un clic avec un arrêt **et une porte sur chaque étage desservi**
  (cabine et bornes par défaut) ; le MJ retire ensuite les portes non désirées
  dans l'inspecteur — par exemple un ascenseur qui ne s'arrête qu'aux étages
  pairs. La desserte affiche une case par étage : décocher conserve la gaine
  mais retire durablement l'arrêt et son icône ; recocher restaure l'arrêt avec
  porte. Escaliers et échelles utilisent
  une desserte par étages cochés ; trappes et passages conservent le flux point
  par point.
- ~~Définir l'ordre exact des opérations de la boîte de confirmation de
  suppression des anciens décors.~~ **Tranché le 2026-07-19 :** un seul
  récapitulatif groupé pour tout le plan, trié étage par étage, affiché par
  l'outil MJ « Purger les décors escalier / cabine » ; une sauvegarde locale
  est créée avant la suppression effective.

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
- [x] Tester les changements d'étage au toucher dans Chromium avec émulation tactile
- [x] Tester le déplacement tactile des pions, verrouillé puis autorisé
- [x] Tester la confirmation des transitions au toucher
- [x] Ne pas développer de mise en page spécifique au smartphone

## 12.3 Finition responsive ordinateur + tablette

Objectif : conserver une interface confortable dans les deux modes, sans supposer une
résolution native précise. Les seuils CSS doivent être pilotés par la largeur logique du
viewport et vérifiés avec plusieurs densités de pixels.

Comportements attendus :

- grand écran MJ : palette, carte et inspecteur restent visibles en trois colonnes ;
- ordinateur compact : la carte garde la priorité et les panneaux latéraux peuvent se réduire
  ou devenir repliables sans masquer les commandes essentielles ;
- tablette paysage : outils et inspecteur utilisent des tiroirs ou panneaux temporaires ;
- tablette portrait : la carte occupe la largeur, les commandes secondaires passent sous forme
  de tiroirs inférieurs ou de menus compacts ;
- mode joueur : navigation d'étage, carte, pion et informations découvertes restent accessibles
  au doigt avec des cibles d'au moins 44 px ;
- les panneaux Versions, Conflit et authentification ne provoquent aucun débordement horizontal ;
- les hauteurs utilisent le viewport réellement disponible, y compris avec les barres du navigateur.

Travaux :

- [x] Définir les breakpoints communs ordinateur large, ordinateur compact, tablette paysage et portrait
- [x] Rendre le header compact, repliable et sans chevauchement dans les deux modes
- [x] Transformer les panneaux MJ en colonnes réductibles puis en tiroirs selon l'espace disponible
- [x] Préserver une zone de carte suffisamment grande et stable lors de l'ouverture d'un tiroir
- [x] Adapter Versions, Conflit, formulaires et actions longues aux petites largeurs
- [x] Uniformiser les cibles tactiles, espacements, tailles de texte et zones de défilement
- [x] Prendre en charge `dvh` et les zones sûres de la tablette lorsque le navigateur les expose
- [x] Vérifier clavier/souris et interactions de tiroir par tests automatisés
- [x] Tester les gestes tactiles automatisés sur pion et transition
- [ ] Confirmer les gestes tactiles sur la tablette physique
- [x] Conserver explicitement les smartphones hors périmètre de finition

**Critère de sortie :** aucune commande essentielle ne se chevauche ou ne sort de l'écran,
la carte reste exploitable, et les scénarios MJ/joueur passent sur tous les viewports cibles.

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
- [x] Outils de zones et faisceaux avec poignées directes sur la carte
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
- [x] Breakpoints responsive communs aux modes MJ et joueur
- [x] Panneaux MJ réductibles et tiroirs tablette
- [x] Header adaptatif et panneaux système sans débordement
- [x] Gestion de la hauteur dynamique du viewport et des zones sûres

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
- [x] Escaliers et échelles multi-étages à position partagée
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
- [x] Poignées de portée, orientation, largeur, rayon et ouverture des couvertures
- [x] Focalisation depuis l'arbre Visibilité
- [x] Waypoints éditables
- [x] Palette repliable
- [x] Tablette paysage
- [x] Tablette portrait
- [x] Inspecteur joueur en tiroir

**Critère de sortie :** l'édition reste fluide malgré l'augmentation du catalogue.

## Phase 7.5 — Finition responsive ordinateur + tablette

Durée indicative : 1 à 2 jours.

- [x] Inventaire des largeurs minimales de chaque panneau et commande
- [x] Breakpoints fondés sur le viewport logique
- [x] Header compact et commandes secondaires regroupées
- [x] Panneaux MJ réductibles sur ordinateur compact
- [x] Tiroirs outils/inspecteur sur tablette paysage et portrait
- [x] Adaptation des panneaux Versions et Conflit
- [x] Tests automatisés souris et clavier aux dimensions cibles
- [x] Tests automatisés de gestes tactiles avec verrouillage, drag et changement d'étage
- [ ] Validation tactile sur la tablette physique
- [x] Contrôle visuel des deux modes sans débordement ni chevauchement

**Critère de sortie :** l'application est soignée sur ordinateur et tablette dans les deux
orientations, sans réécriture de l'interface et sans ajouter le smartphone au périmètre.

## Phase 8 — Tests et déploiement

Durée indicative : 2 jours.

- [x] Tests unitaires
- [x] Tests d'intégration
- [x] Simulation automatisée d'un conflit entre deux clients
- [ ] Test réel MacBook et tablette
- [ ] Test de conflit entre deux machines
- [x] Migration du plan Firestore
- [x] Déploiement de la v2 et des règles Firestore

Ordre de grandeur total : **15 à 24 jours de développement concentré**, selon le
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
- [x] Synchronisation sur deux écrans
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
- [x] Découverte synchronisée sur deux écrans

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

- [x] MacBook 1280 × 800
- [x] MacBook 1440 × 900
- [x] Ordinateur compact 1024 × 768 en modes MJ et joueur
- [x] Tablette logique 1024 × 768 en paysage
- [x] Tablette logique 768 × 1024 en portrait
- [x] Simulation responsive 2304 × 1440 paysage
- [x] Simulation responsive 1440 × 2304 portrait
- [x] Header sans chevauchement à chaque largeur cible
- [x] Outils et inspecteur utilisables en tiroirs
- [x] Panneaux Versions et Conflit sans débordement
- [x] Hauteur correcte avec viewport dynamique
- [ ] Validation sur la tablette physique
- [x] Manipulation tactile automatisée dans Chromium
- [x] Drag tactile des pions verrouillé puis autorisé
- [x] Changement d'étage par endpoint avec confirmation
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
| 2026-07-16 | Phases 7 / 8 | Poignées de couverture sur la carte et synchronisation pions/découvertes testée entre deux écrans | À renseigner |
| 2026-07-16 | Phase 8 | Site v14 publié, règles Firestore déployées et document de production confirmé en schéma v2 révision 9 | `3dce9bf` |
| 2026-07-16 | Phase 8 | Snapshot cloud et déplacement multi-écrans validés en production ; correction de la recréation des dernières données après suppression ou rechargement local périmé | À renseigner |
| 2026-07-19 | Phase 6 (évolution) | Besoin identifié : cabine d'ascenseur plaçable hors salle et partagée entre étages (7.8), sens de circulation des escaliers (7.9). Logique et points ouverts documentés, développement non commencé | 1bf3f7b |
| 2026-07-19 | Phase 6 (évolution) | Décisions tranchées : pas de décalage inter-étages, sélecteur d'étage min/max sur l'ascenseur, suppression confirmée des anciens décors avec boîte d'avertissement, doorSide explicite et escaliers limités à deux endpoints (7.10). Développement non commencé | 1bf3f7b |
| 2026-07-19 | Phase 6 (évolution) | 7.8–7.10 implémentés : cabine générée depuis la transition (géométrie unique, coordonnées partagées, occlusion opaque, fantôme MJ hors porte), bornes min/max avec confirmation, extension auto sur nouvel étage, sens up/down/both des escaliers avec migration de l'ancien bidirectional, limite de deux endpoints, outil MJ de purge des décors obsolètes. 9 tests unitaires ajoutés (24/24 verts) | 1bf3f7b |
| 2026-07-19 | Outillage MJ | Bouton « Tout supprimer (plan vierge) » : récapitulatif de ce qui sera perdu, sauvegarde locale préalable, remise à zéro du plan (nom, grille et révision cloud conservés), pions et découvertes supprimés, plan restaurable via l'historique. Test unitaire ajouté (25/25 verts) | 1bf3f7b |
| 2026-07-19 | Phase 6 (évolution) | Correctif 7.8 : les bornes min/max figées d'un ascenseur suivent désormais leurs étages lors d'une suppression ou d'un réordonnancement (rabat sur la plage restante si l'étage désigné disparaît), et un arrêt ne peut plus être ajouté hors desserte figée. 2 tests unitaires ajoutés (27/27 verts) | 1bf3f7b |
| 2026-07-19 | Phase 6 (évolution) | 7.11 traité : choix de la nature dès la création dans la palette ; un nouvel ascenseur pose gaine + arrêt + porte sur chaque étage desservi en un clic (amendement 7.8 : porte ouverte par défaut aussi sur les nouveaux étages), portes retirables individuellement dans l'inspecteur, bouton « Créer les arrêts manquants ». 1 test unitaire ajouté (28/28 verts) | 1bf3f7b |
| 2026-07-19 | Confort d'édition | Zoom/dézoom de la carte (100 % à 600 %) : molette centrée sur le curseur, boutons − / + / ⛶ avec niveau affiché, pan au clic-milieu et ascenseurs du wrapper, recadrage automatique lors d'un focus d'élément. Facteur appliqué à `cellPx` dans `layoutBoard`, re-rendu net à tous les niveaux. Tests 28/28 et 13/13 verts, vérification Playwright manuelle | 1f13255 |
| 2026-07-19 | Confort d'édition | Seuil de tolérance de 5 px avant qu'un clic sur un élément (entité, décor, pion, transition, waypoint, poignée de couverture) ne déclenche un déplacement : la sélection pour réglage dans l'inspecteur ne décale plus l'élément au moindre tremblement de souris, et l'historique d'annulation ne reçoit plus de transaction vide. Tests 33/33 et 18/18 verts | e94b7f0 |
| 2026-07-19 | Confort d'édition | La liaison « Nœud Réseau » d'un dispositif propose désormais tous les nœuds de l'immeuble (groupés par étage dans la liste déroulante), plus seulement ceux de l'étage courant, pour permettre un réseau partagé entre étages. Tests 33/33 et 18/18 verts | 8e8152f |
| 2026-07-19 | Confort d'édition | Remplacement du seuil de 5 px par un délai de maintien de 150 ms (`DRAG_HOLD_MS`) avant qu'un pointerdown ne déclenche un déplacement : un tap/clic rapide, même avec une dérive tactile de plusieurs pixels, ne décale plus jamais l'élément. Tests smoke et d'intégration ajustés pour simuler un maintien réaliste avant le glissement. Tests 33/33 et 18/18 verts | 6f498b6 |
| 2026-07-19 | Découverte automatique | Correctif : un décor (porte, vitre…) posé à cheval sur un mur n'était révélé que si son centre géométrique tombait dans la pièce du PJ, ignorant le reste de son empreinte. `decorTouchesRoom` teste désormais toutes les cases couvertes par le rectangle (rotation à 90° près), même logique que les cabines d'ascenseur. Test unitaire de régression ajouté (34/34 et 18/18 verts) | eabd1e0 |
| 2026-07-19 | Révélation MJ | Correctif : dévoiler une transition (trappe, escalier, échelle, passage, ascenseur) exposait d'un coup tous ses points de passage sur tous les étages. Le drapeau `revealed` passe de la transition à chaque `endpoint` (au plus un par étage) : l'œil de l'arbre de visibilité et les toggles de l'inspecteur dévoilent désormais le seul point choisi. La découverte automatique par un pion reste au niveau transition (révèle les deux extrémités, inchangé), et le rendu carte + cabines filtrent point par point. Migration one-shot de l'ancien `transition.revealed` global vers tous les points. Tests 34/34 et 18/18 verts | 0e9f2b2 |
| 2026-07-19 | Découverte automatique | Correctif (suite d'eabd1e0) : l'empreinte réelle d'une porte, plus fine qu'une case (0,35), tient tout entière d'un côté du mur dès qu'elle est calée contre la cloison (centre décalé d'une demi-case) — une seule des deux salles la révélait alors. `decorTouchesRoom` élargit désormais tout axe plus fin qu'une case à une demi-portée de 0,55, franchissant le mur vers la case voisine de chaque côté sans jamais sauter deux cases plus loin ; l'axe long garde sa taille réelle. Bénéficie aussi aux vitres, grilles, ouvertures et murs. Test de régression réécrit sur le vrai cas (porte en rotation 90° calée dans une salle, révélée depuis les deux). Tests 34/34 et 18/18 verts | d972292 |
| 2026-07-19 | Outillage build | Correctif de mise en prod : les scripts d'index.html étaient chargés avec un `?v=NN` incrémenté à la main, jamais rebumpé depuis `1c798ac`, si bien que le navigateur servait l'ancien code en cache — la révélation par point de passage de `0e9f2b2` restait invisible côté MJ (un seul bouton « révéler tout », une ligne par trappe dans l'œil). Le build (`build-site.mjs`) tamponne désormais chaque asset local d'index.html avec un `?v=<hash sha256 tronqué>` calculé sur son contenu : toute modification de fichier change l'URL et invalide le cache automatiquement, plus aucun bump manuel à faire. Numéros de version manuels réalignés au passage. Tests 34/34 et 18/18 verts | e33723d |
| 2026-07-19 | Révélation MJ | Lisibilité : une trappe ou un passage peut avoir plusieurs points sur le même étage, jusque-là indistinguables (deux « Point « RDC » » dans l'inspecteur, mêmes info-bulles carte, et l'œil n'en montrait qu'un). Nouveau helper `Store.endpointLetter` : quand un étage porte plusieurs points d'une même transition, ils reçoivent une lettre a, b, c… (vide s'il n'y en a qu'un). Lettre affichée dans les toggles de révélation et la liste « Points de passage » de l'inspecteur, dans l'info-bulle carte au survol d'un point, et dans l'arbre de visibilité — qui liste désormais TOUS les points d'un étage (correctif du `.find` qui en masquait). Test unitaire de régression ajouté (35/35 et 18/18 verts) | 08e8e80 |

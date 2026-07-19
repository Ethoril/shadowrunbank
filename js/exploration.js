/* ============================================================
   exploration.js — Découverte par les pions et utilisation des
   transitions. Les découvertes sont idempotentes et séparées du
   document de plan principal.
   ============================================================ */

const Exploration = (() => {
    const roomsSeenDuringDrag = new Map();

    function inSameRoom(item, room) {
        return !!room && Store.roomAt(item.floorId, Math.floor(item.x), Math.floor(item.y)) === room;
    }

    /* Un décor STRUCTUREL (porte, vitre, grille, mur…) est posé à cheval sur
       un mur : son corps, plus fin qu'une case, tient tout entier d'un côté
       de la frontière alors qu'il devrait être révélé depuis les DEUX salles
       que le mur sépare. Tester la seule empreinte réelle ne suffit donc
       pas : une porte calée contre la cloison (centre décalé d'une demi-case)
       ne touche que sa propre salle. On élargit chaque axe plus fin qu'une
       case jusqu'à la case voisine au-delà du mur (0,55 > une demi-case, sans
       jamais sauter deux cases plus loin) — même esprit que
       `elevatorDoorTouchesRoom` pour les cabines. Le mobilier fin (étagère,
       armoire, plante), lui, vit DANS une pièce : plaqué contre un mur, il ne
       doit pas devenir visible depuis la pièce d'à côté — pas d'élargissement. */
    const CROSS_WALL_HALF_SPAN = 0.55;
    function decorTouchesRoom(decor, room) {
        if (!room) return false;
        const straddlesWall = DecorCatalog.get(decor.type).category === 'structural';
        const quarterTurn = Math.abs(Math.round(decor.rotation / 90)) % 2 === 1;
        const spanWidth = quarterTurn ? decor.height : decor.width;
        const spanHeight = quarterTurn ? decor.width : decor.height;
        const halfWidth = spanWidth < 1 && straddlesWall ? CROSS_WALL_HALF_SPAN : spanWidth / 2;
        const halfHeight = spanHeight < 1 && straddlesWall ? CROSS_WALL_HALF_SPAN : spanHeight / 2;
        const minCol = Math.floor(decor.x - halfWidth);
        const maxCol = Math.ceil(decor.x + halfWidth) - 1;
        const minRow = Math.floor(decor.y - halfHeight);
        const maxRow = Math.ceil(decor.y + halfHeight) - 1;
        for (let col = minCol; col <= maxCol; col++) {
            for (let row = minRow; row <= maxRow; row++) {
                if (Store.roomAt(decor.floorId, col, row) === room) return true;
            }
        }
        return false;
    }

    function isAutomaticallyDiscovered(entity) {
        return EntityCatalog.get(entity.type).autoDiscover === true;
    }

    function elevatorDoorTouchesRoom(cabin, room) {
        if (!cabin || !cabin.hasDoor || !cabin.endpoint || !room) return false;
        const side = cabin.doorSide;
        const horizontal = side === 'north' || side === 'south';
        const normal = side === 'north' ? { x: 0, y: -1 }
            : side === 'south' ? { x: 0, y: 1 }
                : side === 'east' ? { x: 1, y: 0 } : { x: -1, y: 0 };
        const tangent = horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
        const normalLength = (horizontal ? cabin.height : cabin.width) / 2 + 0.05;
        const doorHalfLength = (horizontal ? cabin.width : cabin.height) / 4;
        const angle = cabin.rotation * Math.PI / 180;
        const rotate = vector => ({
            x: vector.x * Math.cos(angle) - vector.y * Math.sin(angle),
            y: vector.x * Math.sin(angle) + vector.y * Math.cos(angle)
        });
        const worldNormal = rotate(normal);
        const worldTangent = rotate(tangent);
        return [-0.8, 0, 0.8].some(fraction => {
            const x = cabin.x + worldNormal.x * normalLength
                + worldTangent.x * doorHalfLength * fraction;
            const y = cabin.y + worldNormal.y * normalLength
                + worldTangent.y * doorHalfLength * fraction;
            return Store.roomAt(cabin.endpoint.floorId, Math.floor(x), Math.floor(y)) === room;
        });
    }

    function discoverFromToken(token) {
        const floor = Store.findFloor(token.floorId);
        if (!floor) return [];
        const discovered = [];
        if (Store.addDiscovery('floor', floor, token.id)) discovered.push({ kind: 'floor', id: floor.id });
        const room = Store.roomAt(token.floorId, Math.floor(token.x), Math.floor(token.y));
        if (!room) return discovered;
        if (Store.addDiscovery('room', room, token.id)) discovered.push({ kind: 'room', id: room.id });

        Store.floorEntities(token.floorId).forEach(entity => {
            if (!isAutomaticallyDiscovered(entity) || !inSameRoom(entity, room)) return;
            if (Store.addDiscovery('entity', entity, token.id)) {
                discovered.push({ kind: 'entity', id: entity.id });
            }
            if (entity.coverage && entity.coverage.shape === 'cone'
                && Store.addDiscovery('coverage', entity, token.id)) {
                discovered.push({ kind: 'coverage', id: entity.id });
            }
        });
        Store.floorDecors(token.floorId).forEach(decor => {
            if (!decorTouchesRoom(decor, room)) return;
            if (Store.addDiscovery('decor', decor, token.id)) {
                discovered.push({ kind: 'decor', id: decor.id });
            }
        });
        Store.elevatorCabinsOnFloor(token.floorId).forEach(cabin => {
            // Voir la cabine ne révèle que l'arrêt de CET étage, pas toute
            // la gaine : les autres sorties restent à découvrir.
            if (!cabin.endpoint || !elevatorDoorTouchesRoom(cabin, room)) return;
            if (Store.addDiscovery('endpoint', cabin.endpoint, token.id, token.floorId)) {
                discovered.push({ kind: 'endpoint', id: cabin.endpoint.id });
            }
        });
        return discovered;
    }

    function observeTokenMove(token) {
        const room = Store.roomAt(token.floorId, Math.floor(token.x), Math.floor(token.y));
        if (!room) return [];
        if (!roomsSeenDuringDrag.has(token.id)) roomsSeenDuringDrag.set(token.id, new Set());
        const seen = roomsSeenDuringDrag.get(token.id);
        if (seen.has(room.id)) return [];
        seen.add(room.id);
        return discoverFromToken(token);
    }

    function transitionAtToken(token) {
        return Store.visibleTransitions(token.floorId).map(transition => ({
            transition,
            endpoint: transition.endpoints.find(endpoint => endpoint.floorId === token.floorId
                && Math.hypot(endpoint.x - token.x, endpoint.y - token.y) <= 0.8)
        })).find(item => item.endpoint && item.transition.state === 'active'
            // Un arrêt d'ascenseur sans porte n'est pas praticable (7.8).
            && !(item.transition.type === 'elevator' && item.endpoint.hasDoor === false)) || null;
    }

    function destinationsFor(transition, sourceEndpoint) {
        if (transition.type === 'stairs') {
            const sourceFloor = Store.findFloor(sourceEndpoint.floorId);
            if (!sourceFloor) return [];
            return transition.endpoints.filter(endpoint => {
                if (endpoint.id === sourceEndpoint.id) return false;
                const targetFloor = Store.findFloor(endpoint.floorId);
                if (!targetFloor) return false;
                if (transition.direction === 'up') return targetFloor.order < sourceFloor.order;
                if (transition.direction === 'down') return targetFloor.order > sourceFloor.order;
                return true;
            });
        }
        const sourceIndex = transition.endpoints.findIndex(endpoint => endpoint.id === sourceEndpoint.id);
        if (!transition.bidirectional && sourceIndex !== 0) return [];
        return transition.endpoints.filter(endpoint => endpoint.id !== sourceEndpoint.id
            // Sans porte, l'étage n'apparaît jamais comme destination (7.8).
            && !(transition.type === 'elevator' && endpoint.hasDoor === false));
    }

    function applyTransitionMove(token, transition, sourceEndpoint, destination, offset) {
        if (!token || !transition || transition.state !== 'active' || !destination) return false;
        if (transition.type === 'elevator' && sourceEndpoint
            && sourceEndpoint.hasDoor === false) return false;
        const allowed = destinationsFor(transition, sourceEndpoint);
        if (!allowed.some(endpoint => endpoint.id === destination.id)) return false;
        const access = transition.accessEntityId ? Store.findEntity(transition.accessEntityId) : null;
        if (access && Store.getEffectiveState(access) === 'active') return false;
        const grid = Store.getPlan().grid;
        token.floorId = destination.floorId;
        token.x = Math.min(Math.max(destination.x + (offset ? offset.x : 0), 0.5), grid.cols - 0.5);
        token.y = Math.min(Math.max(destination.y + (offset ? offset.y : 0), 0.5), grid.rows - 0.5);
        token.updatedAt = Date.now();
        Store.ui.currentFloorId = destination.floorId;
        // Emprunter la liaison révèle les deux points traversés (départ et
        // arrivée), pas les autres sorties de la même trappe/gaine.
        Store.addDiscovery('endpoint', sourceEndpoint, token.id, sourceEndpoint.floorId);
        Store.addDiscovery('endpoint', destination, token.id, destination.floorId);
        discoverFromToken(token);
        Store.commitTokenPosition(token);
        return true;
    }

    function moveThroughTransition(token, transition, sourceEndpoint, destination) {
        if (!applyTransitionMove(token, transition, sourceEndpoint, destination)) return false;
        if (typeof App !== 'undefined') App.renderAll();
        return true;
    }

    /* Plusieurs PJ empruntent la transition d'un coup (cabine d'ascenseur).
       Le premier arrive sur le point, les suivants en couronne autour pour
       rester lisibles. Renvoie le nombre de pions effectivement déplacés. */
    const GROUP_OFFSETS = [
        { x: 0, y: 0 }, { x: 0.7, y: 0 }, { x: -0.7, y: 0 }, { x: 0, y: 0.7 },
        { x: 0, y: -0.7 }, { x: 0.7, y: 0.7 }, { x: -0.7, y: -0.7 },
        { x: 0.7, y: -0.7 }, { x: -0.7, y: 0.7 }
    ];
    function moveGroupThroughTransition(tokens, transition, sourceEndpoint, destination) {
        const moved = tokens.filter((token, index) => applyTransitionMove(
            token, transition, sourceEndpoint, destination,
            GROUP_OFFSETS[index % GROUP_OFFSETS.length])).length;
        if (moved && typeof App !== 'undefined') App.renderAll();
        return moved;
    }

    // Dans un ascenseur, les boutons sont visibles : on connaît donc le nom des
    // étages reliés même s'ils n'ont pas encore été explorés. Pour les autres
    // transitions, un étage non révélé reste « Destination inconnue ».
    function destinationLabel(transition, floor) {
        if (transition.type === 'elevator' && floor) return floor.name;
        return Store.isEffectivelyRevealed(floor, 'floor') ? floor.name : 'Destination inconnue';
    }

    function offerTransition(token) {
        const found = transitionAtToken(token);
        if (!found) return false;
        const { transition, endpoint } = found;
        const destinations = destinationsFor(transition, endpoint);
        if (!destinations.length) return false;
        // Modale tactile : destinations en boutons et embarquement groupé.
        // Le déplacement se fait à la validation ; on rend la main tout de
        // suite (le pion reste posé sur le point en attendant).
        if (typeof TransitionDialog !== 'undefined') {
            TransitionDialog.open(token, transition, endpoint, destinations);
            return false;
        }
        // Repli confirm()/prompt() : environnements sans la modale (tests
        // unitaires hors DOM, échec de chargement du script).
        // 7.9 : le menu joueur reflète le sens autorisé depuis cet endpoint.
        const exit = transition.type === 'stairs'
            ? Store.stairsExitDirection(transition, endpoint) : null;
        const arrow = exit === 'up' ? ' (↑ monter)'
            : exit === 'down' ? ' (↓ descendre)' : exit === 'both' ? ' (⇅)' : '';
        let destination = destinations[0];
        if (destinations.length === 1) {
            const floor = Store.findFloor(destination.floorId);
            if (!confirm('Utiliser « ' + transition.name + ' »' + arrow + ' vers '
                + destinationLabel(transition, floor) + ' ?')) {
                return false;
            }
        } else {
            const choices = destinations.map((item, index) => {
                const floor = Store.findFloor(item.floorId);
                return (index + 1) + '. ' + destinationLabel(transition, floor);
            }).join('\n');
            const answer = prompt('Choisir une destination :\n' + choices, '1');
            const index = Number(answer) - 1;
            if (!Number.isInteger(index) || !destinations[index]) return false;
            destination = destinations[index];
        }
        return moveThroughTransition(token, transition, endpoint, destination);
    }

    function handleTokenRelease(token) {
        roomsSeenDuringDrag.delete(token.id);
        discoverFromToken(token);
        return offerTransition(token);
    }

    return {
        discoverFromToken, observeTokenMove, transitionAtToken, destinationsFor,
        moveThroughTransition, moveGroupThroughTransition, destinationLabel,
        offerTransition, handleTokenRelease, elevatorDoorTouchesRoom
    };
})();

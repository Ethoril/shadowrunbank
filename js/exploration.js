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

    function discoverFromToken(token) {
        const floor = Store.findFloor(token.floorId);
        if (!floor) return [];
        const discovered = [];
        if (Store.addDiscovery('floor', floor, token.id)) discovered.push({ kind: 'floor', id: floor.id });
        const room = Store.roomAt(token.floorId, Math.floor(token.x), Math.floor(token.y));
        if (!room) return discovered;
        if (Store.addDiscovery('room', room, token.id)) discovered.push({ kind: 'room', id: room.id });

        Store.floorEntities(token.floorId).forEach(entity => {
            if (entity.autoDiscover === false || !inSameRoom(entity, room)) return;
            if (!MapView.isLineBlocked(token.floorId, token, entity, 'optical', 0.4)
                && Store.addDiscovery('entity', entity, token.id)) {
                discovered.push({ kind: 'entity', id: entity.id });
            }
        });
        Store.floorDecors(token.floorId).forEach(decor => {
            if (decor.autoDiscover === false || !inSameRoom(decor, room)) return;
            if (!MapView.isLineBlocked(token.floorId, token, decor, 'optical',
                Math.max(0.35, Math.min(decor.width, decor.height) / 2))
                && Store.addDiscovery('decor', decor, token.id)) {
                discovered.push({ kind: 'decor', id: decor.id });
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
        })).find(item => item.endpoint && item.transition.state === 'active') || null;
    }

    function destinationsFor(transition, sourceEndpoint) {
        const sourceIndex = transition.endpoints.findIndex(endpoint => endpoint.id === sourceEndpoint.id);
        if (!transition.bidirectional && sourceIndex !== 0) return [];
        return transition.endpoints.filter(endpoint => endpoint.id !== sourceEndpoint.id);
    }

    function moveThroughTransition(token, transition, sourceEndpoint, destination) {
        if (!token || !transition || transition.state !== 'active' || !destination) return false;
        const allowed = destinationsFor(transition, sourceEndpoint);
        if (!allowed.some(endpoint => endpoint.id === destination.id)) return false;
        const access = transition.accessEntityId ? Store.findEntity(transition.accessEntityId) : null;
        if (access && Store.getEffectiveState(access) === 'active') return false;
        token.floorId = destination.floorId;
        token.x = destination.x;
        token.y = destination.y;
        token.updatedAt = Date.now();
        Store.ui.currentFloorId = destination.floorId;
        Store.addDiscovery('transition', transition, token.id, sourceEndpoint.floorId);
        discoverFromToken(token);
        Store.commitTokenPosition(token);
        if (typeof App !== 'undefined') App.renderAll();
        return true;
    }

    function offerTransition(token) {
        const found = transitionAtToken(token);
        if (!found) return false;
        const { transition, endpoint } = found;
        const destinations = destinationsFor(transition, endpoint);
        if (!destinations.length) return false;
        let destination = destinations[0];
        if (destinations.length === 1) {
            const floor = Store.findFloor(destination.floorId);
            if (!confirm('Utiliser « ' + transition.name + ' » vers '
                + (Store.isEffectivelyRevealed(floor, 'floor') ? floor.name : 'Destination inconnue') + ' ?')) {
                return false;
            }
        } else {
            const choices = destinations.map((item, index) => {
                const floor = Store.findFloor(item.floorId);
                const label = Store.isEffectivelyRevealed(floor, 'floor') ? floor.name : 'Destination inconnue';
                return (index + 1) + '. ' + label;
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
        moveThroughTransition, offerTransition, handleTokenRelease
    };
})();

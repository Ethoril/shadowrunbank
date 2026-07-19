/* ============================================================
   transition-dialog.js — Modale tactile d'utilisation d'une
   transition. Remplace confirm()/prompt() : sur tablette, le « 1 »
   prérempli du prompt n'est pas présélectionné et la saisie donnait
   « 12 » → destination invalide, échec silencieux. Les destinations
   deviennent des boutons et les PJ voisins du point peuvent embarquer
   ensemble via des cases à cocher.
   ============================================================ */

const TransitionDialog = (() => {
    /* Sur le point même (rayon d'interaction de transitionAtToken) :
       considéré dans la cabine, coché d'office. */
    const ON_POINT_RADIUS = 0.8;

    let backdrop = null;

    function close() {
        if (backdrop) { backdrop.remove(); backdrop = null; }
    }

    function isOpen() { return !!backdrop; }

    /* PJ susceptibles d'embarquer avec le pion déplacé : mêmes règles de
       manipulation que le drag (verrou, visibilité et playerMovable en vue
       joueur). Tous les pions de l'étage sont proposés, triés du plus
       proche au plus lointain — seuls ceux déjà sur le point sont cochés
       d'office. */
    function riderCandidates(token, endpoint) {
        return Store.visibleTokens(token.floorId)
            .filter(item => item.id !== token.id && !item.locked
                && (!Store.isPlayerView() || item.playerMovable))
            .map(item => ({ token: item, distance: Math.hypot(item.x - endpoint.x, item.y - endpoint.y) }))
            .sort((a, b) => a.distance - b.distance);
    }

    /* Activation d'un bouton au doigt comme à la souris. Certains
       environnements tactiles (émulation CDP des tests, navigateurs
       capricieux) ne synthétisent pas de `click` après un tap : on
       déclenche au pointerup tactile et on neutralise le click qui
       suivrait éventuellement pour ne pas agir deux fois. */
    function onActivate(element, handler) {
        let touchHandled = false;
        element.addEventListener('pointerup', event => {
            if (event.pointerType !== 'touch') return;
            touchHandled = true;
            handler();
        });
        element.addEventListener('click', () => {
            if (touchHandled) { touchHandled = false; return; }
            handler();
        });
    }

    function subtitle(text) {
        const element = document.createElement('div');
        element.className = 'transition-dialog-subtitle';
        element.textContent = text;
        return element;
    }

    function open(token, transition, endpoint, destinations) {
        close();
        const exit = transition.type === 'stairs'
            ? Store.stairsExitDirection(transition, endpoint) : null;
        const arrow = exit === 'up' ? ' (↑ monter)'
            : exit === 'down' ? ' (↓ descendre)' : exit === 'both' ? ' (⇅)' : '';

        backdrop = document.createElement('div');
        backdrop.className = 'transition-dialog-backdrop';
        backdrop.addEventListener('pointerdown', event => {
            if (event.target === backdrop) close();
        });
        const dialog = document.createElement('div');
        dialog.className = 'transition-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        backdrop.appendChild(dialog);

        const title = document.createElement('div');
        title.className = 'transition-dialog-title';
        title.textContent = transition.name + arrow;
        dialog.appendChild(title);

        const riders = riderCandidates(token, endpoint);
        const riderInputs = [];
        if (riders.length) {
            dialog.appendChild(subtitle('Qui embarque ?'));
            const list = document.createElement('div');
            list.className = 'transition-dialog-riders';
            const self = document.createElement('label');
            self.className = 'transition-rider';
            const selfInput = document.createElement('input');
            selfInput.type = 'checkbox';
            selfInput.checked = true;
            selfInput.disabled = true;
            self.appendChild(selfInput);
            self.appendChild(document.createTextNode(' ' + token.name));
            list.appendChild(self);
            riders.forEach(({ token: rider, distance }) => {
                const label = document.createElement('label');
                label.className = 'transition-rider';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = distance <= ON_POINT_RADIUS;
                input.dataset.tokenId = rider.id;
                riderInputs.push(input);
                label.appendChild(input);
                label.appendChild(document.createTextNode(' ' + rider.name));
                list.appendChild(label);
            });
            dialog.appendChild(list);
        }

        dialog.appendChild(subtitle('Destination :'));
        const list = document.createElement('div');
        list.className = 'transition-dialog-destinations';
        const error = document.createElement('div');
        error.className = 'transition-dialog-error';
        error.hidden = true;
        // Ordre des étages du plan (haut → bas), comme un panneau de cabine.
        const ordered = destinations.slice().sort((a, b) => {
            const floorA = Store.findFloor(a.floorId);
            const floorB = Store.findFloor(b.floorId);
            return (floorA ? floorA.order : 0) - (floorB ? floorB.order : 0);
        });
        ordered.forEach(destination => {
            const floor = Store.findFloor(destination.floorId);
            const letter = Store.endpointLetter(transition, destination);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'transition-destination';
            button.dataset.endpointId = destination.id;
            button.textContent = Exploration.destinationLabel(transition, floor)
                + (letter ? ' ' + letter : '');
            onActivate(button, () => {
                /* Résolution par id au moment du clic : une synchro cloud a pu
                   remplacer les objets plan/pions pendant que la modale était
                   ouverte (les références capturées seraient périmées). */
                const liveTransition = Store.findTransition(transition.id);
                const liveEndpoint = liveTransition
                    && liveTransition.endpoints.find(item => item.id === endpoint.id);
                const liveDestination = liveTransition
                    && liveTransition.endpoints.find(item => item.id === destination.id);
                const group = [token.id].concat(riderInputs
                    .filter(input => input.checked)
                    .map(input => input.dataset.tokenId))
                    .map(id => Store.findToken(id)).filter(Boolean);
                const moved = liveEndpoint && liveDestination
                    ? Exploration.moveGroupThroughTransition(group, liveTransition, liveEndpoint, liveDestination)
                    : 0;
                if (moved > 0) { close(); return; }
                error.textContent = 'Impossible : le passage est verrouillé ou inactif.';
                error.hidden = false;
            });
            list.appendChild(button);
        });
        dialog.appendChild(list);
        dialog.appendChild(error);

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'transition-dialog-cancel';
        cancel.textContent = 'Annuler';
        onActivate(cancel, close);
        dialog.appendChild(cancel);

        document.body.appendChild(backdrop);
    }

    return { open, close, isOpen };
})();

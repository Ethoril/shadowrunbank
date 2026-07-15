/* ============================================================
   catalog.js — Catalogue déclaratif des dispositifs.
   Les autres modules interrogent les capacités au lieu de tester
   des identifiants particuliers.
   ============================================================ */

const EntityCatalog = (() => {
    const categories = [
        { id: 'structure', label: 'Structure' },
        { id: 'access', label: 'Accès' },
        { id: 'detection', label: 'Détection' },
        { id: 'defense', label: 'Défense' },
        { id: 'personnel', label: 'Personnel' },
        { id: 'magic', label: 'Magie' },
        { id: 'utility', label: 'Utilitaires' }
    ];

    const stateProfiles = {
        electronic: [
            ['active', 'Actif'], ['hacked', 'Piraté'], ['offline', 'Hors ligne']
        ],
        personnel: [
            ['active', 'Vigilant'], ['hacked', 'Alerté'], ['offline', 'Neutralisé']
        ],
        magical: [
            ['active', 'Actif'], ['hacked', 'Perturbé'], ['offline', 'Dissipé / banni']
        ],
        access: [
            ['active', 'Verrouillé'], ['hacked', 'Ouvert'], ['offline', 'Désactivé']
        ],
        drone: [
            ['active', 'Actif'], ['hacked', 'Piraté'], ['offline', 'Neutralisé']
        ],
        structural: [
            ['active', 'Intacte'], ['hacked', 'Ouverte'], ['offline', 'Détruite']
        ]
    };

    const base = {
        networkable: false,
        canPatrol: false,
        coverageType: 'none',
        coverageChannel: null,
        defaultCoverage: null,
        canSweep: false,
        blocksMovement: false,
        blocksVision: [],
        accessControl: false,
        biometric: false,
        armed: false,
        magical: false,
        autoDiscover: true,
        stateProfile: 'electronic'
    };

    const define = config => {
        const value = { ...base, ...config };
        value.mobile = value.canPatrol;
        value.hasVision = value.coverageType === 'cone';
        return Object.freeze(value);
    };
    const types = {
        steel_grate: define({ category: 'structure', name: "Grille d'acier", label: 'GRL', color: '#78909c', blocksMovement: true, stateProfile: 'structural' }),

        mad_gate: define({ category: 'access', name: 'Portique MAD', label: 'MAD', color: '#00bcd4', networkable: true, coverageType: 'threshold', coverageChannel: 'magnetic', defaultCoverage: { range: 0.75, width: 2 }, accessControl: true, stateProfile: 'access' }),
        maglock: define({ category: 'access', name: 'Maglock', label: 'MAG', color: '#00d2ff', networkable: true, accessControl: true, stateProfile: 'access' }),
        retina_scanner: define({ category: 'access', name: 'Scanner rétinien', label: 'RET', color: '#29b6f6', networkable: true, accessControl: true, biometric: true, stateProfile: 'access' }),
        dna_analyzer: define({ category: 'access', name: 'Analyseur ADN', label: 'ADN', color: '#26c6da', networkable: true, accessControl: true, biometric: true, stateProfile: 'access' }),
        elevator: define({ category: 'access', name: 'Ascenseur', label: 'ELV', color: '#8899ff', networkable: true, accessControl: true, stateProfile: 'access' }),

        camera: define({ category: 'detection', name: 'Caméra', label: 'CAM', color: '#ff2a2a', networkable: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 60, range: 6 }, canSweep: true }),
        infrared_motion_sensor: define({ category: 'detection', name: 'Détecteur infrarouge', label: 'IR', color: '#ff7043', networkable: true, coverageType: 'cone', coverageChannel: 'infrared', defaultCoverage: { angle: 90, range: 6 } }),
        detection_laser: define({ category: 'detection', name: 'Laser de détection', label: 'LSR', color: '#ef5350', networkable: true, coverageType: 'beam', coverageChannel: 'laser', defaultCoverage: { range: 8, width: 0.25 }, autoDiscover: false }),
        pressure_plate: define({ category: 'detection', name: 'Plaque de pression', label: 'PRS', color: '#ffa726', networkable: true, coverageType: 'rectangle', coverageChannel: 'pressure', defaultCoverage: { range: 2, width: 2 }, autoDiscover: false }),
        sensor: define({ category: 'detection', name: 'Capteur générique', label: 'SNS', color: '#9dff00', networkable: true, autoDiscover: false }),

        micro_security_drone: define({ category: 'defense', name: 'Micro-drone de sécurité', label: 'µDR', color: '#ec407a', networkable: true, canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 70, range: 4 }, canSweep: true, stateProfile: 'drone' }),
        combat_drone: define({ category: 'defense', name: 'Drone de combat', label: 'DRN', color: '#ff2a9d', networkable: true, canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 80, range: 7 }, canSweep: true, armed: true, stateProfile: 'drone' }),
        automatic_turret: define({ category: 'defense', name: 'Tourelle automatique', label: 'TRT', color: '#ff5722', networkable: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 90, range: 8 }, canSweep: true, armed: true, stateProfile: 'drone' }),
        drone: define({ category: 'defense', name: 'Drone à préciser', label: 'DRN', color: '#ff2a9d', networkable: true, canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 60, range: 6 }, canSweep: true, stateProfile: 'drone' }),

        armed_guard: define({ category: 'personnel', name: 'Garde armé', label: 'GRD', color: '#4af626', canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 100, range: 5 }, armed: true, stateProfile: 'personnel' }),

        security_mage: define({ category: 'magic', name: 'Mage de sécurité', label: 'MAG', color: '#ab47bc', canPatrol: true, coverageType: 'circle', coverageChannel: 'astral', defaultCoverage: { radius: 5 }, magical: true, stateProfile: 'magical' }),
        mana_barrier: define({ category: 'magic', name: 'Barrière de mana', label: 'BAR', color: '#bd00ff', blocksVision: ['astral'], magical: true, stateProfile: 'magical' }),
        patrol_spirit: define({ category: 'magic', name: 'Esprit de patrouille', label: 'ESP', color: '#7e57c2', canPatrol: true, coverageType: 'circle', coverageChannel: 'astral', defaultCoverage: { radius: 4 }, magical: true, stateProfile: 'magical' }),

        network_node: define({ category: 'utility', name: 'Nœud réseau', label: 'NET', color: '#ffb300' })
    };

    const legacyAliases = Object.freeze({
        turret: 'automatic_turret',
        barrier: 'mana_barrier',
        guard: 'armed_guard'
    });

    const securityTypes = Object.freeze([
        'mad_gate', 'maglock', 'retina_scanner', 'dna_analyzer',
        'camera', 'infrared_motion_sensor', 'detection_laser', 'pressure_plate',
        'micro_security_drone', 'combat_drone', 'automatic_turret', 'armed_guard',
        'security_mage', 'steel_grate', 'mana_barrier', 'patrol_spirit'
    ]);

    const fallback = define({ category: 'utility', name: 'Type inconnu', label: '???', color: '#888' });

    function resolveType(type) {
        return legacyAliases[type] || type;
    }

    function get(type) {
        return types[resolveType(type)] || fallback;
    }

    function entries(category) {
        return Object.entries(types).filter(([, def]) => !category || def.category === category);
    }

    function statesFor(type) {
        const def = get(type);
        return stateProfiles[def.stateProfile] || stateProfiles.electronic;
    }

    return { categories, stateProfiles, types, securityTypes, legacyAliases, resolveType, get, entries, statesFor };
})();

/* Catalogue des décors. Les propriétés peuvent ensuite être surchargées
   sur chaque instance depuis l'inspecteur. */
const DecorCatalog = (() => {
    const categories = [
        { id: 'structural', label: 'Structure' },
        { id: 'furniture', label: 'Mobilier' },
        { id: 'floor', label: 'Sol & ambiance' }
    ];
    const opaque = ['optical', 'infrared', 'laser'];
    const base = {
        width: 1,
        height: 1,
        layer: 'obstacle',
        blocksMovement: false,
        blocksVision: [],
        autoDiscover: true
    };
    const define = config => Object.freeze({ ...base, ...config });
    const types = {
        wall: define({ category: 'structural', name: 'Mur / cloison', label: 'MUR', color: '#78909c', width: 3, height: 0.35, blocksMovement: true, blocksVision: opaque }),
        pillar: define({ category: 'structural', name: 'Pilier', label: 'PIL', color: '#90a4ae', blocksMovement: true, blocksVision: opaque }),
        opaque_door: define({ category: 'structural', name: 'Porte opaque', label: 'POR', color: '#8d6e63', height: 0.35, blocksMovement: true, blocksVision: opaque }),
        opening: define({ category: 'structural', name: 'Ouverture / passage', label: 'PAS', color: '#26a69a', width: 1.5, height: 0.25, layer: 'floor' }),
        glass: define({ category: 'structural', name: 'Vitre', label: 'VIT', color: '#80deea', width: 2, height: 0.2, blocksMovement: true }),
        grid: define({ category: 'structural', name: 'Grille', label: 'GRL', color: '#607d8b', width: 2, height: 0.2, blocksMovement: true }),
        stairs: define({ category: 'structural', name: 'Escalier', label: 'ESC', color: '#7986cb', width: 2, height: 3, layer: 'floor' }),
        elevator_decor: define({ category: 'structural', name: 'Cabine d’ascenseur', label: 'ELV', color: '#5c6bc0', width: 2, height: 2, blocksMovement: true, blocksVision: opaque }),

        counter: define({ category: 'furniture', name: 'Comptoir', label: 'CPT', color: '#ffb74d', width: 3, blocksMovement: true, blocksVision: opaque }),
        desk: define({ category: 'furniture', name: 'Bureau', label: 'BUR', color: '#a1887f', width: 2, blocksMovement: true }),
        cabinet: define({ category: 'furniture', name: 'Armoire', label: 'ARM', color: '#8d6e63', height: 0.75, blocksMovement: true, blocksVision: opaque }),
        shelf: define({ category: 'furniture', name: 'Étagère', label: 'ETA', color: '#bcaaa4', width: 2, height: 0.6, blocksMovement: true, blocksVision: opaque }),
        safe: define({ category: 'furniture', name: 'Coffre-fort', label: 'COF', color: '#546e7a', width: 1.5, height: 1.5, blocksMovement: true, blocksVision: opaque, autoDiscover: false }),
        crate: define({ category: 'furniture', name: 'Caisse', label: 'CAI', color: '#795548', blocksMovement: true }),
        server_rack: define({ category: 'furniture', name: 'Baie serveur', label: 'SRV', color: '#26c6da', width: 1, height: 2, blocksMovement: true, blocksVision: opaque }),
        planter: define({ category: 'furniture', name: 'Grande plante / séparation', label: 'PLN', color: '#66bb6a', width: 2, height: 0.75, blocksMovement: true, blocksVision: opaque }),

        chair: define({ category: 'floor', name: 'Chaise', label: 'CHS', color: '#b0bec5', width: 0.6, height: 0.6, layer: 'floor', blocksMovement: true }),
        bench: define({ category: 'floor', name: 'Banc', label: 'BNC', color: '#a1887f', width: 2, height: 0.7, layer: 'floor', blocksMovement: true }),
        rug: define({ category: 'floor', name: 'Tapis', label: 'TAP', color: '#7e57c2', width: 3, height: 2, layer: 'floor' }),
        floor_marking: define({ category: 'floor', name: 'Marquage au sol', label: 'MRQ', color: '#ffee58', width: 2, height: 0.35, layer: 'floor' }),
        small_furniture: define({ category: 'floor', name: 'Petit mobilier', label: 'OBJ', color: '#9e9e9e', layer: 'floor', blocksMovement: true }),
        visual_element: define({ category: 'floor', name: 'Élément visuel', label: 'DEC', color: '#ec407a', width: 2, height: 2, layer: 'floor' })
    };
    const fallback = define({ category: 'floor', name: 'Décor inconnu', label: '???', color: '#888', layer: 'floor' });
    function get(type) { return types[type] || fallback; }
    function entries(category) {
        return Object.entries(types).filter(([, definition]) => !category || definition.category === category);
    }
    return { categories, types, get, entries };
})();

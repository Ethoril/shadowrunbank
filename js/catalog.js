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
        icon: null,
        accessControl: false,
        biometric: false,
        armed: false,
        magical: false,
        autoDiscover: false,
        stateProfile: 'electronic'
    };

    const define = config => {
        const value = { ...base, ...config };
        value.mobile = value.canPatrol;
        value.hasVision = value.coverageType === 'cone';
        return Object.freeze(value);
    };
    const types = {
        steel_grate: define({ category: 'structure', name: "Grille d'acier", label: 'GRL', icon: 'steel-grate', color: '#78909c', blocksMovement: true, stateProfile: 'structural', autoDiscover: true }),

        mad_gate: define({ category: 'access', name: 'Portique MAD', label: 'MAD', icon: 'mad-gate', color: '#00bcd4', networkable: true, coverageType: 'threshold', coverageChannel: 'magnetic', defaultCoverage: { range: 0.75, width: 2 }, accessControl: true, stateProfile: 'access', autoDiscover: true }),
        maglock: define({ category: 'access', name: 'Maglock', label: 'MAG', icon: 'maglock', color: '#00d2ff', networkable: true, accessControl: true, stateProfile: 'access', autoDiscover: true }),
        retina_scanner: define({ category: 'access', name: 'Scanner rétinien', label: 'RET', icon: 'retina-scanner', color: '#29b6f6', networkable: true, accessControl: true, biometric: true, stateProfile: 'access', autoDiscover: true }),
        dna_analyzer: define({ category: 'access', name: 'Analyseur ADN', label: 'ADN', icon: 'dna-analyzer', color: '#26c6da', networkable: true, accessControl: true, biometric: true, stateProfile: 'access', autoDiscover: true }),
        elevator: define({ category: 'access', name: 'Ascenseur', label: 'ELV', icon: 'elevator', color: '#8899ff', networkable: true, accessControl: true, stateProfile: 'access', autoDiscover: true }),

        camera: define({ category: 'detection', name: 'Caméra', label: 'CAM', icon: 'camera', color: '#ff2a2a', networkable: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 60, range: 6 }, canSweep: true, autoDiscover: true }),
        infrared_motion_sensor: define({ category: 'detection', name: 'Détecteur infrarouge', label: 'IR', icon: 'infrared-motion-sensor', color: '#ff7043', networkable: true, coverageType: 'cone', coverageChannel: 'infrared', defaultCoverage: { angle: 90, range: 6 } }),
        detection_laser: define({ category: 'detection', name: 'Laser de détection', label: 'LSR', icon: 'detection-laser', color: '#ef5350', networkable: true, coverageType: 'beam', coverageChannel: 'laser', defaultCoverage: { range: 8, width: 0.25 }, autoDiscover: false }),
        pressure_plate: define({ category: 'detection', name: 'Plaque de pression', label: 'PRS', icon: 'pressure-plate', color: '#ffa726', networkable: true, coverageType: 'rectangle', coverageChannel: 'pressure', defaultCoverage: { range: 2, width: 2 }, autoDiscover: false }),
        sensor: define({ category: 'detection', name: 'Capteur générique', label: 'SNS', icon: 'sensor', color: '#9dff00', networkable: true, autoDiscover: false }),

        micro_security_drone: define({ category: 'defense', name: 'Micro-drone de sécurité', label: 'µDR', icon: 'micro-security-drone', color: '#ec407a', networkable: true, canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 70, range: 4 }, canSweep: true, stateProfile: 'drone' }),
        combat_drone: define({ category: 'defense', name: 'Drone de combat', label: 'DRN', icon: 'combat-drone', color: '#ff2a9d', networkable: true, canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 80, range: 7 }, canSweep: true, armed: true, stateProfile: 'drone', autoDiscover: true }),
        automatic_turret: define({ category: 'defense', name: 'Tourelle automatique', label: 'TRT', icon: 'automatic-turret', color: '#ff5722', networkable: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 90, range: 8 }, canSweep: true, armed: true, stateProfile: 'drone' }),
        drone: define({ category: 'defense', name: 'Drone à préciser', label: 'DRN', icon: 'drone', color: '#ff2a9d', networkable: true, canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 60, range: 6 }, canSweep: true, stateProfile: 'drone' }),

        armed_guard: define({ category: 'personnel', name: 'Garde armé', label: 'GRD', icon: 'armed-guard', color: '#4af626', canPatrol: true, coverageType: 'cone', coverageChannel: 'optical', defaultCoverage: { angle: 100, range: 5 }, armed: true, stateProfile: 'personnel', autoDiscover: true }),
        bank_employee: define({ category: 'personnel', name: 'Employé de banque', label: 'EMP', icon: 'bank-employee', color: '#ffca28', canPatrol: true, stateProfile: 'personnel', autoDiscover: true }),
        civilian: define({ category: 'personnel', name: 'Civil', label: 'CIV', icon: 'civilian', color: '#b0bec5', canPatrol: true, stateProfile: 'personnel', autoDiscover: true }),

        security_mage: define({ category: 'magic', name: 'Mage de sécurité', label: 'MAG', icon: 'security-mage', color: '#ab47bc', canPatrol: true, coverageType: 'circle', coverageChannel: 'astral', defaultCoverage: { radius: 5 }, magical: true, stateProfile: 'magical' }),
        mana_barrier: define({ category: 'magic', name: 'Barrière de mana', label: 'BAR', icon: 'mana-barrier', color: '#bd00ff', blocksVision: ['astral'], magical: true, stateProfile: 'magical' }),
        patrol_spirit: define({ category: 'magic', name: 'Esprit de patrouille', label: 'ESP', icon: 'patrol-spirit', color: '#7e57c2', canPatrol: true, coverageType: 'circle', coverageChannel: 'astral', defaultCoverage: { radius: 4 }, magical: true, stateProfile: 'magical' }),

        network_node: define({ category: 'utility', name: 'Nœud réseau', label: 'NET', icon: 'network-node', color: '#ffb300', autoDiscover: true })
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
        icon: null,
        autoDiscover: true
    };
    const define = config => Object.freeze({ ...base, ...config });
    const types = {
        wall: define({ category: 'structural', name: 'Mur / cloison', label: 'MUR', icon: 'wall', color: '#78909c', width: 3, height: 0.35, blocksMovement: true, blocksVision: opaque }),
        pillar: define({ category: 'structural', name: 'Pilier', label: 'PIL', icon: 'pillar', color: '#90a4ae', blocksMovement: true, blocksVision: opaque }),
        opaque_door: define({ category: 'structural', name: 'Porte opaque', label: 'POR', icon: 'opaque-door', color: '#8d6e63', height: 0.35, blocksMovement: true, blocksVision: opaque }),
        opening: define({ category: 'structural', name: 'Ouverture / passage', label: 'PAS', icon: 'opening', color: '#26a69a', width: 1.5, height: 0.25, layer: 'floor' }),
        glass: define({ category: 'structural', name: 'Vitre', label: 'VIT', icon: 'glass', color: '#80deea', width: 2, height: 0.2, blocksMovement: true }),
        grid: define({ category: 'structural', name: 'Grille', label: 'GRL', icon: 'grid', color: '#607d8b', width: 2, height: 0.2, blocksMovement: true }),
        // 7.10 : rendus obsolètes par la cabine générée depuis les transitions.
        // Conservés pour afficher les plans existants, mais retirés de la
        // palette ; l'outil MJ « purge » propose leur suppression.
        stairs: define({ category: 'structural', name: 'Escalier', label: 'ESC', icon: 'stairs', color: '#7986cb', width: 2, height: 3, layer: 'floor', legacy: true }),
        elevator_decor: define({ category: 'structural', name: 'Cabine d’ascenseur', label: 'ELV', icon: 'elevator-decor', color: '#5c6bc0', width: 2, height: 2, blocksMovement: true, blocksVision: opaque, legacy: true }),

        counter: define({ category: 'furniture', name: 'Comptoir', label: 'CPT', icon: 'counter', color: '#ffb74d', width: 3, blocksMovement: true, blocksVision: opaque }),
        desk: define({ category: 'furniture', name: 'Bureau', label: 'BUR', icon: 'desk', color: '#a1887f', width: 2, blocksMovement: true }),
        cabinet: define({ category: 'furniture', name: 'Armoire', label: 'ARM', icon: 'cabinet', color: '#8d6e63', height: 0.75, blocksMovement: true, blocksVision: opaque }),
        shelf: define({ category: 'furniture', name: 'Étagère', label: 'ETA', icon: 'shelf', color: '#bcaaa4', width: 2, height: 0.6, blocksMovement: true, blocksVision: opaque }),
        safe: define({ category: 'furniture', name: 'Coffre-fort', label: 'COF', icon: 'safe', color: '#546e7a', width: 1.5, height: 1.5, blocksMovement: true, blocksVision: opaque }),
        crate: define({ category: 'furniture', name: 'Caisse', label: 'CAI', icon: 'crate', color: '#795548', blocksMovement: true }),
        server_rack: define({ category: 'furniture', name: 'Baie serveur', label: 'SRV', icon: 'server-rack', color: '#26c6da', width: 1, height: 2, blocksMovement: true, blocksVision: opaque }),
        planter: define({ category: 'furniture', name: 'Grande plante / séparation', label: 'PLN', icon: 'planter', color: '#66bb6a', width: 2, height: 0.75, blocksMovement: true, blocksVision: opaque }),

        chair: define({ category: 'floor', name: 'Chaise', label: 'CHS', icon: 'chair', color: '#b0bec5', width: 0.6, height: 0.6, layer: 'floor', blocksMovement: true }),
        bench: define({ category: 'floor', name: 'Banc', label: 'BNC', icon: 'bench', color: '#a1887f', width: 2, height: 0.7, layer: 'floor', blocksMovement: true }),
        rug: define({ category: 'floor', name: 'Tapis', label: 'TAP', icon: 'rug', color: '#7e57c2', width: 3, height: 2, layer: 'floor' }),
        floor_marking: define({ category: 'floor', name: 'Marquage au sol', label: 'MRQ', icon: 'floor-marking', color: '#ffee58', width: 2, height: 0.35, layer: 'floor' }),
        small_furniture: define({ category: 'floor', name: 'Petit mobilier', label: 'OBJ', icon: 'small-furniture', color: '#9e9e9e', layer: 'floor', blocksMovement: true }),
        visual_element: define({ category: 'floor', name: 'Élément visuel', label: 'DEC', icon: 'visual-element', color: '#ec407a', width: 2, height: 2, layer: 'floor' })
    };
    const fallback = define({ category: 'floor', name: 'Décor inconnu', label: '???', color: '#888', layer: 'floor' });
    function get(type) { return types[type] || fallback; }
    function entries(category) {
        return Object.entries(types).filter(([, definition]) => !category || definition.category === category);
    }
    return { categories, types, get, entries };
})();

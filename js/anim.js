/* ============================================================
   anim.js — Moteur d'animation déterministe partagé.
   Position d'une ronde et angle d'un balayage = fonctions pures
   du temps (Date.now() - anchorAt) : aucun état streamé, chaque
   client (MJ / joueurs, phase 3+) calcule la même chose.
   ============================================================ */

const Anim = (() => {

    /* Pose le long de la ronde à l'instant `now` (epoch ms).
       Le cap suit le segment parcouru, y compris sur le trajet retour. */
    function patrolPose(patrol, now) {
        const pts = patrol.points;
        if (!pts || pts.length === 0) return null;
        if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, direction: null };

        const segs = [];
        let total = 0;
        const n = pts.length;
        const segCount = patrol.loop ? n : n - 1;
        for (let i = 0; i < segCount; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len <= 1e-9) continue;
            segs.push({ a, b, len });
            total += len;
        }
        if (total === 0) return { x: pts[0].x, y: pts[0].y, direction: null };

        const speed = patrol.speed > 0 ? patrol.speed : 1;
        let dist = ((now - (patrol.anchorAt || 0)) / 1000) * speed;
        let returning = false;
        if (patrol.loop) {
            dist = ((dist % total) + total) % total;
        } else {
            const cycle = 2 * total;
            dist = ((dist % cycle) + cycle) % cycle;
            returning = dist >= total;
            if (returning) dist = cycle - dist; // trajet retour
        }

        for (let index = 0; index < segs.length; index += 1) {
            const s = segs[index];
            // Au waypoint, le mobile adopte immédiatement le cap du segment suivant.
            const onSegment = returning ? dist <= s.len : dist < s.len || index === segs.length - 1;
            if (onSegment) {
                const t = s.len === 0 ? 0 : dist / s.len;
                const dx = returning ? s.a.x - s.b.x : s.b.x - s.a.x;
                const dy = returning ? s.a.y - s.b.y : s.b.y - s.a.y;
                return {
                    x: s.a.x + (s.b.x - s.a.x) * t,
                    y: s.a.y + (s.b.y - s.a.y) * t,
                    direction: Math.atan2(dy, dx) * 180 / Math.PI
                };
            }
            dist -= s.len;
        }
        const last = patrol.loop ? pts[0] : pts[n - 1];
        return { x: last.x, y: last.y, direction: null };
    }

    /* Compatibilité avec les appels qui n'ont besoin que de la position. */
    function patrolPosition(patrol, now) {
        const pose = patrolPose(patrol, now);
        return pose ? { x: pose.x, y: pose.y } : null;
    }

    /* Azimut d'une couverture à l'instant `now` : statique, ou onde triangle
       entre sweep.from et sweep.to sur sweep.period secondes. */
    function sweepDirection(coverage, now) {
        const s = coverage.sweep;
        if (!s) return coverage.direction;
        const period = Math.max(0.5, s.period || 8);
        let phase = (((now - (s.anchorAt || 0)) / 1000) % period) / period;
        if (phase < 0) phase += 1;
        const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0→1→0
        return s.from + (s.to - s.from) * tri;
    }

    /* Direction effective d'une couverture. Pour un cône porté par une entité
       en ronde, le segment parcouru définit le devant. Un balayage reste un
       décalage relatif autour de ce cap au lieu de rester attaché à la carte. */
    function coverageDirection(ent, now) {
        if (!ent || !ent.coverage) return 0;
        const coverage = ent.coverage;
        const absoluteDirection = sweepDirection(coverage, now);
        const state = Store.getEffectiveState(ent);
        const moving = state !== 'offline' && state !== 'neutralized'
            && ent.patrol && ent.patrol.moving && ent.patrol.points.length >= 2;
        if (!moving || coverage.shape !== 'cone') return absoluteDirection;

        const pose = patrolPose(ent.patrol, now);
        if (!pose || pose.direction === null) return absoluteDirection;
        const sweepOffset = coverage.sweep ? absoluteDirection - coverage.direction : 0;
        return pose.direction + sweepOffset;
    }

    /* Position effective d'une entité : animée si en ronde, sinon x/y stockés */
    function effectivePos(ent, now) {
        const state = Store.getEffectiveState(ent);
        const blocked = state === 'offline' || state === 'neutralized';
        if (!blocked && ent.patrol && ent.patrol.moving && ent.patrol.points.length >= 2) {
            const pos = patrolPosition(ent.patrol, now);
            if (pos) return pos;
        }
        return { x: ent.x, y: ent.y };
    }

    /* --- Boucle requestAnimationFrame --- */
    let rafId = null;
    let lastVisualAt = 0;

    function tick() {
        const now = Date.now();
        const floor = Store.currentFloor();
        if (floor) {
            let moved = false, needCoverages = false;
            Store.floorEntities(floor.id).forEach(ent => {
                const state = Store.getEffectiveState(ent);
                const patrolBlocked = state === 'offline' || state === 'neutralized';
                if (!patrolBlocked && ent.patrol && ent.patrol.moving && ent.patrol.points.length >= 2) {
                    const pos = patrolPosition(ent.patrol, now);
                    if (pos) MapView.setEntityScreenPos(ent.id, pos.x, pos.y);
                    moved = true;
                    if (ent.coverage) needCoverages = true;
                }
                if (ent.coverage && ent.coverage.sweep && Store.getEffectiveState(ent) !== 'offline') {
                    needCoverages = true;
                }
            });
            if (moved) MapView.renderCables(now);
            if ((moved || needCoverages) && now - lastVisualAt > 33) { // ~30 fps pour le rendu
                const feedChanged = MapView.updateCameraFeedVisibility(now);
                if (needCoverages && !feedChanged) MapView.renderCoverages(now);
                lastVisualAt = now;
            }
        }
        rafId = requestAnimationFrame(tick);
    }

    function start() {
        if (rafId === null) rafId = requestAnimationFrame(tick);
    }

    return { patrolPose, patrolPosition, sweepDirection, coverageDirection, effectivePos, start };
})();

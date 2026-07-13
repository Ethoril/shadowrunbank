/* ============================================================
   anim.js — Moteur d'animation déterministe partagé.
   Position d'une ronde et angle d'un balayage = fonctions pures
   du temps (Date.now() - anchorAt) : aucun état streamé, chaque
   client (MJ / joueurs, phase 3+) calcule la même chose.
   ============================================================ */

const Anim = (() => {

    /* Position le long de la ronde à l'instant `now` (epoch ms).
       Boucle : distance modulo périmètre. Aller-retour : onde triangle. */
    function patrolPosition(patrol, now) {
        const pts = patrol.points;
        if (!pts || pts.length === 0) return null;
        if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };

        const segs = [];
        let total = 0;
        const n = pts.length;
        const segCount = patrol.loop ? n : n - 1;
        for (let i = 0; i < segCount; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            segs.push({ a, b, len });
            total += len;
        }
        if (total === 0) return { x: pts[0].x, y: pts[0].y };

        const speed = patrol.speed > 0 ? patrol.speed : 1;
        let dist = ((now - (patrol.anchorAt || 0)) / 1000) * speed;
        if (patrol.loop) {
            dist = ((dist % total) + total) % total;
        } else {
            const cycle = 2 * total;
            dist = ((dist % cycle) + cycle) % cycle;
            if (dist > total) dist = cycle - dist; // aller-retour
        }

        for (const s of segs) {
            if (dist <= s.len) {
                const t = s.len === 0 ? 0 : dist / s.len;
                return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
            }
            dist -= s.len;
        }
        const last = patrol.loop ? pts[0] : pts[n - 1];
        return { x: last.x, y: last.y };
    }

    /* Azimut du cône à l'instant `now` : statique, ou onde triangle
       entre sweep.from et sweep.to sur sweep.period secondes. */
    function sweepDirection(vision, now) {
        const s = vision.sweep;
        if (!s) return vision.direction;
        const period = Math.max(0.5, s.period || 8);
        let phase = (((now - (s.anchorAt || 0)) / 1000) % period) / period;
        if (phase < 0) phase += 1;
        const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0→1→0
        return s.from + (s.to - s.from) * tri;
    }

    /* Position effective d'une entité : animée si en ronde, sinon x/y stockés */
    function effectivePos(ent, now) {
        if (ent.patrol && ent.patrol.moving && ent.patrol.points.length >= 2) {
            const pos = patrolPosition(ent.patrol, now);
            if (pos) return pos;
        }
        return { x: ent.x, y: ent.y };
    }

    /* --- Boucle requestAnimationFrame --- */
    let rafId = null;
    let lastConeAt = 0;

    function tick() {
        const now = Date.now();
        const floor = Store.currentFloor();
        if (floor) {
            let moved = false, needCones = false;
            Store.floorEntities(floor.id).forEach(ent => {
                if (ent.patrol && ent.patrol.moving && ent.patrol.points.length >= 2) {
                    const pos = patrolPosition(ent.patrol, now);
                    if (pos) MapView.setEntityScreenPos(ent.id, pos.x, pos.y);
                    moved = true;
                    if (ent.vision) needCones = true;
                }
                if (ent.vision && ent.vision.sweep && Store.getEffectiveState(ent) !== 'offline') {
                    needCones = true;
                }
            });
            if (moved) MapView.renderCables(now);
            if (needCones && now - lastConeAt > 33) { // ~30 fps pour le raycasting
                MapView.renderCones(now);
                lastConeAt = now;
            }
        }
        rafId = requestAnimationFrame(tick);
    }

    function start() {
        if (rafId === null) rafId = requestAnimationFrame(tick);
    }

    return { patrolPosition, sweepDirection, effectivePos, start };
})();

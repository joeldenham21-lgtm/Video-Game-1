// ============================================================================
// ELDERFALL — lights.js
// Real dynamic lighting, everywhere it matters. A fixed pool of PointLights
// is distance/importance-scored against every registered light source each
// frame and smoothly handed off, so the world can hold dozens of "lit"
// things (lanterns, fires, braziers, cauldrons, crypt torches) while the
// GPU only ever pays for the nearest N. Replaces every fake glow-quad
// cheat. Flicker is per-source seeded noise; night-only sources gate on
// dayFrac; handoffs fade over ~0.3s so lights never pop.
// ============================================================================
import * as THREE from 'three';
import { hash2 } from './core.js';

export function createLights(g) {
  const POOL_N = g.quality.desktop ? 14 : 6;
  const pool = [];
  for (let i = 0; i < POOL_N; i++) {
    const L = new THREE.PointLight(0xffaa55, 0, 10, 2.0);
    L.castShadow = false;
    g.scene.add(L);
    pool.push({ L, src: null, cur: 0 }); // cur = current faded intensity
  }

  const sources = [];
  let seedCounter = 1;

  function isNight() {
    const f = g.time.dayFrac;
    return f < 0.24 || f > 0.76;
  }

  const api = {
    // register({ pos: Vector3|{x,y,z}, color, intensity, radius, flicker?, nightOnly?, enabled?() })
    // Returns a handle with remove() and the source object (mutate pos/intensity live).
    register(opts) {
      const src = {
        pos: opts.pos, // reference — callers may mutate
        color: new THREE.Color(opts.color ?? 0xffaa55),
        intensity: opts.intensity ?? 1.4,
        radius: opts.radius ?? 9,
        flicker: opts.flicker ?? 0,
        nightOnly: !!opts.nightOnly,
        enabled: opts.enabled || null,
        seed: seedCounter++,
        score: 0,
      };
      sources.push(src);
      return {
        src,
        remove() {
          const i = sources.indexOf(src);
          if (i >= 0) sources.splice(i, 1);
        },
      };
    },

    update(dt) {
      const cam = g.camera.position;
      const night = isNight();
      const t = g.time.elapsed;

      // Score all sources (cheap; throttling not needed at <100 sources)
      for (const s of sources) {
        if ((s.nightOnly && !night) || (s.enabled && !s.enabled())) { s.score = -1; continue; }
        const dx = s.pos.x - cam.x, dy = (s.pos.y || 0) - cam.y, dz = s.pos.z - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 120 * 120) { s.score = -1; continue; }
        s.score = s.intensity / (1 + d2 * 0.01);
      }

      // Top-N selection with hysteresis: keep a source's slot unless a
      // competitor beats it by 25% (prevents thrash at boundaries).
      const ranked = sources.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
      const want = ranked.slice(0, POOL_N);
      const wantSet = new Set(want);
      // free slots whose source dropped out badly
      for (const slot of pool) {
        if (slot.src && (!wantSet.has(slot.src) || slot.src.score < 0)) {
          const stillOk = slot.src.score > 0 && ranked.indexOf(slot.src) < POOL_N * 1.5;
          if (!stillOk) slot.pending = null, slot.src.assigned = false, slot.fadeOut = true;
        }
      }
      // assign wanted sources to free slots
      for (const s of want) {
        if (s.assigned) continue;
        const free = pool.find((p) => !p.src || p.fadeOut && p.cur < 0.05);
        if (!free) continue;
        if (free.src) free.src.assigned = false;
        free.src = s; free.fadeOut = false; s.assigned = true;
      }

      // Drive pool lights: fade toward target, apply flicker
      for (const slot of pool) {
        const s = slot.src;
        let target = 0;
        if (s && !slot.fadeOut && s.score > 0) {
          target = s.intensity;
          if (s.flicker > 0) {
            const n = Math.sin(t * 11 + s.seed * 7.3) * 0.5 + Math.sin(t * 23 + s.seed * 3.1) * 0.3
                    + (hash2((t * 30) | 0, s.seed) - 0.5) * 0.7;
            target *= 1 + n * 0.22 * s.flicker;
          }
        }
        slot.cur += (target - slot.cur) * Math.min(1, dt * 6);
        slot.L.intensity = slot.cur;
        if (s) {
          slot.L.position.set(s.pos.x, s.pos.y ?? 2, s.pos.z);
          slot.L.color.copy(s.color);
          slot.L.distance = s.radius;
          if (slot.cur < 0.02 && slot.fadeOut) { slot.src = null; slot.fadeOut = false; }
        }
      }
    },
  };
  return api;
}

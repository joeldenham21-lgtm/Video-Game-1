// ============================================================================
// ELDERFALL — acoustics.js
// Ray-driven acoustic simulation helpers for audio.js. The ONE AudioContext
// lives in audio.js: it constructs this at unlock() (feature-detected, never
// before) and drives it from its update(). main.js does NOT construct this.
//
// createAcoustics(g, ctx, worldBus, out) → {
//   acquire(at) → GainNode|null   // pooled spatial voice input (HRTF/stereo)
//   update(tw)                    // throttled: listener 30 Hz, occlusion 10 Hz
//                                 // (staggered), reflections 5 Hz, zones 2 Hz
//   spatial                       // true when any panning path exists
//   debug() → snapshot            // live gains/positions for verification
// }
//
// What it does:
// - HRTF PANNER POOL (12, reuse-oldest): positional one-shots route through
//   {panningModel:'HRTF', distanceModel:'inverse', refDistance 2, maxDistance
//   90}; the AudioListener is synced (30 Hz) to g.camera position AND
//   orientation. Desktop only — mobile keeps cheap equal-power stereo panning
//   (StereoPanner + inverse-distance gain), matching the game's mobile budget.
// - RAY OCCLUSION (the "path-traced" core): per active source, the direct
//   listener→source ray is marched against core.terrainHeight (6 samples — a
//   hill between you and the sound muffles it) and tested against every
//   g.colliders cylinder (2D segment-vs-circle with hMin/hMax honored — the
//   tavern blocks the brawl behind it). Occlusion 0..1 → per-voice lowpass
//   (22 kHz clear → 900 Hz walled-off) + up to −9 dB gain dip. Recomputed at
//   10 Hz, staggered ≤4 sources per tick. Air absorption folds into the same
//   filter: freq = min(occlusionFreq, 22000 − dist·180).
// - ENVIRONMENT REVERB ZONES: 4 hand-built stereo impulse responses generated
//   once at construction (seeded noise-decay buffers — FIELD 0.4 s sparse/dry,
//   FOREST 0.9 s dense with damped highs, VILLAGE 0.7 s with distinct early
//   slaps, CRYPT 2.8 s dark long tail). One ConvolverNode each, fed from the
//   world-SFX bus by per-zone send gains crossfaded over ~2 s as the player
//   moves (crypt = within 18 u of the Barrowdeep crypt center, village =
//   inside the village POI radius, forest = biomeAt says FOREST, else field).
//   Music/dread/ambience buses never touch these sends.
// - EARLY REFLECTIONS (ray-derived): 6 horizontal rays (60° apart) from the
//   listener, marched vs terrain + colliders to the nearest hit ≤30 u → a
//   feedback-free 6-tap delay on the world-SFX bus (tap time 2·d/343 s, level
//   1/d, whole bank at −18 dB), updated at 5 Hz. Standing in the stone circle
//   or against a cliff audibly tightens the space.
//
// Discipline: zero steady-state allocations (pool + reused scratch), all ray
// work throttled/staggered and self-timed (perfMs EMA in debug(), budget
// ≤0.5 ms per worked tick), everything feature-detected — if a node type is
// missing the module degrades gracefully and audio.js's legacy path stands.
// ============================================================================

import {
  terrainHeight, POI, BIOME, biomeAt, clamp, dist2d, makeRng, WORLD_SEED,
} from './core.js';

const POOL_N = 12;          // pooled spatial voices
const ACTIVE_WIN = 6;       // s — a voice slot is "active" this long after acquire
const REF_DIST = 2;
const MAX_DIST = 90;
const OCC_LP_FLOOR = 900;   // Hz — filter frequency fully occluded
const LP_CEIL = 22000;      // Hz — clear
const OCC_DB = -9;          // max occlusion gain dip
const AIR_PER_U = 180;      // Hz of lowpass lost per unit of distance
const ER_MAX = 30;          // u — early-reflection ray reach
const ER_LEVEL = 0.125;     // −18 dB bank level
const SPEED = 343;          // m/s

// Reverb zone specs (index order matters — zoneFor returns these indices).
const ZONES = [
  { name: 'field',   dur: 0.4, density: 0.25, damp: 0.35, send: 0.10, slaps: null,           seed: 0x0ac00f1d },
  { name: 'forest',  dur: 0.9, density: 0.90, damp: 0.12, send: 0.26, slaps: null,           seed: 0x0ac0f04e },
  { name: 'village', dur: 0.7, density: 0.55, damp: 0.30, send: 0.22,
    slaps: [[0.017, 0.6], [0.029, 0.45], [0.043, 0.3]],                                       seed: 0x0ac07172 },
  { name: 'crypt',   dur: 2.8, density: 0.85, damp: 0.05, send: 0.50, slaps: null,           seed: 0x0ac0c821 },
];

export function createAcoustics(g, ctx, worldBus, out) {
  const desktop = !!(g.quality && g.quality.desktop);

  // ---- feature detection ---------------------------------------------------
  let hrtf = false;
  if (desktop && typeof ctx.createPanner === 'function') {
    try {
      const probe = ctx.createPanner();
      probe.panningModel = 'HRTF';
      hrtf = probe.panningModel === 'HRTF';
    } catch (e) { hrtf = false; }
  }
  const stereoOK = typeof ctx.createStereoPanner === 'function';
  const convOK = desktop && typeof ctx.createConvolver === 'function';

  // ---- listener cache (world-space, refreshed at 30 Hz) --------------------
  const lst = { x: 0, y: 10, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, rx: 1, rz: 0 };

  // ---- spatial voice pool --------------------------------------------------
  // Entry graph (HRTF):   input → lowpass → occGain → PannerNode → worldBus
  // Entry graph (stereo): input → distGain → StereoPanner → worldBus
  // Entry graph (mono):   input → distGain → worldBus
  const POOL = [];
  for (let i = 0; i < POOL_N; i++) {
    const input = ctx.createGain();
    const e = {
      input, filter: null, occGain: null, panner: null, sp: null, dGain: null,
      x: 0, y: 0, z: 0, at: -1e9, occ: 0, dist: 0, freq: LP_CEIL,
    };
    if (hrtf) {
      e.filter = ctx.createBiquadFilter();
      e.filter.type = 'lowpass'; e.filter.frequency.value = LP_CEIL; e.filter.Q.value = 0.4;
      e.occGain = ctx.createGain();
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = REF_DIST;
      p.maxDistance = MAX_DIST;
      p.rolloffFactor = 1;
      e.panner = p;
      input.connect(e.filter); e.filter.connect(e.occGain); e.occGain.connect(p); p.connect(worldBus);
    } else if (stereoOK) {
      e.dGain = ctx.createGain();
      e.sp = ctx.createStereoPanner();
      input.connect(e.dGain); e.dGain.connect(e.sp); e.sp.connect(worldBus);
    } else {
      e.dGain = ctx.createGain();
      input.connect(e.dGain); e.dGain.connect(worldBus);
    }
    POOL.push(e);
  }

  function setPannerPos(e) {
    const p = e.panner;
    if (p.positionX) { p.positionX.value = e.x; p.positionY.value = e.y; p.positionZ.value = e.z; }
    else p.setPosition(e.x, e.y, e.z);
  }

  // ---- ray occlusion (terrain march + collider cylinders) ------------------
  function rayOcclusion(sx, sy, sz) {
    const lx = lst.x, ly = lst.y, lz = lst.z;
    let blocked = 0;
    for (let i = 1; i <= 6; i++) {                 // terrain: 6 interior samples
      const k = i / 7;
      const x = lx + (sx - lx) * k;
      const z = lz + (sz - lz) * k;
      const y = ly + (sy - ly) * k;
      if (terrainHeight(x, z) > y + 0.35) blocked++;
    }
    let occ = Math.min(1, blocked / 4);            // 4+/6 buried = fully occluded
    const cols = g.colliders;
    if (cols && cols.length) {
      const abx = sx - lx, abz = sz - lz;
      const ab2 = abx * abx + abz * abz;
      if (ab2 > 1e-6) {
        for (let i = 0; i < cols.length && occ < 1; i++) {
          const c = cols[i];
          const t = ((c.x - lx) * abx + (c.z - lz) * abz) / ab2;
          if (t <= 0.02 || t >= 0.98) continue;    // don't self-block endpoints
          const px = lx + abx * t - c.x;
          const pz = lz + abz * t - c.z;
          if (px * px + pz * pz > c.r * c.r) continue;
          const ry = ly + (sy - ly) * t;           // ray height at the crossing
          if (c.hMax !== undefined && ry > c.hMax) continue;
          if (c.hMin !== undefined && ry < c.hMin - 0.5) continue;
          occ += 0.55;                             // each wall hit muffles hard
        }
      }
    }
    return Math.min(1, occ);
  }

  // Refresh one HRTF entry: occlusion ray + air absorption → filter/gain.
  function updateOcclusion(e, t, snap) {
    const dx = e.x - lst.x, dy = e.y - lst.y, dz = e.z - lst.z;
    e.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    e.occ = rayOcclusion(e.x, e.y, e.z);
    const occF = LP_CEIL + e.occ * (OCC_LP_FLOOR - LP_CEIL);
    const airF = LP_CEIL - e.dist * AIR_PER_U;
    e.freq = clamp(Math.min(occF, airF), 300, LP_CEIL);
    const gv = Math.pow(10, (e.occ * OCC_DB) / 20);
    if (snap) {
      e.filter.frequency.cancelScheduledValues(t);
      e.filter.frequency.value = e.freq;
      e.occGain.gain.cancelScheduledValues(t);
      e.occGain.gain.value = gv;
    } else {
      e.filter.frequency.setTargetAtTime(e.freq, t, 0.09);
      e.occGain.gain.setTargetAtTime(gv, t, 0.09);
    }
  }

  // Refresh one stereo/mono entry: equal-power pan + inverse-distance gain.
  function updateStereo(e, t, snap) {
    const dx = e.x - lst.x, dz = e.z - lst.z;
    e.dist = Math.sqrt(dx * dx + (e.y - lst.y) * (e.y - lst.y) + dz * dz);
    const gv = REF_DIST / Math.max(REF_DIST, e.dist);   // inverse model, ref 2
    if (e.sp) {
      const len = Math.max(0.001, Math.hypot(dx, dz));
      const pan = clamp((dx * lst.rx + dz * lst.rz) / len, -1, 1);
      if (snap) { e.sp.pan.cancelScheduledValues(t); e.sp.pan.value = pan; }
      else e.sp.pan.setTargetAtTime(pan, t, 0.06);
    }
    if (snap) { e.dGain.gain.cancelScheduledValues(t); e.dGain.gain.value = gv; }
    else e.dGain.gain.setTargetAtTime(gv, t, 0.06);
  }

  // ---- acquire: route a positional one-shot through the pool ---------------
  // Returns the entry's input GainNode (audio.js temporarily aims its SFX bus
  // at it) or null when the position is unusable. Reuses the OLDEST entry.
  function acquire(at) {
    if (!at || at.x === undefined || at.z === undefined) return null;
    const t = ctx.currentTime;
    let best = POOL[0];
    for (let i = 1; i < POOL_N; i++) if (POOL[i].at < best.at) best = POOL[i];
    best.at = t;
    best.x = +at.x; best.z = +at.z;
    best.y = at.y !== undefined ? +at.y : terrainHeight(best.x, best.z) + 1;
    if (hrtf) {
      setPannerPos(best);
      updateOcclusion(best, t, true);   // start correctly muffled, not fade-in
    } else {
      updateStereo(best, t, true);
    }
    return best.input;
  }

  // ---- listener sync (30 Hz) ----------------------------------------------
  function syncListener(t) {
    const cam = g.camera;
    if (!cam || !cam.matrixWorld) return;
    const m = cam.matrixWorld.elements;
    lst.x = m[12]; lst.y = m[13]; lst.z = m[14];
    lst.rx = m[0]; lst.rz = m[2];                 // camera right (xz — pan axis)
    lst.fx = -m[8]; lst.fy = -m[9]; lst.fz = -m[10];   // camera forward
    lst.ux = m[4]; lst.uy = m[5]; lst.uz = m[6];       // camera up
    if (hrtf) {
      const L = ctx.listener;
      if (!L) return;
      if (L.positionX) {
        L.positionX.value = lst.x; L.positionY.value = lst.y; L.positionZ.value = lst.z;
        L.forwardX.value = lst.fx; L.forwardY.value = lst.fy; L.forwardZ.value = lst.fz;
        L.upX.value = lst.ux; L.upY.value = lst.uy; L.upZ.value = lst.uz;
      } else {
        L.setPosition(lst.x, lst.y, lst.z);
        L.setOrientation(lst.fx, lst.fy, lst.fz, lst.ux, lst.uy, lst.uz);
      }
    } else {
      // Mobile: refresh pans/gains of recently active voices (cheap math only).
      for (let i = 0; i < POOL_N; i++) {
        const e = POOL[i];
        if (t - e.at < ACTIVE_WIN) updateStereo(e, t, false);
      }
    }
  }

  // ---- reverb zones (4 generated stereo IRs on convolvers) -----------------
  let zsend = null, zconv = null, zoneIdx = 0;
  if (convOK) {
    zsend = []; zconv = [];
    for (let zi = 0; zi < ZONES.length; zi++) {
      const Z = ZONES[zi];
      const conv = ctx.createConvolver();
      conv.buffer = buildIR(Z);
      const send = ctx.createGain();
      send.gain.value = zi === zoneIdx ? Z.send : 0;
      const ret = ctx.createGain(); ret.gain.value = 0.8;
      worldBus.connect(send); send.connect(conv); conv.connect(ret); ret.connect(out);
      zsend.push(send); zconv.push(conv);
    }
  }

  // Seeded stereo noise-decay impulse response (−60 dB at Z.dur).
  function buildIR(Z) {
    const sr = ctx.sampleRate;
    const len = Math.max(sr * 0.05, (sr * Z.dur) | 0);
    const buf = ctx.createBuffer(2, len, sr);
    const rng = makeRng((WORLD_SEED ^ Z.seed) >>> 0);
    const k = 6.91 / Z.dur;                        // exp decay rate
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        let s = rng() * 2 - 1;
        if (Z.density < 1 && rng() > Z.density) s = 0;      // sparse scatter
        lp += Z.damp * (s - lp);                             // highs damping
        d[i] = lp * Math.exp(-(i / sr) * k);
      }
      if (Z.slaps) {                               // distinct early slaps
        for (let si = 0; si < Z.slaps.length; si++) {
          const idx = ((Z.slaps[si][0] * sr) | 0) + ch * 11; // L/R decorrelate
          if (idx < len) d[idx] += Z.slaps[si][1] * (ch ? 0.85 : 1);
        }
      }
    }
    return buf;
  }

  // Zone from player location (crypt beats village beats forest beats field).
  function zoneFor(px, pz) {
    if (dist2d(px, pz, POI.ruins.x, POI.ruins.z) < 18) return 3;   // crypt interior
    if (dist2d(px, pz, POI.village.x, POI.village.z) < POI.village.r) return 2;
    if (biomeAt(px, pz) === BIOME.FOREST) return 1;
    return 0;
  }

  function pollZone(t) {
    if (!zsend) return;
    const p = g.player;
    if (!p || !p.position) return;
    const zi = zoneFor(p.position.x, p.position.z);
    if (zi === zoneIdx) return;
    zoneIdx = zi;
    for (let i = 0; i < ZONES.length; i++) {       // ~2 s crossfade (τ 0.66)
      zsend[i].gain.setTargetAtTime(i === zi ? ZONES[i].send : 0.0001, t, 0.66);
    }
  }

  // ---- early reflections (6 rays → feedback-free multitap delay) -----------
  let erTaps = null;
  const ER_DX = new Float64Array(6), ER_DZ = new Float64Array(6);
  for (let i = 0; i < 6; i++) {
    ER_DX[i] = Math.cos((i * Math.PI) / 3);
    ER_DZ[i] = Math.sin((i * Math.PI) / 3);
  }
  if (desktop && typeof ctx.createDelay === 'function') {
    erTaps = [];
    const erIn = ctx.createGain(); erIn.gain.value = ER_LEVEL;   // −18 dB bank
    worldBus.connect(erIn);
    for (let i = 0; i < 6; i++) {
      const dl = ctx.createDelay(0.25);
      dl.delayTime.value = 0.03;
      const tg = ctx.createGain(); tg.gain.value = 0;
      erIn.connect(dl); dl.connect(tg); tg.connect(out);
      erTaps.push({ delay: dl, gain: tg, dist: 0 });
    }
  }

  function updateER(t) {
    if (!erTaps) return;
    const cols = g.colliders;
    for (let i = 0; i < 6; i++) {
      const dx = ER_DX[i], dz = ER_DZ[i];
      let hitD = 0;
      for (let s = 2; s <= ER_MAX; s += 2) {       // terrain march (cliffs, hills)
        if (terrainHeight(lst.x + dx * s, lst.z + dz * s) > lst.y + 0.8) { hitD = s; break; }
      }
      if (cols && cols.length) {                   // exact ray-circle vs colliders
        for (let ci = 0; ci < cols.length; ci++) {
          const c = cols[ci];
          const relx = c.x - lst.x, relz = c.z - lst.z;
          const proj = relx * dx + relz * dz;
          if (proj <= 0.5 || proj > ER_MAX) continue;
          const perp2 = relx * relx + relz * relz - proj * proj;
          if (perp2 > c.r * c.r) continue;
          if (c.hMax !== undefined && lst.y > c.hMax) continue;
          if (c.hMin !== undefined && lst.y < c.hMin - 0.5) continue;
          const dh = proj - Math.sqrt(Math.max(0, c.r * c.r - perp2));
          if (dh > 0.5 && (hitD === 0 || dh < hitD)) hitD = dh;
        }
      }
      const tap = erTaps[i];
      tap.dist = hitD;
      if (hitD > 0) {
        tap.delay.delayTime.setTargetAtTime((2 * hitD) / SPEED, t, 0.12);
        tap.gain.gain.setTargetAtTime(Math.min(1, REF_DIST / hitD), t, 0.12);  // 1/dist
      } else {
        tap.gain.gain.setTargetAtTime(0.0001, t, 0.15);
      }
    }
  }

  // ---- throttled update (driven from audio.js's update) --------------------
  let nextLst = 0, nextOcc = 0, nextER = 0, nextZone = 0, occCursor = 0;
  let perfMs = 0;                                  // EMA of ray-work ms per worked tick

  function update(tw) {
    if (tw >= nextLst) { nextLst = tw + 1 / 30; syncListener(tw); }
    if (!desktop) return;                          // mobile: pan-only path above
    let worked = false;
    const t0 = performance.now();
    if (hrtf && tw >= nextOcc) {                   // 10 Hz, ≤4 sources, staggered
      nextOcc = tw + 0.1;
      let updated = 0;
      for (let n = 0; n < POOL_N && updated < 4; n++) {
        occCursor = (occCursor + 1) % POOL_N;
        const e = POOL[occCursor];
        if (tw - e.at > ACTIVE_WIN) continue;
        updateOcclusion(e, tw, false);
        updated++;
        worked = true;
      }
    }
    if (tw >= nextER) { nextER = tw + 0.2; updateER(tw); worked = true; }     // 5 Hz
    if (tw >= nextZone) { nextZone = tw + 0.5; pollZone(tw); worked = true; } // 2 Hz
    if (worked) perfMs = perfMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  // ---- debug snapshot (verification only — allocation here is fine) --------
  function debug() {
    const t = ctx.currentTime;
    let active = 0;
    const entries = [];
    for (let i = 0; i < POOL_N; i++) {
      const e = POOL[i];
      const isActive = t - e.at < ACTIVE_WIN;
      if (isActive) active++;
      entries.push({
        active: isActive, x: e.x, y: e.y, z: e.z,
        occ: +e.occ.toFixed(3), dist: +e.dist.toFixed(2), freq: Math.round(e.freq),
        filterF: e.filter ? Math.round(e.filter.frequency.value) : 0,
        occG: e.occGain ? +e.occGain.gain.value.toFixed(3)
          : (e.dGain ? +e.dGain.gain.value.toFixed(3) : 1),
        pan: e.sp ? +e.sp.pan.value.toFixed(3)
          : (e.panner && e.panner.positionX ? null : null),
      });
    }
    return {
      mode: hrtf ? 'hrtf' : (stereoOK ? 'stereo' : 'mono'),
      desktop,
      active,
      entries,
      listener: {
        x: +lst.x.toFixed(2), y: +lst.y.toFixed(2), z: +lst.z.toFixed(2),
        fx: +lst.fx.toFixed(3), fy: +lst.fy.toFixed(3), fz: +lst.fz.toFixed(3),
      },
      zone: zsend ? ZONES[zoneIdx].name : null,
      zoneSends: zsend ? zsend.map((s) => +s.gain.value.toFixed(4)) : null,
      er: erTaps
        ? erTaps.map((tp) => ({
            dist: +tp.dist.toFixed(1),
            delay: +tp.delay.delayTime.value.toFixed(4),
            gain: +tp.gain.gain.value.toFixed(4),
          }))
        : null,
      perfMs: +perfMs.toFixed(4),
    };
  }

  return { acquire, update, debug, spatial: hrtf || stereoOK };
}

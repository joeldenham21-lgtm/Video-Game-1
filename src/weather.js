// ============================================================================
// ELDERFALL — weather.js
// Seeded persistent weather fronts (clear / overcast / rain / storm), pooled
// rain streaks + ground splash rings in a camera-following box with g.wind
// shear, storm lightning (sky-flash overlay + distance-delayed thunder +
// occasional far jagged bolt), and smooth 8 s transitions.
//
// Sky coupling WITHOUT touching sky.js: weather.update runs AFTER sky.update
// in main's loop (verified: sky is updated 3rd, weather after forge), so each
// frame we read the fog near/far that sky just wrote and pull both in by up
// to 35 %, and we modulate renderer.toneMappingExposure ×(1 − 0.25·intensity)
// from a base captured on the first frame. Both writes are re-derived every
// frame from sky's fresh values — nothing compounds — and at intensity 0 the
// math is exactly ×1, so a clear day is identical to the pre-weather path.
// postfx's OutputPass re-reads toneMappingExposure per frame, so the dim (and
// the lightning exposure kick) works identically on ultra and mobile tiers.
//
// Fronts are a pure function of (dayCount, segment-of-day) via core.makeRng —
// deterministic, save-stable (dayCount/dayFrac persist in flags/save), and
// robust to dayFrac jumps (photo-mode time scrub, fast travel). Odds per the
// NEXT-LEVEL contract: clear 55 % / overcast 20 % / rain 17 % / storm 8 %.
// Front length: the contract's "20–40 game-minutes" is 10–20 real seconds at
// dayLength = 720 s — shorter than the mandated 8 s crossfade — so a front
// holds for one 1/8-day segment (3 game-hours ≈ 90 real seconds): several
// distinct, stable fronts per game day, which is the evident intent.
//
// Blood moons (g.flags.bloodMoon set by enemies.js while the horde is out)
// force 'clear' so rain never fights the red mood.
//
// Exposes g.weather.state ('clear'|'overcast'|'rain'|'storm') + .intensity
// (0..1, smoothed) for other systems, plus force(state|null, snap) and
// strike() debug/test helpers. Calls g.audio.setRain?.(level) lazily.
// Zero per-frame allocations: every buffer/vector/matrix is preallocated.
// ============================================================================

import * as THREE from 'three';
import { clamp, lerp, makeRng, terrainHeight, WATER_LEVEL, WORLD_SEED } from './core.js';

const SEGS = 8;          // fronts per day (1 segment = 3 game-hours ≈ 90 s real)
const FADE = 1 / 8;      // transition speed: full 0→1 swing in 8 s

// Per-state targets. i = mood intensity (exposure dim, fog pull-in);
// r = rain amount — 0.625 for rain so storm (1.0) is rain ×1.6 per contract.
const TARGET = {
  clear:    { i: 0.00, r: 0 },
  overcast: { i: 0.40, r: 0 },
  rain:     { i: 0.75, r: 0.625 },
  storm:    { i: 1.00, r: 1.0 },
};

// Seeded front for a given (day index, segment-of-day index). Uses makeRng
// (mulberry32) as the mixer — hash2's float bit-mixing is badly biased for
// small sequential strides (measured: 32/32 samples < 0.5), while mulberry
// avalanches properly (measured 55.5/19.7/17.3/7.5 % over 3200 segments).
function frontAt(dayIx, segIx) {
  const key = (dayIx * 8 + segIx) >>> 0;
  const r = makeRng((WORLD_SEED * 2654435761 + key * 40503) >>> 0)();
  if (r < 0.55) return 'clear';
  if (r < 0.75) return 'overcast';
  if (r < 0.92) return 'rain';
  return 'storm';
}

const moveToward = (v, t, step) =>
  v < t ? Math.min(t, v + step) : Math.max(t, v - step);

export function createWeather(g) {
  // ==========================================================================
  // Rain streak pool — one indexed Mesh of MAX stretched quads in a BOX-unit
  // cube that follows the camera (positions wrap camera-relative on all axes).
  // ==========================================================================
  const MAX = g.quality.tier === 'low' ? 240 : 400;
  const HALF = 12, BOX = 24;      // 24 u box around the camera
  const FALL = 18;                // base fall speed u/s

  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const gy = new Float32Array(MAX);   // cached ground height under each streak
  const spd = new Float32Array(MAX);  // per-streak fall-speed jitter
  {
    // makeRng, NOT hash2: hash2's float mixing is badly biased for small
    // sequential inputs (measured: never leaves [0,0.5) here, which clumped
    // every streak into one box quadrant — and the wrap preserves clumps).
    const rng = makeRng(WORLD_SEED ^ 0x9001);
    for (let i = 0; i < MAX; i++) {
      px[i] = (rng() - 0.5) * BOX;
      py[i] = (rng() - 0.5) * BOX;
      pz[i] = (rng() - 0.5) * BOX;
      gy[i] = -1e9;                   // sentinel: unknown, refreshed on wrap
      spd[i] = 0.85 + rng() * 0.3;
    }
  }

  // Streaks are stretched QUADS, not GL_LINES: 1 px hairlines are near
  // invisible at speed (and some rasterizers dash/drop them — measured on
  // SwiftShader), while thin camera-facing quads read everywhere and give a
  // controllable width. 4 verts + 6 indices per streak, index built once.
  const posArr = new Float32Array(MAX * 12);
  const rainGeom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  rainGeom.setAttribute('position', posAttr);
  {
    const idx = new Uint16Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 2; idx[o + 2] = v + 1;
      idx[o + 3] = v + 1; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    rainGeom.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  rainGeom.setDrawRange(0, 0);
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0x9db4c6, transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rain = new THREE.Mesh(rainGeom, rainMat);
  rain.name = 'weatherRain';
  rain.frustumCulled = false;
  rain.visible = false;
  rain.renderOrder = 2;
  g.scene.add(rain);
  const _view = new THREE.Vector3();   // camera forward (billboard basis)

  // ==========================================================================
  // Splash ring pool — one InstancedMesh, rings grow + vanish over 0.5 s.
  // ==========================================================================
  const RINGS = 30, RING_LIFE = 0.5;
  const ringGeom = new THREE.RingGeometry(0.11, 0.155, 10);
  ringGeom.rotateX(-Math.PI / 2);      // lie flat on the ground
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xaec6d4, transparent: true, opacity: 0.42, depthWrite: false,
  });
  const rings = new THREE.InstancedMesh(ringGeom, ringMat, RINGS);
  rings.name = 'weatherRings';
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.frustumCulled = false;
  rings.visible = false;
  rings.renderOrder = 2;
  const ringAge = new Float32Array(RINGS).fill(9);   // 9 = dead + matrix zeroed
  const ringPos = new Float32Array(RINGS * 3);
  let ringIx = 0;
  const _m = new THREE.Matrix4();
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < RINGS; i++) rings.setMatrixAt(i, _m);
  g.scene.add(rings);

  function spawnRing(x, y, z) {
    const cam = g.camera.position;
    const hx = x - cam.x, hz = z - cam.z;
    if (hx * hx + hz * hz > 400) return;      // only splashes within 20 u
    if (Math.random() > 0.6) return;          // thin the churn on the pool
    const i = ringIx; ringIx = (ringIx + 1) % RINGS;
    ringAge[i] = 0;
    ringPos[i * 3] = x; ringPos[i * 3 + 1] = y + 0.03; ringPos[i * 3 + 2] = z;
  }

  // ==========================================================================
  // Lightning — far jagged bolt (prebuilt buffers, regenerated in place per
  // strike) + fullscreen flash overlay (DOM, mix-blend screen, under the HUD
  // at z-index 9) + distance-delayed thunder via g.audio.
  // ==========================================================================
  // The bolt is quads too (one axially-billboarded quad per jag segment) so
  // it reads BOLD at 70–220 u — GL_LINES would be a 1 px thread out there.
  const BOLT_PTS = 11, FORK_PTS = 5;
  const BOLT_SEGS = (BOLT_PTS - 1) + (FORK_PTS - 1);
  const boltArr = new Float32Array(BOLT_SEGS * 12);
  const boltGeom = new THREE.BufferGeometry();
  const boltAttr = new THREE.BufferAttribute(boltArr, 3);
  boltAttr.setUsage(THREE.DynamicDrawUsage);
  boltGeom.setAttribute('position', boltAttr);
  {
    const idx = new Uint16Array(BOLT_SEGS * 6);
    for (let i = 0; i < BOLT_SEGS; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 2; idx[o + 2] = v + 1;
      idx[o + 3] = v + 1; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    boltGeom.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const boltMat = new THREE.MeshBasicMaterial({
    color: 0xd8e8ff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  });
  const bolt = new THREE.Mesh(boltGeom, boltMat);
  bolt.name = 'weatherBolt';
  bolt.frustumCulled = false;
  bolt.visible = false;
  bolt.renderOrder = 3;
  g.scene.add(bolt);
  const pts = new Float32Array((BOLT_PTS + FORK_PTS) * 3);  // strike scratch

  // One axially-billboarded quad from A to B, half-width hw, into boltArr.
  function boltQuad(qi, ax, ay, az, bx, by, bz, hw) {
    const cam = g.camera.position;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const tx = cam.x - ax, ty = cam.y - ay, tz = cam.z - az;
    let sx = dy * tz - dz * ty, sy = dz * tx - dx * tz, sz = dx * ty - dy * tx;
    const sl = Math.hypot(sx, sy, sz);
    if (sl > 1e-5) { sx = sx / sl * hw; sy = sy / sl * hw; sz = sz / sl * hw; }
    else { sx = hw; sy = 0; sz = 0; }
    const o = qi * 12;
    boltArr[o] = ax - sx;     boltArr[o + 1] = ay - sy;      boltArr[o + 2] = az - sz;
    boltArr[o + 3] = ax + sx; boltArr[o + 4] = ay + sy;      boltArr[o + 5] = az + sz;
    boltArr[o + 6] = bx - sx; boltArr[o + 7] = by - sy;      boltArr[o + 8] = bz - sz;
    boltArr[o + 9] = bx + sx; boltArr[o + 10] = by + sy;     boltArr[o + 11] = bz + sz;
  }

  const flashEl = document.createElement('div');
  flashEl.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9;opacity:0;' +
    'mix-blend-mode:screen;will-change:opacity;' +
    'background:radial-gradient(ellipse at 50% -10%,#e6efff 0%,#9fb6d9 45%,#3d4f6b 100%);';
  document.body.appendChild(flashEl);

  let flashT = 99;      // seconds since last strike (drives flash envelope)
  let flashK = 0;       // per-strike flash strength
  let boltAge = 99;     // seconds since bolt became visible
  let boltT = 99;       // countdown to next strike while storming
  let wasStorming = false;
  let lastOp = 0;       // last opacity written to the DOM (write only on change)

  function strike() {
    const cam = g.camera.position;
    const dist = 70 + Math.random() * 150;
    // Bias strikes toward where the player is looking (±55°) most of the
    // time — a bolt you can actually SEE is worth ten behind your back.
    let a;
    if (Math.random() < 0.65) {
      g.camera.getWorldDirection(_view);
      a = Math.atan2(_view.x, _view.z) + (Math.random() - 0.5) * 1.9;
    } else a = Math.random() * Math.PI * 2;
    const bx = cam.x + Math.sin(a) * dist;
    const bz = cam.z + Math.cos(a) * dist;
    const gnd = Math.max(terrainHeight(bx, bz), WATER_LEVEL);
    const top = cam.y + 85 + Math.random() * 45;
    // Main channel: jagged descent, jitter widest mid-channel, exact endpoints.
    for (let k = 0; k < BOLT_PTS; k++) {
      const u = k / (BOLT_PTS - 1);
      const amp = 30 * u * (1 - u) * (0.6 + Math.random());
      pts[k * 3] = bx + (Math.random() - 0.5) * amp;
      pts[k * 3 + 1] = lerp(top, gnd, u) + (k === 0 || k === BOLT_PTS - 1 ? 0 : (Math.random() - 0.5) * 4);
      pts[k * 3 + 2] = bz + (Math.random() - 0.5) * amp;
    }
    // Fork: branches off mid-channel, dies out in the air.
    const fb = 5 * 3;
    const fa = Math.random() * Math.PI * 2;
    const fdx = Math.sin(fa), fdz = Math.cos(fa);
    pts[BOLT_PTS * 3] = pts[fb]; pts[BOLT_PTS * 3 + 1] = pts[fb + 1]; pts[BOLT_PTS * 3 + 2] = pts[fb + 2];
    for (let k = 1; k < FORK_PTS; k++) {
      const j = (BOLT_PTS + k) * 3;
      pts[j] = pts[fb] + fdx * k * 5 + (Math.random() - 0.5) * 5;
      pts[j + 1] = pts[fb + 1] - k * 8 * (0.6 + Math.random() * 0.5);
      pts[j + 2] = pts[fb + 2] + fdz * k * 5 + (Math.random() - 0.5) * 5;
    }
    // Point list → billboarded quad per segment (main channel wider than fork).
    let qi = 0;
    for (let k = 0; k < BOLT_PTS - 1; k++, qi++) {
      const p0 = k * 3, p1 = (k + 1) * 3;
      boltQuad(qi, pts[p0], pts[p0 + 1], pts[p0 + 2], pts[p1], pts[p1 + 1], pts[p1 + 2], 0.28);
    }
    for (let k = 0; k < FORK_PTS - 1; k++, qi++) {
      const p0 = (BOLT_PTS + k) * 3, p1 = (BOLT_PTS + k + 1) * 3;
      boltQuad(qi, pts[p0], pts[p0 + 1], pts[p0 + 2], pts[p1], pts[p1 + 1], pts[p1 + 2], 0.16);
    }
    boltAttr.needsUpdate = true;
    boltAge = 0;   // every strike shows its bolt — the flash alone read as a bug
    flashT = 0;
    flashK = 0.42 + Math.random() * 0.25;
    // Thunder arrives late by distance (0.5–3 s-ish), speed-of-sound feel.
    const delay = 0.5 + 2.4 * clamp((dist - 60) / 160, 0, 1) + Math.random() * 0.3;
    if (g.audio && g.audio.play) g.audio.play('thunder', { delay });
  }

  // ==========================================================================
  // Front selection + public state
  // ==========================================================================
  let forced = null;      // debug/test override
  let frontKey = -1;      // cached (day, segment) → front (frontAt allocates
  let frontCache = 'clear'; // an rng closure, so only call it on seg change)
  function currentFront() {
    if (g.flags.bloodMoon) return 'clear';   // never fight the blood-red mood
    if (forced) return forced;
    const dayIx = g.flags.dayCount | 0;
    let f = g.time.dayFrac;
    if (!(f >= 0)) f = 0;
    const segIx = Math.min(SEGS - 1, (f * SEGS) | 0);
    const key = dayIx * 8 + segIx;
    if (key !== frontKey) { frontKey = key; frontCache = frontAt(dayIx, segIx); }
    return frontCache;
  }

  function force(state, snap) {
    forced = state || null;
    if (snap) {
      const t = TARGET[currentFront()];
      ii = t.i; rr = t.r;
    }
  }

  let ii = -1;          // smoothed intensity (−1 = snap to target on 1st frame)
  let rr = -1;          // smoothed rain amount
  let baseExp = -1;     // renderer exposure base, captured on first update
  let sendT = 0, lastSent = -1;   // g.audio.setRain throttle

  // ==========================================================================
  // update — runs AFTER sky.update each frame (see main.js order)
  // ==========================================================================
  function update(dt) {
    const cam = g.camera.position;

    // --- front + 8 s eased levels -------------------------------------------
    const front = currentFront();
    api.state = front;
    const t = TARGET[front];
    if (ii < 0) { ii = t.i; rr = t.r; }   // boot/load: start at the live front
    ii = moveToward(ii, t.i, dt * FADE);
    rr = moveToward(rr, t.r, dt * FADE);
    api.intensity = ii;

    // --- lightning scheduling (storm only, freezes while paused) -------------
    const storming = front === 'storm' && rr > 0.5;
    if (storming && !wasStorming) boltT = 2.5 + Math.random() * 6; // first crack soon
    wasStorming = storming;
    if (storming && !g.paused) {
      boltT -= dt;
      if (boltT <= 0) { boltT = 6 + Math.random() * 12; strike(); }
    }

    // --- flash envelope: 80 ms main flash, dip, then a softer echo -----------
    flashT += dt;
    let op = 0;
    if (flashT < 0.30) {
      if (flashT < 0.02) op = flashK * (flashT / 0.02);
      else if (flashT < 0.08) op = flashK * (1 - 0.8 * (flashT - 0.02) / 0.06);
      else if (flashT < 0.16) op = flashK * 0.10;
      else op = flashK * 0.45 * (1 - (flashT - 0.16) / 0.14);
    }
    if (Math.abs(op - lastOp) > 0.012 || (op === 0 && lastOp !== 0)) {
      lastOp = op;
      flashEl.style.opacity = op === 0 ? '0' : op.toFixed(3);
    }
    boltAge += dt;
    bolt.visible = boltAge < 0.28 && (boltAge < 0.12 || boltAge > 0.17); // flicker, long enough to land on screen

    // --- sky coupling: exposure dim + fog pull-in (AFTER sky wrote them) -----
    const r = g.renderer;
    if (baseExp < 0) baseExp = r.toneMappingExposure;
    r.toneMappingExposure = baseExp * (1 - 0.25 * ii) * (1 + op * 1.5);
    const fog = g.scene.fog;
    if (fog) {
      const fp = 1 - 0.35 * ii;   // up to 35 % pull-in at full storm
      fog.near *= fp;
      fog.far *= fp;
    }

    // --- rain streaks ---------------------------------------------------------
    const activeN = Math.round(MAX * rr);   // storm = rain ×1.6 streak count
    if (activeN > 0) {
      rain.visible = true;
      rainMat.opacity = 0.26 + 0.22 * rr;   // quads: subtle veil, denser in storm
      // Wind shear (shared by all streaks; details.js owns g.wind)
      const wind = g.wind;
      let shx = 0.8, shz = 0.8;
      if (wind) {
        const s = 1.5 + wind.gust * 6.5;
        shx = wind.dir.x * s; shz = wind.dir.z * s;
      }
      const fall = FALL * (0.9 + rr * 0.3);
      // Shared streak vector: along the velocity, longer in heavy rain
      const len = 0.55 + 0.55 * Math.min(1, rr * 1.6);
      const im = len / Math.hypot(shx, fall, shz);
      const ox = shx * im, oy = -fall * im, oz = shz * im;
      // Shared billboard side vector: cross(streak dir, camera forward),
      // scaled to the half-width. Degenerate (looking straight along the
      // fall) → fall back to the camera's world right axis.
      g.camera.getWorldDirection(_view);
      let bx = oy * _view.z - oz * _view.y;
      let by = oz * _view.x - ox * _view.z;
      let bz = ox * _view.y - oy * _view.x;
      const bl = Math.hypot(bx, by, bz);
      const HW = 0.017;
      if (bl > 1e-5) { bx = bx / bl * HW; by = by / bl * HW; bz = bz / bl * HW; }
      else {
        const me = g.camera.matrixWorld.elements;
        bx = me[0] * HW; by = me[1] * HW; bz = me[2] * HW;
      }
      const cx = cam.x, cy = cam.y, cz = cam.z;
      const mx = shx * dt, mz = shz * dt, my = fall * dt;
      for (let i = 0; i < activeN; i++) {
        let x = px[i] + mx, z = pz[i] + mz, y = py[i] - my * spd[i];
        let rewrap = false;
        // camera-relative wrap keeps the box centred without pops
        const dx = x - cx;
        if (dx < -HALF || dx >= HALF) { x = cx + (dx - Math.floor((dx + HALF) / BOX) * BOX); rewrap = true; }
        const dz = z - cz;
        if (dz < -HALF || dz >= HALF) { z = cz + (dz - Math.floor((dz + HALF) / BOX) * BOX); rewrap = true; }
        const ground = gy[i];
        if (y < ground) {
          // hit the ground: splash, then respawn at the TOP of the box (a
          // plain += BOX would overshoot the box top whenever the ground sits
          // above the box floor and the top-wrap would slam it straight back)
          if (ground > cy - HALF && ground < cy + 6) spawnRing(x, ground, z);
          y = cy + HALF - Math.random() * 2;
          x += (Math.random() - 0.5) * 3; z += (Math.random() - 0.5) * 3;
          rewrap = true;
        } else if (y < cy - HALF) { y += BOX; rewrap = true; }
        else if (y >= cy + HALF) { y -= BOX; rewrap = true; }
        if (rewrap) {
          const h = Math.max(terrainHeight(x, z), WATER_LEVEL) + 0.05;
          // spawn column entirely inside a hill → fall through silently
          gy[i] = h > cy + HALF - 1 ? -1e9 : h;
        }
        px[i] = x; py[i] = y; pz[i] = z;
        // stretched quad: (top ∓ side), (bottom ∓ side)
        const w = i * 12;
        const qx = x + ox, qy = y + oy, qz = z + oz;
        posArr[w]     = x - bx;  posArr[w + 1]  = y - by;  posArr[w + 2]  = z - bz;
        posArr[w + 3] = x + bx;  posArr[w + 4]  = y + by;  posArr[w + 5]  = z + bz;
        posArr[w + 6] = qx - bx; posArr[w + 7]  = qy - by; posArr[w + 8]  = qz - bz;
        posArr[w + 9] = qx + bx; posArr[w + 10] = qy + by; posArr[w + 11] = qz + bz;
      }
      rainGeom.setDrawRange(0, activeN * 6);   // indices
      posAttr.needsUpdate = true;
    } else if (rain.visible) {
      rain.visible = false;
      rainGeom.setDrawRange(0, 0);
    }

    // --- splash rings ----------------------------------------------------------
    if (activeN > 0 || rings.visible) {
      let alive = 0;
      for (let i = 0; i < RINGS; i++) {
        let a = ringAge[i];
        if (a >= RING_LIFE) {
          if (a < 9) { _m.makeScale(0, 0, 0); rings.setMatrixAt(i, _m); ringAge[i] = 9; }
          continue;
        }
        a += dt; ringAge[i] = a;
        const u = a / RING_LIFE;
        const s = 0.3 + u * 4.2;
        _m.makeScale(s, 1, s);
        _m.setPosition(ringPos[i * 3], ringPos[i * 3 + 1], ringPos[i * 3 + 2]);
        rings.setMatrixAt(i, _m);
        alive++;
      }
      rings.instanceMatrix.needsUpdate = true;
      rings.visible = alive > 0;
    }

    // --- rain audio bed (lazy — MUSIC agent adds setRain) -----------------------
    sendT -= dt;
    if (sendT <= 0) {
      sendT = 0.3;
      if (Math.abs(rr - lastSent) > 0.003) {
        lastSent = rr;
        g.audio.setRain?.(rr);   // rain 0.625, storm 1.0 (rumble kicks in >0.7)
      }
    }
  }

  const api = { update, state: 'clear', intensity: 0, force, strike };
  return api;
}

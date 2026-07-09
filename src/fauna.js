// ============================================================================
// ELDERFALL — fauna.js
// Ambient life: the world must feel ALIVE.
//  - Bird flocks: boid-lite loops, perch in real trees at dawn/dusk, burst
//    from the canopy when the player gets close (or a fight breaks out).
//  - Butterflies: day-only, anchored to actual meadow flowers, pair-chasing.
//  - Fireflies: night-only additive pulse-glow, drift, dodge the torch light;
//    a synchronized "wave" surge at dusk makes the village edge magical.
//  - Mirrormere fish: expanding ripple rings + jumping fish arcs (more at
//    dawn/dusk), splash sound when close.
//  - Forest leaf-fall, golden-hour pollen motes, meadow dandelion-seed gusts.
// Techniques: everything pooled + instanced (≤8 draw calls total), distance
// culled to a ≤120u bubble around the player, steering AI throttled to 10 Hz
// (per-frame work is only integration + matrix writes), biome/time-of-day
// gated with smooth fades. Purely atmospheric — zero gameplay coupling.
// Bird/butterfly anchor points replicate world.js's deterministic hash2
// scatter, so birds perch on REAL rendered trees and butterflies hover over
// REAL flowers without importing world.js.
// Only imports 'three' + './core.js'. Zero per-frame allocations in update().
// ============================================================================
import * as THREE from 'three';
import {
  WATER_LEVEL, POIS, POI, BIOME, biomeAt, terrainHeight, hash2,
  clamp, lerp, smoothstep, dist2d,
} from './core.js';

const TAU = Math.PI * 2;
const AI_DT = 0.1;              // 10 Hz steering / spawner tick
const BUBBLE = 120;             // hard ambient-life radius (u)

// ---- module-scope scratch (zero per-frame allocations) ---------------------
const _v1 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

// Smooth on/off window: 0 → 1 over [a,b], 1 → 0 over [c,d].
function win(f, a, b, c, d) {
  return smoothstep(a, b, f) * (1 - smoothstep(c, d, f));
}

// POIs that flatten terrain (same set world.js uses to exclude vegetation).
const FLAT_POIS = POIS.filter((p) => p.flatten && p.r > 0);
function insidePOI(wx, wz) {
  for (let i = 0; i < FLAT_POIS.length; i++) {
    const p = FLAT_POIS[i];
    if (dist2d(wx, wz, p.x, p.z) < p.r + 4) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deterministic replication of world.js scatter (same hash seeds) so ambient
// life anchors to vegetation that is actually rendered.
// ---------------------------------------------------------------------------
// Tree cell = 16u, first attempt (s0 = 70). Returns true + fills `out` with
// {x, y(top base), z, r(perch radius), top(perch height)} when the cell holds
// a tree.
function treeAtCell(cx, cz, out) {
  const wx = (cx + hash2(cx, cz, 71)) * 16;
  const wz = (cz + hash2(cx, cz, 72)) * 16;
  const h = terrainHeight(wx, wz);
  if (h < WATER_LEVEL + 1.2 || h > 104) return false;
  if (insidePOI(wx, wz)) return false;
  const bio = biomeAt(wx, wz, h);
  let density = 0, pinePref = 0.5;
  if (bio === BIOME.FOREST) { density = 0.93; pinePref = 0.66; }
  else if (bio === BIOME.MEADOW) { density = 0.09; pinePref = 0.2; }
  else if (bio === BIOME.ROCKY) { density = 0.17; pinePref = 1; }
  else if (bio === BIOME.SNOW) { density = 0.06; pinePref = 1; }
  else if (bio === BIOME.MARSH) { density = 0.10; pinePref = 0.1; }
  if (density === 0 || hash2(cx, cz, 73) >= density) return false;
  if (Math.abs(terrainHeight(wx + 2.4, wz + 2.4) - h) > 2.3) return false;
  const hs = hash2(cx, cz, 74);
  const hj = hash2(cx, cz, 76);
  out.x = wx; out.z = wz;
  if (hash2(cx, cz, 77) < pinePref) {          // pine: perch near the tip
    const s = 0.75 + hs * 0.85;
    const sy = s * (0.9 + hj * 0.35);
    out.top = (h - 0.25) + 5.45 * sy;
    out.r = 0.55 * s;
  } else {                                     // oak: perch on the canopy
    const s = 0.7 + hs * 0.75;
    const sy = s * (0.85 + hj * 0.3);
    out.top = (h - 0.2) + 3.65 * sy;
    out.r = 1.25 * s;
  }
  return true;
}

// Flower cell = 6u (world.js fillFlowerCell seeds 171–176). Fills out{x,y,z}.
function flowerAtCell(cx, cz, out) {
  const wx = (cx + hash2(cx, cz, 171)) * 6;
  const wz = (cz + hash2(cx, cz, 172)) * 6;
  const h = terrainHeight(wx, wz);
  if (h < WATER_LEVEL + 1.2 || h > 60) return false;
  const bio = biomeAt(wx, wz, h);
  const density = bio === BIOME.MEADOW ? 0.36 : bio === BIOME.FOREST ? 0.07 : 0;
  if (!density || hash2(cx, cz, 173) >= density) return false;
  if (insidePOI(wx, wz)) return false;
  out.x = wx; out.y = h; out.z = wz;
  return true;
}

// Spiral cell offsets (nearest first) for the flock perch-tree scan.
const TREE_SCAN = (() => {
  const arr = [];
  for (let dz = -6; dz <= 6; dz++)
    for (let dx = -6; dx <= 6; dx++)
      if (dx * dx + dz * dz <= 40) arr.push([dx, dz, dx * dx + dz * dz]);
  arr.sort((a, b) => a[2] - b[2]);
  return arr;
})();

// ---------------------------------------------------------------------------
// Tiny shared radial-gradient sprite (soft round glow) for the Points systems
// — square un-textured GL points would ruin fireflies/pollen.
// ---------------------------------------------------------------------------
function makeGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry builders (init-time only)
// ---------------------------------------------------------------------------
// Bird: two triangles forming a shallow "V" (body axis +x). Wing flap is done
// per-instance by animating the Y scale, which flattens/steepens the V.
function buildBirdGeom() {
  const P = new Float32Array([
    // left wing
    0.30, 0.02, 0, -0.24, 0, -0.05, -0.04, 0.16, -0.66,
    // right wing
    0.30, 0.02, 0, -0.04, 0.16, 0.66, -0.24, 0, 0.05,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.computeVertexNormals();
  return geo;
}

// Butterfly: two wing quads spanning ±z (body axis +x). Flap = Z scale.
function buildButterflyGeom() {
  const w = 0.16, l = 0.13;
  const P = new Float32Array([
    // left wing (two tris)
    0.06, 0, 0, -0.06, 0, 0, -l, 0.02, -w,
    0.06, 0, 0, -l, 0.02, -w, l * 0.7, 0.02, -w * 0.9,
    // right wing
    0.06, 0, 0, -l, 0.02, w, -0.06, 0, 0,
    0.06, 0, 0, l * 0.7, 0.02, w * 0.9, -l, 0.02, w,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.computeVertexNormals();
  return geo;
}

// Fish: elongated dark sliver (octahedron squashed), axis +x.
function buildFishGeom() {
  const geo = new THREE.OctahedronGeometry(0.5, 0);
  geo.scale(1, 0.28, 0.18);
  return geo;
}

// ============================================================================
// createFauna
// ============================================================================
export function createFauna(g) {
  const scene = g.scene;

  // -------------------------------------------------------------------------
  // Shared gate state (recomputed at 10 Hz, smoothed per frame)
  // -------------------------------------------------------------------------
  let t = 0;                    // fauna clock (scaled dt)
  let aiAcc = AI_DT;            // force an AI tick on first update
  let inited = false;
  let dayFactor = 0, nightFactor = 0, goldenFactor = 0, duskGlow = 0;
  let perchWin = false, birdOn = 0;
  let playerBio = BIOME.MEADOW;
  let birdVis = 0, bflyVis = 0, ffVis = 0, pollenVis = 0;

  // Wind (shared by leaves / seeds / pollen): slowly rotating direction +
  // periodic gust envelope (the "gust streak" — a coordinated drift impulse).
  let windA = 0.8, windX = Math.cos(0.8), windZ = Math.sin(0.8);
  let gustTimer = 6, gustEnv = 0, gustTarget = 0, gustLeft = 0;

  // Scares: hitLanded positions make nearby life scatter.
  const scareP = new THREE.Vector3(1e9, 0, 1e9);
  let scareT = -100;
  g.events.on('hitLanded', (d) => {
    if (d && d.pos) { scareP.copy(d.pos); scareT = t; }
  });

  const glowTex = makeGlowTexture();

  // ===========================================================================
  // BIRDS — 3 flocks × 12, one InstancedMesh
  // ===========================================================================
  const BIRD_N = 36, FLOCK_N = 3, PER_FLOCK = 12;
  const birdMat = new THREE.MeshLambertMaterial({
    color: 0x272a30, flatShading: true, side: THREE.DoubleSide,
  });
  const birdMesh = new THREE.InstancedMesh(buildBirdGeom(), birdMat, BIRD_N);
  birdMesh.frustumCulled = false;
  birdMesh.castShadow = false;
  birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < BIRD_N; i++) birdMesh.setMatrixAt(i, ZERO_M);
  birdMesh.visible = false;
  scene.add(birdMesh);

  const birds = [];
  for (let i = 0; i < BIRD_N; i++) {
    birds.push({
      p: new THREE.Vector3(0, -100, 0),
      v: new THREE.Vector3(),
      tv: new THREE.Vector3(),          // steering target velocity (10 Hz)
      flap: Math.random() * TAU,
      flapR: 12,
      sc: 0.8 + Math.random() * 0.5,    // size variety
      slx: 0, sly: 0, slz: 0,           // perch slot (world)
      slotA: (i % PER_FLOCK) * 2.39996, // golden-angle slot spread
    });
  }
  const flocks = [];
  for (let f = 0; f < FLOCK_N; f++) {
    flocks.push({
      i0: f * PER_FLOCK,
      mode: 'fly',                      // fly | seek | perch
      homeX: 0, homeZ: 0,
      ang: Math.random() * TAU,
      angV: (0.18 + Math.random() * 0.12) * (f & 1 ? -1 : 1), // rad/s → ~5 u/s tangential
      rad: 14 + Math.random() * 12,
      height: 13 + Math.random() * 9,
      anchor: new THREE.Vector3(0, 20, 0),
      groundY: 0,
      tree: { x: 0, z: 0, top: 0, r: 1 },
      hasTree: false,
      scan: 0,                          // incremental tree-scan cursor
      settle: 0,
    });
  }

  function rehomeFlock(fl, px, pz, awayX, awayZ) {
    // New loop center 40–80u out; if fleeing, biased away from the player.
    let a = Math.random() * TAU;
    const d = 40 + Math.random() * 40;
    if (awayX !== 0 || awayZ !== 0) a = Math.atan2(awayZ, awayX) + (Math.random() - 0.5) * 1.2;
    fl.homeX = px + Math.cos(a) * d;
    fl.homeZ = pz + Math.sin(a) * d;
    fl.mode = 'fly';
    fl.hasTree = false;
    fl.scan = 0;
  }

  const _tree = { x: 0, z: 0, top: 0, r: 1 };

  function burstFlock(fl, px, pz) {
    for (let i = fl.i0; i < fl.i0 + PER_FLOCK; i++) {
      const b = birds[i];
      b.v.set(b.p.x - px + (Math.random() - 0.5) * 4, 0, b.p.z - pz + (Math.random() - 0.5) * 4);
      const l = Math.hypot(b.v.x, b.v.z) || 1;
      b.v.x = (b.v.x / l) * 6; b.v.z = (b.v.z / l) * 6;
      b.v.y = 5 + Math.random() * 3;
      b.tv.copy(b.v);
      b.flap = Math.random() * TAU;
    }
    const dx = fl.tree.x - px, dz = fl.tree.z - pz;
    rehomeFlock(fl, px, pz, dx, dz);
    // Wing-flutter stand-in: two quiet rustle taps (no dedicated sfx exists).
    if (dist2d(fl.tree.x, fl.tree.z, px, pz) < 34 && g.audio) {
      g.audio.play('footstep_grass', { vol: 0.5 });
      g.audio.play('footstep_grass', { vol: 0.35, delay: 0.11 });
    }
  }

  function aiBirds(px, pz) {
    const scared = t - scareT < 0.6;
    for (let f = 0; f < FLOCK_N; f++) {
      const fl = flocks[f];
      if (dist2d(fl.homeX, fl.homeZ, px, pz) > 95) rehomeFlock(fl, px, pz, 0, 0);

      // Dawn/dusk: hunt for a real tree near the loop and settle onto it.
      if (perchWin && !fl.hasTree && fl.mode === 'fly') {
        const ccx = Math.floor(fl.homeX / 16), ccz = Math.floor(fl.homeZ / 16);
        let looked = 0;
        while (fl.scan < TREE_SCAN.length && looked < 30) {
          const o = TREE_SCAN[fl.scan++]; looked++;
          if (treeAtCell(ccx + o[0], ccz + o[1], _tree)) {
            const td = dist2d(_tree.x, _tree.z, px, pz);
            if (td > 14 && td < BUBBLE - 20) { // reachable, inside the bubble
              fl.tree.x = _tree.x; fl.tree.z = _tree.z;
              fl.tree.top = _tree.top; fl.tree.r = _tree.r;
              fl.hasTree = true;
              fl.mode = 'seek';
              fl.settle = 0;
              for (let i = fl.i0; i < fl.i0 + PER_FLOCK; i++) {
                const b = birds[i];
                const rr = fl.tree.r * (0.35 + ((i * 0.37) % 1) * 0.85);
                b.slx = fl.tree.x + Math.cos(b.slotA) * rr;
                b.slz = fl.tree.z + Math.sin(b.slotA) * rr;
                b.sly = fl.tree.top + ((i * 0.61) % 1) * 0.25;
              }
              break;
            }
          }
        }
        if (fl.scan >= TREE_SCAN.length) fl.scan = 0; // rescan (home may move)
      }
      if (!perchWin && fl.mode !== 'fly') { fl.mode = 'fly'; fl.hasTree = false; }

      if (fl.mode === 'fly') {
        fl.ang += fl.angV * AI_DT;
        fl.anchor.x = fl.homeX + Math.cos(fl.ang) * fl.rad;
        fl.anchor.z = fl.homeZ + Math.sin(fl.ang * 0.9) * fl.rad;
        fl.groundY = terrainHeight(fl.anchor.x, fl.anchor.z);
        fl.anchor.y = Math.max(fl.groundY, WATER_LEVEL) + fl.height + Math.sin(fl.ang * 0.7) * 4;
      } else {
        fl.anchor.set(fl.tree.x, fl.tree.top, fl.tree.z);
        fl.groundY = fl.tree.top - 4;
        // Burst: player too close, or violence nearby.
        const pd = dist2d(fl.tree.x, fl.tree.z, px, pz);
        const sd = scared ? dist2d(fl.tree.x, fl.tree.z, scareP.x, scareP.z) : 1e9;
        if (pd < 8 || sd < 25) { burstFlock(fl, px, pz); continue; }
      }

      // Per-bird steering (boid-lite: seek anchor/slot + separation).
      for (let i = fl.i0; i < fl.i0 + PER_FLOCK; i++) {
        const b = birds[i];
        if (fl.mode === 'perch') { b.tv.set(0, 0, 0); continue; }
        const tx = fl.mode === 'seek' ? b.slx : fl.anchor.x;
        const ty = fl.mode === 'seek' ? b.sly + 0.6 : fl.anchor.y;
        const tz = fl.mode === 'seek' ? b.slz : fl.anchor.z;
        let dx = tx - b.p.x, dy = ty - b.p.y, dz = tz - b.p.z;
        // spread flying birds around the anchor instead of stacking
        if (fl.mode === 'fly') {
          dx += Math.cos(b.slotA + fl.ang * 0.5) * 4;
          dz += Math.sin(b.slotA + fl.ang * 0.5) * 4;
          dy += Math.sin(b.slotA * 3.1 + fl.ang) * 1.6;
        }
        // separation (within-flock O(n²) at 10 Hz — 66 pairs, trivial)
        for (let jn = fl.i0; jn < fl.i0 + PER_FLOCK; jn++) {
          if (jn === i) continue;
          const o = birds[jn];
          const sx = b.p.x - o.p.x, sy = b.p.y - o.p.y, sz = b.p.z - o.p.z;
          const d2 = sx * sx + sy * sy + sz * sz;
          if (d2 < 2.25 && d2 > 1e-4) {
            const k = (1.5 - Math.sqrt(d2)) * 2.2 / Math.sqrt(d2);
            dx += sx * k; dy += sy * k; dz += sz * k;
          }
        }
        // scare impulse while airborne
        if (scared) {
          const ex = b.p.x - scareP.x, ez = b.p.z - scareP.z;
          const ed = Math.hypot(ex, ez);
          if (ed < 25 && ed > 0.01) { dx += (ex / ed) * 10; dz += (ez / ed) * 10; dy += 4; }
        }
        const dl = Math.hypot(dx, dy, dz) || 1;
        const spd = fl.mode === 'seek' ? Math.min(5.5, dl * 1.2) : 6.8;
        b.tv.set((dx / dl) * spd, (dy / dl) * spd, (dz / dl) * spd);
      }

      // Seek → perch when the flock has settled on its slots.
      if (fl.mode === 'seek') {
        let far = 0;
        for (let i = fl.i0; i < fl.i0 + PER_FLOCK; i++) {
          const b = birds[i];
          if (Math.abs(b.p.x - b.slx) + Math.abs(b.p.y - b.sly) + Math.abs(b.p.z - b.slz) > 1.6) far++;
        }
        if (far === 0) fl.mode = 'perch';
      }
    }
  }

  function frameBirds(dt) {
    const target = birdOn;
    birdVis += (target - birdVis) * Math.min(1, 2 * dt);
    if (birdVis < 0.02) {
      if (birdMesh.visible) birdMesh.visible = false;
      return;
    }
    birdMesh.visible = true;
    const k = Math.min(1, 2.6 * dt);
    for (let f = 0; f < FLOCK_N; f++) {
      const fl = flocks[f];
      const perched = fl.mode === 'perch';
      for (let i = fl.i0; i < fl.i0 + PER_FLOCK; i++) {
        const b = birds[i];
        if (perched) {
          // sit on the slot, tiny idle bob, wings folded (low flap amp)
          b.p.x += (b.slx - b.p.x) * Math.min(1, 8 * dt);
          b.p.y += (b.sly + Math.sin(t * 2.1 + i) * 0.03 - b.p.y) * Math.min(1, 8 * dt);
          b.p.z += (b.slz - b.p.z) * Math.min(1, 8 * dt);
          b.v.multiplyScalar(Math.max(0, 1 - 6 * dt));
          b.flap += 1.5 * dt;
        } else {
          b.v.x += (b.tv.x - b.v.x) * k;
          b.v.y += (b.tv.y - b.v.y) * k;
          b.v.z += (b.tv.z - b.v.z) * k;
          b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;
          const floor = Math.max(fl.groundY, WATER_LEVEL) + 1.5;
          if (b.p.y < floor) { b.p.y = floor; if (b.v.y < 0) b.v.y = 1; }
          // flap-flap-glide rhythm: flap rate eases with a slow per-bird cycle
          const glide = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.5 + i * 1.7));
          b.flap += (6 + 12 * glide) * dt;
        }
        // heading from velocity (geometry faces +x)
        const hs = Math.hypot(b.v.x, b.v.z);
        const yaw = hs > 0.05 ? Math.atan2(-b.v.z, b.v.x) : b.slotA;
        const pitch = perched ? 0 : clamp(Math.atan2(b.v.y, hs + 0.5) * 0.6, -0.7, 0.7);
        _e.set(0, yaw, pitch, 'YZX');
        _q.setFromEuler(_e);
        const flapS = perched ? 0.18 : 0.25 + 0.75 * Math.abs(Math.sin(b.flap));
        const sc = b.sc * birdVis;
        _s.set(sc, sc * flapS, sc);
        _m.compose(b.p, _q, _s);
        birdMesh.setMatrixAt(i, _m);
      }
    }
    birdMesh.instanceMatrix.needsUpdate = true;
  }

  // ===========================================================================
  // BUTTERFLIES — 24 instanced wing-quads over meadow flowers (day)
  // ===========================================================================
  const BFLY_N = 24;
  const bflyMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, flatShading: true, side: THREE.DoubleSide,
  });
  const bflyMesh = new THREE.InstancedMesh(buildButterflyGeom(), bflyMat, BFLY_N);
  bflyMesh.frustumCulled = false;
  bflyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const BFLY_TINTS = [
    [1.0, 0.62, 0.15], [1.0, 0.9, 0.55], [0.75, 0.62, 1.0],
    [0.95, 0.95, 1.0], [1.0, 0.45, 0.35], [0.55, 0.75, 1.0],
  ];
  for (let i = 0; i < BFLY_N; i++) {
    bflyMesh.setMatrixAt(i, ZERO_M);
    const tt = BFLY_TINTS[i % BFLY_TINTS.length];
    _c.setRGB(tt[0], tt[1], tt[2]);
    bflyMesh.setColorAt(i, _c);
  }
  bflyMesh.visible = false;
  scene.add(bflyMesh);

  const bflys = [];
  for (let i = 0; i < BFLY_N; i++) {
    bflys.push({
      ok: false,
      home: new THREE.Vector3(),
      gy: 0,
      p: new THREE.Vector3(0, -100, 0),
      v: new THREE.Vector3(),
      ph1: Math.random() * TAU, ph2: Math.random() * TAU, ph3: Math.random() * TAU,
      flap: Math.random() * TAU,
      sc: 0.8 + Math.random() * 0.5,
    });
  }
  const _fl = { x: 0, y: 0, z: 0 };

  function scatterButterflies(px, pz) {
    const pcx = Math.floor(px / 6), pcz = Math.floor(pz / 6);
    for (let i = 0; i < BFLY_N; i++) {
      const b = bflys[i];
      b.ok = false;
      // land on a REAL flower first (same hash grid world.js renders from)
      for (let tr = 0; tr < 5; tr++) {
        const cx = pcx + ((Math.random() * 15) | 0) - 7;
        const cz = pcz + ((Math.random() * 15) | 0) - 7;
        if (flowerAtCell(cx, cz, _fl)) {
          b.home.set(_fl.x, _fl.y + 0.7, _fl.z);
          b.gy = _fl.y;
          b.ok = true;
          break;
        }
      }
      if (!b.ok) { // fallback: any nearby meadow spot
        const a = Math.random() * TAU, d = 6 + Math.random() * 28;
        const wx = px + Math.cos(a) * d, wz = pz + Math.sin(a) * d;
        const h = terrainHeight(wx, wz);
        if (h > WATER_LEVEL + 1 && biomeAt(wx, wz, h) === BIOME.MEADOW && !insidePOI(wx, wz)) {
          b.home.set(wx, h + 0.7, wz);
          b.gy = h;
          b.ok = true;
        }
      }
      if (b.ok && b.p.y < -50) b.p.copy(b.home); // first placement snaps
    }
  }

  function frameButterflies(dt, px, py, pz) {
    let target = 0;
    if (dayFactor > 0.03) {
      for (let i = 0; i < BFLY_N; i++) if (bflys[i].ok) { target = dayFactor; break; }
    }
    bflyVis += (target - bflyVis) * Math.min(1, 2 * dt);
    if (bflyVis < 0.02) {
      if (bflyMesh.visible) bflyMesh.visible = false;
      return;
    }
    bflyMesh.visible = true;
    const scared = t - scareT < 0.7;
    const k = Math.min(1, 3.2 * dt);
    for (let i = 0; i < BFLY_N; i++) {
      const b = bflys[i];
      if (!b.ok) { bflyMesh.setMatrixAt(i, ZERO_M); continue; }
      // target: sine wander around the flower; odd ones chase their partner
      const mate = bflys[i ^ 1];
      let tx, ty, tz;
      if ((i & 1) && mate.ok) {
        tx = mate.p.x + Math.cos(t * 2.1 + b.ph1) * 0.5;
        ty = mate.p.y + 0.22 + Math.sin(t * 2.7 + b.ph2) * 0.2;
        tz = mate.p.z + Math.sin(t * 1.9 + b.ph3) * 0.5;
      } else {
        tx = b.home.x + Math.cos(t * 0.55 + b.ph1) * 2.3;
        ty = b.home.y + 0.45 * Math.sin(t * 0.9 + b.ph2) + 0.3;
        tz = b.home.z + Math.sin(t * 0.42 + b.ph3) * 2.3;
      }
      // flee the player and fresh hits
      let fx = b.p.x - px, fz = b.p.z - pz;
      let fd = Math.hypot(fx, fz);
      if (fd < 2.6 && fd > 0.01) { tx = b.p.x + (fx / fd) * 5; tz = b.p.z + (fz / fd) * 5; ty = b.p.y + 1.6; }
      if (scared) {
        fx = b.p.x - scareP.x; fz = b.p.z - scareP.z; fd = Math.hypot(fx, fz);
        if (fd < 10 && fd > 0.01) { tx = b.p.x + (fx / fd) * 6; tz = b.p.z + (fz / fd) * 6; ty = b.p.y + 2; }
      }
      // steer + integrate (gusts push them downwind a touch)
      b.v.x += ((tx - b.p.x) * 1.9 + windX * gustEnv * 1.2 - b.v.x) * k;
      b.v.y += ((ty - b.p.y) * 1.9 - b.v.y) * k;
      b.v.z += ((tz - b.p.z) * 1.9 + windZ * gustEnv * 1.2 - b.v.z) * k;
      b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;
      if (b.p.y < b.gy + 0.25) b.p.y = b.gy + 0.25;
      b.flap += (18 + 10 * Math.abs(Math.sin(t + b.ph1))) * dt;
      const hs = Math.hypot(b.v.x, b.v.z);
      const yaw = hs > 0.03 ? Math.atan2(-b.v.z, b.v.x) : b.ph1;
      _e.set(0, yaw, clamp(b.v.y * 0.4, -0.5, 0.5), 'YZX');
      _q.setFromEuler(_e);
      const flapS = 0.15 + 0.85 * Math.abs(Math.sin(b.flap));
      const sc = b.sc * bflyVis;
      _s.set(sc, sc, sc * flapS);
      _m.compose(b.p, _q, _s);
      bflyMesh.setMatrixAt(i, _m);
    }
    bflyMesh.instanceMatrix.needsUpdate = true;
  }

  // ===========================================================================
  // FIREFLIES — 40 additive glow points, night, torch-dodging
  // ===========================================================================
  const FF_N = 40;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF_N * 3);
  const ffCol = new Float32Array(FF_N * 3);
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3).setUsage(THREE.DynamicDrawUsage));
  ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3).setUsage(THREE.DynamicDrawUsage));
  ffGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // skip recompute
  const ffMat = new THREE.PointsMaterial({
    size: 0.55, sizeAttenuation: true, map: glowTex, vertexColors: true,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const ffMesh = new THREE.Points(ffGeo, ffMat);
  ffMesh.frustumCulled = false;
  ffMesh.renderOrder = 4;
  ffMesh.visible = false;
  scene.add(ffMesh);

  const ffs = [];
  for (let i = 0; i < FF_N; i++) {
    ffs.push({
      ok: false, hx: 0, hy: 0, hz: 0,
      px: 0, py: 0, pz: 0,
      ph: Math.random() * TAU,
      pr: 0.7 + Math.random() * 1.1,     // pulse rate
      sp: 0.6 + Math.random() * 0.9,     // drift speed factor
      amp: 1.2 + Math.random() * 1.6,    // drift radius
      warm: Math.random(),               // green ↔ amber tint
      dox: 0, doz: 0, dtx: 0, dtz: 0,    // torch-dodge offset (actual/target)
    });
  }

  function scatterFireflies(px, pz) {
    for (let i = 0; i < FF_N; i++) {
      const F = ffs[i];
      F.ok = false;
      for (let tr = 0; tr < 4; tr++) {
        const a = Math.random() * TAU, d = 8 + Math.random() * 36;
        const wx = px + Math.cos(a) * d, wz = pz + Math.sin(a) * d;
        const h = terrainHeight(wx, wz);
        if (h < WATER_LEVEL + 0.4 || h > 70) continue;
        const bio = biomeAt(wx, wz, h);
        // forest & marsh edges everywhere; meadow allowed near the village so
        // the dusk swarm drifts right up to Emberhollow's fences.
        const okBio = bio === BIOME.FOREST || bio === BIOME.MARSH ||
          (bio === BIOME.MEADOW && dist2d(wx, wz, 0, 0) < 170);
        if (!okBio) continue;
        F.hx = wx; F.hy = h + 0.6 + Math.random() * 1.5; F.hz = wz;
        F.ok = true;
        break;
      }
    }
  }

  function aiFireflies(px, pz) {
    // Torch dodge: the shared point light is the torch when it burns.
    const L = g.pointLight;
    const lit = L && L.intensity > 0.25;
    for (let i = 0; i < FF_N; i++) {
      const F = ffs[i];
      if (!F.ok) continue;
      let txo = 0, tzo = 0;
      if (lit) {
        const dx = F.px - L.position.x, dz = F.pz - L.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 7 && d > 0.01) {
          const k = (7 - d) * 0.75;
          txo = (dx / d) * k; tzo = (dz / d) * k;
        }
      }
      // gentle personal-space dodge from the player too
      const pdx = F.px - px, pdz = F.pz - pz;
      const pd = Math.hypot(pdx, pdz);
      if (pd < 2 && pd > 0.01) {
        txo += (pdx / pd) * (2 - pd) * 1.2;
        tzo += (pdz / pd) * (2 - pd) * 1.2;
      }
      F.dtx = txo; F.dtz = tzo;
    }
  }

  function frameFireflies(dt) {
    const target = nightFactor;
    ffVis += (target - ffVis) * Math.min(1, 1.2 * dt);
    if (ffVis < 0.02) {
      if (ffMesh.visible) ffMesh.visible = false;
      return;
    }
    ffMesh.visible = true;
    const surge = 1 + 0.9 * duskGlow; // dusk is when they put on the show
    const dk = Math.min(1, 2.5 * dt);
    for (let i = 0; i < FF_N; i++) {
      const F = ffs[i];
      const o = i * 3;
      if (!F.ok) { ffCol[o] = ffCol[o + 1] = ffCol[o + 2] = 0; continue; }
      F.dox += (F.dtx - F.dox) * dk;
      F.doz += (F.dtz - F.doz) * dk;
      F.px = F.hx + Math.sin(t * 0.31 * F.sp + F.ph) * F.amp + F.dox;
      F.py = F.hy + Math.sin(t * 0.23 * F.sp + F.ph * 1.7) * 0.55;
      F.pz = F.hz + Math.cos(t * 0.27 * F.sp + F.ph * 2.3) * F.amp + F.doz;
      ffPos[o] = F.px; ffPos[o + 1] = F.py; ffPos[o + 2] = F.pz;
      // soft blink pulse + a slow luminous wave rolling across the swarm at
      // dusk (loosely synchronized, like real Photinus displays)
      const pulse = Math.max(0, Math.sin(t * F.pr + F.ph));
      let b = ffVis * (0.10 + 0.90 * pulse * pulse * pulse) * surge;
      b *= 1 + 0.45 * duskGlow * Math.sin(t * 0.8 + (F.hx + F.hz) * 0.12);
      ffCol[o] = b * lerp(0.55, 1.05, F.warm);
      ffCol[o + 1] = b * 1.0;
      ffCol[o + 2] = b * lerp(0.30, 0.16, F.warm);
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffGeo.attributes.color.needsUpdate = true;
  }

  // ===========================================================================
  // MIRRORMERE FISH — instanced ripple rings + one jumping fish
  // ===========================================================================
  const LAKE = POI.lake; // (-350, 520)
  const RIP_N = 8;
  const ripGeo = new THREE.RingGeometry(0.86, 1.0, 22);
  ripGeo.rotateX(-Math.PI / 2);
  const ripMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ripMesh = new THREE.InstancedMesh(ripGeo, ripMat, RIP_N);
  ripMesh.frustumCulled = false;
  ripMesh.renderOrder = 3; // after the (depthWrite:false) water plane
  ripMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < RIP_N; i++) {
    ripMesh.setMatrixAt(i, ZERO_M);
    _c.setRGB(0, 0, 0);
    ripMesh.setColorAt(i, _c);
  }
  ripMesh.visible = false;
  scene.add(ripMesh);
  const rips = [];
  for (let i = 0; i < RIP_N; i++) rips.push({ on: false, x: 0, z: 0, age: 0, life: 1, s: 1 });

  const fishMat = new THREE.MeshLambertMaterial({ color: 0x2c3a42, flatShading: true });
  const fishMesh = new THREE.Mesh(buildFishGeom(), fishMat);
  fishMesh.visible = false;
  scene.add(fishMesh);
  const fish = { on: false, x0: 0, z0: 0, dx: 0, dz: 0, len: 2.2, h: 1.3, t: 0, dur: 0.9 };

  let rippleT = 3, fishT = 12, lakeNear = false;

  function spawnRipple(x, z, s) {
    let slot = null, oldest = -1;
    for (let i = 0; i < RIP_N; i++) {
      if (!rips[i].on) { slot = rips[i]; break; }
      if (rips[i].age > oldest) { oldest = rips[i].age; slot = rips[i]; }
    }
    slot.on = true; slot.x = x; slot.z = z; slot.age = 0;
    slot.life = 2.2 + Math.random() * 1.2; slot.s = s;
  }

  // Deterministic-enough transient: random lake point that is real open water
  // and close enough to the player to be seen.
  let _lpx = 0, _lpz = 0;
  function findLakePoint(px, pz) {
    for (let tr = 0; tr < 4; tr++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 130;
      const x = LAKE.x + Math.cos(a) * d, z = LAKE.z + Math.sin(a) * d;
      if (dist2d(x, z, px, pz) > 95) continue;
      if (terrainHeight(x, z) < WATER_LEVEL - 0.7) { _lpx = x; _lpz = z; return true; }
    }
    return false;
  }

  function aiLake(px, pz) {
    lakeNear = dist2d(px, pz, LAKE.x, LAKE.z) < 230;
    if (!lakeNear) return;
    const busy = goldenFactor > 0.15 ? 0.45 : 1; // feeding frenzy at gold hour
    rippleT -= AI_DT;
    if (rippleT <= 0) {
      rippleT = (3 + Math.random() * 6) * busy;
      if (findLakePoint(px, pz)) spawnRipple(_lpx, _lpz, 0.7 + Math.random() * 1.2);
    }
    fishT -= AI_DT;
    if (fishT <= 0 && !fish.on) {
      fishT = (16 + Math.random() * 26) * busy;
      if (findLakePoint(px, pz)) {
        fish.on = true; fish.t = 0;
        fish.x0 = _lpx; fish.z0 = _lpz;
        const a = Math.random() * TAU;
        fish.dx = Math.cos(a); fish.dz = Math.sin(a);
        fish.len = 1.6 + Math.random() * 1.4;
        fish.h = 1.0 + Math.random() * 0.8;
        fish.dur = 0.75 + Math.random() * 0.3;
        spawnRipple(_lpx, _lpz, 0.6);
      }
    }
  }

  function frameLake(dt, px, pz) {
    let any = false;
    for (let i = 0; i < RIP_N; i++) {
      const R = rips[i];
      if (!R.on) continue;
      R.age += dt;
      if (R.age >= R.life) {
        R.on = false;
        ripMesh.setMatrixAt(i, ZERO_M);
        ripMesh.instanceMatrix.needsUpdate = true;
        continue;
      }
      any = true;
      const k = R.age / R.life;
      const rad = R.s * (0.35 + 2.6 * k);
      _v1.set(R.x, WATER_LEVEL + 0.74, R.z);
      _q.identity();
      _s.set(rad, 1, rad);
      _m.compose(_v1, _q, _s);
      ripMesh.setMatrixAt(i, _m);
      const a = (1 - k) * (1 - k) * 0.5;
      _c.setRGB(a, a, a * 1.15);
      ripMesh.setColorAt(i, _c);
    }
    if (any) {
      ripMesh.visible = true;
      ripMesh.instanceMatrix.needsUpdate = true;
      if (ripMesh.instanceColor) ripMesh.instanceColor.needsUpdate = true;
    } else if (ripMesh.visible) ripMesh.visible = false;

    if (fish.on) {
      fish.t += dt;
      const k = fish.t / fish.dur;
      if (k >= 1) {
        fish.on = false;
        fishMesh.visible = false;
        const lx = fish.x0 + fish.dx * fish.len, lz = fish.z0 + fish.dz * fish.len;
        spawnRipple(lx, lz, 1.1);
        const d = dist2d(lx, lz, px, pz);
        if (d < 55 && g.audio) g.audio.play('footstep_water', { vol: clamp(1 - d / 55, 0.12, 0.75) });
      } else {
        fishMesh.visible = true;
        fishMesh.position.set(
          fish.x0 + fish.dx * fish.len * k,
          WATER_LEVEL + fish.h * 4 * k * (1 - k) + 0.15,
          fish.z0 + fish.dz * fish.len * k,
        );
        const vy = fish.h * (4 - 8 * k) / fish.dur;
        const vh = fish.len / fish.dur;
        _e.set(0, Math.atan2(-fish.dz, fish.dx), Math.atan2(vy, vh), 'YZX');
        fishMesh.rotation.copy(_e);
      }
    }
  }

  // ===========================================================================
  // FALLING LEAVES — 24 instanced quads drifting down through the forest
  // ===========================================================================
  const LEAF_N = 24;
  const leafMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, flatShading: true, side: THREE.DoubleSide,
  });
  const leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22), leafMat, LEAF_N);
  leafMesh.frustumCulled = false;
  leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < LEAF_N; i++) {
    leafMesh.setMatrixAt(i, ZERO_M);
    // autumn golds / ambers / rare reds
    const r = Math.random();
    _c.setRGB(0.85 + r * 0.35, 0.42 + Math.random() * 0.3, 0.08 + Math.random() * 0.1);
    leafMesh.setColorAt(i, _c);
  }
  leafMesh.visible = false;
  scene.add(leafMesh);
  const leaves = [];
  for (let i = 0; i < LEAF_N; i++) {
    leaves.push({
      on: false, x: 0, y: 0, z: 0, gy: 0,
      fs: 0.45 + Math.random() * 0.45,
      ph: Math.random() * TAU,
      r1: Math.random() * TAU, r2: Math.random() * TAU,
      w1: 1.5 + Math.random() * 2, w2: 1 + Math.random() * 2,
    });
  }

  function aiLeaves(px, pz) {
    // sparse: only respawn a few per tick, only where there is actual forest
    let budget = 3;
    for (let i = 0; i < LEAF_N && budget > 0; i++) {
      const L = leaves[i];
      if (L.on) continue;
      budget--;
      const a = Math.random() * TAU, d = 4 + Math.random() * 24;
      const wx = px + Math.cos(a) * d, wz = pz + Math.sin(a) * d;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 1 || biomeAt(wx, wz, h) !== BIOME.FOREST) continue;
      L.on = true;
      L.x = wx; L.z = wz; L.gy = h;
      L.y = h + 4.5 + Math.random() * 5.5;   // let go from canopy height
    }
  }

  function frameLeaves(dt) {
    let any = false;
    for (let i = 0; i < LEAF_N; i++) {
      const L = leaves[i];
      if (!L.on) { continue; }
      any = true;
      L.y -= L.fs * dt;
      L.x += (windX * (0.35 + 1.8 * gustEnv) + Math.sin(t * 1.1 + L.ph) * 0.55) * dt;
      L.z += (windZ * (0.35 + 1.8 * gustEnv) + Math.cos(t * 0.9 + L.ph * 1.6) * 0.55) * dt;
      if (L.y <= L.gy + 0.05) {
        L.on = false;
        leafMesh.setMatrixAt(i, ZERO_M);
        continue;
      }
      _v1.set(L.x, L.y, L.z);
      _e.set(L.r1 + t * L.w1, L.ph + t * 0.7, L.r2 + t * L.w2);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_v1, _q, _s);
      leafMesh.setMatrixAt(i, _m);
    }
    if (any) {
      leafMesh.visible = true;
      leafMesh.instanceMatrix.needsUpdate = true;
    } else if (leafMesh.visible) leafMesh.visible = false;
  }

  // ===========================================================================
  // POLLEN MOTES — 48 additive gold points, golden hour only
  // ===========================================================================
  const POL_N = 48;
  const polGeo = new THREE.BufferGeometry();
  const polPos = new Float32Array(POL_N * 3);
  const polCol = new Float32Array(POL_N * 3);
  polGeo.setAttribute('position', new THREE.BufferAttribute(polPos, 3).setUsage(THREE.DynamicDrawUsage));
  polGeo.setAttribute('color', new THREE.BufferAttribute(polCol, 3).setUsage(THREE.DynamicDrawUsage));
  polGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const polMat = new THREE.PointsMaterial({
    size: 0.11, sizeAttenuation: true, map: glowTex, vertexColors: true,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const polMesh = new THREE.Points(polGeo, polMat);
  polMesh.frustumCulled = false;
  polMesh.renderOrder = 4;
  polMesh.visible = false;
  scene.add(polMesh);
  const pols = [];
  for (let i = 0; i < POL_N; i++) {
    pols.push({ x: 0, y: -100, z: 0, ph: Math.random() * TAU, b: 0.5 + Math.random() * 0.5 });
  }

  function aiPollen(px, pz) {
    if (goldenFactor < 0.02) return;
    let budget = 6;
    for (let i = 0; i < POL_N && budget > 0; i++) {
      const P = pols[i];
      if (P.y > -50 && dist2d(P.x, P.z, px, pz) < 16) continue;
      budget--;
      const a = Math.random() * TAU, d = 2 + Math.random() * 12;
      const wx = px + Math.cos(a) * d, wz = pz + Math.sin(a) * d;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 0.5) continue;
      P.x = wx; P.z = wz;
      P.y = h + 0.4 + Math.random() * 2.6;
    }
  }

  function framePollen(dt) {
    pollenVis += (goldenFactor - pollenVis) * Math.min(1, 1.5 * dt);
    if (pollenVis < 0.02) {
      if (polMesh.visible) polMesh.visible = false;
      return;
    }
    polMesh.visible = true;
    for (let i = 0; i < POL_N; i++) {
      const P = pols[i];
      const o = i * 3;
      if (P.y < -50) { polCol[o] = polCol[o + 1] = polCol[o + 2] = 0; continue; }
      P.x += (windX * 0.14 + Math.sin(t * 0.5 + P.ph) * 0.16) * dt;
      P.z += (windZ * 0.14 + Math.cos(t * 0.42 + P.ph * 1.7) * 0.16) * dt;
      P.y += Math.sin(t * 0.35 + P.ph * 2.1) * 0.09 * dt;
      polPos[o] = P.x; polPos[o + 1] = P.y; polPos[o + 2] = P.z;
      // sun-catching twinkle
      const b = pollenVis * P.b * (0.35 + 0.65 * Math.max(0, Math.sin(t * 1.6 + P.ph * 3))) * 0.55;
      polCol[o] = b * 1.0; polCol[o + 1] = b * 0.82; polCol[o + 2] = b * 0.38;
    }
    polGeo.attributes.position.needsUpdate = true;
    polGeo.attributes.color.needsUpdate = true;
  }

  // ===========================================================================
  // DANDELION SEEDS — 16 white points released on meadow wind gusts
  // ===========================================================================
  const SEED_N = 16;
  const seedGeo = new THREE.BufferGeometry();
  const seedPos = new Float32Array(SEED_N * 3);
  const seedCol = new Float32Array(SEED_N * 3);
  seedGeo.setAttribute('position', new THREE.BufferAttribute(seedPos, 3).setUsage(THREE.DynamicDrawUsage));
  seedGeo.setAttribute('color', new THREE.BufferAttribute(seedCol, 3).setUsage(THREE.DynamicDrawUsage));
  seedGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const seedMat = new THREE.PointsMaterial({
    size: 0.16, sizeAttenuation: true, map: glowTex, vertexColors: true,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const seedMesh = new THREE.Points(seedGeo, seedMat);
  seedMesh.frustumCulled = false;
  seedMesh.renderOrder = 4;
  seedMesh.visible = false;
  scene.add(seedMesh);
  const seeds = [];
  for (let i = 0; i < SEED_N; i++) {
    seeds.push({
      x: 0, y: 0, z: 0, ph: Math.random() * TAU,
      sp: 0.7 + Math.random() * 0.7,
    });
  }
  let seedsLive = false;

  function startSeedGust(px, pz) {
    // release from the upwind side so the puff blows across the player
    seedsLive = true;
    for (let i = 0; i < SEED_N; i++) {
      const S = seeds[i];
      const back = 5 + Math.random() * 7;
      const side = (Math.random() - 0.5) * 10;
      S.x = px - windX * back - windZ * side;
      S.z = pz - windZ * back + windX * side;
      const h = terrainHeight(S.x, S.z);
      S.y = h + 0.35 + Math.random() * 1.1;
    }
  }

  function frameSeeds(dt) {
    const on = seedsLive && gustEnv > 0.02 && dayFactor > 0.02;
    if (!on) {
      if (seedMesh.visible) seedMesh.visible = false;
      if (gustEnv < 0.02) seedsLive = false;
      return;
    }
    seedMesh.visible = true;
    for (let i = 0; i < SEED_N; i++) {
      const S = seeds[i];
      const o = i * 3;
      S.x += (windX * 2.4 * S.sp * gustEnv + Math.sin(t * 1.8 + S.ph) * 0.3) * dt;
      S.z += (windZ * 2.4 * S.sp * gustEnv + Math.cos(t * 1.5 + S.ph * 2) * 0.3) * dt;
      S.y += (0.22 + Math.sin(t * 2.2 + S.ph) * 0.4) * dt;
      seedPos[o] = S.x; seedPos[o + 1] = S.y; seedPos[o + 2] = S.z;
      const b = gustEnv * dayFactor * 0.6;
      seedCol[o] = b; seedCol[o + 1] = b; seedCol[o + 2] = b * 0.95;
    }
    seedGeo.attributes.position.needsUpdate = true;
    seedGeo.attributes.color.needsUpdate = true;
  }

  // ===========================================================================
  // 10 Hz AI tick — gates, wind, scatters, spawners, steering
  // ===========================================================================
  let ffAX = 1e9, ffAZ = 1e9;      // firefly 32u re-scatter anchor
  let bfAX = 1e9, bfAZ = 1e9;      // butterfly 24u re-scatter anchor

  function aiTick(px, py, pz) {
    const f = g.time.dayFrac;
    // 0=midnight .25=sunrise .5=noon .75=sunset (dawn/dusk are long — CONTRACT)
    dayFactor = win(f, 0.215, 0.265, 0.72, 0.785);
    nightFactor = Math.max(1 - smoothstep(0.18, 0.26, f), smoothstep(0.735, 0.815, f));
    goldenFactor = Math.max(win(f, 0.20, 0.245, 0.30, 0.35), win(f, 0.65, 0.70, 0.755, 0.80));
    duskGlow = win(f, 0.71, 0.76, 0.85, 0.92);
    perchWin = (f > 0.215 && f < 0.295) || (f > 0.695 && f < 0.785);
    birdOn = f > 0.205 && f < 0.80 ? 1 : 0;
    playerBio = biomeAt(px, pz);

    // wind: direction wanders, gusts fire every 7–18 s
    windA += (hash2(Math.floor(t * 0.5), 0, 501) - 0.5) * 0.14;
    windX = Math.cos(windA); windZ = Math.sin(windA);
    gustTimer -= AI_DT;
    if (gustTimer <= 0) {
      gustTimer = 7 + Math.random() * 11;
      gustLeft = 2.6 + Math.random() * 1.6;
      gustTarget = 0.7 + Math.random() * 0.3;
      if (playerBio === BIOME.MEADOW && dayFactor > 0.05) startSeedGust(px, pz);
    }
    if (gustLeft > 0) { gustLeft -= AI_DT; if (gustLeft <= 0) gustTarget = 0; }

    // re-scatter homes when the player crosses anchor boundaries
    const fax = Math.floor(px / 32), faz = Math.floor(pz / 32);
    if (fax !== ffAX || faz !== ffAZ) {
      ffAX = fax; ffAZ = faz;
      scatterFireflies(px, pz);
    }
    const bax = Math.floor(px / 24), baz = Math.floor(pz / 24);
    if (bax !== bfAX || baz !== bfAZ) {
      bfAX = bax; bfAZ = baz;
      scatterButterflies(px, pz);
    }

    if (birdOn) aiBirds(px, pz);
    if (nightFactor > 0.02) aiFireflies(px, pz);
    aiLake(px, pz);
    aiLeaves(px, pz);
    aiPollen(px, pz);
  }

  // ===========================================================================
  // update — per-frame integration only; heavy decisions live in aiTick
  // ===========================================================================
  function update(dt) {
    if (g.paused) return;
    const pp = g.player ? g.player.position : g.camera.position;
    if (!inited) {
      inited = true;
      for (let f = 0; f < FLOCK_N; f++) {
        rehomeFlock(flocks[f], pp.x, pp.z, 0, 0);
        for (let i = flocks[f].i0; i < flocks[f].i0 + PER_FLOCK; i++) {
          birds[i].p.set(
            flocks[f].homeX + (Math.random() - 0.5) * 20,
            terrainHeight(flocks[f].homeX, flocks[f].homeZ) + 18,
            flocks[f].homeZ + (Math.random() - 0.5) * 20,
          );
        }
      }
    }
    t += dt;

    aiAcc += dt;
    if (aiAcc >= AI_DT) {
      aiAcc = aiAcc > 0.3 ? 0 : aiAcc - AI_DT; // don't spiral after hitches
      aiTick(pp.x, pp.y, pp.z);
    }

    // gust envelope (smooth attack/decay)
    gustEnv += (gustTarget - gustEnv) * Math.min(1, (gustTarget > gustEnv ? 1.6 : 0.8) * dt);

    frameBirds(dt);
    frameButterflies(dt, pp.x, pp.y, pp.z);
    frameFireflies(dt);
    frameLake(dt, pp.x, pp.z);
    frameLeaves(dt);
    framePollen(dt);
    frameSeeds(dt);
  }

  return { update };
}

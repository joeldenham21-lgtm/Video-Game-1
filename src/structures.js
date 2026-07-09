// ============================================================================
// ELDERFALL — structures.js
// Emberhollow village, Barrowdeep ruins + crypt, the Wardstones, Greywatch
// tower, Redfang camp, Shrine of Aldric, ~18 seeded breadcrumb POIs, ~10
// one-time chests. All placement samples core.terrainHeight so nothing
// floats. Geometry merges per-POI into a handful of vertex-colored meshes
// (shared materials, flat shaded); fires/smoke are two pooled Points systems
// (NO real lights — emissive + fake ground-glow discs); window/lantern glow
// is one shared emissive material updated at most once per second.
// ============================================================================
import * as THREE from 'three';
import {
  WATER_LEVEL, POIS, POI, terrainHeight, makeRng,
  clamp, smoothstep, dist2d,
} from './core.js';

// Deterministic uniform hash in [0,1). core.hash2 is biased toward [0, 0.5)
// for the tiny integer lattices used here, so scramble through mulberry32.
function srand(a, b, k = 1) {
  return makeRng((Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(k | 0, 83492791)) >>> 0)();
}

// ---------------------------------------------------------------------------
// Geometry templates (built once, non-indexed → hard edges for flat shading)
// ---------------------------------------------------------------------------
const TPL = {};
function buildTemplates() {
  if (TPL.box) return;
  TPL.box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  TPL.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).toNonIndexed();
  TPL.cyl6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).toNonIndexed();
  TPL.cyl12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12).toNonIndexed();
  TPL.cone = new THREE.ConeGeometry(0.5, 1, 7).toNonIndexed();
  TPL.sphere = new THREE.SphereGeometry(0.5, 7, 5).toNonIndexed();
  TPL.disc = new THREE.CircleGeometry(0.5, 14).toNonIndexed();
  TPL.quad = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  // Triangular gable prism: unit footprint, ridge along local X at y = 1.
  {
    const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5];
    const R1 = [-0.5, 1, 0], R2 = [0.5, 1, 0];
    const v = [];
    const tri = (a, b, c) => v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    tri(A, R2, B); tri(A, R1, R2);   // -z slope
    tri(C, R1, D); tri(C, R2, R1);   // +z slope
    tri(D, R1, A);                    // -x gable
    tri(B, R2, C);                    // +x gable
    const gm = new THREE.BufferGeometry();
    gm.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    gm.computeVertexNormals();
    TPL.prism = gm;
  }
}

// ---------------------------------------------------------------------------
// Shared materials (Lambert only per contract; emissive fakes all "light")
// ---------------------------------------------------------------------------
const MAT = {
  static: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  glow: new THREE.MeshLambertMaterial({
    color: 0x241a10, emissive: 0xffb44d, emissiveIntensity: 0.12, flatShading: true,
  }),
  rune: new THREE.MeshLambertMaterial({
    color: 0x39404a, emissive: 0x3fd9ff, emissiveIntensity: 0.06, flatShading: true,
  }),
  fire: new THREE.MeshLambertMaterial({
    color: 0x1c0d04, emissive: 0xff8226, emissiveIntensity: 1.0, flatShading: true,
  }),
  glowDisc: new THREE.MeshLambertMaterial({
    color: 0x000000, emissive: 0xff8630, emissiveIntensity: 0.55, flatShading: true,
    transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
  }),
};

// ---------------------------------------------------------------------------
// Builder: bakes transformed template geometry + per-triangle jittered vertex
// colors into one big BufferGeometry (→ one draw call per POI).
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();

class Builder {
  constructor(seed = 4242) { this.pos = []; this.nrm = []; this.col = []; this.rng = makeRng(seed); }
  // add(template, position, scale, rotation(YXZ), hexColor, jitter)
  add(tpl, x, y, z, sx, sy, sz, rx, ry, rz, color, jitter = 0.07) {
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
    _vA.set(x, y, z); _vB.set(sx, sy, sz);
    _m4.compose(_vA, _q, _vB); _m3.getNormalMatrix(_m4);
    const P = tpl.attributes.position.array, N = tpl.attributes.normal.array;
    const cr = ((color >> 16) & 255) / 255, cg = ((color >> 8) & 255) / 255, cb = (color & 255) / 255;
    let j = 1;
    for (let i = 0; i < P.length; i += 3) {
      if (i % 9 === 0) j = 1 + (this.rng() - 0.5) * 2 * jitter;
      _vA.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(_m4);
      this.pos.push(_vA.x, _vA.y, _vA.z);
      _vA.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_m3).normalize();
      this.nrm.push(_vA.x, _vA.y, _vA.z);
      this.col.push(clamp(cr * j, 0, 1), clamp(cg * j, 0, 1), clamp(cb * j, 0, 1));
    }
  }
  geo() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere(); // proper bounds → frustum culling works per mesh
    return geo;
  }
  build(material, shadow = true) {
    const mesh = new THREE.Mesh(this.geo(), material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; // geometry already in world space
    return mesh;
  }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C_PLASTER = [0xd9cbaa, 0xcfc0a0, 0xdad2b8, 0xc9b894];
const C_THATCH = [0x9c7a36, 0x8f6d30, 0xa5854a];
const C_CANVAS = [0xa8543c, 0x527a54, 0xb08d3f];
const C_TIMBER = 0x5a4128;
const C_STONE = 0x8b8c86;
const C_DARKSTONE = 0x6f736e;
const C_MOSS = 0x707a64;
const C_DIRT = 0x8a6e4b;
const C_WOOD = 0x77552f;

const NOTES = [
  ['A weathered note', '"Gone to the high pass after the white stag. If the wolves take me, tell Maera the orchard is hers." — Hal'],
  ['A rain-blotted letter', '"The road north is not safe. Redfang men take a toll in coin or blood. Go by the lake." '],
  ['A hunter\'s tally', 'Four pelts, two hares, one broken bowstring. Tomorrow the ridge.'],
  ['A child\'s scrawl', '"Papa says the stones in the west hum when you press your ear to them. I heard a song."'],
  ['A soldier\'s note', '"Greywatch stands empty. If the beacon ever burns again, Emberhollow must answer." '],
  ['A merchant\'s ledger', 'Lost: one cart, one axle, all dignity. The crows may keep the turnips.'],
];

// ============================================================================
// Factory
// ============================================================================
export function createStructures(g) {
  buildTemplates();

  const root = new THREE.Group();
  root.name = 'structures';
  g.scene.add(root);

  // ---- shared helpers ------------------------------------------------------
  function addCol(x, z, r, hMin, hMax) {
    const c = { x, z, r };
    if (hMin !== undefined) c.hMin = hMin;
    if (hMax !== undefined) c.hMax = hMax;
    g.colliders.push(c);
  }
  function addInter(x, y, z, radius, label, onInteract, enabled) {
    const it = { pos: new THREE.Vector3(x, y, z), radius, label, onInteract };
    if (enabled) it.enabled = enabled;
    g.interactables.push(it);
    return it;
  }
  const notify = (text, sub) => g.events.emit('notify', sub ? { text, sub } : { text });

  // ---- fire / smoke particle pools (2 draw calls, global) ------------------
  const FLAME_N = 120, SMOKE_N = 84;
  function makePool(n, size, opacity) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999; // parked offscreen
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(col, 3); ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('color', ca);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    root.add(pts);
    return {
      pos, col, pa, ca, used: 0, cap: n, dirty: false,
      age: new Float32Array(n), life: new Float32Array(n),
      seed: new Float32Array(n), rad: new Float32Array(n),
    };
  }
  const flames = makePool(FLAME_N, 0.6, 0.9);
  const smoke = makePool(SMOKE_N, 1.1, 0.3);

  const emitters = [];
  function addEmitter(pool, x, y, z, count, scale, rise, lifeBase, lifeVar) {
    if (pool.used + count > pool.cap) count = Math.max(0, pool.cap - pool.used);
    const e = { x, y, z, pool, start: pool.used, count, scale, rise, active: true, wasOn: false };
    pool.used += count;
    for (let i = e.start; i < e.start + e.count; i++) {
      pool.life[i] = lifeBase + ((i * 5) % 7) / 7 * lifeVar;
      pool.age[i] = (i * 0.317) % pool.life[i];
      pool.seed[i] = (i * 2.399) % 6.283;
      pool.rad[i] = ((i * 73) % 17) / 17;
    }
    emitters.push(e);
    return e;
  }

  function updateEmitters(dt) {
    const cp = g.camera.position;
    for (let k = 0; k < emitters.length; k++) {
      const e = emitters[k];
      const P = e.pool;
      const dx = e.x - cp.x, dz = e.z - cp.z;
      const near = e.active && e.count > 0 && (dx * dx + dz * dz) < 25600; // 160u
      if (near) {
        e.wasOn = true;
        const isFlame = P === flames;
        for (let i = e.start, end = e.start + e.count; i < end; i++) {
          let a = P.age[i] + dt;
          if (a >= P.life[i]) {
            a -= P.life[i];
            if (a >= P.life[i]) a = 0;
            P.seed[i] = Math.random() * 6.283; // transient VFX rng is allowed
            P.rad[i] = Math.random();
          }
          P.age[i] = a;
          const tN = a / P.life[i];
          const i3 = i * 3;
          if (isFlame) {
            const spread = 0.3 * e.scale * (1 - tN * 0.55);
            P.pos[i3] = e.x + Math.cos(P.seed[i] * 9) * P.rad[i] * spread + Math.sin(a * 9 + P.seed[i]) * 0.05;
            P.pos[i3 + 1] = e.y + tN * e.rise;
            P.pos[i3 + 2] = e.z + Math.sin(P.seed[i] * 7) * P.rad[i] * spread + Math.cos(a * 8 + P.seed[i]) * 0.05;
            const f = 1 - tN, fin = Math.min(1, tN * 8);
            P.col[i3] = (0.95 * f + 0.2) * fin;
            P.col[i3 + 1] = (0.58 * f * f + 0.02) * fin;
            P.col[i3 + 2] = 0.1 * f * f * f * fin;
          } else {
            const spread = (0.25 + tN * 0.95) * e.scale;
            P.pos[i3] = e.x + Math.cos(P.seed[i] * 5) * P.rad[i] * spread
              + Math.sin(a * 1.2 + P.seed[i]) * 0.3 * tN + tN * e.scale * 0.7;
            P.pos[i3 + 1] = e.y + tN * e.rise;
            P.pos[i3 + 2] = e.z + Math.sin(P.seed[i] * 5) * P.rad[i] * spread;
            const v = 0.15 * (1 - tN) * Math.min(1, tN * 6);
            P.col[i3] = v; P.col[i3 + 1] = v; P.col[i3 + 2] = v * 1.08;
          }
        }
        P.dirty = true;
      } else if (e.wasOn) {
        e.wasOn = false;
        for (let i = e.start, end = e.start + e.count; i < end; i++) P.pos[i * 3 + 1] = -999;
        P.dirty = true;
      }
    }
    if (flames.dirty) { flames.pa.needsUpdate = true; flames.ca.needsUpdate = true; flames.dirty = false; }
    if (smoke.dirty) { smoke.pa.needsUpdate = true; smoke.ca.needsUpdate = true; smoke.dirty = false; }
  }

  // ---- cross-POI merged builders (1 draw call each, world-spanning) --------
  const glowB = new Builder(51);  // windows / lanterns / candles  → MAT.glow
  const fireB = new Builder(52);  // coal beds / embers            → MAT.fire
  const discB = new Builder(53);  // fake ground-glow discs        → MAT.glowDisc

  // ---- chests ---------------------------------------------------------------
  let chestBaseGeo = null, chestLidGeo = null;
  {
    const b = new Builder(311);
    b.add(TPL.box, 0, 0.27, 0, 0.98, 0.54, 0.6, 0, 0, 0, 0x7a5228, 0.05);
    b.add(TPL.box, -0.3, 0.27, 0, 0.08, 0.58, 0.64, 0, 0, 0, 0x3d3d44, 0.02);
    b.add(TPL.box, 0.3, 0.27, 0, 0.08, 0.58, 0.64, 0, 0, 0, 0x3d3d44, 0.02);
    chestBaseGeo = b.geo();
    const l = new Builder(312);
    l.add(TPL.box, 0, 0.11, 0.3, 0.98, 0.22, 0.6, 0, 0, 0, 0x8a5f30, 0.05);
    l.add(TPL.box, -0.3, 0.12, 0.3, 0.08, 0.26, 0.64, 0, 0, 0, 0x3d3d44, 0.02);
    l.add(TPL.box, 0.3, 0.12, 0.3, 0.08, 0.26, 0.64, 0, 0, 0, 0x3d3d44, 0.02);
    l.add(TPL.box, 0, 0.08, 0.61, 0.14, 0.18, 0.06, 0, 0, 0, 0xc9a441, 0.02);
    chestLidGeo = l.geo();
  }

  const chests = [];
  function addChest(id, x, z, ry, opts = {}) {
    const gy = opts.y !== undefined ? opts.y : terrainHeight(x, z);
    const grp = new THREE.Group();
    grp.position.set(x, gy, z);
    grp.rotation.y = ry;
    if (opts.scale) grp.scale.setScalar(opts.scale);
    const base = new THREE.Mesh(chestBaseGeo, MAT.static);
    base.castShadow = true; base.receiveShadow = true;
    const lid = new THREE.Group();
    lid.position.set(0, 0.54, -0.3);
    const lidMesh = new THREE.Mesh(chestLidGeo, MAT.static);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    grp.add(base, lid);
    root.add(grp);
    const c = { id, lid, anim: -1 };
    chests.push(c);
    const seedI = chests.length;
    addInter(x, gy + 0.6, z, 2.3, opts.label || 'Open Chest', () => {
      if (g.flags['chest_' + id]) return;
      g.flags['chest_' + id] = true;
      c.anim = 0;
      g.events.emit('chestOpened', { id });
      const lp = { x: x + Math.sin(ry) * 1.2, y: gy + 0.6, z: z + Math.cos(ry) * 1.2 };
      const gold = 15 + Math.floor(srand(seedI, 91, 4001) * 46);
      g.events.emit('spawnLoot', { pos: lp, kind: 'gold', amount: gold });
      if (srand(seedI, 17, 4002) < 0.5) g.events.emit('spawnLoot', { pos: lp, kind: 'potion', amount: 1 });
      if (opts.itemId) g.events.emit('spawnLoot', { pos: lp, kind: 'item', amount: 1, itemId: opts.itemId });
      if (opts.onOpen) opts.onOpen();
    }, () => !g.flags['chest_' + id]);
    return c;
  }

  // ---- shared prop builders --------------------------------------------------
  const chimneys = []; // smoke emitters toggled by time of day

  function campfire(b, x, z, scale) {
    const gy = terrainHeight(x, z);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3;
      b.add(TPL.box, x + Math.cos(a) * 0.85 * scale, gy + 0.13, z + Math.sin(a) * 0.85 * scale,
        0.45, 0.28, 0.32, 0.25, a, 0.15, C_DARKSTONE, 0.13);
    }
    b.add(TPL.cyl6, x + 0.1, gy + 0.24, z, 0.22, 1.4 * scale, 0.22, 1.35, 0.5, 0, 0x4e3722, 0.08);
    b.add(TPL.cyl6, x - 0.1, gy + 0.24, z, 0.22, 1.3 * scale, 0.22, 1.4, 2.1, 0, 0x46311e, 0.08);
    fireB.add(TPL.sphere, x, gy + 0.16, z, 0.9 * scale, 0.3, 0.9 * scale, 0, 0, 0, 0xff8226, 0.05);
    discB.add(TPL.disc, x, gy + 0.09, z, 3.4 * scale, 3.4 * scale, 1, -Math.PI / 2, 0, 0, 0xff8630, 0);
    addEmitter(flames, x, gy + 0.35, z, Math.round(8 * scale), 0.85 * scale, 1.2 * scale, 0.55, 0.35);
    return gy;
  }

  function barrel(b, x, z) {
    const gy = terrainHeight(x, z);
    b.add(TPL.cyl, x, gy + 0.42, z, 0.75, 0.85, 0.75, 0, 0, 0, C_WOOD, 0.08);
    b.add(TPL.cyl, x, gy + 0.42, z, 0.79, 0.14, 0.79, 0, 0, 0, 0x4a4a50, 0.03);
  }
  function crate(b, x, z, s, ry) {
    const gy = terrainHeight(x, z);
    b.add(TPL.box, x, gy + s / 2, z, s, s, s, 0, ry, 0, 0x8a6a3c, 0.1);
  }

  // ==========================================================================
  // EMBERHOLLOW VILLAGE — the cozy heart of the game
  // ==========================================================================
  function house(b, x, z, ry, w, d, h, seed, big) {
    const gy = terrainHeight(x, z);
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const W = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    const plaster = C_PLASTER[Math.floor(srand(seed, 1, 811) * C_PLASTER.length)];
    const thatch = C_THATCH[Math.floor(srand(seed, 2, 811) * C_THATCH.length)];
    const roofH = 1.5 + srand(seed, 3, 811) * 0.9;
    b.add(TPL.box, x, gy + 0.3, z, w + 0.3, 0.6, d + 0.3, 0, ry, 0, C_STONE, 0.11);
    b.add(TPL.box, x, gy + 0.55 + h / 2, z, w, h, d, 0, ry, 0, plaster, 0.05);
    b.add(TPL.prism, x, gy + 0.55 + h, z, w + 1.0, roofH, d + 1.0, 0, ry, 0, thatch, 0.09);
    for (let cx = -1; cx <= 1; cx += 2) for (let cz = -1; cz <= 1; cz += 2) {
      const [wx, wz] = W(cx * w / 2, cz * d / 2);
      b.add(TPL.box, wx, gy + 0.55 + h / 2, wz, 0.26, h, 0.26, 0, ry, 0, C_TIMBER, 0.05);
    }
    let [bx, bz] = W(0, d / 2 + 0.03);
    b.add(TPL.box, bx, gy + 0.55 + h * 0.62, bz, w, 0.18, 0.14, 0, ry, 0, C_TIMBER, 0.05);
    [bx, bz] = W(big ? -w * 0.24 : 0, d / 2 + 0.1);
    b.add(TPL.box, bx, gy + 1.42, bz, 1.0, 1.75, 0.15, 0, ry, 0, 0x4c3620, 0.04);
    // warm windows — the emotional beacon at night
    const wxs = big ? [w * 0.02, w * 0.3, -w * 0.42] : [-w * 0.28, w * 0.28];
    for (const lx of wxs) {
      const [qx, qz] = W(lx, d / 2 + 0.08);
      glowB.add(TPL.quad, qx, gy + 1.9, qz, 0.6, 0.72, 1, 0, ry, 0, 0xffcf7a, 0);
    }
    { const [qx, qz] = W(w * 0.18, -d / 2 - 0.08);
      glowB.add(TPL.quad, qx, gy + 1.9, qz, 0.6, 0.72, 1, 0, ry + Math.PI, 0, 0xffcf7a, 0); }
    // chimney + smoke
    const [cx, cz] = W(w * 0.3, 0);
    const cTop = gy + 0.55 + h + roofH * 0.55 + 1.0;
    b.add(TPL.box, cx, cTop - 0.75, cz, 0.6, 1.7, 0.6, 0, ry, 0, C_DARKSTONE, 0.09);
    b.add(TPL.box, cx, cTop, cz, 0.82, 0.22, 0.82, 0, ry, 0, C_DARKSTONE, 0.09);
    chimneys.push(addEmitter(smoke, cx, cTop + 0.2, cz, 6, 0.9, 3.8, 2.6, 1.2));
    // colliders: 2 cylinders along the long axis
    const cr = d / 2 + 0.45, off = Math.max(0, w / 2 - d / 2);
    for (let s = -1; s <= 1; s += 2) {
      const [ox, oz] = W(s * off, 0);
      addCol(ox, oz, cr);
    }
    return { x, z, gy, ry, W };
  }

  function stall(b, x, z, ry, canvas, seed) {
    const gy = terrainHeight(x, z);
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const W = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    for (let cx = -1; cx <= 1; cx += 2) for (let cz = -1; cz <= 1; cz += 2) {
      const [wx, wz] = W(cx * 1.35, cz * 1.0);
      b.add(TPL.box, wx, gy + 1.1, wz, 0.16, 2.2, 0.16, 0, ry, 0, C_TIMBER, 0.06);
    }
    b.add(TPL.box, x, gy + 2.28, z, 3.2, 0.12, 2.6, 0.2, ry, 0, canvas, 0.05);
    const [fx, fz] = W(0, 0.75);
    b.add(TPL.box, fx, gy + 0.5, fz, 2.7, 1.0, 0.8, 0, ry, 0, C_WOOD, 0.08);
    // goods on the counter
    for (let i = 0; i < 3; i++) {
      const [gx2, gz2] = W(-0.8 + i * 0.8, 0.75);
      if (srand(seed, i, 812) < 0.5) b.add(TPL.box, gx2, gy + 1.15, gz2, 0.4, 0.3, 0.4, 0, ry + i, 0, 0xd9b46a, 0.1);
      else b.add(TPL.sphere, gx2, gy + 1.14, gz2, 0.32, 0.28, 0.32, 0, 0, 0, 0xc23b2c, 0.12);
    }
    addCol(x, z, 1.6);
  }

  function lantern(b, x, z) {
    const gy = terrainHeight(x, z);
    b.add(TPL.cyl6, x, gy + 1.3, z, 0.2, 2.6, 0.2, 0, 0, 0, C_TIMBER, 0.06);
    b.add(TPL.box, x, gy + 2.72, z, 0.4, 0.12, 0.4, 0, 0.5, 0, 0x3a3a40, 0.03);
    glowB.add(TPL.box, x, gy + 2.5, z, 0.24, 0.3, 0.24, 0, 0.4, 0, 0xffd27f, 0);
    b.add(TPL.cone, x, gy + 2.86, z, 0.42, 0.22, 0.42, 0, 0, 0, 0x3a3a40, 0.03);
    addCol(x, z, 0.3);
  }

  function path(b, x1, z1, x2, z2, wdt) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 7));
    const yaw = Math.atan2(dx, dz);
    for (let i = 0; i < n; i++) {
      const ax = x1 + dx * i / n, az = z1 + dz * i / n;
      const ex = x1 + dx * (i + 1) / n, ez = z1 + dz * (i + 1) / n;
      const ha = terrainHeight(ax, az), hb = terrainHeight(ex, ez);
      const seg = len / n;
      const pitch = Math.atan2(ha - hb, seg);
      b.add(TPL.box, (ax + ex) / 2, (ha + hb) / 2 + 0.03, (az + ez) / 2,
        wdt, 0.07, seg + 0.5, pitch, yaw, 0, C_DIRT, 0.13);
    }
  }

  function fence(b, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 2.4));
    const yaw = Math.atan2(dx, dz);
    let px = x1, pz = z1, ph = terrainHeight(x1, z1);
    b.add(TPL.box, px, ph + 0.55, pz, 0.16, 1.1, 0.16, 0, yaw, 0, C_WOOD, 0.12);
    for (let i = 1; i <= n; i++) {
      const nx = x1 + dx * i / n, nz = z1 + dz * i / n, nh = terrainHeight(nx, nz);
      b.add(TPL.box, nx, nh + 0.55, nz, 0.16, 1.1, 0.16, 0, yaw, 0, C_WOOD, 0.12);
      const seg = len / n, pitch = Math.atan2(ph - nh, seg);
      b.add(TPL.box, (px + nx) / 2, (ph + nh) / 2 + 0.85, (pz + nz) / 2, 0.09, 0.13, seg, pitch, yaw, 0, C_WOOD, 0.1);
      b.add(TPL.box, (px + nx) / 2, (ph + nh) / 2 + 0.45, (pz + nz) / 2, 0.09, 0.13, seg, pitch, yaw, 0, C_WOOD, 0.1);
      px = nx; pz = nz; ph = nh;
    }
  }

  function buildVillage() {
    const b = new Builder(101);
    // plaza + dirt paths
    const py = terrainHeight(0, 0);
    b.add(TPL.disc, 0, py + 0.05, 0, 21, 21, 1, -Math.PI / 2, 0, 0, C_DIRT, 0.14);
    path(b, 0, 11, 0, 66, 3.2);       // south road (spawn approach)
    path(b, 0, -11, -5, -60, 3.0);    // north road
    path(b, 10, 4, 28, 11, 2.2);
    path(b, -10, 5, -26, 14, 2.2);
    path(b, 9, -6, 26, -13, 2.2);
    path(b, -9, -6, -28, -17, 2.2);
    path(b, 6, -10, 7, -30, 2.2);
    // houses ringing the plaza
    const HP = [
      [26, -13, 6.4, 4.6, 2.7], [-27, -17, 6.0, 4.4, 2.6], [7, -32, 6.8, 4.8, 2.8],
      [-11, 27, 6.2, 4.4, 2.7], [-33, 3, 5.8, 4.2, 2.6], [27, 22, 6.6, 4.6, 2.8],
      [-20, -33, 5.6, 4.2, 2.5], [38, 5, 6.2, 4.6, 2.7],
    ];
    for (let i = 0; i < HP.length; i++) {
      const [hx, hz, w, d, h] = HP[i];
      house(b, hx, hz, Math.atan2(-hx, -hz), w, d, h, i + 1, false);
    }
    // the inn — big, warm, near spawn — with a hanging sign
    const inn = house(b, 17, 10, Math.atan2(-17, -10), 9.5, 6, 3.3, 99, true);
    {
      const [sx, sz] = inn.W(4.4, 3.6);
      const sy = terrainHeight(sx, sz);
      b.add(TPL.box, sx, sy + 1.6, sz, 0.18, 3.2, 0.18, 0, inn.ry, 0, C_TIMBER, 0.05);
      b.add(TPL.box, sx, sy + 3.1, sz, 1.1, 0.14, 0.14, 0, inn.ry + Math.PI / 2, 0, C_TIMBER, 0.05);
      const [qx, qz] = inn.W(4.4, 4.35);
      b.add(TPL.quad, qx, sy + 2.55, qz, 0.95, 0.75, 1, 0, inn.ry, 0, 0x8a4a2c, 0.05);
      b.add(TPL.quad, qx, sy + 2.55, qz, 0.95, 0.75, 1, 0, inn.ry + Math.PI, 0, 0x8a4a2c, 0.05);
    }
    // the forge — open smithy with awning, hearth coals, anvil
    {
      const fx = -17, fz = 12, ry = Math.atan2(17, -12);
      const gy = terrainHeight(fx, fz);
      const cos = Math.cos(ry), sin = Math.sin(ry);
      const W = (lx, lz) => [fx + lx * cos + lz * sin, fz - lx * sin + lz * cos];
      for (let cx = -1; cx <= 1; cx += 2) for (let cz = -1; cz <= 1; cz += 2) {
        const [wx, wz] = W(cx * 2.4, cz * 1.9);
        b.add(TPL.box, wx, gy + 1.35, wz, 0.28, 2.7, 0.28, 0, ry, 0, C_TIMBER, 0.06);
      }
      b.add(TPL.box, fx, gy + 2.85, fz, 6.0, 0.16, 4.8, 0.15, ry, 0, 0x6b4a2a, 0.09);
      const [hx, hz] = W(-1.3, -0.7);
      b.add(TPL.box, hx, gy + 0.5, hz, 1.7, 1.0, 1.3, 0, ry, 0, C_DARKSTONE, 0.1);
      fireB.add(TPL.box, hx, gy + 1.04, hz, 0.95, 0.14, 0.72, 0, ry, 0, 0xff8226, 0.05);
      discB.add(TPL.disc, hx, gy + 1.12, hz, 2.4, 2.4, 1, -Math.PI / 2, 0, 0, 0xff8630, 0);
      const [ax, az] = W(0.7, 0.4);
      b.add(TPL.box, ax, gy + 0.35, az, 0.5, 0.7, 0.5, 0, ry, 0, 0x5a4632, 0.06);
      b.add(TPL.box, ax, gy + 0.8, az, 1.05, 0.24, 0.36, 0, ry, 0, 0x62666e, 0.04);
      const [ux, uz] = W(2.0, -1.0);
      barrel(b, ux, uz);
      const [mx, mz] = W(-1.3, -1.85);
      b.add(TPL.box, mx, gy + 2.2, mz, 0.7, 4.4, 0.7, 0, ry, 0, C_DARKSTONE, 0.09);
      chimneys.push(addEmitter(smoke, mx, gy + 4.5, mz, 6, 0.9, 3.6, 2.4, 1.0));
      addEmitter(flames, hx, gy + 1.1, hz, 6, 0.55, 0.7, 0.5, 0.3);
      addCol(fx, fz, 2.7);
    }
    // market stalls around the plaza
    stall(b, 12, 3, Math.atan2(-12, -3), C_CANVAS[0], 1);
    stall(b, -11, 7, Math.atan2(11, -7), C_CANVAS[1], 2);
    stall(b, 4, -13, Math.atan2(-4, 13), C_CANVAS[2], 3);
    // the stone well (Elder Maera's spot)
    {
      const wy = terrainHeight(0, -2);
      b.add(TPL.cyl12, 0, wy + 0.45, -2, 2.4, 0.9, 2.4, 0, 0, 0, C_STONE, 0.12);
      b.add(TPL.disc, 0, wy + 0.72, -2, 1.8, 1.8, 1, -Math.PI / 2, 0, 0, 0x21445a, 0.05);
      b.add(TPL.box, -1.05, wy + 1.55, -2, 0.16, 1.7, 0.16, 0, 0, 0, C_TIMBER, 0.06);
      b.add(TPL.box, 1.05, wy + 1.55, -2, 0.16, 1.7, 0.16, 0, 0, 0, C_TIMBER, 0.06);
      b.add(TPL.cyl, 0, wy + 2.15, -2, 0.22, 2.3, 0.22, 0, 0, Math.PI / 2, C_WOOD, 0.06);
      b.add(TPL.box, 0, wy + 1.35, -2, 0.34, 0.42, 0.34, 0, 0.4, 0, 0x6a5232, 0.08);
      b.add(TPL.prism, 0, wy + 2.35, -2, 2.7, 0.8, 1.7, 0, Math.PI / 2, 0, C_THATCH[0], 0.08);
      addCol(0, -2, 1.5);
    }
    // lantern posts — amber at night, strung along the paths
    const LP = [[8, 9], [-8, 9], [9, -9], [-9, -9], [2, 26], [-2, 42], [14, -17], [-16, -2], [1, -24]];
    for (const [lx, lz] of LP) lantern(b, lx, lz);
    // fenced field, hay, clutter (south-east)
    fence(b, 31, -6, 44, -13);
    fence(b, 44, -13, 48, -26);
    fence(b, 48, -26, 36, -31);
    b.add(TPL.box, 40, terrainHeight(40, -20) + 0.5, -20, 1.6, 1.0, 1.2, 0, 0.5, 0, 0xc2a24d, 0.12);
    b.add(TPL.box, 42.5, terrainHeight(42.5, -22) + 0.4, -22, 1.3, 0.8, 1.1, 0, 1.2, 0, 0xb59440, 0.12);
    barrel(b, 20.5, 14.5);
    crate(b, 21.8, 13.4, 0.8, 0.4);
    // village chest tucked behind the inn
    addChest('village', 23.5, 16.5, Math.atan2(-23.5, -16.5) + Math.PI, {});
    root.add(b.build(MAT.static));
  }

  // ==========================================================================
  // BARROWDEEP RUINS — broken column circle + sunken barrow crypt chamber
  // ==========================================================================
  function colRow(x1, z1, x2, z2, r, spacing) {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / spacing));
    for (let i = 0; i <= n; i++) addCol(x1 + (x2 - x1) * i / n, z1 + (z2 - z1) * i / n, r);
  }

  function buildRuins() {
    const P = POI.ruins;
    const b = new Builder(201);
    const ccx = P.x, ccz = P.z + 10; // column circle north of the crypt
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const x = ccx + Math.cos(a) * 15, z = ccz + Math.sin(a) * 15;
      const gy = terrainHeight(x, z);
      const full = i < 2 || srand(i, 4, 821) < 0.22;
      const h = full ? 5.6 + srand(i, 5, 821) * 0.8 : 1.4 + srand(i, 6, 821) * 2.4;
      const tilt = full ? 0 : (srand(i, 7, 821) - 0.5) * 0.18;
      const col = i % 2 ? 0x7e8379 : C_MOSS;
      b.add(TPL.box, x, gy + 0.2, z, 2.2, 0.45, 2.2, 0, a, 0, 0x767b71, 0.12);       // plinth
      b.add(TPL.cyl, x, gy + 0.4 + h / 2, z, 1.5, h, 1.5, tilt, a, tilt * 0.7, col, 0.13);
      if (full) b.add(TPL.box, x, gy + 0.65 + h, z, 2.1, 0.5, 2.1, 0, a, 0, 0x787d73, 0.1);
      addCol(x, z, 1.1);
    }
    // lintel arch across the two full columns (i = 0, 1)
    {
      const x0 = ccx + Math.cos(0) * 15, z0 = ccz + Math.sin(0) * 15;
      const a1 = Math.PI * 2 / 10;
      const x1 = ccx + Math.cos(a1) * 15, z1 = ccz + Math.sin(a1) * 15;
      const h0 = terrainHeight(x0, z0), h1 = terrainHeight(x1, z1);
      b.add(TPL.box, (x0 + x1) / 2, Math.max(h0, h1) + 6.9, (z0 + z1) / 2,
        1.3, 0.7, Math.hypot(x1 - x0, z1 - z0) + 1.6, 0, Math.atan2(x1 - x0, z1 - z0), 0, 0x7a7f75, 0.1);
    }
    // fallen column drums + collapsed walls + rubble
    b.add(TPL.cyl, ccx + 6, terrainHeight(ccx + 6, ccz + 3) + 0.7, ccz + 3, 1.4, 3.6, 1.4, Math.PI / 2, 0.7, 0, 0x788070, 0.13);
    b.add(TPL.cyl, ccx - 8, terrainHeight(ccx - 8, ccz - 4) + 0.6, ccz - 4, 1.3, 2.6, 1.3, Math.PI / 2, 2.2, 0, 0x748068, 0.13);
    for (let i = 0; i < 4; i++) {
      const a = 0.8 + i * 1.5;
      const wx = ccx + Math.cos(a) * 22, wz = ccz + Math.sin(a) * 22;
      const wy = terrainHeight(wx, wz);
      b.add(TPL.box, wx, wy + 0.65, wz, 5.5, 1.3 + srand(i, 8, 822) * 1.1, 0.9, 0, -a - Math.PI / 2, 0.04, C_MOSS, 0.14);
    }
    for (let i = 0; i < 8; i++) {
      const rx3 = ccx + (srand(i, 9, 823) - 0.5) * 34, rz3 = ccz + (srand(i, 10, 823) - 0.5) * 34;
      b.add(TPL.sphere, rx3, terrainHeight(rx3, rz3) + 0.2, rz3, 0.9, 0.55, 0.8, 0, i * 2.1, 0, 0x757a6d, 0.14);
    }

    // ---- the crypt: enclosed barrow chamber, door gap facing north ----
    const cx = P.x, cz = P.z - 16;
    const gy = terrainHeight(cx, cz);
    b.add(TPL.box, cx, gy + 0.06, cz, 8, 0.12, 8, 0, 0, 0, 0x60635c, 0.09);            // floor
    b.add(TPL.box, cx, gy + 1.7, cz + 4.05, 8.8, 3.4, 0.7, 0, 0, 0, C_MOSS, 0.13);     // back (south)
    b.add(TPL.box, cx - 4.05, gy + 1.7, cz, 0.7, 3.4, 8.8, 0, 0, 0, C_MOSS, 0.13);     // west
    b.add(TPL.box, cx + 4.05, gy + 1.7, cz, 0.7, 3.4, 8.8, 0, 0, 0, C_MOSS, 0.13);     // east
    b.add(TPL.box, cx - 2.75, gy + 1.7, cz - 4.05, 3.1, 3.4, 0.7, 0, 0, 0, C_MOSS, 0.13); // front L
    b.add(TPL.box, cx + 2.75, gy + 1.7, cz - 4.05, 3.1, 3.4, 0.7, 0, 0, 0, C_MOSS, 0.13); // front R
    b.add(TPL.box, cx, gy + 3.3, cz - 4.05, 2.8, 0.7, 1.0, 0, 0, 0, C_DARKSTONE, 0.08);   // door lintel
    // stepped stone roof (barrow silhouette, no clipping into the chamber)
    b.add(TPL.box, cx, gy + 3.7, cz, 9.8, 0.6, 9.8, 0, 0, 0, C_DARKSTONE, 0.11);
    b.add(TPL.box, cx, gy + 4.25, cz, 7.4, 0.55, 7.4, 0, 0.05, 0, 0x676c62, 0.11);
    b.add(TPL.box, cx, gy + 4.75, cz, 4.8, 0.5, 4.8, 0, -0.04, 0, 0x606656, 0.11);
    b.add(TPL.box, cx, gy + 5.2, cz, 2.4, 0.5, 2.4, 0, 0.08, 0, 0x5a604f, 0.11);
    // earth berms leaning on the outer walls → "dug into the hill" read
    b.add(TPL.box, cx - 5.4, gy + 0.9, cz, 2.6, 2.6, 9.6, 0, 0, 0.5, 0x5e5a46, 0.12);
    b.add(TPL.box, cx + 5.4, gy + 0.9, cz, 2.6, 2.6, 9.6, 0, 0, -0.5, 0x5e5a46, 0.12);
    b.add(TPL.box, cx, gy + 0.9, cz + 5.4, 9.6, 2.6, 2.6, -0.5, 0, 0, 0x5e5a46, 0.12);
    // sunken entrance corridor (walls rise toward the door)
    b.add(TPL.box, cx - 1.8, gy + 0.95, cz - 7.2, 0.6, 1.9, 6.4, 0.09, 0, 0, C_MOSS, 0.13);
    b.add(TPL.box, cx + 1.8, gy + 0.95, cz - 7.2, 0.6, 1.9, 6.4, 0.09, 0, 0, C_MOSS, 0.13);
    // interior: sarcophagus, skulls, ember bowls in the back corners
    b.add(TPL.box, cx - 2.4, gy + 0.55, cz + 1.2, 1.1, 0.9, 2.3, 0, 0.06, 0, 0x6b7062, 0.1);
    b.add(TPL.box, cx - 2.4, gy + 1.05, cz + 1.2, 1.25, 0.2, 2.45, 0, 0.06, 0, 0x757a6b, 0.1);
    b.add(TPL.sphere, cx + 2.6, gy + 0.2, cz + 0.6, 0.32, 0.3, 0.32, 0, 1, 0, 0xcfc8b4, 0.08);
    b.add(TPL.sphere, cx + 2.2, gy + 0.17, cz + 1.1, 0.28, 0.26, 0.28, 0, 2, 0, 0xc5bea9, 0.08);
    fireB.add(TPL.sphere, cx - 3.1, gy + 0.25, cz + 3.1, 0.55, 0.25, 0.55, 0, 0, 0, 0xff8226, 0.05);
    fireB.add(TPL.sphere, cx + 3.1, gy + 0.25, cz + 3.1, 0.55, 0.25, 0.55, 0, 0, 0, 0xff8226, 0.05);
    discB.add(TPL.disc, cx - 3.1, gy + 0.34, cz + 3.1, 2.0, 2.0, 1, -Math.PI / 2, 0, 0, 0xff8630, 0);
    discB.add(TPL.disc, cx + 3.1, gy + 0.34, cz + 3.1, 2.0, 2.0, 1, -Math.PI / 2, 0, 0, 0xff8630, 0);
    // wall colliders (door gap kept clear)
    colRow(cx - 3.6, cz + 3.95, cx + 3.6, cz + 3.95, 1.0, 1.5);
    colRow(cx - 3.95, cz - 3.4, cx - 3.95, cz + 3.4, 1.0, 1.5);
    colRow(cx + 3.95, cz - 3.4, cx + 3.95, cz + 3.4, 1.0, 1.5);
    addCol(cx - 2.7, cz - 3.95, 1.0); addCol(cx - 1.65, cz - 3.95, 0.85);
    addCol(cx + 2.7, cz - 3.95, 1.0); addCol(cx + 1.65, cz - 3.95, 0.85);
    colRow(cx - 1.85, cz - 10, cx - 1.85, cz - 4.6, 0.7, 1.4);
    colRow(cx + 1.85, cz - 10, cx + 1.85, cz - 4.6, 0.7, 1.4);
    addCol(cx - 2.4, cz + 1.2, 1.2); // sarcophagus
    // Aldric's sword chest at the back of the chamber, facing the door
    addChest('aldric', cx + 0.6, cz + 2.6, Math.PI, {
      label: 'Open Ancient Chest', itemId: 'aldricSword', scale: 1.25,
      onOpen: () => { g.flags.aldricChestOpened = true; },
    });
    root.add(b.build(MAT.static));
  }

  // ==========================================================================
  // THE WARDSTONES — 5 monoliths, rune faces glow cyan once cleansed
  // ==========================================================================
  function buildStones() {
    const P = POI.stones;
    const b = new Builder(301);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + 0.55;
      const x = P.x + Math.cos(a) * 8.5, z = P.z + Math.sin(a) * 8.5;
      const gy = terrainHeight(x, z);
      const h = 3.4 + srand(i, 2, 831) * 2.2;
      const ry = Math.atan2(P.x - x, P.z - z);
      const tilt = (srand(i, 3, 831) - 0.5) * 0.1;
      b.add(TPL.box, x, gy + h / 2 - 0.15, z, 1.5, h, 0.95, 0, ry, tilt, 0x4d525c, 0.1);
      b.add(TPL.box, x, gy + h - 0.2, z, 1.15, 0.9, 0.75, 0, ry + 0.12, tilt, 0x454a53, 0.1);
      b.add(TPL.sphere, x + 0.9, gy + 0.15, z + 0.4, 0.8, 0.5, 0.7, 0, i, 0, 0x5a5f66, 0.13);
      b.add(TPL.sphere, x - 0.7, gy + 0.12, z - 0.5, 0.6, 0.4, 0.6, 0, i * 2, 0, 0x565b62, 0.13);
      // carved rune glyphs on the inward face
      const fx = x + Math.sin(ry) * 0.56, fz = z + Math.cos(ry) * 0.56;
      for (let k = 0; k < 4; k++) {
        runeB.add(TPL.quad, fx, gy + h * 0.24 + k * h * 0.15, fz,
          0.24, 0.36, 1, 0, ry, (srand(i, k, 832) - 0.5) * 0.9, 0x9fe8ff, 0);
      }
      addCol(x, z, 1.05);
    }
    const cy = terrainHeight(P.x, P.z);
    b.add(TPL.cyl12, P.x, cy + 0.2, P.z, 3.4, 0.45, 3.4, 0, 0, 0, 0x51565e, 0.1);
    b.add(TPL.box, P.x, cy + 0.7, P.z, 1.2, 0.6, 1.2, 0, 0.4, 0, 0x4a4f58, 0.08);
    root.add(b.build(MAT.static));
  }

  // ==========================================================================
  // GREYWATCH TOWER — climb/descend teleports + quest beacon brazier
  // ==========================================================================
  const TW = { x: POI.tower.x, z: POI.tower.z, topY: 0 };
  let beaconFlame = null, beaconDisc = null, beaconFlameEm = null, beaconSmokeEm = null;

  function syncBeacon() {
    const lit = !!g.flags.beaconLit;
    if (beaconFlame) beaconFlame.visible = lit;
    if (beaconDisc) beaconDisc.visible = lit;
    if (beaconFlameEm) beaconFlameEm.active = lit;
    if (beaconSmokeEm) beaconSmokeEm.active = lit;
  }

  function buildTower() {
    const x = TW.x, z = TW.z;
    const gy = terrainHeight(x, z);
    const topY = gy + 14.3;
    TW.topY = topY;
    const b = new Builder(401);
    b.add(TPL.cyl12, x, gy + 1.0, z, 8.6, 2.2, 8.6, 0, 0, 0, C_DARKSTONE, 0.1);
    b.add(TPL.cyl12, x, gy + 7.0, z, 6.6, 14.0, 6.6, 0, 0.13, 0, 0x84868a, 0.09);
    b.add(TPL.cyl12, x, gy + 5.2, z, 7.0, 0.5, 7.0, 0, 0, 0, C_DARKSTONE, 0.07);
    b.add(TPL.cyl12, x, gy + 10.2, z, 7.0, 0.5, 7.0, 0, 0, 0, C_DARKSTONE, 0.07);
    b.add(TPL.cyl12, x, gy + 14.0, z, 7.8, 0.6, 7.8, 0, 0.13, 0, 0x7b7d80, 0.08); // platform, top = +14.3
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const mx = x + Math.cos(a) * 3.55, mz = z + Math.sin(a) * 3.55;
      b.add(TPL.box, mx, topY + 0.55, mz, 1.05, 1.1, 0.6, 0, -a - Math.PI / 2, 0, 0x85878b, 0.09);
      addCol(mx, mz, 0.72, gy + 12.8, gy + 17.5); // parapet keeps you from strolling off
    }
    for (let i = 0; i < 14; i++) { // decorative spiral stair hugging the wall
      const a = 0.6 + i * 0.52, sy = gy + 1.3 + i * 0.82;
      b.add(TPL.box, x + Math.cos(a) * 3.72, sy, z + Math.sin(a) * 3.72,
        1.7, 0.22, 0.85, 0, -a - Math.PI / 2, 0, 0x76787c, 0.08);
    }
    const da = Math.atan2(-x, -z); // door faces Emberhollow
    const dx = x + Math.sin(da) * 3.28, dz = z + Math.cos(da) * 3.28;
    b.add(TPL.box, dx, gy + 1.55, dz, 1.5, 2.5, 0.4, 0, da, 0, 0x42301c, 0.05);
    b.add(TPL.box, dx, gy + 2.95, dz, 2.3, 0.55, 0.55, 0, da, 0, C_DARKSTONE, 0.06);
    glowB.add(TPL.quad, x + Math.sin(da) * 3.38, gy + 7.5, z + Math.cos(da) * 3.38, 0.28, 0.9, 1, 0, da, 0, 0xffcf7a, 0);
    glowB.add(TPL.quad, x + Math.sin(da + 2.1) * 3.38, gy + 10.4, z + Math.cos(da + 2.1) * 3.38, 0.28, 0.9, 1, 0, da + 2.1, 0, 0xffcf7a, 0);
    // beacon brazier
    const bx2 = x + 1.3, bz2 = z;
    b.add(TPL.cyl, bx2, topY + 0.45, bz2, 1.0, 0.9, 1.0, 0, 0, 0, 0x4a4a50, 0.05);
    b.add(TPL.cyl, bx2, topY + 1.05, bz2, 1.9, 0.55, 1.9, 0, 0, 0, 0x3c3c42, 0.05);
    b.add(TPL.sphere, bx2, topY + 1.3, bz2, 1.3, 0.5, 1.3, 0, 0, 0, 0x2c241c, 0.16);
    root.add(b.build(MAT.static));
    // lit-state visuals (toggled via g.flags.beaconLit, checked ≤1/s)
    const fb = new Builder(402);
    fb.add(TPL.cone, bx2, topY + 2.3, bz2, 1.5, 2.0, 1.5, 0, 0, 0, 0xffa030, 0.1);
    fb.add(TPL.cone, bx2, topY + 2.15, bz2, 0.9, 1.4, 0.9, 0, 0.7, 0, 0xffd060, 0.1);
    beaconFlame = fb.build(MAT.fire, false);
    beaconFlame.visible = false;
    root.add(beaconFlame);
    const db2 = new Builder(403);
    db2.add(TPL.disc, bx2, topY + 1.44, bz2, 5.2, 5.2, 1, -Math.PI / 2, 0, 0, 0xff8630, 0);
    beaconDisc = db2.build(MAT.glowDisc, false);
    beaconDisc.visible = false;
    root.add(beaconDisc);
    beaconFlameEm = addEmitter(flames, bx2, topY + 1.5, bz2, 16, 1.7, 2.8, 0.6, 0.4);
    beaconFlameEm.active = false;
    beaconSmokeEm = addEmitter(smoke, bx2, topY + 2.8, bz2, 12, 1.6, 6.5, 3.0, 1.4);
    beaconSmokeEm.active = false;
    // tower body blocks at ground level but not while standing on top
    addCol(x, z, 4.05, undefined, gy + 13.2);
    // climb / descend teleport interactables (stairs are visual only)
    addInter(dx + Math.sin(da) * 1.0, gy + 1.2, dz + Math.cos(da) * 1.0, 2.6, 'Climb Greywatch Tower', () => {
      const p = g.player; if (!p) return;
      p.position.set(x - 1.4, topY + 0.05, z);
      p.velocity.set(0, 0, 0);
      p.onGround = true;
    });
    addInter(x - 1.4, topY + 1.2, z, 2.2, 'Descend the Tower', () => {
      const p = g.player; if (!p) return;
      const ox = dx + Math.sin(da) * 1.8, oz = dz + Math.cos(da) * 1.8;
      p.position.set(ox, terrainHeight(ox, oz) + 0.05, oz);
      p.velocity.set(0, 0, 0);
    });
    addInter(bx2, topY + 1.5, bz2, 2.4, 'Light the Beacon', () => {
      if (g.flags.beaconLit) return;
      g.flags.beaconLit = true;
      syncBeacon();
      notify('The beacon of Greywatch roars to life', 'Its light can be seen from Emberhollow');
    }, () => !g.flags.beaconLit);
    // the lost watchman's chest up on the platform
    addChest('tower', x - 0.3, z - 2.1, 2.8, { y: topY });
  }

  // ==========================================================================
  // REDFANG CAMP — tents, campfire, weapon rack, cage, skull totems
  // ==========================================================================
  let cageDoor = null;

  function buildCamp() {
    const P = POI.camp;
    const b = new Builder(511);
    campfire(b, P.x, P.z, 1.3);
    addEmitter(smoke, P.x, terrainHeight(P.x, P.z) + 1.2, P.z, 5, 1.0, 4.5, 3.0, 1.2);
    // tents facing the fire (the big one is Vargr's)
    const tents = [[0.5, 9, 4.4, 2.7, 3.6, 0x77503a], [2.5, 9.5, 4.2, 2.6, 3.4, 0x6e4a38], [4.4, 10, 5.6, 3.3, 4.6, 0x6e3a30]];
    for (let i = 0; i < tents.length; i++) {
      const [a, r, w, h, d, col] = tents[i];
      const tx = P.x + Math.cos(a) * r, tz = P.z + Math.sin(a) * r;
      const gy = terrainHeight(tx, tz);
      const ry = Math.atan2(P.x - tx, P.z - tz);
      b.add(TPL.prism, tx, gy, tz, w, h, d, 0, ry + Math.PI / 2, 0, col, 0.1);
      // dark doorway on the fire-facing gable
      b.add(TPL.box, tx + Math.sin(ry) * (d / 2 - 0.1), gy + 0.65, tz + Math.cos(ry) * (d / 2 - 0.1),
        0.95, 1.3, 0.25, 0, ry, 0, 0x241a12, 0.03);
      addCol(tx, tz, Math.max(w, d) / 2 + 0.2);
      if (i === 2) { // Vargr's banner
        const px = tx + Math.cos(ry) * 2.2, pz = tz - Math.sin(ry) * 2.2;
        const py2 = terrainHeight(px, pz);
        b.add(TPL.cyl6, px, py2 + 2.1, pz, 0.14, 4.2, 0.14, 0, 0, 0, 0x4e3a24, 0.06);
        b.add(TPL.quad, px + Math.sin(ry) * 0.06, py2 + 3.4, pz + Math.cos(ry) * 0.06, 0.9, 1.3, 1, 0, ry, 0, 0xa03028, 0.08);
        b.add(TPL.quad, px - Math.sin(ry) * 0.06, py2 + 3.4, pz - Math.cos(ry) * 0.06, 0.9, 1.3, 1, 0, ry + Math.PI, 0, 0x8a2822, 0.08);
        addChest('camp', tx + Math.sin(ry) * (d / 2 + 1.3) + 1.0, tz + Math.cos(ry) * (d / 2 + 1.3), ry, {});
      }
    }
    // weapon rack
    {
      const rx3 = P.x + 6.5, rz3 = P.z + 4;
      const gy = terrainHeight(rx3, rz3);
      b.add(TPL.box, rx3 - 0.9, gy + 0.8, rz3, 0.15, 1.6, 0.15, 0, 0.6, 0.12, 0x4e3a24, 0.06);
      b.add(TPL.box, rx3 + 0.9, gy + 0.8, rz3, 0.15, 1.6, 0.15, 0, 0.6, -0.12, 0x4e3a24, 0.06);
      b.add(TPL.box, rx3, gy + 1.5, rz3, 2.1, 0.12, 0.12, 0, 0.6, 0, 0x4e3a24, 0.06);
      for (let i = 0; i < 3; i++) {
        b.add(TPL.box, rx3 - 0.55 + i * 0.55, gy + 0.85, rz3 + 0.15, 0.08, 1.55, 0.26, 0.3, 0.6, 0, 0x9fa4ad, 0.06);
        b.add(TPL.box, rx3 - 0.55 + i * 0.55, gy + 0.28, rz3 + 0.3, 0.11, 0.3, 0.11, 0.3, 0.6, 0, 0x5a442a, 0.06);
      }
      addCol(rx3, rz3, 0.7);
    }
    // prisoner cage with a hinged door
    {
      const cx = P.x - 9, cz = P.z - 6;
      const gy = terrainHeight(cx, cz);
      b.add(TPL.box, cx, gy + 0.1, cz, 2.6, 0.2, 2.6, 0, 0, 0, C_WOOD, 0.1);
      for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2)
        b.add(TPL.box, cx + ix * 1.2, gy + 1.2, cz + iz * 1.2, 0.16, 2.3, 0.16, 0, 0, 0, 0x4e3a24, 0.06);
      b.add(TPL.box, cx, gy + 2.4, cz - 1.2, 2.55, 0.14, 0.14, 0, 0, 0, 0x4e3a24, 0.06);
      b.add(TPL.box, cx, gy + 2.4, cz + 1.2, 2.55, 0.14, 0.14, 0, 0, 0, 0x4e3a24, 0.06);
      b.add(TPL.box, cx - 1.2, gy + 2.4, cz, 0.14, 0.14, 2.55, 0, 0, 0, 0x4e3a24, 0.06);
      b.add(TPL.box, cx + 1.2, gy + 2.4, cz, 0.14, 0.14, 2.55, 0, 0, 0, 0x4e3a24, 0.06);
      for (let i = -1; i <= 1; i++) {
        b.add(TPL.box, cx + i * 0.6, gy + 1.2, cz - 1.2, 0.07, 2.3, 0.07, 0, 0, 0, 0x453322, 0.05);
        b.add(TPL.box, cx - 1.2, gy + 1.2, cz + i * 0.6, 0.07, 2.3, 0.07, 0, 0, 0, 0x453322, 0.05);
        b.add(TPL.box, cx + 1.2, gy + 1.2, cz + i * 0.6, 0.07, 2.3, 0.07, 0, 0, 0, 0x453322, 0.05);
      }
      const db3 = new Builder(512);
      db3.add(TPL.box, 1.2, 2.15, 0, 2.2, 0.12, 0.1, 0, 0, 0, 0x4e3a24, 0.06);
      db3.add(TPL.box, 1.2, 0.35, 0, 2.2, 0.12, 0.1, 0, 0, 0, 0x4e3a24, 0.06);
      for (let i = 0; i < 3; i++)
        db3.add(TPL.box, 0.55 + i * 0.6, 1.25, 0, 0.08, 1.95, 0.08, 0, 0, 0, 0x453322, 0.05);
      const doorMesh = db3.build(MAT.static);
      cageDoor = { grp: new THREE.Group(), open: 0 };
      cageDoor.grp.position.set(cx - 1.2, gy, cz + 1.2);
      cageDoor.grp.add(doorMesh);
      root.add(cageDoor.grp);
      addCol(cx, cz, 1.7);
      addInter(cx, gy + 1.2, cz + 1.7, 2.5, 'Open the Cage', () => {
        if (g.flags.cageOpened) return;
        g.flags.cageOpened = true;
        notify('The cage swings open', 'The captive whispers thanks and bolts for Emberhollow');
        g.events.emit('spawnLoot', { pos: { x: cx, y: gy + 0.8, z: cz + 2.2 }, kind: 'gold', amount: 10 });
      }, () => !g.flags.cageOpened && !!(g.flags.vargrDead || g.flags.redfangPeace || g.flags.cageUnlocked));
    }
    // skull totems flank the approach from Emberhollow
    const va = Math.atan2(0 - P.x, 0 - P.z);
    for (let s = -1; s <= 1; s += 2) {
      const tx = P.x + Math.sin(va) * 15 + Math.cos(va) * s * 2.8;
      const tz = P.z + Math.cos(va) * 15 - Math.sin(va) * s * 2.8;
      const gy = terrainHeight(tx, tz);
      b.add(TPL.cyl6, tx, gy + 1.5, tz, 0.3, 3.0, 0.3, 0.04, s, 0.05, 0x5c452c, 0.09);
      b.add(TPL.box, tx, gy + 2.25, tz, 1.3, 0.12, 0.12, 0, va + 0.4 * s, 0, 0x5c452c, 0.09);
      b.add(TPL.sphere, tx, gy + 3.15, tz, 0.55, 0.5, 0.5, 0, va, 0, 0xd8d2c2, 0.06);
      b.add(TPL.cone, tx + 0.26, gy + 3.5, tz, 0.16, 0.5, 0.16, 0.4, 0, -0.7, 0xcfc9b8, 0.06);
      b.add(TPL.cone, tx - 0.26, gy + 3.5, tz, 0.16, 0.5, 0.16, 0.4, 0, 0.7, 0xcfc9b8, 0.06);
      addCol(tx, tz, 0.4);
    }
    crate(b, P.x + 3.5, P.z - 4.5, 0.85, 0.4);
    barrel(b, P.x + 4.6, P.z - 3.6);
    root.add(b.build(MAT.static));
  }

  // ==========================================================================
  // SHRINE OF ALDRIC — altar, statue, offering bowl (daily blessing)
  // ==========================================================================
  let blessTimer = 0;
  let lastBless = -1e9;

  function buildShrine() {
    const P = POI.shrine;
    const gy = terrainHeight(P.x, P.z);
    const b = new Builder(601);
    b.add(TPL.cyl12, P.x, gy + 0.14, P.z, 7.0, 0.3, 7.0, 0, 0, 0, 0x9a978c, 0.08);
    b.add(TPL.cyl12, P.x, gy + 0.4, P.z, 5.2, 0.3, 5.2, 0, 0.2, 0, 0xa39f93, 0.08);
    b.add(TPL.box, P.x, gy + 0.95, P.z, 1.8, 0.85, 1.0, 0, 0, 0, 0xa9a59a, 0.07); // altar
    const sx = P.x, sz = P.z - 1.9; // statue of Aldric, sword point-down
    b.add(TPL.box, sx, gy + 0.85, sz, 1.1, 0.9, 1.1, 0, 0, 0, 0x99958a, 0.07);
    b.add(TPL.cyl, sx, gy + 2.25, sz, 0.85, 1.9, 0.7, 0, 0, 0, 0xa5a196, 0.07);
    b.add(TPL.sphere, sx, gy + 3.4, sz, 0.5, 0.55, 0.5, 0, 0, 0, 0xaaa69b, 0.07);
    b.add(TPL.box, sx, gy + 2.1, sz + 0.6, 0.16, 2.2, 0.16, 0, 0, 0, 0x8f8b80, 0.05);
    b.add(TPL.box, sx, gy + 3.05, sz + 0.6, 0.62, 0.14, 0.14, 0, 0, 0, 0x8f8b80, 0.05);
    b.add(TPL.cyl, P.x, gy + 1.45, P.z, 0.55, 0.18, 0.55, 0, 0, 0, 0x6a6458, 0.06); // offering bowl
    glowB.add(TPL.box, P.x, gy + 1.52, P.z, 0.3, 0.08, 0.3, 0, 0, 0, 0xffd27f, 0);
    b.add(TPL.cyl, P.x - 0.65, gy + 1.13, P.z + 0.28, 0.12, 0.24, 0.12, 0, 0, 0, 0xd9d2bc, 0.05);
    b.add(TPL.cyl, P.x + 0.6, gy + 1.16, P.z - 0.22, 0.12, 0.3, 0.12, 0, 0, 0, 0xd9d2bc, 0.05);
    glowB.add(TPL.box, P.x - 0.65, gy + 1.3, P.z + 0.28, 0.08, 0.12, 0.08, 0, 0, 0, 0xffe0a0, 0);
    glowB.add(TPL.box, P.x + 0.6, gy + 1.37, P.z - 0.22, 0.08, 0.12, 0.08, 0, 0, 0, 0xffe0a0, 0);
    b.add(TPL.box, P.x - 3.2, gy + 1.0, P.z + 1.2, 0.8, 2.0, 0.6, 0, 0.4, 0.05, 0x8e8a7f, 0.11);
    b.add(TPL.box, P.x + 3.1, gy + 0.9, P.z + 1.4, 0.7, 1.8, 0.6, 0, -0.5, -0.06, 0x8e8a7f, 0.11);
    root.add(b.build(MAT.static));
    addCol(sx, sz, 0.95);
    addCol(P.x, P.z, 1.15);
    addCol(P.x - 3.2, P.z + 1.2, 0.6);
    addCol(P.x + 3.1, P.z + 1.4, 0.55);
    addInter(P.x, gy + 1.4, P.z, 2.5, 'Offer a Prayer', () => {
      if (g.time.elapsed - lastBless < g.time.dayLength) {
        notify('The shrine is silent', 'Aldric has already blessed you this day');
        return;
      }
      lastBless = g.time.elapsed;
      g.flags.shrineBlessed = true;
      const p = g.player;
      if (p && blessTimer <= 0) {
        p.stats.maxStamina += 20;
        p.stats.stamina += 20;
      }
      blessTimer = 300;
      notify("Aldric's warmth steels your limbs", '+20 stamina, for a while');
    });
  }

  // ==========================================================================
  // BREADCRUMB POIs — ~18 seeded spots on a 200u hash grid (outside POI radii)
  // ==========================================================================
  const runeB = new Builder(54); // wardstone rune glyphs → MAT.rune (1 draw call)

  function buildCart(b, x, z, ry) {
    const gy = terrainHeight(x, z);
    const c = Math.cos(ry), s = Math.sin(ry);
    b.add(TPL.box, x, gy + 0.75, z, 2.8, 0.35, 1.7, 0, ry, 0.3, 0x6f5230, 0.11);
    b.add(TPL.box, x, gy + 1.08, z, 2.9, 0.28, 0.14, 0, ry, 0.3, 0x64492a, 0.09);
    b.add(TPL.cyl, x + c * 1.15, gy + 0.62, z - s * 1.15, 1.3, 0.16, 1.3, Math.PI / 2, ry, 0.15, 0x54432a, 0.09);
    b.add(TPL.cyl, x - c * 1.7, gy + 0.1, z + s * 2.0, 1.3, 0.16, 1.3, 0, ry + 1, 0, 0x54432a, 0.09);
    b.add(TPL.box, x + s * 2.2, gy + 0.5, z + c * 2.2, 0.14, 0.14, 2.2, 0.55, ry, 0, 0x5c452c, 0.08);
    crate(b, x + 1.6, z + 1.5, 0.7, ry);
    barrel(b, x - 1.8, z - 1.2);
    addCol(x, z, 1.6);
  }

  function buildLoneCamp(b, x, z, ry) {
    campfire(b, x, z, 0.85);
    const by = terrainHeight(x + 1.9, z + 1.3);
    b.add(TPL.box, x + 1.9, by + 0.09, z + 1.3, 0.85, 0.16, 2.0, 0, ry, 0, 0x71503f, 0.1);
    b.add(TPL.box, x + 1.9 - Math.sin(ry), by + 0.16, z + 1.3 - Math.cos(ry), 0.7, 0.2, 0.4, 0, ry, 0, 0x84624c, 0.1);
    const ly = terrainHeight(x - 1.9, z + 0.7);
    b.add(TPL.cyl6, x - 1.9, ly + 0.28, z + 0.7, 0.5, 1.9, 0.5, 1.35, ry + 0.7, 0, 0x5c452c, 0.09);
  }

  function buildCairn(b, x, z) {
    const gy = terrainHeight(x, z);
    let y = gy, s = 1.35;
    for (let i = 0; i < 5; i++) {
      b.add(TPL.box, x + (srand(i, 1, 841) - 0.5) * 0.25, y + s * 0.22, z + (srand(i, 2, 841) - 0.5) * 0.25,
        s, s * 0.5, s * 0.9, 0.08, i * 1.3, 0.07, 0x84837c, 0.11);
      y += s * 0.42; s *= 0.76;
    }
    addCol(x, z, 0.8);
  }

  function buildHunterStand(b, x, z, ry) {
    const gy = terrainHeight(x, z);
    for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2)
      b.add(TPL.box, x + ix * 0.95, gy + 1.5, z + iz * 0.95, 0.18, 3.0, 0.18, 0, ry, 0, 0x5c452c, 0.09);
    b.add(TPL.box, x, gy + 3.06, z, 2.6, 0.16, 2.6, 0, ry, 0, C_WOOD, 0.11);
    b.add(TPL.box, x, gy + 3.6, z - 1.25, 2.6, 0.1, 0.1, 0, ry, 0, C_WOOD, 0.09);
    b.add(TPL.box, x - 1.25, gy + 3.6, z, 0.1, 0.1, 2.6, 0, ry, 0, C_WOOD, 0.09);
    b.add(TPL.box, x + 0.4, gy + 1.6, z + 1.6, 0.09, 3.5, 0.09, 0.3, 0, 0, 0x6a4f2e, 0.08);
    b.add(TPL.box, x - 0.4, gy + 1.6, z + 1.6, 0.09, 3.5, 0.09, 0.3, 0, 0, 0x6a4f2e, 0.08);
    for (let i = 0; i < 4; i++)
      b.add(TPL.box, x, gy + 0.7 + i * 0.72, z + 1.87 - i * 0.22, 0.85, 0.08, 0.08, 0, 0, 0, 0x6a4f2e, 0.08);
    addCol(x, z, 1.3);
  }

  function buildBreadcrumbs() {
    let idx = 0, chestsLeft = 5;
    for (let gx = -4; gx <= 4; gx++) {
      for (let gz = -4; gz <= 3; gz++) {
        if (srand(gx, gz, 501) > 0.3) continue;
        const x = gx * 200 + (srand(gx, gz, 502) - 0.5) * 150;
        const z = gz * 200 + (srand(gx, gz, 503) - 0.5) * 150;
        let blocked = false;
        for (let i = 0; i < POIS.length; i++) {
          const p = POIS[i];
          if (p.r > 0 && dist2d(x, z, p.x, p.z) < p.r + 32) { blocked = true; break; }
        }
        if (blocked) continue;
        const h = terrainHeight(x, z);
        if (h < WATER_LEVEL + 1.4 || h > 82) continue;
        if (Math.abs(terrainHeight(x + 3, z) - h) + Math.abs(terrainHeight(x, z + 3) - h) > 3.2) continue;
        const ry = srand(gx, gz, 505) * 6.283;
        const kindR = srand(gx, gz, 504);
        const b = new Builder(900 + idx);
        if (kindR < 0.3) buildCart(b, x, z, ry);
        else if (kindR < 0.55) buildLoneCamp(b, x, z, ry);
        else if (kindR < 0.8) buildCairn(b, x, z);
        else buildHunterStand(b, x, z, ry);
        // each spot carries a chest OR a loot sack OR a note
        const rx3 = x + Math.cos(ry) * 2.8, rz3 = z + Math.sin(ry) * 2.8;
        const rr = srand(gx, gz, 507);
        if (chestsLeft > 0 && rr < 0.42) {
          chestsLeft--;
          addChest('bc' + idx, rx3, rz3, srand(gx, gz, 508) * 6.28, {});
        } else if (rr < 0.75) {
          const by = terrainHeight(rx3, rz3);
          b.add(TPL.sphere, rx3, by + 0.28, rz3, 0.75, 0.6, 0.75, 0, ry, 0, 0x6e5a3a, 0.1);
          b.add(TPL.sphere, rx3, by + 0.6, rz3, 0.28, 0.22, 0.28, 0, ry, 0, 0x5c4b30, 0.1);
          const bagId = 'bag' + idx, bi = idx;
          addInter(rx3, by + 0.5, rz3, 2.1, 'Search the Sack', () => {
            if (g.flags[bagId]) return;
            g.flags[bagId] = true;
            const lp = { x: rx3, y: by + 0.6, z: rz3 };
            g.events.emit('spawnLoot', { pos: lp, kind: 'gold', amount: 6 + Math.floor(srand(bi, 3, 4003) * 15) });
            if (srand(bi, 4, 4004) < 0.25) g.events.emit('spawnLoot', { pos: lp, kind: 'potion', amount: 1 });
          }, () => !g.flags[bagId]);
        } else {
          const by = terrainHeight(rx3, rz3);
          b.add(TPL.box, rx3, by + 0.5, rz3, 0.12, 1.0, 0.12, 0, ry, 0, 0x6a4f2e, 0.06);
          b.add(TPL.quad, rx3 + Math.sin(ry) * 0.09, by + 0.95, rz3 + Math.cos(ry) * 0.09, 0.42, 0.5, 1, -0.08, ry, 0.05, 0xe4dcc4, 0.03);
          const note = NOTES[idx % NOTES.length];
          addInter(rx3, by + 0.8, rz3, 2.0, 'Read the Note', () => notify(note[0], note[1]));
        }
        root.add(b.build(MAT.static));
        idx++;
      }
    }
  }

  // fishing docks on the Mirrormere shore (one hides Wendel's amulet chest)
  function buildDocks() {
    const L = POI.lake;
    let count = 0;
    for (const a of [0.7, 2.6, 4.4, 5.5]) {
      if (count >= 2) break;
      if (terrainHeight(L.x + Math.cos(a) * 30, L.z + Math.sin(a) * 30) > WATER_LEVEL - 1) continue;
      let shoreR = -1;
      for (let r = 33; r < 320; r += 3) {
        if (terrainHeight(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r) > WATER_LEVEL + 0.5) { shoreR = r; break; }
      }
      if (shoreR < 0) continue;
      const sx = L.x + Math.cos(a) * (shoreR + 1.5), sz = L.z + Math.sin(a) * (shoreR + 1.5);
      const dirx = -Math.cos(a), dirz = -Math.sin(a);
      const yaw = Math.atan2(dirx, dirz);
      const b = new Builder(700 + count);
      const deckY = WATER_LEVEL + 0.85;
      for (let i = 0; i < 5; i++) {
        const px = sx + dirx * (i * 2.1 + 1.0), pz = sz + dirz * (i * 2.1 + 1.0);
        b.add(TPL.box, px, deckY, pz, 1.9, 0.14, 2.2, 0, yaw, 0, C_WOOD, 0.14);
        if (i % 2 === 0) {
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            const ox = px + dirz * sgn * 0.85, oz = pz - dirx * sgn * 0.85;
            const bed = terrainHeight(ox, oz);
            const hgt = Math.max(0.8, deckY + 0.45 - bed);
            b.add(TPL.cyl6, ox, bed + hgt / 2, oz, 0.26, hgt, 0.26, 0, 0, 0, 0x5d452a, 0.1);
          }
        }
      }
      if (count === 0) {
        addChest('dock', sx - dirx * 1.8, sz - dirz * 1.8, yaw + Math.PI, {
          itemId: 'amulet', label: 'Open Weathered Chest',
        });
      } else {
        barrel(b, sx - dirx * 2.0, sz - dirz * 2.0);
        crate(b, sx - dirx * 3.2 + dirz, sz - dirz * 3.2 - dirx, 0.7, a);
      }
      root.add(b.build(MAT.static));
      count++;
    }
  }

  // ==========================================================================
  // Slow tick (≤1 Hz): night windows, runes, beacon state, chimney schedule
  // ==========================================================================
  let tickAcc = 10; // forces a sync on the very first frame
  function slowTick() {
    const df = g.time.dayFrac;
    const night = clamp((1 - smoothstep(0.22, 0.3, df)) + smoothstep(0.72, 0.8, df), 0, 1);
    MAT.glow.emissiveIntensity = 0.12 + night * 1.25;
    MAT.rune.emissiveIntensity = g.flags.stonesCleansed ? 1.5 : 0.06;
    syncBeacon();
    const chimOn = df > 0.27 && df < 0.86; // day + evening only
    for (let i = 0; i < chimneys.length; i++) chimneys[i].active = chimOn;
  }

  // ==========================================================================
  // Per-frame update (zero allocations)
  // ==========================================================================
  function update(dt) {
    // chest lids (visual)
    for (let i = 0; i < chests.length; i++) {
      const c = chests[i];
      if (c.anim >= 0 && c.anim < 1) {
        c.anim = Math.min(1, c.anim + dt * 1.5);
        const k = 1 - (1 - c.anim) * (1 - c.anim) * (1 - c.anim);
        c.lid.rotation.x = -2.0 * k;
      }
    }
    // cage door swings toward its flag state (visual)
    if (cageDoor) {
      const target = g.flags.cageOpened ? 1 : 0;
      if (cageDoor.open !== target) {
        cageDoor.open += clamp(target - cageDoor.open, -dt * 1.1, dt * 1.1);
        if (Math.abs(cageDoor.open - target) < 0.01) cageDoor.open = target;
        cageDoor.grp.rotation.y = -1.9 * cageDoor.open;
      }
    }
    // ≤1 Hz material/state refresh
    tickAcc += g.time.rawDt;
    if (tickAcc >= 1) { tickAcc = 0; slowTick(); }
    // flames & smoke (near-camera emitters only)
    updateEmitters(dt);
    if (g.paused) return;
    // gameplay: stand on the tower platform + shrine blessing timer
    const p = g.player;
    if (p) {
      const dx = p.position.x - TW.x, dz = p.position.z - TW.z;
      if (dx * dx + dz * dz < 12.96 && p.position.y > TW.topY - 3.4 && p.position.y < TW.topY) {
        p.position.y = TW.topY;
        if (p.velocity.y < 0) p.velocity.y = 0;
        p.onGround = true;
      }
      if (blessTimer > 0) {
        blessTimer -= dt;
        if (blessTimer <= 0) {
          blessTimer = 0;
          p.stats.maxStamina -= 20;
          p.stats.stamina = Math.min(p.stats.stamina, p.stats.maxStamina);
        }
      }
    }
  }

  // Snap chest lids / cage door to the freshly loaded flags
  g.events.on('gameLoaded', () => {
    for (let i = 0; i < chests.length; i++) {
      const c = chests[i];
      const open = !!g.flags['chest_' + c.id];
      c.anim = open ? 1 : -1;
      c.lid.rotation.x = open ? -2.0 : 0;
    }
    if (cageDoor) {
      cageDoor.open = g.flags.cageOpened ? 1 : 0;
      cageDoor.grp.rotation.y = -1.9 * cageDoor.open;
    }
    blessTimer = 0;
    lastBless = -1e9;
    tickAcc = 10;
  });

  // ---- build the world (deterministic, once) --------------------------------
  buildVillage();
  buildRuins();
  buildStones();
  buildTower();
  buildCamp();
  buildShrine();
  buildBreadcrumbs();
  buildDocks();
  // finalize the cross-POI merged emissive meshes (1 draw call apiece)
  root.add(glowB.build(MAT.glow, false));
  root.add(fireB.build(MAT.fire, false));
  root.add(discB.build(MAT.glowDisc, false));
  root.add(runeB.build(MAT.rune, false));

  return { update };
}

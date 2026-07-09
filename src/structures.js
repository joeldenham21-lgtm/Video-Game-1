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
  WATER_LEVEL, POIS, POI, terrainHeight, hash2, makeRng,
  clamp, smoothstep, dist2d,
} from './core.js';

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
      const gold = 15 + Math.floor(hash2(seedI, 91, 4001) * 46);
      g.events.emit('spawnLoot', { pos: lp, kind: 'gold', amount: gold });
      if (hash2(seedI, 17, 4002) < 0.5) g.events.emit('spawnLoot', { pos: lp, kind: 'potion', amount: 1 });
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
    const plaster = C_PLASTER[Math.floor(hash2(seed, 1, 811) * C_PLASTER.length)];
    const thatch = C_THATCH[Math.floor(hash2(seed, 2, 811) * C_THATCH.length)];
    const roofH = 1.5 + hash2(seed, 3, 811) * 0.9;
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
      if (hash2(seed, i, 812) < 0.5) b.add(TPL.box, gx2, gy + 1.15, gz2, 0.4, 0.3, 0.4, 0, ry + i, 0, 0xd9b46a, 0.1);
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

  // <<PART2>>

  return { update };
}

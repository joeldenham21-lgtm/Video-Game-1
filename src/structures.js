// ============================================================================
// ELDERFALL — structures.js  (wave 2: real KayKit buildings)
// Emberhollow village (hexagon-pack tavern/blacksmith/chapel/well/markets/
// homes/spinning windmill), Barrowdeep ruins rebuilt from dungeon pieces with
// a real enclosed crypt + NEW cemetery ring (vampire territory), NEW Witch
// Hut POI, NEW Stonebridge POI, Greywatch tower (tower_B asset, climb
// teleports kept), Redfang camp, Shrine of Aldric, breadcrumb POIs, chests.
// Async asset pattern: colliders/interactables register immediately at final
// positions; meshes attach when g.assets resolves. Repeated props use
// InstancedMesh (shared geo/mats → 1 draw call per prop type per POI).
// Fires/smoke/bubbles are pooled Points systems. Lighting is REAL now: every
// lantern/fire/torch/cauldron registers a pooled point light via
// g.lights.register (fake ground-glow discs are gone); window glass keeps a
// subtle shared emissive ≤1 Hz so it reads lit, not radioactive.
// Epic monuments this wave: the Titan of the Vale, the Elder Gate, and the
// Battlefield of Harrow Fen (each one merged Builder mesh + an inscription).
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
// Shared materials (Lambert only per contract). Real illumination comes from
// g.lights; emissives here are surfaces that ARE lit (glass, coals, brew) —
// kept deliberately subtle so they read lit rather than radioactive.
// ---------------------------------------------------------------------------
const MAT = {
  static: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  glow: new THREE.MeshLambertMaterial({
    color: 0x241a10, emissive: 0xffb44d, emissiveIntensity: 0.05, flatShading: true,
  }),
  rune: new THREE.MeshLambertMaterial({
    color: 0x39404a, emissive: 0x3fd9ff, emissiveIntensity: 0.06, flatShading: true,
  }),
  fire: new THREE.MeshLambertMaterial({
    color: 0x1c0d04, emissive: 0xff8226, emissiveIntensity: 1.0, flatShading: true,
  }),
  greenGlow: new THREE.MeshLambertMaterial({
    color: 0x0d1a10, emissive: 0x5aff7e, emissiveIntensity: 0.35, flatShading: true,
  }),
  brew: new THREE.MeshLambertMaterial({
    color: 0x061208, emissive: 0x3fe86a, emissiveIntensity: 0.45, flatShading: true,
  }),
};

// ---------------------------------------------------------------------------
// NEW POIs added this wave (exported so quests/enemies can reference them)
// ---------------------------------------------------------------------------
export const WITCH_HUT = { id: 'witchhut', name: 'The Witch Hut', x: -260, z: -520, r: 26 };
export const STONEBRIDGE = { id: 'stonebridge', name: 'Stonebridge', x: 330, z: -260, r: 24 };
export const CEMETERY = { id: 'cemetery', name: 'Barrowdeep Cemetery', x: 620, z: -449, r: 30 };

// ---------------------------------------------------------------------------
// Builder: bakes transformed template geometry + per-triangle jittered vertex
// colors into one big BufferGeometry (→ one draw call per POI).
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _m42 = new THREE.Matrix4();
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
const C_TIMBER = 0x5a4128;
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

  // ---- real-asset placement (async: logic now, meshes on load) --------------
  // Everything gameplay-relevant (colliders, interactables, chest logic) is
  // registered synchronously at final world positions; only visuals stream in.
  const PRELOADED = new Set([
    'hexagon/building_blacksmith_red.gltf', 'hexagon/building_home_A_red.gltf',
    'hexagon/building_home_B_red.gltf', 'hexagon/building_tavern_red.gltf',
    'hexagon/building_church_red.gltf', 'hexagon/building_well_red.gltf',
    'hexagon/building_windmill_red.gltf', 'hexagon/building_market_red.gltf',
    'dungeon/chest.glb',
  ]);
  const seenRel = new Set();
  function trackLoad(rel) {
    if (seenRel.has(rel)) return;
    seenRel.add(rel);
    if (!PRELOADED.has(rel)) g.assets.expect(1);
  }
  // One-off placement: returns a Group at its final transform immediately;
  // the prop clone attaches whenever it finishes loading.
  function place(rel, x, y, z, ry, s, onLoad) {
    trackLoad(rel);
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = ry;
    if (Array.isArray(s)) grp.scale.set(s[0], s[1], s[2]);
    else grp.scale.setScalar(s);
    root.add(grp);
    g.assets.prop(rel).then((obj) => {
      if (onLoad) onLoad(obj);
      grp.add(obj);
    }).catch(() => {});
    return grp;
  }
  // Repeated props → InstancedMesh per source mesh (1 draw call per type),
  // sharing the pack's geometry + atlas material via the assets cache.
  // items: [{x, y, z, ry?, rx?, rz?, s?: number|[sx,sy,sz]}]
  function placeInstances(rel, items) {
    if (!items.length) return;
    trackLoad(rel);
    g.assets.prop(rel).then((src) => {
      src.updateMatrixWorld(true);
      const meshes = [];
      src.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const m of meshes) {
        const im = new THREE.InstancedMesh(m.geometry, m.material, items.length);
        im.castShadow = true;
        im.receiveShadow = true;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          _e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ');
          _q.setFromEuler(_e);
          _vA.set(it.x, it.y, it.z);
          const s = it.s === undefined ? 1 : it.s;
          if (Array.isArray(s)) _vB.set(s[0], s[1], s[2]);
          else _vB.setScalar(s);
          _m4.compose(_vA, _q, _vB);
          _m42.multiplyMatrices(_m4, m.matrixWorld);
          im.setMatrixAt(i, _m42);
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.computeBoundingSphere) im.computeBoundingSphere();
        root.add(im);
      }
    }).catch(() => {});
  }
  // Terrain-following run of halloween fence pieces (4u span pre-scale).
  // Pushes whole pieces into `items`; returns the "broken" entries (every
  // brokenEvery-th piece) for a separate fence_broken instance set.
  function fenceRun(items, x1, z1, x2, z2, s, withColliders, brokenEvery) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    const span = 4 * s;
    const n = Math.max(1, Math.round(len / span));
    const ux = dx / len, uz = dz / len;
    const ry = Math.atan2(-uz, ux); // local +x runs along the segment
    const broken = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x1 + dx * t, z = z1 + dz * t;
      const y = terrainHeight(x, z) - 0.08;
      const entry = { x, y, z, ry, s };
      if (brokenEvery && i % brokenEvery === brokenEvery - 1) broken.push(entry);
      else items.push(entry);
      if (withColliders) {
        addCol(x, z, 0.55);
        addCol(x - ux * span * 0.33, z - uz * span * 0.33, 0.55);
        addCol(x + ux * span * 0.33, z + uz * span * 0.33, 0.55);
      }
    }
    return broken;
  }

  // ---- fire / smoke / bubble particle pools (3 draw calls, global) ---------
  // Shared 32×32 radial-gradient sprite: points read as soft round puffs
  // instead of hard opaque squares (QA: dawn chimney smoke).
  let puffTex = null;
  function softPuff() {
    if (!puffTex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const ctx = cv.getContext('2d');
      const grd = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 32, 32);
      puffTex = new THREE.CanvasTexture(cv);
    }
    return puffTex;
  }
  const FLAME_N = 120, SMOKE_N = 84, BUBBLE_N = 16;
  function makePool(n, size, opacity) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999; // parked offscreen
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(col, 3); ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('color', ca);
    // static per-point size jitter (deterministic; consumed via onBeforeCompile)
    const psz = new Float32Array(n);
    for (let i = 0; i < n; i++) psz[i] = 0.75 + ((i * 37) % 13) / 13 * 0.55;
    geo.setAttribute('psize', new THREE.BufferAttribute(psz, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity: Math.min(opacity, 0.9),
      map: softPuff(),
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    mat.onBeforeCompile = (sh) => { // inject the psize attribute (r160 chunks)
      sh.vertexShader = sh.vertexShader
        .replace('uniform float size;', 'uniform float size;\nattribute float psize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * psize;');
    };
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
  const bubbles = makePool(BUBBLE_N, 0.32, 0.85);

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
    // smoke leans toward the sky/fog horizon color so it never reads as a
    // stack of white squares against the dawn sky (lazy read, once per frame)
    const hc = g.sky && g.sky.horizonColor;
    const hr = hc ? 0.45 + hc.r * 0.55 : 1;
    const hg = hc ? 0.45 + hc.g * 0.55 : 1;
    const hb = hc ? 0.45 + hc.b * 0.55 : 1;
    for (let k = 0; k < emitters.length; k++) {
      const e = emitters[k];
      const P = e.pool;
      const dx = e.x - cp.x, dz = e.z - cp.z;
      const near = e.active && e.count > 0 && (dx * dx + dz * dz) < 25600; // 160u
      if (near) {
        e.wasOn = true;
        const isFlame = P === flames;
        const isBubble = P === bubbles;
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
          } else if (isBubble) {
            // lazy green cauldron bubbles: drift up, wobble, wink out
            const spread = 0.3 * e.scale;
            P.pos[i3] = e.x + Math.cos(P.seed[i] * 7) * P.rad[i] * spread + Math.sin(a * 3 + P.seed[i]) * 0.06;
            P.pos[i3 + 1] = e.y + tN * e.rise;
            P.pos[i3 + 2] = e.z + Math.sin(P.seed[i] * 5) * P.rad[i] * spread + Math.cos(a * 2.6 + P.seed[i]) * 0.06;
            const f = (1 - tN) * Math.min(1, tN * 10);
            P.col[i3] = 0.22 * f;
            P.col[i3 + 1] = 0.95 * f;
            P.col[i3 + 2] = 0.34 * f;
          } else {
            const spread = (0.25 + tN * 0.95) * e.scale;
            P.pos[i3] = e.x + Math.cos(P.seed[i] * 5) * P.rad[i] * spread
              + Math.sin(a * 1.2 + P.seed[i]) * 0.3 * tN + tN * e.scale * 0.7;
            P.pos[i3 + 1] = e.y + tN * e.rise;
            P.pos[i3 + 2] = e.z + Math.sin(P.seed[i] * 5) * P.rad[i] * spread;
            const v = 0.15 * (1 - tN) * Math.min(1, tN * 6);
            P.col[i3] = v * hr; P.col[i3 + 1] = v * hg; P.col[i3 + 2] = v * 1.08 * hb;
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
    if (bubbles.dirty) { bubbles.pa.needsUpdate = true; bubbles.ca.needsUpdate = true; bubbles.dirty = false; }
  }

  // ---- cross-POI merged builders (1 draw call each, world-spanning) --------
  const glowB = new Builder(51);   // window glass / candle flames → MAT.glow
  const fireB = new Builder(52);   // coal beds / embers           → MAT.fire
  const greenB = new Builder(55);  // witch-green window quads     → MAT.greenGlow
  const brewB = new Builder(56);   // cauldron brew surface        → MAT.brew

  // ---- REAL light registration (pooled point lights via g.lights) ----------
  // Every lantern, fire, torch and cauldron gets one of these. The fake
  // additive glow-discs and orange lantern glow-boxes are gone.
  function lamp(x, y, z, opts = {}) {
    return g.lights.register({
      pos: { x, y, z },
      color: opts.color ?? 0xffa951,
      intensity: opts.intensity ?? 1.6,
      radius: opts.radius ?? 10,
      flicker: opts.flicker ?? 0.3,
      nightOnly: opts.nightOnly !== undefined ? opts.nightOnly : true,
      enabled: opts.enabled,
    });
  }

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
  let windmillFan = null; // windmill blade node, spun in update()

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
    addEmitter(flames, x, gy + 0.35, z, Math.round(8 * scale), 0.85 * scale, 1.2 * scale, 0.55, 0.35);
    // REAL firelight — the flame particles dance over an actual point light
    lamp(x, gy + 1.0, z, { color: 0xff8844, intensity: 1.3 + 0.5 * scale, radius: 11, flicker: 0.6, nightOnly: false });
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
  // EMBERHOLLOW VILLAGE — the cozy heart of the game (real KayKit buildings)
  // ==========================================================================
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

  function buildVillage() {
    const b = new Builder(101);
    const furnTables = [], furnChairs = [], benches = [], hexBarrels = [];
    // plaza + dirt paths
    const py = terrainHeight(0, 0);
    b.add(TPL.disc, 0, py + 0.05, 0, 21, 21, 1, -Math.PI / 2, 0, 0, C_DIRT, 0.14);
    path(b, 0, 11, 0, 66, 3.2);       // south road (spawn approach)
    path(b, 0, -11, -5, -60, 3.0);    // north road
    // ...which keeps going north-east toward Stonebridge (330,-260), following
    // the dry ridge to the flooded dip's shore (QA: it ended mid-field);
    // buildRuinsRoad carries it the rest of the way around the marsh
    path(b, -5, -60, 30, -72, 2.8);
    path(b, 30, -72, 62, -96, 2.6);
    path(b, 62, -96, 86, -113, 2.4);
    path(b, 10, 4, 28, 11, 2.2);
    path(b, -10, 5, -26, 14, 2.2);
    path(b, 9, -6, 26, -13, 2.2);
    path(b, -9, -6, -28, -17, 2.2);
    path(b, 6, -10, 7, -30, 2.2);
    // --- homes ringing the plaza: hexagon buildings, mixed colors -----------
    // (tile base sunk 0.35u per art contract; doors read ~2.2u at these scales)
    const HOMES = [
      [26, -13, 'A', 'red'], [-27, -17, 'B', 'green'], [7, -32, 'A', 'blue'],
      [-11, 27, 'B', 'red'], [-33, 3, 'A', 'yellow'], [27, 22, 'B', 'blue'],
    ];
    for (let i = 0; i < HOMES.length; i++) {
      const [hx, hz, type, colr] = HOMES[i];
      const ry = Math.atan2(-hx, -hz); // door faces the plaza
      const s = type === 'A' ? 7.5 : 6.5;
      const gy = terrainHeight(hx, hz);
      place('hexagon/building_home_' + type + '_' + colr + '.gltf', hx, gy - 0.35, hz, ry, s);
      addCol(hx, hz, type === 'A' ? 2.4 : 2.7);
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const sxd = Math.cos(ry), szd = -Math.sin(ry);
      const wd = 0.31 * s;
      for (let k = -1; k <= 1; k += 2)
        glowB.add(TPL.quad, hx + fx * wd + sxd * k, gy + 2.05, hz + fz * wd + szd * k,
          0.55, 0.66, 1, 0, ry, 0, 0xffcf7a, 0);
      const topH = (type === 'A' ? 0.93 : 1.28) * s - 0.5;
      chimneys.push(addEmitter(smoke, hx - fx * 0.6, gy + topH, hz - fz * 0.6, 6, 0.8, 3.6, 2.6, 1.2));
    }
    // --- the tavern (inn) — big, warm, near spawn — with its hanging sign ---
    {
      const tx = 17, tz = 10, ry = Math.atan2(-tx, -tz), s = 7.5;
      const gy = terrainHeight(tx, tz);
      place('hexagon/building_tavern_red.gltf', tx, gy - 0.35, tz, ry, s);
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const sxd = Math.cos(ry), szd = -Math.sin(ry);
      addCol(tx + sxd * 1.4, tz + szd * 1.4, 3.0);
      addCol(tx - sxd * 1.4, tz - szd * 1.4, 3.0);
      const wd = 0.34 * s;
      for (const k of [-1.5, 0, 1.5])
        glowB.add(TPL.quad, tx + fx * wd + sxd * k, gy + 2.3, tz + fz * wd + szd * k,
          0.62, 0.75, 1, 0, ry, 0, 0xffcf7a, 0);
      // one real hearth-warm light spilling from the tavern front at night
      lamp(tx + fx * (wd + 1.2), gy + 2.4, tz + fz * (wd + 1.2), { color: 0xffc070, intensity: 1.4, radius: 11, flicker: 0.15 });
      chimneys.push(addEmitter(smoke, tx - sxd * 1.2, gy + 1.40 * s - 0.6, tz - szd * 1.2, 6, 0.9, 3.8, 2.6, 1.2));
      // hanging sign on a post out front (the inn sign — quests reference it)
      const cos = Math.cos(ry), sin = Math.sin(ry);
      const W = (lx, lz) => [tx + lx * cos + lz * sin, tz - lx * sin + lz * cos];
      const [sX, sZ] = W(4.6, 3.8);
      const sy = terrainHeight(sX, sZ);
      b.add(TPL.box, sX, sy + 1.6, sZ, 0.18, 3.2, 0.18, 0, ry, 0, C_TIMBER, 0.05);
      b.add(TPL.box, sX, sy + 3.1, sZ, 1.1, 0.14, 0.14, 0, ry + Math.PI / 2, 0, C_TIMBER, 0.05);
      const [qx, qz] = W(4.6, 4.55);
      b.add(TPL.quad, qx, sy + 2.55, qz, 0.95, 0.75, 1, 0, ry, 0, 0x8a4a2c, 0.05);
      b.add(TPL.quad, qx, sy + 2.55, qz, 0.95, 0.75, 1, 0, ry + Math.PI, 0, 0x8a4a2c, 0.05);
      // outdoor dressing: drinking tables + chairs by the door
      const [t1x, t1z] = W(-2.8, 4.8);
      const [t2x, t2z] = W(0.9, 5.4);
      furnTables.push({ x: t1x, y: terrainHeight(t1x, t1z), z: t1z, ry: ry + 0.4, s: 0.8 });
      furnTables.push({ x: t2x, y: terrainHeight(t2x, t2z), z: t2z, ry: ry - 0.3, s: 0.8 });
      for (const [clx, clz, cro] of [[-4.2, 4.6, 1.9], [-1.5, 5.3, -1.2], [2.2, 5.9, 1.5], [0.0, 4.3, 3.2]]) {
        const [ax, az] = W(clx, clz);
        furnChairs.push({ x: ax, y: terrainHeight(ax, az), z: az, ry: ry + cro, s: 0.9 });
      }
      addCol(t1x, t1z, 0.8);
      addCol(t2x, t2z, 0.8);
      // village chest tucked behind the inn
      addChest('village', 23.5, 16.5, Math.atan2(-23.5, -16.5) + Math.PI, {});
    }
    // --- the blacksmith — hearth glow + smoke out front ----------------------
    {
      const bx = -17, bz = 12, ry = Math.atan2(17, -12), s = 7.0;
      const gy = terrainHeight(bx, bz);
      place('hexagon/building_blacksmith_red.gltf', bx, gy - 0.35, bz, ry, s);
      addCol(bx, bz, 3.0);
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const hx = bx + fx * 3.4, hz = bz + fz * 3.4; // ember bed in the yard
      fireB.add(TPL.box, hx, gy + 0.5, hz, 0.95, 0.14, 0.72, 0, ry, 0, 0xff8226, 0.05);
      addEmitter(flames, hx, gy + 0.55, hz, 6, 0.55, 0.7, 0.5, 0.3);
      // the forge hearth burns day and night — real light, always on
      lamp(hx, gy + 1.1, hz, { color: 0xff7733, intensity: 1.6, radius: 8, flicker: 0.5, nightOnly: false });
      chimneys.push(addEmitter(smoke, bx - fx * 0.8, gy + 0.98 * s - 0.6, bz - fz * 0.8, 6, 0.9, 3.6, 2.4, 1.0));
      hexBarrels.push({ x: bx + fx * 4.6 + 1.0, y: terrainHeight(bx + fx * 4.6 + 1.0, bz + fz * 4.6), z: bz + fz * 4.6, ry: 0.5, s: 5 });
    }
    // --- the chapel — stained glow, alcove bookshelf, bench -----------------
    {
      const cx = -20, cz = -33, ry = Math.atan2(20, 33), s = 7.0;
      const gy = terrainHeight(cx, cz);
      place('hexagon/building_church_red.gltf', cx, gy - 0.35, cz, ry, s);
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const sxd = Math.cos(ry), szd = -Math.sin(ry);
      addCol(cx + fx * 1.4, cz + fz * 1.4, 2.5);
      addCol(cx - fx * 1.4, cz - fz * 1.4, 2.5);
      const wd = 0.30 * s;
      glowB.add(TPL.quad, cx + fx * wd + sxd * 1.2, gy + 3.1, cz + fz * wd + szd * 1.2, 0.5, 1.1, 1, 0, ry, 0, 0xffdf9a, 0);
      glowB.add(TPL.quad, cx + fx * wd - sxd * 1.2, gy + 3.1, cz + fz * wd - szd * 1.2, 0.5, 1.1, 1, 0, ry, 0, 0xffdf9a, 0);
      // bookshelf in the doorway alcove (clear of the books module's lecterns)
      const shx = cx + fx * (wd + 0.9) + sxd * 1.9, shz = cz + fz * (wd + 0.9) + szd * 1.9;
      place('dungeon/shelves.gltf.glb', shx, terrainHeight(shx, shz) - 0.7, shz, ry + Math.PI, 0.85);
      const bnx = cx + fx * 6.0, bnz = cz + fz * 6.0;
      benches.push({ x: bnx, y: terrainHeight(bnx, bnz), z: bnz, ry: ry + Math.PI / 2, s: 0.9 });
    }
    // --- the stone well (Elder Maera's spot) --------------------------------
    {
      const wy = terrainHeight(0, -2);
      place('hexagon/building_well_red.gltf', 0, wy - 0.35, -2, 0.8, 5);
      addCol(0, -2, 1.5);
      benches.push({ x: 2.8, y: terrainHeight(2.8, -3.4), z: -3.4, ry: -2.2, s: 0.9 });
    }
    // --- market stalls (hexagon market buildings) ---------------------------
    for (const [mx, mz, rel] of [
      [12, 3, 'hexagon/building_market_red.gltf'],
      [-11, 7, 'hexagon/building_market_green.gltf'],
    ]) {
      const ry = Math.atan2(-mx, -mz);
      const gy = terrainHeight(mx, mz);
      place(rel, mx, gy - 0.35, mz, ry, 4.5);
      const sxd = Math.cos(ry), szd = -Math.sin(ry);
      addCol(mx + sxd * 1.7, mz + szd * 1.7, 2.0);
      addCol(mx - sxd * 1.7, mz - szd * 1.7, 2.0);
    }
    // --- the windmill on the east hill edge, sails turning ------------------
    {
      const wx = 42, wz = 6, wry = Math.atan2(-42, -6);
      const gy = terrainHeight(wx, wz);
      place('hexagon/building_windmill_red.gltf', wx, gy - 0.35, wz, wry, 8, (obj) => {
        obj.traverse((o) => { if (o.name && o.name.indexOf('fan') !== -1) windmillFan = o; });
      });
      addCol(wx, wz, 2.7);
    }
    // --- lantern posts — amber at night, strung along the paths -------------
    const LP = [[8, 9], [-8, 9], [9, -9], [-9, -9], [2, 26], [-2, 42], [14, -17], [-16, -2], [1, -24]];
    const lampI = [];
    for (const [lx, lz] of LP) {
      const gy = terrainHeight(lx, lz);
      const ry = Math.atan2(-lx, -lz); // arm reaches over the path
      lampI.push({ x: lx, y: gy - 0.05, z: lz, ry, s: 0.85 });
      glowB.add(TPL.box, lx + Math.sin(ry) * 1.0, gy + 2.0, lz + Math.cos(ry) * 1.0, 0.26, 0.3, 0.26, 0, ry, 0, 0xffd27f, 0);
      addCol(lx, lz, 0.3);
    }
    placeInstances('halloween/post_lantern.gltf', lampI);
    // standing lanterns by the tavern tables and the market
    placeInstances('halloween/lantern_standing.gltf', [
      { x: 13.6, y: terrainHeight(13.6, 6.4), z: 6.4, ry: 0.3, s: 1.0 },
      { x: -9.2, y: terrainHeight(-9.2, 4.6), z: 4.6, ry: 2.1, s: 1.0 },
    ]);
    glowB.add(TPL.box, 13.6, terrainHeight(13.6, 6.4) + 0.55, 6.4, 0.2, 0.24, 0.2, 0, 0.3, 0, 0xffd27f, 0);
    glowB.add(TPL.box, -9.2, terrainHeight(-9.2, 4.6) + 0.55, 4.6, 0.2, 0.24, 0.2, 0, 2.1, 0, 0xffd27f, 0);
    // --- fenced field (halloween fence pieces), hay, clutter (south-east) ---
    {
      const fenceI = [], brokenI = [];
      for (const [x1, z1, x2, z2] of [[31, -6, 44, -13], [44, -13, 48, -26], [48, -26, 36, -31]])
        brokenI.push(...fenceRun(fenceI, x1, z1, x2, z2, 0.75, false, 4));
      placeInstances('halloween/fence.gltf', fenceI);
      placeInstances('halloween/fence_broken.gltf', brokenI);
    }
    b.add(TPL.box, 40, terrainHeight(40, -20) + 0.5, -20, 1.6, 1.0, 1.2, 0, 0.5, 0, 0xc2a24d, 0.12);
    b.add(TPL.box, 42.5, terrainHeight(42.5, -22) + 0.4, -22, 1.3, 0.8, 1.1, 0, 1.2, 0, 0xb59440, 0.12);
    // --- crates / barrels / sacks (hexagon props, scaled up ~5×) ------------
    placeInstances('hexagon/decoration/props/crate_A_big.gltf', [
      { x: 20.5, y: terrainHeight(20.5, 14.5), z: 14.5, ry: 0.4, s: 5 },
      { x: 21.9, y: terrainHeight(21.9, 13.3), z: 13.3, ry: 1.1, s: 4.2 },
      { x: 4.2, y: terrainHeight(4.2, -13.2), z: -13.2, ry: 0.7, s: 5 },
      { x: 5.4, y: terrainHeight(5.4, -12.1), z: -12.1, ry: 1.9, s: 4.0 },
      { x: 13.9, y: terrainHeight(13.9, 1.4), z: 1.4, ry: 2.6, s: 4.4 },
    ]);
    hexBarrels.push(
      { x: 22.8, y: terrainHeight(22.8, 15.1), z: 15.1, ry: 0, s: 5 },
      { x: -9.6, y: terrainHeight(-9.6, 8.9), z: 8.9, ry: 0, s: 4.5 },
      { x: 5.0, y: terrainHeight(5.0, -14.4), z: -14.4, ry: 0, s: 4.6 },
    );
    placeInstances('hexagon/decoration/props/barrel.gltf', hexBarrels);
    placeInstances('hexagon/decoration/props/sack.gltf', [
      { x: 12.6, y: terrainHeight(12.6, 1.6), z: 1.6, ry: 0.9, s: 6 },
      { x: -10.1, y: terrainHeight(-10.1, 5.3), z: 5.3, ry: 2.2, s: 6 },
    ]);
    addCol(21.2, 14.2, 0.9);
    addCol(4.7, -12.8, 0.8);
    // --- outdoor furniture flush --------------------------------------------
    placeInstances('furniture/table_medium.gltf', furnTables);
    placeInstances('furniture/chair_A_wood.gltf', furnChairs);
    placeInstances('halloween/bench.gltf', benches);
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
    const pillarI = [], wallBrokenI = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const x = ccx + Math.cos(a) * 15, z = ccz + Math.sin(a) * 15;
      const gy = terrainHeight(x, z);
      const full = i < 2 || srand(i, 4, 821) < 0.22;
      const h = full ? 5.6 + srand(i, 5, 821) * 0.8 : 1.4 + srand(i, 6, 821) * 2.4;
      const tilt = full ? 0 : (srand(i, 7, 821) - 0.5) * 0.18;
      b.add(TPL.box, x, gy + 0.2, z, 2.2, 0.45, 2.2, 0, a, 0, 0x767b71, 0.12); // plinth
      pillarI.push({ x, y: gy + 0.35, z, ry: a, rx: tilt, rz: tilt * 0.7, s: [1.45, h / 4, 1.45] });
      addCol(x, z, 1.1);
    }
    // lintel arch across the two full columns (i = 0, 1)
    {
      const x0 = ccx + Math.cos(0) * 15, z0 = ccz + Math.sin(0) * 15;
      const a1 = Math.PI * 2 / 10;
      const x1 = ccx + Math.cos(a1) * 15, z1 = ccz + Math.sin(a1) * 15;
      const h0 = terrainHeight(x0, z0), h1 = terrainHeight(x1, z1);
      b.add(TPL.box, (x0 + x1) / 2, Math.max(h0, h1) + 6.5, (z0 + z1) / 2,
        1.3, 0.7, Math.hypot(x1 - x0, z1 - z0) + 1.6, 0, Math.atan2(x1 - x0, z1 - z0), 0, 0x7a7f75, 0.1);
    }
    // fallen columns (toppled dungeon pillars)
    pillarI.push(
      { x: ccx + 6, y: terrainHeight(ccx + 6, ccz + 3) + 0.85, z: ccz + 3, rx: Math.PI / 2, ry: 0.7, s: [0.95, 0.9, 0.95] },
      { x: ccx - 8, y: terrainHeight(ccx - 8, ccz - 4) + 0.8, z: ccz - 4, rx: Math.PI / 2, ry: 2.2, s: [0.9, 0.65, 0.9] },
    );
    placeInstances('dungeon/pillar.gltf.glb', pillarI);
    // collapsed walls + rubble heaps
    for (let i = 0; i < 4; i++) {
      const a = 0.8 + i * 1.5;
      const wx = ccx + Math.cos(a) * 22, wz = ccz + Math.sin(a) * 22;
      const wy = terrainHeight(wx, wz);
      wallBrokenI.push({ x: wx, y: wy - 0.15, z: wz, ry: -a - Math.PI / 2, rz: 0.04, s: [1.35, 0.5 + srand(i, 8, 822) * 0.3, 1.0] });
    }
    placeInstances('dungeon/wall_broken.gltf.glb', wallBrokenI);
    {
      const rubHalf = [], rubLarge = [];
      for (let i = 0; i < 4; i++) {
        const rx3 = ccx + (srand(i, 9, 823) - 0.5) * 34, rz3 = ccz + (srand(i, 10, 823) - 0.5) * 34;
        const e = { x: rx3, y: terrainHeight(rx3, rz3) - 0.1, z: rz3, ry: i * 2.1, s: i === 3 ? 0.55 : 0.6 };
        (i === 3 ? rubLarge : rubHalf).push(e);
      }
      placeInstances('dungeon/rubble_half.gltf.glb', rubHalf);
      placeInstances('dungeon/rubble_large.gltf.glb', rubLarge);
    }

    // ---- the crypt: REAL enclosed chamber from dungeon pieces --------------
    // 8×8 interior, 4u-tall walls, tiled floor AND roof, door gap facing north
    // (collider layout identical to v1 — quests/enemies rely on it).
    const cx = P.x, cz = P.z - 16;
    const gy = terrainHeight(cx, cz);
    {
      const tileI = [];
      for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2) {
        tileI.push({ x: cx + ix * 2, y: gy + 0.08, z: cz + iz * 2, s: 1 });  // floor
        tileI.push({ x: cx + ix * 2, y: gy + 4.02, z: cz + iz * 2, s: 1 });  // roof slab
      }
      placeInstances('dungeon/floor_tile_large.gltf.glb', tileI);
      placeInstances('dungeon/wall.gltf.glb', [
        { x: cx - 2, y: gy, z: cz + 4.05, ry: 0 }, { x: cx + 2, y: gy, z: cz + 4.05, ry: 0 },             // back (south)
        { x: cx - 4.05, y: gy, z: cz - 2, ry: Math.PI / 2 }, { x: cx - 4.05, y: gy, z: cz + 2, ry: Math.PI / 2 }, // west
        { x: cx + 4.05, y: gy, z: cz - 2, ry: Math.PI / 2 }, { x: cx + 4.05, y: gy, z: cz + 2, ry: Math.PI / 2 }, // east
      ]);
      placeInstances('dungeon/wall_half.gltf.glb', [
        { x: cx - 4, y: gy, z: cz - 4.05, ry: 0 }, { x: cx + 2, y: gy, z: cz - 4.05, ry: 0 },             // front flanks
      ]);
      placeInstances('dungeon/wall_doorway.glb', [{ x: cx, y: gy, z: cz - 4.05, ry: 0 }]);                 // the door
    }
    // barrow cap above the roof slabs (stepped silhouette)
    b.add(TPL.box, cx, gy + 4.45, cz, 8.6, 0.55, 8.6, 0, 0.03, 0, C_DARKSTONE, 0.11);
    b.add(TPL.box, cx, gy + 4.95, cz, 5.6, 0.5, 5.6, 0, -0.04, 0, 0x676c62, 0.11);
    b.add(TPL.box, cx, gy + 5.35, cz, 2.6, 0.45, 2.6, 0, 0.08, 0, 0x606656, 0.11);
    // earth berms leaning on the outer walls → "dug into the hill" read
    b.add(TPL.box, cx - 5.4, gy + 0.9, cz, 2.6, 2.6, 9.6, 0, 0, 0.5, 0x5e5a46, 0.12);
    b.add(TPL.box, cx + 5.4, gy + 0.9, cz, 2.6, 2.6, 9.6, 0, 0, -0.5, 0x5e5a46, 0.12);
    b.add(TPL.box, cx, gy + 0.9, cz + 5.4, 9.6, 2.6, 2.6, -0.5, 0, 0, 0x5e5a46, 0.12);
    // sunken entrance corridor (walls rise toward the door)
    b.add(TPL.box, cx - 1.8, gy + 0.95, cz - 7.2, 0.6, 1.9, 6.4, 0.09, 0, 0, C_MOSS, 0.13);
    b.add(TPL.box, cx + 1.8, gy + 0.95, cz - 7.2, 0.6, 1.9, 6.4, 0.09, 0, 0, C_MOSS, 0.13);
    // interior: coffin, bones, wall torches, ember bowls in the back corners
    placeInstances('halloween/coffin.gltf', [{ x: cx - 2.4, y: gy + 0.12, z: cz + 1.2, ry: 0.06, s: 0.8 }]);
    const skullI = [
      { x: cx + 2.6, y: gy + 0.12, z: cz + 0.6, ry: 1, s: 0.6 },
      { x: cx + 2.2, y: gy + 0.12, z: cz + 1.1, ry: 2.4, s: 0.5 },
    ];
    const boneI = [
      { x: cx + 2.9, y: gy + 0.26, z: cz - 0.4, ry: 0.7, s: 1.2 },
      { x: cx - 1.1, y: gy + 0.24, z: cz - 2.2, ry: 2.4, s: 1.2 },
    ];
    const ribI = [{ x: cx + 3.0, y: gy + 0.5, z: cz - 1.4, ry: 1.8, s: 0.9 }];
    {
      const torchI = [
        { x: cx - 2.6, y: gy + 1.9, z: cz + 3.45, s: 1 }, { x: cx + 2.6, y: gy + 1.9, z: cz + 3.45, s: 1 },
        { x: cx - 1.9, y: gy + 1.9, z: cz - 4.75, s: 1 }, { x: cx + 1.9, y: gy + 1.9, z: cz - 4.75, s: 1 },
      ];
      placeInstances('dungeon/torch_lit.gltf.glb', torchI);
      for (const t of torchI) addEmitter(flames, t.x, t.y + 0.6, t.z, 3, 0.3, 0.55, 0.45, 0.25);
    }
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
    addCol(cx - 2.4, cz + 1.2, 1.2); // coffin (was: sarcophagus)
    // Aldric's sword chest at the back of the chamber, facing the door
    addChest('aldric', cx + 0.6, cz + 2.6, Math.PI, {
      label: 'Open Ancient Chest', itemId: 'aldricSword', scale: 1.25,
      onOpen: () => { g.flags.aldricChestOpened = true; },
    });

    // ---- NEW: the cemetery — fenced vampire ground south of the crypt ------
    const KZ = CEMETERY.z; // ring center (620, -449); south fence at z = -464
    path(b, cx, cz - 5, cx, KZ - 16, 2.2); // grave path from the crypt door
    {
      const cemFence = [], cemBroken = [];
      cemBroken.push(...fenceRun(cemFence, 600, KZ - 15, 617.2, KZ - 15, 0.8, true, 5));
      cemBroken.push(...fenceRun(cemFence, 622.8, KZ - 15, 640, KZ - 15, 0.8, true, 4));
      cemBroken.push(...fenceRun(cemFence, 598, KZ - 13, 598, cz - 5, 0.8, true, 3));
      cemBroken.push(...fenceRun(cemFence, 642, KZ - 13, 642, cz - 5, 0.8, true, 4));
      placeInstances('halloween/fence.gltf', cemFence);
      placeInstances('halloween/fence_broken.gltf', cemBroken);
      placeInstances('halloween/fence_gate.gltf', [
        { x: 620, y: terrainHeight(620, KZ - 15) - 0.08, z: KZ - 15, ry: 0, s: 0.8 },
      ]);
      // skull posts glare at whoever enters by the gate
      placeInstances('halloween/post_skull.gltf', [
        { x: 616.6, y: terrainHeight(616.6, KZ - 15.6), z: KZ - 15.6, ry: Math.PI, s: 0.95 },
        { x: 623.4, y: terrainHeight(623.4, KZ - 15.6), z: KZ - 15.6, ry: Math.PI, s: 0.95 },
      ]);
      addCol(616.6, KZ - 15.6, 0.3);
      addCol(623.4, KZ - 15.6, 0.3);
    }
    // grave rows
    {
      const graveAI = [], graveBI = [];
      for (let i = 0; i < 8; i++) {
        const gxp = 604 + (i % 4) * 8 + (i > 3 ? 4 : 0);
        const gzp = i > 3 ? KZ - 10 : KZ - 3;
        const gyp = terrainHeight(gxp, gzp);
        (i % 2 ? graveBI : graveAI).push({ x: gxp, y: gyp, z: gzp, ry: (srand(i, 3, 851) - 0.5) * 0.4, s: 0.85 });
        addCol(gxp, gzp, 0.8);
      }
      placeInstances('halloween/grave_A.gltf', graveAI);
      placeInstances('halloween/grave_B.gltf', graveBI);
      placeInstances('halloween/gravestone.gltf', [
        { x: 601.5, y: terrainHeight(601.5, KZ - 6), z: KZ - 6, ry: 0.3, s: 1 },
        { x: 638.5, y: terrainHeight(638.5, KZ - 8), z: KZ - 8, ry: -0.4, s: 1 },
        { x: 611, y: terrainHeight(611, KZ - 13), z: KZ - 13, ry: 0.15, s: 1 },
      ]);
      placeInstances('halloween/gravemarker_A.gltf', [
        { x: 606, y: terrainHeight(606, KZ - 12.5), z: KZ - 12.5, ry: 0.6, s: 1 },
        { x: 633, y: terrainHeight(633, KZ - 2), z: KZ - 2, ry: -0.5, s: 1 },
      ]);
      placeInstances('halloween/gravemarker_B.gltf', [
        { x: 626, y: terrainHeight(626, KZ - 13.5), z: KZ - 13.5, ry: 0.2, s: 1 },
        { x: 599.5, y: terrainHeight(599.5, KZ + 2), z: KZ + 2, ry: 1.1, s: 1 },
      ]);
      // grave lanterns, faintly burning even for the forgotten
      placeInstances('halloween/lantern_standing.gltf', [
        { x: 613.4, y: terrainHeight(613.4, KZ - 3.8), z: KZ - 3.8, ry: 0.8, s: 1 },
        { x: 628.6, y: terrainHeight(628.6, KZ - 10.8), z: KZ - 10.8, ry: 2.4, s: 1 },
      ]);
      glowB.add(TPL.box, 613.4, terrainHeight(613.4, KZ - 3.8) + 0.55, KZ - 3.8, 0.2, 0.24, 0.2, 0, 0.8, 0, 0xffd27f, 0);
      glowB.add(TPL.box, 628.6, terrainHeight(628.6, KZ - 10.8) + 0.55, KZ - 10.8, 0.2, 0.24, 0.2, 0, 2.4, 0, 0xffd27f, 0);
    }
    // the crypt house — a proper vampire address (halloween crypt building)
    {
      const bx = 636, bz = -446;
      const by = terrainHeight(bx, bz);
      const bry = Math.atan2(620 - bx, (KZ - 6) - bz); // door looks over the graves
      place('halloween/crypt.gltf', bx, by - 0.1, bz, bry, 0.8);
      const fx = Math.sin(bry), fz = Math.cos(bry);
      addCol(bx - fx * 1.2, bz - fz * 1.2, 2.6);
      addCol(bx + fx * 1.2, bz + fz * 1.2, 2.6);
      const jx = bx + fx * 3.6, jz = bz + fz * 3.6;
      placeInstances('halloween/pumpkin_orange_jackolantern.gltf', [
        { x: jx, y: terrainHeight(jx, jz), z: jz, ry: bry, s: 0.8 },
      ]);
      glowB.add(TPL.box, jx, terrainHeight(jx, jz) + 0.45, jz, 0.32, 0.32, 0.32, 0, bry, 0, 0xffb04a, 0);
    }
    // dead trees claw at the sky
    {
      const treeL = [
        { x: 601, y: terrainHeight(601, -461) + 0.15, z: -461, ry: 0.8, s: 1.4 },
        { x: 640, y: terrainHeight(640, -462) + 0.15, z: -462, ry: 2.3, s: 1.3 },
      ];
      const treeM = [
        { x: 600, y: terrainHeight(600, -444) + 0.15, z: -444, ry: 4.0, s: 1.4 },
        { x: 629, y: terrainHeight(629, -463) + 0.15, z: -463, ry: 1.4, s: 1.5 },
      ];
      placeInstances('halloween/tree_dead_large.gltf', treeL);
      placeInstances('halloween/tree_dead_medium.gltf', treeM);
      for (const t of treeL) addCol(t.x, t.z, 0.6);
      for (const t of treeM) addCol(t.x, t.z, 0.45);
    }
    // scattered remains
    skullI.push(
      { x: 609, y: terrainHeight(609, KZ - 7), z: KZ - 7, ry: 2.8, s: 0.6 },
      { x: 631, y: terrainHeight(631, KZ - 5.5), z: KZ - 5.5, ry: 0.9, s: 0.55 },
    );
    boneI.push(
      { x: 617, y: terrainHeight(617, KZ - 8) + 0.1, z: KZ - 8, ry: 1.9, s: 1.2 },
      { x: 624, y: terrainHeight(624, KZ - 6) + 0.1, z: KZ - 6, ry: 4.2, s: 1.1 },
    );
    ribI.push({ x: 621.5, y: terrainHeight(621.5, KZ - 12) + 0.4, z: KZ - 12, ry: 0.5, s: 1 });
    placeInstances('halloween/skull.gltf', skullI);
    placeInstances('halloween/bone_A.gltf', boneI);
    placeInstances('halloween/ribcage.gltf', ribI);
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
    const da = Math.atan2(-x, -z); // door faces Emberhollow
    const b = new Builder(401);
    // real tower body (hexagon tower_B, UNIFORM scale so nothing distorts;
    // 8.5 puts the body top at gy+12.4, flush with the platform support ring;
    // roof cap hidden → open watch platform)
    place('hexagon/building_tower_B_red.gltf', x, gy - 0.35, z, da, 8.5, (obj) => {
      obj.traverse((o) => { if (o.name && o.name.indexOf('_top_') !== -1) o.visible = false; });
    });
    b.add(TPL.cyl12, x, gy + 1.0, z, 8.6, 2.2, 8.6, 0, 0, 0, C_DARKSTONE, 0.1);    // foundation skirt
    b.add(TPL.cyl12, x, gy + 13.2, z, 7.0, 1.6, 7.0, 0, 0.13, 0, 0x84868a, 0.09);  // platform support ring
    b.add(TPL.cyl12, x, gy + 14.0, z, 7.8, 0.6, 7.8, 0, 0.13, 0, 0x7b7d80, 0.08);  // platform, top = +14.3
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const mx = x + Math.cos(a) * 3.55, mz = z + Math.sin(a) * 3.55;
      b.add(TPL.box, mx, topY + 0.55, mz, 1.05, 1.1, 0.6, 0, -a - Math.PI / 2, 0, 0x85878b, 0.09);
      addCol(mx, mz, 0.72, gy + 12.8, gy + 17.5); // parapet keeps you from strolling off
    }
    const dx = x + Math.sin(da) * 3.28, dz = z + Math.cos(da) * 3.28;
    // banner-shaped window glows sit PROUD of the wall: shaft corner radius is
    // 0.47×8.5 ≈ 4.0 (buttress band reaches ≈4.5 up high) — they were buried
    glowB.add(TPL.quad, x + Math.sin(da) * 4.15, gy + 7.5, z + Math.cos(da) * 4.15, 0.28, 0.9, 1, 0, da, 0, 0xffcf7a, 0);
    glowB.add(TPL.quad, x + Math.sin(da + 2.1) * 4.6, gy + 10.4, z + Math.cos(da + 2.1) * 4.6, 0.28, 0.9, 1, 0, da + 2.1, 0, 0xffcf7a, 0);
    // the garrison banner stands on the approach, clear of the wall (the
    // tower's base flare reaches r≈5.1 — anything closer gets swallowed)
    const bfx = x + Math.sin(da + 0.55) * 6.4, bfz = z + Math.cos(da + 0.55) * 6.4;
    placeInstances('hexagon/decoration/props/flag_red.gltf', [
      { x: bfx, y: terrainHeight(bfx, bfz), z: bfz, ry: da, s: 10 },
    ]);
    addCol(bfx, bfz, 0.4);
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
  let campNightFlames = null; // extra fire throughput, night only (slowTick)

  function buildCamp() {
    const P = POI.camp;
    const b = new Builder(511);
    const campGy = campfire(b, P.x, P.z, 1.3);
    addEmitter(smoke, P.x, campGy + 1.2, P.z, 5, 1.0, 4.5, 3.0, 1.2);
    // QA: the camp was pitch black at night — the fire has to READ. A wide
    // amber glow disc under it, a second night-only flame emitter, and three
    // ember stones in the ring (all emissive fakes; g.pointLight is combat's).
    discB.add(TPL.disc, P.x, campGy + 0.14, P.z, 7.4, 7.4, 1, -Math.PI / 2, 0, 0, 0xff8630, 0);
    campNightFlames = addEmitter(flames, P.x, campGy + 0.5, P.z, 10, 1.1, 1.9, 0.6, 0.4);
    campNightFlames.active = false;
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 1.4;
      fireB.add(TPL.sphere, P.x + Math.cos(a) * 1.15, campGy + 0.18, P.z + Math.sin(a) * 1.15,
        0.42, 0.3, 0.36, 0.2, a, 0, 0xffa040, 0.08);
    }
    // tents facing the fire (the big one is Vargr's)
    const tents = [[0.5, 9, 4.4, 2.7, 3.6, 0x77503a], [2.5, 9.5, 4.2, 2.6, 3.4, 0x6e4a38], [4.4, 10, 5.6, 3.3, 4.6, 0x6e3a30]];
    for (let i = 0; i < tents.length; i++) {
      const [a, r, w, h, d, col] = tents[i];
      const tx = P.x + Math.cos(a) * r, tz = P.z + Math.sin(a) * r;
      const gy = terrainHeight(tx, tz);
      const ry = Math.atan2(P.x - tx, P.z - tz);
      b.add(TPL.prism, tx, gy, tz, w, h, d, 0, ry + Math.PI / 2, 0, col, 0.1);
      // dark doorway on the fire-facing gable — the prism is rotated ry+π/2,
      // so that gable sits at w/2 along the fire axis (NOT d/2, which is
      // inside the tent and swallowed the door + glow entirely)
      b.add(TPL.box, tx + Math.sin(ry) * (w / 2 - 0.1), gy + 0.65, tz + Math.cos(ry) * (w / 2 - 0.1),
        0.95, 1.3, 0.25, 0, ry, 0, 0x241a12, 0.03);
      // faint warm interior glow in the doorway so tents read at night
      // (MAT.glow — same ≤1 Hz brighten-at-night path as the windows)
      glowB.add(TPL.quad, tx + Math.sin(ry) * (w / 2 + 0.06), gy + 0.62, tz + Math.cos(ry) * (w / 2 + 0.06),
        0.6, 0.9, 1, 0, ry, 0, 0xd0955a, 0);
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
      }, () => !g.flags.cageOpened && !!(g.flags.vargrDead || g.flags.campPeaceful));
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
    // plundered supplies (real dungeon props) + a war flag by the approach
    placeInstances('dungeon/box_small.gltf.glb', [
      { x: P.x + 3.3, y: terrainHeight(P.x + 3.3, P.z - 5.6), z: P.z - 5.6, ry: 0.7, s: 0.95 },
      { x: P.x + 7.6, y: terrainHeight(P.x + 7.6, P.z + 1.8), z: P.z + 1.8, ry: 1.8, s: 0.85 },
    ]);
    placeInstances('dungeon/crates_stacked.gltf.glb', [
      { x: P.x + 6.0, y: terrainHeight(P.x + 6.0, P.z - 1.6), z: P.z - 1.6, ry: 2.4, s: 0.9 },
    ]);
    placeInstances('dungeon/barrel_small.gltf.glb', [
      { x: P.x + 4.9, y: terrainHeight(P.x + 4.9, P.z - 4.6), z: P.z - 4.6, ry: 0, s: 1 },
      { x: P.x - 6.4, y: terrainHeight(P.x - 6.4, P.z - 3.4), z: P.z - 3.4, ry: 0, s: 0.9 },
    ]);
    placeInstances('hexagon/decoration/props/flag_red.gltf', [
      { x: P.x + Math.sin(va) * 12, y: terrainHeight(P.x + Math.sin(va) * 12, P.z + Math.cos(va) * 12), z: P.z + Math.cos(va) * 12, ry: va, s: 10 },
    ]);
    addCol(P.x + 6.0, P.z - 1.6, 1.1);
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
  // NEW POI: THE WITCH HUT — crooked green cottage, cauldron, fairy ring
  // ==========================================================================
  function buildWitchHut() {
    const P = WITCH_HUT;
    const b = new Builder(651);
    const gy = terrainHeight(P.x, P.z);
    const ry = 0.7;
    const fx = Math.sin(ry), fz = Math.cos(ry);       // hut facing
    const sxd = Math.cos(ry), szd = -Math.sin(ry);    // lateral
    // the hut: home_B_green sunk deep and skewed 0.06 rad → properly crooked.
    // QA: the pack walls read near-black in the swamp gloom — clone the atlas
    // material (it's shared with the village's green home!) and lift it ~2×,
    // biased toward a swampy grey-green.
    const hut = place('hexagon/building_home_B_green.gltf', P.x, gy - 0.55, P.z, ry, 6.5, (obj) => {
      const lift = new THREE.Color(1.75, 2.05, 1.55); // one-time, not per-frame
      const seen = new Map();
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const out = mats.map((m) => {
          if (!seen.has(m.uuid)) {
            const t = m.clone();
            t.color.multiply(lift);
            seen.set(m.uuid, t);
          }
          return seen.get(m.uuid);
        });
        o.material = Array.isArray(o.material) ? out : out[0];
      });
    });
    hut.rotation.z = 0.06;
    addCol(P.x + fx * 1.0, P.z + fz * 1.0, 2.7);
    addCol(P.x - fx * 1.0, P.z - fz * 1.0, 2.7);
    // sickly green window light (always-lit — someone is home)
    greenB.add(TPL.quad, P.x + fx * 2.0 + sxd * 1.0, gy + 2.1, P.z + fz * 2.0 + szd * 1.0, 0.55, 0.66, 1, 0, ry, 0, 0x9fffb4, 0);
    greenB.add(TPL.quad, P.x - fx * 2.05 - sxd * 0.8, gy + 2.4, P.z - fz * 2.05 - szd * 0.8, 0.5, 0.6, 1, 0, ry + Math.PI, 0, 0x9fffb4, 0);
    chimneys.push(addEmitter(smoke, P.x - fx * 0.5, gy + 1.28 * 6.5 - 0.7, P.z - fz * 0.5, 6, 0.8, 3.4, 2.6, 1.2));
    // the cauldron: soot-black barrel, glowing green brew, lazy bubbles
    const cX = P.x + fx * 6.2 + sxd * 1.6, cZ = P.z + fz * 6.2 + szd * 1.6;
    const cy = terrainHeight(cX, cZ);
    place('dungeon/barrel_large.gltf.glb', cX, cy, cZ, 0.4, 0.75, (obj) => g.assets.tint(obj, '#4a4f52'));
    greenDiscB.add(TPL.disc, cX, cy + 1.56, cZ, 1.1, 1.1, 1, -Math.PI / 2, 0, 0, 0x6cff8e, 0); // brew surface
    greenDiscB.add(TPL.disc, cX, cy + 0.07, cZ, 4.6, 4.6, 1, -Math.PI / 2, 0, 0, 0x3fd465, 0); // ground glow
    addEmitter(bubbles, cX, cy + 1.55, cZ, 12, 0.55, 1.5, 1.2, 0.9);
    fireB.add(TPL.sphere, cX, cy + 0.14, cZ, 0.9, 0.24, 0.9, 0, 0, 0, 0xff8226, 0.05);
    addEmitter(flames, cX, cy + 0.2, cZ, 4, 0.5, 0.5, 0.45, 0.3);
    addCol(cX, cZ, 0.85);
    // the mushroom circle — step in at your peril
    const mx = P.x - sxd * 8 + fx * 2.5, mz = P.z - szd * 8 + fz * 2.5;
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const px = mx + Math.cos(a) * 3.6, pz = mz + Math.sin(a) * 3.6;
      const py2 = terrainHeight(px, pz);
      const cap = srand(i, 5, 861) < 0.4 ? 0xc23b2c : 0xd8cfae;
      const hgt = 0.28 + srand(i, 6, 861) * 0.3;
      b.add(TPL.cyl6, px, py2 + hgt / 2, pz, 0.16, hgt, 0.16, 0, a, 0.06, 0xe8e2cf, 0.08);
      b.add(TPL.sphere, px, py2 + hgt + 0.05, pz, 0.5, 0.28, 0.5, 0, a, 0, cap, 0.1);
    }
    greenDiscB.add(TPL.disc, mx, terrainHeight(mx, mz) + 0.06, mz, 8.4, 8.4, 1, -Math.PI / 2, 0, 0, 0x2e9c4e, 0);
    // hanging bones on a crooked frame by the door
    const hx = P.x + fx * 4.6 - sxd * 2.6, hz = P.z + fz * 4.6 - szd * 2.6;
    const hy = terrainHeight(hx, hz);
    b.add(TPL.cyl6, hx, hy + 1.3, hz, 0.14, 2.6, 0.14, 0.08, ry, 0.05, 0x4e3a24, 0.08);
    b.add(TPL.box, hx, hy + 2.5, hz, 2.4, 0.1, 0.1, 0, ry, 0, 0x4e3a24, 0.08);
    {
      const boneH = [];
      for (let i = -1; i <= 1; i++)
        boneH.push({ x: hx + sxd * i * 0.85, y: hy + 1.78, z: hz + szd * i * 0.85, ry: srand(i + 2, 7, 862) * 6.28, rz: Math.PI / 2, s: 1.1 });
      placeInstances('halloween/bone_A.gltf', boneH);
      placeInstances('halloween/skull.gltf', [{ x: hx + sxd * 0.05, y: hy + 1.1, z: hz, ry, s: 0.7 }]);
    }
    // a skull post marks the way in; dead trees crowd the clearing
    const pkx = P.x + fx * 11, pkz = P.z + fz * 11;
    placeInstances('halloween/post_skull.gltf', [
      { x: pkx, y: terrainHeight(pkx, pkz), z: pkz, ry: ry + Math.PI, s: 0.9 },
    ]);
    addCol(pkx, pkz, 0.3);
    placeInstances('halloween/tree_dead_medium.gltf', [
      { x: P.x - fx * 6.5, y: terrainHeight(P.x - fx * 6.5, P.z - fz * 6.5) + 0.15, z: P.z - fz * 6.5, ry: 1.2, s: 1.5 },
      { x: P.x + sxd * 7.5, y: terrainHeight(P.x + sxd * 7.5, P.z + szd * 7.5) + 0.15, z: P.z + szd * 7.5, ry: 3.6, s: 1.3 },
    ]);
    addCol(P.x - fx * 6.5, P.z - fz * 6.5, 0.45);
    addCol(P.x + sxd * 7.5, P.z + szd * 7.5, 0.45);
    root.add(b.build(MAT.static));
  }

  // ==========================================================================
  // NEW POI: STONEBRIDGE — bridge_A spans the flooded dip on the ruins road
  // (troll country beneath; enemies.js has the same coordinates)
  // ==========================================================================
  const BR = {
    x: STONEBRIDGE.x, z: STONEBRIDGE.z,
    ry: Math.atan2(POI.ruins.x, POI.ruins.z), // deck runs along the ruins road
    deckY: 2.0,   // deck top — QA: was −1.1, the whole crossing read drowned
    s: 0, c: 0,
    cws: [],      // causeway ramps off both deck ends (walk-clamped in update)
  };
  BR.s = Math.sin(BR.ry);
  BR.c = Math.cos(BR.ry);

  function buildStonebridge() {
    const b = new Builder(671);
    const fx = Math.sin(BR.ry), fz = Math.cos(BR.ry);
    const sxd = Math.cos(BR.ry), szd = -Math.sin(BR.ry);
    // model deck top is +0.25 pre-scale → origin at deckY − 1.625; the deck
    // now rides ~5u clear of the water plane instead of awash in it
    place('hexagon/building_bridge_A.gltf', BR.x, BR.deckY - 0.25 * 6.5, BR.z, BR.ry, 6.5);
    // central stone pier: grounds the span (the model's legs stop short of
    // the bed) and blocks swimmers below — never the deck above
    {
      const bed = terrainHeight(BR.x, BR.z);
      const ph = BR.deckY - 0.9 - bed + 1.2;
      b.add(TPL.box, BR.x, BR.deckY - 0.9 - ph / 2, BR.z, 2.7, ph, 3.8, 0, BR.ry, 0, 0x6e7269, 0.1);
    }
    addCol(BR.x, BR.z, 1.5, undefined, BR.deckY - 1.2);
    // stone abutments cap both deck ends...
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const ax = BR.x + fx * sgn * 5.9, az = BR.z + fz * sgn * 5.9;
      const ah = BR.deckY - 0.05 - terrainHeight(ax, az) + 1.4;
      b.add(TPL.box, ax, BR.deckY - 0.05 - ah / 2, az, 5.0, ah, 2.8, 0, BR.ry, 0, 0x777b74, 0.08);
      // squat gate posts where the parapet hands off to the causeway
      for (let q = -1; q <= 1; q += 2)
        b.add(TPL.box, BR.x + fx * sgn * 6.6 + sxd * q * 2.15, BR.deckY + 0.4,
          BR.z + fz * sgn * 6.6 + szd * q * 2.15, 0.72, 0.95, 0.72, 0, BR.ry, 0, 0x6e7269, 0.08);
      addCol(ax, az, 2.2, undefined, BR.deckY - 1.4);
    }
    // ...and stone causeways grade the road up out of the water at each end
    // (landings probed against terrainHeight: west on the marsh-belt shore at
    // (305,−271), east on the ruins-road bank 40u out along the deck axis).
    // The walk surface is the matching ramp clamp in update(); the colliders
    // only stop swimmers below the stonework.
    const causeway = (sgn, x1, z1) => {
      const x0 = BR.x + fx * sgn * 6.0, z0 = BR.z + fz * sgn * 6.0;
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const yaw = Math.atan2(ux, uz);
      const y0 = BR.deckY, y1 = terrainHeight(x1, z1) + 0.12;
      const pitch = Math.atan2(y0 - y1, len); // slopes down toward the shore
      const n = Math.max(3, Math.round(len / 6));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const mx = x0 + dx * t, mz = z0 + dz * t;
        const topM = y0 + (y1 - y0) * t;
        const bed = Math.min(terrainHeight(mx, mz), topM - 1.6);
        const bh = topM - bed + 1.2; // sunk past the bed → rises solid
        b.add(TPL.box, mx, topM - bh / 2, mz, 4.4, bh, len / n + 0.5, pitch, yaw, 0, C_DARKSTONE, 0.09);
        addCol(mx, mz, 2.1, undefined, topM - 1.5);
      }
      BR.cws.push({ x0, z0, ux, uz, len, y0, y1 });
    };
    causeway(-1, 305, -271);                     // west, toward Emberhollow
    causeway(1, BR.x + fx * 40, BR.z + fz * 40); // east, toward Barrowdeep
    // lanterns at both deck ends so the crossing reads at night
    const L1 = { x: BR.x + fx * 5.4 + sxd * 3.2, y: BR.deckY, z: BR.z + fz * 5.4 + szd * 3.2, ry: BR.ry, s: 1.1 };
    const L2 = { x: BR.x - fx * 5.4 - sxd * 3.2, y: BR.deckY, z: BR.z - fz * 5.4 - szd * 3.2, ry: BR.ry + Math.PI, s: 1.1 };
    placeInstances('halloween/lantern_standing.gltf', [L1, L2]);
    glowB.add(TPL.box, L1.x, L1.y + 0.6, L1.z, 0.2, 0.24, 0.2, 0, BR.ry, 0, 0xffd27f, 0);
    glowB.add(TPL.box, L2.x, L2.y + 0.6, L2.z, 0.2, 0.24, 0.2, 0, BR.ry, 0, 0xffd27f, 0);
    root.add(b.build(MAT.static));
  }

  // ==========================================================================
  // THE RUINS ROAD — the north road carries on from the flooded dip's shore
  // (86,−113) the long way around the marsh lobes to Stonebridge's west
  // causeway, then picks up again off the east end toward Barrowdeep.
  // Waypoints probed against terrainHeight so every segment stays above the
  // waterline (soggiest point ≈ 1.2u above it — a proper marsh road).
  // ==========================================================================
  function buildRuinsRoad() {
    const b = new Builder(672);
    const WAY = [
      [86, -113], [76, -152], [66, -196], [30, -204], [-28, -206],
      [-33, -240], [-30, -268], [-8, -286], [16, -296], [28, -322],
      [70, -336], [120, -348], [165, -332], [195, -310], [228, -294],
      [268, -281], [305, -271],
    ];
    for (let i = 0; i < WAY.length - 1; i++)
      path(b, WAY[i][0], WAY[i][1], WAY[i + 1][0], WAY[i + 1][1], 2.4);
    // east bank: from the causeway landing on toward the ruins climb
    path(b, 363, -283, 400, -297, 2.4);
    path(b, 400, -297, 436, -308, 2.4);
    root.add(b.build(MAT.static));
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
    // Gather every eligible 200u grid cell, then keep exactly 16 (sorted by
    // hash → deterministic pick regardless of how many pass the filters).
    const cand = [];
    for (let gx = -4; gx <= 4; gx++) {
      for (let gz = -5; gz <= 4; gz++) {
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
        cand.push({ gx, gz, x, z, r: srand(gx, gz, 501) });
      }
    }
    cand.sort((a, b) => (a.r - b.r) || (a.gx - b.gx) || (a.gz - b.gz));
    if (cand.length > 16) cand.length = 16;
    let idx = 0, chestsLeft = 5;
    const bcBoxI = [], bcBarrelI = []; // spilled cargo at cart wrecks (real props)
    {
      for (let ci = 0; ci < cand.length; ci++) {
        const { gx, gz, x, z } = cand[ci];
        const ry = srand(gx, gz, 505) * 6.283;
        const kindR = srand(gx, gz, 504);
        const b = new Builder(900 + idx);
        if (kindR < 0.3) {
          buildCart(b, x, z, ry);
          bcBoxI.push({ x: x + 2.6, y: terrainHeight(x + 2.6, z + 1.9), z: z + 1.9, ry, s: 0.85 });
          bcBarrelI.push({ x: x - 2.6, y: terrainHeight(x - 2.6, z + 0.6) + 0.42, z: z + 0.6, ry: ry + 0.9, rz: Math.PI / 2, s: 0.9 });
        }
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
    placeInstances('dungeon/box_small.gltf.glb', bcBoxI);
    placeInstances('dungeon/barrel_small.gltf.glb', bcBarrelI);
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
    MAT.greenGlow.emissiveIntensity = 0.5 + night * 0.9;   // witch windows breathe at night
    MAT.greenDisc.emissiveIntensity = 0.4 + night * 0.3;
    MAT.glowDisc.emissiveIntensity = 0.55 + night * 0.35;  // fire glow pools read at night
    if (campNightFlames) campNightFlames.active = night > 0.35; // camp fire roars after dark
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
    // windmill sails turn lazily (visual)
    if (windmillFan) windmillFan.rotation.z += dt * 0.55;
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
      // Stonebridge deck — walkable span over the flooded dip (OBB clamp;
      // swimmers entering the footprint are lifted onto the deck, anything
      // well below — troll country — stays beneath)
      {
        const bdx = p.position.x - BR.x, bdz = p.position.z - BR.z;
        const lx = bdx * BR.c - bdz * BR.s;
        const lz = bdx * BR.s + bdz * BR.c;
        if (lx > -4.0 && lx < 4.0 && lz > -6.2 && lz < 6.2 &&
            p.position.y > BR.deckY - 3.4 && p.position.y < BR.deckY) {
          p.position.y = BR.deckY;
          if (p.velocity.y < 0) p.velocity.y = 0;
          p.onGround = true;
        }
        // causeway ramps off both deck ends: same clamp, height graded
        // linearly from the deck down to each shore landing
        for (let ci = 0; ci < BR.cws.length; ci++) {
          const cw = BR.cws[ci];
          const cdx = p.position.x - cw.x0, cdz = p.position.z - cw.z0;
          const t = cdx * cw.ux + cdz * cw.uz;
          if (t < -0.5 || t > cw.len) continue;
          const lat = cdx * cw.uz - cdz * cw.ux;
          if (lat < -2.2 || lat > 2.2) continue;
          const topY = cw.y0 + (cw.y1 - cw.y0) * clamp(t / cw.len, 0, 1);
          if (p.position.y > topY - 3.4 && p.position.y < topY) {
            p.position.y = topY;
            if (p.velocity.y < 0) p.velocity.y = 0;
            p.onGround = true;
          }
        }
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
  buildRuins();       // includes the NEW cemetery ring
  buildStones();
  buildTower();
  buildCamp();
  buildShrine();
  buildWitchHut();    // NEW POI
  buildStonebridge(); // NEW POI
  buildRuinsRoad();   // north road → around the marsh → Stonebridge → east bank
  buildBreadcrumbs();
  buildDocks();
  // finalize the cross-POI merged emissive meshes (1 draw call apiece)
  root.add(glowB.build(MAT.glow, false));
  root.add(fireB.build(MAT.fire, false));
  root.add(discB.build(MAT.glowDisc, false));
  root.add(runeB.build(MAT.rune, false));
  root.add(greenB.build(MAT.greenGlow, false));
  root.add(greenDiscB.build(MAT.greenDisc, false));

  return { update };
}

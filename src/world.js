// ============================================================================
// ELDERFALL — world.js
// Terrain, vegetation, water.
//  - Chunked vertex-colored terrain (5×5 hi-res + 7×7 lo-res ring), pooled,
//    max one chunk (re)build per frame.
//  - One static 4400u far shell so Drakespire always reads on the horizon.
//  - Global InstancedMesh vegetation pools (pines, oaks, rocks, grass, bushes,
//    flowers) refilled incrementally (≤1ms/frame) on 32u boundary crossings.
//  - Fresnel water plane with 3-sine displacement + sun sparkle.
// Only imports: three + core.js. No textures, no addons, no per-frame allocs.
// ============================================================================
import * as THREE from 'three';
import {
  WATER_LEVEL, POIS, BIOME, biomeAt, terrainHeight, hash2,
  clamp, lerp, smoothstep, dist2d,
} from './core.js';

// ---------------------------------------------------------------------------
// Constants & module-scope scratch (zero per-frame allocations)
// ---------------------------------------------------------------------------
const CHUNK = 64;
const HI_SEGS = 32, LO_SEGS = 16;
const HI_RADIUS = 2;          // Chebyshev radius of hi-res grid (5×5)
const RING_RADIUS = 3;        // total grid 7×7
const VEG_ANCHOR = 32;        // veg refill boundary size (u)
const SPAWN_X = 6, SPAWN_Z = 14;
const TAU = Math.PI * 2;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const _hs = new Float32Array(129 * 129); // height scratch, sized for far shell

// POIs that flatten terrain — no trees/grass/rocks placed inside these.
const FLAT_POIS = POIS.filter((p) => p.flatten && p.r > 0);

function insidePOI(wx, wz) {
  for (let i = 0; i < FLAT_POIS.length; i++) {
    const p = FLAT_POIS[i];
    if (dist2d(wx, wz, p.x, p.z) < p.r + 4) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Terrain vertex coloring — the palette. All values are linear-space and are
// pushed through ACES, so they read a touch brighter/warmer than raw numbers.
// ---------------------------------------------------------------------------
function terrainColor(wx, wz, h, slope, arr, o) {
  // Deterministic per-vertex jitter (two independent channels) + big patches.
  const qx = Math.round(wx * 2.3), qz = Math.round(wz * 2.3);
  const j1 = hash2(qx, qz, 911) - 0.5;
  const j2 = hash2(qx, qz, 917) - 0.5;
  const patch = hash2(Math.floor(wx * 0.052), Math.floor(wz * 0.052), 923); // ~19u

  let r, g, b;
  const bio = biomeAt(wx, wz, h);

  if (bio === BIOME.MEADOW) {
    // Warm meadow: fresh spring green drifting into sun-dried gold patches.
    const t = patch * patch;
    r = lerp(0.30, 0.47, t) + j2 * 0.06;
    g = lerp(0.45, 0.44, t) + j1 * 0.07;
    b = lerp(0.16, 0.14, t) + j1 * 0.02;
  } else if (bio === BIOME.FOREST) {
    // Dark forest floor: deep green + leaf-litter brown, baked AO darkening.
    const t = patch * 0.55;
    r = lerp(0.13, 0.21, t);
    g = lerp(0.23, 0.17, t);
    b = lerp(0.09, 0.10, t);
    const ao = 0.76 + j1 * 0.14; // ambient occlusion under the canopy
    r = r * ao + j2 * 0.02;
    g = g * ao + j1 * 0.03;
    b = b * ao;
  } else if (bio === BIOME.SAND) {
    r = 0.72 + j1 * 0.08;
    g = 0.62 + j1 * 0.07 + j2 * 0.02;
    b = 0.42 + j1 * 0.05;
    // Wet darkening right at the waterline.
    const wet = smoothstep(WATER_LEVEL + 1.1, WATER_LEVEL + 0.25, h);
    r *= 1 - wet * 0.35; g *= 1 - wet * 0.32; b *= 1 - wet * 0.20;
  } else if (bio === BIOME.MARSH) {
    const t = patch;
    r = lerp(0.24, 0.17, t) + j2 * 0.03;
    g = lerp(0.28, 0.23, t) + j1 * 0.04;
    b = lerp(0.13, 0.12, t);
  } else {
    // ROCKY / SNOW both start from banded strata rock; snow overlays below.
    const band = 0.5 + 0.5 * Math.sin(h * 0.52 + j1 * 2.4);
    r = lerp(0.30, 0.47, band) + j1 * 0.05;
    g = lerp(0.29, 0.43, band) + j1 * 0.05;
    b = lerp(0.30, 0.38, band) + j1 * 0.04;
  }

  // Smooth grass→rock transition around the biome threshold (58u).
  if (h > 46 && bio !== BIOME.ROCKY && bio !== BIOME.SNOW) {
    const t = smoothstep(48, 62, h + j1 * 9);
    if (t > 0) {
      const band = 0.5 + 0.5 * Math.sin(h * 0.52 + j1 * 2.4);
      r = lerp(r, lerp(0.30, 0.47, band) + j1 * 0.05, t);
      g = lerp(g, lerp(0.29, 0.43, band) + j1 * 0.05, t);
      b = lerp(b, lerp(0.30, 0.38, band) + j1 * 0.04, t);
    }
  }

  // Steep faces are bare darker cliff rock everywhere.
  const cliff = smoothstep(0.62, 1.05, slope);
  if (cliff > 0) {
    r = lerp(r, 0.33 + j1 * 0.06, cliff);
    g = lerp(g, 0.31 + j1 * 0.05, cliff);
    b = lerp(b, 0.29 + j1 * 0.05, cliff);
  }

  // Snow cap: creeps down with jitter, slides off the steepest faces.
  const snow = smoothstep(86, 99, h + j1 * 12) * (1 - smoothstep(0.75, 1.25, slope));
  if (snow > 0) {
    r = lerp(r, 0.82 + j1 * 0.06, snow);
    g = lerp(g, 0.86 + j1 * 0.06, snow);
    b = lerp(b, 0.95 + j1 * 0.04, snow);
  }

  // Underwater bed: sink toward deep teal so lakes read as water from afar.
  if (h < WATER_LEVEL + 0.4) {
    const d = smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL - 7.0, h);
    r = lerp(r, 0.05, d); g = lerp(g, 0.13, d); b = lerp(b, 0.15, d);
  }

  arr[o] = r; arr[o + 1] = g; arr[o + 2] = b;
}

// Fill a rotated PlaneGeometry (y-up) with heights + colors. Shared by
// streaming chunks and the far shell. originX/Z = mesh world position.
function paintTerrainGeometry(geo, originX, originZ, segs) {
  const posA = geo.attributes.position, colA = geo.attributes.color;
  const pArr = posA.array, cArr = colA.array;
  const n = segs + 1;
  const count = posA.count;
  for (let i = 0; i < count; i++) {
    const wx = originX + pArr[i * 3];
    const wz = originZ + pArr[i * 3 + 2];
    const h = terrainHeight(wx, wz);
    _hs[i] = h;
    pArr[i * 3 + 1] = h;
  }
  // Slope from grid finite differences (one-sided at edges).
  const step = Math.abs(pArr[3] - pArr[0]) || 1; // x spacing between verts
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const hL = _hs[ix > 0 ? i - 1 : i], hR = _hs[ix < segs ? i + 1 : i];
      const hD = _hs[iz > 0 ? i - n : i], hU = _hs[iz < segs ? i + n : i];
      const runX = step * ((ix > 0 ? 1 : 0) + (ix < segs ? 1 : 0));
      const runZ = step * ((iz > 0 ? 1 : 0) + (iz < segs ? 1 : 0));
      const slope = Math.hypot((hR - hL) / runX, (hU - hD) / runZ);
      terrainColor(originX + pArr[i * 3], originZ + pArr[i * 3 + 2], _hs[i], slope, cArr, i * 3);
    }
  }
  posA.needsUpdate = true;
  colA.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Vegetation geometry builders (init-time only; merged, vertex-colored)
// ---------------------------------------------------------------------------
// Merge transformed geometries into one non-indexed BufferGeometry with a
// vertical c0→c1 color gradient per part (+ small deterministic jitter).
// Parts that already carry a color attribute keep it.
function mergeColored(parts) {
  let total = 0;
  const items = [];
  for (const p of parts) {
    let geo = p.geo;
    if (p.matrix) geo.applyMatrix4(p.matrix);
    if (geo.index) geo = geo.toNonIndexed();
    geo.computeBoundingBox();
    total += geo.attributes.position.count;
    items.push({ geo, p });
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0, pi = 0;
  for (const { geo, p } of items) {
    const pa = geo.attributes.position, na = geo.attributes.normal, ca = geo.attributes.color;
    const y0 = geo.boundingBox.min.y;
    const y1 = Math.max(geo.boundingBox.max.y, y0 + 1e-6);
    const c1 = p.c1 || p.c0;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      pos[o] = pa.getX(i); pos[o + 1] = y; pos[o + 2] = pa.getZ(i);
      if (na) { nor[o] = na.getX(i); nor[o + 1] = na.getY(i); nor[o + 2] = na.getZ(i); }
      else nor[o + 1] = 1;
      if (ca) {
        col[o] = ca.getX(i); col[o + 1] = ca.getY(i); col[o + 2] = ca.getZ(i);
      } else {
        const t = (y - y0) / (y1 - y0);
        const j = (hash2(i * 3 + 1, pi * 7 + 1, 137) - 0.5) * 0.10;
        col[o] = clamp(lerp(p.c0[0], c1[0], t) + j, 0, 1);
        col[o + 1] = clamp(lerp(p.c0[1], c1[1], t) + j, 0, 1);
        col[o + 2] = clamp(lerp(p.c0[2], c1[2], t) + j * 0.7, 0, 1);
      }
      o += 3;
    }
    pi++;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const mat4At = (x, y, z, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz));

function buildPineGeom() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.13, 0.24, 1.4, 5, 1, true), matrix: mat4At(0, 0.7, 0), c0: [0.20, 0.14, 0.09], c1: [0.30, 0.21, 0.13] },
    { geo: new THREE.ConeGeometry(1.5, 2.4, 6, 1, true), matrix: mat4At(0, 2.5, 0), c0: [0.06, 0.15, 0.08], c1: [0.12, 0.25, 0.12] },
    { geo: new THREE.ConeGeometry(1.12, 2.0, 6, 1, true), matrix: mat4At(0, 3.9, 0), c0: [0.08, 0.18, 0.09], c1: [0.15, 0.29, 0.14] },
    { geo: new THREE.ConeGeometry(0.68, 1.6, 6, 1, true), matrix: mat4At(0, 5.05, 0), c0: [0.10, 0.21, 0.11], c1: [0.19, 0.34, 0.17] },
  ]);
}

// Deterministically lumpen icosahedron (shared corners hash identically).
function lumpy(geo, amt, seed, squashY) {
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const k = hash2(Math.round(x * 137 + y * 61), Math.round(z * 137 - y * 43), seed);
    const s = 1 - amt * 0.5 + k * amt;
    pa.setXYZ(i, x * s, y * s * squashY, z * s);
  }
  return geo;
}

function buildOakGeom() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.18, 0.34, 1.9, 5, 1, true), matrix: mat4At(0, 0.95, 0), c0: [0.22, 0.17, 0.12], c1: [0.33, 0.27, 0.19] },
    { geo: lumpy(new THREE.IcosahedronGeometry(1.55, 0), 0.35, 21, 1), matrix: mat4At(0, 2.7, 0, 1.15, 0.85, 1.15), c0: [0.12, 0.25, 0.08], c1: [0.29, 0.42, 0.13] },
    { geo: lumpy(new THREE.IcosahedronGeometry(1.0, 0), 0.35, 22, 1), matrix: mat4At(0.9, 2.15, 0.4), c0: [0.13, 0.27, 0.09], c1: [0.32, 0.44, 0.15] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.85, 0), 0.35, 23, 1), matrix: mat4At(-0.75, 2.3, -0.45), c0: [0.11, 0.23, 0.08], c1: [0.27, 0.40, 0.13] },
  ]);
}

function buildRockGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(1, 0), 0.55, 53, 0.72), c0: [0.22, 0.20, 0.18], c1: [0.50, 0.48, 0.44] },
  ]);
}

function buildBushGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.85, 0), 0.4, 57, 0.62), matrix: mat4At(0, 0.42, 0), c0: [0.09, 0.18, 0.07], c1: [0.23, 0.35, 0.11] },
  ]);
}

// Grass tuft: cross of 3 low triangles (dark base → pale tip), opaque.
function buildGrassGeom() {
  const P = [], N = [], C = [];
  const base = [0.10, 0.17, 0.05], tip = [0.50, 0.55, 0.18];
  for (let k = 0; k < 3; k++) {
    const a = k * (Math.PI / 3) + 0.35;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lean = (hash2(k, 5, 61) - 0.5) * 0.5;
    const verts = [[-0.30, 0, base], [0.30, 0, base], [0.05 + lean, 0.95, tip]];
    for (const [lx, ly, c] of verts) {
      P.push(lx * ca, ly, lx * sa);
      N.push(sa * 0.9, 0.44, -ca * 0.9);
      C.push(c[0], c[1], c[2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  return geo;
}

// Flower: green stem triangle + near-white head (tinted per instance).
function buildFlowerGeom() {
  const stem = new THREE.BufferGeometry();
  stem.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.05, 0, 0, 0.05, 0, 0, 0.01, 0.55, 0,
  ]), 3));
  stem.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0, 0.3, 1, 0, 0.3, 1, 0, 0.3, 1,
  ]), 3));
  stem.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
    0.14, 0.28, 0.09, 0.14, 0.28, 0.09, 0.20, 0.34, 0.11,
  ]), 3));
  return mergeColored([
    { geo: stem, c0: [0, 0, 0] },
    { geo: new THREE.OctahedronGeometry(0.16, 0), matrix: mat4At(0.01, 0.62, 0, 1, 0.75, 1), c0: [0.80, 0.78, 0.74], c1: [1, 1, 1] },
  ]);
}

const FLOWER_TINTS = [
  [1.00, 0.97, 0.90], // white
  [1.25, 0.95, 0.35], // gold
  [0.85, 0.60, 1.25], // violet
  [1.30, 0.50, 0.45], // poppy red
  [1.15, 0.75, 0.95], // pink
];

// Ring of cell offsets sorted nearest-first, so refill grows outward.
function ringOffsets(radiusCells) {
  const arr = [];
  const r2 = radiusCells * radiusCells + radiusCells;
  for (let dz = -radiusCells; dz <= radiusCells; dz++) {
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2) arr.push([dx, dz, d2]);
    }
  }
  arr.sort((a, b) => a[2] - b[2]);
  return arr;
}

// ---------------------------------------------------------------------------
// Water shaders
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */ `
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vWorld;
varying float vWave;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float t = uTime;
  float w = sin(wp.x * 0.13 + t * 1.05) * 0.22
          + sin(wp.x * 0.052 - wp.z * 0.077 + t * 0.62) * 0.34
          + sin(wp.z * 0.19 + t * 1.55) * 0.13;
  wp.y += w;
  vWave = w;
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uOpacity;
varying vec3 vWorld;
varying float vWave;
float whash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTime;
  // Analytic normal from the same three sines used in the vertex stage.
  float ddx = cos(vWorld.x * 0.13 + t * 1.05) * 0.0286
            + cos(vWorld.x * 0.052 - vWorld.z * 0.077 + t * 0.62) * 0.0177;
  float ddz = -cos(vWorld.x * 0.052 - vWorld.z * 0.077 + t * 0.62) * 0.0262
            + cos(vWorld.z * 0.19 + t * 1.55) * 0.0247;
  vec3 N = normalize(vec3(-ddx * 2.5, 1.0, -ddz * 2.5));
  float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
  // Deep/shallow gradient rides the wave crests.
  vec3 col = mix(uDeep, uShallow, clamp(vWave * 0.75 + 0.55, 0.0, 1.0));
  col = mix(col, uHorizon, fres * 0.78);
  float sunUp = clamp(uSunDir.y * 2.4, 0.0, 1.0);
  vec3 H = normalize(V + normalize(uSunDir + vec3(0.0, 1e-4, 0.0)));
  float spec = pow(max(dot(N, H), 0.0), 120.0) * sunUp;
  // Drifting sparkle noise.
  vec2 sp = floor(vWorld.xz * 2.1 + vec2(t * 1.4, -t * 1.1));
  float sparkle = step(0.986, whash(sp)) * sunUp * (0.35 + fres);
  col += (spec * 1.2 + sparkle * 0.55) * vec3(1.0, 0.93, 0.78);
  gl_FragColor = vec4(col, uOpacity + fres * 0.10);
  #include <fog_fragment>
}`;

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------
export function createWorld(g) {
  const scene = g.scene;
  const shadows = !!(g.quality && g.quality.shadows);

  // ---- shared materials --------------------------------------------------
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const shellMat = new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  });
  const vegMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });

  // ---- far shell (built once; ~100ms is fine at load) ---------------------
  {
    const segs = 128;
    const geo = new THREE.PlaneGeometry(4400, 4400, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    paintTerrainGeometry(geo, 0, 0, segs);
    geo.computeBoundingSphere();
    const shell = new THREE.Mesh(geo, shellMat);
    shell.position.y = -0.5;
    shell.matrixAutoUpdate = false;
    shell.updateMatrix();
    shell.frustumCulled = false;
    scene.add(shell);
  }

  // ---- terrain chunk pools -------------------------------------------------
  function makeChunkMesh(segs) {
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.visible = false;
    mesh.receiveShadow = shadows;
    mesh.userData.segs = segs;
    scene.add(mesh);
    return mesh;
  }
  const chunkPool = [[], []]; // [0]=hi (25), [1]=lo ring (24)
  for (let i = 0; i < 25; i++) chunkPool[0].push(makeChunkMesh(HI_SEGS));
  for (let i = 0; i < 24; i++) chunkPool[1].push(makeChunkMesh(LO_SEGS));

  const chunkMap = new Map(); // "cx,cz" -> { cx, cz, lod, mesh }
  const buildQueue = [];      // { cx, cz, d2 }
  let curCX = Math.floor(SPAWN_X / CHUNK);
  let curCZ = Math.floor(SPAWN_Z / CHUNK);

  function desiredLod(cx, cz) {
    const d = Math.max(Math.abs(cx - curCX), Math.abs(cz - curCZ));
    return d <= HI_RADIUS ? 0 : d <= RING_RADIUS ? 1 : -1;
  }

  function buildChunkInto(mesh, cx, cz) {
    mesh.position.set(cx * CHUNK + CHUNK / 2, 0, cz * CHUNK + CHUNK / 2);
    paintTerrainGeometry(mesh.geometry, mesh.position.x, mesh.position.z, mesh.userData.segs);
    mesh.geometry.computeBoundingSphere();
    mesh.visible = true;
  }

  // Recompute wanted set: free far chunks, enqueue missing / wrong-LOD ones.
  function refreshDesired() {
    for (const [key, rec] of chunkMap) {
      if (desiredLod(rec.cx, rec.cz) === -1) {
        if (rec.mesh) { rec.mesh.visible = false; chunkPool[rec.lod].push(rec.mesh); }
        chunkMap.delete(key);
      }
    }
    buildQueue.length = 0;
    for (let dz = -RING_RADIUS; dz <= RING_RADIUS; dz++) {
      for (let dx = -RING_RADIUS; dx <= RING_RADIUS; dx++) {
        const cx = curCX + dx, cz = curCZ + dz;
        const rec = chunkMap.get(cx + ',' + cz);
        if (rec && rec.mesh && rec.lod === desiredLod(cx, cz)) continue;
        buildQueue.push({ cx, cz, d2: dx * dx + dz * dz });
      }
    }
    buildQueue.sort((a, b) => a.d2 - b.d2);
  }

  // If a pool is empty, steal a mesh from a chunk that is due to change LOD
  // anyway (it is already re-queued; hidden for a frame or two, shell covers).
  function evictMesh(lod) {
    for (const rec of chunkMap.values()) {
      if (rec.mesh && rec.lod === lod && desiredLod(rec.cx, rec.cz) !== lod) {
        const m = rec.mesh;
        m.visible = false;
        rec.mesh = null;
        return m;
      }
    }
    return null;
  }

  // Builds at most ONE chunk, then returns.
  function processBuildQueue() {
    while (buildQueue.length) {
      const job = buildQueue.shift();
      const lod = desiredLod(job.cx, job.cz);
      if (lod === -1) continue;
      const key = job.cx + ',' + job.cz;
      let rec = chunkMap.get(key);
      if (rec && rec.mesh && rec.lod === lod) continue; // already correct
      if (rec && rec.mesh) { // LOD change: recycle old mesh first
        rec.mesh.visible = false;
        chunkPool[rec.lod].push(rec.mesh);
        rec.mesh = null;
      }
      let mesh = chunkPool[lod].pop() || evictMesh(lod);
      if (!mesh) { buildQueue.push(job); return; } // retry next frame
      buildChunkInto(mesh, job.cx, job.cz);
      if (rec) { rec.lod = lod; rec.mesh = mesh; }
      else chunkMap.set(key, { cx: job.cx, cz: job.cz, lod, mesh });
      return;
    }
  }

  // ---- vegetation: global instanced pools ----------------------------------
  function makePool(geom, mat, cap, cast) {
    const mesh = new THREE.InstancedMesh(geom, mat, cap);
    mesh.frustumCulled = false;
    mesh.castShadow = !!cast;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) {
      mesh.setMatrixAt(i, ZERO_M);
      mesh.setColorAt(i, _white); // allocates instanceColor buffer up front
    }
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    return { mesh, cap, n: 0, maxWritten: 0 };
  }

  const pine = makePool(buildPineGeom(), vegMat, 420, shadows);
  const oak = makePool(buildOakGeom(), vegMat, 230, shadows);
  const rock = makePool(buildRockGeom(), vegMat, 450, false);
  const grass = makePool(buildGrassGeom(), grassMat, 3500, false);
  const bush = makePool(buildBushGeom(), vegMat, 250, false);
  const flower = makePool(buildFlowerGeom(), grassMat, 200, false);
  const allPools = [pine, oak, rock, grass, bush, flower];

  function put(pool, x, y, z, rotY, sx, sy, cr, cg, cb) {
    if (pool.n >= pool.cap) return;
    _p.set(x, y, z);
    _q.setFromAxisAngle(UP, rotY);
    _s.set(sx, sy, sx);
    _m.compose(_p, _q, _s);
    pool.mesh.setMatrixAt(pool.n, _m);
    _c.setRGB(cr, cg, cb);
    pool.mesh.setColorAt(pool.n, _c);
    pool.n++;
    if (pool.n > pool.maxWritten) pool.maxWritten = pool.n;
  }

  // -- per-cell scatter functions (fully deterministic via hash2) -----------
  function fillTreeCell(cx, cz) {
    for (let k = 0; k < 2; k++) { // second attempt only fires in dense forest
      const s0 = 70 + k * 17;
      const wx = (cx + hash2(cx, cz, s0 + 1)) * 16;
      const wz = (cz + hash2(cx, cz, s0 + 2)) * 16;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 1.2 || h > 104) continue; // shoreline & treeline
      if (insidePOI(wx, wz)) continue;
      const bio = biomeAt(wx, wz, h);
      let density = 0, pinePref = 0.5;
      if (bio === BIOME.FOREST) { density = k === 0 ? 0.93 : 0.55; pinePref = 0.66; }
      else if (k === 0) {
        if (bio === BIOME.MEADOW) { density = 0.09; pinePref = 0.2; }
        else if (bio === BIOME.ROCKY) { density = 0.17; pinePref = 1; }
        else if (bio === BIOME.SNOW) { density = 0.06; pinePref = 1; }
        else if (bio === BIOME.MARSH) { density = 0.10; pinePref = 0.1; }
      }
      if (density === 0 || hash2(cx, cz, s0 + 3) >= density) continue;
      if (Math.abs(terrainHeight(wx + 2.4, wz + 2.4) - h) > 2.3) continue; // cliff
      const hs = hash2(cx, cz, s0 + 4);
      const rot = hash2(cx, cz, s0 + 5) * TAU;
      const hj = hash2(cx, cz, s0 + 6);
      if (hash2(cx, cz, s0 + 7) < pinePref) {
        const s = 0.75 + hs * 0.85;
        const dust = smoothstep(78, 98, h); // snow-dusted high pines
        put(pine, wx, h - 0.25, wz, rot, s, s * (0.9 + hj * 0.35),
          lerp(0.85 + hj * 0.3, 1.35, dust),
          lerp(0.90 + hj * 0.25, 1.38, dust),
          lerp(0.85 + hs * 0.2, 1.50, dust));
      } else {
        const s = 0.7 + hs * 0.75;
        const gold = hash2(cx, cz, s0 + 8) < 0.07; // rare golden-leaf oak
        put(oak, wx, h - 0.2, wz, rot, s, s * (0.85 + hj * 0.3),
          gold ? 1.50 : 0.85 + hj * 0.35,
          gold ? 1.05 : 0.90 + hs * 0.30,
          gold ? 0.45 : 0.80 + hj * 0.20);
      }
    }
  }

  function fillRockCell(cx, cz) {
    const wx = (cx + hash2(cx, cz, 141)) * 14;
    const wz = (cz + hash2(cx, cz, 142)) * 14;
    const h = terrainHeight(wx, wz);
    if (h < WATER_LEVEL + 0.5) return;
    if (insidePOI(wx, wz)) return;
    const bio = biomeAt(wx, wz, h);
    let density = 0.10;
    if (bio === BIOME.ROCKY) density = 0.55;
    else if (bio === BIOME.SNOW) density = 0.45;
    else if (bio === BIOME.FOREST) density = 0.14;
    else if (bio === BIOME.SAND) density = 0.15;
    if (hash2(cx, cz, 143) >= density) return;
    const hs = hash2(cx, cz, 144), hj = hash2(cx, cz, 146);
    const big = bio === BIOME.ROCKY || bio === BIOME.SNOW;
    const s = big ? 0.7 + hs * 2.0 : 0.4 + hs * 1.1;
    const mossy = bio === BIOME.FOREST || bio === BIOME.MARSH;
    put(rock, wx, h - 0.18 * s, wz, hash2(cx, cz, 145) * TAU, s, s * (0.8 + hj * 0.5),
      mossy ? 0.80 : bio === BIOME.SAND ? 1.10 : 0.92 + hj * 0.18,
      mossy ? 1.00 : bio === BIOME.SAND ? 1.00 : 0.92 + hj * 0.18,
      mossy ? 0.78 : bio === BIOME.SAND ? 0.82 : 0.94 + hs * 0.14);
  }

  function fillGrassCell(cx, cz) {
    const bx = (cx + 0.5) * 4, bz = (cz + 0.5) * 4;
    const h0 = terrainHeight(bx, bz);
    if (h0 < WATER_LEVEL + 1.0 || h0 > 88) return;
    const bio = biomeAt(bx, bz, h0);
    let tries = 0, density = 0;
    if (bio === BIOME.MEADOW) { tries = 3; density = 0.78; }
    else if (bio === BIOME.FOREST) { tries = 2; density = 0.42; }
    else if (bio === BIOME.MARSH) { tries = 2; density = 0.62; }
    else if (bio === BIOME.SAND) { tries = 1; density = 0.10; }
    else if (bio === BIOME.ROCKY) { tries = 1; density = 0.10; }
    if (!tries || insidePOI(bx, bz)) return;
    const dry = smoothstep(0.55, 0.9, hash2(Math.floor(bx * 0.043), Math.floor(bz * 0.043), 931));
    for (let k = 0; k < tries; k++) {
      const s0 = 30 + k * 11;
      if (hash2(cx, cz, s0) >= density) continue;
      const wx = (cx + hash2(cx, cz, s0 + 1)) * 4;
      const wz = (cz + hash2(cx, cz, s0 + 2)) * 4;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 0.9) continue;
      const hs = hash2(cx, cz, s0 + 3), hj = hash2(cx, cz, s0 + 4);
      const sx = 0.7 + hs * 0.7;
      let sy = sx * (0.8 + hj * 0.5);
      let cr, cg, cb;
      if (bio === BIOME.MARSH) { sy *= 1.7; cr = 0.75 + hj * 0.2; cg = 0.85 + hs * 0.2; cb = 0.70; } // reeds
      else if (bio === BIOME.FOREST) { cr = 0.55 + hj * 0.2; cg = 0.70 + hs * 0.2; cb = 0.62; }       // shade grass
      else if (bio === BIOME.SAND) { cr = 1.10 + hj * 0.2; cg = 1.00; cb = 0.72; }                    // dune grass
      else {
        cr = lerp(0.85 + hj * 0.30, 1.30, dry);
        cg = lerp(0.95 + hs * 0.25, 1.02, dry);
        cb = lerp(0.85, 0.55, dry);
      }
      put(grass, wx, h - 0.06, wz, hash2(cx, cz, s0 + 5) * TAU, sx, sy, cr, cg, cb);
    }
  }

  function fillBushCell(cx, cz) {
    const wx = (cx + hash2(cx, cz, 161)) * 10;
    const wz = (cz + hash2(cx, cz, 162)) * 10;
    const h = terrainHeight(wx, wz);
    if (h < WATER_LEVEL + 1.0 || h > 70) return;
    if (insidePOI(wx, wz)) return;
    const bio = biomeAt(wx, wz, h);
    let density = 0;
    if (bio === BIOME.FOREST) density = 0.30;
    else if (bio === BIOME.MEADOW) density = 0.12;
    else if (bio === BIOME.MARSH) density = 0.25;
    if (!density || hash2(cx, cz, 163) >= density) return;
    const hs = hash2(cx, cz, 164), hj = hash2(cx, cz, 165);
    const s = 0.7 + hs * 0.9;
    put(bush, wx, h - 0.05, wz, hash2(cx, cz, 166) * TAU, s, s * (0.8 + hj * 0.4),
      0.85 + hj * 0.3, 0.9 + hs * 0.25, 0.85);
  }

  function fillFlowerCell(cx, cz) {
    const wx = (cx + hash2(cx, cz, 171)) * 6;
    const wz = (cz + hash2(cx, cz, 172)) * 6;
    const h = terrainHeight(wx, wz);
    if (h < WATER_LEVEL + 1.2 || h > 60) return;
    const bio = biomeAt(wx, wz, h);
    const density = bio === BIOME.MEADOW ? 0.30 : bio === BIOME.FOREST ? 0.06 : 0;
    if (!density || hash2(cx, cz, 173) >= density) return;
    if (insidePOI(wx, wz)) return;
    const tint = FLOWER_TINTS[(hash2(cx, cz, 174) * FLOWER_TINTS.length) | 0];
    const s = 0.8 + hash2(cx, cz, 175) * 0.6;
    put(flower, wx, h - 0.02, wz, hash2(cx, cz, 176) * TAU, s, s, tint[0], tint[1], tint[2]);
  }

  // Scan phases: [cellSize(u), nearest-first offsets, fill fn, pools touched]
  const PHASES = [
    { cell: 16, offsets: ringOffsets(15), fn: fillTreeCell, pools: [pine, oak] }, // trees ≤ 240u
    { cell: 14, offsets: ringOffsets(14), fn: fillRockCell, pools: [rock] },      // rocks ≤ ~196u
    { cell: 4, offsets: ringOffsets(18), fn: fillGrassCell, pools: [grass] },     // grass ≤ 72u
    { cell: 10, offsets: ringOffsets(12), fn: fillBushCell, pools: [bush] },      // bushes ≤ 120u
    { cell: 6, offsets: ringOffsets(15), fn: fillFlowerCell, pools: [flower] },   // flowers ≤ 90u
  ];

  const vegJob = { active: false, phase: 0, idx: 0, wx: 0, wz: 0 };
  let vegAX = Math.floor(SPAWN_X / VEG_ANCHOR);
  let vegAZ = Math.floor(SPAWN_Z / VEG_ANCHOR);

  function startVegJob(ax, az) {
    vegJob.active = true;
    vegJob.phase = 0;
    vegJob.idx = 0;
    vegJob.wx = (ax + 0.5) * VEG_ANCHOR; // snapped anchor center → deterministic
    vegJob.wz = (az + 0.5) * VEG_ANCHOR;
    for (const p of allPools) p.n = 0;
  }

  function hideLeftovers(pool) {
    for (let i = pool.n; i < pool.maxWritten; i++) pool.mesh.setMatrixAt(i, ZERO_M);
    pool.maxWritten = pool.n;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.instanceColor.needsUpdate = true;
  }

  // Incremental refill, bounded by budgetMs of wall time per call.
  function processVegJob(budgetMs) {
    const t0 = performance.now();
    while (vegJob.active) {
      const ph = PHASES[vegJob.phase];
      const ccx = Math.floor(vegJob.wx / ph.cell);
      const ccz = Math.floor(vegJob.wz / ph.cell);
      const offs = ph.offsets;
      while (vegJob.idx < offs.length) {
        const oi = vegJob.idx++;
        const off = offs[oi];
        ph.fn(ccx + off[0], ccz + off[1]);
        if ((oi & 15) === 15 && performance.now() - t0 > budgetMs) return;
      }
      for (const p of ph.pools) hideLeftovers(p); // phase done → upload
      vegJob.phase++;
      vegJob.idx = 0;
      if (vegJob.phase >= PHASES.length) vegJob.active = false;
    }
  }

  // ---- water ---------------------------------------------------------------
  const waterGeo = new THREE.PlaneGeometry(1200, 1200, 64, 64);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uHorizon: { value: new THREE.Color(0.72, 0.82, 0.92) },
      uDeep: { value: new THREE.Color(0.045, 0.16, 0.26) },
      uShallow: { value: new THREE.Color(0.14, 0.40, 0.44) },
      uOpacity: { value: 0.86 },
    }]),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_LEVEL;
  water.frustumCulled = false;
  scene.add(water);
  const uW = waterMat.uniforms;

  // ---- initial synchronous build around spawn (behind loading screen) -----
  refreshDesired();
  let guard = 0;
  while (buildQueue.length && guard++ < 128) processBuildQueue();
  startVegJob(vegAX, vegAZ);
  processVegJob(1e9);

  // ---- per-frame update ----------------------------------------------------
  function update(dt) {
    const pp = g.player ? g.player.position : g.camera.position;

    // Terrain streaming: refresh wanted set on chunk cross, ≤1 build/frame.
    const ncx = Math.floor(pp.x / CHUNK), ncz = Math.floor(pp.z / CHUNK);
    if (ncx !== curCX || ncz !== curCZ) {
      curCX = ncx; curCZ = ncz;
      refreshDesired();
    }
    if (buildQueue.length) processBuildQueue();

    // Vegetation: restart incremental refill when crossing a 32u boundary.
    const ax = Math.floor(pp.x / VEG_ANCHOR), az = Math.floor(pp.z / VEG_ANCHOR);
    if (ax !== vegAX || az !== vegAZ) {
      vegAX = ax; vegAZ = az;
      startVegJob(ax, az);
    }
    if (vegJob.active) processVegJob(1.0);

    // Water: advance time (rawDt so waves idle through hitstop/menus),
    // follow player snapped to 8u (wave phase is world-space → seamless).
    uW.uTime.value += (g.time && g.time.rawDt) || dt;
    water.position.x = Math.round(pp.x / 8) * 8;
    water.position.z = Math.round(pp.z / 8) * 8;
    const sky = g.sky; // lazy — sky may not exist during early frames
    if (sky) {
      if (sky.sunDir) uW.uSunDir.value.copy(sky.sunDir);
      if (sky.horizonColor) uW.uHorizon.value.copy(sky.horizonColor);
    }
  }

  return { update };
}

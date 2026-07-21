// ============================================================================
// ELDERFALL — world.js
// Terrain, vegetation, water.
//  - Chunked vertex-colored terrain (5×5 hi-res + 7×7 lo-res ring), pooled,
//    max one chunk (re)build per frame.
//  - One static 4400u far shell so Drakespire always reads on the horizon.
//  - FOLIAGE MEGAPASS: 50 global InstancedMesh pools (15 tree archetypes,
//    12 undergrowth, 8 flower/mushroom, 10 rock, 4 debris, 1 grass) with
//    per-instance color/scale variation, seeded grove-noise species clumping,
//    biome logic (willows ring Mirrormere, dead/burned trees near Barrowdeep
//    + marsh, snow pines above h=75, glowing mushrooms near the witch's
//    forest). Refilled incrementally (≤1.5ms/frame) on 32u boundary crossings.
//  - Fresnel water plane with 3-sine displacement + sun sparkle.
// Only imports: three + core.js. No textures, no addons, no per-frame allocs.
// Art direction: dark-fantasy muted palette (moss/olive/sage, umber bark,
// cold grey rock, muted ochres) — warmth comes from lighting, not albedo.
// ============================================================================
import * as THREE from 'three';
import {
  WATER_LEVEL, POIS, POI, BIOME, biomeAt, terrainHeight, hash2, snoise,
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
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const _hs = new Float32Array(225 * 225); // height scratch, sized for far shell

// Landmark anchors used by biome-aware scatter (values mirror the fixed,
// seeded world: Mirrormere lake, Barrowdeep ruins, the witch's forest hut).
const LAKE_X = -350, LAKE_Z = 520;
const RUINS_X = POI.ruins.x, RUINS_Z = POI.ruins.z;
const WITCH_X = -260, WITCH_Z = -520;

// POIs that flatten terrain — no trees/grass/rocks placed inside these.
const FLAT_POIS = POIS.filter((p) => p.flatten && p.r > 0);
// Extra clearings for expansion structures not present in core.POIS
// (the witch's hut and Stonebridge) so vegetation never clips buildings.
const EXTRA_CLEAR = [
  { x: WITCH_X, z: WITCH_Z, r: 15 },
  { x: 330, z: -260, r: 21 },
];

// Hard exclusion for trees / rocks / debris: structures stay clear (~80% of
// the POI radius) but the forest edge no longer stops at a giant lawn line.
function insidePOI(wx, wz) {
  for (let i = 0; i < FLAT_POIS.length; i++) {
    const p = FLAT_POIS[i];
    if (dist2d(wx, wz, p.x, p.z) < p.r * 0.8 + 4) return true;
  }
  for (let i = 0; i < EXTRA_CLEAR.length; i++) {
    const p = EXTRA_CLEAR[i];
    if (dist2d(wx, wz, p.x, p.z) < p.r) return true;
  }
  return false;
}

// Soft density multiplier for grass / flowers / bushes: only the inner ~45%
// of each POI is bare; density ramps back up toward the rim so villages sit
// in worn ground that feathers into meadow instead of a clear-cut disc.
function poiGroundScale(wx, wz) {
  let m = 1;
  for (let i = 0; i < FLAT_POIS.length; i++) {
    const p = FLAT_POIS[i];
    const d = dist2d(wx, wz, p.x, p.z);
    if (d >= p.r) continue;
    if (d < p.r * 0.45) return 0;
    const t = smoothstep(p.r * 0.45, p.r * 0.95, d);
    if (t < m) m = t;
  }
  for (let i = 0; i < EXTRA_CLEAR.length; i++) {
    const p = EXTRA_CLEAR[i];
    const d = dist2d(wx, wz, p.x, p.z);
    if (d < p.r * 0.6) return 0;
    if (d < p.r) { const t = smoothstep(p.r * 0.6, p.r, d); if (t < m) m = t; }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Terrain vertex coloring — the palette. All values are linear-space and are
// pushed through ACES, so they read a touch brighter/warmer than raw numbers.
// ---------------------------------------------------------------------------
function terrainColor(wx, wz, h, slope, arr, o) {
  // Deterministic per-vertex jitter (two independent channels) + organic
  // large-scale drifts from low-frequency noise (no blocky grid patches).
  const qx = Math.round(wx * 2.3), qz = Math.round(wz * 2.3);
  const j1 = hash2(qx, qz, 911) - 0.5;
  const j2 = hash2(qx, qz, 917) - 0.5;
  const patch = snoise(wx * 0.021 + 37.2, wz * 0.021) * 0.5 + 0.5;  // ~50u swathes
  const micro = snoise(wx * 0.11, wz * 0.11 - 91.3) * 0.5 + 0.5;    // ~9u mottling

  // Strata rock (shared by ROCKY/SNOW base and the grass→rock blend below):
  // banded by altitude, warped by the patch noise, with warm iron veins.
  const band = 0.5 + 0.5 * Math.sin(h * 0.52 + patch * 3.4 + j1 * 1.8);
  const iron = smoothstep(0.35, 0.85, patch) * 0.05;
  const rockR = lerp(0.29, 0.48, band) + iron + j1 * 0.05;
  const rockG = lerp(0.28, 0.44, band) + iron * 0.55 + j1 * 0.05;
  const rockB = lerp(0.30, 0.40, band) + j1 * 0.04;

  let r, g, b;
  const bio = biomeAt(wx, wz, h);

  if (bio === BIOME.MEADOW) {
    // Muted meadow: mossy sage green drifting into dried olive-gold swathes,
    // with darker clover mottling so the flats never read as one flat green.
    const t = patch * patch;
    r = lerp(0.29, 0.46, t) + j2 * 0.05;
    g = lerp(0.41, 0.39, t) + j1 * 0.06;
    b = lerp(0.16, 0.14, t) + j1 * 0.02;
    const clover = smoothstep(0.62, 0.95, micro) * 0.22;
    r *= 1 - clover; g *= 1 - clover * 0.5; b *= 1 - clover * 0.35;
  } else if (bio === BIOME.FOREST) {
    // Dark forest floor: deep moss green ↔ leaf-litter brown, baked AO.
    const t = patch * 0.55 + micro * 0.25;
    r = lerp(0.115, 0.215, t);
    g = lerp(0.225, 0.165, t);
    b = lerp(0.085, 0.095, t);
    const ao = 0.70 + micro * 0.16 + j1 * 0.12; // ambient occlusion under canopy
    r = r * ao + j2 * 0.02;
    g = g * ao + j1 * 0.03;
    b = b * ao;
  } else if (bio === BIOME.SAND) {
    // Warm shore sand, paler where dry, wet-darkened right at the waterline.
    const t = micro * 0.5 + patch * 0.5;
    r = lerp(0.68, 0.76, t) + j1 * 0.07;
    g = lerp(0.58, 0.66, t) + j1 * 0.06 + j2 * 0.02;
    b = lerp(0.39, 0.46, t) + j1 * 0.04;
    const wet = smoothstep(WATER_LEVEL + 1.1, WATER_LEVEL + 0.25, h);
    r *= 1 - wet * 0.35; g *= 1 - wet * 0.32; b *= 1 - wet * 0.20;
  } else if (bio === BIOME.MARSH) {
    // Boggy olive greens sinking into peaty brown pools.
    const t = patch * 0.7 + micro * 0.3;
    r = lerp(0.25, 0.16, t) + j2 * 0.03;
    g = lerp(0.29, 0.22, t) + j1 * 0.04;
    b = lerp(0.135, 0.11, t);
  } else {
    // ROCKY / SNOW both start from banded strata rock; snow overlays below.
    r = rockR; g = rockG; b = rockB;
  }

  // Smooth grass→rock transition around the biome threshold (58u).
  if (h > 46 && bio !== BIOME.ROCKY && bio !== BIOME.SNOW) {
    const t = smoothstep(48, 62, h + j1 * 9 + (patch - 0.5) * 6);
    if (t > 0) {
      r = lerp(r, rockR, t);
      g = lerp(g, rockG, t);
      b = lerp(b, rockB, t);
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

// ---------------------------------------------------------------------------
// Desktop splat terrain — 6-way texture weights (see TERRAIN.md).
// ---------------------------------------------------------------------------
// Village road segments (mirrors structures.js buildVillage) so the terrain
// itself reads as worn packed dirt under/around the path decals.
const ROADS = [
  [0, 11, 0, 66, 3.2], [0, -11, -5, -60, 3.0], [-5, -60, 30, -72, 2.8],
  [30, -72, 62, -96, 2.6], [62, -96, 86, -113, 2.4], [10, 4, 28, 11, 2.2],
  [-10, 5, -26, 14, 2.2], [9, -6, 26, -13, 2.2], [-9, -6, -28, -17, 2.2],
  [6, -10, 7, -30, 2.2],
];
function roadDirt(wx, wz) {
  if (wx < -45 || wx > 105 || wz < -135 || wz > 90) return 0;
  // plaza disc (r 21) is worn to dirt, feathered at the rim
  let w = 1 - smoothstep(14, 24, dist2d(wx, wz, 0, 0));
  for (let i = 0; i < ROADS.length; i++) {
    const R = ROADS[i];
    const dx = R[2] - R[0], dz = R[3] - R[1];
    const t = clamp(((wx - R[0]) * dx + (wz - R[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = dist2d(wx, wz, R[0] + dx * t, R[1] + dz * t);
    const k = 1 - smoothstep(R[4] * 0.5 + 1.6, R[4] * 0.5 + 4.6, d);
    if (k > w) w = k;
  }
  return w;
}

// 6-way splat weights: [grass, forest, rock] → splatA, [dirt, snow, sand] →
// splatB. Derived from the SAME biome/height/slope logic as terrainColor so
// the textures agree with the vertex-color macro tint underneath.
const _sw = new Float32Array(6);
function terrainSplat(wx, wz, h, slope, ny) {
  const qx = Math.round(wx * 2.3), qz = Math.round(wz * 2.3);
  const j1 = hash2(qx, qz, 911) - 0.5;
  const patch = snoise(wx * 0.021 + 37.2, wz * 0.021) * 0.5 + 0.5;
  let g = 0, f = 0, r = 0, d = 0, s = 0, sa = 0;
  const bio = biomeAt(wx, wz, h);
  if (bio === BIOME.MEADOW) g = 1;
  else if (bio === BIOME.FOREST) f = 1;
  else if (bio === BIOME.SAND) sa = 1;
  else if (bio === BIOME.MARSH) d = 1;    // boggy peat → packed-earth set
  else r = 1;                             // ROCKY / SNOW base
  // grass→rock altitude blend (same jittered 48..62 band as terrainColor)
  if (h > 46 && r < 1) {
    const t = smoothstep(48, 62, h + j1 * 9 + (patch - 0.5) * 6);
    if (t > 0) { const k = 1 - t; g *= k; f *= k; d *= k; sa *= k; r += t; }
  }
  // village roads: worn packed dirt
  const road = roadDirt(wx, wz);
  if (road > 0) { const k = 1 - road; g *= k; f *= k; sa *= k; r *= k; d = d * k + road; }
  // steep faces are bare rock everywhere (normal.y < 0.72, blended over ~0.1)
  const cliff = 1 - smoothstep(0.72, 0.82, ny);
  if (cliff > 0) { const k = 1 - cliff; g *= k; f *= k; d *= k; sa *= k; r = r * k + cliff; }
  // snow accumulates on high, low-slope ground only (same envelope as color)
  const snow = smoothstep(86, 99, h + j1 * 12) * (1 - smoothstep(0.75, 1.25, slope));
  if (snow > 0) { const k = 1 - snow; g *= k; f *= k; d *= k; sa *= k; r *= k; s = snow; }
  const inv = 1 / (g + f + r + d + s + sa);
  _sw[0] = g * inv; _sw[1] = f * inv; _sw[2] = r * inv;
  _sw[3] = d * inv; _sw[4] = s * inv; _sw[5] = sa * inv;
  return _sw;
}

// Fill a rotated PlaneGeometry (y-up) with heights + colors. Shared by
// streaming chunks and the far shell. originX/Z = mesh world position.
// detail=true (desktop chunks only): also writes smooth heightfield normals
// (seam-free across chunks — edge columns sample terrainHeight outside the
// grid) and the two vec3 splat-weight attributes.
function paintTerrainGeometry(geo, originX, originZ, segs, detail) {
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
  if (!detail) return;
  const nArr = geo.attributes.normal.array;
  const spA = geo.attributes.splatA, spB = geo.attributes.splatB;
  const aArr = spA.array, bArr = spB.array;
  const inv2 = 1 / (2 * step);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const wx = originX + pArr[i * 3], wz = originZ + pArr[i * 3 + 2];
      const hL = ix > 0 ? _hs[i - 1] : terrainHeight(wx - step, wz);
      const hR = ix < segs ? _hs[i + 1] : terrainHeight(wx + step, wz);
      const hD = iz > 0 ? _hs[i - n] : terrainHeight(wx, wz - step);
      const hU = iz < segs ? _hs[i + n] : terrainHeight(wx, wz + step);
      const gx = (hR - hL) * inv2, gz = (hU - hD) * inv2;
      const im = 1 / Math.sqrt(gx * gx + gz * gz + 1); // = world normal.y
      nArr[i * 3] = -gx * im;
      nArr[i * 3 + 1] = im;
      nArr[i * 3 + 2] = -gz * im;
      const w = terrainSplat(wx, wz, _hs[i], Math.hypot(gx, gz), im);
      aArr[i * 3] = w[0]; aArr[i * 3 + 1] = w[1]; aArr[i * 3 + 2] = w[2];
      bArr[i * 3] = w[3]; bArr[i * 3 + 1] = w[4]; bArr[i * 3 + 2] = w[5];
    }
  }
  geo.attributes.normal.needsUpdate = true;
  spA.needsUpdate = true;
  spB.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Vegetation geometry builders (init-time only; merged, vertex-colored)
// ---------------------------------------------------------------------------
// Merge transformed geometries into one non-indexed BufferGeometry with a
// vertical c0→c1 color gradient per part (+ small deterministic jitter).
// Parts that already carry a color attribute keep it. An optional per-part
// `face(cx, cy, cz, ny, f)` callback may override whole-face colors — used
// for birch bark bands, moss tops, lichen speckles, mushroom dots, cut rings.
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
    const partStart = o; // float offset of this part's first vertex
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
    if (p.face) {
      const faces = (pa.count / 3) | 0;
      for (let f = 0; f < faces; f++) {
        const v = f * 3;
        const fcx = (pa.getX(v) + pa.getX(v + 1) + pa.getX(v + 2)) / 3;
        const fcy = (pa.getY(v) + pa.getY(v + 1) + pa.getY(v + 2)) / 3;
        const fcz = (pa.getZ(v) + pa.getZ(v + 1) + pa.getZ(v + 2)) / 3;
        const ny = na ? na.getY(v) : 1;
        const fc = p.face(fcx, fcy, fcz, ny, f);
        if (fc) {
          for (let k = 0; k < 3; k++) {
            const oo = partStart + v * 3 + k * 3;
            col[oo] = fc[0]; col[oo + 1] = fc[1]; col[oo + 2] = fc[2];
          }
        }
      }
    }
    pi++;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// Init-time TRS matrix helper (rotation in XYZ euler order).
function matTRS(x, y, z, rx = 0, ry = 0, rz = 0, s = 1, sy) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, sy === undefined ? s : sy, s));
}

const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Deterministically lumpen geometry (shared corners hash identically).
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

// -- shared palette (muted / dark-fantasy) ----------------------------------
const BARK = [[0.155, 0.115, 0.075], [0.27, 0.205, 0.13]];   // umber bark
const BARK_DK = [[0.11, 0.085, 0.06], [0.20, 0.155, 0.10]];  // darker gnarled bark
const SNOW_C = [[0.66, 0.71, 0.82], [0.88, 0.91, 1.00]];     // laden snow
const MOSS_C = [0.14, 0.21, 0.075];                          // moss overlay
const ROCK_C = [[0.195, 0.195, 0.185], [0.44, 0.44, 0.42]];  // cold grey rock

// -- conifer factory: trunk + stacked open cones. tiers: [radius, coneH, y] --
function conifer({ trunkR = 0.22, trunkH = 1.6, bark = BARK, lean = 0, radial = 6, tiers, grad, snow = false }) {
  const parts = [{
    geo: new THREE.CylinderGeometry(trunkR * 0.5, trunkR, trunkH + 0.5, 5, 1, true),
    matrix: matTRS(0, (trunkH + 0.5) * 0.5, 0, 0, 0, lean),
    c0: bark[0], c1: bark[1],
  }];
  const n = tiers.length;
  for (let i = 0; i < n; i++) {
    const [r, ch, y] = tiers[i];
    const t = n > 1 ? i / (n - 1) : 0;
    const lx = -Math.sin(lean) * y; // canopy follows the leaning trunk
    parts.push({
      geo: new THREE.ConeGeometry(r, ch, radial, 1, true),
      matrix: matTRS(lx, y, 0, 0, i * 1.9, lean * 0.55),
      c0: mixC(grad[0], grad[1], t * 0.55), c1: mixC(grad[0], grad[1], t * 0.55 + 0.45),
    });
    if (snow) parts.push({
      geo: new THREE.ConeGeometry(r * 0.74, ch * 0.34, radial, 1, true),
      matrix: matTRS(lx, y + ch * 0.40, 0, 0, i * 1.9, lean * 0.55),
      c0: SNOW_C[0], c1: SNOW_C[1],
    });
  }
  return mergeColored(parts);
}

// -- broadleaf factory: trunk (+branch sticks) + lumpy canopy blobs ----------
function canopy({ trunkR = 0.30, trunkH = 1.9, bark = BARK, lean = 0, face = null, blobs, sticks = [] }) {
  const parts = [{
    geo: new THREE.CylinderGeometry(trunkR * 0.62, trunkR, trunkH + 0.4, 5, 1, true),
    matrix: matTRS(0, (trunkH + 0.4) * 0.5, 0, 0, 0, lean),
    c0: bark[0], c1: bark[1], face,
  }];
  for (const s of sticks) parts.push({
    geo: new THREE.CylinderGeometry(s.r * 0.45, s.r, s.len, 4, 1, true),
    matrix: matTRS(s.x, s.y, s.z, s.rx || 0, 0, s.rz || 0),
    c0: bark[0], c1: bark[1],
  });
  let bi = 0;
  for (const b of blobs) {
    parts.push({
      geo: lumpy(new THREE.IcosahedronGeometry(b.r, 0), b.amt || 0.35, 21 + bi * 3, 1),
      matrix: matTRS(b.x, b.y, b.z, 0, bi * 2.1, 0, 1, b.sy || 0.85),
      c0: b.c0, c1: b.c1,
    });
    bi++;
  }
  return mergeColored(parts);
}

// Birch/aspen bark: pale trunk broken by dark horizontal band scars.
function barkBands(seed) {
  return (cx, cy, cz, ny, f) => {
    if (Math.abs(ny) > 0.7) return null; // skip caps
    const band = hash2(Math.round(cy * 6.5), 0, seed);
    if (band < 0.30 && hash2(f, 1, seed) < 0.75) return [0.10, 0.09, 0.08];
    return null;
  };
}

// ---- 15 TREE ARCHETYPES ----------------------------------------------------
const PINE_G = [[0.045, 0.105, 0.062], [0.125, 0.215, 0.115]];  // deep pine
const FIR_G = [[0.038, 0.092, 0.068], [0.10, 0.185, 0.125]];    // blue-dark fir
const SPRUCE_G = [[0.05, 0.10, 0.085], [0.115, 0.20, 0.15]];    // grey-blue spruce
const SCRAG_G = [[0.055, 0.095, 0.055], [0.13, 0.185, 0.10]];   // scraggly olive

function buildPineGeom() { // 1. classic layered pine
  return conifer({
    trunkR: 0.24, trunkH: 1.5, grad: PINE_G,
    tiers: [[1.45, 2.2, 2.4], [1.05, 1.9, 3.85], [0.62, 1.55, 5.0]],
  });
}
function buildFirGeom() { // 2. dense many-tiered fir
  return conifer({
    trunkR: 0.20, trunkH: 1.2, grad: FIR_G,
    tiers: [[1.18, 1.5, 1.95], [1.00, 1.4, 2.85], [0.82, 1.3, 3.7], [0.60, 1.2, 4.55], [0.36, 1.1, 5.35]],
  });
}
function buildDroopGeom() { // 3. droop-skirted spruce (wide flat tiers)
  return conifer({
    trunkR: 0.23, trunkH: 1.3, grad: SPRUCE_G,
    tiers: [[1.75, 1.35, 2.0], [1.45, 1.25, 2.85], [1.12, 1.15, 3.65], [0.78, 1.05, 4.4], [0.42, 1.0, 5.1]],
  });
}
function buildSpruceTallGeom() { // 4. tall narrow spire spruce
  return conifer({
    trunkR: 0.24, trunkH: 2.2, grad: SPRUCE_G,
    tiers: [[1.02, 1.9, 2.7], [0.82, 1.7, 4.1], [0.62, 1.55, 5.4], [0.42, 1.4, 6.55], [0.24, 1.25, 7.5]],
  });
}
function buildCrookedGeom() { // 5. crooked wind-bent pine
  return conifer({
    trunkR: 0.26, trunkH: 1.7, lean: 0.19, bark: BARK_DK, grad: SCRAG_G, radial: 5,
    tiers: [[1.28, 1.7, 2.25], [0.92, 1.45, 3.4], [0.52, 1.25, 4.35]],
  });
}
function buildPineSnowGeom() { // 6. snow-laden high-altitude pine
  return conifer({
    trunkR: 0.24, trunkH: 1.4, grad: FIR_G, snow: true,
    tiers: [[1.4, 2.0, 2.25], [1.0, 1.7, 3.6], [0.58, 1.4, 4.7]],
  });
}
function buildSaplingGeom() { // 7. young pine sapling (understory)
  return conifer({
    trunkR: 0.09, trunkH: 0.55, grad: PINE_G, radial: 5,
    tiers: [[0.58, 1.05, 1.0], [0.34, 0.85, 1.75]],
  });
}
function buildOakGeom() { // 8. broadleaf oak, multi-blob canopy
  return canopy({
    trunkR: 0.33, trunkH: 1.9,
    blobs: [
      { x: 0, y: 2.75, z: 0, r: 1.55, sy: 0.82, c0: [0.085, 0.155, 0.055], c1: [0.225, 0.29, 0.10] },
      { x: 0.92, y: 2.15, z: 0.42, r: 1.0, c0: [0.095, 0.17, 0.06], c1: [0.24, 0.30, 0.11] },
      { x: -0.78, y: 2.3, z: -0.45, r: 0.86, c0: [0.08, 0.145, 0.055], c1: [0.21, 0.27, 0.095] },
    ],
  });
}
function buildElmGeom() { // 9. tall vase-shaped elm
  return canopy({
    trunkR: 0.25, trunkH: 2.7,
    blobs: [
      { x: 0, y: 3.55, z: 0, r: 1.4, sy: 0.9, c0: [0.09, 0.16, 0.06], c1: [0.235, 0.30, 0.115] },
      { x: 0.85, y: 3.0, z: 0.3, r: 0.9, c0: [0.10, 0.175, 0.065], c1: [0.25, 0.315, 0.12] },
      { x: -0.75, y: 3.15, z: -0.35, r: 0.85, c0: [0.085, 0.15, 0.055], c1: [0.22, 0.28, 0.10] },
    ],
  });
}
function buildGnarlyGeom() { // 10. gnarled squat oak (thick trunk, low crown)
  return canopy({
    trunkR: 0.48, trunkH: 1.25, lean: 0.12, bark: BARK_DK,
    sticks: [
      { x: 0.55, y: 1.7, z: 0.2, rz: -0.85, r: 0.11, len: 1.3 },
      { x: -0.5, y: 1.55, z: -0.25, rz: 0.95, rx: 0.3, r: 0.10, len: 1.2 },
    ],
    blobs: [
      { x: 0.35, y: 2.25, z: 0.1, r: 1.5, sy: 0.66, amt: 0.45, c0: [0.07, 0.13, 0.05], c1: [0.185, 0.245, 0.09] },
      { x: -0.85, y: 1.95, z: -0.4, r: 0.95, sy: 0.7, amt: 0.45, c0: [0.075, 0.14, 0.05], c1: [0.20, 0.26, 0.095] },
    ],
  });
}
function buildBirchGeom() { // 11. slim pale birch, small sage crown
  return canopy({
    trunkR: 0.145, trunkH: 2.9, lean: 0.04,
    bark: [[0.60, 0.61, 0.575], [0.80, 0.81, 0.775]], face: barkBands(407),
    blobs: [
      { x: 0.1, y: 3.45, z: 0, r: 0.95, sy: 1.15, c0: [0.115, 0.17, 0.07], c1: [0.27, 0.325, 0.13] },
      { x: -0.4, y: 2.8, z: 0.25, r: 0.55, c0: [0.125, 0.185, 0.075], c1: [0.29, 0.34, 0.14] },
    ],
  });
}
function buildAspenGeom() { // 12. slim aspen, rounder gold-green crown
  return canopy({
    trunkR: 0.125, trunkH: 2.6, lean: 0.02,
    bark: [[0.55, 0.55, 0.48], [0.76, 0.76, 0.68]], face: barkBands(409),
    blobs: [
      { x: 0, y: 3.2, z: 0, r: 1.05, sy: 1.3, c0: [0.15, 0.175, 0.06], c1: [0.315, 0.31, 0.11] },
    ],
  });
}
function buildWillowGeom() { // 13. lakeside willow with drooping fronds
  const parts = [{
    geo: new THREE.CylinderGeometry(0.19, 0.32, 2.1, 5, 1, true),
    matrix: matTRS(0, 1.05, 0, 0, 0, 0.10), c0: BARK_DK[0], c1: BARK_DK[1],
  }, {
    geo: lumpy(new THREE.IcosahedronGeometry(1.55, 0), 0.32, 61, 1),
    matrix: matTRS(-0.15, 2.9, 0, 0, 0, 0, 1, 0.72),
    c0: [0.10, 0.155, 0.085], c1: [0.215, 0.285, 0.15],
  }];
  for (let i = 0; i < 6; i++) { // hanging frond cones around the dome rim
    const a = i * (TAU / 6) + 0.4;
    parts.push({
      geo: new THREE.ConeGeometry(0.30, 1.95, 5, 1, true),
      matrix: matTRS(Math.cos(a) * 1.30 - 0.15, 2.15, Math.sin(a) * 1.30, Math.PI, a, 0),
      c0: [0.085, 0.13, 0.07], c1: [0.19, 0.26, 0.13],
    });
  }
  return mergeColored(parts);
}
function buildDeadGeom() { // 14. gnarled dead tree, bare branches
  const B = [[0.16, 0.135, 0.105], [0.315, 0.275, 0.225]];
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.09, 0.30, 2.9, 5, 1, true), matrix: matTRS(0, 1.45, 0, 0, 0, 0.07), c0: B[0], c1: B[1] },
    { geo: new THREE.CylinderGeometry(0.015, 0.075, 1.5, 4, 1, true), matrix: matTRS(0.45, 2.35, 0.1, 0.2, 0, -0.95), c0: B[0], c1: B[1] },
    { geo: new THREE.CylinderGeometry(0.015, 0.065, 1.3, 4, 1, true), matrix: matTRS(-0.4, 2.0, -0.15, -0.3, 0, 1.05), c0: B[0], c1: B[1] },
    { geo: new THREE.CylinderGeometry(0.012, 0.05, 1.1, 4, 1, true), matrix: matTRS(0.15, 2.85, -0.3, -0.85, 0, -0.3), c0: B[0], c1: B[1] },
    { geo: new THREE.CylinderGeometry(0.012, 0.05, 0.9, 4, 1, true), matrix: matTRS(-0.2, 2.7, 0.3, 0.9, 0, 0.45), c0: B[0], c1: B[1] },
  ]);
}
function buildSnagGeom() { // 15. burned snag — charred broken trunk
  const C = [[0.035, 0.032, 0.030], [0.135, 0.125, 0.12]];
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.13, 0.36, 2.1, 5, 1, true), matrix: matTRS(0, 1.05, 0, 0, 0, 0.05), c0: C[0], c1: C[1] },
    { geo: new THREE.ConeGeometry(0.13, 0.55, 5, 1, true), matrix: matTRS(0, 2.35, 0, 0.18, 0, 0.12), c0: C[1], c1: C[0] },
    { geo: new THREE.CylinderGeometry(0.015, 0.06, 0.9, 4, 1, true), matrix: matTRS(0.3, 1.6, 0.1, 0.1, 0, -1.0), c0: C[0], c1: C[1] },
  ]);
}

// ---- undergrowth helpers ----------------------------------------------------
// Radial frond clump (ferns): one elongated triangle per frond, tips droop.
function frondClump({ fronds, len, tipH, baseW, baseH, c0, c1, seed }) {
  const P = [], N = [], C = [];
  for (let k = 0; k < fronds; k++) {
    const a = k * (TAU / fronds) + hash2(k, 1, seed) * 0.8;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = len * (0.8 + hash2(k, 2, seed) * 0.4);
    const th = tipH * (0.75 + hash2(k, 3, seed) * 0.5);
    // base edge perpendicular to frond direction
    P.push(-sa * baseW, baseH, ca * baseW, sa * baseW, baseH, -ca * baseW, ca * L, th, sa * L);
    for (let v = 0; v < 3; v++) { N.push(ca * 0.35, 0.9, sa * 0.35); }
    C.push(c0[0], c0[1], c0[2], c0[0], c0[1], c0[2], c1[0], c1[1], c1[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  return geo;
}

// Vertical blade clump (reeds / tall grass): triangles pointing up.
function bladeClump({ blades, height, w, spread, c0, c1, seed }) {
  const P = [], N = [], C = [];
  for (let k = 0; k < blades; k++) {
    const a = k * (TAU / blades) + hash2(k, 4, seed);
    const bx = Math.cos(a) * spread * hash2(k, 5, seed);
    const bz = Math.sin(a) * spread * hash2(k, 6, seed);
    const hgt = height * (0.75 + hash2(k, 7, seed) * 0.5);
    const lean = (hash2(k, 8, seed) - 0.5) * 0.45;
    P.push(bx - w, 0, bz, bx + w, 0, bz, bx + lean, hgt, bz + lean * 0.6);
    for (let v = 0; v < 3; v++) N.push(0, 0.5, 1);
    C.push(c0[0], c0[1], c0[2], c0[0], c0[1], c0[2], c1[0], c1[1], c1[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  return geo;
}

// ---- 12 UNDERGROWTH ARCHETYPES ----------------------------------------------
function buildFernGeom() {
  return frondClump({ fronds: 9, len: 0.78, tipH: 0.36, baseW: 0.10, baseH: 0.05, seed: 71, c0: [0.05, 0.11, 0.045], c1: [0.19, 0.28, 0.095] });
}
function buildFernBigGeom() {
  return frondClump({ fronds: 12, len: 1.2, tipH: 0.55, baseW: 0.13, baseH: 0.07, seed: 73, c0: [0.045, 0.10, 0.04], c1: [0.165, 0.255, 0.085] });
}
function buildBushRoundGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.85, 0), 0.4, 57, 0.62), matrix: matTRS(0, 0.40, 0), c0: [0.075, 0.145, 0.06], c1: [0.195, 0.285, 0.10] },
  ]);
}
function buildBushWideGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.85, 0), 0.42, 58, 0.55), matrix: matTRS(-0.45, 0.35, 0.1), c0: [0.07, 0.135, 0.055], c1: [0.185, 0.27, 0.095] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.68, 0), 0.42, 59, 0.6), matrix: matTRS(0.5, 0.3, -0.15), c0: [0.08, 0.15, 0.06], c1: [0.21, 0.29, 0.105] },
  ]);
}
function buildBrambleGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.9, 0), 0.55, 63, 0.5), matrix: matTRS(-0.3, 0.33, 0), c0: [0.06, 0.075, 0.045], c1: [0.155, 0.165, 0.085] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.65, 0), 0.55, 64, 0.55), matrix: matTRS(0.55, 0.28, 0.2), c0: [0.07, 0.08, 0.05], c1: [0.17, 0.175, 0.09] },
    { geo: new THREE.ConeGeometry(0.035, 0.5, 4, 1, true), matrix: matTRS(0.1, 0.75, 0.1, 0.3, 0, 0.25), c0: [0.10, 0.09, 0.06], c1: [0.16, 0.15, 0.10] },
    { geo: new THREE.ConeGeometry(0.03, 0.45, 4, 1, true), matrix: matTRS(-0.5, 0.65, -0.2, -0.25, 0, -0.4), c0: [0.10, 0.09, 0.06], c1: [0.16, 0.15, 0.10] },
  ]);
}
function buildBerryGeom() {
  const parts = [
    { geo: lumpy(new THREE.IcosahedronGeometry(0.78, 0), 0.4, 66, 0.68), matrix: matTRS(0, 0.42, 0), c0: [0.075, 0.135, 0.055], c1: [0.185, 0.26, 0.095] },
  ];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.35 + 0.5;
    parts.push({
      geo: new THREE.OctahedronGeometry(0.065, 0),
      matrix: matTRS(Math.cos(a) * 0.62, 0.5 + hash2(i, 9, 67) * 0.35, Math.sin(a) * 0.62),
      c0: [0.42, 0.06, 0.05], c1: [0.55, 0.10, 0.08],
    });
  }
  return mergeColored(parts);
}
function buildHeatherGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.85, 0), 0.5, 68, 0.42), matrix: matTRS(0, 0.26, 0), c0: [0.115, 0.13, 0.07], c1: [0.30, 0.20, 0.29] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.55, 0), 0.5, 69, 0.5), matrix: matTRS(0.6, 0.2, 0.35), c0: [0.11, 0.125, 0.065], c1: [0.27, 0.185, 0.27] },
  ]);
}
function buildThicketGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.75, 0), 0.42, 76, 0.6), matrix: matTRS(-0.75, 0.35, -0.1), c0: [0.065, 0.125, 0.05], c1: [0.175, 0.25, 0.09] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.95, 0), 0.42, 77, 0.58), matrix: matTRS(0.15, 0.42, 0.15), c0: [0.075, 0.14, 0.055], c1: [0.19, 0.27, 0.10] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.6, 0), 0.42, 78, 0.62), matrix: matTRS(0.95, 0.28, -0.2), c0: [0.07, 0.13, 0.05], c1: [0.18, 0.255, 0.09] },
  ]);
}
function buildShrubDryGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.7, 0), 0.55, 81, 0.6), matrix: matTRS(0, 0.32, 0), c0: [0.16, 0.13, 0.07], c1: [0.335, 0.28, 0.14] },
  ]);
}
function buildReedsGeom() {
  const parts = [
    { geo: bladeClump({ blades: 7, height: 1.85, w: 0.045, spread: 0.4, seed: 83, c0: [0.10, 0.135, 0.06], c1: [0.26, 0.30, 0.13] }), c0: [0, 0, 0] },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.30, 4, 1), matrix: matTRS(0.14, 1.55, 0.1), c0: [0.19, 0.115, 0.06], c1: [0.245, 0.15, 0.08] },
    { geo: new THREE.CylinderGeometry(0.045, 0.045, 0.26, 4, 1), matrix: matTRS(-0.2, 1.35, -0.12), c0: [0.19, 0.115, 0.06], c1: [0.245, 0.15, 0.08] },
  ];
  return mergeColored(parts);
}
function buildMossClumpGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.8, 0), 0.45, 86, 0.30), matrix: matTRS(0, 0.14, 0), c0: [0.10, 0.16, 0.055], c1: [0.235, 0.33, 0.115] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.5, 0), 0.45, 87, 0.36), matrix: matTRS(0.6, 0.11, 0.3), c0: [0.11, 0.17, 0.06], c1: [0.25, 0.35, 0.12] },
  ]);
}
function buildDeadBushGeom() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = i * (TAU / 6) + 0.3;
    parts.push({
      geo: new THREE.ConeGeometry(0.035, 0.85, 4, 1, true),
      matrix: matTRS(Math.cos(a) * 0.12, 0.38, Math.sin(a) * 0.12, Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55),
      c0: [0.12, 0.10, 0.075], c1: [0.235, 0.20, 0.15],
    });
  }
  return mergeColored(parts);
}

// ---- 8 FLOWER / MUSHROOM CLUSTER ARCHETYPES ---------------------------------
function stemPart(x, z, h, lean) {
  return {
    geo: new THREE.CylinderGeometry(0.014, 0.028, h, 3, 1, true),
    matrix: matTRS(x, h * 0.5, z, lean, 0, lean * 0.7),
    c0: [0.10, 0.17, 0.06], c1: [0.16, 0.24, 0.09],
  };
}
function buildFlowerGeom() { // simple meadow flower (tinted per instance)
  return mergeColored([
    stemPart(0, 0, 0.55, 0.05),
    { geo: new THREE.OctahedronGeometry(0.15, 0), matrix: matTRS(0.02, 0.60, 0.02, 0, 0, 0, 1, 0.7), c0: [0.62, 0.60, 0.55], c1: [0.85, 0.83, 0.78] },
  ]);
}
function buildFlowerClusterGeom() { // patch of 5 small heads
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + 0.4, rr = 0.16 + hash2(i, 2, 91) * 0.26;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = 0.28 + hash2(i, 3, 91) * 0.28;
    parts.push(stemPart(x, z, h, 0.1));
    parts.push({ geo: new THREE.OctahedronGeometry(0.085, 0), matrix: matTRS(x, h + 0.04, z, 0, 0, 0, 1, 0.75), c0: [0.60, 0.58, 0.52], c1: [0.82, 0.80, 0.75] });
  }
  return mergeColored(parts);
}
function buildFoxgloveGeom() { // tall spike of mauve bells
  const parts = [{
    geo: new THREE.CylinderGeometry(0.016, 0.034, 0.95, 3, 1, true),
    matrix: matTRS(0, 0.48, 0, 0.04, 0, 0.05), c0: [0.09, 0.15, 0.055], c1: [0.15, 0.22, 0.085],
  }];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const side = (i & 1) ? 1 : -1;
    parts.push({
      geo: new THREE.OctahedronGeometry(lerp(0.085, 0.045, t), 0),
      matrix: matTRS(side * 0.06, 0.38 + t * 0.52, side * 0.03, 0, 0, 0, 1, 1.3),
      c0: [0.38, 0.19, 0.30], c1: [0.55, 0.30, 0.44],
    });
  }
  return mergeColored(parts);
}
function buildLupineGeom() { // violet spire
  return mergeColored([
    stemPart(0, 0, 0.45, 0.04),
    { geo: new THREE.ConeGeometry(0.09, 0.55, 5, 1), matrix: matTRS(0, 0.68, 0), c0: [0.24, 0.185, 0.40], c1: [0.38, 0.30, 0.56] },
    stemPart(0.16, 0.1, 0.35, 0.12),
    { geo: new THREE.ConeGeometry(0.07, 0.42, 5, 1), matrix: matTRS(0.18, 0.52, 0.11), c0: [0.22, 0.17, 0.37], c1: [0.34, 0.27, 0.52] },
  ]);
}
function buildSeedheadGeom() { // dry wheat-like seed heads
  return mergeColored([
    stemPart(0, 0, 0.7, 0.08),
    { geo: new THREE.OctahedronGeometry(0.07, 0), matrix: matTRS(0.04, 0.78, 0.03, 0, 0, 0.2, 1, 2.1), c0: [0.34, 0.27, 0.12], c1: [0.47, 0.385, 0.18] },
    stemPart(0.2, -0.12, 0.55, 0.14),
    { geo: new THREE.OctahedronGeometry(0.06, 0), matrix: matTRS(0.25, 0.62, -0.14, 0, 0, 0.25, 1, 2.0), c0: [0.33, 0.26, 0.115], c1: [0.45, 0.37, 0.17] },
  ]);
}
function mushroomPart(x, z, capR, capH, stemH, capC0, capC1, dots) {
  const face = dots ? (cx, cy, cz, ny, f) => (hash2(f, 3, 217) < 0.22 ? [0.78, 0.74, 0.66] : null) : null;
  return [
    { geo: new THREE.CylinderGeometry(0.028, 0.05, stemH, 4, 1, true), matrix: matTRS(x, stemH * 0.5, z), c0: [0.50, 0.46, 0.38], c1: [0.66, 0.62, 0.53] },
    { geo: new THREE.ConeGeometry(capR, capH, 6, 1), matrix: matTRS(x, stemH + capH * 0.35, z), c0: capC0, c1: capC1, face },
  ];
}
function buildMushRedGeom() { // red-cap cluster (speckled)
  return mergeColored([
    ...mushroomPart(0, 0, 0.17, 0.13, 0.26, [0.42, 0.075, 0.05], [0.56, 0.12, 0.07], true),
    ...mushroomPart(0.24, 0.12, 0.12, 0.10, 0.18, [0.40, 0.07, 0.05], [0.52, 0.11, 0.065], true),
    ...mushroomPart(-0.18, 0.16, 0.09, 0.08, 0.13, [0.44, 0.08, 0.055], [0.58, 0.13, 0.075], true),
  ]);
}
function buildMushBrownGeom() { // squat brown toadstools
  return mergeColored([
    ...mushroomPart(0, 0, 0.16, 0.09, 0.16, [0.24, 0.165, 0.09], [0.36, 0.26, 0.15], false),
    ...mushroomPart(0.22, -0.1, 0.11, 0.07, 0.11, [0.22, 0.15, 0.08], [0.33, 0.235, 0.135], false),
  ]);
}
function buildMushGlowGeom() { // glowing witch-forest mushrooms (emissive mat)
  const parts = [];
  const spots = [[0, 0, 1.0], [0.22, 0.14, 0.7], [-0.2, 0.1, 0.8], [0.05, -0.22, 0.55]];
  for (const [x, z, s] of spots) {
    parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.038, 0.30 * s, 4, 1, true), matrix: matTRS(x, 0.15 * s, z), c0: [0.28, 0.42, 0.36], c1: [0.42, 0.62, 0.52] });
    parts.push({ geo: new THREE.ConeGeometry(0.13 * s, 0.11 * s, 6, 1), matrix: matTRS(x, 0.31 * s, z), c0: [0.14, 0.55, 0.42], c1: [0.30, 0.85, 0.62] });
  }
  return mergeColored(parts);
}

// ---- 10 ROCK ARCHETYPES -----------------------------------------------------
const mossFace = (seed) => (cx, cy, cz, ny, f) =>
  (ny > 0.42 && hash2(f, 5, seed) < 0.85)
    ? [MOSS_C[0] + hash2(f, 6, seed) * 0.07, MOSS_C[1] + hash2(f, 7, seed) * 0.09, MOSS_C[2]]
    : null;
const lichenFace = (seed) => (cx, cy, cz, ny, f) =>
  (hash2(f, 8, seed) < 0.20) ? [0.44, 0.48, 0.40] : null;

function buildBoulderGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(1, 0), 0.55, 53, 0.72), c0: ROCK_C[0], c1: ROCK_C[1] },
  ]);
}
function buildMossBoulderGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(1, 0), 0.5, 54, 0.66), c0: [0.17, 0.17, 0.16], c1: [0.38, 0.38, 0.36], face: mossFace(311) },
  ]);
}
function buildSplitRockGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(0.85, 0), 0.45, 55, 0.9), matrix: matTRS(-0.52, 0.3, 0, 0, 0, 0.28), c0: ROCK_C[0], c1: ROCK_C[1] },
    { geo: lumpy(new THREE.IcosahedronGeometry(0.75, 0), 0.45, 56, 0.95), matrix: matTRS(0.55, 0.22, 0.1, 0, 0.7, -0.32), c0: [0.175, 0.175, 0.165], c1: [0.40, 0.40, 0.38] },
  ]);
}
function buildSlabStackGeom() {
  return mergeColored([
    { geo: new THREE.BoxGeometry(1.7, 0.38, 1.25), matrix: matTRS(0, 0.18, 0, 0, 0.15, 0.03), c0: [0.185, 0.185, 0.175], c1: [0.33, 0.33, 0.31] },
    { geo: new THREE.BoxGeometry(1.35, 0.34, 1.0), matrix: matTRS(0.1, 0.53, -0.05, 0, -0.35, -0.04), c0: [0.20, 0.20, 0.19], c1: [0.37, 0.37, 0.35] },
    { geo: new THREE.BoxGeometry(0.95, 0.30, 0.75), matrix: matTRS(-0.08, 0.84, 0.06, 0.05, 0.55, 0), c0: [0.22, 0.22, 0.21], c1: [0.42, 0.42, 0.40] },
  ]);
}
function buildShardGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.ConeGeometry(0.55, 2.3, 5, 1), 0.35, 57, 1), matrix: matTRS(0, 1.0, 0, 0.10, 0, 0.14), c0: [0.16, 0.16, 0.155], c1: [0.42, 0.42, 0.40] },
  ]);
}
function buildShardClusterGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.ConeGeometry(0.48, 1.9, 5, 1), 0.35, 58, 1), matrix: matTRS(0, 0.82, 0, 0.08, 0, 0.1), c0: [0.16, 0.16, 0.155], c1: [0.41, 0.41, 0.39] },
    { geo: lumpy(new THREE.ConeGeometry(0.36, 1.2, 5, 1), 0.35, 59, 1), matrix: matTRS(0.62, 0.48, 0.25, -0.1, 0.9, 0.3), c0: [0.17, 0.17, 0.16], c1: [0.38, 0.38, 0.36] },
    { geo: lumpy(new THREE.ConeGeometry(0.28, 0.85, 4, 1), 0.35, 60, 1), matrix: matTRS(-0.5, 0.32, -0.3, 0.12, 0.4, -0.35), c0: [0.18, 0.18, 0.17], c1: [0.40, 0.40, 0.38] },
  ]);
}
function buildFlatSlabGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(1.1, 0), 0.4, 62, 0.26), matrix: matTRS(0, 0.12, 0), c0: [0.19, 0.19, 0.18], c1: [0.40, 0.40, 0.38], face: lichenFace(313) },
  ]);
}
function buildPebblesGeom() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.6, rr = 0.25 + hash2(i, 4, 95) * 0.45;
    parts.push({
      geo: lumpy(new THREE.IcosahedronGeometry(0.22 + hash2(i, 5, 95) * 0.16, 0), 0.4, 63 + i, 0.7),
      matrix: matTRS(Math.cos(a) * rr, 0.08, Math.sin(a) * rr),
      c0: [0.20, 0.20, 0.19], c1: [0.42, 0.42, 0.40],
    });
  }
  return mergeColored(parts);
}
function buildLichenRockGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.IcosahedronGeometry(1, 0), 0.5, 65, 0.78), c0: [0.185, 0.185, 0.18], c1: [0.43, 0.43, 0.41], face: lichenFace(317) },
  ]);
}
function buildCliffChunkGeom() {
  return mergeColored([
    { geo: lumpy(new THREE.DodecahedronGeometry(1.15, 0), 0.4, 67, 0.85), matrix: matTRS(0, 0.35, 0, 0, 0, 0.12), c0: [0.145, 0.145, 0.14], c1: [0.36, 0.36, 0.345] },
  ]);
}

// ---- 4 DEBRIS ARCHETYPES (logs authored lying along X; rotY spins them) ----
function logFace(mossy, seed) {
  return (cx, cy, cz, ny, f) => {
    if (Math.abs(cx) > 1.18) return [0.40, 0.315, 0.20]; // pale cut ends
    if (mossy && ny > 0.5 && hash2(f, 9, seed) < 0.8) return [MOSS_C[0] + hash2(f, 10, seed) * 0.06, MOSS_C[1] + hash2(f, 11, seed) * 0.08, MOSS_C[2]];
    return null;
  };
}
function buildLogGeom() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.24, 0.29, 2.5, 6, 1), matrix: matTRS(0, 0.24, 0, 0, 0, Math.PI / 2), c0: [0.14, 0.105, 0.07], c1: [0.26, 0.20, 0.13], face: logFace(false, 331) },
    { geo: new THREE.CylinderGeometry(0.02, 0.07, 0.7, 4, 1, true), matrix: matTRS(0.4, 0.5, 0.1, 0.4, 0, -0.5), c0: [0.13, 0.10, 0.065], c1: [0.22, 0.17, 0.11] },
  ]);
}
function buildLogMossyGeom() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.27, 0.31, 2.4, 6, 1), matrix: matTRS(0, 0.26, 0, 0, 0, Math.PI / 2), c0: [0.125, 0.095, 0.065], c1: [0.235, 0.18, 0.12], face: logFace(true, 333) },
  ]);
}
function buildStumpGeom() {
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.34, 0.44, 0.6, 6, 1), matrix: matTRS(0, 0.3, 0), c0: [0.145, 0.11, 0.075], c1: [0.25, 0.19, 0.125], face: (cx, cy, cz, ny, f) => (ny > 0.9 ? [0.38, 0.30, 0.185] : null) },
    { geo: new THREE.ConeGeometry(0.18, 0.5, 4, 1, true), matrix: matTRS(0.42, 0.16, 0.1, 0, 0, -1.15), c0: [0.13, 0.10, 0.07], c1: [0.20, 0.155, 0.10] },
    { geo: new THREE.ConeGeometry(0.15, 0.45, 4, 1, true), matrix: matTRS(-0.38, 0.14, -0.15, 0, 0, 1.2), c0: [0.13, 0.10, 0.07], c1: [0.20, 0.155, 0.10] },
  ]);
}
function buildRootSnagGeom() {
  const parts = [{ geo: lumpy(new THREE.IcosahedronGeometry(0.4, 0), 0.5, 97, 0.55), matrix: matTRS(0, 0.16, 0), c0: [0.10, 0.08, 0.055], c1: [0.19, 0.15, 0.10] }];
  for (let i = 0; i < 4; i++) {
    const a = i * (TAU / 4) + 0.5;
    parts.push({
      geo: new THREE.ConeGeometry(0.09, 1.0, 4, 1, true),
      matrix: matTRS(Math.cos(a) * 0.35, 0.42, Math.sin(a) * 0.35, Math.cos(a) * (0.5 + i * 0.12), 0, Math.sin(a) * (0.5 + i * 0.12)),
      c0: [0.115, 0.09, 0.06], c1: [0.215, 0.17, 0.115],
    });
  }
  return mergeColored(parts);
}

// Grass tuft: cross of 3 low triangles (dark base → muted sage tip), opaque.
function buildGrassGeom() {
  const P = [], N = [], C = [];
  const base = [0.085, 0.135, 0.05], tip = [0.37, 0.40, 0.155];
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

// Muted flower tints (multiplied per instance onto the pale head geometry).
const FLOWER_TINTS = [
  [0.95, 0.92, 0.85], // bone white
  [1.12, 0.90, 0.42], // muted gold
  [0.72, 0.58, 0.95], // dusk violet
  [1.05, 0.52, 0.40], // faded poppy
  [0.98, 0.72, 0.82], // ashen pink
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
uniform float uDay;
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
  // Night grade: sink base + fresnel toward deep indigo (#0a1626) as uDay→0.
  vec3 night = vec3(0.024, 0.052, 0.10) + fres * vec3(0.018, 0.042, 0.088);
  col = mix(night, col, uDay);
  float sunUp = clamp(uSunDir.y * 2.4, 0.0, 1.0);
  vec3 H = normalize(V + normalize(uSunDir + vec3(0.0, 1e-4, 0.0)));
  float spec = pow(max(dot(N, H), 0.0), 120.0) * sunUp;
  // Drifting sparkle noise (warm by day, faint cool glints at night).
  vec2 sp = floor(vWorld.xz * 2.1 + vec2(t * 1.4, -t * 1.1));
  float spk = step(0.986, whash(sp));
  float sparkle = spk * sunUp * (0.35 + fres);
  col += (spec * 1.2 + sparkle * 0.55) * vec3(1.0, 0.93, 0.78);
  col += spk * (1.0 - uDay) * 0.08 * vec3(0.65, 0.78, 1.0);
  gl_FragColor = vec4(col, uOpacity + fres * 0.10);
  #include <fog_fragment>
}`;

// ---------------------------------------------------------------------------
// EPIC WAVE — beyond-the-map mega-peaks, dawn valley fog, forest god-rays
// ---------------------------------------------------------------------------
// Mega-peak ring: colossal silhouette massifs OUTSIDE the far shell
// (r 2600–3400, peaks 700–1300u). One static mesh, one draw call, ~4.8k tris.
// They sit beyond fog.far AND beyond the sky dome radius (1900), so:
//  - renderOrder 2 draws them AFTER the dome (dome writes no depth), and
//  - a custom shader bakes atmospheric haze toward the live horizonColor
//    instead of scene fog (which would erase them completely).
//  - clip-space z is clamped just inside the far plane so a player at the
//    map's far side never sees a massif sliced by the 4200u frustum.
// Bearings (atan2(z,x) degrees): Drakespire reads at ~-77° from the village,
// so the ring leaves a wide sky gap from ~-112° to ~-51° that FRAMES it,
// plus sea-level gaps east / southeast / west — 6 massifs, not a wall.
const MASSIFS = [ // sorted far → near (painter's order under equal clamped z)
  { c: -175, span: 36, r: 3350, h: 1300, seed: 7 },  // W — farthest ghost giant
  { c: -30,  span: 42, r: 3100, h: 1250, seed: 3 },  // NNE — right flank of the frame
  { c: 152,  span: 46, r: 3050, h: 950,  seed: 5 },  // SSW
  { c: -140, span: 55, r: 2950, h: 1150, seed: 1 },  // NW — left flank of the frame
  { c: 22,   span: 34, r: 2750, h: 780,  seed: 9 },  // E
  { c: 88,   span: 40, r: 2700, h: 700,  seed: 11 }, // SE
];

const MEGA_VERT = /* glsl */ `
attribute float aSnow;
attribute float aHaze;
varying vec3 vN;
varying float vSnow;
varying float vHaze;
void main() {
  vN = normal; // mesh is static at the origin → object space == world space
  vSnow = aSnow;
  vHaze = aHaze;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Never far-clip: clamp depth just inside the far plane (they are always
  // the farthest geometry, so ordering vs. terrain is unaffected).
  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.9999);
}`;

const MEGA_FRAG = /* glsl */ `
uniform vec3 uHaze;      // sky horizonColor (shared instance)
uniform vec3 uSunDir;    // shared sky sunDir
uniform vec3 uLightCol;  // sun/moon light color
uniform float uDay;      // 0 night … 1 day
uniform float uGolden;   // golden-hour weight
varying vec3 vN;
varying float vSnow;
varying float vHaze;
void main() {
  vec3 N = normalize(vN);
  float sf = max(dot(N, uSunDir), 0.0);
  // Silhouette rock: a darker, cooler read of the sky itself.
  vec3 rock = uHaze * (mix(0.60, 0.40, uDay) + 0.16 * sf * uDay);
  // Snow caps: lifted toward white, catching the sun on lit faces.
  vec3 snow = mix(uHaze, vec3(1.0), 0.28 + 0.26 * uDay) * (0.72 + 0.40 * sf * uDay);
  vec3 col = mix(rock, snow, vSnow);
  // Golden-hour kiss on sun-facing slopes (strongest on snow).
  col += uLightCol * uGolden * sf * (0.10 + 0.15 * vSnow);
  // Baked atmospheric perspective: bases melt into the horizon.
  col = mix(col, uHaze, vHaze);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Build the whole ring as one indexed heightfield-strip geometry.
function buildMegaPeakGeometry() {
  const NU = 40, NV = 10, DEPTH = 700;
  const vertsPer = (NU + 1) * (NV + 1);
  const total = vertsPer * MASSIFS.length;
  const pos = new Float32Array(total * 3);
  const snowA = new Float32Array(total);
  const hazeA = new Float32Array(total);
  const idx = new Uint32Array(NU * NV * 6 * MASSIFS.length);
  let vo = 0, io = 0;
  const D2R = Math.PI / 180;
  for (const M of MASSIFS) {
    const a0 = (M.c - M.span / 2) * D2R, a1 = (M.c + M.span / 2) * D2R;
    const s1 = M.seed * 13.7, s2 = M.seed * 7.1;
    const snowline = 0.44 * M.h + 190;
    const baseHaze = 0.18 + 0.38 * smoothstep(2650, 3400, M.r);
    const base = vo;
    for (let iu = 0; iu <= NU; iu++) {
      const u01 = iu / NU;
      const ang = lerp(a0, a1, u01);
      // Ridge profile along the arc: 2–4 sub-peaks (ridged noise), tapered ends.
      const envU = Math.pow(Math.sin(Math.PI * u01), 0.85);
      const prof = 0.40 + 0.60 * Math.pow(1 - Math.abs(snoise(u01 * 3.1 + s1, s2)), 2);
      const crest = 0.5 + 0.16 * snoise(u01 * 2.3 + s1 * 0.31, s2 + 9.7); // wandering spine
      for (let iv = 0; iv <= NV; iv++) {
        const v01 = iv / NV;
        const rr = M.r + (v01 - 0.5) * DEPTH;
        const dv = (v01 - crest) / 0.55;
        const envV = Math.pow(Math.max(0, 1 - dv * dv), 1.4);
        const detail = snoise(u01 * 9.3 + s1, v01 * 4.1 + s2) * 0.07;
        let h = M.h * envU * envV * (prof + detail) - 45;
        if (h < -60) h = -60;
        const i3 = vo * 3;
        pos[i3] = Math.cos(ang) * rr;
        pos[i3 + 1] = h;
        pos[i3 + 2] = Math.sin(ang) * rr;
        const jit = snoise(u01 * 23.1 + s2, v01 * 17.7 + s1) * 70;
        snowA[vo] = smoothstep(snowline, snowline + M.h * 0.26, h + jit);
        hazeA[vo] = clamp(baseHaze + 0.62 * smoothstep(380, 20, h), 0, 0.96);
        vo++;
      }
    }
    for (let iu = 0; iu < NU; iu++) {
      for (let iv = 0; iv < NV; iv++) {
        const a = base + iu * (NV + 1) + iv;
        const b = a + NV + 1;
        idx[io++] = a; idx[io++] = b; idx[io++] = a + 1;
        idx[io++] = b; idx[io++] = b + 1; idx[io++] = a + 1;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSnow', new THREE.BufferAttribute(snowA, 1));
  geo.setAttribute('aHaze', new THREE.BufferAttribute(hazeA, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo; // 6 massifs × 800 tris = 4800 tris
}

// -- dawn valley fog banks ---------------------------------------------------
// Soft ellipse discs (radial vertex-alpha falloff) stacked 3-high per bank,
// merged into ONE geometry per drift layer → 2 draw calls total, and only
// while 0.18 < dayFrac < 0.34. Centers hug the low ground by Mirrormere and
// the south fields (terrain h ≈ -3…16 there).
const FOG_BANKS = [
  { x: -350, z: 520, r: 170, y: 0.5 }, // over Mirrormere itself
  { x: -520, z: 400, r: 110, y: 1.0 }, // lake west shore
  { x: -180, z: 620, r: 115, y: 9.5 }, // lake east meadows
  { x: -30,  z: 680, r: 135, y: 7.0 }, // south fields
  { x: 150,  z: 655, r: 120, y: 15.0 }, // south fields, east rise
  { x: 80,   z: 850, r: 125, y: 8.0 }, // far south hollow
];

// One soft disc: center vertex → mid ring (55%) → rim (alpha 0), 18 segments.
// axis: 0 = horizontal sheet (XZ), 1 = vertical curtain in XY, 2 = vertical in ZY.
function pushFogDisc(P, C, I, cx, y, cz, r, alpha, seed, axis = 0, ry = 1) {
  const SEG = 18;
  const v0 = P.length / 3;
  P.push(cx, y, cz); C.push(1, 1, 1, alpha);
  for (let ring = 0; ring < 2; ring++) {
    const rr = ring === 0 ? r * 0.55 : r;
    const a = ring === 0 ? alpha * 0.72 : 0;
    for (let k = 0; k <= SEG; k++) {
      const t = (k / SEG) * TAU;
      const wob = 1 + (hash2(k + ring * 31, seed, 733) - 0.5) * 0.24; // organic rim
      const u = Math.cos(t) * rr * wob, v = Math.sin(t) * rr * wob;
      if (axis === 0) {
        P.push(cx + u, y + (hash2(k, seed + ring, 739) - 0.5) * 1.2, cz + v);
      } else if (axis === 1) {
        P.push(cx + u, y + v * ry, cz + (hash2(k, seed + ring, 741) - 0.5) * 6);
      } else {
        P.push(cx + (hash2(k, seed + ring, 743) - 0.5) * 6, y + v * ry, cz + u);
      }
      C.push(1, 1, 1, a);
    }
  }
  const inner = v0 + 1, outer = v0 + 1 + (SEG + 1);
  for (let k = 0; k < SEG; k++) {
    I.push(v0, inner + k, inner + k + 1);
    I.push(inner + k, outer + k, outer + k + 1, inner + k, outer + k + 1, inner + k + 1);
  }
}

function buildFogBankGeometry(layerB) {
  const P = [], C = [], I = [];
  const LIFT = [1.5, 5.0, 9.0];         // stacked plane heights
  const AL = [0.60, 0.46, 0.33];        // fading with height
  let si = 0;
  for (const b of FOG_BANKS) {
    const cx = b.x + (layerB ? 35 : 0), cz = b.z + (layerB ? -25 : 0);
    const r = b.r * (layerB ? 0.78 : 1);
    const y = b.y + (layerB ? 2.2 : 0);
    for (let s = 0; s < 3; s++) {
      pushFogDisc(P, C, I, cx, y + LIFT[s], cz, r * (1 - s * 0.13), AL[s], si * 7 + s);
    }
    // Crossed vertical curtains: sheets vanish edge-on from ground level, so
    // these carry the bank when seen from a hill at grazing angles (squashed
    // to ~22% height → a low lens of mist, not a wall).
    pushFogDisc(P, C, I, cx, y + 6.0, cz, r * 0.92, 0.46, si * 7 + 3, 1, 0.22);
    pushFogDisc(P, C, I, cx, y + 6.0, cz, r * 0.92, 0.46, si * 7 + 4, 2, 0.22);
    si++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 4)); // RGBA → USE_COLOR_ALPHA
  geo.setIndex(I);
  geo.computeBoundingSphere();
  return geo; // 18 discs × 54 tris ≈ 970 tris per layer
}

// -- forest god-rays ---------------------------------------------------------
// 12 shafts in the dense forest north of the village (all verified FOREST
// biome), each two crossed tapered quads with soft vertex-alpha edges,
// merged per time-window (morning lean ≠ evening lean) → 2 meshes sharing
// ONE additive material; at most 1 visible at a time.
const RAY_SPOTS = [
  [150, -350], [110, -350], [70, -350], [190, -350], [230, -350],
  [230, -310], [190, -310], [170, -320], [250, -330],
  [270, -350], [60, -320], [40, -340],
];

function sunAxisAt(f) { // beam axis: toward the sun, lifted so shafts stay readable
  const ang = (f - 0.25) * TAU;
  const v = new THREE.Vector3(Math.cos(ang) * 0.92, Math.sin(ang), 0.5).normalize();
  return v.multiplyScalar(0.55).add(new THREE.Vector3(0, 0.45, 0)).normalize();
}

function buildGodRayGeometry(axis) {
  const P = [], C = [], I = [];
  const ROW_A = [0.0, 0.6, 0.8, 0.12]; // ground → canopy alpha profile (soft top: no sky pillars)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
  const v = new THREE.Vector3();
  let si = 0;
  for (const [sx, sz] of RAY_SPOTS) {
    const h = terrainHeight(sx, sz);
    const L = 12 + hash2(si, 1, 811) * 4; // short: beams stay inside the canopy
    const inten = 0.7 + hash2(si, 2, 811) * 0.3;
    const yaw0 = hash2(si, 3, 811) * TAU;
    for (let pl = 0; pl < 2; pl++) {
      const yaw = yaw0 + pl * Math.PI / 2;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const v0 = P.length / 3;
      for (let j = 0; j <= 3; j++) { // rows bottom → top
        const t = j / 3;
        const hw = lerp(3.4, 1.2, t); // beam narrows toward the canopy
        for (let i = -1; i <= 1; i++) {
          v.set(i * hw * cy, t * L, i * hw * sy).applyQuaternion(q);
          P.push(sx + v.x, h + 0.4 + v.y, sz + v.z);
          const a = ROW_A[j] * (i === 0 ? 1 : 0) * inten;
          C.push(1.0 * inten, 0.84 * inten, 0.60 * inten, a);
        }
      }
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 2; i++) {
          const a = v0 + j * 3 + i, b = a + 3;
          I.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    si++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 4));
  geo.setIndex(I);
  geo.computeBoundingSphere();
  return geo; // 12 spots × 2 planes × 12 tris = 288 tris per window mesh
}

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------
export function createWorld(g) {
  const scene = g.scene;
  const shadows = !!(g.quality && g.quality.shadows);

  // ---- shared materials --------------------------------------------------
  // Terrain: desktop gets the photoreal 6-way splat material (TERRAIN.md) —
  // MeshLambertMaterial + onBeforeCompile keeps shadows / fog / point lights
  // for free. Mobile keeps the legacy vertex-color flat-shaded path untouched.
  const DESKTOP = !!(g.quality && g.quality.desktop);
  const terrainMat = DESKTOP
    ? makeSplatTerrainMaterial()
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  function makeSplatTerrainMaterial() {
    const loader = new THREE.TextureLoader();
    const maxAniso = g.renderer ? Math.min(8, g.renderer.capabilities.getMaxAnisotropy()) : 8;
    const loadTex = (file, srgb) => {
      const t = loader.load('assets/terrain/' + file);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      return t;
    };
    const SETS = ['grass', 'forest', 'rock', 'dirt', 'snow', 'sand'];
    const dTex = SETS.map((s2) => loadTex(s2 + '_d.jpg', true));
    const nTex = SETS.map((s2) => loadTex(s2 + '_n.jpg', false));
    const macroN = loadTex('macro_n.jpg', false);
    const noiseT = loadTex('noise.jpg', false);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true }); // flatShading OFF
    mat.onBeforeCompile = (shader) => {
      for (let i = 0; i < 6; i++) {
        shader.uniforms['uD' + i] = { value: dTex[i] };
        shader.uniforms['uN' + i] = { value: nTex[i] };
      }
      shader.uniforms.uMacroN = { value: macroN };
      shader.uniforms.uNoise = { value: noiseT };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */ `#include <common>
attribute vec3 splatA;
attribute vec3 splatB;
varying vec3 vSplatA;
varying vec3 vSplatB;
varying vec3 vTerrPos;
varying vec3 vTerrN;`)
        .replace('#include <worldpos_vertex>', /* glsl */ `#include <worldpos_vertex>
vSplatA = splatA;
vSplatB = splatB;
vTerrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrN = normalize(mat3(modelMatrix) * objectNormal);`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
uniform sampler2D uD0; uniform sampler2D uD1; uniform sampler2D uD2;
uniform sampler2D uD3; uniform sampler2D uD4; uniform sampler2D uD5;
uniform sampler2D uN0; uniform sampler2D uN1; uniform sampler2D uN2;
uniform sampler2D uN3; uniform sampler2D uN4; uniform sampler2D uN5;
uniform sampler2D uMacroN; uniform sampler2D uNoise;
varying vec3 vSplatA;
varying vec3 vSplatB;
varying vec3 vTerrPos;
varying vec3 vTerrN;
vec3 g_tnrm;   // tangent-space splat normal, filled during albedo pass
vec3 g_wdelta; // world-space normal delta from triplanar rock side-projections
// Anti-tiling: two offset copies of each texture blended by a low-frequency
// phase from noise.jpg — breaks the repeat grid with zero seams.
vec2 terrOff(float i) { return sin(vec2(3.0, 7.0) * i) * 3.71; }
void terrTap(sampler2D dT, sampler2D nT, vec2 uv, vec2 oa, vec2 ob, float bf,
             float w, inout vec3 alb, inout vec3 nrm, inout float ws) {
  alb += mix(texture2D(dT, uv + oa), texture2D(dT, uv + ob), bf).rgb * w;
  nrm += (mix(texture2D(nT, uv + oa), texture2D(nT, uv + ob), bf).rgb * 2.0 - 1.0) * w;
  ws += w;
}`)
        .replace('#include <color_fragment>', /* glsl */ `{
  vec2 tp = vTerrPos.xz;
  float phase = texture2D(uNoise, tp * (1.0 / 187.0)).g;
  float pl = phase * 6.0;
  vec2 oa = terrOff(floor(pl));
  vec2 ob = terrOff(floor(pl) + 1.0);
  float bf = smoothstep(0.25, 0.75, fract(pl));
  vec3 alb = vec3(0.0);
  vec3 tn = vec3(0.0);
  float ws = 0.0;
  g_wdelta = vec3(0.0);
  // sharpen interpolated weights → crisp material borders, no muddy 50/50
  vec3 sA = vSplatA * vSplatA;
  vec3 sB = vSplatB * vSplatB;
  vec3 wNc = normalize(vTerrN);
  // ~1/6u tiling (rock/snow larger so strata & drifts read at scale)
  if (sA.x > 0.002) terrTap(uD0, uN0, tp * 0.166, oa, ob, bf, sA.x, alb, tn, ws);
  if (sA.y > 0.002) terrTap(uD1, uN1, tp * 0.166, oa, ob, bf, sA.y, alb, tn, ws);
  if (sA.z > 0.002) {
    // rock is TRIPLANAR: planar XZ smears to mush on near-vertical faces,
    // side projections keep real strata + cracks on cliffs.
    vec3 bw = pow(abs(wNc), vec3(4.0));
    bw /= (bw.x + bw.y + bw.z);
    float rs = 0.110;
    if (bw.y > 0.01) terrTap(uD2, uN2, tp * rs, oa, ob, bf, sA.z * bw.y, alb, tn, ws);
    if (bw.x > 0.01) {
      float w = sA.z * bw.x;
      vec2 ux = vTerrPos.zy * rs;
      alb += texture2D(uD2, ux).rgb * w;
      vec3 nx = texture2D(uN2, ux).rgb * 2.0 - 1.0;
      g_wdelta += vec3(0.0, nx.y, nx.x * sign(wNc.x)) * w;
      ws += w;
    }
    if (bw.z > 0.01) {
      float w = sA.z * bw.z;
      vec2 uz = vTerrPos.xy * rs;
      alb += texture2D(uD2, uz).rgb * w;
      vec3 nz = texture2D(uN2, uz).rgb * 2.0 - 1.0;
      g_wdelta += vec3(nz.x * sign(wNc.z), nz.y, 0.0) * w;
      ws += w;
    }
  }
  if (sB.x > 0.002) terrTap(uD3, uN3, tp * 0.166, oa, ob, bf, sB.x, alb, tn, ws);
  if (sB.y > 0.002) terrTap(uD4, uN4, tp * 0.125, oa, ob, bf, sB.y, alb, tn, ws);
  if (sB.z > 0.002) terrTap(uD5, uN5, tp * 0.166, oa, ob, bf, sB.z, alb, tn, ws);
  float wk = 1.0 / max(ws, 1e-4);
  alb *= wk;
  tn *= wk;
  g_wdelta *= wk;
  // macro normal breaks up large-scale flatness (1/90u)
  vec3 mac = texture2D(uMacroN, tp * (1.0 / 90.0)).rgb * 2.0 - 1.0;
  tn.xy = tn.xy * 1.35 + mac.xy * 0.55;
  g_tnrm = tn;
  // vertex color kept as a subtle 20% tint (painted AO + macro palette drift)
  vec3 vtint = clamp(vColor.rgb * 2.4, 0.0, 1.5);
  alb *= mix(vec3(1.0), vtint, 0.20);
  // waterline wet band + underwater bed sinking to deep teal (match palette)
  float wet = 1.0 - smoothstep(${(WATER_LEVEL + 0.25).toFixed(2)}, ${(WATER_LEVEL + 1.1).toFixed(2)}, vTerrPos.y);
  alb *= 1.0 - wet * 0.30;
  float uw = 1.0 - smoothstep(${(WATER_LEVEL - 7.0).toFixed(2)}, ${(WATER_LEVEL + 0.4).toFixed(2)}, vTerrPos.y);
  alb = mix(alb, vec3(0.05, 0.13, 0.15), uw);
  diffuseColor.rgb = alb;
}`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `{
  // world-space TBN from the heightfield normal (terrain: tangent ⟂ Z works)
  vec3 wN = normalize(vTerrN);
  vec3 wT = normalize(cross(wN, vec3(0.0, 0.0, 1.0)));
  vec3 wB = cross(wT, wN);
  vec3 tsn = normalize(vec3(g_tnrm.xy, max(g_tnrm.z, 0.30)));
  vec3 wPN = normalize(wT * tsn.x + wB * tsn.y + wN * tsn.z + g_wdelta);
  normal = normalize((viewMatrix * vec4(wPN, 0.0)).xyz);
}`);
    };
    return mat;
  }
  const shellMat = new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  });
  const vegMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
    emissive: new THREE.Color(0.05, 0.30, 0.20), // reads at night in deep forest
  });

  // ---- far shell (built once; ~100-200ms is fine at load) ------------------
  {
    const segs = 224; // sculpted distant mountains, not faceted
    const geo = new THREE.PlaneGeometry(4400, 4400, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    paintTerrainGeometry(geo, 0, 0, segs);
    // Regrade vs near chunks: distance haze makes the shell read chalky, so
    // darken and push saturation so far terrain matches the near palette.
    // Desktop: the textured splat ground is considerably darker and less
    // yellow than the old vertex colors, so the shell drops further to meet
    // it (screenshot-matched against the meadow splat at noon).
    {
      const ca = geo.attributes.color.array;
      const mr = DESKTOP ? 0.55 : 0.86, mg = DESKTOP ? 0.62 : 0.86, mb = DESKTOP ? 0.60 : 0.86;
      const sat = DESKTOP ? 1.22 : 1.15;
      for (let i = 0; i < ca.length; i += 3) {
        const lum = ca[i] * 0.30 + ca[i + 1] * 0.55 + ca[i + 2] * 0.15;
        ca[i] = clamp((lum + (ca[i] - lum) * sat) * mr, 0, 1);
        ca[i + 1] = clamp((lum + (ca[i + 1] - lum) * sat) * mg, 0, 1);
        ca[i + 2] = clamp((lum + (ca[i + 2] - lum) * sat) * mb, 0, 1);
      }
    }
    geo.computeBoundingSphere();
    const shell = new THREE.Mesh(geo, shellMat);
    shell.receiveShadow = true; // free when shadow maps are off
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
    if (DESKTOP) { // 6-way splat weights, packed into two vec3 attributes
      geo.setAttribute('splatA', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      geo.setAttribute('splatB', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    }
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.visible = false;
    // Always on: costs nothing while shadow maps are disabled, and quality
    // settings may enable g.quality.shadows even on flagship mobile.
    mesh.receiveShadow = true;
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
    paintTerrainGeometry(mesh.geometry, mesh.position.x, mesh.position.z, mesh.userData.segs, DESKTOP);
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

  // ---- vegetation: 50 global instanced pools (one draw call each) ----------
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

  // Capacities target a flagship phone (S25-class). Cells are filled
  // nearest-first, so hitting a cap only ever drops the FARTHEST instances.
  // 15 tree archetypes:
  const pine = makePool(buildPineGeom(), vegMat, 340, shadows);
  const fir = makePool(buildFirGeom(), vegMat, 280, shadows);
  const droop = makePool(buildDroopGeom(), vegMat, 220, shadows);
  const spruce = makePool(buildSpruceTallGeom(), vegMat, 170, shadows);
  const crooked = makePool(buildCrookedGeom(), vegMat, 150, shadows);
  const pineSnow = makePool(buildPineSnowGeom(), vegMat, 220, shadows);
  const sapling = makePool(buildSaplingGeom(), vegMat, 180, false);
  const oak = makePool(buildOakGeom(), vegMat, 120, shadows);
  const elm = makePool(buildElmGeom(), vegMat, 80, shadows);
  const gnarly = makePool(buildGnarlyGeom(), vegMat, 60, shadows);
  const birch = makePool(buildBirchGeom(), vegMat, 170, shadows);
  const aspen = makePool(buildAspenGeom(), vegMat, 130, shadows);
  const willow = makePool(buildWillowGeom(), vegMat, 70, shadows);
  const dead = makePool(buildDeadGeom(), vegMat, 90, shadows);
  const snag = makePool(buildSnagGeom(), vegMat, 70, false);
  const TREE_POOLS = [pine, fir, droop, spruce, crooked, pineSnow, sapling,
    oak, elm, gnarly, birch, aspen, willow, dead, snag];
  // 12 undergrowth archetypes:
  const fern = makePool(buildFernGeom(), grassMat, 240, false);
  const fernBig = makePool(buildFernBigGeom(), grassMat, 110, false);
  const bushR = makePool(buildBushRoundGeom(), vegMat, 140, false);
  const bushW = makePool(buildBushWideGeom(), vegMat, 100, false);
  const bramble = makePool(buildBrambleGeom(), vegMat, 100, false);
  const berry = makePool(buildBerryGeom(), vegMat, 90, false);
  const heather = makePool(buildHeatherGeom(), vegMat, 140, false);
  const thicket = makePool(buildThicketGeom(), vegMat, 90, false);
  const shrubDry = makePool(buildShrubDryGeom(), vegMat, 90, false);
  const reeds = makePool(buildReedsGeom(), grassMat, 130, false);
  const mossC = makePool(buildMossClumpGeom(), vegMat, 90, false);
  const deadBush = makePool(buildDeadBushGeom(), vegMat, 70, false);
  const BUSH_POOLS = [fern, fernBig, bushR, bushW, bramble, berry, heather,
    thicket, shrubDry, reeds, mossC, deadBush];
  // 8 flower / mushroom archetypes:
  const flower = makePool(buildFlowerGeom(), grassMat, 160, false);
  const flowerCl = makePool(buildFlowerClusterGeom(), grassMat, 100, false);
  const foxglove = makePool(buildFoxgloveGeom(), grassMat, 90, false);
  const lupine = makePool(buildLupineGeom(), grassMat, 80, false);
  const seedhead = makePool(buildSeedheadGeom(), grassMat, 70, false);
  const mushRed = makePool(buildMushRedGeom(), vegMat, 80, false);
  const mushBrown = makePool(buildMushBrownGeom(), vegMat, 80, false);
  const mushGlow = makePool(buildMushGlowGeom(), glowMat, 70, false);
  const FLORA_POOLS = [flower, flowerCl, foxglove, lupine, seedhead, mushRed, mushBrown, mushGlow];
  // 10 rock archetypes:
  const boulder = makePool(buildBoulderGeom(), vegMat, 160, false);
  const mossB = makePool(buildMossBoulderGeom(), vegMat, 140, false);
  const splitR = makePool(buildSplitRockGeom(), vegMat, 80, false);
  const slabs = makePool(buildSlabStackGeom(), vegMat, 70, false);
  const shard = makePool(buildShardGeom(), vegMat, 90, false);
  const shardCl = makePool(buildShardClusterGeom(), vegMat, 70, false);
  const flatSlab = makePool(buildFlatSlabGeom(), vegMat, 90, false);
  const pebbles = makePool(buildPebblesGeom(), vegMat, 110, false);
  const lichenR = makePool(buildLichenRockGeom(), vegMat, 70, false);
  const cliffCh = makePool(buildCliffChunkGeom(), vegMat, 50, false);
  const ROCK_POOLS = [boulder, mossB, splitR, slabs, shard, shardCl, flatSlab, pebbles, lichenR, cliffCh];
  // 4 debris archetypes:
  const log = makePool(buildLogGeom(), vegMat, 70, false);
  const logMossy = makePool(buildLogMossyGeom(), vegMat, 60, false);
  const stump = makePool(buildStumpGeom(), vegMat, 60, false);
  const rootSnag = makePool(buildRootSnagGeom(), vegMat, 50, false);
  const DEBRIS_POOLS = [log, logMossy, stump, rootSnag];
  // 1 grass pool:
  const grass = makePool(buildGrassGeom(), grassMat, 8000, false);
  const allPools = [...TREE_POOLS, ...BUSH_POOLS, ...FLORA_POOLS, ...ROCK_POOLS, ...DEBRIS_POOLS, grass];
  // = 50 InstancedMeshes total → 50 vegetation draw calls, worst case.
  // Name meshes by category (init-time only; used by debug tooling / QA).
  for (const p of TREE_POOLS) p.mesh.name = 'veg:tree';
  for (const p of BUSH_POOLS) p.mesh.name = 'veg:bush';
  for (const p of FLORA_POOLS) p.mesh.name = 'veg:flora';
  for (const p of ROCK_POOLS) p.mesh.name = 'veg:rock';
  for (const p of DEBRIS_POOLS) p.mesh.name = 'veg:debris';
  grass.mesh.name = 'veg:grass';

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

  // Tilted put (fallen logs hugging slopes etc.) — full euler rotation.
  function putT(pool, x, y, z, rx, ry, rz, sx, sy, cr, cg, cb) {
    if (pool.n >= pool.cap) return;
    _p.set(x, y, z);
    _q.setFromEuler(_e.set(rx, ry, rz));
    _s.set(sx, sy, sx);
    _m.compose(_p, _q, _s);
    pool.mesh.setMatrixAt(pool.n, _m);
    _c.setRGB(cr, cg, cb);
    pool.mesh.setColorAt(pool.n, _c);
    pool.n++;
    if (pool.n > pool.maxWritten) pool.maxWritten = pool.n;
  }

  // -- per-cell scatter functions (fully deterministic via hash2) -----------
  const TREE_CELL = 12;

  function fillTreeCell(cx, cz) {
    // Up to 3 attempts per 12u cell — attempts 2/3 only fire in dense forest.
    for (let k = 0; k < 3; k++) {
      const s0 = 70 + k * 23;
      const wx = (cx + hash2(cx, cz, s0 + 1)) * TREE_CELL;
      const wz = (cz + hash2(cx, cz, s0 + 2)) * TREE_CELL;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 0.8 || h > 104) continue; // shoreline & treeline
      if (insidePOI(wx, wz)) continue;
      const bio = biomeAt(wx, wz, h);
      const r = hash2(cx, cz, s0 + 3);   // species roll
      const hs = hash2(cx, cz, s0 + 4);  // scale roll
      const rot = hash2(cx, cz, s0 + 5) * TAU;
      const hj = hash2(cx, cz, s0 + 6);  // tint / aspect roll
      const r2 = hash2(cx, cz, s0 + 7);  // outlier roll

      // Willows ring Mirrormere: low ground near the lake, any biome.
      const dLake = dist2d(wx, wz, LAKE_X, LAKE_Z);
      if (dLake < 330 && h < WATER_LEVEL + 5.0 && r < (k === 0 ? 0.5 : 0.18)) {
        const s = 0.8 + hs * 0.7;
        put(willow, wx, h - 0.22, wz, rot, s, s * (0.9 + hj * 0.25),
          0.88 + hj * 0.22, 0.92 + hs * 0.16, 0.85 + hj * 0.14);
        continue;
      }
      if (h < WATER_LEVEL + 1.2) continue;

      let density = 0;
      if (bio === BIOME.FOREST) density = k === 0 ? 0.93 : k === 1 ? 0.78 : 0.50;
      else if (k > 0) continue; // sparse biomes: single attempt
      else if (bio === BIOME.MEADOW) density = 0.10;
      else if (bio === BIOME.ROCKY) density = 0.16;
      else if (bio === BIOME.SNOW) density = 0.07;
      else if (bio === BIOME.MARSH) density = 0.15;
      if (density === 0 || hash2(cx, cz, s0 + 8) >= density) continue;
      if (Math.abs(terrainHeight(wx + 2.4, wz + 2.4) - h) > 2.4) continue; // cliff

      // Species clumping noises — same-species grove realism.
      const birchN = snoise(wx * 0.021 + 731.7, wz * 0.021);  // birch/aspen groves
      const conifN = snoise(wx * 0.012 - 311.2, wz * 0.012);  // conifer stands
      const deadF = smoothstep(250, 90, dist2d(wx, wz, RUINS_X, RUINS_Z));

      let pool = pine, kind = 0; // kind: 0 conifer, 1 broadleaf, 2 pale, 3 dead, 4 snow
      const s = 0.7 + hs * 0.9;  // 0.7–1.6× per-instance size
      let sMul = 1;

      if (bio === BIOME.FOREST) {
        if (h > 75) { pool = pineSnow; kind = 4; }
        else if (deadF > 0 && r < deadF * 0.6) { pool = r2 < 0.5 ? dead : snag; kind = 3; }
        else if (birchN > 0.40) { // pale birch/aspen grove
          if (r < 0.55) { pool = birch; kind = 2; }
          else if (r < 0.82) { pool = aspen; kind = 2; }
          else if (r < 0.92) { pool = fir; }
          else { pool = sapling; sMul = 0.8; }
        } else if (r < 0.05) { pool = oak; kind = 1; }
        else if (r < 0.09) { pool = elm; kind = 1; }
        else if (r < 0.20) { pool = sapling; sMul = 0.8; }
        else if (r < 0.29) { pool = crooked; }
        else { // clumped conifer stands
          pool = conifN < -0.22 ? fir : conifN < 0.12 ? pine : conifN < 0.42 ? droop : spruce;
        }
        // snowline transition band 62..75
        if (kind !== 4 && kind !== 3 && h > 62 && r2 < smoothstep(62, 78, h)) { pool = pineSnow; kind = 4; }
      } else if (bio === BIOME.MEADOW) {
        sMul = 1.15; // lone meadow trees read bigger
        if (birchN > 0.5 && r < 0.35) { pool = birch; kind = 2; }
        else if (r < 0.50) { pool = oak; kind = 1; }
        else if (r < 0.70) { pool = elm; kind = 1; }
        else if (r < 0.82) { pool = gnarly; kind = 1; }
        else { pool = pine; }
      } else if (bio === BIOME.ROCKY) {
        if (h > 75) { pool = pineSnow; kind = 4; }
        else if (r < 0.5) { pool = crooked; }
        else if (r < 0.85) { pool = spruce; }
        else { pool = snag; kind = 3; }
      } else if (bio === BIOME.SNOW) {
        pool = pineSnow; kind = 4;
      } else { // MARSH: drowned dead wood + scraggle
        if (r < 0.48) { pool = dead; kind = 3; }
        else if (r < 0.70) { pool = snag; kind = 3; }
        else if (r < 0.88) { pool = willow; kind = 1; }
        else { pool = crooked; }
      }

      // Per-instance color: seasonal shifts, snow dust, muted autumn outliers.
      let cr, cg, cb;
      if (kind === 3) { const t = 0.85 + hj * 0.3; cr = t; cg = t; cb = t; }
      else if (kind === 4) { cr = 0.95 + hj * 0.15; cg = 0.96 + hs * 0.12; cb = 0.98 + hj * 0.10; }
      else if (kind === 2) { // pale-barked: keep tint near 1 so bark stays pale
        if (r2 < 0.18) { cr = 1.22 + hj * 0.15; cg = 0.98; cb = 0.48; }       // muted gold turn
        else { cr = 0.92 + hj * 0.16; cg = 0.94 + hs * 0.12; cb = 0.90 + hj * 0.10; }
      } else if (kind === 1) { // broadleaf: rare ochre/rust autumn outliers
        if (r2 < 0.04) { cr = 1.35 + hj * 0.15; cg = 0.68; cb = 0.40; }        // rust
        else if (r2 < 0.09) { cr = 1.28 + hj * 0.15; cg = 0.92; cb = 0.42; }   // ochre
        else { cr = 0.84 + hj * 0.30; cg = 0.88 + hs * 0.26; cb = 0.78 + hj * 0.20; }
      } else { // conifer: cool seasonal drift + snow dust with altitude
        const dust = smoothstep(64, 88, h);
        cr = lerp(0.82 + hj * 0.30, 1.30, dust);
        cg = lerp(0.86 + hs * 0.26, 1.33, dust);
        cb = lerp(0.78 + hj * 0.20, 1.45, dust);
      }
      const fs = s * sMul;
      put(pool, wx, h - 0.28 * fs, wz, rot, fs, fs * (0.88 + hj * 0.3), cr, cg, cb);
    }
  }

  function fillRockCell(cx, cz) {
    const bio0 = biomeAt((cx + 0.5) * 11, (cz + 0.5) * 11);
    const tries = (bio0 === BIOME.ROCKY || bio0 === BIOME.SNOW) ? 2 : 1;
    for (let k = 0; k < tries; k++) {
      const s0 = 140 + k * 19;
      const wx = (cx + hash2(cx, cz, s0 + 1)) * 11;
      const wz = (cz + hash2(cx, cz, s0 + 2)) * 11;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 0.4) continue;
      if (insidePOI(wx, wz)) continue;
      const bio = biomeAt(wx, wz, h);
      let density = 0.13;
      if (bio === BIOME.ROCKY) density = 0.60;
      else if (bio === BIOME.SNOW) density = 0.50;
      else if (bio === BIOME.FOREST) density = 0.33;
      else if (bio === BIOME.SAND) density = 0.28;
      else if (bio === BIOME.MARSH) density = 0.15;
      if (hash2(cx, cz, s0 + 3) >= density) continue;
      const r = hash2(cx, cz, s0 + 4);
      const hs = hash2(cx, cz, s0 + 5), hj = hash2(cx, cz, s0 + 6);
      const rot = hash2(cx, cz, s0 + 7) * TAU;
      let pool = boulder;
      let s = 0.4 + hs * 1.1;
      let cr = 0.90 + hj * 0.18, cg = 0.90 + hj * 0.18, cb = 0.92 + hs * 0.14; // cold grey
      if (bio === BIOME.ROCKY || bio === BIOME.SNOW) {
        s = 0.7 + hs * 2.0;
        pool = r < 0.20 ? shard : r < 0.36 ? shardCl : r < 0.50 ? cliffCh
          : r < 0.66 ? slabs : r < 0.86 ? boulder : lichenR;
        if (bio === BIOME.SNOW) { cr = 1.02 + hj * 0.1; cg = 1.04 + hj * 0.1; cb = 1.12; }
      } else if (bio === BIOME.FOREST) {
        pool = r < 0.42 ? mossB : r < 0.58 ? boulder : r < 0.72 ? pebbles
          : r < 0.86 ? lichenR : flatSlab;
        cr = 0.80 + hj * 0.18; cg = 0.86 + hs * 0.16; cb = 0.80; // damp, cool
      } else if (bio === BIOME.SAND) {
        pool = r < 0.55 ? pebbles : r < 0.85 ? flatSlab : boulder;
        cr = 1.04; cg = 0.97; cb = 0.84; // sun-bleached
      } else if (bio === BIOME.MARSH) {
        pool = r < 0.6 ? mossB : pebbles;
        cr = 0.78; cg = 0.88; cb = 0.76;
      } else { // meadow
        pool = r < 0.38 ? boulder : r < 0.62 ? flatSlab : r < 0.85 ? pebbles : splitR;
      }
      put(pool, wx, h - 0.16 * s, wz, rot, s, s * (0.8 + hj * 0.5), cr, cg, cb);
    }
  }

  function fillGrassCell(cx, cz) {
    const bx = (cx + 0.5) * 4, bz = (cz + 0.5) * 4;
    const h0 = terrainHeight(bx, bz);
    if (h0 < WATER_LEVEL + 1.0 || h0 > 88) return;
    const bio = biomeAt(bx, bz, h0);
    let tries = 0, density = 0;
    if (bio === BIOME.MEADOW) { tries = 7; density = 0.80; }
    else if (bio === BIOME.FOREST) { tries = 6; density = 0.72; }
    else if (bio === BIOME.MARSH) { tries = 4; density = 0.68; }
    else if (bio === BIOME.SAND) { tries = 1; density = 0.12; }
    else if (bio === BIOME.ROCKY) { tries = 2; density = 0.14; }
    if (!tries) return;
    density *= poiGroundScale(bx, bz); // soft POI clearing (worn centers only)
    if (density <= 0) return;
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
      if (bio === BIOME.MARSH) { sy *= 1.7; cr = 0.72 + hj * 0.18; cg = 0.82 + hs * 0.18; cb = 0.70; } // reeds
      else if (bio === BIOME.FOREST) {
        if (hash2(cx, cz, s0 + 6) < 0.38) { // leaf-litter patches on the forest floor
          cr = 1.02 + hj * 0.30; cg = 0.60 + hs * 0.16; cb = 0.34;
          sy *= 0.55;
        } else { cr = 0.50 + hj * 0.18; cg = 0.62 + hs * 0.18; cb = 0.56; } // deep-shade grass
      } else if (bio === BIOME.SAND) { cr = 1.02 + hj * 0.16; cg = 0.94; cb = 0.68; }  // dune grass
      else if (bio === BIOME.ROCKY) { cr = 0.88 + hj * 0.2; cg = 0.78; cb = 0.58; }    // dry alpine
      else {
        cr = lerp(0.80 + hj * 0.26, 1.16, dry);
        cg = lerp(0.88 + hs * 0.22, 0.94, dry);
        cb = lerp(0.80, 0.55, dry);
      }
      put(grass, wx, h - 0.06, wz, hash2(cx, cz, s0 + 5) * TAU, sx, sy, cr, cg, cb);
    }
  }

  function fillBushCell(cx, cz) {
    const bio0 = biomeAt((cx + 0.5) * 7, (cz + 0.5) * 7);
    const tries = (bio0 === BIOME.FOREST || bio0 === BIOME.MARSH) ? 2 : 1;
    for (let k = 0; k < tries; k++) {
      const s0 = 160 + k * 17;
      const wx = (cx + hash2(cx, cz, s0 + 1)) * 7;
      const wz = (cz + hash2(cx, cz, s0 + 2)) * 7;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 0.9 || h > 78) continue;
      const pm = poiGroundScale(wx, wz); // soft POI clearing
      if (pm <= 0) continue;
      const bio = biomeAt(wx, wz, h);
      let density = 0;
      if (bio === BIOME.FOREST) density = k === 0 ? 0.80 : 0.50;
      else if (bio === BIOME.MEADOW) density = 0.40;
      else if (bio === BIOME.MARSH) density = k === 0 ? 0.70 : 0.40;
      else if (bio === BIOME.ROCKY) density = 0.22;
      else if (bio === BIOME.SAND) density = 0.18;
      density *= pm;
      if (!density || hash2(cx, cz, s0 + 3) >= density) continue;
      const r = hash2(cx, cz, s0 + 4);
      const hs = hash2(cx, cz, s0 + 5), hj = hash2(cx, cz, s0 + 6);
      const rot = hash2(cx, cz, s0 + 7) * TAU;
      const deadF = smoothstep(250, 90, dist2d(wx, wz, RUINS_X, RUINS_Z));
      let pool;
      let cr = 0.84 + hj * 0.28, cg = 0.88 + hs * 0.24, cb = 0.82 + hj * 0.16;
      if (bio === BIOME.FOREST) {
        if (r < deadF * 0.4) pool = r < deadF * 0.2 ? bramble : deadBush;
        else if (r < 0.36) pool = fern;
        else if (r < 0.48) pool = fernBig;
        else if (r < 0.57) pool = bramble;
        else if (r < 0.66) pool = berry;
        else if (r < 0.76) pool = thicket;
        else if (r < 0.88) pool = bushR;
        else pool = mossC;
      } else if (bio === BIOME.MEADOW) {
        const heathN = snoise(wx * 0.03 + 91.4, wz * 0.03); // heather drifts clump
        if (heathN > 0.22) { pool = heather; cr = 0.9 + hj * 0.25; cg = 0.85; cb = 0.9 + hs * 0.2; }
        else if (r < 0.30) pool = bushW;
        else if (r < 0.55) pool = shrubDry;
        else if (r < 0.80) pool = bushR;
        else pool = thicket;
      } else if (bio === BIOME.MARSH) {
        if (r < 0.58) pool = reeds;
        else if (r < 0.74) pool = deadBush;
        else if (r < 0.90) pool = bramble;
        else pool = mossC;
      } else if (bio === BIOME.ROCKY) {
        pool = r < 0.40 ? shrubDry : r < 0.72 ? heather : deadBush;
        cr = 0.9 + hj * 0.2; cg = 0.84; cb = 0.78;
      } else { // sand
        pool = r < 0.5 ? reeds : shrubDry;
        cr = 1.0 + hj * 0.15; cg = 0.94; cb = 0.72;
      }
      const s = 0.7 + hs * 0.9;
      put(pool, wx, h - 0.05, wz, rot, s, s * (0.8 + hj * 0.4), cr, cg, cb);
    }
  }

  function fillFloraCell(cx, cz) {
    const wx = (cx + hash2(cx, cz, 171)) * 6;
    const wz = (cz + hash2(cx, cz, 172)) * 6;
    const h = terrainHeight(wx, wz);
    if (h < WATER_LEVEL + 1.0 || h > 70) return;
    const pm = poiGroundScale(wx, wz); // soft POI clearing
    if (pm <= 0) return;
    const bio = biomeAt(wx, wz, h);
    const r = hash2(cx, cz, 174);
    const hs = hash2(cx, cz, 175), hj = hash2(cx, cz, 177);
    const rot = hash2(cx, cz, 176) * TAU;
    const s = 0.8 + hs * 0.7;

    if (bio === BIOME.FOREST) {
      // Glowing mushrooms: only deep forest around the witch's hollow.
      const dWitch = dist2d(wx, wz, WITCH_X, WITCH_Z);
      if (dWitch < 300) {
        const chance = (0.18 + smoothstep(300, 90, dWitch) * 0.55) * pm;
        if (r < chance) {
          const gt = 0.85 + hj * 0.45; // brightness variety
          put(mushGlow, wx, h - 0.02, wz, rot, s, s, gt * (0.8 + hs * 0.4), gt, gt * (0.9 + hj * 0.3));
          return;
        }
      }
      if (hash2(cx, cz, 173) >= 0.30 * pm) return;
      if (r < 0.32) put(mushRed, wx, h - 0.02, wz, rot, s, s, 0.9 + hj * 0.25, 0.92, 0.9);
      else if (r < 0.60) put(mushBrown, wx, h - 0.02, wz, rot, s, s, 0.85 + hj * 0.3, 0.9 + hs * 0.2, 0.85);
      else if (r < 0.82) put(foxglove, wx, h - 0.02, wz, rot, s, s, 0.85 + hj * 0.35, 0.85, 0.9 + hs * 0.25);
      else put(flowerCl, wx, h - 0.02, wz, rot, s, s, 0.72, 0.60, 0.95); // shade blooms
    } else if (bio === BIOME.MEADOW) {
      if (hash2(cx, cz, 173) >= 0.45 * pm) return;
      const tint = FLOWER_TINTS[(hash2(cx, cz, 178) * FLOWER_TINTS.length) | 0];
      if (r < 0.42) put(flower, wx, h - 0.02, wz, rot, s, s, tint[0], tint[1], tint[2]);
      else if (r < 0.62) put(flowerCl, wx, h - 0.02, wz, rot, s, s, tint[0], tint[1], tint[2]);
      else if (r < 0.77) put(lupine, wx, h - 0.02, wz, rot, s, s, 0.9 + hj * 0.3, 0.9, 1.0 + hs * 0.2);
      else if (r < 0.92) put(seedhead, wx, h - 0.02, wz, rot, s, s, 1.0 + hj * 0.2, 0.95, 0.85);
      else put(foxglove, wx, h - 0.02, wz, rot, s, s, 1.0 + hj * 0.2, 0.9, 1.0);
    } else if (bio === BIOME.MARSH) {
      if (hash2(cx, cz, 173) >= 0.16 * pm) return;
      if (r < 0.55) put(mushBrown, wx, h - 0.02, wz, rot, s, s, 0.8, 0.85, 0.8);
      else put(seedhead, wx, h - 0.02, wz, rot, s, s, 0.85, 0.9, 0.8);
    }
  }

  function fillDebrisCell(cx, cz) {
    const bio0 = biomeAt((cx + 0.5) * 15, (cz + 0.5) * 15);
    const tries = bio0 === BIOME.FOREST ? 2 : 1;
    for (let k = 0; k < tries; k++) {
      const s0 = 190 + k * 13;
      const wx = (cx + hash2(cx, cz, s0 + 1)) * 15;
      const wz = (cz + hash2(cx, cz, s0 + 2)) * 15;
      const h = terrainHeight(wx, wz);
      if (h < WATER_LEVEL + 1.0 || h > 90) continue;
      if (insidePOI(wx, wz)) continue;
      const bio = biomeAt(wx, wz, h);
      let density = 0;
      if (bio === BIOME.FOREST) density = k === 0 ? 0.55 : 0.35;
      else if (bio === BIOME.MEADOW) density = 0.06;
      else if (bio === BIOME.MARSH) density = 0.28;
      if (!density || hash2(cx, cz, s0 + 3) >= density) continue;
      if (Math.abs(terrainHeight(wx + 2, wz + 2) - h) > 1.8) continue; // needs flat-ish ground
      const r = hash2(cx, cz, s0 + 4);
      const hs = hash2(cx, cz, s0 + 5), hj = hash2(cx, cz, s0 + 6);
      const rot = hash2(cx, cz, s0 + 7) * TAU;
      const s = 0.8 + hs * 0.7;
      const cr = 0.85 + hj * 0.3, cg = 0.88 + hs * 0.24, cb = 0.85 + hj * 0.2;
      let pool;
      if (bio === BIOME.MARSH) pool = r < 0.45 ? rootSnag : r < 0.8 ? logMossy : stump;
      else if (r < 0.30) pool = log;
      else if (r < 0.55) pool = logMossy;
      else if (r < 0.80) pool = stump;
      else pool = rootSnag;
      if (pool === log || pool === logMossy) {
        // lie with a slight deterministic tilt so logs hug uneven ground
        putT(pool, wx, h - 0.05, wz, (hj - 0.5) * 0.18, rot, (hs - 0.5) * 0.14, s, s, cr, cg, cb);
      } else {
        put(pool, wx, h - 0.06, wz, rot, s, s * (0.85 + hj * 0.3), cr, cg, cb);
      }
    }
  }

  // Scan phases: [cellSize(u), nearest-first offsets, fill fn, pools touched]
  const PHASES = [
    { cell: TREE_CELL, offsets: ringOffsets(22), fn: fillTreeCell, pools: TREE_POOLS }, // trees ≤ ~264u
    { cell: 11, offsets: ringOffsets(17), fn: fillRockCell, pools: ROCK_POOLS },        // rocks ≤ ~187u
    { cell: 4, offsets: ringOffsets(20), fn: fillGrassCell, pools: [grass] },           // grass ≤ 80u
    { cell: 7, offsets: ringOffsets(16), fn: fillBushCell, pools: BUSH_POOLS },         // undergrowth ≤ ~112u
    { cell: 6, offsets: ringOffsets(15), fn: fillFloraCell, pools: FLORA_POOLS },       // flowers/mush ≤ 90u
    { cell: 15, offsets: ringOffsets(11), fn: fillDebrisCell, pools: DEBRIS_POOLS },    // debris ≤ ~165u
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
    pool.mesh.count = pool.n; // draw only live instances
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
        if ((oi & 7) === 7 && performance.now() - t0 > budgetMs) return;
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
      uDay: { value: 1 },
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

  // ---- EPIC WAVE: mega-peak ring beyond the map (1 draw call, built once) --
  const megaMat = new THREE.ShaderMaterial({
    uniforms: {
      uHaze: { value: new THREE.Color(0.72, 0.82, 0.92) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uLightCol: { value: new THREE.Color(1, 0.9, 0.7) },
      uDay: { value: 1 },
      uGolden: { value: 0 },
    },
    vertexShader: MEGA_VERT,
    fragmentShader: MEGA_FRAG,
    fog: false, // haze is baked toward uHaze — scene fog would erase them
  });
  const megaRing = new THREE.Mesh(buildMegaPeakGeometry(), megaMat);
  megaRing.renderOrder = 2;     // after the sky dome (renderOrder 1, no depth write)
  megaRing.frustumCulled = false; // surrounds the whole world
  megaRing.matrixAutoUpdate = false;
  megaRing.name = 'megaPeaks';
  scene.add(megaRing);
  const uM = megaMat.uniforms;
  let megaBound = false; // lazily bind shared sky color/vector instances

  // ---- EPIC WAVE: dawn valley fog banks (2 draw calls, dawn window only) ---
  const fogMatA = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const fogMatB = fogMatA.clone();
  const fogLayerA = new THREE.Mesh(buildFogBankGeometry(false), fogMatA);
  const fogLayerB = new THREE.Mesh(buildFogBankGeometry(true), fogMatB);
  for (const m of [fogLayerA, fogLayerB]) {
    m.renderOrder = 2; // after the (depthWrite:false) water plane
    m.visible = false;
    m.name = 'dawnFog';
    scene.add(m);
  }

  // ---- EPIC WAVE: forest god-rays (≤1 visible mesh, shared material) -------
  const rayMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  const raysMorning = new THREE.Mesh(buildGodRayGeometry(sunAxisAt(0.30)), rayMat);
  const raysEvening = new THREE.Mesh(buildGodRayGeometry(sunAxisAt(0.71)), rayMat);
  for (const m of [raysMorning, raysEvening]) {
    m.renderOrder = 3;
    m.visible = false;
    m.matrixAutoUpdate = false;
    m.name = 'godRays';
    scene.add(m);
  }

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
    if (vegJob.active) processVegJob(1.5);

    // Water: advance time (rawDt so waves idle through hitstop/menus),
    // follow player snapped to 8u (wave phase is world-space → seamless).
    uW.uTime.value += (g.time && g.time.rawDt) || dt;
    water.position.x = Math.round(pp.x / 8) * 8;
    water.position.z = Math.round(pp.z / 8) * 8;
    const sky = g.sky; // lazy — sky may not exist during early frames
    if (sky) {
      if (sky.sunDir) {
        uW.uSunDir.value.copy(sky.sunDir);
        uW.uDay.value = clamp(sky.sunDir.y * 2.4, 0, 1); // night → indigo water
      }
      if (sky.horizonColor) uW.uHorizon.value.copy(sky.horizonColor);
    }

    // ---- EPIC WAVE per-frame drive ----------------------------------------
    // Mega peaks: bind the sky's live color/vector instances once, then only
    // cheap scalars per frame (haze + sun direction update themselves).
    if (sky && sky.sunDir) {
      if (!megaBound) {
        uM.uHaze.value = sky.horizonColor;
        uM.uSunDir.value = sky.sunDir;
        if (sky.sunLight) uM.uLightCol.value = sky.sunLight.color;
        megaBound = true;
      }
      const el = sky.sunDir.y;
      uM.uDay.value = clamp(el * 2.4, 0, 1);
      uM.uGolden.value = clamp(1 - Math.abs(el) / 0.32, 0, 1) * smoothstep(-0.02, 0.06, el);
    }

    const f = g.time ? g.time.dayFrac : 0.3;
    const t = g.time ? g.time.elapsed : 0;

    // Dawn valley fog: 0.18 < dayFrac < 0.34, drifting slowly, breathing.
    const fogVis = smoothstep(0.18, 0.215, f) * (1 - smoothstep(0.30, 0.34, f));
    if (fogVis > 0.004) {
      fogLayerA.visible = fogLayerB.visible = true;
      fogLayerA.position.set(Math.sin(t * 0.021) * 26, 0, Math.cos(t * 0.017) * 18);
      fogLayerB.position.set(Math.sin(-t * 0.016 + 2.1) * 30, 0, Math.sin(t * 0.019 + 0.7) * 22);
      fogMatA.opacity = fogVis * (0.50 + 0.10 * Math.sin(t * 0.11));
      fogMatB.opacity = fogVis * (0.40 + 0.10 * Math.sin(t * 0.13 + 1.7));
      if (sky && sky.horizonColor) { // pale rose-grey, tinted by the dawn sky
        fogMatA.color.copy(sky.horizonColor).lerp(_white, 0.55);
        fogMatB.color.copy(fogMatA.color);
      }
    } else {
      fogLayerA.visible = fogLayerB.visible = false;
    }

    // Forest god-rays: golden-hour windows, gently swaying opacity.
    const mVis = smoothstep(0.24, 0.27, f) * (1 - smoothstep(0.33, 0.36, f));
    const eVis = smoothstep(0.64, 0.675, f) * (1 - smoothstep(0.745, 0.78, f));
    raysMorning.visible = mVis > 0.004;
    raysEvening.visible = eVis > 0.004;
    if (raysMorning.visible || raysEvening.visible) {
      rayMat.opacity = (mVis + eVis) * (0.22 + 0.06 * Math.sin(t * 0.31));
    }
  }

  return { update };
}

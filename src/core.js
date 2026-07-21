// ============================================================================
// ELDERFALL — core.js
// Single source of truth: seeded RNG, noise, terrain height, biomes, POIs,
// event bus, math helpers. Every other module imports from here.
// This file has NO dependencies (not even three.js). Keep it that way.
// ============================================================================

export const WORLD_SEED = 1337;
export const WATER_LEVEL = -3.0;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const dist2d = (x1, z1, x2, z2) => Math.hypot(x1 - x2, z1 - z2);

// Deterministic hash → [0,1)
export function hash2(x, y, seed = WORLD_SEED) {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967296;
}

// Mulberry32 seeded RNG factory
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Simplex noise 2D (Gustavson-style), seeded, deterministic
// ---------------------------------------------------------------------------
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const perm = new Uint8Array(512);
{
  const rng = makeRng(WORLD_SEED);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

export function snoise(xin, yin) {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    const g = grad2[perm[ii + perm[jj]] & 7];
    t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    const g = grad2[perm[ii + i1 + perm[jj + j1]] & 7];
    t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    const g = grad2[perm[ii + 1 + perm[jj + 1]] & 7];
    t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
  }
  return 70 * (n0 + n1 + n2); // ~[-1, 1]
}

// Fractal brownian motion. Returns roughly [-1, 1].
export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * snoise(x * freq + o * 17.13, y * freq - o * 31.7);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged noise for mountains. Returns [0, 1].
export function ridged(x, y, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(snoise(x * freq + 100 + o * 7.7, y * freq - 100 - o * 3.3));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5; freq *= 2.05;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Points of interest (fixed, seeded world). x/z world units. r = radius.
// 'flatten' blends terrain toward flatH inside radius for buildable ground.
// ---------------------------------------------------------------------------
export const POIS = [
  { id: 'village', name: 'Emberhollow',       x: 0,    z: 0,     r: 85,  flatten: 1.0,  flatH: 8 },
  { id: 'ruins',   name: 'Barrowdeep Ruins',  x: 620,  z: -420,  r: 55,  flatten: 0.9 },
  { id: 'stones',  name: 'The Wardstones',    x: -540, z: -620,  r: 42,  flatten: 0.9 },
  { id: 'tower',   name: 'Greywatch Tower',   x: 380,  z: 520,   r: 34,  flatten: 0.9 },
  { id: 'camp',    name: 'Redfang Camp',      x: -620, z: 180,   r: 46,  flatten: 0.85, flatH: 6 },
  { id: 'lake',    name: 'Mirrormere',        x: -350, z: 520,   r: 0 },
  { id: 'shrine',  name: 'Shrine of Aldric',  x: 260,  z: -180,  r: 16,  flatten: 0.9, flatH: 5 },
  { id: 'peak',    name: 'Drakespire',        x: 150,  z: -1250, r: 60,  flatten: 0.75 },
  // Terrain-only flatten patches (no discovery entry semantics beyond POIS use):
  // seat the witch hut on level ground; lift Redfang's flooded west flank.
  { id: 'witchhut', name: 'The Crone\'s Hollow', x: -260, z: -520, r: 20, flatten: 0.9, flatH: 4.5 },
  { id: 'campwest', name: 'Redfang West',       x: -680, z: 195,  r: 30, flatten: 0.8, flatH: 5 },
];
export const POI = Object.fromEntries(POIS.map(p => [p.id, p]));

// Raw terrain before POI flattening
function rawHeight(x, z) {
  // Broad continent rolls
  let h = fbm(x * 0.0011, z * 0.0011, 4) * 42;
  // Medium hills + fine detail
  h += fbm(x * 0.0045 + 53.7, z * 0.0045, 3) * 9;
  h += fbm(x * 0.02 + 11.1, z * 0.02, 2) * 1.6;

  // Northern mountain range (negative z), ridged
  const northness = smoothstep(-450, -1050, z);
  if (northness > 0) {
    h += ridged(x * 0.0016, z * 0.0016, 4) * 240 * northness + 38 * northness;
  }

  // Drakespire: the anchor peak, a huge gaussian bump at the POI
  {
    const d = dist2d(x, z, 150, -1250);
    h += 375 * Math.exp(-(d * d) / (2 * 340 * 340));
  }

  // Mirrormere lake basin
  {
    const d = dist2d(x, z, -350, 520);
    h -= smoothstep(300, 70, d) * 30;
  }

  // Gentle valley opening south/east so village area reads as lowlands
  h -= smoothstep(-200, 600, z) * 4;
  return h;
}

// Cache POI center heights (computed from rawHeight to avoid recursion)
for (const p of POIS) {
  if (p.flatten) p._h = p.flatH !== undefined ? p.flatH : rawHeight(p.x, p.z);
}

// THE terrain height function. Everything (rendering, physics, placement,
// AI) must use this so the world is perfectly consistent.
export function terrainHeight(x, z) {
  let h = rawHeight(x, z);
  for (const p of POIS) {
    if (!p.flatten) continue;
    const d = dist2d(x, z, p.x, p.z);
    if (d > p.r * 2.4) continue;
    const m = smoothstep(p.r * 2.4, p.r * 0.55, d) * p.flatten;
    h = lerp(h, p._h, m);
  }
  return h;
}

// Terrain normal via central differences (eps world units)
export function terrainNormal(x, z, eps = 1.0, out = null) {
  const hL = terrainHeight(x - eps, z), hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps), hU = terrainHeight(x, z + eps);
  const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz);
  if (out) { out.x = nx / len; out.y = ny / len; out.z = nz / len; return out; }
  return { x: nx / len, y: ny / len, z: nz / len };
}

// ---------------------------------------------------------------------------
// Biomes
// 0 meadow | 1 forest | 2 rocky | 3 snow | 4 shore sand | 5 marsh
// ---------------------------------------------------------------------------
export const BIOME = { MEADOW: 0, FOREST: 1, ROCKY: 2, SNOW: 3, SAND: 4, MARSH: 5 };

export function biomeAt(x, z, h = null) {
  if (h === null) h = terrainHeight(x, z);
  if (h > 96) return BIOME.SNOW;
  if (h > 58) return BIOME.ROCKY;
  if (h < WATER_LEVEL + 2.2) {
    return fbm(x * 0.01 + 400, z * 0.01, 2) > 0.15 ? BIOME.MARSH : BIOME.SAND;
  }
  // Forest mask; darker/denser near Barrowdeep Ruins
  let f = fbm(x * 0.0021 + 219.4, z * 0.0021 - 77.2, 3);
  const dRuins = dist2d(x, z, POI.ruins.x, POI.ruins.z);
  f += smoothstep(420, 120, dRuins) * 0.45;
  const dVillage = dist2d(x, z, 0, 0);
  f -= smoothstep(190, 70, dVillage) * 0.6; // keep village clearing open
  if (f > 0.16) return BIOME.FOREST;
  return BIOME.MEADOW;
}

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------
export function makeEvents() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(fn);
      return () => {
        const arr = map.get(name);
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    emit(name, data) {
      const arr = map.get(name);
      if (arr) for (const fn of arr.slice()) fn(data);
    },
  };
}

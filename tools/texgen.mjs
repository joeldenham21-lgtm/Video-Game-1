#!/usr/bin/env node
// ELDERFALL — procedural terrain texture generator (wave 6, TEXGEN agent).
// Generates six seamless 1024x1024 photo-grade material sets (albedo + tangent
// normal) plus shared macro_n.jpg and noise.jpg into assets/terrain/.
// All noise is sampled toroidally so every output tiles perfectly.
// Usage:  node tools/texgen.mjs [grass forest rock dirt snow sand shared] [--mdir <dir>]
//         (no set names = generate everything)

import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'terrain');
const S = 1024; // texture size
const args = process.argv.slice(2);
let MDIR = null;
const sets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mdir') { MDIR = args[++i]; continue; }
  sets.push(args[i]);
}

// ---------------------------------------------------------------- noise core
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Periodic (toroidal) value noise. x,y are lattice-space coords; px,py periods.
function vnoise(x, y, px, py, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// fbm over unit square (u,v in [0,1)), integer base freq -> seamless.
function fbm(u, v, freq, oct, gain, seed) {
  let a = 0.5, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise(u * f, v * f, f, f, seed + o * 131);
    norm += a; a *= gain; f *= 2;
  }
  return sum / norm;
}

// Anisotropic fbm — independent x/y base frequencies (stretched noise).
function afbm(u, v, fx, fy, oct, gain, seed) {
  let a = 0.5, cfx = fx, cfy = fy, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * vnoise(u * cfx, v * cfy, cfx, cfy, seed + o * 131);
    norm += a; a *= gain; cfx *= 2; cfy *= 2;
  }
  return sum / norm;
}

// Ridged fbm (sharp crests) — for rock strata / crack veins.
function rfbm(u, v, freq, oct, gain, seed) {
  let a = 0.5, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = vnoise(u * f, v * f, f, f, seed + o * 131);
    const r = 1 - Math.abs(2 * n - 1);
    sum += a * r * r;
    norm += a; a *= gain; f *= 2;
  }
  return sum / norm;
}

// Domain warp — offsets are themselves toroidal, so seamlessness is preserved.
function warp(u, v, amp, freq, oct, seed) {
  return [
    u + amp * (fbm(u, v, freq, oct, 0.5, seed) - 0.5),
    v + amp * (fbm(u, v, freq, oct, 0.5, seed + 7717) - 0.5),
  ];
}

// ------------------------------------------------------------- buffer helpers
const wrap = (a) => ((a % S) + S) % S;
const pidx = (x, y) => wrap(y) * S + wrap(x);

function newAlbedo() { return new Float32Array(S * S * 3); }
function newHeight() { return new Float32Array(S * S); }

function fillAlbedo(alb, fn) {
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const c = fn(u, v, x, y);
      const i = (y * S + x) * 3;
      alb[i] = c[0]; alb[i + 1] = c[1]; alb[i + 2] = c[2];
    }
  }
}
function fillHeight(hgt, fn) {
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) hgt[y * S + x] = fn(x / S, v, x, y);
  }
}

// Soft round color splat with toroidal wrap.
function splatColor(alb, cx, cy, r, col, alpha, hard = 0.55) {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d > 1) continue;
      const a = alpha * Math.min(1, (1 - d) / (1 - hard + 1e-6));
      const i = pidx(Math.round(cx) + dx, Math.round(cy) + dy) * 3;
      alb[i] += (col[0] - alb[i]) * a;
      alb[i + 1] += (col[1] - alb[i + 1]) * a;
      alb[i + 2] += (col[2] - alb[i + 2]) * a;
    }
  }
}
function splatHeight(hgt, cx, cy, r, amp, hard = 0.4) {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d > 1) continue;
      const a = Math.min(1, (1 - d) / (1 - hard + 1e-6));
      hgt[pidx(Math.round(cx) + dx, Math.round(cy) + dy)] += amp * a * a;
    }
  }
}

// Rotated soft ellipse (leaves). Gradient along the major axis + faint midrib.
function splatLeaf(alb, hgt, cx, cy, la, lb, ang, colA, colB, alpha, hamp) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const R = Math.ceil(Math.max(la, lb));
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
      const d = (lx * lx) / (la * la) + (ly * ly) / (lb * lb);
      if (d > 1) continue;
      const edge = Math.min(1, (1 - d) * 4);
      const t = lx / la * 0.5 + 0.5;
      const rib = Math.max(0, 1 - Math.abs(ly) / (lb * 0.16)) * 0.4;
      const i = pidx(Math.round(cx) + dx, Math.round(cy) + dy) * 3;
      const a = alpha * edge;
      for (let c = 0; c < 3; c++) {
        const col = colA[c] + (colB[c] - colA[c]) * t + rib * 14;
        alb[i + c] += (col - alb[i + c]) * a;
      }
      const hi = pidx(Math.round(cx) + dx, Math.round(cy) + dy);
      hgt[hi] = Math.max(hgt[hi], hamp * edge);
    }
  }
}

// Thin AA stroke (grass blades, twigs) — bilinear stamping along a walk.
function stroke(alb, hgt, x0, y0, ang, len, curve, wid, col0, col1, alpha, hamp) {
  const steps = Math.max(2, Math.round(len));
  let x = x0, y = y0, a = ang;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    x += Math.cos(a); y += Math.sin(a); a += curve;
    const fade = alpha * (0.55 + 0.45 * t);
    const r = wid * (1 - 0.35 * t);
    const cr = col0[0] + (col1[0] - col0[0]) * t;
    const cg = col0[1] + (col1[1] - col0[1]) * t;
    const cb = col0[2] + (col1[2] - col0[2]) * t;
    const R = Math.ceil(r);
    const bx = Math.floor(x), by = Math.floor(y);
    for (let dy = -R; dy <= R + 1; dy++) {
      for (let dx = -R; dx <= R + 1; dx++) {
        const px = bx + dx, py = by + dy;
        const dd = Math.hypot(px - x, py - y) / (r + 0.5);
        if (dd > 1) continue;
        const w = fade * (1 - dd * dd);
        const i = pidx(px, py) * 3;
        alb[i] += (cr - alb[i]) * w;
        alb[i + 1] += (cg - alb[i + 1]) * w;
        alb[i + 2] += (cb - alb[i + 2]) * w;
        if (hamp) {
          const hi = pidx(px, py);
          const hv = hamp * (1 - dd * dd) * (0.4 + 0.6 * Math.sin(t * Math.PI));
          if (hv > hgt[hi]) hgt[hi] = hgt[hi] * 0.35 + hv * 0.65;
        }
      }
    }
  }
}

// --------------------------------------------------------- normals + writing
function heightToNormal(hgt, strength) {
  const out = new Uint8Array(S * S * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const tl = hgt[pidx(x - 1, y - 1)], t = hgt[pidx(x, y - 1)], tr = hgt[pidx(x + 1, y - 1)];
      const l = hgt[pidx(x - 1, y)], r = hgt[pidx(x + 1, y)];
      const bl = hgt[pidx(x - 1, y + 1)], b = hgt[pidx(x, y + 1)], br = hgt[pidx(x + 1, y + 1)];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -gx * strength, ny = gy * strength, nz = 1; // OpenGL green-up
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * S + x) * 3;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

function albToBytes(alb) {
  const out = new Uint8Array(alb.length);
  for (let i = 0; i < alb.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(alb[i])));
  return out;
}

async function saveJpg(bytes, size, file, q, subsample) {
  await sharp(Buffer.from(bytes), { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: q, chromaSubsampling: subsample, mozjpeg: true })
    .toFile(path.join(OUT, file));
}

async function montage(file, tag) {
  if (!MDIR) return;
  fs.mkdirSync(MDIR, { recursive: true });
  const src = path.join(OUT, file);
  const buf = await sharp(src).toBuffer();
  const comp = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) comp.push({ input: buf, left: x * S, top: y * S });
  await sharp({ create: { width: S * 3, height: S * 3, channels: 3, background: '#000' } })
    .composite(comp).jpeg({ quality: 88 }).toFile(path.join(MDIR, `${tag}_3x3.jpg`))
    .then(() => sharp(path.join(MDIR, `${tag}_3x3.jpg`)).resize(1152, 1152).jpeg({ quality: 88 })
      .toFile(path.join(MDIR, `${tag}_3x3_small.jpg`)));
  await sharp(src).extract({ left: 256, top: 256, width: 640, height: 640 })
    .jpeg({ quality: 90 }).toFile(path.join(MDIR, `${tag}_crop.jpg`));
}

async function emitSet(name, alb, hgt, nStrength, q = 82) {
  await saveJpg(albToBytes(alb), S, `${name}_d.jpg`, q, '4:2:0');
  await saveJpg(heightToNormal(hgt, nStrength), S, `${name}_n.jpg`, Math.max(78, q - 2), '4:4:4');
  await montage(`${name}_d.jpg`, name);
  console.log(`  wrote ${name}_d.jpg / ${name}_n.jpg`);
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
let RSEED = 1;
function rnd() { RSEED = (Math.imul(RSEED, 1664525) + 1013904223) | 0; return (RSEED >>> 0) / 4294967296; }

// ================================================================== GRASS
async function genGrass() {
  console.log('grass...');
  RSEED = 1337;
  const alb = newAlbedo(), hgt = newHeight();

  // Base: dark soil + moss shadow between blade clumps.
  const soilA = [43, 36, 24], soilB = [58, 50, 32], mossB = [52, 58, 33];
  fillAlbedo(alb, (u, v) => {
    const g = fbm(u, v, 90, 3, 0.55, 11);          // fine grain
    const p = fbm(u, v, 5, 4, 0.5, 23);            // patchiness
    let c = mix3(soilA, soilB, g);
    c = mix3(c, mossB, sstep(0.45, 0.75, p) * 0.6);
    return c;
  });
  fillHeight(hgt, (u, v) => fbm(u, v, 7, 4, 0.5, 31) * 0.55);

  // Blade hue families — olive / moss / dark sage (muted, no candy green).
  const hues = [
    [[74, 88, 42], [104, 118, 58]],   // olive
    [[62, 80, 44], [88, 106, 60]],    // moss green
    [[84, 92, 50], [117, 122, 66]],   // dry sage
  ];
  const straw = [[118, 104, 62], [150, 133, 80]];

  const NB = 175000;
  for (let n = 0; n < NB; n++) {
    const x = rnd() * S, y = rnd() * S;
    const u = x / S, v = y / S;
    // Direction field: smooth per-patch rotation (toroidal fbm -> seamless).
    const baseAng = (fbm(u, v, 4, 3, 0.5, 71) - 0.5) * 7.5 + (rnd() - 0.5) * 0.8;
    const hueSel = fbm(u, v, 6, 3, 0.5, 87) + (rnd() - 0.5) * 0.35;
    const isStraw = rnd() < 0.08;
    const fam = isStraw ? straw : hues[hueSel < 0.42 ? 0 : hueSel < 0.58 ? 1 : 2];
    const bright = 0.72 + rnd() * 0.5;
    const c0 = fam[0].map((c) => c * bright), c1 = fam[1].map((c) => c * bright);
    const len = 7 + rnd() * 12;
    stroke(alb, hgt, x, y, baseAng, len, (rnd() - 0.5) * 0.16, 0.75 + rnd() * 0.45,
      c0, c1, 0.5 + rnd() * 0.3, 0.5 + rnd() * 0.5);
  }

  // Clover dots — small round dark-green clusters.
  for (let n = 0; n < 260; n++) {
    const cx = rnd() * S, cy = rnd() * S;
    const k = 2 + Math.floor(rnd() * 4);
    for (let j = 0; j < k; j++) {
      const col = [58 + rnd() * 14, 76 + rnd() * 14, 44 + rnd() * 8];
      splatColor(alb, cx + (rnd() - 0.5) * 9, cy + (rnd() - 0.5) * 9, 1.6 + rnd() * 1.3, col, 0.55, 0.4);
    }
  }

  // Macro tonal patches to break up uniformity (kept subtle).
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const m = fbm(u, v, 3, 3, 0.5, 301);
      const k = 0.82 + 0.36 * m;
      const i = (y * S + x) * 3;
      alb[i] *= k; alb[i + 1] *= k; alb[i + 2] *= k * 0.98;
    }
  }
  await emitSet('grass', alb, hgt, 2.4);
}

// ================================================================== FOREST
async function genForest() {
  console.log('forest...');
  RSEED = 4242;
  const alb = newAlbedo(), hgt = newHeight();

  // Humus base.
  const humA = [40, 31, 21], humB = [60, 47, 32];
  fillAlbedo(alb, (u, v) => {
    const g = fbm(u, v, 80, 3, 0.55, 5);
    const p = fbm(u, v, 6, 4, 0.5, 17);
    return mix3(mix3(humA, humB, g), [48, 40, 26], p * 0.5);
  });
  fillHeight(hgt, (u, v) => fbm(u, v, 9, 4, 0.5, 29) * 0.3);

  // Moss patches (dark, slightly green, fine bump).
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const [wu, wv] = warp(u, v, 0.08, 3, 3, 401);
      const m = sstep(0.56, 0.72, fbm(wu, wv, 4, 4, 0.5, 51));
      if (m <= 0) continue;
      const fine = fbm(u, v, 120, 2, 0.5, 61);
      const i = (y * S + x) * 3;
      const mc = [40 + fine * 26, 52 + fine * 30, 28 + fine * 14];
      alb[i] += (mc[0] - alb[i]) * m;
      alb[i + 1] += (mc[1] - alb[i + 1]) * m;
      alb[i + 2] += (mc[2] - alb[i + 2]) * m;
      hgt[y * S + x] += m * (0.25 + fine * 0.3);
    }
  }

  // Leaf litter — overlapping soft ovals, umber/sienna/faded olive.
  const leafCols = [
    [[92, 66, 40], [128, 94, 56]],   // umber
    [[110, 72, 42], [148, 100, 58]], // sienna
    [[70, 55, 34], [100, 80, 48]],   // dark brown
    [[86, 78, 44], [112, 102, 58]],  // faded olive
    [[58, 44, 30], [84, 66, 42]],    // wet rot
  ];
  const NL = 3100;
  for (let n = 0; n < NL; n++) {
    const fam = leafCols[Math.floor(rnd() * leafCols.length)];
    const s = 0.75 + rnd() * 0.8;
    const bright = 0.75 + rnd() * 0.5;
    splatLeaf(alb, hgt, rnd() * S, rnd() * S, (7 + rnd() * 7) * s, (4 + rnd() * 4) * s,
      rnd() * Math.PI * 2, fam[0].map((c) => c * bright), fam[1].map((c) => c * bright),
      0.62 + rnd() * 0.3, 0.55 + rnd() * 0.5);
  }

  // Twigs — thin brighter streaks with a height ridge.
  for (let n = 0; n < 170; n++) {
    const b = 0.8 + rnd() * 0.5;
    stroke(alb, hgt, rnd() * S, rnd() * S, rnd() * Math.PI * 2, 26 + rnd() * 55,
      (rnd() - 0.5) * 0.03, 0.9 + rnd() * 0.5,
      [112 * b, 94 * b, 62 * b], [134 * b, 112 * b, 74 * b], 0.75, 0.9);
  }

  // Pebbles.
  for (let n = 0; n < 130; n++) {
    const r = 1.6 + rnd() * 2.6, g = 96 + rnd() * 40;
    const cx = rnd() * S, cy = rnd() * S;
    splatColor(alb, cx, cy, r, [g, g * 0.96, g * 0.88], 0.8, 0.45);
    splatHeight(hgt, cx, cy, r, 0.65, 0.35);
  }

  // Macro tone.
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const m = fbm(x / S, v, 3, 3, 0.5, 501);
      const k = 0.84 + 0.32 * m;
      const i = (y * S + x) * 3;
      alb[i] *= k; alb[i + 1] *= k; alb[i + 2] *= k;
    }
  }
  await emitSet('forest', alb, hgt, 2.6);
}

// ================================================================== ROCK
async function genRock() {
  console.log('rock...');
  RSEED = 9001;
  const alb = newAlbedo(), hgt = newHeight();

  fillHeight(hgt, (u, v) => {
    const [wu, wv] = warp(u, v, 0.18, 3, 3, 601);
    // Strata: ridged, stretched horizontally, warped.
    const strata = rfbm(wu * 0.5 + 10, wv, 6, 4, 0.55, 613);
    const chunk = fbm(wu, wv, 4, 4, 0.5, 617);
    const fine = fbm(u, v, 60, 3, 0.5, 619);
    let h = strata * 0.6 + chunk * 0.5 + fine * 0.18;
    // Crack veins: inverted ridged noise, carved deep.
    const [cu, cv] = warp(u, v, 0.1, 4, 3, 631);
    const cr = rfbm(cu, cv, 5, 3, 0.6, 641);
    const vein = sstep(0.82, 0.97, cr);
    h -= vein * 0.55;
    return h;
  });

  // Albedo from height + hue variation + lichen.
  const cool = [96, 97, 102], warm = [118, 112, 102], dark = [52, 52, 56];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const h = hgt[y * S + x];
      const hue = fbm(u, v, 3, 3, 0.5, 651);
      const g = fbm(u, v, 110, 3, 0.5, 653);
      let c = mix3(cool, warm, hue);
      c = mix3(dark, c, clamp01(h * 0.85 + 0.18));           // recesses dark
      const k = 0.82 + g * 0.4;                              // granular sparkle
      c = [c[0] * k, c[1] * k, c[2] * k];
      // Lichen speckle: clustered grey-green flecks ~4%.
      const lm = fbm(u, v, 5, 3, 0.5, 661);
      const spec = vnoise(u * 256, v * 256, 256, 256, 667);
      if (lm > 0.58 && spec > 0.86) {
        const t = (spec - 0.86) / 0.14;
        c = mix3(c, [104, 112, 82], 0.5 + t * 0.4);
      }
      const i = (y * S + x) * 3;
      alb[i] = c[0]; alb[i + 1] = c[1]; alb[i + 2] = c[2];
    }
  }
  await emitSet('rock', alb, hgt, 5.0);
}

// ================================================================== DIRT
async function genDirt() {
  console.log('dirt...');
  RSEED = 777;
  const alb = newAlbedo(), hgt = newHeight();

  fillHeight(hgt, (u, v) => {
    const grain = fbm(u, v, 70, 4, 0.55, 701);
    // Wheel-rut smoothing: stretched along x (travel axis).
    const rut = afbm(u, v, 2, 9, 3, 0.5, 703);
    const rough = fbm(u, v, 12, 3, 0.5, 707);
    return grain * 0.35 + rough * 0.3 + (1 - Math.abs(rut - 0.5) * 2) * -0.25;
  });

  const dry = [104, 86, 62], mid = [86, 70, 50], wet = [58, 47, 34];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const g = fbm(u, v, 90, 3, 0.5, 711);
      const moist = fbm(u, v, 4, 4, 0.5, 713);
      const band = afbm(u, v, 2, 8, 2, 0.5, 703); // echo the ruts in tone
      let c = mix3(mid, dry, g);
      c = mix3(c, wet, sstep(0.5, 0.78, moist) * 0.7);
      c = mix3(c, wet, sstep(0.55, 0.8, band) * 0.35);
      const i = (y * S + x) * 3;
      alb[i] = c[0]; alb[i + 1] = c[1]; alb[i + 2] = c[2];
    }
  }

  // Embedded pebbles: rounded bumps, slightly grey.
  for (let n = 0; n < 420; n++) {
    const r = 1.4 + rnd() * 3.4;
    const cx = rnd() * S, cy = rnd() * S;
    const b = 0.75 + rnd() * 0.5;
    splatColor(alb, cx, cy, r, [98 * b, 90 * b, 78 * b], 0.8, 0.5);
    splatHeight(hgt, cx, cy, r, 0.5 + rnd() * 0.4, 0.3);
  }
  // Tiny gravel.
  for (let n = 0; n < 2400; n++) {
    const cx = rnd() * S, cy = rnd() * S;
    const b = 0.7 + rnd() * 0.7;
    splatColor(alb, cx, cy, 0.9 + rnd() * 0.8, [96 * b, 84 * b, 66 * b], 0.6, 0.4);
  }
  await emitSet('dirt', alb, hgt, 2.6);
}

// ================================================================== SNOW
async function genSnow() {
  console.log('snow...');
  RSEED = 2026;
  const alb = newAlbedo(), hgt = newHeight();

  fillHeight(hgt, (u, v) => {
    const [wu, wv] = warp(u, v, 0.12, 3, 3, 801);
    const ripple = afbm(wu, wv, 8, 2, 3, 0.5, 803);   // wind ripples, stretched
    const dune = fbm(wu, wv, 3, 3, 0.5, 807);
    const fine = fbm(u, v, 90, 2, 0.5, 809);
    return ripple * 0.6 + dune * 0.5 + fine * 0.08;
  });

  const white = [228, 231, 235], shade = [172, 184, 204], deep = [148, 162, 188];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const h = clamp01(hgt[y * S + x]);
      let c = mix3(deep, white, clamp01(h * 1.15));
      const g = fbm(u, v, 130, 2, 0.5, 821);
      c = mix3(c, shade, (1 - h) * 0.25 * g);
      // Sparkle flecks ~1%.
      const s = vnoise(u * 512, v * 512, 512, 512, 823);
      if (s > 0.99) c = [252, 252, 255];
      else if (s > 0.975) c = mix3(c, [246, 248, 252], 0.7);
      const i = (y * S + x) * 3;
      alb[i] = c[0]; alb[i + 1] = c[1]; alb[i + 2] = c[2];
    }
  }
  await emitSet('snow', alb, hgt, 2.2);
}

// ================================================================== SAND
async function genSand() {
  console.log('sand...');
  RSEED = 555;
  const alb = newAlbedo(), hgt = newHeight();

  fillHeight(hgt, (u, v) => {
    const [wu, wv] = warp(u, v, 0.06, 4, 3, 901);
    const rip = afbm(wu, wv, 16, 5, 3, 0.5, 903);     // fine shore ripples
    const grain = fbm(u, v, 120, 2, 0.5, 907);
    const low = fbm(u, v, 4, 3, 0.5, 909);
    return rip * 0.55 + low * 0.3 + grain * 0.12;
  });

  const dry = [150, 134, 102], mid = [122, 108, 80], wet = [82, 72, 52];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const h = clamp01(hgt[y * S + x]);
      // Moisture bands: broad, stretched darkening.
      const band = afbm(u, v, 2, 5, 2, 0.5, 911);
      const g = fbm(u, v, 140, 2, 0.5, 913);
      let c = mix3(wet, dry, clamp01(h * 1.2));
      c = mix3(c, mid, 0.3 * g);
      c = mix3(c, wet, sstep(0.52, 0.8, band) * 0.55);
      const i = (y * S + x) * 3;
      alb[i] = c[0]; alb[i + 1] = c[1]; alb[i + 2] = c[2];
    }
  }
  // Shell / pebble flecks.
  for (let n = 0; n < 520; n++) {
    const cx = rnd() * S, cy = rnd() * S;
    const r = 0.8 + rnd() * 1.8;
    const light = rnd() < 0.6;
    const b = 0.8 + rnd() * 0.5;
    splatColor(alb, cx, cy, r, light ? [172 * b, 158 * b, 130 * b] : [92 * b, 84 * b, 70 * b], 0.75, 0.45);
    if (light) splatHeight(hgt, cx, cy, r, 0.35, 0.3);
  }
  await emitSet('sand', alb, hgt, 2.0);
}

// ============================================================ SHARED MAPS
async function genShared() {
  console.log('shared (macro_n, noise)...');
  const M = 512;
  // macro_n: large-scale gentle undulation.
  const mh = new Float32Array(M * M);
  for (let y = 0; y < M; y++) {
    const v = y / M;
    for (let x = 0; x < M; x++) {
      const u = x / M;
      const [wu, wv] = warp(u, v, 0.15, 2, 2, 1001);
      mh[y * M + x] = fbm(wu, wv, 3, 4, 0.5, 1003);
    }
  }
  const mout = new Uint8Array(M * M * 3);
  const widx = (x, y) => (((y % M) + M) % M) * M + (((x % M) + M) % M);
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      const gx = mh[widx(x + 1, y)] - mh[widx(x - 1, y)];
      const gy = mh[widx(x, y + 1)] - mh[widx(x, y - 1)];
      let nx = -gx * 3.2, ny = gy * 3.2, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * M + x) * 3;
      mout[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      mout[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      mout[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
    }
  }
  await saveJpg(mout, M, 'macro_n.jpg', 80, '4:4:4');

  // noise.jpg: 3 independent fbm channels for splat dithering / UV breakup.
  const nout = new Uint8Array(M * M * 3);
  for (let y = 0; y < M; y++) {
    const v = y / M;
    for (let x = 0; x < M; x++) {
      const u = x / M;
      const i = (y * M + x) * 3;
      nout[i] = Math.round(clamp01(fbm(u, v, 5, 4, 0.5, 1101)) * 255);
      nout[i + 1] = Math.round(clamp01(fbm(u, v, 9, 4, 0.5, 1103)) * 255);
      nout[i + 2] = Math.round(clamp01(fbm(u, v, 17, 3, 0.5, 1107)) * 255);
    }
  }
  await saveJpg(nout, M, 'noise.jpg', 80, '4:4:4');
  console.log('  wrote macro_n.jpg / noise.jpg');
}

// ------------------------------------------------------------------- main
const GEN = { grass: genGrass, forest: genForest, rock: genRock, dirt: genDirt, snow: genSnow, sand: genSand, shared: genShared };
fs.mkdirSync(OUT, { recursive: true });
const todo = sets.length ? sets : Object.keys(GEN);
for (const s of todo) {
  if (!GEN[s]) { console.error(`unknown set: ${s}`); process.exit(1); }
  await GEN[s]();
}
let total = 0;
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('.jpg')) total += fs.statSync(path.join(OUT, f)).size;
}
console.log(`assets/terrain payload: ${(total / 1024 / 1024).toFixed(2)} MB`);

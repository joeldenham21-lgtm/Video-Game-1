// ============================================================================
// RANGE — materials.js
// Procedural PBR materials for the weapons and the range. All textures are
// generated on a canvas at load time: no external assets.
//   • gunmetal / phosphate (BCG), anodised aluminium (receiver), Cerakote
//   • polymer with stipple normal map (grips, mags, stocks)
//   • knurl normal map (turrets, charging handle latches, thread protectors)
//   • brass (cases), copper (bullet jackets)
//   • concrete, painted steel, plywood, cardboard, rubber, soil for the range
// Anisotropy on machined steel is enabled (MeshPhysicalMaterial, r160).
// ============================================================================
import * as THREE from 'three';

const texCache = new Map();

function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.anisotropy ?? 8;
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.needsUpdate = true;
  return t;
}

// deterministic hash noise
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, oct = 4, s = 0) {
  let v = 0, amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) { v += valueNoise(x * f, y * f, s + i) * amp; sum += amp; amp *= 0.5; f *= 2; }
  return v / sum;
}

/** Heightfield → tangent-space normal map texture. */
function normalFromHeight(w, h, heightFn, strength = 2, opts = {}) {
  return canvasTexture(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const H = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = heightFn(x / w, y / h, x, y);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = H[y * w + ((x - 1 + w) % w)], r = H[y * w + ((x + 1) % w)];
      const u = H[((y - 1 + h) % h) * w + x], d = H[((y + 1) % h) * w + x];
      let nx = -(r - l) * strength, ny = -(d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, opts);
}

function grayTexture(w, h, fn, opts = {}) {
  return canvasTexture(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(1, fn(x / w, y / h, x, y))) * 255;
      const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, opts);
}

export function getTex(name) {
  if (texCache.has(name)) return texCache.get(name);
  let t;
  switch (name) {
    case 'stippleN': // polymer stipple (grip / mag) — dense bumps
      t = normalFromHeight(256, 256, (u, v, x, y) => {
        const cell = 12; const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const jx = hash(cx, cy, 1) * 0.6 + 0.2, jy = hash(cx, cy, 2) * 0.6 + 0.2;
        const dx = (x / cell - cx) - jx, dy = (y / cell - cy) - jy;
        const d = Math.sqrt(dx * dx + dy * dy);
        return Math.max(0, 1 - d * 3) ** 2 * 0.8 + fbm(x / 20, y / 20, 3, 7) * 0.3;
      }, 2.5, { repeat: [1, 1] });
      break;
    case 'polymerN': // fine matte grain
      t = normalFromHeight(256, 256, (u, v, x, y) => fbm(x / 6, y / 6, 4, 11) * 0.5 + hash(x, y, 3) * 0.2, 0.9);
      break;
    case 'knurlN': // diamond knurl
      t = normalFromHeight(128, 128, (u, v) => {
        const a = (Math.sin((u + v) * Math.PI * 16) + 1) * 0.5, b = (Math.sin((u - v) * Math.PI * 16) + 1) * 0.5;
        return Math.min(a, b) ** 1.5;
      }, 4);
      break;
    case 'serrationN': // slide serrations (vertical grooves)
      t = normalFromHeight(128, 32, (u, v) => { const s = (u * 8) % 1; return s < 0.55 ? 0 : (s < 0.62 ? (s - 0.55) / 0.07 : (s < 0.93 ? 1 : (1 - s) / 0.07)); }, 3);
      break;
    case 'machinedN': // faint lathe/mill marks + micro pits
      t = normalFromHeight(256, 256, (u, v, x, y) => Math.sin(v * Math.PI * 200) * 0.05 + fbm(x / 14, y / 14, 3, 21) * 0.35 + (hash(x, y, 5) > 0.985 ? 0.6 : 0), 0.7);
      break;
    case 'anodizedR': // roughness variation for anodised aluminium
      t = grayTexture(256, 256, (u, v, x, y) => 0.55 + fbm(x / 30, y / 30, 4, 31) * 0.25 + (hash(x, y, 8) > 0.99 ? -0.3 : 0));
      break;
    case 'wearMask': // edge wear mask (bright = worn)
      t = grayTexture(256, 256, (u, v, x, y) => Math.pow(fbm(x / 40, y / 40, 5, 41), 3) * 1.4);
      break;
    case 'concreteC':
      t = canvasTexture(512, 512, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const n = fbm(x / 60, y / 60, 5, 51) * 0.5 + fbm(x / 7, y / 7, 3, 52) * 0.35 + hash(x, y, 53) * 0.15;
          const g = 118 + (n - 0.5) * 70;
          const i = (y * w + x) * 4; img.data[i] = g * 1.0; img.data[i + 1] = g * 0.98; img.data[i + 2] = g * 0.94; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        // expansion joints
        ctx.strokeStyle = 'rgba(30,30,30,0.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0.5); ctx.lineTo(w, 0.5); ctx.moveTo(0.5, 0); ctx.lineTo(0.5, h); ctx.stroke();
      }, { srgb: true, repeat: [1, 1] });
      break;
    case 'concreteN':
      t = normalFromHeight(512, 512, (u, v, x, y) => fbm(x / 60, y / 60, 5, 51) * 0.6 + fbm(x / 7, y / 7, 3, 52) * 0.3 + (hash(x, y, 54) > 0.97 ? 0.4 : 0), 1.2);
      break;
    case 'soilC':
      t = canvasTexture(512, 512, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const n = fbm(x / 40, y / 40, 5, 61), m = fbm(x / 5, y / 5, 2, 62);
          const r = 96 + n * 50 + m * 20, g = 74 + n * 40 + m * 14, b = 52 + n * 26 + m * 8;
          const i = (y * w + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }, { srgb: true });
      break;
    case 'soilN':
      t = normalFromHeight(512, 512, (u, v, x, y) => fbm(x / 40, y / 40, 5, 61) * 0.7 + fbm(x / 5, y / 5, 2, 62) * 0.4, 2.0);
      break;
    case 'plywoodC':
      t = canvasTexture(512, 512, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const grain = Math.sin((x / 3 + fbm(x / 80, y / 30, 3, 71) * 40) * 0.6) * 0.5 + 0.5;
          const n = fbm(x / 50, y / 50, 4, 72);
          const base = 0.72 + grain * 0.14 + n * 0.1;
          const i = (y * w + x) * 4; img.data[i] = 205 * base; img.data[i + 1] = 172 * base; img.data[i + 2] = 118 * base; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }, { srgb: true });
      break;
    case 'cardboardC':
      t = canvasTexture(256, 256, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const n = fbm(x / 20, y / 20, 3, 81) * 0.25 + hash(x, y, 82) * 0.08;
          const base = 0.8 + n;
          const i = (y * w + x) * 4; img.data[i] = 196 * base; img.data[i + 1] = 165 * base; img.data[i + 2] = 118 * base; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }, { srgb: true });
      break;
    case 'paintedSteelC': // chipped paint on steel targets
      t = canvasTexture(512, 512, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const n = fbm(x / 30, y / 30, 5, 91);
          const chip = fbm(x / 12, y / 12, 3, 92) > 0.66;
          const i = (y * w + x) * 4;
          if (chip) { const g = 90 + n * 50; img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g + 4; }
          else { img.data[i] = 235 - n * 40; img.data[i + 1] = 235 - n * 40; img.data[i + 2] = 235 - n * 45; }
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }, { srgb: true });
      break;
    case 'grassC':
      t = canvasTexture(512, 512, (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const n = fbm(x / 30, y / 30, 5, 101), m = hash(x, y, 102);
          const i = (y * w + x) * 4;
          img.data[i] = 70 + n * 50 + m * 15; img.data[i + 1] = 92 + n * 60 + m * 15; img.data[i + 2] = 38 + n * 30; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }, { srgb: true });
      break;
    case 'sky': t = null; break;
    default: throw new Error('unknown texture ' + name);
  }
  texCache.set(name, t);
  return t;
}

// ---------------------------------------------------------------------------
// Material factory. Materials are cached per name so meshes share programs.
// ---------------------------------------------------------------------------
const matCache = new Map();
export function mat(name, overrides) {
  const key = overrides ? name + JSON.stringify(overrides) : name;
  if (matCache.has(key)) return matCache.get(key);
  let m;
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  switch (name) {
    // --- weapon metals ---
    case 'anodized': // hard-coat anodised 7075 receiver: matte, slightly metallic, subtle sheen
      m = P({ color: 0x25272b, metalness: 0.75, roughness: 0.58, normalMap: getTex('machinedN'), normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: getTex('anodizedR'), clearcoat: 0.08, clearcoatRoughness: 0.6, envMapIntensity: 1.5 }); break;
    case 'anodizedFDE':
      m = P({ color: 0x6b5a3e, metalness: 0.7, roughness: 0.66, normalMap: getTex('machinedN'), normalScale: new THREE.Vector2(0.3, 0.3), roughnessMap: getTex('anodizedR') }); break;
    case 'phosphate': // parkerised BCG / barrel: dark grey, dull
      m = P({ color: 0x2a2c2e, metalness: 0.85, roughness: 0.55, normalMap: getTex('machinedN'), normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.4 }); break;
    case 'nitride': // black nitride barrel / slide: darker & a little glossier than parkerising
      m = P({ color: 0x141517, metalness: 0.9, roughness: 0.42, normalMap: getTex('machinedN'), normalScale: new THREE.Vector2(0.25, 0.25), anisotropy: 0.6, anisotropyRotation: Math.PI / 2, envMapIntensity: 1.5 }); break;
    case 'blued': // polished blued steel (bolt body, bolt-action receiver)
      m = P({ color: 0x0f1218, metalness: 1.0, roughness: 0.28, clearcoat: 0.3, clearcoatRoughness: 0.2, anisotropy: 0.7, envMapIntensity: 1.6 }); break;
    case 'stainless': // bare polished stainless (bolt lugs, firing pin, extractor)
      m = P({ color: 0xb9bcc0, metalness: 1.0, roughness: 0.32, anisotropy: 0.8 }); break;
    case 'chrome': // chrome-lined bore / shiny bits
      m = P({ color: 0xd8dadd, metalness: 1.0, roughness: 0.12 }); break;
    case 'wornSteel': // machined bare steel with wear (charging handle latch, mag release)
      m = P({ color: 0x6f7378, metalness: 1.0, roughness: 0.45, normalMap: getTex('machinedN'), normalScale: new THREE.Vector2(0.6, 0.6) }); break;
    case 'knurledSteel':
      m = P({ color: 0x25272a, metalness: 0.9, roughness: 0.5, normalMap: getTex('knurlN'), normalScale: new THREE.Vector2(1, 1) }); break;
    case 'brass':
      m = P({ color: 0xc9a24a, metalness: 1.0, roughness: 0.33, anisotropy: 0.4 }); break;
    case 'brassDirty':
      m = P({ color: 0x9d7f3a, metalness: 1.0, roughness: 0.5 }); break;
    case 'copper': // bullet jacket
      m = P({ color: 0xb87333, metalness: 1.0, roughness: 0.35 }); break;
    case 'primer':
      m = P({ color: 0xa8a8a0, metalness: 1.0, roughness: 0.4 }); break;
    case 'lead':
      m = P({ color: 0x4a4c50, metalness: 0.8, roughness: 0.6 }); break;
    case 'redTip': m = S({ color: 0xc41e1e, roughness: 0.4 }); break;
    case 'greenTip': m = S({ color: 0x1d7a2a, roughness: 0.4 }); break;
    // --- polymers ---
    case 'polymer': // Magpul-style black polymer, stippled
      m = P({ color: 0x17171a, metalness: 0.0, roughness: 0.74, normalMap: getTex('polymerN'), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.25, sheenRoughness: 0.85, sheenColor: new THREE.Color(0x2a2a2a), envMapIntensity: 1.3 }); break;
    case 'polymerStipple':
      m = P({ color: 0x16161a, metalness: 0.0, roughness: 0.82, normalMap: getTex('stippleN'), normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 1.3 }); break;
    case 'polymerFDE':
      m = P({ color: 0x7a6a4d, metalness: 0.0, roughness: 0.8, normalMap: getTex('polymerN'), normalScale: new THREE.Vector2(0.6, 0.6) }); break;
    case 'polymerGrey': // Glock frame
      m = P({ color: 0x1c1d20, metalness: 0.02, roughness: 0.68, normalMap: getTex('polymerN'), normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.3 }); break;
    case 'rubber':
      m = S({ color: 0x0c0c0d, roughness: 0.95 }); break;
    case 'glassLens': // objective/ocular glass, greenish AR coating
      m = P({ color: 0x9fb8c8, metalness: 0, roughness: 0.02, transmission: 0.92, thickness: 0.004, ior: 1.52, transparent: true, opacity: 1, envMapIntensity: 1.2, clearcoat: 1, clearcoatRoughness: 0 }); break;
    case 'lensTint': // rubbery tinted lens for the red dot (cheap, no transmission)
      m = P({ color: 0x0a1a24, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.32, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false }); break;
    case 'tritium': m = S({ color: 0x3fff5a, emissive: 0x3fff5a, emissiveIntensity: 1.6, roughness: 0.3 }); break;
    case 'whiteDot': m = S({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }); break;
    case 'gloveBlack':
      m = P({ color: 0x17181a, roughness: 0.82, metalness: 0, normalMap: getTex('polymerN'), normalScale: new THREE.Vector2(0.4, 0.4), sheen: 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x333333) }); break;
    case 'gloveTan':
      m = P({ color: 0x8a7654, roughness: 0.88, metalness: 0, normalMap: getTex('polymerN'), normalScale: new THREE.Vector2(0.5, 0.5), sheen: 0.4, sheenRoughness: 0.9, sheenColor: new THREE.Color(0x5a4a30) }); break;
    case 'sleeve':
      m = P({ color: 0x3a4a3a, roughness: 0.95, metalness: 0, sheen: 0.5, sheenRoughness: 0.95, sheenColor: new THREE.Color(0x445544) }); break;
    case 'walnut':
      m = P({ color: 0x4a2c16, roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 }); break;
    // --- range ---
    case 'concrete':
      m = S({ map: getTex('concreteC'), normalMap: getTex('concreteN'), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92, metalness: 0 }); break;
    case 'soil':
      m = S({ map: getTex('soilC'), normalMap: getTex('soilN'), roughness: 1.0, metalness: 0 }); break;
    case 'grass':
      m = S({ map: getTex('grassC'), roughness: 1.0, metalness: 0 }); break;
    case 'plywood':
      m = S({ map: getTex('plywoodC'), roughness: 0.8, metalness: 0 }); m.map.repeat.set(2.5, 2.5); break;
    case 'cardboard':
      m = S({ map: getTex('cardboardC'), roughness: 0.9, metalness: 0, side: THREE.DoubleSide }); break;
    case 'paintedSteel':
      m = S({ map: getTex('paintedSteelC'), roughness: 0.6, metalness: 0.35 }); break;
    case 'galvanized':
      m = P({ color: 0x8e9398, metalness: 0.9, roughness: 0.55, normalMap: getTex('machinedN'), normalScale: new THREE.Vector2(0.4, 0.4) }); break;
    case 'lumber':
      m = S({ map: getTex('plywoodC'), color: 0xd9c9a8, roughness: 0.85, metalness: 0 }); break;
    case 'roofSteel':
      m = P({ color: 0xb4babe, metalness: 0.15, roughness: 0.7 }); break;
    case 'whitePaint': m = S({ color: 0xe6e6e0, roughness: 0.6 }); break;
    case 'redPaint': m = S({ color: 0xb8231c, roughness: 0.5 }); break;
    case 'yellowPaint': m = S({ color: 0xd9b52a, roughness: 0.5 }); break;
    case 'blackPaint': m = S({ color: 0x111111, roughness: 0.55 }); break;
    case 'orangeTarget': m = S({ color: 0xff6a00, roughness: 0.7 }); break;
    default: throw new Error('unknown material ' + name);
  }
  if (overrides) { for (const k in overrides) { if (m[k] && m[k].isColor) m[k].set(overrides[k]); else m[k] = overrides[k]; } }
  matCache.set(key, m);
  return m;
}

/** Apply an environment map to every cached material (called once PMREM is ready). */
export function applyEnvMap(envMap, intensity = 1) {
  for (const m of matCache.values()) { m.envMap = envMap; m.envMapIntensity = m.envMapIntensity ?? intensity; m.needsUpdate = true; }
  applyEnvMap.envMap = envMap;
}
export function envMap() { return applyEnvMap.envMap || null; }

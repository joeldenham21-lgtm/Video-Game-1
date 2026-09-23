// Procedural PBR textures drawn on canvas: albedo, normal (from a height layout), roughness/metalness.
// All pixel measurements scale with the texture size so 512 and 1024 versions share one look.
import * as THREE from 'three';
import { rng } from '../util.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Split a square into a tileable set of rectangles
function layoutPanels(r, size, minCell) {
  const rects = [];
  function split(x, y, w, h, depth) {
    const canSplitW = w >= minCell * 2, canSplitH = h >= minCell * 2;
    if (depth > 4 || (!canSplitW && !canSplitH) || (depth > 1 && r() < 0.28)) { rects.push({ x, y, w, h, t: r() }); return; }
    const vertical = canSplitW && (!canSplitH || (w > h ? r() < 0.75 : r() < 0.25));
    if (vertical) {
      const cells = Math.round(w / minCell);
      const k = Math.max(1, Math.min(cells - 1, Math.round(cells * (0.3 + r() * 0.4))));
      split(x, y, k * minCell, h, depth + 1);
      split(x + k * minCell, y, w - k * minCell, h, depth + 1);
    } else {
      const cells = Math.round(h / minCell);
      const k = Math.max(1, Math.min(cells - 1, Math.round(cells * (0.3 + r() * 0.4))));
      split(x, y, w, k * minCell, depth + 1);
      split(x, y + k * minCell, w, h - k * minCell, depth + 1);
    }
  }
  split(0, 0, size, size, 0);
  return rects;
}

function hexToRgb(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }

/**
 * Hull plating: returns { map, normalMap, ormMap } (orm: G = roughness, B = metalness)
 * kind: 'floor' | 'wall' | 'dark'
 */
export function makePlating(kind = 'wall', opts = {}) {
  const size = opts.size || 512;
  const k = size / 512;
  const seed = opts.seed || (kind === 'floor' ? 11 : kind === 'dark' ? 29 : 7);
  const r = rng(seed);
  const base = hexToRgb(opts.color || (kind === 'floor' ? 0x4c525c : kind === 'dark' ? 0x30343c : 0x5a616c));
  const accent = opts.accent || '#d8a040';

  const albedo = canvas(size), height = canvas(size), orm = canvas(size);
  const A = albedo.getContext('2d'), H = height.getContext('2d'), O = orm.getContext('2d');
  A.fillStyle = `rgb(${base[0] * 0.5 | 0},${base[1] * 0.5 | 0},${base[2] * 0.5 | 0})`; A.fillRect(0, 0, size, size);
  H.fillStyle = '#000'; H.fillRect(0, 0, size, size);
  O.fillStyle = 'rgb(0,215,140)'; O.fillRect(0, 0, size, size);

  const rects = layoutPanels(r, size, size / 8);
  const gap = (kind === 'floor' ? 3 : 2.2) * k;
  const bev = 3.5 * k;
  for (const p of rects) {
    const x = p.x + gap, y = p.y + gap, w = p.w - gap * 2, h = p.h - gap * 2;
    const tone = 0.86 + p.t * 0.24;
    const c = base.map(v => Math.min(255, v * tone) | 0);
    const grad = A.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, `rgb(${c[0] + 9},${c[1] + 9},${c[2] + 11})`);
    grad.addColorStop(1, `rgb(${c[0] - 8},${c[1] - 8},${c[2] - 6})`);
    A.fillStyle = grad; A.fillRect(x, y, w, h);
    // worn, brighter bevel edge (paint chipped back to metal)
    A.strokeStyle = `rgba(200,210,225,${0.08 + p.t * 0.08})`; A.lineWidth = 1.2 * k;
    A.strokeRect(x + 0.6 * k, y + 0.6 * k, w - 1.2 * k, h - 1.2 * k);
    // height: panel body with a bevelled lip
    H.fillStyle = '#6a6a6a'; H.fillRect(x, y, w, h);
    H.fillStyle = '#7c7c7c'; H.fillRect(x + bev * 0.5, y + bev * 0.5, w - bev, h - bev);
    H.fillStyle = '#8a8a8a'; H.fillRect(x + bev, y + bev, w - bev * 2, h - bev * 2);
    const rough = 80 + p.t * 80 | 0;
    O.fillStyle = `rgb(0,${rough},${kind === 'dark' ? 110 : 185})`; O.fillRect(x, y, w, h);
    // edges are rubbed shiny
    O.strokeStyle = `rgb(0,${Math.max(40, rough - 45)},230)`; O.lineWidth = 1.5 * k;
    O.strokeRect(x + 0.75 * k, y + 0.75 * k, w - 1.5 * k, h - 1.5 * k);

    const big = w > size / 5 && h > size / 5;
    const roll = r();
    if (big && roll < 0.22) {
      // vent slats
      const n = Math.floor(h / (10 * k));
      for (let i = 1; i < n; i++) {
        const yy = y + i * (h / n);
        A.fillStyle = 'rgba(0,0,0,0.55)'; A.fillRect(x + w * 0.12, yy - 2 * k, w * 0.76, 3 * k);
        A.fillStyle = 'rgba(255,255,255,0.05)'; A.fillRect(x + w * 0.12, yy + k, w * 0.76, k);
        H.fillStyle = '#303030'; H.fillRect(x + w * 0.12, yy - 2 * k, w * 0.76, 3 * k);
        O.fillStyle = 'rgb(0,230,90)'; O.fillRect(x + w * 0.12, yy - 2 * k, w * 0.76, 3 * k);
      }
    } else if (big && roll < 0.36 && kind !== 'floor') {
      // recessed inset
      H.fillStyle = '#5a5a5a'; H.fillRect(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64);
      A.fillStyle = 'rgba(0,0,0,0.18)'; A.fillRect(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64);
    } else if (kind === 'floor' && big && roll < 0.5) {
      // anti-slip diamond grating
      A.save(); A.beginPath(); A.rect(x + 6 * k, y + 6 * k, w - 12 * k, h - 12 * k); A.clip();
      H.save(); H.beginPath(); H.rect(x + 6 * k, y + 6 * k, w - 12 * k, h - 12 * k); H.clip();
      O.save(); O.beginPath(); O.rect(x + 6 * k, y + 6 * k, w - 12 * k, h - 12 * k); O.clip();
      const st = 12 * k;
      for (let yy = y; yy < y + h; yy += st) {
        for (let xx = x + (Math.round(yy / st) % 2) * st / 2; xx < x + w; xx += st) {
          A.fillStyle = 'rgba(255,255,255,0.07)'; A.fillRect(xx, yy, 7 * k, 2 * k);
          H.fillStyle = '#a4a4a4'; H.fillRect(xx, yy, 7 * k, 2 * k);
          O.fillStyle = 'rgb(0,70,220)'; O.fillRect(xx, yy, 7 * k, 2 * k);
        }
      }
      A.restore(); H.restore(); O.restore();
    }
    if ((kind === 'dark' || (kind === 'floor' && roll > 0.93)) && (w < size / 3 || h < size / 3) && r() < 0.5) {
      // hazard striping, scuffed
      A.save(); A.beginPath(); A.rect(x, y, w, h); A.clip();
      for (let s = -h; s < w + h; s += 24 * k) {
        A.fillStyle = accent; A.globalAlpha = 0.42;
        A.beginPath(); A.moveTo(x + s, y); A.lineTo(x + s + 12 * k, y); A.lineTo(x + s + 12 * k - h, y + h); A.lineTo(x + s - h, y + h); A.fill();
      }
      A.restore(); A.globalAlpha = 1;
    }
    if (w > 40 * k && h > 40 * k && r() < 0.7) {
      for (const [bx, by] of [[x + 8 * k, y + 8 * k], [x + w - 8 * k, y + 8 * k], [x + 8 * k, y + h - 8 * k], [x + w - 8 * k, y + h - 8 * k]]) {
        A.fillStyle = 'rgba(20,22,26,0.9)'; A.beginPath(); A.arc(bx, by, 3.2 * k, 0, Math.PI * 2); A.fill();
        A.fillStyle = 'rgba(255,255,255,0.2)'; A.beginPath(); A.arc(bx - 0.8 * k, by - 0.8 * k, 1.4 * k, 0, Math.PI * 2); A.fill();
        H.fillStyle = '#d0d0d0'; H.beginPath(); H.arc(bx, by, 3.2 * k, 0, Math.PI * 2); H.fill();
        O.fillStyle = 'rgb(0,60,240)'; O.beginPath(); O.arc(bx, by, 3.2 * k, 0, Math.PI * 2); O.fill();
      }
    }
  }

  // scratches & wear
  const scratches = Math.round(110 * k * k);
  for (let i = 0; i < scratches; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI * 2, l = (6 + r() * 40) * k;
    A.strokeStyle = `rgba(210,220,235,${0.035 + r() * 0.07})`; A.lineWidth = (0.5 + r()) * k;
    A.beginPath(); A.moveTo(x, y); A.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); A.stroke();
    O.strokeStyle = 'rgb(0,60,235)'; O.lineWidth = k;
    O.beginPath(); O.moveTo(x, y); O.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); O.stroke();
  }
  // grime and oil stains (also rougher)
  for (let i = 0; i < 16; i++) {
    const x = r() * size, y = r() * size, rad = (20 + r() * 90) * k;
    const g = A.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(8,6,4,0.24)'); g.addColorStop(1, 'rgba(8,6,4,0)');
    A.fillStyle = g; A.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const go = O.createRadialGradient(x, y, 0, x, y, rad);
    go.addColorStop(0, 'rgba(0,255,120,0.25)'); go.addColorStop(1, 'rgba(0,255,120,0)');
    O.fillStyle = go; O.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // albedo grain
  const img = A.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 9;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  A.putImageData(img, 0, 0);
  // roughness micro-variation
  const oimg = O.getImageData(0, 0, size, size);
  const od = oimg.data;
  for (let i = 0; i < od.length; i += 4) od[i + 1] = Math.max(0, Math.min(255, od[i + 1] + (r() - 0.5) * 26));
  O.putImageData(oimg, 0, 0);

  // normal map from height (wrap for tiling) with fine surface noise
  const hd = H.getImageData(0, 0, size, size).data;
  const hf = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) hf[i] = hd[i * 4] / 255 + (r() - 0.5) * 0.012;
  const normal = canvas(size);
  const N = normal.getContext('2d');
  const nimg = N.createImageData(size, size);
  const nd = nimg.data;
  const strength = (opts.normalStrength || 2.4) * k;
  const hAt = (x, y) => hf[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nd[i] = (-dx / len * 0.5 + 0.5) * 255;
      nd[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      nd[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      nd[i + 3] = 255;
    }
  }
  N.putImageData(nimg, 0, 0);

  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = opts.anisotropy || 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: tex(albedo, true), normalMap: tex(normal, false), ormMap: tex(orm, false) };
}

// Soft radial sprite for particles/glows
export function makeGlowTexture(size = 64) {
  const c = canvas(size);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Scorch / impact decal
export function makeScorchTexture(size = 128) {
  const c = canvas(size);
  const x = c.getContext('2d');
  const r = rng(5);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, l = size * (0.2 + r() * 0.28);
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1 + r() * 2;
    x.beginPath(); x.moveTo(size / 2, size / 2); x.lineTo(size / 2 + Math.cos(a) * l, size / 2 + Math.sin(a) * l); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

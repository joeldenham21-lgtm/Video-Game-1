// Small math + RNG helpers shared by every module.
export const TAU = Math.PI * 2;
export const PI = Math.PI;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
export const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const sign = (v) => (v < 0 ? -1 : 1);

export function wrapAngle(a) {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}
export function approachAngle(a, target, maxDelta) {
  const d = wrapAngle(target - a);
  if (Math.abs(d) <= maxDelta) return target;
  return a + sign(d) * maxDelta;
}
export function approach(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  pulse: (t) => Math.sin(t * PI),
};

export class RNG {
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  next() {
    // mulberry32
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

// Cheap hex/rgba helpers for palettes.
export function rgba(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function mixHex(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((A >> 16) & 255, (B >> 16) & 255, t));
  const g = Math.round(lerp((A >> 8) & 255, (B >> 8) & 255, t));
  const bl = Math.round(lerp(A & 255, B & 255, t));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}
export function fmtNum(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
export function fmtTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

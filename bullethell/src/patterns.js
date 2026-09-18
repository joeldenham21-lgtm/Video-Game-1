// Bullet pattern library. Every function spawns into g.bullets (enemy bullets)
// and applies the difficulty multipliers in g.diff.
import { TAU, PI, angTo } from './math.js';
import { Laser } from './bullets.js';

const D = (g) => g.diff;
export const aimAt = (g, x, y) => angTo(x, y, g.player.x, g.player.y);

function base(g, x, y, o, ang, spd) {
  const b = g.bullets.spawn({
    x, y, ang, spd: spd * D(g).speed, r: o.r ?? 4, kind: o.kind || 'orb', color: o.color || g.pal.b1,
    delay: o.delay ?? 0, accel: o.accel ?? 0, turn: o.turn ?? 0, minSpd: o.minSpd ?? 0, maxSpd: o.maxSpd ?? 2000,
    home: o.home ?? 0, homeTime: o.homeTime ?? 0, homeDelay: o.homeDelay ?? 0, bounces: o.bounces ?? 0,
    fuse: o.fuse ?? 0, onFuse: o.onFuse, onUpdate: o.onUpdate, wave: o.wave ?? 0, waveFreq: o.waveFreq,
    life: o.life ?? 20, ghost: o.ghost ?? 0, grav: o.grav ?? 1, data: o.data,
  });
  if (g.level && g.level.modBullet) g.level.modBullet(b);
  return b;
}
export function single(g, x, y, o = {}) {
  const ang = o.ang ?? (o.aim !== false ? aimAt(g, x, y) : PI / 2);
  return base(g, x, y, o, ang + (o.off || 0), o.spd ?? 160);
}
// Full ring of n bullets.
export function ring(g, x, y, o = {}) {
  const n = Math.max(3, Math.round((o.n ?? 12) * (o.noScale ? 1 : D(g).count)));
  const a0 = o.ang ?? (o.aim ? aimAt(g, x, y) : 0), spd = o.spd ?? 150;
  const out = [];
  for (let i = 0; i < n; i++) out.push(base(g, x, y, o, a0 + (i / n) * TAU, spd));
  return out;
}
// Fan of n bullets over 'spread' radians, centred on ang (aimed by default).
export function fan(g, x, y, o = {}) {
  const n = Math.max(1, Math.round((o.n ?? 5) * (o.noScale ? 1 : Math.sqrt(D(g).count))));
  const spread = o.spread ?? 0.6, spd = o.spd ?? 170;
  const ang = o.ang ?? aimAt(g, x, y);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? ang : ang - spread / 2 + (spread * i) / (n - 1);
    out.push(base(g, x, y, o, a, spd));
  }
  return out;
}
// Column of bullets at same angle but layered speeds.
export function stack(g, x, y, o = {}) {
  const n = o.n ?? 3, ang = o.ang ?? aimAt(g, x, y), s0 = o.spd ?? 120, s1 = o.spd1 ?? 260;
  const out = [];
  for (let i = 0; i < n; i++) out.push(base(g, x, y, o, ang, s0 + ((s1 - s0) * i) / Math.max(1, n - 1)));
  return out;
}
// Random spray within arc.
export function spray(g, x, y, o = {}) {
  const n = Math.max(1, Math.round((o.n ?? 6) * D(g).count)), rng = g.rng;
  const ang = o.ang ?? aimAt(g, x, y), arc = o.arc ?? 1.2, s0 = o.spd ?? 100, s1 = o.spd1 ?? 220;
  const out = [];
  for (let i = 0; i < n; i++) out.push(base(g, x, y, o, ang + rng.range(-arc / 2, arc / 2), rng.range(s0, s1)));
  return out;
}
// Multi-arm spiral step: call each frame/tick with an advancing 'ang'.
export function spiralStep(g, x, y, o = {}) {
  const arms = o.arms ?? 3, spd = o.spd ?? 140, out = [];
  for (let i = 0; i < arms; i++) out.push(base(g, x, y, o, (o.ang || 0) + (i / arms) * TAU, spd));
  return out;
}
// A bullet that bursts into a ring after 'fuse' seconds (seed / flower bullets).
export function seed(g, x, y, o = {}) {
  const child = o.child || {};
  return single(g, x, y, {
    ...o, kind: o.kind || 'big', r: o.r ?? 7,
    fuse: o.fuse ?? 1.2,
    onFuse: (b, g2) => {
      if (child.laser) return;
      ring(g2, b.x, b.y, { n: child.n ?? 8, spd: child.spd ?? 120, kind: child.kind || 'orb', r: child.r ?? 3.5, color: child.color || b.color, ang: child.aim ? aimAt(g2, b.x, b.y) : (child.ang ?? b.ang), accel: child.accel ?? 0 });
      g2.audio.sfx('tick');
    },
  });
}
// Laser telegraphed then fired.
export function laser(g, o) {
  const L = new Laser({ ...o, color: o.color || g.pal.b2 });
  g.lasers.push(L);
  if (o.warn !== 0) g.audio.sfx('lasercharge');
  return L;
}
// Wall of bullets across the top with a gap (classic curtain).
export function curtain(g, o = {}) {
  const n = Math.round((o.n ?? 14) * D(g).count), gapAt = o.gapAt ?? g.player.x, gapW = o.gapW ?? 90, y = o.y ?? -10;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = (g.W * i) / n;
    if (Math.abs(x - gapAt) < gapW / 2) continue;
    out.push(base(g, x, y, o, PI / 2, o.spd ?? 130));
  }
  return out;
}
// Timer helper: returns true every 'interval' seconds using e.timers[key].
export function every(e, key, interval, dt) {
  if (!e.timers) e.timers = {};
  const v = (e.timers[key] || 0) + dt;
  if (v >= interval) { e.timers[key] = v - interval; return true; }
  e.timers[key] = v; return false;
}
export function everyN(e, key, interval, dt) {
  // returns how many ticks elapsed (handles low FPS)
  if (!e.timers) e.timers = {};
  let v = (e.timers[key] || 0) + dt, n = 0;
  while (v >= interval) { v -= interval; n++; }
  e.timers[key] = v; return n;
}

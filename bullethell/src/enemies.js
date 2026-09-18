// Enemy archetypes + a tiny movement-sequence runner so levels can author waves tersely.
import { TAU, PI, clamp, lerp, ease, angTo, rgba, dist } from './math.js';
import * as P from './patterns.js';

export const TYPES = {
  dart:    { r: 9,  hp: 3,   score: 120,  drops: { score: 1 } },
  drone:   { r: 13, hp: 9,   score: 260,  drops: { score: 2, power: 0.12 } },
  spinner: { r: 14, hp: 14,  score: 380,  drops: { score: 2, power: 0.15 } },
  turret:  { r: 19, hp: 34,  score: 700,  drops: { score: 4, power: 0.5 } },
  carrier: { r: 32, hp: 110, score: 2200, drops: { score: 8, power: 1, bomb: 0.25 } },
  mine:    { r: 11, hp: 4,   score: 150,  drops: { score: 1 } },
  knight:  { r: 16, hp: 26,  score: 600,  drops: { score: 3, power: 0.3 } },
  segment: { r: 12, hp: 12,  score: 200,  drops: { score: 1 } },
  seedpod: { r: 15, hp: 10,  score: 300,  drops: { score: 2 } },
  echo:    { r: 11, hp: 30,  score: 500,  drops: { score: 3 } },
};

export class Enemy {
  constructor(g, type, x, y, o = {}) {
    const d = TYPES[type] || TYPES.drone;
    this.g = g; this.type = type; this.x = x; this.y = y; this.t = 0; this.dead = false;
    this.r = o.r ?? d.r; this.hp = (o.hp ?? d.hp) * g.diff.hp; this.maxhp = this.hp;
    this.score = o.score ?? d.score; this.drops = o.drops || d.drops;
    this.color = o.color || g.pal.e; this.color2 = o.color2 || g.pal.e2;
    this.seq = o.seq || null; this.si = 0; this.st = 0; this.sx = x; this.sy = y;
    this.move = o.move || null; this.fire = o.fire || defaultFire[type] || null;
    this.onDeath = o.onDeath || null; this.data = o.data || {};
    this.shield = o.shield ?? false; this.shieldOn = true; this.flash = 0; this.spin = 0;
    this.timers = {}; this.noHit = o.noHit || false; this.fadeIn = 0.35; this.despawnY = o.despawnY ?? g.H + 60;
    this.grav = o.grav ?? 0;
  }
  runSeq(dt) {
    const s = this.seq; if (!s || this.si >= s.length) return;
    const it = s[this.si];
    if (this.st === 0) { this.sx = this.x; this.sy = this.y; if (it.loop !== undefined) { this.si = it.loop; this.st = 0; return this.runSeq(dt); } }
    this.st += dt;
    const dur = it.dur ?? 1, k = clamp(this.st / dur, 0, 1), e = ease[it.ease || 'inOut'](k);
    if (it.x !== undefined) { this.x = lerp(this.sx, it.x, e); this.y = lerp(this.sy, it.y ?? this.sy, e); }
    else if (it.vx !== undefined || it.vy !== undefined) { this.x += (it.vx || 0) * dt; this.y += (it.vy || 0) * dt; }
    else if (it.fn) it.fn(this, this.st, dt);
    if (it.hold !== undefined && this.st >= it.hold) { this.si++; this.st = 0; }
    else if (it.hold === undefined && this.st >= dur) { this.si++; this.st = 0; }
  }
  update(dt) {
    const g = this.g; this.t += dt; this.spin += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.seq) this.runSeq(dt);
    if (this.move) this.move(this, g, dt);
    if (this.fire && this.t > 0.4 && !g.bossDying) this.fire(this, g, dt);
    if (this.shield) this.shieldOn = Math.floor(this.t / 2.2) % 2 === 0;
    if (this.y > this.despawnY || this.x < -80 || this.x > g.W + 80 || this.y < -160) this.dead = true;
  }
  damage(dmg, fromX, fromY) {
    if (this.shield && this.shieldOn && fromY !== undefined && fromY > this.y - 6) {
      this.g.fx.spark(this.x, this.y + this.r, PI / 2, 2, '#ffffff', { spd: 100 }); this.g.audio.sfx('shield'); return false;
    }
    this.hp -= dmg; this.flash = 0.08;
    if (this.hp <= 0 && !this.dead) { this.dead = true; this.kill(); }
    return true;
  }
  kill(silent = false) {
    const g = this.g;
    g.player.stats.kills++;
    const big = this.r >= 18;
    g.fx.burst(this.x, this.y, big ? 40 : 14, this.color, { spd: big ? 260 : 160, life: big ? 0.9 : 0.5, size: big ? 4 : 3 });
    g.fx.burst(this.x, this.y, big ? 16 : 6, '#ffffff', { spd: 120, life: 0.4, size: 2 });
    if (big) { g.fx.ring(this.x, this.y, this.color, { r1: this.r * 4 }); g.fx.addShake(4); }
    g.audio.sfx(big ? 'bigkill' : 'kill');
    g.addScore(this.score, true);
    g.mult = Math.min(g.maxMult, g.mult + (big ? 0.12 : 0.03)); g.chainT = 0;
    if (!silent) {
      const d = this.drops || {};
      for (let i = 0; i < (d.score || 0); i++) g.items.spawn(this.x + (Math.random() - 0.5) * 20, this.y, 'score');
      g.powerDebt = (g.powerDebt || 0) + 1;
      if (g.player.power < 4 && (g.powerDebt >= 12 || (d.power && g.rng.chance(d.power)))) { g.items.spawn(this.x, this.y, 'power'); g.powerDebt = 0; }
      else if (d.power && g.rng.chance(d.power * 0.3)) g.items.spawn(this.x, this.y, 'power');
      if (d.bomb && g.rng.chance(d.bomb)) g.items.spawn(this.x, this.y, 'bomb');
      if (d.life && g.rng.chance(d.life)) g.items.spawn(this.x, this.y, 'life');
    }
    if (this.onDeath) this.onDeath(this, g);
  }
  draw(ctx) {
    const g = this.g, c = this.flash > 0 ? '#ffffff' : this.color, c2 = this.color2;
    const a = Math.min(1, this.t / this.fadeIn);
    ctx.save(); ctx.translate(this.x, this.y); ctx.globalAlpha = a;
    // glow
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, this.r * 1.9); gr.addColorStop(0, rgba(this.color, 0.35)); gr.addColorStop(1, rgba(this.color, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, this.r * 1.9, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.5; ctx.strokeStyle = c2; ctx.fillStyle = rgba(c, 0.85); ctx.lineJoin = 'round';
    const r = this.r, t = this.spin;
    switch (this.type) {
      case 'dart':
        ctx.rotate(PI / 2); poly(ctx, [[r * 1.6, 0], [-r, r * 0.8], [-r * 0.5, 0], [-r, -r * 0.8]]); break;
      case 'drone':
        ctx.rotate(t * 1.5); poly(ctx, ngon(6, r)); ctx.rotate(-t * 3); ctx.fillStyle = c2; poly(ctx, ngon(3, r * 0.45)); break;
      case 'spinner':
        ctx.rotate(t * 4); for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); poly(ctx, [[0, 0], [r * 1.4, -r * 0.4], [r * 1.6, 0], [r * 1.4, r * 0.4]]); }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.fill(); break;
      case 'turret':
        poly(ctx, ngon(8, r)); ctx.rotate(-t); ctx.strokeStyle = c2; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, PI * 1.5); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, TAU); ctx.fill(); break;
      case 'carrier':
        poly(ctx, [[0, -r * 1.1], [r * 0.9, -r * 0.3], [r, r * 0.6], [r * 0.5, r], [-r * 0.5, r], [-r, r * 0.6], [-r * 0.9, -r * 0.3]]);
        ctx.fillStyle = c2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * r * 0.5, r * 0.3, r * 0.14, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -r * 0.3, r * 0.3, 0, TAU); ctx.stroke();
        hpbar(ctx, this); break;
      case 'mine':
        ctx.rotate(t * 2); poly(ctx, ngon(4, r)); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r * 0.5 + Math.sin(t * 10) * 2, 0, TAU); ctx.stroke(); break;
      case 'knight':
        poly(ctx, ngon(5, r)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, TAU); ctx.fill();
        if (this.shield && this.shieldOn) { ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0.15 * PI, 0.85 * PI); ctx.stroke(); ctx.strokeStyle = rgba(c2, 0.5); ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0.15 * PI, 0.85 * PI); ctx.stroke(); }
        else if (this.shield) { ctx.strokeStyle = rgba('#ffffff', 0.25); ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(0, 0, r + 6, 0.15 * PI, 0.85 * PI); ctx.stroke(); ctx.setLineDash([]); }
        break;
      case 'segment':
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.fill(); break;
      case 'seedpod':
        for (let i = 0; i < 5; i++) { ctx.rotate(TAU / 5); ctx.beginPath(); ctx.ellipse(r * 0.55, 0, r * 0.6, r * 0.32, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, 0, r * 0.4 + Math.sin(t * 5) * 1.5, 0, TAU); ctx.fill(); break;
      case 'echo':
        ctx.globalAlpha = a * (0.55 + Math.sin(t * 8) * 0.15); ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.fillStyle = rgba(c, 0.35);
        poly(ctx, [[0, -18], [7, -2], [20, 10], [14, 14], [5, 9], [0, 13], [-5, 9], [-14, 14], [-20, 10], [-7, -2]]); break;
      default:
        poly(ctx, ngon(6, r));
    }
    ctx.restore();
  }
}
function hpbar(ctx, e) {
  const w = e.r * 2.2, k = clamp(e.hp / e.maxhp, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-w / 2, e.r + 6, w, 4);
  ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2, e.r + 6, w * k, 4);
}
export function ngon(n, r, rot = -PI / 2) { const p = []; for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }
export function poly(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke(); }

// Default firing behaviour per archetype (levels override freely).
const defaultFire = {
  dart: (e, g, dt) => { if (P.every(e, 'f', 1.6, dt) && g.rng.chance(0.6)) P.single(g, e.x, e.y, { spd: 190, r: 3.5 }); },
  drone: (e, g, dt) => { if (P.every(e, 'f', 1.4, dt)) P.fan(g, e.x, e.y, { n: 3, spread: 0.45, spd: 175 }); },
  spinner: (e, g, dt) => { if (P.every(e, 'f', 0.12, dt)) { e.data.a = (e.data.a || 0) + 0.35; P.spiralStep(g, e.x, e.y, { arms: 2, ang: e.data.a, spd: 130, r: 3.5, kind: 'orb' }); } },
  turret: (e, g, dt) => { if (P.every(e, 'f', 1.5, dt)) { P.ring(g, e.x, e.y, { n: 14, spd: 130, aim: true, r: 4 }); } },
  carrier: (e, g, dt) => {
    if (P.every(e, 'f', 0.9, dt)) P.spray(g, e.x, e.y + 10, { n: 5, arc: 1.4, spd: 90, spd1: 200, r: 3.5 });
    if (P.every(e, 's', 2.4, dt)) { for (let i = -1; i <= 1; i += 2) g.spawnEnemy('dart', e.x + i * 30, e.y + 20, { seq: [{ vx: i * 40, vy: 200, dur: 9 }] }); }
  },
  mine: (e, g, dt) => {},
  knight: (e, g, dt) => { if (P.every(e, 'f', 1.1, dt)) P.fan(g, e.x, e.y, { n: 4, spread: 0.5, spd: 200, kind: 'needle', r: 3.5, color: g.pal.b2 }); },
  segment: null,
  seedpod: (e, g, dt) => { if (P.every(e, 'f', 1.8, dt)) P.seed(g, e.x, e.y, { spd: 110, fuse: 1.1, child: { n: 6, spd: 110 } }); },
};

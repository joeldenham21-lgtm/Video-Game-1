// Boss framework + seven themed bosses, each with multiple distinct phases.
import { TAU, PI, clamp, lerp, dist, angTo, rgba, ease, wrapAngle } from './math.js';
import * as P from './patterns.js';
import { ngon, poly } from './enemies.js';

export class Boss {
  constructor(g, def) {
    this.g = g; this.def = def; this.name = def.name; this.title = def.title;
    this.x = g.W / 2; this.y = -120; this.home = { x: g.W / 2, y: 150 }; this.r = def.r || 40;
    this.color = def.color || g.pal.e; this.color2 = def.color2 || g.pal.e2;
    this.phases = def.phases; this.pi = -1; this.hp = 1; this.maxhp = 1; this.t = 0; this.tt = 0;
    this.entering = true; this.dying = 0; this.flash = 0; this.dead = false; this.timers = {};
    this.data = {}; this.spin = 0; this.invuln = 0; this.hitsThisPhase = 0; this.bombsThisPhase = 0;
    this.parts = def.parts ? def.parts(this) : null;
    this.hitboxes = null; // optional extra hit circles [{x,y,r}] (Umbra twins)
  }
  get phase() { return this.phases[this.pi]; }
  get timeLeft() { return this.phase ? Math.max(0, this.phase.time - this.t) : 0; }
  update(dt) {
    const g = this.g; this.tt += dt; this.spin += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dying > 0) { this.updateDying(dt); return; }
    if (this.entering) {
      this.x = lerp(this.x, this.home.x, 1 - Math.pow(0.02, dt)); this.y = lerp(this.y, this.home.y, 1 - Math.pow(0.02, dt));
      if (Math.abs(this.y - this.home.y) < 2) { this.entering = false; this.nextPhase(true); }
      if (this.def.update) this.def.update(this, g, dt);
      return;
    }
    const ph = this.phase; if (!ph) return;
    this.t += dt;
    if (ph.update) ph.update(this, g, dt);
    if (this.def.update) this.def.update(this, g, dt);
    if (this.t >= ph.time) { g.fx.text(this.x, this.y - this.r - 30, 'TIMEOUT', '#aaaaaa', { size: 14 }); this.nextPhase(false); }
  }
  nextPhase(first) {
    const g = this.g;
    if (!first) {
      const ph = this.phase;
      if (ph.end) ph.end(this, g);
      const clean = this.hitsThisPhase === 0 && this.bombsThisPhase === 0;
      const frac = clamp(this.timeLeft / ph.time, 0, 1);
      const bonus = Math.floor((ph.bonus || 10000) * (0.35 + 0.65 * frac) * (clean ? 1.5 : 1) / 100) * 100;
      g.addScore(bonus, false);
      g.fx.text(g.W / 2, 260, (clean ? 'SILENCED  ' : 'PHASE CLEAR  ') + '+' + bonus, clean ? '#ffd84f' : '#ffffff', { size: 18, life: 1.6 });
      g.bullets.clear(g, true); g.lasers.length = 0;
      g.fx.addFlash(0.4, this.color); g.fx.ring(this.x, this.y, this.color, { r1: 500, w: 12, life: 0.8 }); g.fx.addShake(6);
      g.audio.sfx('phase');
      g.fx.burst(this.x, this.y, 30, this.color, { spd: 300 });
    }
    this.pi++; this.t = 0; this.timers = {}; this.hitsThisPhase = 0; this.bombsThisPhase = 0; this.invuln = 1.0;
    if (this.pi >= this.phases.length) { this.startDying(); return; }
    const ph = this.phase; this.hp = ph.hp * g.diff.hp; this.maxhp = this.hp;
    if (ph.start) ph.start(this, g);
    if (ph.name) g.banner(ph.name, null, 1.8, true);
  }
  damage(dmg) {
    if (this.entering || this.dying > 0 || this.invuln > 0 || this.dead) return;
    this.hp -= dmg; this.flash = 0.05;
    if (this.hp <= 0) this.nextPhase(false);
  }
  startDying() {
    const g = this.g; this.dying = 0.001; g.bossDying = true;
    g.bullets.clear(g, true); g.lasers.length = 0; g.enemies.length = 0;
    g.audio.sfx('bossdie'); g.fx.addShake(16); g.fx.addFlash(0.8, '#ffffff');
    g.mult = Math.min(g.maxMult, g.mult + 1);
  }
  updateDying(dt) {
    const g = this.g; this.dying += dt;
    if (g.rng.chance(0.5)) { const a = g.rng.range(0, TAU), rr = g.rng.range(0, this.r); g.fx.burst(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 10, g.rng.chance(0.5) ? this.color : '#ffffff', { spd: 200, life: 0.8, size: 4 }); }
    if (Math.floor(this.dying * 4) !== Math.floor((this.dying - dt) * 4)) { g.fx.ring(this.x, this.y, this.color, { r1: 200 }); g.audio.sfx('bigkill'); g.fx.addShake(4); }
    this.x += g.rng.range(-3, 3); this.y += g.rng.range(-3, 3);
    if (this.dying > 2.6 && !this.dead) {
      this.dead = true; g.fx.burst(this.x, this.y, 160, this.color, { spd: 500, life: 1.6, size: 5 }); g.fx.burst(this.x, this.y, 80, '#ffffff', { spd: 320, life: 1.2, size: 3 });
      g.fx.ring(this.x, this.y, '#ffffff', { r1: 900, w: 40, life: 1.4 }); g.fx.addFlash(1, '#ffffff'); g.fx.addShake(20);
      for (let i = 0; i < 24; i++) g.items.spawn(this.x + g.rng.range(-60, 60), this.y + g.rng.range(-40, 40), i % 6 === 0 ? 'big' : 'score', { vy: g.rng.range(-260, -80) });
      g.onBossDefeated(this);
    }
  }
  // helpers for phase authors
  hover(dt, amp = 120, spd = 0.7, yamp = 20) {
    const tx = this.home.x + Math.sin(this.tt * spd) * amp, ty = this.home.y + Math.sin(this.tt * spd * 1.7) * yamp;
    this.glide(tx, ty, dt, 2.5);
  }
  glide(tx, ty, dt, k = 3) { const f = 1 - Math.pow(0.001, dt * k / 6); this.x += (tx - this.x) * f; this.y += (ty - this.y) * f; }
  wander(g, dt, interval = 2.2, xr = 170, yr = [90, 220], k = 3) {
    if (!this.data.wt || (this.data.wt -= dt) <= 0) { this.data.wt = interval; this.data.wx = g.W / 2 + g.rng.range(-xr, xr); this.data.wy = g.rng.range(yr[0], yr[1]); }
    this.glide(this.data.wx, this.data.wy, dt, k);
  }
  draw(ctx) {
    const g = this.g;
    ctx.save(); ctx.translate(this.x, this.y);
    if (this.dying > 0) { const k = this.dying / 2.6; ctx.globalAlpha = 1 - k * 0.7; ctx.scale(1 + k * 0.4, 1 + k * 0.4); }
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, this.r * 2.4); gr.addColorStop(0, rgba(this.color, 0.4)); gr.addColorStop(1, rgba(this.color, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, this.r * 2.4, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this.def.draw(this, ctx, this.flash > 0 ? '#ffffff' : this.color, this.color2);
    ctx.restore();
    if (this.invuln > 0 && !this.entering && this.dying <= 0) { ctx.globalAlpha = 0.3; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 10 + this.invuln * 30, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
  }
}

// ---------- shared drawing bits ----------
function core(ctx, r, c, c2, t) {
  ctx.fillStyle = rgba(c, 0.9); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.85 + Math.sin(t * 6) * 0.1); ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, TAU); ctx.fill();
  ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, TAU); ctx.stroke();
}
function ringSeg(ctx, r, w, c, a0, a1) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke(); }

// =====================================================================
// 1. CINDER WARDEN — Ember Shoals
// =====================================================================
export function cinderWarden(g) {
  return new Boss(g, {
    name: 'CINDER WARDEN', title: 'Keeper of the Burnt Orbit', r: 44, color: '#ff7a2a', color2: '#ffd9a8',
    draw(b, ctx, c, c2) {
      const t = b.spin, r = b.r;
      ctx.save(); ctx.rotate(t * 0.4);
      ctx.fillStyle = rgba('#3a1a10', 0.95); ctx.strokeStyle = c; ctx.lineWidth = 3; poly(ctx, ngon(8, r));
      for (let i = 0; i < 4; i++) { ctx.rotate(PI / 2); ctx.fillStyle = rgba(c, 0.9); ctx.strokeStyle = c2; ctx.lineWidth = 1.5; poly(ctx, [[r * 0.75, -8], [r * 1.25, -6], [r * 1.25, 6], [r * 0.75, 8]]); }
      ctx.restore();
      ctx.save(); ctx.rotate(-t * 0.9); ringSeg(ctx, r * 0.7, 4, c2, 0, PI * 0.6); ringSeg(ctx, r * 0.7, 4, c2, PI, PI * 1.6); ctx.restore();
      core(ctx, r * 0.42, c, c2, t);
    },
    phases: [
      { name: 'SLAG SPIRAL', hp: 520, time: 40, bonus: 12000,
        update(b, g, dt) {
          b.hover(dt, 110, 0.5);
          const dir = Math.floor(b.t / 3) % 2 ? -1 : 1;
          if (P.every(b, 'sp', 0.09, dt)) { b.data.a = (b.data.a || 0) + 0.31 * dir; P.spiralStep(g, b.x, b.y, { arms: 4, ang: b.data.a, spd: 135, r: 4, color: g.pal.b1 }); }
          if (P.every(b, 'fan', 1.7, dt)) P.fan(g, b.x, b.y + 20, { n: 5, spread: 0.5, spd: 230, kind: 'shard', r: 4, color: g.pal.b2 });
        } },
      { name: 'CINDER RAIN', hp: 620, time: 45, bonus: 14000,
        start(b, g) { g.level.spawnAsteroid(g, g.W * 0.3, -40); g.level.spawnAsteroid(g, g.W * 0.7, -40); },
        update(b, g, dt) {
          b.wander(g, dt, 2.6, 160, [100, 180]);
          if (P.every(b, 'rain', 0.75, dt)) { P.curtain(g, { n: 11, gapW: 110, gapAt: g.player.x + g.rng.range(-80, 80), spd: 120, r: 4, color: g.pal.b1, kind: 'orb' }); }
          if (P.every(b, 'fan', 1.1, dt)) P.fan(g, b.x, b.y + 20, { n: 7, spread: 1.1, spd: 190, kind: 'shard', r: 4, color: g.pal.b2, accel: 60 });
          if (P.every(b, 'ast', 6, dt)) g.level.spawnAsteroid(g, g.rng.range(80, g.W - 80), -40);
        } },
      { name: 'FURNACE BLOOM', hp: 700, time: 45, bonus: 16000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.sin(b.t * 0.9) * 170, 160, dt, 3);
          if (P.every(b, 'seed', 1.05, dt)) { for (let i = 0; i < 3; i++) P.seed(g, b.x, b.y, { ang: PI / 2 + (i - 1) * 0.6, spd: 150, fuse: 1.15 + i * 0.1, r: 8, color: g.pal.b2, child: { n: 10, spd: 130, kind: 'shard', r: 3.5, color: g.pal.b1 } }); }
          if (P.every(b, 'ring', 2.2, dt)) P.ring(g, b.x, b.y, { n: 22, spd: 95, r: 5, kind: 'big', color: g.pal.b1, accel: 30 });
        } },
      { name: 'MELTDOWN', hp: 760, time: 50, bonus: 22000,
        start(b, g) {
          b.data.l1 = P.laser(g, { x: b.x, y: b.y, ang: PI / 2, warn: 1.4, dur: 60, w: 22, turn: 0.42, follow: b, color: '#ff9a3a' });
          b.data.l2 = P.laser(g, { x: b.x, y: b.y, ang: -PI / 2, warn: 1.4, dur: 60, w: 22, turn: 0.42, follow: b, color: '#ff9a3a' });
        },
        update(b, g, dt) {
          b.glide(g.W / 2, 220 + Math.sin(b.t * 0.5) * 40, dt, 2);
          if (P.every(b, 'ring', 1.6, dt)) P.ring(g, b.x, b.y, { n: 18, spd: 80, r: 5, kind: 'orb', color: g.pal.b1, ang: b.t });
          if (P.every(b, 'aim', 0.8, dt)) P.fan(g, b.x, b.y, { n: 3, spread: 0.25, spd: 260, kind: 'needle', r: 3.5, color: g.pal.b2 });
          if (b.t > 22 && P.every(b, 'ember', 0.5, dt)) P.spray(g, g.rng.range(0, g.W), -10, { n: 3, ang: PI / 2, arc: 0.6, spd: 60, spd1: 140, r: 4, color: g.pal.b2, kind: 'shard' });
        },
        end(b, g) { g.lasers.length = 0; } },
    ],
  });
}

// =====================================================================
// 2. LEVIATHAN CHOIR — Glass Tide (a serpent with trailing segments)
// =====================================================================
export function leviathan(g) {
  const SEG = 11;
  return new Boss(g, {
    name: 'LEVIATHAN CHOIR', title: 'Voice Beneath the Ice', r: 34, color: '#7be0ff', color2: '#e6fbff',
    parts(b) { b.data.trail = []; b.data.segs = Array.from({ length: SEG }, () => ({ x: b.x, y: b.y - 40 })); return true; },
    update(b, g, dt) {
      const tr = b.data.trail; tr.unshift({ x: b.x, y: b.y }); if (tr.length > 400) tr.pop();
      // each segment sits ~14 samples behind previous along the trail
      let idx = 0;
      for (let i = 0; i < SEG; i++) { idx += 9; const p = tr[Math.min(tr.length - 1, idx)]; b.data.segs[i].x = p.x; b.data.segs[i].y = p.y; }
      b.hitboxes = b.data.segs.map((s, i) => ({ x: s.x, y: s.y, r: 22 - i * 0.9 }));
    },
    draw(b, ctx, c, c2) {
      const t = b.spin;
      ctx.save(); ctx.translate(-b.x, -b.y);
      for (let i = SEG - 1; i >= 0; i--) {
        const s = b.data.segs[i], r = 22 - i * 0.9;
        ctx.fillStyle = rgba(i % 2 ? '#1c3b5a' : c, 0.9); ctx.strokeStyle = c2; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = rgba('#ffffff', 0.5); ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.35 + Math.sin(t * 5 + i) * 1.5, 0, TAU); ctx.fill();
        if (i === SEG - 1) { ctx.strokeStyle = c2; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(t * 3) * 30, s.y + 40); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - Math.cos(t * 3) * 30, s.y + 40); ctx.stroke(); }
      }
      ctx.restore();
      // head
      ctx.save(); ctx.rotate(b.data.headAng ?? PI / 2);
      ctx.fillStyle = rgba('#1c3b5a', 0.95); ctx.strokeStyle = c; ctx.lineWidth = 3;
      poly(ctx, [[b.r * 1.3, 0], [b.r * 0.4, -b.r * 0.9], [-b.r * 0.8, -b.r * 0.7], [-b.r, 0], [-b.r * 0.8, b.r * 0.7], [b.r * 0.4, b.r * 0.9]]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.r * 0.5, -b.r * 0.35, 5, 0, TAU); ctx.arc(b.r * 0.5, b.r * 0.35, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(b.r * 0.55, -b.r * 0.35, 2.5, 0, TAU); ctx.arc(b.r * 0.55, b.r * 0.35, 2.5, 0, TAU); ctx.fill();
      // crest
      ctx.strokeStyle = c2; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-b.r * 0.2 - i * 8, -b.r * 0.6); ctx.lineTo(-b.r * 0.5 - i * 10, -b.r * 1.3 + Math.sin(t * 4 + i) * 4); ctx.stroke(); }
      ctx.restore();
    },
    phases: [
      { name: 'GLASS WAVES', hp: 620, time: 45, bonus: 14000,
        update(b, g, dt) {
          const px = b.x, py = b.y;
          const tx = g.W / 2 + Math.sin(b.t * 0.9) * 200, ty = 140 + Math.sin(b.t * 1.8) * 70;
          b.glide(tx, ty, dt, 6); b.data.headAng = angTo(px, py, b.x, b.y) || b.data.headAng;
          if (P.every(b, 'w', 0.55, dt)) { for (let i = 1; i < SEG; i += 2) { const s = b.data.segs[i]; P.fan(g, s.x, s.y, { n: 2, spread: PI, ang: 0, spd: 150, kind: 'needle', r: 3.5, color: g.pal.b1, bounces: 1 }); } }
          if (P.every(b, 'aim', 1.4, dt)) P.fan(g, b.x, b.y, { n: 5, spread: 0.8, spd: 210, kind: 'orb', r: 4, color: g.pal.b2 });
        } },
      { name: 'FROST BREATH', hp: 700, time: 45, bonus: 16000,
        update(b, g, dt) {
          b.wander(g, dt, 3, 180, [100, 200], 2);
          b.data.headAng = P.aimAt(g, b.x, b.y);
          if (P.every(b, 'br', 0.08, dt) && b.t % 4 < 2.2) P.single(g, b.x, b.y, { off: g.rng.range(-0.35, 0.35), spd: 260, accel: -110, minSpd: 40, kind: 'bubble', r: 7, color: g.pal.b1 });
          if (P.every(b, 'needle', 0.6, dt) && b.t % 4 >= 2.2) P.fan(g, b.x, b.y, { n: 6, spread: 1.3, spd: 300, kind: 'needle', r: 3.5, color: g.pal.b2, bounces: 1 });
          if (P.every(b, 'ring', 2.5, dt)) P.ring(g, b.x, b.y, { n: 16, spd: 110, kind: 'ring', r: 5, color: g.pal.b2, wave: 12, waveFreq: 5 });
        } },
      { name: 'SHATTER SONG', hp: 760, time: 45, bonus: 18000,
        update(b, g, dt) {
          const px = b.x, py = b.y;
          b.glide(g.W / 2 + Math.cos(b.t * 0.6) * 190, 130 + Math.sin(b.t * 1.2) * 50, dt, 5); b.data.headAng = angTo(px, py, b.x, b.y) || b.data.headAng;
          if (P.every(b, 'sh', 1.3, dt)) { for (let i = 0; i < 3; i++) P.seed(g, b.x, b.y, { ang: PI / 2 + (i - 1) * 0.75, spd: 170, fuse: 0.9, r: 8, kind: 'big', color: g.pal.b2, child: { n: 7, spd: 160, kind: 'shard', r: 3.5, color: g.pal.b1 } }); }
          if (P.every(b, 'mir', 0.35, dt)) { const s = b.data.segs[SEG - 1]; P.fan(g, s.x, s.y, { n: 2, spread: 0.5, spd: 190, kind: 'needle', r: 3.5, color: g.pal.b1, bounces: 2 }); }
        } },
      { name: 'TIDAL REQUIEM', hp: 900, time: 55, bonus: 24000,
        update(b, g, dt) {
          const a = b.t * 0.85, px = b.x, py = b.y;
          b.glide(g.W / 2 + Math.cos(a) * 180, 230 + Math.sin(a) * 130, dt, 8); b.data.headAng = angTo(px, py, b.x, b.y) || b.data.headAng;
          if (P.every(b, 'las', 4.5, dt)) P.laser(g, { x: b.x, y: b.y, ang: b.data.headAng, warn: 1.0, dur: 1.3, w: 20, turn: 0.5, follow: b, color: '#a8ecff' });
          if (P.every(b, 'sp', 0.14, dt)) { const s = b.data.segs[SEG - 1]; b.data.ta = (b.data.ta || 0) + 0.4; P.spiralStep(g, s.x, s.y, { arms: 3, ang: b.data.ta, spd: 120, r: 4, color: g.pal.b1 }); }
          if (P.every(b, 'ring', 2.8, dt)) P.ring(g, b.x, b.y, { n: 24, spd: 140, kind: 'needle', r: 3.5, color: g.pal.b2, bounces: 1 });
        }, end(b, g) { g.lasers.length = 0; } },
    ],
  });
}

// =====================================================================
// 3. MOTHER ROOT — The Bloom
// =====================================================================
export function motherRoot(g) {
  return new Boss(g, {
    name: 'MOTHER ROOT', title: 'The Garden That Eats', r: 48, color: '#ff5fb0', color2: '#c6ff8a',
    draw(b, ctx, c, c2) {
      const t = b.spin, r = b.r, open = 0.5 + Math.sin(t * 0.8) * 0.5;
      ctx.save(); ctx.rotate(t * 0.15);
      for (let i = 0; i < 6; i++) {
        ctx.rotate(TAU / 6);
        const L = r * (0.9 + open * 0.5);
        ctx.fillStyle = rgba(c, 0.85); ctx.strokeStyle = c2; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.6, -r * 0.55, L, 0); ctx.quadraticCurveTo(L * 0.6, r * 0.55, 0, 0); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = rgba('#ffffff', 0.5); ctx.beginPath(); ctx.moveTo(r * 0.2, 0); ctx.lineTo(L * 0.85, 0); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = rgba('#2c5a1d', 0.95); ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 7; i++) { const a = t * 1.5 + (i / 7) * TAU; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 3, 0, TAU); ctx.fill(); }
      core(ctx, r * 0.22, c2, '#fff', t);
    },
    phases: [
      { name: 'POLLEN DRIFT', hp: 680, time: 45, bonus: 15000,
        update(b, g, dt) {
          b.hover(dt, 140, 0.45, 25);
          if (P.every(b, 'pol', 0.11, dt)) P.spray(g, b.x, b.y, { n: 2, ang: PI / 2, arc: 2.4, spd: 60, spd1: 130, r: 3.5, color: g.pal.b1, wave: 14, waveFreq: 3 });
          if (P.every(b, 'pod', 5, dt)) g.spawnEnemy('seedpod', g.rng.range(80, g.W - 80), -30, { seq: [{ vy: 40, dur: 20 }] });
          if (P.every(b, 'fan', 1.6, dt)) P.fan(g, b.x, b.y, { n: 3, spread: 0.3, spd: 220, kind: 'knife', r: 4, color: g.pal.b2 });
        } },
      { name: 'SEEDBURST', hp: 760, time: 45, bonus: 17000,
        update(b, g, dt) {
          b.wander(g, dt, 2.4, 170, [110, 200]);
          if (P.every(b, 'seed', 0.7, dt)) P.seed(g, b.x, b.y, { spd: 200, fuse: 1.0, r: 9, kind: 'big', color: g.pal.b2, child: { n: 12, spd: 110, r: 3.5, color: g.pal.b1, accel: 25 } });
          if (P.every(b, 'ring', 2.1, dt)) P.ring(g, b.x, b.y, { n: 14, spd: 120, kind: 'orb', r: 4, color: g.pal.b1, turn: 0.35, ang: b.t });
        } },
      { name: 'VINE LASH', hp: 820, time: 50, bonus: 19000,
        update(b, g, dt) {
          b.glide(g.W / 2, 170, dt, 2);
          if (P.every(b, 'vine', 3.2, dt)) {
            const n = 5, base = g.rng.range(0, TAU);
            for (let i = 0; i < n; i++) P.laser(g, { x: b.x, y: b.y, ang: base + (i / n) * TAU, warn: 1.1, dur: 1.4, w: 16, turn: 0.35 * (i % 2 ? 1 : -1), follow: b, color: '#c6ff8a' });
            g.audio.sfx('warn');
          }
          if (P.every(b, 'aim', 0.5, dt)) P.fan(g, b.x, b.y, { n: 2, spread: 0.2, spd: 250, kind: 'needle', r: 3.5, color: g.pal.b2 });
          if (P.every(b, 'pol', 0.3, dt)) P.spray(g, b.x, b.y, { n: 2, ang: PI / 2, arc: 2.8, spd: 70, spd1: 110, r: 4, color: g.pal.b1 });
        }, end(b, g) { g.lasers.length = 0; } },
      { name: 'FULL BLOOM', hp: 960, time: 60, bonus: 26000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.sin(b.t * 0.5) * 120, 150, dt, 2);
          if (P.every(b, 'petal', 0.42, dt)) { b.data.k = (b.data.k || 0) + 1; const dir = b.data.k % 2 ? 1 : -1; P.ring(g, b.x, b.y, { n: 16, spd: 150, kind: 'orb', r: 4.5, color: dir > 0 ? g.pal.b1 : g.pal.b2, turn: 0.9 * dir, accel: -40, minSpd: 55, ang: b.data.k * 0.2 }); }
          if (P.every(b, 'cloud', 4, dt)) g.level.spawnSpore(g, g.rng.range(80, g.W - 80), g.rng.range(300, 700));
          if (b.t > 20 && P.every(b, 'seed', 1.8, dt)) P.seed(g, b.x, b.y, { spd: 180, fuse: 1.3, r: 9, kind: 'big', color: g.pal.b2, child: { n: 14, spd: 100, r: 3.5, color: g.pal.b1, aim: true } });
        } },
    ],
  });
}

// =====================================================================
// 4. THE ARCHIVIST — Cathedral of Static
// =====================================================================
export function archivist(g) {
  return new Boss(g, {
    name: 'THE ARCHIVIST', title: 'Index of Every Ending', r: 40, color: '#b56bff', color2: '#e9d7ff',
    draw(b, ctx, c, c2) {
      const t = b.spin, r = b.r;
      // rotating nested squares
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(t * (0.6 + i * 0.3) * (i % 2 ? -1 : 1)); const rr = r * (1.2 - i * 0.3);
        ctx.strokeStyle = i === 1 ? c2 : c; ctx.lineWidth = 2; ctx.fillStyle = rgba('#17102a', i === 2 ? 0.95 : 0.4);
        poly(ctx, ngon(4, rr, PI / 4)); ctx.restore();
      }
      // orbiting data nodes
      for (let i = 0; i < 6; i++) { const a = t * 2 + (i / 6) * TAU; const x = Math.cos(a) * r * 1.35, y = Math.sin(a) * r * 1.35 * 0.5; ctx.fillStyle = i % 2 ? c2 : '#fff'; ctx.fillRect(x - 3, y - 3, 6, 6); }
      // glitch bars
      if (Math.sin(t * 13) > 0.7) { ctx.fillStyle = rgba(c2, 0.5); ctx.fillRect(-r, (Math.sin(t * 40) * r) | 0, r * 2, 3); }
      core(ctx, r * 0.35, c, c2, t);
      ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(((b.hp / b.maxhp) * 100 | 0).toString().padStart(3, '0'), 0, 0);
    },
    phases: [
      { name: 'INDEX', hp: 720, time: 45, bonus: 16000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.sin(b.t * 0.7) * 100, 140, dt, 2);
          if (P.every(b, 'row', 0.85, dt)) { b.data.k = (b.data.k || 0) + 1; const gap = ((b.data.k * 137) % (g.W - 160)) + 80; P.curtain(g, { n: 12, gapAt: gap, gapW: 100, spd: 140, kind: 'needle', r: 3.5, color: g.pal.b1 }); }
          if (P.every(b, 'aim', 1.1, dt)) P.fan(g, b.x, b.y, { n: 4, spread: 0.5, spd: 220, kind: 'star', r: 5, color: g.pal.b2 });
        } },
      { name: 'REDACTION', hp: 800, time: 50, bonus: 18000,
        update(b, g, dt) {
          b.glide(g.W / 2, 130, dt, 2);
          if (P.every(b, 'grid', 3.6, dt)) {
            const vert = (b.data.k = (b.data.k || 0) + 1) % 2 === 0;
            if (vert) { const gap = Math.floor(g.rng.range(0, 5)); for (let i = 0; i < 5; i++) { if (i === gap) continue; P.laser(g, { x: 60 + i * 105, y: -10, ang: PI / 2, len: 1000, warn: 1.3, dur: 0.9, w: 26, color: '#d9a8ff' }); } }
            else { const gap = Math.floor(g.rng.range(1, 5)); for (let i = 0; i < 5; i++) { if (i === gap) continue; P.laser(g, { x: -10, y: 250 + i * 130, ang: 0, len: 600, warn: 1.3, dur: 0.9, w: 26, color: '#d9a8ff' }); } }
          }
          if (P.every(b, 'orb', 0.6, dt)) P.ring(g, b.x, b.y, { n: 8, spd: 120, kind: 'orb', r: 4.5, color: g.pal.b1, ang: b.t * 1.3 });
        }, end(b, g) { g.lasers.length = 0; } },
      { name: 'CORRUPTION', hp: 860, time: 50, bonus: 20000,
        update(b, g, dt) {
          b.wander(g, dt, 1.8, 180, [100, 220], 5);
          if (P.every(b, 'gl', 0.5, dt)) P.fan(g, b.x, b.y, { n: 5, spread: 1.4, spd: 150, kind: 'star', r: 5, color: g.pal.b2, onUpdate: (bb, g2, d) => { bb.data = (bb.data || 0) + d; if (bb.data > 0.55) { bb.data = 0; bb.x += g2.rng.range(-35, 35); bb.y += g2.rng.range(-20, 20); g2.fx.spark(bb.x, bb.y, 0, 1, '#fff', { spd: 60, life: 0.15 }); } } });
          if (P.every(b, 'kn', 6, dt)) { for (let i = -1; i <= 1; i += 2) g.spawnEnemy('knight', g.W / 2 + i * 170, -30, { shield: true, seq: [{ x: g.W / 2 + i * 170, y: 320, dur: 2 }, { hold: 9 }, { x: g.W / 2 + i * 170, y: -60, dur: 2 }] }); }
          if (P.every(b, 'rows', 1.4, dt)) P.fan(g, b.x, b.y, { n: 9, spread: 2.6, ang: PI / 2, spd: 110, kind: 'needle', r: 3.5, color: g.pal.b1, accel: 40 });
        } },
      { name: 'OVERWRITE', hp: 900, time: 50, bonus: 22000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.cos(b.t * 0.5) * 150, 150, dt, 2);
          if (P.every(b, 'amb', 1.5, dt)) { const px = g.player.x, py = g.player.y; g.audio.sfx('glitch'); P.ring(g, px, py, { n: 12, spd: 160, kind: 'orb', r: 4, color: g.pal.b2, delay: 0.9, noScale: true }); }
          if (P.every(b, 'sp', 0.1, dt)) { b.data.a = (b.data.a || 0) + 0.27; P.spiralStep(g, b.x, b.y, { arms: 3, ang: b.data.a, spd: 140, kind: 'needle', r: 3.5, color: g.pal.b1 }); }
        } },
      { name: 'NULL SWEEP', hp: 980, time: 60, bonus: 28000,
        start(b, g) { b.data.l = P.laser(g, { x: b.x, y: b.y, ang: PI / 2, warn: 1.5, dur: 80, w: 34, turn: 0.55, follow: b, color: '#e9d7ff' }); },
        update(b, g, dt) {
          b.glide(g.W / 2, 180, dt, 1.5);
          if (P.every(b, 'chase', 0.9, dt)) P.fan(g, b.x, b.y, { n: 3, spread: 0.4, spd: 170, kind: 'star', r: 5, color: g.pal.b2, home: 1.2, homeTime: 1.5 });
          if (P.every(b, 'ring', 2, dt)) P.ring(g, b.x, b.y, { n: 20, spd: 90, kind: 'orb', r: 4, color: g.pal.b1, ang: b.t * 2 });
          if (b.t > 25 && b.data.l && !b.data.l2) b.data.l2 = P.laser(g, { x: b.x, y: b.y, ang: -PI / 2, warn: 1.5, dur: 60, w: 30, turn: 0.55, follow: b, color: '#e9d7ff' });
        }, end(b, g) { g.lasers.length = 0; } },
    ],
  });
}

// =====================================================================
// 5. UMBRA TWINS — Grave of Suns (two bodies orbiting a shared centre)
// =====================================================================
export function umbraTwins(g) {
  return new Boss(g, {
    name: 'UMBRA TWINS', title: 'Sol & Nox, the Last Binary', r: 30, color: '#ffd166', color2: '#b08cff',
    parts(b) { b.data.sol = { x: b.x - 90, y: b.y }; b.data.nox = { x: b.x + 90, y: b.y }; b.data.orb = 0; b.data.rad = 110; b.data.spdOrb = 0.9; return true; },
    update(b, g, dt) {
      b.data.orb += dt * b.data.spdOrb;
      const rr = b.data.rad, s = b.data.sol, n = b.data.nox;
      s.x = b.x + Math.cos(b.data.orb) * rr; s.y = b.y + Math.sin(b.data.orb) * rr * 0.55;
      n.x = b.x - Math.cos(b.data.orb) * rr; n.y = b.y - Math.sin(b.data.orb) * rr * 0.55;
      b.hitboxes = [{ x: s.x, y: s.y, r: 30 }, { x: n.x, y: n.y, r: 30 }];
      if (g.level && g.level.wells && g.level.wells[0]) { g.level.wells[0].x = b.x; g.level.wells[0].y = b.y; }
    },
    draw(b, ctx, c, c2) {
      const t = b.spin, s = b.data.sol, n = b.data.nox;
      ctx.save(); ctx.translate(-b.x, -b.y);
      // centre singularity
      ctx.strokeStyle = rgba('#ffffff', 0.15); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(b.x, b.y, b.data.rad, b.data.rad * 0.55, 0, 0, TAU); ctx.stroke();
      const body = (p, col, col2, corona) => {
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 70); gr.addColorStop(0, rgba(col, 0.5)); gr.addColorStop(1, rgba(col, 0)); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.rotate(t * (corona ? 0.7 : -0.7));
        ctx.strokeStyle = col2; ctx.lineWidth = 2;
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, L = 30 + (i % 2 ? 10 : 4) + Math.sin(t * 6 + i) * 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke(); }
        ctx.fillStyle = b.flash > 0 ? '#fff' : rgba(col, 0.95); ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.fill();
        ctx.fillStyle = corona ? '#fff' : '#1a0a2a'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
        ctx.restore();
      };
      body(s, '#ffd166', '#fff2c2', true); body(n, '#6b3fd1', '#c9b3ff', false);
      ctx.restore();
    },
    phases: [
      { name: 'BINARY', hp: 780, time: 45, bonus: 17000,
        start(b, g) { g.level.setWell(g, b.x, b.y, 1); },
        update(b, g, dt) {
          b.glide(g.W / 2, 230, dt, 2); b.data.spdOrb = 0.9;
          if (P.every(b, 'sol', 1.3, dt)) P.ring(g, b.data.sol.x, b.data.sol.y, { n: 14, spd: 150, kind: 'orb', r: 4.5, color: '#ffd166', ang: b.t });
          if (P.every(b, 'nox', 1.3, dt) && b.t > 0.65) P.ring(g, b.data.nox.x, b.data.nox.y, { n: 14, spd: 150, kind: 'star', r: 4.5, color: '#b08cff', ang: -b.t });
        } },
      { name: 'ECLIPSE', hp: 860, time: 45, bonus: 19000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.sin(b.t * 0.6) * 120, 200, dt, 2); b.data.spdOrb = 0.6;
          const front = b.data.sol.y > b.data.nox.y ? b.data.sol : b.data.nox, back = front === b.data.sol ? b.data.nox : b.data.sol;
          if (P.every(b, 'aim', 0.55, dt)) P.fan(g, front.x, front.y, { n: 3, spread: 0.35, spd: 240, kind: 'needle', r: 3.5, color: front === b.data.sol ? '#ffd166' : '#b08cff' });
          if (P.every(b, 'slow', 0.9, dt)) P.ring(g, back.x, back.y, { n: 10, spd: 70, kind: 'big', r: 7, color: back === b.data.sol ? '#ffd166' : '#b08cff', grav: 2.2 });
        } },
      { name: 'TIDAL LOCK', hp: 920, time: 50, bonus: 22000,
        start(b, g) { b.data.link = P.laser(g, { x: 0, y: 0, ang: 0, warn: 1.5, dur: 80, w: 18, len: 260, color: '#ffffff' }); },
        update(b, g, dt) {
          b.glide(g.W / 2, 260 + Math.sin(b.t * 0.4) * 60, dt, 2); b.data.spdOrb = 1.15; b.data.rad = 130;
          const L = b.data.link; if (L) { L.x = b.data.sol.x; L.y = b.data.sol.y; L.ang = angTo(L.x, L.y, b.data.nox.x, b.data.nox.y); L.len = dist(L.x, L.y, b.data.nox.x, b.data.nox.y); }
          if (P.every(b, 'spray', 0.25, dt)) { P.spray(g, b.data.sol.x, b.data.sol.y, { n: 2, arc: 0.8, spd: 120, spd1: 200, r: 4, color: '#ffd166' }); P.spray(g, b.data.nox.x, b.data.nox.y, { n: 2, arc: 0.8, spd: 120, spd1: 200, r: 4, kind: 'star', color: '#b08cff' }); }
          if (P.every(b, 'cur', 2.4, dt)) P.curtain(g, { n: 10, gapW: 120, spd: 100, r: 4, color: '#d0c0ff', grav: 0 });
        }, end(b, g) { g.lasers.length = 0; b.data.link = null; b.data.rad = 110; } },
      { name: 'SUPERNOVA', hp: 1050, time: 60, bonus: 30000,
        start(b, g) { g.level.setWell(g, b.x, b.y, -1); },
        update(b, g, dt) {
          b.glide(g.W / 2, 240, dt, 2);
          const cyc = b.t % 5;
          b.data.rad = cyc < 3 ? lerp(b.data.rad, 20, dt * 2) : lerp(b.data.rad, 130, dt * 3); b.data.spdOrb = cyc < 3 ? 3.5 : 0.8;
          if (cyc >= 3 && cyc < 3.1 && !b.data.fired) { b.data.fired = true; g.fx.addFlash(0.6, '#fff'); g.fx.addShake(8); g.audio.sfx('bigkill');
            for (let k = 0; k < 3; k++) P.ring(g, b.x, b.y, { n: 26, spd: 40 + k * 30, accel: 120, maxSpd: 330, kind: k === 1 ? 'star' : 'orb', r: 4.5, color: k === 1 ? '#b08cff' : '#ffd166', ang: k * 0.08, grav: 0 }); }
          if (cyc < 3) b.data.fired = false;
          if (P.every(b, 'aim', 0.7, dt)) P.fan(g, b.x, b.y, { n: 4, spread: 0.6, spd: 200, kind: 'needle', r: 3.5, color: '#ffffff', grav: 0 });
        }, end(b, g) { g.level.setWell(g, 0, 0, 0); } },
    ],
  });
}

// =====================================================================
// 6. CHRONARCH — Hourglass Reach
// =====================================================================
export function chronarch(g) {
  return new Boss(g, {
    name: 'CHRONARCH', title: 'Warden of the Stopped Hour', r: 42, color: '#ffc14d', color2: '#7ff5e8',
    draw(b, ctx, c, c2) {
      const t = b.spin, r = b.r;
      ctx.strokeStyle = c2; ctx.lineWidth = 3; ctx.fillStyle = rgba('#102a2c', 0.95);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ctx.strokeStyle = i % 3 ? rgba(c2, 0.6) : c; ctx.lineWidth = i % 3 ? 1 : 2.5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82); ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); ctx.stroke(); }
      // hourglass
      ctx.fillStyle = rgba(c, 0.85); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      poly(ctx, [[-r * 0.35, -r * 0.5], [r * 0.35, -r * 0.5], [0, 0], [r * 0.35, r * 0.5], [-r * 0.35, r * 0.5], [0, 0]]);
      const sand = (Math.sin(t * 0.5) + 1) / 2;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-r * 0.3 * sand, -r * 0.5 * sand); ctx.lineTo(r * 0.3 * sand, -r * 0.5 * sand); ctx.lineTo(0, 0); ctx.fill();
      // hands
      const hand = (ang, len, w) => { ctx.strokeStyle = c2; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len); ctx.stroke(); };
      hand(b.data.hand ?? -PI / 2, r * 0.95, 3); hand(t * 0.3 - PI / 2, r * 0.6, 4);
      ctx.fillStyle = b.flash > 0 ? '#fff' : c; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    },
    phases: [
      { name: 'SECOND HAND', hp: 800, time: 45, bonus: 18000,
        start(b, g) { b.data.hand = PI / 2; b.data.l = P.laser(g, { x: b.x, y: b.y, ang: PI / 2, warn: 1.2, dur: 80, w: 16, turn: 0.75, follow: b, color: '#7ff5e8' }); },
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.sin(b.t * 0.3) * 60, 230, dt, 1.5);
          if (b.data.l) b.data.hand = b.data.l.ang;
          if (P.every(b, 'tick', 1.0, dt)) { g.audio.sfx('tick'); P.ring(g, b.x, b.y, { n: 12, spd: 130, kind: 'ring', r: 5, color: g.pal.b1, ang: b.t * 0.5 }); }
          if (P.every(b, 'aim', 1.6, dt)) P.fan(g, b.x, b.y, { n: 5, spread: 0.7, spd: 200, kind: 'knife', r: 4, color: g.pal.b2 });
        }, end(b, g) { g.lasers.length = 0; } },
      { name: 'ECHO', hp: 880, time: 50, bonus: 20000,
        start(b, g) { b.data.rec = []; },
        update(b, g, dt) {
          b.wander(g, dt, 2.5, 160, [110, 200]);
          // record the player, spawn an echo every 3.5s that replays the path while shooting
          if (P.every(b, 'rec', 0.05, dt)) { b.data.rec.push({ x: g.player.x, y: g.player.y }); if (b.data.rec.length > 70) b.data.rec.shift(); }
          if (P.every(b, 'echo', 3.5, dt) && b.data.rec.length > 40) {
            const path = b.data.rec.slice(); g.audio.sfx('glitch');
            g.spawnEnemy('echo', path[0].x, path[0].y, { color: g.player.ship.color, color2: '#fff', despawnY: 9999,
              move: (e, g2, d) => { e.data.i = (e.data.i || 0) + d * 20; const i = Math.min(path.length - 1, e.data.i | 0); e.x = path[i].x; e.y = path[i].y; if (e.data.i >= path.length + 30) e.dead = true; },
              fire: (e, g2, d) => { if (P.every(e, 'f', 0.4, d)) P.fan(g2, e.x, e.y, { n: 3, spread: 0.4, spd: 210, kind: 'needle', r: 3.5, color: g2.pal.b2 }); } });
          }
          if (P.every(b, 'freeze', 2.2, dt)) P.ring(g, b.x, b.y, { n: 16, spd: 260, accel: -260, minSpd: 0, kind: 'orb', r: 4.5, color: g.pal.b1, ang: b.t, onUpdate: (bb, g2, d) => { if (bb.t > 2.0 && bb.accel < 0) { bb.accel = 180; bb.ang = P.aimAt(g2, bb.x, bb.y); bb.sprite = bb.sprite; } } });
        } },
      { name: 'REWIND', hp: 940, time: 50, bonus: 22000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.cos(b.t * 0.8) * 180, 200 + Math.sin(b.t * 1.6) * 60, dt, 3);
          if (P.every(b, 'rw', 0.9, dt)) P.ring(g, b.x, b.y, { n: 18, spd: 300, accel: -300, minSpd: -240, kind: 'knife', r: 4, color: g.pal.b2, ang: b.t * 0.7, life: 3.2 });
          if (P.every(b, 'aim', 0.7, dt)) P.fan(g, b.x, b.y, { n: 3, spread: 0.3, spd: 190, kind: 'orb', r: 4, color: g.pal.b1 });
        } },
      { name: 'THE STOPPED HOUR', hp: 1100, time: 60, bonus: 30000,
        start(b, g) { g.level.bubbles.length = 0; },
        update(b, g, dt) {
          b.glide(g.W / 2, 170, dt, 2);
          if (P.every(b, 'bub', 3.5, dt)) g.level.spawnBubble(g, g.rng.range(90, g.W - 90), g.rng.range(350, 760), 95, 8);
          if (P.every(b, 'sand', 0.16, dt)) { P.single(g, g.rng.range(0, g.W), -10, { ang: PI / 2, spd: 180, kind: 'needle', r: 3, color: g.pal.b1 }); }
          if (P.every(b, 'ring', 1.6, dt)) P.ring(g, b.x, b.y, { n: 20, spd: 120, kind: 'ring', r: 5, color: g.pal.b2, ang: b.t });
          if (b.t > 25 && P.every(b, 'aim', 0.9, dt)) P.fan(g, b.x, b.y, { n: 4, spread: 0.5, spd: 230, kind: 'knife', r: 4, color: g.pal.b2 });
        } },
    ],
  });
}

// =====================================================================
// 7. THE CHOIR — Choir's Heart (final)
// =====================================================================
export function theChoir(g) {
  return new Boss(g, {
    name: 'THE CHOIR', title: 'The Song That Ends Worlds', r: 56, color: '#ff3b5c', color2: '#ffffff',
    draw(b, ctx, c, c2) {
      const t = b.spin, r = b.r, beat = g.level.beatK ? g.level.beatK() : 0;
      ctx.save(); ctx.scale(1 + beat * 0.08, 1 + beat * 0.08);
      // mouths / rings of voices
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(t * (0.3 + i * 0.25) * (i % 2 ? -1 : 1));
        const rr = r * (1.25 - i * 0.28); ctx.strokeStyle = i === 1 ? c2 : c; ctx.lineWidth = 2 + i;
        ctx.beginPath(); for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, a2 = ((k + 0.5) / 9) * TAU; ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.quadraticCurveTo(Math.cos((a + a2) / 2) * rr * 0.8, Math.sin((a + a2) / 2) * rr * 0.8, Math.cos(a2) * rr, Math.sin(a2) * rr); }
        ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = rgba('#3a0612', 0.95); ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.fill();
      // heart
      ctx.fillStyle = b.flash > 0 ? '#fff' : c; ctx.beginPath();
      const h = r * 0.42; ctx.moveTo(0, h * 0.9); ctx.bezierCurveTo(-h * 1.4, -h * 0.1, -h * 0.7, -h * 1.1, 0, -h * 0.35); ctx.bezierCurveTo(h * 0.7, -h * 1.1, h * 1.4, -h * 0.1, 0, h * 0.9); ctx.fill();
      ctx.strokeStyle = c2; ctx.lineWidth = 1.5; ctx.stroke();
      // eyes
      ctx.fillStyle = '#fff'; for (let i = 0; i < 5; i++) { const a = t * 0.5 + (i / 5) * TAU; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 5, 2.5 + beat * 3, a, 0, TAU); ctx.fill(); }
      ctx.restore();
    },
    phases: [
      { name: 'FIRST VERSE', hp: 800, time: 45, bonus: 20000,
        update(b, g, dt) {
          b.hover(dt, 90, 0.5, 15);
          if (g.level.onBeat) { P.ring(g, b.x, b.y, { n: 24, spd: 110, kind: 'orb', r: 4.5, color: g.pal.b1, ang: b.t * 0.3 }); }
          if (P.every(b, 'aim', 0.7, dt)) P.fan(g, b.x, b.y, { n: 3, spread: 0.35, spd: 230, kind: 'needle', r: 3.5, color: g.pal.b2 });
        } },
      { name: 'EMBER REPRISE', hp: 880, time: 45, bonus: 22000,
        update(b, g, dt) {
          b.wander(g, dt, 2.5, 150, [110, 190]);
          if (P.every(b, 'sp', 0.08, dt)) { b.data.a = (b.data.a || 0) + 0.29; P.spiralStep(g, b.x, b.y, { arms: 5, ang: b.data.a, spd: 140, r: 4, color: '#ff7a2a' }); }
          if (P.every(b, 'seed', 1.6, dt)) P.seed(g, b.x, b.y, { spd: 160, fuse: 1.1, r: 9, kind: 'big', color: '#ffd9a8', child: { n: 10, spd: 130, kind: 'shard', r: 3.5, color: '#ff7a2a' } });
        } },
      { name: 'GLASS & BLOOM REPRISE', hp: 960, time: 50, bonus: 24000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.sin(b.t * 0.8) * 190, 150 + Math.sin(b.t * 1.5) * 40, dt, 5);
          if (P.every(b, 'n', 0.5, dt)) P.fan(g, b.x, b.y, { n: 6, spread: 1.4, spd: 260, kind: 'needle', r: 3.5, color: '#7be0ff', bounces: 1 });
          if (P.every(b, 'petal', 0.6, dt)) { b.data.k = (b.data.k || 0) + 1; const dir = b.data.k % 2 ? 1 : -1; P.ring(g, b.x, b.y, { n: 14, spd: 150, kind: 'orb', r: 4.5, color: '#ff5fb0', turn: 0.9 * dir, accel: -40, minSpd: 55 }); }
        } },
      { name: 'STATIC & GRAVE REPRISE', hp: 1040, time: 55, bonus: 26000,
        start(b, g) { g.level.setWell(g, g.W / 2, 420, 0.7); },
        update(b, g, dt) {
          b.glide(g.W / 2, 140, dt, 2);
          if (P.every(b, 'grid', 4, dt)) { const gap = Math.floor(g.rng.range(0, 5)); for (let i = 0; i < 5; i++) { if (i === gap) continue; P.laser(g, { x: 60 + i * 105, y: -10, ang: PI / 2, len: 1000, warn: 1.4, dur: 0.8, w: 24, color: '#d9a8ff' }); } }
          if (P.every(b, 'ring', 1.1, dt)) P.ring(g, b.x, b.y, { n: 16, spd: 130, kind: 'star', r: 4.5, color: '#ffd166', ang: b.t });
          if (P.every(b, 'amb', 2.2, dt)) { g.audio.sfx('glitch'); P.ring(g, g.player.x, g.player.y, { n: 10, spd: 150, kind: 'orb', r: 4, color: '#b56bff', delay: 1.0, noScale: true, grav: 0 }); }
        }, end(b, g) { g.lasers.length = 0; g.level.setWell(g, 0, 0, 0); } },
      { name: 'HOURGLASS REPRISE', hp: 1100, time: 55, bonus: 28000,
        update(b, g, dt) {
          b.glide(g.W / 2 + Math.cos(b.t * 0.6) * 150, 190, dt, 3);
          if (P.every(b, 'bub', 4, dt)) g.level.spawnBubble(g, g.rng.range(90, g.W - 90), g.rng.range(380, 760), 90, 7);
          if (P.every(b, 'rw', 1.0, dt)) P.ring(g, b.x, b.y, { n: 16, spd: 300, accel: -300, minSpd: -220, kind: 'knife', r: 4, color: '#ffc14d', ang: b.t * 0.7, life: 3.2 });
          if (P.every(b, 'sand', 0.2, dt)) P.single(g, g.rng.range(0, g.W), -10, { ang: PI / 2, spd: 170, kind: 'needle', r: 3, color: '#7ff5e8' });
        } },
      { name: 'SILENCE', hp: 1400, time: 75, bonus: 50000,
        start(b, g) { g.level.finale = true; g.banner('THE FINAL VERSE', 'Silence it.', 3, false); },
        update(b, g, dt) {
          b.glide(g.W / 2, 200 + Math.sin(b.t * 0.7) * 50, dt, 1.5);
          if (g.level.onBeat) { g.fx.addShake(3); P.ring(g, b.x, b.y, { n: 30, spd: 95, kind: 'big', r: 6, color: g.pal.b1, ang: b.t * 0.4 }); }
          if (P.every(b, 'cur', 1.9, dt)) P.curtain(g, { n: 13, gapW: 100, spd: 110, kind: 'orb', r: 4, color: g.pal.b2 });
          if (P.every(b, 'aim', 0.45, dt)) P.fan(g, b.x, b.y, { n: 2, spread: 0.2, spd: 280, kind: 'needle', r: 3.5, color: '#ffffff' });
          if (b.t > 30 && P.every(b, 'las', 5, dt)) { P.laser(g, { x: b.x, y: b.y, ang: P.aimAt(g, b.x, b.y) - 0.6, warn: 1.3, dur: 1.4, w: 20, turn: 0.45, follow: b, color: '#ffffff' }); }
        }, end(b, g) { g.lasers.length = 0; } },
    ],
  });
}

export const BOSS_FACTORIES = [cinderWarden, leviathan, motherRoot, archivist, umbraTwins, chronarch, theChoir];

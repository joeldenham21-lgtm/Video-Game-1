// The player's ship: three hulls, focus mode, graze, overdrive, bombs, relics.
import { TAU, PI, clamp, dist, angTo, rgba, approachAngle, lerp, ease } from './math.js';

export const SHIPS = [
  { id: 'vesper', name: 'VESPER', role: 'SPREAD', speed: 300, focusSpeed: 140, color: '#5fd9ff', color2: '#b8f0ff', hitR: 3,
    desc: 'A wide arc of shots that narrows under focus. Balanced hull.', bomb: 'NOVA · a shockwave that erases every bullet and scorches the whole screen.' },
  { id: 'lance', name: 'LANCE', role: 'PIERCE', speed: 320, focusSpeed: 125, color: '#ffb347', color2: '#fff0c8', hitR: 3,
    desc: 'A narrow piercing beam with the highest damage on the roster. Stay under your target.', bomb: 'SUNDER · a column of light that annihilates everything above you for two seconds.' },
  { id: 'wraith', name: 'WRAITH', role: 'HOMING', speed: 345, focusSpeed: 170, color: '#c77dff', color2: '#efd6ff', hitR: 2.5,
    desc: 'Seeking shots and two orbiting drones. The fastest, smallest hull. Lower raw damage.', bomb: 'PHANTOM · a swarm of homing missiles and a four-second bullet shield.' },
];

export const RELICS = [
  { id: 'heart', name: 'Ember Heart', desc: '+1 life.' },
  { id: 'charge', name: 'Spare Charge', desc: '+1 bomb now and +1 max bombs.' },
  { id: 'graze', name: 'Razor Edge', desc: 'Graze radius +50%. Overdrive charges 40% faster.' },
  { id: 'overdrive', name: 'Long Fuse', desc: 'Overdrive lasts 60% longer.' },
  { id: 'sharp', name: 'Whetstone', desc: 'Shot damage +25%.' },
  { id: 'greed', name: 'Gilded Eye', desc: 'Score items are worth 40% more.' },
  { id: 'aegis', name: 'Aegis Plate', desc: 'Respawn invulnerability doubled. Death-bomb window widened.' },
  { id: 'magnet', name: 'Lodestone', desc: 'All items are drawn to you at all times.' },
  { id: 'phoenix', name: 'Phoenix Feather', desc: 'Once per stage, a full Overdrive meter absorbs a hit instead of killing you.' },
  { id: 'echo', name: 'Echo Chamber', desc: 'Bombs also slow every bullet on screen for three seconds afterwards.' },
];

export class Player {
  constructor(g, shipId) {
    this.g = g; this.ship = SHIPS.find((s) => s.id === shipId) || SHIPS[0];
    this.x = g.W / 2; this.y = g.H - 110; this.r = this.ship.hitR; this.grazeR = 26;
    this.power = 1; this.lives = 3; this.bombs = 3; this.maxBombs = 3;
    this.invuln = 0; this.dead = false; this.respawnT = 0; this.focus = false;
    this.shotT = 0; this.graze = 0; this.over = 0; this.overActive = 0; this.overMax = 5;
    this.hitPending = 0; this.relics = new Set(); this.phoenixUsed = false;
    this.optAng = 0; this.t = 0; this.tilt = 0; this.bombT = 0; this.bombing = null;
    this.lifeFrags = 0; this.entryT = 0; this.stats = { kills: 0, graze: 0, bombs: 0, deaths: 0 };
  }
  get dmgMul() { return (this.relics.has('sharp') ? 1.25 : 1) * (this.overActive > 0 ? 1.4 : 1); }
  get grazeRadius() { return this.grazeR * (this.relics.has('graze') ? 1.5 : 1); }
  applyRelic(id) {
    this.relics.add(id);
    if (id === 'heart') this.lives++;
    if (id === 'charge') { this.maxBombs++; this.bombs = Math.min(this.maxBombs, this.bombs + 1); }
    if (id === 'overdrive') this.overMax = 8;
  }
  reset(pos = true) {
    if (pos) { this.x = this.g.W / 2; this.y = this.g.H - 110; }
    this.dead = false; this.invuln = 2; this.hitPending = 0; this.bombing = null; this.bombT = 0;
  }

  update(dt) {
    const g = this.g, inp = g.input; this.t += dt;
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    this.focus = inp.focus;
    // movement
    const ax = inp.axis();
    const spd = this.focus ? this.ship.focusSpeed : this.ship.speed;
    let mx = ax.x * spd * dt, my = ax.y * spd * dt;
    const td = inp.consumeTouch();
    mx += td.dx; my += td.dy;
    if (g.level && g.level.playerField) { const f = g.level.playerField(this, g); if (f) { mx += f.x * dt; my += f.y * dt; } }
    this.x = clamp(this.x + mx, 12, g.W - 12); this.y = clamp(this.y + my, 20, g.H - 16);
    if (this.entryT > 0) { this.entryT -= dt; this.y = Math.min(this.y, lerp(g.H - 16, g.H - 110, ease.outCubic(clamp(1 - this.entryT / 0.9, 0, 1)))); }
    this.tilt = approachAngle(this.tilt, clamp(mx / dt / 400, -1, 1) * 0.5, 6 * dt);
    if (this.invuln > 0) this.invuln -= dt;
    // shooting
    const wantShoot = g.options.autofire || inp.shootHeld;
    this.shotT -= dt;
    if (wantShoot && this.shotT <= 0 && !this.bombing?.blockShots) this.fire();
    // options (drones) orbit
    this.optAng += dt * (this.focus ? 2 : 4.5);
    // overdrive
    if (this.overActive > 0) { this.overActive -= dt; if (this.overActive <= 0) { this.overActive = 0; g.bulletTime = 1; g.fx.text(this.x, this.y - 40, 'OVERDRIVE END', '#ffffff', { size: 12 }); } }
    else if (inp.overPressed() && this.over >= 1) this.startOverdrive();
    // bomb
    if (this.bombing) this.updateBomb(dt);
    if (this.hitPending > 0) this.hitPending -= dt;
    if (inp.bombPressed()) this.tryBomb();
  }

  fire() {
    const g = this.g, P = g.pbullets, s = this.ship.id, pw = this.power, f = this.focus, dm = this.dmgMul;
    const rate = this.overActive > 0 ? 0.62 : 1;
    const shot = (x, y, ang, spd, dmg, kind = 'player', r = 3, extra = {}) => P.spawn({ x, y, ang, spd, dmg: dmg * dm, kind, r, color: this.ship.color, life: 2, ...extra });
    if (s === 'vesper') {
      this.shotT = 0.085 * rate;
      const n = 1 + pw, spread = f ? 0.16 : 0.55;
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1);
        shot(this.x + a * 18, this.y - 12, -PI / 2 + a, 780, f ? 1.1 : 0.9, 'player', 3);
      }
      if (pw >= 3) { shot(this.x - 16, this.y, -PI / 2 - (f ? 0.02 : 0.12), 700, 0.6, 'player', 2.5); shot(this.x + 16, this.y, -PI / 2 + (f ? 0.02 : 0.12), 700, 0.6, 'player', 2.5); }
    } else if (s === 'lance') {
      this.shotT = 0.06 * rate;
      const dmg = 0.75 + pw * 0.25;
      shot(this.x, this.y - 14, -PI / 2, 980, dmg, 'pbeam', 3.5, { pierce: 1 + (pw >= 3 ? 1 : 0) });
      if (pw >= 2) { const w = f ? 7 : 14; shot(this.x - w, this.y - 6, -PI / 2, 900, 0.45, 'player', 2.5); shot(this.x + w, this.y - 6, -PI / 2, 900, 0.45, 'player', 2.5); }
      if (pw >= 4 && !f) { shot(this.x - 22, this.y + 4, -PI / 2 - 0.25, 800, 0.4, 'player', 2.5); shot(this.x + 22, this.y + 4, -PI / 2 + 0.25, 800, 0.4, 'player', 2.5); }
    } else {
      this.shotT = 0.1 * rate;
      shot(this.x - 6, this.y - 10, -PI / 2 - 0.08, 720, 0.6, 'player', 2.8);
      shot(this.x + 6, this.y - 10, -PI / 2 + 0.08, 720, 0.6, 'player', 2.8);
      const opts = this.optionPositions();
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        if (pw >= 1) shot(o.x, o.y, -PI / 2 + (i ? 0.4 : -0.4), 520, 0.42 + pw * 0.06, 'missile', 3, { home: f ? 5 : 3.2, homeDelay: 0.05, r: 3 });
      }
      if (pw >= 4 && this.t % 0.3 < 0.1) shot(this.x, this.y - 16, -PI / 2, 600, 0.6, 'missile', 3.5, { home: 4 });
    }
    g.audio.sfx('shoot');
  }
  optionPositions() {
    const n = this.ship.id === 'wraith' ? 2 : 0, out = [];
    for (let i = 0; i < n; i++) {
      const a = this.optAng + (i / n) * TAU, rad = this.focus ? 18 : 34;
      out.push({ x: this.x + Math.cos(a) * rad, y: this.y + Math.sin(a) * rad * 0.7 });
    }
    return out;
  }

  addGraze(b) {
    const g = this.g;
    this.graze++; this.stats.graze++;
    const gain = (0.011 + (this.relics.has('graze') ? 0.0045 : 0)) * (this.overActive > 0 ? 0.25 : 1);
    if (this.overActive <= 0) this.over = Math.min(1, this.over + gain);
    g.addScore(8 * Math.max(1, g.mult * 0.5), false);
    g.mult = Math.min(g.maxMult, g.mult + 0.006); g.chainT = 0;
    g.fx.spark(b.x, b.y, b.ang + PI, 2, '#ffffff', { spd: 120, life: 0.2 });
    g.audio.sfx('graze');
    if (this.over >= 1 && !this.overReady) { this.overReady = true; g.fx.text(this.x, this.y - 50, 'OVERDRIVE READY  [C]', '#ffffff', { size: 13, life: 1.4 }); }
  }
  startOverdrive() {
    const g = this.g;
    this.over = 0; this.overReady = false; this.overActive = this.overMax;
    g.bulletTime = 0.42; g.audio.sfx('over'); g.fx.addFlash(0.5, this.ship.color); g.fx.ring(this.x, this.y, this.ship.color, { r1: 300, w: 6, life: 0.7 });
    g.fx.text(this.x, this.y - 40, 'OVERDRIVE', this.ship.color, { size: 20 });
    g.mult = Math.min(g.maxMult, g.mult + 0.5);
  }

  // ---- Damage ----
  hit(src) {
    const g = this.g;
    if (this.dead || this.invuln > 0 || g.bombTimer > 0 || this.pendingDie) return;
    if (this.relics.has('phoenix') && !this.phoenixUsed && this.over >= 1) {
      this.phoenixUsed = true; this.over = 0; this.overReady = false; this.invuln = 2.5;
      g.fx.text(this.x, this.y - 40, 'PHOENIX FEATHER', '#ffb347', { size: 16 }); g.fx.ring(this.x, this.y, '#ffb347', { r1: 160 });
      g.bullets.clearRadius(g, this.x, this.y, 120); g.audio.sfx('shield'); return;
    }
    // death-bomb window
    this.hitPending = this.relics.has('aegis') ? 0.3 : 0.15;
    this.invuln = 0.001;
    g.fx.hitstop = 0.06;
    this.pendingDie = true;
  }
  // called by main after the death-bomb window expires
  resolveHit() {
    if (!this.pendingDie) return;
    if (this.hitPending > 0) return;
    this.pendingDie = false;
    this.die();
  }
  die() {
    const g = this.g;
    this.dead = true; this.respawnT = 1.3; this.stats.deaths++;
    this.lives--; g.mult = Math.max(1, g.mult * 0.5); this.over = Math.max(0, this.over - 0.5); this.overReady = false;
    if (this.overActive > 0) { this.overActive = 0; g.bulletTime = 1; }
    g.audio.sfx('death'); g.fx.addShake(14); g.fx.addFlash(0.6, '#ff3355');
    g.fx.burst(this.x, this.y, 60, this.ship.color, { spd: 320, life: 1.1, size: 4 });
    g.fx.burst(this.x, this.y, 30, '#ffffff', { spd: 200, life: 0.6, size: 2 });
    g.fx.ring(this.x, this.y, '#ffffff', { r1: 200, w: 6, life: 0.6 });
    g.bullets.clearRadius(g, this.x, this.y, 140, false);
    for (let i = 0; i < Math.min(3, this.power); i++) g.items.spawn(this.x + (i - 1) * 30, this.y - 40, 'power', { vy: -220 });
    this.power = Math.max(1, this.power - 1);
    g.onPlayerDeath();
  }
  respawn() {
    const g = this.g;
    if (this.lives < 0) { g.gameOver(); return; }
    this.dead = false; this.x = g.W / 2; this.y = g.H - 16; this.entryT = 0.9;
    this.invuln = this.relics.has('aegis') ? 6 : 3; this.bombs = Math.max(this.bombs, Math.min(this.maxBombs, 2));
    g.fx.ring(this.x, g.H - 110, this.ship.color, { r1: 90 });
  }

  // ---- Bombs ----
  tryBomb() {
    const g = this.g;
    if (this.dead || this.bombing || this.bombs <= 0) return;
    this.bombs--; this.stats.bombs++; this.pendingDie = false; this.hitPending = 0;
    const s = this.ship.id;
    g.bombTimer = s === 'lance' ? 2.2 : s === 'wraith' ? 4 : 1.6;
    this.invuln = Math.max(this.invuln, g.bombTimer + 0.8);
    g.audio.sfx('bomb'); g.fx.addShake(10); g.fx.addFlash(0.7, this.ship.color);
    g.mult = Math.max(1, g.mult - 0.5);
    if (s === 'vesper') {
      this.bombing = { type: 'nova', t: 0, dur: 1.6, r: 0, blockShots: false };
    } else if (s === 'lance') {
      this.bombing = { type: 'sunder', t: 0, dur: 2.2, blockShots: true };
    } else {
      this.bombing = { type: 'phantom', t: 0, dur: 4, blockShots: false, next: 0 };
      g.bullets.clearRadius(g, this.x, this.y, 220);
    }
    if (this.relics.has('echo')) g.echoSlow = 3;
    g.fx.text(this.x, this.y - 40, this.ship.bomb.split(' ·')[0], this.ship.color, { size: 22 });
  }
  updateBomb(dt) {
    const g = this.g, b = this.bombing; b.t += dt;
    if (b.type === 'nova') {
      b.r = (b.t / b.dur) * 900;
      g.bullets.clearRadius(g, this.x, this.y, b.r);
      for (const e of g.enemies) if (dist(e.x, e.y, this.x, this.y) < b.r + e.r) g.damageEnemy(e, 55 * dt, this.x, this.y);
      if (g.boss && dist(g.boss.x, g.boss.y, this.x, this.y) < b.r + g.boss.r) g.damageBoss(g.boss, 90 * dt);
      if (b.t < 0.1) g.fx.ring(this.x, this.y, this.ship.color, { r1: 800, w: 30, life: 1.5 });
    } else if (b.type === 'sunder') {
      const w = 110 * Math.min(1, b.t / 0.25) * (b.t > b.dur - 0.3 ? (b.dur - b.t) / 0.3 : 1);
      g.sunder = { x: this.x, w, y: this.y };
      const L = g.bullets.list;
      for (let i = L.length - 1; i >= 0; i--) { const bb = L[i]; if (Math.abs(bb.x - this.x) < w / 2 + bb.r && bb.y < this.y) { g.onBulletCancel(bb); g.bullets.free.push(bb); L[i] = L[L.length - 1]; L.pop(); } }
      for (const e of g.enemies) if (Math.abs(e.x - this.x) < w / 2 + e.r && e.y < this.y) g.damageEnemy(e, 140 * dt, e.x, e.y);
      if (g.boss && Math.abs(g.boss.x - this.x) < w / 2 + g.boss.r && g.boss.y < this.y) g.damageBoss(g.boss, 170 * dt);
      if (Math.random() < 0.5) g.fx.spark(this.x + (Math.random() - 0.5) * w, Math.random() * this.y, -PI / 2, 2, '#fff', { spd: 300 });
    } else {
      g.bullets.clearRadius(g, this.x, this.y, 110);
      b.next -= dt;
      if (b.next <= 0 && b.t < 2.4) {
        b.next = 0.09;
        const a = -PI / 2 + (Math.random() - 0.5) * 2.4;
        g.pbullets.spawn({ x: this.x, y: this.y, ang: a, spd: 420, dmg: 2.5 * this.dmgMul, kind: 'missile', r: 4.5, color: this.ship.color, home: 6, homeDelay: 0.15, life: 3, pierce: 0 });
      }
    }
    if (b.t >= b.dur) { this.bombing = null; g.sunder = null; }
  }

  draw(ctx) {
    const g = this.g;
    if (this.dead) return;
    const flick = this.invuln > 0 && Math.floor(this.t * 30) % 2 === 0;
    ctx.save(); ctx.translate(this.x, this.y);
    const c = this.ship.color, c2 = this.ship.color2;
    // options
    for (const o of this.optionPositions()) {
      ctx.fillStyle = rgba(c, 0.9); ctx.beginPath(); ctx.arc(o.x - this.x, o.y - this.y, 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(o.x - this.x, o.y - this.y, 1.8, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = flick ? 0.35 : 1;
    // engine flame
    ctx.globalCompositeOperation = 'lighter';
    const fl = 10 + Math.sin(this.t * 40) * 3;
    const gr = ctx.createRadialGradient(0, 14, 0, 0, 14, fl + 8); gr.addColorStop(0, rgba(c2, 0.9)); gr.addColorStop(0.4, rgba(c, 0.5)); gr.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 16, 6, fl + 6, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(this.tilt * 0.5);
    ctx.scale(1 - Math.abs(this.tilt) * 0.5, 1);
    // hull by ship
    ctx.lineJoin = 'round'; ctx.lineWidth = 1.5; ctx.strokeStyle = c2;
    const s = this.ship.id;
    ctx.fillStyle = rgba(c, 0.85);
    ctx.beginPath();
    if (s === 'vesper') { ctx.moveTo(0, -18); ctx.lineTo(7, -2); ctx.lineTo(20, 10); ctx.lineTo(14, 14); ctx.lineTo(5, 9); ctx.lineTo(0, 13); ctx.lineTo(-5, 9); ctx.lineTo(-14, 14); ctx.lineTo(-20, 10); ctx.lineTo(-7, -2); }
    else if (s === 'lance') { ctx.moveTo(0, -24); ctx.lineTo(5, -4); ctx.lineTo(12, 8); ctx.lineTo(12, 15); ctx.lineTo(4, 11); ctx.lineTo(0, 15); ctx.lineTo(-4, 11); ctx.lineTo(-12, 15); ctx.lineTo(-12, 8); ctx.lineTo(-5, -4); }
    else { ctx.moveTo(0, -16); ctx.lineTo(8, 4); ctx.lineTo(16, -2); ctx.lineTo(12, 14); ctx.lineTo(4, 10); ctx.lineTo(0, 14); ctx.lineTo(-4, 10); ctx.lineTo(-12, 14); ctx.lineTo(-16, -2); ctx.lineTo(-8, 4); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // cockpit
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, -4, 2.5, 6, 0, 0, TAU); ctx.fill();
    ctx.restore();
    // shield during phantom bomb
    if (this.bombing?.type === 'phantom') { ctx.strokeStyle = rgba(c, 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.x, this.y, 110, 0, TAU); ctx.stroke(); }
    // hitbox / graze ring in focus
    if (this.focus || g.options.hitbox) {
      ctx.globalAlpha = 0.25; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(this.x, this.y, this.grazeRadius, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff3366'; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.fill();
    }
    if (this.overActive > 0) {
      ctx.globalAlpha = 0.5 + Math.sin(this.t * 20) * 0.2; ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.x, this.y, 30 + Math.sin(this.t * 10) * 3, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
}

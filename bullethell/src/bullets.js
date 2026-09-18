// Enemy + player bullet pools, sprite cache, and laser beams.
import { TAU, PI, clamp, dist2, angTo, approachAngle, rgba } from './math.js';

const spriteCache = new Map();
// Pre-render a glowing bullet sprite. kind: orb | ring | needle | shard | star | big | knife | bubble
export function bulletSprite(kind, color, r) {
  const key = kind + color + r;
  let s = spriteCache.get(key);
  if (s) return s;
  const pad = kind === 'needle' || kind === 'knife' ? r * 3 : r * 2.2;
  const w = Math.ceil(pad * 2 + 4);
  const c = document.createElement('canvas'); c.width = c.height = w;
  const ctx = c.getContext('2d'); ctx.translate(w / 2, w / 2);
  const glow = (rad, a) => { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad); g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill(); };
  switch (kind) {
    case 'orb':
      glow(r * 2.1, 0.55);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
      break;
    case 'big':
      glow(r * 2.1, 0.5);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.85); ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, TAU); ctx.stroke();
      break;
    case 'ring':
      glow(r * 2, 0.4);
      ctx.strokeStyle = color; ctx.lineWidth = r * 0.5; ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.22; ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, TAU); ctx.stroke();
      break;
    case 'bubble':
      glow(r * 2, 0.35);
      ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = rgba(color, 0.35); ctx.fill();
      break;
    case 'needle': // oriented along +x
      glow(r * 1.6, 0.4);
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(0, 0, r * 2.8, r * 0.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(r * 0.4, 0, r * 1.8, r * 0.35, 0, 0, TAU); ctx.fill();
      break;
    case 'knife':
      glow(r * 1.6, 0.4);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(r * 2.8, 0); ctx.lineTo(-r * 1.6, r * 0.9); ctx.lineTo(-r * 1.0, 0); ctx.lineTo(-r * 1.6, -r * 0.9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(r * 2.0, 0); ctx.lineTo(-r * 0.8, r * 0.35); ctx.lineTo(-r * 0.8, -r * 0.35); ctx.closePath(); ctx.fill();
      break;
    case 'shard':
      glow(r * 1.8, 0.4);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(r * 1.6, 0); ctx.lineTo(-r * 0.9, r * 1.1); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.9, -r * 1.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(r * 0.9, 0); ctx.lineTo(-r * 0.4, r * 0.45); ctx.lineTo(-r * 0.4, -r * 0.45); ctx.closePath(); ctx.fill();
      break;
    case 'star':
      glow(r * 2.2, 0.45);
      ctx.fillStyle = color; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rr = i % 2 ? r * 0.45 : r * 1.3; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.fill();
      break;
    case 'player':
      ctx.fillStyle = rgba(color, 0.5); ctx.beginPath(); ctx.ellipse(0, 0, r * 2.4, r * 1.1, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(r * 0.3, 0, r * 1.8, r * 0.5, 0, 0, TAU); ctx.fill();
      break;
    case 'pbeam':
      ctx.fillStyle = rgba(color, 0.6); ctx.beginPath(); ctx.ellipse(0, 0, r * 3.2, r * 0.9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(r * 0.4, 0, r * 2.6, r * 0.4, 0, 0, TAU); ctx.fill();
      break;
    case 'missile':
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(r * 2.2, 0); ctx.lineTo(-r * 1.4, r * 1.0); ctx.lineTo(-r * 1.4, -r * 1.0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r * 0.6, 0, r * 0.5, 0, TAU); ctx.fill();
      break;
  }
  s = { c, w, half: w / 2, oriented: ['needle', 'knife', 'shard', 'player', 'pbeam', 'missile'].includes(kind) };
  spriteCache.set(key, s);
  return s;
}

export class BulletPool {
  constructor(enemy = true) {
    this.list = []; this.free = []; this.enemy = enemy;
  }
  get length() { return this.list.length; }
  spawn(p) {
    const b = this.free.pop() || {};
    b.x = p.x; b.y = p.y; b.ang = p.ang ?? -PI / 2; b.spd = p.spd ?? 150;
    b.r = p.r ?? 4; b.kind = p.kind || 'orb'; b.color = p.color || '#ff5577';
    b.t = 0; b.life = p.life ?? 20; b.delay = p.delay ?? 0;
    b.accel = p.accel ?? 0; b.turn = p.turn ?? 0; b.minSpd = p.minSpd ?? 0; b.maxSpd = p.maxSpd ?? 2000;
    b.home = p.home ?? 0; b.homeTime = p.homeTime ?? 0; b.homeDelay = p.homeDelay ?? 0;
    b.bounces = p.bounces ?? 0; b.grazed = false; b.dead = false;
    b.fuse = p.fuse ?? 0; b.onFuse = p.onFuse || null; b.onUpdate = p.onUpdate || null;
    b.wave = p.wave ?? 0; b.waveFreq = p.waveFreq ?? 4; b.ox = 0; b.oy = 0;
    b.dmg = p.dmg ?? 1; b.pierce = p.pierce ?? 0; b.hits = null;
    b.ghost = p.ghost ?? 0; // 1 = passes through cover/asteroids
    b.spin = 0; b.data = p.data;
    b.sprite = bulletSprite(b.kind, b.color, b.r);
    b.grav = p.grav ?? 1; // response to fields (gravity wells)
    this.list.push(b);
    return b;
  }
  clear(g, toScore = true) {
    for (const b of this.list) { if (toScore && b.delay <= 0) g.onBulletCancel(b); this.free.push(b); }
    this.list.length = 0;
  }
  clearRadius(g, x, y, rad, toScore = true) {
    const L = this.list, r2 = rad * rad;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      if (dist2(b.x, b.y, x, y) < r2) { if (toScore) g.onBulletCancel(b); this.free.push(b); L[i] = L[L.length - 1]; L.pop(); }
    }
  }
  update(g, dt) {
    const L = this.list, W = g.W, H = g.H, pl = g.player, lvl = g.level;
    const globalTS = this.enemy ? g.bulletTime : 1;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      if (b.delay > 0) { b.delay -= dt; if (b.delay > 0) continue; }
      let ts = globalTS;
      if (this.enemy && lvl && lvl.bulletTimeAt) ts *= lvl.bulletTimeAt(b.x, b.y, g);
      const d = dt * ts;
      b.t += d;
      if (b.onUpdate) b.onUpdate(b, g, d);
      if (b.accel) b.spd = clamp(b.spd + b.accel * d, b.minSpd, b.maxSpd);
      if (b.turn) b.ang += b.turn * d;
      if (b.home && b.t > b.homeDelay && (b.homeTime <= 0 || b.t < b.homeDelay + b.homeTime)) {
        let tx, ty;
        if (this.enemy) { tx = pl.x; ty = pl.y; }
        else { const e = g.nearestEnemy(b.x, b.y); if (e) { tx = e.x; ty = e.y; } }
        if (tx !== undefined) b.ang = approachAngle(b.ang, angTo(b.x, b.y, tx, ty), b.home * d);
      }
      let vx = Math.cos(b.ang) * b.spd, vy = Math.sin(b.ang) * b.spd;
      if (this.enemy && lvl && lvl.bulletField && b.grav) {
        const f = lvl.bulletField(b, g); // returns {x,y} accel or null
        if (f) { vx += f.x * d; vy += f.y * d; b.spd = Math.hypot(vx, vy); b.ang = Math.atan2(vy, vx); }
      }
      b.x += vx * d; b.y += vy * d;
      if (b.wave) { // lateral sine wobble
        const nx = -Math.sin(b.ang), ny = Math.cos(b.ang);
        const off = Math.sin(b.t * b.waveFreq) * b.wave;
        b.x += nx * (off - b.ox); b.y += ny * (off - b.oy); b.ox = off; b.oy = off;
      }
      if (b.bounces > 0) {
        if (b.x < 0 && Math.cos(b.ang) < 0) { b.x = 0; b.ang = PI - b.ang; b.bounces--; if (g.onBounce) g.onBounce(b); }
        else if (b.x > W && Math.cos(b.ang) > 0) { b.x = W; b.ang = PI - b.ang; b.bounces--; if (g.onBounce) g.onBounce(b); }
        else if (b.y < 0 && Math.sin(b.ang) < 0 && b.bounceTop) { b.y = 0; b.ang = -b.ang; b.bounces--; }
      }
      if (b.fuse > 0 && b.t >= b.fuse) { if (b.onFuse) b.onFuse(b, g); b.dead = true; }
      const m = 48;
      if (b.dead || b.t > b.life || b.x < -m || b.x > W + m || b.y < -m || b.y > H + m) {
        this.free.push(b); L[i] = L[L.length - 1]; L.pop();
      }
    }
  }
  draw(ctx, g) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const b = L[i], s = b.sprite;
      if (b.delay > 0) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = b.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2 + b.delay * 8, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1; continue;
      }
      if (s.oriented) {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang); ctx.drawImage(s.c, -s.half, -s.half); ctx.restore();
      } else ctx.drawImage(s.c, b.x - s.half, b.y - s.half);
    }
  }
}

// ---------- Lasers ----------
// A laser has a warn phase (thin telegraph line) then an active phase (thick beam).
export class Laser {
  constructor(p) {
    this.x = p.x; this.y = p.y; this.ang = p.ang; this.len = p.len ?? 1400; this.w = p.w ?? 18;
    this.warn = p.warn ?? 0.8; this.dur = p.dur ?? 1.2; this.t = 0; this.color = p.color || '#ff4488';
    this.turn = p.turn ?? 0; this.follow = p.follow || null; // follow: entity to anchor to
    this.ox = p.ox || 0; this.oy = p.oy || 0; this.dead = false; this.fade = 0.2;
    this.onFire = p.onFire; this.fired = false; this.grow = p.grow ?? 0.12;
  }
  get active() { return this.t >= this.warn && this.t < this.warn + this.dur; }
  update(g, dt) {
    const ts = g.bulletTime;
    this.t += dt * ts;
    if (this.follow) { this.x = this.follow.x + this.ox; this.y = this.follow.y + this.oy; }
    if (this.t >= this.warn) this.ang += this.turn * dt * ts;
    if (!this.fired && this.t >= this.warn) { this.fired = true; if (this.onFire) this.onFire(this, g); g.audio.sfx('laserfire'); }
    if (this.t > this.warn + this.dur + this.fade) this.dead = true;
  }
  hitsPoint(px, py, pr) {
    if (!this.active) return false;
    const k = Math.min(1, (this.t - this.warn) / this.grow);
    const w = this.w * k;
    const dx = Math.cos(this.ang), dy = Math.sin(this.ang);
    const rx = px - this.x, ry = py - this.y;
    const proj = rx * dx + ry * dy;
    if (proj < 0 || proj > this.len) return false;
    const perp = Math.abs(rx * -dy + ry * dx);
    return perp < w / 2 + pr;
  }
  draw(ctx) {
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.ang);
    if (this.t < this.warn) {
      const k = this.t / this.warn;
      ctx.globalAlpha = 0.25 + 0.5 * k; ctx.strokeStyle = this.color; ctx.lineWidth = 1 + k * 2;
      ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(this.len, 0); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.6 * k; ctx.lineWidth = this.w; ctx.strokeStyle = rgba(this.color, 0.15); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(this.len, 0); ctx.stroke();
    } else {
      const over = this.t - this.warn - this.dur;
      const k = over > 0 ? 1 - over / this.fade : Math.min(1, (this.t - this.warn) / this.grow);
      const w = this.w * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35; ctx.strokeStyle = this.color; ctx.lineWidth = w * 2.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(this.len, 0); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(this.len, 0); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = w * 0.35; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(this.len, 0); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
}

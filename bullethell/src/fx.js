// Particles, screen shake, flashes and floating text.
import { TAU, RNG, rgba } from './math.js';

export class FX {
  constructor() {
    this.parts = []; this.texts = []; this.rings = [];
    this.shake = 0; this.shakeX = 0; this.shakeY = 0;
    this.flash = 0; this.flashColor = '#ffffff';
    this.rng = new RNG(99);
    this.hitstop = 0;
    this.enabled = true; this.shakeScale = 1;
  }
  clear() { this.parts.length = 0; this.texts.length = 0; this.rings.length = 0; this.shake = 0; this.flash = 0; }
  burst(x, y, n, color, opt = {}) {
    if (!this.enabled && n > 4) n = 4;
    const spd = opt.spd || 180, life = opt.life || 0.6, size = opt.size || 3;
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, TAU), s = spd * this.rng.range(0.2, 1);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, t: 0, color, size: size * this.rng.range(0.6, 1.4), drag: opt.drag ?? 2.5, glow: opt.glow, grav: opt.grav || 0, shape: opt.shape || 'dot' });
    }
  }
  spark(x, y, ang, n, color, opt = {}) {
    for (let i = 0; i < n; i++) {
      const a = ang + this.rng.range(-0.5, 0.5), s = (opt.spd || 220) * this.rng.range(0.4, 1);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: opt.life || 0.3, t: 0, color, size: opt.size || 2, drag: 4, shape: 'streak' });
    }
  }
  ring(x, y, color, opt = {}) {
    this.rings.push({ x, y, r: opt.r0 || 4, r1: opt.r1 || 90, w: opt.w || 3, life: opt.life || 0.45, t: 0, color });
  }
  text(x, y, str, color = '#ffffff', opt = {}) {
    this.texts.push({ x, y, str, color, t: 0, life: opt.life || 0.9, size: opt.size || 14, vy: opt.vy ?? -40 });
  }
  addShake(v) { if (this.enabled) this.shake = Math.min(24, this.shake + v * this.shakeScale); }
  addFlash(v, color = '#ffffff') { this.flash = Math.max(this.flash, v); this.flashColor = color; }
  update(dt) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.t += dt;
      if (p.t >= p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d; p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.t += dt; t.y += t.vy * dt; if (t.t >= t.life) this.texts.splice(i, 1); }
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t += dt; if (r.t >= r.life) this.rings.splice(i, 1); }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - 40 * dt);
      this.shakeX = this.rng.range(-1, 1) * this.shake; this.shakeY = this.rng.range(-1, 1) * this.shake;
    } else { this.shakeX = this.shakeY = 0; }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 3 * dt);
    if (this.hitstop > 0) this.hitstop -= dt;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const k = 1 - p.t / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.shape === 'streak') {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else {
        const s = p.size * (0.5 + k * 0.5);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    for (const r of this.rings) {
      const k = r.t / r.life;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r + (r.r1 - r.r) * (1 - Math.pow(1 - k, 2)), 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.t / t.life; ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `bold ${t.size}px "Rajdhani", "Segoe UI", sans-serif`;
      ctx.fillStyle = '#000'; ctx.fillText(t.str, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  }
}

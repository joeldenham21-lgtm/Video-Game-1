// Pickups: score gems, power, bombs, life fragments.
import { TAU, dist2, angTo, approachAngle, rgba } from './math.js';

export const ITEM = {
  score: { color: '#4fd6ff', r: 6 },
  big: { color: '#ffd84f', r: 9 },
  power: { color: '#ff5a5a', r: 8 },
  bomb: { color: '#7dff8a', r: 9 },
  life: { color: '#ff7ad9', r: 9 },
};

export class Items {
  constructor() { this.list = []; }
  clear() { this.list.length = 0; }
  spawn(x, y, type, opt = {}) {
    const d = ITEM[type];
    this.list.push({ x, y, type, r: d.r, color: d.color, vx: opt.vx ?? (Math.random() - 0.5) * 60, vy: opt.vy ?? -140, t: 0, mag: false, value: opt.value ?? 1 });
  }
  update(g, dt) {
    const L = this.list, p = g.player, H = g.H;
    const collectAll = p.y < H * 0.27 || g.bombTimer > 0 || p.overActive || p.relics.has('magnet') || p.dead;
    for (let i = L.length - 1; i >= 0; i--) {
      const it = L[i]; it.t += dt;
      const d2 = dist2(it.x, it.y, p.x, p.y);
      if (!p.dead && (collectAll || d2 < 90 * 90 || (p.focus && d2 < 150 * 150))) it.mag = true;
      if (it.mag && !p.dead) {
        const a = angTo(it.x, it.y, p.x, p.y), s = 700 + it.t * 300;
        it.vx = Math.cos(a) * s; it.vy = Math.sin(a) * s;
      } else {
        it.vy = Math.min(150, it.vy + 260 * dt); it.vx *= 1 - 3 * dt;
      }
      it.x += it.vx * dt; it.y += it.vy * dt;
      if (it.x < 6) { it.x = 6; it.vx = Math.abs(it.vx) * 0.5; } else if (it.x > g.W - 6) { it.x = g.W - 6; it.vx = -Math.abs(it.vx) * 0.5; }
      if (!p.dead && d2 < (22 + it.r) * (22 + it.r)) { g.collectItem(it); L.splice(i, 1); continue; }
      if (it.y > H + 30) L.splice(i, 1);
    }
  }
  draw(ctx, g) {
    for (const it of this.list) {
      const bob = Math.sin(it.t * 6) * 1.5;
      ctx.save(); ctx.translate(it.x, it.y + bob);
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, it.r * 2.2); gr.addColorStop(0, rgba(it.color, 0.5)); gr.addColorStop(1, rgba(it.color, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, it.r * 2.2, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = it.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (it.type === 'score' || it.type === 'big') { ctx.moveTo(0, -it.r); ctx.lineTo(it.r * 0.7, 0); ctx.lineTo(0, it.r); ctx.lineTo(-it.r * 0.7, 0); ctx.closePath(); }
      else ctx.rect(-it.r * 0.8, -it.r * 0.8, it.r * 1.6, it.r * 1.6);
      ctx.fill(); ctx.stroke();
      if (it.type !== 'score') {
        ctx.fillStyle = '#fff'; ctx.font = `bold ${it.r + 2}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText({ power: 'P', bomb: 'B', life: '♥', big: '★' }[it.type], 0, 1);
      }
      ctx.restore();
    }
  }
}

// Procedural parallax backgrounds, one per world.
import { TAU, PI, RNG, rgba, lerp } from './math.js';

export function makeBackground(id, g) {
  const rng = new RNG(id.length * 977 + 13);
  const W = g.W, H = g.H;
  const stars = Array.from({ length: 90 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), s: rng.range(0.5, 2), v: rng.range(20, 70), tw: rng.range(0, TAU) }));
  let t = 0;
  const drawStars = (ctx, col, spd = 1) => {
    for (const s of stars) { const y = (s.y + t * s.v * spd) % H; ctx.globalAlpha = 0.4 + Math.sin(t * 3 + s.tw) * 0.3; ctx.fillStyle = col; ctx.fillRect(s.x, y, s.s, s.s * 2); }
    ctx.globalAlpha = 1;
  };
  const base = (ctx, c0, c1) => { const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c0); gr.addColorStop(1, c1); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); };

  const K = {
    ember() {
      const embers = Array.from({ length: 70 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), v: rng.range(30, 90), s: rng.range(1, 3), w: rng.range(0, TAU) }));
      const plumes = Array.from({ length: 5 }, (_, i) => ({ x: rng.range(0, W), r: rng.range(160, 300), a: rng.range(0.06, 0.12), v: rng.range(4, 10) }));
      return {
        draw(ctx) {
          base(ctx, '#120504', '#3a0f08');
          // burning planet on the horizon
          const px = W * 0.75, py = H * 0.22;
          const gr = ctx.createRadialGradient(px, py, 0, px, py, 220); gr.addColorStop(0, 'rgba(255,120,40,0.35)'); gr.addColorStop(0.35, 'rgba(255,90,30,0.18)'); gr.addColorStop(1, 'rgba(255,60,20,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#2a0c06'; ctx.beginPath(); ctx.arc(px, py, 110, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(255,140,60,0.35)'; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(px, py, 110, i * 1.6 + t * 0.05, i * 1.6 + 0.9 + t * 0.05); ctx.stroke(); }
          drawStars(ctx, '#ffb080', 0.4);
          ctx.globalCompositeOperation = 'lighter';
          for (const p of plumes) { const y = ((t * p.v) % (H + p.r * 2)) - p.r; const g2 = ctx.createRadialGradient(p.x, y, 0, p.x, y, p.r); g2.addColorStop(0, rgba('#ff5a3c', p.a)); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); }
          for (const e of embers) { const y = H - ((e.y + t * e.v) % H), x = e.x + Math.sin(t * 2 + e.w) * 12; ctx.fillStyle = rgba('#ffa040', 0.5 + Math.sin(t * 6 + e.w) * 0.4); ctx.fillRect(x, y, e.s, e.s); }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
    glass() {
      const flakes = Array.from({ length: 120 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), v: rng.range(25, 80), s: rng.range(1, 2.5), w: rng.range(0, TAU) }));
      const floes = Array.from({ length: 7 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), r: rng.range(60, 140), v: rng.range(10, 24), rot: rng.range(0, TAU), n: 5 + rng.int(0, 3) }));
      return {
        draw(ctx) {
          base(ctx, '#03101f', '#0a2c48');
          // aurora bands
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 3; i++) { const y = 120 + i * 90; ctx.beginPath(); for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.012 + t * 0.6 + i) * 30 + Math.sin(x * 0.03 - t * 0.4) * 10); ctx.strokeStyle = rgba(i === 1 ? '#8ff0ff' : '#5fd0a0', 0.10); ctx.lineWidth = 40; ctx.stroke(); }
          ctx.globalCompositeOperation = 'source-over';
          drawStars(ctx, '#cfefff', 0.3);
          for (const f of floes) { const y = ((f.y + t * f.v) % (H + 300)) - 150; ctx.save(); ctx.translate(f.x, y); ctx.rotate(f.rot + t * 0.05); ctx.fillStyle = 'rgba(120,200,240,0.08)'; ctx.strokeStyle = 'rgba(200,240,255,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = 0; i < f.n; i++) { const a = (i / f.n) * TAU, r = f.r * (0.7 + ((i * 53) % 10) / 25); i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
          for (const f of flakes) { const y = (f.y + t * f.v) % H, x = f.x + Math.sin(t + f.w) * 20; ctx.fillStyle = rgba('#e6fbff', 0.5 + Math.sin(t * 4 + f.w) * 0.3); ctx.fillRect(x, y, f.s, f.s); }
        },
      };
    },
    bloom() {
      const spores = Array.from({ length: 90 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), v: rng.range(10, 40), s: rng.range(1, 3), w: rng.range(0, TAU), c: rng.chance(0.5) ? '#ff5fb0' : '#c6ff8a' }));
      const vines = Array.from({ length: 6 }, (_, i) => ({ x: (i % 2 ? W : 0), y0: rng.range(0, H), amp: rng.range(40, 120), ph: rng.range(0, TAU), w: rng.range(4, 10) }));
      const petals = Array.from({ length: 5 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), r: rng.range(120, 220), rot: rng.range(0, TAU), v: rng.range(6, 14) }));
      return {
        draw(ctx) {
          base(ctx, '#04110a', '#0f3418');
          for (const p of petals) { const y = ((p.y + t * p.v) % (H + 500)) - 250; ctx.save(); ctx.translate(p.x, y); ctx.rotate(p.rot + t * 0.04); ctx.fillStyle = 'rgba(255,95,176,0.06)'; for (let i = 0; i < 6; i++) { ctx.rotate(TAU / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(p.r * 0.6, -p.r * 0.35, p.r, 0); ctx.quadraticCurveTo(p.r * 0.6, p.r * 0.35, 0, 0); ctx.fill(); } ctx.restore(); }
          for (const v of vines) { ctx.strokeStyle = 'rgba(120,220,120,0.18)'; ctx.lineWidth = v.w; ctx.beginPath(); for (let y = -50; y <= H + 50; y += 16) { const yy = (y + t * 20 + v.y0) % (H + 100) - 50; const x = v.x + (v.x ? -1 : 1) * (v.amp * 0.5 + Math.sin(yy * 0.01 + v.ph + t * 0.3) * v.amp); if (y === -50) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); } ctx.stroke(); }
          ctx.globalCompositeOperation = 'lighter';
          for (const s of spores) { const y = H - ((s.y + t * s.v) % H), x = s.x + Math.sin(t * 1.3 + s.w) * 25; ctx.fillStyle = rgba(s.c, 0.35 + Math.sin(t * 5 + s.w) * 0.3); ctx.fillRect(x, y, s.s, s.s); }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
    static() {
      const blocks = Array.from({ length: 40 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), w: rng.range(20, 80), h: rng.range(2, 6), v: rng.range(60, 200), ph: rng.range(0, 100) }));
      return {
        draw(ctx) {
          base(ctx, '#07041a', '#1c0f3a');
          // perspective grid
          ctx.strokeStyle = 'rgba(181,107,255,0.18)'; ctx.lineWidth = 1;
          const cx = W / 2, hz = H * 0.35;
          for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 30, hz); ctx.lineTo(cx + i * 180, H); ctx.stroke(); }
          for (let k = 0; k < 14; k++) { const f = ((k / 14) + (t * 0.25) % (1 / 14)) % 1; const y = hz + Math.pow(f, 2.2) * (H - hz); ctx.globalAlpha = f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
          ctx.globalAlpha = 1;
          // spires
          ctx.fillStyle = 'rgba(30,16,60,0.9)'; for (let i = 0; i < 9; i++) { const x = (i / 9) * W + Math.sin(i * 7) * 20, h = 80 + ((i * 41) % 120); ctx.fillRect(x, hz - h, 14 + (i % 3) * 8, h); ctx.fillStyle = 'rgba(125,227,255,' + (0.2 + 0.2 * Math.sin(t * 3 + i)) + ')'; ctx.fillRect(x + 4, hz - h + 10, 3, 3); ctx.fillStyle = 'rgba(30,16,60,0.9)'; }
          drawStars(ctx, '#d98cff', 0.15);
          for (const b of blocks) { const y = (b.y + t * b.v) % H; ctx.fillStyle = rgba(Math.sin(b.ph) > 0 ? '#7de3ff' : '#d98cff', 0.10 + 0.1 * Math.sin(t * 9 + b.ph)); ctx.fillRect(b.x, y, b.w, b.h); }
          // scanlines
          ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = (t * 40) % 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);
        },
      };
    },
    grave() {
      const dust = Array.from({ length: 140 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), v: rng.range(8, 30), s: rng.range(0.5, 1.5), w: rng.range(0, TAU) }));
      const suns = [{ x: W * 0.22, y: H * 0.3, r: 70, c: '#ffd166' }, { x: W * 0.8, y: H * 0.62, r: 55, c: '#b08cff' }];
      return {
        draw(ctx) {
          base(ctx, '#020106', '#120a24');
          drawStars(ctx, '#e0d8ff', 0.15);
          for (const s of suns) {
            const gr = ctx.createRadialGradient(s.x, s.y, s.r * 0.6, s.x, s.y, s.r * 3); gr.addColorStop(0, rgba(s.c, 0.16)); gr.addColorStop(1, rgba(s.c, 0)); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#0a0612'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
            ctx.strokeStyle = rgba(s.c, 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 2, 0, TAU); ctx.stroke();
            ctx.strokeStyle = rgba(s.c, 0.15); ctx.lineWidth = 1; for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r + i * 34, (s.r + i * 34) * 0.35, t * 0.05 * (i % 2 ? 1 : -1), 0, TAU); ctx.stroke(); }
          }
          for (const d of dust) { const y = (d.y + t * d.v) % H; ctx.fillStyle = rgba('#d0c8ff', 0.3 + Math.sin(t * 2 + d.w) * 0.2); ctx.fillRect(d.x, y, d.s, d.s); }
        },
      };
    },
    hourglass() {
      const sand = Array.from({ length: 160 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), v: rng.range(80, 220), s: rng.range(0.6, 1.6), w: rng.range(0, TAU) }));
      const rings = Array.from({ length: 4 }, (_, i) => ({ r: 160 + i * 110, v: (i % 2 ? -1 : 1) * rng.range(0.05, 0.15), n: 12 + i * 6 }));
      return {
        draw(ctx) {
          base(ctx, '#071617', '#262210');
          const cx = W / 2, cy = H * 0.45;
          for (const r of rings) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * r.v); ctx.strokeStyle = 'rgba(255,193,77,0.16)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r.r, 0, TAU); ctx.stroke(); for (let i = 0; i < r.n; i++) { const a = (i / r.n) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r.r - 8), Math.sin(a) * (r.r - 8)); ctx.lineTo(Math.cos(a) * (r.r + 8), Math.sin(a) * (r.r + 8)); ctx.strokeStyle = i % 3 ? 'rgba(127,245,232,0.18)' : 'rgba(255,193,77,0.35)'; ctx.stroke(); } ctx.restore(); }
          drawStars(ctx, '#7ff5e8', 0.2);
          ctx.globalCompositeOperation = 'lighter';
          for (const s of sand) { const y = (s.y + t * s.v) % H, x = s.x + Math.sin(y * 0.02 + s.w) * 6; ctx.fillStyle = rgba('#ffd27a', 0.35); ctx.fillRect(x, y, s.s, s.s * 4); }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
    heart() {
      const veins = Array.from({ length: 14 }, (_, i) => ({ x0: rng.range(0, W), amp: rng.range(30, 90), ph: rng.range(0, TAU), w: rng.range(2, 7), sp: rng.range(0.01, 0.02) }));
      const motes = Array.from({ length: 80 }, () => ({ x: rng.range(0, W), y: rng.range(0, H), v: rng.range(20, 60), s: rng.range(1, 3), w: rng.range(0, TAU) }));
      return {
        draw(ctx) {
          const k = g.level && g.level.beatK ? g.level.beatK() : 0;
          base(ctx, '#12020a', '#3a0616');
          const gr = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, 500); gr.addColorStop(0, rgba('#ff3b5c', 0.14 + k * 0.12)); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
          for (const v of veins) { ctx.strokeStyle = rgba('#ff3b5c', 0.14 + k * 0.1); ctx.lineWidth = v.w * (1 + k * 0.3); ctx.beginPath(); for (let y = 0; y <= H; y += 18) { const x = v.x0 + Math.sin(y * v.sp + v.ph + t * 0.4) * v.amp; y ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
          ctx.globalCompositeOperation = 'lighter';
          for (const m of motes) { const y = H - ((m.y + t * m.v) % H); ctx.fillStyle = rgba('#ff8fa3', 0.3 + k * 0.4); ctx.fillRect(m.x + Math.sin(t + m.w) * 10, y, m.s, m.s); }
          ctx.globalCompositeOperation = 'source-over';
        },
      };
    },
  };
  const bg = (K[id] || K.ember)();
  return { update(dt) { t += dt; }, draw(ctx) { bg.draw(ctx); } };
}

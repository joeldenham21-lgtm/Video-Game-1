// Canvas HUD: score, lives, bombs, power, overdrive meter, boss bar, banners, dialogue.
import { TAU, PI, clamp, fmtNum, rgba, lerp } from './math.js';

const FONT = '"Rajdhani", "Segoe UI", sans-serif';
export function drawHUD(ctx, g) {
  const p = g.player, W = g.W, H = g.H;
  ctx.save(); ctx.textBaseline = 'top';
  // top strip
  const grad = ctx.createLinearGradient(0, 0, 0, 70); grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 70);
  ctx.textAlign = 'left'; ctx.fillStyle = '#9aa3b2'; ctx.font = `600 11px ${FONT}`; ctx.fillText('SCORE', 12, 8);
  ctx.fillStyle = '#fff'; ctx.font = `700 22px ${FONT}`; ctx.fillText(fmtNum(g.dispScore), 12, 20);
  ctx.fillStyle = '#9aa3b2'; ctx.font = `600 11px ${FONT}`; ctx.fillText('HI ' + fmtNum(Math.max(g.hiScore, g.score)), 12, 46);
  // multiplier
  ctx.textAlign = 'center'; ctx.fillStyle = g.mult >= 4 ? '#ffd84f' : '#dfe6ff'; ctx.font = `700 ${16 + Math.min(6, g.mult)}px ${FONT}`; ctx.fillText('×' + g.mult.toFixed(2), W / 2, 8);
  ctx.fillStyle = '#9aa3b2'; ctx.font = `600 10px ${FONT}`; ctx.fillText('CHAIN', W / 2, 34);
  // lives / bombs / power right
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9aa3b2'; ctx.font = `600 11px ${FONT}`; ctx.fillText('LIVES', W - 12, 8);
  for (let i = 0; i < Math.max(0, p.lives); i++) { drawShipIcon(ctx, W - 20 - i * 18, 28, p.ship.color); }
  if (p.lives <= 0) { ctx.fillStyle = '#ff5566'; ctx.font = `700 12px ${FONT}`; ctx.fillText('LAST LIFE', W - 12, 22); }
  ctx.fillStyle = '#9aa3b2'; ctx.font = `600 11px ${FONT}`; ctx.fillText('BOMBS', W - 12, 40);
  for (let i = 0; i < p.bombs; i++) { ctx.fillStyle = '#7dff8a'; ctx.beginPath(); ctx.arc(W - 20 - i * 16, 60, 5, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W - 20 - i * 16, 60, 2, 0, TAU); ctx.fill(); }
  // power pips
  ctx.textAlign = 'left'; ctx.fillStyle = '#9aa3b2'; ctx.font = `600 11px ${FONT}`; ctx.fillText('POWER', 12, 62);
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i < p.power ? '#ff5a5a' : 'rgba(255,255,255,0.15)'; ctx.fillRect(56 + i * 14, 65, 10, 6); }
  // overdrive meter (vertical bar, left edge)
  const mx = 8, my = 120, mh = 200;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(mx, my, 8, mh);
  const k = p.overActive > 0 ? p.overActive / p.overMax : p.over;
  const col = p.overActive > 0 ? '#fff' : p.over >= 1 ? (Math.sin(g.time * 12) > 0 ? '#fff' : p.ship.color) : p.ship.color;
  ctx.fillStyle = col; ctx.fillRect(mx, my + mh * (1 - k), 8, mh * k);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(mx + 0.5, my + 0.5, 8, mh);
  ctx.save(); ctx.translate(mx + 20, my + mh / 2); ctx.rotate(-PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = p.over >= 1 ? '#fff' : '#9aa3b2'; ctx.font = `700 11px ${FONT}`; ctx.fillText(p.overActive > 0 ? 'OVERDRIVE' : p.over >= 1 ? 'READY  [C]' : 'GRAZE', 0, 0); ctx.restore();
  // graze count
  ctx.textAlign = 'left'; ctx.fillStyle = '#9aa3b2'; ctx.font = `600 10px ${FONT}`; ctx.fillText('GRAZE ' + p.graze, mx, my + mh + 6);
  // stage name (bottom-left, faint)
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = `600 10px ${FONT}`; ctx.fillText(`STAGE ${g.stageIdx + 1} · ${g.levelDef.name}`, 12, H - 16);
  ctx.textAlign = 'right'; ctx.fillText(g.diffName.toUpperCase() + (g.practice ? ' · PRACTICE' : ''), W - 12, H - 16);
  // boss bar
  const b = g.boss;
  if (b && !b.entering && b.dying <= 0 && b.phase) {
    const bw = W - 80, bx = 40, by = 80;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, 8);
    const hk = clamp(b.hp / b.maxhp, 0, 1);
    ctx.fillStyle = b.invuln > 0 ? '#888' : b.color; ctx.fillRect(bx, by, bw * hk, 8);
    ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, bw * hk, 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.strokeRect(bx + 0.5, by + 0.5, bw, 8);
    // phase pips
    const rem = b.phases.length - b.pi - 1;
    for (let i = 0; i < rem; i++) { ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(bx + 6 + i * 12, by + 18, 3.5, 0, TAU); ctx.fill(); }
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `700 12px ${FONT}`; ctx.fillText(b.name, bx + (rem ? rem * 12 + 6 : 0), by + 12);
    ctx.textAlign = 'right'; ctx.fillStyle = b.timeLeft < 10 ? '#ff5566' : '#dfe6ff'; ctx.font = `700 14px ${FONT}`; ctx.fillText(Math.ceil(b.timeLeft).toString().padStart(2, '0'), bx + bw, by + 11);
    ctx.textAlign = 'center'; ctx.fillStyle = rgba('#ffffff', 0.7); ctx.font = `600 11px ${FONT}`; ctx.fillText(b.phase.name, W / 2, by + 12);
  }
  // banners
  for (const bn of g.banners) {
    const k = bn.t / bn.dur, a = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
    ctx.globalAlpha = a;
    if (!bn.small) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, H * 0.36, W, 96);
      ctx.fillStyle = g.pal.accent; ctx.fillRect(0, H * 0.36, W, 2); ctx.fillRect(0, H * 0.36 + 94, W, 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = `700 ${bn.text.length > 18 ? 26 : 34}px ${FONT}`; ctx.fillText(bn.text, W / 2 + (1 - a) * 30, H * 0.36 + 36);
      if (bn.sub) { ctx.fillStyle = '#cfd6e6'; ctx.font = `italic 500 14px ${FONT}`; ctx.fillText(bn.sub, W / 2 - (1 - a) * 30, H * 0.36 + 68); }
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000'; ctx.font = `700 20px ${FONT}`; ctx.fillText(bn.text, W / 2 + 1, 121);
      ctx.fillStyle = '#fff'; ctx.fillText(bn.text, W / 2, 120);
    }
    ctx.globalAlpha = 1;
  }
  // dialogue subtitles
  const d = g.dialogue[0];
  if (d) {
    const a = Math.min(1, d.t / 0.2, (d.dur - d.t) / 0.3);
    ctx.globalAlpha = Math.max(0, a); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const y = H - 44;
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(20, y - 22, W - 40, 44);
    ctx.fillStyle = d.speaker === 'PILOT' ? p.ship.color : d.speaker === 'ORACLE' ? '#9be7c9' : g.pal.accent; ctx.font = `700 11px ${FONT}`; ctx.fillText(d.speaker, W / 2, y - 12);
    ctx.fillStyle = '#fff'; ctx.font = `500 13px ${FONT}`;
    wrapText(ctx, d.text.slice(0, Math.floor(d.t * 40)), W / 2, y + 6, W - 60, 15);
    ctx.globalAlpha = 1;
  }
  // tip (start of stage)
  if (g.tipT > 0) {
    const a = Math.min(1, g.tipT / 0.5, (6 - g.tipT) / 0.5);
    ctx.globalAlpha = Math.max(0, a); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd84f'; ctx.font = `600 12px ${FONT}`; wrapText(ctx, g.levelDef.tip, W / 2, H * 0.62, W - 80, 15); ctx.globalAlpha = 1;
  }
  // pending death flash
  if (p.pendingDie) { ctx.fillStyle = 'rgba(255,0,60,0.25)'; ctx.fillRect(0, 0, W, H); }
  // overdrive tint
  if (p.overActive > 0) { ctx.fillStyle = rgba(p.ship.color, 0.06 + Math.sin(g.time * 10) * 0.02); ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
function drawShipIcon(ctx, x, y, c) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.restore();
}
export function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '', yy = y; const lines = [];
  for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
  lines.push(line);
  yy = y - ((lines.length - 1) * lh) / 2;
  for (const l of lines) { ctx.fillText(l, x, yy); yy += lh; }
}

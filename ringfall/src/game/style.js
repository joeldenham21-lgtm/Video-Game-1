// Style meter: stylish play builds rank (D → SSS) which multiplies score.
import { G } from '../state.js';

export const RANKS = [
  { l: 'D', name: 'DECENT', color: '#8ea3b8' },
  { l: 'C', name: 'CRISP', color: '#7fe6ff' },
  { l: 'B', name: 'BRUTAL', color: '#6dff9a' },
  { l: 'A', name: 'APEX', color: '#ffd257' },
  { l: 'S', name: 'SAVAGE', color: '#ffa24a' },
  { l: 'SS', name: 'SUBLIME', color: '#ff5a8a' },
  { l: 'SSS', name: 'SINGULARITY', color: '#c6a0ff' },
];

const KILL_PTS = { mite: 12, sentinel: 24, lancer: 30, brute: 60, warden: 40 };

export function createStyle() {
  const S = {
    rank: 0, bar: 0, score: 0, best: 0, feed: [], multiT: 0, multiN: 0, lastDash: -10, peak: 0,
    waveDamage: 0,
    reset() { S.rank = 0; S.bar = 0; S.score = 0; S.best = 0; S.feed = []; S.multiN = 0; S.peak = 0; },
    add(pts, label, gold = false) {
      S.bar += pts * (1 - S.rank * 0.06);
      while (S.bar >= 100 && S.rank < RANKS.length - 1) {
        S.bar -= 100; S.rank++;
        if (S.rank > S.peak) S.peak = S.rank;
        G.hud?.styleRankUp(RANKS[S.rank]);
      }
      if (S.rank === RANKS.length - 1) S.bar = Math.min(S.bar, 100);
      const gained = Math.round(pts * 10 * (1 + S.rank * 0.25));
      S.score += gained;
      if (label) {
        S.feed.unshift({ label, pts: gained, t: 2.4, gold });
        if (S.feed.length > 5) S.feed.pop();
      }
      G.hud?.styleChanged();
    },
    hurt(amount) {
      S.bar -= 25 + amount * 1.5;
      while (S.bar < 0 && S.rank > 0) { S.rank--; S.bar += 100; }
      if (S.bar < 0) S.bar = 0;
      G.hud?.styleChanged();
    },
    update(dt) {
      const decay = 5 + S.rank * 4.5;
      if (G.mode === 'playing' && G.enemies?.alive > 0) {
        S.bar -= decay * dt;
        if (S.bar < 0) {
          if (S.rank > 0) { S.rank--; S.bar += 100; G.hud?.styleChanged(); }
          else S.bar = 0;
        }
      }
      for (const f of S.feed) f.t -= dt;
      S.feed = S.feed.filter(f => f.t > 0);
      if (S.multiT > 0) {
        S.multiT -= dt;
        if (S.multiT <= 0) {
          if (S.multiN >= 2) {
            const names = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'CARNAGE'];
            S.add(12 * S.multiN, names[Math.min(S.multiN, 5)] + (S.multiN > 5 ? ` ×${S.multiN}` : ''), S.multiN >= 3);
          }
          S.multiN = 0;
        }
      }
    },
    get info() { return RANKS[S.rank]; },
  };

  G.events.on('enemyKilled', (ctx) => {
    const e = ctx.enemy;
    let base = KILL_PTS[e.type] || 15;
    if (ctx.elite) base *= 2;
    const labels = [];
    if (ctx.shatter) { base += 30; labels.push('SHATTERED'); }
    if (ctx.deflect) { base += 45; labels.push('RETURN TO SENDER'); }
    if (ctx.crit && !ctx.shatter) { base += 10; labels.push('CORE KILL'); }
    if (ctx.airborne && ctx.source !== 'self') { base += 12; labels.push('AERIAL'); }
    if (G.time - S.lastDash < 0.5) { base += 12; labels.push('DASH KILL'); }
    if (G.player.odActive > 0) base += 4;
    if (ctx.source === 'self') { base = Math.round(base * 0.4); labels.length = 0; }
    const label = labels.length ? labels.join(' + ') : `${e.def.name}${ctx.elite ? ' ELITE' : ''}`;
    S.add(base, label, ctx.shatter || ctx.deflect);
    S.multiN++; S.multiT = 0.7;
  });
  G.events.on('dash', () => { S.lastDash = G.time; });
  G.events.on('deflect', (n) => S.add(10 * n, n > 1 ? `PARRY ×${n}` : 'PARRY'));
  G.events.on('bruteStunned', () => S.add(22, 'WALLED'));
  G.events.on('playerDamaged', ({ amount }) => { S.hurt(amount); S.waveDamage += amount; });
  return S;
}

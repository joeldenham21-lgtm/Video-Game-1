// "Heart of the Choir" — final boss. D minor, 80 bpm, 32 bars (96 s loop).
//   bed   — pipe organ + strings, the cathedral
//   pulse — 16th spiccato ostinato in violas/celli, basses on the beat
//   drive — timpani + bass drum "heartbeat" (lub-dub), the Halcyon theme on horns a4 with trombones below,
//           violin descant, trumpets and gong at the climax
// Form: A 1-4 · B 5-20 theme · C 21-28 climax · D 29-32 hush & rebuild
import { seq, cat, ost, grid, midi } from '../lib/score.mjs';
import { voiceLead, bassLine, toEvents } from '../lib/harmony.mjs';

const B = (n) => (n - 1) * 4;
const THEME_H = [['Dm', 4], ['Bb', 4], ['F/C', 4], ['Bbmaj7', 4], ['Dm', 4], ['Gm7', 4], ['Eb', 4], ['A', 4],
  ['Dm', 2], ['Dm/C', 2], ['Bbmaj7', 4], ['Gm', 2], ['C', 2], ['F', 2], ['A/E', 2], ['Dm', 4], ['Gm', 2], ['C', 2], ['Bb', 2], ['A', 2], ['Dm', 4]];
const H = [['Dm', 4], ['Dm', 4], ['Bb', 4], ['A', 4], ...THEME_H,
  ['Bb', 4], ['C', 4], ['Dm', 4], ['Dm', 4], ['Bb', 4], ['C', 4], ['A', 4], ['A', 4],
  ['Dm', 4], ['Dm', 4], ['Bb', 4], ['A', 4]];
const SYM = H.map(h => h[0]), DUR = H.map(h => h[1]);
// chord at a beat
const starts = []; { let t = 0; for (const d of DUR) { starts.push(t); t += d; } }
const chordAt = (beat) => { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= beat) i++; return SYM[i]; };

const THEME = `A3/h D4/q E4/q | F4/h. E4/e D4/e | C4/h A3/q C4/q | D4/w |
  A3/h D4/q E4/q | F4/h G4/q A4/q | Bb4/h. A4/e G4/e | A4/w |
  D5/h C5/q Bb4/q | A4/h. G4/e F4/e | G4/h F4/q E4/q | F4/h E4/h |
  D4/h F4/q A4/q | G4/h. F4/e E4/e | F4/q E4/q C#4/q E4/q | D4/w`;
const DESCANT = `D6/w | C6/h Bb5/h | Bb5/h C6/h | A5/w | F5/h A5/h | D6/h. C6/q | D6/h C#6/h | D6/w`;
const CLIMAX = `F5/h G5/q A5/q | G5/h. E5/q | F5/w | D5/h. A4/q | Bb4/q D5/q F5/q Bb5/q | A5/h G5/h | A5/w | A5/h. r/q`;

const [oS, oA, oT] = voiceLead(SYM, [{ lo: 'F4', hi: 'D5', start: 'A4' }, { lo: 'C4', hi: 'A4', start: 'F4' }, { lo: 'G3', hi: 'F4', start: 'D4' }]);
const [sS, sA] = voiceLead(SYM, [{ lo: 'A4', hi: 'F5', start: 'D5' }, { lo: 'D4', hi: 'A4', start: 'A4' }]);
const bass = bassLine(SYM, 'C2');
const rootAt = (beat, lo) => bassLine([chordAt(beat)], lo)[0];
const tonesAt = (beat, lo) => { const s = chordAt(beat); const r = bassLine([s], lo)[0]; const minor = /m(?!aj)/.test(s); return [r, r + 7, r + 12, r + (minor ? 3 : 4) + 12]; };

// ostinati generated per beat so half-bar harmony is followed exactly
const ostBeats = (fromBar, toBar, fn, pattern, { step = 0.25, vel = 0.5, accent = '', accVel = 0.2 } = {}) => {
  const out = [], steps = pattern.split(' '), per = Math.round(1 / step);
  for (let b = B(fromBar); b < B(toBar + 1); b++) {
    const notes = fn(b);
    for (let i = 0; i < per; i++) {
      const s = steps[(Math.round((b - B(fromBar)) * per) + i) % steps.length];
      if (s === '-') continue;
      const acc = accent[(i) % Math.max(1, accent.length)] === '1';
      out.push({ t: b + i * step, d: step * 0.9, p: s.split('+').map(k => notes[+k]), v: Math.min(1, vel + (acc ? accVel : 0)), acc });
    }
  }
  return out;
};
const bars = (pat, from, to, opt = {}) => { const out = []; for (let b = from; b <= to; b++) out.push(...grid(pat, { at: B(b), ...opt })); return out; };
const timpAt = (beat) => { const r = rootAt(beat, 'D2'); return r > midi('A2') ? r - 12 >= midi('D2') ? r - 12 : r : r; };
// heartbeat: lub (beat 1) - dub (the "and"), again on beat 3
const heart = (from, to, vel = 0.72, dense = false) => {
  const out = [];
  for (let b = from; b <= to; b++) for (const s of dense ? [0, 1.5, 2, 3.5] : [0, 0.5, 2, 2.5]) {
    const t = B(b) + s;
    out.push({ t, d: 1, p: [s % 2 === 0 ? timpAt(t) : timpAt(t) + 7 > midi('A3') ? timpAt(t) - 5 : timpAt(t) + 7], v: vel + (s % 2 === 0 ? 0.08 : -0.08) });
  }
  return out;
};

export default {
  name: 'final', bpm: 80, beats: 4, bars: 32, loop: true, stems: ['bed', 'pulse', 'drive'], target: -16.5,
  comp: { drive: { thresh: -19, ratio: 2.2, attack: 0.01, release: 0.18 } },
  parts: [
    // ======================= BED
    { id: 'orgS', inst: 'organ', stem: 'bed', legato: true, gain: 0.55, notes: toEvents(oS, DUR, { vel: 0.55 }),
      expr: [[0, 0.8], [B(21), 1.0], [B(28) + 4, 1.0], [B(29), 0.7], [B(33), 0.8]] },
    { id: 'orgA', inst: 'organ', stem: 'bed', legato: true, gain: 0.5, notes: toEvents(oA, DUR, { vel: 0.55 }) },
    { id: 'orgT', inst: 'organ', stem: 'bed', legato: true, gain: 0.5, notes: toEvents(oT, DUR, { vel: 0.55 }) },
    { id: 'orgP', inst: 'organPed', stem: 'bed', legato: true, gain: 0.65, notes: toEvents(bass, DUR, { vel: 0.55 }) },
    { id: 'vln', inst: 'vln', stem: 'bed', legato: true, gain: 0.5, pan: -0.55, notes: toEvents(sS, DUR, { vel: 0.45 }),
      expr: [[0, 0.6], [B(5), 0.7], [B(20) + 4, 0.9], [B(21), 1.0], [B(29), 0.55], [B(33), 0.6]] },
    { id: 'vla', inst: 'vla', stem: 'bed', legato: true, gain: 0.95, notes: toEvents(sA, DUR, { vel: 0.45 }) },
    { id: 'vc', inst: 'vc', stem: 'bed', legato: true, gain: 0.65, notes: toEvents(bass.map(n => n + 12), DUR, { vel: 0.5 }) },
    { id: 'cb', inst: 'cb', stem: 'bed', legato: true, gain: 0.6, notes: toEvents(bass, DUR, { vel: 0.5 }) },

    // ======================= PULSE
    { id: 'vlaSpic', inst: 'vlaSpic', stem: 'pulse', gain: 0.85, human: { t: 0.004, v: 0.04 },
      notes: ostBeats(1, 32, b => tonesAt(b, 'D3'), '0 1 2 1 3 1 2 1', { vel: 0.46, accent: '1000', accVel: 0.2 }),
      expr: [[0, 0.8], [B(21), 1.0], [B(28) + 4, 1.05], [B(29), 0.7], [B(33), 0.85]] },
    { id: 'vcSpic', inst: 'vcSpic', stem: 'pulse', gain: 0.8, human: { t: 0.004 },
      notes: ostBeats(1, 32, b => tonesAt(b, 'C2'), '0 - 0 2 0 - 0 2', { step: 0.25, vel: 0.5, accent: '1000', accVel: 0.22 }) },
    { id: 'cbSpic', inst: 'cbSpic', stem: 'pulse', gain: 0.65, notes: ostBeats(1, 32, b => [rootAt(b, 'D1')], '0 - - -', { step: 0.25, vel: 0.6 }) },

    // ======================= DRIVE
    { id: 'timp', inst: 'timp', stem: 'drive', gain: 0.8, notes: cat(heart(1, 20, 0.66), heart(21, 28, 0.78, true), heart(31, 32, 0.6)) },
    { id: 'bd', inst: 'bd', stem: 'drive', gain: 0.7, notes: cat(bars('X.x.....X.x.....', 5, 20), bars('X.x...x.X.x...xx', 21, 28), bars('X...............', 29, 30)) },
    { id: 'frame', inst: 'frame', stem: 'drive', gain: 0.55, notes: bars('....x.......x..x', 13, 28) },
    { id: 'timpRoll', inst: 'timpRoll', stem: 'drive', gain: 0.62,
      notes: cat(seq('mf A2/w | A2/h. r/q', { at: B(19) }), seq('mf A2/w | A2/h. r/q', { at: B(31) })),
      expr: [[B(19), 0.2], [B(20) + 3.5, 1], [B(20) + 3.9, 0.2], [B(31), 0.2], [B(32) + 3.5, 1], [B(32) + 3.9, 0.2]] },
    { id: 'cym', inst: 'cymSwell', stem: 'drive', gain: 0.42,
      notes: [{ t: B(5) - 5.3, d: 4, p: [60], v: 0.6 }, { t: B(21) - 10, d: 8, p: [60], v: 0.95 }, { t: B(33) - 10, d: 8, p: [60], v: 0.95 }] },
    { id: 'gong', inst: 'gong', stem: 'drive', gain: 0.45, notes: [{ t: B(21), d: 6, p: [60], v: 0.9 }, { t: B(29), d: 6, p: [60], v: 0.5 }] },
    { id: 'hn', inst: 'hn', stem: 'drive', legato: true, unison: 3, gain: 1.0, pan: -0.3, notes: seq('f ' + THEME, { at: B(5) }),
      expr: [[B(5), 0.85], [B(12), 1.0], [B(13), 1.08], [B(20) + 3, 1.0]] },
    { id: 'tbn', inst: 'tbn', stem: 'drive', legato: true, unison: 2, gain: 0.55, pan: 0.4,
      notes: seq('mf D4/h C4/q Bb3/q | A3/h. G3/e F3/e | G3/h F3/q E3/q | F3/h E3/h | D3/h F3/q A3/q | G3/h. F3/e E3/e | F3/q E3/q C#3/q E3/q | D3/w', { at: B(13) }) },
    { id: 'vlnHi', inst: 'vln', stem: 'drive', legato: true, gain: 0.62, pan: -0.6,
      notes: cat(seq('mf ' + DESCANT, { at: B(13) }), seq('ff ' + CLIMAX, { at: B(21) })),
      expr: [[B(13), 0.75], [B(20) + 4, 0.9], [B(21), 1.0], [B(28) + 3, 1.05]] },
    { id: 'tpt', inst: 'tpt', stem: 'drive', legato: true, unison: 2, gain: 0.55, notes: seq('f ' + CLIMAX, { at: B(21), tr: -12 }),
      expr: [[B(21), 0.9], [B(28) + 3, 1.0]] },
    { id: 'hn2', inst: 'hn', stem: 'drive', legato: true, unison: 3, gain: 0.8, pan: -0.35,
      notes: seq('f D4/w | E4/w | F4/w | F4/w | F4/w | E4/w | E4/w | C#4/w', { at: B(21) }) },
    { id: 'tuba', inst: 'tuba', stem: 'drive', legato: true, gain: 0.5, notes: toEvents(bass.slice(25, 33), 4, { at: B(21), vel: 0.62 }) },
  ],
};

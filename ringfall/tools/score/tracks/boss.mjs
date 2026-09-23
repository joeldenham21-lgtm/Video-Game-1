// "The Conductor" — first boss. G minor, 144 bpm, 40 bars (67 s loop).
//   bed   — tremolo strings + low sustained brass pedal (menace, always under the fight)
//   pulse — 16th violin ostinato, driving cello/bass 8ths
//   drive — horn theme (inverted title motif) with trumpets at the peak, trombone stabs, timpani + bass drum + frame drums
// Form: A 1-8 · B 9-16 horn theme · C 17-24 answer (theme in violins, brass stabs) · D 25-32 peak · E 33-40 descent
import { seq, cat, ost, grid, midi } from '../lib/score.mjs';
import { voiceLead, bassLine, toEvents } from '../lib/harmony.mjs';

const B = (n) => (n - 1) * 4;
const CH = [
  'Gm', 'Gm', 'Eb', 'Eb', 'Cm', 'Cm', 'D', 'D',
  'Gm', 'F', 'Eb', 'D', 'Gm', 'Bb', 'Cm', 'D',
  'Eb', 'F', 'Gm', 'Gm', 'Eb', 'F', 'D', 'D',
  'Gm', 'Eb', 'Bb', 'F', 'Cm', 'Ab', 'D', 'D',
  'Gm', 'Gm', 'Eb', 'Eb', 'Ab', 'Ab', 'D', 'D',
];
const range = (a, b) => CH.slice(a - 1, b);

// horn theme: the title motif (5-1-2-b3) turned into a fanfare
const THEME = `D4/q. G4/e A4/q Bb4/q | A4/h. F4/q | G4/q. Bb4/e Eb5/q D5/q | D5/h. A4/q |
  Bb4/q. D5/e C5/q Bb4/q | D5/h F4/h | G4/q. Bb4/e C5/q Eb5/q | D5/w`;
const PEAK = `G4/q. Bb4/e D5/q G5/q | G5/h. F5/q | F5/q. D5/e Bb4/q D5/q | C5/h. F4/q |
  Eb5/q. D5/e C5/q Eb5/q | Eb5/h. C5/q | D5/q. C5/e A4/q F#4/q | D4/w`;

const [sS, sA, sT] = voiceLead(CH, [{ lo: 'D5', hi: 'Bb5', start: 'G5' }, { lo: 'G4', hi: 'Eb5', start: 'D5' }, { lo: 'C4', hi: 'A4', start: 'Bb4' }]);
const bass = bassLine(CH, 'D2');
const tones = (s, lo) => { const r = bassLine([s], lo)[0]; const minor = /m(?!aj)/.test(s); return [r, r + 7, r + 12, r + (minor ? 15 : 16)]; };

const bars = (pat, from, to, opt = {}) => { const out = []; for (let b = from; b <= to; b++) out.push(...grid(pat, { at: B(b), ...opt })); return out; };
const timpN = (s) => { const r = bassLine([s], 'F#2')[0]; return r > midi('D3') ? r - 12 : r; };
const timpHits = (from, to, steps, vel = 0.72) => { const out = []; for (let b = from; b <= to; b++) for (const st of steps) out.push({ t: B(b) + st * 0.25, d: 1, p: [timpN(CH[b - 1])], v: vel + (st === 0 ? 0.1 : 0) }); return out; };

export default {
  name: 'boss', bpm: 144, beats: 4, bars: 40, loop: true, stems: ['bed', 'pulse', 'drive'], target: -16.5,
  comp: { drive: { thresh: -19, ratio: 2.4, attack: 0.008, release: 0.14 }, pulse: { thresh: -22, ratio: 1.8, attack: 0.01, release: 0.2 } },
  parts: [
    // ======================= BED
    { id: 'vlnTrem', inst: 'vlnTrem', stem: 'bed', legato: true, gain: 0.45, pan: -0.55, notes: toEvents(sS, 4, { vel: 0.55 }),
      expr: [[0, 0.8], [B(24) + 4, 1.0], [B(25), 1.0], [B(33), 0.75], [B(40) + 4, 0.95]] },
    { id: 'vla', inst: 'vlaTrem', stem: 'bed', legato: true, gain: 0.9, notes: toEvents(sA, 4, { vel: 0.5 }) },
    { id: 'vc', inst: 'vc', stem: 'bed', legato: true, gain: 0.7, notes: toEvents(sT.map(n => n - 12), 4, { vel: 0.55 }) },
    { id: 'cb', inst: 'cb', stem: 'bed', legato: true, gain: 0.65, notes: toEvents(bass.map(n => n - 12), 4, { vel: 0.55 }) },
    { id: 'tuba', inst: 'tuba', stem: 'bed', legato: true, gain: 0.35, soft: true, notes: toEvents(bass, 4, { vel: 0.4 }), expr: [[0, 0.7], [B(24) + 4, 1.0], [B(33), 0.6]] },
    { id: 'hnPad', inst: 'hn', stem: 'bed', legato: true, gain: 0.35, pan: -0.25, soft: true,
      notes: toEvents(voiceLead(CH, [{ lo: 'G3', hi: 'D4', start: 'D4' }])[0], 4, { vel: 0.35 }), expr: [[0, 0.6], [B(33), 0.5]] },

    // ======================= PULSE
    { id: 'vlnSpic', inst: 'vlnSpic', stem: 'pulse', gain: 0.55, pan: -0.45, human: { t: 0.003, v: 0.035 },
      notes: ost(CH.map(s => tones(s, 'G4')), { pattern: '0 1 2 1 3 1 2 1', step: 0.25, vel: 0.42, accent: '10001000', accVel: 0.2 }),
      expr: [[0, 0.8], [B(24) + 4, 1.0], [B(33), 0.7], [B(40) + 4, 0.95]] },
    { id: 'vlaSpic', inst: 'vlaSpic', stem: 'pulse', gain: 0.8, human: { t: 0.004 },
      notes: ost(CH.map(s => tones(s, 'C3')), { pattern: '0 0 1 0 2 0 1 3', step: 0.5, vel: 0.5, accent: '10010010', accVel: 0.24 }) },
    { id: 'vcSpic', inst: 'vcSpic', stem: 'pulse', gain: 0.85, human: { t: 0.004 },
      notes: ost(CH.map(s => tones(s, 'C2')), { pattern: '0 0 2 0 0 2 0 2', step: 0.5, vel: 0.54, accent: '10010010', accVel: 0.25 }) },
    { id: 'cbSpic', inst: 'cbSpic', stem: 'pulse', gain: 0.7,
      notes: ost(CH.map(s => [bassLine([s], 'E1')[0]]), { pattern: '0 - - 0 - - 0 -', step: 0.5, vel: 0.68, accent: '10010010' }) },

    // ======================= DRIVE
    { id: 'bd', inst: 'bd', stem: 'drive', gain: 0.8,
      notes: cat(bars('X.......X...x...', 1, 8), bars('X..x..X...X..x..', 9, 24), bars('X..x..X.X.X..x.x', 25, 32), bars('X...............', 33, 36), bars('X.......X.......', 37, 38), bars('X.x.X.x.X.x.X.x.', 39, 39), bars('XxxxXxxxXxxxXxxx', 40, 40, { vel: { X: 0.95, x: 0.55 } })) },
    { id: 'frame', inst: 'frame', stem: 'drive', gain: 0.6, human: { t: 0.004 },
      notes: cat(bars('..x...x...x..x.x', 9, 32), bars('..x...x...x...x.', 37, 40)) },
    { id: 'frameS', inst: 'frameS', stem: 'drive', gain: 0.5, notes: bars('x.x.x.x.x.x.x.x.', 17, 32, { vel: { x: 0.42 } }) },
    { id: 'timp', inst: 'timp', stem: 'drive', gain: 0.78,
      notes: cat(timpHits(1, 8, [0, 8]), timpHits(9, 24, [0, 6, 12]), timpHits(25, 32, [0, 3, 6, 12, 14], 0.76), timpHits(33, 36, [0]), timpHits(37, 38, [0, 8])) },
    { id: 'timpRoll', inst: 'timpRoll', stem: 'drive', gain: 0.6,
      notes: cat(seq('mf D3/w | D3/h. r/q', { at: B(23) }), seq('mf D3/w | D3/h. r/q', { at: B(39) })),
      expr: [[B(23), 0.2], [B(24) + 3.5, 1], [B(24) + 3.9, 0.2], [B(39), 0.2], [B(40) + 3.5, 1], [B(40) + 3.9, 0.2]] },
    { id: 'cym', inst: 'cymSwell', stem: 'drive', gain: 0.42,
      notes: [{ t: B(9) - 4.8, d: 4, p: [60], v: 0.6 }, { t: B(25) - 9.6, d: 8, p: [60], v: 0.95 }, { t: B(41) - 9.6, d: 8, p: [60], v: 0.95 }] },
    { id: 'crash', inst: 'crash', stem: 'drive', gain: 0.35, notes: [{ t: B(25), d: 4, p: [60], v: 0.9 }, { t: B(1), d: 4, p: [60], v: 0.7 }] },
    { id: 'gong', inst: 'gong', stem: 'drive', gain: 0.3, notes: [{ t: B(33), d: 6, p: [60], v: 0.6 }] },
    // horns: theme (B), a4 at the peak (D)
    { id: 'hn', inst: 'hn', stem: 'drive', legato: true, unison: 3, gain: 1.0, pan: -0.3,
      notes: cat(seq('f ' + THEME, { at: B(9) }), seq('ff ' + PEAK.replace(/G5/g, 'G4').replace(/F5/g, 'F4'), { at: B(25) })),
      expr: [[B(9), 0.9], [B(16) + 4, 0.95], [B(25), 1.0], [B(32) + 4, 1.05]] },
    // violins answer with the theme in C, then carry the peak line on top
    { id: 'vlnHi', inst: 'vln', stem: 'drive', legato: true, gain: 0.62, pan: -0.6,
      notes: cat(seq('f ' + THEME, { at: B(17), tr: 12 }), seq('ff ' + PEAK, { at: B(25), tr: 12 })),
      expr: [[B(17), 0.8], [B(24) + 4, 1.0], [B(32) + 4, 1.05]] },
    { id: 'tpt', inst: 'tpt', stem: 'drive', legato: true, gain: 0.5, notes: seq('ff ' + PEAK, { at: B(25) }), expr: [[B(25), 0.85], [B(32) + 4, 1.0]] },
    { id: 'tbnStac', inst: 'tbnStac', stem: 'drive', gain: 0.62, pan: 0.4,
      notes: cat(ost(range(17, 32).map(s => { const r = bassLine([s], 'D3')[0]; return [r - 12 >= midi('A#1') ? r - 12 : r, r]; }), { pattern: '0+1 - - 0+1 - - 0+1 -', step: 0.5, vel: 0.64, accent: '10010010', at: B(17) })) },
    { id: 'tbn', inst: 'tbn', stem: 'drive', legato: true, gain: 0.5, pan: 0.4,
      notes: cat(seq('mf G3/w | G3/w | G3/w | G3/w | G3/w | G3/w | F#3/w | F#3/w', { at: B(1) }), seq('mp G3/w | G3/w | G3/w | G3/w | Ab3/w | Ab3/w | F#3/w | F#3/w', { at: B(33) })),
      expr: [[0, 0.7], [B(8) + 4, 0.9], [B(33), 0.6], [B(40) + 4, 0.95]] },
    { id: 'tubaStac', inst: 'tubaStac', stem: 'drive', gain: 0.55,
      notes: ost(range(17, 32).map(s => [bassLine([s], 'D2')[0]]), { pattern: '0 - - 0 - - 0 -', step: 0.5, vel: 0.62, accent: '10010010', at: B(17) }) },
  ],
};

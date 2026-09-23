// "Halcyon, Restored" — victory. The title theme in D major, 72 bpm, 24 bars (80 s, loops on the end screen).
// 1-4 intro (harp + piano over a D pad) · 5-20 theme: horn, then violins take the second half · 21-24 G - Gm - D cadence
import { seq, cat } from '../lib/score.mjs';
import { voiceLead, bassLine, toEvents } from '../lib/harmony.mjs';

const B = (n) => (n - 1) * 4;
const THEME = `A3/h D4/q E4/q | F#4/h. E4/e D4/e | C#4/h A3/q C#4/q | D4/w |
  A3/h D4/q E4/q | F#4/h G4/q A4/q | B4/h. A4/e G4/e | A4/w |
  D5/h C#5/q B4/q | A4/h. G4/e F#4/e | G4/h F#4/q E4/q | F#4/h E4/h |
  D4/h F#4/q A4/q | G4/h. F#4/e E4/e | F#4/q E4/q C#4/q E4/q | D4/w`;
const H = [['D', 4], ['Dsus2', 4], ['G', 4], ['D', 4],
  ['D', 4], ['Bm', 4], ['A', 4], ['G', 4], ['D', 4], ['G', 4], ['Em', 4], ['A', 4],
  ['D', 2], ['D/C#', 2], ['Bm', 4], ['Em', 2], ['A', 2], ['D', 2], ['A/C#', 2], ['Bm', 4], ['Em', 2], ['A', 2], ['D/F#', 2], ['A', 2], ['D', 4],
  ['G', 4], ['Gm', 4], ['D', 4], ['D', 4]];
const SYM = H.map(h => h[0]), DUR = H.map(h => h[1]);
const [s1, s2, s3] = voiceLead(SYM, [{ lo: 'D5', hi: 'A5', start: 'F#5' }, { lo: 'A4', hi: 'E5', start: 'D5' }, { lo: 'D4', hi: 'B4', start: 'A4' }]);
const bass = bassLine(SYM, 'D2');

export default {
  name: 'victory', bpm: 72, beats: 4, bars: 24, loop: true, stems: ['main'], target: -19,
  parts: [
    { id: 'vln1', inst: 'vln', stem: 'main', legato: true, gain: 0.6, pan: -0.6,
      notes: cat(toEvents(s1.slice(0, 12), DUR.slice(0, 12), { vel: 0.4 }), seq('mf D6/h C#6/q B5/q | A5/h. G5/e F#5/e | G5/h F#5/q E5/q | F#5/h E5/h | D5/h F#5/q A5/q | G5/h. F#5/e E5/e | F#5/q E5/q C#5/q E5/q | D5/w', { at: B(13) }),
        toEvents(s1.slice(25), DUR.slice(25), { at: B(21), vel: 0.45 })),
      expr: [[0, 0.6], [B(5), 0.65], [B(12), 0.75], [B(13), 1.0], [B(20) + 3, 0.9], [B(21), 0.7], [B(24) + 4, 0.55]] },
    { id: 'vln2', inst: 'vln', stem: 'main', legato: true, gain: 0.55, pan: -0.3, notes: toEvents(s2, DUR, { vel: 0.42 }),
      expr: [[0, 0.6], [B(13), 0.85], [B(21), 0.7], [B(24) + 4, 0.55]] },
    { id: 'vla', inst: 'vla', stem: 'main', legato: true, gain: 1.1, notes: toEvents(s3, DUR, { vel: 0.42 }),
      expr: [[0, 0.6], [B(13), 0.85], [B(21), 0.7], [B(24) + 4, 0.55]] },
    { id: 'vc', inst: 'vc', stem: 'main', legato: true, gain: 0.75, notes: toEvents(bass.map(n => n + 12), DUR, { vel: 0.48 }) },
    { id: 'cb', inst: 'cb', stem: 'main', legato: true, gain: 0.55, notes: toEvents(bass, DUR, { vel: 0.45 }) },
    { id: 'hn', inst: 'hn', stem: 'main', legato: true, gain: 0.9, pan: -0.28,
      notes: cat(seq('mf A3/h D4/q E4/q | F#4/h. E4/e D4/e | C#4/h A3/q C#4/q | D4/w | A3/h D4/q E4/q | F#4/h G4/q A4/q | B4/h. A4/e G4/e | A4/w', { at: B(5) }),
        seq('mp D4/h C#4/q B3/q | A3/h. G3/e F#3/e | G3/h F#3/q E3/q | F#3/h E3/h | D3/h F#3/q A3/q | G3/h. F#3/e E3/e | F#3/q E3/q C#3/q E3/q | D3/w', { at: B(13) })),
      expr: [[B(5), 0.8], [B(12) + 3, 1.0], [B(13), 0.75], [B(20) + 3, 0.7]] },
    { id: 'fl', inst: 'fl', stem: 'main', legato: true, gain: 0.45, notes: cat(seq('p A5/w | F#5/w', { at: B(3) }), seq('p D6/w | B5/h A5/h | A5/w | A5/w', { at: B(21) })),
      expr: [[B(3), 0.5], [B(4) + 4, 0.7], [B(21), 0.6], [B(24) + 4, 0.4]] },
    { id: 'cl', inst: 'cl', stem: 'main', legato: true, gain: 0.9, notes: seq('p D4/w | D4/w | B3/w | A3/w', { at: B(21) }) },
    { id: 'harp', inst: 'harp', stem: 'main', gain: 0.5, human: { t: 0.012 },
      notes: cat(seq('p D3/e A3/e D4/e F#4/e A4/h | D3/e A3/e D4/e E4/e A4/h | G2/e D3/e G3/e B3/e D4/h | D3/e A3/e D4/e F#4/e A4/h', { at: B(1) }),
        seq('p D3/q A3/q D4/q F#4/q | B2/q F#3/q B3/q D4/q | A2/q E3/q A3/q C#4/q | G2/q D3/q G3/q B3/q', { at: B(5) }),
        seq('p G2/e D3/e G3/e B3/e D4/h | G2/e D3/e G3/e Bb3/e D4/h | D3/e A3/e D4/e F#4/e A4/h | r/w', { at: B(21) })) },
    { id: 'piano', inst: 'piano', stem: 'main', gain: 0.45, human: { t: 0.01 },
      notes: cat(seq('pp r/h F#5/h | r/h E5/h | r/h D5/h | r/w', { at: B(1) }), seq('p r/w | r/w | D5+F#5+A5/w | r/w', { at: B(21) })) },
    { id: 'timpRoll', inst: 'timpRoll', stem: 'main', gain: 0.5, notes: seq('p A2/w | A2/h. r/q', { at: B(11) }), expr: [[B(11), 0.2], [B(12) + 3, 0.9], [B(12) + 3.9, 0.2]] },
    { id: 'timp', inst: 'timp', stem: 'main', gain: 0.5, notes: seq('mf D3/h r/h', { at: B(13) }) },
    { id: 'cym', inst: 'cymSwell', stem: 'main', gain: 0.3, notes: [{ t: B(13) - 4.8, d: 4, p: [60], v: 0.7 }] },
  ],
};

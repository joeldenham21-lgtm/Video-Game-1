// "Halcyon" — title theme. D minor, 68 bpm, 40 bars (loops).
// 1-4 intro pad · 5-20 theme on celli under a high violin halo · 21-36 theme on horn with violin
// descant, swelling to the climax at 29 · 37-40 coda (piano remembers the opening phrase) → intro.
import { seq, cat } from '../lib/score.mjs';

const B = (n) => (n - 1) * 4; // beat where bar n starts

// the theme (16 bars)
const THEME = `A3/h D4/q E4/q | F4/h. E4/e D4/e | C4/h A3/q C4/q | D4/w |
  A3/h D4/q E4/q | F4/h G4/q A4/q | Bb4/h. A4/e G4/e | A4/w |
  D5/h C5/q Bb4/q | A4/h. G4/e F4/e | G4/h F4/q E4/q | F4/h E4/h |
  D4/h F4/q A4/q | G4/h. F4/e E4/e | F4/q E4/q C#4/q E4/q | D4/w`;

// halo voices over the theme harmony (Dm Bb F/C Bbmaj7 | Dm Gm7 Eb A | Dm Bbmaj7 Gm-C F-A/E | Dm Gm-C Bb-A Dm)
const TOP = 'F5/w | F5/w | F5/w | F5/w | F5/w | F5/w | G5/w | E5/w | F5/w | F5/w | G5/w | F5/h E5/h | F5/w | G5/w | F5/h E5/h | E5/h F5/h';
const MID = 'D5/w | D5/w | C5/w | D5/w | D5/w | D5/w | Eb5/w | C#5/w | D5/w | D5/w | D5/h E5/h | C5/h C#5/h | D5/w | D5/h E5/h | D5/h C#5/h | D5/w';
const LOW = 'A4/w | Bb4/w | A4/w | A4/w | A4/w | Bb4/w | Bb4/w | A4/w | A4/w | A4/w | Bb4/h C5/h | A4/w | A4/w | Bb4/h C5/h | Bb4/h A4/h | A4/w';
const BASS = 'D2/w | Bb1/w | C2/w | Bb1/w | D2/w | G1/w | Eb2/w | A1/w | D2/h C2/h | Bb1/w | G1/h C2/h | F1/h E1/h | D2/w | G1/h C2/h | Bb1/h A1/h | D2/w';

const DESCANT = `r/h A5/h | F5/h. G5/e A5/e | C6/h A5/h | Bb5/h A5/q G5/q |
  A5/w | D6/h C6/q Bb5/q | G5/h Bb5/h | A5/h C#6/h |
  D6/w | C6/h Bb5/h | Bb5/h C6/h | A5/w |
  F5/h A5/h | D6/h. C6/q | D6/h C#6/h | D6/w`;

export default {
  name: 'menu', bpm: 68, beats: 4, bars: 40, loop: true, stems: ['main'], target: -19,
  parts: [
    // ---------------- strings
    { id: 'vln1', inst: 'vln', stem: 'main', legato: true, pan: -0.62, gain: 0.8,
      notes: cat(
        seq('pp A4/w | A4/w | A4/w | A4/h G4/h', { at: B(1) }),
        seq('pp ' + TOP, { at: B(5) }),
        seq('mp ' + DESCANT, { at: B(21) }),
        seq('p A4/w | A4/w | G4/w | A4/w', { at: B(37) })),
      expr: [[B(1), 0.55], [B(5), 0.7], [B(13), 0.85], [B(20), 0.8], [B(21), 0.85], [B(29), 1.15], [B(33), 0.95], [B(36), 0.75], [B(40) + 4, 0.55]] },
    { id: 'vln2', inst: 'vln', stem: 'main', legato: true, pan: -0.3, gain: 0.72,
      notes: cat(
        seq('pp F4/w | F4/w | F4/w | E4/w', { at: B(1) }),
        seq('pp ' + MID, { at: B(5) }),
        seq('p ' + TOP.replace(/5\//g, '4/'), { at: B(21) }),
        seq('pp F4/w | F4/w | D4/w | F4/w', { at: B(37) })),
      expr: [[B(1), 0.6], [B(20), 0.85], [B(29), 1.1], [B(36), 0.8], [B(40) + 4, 0.6]] },
    { id: 'vla', inst: 'vla', stem: 'main', legato: true, gain: 1.35,
      notes: cat(
        seq('pp D4/w | D4/w | D4/w | D4/h C#4/h', { at: B(1) }),
        seq('pp ' + LOW, { at: B(5) }),
        seq('p ' + MID.replace(/5\//g, '4/'), { at: B(21) }),
        seq('pp D4/w | D4/w | Bb3/w | A3/w', { at: B(37) })),
      expr: [[B(1), 0.6], [B(20), 0.85], [B(29), 1.1], [B(36), 0.8], [B(40) + 4, 0.6]] },
    // celli: theme first, then the bass line an octave above the basses
    { id: 'vc', inst: 'vc', stem: 'main', legato: true, gain: 0.95,
      notes: cat(
        seq('pp D3/w | D3/w | Bb2/w | A2/w', { at: B(1) }),
        seq('mp ' + THEME, { at: B(5) }),
        seq('mp ' + BASS.replace(/([A-G][#b]?)([12])\//g, (m, n, o) => n + (+o + 1) + '/'), { at: B(21) }),
        seq('p D3/w | Bb2/w | G2/w | D3/w', { at: B(37) })),
      expr: [[B(1), 0.6], [B(5), 0.85], [B(12), 1.0], [B(13), 1.08], [B(17), 1.0], [B(20), 0.85], [B(21), 0.75], [B(29), 1.0], [B(36), 0.75], [B(40) + 4, 0.6]] },
    { id: 'cb', inst: 'cb', stem: 'main', legato: true, gain: 0.75,
      notes: cat(
        seq('pp D2/w | D2/w | Bb1/w | A1/w', { at: B(1) }),
        seq('p ' + BASS, { at: B(5) }),
        seq('mp ' + BASS, { at: B(21) }),
        seq('pp D2/w | Bb1/w | G1/w | D2/w', { at: B(37) })),
      expr: [[B(1), 0.7], [B(21), 0.9], [B(29), 1.05], [B(40) + 4, 0.7]] },
    // ---------------- horn: theme second time, doubled an octave down at the climax
    { id: 'hn', inst: 'hn', stem: 'main', legato: true, gain: 0.95, pan: -0.28,
      notes: seq('mf ' + THEME, { at: B(21) }),
      expr: [[B(21), 0.8], [B(28), 1.0], [B(29), 1.12], [B(32), 1.0], [B(36) + 3, 0.7]] },
    { id: 'hn2', inst: 'hn', stem: 'main', legato: true, gain: 0.6, pan: -0.4,
      notes: seq('mp D4/h C4/q Bb3/q | A3/h. G3/e F3/e | G3/h F3/q E3/q | F3/h E3/h', { at: B(29) }),
      expr: [[B(29), 0.9], [B(32) + 4, 0.7]] },
    // ---------------- winds: colour only
    { id: 'cl', inst: 'cl', stem: 'main', legato: true, gain: 1.1,
      notes: seq('pp A3/w | Bb3/w | A3/w | A3/w | A3/w | Bb3/w | Bb3/w | A3/w', { at: B(13) }),
      expr: [[B(13), 0.6], [B(17), 0.85], [B(21), 0.5]] },
    { id: 'fl', inst: 'fl', stem: 'main', legato: true, gain: 0.45,
      notes: cat(seq('pp A5/w | r/w', { at: B(3) }), seq('p D6/h C6/q Bb5/q | A5/w', { at: B(29) })),
      expr: [[B(3), 0.5], [B(4), 0.7], [B(5), 0.4], [B(29), 0.8], [B(31), 0.6]] },
    // ---------------- harp & piano: sparse, supporting
    { id: 'harp', inst: 'harp', stem: 'main', gain: 0.55, human: { t: 0.012 },
      notes: cat(
        seq('p D3/e A3/e D4/e F4/e A4/h | r/w | Bb2/e F3/e A3/e D4/e F4/h | r/w', { at: B(1) }),
        seq('p D3/q A3/q D4/q F4/q | r/w | r/w | r/w | D3/q A3/q D4/q F4/q | r/w | Eb3/q Bb3/q Eb4/q G4/q | A2/q E3/q A3/q C#4/q', { at: B(5) }),
        seq('mp D3/q A3/q D4/q F4/q | r/w | G2/q D3/q G3/q Bb3/q | r/w | D3/q A3/q D4/q F4/q | r/w | Bb2/q F3/q Bb3/q D4/q | A2/q E3/q A3/q C#4/q', { at: B(13) }),
        seq('p D3/e A3/e D4/e F4/e A4/h | r/w | r/w | D3/e A3/e D4/e E4/e A4/h', { at: B(37) })) },
    { id: 'piano', inst: 'piano', stem: 'main', gain: 0.5, human: { t: 0.01 },
      notes: cat(
        seq('pp r/h A5/h | r/w | r/h F5/h | r/w', { at: B(1) }),
        seq('p A4/h D5/q E5/q | F5/w | r/w | D4+A4/w', { at: B(37) })) },
    // ---------------- percussion: one swell into the climax
    { id: 'timpRoll', inst: 'timpRoll', stem: 'main', gain: 0.55, notes: seq('p A2/w | A2/h. r/q', { at: B(27) }),
      expr: [[B(27), 0.25], [B(28) + 3, 1.0], [B(28) + 3.9, 0.3]] },
    { id: 'timp', inst: 'timp', stem: 'main', gain: 0.6, notes: seq('mf D3/h r/h', { at: B(29) }) },
    { id: 'cym', inst: 'cymSwell', stem: 'main', gain: 0.35, notes: [{ t: B(29) - 4.5, d: 4, p: [60], v: 0.7 }] },
  ],
};

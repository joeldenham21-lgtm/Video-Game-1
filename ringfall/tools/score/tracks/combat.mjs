// "Aperture" — sector 1 combat. E minor, 128 bpm, 40 bars (75 s loop), three adaptive stems:
//   bed   — voice-led string chords + low strings (plays alone between waves)
//   pulse — spiccato ostinato (3+3+2), basses on the accents
//   drive — orchestral percussion ensemble, horn theme (built on the title motif), low brass
// Form: A 1-8 (i VI iv V) · B 9-16 horn theme · C 17-24 rising build · D 25-32 full statement · E 33-40 breakdown & rebuild
import { seq, cat, ost, grid, midi } from '../lib/score.mjs';

const B = (n) => (n - 1) * 4;
const CH = ['Em', 'Em', 'C', 'C', 'Am', 'Am', 'Bsus', 'B',
  'Em', 'D', 'C', 'Bm', 'Am', 'C', 'D', 'B',
  'C', 'D', 'Em', 'Em', 'C', 'D', 'B', 'B',
  'Em', 'G', 'D', 'A', 'C', 'G', 'D', 'B',
  'Em', 'Em', 'C', 'C', 'Am', 'Am', 'Bsus', 'B'];
// chord tones for the ostinati
const VLA = { Em: 'E3 B3 E4 G3', C: 'C3 G3 C4 E3', Am: 'A3 E4 A4 C4', Bsus: 'B3 F#4 B4 E4', B: 'B3 F#4 B4 D#4', D: 'D3 A3 D4 F#3', Bm: 'B3 F#4 B4 D4', G: 'G3 D4 G4 B3', A: 'A3 E4 A4 C#4' };
const VC = { Em: 'E2 E3', C: 'C2 C3', Am: 'A2 A3', Bsus: 'B2 B3', B: 'B2 B3', D: 'D2 D3', Bm: 'B2 B3', G: 'G2 G3', A: 'A2 A3' };
const CB = { Em: 'E1', C: 'C2', Am: 'A1', Bsus: 'B1', B: 'B1', D: 'D2', Bm: 'B1', G: 'G1', A: 'A1' };
const ARP = { Em: 'E5 B4 G4 B4', C: 'E5 C5 G4 C5', Am: 'E5 C5 A4 C5', Bsus: 'E5 B4 F#4 B4', B: 'D#5 B4 F#4 B4', D: 'D5 A4 F#4 A4', Bm: 'D5 B4 F#4 B4', G: 'D5 B4 G4 B4', A: 'E5 C#5 A4 C#5' };
const range = (a, b) => CH.slice(a - 1, b);

// bed voices (one line per section, whole notes)
const TOP = 'B4 B4 C5 C5 C5 C5 B4 B4 B4 A4 C5 B4 C5 C5 A4 B4 C5 A4 B4 B4 C5 A4 B4 B4 B4 B4 A4 A4 C5 B4 A4 B4 B4 B4 C5 C5 C5 C5 B4 B4';
const MID = 'G4 G4 G4 G4 A4 A4 F#4 F#4 G4 F#4 G4 F#4 A4 G4 F#4 F#4 G4 F#4 G4 G4 G4 F#4 F#4 F#4 G4 G4 F#4 E4 G4 G4 F#4 F#4 G4 G4 G4 G4 A4 A4 F#4 F#4';
const LOW = 'E4 E4 E4 E4 E4 E4 E4 D#4 E4 D4 E4 D4 E4 E4 D4 D#4 E4 D4 E4 E4 E4 D4 D#4 D#4 E4 D4 D4 C#4 E4 D4 D4 D#4 E4 E4 E4 E4 E4 E4 E4 D#4';
const BAS = 'E3 E3 C3 C3 A2 A2 B2 B2 E3 D3 C3 B2 A2 C3 D3 B2 C3 D3 E3 E3 C3 D3 B2 B2 E3 G2 D3 A2 C3 G2 D3 B2 E3 E3 C3 C3 A2 A2 B2 B2';
const whole = (line, tr = 0) => line.split(' ').map((n, i) => ({ t: i * 4, d: 4, p: [midi(n) + tr], v: 0.5 }));
// merge repeated whole notes into longer holds (smoother pads)
const tieRepeats = (ev) => { const out = []; for (const e of ev) { const l = out[out.length - 1]; if (l && l.p[0] === e.p[0] && l.t + l.d === e.t) l.d += e.d; else out.push({ ...e }); } return out; };

const HORN_B = seq(`mf B3/q. E4/e F#4/q G4/q | F#4/h. D4/q | E4/q. G4/e C5/q B4/q | B4/h. F#4/q |
  A4/q. C5/e B4/q A4/q | G4/h E4/h | F#4/q. A4/e D5/h | B4/w`, { at: B(9) });
const HORN_D = seq(`f E4/q. G4/e B4/q E5/q | D5/h. B4/q | A4/h. F#4/q | E4/q. A4/e C#5/q E5/q |
  E5/h. D5/e C5/e | B4/h. G4/q | A4/q. B4/e C5/q D5/q | D#5/h. r/q`, { at: B(25) });
const RISE = seq('mp G4/w | A4/w | B4/w | B4/w | C5/w | D5/w | D#5/w | D#5/w', { at: B(17) });

// percussion grids (16th steps)
const P = {
  bdA: 'X.....x...X.....', frA: '..x...x...x...x.', fsA: '....x.......x..x',
  bdD: 'X..x..X...X...x.', frD: '..x..x..x.x..x.x', fsD: 'x...x...x...x...',
  bdC: 'X.......x.......', bdC2: 'X...x...X...x...', bdC3: 'X.x.X.x.X.x.X.x.',
};
const bars = (pat, from, to, opt = {}) => { const out = []; for (let b = from; b <= to; b++) out.push(...grid(pat, { at: B(b), ...opt })); return out; };
const TIMP = { Em: 'E3', C: 'C3', Am: 'A2', Bsus: 'B2', B: 'B2', D: 'D3', Bm: 'B2', G: 'G2', A: 'A2' };
const timpHits = (from, to, steps, vel = 0.7) => { const out = []; for (let b = from; b <= to; b++) for (const s of steps) out.push({ t: B(b) + s * 0.25, d: 1, p: [midi(TIMP[CH[b - 1]])], v: vel + (s === 0 ? 0.1 : 0) }); return out; };

export default {
  name: 'combat', bpm: 128, beats: 4, bars: 40, loop: true, stems: ['bed', 'pulse', 'drive'], target: -17,
  comp: { drive: { thresh: -20, ratio: 2.2, attack: 0.01, release: 0.15 } },
  parts: [
    // ======================= BED
    { id: 'vln1', inst: 'vln', stem: 'bed', legato: true, pan: -0.6, gain: 0.7, notes: tieRepeats(whole(TOP)),
      expr: [[0, 0.7], [B(9), 0.75], [B(17), 0.8], [B(24) + 4, 1.05], [B(25), 1.0], [B(32) + 4, 1.0], [B(33), 0.65], [B(36), 0.7], [B(40) + 4, 0.8]] },
    { id: 'vln2', inst: 'vln', stem: 'bed', legato: true, pan: -0.3, gain: 0.62, notes: tieRepeats(whole(MID)),
      expr: [[0, 0.7], [B(17), 0.8], [B(24) + 4, 1.0], [B(33), 0.65], [B(40) + 4, 0.8]] },
    { id: 'vla', inst: 'vla', stem: 'bed', legato: true, gain: 1.2, notes: tieRepeats(whole(LOW)),
      expr: [[0, 0.7], [B(17), 0.8], [B(24) + 4, 1.0], [B(33), 0.65], [B(40) + 4, 0.8]] },
    { id: 'vc', inst: 'vc', stem: 'bed', legato: true, gain: 0.8, notes: tieRepeats(whole(BAS)),
      expr: [[0, 0.75], [B(24) + 4, 1.0], [B(33), 0.7], [B(40) + 4, 0.8]] },
    { id: 'cb', inst: 'cb', stem: 'bed', legato: true, gain: 0.6, notes: tieRepeats(whole(BAS, -12)) },
    // a slow cello/viola counter-line so the bed alone still sings (sections B and D)
    { id: 'vcLine', inst: 'vc', stem: 'bed', legato: true, gain: 0.55, pan: 0.3,
      notes: cat(seq('p B3/h. E4/q | D4/w | E4/h G4/h | F#4/w | E4/h. C4/q | E4/w | F#4/h A4/h | F#4/w', { at: B(9) }),
                 seq('p G4/h. B4/q | B4/w | A4/h. F#4/q | E4/w | G4/h. E4/q | D4/w | F#4/h A4/h | F#4/w', { at: B(25) })),
      expr: [[B(9), 0.8], [B(16) + 4, 0.9], [B(25), 0.9], [B(32) + 4, 0.8]] },
    // tremolo shimmer in the build
    { id: 'vlnTrem', inst: 'vlnTrem', stem: 'bed', legato: true, gain: 0.35, pan: -0.5,
      notes: seq('p G5/w | A5/w | B5/w | B5/w | C6/w | D6/w | D#6/w | D#6/w', { at: B(17) }),
      expr: [[B(17), 0.4], [B(24) + 3.5, 1.0], [B(25), 0.2]] },

    // ======================= PULSE
    { id: 'vlaSpic', inst: 'vlaSpic', stem: 'pulse', gain: 0.9, human: { t: 0.004, v: 0.04 },
      notes: ost(CH.map(c => VLA[c]), { pattern: '0 0 1 2 0 1 3 1', step: 0.5, vel: 0.52, accent: '10010010', accVel: 0.22 }),
      expr: [[0, 0.9], [B(24) + 4, 1.05], [B(33), 0.75], [B(40) + 4, 1.0]] },
    { id: 'vcSpic', inst: 'vcSpic', stem: 'pulse', gain: 0.85, human: { t: 0.004, v: 0.04 },
      notes: ost(CH.map(c => VC[c]), { pattern: '0 0 1 0 0 1 0 1', step: 0.5, vel: 0.5, accent: '10010010', accVel: 0.25 }) },
    { id: 'cbSpic', inst: 'cbSpic', stem: 'pulse', gain: 0.7,
      notes: ost(CH.map(c => CB[c]), { pattern: '0 - - 0 - - 0 -', step: 0.5, vel: 0.66, accent: '10010010' }) },
    { id: 'vln2Spic', inst: 'vlnSpic', stem: 'pulse', gain: 0.5, pan: -0.35, human: { t: 0.003 },
      notes: cat(ost(range(17, 32).map(c => ARP[c]), { pattern: '0 1 2 1', step: 0.25, vel: 0.42, accent: '1000', at: B(17) })),
      expr: [[B(17), 0.5], [B(24) + 4, 0.9], [B(25), 0.8], [B(32) + 4, 0.9]] },

    // ======================= DRIVE
    { id: 'bd', inst: 'bd', stem: 'drive', gain: 0.8, human: { t: 0.003 },
      notes: cat(bars(P.bdA, 1, 16), bars(P.bdC, 17, 18), bars(P.bdC2, 19, 22), bars(P.bdC3, 23, 24), bars(P.bdD, 25, 32),
        grid('X...............', { at: B(33) }), grid('X...............', { at: B(35) }), grid('X...............', { at: B(37) }), bars('X.......X.......', 38, 38), bars(P.bdC2, 39, 39), bars(P.bdC3, 40, 40)) },
    { id: 'frame', inst: 'frame', stem: 'drive', gain: 0.65, human: { t: 0.005 },
      notes: cat(bars(P.frA, 1, 16), bars(P.frA, 19, 24), bars(P.frD, 25, 32), bars(P.frA, 39, 40)) },
    { id: 'frameS', inst: 'frameS', stem: 'drive', gain: 0.55, human: { t: 0.005 },
      notes: cat(bars(P.fsA, 5, 16), bars(P.fsD, 21, 32)) },
    { id: 'timp', inst: 'timp', stem: 'drive', gain: 0.75,
      notes: cat(timpHits(9, 16, [0, 8]), timpHits(19, 22, [0, 6, 12]), timpHits(25, 32, [0, 6, 12], 0.78), timpHits(33, 33, [0]), timpHits(35, 35, [0])) },
    { id: 'timpRoll', inst: 'timpRoll', stem: 'drive', gain: 0.6,
      notes: cat(seq('mf B2/w | B2/h. r/q', { at: B(23) }), seq('mf B2/w | B2/h. r/q', { at: B(39) })),
      expr: [[B(23), 0.2], [B(24) + 3.5, 1], [B(24) + 3.9, 0.2], [B(39), 0.2], [B(40) + 3.5, 1], [B(40) + 3.9, 0.2]] },
    { id: 'cym', inst: 'cymSwell', stem: 'drive', gain: 0.4,
      notes: [{ t: B(9) - 4.3, d: 4, p: [60], v: 0.6 }, { t: B(25) - 8.5, d: 8, p: [60], v: 0.95 }, { t: B(33) - 4.3, d: 4, p: [60], v: 0.6 }, { t: B(41) - 8.5, d: 8, p: [60], v: 0.95 }] },
    { id: 'crash', inst: 'crash', stem: 'drive', gain: 0.35, notes: [{ t: B(25), d: 4, p: [60], v: 0.85 }] },
    // horns: theme (B), rising line (C), full statement (D)
    { id: 'hn', inst: 'hn', stem: 'drive', legato: true, unison: 3, gain: 0.95, pan: -0.3, notes: cat(HORN_B, RISE, HORN_D),
      expr: [[B(9), 0.85], [B(16) + 4, 0.9], [B(17), 0.7], [B(24) + 3, 1.05], [B(25), 1.0], [B(32) + 3, 1.05]] },
    // violins double the full statement an octave up
    { id: 'vlnHi', inst: 'vln', stem: 'drive', legato: true, gain: 0.6, pan: -0.55, notes: seq(`f E5/q. G5/e B5/q E6/q | D6/h. B5/q | A5/h. F#5/q | E5/q. A5/e C#6/q E6/q |
      E6/h. D6/e C6/e | B5/h. G5/q | A5/q. B5/e C6/q D6/q | D#6/h. r/q`, { at: B(25) }) },
    // trombones: low chords (A), stabs on the 3+3+2 accents (C, D)
    { id: 'tbn', inst: 'tbn', stem: 'drive', gain: 0.55, pan: 0.4, legato: false, soft: true,
      notes: cat(seq('p E3+B3/w | E3+B3/w | E3+G3/w | E3+G3/w | E3+A3/w | E3+A3/w | E3+B3/w | D#3+B3/w', { at: B(1) }),
                 seq('mp E3+B3/w | D3+A3/w | E3+G3/w | D3+B3/w | E3+A3/w | E3+G3/w | D3+A3/w | D#3+B3/w', { at: B(9) })),
      expr: [[0, 0.7], [B(8), 0.85], [B(9), 0.75], [B(16) + 4, 0.8]] },
    { id: 'tbnStac', inst: 'tbnStac', stem: 'drive', gain: 0.6, pan: 0.4,
      notes: ost(range(17, 32).map(c => ({ Em: 'E3 B3', C: 'E3 G3', D: 'D3 A3', B: 'D#3 B3', G: 'D3 G3', A: 'C#3 A3', Bm: 'D3 B3', Am: 'E3 A3', Bsus: 'E3 B3' })[c]),
        { pattern: '0+1 - - 0+1 - - 0+1 -', step: 0.5, vel: 0.6, accent: '10010010', at: B(17) }) },
    { id: 'tuba', inst: 'tubaStac', stem: 'drive', gain: 0.55,
      notes: ost(range(17, 32).map(c => CB[c].replace('1', '2')), { pattern: '0 - - 0 - - 0 -', step: 0.5, vel: 0.6, accent: '10010010', at: B(17) }) },
    { id: 'tpt', inst: 'tpt', stem: 'drive', legato: true, gain: 0.45, pan: 0.05,
      notes: seq('mf C#5/h E5/h | E5/h. D5/e C5/e | B4/h. G4/q | A4/q. B4/e C5/q D5/q | D#5/h. r/q', { at: B(28) }),
      expr: [[B(28), 0.7], [B(32) + 3, 1.0]] },
  ],
};

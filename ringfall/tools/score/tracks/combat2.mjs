// "Choir Nave" — sector 2 combat. C# minor, 6/8 (♩. = 92 → ♩ = 138), 56 bars (73 s loop).
//   bed   — pipe organ + sustained strings (the Choir's cathedral)
//   pulse — rolling 6/8 spiccato, basses on the dotted quarters
//   drive — horn chant over a trombone/tuba chorale, timpani + bass drum, violins/trumpets in the last statement
// Form: A 1-8 · B 9-24 chant · C 25-32 Phrygian pedal (D over C#) · D 33-48 chant, full · E 49-56 hush & rebuild
import { seq, cat, ost, grid, midi } from '../lib/score.mjs';
import { voiceLead, bassLine, toEvents } from '../lib/harmony.mjs';

const BAR = 3; // quarter-note beats per 6/8 bar
const B = (n) => (n - 1) * BAR;
const CHANT_H = ['C#m', 'B', 'E', 'Amaj7', 'F#m', 'D', 'G#7', 'C#m', 'A', 'B', 'G#m', 'C#m', 'F#m', 'D', 'G#', 'C#m'];
const CH = [
  'C#m', 'C#m', 'A', 'A', 'F#m', 'F#m', 'G#sus', 'G#',
  ...CHANT_H,
  'C#m', 'D/C#', 'C#m', 'D/C#', 'C#m', 'A', 'G#sus', 'G#',
  ...CHANT_H,
  'C#m', 'C#m', 'A', 'A', 'D', 'D', 'G#sus', 'G#',
];
const range = (a, b) => CH.slice(a - 1, b);

// chant melody (16 bars of 6/8)
const CHANT = `C#4/q E4/e G#4/q. | F#4/q E4/e D#4/q. | E4/q F#4/e G#4/q B4/e | A4/q. G#4/q. |
  C#5/q B4/e A4/q G#4/e | F#4/q G#4/e A4/q. | G#4/q F#4/e E4/q D#4/e | C#4/h. |
  E4/q A4/e C#5/q. | D#5/q C#5/e B4/q. | B4/q A4/e G#4/q B4/e | C#5/q. E5/q. |
  A4/q G#4/e F#4/q A4/e | F#4/q. A4/q. | G#4/q A4/e B#4/q. | C#5/h.`;

// organ: four voices led smoothly; pedal on the bass
const [oS, oA, oT] = voiceLead(CH, [{ lo: 'E4', hi: 'C#5', start: 'G#4' }, { lo: 'B3', hi: 'G#4', start: 'E4' }, { lo: 'F#3', hi: 'E4', start: 'C#4' }]);
const bass = bassLine(CH, 'C#2');
// strings bed: high violins double the organ soprano an octave up (sections B, D), cellos on the bass
const [sS, sA] = voiceLead(CH, [{ lo: 'G#4', hi: 'E5', start: 'C#5' }, { lo: 'C#4', hi: 'A4', start: 'G#4' }]);

// pulse chord tones (root, fifth, octave, third) in viola register; cello root/octave
const VL = (s) => { const r = bassLine([s], 'C3')[0]; const third = s.includes('m') && !s.includes('maj') ? 3 : 4; const fifth = s.includes('sus') ? 7 : 7; return [r, r + fifth, r + 12, r + (s.includes('sus') ? 5 : third)]; };
const VCN = (s) => { const r = bassLine([s], 'C2')[0]; return [r, r + 12]; };
const CBN = (s) => [bassLine([s], 'E1')[0]];

const bars = (pat, from, to, opt = {}) => { const out = []; for (let b = from; b <= to; b++) out.push(...grid(pat, { at: B(b), step: 0.5, ...opt })); return out; };
const TIMPN = (s) => { const r = bassLine([s], 'F#2')[0]; return r > midi('D3') ? r - 12 : r; };
const timpHits = (from, to, steps, vel = 0.7) => { const out = []; for (let b = from; b <= to; b++) for (const st of steps) out.push({ t: B(b) + st * 0.5, d: 1, p: [TIMPN(CH[b - 1])], v: vel + (st === 0 ? 0.1 : 0) }); return out; };

export default {
  name: 'combat2', bpm: 138, beats: BAR, bars: 56, loop: true, stems: ['bed', 'pulse', 'drive'], target: -17,
  comp: { drive: { thresh: -20, ratio: 2.2, attack: 0.01, release: 0.15 } },
  parts: [
    // ======================= BED
    { id: 'orgS', inst: 'organ', stem: 'bed', legato: true, gain: 0.55, notes: toEvents(oS, BAR, { vel: 0.5 }), eq: [['peak', 2500, 1, -2]],
      expr: [[0, 0.8], [B(25), 0.9], [B(33), 1.0], [B(49), 0.8], [B(57), 0.8]] },
    { id: 'orgA', inst: 'organ', stem: 'bed', legato: true, gain: 0.5, notes: toEvents(oA, BAR, { vel: 0.5 }), eq: [['peak', 2500, 1, -2]] },
    { id: 'orgT', inst: 'organ', stem: 'bed', legato: true, gain: 0.5, notes: toEvents(oT, BAR, { vel: 0.5 }), eq: [['peak', 2500, 1, -2]] },
    { id: 'orgP', inst: 'organPed', stem: 'bed', legato: true, gain: 0.6, notes: toEvents(bass, BAR, { vel: 0.5 }) },
    { id: 'vln', inst: 'vln', stem: 'bed', legato: true, gain: 0.55, pan: -0.55,
      notes: cat(toEvents(sS.slice(8, 24), BAR, { at: B(9), vel: 0.45 }), toEvents(sS.slice(32, 48), BAR, { at: B(33), vel: 0.55 })),
      expr: [[B(9), 0.7], [B(24) + 3, 0.8], [B(33), 0.85], [B(48) + 3, 0.95]] },
    { id: 'vla', inst: 'vla', stem: 'bed', legato: true, gain: 1.0,
      notes: cat(toEvents(sA.slice(8, 24), BAR, { at: B(9), vel: 0.45 }), toEvents(sA.slice(32, 48), BAR, { at: B(33), vel: 0.5 })) },
    { id: 'vcTrem', inst: 'vcTrem', stem: 'bed', legato: true, gain: 0.5,
      notes: toEvents(bassLine(range(25, 32), 'C#3'), BAR, { at: B(25), vel: 0.5 }), expr: [[B(25), 0.5], [B(32) + 3, 1.0], [B(33), 0.4]] },
    { id: 'vlnTrem', inst: 'vlnTrem', stem: 'bed', legato: true, gain: 0.3, pan: -0.4,
      notes: seq('p C#6/h. | D6/h. | C#6/h. | D6/h. | C#6/h. | C#6/h. | B5/h. | B#5/h.', { at: B(25) }), expr: [[B(25), 0.4], [B(32) + 2.5, 1.0], [B(33), 0.3]] },

    // ======================= PULSE (rolling 6/8: six 8ths, accents on 1 and 4)
    { id: 'vlaSpic', inst: 'vlaSpic', stem: 'pulse', gain: 0.9, human: { t: 0.004, v: 0.04 },
      notes: ost(CH.map(VL), { pattern: '0 1 2 1 3 1', step: 0.5, beats: BAR, vel: 0.5, accent: '100100', accVel: 0.22 }),
      expr: [[0, 0.85], [B(25), 0.95], [B(48) + 3, 1.05], [B(49), 0.7], [B(56) + 3, 0.95]] },
    { id: 'vcSpic', inst: 'vcSpic', stem: 'pulse', gain: 0.85, human: { t: 0.004 },
      notes: ost(CH.map(VCN), { pattern: '0 - 1 0 - 1', step: 0.5, beats: BAR, vel: 0.52, accent: '100100', accVel: 0.22 }) },
    { id: 'cbPizz', inst: 'cbPizz', stem: 'pulse', gain: 0.8,
      notes: ost(CH.map(CBN), { pattern: '0 - - 0 - -', step: 0.5, beats: BAR, vel: 0.62, accent: '100000' }) },
    { id: 'vlnSpic', inst: 'vlnSpic', stem: 'pulse', gain: 0.45, pan: -0.35,
      notes: ost(range(33, 48).map(s => VL(s).map(n => n + 12)), { pattern: '2 1 0 1 3 1', step: 0.5, beats: BAR, vel: 0.42, accent: '100100', at: B(33) }),
      expr: [[B(33), 0.7], [B(48) + 3, 1.0]] },

    // ======================= DRIVE
    { id: 'bd', inst: 'bd', stem: 'drive', gain: 0.8,
      notes: cat(bars('X.....', 1, 8), bars('X..x..', 9, 24), bars('X..X..', 25, 30), bars('X.xX.x', 31, 32), bars('X..x.x', 33, 48), bars('X.....', 49, 49), bars('X.....', 53, 53), bars('X..x..', 55, 55), bars('X.xX.x', 56, 56)) },
    { id: 'frame', inst: 'frame', stem: 'drive', gain: 0.6, human: { t: 0.005 },
      notes: cat(bars('..x.x.', 9, 24), bars('.xx.xx', 25, 32), bars('.x..xx', 33, 48)) },
    { id: 'frameS', inst: 'frameS', stem: 'drive', gain: 0.5, notes: bars('x.xx.x', 33, 48, { vel: { x: 0.5, X: 0.8 } }) },
    { id: 'timp', inst: 'timp', stem: 'drive', gain: 0.75,
      notes: cat(timpHits(1, 8, [0]), timpHits(9, 24, [0, 3], 0.66), timpHits(25, 32, [0, 2, 3, 5], 0.62), timpHits(33, 48, [0, 3], 0.74)) },
    { id: 'timpRoll', inst: 'timpRoll', stem: 'drive', gain: 0.6,
      notes: cat(seq('mf G#2/h. | G#2/q. r/q.', { at: B(31) }), seq('mf G#2/h. | G#2/q. r/q.', { at: B(55) })),
      expr: [[B(31), 0.25], [B(32) + 1.4, 1], [B(32) + 1.6, 0.2], [B(55), 0.25], [B(56) + 1.4, 1], [B(56) + 1.6, 0.2]] },
    { id: 'cym', inst: 'cymSwell', stem: 'drive', gain: 0.4,
      notes: [{ t: B(9) - 4.6, d: 4, p: [60], v: 0.6 }, { t: B(33) - 9.2, d: 8, p: [60], v: 0.95 }, { t: B(57) - 9.2, d: 8, p: [60], v: 0.95 }] },
    { id: 'gong', inst: 'gong', stem: 'drive', gain: 0.35, notes: [{ t: B(25), d: 6, p: [60], v: 0.5 }, { t: B(33), d: 6, p: [60], v: 0.7 }] },
    // horns: the chant (B), and again with violins an octave up (D)
    { id: 'hn', inst: 'hn', stem: 'drive', legato: true, unison: 3, gain: 0.95, pan: -0.3,
      notes: cat(seq('mf ' + CHANT, { at: B(9) }), seq('f ' + CHANT, { at: B(33) })),
      expr: [[B(9), 0.85], [B(24) + 3, 0.9], [B(33), 1.0], [B(48) + 3, 1.05]] },
    { id: 'vlnHi', inst: 'vln', stem: 'drive', legato: true, gain: 0.6, pan: -0.6, notes: seq('f ' + CHANT, { at: B(33), tr: 12 }),
      expr: [[B(33), 0.8], [B(41), 1.0], [B(48) + 3, 1.05]] },
    // chorale under the chant: trombones in two voices, tuba on the bass
    { id: 'tbn1', inst: 'tbn', stem: 'drive', legato: true, gain: 0.45, pan: 0.35,
      notes: cat(toEvents(voiceLead(CHANT_H, [{ lo: 'A3', hi: 'F4', start: 'E4' }])[0], BAR, { at: B(9), vel: 0.52 }), toEvents(voiceLead(CHANT_H, [{ lo: 'A3', hi: 'F4', start: 'E4' }])[0], BAR, { at: B(33), vel: 0.62 })) },
    { id: 'tbn2', inst: 'tbn', stem: 'drive', legato: true, gain: 0.45, pan: 0.45,
      notes: cat(toEvents(voiceLead(CHANT_H, [{ lo: 'D3', hi: 'A3', start: 'G#3' }])[0], BAR, { at: B(9), vel: 0.5 }), toEvents(voiceLead(CHANT_H, [{ lo: 'D3', hi: 'A3', start: 'G#3' }])[0], BAR, { at: B(33), vel: 0.6 })) },
    { id: 'tuba', inst: 'tuba', stem: 'drive', legato: true, gain: 0.5,
      notes: cat(toEvents(bassLine(CHANT_H, 'C#2'), BAR, { at: B(9), vel: 0.5 }), toEvents(bassLine(CHANT_H, 'C#2'), BAR, { at: B(33), vel: 0.6 })) },
    // Phrygian section: brass stabs on the dotted quarters
    { id: 'tbnStac', inst: 'tbnStac', stem: 'drive', gain: 0.6, pan: 0.4,
      notes: ost(range(25, 32).map(s => { const r = bassLine([s], 'C#3')[0]; return [r, r + 7]; }), { pattern: '0+1 - - 0+1 - -', step: 0.5, beats: BAR, vel: 0.62, accent: '100100', at: B(25) }) },
    { id: 'tpt', inst: 'tpt', stem: 'drive', legato: true, gain: 0.42,
      notes: seq('mf C#5/h. | D#5/h. | B4/h. | E5/h. | C#5/h. | A4/h. | B#4/h. | C#5/h.', { at: B(41) }), expr: [[B(41), 0.7], [B(48) + 3, 1.0]] },
  ],
};

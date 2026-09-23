// Short orchestral cues, one per musical context (key of the track they sit on).
import { seq } from '../lib/score.mjs';
import { chord, bassLine } from '../lib/harmony.mjs';
import { midi } from '../lib/score.mjs';

const KEYS = { combat: 'E', combat2: 'C#', boss: 'G', final: 'D' };
const semis = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const tr = (k) => ((semis[k] - semis.E) + 12) % 12 > 6 ? ((semis[k] - semis.E) + 12) % 12 - 12 : ((semis[k] - semis.E) + 12) % 12;
const T = (s, k) => s.replace(/([A-G][#b]?)(\d)/g, (m) => { const n = midi(m) + tr(k); return nn(n); });
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nn = (n) => NAMES[n % 12] + (Math.floor(n / 12) - 1);
const base = { beats: 4, bars: 2, loop: false, stems: ['main'], tail: 3.5, pad: 1.5 };

// wave start: a short brass/timpani call on the tonic (written in E, transposed per key)
const waveStart = (k) => ({ ...base, name: 'waveStart_' + k, bpm: 120, bars: 1, target: -16, lead: 0.05,
  parts: [
    { id: 'tbn', inst: 'tbnStac', stem: 'main', gain: 0.8, notes: seq(T('f E3+B3/q', k)) },
    { id: 'hn', inst: 'hn', stem: 'main', gain: 0.7, unison: 3, notes: seq(T('mf B3+E4/h.', k)), rel: 0.6 },
    { id: 'tuba', inst: 'tubaStac', stem: 'main', gain: 0.7, notes: seq(T('f E2/q', k)) },
    { id: 'vc', inst: 'vcSpic', stem: 'main', gain: 0.8, notes: seq(T('f E2+E3/q', k)) },
    { id: 'timp', inst: 'timp', stem: 'main', gain: 0.8, notes: seq(T('f E2/q', k).replace(/[A-G][#b]?1/, m => m.replace('1', '2'))) },
    { id: 'bd', inst: 'bd', stem: 'main', gain: 0.7, notes: [{ t: 0, d: 1, p: [60], v: 0.85 }] },
  ] });

// sector clear: iv - V - I (major), strings + horns swell, timpani roll
const sectorClear = (k) => ({ ...base, name: 'sectorClear_' + k, bpm: 96, bars: 3, target: -18,
  parts: [
    { id: 'vln', inst: 'vln', stem: 'main', legato: true, gain: 0.6, pan: -0.55, notes: seq(T('mf E5/e F#5/e G#5/h.', k)), expr: [[0, 0.7], [1, 1.0], [5, 0.7]] },
    { id: 'vla', inst: 'vla', stem: 'main', legato: true, gain: 1.0, notes: seq(T('mf C5/e D5/e E5/h.', k)) },
    { id: 'vc', inst: 'vc', stem: 'main', legato: true, gain: 0.7, notes: seq(T('mf A3/e B3/e E3/h.', k)) },
    { id: 'hn', inst: 'hn', stem: 'main', legato: true, unison: 3, gain: 0.75, notes: seq(T('mf A3/e B3/e B3/h.', k)), expr: [[0, 0.8], [1.5, 1.0], [5, 0.75]] },
    { id: 'cb', inst: 'cb', stem: 'main', legato: true, gain: 0.55, notes: seq(T('mf A2/e B2/e E2/h.', k).replace(/([A-G][#b]?)3/g, '$12')) },
    { id: 'timpRoll', inst: 'timpRoll', stem: 'main', gain: 0.5, notes: seq(T('mp B2/q r/h.', k)), expr: [[0, 0.3], [0.9, 1.0], [1.0, 0.1]] },
    { id: 'timp', inst: 'timp', stem: 'main', gain: 0.6, notes: [{ t: 1, d: 1, p: [bassLine([k], 'D2')[0]], v: 0.7 }] },
    { id: 'cym', inst: 'cymSwell', stem: 'main', gain: 0.3, notes: [{ t: -0.9, d: 2, p: [60], v: 0.2 }] },
  ] });

// boss defeated: timpani roll into a full-orchestra major chord, crash + gong
const bossDefeated = (k) => ({ ...base, name: 'bossDefeated_' + k, bpm: 90, bars: 4, target: -15, tail: 5,
  parts: [
    { id: 'timpRoll', inst: 'timpRoll', stem: 'main', gain: 0.65, notes: seq(T('mf B2/h. r/q', k)), expr: [[0, 0.2], [2.9, 1.0], [3.0, 0.1]] },
    { id: 'timp', inst: 'timp', stem: 'main', gain: 0.8, notes: [{ t: 3, d: 2, p: [bassLine([k], 'D2')[0]], v: 0.95 }] },
    { id: 'bd', inst: 'bd', stem: 'main', gain: 0.8, notes: [{ t: 3, d: 2, p: [60], v: 0.95 }] },
    { id: 'crash', inst: 'crash', stem: 'main', gain: 0.45, notes: [{ t: 3, d: 4, p: [60], v: 0.9 }] },
    { id: 'gong', inst: 'gong', stem: 'main', gain: 0.5, notes: [{ t: 3, d: 6, p: [60], v: 0.85 }] },
    { id: 'cym', inst: 'cymSwell', stem: 'main', gain: 0.35, notes: [{ t: 3 - 2.9, d: 2, p: [60], v: 0.3 }] },
    { id: 'hn', inst: 'hn', stem: 'main', legato: true, unison: 3, gain: 0.95, notes: seq(T('f C4/q D4/q r/q G#4+B4/w~ G#4+B4/w', k)), expr: [[0, 0.8], [3, 1.05], [11, 0.6]] },
    { id: 'tpt', inst: 'tpt', stem: 'main', legato: true, unison: 2, gain: 0.6, notes: seq(T('f r/h. E5/w~ E5/w', k)), expr: [[3, 1.0], [11, 0.55]] },
    { id: 'tbn', inst: 'tbn', stem: 'main', unison: 2, gain: 0.6, notes: seq(T('f r/h. E3+B3/w~ E3+B3/w', k)) },
    { id: 'tuba', inst: 'tuba', stem: 'main', gain: 0.6, notes: seq(T('f r/h. E2/w~ E2/w', k)) },
    { id: 'vln', inst: 'vln', stem: 'main', legato: true, gain: 0.65, pan: -0.55, notes: seq(T('f A5/q B5/q r/q B5+E6/w~ B5+E6/w', k)), expr: [[3, 1.0], [11, 0.55]] },
    { id: 'vla', inst: 'vla', stem: 'main', legato: true, gain: 1.0, notes: seq(T('f r/h. G#4/w~ G#4/w', k)) },
    { id: 'vc', inst: 'vc', stem: 'main', legato: true, gain: 0.75, notes: seq(T('f A2/q B2/q r/q E3/w~ E3/w', k)) },
    { id: 'cb', inst: 'cb', stem: 'main', legato: true, gain: 0.6, notes: seq(T('f A1/q B1/q r/q E2/w~ E2/w', k)) },
  ] });

// death: horns fall over a low D minor pedal, gong
const death = { ...base, name: 'death', bpm: 60, bars: 2, target: -19, tail: 4.5,
  parts: [
    { id: 'hn', inst: 'hn', stem: 'main', legato: true, unison: 2, gain: 0.85, notes: seq('mf A3/q G3/q F3/q E3/q | D3/w'), expr: [[0, 1.0], [8, 0.5]] },
    { id: 'vc', inst: 'vc', stem: 'main', legato: true, gain: 0.8, notes: seq('mp D3+A3/w | D3/w'), expr: [[0, 0.9], [8, 0.5]] },
    { id: 'cb', inst: 'cb', stem: 'main', legato: true, gain: 0.7, notes: seq('mp D2/w | D2/w') },
    { id: 'vla', inst: 'vlaTrem', stem: 'main', legato: true, gain: 0.6, notes: seq('p F4/w | F4/w'), expr: [[0, 0.7], [8, 0.3]] },
    { id: 'gong', inst: 'gong', stem: 'main', gain: 0.4, notes: [{ t: 0, d: 6, p: [60], v: 0.35 }] },
    { id: 'timp', inst: 'timp', stem: 'main', gain: 0.6, notes: [{ t: 0, d: 2, p: [midi('D2')], v: 0.7 }, { t: 4, d: 2, p: [midi('D2')], v: 0.5 }] },
  ] };

// augment: a soft string/flute swell on the tonic (major add9), no plucked notes
const augment = (k) => ({ ...base, name: 'augment_' + k, bpm: 90, bars: 1, target: -21, tail: 2.5,
  parts: [
    { id: 'vln', inst: 'vln', stem: 'main', gain: 0.55, soft: true, pan: -0.5, notes: seq(T('p B4+F#5/w', k)), expr: [[0, 0.4], [1.8, 1.0], [4, 0.3]] },
    { id: 'vla', inst: 'vla', stem: 'main', gain: 1.0, soft: true, notes: seq(T('p G#4/w', k)), expr: [[0, 0.4], [1.8, 1.0], [4, 0.3]] },
    { id: 'vc', inst: 'vc', stem: 'main', gain: 0.7, soft: true, notes: seq(T('p E3/w', k)), expr: [[0, 0.5], [1.8, 1.0], [4, 0.4]] },
    { id: 'fl', inst: 'fl', stem: 'main', gain: 0.45, legato: true, notes: seq(T('p E5/q F#5/q B5/h', k)), expr: [[0, 0.6], [2, 1.0], [4, 0.4]] },
  ] });

export default [
  ...Object.keys(KEYS).map(k => waveStart(KEYS[k])).map((t, i) => ({ ...t, name: 'waveStart_' + Object.keys(KEYS)[i] })),
  ...['combat', 'combat2'].map(n => ({ ...sectorClear(KEYS[n]), name: 'sectorClear_' + n })),
  ...['boss', 'final'].map(n => ({ ...bossDefeated(KEYS[n]), name: 'bossDefeated_' + n })),
  death,
  ...Object.keys(KEYS).map(n => ({ ...augment(KEYS[n]), name: 'augment_' + n })),
];

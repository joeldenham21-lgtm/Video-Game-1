// Chord symbols → pitch classes, and greedy smooth voice leading for pad/sustain parts.
import { midi } from './score.mjs';

const PCN = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, 'B#': 0, 'E#': 5 };
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus: [0, 5, 7], sus4: [0, 5, 7], sus2: [0, 2, 7],
  7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], m6: [0, 3, 7, 9], 6: [0, 4, 7, 9], add9: [0, 4, 7, 2], madd9: [0, 3, 7, 2],
  '7sus': [0, 5, 7, 10], m9: [0, 3, 7, 10, 2], 'maj7#11': [0, 4, 7, 11, 6], 5: [0, 7],
};
export function chord(sym) {
  const [main, slash] = sym.split('/');
  const m = main.match(/^([A-G](?:#|b)?)(.*)$/);
  const root = PCN[m[1]];
  const q = QUAL[m[2]];
  if (q == null) throw new Error('chord quality ' + sym);
  const pcs = q.map(i => (root + i) % 12);
  const bass = slash ? PCN[slash] : root;
  return { root, pcs, bass, core: [pcs[0], pcs[1], pcs[2] ?? pcs[1]] };
}

/**
 * voices: [{ lo: 'E4', hi: 'B5', start: 'B4' }, ...] top→bottom. Returns one note list per voice
 * (MIDI numbers, one per chord). Keeps common tones, moves by the smallest step, covers root/3rd/5th first.
 */
export function voiceLead(symbols, voices) {
  const lines = voices.map(() => []);
  let prev = voices.map(v => midi(v.start));
  for (const sym of symbols) {
    const c = chord(sym);
    const want = [...new Set(c.pcs)];
    const used = new Map();
    const cur = [];
    // voices with a common tone keep it
    voices.forEach((v, i) => { if (want.includes(((prev[i] % 12) + 12) % 12)) { cur[i] = prev[i]; used.set(prev[i] % 12, (used.get(prev[i] % 12) || 0) + 1); } });
    voices.forEach((v, i) => {
      if (cur[i] != null) return;
      const lo = midi(v.lo), hi = midi(v.hi);
      let best = null, bestCost = Infinity;
      for (let n = lo; n <= hi; n++) {
        const pc = n % 12;
        if (!want.includes(pc)) continue;
        const dup = used.get(pc) || 0;
        const missing = want.slice(0, 3).filter(p => !used.has(p)).length;
        const cost = Math.abs(n - prev[i]) + dup * 6 + (missing && used.has(pc) ? 4 : 0) + (pc === c.pcs[2] && want.length > 3 ? 1 : 0);
        if (cost < bestCost) { bestCost = cost; best = n; }
      }
      cur[i] = best;
      used.set(best % 12, (used.get(best % 12) || 0) + 1);
    });
    // no crossed voices
    for (let i = 1; i < cur.length; i++) if (cur[i] >= cur[i - 1]) { const t = cur[i]; cur[i] = cur[i - 1]; cur[i - 1] = t; }
    cur.forEach((n, i) => lines[i].push(n));
    prev = cur;
  }
  return lines;
}

// bass notes for chords in a register (lowest instance of bass pc ≥ lo)
export function bassLine(symbols, lo = 'E1', span = 15) {
  const l = midi(lo);
  let prev = null;
  return symbols.map(s => {
    const b = chord(s).bass;
    const opts = [];
    for (let n = l; n <= l + span; n++) if (n % 12 === b) opts.push(n);
    // first chord: lowest option; afterwards: the option nearest the previous bass note
    const pick = prev == null ? opts[0] : opts.reduce((a, c) => Math.abs(c - prev) < Math.abs(a - prev) ? c : a);
    prev = pick;
    return pick;
  });
}

// turn per-chord notes into events: durations per chord in beats (number or array), tie repeats
export function toEvents(notes, dur, { at = 0, vel = 0.5, tie = true } = {}) {
  const out = [];
  let t = at;
  notes.forEach((n, i) => {
    const d = Array.isArray(dur) ? dur[i] : dur;
    const last = out[out.length - 1];
    if (tie && last && last.p[0] === n && Math.abs(last.t + last.d - t) < 1e-6) last.d += d;
    else out.push({ t, d, p: [n], v: vel });
    t += d;
  });
  return out;
}

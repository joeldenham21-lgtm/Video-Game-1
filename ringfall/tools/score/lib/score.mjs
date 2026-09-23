// Score notation for the soundtrack.
//  seq('mf D4/q E4/e F4/e | A4/h. G4/q')   durations: w h q e s, t = triplet 8th, T = triplet quarter,
//     numbers = beats; '.' dots; mods: ^ accent, ! marcato, ' staccato, ~ tie into the next note;
//     chords join with '+': 'D3+A3+F4/w'; 'r' is a rest; dynamics ppp..fff set velocity.
import { parseNote } from './names.mjs';

const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3, T: 2 / 3, x: 1 / 6 };
const DYN = { ppp: 0.14, pp: 0.24, p: 0.36, mp: 0.48, mf: 0.6, f: 0.74, ff: 0.87, fff: 0.97 };

export function midi(n) {
  if (typeof n === 'number') return n;
  const m = parseNote('_' + n + '_');
  if (m == null) throw new Error('bad note ' + n);
  return m;
}

export function seq(str, { vel = 0.6, at = 0, tr = 0 } = {}) {
  const ev = [];
  let t = at, dur = 1, v = vel, tie = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    if (DYN[tok] != null) { v = DYN[tok]; continue; }
    const m = tok.match(/^([^/]+)(?:\/([whqesTtx]|\d+(?:\.\d+)?)(\.*))?([\^!'~_]*)$/);
    if (!m) throw new Error('bad token ' + tok);
    if (m[2]) { dur = DUR[m[2]] ?? parseFloat(m[2]); dur *= [1, 1.5, 1.75][m[3].length]; }
    const mods = m[4] || '';
    if (m[1] !== 'r') {
      const ps = m[1].split('+').map(x => midi(x) + tr);
      let vv = v + (mods.includes('^') ? 0.12 : 0) + (mods.includes('!') ? 0.22 : 0);
      const d = mods.includes("'") ? dur * 0.45 : dur;
      if (tie && tie.p.join() === ps.join()) { tie.d += d; tie.tie = mods.includes('~'); if (!tie.tie) tie = null; }
      else {
        const e = { t, d, p: ps, v: Math.min(1, vv), tie: mods.includes('~'), acc: mods.includes('^') || mods.includes('!') };
        ev.push(e);
        tie = e.tie ? e : null;
      }
    } else tie = null;
    t += dur;
  }
  ev.len = t - at;
  return ev;
}

// helpers -------------------------------------------------------------------
export const cat = (...lists) => { const out = []; for (const l of lists) out.push(...l); return out; };
export const shift = (ev, b) => ev.map(e => ({ ...e, t: e.t + b }));
export const transpose = (ev, s) => ev.map(e => ({ ...e, p: e.p.map(x => x + s) }));
export const vel = (ev, k) => ev.map(e => ({ ...e, v: Math.min(1, e.v * k) }));
export function rep(ev, times, len) { const out = []; for (let i = 0; i < times; i++) out.push(...shift(ev, i * len)); return out; }

// Ostinato over a harmony: chords = one array of notes per bar; pattern picks chord tones per step.
// pattern: '0 1 2 1 3 1 2 1' ('-' rest); accents: '1..1..1.' uppercase-style emphasis mask
export function ost(chords, { pattern, step = 0.5, beats = 4, vel = 0.6, accent = '', accVel = 0.18, len = 0.9, at = 0, swingTo = null } = {}) {
  const steps = pattern.trim().split(/\s+/);
  const out = [];
  chords.forEach((ch, bar) => {
    const notes = (typeof ch === 'string' ? ch.split(/[\s,]+/) : ch).map(midi);
    const per = Math.round(beats / step);
    for (let i = 0; i < per; i++) {
      const s = steps[i % steps.length];
      if (s === '-') continue;
      const idx = s.split('+').map(Number);
      const acc = accent[i % Math.max(1, accent.length)] === '1';
      out.push({ t: at + bar * beats + i * step, d: step * len, p: idx.map(k => notes[k % notes.length] + 12 * Math.floor(k / notes.length)), v: Math.min(1, vel + (acc ? accVel : 0)), acc });
    }
  });
  return out;
}

// Percussion grid: 'X..x..x.' X = accent, x = normal, o = soft, g = ghost; one char per step.
export function grid(str, { step = 0.25, at = 0, vel = { X: 0.95, x: 0.72, o: 0.5, g: 0.3 }, note = 60 } = {}) {
  const out = [];
  const s = str.replace(/[\s|]/g, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (vel[c] == null) continue;
    out.push({ t: at + i * step, d: step, p: [note], v: vel[c], acc: c === 'X' });
  }
  out.len = s.length * step;
  return out;
}

// Expression curve helpers: [[beat, level], ...] linear
export function curve(...pts) { return pts; }

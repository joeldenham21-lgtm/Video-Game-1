// Multi-sample instruments built from CC0 recordings (VSCO-2 CE, VCSL).
// Zones are parsed from file names (note, dynamic layer, round robin); pitch offsets are
// verified against YIN estimates. Voices render with cubic interpolation, legato slurs,
// crossfade looping for long holds, and per-note release.
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readWav } from './wav.mjs';
import { yin, midiOf } from './pitch.mjs';
import { parseNote, parseLayer, parseRR } from './names.mjs';
import { timpaniPitch } from './timpitch.mjs';

export const SR = 44100;
const ROOT = process.env.SCORE_SAMPLES || new URL('../samples/', import.meta.url).pathname;
const CACHE = new URL('../cache/', import.meta.url).pathname;
mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------- sample analysis
function envelope(L, R, win) {
  const n = Math.floor(L.length / win), e = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * win; i < (k + 1) * win; i++) s += L[i] * L[i] + R[i] * R[i];
    e[k] = Math.sqrt(s / (2 * win));
  }
  return e;
}

// loads, trims leading silence, finds where the note "speaks" and where its sustain ends
function loadSample(path, kind) {
  const w = readWav(path);
  let { L, R } = w;
  if (w.sr !== SR) {
    // resample (rare): linear is fine for the few files that need it
    const ratio = w.sr / SR, n = Math.floor(L.length / ratio);
    const nl = new Float32Array(n), nr = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = i * ratio, j = Math.floor(p), f = p - j; nl[i] = L[j] + (L[j + 1] - L[j]) * f || 0; nr[i] = R[j] + (R[j + 1] - R[j]) * f || 0; }
    L = nl; R = nr;
  }
  let pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const th = pk * 0.006;
  let on = 0;
  while (on < L.length && Math.abs(L[on]) < th && Math.abs(R[on]) < th) on++;
  on = Math.max(0, on - Math.floor(0.002 * SR));
  L = L.subarray(on); R = R.subarray(on);
  const win = Math.floor(0.02 * SR);
  const env = envelope(L, R, win);
  let emax = 0, emaxI = 0;
  const early = Math.min(env.length, Math.floor(0.6 * SR / win));
  for (let k = 0; k < early; k++) if (env[k] > emax) { emax = env[k]; emaxI = k; }
  // legato entry point: once the bow/breath has settled (65% of the early peak)
  let spk = 0;
  for (let k = 0; k <= emaxI; k++) if (env[k] >= emax * 0.65) { spk = k; break; }
  const speak = Math.min(spk * win, Math.floor(0.22 * SR));
  // sustain end: last point the level holds near the body level (samples end in a release)
  let sEnd = L.length;
  if (kind === 'sus') {
    const body = env.slice(Math.floor(0.4 * SR / win), Math.floor(env.length * 0.7));
    const med = body.length ? Float32Array.from(body).sort()[body.length >> 1] : emax;
    let k = env.length - 1;
    while (k > 0 && env[k] < med * 0.55) k--;
    sEnd = Math.max(Math.floor(SR * 1.0), k * win);
  }
  // loudness reference: RMS of the sustained body, or of the loudest 100 ms for struck/plucked sounds
  let rms;
  if (kind === 'sus') {
    const b0 = speak + Math.floor(0.15 * SR), b1 = Math.min(L.length, b0 + Math.floor(1.2 * SR));
    let s = 0;
    for (let i = b0; i < b1; i++) s += L[i] * L[i] + R[i] * R[i];
    rms = Math.sqrt(s / Math.max(1, 2 * (b1 - b0)));
  } else {
    let best = 0;
    for (let k = 0; k + 5 <= env.length; k++) { const m = (env[k] ** 2 + env[k + 1] ** 2 + env[k + 2] ** 2 + env[k + 3] ** 2 + env[k + 4] ** 2) / 5; if (m > best) best = m; }
    rms = Math.sqrt(best);
  }
  return { L, R, n: L.length, speak, sEnd, rms, peak: pk };
}

function detectRoot(path) {
  const w = readWav(path);
  let pk = 0, pi = 0;
  for (let i = 0; i < w.n; i++) { const a = Math.abs(w.L[i]); if (a > pk) { pk = a; pi = i; } }
  const est = [];
  for (const t of [0.15, 0.3, 0.5]) {
    const st = pi + Math.floor(t * w.sr), len = 16384;
    if (st + len * 1.5 >= w.n) continue;
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) x[i] = w.L[st + i] + w.R[st + i];
    est.push(midiOf(yin(x, w.sr, 40, 400)));
  }
  if (est.length < 2) return null;
  est.sort((a, b) => a - b);
  const med = est[est.length >> 1];
  if (est.some(e => Math.abs(e - med) > 0.7)) return null; // unreliable
  return med;
}

// ---------------------------------------------------------------- instruments
export class Instrument {
  constructor(id, def) {
    this.id = id;
    this.def = def;
    this.kind = def.kind || 'sus';
    this.zones = [];
    const dirs = Array.isArray(def.dir) ? def.dir : [def.dir];
    for (const d of dirs) {
      const dir = join(ROOT, d);
      if (!existsSync(dir)) throw new Error(`missing ${dir}`);
      for (const f of readdirSync(dir)) {
        if (!f.toLowerCase().endsWith('.wav')) continue;
        if (def.match && !def.match.test(f)) continue;
        if (def.exclude && def.exclude.test(f)) continue;
        const path = join(dir, f);
        let midi = def.unpitched ? 60 : parseNote(f);
        if (!def.unpitched && def.detect) midi = null;
        if (midi == null && !def.unpitched) {
          if (!def.detect) continue;
          midi = this.cachedRoot(path);
          if (midi == null) continue;
          midi += def.oct || 0;
        } else if (!def.unpitched) midi += def.oct || 0;
        const layer = def.layerOf ? def.layerOf(f) : parseLayer(f);
        this.zones.push({ path, midi, layer, rr: parseRR(f), file: f, s: null });
      }
    }
    // pitched percussion: all files of one drum/tuning share the group's median pitch; unstable groups are dropped
    if (def.detect && def.groupOf) {
      const groups = new Map();
      for (const z of this.zones) { const g = def.groupOf(z.file); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(z); }
      const keep = [];
      for (const [g, zs] of groups) {
        const ms = zs.map(z => z.midi).sort((a, b) => a - b), med = ms[ms.length >> 1];
        const agree = zs.filter(z => Math.abs(z.midi - med) < 0.6);
        if (agree.length < Math.max(2, zs.length * 0.6)) continue;
        for (const z of agree) { z.midi = med; keep.push(z); }
      }
      this.zones = keep;
    }
    if (!this.zones.length) throw new Error(`no zones for ${id}`);
    this.layers = [...new Set(this.zones.map(z => z.layer))].sort((a, b) => a - b);
    this.rrCount = 0;
    this.norm = null;
  }
  cachedRoot(path) {
    const key = join(CACHE, 'roots2.json');
    const db = existsSync(key) ? JSON.parse(readFileSync(key, 'utf8')) : {};
    const k = this.def.detect + ':' + path;
    if (!(k in db)) { db[k] = this.def.detect === 'timpani' ? timpaniPitch(readWav(path)) : detectRoot(path); writeFileSync(key, JSON.stringify(db)); }
    return db[k];
  }
  sample(z) {
    if (!z.s) z.s = loadSample(z.path, this.kind);
    return z.s;
  }
  // loudness normalisation: the loudest layer's median body RMS maps to def.level
  normalise() {
    if (this.norm != null) return this.norm;
    const medRms = (layer) => {
      const zs = this.zones.filter(z => z.layer === layer);
      const pick = zs.filter((_, i) => i % Math.max(1, Math.floor(zs.length / 6)) === 0).slice(0, 6);
      const r = pick.map(z => this.sample(z).rms).sort((a, b) => a - b);
      return r[r.length >> 1] || 0.1;
    };
    const top = this.layers[this.layers.length - 1];
    const topRms = medRms(top);
    this.norm = 0.12 / topRms;
    // soft layers keep their timbre but only part of their recorded level drop
    this.layerComp = {};
    for (const l of this.layers) this.layerComp[l] = Math.min(4, Math.pow(topRms / medRms(l), this.def.layerComp ?? 0.55));
    return this.norm;
  }
  // nearest zone in pitch (prefer sampling from below: upward shifts sound more natural for strings/brass)
  pick(midi, vel) {
    const L = this.layers;
    let li = Math.min(L.length - 1, Math.floor(Math.max(0, Math.min(0.999, vel)) * L.length));
    if (this.def.layerMap) li = this.def.layerMap(vel, L);
    const layer = L[li];
    let cand = this.zones.filter(z => z.layer === layer);
    if (!cand.length) cand = this.zones;
    let best = Infinity;
    for (const z of cand) {
      const d = this.def.unpitched ? 0 : Math.abs(midi - z.midi) + (z.midi > midi ? 0.3 : 0);
      if (d < best) best = d;
    }
    const near = cand.filter(z => (this.def.unpitched ? 0 : Math.abs(midi - z.midi) + (z.midi > midi ? 0.3 : 0)) <= best + 0.01);
    const z = near[this.rrCount++ % near.length];
    return { z, layerIdx: li, nLayers: L.length };
  }
}

// ---------------------------------------------------------------- voice rendering
// cubic (Catmull-Rom) read with virtual position → sample index mapping for crossfade loops
function readCubic(x, p) {
  const i = Math.floor(p), f = p - i;
  const x0 = x[i - 1] ?? x[i] ?? 0, x1 = x[i] ?? 0, x2 = x[i + 1] ?? 0, x3 = x[i + 2] ?? x2;
  const a = -0.5 * x0 + 1.5 * x1 - 1.5 * x2 + 0.5 * x3;
  const b = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
  const c = -0.5 * x0 + 0.5 * x2;
  return ((a * f + b) * f + c) * f + x1;
}

/**
 * Render one note into out [L, R] (Float32Arrays) at sample offset `at`.
 * note: { midi, vel, dur (s), legato (bool), fadeIn (s), rel (s), gain, detune (cents), startOff (s) }
 */
export function renderNote(inst, note, outL, outR, at) {
  const { z } = inst.pick(note.midi, note.vel);
  inst.normalise();
  const s = inst.sample(z);
  const def = inst.def;
  const ratio = def.unpitched ? Math.pow(2, (note.detune || 0) / 1200) : Math.pow(2, (note.midi - z.midi + (note.detune || 0) / 100) / 12);
  const kind = inst.kind;
  // where to start reading
  let start = 0, fadeIn = note.fadeIn ?? 0.003;
  if (kind === 'sus' && note.legato) { start = s.speak; fadeIn = Math.max(fadeIn, def.legatoFade ?? 0.07); }
  else if (kind === 'sus' && note.soft) { start = Math.floor(s.speak * 0.6); fadeIn = Math.max(fadeIn, 0.12); }
  start += Math.floor((note.startOff || 0) * SR);
  const rel = note.rel ?? def.rel ?? 0.3;
  const holdS = kind === 'sus' || kind === 'pluck' ? note.dur : (note.choke ? note.dur : Infinity);
  const total = Math.min(outL.length - at, Math.floor(((holdS === Infinity ? (s.n - start) / ratio / SR : holdS + rel)) * SR) + 1);
  if (total <= 0) return;
  // crossfade loop for holds longer than the recorded sustain
  const loopable = kind === 'sus' && def.loop !== false;
  const le = s.sEnd - Math.floor(0.08 * SR), xf = Math.floor(0.3 * SR);
  const ls = Math.max(start + Math.floor(0.5 * SR), Math.floor(le * 0.35));
  const Lp = le - xf - ls;
  const useLoop = loopable && Lp > xf * 2;
  const g0 = (note.gain ?? 1) * inst.normalise() * (def.gain ?? 1);
  const velCurve = 0.5 + 0.5 * Math.pow(Math.max(0.05, note.vel), 1.1);
  const g = g0 * velCurve * (inst.layerComp[z.layer] ?? 1);
  const fi = Math.max(1, Math.floor(fadeIn * SR)), relStart = Math.floor(holdS * SR), relN = Math.max(1, Math.floor(rel * SR));
  const { L, R } = s;
  const pan = note.pan || 0;
  const gl = pan > 0 ? 1 - pan * 0.6 : 1, gr = pan < 0 ? 1 + pan * 0.6 : 1;
  for (let i = 0; i < total; i++) {
    let v = start + i * ratio;
    let l, r;
    if (useLoop && v >= le - xf) {
      const u0 = v - (le - xf), u = u0 % Lp;
      if (u < xf) {
        const th = (u / xf) * Math.PI / 2, a = Math.cos(th), b = Math.sin(th);
        l = readCubic(L, le - xf + u) * a + readCubic(L, ls + u) * b;
        r = readCubic(R, le - xf + u) * a + readCubic(R, ls + u) * b;
      } else { l = readCubic(L, ls + u); r = readCubic(R, ls + u); }
    } else {
      if (v >= s.n - 2) break;
      l = readCubic(L, v); r = readCubic(R, v);
    }
    let e = 1;
    if (i < fi) e = Math.sin((i / fi) * Math.PI / 2);
    if (i >= relStart) { const k = (i - relStart) / relN; if (k >= 1) break; e *= Math.cos(k * Math.PI / 2) ** 1.5; }
    outL[at + i] += l * g * e * gl;
    outR[at + i] += r * g * e * gr;
  }
}

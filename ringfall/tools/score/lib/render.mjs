// Offline orchestral render: score → per-part sampler render → expression, EQ, seating →
// stem buses + hall reverb → loudness-matched stems → seamless loop extraction → MP3 with a sync marker.
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Mp3Encoder } from '@breezystack/lamejs';
import { SR, renderNote } from './sampler.mjs';
import { inst } from './instruments.mjs';
import { convolveStereo, eqStereo, hallIR, lufs, peak, rng, limit, compress } from './dsp.mjs';
import { writeWav } from './wav.mjs';

let IR = null;
const getIR = () => IR || (IR = hallIR(SR, { len: 3.6, pre: 0.022, rtLow: 3.0, rtMid: 2.4, rtHigh: 1.25 }));

const MASTER_EQ = [['ls', 150, 0.7, -1.0], ['hs', 5000, 0.7, 1.5]];
export const PRE = 0.3, POST = 0.3, MARK = 0.25, MARK_AT = 0.05;

function exprGain(expr, beatSec, n, offsetSec = 0) {
  if (!expr || !expr.length) return null;
  const g = new Float32Array(n);
  const pts = expr.map(([b, v]) => [b * beatSec + offsetSec, v]);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (k < pts.length - 1 && pts[k + 1][0] <= t) k++;
    const [t0, v0] = pts[k], [t1, v1] = pts[Math.min(k + 1, pts.length - 1)];
    g[i] = t <= t0 ? v0 : t >= t1 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return g;
}

function seat(L, R, pan, width) {
  // mid/side width, then constant-power pan of the mid
  const gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * 0.5 * width;
    L[i] = m * gl + s; R[i] = m * gr - s;
  }
}

/**
 * track: { name, bpm, beats (per bar), bars, loop, stems: [...], parts: [...], target (LUFS), tail }
 * part:  { id, inst, stem, notes, gain, pan, width, send, depth, eq, legato, human: { t, v, d }, expr, unison, soft, rel }
 */
export function renderTrack(track, outDir, { wav = false, only = null } = {}) {
  const beatSec = 60 / track.bpm, loopBeats = track.bars * track.beats, L = loopBeats * beatSec;
  const tail = track.tail ?? 4.5;
  const pad = track.pad ?? 2;                  // room for pickups / early starts before beat 0
  const padS = Math.floor(pad * SR);
  const total = Math.ceil((pad + L + tail) * SR);
  const stems = {};
  for (const s of track.stems) stems[s] = { dL: new Float32Array(total), dR: new Float32Array(total), sL: new Float32Array(total), sR: new Float32Array(total) };
  const t0 = Date.now();
  for (const part of track.parts) {
    if (only && !only.includes(part.id)) continue;
    const I = inst(part.inst), def = I.def;
    const pL = new Float32Array(total), pR = new Float32Array(total);
    const r = rng(hash(track.name + part.id));
    const hum = { t: 0.006, v: 0.05, d: 0.03, ...(part.human || {}) };
    const notes = [...part.notes].sort((a, b) => a.t - b.t);
    const uni = part.unison ?? def.unison ?? 1;
    let prevEnd = -99;
    for (let ni = 0; ni < notes.length; ni++) {
      const n = notes[ni];
      const legato = !!part.legato && Math.abs(n.t - prevEnd) < 0.06;
      prevEnd = n.t + n.d;
      // slurred into the next note: hand over quickly instead of ringing under it
      const nx = notes[ni + 1];
      const slurOut = !!part.legato && nx && Math.abs(nx.t - (n.t + n.d)) < 0.06;
      const jitter = r.gauss() * hum.t + (part.lag || 0) + (n.lag || 0);
      const startSec = pad + n.t * beatSec + jitter;
      const durSec = Math.max(0.05, n.d * beatSec * (1 + r.gauss() * hum.d) * (part.legato ? 1.0 : (part.hold ?? 0.97)));
      const v = Math.max(0.05, Math.min(1, n.v + r.gauss() * hum.v));
      for (const p of n.p) {
        for (let u = 0; u < uni; u++) {
          const at = Math.floor((startSec + (u ? 0.006 + r() * 0.018 : 0)) * SR);
          if (at < 0 || at >= total) continue;
          renderNote(I, {
            midi: p, vel: v, dur: durSec + (slurOut ? 0.05 : 0), legato, soft: part.soft && !legato,
            fadeIn: n.fadeIn ?? part.fadeIn, rel: slurOut ? (part.slurRel ?? 0.14) : (n.rel ?? part.rel), gain: (part.noteGain ?? 1) / Math.sqrt(uni) * (n.g ?? 1),
            detune: u ? (u % 2 ? 1 : -1) * (5 + r() * 5) : (r() - 0.5) * 3, startOff: n.startOff, choke: part.choke,
            pan: u ? (u % 2 ? 0.25 : -0.25) : 0,
          }, pL, pR, at);
        }
      }
    }
    if (part.expr) {
      const g = exprGain(part.expr, beatSec, total, pad);
      for (let i = 0; i < total; i++) { pL[i] *= g[i]; pR[i] *= g[i]; }
    }
    const eq = [['hp', part.hp ?? 35, 0.6], ...(part.eq || [])];
    const depth = part.depth ?? 0;
    if (depth > 0) eq.push(['hs', 5000, 0.7, -depth * 5]);
    eqStereo(pL, pR, eq, SR);
    seat(pL, pR, part.pan ?? def.pan ?? 0, part.width ?? def.width ?? 0.6);
    const g = part.gain ?? 1, send = (part.send ?? def.send ?? 0.35), dry = 1 - depth * 0.35;
    const st = stems[part.stem];
    if (!st) throw new Error(`part ${part.id} → unknown stem ${part.stem}`);
    for (let i = 0; i < total; i++) {
      const l = pL[i] * g, rr = pR[i] * g;
      st.dL[i] += l * dry; st.dR[i] += rr * dry;
      st.sL[i] += l * send; st.sR[i] += rr * send;
    }
  }
  const tParts = Date.now();
  const [hL, hR] = getIR();
  const seg = {};
  const Ls = Math.round(L * SR);
  for (const [name, st] of Object.entries(stems)) {
    const [wL, wR] = convolveStereo(st.sL, st.sR, hL, hR, total);
    const wet = track.wet ?? 0.9;
    const oL = st.dL, oR = st.dR;
    for (let i = 0; i < total; i++) { oL[i] += wL[i] * wet; oR[i] += wR[i] * wet; }
    if (track.loop) {
      // fold everything (pickups before 0, tails after L) onto one period: the loop is exactly periodic
      const yL = new Float32Array(Ls), yR = new Float32Array(Ls);
      for (let i = 0; i < total; i++) { const j = (((i - padS) % Ls) + Ls) % Ls; yL[j] += oL[i]; yR[j] += oR[i]; }
      seg[name] = [yL, yR];
    } else {
      seg[name] = [oL.slice(Math.max(0, padS - Math.floor((track.lead ?? 0) * SR))), oR.slice(Math.max(0, padS - Math.floor((track.lead ?? 0) * SR)))];
    }
  }
  const n = Object.values(seg)[0][0].length;
  const mixL = new Float32Array(n), mixR = new Float32Array(n);
  for (const [l, r] of Object.values(seg)) for (let i = 0; i < n; i++) { mixL[i] += l[i]; mixR[i] += r[i]; }
  const loud = lufs(mixL, mixR, SR);
  const target = track.target ?? -18;
  const gain = Math.pow(10, (target - loud.integrated) / 20);
  const pk = peak(mixL, mixR) * gain;
  const report = { name: track.name, L: +L.toFixed(3), lufsRaw: +loud.integrated.toFixed(1), gain: +(20 * Math.log10(gain)).toFixed(1), mixPeak: +(20 * Math.log10(pk)).toFixed(1), stems: {} };
  mkdirSync(outDir, { recursive: true });
  for (const [k, [l0, r0]] of Object.entries(seg)) {
    let l = l0, r = r0;
    if (track.loop) {
      // dynamics on three tiled periods, keep the middle one: processing state wraps seamlessly too
      const tl = new Float32Array(Ls * 3), tr = new Float32Array(Ls * 3);
      for (let c = 0; c < 3; c++) { tl.set(l0, c * Ls); tr.set(r0, c * Ls); }
      for (let i = 0; i < tl.length; i++) { tl[i] *= gain; tr[i] *= gain; }
      eqStereo(tl, tr, track.masterEq ?? MASTER_EQ, SR);
      if (track.comp?.[k]) compress(tl, tr, SR, track.comp[k]);
      limit(tl, tr, SR, { ceiling: -1.2 });
      const pre = Math.floor(PRE * SR), post = Math.floor(POST * SR);
      l = tl.slice(Ls - pre, 2 * Ls + post); r = tr.slice(Ls - pre, 2 * Ls + post);
    } else {
      for (let i = 0; i < n; i++) { l[i] *= gain; r[i] *= gain; }
      eqStereo(l, r, track.masterEq ?? MASTER_EQ, SR);
      if (track.comp?.[k]) compress(l, r, SR, track.comp[k]);
      limit(l, r, SR, { ceiling: -1.2 });
    }
    const n2 = l.length;
    if (!track.loop) { const f = Math.floor(1.5 * SR); for (let i = 0; i < f; i++) { const e = (f - i) / f; l[n2 - 1 - i] *= 1 - e * e; r[n2 - 1 - i] *= 1 - e * e; } }
    const lu = lufs(l, r, SR);
    report.stems[k] = { lufs: +lu.integrated.toFixed(1), peak: +(20 * Math.log10(peak(l, r))).toFixed(1) };
    const file = join(outDir, `${track.name}${track.stems.length > 1 ? '_' + k : ''}`);
    encodeMp3(file + '.mp3', l, r, track.kbps ?? 128);
    if (wav) writeWav(file + '.wav', l, r, SR);
  }
  report.renderSec = +((Date.now() - t0) / 1000).toFixed(1);
  report.partsSec = +((tParts - t0) / 1000).toFixed(1);
  return report;
}

export function encodeMp3(path, L, R, kbps = 128) {
  // sync marker: MARK seconds of silence with one click at MARK_AT, so players can find sample 0
  const m = Math.floor(MARK * SR), n = L.length + m;
  const l16 = new Int16Array(n), r16 = new Int16Array(n);
  const mi = Math.floor(MARK_AT * SR);
  l16[mi] = 29000; r16[mi] = 29000; l16[mi + 1] = -12000; r16[mi + 1] = -12000;
  for (let i = 0; i < L.length; i++) {
    l16[m + i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767 + (Math.random() - Math.random()) * 0.7)));
    r16[m + i] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767 + (Math.random() - Math.random()) * 0.7)));
  }
  const enc = new Mp3Encoder(2, SR, kbps), chunks = [];
  for (let i = 0; i < n; i += 1152) {
    const buf = enc.encodeBuffer(l16.subarray(i, i + 1152), r16.subarray(i, i + 1152));
    if (buf.length) chunks.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  writeFileSync(path, Buffer.concat(chunks));
}

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

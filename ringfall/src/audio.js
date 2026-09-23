// ============================================================================
// RINGFALL — audio.js
// Procedural audio engine: synthesized SFX + generative adaptive music.
// No audio files — everything is built from oscillators, shared noise buffers
// and filters with the Web Audio API. No imports; nothing runs at import time.
//
//   import { audio } from './audio.js';
//   audio.init()                  // from a user gesture (idempotent, also resumes)
//   audio.unlock()                // attach to every touchend/click/keydown
//   audio.play('carbineShot', { pos, volume, pitch, pan, exact })
//   const h = audio.loop('lancerBeam', { pos }); h.setPitch(1.5); h.stop(0.3)
//   audio.music.play('combat'); audio.music.setIntensity(0.8)
//
// Behaviour notes for callers:
// - Every call is a safe no-op before init() or without Web Audio. Volumes,
//   the requested music track and intensity are remembered and applied at init.
// - setVolumes() values are slider positions 0..1 mapped with a squared
//   (perceptual) curve.
// - suspend()/resume() are the pause-menu pair: world SFX, loops and music are
//   muted and the sequencer pauses, but 'ui*' sounds keep playing. Tab
//   visibility is handled internally (the AudioContext is suspended while hidden).
// - The game may drive the heartbeat itself with play('lowHealth'); the
//   automatic setLowHealth() heartbeat steps aside while it does.
// - _renderOffline / _renderMusicOffline / _meter / _stats / _names are
//   tooling hooks (level checks, debug overlays); the game does not need them.
//
// Signal flow (buildGraph is shared by the live engine and the offline renderer):
//
//   sfx bus ──────────────┐
//   music ─ vol ─ duck ───┼─> fx lowpass (overdrive / low HP) ─> world ─┐
//   reverb return ────────┘                                             ├─> master ─> limiter ─> soft clip ─> out
//   heartbeat bus ─────────────────────────────────────────> world ─────┤
//   ui bus (bypasses the fx filter and the pause mute) ─────────────────┘
//
// - One-shot voices: per-name cap (steal oldest), global cap of 48 (lowest
//   priority / oldest stolen first); nodes are disconnected when the voice's
//   last source ends.
// - Music: lookahead sequencer (25 ms timer, 0.12 s horizon, 16th steps).
//   Mono instruments (bass, arp, lead, drum noise, sub) are persistent nodes
//   driven by automation; only pads, choir, kicks, snare bodies and toms
//   create nodes per note.
// ============================================================================

/* -------------------------------------------------------------------------- */
/* Constants & small helpers                                                   */
/* -------------------------------------------------------------------------- */

const MAX_VOICES = 48;        // global one-shot voice cap
const MAX_LOOPS = 16;         // global loop cap
const REF_DIST = 4;           // meters: full volume inside this radius
const ROLLOFF = 0.82;         // inverse-distance rolloff (≈0.08 at 60 m)
const MUSIC_TRIM = 0.1;       // music sits under SFX
const LOOKAHEAD = 0.12;       // sequencer horizon (s)
const TICK_MS = 25;           // sequencer timer

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const toDb = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const finite = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);

/** Connect a node to one destination or an array of destinations. */
function link(node, to) {
  if (Array.isArray(to)) for (const d of to) node.connect(d);
  else node.connect(to);
}

/* -------------------------------------------------------------------------- */
/* Shared buffers (created once per AudioContext)                              */
/* -------------------------------------------------------------------------- */

function makeBuffers(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2);
  const mono = () => ctx.createBuffer(1, len, sr);
  const white = mono(), pink = mono(), brown = mono(), crackle = mono(), grit = mono();
  const wide = ctx.createBuffer(2, len, sr);
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  const wl = wide.getChannelData(0), wr = wide.getChannelData(1);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const r = Math.random() * 2 - 1;
    w[i] = r;
    wl[i] = Math.random() * 2 - 1;
    wr[i] = Math.random() * 2 - 1;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + r * 0.0555179; b1 = 0.99332 * b1 + r * 0.0750759;
    b2 = 0.969 * b2 + r * 0.153852;    b3 = 0.8665 * b3 + r * 0.3104856;
    b4 = 0.55 * b4 + r * 0.5329522;    b5 = -0.7616 * b5 - r * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + r * 0.5362) * 0.11;
    b6 = r * 0.115926;
    last = (last + 0.02 * r) / 1.02;
    b[i] = last;
  }
  // Remove the loop-point discontinuity of the correlated noises and normalize.
  for (const d of [p, b]) {
    const step = (d[len - 1] - d[0]) / len;
    let peak = 0;
    for (let i = 0; i < len; i++) { d[i] -= step * i; peak = Math.max(peak, Math.abs(d[i])); }
    const k = 0.9 / (peak || 1);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  // Sparse impulse trains: electric crackle and dense debris grit.
  const sprinkle = (d, perSec, ampPow, ringMin, ringMax) => {
    let i = 0;
    while (i < len) {
      i += 1 + Math.floor(-Math.log(1 - Math.random()) * (sr / perSec));
      const amp = Math.pow(Math.random(), ampPow) * (Math.random() < 0.5 ? -1 : 1);
      const ring = ringMin + Math.random() * (ringMax - ringMin);
      for (let k = 0; k < ring * 4 && i + k < len; k++) {
        d[i + k] += amp * Math.exp(-k / ring) * (k & 1 ? -0.6 : 1);
      }
    }
  };
  sprinkle(crackle.getChannelData(0), 240, 1.6, 2, 9);
  sprinkle(grit.getChannelData(0), 1600, 1.3, 1, 4);
  return { white, pink, brown, crackle, grit, wide };
}

/** Stereo impulse response: large metallic hall, ~2.2 s, darkening tail. */
function makeImpulse(ctx, dur = 2.2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(0.014 * sr);
  const modes = [[523, 1.3], [1187, 1.0], [2011, 0.75], [3310, 0.5]]; // metallic ring
  const envK = Math.exp(-6.9 / ((dur - 0.014) * sr));             // -60 dB over the tail
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0, env = 1;
    // Each metallic mode is a decaying phasor rotated per sample (no sin/exp per sample).
    const nm = modes.length, C = new Float64Array(nm), Sn = new Float64Array(nm);
    const X = new Float64Array(nm), Y = new Float64Array(nm), K = new Float64Array(nm), A = new Float64Array(nm);
    for (let m = 0; m < nm; m++) {
      const w = 2 * Math.PI * modes[m][0] / sr, ph = Math.random() * Math.PI * 2;
      C[m] = Math.cos(w); Sn[m] = Math.sin(w); X[m] = Math.cos(ph); Y[m] = Math.sin(ph);
      K[m] = Math.exp(-3 / (modes[m][1] * sr)); A[m] = 0.022;
    }
    const n = len - pre, fadeN = sr * 0.02;
    for (let j = 0; j < n; j++) {
      const fadeIn = j < fadeN ? j / fadeN : 1;
      const a = 0.9 - 0.72 * (j / n);                 // brighter early, darker late
      lp += a * ((Math.random() * 2 - 1) - lp);
      let s = lp * env;
      for (let m = 0; m < nm; m++) {
        const x = X[m] * C[m] - Y[m] * Sn[m];
        Y[m] = X[m] * Sn[m] + Y[m] * C[m]; X[m] = x;
        A[m] *= K[m];
        s += A[m] * Y[m];
      }
      d[pre + j] = s * fadeIn;
      env *= envK;
    }
    // Early reflections from big hard surfaces.
    for (let k = 0; k < 9; k++) {
      const at = pre + Math.floor(rand(0.006, 0.09) * sr);
      const amp = rand(0.25, 0.7) * (1 - k / 12) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 24 && at + j < len; j++) d[at + j] += amp * Math.exp(-j / 5);
    }
  }
  return buf;
}

/** tanh waveshaper curve, cached per drive amount. */
function driveCurve(G, k) {
  const key = Math.round(k * 10);
  let c = G.curves.get(key);
  if (!c) {
    const n = 1024;
    c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    G.curves.set(key, c);
  }
  return c;
}

/** Final safety clipper: linear to 0.8, soft knee, never above ~0.94 (-0.5 dBFS). */
function softClipCurve() {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    const y = ax < 0.8 ? ax : 0.8 + 0.14 * Math.tanh((ax - 0.8) / 0.14);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/* -------------------------------------------------------------------------- */
/* Graph: master chain, buses, reverb                                          */
/* -------------------------------------------------------------------------- */

function buildGraph(ctx, deferVerb = false) {
  const G = {
    ctx,
    buf: makeBuffers(ctx),
    curves: new Map(),
    hasPan: typeof ctx.createStereoPanner === 'function',
    hasConst: typeof ctx.createConstantSource === 'function',
    nyq: ctx.sampleRate * 0.45,
  };
  const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  G.gain = gain;

  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 2; lim.ratio.value = 12;
  lim.attack.value = 0.002; lim.release.value = 0.16;
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  G.limiter = lim;
  G.master = gain(1);
  G.master.connect(lim); lim.connect(clip); clip.connect(ctx.destination);

  G.world = gain(1, G.master);                   // pause mute (not UI)
  G.fx = ctx.createBiquadFilter();               // overdrive / low-health muffling
  G.fx.type = 'lowpass';
  G.fx.frequency.value = Math.min(20000, G.nyq);
  G.fx.Q.value = 0.7;
  G.fx.connect(G.world);

  G.sfx = gain(1, G.fx);
  G.duck = gain(1, G.fx);
  G.musicVol = gain(1, G.duck);
  G.musicIn = gain(MUSIC_TRIM, G.musicVol);
  G.ui = gain(1, G.master);
  G.heart = gain(1, G.world);

  G.verb = ctx.createConvolver();
  if (deferVerb) {
    // Keep the user-gesture handler short: build the ~2 s impulse a moment later.
    setTimeout(() => { try { G.verb.buffer = makeImpulse(ctx); } catch (e) { /* no reverb */ } }, 40);
  } else {
    G.verb.buffer = makeImpulse(ctx);
  }
  G.verbRet = gain(0.8, G.fx);
  G.verb.connect(G.verbRet);
  G.sfxVerb = gain(1, G.verb);
  G.musicVerb = gain(MUSIC_TRIM, G.verb);
  return G;
}

/* -------------------------------------------------------------------------- */
/* Synth toolkit                                                               */
/* -------------------------------------------------------------------------- */
// A "voice" is a bag of nodes with a shared output gain. Sources register
// themselves; when the last one ends every node is disconnected.

function voice(G, t, p, dest) {
  const v = { G, ctx: G.ctx, t, p: p || 1, nodes: [], srcs: 0, end: t, done: false, onDone: null, out: null };
  v.out = G.ctx.createGain();
  v.nodes.push(v.out);
  if (dest) v.out.connect(dest);
  return v;
}

function vNode(v, node) { v.nodes.push(node); return node; }

function vSrc(v, node, t0, t1, offset) {
  v.srcs++;
  v.end = Math.max(v.end, t1);
  (v.srcList || (v.srcList = [])).push(node);
  node.onended = () => { if (--v.srcs <= 0) vFree(v); };
  if (offset !== undefined) node.start(t0, offset); else node.start(t0);
  node.stop(t1);
}

function vFree(v) {
  if (v.done) return;
  v.done = true;
  for (const n of v.nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
  if (v.hooks) for (const [src, prm] of v.hooks) { try { src.disconnect(prm); } catch (e) { /* ignore */ } }
  v.nodes.length = 0;
  if (v.onDone) v.onDone(v);
}

/** Attack / hold / exponential decay (to -60 dB). Returns the end time. */
function adsr(param, t, a, peak, hold, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(a, 0.0006));
  const t2 = t + Math.max(a, 0.0006) + hold;
  if (hold > 0) param.setValueAtTime(peak, t2);
  param.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t2 + d);
  return t2 + d;
}

/** Reverse-style swell: exponential rise then an abrupt cut. */
function swell(param, t, rise, peak, cut) {
  param.setValueAtTime(peak * 0.004, t);
  param.exponentialRampToValueAtTime(peak, t + rise);
  param.linearRampToValueAtTime(0, t + rise + cut);
  return t + rise + cut;
}

/** Frequency path: f0 at t, then [[dt, f], ...] exponential segments. */
function glide(param, t, f0, path, scale) {
  param.setValueAtTime(f0 * scale, t);
  for (const [dt, f] of path) param.exponentialRampToValueAtTime(Math.max(1, f * scale), t + dt);
}

/** Optional filter chain from o.hp / o.bp / o.lp (each may sweep to o.*1 over o.fT). */
function filters(v, o, node, t, p) {
  const fT = o.fT || o.d || 0.2;
  const mk = (type, f, f1, q) => {
    const fl = vNode(v, v.ctx.createBiquadFilter());
    fl.type = type;
    fl.frequency.setValueAtTime(Math.min(f * p, v.G.nyq), t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.min(f1 * p, v.G.nyq), t + fT);
    if (q !== undefined) fl.Q.value = q;
    node.connect(fl);
    node = fl;
  };
  if (o.hp) mk('highpass', o.hp, o.hp1, o.hq);
  if (o.bp) mk('bandpass', o.bp, o.bp1, o.q !== undefined ? o.q : 1);
  if (o.lp) mk('lowpass', o.lp, o.lp1, o.lq);
  if (o.sh) {
    const ws = vNode(v, v.ctx.createWaveShaper());
    ws.curve = driveCurve(v.G, o.sh);
    node.connect(ws);
    node = ws;
  }
  return node;
}

/** Envelope gain for a chain; handles o.rise (swell) or a/hold/d. */
function envOut(v, o, node, t) {
  const g = vNode(v, v.ctx.createGain());
  node.connect(g);
  link(g, o.to || v.out);
  const peak = o.peak !== undefined ? o.peak : 0.5;
  const end = o.rise
    ? swell(g.gain, t, o.rise, peak, o.cut !== undefined ? o.cut : 0.03)
    : adsr(g.gain, t, o.a !== undefined ? o.a : 0.002, peak, o.hold || 0, o.d !== undefined ? o.d : 0.2);
  return { g, end };
}

/**
 * Tone: oscillator (+ optional filters / drive) with an envelope.
 * o: { type, f, f1, st, path, det, t, a, peak, hold, d, rise, cut, hp/bp/lp..., sh, to, fixed, dsrc }
 */
function T(v, o) {
  const t = v.t + (o.t || 0);
  const p = o.fixed ? 1 : v.p;
  const osc = vNode(v, v.ctx.createOscillator());
  osc.type = o.type || 'sine';
  if (o.path) glide(osc.frequency, t, o.f, o.path, p);
  else if (o.f1) glide(osc.frequency, t, o.f, [[o.st || o.d || 0.2, o.f1]], p);
  else osc.frequency.setValueAtTime(o.f * p, t);
  if (o.det) osc.detune.setValueAtTime(o.det, t);
  if (o.dsrc) o.dsrc.connect(osc.detune);
  const node = filters(v, o, osc, t, 1);
  const { g, end } = envOut(v, o, node, t);
  vSrc(v, osc, t, end + 0.02);
  return { osc, g, end };
}

/**
 * Noise burst from a shared buffer. o.k: white|pink|brown|crackle|grit|wide.
 * Filter frequencies follow the voice pitch unless o.fixed.
 */
function N(v, o) {
  const t = v.t + (o.t || 0);
  const p = o.fixed ? 1 : v.p;
  const src = vNode(v, v.ctx.createBufferSource());
  src.buffer = v.G.buf[o.k || 'white'];
  src.loop = true;
  if (o.rate) src.playbackRate.setValueAtTime(o.rate * p, t);
  const node = filters(v, o, src, t, p);
  const { g, end } = envOut(v, o, node, t);
  vSrc(v, src, t, end + 0.02, Math.random() * 1.8);
  return { src, g, end };
}

/**
 * Two-operator FM: glassy bells, zaps, chirps.
 * o: { f, f1, st, path, ratio, idx, idx1, iT, type, mtype, ...env/filters }
 */
function FM(v, o) {
  const t = v.t + (o.t || 0);
  const p = o.fixed ? 1 : v.p;
  const ratio = o.ratio || 2;
  const car = vNode(v, v.ctx.createOscillator());
  const mod = vNode(v, v.ctx.createOscillator());
  const mg = vNode(v, v.ctx.createGain());
  car.type = o.type || 'sine';
  mod.type = o.mtype || 'sine';
  const path = o.path || (o.f1 ? [[o.st || o.d || 0.2, o.f1]] : []);
  glide(car.frequency, t, o.f, path, p);
  glide(mod.frequency, t, o.f, path, p * ratio);
  const dev = o.f * ratio * p;
  const idx = o.idx !== undefined ? o.idx : 2;
  const idx1 = o.idx1 !== undefined ? o.idx1 : idx * 0.15;
  mg.gain.setValueAtTime(idx * dev, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.01, idx1 * dev), t + (o.iT || o.d || 0.2));
  mod.connect(mg);
  mg.connect(car.frequency);
  const node = filters(v, o, car, t, 1);
  const { g, end } = envOut(v, o, node, t);
  vSrc(v, car, t, end + 0.02);
  vSrc(v, mod, t, end + 0.02);
  return { car, mod, g, end };
}

/** Resonator bank (high-Q bandpasses) excited by a noise/crackle buffer: glass. */
function RES(v, o) {
  const t = v.t + (o.t || 0);
  const p = o.fixed ? 1 : v.p;
  const src = vNode(v, v.ctx.createBufferSource());
  src.buffer = v.G.buf[o.k || 'crackle'];
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const sum = vNode(v, v.ctx.createGain());
  for (const f of o.freqs) {
    const bp = vNode(v, v.ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(f * p, v.G.nyq);
    bp.Q.value = o.q || 30;
    src.connect(bp);
    bp.connect(sum);
  }
  const { g, end } = envOut(v, o, sum, t);
  vSrc(v, src, t, end + 0.05, Math.random() * 1.8);
  return { g, end };
}

/* -------------------------------------------------------------------------- */
/* Shared SFX building blocks                                                  */
/* -------------------------------------------------------------------------- */

/** Big explosion: pitch-dropping boom, wide noise burst, crunch, debris, rumble. */
function explosion(v, t, s = 1, peak = 1) {
  T(v, { t, f: 120 / s, f1: 30 / s, st: 0.6 * s, peak: 1 * peak, d: 0.9 * s });
  T(v, { t, type: 'triangle', f: 75 / s, f1: 28, st: 0.4 * s, sh: 4, peak: 0.3 * peak, d: 0.5 * s });
  N(v, { t, k: 'wide', lp: 7000, lp1: 280, fT: 0.8 * s, peak: 0.95 * peak, d: 1.0 * s });
  N(v, { t, k: 'pink', bp: 620 / s, q: 0.8, peak: 0.6 * peak, d: 0.4 * s });
  N(v, { t: t + 0.04, k: 'grit', bp: 2400, q: 0.6, a: 0.02, peak: 0.55 * peak, d: 1.1 * s });
  N(v, { t, k: 'brown', lp: 240, a: 0.01, peak: 0.7 * peak, d: 1.5 * s });
}

/** Crystalline break: bright noise shard, inharmonic bells, glass rain. */
function glassBreak(v, t, s = 1, peak = 1, rain = 0.85) {
  N(v, { t, k: 'wide', hp: 2200 / s, peak: 0.75 * peak, d: 0.18 * s });
  FM(v, { t, f: 1760 / s, ratio: 2.76, idx: 2.4, idx1: 0.1, peak: 0.26 * peak, d: 0.55 * s });
  FM(v, { t, f: 2637 / s, ratio: 3.33, idx: 1.8, idx1: 0.1, peak: 0.18 * peak, d: 0.45 * s });
  RES(v, { t: t + 0.03, freqs: [3100 / s, 4300 / s, 5200 / s, 6700 / s], q: 34, k: 'crackle', a: 0.03, peak: 6 * peak, d: rain * s });
}

/** Two-beat heartbeat thump (lub-dub). */
function heartbeat(v, t, peak = 1) {
  T(v, { t, f: 64, f1: 40, st: 0.12, a: 0.006, peak: 1 * peak, d: 0.17, fixed: true });
  T(v, { t, type: 'triangle', f: 90, f1: 55, st: 0.1, lp: 320, a: 0.006, peak: 0.35 * peak, d: 0.12, fixed: true });
  T(v, { t: t + 0.21, f: 56, f1: 38, st: 0.12, a: 0.006, peak: 0.75 * peak, d: 0.19, fixed: true });
  T(v, { t: t + 0.21, type: 'triangle', f: 80, f1: 50, st: 0.1, lp: 300, a: 0.006, peak: 0.25 * peak, d: 0.12, fixed: true });
}

/** Short bell note (FM) used by chimes and stingers. */
function bell(v, t, f, peak, d = 0.5, ratio = 3.5, idx = 1.4, to) {
  FM(v, { t, f, ratio, idx, idx1: 0.05, a: 0.002, peak, d, to });
}

/* -------------------------------------------------------------------------- */
/* SFX registry                                                                */
/* -------------------------------------------------------------------------- */
// meta: g = level trim, verb = reverb send, max = voices per name, prio = steal
// priority (higher survives), duck = dips music, ui = UI bus, gap = min seconds
// between two starts of the same name, len = offline render length.

const SFX = Object.create(null);
function sfx(name, meta, fn) {
  SFX[name] = Object.assign({ g: 1, verb: 0.15, max: 4, prio: 1, gap: 0.018, len: 1.2 }, meta, { fn });
}

/* ---------------------------------- Weapons -------------------------------- */

sfx('carbineShot', { g: 1.28, verb: 0.08, max: 6, prio: 2, gap: 0.03, len: 0.4 }, (v) => {
  N(v, { hp: 2600, a: 0.0005, peak: 0.55, d: 0.014 });                                   // transient click
  FM(v, { f: 1150, f1: 260, st: 0.07, ratio: 1.5, idx: 2.2, idx1: 0.3, type: 'triangle', peak: 0.3, d: 0.085 }); // zap
  T(v, { f: 175, f1: 52, st: 0.06, peak: 0.8, d: 0.075 });                                // low thump
  N(v, { k: 'pink', bp: 2400, bp1: 800, fT: 0.09, q: 0.9, a: 0.002, peak: 0.5, d: 0.09 }); // noisy tail
});

sfx('scatterShot', { g: 0.836, verb: 0.26, max: 3, prio: 2, len: 1.0 }, (v) => {
  N(v, { k: 'wide', hp: 1800, peak: 0.8, d: 0.03 });
  T(v, { f: 150, f1: 38, st: 0.22, peak: 1, d: 0.42 });                                   // boom
  T(v, { type: 'triangle', f: 95, f1: 42, st: 0.18, sh: 3, peak: 0.4, d: 0.25 });         // grit body
  N(v, { k: 'wide', lp: 6500, lp1: 500, fT: 0.3, peak: 0.95, d: 0.38 });                  // wide blast
  N(v, { k: 'pink', bp: 900, q: 1.1, peak: 0.55, d: 0.22 });
  // mechanical rack
  N(v, { t: 0.3, bp: 1400, bp1: 2600, fT: 0.06, q: 2, a: 0.012, peak: 0.22, d: 0.06 });
  N(v, { t: 0.41, bp: 3200, q: 4, peak: 0.45, d: 0.035 });
  T(v, { t: 0.41, type: 'square', f: 1250, lp: 3000, peak: 0.06, d: 0.03 });
  T(v, { t: 0.41, f: 150, f1: 90, peak: 0.25, d: 0.05 });
});

sfx('lanceShot', { g: 1.1, verb: 0.34, max: 2, prio: 2, len: 1.3 }, (v) => {
  N(v, { k: 'wide', hp: 3500, peak: 0.9, d: 0.035 });                                    // crack
  FM(v, { f: 2600, f1: 900, st: 0.05, ratio: 2.1, idx: 3, peak: 0.22, d: 0.06 });        // snap
  T(v, { type: 'sawtooth', f: 2400, f1: 140, st: 0.38, lp: 7000, lp1: 1200, fT: 0.4, peak: 0.3, d: 0.42 }); // descending zap
  T(v, { f: 95, f1: 32, st: 0.3, peak: 0.9, d: 0.35 });                                  // body
  N(v, { t: 0.025, k: 'crackle', bp: 3200, q: 0.8, a: 0.01, peak: 1.2, d: 0.55 });      // crackle tail
  N(v, { t: 0.01, k: 'pink', bp: 1500, bp1: 500, fT: 0.4, q: 0.7, peak: 0.3, d: 0.45 });
});

sfx('lanceCharge', { g: 0.323, verb: 0.15, max: 2, len: 0.5 }, (v) => {
  T(v, { type: 'sawtooth', f: 380, f1: 1900, st: 0.16, lp: 2400, lp1: 5000, fT: 0.16, a: 0.12, peak: 0.3, d: 0.06 });
  T(v, { f: 760, f1: 3800, st: 0.16, a: 0.13, peak: 0.16, d: 0.05 });
  N(v, { k: 'crackle', rate: 1.5, hp: 2000, a: 0.12, peak: 0.5, d: 0.05 });
});

sfx('novaShot', { g: 0.836, verb: 0.2, max: 3, prio: 2, len: 0.6 }, (v) => {
  N(v, { hp: 1500, peak: 0.4, d: 0.012 });
  T(v, { f: 240, f1: 62, st: 0.13, peak: 1, d: 0.26 });                                  // thoonk
  T(v, { type: 'triangle', f: 420, f1: 150, st: 0.1, peak: 0.35, d: 0.14 });             // 'oonk'
  N(v, { k: 'brown', lp: 900, lp1: 250, fT: 0.2, peak: 0.8, d: 0.22 });
  N(v, { t: 0.02, k: 'pink', bp: 700, q: 3, peak: 0.3, d: 0.12 });                        // tube resonance
});

sfx('novaExplode', { g: 0.85, verb: 0.5, max: 3, prio: 3, duck: true, len: 2.4 }, (v) => {
  explosion(v, 0, 1, 1);
  N(v, { k: 'crackle', bp: 3000, q: 0.7, t: 0.02, peak: 0.6, d: 0.5 });
});

sfx('reload', { g: 0.717, verb: 0.1, max: 2, len: 0.8 }, (v) => {
  N(v, { bp: 2600, q: 3, peak: 0.55, d: 0.025 });                                         // latch
  T(v, { type: 'square', f: 1400, lp: 3000, peak: 0.05, d: 0.02 });
  T(v, { t: 0.1, type: 'triangle', f: 1300, f1: 280, st: 0.25, peak: 0.18, d: 0.28 });   // cell out
  N(v, { t: 0.1, k: 'pink', bp: 1600, bp1: 700, fT: 0.15, q: 1.5, a: 0.02, peak: 0.35, d: 0.14 });
  N(v, { t: 0.33, bp: 3400, q: 4, peak: 0.5, d: 0.022 });                                 // click
  T(v, { t: 0.33, f: 900, peak: 0.1, d: 0.04 });
});

sfx('reloadDone', { g: 0.629, verb: 0.12, max: 2, len: 0.6 }, (v) => {
  T(v, { f: 170, f1: 60, st: 0.08, peak: 0.6, d: 0.11 });                                 // cell slam
  N(v, { bp: 2100, q: 2, peak: 0.6, d: 0.04 });
  N(v, { t: 0.004, hp: 5000, peak: 0.2, d: 0.01 });
  FM(v, { t: 0.05, f: 520, f1: 1040, st: 0.12, ratio: 2, idx: 1.2, a: 0.02, peak: 0.16, d: 0.18 }); // charged blip
});

sfx('swap', { g: 0.802, verb: 0.1, max: 2, len: 0.5 }, (v) => {
  N(v, { k: 'pink', bp: 700, bp1: 2600, fT: 0.14, q: 1.2, a: 0.05, peak: 0.4, d: 0.12 }); // whoosh
  N(v, { t: 0.06, bp: 3000, q: 3, peak: 0.5, d: 0.03 });                                  // clack
  T(v, { t: 0.06, type: 'square', f: 950, lp: 2500, peak: 0.06, d: 0.03 });
  T(v, { t: 0.06, f: 140, f1: 70, peak: 0.3, d: 0.06 });
});

sfx('dryFire', { g: 2.9, verb: 0.06, max: 2, gap: 0.05, len: 0.3 }, (v) => {
  N(v, { bp: 4200, q: 5, peak: 0.7, d: 0.016 });
  T(v, { type: 'triangle', f: 2100, peak: 0.08, d: 0.015 });
  N(v, { t: 0.05, bp: 2600, q: 4, peak: 0.3, d: 0.012 });
});

/* ---------------------------------- Player --------------------------------- */

sfx('melee', { g: 0.709, verb: 0.08, max: 3, len: 0.5 }, (v) => {
  N(v, { k: 'pink', bp: 450, bp1: 2200, fT: 0.12, q: 1.3, a: 0.05, peak: 0.6, d: 0.1 });
  T(v, { t: 0.07, f: 120, f1: 50, st: 0.1, peak: 0.45, d: 0.12 });
});

sfx('meleeHit', { g: 0.978, verb: 0.14, max: 3, prio: 2, len: 0.6 }, (v) => {
  T(v, { f: 160, f1: 45, st: 0.14, peak: 1, d: 0.2 });
  N(v, { k: 'pink', lp: 1800, lp1: 400, fT: 0.12, peak: 0.8, d: 0.13 });
  N(v, { bp: 1900, q: 1.2, peak: 0.5, d: 0.05 });
  T(v, { type: 'triangle', f: 90, f1: 55, sh: 3, peak: 0.28, d: 0.12 });
});

sfx('deflect', { g: 0.397, verb: 0.3, max: 3, len: 1.2 }, (v) => {
  FM(v, { f: 1850, ratio: 2.76, idx: 3, idx1: 0.2, peak: 0.42, d: 0.7 });                // metallic ping
  T(v, { f: 4300, peak: 0.08, d: 0.35 });
  N(v, { hp: 4000, peak: 0.4, d: 0.02 });
  N(v, { t: 0.05, bp: 2500, bp1: 5000, fT: 0.25, q: 1.2, rise: 0.24, peak: 0.26 });      // reversed swell
  T(v, { t: 0.05, f: 2775, rise: 0.24, peak: 0.05 });
});

sfx('hit', { g: 0.806, verb: 0.02, max: 5, gap: 0.035, len: 0.25 }, (v) => {
  T(v, { f: 1900, a: 0.0008, peak: 0.42, d: 0.05 });
  T(v, { f: 3800, peak: 0.1, d: 0.025 });
  N(v, { hp: 6000, peak: 0.12, d: 0.006 });
});

sfx('crit', { g: 0.492, verb: 0.08, max: 4, gap: 0.035, len: 0.4 }, (v) => {
  FM(v, { f: 2800, ratio: 3.01, idx: 1.4, idx1: 0.1, peak: 0.35, d: 0.14 });
  T(v, { f: 5600, peak: 0.06, d: 0.06 });
  T(v, { t: 0.035, f: 4200, peak: 0.09, d: 0.1 });
  T(v, { t: 0.065, f: 6300, peak: 0.06, d: 0.12 });
  N(v, { hp: 6000, peak: 0.25, d: 0.006 });
});

sfx('kill', { g: 0.741, verb: 0.18, max: 4, prio: 2, gap: 0.03, len: 0.6 }, (v) => {
  T(v, { f: 320, f1: 75, st: 0.1, peak: 0.85, d: 0.14 });                                 // deep pop
  N(v, { hp: 3500, peak: 0.35, d: 0.1 });
  FM(v, { t: 0.01, f: 2100, ratio: 2.41, idx: 2, idx1: 0.1, peak: 0.18, d: 0.22 });
  RES(v, { t: 0.01, freqs: [3300, 4700, 6100], q: 30, k: 'crackle', rate: 1.2, peak: 4, d: 0.25 });
});

sfx('shatter', { g: 0.85, verb: 0.45, max: 3, prio: 3, duck: true, len: 1.6 }, (v) => {
  glassBreak(v, 0, 1, 1.1, 0.9);
  N(v, { k: 'wide', bp: 5200, q: 0.6, peak: 0.4, d: 0.4 });
  T(v, { f: 3520, peak: 0.08, d: 0.4 });
  T(v, { f: 170, f1: 34, st: 0.5, peak: 1, d: 0.7 });                                     // bass drop
  T(v, { type: 'triangle', f: 85, f1: 30, st: 0.45, peak: 0.35, d: 0.5 });
  RES(v, { t: 0.12, freqs: [2400, 3600, 5800, 7600], q: 40, k: 'crackle', rate: 0.7, a: 0.05, peak: 5, d: 0.75 }); // more rain
});

sfx('footstep', { g: 0.572, verb: 0.04, max: 3, prio: 0, gap: 0.08, len: 0.3 }, (v) => {
  const r = rand(0.85, 1.2);
  T(v, { f: 95 * r, f1: 60 * r, st: 0.05, peak: 0.45, d: 0.07 });
  N(v, { k: 'pink', bp: 1100 * r, q: 1.4, peak: 0.4, d: 0.055 });
  T(v, { t: 0.004, f: rand(560, 820), peak: 0.03, d: 0.09 });                             // faint metal ring
});

sfx('jump', { g: 1.31, verb: 0.05, max: 2, len: 0.4 }, (v) => {
  N(v, { k: 'pink', bp: 850, bp1: 380, fT: 0.12, q: 1, a: 0.012, peak: 0.5, d: 0.12 });
  T(v, { f: 180, f1: 115, st: 0.06, peak: 0.22, d: 0.06 });
});

sfx('doubleJump', { g: 0.8, verb: 0.12, max: 2, len: 0.6 }, (v) => {
  N(v, { bp: 1500, bp1: 600, fT: 0.22, q: 0.7, a: 0.01, peak: 0.55, d: 0.25 });           // thruster burst
  N(v, { k: 'brown', lp: 420, a: 0.01, peak: 0.55, d: 0.2 });
  T(v, { type: 'sawtooth', f: 115, f1: 80, st: 0.2, lp: 500, peak: 0.2, d: 0.2 });
  N(v, { hp: 5000, peak: 0.2, d: 0.012 });
});

sfx('land', { g: 0.725, verb: 0.08, max: 2, gap: 0.06, len: 0.5 }, (v) => {
  T(v, { f: 110, f1: 45, st: 0.1, peak: 0.9, d: 0.15 });
  N(v, { k: 'pink', lp: 900, peak: 0.6, d: 0.12 });
  N(v, { bp: 2200, q: 3, peak: 0.22, d: 0.05 });                                          // metal clank
});

sfx('dash', { g: 0.757, verb: 0.1, max: 2, len: 0.6 }, (v) => {
  N(v, { k: 'pink', bp: 400, bp1: 3000, fT: 0.2, q: 1.1, a: 0.03, peak: 0.65, d: 0.2 });  // whoosh
  N(v, { hp: 3000, a: 0.01, peak: 0.25, d: 0.2 });                                        // thruster hiss
  T(v, { type: 'sawtooth', f: 92, f1: 60, st: 0.15, lp: 420, peak: 0.22, d: 0.15 });
});

sfx('jumpPad', { g: 0.639, verb: 0.25, max: 2, len: 0.9 }, (v) => {
  T(v, { type: 'sawtooth', f: 150, f1: 900, st: 0.35, lp: 800, lp1: 5000, fT: 0.35, det: -9, a: 0.02, peak: 0.22, d: 0.45 });
  T(v, { type: 'sawtooth', f: 150, f1: 900, st: 0.35, lp: 800, lp1: 5000, fT: 0.35, det: 9, a: 0.02, peak: 0.22, d: 0.45 });
  N(v, { bp: 500, bp1: 2500, fT: 0.35, q: 0.8, a: 0.02, peak: 0.55, d: 0.4 });           // air blast
  T(v, { f: 120, f1: 50, st: 0.12, peak: 0.6, d: 0.15 });
});

sfx('playerHurt', { g: 0.886, verb: 0.12, max: 2, prio: 3, duck: true, gap: 0.06, len: 0.7 }, (v) => {
  T(v, { f: 130, f1: 50, st: 0.2, sh: 6, lp: 1400, peak: 0.6, d: 0.25 });                // distorted low hit
  T(v, { f: 75, f1: 38, st: 0.2, peak: 0.6, d: 0.25 });
  N(v, { k: 'crackle', bp: 2500, q: 0.7, peak: 0.8, d: 0.3 });                           // static crackle
  N(v, { bp: 1200, q: 0.8, sh: 4, peak: 0.25, d: 0.15 });
});

sfx('shieldBreak', { g: 0.713, verb: 0.3, max: 2, prio: 3, len: 1.2 }, (v) => {
  glassBreak(v, 0, 0.85, 0.9, 0.5);
  N(v, { t: 0.02, k: 'crackle', hp: 3000, rate: 1.4, peak: 0.6, d: 0.5 });              // electric fizz
  T(v, { type: 'sawtooth', f: 800, f1: 100, st: 0.3, lp: 2500, peak: 0.16, d: 0.3 });
});

sfx('shieldRegen', { g: 0.37, verb: 0.3, max: 2, len: 1.4 }, (v) => {
  T(v, { f: 400, f1: 1600, st: 0.5, a: 0.3, peak: 0.22, d: 0.5 });                        // rising charge
  T(v, { type: 'triangle', f: 800, f1: 3200, st: 0.5, a: 0.3, peak: 0.06, d: 0.4 });
  bell(v, 0.45, 1600, 0.22, 0.55, 2, 1.2);                                                // chime
});

sfx('pickupHealth', { g: 0.42, verb: 0.2, max: 3, gap: 0.05, len: 0.8 }, (v) => {
  T(v, { type: 'triangle', f: 659, peak: 0.32, d: 0.3 });
  T(v, { f: 1318, peak: 0.08, d: 0.2 });
  T(v, { t: 0.09, type: 'triangle', f: 880, peak: 0.34, d: 0.4 });
  T(v, { t: 0.09, f: 1760, peak: 0.08, d: 0.3 });
});

sfx('pickupShield', { g: 0.337, verb: 0.25, max: 3, gap: 0.05, len: 0.8 }, (v) => {
  bell(v, 0, 1320, 0.26, 0.4, 3.5, 1.2);
  bell(v, 0.07, 1760, 0.24, 0.5, 3.5, 1.2);
  T(v, { t: 0.07, f: 3520, peak: 0.04, d: 0.3 });
});

sfx('pickupOrb', { g: 0.533, verb: 0.15, max: 4, prio: 0, gap: 0.04, len: 0.4 }, (v) => {
  T(v, { f: 2600, peak: 0.2, d: 0.08 });
  T(v, { t: 0.03, f: 3900, peak: 0.15, d: 0.1 });
});

sfx('overdriveReady', { g: 0.42, verb: 0.2, max: 1, len: 1.0 }, (v) => {
  [440, 587.3, 880].forEach((f, i) => {
    const d = i === 2 ? 0.5 : 0.16;
    T(v, { t: i * 0.1, type: 'square', f, lp: 2400, peak: 0.12, hold: 0.04, d });
    T(v, { t: i * 0.1, f: f * 2, peak: 0.14, hold: 0.03, d });
  });
});

sfx('overdriveStart', { g: 0.599, verb: 0.45, max: 1, prio: 3, len: 1.8 }, (v) => {
  T(v, { f: 95, f1: 28, st: 0.8, peak: 1, d: 0.9 });                                      // massive whoomp
  N(v, { k: 'brown', lp: 700, lp1: 150, fT: 0.6, peak: 0.8, d: 0.7 });
  N(v, { k: 'wide', lp: 4000, lp1: 300, fT: 0.3, peak: 0.5, d: 0.35 });
  N(v, { t: 0.08, bp: 1800, bp1: 4200, fT: 0.4, q: 0.9, rise: 0.42, peak: 0.32 });       // reversed swell
  T(v, { type: 'sawtooth', f: 800, f1: 60, st: 1.0, lp: 2600, lp1: 300, fT: 1.0, peak: 0.2, d: 1.1 }); // time-slow sweep
  T(v, { type: 'sawtooth', f: 806, f1: 60.4, st: 1.0, lp: 2600, lp1: 300, fT: 1.0, peak: 0.16, d: 1.1 });
});

sfx('overdriveEnd', { g: 0.804, verb: 0.3, max: 1, len: 1.0 }, (v) => {
  T(v, { type: 'sawtooth', f: 80, f1: 900, st: 0.5, lp: 400, lp1: 4000, fT: 0.5, a: 0.05, peak: 0.25, d: 0.55 });
  N(v, { bp: 300, bp1: 3000, fT: 0.5, q: 0.9, a: 0.1, peak: 0.4, d: 0.45 });
  N(v, { t: 0.5, hp: 4000, peak: 0.3, d: 0.02 });
  T(v, { t: 0.5, f: 180, f1: 90, peak: 0.4, d: 0.1 });
});

sfx('lowHealth', { g: 0.442, verb: 0.02, max: 1, gap: 0.3, len: 0.7 }, (v) => {
  heartbeat(v, 0, 1);
});

sfx('weaponUnlock', { g: 0.479, verb: 0.45, max: 1, prio: 2, len: 2.0 }, (v) => {
  const chord = [146.8, 220, 293.7, 370, 440];                                            // D major, heroic
  const lp = vNode(v, v.ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(5000, v.t);
  lp.frequency.exponentialRampToValueAtTime(900, v.t + 1.2);
  lp.connect(v.out);
  for (const f of chord) {
    T(v, { type: 'sawtooth', f, det: -8, a: 0.005, peak: 0.13, d: 1.3, to: lp });
    T(v, { type: 'sawtooth', f, det: 8, a: 0.005, peak: 0.13, d: 1.3, to: lp });
  }
  T(v, { f: 73.4, a: 0.004, peak: 0.6, d: 0.9 });
  N(v, { k: 'wide', lp: 5000, lp1: 400, fT: 0.4, peak: 0.45, d: 0.4 });
  bell(v, 0.02, 1174.7, 0.12, 1.0, 2, 1);
});

/* ---------------------------------- Enemies -------------------------------- */

sfx('enemyWarpIn', { g: 0.301, verb: 0.4, max: 4, len: 1.4 }, (v) => {
  FM(v, { f: 600, f1: 2400, st: 0.6, ratio: 1.5, idx: 3, idx1: 1, a: 0.5, peak: 0.2, d: 0.2 }); // rising shimmer
  RES(v, { freqs: [1800, 2700, 3900, 5300], q: 25, k: 'white', rise: 0.55, peak: 1.4, cut: 0.08 });
  T(v, { t: 0.1, f: 90, f1: 30, st: 0.55, a: 0.05, peak: 0.6, d: 0.6 });                 // sub drop
  N(v, { t: 0.58, hp: 3000, peak: 0.3, d: 0.05 });                                        // arrival tick
  bell(v, 0.58, 2093, 0.1, 0.4, 2.76, 2);
});

sfx('miteScreech', { g: 1.02, verb: 0.15, max: 3, gap: 0.06, len: 0.5 }, (v) => {
  T(v, { type: 'sawtooth', f: 1200, path: [[0.08, 2700], [0.26, 1400]], bp: 2400, q: 4, a: 0.01, peak: 0.45, d: 0.26 });
  FM(v, { f: 1800, path: [[0.08, 3300], [0.24, 2000]], ratio: 1.41, idx: 2, idx1: 1, a: 0.01, peak: 0.15, d: 0.24 });
});

sfx('miteExplode', { g: 1.3, verb: 0.25, max: 4, prio: 2, len: 0.8 }, (v) => {
  T(v, { f: 420, f1: 100, st: 0.1, peak: 0.7, d: 0.12 });
  N(v, { lp: 4000, lp1: 500, fT: 0.2, peak: 0.6, d: 0.2 });
  N(v, { t: 0.02, k: 'crackle', bp: 2800, q: 0.7, peak: 0.8, d: 0.3 });
  RES(v, { freqs: [2900, 4100], q: 25, peak: 3, d: 0.2 });
});

sfx('sentinelCharge', { g: 0.345, verb: 0.2, max: 3, len: 0.9 }, (v) => {
  T(v, { type: 'sawtooth', f: 200, f1: 800, st: 0.5, lp: 900, lp1: 2200, fT: 0.5, a: 0.4, peak: 0.25, d: 0.1 });
  T(v, { f: 400, f1: 1600, st: 0.5, a: 0.45, peak: 0.18, d: 0.08 });
  N(v, { k: 'crackle', hp: 2000, a: 0.4, peak: 0.35, d: 0.1 });
});

sfx('orbFire', { g: 0.644, verb: 0.22, max: 4, len: 0.6 }, (v) => {
  T(v, { f: 420, f1: 170, st: 0.25, peak: 0.6, d: 0.3 });                                 // bwoom
  FM(v, { f: 300, f1: 160, st: 0.25, ratio: 0.5, idx: 4, idx1: 0.5, peak: 0.25, d: 0.25 });
  N(v, { k: 'pink', bp: 800, q: 1.2, peak: 0.35, d: 0.18 });
});

sfx('orbImpact', { g: 0.849, verb: 0.25, max: 4, len: 0.6 }, (v) => {
  N(v, { bp: 1500, bp1: 400, fT: 0.3, q: 0.9, peak: 0.6, d: 0.3 });                       // plasma splash
  T(v, { f: 260, f1: 60, st: 0.2, peak: 0.6, d: 0.2 });
  N(v, { t: 0.01, k: 'crackle', bp: 2500, q: 0.8, peak: 0.6, d: 0.25 });
});

sfx('lancerCharge', { g: 0.452, verb: 0.25, max: 3, prio: 2, len: 1.8 }, (v) => {
  // Rising whine with an accelerating pulse — an unmistakable warning.
  const pulse = vNode(v, v.ctx.createGain());
  pulse.gain.value = 0.65;
  pulse.connect(v.out);
  const lfo = vNode(v, v.ctx.createOscillator());
  const lfoAmt = vNode(v, v.ctx.createGain());
  lfo.type = 'square';
  lfo.frequency.setValueAtTime(5, v.t);
  lfo.frequency.exponentialRampToValueAtTime(26, v.t + 1.4);
  lfoAmt.gain.value = 0.35;
  lfo.connect(lfoAmt);
  lfoAmt.connect(pulse.gain);
  vSrc(v, lfo, v.t, v.t + 1.5);
  T(v, { type: 'sawtooth', f: 300, f1: 2400, st: 1.4, lp: 1400, lp1: 4200, fT: 1.4, a: 1.25, peak: 0.34, hold: 0.1, d: 0.05, to: pulse });
  T(v, { f: 600, f1: 4800, st: 1.4, a: 1.3, peak: 0.12, hold: 0.05, d: 0.05, to: pulse });
  T(v, { type: 'square', f: 150, f1: 1200, st: 1.4, lp: 900, a: 1.2, peak: 0.1, hold: 0.1, d: 0.05, to: pulse });
});

sfx('lancerFire', { g: 1.54, verb: 0.3, max: 3, prio: 2, len: 0.8 }, (v) => {
  N(v, { k: 'wide', hp: 3000, peak: 0.8, d: 0.04 });
  T(v, { type: 'sawtooth', f: 3200, f1: 400, st: 0.15, lp: 6000, lp1: 1500, fT: 0.15, peak: 0.3, d: 0.2 });
  T(v, { f: 150, f1: 50, st: 0.15, peak: 0.55, d: 0.15 });
  N(v, { t: 0.02, k: 'crackle', bp: 3500, q: 0.8, peak: 0.5, d: 0.25 });
});

sfx('bruteRev', { g: 0.306, verb: 0.2, max: 2, len: 1.2 }, (v) => {
  const growl = vNode(v, v.ctx.createGain());
  growl.gain.value = 0.6;
  growl.connect(v.out);
  const lfo = vNode(v, v.ctx.createOscillator());
  const amt = vNode(v, v.ctx.createGain());
  lfo.frequency.setValueAtTime(22, v.t);
  lfo.frequency.linearRampToValueAtTime(34, v.t + 0.4);
  lfo.frequency.linearRampToValueAtTime(26, v.t + 0.8);
  amt.gain.value = 0.4;
  lfo.connect(amt); amt.connect(growl.gain);
  vSrc(v, lfo, v.t, v.t + 0.9);
  T(v, { type: 'sawtooth', f: 45, path: [[0.35, 95], [0.8, 60]], sh: 5, lp: 900, a: 0.05, peak: 0.55, hold: 0.4, d: 0.35, to: growl });
  T(v, { type: 'square', f: 44, path: [[0.35, 94], [0.8, 59]], lp: 500, a: 0.05, peak: 0.25, hold: 0.4, d: 0.35, to: growl });
  N(v, { k: 'brown', lp: 350, a: 0.08, peak: 0.5, hold: 0.3, d: 0.4 });
});

sfx('bruteCharge', { g: 0.366, verb: 0.2, max: 2, len: 1.4 }, (v) => {
  N(v, { k: 'brown', lp: 500, lp1: 1300, fT: 0.8, a: 0.1, peak: 0.8, hold: 0.4, d: 0.5 });
  const growl = vNode(v, v.ctx.createGain());
  growl.gain.value = 0.6;
  growl.connect(v.out);
  const lfo = vNode(v, v.ctx.createOscillator());
  const amt = vNode(v, v.ctx.createGain());
  lfo.frequency.value = 18;
  amt.gain.value = 0.4;
  lfo.connect(amt); amt.connect(growl.gain);
  vSrc(v, lfo, v.t, v.t + 1.1);
  T(v, { type: 'sawtooth', f: 70, f1: 85, st: 0.9, sh: 4, lp: 650, a: 0.08, peak: 0.5, hold: 0.45, d: 0.45, to: growl });
  N(v, { bp: 800, q: 0.7, a: 0.5, peak: 0.3, hold: 0.2, d: 0.3 });
});

sfx('bruteSlam', { g: 0.85, verb: 0.4, max: 2, prio: 3, duck: true, len: 1.8 }, (v) => {
  T(v, { f: 80, f1: 24, st: 0.6, peak: 1, d: 0.8 });                                      // sub boom
  N(v, { k: 'wide', lp: 3000, lp1: 200, fT: 0.5, peak: 0.85, d: 0.6 });
  N(v, { t: 0.03, k: 'grit', bp: 1500, q: 0.6, a: 0.02, peak: 0.6, d: 0.8 });             // debris
  T(v, { type: 'triangle', f: 55, f1: 30, sh: 4, lp: 800, peak: 0.35, d: 0.5 });
  N(v, { hp: 1500, peak: 0.4, d: 0.03 });
});

sfx('shockwave', { g: 0.869, verb: 0.35, max: 3, len: 1.1 }, (v) => {
  N(v, { k: 'pink', bp: 2000, bp1: 280, fT: 0.6, q: 1.1, a: 0.02, peak: 0.7, d: 0.65 }); // expanding whoosh
  FM(v, { f: 220, f1: 110, st: 0.6, ratio: 1.41, idx: 2.5, idx1: 0.3, peak: 0.2, d: 0.7 }); // ring
  T(v, { f: 70, f1: 40, st: 0.3, peak: 0.4, d: 0.3 });
});

sfx('wardenShield', { g: 0.392, verb: 0.3, max: 2, len: 1.1 }, (v) => {
  T(v, { type: 'sawtooth', f: 110, f1: 220, st: 0.4, lp: 400, lp1: 2000, fT: 0.4, a: 0.3, peak: 0.25, d: 0.5 });
  T(v, { f: 440, f1: 880, st: 0.4, a: 0.3, peak: 0.14, d: 0.5 });
  FM(v, { t: 0.2, f: 1320, ratio: 1.5, idx: 1.5, a: 0.15, peak: 0.1, d: 0.5 });
});

sfx('shieldHit', { g: 0.593, verb: 0.2, max: 4, gap: 0.04, len: 0.5 }, (v) => {
  FM(v, { f: 1500, ratio: 1.41, idx: 2, idx1: 0.2, peak: 0.4, d: 0.25 });
  N(v, { bp: 3000, q: 1.5, peak: 0.4, d: 0.04 });
  T(v, { f: 800, f1: 600, st: 0.15, peak: 0.15, d: 0.15 });
});

sfx('enemyHurt', { g: 0.744, verb: 0.08, max: 4, gap: 0.035, len: 0.3 }, (v) => {
  FM(v, { f: 2200 * rand(0.9, 1.15), ratio: 2.7, idx: 1.6, idx1: 0.1, peak: 0.3, d: 0.08 });
  N(v, { hp: 4000, peak: 0.25, d: 0.02 });
});

sfx('enemyDeath', { g: 0.6, verb: 0.3, max: 4, prio: 2, len: 1.0 }, (v) => {
  glassBreak(v, 0, 1, 0.8, 0.45);
  T(v, { f: 220, f1: 60, st: 0.22, peak: 0.55, d: 0.25 });
  // electrical death rattle
  const rattle = vNode(v, v.ctx.createGain());
  rattle.gain.value = 0.5;
  rattle.connect(v.out);
  const lfo = vNode(v, v.ctx.createOscillator());
  const amt = vNode(v, v.ctx.createGain());
  lfo.type = 'square';
  lfo.frequency.setValueAtTime(32, v.t);
  lfo.frequency.linearRampToValueAtTime(12, v.t + 0.5);
  amt.gain.value = 0.5;
  lfo.connect(amt); amt.connect(rattle.gain);
  vSrc(v, lfo, v.t, v.t + 0.55);
  T(v, { type: 'square', f: 90, f1: 30, st: 0.5, lp: 1200, peak: 0.22, d: 0.5, to: rattle });
  N(v, { t: 0.03, k: 'crackle', bp: 2500, q: 0.7, peak: 0.6, d: 0.45, to: rattle });
});

sfx('enemyDeathBig', { g: 0.444, verb: 0.4, max: 3, prio: 3, len: 1.8 }, (v) => {
  glassBreak(v, 0, 1.5, 1, 0.9);
  explosion(v, 0.02, 0.8, 0.6);
  T(v, { f: 150, f1: 35, st: 0.4, peak: 0.6, d: 0.5 });
  N(v, { t: 0.05, k: 'crackle', bp: 2200, q: 0.6, peak: 0.7, d: 0.8 });
});

sfx('bossRoar', { g: 0.501, verb: 0.5, max: 1, prio: 3, duck: true, len: 3.0 }, (v) => {
  // Alien choir scream: dissonant saws → formant bank, vibrato, sub.
  const bank = vNode(v, v.ctx.createGain());
  bank.gain.value = 1;
  const formants = [[700, 6, 1], [1150, 8, 0.7], [2600, 10, 0.35]];
  for (const [f, q, gn] of formants) {
    const bp = vNode(v, v.ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f * 0.8, v.t);
    bp.frequency.linearRampToValueAtTime(f * 1.25, v.t + 0.8);   // 'ah' → 'ee'-ish
    bp.frequency.linearRampToValueAtTime(f * 0.9, v.t + 2.0);
    const g = vNode(v, v.ctx.createGain());
    g.gain.value = gn;
    bank.connect(bp); bp.connect(g); g.connect(v.out);
  }
  const vib = vNode(v, v.ctx.createOscillator());
  const vibAmt = vNode(v, v.ctx.createGain());
  vib.frequency.value = 6.5;
  vibAmt.gain.value = 35;
  vib.connect(vibAmt);
  vSrc(v, vib, v.t, v.t + 2.2);
  for (const f of [110, 116.5, 164.8, 233]) {
    const r = T(v, { type: 'sawtooth', f, path: [[0.35, f * 1.35], [2.0, f * 0.8]], a: 0.12, peak: 0.28, hold: 0.9, d: 0.9, to: bank });
    vibAmt.connect(r.osc.detune);
  }
  T(v, { f: 46, f1: 36, st: 1.8, a: 0.08, peak: 0.8, hold: 0.8, d: 1.0 });               // sub
  N(v, { k: 'pink', bp: 1500, q: 0.8, a: 0.15, peak: 0.3, hold: 0.7, d: 0.9 });          // breath
  FM(v, { f: 330, path: [[0.35, 440], [2, 260]], ratio: 1.414, idx: 3, idx1: 1, a: 0.1, peak: 0.12, hold: 0.8, d: 0.9 }); // ring edge
});

sfx('bossLaser', { g: 0.321, verb: 0.3, max: 2, prio: 3, len: 2.2 }, (v) => {
  const lp = vNode(v, v.ctx.createBiquadFilter());
  lp.type = 'lowpass'; lp.Q.value = 4;
  lp.frequency.value = 2200;
  lp.connect(v.out);
  const wob = vNode(v, v.ctx.createOscillator());
  const wobAmt = vNode(v, v.ctx.createGain());
  wob.frequency.value = 12;
  wobAmt.gain.value = 900;
  wob.connect(wobAmt); wobAmt.connect(lp.frequency);
  vSrc(v, wob, v.t, v.t + 1.7);
  T(v, { type: 'sawtooth', f: 180, f1: 220, st: 0.15, a: 0.08, peak: 0.3, hold: 1.1, d: 0.3, to: lp });
  T(v, { type: 'sawtooth', f: 181.5, f1: 221.5, st: 0.15, a: 0.08, peak: 0.3, hold: 1.1, d: 0.3, to: lp });
  T(v, { type: 'square', f: 90, f1: 110, st: 0.15, a: 0.08, peak: 0.18, hold: 1.1, d: 0.3, to: lp });
  N(v, { bp: 4200, q: 1.5, a: 0.08, peak: 0.3, hold: 1.1, d: 0.3 });                      // sizzle
  T(v, { f: 55, a: 0.08, peak: 0.5, hold: 1.1, d: 0.3 });
  N(v, { k: 'wide', hp: 2000, peak: 0.5, d: 0.05 });
});

sfx('bossSpiral', { g: 0.74, verb: 0.3, max: 2, len: 1.0 }, (v) => {
  // One oscillator, re-triggered six times: a rapid volley of plasma launches.
  const osc = vNode(v, v.ctx.createOscillator());
  const g = vNode(v, v.ctx.createGain());
  osc.type = 'triangle';
  g.gain.value = 0;
  osc.connect(g); g.connect(v.out);
  for (let i = 0; i < 6; i++) {
    const t = v.t + i * 0.06;
    osc.frequency.setValueAtTime(1000 * v.p * (1 + i * 0.05), t);
    osc.frequency.exponentialRampToValueAtTime(300 * v.p, t + 0.055);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.056);
  }
  vSrc(v, osc, v.t, v.t + 0.42);
  T(v, { f: 300, f1: 120, st: 0.3, peak: 0.45, d: 0.35 });
  N(v, { k: 'pink', bp: 900, q: 1, peak: 0.3, d: 0.35 });
});

sfx('bossPhase', { g: 0.471, verb: 0.55, max: 1, prio: 3, len: 3.2 }, (v) => {
  T(v, { f: 55, f1: 34, st: 1.2, peak: 1, d: 1.5 });                                      // deep hit
  N(v, { k: 'brown', lp: 400, peak: 0.6, d: 0.8 });
  FM(v, { f: 110, ratio: 1.41, idx: 5, idx1: 0.3, iT: 2, peak: 0.3, d: 2.4 });           // gong resonance
  // shimmering choir swell
  const bank = vNode(v, v.ctx.createGain());
  for (const [f, q, gn] of [[650, 6, 1], [1080, 7, 0.6], [2650, 9, 0.3]]) {
    const bp = vNode(v, v.ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = vNode(v, v.ctx.createGain()); g.gain.value = gn;
    bank.connect(bp); bp.connect(g); g.connect(v.out);
  }
  for (const [f, d] of [[164.8, -7], [196, 6], [246.9, -4], [329.6, 8]]) {
    T(v, { t: 0.1, type: 'sawtooth', f, det: d, a: 1.1, peak: 0.3, hold: 0.4, d: 1.4, to: bank });
  }
  RES(v, { t: 0.3, freqs: [2637, 3951, 5274], q: 40, k: 'crackle', rate: 0.5, a: 0.8, peak: 3, d: 1.5 });
});

sfx('bossDeath', { g: 0.738, verb: 0.55, max: 1, prio: 4, duck: true, len: 4.5 }, (v) => {
  explosion(v, 0, 0.7, 0.55);
  glassBreak(v, 0.02, 1.2, 0.6, 0.6);
  explosion(v, 0.55, 0.85, 0.7);
  explosion(v, 1.05, 0.9, 0.8);
  // final colossal blast
  explosion(v, 1.6, 1.5, 1);
  glassBreak(v, 1.62, 1.6, 1, 1.5);
  T(v, { t: 1.6, f: 60, f1: 20, st: 1.5, peak: 0.9, d: 2.2 });
  N(v, { t: 1.6, k: 'brown', lp: 180, a: 0.05, peak: 0.8, d: 2.5 });
  // dying choir, descending
  for (const f of [220, 261.6, 329.6]) {
    T(v, { t: 0.2, type: 'sawtooth', f, f1: f * 0.5, st: 2.5, bp: 900, q: 3, a: 0.4, peak: 0.12, hold: 0.8, d: 1.8 });
  }
});

/* -------------------------------- World / UI ------------------------------- */

sfx('waveStart', { g: 0.347, verb: 0.4, max: 1, prio: 2, len: 2.4 }, (v) => {
  N(v, { bp: 300, bp1: 4000, fT: 0.95, q: 1.1, rise: 0.95, peak: 0.4, cut: 0.04 });     // tension riser
  T(v, { type: 'sawtooth', f: 110, f1: 440, st: 0.95, lp: 2000, rise: 0.95, peak: 0.12, cut: 0.04 });
  T(v, { t: 1.0, f: 100, f1: 35, st: 0.5, peak: 0.95, d: 0.6 });                        // hit
  N(v, { t: 1.0, k: 'wide', lp: 5000, lp1: 300, fT: 0.4, peak: 0.6, d: 0.45 });
  for (const [f, d] of [[146.8, -6], [174.6, 6], [220, -3]]) {
    T(v, { t: 1.0, type: 'sawtooth', f, det: d, lp: 2200, lp1: 500, fT: 0.8, peak: 0.12, d: 0.9 });
  }
});

sfx('sectorClear', { g: 0.5, verb: 0.45, max: 1, prio: 2, len: 2.6 }, (v) => {
  const notes = [293.7, 370, 440, 587.3];                                                 // D major arpeggio
  notes.forEach((f, i) => {
    T(v, { t: i * 0.09, type: 'sawtooth', f, lp: 3000, lp1: 900, fT: 0.3, peak: 0.12, d: 0.35 });
    bell(v, i * 0.09, f * 2, 0.08, 0.5, 2, 1);
  });
  for (const f of [146.8, 220, 293.7, 370, 440]) {
    T(v, { t: 0.36, type: 'sawtooth', f, det: rand(-9, 9), lp: 2400, lp1: 1200, fT: 1.2, a: 0.08, peak: 0.08, hold: 0.4, d: 1.4 });
  }
  T(v, { t: 0.36, f: 73.4, a: 0.02, peak: 0.4, d: 1.2 });
});

sfx('uiHover', { g: 0.72, verb: 0.02, max: 2, ui: true, prio: 0, gap: 0.03, len: 0.2 }, (v) => {
  T(v, { f: 3200, peak: 0.25, d: 0.018 });
});

sfx('uiClick', { g: 0.879, verb: 0.03, max: 3, ui: true, gap: 0.03, len: 0.2 }, (v) => {
  N(v, { hp: 3000, peak: 0.16, d: 0.008 });
  T(v, { f: 1800, peak: 0.34, d: 0.035 });
});

sfx('uiConfirm', { g: 0.441, verb: 0.08, max: 2, ui: true, len: 0.6 }, (v) => {
  T(v, { type: 'triangle', f: 660, peak: 0.25, d: 0.15 });
  T(v, { f: 990, peak: 0.18, d: 0.15 });
  T(v, { t: 0.06, type: 'triangle', f: 1320, peak: 0.22, d: 0.22 });
});

sfx('uiBack', { g: 0.624, verb: 0.05, max: 2, ui: true, len: 0.4 }, (v) => {
  T(v, { f: 700, f1: 450, st: 0.1, peak: 0.3, d: 0.12 });
  T(v, { type: 'triangle', f: 350, f1: 225, st: 0.1, peak: 0.12, d: 0.1 });
});

sfx('augmentPick', { g: 0.45, verb: 0.4, max: 1, len: 1.6 }, (v) => {
  [880, 1108.7, 1318.5, 1760, 2217.5].forEach((f, i) => bell(v, i * 0.055, f, 0.16, 0.5, 3.5, 1.4));
  N(v, { hp: 5000, rise: 0.3, peak: 0.15, cut: 0.25 });
  T(v, { type: 'sawtooth', f: 220, f1: 880, st: 0.3, lp: 2500, a: 0.2, peak: 0.1, d: 0.5 });
});

sfx('countdown', { g: 0.373, verb: 0.1, max: 2, len: 0.4 }, (v) => {
  T(v, { type: 'square', f: 880, lp: 3000, peak: 0.2, hold: 0.07, d: 0.08 });
  T(v, { f: 1760, peak: 0.08, hold: 0.07, d: 0.08 });
});

sfx('teleport', { g: 0.347, verb: 0.4, max: 1, len: 2.0 }, (v) => {
  T(v, { type: 'sawtooth', f: 100, f1: 1600, st: 1.1, lp: 600, lp1: 5000, fT: 1.1, a: 0.3, peak: 0.2, hold: 0.6, d: 0.25 });
  N(v, { bp: 200, bp1: 5000, fT: 1.1, q: 1, rise: 1.1, peak: 0.45, cut: 0.1 });
  FM(v, { f: 400, f1: 3200, st: 1.1, ratio: 1.5, idx: 2, a: 0.8, peak: 0.1, d: 0.3 });
  N(v, { t: 1.1, k: 'wide', hp: 2500, peak: 0.6, d: 0.1 });                               // arrival zap
  T(v, { t: 1.1, f: 180, f1: 50, st: 0.2, peak: 0.6, d: 0.25 });
});

sfx('victory', { g: 0.451, verb: 0.5, max: 1, len: 3.5 }, (v) => {
  const seq = [[0, 523.3], [0.12, 659.3], [0.24, 784], [0.36, 1046.5]];                   // C major fanfare
  for (const [t, f] of seq) {
    T(v, { t, type: 'sawtooth', f, det: -6, lp: 3200, peak: 0.12, d: 0.4 });
    T(v, { t, type: 'sawtooth', f, det: 6, lp: 3200, peak: 0.12, d: 0.4 });
  }
  for (const f of [130.8, 196, 261.6, 329.6, 392]) {
    T(v, { t: 0.48, type: 'sawtooth', f, det: rand(-10, 10), lp: 2500, lp1: 800, fT: 2, a: 0.05, peak: 0.08, hold: 0.8, d: 1.8 });
  }
  T(v, { t: 0.48, f: 65.4, peak: 0.5, d: 1.5 });
  bell(v, 0.48, 2093, 0.1, 1.2, 2, 1);
});

sfx('death', { g: 0.301, verb: 0.45, max: 1, prio: 3, len: 3.2 }, (v) => {
  T(v, { type: 'sawtooth', f: 110, f1: 55, st: 1.6, lp: 700, lp1: 200, fT: 1.8, det: -8, a: 0.03, peak: 0.3, hold: 0.3, d: 1.8 });
  T(v, { type: 'sawtooth', f: 110, f1: 55, st: 1.6, lp: 700, lp1: 200, fT: 1.8, det: 8, a: 0.03, peak: 0.3, hold: 0.3, d: 1.8 });
  T(v, { f: 55, f1: 27, st: 1.8, peak: 0.8, hold: 0.3, d: 1.9 });
  N(v, { k: 'brown', lp: 300, a: 0.4, peak: 0.5, d: 1.5 });
  T(v, { f: 90, f1: 35, st: 0.3, peak: 0.7, d: 0.4 });
});

/* -------------------------------------------------------------------------- */
/* Loops                                                                        */
/* -------------------------------------------------------------------------- */
// build(L) creates persistent nodes feeding L.in and returns the list of
// detune params (in cents) that setPitch() drives.

const LOOPS = Object.create(null);
function loopDef(name, meta, build) {
  LOOPS[name] = Object.assign({ g: 0.5, verb: 0.15, max: 4 }, meta, { build });
}

function lOsc(L, type, f, to, det = 0) {
  const o = L.ctx.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = det;
  o.connect(to); L.nodes.push(o); L.srcs.push(o);
  return o;
}
function lNoise(L, k, to) {
  const s = L.ctx.createBufferSource();
  s.buffer = L.G.buf[k]; s.loop = true;
  s.connect(to); L.nodes.push(s); L.srcs.push(s);
  s.offset0 = Math.random() * 1.8;
  return s;
}
function lFilt(L, type, f, q, to) {
  const fl = L.ctx.createBiquadFilter();
  fl.type = type; fl.frequency.value = Math.min(f, L.G.nyq); fl.Q.value = q;
  fl.connect(to); L.nodes.push(fl);
  return fl;
}
function lGain(L, v, to) {
  const g = L.ctx.createGain(); g.gain.value = v;
  if (to) g.connect(to);
  L.nodes.push(g);
  return g;
}
function lLfo(L, rate, depth, param, type = 'sine') {
  const g = lGain(L, depth, null);
  g.connect(param);
  lOsc(L, type, rate, g);
  return g;
}

loopDef('overdriveHum', { g: 0.123, verb: 0.2, max: 1 }, (L) => {
  const trem = lGain(L, 0.6, L.in);
  lLfo(L, 2.1, 0.38, trem.gain);
  const lp = lFilt(L, 'lowpass', 320, 2, trem);
  const a = lOsc(L, 'sawtooth', 55, lp, -9), b = lOsc(L, 'sawtooth', 55, lp, 9);
  const sub = lOsc(L, 'sine', 27.5, trem);
  return [a.detune, b.detune, sub.detune, lp.detune];
});

loopDef('lanceIdle', { g: 0.0231, verb: 0.05, max: 2 }, (L) => {
  const bp = lFilt(L, 'bandpass', 1100, 3, L.in);
  lLfo(L, 0.7, 220, bp.detune);
  const a = lOsc(L, 'sine', 120, L.in);
  const b = lOsc(L, 'sawtooth', 240, bp);
  const hp = lFilt(L, 'highpass', 3000, 0.7, lGain(L, 0.08, L.in));
  lNoise(L, 'crackle', hp);
  return [a.detune, b.detune, bp.detune];
});

loopDef('bossHum', { g: 0.0752, verb: 0.35, max: 1 }, (L) => {
  const amp = lGain(L, 0.8, L.in);
  lLfo(L, 0.3, 0.2, amp.gain);
  const sum = lGain(L, 1, null);
  const params = [];
  for (const [f, q, gn] of [[420, 4, 1], [700, 5, 0.7], [1100, 6, 0.35]]) {
    const bp = lFilt(L, 'bandpass', f, q, lGain(L, gn, amp));
    sum.connect(bp);
    lLfo(L, 0.13, 300, bp.detune);
    params.push(bp.detune);
  }
  const lp = lFilt(L, 'lowpass', 260, 1, amp);
  sum.connect(lp);
  for (const [f, d] of [[41.2, -6], [41.5, 7], [61.7, -4], [82.4, 5]]) params.push(lOsc(L, 'sawtooth', f, sum, d).detune);
  params.push(lOsc(L, 'sine', 41.2, lGain(L, 0.7, amp)).detune);
  return params;
});

loopDef('lancerBeam', { g: 0.177, verb: 0.2, max: 4 }, (L) => {
  const bp = lFilt(L, 'bandpass', 1400, 2, L.in);
  const a = lOsc(L, 'square', 440, bp, -5), b = lOsc(L, 'sawtooth', 443, bp, 5);
  const hi = lOsc(L, 'sine', 1760, lGain(L, 0.12, L.in));
  const vib = lGain(L, 15, null);
  lOsc(L, 'sine', 9, vib);
  vib.connect(a.detune); vib.connect(b.detune);
  return [a.detune, b.detune, hi.detune, bp.detune];
});

loopDef('wind', { g: 0.0676, verb: 0.1, max: 1 }, (L) => {
  const gust = lGain(L, 0.7, L.in);
  lLfo(L, 0.05, 0.3, gust.gain);
  const params = [];
  for (const [f, q, pan, rate, depth] of [[480, 0.8, -0.6, 0.07, 600], [950, 0.6, 0.6, 0.11, 500]]) {
    let dest = gust;
    if (L.G.hasPan) { const sp = L.ctx.createStereoPanner(); sp.pan.value = pan; sp.connect(gust); L.nodes.push(sp); dest = sp; }
    const bp = lFilt(L, 'bandpass', f, q, dest);
    lLfo(L, rate, depth, bp.detune);
    lNoise(L, 'pink', bp);
    params.push(bp.detune);
  }
  const lp = lFilt(L, 'lowpass', 200, 0.7, lGain(L, 0.6, gust));
  lNoise(L, 'brown', lp);
  params.push(lp.detune);
  return params;
});

/* -------------------------------------------------------------------------- */
/* Music: theory helpers & track styles                                        */
/* -------------------------------------------------------------------------- */

const CHORD_Q = {
  m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], m9: [0, 3, 7, 14],
  add9: [0, 4, 7, 14], s4: [0, 5, 7], s2: [0, 2, 7], d: [0, 3, 6],
};
const chordEq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** Voice a chord near `lo` with n notes, choosing the inversion closest to prev. */
function voicing(key, ch, prev, lo, n) {
  const pcs = CHORD_Q[ch[1]].map((i) => (key + ch[0] + i) % 12);
  let best = null, bestCost = Infinity;
  for (const base of [lo, lo + 3, lo + 6]) {
    for (let inv = 0; inv < pcs.length; inv++) {
      const notes = [];
      let m = base;
      for (let k = 0; k < n; k++) {
        const pc = pcs[(inv + k) % pcs.length];
        while (((m % 12) + 12) % 12 !== pc) m++;
        notes.push(m);
        m++;
      }
      let cost = Math.abs(notes[0] - lo - 4) * 0.5 + (notes[n - 1] - notes[0] > 19 ? 6 : 0);
      if (prev) for (let i = 0; i < n; i++) cost += Math.abs(notes[i] - prev[Math.min(i, prev.length - 1)]);
      if (cost < bestCost) { bestCost = cost; best = notes; }
    }
  }
  return best;
}

const BASS_SEMI = { x: 0, o: 12, 5: 7, 7: 10 };

const ARP_PATS = [
  [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 2, 4, 3, 4],
  [0, 0, 3, 0, 2, 0, 4, 0, 1, 0, 3, 0, 2, 0, 4, 3],
  [4, 3, 2, 0, 4, 3, 1, 0, 4, 2, 3, 0, 4, 3, 2, 1],
  [0, 1, 2, 4, 1, 2, 4, 3, 0, 1, 2, 4, 1, 2, 4, 3],
];

// Heroic lead for 'final' (over Cm Ab Eb Bb): per bar [step, midi, lengthInSteps].
const MEL_FINAL = [
  [[[0, 67, 6], [6, 72, 2], [8, 74, 4], [12, 75, 4]], [[0, 72, 8], [8, 68, 4], [12, 70, 4]],
   [[0, 70, 6], [6, 75, 2], [8, 74, 4], [12, 70, 4]], [[0, 74, 12], [12, 72, 2], [14, 70, 2]],
   [[0, 67, 4], [4, 72, 4], [8, 75, 4], [12, 79, 4]], [[0, 80, 8], [8, 79, 4], [12, 77, 4]],
   [[0, 75, 6], [6, 74, 2], [8, 75, 4], [12, 79, 4]], [[0, 77, 4], [4, 74, 4], [8, 70, 8]]],
  [[[0, 72, 3], [3, 75, 3], [6, 79, 2], [8, 77, 4], [12, 75, 4]], [[0, 72, 6], [6, 75, 2], [8, 80, 6], [14, 79, 2]],
   [[0, 79, 8], [8, 75, 4], [12, 82, 4]], [[0, 82, 6], [6, 80, 2], [8, 77, 4], [12, 74, 4]],
   [[0, 75, 4], [4, 79, 4], [8, 84, 8]], [[0, 84, 4], [4, 82, 4], [8, 80, 4], [12, 79, 4]],
   [[0, 82, 6], [6, 79, 2], [8, 75, 4], [12, 74, 4]], [[0, 74, 8], [8, 77, 4], [12, 79, 4]]],
];

const STYLES = {
  menu: {
    bpm: 84, key: 57, kind: 'ambient', level: 2.2, bassLo: 33, padLo: 52, padN: 4, padA: 1.6, padRel: 2.4, padCut: 1900,
    progs: [
      [[0, 'm9'], [8, 'M7'], [3, 'add9'], [10, 'M']],
      [[0, 'm9'], [8, 'M7'], [10, 'M'], [7, 'm7']],
      [[8, 'M7'], [10, 'M'], [0, 'm9'], [0, 'm7']],
    ],
    mix: { pad: 0.34, sub: 0.18, arp: 0.23, choir: 0.4, bell: 0.12 },
  },
  combat: {
    bpm: 124, key: 50, kind: 'drive', bassLo: 36, padLo: 50, padN: 4, padA: 0.25, padRel: 0.9,
    progs: [
      [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M'], [0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']],
      [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M'], [0, 'm'], [5, 'm'], [10, 'M'], [7, 'M']],
      [[8, 'M'], [10, 'M'], [0, 'm'], [0, 'm'], [8, 'M'], [10, 'M'], [3, 'M'], [7, 's4']],
      [[0, 'm9'], [0, 'm9'], [8, 'M7'], [8, 'M7'], [3, 'M'], [3, 'M'], [10, 'M'], [7, 'M']],
    ],
    bass: [
      { a: '-xxx-xxx-xxx-xxo', b: '-xxx-xxx-xxo-x5o', f: '-xxo-xox-o5o7o5o' },
      { a: 'x-xox-xox-xox-xo', b: 'x-xox-xox-xo5-o7', f: 'xxoxxoxxo5o7o5ox' },
      { a: 'xxxxxxxxxxxxxxxx', b: 'xxxxxxxxxxxxxxox', f: 'xxxxxxxxo5o7o5o5' },
    ],
    mix: { pad: 0.28, sub: 0.17, drums: 0.8, bass: 0.28, arp: 0.4, choir: 0.84, perc: 1.55, lead: 0 },
  },
  boss: {
    bpm: 140, key: 52, kind: 'drive', heavy: true, bassLo: 40, padLo: 52, padN: 4, padA: 0.2, padRel: 0.8,
    progs: [
      [[0, 'm'], [1, 'M'], [0, 'm'], [8, 'M'], [5, 'm'], [1, 'M'], [10, 'M'], [7, 'M']],
      [[0, 'm'], [0, 'm'], [1, 'M'], [1, 'M'], [8, 'M'], [10, 'M'], [1, 'M'], [7, 'M']],
      [[0, 'm'], [3, 'M'], [1, 'M'], [0, 'm'], [8, 'M'], [5, 'm'], [1, 'M'], [7, 's4']],
    ],
    bass: [
      { a: 'x--x--x-x--x-o-x', b: 'x--x--x-x-xx-o7o', f: 'xxxxxxxxoooo7755' },
      { a: 'xx-xx-xx-xx-x-o-', b: 'xx-xx-xx-x-xo7o5', f: 'xxxxxxxx7777oooo' },
    ],
    mix: { pad: 0.22, sub: 0.18, drums: 0.85, bass: 0.26, arp: 0.28, choir: 0.78, perc: 1.2, lead: 0 },
  },
  final: {
    bpm: 132, key: 48, kind: 'drive', epic: true, bassLo: 36, padLo: 48, padN: 5, padA: 0.35, padRel: 1.2,
    progs: [
      [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M'], [0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']],
      [[8, 'M'], [10, 'M'], [0, 'm'], [0, 'm'], [8, 'M'], [10, 'M'], [7, 'M'], [7, 'M']],
    ],
    order: [[0, 0], [0, 1], [1, -1]],       // [progression, melody] per 8-bar cycle
    bass: [
      { a: 'x-xxx-xxx-xxx-xo', b: 'x-xxx-xxx-xo5-o7', f: 'xxoxxoxxo5o7o5ox' },
      { a: '-xxx-xxx-xxx-xxo', b: '-xxx-xxx-xxo-x5o', f: 'xxxxxxxxo5o7o5o5' },
    ],
    mix: { pad: 0.36, sub: 0.17, drums: 0.8, bass: 0.27, arp: 0.36, choir: 0.9, perc: 1.3, lead: 0.22 },
  },
  victory: {
    bpm: 72, key: 48, kind: 'ambient', major: true, level: 2.2, bassLo: 36, padLo: 52, padN: 5, padA: 1.2, padRel: 3,
    padCut: 2400,
    progs: [[[5, 'M7'], [7, 'M'], [9, 'm7'], [5, 'add9'], [7, 's4'], [0, 'add9']]],
    mix: { pad: 0.3, sub: 0.16, arp: 0.12, choir: 0.45, bell: 0.12 },
  },
};

const OD_DETUNE = -70;   // cents: overdrive "tape slow" feel on music oscillators

/* -------------------------------------------------------------------------- */
/* Music state + heartbeat                                                     */
/* -------------------------------------------------------------------------- */

const M = {
  tracks: [], cur: null, want: null,
  intensity: 0, ix: 0, lastTick: 0,
  overdrive: false, lowHealth: false,
  heartNext: 0, lastGameHeart: -99,
  timer: null,
};

function wantHeart(now) {
  return M.overdrive || (M.lowHealth && now - M.lastGameHeart > 2.5);
}

function heartAt(G, t) {
  const v = voice(G, t, 1, G.heart);
  const g = SFX.lowHealth ? SFX.lowHealth.g : 0.4;     // match the game-driven heartbeat
  v.out.gain.value = g * (M.overdrive ? 0.6 : 0.5);
  heartbeat(v, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* Track: one running piece of music with persistent instruments               */
/* -------------------------------------------------------------------------- */

class Track {
  constructor(G, name, t0, fadeStart, fadeDur) {
    const cfg = STYLES[name], ctx = G.ctx;
    this.G = G; this.ctx = ctx; this.name = name; this.cfg = cfg;
    this.bpm = cfg.bpm; this.sd = 60 / cfg.bpm / 4;
    this.step = 0; this.next = t0; this.origin = t0;
    this.stopAt = Infinity; this.dead = false; this.paused = false; this.fading = false;
    this.nodes = []; this.srcs = [];
    this.prevV = null; this.notes = null; this.tones = null; this.root = cfg.bassLo;
    this.chordQ = 'm'; this.cycle = -1; this.progIdx = 0; this.prog = cfg.progs[0];
    this.bassPat = null; this.bassSet = cfg.bass ? cfg.bass[0] : null; this.arpPat = ARP_PATS[0];
    this.melody = null; this.leadOn = false;
    this.lv = {}; this.lvSet = {};
    this.solo = M.mixOverride || null;    // offline layer-balance renders only

    this.bus = this.gn(0, G.musicIn);
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.setTargetAtTime(cfg.level || 1, Math.max(fadeStart, ctx.currentTime), fadeDur / 4);
    this.pump = this.gn(1, this.bus);
    this.send = this.gn(1, G.musicVerb);
    this.dsrc = null;
    if (G.hasConst) {
      const c = ctx.createConstantSource();
      c.offset.value = M.overdrive ? OD_DETUNE : 0;
      c.start();
      this.nodes.push(c); this.srcs.push(c);
      this.dsrc = c;
    }
    // Layers: [name, through sidechain pump, reverb send]
    this.L = {};
    for (const [k, pumped, send] of [
      ['pad', 1, 0.5], ['sub', 1, 0], ['bass', 1, 0.04], ['choir', 1, 0.7], ['arp', 0, 0.3],
      ['lead', 0, 0.35], ['drums', 0, 0.07], ['perc', 0, 0.14], ['bell', 0, 0.8],
    ]) {
      const lg = this.gn(0, pumped ? this.pump : this.bus);
      if (send) lg.connect(this.gn(send, this.send));
      this.L[k] = lg;
    }
    // Dotted-8th feedback delay for arp / lead / bells.
    const dly = ctx.createDelay(1.5);
    dly.delayTime.value = this.sd * 3;
    const dlp = this.filt('lowpass', 2600, 0.7, null);
    const fb = this.gn(cfg.kind === 'ambient' ? 0.45 : 0.32, dly);
    dly.connect(dlp); dlp.connect(fb);
    dlp.connect(this.gn(0.5, [this.bus, this.send]));
    this.nodes.push(dly);
    this.L.arp.connect(this.gn(cfg.kind === 'ambient' ? 0.5 : 0.3, dly));
    this.L.lead.connect(this.gn(0.22, dly));
    this.L.bell.connect(this.gn(0.35, dly));
    this.build();
    this.updateLayers(ctx.currentTime, true);
  }

  gn(v, to) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (to) link(g, to);
    this.nodes.push(g);
    return g;
  }
  filt(type, f, q, to) {
    const fl = this.ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = Math.min(f, this.G.nyq); fl.Q.value = q;
    if (to) fl.connect(to);
    this.nodes.push(fl);
    return fl;
  }
  osc(type, f, to, det = 0, tune = true) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = det;
    if (tune && this.dsrc) this.dsrc.connect(o.detune);
    o.connect(to); o.start();
    this.nodes.push(o); this.srcs.push(o);
    return o;
  }

  /** Persistent mono instruments driven by automation (no per-note nodes). */
  build() {
    const { cfg, L } = this;
    // Sub bass
    this.subVCA = this.gn(0, L.sub);
    this.subO = this.osc('sine', mtof(cfg.bassLo - 12), this.subVCA);
    // Pads: per-chord oscillators feed two panned sides → one lowpass.
    this.padLP = this.filt('lowpass', cfg.padCut || 1200, 0.6, L.pad);
    if (this.G.hasPan) {
      this.panL = this.ctx.createStereoPanner(); this.panL.pan.value = -0.55;
      this.panR = this.ctx.createStereoPanner(); this.panR.pan.value = 0.55;
      this.panL.connect(this.padLP); this.panR.connect(this.padLP);
      this.nodes.push(this.panL, this.panR);
    } else {
      this.panL = this.panR = this.padLP;
    }
    // Choir: formant bank ('ah') with shared vibrato.
    this.choirIn = this.gn(1, null);
    for (const [f, q, g] of [[680, 5, 1], [1120, 7, 0.55], [2650, 9, 0.28]]) {
      const bp = this.filt('bandpass', f, q, this.gn(g, L.choir));
      this.choirIn.connect(bp);
    }
    this.vib = this.gn(9, null);
    this.osc('sine', 5.2, this.vib, 0, false);
    // Arp / pluck
    const ambient = cfg.kind === 'ambient';
    this.aVCA = this.gn(0, L.arp);
    this.aLP = this.filt('lowpass', 1200, ambient ? 1 : 3, this.aVCA);
    this.aA = this.osc(ambient ? 'triangle' : 'sawtooth', 440, this.aLP);
    this.aB = this.osc(ambient ? 'sine' : 'square', 880, this.gn(ambient ? 0.5 : 0.3, this.aLP));
    if (ambient) return;
    // Rolling bass
    this.bVCA = this.gn(0, L.bass);
    let bIn = this.bVCA;
    if (cfg.heavy) {
      const post = this.filt('lowpass', 1900, 0.8, this.bVCA);
      const ws = this.ctx.createWaveShaper();
      ws.curve = driveCurve(this.G, 3.5);
      ws.connect(post); this.nodes.push(ws);
      bIn = ws;
    }
    this.bLP = this.filt('lowpass', 200, cfg.heavy ? 3 : 6, bIn);
    this.bA = this.osc('sawtooth', 55, this.bLP, -9);
    this.bB = this.osc('sawtooth', 55, this.bLP, 9);
    this.bS = this.osc('square', 27.5, this.gn(0.4, this.bLP));
    // Lead (final)
    if (cfg.epic) {
      this.lVCA = this.gn(0, L.lead);
      this.lLP = this.filt('lowpass', 2600, 1, this.lVCA);
      this.lA = this.osc('sawtooth', 440, this.lLP, -8);
      this.lB = this.osc('sawtooth', 440, this.lLP, 8);
      this.lC = this.osc('square', 220, this.gn(0.3, this.lLP));
      const lv = this.gn(11, null);
      this.osc('sine', 5.5, lv, 0, false);
      lv.connect(this.lA.detune); lv.connect(this.lB.detune);
    }
    // Drums: one looping noise source → gated bands (hats, snare, clap, crash, ride).
    const ns = this.ctx.createBufferSource();
    ns.buffer = this.G.buf.white; ns.loop = true; ns.start();
    this.nodes.push(ns); this.srcs.push(ns);
    const band = (type, f, q, to) => { const g = this.gn(0, to); const fl = this.filt(type, f, q, g); ns.connect(fl); return g; };
    this.hatG = band('highpass', 7200, 0.7, L.drums);
    this.snG = band('bandpass', 1900, 0.7, L.drums);
    this.clapG = band('bandpass', 1150, 1.3, L.drums);
    this.crashG = band('highpass', 4200, 0.5, L.drums);
    this.rideG = band('bandpass', 5600, 1.4, L.perc);
  }

  /* --------------------------- instrument hits ---------------------------- */

  padChord(t, dur, notes) {
    const cfg = this.cfg, ctx = this.ctx;
    const v = voice(this.G, t, 1, null);
    v.hooks = [];
    const a = Math.min(cfg.padA, dur * 0.7), rel = cfg.padRel, peak = 1.6 / notes.length;
    const envL = vNode(v, ctx.createGain()), envR = vNode(v, ctx.createGain());
    envL.connect(this.panL); envR.connect(this.panR);
    for (const env of [envL, envR]) {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + a);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.exponentialRampToValueAtTime(peak * 0.001, t + dur + rel);
    }
    for (const m of notes) {
      for (const [env, det] of [[envL, -12], [envR, 12]]) {
        const o = vNode(v, ctx.createOscillator());
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det + rand(-4, 4);
        if (this.dsrc) { this.dsrc.connect(o.detune); v.hooks.push([this.dsrc, o.detune]); }
        o.connect(env);
        vSrc(v, o, t, t + dur + rel + 0.05);
      }
    }
  }

  choirChord(t, dur, notes, stab) {
    const ctx = this.ctx;
    const v = voice(this.G, t, 1, this.choirIn);
    v.hooks = [];
    const env = v.out, peak = 0.9 / notes.length;
    if (stab) adsr(env.gain, t, 0.02, peak * 1.3, 0.05, 0.35);
    else {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + Math.min(0.7, dur * 0.5));
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.exponentialRampToValueAtTime(peak * 0.001, t + dur + 1.1);
    }
    const end = stab ? t + 0.45 : t + dur + 1.15;
    for (const m of notes) {
      const o = vNode(v, ctx.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = rand(-6, 6);
      this.vib.connect(o.detune); v.hooks.push([this.vib, o.detune]);
      if (this.dsrc) { this.dsrc.connect(o.detune); v.hooks.push([this.dsrc, o.detune]); }
      o.connect(env);
      vSrc(v, o, t, end);
    }
  }

  kick(t, peak) {
    const v = voice(this.G, t, 1, this.L.drums);
    T(v, { f: 380, path: [[0.012, 140], [0.11, 46], [0.4, 40]], a: 0.001, peak, hold: 0.02, d: this.cfg.heavy ? 0.45 : 0.36, fixed: true });
    if (this.cfg.heavy) T(v, { type: 'triangle', f: 120, f1: 50, st: 0.08, sh: 3, peak: peak * 0.25, d: 0.12, fixed: true });
    // Sidechain pump on pads / bass / sub / choir.
    const depth = 0.5 * (this.lv.drums || 0);
    const g = this.pump.gain;
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.012);
    g.setTargetAtTime(1, t + 0.014, 0.075);
  }

  snare(t, lvl, clap = true) {
    const v = voice(this.G, t, 1, this.L.drums);
    T(v, { type: 'triangle', f: 210, f1: 150, st: 0.06, a: 0.001, peak: 0.55 * lvl, d: 0.12, fixed: true });
    const g = this.snG.gain;
    g.setValueAtTime(0.7 * lvl, t);
    g.setTargetAtTime(0, t + 0.003, 0.055);
    if (clap) {
      const c = this.clapG.gain;
      for (let i = 0; i < 3; i++) {
        c.setValueAtTime(lvl * (1 - i * 0.12), t + i * 0.011);
        c.setTargetAtTime(0.02, t + i * 0.011 + 0.001, 0.003);
      }
      c.setValueAtTime(lvl * 0.75, t + 0.033);
      c.setTargetAtTime(0, t + 0.034, 0.07);
    }
  }

  hat(t, lvl, open) {
    const g = this.hatG.gain;
    g.setValueAtTime(lvl, t);
    g.setTargetAtTime(0, t + 0.001, open ? 0.09 : 0.014);
  }

  crash(t, lvl) {
    const g = this.crashG.gain;
    g.setValueAtTime(lvl, t);
    g.setTargetAtTime(0, t + 0.004, 0.55);
  }

  ride(t, lvl) {
    const g = this.rideG.gain;
    g.setValueAtTime(lvl, t);
    g.setTargetAtTime(0, t + 0.002, 0.16);
  }

  tom(t, f, lvl) {
    const v = voice(this.G, t, 1, this.L.perc);
    T(v, { f, f1: f * 0.62, st: 0.2, a: 0.001, peak: lvl, d: 0.28, fixed: true });
  }

  subNote(t, m) {
    this.subO.frequency.setTargetAtTime(mtof(m), t, 0.03);
    this.subVCA.gain.setTargetAtTime(1, t, 0.08);
  }

  bassNote(t, m, acc, x, od) {
    const f = mtof(m), heavy = this.cfg.heavy;
    this.bA.frequency.setValueAtTime(f, t);
    this.bB.frequency.setValueAtTime(f, t);
    this.bS.frequency.setValueAtTime(f / 2, t);
    const base = heavy ? 240 : 160;
    const peak = base + (450 + 1100 * x) * (acc ? 1.5 : 1) * (od ? 0.55 : 1);
    const lp = this.bLP.frequency;
    lp.setTargetAtTime(peak, t, 0.004);
    lp.setTargetAtTime(base, t + 0.012, heavy ? 0.09 : 0.06);
    const gate = this.sd * (heavy ? 0.85 : 0.7);
    const g = this.bVCA.gain;
    g.setTargetAtTime(1, t, 0.002);
    g.setTargetAtTime(0.75, t + 0.015, 0.05);
    g.setTargetAtTime(0, t + gate, 0.012);
  }

  arpNote(t, m, vel, decay, cut) {
    this.aA.frequency.setValueAtTime(mtof(m), t);
    this.aB.frequency.setValueAtTime(mtof(m + 12), t);
    const g = this.aVCA.gain;
    g.setTargetAtTime(vel, t, 0.002);
    g.setTargetAtTime(0, t + 0.01, decay);
    const f = this.aLP.frequency;
    f.setTargetAtTime(cut, t, 0.002);
    f.setTargetAtTime(Math.max(500, cut * 0.25), t + 0.008, decay * 1.2);
  }

  leadNote(t, m, dur) {
    const f = mtof(m);
    for (const [o, k] of [[this.lA, 1], [this.lB, 1], [this.lC, 0.5]]) {
      if (this.leadOn) o.frequency.setTargetAtTime(f * k, t, 0.02);
      else o.frequency.setValueAtTime(f * k, t);
    }
    this.leadOn = true;
    const g = this.lVCA.gain;
    g.setTargetAtTime(1, t, 0.012);
    g.setTargetAtTime(0.7, t + 0.08, 0.25);
    g.setTargetAtTime(0, t + dur - 0.03, 0.04);
    const lp = this.lLP.frequency;
    lp.setTargetAtTime(3600, t, 0.01);
    lp.setTargetAtTime(2100, t + 0.05, 0.3);
  }

  bellNote(t, m, peak, d = 1.4) {
    const v = voice(this.G, t, 1, this.L.bell);
    bell(v, 0, mtof(m), peak, d, 3.5, 1.1);
  }

  /* ------------------------------ harmony ---------------------------------- */

  newCycle() {
    const cfg = this.cfg;
    this.cycle++;
    if (cfg.order) {
      const [pi, mi] = cfg.order[this.cycle % cfg.order.length];
      this.progIdx = pi;
      this.melody = mi >= 0 ? MEL_FINAL[mi] : null;
    } else if (this.cycle > 0 && cfg.progs.length > 1) {
      let i;
      do i = (Math.random() * cfg.progs.length) | 0; while (i === this.progIdx);
      this.progIdx = i;
    }
    this.prog = cfg.progs[this.progIdx];
    if (cfg.bass) this.bassSet = this.cycle === 0 ? cfg.bass[0] : pick(cfg.bass);
    this.arpPat = this.cycle === 0 ? ARP_PATS[0] : pick(ARP_PATS);
  }

  setChord(ch) {
    const cfg = this.cfg;
    this.notes = voicing(cfg.key, ch, this.prevV, cfg.padLo, cfg.padN);
    this.prevV = this.notes;
    const pc = (cfg.key + ch[0]) % 12;
    this.root = cfg.bassLo + ((pc - (cfg.bassLo % 12) + 12) % 12);
    this.tones = this.notes.slice(0, 4).map((n) => n + 12);
    this.tones.push(this.notes[0] + 24);
    this.chordQ = ch[1];
  }

  /** Lengths (in bars) of the chord starting at bar index cb of the progression. */
  chordLen(cb) {
    let len = 1;
    while (cb + len < this.prog.length && chordEq(this.prog[cb + len], this.prog[cb])) len++;
    return len;
  }

  /* ------------------------------ sequencing ------------------------------- */

  schedule(s, t) {
    if (this.cfg.kind === 'drive') this.stepDrive(s, t);
    else this.stepAmbient(s, t);
    if ((s & (this.cfg.kind === 'ambient' ? 3 : 7)) === 0 && wantHeart(t)) heartAt(this.G, t);
  }

  stepDrive(s, t) {
    const cfg = this.cfg, lv = this.lv, x = M.ix, od = M.overdrive;
    const st = s & 15, bar = s >> 4, cb = bar % 8, heavy = cfg.heavy;
    if (st === 0) {
      if (cb === 0) this.newCycle();
      const ch = this.prog[cb];
      if (cb === 0 || !chordEq(this.prog[cb - 1], ch)) {
        this.setChord(ch);
        const dur = this.chordLen(cb) * 16 * this.sd;
        this.padChord(t, dur, cfg.epic ? [this.notes[0] - 12, ...this.notes] : this.notes);
        if (lv.choir > 0.01) this.choirChord(t, dur, this.notes.slice(0, 3).map((n) => n + (heavy ? 0 : 12)));
        this.subNote(t, this.root - 12);
      }
      if (cb === 0 && bar > 0 && lv.drums > 0.3) this.crash(t, 0.4);
      const set = this.bassSet;
      this.bassPat = cb === 7 ? set.f : cb % 4 === 3 ? set.b : set.a;
    }

    // Drums
    if (lv.drums > 0.01) {
      const half = heavy && ((bar >> 2) & 1) === 0;       // boss: half-time ↔ double-time
      let k = 0;
      if (half) k = st === 0 ? 1 : st === 10 ? 0.85 : st === 7 && x > 0.6 ? 0.6 : 0;
      else k = (st & 3) === 0 ? 1 : st === 14 && x > 0.9 && (cb & 1) ? 0.7 : 0;
      if (k) this.kick(t, k);
      const sn = half ? st === 8 : st === 4 || st === 12;
      if (sn) this.snare(t, 1);
      else if (heavy && !half && x > 0.5 && (st === 7 || (cb % 4 === 3 && st >= 13))) this.snare(t, 0.45, false);
      else if (cb === 7 && st >= 12 && lv.perc < 0.5 && x > 0.45) this.snare(t, 0.3 + (st - 12) * 0.15, false);
      // Hats: 16ths when intense, 8ths otherwise, sparse offbeats in overdrive.
      const openBeat = (st & 3) === 2;
      if (od) { if (openBeat) this.hat(t, 0.22, false); }
      else if (openBeat && x > 0.45 && !half) this.hat(t, 0.24, true);
      else if (x > 0.55 && !half) this.hat(t, (st & 1) ? 0.1 : 0.17, false);
      else if (!(st & 1)) this.hat(t, 0.15, false);
    }
    // Extra percussion: ride + tom fills every 8 bars.
    if (lv.perc > 0.01) {
      if (!(st & 1) && !od) this.ride(t, (st & 3) === 2 ? 0.2 : 0.12);
      if (cb === 7 && st >= 8) {
        const tf = [200, 0, 170, 150, 130, 115, 100, 88][st - 8];
        if (tf) this.tom(t, tf * (heavy ? 0.85 : 1), 0.8);
      }
    }
    // Bass
    if (lv.bass > 0.01 && this.bassPat) {
      let c = this.bassPat[st];
      if (c === '7' && this.chordQ !== 'm' && this.chordQ !== 'm9') c = '5';
      if (c !== '-') this.bassNote(t, this.root + BASS_SEMI[c], c !== 'x', x, od);
    }
    // Arp / pluck
    if (lv.arp > 0.01 && this.tones) {
      const every = od || heavy ? 2 : 1;
      if (st % every === 0) {
        const idx = this.arpPat[(st / every + (heavy ? bar * 8 : 0)) & 15];
        const m = this.tones[idx % this.tones.length] + (heavy ? 12 : 0);
        this.arpNote(t, m, (st & 3) === 0 ? 1 : 0.7, heavy ? 0.09 : 0.06, od ? 1400 : 2600 + 2400 * x);
      }
    }
    // Boss choir stabs
    if (heavy && lv.choir > 0.01 && (bar & 1) && (st === 0 || st === 3 || st === 6) && this.notes) {
      this.choirChord(t, 0.3, this.notes.slice(0, 3).map((n) => n + 12), true);
    }
    // Heroic lead
    if (cfg.epic && lv.lead > 0.01 && this.melody) {
      for (const [ns, m, len] of this.melody[cb]) if (ns === st) this.leadNote(t, m, len * this.sd);
    }
  }

  stepAmbient(s, t) {
    const cfg = this.cfg, st = s & 15, bar = s >> 4;
    const victory = !!cfg.major;
    const chordBars = victory ? 1 : 2;
    const sustain = victory && bar >= this.prog.length;
    if (st === 0) {
      if (sustain) {
        if ((bar - this.prog.length) % 4 === 0) {
          this.setChord(this.prog[this.prog.length - 1]);
          this.padChord(t, 4 * 16 * this.sd, this.notes);
          this.choirChord(t, 4 * 16 * this.sd, this.notes.slice(0, 3).map((n) => n + 12));
          this.subNote(t, this.root - 12);
        }
      } else if (bar % chordBars === 0) {
        const pos = victory ? bar : (bar >> 1) % this.prog.length;
        if (!victory && pos === 0) this.newCycle();
        this.setChord(this.prog[pos]);
        const dur = chordBars * 16 * this.sd;
        this.padChord(t, dur, this.notes);
        if (victory ? bar >= 2 : this.cycle % 2 === 1) this.choirChord(t, dur, this.notes.slice(0, 3).map((n) => n + 12));
        this.subNote(t, this.root - 12);
      }
    }
    if (!this.tones) return;
    if (victory) {
      if (!sustain && (st & 3) === 0) this.bellNote(t, this.tones[(st >> 2) % this.tones.length] + 12, 0.7, 1.6);
      else if (sustain && st === 0 && (bar & 1) && Math.random() < 0.6) this.bellNote(t, pick(this.tones) + 12, 0.5, 2.2);
      if (!sustain && (st & 1) === 0 && bar >= 1) this.arpNote(t, this.tones[this.arpPat[st >> 1]], 0.5, 0.25, 1800);
      return;
    }
    // Menu: slow plucked arpeggio with delay; occasional high bell.
    if ((st & 1) === 0 && Math.random() > 0.15) {
      const idx = this.arpPat[(st >> 1) + ((bar & 1) << 3)];
      this.arpNote(t, this.tones[idx % this.tones.length], 0.8, 0.28, 1700);
    }
    if (st === 8 && bar % 4 === 1) this.bellNote(t, pick(this.tones) + 12, 0.8, 2.4);
  }

  /** Layer levels from the (smoothed) intensity; ramps only when they change. */
  updateLayers(now, force) {
    const cfg = this.cfg, x = M.ix;
    const t = cfg.kind === 'ambient'
      ? { pad: 1, sub: 1, arp: 1, bell: 1, choir: 1, drums: 0, bass: 0, lead: 0, perc: 0 }
      : {
        pad: 1, sub: 1, bell: 0,
        drums: smooth(0.28, 0.42, x), bass: smooth(0.3, 0.45, x),
        arp: smooth(0.62, 0.78, x), choir: smooth(0.66, 0.84, x),
        lead: cfg.epic ? smooth(0.55, 0.75, x) : 0, perc: smooth(0.86, 0.98, x),
      };
    for (const k in this.L) {
      this.lv[k] = t[k] || 0;
      const solo = this.solo;
      const target = (solo && solo.indexOf(k) < 0 ? 0 : cfg.mix[k] || 0) * this.lv[k];
      if (force || Math.abs(target - (this.lvSet[k] !== undefined ? this.lvSet[k] : -1)) > 0.004) {
        const p = this.L[k].gain;
        p.cancelScheduledValues(now);
        p.setTargetAtTime(target, now, force ? 0.03 : 0.3);
        this.lvSet[k] = target;
      }
    }
    if (cfg.kind === 'drive') {
      const cut = (M.overdrive ? 700 : 900) + 2600 * x;
      if (force || Math.abs(cut - (this.cutSet || 0)) > 40) {
        this.padLP.frequency.cancelScheduledValues(now);
        this.padLP.frequency.setTargetAtTime(cut, now, force ? 0.03 : 0.4);
        this.cutSet = cut;
      }
    }
  }

  setDetune(now, cents) {
    if (!this.dsrc) return;
    this.dsrc.offset.cancelScheduledValues(now);
    this.dsrc.offset.setTargetAtTime(cents, now, cents ? 0.15 : 0.2);
  }

  run(now, horizon) {
    if (this.dead) return;
    if (now >= this.stopAt) { this.dispose(); return; }
    if (this.paused) return;
    if (this.next < now - 0.1) {          // fell behind (jank / throttled timer): skip ahead
      const n = Math.ceil((now - this.next) / this.sd);
      this.step += n; this.next += n * this.sd;
    }
    while (this.next < horizon && this.next < this.stopAt) {
      try { this.schedule(this.step, this.next); } catch (e) { /* keep the clock running */ }
      this.step++;
      this.next += this.sd;
    }
  }

  nextGrid(t, steps) {
    const q = this.sd * steps;
    return this.origin + Math.ceil((t - this.origin) / q - 1e-6) * q;
  }

  pause() { this.paused = true; }

  resume(t) {
    if (!this.paused) return;
    this.paused = false;
    this.next = t;
    this.origin = t - this.step * this.sd;
    if (this.notes && !this.dead) {
      const left = (16 - (this.step & 15)) * this.sd;
      this.padChord(t, Math.max(0.6, left), this.notes);
    }
  }

  fadeOut(t0, dur) {
    if (this.fading) return;
    this.fading = true;
    const g = this.bus.gain;
    g.cancelScheduledValues(t0);
    g.setTargetAtTime(0, t0, Math.max(0.02, dur / 4));
    this.stopAt = t0 + dur * 1.6 + 0.1;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const s of this.srcs) { try { s.stop(); } catch (e) { /* not started / already stopped */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    this.nodes.length = 0; this.srcs.length = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Stingers: short phrases in the current key                                  */
/* -------------------------------------------------------------------------- */

function stab(v, t, notes, peak, d, lp = 3000, lp1 = 600) {
  for (const m of notes) {
    T(v, { t, type: 'sawtooth', f: mtof(m), det: -7, lp, lp1, fT: d * 0.8, a: 0.008, peak, d, fixed: true });
    T(v, { t, type: 'sawtooth', f: mtof(m), det: 7, lp, lp1, fT: d * 0.8, a: 0.008, peak, d, fixed: true });
  }
}
const triad = (r, q) => q === 'M' ? [r, r + 4, r + 7] : [r, r + 3, r + 7];

const STINGERS = {
  waveStart(v, k) {
    stab(v, 0, [k - 12, k - 5, k, k + 3, k + 7], 0.05, 0.9);
    T(v, { f: 72, f1: 34, st: 0.4, peak: 0.7, d: 0.6, fixed: true });
    N(v, { k: 'wide', lp: 4000, lp1: 300, fT: 0.3, peak: 0.35, d: 0.4, fixed: true });
    bell(v, 0, mtof(k + 24), 0.06, 0.8, 2, 1.2);
  },
  sectorClear(v, k) {
    const seq = [[0, k + 8], [0.3, k + 10], [0.6, k]];
    seq.forEach(([t, r], i) => {
      const q = 'M';
      stab(v, t, triad(r, q), i === 2 ? 0.035 : 0.03, i === 2 ? 1.8 : 0.35, 2600, 900);
      triad(r + 12, q).forEach((m, j) => bell(v, t + j * 0.05, mtof(m + 12), 0.05, 0.6, 2, 1));
    });
    T(v, { t: 0.6, f: mtof(k - 24), a: 0.02, peak: 0.45, d: 1.4, fixed: true });
  },
  death(v, k) {
    [k + 7, k + 5, k + 3, k + 2, k].forEach((m, i) => {
      T(v, { t: i * 0.38, type: 'sawtooth', f: mtof(m), lp: 1100, a: 0.03, peak: 0.1, hold: 0.2, d: 0.6, fixed: true });
    });
    for (const m of [k - 24, k - 12, k - 5]) {
      T(v, { type: 'sawtooth', f: mtof(m), det: rand(-8, 8), lp: 500, a: 0.4, peak: 0.09, hold: 1.2, d: 1.6, fixed: true });
    }
    T(v, { f: 60, f1: 30, st: 0.8, peak: 0.6, d: 1.2, fixed: true });
  },
  bossDefeated(v, k) {
    const seq = [[0, k + 8, 0.55], [0.6, k + 10, 0.55], [1.2, k, 2.6]];
    for (const [t, r, d] of seq) {
      stab(v, t, [r - 12, ...triad(r, 'M'), r + 12], 0.03, d, 3200, 1000);
    }
    T(v, { t: 1.2, f: 80, f1: 32, st: 0.8, peak: 0.8, d: 1.2, fixed: true });
    N(v, { t: 1.2, hp: 4000, peak: 0.2, d: 1.5, fixed: true });
    [0, 4, 7, 12, 16, 19, 24].forEach((iv, i) => bell(v, 1.2 + i * 0.07, mtof(k + 12 + iv), 0.05, 1.2, 2, 1));
  },
  augment(v, k) {
    [12, 15, 19, 24, 27, 31].forEach((iv, i) => bell(v, i * 0.05, mtof(k + 12 + iv), 0.08, 0.7, 3.5, 1.3));
    N(v, { hp: 5000, rise: 0.25, peak: 0.08, cut: 0.3, fixed: true });
    stab(v, 0.05, [k, k + 7, k + 12], 0.03, 0.9, 2400, 800);
  },
};

/* -------------------------------------------------------------------------- */
/* Engine state                                                                */
/* -------------------------------------------------------------------------- */

const S = {
  ctx: null, G: null, ready: false, failed: false,
  vol: { master: 1, music: 1, sfx: 1 },
  L: { x: 0, y: 0, z: 0, yaw: 0 },
  voices: [], byName: new Map(), lastStart: new Map(), lastSweep: 0,
  loops: [], lastLoopUpdate: 0,
  warned: new Set(),
  userPaused: false, hiddenSuspended: false, visHooked: false,
};

const DUMMY_LOOP = Object.freeze({ setVolume() {}, setPitch() {}, setPos() {}, stop() {} });

function warnOnce(key) {
  if (S.warned.has(key)) return;
  S.warned.add(key);
  try { console.warn('[audio] unknown sound: ' + key); } catch (e) { /* no console */ }
}

function makeContext() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { return new AC({ latencyHint: 'interactive' }); } catch (e) {
    try { return new AC(); } catch (e2) { return null; }
  }
}

function resumeCtx() {
  const ctx = S.ctx;
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  if (typeof document !== 'undefined' && document.hidden) return;
  try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}

function onVisibility() {
  const ctx = S.ctx;
  if (!ctx) return;
  try {
    if (document.hidden) {
      if (ctx.state === 'running') {
        S.hiddenSuspended = true;
        const p = ctx.suspend(); if (p && p.catch) p.catch(() => {});
      }
    } else if (S.hiddenSuspended) {
      S.hiddenSuspended = false;
      resumeCtx();
    }
  } catch (e) { /* ignore */ }
}

function init() {
  try {
    if (S.failed) return false;
    if (!S.ctx) {
      const ctx = makeContext();
      if (!ctx) { S.failed = true; return false; }
      // iOS unlock first: resume + one silent sample inside the gesture.
      try {
        if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch (e) { /* ignore */ }
      try {
        S.G = buildGraph(ctx, true);
      } catch (e) {
        S.failed = true;
        try { ctx.close(); } catch (e2) { /* ignore */ }
        return false;
      }
      S.ctx = ctx;
      if (!S.visHooked && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility);
        S.visHooked = true;
      }
      S.ready = true;
      applyVolumes(true);
      applyFx(true);
      if (M.want) { const w = M.want; M.want = null; musicPlay(w); }
      if (M.overdrive || M.lowHealth) kickSeq();
    }
    resumeCtx();
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------- volumes & filter ----------------------------- */

function applyVolumes(force) {
  if (!S.ready) return;
  const G = S.G, now = S.ctx.currentTime, tau = force ? 0.01 : 0.05;
  const sq = (x) => x * x;                   // perceptual slider curve
  const set = (p, v) => { p.cancelScheduledValues(now); p.setTargetAtTime(v, now, tau); };
  set(G.master.gain, sq(S.vol.master));
  set(G.sfx.gain, sq(S.vol.sfx));
  set(G.ui.gain, sq(S.vol.sfx));
  set(G.heart.gain, sq(S.vol.sfx));
  set(G.sfxVerb.gain, sq(S.vol.sfx));
  set(G.musicVol.gain, sq(S.vol.music));
  set(G.musicVerb.gain, MUSIC_TRIM * sq(S.vol.music));
}

function applyFx(force) {
  if (!S.ready) return;
  const G = S.G, now = S.ctx.currentTime;
  const base = G.fx.frequency.value;
  const target = M.overdrive ? 700 : M.lowHealth ? 1600 : base;
  const cents = 1200 * Math.log2(target / base);
  const down = cents < G.fx._cents - 1 || G.fx._cents === undefined;
  const tau = force ? 0.01 : down ? 0.12 : 0.2;     // ~0.35 s down, ~0.6 s back up
  G.fx._cents = cents;
  G.fx.detune.cancelScheduledValues(now);
  G.fx.detune.setTargetAtTime(cents, now, tau);
  G.fx.Q.cancelScheduledValues(now);
  G.fx.Q.setTargetAtTime(M.overdrive ? 1.8 : M.lowHealth ? 1.0 : 0.7, now, tau);
}

/* ------------------------------- spatial ----------------------------------- */

function spatial(pos) {
  const L = S.L;
  const dx = finite(pos.x, 0) - L.x, dy = finite(pos.y, 0) - L.y, dz = finite(pos.z, 0) - L.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
  let pan = 0, front = 1;
  if (dist > 0.05) {
    const side = (dx * c - dz * s) / dist;         // right   = ( cos, 0, -sin)
    front = (-dx * s - dz * c) / dist;             // forward = (-sin, 0, -cos)
    pan = clamp(side * Math.min(1, dist / 2), -1, 1) * 0.85;
  }
  let gain = dist <= REF_DIST ? 1 : REF_DIST / (REF_DIST + ROLLOFF * (dist - REF_DIST));
  let cutoff = 20000 * Math.pow(REF_DIST / Math.max(dist, REF_DIST), 0.72);
  if (front < 0) { cutoff *= 1 + 0.4 * front; gain *= 1 + 0.12 * front; }
  cutoff = clamp(cutoff, 900, 20000);
  const wet = 1 + Math.min(1.5, dist / 30);
  return { gain, pan, cutoff, wet };
}

/* ------------------------------ one-shots ---------------------------------- */

/** Build one SFX voice into graph G (used live and offline). */
function spawn(G, name, def, t, pitch, gain, pan, cutoff, wet) {
  const ctx = G.ctx;
  const v = voice(G, t, pitch, null);
  v.name = name; v.prio = def.prio; v.start = t;
  v.out.gain.value = gain;
  let tail = v.out;
  if (cutoff && cutoff < 16000) {
    const lp = vNode(v, ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.frequency.value = Math.min(cutoff, G.nyq); lp.Q.value = 0.5;
    tail.connect(lp); tail = lp;
  }
  if (pan && G.hasPan && Math.abs(pan) > 0.01) {
    const sp = vNode(v, ctx.createStereoPanner());
    sp.pan.value = clamp(pan, -1, 1);
    tail.connect(sp); tail = sp;
  }
  tail.connect(def.ui ? G.ui : G.sfx);
  const send = def.verb * wet;
  if (send > 0.004) {
    const sg = vNode(v, ctx.createGain());
    sg.gain.value = send;
    tail.connect(sg); sg.connect(G.sfxVerb);
  }
  def.fn(v);
  if (v.srcs === 0) vFree(v);
  return v;
}

function dropVoice(v) {
  const i = S.voices.indexOf(v);
  if (i >= 0) S.voices.splice(i, 1);
  const list = S.byName.get(v.name);
  if (list) { const j = list.indexOf(v); if (j >= 0) list.splice(j, 1); }
}

function steal(v) {
  dropVoice(v);
  v.stolen = true;
  const now = S.ctx.currentTime;
  try {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setTargetAtTime(0, now, 0.012);
  } catch (e) { /* ignore */ }
  if (v.srcList) for (const s of v.srcList) { try { s.stop(now + 0.07); } catch (e) { /* already stopping */ } }
  setTimeout(() => vFree(v), 400);               // in case a not-yet-started source never fires onended
}

function admit(name, def, now) {
  if (now - S.lastSweep > 2) {                   // safety: free voices whose onended never fired
    S.lastSweep = now;
    for (const v of S.voices.slice()) if (v.end < now - 1.5) { dropVoice(v); vFree(v); }
  }
  const list = S.byName.get(name);
  if (list && list.length >= def.max) steal(list[0]);
  if (S.voices.length >= MAX_VOICES) {
    let victim = null;
    for (const v of S.voices) {
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
    }
    if (!victim || victim.prio > def.prio) return false;
    steal(victim);
  }
  return true;
}

function duckMusic(now) {
  const g = S.G.duck.gain;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(0.63, now, 0.015);            // ≈ -4 dB
  g.setTargetAtTime(1, now + 0.25, 0.12);
}

function play(name, opts) {
  try {
    if (!S.ready) return;
    const def = SFX[name];
    if (!def) { warnOnce(String(name)); return; }
    const ctx = S.ctx;
    if (ctx.state !== 'running') return;
    if (S.userPaused && !def.ui) return;
    opts = opts || {};
    const now = ctx.currentTime;
    const last = S.lastStart.get(name);
    if (last !== undefined && now - last < def.gap && now >= last) return;
    if (name === 'lowHealth') M.lastGameHeart = now;
    const vol = clamp(finite(opts.volume, 1), 0, 4);
    if (vol <= 0.0001) return;
    let pitch = clamp(finite(opts.pitch, 1), 0.25, 4);
    if (!opts.exact) pitch *= 1 + (Math.random() * 2 - 1) * 0.03;
    if (M.overdrive && !def.ui) pitch *= 0.93;
    let gain = def.g * vol, pan = 0, cutoff = 0, wet = 1;
    if (opts.pos && typeof opts.pos === 'object') {
      const sp = spatial(opts.pos);
      gain *= sp.gain; pan = sp.pan; cutoff = sp.cutoff; wet = sp.wet;
    } else if (opts.pan !== undefined) {
      pan = clamp(finite(opts.pan, 0), -1, 1);
    }
    if (!admit(name, def, now)) return;
    const v = spawn(S.G, name, def, now, pitch, gain, pan, cutoff, wet);
    if (!v.done) {
      v.onDone = dropVoice;
      S.voices.push(v);
      let list = S.byName.get(name);
      if (!list) { list = []; S.byName.set(name, list); }
      list.push(v);
    }
    S.lastStart.set(name, now);
    if (def.duck) duckMusic(now);
  } catch (e) {
    /* never throw into game code */
  }
}

/* -------------------------------- loops ------------------------------------ */

/** Build a loop into graph G. Returns the loop record (with .handle). */
function makeLoop(G, name, def, opts, t) {
  const ctx = G.ctx;
  const L = {
    G, ctx, name, def, nodes: [], srcs: [], stopped: false,
    vol: clamp(finite(opts.volume, 1), 0, 4), pos: opts.pos || null,
    pan: clamp(finite(opts.pan, 0), -1, 1), last: null, t0: t,
  };
  L.out = G.gain(0, null); L.nodes.push(L.out);
  L.in = L.out;
  L.lp = ctx.createBiquadFilter(); L.lp.type = 'lowpass';
  L.lp.frequency.value = Math.min(20000, G.nyq); L.lp.Q.value = 0.5;
  L.out.connect(L.lp); L.nodes.push(L.lp);
  let tail = L.lp;
  if (G.hasPan) { L.sp = ctx.createStereoPanner(); tail.connect(L.sp); tail = L.sp; L.nodes.push(L.sp); }
  tail.connect(G.sfx);
  L.send = G.gain(def.verb, G.sfxVerb); L.nodes.push(L.send);
  tail.connect(L.send);
  L.params = def.build(L).map((p) => [p, p.value]);
  for (const s of L.srcs) { if (s.offset0 !== undefined) s.start(t, s.offset0); else s.start(t); }
  L.apply = (tau) => {
    const now = Math.max(ctx.currentTime, L.t0);
    let gain = def.g * L.vol, pan = L.pan, cutoff = 20000, wet = 1;
    if (L.pos) { const sp = spatial(L.pos); gain *= sp.gain; pan = sp.pan; cutoff = sp.cutoff; wet = sp.wet; }
    const k = [gain, pan, cutoff, wet];
    if (L.last && Math.abs(k[0] - L.last[0]) < 0.002 && Math.abs(k[1] - L.last[1]) < 0.01 && Math.abs(k[2] - L.last[2]) < 50) return;
    L.last = k;
    L.out.gain.setTargetAtTime(gain, now, tau);
    L.lp.frequency.setTargetAtTime(Math.min(cutoff, G.nyq), now, tau);
    if (L.sp) L.sp.pan.setTargetAtTime(pan, now, tau);
    L.send.gain.setTargetAtTime(def.verb * wet, now, tau);
  };
  L.stop = (fade) => {
    if (L.stopped) return;
    L.stopped = true;
    const i = S.loops.indexOf(L);
    if (i >= 0) S.loops.splice(i, 1);
    const now = ctx.currentTime, f = Math.max(0.01, finite(fade, 0.1));
    L.out.gain.cancelScheduledValues(now);
    L.out.gain.setTargetAtTime(0, now, f / 4);
    for (const s of L.srcs) { try { s.stop(now + f + 0.05); } catch (e) { /* ignore */ } }
    if (L.srcs[0]) {
      L.srcs[0].onended = () => { for (const n of L.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } } };
    }
  };
  L.handle = {
    setVolume(v) { try { if (L.stopped) return; L.vol = clamp(finite(v, L.vol), 0, 4); L.apply(0.05); } catch (e) { /* ignore */ } },
    setPitch(p) {
      try {
        if (L.stopped) return;
        const cents = 1200 * Math.log2(clamp(finite(p, 1), 0.1, 8));
        const now = ctx.currentTime;
        for (const [param, base] of L.params) param.setTargetAtTime(base + cents, now, 0.04);
      } catch (e) { /* ignore */ }
    },
    setPos(pos) { try { if (L.stopped || !pos) return; L.pos = { x: pos.x, y: pos.y, z: pos.z }; L.apply(0.04); } catch (e) { /* ignore */ } },
    stop(fade = 0.1) { try { L.stop(fade); } catch (e) { /* ignore */ } },
  };
  L.out.gain.setValueAtTime(0, t);
  L.apply(0.06);
  return L;
}

function loop(name, opts) {
  try {
    if (!S.ready) return DUMMY_LOOP;
    const def = LOOPS[name];
    if (!def) { warnOnce(String(name)); return DUMMY_LOOP; }
    opts = opts || {};
    const same = S.loops.filter((l) => l.name === name);
    if (same.length >= def.max) same[0].stop(0.05);
    if (S.loops.length >= MAX_LOOPS) S.loops[0].stop(0.05);
    const L = makeLoop(S.G, name, def, opts, S.ctx.currentTime);
    S.loops.push(L);
    return L.handle;
  } catch (e) {
    return DUMMY_LOOP;
  }
}

/* -------------------------------- music ------------------------------------ */

function kickSeq() {
  if (!M.timer && S.ready) M.timer = setTimeout(tick, 0);
}

function tick() {
  M.timer = null;
  if (!S.ready) return;
  try {
    const now = S.ctx.currentTime;
    const dt = clamp(now - M.lastTick, 0, 0.5);
    M.lastTick = now;
    M.ix += (M.intensity - M.ix) * Math.min(1, dt * 2.2);
    if (Math.abs(M.intensity - M.ix) < 0.002) M.ix = M.intensity;
    for (const tr of M.tracks) {
      if (tr.dead) continue;
      tr.updateLayers(now, false);
      tr.run(now, now + LOOKAHEAD);
    }
    M.tracks = M.tracks.filter((tr) => !tr.dead);
    if (M.cur && M.cur.dead) M.cur = null;
    const clocked = M.cur && !M.cur.paused;
    if (!clocked && !S.userPaused && wantHeart(now)) {
      if (M.heartNext < now) M.heartNext = now + 0.05;
      while (M.heartNext < now + LOOKAHEAD) {
        heartAt(S.G, M.heartNext);
        M.heartNext += M.overdrive ? 0.95 : 0.85;
      }
    }
  } catch (e) { /* keep ticking */ }
  if (M.tracks.length || M.overdrive || M.lowHealth) M.timer = setTimeout(tick, TICK_MS);
}

function musicPlay(name) {
  try {
    if (!STYLES[name]) { warnOnce('music:' + name); return; }
    if (!S.ready) { M.want = name; return; }
    const now = S.ctx.currentTime, cur = M.cur;
    if (cur && cur.name === name && !cur.fading && !cur.dead) return;
    let t0, fs, fd;
    if (cur && !cur.dead && !cur.paused && !cur.fading) {
      t0 = cur.nextGrid(now + 0.06, 16);                       // next bar
      if (t0 - now > 2.0) t0 = cur.nextGrid(now + 0.06, 4);   // slow tempo: next beat
      fs = Math.max(now, t0 - 0.75);
      fd = 1.5;
      cur.fadeOut(fs, fd);
    } else {
      if (cur && !cur.dead) cur.fadeOut(now, 0.4);
      t0 = now + 0.08; fs = now; fd = 1.2;
    }
    if (!M.tracks.length) M.ix = M.intensity;              // no music running: jump straight to target
    const tr = new Track(S.G, name, t0, fs, fd);
    if (S.userPaused) tr.pause();
    M.cur = tr;
    M.want = name;
    M.tracks.push(tr);
    kickSeq();
  } catch (e) { /* ignore */ }
}

function musicStop(fade) {
  try {
    M.want = null;
    if (!S.ready || !M.cur) return;
    M.cur.fadeOut(S.ctx.currentTime, Math.max(0.02, finite(fade, 1.5)));
    M.cur = null;
  } catch (e) { /* ignore */ }
}

function setOverdrive(on) {
  try {
    on = !!on;
    if (on === M.overdrive) return;
    M.overdrive = on;
    if (!S.ready) return;
    const now = S.ctx.currentTime;
    applyFx(false);
    for (const tr of M.tracks) tr.setDetune(now, on ? OD_DETUNE : 0);
    kickSeq();
  } catch (e) { /* ignore */ }
}

function setLowHealth(on) {
  try {
    on = !!on;
    if (on === M.lowHealth) return;
    M.lowHealth = on;
    if (!S.ready) return;
    applyFx(false);
    kickSeq();
  } catch (e) { /* ignore */ }
}

function stinger(name) {
  try {
    if (!S.ready) return;
    const fn = STINGERS[name];
    if (!fn) { warnOnce('stinger:' + name); return; }
    if (S.ctx.state !== 'running' || S.userPaused) return;
    const now = S.ctx.currentTime;
    const last = S.lastStart.get('stinger:' + name);
    if (last !== undefined && now - last < 0.25) return;
    S.lastStart.set('stinger:' + name, now);
    const cur = M.cur && !M.cur.dead && !M.cur.paused ? M.cur : null;
    const t = cur ? Math.max(now + 0.02, cur.nextGrid(now + 0.02, 2)) : now + 0.02;
    const key = cur ? cur.cfg.key : 50;
    spawnStinger(S.G, fn, t, key);
  } catch (e) { /* ignore */ }
}

const STING_GAIN = { waveStart: 1, sectorClear: 0.9, death: 0.64, bossDefeated: 0.37, augment: 0.8 };

function spawnStinger(G, fn, t, key) {
  const v = voice(G, t, 1, G.musicVol);
  v.out.gain.value = STING_GAIN[fn.name] || 1;
  const send = vNode(v, G.gain(0.45, G.musicVerb));
  v.out.connect(send);
  fn(v, key);
  if (v.srcs === 0) vFree(v);
  return v;
}

/* ---------------------------- pause / resume ------------------------------- */

function suspend() {
  try {
    if (S.userPaused) return;
    S.userPaused = true;
    if (!S.ready) return;
    const now = S.ctx.currentTime, w = S.G.world.gain;
    w.cancelScheduledValues(now);
    w.setTargetAtTime(0, now, 0.03);
    for (const tr of M.tracks) tr.pause();
  } catch (e) { /* ignore */ }
}

function resume() {
  try {
    if (!S.userPaused) { resumeCtx(); return; }
    S.userPaused = false;
    if (!S.ready) return;
    resumeCtx();
    const now = S.ctx.currentTime, w = S.G.world.gain;
    w.cancelScheduledValues(now);
    w.setTargetAtTime(1, now, 0.06);
    for (const tr of M.tracks) tr.resume(now + 0.05);
    kickSeq();
  } catch (e) { /* ignore */ }
}

/* -------------------------------------------------------------------------- */
/* Offline rendering (verification / level balancing)                          */
/* -------------------------------------------------------------------------- */

function levelStats(buf) {
  const n = buf.length, sr = buf.sampleRate, chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const pw = new Float32Array(n);
  let peak = 0, lastLoud = 0, first = -1;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const d of chs) { const x = d[i]; const a = x < 0 ? -x : x; if (a > peak) peak = a; p += x * x; }
    p /= chs.length;
    pw[i] = p;
    if (p > 1e-6) { lastLoud = i; if (first < 0) first = i; }   // > -60 dBFS
  }
  const win = Math.max(1, Math.floor(sr * 0.05));
  let acc = 0, maxWin = 0, total = 0;
  for (let i = 0; i < n; i++) {
    acc += pw[i]; total += pw[i];
    if (i >= win) acc -= pw[i - win];
    if (i >= win - 1 && acc > maxWin) maxWin = acc;
  }
  const activeLen = first < 0 ? 1 : lastLoud - first + 1;
  // K-weighted (BS.1770, 48 kHz coefficients) loudness: max over 100 ms and 400 ms windows.
  const kw = new Float32Array(n);
  for (const d of chs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, w1 = 0, w2 = 0;
    for (let i = 0; i < n; i++) {
      const x = d[i];
      const y = 1.53512485958697 * x - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - 0.73248077421585 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const z = y - 2 * z1 + z2 + 1.99004745483398 * w1 - 0.99007225036621 * w2;
      z2 = z1; z1 = y; w2 = w1; w1 = z;
      kw[i] += z * z;
    }
  }
  const kwin = (sec) => {
    const w = Math.max(1, Math.floor(sr * sec));
    let a = 0, mx = 0;
    for (let i = 0; i < n; i++) { a += kw[i]; if (i >= w) a -= kw[i - w]; if (a > mx) mx = a; }
    return mx / w;
  };
  const lk = (e) => (e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -180);
  const k100 = lk(kwin(0.1)), k400 = lk(kwin(0.4));
  const r = (x) => Math.round(x * 10) / 10;
  return {
    peakDb: r(toDb(peak)),
    rmsDb: r(toDb(Math.sqrt(total / Math.max(1, activeLen)))),       // over the audible span
    loudDb: r(toDb(Math.sqrt(Math.max(0, maxWin) / win))),            // loudest 50 ms window
    activeSec: Math.round((activeLen / sr) * 100) / 100,
    k100: r(k100), k400: r(k400),
  };
}

function offlineCtx(seconds) {
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return null;
  return new OAC(2, Math.ceil(48000 * seconds), 48000);
}

/**
 * Render one SFX / loop / stinger (name prefixed 'stinger:') offline through the
 * full master chain. Resolves to level stats (plus the AudioBuffer as .buffer).
 */
async function renderOffline(name, seconds, opts = {}) {
  const isSting = typeof name === 'string' && name.startsWith('stinger:');
  const def = SFX[name], ldef = LOOPS[name], sfn = isSting ? STINGERS[name.slice(8)] : null;
  if (!def && !ldef && !sfn) return null;
  const secs = seconds || (def ? def.len : 3);
  const octx = offlineCtx(secs);
  if (!octx) return null;
  const G = buildGraph(octx);
  const t = 0.02;
  if (def) {
    let gain = def.g * finite(opts.volume, 1), pan = 0, cutoff = 0, wet = 1;
    if (opts.pos) {
      const saved = S.L; S.L = { x: 0, y: 0, z: 0, yaw: 0 };
      const sp = spatial(opts.pos); S.L = saved;
      gain *= sp.gain; pan = sp.pan; cutoff = sp.cutoff; wet = sp.wet;
    }
    const reps = Math.max(1, opts.repeat | 0), dt = finite(opts.interval, 0.1);
    for (let i = 0; i < reps; i++) spawn(G, name, def, t + i * dt, finite(opts.pitch, 1) * (1 + (i % 3 - 1) * 0.02), gain, pan, cutoff, wet);
  } else if (ldef) {
    makeLoop(G, name, ldef, opts, t);
  } else {
    spawnStinger(G, sfn, t, opts.key || 50);
  }
  const buf = await octx.startRendering();
  const st = levelStats(buf);
  Object.defineProperty(st, 'buffer', { value: buf, enumerable: false });
  return st;
}

/** Render `seconds` of a music track at a fixed intensity (all steps pre-scheduled). */
async function renderMusicOffline(track, intensity = 1, seconds = 20, opts = {}) {
  if (!STYLES[track]) return null;
  const octx = offlineCtx(seconds);
  if (!octx) return null;
  const G = buildGraph(octx);
  const saved = { ix: M.ix, intensity: M.intensity, od: M.overdrive, lh: M.lowHealth, gh: M.lastGameHeart };
  // Count nodes created per sequencer step (CPU budget check).
  let created = 0;
  for (const m of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource',
    'createStereoPanner', 'createWaveShaper', 'createConstantSource', 'createDelay']) {
    const orig = octx[m];
    if (typeof orig === 'function') octx[m] = function (...a) { created++; return orig.apply(this, a); };
  }
  let persistent = 0, maxStep = 0, steps = 0, perStep = 0;
  try {
    M.ix = M.intensity = clamp(intensity, 0, 1);
    M.overdrive = !!opts.overdrive; M.lowHealth = !!opts.lowHealth; M.lastGameHeart = -99;
    M.mixOverride = opts.solo ? opts.solo : null;
    if (opts.overdrive) {                      // same filter state applyFx() uses live
      G.fx.detune.value = 1200 * Math.log2(700 / G.fx.frequency.value);
      G.fx.Q.value = 1.8;
    }
    const tr = new Track(G, track, 0.05, 0, 0.2);
    persistent = created;
    while (tr.next < seconds - 0.05) {
      const c0 = created;
      tr.run(0, tr.next + tr.sd * 0.5);
      maxStep = Math.max(maxStep, created - c0);
      steps++;
    }
    perStep = (created - persistent) / Math.max(1, steps);
  } finally {
    M.ix = saved.ix; M.intensity = saved.intensity; M.overdrive = saved.od;
    M.lowHealth = saved.lh; M.lastGameHeart = saved.gh; M.mixOverride = null;
  }
  const buf = await octx.startRendering();
  const st = levelStats(buf);
  Object.assign(st, { persistentNodes: persistent, maxNodesPerStep: maxStep, avgNodesPerStep: Math.round(perStep * 10) / 10 });
  Object.defineProperty(st, 'buffer', { value: buf, enumerable: false });
  return st;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export const audio = {
  /** Create / resume the AudioContext. Call from a user gesture. Idempotent. */
  init() { return init(); },

  /** Attach to every touchend / click / keydown: creates on first call, then only resumes. */
  unlock() {
    try { if (!S.ctx) return init(); resumeCtx(); return S.ready; } catch (e) { return false; }
  },

  get ready() { return S.ready; },

  /** Pause-menu mute: world audio + music pause; UI sounds keep working. */
  suspend() { suspend(); },
  resume() { resume(); },

  setVolumes(v) {
    try {
      if (!v || typeof v !== 'object') return;
      for (const k of ['master', 'music', 'sfx']) {
        if (typeof v[k] === 'number' && isFinite(v[k])) S.vol[k] = clamp(v[k], 0, 1);
      }
      applyVolumes(false);
    } catch (e) { /* ignore */ }
  },

  setListener(pos, yaw) {
    try {
      if (pos) { S.L.x = finite(pos.x, S.L.x); S.L.y = finite(pos.y, S.L.y); S.L.z = finite(pos.z, S.L.z); }
      S.L.yaw = finite(yaw, S.L.yaw);
      if (!S.ready || !S.loops.length) return;
      const now = S.ctx.currentTime;
      if (now - S.lastLoopUpdate < 0.03) return;
      S.lastLoopUpdate = now;
      for (const L of S.loops) if (L.pos) L.apply(0.05);
    } catch (e) { /* ignore */ }
  },

  play(name, opts) { play(name, opts); },

  loop(name, opts) { return loop(name, opts); },

  music: {
    play(track) { musicPlay(track); },
    stop(fade = 1.5) { musicStop(fade); },
    setIntensity(x) {
      try { M.intensity = clamp(finite(x, M.intensity), 0, 1); if (M.tracks.length) kickSeq(); } catch (e) { /* ignore */ }
    },
    setOverdrive(on) { setOverdrive(on); },
    setLowHealth(on) { setLowHealth(on); },
    stinger(name) { stinger(name); },
    get bpm() {
      try {
        if (M.cur && !M.cur.dead) return M.cur.bpm;
        return M.want && STYLES[M.want] ? STYLES[M.want].bpm : 120;
      } catch (e) { return 120; }
    },
    get beatTime() {
      try {
        if (!S.ready) return 0;
        const now = S.ctx.currentTime;
        if (M.cur && !M.cur.dead && !M.cur.paused) return M.cur.nextGrid(now, 4);
        return Math.ceil(now / 0.5) * 0.5;
      } catch (e) { return 0; }
    },
  },

  /* ---- test / tooling hooks (not needed by the game) ---- */
  _renderOffline(name, seconds, opts) { return renderOffline(name, seconds, opts); },
  _renderMusicOffline(track, intensity, seconds, opts) { return renderMusicOffline(track, intensity, seconds, opts); },
  /** Current output level (dBFS RMS over ~40 ms) — handy for debug overlays. */
  _meter() {
    try {
      if (!S.ready) return -180;
      const G = S.G;
      if (!G.meter) {
        G.meter = S.ctx.createAnalyser();
        G.meter.fftSize = 2048;
        G.meterBuf = new Float32Array(G.meter.fftSize);
        G.limiter.connect(G.meter);
      }
      G.meter.getFloatTimeDomainData(G.meterBuf);
      let s = 0;
      for (const x of G.meterBuf) s += x * x;
      return Math.round(toDb(Math.sqrt(s / G.meterBuf.length)) * 10) / 10;
    } catch (e) { return -180; }
  },
  _names() {
    return {
      sfx: Object.keys(SFX), loops: Object.keys(LOOPS),
      stingers: Object.keys(STINGERS), tracks: Object.keys(STYLES),
    };
  },
  _stats() {
    return {
      ready: S.ready, state: S.ctx ? S.ctx.state : 'none',
      voices: S.voices.length, loops: S.loops.length, tracks: M.tracks.length,
      current: M.cur ? M.cur.name : null, intensity: M.ix, paused: S.userPaused,
    };
  },
};

export default audio;

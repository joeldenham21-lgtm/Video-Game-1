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
const MUSIC_TRIM = 0.125;      // music sits under SFX
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
  lim.threshold.value = -4; lim.knee.value = 3; lim.ratio.value = 12;
  lim.attack.value = 0.002; lim.release.value = 0.12;
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

  // Gentle high-shelf cut (-3 dB above ~8 kHz) tames harsh highs on SFX and UI.
  const shelf = (to) => {
    const f = ctx.createBiquadFilter();
    f.type = 'highshelf'; f.frequency.value = Math.min(8000, G.nyq); f.gain.value = -3;
    f.connect(to);
    return f;
  };
  G.sfxShelf = shelf(G.fx);
  G.sfx = gain(1, G.sfxShelf);
  G.duck = gain(1, G.fx);
  G.musicVol = gain(1, G.duck);
  G.musicIn = gain(MUSIC_TRIM, G.musicVol);
  G.ui = gain(1, shelf(G.master));
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
  if (o.dsrc) { o.dsrc.connect(osc.detune); (v.hooks || (v.hooks = [])).push([o.dsrc, osc.detune]); }
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
  vSrc(v, src, t, end + 0.02, o.off !== undefined ? o.off : Math.random() * 1.8);   // o.off: fixed timbre
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
  let node = sum;
  if (o.lp) {
    const lp = vNode(v, v.ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.frequency.value = Math.min(o.lp, v.G.nyq);
    sum.connect(lp); node = lp;
  }
  const { g, end } = envOut(v, o, node, t);
  vSrc(v, src, t, end + 0.05, Math.random() * 1.8);
  return { g, end };
}

/* -------------------------------------------------------------------------- */
/* Shared SFX building blocks                                                  */
/* -------------------------------------------------------------------------- */
// Sound design direction: shaped noise transients, low-mid body, mechanical
// clicks, modal (struck ceramic / metal) resonances and an air/room tail.
// Tonal oscillators are used sparingly — mostly for sub weight.

/** Transient crack: a very short band-limited noise burst. */
function crack(v, t, peak, hp = 2000, lp = 9000, d = 0.012, k = 'white') {
  N(v, { t, k, hp, lp, a: 0.0004, peak, d });
}

/** Low-mid body: short sine thump + lowpassed brown noise. */
function thump(v, t, peak, f0 = 120, f1 = 48, d = 0.12, nlp = 450) {
  T(v, { t, f: f0, f1, st: d * 0.6, a: 0.001, peak, d });
  N(v, { t, k: 'brown', lp: nlp, a: 0.002, peak: peak * 0.8, d: d * 0.9 });
}

/** Air / room tail: lowpassed pink noise that darkens as it decays. */
function airTail(v, t, peak, d = 0.4, lp = 2500, lp1 = 500) {
  N(v, { t, k: 'pink', lp, lp1, fT: d, a: 0.004, peak, d });
}

/** Mechanical click: a short resonant band of noise. */
function mech(v, t, peak, f = 2800, q = 4, d = 0.02) {
  N(v, { t, bp: f, q, a: 0.0005, peak, d });
}

/** Whoosh: band-passed pink noise sweeping f0 → f1 with a swell. */
function whoosh(v, t, peak, f0, f1, d, q = 1) {
  N(v, { t, k: 'pink', bp: f0, bp1: f1, fT: d, q, a: d * 0.45, peak, d: d * 0.55 });
}

/** Additive modal partials (struck ceramic / metal): sines with their own decays. */
function modes(v, t, f, ratios, decays, peak, amps) {
  for (let i = 0; i < ratios.length; i++) {
    T(v, { t, f: f * ratios[i], a: 0.0008, peak: peak * (amps ? amps[i] : 1 / (i + 1)), d: decays[i] });
  }
}
const CERAMIC = [1, 1.72, 2.63, 3.64];
const METAL = [1, 2.76, 5.4, 8.93];

/** Big explosion: low boom, noise blast, crunch, debris crackle, long air tail. */
function explosion(v, t, s = 1, peak = 1) {
  T(v, { t, f: 78 / s, f1: 28 / s, st: 0.7 * s, a: 0.002, peak: 1 * peak, d: 1.0 * s });       // sub boom
  N(v, { t, k: 'brown', lp: 260, a: 0.004, peak: 0.9 * peak, d: 1.4 * s });                   // rumble
  N(v, { t, k: 'wide', lp: 6000, lp1: 250, fT: 0.8 * s, peak: 0.95 * peak, d: 0.9 * s });     // blast
  N(v, { t, k: 'pink', bp: 700 / s, q: 0.7, peak: 0.6 * peak, d: 0.35 * s });                  // crunch
  N(v, { t: t + 0.03, k: 'grit', bp: 2400, q: 0.6, lp: 6000, a: 0.02, peak: 0.55 * peak, d: 1.2 * s }); // debris
  N(v, { t: t + 0.06, k: 'crackle', hp: 1500, lp: 7000, a: 0.05, peak: 0.5 * peak, d: 0.9 * s });
  airTail(v, t + 0.02, 0.3 * peak, 1.8 * s, 1400, 200);
}

/** Crystalline / ceramic break: shard crack, crunch, modal chips, glass rain. */
function glassBreak(v, t, s = 1, peak = 1, rain = 0.85) {
  crack(v, t, 0.45 * peak, 1500 / s, 8500, 0.03, 'wide');
  N(v, { t, k: 'pink', bp: 1200 / s, q: 0.7, peak: 0.5 * peak, d: 0.16 * s });                 // crunch
  RES(v, { t, freqs: [1500 / s, 2300 / s, 3100 / s, 4400 / s], q: 22, k: 'white', a: 0.0008, peak: 1.6 * peak, d: 0.22 * s });
  RES(v, { t: t + 0.03, freqs: [2800 / s, 3900 / s, 5200 / s, 6600 / s], q: 30, k: 'crackle', a: 0.03, peak: 4 * peak, d: rain * s, lp: 7500 });
}

/** Two-beat heartbeat thump (lub-dub). */
function heartbeat(v, t, peak = 1) {
  T(v, { t, f: 64, f1: 40, st: 0.12, a: 0.006, peak: 1 * peak, d: 0.17, fixed: true });
  T(v, { t, type: 'triangle', f: 90, f1: 55, st: 0.1, lp: 320, a: 0.006, peak: 0.35 * peak, d: 0.12, fixed: true });
  T(v, { t: t + 0.21, f: 56, f1: 38, st: 0.12, a: 0.006, peak: 0.75 * peak, d: 0.19, fixed: true });
  T(v, { t: t + 0.21, type: 'triangle', f: 80, f1: 50, st: 0.1, lp: 300, a: 0.006, peak: 0.25 * peak, d: 0.12, fixed: true });
}

/** Soft bell / pluck note (music only). */
function bell(v, t, f, peak, d = 0.5, ratio = 3.5, idx = 1.4, to) {
  FM(v, { t, f, ratio, idx, idx1: 0.05, a: 0.002, peak, d, to, lp: 3500 });
}

/** Soft brass-like swell: detuned saws through a lowpass that opens and closes. */
function brass(v, t, freqs, peak, a, hold, d, cut = 900, fixed = true, dsrc = null) {
  const lp = vNode(v, v.ctx.createBiquadFilter());
  const t0 = v.t + t;
  lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(220, t0);
  lp.frequency.exponentialRampToValueAtTime(cut, t0 + a);
  lp.frequency.exponentialRampToValueAtTime(260, t0 + a + hold + d);
  lp.connect(v.out);
  for (const f of freqs) {
    for (const det of [-9, 8]) T(v, { t, type: 'sawtooth', f, det, a, peak, hold, d, to: lp, fixed, dsrc });
  }
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

sfx('carbineShot', { g: 1.5, verb: 0.07, max: 5, prio: 2, gap: 0.03, len: 0.5 }, (v) => {
  // Fires 10.5/s: punchy, mostly noise, every shot slightly different.
  const r = rand(0.85, 1.18), l = rand(0.85, 1);
  crack(v, 0, 0.2 * l, 1700 * r, 7000, 0.008, 'pink');                                     // crack
  N(v, { k: 'pink', bp: 1400 * r, q: 0.9, a: 0.0008, peak: 0.65 * l, d: 0.05 });           // snap body
  T(v, { f: 125 * r, f1: 55, st: 0.05, a: 0.0015, peak: 0.28 * l, d: 0.06 });              // low thump
  N(v, { k: 'brown', lp: 500, a: 0.001, peak: 0.3 * l, d: 0.055 });
  airTail(v, 0.004, 0.12 * l, 0.13, 2600 * r, 700);                                         // air
  if (Math.random() < 0.6) mech(v, 0.012, 0.08, 3300 * r, 6, 0.012);                       // bolt tick
  T(v, { type: 'triangle', f: 780 * r, f1: 360, st: 0.03, peak: 0.03, d: 0.035 });         // faint energy
});

sfx('scatterShot', { g: 0.531, verb: 0.24, max: 3, prio: 2, len: 1.2 }, (v) => {
  crack(v, 0, 0.6, 1100, 8500, 0.022, 'wide');
  N(v, { k: 'wide', lp: 5200, lp1: 380, fT: 0.26, a: 0.001, peak: 1, d: 0.3 });           // blast
  T(v, { f: 92, f1: 38, st: 0.22, a: 0.001, peak: 1, d: 0.34 });                            // body
  N(v, { k: 'brown', lp: 320, a: 0.002, peak: 0.8, d: 0.36 });
  N(v, { k: 'pink', bp: 360, q: 0.8, peak: 0.6, d: 0.18 });                                // chest punch
  airTail(v, 0.01, 0.26, 0.75, 1500, 280);
  // mechanical rack: slide back, slam forward
  N(v, { t: 0.31, k: 'pink', bp: 1300, bp1: 2400, fT: 0.06, q: 1.6, a: 0.015, peak: 0.2, d: 0.05 });
  mech(v, 0.4, 0.45, 2300, 3, 0.035);
  N(v, { t: 0.4, k: 'brown', lp: 800, peak: 0.35, d: 0.05 });
  mech(v, 0.415, 0.2, 3600, 5, 0.02);
});

sfx('lanceShot', { g: 0.888, verb: 0.32, max: 2, prio: 2, len: 1.4 }, (v) => {
  crack(v, 0, 0.7, 2600, 9500, 0.02, 'wide');                                              // railgun crack
  N(v, { k: 'pink', bp: 2000, q: 0.7, peak: 0.7, d: 0.06 });
  thump(v, 0, 0.8, 85, 38, 0.26, 320);
  N(v, { t: 0.02, k: 'crackle', bp: 3000, q: 0.7, lp: 7000, a: 0.01, peak: 1.1, d: 0.6 }); // electric crackle
  N(v, { t: 0.01, k: 'crackle', rate: 1.5, hp: 4500, lp: 8000, peak: 0.45, d: 0.28 });
  FM(v, { f: 1700, f1: 280, st: 0.22, ratio: 1.5, idx: 1.2, idx1: 0.2, peak: 0.06, d: 0.24, lp: 3000 }); // a little tone
  airTail(v, 0.02, 0.2, 0.9, 2200, 350);
});

sfx('lanceCharge', { g: 1.88, verb: 0.15, max: 2, len: 0.5 }, (v) => {
  N(v, { k: 'pink', bp: 700, bp1: 3000, fT: 0.16, q: 3, rise: 0.15, peak: 0.4, cut: 0.03 }); // servo spin-up
  T(v, { f: 420, f1: 1100, st: 0.16, rise: 0.15, peak: 0.06, cut: 0.03 });
  N(v, { k: 'crackle', rate: 1.4, hp: 2500, lp: 7000, rise: 0.15, peak: 0.35, cut: 0.03 });
});

sfx('novaShot', { g: 0.411, verb: 0.2, max: 3, prio: 2, len: 0.8 }, (v) => {
  mech(v, 0, 0.3, 2000, 2, 0.015);
  T(v, { f: 150, f1: 52, st: 0.14, a: 0.001, peak: 1, d: 0.22 });                          // thoonk
  N(v, { k: 'brown', lp: 700, lp1: 220, fT: 0.2, a: 0.001, peak: 0.85, d: 0.22 });
  N(v, { t: 0.01, k: 'pink', bp: 480, q: 2.2, peak: 0.4, d: 0.12 });                        // tube resonance
  whoosh(v, 0.02, 0.18, 1400, 450, 0.32, 1.2);                                                // projectile air
});

sfx('novaExplode', { g: 0.389, verb: 0.48, max: 3, prio: 3, duck: true, len: 2.6 }, (v) => {
  explosion(v, 0, 1, 1);
});

sfx('reload', { g: 2.34, verb: 0.08, max: 2, len: 0.8 }, (v) => {
  mech(v, 0, 0.5, 2500, 4, 0.022);                                                           // latch
  N(v, { t: 0.004, k: 'brown', lp: 600, peak: 0.25, d: 0.04 });
  N(v, { t: 0.08, bp: 1100, bp1: 2300, fT: 0.14, q: 6, a: 0.02, peak: 0.12, d: 0.12 });     // servo
  whoosh(v, 0.1, 0.25, 700, 1300, 0.16, 1.4);                                                 // cell slides out
  N(v, { t: 0.2, k: 'brown', lp: 500, peak: 0.3, d: 0.05 });
  mech(v, 0.34, 0.45, 3200, 5, 0.018);                                                       // click
});

sfx('reloadDone', { g: 0.506, verb: 0.1, max: 2, len: 0.6 }, (v) => {
  thump(v, 0, 0.5, 120, 60, 0.08, 700);                                                      // cell slam
  mech(v, 0, 0.55, 2000, 2, 0.035);
  mech(v, 0.03, 0.2, 3600, 6, 0.012);
  N(v, { t: 0.05, bp: 1500, q: 9, a: 0.02, peak: 0.12, d: 0.15 });                           // charged servo
  T(v, { t: 0.05, f: 220, a: 0.02, peak: 0.05, d: 0.2 });                                    // soft energy hum
});

sfx('swap', { g: 1.59, verb: 0.08, max: 2, len: 0.5 }, (v) => {
  whoosh(v, 0, 0.35, 600, 1800, 0.12, 1.2);                                                   // cloth / arm
  mech(v, 0.07, 0.45, 2600, 3, 0.03);                                                        // clack
  N(v, { t: 0.07, k: 'brown', lp: 500, peak: 0.3, d: 0.05 });
});

sfx('dryFire', { g: 1.96, verb: 0.05, max: 2, gap: 0.05, len: 0.3 }, (v) => {
  mech(v, 0, 0.6, 3000, 4, 0.016);
  mech(v, 0.045, 0.3, 2200, 4, 0.012);
});

/* ---------------------------------- Player --------------------------------- */

sfx('melee', { g: 2.12, verb: 0.07, max: 3, len: 0.5 }, (v) => {
  whoosh(v, 0, 0.6, 350, 1600, 0.16, 1);
  N(v, { t: 0.02, bp: 900, q: 6, a: 0.03, peak: 0.08, d: 0.1 });                            // servo
});

sfx('meleeHit', { g: 0.462, verb: 0.12, max: 3, prio: 2, len: 0.7 }, (v) => {
  thump(v, 0, 1, 110, 45, 0.16, 500);
  N(v, { k: 'pink', bp: 900, q: 0.9, peak: 0.55, d: 0.08 });                                 // crunch
  crack(v, 0, 0.35, 1800, 7000, 0.015);
  RES(v, { freqs: [1900, 2700, 3400], q: 18, k: 'white', a: 0.0008, peak: 0.9, d: 0.14 });  // ceramic armour
});

sfx('deflect', { g: 0.832, verb: 0.28, max: 3, len: 1.2 }, (v) => {
  crack(v, 0, 0.4, 3000, 9000, 0.012);
  modes(v, 0, 1450, METAL, [0.55, 0.35, 0.22, 0.15], 0.14, [1, 0.6, 0.35, 0.2]);          // metallic ping
  N(v, { t: 0.04, bp: 2200, bp1: 4200, fT: 0.22, q: 1.4, rise: 0.22, peak: 0.22, cut: 0.03 }); // reversed swell
  N(v, { k: 'brown', lp: 400, peak: 0.25, d: 0.06 });
});

sfx('hit', { g: 1.97, verb: 0.02, max: 4, gap: 0.035, len: 0.25 }, (v) => {
  // Plays constantly: a soft, dull tick.
  N(v, { k: 'pink', bp: 1300 * rand(0.9, 1.1), q: 1.8, lp: 3200, a: 0.0006, peak: 0.6, d: 0.022 });
  T(v, { f: 540, a: 0.0008, peak: 0.07, d: 0.025 });
});

sfx('crit', { g: 1.19, verb: 0.06, max: 4, gap: 0.035, len: 0.35 }, (v) => {
  // Slightly brighter ceramic tick.
  N(v, { bp: 2400, q: 2.5, lp: 5500, a: 0.0006, peak: 0.45, d: 0.018 });
  RES(v, { freqs: [2600, 3700], q: 24, k: 'white', a: 0.0006, peak: 0.6, d: 0.07 });
  T(v, { f: 720, a: 0.0008, peak: 0.06, d: 0.03 });
});

sfx('kill', { g: 0.49, verb: 0.16, max: 4, prio: 2, gap: 0.03, len: 0.7 }, (v) => {
  // Muted porcelain crunch.
  thump(v, 0, 0.45, 120, 60, 0.08, 500);
  N(v, { k: 'pink', bp: 1100, q: 0.8, peak: 0.6, d: 0.06 });                                // crunch
  crack(v, 0, 0.3, 2400, 6000, 0.03);
  RES(v, { freqs: [1700, 2500, 3300, 4200], q: 16, k: 'white', a: 0.0008, peak: 1.2, d: 0.16, lp: 5000 });
  N(v, { t: 0.02, k: 'grit', bp: 2200, q: 0.7, lp: 5000, peak: 0.4, d: 0.22 });            // fragments
});

sfx('shatter', { g: 0.563, verb: 0.42, max: 3, prio: 3, duck: true, len: 1.7 }, (v) => {
  crack(v, 0, 0.6, 1400, 8500, 0.04, 'wide');
  thump(v, 0, 0.7, 100, 40, 0.35, 320);
  N(v, { k: 'pink', bp: 1100, q: 0.7, peak: 0.55, d: 0.2 });
  RES(v, { freqs: [1500, 2300, 3100, 4400, 5600], q: 20, k: 'white', a: 0.0008, peak: 1.5, d: 0.35 });
  RES(v, { t: 0.04, freqs: [2800, 3900, 5200, 6600], q: 30, k: 'crackle', a: 0.03, peak: 4.5, d: 0.9, lp: 7500 }); // glass rain
  T(v, { f: 130, f1: 34, st: 0.55, a: 0.004, peak: 0.7, d: 0.65 });                        // bass drop
  airTail(v, 0.02, 0.2, 1.0, 3000, 400);
});

sfx('footstep', { g: 0.481, verb: 0.03, max: 3, prio: 0, gap: 0.08, len: 0.3 }, (v) => {
  // Soft metallic deck step; every step picks a slightly different plate.
  const r = rand(0.82, 1.2);
  N(v, { k: 'brown', lp: 320 * r, a: 0.002, peak: 0.5, d: 0.05 });                          // heel
  T(v, { f: 78 * r, f1: 55, st: 0.04, a: 0.002, peak: 0.25, d: 0.05 });
  RES(v, { freqs: [410 * r, 1130 * r, 2350 * r], q: 12, k: 'pink', a: 0.001, peak: 0.45, d: 0.07 }); // deck plate
  N(v, { t: 0.006, k: 'pink', bp: 2600 * r, q: 0.8, peak: 0.08, d: 0.03 });                 // scuff
});

sfx('jump', { g: 1.15, verb: 0.04, max: 2, len: 0.4 }, (v) => {
  N(v, { k: 'pink', bp: 750, bp1: 420, fT: 0.1, q: 0.9, a: 0.01, peak: 0.45, d: 0.1 });    // air puff
  N(v, { bp: 3000, q: 0.6, lp: 6000, a: 0.005, peak: 0.08, d: 0.06 });                      // cloth
  N(v, { t: 0.01, bp: 1000, q: 8, a: 0.02, peak: 0.06, d: 0.08 });                           // servo
});

sfx('doubleJump', { g: 0.385, verb: 0.1, max: 2, len: 0.6 }, (v) => {
  N(v, { k: 'wide', lp: 3000, lp1: 700, fT: 0.25, a: 0.008, peak: 0.55, d: 0.26 });        // thruster burst
  N(v, { k: 'brown', lp: 420, a: 0.008, peak: 0.55, d: 0.24 });
  N(v, { k: 'crackle', hp: 1800, lp: 6000, a: 0.01, peak: 0.3, d: 0.16 });                  // sputter
});

sfx('land', { g: 0.346, verb: 0.07, max: 2, gap: 0.06, len: 0.5 }, (v) => {
  thump(v, 0, 0.9, 90, 42, 0.13, 420);
  RES(v, { freqs: [300, 780, 1650], q: 10, k: 'pink', a: 0.001, peak: 0.5, d: 0.1 });      // deck clank
  N(v, { t: 0.02, bp: 900, q: 5, a: 0.02, peak: 0.08, d: 0.1 });                             // servo absorb
});

sfx('dash', { g: 0.692, verb: 0.08, max: 2, len: 0.6 }, (v) => {
  whoosh(v, 0, 0.65, 500, 2500, 0.22, 1.1);
  N(v, { k: 'wide', hp: 2500, lp: 7000, a: 0.01, peak: 0.18, d: 0.2 });                    // thruster hiss
  N(v, { k: 'brown', lp: 260, a: 0.01, peak: 0.4, d: 0.2 });                                // rumble
});

sfx('jumpPad', { g: 0.468, verb: 0.22, max: 2, len: 0.9 }, (v) => {
  N(v, { k: 'wide', bp: 400, bp1: 2000, fT: 0.4, q: 0.8, a: 0.02, peak: 0.6, d: 0.42 });   // air blast
  N(v, { k: 'brown', lp: 350, a: 0.01, peak: 0.5, d: 0.3 });
  T(v, { f: 120, f1: 360, st: 0.4, a: 0.05, peak: 0.08, d: 0.35 });                         // soft rise
  thump(v, 0, 0.55, 110, 48, 0.14, 400);
});

sfx('playerHurt', { g: 0.556, verb: 0.1, max: 2, prio: 3, duck: true, gap: 0.06, len: 0.7 }, (v) => {
  T(v, { f: 95, f1: 42, st: 0.18, sh: 3, lp: 900, a: 0.001, peak: 0.6, d: 0.22 });         // distorted low hit
  N(v, { k: 'brown', lp: 600, a: 0.001, peak: 0.6, d: 0.2 });
  N(v, { k: 'crackle', bp: 2400, q: 0.7, lp: 6000, peak: 0.7, d: 0.28 });                   // static
  RES(v, { freqs: [600, 1450, 2300], q: 12, k: 'white', a: 0.0008, peak: 0.5, d: 0.12 });  // armour clank
});

sfx('shieldBreak', { g: 0.757, verb: 0.28, max: 2, prio: 3, len: 1.2 }, (v) => {
  glassBreak(v, 0, 0.9, 0.9, 0.5);
  N(v, { t: 0.02, k: 'crackle', hp: 2500, lp: 7000, rate: 1.3, peak: 0.55, d: 0.5 });      // electric fizz
  thump(v, 0, 0.35, 100, 50, 0.12, 400);
});

sfx('shieldRegen', { g: 1.16, verb: 0.25, max: 2, len: 1.0 }, (v) => {
  N(v, { k: 'pink', bp: 400, bp1: 2000, fT: 0.45, q: 2, rise: 0.45, peak: 0.28, cut: 0.08 }); // subtle charge
  T(v, { f: 300, f1: 600, st: 0.45, a: 0.3, peak: 0.05, d: 0.25 });
  N(v, { t: 0.45, bp: 3200, q: 2, lp: 6000, peak: 0.08, d: 0.06 });                          // settle
});

sfx('pickupHealth', { g: 0.359, verb: 0.18, max: 3, gap: 0.05, len: 0.7 }, (v) => {
  T(v, { type: 'triangle', f: 330, lp: 1300, a: 0.02, peak: 0.25, d: 0.3 });                 // warm, muted
  T(v, { t: 0.06, type: 'triangle', f: 495, lp: 1300, a: 0.02, peak: 0.2, d: 0.34 });
  N(v, { k: 'pink', bp: 1500, q: 1.2, a: 0.03, peak: 0.08, d: 0.15 });
});

sfx('pickupShield', { g: 0.821, verb: 0.2, max: 3, gap: 0.05, len: 0.7 }, (v) => {
  N(v, { bp: 3200, q: 4, lp: 6000, a: 0.04, peak: 0.25, d: 0.18 });                         // cool shimmer
  T(v, { f: 660, a: 0.02, peak: 0.07, d: 0.3 });
  RES(v, { freqs: [1800, 2700], q: 28, k: 'white', a: 0.01, peak: 0.5, d: 0.2 });
});

sfx('pickupOrb', { g: 1.12, verb: 0.12, max: 4, prio: 0, gap: 0.04, len: 0.3 }, (v) => {
  N(v, { bp: 3600 * rand(0.9, 1.15), q: 5, lp: 6000, a: 0.002, peak: 0.3, d: 0.04 });
  T(v, { f: 1250 * rand(0.95, 1.1), a: 0.002, peak: 0.05, d: 0.06 });
});

sfx('overdriveReady', { g: 0.575, verb: 0.2, max: 1, len: 1.0 }, (v) => {
  // Three soft rising pulses, muted.
  [220, 277, 330].forEach((f, i) => {
    T(v, { t: i * 0.11, type: 'sawtooth', f, lp: 700, a: 0.012, peak: 0.16, d: i === 2 ? 0.45 : 0.14 });
    T(v, { t: i * 0.11, f: f / 2, a: 0.01, peak: 0.25, d: 0.14 });
  });
  N(v, { k: 'pink', bp: 600, bp1: 2400, fT: 0.35, q: 1.5, rise: 0.33, peak: 0.12, cut: 0.1 });
});

sfx('overdriveStart', { g: 0.389, verb: 0.42, max: 1, prio: 3, len: 1.9 }, (v) => {
  T(v, { f: 70, f1: 28, st: 0.8, a: 0.003, peak: 1, d: 1.0 });                               // whoomp
  N(v, { k: 'brown', lp: 400, a: 0.003, peak: 0.8, d: 0.8 });
  N(v, { k: 'wide', lp: 3000, lp1: 200, fT: 0.4, peak: 0.5, d: 0.45 });
  N(v, { t: 0.06, k: 'pink', bp: 600, bp1: 3000, fT: 0.4, q: 1, rise: 0.4, peak: 0.3, cut: 0.05 }); // reversed swell
  N(v, { t: 0.1, k: 'pink', bp: 2500, bp1: 150, fT: 1.1, q: 1.6, a: 0.05, peak: 0.35, d: 1.1 });    // time-slow sweep down
});

sfx('overdriveEnd', { g: 0.776, verb: 0.28, max: 1, len: 1.0 }, (v) => {
  N(v, { k: 'pink', bp: 200, bp1: 3000, fT: 0.5, q: 1.2, rise: 0.5, peak: 0.45, cut: 0.05 }); // time resumes
  thump(v, 0.5, 0.4, 150, 70, 0.1, 500);
  crack(v, 0.5, 0.15, 3000, 8000, 0.012);
});

sfx('lowHealth', { g: 0.282, verb: 0.02, max: 1, gap: 0.3, len: 0.7 }, (v) => {
  heartbeat(v, 0, 1);
});

sfx('weaponUnlock', { g: 0.385, verb: 0.42, max: 1, prio: 2, len: 2.2 }, (v) => {
  brass(v, 0, [73.4, 110, 146.8, 220, 293.7, 370], 0.06, 0.06, 0.5, 1.1, 1600, false); // D major brass hit
  thump(v, 0, 0.6, 80, 36, 0.6, 250);
  N(v, { k: 'wide', lp: 4000, lp1: 300, fT: 0.4, peak: 0.35, d: 0.4 });
  airTail(v, 0.02, 0.2, 1.4, 2000, 300);
});

/* ---------------------------------- Enemies -------------------------------- */

/** Smooth amplitude flutter (sine / triangle LFO on a gain — never square: no clicks). */
function flutter(v, dest, base, depth, r0, r1, dur, type = 'sine') {
  const g = vNode(v, v.ctx.createGain());
  g.gain.value = base;
  g.connect(dest);
  const lfo = vNode(v, v.ctx.createOscillator());
  const amt = vNode(v, v.ctx.createGain());
  lfo.type = type;
  lfo.frequency.setValueAtTime(r0, v.t);
  if (r1 !== r0) lfo.frequency.exponentialRampToValueAtTime(r1, v.t + dur);
  amt.gain.value = depth;
  lfo.connect(amt); amt.connect(g.gain);
  vSrc(v, lfo, v.t, v.t + dur + 0.1);
  return g;
}

sfx('enemyWarpIn', { g: 0.313, verb: 0.35, max: 3, gap: 0.08, len: 1.0 }, (v) => {
  // Frequent: soft airy whoosh in, low thud on arrival.
  N(v, { k: 'pink', bp: 600, bp1: 2000, fT: 0.3, q: 1.1, rise: 0.3, peak: 0.4, cut: 0.06 });
  RES(v, { freqs: [2400, 3600], q: 20, k: 'white', rise: 0.3, peak: 0.35, cut: 0.06 });   // faint crystal shimmer
  T(v, { t: 0.3, f: 72, f1: 40, st: 0.15, a: 0.003, peak: 0.55, d: 0.2 });
  N(v, { t: 0.3, k: 'brown', lp: 220, a: 0.003, peak: 0.45, d: 0.2 });
});

sfx('miteScreech', { g: 1.09, verb: 0.14, max: 3, gap: 0.06, len: 0.5 }, (v) => {
  // Insect-like chitter: two resonant noise chirps.
  N(v, { bp: 2000, bp1: 3600, fT: 0.1, q: 8, lp: 6000, a: 0.01, peak: 0.6, d: 0.15 });
  N(v, { t: 0.08, bp: 3300, bp1: 1800, fT: 0.18, q: 8, lp: 6000, a: 0.01, peak: 0.5, d: 0.2 });
  T(v, { type: 'triangle', f: 1400, path: [[0.08, 2200], [0.25, 1300]], lp: 3000, a: 0.01, peak: 0.04, d: 0.24 });
});

sfx('miteExplode', { g: 0.543, verb: 0.22, max: 4, prio: 2, len: 0.8 }, (v) => {
  thump(v, 0, 0.6, 180, 60, 0.1, 600);
  N(v, { k: 'wide', lp: 3200, lp1: 500, fT: 0.16, peak: 0.6, d: 0.18 });
  N(v, { t: 0.02, k: 'crackle', bp: 2600, q: 0.7, lp: 6500, peak: 0.7, d: 0.3 });
  RES(v, { freqs: [1900, 2800, 3900], q: 18, k: 'white', a: 0.0008, peak: 0.8, d: 0.12 });
});

sfx('sentinelCharge', { g: 0.367, verb: 0.18, max: 3, len: 0.9 }, (v) => {
  T(v, { type: 'triangle', f: 110, f1: 220, st: 0.5, lp: 700, a: 0.4, peak: 0.3, d: 0.1 });  // low hum
  N(v, { k: 'pink', bp: 400, bp1: 1800, fT: 0.5, q: 4, rise: 0.5, peak: 0.4, cut: 0.06 });   // rising air
  N(v, { k: 'crackle', hp: 2000, lp: 6500, rise: 0.5, peak: 0.3, cut: 0.05 });
});

sfx('orbFire', { g: 0.331, verb: 0.2, max: 4, len: 0.6 }, (v) => {
  T(v, { f: 180, f1: 85, st: 0.22, a: 0.003, peak: 0.7, d: 0.25 });                          // bwoom
  N(v, { k: 'brown', lp: 800, a: 0.003, peak: 0.55, d: 0.24 });
  whoosh(v, 0, 0.3, 900, 400, 0.28, 1.5);
});

sfx('orbImpact', { g: 0.569, verb: 0.24, max: 4, len: 0.7 }, (v) => {
  N(v, { k: 'pink', bp: 1200, bp1: 300, fT: 0.3, q: 0.9, peak: 0.6, d: 0.32 });             // plasma splash
  thump(v, 0, 0.5, 120, 50, 0.18, 400);
  N(v, { t: 0.01, k: 'crackle', bp: 2500, q: 0.8, lp: 6500, peak: 0.6, d: 0.3 });
  N(v, { k: 'wide', hp: 3500, lp: 7500, a: 0.01, peak: 0.1, d: 0.35 });                       // sizzle
});

sfx('lancerCharge', { g: 0.507, verb: 0.22, max: 2, prio: 2, len: 1.8 }, (v) => {
  // Clear warning without a piercing whine: rising servo/air with a soft tonal core
  // and a smooth, accelerating pulse.
  const pulse = flutter(v, v.out, 0.72, 0.28, 4, 14, 1.45);
  N(v, { k: 'pink', bp: 420, bp1: 2800, fT: 1.4, q: 5, a: 1.3, peak: 0.55, hold: 0.05, d: 0.08, to: pulse });
  T(v, { type: 'triangle', f: 170, f1: 680, st: 1.4, lp: 1600, a: 1.25, peak: 0.28, hold: 0.1, d: 0.06, to: pulse });
  T(v, { f: 85, f1: 340, st: 1.4, a: 1.2, peak: 0.2, hold: 0.1, d: 0.06, to: pulse });
  N(v, { k: 'crackle', hp: 2200, lp: 6500, a: 1.3, peak: 0.25, hold: 0.05, d: 0.06 });
});

sfx('lancerFire', { g: 0.683, verb: 0.28, max: 3, prio: 2, len: 0.9 }, (v) => {
  crack(v, 0, 0.55, 2500, 9000, 0.028, 'wide');
  N(v, { k: 'pink', bp: 1800, q: 0.8, peak: 0.7, d: 0.07 });
  thump(v, 0, 0.6, 110, 45, 0.2, 400);
  N(v, { t: 0.02, k: 'crackle', bp: 3300, q: 0.8, lp: 7000, peak: 0.55, d: 0.35 });
  T(v, { type: 'triangle', f: 1400, f1: 300, st: 0.12, lp: 3000, peak: 0.05, d: 0.12 });
  airTail(v, 0.01, 0.15, 0.6, 2400, 400);
});

sfx('bruteRev', { g: 0.427, verb: 0.18, max: 2, len: 1.2 }, (v) => {
  const growl = flutter(v, v.out, 0.6, 0.35, 22, 30, 0.9, 'triangle');
  T(v, { type: 'sawtooth', f: 45, path: [[0.35, 90], [0.8, 58]], lp: 420, sh: 2, a: 0.05, peak: 0.5, hold: 0.4, d: 0.35, to: growl });
  N(v, { k: 'brown', lp: 350, lp1: 700, fT: 0.35, a: 0.08, peak: 0.6, hold: 0.3, d: 0.4, to: growl });
  N(v, { k: 'pink', bp: 500, q: 1.5, a: 0.1, peak: 0.2, hold: 0.25, d: 0.35 });
});

sfx('bruteCharge', { g: 0.452, verb: 0.18, max: 2, len: 1.4 }, (v) => {
  N(v, { k: 'brown', lp: 450, lp1: 1100, fT: 0.8, a: 0.1, peak: 0.8, hold: 0.4, d: 0.5 });
  const growl = flutter(v, v.out, 0.6, 0.35, 16, 16, 1.1, 'triangle');
  T(v, { type: 'sawtooth', f: 62, f1: 76, st: 0.9, lp: 480, sh: 2, a: 0.08, peak: 0.45, hold: 0.45, d: 0.45, to: growl });
  N(v, { k: 'pink', bp: 700, q: 0.8, a: 0.5, peak: 0.3, hold: 0.2, d: 0.3 });
});

sfx('bruteSlam', { g: 0.403, verb: 0.38, max: 2, prio: 3, duck: true, len: 1.8 }, (v) => {
  T(v, { f: 70, f1: 24, st: 0.6, a: 0.002, peak: 1, d: 0.8 });                               // sub boom
  N(v, { k: 'wide', lp: 3000, lp1: 200, fT: 0.5, peak: 0.85, d: 0.6 });
  N(v, { t: 0.03, k: 'grit', bp: 1500, q: 0.6, lp: 5000, a: 0.02, peak: 0.6, d: 0.8 });     // debris
  RES(v, { freqs: [180, 460, 1020], q: 8, k: 'white', a: 0.001, peak: 0.6, d: 0.3 });        // deck resonance
  crack(v, 0, 0.35, 1500, 7000, 0.03);
  airTail(v, 0.02, 0.25, 1.2, 1500, 200);
});

sfx('shockwave', { g: 0.978, verb: 0.32, max: 3, len: 1.1 }, (v) => {
  N(v, { k: 'pink', bp: 1800, bp1: 250, fT: 0.6, q: 1.1, a: 0.02, peak: 0.7, d: 0.65 });   // expanding whoosh
  N(v, { k: 'brown', lp: 300, a: 0.02, peak: 0.5, d: 0.5 });
  RES(v, { freqs: [220, 330, 470], q: 25, k: 'pink', a: 0.02, peak: 0.6, d: 0.6 });          // low ring
});

sfx('wardenShield', { g: 0.295, verb: 0.28, max: 2, len: 1.1 }, (v) => {
  T(v, { type: 'triangle', f: 180, f1: 260, st: 0.4, lp: 700, a: 0.3, peak: 0.25, d: 0.5 }); // hum-up
  T(v, { f: 90, f1: 130, st: 0.4, a: 0.3, peak: 0.25, d: 0.5 });
  N(v, { bp: 3000, q: 4, lp: 6000, rise: 0.4, peak: 0.14, cut: 0.2 });
  RES(v, { t: 0.3, freqs: [1400, 2100], q: 25, k: 'white', a: 0.01, peak: 0.4, d: 0.3 });
});

sfx('shieldHit', { g: 1.02, verb: 0.18, max: 4, gap: 0.04, len: 0.5 }, (v) => {
  RES(v, { freqs: [1300, 1950, 2900], q: 26, k: 'white', a: 0.0008, peak: 1, d: 0.16 });   // energy deflection
  N(v, { bp: 2500, q: 1.5, lp: 6000, peak: 0.3, d: 0.03 });
  T(v, { f: 200, f1: 120, st: 0.06, peak: 0.15, d: 0.07 });
});

sfx('enemyHurt', { g: 1.47, verb: 0.06, max: 4, gap: 0.035, len: 0.3 }, (v) => {
  const r = rand(0.88, 1.15);
  RES(v, { freqs: [2100 * r, 3200 * r], q: 18, k: 'white', a: 0.0008, peak: 0.7, d: 0.06 }); // ceramic chip
  N(v, { k: 'pink', bp: 1800 * r, q: 1, lp: 5000, peak: 0.3, d: 0.02 });
});

sfx('enemyDeath', { g: 0.589, verb: 0.28, max: 4, prio: 2, len: 1.0 }, (v) => {
  glassBreak(v, 0, 1, 0.8, 0.45);
  thump(v, 0, 0.45, 160, 55, 0.2, 500);
  // electrical death rattle (smooth LFO: no clicks)
  const rattle = flutter(v, v.out, 0.5, 0.45, 28, 10, 0.5, 'triangle');
  N(v, { t: 0.03, k: 'crackle', bp: 2400, q: 0.7, lp: 6500, peak: 0.7, d: 0.45, to: rattle });
  N(v, { t: 0.03, k: 'brown', lp: 500, peak: 0.25, d: 0.4, to: rattle });
});

sfx('enemyDeathBig', { g: 0.432, verb: 0.38, max: 3, prio: 3, len: 1.9 }, (v) => {
  glassBreak(v, 0, 1.5, 1, 0.9);
  explosion(v, 0.02, 0.8, 0.55);
  N(v, { t: 0.05, k: 'crackle', bp: 2200, q: 0.6, lp: 6500, peak: 0.6, d: 0.8 });
});

sfx('bossRoar', { g: 0.437, verb: 0.48, max: 1, prio: 3, duck: true, len: 3.0 }, (v) => {
  // Alien choir scream: dissonant saws → formant bank, vibrato, breath, sub.
  const bank = vNode(v, v.ctx.createGain());
  for (const [f, q, gn] of [[700, 6, 1], [1150, 8, 0.6], [2600, 10, 0.25]]) {
    const bp = vNode(v, v.ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f * 0.8, v.t);
    bp.frequency.linearRampToValueAtTime(f * 1.2, v.t + 0.8);
    bp.frequency.linearRampToValueAtTime(f * 0.9, v.t + 2.0);
    const g = vNode(v, v.ctx.createGain());
    g.gain.value = gn;
    bank.connect(bp); bp.connect(g); g.connect(v.out);
  }
  const vib = vNode(v, v.ctx.createOscillator());
  const vibAmt = vNode(v, v.ctx.createGain());
  vib.frequency.value = 6;
  vibAmt.gain.value = 30;
  vib.connect(vibAmt);
  vSrc(v, vib, v.t, v.t + 2.2);
  for (const f of [110, 116.5, 164.8, 233]) {
    const r = T(v, { type: 'sawtooth', f, path: [[0.35, f * 1.3], [2.0, f * 0.8]], a: 0.12, peak: 0.26, hold: 0.9, d: 0.9, to: bank });
    vibAmt.connect(r.osc.detune);
  }
  T(v, { f: 46, f1: 36, st: 1.8, a: 0.08, peak: 0.8, hold: 0.8, d: 1.0 });                  // sub
  N(v, { k: 'pink', bp: 1400, q: 0.8, a: 0.15, peak: 0.35, hold: 0.7, d: 0.9 });            // breath
  N(v, { k: 'brown', lp: 400, a: 0.1, peak: 0.4, hold: 0.8, d: 0.9 });                       // growl body
});

sfx('bossLaser', { g: 0.371, verb: 0.28, max: 2, prio: 3, len: 2.2 }, (v) => {
  const lp = vNode(v, v.ctx.createBiquadFilter());
  lp.type = 'lowpass'; lp.Q.value = 2;
  lp.frequency.value = 1200;
  lp.connect(v.out);
  const wob = vNode(v, v.ctx.createOscillator());
  const wobAmt = vNode(v, v.ctx.createGain());
  wob.frequency.value = 9;
  wobAmt.gain.value = 400;
  wob.connect(wobAmt); wobAmt.connect(lp.frequency);
  vSrc(v, wob, v.t, v.t + 1.7);
  T(v, { type: 'sawtooth', f: 90, f1: 110, st: 0.15, a: 0.08, peak: 0.3, hold: 1.1, d: 0.3, to: lp });
  T(v, { type: 'sawtooth', f: 90.8, f1: 110.8, st: 0.15, a: 0.08, peak: 0.3, hold: 1.1, d: 0.3, to: lp });
  N(v, { k: 'pink', bp: 2400, q: 1.2, lp: 6000, a: 0.08, peak: 0.35, hold: 1.1, d: 0.3 }); // beam sizzle
  N(v, { k: 'crackle', hp: 2000, lp: 7000, a: 0.08, peak: 0.4, hold: 1.1, d: 0.3 });
  T(v, { f: 55, a: 0.08, peak: 0.5, hold: 1.1, d: 0.3 });
  crack(v, 0, 0.5, 2000, 8000, 0.04, 'wide');
});

sfx('bossSpiral', { g: 0.403, verb: 0.28, max: 2, len: 1.0 }, (v) => {
  // One noise source and one sub oscillator, gated six times: a rapid volley.
  const src = vNode(v, v.ctx.createBufferSource());
  src.buffer = v.G.buf.pink; src.loop = true;
  const bp = vNode(v, v.ctx.createBiquadFilter());
  bp.type = 'bandpass'; bp.Q.value = 1.4;
  const g = vNode(v, v.ctx.createGain());
  g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(v.out);
  const osc = vNode(v, v.ctx.createOscillator());
  const og = vNode(v, v.ctx.createGain());
  og.gain.value = 0;
  osc.connect(og); og.connect(v.out);
  for (let i = 0; i < 6; i++) {
    const t = v.t + i * 0.06;
    bp.frequency.setValueAtTime(1600 * v.p * (1 + i * 0.05), t);
    bp.frequency.exponentialRampToValueAtTime(500 * v.p, t + 0.055);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.056);
    osc.frequency.setValueAtTime(140 * v.p, t);
    osc.frequency.exponentialRampToValueAtTime(70 * v.p, t + 0.05);
    og.gain.setValueAtTime(0.001, t);
    og.gain.linearRampToValueAtTime(0.4, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.01, t + 0.056);
  }
  vSrc(v, src, v.t, v.t + 0.42, Math.random());
  vSrc(v, osc, v.t, v.t + 0.42);
  thump(v, 0, 0.4, 120, 50, 0.3, 400);
});

sfx('bossPhase', { g: 0.367, verb: 0.52, max: 1, prio: 3, len: 3.2 }, (v) => {
  T(v, { f: 55, f1: 34, st: 1.2, a: 0.003, peak: 1, d: 1.5 });                              // deep hit
  N(v, { k: 'brown', lp: 400, peak: 0.6, d: 0.8 });
  RES(v, { freqs: [110, 173, 262, 390], q: 30, k: 'pink', a: 0.005, peak: 1.2, d: 2.0 });   // resonant body
  const bank = vNode(v, v.ctx.createGain());                                                 // choir swell
  for (const [f, q, gn] of [[650, 6, 1], [1080, 7, 0.55], [2650, 9, 0.25]]) {
    const bp = vNode(v, v.ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = vNode(v, v.ctx.createGain()); g.gain.value = gn;
    bank.connect(bp); bp.connect(g); g.connect(v.out);
  }
  for (const [f, d] of [[164.8, -7], [196, 6], [246.9, -4], [329.6, 8]]) {
    T(v, { t: 0.1, type: 'sawtooth', f, det: d, a: 1.1, peak: 0.28, hold: 0.4, d: 1.4, to: bank });
  }
  RES(v, { t: 0.3, freqs: [2637, 3951], q: 40, k: 'crackle', rate: 0.5, a: 0.8, peak: 1.5, d: 1.5, lp: 6000 });
});

sfx('bossDeath', { g: 0.275, verb: 0.52, max: 1, prio: 4, duck: true, len: 4.5 }, (v) => {
  explosion(v, 0, 0.7, 0.55);
  glassBreak(v, 0.02, 1.2, 0.6, 0.6);
  explosion(v, 0.55, 0.85, 0.7);
  explosion(v, 1.05, 0.9, 0.8);
  explosion(v, 1.6, 1.5, 1);                                                                  // final blast
  glassBreak(v, 1.62, 1.6, 1, 1.5);
  T(v, { t: 1.6, f: 55, f1: 20, st: 1.5, peak: 0.9, d: 2.2 });
  for (const f of [220, 261.6, 329.6]) {                                                      // dying choir
    T(v, { t: 0.2, type: 'sawtooth', f, f1: f * 0.5, st: 2.5, bp: 800, q: 3, a: 0.4, peak: 0.1, hold: 0.8, d: 1.8 });
  }
});

/* -------------------------------- World / UI ------------------------------- */

sfx('waveStart', { g: 0.309, verb: 0.38, max: 1, prio: 2, len: 2.4 }, (v) => {
  N(v, { k: 'pink', bp: 300, bp1: 2500, fT: 0.95, q: 1.1, rise: 0.95, peak: 0.4, cut: 0.04 }); // riser
  N(v, { k: 'brown', lp: 200, lp1: 500, fT: 0.95, rise: 0.95, peak: 0.4, cut: 0.05 });
  T(v, { t: 1.0, f: 80, f1: 34, st: 0.5, a: 0.002, peak: 0.95, d: 0.7 });                   // hit
  N(v, { t: 1.0, k: 'wide', lp: 4500, lp1: 300, fT: 0.4, peak: 0.55, d: 0.45 });
  brass(v, 1.0, [73.4, 110, 146.8], 0.1, 0.03, 0.2, 0.8, 800, false);                          // low brass stab
});

sfx('sectorClear', { g: 0.596, verb: 0.42, max: 1, prio: 2, len: 2.8 }, (v) => {
  brass(v, 0, [65.4, 130.8, 196, 261.6, 329.6], 0.05, 0.25, 0.1, 0.4, 1200, false);          // bVII
  brass(v, 0.5, [73.4, 146.8, 220, 293.7, 370], 0.06, 0.3, 0.6, 1.3, 1600, false);           // I (major)
  thump(v, 0.5, 0.4, 70, 36, 0.8, 220);
});

sfx('uiHover', { g: 2.35, verb: 0.01, max: 2, ui: true, prio: 0, gap: 0.03, len: 0.15 }, (v) => {
  N(v, { off: 0.31, k: 'pink', bp: 2800, q: 2, lp: 6000, a: 0.0006, peak: 0.3, d: 0.01 });
});

sfx('uiClick', { g: 1.62, verb: 0.02, max: 3, ui: true, gap: 0.03, len: 0.2 }, (v) => {
  N(v, { off: 0.73, k: 'pink', bp: 2200, q: 1.5, lp: 6000, a: 0.0006, peak: 0.45, d: 0.012 });
  T(v, { f: 700, a: 0.001, peak: 0.08, d: 0.02 });
});

sfx('uiConfirm', { g: 0.569, verb: 0.06, max: 2, ui: true, len: 0.5 }, (v) => {
  N(v, { off: 1.11, k: 'pink', bp: 2200, q: 1.5, lp: 6000, a: 0.0006, peak: 0.4, d: 0.012 });
  T(v, { t: 0.01, type: 'triangle', f: 523, lp: 1800, a: 0.004, peak: 0.12, d: 0.14 });
  T(v, { t: 0.05, type: 'triangle', f: 784, lp: 1800, a: 0.004, peak: 0.1, d: 0.18 });
});

sfx('uiBack', { g: 0.933, verb: 0.04, max: 2, ui: true, len: 0.3 }, (v) => {
  N(v, { off: 0.52, k: 'pink', bp: 1600, q: 1.5, lp: 5000, a: 0.0006, peak: 0.4, d: 0.015 });
  T(v, { f: 500, f1: 380, st: 0.08, a: 0.002, peak: 0.08, d: 0.08 });
});

sfx('augmentPick', { g: 0.639, verb: 0.38, max: 1, len: 1.4 }, (v) => {
  N(v, { bp: 3800, bp1: 5500, fT: 0.3, q: 3, lp: 7000, rise: 0.3, peak: 0.25, cut: 0.25 }); // shimmer
  T(v, { f: 300, f1: 600, st: 0.3, a: 0.25, peak: 0.1, d: 0.45 });
  N(v, { k: 'brown', lp: 300, rise: 0.3, peak: 0.3, cut: 0.3 });
  RES(v, { t: 0.3, freqs: [2600, 3900], q: 30, k: 'white', a: 0.002, peak: 0.6, d: 0.5 });  // glint
});

sfx('countdown', { g: 0.299, verb: 0.08, max: 2, len: 0.3 }, (v) => {
  T(v, { type: 'triangle', f: 660, lp: 1500, a: 0.004, peak: 0.25, hold: 0.06, d: 0.1 });
  N(v, { k: 'pink', bp: 2000, q: 1.5, peak: 0.2, d: 0.01 });
});

sfx('teleport', { g: 0.463, verb: 0.38, max: 1, len: 2.0 }, (v) => {
  N(v, { k: 'pink', bp: 200, bp1: 3000, fT: 1.1, q: 1.2, rise: 1.1, peak: 0.5, cut: 0.06 }); // warp rise
  N(v, { k: 'brown', lp: 200, lp1: 600, fT: 1.1, rise: 1.1, peak: 0.4, cut: 0.08 });
  T(v, { f: 80, f1: 320, st: 1.1, rise: 1.1, peak: 0.12, cut: 0.06 });
  thump(v, 1.1, 0.6, 120, 45, 0.25, 400);                                                     // arrival
  N(v, { t: 1.1, k: 'wide', lp: 5000, lp1: 500, fT: 0.3, peak: 0.4, d: 0.35 });
});

sfx('victory', { g: 0.543, verb: 0.48, max: 1, len: 3.5 }, (v) => {
  brass(v, 0, [87.3, 174.6, 261.6, 349.2], 0.05, 0.2, 0.2, 0.5, 1100, false);                // IV
  brass(v, 0.55, [98, 196, 293.7, 392], 0.05, 0.2, 0.2, 0.5, 1300, false);                   // V
  brass(v, 1.1, [65.4, 130.8, 196, 261.6, 329.6], 0.055, 0.3, 0.8, 1.6, 1700, false);        // I
  thump(v, 1.1, 0.45, 70, 34, 1.0, 220);
});

sfx('death', { g: 0.27, verb: 0.42, max: 1, prio: 3, len: 3.2 }, (v) => {
  brass(v, 0, [55, 82.4, 110], 0.1, 0.05, 0.3, 1.8, 600, false);
  T(v, { f: 55, f1: 27, st: 1.8, a: 0.003, peak: 0.8, hold: 0.3, d: 1.9 });
  N(v, { k: 'brown', lp: 300, a: 0.4, peak: 0.5, d: 1.5 });
  thump(v, 0, 0.6, 90, 35, 0.4, 300);
});

/* -------------------------------------------------------------------------- */
/* Loops                                                                        */
/* -------------------------------------------------------------------------- */
// build(L) creates persistent nodes feeding L.in and returns the detune params
// (cents) that setPitch() drives. meta.persistent loops are exempt from the
// inactivity watchdog; max = concurrent instances per name.

const LOOPS = Object.create(null);
function loopDef(name, meta, build) {
  LOOPS[name] = Object.assign({ g: 0.5, verb: 0.15, max: 1, persistent: false }, meta, { build });
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

loopDef('overdriveHum', { g: 0.0858, verb: 0.2, persistent: true }, (L) => {
  const trem = lGain(L, 0.6, L.in);
  lLfo(L, 1.8, 0.3, trem.gain);
  const lp = lFilt(L, 'lowpass', 200, 1.2, trem);
  const a = lOsc(L, 'sawtooth', 55, lp, -7), b = lOsc(L, 'sawtooth', 55, lp, 7);
  const sub = lOsc(L, 'sine', 55, lGain(L, 0.8, trem));
  lNoise(L, 'brown', lFilt(L, 'lowpass', 150, 0.7, lGain(L, 0.6, trem)));
  return [a.detune, b.detune, sub.detune, lp.detune];
});

loopDef('lanceIdle', { g: 0.0327, verb: 0.05 }, (L) => {
  const a = lOsc(L, 'sine', 120, lGain(L, 0.6, L.in));
  const hp = lFilt(L, 'bandpass', 3500, 1.2, lGain(L, 0.25, L.in));
  lNoise(L, 'crackle', hp);
  const bp = lFilt(L, 'bandpass', 900, 4, lGain(L, 0.3, L.in));
  lLfo(L, 0.6, 200, bp.detune);
  lNoise(L, 'pink', bp);
  return [a.detune, bp.detune];
});

loopDef('bossHum', { g: 0.0714, verb: 0.35, persistent: true }, (L) => {
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

loopDef('lancerBeam', { g: 0.0871, verb: 0.18, max: 2 }, (L) => {
  // Targeting hum: soft tonal core + servo-noise texture; everything tracks setPitch.
  const lp = lFilt(L, 'lowpass', 1100, 0.9, L.in);
  const a = lOsc(L, 'triangle', 220, lp);
  const b = lOsc(L, 'sine', 110, lGain(L, 0.7, L.in));
  const vib = lGain(L, 6, null);
  lOsc(L, 'sine', 5, vib);
  vib.connect(a.detune);
  const bp = lFilt(L, 'bandpass', 1500, 6, lGain(L, 0.9, L.in));
  lNoise(L, 'pink', bp);
  return [a.detune, b.detune, bp.detune, lp.detune];
});

loopDef('wind', { g: 0.0589, verb: 0.1, persistent: true }, (L) => {
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
// Restrained, cinematic score: evolving pads and drones, deep sub pulses, a
// muted bass ostinato, sparse processed percussion and low brass swells.
// Driving drums only appear near full intensity; melodic content is sparse.

const CHORD_Q = {
  m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], m9: [0, 3, 7, 14],
  add9: [0, 4, 7, 14], s4: [0, 5, 7], s2: [0, 2, 7], d: [0, 3, 6],
};
const chordEq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
const isMinor = (q) => q === 'm' || q === 'm7' || q === 'm9' || q === 'd';

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

// Accents for the bass ostinato (8ths / 16ths in a 3-3-2 grouping).
const PULSE_8 = [1, 0, 0.6, 0, 0.85, 0, 0.6, 0, 1, 0, 0.6, 0, 0.85, 0, 0.6, 0];
const PULSE_16 = [1, 0.45, 0.45, 0.85, 0.45, 0.45, 0.85, 0.45, 1, 0.45, 0.45, 0.85, 0.45, 0.45, 0.85, 0.45];
const PULSE_TAILS = [[0, 0, 0, 0], [0, 0, 12, 0], [0, 7, 0, 12], [12, 0, 10, 7]];
// Sparse processed ticks: per-step probability at full density.
const TICK_P = [0, 0, 0.25, 0, 0.6, 0, 0.3, 0.15, 0, 0.25, 0.7, 0, 0.35, 0, 0.5, 0.3];
// Taiko-like ensembles (boss / final): level per step.
const TAIKO = [
  [1, 0, 0, 0, 0, 0, 0.7, 0, 1, 0, 0, 0, 0.6, 0, 0.8, 0],
  [1, 0, 0, 0.6, 0, 0, 0.8, 0, 1, 0, 0.5, 0, 0.7, 0.5, 0.9, 0],
];
// Slow motifs: [bar within 4, step, tone index].
const MOTIFS = [
  [[0, 0, 2], [0, 8, 1], [1, 0, 0]],
  [[0, 0, 0], [0, 6, 1], [0, 12, 2], [2, 0, 1]],
  [[0, 4, 3], [1, 0, 2], [2, 8, 1]],
];
// Slow heroic lead for 'final' over Cm | Ab | Eb | Bb (2 bars each): [step, midi, steps].
const MEL_FINAL = [
  [[[0, 67, 16]], [[0, 70, 8], [8, 72, 8]], [[0, 72, 16]], [[0, 75, 12], [12, 72, 4]],
   [[0, 70, 16]], [[0, 67, 8], [8, 70, 8]], [[0, 74, 16]], [[0, 72, 8], [8, 70, 8]]],
  [[[0, 75, 16]], [[0, 74, 8], [8, 72, 8]], [[0, 72, 12], [12, 75, 4]], [[0, 80, 16]],
   [[0, 79, 16]], [[0, 77, 8], [8, 75, 8]], [[0, 77, 16]], [[0, 74, 8], [8, 70, 8]]],
];

const ss = smooth;
const STYLES = {
  menu: {
    bpm: 72, key: 57, kind: 'ambient', level: 1.75, bassLo: 33, padLo: 50, padN: 4, padA: 2.6, padRel: 3.5, padCut: 1500,
    progs: [
      [[0, 'm9'], [8, 'M7'], [3, 'add9'], [10, 's2']],
      [[0, 'm9'], [5, 'm7'], [8, 'M7'], [7, 's4']],
      [[8, 'M7'], [10, 'add9'], [0, 'm9'], [0, 'm9']],
    ],
    mix: { pad: 0.3, sub: 0.2, atmos: 0.45, motif: 0.16, choir: 0.35, bell: 0.07 },
  },
  combat: {
    bpm: 124, key: 50, kind: 'drive', bassLo: 36, padLo: 48, padN: 4, padA: 1.2, padRel: 2.0, padCut: 900,
    progs: [
      [[0, 'm9'], [0, 'm9'], [8, 'M7'], [8, 'M7'], [5, 'm'], [5, 'm'], [7, 's4'], [7, 'M']],
      [[0, 'm'], [0, 'm'], [10, 'M'], [10, 'M'], [8, 'M'], [8, 'M'], [7, 's4'], [7, 's4']],
      [[0, 'm9'], [0, 'm9'], [3, 'M'], [3, 'M'], [5, 'm'], [5, 'm'], [8, 'M'], [7, 'M']],
      [[8, 'M7'], [8, 'M7'], [5, 'm'], [5, 'm'], [0, 'm9'], [0, 'm9'], [7, 's4'], [7, 'M']],
    ],
    lv: (x) => ({ pulse: ss(0.22, 0.38, x), perc: ss(0.3, 0.5, x), motif: ss(0.45, 0.6, x), brass: ss(0.55, 0.75, x),
      choir: ss(0.6, 0.8, x), drums: ss(0.82, 0.95, x) }),
    mix: { pad: 0.3, sub: 0.3, atmos: 0.45, pulse: 0.3, perc: 0.8, motif: 0.15, brass: 0.5, choir: 0.7, drums: 0.7 },
  },
  boss: {
    bpm: 136, key: 52, kind: 'drive', heavy: true, bassLo: 40, padLo: 50, padN: 4, padA: 0.9, padRel: 1.6, padCut: 900,
    progs: [
      [[0, 'm'], [0, 'm'], [1, 'M'], [1, 'M'], [0, 'm'], [0, 'm'], [8, 'M'], [7, 'M']],
      [[0, 'm'], [0, 'm'], [8, 'M'], [8, 'M'], [5, 'm'], [5, 'm'], [1, 'M'], [7, 'M']],
      [[0, 'm'], [1, 'M'], [0, 'm'], [1, 'M'], [8, 'M'], [8, 'M'], [7, 's4'], [7, 'M']],
    ],
    lv: (x) => ({ pulse: ss(0.2, 0.35, x), perc: ss(0.25, 0.45, x), brass: ss(0.45, 0.65, x),
      choir: ss(0.35, 0.55, x), drums: ss(0.82, 0.95, x) }),
    mix: { pad: 0.28, sub: 0.32, atmos: 0.45, pulse: 0.3, perc: 0.55, brass: 0.5, choir: 0.7, drums: 0.55 },
  },
  final: {
    bpm: 128, key: 48, kind: 'drive', epic: true, bassLo: 36, padLo: 48, padN: 5, padA: 1.0, padRel: 2.0, padCut: 1000,
    progs: [
      [[0, 'm'], [0, 'm'], [8, 'M'], [8, 'M'], [3, 'M'], [3, 'M'], [10, 'M'], [10, 'M']],
      [[8, 'M'], [8, 'M'], [10, 'M'], [10, 'M'], [0, 'm'], [0, 'm'], [7, 'M'], [7, 'M']],
    ],
    order: [[0, 0], [0, 1], [1, -1]],       // [progression, melody] per 8-bar cycle
    lv: (x) => ({ pulse: ss(0.25, 0.4, x), perc: ss(0.3, 0.5, x), brass: ss(0.4, 0.6, x),
      choir: ss(0.45, 0.65, x), lead: ss(0.5, 0.7, x), drums: ss(0.82, 0.95, x) }),
    mix: { pad: 0.32, sub: 0.3, atmos: 0.45, pulse: 0.28, perc: 0.45, brass: 0.5, choir: 0.75, lead: 0.22, drums: 0.6 },
  },
  victory: {
    bpm: 72, key: 48, kind: 'ambient', major: true, level: 1.4, bassLo: 36, padLo: 52, padN: 5, padA: 1.4, padRel: 3.5,
    padCut: 1900,
    progs: [[[5, 'M7'], [7, 'M'], [9, 'm7'], [5, 'add9'], [7, 's4'], [0, 'add9']]],
    mix: { pad: 0.3, sub: 0.2, atmos: 0.4, motif: 0.12, choir: 0.4, bell: 0.08, brass: 0.4 },
  },
};

const OD_DETUNE = -70;   // cents: overdrive "tape slow" feel on music oscillators
const LAYERS = ['pad', 'sub', 'atmos', 'pulse', 'perc', 'motif', 'brass', 'choir', 'drums', 'lead', 'bell'];

/* -------------------------------------------------------------------------- */
/* Music state + heartbeat                                                     */
/* -------------------------------------------------------------------------- */

const M = {
  tracks: [], cur: null, want: null,
  intensity: 0, ix: 0, lastTick: 0,
  overdrive: false, lowHealth: false,
  heartNext: 0, lastGameHeart: -99,
  timer: null, mixOverride: null,
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
    this.melody = null; this.leadOn = false; this.motif = MOTIFS[0]; this.brassDue = 0;
    this.tail = PULSE_TAILS[0]; this.taiko = TAIKO[0]; this.rnd = new Float32Array(16);
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
      ['pad', 1, 0.55], ['sub', 1, 0], ['atmos', 0, 0.5], ['pulse', 1, 0.08], ['perc', 0, 0.45],
      ['motif', 0, 0.5], ['brass', 1, 0.4], ['choir', 1, 0.7], ['drums', 0, 0.12], ['lead', 0, 0.4], ['bell', 0, 0.8],
    ]) {
      const lg = this.gn(0, pumped ? this.pump : this.bus);
      if (send) lg.connect(this.gn(send, this.send));
      this.L[k] = lg;
    }
    // Dotted-8th feedback delay for motif / lead / bells / ticks.
    const dly = ctx.createDelay(1.5);
    dly.delayTime.value = this.sd * 3;
    const dlp = this.filt('lowpass', 2200, 0.7, null);
    const fb = this.gn(0.4, dly);
    dly.connect(dlp); dlp.connect(fb);
    dlp.connect(this.gn(0.5, [this.bus, this.send]));
    this.nodes.push(dly);
    this.L.motif.connect(this.gn(0.45, dly));
    this.L.lead.connect(this.gn(0.2, dly));
    this.L.bell.connect(this.gn(0.35, dly));
    this.L.perc.connect(this.gn(0.18, dly));
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
  lfo(rate, depth, param) {
    const g = this.gn(depth, null);
    g.connect(param);
    this.osc('sine', rate, g, 0, false);
  }

  /** Persistent instruments driven by automation (no per-note nodes). */
  build() {
    const { cfg, L } = this;
    // Sub: a low drone that swells on pulses.
    this.subVCA = this.gn(0, L.sub);
    this.subO = this.osc('sine', mtof(cfg.bassLo - 12), this.subVCA);
    // Pads: per-chord oscillators feed two panned sides → one slowly moving lowpass.
    this.padLP = this.filt('lowpass', cfg.padCut || 1000, 0.7, L.pad);
    this.lfo(0.045, 450, this.padLP.detune);
    if (this.G.hasPan) {
      this.panL = this.ctx.createStereoPanner(); this.panL.pan.value = -0.6;
      this.panR = this.ctx.createStereoPanner(); this.panR.pan.value = 0.6;
      this.panL.connect(this.padLP); this.panR.connect(this.padLP);
      this.nodes.push(this.panL, this.panR);
    } else {
      this.panL = this.panR = this.padLP;
    }
    // Atmosphere: two drifting bands of noise.
    const ns = this.ctx.createBufferSource();
    ns.buffer = this.G.buf.pink; ns.loop = true; ns.start(0, Math.random());
    this.nodes.push(ns); this.srcs.push(ns);
    for (const [f, q, g, rate, depth] of [[320, 0.8, 1, 0.037, 900], [1300, 1.3, 0.3, 0.061, 700]]) {
      const bp = this.filt('bandpass', f, q, this.gn(g, L.atmos));
      this.lfo(rate, depth, bp.detune);
      ns.connect(bp);
    }
    // Choir: formant bank ('ah') with shared vibrato.
    this.choirIn = this.gn(1, null);
    for (const [f, q, g] of [[680, 5, 1], [1120, 7, 0.5], [2650, 9, 0.2]]) {
      const bp = this.filt('bandpass', f, q, this.gn(g, L.choir));
      this.choirIn.connect(bp);
    }
    this.vib = this.gn(7, null);
    this.osc('sine', 4.8, this.vib, 0, false);
    // Motif pluck (soft, muted, through the delay).
    this.aVCA = this.gn(0, L.motif);
    this.aLP = this.filt('lowpass', 1200, 0.8, this.aVCA);
    this.aA = this.osc('triangle', 440, this.aLP);
    this.aB = this.osc('sine', 880, this.gn(0.4, this.aLP));
    if (cfg.kind === 'ambient') return;
    // Muted bass ostinato.
    this.bVCA = this.gn(0, L.pulse);
    let bIn = this.bVCA;
    if (cfg.heavy) {
      const post = this.filt('lowpass', 1400, 0.7, this.bVCA);
      const ws = this.ctx.createWaveShaper();
      ws.curve = driveCurve(this.G, 2.5);
      ws.connect(post); this.nodes.push(ws);
      bIn = ws;
    }
    this.bLP = this.filt('lowpass', 200, 2.5, bIn);
    this.bA = this.osc('sawtooth', 55, this.bLP, -8);
    this.bB = this.osc('sawtooth', 55, this.bLP, 8);
    this.bS = this.osc('sine', 27.5, this.gn(0.6, this.bLP));
    // Slow lead (final)
    if (cfg.epic) {
      this.lVCA = this.gn(0, L.lead);
      this.lLP = this.filt('lowpass', 1500, 0.7, this.lVCA);
      this.lA = this.osc('sawtooth', 440, this.lLP, -7);
      this.lB = this.osc('sawtooth', 440, this.lLP, 7);
      this.lC = this.osc('triangle', 220, this.gn(0.5, this.lLP));
      const lv = this.gn(10, null);
      this.osc('sine', 5, lv, 0, false);
      lv.connect(this.lA.detune); lv.connect(this.lB.detune);
    }
    // Percussion bands from one looping noise source (gated by automation).
    const wn = this.ctx.createBufferSource();
    wn.buffer = this.G.buf.white; wn.loop = true; wn.start();
    this.nodes.push(wn); this.srcs.push(wn);
    const band = (type, f, q, to) => { const g = this.gn(0, to); const fl = this.filt(type, f, q, g); wn.connect(fl); return g; };
    this.tickG = band('bandpass', 2600, 2.5, L.perc);
    this.shakG = band('bandpass', 6000, 0.9, L.perc);
    this.hatG = band('bandpass', 7500, 0.8, L.drums);
    this.snG = band('bandpass', 1800, 0.7, L.drums);
    this.clapG = band('bandpass', 1100, 1.3, L.drums);
    this.crashG = band('highpass', 4000, 0.5, L.drums);
  }

  /* --------------------------- instrument hits ---------------------------- */

  padChord(t, dur, notes) {
    const cfg = this.cfg, ctx = this.ctx;
    const v = voice(this.G, t, 1, null);
    v.hooks = [];
    const a = Math.min(cfg.padA, dur * 0.6), rel = cfg.padRel, peak = 1.6 / notes.length;
    const envL = vNode(v, ctx.createGain()), envR = vNode(v, ctx.createGain());
    envL.connect(this.panL); envR.connect(this.panR);
    for (const env of [envL, envR]) {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + a);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.exponentialRampToValueAtTime(peak * 0.001, t + dur + rel);
    }
    for (const m of notes) {
      for (const [env, det] of [[envL, -10], [envR, 10]]) {
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
    if (stab) adsr(env.gain, t, 0.03, peak * 1.2, 0.05, 0.4);
    else {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + Math.min(1.2, dur * 0.5));
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.exponentialRampToValueAtTime(peak * 0.001, t + dur + 1.4);
    }
    const end = stab ? t + 0.5 : t + dur + 1.45;
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

  /** Low brass-like swell on the chord root / fifth / octave (+ third when epic). */
  brassSwell(t, dur) {
    const v = voice(this.G, t, 1, this.L.brass);
    const r = this.root;
    const notes = [r, r + 7, r + 12];
    if (this.cfg.epic || this.cfg.major) notes.push(r + 12 + (isMinor(this.chordQ) ? 3 : 4));
    const a = Math.min(1.8, dur * 0.45), hold = dur * 0.25, d = 1.6, cut = this.cfg.epic ? 1100 : 850;
    const lp = vNode(v, this.ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.exponentialRampToValueAtTime(cut, t + a);
    lp.frequency.exponentialRampToValueAtTime(260, t + a + hold + d);
    const env = vNode(v, this.ctx.createGain());
    lp.connect(env); env.connect(v.out);
    adsr(env.gain, t, a, 0.66 / notes.length, hold, d);
    v.hooks = [];
    for (const m of notes) {
      for (const det of [-9, 8]) {
        const o = vNode(v, this.ctx.createOscillator());
        o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        if (this.dsrc) { this.dsrc.connect(o.detune); v.hooks.push([this.dsrc, o.detune]); }
        o.connect(lp);
        vSrc(v, o, t, t + a + hold + d + 0.05);
      }
    }
  }

  kick(t, peak) {
    const v = voice(this.G, t, 1, this.L.drums);
    T(v, { f: 300, path: [[0.012, 120], [0.1, 44], [0.4, 38]], a: 0.001, peak, hold: 0.02, d: this.cfg.heavy ? 0.5 : 0.4, fixed: true });
    const depth = 0.32 * (this.lv.drums || 0);   // gentle sidechain on pads / pulse / sub
    const g = this.pump.gain;
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.015);
    g.setTargetAtTime(1, t + 0.017, 0.09);
  }

  snare(t, lvl, clap = true) {
    const v = voice(this.G, t, 1, this.L.drums);
    T(v, { type: 'triangle', f: 190, f1: 140, st: 0.06, a: 0.001, peak: 0.45 * lvl, d: 0.14, fixed: true });
    const g = this.snG.gain;
    g.setValueAtTime(0.6 * lvl, t);
    g.setTargetAtTime(0, t + 0.003, 0.07);
    if (clap) {
      const c = this.clapG.gain;
      for (let i = 0; i < 3; i++) {
        c.setValueAtTime(lvl * 0.8 * (1 - i * 0.12), t + i * 0.011);
        c.setTargetAtTime(0.02, t + i * 0.011 + 0.001, 0.003);
      }
      c.setValueAtTime(lvl * 0.6, t + 0.033);
      c.setTargetAtTime(0, t + 0.034, 0.09);
    }
  }

  gate(g, t, lvl, tau) {
    g.gain.setValueAtTime(lvl, t);
    g.gain.setTargetAtTime(0, t + 0.001, tau);
  }

  /** Deep cinematic boom (downbeats). */
  boom(t, lvl) {
    const v = voice(this.G, t, 1, this.L.perc);
    T(v, { f: 62, f1: 38, st: 0.3, a: 0.003, peak: lvl, d: 0.9, fixed: true });
    N(v, { k: 'brown', lp: 220, a: 0.004, peak: lvl * 0.6, d: 0.6, fixed: true });
  }

  /** Low tom / taiko 'don': pitched body + skin slap + noise body. */
  drum(t, f, lvl, d = 0.5) {
    const v = voice(this.G, t, 1, this.L.perc);
    T(v, { f, f1: f * 0.6, st: 0.07, a: 0.001, peak: lvl, d, fixed: true });
    N(v, { k: 'brown', lp: 700, a: 0.001, peak: lvl * 0.5, d: d * 0.5, fixed: true });
    N(v, { k: 'pink', bp: 240, q: 1, a: 0.0008, peak: lvl * 0.4, d: 0.05, fixed: true });
  }

  subTo(t, m) {
    this.subO.frequency.setTargetAtTime(mtof(m), t, 0.05);
  }

  subPulse(t, lvl) {
    const g = this.subVCA.gain, base = 0.35;
    g.setTargetAtTime(base + (1 - base) * lvl, t, 0.015);
    g.setTargetAtTime(base, t + 0.07, 0.28);
  }

  pulseNote(t, m, acc, x, od) {
    const f = mtof(m), heavy = this.cfg.heavy;
    this.bA.frequency.setValueAtTime(f, t);
    this.bB.frequency.setValueAtTime(f, t);
    this.bS.frequency.setValueAtTime(f / 2, t);
    const base = heavy ? 150 : 110;
    const peak = base + (180 + 520 * x) * acc * (od ? 0.6 : 1);
    const lp = this.bLP.frequency;
    lp.setTargetAtTime(peak, t, 0.004);
    lp.setTargetAtTime(base, t + 0.012, 0.07);
    const gate = this.sd * 0.8;
    const g = this.bVCA.gain;
    g.setTargetAtTime(0.4 + 0.6 * acc, t, 0.003);
    g.setTargetAtTime(0.3 * acc, t + 0.02, 0.06);
    g.setTargetAtTime(0, t + gate, 0.015);
  }

  motifNote(t, m, vel, decay, cut = 1300) {
    this.aA.frequency.setValueAtTime(mtof(m), t);
    this.aB.frequency.setValueAtTime(mtof(m + 12), t);
    const g = this.aVCA.gain;
    g.setTargetAtTime(vel, t, 0.004);
    g.setTargetAtTime(0, t + 0.02, decay);
    const f = this.aLP.frequency;
    f.setTargetAtTime(cut, t, 0.003);
    f.setTargetAtTime(Math.max(400, cut * 0.35), t + 0.01, decay * 1.2);
  }

  leadNote(t, m, dur) {
    const f = mtof(m);
    for (const [o, k] of [[this.lA, 1], [this.lB, 1], [this.lC, 0.5]]) {
      if (this.leadOn) o.frequency.setTargetAtTime(f * k, t, 0.04);
      else o.frequency.setValueAtTime(f * k, t);
    }
    this.leadOn = true;
    const g = this.lVCA.gain;
    g.setTargetAtTime(1, t, 0.06);
    g.setTargetAtTime(0.75, t + 0.3, 0.5);
    g.setTargetAtTime(0, t + dur - 0.05, 0.12);
    const lp = this.lLP.frequency;
    lp.setTargetAtTime(1900, t, 0.08);
    lp.setTargetAtTime(1300, t + 0.3, 0.6);
  }

  bellNote(t, m, peak, d = 1.4) {
    const v = voice(this.G, t, 1, this.L.bell);
    bell(v, 0, mtof(m), peak, d, 3.5, 0.9);
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
    this.motif = this.cycle === 0 ? MOTIFS[0] : pick(MOTIFS);
    this.tail = this.cycle === 0 ? PULSE_TAILS[0] : pick(PULSE_TAILS);
    this.taiko = pick(TAIKO);
    for (let i = 0; i < 16; i++) this.rnd[i] = Math.random();   // this cycle's tick groove
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

  /** Length (in bars) of the chord starting at bar index cb of the progression. */
  chordLen(cb) {
    let len = 1;
    while (cb + len < this.prog.length && chordEq(this.prog[cb + len], this.prog[cb])) len++;
    return len;
  }

  /* ------------------------------ sequencing ------------------------------- */

  schedule(s, t) {
    if (this.cfg.kind === 'drive') this.stepDrive(s, t);
    else this.stepAmbient(s, t);
    if ((s & (this.cfg.kind === 'ambient' ? 3 : 7)) === 1 && wantHeart(t)) heartAt(this.G, t);   // off the downbeat step: spreads node creation
  }

  stepDrive(s, t) {
    const cfg = this.cfg, lv = this.lv, x = M.ix, od = M.overdrive;
    const st = s & 15, bar = s >> 4, cb = bar % 8, heavy = !!cfg.heavy, epic = !!cfg.epic;
    if (st === 0) {
      if (cb === 0) this.newCycle();
      const ch = this.prog[cb];
      if (cb === 0 || !chordEq(this.prog[cb - 1], ch)) {
        this.setChord(ch);
        const dur = this.chordLen(cb) * 16 * this.sd;
        this.padChord(t, dur, this.notes);
        if (lv.choir > 0.01) this.choirChord(t, dur, this.notes.slice(0, 3).map((n) => n + 12));
        this.subTo(t, this.root - 12);
        this.brassDue = lv.brass > 0.01 && (cb % 4 === 0 || heavy || epic) ? dur : 0;
      }
      if (cb === 0 && bar > 0 && lv.drums > 0.3) this.gate(this.crashG, t, 0.22, 0.6);
    }

    if (st === 2 && this.brassDue) { this.brassSwell(t, this.brassDue - 2 * this.sd); this.brassDue = 0; }

    // Deep sub pulse: once a bar when calm, every half-bar, then every beat.
    const subEvery = x < 0.3 ? 16 : x < 0.7 ? 8 : 4;
    if (st % subEvery === 0) this.subPulse(t, st === 0 ? 1 : 0.7);

    // Muted bass ostinato: 8ths, 16ths (3-3-2 accents) near full intensity.
    if (lv.pulse > 0.01) {
      const acc = x > 0.8 && !od ? PULSE_16[st] : PULSE_8[st];
      if (acc) {
        const tail = (cb & 1) && st >= 12 ? this.tail[st - 12] : 0;
        this.pulseNote(t, this.root + tail, acc, x, od);
      }
    }

    // Sparse processed percussion.
    if (lv.perc > 0.01) {
      const dens = smooth(0.3, 1, x);
      if (heavy || epic) {
        // Taiko-like ensemble: only the big hits when calm, the full pattern when intense.
        const lvl = this.taiko[st];
        if (lvl && (lvl >= 0.9 || dens > 0.35 + (1 - lvl) * 0.5)) this.drum(t, heavy ? 72 : 80, lvl, 0.55);
        if (cb === 7 && st >= 12 && x > 0.7) this.drum(t, 95 - (st - 12) * 6, 0.5 + (st - 12) * 0.12, 0.35);
        if ((st & 3) === 2 && dens > 0.45) this.gate(this.tickG, t, 0.25, 0.012);           // 'ka' rim
      } else {
        if (this.rnd[st] < TICK_P[st] * (0.3 + dens)) this.gate(this.tickG, t, (st & 3) === 2 ? 0.35 : 0.22, 0.01);
        if (x > 0.65 && !od) this.gate(this.shakG, t, (st & 1) ? 0.05 : 0.08, 0.02);
        if (st === 0 && !(cb & 1) && x > 0.4) this.boom(t, 0.8);
        if (cb === 7 && x > 0.6 && (st === 8 || st === 11 || st === 14)) this.drum(t, 110 - (st - 8) * 6, 0.6, 0.4);
      }
    }

    // Driving kit — only near full intensity.
    if (lv.drums > 0.01) {
      const k = (st & 3) === 0 ? 1 : heavy && st === 14 ? 0.6 : 0;
      if (k) this.kick(t, k);
      if (heavy ? st === 8 : st === 4 || st === 12) this.snare(t, 1);
      if (od) { if ((st & 7) === 4) this.gate(this.hatG, t, 0.12, 0.02); }
      else if ((st & 1) === 0) this.gate(this.hatG, t, (st & 3) === 2 ? 0.14 : 0.08, (st & 3) === 2 ? 0.05 : 0.015);
    }

    // Slow motif (combat): a few soft notes every 4 bars.
    if (lv.motif > 0.01 && this.motif && this.tones) {
      for (const [b, ns, ti] of this.motif) {
        if ((cb & 3) === b && ns === st) this.motifNote(t, this.tones[ti % this.tones.length], 0.9, 0.9);
      }
    }
    // Slow heroic lead (final)
    if (epic && lv.lead > 0.01 && this.melody) {
      for (const [ns, m, len] of this.melody[cb]) if (ns === st) this.leadNote(t, m, len * this.sd);
    }
    // Boss: choir stabs at the top end
    if (heavy && x > 0.85 && lv.choir > 0.01 && (bar & 1) && (st === 0 || st === 3 || st === 6) && this.notes) {
      this.choirChord(t, 0.3, this.notes.slice(0, 3).map((n) => n + 12), true);
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
          this.subTo(t, this.root - 12);
        }
      } else if (bar % chordBars === 0) {
        const pos = victory ? bar : (bar >> 1) % this.prog.length;
        if (!victory && pos === 0) this.newCycle();
        this.setChord(this.prog[pos]);
        const dur = chordBars * 16 * this.sd;
        this.padChord(t, dur, this.notes);
        if (victory ? bar >= 2 : this.cycle % 2 === 1) this.choirChord(t, dur, this.notes.slice(0, 3).map((n) => n + 12));
        if (victory && (bar === 0 || bar === this.prog.length - 1)) this.brassDue = dur * 1.5;
        this.subTo(t, this.root - 12);
      }
      this.subPulse(t, 0.6);
    }
    if (st === 2 && this.brassDue) { this.brassSwell(t, this.brassDue); this.brassDue = 0; }
    if (!this.tones) return;
    if (victory) {
      if (!sustain && (st & 7) === 0) this.bellNote(t, this.tones[(st >> 3) + (bar & 1) * 2] + 12, 0.6, 2.2);
      else if (sustain && st === 0 && (bar & 1) && Math.random() < 0.5) this.bellNote(t, pick(this.tones) + 12, 0.45, 2.6);
      return;
    }
    // Menu: sparse soft plucks drifting through the delay; an occasional high bell.
    if ((st & 3) === 0 && Math.random() < 0.3) this.motifNote(t, pick(this.tones), 0.7, 1.1, 1500);
    if (st === 8 && bar % 4 === 1) this.bellNote(t, pick(this.tones) + 12, 0.7, 2.6);
  }

  /** Layer levels from the (smoothed) intensity; ramps only when they change. */
  updateLayers(now, force) {
    const cfg = this.cfg, x = M.ix;
    const t = cfg.kind === 'ambient'
      ? { pad: 1, sub: 1, atmos: 1, motif: 1, bell: 1, choir: 1, brass: 1 }
      : Object.assign({ pad: 1, sub: 1, atmos: 1 }, cfg.lv(x));
    const solo = this.solo;
    for (const k of LAYERS) {
      this.lv[k] = t[k] || 0;
      const target = (solo && solo.indexOf(k) < 0 ? 0 : cfg.mix[k] || 0) * this.lv[k];
      if (force || Math.abs(target - (this.lvSet[k] !== undefined ? this.lvSet[k] : -1)) > 0.004) {
        const p = this.L[k].gain;
        p.cancelScheduledValues(now);
        p.setTargetAtTime(target, now, force ? 0.03 : 0.4);
        this.lvSet[k] = target;
      }
    }
    if (cfg.kind === 'drive') {
      const cut = (cfg.padCut || 900) * (M.overdrive ? 0.7 : 1) * (1 + 1.2 * x);
      if (force || Math.abs(cut - (this.cutSet || 0)) > 40) {
        this.padLP.frequency.cancelScheduledValues(now);
        this.padLP.frequency.setTargetAtTime(cut, now, force ? 0.03 : 0.6);
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

const triad = (r, q) => q === 'M' ? [r, r + 4, r + 7] : [r, r + 3, r + 7];
const hz = (arr) => arr.map(mtof);

const STINGERS = {
  waveStart(v, k) {
    brass(v, 0, hz([k - 24, k - 17, k - 12, k - 9]), 0.07, 0.04, 0.3, 1.2, 900);          // low brass hit
    T(v, { f: 70, f1: 34, st: 0.4, a: 0.002, peak: 0.7, d: 0.8, fixed: true });
    N(v, { k: 'brown', lp: 300, peak: 0.5, d: 0.6, fixed: true });
    N(v, { k: 'wide', lp: 3500, lp1: 300, fT: 0.3, peak: 0.25, d: 0.35, fixed: true });
  },
  sectorClear(v, k) {
    brass(v, 0, hz([k - 16, ...triad(k - 4, 'M')]), 0.05, 0.3, 0.1, 0.5, 1000);           // bVI
    brass(v, 0.45, hz([k - 14, ...triad(k - 2, 'M')]), 0.05, 0.3, 0.1, 0.5, 1100);        // bVII
    brass(v, 0.9, hz([k - 24, k - 12, ...triad(k, 'M')]), 0.055, 0.35, 0.8, 1.6, 1400);   // I (major)
    T(v, { t: 0.9, f: mtof(k - 24), a: 0.05, peak: 0.35, d: 1.6, fixed: true });
  },
  death(v, k) {
    [k - 5, k - 7, k - 9, k - 10, k - 12].forEach((m, i) => {
      T(v, { t: i * 0.42, type: 'sawtooth', f: mtof(m), lp: 700, a: 0.08, peak: 0.08, hold: 0.25, d: 0.7, fixed: true });
    });
    brass(v, 0, hz([k - 36, k - 24, k - 17]), 0.08, 0.5, 1.2, 1.8, 500);
    T(v, { f: 55, f1: 30, st: 0.8, a: 0.003, peak: 0.5, d: 1.2, fixed: true });
  },
  bossDefeated(v, k) {
    brass(v, 0, hz([k - 16, k - 4, k, k + 3]), 0.045, 0.25, 0.2, 0.5, 1100);             // bVI
    brass(v, 0.6, hz([k - 14, k - 2, k + 2, k + 5]), 0.045, 0.25, 0.2, 0.5, 1200);       // bVII
    brass(v, 1.2, hz([k - 24, k - 12, k - 5, k, k + 4]), 0.05, 0.3, 1.2, 2.0, 1600);    // I major
    T(v, { t: 1.2, f: 70, f1: 32, st: 0.8, a: 0.003, peak: 0.8, d: 1.4, fixed: true });
    N(v, { t: 1.2, k: 'brown', lp: 300, peak: 0.5, d: 1.0, fixed: true });
  },
  augment(v, k) {
    N(v, { bp: 3500, bp1: 5500, fT: 0.35, q: 3, lp: 7000, rise: 0.35, peak: 0.12, cut: 0.4, fixed: true });
    brass(v, 0.05, hz([k - 12, k - 5, k, k + 7]), 0.035, 0.35, 0.2, 0.9, 1400);
    RES(v, { t: 0.35, freqs: [mtof(k + 24), mtof(k + 31)], q: 40, k: 'white', a: 0.003, peak: 0.4, d: 0.8, fixed: true });
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
  userPaused: false, hiddenSuspended: false, visHooked: false, watchTimer: null,
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
    // handle so a caller can cut a long one-shot short (e.g. a charge-up whose owner died)
    return { stop() { if (!v.done && !v.stolen) steal(v); } };
  } catch (e) {
    /* never throw into game code */
  }
  return NO_VOICE;
}
const NO_VOICE = { stop() {} };

/* -------------------------------- loops ------------------------------------ */
// Loops can never get stuck: a non-persistent loop that receives no
// setPos / setPitch / setVolume for WATCHDOG_S seconds fades out by itself.

const WATCHDOG_S = 2.5;

/** Build a loop into graph G. Returns the loop record (with .handle). */
function makeLoop(G, name, def, opts, t) {
  const ctx = G.ctx;
  const L = {
    G, ctx, name, def, nodes: [], srcs: [], stopped: false,
    vol: clamp(finite(opts.volume, 1), 0, 4), pos: opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null,
    pan: clamp(finite(opts.pan, 0), -1, 1), last: null, t0: t, touched: t, cents: 0,
    persistent: opts.persistent !== undefined ? !!opts.persistent : !!def.persistent,
  };
  const now = () => Math.max(ctx.currentTime, L.t0);
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
    let gain = def.g * L.vol, pan = L.pan, cutoff = 20000, wet = 1;
    if (L.pos) { const sp = spatial(L.pos); gain *= sp.gain; pan = sp.pan; cutoff = sp.cutoff; wet = sp.wet; }
    const k = [gain, pan, cutoff, wet];
    if (L.last && Math.abs(k[0] - L.last[0]) < 0.002 && Math.abs(k[1] - L.last[1]) < 0.01 && Math.abs(k[2] - L.last[2]) < 50) return;
    L.last = k;
    const n = now();
    for (const [p, v] of [[L.out.gain, gain], [L.lp.frequency, Math.min(cutoff, G.nyq)], [L.send.gain, def.verb * wet]]) {
      p.cancelScheduledValues(n); p.setTargetAtTime(v, n, tau);
    }
    if (L.sp) { L.sp.pan.cancelScheduledValues(n); L.sp.pan.setTargetAtTime(pan, n, tau); }
  };
  const free = () => { for (const nd of L.nodes) { try { nd.disconnect(); } catch (e) { /* ignore */ } } L.nodes.length = 0; };
  L.stop = (fade) => {
    if (L.stopped) return;                       // idempotent
    L.stopped = true;
    const i = S.loops.indexOf(L);
    if (i >= 0) S.loops.splice(i, 1);
    const n = now(), f = Math.max(0.01, finite(fade, 0.1));
    L.out.gain.cancelScheduledValues(n);
    L.out.gain.setValueAtTime(L.out.gain.value, n);
    L.out.gain.linearRampToValueAtTime(0, n + f);
    for (const s of L.srcs) { try { s.stop(n + f + 0.03); } catch (e) { /* ignore */ } }
    if (L.srcs[0]) L.srcs[0].onended = free;
    setTimeout(free, (f + 0.5) * 1000 + (n - ctx.currentTime) * 1000);   // fallback
  };
  const touch = () => { L.touched = ctx.currentTime; };
  L.handle = {
    setVolume(v) { try { if (L.stopped) return; touch(); L.vol = clamp(finite(v, L.vol), 0, 4); L.apply(0.05); } catch (e) { /* ignore */ } },
    setPitch(p) {
      try {
        if (L.stopped) return;
        touch();
        const cents = 1200 * Math.log2(clamp(finite(p, 1), 0.1, 8));
        if (Math.abs(cents - L.cents) < 0.5) return;
        L.cents = cents;
        const n = now();
        for (const [param, base] of L.params) {       // smooth glide: no zipper noise
          param.cancelScheduledValues(n);
          param.setTargetAtTime(base + cents, n, 0.05);
        }
      } catch (e) { /* ignore */ }
    },
    setPos(pos) {
      try {
        if (L.stopped || !pos) return;
        touch();
        L.pos = { x: pos.x, y: pos.y, z: pos.z };
        L.apply(0.04);
      } catch (e) { /* ignore */ }
    },
    stop(fade = 0.1) { try { L.stop(fade); } catch (e) { /* ignore */ } },
  };
  L.out.gain.setValueAtTime(0, t);
  L.apply(0.06);
  return L;
}

function loopWatch() {
  S.watchTimer = null;
  if (!S.ready) return;
  try {
    const now = S.ctx.currentTime;
    const frozen = S.userPaused || S.ctx.state !== 'running';
    for (const L of S.loops.slice()) {
      if (L.persistent) continue;
      if (frozen) L.touched = now;               // the game is paused: don't time out
      else if (now - L.touched > WATCHDOG_S) L.stop(0.4);
    }
  } catch (e) { /* ignore */ }
  if (S.loops.some((l) => !l.persistent)) S.watchTimer = setTimeout(loopWatch, 250);
}

function loop(name, opts) {
  try {
    if (!S.ready) return DUMMY_LOOP;
    const def = LOOPS[name];
    if (!def) { warnOnce(String(name)); return DUMMY_LOOP; }
    opts = opts || {};
    const persistent = opts.persistent !== undefined ? !!opts.persistent : !!def.persistent;
    const max = persistent ? Math.max(def.max, 3) : def.max;
    const same = S.loops.filter((l) => l.name === name);
    for (let i = 0; i <= same.length - max; i++) same[i].stop(0.08);     // steal the oldest
    if (S.loops.length >= MAX_LOOPS) S.loops[0].stop(0.08);
    const L = makeLoop(S.G, name, def, opts, S.ctx.currentTime);
    S.loops.push(L);
    if (!L.persistent && !S.watchTimer) S.watchTimer = setTimeout(loopWatch, 250);
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

const STING_GAIN = { waveStart: 0.42, sectorClear: 0.74, death: 0.58, bossDefeated: 0.34, augment: 1.18 };

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

const WARM = 0.6;

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
  // The limiter needs a moment to settle after the graph is built, so sounds
  // start at WARM seconds (live contexts are always warmed up).
  const secs = (seconds || (def ? def.len : 3)) + WARM;
  const octx = offlineCtx(secs);
  if (!octx) return null;
  const G = buildGraph(octx);
  const t = WARM + finite(opts.delay, 0);
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
    const L = makeLoop(G, name, ldef, opts, t);
    if (opts.pitchRamp) {                         // e.g. lancerBeam 0.8 → 1.6 like the game does
      const [p0, p1, dur] = opts.pitchRamp;
      for (const [param, base] of L.params) {
        param.setValueAtTime(base + 1200 * Math.log2(p0), t);
        param.linearRampToValueAtTime(base + 1200 * Math.log2(p1), t + dur);
      }
    }
    if (opts.stopNow) L.stop(0.05);
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
  const octx = offlineCtx(seconds + WARM);
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
    const tr = new Track(G, track, WARM, WARM, 0.2);
    persistent = created;
    while (tr.next < seconds + WARM - 0.05) {
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

  play(name, opts) { return play(name, opts); },

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

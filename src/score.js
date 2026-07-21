// ============================================================================
// ELDERFALL — score.js — THE ORCHESTRAL SCORE
// ----------------------------------------------------------------------------
// A real, composed, orchestrated score — not generative noodling. Every cue is
// written as note data (bar/beat/midi/dur/vel) and performed by a synthesized
// orchestra (string sections, horns, choir, flute, Karplus-Strong harp/lute,
// timpani/taiko/snare, anvils, sub) rendered ONCE through a printed hall
// reverb in an OfflineAudioContext at load time. Runtime cost is then just a
// handful of AudioBufferSourceNodes crossfading on game state.
//
// Cues:
//   theme      — "The Elderfall Theme"  (epilogue / victory)   ~95 s
//   explore    — "Emberhollow"          (day exploration, 6/8)  ~67 s
//   night      — "The Vale at Night"    (inverted theme)        ~64 s
//   battleBase — "Steel and Ash" base stem (taiko 3+3+2)        ~41 s loop
//   battleBrass— battle intensity-2 brass stem (same length)    ~41 s loop
//   dread      — "The Deep Dark"        (Undergloom / crypt)    ~48 s loop
//   boss       — "Drakespire"           (theme augmented)       ~58 s loop
//   dawn       — "The Morning After"    (stinger)               ~23 s
//
// Runtime: state machine over g (combatState, bossBar, dayFrac, crypt
// proximity, flags) → crossfades; exploration cues breathe with 20–45 s of
// silence between repetitions; music ducks -6 dB under spoken dialogue.
// audio.js keeps SFX/ambience; g.flags.scoreActive tells its legacy music to
// stand down. This module owns no scene objects and allocates nothing per
// frame (logic polls at 4 Hz).
// ============================================================================
import { makeRng, clamp, POI, dist2d } from './core.js';

const SR = 44100;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function createScore(g) {
  const hasAC = typeof window !== 'undefined' &&
    (window.AudioContext || window.webkitAudioContext) &&
    typeof OfflineAudioContext !== 'undefined';

  // Tell the acoustics layer the composed score owns music from here on.
  if (hasAC) g.flags.scoreActive = true;

  const _debug = {
    currentCue: 'none', rendered: [], stats: {}, pending: null,
    ctxState: 'none', duck: 1, aggro: 0, brass: 0, want: 'none', errors: [],
  };
  if (!hasAC) return { update() {}, _debug };

  // ==========================================================================
  // RUNTIME CONTEXT — master bus: duck → gentle glue compressor → air shelf
  // ==========================================================================
  let ctx = null, duck = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    duck = ctx.createGain(); duck.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 2.5;
    comp.attack.value = 0.012; comp.release.value = 0.3;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf'; air.frequency.value = 7500; air.gain.value = 2.5;
    const master = ctx.createGain(); master.gain.value = 0.5;
    duck.connect(comp); comp.connect(air); air.connect(master); master.connect(ctx.destination);
  } catch (e) { _debug.errors.push('ctx: ' + e.message); return { update() {}, _debug }; }

  // ==========================================================================
  // PRINTED HALL — 2.2 s exponential-decay stereo noise IR with a darkening
  // tilt (one-pole lowpass whose coefficient closes over time) and a sparse
  // early-reflection cluster. Computed once; instantiated per offline render.
  // ==========================================================================
  const IR_LEN = Math.floor(2.2 * SR);
  const irData = [null, null];
  {
    const rng = makeRng(strSeed('elderfall-hall'));
    for (let ch = 0; ch < 2; ch++) {
      const d = new Float32Array(IR_LEN);
      let y = 0;
      for (let i = 0; i < IR_LEN; i++) {
        const t = i / SR;
        const envl = Math.exp(-3.1 * t / 2.2) * (1 - Math.exp(-t * 250));
        const a = 0.62 - 0.5 * (i / IR_LEN);           // closing lowpass tilt
        y += a * ((rng() * 2 - 1) - y);
        d[i] = y * envl;
      }
      // early reflections: a few discrete taps in the first 90 ms
      for (let k = 0; k < 7; k++) {
        const at = Math.floor((0.008 + rng() * 0.082) * SR);
        d[at] += (rng() * 2 - 1) * 0.28 * (1 - k / 8);
      }
      irData[ch] = d;
    }
  }
  function makeIR(octx) {
    const b = octx.createBuffer(2, IR_LEN, SR);
    b.getChannelData(0).set(irData[0]);
    b.getChannelData(1).set(irData[1]);
    return b;
  }

  // ==========================================================================
  // OFFLINE RENDER KIT — dry/wet buses, shared noise buffer, seeded rng
  // ==========================================================================
  function makeKit(octx, seed) {
    const rng = makeRng(strSeed(seed));
    const masterO = octx.createGain(); masterO.gain.value = 1; masterO.connect(octx.destination);
    const conv = octx.createConvolver(); conv.buffer = makeIR(octx);
    const wetSum = octx.createGain(); wetSum.gain.value = 0.9;
    conv.connect(wetSum); wetSum.connect(masterO);
    const dry = octx.createGain(); dry.gain.value = 1; dry.connect(masterO);
    const wet = octx.createGain(); wet.gain.value = 1; wet.connect(conv);
    const nb = octx.createBuffer(1, SR * 2, SR);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rng() * 2 - 1;
    return { ctx: octx, dry, wet, noise: nb, rng };
  }
  function out(K, node, dryLvl, wetLvl) {
    if (dryLvl > 0) { const gd = K.ctx.createGain(); gd.gain.value = dryLvl; node.connect(gd); gd.connect(K.dry); }
    if (wetLvl > 0) { const gw = K.ctx.createGain(); gw.gain.value = wetLvl; node.connect(gw); gw.connect(K.wet); }
  }
  function noiseSrc(K, t, dur) {
    const s = K.ctx.createBufferSource();
    s.buffer = K.noise; s.loop = true;
    s.start(Math.max(0, t), K.rng() * 1.5);
    s.stop(t + dur);
    return s;
  }

  // ==========================================================================
  // THE ORCHESTRA
  // ==========================================================================

  // ---- STRINGS: 5-voice detuned saw section, bow-swell envelope, delayed
  // vibrato, per-voice onset jitter, bow-noise transient, optional tremolo.
  function stringsNote(K, t, f, dur, vel, o) {
    o = o || {};
    const C = K.ctx;
    const nV = o.voices != null ? o.voices : 5;
    const atk = Math.min(o.atk != null ? o.atk : 0.25, Math.max(0.03, dur * 0.5));
    const rel = o.rel != null ? o.rel : 0.4;
    const tPeak = t + atk, tEnd = t + Math.max(dur, atk + 0.05);

    const lp = C.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.value = Math.min(o.bright != null ? o.bright : 3200, 11000);

    let head = lp;
    if (o.trem) { // tremolo: amp wobble ~8.4 Hz on top of a 0.62 floor
      const tr = C.createGain(); tr.gain.value = 0.62;
      const tl = C.createOscillator(); tl.frequency.value = 7.8 + K.rng() * 1.2;
      const ta = C.createGain(); ta.gain.value = 0.38;
      tl.connect(ta); ta.connect(tr.gain); tl.start(t); tl.stop(tEnd + rel);
      lp.connect(tr); head = tr;
    }
    const amp = C.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, tPeak);
    amp.gain.linearRampToValueAtTime(vel * 0.88, tEnd);
    amp.gain.linearRampToValueAtTime(0, tEnd + rel);
    head.connect(amp);
    out(K, amp, 0.72, o.send != null ? o.send : 0.5);

    // shared vibrato, deepening after onset
    const lfo = C.createOscillator(); lfo.frequency.value = 4.5 + K.rng() * 1.1;
    const lfoG = C.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(o.vib != null ? o.vib : 5.5, t + 1.1);
    lfo.connect(lfoG); lfo.start(t); lfo.stop(tEnd + rel + 0.1);

    for (let i = 0; i < nV; i++) {
      const osc = C.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.value = f;
      const spread = nV > 1 ? -8 + (16 * i) / (nV - 1) : 0;
      osc.detune.value = spread + (K.rng() * 4 - 2);
      lfoG.connect(osc.detune);
      const st = Math.max(0, t + (K.rng() * 0.05 - 0.025)); // ±25 ms ensemble
      osc.connect(lp); osc.start(st); osc.stop(tEnd + rel + 0.1);
    }
    if (o.bow !== false && vel > 0.03) { // bow-noise transient
      const ns = noiseSrc(K, t, 0.1);
      const bp = C.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = Math.min(f * 2.2, 6500); bp.Q.value = 1.1;
      const ng = C.createGain();
      ng.gain.setValueAtTime(vel * 0.12, t);
      ng.gain.linearRampToValueAtTime(0, t + 0.09);
      ns.connect(bp); bp.connect(ng);
      out(K, ng, 0.4, 0.25);
    }
  }
  // solo fiddle = single-voice strings, wide vibrato, brighter
  function fiddleNote(K, t, f, dur, vel, o) {
    stringsNote(K, t, f, dur, vel, Object.assign({
      voices: 2, vib: 13, bright: 3900, atk: 0.11, rel: 0.35, send: 0.55,
    }, o));
  }

  // ---- HORNS: saw pair → tanh saturation → parallel formant bandpasses,
  // slight pitch scoop into every note. Noble and warm; o.dark = trombones.
  const tanhCurve = (() => {
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5 - 1) * 2.4; c[i] = Math.tanh(x); }
    return c;
  })();
  function hornNote(K, t, f, dur, vel, o) {
    o = o || {};
    const C = K.ctx;
    const atk = Math.min(o.atk != null ? o.atk : 0.08, dur * 0.5);
    const rel = o.rel != null ? o.rel : 0.22;
    const tEnd = t + Math.max(dur, atk + 0.03);
    const fm = o.dark ? 0.62 : 1;

    const mix = C.createGain(); mix.gain.value = 0.5;
    const sh = C.createWaveShaper(); sh.curve = tanhCurve;
    mix.connect(sh);
    const sum = C.createGain(); sum.gain.value = 1;
    const F1 = C.createBiquadFilter(); F1.type = 'bandpass'; F1.frequency.value = 500 * fm; F1.Q.value = 2.6;
    const F2 = C.createBiquadFilter(); F2.type = 'bandpass'; F2.frequency.value = 1500 * fm; F2.Q.value = 3;
    const g1 = C.createGain(); g1.gain.value = 1.0;
    const g2 = C.createGain(); g2.gain.value = 0.42;
    sh.connect(F1); F1.connect(g1); g1.connect(sum);
    sh.connect(F2); F2.connect(g2); g2.connect(sum);
    const body = C.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 900 * fm; body.Q.value = 0.4;
    const g3 = C.createGain(); g3.gain.value = 0.5;
    sh.connect(body); body.connect(g3); g3.connect(sum);

    const amp = C.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + atk);
    amp.gain.linearRampToValueAtTime(vel * 0.85, tEnd);
    amp.gain.linearRampToValueAtTime(0, tEnd + rel);
    sum.connect(amp);
    out(K, amp, 0.7, o.send != null ? o.send : 0.45);

    for (let i = 0; i < 2; i++) {
      const osc = C.createOscillator(); osc.type = 'sawtooth';
      // scoop into the note
      osc.frequency.setValueAtTime(f * 0.962, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.09);
      osc.detune.value = i ? 5 : -5;
      const st = Math.max(0, t + (K.rng() * 0.02 - 0.01));
      osc.connect(mix); osc.start(st); osc.stop(tEnd + rel + 0.1);
    }
  }
  function hornStab(K, t, midi, dur, vel, o) { // horn + trombone octave below
    hornNote(K, t, mtof(midi), dur, vel, o);
    hornNote(K, t, mtof(midi - 12), dur, vel * 0.8, Object.assign({ dark: true }, o));
  }

  // ---- CHOIR: 5 detuned saw voices → 3 parallel vowel formants with a slow
  // ah→oh morph, very slow attack. Low male register drops the formant set.
  const VOWELS = {
    ah: { f: [700, 1220, 2600], a: [1, 0.45, 0.18] },
    oh: { f: [450, 800, 2830], a: [1, 0.32, 0.06] },
  };
  function choirNote(K, t, f, dur, vel, o) {
    o = o || {};
    const C = K.ctx;
    const nV = o.voices != null ? o.voices : 5;
    const atk = Math.min(o.atk != null ? o.atk : 1.1, dur * 0.55);
    const rel = o.rel != null ? o.rel : 0.9;
    const tEnd = t + Math.max(dur, atk + 0.1);
    const male = f < 120 ? 0.78 : 1; // low male choir: darker formants
    const v1 = VOWELS[o.v1 || 'ah'], v2 = VOWELS[o.v2 || 'oh'];

    const mix = C.createGain(); mix.gain.value = 0.4;
    const sum = C.createGain();
    for (let k = 0; k < 3; k++) {
      const bp = C.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 6 + k * 2.5;
      bp.frequency.setValueAtTime(v1.f[k] * male, t);
      bp.frequency.linearRampToValueAtTime(v2.f[k] * male, tEnd); // vowel morph
      const bg = C.createGain(); bg.gain.value = (v1.a[k] + v2.a[k]) * 0.5;
      mix.connect(bp); bp.connect(bg); bg.connect(sum);
    }
    const amp = C.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + atk);
    amp.gain.linearRampToValueAtTime(vel * 0.85, tEnd);
    amp.gain.linearRampToValueAtTime(0, tEnd + rel);
    sum.connect(amp);
    out(K, amp, 0.6, o.send != null ? o.send : 0.6);

    const lfo = C.createOscillator(); lfo.frequency.value = 4.2 + K.rng();
    const lfoG = C.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(7, t + 1.6);
    lfo.connect(lfoG); lfo.start(t); lfo.stop(tEnd + rel + 0.1);
    for (let i = 0; i < nV; i++) {
      const osc = C.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (nV > 1 ? -12 + (24 * i) / (nV - 1) : 0) + (K.rng() * 6 - 3);
      lfoG.connect(osc.detune);
      const st = Math.max(0, t + (K.rng() * 0.08 - 0.04));
      osc.connect(mix); osc.start(st); osc.stop(tEnd + rel + 0.1);
    }
  }

  // ---- FLUTE: triangle + band-passed breath, gentle delayed vibrato.
  function fluteNote(K, t, f, dur, vel, o) {
    o = o || {};
    const C = K.ctx;
    const atk = Math.min(0.09, dur * 0.4), rel = 0.18;
    const tEnd = t + Math.max(dur, atk + 0.03);
    const amp = C.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + atk);
    amp.gain.linearRampToValueAtTime(vel * 0.82, tEnd);
    amp.gain.linearRampToValueAtTime(0, tEnd + rel);
    out(K, amp, 0.75, o.send != null ? o.send : 0.42);

    const osc = C.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
    const lfo = C.createOscillator(); lfo.frequency.value = 5.1 + K.rng() * 0.6;
    const lfoG = C.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(9, t + 0.5);
    lfo.connect(lfoG); lfoG.connect(osc.detune);
    osc.connect(amp);
    osc.start(t); osc.stop(tEnd + rel + 0.05);
    lfo.start(t); lfo.stop(tEnd + rel + 0.05);
    // breath
    const ns = noiseSrc(K, t, tEnd + rel - t);
    const bp = C.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = Math.min(f * 2, 4800); bp.Q.value = 1.2;
    const ng = C.createGain(); ng.gain.value = vel * 0.055;
    ns.connect(bp); bp.connect(ng); ng.connect(amp);
  }

  // ---- HARP / LUTE: true Karplus-Strong plucks computed sample-by-sample.
  function ksPluck(K, t, midi, vel, o) {
    o = o || {};
    const C = K.ctx;
    const f = mtof(midi);
    const sec = clamp(0.9 + 260 / f, 1.2, 3.2);
    const N = Math.max(2, Math.round(SR / f));
    const len = Math.floor(sec * SR);
    const buf = C.createBuffer(1, len, SR);
    const dd = buf.getChannelData(0);
    const ring = new Float32Array(N);
    let pv = 0;
    for (let i = 0; i < N; i++) { // softened excitation (pre-lowpassed noise)
      const w = K.rng() * 2 - 1;
      pv += (o.soft != null ? o.soft : 0.55) * (w - pv);
      ring[i] = pv;
    }
    let idx = 0;
    const damp = o.damp != null ? o.damp : 0.997;
    for (let i = 0; i < len; i++) {
      const v = (ring[idx] + ring[(idx + 1) % N]) * 0.5 * damp;
      ring[idx] = v; dd[i] = v;
      idx = (idx + 1) % N;
    }
    const src = C.createBufferSource(); src.buffer = buf;
    const gn = C.createGain(); gn.gain.value = vel;
    const pan = C.createStereoPanner ? C.createStereoPanner() : null;
    src.connect(gn);
    let tail = gn;
    if (pan) { pan.pan.value = clamp((midi - 62) / 34, -0.6, 0.6); gn.connect(pan); tail = pan; }
    out(K, tail, 0.7, o.send != null ? o.send : 0.45);
    src.start(Math.max(0, t + (K.rng() * 0.02 - 0.01)));
  }

  // ---- PERCUSSION -----------------------------------------------------------
  function timpani(K, t, midi, vel, o) {
    o = o || {};
    const C = K.ctx, f = mtof(midi);
    const osc = C.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.45, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    const gn = C.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vel, t + 0.006);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 1.15);
    osc.connect(gn); osc.start(t); osc.stop(t + 1.3);
    const o2 = C.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.504;
    const g2 = C.createGain();
    g2.gain.setValueAtTime(vel * 0.3, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o2.connect(g2); o2.start(t); o2.stop(t + 0.5);
    const ns = noiseSrc(K, t, 0.08);
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const ng = C.createGain();
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.linearRampToValueAtTime(0, t + 0.06);
    ns.connect(lp); lp.connect(ng);
    out(K, gn, 0.7, o.send != null ? o.send : 0.7);
    out(K, g2, 0.5, 0.5); out(K, ng, 0.5, 0.4);
  }
  function taiko(K, t, vel, o) {
    o = o || {};
    const C = K.ctx;
    const osc = C.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(o.deep ? 52 : 64, t);
    osc.frequency.exponentialRampToValueAtTime(o.deep ? 36 : 44, t + 0.06);
    const gn = C.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vel, t + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.001, t + (o.deep ? 0.8 : 0.38));
    osc.connect(gn); osc.start(t); osc.stop(t + 1);
    const ns = noiseSrc(K, t, 0.06);
    const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 0.7;
    const ng = C.createGain();
    ng.gain.setValueAtTime(vel * 0.42, t);
    ng.gain.linearRampToValueAtTime(0, t + 0.045);
    ns.connect(bp); bp.connect(ng);
    out(K, gn, 0.85, o.send != null ? o.send : 0.3);
    out(K, ng, 0.6, 0.25);
  }
  function snare(K, t, vel) {
    const C = K.ctx;
    const ns = noiseSrc(K, t, 0.16);
    const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1750; bp.Q.value = 0.8;
    const ng = C.createGain();
    ng.gain.setValueAtTime(vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    ns.connect(bp); bp.connect(ng);
    const osc = C.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 195;
    const og = C.createGain();
    og.gain.setValueAtTime(vel * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(og); osc.start(t); osc.stop(t + 0.1);
    out(K, ng, 0.65, 0.3); out(K, og, 0.6, 0.2);
  }
  function anvil(K, t, vel) { // forge-metal — inharmonic partials, huge hall
    const C = K.ctx;
    const parts = [1, 2.756, 5.404, 8.933], gains = [1, 0.62, 0.4, 0.22], dks = [1.9, 1.2, 0.75, 0.45];
    for (let i = 0; i < parts.length; i++) {
      const osc = C.createOscillator(); osc.type = 'sine';
      osc.frequency.value = 472 * parts[i] * (1 + (K.rng() * 0.01 - 0.005));
      const gn = C.createGain();
      gn.gain.setValueAtTime(vel * gains[i] * 0.5, t);
      gn.gain.exponentialRampToValueAtTime(0.0008, t + dks[i]);
      osc.connect(gn); osc.start(t); osc.stop(t + dks[i] + 0.1);
      out(K, gn, 0.35, 0.85);
    }
    const ns = noiseSrc(K, t, 0.02);
    const hp = C.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = C.createGain();
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.linearRampToValueAtTime(0, t + 0.012);
    ns.connect(hp); hp.connect(ng);
    out(K, ng, 0.4, 0.5);
  }
  function lowBell(K, t, midi, vel) {
    const C = K.ctx, f = mtof(midi);
    const parts = [1, 2.0, 2.92, 4.15], gains = [1, 0.5, 0.32, 0.16];
    for (let i = 0; i < parts.length; i++) {
      const osc = C.createOscillator(); osc.type = 'sine'; osc.frequency.value = f * parts[i];
      const gn = C.createGain();
      gn.gain.setValueAtTime(vel * gains[i] * 0.5, t + i * 0.002);
      gn.gain.exponentialRampToValueAtTime(0.0006, t + 4.2 - i * 0.7);
      osc.connect(gn); osc.start(t); osc.stop(t + 4.4);
      out(K, gn, 0.4, 0.8);
    }
  }
  function subPedal(K, t, midi, dur, vel) {
    const C = K.ctx;
    const osc = C.createOscillator(); osc.type = 'sine'; osc.frequency.value = mtof(midi);
    const gn = C.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vel, t + Math.min(2.5, dur * 0.4));
    gn.gain.setValueAtTime(vel, t + dur - Math.min(3, dur * 0.4));
    gn.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gn); osc.start(t); osc.stop(t + dur + 0.1);
    out(K, gn, 0.95, 0);
  }

  // ==========================================================================
  // SEQUENCER — notes are [bar, beat, midi, durBeats, vel]
  // ==========================================================================
  function seq(K, notes, bpm, bpb, t0, fn) {
    const spb = 60 / bpm;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      fn(t0 + (n[0] * bpb + n[1]) * spb, n[2], (n[3] != null ? n[3] : 1) * spb, n[4] != null ? n[4] : 1);
    }
  }
  // String pad: chords = [bar, durBars, [midis], vel] — registers get their
  // own brightness/attack (basses dark & slow, violins airy).
  function padChords(K, chords, bpm, bpb, t0, o) {
    o = o || {};
    const spb = 60 / bpm;
    for (let i = 0; i < chords.length; i++) {
      const c = chords[i];
      const t = t0 + c[0] * bpb * spb;
      const dur = c[1] * bpb * spb * 1.04; // legato overlap
      const vel = c[3] != null ? c[3] : 0.14;
      const ms = c[2];
      for (let k = 0; k < ms.length; k++) {
        const m = ms[k];
        const reg = m < 48 ? 0 : m < 60 ? 1 : 2;
        stringsNote(K, t, mtof(m), dur, vel * [1.05, 0.9, 0.8][reg], {
          bright: o.trem ? 3600 : [1500, 2300, 3300][reg],
          atk: o.atk != null ? o.atk : [0.35, 0.3, 0.22][reg],
          voices: o.voices != null ? o.voices : (reg === 0 ? 4 : 5),
          trem: !!o.trem, send: o.send,
        });
      }
    }
  }
  function arpBar(K, t, chord, stepSec, vel, inst) { // 6-step harp/lute figure
    const idx = [0, 1, 2, 3, 2, 1];
    for (let s = 0; s < 6; s++) {
      const m = chord[Math.min(idx[s], chord.length - 1)];
      inst(K, t + s * stepSec + (K.rng() * 0.012 - 0.006), m, vel * (s === 0 ? 1.1 : 0.85 + K.rng() * 0.2));
    }
  }

  // ==========================================================================
  // THE COMPOSITIONS
  // ==========================================================================
  // The Elderfall gesture: a rising fifth (D→A) then a stepwise falling
  // resolution. D dorian. Everything in the score derives from it.
  const MEL_A = [ // 8 bars of 3/4 — THE theme
    [0, 0, 62, 1], [0, 1, 69, 2],
    [1, 0, 71, 1], [1, 1, 69, 1], [1, 2, 67, 1],
    [2, 0, 69, 2], [2, 2, 65, 1],
    [3, 0, 64, 3],
    [4, 0, 62, 1], [4, 1, 69, 2],
    [5, 0, 72, 1], [5, 1, 71, 1], [5, 2, 69, 1],
    [6, 0, 67, 1], [6, 1, 65, 1], [6, 2, 64, 1],
    [7, 0, 62, 3],
  ];
  const MEL_B = [ // 8 bars — soaring B phrase, climax on high D
    [0, 0, 65, 1], [0, 1, 67, 1], [0, 2, 69, 1],
    [1, 0, 71, 3],
    [2, 0, 72, 1], [2, 1, 71, 1], [2, 2, 69, 1],
    [3, 0, 67, 2], [3, 2, 69, 1],
    [4, 0, 74, 2], [4, 2, 72, 1],
    [5, 0, 71, 1], [5, 1, 72, 1], [5, 2, 69, 1],
    [6, 0, 67, 2], [6, 2, 64, 1],
    [7, 0, 64, 3],
  ];
  const V = { // orchestral chord voicings (midi)
    Dm: [38, 50, 57, 62, 65], F: [41, 48, 57, 60, 65], Em: [40, 52, 59, 64, 67],
    G: [43, 50, 59, 62, 67], C: [36, 48, 55, 60, 64], Am: [45, 52, 57, 60, 64],
    Bb: [46, 53, 58, 62], A: [45, 52, 61, 64], Dmaj: [38, 50, 57, 62, 66],
    Gm: [43, 55, 58, 62],
  };
  const THEME_PROG_A = [V.Dm, V.Dm, V.F, V.Em, V.Dm, V.G, V.C, V.Dm];
  const THEME_PROG_B = [V.F, V.G, V.Am, V.F, V.Dm, V.Am, V.C, V.Am];

  function shift(notes, dBar, dMidi) {
    const outN = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      outN.push([n[0] + dBar, n[1], n[2] + (dMidi || 0), n[3], n[4]]);
    }
    return outN;
  }

  // ---- CUE 1: THE ELDERFALL THEME — D dorian, 3/4, 65 bpm, A A' B A'' ------
  function buildTheme(K) {
    const bpm = 65, bpb = 3, t0 = 0.25, spb = 60 / bpm;
    const T = (bar) => t0 + bar * bpb * spb;
    const chords = [];
    // A (pp, low strings only) / A' (fuller) / B / A'' (tutti)
    for (let b = 0; b < 8; b++) chords.push([b, 1, THEME_PROG_A[b].slice(0, 3), 0.085]);
    for (let b = 0; b < 8; b++) chords.push([8 + b, 1, THEME_PROG_A[b].slice(0, 4), 0.115]);
    for (let b = 0; b < 8; b++) chords.push([16 + b, 1, THEME_PROG_B[b], 0.17]);
    for (let b = 0; b < 8; b++) chords.push([24 + b, 1, THEME_PROG_A[b], 0.21]);
    padChords(K, chords, bpm, bpb, t0);

    // A + A': solo flute carries the theme
    seq(K, MEL_A, bpm, bpb, t0, (t, m, d, v) => fluteNote(K, t, mtof(m), d * 0.96, 0.42));
    seq(K, MEL_A, bpm, bpb, T(8), (t, m, d, v) => fluteNote(K, t, mtof(m), d * 0.96, 0.48));
    // A': harp arpeggios join
    for (let b = 0; b < 8; b++)
      arpBar(K, T(8 + b), THEME_PROG_A[b].slice(1), (bpb * spb) / 6, 0.2, (Kk, tt, mm, vv) => ksPluck(Kk, tt, mm, vv));
    // B: violins take the theme, horns sing the countermelody
    seq(K, MEL_B, bpm, bpb, T(16), (t, m, d, v) =>
      stringsNote(K, t, mtof(m + 12), d * 1.05, 0.24, { voices: 5, bright: 4200, atk: 0.13, vib: 8 }));
    const HORN_CM = [
      [0, 0, 57, 3], [1, 0, 55, 3], [2, 0, 57, 1.5], [2, 1.5, 60, 1.5], [3, 0, 60, 3],
      [4, 0, 62, 3], [5, 0, 60, 1.5], [5, 1.5, 57, 1.5], [6, 0, 55, 3], [7, 0, 57, 3],
    ];
    seq(K, HORN_CM, bpm, bpb, T(16), (t, m, d) => hornNote(K, t, mtof(m), d * 1.02, 0.16));
    timpani(K, T(23) + 2 * spb, 38, 0.3); // roll-in hit
    timpani(K, T(23) + 2.5 * spb, 38, 0.34);
    // A'': tutti — violins melody 8va, choir doubles at pitch, horns pedal,
    // harp arps, timpani on strong bars, closing roll.
    seq(K, MEL_A, bpm, bpb, T(24), (t, m, d) =>
      stringsNote(K, t, mtof(m + 12), d * 1.05, 0.26, { voices: 6, bright: 4400, atk: 0.12, vib: 8 }));
    seq(K, MEL_A, bpm, bpb, T(24), (t, m, d, v) =>
      choirNote(K, t, mtof(m), d * 1.1, 0.16, { atk: Math.min(0.5, d * 0.4), v1: 'ah', v2: 'oh' }));
    for (let b = 0; b < 8; b++) {
      arpBar(K, T(24 + b), THEME_PROG_A[b].slice(1), (bpb * spb) / 6, 0.22, (Kk, tt, mm, vv) => ksPluck(Kk, tt, mm, vv));
      const root = THEME_PROG_A[b][0];
      hornNote(K, T(24 + b), mtof(root + 12), bpb * spb * 1.02, 0.1);
      if (b % 2 === 0) timpani(K, T(24 + b), 38, b === 0 ? 0.4 : 0.3);
    }
    for (let i = 0; i < 6; i++) // final timpani roll, crescendo into the last chord
      timpani(K, T(31) - (6 - i) * spb * 0.25, 38, 0.12 + i * 0.05);
    timpani(K, T(31), 38, 0.5);
    // final open fifth rings out: D across four octaves + choir + flute high D
    stringsNote(K, T(31), mtof(38), 5, 0.2, { atk: 0.3, bright: 1500, voices: 4 });
    stringsNote(K, T(31), mtof(50), 5, 0.17, { atk: 0.3, bright: 2300 });
    stringsNote(K, T(31), mtof(57), 5, 0.15, { atk: 0.3, bright: 2800 });
    stringsNote(K, T(31), mtof(62), 5, 0.15, { atk: 0.25, bright: 3400 });
    stringsNote(K, T(31), mtof(74), 5, 0.13, { atk: 0.25, bright: 4200, vib: 9 });
    choirNote(K, T(31), mtof(62), 5, 0.15, { v1: 'ah', v2: 'ah', atk: 0.8 });
    fluteNote(K, T(31), mtof(74), 4.5, 0.3);
  }
  const THEME_LEN = 0.25 + 32 * 3 * (60 / 65) + 6.5; // ≈ 95.4 s

  // ---- CUE 2: EMBERHOLLOW — pastoral 6/8 variation, F major, flute + lute --
  // Long rests between phrases: silence is part of the tune.
  const EXP_BPM = 168, EXP_BARS = 30; // bpm counts 8th-notes; bar = 6 eighths
  function buildExplore(K) {
    const bpb = 6, t0 = 0.2, spb = 60 / EXP_BPM;
    const T = (bar) => t0 + bar * bpb * spb;
    // lute chord roots per bar (root midi, minor?)
    const L = [
      [53, 0], [53, 0], [53, 0], [58, 0], [53, 0], [48, 0], [53, 0], [53, 0],
      [50, 1], [58, 0], [53, 0], [48, 0], [53, 0], [58, 0], [50, 1], [48, 0],
      [53, 0], [48, 0], [50, 1], [58, 0], [53, 0], [53, 0], [53, 0], [58, 0],
      [48, 0], [53, 0], [53, 0], [58, 0], [53, 0], [53, 0],
    ];
    for (let b = 0; b < EXP_BARS; b++) {
      const [r, mnr] = L[b];
      const sparse = b >= 26; // outro thins out
      const steps = [r - 12, r, r + 7, mnr ? r + 15 : r + 16, r + 7, r];
      for (let s = 0; s < 6; s++) {
        if (sparse && s % 2 === 1) continue;
        ksPluck(K, T(b) + s * spb + (K.rng() * 0.014 - 0.007), steps[s],
          (s === 0 ? 0.3 : 0.2 + K.rng() * 0.08) * (sparse ? 0.7 : 1), { damp: 0.9962, soft: 0.5 });
      }
    }
    // flute phrases (beats are eighth-notes)
    const P = [
      // phrase 1 — the pastoral rise F→C (the Elderfall fifth, majorised)
      [2, 0, 65, 2], [2, 2, 67, 1], [2, 3, 69, 3], [3, 0, 72, 6],
      [4, 0, 74, 2], [4, 2, 72, 1], [4, 3, 69, 3], [5, 0, 67, 4],
      // phrase 2 — answer, dipping to D minor
      [8, 0, 62, 2], [8, 2, 64, 1], [8, 3, 65, 3], [9, 0, 69, 3], [9, 3, 67, 3],
      [10, 0, 65, 2], [10, 2, 67, 1], [10, 3, 69, 3], [11, 0, 67, 3], [11, 3, 64, 3],
      // phrase 3 — higher, wondering
      [16, 0, 69, 2], [16, 2, 72, 1], [16, 3, 74, 3], [17, 0, 76, 6],
      [18, 0, 74, 2], [18, 2, 72, 1], [18, 3, 69, 3], [19, 0, 70, 6],
      // phrase 4 — settling home
      [22, 0, 69, 2], [22, 2, 67, 1], [22, 3, 65, 3],
      [23, 0, 67, 2], [23, 2, 69, 1], [23, 3, 70, 2],
      [24, 0, 67, 4], [24, 4, 64, 2], [25, 0, 65, 6],
    ];
    seq(K, P, EXP_BPM, bpb, t0, (t, m, d) => fluteNote(K, t, mtof(m), d * 0.94, 0.4));
    // soft string pads in the resting stretches
    padChords(K, [
      [12, 1, [41, 48, 57], 0.07], [13, 1, [46, 53, 58], 0.07],
      [14, 1, [38, 50, 57], 0.07], [15, 1, [36, 48, 55], 0.07],
      [22, 2, [41, 48, 57, 60], 0.075], [24, 1, [36, 48, 55], 0.075], [25, 2, [41, 48, 57], 0.08],
      [27, 1, [46, 53, 58], 0.06], [28, 2, [41, 48, 57], 0.055],
    ], EXP_BPM, bpb, t0, { atk: 0.5 });
  }
  const EXPLORE_LEN = 0.2 + EXP_BARS * 6 * (60 / EXP_BPM) + 3.2; // ≈ 67.7 s

  // ---- CUE 3: THE VALE AT NIGHT — theme inverted, tremolo ppp, sparse harp -
  function buildNight(K) {
    const bpm = 48, bpb = 4, t0 = 0.2, spb = 60 / bpm;
    const T = (bar) => t0 + bar * bpb * spb;
    // high tremolo veil, ppp — Dm / Gm / Am colours
    padChords(K, [
      [0, 4, [74, 77, 81], 0.05], [4, 4, [70, 74, 79], 0.05],
      [8, 2, [69, 72, 76], 0.05], [10, 2, [74, 77, 81], 0.045],
    ], bpm, bpb, t0, { trem: true, atk: 1.6, send: 0.7 });
    // celli whisper roots beneath
    padChords(K, [
      [0, 4, [38, 50], 0.06], [4, 4, [43, 55], 0.055], [8, 4, [45, 50], 0.055],
    ], bpm, bpb, t0, { atk: 1.2 });
    // the theme inverted (falls a fifth, rises stepwise) — lone harp
    const HARP = [
      [0, 2, 62], [1, 0, 55], [1, 3, 57], [2, 2, 58],
      [4, 0, 62], [4, 3, 60], [5, 2, 58], [6, 0, 57],
      [8, 2, 62], [9, 0, 55], [10, 0, 57], [10, 3, 58], [11, 2, 62],
    ];
    for (let i = 0; i < HARP.length; i++) {
      const n = HARP[i];
      ksPluck(K, T(n[0]) + n[1] * spb, n[2], 0.26, { send: 0.7, damp: 0.9975 });
    }
    // low choir breaths — barely there
    choirNote(K, T(4), mtof(38), 9, 0.07, { v1: 'oh', v2: 'oh', atk: 3 });
    choirNote(K, T(4), mtof(45), 9, 0.05, { v1: 'oh', v2: 'oh', atk: 3.5 });
    choirNote(K, T(9), mtof(36), 9, 0.06, { v1: 'oh', v2: 'ah', atk: 3 });
    subPedal(K, T(0), 26, 20, 0.1);
    subPedal(K, T(6), 26, 22, 0.09);
  }
  const NIGHT_LEN = 0.2 + 12 * 4 * (60 / 48) + 4; // ≈ 64.2 s

  // ---- CUE 4: BATTLE — 140 bpm, taiko 3+3+2, low-string engine, brass stem -
  const BTL_BPM = 140, BTL_BARS = 24;
  const BTL_LEN = BTL_BARS * 4 * (60 / BTL_BPM); // exactly 41.142857 s (loops)
  const BTL_ROOTS = [38, 38, 34, 36]; // D D Bb C
  function buildBattleBase(K) {
    const spb = 60 / BTL_BPM, e8 = spb / 2, t0 = 0;
    for (let b = 0; b < BTL_BARS; b++) {
      const bt = t0 + b * 4 * spb;
      const root = BTL_ROOTS[b % 4];
      // taiko 3+3+2
      taiko(K, bt, 0.6, { deep: b % 8 === 0 });
      taiko(K, bt + 3 * e8, 0.42);
      taiko(K, bt + 6 * e8, 0.46);
      if (b % 4 === 3) taiko(K, bt + 7 * e8, 0.36);
      snare(K, bt + 4 * e8, 0.22);
      if (b % 8 === 7) for (let i = 0; i < 4; i++) snare(K, bt + (4 + i) * e8, 0.13 + i * 0.04);
      // low string ostinato 8ths (accents mirror the 3+3+2)
      for (let s = 0; s < 8; s++) {
        const m = s === 5 ? root + 3 : (s === 2 || s === 6) ? root + 7 : root;
        const acc = (s === 0 || s === 3 || s === 6) ? 1.25 : 0.85;
        stringsNote(K, bt + s * e8, mtof(m), e8 * 0.85, 0.115 * acc,
          { voices: 3, atk: 0.02, rel: 0.06, bright: 1900, bow: false, vib: 0, send: 0.25 });
        stringsNote(K, bt + s * e8, mtof(m + 12), e8 * 0.85, 0.07 * acc,
          { voices: 2, atk: 0.02, rel: 0.06, bright: 2400, bow: false, vib: 0, send: 0.25 });
      }
      timpani(K, bt, root - 12 < 33 ? root : root - 12, 0.3, { send: 0.4 });
      timpani(K, bt + 6 * e8, root, 0.2, { send: 0.4 });
      // dark horn pedal swell every 4 bars
      if (b % 4 === 0) hornNote(K, bt, mtof(38), 4 * spb * 3.9, 0.055, { dark: true, atk: 2.5, rel: 1.5 });
    }
  }
  function buildBattleBrass(K) { // intensity layer: theme head-motif as stabs
    const spb = 60 / BTL_BPM, t0 = 0;
    const stab = (t, m, d, v) => hornStab(K, t, m, d, v, { send: 0.35 });
    const S = [ // beats are quarter-notes, 4/4
      [2, 0, 62, 0.5, 0.2], [2, 1.5, 69, 1.5, 0.24],
      [6, 0, 65, 0.5, 0.2], [6, 1.5, 72, 1.5, 0.24],
      [10, 0, 62, 0.5, 0.2], [10, 1.5, 69, 1, 0.22], [11, 0, 67, 0.5, 0.2], [11, 1, 65, 0.5, 0.2], [11, 2, 64, 1, 0.2],
      [14, 0, 62, 0.5, 0.2], [14, 1, 65, 0.5, 0.2], [14, 2, 67, 0.5, 0.2], [14, 3, 69, 1, 0.26],
      // bars 16-23: the head-motif augmented — heroic over the engine
      [16, 0, 62, 2, 0.22], [16, 2, 69, 2, 0.26], [17, 0, 71, 2, 0.24], [17, 2, 69, 2, 0.22],
      [18, 0, 67, 4, 0.22], [19, 0, 69, 4, 0.24],
      [20, 0, 65, 2, 0.22], [20, 2, 64, 2, 0.2], [21, 0, 62, 4, 0.24],
      [22, 0, 60, 2, 0.2], [22, 2, 58, 2, 0.2], [23, 0, 57, 4, 0.24],
    ];
    seq(K, S, BTL_BPM, 4, t0, (t, m, d, v) => stab(t, m, d * 0.92, v));
    // storm-violin shimmer through the second half
    const TR = [[16, 69], [17, 70], [18, 69], [19, 67], [20, 69], [21, 70], [22, 69], [23, 69]];
    for (let i = 0; i < TR.length; i++) {
      stringsNote(K, t0 + TR[i][0] * 4 * spb, mtof(TR[i][1] + 12), 4 * spb, 0.075,
        { trem: true, atk: 0.4, bright: 4200, send: 0.5 });
    }
  }

  // ---- CUE 5: THE DEEP DARK — no melody. Low male choir in minor seconds,
  // sub pedal, anvil tolls. Dread is the absence of the theme.
  const DREAD_LEN = 48;
  function buildDread(K) {
    const c = (t, m, dur, v) =>
      choirNote(K, t, mtof(m), dur, v, { v1: 'oh', v2: 'oh', atk: 4, rel: 2.5, voices: 6, send: 0.75 });
    c(0.5, 38, 11, 0.14); c(0.5, 39, 11, 0.12);          // D2 + Eb2 grinding
    c(11, 36, 11, 0.13); c(11, 37, 11, 0.11);            // C2 + Db2
    c(21.5, 38, 11, 0.14); c(21.5, 39, 11, 0.12); c(21.5, 33, 11, 0.1);
    c(32.5, 34, 10, 0.12); c(32.5, 35, 10, 0.1);         // Bb1 + B1, dies by 45
    subPedal(K, 0.5, 26, 22, 0.16);                       // D1 under everything
    subPedal(K, 23, 24, 22, 0.14);                        // C1
    anvil(K, 8, 0.4); anvil(K, 20.5, 0.32); anvil(K, 36, 0.42);
    lowBell(K, 30, 50, 0.2);
    taiko(K, 16, 0.5, { deep: true, send: 0.8 });
    taiko(K, 40, 0.55, { deep: true, send: 0.8 });
    // faint high tremolo thread of unease
    stringsNote(K, 4, mtof(86), 18, 0.03, { trem: true, atk: 5, rel: 4, bright: 5000, send: 0.8 });
    stringsNote(K, 26, mtof(87), 16, 0.028, { trem: true, atk: 5, rel: 4, bright: 5000, send: 0.8 });
  }

  // ---- CUE 6: DRAKESPIRE — the theme augmented in brass over storm strings -
  const BOSS_BPM = 100, BOSS_BARS = 24;
  const BOSS_LEN = BOSS_BARS * 4 * (60 / BOSS_BPM); // 57.6 s (loops)
  function buildBoss(K) {
    const spb = 60 / BOSS_BPM, e8 = spb / 2, t0 = 0;
    const STORM = [[57, 62, 65, 69], [58, 62, 65, 70], [55, 58, 62, 67], [57, 61, 64, 69]];
    const ROOTS = [38, 34, 43, 45];
    for (let b = 0; b < BOSS_BARS; b++) {
      const bt = t0 + b * 4 * spb;
      const ch = STORM[b % 4], root = ROOTS[b % 4];
      for (let k = 0; k < ch.length; k++)
        stringsNote(K, bt, mtof(ch[k]), 4 * spb, 0.06, { trem: true, atk: 0.25, bright: 3800, send: 0.5 });
      stringsNote(K, bt, mtof(root), 4 * spb * 1.02, 0.1, { atk: 0.2, bright: 1500, voices: 4 });
      // percussion: doubled taiko cell + snare + timpani
      taiko(K, bt, 0.55, { deep: b % 4 === 0 });
      taiko(K, bt + 3 * e8, 0.4); taiko(K, bt + 6 * e8, 0.44);
      taiko(K, bt + 2 * spb, 0.34); taiko(K, bt + 2 * spb + 3 * e8, 0.3);
      snare(K, bt + spb, 0.18); snare(K, bt + 3 * spb, 0.2);
      if (b % 4 === 3) for (let i = 0; i < 6; i++) snare(K, bt + 3 * spb + i * (spb / 6), 0.1 + i * 0.03);
      timpani(K, bt, root, 0.32, { send: 0.5 });
      if (b % 4 === 2) timpani(K, bt + 2 * spb, root, 0.24, { send: 0.5 });
    }
    // the theme, augmented — noble and terrible
    const AUG = [
      [4, 0, 50, 2], [4, 2, 57, 2], [5, 0, 57, 4], [6, 0, 59, 2], [6, 2, 57, 2],
      [7, 0, 55, 4], [8, 0, 57, 4], [9, 0, 53, 2], [9, 2, 52, 2], [10, 0, 52, 4], [11, 0, 50, 4],
    ];
    const stab = (t, m, d, v) => hornStab(K, t, m, d, v, { send: 0.45 });
    seq(K, AUG, BOSS_BPM, 4, t0, (t, m, d) => stab(t, m, d * 0.96, 0.24));
    seq(K, shift(AUG, 8, 5), BOSS_BPM, 4, t0, (t, m, d) => stab(t, m, d * 0.96, 0.27)); // up a fourth
    const DESC = [
      [20, 0, 62, 2], [20, 2, 60, 2], [21, 0, 58, 2], [21, 2, 57, 2],
      [22, 0, 55, 2], [22, 2, 53, 2], [23, 0, 45, 4],
    ];
    seq(K, DESC, BOSS_BPM, 4, t0, (t, m, d) => stab(t, m, d * 0.9, 0.26));
    // choir joins for the second statement
    const CHO = [[12, [62, 65, 69]], [16, [62, 67, 70]], [20, [61, 64, 69]]];
    for (let i = 0; i < CHO.length; i++)
      for (let k = 0; k < CHO[i][1].length; k++)
        choirNote(K, t0 + CHO[i][0] * 4 * spb, mtof(CHO[i][1][k]), 4 * 4 * spb * 0.95, 0.07,
          { v1: 'ah', v2: 'oh', atk: 1.5, send: 0.6 });
  }

  // ---- CUE 7: THE MORNING AFTER — 20 s stinger, solo fiddle, warm Picardy --
  function buildDawn(K) {
    const bpm = 60, bpb = 4, t0 = 0.2, spb = 60 / bpm;
    const MEL = [
      [0, 3, 57, 1], [1, 0, 62, 2], [1, 2, 69, 2],
      [2, 0, 71, 1], [2, 1, 69, 1], [2, 2, 67, 1], [2, 3, 65, 1],
      [3, 0, 64, 2], [3, 2, 66, 2], [4, 0, 62, 4.5],
    ];
    seq(K, MEL, bpm, bpb, t0, (t, m, d) => fiddleNote(K, t, mtof(m), d * 0.98, 0.3));
    padChords(K, [
      [1, 1, [46, 53, 58, 62], 0.09], [2, 1, [48, 55, 64], 0.09],
      [3, 1, [45, 52, 61], 0.095], [4, 1.4, [38, 50, 57, 62, 66], 0.11],
    ], bpm, bpb, t0, { atk: 0.45 });
    ksPluck(K, t0 + 4 * bpb * spb, 62, 0.24, { send: 0.6 });
    ksPluck(K, t0 + 4 * bpb * spb + 0.12, 66, 0.2, { send: 0.6 });
    ksPluck(K, t0 + 4 * bpb * spb + 0.24, 69, 0.2, { send: 0.6 });
    fluteNote(K, t0 + 4.2 * bpb * spb, mtof(74), 3.4, 0.2);
  }
  const DAWN_LEN = 0.2 + 5 * 4 * 1 + 3; // 23.2 s

  // ==========================================================================
  // RENDER PIPELINE — lazy, priority-ordered, background
  // ==========================================================================
  const CUES = {
    explore: { len: EXPLORE_LEN, loop: false, build: buildExplore, rms: 0.055, lvl: 0.85 },
    night: { len: NIGHT_LEN, loop: false, build: buildNight, rms: 0.042, lvl: 0.85 },
    battleBase: { len: BTL_LEN, loop: true, build: buildBattleBase, rms: 0.09, lvl: 1 },
    battleBrass: { len: BTL_LEN, loop: true, build: buildBattleBrass, rms: 0.07, lvl: 0.95 },
    dread: { len: DREAD_LEN, loop: true, build: buildDread, rms: 0.06, lvl: 1 },
    boss: { len: BOSS_LEN, loop: true, build: buildBoss, rms: 0.095, lvl: 1 },
    theme: { len: THEME_LEN, loop: false, build: buildTheme, rms: 0.07, lvl: 0.9 },
    dawn: { len: DAWN_LEN, loop: false, build: buildDawn, rms: 0.06, lvl: 0.85 },
  };
  const RENDER_ORDER = ['explore', 'night', 'battleBase', 'battleBrass', 'dread', 'boss', 'theme', 'dawn'];
  const bufs = {};

  function normalize(buf, targetRms) {
    let sum = 0, peak = 0, n = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const v = d[i]; sum += v * v;
        const a = v < 0 ? -v : v; if (a > peak) peak = a;
      }
      n += d.length;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    let gain = targetRms / Math.max(rms, 1e-6);
    if (peak * gain > 0.8) gain = 0.8 / peak;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] *= gain;
    }
    return { rms: rms * gain, peak: peak * gain };
  }

  let renderIdx = 0, rendering = false;
  function renderNext() {
    if (rendering || renderIdx >= RENDER_ORDER.length) return;
    rendering = true;
    const name = RENDER_ORDER[renderIdx];
    const def = CUES[name];
    let p;
    try {
      const octx = new OfflineAudioContext(2, Math.ceil(def.len * SR), SR);
      const K = makeKit(octx, 'elderfall-' + name);
      def.build(K);
      p = octx.startRendering();
    } catch (e) {
      _debug.errors.push(name + ': ' + e.message);
      rendering = false; renderIdx++;
      setTimeout(renderNext, 50);
      return;
    }
    p.then((buf) => {
      const st = normalize(buf, def.rms);
      bufs[name] = buf;
      _debug.rendered.push(name);
      _debug.stats[name] = {
        dur: Math.round(buf.duration * 10) / 10,
        rms: Math.round(st.rms * 1000) / 1000,
        peak: Math.round(st.peak * 1000) / 1000,
      };
      rendering = false; renderIdx++;
      onCueRendered(name);
      setTimeout(renderNext, 120); // breathe between renders
    }).catch((e) => {
      _debug.errors.push(name + ': ' + (e && e.message));
      rendering = false; renderIdx++;
      setTimeout(renderNext, 50);
    });
  }
  setTimeout(renderNext, 250); // let boot finish first

  // ==========================================================================
  // RUNTIME — playback, crossfades, state machine
  // ==========================================================================
  let cur = null;        // { name, src, gain, start, loop, barSec }
  let brassH = null;     // battle intensity layer handle
  let brassOn = false;
  let silenceUntil = 2;  // small breath after boot before the first cue
  let pendSwitch = null; // { target, at } — waiting for a 2-bar boundary
  let inCombat = false, bossOn = false, bossName = '', lastBossMsg = 0;
  let stingerAt = 0;     // want the dawn stinger until this wall-clock passes
  let prevBloodMoon = false;
  let deadQuiet = false;
  let ducked = false, duckUntil = 0;

  const now = () => ctx.currentTime;
  const fadeTo = (gn, v, dur) => {
    const t = now();
    gn.gain.cancelScheduledValues(t);
    gn.gain.setValueAtTime(gn.gain.value, t);
    gn.gain.linearRampToValueAtTime(v, t + Math.max(0.05, dur));
  };
  function startHandle(bufName, lvl, fadeIn, loop) {
    const buf = bufs[bufName];
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = loop;
    const gn = ctx.createGain(); gn.gain.value = 0;
    src.connect(gn); gn.connect(duck);
    src.start();
    fadeTo(gn, lvl, fadeIn);
    return { name: bufName, src, gain: gn, start: now(), loop };
  }
  function stopHandle(h, fadeOut) {
    if (!h) return;
    fadeTo(h.gain, 0, fadeOut);
    try { h.src.onended = null; h.src.stop(now() + fadeOut + 0.15); } catch (e) { /* already stopped */ }
  }
  function ready(target) {
    if (target === 'battle') return !!bufs.battleBase;
    return !!bufs[target];
  }
  function aggroCount() {
    let n = 0;
    const L = g.enemies && g.enemies.list;
    if (L) for (let i = 0; i < L.length; i++) { const e = L[i]; if (e && e.aggro && e.alive) n++; }
    return n;
  }
  function updateBrass() { // second battle intensity rides the aggro count
    const want = aggroCount() >= 3 || bossOn;
    if (cur && cur.name === 'battle' && bufs.battleBrass && !brassH) {
      // brass rendered after battle began — join in phase with the base loop
      const src = ctx.createBufferSource();
      src.buffer = bufs.battleBrass; src.loop = true;
      const gn = ctx.createGain(); gn.gain.value = 0;
      src.connect(gn); gn.connect(duck);
      src.start(now(), (now() - cur.start) % bufs.battleBrass.duration);
      brassH = { name: 'battleBrass', src, gain: gn, start: cur.start, loop: true };
    }
    if (brassH && want !== brassOn) {
      brassOn = want;
      fadeTo(brassH.gain, want ? CUES.battleBrass.lvl : 0, want ? 1.6 : 3.5);
    }
  }
  function onCueEnded(h) {
    if (cur !== h) return;
    cur = null;
    _debug.currentCue = 'silence';
    if (h.name === 'dawn') { stingerAt = 0; silenceUntil = now() + 9; }
    else if (h.name === 'theme') silenceUntil = now() + 14;
    else silenceUntil = now() + 20 + Math.random() * 25; // the score breathes
  }
  function onCueRendered(name) {
    if (name === 'battleBrass' && cur && cur.name === 'battle') updateBrass();
  }
  function doSwitch(target, urgent) {
    const outDur = urgent ? 2 : (cur && (cur.name === 'battle' || cur.name === 'boss' || cur.name === 'dread')) ? 5.5 : 6.5;
    const inDur = urgent ? 2.4 : 5;
    if (cur) stopHandle(cur, outDur);
    if (brassH) { stopHandle(brassH, outDur); brassH = null; brassOn = false; }
    if (target === 'battle') {
      cur = startHandle('battleBase', CUES.battleBase.lvl, inDur, true);
      cur.name = 'battle';
      cur.barSec = 4 * (60 / BTL_BPM);
      if (bufs.battleBrass) {
        const src = ctx.createBufferSource();
        src.buffer = bufs.battleBrass; src.loop = true;
        const gn = ctx.createGain(); gn.gain.value = 0;
        src.connect(gn); gn.connect(duck);
        src.start(now() + 0.02);
        brassH = { name: 'battleBrass', src, gain: gn, start: now() + 0.02, loop: true };
      }
      updateBrass();
    } else {
      const def = CUES[target];
      cur = startHandle(target, def.lvl, inDur, def.loop);
      if (target === 'boss') cur.barSec = 4 * (60 / BOSS_BPM);
      if (!def.loop) { const h = cur; h.src.onended = () => onCueEnded(h); }
    }
    _debug.currentCue = target;
  }

  const RUINS = POI.ruins || { x: 620, z: -420 };
  const isNight = () => g.time.dayFrac < 0.235 || g.time.dayFrac > 0.765;
  function dreadWant() {
    if (bossOn && /undergloom/i.test(bossName)) return true;
    const p = g.player && g.player.position;
    if (p && isNight() && dist2d(p.x, p.z, RUINS.x, RUINS.z) < 62) return true;
    return false;
  }
  function desired() {
    const F = g.flags;
    if (F.drakeDead && !F.epilogueSeen) return 'theme'; // victory / epilogue
    if (dreadWant()) return 'dread';
    if (bossOn) return 'boss';
    if (inCombat) return 'battle';
    if (stingerAt > now()) return 'dawn';
    return isNight() ? 'night' : 'explore';
  }
  function tickState() {
    if (deadQuiet) {
      const hp = g.player && g.player.stats && g.player.stats.hp;
      if (hp > 0) deadQuiet = false;
      else return;
    }
    const target = desired();
    _debug.want = target;
    const urgent = target === 'battle' || target === 'boss' || target === 'dread';
    if (pendSwitch) {
      if (pendSwitch.target !== target) pendSwitch = null;
      else if (now() >= pendSwitch.at) { doSwitch(target, false); pendSwitch = null; return; }
      else return;
    }
    if (cur && cur.name === target) { if (target === 'battle') updateBrass(); return; }
    if (!ready(target)) return; // still rendering — wait, don't fake it
    if (!urgent) {
      if (!cur && now() < silenceUntil) return;
      if (cur && cur.barSec) { // leave battle/boss musically: next 2-bar line
        const cyc = cur.barSec * 2;
        const into = (now() - cur.start) % cyc;
        const at = now() + (cyc - into);
        if (at > now() + 0.4 && at < now() + cyc + 0.1) { pendSwitch = { target, at }; return; }
      }
    }
    doSwitch(target, urgent);
  }

  // ---- events ---------------------------------------------------------------
  const E = g.events;
  E.on('combatState', (d) => { inCombat = !!(d && d.inCombat); });
  E.on('bossBar', (d) => {
    lastBossMsg = performance.now();
    if (d) { bossOn = true; bossName = String(d.name || ''); }
    else { bossOn = false; bossName = ''; }
  });
  E.on('dialogueLine', (d) => { // duck -6 dB under spoken lines
    if (!ctx) return;
    const est = 1.5 + Math.min(12, ((d && d.text) ? d.text.length : 40) / 14);
    duckUntil = Math.max(duckUntil, now() + est);
    if (!ducked) { ducked = true; duck.gain.setTargetAtTime(0.5, now(), 0.2); }
  });
  E.on('dialogueEnd', () => { duckUntil = 0; });
  E.on('questCompleted', () => { stingerAt = now() + 25; }); // morning-after nod
  E.on('playerDied', () => {
    deadQuiet = true;
    if (cur) { stopHandle(cur, 2.5); cur = null; }
    if (brassH) { stopHandle(brassH, 2.5); brassH = null; brassOn = false; }
    pendSwitch = null;
    _debug.currentCue = 'silence';
    silenceUntil = now() + 6;
  });

  // ---- per-frame update (throttled to 4 Hz of real work) --------------------
  let acc = 0;
  function update(dt) {
    acc += g.time.rawDt || dt;
    if (acc < 0.25) return;
    acc = 0;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* gesture pending */ } }
    // blood-moon dawn: the horde breaks at sunrise → morning-after stinger
    const bm = !!g.flags.bloodMoon;
    if (prevBloodMoon && !bm && g.time.dayFrac > 0.18 && g.time.dayFrac < 0.42) stingerAt = now() + 30;
    prevBloodMoon = bm;
    // duck restore (fallback timer alongside dialogueEnd)
    if (ducked && now() > duckUntil) { ducked = false; duck.gain.setTargetAtTime(1, now(), 0.5); }
    // bossBar staleness guard (enemies re-emit ~7×/s while shown)
    if (bossOn && performance.now() - lastBossMsg > 2500) { bossOn = false; bossName = ''; }
    tickState();
    _debug.ctxState = ctx.state;
    _debug.duck = Math.round(duck.gain.value * 100) / 100;
    _debug.aggro = aggroCount();
    _debug.brass = brassH ? Math.round(brassH.gain.gain.value * 100) / 100 : 0;
    _debug.pending = pendSwitch ? pendSwitch.target : null;
    if (!cur) _debug.currentCue = 'silence';
  }

  return { update, _debug };
}

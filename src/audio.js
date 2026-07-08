// ============================================================================
// ELDERFALL — audio.js
// 100% procedural WebAudio: synthesized SFX, generative seeded music with a
// Karplus-Strong plucked lute, and a living ambient bed (wind / birds /
// crickets / water / ruins shimmer). No assets, no samples.
//
// createAudio(g) → { update(dt), play(name, opts?), unlock() }
//
// - AudioContext is created LAZILY in unlock() (first user gesture). Every
//   method is a safe no-op before that.
// - Master chain: everything → DynamicsCompressor → gain(0.8) → destination.
// - Reverb = cheap dual feedback delay (no ConvolverNode buffers to build).
// - Noise buffers are pre-rendered ONCE at unlock; one-shot voices are
//   bounded at MAX_VOICES (16).
// - Music is scheduled with a lookahead setInterval timer, NOT per-frame.
// - Ambience parameters are re-targeted at most every 0.25 s.
// ============================================================================

import {
  makeRng, WORLD_SEED, WATER_LEVEL, POI, BIOME, biomeAt,
  clamp, lerp, dist2d, snoise,
} from './core.js';

export function createAudio(g) {
  // ---- lazily created audio state -----------------------------------------
  let ctx = null;
  let comp = null, masterGain = null;
  let sfxBus = null, ambBus = null, musicBus = null;
  let verbIn = null;                       // reverb send input
  let noiseWhite = null, noisePink = null; // pre-rendered noise buffers
  let luteBases = null;                    // [[freq, AudioBuffer], ...] warm lute
  let harpBase = null;                     // [freq, AudioBuffer] bright harp
  // music buses / persistent nodes
  let padLP = null, padGain = null, luteGain = null, luteLP = null;
  let combatGain = null, bossGain = null, combatPerc = null, bossPerc = null;
  // ambience persistent nodes
  let windGain = null, windLP = null;
  let cricketGain = null, cricketLfo = null;
  let lapGain = null, shimGain = null;

  // ---- bookkeeping ---------------------------------------------------------
  const MAX_VOICES = 16;
  let activeVoices = 0;
  const lastPlay = new Map();  // sfx name → last scheduled time (dedupe 30ms)
  let ambAcc = 0;              // ambience throttle accumulator
  let nextBirdAt = 0;
  let dayness = 0.7, nightness = 0.3;
  let combatOn = false, bossOn = false;
  const EMPTY = {};

  const now = () => ctx.currentTime;
  const jit = (amt = 0.06) => 1 + (Math.random() * 2 - 1) * amt; // pitch jitter

  // Claim a one-shot voice slot; auto-released after (lead + dur).
  function claim(t, dur) {
    if (activeVoices >= MAX_VOICES) return false;
    activeVoices++;
    const lead = Math.max(0, t - now());
    setTimeout(() => { activeVoices--; }, ((lead + dur) * 1000 + 80) | 0);
    return true;
  }

  function sendVerb(node, amt) {
    const s = ctx.createGain();
    s.gain.value = amt;
    node.connect(s);
    s.connect(verbIn);
  }

  // ---- generic one-shot voices ---------------------------------------------
  // Enveloped oscillator. f1 → exponential pitch glide over dur.
  function osc1(t, dur, type, f0, f1, vol, dest, opt = EMPTY) {
    if (!claim(t, dur)) return null;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    if (opt.detune) o.detune.value = opt.detune;
    let head = o;
    if (opt.fType) {
      const f = ctx.createBiquadFilter();
      f.type = opt.fType;
      f.frequency.setValueAtTime(Math.max(20, opt.ff0 || 1000), t);
      if (opt.ff1) f.frequency.exponentialRampToValueAtTime(Math.max(20, opt.ff1), t + dur);
      f.Q.value = opt.q || 0.9;
      o.connect(f); head = f;
    }
    const gn = ctx.createGain();
    const a = opt.a !== undefined ? opt.a : 0.004;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    head.connect(gn); gn.connect(dest);
    if (opt.verb) sendVerb(gn, opt.verb);
    o.start(t); o.stop(t + dur + 0.08);
    return o;
  }

  // Enveloped noise tap from a pre-rendered buffer (looped: no seam issues).
  function noise1(t, dur, vol, dest, opt = EMPTY) {
    if (!claim(t, dur)) return null;
    const src = ctx.createBufferSource();
    src.buffer = opt.buf || noiseWhite;
    src.loop = true;
    if (opt.rate) src.playbackRate.value = opt.rate;
    let head = src;
    if (opt.fType !== null) {
      const f = ctx.createBiquadFilter();
      f.type = opt.fType || 'lowpass';
      f.frequency.setValueAtTime(Math.max(20, opt.ff0 || 1000), t);
      if (opt.ff1) f.frequency.exponentialRampToValueAtTime(Math.max(20, opt.ff1), t + dur);
      f.Q.value = opt.q || 0.9;
      src.connect(f); head = f;
    }
    const gn = ctx.createGain();
    const a = opt.a !== undefined ? opt.a : 0.003;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    head.connect(gn); gn.connect(dest);
    if (opt.verb) sendVerb(gn, opt.verb);
    src.start(t, Math.random() * 0.9);
    src.stop(t + dur + 0.05);
    return gn;
  }

  // Inharmonic metallic partial cluster (clangs / rings / bells).
  function metal(t, f, mults, amps, durs, vol, verb) {
    for (let i = 0; i < mults.length; i++) {
      osc1(t, durs[i], 'sine', f * mults[i], 0, vol * amps[i], sfxBus, { a: 0.002, verb });
    }
  }

  // ---- Karplus-Strong pluck -------------------------------------------------
  // Pre-render plucked-string buffers once; repitch nearby notes via
  // playbackRate (higher notes ring shorter — like a real string).
  function renderKS(freq, dur, damp, brightness, rng) {
    const sr = ctx.sampleRate;
    const N = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {                 // warm (pre-lowpassed) excitation
      const w = rng() * 2 - 1;
      lp += brightness * (w - lp);
      ring[i] = lp;
    }
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % N];
      ring[idx] = damp * 0.5 * (cur + nxt);
      d[i] = cur;
      idx = (idx + 1) % N;
    }
    const fadeN = Math.floor(len * 0.15);          // fade tail → no click
    for (let i = 0; i < fadeN; i++) d[len - 1 - i] *= i / fadeN;
    return buf;
  }

  function pluck(t, freq, vol, dest, verb, harp = false) {
    let baseF, buf;
    if (harp) { baseF = harpBase[0]; buf = harpBase[1]; }
    else {
      let best = luteBases[0], bd = Infinity;
      for (const b of luteBases) {
        const d = Math.abs(Math.log(freq / b[0]));
        if (d < bd) { bd = d; best = b; }
      }
      baseF = best[0]; buf = best[1];
    }
    const rate = freq / baseF;
    const dur = buf.duration / rate;
    if (!claim(t, dur)) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gn = ctx.createGain();
    gn.gain.value = vol;
    src.connect(gn); gn.connect(dest);
    if (verb) sendVerb(gn, verb);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  // ==========================================================================
  // SFX library — every entry: (t, opts) with pitch jitter baked in.
  // ==========================================================================
  const SFX = {
    swing(t) {
      const j = jit();
      noise1(t, 0.22, 0.15, sfxBus, { fType: 'bandpass', ff0: 420 * j, ff1: 1500 * j, q: 1.2, a: 0.05 });
    },
    swingHeavy(t) {
      const j = jit();
      noise1(t, 0.38, 0.2, sfxBus, { fType: 'bandpass', ff0: 210 * j, ff1: 950 * j, q: 1.1, a: 0.09 });
      osc1(t, 0.3, 'sine', 130 * j, 70, 0.06, sfxBus, { a: 0.08 });
    },
    hitFlesh(t, o) {
      const j = jit();
      const k = (o.heavy ? 1.25 : 1) * (o.vol || 1);
      osc1(t, 0.14, 'sine', 165 * j, 52, 0.42 * k, sfxBus, {});                              // thud
      noise1(t, 0.09, 0.26 * k, sfxBus, { fType: 'lowpass', ff0: 1100 * j, ff1: 280 });      // crunch
      noise1(t, 0.03, 0.14 * k, sfxBus, { fType: 'bandpass', ff0: 2500 * j, q: 1.1 });       // snap
      if (o.kill) osc1(t + 0.02, 0.32, 'sine', 95 * j, 38, 0.3, sfxBus, { verb: 0.25 });     // kill weight
    },
    hitClang(t) {
      const f = 420 * jit();
      metal(t, f, [1, 2.76, 5.4, 8.93], [1, 0.55, 0.3, 0.16], [0.26, 0.2, 0.13, 0.09], 0.22, 0.25);
      noise1(t, 0.04, 0.16, sfxBus, { fType: 'highpass', ff0: 2200 });
    },
    block(t) {
      const f = 280 * jit();
      metal(t, f, [1, 2.4, 4.2], [1, 0.5, 0.25], [0.16, 0.12, 0.08], 0.2, 0.15);
      osc1(t, 0.12, 'sine', 120 * jit(), 60, 0.28, sfxBus, {});
    },
    parry(t) {
      // Bright metallic ring — long shimmering partials, generous reverb.
      const f = 760 * jit(0.04);
      metal(t, f, [1, 2.0, 2.76, 4.5, 6.8], [1, 0.6, 0.45, 0.28, 0.14], [0.8, 0.7, 0.55, 0.4, 0.3], 0.16, 0.55);
      osc1(t, 0.5, 'sine', 1900 * jit(0.03), 0, 0.08, sfxBus, { a: 0.002, verb: 0.5 });
      noise1(t, 0.05, 0.18, sfxBus, { fType: 'highpass', ff0: 3000 });
    },
    bowDraw(t) {
      const j = jit();
      noise1(t, 0.5, 0.07, sfxBus, { fType: 'bandpass', ff0: 240 * j, ff1: 820 * j, q: 5, a: 0.16 });
    },
    bowShoot(t) {
      const j = jit();
      osc1(t, 0.12, 'triangle', 470 * j, 150, 0.28, sfxBus, {});                              // string twang
      noise1(t, 0.16, 0.14, sfxBus, { fType: 'bandpass', ff0: 900 * j, ff1: 2400 * j, q: 1.3, a: 0.02 });
    },
    arrowHit(t) {
      const j = jit();
      osc1(t, 0.08, 'sine', 260 * j, 88, 0.28, sfxBus, {});
      noise1(t, 0.05, 0.18, sfxBus, { fType: 'lowpass', ff0: 1500 * j });
    },
    fireCast(t) {
      const j = jit();
      noise1(t, 0.55, 0.2, sfxBus, { fType: 'lowpass', ff0: 320 * j, ff1: 2600 * j, a: 0.18, verb: 0.2 });
      osc1(t, 0.5, 'sawtooth', 110 * j, 68, 0.07, sfxBus, { a: 0.12, fType: 'lowpass', ff0: 420 });
    },
    fireExplode(t) {
      const j = jit();
      osc1(t, 0.7, 'sine', 145 * j, 32, 0.5, sfxBus, { a: 0.006, verb: 0.2 });                // boom
      noise1(t, 0.9, 0.4, sfxBus, { fType: 'lowpass', ff0: 2100 * j, ff1: 150, verb: 0.35 }); // blast
      for (let i = 0; i < 5; i++) {                                                           // crackle
        noise1(t + 0.08 + Math.random() * 0.5, 0.035, 0.1, sfxBus, { fType: 'highpass', ff0: 1600 + Math.random() * 2400 });
      }
    },
    heal(t) {
      const j = jit(0.02);
      const notes = [440, 659.3, 880];
      for (let i = 0; i < notes.length; i++) {
        osc1(t + i * 0.13, 1.2, 'sine', notes[i] * j, 0, 0.08, sfxBus, { a: 0.2, verb: 0.6 });
      }
      osc1(t, 1.5, 'sine', 220 * j, 0, 0.055, sfxBus, { a: 0.45, verb: 0.5 });                // warm bed
    },
    potion(t) {
      for (let i = 0; i < 3; i++) {
        const f = (320 - i * 42) * jit();
        osc1(t + i * 0.14, 0.1, 'sine', f, f * 0.55, 0.16, sfxBus, { a: 0.01 });
      }
      noise1(t + 0.1, 0.3, 0.04, sfxBus, { fType: 'bandpass', ff0: 2300, q: 2, a: 0.06 });    // fizz
    },
    footstep_grass(t, o) { noise1(t, 0.08, 0.1 * (o.vol || 1), sfxBus, { fType: 'lowpass', ff0: 760 * jit(0.15) }); },
    footstep_stone(t, o) {
      const v = o.vol || 1;
      noise1(t, 0.07, 0.11 * v, sfxBus, { fType: 'bandpass', ff0: 1300 * jit(0.15), q: 1.4 });
      noise1(t, 0.02, 0.04 * v, sfxBus, { fType: 'highpass', ff0: 3200 });
    },
    footstep_sand(t, o) { noise1(t, 0.12, 0.09 * (o.vol || 1), sfxBus, { fType: 'lowpass', ff0: 470 * jit(0.15), a: 0.015 }); },
    footstep_water(t, o) {
      const v = o.vol || 1;
      noise1(t, 0.16, 0.12 * v, sfxBus, { fType: 'bandpass', ff0: 820 * jit(0.15), q: 1, a: 0.01 });
      noise1(t + 0.02, 0.09, 0.045 * v, sfxBus, { fType: 'highpass', ff0: 2600 });
    },
    pickupCoin(t) {
      const j = jit(0.03);
      osc1(t, 0.07, 'sine', 1975 * j, 0, 0.14, sfxBus, { a: 0.002 });
      osc1(t + 0.06, 0.28, 'sine', 2637 * j, 0, 0.14, sfxBus, { a: 0.002, verb: 0.3 });
      osc1(t + 0.06, 0.14, 'sine', 5274 * j, 0, 0.03, sfxBus, { a: 0.002 });
    },
    pickupItem(t) {
      const j = jit(0.03);
      osc1(t, 0.4, 'sine', 660 * j, 990 * j, 0.11, sfxBus, { a: 0.05, verb: 0.5 });
      osc1(t + 0.08, 0.4, 'sine', 990 * j, 1320 * j, 0.05, sfxBus, { a: 0.06, verb: 0.5 });
    },
    chestOpen(t) {
      const j = jit();
      noise1(t, 0.55, 0.13, sfxBus, { fType: 'bandpass', ff0: 170 * j, ff1: 560 * j, q: 6, a: 0.18 });   // creak
      noise1(t + 0.12, 0.4, 0.07, sfxBus, { fType: 'bandpass', ff0: 340 * j, ff1: 700 * j, q: 7, a: 0.1 });
      osc1(t + 0.5, 0.12, 'sine', 110 * j, 58, 0.22, sfxBus, {});                                        // lid thunk
    },
    discover(t) {
      // THE discovery sting: an ascending harp arpeggio (real Karplus-Strong
      // plucks) over a soft Am9 pad swell. Melancholy-beautiful, lots of air.
      const semis = [12, 15, 19, 22, 26, 29, 31, 36];   // A3 C4 E4 G4 B4 D5 E5 A5
      let tt = t;
      for (let i = 0; i < semis.length; i++) {
        const f = 110 * Math.pow(2, semis[i] / 12);
        const v = (i >= semis.length - 2 ? 0.2 : 0.15) * (1 - i * 0.015);
        pluck(tt, f, v, sfxBus, 0.8, true);
        tt += 0.13 - i * 0.004;                          // gentle accelerando
      }
      for (const s of [0, 7, 14]) {                      // A2 E3 B3 pad bed
        osc1(t, 3.2, 'sine', 110 * Math.pow(2, s / 12), 0, 0.045, sfxBus, { a: 0.9, verb: 0.6 });
      }
    },
    questStart(t) {
      const j = jit(0.02);
      osc1(t, 0.4, 'sawtooth', 220 * j, 0, 0.07, sfxBus, { a: 0.06, fType: 'lowpass', ff0: 900, verb: 0.4, detune: -6 });
      osc1(t + 0.32, 0.8, 'sawtooth', 293.7 * j, 0, 0.08, sfxBus, { a: 0.1, fType: 'lowpass', ff0: 1000, verb: 0.5, detune: 6 });
      pluck(t, 220 * j, 0.14, sfxBus, 0.5);
    },
    questDone(t) {
      // Short 3-note brass-ish fanfare: D4 → G4 → B4 (held, swelling).
      const j = jit(0.02);
      const notes = [[293.66, 0, 0.24, 0.09], [392, 0.24, 0.24, 0.1], [493.88, 0.48, 1.0, 0.12]];
      for (const [f, off, dur, v] of notes) {
        osc1(t + off, dur, 'sawtooth', f * j, 0, v, sfxBus, { a: Math.min(0.12, dur * 0.4), fType: 'lowpass', ff0: 1300, verb: 0.5, detune: -5 });
        osc1(t + off, dur, 'sawtooth', f * j * 1.003, 0, v * 0.7, sfxBus, { a: Math.min(0.12, dur * 0.4), fType: 'lowpass', ff0: 1300, detune: 5 });
      }
      osc1(t + 0.48, 0.5, 'sine', 98 * j, 55, 0.2, sfxBus, { a: 0.01, verb: 0.3 });           // timpani under the hold
    },
    levelUp(t) {
      const semis = [24, 27, 31, 36, 39, 43, 48];        // rising A-minor-penta shimmer
      for (let i = 0; i < semis.length; i++) {
        osc1(t + i * 0.07, 0.5, 'sine', 110 * Math.pow(2, semis[i] / 12) * jit(0.01), 0, 0.07, sfxBus, { a: 0.01, verb: 0.55 });
      }
      noise1(t, 0.7, 0.05, sfxBus, { fType: 'highpass', ff0: 2000, ff1: 8000, a: 0.3, verb: 0.4 });
      metal(t + 0.5, 880, [1, 2.0, 2.76], [1, 0.4, 0.25], [0.9, 0.7, 0.5], 0.09, 0.6);
    },
    uiClick(t) {
      noise1(t, 0.03, 0.07, sfxBus, { fType: 'bandpass', ff0: 1800 * jit(0.1), q: 1.5 });
      osc1(t, 0.03, 'sine', 900 * jit(0.05), 0, 0.05, sfxBus, {});
    },
    wheelOpen(t) {
      noise1(t, 0.2, 0.07, sfxBus, { fType: 'bandpass', ff0: 600, ff1: 1900, q: 1.2, a: 0.04 });
      osc1(t + 0.05, 0.06, 'sine', 1200 * jit(0.05), 0, 0.05, sfxBus, {});
    },
    equip(t) {  // soft schwing on weapon switch
      noise1(t, 0.18, 0.08, sfxBus, { fType: 'bandpass', ff0: 1100 * jit(), ff1: 3200, q: 2, a: 0.02 });
    },
    hurt(t) {
      const j = jit();
      osc1(t, 0.18, 'sine', 130 * j, 48, 0.32, sfxBus, {});                                    // dull thump
      osc1(t, 0.16, 'sawtooth', 165 * j, 82, 0.1, sfxBus, { fType: 'bandpass', ff0: 520, q: 2.2 }); // grunt-ish
    },
    death(t) {
      osc1(t, 2.2, 'sine', 70, 27, 0.35, sfxBus, { a: 0.03, verb: 0.4 });
      osc1(t, 2.0, 'sawtooth', 55, 30, 0.12, sfxBus, { a: 0.05, fType: 'lowpass', ff0: 300, ff1: 70, verb: 0.5 });
    },
    kill(t) {  // small accent layered on enemyKilled
      osc1(t, 0.25, 'sine', 90 * jit(), 40, 0.2, sfxBus, { verb: 0.2 });
      pluck(t + 0.05, 110, 0.09, sfxBus, 0.4);
    },
    wolfHowl(t) {
      const j = jit(0.05);
      if (!claim(t, 2.3)) return;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(400 * j, t);
      o.frequency.exponentialRampToValueAtTime(760 * j, t + 0.7);
      o.frequency.setValueAtTime(760 * j, t + 1.25);
      o.frequency.exponentialRampToValueAtTime(470 * j, t + 2.0);
      const lfo = ctx.createOscillator();                 // slow mournful vibrato
      lfo.frequency.value = 5.2;
      const lg = ctx.createGain(); lg.gain.value = 22;
      lfo.connect(lg); lg.connect(o.detune);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 720; f.Q.value = 1;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.09, t + 0.35);
      gn.gain.setValueAtTime(0.09, t + 1.5);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(f); f.connect(gn); gn.connect(sfxBus);
      sendVerb(gn, 0.55);
      o.start(t); o.stop(t + 2.3); lfo.start(t); lfo.stop(t + 2.3);
    },
    skeletonRattle(t) {
      let tt = t;
      for (let i = 0; i < 7; i++) {
        noise1(tt, 0.035, 0.11, sfxBus, { fType: 'bandpass', ff0: 2300 * jit(0.25), q: 3 });
        tt += 0.04 + Math.random() * 0.055;
      }
    },
    goblinCackle(t) {
      let tt = t;
      const f0 = 640 * jit();
      for (let i = 0; i < 5; i++) {
        const f = f0 * (1 - i * 0.09);
        osc1(tt, 0.09, 'sawtooth', f, f * 0.78, 0.09, sfxBus, { a: 0.01, fType: 'bandpass', ff0: 950, q: 3 });
        tt += 0.1 + Math.random() * 0.04;
      }
    },
    drakeRoar(t) {
      // Big layered roar: 3 detuned saws pitch-dropping + AM noise growl + sub.
      const j = jit(0.04);
      for (const det of [-12, 0, 11]) {
        osc1(t, 1.7, 'sawtooth', 150 * j, 62 * j, 0.15, sfxBus, { a: 0.06, fType: 'lowpass', ff0: 900, ff1: 280, q: 0.7, verb: 0.35, detune: det });
      }
      osc1(t, 1.6, 'sine', 70 * j, 33, 0.3, sfxBus, { a: 0.05, verb: 0.2 });
      if (claim(t, 1.6)) {
        const src = ctx.createBufferSource(); src.buffer = noiseWhite; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(720, t);
        f.frequency.exponentialRampToValueAtTime(240, t + 1.6);
        const am = ctx.createGain(); am.gain.value = 0.5;                   // 27 Hz roughness
        const lfo = ctx.createOscillator(); lfo.frequency.value = 27;
        const lg = ctx.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg); lg.connect(am.gain);
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(0.26, t + 0.09);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        src.connect(f); f.connect(am); am.connect(gn); gn.connect(sfxBus);
        sendVerb(gn, 0.3);
        src.start(t, Math.random()); src.stop(t + 1.7); lfo.start(t); lfo.stop(t + 1.7);
      }
    },
    thunder(t) {
      noise1(t, 0.15, 0.2, sfxBus, { fType: 'highpass', ff0: 2600 });                          // crack
      noise1(t + 0.05, 3.0, 0.35, sfxBus, { fType: 'lowpass', ff0: 420, ff1: 55, a: 0.05, verb: 0.4 });
      osc1(t + 0.05, 1.6, 'sine', 46 * jit(), 24, 0.28, sfxBus, { a: 0.03 });
    },
  };

  // ==========================================================================
  // play() — public. Safe no-op before unlock; 30 ms same-name dedupe protects
  // the mix when an event is both auto-wired here and play()ed by its emitter.
  // ==========================================================================
  function play(name, opts) {
    if (!ctx) return;
    const fn = SFX[name];
    if (!fn) return;
    const t = now() + ((opts && opts.delay) || 0);
    const prev = lastPlay.get(name);
    if (prev !== undefined && t - prev < 0.03) return;
    lastPlay.set(name, t);
    try { fn(t, opts || EMPTY); } catch (e) { /* never break the game loop */ }
  }

  // ==========================================================================
  // Reverb: cheap dual feedback delay with lowpass in the loop.
  // ==========================================================================
  function buildReverb() {
    verbIn = ctx.createGain(); verbIn.gain.value = 1;
    const out = ctx.createGain(); out.gain.value = 0.3;
    for (const [dt, fb, lpF] of [[0.257, 0.44, 2600], [0.379, 0.4, 1900]]) {
      const d = ctx.createDelay(1); d.delayTime.value = dt;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpF;
      const fbg = ctx.createGain(); fbg.gain.value = fb;
      verbIn.connect(d); d.connect(lp); lp.connect(fbg); fbg.connect(d); lp.connect(out);
    }
    out.connect(comp);
  }

  // ==========================================================================
  // Generative music — lookahead scheduler (setInterval, NOT per-frame).
  // Seeded: same world, same song. Signature instrument: the KS lute.
  // ==========================================================================
  const M = {
    step: 0,
    nextT: 0,
    stepDur: 60 / 110 / 2,                 // 8th notes at 110 bpm (~0.273 s)
    chordIdx: 0,
    melIdx: 5,
    rng: makeRng((WORLD_SEED ^ 0x51ed2701) >>> 0),
    timer: 0,
  };
  const nfreq = (s) => 110 * Math.pow(2, s / 12);          // semitones above A2
  // Warm melancholy day: Am — F — C — G (low, open voicings)
  const DAY_CH = [[0, 7, 12, 15], [-4, 3, 8, 12], [3, 10, 15, 19], [-2, 5, 10, 14]];
  // Darker night: Am — Em — Dm — F (lower, more hollow)
  const NIGHT_CH = [[0, 7, 12, 15], [-5, 2, 7, 10], [-7, 0, 5, 8], [-4, 3, 8, 12]];
  // A minor pentatonic pool for lute phrases (fits every chord above)
  const PENTA = [12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];

  function buildMusic() {
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(comp);
    // pads (everything low-passed — nothing beepy ever leaves this bus)
    padGain = ctx.createGain(); padGain.gain.value = 1; padGain.connect(musicBus);
    padLP = ctx.createBiquadFilter(); padLP.type = 'lowpass'; padLP.frequency.value = 780; padLP.Q.value = 0.5;
    padLP.connect(padGain);
    sendVerb(padGain, 0.22);
    // lute
    luteGain = ctx.createGain(); luteGain.gain.value = 1;
    luteLP = ctx.createBiquadFilter(); luteLP.type = 'lowpass'; luteLP.frequency.value = 2300; luteLP.Q.value = 0.4;
    luteGain.connect(luteLP); luteLP.connect(musicBus);
    sendVerb(luteLP, 0.45);
    // combat layer: percussion bus + dark drone, faded in/out on combatState
    combatGain = ctx.createGain(); combatGain.gain.value = 0; combatGain.connect(musicBus);
    combatPerc = ctx.createGain(); combatPerc.gain.value = 0.9; combatPerc.connect(combatGain);
    {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.7;
      const dg = ctx.createGain(); dg.gain.value = 0.4;
      lp.connect(dg); dg.connect(combatGain);
      for (const [f, det] of [[55, 0], [55.4, 0], [110.3, -7]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(lp); o.start();
      }
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.45;      // slow menace swell
      const lg = ctx.createGain(); lg.gain.value = 0.13;
      lfo.connect(lg); lg.connect(dg.gain); lfo.start();
    }
    // boss urgency layer: tremolo high drone + extra percussion bus
    bossGain = ctx.createGain(); bossGain.gain.value = 0; bossGain.connect(musicBus);
    bossPerc = ctx.createGain(); bossPerc.gain.value = 0.8; bossPerc.connect(bossGain);
    {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 880;
      const trem = ctx.createGain(); trem.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6.3;
      const lg = ctx.createGain(); lg.gain.value = 0.45;
      lfo.connect(lg); lg.connect(trem.gain); lfo.start();
      const dg = ctx.createGain(); dg.gain.value = 0.16;
      lp.connect(trem); trem.connect(dg); dg.connect(bossGain);
      for (const [f, det] of [[220, -8], [221.7, 9]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(lp); o.start();
      }
    }
    M.nextT = now() + 0.15;
    M.timer = setInterval(scheduleMusic, 200);             // lookahead pump
    applyCombatState();                                     // honor pre-unlock events
    applyBossState();
  }

  function applyCombatState() {
    if (!ctx) return;
    const t = now();
    combatGain.gain.cancelScheduledValues(t);
    padGain.gain.cancelScheduledValues(t);
    if (combatOn) {
      combatGain.gain.setTargetAtTime(0.85, t, 0.3);        // in over ~1 s
      padGain.gain.setTargetAtTime(0.5, t, 0.5);            // pads duck under drums
    } else {
      combatGain.gain.setTargetAtTime(0.0001, t, 1.6);      // out over ~5 s
      padGain.gain.setTargetAtTime(1, t, 2);
    }
  }
  function applyBossState() {
    if (!ctx) return;
    const t = now();
    bossGain.gain.cancelScheduledValues(t);
    bossGain.gain.setTargetAtTime(bossOn ? 0.75 : 0.0001, t, bossOn ? 0.4 : 1.4);
  }

  function scheduleMusic() {
    if (!ctx) return;
    const horizon = now() + 0.9;
    if (M.nextT < now() - 1) M.nextT = now() + 0.1;          // tab-hidden gap: resync
    while (M.nextT < horizon) {
      scheduleStep(M.step, M.nextT);
      M.step++;
      M.nextT += M.stepDur;
    }
  }

  function scheduleStep(step, t) {
    if (step % 32 === 0) beginChord(t);                      // ~8.7 s harmonic rhythm
    // Combat percussion only exists while the layer is (fading) audible.
    const combatLive = combatOn || combatGain.gain.value > 0.02;
    if (combatLive) {
      const s8 = step % 8;
      if (step % 4 === 0) drumKick(t, 0.5, combatPerc);
      if (s8 === 2 || s8 === 6) drumTap(t, 0.16, 900, combatPerc);
      if (s8 === 7 && M.rng() < 0.3) drumKick(t + M.stepDur * 0.5, 0.24, combatPerc);
      if (bossOn || bossGain.gain.value > 0.02) {
        if (step % 2 === 1) drumTap(t, 0.2, 1500, bossPerc); // driving off-beats
        if (s8 === 4) drumKick(t, 0.42, bossPerc);
        if (step % 32 === 24) osc1(t, 2.0, 'sine', 65, 40, 0.16, bossPerc, { a: 0.4 }); // dread swell
      }
    }
  }

  function beginChord(t) {
    const night = dayness < 0.5;
    const table = night ? NIGHT_CH : DAY_CH;
    const ch = table[M.chordIdx % table.length];
    M.chordIdx++;
    const dur = 32 * M.stepDur;
    // Night sometimes rests the pad entirely — more air, more dark.
    if (!(night && M.rng() < 0.25)) padChord(ch, t, dur, night);
    // Sparse lute phrases; long silences are part of the music.
    const chance = night ? 0.22 : 0.45;
    if (M.rng() < chance) schedulePhrase(t, dur, night);
  }

  function padChord(semis, t, dur, night) {
    const peak = night ? 0.038 : 0.05;
    const atk = 2.6, rel = 3.2;
    for (let i = 0; i < semis.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = nfreq(semis[i]);
      o.detune.value = (i % 2 ? 4 : -4);
      const gn = ctx.createGain();
      const v = peak * (i === 0 ? 1.15 : 0.8);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(v, t + atk);
      gn.gain.setValueAtTime(v, t + dur);
      gn.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
      o.connect(gn); gn.connect(padLP);
      o.start(t); o.stop(t + dur + rel + 0.1);
    }
    const sub = ctx.createOscillator();                      // sine root an octave down
    sub.type = 'sine';
    sub.frequency.value = nfreq(semis[0] - 12);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(peak * 1.2, t + atk);
    sg.gain.setValueAtTime(peak * 1.2, t + dur);
    sg.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
    sub.connect(sg); sg.connect(padLP);
    sub.start(t); sub.stop(t + dur + rel + 0.1);
  }

  function schedulePhrase(t0, dur, night) {
    const n = 3 + ((M.rng() * 5) | 0);
    let idx = clamp(M.melIdx + ((M.rng() * 3) | 0) - 1, 0, PENTA.length - 1);
    let st = t0 + M.stepDur * (2 + ((M.rng() * 8) | 0));
    const oct = night ? -12 : 0;
    for (let i = 0; i < n; i++) {
      const move = M.rng() < 0.65 ? (M.rng() < 0.5 ? -1 : 1) : ((M.rng() * 4) | 0) - 2;
      idx = clamp(idx + move, 0, PENTA.length - 1);
      const vol = 0.1 + M.rng() * 0.08;
      pluck(st, nfreq(PENTA[idx] + oct), vol, luteGain, 0);
      if (M.rng() < 0.15 && idx >= 2) {                      // occasional soft dyad
        pluck(st + 0.02, nfreq(PENTA[idx - 2] + oct), vol * 0.55, luteGain, 0);
      }
      st += M.stepDur * (2 + ((M.rng() * 3) | 0));
      if (st > t0 + dur - 1) break;
    }
    M.melIdx = idx;
  }

  function drumKick(t, vol, dest) {
    osc1(t, 0.3, 'sine', 120, 40, vol, dest, { a: 0.004 });
    noise1(t, 0.03, vol * 0.35, dest, { fType: 'lowpass', ff0: 2400 });
  }
  function drumTap(t, vol, f, dest) {
    noise1(t, 0.09, vol, dest, { fType: 'bandpass', ff0: f * jit(0.15), q: 1.3 });
  }

  // ==========================================================================
  // Ambient bed — persistent looped nodes, re-targeted every 0.25 s.
  // ==========================================================================
  function buildAmbience() {
    ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(comp);
    // Wind: looped pink noise → lowpass; altitude opens volume + brightness.
    {
      const src = ctx.createBufferSource(); src.buffer = noisePink; src.loop = true;
      windLP = ctx.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 420; windLP.Q.value = 0.5;
      windGain = ctx.createGain(); windGain.gain.value = 0;
      src.connect(windLP); windLP.connect(windGain); windGain.connect(ambBus);
      src.start();
    }
    // Night crickets: narrow-band triangle pulsed ~11 Hz.
    {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 4300;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 8;
      const am = ctx.createGain(); am.gain.value = 0.55;
      cricketLfo = ctx.createOscillator(); cricketLfo.frequency.value = 11.3;
      const lg = ctx.createGain(); lg.gain.value = 0.45;
      cricketLfo.connect(lg); lg.connect(am.gain);
      cricketGain = ctx.createGain(); cricketGain.gain.value = 0;
      o.connect(bp); bp.connect(am); am.connect(cricketGain); cricketGain.connect(ambBus);
      o.start(); cricketLfo.start();
    }
    // Water lap: looped noise, slow 0.33 Hz amplitude wash.
    {
      const src = ctx.createBufferSource(); src.buffer = noiseWhite; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 460;
      const am = ctx.createGain(); am.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.33;
      const lg = ctx.createGain(); lg.gain.value = 0.38;
      lfo.connect(lg); lg.connect(am.gain);
      lapGain = ctx.createGain(); lapGain.gain.value = 0;
      src.connect(lp); lp.connect(am); am.connect(lapGain); lapGain.connect(ambBus);
      src.start(0, 0.4); lfo.start();
    }
    // Ruins shimmer: detuned sine cluster, slow beating, heavy reverb — eerie.
    {
      shimGain = ctx.createGain(); shimGain.gain.value = 0;
      shimGain.connect(ambBus);
      sendVerb(shimGain, 0.7);
      for (const [f, v] of [[523.3, 1], [526.9, 0.7], [786.5, 0.35]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const gg = ctx.createGain(); gg.gain.value = v;
        o.connect(gg); gg.connect(shimGain); o.start();
        if (v === 0.7) {                                    // slow detune drift on one voice
          const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
          const lg = ctx.createGain(); lg.gain.value = 14;
          lfo.connect(lg); lg.connect(o.detune); lfo.start();
        }
      }
    }
  }

  function birdChirp(t) {
    const n = 2 + ((Math.random() * 3) | 0);
    const f0 = 2800 + Math.random() * 1600;
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = f0 * (1 + Math.random() * 0.25);
      osc1(tt, 0.09, 'sine', f, f * 0.72, 0.03 + Math.random() * 0.02, ambBus, { a: 0.01, verb: 0.35 });
      tt += 0.1 + Math.random() * 0.1;
    }
  }

  function updateAmbience() {
    const t = now();
    const df = g.time.dayFrac;
    const elev = Math.sin((df - 0.25) * Math.PI * 2);        // -1 midnight … +1 noon
    dayness = clamp(elev * 3 + 0.5, 0, 1);
    nightness = clamp(-elev * 3 + 0.5, 0, 1);

    const p = g.player;
    const px = p ? p.position.x : 0;
    const pz = p ? p.position.z : 0;
    const py = p ? p.position.y : 8;

    // Wind: altitude-scaled + a little wilder at night, with slow noise gusts.
    const alt = clamp((py - 8) / 130, 0, 1);
    const gust = snoise(g.time.elapsed * 0.07, 3.7) * 0.5 + 0.5;
    windGain.gain.setTargetAtTime(0.05 + alt * 0.22 + nightness * 0.04 + gust * 0.04, t, 0.6);
    windLP.frequency.setTargetAtTime(360 + alt * 1500 + gust * 260, t, 0.9);

    const biome = p ? biomeAt(px, pz) : BIOME.MEADOW;
    const grassy = biome === BIOME.FOREST || biome === BIOME.MEADOW || biome === BIOME.MARSH;

    // Day birds in forest / meadow, every 4–12 s.
    if (dayness > 0.6 && (biome === BIOME.FOREST || biome === BIOME.MEADOW)) {
      if (t > nextBirdAt) {
        birdChirp(t + Math.random() * 0.2);
        nextBirdAt = t + 4 + Math.random() * 8;
      }
    } else if (nextBirdAt < t + 2) {
      nextBirdAt = t + 2;                                    // don't chirp instantly on re-entry
    }

    // Night crickets in grassy biomes.
    cricketGain.gain.setTargetAtTime(nightness * (grassy ? 0.045 : 0.012), t, 0.8);
    cricketLfo.frequency.setTargetAtTime(10.5 + snoise(g.time.elapsed * 0.11, 9.1) * 2, t, 0.5);

    // Water lap when the player is down near the waterline.
    const nearWater = clamp(((WATER_LEVEL + 4) - py) / 4, 0, 1);
    lapGain.gain.setTargetAtTime(nearWater * 0.13, t, 0.5);

    // Eerie shimmer near Barrowdeep Ruins (stronger at night).
    const dRuins = dist2d(px, pz, POI.ruins.x, POI.ruins.z);
    const shim = clamp((115 - dRuins) / 75, 0, 1) * (0.55 + 0.45 * nightness);
    shimGain.gain.setTargetAtTime(shim * 0.045, t, 1.0);
  }

  // ==========================================================================
  // unlock() — lazy AudioContext creation on first user gesture. Idempotent.
  // ==========================================================================
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    if (ctx.state === 'suspended') ctx.resume();

    // Master chain: compressor → gain(0.8) → speakers.
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;
    comp.connect(masterGain);
    masterGain.connect(ctx.destination);

    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(comp);
    buildReverb();

    // Pre-rendered noise buffers (seeded — cheap and deterministic).
    const nrng = makeRng((WORLD_SEED ^ 0xabad1dea) >>> 0);
    {
      const sr = ctx.sampleRate;
      noiseWhite = ctx.createBuffer(1, (sr * 1.5) | 0, sr);
      const w = noiseWhite.getChannelData(0);
      for (let i = 0; i < w.length; i++) w[i] = nrng() * 2 - 1;
      noisePink = ctx.createBuffer(1, (sr * 2) | 0, sr);
      const pk = noisePink.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < pk.length; i++) {                  // Paul Kellet pink filter
        const wh = nrng() * 2 - 1;
        b0 = 0.99886 * b0 + wh * 0.0555179;
        b1 = 0.99332 * b1 + wh * 0.0750759;
        b2 = 0.969 * b2 + wh * 0.153852;
        b3 = 0.8665 * b3 + wh * 0.3104856;
        b4 = 0.55 * b4 + wh * 0.5329522;
        b5 = -0.7616 * b5 - wh * 0.016898;
        pk[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wh * 0.5362) * 0.11;
        b6 = wh * 0.115926;
      }
    }

    // Karplus-Strong string banks: warm lute (3 base pitches) + bright harp.
    const krng = makeRng((WORLD_SEED ^ 0x0badcafe) >>> 0);
    luteBases = [
      [110, renderKS(110, 2.4, 0.9962, 0.5, krng)],
      [220, renderKS(220, 2.0, 0.996, 0.55, krng)],
      [440, renderKS(440, 1.6, 0.9955, 0.6, krng)],
    ];
    harpBase = [440, renderKS(440, 2.6, 0.999, 0.88, krng)];

    buildAmbience();
    buildMusic();
    ambAcc = 1;                                              // ambience targets on next update
  }

  // ==========================================================================
  // update(dt) — only throttled ambience retargeting lives here.
  // Music runs on its own lookahead timer; SFX are event-driven.
  // ==========================================================================
  function update(dt) {
    if (!ctx) return;
    ambAcc += g.time.rawDt || dt;
    if (ambAcc < 0.25) return;
    ambAcc = 0;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    updateAmbience();
  }

  // ==========================================================================
  // Auto-wire contract events → SFX (all safe pre-unlock: play() no-ops).
  // ==========================================================================
  const E = g.events;
  E.on('attackSwing', (d) => play(d && d.heavy ? 'swingHeavy' : 'swing'));
  E.on('hitLanded', (d) => play('hitFlesh', { heavy: !!(d && d.heavy), kill: !!(d && d.kill) }));
  E.on('parry', () => play('parry'));
  E.on('enemyKilled', () => play('kill'));
  E.on('playerDamaged', () => play('hurt'));
  E.on('playerDied', () => play('death'));
  E.on('pickup', (d) => play(d && d.kind === 'gold' ? 'pickupCoin' : 'pickupItem'));
  E.on('discover', () => play('discover'));
  E.on('questStarted', () => play('questStart'));
  E.on('questCompleted', () => play('questDone'));
  E.on('levelUp', () => play('levelUp'));
  E.on('equip', () => play('equip'));
  E.on('chestOpened', () => play('chestOpen'));
  E.on('footstep', (d) => {
    const s = d && d.surface;
    play('footstep_' + (s === 'stone' || s === 'sand' || s === 'water' ? s : 'grass'));
  });
  // Music state (remembered even pre-unlock; applied when the ctx exists).
  E.on('combatState', (d) => {
    const on = !!(d && d.inCombat);
    if (on === combatOn) return;
    combatOn = on;
    applyCombatState();
  });
  E.on('bossBar', (d) => {
    const on = !!d;                 // emitted repeatedly while near the boss
    if (on === bossOn) return;
    bossOn = on;
    applyBossState();
  });

  return { update, play, unlock };
}

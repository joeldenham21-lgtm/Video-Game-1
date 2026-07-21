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
//
// Wave 4 (NEXT-LEVEL) additions — the mix stays restrained, silence is golden:
// - LOCATION THEMES: village / ruins / lake / mountains motif + voicing
//   variation. Region polled every 2 s; on change the whole melodic bed
//   (pads + lute) crossfades over 6 s via two A/B "deck" gain nodes.
// - COMBAT TIERS: tier 1 = existing drums + drone. Tier 2 (≥3 aggroed or an
//   aggroed elite) adds a syncopated second drum + tremolo string. Boss tier
//   (bossBar active) adds a slow detuned choir-ish pad (formant filters) and
//   deeper scheduled hits. All crossfade cleanly both ways.
// - FIDDLE: bowed-string lead (sawtooth → bandpass, slow vibrato, bow-noise
//   attack) trading sparse phrases with the lute by day (≤1 per 20–40 s).
// - setRain(level): filtered-pink-noise rain bed + distant intermittent
//   rumble above level 0.7. Exposed on the returned api (weather.js calls it
//   lazily). debug() exposes gain values for automated verification.
//
// Wave 5 (DREAD) — the fear layer. Uneasy, never deafening:
// - NEW SFX (all in the play() registry): 'whisper' (breathy sibilant swells,
//   Pale Rider), 'dread_drone' (one-shot 28–35 Hz beating sub swell),
//   'gloom_roar' (layered roar bigger than drakeRoar: pitched-down saws +
//   AM growl + metal partials + long cavern wash), 'skitter' (chitinous tick
//   cluster — ONE voice slot via a gated envelope chain), 'horn_distant'
//   (lone far-off horn: triangle+saw through a formant bandpass, long verb,
//   breath sag), 'stone_groan' (deep grinding for crypt doors / the titan).
// - AMBIENT WIRING (rides the 0.25 s ambience throttle, everything guarded):
//   dread-drone BED (persistent 31/31.4/62 Hz sines) fades in within 40 u of
//   the crypt/cemetery at night — felt more than heard; a whisper every
//   8–20 s only while the Pale Rider stalks within 45 u; skitters near the
//   spider den (-460, -240) inside 50 u; the homecoming horn ONCE as dusk
//   falls (dayFrac crossing 0.78) on ~30 % of days, panned toward the
//   village; Undergloom bossBar → the boss choir stands down and the dread
//   drone + a restrained 2-note minor-2nd doom motif (A1 → Bb1) take over.
//
// Wave 6 (ACOUSTICS) — ray-driven spatial audio via ./acoustics.js (built at
// unlock, sharing THIS AudioContext; fully feature-detected and inert on
// failure, mobile keeps cheap stereo panning):
// - play(name, {at:{x,y,z}}) routes the one-shot through a pooled HRTF panner
//   (desktop) with ray occlusion (terrain + g.colliders → lowpass + gain dip),
//   air absorption, 4 convolver reverb zones (field/forest/village/crypt,
//   crossfaded by player location) and 6-ray early reflections. Without
//   opts.at the legacy stereo path is byte-for-byte unchanged.
// - Wired here: enemyKilled → 'kill' at the corpse, hitLanded → 'hitFlesh'
//   at the wound (ranged hits — melee dedupes against combat's direct call),
//   spawnLoot → positional coin/item chime where the loot lands.
// - The legacy generative music defers while the film score is active
//   (g.score + g.flags.scoreActive — a composer agent owns g.score).
// ============================================================================

import {
  makeRng, WORLD_SEED, WATER_LEVEL, POI, BIOME, biomeAt,
  clamp, lerp, dist2d, snoise,
} from './core.js';
import { createAcoustics } from './acoustics.js';

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
  // wave-4 music nodes
  let decks = null, deckIdx = 0;               // A/B region-crossfade decks
  let xfAt = 0;                                // deck crossfade start (ctx time)
  const xfSnap = { op: 1, ol: 1, np: 0, nl: 0 }; // gain snapshot at fade start
  let droneGain = null;                        // ruins low drone layer
  let tier2Gain = null, tier2Perc = null;      // combat tier 2 layer
  let choirGain = null;                        // boss choir-ish pad
  let fiddleGain = null;                       // bowed-string lead bus
  // ambience persistent nodes
  let windGain = null, windLP = null;
  let cricketGain = null, cricketLfo = null;
  let lapGain = null, shimGain = null;
  let rainGain = null, rainLP = null;          // wave-4 rain bed
  let dreadGain = null;                        // wave-5 dread-drone bed (crypt / Undergloom)
  let gloomMotifGain = null;                   // wave-5 Undergloom doom-motif bus
  let AC = null;                               // wave-6 acoustics engine (./acoustics.js)

  // ---- bookkeeping ---------------------------------------------------------
  const MAX_VOICES = 16;
  let activeVoices = 0;
  const lastPlay = new Map();  // sfx name → last scheduled time (dedupe 30ms)
  let ambAcc = 0;              // ambience throttle accumulator
  let lastPollAt = 0;          // region poll clock (ctx time — every 2 s wall)
  let lastTierAt = 0;          // combat-tier check clock (every 0.3 s wall)
  let nextBirdAt = 0;
  let dayness = 0.7, nightness = 0.3;
  let combatOn = false, bossOn = false, tier2On = false;
  let rainLevel = 0;           // wave-4: set via setRain(), remembered pre-unlock
  let nextRumbleAt = 0;        // distant storm rumble scheduler
  let fiddleNextAt = 0;        // next time the fiddle may take a phrase
  let fiddleCount = 0;         // notes played (debug/verification)
  // wave-5 dread bookkeeping
  let undergloomOn = false;    // bossBar name matched /undergloom/i
  let nextWhisperAt = 0;       // Pale Rider whisper scheduler
  let nextSkitterAt = 0;       // spider-den skitter scheduler
  let prevDayFrac = -1;        // dusk-crossing detector for the horn
  let whisperCount = 0, skitterCount = 0, hornCount = 0;  // debug/verification
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
    // ---- wave-5 DREAD -------------------------------------------------------
    whisper(t) {
      // Breathy sibilant swells — more breath than voice, and deliberately
      // quiet. 2–3 narrow-band noise swells drifting in pitch, each tipped
      // with a faint 'sss' consonant. The Pale Rider's calling card.
      const j = jit(0.1);
      const n = 2 + ((Math.random() * 2) | 0);
      let tt = t;
      for (let i = 0; i < n; i++) {
        const f = (1900 + Math.random() * 1400) * j;
        const dur = 0.5 + Math.random() * 0.5;
        noise1(tt, dur, 0.028 + Math.random() * 0.012, sfxBus, {
          fType: 'bandpass', ff0: f, ff1: f * (Math.random() < 0.5 ? 0.62 : 1.5),
          q: 6.5, a: dur * 0.45, verb: 0.5,
        });
        if (Math.random() < 0.7) {                          // sibilant tip
          noise1(tt + dur * 0.15, 0.09, 0.013, sfxBus, { fType: 'highpass', ff0: 5200, a: 0.02, verb: 0.3 });
        }
        tt += dur * (0.55 + Math.random() * 0.4);
      }
      whisperCount++;
    },
    dread_drone(t, o) {
      // One-shot sub-bass pressure swell: a 28–35 Hz sine pair beating slowly,
      // plus a faint octave so small speakers register *something*. (The
      // persistent crypt/Undergloom BED lives in buildAmbience — this is the
      // registry version so anything can play() a moment of dread by name.)
      const v = (o && o.vol) || 1;
      const f = 29 + Math.random() * 5;                     // 29–34 Hz
      osc1(t, 4.5, 'sine', f, 0, 0.3 * v, sfxBus, { a: 1.6 });
      osc1(t, 4.5, 'sine', f + 0.35, 0, 0.24 * v, sfxBus, { a: 1.9 });
      osc1(t, 4.0, 'sine', f * 2 + 0.2, 0, 0.04 * v, sfxBus, { a: 1.6, verb: 0.4 });
    },
    gloom_roar(t) {
      // The Undergloom's voice — bigger, lower and longer than drakeRoar:
      // pitched-down saw cluster + deep AM noise growl + inharmonic metal
      // partials, all soaked in a long cavern wash.
      const j = jit(0.03);
      for (const det of [-16, -4, 9]) {                     // saw cluster, dropping
        osc1(t, 2.6, 'sawtooth', 96 * j, 34 * j, 0.16, sfxBus, { a: 0.1, fType: 'lowpass', ff0: 640, ff1: 160, q: 0.7, verb: 0.5, detune: det });
      }
      osc1(t, 2.5, 'sine', 52 * j, 24, 0.34, sfxBus, { a: 0.08, verb: 0.25 });                 // sub floor
      if (claim(t, 2.6)) {                                  // 19 Hz AM growl
        const src = ctx.createBufferSource(); src.buffer = noiseWhite; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(520, t);
        f.frequency.exponentialRampToValueAtTime(140, t + 2.6);
        const am = ctx.createGain(); am.gain.value = 0.5;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 19;
        const lg = ctx.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg); lg.connect(am.gain);
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(0.3, t + 0.14);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        src.connect(f); f.connect(am); am.connect(gn); gn.connect(sfxBus);
        sendVerb(gn, 0.5);
        src.start(t, Math.random()); src.stop(t + 2.7); lfo.start(t); lfo.stop(t + 2.7);
      }
      metal(t + 0.1, 87 * j, [1, 2.31, 3.97], [1, 0.5, 0.28], [1.4, 1.1, 0.8], 0.1, 0.7);      // vast metal underbelly
      noise1(t + 0.4, 3.4, 0.07, sfxBus, { fType: 'lowpass', ff0: 300, ff1: 45, a: 0.5, verb: 0.7 }); // cavern wash tail
    },
    skitter(t, o) {
      // Rapid chitinous tick cluster. ONE voice slot: a single looped-noise
      // source gated by a scheduled envelope chain (8–13 ticks ≠ 13 voices),
      // with the bandpass hopping per tick so no two ticks match.
      const v = 0.09 * ((o && o.vol) || 1);
      const nTicks = 8 + ((Math.random() * 6) | 0);
      const maxDur = nTicks * 0.08 + 0.1;
      if (!claim(t, maxDur)) return;
      const src = ctx.createBufferSource(); src.buffer = noiseWhite; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.5;
      bp.frequency.setValueAtTime(3400, t);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      let tt = t;
      for (let i = 0; i < nTicks; i++) {
        bp.frequency.setValueAtTime(2600 + Math.random() * 2600, tt);
        gn.gain.setValueAtTime(0.0001, tt);
        gn.gain.linearRampToValueAtTime(v * (0.6 + Math.random() * 0.4), tt + 0.004);
        gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.02 + Math.random() * 0.012);
        tt += 0.028 + Math.random() * 0.05;
      }
      src.connect(bp); bp.connect(gn); gn.connect(sfxBus);
      sendVerb(gn, 0.15);
      src.start(t, Math.random()); src.stop(tt + 0.06);
      skitterCount++;
    },
    horn_distant(t, o) {
      // A lone horn far across the fields — the homecoming call. Triangle+saw
      // blend through a formant-ish bandpass (horn bell), mostly reverb at
      // this distance, the pitch sagging at the end as the breath gives out.
      const dur = 3.4;
      if (!claim(t, dur + 0.4)) return;
      const j = jit(0.015);
      const f0 = 174.6 * j;                                 // F3 — noble, low
      const f1 = f0 * 1.5;                                  // lift a fifth, hold
      const vol = 0.06 * ((o && o.vol) || 1);
      const mix = ctx.createGain(); mix.gain.value = 1;
      for (const [type, v] of [['triangle', 1], ['sawtooth', 0.35]]) {
        const os = ctx.createOscillator(); os.type = type;
        os.frequency.setValueAtTime(f0, t);
        os.frequency.setValueAtTime(f0, t + 0.85);
        os.frequency.exponentialRampToValueAtTime(f1, t + 1.05);
        os.frequency.setValueAtTime(f1, t + 2.2);
        os.frequency.exponentialRampToValueAtTime(f1 * 0.972, t + dur);  // breath sag
        const og = ctx.createGain(); og.gain.value = v;
        os.connect(og); og.connect(mix);
        os.start(t); os.stop(t + dur + 0.2);
      }
      const formant = ctx.createBiquadFilter(); formant.type = 'bandpass';
      formant.frequency.value = 520; formant.Q.value = 1.1;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.4;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(vol, t + 0.5);
      gn.gain.linearRampToValueAtTime(vol * 1.15, t + 1.2); // swell on the lift
      gn.gain.setValueAtTime(vol * 1.15, t + 2.3);
      gn.gain.linearRampToValueAtTime(0.0001, t + dur);
      mix.connect(formant); formant.connect(lp); lp.connect(gn);
      let out = gn;
      if (o && o.pan && ctx.createStereoPanner) {           // from the village direction
        const pn = ctx.createStereoPanner();
        pn.pan.value = clamp(o.pan, -1, 1);
        gn.connect(pn); out = pn;
      }
      out.connect(sfxBus);
      sendVerb(out, 0.85);                                  // far away = mostly verb
      hornCount++;
    },
    stone_groan(t, o) {
      // Deep stone grinding — crypt slabs, titan joints. Looped noise through
      // a low sweeping bandpass with irregular AM judder, over a sub saw and
      // capped with a settling thud.
      const j = jit(0.08);
      const v = (o && o.vol) || 1;
      const dur = 2.4 + Math.random() * 0.8;
      if (claim(t, dur)) {
        const src = ctx.createBufferSource(); src.buffer = noiseWhite; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4;
        bp.frequency.setValueAtTime(90 * j, t);
        bp.frequency.exponentialRampToValueAtTime(150 * j, t + dur * 0.6);
        bp.frequency.exponentialRampToValueAtTime(70 * j, t + dur);
        const am = ctx.createGain(); am.gain.value = 0.7;   // grinding judder
        const lfo = ctx.createOscillator(); lfo.frequency.value = 1.3 + Math.random();
        const lg = ctx.createGain(); lg.gain.value = 0.3;
        lfo.connect(lg); lg.connect(am.gain);
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(0.5 * v, t + 0.3);
        gn.gain.setValueAtTime(0.5 * v, t + dur * 0.75);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp); bp.connect(am); am.connect(gn); gn.connect(sfxBus);
        sendVerb(gn, 0.5);
        src.start(t, Math.random()); src.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur);
      }
      osc1(t, dur, 'sawtooth', 38 * j, 30, 0.16 * v, sfxBus, { a: 0.25, fType: 'lowpass', ff0: 130, verb: 0.35 }); // sub weight
      noise1(t + dur * 0.3, 0.35, 0.08 * v, sfxBus, { fType: 'bandpass', ff0: 480 * j, q: 2, a: 0.05 });           // grit catch
      osc1(t + dur - 0.35, 0.5, 'sine', 55 * j, 30, 0.22 * v, sfxBus, { a: 0.01, verb: 0.3 });                     // settle thud
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
    nextChordStep: 0,                      // region-aware harmonic rhythm
    forceChord: false,                     // set on region change → fresh chord
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

  // ---- wave-4 location themes ----------------------------------------------
  // Village: warmer, major-leaning — C — G — Am — F, full voicings.
  const VILLAGE_DAY = [[3, 10, 15, 19], [10, 14, 17, 22], [0, 7, 12, 15], [8, 12, 15, 20]];
  // Ruins / cemetery: sparse minor with the b3 spoken aloud — Am — Em — Dm — Em.
  const RUINS_CH = [[0, 3, 7, 12], [-5, -2, 2, 7], [-7, -4, 0, 5], [-5, -2, 2, 7]];
  // Lake: airy suspended voicings, no thirds at all — Asus2 — Gsus2 — Fsus2 — Csus2.
  const LAKE_CH = [[0, 7, 14, 19], [-2, 5, 12, 17], [-4, 3, 10, 15], [3, 10, 17, 22]];
  // Mountains: nothing but open fifths and octaves — A5 — G5 — F5 — E5.
  const MTN_CH = [[0, 7, 12, 19], [-2, 5, 10, 17], [-4, 3, 8, 15], [-5, 2, 7, 14]];
  // Melodic pools per theme
  const MAJ_POOL = [12, 15, 17, 19, 22, 24, 26, 27, 29, 31];  // adds B — major-7 color
  const MINOR_POOL = [0, 3, 5, 7, 10, 12, 15, 17];            // low, dark, with b3
  const SUS_POOL = [12, 14, 17, 19, 22, 24, 26];              // 2nds and 4ths — airy
  const FIFTH_POOL = [0, 5, 7, 12, 17, 19, 24];               // fourths and fifths only
  // Region spec: chord tables (day/night), rest odds, phrase odds, lute/pad
  // filter targets, phrase octave bias and pacing. 'wilds' = original song.
  const REGIONS = {
    wilds:     { day: DAY_CH, night: NIGHT_CH, pool: PENTA, chordSteps: 32,
                 rest: 0, nrest: 0.25, phrase: 0.45, nphrase: 0.22,
                 luteF: 2300, padF: 780, oct: 0, pace: 1 },
    village:   { day: VILLAGE_DAY, night: DAY_CH, pool: MAJ_POOL, chordSteps: 32,
                 rest: 0, nrest: 0.2, phrase: 0.55, nphrase: 0.28,
                 luteF: 2650, padF: 920, oct: 0, pace: 1 },
    ruins:     { day: RUINS_CH, night: RUINS_CH, pool: MINOR_POOL, chordSteps: 40,
                 rest: 0.2, nrest: 0.4, phrase: 0.22, nphrase: 0.12,
                 luteF: 1650, padF: 580, oct: 0, pace: 1.25 },
    lake:      { day: LAKE_CH, night: LAKE_CH, pool: SUS_POOL, chordSteps: 48,
                 rest: 0.1, nrest: 0.3, phrase: 0.3, nphrase: 0.16,
                 luteF: 2050, padF: 700, oct: 0, pace: 1.6 },
    mountains: { day: MTN_CH, night: MTN_CH, pool: FIFTH_POOL, chordSteps: 40,
                 rest: 0.08, nrest: 0.3, phrase: 0.3, nphrase: 0.16,
                 luteF: 2400, padF: 840, oct: 0, pace: 1.2 },
  };
  let currentRegion = 'village';               // player spawns in Emberhollow
  let REG = REGIONS.village;

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
    // wave-4: A/B decks — all scheduled pads/plucks route through the active
    // deck; a region change swaps decks and crossfades them over 6 s (driven
    // per-frame by updateDeckFade — direct .value writes, no param automation)
    // so the old theme's still-sounding chords genuinely fade under the new.
    decks = [0, 1].map((i) => {
      const pad = ctx.createGain(); pad.gain.value = i === 0 ? 1 : 0; pad.connect(padLP);
      const lute = ctx.createGain(); lute.gain.value = i === 0 ? 1 : 0; lute.connect(luteGain);
      return { pad, lute };
    });
    luteLP.frequency.value = REG.luteF;                    // boot voicing = boot region
    padLP.frequency.value = REG.padF;
    // wave-4: ruins low drone — beating A1 sines + a whisper of filtered saw.
    // Lives outside the decks; its gain IS the region crossfade for ruins.
    {
      droneGain = ctx.createGain(); droneGain.gain.value = 0; droneGain.connect(musicBus);
      sendVerb(droneGain, 0.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.6;
      lp.connect(droneGain);
      for (const [type, f, v] of [['sine', 55, 0.5], ['sine', 55.4, 0.4], ['sawtooth', 110.2, 0.12]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = v;
        o.connect(og); og.connect(lp); o.start();
      }
    }
    // wave-4: fiddle bus — bowed lead, gently low-passed so it never rasps.
    {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.4;
      fiddleGain = ctx.createGain(); fiddleGain.gain.value = 0.9;
      fiddleGain.connect(lp); lp.connect(musicBus);
      sendVerb(lp, 0.5);
    }
    fiddleNextAt = now() + 14 + M.rng() * 16;              // first phrase a while in
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
    // wave-4 combat tier 2: syncopated second-drum bus + tremolo string synth
    // (detuned saws → string-body bandpass → 8.5 Hz bow-tremolo AM).
    tier2Gain = ctx.createGain(); tier2Gain.gain.value = 0; tier2Gain.connect(musicBus);
    tier2Perc = ctx.createGain(); tier2Perc.gain.value = 0.9; tier2Perc.connect(tier2Gain);
    {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1250; bp.Q.value = 1.3;
      for (const [f, det] of [[220, -7], [220, 6], [329.6, -3]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(bp); o.start();
      }
      const am = ctx.createGain(); am.gain.value = 0.55;    // bow tremolo
      const lfo = ctx.createOscillator(); lfo.frequency.value = 8.5;
      const lg = ctx.createGain(); lg.gain.value = 0.45;
      lfo.connect(lg); lg.connect(am.gain); lfo.start();
      const sg = ctx.createGain(); sg.gain.value = 0.13;
      bp.connect(am); am.connect(sg); sg.connect(tier2Gain);
      sendVerb(sg, 0.25);
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
    // wave-4 boss choir: slow detuned voices through formant-ish bandpasses
    // (rough "ah" vowel), drifting slowly — swells in over ~5 s on bossBar.
    {
      choirGain = ctx.createGain(); choirGain.gain.value = 0; choirGain.connect(musicBus);
      sendVerb(choirGain, 0.5);
      const cin = ctx.createGain(); cin.gain.value = 0.08;  // sum of 6 saws, tamed
      for (const [f, d1, d2] of [[110, -12, 9], [164.8, -8, 11], [220, -10, 7]]) {
        for (const det of [d1, d2]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
          o.connect(cin); o.start();
        }
      }
      const drift = ctx.createOscillator(); drift.frequency.value = 0.11; drift.start();
      for (const [ff, q, v, dAmt] of [[700, 9, 1, 55], [1080, 10, 0.62, 80], [2300, 12, 0.16, 0]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
        const fg = ctx.createGain(); fg.gain.value = v;
        cin.connect(bp); bp.connect(fg); fg.connect(choirGain);
        if (dAmt) {                                         // slow vowel drift
          const dg2 = ctx.createGain(); dg2.gain.value = dAmt;
          drift.connect(dg2); dg2.connect(bp.frequency);
        }
      }
    }
    // wave-5 Undergloom motif bus: while the Undergloom's bossBar is up, the
    // choir stands down and a restrained 2-note doom motif (scheduled in
    // scheduleStep) speaks through this gain instead, over the dread bed.
    gloomMotifGain = ctx.createGain(); gloomMotifGain.gain.value = 0; gloomMotifGain.connect(musicBus);
    sendVerb(gloomMotifGain, 0.4);
    M.nextT = now() + 0.15;
    M.timer = setInterval(scheduleMusic, 200);             // lookahead pump
    applyCombatState();                                     // honor pre-unlock events
    applyBossState();
    applyTier2();
    applyUndergloom();
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
    // The choir swells in slower than the drums — dread, not a jump-scare.
    // wave-5: against the Undergloom the choir yields the top of the mix to
    // the dread drone + doom motif (applyUndergloom / updateAmbience).
    const choirOn = bossOn && !undergloomOn;
    choirGain.gain.cancelScheduledValues(t);
    choirGain.gain.setTargetAtTime(choirOn ? 0.5 : 0.0001, t, choirOn ? 1.7 : 2.2);
  }
  // wave-5: Undergloom doom-motif layer fade (dread bed rides updateAmbience).
  function applyUndergloom() {
    if (!ctx || !gloomMotifGain) return;
    const t = now();
    gloomMotifGain.gain.cancelScheduledValues(t);
    gloomMotifGain.gain.setTargetAtTime(undergloomOn ? 0.7 : 0.0001, t, undergloomOn ? 1.2 : 1.6);
  }
  function applyTier2() {
    if (!ctx) return;
    const t = now();
    tier2Gain.gain.cancelScheduledValues(t);
    tier2Gain.gain.setTargetAtTime(tier2On ? 0.8 : 0.0001, t, tier2On ? 0.35 : 1.2);
  }

  // wave-4: combat tier detection — ≥3 aggroed enemies OR any aggroed elite.
  // Polled every 0.3 s (wall clock); crossfades are handled by applyTier2 so
  // state flips are cheap.
  function updateCombatTier() {
    const list = g.enemies && g.enemies.list;
    let n = 0, elite = false;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e && e.alive && e.aggro) { n++; if (e.elite) elite = true; }
      }
    }
    const on = n >= 3 || (elite && n > 0);
    if (on !== tier2On) { tier2On = on; applyTier2(); }
  }

  // wave-4: location themes ---------------------------------------------------
  // Region from player position (POI distances + altitude). Priority order
  // matters: named places win over the mountain altitude test.
  function computeRegion(px, pz, py, slack) {
    if (dist2d(px, pz, POI.village.x, POI.village.z) < 115 + slack) return 'village';
    if (dist2d(px, pz, POI.ruins.x, POI.ruins.z) < 145 + slack) return 'ruins';  // incl. cemetery/crypt
    if (dist2d(px, pz, POI.lake.x, POI.lake.z) < 190 + slack) return 'lake';
    if (py > 55 - slack * 0.35 || pz < -700 + slack) return 'mountains';
    return 'wilds';
  }

  function pollRegion() {
    const p = g.player;
    if (!p || !decks) return;
    const px = p.position.x, pz = p.position.z, py = p.position.y;
    let r = computeRegion(px, pz, py, 0);
    // Hysteresis: keep the current region until clearly outside it (no
    // 2 s ping-pong when idling on a boundary).
    if (r !== currentRegion && computeRegion(px, pz, py, 22) === currentRegion) r = currentRegion;
    if (r !== currentRegion) applyRegion(r);
  }

  function applyRegion(r) {
    currentRegion = r;
    REG = REGIONS[r] || REGIONS.wilds;
    if (!ctx || !decks) return;
    const t = now();
    // Swap decks: old theme rides its deck down over 6 s while the new rides
    // up. The fade itself is driven per-frame in update() with direct .value
    // writes (updateDeckFade) — no automation events on the deck gains.
    const oldD = decks[deckIdx];
    deckIdx ^= 1;
    const newD = decks[deckIdx];
    xfSnap.op = oldD.pad.gain.value; xfSnap.ol = oldD.lute.gain.value;
    xfSnap.np = newD.pad.gain.value; xfSnap.nl = newD.lute.gain.value;
    xfAt = t;
    M.forceChord = true;                                   // new motif starts now
    // Voicing color: filters glide, ruins drone crossfades (τ2 ≈ 6 s settle).
    luteLP.frequency.setTargetAtTime(REG.luteF, t, 2);
    padLP.frequency.setTargetAtTime(REG.padF, t, 2);
    droneGain.gain.setTargetAtTime(r === 'ruins' ? 0.55 : 0.0001, t, 2);
  }

  // Per-frame 6 s equal-ish-power deck crossfade (smoothstep on both legs;
  // snapshot start values so a mid-fade region flip continues without a jump).
  function updateDeckFade(tw) {
    if (!xfAt || !decks) return;
    const k = Math.min(1, (tw - xfAt) / 6);
    const e = k * k * (3 - 2 * k);
    const oldD = decks[1 - deckIdx], newD = decks[deckIdx];
    oldD.pad.gain.value = xfSnap.op * (1 - e);
    oldD.lute.gain.value = xfSnap.ol * (1 - e);
    newD.pad.gain.value = xfSnap.np + (1 - xfSnap.np) * e;
    newD.lute.gain.value = xfSnap.nl + (1 - xfSnap.nl) * e;
    if (k >= 1) xfAt = 0;
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
    if (M.forceChord || step >= M.nextChordStep) {           // region-aware harmonic rhythm
      M.forceChord = false;
      M.nextChordStep = step + REG.chordSteps;
      beginChord(t);
    }
    // Combat percussion only exists while the layer is (fading) audible.
    const combatLive = combatOn || combatGain.gain.value > 0.02;
    if (combatLive) {
      const s8 = step % 8;
      if (step % 4 === 0) drumKick(t, 0.5, combatPerc);
      if (s8 === 2 || s8 === 6) drumTap(t, 0.16, 900, combatPerc);
      if (s8 === 7 && M.rng() < 0.3) drumKick(t + M.stepDur * 0.5, 0.24, combatPerc);
      // Tier 2: syncopated second drum — pushed 16th offsets against tier 1.
      if (tier2On || tier2Gain.gain.value > 0.02) {
        if (s8 === 1 || s8 === 4) drumKick(t + M.stepDur * 0.5, 0.34, tier2Perc);
        if (s8 === 3) drumTap(t + M.stepDur * 0.5, 0.18, 1200, tier2Perc);
        if (s8 === 6 && M.rng() < 0.5) drumKick(t, 0.26, tier2Perc);
      }
      if (bossOn || bossGain.gain.value > 0.02) {
        if (step % 2 === 1) drumTap(t, 0.2, 1500, bossPerc); // driving off-beats
        if (s8 === 4) drumKick(t, 0.42, bossPerc);
        // wave-4 deeper hits: a slow sub boom under everything, once a bar.
        if (step % 16 === 8) {
          osc1(t, 0.6, 'sine', 52, 24, 0.5, bossPerc, { a: 0.005, verb: 0.25 });
          noise1(t, 0.09, 0.2, bossPerc, { fType: 'lowpass', ff0: 850 });
        }
        if (step % 32 === 24) osc1(t, 2.0, 'sine', 65, 40, 0.16, bossPerc, { a: 0.4 }); // dread swell
      }
    }
    // wave-5 Undergloom doom motif: two notes a minor 2nd apart (A1 → Bb1),
    // one per half-bar — restrained, funereal, riding the dread-drone bed.
    if (undergloomOn || (gloomMotifGain && gloomMotifGain.gain.value > 0.02)) {
      const s16 = step % 16;
      if (s16 === 0) gloomNote(t, 55);                     // A1
      else if (s16 === 10) gloomNote(t, 58.27);            // Bb1 — the half-step of dread
    }
  }

  // wave-5: one doom-motif tone — dark sine root + a faint filtered saw an
  // octave up for edge, both through gloomMotifGain (faded by applyUndergloom).
  function gloomNote(t, f) {
    osc1(t, 2.2, 'sine', f, 0, 0.26, gloomMotifGain, { a: 0.06, verb: 0.35 });
    osc1(t, 2.2, 'sawtooth', f * 2, 0, 0.05, gloomMotifGain, { a: 0.1, fType: 'lowpass', ff0: 300, ff1: 120 });
  }

  function beginChord(t) {
    const night = dayness < 0.5;
    const table = night ? REG.night : REG.day;
    const ch = table[M.chordIdx % table.length];
    M.chordIdx++;
    const dur = REG.chordSteps * M.stepDur;
    const deck = decks[deckIdx];
    // Some regions (and every night) rest the pad — more air, more dark.
    const rest = night ? REG.nrest : REG.rest;
    if (M.rng() >= rest) padChord(ch, t, dur, night, deck.pad);
    // The fiddle trades sparse phrases with the lute during day exploration:
    // when it takes a chord, the lute sits that one out (≤1 per 20–40 s).
    let fiddled = false;
    if (!night && dayness > 0.55 && !combatOn && t >= fiddleNextAt) {
      fiddled = true;
      fiddleNextAt = t + 20 + M.rng() * 20;
      scheduleFiddlePhrase(t + M.stepDur * (2 + ((M.rng() * 6) | 0)), dur);
    }
    // Sparse lute phrases; long silences are part of the music.
    const chance = night ? REG.nphrase : REG.phrase;
    if (!fiddled && M.rng() < chance) schedulePhrase(t, dur, night, deck.lute);
  }

  function padChord(semis, t, dur, night, dest) {
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
      o.connect(gn); gn.connect(dest);
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
    sub.connect(sg); sg.connect(dest);
    sub.start(t); sub.stop(t + dur + rel + 0.1);
  }

  function schedulePhrase(t0, dur, night, dest) {
    const pool = REG.pool;
    const n = 3 + ((M.rng() * 5) | 0);
    let idx = clamp(M.melIdx + ((M.rng() * 3) | 0) - 1, 0, pool.length - 1);
    let st = t0 + M.stepDur * (2 + ((M.rng() * 8) | 0));
    const oct = (night ? -12 : 0) + REG.oct;
    for (let i = 0; i < n; i++) {
      const move = M.rng() < 0.65 ? (M.rng() < 0.5 ? -1 : 1) : ((M.rng() * 4) | 0) - 2;
      idx = clamp(idx + move, 0, pool.length - 1);
      const vol = 0.1 + M.rng() * 0.08;
      pluck(st, Math.max(58, nfreq(pool[idx] + oct)), vol, dest, 0);
      if (M.rng() < 0.15 && idx >= 2) {                      // occasional soft dyad
        pluck(st + 0.02, Math.max(58, nfreq(pool[idx - 2] + oct)), vol * 0.55, dest, 0);
      }
      st += M.stepDur * (2 + ((M.rng() * 3) | 0)) * REG.pace;
      if (st > t0 + dur - 1) break;
    }
    M.melIdx = idx;
  }

  // ---- wave-4 fiddle — bowed-string lead -----------------------------------
  // Sawtooth through a body-resonance bandpass; vibrato eases in like a bow
  // settling on the string; a short rosin-scratch noise transient at the bite.
  function fiddleNote(t, f, dur, vol) {
    if (!claim(t, dur + 0.3)) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const vib = ctx.createOscillator();                      // slow vibrato
    vib.frequency.value = 5.3 + Math.random() * 0.6;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(16, t + Math.min(0.5, dur * 0.5));  // cents
    vib.connect(vg); vg.connect(o.detune);
    const bp = ctx.createBiquadFilter();                     // body resonance
    bp.type = 'bandpass';
    bp.frequency.value = clamp(f * 2.2, 500, 2400);
    bp.Q.value = 1.1;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.09);          // bow bite
    gn.gain.linearRampToValueAtTime(vol * 1.12, t + dur * 0.65); // gentle swell
    gn.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(gn); gn.connect(fiddleGain);
    noise1(t, 0.07, vol * 0.5, fiddleGain, {                 // bow-noise attack
      fType: 'bandpass', ff0: clamp(f * 4, 1200, 3400), q: 2.5, a: 0.006,
    });
    o.start(t); o.stop(t + dur + 0.1);
    vib.start(t); vib.stop(t + dur + 0.1);
    fiddleCount++;
  }

  function scheduleFiddlePhrase(t0, dur) {
    const pool = REG.pool;
    const n = 3 + ((M.rng() * 3) | 0);
    let idx = clamp(M.melIdx, 1, pool.length - 2);
    let st = t0;
    for (let i = 0; i < n; i++) {
      const move = M.rng() < 0.7 ? (M.rng() < 0.5 ? -1 : 1) : ((M.rng() * 4) | 0) - 2;
      idx = clamp(idx + move, 0, pool.length - 1);
      const last = i === n - 1;
      const ndur = last ? 1.6 + M.rng() * 1.2 : 0.55 + M.rng() * 0.8;
      const f = Math.max(196, nfreq(pool[idx] + 12));        // sits above the lute
      fiddleNote(st, f, ndur, 0.055 + M.rng() * 0.02);
      st += ndur + (M.rng() < 0.3 ? 0.25 : 0.05);            // mostly legato
      if (st > t0 + dur - 1.5) break;
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
    // wave-4 rain bed: looped pink noise, band-limited; setRain(level) drives
    // gain + brightness. Slow 0.21 Hz wash keeps it breathing, not static.
    {
      const src = ctx.createBufferSource(); src.buffer = noisePink; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
      rainLP = ctx.createBiquadFilter(); rainLP.type = 'lowpass'; rainLP.frequency.value = 700; rainLP.Q.value = 0.5;
      const am = ctx.createGain(); am.gain.value = 0.85;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.21;
      const lg = ctx.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg); lg.connect(am.gain);
      rainGain = ctx.createGain(); rainGain.gain.value = 0;
      src.connect(hp); hp.connect(rainLP); rainLP.connect(am); am.connect(rainGain); rainGain.connect(ambBus);
      src.start(0, 0.9); lfo.start();
      if (rainLevel > 0) {                                  // honor pre-unlock setRain
        rainGain.gain.value = rainLevel * 0.14;
        rainLP.frequency.value = 700 + rainLevel * 1900;
      }
    }
    // wave-5 dread-drone bed: 28–35 Hz pressure, more felt than heard. Two
    // sines a hair apart beat at ~0.4 Hz; a faint octave keeps a trace of it
    // alive on small speakers. Gain 0 at rest — updateAmbience fades it in
    // near the crypt/cemetery at night and under the Undergloom fight.
    {
      dreadGain = ctx.createGain(); dreadGain.gain.value = 0; dreadGain.connect(ambBus);
      for (const [f, v] of [[31, 1], [31.4, 0.8], [62.3, 0.16]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const gg = ctx.createGain(); gg.gain.value = v;
        o.connect(gg); gg.connect(dreadGain); o.start();
      }
    }
  }

  // wave-4: distant storm rumble — thunder with the crack rounded off.
  function distantRumble(t, inten) {
    noise1(t, 3.4, 0.1 * inten, ambBus, { fType: 'lowpass', ff0: 240, ff1: 60, a: 1.2, verb: 0.4 });
    osc1(t, 2.8, 'sine', 44 * jit(0.12), 25, 0.08 * inten, ambBus, { a: 1.0 });
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

    // wave-4: distant intermittent rumble while the rain bed is heavy.
    if (rainLevel > 0.7) {
      if (t > nextRumbleAt) {
        distantRumble(t + Math.random() * 1.5, (rainLevel - 0.7) / 0.3);
        nextRumbleAt = t + 12 + Math.random() * 18;
      }
    } else if (nextRumbleAt < t + 4) {
      nextRumbleAt = t + 4;                                  // no instant rumble on onset
    }

    // ---- wave-5 dread layer (same 0.25 s throttle, everything guarded) -----
    // Crypt/cemetery dread-drone bed: sub-bass pressure inside 40 u at night,
    // very quiet — felt, not heard. A dedicated crypt/cemetery POI is honored
    // if the world grows one; until then Barrowdeep Ruins (which holds the
    // cemetery + crypt) anchors it. The Undergloom fight sets a floor.
    {
      const dp = POI.crypt || POI.cemetery || POI.ruins;
      let dreadT = 0;
      if (dp && nightness > 0.15) {
        const dd = dist2d(px, pz, dp.x, dp.z);
        dreadT = clamp((40 - dd) / 28, 0, 1) * nightness * 0.1;
      }
      if (undergloomOn) dreadT = Math.max(dreadT, 0.16);
      dreadGain.gain.setTargetAtTime(dreadT, t, 1.8);
    }

    // Pale Rider whispers: one every 8–20 s ONLY while he stalks within 45 u.
    {
      let riderNear = false;
      const el = g.enemies && g.enemies.list;
      if (el && el.length) {
        for (let i = 0; i < el.length; i++) {
          const e = el[i];
          if (!e || !e.alive || !e.pos) continue;
          const isRider = e.type === 'palerider' ||
            (typeof e.name === 'string' && /pale\s*rider/i.test(e.name));
          if (isRider && dist2d(px, pz, e.pos.x, e.pos.z) < 45) { riderNear = true; break; }
        }
      }
      if (riderNear) {
        if (t > nextWhisperAt) {
          play('whisper', { delay: Math.random() * 0.4 });
          nextWhisperAt = t + 8 + Math.random() * 12;
        }
      } else if (nextWhisperAt < t + 4) {
        nextWhisperAt = t + 4;                               // no instant whisper on arrival
      }
    }

    // Spider-den skitters: chitin ticks in the dark around (-460, -240),
    // louder the deeper in you are.
    {
      const dDen = dist2d(px, pz, -460, -240);
      if (dDen < 50) {
        if (t > nextSkitterAt) {
          play('skitter', { delay: Math.random() * 0.8, vol: 0.5 + 0.5 * clamp((50 - dDen) / 40, 0, 1) });
          nextSkitterAt = t + 5 + Math.random() * 9;
        }
      } else if (nextSkitterAt < t + 3) {
        nextSkitterAt = t + 3;
      }
    }

    // The homecoming horn: ONCE as dusk falls (dayFrac crossing ~0.78) on
    // ~30 % of days, drifting in from the village direction.
    if (prevDayFrac >= 0 && prevDayFrac < 0.78 && df >= 0.78 && df - prevDayFrac < 0.5) {
      if (Math.random() < 0.3) {
        let pan = 0;
        try {                                                // stereo is a nicety
          const dx = POI.village.x - px, dz = POI.village.z - pz;
          const len = Math.hypot(dx, dz);
          const cam = g.camera;
          if (len > 1 && cam && cam.matrixWorld) {
            const m = cam.matrixWorld.elements;              // column 0 = camera right
            pan = clamp((dx * m[0] + dz * m[2]) / len, -1, 1) * 0.75;
          }
        } catch (e) { /* ignore */ }
        play('horn_distant', { delay: 0.5 + Math.random() * 2, pan });
      }
    }
    prevDayFrac = df;
  }

  // wave-4: setRain(level 0..1) — public; weather.js calls it lazily.
  // Safe pre-unlock (level is remembered and applied when the ctx exists).
  function setRain(level) {
    rainLevel = clamp(+level || 0, 0, 1);
    if (!ctx || !rainGain) return;
    const t = now();
    rainGain.gain.setTargetAtTime(rainLevel * 0.14, t, 1.2);
    rainLP.frequency.setTargetAtTime(700 + rainLevel * 1900, t, 1.2);
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
    // wave-4 clocks ride ctx.currentTime (wall time) so cadence holds even
    // when frames run long — rawDt is clamped and would starve the polls.
    const tw = ctx.currentTime;
    if (tw - lastPollAt >= 2) { lastPollAt = tw; pollRegion(); }      // region themes
    if (tw - lastTierAt >= 0.3) { lastTierAt = tw; updateCombatTier(); } // combat tiers
    updateDeckFade(tw);                                               // 6 s theme fade
    ambAcc += g.time.rawDt || dt;
    if (ambAcc < 0.25) return;
    ambAcc = 0;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    updateAmbience();
  }

  // ==========================================================================
  // wave-4 debug handle — read the live graph programmatically (used by the
  // automated browser verification; harmless in production).
  // debug('fiddleNow') arms the fiddle to take the very next day chord.
  // ==========================================================================
  function debug(action) {
    if (action === 'fiddleNow') { fiddleNextAt = 0; return true; }
    if (!ctx) return { ctxState: 'none' };
    return {
      ctxState: ctx.state,
      region: currentRegion,
      deckIdx,
      deckPad: decks ? [decks[0].pad.gain.value, decks[1].pad.gain.value] : null,
      deckLute: decks ? [decks[0].lute.gain.value, decks[1].lute.gain.value] : null,
      drone: droneGain ? droneGain.gain.value : 0,
      luteLPf: luteLP ? luteLP.frequency.value : 0,
      padLPf: padLP ? padLP.frequency.value : 0,
      combatOn, tier2On, bossOn,
      combat: combatGain ? combatGain.gain.value : 0,
      tier2: tier2Gain ? tier2Gain.gain.value : 0,
      boss: bossGain ? bossGain.gain.value : 0,
      choir: choirGain ? choirGain.gain.value : 0,
      rainLevel,
      rain: rainGain ? rainGain.gain.value : 0,
      fiddleIn: musicBus ? Math.max(0, fiddleNextAt - now()) : -1,
      fiddleCount,
      dayness,
      // wave-5 dread layer
      undergloomOn,
      dread: dreadGain ? dreadGain.gain.value : 0,
      gloomMotif: gloomMotifGain ? gloomMotifGain.gain.value : 0,
      whisperCount, skitterCount, hornCount,
      whisperIn: Math.max(0, nextWhisperAt - now()),
      skitterIn: Math.max(0, nextSkitterAt - now()),
    };
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
    // wave-5: the Undergloom trades the choir for dread drone + doom motif.
    const ug = !!(d && d.name != null && /undergloom/i.test(String(d.name)));
    if (ug !== undergloomOn) {
      undergloomOn = ug;
      applyUndergloom();
      if (on === bossOn) applyBossState();  // re-aim the choir on a name flip
    }
    if (on === bossOn) return;
    bossOn = on;
    applyBossState();
  });

  return { update, play, unlock, setRain, debug };
}

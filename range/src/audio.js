// ============================================================================
// RANGE — audio.js
// 100 % synthesised sound: gunshots layered from crack/body/boom/tail with a
// synthetic covered-line impulse response, the long far-berm echo, mechanical
// clicks/clacks/scrapes for every moving part, material impacts, brass tinkle.
// 3-D positioned sounds are delayed by distance / speed of sound, so a gong at
// 500 m rings ~1.5 s after the shot (after the bullet's own flight time).
// Hearing protection (electronic muffs) is simulated: loud impulses are
// attenuated; without it, shots cause a temporary threshold shift + ring.
// ============================================================================

export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const state = { ctx: null, ready: false, earPro: true, master: null, buffers: {}, timeScale: 1, listenerPos: [0, 0, 0], speedOfSound: 340, shotsFired: 0, muted: false };

  // ---------------------------------------------------------------- offline DSP helpers
  const sr = () => state.ctx.sampleRate;
  const noise = (sec) => { const n = Math.floor(sec * sr()); const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; return a; };
  const envExp = (a, tau, attack = 0) => { const n = a.length, s = sr(); for (let i = 0; i < n; i++) { const t = i / s; const at = attack > 0 ? Math.min(1, t / attack) : 1; a[i] *= at * Math.exp(-Math.max(0, t - attack) / tau); } return a; };
  function biquad(a, type, f0, Q = 0.707) {
    const s = sr(); const w0 = 2 * Math.PI * f0 / s; const alpha = Math.sin(w0) / (2 * Q); const cw = Math.cos(w0);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; } else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; } else { b0 = alpha; b1 = 0; b2 = -alpha; }
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) { const x0 = a[i]; const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x0; y2 = y1; y1 = y0; out[i] = y0; }
    return out;
  }
  const sweep = (sec, f0, f1, tau, vib = 0, vibHz = 0) => { const n = Math.floor(sec * sr()); const a = new Float32Array(n); let ph = 0; const s = sr(); for (let i = 0; i < n; i++) { const t = i / s; const k = Math.min(1, t / sec); const f = f0 * Math.pow(f1 / f0, k) * (1 + vib * Math.sin(2 * Math.PI * vibHz * t)); ph += 2 * Math.PI * f / s; a[i] = Math.sin(ph) * Math.exp(-t / tau); } return a; };
  const ring = (freqs, taus, sec) => { const n = Math.floor(sec * sr()); const a = new Float32Array(n); const s = sr(); for (let i = 0; i < n; i++) { const t = i / s; let v = 0; for (let k = 0; k < freqs.length; k++) v += Math.sin(2 * Math.PI * freqs[k] * t + k) * Math.exp(-t / taus[k]) / (k + 1); a[i] = v; } return a; };
  const mix = (parts, sec) => { const n = Math.floor(sec * sr()); const out = new Float32Array(n); for (const [arr, g] of parts) for (let i = 0; i < Math.min(n, arr.length); i++) out[i] += arr[i] * g; return out; };
  const norm = (a, peak = 0.9) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; };
  const toBuffer = (a) => { const b = state.ctx.createBuffer(1, a.length, sr()); b.copyToChannel(a, 0); return b; };
  // primitives
  const click = (f, tau, sec = 0.05) => envExp(biquad(noise(sec), 'bp', f, 1.2), tau);
  const clack = (f, tau, thump = 0.3, sec = 0.12) => mix([[envExp(biquad(noise(sec), 'bp', f, 0.9), tau), 1], [envExp(biquad(noise(sec), 'lp', 320, 0.7), tau * 1.6), thump]], sec);
  const thunk = (f, tau, sec = 0.15) => mix([[envExp(biquad(noise(sec), 'lp', f, 0.8), tau), 1], [sweep(sec, 140, 90, tau * 1.5), 0.6]], sec);
  const scrape = (len, f, sec) => { sec = sec || len + 0.05; const a = biquad(noise(sec), 'bp', f, 0.5); const s = sr(); for (let i = 0; i < a.length; i++) { const t = i / s; a[i] *= t < 0.005 ? t / 0.005 : t < len ? 0.7 + 0.3 * Math.sin(t * 400) : Math.exp(-(t - len) / 0.012); } return a; };

  function gunshot(kind) {
    const P = kind === 'pistol' ? { crackF: 3000, crackTau: 0.004, bodyTau: 0.02, boom: [200, 60, 0.045], tail: 0.22, gain: [1.0, 0.7, 0.8, 0.10] }
      : kind === 'rifle' ? { crackF: 3200, crackTau: 0.0035, bodyTau: 0.03, boom: [130, 36, 0.10], tail: 0.34, gain: [1.0, 1.0, 1.25, 0.16] }
        : { crackF: 4200, crackTau: 0.003, bodyTau: 0.024, boom: [150, 45, 0.065], tail: 0.28, gain: [1.0, 0.85, 1.0, 0.13] };
    const sec = 1.4;
    const crack = envExp(biquad(noise(0.03), 'bp', P.crackF, 0.6), P.crackTau);
    const body = envExp(biquad(noise(0.2), 'lp', 900, 0.7), P.bodyTau);
    const boom = mix([[sweep(0.4, P.boom[0], P.boom[1], P.boom[2]), 1], [envExp(biquad(noise(0.4), 'lp', 220, 0.7), P.boom[2] * 1.3), 0.8]], 0.4);
    const tail = envExp(biquad(noise(sec), 'lp', 1800, 0.7), P.tail, 0.01);
    return norm(mix([[crack, P.gain[0]], [body, P.gain[1]], [boom, P.gain[2]], [tail, P.gain[3]]], sec), 0.95);
  }
  function impulseResponse() {
    const sec = 1.8; const s = sr(); const n = Math.floor(sec * s); const a = new Float32Array(n);
    const refl = [[0.008, 0.5], [0.014, 0.38], [0.022, 0.3], [0.035, 0.22], [0.048, 0.16], [0.070, 0.12], [0.110, 0.08]];
    for (const [t, g] of refl) { const i0 = Math.floor(t * s); for (let i = 0; i < 160; i++) a[i0 + i] += (Math.random() * 2 - 1) * g * Math.exp(-i / 50); }
    for (let i = 0; i < n; i++) { const t = i / s; a[i] += (Math.random() * 2 - 1) * 0.28 * Math.exp(-t / 0.38) * Math.min(1, t / 0.02); }
    return toBuffer(biquad(a, 'lp', 3200, 0.7));
  }

  function buildLibrary() {
    const B = state.buffers;
    const set = (name, arr, peak = 0.9) => { B[name] = toBuffer(norm(arr, peak)); };
    B.shot_pistol = toBuffer(gunshot('pistol')); B.shot_carbine = toBuffer(gunshot('carbine')); B.shot_rifle = toBuffer(gunshot('rifle'));
    set('hammerFall', mix([[click(3000, 0.003), 0.5], [clack(1500, 0.01), 0.6]], 0.1), 0.5);
    set('dryFire', mix([[clack(1400, 0.015), 0.9], [ring([2100], [0.06], 0.2), 0.2]], 0.2), 0.7);
    set('triggerReset', click(3500, 0.002), 0.35);
    set('safeClick', click(2200, 0.003), 0.25);
    set('deadTrigger', click(1800, 0.003), 0.3);
    set('selector', mix([[click(2600, 0.004), 0.7], [clack(1200, 0.006), 0.4]], 0.1), 0.6);
    const carrierHome = mix([[clack(900, 0.025, 0.8), 1.0], [ring([1200, 2400], [0.08, 0.04], 0.3), 0.2]], 0.3);
    set('carrierRear', mix([[scrape(0.04, 1200), 0.5], [clack(1100, 0.02, 0.6), 0.8], [ring([1400, 2600], [0.05, 0.03], 0.2), 0.15]], 0.25), 0.7);
    set('carrierHome', carrierHome, 0.85);
    set('boltRelease', mix([[click(2500, 0.003), 0.6], [carrierHome, 1.1]], 0.3), 0.9);
    set('holdOpen', clack(1300, 0.015, 0.5), 0.6);
    set('slideRear', mix([[scrape(0.03, 1600), 0.5], [clack(1500, 0.012, 0.4), 0.7]], 0.2), 0.65);
    const slideHome = mix([[clack(1200, 0.02, 0.7), 0.9], [ring([1800], [0.05], 0.2), 0.15]], 0.25);
    set('slideHome', slideHome, 0.8); set('slideRelease', slideHome, 0.8);
    set('slideRack', mix([[scrape(0.06, 1400), 0.6], [click(2500, 0.004), 0.4]], 0.2), 0.6);
    set('chRelease', carrierHome, 0.85);
    set('chHome', clack(1000, 0.02, 0.5), 0.6);
    set('magRelease', mix([[click(2000, 0.005), 0.6], [thunk(300, 0.015), 0.3]], 0.15), 0.5);
    set('magOut', mix([[scrape(0.07, 700), 0.5], [thunk(200, 0.02), 0.3]], 0.2), 0.5);
    set('magIn', mix([[thunk(260, 0.03), 0.8], [click(1800, 0.006), 0.6], [scrape(0.03, 600), 0.3]], 0.2), 0.8);
    set('boltLift', mix([[click(2400, 0.004), 0.5], [scrape(0.02, 1200), 0.3]], 0.1), 0.5);
    set('boltRear', mix([[scrape(0.06, 1300), 0.5], [clack(1200, 0.02, 0.5), 0.7]], 0.2), 0.7);
    set('boltHome', mix([[scrape(0.06, 1300), 0.5], [clack(1000, 0.015, 0.4), 0.5]], 0.2), 0.6);
    set('boltLock', mix([[click(2500, 0.004), 0.6], [clack(1500, 0.008), 0.3]], 0.1), 0.6);
    set('dustCover', click(1500, 0.006), 0.4);
    set('cloth', envExp(biquad(noise(0.3), 'lp', 1500, 0.7), 0.12, 0.03), 0.25);
    set('uiTick', click(4000, 0.002), 0.3);
    set('turretClick', mix([[click(3200, 0.003), 0.7], [clack(2000, 0.004), 0.3]], 0.08), 0.6);
    set('steelDing', mix([[clack(2500, 0.006, 0.2), 0.8], [ring([2350, 3600, 5200, 7100], [0.45, 0.3, 0.22, 0.15], 1.4), 0.8]], 1.4), 0.9);
    set('plate', mix([[clack(2800, 0.005, 0.15), 0.7], [ring([3100, 4700, 6400], [0.35, 0.25, 0.15], 1.0), 0.8]], 1.0), 0.85);
    set('gong', mix([[clack(1500, 0.01, 0.4), 0.8], [ring([720, 1180, 1950, 2900], [1.8, 1.3, 0.9, 0.5], 3.0), 0.9]], 3.0), 0.95);
    set('dirt', mix([[envExp(biquad(noise(0.2), 'lp', 400, 0.7), 0.04), 0.9], [thunk(120, 0.05), 0.5]], 0.25), 0.7);
    set('wood', mix([[envExp(biquad(noise(0.08), 'bp', 900, 1.0), 0.012), 1], [click(2500, 0.003), 0.5]], 0.1), 0.7);
    set('paper', envExp(biquad(noise(0.03), 'bp', 3000, 1.0), 0.004), 0.5);
    set('concrete', mix([[click(3000, 0.003), 0.8], [envExp(biquad(noise(0.08), 'bp', 1500, 0.8), 0.02), 0.7], [thunk(200, 0.02), 0.3]], 0.15), 0.8);
    set('rubber', thunk(350, 0.02), 0.5);
    set('metal', mix([[clack(2200, 0.006, 0.2), 0.7], [ring([2900, 4400], [0.2, 0.12], 0.5), 0.6]], 0.5), 0.8);
    set('ricochet', mix([[sweep(0.45, 2800, 700, 0.12, 0.03, 30), 1.0], [click(3500, 0.002), 0.5]], 0.45), 0.6);
    set('brassTink', mix([[ring([5200, 7800, 9600], [0.06, 0.05, 0.04], 0.25), 0.5], [click(6000, 0.002), 0.4]], 0.25), 0.55);
    set('magDrop', mix([[thunk(180, 0.04), 0.9], [clack(800, 0.01), 0.4]], 0.25), 0.7);
    set('popperFall', mix([[clack(600, 0.04, 1.0), 1.0], [ring([300, 520], [0.3, 0.2], 0.8), 0.5]], 0.8), 0.9);
    set('popperReset', clack(700, 0.02), 0.5);
    set('crack', click(3500, 0.0015), 0.8);
    set('tinnitus', ring([5600], [0.9], 2.5), 0.12);
    // wind loop
    const w = biquad(noise(4), 'lp', 500, 0.6); const s = sr(); for (let i = 0; i < w.length; i++) { const t = i / s; w[i] *= 0.5 + 0.5 * Math.sin(t * 1.3) * Math.sin(t * 0.37 + 1); }
    for (let i = 0; i < 2000; i++) { const k = i / 2000; w[i] *= k; w[w.length - 1 - i] *= k; }
    set('wind', w, 0.5);
  }

  // ---------------------------------------------------------------- graph
  function unlock() {
    if (state.ctx) { if (state.ctx.state === 'suspended') state.ctx.resume(); return; }
    const ctx = new AC({ latencyHint: 'interactive' }); state.ctx = ctx;
    buildLibrary();
    const master = ctx.createGain(); master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
    master.connect(comp).connect(ctx.destination);
    // shot bus: ear-pro attenuation + muffling
    const shotBus = ctx.createGain(); const shotLP = ctx.createBiquadFilter(); shotLP.type = 'lowpass'; shotLP.frequency.value = 20000;
    shotBus.connect(shotLP).connect(master);
    // reverb send + far echo send
    const conv = ctx.createConvolver(); conv.buffer = impulseResponse(); const wet = ctx.createGain(); wet.gain.value = 0.35; conv.connect(wet).connect(master);
    const echoDelay = ctx.createDelay(5); echoDelay.delayTime.value = 3.45; const echoLP = ctx.createBiquadFilter(); echoLP.type = 'lowpass'; echoLP.frequency.value = 650; const echoGain = ctx.createGain(); echoGain.gain.value = 0.09; const echoFb = ctx.createGain(); echoFb.gain.value = 0.18;
    echoDelay.connect(echoLP).connect(echoGain).connect(master); echoLP.connect(echoFb).connect(echoDelay);
    const threshold = ctx.createGain(); threshold.gain.value = 1; // temporary threshold shift (unprotected ears)
    master.disconnect(); master.connect(threshold).connect(comp);
    Object.assign(state, { master, comp, shotBus, shotLP, conv, wet, echoDelay, echoGain, threshold, ready: true });
    // ambient wind
    const wind = ctx.createBufferSource(); wind.buffer = state.buffers.wind; wind.loop = true; const wg = ctx.createGain(); wg.gain.value = 0.0; wind.connect(wg).connect(master); wind.start(); state.windGain = wg;
    api.setEarPro(state.earPro);
  }

  const api = {
    state, unlock,
    get ready() { return state.ready; },
    setEarPro(on) { state.earPro = on; if (!state.ready) return; const t = state.ctx.currentTime; state.shotLP.frequency.setTargetAtTime(on ? 3800 : 20000, t, 0.02); state.shotBus.gain.setTargetAtTime(on ? 0.16 : 1.0, t, 0.02); },
    setTimeScale(s) { state.timeScale = s; },
    setListener(pos, fwd, up) {
      if (!state.ready) return; const L = state.ctx.listener; state.listenerPos = [pos.x, pos.y, pos.z];
      if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z; }
      else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    },
    setWind(speed) { if (state.windGain) state.windGain.gain.setTargetAtTime(Math.min(0.5, speed * 0.045), state.ctx.currentTime, 0.5); },
    /**
     * Play a named buffer. opts: pos (Vector3) for 3-D, gain, pitch, delay (s), delayFrom (Vector3: adds distance/c delay), loud (uses the shot bus), refDistance, rolloff
     */
    play(name, o = {}) {
      if (!state.ready || state.muted) return null;
      const ctx = state.ctx, buf = state.buffers[name]; if (!buf) return null;
      const src = ctx.createBufferSource(); src.buffer = buf;
      src.playbackRate.value = (o.pitch ?? 1) * (o.ignoreTimeScale ? 1 : state.timeScale);
      const g = ctx.createGain(); g.gain.value = o.gain ?? 1;
      let node = src; node.connect(g); node = g;
      let delay = o.delay ?? 0;
      if (o.pos) {
        const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = o.refDistance ?? 1.5; p.rolloffFactor = o.rolloff ?? 0.9; p.maxDistance = 5000;
        if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
        node.connect(p); node = p;
        const d = Math.hypot(o.pos.x - state.listenerPos[0], o.pos.y - state.listenerPos[1], o.pos.z - state.listenerPos[2]);
        if (o.delayFrom !== false) delay += d / state.speedOfSound;
        // distant sounds lose highs
        if (d > 40) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(600, 12000 - d * 15); node.connect(lp); node = lp; }
      }
      node.connect(o.loud ? state.shotBus : state.master);
      if (o.reverb !== false) { const send = ctx.createGain(); send.gain.value = o.reverb ?? (o.loud ? 0.8 : 0.25); g.connect(send).connect(state.conv); }
      if (o.echo) { const e = ctx.createGain(); e.gain.value = o.echo; g.connect(e).connect(state.echoDelay); }
      src.start(ctx.currentTime + Math.max(0, delay / state.timeScale));
      return src;
    },
    gunshot(weaponSpec) {
      if (!state.ready) return;
      const name = weaponSpec.action === 'recoil' ? 'shot_pistol' : weaponSpec.action === 'bolt' ? 'shot_rifle' : 'shot_carbine';
      api.play(name, { gain: 1.0, loud: true, reverb: 0.9, echo: 1.0, pitch: 0.96 + Math.random() * 0.08 });
      if (!state.earPro) {
        // unprotected: temporary threshold shift + ring
        const t = state.ctx.currentTime; state.shotsFired++;
        state.threshold.gain.cancelScheduledValues(t); state.threshold.gain.setValueAtTime(0.18, t); state.threshold.gain.setTargetAtTime(1, t + 0.05, 1.6);
        api.play('tinnitus', { gain: 0.35, reverb: false, ignoreTimeScale: true });
      }
    },
  };
  return api;
}

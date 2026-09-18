// 100% synthesized audio: a step-sequenced music engine with per-world "songs"
// and a bank of one-shot SFX. Everything is WebAudio, no files.
import { RNG, clamp } from './math.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALES = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minorPent: [0, 3, 5, 7, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmMinor: [0, 2, 3, 5, 7, 8, 11],
  wholeTone: [0, 2, 4, 6, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.7; this.sfxVol = 0.8;
    this.song = null; this.bossMode = false; this.intensity = 0;
    this.step = 0; this.nextTime = 0; this.timer = null;
    this.muted = false;
    this.lastSfx = {};
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 1;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.mBus = ctx.createGain(); this.mBus.gain.value = this.musicVol; this.mBus.connect(this.master);
    this.sBus = ctx.createGain(); this.sBus.gain.value = this.sfxVol; this.sBus.connect(this.master);
    // delay send for space
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.32;
    this.dfb = ctx.createGain(); this.dfb.gain.value = 0.32;
    this.dfilt = ctx.createBiquadFilter(); this.dfilt.type = 'lowpass'; this.dfilt.frequency.value = 2200;
    this.delay.connect(this.dfilt); this.dfilt.connect(this.dfb); this.dfb.connect(this.delay);
    this.dOut = ctx.createGain(); this.dOut.gain.value = 0.5; this.dfilt.connect(this.dOut); this.dOut.connect(this.mBus);
    this.noise = this._makeNoise();
    if (this.song) this._startScheduler();
  }
  _makeNoise() {
    const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  setVolumes(m, s) {
    this.musicVol = m; this.sfxVol = s;
    if (this.mBus) { this.mBus.gain.value = m; this.sBus.gain.value = s; }
  }

  // ---------------- MUSIC ----------------
  playSong(spec) {
    this.song = spec; this.step = 0; this.bossMode = false; this.intensity = 0;
    this.rng = new RNG(spec.seed || 7);
    this.bar = 0;
    this.melody = this._composeMelody(spec);
    if (!this.ctx) return;
    this._startScheduler();
  }
  stopSong() { this.song = null; if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  setBoss(on) { this.bossMode = on; }
  _startScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this._schedule(), 30);
  }
  _composeMelody(spec) {
    // A 4-bar phrase (64 sixteenths) of scale degrees; -1 = rest.
    const rng = new RNG((spec.seed || 7) * 31 + 5);
    const out = []; let deg = 0;
    for (let i = 0; i < 64; i++) {
      if (i % 2 === 1 || rng.chance(spec.sparse || 0.3)) { out.push(-1); continue; }
      deg += rng.int(-2, 2); deg = clamp(deg, -3, 9);
      out.push(deg);
    }
    return out;
  }
  _schedule() {
    if (!this.song || !this.ctx || this.muted) return;
    const spec = this.song;
    const bpm = spec.bpm * (this.bossMode ? 1.08 : 1);
    const stepDur = 60 / bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime, stepDur, spec);
      this.nextTime += stepDur;
      this.step++;
    }
  }
  _degToMidi(spec, deg, octave = 0) {
    const scale = SCALES[spec.scale] || SCALES.aeolian;
    const oct = Math.floor(deg / scale.length), d = ((deg % scale.length) + scale.length) % scale.length;
    return spec.root + scale[d] + 12 * (oct + octave);
  }
  _playStep(step, t, dur, spec) {
    const s16 = step % 16, bar = Math.floor(step / 16), s64 = step % 64;
    const boss = this.bossMode;
    const chordIdx = Math.floor(step / 32) % (spec.chords ? spec.chords.length : 4);
    const chordRoot = spec.chords ? spec.chords[chordIdx] : [0, 5, 3, 4][chordIdx];
    // drums
    const dp = spec.drums || 'four';
    if (dp !== 'none') {
      const kick = dp === 'four' ? s16 % 4 === 0 : dp === 'half' ? (s16 === 0 || s16 === 8 || (boss && s16 === 10)) : dp === 'break' ? [0, 6, 10].includes(s16) || (boss && s16 === 13) : false;
      if (kick) this._kick(t, spec.kick || 1);
      if (dp !== 'sparse' && (s16 === 4 || s16 === 12)) this._snare(t, boss ? 1.0 : 0.7);
      if (dp === 'sparse' && s16 === 8) this._snare(t, 0.6);
      if (s16 % 2 === 0 || boss) this._hat(t, s16 % 4 === 2 ? 0.5 : 0.25, s16 % 4 === 2 ? 0.08 : 0.03);
    }
    // bass
    const bp = spec.bass || 'pulse';
    if (bp !== 'none') {
      let play = false, deg = chordRoot;
      if (bp === 'pulse') play = s16 % 2 === 0;
      else if (bp === 'drive') { play = true; if (s16 % 8 === 6) deg += 4; }
      else if (bp === 'slow') play = s16 === 0 || s16 === 10;
      else if (bp === 'walk') { play = s16 % 4 === 0; deg += [0, 2, 4, 3][Math.floor(s16 / 4)]; }
      if (play) this._bass(t, NOTE(this._degToMidi(spec, deg, -2)), dur * (bp === 'slow' ? 6 : 1.6), spec.bassWave || 'sawtooth', spec.bassCut || 700);
    }
    // pad chords once per 2 bars
    if (step % 32 === 0 && spec.pad !== 'none') {
      const notes = [0, 2, 4].map((o) => NOTE(this._degToMidi(spec, chordRoot + o, 0)));
      this._pad(t, notes, dur * 32, spec.padWave || 'triangle', spec.padVol ?? 0.11);
    }
    // arpeggio
    const ap = spec.arp || 'up';
    if (ap !== 'none' && (s16 % 2 === 0 || boss)) {
      const seq = ap === 'up' ? [0, 2, 4, 7] : ap === 'down' ? [7, 4, 2, 0] : ap === 'wide' ? [0, 4, 7, 9, 7, 4] : [0, 2, 4, 2];
      const deg = chordRoot + seq[Math.floor(s16 / 2) % seq.length] + (boss && bar % 2 ? 7 : 0);
      this._pluck(t, NOTE(this._degToMidi(spec, deg, 1)), dur * 1.2, spec.arpWave || 'square', spec.arpVol ?? 0.07, spec.arpSend ?? 0.25);
    }
    // melody (enters after 4 bars, always in boss mode)
    if ((bar >= 4 || boss) && spec.lead !== 'none') {
      const deg = this.melody[s64];
      if (deg >= 0) {
        const held = this.melody[(s64 + 2) % 64] === -1 ? 3 : 1.5;
        this._lead(t, NOTE(this._degToMidi(spec, deg + chordRoot, 1)), dur * held, spec.leadWave || 'sawtooth', spec.leadVol ?? 0.09);
      }
    }
    // boss tension layer: fast hats + extra octave bass stab
    if (boss && s16 % 4 === 2) this._bass(t, NOTE(this._degToMidi(spec, chordRoot, -1)), dur, 'square', 900, 0.5);
  }

  // ---- voices ----
  _env(g, t, a, d, s, r, peak = 1, dur = 0.2) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, peak * s), t + Math.max(a + d, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, dur) + r);
  }
  _osc(type, freq, t, end, dest) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    o.connect(dest); o.start(t); o.stop(end); return o;
  }
  _kick(t, vol = 1) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.mBus); o.start(t); o.stop(t + 0.3);
  }
  _snare(t, vol = 1) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(this.mBus); n.start(t); n.stop(t + 0.2);
    const o = ctx.createOscillator(), g2 = ctx.createGain(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    g2.gain.setValueAtTime(0.3 * vol, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g2); g2.connect(this.mBus); o.start(t); o.stop(t + 0.12);
  }
  _hat(t, vol = 0.3, len = 0.04) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f); f.connect(g); g.connect(this.mBus); n.start(t); n.stop(t + len + 0.02);
  }
  _bass(t, freq, len, wave = 'sawtooth', cut = 700, vol = 1) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = wave; o.frequency.value = freq; f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(cut * 2, t); f.frequency.exponentialRampToValueAtTime(cut * 0.5, t + len);
    g.gain.setValueAtTime(0.28 * vol, t); g.gain.setValueAtTime(0.28 * vol, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(f); f.connect(g); g.connect(this.mBus); o.start(t); o.stop(t + len + 0.02);
  }
  _pad(t, freqs, len, wave = 'triangle', vol = 0.11) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400; f.connect(g); g.connect(this.mBus); g.connect(this.delay);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + len * 0.2); g.gain.setValueAtTime(vol, t + len * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + len);
    for (const fr of freqs) for (const det of [-6, 6]) {
      const o = ctx.createOscillator(); o.type = wave; o.frequency.value = fr; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + len + 0.05);
    }
  }
  _pluck(t, freq, len, wave = 'square', vol = 0.07, send = 0.25) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = wave; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.setValueAtTime(3500, t); f.frequency.exponentialRampToValueAtTime(600, t + len);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(f); f.connect(g); g.connect(this.mBus);
    if (send > 0) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(this.delay); }
    o.start(t); o.stop(t + len + 0.02);
  }
  _lead(t, freq, len, wave = 'sawtooth', vol = 0.09) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(900, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    for (const det of [-7, 7]) { const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq; o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + 0.02); }
    f.connect(g); g.connect(this.mBus);
    const sg = ctx.createGain(); sg.gain.value = 0.35; g.connect(sg); sg.connect(this.delay);
  }

  // ---------------- SFX ----------------
  sfx(name, opt = {}) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const minGap = { shoot: 45, graze: 30, hit: 25, pickup: 30 }[name] || 0;
    if (minGap && now - (this.lastSfx[name] || 0) < minGap) return;
    this.lastSfx[name] = now;
    const t = this.ctx.currentTime, c = this.ctx, bus = this.sBus;
    const tone = (type, f0, f1, len, vol, curve = 'exp') => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + len);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + len + 0.02);
    };
    const noise = (len, vol, type = 'lowpass', freq = 2000, q = 0.7, f1) => {
      const n = c.createBufferSource(); n.buffer = this.noise; const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + len);
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      n.connect(f); f.connect(g); g.connect(bus); n.start(t); n.stop(t + len + 0.02);
    };
    switch (name) {
      case 'shoot': tone('triangle', 900, 500, 0.05, 0.05); break;
      case 'laser': tone('sawtooth', 300, 700, 0.08, 0.04); break;
      case 'hit': tone('square', 500, 300, 0.04, 0.06); break;
      case 'kill': noise(0.18, 0.4, 'lowpass', 1500, 0.8, 200); tone('sine', 300, 60, 0.18, 0.4); break;
      case 'bigkill': noise(0.6, 0.7, 'lowpass', 1200, 0.8, 80); tone('sine', 200, 30, 0.6, 0.6); tone('sawtooth', 120, 40, 0.4, 0.2); break;
      case 'bosshit': tone('square', 160, 140, 0.05, 0.06); break;
      case 'phase': noise(0.8, 0.5, 'bandpass', 800, 1.5, 3000); tone('sine', 220, 880, 0.6, 0.35); tone('sine', 330, 1320, 0.6, 0.2); break;
      case 'bossdie': noise(1.6, 0.9, 'lowpass', 2000, 0.6, 60); tone('sine', 120, 20, 1.5, 0.8); tone('sawtooth', 90, 25, 1.2, 0.3); break;
      case 'graze': tone('sine', 2400, 3200, 0.03, 0.05); break;
      case 'pickup': tone('sine', 1200, 1800, 0.06, 0.08); break;
      case 'power': tone('square', 600, 1200, 0.12, 0.12); tone('square', 900, 1800, 0.16, 0.08); break;
      case 'extend': for (let i = 0; i < 5; i++) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = 660 * Math.pow(2, i / 5); g.gain.setValueAtTime(0.0001, t + i * 0.08); g.gain.linearRampToValueAtTime(0.2, t + i * 0.08 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.4); o.connect(g); g.connect(bus); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.45); } break;
      case 'bomb': noise(1.2, 0.9, 'lowpass', 3000, 0.5, 100); tone('sine', 80, 30, 1.0, 0.7); tone('sawtooth', 400, 60, 0.5, 0.2); break;
      case 'death': noise(0.9, 0.8, 'bandpass', 600, 0.8, 100); tone('sawtooth', 400, 40, 0.8, 0.5); tone('square', 250, 30, 0.7, 0.3); break;
      case 'over': tone('sine', 200, 1600, 0.5, 0.3); tone('sawtooth', 100, 800, 0.5, 0.15); noise(0.5, 0.3, 'highpass', 1000, 0.5, 8000); break;
      case 'warn': tone('square', 440, 440, 0.12, 0.15); tone('square', 440, 440, 0.12, 0.0001); break;
      case 'select': tone('square', 700, 900, 0.06, 0.08); break;
      case 'confirm': tone('square', 500, 1000, 0.1, 0.1); tone('sine', 1000, 1500, 0.15, 0.08); break;
      case 'back': tone('square', 600, 300, 0.1, 0.08); break;
      case 'shatter': noise(0.25, 0.4, 'highpass', 3000, 0.8, 800); tone('triangle', 1400, 400, 0.2, 0.15); break;
      case 'freeze': tone('sine', 2000, 400, 0.4, 0.2); noise(0.4, 0.2, 'highpass', 5000); break;
      case 'glitch': for (let i = 0; i < 4; i++) tone('square', 200 + Math.random() * 2000, 100 + Math.random() * 1000, 0.05, 0.08); break;
      case 'beat': tone('sine', 90, 45, 0.25, 0.5); break;
      case 'tick': tone('square', 1500, 1500, 0.02, 0.07); break;
      case 'lasercharge': tone('sawtooth', 100, 1200, 0.9, 0.12); break;
      case 'laserfire': noise(0.5, 0.35, 'bandpass', 1200, 2, 300); tone('sawtooth', 220, 110, 0.5, 0.2); break;
      case 'relic': tone('sine', 500, 1000, 0.3, 0.2); tone('sine', 750, 1500, 0.4, 0.15); tone('sine', 1000, 2000, 0.5, 0.1); break;
      case 'shield': tone('triangle', 800, 200, 0.15, 0.15); break;
      case 'talk': tone('square', 900 + Math.random() * 300, 700, 0.03, 0.04); break;
      default: break;
    }
  }
}

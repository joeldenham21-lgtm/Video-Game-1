// ============================================================================
// ELDERFALL — details.js
// The ambient micro-detail layer: the soul of the world's aliveness.
// Ants marching on fallen logs, the noon bell scattering hens, wind chimes
// answering a gust, an eagle riding thermals over Drakespire, the answered
// wolf howl, aurora curtains on seeded nights, a will-o'-wisp that always
// recedes. All 45 details from DETAILS.md.
//
//   createDetails(g) → { update(dt), wind: { dir: Vector3, gust: 0..1 } }
//   (also sets g.wind = that same wind object)
//
// Budget architecture (≤ 12 draw calls, ≤ 1.5 ms/frame, zero per-frame allocs):
//   POOL A  — one THREE.BatchedMesh: every rigid critter & moving prop
//   CLOTH   — one merged dynamic vertex-grid mesh (laundry line)
//   POOL B  — one InstancedMesh diamond quad: moths, bats, leaves, sparrow…
//   POOL C  — one additive Points (per-point size/color/alpha): all glints
//   POOL D  — one normal-blend dark Points: ants, gnats, dust, grain
//   POOL E  — one LineSegments: cobwebs, silk, ropes, ice crack
//   POOL F  — one InstancedMesh flat ring (vec4 tint): water rings, puddles,
//             footprints
//   CANDLE  — one InstancedMesh additive window-glow quad
//   AURORA  — one ribbon ShaderMaterial;  CLOUD — one soft shadow quad
//
// One spatial activation system: actors wake within 40u of the player
// (sky/peak items exempt) and are ticked round-robin in 3 buckets. All
// typed-array writes; temps preallocated at module scope.
//
// Own tiny lazily-unlocked WebAudio micro-synth (master ~0.35, feedback-delay
// verb, distance volume + camera-relative stereo pan) sits politely UNDER
// g.audio's mix. Never touches other modules' meshes; placement is derived
// only from core.POIS / terrainHeight / hash2 and this module's own props.
// ============================================================================

import * as THREE from 'three';
import {
  WATER_LEVEL, POI, BIOME, biomeAt, terrainHeight, terrainNormal,
  hash2, makeRng, clamp, lerp, smoothstep, dist2d, fbm, snoise,
} from './core.js';

// ---------------------------------------------------------------------------
// Module-scope scratch (zero per-frame allocations)
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _n1 = { x: 0, y: 1, z: 0 };            // terrainNormal out
const _sp = { ok: false, vol: 0, pan: 0 };   // spatial audio scratch

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Village layout anchors — fixed offsets from core.POI.village (0,0), chosen
// to sit alongside (never touching) the structures module's village.
// ---------------------------------------------------------------------------
const HOUSES = [ // [x, z, w, d, h] — ring of homes around the plaza
  [26, -13, 6.4, 4.6, 2.7], [-27, -17, 6.0, 4.4, 2.6], [7, -32, 6.8, 4.8, 2.8],
  [-11, 27, 6.2, 4.4, 2.7], [-33, 3, 5.8, 4.2, 2.6], [27, 22, 6.6, 4.6, 2.8],
  [-20, -33, 5.6, 4.2, 2.5], [38, 5, 6.2, 4.6, 2.7],
];
const INN = { x: 17, z: 10, ry: Math.atan2(-17, -10), w: 9.5, d: 6, h: 3.3 };
const FORGE = { x: -17, z: 12, ry: Math.atan2(17, -12) };
const WELL = { x: 0, z: -2 };
const LANTERNS = [
  [8, 9], [-8, 9], [9, -9], [-9, -9], [2, 26], [-2, 42], [14, -17], [-16, -2], [1, -24],
];

// local→world for an oriented anchor {x,z,ry}
function anch(o, lx, lz, out) {
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  out.x = o.x + lx * c + lz * s;
  out.z = o.z - lx * s + lz * c;
  return out;
}
const _a1 = { x: 0, z: 0 };
const _a2 = { x: 0, z: 0 };

// Pentatonic chime tuning (A minor pent., warm register)
const CHIME_HZ = [220, 261.63, 293.66, 329.63, 392.0];

// day-fraction window helper (handles midnight wrap)
function inWin(f, a, b) { return a < b ? (f >= a && f < b) : (f >= a || f < b); }
// smooth envelope inside a (possibly wrapping) window, eased at both edges
function winEnv(f, a, b, ease) {
  let t;
  if (a < b) { if (f < a || f > b) return 0; t = (f - a) / (b - a); }
  else { if (f < a && f > b) return 0; t = ((f - a + 1) % 1) / ((b - a + 1) % 1); }
  return smoothstep(0, ease, t) * smoothstep(1, 1 - ease, t);
}

// ---------------------------------------------------------------------------
// Tiny geometry baker: merges colored boxes/cones/cyls into ONE indexed
// BufferGeometry (position/normal/color) — the unit of POOL A instancing.
// ---------------------------------------------------------------------------
const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
const _bm = new THREE.Matrix4();
const _bv = new THREE.Vector3();
const _bn = new THREE.Matrix3();

class Bake {
  constructor(seed) { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.rng = makeRng(seed); }
  put(tpl, x, y, z, sx, sy, sz, rx, ry, rz, color, jitter) {
    _be.set(rx, ry, rz, 'YXZ'); _bq.setFromEuler(_be);
    _bv.set(sx, sy, sz); _bm.compose(new THREE.Vector3(x, y, z), _bq, _bv);
    _bn.getNormalMatrix(_bm);
    const P = tpl.attributes.position.array, N = tpl.attributes.normal.array;
    const I = tpl.index.array, base = this.pos.length / 3;
    const cr = ((color >> 16) & 255) / 255, cg = ((color >> 8) & 255) / 255, cb = (color & 255) / 255;
    for (let i = 0; i < P.length; i += 3) {
      _bv.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(_bm);
      this.pos.push(_bv.x, _bv.y, _bv.z);
      _bv.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_bn).normalize();
      this.nrm.push(_bv.x, _bv.y, _bv.z);
      const j = 1 + (this.rng() - 0.5) * 2 * (jitter === undefined ? 0.08 : jitter);
      this.col.push(clamp(cr * j, 0, 1), clamp(cg * j, 0, 1), clamp(cb * j, 0, 1));
    }
    for (let i = 0; i < I.length; i++) this.idx.push(base + I[i]);
    return this;
  }
  geo() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

let BTPL = null; // bake templates, built once
function bakeTemplates() {
  if (BTPL) return BTPL;
  BTPL = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 7),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
  };
  return BTPL;
}

// ---------------------------------------------------------------------------
// Point-pool shaders (per-point size / color / alpha, soft round sprites)
// ---------------------------------------------------------------------------
const PT_VERT = /* glsl */ `
attribute float aSize;
attribute vec3  aCol;
attribute float aAlpha;
varying vec3  vCol;
varying float vA;
uniform float uPx;
void main() {
  vCol = aCol; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPx / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const PT_FRAG_ADD = /* glsl */ `
varying vec3  vCol;
varying float vA;
void main() {
  float m = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vCol, m * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const PT_FRAG_DARK = /* glsl */ `
varying vec3  vCol;
varying float vA;
void main() {
  float m = smoothstep(0.5, 0.22, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vCol, m * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Ring pool (vec4 per-instance tint → fading water rings AND dark footprints)
const RING_VERT = /* glsl */ `
attribute vec4 aTint;
varying vec4 vTint;
void main() {
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const RING_FRAG = /* glsl */ `
varying vec4 vTint;
void main() {
  if (vTint.a < 0.004) discard;
  gl_FragColor = vTint;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Aurora ribbon — green→violet snoise curtains, additive
const AUR_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x += sin(uv.y * 3.0 + uTime * 0.11 + uv.x * 9.0) * 14.0 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const AUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAlpha;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y);
}
void main() {
  float t = uTime;
  float n = vn(vec2(vUv.x * 7.0 + t * 0.045, t * 0.03)) * 0.65
          + vn(vec2(vUv.x * 19.0 - t * 0.06, 3.7 + t * 0.02)) * 0.45;
  float curt = smoothstep(0.34, 0.85, n);
  float rays = 0.72 + 0.28 * sin(vUv.x * 140.0 + n * 10.0);
  float vert = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.10, vUv.y);
  vec3 col = mix(vec3(0.18, 0.95, 0.45), vec3(0.52, 0.22, 0.85), clamp(vUv.y * 1.25 + (n - 0.5) * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col, curt * rays * vert * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Cloud shadow — soft dark radial blob, drifts with the wind
const CLD_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CLD_FRAG = /* glsl */ `
varying vec2 vP;
uniform float uAlpha;
uniform float uTime;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y);
}
void main() {
  float r = length(vP) / 30.0;
  float edge = vn(vP * 0.09 + uTime * 0.015);
  float a = uAlpha * smoothstep(1.0, 0.30, r + (edge - 0.5) * 0.35);
  gl_FragColor = vec4(0.010, 0.016, 0.028, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ============================================================================
// Factory
// ============================================================================
export function createDetails(g) {
  const TPL = bakeTemplates();

  const root = new THREE.Group();
  root.name = 'details';
  g.scene.add(root);

  // =========================================================================
  // #1 GLOBAL GUST BUS — the world breathes coherently. Everything below
  // samples wind.gust / wind.dir. Exposed as g.wind for future systems.
  // =========================================================================
  const wind = { dir: new THREE.Vector3(0.71, 0, 0.71), gust: 0 };
  g.wind = wind;
  let gustSpike = false;       // true for ONE frame when a gust front hits
  let lastSpikeT = -99;
  let prevGust = 0;

  function updateWind() {
    const e = g.time.elapsed;
    const base = 0.5 + 0.5 * fbm(e * 0.045, 7.3, 3);              // slow breathing
    const s = fbm(e * 0.21, 41.2, 2);                              // gust fronts
    const spike = smoothstep(0.30, 0.72, s);
    wind.gust = clamp(base * 0.5 + spike * 0.62, 0, 1);
    const a = 0.9 + fbm(e * 0.008, 99.5, 2) * 1.9;                 // slow veering
    wind.dir.set(Math.sin(a), 0, Math.cos(a));
    gustSpike = false;
    if (wind.gust > 0.72 && prevGust <= 0.72 && e - lastSpikeT > 6) {
      gustSpike = true; lastSpikeT = e;
    }
    prevGust = wind.gust;
  }

  // scare bus — a brief repulse point this module owns (#3 noon bell, etc.)
  const scare = { x: 0, z: 0, until: -1 };
  function scareAt(x, z, dur) { scare.x = x; scare.z = z; scare.until = g.time.elapsed + dur; }
  const scared = (x, z, r) => g.time.elapsed < scare.until && dist2d(x, z, scare.x, scare.z) < r;

  // =========================================================================
  // MICRO-AUDIO — own quiet WebAudio context, lazily unlocked on pointerdown.
  // Master ~0.35 under g.audio's mix; feedback-delay verb; positional via
  // 1/distance volume + camera-relative StereoPanner azimuth. Never throws.
  // =========================================================================
  let AC = null, master = null, verbIn = null, noiseBuf = null;
  let humOsc = null, humGain = null;                 // #40 standing-stone 55Hz
  let whineOsc = null, whineGain = null;             // #35 gnat whine
  let voices = 0;
  const MAXV = 10;
  const lastSnd = new Map();                          // name → last elapsed time

  function initAudio() {
    if (AC) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AC = new Ctx();
      const comp = AC.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 18; comp.ratio.value = 5;
      master = AC.createGain();
      master.gain.value = 0.35;
      comp.connect(master); master.connect(AC.destination);
      const busIn = AC.createGain(); busIn.connect(comp);
      master._in = busIn;
      // cheap feedback-delay verb (two staggered taps, lowpassed feedback)
      verbIn = AC.createGain(); verbIn.gain.value = 1;
      const mk = (dt, fb) => {
        const d = AC.createDelay(0.6); d.delayTime.value = dt;
        const gfb = AC.createGain(); gfb.gain.value = fb;
        const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
        verbIn.connect(d); d.connect(lp); lp.connect(gfb); gfb.connect(d);
        const out = AC.createGain(); out.gain.value = 0.5; lp.connect(out); out.connect(busIn);
      };
      mk(0.263, 0.42); mk(0.331, 0.38);
      // 1s looping white-noise buffer
      const n = AC.sampleRate | 0;
      noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
      const d0 = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d0[i] = Math.random() * 2 - 1;
      // sustained: standing-stone hum (55 Hz + soft octave)
      humGain = AC.createGain(); humGain.gain.value = 0; humGain.connect(busIn);
      humOsc = AC.createOscillator(); humOsc.type = 'sine'; humOsc.frequency.value = 55;
      const humO2 = AC.createOscillator(); humO2.type = 'sine'; humO2.frequency.value = 110.3;
      const h2g = AC.createGain(); h2g.gain.value = 0.3;
      humOsc.connect(humGain); humO2.connect(h2g); h2g.connect(humGain);
      humOsc.start(); humO2.start();
      // sustained: gnat-column whine
      whineGain = AC.createGain(); whineGain.gain.value = 0; whineGain.connect(busIn);
      whineOsc = AC.createOscillator(); whineOsc.type = 'sawtooth'; whineOsc.frequency.value = 236;
      const wlp = AC.createBiquadFilter(); wlp.type = 'bandpass'; wlp.frequency.value = 900; wlp.Q.value = 1.4;
      whineOsc.connect(wlp); wlp.connect(whineGain);
      whineOsc.start();
    } catch (err) { AC = null; }
  }
  function onFirstPointer() {
    initAudio();
    if (AC && AC.state === 'suspended') { try { AC.resume(); } catch (e) { /* no-op */ } }
    if (AC) window.removeEventListener('pointerdown', onFirstPointer);
  }
  window.addEventListener('pointerdown', onFirstPointer, { passive: true });

  // distance/pan spatializer → _sp scratch. ref = "full volume within" units.
  function spatial(x, y, z, ref, maxD) {
    _sp.ok = false;
    if (!AC) return _sp;
    const cp = g.camera.position;
    const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxD) return _sp;
    _sp.vol = Math.min(1, ref / Math.max(1, d)) * (1 - 0.35 * (d / maxD));
    const el = g.camera.matrixWorld.elements;       // column 0 = camera right
    const hd = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
    _sp.pan = clamp(((dx * el[0] + dz * el[2]) / hd) * 0.8, -0.85, 0.85);
    _sp.ok = true;
    return _sp;
  }
  // rate-limit by name; also caps simultaneous voices
  function gate(name, minGap) {
    if (!AC || g.paused) return false;
    const t = g.time.elapsed;
    const last = lastSnd.get(name);
    if (last !== undefined && t - last < minGap) return false;
    if (voices >= MAXV) return false;
    lastSnd.set(name, t);
    return true;
  }
  function claim(durMs) { voices++; setTimeout(() => { voices--; }, durMs + 60); }

  // routed output: gain → (stereo pan) → master bus; returns the gain node
  function out(pan, verbAmt) {
    const gn = AC.createGain();
    let tail = gn;
    if (AC.createStereoPanner) {
      const p = AC.createStereoPanner(); p.pan.value = pan;
      gn.connect(p); tail = p;
    }
    tail.connect(master._in);
    if (verbAmt > 0) {
      const s = AC.createGain(); s.gain.value = verbAmt;
      gn.connect(s); s.connect(verbIn);
    }
    return gn;
  }
  // one-shot enveloped oscillator
  function tone(dt, dur, type, f0, f1, vol, pan, o) {
    o = o || {};
    const t = AC.currentTime + dt;
    const osc = AC.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    let head = osc;
    if (o.vib) {
      const lfo = AC.createOscillator(); lfo.frequency.value = o.vib;
      const lg = AC.createGain(); lg.gain.value = o.vibAmt || 6;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    if (o.fType) {
      const f = AC.createBiquadFilter();
      f.type = o.fType;
      f.frequency.setValueAtTime(Math.max(20, o.ff0 || 1000), t);
      if (o.ff1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ff1), t + dur);
      f.Q.value = o.q || 0.9;
      osc.connect(f); head = f;
    }
    const gn = out(pan, o.verb || 0);
    const a = o.a !== undefined ? o.a : 0.006;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    head.connect(gn);
    osc.start(t); osc.stop(t + dur + 0.08);
    claim((dt + dur) * 1000);
  }
  // one-shot enveloped noise
  function noiz(dt, dur, vol, pan, o) {
    o = o || {};
    const t = AC.currentTime + dt;
    const src = AC.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const f = AC.createBiquadFilter();
    f.type = o.fType || 'lowpass';
    f.frequency.setValueAtTime(Math.max(20, o.ff0 || 1200), t);
    if (o.ff1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ff1), t + dur);
    f.Q.value = o.q || 0.8;
    src.connect(f);
    const gn = out(pan, o.verb || 0);
    const a = o.a !== undefined ? o.a : 0.004;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(gn);
    src.start(t); src.stop(t + dur + 0.08);
    claim((dt + dur) * 1000);
  }
  // struck metal: inharmonic partials with exponential decay
  function metal(dt, base, partials, decay, vol, pan, verbAmt) {
    const t = AC.currentTime + dt;
    const gn = out(pan, verbAmt);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    for (let i = 0; i < partials.length; i++) {
      const osc = AC.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * partials[i];
      const pg = AC.createGain();
      pg.gain.value = 1 / (1 + i * 0.9);
      osc.connect(pg); pg.connect(gn);
      osc.start(t); osc.stop(t + decay + 0.1);
    }
    claim((dt + decay) * 1000);
  }

  // ---- sound recipes (all quiet, all tasteful) -----------------------------
  const sBell = (v, p) => {  // noon bell — round bronze, long verb tail
    metal(0, 316, [1, 2.02, 2.94, 4.17, 5.42], 2.6, v, p, 0.65);
    noiz(0, 0.05, v * 0.4, p, { fType: 'bandpass', ff0: 2400, q: 1.5 });
  };
  const sClang = (v, p) => { // anvil — brighter, faster
    metal(0, 780 * (1 + (Math.random() - 0.5) * 0.06), [1, 1.51, 2.67, 3.32, 4.9], 0.5, v, p, 0.3);
    noiz(0, 0.03, v * 0.5, p, { fType: 'highpass', ff0: 3000 });
  };
  const sCreak = (v, p) => {
    tone(0, 0.28, 'sawtooth', 84, 62, v, p, { fType: 'bandpass', ff0: 420, ff1: 900, q: 5, a: 0.05 });
  };
  const sSqueakHinge = (v, p) => {
    tone(0, 0.22, 'sawtooth', 130, 170, v * 0.8, p, { fType: 'bandpass', ff0: 1500, ff1: 2400, q: 7, a: 0.04 });
  };
  const sChime = (i, v, p) => {
    const f = CHIME_HZ[i] * 2;
    tone(0, 2.1, 'triangle', f, f, v, p, { verb: 0.85, a: 0.003 });
    tone(0, 1.2, 'sine', f * 2.76, f * 2.76, v * 0.25, p, { verb: 0.7, a: 0.003 });
  };
  const sCluck = (v, p) => {
    tone(0, 0.07, 'square', 860, 340, v * 0.5, p, { fType: 'lowpass', ff0: 1400 });
    tone(0.09, 0.05, 'square', 700, 300, v * 0.35, p, { fType: 'lowpass', ff0: 1200 });
  };
  const sCroak = (fm, v, p) => {
    const t0 = AC.currentTime;
    const osc = AC.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 86 * fm;
    const am = AC.createOscillator(); am.frequency.value = 21;
    const amg = AC.createGain(); amg.gain.value = 0.5;
    const car = AC.createGain(); car.gain.value = 0.5;
    am.connect(amg); amg.connect(car.gain);
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 330 * fm; f.Q.value = 1.6;
    osc.connect(car); car.connect(f);
    const gn = out(p, 0.25);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(v, t0 + 0.03);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    f.connect(gn);
    osc.start(t0); am.start(t0); osc.stop(t0 + 0.45); am.stop(t0 + 0.45);
    claim(450);
  };
  const sCaw = (v, p, verbAmt) => {
    tone(0, 0.19, 'sawtooth', 640, 360, v, p, { fType: 'bandpass', ff0: 1300, q: 2.2, a: 0.015, verb: verbAmt });
    noiz(0.01, 0.14, v * 0.4, p, { fType: 'bandpass', ff0: 1800, q: 1.2, verb: verbAmt });
  };
  const sSqueak = (v, p) => {
    tone(0, 0.1, 'sine', 2700, 3600, v, p, { a: 0.008 });
    tone(0.11, 0.07, 'sine', 3100, 2300, v * 0.7, p, { a: 0.006 });
  };
  const sKnock = (v, p) => {
    for (let k = 0; k < 2; k++) {
      tone(k * 0.14, 0.07, 'sine', 190, 120, v, p, { a: 0.002 });
      noiz(k * 0.14, 0.03, v * 0.5, p, { ff0: 900 });
    }
  };
  const sHoot = (v, p) => {
    tone(0, 0.32, 'sine', 392, 348, v, p, { a: 0.07, verb: 0.5 });
    tone(0.42, 0.42, 'sine', 370, 322, v * 0.9, p, { a: 0.07, verb: 0.5 });
  };
  const sHowl = (dt, fm, v, p, verbAmt) => {
    tone(dt, 2.9, 'triangle', 260 * fm, 236 * fm, v, p,
      { a: 0.55, vib: 4.6, vibAmt: 9, fType: 'lowpass', ff0: 880, verb: verbAmt });
    tone(dt + 0.12, 2.5, 'triangle', 262 * fm * 1.5, 240 * fm * 1.5, v * 0.22, p,
      { a: 0.6, vib: 4.6, vibAmt: 12, fType: 'lowpass', ff0: 1100, verb: verbAmt });
  };
  const sSplash = (v, p, verbAmt) => {
    noiz(0, 0.3, v, p, { ff0: 1500, ff1: 400, a: 0.006, verb: verbAmt || 0.2 });
    tone(0, 0.13, 'sine', 340, 90, v * 0.7, p, {});
  };
  const sPlop = (v, p) => {
    tone(0, 0.09, 'sine', 520, 95, v, p, { a: 0.003 });
    noiz(0.02, 0.09, v * 0.4, p, { ff0: 900 });
  };
  const sWhoosh = (v, p) => {
    noiz(0, 1.3, v, p, { fType: 'bandpass', ff0: 320, ff1: 1300, q: 0.6, a: 0.45 });
  };
  const sThock = (v, p) => {
    tone(0, 0.09, 'sine', 150, 95, v, p, { a: 0.002 });
    noiz(0, 0.07, v * 0.8, p, { fType: 'bandpass', ff0: 750, q: 1.1 });
  };
  const sChitter = (v, p) => {
    for (let k = 0; k < 5; k++) {
      tone(k * 0.035 + Math.random() * 0.01, 0.02, 'sine', 4800 + Math.random() * 1400, 4200, v, p, { a: 0.003 });
    }
  };
  const sCry = (v, p) => { // eagle — thin, piercing, lonely
    tone(0, 0.75, 'sawtooth', 1250, 760, v, p, { fType: 'bandpass', ff0: 2100, q: 2.5, a: 0.05, vib: 6, vibAmt: 26, verb: 0.55 });
  };
  const sRatchet = (v, p) => {
    for (let k = 0; k < 6; k++) noiz(k * 0.11, 0.016, v, p, { fType: 'highpass', ff0: 2100 });
  };
  const sPop = (v, p) => {
    noiz(0, 0.02, v, p, { fType: 'highpass', ff0: 1600 });
    tone(0, 0.04, 'sine', 320, 110, v * 0.7, p, { a: 0.002 });
  };
  const sIce = (v, p) => { // deep whoom … then splintering crack
    tone(0, 1.3, 'sine', 62, 34, v, p, { a: 0.02, verb: 0.5 });
    noiz(0.16, 0.4, v * 0.8, p, { ff0: 500, ff1: 150, verb: 0.45 });
    for (let k = 0; k < 4; k++) noiz(0.1 + k * 0.07, 0.02, v * 0.6, p, { fType: 'highpass', ff0: 1300 });
  };
  const sScrabble = (v, p) => {
    for (let k = 0; k < 6; k++) noiz(k * 0.05 + Math.random() * 0.02, 0.025, v, p, { fType: 'bandpass', ff0: 2900, q: 1.4 });
  };
  const sChirp = (v, p) => {
    tone(0, 0.06, 'sine', 3300, 4300, v, p, { a: 0.004 });
    tone(0.09, 0.05, 'sine', 3900, 3000, v * 0.8, p, { a: 0.004 });
  };
  const sRustle = (v, p) => {
    noiz(0, 0.55, v, p, { fType: 'bandpass', ff0: 3600, q: 0.65, a: 0.12 });
  };
  const sLap = (v, p) => {
    noiz(0, 0.4, v, p, { ff0: 640, a: 0.12 });
  };
  const sSlapWet = (v, p) => {
    noiz(0, 0.1, v, p, { ff0: 1100, a: 0.003 });
    tone(0, 0.05, 'sine', 240, 110, v * 0.5, p, {});
  };
  const sGrainToss = (v, p) => {
    for (let k = 0; k < 5; k++) noiz(0.12 + k * 0.05 + Math.random() * 0.05, 0.014, v, p, { fType: 'highpass', ff0: 2600 });
  };
  const sEarth = (v, p) => {
    noiz(0, 0.5, v, p, { ff0: 300, ff1: 120, a: 0.06 });
  };

  // =========================================================================
  // POOL A — one BatchedMesh for every rigid critter / prop (r160 API:
  // one geometry per instance; setMatrixAt / setVisibleAt by id).
  // =========================================================================
  const batMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const batched = new THREE.BatchedMesh(72, 14000, 24000, batMat);
  batched.frustumCulled = false;      // per-object culling handles the rest
  batched.sortObjects = false;
  batched.castShadow = false;
  batched.receiveShadow = false;
  root.add(batched);

  function addPart(geo, visible) {
    const id = batched.addGeometry(geo);
    _m1.makeTranslation(0, -999, 0);
    batched.setMatrixAt(id, _m1);
    batched.setVisibleAt(id, visible === true);
    geo.dispose();
    return id;
  }
  // pose helper — position + YXZ euler + uniform-ish scale
  function pose(id, x, y, z, yaw, pitch, roll, sx, sy, sz) {
    _e1.set(pitch || 0, yaw || 0, roll || 0, 'YXZ');
    _q1.setFromEuler(_e1);
    _v1.set(x, y, z);
    _v2.set(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz);
    _m1.compose(_v1, _q1, _v2);
    batched.setMatrixAt(id, _m1);
  }
  const show = (id, on) => batched.setVisibleAt(id, on);

  // =========================================================================
  // POOL B — InstancedMesh diamond flutter quad (moths, bats, leaves…)
  // =========================================================================
  const FLUT_N = 44;
  const flutGeo = new THREE.BufferGeometry();
  flutGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0, 0.42, 0, 0.5, 0, 0, 0, -0.42, 0], 3));
  flutGeo.setAttribute('normal', new THREE.Float32BufferAttribute(
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  flutGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const flutMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const flut = new THREE.InstancedMesh(flutGeo, flutMat, FLUT_N);
  flut.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flut.frustumCulled = false;
  flut.castShadow = false;
  root.add(flut);
  {
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < FLUT_N; i++) flut.setColorAt(i, c);
    _m1.makeScale(0, 0, 0);
    for (let i = 0; i < FLUT_N; i++) flut.setMatrixAt(i, _m1);
  }
  let flutCur = 0;
  const flutAlloc = (n) => { const s = flutCur; flutCur += n; return s; };
  function flutHide(i) { _m1.makeScale(0, 0, 0); flut.setMatrixAt(i, _m1); }
  // billboarded quad: camera-facing + roll + size
  function flutSet(i, x, y, z, roll, s, sy) {
    _q1.copy(g.camera.quaternion);
    _e1.set(0, 0, roll, 'YXZ'); _q2.setFromEuler(_e1);
    _q1.multiply(_q2);
    _v1.set(x, y, z); _v2.set(s, sy === undefined ? s : sy, s);
    _m1.compose(_v1, _q1, _v2);
    flut.setMatrixAt(i, _m1);
  }
  const flutColor = (i, r, gr, b) => { flut.setColorAt(i, _cTmp.setRGB(r, gr, b)); };
  const _cTmp = new THREE.Color();

  // =========================================================================
  // POOL C (additive glints) & POOL D (dark specks) — shader Points pools
  // =========================================================================
  function makePointPool(cap, frag, blending, order) {
    const pos = new Float32Array(cap * 3);
    const col = new Float32Array(cap * 3);
    const size = new Float32Array(cap);
    const alpha = new Float32Array(cap);
    for (let i = 0; i < cap; i++) pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(pos, 3); posA.setUsage(THREE.DynamicDrawUsage);
    const colA = new THREE.BufferAttribute(col, 3); colA.setUsage(THREE.DynamicDrawUsage);
    const sizeA = new THREE.BufferAttribute(size, 1); sizeA.setUsage(THREE.DynamicDrawUsage);
    const alphaA = new THREE.BufferAttribute(alpha, 1); alphaA.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posA);
    geo.setAttribute('aCol', colA);
    geo.setAttribute('aSize', sizeA);
    geo.setAttribute('aAlpha', alphaA);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PT_VERT, fragmentShader: frag,
      uniforms: { uPx: { value: 300 } },
      transparent: true, depthWrite: false, blending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = order;
    root.add(pts);
    return {
      pos, col, size, alpha, posA, colA, sizeA, alphaA, mat,
      cursor: 0, dirty: false,
      alloc(n) { const s = this.cursor; this.cursor += n; return s; },
      set(i, x, y, z, r, gr, b, sz, a) {
        const i3 = i * 3;
        this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
        this.col[i3] = r; this.col[i3 + 1] = gr; this.col[i3 + 2] = b;
        this.size[i] = sz; this.alpha[i] = a;
        this.dirty = true;
      },
      hide(i) { this.size[i] = 0; this.pos[i * 3 + 1] = -999; this.dirty = true; },
      flush() {
        if (!this.dirty) return;
        this.posA.needsUpdate = true; this.colA.needsUpdate = true;
        this.sizeA.needsUpdate = true; this.alphaA.needsUpdate = true;
        this.dirty = false;
      },
    };
  }
  const PC = makePointPool(384, PT_FRAG_ADD, THREE.AdditiveBlending, 3);   // glints
  const PD = makePointPool(176, PT_FRAG_DARK, THREE.NormalBlending, 2);    // specks

  // =========================================================================
  // POOL E — LineSegments (webs, silk, ropes, ice crack)
  // =========================================================================
  const SEG_N = 34;
  const linePos = new Float32Array(SEG_N * 2 * 3);
  const lineCol = new Float32Array(SEG_N * 2 * 3);
  for (let i = 0; i < SEG_N * 2; i++) linePos[i * 3 + 1] = -999;
  const lineGeo = new THREE.BufferGeometry();
  const linePosA = new THREE.BufferAttribute(linePos, 3); linePosA.setUsage(THREE.DynamicDrawUsage);
  const lineColA = new THREE.BufferAttribute(lineCol, 3); lineColA.setUsage(THREE.DynamicDrawUsage);
  lineGeo.setAttribute('position', linePosA);
  lineGeo.setAttribute('color', lineColA);
  lineGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  root.add(lines);
  let lineCur = 0, lineDirty = false;
  const segAlloc = (n) => { const s = lineCur; lineCur += n; return s; };
  function segSet(i, x1, y1, z1, x2, y2, z2, r, gr, b) {
    const o = i * 6;
    linePos[o] = x1; linePos[o + 1] = y1; linePos[o + 2] = z1;
    linePos[o + 3] = x2; linePos[o + 4] = y2; linePos[o + 5] = z2;
    lineCol[o] = r; lineCol[o + 1] = gr; lineCol[o + 2] = b;
    lineCol[o + 3] = r; lineCol[o + 4] = gr; lineCol[o + 5] = b;
    lineDirty = true;
  }
  function segHide(i) {
    const o = i * 6;
    linePos[o + 1] = -999; linePos[o + 4] = -999;
    lineDirty = true;
  }

  // =========================================================================
  // POOL F — InstancedMesh flat ring w/ vec4 tint (water rings, puddles,
  // footprint ovals)
  // =========================================================================
  const RING_N = 30;
  const ringGeo = new THREE.RingGeometry(0.30, 0.5, 14).rotateX(-Math.PI / 2);
  const ringTint = new THREE.InstancedBufferAttribute(new Float32Array(RING_N * 4), 4);
  ringTint.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute('aTint', ringTint);
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RING_N);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.frustumCulled = false;
  rings.renderOrder = 1;
  root.add(rings);
  {
    _m1.makeScale(0, 0, 0);
    for (let i = 0; i < RING_N; i++) rings.setMatrixAt(i, _m1);
  }
  let ringCur = 0;
  const ringAlloc = (n) => { const s = ringCur; ringCur += n; return s; };
  function ringSet(i, x, y, z, sx, sz, yaw, r, gr, b, a) {
    _e1.set(0, yaw || 0, 0, 'YXZ'); _q1.setFromEuler(_e1);
    _v1.set(x, y, z); _v2.set(sx, 1, sz);
    _m1.compose(_v1, _q1, _v2);
    rings.setMatrixAt(i, _m1);
    const o = i * 4;
    ringTint.array[o] = r; ringTint.array[o + 1] = gr;
    ringTint.array[o + 2] = b; ringTint.array[o + 3] = a;
    rings.instanceMatrix.needsUpdate = true;
    ringTint.needsUpdate = true;
  }
  function ringHide(i) {
    _m1.makeScale(0, 0, 0);
    rings.setMatrixAt(i, _m1);
    ringTint.array[i * 4 + 3] = 0;
    rings.instanceMatrix.needsUpdate = true;
    ringTint.needsUpdate = true;
  }
  // shared expanding water-ring FIFO (frogs, fish, striders, sparrow bath)
  const wr = { base: ringAlloc(12), n: 12, head: 0, act: [] };
  for (let i = 0; i < 12; i++) wr.act.push({ on: false, x: 0, y: 0, z: 0, age: 0, life: 1, s0: 0.2, s1: 1.4, a0: 0.5, r: 1, g: 1, b: 1 });
  function spawnRing(x, y, z, s0, s1, life, a0, r, gr, b) {
    const k = wr.head; wr.head = (wr.head + 1) % wr.n;
    const w = wr.act[k];
    w.on = true; w.x = x; w.y = y; w.z = z; w.age = 0; w.life = life;
    w.s0 = s0; w.s1 = s1; w.a0 = a0; w.r = r; w.g = gr; w.b = b;
  }
  function tickRings(dt) {
    for (let k = 0; k < wr.n; k++) {
      const w = wr.act[k];
      if (!w.on) continue;
      w.age += dt;
      if (w.age >= w.life) { w.on = false; ringHide(wr.base + k); continue; }
      const t = w.age / w.life;
      const s = lerp(w.s0, w.s1, t);
      ringSet(wr.base + k, w.x, w.y, w.z, s, s, 0, w.r, w.g, w.b, w.a0 * (1 - t));
    }
  }

  // =========================================================================
  // CLOTH — laundry line behind the inn (#18): one merged dynamic mesh,
  // 3 small vertex grids pinned to a sagging rope, gust-driven traveling wave.
  // =========================================================================
  const CLOTH_COLS = 5, CLOTH_ROWS = 4, CLOTH_N = 3;
  const clothW = 1.15, clothH = 1.05;
  anch(INN, -3.4, -5.6, _a1);
  anch(INN, 3.4, -5.6, _a2);
  const ropeA = new THREE.Vector3(_a1.x, terrainHeight(_a1.x, _a1.z) + 1.95, _a1.z);
  const ropeB = new THREE.Vector3(_a2.x, terrainHeight(_a2.x, _a2.z) + 1.95, _a2.z);
  const ropeDir = new THREE.Vector3().subVectors(ropeB, ropeA); // not normalized
  const ropeNrm = new THREE.Vector3(-ropeDir.z, 0, ropeDir.x).normalize(); // sway axis
  const clothVerts = CLOTH_N * CLOTH_COLS * CLOTH_ROWS;
  const clothPos = new Float32Array(clothVerts * 3);
  const clothGeo = new THREE.BufferGeometry();
  {
    const nrm = new Float32Array(clothVerts * 3);
    const col = new Float32Array(clothVerts * 3);
    const idx = [];
    const tints = [[0.92, 0.88, 0.80], [0.72, 0.60, 0.55], [0.58, 0.66, 0.72]]; // linen, rose, faded blue
    const rng = makeRng(5117);
    for (let c = 0; c < CLOTH_N; c++) {
      const t = tints[c];
      for (let vI = 0; vI < CLOTH_ROWS; vI++) {
        for (let u = 0; u < CLOTH_COLS; u++) {
          const k = (c * CLOTH_ROWS + vI) * CLOTH_COLS + u;
          nrm[k * 3] = ropeNrm.x; nrm[k * 3 + 1] = 0; nrm[k * 3 + 2] = ropeNrm.z;
          const j = 1 + (rng() - 0.5) * 0.12;
          col[k * 3] = clamp(t[0] * j, 0, 1); col[k * 3 + 1] = clamp(t[1] * j, 0, 1); col[k * 3 + 2] = clamp(t[2] * j, 0, 1);
        }
      }
      for (let vI = 0; vI < CLOTH_ROWS - 1; vI++) {
        for (let u = 0; u < CLOTH_COLS - 1; u++) {
          const k = (c * CLOTH_ROWS + vI) * CLOTH_COLS + u;
          idx.push(k, k + CLOTH_COLS, k + 1, k + 1, k + CLOTH_COLS, k + CLOTH_COLS + 1);
        }
      }
    }
    const posA = new THREE.BufferAttribute(clothPos, 3); posA.setUsage(THREE.DynamicDrawUsage);
    clothGeo.setAttribute('position', posA);
    clothGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    clothGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    clothGeo.setIndex(idx);
    clothGeo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((ropeA.x + ropeB.x) / 2, ropeA.y, (ropeA.z + ropeB.z) / 2), 8);
  }
  const clothMesh = new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide,
  }));
  clothMesh.castShadow = false;
  root.add(clothMesh);
  let clothDirty = false;
  function layCloth(swayPhase, amp) {
    // 3 cloths pinned at rope params .22/.5/.78; gust wave travels along rope
    for (let c = 0; c < CLOTH_N; c++) {
      const tc = 0.22 + c * 0.28;
      for (let u = 0; u < CLOTH_COLS; u++) {
        const tu = tc + (u / (CLOTH_COLS - 1) - 0.5) * (clothW / ropeDir.length());
        const sag = Math.sin(tu * Math.PI) * -0.22;
        const bx = ropeA.x + ropeDir.x * tu;
        const by = ropeA.y + ropeDir.y * tu + sag;
        const bz = ropeA.z + ropeDir.z * tu;
        for (let vI = 0; vI < CLOTH_ROWS; vI++) {
          const k = ((c * CLOTH_ROWS + vI) * CLOTH_COLS + u) * 3;
          const hang = vI / (CLOTH_ROWS - 1);
          const wave = Math.sin(swayPhase * 2.2 - (tu * 9 + c * 1.7) + hang * 2.6)
            * amp * hang * (0.6 + 0.4 * Math.sin(swayPhase * 0.9 + c * 2.4));
          const lift = amp * hang * hang * 0.45; // strong gusts lift the hem
          clothPos[k] = bx + ropeNrm.x * wave;
          clothPos[k + 1] = by - hang * clothH + lift * Math.abs(wave) * 0.9;
          clothPos[k + 2] = bz + ropeNrm.z * wave;
        }
      }
    }
    clothDirty = true;
  }
  layCloth(0, 0.05);

  // =========================================================================
  // CANDLES (#7) — own emissive window-glow quads at village house windows
  // =========================================================================
  const CAND = []; // {x,y,z,ry,house}
  {
    const H = { x: 0, z: 0, ry: 0 };
    for (let i = 0; i < HOUSES.length; i++) {
      const [hx, hz, w, d] = HOUSES[i];
      H.x = hx; H.z = hz; H.ry = Math.atan2(-hx, -hz);
      const gy = terrainHeight(hx, hz);
      for (const lx of [-0.28 * w, 0.28 * w]) {
        anch(H, lx, d / 2 + 0.16, _a1);
        CAND.push({ x: _a1.x, y: gy + 1.9, z: _a1.z, ry: H.ry, house: i });
      }
    }
    const gyInn = terrainHeight(INN.x, INN.z);
    for (const lx of [0.02 * INN.w, 0.3 * INN.w, -0.42 * INN.w]) {
      anch(INN, lx, INN.d / 2 + 0.16, _a1);
      CAND.push({ x: _a1.x, y: gyInn + 1.9, z: _a1.z, ry: INN.ry, house: 8 });
    }
  }
  const candGeo = new THREE.PlaneGeometry(0.46, 0.58);
  const candMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const candles = new THREE.InstancedMesh(candGeo, candMat, CAND.length);
  candles.renderOrder = 3;
  candles.castShadow = false;
  {
    const black = new THREE.Color(0, 0, 0);
    for (let i = 0; i < CAND.length; i++) {
      const c = CAND[i];
      _e1.set(0, c.ry, 0, 'YXZ'); _q1.setFromEuler(_e1);
      _v1.set(c.x, c.y, c.z); _v2.set(1, 1, 1);
      _m1.compose(_v1, _q1, _v2);
      candles.setMatrixAt(i, _m1);
      candles.setColorAt(i, black);
    }
    candles.instanceColor.setUsage(THREE.DynamicDrawUsage);
    candles.computeBoundingSphere();
  }
  root.add(candles);
  // per-house lighting state: 1 once lit tonight (dusk ritual ramps these)
  const houseLit = new Float32Array(9);

  // =========================================================================
  // AURORA (#14) — one ribbon over Drakespire, seeded some-nights-only
  // =========================================================================
  const aurUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 } };
  const aurora = new THREE.Mesh(
    (() => {
      const seg = 40, rows = 5;
      const pos = [], uv = [], idx = [];
      for (let r = 0; r <= rows; r++) {
        for (let i = 0; i <= seg; i++) {
          const u = i / seg, v = r / rows;
          const x = POI.peak.x - 620 + u * 1240;
          const z = POI.peak.z - 260 + Math.sin(u * 5.2) * 70 + v * 30;
          const y = 350 + v * 240 + Math.sin(u * 3.1) * 22;
          pos.push(x, y, z); uv.push(u, v);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < seg; i++) {
          const a = r * (seg + 1) + i;
          idx.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1);
        }
      }
      const geo2 = new THREE.BufferGeometry();
      geo2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo2.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo2.setIndex(idx);
      return geo2;
    })(),
    new THREE.ShaderMaterial({
      vertexShader: AUR_VERT, fragmentShader: AUR_FRAG, uniforms: aurUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    })
  );
  aurora.frustumCulled = false;
  aurora.renderOrder = 2;
  aurora.visible = false;
  root.add(aurora);

  // =========================================================================
  // CLOUD SHADOW (#43) — one soft dark blob sliding with the wind, day only
  // =========================================================================
  const cldUniforms = { uAlpha: { value: 0 }, uTime: { value: 0 } };
  const cloudShadow = new THREE.Mesh(
    new THREE.CircleGeometry(30, 22),
    new THREE.ShaderMaterial({
      vertexShader: CLD_VERT, fragmentShader: CLD_FRAG, uniforms: cldUniforms,
      transparent: true, depthWrite: false,
    })
  );
  cloudShadow.rotation.x = -Math.PI / 2;
  cloudShadow.frustumCulled = false;
  cloudShadow.renderOrder = 1;
  cloudShadow.visible = false;
  root.add(cloudShadow);
  const cldOff = { x: 24, z: -18 }; // offset from player, drifts + wraps

  // =========================================================================
  // WORLD SCANS (factory-time only) — shore / forest / marsh anchor points
  // =========================================================================
  const shorePts = [];
  {
    const L = POI.lake;
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      let prevWater = terrainHeight(L.x + ca * 16, L.z + sa * 16) < WATER_LEVEL;
      for (let r = 20; r < 260; r += 4) {
        const x = L.x + ca * r, z = L.z + sa * r;
        const land = terrainHeight(x, z) >= WATER_LEVEL + 0.3;
        if (prevWater && land) { shorePts.push({ x, z, a }); break; }
        prevWater = !land;
      }
    }
  }
  // fallback if the scan somehow found nothing
  if (shorePts.length === 0) shorePts.push({ x: POI.lake.x + 60, z: POI.lake.z, a: 0 });
  const byVillage = (p, q) => (p.x * p.x + p.z * p.z) - (q.x * q.x + q.z * q.z);
  const shoreSorted = shorePts.slice().sort(byVillage);
  const dockPt = shoreSorted[0];                       // shore nearest village
  const frogPts = shoreSorted.slice(0, 4);             // village-side shoreline
  const reedPt = shoreSorted[Math.min(1, shoreSorted.length - 1)];

  const forestPts = [];
  for (let k = 0; k < 26 && forestPts.length < 14; k++) {
    const a = (k / 26) * TAU;
    for (let r = 58; r <= 130; r += 24) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (biomeAt(x, z) === BIOME.FOREST) { forestPts.push({ x, z }); break; }
    }
  }
  if (forestPts.length === 0) forestPts.push({ x: 90, z: -120 }, { x: -80, z: -140 });

  let marshPt = null;
  {
    const L = POI.lake;
    for (let k = 0; k < 20 && !marshPt; k++) {
      const a = (k / 20) * TAU;
      for (let r = 40; r < 240; r += 8) {
        const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
        if (biomeAt(x, z) === BIOME.MARSH) { marshPt = { x, z }; break; }
      }
    }
    if (!marshPt) marshPt = { x: shoreSorted[shoreSorted.length - 1].x, z: shoreSorted[shoreSorted.length - 1].z };
  }

  // =========================================================================
  // ACTOR FRAMEWORK — 40u activation bubble, 3-bucket round-robin
  // =========================================================================
  const actors = [];
  function actor(x, z, r, fns) {
    const a = {
      x, z, r2: r * r, on: false,
      sway: !!fns.sway,
      enter: fns.enter || null, exit: fns.exit || null, tick: fns.tick,
    };
    actors.push(a);
    return a;
  }
  const ALWAYS = 1e6; // sky/peak/scheduler actors are bubble-exempt

  // player shortcuts, refreshed each frame
  let px = 0, py = 0, pz = 0, playerSpeed = 0;
  let swayT = 0;          // advances on rawDt — idle sway survives pause
  let frame = 0;
  const dtAcc = [0, 0, 0];

  // =========================================================================
  // ======================  THE 45 DETAILS  =================================
  // =========================================================================

  // -------------------------------------------------------------------------
  // #2 MOTHS orbiting lit lanterns at night (drawn to the player's torch)
  // -------------------------------------------------------------------------
  const mothSites = [[8, 9], [9, -9], [-8, 9], [14, -17]];
  const moths = { base: flutAlloc(12), t: [] };
  for (let i = 0; i < 12; i++) {
    moths.t.push({
      site: (i / 3) | 0,
      r: 0.28 + hash2(i, 3, 771) * 0.35,
      sp: 2.6 + hash2(i, 4, 771) * 2.2,
      ph: hash2(i, 5, 771) * TAU,
      h: 0.15 + hash2(i, 6, 771) * 0.5,
    });
  }
  actor(0, 0, 60, {
    enter() {
      for (let i = 0; i < 12; i++) flutColor(moths.base + i, 0.85, 0.8, 0.62);
      flut.instanceColor.needsUpdate = true;
    },
    exit() { for (let i = 0; i < 12; i++) flutHide(moths.base + i); flut.instanceMatrix.needsUpdate = true; },
    tick() {
      const f = g.time.dayFrac;
      const night = winEnv(f, 0.77, 0.235, 0.06);
      const torchOn = g.pointLight && g.pointLight.intensity > 0.4;
      for (let i = 0; i < 12; i++) {
        const m = moths.t[i];
        if (night < 0.02 || scared(mothSites[m.site][0], mothSites[m.site][1], 18)) {
          flutHide(moths.base + i); continue;
        }
        let cx = mothSites[m.site][0], cz = mothSites[m.site][1];
        let cy = terrainHeight(cx, cz) + 2.5;
        // torch temptation: the nearest site's moths drift to the flame
        if (torchOn && m.site === 0) {
          const lp = g.pointLight.position;
          if (dist2d(lp.x, lp.z, px, pz) < 30) { cx = lp.x; cz = lp.z; cy = lp.y + 0.2; }
        }
        const t = swayT * m.sp + m.ph;
        const wob = snoise(t * 0.35, i * 7.1);
        flutSet(moths.base + i,
          cx + Math.cos(t) * (m.r + wob * 0.2),
          cy + m.h + Math.sin(t * 1.7) * 0.22,
          cz + Math.sin(t * 0.93) * (m.r + wob * 0.2),
          Math.sin(t * 6) * 0.9, 0.075 + 0.03 * Math.sin(t * 11), 0.05);
      }
      flut.instanceMatrix.needsUpdate = true;
    },
  });

  // -------------------------------------------------------------------------
  // #3 NOON BELL — 4 bronze strikes at dayFrac ≈ 0.5, fauna scatter
  // -------------------------------------------------------------------------
  let prevDayFrac = g.time.dayFrac;
  let bellStrikes = 0, bellNextT = 0;
  function tickBell() {
    const f = g.time.dayFrac;
    if (prevDayFrac < 0.5 && f >= 0.5) {
      bellStrikes = 4; bellNextT = g.time.elapsed;
      scareAt(0, 0, 5);
    }
    if (bellStrikes > 0 && g.time.elapsed >= bellNextT) {
      bellStrikes--;
      bellNextT = g.time.elapsed + 1.35;
      const s = spatial(INN.x, terrainHeight(INN.x, INN.z) + 5, INN.z, 14, 220);
      if (s.ok && gate('bell', 0.5)) sBell(0.30 * s.vol, s.pan);
    }
    prevDayFrac = f;
  }

  // -------------------------------------------------------------------------
  // #4 CREAKING FORGE SIGN — hinge swing from gust, creak at the apex
  // -------------------------------------------------------------------------
  anch(FORGE, 2.55, 2.1, _a1);
  const signX = _a1.x, signZ = _a1.z;
  const signY = terrainHeight(signX, signZ) + 2.72;
  const signId = addPart(new Bake(901)
    .put(TPL.box, 0, -0.42, 0, 0.78, 0.55, 0.06, 0, 0, 0, 0x8a4a2c, 0.06)
    .put(TPL.box, 0, -0.09, 0, 0.1, 0.18, 0.04, 0, 0, 0, 0x3a3a40, 0.03)
    .put(TPL.box, 0, -0.42, 0.035, 0.5, 0.3, 0.01, 0, 0, 0, 0xd88c3a, 0.05)
    .geo(), false);
  const signState = { amp: 0, lastCreak: -9, prevSwing: 0, prevDelta: 0 };
  actor(signX, signZ, 42, {
    sway: true,
    enter() { show(signId, true); },
    exit() { show(signId, false); },
    tick() {
      signState.amp = lerp(signState.amp, 0.05 + wind.gust * 0.42, 0.04);
      const sw = Math.sin(swayT * 1.45) * signState.amp
        + Math.sin(swayT * 2.3 + 1.2) * signState.amp * 0.3;
      pose(signId, signX, signY, signZ, FORGE.ry, 0, sw);
      // creak at the reversal apex when swinging hard
      const delta = sw - signState.prevSwing;
      if (signState.prevDelta * delta < 0 && Math.abs(sw) > 0.2
        && swayT - signState.lastCreak > 1.4) {
        signState.lastCreak = swayT;
        const s = spatial(signX, signY, signZ, 4, 26);
        if (s.ok && gate('creak', 0.8)) sCreak(0.16 * s.vol, s.pan);
      }
      signState.prevDelta = delta;
      signState.prevSwing = sw;
    },
  });

  // -------------------------------------------------------------------------
  // #5 ANTS ON LOGS — my own fallen logs near forest paths, two opposing
  // lanes of dark points on baked spline lanes
  // -------------------------------------------------------------------------
  const antLogs = [];
  {
    const near = forestPts.slice().sort((p, q) =>
      (dist2d(p.x, p.z, 0, -66) - dist2d(q.x, q.z, 0, -66)));
    for (let L = 0; L < 3; L++) {
      const p = near[Math.min(L, near.length - 1)];
      const yaw = hash2(L, 9, 402) * TAU;
      const gy = terrainHeight(p.x, p.z);
      const logId = addPart(new Bake(910 + L)
        .put(TPL.cyl, 0, 0.26, 0, 0.5, 2.7, 0.5, Math.PI / 2, 0, 0, 0x5c4630, 0.14)
        .put(TPL.cyl, 0.3, 0.45, -0.6, 0.16, 0.7, 0.16, 1.1, 0.5, 0, 0x51402c, 0.1)
        .geo(), true);
      pose(logId, p.x, gy, p.z, yaw, 0, 0.04);
      const ants = { base: PD.alloc(16), t: new Float32Array(16), x: p.x, z: p.z, gy, yaw };
      for (let i = 0; i < 16; i++) ants.t[i] = hash2(L, i, 403);
      antLogs.push(ants);
      actor(p.x, p.z, 26, {
        tick(dt) {
          const ca = Math.cos(ants.yaw), sa = Math.sin(ants.yaw);
          for (let i = 0; i < 16; i++) {
            const fwd = i < 8 ? 1 : -1;
            let t = ants.t[i] + fwd * dt * (0.055 + (i % 4) * 0.011);
            t = ((t % 1) + 1) % 1;
            ants.t[i] = t;
            const s = (t - 0.5) * 2.55;
            const lane = fwd * 0.055 + snoise(t * 22 + i, i * 3.3) * 0.02;
            PD.set(ants.base + i,
              ants.x + sa * s + ca * lane,
              ants.gy + 0.53,
              ants.z + ca * s - sa * lane,
              0.06, 0.045, 0.03, 0.055, 0.95);
          }
        },
        exit() { for (let i = 0; i < 16; i++) PD.hide(ants.base + i); },
      });
    }
  }

  // -------------------------------------------------------------------------
  // #6 ANVIL CADENCE — smith figure (or lone hammer when an NPC works the
  // forge), 3-hit rhythm with shuffle pauses, daytime, orange sparks
  // -------------------------------------------------------------------------
  anch(FORGE, 0.7, 0.4, _a1);
  const anvilX = _a1.x, anvilZ = _a1.z;
  const anvilY = terrainHeight(FORGE.x, FORGE.z) + 0.92;
  const smithBodyId = addPart(new Bake(920)
    .put(TPL.box, 0, 0.55, 0, 0.46, 1.1, 0.3, 0, 0, 0, 0x5a4a3a, 0.07)
    .put(TPL.box, 0, 1.28, 0, 0.26, 0.26, 0.26, 0, 0, 0, 0xc79b6f, 0.06)
    .put(TPL.box, 0, 0.62, 0.17, 0.42, 0.7, 0.06, 0, 0, 0, 0x3d3730, 0.05)
    .geo(), false);
  const hammerId = addPart(new Bake(921)
    .put(TPL.box, 0, -0.3, 0, 0.05, 0.62, 0.05, 0, 0, 0, 0x6a4e2e, 0.05)
    .put(TPL.box, 0, 0, 0, 0.2, 0.12, 0.12, 0, 0, 0, 0x62666e, 0.04)
    .geo(), false);
  const smith = {
    sparks: PC.alloc(20), sIdx: 0, hitsLeft: 0, nextHit: 0, arm: 0, armV: 0,
    npcNear: false, npcCheckT: -9, npcArr: null,
    sparkAge: new Float32Array(20), sparkVX: new Float32Array(20),
    sparkVY: new Float32Array(20), sparkVZ: new Float32Array(20),
    sparkX: new Float32Array(20), sparkY: new Float32Array(20), sparkZ: new Float32Array(20),
  };
  actor(anvilX, anvilZ, 45, {
    exit() {
      show(smithBodyId, false); show(hammerId, false);
      for (let i = 0; i < 20; i++) PC.hide(smith.sparks + i);
    },
    tick(dt) {
      const f = g.time.dayFrac;
      const working = f > 0.31 && f < 0.68;
      // lazy NPC overlap check (Torvald lives at the forge) every 5s
      if (g.time.elapsed - smith.npcCheckT > 5) {
        smith.npcCheckT = g.time.elapsed;
        if (!smith.npcArr && g.quests && g.quests.npcs) smith.npcArr = Object.values(g.quests.npcs);
        smith.npcNear = false;
        if (smith.npcArr) {
          for (let i = 0; i < smith.npcArr.length; i++) {
            const n = smith.npcArr[i];
            const gp = n && n.group && n.group.position;
            if (gp && dist2d(gp.x, gp.z, anvilX, anvilZ) < 3) { smith.npcNear = true; break; }
          }
        }
      }
      show(smithBodyId, working && !smith.npcNear);
      show(hammerId, working);
      if (!working) { for (let i = 0; i < 20; i++) PC.hide(smith.sparks + i); return; }
      // 3-hit rhythm with shuffled rests
      if (g.time.elapsed >= smith.nextHit) {
        if (smith.hitsLeft <= 0) {
          smith.hitsLeft = 3;
          smith.nextHit = g.time.elapsed + 2.2 + hash2((g.time.elapsed * 10) | 0, 5, 921) * 3.2;
        } else {
          smith.hitsLeft--;
          smith.nextHit = g.time.elapsed + (smith.hitsLeft === 0 ? 0.9 : 0.52);
          smith.armV = -14;
          const s = spatial(anvilX, anvilY, anvilZ, 9, 90);
          if (s.ok && gate('clang', 0.3)) sClang(0.16 * s.vol, s.pan);
          // spark burst
          for (let k = 0; k < 5; k++) {
            const i = smith.sIdx; smith.sIdx = (smith.sIdx + 1) % 20;
            smith.sparkAge[i] = 0.001;
            smith.sparkX[i] = anvilX; smith.sparkY[i] = anvilY + 0.1; smith.sparkZ[i] = anvilZ;
            const a = Math.random() * TAU;
            smith.sparkVX[i] = Math.cos(a) * (0.8 + Math.random() * 1.6);
            smith.sparkVY[i] = 1.6 + Math.random() * 2.2;
            smith.sparkVZ[i] = Math.sin(a) * (0.8 + Math.random() * 1.6);
          }
        }
      }
      // hammer arm animation: raise slowly, strike fast
      smith.armV += (g.time.elapsed < smith.nextHit - 0.18 ? 6 : 26) * dt;
      smith.arm = clamp(smith.arm + smith.armV * dt, -0.2, 1.15);
      if (smith.arm <= -0.2 || smith.arm >= 1.15) smith.armV = 0;
      const lift = clamp(smith.arm, 0, 1);
      pose(smithBodyId, anvilX - 0.55, anvilY - 0.92, anvilZ - 0.2, FORGE.ry + 0.5, 0.08 * (1 - lift), 0);
      pose(hammerId, anvilX, anvilY + 0.25 + lift * 0.55, anvilZ, FORGE.ry, 0, -0.4 - lift * 1.5);
      // sparks fly, gravity pulls
      for (let i = 0; i < 20; i++) {
        if (smith.sparkAge[i] <= 0) continue;
        smith.sparkAge[i] += dt;
        if (smith.sparkAge[i] > 0.7) { smith.sparkAge[i] = 0; PC.hide(smith.sparks + i); continue; }
        smith.sparkVY[i] -= 9 * dt;
        smith.sparkX[i] += smith.sparkVX[i] * dt;
        smith.sparkY[i] += smith.sparkVY[i] * dt;
        smith.sparkZ[i] += smith.sparkVZ[i] * dt;
        const life = 1 - smith.sparkAge[i] / 0.7;
        PC.set(smith.sparks + i, smith.sparkX[i], smith.sparkY[i], smith.sparkZ[i],
          1.0, 0.55 * life + 0.1, 0.08 * life, 0.09, life);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #7 WINDOW CANDLE FLICKER — handled per tick here (village-wide actor)
  // -------------------------------------------------------------------------
  actor(0, 0, 130, {
    exit() {
      _cTmp.setRGB(0, 0, 0);
      for (let i = 0; i < CAND.length; i++) candles.setColorAt(i, _cTmp);
      candles.instanceColor.needsUpdate = true;
    },
    tick() {
      const f = g.time.dayFrac;
      const nightBase = winEnv(f, 0.72, 0.26, 0.10); // candles live from dusk to dawn
      const e = g.time.elapsed;
      for (let i = 0; i < CAND.length; i++) {
        const c = CAND[i];
        // lantern-lighting ritual gates each house's first glow of the night
        let lv = nightBase * (f > 0.70 && f < 0.85 ? houseLit[c.house] : 1);
        if (lv > 0.01) {
          // ±12% snoise flicker
          lv *= 1 + snoise(e * 3.1, i * 13.7) * 0.12;
          // one window occasionally goes dark, then relights
          const slot = (e / 22) | 0;
          if (i === (slot * 7) % CAND.length && hash2(slot, i, 553) < 0.35) {
            const ph = (e % 22) / 22;
            if (ph > 0.4 && ph < 0.55) lv = 0;
            else if (ph >= 0.55 && ph < 0.6) lv *= (ph - 0.55) / 0.05;
          }
        }
        _cTmp.setRGB(1.0 * lv, 0.62 * lv, 0.24 * lv);
        candles.setColorAt(i, _cTmp);
      }
      candles.instanceColor.needsUpdate = true;
    },
  });

  // -------------------------------------------------------------------------
  // #8 WIND CHIMES at the inn door — 5 tubes, gust-triggered pentatonic
  // plucks drowned in reverb
  // -------------------------------------------------------------------------
  anch(INN, -INN.w * 0.24, INN.d / 2 + 0.55, _a1);
  const chimeX = _a1.x, chimeZ = _a1.z;
  const chimeY = terrainHeight(INN.x, INN.z) + 2.62;
  const chimeIds = [];
  for (let i = 0; i < 5; i++) {
    chimeIds.push(addPart(new Bake(930 + i)
      .put(TPL.cyl, 0, -0.19 - i * 0.02, 0, 0.055, 0.38 + i * 0.05, 0.055, 0, 0, 0, 0xb9a06a, 0.05)
      .geo(), false));
  }
  const chime = { nextPluck: 0, energy: 0 };
  actor(chimeX, chimeZ, 42, {
    sway: true,
    enter() { for (const id of chimeIds) show(id, true); },
    exit() { for (const id of chimeIds) show(id, false); },
    tick() {
      chime.energy = lerp(chime.energy, wind.gust, 0.05);
      const ca = Math.cos(INN.ry), sa = Math.sin(INN.ry);
      for (let i = 0; i < 5; i++) {
        const lx = (i - 2) * 0.13;
        const sw = Math.sin(swayT * (2.1 + i * 0.37) + i * 1.9) * (0.03 + chime.energy * 0.3);
        const sw2 = Math.cos(swayT * (1.7 + i * 0.23) + i) * (0.02 + chime.energy * 0.2);
        pose(chimeIds[i], chimeX + lx * ca, chimeY, chimeZ - lx * sa, INN.ry, sw, sw2);
      }
      if ((gustSpike || (wind.gust > 0.62 && Math.random() < 0.02)) && g.time.elapsed > chime.nextPluck) {
        chime.nextPluck = g.time.elapsed + 1.6;
        const s = spatial(chimeX, chimeY, chimeZ, 6, 42);
        if (s.ok && gate('chime', 1.2)) {
          const vv = s.vol, pp = s.pan; // _sp is shared scratch — capture now
          const n = 2 + ((Math.random() * 3) | 0);
          for (let k = 0; k < n; k++) {
            setTimeout(() => {
              if (AC) sChime((Math.random() * 5) | 0, 0.12 * vv, pp);
            }, k * (90 + Math.random() * 80));
          }
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // #9 CHICKEN FLOCK near the well — peck / scratch / wander, dust puffs,
  // flee-flap + clucks; converge on the morning grain (#19)
  // -------------------------------------------------------------------------
  const HEN_HOME = { x: 5, z: -8 };
  const feedPt = { x: 0, z: 0, until: -1 };  // set by the chore villager
  const hens = [];
  const henDust = { base: PD.alloc(12), idx: 0, age: new Float32Array(12), x: new Float32Array(12), y: new Float32Array(12), z: new Float32Array(12) };
  function puffAt(x, y, z) {
    const i = henDust.idx; henDust.idx = (henDust.idx + 1) % 12;
    henDust.age[i] = 0.001; henDust.x[i] = x; henDust.y[i] = y; henDust.z[i] = z;
  }
  for (let i = 0; i < 4; i++) {
    const tint = [0xd8cdb4, 0xb98a51, 0xd8cdb4, 0x8a6a45][i];
    const id = addPart(new Bake(940 + i)
      .put(TPL.box, 0, 0.17, 0, 0.3, 0.26, 0.4, 0, 0, 0, tint, 0.09)
      .put(TPL.box, 0, 0.36, 0.2, 0.11, 0.14, 0.11, 0, 0, 0, tint, 0.06)
      .put(TPL.box, 0, 0.44, 0.2, 0.04, 0.06, 0.07, 0, 0, 0, 0xc23b2c, 0.05)
      .put(TPL.cone, 0, 0.34, 0.28, 0.05, 0.09, 0.05, 1.57, 0, 0, 0xd8a03a, 0.05)
      .geo(), false);
    hens.push({
      id, x: HEN_HOME.x + hash2(i, 1, 620) * 4 - 2, z: HEN_HOME.z + hash2(i, 2, 620) * 4 - 2,
      yaw: hash2(i, 3, 620) * TAU, state: 0, t: hash2(i, 4, 620) * 2, // 0 idle 1 walk 2 peck 3 flee
      tx: 0, tz: 0, ph: hash2(i, 5, 620) * TAU, cluckT: 0,
    });
  }
  actor(HEN_HOME.x, HEN_HOME.z, 45, {
    enter() { for (const h of hens) show(h.id, true); },
    exit() {
      for (const h of hens) show(h.id, false);
      for (let i = 0; i < 12; i++) PD.hide(henDust.base + i);
    },
    tick(dt) {
      const e = g.time.elapsed;
      const feeding = e < feedPt.until;
      for (let k = 0; k < 4; k++) {
        const h = hens[k];
        const dP = dist2d(h.x, h.z, px, pz);
        // flee: player too close or the noon bell rang
        if (h.state !== 3 && (dP < 2.4 || scared(h.x, h.z, 16))) {
          h.state = 3; h.t = 0.9 + Math.random() * 0.5;
          const a = Math.atan2(h.x - px, h.z - pz);
          h.tx = h.x + Math.sin(a) * 4.5; h.tz = h.z + Math.cos(a) * 4.5;
          const s = spatial(h.x, 8, h.z, 4, 22);
          if (s.ok && gate('cluck' + k, 0.5)) { sCluck(0.2 * s.vol, s.pan); }
          puffAt(h.x, terrainHeight(h.x, h.z) + 0.15, h.z);
        }
        h.t -= dt;
        if (h.state === 3) {
          const a = Math.atan2(h.tx - h.x, h.tz - h.z);
          h.yaw = a;
          h.x += Math.sin(a) * 3.8 * dt; h.z += Math.cos(a) * 3.8 * dt;
          if (h.t <= 0) h.state = 0;
        } else if (feeding && dist2d(h.x, h.z, feedPt.x, feedPt.z) > 0.9) {
          const a = Math.atan2(feedPt.x - h.x, feedPt.z - h.z);
          h.yaw = lerp(h.yaw, a, 0.25);
          h.x += Math.sin(h.yaw) * 1.7 * dt; h.z += Math.cos(h.yaw) * 1.7 * dt;
          h.state = 1;
        } else if (h.t <= 0) {
          const r = Math.random();
          if (r < 0.42) { // peck or scratch in place
            h.state = 2; h.t = 1.2 + Math.random() * 1.6;
            if (r < 0.14) puffAt(h.x, terrainHeight(h.x, h.z) + 0.12, h.z); // scratch
          } else if (r < 0.8) { // wander
            h.state = 1; h.t = 1 + Math.random() * 2;
            const a = Math.random() * TAU;
            const wx = HEN_HOME.x + Math.sin(a) * (1 + Math.random() * 4.5);
            const wz = HEN_HOME.z + Math.cos(a) * (1 + Math.random() * 4.5);
            h.tx = wx; h.tz = wz;
          } else { h.state = 0; h.t = 0.8 + Math.random() * 1.5; }
          if (Math.random() < 0.2) {
            const s = spatial(h.x, 8, h.z, 3.5, 18);
            if (s.ok && gate('clucki', 1.5)) sCluck(0.10 * s.vol, s.pan);
          }
        } else if (h.state === 1) {
          const a = Math.atan2(h.tx - h.x, h.tz - h.z);
          h.yaw = lerp(h.yaw, a, 0.15);
          if (dist2d(h.x, h.z, h.tx, h.tz) > 0.3) {
            h.x += Math.sin(h.yaw) * 1.1 * dt; h.z += Math.cos(h.yaw) * 1.1 * dt;
          } else h.t = 0;
        }
        const gy = terrainHeight(h.x, h.z);
        const peck = h.state === 2 ? (0.5 + 0.5 * Math.sin(e * 9 + h.ph)) * 0.55 : 0;
        const bob = h.state === 1 ? Math.abs(Math.sin(e * 8 + h.ph)) * 0.05 : 0;
        const hop = h.state === 3 ? Math.abs(Math.sin(e * 13 + h.ph)) * 0.16 : 0;
        pose(h.id, h.x, gy + bob + hop, h.z, h.yaw, peck, h.state === 3 ? Math.sin(e * 26) * 0.2 : 0);
      }
      // dust puffs age out
      for (let i = 0; i < 12; i++) {
        if (henDust.age[i] <= 0) continue;
        henDust.age[i] += dt;
        if (henDust.age[i] > 0.8) { henDust.age[i] = 0; PD.hide(henDust.base + i); continue; }
        const t = henDust.age[i] / 0.8;
        PD.set(henDust.base + i, henDust.x[i], henDust.y[i] + t * 0.35, henDust.z[i],
          0.62, 0.55, 0.44, 0.25 + t * 0.5, 0.4 * (1 - t));
      }
    },
  });

  // -------------------------------------------------------------------------
  // #10 SUN/MOON GLITTER PATH on Mirrormere — 80 blinking additive points
  // strewn along the reflection azimuth, low light angles only
  // -------------------------------------------------------------------------
  const glit = { base: PC.alloc(80), on: false, reposT: -9, blinkI: 0 };
  actor(POI.lake.x, POI.lake.z, 200, {
    exit() { for (let i = 0; i < 80; i++) PC.hide(glit.base + i); glit.on = false; },
    tick() {
      const sky = g.sky;
      if (!sky) return;
      const sunEl = sky.sunDir.y;
      const day = sunEl > 0.015;
      const sunLow = day && sunEl < 0.42;
      const moonUp = !day && sunEl < -0.12;
      if (!sunLow && !moonUp) {
        if (glit.on) { for (let i = 0; i < 80; i++) PC.hide(glit.base + i); glit.on = false; }
        return;
      }
      const az = Math.max(0.05, Math.hypot(sky.sunDir.x, sky.sunDir.z));
      let dx = sky.sunDir.x / az, dz = sky.sunDir.z / az;
      if (moonUp) { dx = -dx; dz = -dz; }
      const e = g.time.elapsed;
      // re-lay the path when stale or the player moved
      if (e - glit.reposT > 0.5) {
        glit.reposT = e;
        glit.on = true;
        for (let i = 0; i < 80; i++) {
          const d = 5 + i * 2.3;
          const x = px + dx * d + snoise(i * 3.7, e * 0.05) * (1 + i * 0.09);
          const z = pz + dz * d + snoise(i * 5.1 + 40, e * 0.05) * (1 + i * 0.09);
          if (terrainHeight(x, z) < WATER_LEVEL - 0.2) {
            const fade = 1 - i / 90;
            const tw = 0.4 + 0.6 * hash2(i, (e * 3) | 0, 808);
            // size grows with distance → roughly constant angular sparkle
            const sz = (0.22 + i * 0.028) * tw;
            if (moonUp) PC.set(glit.base + i, x, WATER_LEVEL + 0.06, z, 0.75, 0.82, 1.0, sz, 0.6 * fade * tw);
            else PC.set(glit.base + i, x, WATER_LEVEL + 0.06, z, 1.0, 0.72, 0.35, sz * 1.1, 0.7 * fade * tw);
          } else PC.hide(glit.base + i);
        }
      } else {
        // cheap per-tick blink on a rotating subset
        for (let k = 0; k < 10; k++) {
          const i = (glit.blinkI + k) % 80;
          const tw = 0.35 + 0.65 * hash2(i, (e * 4) | 0, 809);
          PC.alpha[glit.base + i] = (moonUp ? 0.6 : 0.7) * (1 - i / 90) * tw;
        }
        glit.blinkI = (glit.blinkI + 10) % 80;
        PC.dirty = true;
      }
    },
  });

  // -------------------------------------------------------------------------
  // #11 DEW SPARKLE at dawn — 120 grass-top glints around the player
  // -------------------------------------------------------------------------
  const dew = { base: PC.alloc(120), placed: false, cx: 0, cz: 0, scanI: 0, twI: 0 };
  actor(0, 0, ALWAYS, {
    tick() {
      const f = g.time.dayFrac;
      const env = winEnv(f, 0.2, 0.3, 0.2);
      if (env <= 0.01) {
        if (dew.placed) { for (let i = 0; i < 120; i++) PC.hide(dew.base + i); dew.placed = false; }
        return;
      }
      if (!dew.placed || dist2d(px, pz, dew.cx, dew.cz) > 18) {
        dew.placed = true; dew.cx = px; dew.cz = pz; dew.scanI = 0;
      }
      // amortized (re)scatter: 10 points per tick
      for (let k = 0; k < 10 && dew.scanI < 120; k++, dew.scanI++) {
        const i = dew.scanI;
        const a = hash2(i, 71, 550) * TAU;
        const r = 3 + hash2(i, 72, 550) * 22;
        const x = dew.cx + Math.cos(a) * r, z = dew.cz + Math.sin(a) * r;
        const b = biomeAt(x, z);
        if (b === BIOME.MEADOW || b === BIOME.FOREST) {
          PC.set(dew.base + i, x, terrainHeight(x, z) + 0.22, z, 0.85, 0.95, 1.0, 0.16, 0.5);
        } else PC.hide(dew.base + i);
      }
      // twinkle a rotating subset, scaled by the dawn envelope
      const e = g.time.elapsed;
      for (let k = 0; k < 14; k++) {
        const i = (dew.twI + k) % 120;
        const tw = hash2(i, (e * 2.5) | 0, 551);
        PC.alpha[dew.base + i] = env * (tw > 0.72 ? 0.85 : 0.18 + tw * 0.3);
      }
      dew.twI = (dew.twI + 14) % 120;
      PC.dirty = true;
    },
  });

  // -------------------------------------------------------------------------
  // #12 SHOOTING STARS — streak + fading tail every 40–120 s, 1/10 big
  // -------------------------------------------------------------------------
  const star = {
    base: PC.alloc(14), on: false, next: 50, t: 0, life: 1.1, big: false,
    ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0,
  };
  function tickStars(dt) { // every frame — fast movers need smooth motion
    const f = g.time.dayFrac;
    const night = f > 0.82 || f < 0.18;
    if (!star.on) {
      if (!night) return;
      star.next -= dt;
      if (star.next > 0) return;
      star.next = 40 + Math.random() * 80;
      star.on = true; star.t = 0;
      star.big = Math.random() < 0.1;
      star.life = star.big ? 1.9 : 1.0;
      const a = Math.random() * TAU, el = 0.55 + Math.random() * 0.5;
      star.ox = Math.cos(a) * 700 * Math.cos(el); star.oy = 500 + el * 400; star.oz = Math.sin(a) * 700 * Math.cos(el);
      const a2 = a + 1.2 + Math.random() * 1.4;
      star.vx = Math.cos(a2) * 520; star.vy = -140 - Math.random() * 120; star.vz = Math.sin(a2) * 520;
    }
    star.t += dt;
    if (star.t >= star.life || !night) {
      star.on = false;
      for (let i = 0; i < 14; i++) PC.hide(star.base + i);
      return;
    }
    const cp = g.camera.position;
    const fade = Math.sin(Math.min(1, star.t / star.life) * Math.PI);
    const n = star.big ? 14 : 9;
    for (let i = 0; i < 14; i++) {
      if (i >= n) { PC.hide(star.base + i); continue; }
      const back = i * (star.big ? 0.016 : 0.011);
      const tt = star.t - back;
      if (tt < 0) { PC.hide(star.base + i); continue; }
      const tail = 1 - i / n;
      PC.set(star.base + i,
        cp.x + star.ox + star.vx * tt, cp.y + star.oy + star.vy * tt, cp.z + star.oz + star.vz * tt,
        0.95, 0.97, 1.0, (star.big ? 15 : 8.5) * tail, fade * tail * (star.big ? 0.95 : 0.7));
    }
  }

  // -------------------------------------------------------------------------
  // #13 RATS behind the inn at night — dash-pause-dash between barrels,
  // squeak + vanish when you get close
  // -------------------------------------------------------------------------
  const ratWays = [[20.5, 14.5], [23.5, 16.5], [21.8, 13.4], [19.4, 16.6]];
  const rats = [];
  for (let i = 0; i < 2; i++) {
    const id = addPart(new Bake(950 + i)
      .put(TPL.box, 0, 0.07, 0, 0.13, 0.12, 0.3, 0, 0, 0, 0x4a4038, 0.1)
      .put(TPL.box, 0, 0.05, -0.24, 0.03, 0.03, 0.2, 0, 0, 0, 0x6a5a4c, 0.05)
      .put(TPL.box, 0, 0.11, 0.16, 0.07, 0.07, 0.09, 0, 0, 0, 0x4a4038, 0.08)
      .geo(), false);
    rats.push({
      id, w: i * 2, x: ratWays[i * 2][0], z: ratWays[i * 2][1],
      state: 0, t: 1 + i, yaw: 0, hideT: -1,
    });
  }
  actor(21.5, 15, 38, {
    exit() { for (const r of rats) show(r.id, false); },
    tick(dt) {
      const f = g.time.dayFrac;
      const night = f > 0.78 || f < 0.24;
      for (const r of rats) {
        if (!night || g.time.elapsed < r.hideT) { show(r.id, false); continue; }
        // spooked → squeak and vanish under the barrels
        if (dist2d(r.x, r.z, px, pz) < 3.4) {
          const s = spatial(r.x, 9, r.z, 4, 14);
          if (s.ok && gate('squeak', 0.6)) sSqueak(0.14 * s.vol, s.pan);
          r.hideT = g.time.elapsed + 18 + Math.random() * 22;
          show(r.id, false);
          continue;
        }
        show(r.id, true);
        r.t -= dt;
        if (r.state === 0) { // paused, sniffing
          if (r.t <= 0) {
            r.state = 1;
            r.w = (r.w + 1 + ((Math.random() * 2) | 0)) % ratWays.length;
            r.t = 3;
          }
        } else { // dashing
          const wp = ratWays[r.w];
          const a = Math.atan2(wp[0] - r.x, wp[1] - r.z);
          r.yaw = a;
          r.x += Math.sin(a) * 3.4 * dt; r.z += Math.cos(a) * 3.4 * dt;
          if (dist2d(r.x, r.z, wp[0], wp[1]) < 0.25 || r.t <= 0) {
            r.state = 0; r.t = 0.6 + Math.random() * 2.2;
          }
        }
        const sniff = r.state === 0 ? Math.sin(g.time.elapsed * 7) * 0.06 : 0;
        pose(r.id, r.x, terrainHeight(r.x, r.z) + 0.02, r.z, r.yaw, sniff, 0);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #14 AURORA over Drakespire — deep night, seeded some-nights-only
  // -------------------------------------------------------------------------
  function tickAurora() {
    const f = g.time.dayFrac;
    const deep = winEnv(f, 0.90, 0.10, 0.25);
    let alpha = 0;
    if (deep > 0.001) {
      const dayIdx = Math.floor(g.time.elapsed / g.time.dayLength + 0.3 + 0.5);
      if (hash2(dayIdx, 913, 12) < 0.45) {
        alpha = deep * (0.5 + 0.5 * fbm(g.time.elapsed * 0.01, 77.7, 2));
      }
    }
    aurUniforms.uAlpha.value = alpha * 0.5;
    aurUniforms.uTime.value = g.time.elapsed;
    aurora.visible = alpha > 0.01;
  }

  // -------------------------------------------------------------------------
  // #15 CROWS at the ruins and the village fence — hop-turn, caw (big verb
  // at the ruins), flush and resettle when approached
  // -------------------------------------------------------------------------
  function makeCrowSite(cx, cz, count, seed, ruinsVerb) {
    const birds = [];
    for (let i = 0; i < count; i++) {
      const id = addPart(new Bake(seed + i)
        .put(TPL.box, 0, 0.12, 0, 0.16, 0.16, 0.34, 0, 0, 0, 0x17181c, 0.12)
        .put(TPL.box, 0, 0.24, 0.16, 0.09, 0.1, 0.12, 0, 0, 0, 0x1a1b20, 0.1)
        .put(TPL.cone, 0, 0.22, 0.26, 0.04, 0.1, 0.04, 1.57, 0, 0, 0x3c3830, 0.05)
        .put(TPL.box, 0, 0.13, -0.22, 0.1, 0.04, 0.16, -0.25, 0, 0, 0x17181c, 0.08)
        .geo(), false);
      birds.push({
        id,
        hx: cx + hash2(seed, i * 3, 45) * 6 - 3, hz: cz + hash2(seed, i * 3 + 1, 45) * 6 - 3,
        x: 0, z: 0, yaw: hash2(seed, i * 3 + 2, 45) * TAU,
        t: i * 1.3, cawT: 4 + i * 6, fly: -1, fa: 0,
      });
      birds[i].x = birds[i].hx; birds[i].z = birds[i].hz;
    }
    actor(cx, cz, 55, {
      enter() { for (const b of birds) show(b.id, true); },
      exit() { for (const b of birds) show(b.id, false); },
      tick(dt) {
        for (const b of birds) {
          const gy = terrainHeight(b.x, b.z);
          if (b.fly < 0 && (dist2d(b.x, b.z, px, pz) < 7 || scared(b.x, b.z, 20))) {
            b.fly = 0; b.fa = Math.atan2(b.x - px, b.z - pz);
            const s = spatial(b.x, gy, b.z, 6, 40);
            if (s.ok && gate('cawF', 0.4)) sCaw(0.2 * s.vol, s.pan, ruinsVerb);
          }
          if (b.fly >= 0) { // flushed: a rising loop away, then resettle
            b.fly += dt;
            const t = b.fly;
            if (t > 9) { b.fly = -1; b.x = b.hx; b.z = b.hz; continue; }
            const climb = Math.sin(Math.min(1, t / 2.2) * Math.PI * 0.5) * 6;
            const circ = t * 0.9;
            b.x = b.hx + Math.sin(b.fa + circ) * (4 + t * 1.5);
            b.z = b.hz + Math.cos(b.fa + circ) * (4 + t * 1.5);
            b.yaw = b.fa + circ + Math.PI / 2;
            const land = smoothstep(9, 6.4, t);
            pose(b.id, b.x, terrainHeight(b.x, b.z) + 0.05 + climb * land, b.z,
              b.yaw, Math.sin(t * 14) * 0.3, Math.sin(t * 7) * 0.5);
            continue;
          }
          b.t -= dt; b.cawT -= dt;
          if (b.t <= 0) { // hop-turn
            b.t = 1.6 + hash2((g.time.elapsed * 7) | 0, b.id, 46) * 3.4;
            b.yaw += (Math.random() - 0.5) * 2.4;
            b.x = clamp(b.x + Math.sin(b.yaw) * 0.35, b.hx - 3.5, b.hx + 3.5);
            b.z = clamp(b.z + Math.cos(b.yaw) * 0.35, b.hz - 3.5, b.hz + 3.5);
          }
          if (b.cawT <= 0) {
            b.cawT = 8 + Math.random() * 14;
            const s = spatial(b.x, gy, b.z, 7, 55);
            if (s.ok && gate('caw', 1.1)) sCaw(0.17 * s.vol, s.pan, ruinsVerb);
          }
          const hopP = Math.max(0, 1 - b.t * 4);
          pose(b.id, b.x, gy + hopP * 0.12, b.z, b.yaw, 0, 0);
        }
      },
    });
  }
  makeCrowSite(POI.ruins.x + 4, POI.ruins.z - 2, 3, 960, 0.85); // ruins: cathedral caws
  makeCrowSite(42, -14, 1, 970, 0.2);                            // village fence line

  // -------------------------------------------------------------------------
  // #16 FROGS at the lake edge — dusk call-answer chorus; the silence as you
  // near is the tell; hop-plop + ring if you push in
  // -------------------------------------------------------------------------
  const frogs = [];
  for (let i = 0; i < 4; i++) {
    const p = frogPts[Math.min(i, frogPts.length - 1)];
    const id = addPart(new Bake(980 + i)
      .put(TPL.box, 0, 0.08, 0, 0.2, 0.13, 0.26, 0, 0, 0, 0x4a6a35, 0.12)
      .put(TPL.box, -0.06, 0.16, 0.09, 0.05, 0.05, 0.05, 0, 0, 0, 0x2c401e, 0.06)
      .put(TPL.box, 0.06, 0.16, 0.09, 0.05, 0.05, 0.05, 0, 0, 0, 0x2c401e, 0.06)
      .geo(), false);
    frogs.push({
      id, x: p.x + hash2(i, 8, 71) * 3 - 1.5, z: p.z + hash2(i, 9, 71) * 3 - 1.5,
      yaw: hash2(i, 10, 71) * TAU, gone: -1, hop: -1, hx: 0, hz: 0,
    });
  }
  const frogChorus = { next: 3, caller: 0 };
  {
    let mx = 0, mz = 0;
    for (const fr of frogs) { mx += fr.x / 4; mz += fr.z / 4; }
    actor(mx, mz, 70, {
      enter() { for (const fr of frogs) { if (fr.gone < 0) show(fr.id, true); } },
      exit() { for (const fr of frogs) show(fr.id, false); },
      tick(dt) {
        const f = g.time.dayFrac;
        const chorusOn = inWin(f, 0.66, 0.99);
        const e = g.time.elapsed;
        for (const fr of frogs) {
          if (fr.gone > 0 && e > fr.gone) { fr.gone = -1; show(fr.id, true); }
          if (fr.gone > 0) continue;
          const dP = dist2d(fr.x, fr.z, px, pz);
          if (fr.hop < 0 && dP < 3.6) {
            // startled: leap for the water
            fr.hop = 0;
            const a = Math.atan2(POI.lake.x - fr.x, POI.lake.z - fr.z);
            fr.hx = fr.x + Math.sin(a) * 1.6; fr.hz = fr.z + Math.cos(a) * 1.6;
            fr.yaw = a;
          }
          if (fr.hop >= 0) {
            fr.hop += dt * 2.4;
            if (fr.hop >= 1) {
              const s = spatial(fr.hx, WATER_LEVEL, fr.hz, 5, 24);
              if (s.ok && gate('plop', 0.3)) sPlop(0.2 * s.vol, s.pan);
              spawnRing(fr.hx, WATER_LEVEL + 0.05, fr.hz, 0.15, 1.3, 1.4, 0.5, 0.7, 0.85, 0.9);
              fr.hop = -1; fr.gone = e + 26 + Math.random() * 20;
              show(fr.id, false);
              continue;
            }
            const t = fr.hop;
            pose(fr.id, lerp(fr.x, fr.hx, t), terrainHeight(fr.x, fr.z) + Math.sin(t * Math.PI) * 0.5,
              lerp(fr.z, fr.hz, t), fr.yaw, -0.4 + t * 0.8, 0);
            continue;
          }
          const puff = chorusOn && dP > 12 ? (0.5 + 0.5 * Math.sin(e * 3 + fr.id)) * 0.12 : 0;
          pose(fr.id, fr.x, terrainHeight(fr.x, fr.z) + 0.02, fr.z, fr.yaw, 0, 0, 1 + puff, 1 + puff * 2, 1 + puff);
        }
        // call-answer: one croaks, another answers a beat later — but any
        // frog within 12u of the player keeps quiet (silence-as-you-near)
        frogChorus.next -= dt;
        if (chorusOn && frogChorus.next <= 0) {
          frogChorus.next = 3 + Math.random() * 4.5;
          const a = frogs[frogChorus.caller % 4];
          const b = frogs[(frogChorus.caller + 1 + ((Math.random() * 2) | 0)) % 4];
          frogChorus.caller++;
          if (a.gone < 0 && dist2d(a.x, a.z, px, pz) > 12) {
            const s = spatial(a.x, WATER_LEVEL + 1, a.z, 8, 60);
            if (s.ok && gate('croak', 0.8)) sCroak(1, 0.2 * s.vol, s.pan);
          }
          if (b !== a && b.gone < 0 && dist2d(b.x, b.z, px, pz) > 12) {
            const s2 = spatial(b.x, WATER_LEVEL + 1, b.z, 8, 60);
            if (s2.ok) {
              const vv = s2.vol, pp = s2.pan; // capture: _sp is shared scratch
              setTimeout(() => { if (AC && !g.paused) sCroak(1.22, 0.16 * vv, pp); }, 620);
            }
          }
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // #17 FISH JUMP — parabola leap + droplet sparkle + ring, every 20–60 s
  // -------------------------------------------------------------------------
  const fishId = addPart(new Bake(990)
    .put(TPL.box, 0, 0, 0, 0.09, 0.14, 0.34, 0, 0, 0, 0x7c8894, 0.12)
    .put(TPL.cone, 0, 0, -0.24, 0.12, 0.14, 0.03, 1.57, 0, 0, 0x6a7684, 0.08)
    .geo(), false);
  const fish = { next: 15, t: -1, x: 0, z: 0, yaw: 0, drops: PC.alloc(8), dropT: -1 };
  actor(POI.lake.x, POI.lake.z, 130, {
    exit() { show(fishId, false); for (let i = 0; i < 8; i++) PC.hide(fish.drops + i); },
    tick(dt) {
      if (fish.t < 0) {
        fish.next -= dt;
        if (fish.next <= 0) {
          // find water 12–30u from the player (a few tries, else re-arm)
          let found = false;
          for (let k = 0; k < 4; k++) {
            const a = Math.random() * TAU, d = 12 + Math.random() * 18;
            const x = px + Math.sin(a) * d, z = pz + Math.cos(a) * d;
            if (terrainHeight(x, z) < WATER_LEVEL - 0.8) { fish.x = x; fish.z = z; found = true; break; }
          }
          fish.next = 20 + Math.random() * 40;
          if (found) { fish.t = 0; fish.yaw = Math.random() * TAU; show(fishId, true); }
        }
      } else {
        fish.t += dt;
        const T = fish.t / 0.9;
        if (T >= 1) {
          show(fishId, false);
          fish.t = -1; fish.dropT = 0.001;
          spawnRing(fish.x, WATER_LEVEL + 0.05, fish.z, 0.2, 2.2, 2.0, 0.55, 0.75, 0.88, 0.95);
          const s = spatial(fish.x, WATER_LEVEL, fish.z, 7, 55);
          if (s.ok && gate('fish', 2)) sSplash(0.22 * s.vol, s.pan, 0.25);
        } else {
          const h = Math.sin(T * Math.PI) * 1.15;
          const fwd = (T - 0.5) * 1.4;
          pose(fishId, fish.x + Math.sin(fish.yaw) * fwd, WATER_LEVEL + h, fish.z + Math.cos(fish.yaw) * fwd,
            fish.yaw, (T - 0.5) * -2.6, 0);
        }
      }
      if (fish.dropT > 0) {
        fish.dropT += dt;
        if (fish.dropT > 0.7) { fish.dropT = -1; for (let i = 0; i < 8; i++) PC.hide(fish.drops + i); }
        else {
          const t = fish.dropT / 0.7;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            PC.set(fish.drops + i,
              fish.x + Math.cos(a) * t * 0.9, WATER_LEVEL + 0.7 * Math.sin(t * Math.PI) * (0.4 + hash2(i, 2, 90)),
              fish.z + Math.sin(a) * t * 0.9,
              0.8, 0.9, 1.0, 0.3, 0.7 * (1 - t));
          }
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // #18 LAUNDRY LINE — posts + rope + the 3 cloth grids; wet flap on gusts
  // -------------------------------------------------------------------------
  {
    const postGeo = new Bake(1001)
      .put(TPL.box, ropeA.x, ropeA.y - 1.0, ropeA.z, 0.14, 2.1, 0.14, 0, 0.3, 0, 0x5a4128, 0.08)
      .put(TPL.box, ropeB.x, ropeB.y - 1.0, ropeB.z, 0.14, 2.1, 0.14, 0, 0.8, 0, 0x5a4128, 0.08);
    // world-space bake → identity pose
    const pid = addPart(postGeo.geo(), true);
    pose(pid, 0, 0, 0, 0, 0, 0);
    const ropeSeg = segAlloc(3);
    for (let i = 0; i < 3; i++) {
      const t0 = i / 3, t1 = (i + 1) / 3;
      segSet(ropeSeg + i,
        ropeA.x + ropeDir.x * t0, ropeA.y + Math.sin(t0 * Math.PI) * -0.22, ropeA.z + ropeDir.z * t0,
        ropeA.x + ropeDir.x * t1, ropeA.y + Math.sin(t1 * Math.PI) * -0.22, ropeA.z + ropeDir.z * t1,
        0.55, 0.48, 0.38);
    }
  }
  const laundry = { lastFlap: -9 };
  actor((ropeA.x + ropeB.x) / 2, (ropeA.z + ropeB.z) / 2, 46, {
    sway: true,
    tick() {
      layCloth(swayT, 0.06 + wind.gust * 0.34);
      if (gustSpike && swayT - laundry.lastFlap > 3) {
        laundry.lastFlap = swayT;
        const s = spatial(ropeA.x, ropeA.y, ropeA.z, 5, 30);
        if (s.ok && gate('flap', 1.5)) {
          const vv = s.vol, pp = s.pan; // capture before _sp scratch is reused
          sSlapWet(0.2 * vv, pp);
          setTimeout(() => { if (AC) sSlapWet(0.12 * vv, pp); }, 160);
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // #19 CHORE VILLAGER — one figure, three scheduled rituals: dawn chicken
  // feeding, afternoon firewood, dusk lantern-lighting round
  // -------------------------------------------------------------------------
  const choreBodyId = addPart(new Bake(1010)
    .put(TPL.box, 0, 0.86, 0, 0.42, 0.62, 0.26, 0, 0, 0, 0x6a5a86, 0.07)
    .put(TPL.box, 0, 1.32, 0, 0.24, 0.24, 0.24, 0, 0, 0, 0xc79b6f, 0.06)
    .put(TPL.box, 0, 1.47, 0, 0.27, 0.08, 0.27, 0, 0, 0, 0x4a3a2a, 0.06)
    .geo(), false);
  const choreLegL = addPart(new Bake(1011).put(TPL.box, 0, -0.28, 0, 0.15, 0.56, 0.17, 0, 0, 0, 0x3f3a33, 0.06).geo(), false);
  const choreLegR = addPart(new Bake(1012).put(TPL.box, 0, -0.28, 0, 0.15, 0.56, 0.17, 0, 0, 0, 0x3f3a33, 0.06).geo(), false);
  const choreAxeId = addPart(new Bake(1013)
    .put(TPL.box, 0, -0.26, 0, 0.05, 0.56, 0.05, 0, 0, 0, 0x6a4e2e, 0.05)
    .put(TPL.box, 0.08, 0, 0, 0.18, 0.14, 0.04, 0, 0, 0, 0x767a82, 0.04)
    .geo(), false);
  const blockId = addPart(new Bake(1014)
    .put(TPL.cyl, 0, 0.3, 0, 0.55, 0.6, 0.55, 0, 0, 0, 0x6a5232, 0.1)
    .put(TPL.box, 0.5, 0.15, 0.3, 0.3, 0.3, 0.5, 0, 0.7, 0, 0x77552f, 0.12)
    .put(TPL.box, -0.45, 0.14, -0.25, 0.28, 0.28, 0.55, 0, 2.1, 0, 0x6d4d2a, 0.12)
    .geo(), true);
  const BLOCK = { x: -21.5, z: 8.5 };
  pose(blockId, BLOCK.x, terrainHeight(BLOCK.x, BLOCK.z), BLOCK.z, 0.6, 0, 0);
  const grain = { base: PD.alloc(16), t: -1, x: 0, z: 0 };
  const chips = { base: PD.alloc(8), t: -1, x: 0, z: 0 };
  // dusk round: house-door stations in walking order + home
  const choreRoute = [];
  for (const i of [3, 4, 1, 6, 2, 0, 5, 7]) {
    const [hx, hz, , d] = HOUSES[i];
    const ry = Math.atan2(-hx, -hz);
    anch({ x: hx, z: hz, ry }, 0, d / 2 + 1.3, _a1);
    choreRoute.push({ x: _a1.x, z: _a1.z, house: i });
  }
  const chore = {
    ritual: -1, // 0 feed, 1 wood, 2 lanterns
    x: -11, z: 24, yaw: 0, phase: 0, t: 0, station: 0, wait: 0, chopT: 0,
    walkPh: 0,
  };
  const CHORE_HOME = { x: -11, z: 24.4 };
  function choreWalkTo(tx, tz, dt, speed) {
    const d = dist2d(chore.x, chore.z, tx, tz);
    const a = Math.atan2(tx - chore.x, tz - chore.z);
    let da = a - chore.yaw;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    chore.yaw += clamp(da, -3 * dt, 3 * dt);
    if (d > 0.4) {
      chore.x += Math.sin(chore.yaw) * speed * dt;
      chore.z += Math.cos(chore.yaw) * speed * dt;
      chore.walkPh += dt * 7.5;
      return false;
    }
    return true;
  }
  function poseChore(swing) {
    const gy = terrainHeight(chore.x, chore.z);
    const ls = Math.sin(chore.walkPh) * swing;
    pose(choreBodyId, chore.x, gy + 0.56 + Math.abs(Math.sin(chore.walkPh)) * 0.03, chore.z, chore.yaw, 0, 0);
    pose(choreLegL, chore.x + Math.cos(chore.yaw) * 0.11, gy + 0.56, chore.z - Math.sin(chore.yaw) * 0.11, chore.yaw, ls, 0);
    pose(choreLegR, chore.x - Math.cos(chore.yaw) * 0.11, gy + 0.56, chore.z + Math.sin(chore.yaw) * 0.11, chore.yaw, -ls, 0);
  }
  actor(0, 8, 130, {
    exit() {
      show(choreBodyId, false); show(choreLegL, false); show(choreLegR, false); show(choreAxeId, false);
      for (let i = 0; i < 16; i++) PD.hide(grain.base + i);
      for (let i = 0; i < 8; i++) PD.hide(chips.base + i);
    },
    tick(dt) {
      const f = g.time.dayFrac;
      let ritual = -1;
      if (f > 0.27 && f < 0.345) ritual = 0;
      else if (f > 0.55 && f < 0.63) ritual = 1;
      else if (f > 0.705 && f < 0.80) ritual = 2;
      if (ritual !== chore.ritual) {
        chore.ritual = ritual;
        chore.phase = 0; chore.station = 0; chore.t = 0;
        chore.x = CHORE_HOME.x; chore.z = CHORE_HOME.z;
        if (ritual === 2) for (let i = 0; i < 9; i++) houseLit[i] = 0;
      }
      const active = ritual >= 0;
      show(choreBodyId, active); show(choreLegL, active); show(choreLegR, active);
      show(choreAxeId, active && ritual === 1 && chore.phase === 1);
      if (!active) {
        if (f > 0.85 || f < 0.7) for (let i = 0; i < 9; i++) houseLit[i] = 1; // deep night/day default
        return;
      }
      if (ritual === 0) { // ---- morning: feed the hens ----
        if (chore.phase === 0) {
          if (choreWalkTo(HEN_HOME.x - 1.5, HEN_HOME.z + 1.5, dt, 1.55)) { chore.phase = 1; chore.t = 0; chore.wait = 0; }
          poseChore(0.55);
        } else {
          chore.t -= dt;
          poseChore(0);
          if (chore.t <= 0 && chore.wait < 3) {
            chore.wait++;
            chore.t = 2.6;
            grain.t = 0.001;
            grain.x = chore.x + Math.sin(chore.yaw) * 1.6;
            grain.z = chore.z + Math.cos(chore.yaw) * 1.6;
            feedPt.x = grain.x; feedPt.z = grain.z; feedPt.until = g.time.elapsed + 30;
            const s = spatial(chore.x, terrainHeight(chore.x, chore.z) + 1, chore.z, 4, 22);
            if (s.ok && gate('grain', 1)) sGrainToss(0.12 * s.vol, s.pan);
          }
        }
      } else if (ritual === 1) { // ---- afternoon: split firewood ----
        if (chore.phase === 0) {
          if (choreWalkTo(BLOCK.x + 0.9, BLOCK.z + 0.4, dt, 1.55)) { chore.phase = 1; chore.chopT = 1.2; }
          poseChore(0.55);
        } else {
          chore.yaw = lerp(chore.yaw, Math.atan2(BLOCK.x - chore.x, BLOCK.z - chore.z), 0.2);
          chore.chopT -= dt;
          const cyc = 2.3;
          const t = ((chore.chopT % cyc) + cyc) % cyc;
          const raise = t > 0.55 ? smoothstep(0.55, 1.8, t) : 0;
          const strike = t <= 0.55 ? (1 - t / 0.55) : 0;
          poseChore(0);
          const gy = terrainHeight(chore.x, chore.z);
          pose(choreAxeId, chore.x + Math.sin(chore.yaw + 0.5) * 0.35, gy + 1.1 + raise * 0.7,
            chore.z + Math.cos(chore.yaw + 0.5) * 0.35, chore.yaw, 0, -0.3 - raise * 1.7 + strike * 0.4);
          if (t > cyc - 0.06) { // impact
            const s = spatial(BLOCK.x, gy, BLOCK.z, 7, 60);
            if (s.ok && gate('thock', 1.5)) sThock(0.2 * s.vol, s.pan);
            chips.t = 0.001; chips.x = BLOCK.x; chips.z = BLOCK.z;
          }
        }
      } else { // ---- dusk: light the lanterns / windows ----
        const st = choreRoute[chore.station];
        if (chore.wait > 0) {
          chore.wait -= dt;
          poseChore(0);
          houseLit[st.house] = Math.min(1, houseLit[st.house] + dt * 0.9);
          if (chore.wait <= 0 && chore.station < choreRoute.length - 1) chore.station++;
        } else if (choreWalkTo(st.x, st.z, dt, 1.5)) {
          chore.wait = 1.3;
          houseLit[8] = 1; // the inn lights its own
        } else poseChore(0.55);
      }
      // grain arc particles
      if (grain.t > 0) {
        grain.t += dt;
        if (grain.t > 0.9) { grain.t = -1; for (let i = 0; i < 16; i++) PD.hide(grain.base + i); }
        else {
          const t = grain.t / 0.9;
          for (let i = 0; i < 16; i++) {
            const a = hash2(i, 5, 210) * 1.2 - 0.6 + chore.yaw;
            const d = t * (0.8 + hash2(i, 6, 210) * 1.1);
            PD.set(grain.base + i,
              chore.x + Math.sin(a) * (0.4 + d), terrainHeight(grain.x, grain.z) + 1.1 * (1 - t) * (1 - t) + 0.35 * Math.sin(t * Math.PI),
              chore.z + Math.cos(a) * (0.4 + d),
              0.82, 0.72, 0.4, 0.09, 0.9 * (1 - t * 0.5));
          }
        }
      }
      // wood chips
      if (chips.t > 0) {
        chips.t += dt;
        if (chips.t > 0.6) { chips.t = -1; for (let i = 0; i < 8; i++) PD.hide(chips.base + i); }
        else {
          const t = chips.t / 0.6;
          for (let i = 0; i < 8; i++) {
            const a = hash2(i, 7, 211) * TAU;
            PD.set(chips.base + i,
              chips.x + Math.cos(a) * t * 1.4, terrainHeight(chips.x, chips.z) + 0.7 + t * 1.2 - t * t * 2.4,
              chips.z + Math.sin(a) * t * 1.4,
              0.62, 0.47, 0.28, 0.14, 1 - t);
          }
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // #20 GUST LEAF-BURSTS — on gust spikes, leaves burst from the nearest
  // forest edge with a swelling whoosh
  // -------------------------------------------------------------------------
  const leaves = {
    base: flutAlloc(15), t: -1, x: 0, z: 0,
    ph: new Float32Array(15), r: new Float32Array(15), h: new Float32Array(15),
  };
  for (let i = 0; i < 15; i++) {
    leaves.ph[i] = hash2(i, 1, 300) * TAU;
    leaves.r[i] = 0.5 + hash2(i, 2, 300);
    leaves.h[i] = 1 + hash2(i, 3, 300) * 2.5;
  }
  actor(0, 0, ALWAYS, {
    tick(dt) {
      if (leaves.t < 0 && gustSpike) {
        // nearest forest edge to the player
        let best = -1, bd = 55 * 55;
        for (let i = 0; i < forestPts.length; i++) {
          const p2 = forestPts[i];
          const d2 = (p2.x - px) * (p2.x - px) + (p2.z - pz) * (p2.z - pz);
          if (d2 < bd) { bd = d2; best = i; }
        }
        if (best >= 0) {
          leaves.t = 0; leaves.x = forestPts[best].x; leaves.z = forestPts[best].z;
          const gy = terrainHeight(leaves.x, leaves.z);
          const s = spatial(leaves.x, gy + 3, leaves.z, 12, 60);
          if (s.ok && gate('whoosh', 3)) sWhoosh(0.22 * s.vol * (0.5 + wind.gust * 0.5), s.pan);
          for (let i = 0; i < 15; i++) {
            flutColor(leaves.base + i, 0.72 + hash2(i, 4, 301) * 0.2, 0.5 + hash2(i, 5, 301) * 0.22, 0.14);
          }
          flut.instanceColor.needsUpdate = true;
        }
      }
      if (leaves.t >= 0) {
        leaves.t += dt;
        if (leaves.t > 3.2) {
          leaves.t = -1;
          for (let i = 0; i < 15; i++) flutHide(leaves.base + i);
          flut.instanceMatrix.needsUpdate = true;
          return;
        }
        const T = leaves.t;
        const gy = terrainHeight(leaves.x, leaves.z);
        const fade = smoothstep(3.2, 2.2, T);
        for (let i = 0; i < 15; i++) {
          const drift = T * (2.2 + leaves.r[i] * 2.4);
          const tumble = leaves.ph[i] + T * (4 + leaves.r[i] * 5);
          flutSet(leaves.base + i,
            leaves.x + wind.dir.x * drift + Math.sin(tumble) * 0.6,
            gy + leaves.h[i] + Math.sin(T * 2 + leaves.ph[i]) * 0.5 - T * T * 0.22,
            leaves.z + wind.dir.z * drift + Math.cos(tumble * 0.8) * 0.6,
            tumble, 0.11 * fade, 0.08 * fade);
        }
        flut.instanceMatrix.needsUpdate = true;
      }
    },
  });

  // -------------------------------------------------------------------------
  // #21 COBWEB GLINTS in ruin doorways — strand fans, grazing-angle glints
  // -------------------------------------------------------------------------
  const webs = [];
  {
    const spots = [
      { x: POI.ruins.x + 6, z: POI.ruins.z + 3, ry: 0.7 },
      { x: POI.ruins.x - 5, z: POI.ruins.z - 6, ry: 2.4 },
    ];
    for (let wI = 0; wI < 2; wI++) {
      const sp = spots[wI];
      const gy = terrainHeight(sp.x, sp.z);
      const base = segAlloc(9);
      const glintI = PC.alloc(2);
      const nx = Math.sin(sp.ry + Math.PI / 2), nz = Math.cos(sp.ry + Math.PI / 2);
      webs.push({ sp, gy, base, glintI, nx, nz });
    }
    for (const w of webs) {
      actor(w.sp.x, w.sp.z, 40, {
        sway: true,
        exit() {
          for (let i = 0; i < 9; i++) segHide(w.base + i);
          PC.hide(w.glintI); PC.hide(w.glintI + 1);
        },
        tick() {
          // fan of strands from an apex, endpoints breathing with the gust
          const ax = w.sp.x, ay = w.gy + 2.5, az = w.sp.z;
          const tx = Math.sin(w.sp.ry), tz = Math.cos(w.sp.ry);
          for (let i = 0; i < 9; i++) {
            const a = -0.9 + (i / 8) * 1.8;
            const sway = Math.sin(swayT * 1.3 + i * 1.1) * (0.02 + wind.gust * 0.06);
            const ex = ax + tx * Math.sin(a) * 0.9 + w.nx * sway;
            const ez = az + tz * Math.sin(a) * 0.9 + w.nz * sway;
            const ey = ay - 0.6 - Math.cos(a) * -0.5 - Math.abs(a) * 0.3;
            segSet(w.base + i, ax, ay, az, ex, ey, ez, 0.62, 0.63, 0.68);
          }
          // grazing-angle glint
          const cp = g.camera.position;
          _v1.set(ax - cp.x, ay - 1 - cp.y, az - cp.z).normalize();
          const graze = Math.pow(1 - Math.abs(_v1.x * w.nx + _v1.z * w.nz), 6);
          const day = g.sky ? clamp(g.sky.sunDir.y * 4, 0, 1) : 0.5;
          const b = graze * (0.25 + 0.75 * day);
          PC.set(w.glintI, ax + tx * 0.2, ay - 0.7, az + tz * 0.2, 0.9, 0.92, 1.0, 0.16, b * 0.8);
          PC.set(w.glintI + 1, ax - tx * 0.3, ay - 1.0, az - tz * 0.3, 0.9, 0.92, 1.0, 0.12, b * 0.6);
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // #22 WEATHERVANE on Greywatch tower — slerps to the wind with overshoot
  // -------------------------------------------------------------------------
  const vaneId = addPart(new Bake(1020)
    .put(TPL.box, 0, 0, 0.3, 0.04, 0.04, 0.75, 0, 0, 0, 0x3a3a40, 0.04)
    .put(TPL.cone, 0, 0, 0.68, 0.09, 0.22, 0.04, 1.57, 0, 0, 0x8a8c92, 0.05)
    .put(TPL.box, 0, 0.02, -0.1, 0.03, 0.3, 0.3, 0, 0, 0, 0x74767c, 0.05)
    .put(TPL.cone, 0, 0.26, -0.1, 0.14, 0.2, 0.14, 0, 0, 0, 0xb08d3f, 0.06)
    .geo(), false);
  const vane = {
    x: POI.tower.x, z: POI.tower.z,
    y: terrainHeight(POI.tower.x, POI.tower.z) + 15.4,
    ang: 0, vel: 0, lastSq: -9,
  };
  actor(vane.x, vane.z, 150, {
    sway: true,
    enter() { show(vaneId, true); },
    exit() { show(vaneId, false); },
    tick(dt) {
      const tgt = Math.atan2(wind.dir.x, wind.dir.z);
      let da = tgt - vane.ang;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      // underdamped spring → natural overshoot wobble
      vane.vel += da * 3.2 * dt - vane.vel * 1.1 * dt;
      vane.ang += vane.vel * dt;
      pose(vaneId, vane.x, vane.y, vane.z, vane.ang, 0, 0);
      if (Math.abs(vane.vel) > 0.85 && swayT - vane.lastSq > 4) {
        vane.lastSq = swayT;
        const s = spatial(vane.x, vane.y, vane.z, 6, 45);
        if (s.ok && gate('vane', 2)) sSqueakHinge(0.12 * s.vol, s.pan);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #23 PLAYER BREATH FOG — cold nights and the high peak, soft puffs
  // -------------------------------------------------------------------------
  const breath = { base: PC.alloc(12), t: -1, next: 2, ox: 0, oy: 0, oz: 0, dx: 0, dz: 0 };
  actor(0, 0, ALWAYS, {
    tick(dt) {
      const f = g.time.dayFrac;
      const cold = (f > 0.83 || f < 0.20) || py > 92;
      if (breath.t < 0) {
        if (!cold) return;
        breath.next -= dt * (1 + playerSpeed * 0.14);
        if (breath.next > 0) return;
        breath.next = 2.6 + Math.random() * 0.9;
        breath.t = 0;
        const el = g.camera.matrixWorld.elements;   // -Z column = forward
        breath.dx = -el[8]; breath.dz = -el[10];
        breath.ox = g.camera.position.x + breath.dx * 0.45;
        breath.oy = g.camera.position.y - 0.16;
        breath.oz = g.camera.position.z + breath.dz * 0.45;
      }
      breath.t += dt;
      if (breath.t > 1.3) {
        breath.t = -1;
        for (let i = 0; i < 12; i++) PC.hide(breath.base + i);
        return;
      }
      const T = breath.t / 1.3;
      for (let i = 0; i < 12; i++) {
        const sp = 0.5 + hash2(i, 3, 411) * 0.5;
        PC.set(breath.base + i,
          breath.ox + breath.dx * T * sp + (hash2(i, 1, 411) - 0.5) * (0.1 + T * 0.5),
          breath.oy + T * 0.22 + (hash2(i, 2, 411) - 0.5) * (0.05 + T * 0.3),
          breath.oz + breath.dz * T * sp + (hash2(i, 4, 411) - 0.5) * (0.1 + T * 0.5),
          0.75, 0.8, 0.86, 0.09 + T * 0.30, 0.10 * (1 - T) * (0.4 + T));
      }
    },
  });

  // -------------------------------------------------------------------------
  // #24 BATS at dusk from the ruins — 8 erratic flappers figure-eighting,
  // faint high chitters
  // -------------------------------------------------------------------------
  const bats = { base: flutAlloc(8), chitT: 3 };
  actor(POI.ruins.x, POI.ruins.z, 110, {
    enter() {
      for (let i = 0; i < 8; i++) flutColor(bats.base + i, 0.12, 0.1, 0.13);
      flut.instanceColor.needsUpdate = true;
    },
    exit() { for (let i = 0; i < 8; i++) flutHide(bats.base + i); flut.instanceMatrix.needsUpdate = true; },
    tick(dt) {
      const f = g.time.dayFrac;
      const env = winEnv(f, 0.735, 0.86, 0.12); // ~90s of dusk
      if (env < 0.02) {
        for (let i = 0; i < 8; i++) flutHide(bats.base + i);
        flut.instanceMatrix.needsUpdate = true;
        return;
      }
      const e = g.time.elapsed;
      const cx = POI.ruins.x + Math.sin(e * 0.07) * 14;
      const cz = POI.ruins.z + Math.cos(e * 0.05) * 14;
      const cy = terrainHeight(cx, cz) + 7;
      for (let i = 0; i < 8; i++) {
        const ph = i * 0.9;
        const w = 0.9 + hash2(i, 6, 500) * 0.5;
        const t = e * w + ph;
        // lissajous figure-eight + snoise jitter = erratic bat flight
        const jx = snoise(t * 1.7, i * 9.3) * 1.6;
        const jy = snoise(t * 2.3, i * 4.1 + 50) * 1.1;
        flutSet(bats.base + i,
          cx + Math.sin(t) * (7 + i * 0.6) + jx,
          cy + Math.sin(t * 2) * 2.2 + jy,
          cz + Math.cos(t) * (5 + i * 0.4) + jx * 0.5,
          Math.sin(t * 21) * 1.1,
          (0.16 + 0.1 * Math.abs(Math.sin(t * 19))) * env, 0.1 * env);
      }
      flut.instanceMatrix.needsUpdate = true;
      bats.chitT -= dt;
      if (bats.chitT <= 0) {
        bats.chitT = 2.5 + Math.random() * 5;
        const s = spatial(cx, cy, cz, 5, 32);
        if (s.ok && gate('chit', 2)) sChitter(0.05 * s.vol, s.pan);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #25 WATER STRIDERS in the shallows — dark dots darting, micro-rings
  // -------------------------------------------------------------------------
  const striders = { base: PD.alloc(6), t: [], cx: dockPt.x, cz: dockPt.z };
  for (let i = 0; i < 6; i++) {
    striders.t.push({
      x: 0, z: 0, tx: 0, tz: 0, wait: hash2(i, 2, 610) * 2, dart: -1,
    });
  }
  {
    // anchor them just off the shore toward the lake
    const a = Math.atan2(POI.lake.x - dockPt.x, POI.lake.z - dockPt.z);
    striders.cx = dockPt.x + Math.sin(a) * 4;
    striders.cz = dockPt.z + Math.cos(a) * 4;
    for (const st of striders.t) {
      st.x = striders.cx + (Math.random() - 0.5) * 3;
      st.z = striders.cz + (Math.random() - 0.5) * 3;
    }
  }
  actor(striders.cx, striders.cz, 26, {
    exit() { for (let i = 0; i < 6; i++) PD.hide(striders.base + i); },
    tick(dt) {
      for (let i = 0; i < 6; i++) {
        const st = striders.t[i];
        if (st.dart >= 0) {
          st.dart += dt;
          const T = Math.min(1, st.dart / 0.16);
          st.x = lerp(st.x, st.tx, T); st.z = lerp(st.z, st.tz, T);
          if (T >= 1) { st.dart = -1; st.wait = 0.8 + Math.random() * 2.4; }
        } else {
          st.wait -= dt;
          if (st.wait <= 0) {
            st.dart = 0;
            const a = Math.random() * TAU;
            st.tx = clamp(st.x + Math.cos(a) * 0.5, striders.cx - 3, striders.cx + 3);
            st.tz = clamp(st.z + Math.sin(a) * 0.5, striders.cz - 3, striders.cz + 3);
            if (Math.random() < 0.3) spawnRing(st.x, WATER_LEVEL + 0.03, st.z, 0.06, 0.4, 0.8, 0.3, 0.7, 0.8, 0.85);
          }
        }
        PD.set(striders.base + i, st.x, WATER_LEVEL + 0.03, st.z, 0.1, 0.09, 0.08, 0.09, 0.9);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #26 WELL BUCKET — idle gust sway; every few minutes an autonomous crank
  // cycle: rope pays out, ratchet clicks, a distant splash deep below
  // -------------------------------------------------------------------------
  const bucketId = addPart(new Bake(1030)
    .put(TPL.cyl, 0, -0.11, 0, 0.26, 0.22, 0.26, 0, 0, 0, 0x6a5232, 0.09)
    .put(TPL.box, 0, 0.02, 0, 0.28, 0.03, 0.03, 0, 0, 0, 0x4a4a50, 0.04)
    .geo(), false);
  const wellY = terrainHeight(WELL.x, WELL.z);
  const bucketRope = segAlloc(1);
  const bucket = { next: 90, t: -1, drop: 0.55 };
  actor(WELL.x, WELL.z, 38, {
    sway: true,
    enter() { show(bucketId, true); },
    exit() { show(bucketId, false); segHide(bucketRope); },
    tick(dt) {
      bucket.next -= dt;
      if (bucket.t < 0 && bucket.next <= 0) {
        bucket.next = 150 + Math.random() * 160;
        bucket.t = 0;
        const s = spatial(WELL.x, wellY + 2, WELL.z, 5, 26);
        if (s.ok && gate('crank', 5)) sRatchet(0.12 * s.vol, s.pan);
      }
      let drop = 0.55; // resting hang below the crossbar
      if (bucket.t >= 0) {
        bucket.t += dt;
        const T = bucket.t;
        if (T < 1.6) drop = 0.55 + smoothstep(0, 1.6, T) * 1.5;         // pay out
        else if (T < 2.4) {
          drop = 2.05;
          if (T - dt < 1.7 && T >= 1.7) {
            const s = spatial(WELL.x, wellY - 2, WELL.z, 3, 20);
            if (s.ok && gate('wellspl', 3)) sSplash(0.14 * s.vol, s.pan, 0.75); // echoey deep splash
          }
        } else if (T < 4.6) {
          drop = 2.05 - smoothstep(2.4, 4.6, T) * 1.5;                   // wind back up
          if (((T * 5) | 0) !== (((T - dt) * 5) | 0)) {
            const s = spatial(WELL.x, wellY + 2, WELL.z, 3, 18);
            if (s.ok) noiz(0, 0.015, 0.06 * s.vol, s.pan, { fType: 'highpass', ff0: 2100 });
          }
        } else bucket.t = -1;
      }
      const swx = Math.sin(swayT * 1.9) * (0.02 + wind.gust * 0.09);
      const swz = Math.cos(swayT * 1.4) * (0.02 + wind.gust * 0.07);
      const topY = wellY + 2.02;
      const bx = WELL.x + 0.42 + swx, bz = WELL.z + swz;
      pose(bucketId, bx, topY - drop, bz, swayT * 0.3, swz * 1.5, swx * 1.5);
      segSet(bucketRope, WELL.x + 0.42, topY + 0.1, WELL.z, bx, topY - drop + 0.05, bz, 0.42, 0.36, 0.28);
    },
  });

  // -------------------------------------------------------------------------
  // #27 EMBER POPS from fires — forge hearth, Redfang camp, and two of my
  // own dying wayfarer fires: spark arcs + a crack every 4–9 s
  // -------------------------------------------------------------------------
  anch(FORGE, -1.3, -0.7, _a1);
  const fireSpots = [
    { x: _a1.x, z: _a1.z, y: terrainHeight(FORGE.x, FORGE.z) + 1.05 },
    { x: POI.camp.x + 2, z: POI.camp.z + 1, y: terrainHeight(POI.camp.x + 2, POI.camp.z + 1) + 0.3 },
    { x: 205, z: 298, y: 0 },
    { x: -148, z: -262, y: 0 },
  ];
  for (let fI = 2; fI < 4; fI++) {
    // my own charred log prop so the wilderness pops have a source
    const sp = fireSpots[fI];
    sp.y = terrainHeight(sp.x, sp.z) + 0.16;
    const logId2 = addPart(new Bake(1040 + fI)
      .put(TPL.cyl, 0, 0.1, 0, 0.22, 1.1, 0.22, 1.57, 0.4, 0, 0x2c2620, 0.14)
      .put(TPL.cyl, 0.2, 0.09, 0.25, 0.18, 0.9, 0.18, 1.57, 1.9, 0, 0x231e19, 0.14)
      .put(TPL.box, 0, 0.05, 0, 0.5, 0.08, 0.5, 0, 0.2, 0, 0x815028, 0.3)
      .geo(), true);
    pose(logId2, sp.x, sp.y - 0.14, sp.z, hash2(fI, 1, 707) * TAU, 0, 0);
  }
  for (let fI = 0; fI < 4; fI++) {
    const sp = fireSpots[fI];
    const emb = { base: PC.alloc(6), next: 2 + fI, t: -1, glow: fI >= 2 };
    actor(sp.x, sp.z, 30, {
      exit() { for (let i = 0; i < 6; i++) PC.hide(emb.base + i); },
      tick(dt) {
        emb.next -= dt;
        if (emb.t < 0 && emb.next <= 0) {
          emb.next = 4 + Math.random() * 5;
          emb.t = 0;
          const s = spatial(sp.x, sp.y, sp.z, 4, 25);
          if (s.ok && gate('pop' + fI, 1)) sPop(0.15 * s.vol, s.pan);
        }
        if (emb.t >= 0) {
          emb.t += dt;
          if (emb.t > 0.8) {
            emb.t = -1;
            for (let i = 1; i < 6; i++) PC.hide(emb.base + i);
          } else {
            const T = emb.t / 0.8;
            for (let i = 1; i < 6; i++) {
              const a = hash2(i, fI, 708) * TAU;
              const v = 0.5 + hash2(i, fI + 9, 708);
              PC.set(emb.base + i,
                sp.x + Math.cos(a) * T * v * 0.8,
                sp.y + T * (1.6 + v) - T * T * 2.2,
                sp.z + Math.sin(a) * T * v * 0.8,
                1.0, 0.45 * (1 - T) + 0.1, 0.03, 0.07, (1 - T));
            }
          }
        }
        // dying-fire heartbeat glow for my own wayfarer fires
        if (emb.glow) {
          const th = 0.55 + 0.45 * Math.sin(g.time.elapsed * 1.3 + fI * 9) * (0.5 + 0.5 * snoise(g.time.elapsed * 0.7, fI * 31));
          PC.set(emb.base, sp.x, sp.y + 0.05, sp.z, 1.0, 0.42, 0.05, 1.3, 0.28 * th);
        } else PC.hide(emb.base);
      },
    });
  }

  // -------------------------------------------------------------------------
  // #28 EAGLE circling Drakespire — 60u thermal spiral, rare piercing cry,
  // long glides with occasional flap. Bubble-exempt: visible from the valley.
  // -------------------------------------------------------------------------
  const eagleBody = addPart(new Bake(1050)
    .put(TPL.box, 0, 0, 0, 0.5, 0.34, 1.7, 0, 0, 0, 0x4a3826, 0.1)
    .put(TPL.box, 0, 0.05, 0.95, 0.3, 0.24, 0.5, 0, 0, 0, 0xd8d2c4, 0.06)
    .put(TPL.cone, 0, 0, 1.3, 0.12, 0.3, 0.1, 1.57, 0, 0, 0xd8a03a, 0.05)
    .put(TPL.box, 0, 0.02, -1.0, 0.7, 0.06, 0.55, 0, 0, 0, 0x54402c, 0.08)
    .geo(), true);
  const eagleWingL = addPart(new Bake(1051).put(TPL.box, -1.55, 0.05, 0, 3.1, 0.07, 0.85, 0, 0, 0, 0x54402c, 0.1).geo(), true);
  const eagleWingR = addPart(new Bake(1052).put(TPL.box, 1.55, 0.05, 0, 3.1, 0.07, 0.85, 0, 0, 0, 0x54402c, 0.1).geo(), true);
  const eagle = { a: 0, cryT: 40, flapT: 0, flapUntil: 0 };
  const peakH = terrainHeight(POI.peak.x, POI.peak.z);
  actor(POI.peak.x, POI.peak.z, ALWAYS, {
    tick(dt) {
      eagle.a += dt * 0.14;
      const R = 60 + Math.sin(eagle.a * 0.31) * 16;
      const ex = POI.peak.x + Math.cos(eagle.a) * R;
      const ez = POI.peak.z + Math.sin(eagle.a) * R;
      const ey = peakH + 46 + Math.sin(eagle.a * 0.53) * 22;
      const yaw = -eagle.a - Math.PI / 2 + Math.PI; // face along the tangent
      // occasional flap bursts between long glides
      eagle.flapT -= dt;
      if (eagle.flapT <= 0) {
        eagle.flapT = 6 + Math.random() * 9;
        eagle.flapUntil = g.time.elapsed + 1.6;
      }
      const flapping = g.time.elapsed < eagle.flapUntil;
      const flap = flapping ? Math.sin(g.time.elapsed * 14) * 0.55 : Math.sin(g.time.elapsed * 1.1) * 0.06 + 0.12;
      const bank = 0.28; // banked into the thermal
      pose(eagleBody, ex, ey, ez, yaw, 0.05, bank, 1.6);
      pose(eagleWingL, ex, ey, ez, yaw, 0, bank + flap, 1.6);
      pose(eagleWingR, ex, ey, ez, yaw, 0, bank - flap, 1.6);
      eagle.cryT -= dt;
      if (eagle.cryT <= 0) {
        eagle.cryT = 90 + Math.random() * 110;
        const s = spatial(ex, ey, ez, 60, 700);
        if (s.ok && gate('cry', 10)) sCry(0.16 * s.vol, s.pan);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #29 SHUTTER RATTLE on strong gusts — loose shutters + knock-knock
  // -------------------------------------------------------------------------
  const shutters = [];
  for (let sI = 0; sI < 3; sI++) {
    const hi = [0, 5, 1][sI];
    const [hx, hz, w, d] = HOUSES[hi];
    const H = { x: hx, z: hz, ry: Math.atan2(-hx, -hz) };
    anch(H, 0.28 * w + 0.42, d / 2 + 0.10, _a1);
    const gy = terrainHeight(hx, hz);
    const id = addPart(new Bake(1060 + sI)
      .put(TPL.box, 0.16, 0, 0, 0.32, 0.72, 0.05, 0, 0, 0, 0x4c3620, 0.1)
      .geo(), false);
    shutters.push({ id, x: _a1.x, y: gy + 1.9, z: _a1.z, ry: H.ry, rattleT: -1, cd: sI * 2 });
  }
  actor(0, 0, 62, {
    sway: true,
    enter() { for (const sh of shutters) show(sh.id, true); },
    exit() { for (const sh of shutters) show(sh.id, false); },
    tick(dt) {
      for (const sh of shutters) {
        sh.cd -= dt;
        if (gustSpike && sh.cd <= 0 && Math.random() < 0.75) {
          sh.cd = 3 + Math.random() * 6;
          sh.rattleT = 0;
          const s = spatial(sh.x, sh.y, sh.z, 6, 34);
          if (s.ok && gate('knock', 1.2)) sKnock(0.16 * s.vol, s.pan);
        }
        let ang = 0.06 + Math.sin(swayT * 1.1 + sh.id) * 0.02 * (0.3 + wind.gust);
        if (sh.rattleT >= 0) {
          sh.rattleT += dt;
          if (sh.rattleT > 0.7) sh.rattleT = -1;
          else ang += Math.abs(Math.sin(sh.rattleT * 34)) * 0.3 * (1 - sh.rattleT / 0.7);
        }
        pose(sh.id, sh.x, sh.y, sh.z, sh.ry + ang, 0, 0);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #30 SNAKE through meadow grass (rare) — segmented slither crossing the
  // path ahead, dry rustle
  // -------------------------------------------------------------------------
  const snakeSegs = [];
  for (let i = 0; i < 8; i++) {
    const s = 0.11 - i * 0.007;
    snakeSegs.push(addPart(new Bake(1070 + i)
      .put(TPL.box, 0, s / 2, 0, s * (i === 0 ? 1.4 : 1), s, 0.24, 0, 0, 0, i % 2 ? 0x555c31 : 0x49502a, 0.12)
      .geo(), false));
  }
  const snake = { next: 100, t: -1, x: 0, z: 0, dx: 0, dz: 0, rusT: 0 };
  actor(0, 0, ALWAYS, {
    tick(dt) {
      if (snake.t < 0) {
        snake.next -= dt;
        if (snake.next > 0) return;
        snake.next = 130 + Math.random() * 140;
        if (playerSpeed < 0.5 || biomeAt(px, pz) !== BIOME.MEADOW) return;
        // cross the player's path ahead
        const el = g.camera.matrixWorld.elements;
        const fx = -el[8], fz = -el[10];
        const fl = Math.max(0.01, Math.hypot(fx, fz));
        const cxp = px + (fx / fl) * 9, czp = pz + (fz / fl) * 9;
        if (biomeAt(cxp, czp) !== BIOME.MEADOW) return;
        snake.t = 0;
        snake.dx = fz / fl; snake.dz = -fx / fl; // perpendicular crossing
        snake.x = cxp - snake.dx * 5; snake.z = czp - snake.dz * 5;
        for (const id of snakeSegs) show(id, true);
      }
      snake.t += dt;
      if (snake.t > 7) {
        snake.t = -1;
        for (const id of snakeSegs) show(id, false);
        return;
      }
      const head = snake.t * 1.55;
      for (let i = 0; i < 8; i++) {
        const s = head - i * 0.24;
        const lat = Math.sin(s * 3.4) * 0.28;
        const x = snake.x + snake.dx * s - snake.dz * lat;
        const z = snake.z + snake.dz * s + snake.dx * lat;
        const yaw = Math.atan2(snake.dx + -snake.dz * Math.cos(s * 3.4) * 0.9, snake.dz + snake.dx * Math.cos(s * 3.4) * 0.9);
        pose(snakeSegs[i], x, terrainHeight(x, z) + 0.01, z, yaw, 0, 0);
      }
      snake.rusT -= dt;
      if (snake.rusT <= 0) {
        snake.rusT = 0.9;
        const s = spatial(snake.x + snake.dx * head, py, snake.z + snake.dz * head, 4, 16);
        if (s.ok && gate('rustle', 0.7)) sRustle(0.09 * s.vol, s.pan);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #31 DUST MOTES in the forge / inn doorways during golden hours
  // -------------------------------------------------------------------------
  anch(INN, -INN.w * 0.24, INN.d / 2 + 0.7, _a2);
  const moteSites = [
    { x: FORGE.x, z: FORGE.z, y: terrainHeight(FORGE.x, FORGE.z) + 1.5 },
    { x: _a2.x, z: _a2.z, y: terrainHeight(INN.x, INN.z) + 1.5 },
  ];
  const motes = { base: PC.alloc(20) };
  actor(0, 8, 42, {
    exit() { for (let i = 0; i < 20; i++) PC.hide(motes.base + i); },
    tick() {
      const f = g.time.dayFrac;
      const golden = winEnv(f, 0.25, 0.36, 0.3) + winEnv(f, 0.64, 0.77, 0.3);
      if (golden < 0.02) { for (let i = 0; i < 20; i++) PC.hide(motes.base + i); return; }
      const e = g.time.elapsed;
      for (let i = 0; i < 20; i++) {
        const site = moteSites[i % 2];
        const ph = i * 2.3;
        PC.set(motes.base + i,
          site.x + snoise(e * 0.06 + ph, i * 3.1) * 0.8,
          site.y + snoise(e * 0.05 + ph, i * 5.7 + 20) * 0.7,
          site.z + snoise(e * 0.055 + ph, i * 7.7 + 40) * 0.8,
          1.0, 0.85, 0.6, 0.055, golden * (0.25 + 0.2 * Math.sin(e * 0.8 + ph)));
      }
    },
  });

  // -------------------------------------------------------------------------
  // #32 SQUIRREL spirals up a pine when approached — forest cells
  // -------------------------------------------------------------------------
  const squirrelId = addPart(new Bake(1080)
    .put(TPL.box, 0, 0.09, 0, 0.13, 0.15, 0.28, 0, 0, 0, 0x8a5230, 0.1)
    .put(TPL.box, 0, 0.2, -0.2, 0.09, 0.24, 0.09, -0.5, 0, 0, 0x9a6038, 0.1)
    .put(TPL.box, 0, 0.16, 0.15, 0.08, 0.08, 0.08, 0, 0, 0, 0x84502e, 0.06)
    .geo(), false);
  const squirrel = { hx: 0, hz: 0, has: false, state: 0, t: 0, ang: 0, cd: 0, relocT: 0 };
  actor(0, 0, ALWAYS, {
    tick(dt) {
      squirrel.relocT -= dt;
      // adopt the seeded forest point nearest the player as home
      if (squirrel.relocT <= 0) {
        squirrel.relocT = 4;
        let best = -1, bd = 45 * 45;
        for (let i = 0; i < forestPts.length; i++) {
          const p2 = forestPts[i];
          const d2 = (p2.x - px) * (p2.x - px) + (p2.z - pz) * (p2.z - pz);
          if (d2 < bd) { bd = d2; best = i; }
        }
        if (best >= 0 && !squirrel.has) {
          squirrel.hx = forestPts[best].x + (hash2(best, 3, 660) - 0.5) * 6;
          squirrel.hz = forestPts[best].z + (hash2(best, 4, 660) - 0.5) * 6;
          squirrel.has = true; squirrel.state = 0;
        } else if (best < 0) { squirrel.has = false; show(squirrelId, false); }
      }
      if (!squirrel.has) return;
      squirrel.cd -= dt;
      const gy = terrainHeight(squirrel.hx, squirrel.hz);
      const dP = dist2d(squirrel.hx, squirrel.hz, px, pz);
      if (squirrel.state === 0) {
        if (dP > 42) { show(squirrelId, false); return; }
        show(squirrelId, true);
        // ground hops near the trunk
        const e = g.time.elapsed;
        const hop = Math.abs(Math.sin(e * 5.5));
        const wx = squirrel.hx + Math.sin(e * 0.4) * 1.2;
        const wz = squirrel.hz + Math.cos(e * 0.33) * 1.2;
        pose(squirrelId, wx, terrainHeight(wx, wz) + hop * 0.14, wz, e * 0.4 + Math.PI / 2, 0, 0);
        if (dP < 7.5 && squirrel.cd <= 0) {
          squirrel.state = 1; squirrel.t = 0;
          squirrel.ang = Math.random() * TAU;
          const s = spatial(squirrel.hx, gy + 1, squirrel.hz, 5, 20);
          if (s.ok && gate('scrab', 3)) sScrabble(0.13 * s.vol, s.pan);
        }
      } else {
        // the spiral: up the (likely) pine trunk, then gone among the boughs
        squirrel.t += dt;
        const T = squirrel.t / 2.1;
        if (T >= 1) { squirrel.state = 0; squirrel.cd = 25; show(squirrelId, false); squirrel.has = false; return; }
        const a = squirrel.ang + T * 7;
        pose(squirrelId,
          squirrel.hx + Math.cos(a) * 0.34, gy + 0.3 + T * 5.2, squirrel.hz + Math.sin(a) * 0.34,
          -a, -1.15, 0);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #33 PUDDLE SHIMMER near the well + the midday sparrow bath
  // -------------------------------------------------------------------------
  const puddles = [
    { x: 2.4, z: -4.6, i: ringAlloc(1), g: PC.alloc(3) },
    { x: -2.8, z: 0.4, i: ringAlloc(1), g: PC.alloc(3) },
  ];
  const sparrow = { i: flutAlloc(1), chirpT: 2, dipT: 0 };
  actor(0, -2, 42, {
    exit() {
      for (const pu of puddles) { ringHide(pu.i); for (let k = 0; k < 3; k++) PC.hide(pu.g + k); }
      flutHide(sparrow.i); flut.instanceMatrix.needsUpdate = true;
    },
    tick(dt) {
      const e = g.time.elapsed;
      const sunUp = g.sky ? clamp(g.sky.sunDir.y * 3, 0, 1) : 0.5;
      for (let pI = 0; pI < 2; pI++) {
        const pu = puddles[pI];
        const gy = terrainHeight(pu.x, pu.z);
        const shim = 0.10 + 0.05 * Math.sin(e * 1.7 + pI * 4) + wind.gust * 0.04;
        ringSet(pu.i, pu.x, gy + 0.045, pu.z, 1.35, 0.95, pI * 1.2, 0.55, 0.62, 0.72, shim);
        for (let k = 0; k < 3; k++) {
          const tw = hash2(k + pI * 3, (e * 3) | 0, 670);
          PC.set(pu.g + k,
            pu.x + (hash2(k, pI, 671) - 0.5) * 0.9, gy + 0.07, pu.z + (hash2(k, pI + 4, 671) - 0.5) * 0.7,
            1.0, 0.9, 0.7, 0.13, sunUp * (tw > 0.6 ? 0.5 : 0.08));
        }
      }
      // midday sparrow flutter-bathing in puddle 0
      const f = g.time.dayFrac;
      const midday = winEnv(f, 0.44, 0.58, 0.2);
      const pu = puddles[0];
      const dP = dist2d(pu.x, pu.z, px, pz);
      if (midday > 0.1 && dP > 5 && dP < 30 && !scared(pu.x, pu.z, 14)) {
        const gy = terrainHeight(pu.x, pu.z);
        sparrow.dipT += dt;
        const jx = snoise(e * 6, 3.3) * 0.1, jz = snoise(e * 5.4, 9.1) * 0.1;
        flutColor(sparrow.i, 0.45, 0.36, 0.26);
        flutSet(sparrow.i, pu.x + 0.3 + jx, gy + 0.12 + Math.abs(Math.sin(e * 15)) * 0.07, pu.z + jz,
          Math.sin(e * 17) * 0.7, 0.09, 0.07);
        flut.instanceColor.needsUpdate = true;
        flut.instanceMatrix.needsUpdate = true;
        if (sparrow.dipT > 1.2) { sparrow.dipT = 0; spawnRing(pu.x + 0.3, gy + 0.05, pu.z, 0.1, 0.5, 0.9, 0.25, 0.7, 0.75, 0.8); }
        sparrow.chirpT -= dt;
        if (sparrow.chirpT <= 0) {
          sparrow.chirpT = 3 + Math.random() * 3.5;
          const s = spatial(pu.x, terrainHeight(pu.x, pu.z), pu.z, 4, 24);
          if (s.ok && gate('chirp', 1.5)) sChirp(0.11 * s.vol, s.pan);
        }
      } else {
        flutHide(sparrow.i);
        flut.instanceMatrix.needsUpdate = true;
      }
    },
  });

  // -------------------------------------------------------------------------
  // #34 SPIDER on a thread from the inn eave — only for the patient
  // -------------------------------------------------------------------------
  anch(INN, 3.4, INN.d / 2 + 0.9, _a1);
  const spider = {
    x: _a1.x, z: _a1.z, y: terrainHeight(INN.x, INN.z) + 3.35,
    seg: segAlloc(1), still: 0, t: -1, cd: 0,
  };
  const spiderId = addPart(new Bake(1090)
    .put(TPL.box, 0, 0, 0, 0.06, 0.05, 0.08, 0, 0, 0, 0x241f1a, 0.1)
    .put(TPL.box, 0, -0.01, 0, 0.12, 0.015, 0.1, 0, 0, 0, 0x2c2620, 0.08)
    .geo(), false);
  actor(spider.x, spider.z, 38, {
    exit() { show(spiderId, false); segHide(spider.seg); spider.t = -1; spider.still = 0; },
    tick(dt) {
      spider.cd -= dt;
      // require the player to stand nearly still for >5s, close by
      if (playerSpeed < 0.25 && dist2d(spider.x, spider.z, px, pz) < 7) spider.still += dt;
      else if (playerSpeed > 1) spider.still = 0;
      if (spider.t < 0) {
        if (spider.still > 5 && spider.cd <= 0) { spider.t = 0; show(spiderId, true); }
        else return;
      }
      spider.t += dt;
      const T = spider.t;
      let drop;
      if (T < 6) drop = smoothstep(0, 6, T) * 1.35;                 // slow descent
      else if (T < 14) drop = 1.35;                                  // dangle
      else if (T < 18) drop = 1.35 * (1 - smoothstep(14, 18, T));    // rewind
      else {
        spider.t = -1; spider.cd = 30; spider.still = 0;
        show(spiderId, false); segHide(spider.seg);
        return;
      }
      const sway = Math.sin(swayT * 1.7) * (0.02 + wind.gust * 0.1) * drop;
      const sx = spider.x + sway, sy = spider.y - drop;
      pose(spiderId, sx, sy, spider.z, swayT * 0.5, 0, sway * 2);
      segSet(spider.seg, spider.x, spider.y + 0.02, spider.z, sx, sy + 0.03, spider.z, 0.7, 0.7, 0.74);
    },
  });

  // -------------------------------------------------------------------------
  // #35 GNAT COLUMNS under the big oaks — disperse through-walk, whine dip
  // -------------------------------------------------------------------------
  const gnatSites = [];
  {
    const cands = forestPts.slice().sort(byVillage);
    for (let i = 0; i < 2; i++) {
      const p = cands[Math.min(i * 2, cands.length - 1)];
      gnatSites.push({ x: p.x, z: p.z, base: PD.alloc(14), disp: 0 });
    }
  }
  for (const gs of gnatSites) {
    actor(gs.x, gs.z, 34, {
      exit() {
        for (let i = 0; i < 14; i++) PD.hide(gs.base + i);
        if (AC && whineGain) whineGain.gain.setTargetAtTime(0, AC.currentTime, 0.2);
      },
      tick(dt) {
        const gy = terrainHeight(gs.x, gs.z);
        const dP = dist2d(gs.x, gs.z, px, pz);
        // walking through the column scatters it
        gs.disp = clamp(gs.disp + (dP < 1.6 ? dt * 3 : -dt * 0.8), 0, 1);
        const e = g.time.elapsed;
        for (let i = 0; i < 14; i++) {
          const ph = i * 2.7;
          const r = 0.25 + hash2(i, 1, 690) * 0.4 + gs.disp * (1.2 + hash2(i, 2, 690));
          PD.set(gs.base + i,
            gs.x + Math.cos(e * (2 + i * 0.2) + ph) * r + snoise(e * 0.9 + ph, i) * 0.15,
            gy + 1.1 + Math.sin(e * (1.6 + i * 0.13) + ph) * (0.5 + gs.disp * 0.4),
            gs.z + Math.sin(e * (1.8 + i * 0.17) + ph) * r,
            0.12, 0.11, 0.1, 0.05, 0.85);
        }
        // proximity whine with a pitch dip while dispersed
        if (AC && whineGain) {
          const prox = clamp(1 - dP / 5, 0, 1);
          const want = prox * 0.028 * (1 - gs.disp * 0.5);
          if (want > whineGain.gain.value || dP < 8) {
            whineGain.gain.setTargetAtTime(want, AC.currentTime, 0.12);
            whineOsc.frequency.setTargetAtTime(236 * (1 - gs.disp * 0.28), AC.currentTime, 0.15);
          }
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // #36 SPINDRIFT off Drakespire's crest — white points streaming with the
  // gust, backlit at dawn/dusk. Bubble-exempt.
  // -------------------------------------------------------------------------
  const drift = { base: PC.alloc(22), t: new Float32Array(22) };
  for (let i = 0; i < 22; i++) drift.t[i] = hash2(i, 1, 720);
  actor(POI.peak.x, POI.peak.z, ALWAYS, {
    tick(dt) {
      const f = g.time.dayFrac;
      const lit = winEnv(f, 0.20, 0.33, 0.3) + winEnv(f, 0.67, 0.80, 0.3);
      if (lit < 0.02) { for (let i = 0; i < 22; i++) PC.hide(drift.base + i); return; }
      const speed = 8 + wind.gust * 18;
      for (let i = 0; i < 22; i++) {
        let t = drift.t[i] + dt * (0.15 + wind.gust * 0.12) * (0.6 + hash2(i, 2, 720));
        if (t >= 1) t -= 1;
        drift.t[i] = t;
        const lat = (hash2(i, 3, 720) - 0.5) * 26;
        const d = t * speed * 4;
        PC.set(drift.base + i,
          POI.peak.x + wind.dir.x * d - wind.dir.z * lat,
          peakH + 2 + hash2(i, 4, 720) * 5 + Math.sin(t * 9 + i) * 1.5 - t * 6,
          POI.peak.z + wind.dir.z * d + wind.dir.x * lat,
          0.95, 0.97, 1.0, 4.5 * (1 - t * 0.5), lit * 0.5 * Math.sin(t * Math.PI));
      }
    },
  });

  // -------------------------------------------------------------------------
  // #37 DOCK AMBIENCE at Mirrormere — rope creak + lap-slaps while you
  // stand at the water's edge (sound is the whole illusion here)
  // -------------------------------------------------------------------------
  const dock = { lapT: 1, creakT: 5 };
  actor(dockPt.x, dockPt.z, 24, {
    tick(dt) {
      if (py > WATER_LEVEL + 6) return;
      dock.lapT -= dt; dock.creakT -= dt;
      if (dock.lapT <= 0) {
        dock.lapT = 1.8 + Math.random() * 2.4;
        const a = Math.atan2(POI.lake.x - px, POI.lake.z - pz);
        const s = spatial(px + Math.sin(a) * 3, WATER_LEVEL, pz + Math.cos(a) * 3, 4, 18);
        if (s.ok && gate('lap', 1)) sLap(0.11 * s.vol * (0.7 + wind.gust * 0.5), s.pan);
      }
      if (dock.creakT <= 0) {
        dock.creakT = 6 + Math.random() * 9;
        const s = spatial(dockPt.x, WATER_LEVEL + 1, dockPt.z, 3.5, 14);
        if (s.ok && gate('dockcreak', 3)) sCreak(0.12 * s.vol, s.pan);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #38 OWL at night + the ANSWERED WOLF HOWL — far south, and a second,
  // fainter voice answering from farther still, some nights only
  // -------------------------------------------------------------------------
  const nightVoices = { owlT: 45, howlDay: -1, howled: false };
  actor(0, 0, ALWAYS, {
    tick(dt) {
      const f = g.time.dayFrac;
      const night = f > 0.82 || f < 0.18;
      if (!night) { nightVoices.howled = false; return; }
      // owl — from a seeded forest point near the player
      nightVoices.owlT -= dt;
      if (nightVoices.owlT <= 0) {
        nightVoices.owlT = 60 + Math.random() * 90;
        let best = 0, bd = 1e9;
        for (let i = 0; i < forestPts.length; i++) {
          const d2 = (forestPts[i].x - px) * (forestPts[i].x - px) + (forestPts[i].z - pz) * (forestPts[i].z - pz);
          if (d2 < bd) { bd = d2; best = i; }
        }
        const p = forestPts[best];
        const s = spatial(p.x, terrainHeight(p.x, p.z) + 6, p.z, 14, 120);
        if (s.ok && gate('hoot', 20)) sHoot(0.14 * s.vol, s.pan);
      }
      // the answered howl — seeded to a few nights, once per night
      const dayIdx = Math.floor(g.time.elapsed / g.time.dayLength + 0.3 + 0.5);
      if (!nightVoices.howled && dayIdx !== nightVoices.howlDay
        && hash2(dayIdx, 331, 17) < 0.4
        && winEnv(f, 0.86, 0.14, 0.1) > hash2(dayIdx, 332, 17)) {
        nightVoices.howled = true; nightVoices.howlDay = dayIdx;
        if (AC && gate('howl', 60)) {
          const s1 = spatial(px - 40, py, pz + 260, 60, 1e9);   // far south
          sHowl(0, 1, 0.13 * Math.max(0.4, s1.vol), s1.ok ? s1.pan * 0.6 : 0.3, 0.6);
          const s2 = spatial(px - 240, py, pz + 420, 60, 1e9);  // farther southwest
          sHowl(4.4, 0.88, 0.08 * Math.max(0.35, s2.vol), s2.ok ? s2.pan * 0.6 : -0.4, 0.85);
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // #39 WILL-O'-WISP at the marsh edge — a drifting light that always
  // recedes; never explained
  // -------------------------------------------------------------------------
  const wisp = { base: PC.alloc(5), x: marshPt.x, z: marshPt.z, tx: marshPt.x, tz: marshPt.z, wanderT: 0 };
  actor(marshPt.x, marshPt.z, 95, {
    exit() { for (let i = 0; i < 5; i++) PC.hide(wisp.base + i); },
    tick(dt) {
      const f = g.time.dayFrac;
      const night = winEnv(f, 0.78, 0.22, 0.08);
      if (night < 0.02) { for (let i = 0; i < 5; i++) PC.hide(wisp.base + i); return; }
      const dP = dist2d(wisp.x, wisp.z, px, pz);
      if (dP < 15) {
        // recede — directly away, unhurried, unknowable
        const a = Math.atan2(wisp.x - px, wisp.z - pz);
        wisp.tx = wisp.x + Math.sin(a) * 8;
        wisp.tz = wisp.z + Math.cos(a) * 8;
      } else {
        wisp.wanderT -= dt;
        if (wisp.wanderT <= 0) {
          wisp.wanderT = 5 + Math.random() * 6;
          const a = Math.random() * TAU;
          wisp.tx = marshPt.x + Math.sin(a) * 14;
          wisp.tz = marshPt.z + Math.cos(a) * 14;
        }
      }
      // keep it from straying too far from home
      if (dist2d(wisp.tx, wisp.tz, marshPt.x, marshPt.z) > 42) { wisp.tx = marshPt.x; wisp.tz = marshPt.z; }
      wisp.x += (wisp.tx - wisp.x) * Math.min(1, dt * 0.55);
      wisp.z += (wisp.tz - wisp.z) * Math.min(1, dt * 0.55);
      const e = g.time.elapsed;
      const gy = Math.max(terrainHeight(wisp.x, wisp.z), WATER_LEVEL);
      const wy = gy + 1.1 + Math.sin(e * 0.8) * 0.3;
      const pulse = 0.7 + 0.3 * Math.sin(e * 2.3 + Math.sin(e * 0.9) * 2);
      PC.set(wisp.base, wisp.x, wy, wisp.z, 0.45, 0.95, 0.72, 2.6, night * 0.55 * pulse);
      PC.set(wisp.base + 1, wisp.x, wy, wisp.z, 0.7, 1.0, 0.85, 0.9, night * 0.9 * pulse);
      for (let i = 2; i < 5; i++) { // faint trailing embers
        const tph = e * 1.1 + i * 2.1;
        PC.set(wisp.base + i,
          wisp.x + Math.sin(tph) * 0.5, wy - 0.2 - (i - 2) * 0.25 + Math.cos(tph * 0.7) * 0.2, wisp.z + Math.cos(tph * 0.8) * 0.5,
          0.4, 0.85, 0.6, 0.7, night * 0.22 * pulse);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #40 STANDING-STONE MIDNIGHT MOTES — rising cold-blue points inside the
  // circle + a quiet 55 Hz hum that swells as you step in
  // -------------------------------------------------------------------------
  const stoneMotes = { base: PC.alloc(18), t: new Float32Array(18) };
  for (let i = 0; i < 18; i++) stoneMotes.t[i] = hash2(i, 1, 740);
  const stonesH = terrainHeight(POI.stones.x, POI.stones.z);
  actor(POI.stones.x, POI.stones.z, 60, {
    exit() {
      for (let i = 0; i < 18; i++) PC.hide(stoneMotes.base + i);
      if (AC && humGain) humGain.gain.setTargetAtTime(0, AC.currentTime, 0.4);
    },
    tick(dt) {
      const f = g.time.dayFrac;
      const midnight = winEnv(f, 0.98, 0.04, 0.25);
      if (midnight < 0.02) {
        for (let i = 0; i < 18; i++) PC.hide(stoneMotes.base + i);
        if (AC && humGain) humGain.gain.setTargetAtTime(0, AC.currentTime, 0.5);
        return;
      }
      for (let i = 0; i < 18; i++) {
        let t = stoneMotes.t[i] + dt * (0.09 + hash2(i, 2, 740) * 0.06);
        if (t >= 1) t -= 1;
        stoneMotes.t[i] = t;
        const a = hash2(i, 3, 740) * TAU + t * 0.8;
        const r = 1 + hash2(i, 4, 740) * 4.5;
        PC.set(stoneMotes.base + i,
          POI.stones.x + Math.cos(a) * r, stonesH + 0.2 + t * 3.4, POI.stones.z + Math.sin(a) * r,
          0.5, 0.75, 1.0, 0.2, midnight * 0.6 * Math.sin(t * Math.PI));
      }
      if (AC && humGain) {
        const prox = clamp(1 - dist2d(px, pz, POI.stones.x, POI.stones.z) / 10, 0, 1);
        humGain.gain.setTargetAtTime(0.05 * prox * midnight, AC.currentTime, 0.4);
      }
    },
  });

  // -------------------------------------------------------------------------
  // #41 ICE CRACK on the peak snowfield — rare deep whoom + a hairline dark
  // line underfoot for ten seconds
  // -------------------------------------------------------------------------
  const ice = { segs: segAlloc(8), next: 70, t: -1 };
  actor(0, 0, ALWAYS, {
    tick(dt) {
      if (ice.t < 0) {
        if (py < 94) return; // only the high snowfield
        ice.next -= dt;
        if (ice.next > 0) return;
        ice.next = 80 + Math.random() * 120;
        ice.t = 0;
        // jagged hairline walking away from the player's feet
        let x = px + (Math.random() - 0.5) * 2, z = pz + (Math.random() - 0.5) * 2;
        let a = Math.random() * TAU;
        for (let i = 0; i < 8; i++) {
          const x2 = x + Math.sin(a) * (0.5 + Math.random() * 0.5);
          const z2 = z + Math.cos(a) * (0.5 + Math.random() * 0.5);
          segSet(ice.segs + i, x, terrainHeight(x, z) + 0.05, z, x2, terrainHeight(x2, z2) + 0.05, z2, 0.1, 0.12, 0.16);
          x = x2; z = z2; a += (Math.random() - 0.5) * 1.5;
        }
        const s = spatial(px, py - 2, pz, 20, 60);
        if (AC && gate('ice', 20)) sIce(0.3 * (s.ok ? s.vol : 0.8), s.ok ? s.pan : 0);
        if (g.player && g.player.addShake) g.player.addShake(0.12);
      } else {
        ice.t += dt;
        if (ice.t > 10) {
          ice.t = -1;
          for (let i = 0; i < 8; i++) segHide(ice.segs + i);
          return;
        }
        // the line heals: dark → snow-white → gone
        const T = ice.t / 10;
        const c = lerp(0.11, 0.85, T * T);
        for (let i = 0; i < 8; i++) {
          const o = (ice.segs + i) * 6;
          lineCol[o] = c; lineCol[o + 1] = c + 0.02; lineCol[o + 2] = c + 0.05;
          lineCol[o + 3] = c; lineCol[o + 4] = c + 0.02; lineCol[o + 5] = c + 0.05;
        }
        lineDirty = true;
      }
    },
  });

  // -------------------------------------------------------------------------
  // #42 FOOTSTEP DUST + FADING FOOTPRINTS — village paths & snowfields
  // (event-driven; ring buffer of 12 prints, 8 s fade)
  // -------------------------------------------------------------------------
  const prints = {
    base: ringAlloc(12), idx: 0, side: 1,
    age: new Float32Array(12), snow: new Uint8Array(12),
    x: new Float32Array(12), y: new Float32Array(12), z: new Float32Array(12),
    yaw: new Float32Array(12),
  };
  for (let i = 0; i < 12; i++) prints.age[i] = -1;
  const stepDust = { base: PD.alloc(4), idx: 0, age: new Float32Array(4), x: new Float32Array(4), y: new Float32Array(4), z: new Float32Array(4) };
  g.events.on('footstep', (ev) => {
    if (g.paused || !g.player) return;
    const p = g.player.position;
    const snow = biomeAt(p.x, p.z) === BIOME.SNOW;
    const onPath = dist2d(p.x, p.z, 0, 0) < 70 && ev && (ev.surface === 'grass' || ev.surface === 'stone' || ev.surface === 'sand');
    if (!snow && !onPath) return;
    prints.side = -prints.side;
    const i = prints.idx; prints.idx = (prints.idx + 1) % 12;
    const yaw = g.player.yaw || 0;
    prints.age[i] = 0.001;
    prints.snow[i] = snow ? 1 : 0;
    prints.x[i] = p.x + Math.cos(yaw) * 0.18 * prints.side;
    prints.z[i] = p.z - Math.sin(yaw) * 0.18 * prints.side;
    prints.y[i] = terrainHeight(prints.x[i], prints.z[i]) + 0.04;
    prints.yaw[i] = yaw;
    if (!snow) { // dry-path dust kick
      const k = stepDust.idx; stepDust.idx = (stepDust.idx + 1) % 4;
      stepDust.age[k] = 0.001;
      stepDust.x[k] = p.x; stepDust.y[k] = prints.y[i] + 0.1; stepDust.z[k] = p.z;
    }
  });
  actor(0, 0, ALWAYS, {
    tick(dt) {
      for (let i = 0; i < 12; i++) {
        if (prints.age[i] < 0) continue;
        prints.age[i] += dt;
        if (prints.age[i] > 8) { prints.age[i] = -1; ringHide(prints.base + i); continue; }
        const a = 1 - prints.age[i] / 8;
        if (prints.snow[i]) ringSet(prints.base + i, prints.x[i], prints.y[i], prints.z[i], 0.24, 0.4, prints.yaw[i], 0.95, 0.97, 1.0, 0.4 * a);
        else ringSet(prints.base + i, prints.x[i], prints.y[i], prints.z[i], 0.22, 0.36, prints.yaw[i], 0.32, 0.26, 0.18, 0.3 * a);
      }
      for (let k = 0; k < 4; k++) {
        if (stepDust.age[k] <= 0) continue;
        stepDust.age[k] += dt;
        if (stepDust.age[k] > 0.7) { stepDust.age[k] = 0; PD.hide(stepDust.base + k); continue; }
        const t = stepDust.age[k] / 0.7;
        PD.set(stepDust.base + k, stepDust.x[k], stepDust.y[k] + t * 0.3, stepDust.z[k],
          0.6, 0.53, 0.42, 0.2 + t * 0.4, 0.3 * (1 - t));
      }
    },
  });

  // -------------------------------------------------------------------------
  // #43 CLOUD SHADOW DRIFT — one soft dark blob sliding with the wind
  // -------------------------------------------------------------------------
  actor(0, 0, ALWAYS, {
    tick(dt) {
      const sunEl = g.sky ? g.sky.sunDir.y : 0.5;
      const day = smoothstep(0.03, 0.2, sunEl);
      const cover = 0.5 + 0.5 * fbm(g.time.elapsed * 0.006 + 12.3, 5.5, 2);
      const alpha = day * cover * 0.16;
      cldUniforms.uAlpha.value = alpha;
      cldUniforms.uTime.value = g.time.elapsed;
      cloudShadow.visible = alpha > 0.015;
      if (!cloudShadow.visible) return;
      const speed = 2.4 + wind.gust * 2.6;
      cldOff.x += wind.dir.x * speed * dt;
      cldOff.z += wind.dir.z * speed * dt;
      // wrap back upwind so a shadow crosses the player's area every so often
      if (cldOff.x * cldOff.x + cldOff.z * cldOff.z > 90 * 90) {
        const lat = (Math.random() - 0.5) * 120;
        cldOff.x = -wind.dir.x * 85 - wind.dir.z * lat;
        cldOff.z = -wind.dir.z * 85 + wind.dir.x * lat;
      }
      const cx = px + cldOff.x, cz = pz + cldOff.z;
      terrainNormal(cx, cz, 6, _n1);
      cloudShadow.position.set(cx, terrainHeight(cx, cz) + 0.35, cz);
      _v1.set(_n1.x, _n1.y, _n1.z);
      _q1.setFromUnitVectors(_axisY, _v1);
      cloudShadow.quaternion.copy(_q1);
      cloudShadow.rotateX(-Math.PI / 2);
    },
  });

  // -------------------------------------------------------------------------
  // #44 MOLE HILLS — 2-3 fresh mounds a day rise from the meadow with a
  // puff of dirt
  // -------------------------------------------------------------------------
  const moles = [];
  for (let i = 0; i < 3; i++) {
    moles.push({
      id: addPart(new Bake(1100 + i).put(TPL.cone, 0, 0.14, 0, 0.62, 0.3, 0.62, 0, 0, 0, 0x4f3a26, 0.16).geo(), false),
      day: -1, x: 0, z: 0, grow: -1, slot: 0.34 + i * 0.14,
    });
  }
  const moleDirt = { base: PD.alloc(6), t: -1, x: 0, z: 0 };
  actor(0, 0, ALWAYS, {
    tick(dt) {
      const f = g.time.dayFrac;
      const dayIdx = Math.floor(g.time.elapsed / g.time.dayLength + 0.3);
      for (let i = 0; i < 3; i++) {
        const m = moles[i];
        // each mound has a daytime slot; skip the third on some days
        if (m.day !== dayIdx && f > m.slot && f < 0.75
          && !(i === 2 && hash2(dayIdx, i, 760) < 0.4)) {
          if (biomeAt(px, pz) === BIOME.MEADOW) {
            const a = hash2(dayIdx, i * 7, 761) * TAU;
            const d = 8 + hash2(dayIdx, i * 7 + 1, 761) * 8;
            const x = px + Math.sin(a) * d, z = pz + Math.cos(a) * d;
            if (biomeAt(x, z) === BIOME.MEADOW) {
              m.day = dayIdx; m.x = x; m.z = z; m.grow = 0;
              show(m.id, true);
              moleDirt.t = 0.001; moleDirt.x = x; moleDirt.z = z;
              const s = spatial(x, terrainHeight(x, z), z, 4, 20);
              if (s.ok && gate('mole', 4)) sEarth(0.12 * s.vol, s.pan);
            }
          }
        }
        if (m.grow >= 0) {
          m.grow = Math.min(1, m.grow + dt * 0.4);
          const sc = smoothstep(0, 1, m.grow);
          pose(m.id, m.x, terrainHeight(m.x, m.z), m.z, 0, 0, 0, sc, sc * (1 + Math.sin(m.grow * 18) * 0.1 * (1 - m.grow)), sc);
          if (f > 0.85 || f < m.slot - 0.2) { m.grow = -1; show(m.id, false); } // gone by night
        }
      }
      if (moleDirt.t > 0) {
        moleDirt.t += dt;
        if (moleDirt.t > 1.6) { moleDirt.t = -1; for (let i = 0; i < 6; i++) PD.hide(moleDirt.base + i); }
        else {
          const gy = terrainHeight(moleDirt.x, moleDirt.z);
          const T = moleDirt.t / 1.6;
          for (let i = 0; i < 6; i++) {
            const a = hash2(i, 3, 762) * TAU;
            PD.set(moleDirt.base + i,
              moleDirt.x + Math.cos(a) * T * 0.5, gy + 0.15 + Math.sin(T * Math.PI) * 0.4 * hash2(i, 4, 762),
              moleDirt.z + Math.sin(a) * T * 0.5,
              0.36, 0.27, 0.17, 0.16, 0.9 * (1 - T));
          }
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // #45 DRAGONFLIES over the lake reeds — hover, dart, hover; 20 Hz shimmer
  // -------------------------------------------------------------------------
  const dfly = { base: flutAlloc(3), t: [] };
  for (let i = 0; i < 3; i++) {
    dfly.t.push({
      x: reedPt.x + hash2(i, 1, 780) * 5 - 2.5, z: reedPt.z + hash2(i, 2, 780) * 5 - 2.5,
      tx: 0, tz: 0, ty: 0, y: 0, wait: i, dart: -1, fx: 0, fz: 0,
    });
    dfly.t[i].y = Math.max(terrainHeight(dfly.t[i].x, dfly.t[i].z), WATER_LEVEL) + 0.8;
  }
  actor(reedPt.x, reedPt.z, 42, {
    enter() {
      for (let i = 0; i < 3; i++) flutColor(dfly.base + i, 0.35, 0.8, 0.85);
      flut.instanceColor.needsUpdate = true;
    },
    exit() { for (let i = 0; i < 3; i++) flutHide(dfly.base + i); flut.instanceMatrix.needsUpdate = true; },
    tick(dt) {
      const f = g.time.dayFrac;
      const daytime = f > 0.28 && f < 0.74;
      const e = g.time.elapsed;
      for (let i = 0; i < 3; i++) {
        const d = dfly.t[i];
        if (!daytime) { flutHide(dfly.base + i); continue; }
        if (d.dart >= 0) {
          d.dart += dt;
          const T = Math.min(1, d.dart / 0.22);
          d.x = lerp(d.fx, d.tx, T); d.z = lerp(d.fz, d.tz, T);
          d.y = lerp(d.y, d.ty, T * 0.6);
          if (T >= 1) { d.dart = -1; d.wait = 1.2 + Math.random() * 2.6; }
        } else {
          d.wait -= dt;
          if (d.wait <= 0) {
            d.dart = 0; d.fx = d.x; d.fz = d.z;
            const a = Math.random() * TAU;
            d.tx = clamp(d.x + Math.cos(a) * (1 + Math.random() * 2.2), reedPt.x - 7, reedPt.x + 7);
            d.tz = clamp(d.z + Math.sin(a) * (1 + Math.random() * 2.2), reedPt.z - 7, reedPt.z + 7);
            d.ty = Math.max(terrainHeight(d.tx, d.tz), WATER_LEVEL) + 0.5 + Math.random() * 0.9;
          }
        }
        // 20 Hz wing shimmer: rapid width pulse + hover bob
        const shim = 0.5 + 0.5 * Math.sin(e * 125.6 + i * 2);
        flutSet(dfly.base + i,
          d.x, d.y + Math.sin(e * 3.3 + i * 2.2) * 0.06, d.z,
          0.2 + Math.sin(e * 4 + i) * 0.15,
          0.14 + shim * 0.06, 0.035);
      }
      flut.instanceMatrix.needsUpdate = true;
    },
  });

  // =========================================================================
  // UPDATE — buckets, schedulers, buffer flushes
  // =========================================================================
  const _axisY = new THREE.Vector3(0, 1, 0);
  let wasPaused = false;

  function flush() {
    PC.flush();
    PD.flush();
    if (lineDirty) { linePosA.needsUpdate = true; lineColA.needsUpdate = true; lineDirty = false; }
    if (clothDirty) { clothGeo.attributes.position.needsUpdate = true; clothDirty = false; }
  }

  function update(dt) {
    frame++;
    swayT += g.time.rawDt;              // idle sway breathes even while paused

    // point sprite scale tracks the (adaptive) framebuffer height
    const pxScale = g.renderer.domElement.height * 0.5;
    PC.mat.uniforms.uPx.value = pxScale;
    PD.mat.uniforms.uPx.value = pxScale;

    if (g.player && g.player.position) {
      px = g.player.position.x; py = g.player.position.y; pz = g.player.position.z;
      const v = g.player.velocity;
      playerSpeed = v ? Math.hypot(v.x, v.z) : 0;
    }

    if (g.paused) {
      // freeze behavior; keep the gentle idle sway of active swayers
      gustSpike = false;
      if (!wasPaused) {
        wasPaused = true;
        if (AC) {
          if (humGain) humGain.gain.setTargetAtTime(0, AC.currentTime, 0.3);
          if (whineGain) whineGain.gain.setTargetAtTime(0, AC.currentTime, 0.3);
        }
      }
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (a.on && a.sway) a.tick(0);
      }
      flush();
      return;
    }
    wasPaused = false;

    updateWind();          // #1 — before everything that samples it
    tickBell();            // #3 scheduler
    tickStars(dt);         // #12 — per frame: fast movers need smooth motion
    tickAurora();          // #14 — two uniform writes
    tickRings(dt);         // shared expanding rings (16, 17, 25, 33)

    // 3-bucket round-robin: each actor ticks every 3rd frame with its own
    // accumulated dt; distance gate enters/exits the 40u bubble.
    dtAcc[0] += dt; dtAcc[1] += dt; dtAcc[2] += dt;
    const b = frame % 3;
    const dtB = Math.min(dtAcc[b], 0.16);
    dtAcc[b] = 0;
    for (let i = b; i < actors.length; i += 3) {
      const a = actors[i];
      const dx = a.x - px, dz = a.z - pz;
      if (dx * dx + dz * dz < a.r2) {
        if (!a.on) { a.on = true; if (a.enter) a.enter(); }
        a.tick(dtB);
      } else if (a.on) {
        a.on = false;
        if (a.exit) a.exit();
      }
    }

    flush();
  }

  return { update, wind };
}

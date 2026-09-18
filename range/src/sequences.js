// ============================================================================
// RANGE — sequences.js
// Keyframed handling sequences (reloads, charging, bolt cycle, inspect, press
// check, weapon switch). All positions are in the WEAPON frame (metres), all
// rotations are Euler radians. Channels:
//   gun  : { pos, rot }          offset applied to the whole weapon (tilt-in for reloads etc.)
//   lh   : { pos, rot, pose, k } left hand wrist transform (absolute in the weapon frame) and finger pose
//   rh   : { pos, rot, pose }    right hand (defaults to the grip when omitted)
//   mag  : { pos, rot, vis }     magazine offset from its seat; vis false hides it (it left with the hand / dropped)
//   ch   : number                charging handle / slide pull (0..1)
//   bolt : { lift, pull }        bolt-action handle
//   ev   : [names]               discrete events fired once when the playhead passes the key
// Keys interpolate with smoothstep; a channel missing on a key holds its previous value.
// ============================================================================
import * as THREE from 'three';
import { orientHand } from './hands.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const E = (x, y, z) => new THREE.Euler(x, y, z);
const D = Math.PI / 180;
const H = (fx, fy, fz, px, py, pz) => orientHand(new THREE.Vector3(fx, fy, fz), new THREE.Vector3(px, py, pz));

/** Build the sequence set for a weapon api (uses its anchors for hand placement). */
export function buildSequences(w) {
  const A = w.anchors, S = w.spec;
  const R = A.gripR, L = A.gripL;
  const lhHome = { pos: L.pos, rot: L.rot, pose: S.action === 'recoil' ? 'pistolSupport' : 'cclamp' };
  const rhHome = { pos: R.pos, rot: R.rot, pose: 'gripSafe' };
  const seqs = {};

  if (S.id === 'ar15') {
    const magSeat = A.magSeat;
    // hand holding the mag: wrist to the left-below of the mag body, fingers around it
    // left hand holds the mag from its left side: fingers curl around the front spine, palm faces +X, wrist below the floorplate
    const holdMag = (magOff) => ({ pos: V(magSeat.x - 0.040 + magOff.x, magSeat.y - 0.135 + magOff.y, magSeat.z + 0.005 + magOff.z), rot: H(0.1, 0.9, -0.45, 1, 0, 0.1), pose: 'magGrip' });
    const tilt = { pos: V(-0.02, 0.06, 0.02), rot: E(-0.15, 0.35, 0.50) };
    const reload = (empty) => ({
      duration: empty ? 2.25 : 1.95,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true } },
        { t: 0.28, gun: tilt, lh: holdMag(V(0, 0, 0)), rh: { ...rhHome, pose: 'gripFire' }, ev: ['magRelease'] },
        { t: 0.42, lh: holdMag(V(0, -0.06, 0.01)), mag: { pos: V(0, -0.06, 0.01), rot: E(0.15, 0, 0), vis: true }, ev: ['magOut'] },
        { t: 0.55, lh: holdMag(V(-0.05, -0.28, 0.16)), mag: { pos: V(-0.05, -0.28, 0.16), rot: E(0.6, 0, 0.3), vis: true }, rh: rhHome },
        { t: 0.62, mag: { vis: false }, ev: ['magStow'] },
        { t: 0.95, lh: holdMag(V(-0.08, -0.34, 0.22)), mag: { pos: V(-0.08, -0.34, 0.22), rot: E(0.7, 0, 0.4), vis: false }, ev: ['magGrab'] },
        { t: 1.00, mag: { vis: true } },
        { t: 1.25, lh: holdMag(V(-0.01, -0.09, 0.02)), mag: { pos: V(-0.01, -0.09, 0.02), rot: E(0.18, 0, 0.05), vis: true } },
        { t: 1.38, lh: holdMag(V(0, 0, 0)), mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true }, ev: ['magIn'] },
        { t: 1.46, lh: holdMag(V(0, -0.006, 0.002)), mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true } },
        { t: 1.52, gun: tilt, lh: holdMag(V(0, 0.004, 0)) },
        ...(empty ? [
          { t: 1.72, lh: { pos: V(A.boltCatch.x - 0.045, A.boltCatch.y - 0.070, A.boltCatch.z + 0.030), rot: H(0.2, 0.95, -0.2, 1, 0, 0), pose: 'thumbPress' } },
          { t: 1.82, gun: tilt, lh: { pos: V(A.boltCatch.x - 0.038, A.boltCatch.y - 0.066, A.boltCatch.z + 0.026), rot: H(0.2, 0.95, -0.2, 1, 0, 0), pose: 'thumbPress' }, ev: ['boltRelease'] },
          { t: 1.95, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x, L.pos.y - 0.06, L.pos.z + 0.10), rot: L.rot, pose: 'cclamp' } },
          { t: 2.25, lh: lhHome, rh: rhHome },
        ] : [
          { t: 1.70, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x, L.pos.y - 0.06, L.pos.z + 0.10), rot: L.rot, pose: 'cclamp' } },
          { t: 1.95, lh: lhHome, rh: rhHome },
        ]),
      ],
    });
    seqs.reloadEmpty = reload(true);
    seqs.reloadTac = reload(false);
    // charging handle pull (initial chamber / clear)
    const chPos = A.chargingHandle;
    seqs.charge = {
      duration: 1.25,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, ch: 0 },
        { t: 0.30, gun: { pos: V(-0.04, 0.08, 0.02), rot: E(0.0, -0.30, 0.40) }, lh: { pos: V(chPos.x - 0.045, chPos.y - 0.030, chPos.z - 0.075), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'pinch' }, ch: 0 },
        { t: 0.42, lh: { pos: V(chPos.x - 0.045, chPos.y - 0.030, chPos.z - 0.075 + 0.015), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'pinch' }, ch: 0.15, ev: ['chStart'] },
        { t: 0.62, lh: { pos: V(chPos.x - 0.045, chPos.y - 0.030, chPos.z - 0.075 + 0.085), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'pinch' }, ch: 1.0, ev: ['chRear'] },
        { t: 0.70, gun: { pos: V(-0.04, 0.08, 0.02), rot: E(0.0, -0.30, 0.40) }, ch: 1.0, ev: ['chRelease'] },
        { t: 0.80, lh: { pos: V(chPos.x - 0.03, chPos.y - 0.05, chPos.z - 0.02), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'open' }, ch: 0 },
        { t: 1.05, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x, L.pos.y - 0.05, L.pos.z + 0.08), rot: L.rot, pose: 'cclamp' } },
        { t: 1.25, lh: lhHome },
      ],
    };
    seqs.pressCheck = {
      duration: 1.6,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, ch: 0 },
        { t: 0.30, gun: { pos: V(-0.04, 0.08, 0.02), rot: E(0.0, -0.35, 0.60) }, lh: { pos: V(chPos.x - 0.045, chPos.y - 0.030, chPos.z - 0.075), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'pinch' }, ch: 0 },
        { t: 0.45, lh: { pos: V(chPos.x - 0.045, chPos.y - 0.030, chPos.z - 0.075 + 0.012), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'pinch' }, ch: 0.14, ev: ['chStart'] },
        { t: 1.05, gun: { pos: V(-0.04, 0.08, 0.02), rot: E(0.0, -0.35, 0.60) }, lh: { pos: V(chPos.x - 0.045, chPos.y - 0.030, chPos.z - 0.075 + 0.012), rot: H(0.3, 0.2, 0.93, 1, -0.3, 0), pose: 'pinch' }, ch: 0.14 },
        { t: 1.15, ch: 0, ev: ['chHome'] },
        { t: 1.40, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x, L.pos.y - 0.05, L.pos.z + 0.08), rot: L.rot, pose: 'cclamp' } },
        { t: 1.60, lh: lhHome },
      ],
    };
  }

  if (S.id === 'pistol') {
    const magSeat = A.magSeat;
    const holdMag = (o) => ({ pos: V(magSeat.x - 0.035 + o.x, magSeat.y - 0.165 + o.y, magSeat.z + 0.045 + o.z), rot: H(0.1, 0.92, -0.35, 1, 0, 0.1), pose: 'magGrip' });
    const tilt = { pos: V(-0.06, 0.10, 0.04), rot: E(0.35, -0.30, -0.35) };
    const reload = (empty) => ({
      duration: empty ? 2.05 : 1.7,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true } },
        { t: 0.22, gun: tilt, rh: { ...rhHome, pose: 'thumbPress' }, lh: { pos: V(L.pos.x - 0.06, L.pos.y - 0.12, L.pos.z + 0.10), rot: H(0.1, -0.5, -0.85, 1, 0, 0), pose: 'open' }, ev: ['magRelease'] },
        { t: 0.30, mag: { pos: V(0, -0.03, 0.01), rot: E(0.05, 0, 0), vis: true }, ev: ['magOut'] },
        { t: 0.36, mag: { pos: V(0, -0.12, 0.04), rot: E(0.2, 0, 0.1), vis: true } },
        { t: 0.40, mag: { vis: false }, ev: ['magDropped'], rh: rhHome },
        { t: 0.80, lh: holdMag(V(-0.05, -0.30, 0.20)), mag: { pos: V(-0.05, -0.30, 0.20), rot: E(0.6, 0, 0.4), vis: false }, ev: ['magGrab'] },
        { t: 0.86, mag: { vis: true } },
        { t: 1.10, lh: holdMag(V(0, -0.075, 0.02)), mag: { pos: V(0, -0.075, 0.02), rot: E(0.12, 0, 0.04), vis: true } },
        { t: 1.22, lh: holdMag(V(0, 0, 0)), mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true }, ev: ['magIn'] },
        { t: 1.30, gun: tilt, lh: holdMag(V(0, 0.004, 0)) },
        ...(empty ? [
          { t: 1.48, lh: { pos: V(-0.075, 0.040, 0.030), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'pinch' }, ch: 0.89 },
          { t: 1.60, lh: { pos: V(-0.075, 0.040, 0.030 + 0.006), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'pinch' }, ch: 1.0, ev: ['slideRack'] },
          { t: 1.66, gun: tilt, lh: { pos: V(-0.09, 0.02, 0.06), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'open' }, ch: 1.0, ev: ['slideRelease'] },
          { t: 1.85, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x - 0.02, L.pos.y - 0.04, L.pos.z + 0.03), rot: L.rot, pose: 'pistolSupport' } },
          { t: 2.05, lh: lhHome, rh: rhHome },
        ] : [
          { t: 1.50, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x - 0.02, L.pos.y - 0.04, L.pos.z + 0.03), rot: L.rot, pose: 'pistolSupport' } },
          { t: 1.70, lh: lhHome, rh: rhHome },
        ]),
      ],
    });
    seqs.reloadEmpty = reload(true);
    seqs.reloadTac = reload(false);
    seqs.charge = {
      duration: 1.15,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, ch: 0 },
        { t: 0.25, gun: { pos: V(-0.06, 0.05, 0.02), rot: E(-0.2, -0.3, -0.35) }, lh: { pos: V(-0.075, 0.040, 0.030 - 0.04), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'pinch' }, ch: 0 },
        { t: 0.42, lh: { pos: V(-0.075, 0.040, 0.030 + 0.006), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'pinch' }, ch: 1.0, ev: ['slideRack'] },
        { t: 0.50, lh: { pos: V(-0.09, 0.02, 0.06), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'open' }, ch: 1.0, ev: ['slideRelease'] },
        { t: 0.60, gun: { pos: V(-0.06, 0.05, 0.02), rot: E(-0.2, -0.3, -0.35) }, ch: 0 },
        { t: 0.90, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x - 0.02, L.pos.y - 0.04, L.pos.z + 0.03), rot: L.rot, pose: 'pistolSupport' } },
        { t: 1.15, lh: lhHome },
      ],
    };
    seqs.pressCheck = {
      duration: 1.5,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, ch: 0 },
        { t: 0.28, gun: { pos: V(-0.06, 0.05, 0.02), rot: E(-0.2, -0.35, -0.5) }, lh: { pos: V(-0.075, 0.040, -0.010), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'pinch' }, ch: 0 },
        { t: 0.42, lh: { pos: V(-0.075, 0.040, -0.002), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'pinch' }, ch: 0.18, ev: ['chStart'] },
        { t: 1.00, gun: { pos: V(-0.06, 0.05, 0.02), rot: E(-0.2, -0.35, -0.5) }, ch: 0.18 },
        { t: 1.08, lh: { pos: V(-0.09, 0.02, 0.03), rot: H(0.95, -0.3, 0, 0, -1, 0), pose: 'open' }, ch: 0, ev: ['chHome'] },
        { t: 1.30, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x - 0.02, L.pos.y - 0.04, L.pos.z + 0.03), rot: L.rot, pose: 'pistolSupport' } },
        { t: 1.50, lh: lhHome },
      ],
    };
  }

  if (S.id === 'bolt') {
    const magSeat = A.magSeat;
    const holdMag = (o) => ({ pos: V(magSeat.x - 0.04 + o.x, magSeat.y - 0.11 + o.y, magSeat.z + 0.01 + o.z), rot: H(0.1, 0.9, -0.45, 1, 0, 0.1), pose: 'magGrip' });
    const tilt = { pos: V(-0.02, 0.06, 0.02), rot: E(-0.12, 0.35, 0.50) };
    seqs.reloadEmpty = seqs.reloadTac = {
      duration: 2.2,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true } },
        { t: 0.30, gun: tilt, lh: holdMag(V(0, 0, 0)), ev: ['magRelease'] },
        { t: 0.45, lh: holdMag(V(0, -0.05, 0.01)), mag: { pos: V(0, -0.05, 0.01), rot: E(0.1, 0, 0), vis: true }, ev: ['magOut'] },
        { t: 0.62, lh: holdMag(V(-0.06, -0.26, 0.15)), mag: { pos: V(-0.06, -0.26, 0.15), rot: E(0.5, 0, 0.3), vis: true } },
        { t: 0.68, mag: { vis: false }, ev: ['magStow'] },
        { t: 1.05, lh: holdMag(V(-0.08, -0.32, 0.20)), mag: { pos: V(-0.08, -0.32, 0.20), rot: E(0.6, 0, 0.4), vis: false }, ev: ['magGrab'] },
        { t: 1.10, mag: { vis: true } },
        { t: 1.40, lh: holdMag(V(-0.005, -0.07, 0.03)), mag: { pos: V(-0.005, -0.07, 0.03), rot: E(0.25, 0, 0.03), vis: true } },
        { t: 1.52, lh: holdMag(V(0, 0, 0)), mag: { pos: V(0, 0, 0), rot: E(0, 0, 0), vis: true }, ev: ['magIn'] },
        { t: 1.60, gun: tilt, lh: holdMag(V(0, -0.005, 0)) },
        { t: 1.90, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: { pos: V(L.pos.x, L.pos.y - 0.05, L.pos.z + 0.08), rot: L.rot, pose: 'cclamp' } },
        { t: 2.20, lh: lhHome, rh: rhHome },
      ],
    };
    // bolt cycle: right hand off the grip, up to the knob; lift, pull, push, lock; back to the grip
    const K = w.parts.bolt.knob; // knob position with the bolt closed (weapon frame)
    const onKnob = (dz, lifted) => ({ pos: V(K.x + 0.015, K.y + (lifted ? 0.06 : 0.0), K.z + 0.055 + dz), rot: lifted ? H(-0.2, -0.9, -0.4, -1, 0.3, 0) : H(-0.9, -0.3, -0.3, -0.3, -1, 0), pose: 'boltPalm' });
    seqs.boltCycle = {
      duration: 1.35,
      keys: [
        { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome, bolt: { lift: 0, pull: 0 } },
        { t: 0.22, gun: { pos: V(-0.02, 0.02, 0.0), rot: E(0.05, -0.05, 0.25) }, rh: onKnob(0, false), bolt: { lift: 0, pull: 0 } },
        { t: 0.34, rh: onKnob(0, true), bolt: { lift: 1, pull: 0 }, ev: ['boltLift'] },
        { t: 0.56, rh: onKnob(S.boltTravel, true), bolt: { lift: 1, pull: 1 }, ev: ['boltRear'] },
        { t: 0.62, bolt: { lift: 1, pull: 1 } },
        { t: 0.84, rh: onKnob(0, true), bolt: { lift: 1, pull: 0 }, ev: ['boltHome'] },
        { t: 0.96, gun: { pos: V(-0.02, 0.02, 0.0), rot: E(0.05, -0.05, 0.25) }, rh: onKnob(0, false), bolt: { lift: 0, pull: 0 }, ev: ['boltLock'] },
        { t: 1.12, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, rh: { pos: V(R.pos.x + 0.01, R.pos.y + 0.01, R.pos.z + 0.01), rot: R.rot, pose: 'gripSafe' } },
        { t: 1.35, rh: rhHome, lh: lhHome },
      ],
    };
    seqs.charge = seqs.boltCycle;
  }

  // --- generic: inspect, holster/draw ---
  seqs.inspect = {
    duration: 3.6,
    keys: [
      { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome },
      { t: 0.70, gun: { pos: V(-0.06, 0.02, 0.06), rot: E(0.15, 0.85, 0.35) }, lh: { pos: V(L.pos.x - 0.02, L.pos.y - 0.02, L.pos.z + 0.02), rot: L.rot, pose: lhHome.pose } },
      { t: 1.60, gun: { pos: V(-0.06, 0.02, 0.06), rot: E(0.15, 0.85, 0.35) } },
      { t: 2.40, gun: { pos: V(0.02, 0.04, 0.05), rot: E(-0.10, -0.75, -0.25) } },
      { t: 3.05, gun: { pos: V(0.02, 0.04, 0.05), rot: E(-0.10, -0.75, -0.25) } },
      { t: 3.60, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome },
    ],
  };
  seqs.holster = { duration: 0.42, keys: [
    { t: 0.00, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) }, lh: lhHome, rh: rhHome },
    { t: 0.42, gun: { pos: V(0.08, -0.32, 0.02), rot: E(-0.9, -0.3, 0.2) } },
  ] };
  seqs.draw = { duration: 0.55, keys: [
    { t: 0.00, gun: { pos: V(0.08, -0.32, 0.02), rot: E(-0.9, -0.3, 0.2) }, lh: lhHome, rh: rhHome },
    { t: 0.55, gun: { pos: V(0, 0, 0), rot: E(0, 0, 0) } },
  ] };
  return seqs;
}

/** Sequence player: evaluates channels at time t with smoothstep between keys, fires events once. */
export class SequencePlayer {
  constructor() { this.seq = null; this.t = 0; this.fired = new Set(); this.state = {}; this.speed = 1; this.onEvent = null; this.done = true; }
  play(seq, onEvent, speed = 1) {
    this.seq = seq; this.t = 0; this.fired.clear(); this.onEvent = onEvent; this.speed = speed; this.done = false;
    // initialise channel state from the first key
    this.state = {};
    this.evalAt(0);
  }
  cancel() { this.seq = null; this.done = true; }
  get active() { return !!this.seq && !this.done; }
  update(dt) {
    if (!this.seq || this.done) return;
    this.t += dt * this.speed;
    // fire events whose key time has been passed
    for (const k of this.seq.keys) if (k.ev && this.t >= k.t && !this.fired.has(k)) { this.fired.add(k); for (const e of k.ev) this.onEvent?.(e); }
    this.evalAt(this.t);
    if (this.t >= this.seq.duration) { this.done = true; this.seq = null; }
  }
  evalAt(t) {
    const keys = this.seq.keys;
    for (const ch of ['gun', 'lh', 'rh', 'mag', 'ch', 'bolt']) {
      // find surrounding keys that define this channel
      let prev = null, next = null;
      for (const k of keys) { if (k[ch] === undefined) continue; if (k.t <= t) prev = k; else { next = k; break; } }
      if (!prev && !next) continue;
      if (!prev) { this.state[ch] = next[ch]; continue; }
      if (!next) { this.state[ch] = prev[ch]; continue; }
      const f = smooth((t - prev.t) / Math.max(1e-6, next.t - prev.t));
      this.state[ch] = lerpChannel(ch, prev[ch], next[ch], f);
    }
  }
}
function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
function lerpChannel(ch, a, b, f) {
  if (ch === 'ch') return a + (b - a) * f;
  if (ch === 'bolt') return { lift: a.lift + (b.lift - a.lift) * f, pull: a.pull + (b.pull - a.pull) * f };
  const out = {};
  if (a.pos && b.pos) out.pos = new THREE.Vector3().lerpVectors(a.pos, b.pos, f); else out.pos = b.pos || a.pos;
  if (a.rot && b.rot) { _q1.setFromEuler(a.rot); _q2.setFromEuler(b.rot); out.rot = new THREE.Euler().setFromQuaternion(_q1.slerp(_q2, f)); } else out.rot = b.rot || a.rot;
  if (ch === 'lh' || ch === 'rh') out.pose = f < 0.5 ? (a.pose ?? b.pose) : (b.pose ?? a.pose);
  if (ch === 'mag') out.vis = (b.vis !== undefined ? (f < 0.02 ? (a.vis ?? b.vis) : b.vis) : a.vis);
  return out;
}

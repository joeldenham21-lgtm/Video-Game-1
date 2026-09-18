// ============================================================================
// RANGE — hands.js
// Procedural gloved hands + forearms with articulated fingers.
// Canonical hand frame (right hand): wrist at the origin, fingers pointing -Z,
// palm normal -Y (palm down), thumb on the -X side. The left hand is the
// mirror image (scale.x = -1 at the wrist group).
// Finger joints are nested Groups so poses are just joint angles; poses are
// blended over time by the viewmodel.
// ============================================================================
import * as THREE from 'three';
import { mat } from './materials.js';
import { RoundedBoxGeometry } from '../vendor/addons/geometries/RoundedBoxGeometry.js';

const D = Math.PI / 180;

// finger definitions: [mcpX (lateral, +right), mcpZ (forward of the wrist), seg lengths, radius]
const FINGERS = {
  index:  { x: 0.031,  z: -0.088, len: [0.046, 0.028, 0.022], r: 0.0088 },
  middle: { x: 0.010,  z: -0.093, len: [0.050, 0.031, 0.024], r: 0.0090 },
  ring:   { x: -0.011, z: -0.090, len: [0.046, 0.029, 0.022], r: 0.0085 },
  pinky:  { x: -0.031, z: -0.082, len: [0.036, 0.022, 0.018], r: 0.0075 },
};
// thumb: base at the -X side of the palm near the wrist
const THUMB = { x: -0.034, y: -0.004, z: -0.040, len: [0.048, 0.036, 0.030], r: [0.011, 0.0095, 0.0085] };

/**
 * Poses: per finger [mcp, pip, dip, spread] degrees; thumb [abduct, flex1, flex2, flex3].
 */
export const POSES = {
  open:        { index: [5, 5, 3, 4], middle: [5, 5, 3, 0], ring: [5, 5, 3, -4], pinky: [5, 5, 3, -8], thumb: [20, 5, 5, 5] },
  relaxed:     { index: [25, 30, 15, 2], middle: [30, 35, 20, 0], ring: [32, 38, 22, -2], pinky: [35, 40, 25, -4], thumb: [30, 15, 10, 10] },
  // wrapped around a pistol/rifle grip, index straight along the frame (trigger discipline)
  gripSafe:    { index: [8, 12, 6, 6], middle: [72, 92, 62, 0], ring: [76, 96, 64, -2], pinky: [80, 100, 66, -4], thumb: [42, 34, 22, 12] },
  // index finger on the trigger
  gripFire:    { index: [48, 58, 24, 2], middle: [72, 92, 62, 0], ring: [76, 96, 64, -2], pinky: [80, 100, 66, -4], thumb: [42, 34, 22, 12] },
  // support hand C-clamp on a handguard: thumb over the top, fingers under
  cclamp:      { index: [62, 72, 42, 6], middle: [66, 76, 46, 2], ring: [68, 78, 48, -2], pinky: [70, 80, 50, -6], thumb: [70, 40, 30, 20] },
  // support hand wrapping a pistol (thumbs-forward)
  pistolSupport: { index: [64, 84, 52, 3], middle: [68, 90, 58, 0], ring: [70, 92, 60, -3], pinky: [72, 94, 62, -6], thumb: [12, 6, 4, 2] },
  // holding a magazine (index along the front of the mag)
  magGrip:     { index: [10, 14, 8, 0], middle: [64, 84, 50, 0], ring: [66, 86, 52, -2], pinky: [68, 88, 54, -4], thumb: [50, 40, 30, 15] },
  // slapping the bolt release / pressing a button with the thumb
  thumbPress:  { index: [50, 60, 35, 2], middle: [52, 62, 36, 0], ring: [54, 64, 38, -2], pinky: [56, 66, 40, -4], thumb: [55, 20, 10, 5] },
  // pinching the charging handle (index + thumb)
  pinch:       { index: [40, 60, 40, 0], middle: [60, 90, 60, 0], ring: [64, 92, 62, -2], pinky: [66, 94, 64, -4], thumb: [40, 50, 35, 25] },
  // palm flat over the bolt knob
  boltPalm:    { index: [30, 40, 20, 4], middle: [34, 44, 24, 0], ring: [36, 46, 26, -3], pinky: [38, 48, 28, -6], thumb: [35, 20, 10, 5] },
  fist:        { index: [85, 100, 70, 0], middle: [88, 104, 72, 0], ring: [90, 106, 74, -2], pinky: [92, 108, 76, -4], thumb: [55, 45, 35, 20] },
};

/**
 * Euler for a wrist group so that the fingers point along `fingers` and the palm faces `palm`
 * (both in the parent/weapon frame). Canonical hand: fingers -Z, palm -Y.
 */
export function orientHand(fingers, palm) {
  const z = new THREE.Vector3().copy(fingers).normalize().negate();           // +Z_w = opposite of fingers
  const y = new THREE.Vector3().copy(palm).normalize().negate();              // +Y_w = back of the hand
  y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();                     // orthogonalise
  const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Euler().setFromRotationMatrix(m);
}

function seg(r, len, material) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 12);
  g.rotateX(Math.PI / 2);           // capsule along Z
  g.translate(0, 0, -len / 2);      // from the joint (origin) toward -Z
  const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function knuckle(r, material) { const m = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 12, 10), material); m.castShadow = true; return m; }

export function buildHand(side = 'right', o = {}) {
  const glove = mat(o.glove || 'gloveBlack');
  const sleeve = mat('sleeve');
  const wrist = new THREE.Group(); wrist.name = side + 'Hand';
  const hand = new THREE.Group(); wrist.add(hand);
  if (side === 'left') hand.scale.x = -1;

  // palm: rounded slab, slightly thicker at the heel; a second slab angled for the thumb heel
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.082, 0.028, 0.092, 4, 0.012), glove);
  palm.position.set(0.0, 0.0, -0.046); palm.castShadow = palm.receiveShadow = true; hand.add(palm);
  const heel = new THREE.Mesh(new RoundedBoxGeometry(0.030, 0.030, 0.050, 3, 0.012), glove);
  heel.position.set(-0.030, -0.003, -0.030); heel.rotation.y = 0.35; heel.castShadow = true; hand.add(heel);
  // knuckle ridge
  const ridge = new THREE.Mesh(new RoundedBoxGeometry(0.080, 0.024, 0.024, 3, 0.011), glove);
  ridge.position.set(0, 0.002, -0.088); hand.add(ridge);
  // wrist cuff + forearm (sleeve) going back and slightly outward
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.030, 0.03, 20), glove);
  cuff.rotation.x = Math.PI / 2; cuff.scale.set(1.35, 1, 0.8); cuff.position.set(0, 0, 0.012); cuff.castShadow = true; hand.add(cuff);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.035, 0.30, 20), sleeve);
  forearm.rotation.x = Math.PI / 2; forearm.scale.set(1.25, 1, 0.85); forearm.position.set(0, 0.002, 0.155); forearm.castShadow = true; forearm.name = 'sleeve';
  const armPivot = new THREE.Group(); armPivot.add(forearm); armPivot.position.set(0, 0, 0.02); hand.add(armPivot);

  const joints = {};
  for (const [name, f] of Object.entries(FINGERS)) {
    const mcp = new THREE.Group(); mcp.position.set(f.x, 0.0, f.z); hand.add(mcp);
    mcp.add(knuckle(f.r, glove));
    mcp.add(seg(f.r, f.len[0], glove));
    const pip = new THREE.Group(); pip.position.set(0, 0, -f.len[0]); mcp.add(pip);
    pip.add(knuckle(f.r * 0.95, glove)); pip.add(seg(f.r * 0.93, f.len[1], glove));
    const dip = new THREE.Group(); dip.position.set(0, 0, -f.len[1]); pip.add(dip);
    dip.add(knuckle(f.r * 0.85, glove)); dip.add(seg(f.r * 0.82, f.len[2], glove));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(f.r * 0.8, 10, 8), glove); tip.position.set(0, 0, -f.len[2]); dip.add(tip);
    joints[name] = { mcp, pip, dip };
  }
  // thumb: CMC joint at the palm's edge, rotated so its flexion sweeps across the palm
  const cmc = new THREE.Group(); cmc.position.set(THUMB.x, THUMB.y, THUMB.z); hand.add(cmc);
  const cmcInner = new THREE.Group(); cmc.add(cmcInner);
  cmcInner.add(knuckle(THUMB.r[0], glove)); cmcInner.add(seg(THUMB.r[0], THUMB.len[0], glove));
  const tmcp = new THREE.Group(); tmcp.position.set(0, 0, -THUMB.len[0]); cmcInner.add(tmcp);
  tmcp.add(knuckle(THUMB.r[1], glove)); tmcp.add(seg(THUMB.r[1], THUMB.len[1], glove));
  const tip = new THREE.Group(); tip.position.set(0, 0, -THUMB.len[1]); tmcp.add(tip);
  tip.add(knuckle(THUMB.r[2], glove)); tip.add(seg(THUMB.r[2], THUMB.len[2], glove));
  const ttip = new THREE.Mesh(new THREE.SphereGeometry(THUMB.r[2] * 0.85, 10, 8), glove); ttip.position.set(0, 0, -THUMB.len[2]); tip.add(ttip);
  joints.thumb = { cmc, cmcInner, mcp: tmcp, ip: tip };

  const state = { current: JSON.parse(JSON.stringify(POSES.relaxed)), target: POSES.relaxed, blend: 1, speed: 8 };

  function applyPose(p) {
    for (const name of ['index', 'middle', 'ring', 'pinky']) {
      const j = joints[name], a = p[name];
      j.mcp.rotation.set(a[0] * D, a[3] * D, 0);   // curl about X (toward the palm, -Y) — positive X rotation moves -Z toward -Y ✓
      j.pip.rotation.set(a[1] * D, 0, 0);
      j.dip.rotation.set(a[2] * D, 0, 0);
    }
    const t = p.thumb;
    // abduction swings the thumb away from the palm (about Y toward -X), flexion curls it across the palm
    joints.thumb.cmc.rotation.set(0.35 + t[1] * D * 0.6, -(0.9 - t[0] * D * 0.5), -0.5);
    joints.thumb.cmcInner.rotation.set(t[1] * D * 0.6, 0, 0);
    joints.thumb.mcp.rotation.set(t[2] * D, 0, 0);
    joints.thumb.ip.rotation.set(t[3] * D, 0, 0);
  }
  applyPose(state.current);

  const api = {
    group: wrist, hand, joints, state, side, armPivot,
    setPose(name, speed = 8) { state.target = typeof name === 'string' ? POSES[name] : name; state.speed = speed; },
    snapPose(name) { state.target = typeof name === 'string' ? POSES[name] : name; state.current = JSON.parse(JSON.stringify(state.target)); applyPose(state.current); },
    /** per-finger override (e.g. trigger finger) — returns the pose object to mutate */
    update(dt) {
      const k = 1 - Math.exp(-state.speed * dt);
      const c = state.current, t = state.target;
      for (const key of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (let i = 0; i < 4; i++) c[key][i] += (t[key][i] - c[key][i]) * k;
      applyPose(c);
    },
    /** blend a single finger toward a target array (used for the trigger finger following the trigger) */
    setFinger(name, angles, k = 1) { const c = state.current[name]; for (let i = 0; i < 4; i++) c[i] += (angles[i] - c[i]) * k; applyPose(state.current); },
    setForearm(pitch, yaw) { armPivot.rotation.set(pitch, yaw, 0); },
  };
  return api;
}

// Procedural first-person weapon models + arms. Static parts are merged per material.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let MATS = null;
export function vmMaterials() {
  if (MATS) return MATS;
  MATS = {
    // gunmetal, painted polymer and cloth: kept dark so the bright planet in the
    // environment map reads as a sheen, not a wash
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.9, roughness: 0.32, envMapIntensity: 0.75 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x5c626c, metalness: 0.35, roughness: 0.46, envMapIntensity: 0.45 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141619, metalness: 0.0, roughness: 0.9, envMapIntensity: 0.3 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.05, roughness: 0.8, envMapIntensity: 0.3 }),
    armor: new THREE.MeshStandardMaterial({ color: 0x5d636d, metalness: 0.55, roughness: 0.4, envMapIntensity: 0.5 }),
  };
  return MATS;
}

function accentMat(color, intensity = 1.8) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
}

// Collects geometry per material, then merges
class Kit {
  constructor() { this.parts = new Map(); this.group = new THREE.Group(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  box(w, h, d, mat, x, y, z, rx, ry, rz, r = 0.008) { return this.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)), mat, x, y, z, rx, ry, rz); }
  cyl(r0, r1, len, mat, x, y, z, rx = Math.PI / 2, ry = 0, rz = 0, seg = 14) { return this.add(new THREE.CylinderGeometry(r0, r1, len, seg), mat, x, y, z, rx, ry, rz); }
  torus(R, r, mat, x, y, z, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.TorusGeometry(R, r, 6, 20), mat, x, y, z, rx, ry, rz); }
  build() {
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    return this.group;
  }
}

// Canvas-texture ammo readout mounted on the weapon
export function makeReadout(color = '#7fe6ff') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, color: new THREE.Color(1.15, 1.15, 1.15) });
  let last = '';
  return {
    mat,
    set(text, low = false) {
      const key = text + low;
      if (key === last) return;
      last = key;
      x.clearRect(0, 0, 128, 64);
      x.fillStyle = 'rgba(0,10,16,0.75)'; x.fillRect(0, 0, 128, 64);
      x.font = 'bold 44px ui-monospace, Menlo, monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = low ? '#ff5a6e' : color;
      x.fillText(text, 64, 35);
      tex.needsUpdate = true;
    },
  };
}

function glove(kit, M, side = 1) {
  // right glove wrapped around a grip at origin; side=-1 mirrors for the left hand
  kit.box(0.075, 0.085, 0.1, M.glove, 0, 0, 0, 0, 0, 0, 0.02);
  kit.box(0.08, 0.03, 0.07, M.armor, 0.005 * side, 0.05, 0.005, 0.1, 0, 0, 0.01);
  kit.box(0.025, 0.06, 0.08, M.glove, -0.045 * side, -0.005, -0.005, 0, 0, 0.2 * side, 0.01); // thumb
  // forearm heading back and down out of view
  kit.cyl(0.042, 0.05, 0.36, M.glove, 0.03 * side, -0.07, 0.19, Math.PI / 2 - 0.45, 0, 0);
  kit.box(0.09, 0.05, 0.2, M.armor, 0.03 * side, -0.035, 0.2, -0.45, 0, 0, 0.012);
}

export function buildCarbine() {
  const M = vmMaterials();
  const acc = accentMat(0x7fe6ff, 2.1);
  const k = new Kit();
  k.box(0.085, 0.1, 0.34, M.metal, 0, 0, 0);
  k.box(0.09, 0.05, 0.3, M.panel, 0, 0.045, -0.02);
  k.box(0.078, 0.085, 0.26, M.panel, 0, 0.0, -0.3);
  k.box(0.05, 0.05, 0.22, M.metal, 0, -0.03, -0.31);
  k.cyl(0.018, 0.018, 0.16, M.metal, 0, 0.015, -0.5);
  k.cyl(0.026, 0.026, 0.05, M.metal, 0, 0.015, -0.585);
  for (let i = 0; i < 3; i++) k.torus(0.046, 0.0045, i === 1 ? acc : M.metal, 0, 0.005, -0.23 - i * 0.055);
  // thin light-pipes down both flanks (a full-width top slab read as a glowing brick in first person)
  for (const sx of [-1, 1]) k.box(0.004, 0.008, 0.2, acc, sx * 0.045, 0.06, -0.03, 0, 0, 0, 0.002);
  // sight
  k.box(0.05, 0.045, 0.06, M.metal, 0, 0.1, 0.02);
  k.box(0.006, 0.03, 0.006, acc, 0, 0.128, -0.005);
  // grip + stock
  k.box(0.045, 0.12, 0.06, M.rubber, 0, -0.1, 0.12, -0.25, 0, 0);
  k.box(0.055, 0.075, 0.2, M.metal, 0, -0.01, 0.26);
  k.box(0.058, 0.03, 0.12, M.panel, 0, 0.03, 0.27);
  const group = k.build();
  // magazine (animated during reload)
  const mk = new Kit();
  mk.box(0.048, 0.14, 0.07, M.metal, 0, -0.07, 0, 0.15, 0, 0);
  mk.box(0.05, 0.1, 0.012, acc, 0, -0.06, -0.034, 0.15, 0, 0, 0.003);
  const mag = mk.build();
  mag.position.set(0, -0.05, -0.06);
  group.add(mag);
  // hands
  const hands = new Kit();
  glove(hands, M, 1);
  const right = hands.build(); right.position.set(0, -0.1, 0.12); right.rotation.x = -0.25; group.add(right);
  const lk = new Kit();
  lk.box(0.075, 0.075, 0.12, M.glove, 0, 0, 0, 0, 0, 0, 0.02);
  lk.box(0.08, 0.028, 0.08, M.armor, 0, 0.045, 0, 0, 0, 0, 0.01);
  lk.cyl(0.04, 0.05, 0.4, M.glove, -0.1, -0.07, 0.14, Math.PI / 2 - 0.35, 0.5, 0);
  const left = lk.build(); left.position.set(-0.035, -0.06, -0.3); left.rotation.set(0, 0.3, 0.4); group.add(left);
  const readout = makeReadout('#7fe6ff');
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025), readout.mat);
  scr.position.set(0, 0.1, 0.051); group.add(scr);
  return { group, mag, readout, muzzle: new THREE.Vector3(0, 0.015, -0.62), accent: acc, color: 0x7fe6ff, rest: new THREE.Vector3(0.2, -0.19, -0.5), sightY: 0.118 };
}

export function buildScatter() {
  const M = vmMaterials();
  const acc = accentMat(0xffa24a, 2.1);
  const k = new Kit();
  k.box(0.11, 0.12, 0.3, M.metal, 0, 0, 0, 0, 0, 0, 0.015);
  k.box(0.115, 0.05, 0.24, M.panel, 0, 0.06, 0.0, 0, 0, 0, 0.012);
  k.cyl(0.03, 0.03, 0.4, M.metal, 0.026, 0.02, -0.32);
  k.cyl(0.03, 0.03, 0.4, M.metal, -0.026, 0.02, -0.32);
  k.box(0.12, 0.035, 0.12, M.panel, 0, 0.05, -0.36, 0, 0, 0, 0.01);
  k.torus(0.034, 0.006, acc, 0.026, 0.02, -0.52);
  k.torus(0.034, 0.006, acc, -0.026, 0.02, -0.52);
  for (let i = 0; i < 4; i++) k.cyl(0.011, 0.011, 0.045, acc, 0.062, -0.01 - i * 0.0, 0.07 - i * 0.05, 0, 0, Math.PI / 2, 8);
  k.box(0.05, 0.13, 0.065, M.rubber, 0, -0.1, 0.1, -0.3, 0, 0);
  k.box(0.07, 0.09, 0.2, M.metal, 0, -0.02, 0.24, 0, 0, 0, 0.012);
  k.box(0.04, 0.03, 0.04, M.metal, 0, 0.1, 0.05);
  k.box(0.008, 0.02, 0.008, acc, 0, 0.12, 0.05);
  const group = k.build();
  const pk = new Kit();
  pk.box(0.1, 0.065, 0.16, M.rubber, 0, 0, 0, 0, 0, 0, 0.015);
  for (const sx of [-1, 1]) pk.box(0.004, 0.009, 0.12, acc, sx * 0.05, 0.03, 0, 0, 0, 0, 0.002);
  const lk = new Kit();
  lk.box(0.08, 0.075, 0.11, M.glove, 0, -0.06, 0, 0, 0, 0, 0.02);
  lk.cyl(0.04, 0.05, 0.4, M.glove, -0.1, -0.11, 0.14, Math.PI / 2 - 0.35, 0.5, 0);
  const pump = pk.build();
  const leftHand = lk.build();
  pump.add(leftHand);
  pump.position.set(0, -0.035, -0.3);
  group.add(pump);
  const hands = new Kit();
  glove(hands, M, 1);
  const right = hands.build(); right.position.set(0, -0.1, 0.1); right.rotation.x = -0.3; group.add(right);
  const readout = makeReadout('#ffb070');
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025), readout.mat);
  scr.position.set(0, 0.09, 0.151); group.add(scr);
  return { group, pump, readout, muzzle: new THREE.Vector3(0, 0.02, -0.54), accent: acc, color: 0xffa24a, rest: new THREE.Vector3(0.2, -0.19, -0.46), sightY: 0.12 };
}

export function buildLance() {
  const M = vmMaterials();
  const acc = accentMat(0xc6a0ff, 2.3);
  const k = new Kit();
  k.box(0.08, 0.1, 0.38, M.metal, 0, 0, 0.02, 0, 0, 0, 0.012);
  k.box(0.085, 0.045, 0.3, M.panel, 0, 0.05, 0.04, 0, 0, 0, 0.01);
  // twin rails
  k.box(0.022, 0.035, 0.56, M.metal, 0.03, 0.01, -0.42, 0, 0, 0, 0.006);
  k.box(0.022, 0.035, 0.56, M.metal, -0.03, 0.01, -0.42, 0, 0, 0, 0.006);
  k.box(0.006, 0.02, 0.5, acc, 0.017, 0.01, -0.42, 0, 0, 0, 0.002);
  k.box(0.006, 0.02, 0.5, acc, -0.017, 0.01, -0.42, 0, 0, 0, 0.002);
  k.box(0.09, 0.03, 0.03, M.panel, 0, 0.035, -0.28, 0, 0, 0, 0.008);
  k.box(0.09, 0.03, 0.03, M.panel, 0, 0.035, -0.5, 0, 0, 0, 0.008);
  // capacitors
  k.cyl(0.02, 0.02, 0.1, acc, 0.05, -0.03, -0.05, Math.PI / 2, 0, 0, 10);
  k.cyl(0.02, 0.02, 0.1, acc, -0.05, -0.03, -0.05, Math.PI / 2, 0, 0, 10);
  // scope
  k.cyl(0.024, 0.028, 0.16, M.metal, 0, 0.1, 0.02);
  k.cyl(0.02, 0.02, 0.005, acc, 0, 0.1, -0.061);
  k.box(0.045, 0.12, 0.06, M.rubber, 0, -0.1, 0.13, -0.25, 0, 0);
  k.box(0.055, 0.08, 0.22, M.metal, 0, -0.01, 0.3, 0, 0, 0, 0.012);
  const group = k.build();
  // charge core between rails (scaled by charge)
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.5), accentMat(0xe8d8ff, 3.2));
  core.position.set(0, 0.01, -0.42); group.add(core);
  const hands = new Kit();
  glove(hands, M, 1);
  const right = hands.build(); right.position.set(0, -0.1, 0.13); right.rotation.x = -0.25; group.add(right);
  const lk = new Kit();
  lk.box(0.075, 0.075, 0.12, M.glove, 0, 0, 0, 0, 0, 0, 0.02);
  lk.cyl(0.04, 0.05, 0.4, M.glove, -0.1, -0.07, 0.14, Math.PI / 2 - 0.35, 0.5, 0);
  const left = lk.build(); left.position.set(-0.03, -0.055, -0.22); left.rotation.set(0, 0.3, 0.4); group.add(left);
  const readout = makeReadout('#d8c0ff');
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.022), readout.mat);
  scr.position.set(0, 0.1, 0.101); group.add(scr);
  return { group, core, readout, muzzle: new THREE.Vector3(0, 0.01, -0.72), accent: acc, color: 0xc6a0ff, rest: new THREE.Vector3(0.19, -0.185, -0.55), sightY: 0.1 };
}

export function buildNova() {
  const M = vmMaterials();
  const acc = accentMat(0x6dff9a, 2);
  const k = new Kit();
  k.box(0.1, 0.11, 0.3, M.metal, 0, 0, 0.05, 0, 0, 0, 0.015);
  k.cyl(0.05, 0.055, 0.3, M.panel, 0, 0.015, -0.28);
  k.cyl(0.058, 0.058, 0.04, M.metal, 0, 0.015, -0.44);
  k.torus(0.056, 0.008, acc, 0, 0.015, -0.4);
  k.box(0.045, 0.13, 0.065, M.rubber, 0, -0.1, 0.13, -0.28, 0, 0);
  k.box(0.07, 0.09, 0.16, M.metal, 0, -0.01, 0.26, 0, 0, 0, 0.012);
  k.box(0.035, 0.035, 0.08, M.metal, 0, 0.085, 0.0);
  const group = k.build();
  const dk = new Kit();
  dk.cyl(0.085, 0.085, 0.16, M.metal, 0, 0, 0, Math.PI / 2, 0, 0, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    dk.cyl(0.022, 0.022, 0.165, acc, Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0, Math.PI / 2, 0, 0, 8);
  }
  const drum = dk.build();
  drum.position.set(0, -0.02, -0.08);
  group.add(drum);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), accentMat(0x9dffbe, 3.2));
  orb.position.set(0, 0.015, -0.42); group.add(orb);
  const hands = new Kit();
  glove(hands, M, 1);
  const right = hands.build(); right.position.set(0, -0.1, 0.13); right.rotation.x = -0.28; group.add(right);
  const lk = new Kit();
  lk.box(0.08, 0.075, 0.11, M.glove, 0, 0, 0, 0, 0, 0, 0.02);
  lk.cyl(0.04, 0.05, 0.4, M.glove, -0.1, -0.07, 0.14, Math.PI / 2 - 0.35, 0.5, 0);
  const left = lk.build(); left.position.set(-0.02, -0.1, -0.25); left.rotation.set(0.2, 0.3, 0.5); group.add(left);
  const readout = makeReadout('#9dffbe');
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.018), readout.mat);
  scr.position.set(0, 0.085, 0.041); group.add(scr);
  return { group, drum, orb, readout, muzzle: new THREE.Vector3(0, 0.015, -0.47), accent: acc, color: 0x6dff9a, rest: new THREE.Vector3(0.2, -0.19, -0.46), sightY: 0.1 };
}

// Kinetic gauntlet for melee (left arm)
export function buildFist() {
  const M = vmMaterials();
  const k = new Kit();
  k.box(0.1, 0.095, 0.11, M.glove, 0, 0, 0, 0, 0, 0, 0.025);
  k.box(0.105, 0.04, 0.09, M.armor, 0, 0.045, 0.005, 0, 0, 0, 0.012);
  k.box(0.1, 0.03, 0.03, M.armor, 0, 0.0, -0.06, 0, 0, 0, 0.01);
  k.cyl(0.05, 0.058, 0.42, M.glove, 0, -0.01, 0.25, Math.PI / 2, 0, 0);
  k.box(0.11, 0.06, 0.26, M.armor, 0, 0.03, 0.22, 0, 0, 0, 0.015);
  const acc = accentMat(0x7fe6ff, 2.5);
  for (const sx of [-1, 1]) k.box(0.004, 0.009, 0.2, acc, sx * 0.055, 0.055, 0.22, 0, 0, 0, 0.002);
  k.torus(0.06, 0.008, acc, 0, -0.005, 0.07);
  const group = k.build();
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe6ff).multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.position.z = -0.07;
  group.add(glow);
  return { group, glow };
}

// Muzzle flash sprite (additive star)
export function buildFlash() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.globalCompositeOperation = 'lighter';
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 3;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4 + 0.3; x.beginPath(); x.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30); x.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); x.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mat);
  mesh.frustumCulled = false;
  return mesh;
}

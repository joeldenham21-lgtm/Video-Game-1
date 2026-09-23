// Choir constructs: porcelain shells, ice-glow seams, hot cores (always the weak point).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G, fxLayer } from '../state.js';

let S = null;
function shared() {
  if (S) return S;
  const physical = !!G.renderer?.q?.physical;
  // glazed porcelain: a clear lacquer coat over a soft diffuse body
  const porcelain = physical
    ? new THREE.MeshPhysicalMaterial({ color: 0xc4c7cc, roughness: 0.5, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 0.9, sheen: 0.12, sheenColor: new THREE.Color(0xdfe8ff), sheenRoughness: 0.6 })
    : new THREE.MeshStandardMaterial({ color: 0xc2c6cc, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.95 });
  S = {
    porcelain,
    inner: new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.0 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(1.45), toneMapped: false }),
    glowElite: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc857).multiplyScalar(2.0), toneMapped: false }),
    core: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a2a).multiplyScalar(2.8), toneMapped: false }),
    geo: {
      miteBody: new THREE.OctahedronGeometry(0.32, 0).scale(1, 0.7, 1.55),
      fin: new THREE.BoxGeometry(0.025, 0.3, 0.34),
      coreS: new THREE.SphereGeometry(0.11, 16, 12),
      coreM: new THREE.SphereGeometry(0.2, 20, 14),
      coreL: new THREE.SphereGeometry(0.36, 24, 16),
      band: new THREE.TorusGeometry(0.27, 0.018, 8, 28),
      ico: new THREE.IcosahedronGeometry(0.52, physical ? 3 : 1),
      petal: new RoundedBoxGeometry(0.46, 0.46, 0.1, 3, 0.04),
      halo: new THREE.TorusGeometry(0.88, 0.03, 8, 64),
      crystal: new THREE.OctahedronGeometry(0.5, 0).scale(0.62, 2.4, 0.62),
      seam: new THREE.BoxGeometry(0.03, 2.2, 0.03),
      shard: new THREE.OctahedronGeometry(0.14, 0).scale(0.6, 1.6, 0.6),
      bruteBody: new RoundedBoxGeometry(2.0, 1.25, 2.1, 3, 0.18),
      bruteShield: new RoundedBoxGeometry(2.4, 1.7, 0.26, 2, 0.08),
      shieldEdge: new THREE.BoxGeometry(2.3, 0.05, 0.05),
      spike: new THREE.ConeGeometry(0.16, 0.7, 5),
      pod: new THREE.CylinderGeometry(0.22, 0.28, 0.9, 10),
      ring: new THREE.TorusGeometry(0.8, 0.13, 8, 28),
      plate: new RoundedBoxGeometry(0.5, 0.18, 0.34, 2, 0.04),
      bubble: new THREE.IcosahedronGeometry(1, 2),
    },
  };
  return S;
}

// Only large shell pieces cast shadows (keeps the shadow pass cheap on phones)
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.setScalar(s);
  m.castShadow = false;
  return m;
}
const caster = (m) => { m.castShadow = true; return m; };

// Every model returns { root, shellMat, coreMat, parts{} }
function base(elite) {
  const s = shared();
  const shellMat = s.porcelain.clone();
  shellMat.emissive = new THREE.Color(0x000000);
  const coreMat = s.core.clone();
  return { s, shellMat, coreMat, glow: elite ? s.glowElite : s.glow };
}

export function buildMite(elite) {
  const { s, shellMat, coreMat, glow } = base(elite);
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  spin.add(caster(mesh(s.geo.miteBody, shellMat)));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const f = mesh(s.geo.fin, s.inner, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.22, 0, 0, a + Math.PI / 2);
    f.castShadow = false;
    spin.add(f);
  }
  spin.add(mesh(s.geo.band, glow, 0, 0, 0.05));
  const core = mesh(s.geo.coreS, coreMat, 0, 0, -0.42, 0, 0, 0, 1.45);
  spin.add(core);
  return { root, shellMat, coreMat, parts: { spin, core } };
}

export function buildSentinel(elite) {
  const { s, shellMat, coreMat, glow } = base(elite);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(caster(mesh(s.geo.ico, s.inner, 0, 0, 0, 0, 0, 0, 1.25)));
  const petals = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const a = (i / 6) * Math.PI * 2;
    g.rotation.z = a;
    const p = mesh(s.geo.petal, shellMat, 0, 0.42, 0.08, -0.35, 0, 0);
    g.add(p);
    body.add(g);
    petals.push(p);
  }
  // back plate
  body.add(mesh(s.geo.ico, shellMat, 0, 0, 0.18, 0, 0, 0, 0.85));
  const eye = mesh(s.geo.coreM, coreMat, 0, 0, -0.46);
  body.add(eye);
  const halo = mesh(s.geo.halo, glow);
  halo.castShadow = false;
  root.add(halo);
  return { root, shellMat, coreMat, parts: { body, petals, eye, halo } };
}

export function buildLancer(elite) {
  const { s, shellMat, coreMat, glow } = base(elite);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(caster(mesh(s.geo.crystal, shellMat)));
  const seam1 = mesh(s.geo.seam, glow, 0, 0, -0.3); seam1.castShadow = false; body.add(seam1);
  const seam2 = mesh(s.geo.seam, glow, 0, 0, 0.3); seam2.castShadow = false; body.add(seam2);
  const core = mesh(s.geo.coreM, coreMat, 0, 0.1, -0.24, 0, 0, 0, 0.9);
  body.add(core);
  const tip = mesh(s.geo.coreS, coreMat, 0, 1.25, 0);
  body.add(tip);
  const orbit = new THREE.Group();
  for (let i = 0; i < 2; i++) orbit.add(mesh(s.geo.shard, shellMat, Math.cos(i * Math.PI) * 0.75, 0, Math.sin(i * Math.PI) * 0.75));
  root.add(orbit);
  return { root, shellMat, coreMat, parts: { body, core, tip, orbit } };
}

export function buildBrute(elite) {
  const { s, shellMat, coreMat, glow } = base(elite);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(caster(mesh(s.geo.bruteBody, shellMat)));
  body.add(mesh(s.geo.bruteBody, s.inner, 0, -0.35, 0, 0, 0, 0, 0.82));
  const shield = new THREE.Group();
  shield.position.set(0, 0.05, -1.2);
  shield.add(mesh(s.geo.bruteShield, s.inner));
  const e1 = mesh(s.geo.shieldEdge, glow, 0, 0.83, -0.12); e1.castShadow = false; shield.add(e1);
  const e2 = mesh(s.geo.shieldEdge, glow, 0, -0.83, -0.12); e2.castShadow = false; shield.add(e2);
  // visor slits
  for (let i = -1; i <= 1; i++) { const v = mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), glow, i * 0.55, 0.35, -0.14); v.castShadow = false; shield.add(v); }
  body.add(shield);
  for (let i = -1; i <= 1; i++) body.add(mesh(s.geo.spike, shellMat, i * 0.55, 0.85, 0.2 + Math.abs(i) * 0.15, -0.35, 0, i * 0.3));
  const podL = mesh(s.geo.pod, s.inner, 1.15, -0.2, 0.3, Math.PI / 2, 0, 0);
  const podR = mesh(s.geo.pod, s.inner, -1.15, -0.2, 0.3, Math.PI / 2, 0, 0);
  body.add(podL, podR);
  const jetL = mesh(s.geo.coreS, glow, 1.15, -0.2, 0.78, 0, 0, 0, 1.5); jetL.castShadow = false;
  const jetR = mesh(s.geo.coreS, glow, -1.15, -0.2, 0.78, 0, 0, 0, 1.5); jetR.castShadow = false;
  body.add(jetL, jetR);
  const core = mesh(s.geo.coreL, coreMat, 0, 0.15, 1.08);
  body.add(core);
  return { root, shellMat, coreMat, parts: { body, shield, core, jets: [jetL, jetR] } };
}

export function buildWarden(elite) {
  const { s, shellMat, coreMat, glow } = base(elite);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const ring = caster(mesh(s.geo.ring, shellMat, 0, 0, 0, Math.PI / 2, 0, 0));
  body.add(ring);
  const inner = mesh(s.geo.halo, glow, 0, 0, 0, Math.PI / 2, 0, 0, 0.72); inner.castShadow = false;
  body.add(inner);
  const core = mesh(s.geo.coreM, coreMat, 0, 0, 0, 0, 0, 0, 1.25);
  body.add(core);
  const plates = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    plates.add(mesh(s.geo.plate, shellMat, Math.cos(a) * 1.25, 0.1, Math.sin(a) * 1.25, 0, -a, 0));
  }
  root.add(plates);
  return { root, shellMat, coreMat, parts: { body, core, plates, inner } };
}

// Protective bubble cast by wardens
const BUBBLE_VERT = `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const BUBBLE_FRAG = `uniform vec3 uColor; uniform float uHit; uniform float uTime; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); float hex = 0.5 + 0.5 * sin(vN.x * 30.0 + uTime * 2.0) * sin(vN.y * 30.0) * sin(vN.z * 30.0);
  float a = f * (0.6 + 0.4 * hex) + uHit * 0.35; gl_FragColor = vec4(uColor * a, 0.0); }`;
export function buildBubble() {
  const s = shared();
  const mat = new THREE.ShaderMaterial({
    vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG,
    uniforms: { uColor: { value: new THREE.Color(0x7fd8ff).multiplyScalar(2) }, uHit: { value: 0 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const m = new THREE.Mesh(s.geo.bubble, mat);
  m.renderOrder = 15;
  fxLayer(m);
  return m;
}

export function enemyMaterials() { return shared(); }

// Free GPU buffers of everything a model owns (per-instance clones and one-off geometry), keep shared assets
export function disposeModel(root) {
  const s = shared();
  const sharedGeo = new Set(Object.values(s.geo));
  const sharedMat = new Set([s.porcelain, s.inner, s.glow, s.glowElite, s.core]);
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && !sharedMat.has(m)) m.dispose();
  });
}

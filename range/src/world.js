// ============================================================================
// RANGE — world.js
// The shooting range: covered firing line at z≈0, open KD range to 600 m
// downrange (-Z), soil berms, overhead baffles, benches, distance boards and
// wind flags. Sky + sun + PMREM environment for the PBR materials.
// Also registers the static physics colliders (with hit materials).
// ============================================================================
import * as THREE from 'three';
import { Sky } from '../vendor/addons/objects/Sky.js';
import { mat, getTex } from './materials.js';

export const RANGE = { width: 26, length: 620, lines: [10, 25, 50, 100, 200, 300, 400, 500, 600], roofZ0: 8, roofZ1: -2, eyeHeight: 1.65 };

function textBoard(text, w, h, o = {}) {
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = o.bg || '#f2f0e6'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
  ctx.fillStyle = o.fg || '#111'; ctx.font = `bold ${o.size || 120}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** wedge berm geometry (triangular prism) along X: base width bw (z), height h, length len (x) */
function bermGeometry(len, bw, h) {
  const g = new THREE.BufferGeometry();
  const x0 = -len / 2, x1 = len / 2;
  const v = [
    // front slope
    x0, 0, bw / 2, x1, 0, bw / 2, x1, h, 0, x0, 0, bw / 2, x1, h, 0, x0, h, 0,
    // back slope
    x0, h, 0, x1, h, 0, x1, 0, -bw / 2, x0, h, 0, x1, 0, -bw / 2, x0, 0, -bw / 2,
    // ends
    x0, 0, bw / 2, x0, h, 0, x0, 0, -bw / 2, x1, 0, bw / 2, x1, 0, -bw / 2, x1, h, 0,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const uv = []; for (let i = 0; i < v.length / 3; i++) uv.push(v[i * 3] / 4, (v[i * 3 + 1] + v[i * 3 + 2]) / 4);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function buildWorld(scene, physics, renderer) {
  const W = RANGE;
  const group = new THREE.Group(); group.name = 'range'; scene.add(group);
  const hits = {
    ground: { material: 'gravel', thickness: 5, name: 'ground' },
    soil: { material: 'soil', thickness: 8, name: 'berm' },
    concrete: { material: 'concrete', thickness: 0.3, name: 'concrete' },
    plywood: { material: 'plywood', thickness: 0.018, name: 'plywood' },
    lumber: { material: 'pine', thickness: 0.09, name: 'timber' },
    steel: { material: 'steel', thickness: 0.004, name: 'steel sheet' },
    post: { material: 'steel', thickness: 0.006, name: 'steel post' },
  };

  // ---------------------------------------------------------------- sky, sun, environment
  const sky = new Sky(); sky.scale.setScalar(2800); scene.add(sky);
  const su = sky.material.uniforms; su.turbidity.value = 2.5; su.rayleigh.value = 2.4; su.mieCoefficient.value = 0.003; su.mieDirectionalG.value = 0.8;
  const sunEl = 42 * Math.PI / 180, sunAz = 150 * Math.PI / 180; // sun behind-left of the shooter
  const sunDir = new THREE.Vector3(Math.cos(sunEl) * Math.sin(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.cos(sunAz)).normalize();
  su.sunPosition.value.copy(sunDir);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(60); sky2.material.uniforms.turbidity.value = 2.5; sky2.material.uniforms.rayleigh.value = 2.4; sky2.material.uniforms.mieCoefficient.value = 0.003; sky2.material.uniforms.sunPosition.value.copy(sunDir); envScene.add(sky2);
  const groundEnv = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0xa39a80 })); groundEnv.rotation.x = -Math.PI / 2; groundEnv.position.y = -1; envScene.add(groundEnv);
  const envTex = pmrem.fromScene(envScene, 0.02, 0.1, 150).texture;
  scene.environment = envTex;
  scene.fog = new THREE.FogExp2(0xc7d3e0, 0.00045);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.position.copy(sunDir).multiplyScalar(60); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2;
  sun.target.position.set(0, 0, -6); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd4ee, 0x8a8268, 0.75); scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  // ---------------------------------------------------------------- ground
  const grass = mat('grass'); grass.map.repeat.set(180, 480);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 3200, 1, 1), grass);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.01, -1400); ground.receiveShadow = true; group.add(ground);
  // gravel lane strip down the middle of the range
  const gravel = mat('soil', {}); const gravelMesh = new THREE.Mesh(new THREE.PlaneGeometry(W.width + 4, W.length + 20), gravel);
  gravel.map = getTex('soilC').clone(); gravel.map.repeat.set(8, 200); gravel.map.needsUpdate = true; gravel.normalMap = getTex('soilN').clone(); gravel.normalMap.repeat.set(8, 200); gravel.normalMap.needsUpdate = true;
  gravelMesh.rotation.x = -Math.PI / 2; gravelMesh.position.set(0, 0.0, -W.length / 2 + 6); gravelMesh.receiveShadow = true; group.add(gravelMesh);
  physics.addStaticBox([0, -2.5, -1400], [600, 2.5, 1600], hits.ground);

  // ---------------------------------------------------------------- firing line: concrete pad, roof, posts, benches, dividers
  const conc = mat('concrete'); conc.map.repeat.set(8, 3); conc.normalMap.repeat.set(8, 3);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(W.width + 4, 0.2, 11), conc);
  pad.position.set(0, 0.1, 2.5); pad.receiveShadow = true; pad.castShadow = true; group.add(pad);
  physics.addStaticBox([0, 0.1, 2.5], [(W.width + 4) / 2, 0.1, 5.5], hits.concrete);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W.width + 6, 0.06, W.roofZ0 - W.roofZ1), mat('roofSteel'));
  roof.position.set(0, 3.4, (W.roofZ0 + W.roofZ1) / 2); roof.castShadow = true; roof.receiveShadow = true; group.add(roof);
  physics.addStaticBox([0, 3.4, (W.roofZ0 + W.roofZ1) / 2], [(W.width + 6) / 2, 0.03, (W.roofZ0 - W.roofZ1) / 2], hits.steel);
  const postMat = mat('galvanized');
  for (let x = -W.width / 2 - 2; x <= W.width / 2 + 2.01; x += 4.66) for (const z of [W.roofZ1 + 0.3, W.roofZ0 - 0.3]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.4, 0.16), postMat); p.position.set(x, 1.9, z); p.castShadow = true; group.add(p);
    physics.addStaticBox([x, 1.9, z], [0.08, 1.7, 0.08], hits.post);
  }
  // rear wall (open front): plywood wall at the back of the line
  const ply = mat('plywood'); ply.map = getTex('plywoodC').clone(); ply.map.repeat.set(3, 1.5); ply.map.needsUpdate = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(W.width + 6, 3.2, 0.1), ply); back.position.set(0, 1.8, W.roofZ0); back.castShadow = back.receiveShadow = true; group.add(back);
  physics.addStaticBox([0, 1.8, W.roofZ0], [(W.width + 6) / 2, 1.6, 0.05], hits.plywood);
  // benches (one per lane) + lane dividers
  const lanes = [-10, -6, -2, 2, 6, 10];
  for (const x of lanes) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.9), mat('lumber')); top.position.set(x, 0.92, 2.6); top.castShadow = top.receiveShadow = true; group.add(top);
    for (const dx of [-0.6, 0.6]) for (const dz of [-0.35, 0.35]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), postMat); leg.position.set(x + dx, 0.45, 2.6 + dz); leg.castShadow = true; group.add(leg); }
    physics.addStaticBox([x, 0.92, 2.6], [0.7, 0.03, 0.45], hits.lumber);
    physics.addStaticBox([x, 0.45, 2.6], [0.66, 0.45, 0.41], hits.lumber);
    const lane = textBoard(String(lanes.indexOf(x) + 1), 0.4, 0.4, { size: 160, bg: '#e8c23a' }); lane.position.set(x, 3.0, W.roofZ1 + 0.4); lane.rotation.y = 0; group.add(lane);
  }
  for (const x of [-8, -4, 0, 4, 8]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.9, 2.2), mat('plywood')); d.position.set(x, 1.0, 1.3); d.castShadow = d.receiveShadow = true; group.add(d);
    physics.addStaticBox([x, 1.0, 1.3], [0.02, 0.95, 1.1], hits.plywood);
  }
  // overhead baffles (angled boards) at -6, -14, -26 m
  for (const [z, y] of [[-6, 3.6], [-14, 4.4], [-26, 5.4]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(W.width + 6, 0.12, 2.4), mat('plywood')); b.position.set(0, y, z); b.rotation.x = 0.55; b.castShadow = b.receiveShadow = true; group.add(b);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0));
    physics.addStaticBox([0, y, z], [(W.width + 6) / 2, 0.06, 1.2], { material: 'plywood', thickness: 0.12, name: 'baffle' }, q);
    for (const x of [-W.width / 2 - 1, 0, W.width / 2 + 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, y + 0.6, 0.14), postMat); p.position.set(x, (y + 0.6) / 2, z + 0.9); p.castShadow = true; group.add(p); physics.addStaticBox([x, (y + 0.6) / 2, z + 0.9], [0.07, (y + 0.6) / 2, 0.07], hits.post); }
  }

  // ---------------------------------------------------------------- berms
  const soil = mat('soil'); soil.map.repeat.set(30, 4); soil.normalMap.repeat.set(30, 4);
  const endBerm = new THREE.Mesh(bermGeometry(W.width + 50, 26, 11), soil); endBerm.position.set(0, 0, -W.length - 8); endBerm.receiveShadow = true; endBerm.castShadow = true; group.add(endBerm);
  { const g = endBerm.geometry.clone(); g.applyMatrix4(endBerm.matrix.identity().compose(endBerm.position, endBerm.quaternion, endBerm.scale)); physics.addStaticMesh(g, hits.soil); }
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(bermGeometry(W.length + 20, 9, 4.5), soil); side.rotation.y = Math.PI / 2; side.position.set(sx * (W.width / 2 + 8), 0, -W.length / 2 + 4); side.receiveShadow = true; side.castShadow = true; group.add(side);
    const g = side.geometry.clone(); side.updateMatrix(); g.applyMatrix4(side.matrix); physics.addStaticMesh(g, hits.soil);
  }
  // small intermediate impact berm behind the 25/50 m lines (typical bay layout)
  const midBerm = new THREE.Mesh(bermGeometry(W.width - 2, 6, 2.2), soil); midBerm.position.set(0, 0, -60); midBerm.receiveShadow = true; midBerm.castShadow = true; group.add(midBerm);
  { const g = midBerm.geometry.clone(); midBerm.updateMatrix(); g.applyMatrix4(midBerm.matrix); physics.addStaticMesh(g, hits.soil); }

  // ---------------------------------------------------------------- distance boards
  for (const d of W.lines) {
    const b = textBoard(`${d} m`, 1.2, 0.6, { size: 110 }); b.position.set(-W.width / 2 + 0.6, 1.4, -d + 0.6); b.rotation.y = 0.35; group.add(b);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), postMat); p.position.set(-W.width / 2 + 0.6, 0.6, -d + 0.6); group.add(p);
  }

  // ---------------------------------------------------------------- wind flags (animated in update)
  const flags = [];
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xe0432a, side: THREE.DoubleSide, roughness: 0.9 });
  for (const d of [100, 300, 500]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 4, 8), postMat); pole.position.set(W.width / 2 + 1.5, 2, -d); pole.castShadow = true; group.add(pole);
    const geo = new THREE.PlaneGeometry(1.2, 0.5, 16, 4); geo.translate(0.6, 0, 0);
    const flag = new THREE.Mesh(geo, flagMat); flag.position.set(W.width / 2 + 1.5, 3.7, -d); flag.castShadow = true; group.add(flag);
    flags.push({ mesh: flag, base: geo.attributes.position.array.slice() });
  }

  const api = {
    group, sun, hemi, sky, envTex, sunDir, flags,
    /** animate flags from the wind vector (world space) */
    update(t, wind) {
      const speed = Math.hypot(wind[0], wind[2]);
      const ang = Math.atan2(-wind[0], -wind[2]); // direction the flag streams toward = downwind
      for (const f of flags) {
        f.mesh.rotation.y = ang + Math.PI / 2;
        const p = f.mesh.geometry.attributes.position; const b = f.base;
        const droop = Math.max(0, 1 - speed / 6);
        for (let i = 0; i < p.count; i++) {
          const x = b[i * 3], y = b[i * 3 + 1];
          const wave = Math.sin(x * 6 - t * (4 + speed * 1.5)) * 0.08 * x * Math.min(1, speed / 3);
          p.setXYZ(i, x * (1 - droop * 0.35 * x), y - droop * 0.55 * x * x + wave * 0.3, wave);
        }
        p.needsUpdate = true; f.mesh.geometry.computeVertexNormals();
      }
    },
  };
  return api;
}

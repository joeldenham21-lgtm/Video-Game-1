// ============================================================================
// RANGE — targets.js
// Paper targets (cardboard on timber frames; bullets punch through and keep
// going), AR500 steel gongs on hinges (react with real impulse), static steel
// silhouettes and plate racks, a falling popper, and a spinner. Each target
// exposes onHit(info) for the projectile manager and keeps its own score.
// ============================================================================
import * as THREE from 'three';
import { mat } from './materials.js';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

function bullseyeTexture(size = 512, rings = 8) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe9d6'; ctx.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, R = size * 0.46;
  for (let i = rings; i >= 1; i--) {
    const r = R * i / rings;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = i <= 3 ? '#111' : (i % 2 ? '#ffffff' : '#e5dcc2'); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = i <= 3 ? '#eee' : '#222'; ctx.font = `${size / 24}px Arial`; ctx.textAlign = 'center';
    ctx.fillText(String(11 - i), cx, cy - r + size / 22);
  }
  ctx.fillStyle = '#c33'; ctx.beginPath(); ctx.arc(cx, cy, R / rings * 0.35, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return t;
}
function silhouetteTexture() {
  const c = document.createElement('canvas'); c.width = 384; c.height = 640; const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9a877'; ctx.fillRect(0, 0, 384, 640);
  ctx.strokeStyle = '#3b2f24'; ctx.lineWidth = 3;
  // A / C / D zones of a classic silhouette
  ctx.strokeRect(150, 60, 84, 100); ctx.strokeRect(96, 180, 192, 300); ctx.strokeRect(40, 160, 304, 460);
  ctx.fillStyle = '#3b2f24'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center';
  ctx.fillText('A', 192, 110); ctx.fillText('A', 192, 340); ctx.fillText('C', 70, 340); ctx.fillText('C', 314, 340); ctx.fillText('D', 192, 600);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return t;
}

export function createTargets(scene, physics, hooks) {
  const group = new THREE.Group(); group.name = 'targets'; scene.add(group);
  const targets = [];
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x151210, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const splatMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.6, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const timber = mat('lumber'), steelMat = mat('paintedSteel'), postMat = mat('galvanized'), rubber = mat('rubber');
  const bullTex = bullseyeTexture(), silTex = silhouetteTexture();
  const ipscShape = () => { // IPSC-ish outline in metres (0.45 × 0.75)
    const s = new THREE.Shape();
    s.moveTo(-0.225, 0); s.lineTo(0.225, 0); s.lineTo(0.225, 0.52); s.lineTo(0.13, 0.62); s.lineTo(0.09, 0.75); s.lineTo(-0.09, 0.75); s.lineTo(-0.13, 0.62); s.lineTo(-0.225, 0.52); s.closePath();
    return s;
  };

  function frame(x, z, h, w) {
    for (const dx of [-w / 2, w / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), timber); p.position.set(x + dx, h / 2, z); p.castShadow = p.receiveShadow = true; group.add(p); physics.addStaticBox([x + dx, h / 2, z], [0.025, h / 2, 0.025], { material: 'pine', thickness: 0.05, name: 'target frame' }); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), timber); bar.position.set(x, h - 0.1, z); bar.castShadow = true; group.add(bar);
  }

  /** Paper target: kind 'bull' (square) | 'ipsc' (silhouette). Face centre at (x, yc, z). */
  function addPaper(x, z, kind, dist) {
    const w = kind === 'bull' ? (dist >= 100 ? 1.0 : 0.5) : 0.45, h = kind === 'bull' ? w : 0.75;
    const yc = kind === 'bull' ? 1.3 : 1.35;
    frame(x, z, 1.9, w + 0.3);
    let face;
    if (kind === 'bull') face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: bullTex, roughness: 0.85, side: THREE.DoubleSide }));
    else face = new THREE.Mesh(new THREE.ShapeGeometry(ipscShape()), new THREE.MeshStandardMaterial({ map: silTex, roughness: 0.85, side: THREE.DoubleSide }));
    if (kind === 'ipsc') { face.geometry.translate(0, -0.375, 0); const uv = face.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.45 + 0.5, (uv.getY(i)) / 0.75); }
    face.position.set(x, yc, z); face.castShadow = true; face.receiveShadow = true; group.add(face);
    const t = { kind: 'paper', name: `${kind === 'bull' ? 'bullseye' : 'silhouette'} ${dist} m`, dist, center: new THREE.Vector3(x, yc, z), w, h, hits: [], holes: [], mesh: face };
    physics.addStaticBox([x, yc, z], [w / 2, h / 2, 0.003], { material: 'paper', thickness: 0.004, name: t.name, target: t });
    t.onHit = (info) => {
      // hole decal on the face
      const hole = new THREE.Mesh(new THREE.CircleGeometry(info.cart.diameterMm / 2000 + 0.0006, 12), holeMat);
      hole.position.copy(info.point).addScaledVector(info.normal, 0.0015); hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), info.normal.clone().multiplyScalar(info.normal.z > 0 ? 1 : -1)); if (info.normal.z < 0) hole.rotation.y += Math.PI;
      group.add(hole); t.holes.push(hole); if (t.holes.length > 300) group.remove(t.holes.shift());
      const dx = (info.point.x - x) * 100, dy = (info.point.y - yc) * 100;
      t.hits.push({ dx, dy, time: performance.now() });
      hooks.onTargetHit?.(t, { dx, dy, ...info });
      return { splash: false };
    };
    t.reset = () => { for (const h of t.holes) group.remove(h); t.holes.length = 0; t.hits.length = 0; };
    targets.push(t); return t;
  }

  /** AR500 gong: round plate hanging from a hinge — swings with the bullet's momentum. */
  function addGong(x, z, dia, dist, thick = 0.012) {
    const H = 2.2; frame(x, z, H, dia + 0.6);
    const yc = 1.25, hang = H - 0.15 - yc;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(dia / 2, dia / 2, thick, 40), steelMat); plate.rotation.x = Math.PI / 2; plate.castShadow = plate.receiveShadow = true;
    const holder = new THREE.Group(); holder.add(plate); holder.position.set(x, yc, z); group.add(holder);
    for (const sx of [-1, 1]) { const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, hang, 6), postMat); chain.position.set(sx * dia * 0.35, hang / 2, 0); holder.add(chain); }
    const t = { kind: 'steel', name: `${Math.round(dia * 100)} cm gong ${dist} m`, dist, center: new THREE.Vector3(x, yc, z), mesh: holder, hits: [], gong: true, dia };
    const mass = 7850 * Math.PI * (dia / 2) ** 2 * thick;
    const body = physics.addHingedPlate([x, yc, z], [dia / 2, dia / 2 + 0.0, thick / 2], hang, { material: 'ar500', thickness: thick, name: t.name, target: t }, mass);
    t.body = body.rb;
    t.onHit = (info) => {
      // impulse = bullet momentum (splash: nearly inelastic)
      const J = info.momentum * (info.outcome.type === 'ricochet' ? 0.6 : 1.0);
      const p = info.point; const d = info.dir;
      body.rb.applyImpulseAtPoint({ x: d.x * J, y: d.y * J, z: d.z * J }, { x: p.x, y: p.y, z: p.z }, true);
      const splat = new THREE.Mesh(new THREE.CircleGeometry(0.012 + Math.random() * 0.01, 10), splatMat);
      // attach the splat to the plate in its local frame
      holder.worldToLocal(splat.position.copy(p)); splat.position.z += Math.sign(-d.z) * thick * 0.55; splat.rotation.y = d.z > 0 ? Math.PI : 0; holder.add(splat);
      t.hits.push({ time: performance.now(), energy: info.energy });
      hooks.onTargetHit?.(t, info);
      return { splash: true };
    };
    t.sync = () => { const b = t.body; const tr = b.translation(), ro = b.rotation(); holder.position.set(tr.x, tr.y, tr.z); holder.quaternion.set(ro.x, ro.y, ro.z, ro.w); };
    t.reset = () => { for (const c of [...holder.children]) if (c.geometry?.type === 'CircleGeometry') holder.remove(c); t.hits.length = 0; };
    targets.push(t); return t;
  }

  /** static steel silhouette on a post */
  function addSteelSilhouette(x, z, scale, dist) {
    const w = 0.45 * scale, h = 0.75 * scale, yc = 1.0;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, yc, 0.08), postMat); post.position.set(x, yc / 2, z); post.castShadow = true; group.add(post);
    const geo = new THREE.ExtrudeGeometry(ipscShape(), { depth: 0.01, bevelEnabled: false }); geo.scale(scale, scale, 1); geo.translate(0, 0, -0.005);
    const plate = new THREE.Mesh(geo, steelMat); plate.position.set(x, yc, z); plate.castShadow = plate.receiveShadow = true; group.add(plate);
    const t = { kind: 'steel', name: `steel silhouette ${dist} m`, dist, center: new THREE.Vector3(x, yc + h / 2, z), mesh: plate, hits: [], w, h };
    physics.addStaticBox([x, yc + h / 2, z], [w / 2, h / 2, 0.005], { material: 'ar500', thickness: 0.01, name: t.name, target: t });
    t.onHit = (info) => {
      const splat = new THREE.Mesh(new THREE.CircleGeometry(0.012 + Math.random() * 0.012, 10), splatMat);
      splat.position.copy(info.point).addScaledVector(info.normal, 0.002); splat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), info.normal); group.add(splat); t.hits.push({ time: performance.now(), energy: info.energy, splat });
      hooks.onTargetHit?.(t, info); return { splash: true };
    };
    t.reset = () => { for (const h of t.hits) if (h.splat) group.remove(h.splat); t.hits.length = 0; };
    targets.push(t); return t;
  }

  /** plate rack: n round plates on a rail */
  function addPlateRack(x, z, n, dia, dist) {
    const y = 1.1; const rail = new THREE.Mesh(new THREE.BoxGeometry(n * (dia + 0.1), 0.06, 0.06), postMat); rail.position.set(x, y - dia / 2 - 0.08, z); rail.castShadow = true; group.add(rail);
    for (const dx of [-n * (dia + 0.1) / 2 + 0.1, n * (dia + 0.1) / 2 - 0.1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, y - dia / 2 - 0.08, 0.06), postMat); p.position.set(x + dx, (y - dia / 2 - 0.08) / 2, z); p.castShadow = true; group.add(p); }
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * (dia + 0.1);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(dia / 2, dia / 2, 0.01, 32), steelMat); plate.rotation.x = Math.PI / 2; plate.position.set(px, y, z); plate.castShadow = plate.receiveShadow = true; group.add(plate);
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.02), postMat); stem.position.set(px, y - dia / 2 - 0.02, z); group.add(stem);
      const t = { kind: 'steel', name: `plate ${i + 1} (${Math.round(dia * 100)} cm) ${dist} m`, dist, center: new THREE.Vector3(px, y, z), mesh: plate, hits: [], dia };
      physics.addStaticBox([px, y, z], [dia / 2, dia / 2, 0.005], { material: 'ar500', thickness: 0.01, name: t.name, target: t });
      t.onHit = (info) => { const splat = new THREE.Mesh(new THREE.CircleGeometry(0.01 + Math.random() * 0.01, 10), splatMat); splat.position.copy(info.point).addScaledVector(info.normal, 0.002); splat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), info.normal); group.add(splat); t.hits.push({ time: performance.now(), splat }); hooks.onTargetHit?.(t, info); return { splash: true }; };
      t.reset = () => { for (const h of t.hits) if (h.splat) group.remove(h.splat); t.hits.length = 0; };
      targets.push(t);
    }
  }

  /** pepper popper: falls back when hit hard enough, resets after a few seconds (kinematic) */
  function addPopper(x, z, dist) {
    const H = 1.05; const pivot = new THREE.Group(); pivot.position.set(x, 0.05, z); group.add(pivot);
    const shape = new THREE.Shape(); shape.moveTo(-0.13, 0); shape.lineTo(0.13, 0); shape.lineTo(0.13, 0.45); shape.lineTo(0.07, 0.62); shape.lineTo(0.14, 0.72); shape.absarc(0, 0.88, 0.16, -Math.PI / 6, Math.PI * 7 / 6, false); shape.lineTo(-0.14, 0.72); shape.lineTo(-0.07, 0.62); shape.lineTo(-0.13, 0.45); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false }); geo.translate(0, 0, -0.005);
    const plate = new THREE.Mesh(geo, steelMat); plate.castShadow = plate.receiveShadow = true; pivot.add(plate);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), postMat); base.position.set(x, 0.025, z + 0.1); base.castShadow = true; group.add(base);
    const t = { kind: 'steel', name: `popper ${dist} m`, dist, center: new THREE.Vector3(x, 0.9, z), mesh: pivot, hits: [], popper: true, down: 0, downTimer: 0 };
    const rb = physics.world.createRigidBody(physics.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.05, z));
    const col = physics.world.createCollider(physics.RAPIER.ColliderDesc.cuboid(0.16, H / 2, 0.005).setTranslation(0, H / 2, 0), rb);
    physics.hitInfo.set(col.handle, { material: 'ar500', thickness: 0.01, name: t.name, target: t });
    t.body = rb;
    t.onHit = (info) => {
      const splat = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), splatMat); pivot.worldToLocal(splat.position.copy(info.point)); splat.position.z += 0.006; pivot.add(splat);
      t.hits.push({ time: performance.now(), splat });
      // falls if hit above the balance point with enough momentum (lever arm × momentum vs. restoring torque)
      const lever = info.point.y - 0.05;
      if (t.down === 0 && info.momentum * lever > 0.9) { t.down = 1e-6; hooks.sound?.('popperFall', { pos: t.center, delayFrom: t.center }); }
      hooks.onTargetHit?.(t, info); return { splash: true };
    };
    t.update = (dt) => {
      if (t.down > 0) {
        t.down = Math.min(1, t.down + dt / 0.55); const ang = -Math.PI * 0.47 * (t.down * t.down * (3 - 2 * t.down));
        pivot.rotation.x = ang; t.body.setNextKinematicRotation(_q.setFromEuler(new THREE.Euler(ang, 0, 0)));
        if (t.down >= 1) { t.downTimer += dt; if (t.downTimer > 4) { t.down = 0; t.downTimer = 0; pivot.rotation.x = 0; t.body.setNextKinematicRotation(_q.set(0, 0, 0, 1)); hooks.sound?.('popperReset', { pos: t.center, delayFrom: t.center }); } }
      }
    };
    t.reset = () => { for (const h of t.hits) if (h.splat) pivot.remove(h.splat); t.hits.length = 0; t.down = 0; t.downTimer = 0; pivot.rotation.x = 0; t.body.setNextKinematicRotation(_q.set(0, 0, 0, 1)); };
    targets.push(t); return t;
  }

  /** spinner: two plates on an arm, free to rotate about a horizontal axle */
  function addSpinner(x, z, dist) {
    const y = 1.2, arm = 0.5;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, y, 0.06), postMat); p.position.set(x + sx * 0.35, y / 2, z); p.castShadow = true; group.add(p); physics.addStaticBox([x + sx * 0.35, y / 2, z], [0.03, y / 2, 0.03], { material: 'steel', thickness: 0.006, name: 'post' }); }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 10), postMat); axle.rotation.z = Math.PI / 2; axle.position.set(x, y, z); group.add(axle);
    const holder = new THREE.Group(); holder.position.set(x, y, z); group.add(holder);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, arm * 2, 0.02), postMat); holder.add(bar);
    const pl = (dy, r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.01, 28), steelMat); m.rotation.x = Math.PI / 2; m.position.y = dy; m.castShadow = true; holder.add(m); return m; };
    pl(arm, 0.10); pl(-arm, 0.15);
    const t = { kind: 'steel', name: `spinner ${dist} m`, dist, center: new THREE.Vector3(x, y + arm, z), mesh: holder, hits: [], spinner: true };
    const RAPIER = physics.RAPIER;
    const anchor = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const rb = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setAngularDamping(0.35));
    const c1 = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.10, 0.10, 0.005).setTranslation(0, arm, 0).setMass(2.5), rb);
    const c2 = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, 0.15, 0.005).setTranslation(0, -arm, 0).setMass(5.5), rb);
    const c3 = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, arm, 0.01).setMass(1.5), rb);
    physics.world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), anchor, rb, true);
    for (const c of [c1, c2]) physics.hitInfo.set(c.handle, { material: 'ar500', thickness: 0.01, name: t.name, target: t });
    physics.hitInfo.set(c3.handle, { material: 'steel', thickness: 0.02, name: t.name + ' arm', target: t });
    t.body = rb;
    t.onHit = (info) => { const p = info.point, d = info.dir, J = info.momentum; rb.applyImpulseAtPoint({ x: d.x * J, y: d.y * J, z: d.z * J }, { x: p.x, y: p.y, z: p.z }, true); t.hits.push({ time: performance.now() }); hooks.onTargetHit?.(t, info); return { splash: true }; };
    t.sync = () => { const tr = rb.translation(), ro = rb.rotation(); holder.position.set(tr.x, tr.y, tr.z); holder.quaternion.set(ro.x, ro.y, ro.z, ro.w); };
    t.reset = () => { t.hits.length = 0; };
    targets.push(t);
  }

  // ---------------------------------------------------------------- layout
  for (const x of [-10, -6, -2, 2, 6]) addPaper(x, -10, x % 4 === 2 ? 'ipsc' : 'bull', 10);
  addPopper(10, -10, 10);
  for (const x of [-10, -6, -2, 2]) addPaper(x, -25, x > -4 ? 'ipsc' : 'bull', 25);
  addPlateRack(7, -25, 6, 0.2, 25);
  addSpinner(11, -25, 25);
  for (const x of [-8, 0]) addPaper(x, -50, x === 0 ? 'bull' : 'ipsc', 50);
  addPlateRack(7, -50, 5, 0.25, 50);
  addPopper(-3, -50, 50);
  addPaper(0, -100, 'bull', 100);
  addGong(-6, -100, 0.30, 100);
  addSteelSilhouette(6, -100, 1.0, 100);
  addGong(6, -200, 0.30, 200);
  addSteelSilhouette(-4, -200, 1.0, 200);
  addPaper(-9, -200, 'bull', 200);
  addGong(-6, -300, 0.40, 300);
  addSteelSilhouette(3, -300, 1.0, 300);
  addGong(6, -400, 0.45, 400);
  addSteelSilhouette(-4, -400, 1.0, 400);
  addGong(0, -500, 0.50, 500);
  addSteelSilhouette(5, -500, 1.0, 500);
  addGong(-3, -600, 0.60, 600);
  addSteelSilhouette(3, -600, 1.0, 600);

  return {
    group, targets,
    update(dt) { for (const t of targets) { t.update?.(dt); t.sync?.(); } },
    resetAll() { for (const t of targets) t.reset?.(); },
    nearestTo(point) { let best = null, bd = Infinity; for (const t of targets) { const d = t.center.distanceTo(point); if (d < bd) { bd = d; best = t; } } return best; },
  };
}

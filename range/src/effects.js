// ============================================================================
// RANGE — effects.js
// Muzzle flash + smoke, impact particles per material, bullet streaks, shot
// trace replay, instanced brass and dropped magazines synced to Rapier bodies.
// ============================================================================
import * as THREE from 'three';
import { mat } from './materials.js';
import { cartridgeModel } from './gunparts.js';
import { CARTRIDGES } from './cartridges.js';

// ---------------------------------------------------------------- particle system (CPU sim, GPU points)
const PARTICLE_VS = `
attribute float size; attribute vec4 color;
varying vec4 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = `
varying vec4 vColor; uniform float soft;
void main() {
  vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0;
  float a = smoothstep(1.0, 1.0 - soft, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

class ParticleSystem {
  constructor(scene, max, o = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max); this.col = new Float32Array(max * 4); this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3); this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1); this.colAttr = new THREE.BufferAttribute(this.col, 4);
    g.setAttribute('position', this.posAttr); g.setAttribute('size', this.sizeAttr); g.setAttribute('color', this.colAttr);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, uniforms: { soft: { value: o.soft ?? 0.6 } }, transparent: true, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = o.renderOrder ?? 5; scene.add(this.points);
  }
  emit(p, v, life, size0, size1, r, g, b, a, grav = 9.81, drag = 0) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size0; this.size1[i] = size1;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a; this.alpha0[i] = a;
    this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap with last
        n--; if (i !== n) { this.copy(n, i); i--; } continue;
      }
      const k = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.005) { this.pos[i * 3 + 1] = 0.005; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
      this.sizeAttr.array[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * k;
      this.col[i * 4 + 3] = this.alpha0[i] * (1 - k * k);
    }
    this.n = n;
    this.points.geometry.setDrawRange(0, n);
    this.posAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
  }
  copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from]; this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from]; this.alpha0[to] = this.alpha0[from]; this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
  }
}

function flashTexture() {
  const s = 256; const c = document.createElement('canvas'); c.width = c.height = s; const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.18, 'rgba(255,215,140,0.95)'); g.addColorStop(0.45, 'rgba(255,140,50,0.45)'); g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  // prongs
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + 0.3; ctx.save(); ctx.translate(s / 2, s / 2); ctx.rotate(a); const lg = ctx.createLinearGradient(0, 0, s / 2, 0); lg.addColorStop(0, 'rgba(255,230,180,0.9)'); lg.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(s / 2, 0); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill(); ctx.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createEffects(scene, physics) {
  const sparks = new ParticleSystem(scene, 2000, { additive: true, soft: 0.5 });
  const dust = new ParticleSystem(scene, 3000, { additive: false, soft: 0.9 });
  const smoke = new ParticleSystem(scene, 800, { additive: false, soft: 0.95, renderOrder: 6 });
  const flashTex = flashTexture();
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group(); flash.visible = false; scene.add(flash);
  const flashPlanes = [];
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat); m.renderOrder = 8; flash.add(m); flashPlanes.push(m); }
  const flashLight = new THREE.PointLight(0xffb070, 0, 9, 2); flashLight.visible = false; scene.add(flashLight);
  let flashT = 0, flashDur = 0.03;

  // bullet streaks: one Line per active bullet (pool)
  const streakMat = new THREE.LineBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const streaks = [];
  const traceMat = new THREE.LineBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.9, depthTest: true });
  const traces = [];
  let showTraces = false;

  // brass: instanced per cartridge
  const brassMats = { brass: mat('brass'), primer: mat('primer'), copper: mat('copper'), greenTip: mat('greenTip'), redTip: mat('redTip') };
  const brass = {}; // id → { mesh, list: [{body, t}] }
  function brassPool(cartId, live = false) {
    const key = cartId + (live ? ':live' : '');
    if (brass[key]) return brass[key];
    const model = cartridgeModel(CARTRIDGES[cartId], brassMats, { withBullet: live });
    // merge into one geometry (brass colour for all parts; the primer is a tiny disc)
    const geos = []; model.updateMatrixWorld(true);
    model.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos.push(g); } });
    let merged = geos[0]; if (geos.length > 1) { merged = mergeAll(geos); }
    const mesh = new THREE.InstancedMesh(merged, live ? mat('copper') : mat('brass'), 300);
    mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; scene.add(mesh);
    return (brass[key] = { mesh, list: [] });
  }
  function mergeAll(geos) {
    let total = 0; for (const g of geos) total += (g.index ? g.index.count : g.attributes.position.count);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3); let o = 0;
    for (const g of geos) { const p = g.attributes.position, n = g.attributes.normal; const idx = g.index; const cnt = idx ? idx.count : p.count; for (let i = 0; i < cnt; i++) { const vi = idx ? idx.getX(i) : i; pos[o * 3] = p.getX(vi); pos[o * 3 + 1] = p.getY(vi); pos[o * 3 + 2] = p.getZ(vi); nor[o * 3] = n.getX(vi); nor[o * 3 + 1] = n.getY(vi); nor[o * 3 + 2] = n.getZ(vi); o++; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return g;
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
  const mags = []; // dropped magazines { body, mesh }
  // in-flight bullets: one InstancedMesh per cartridge holding just the projectile (jacket + tip), oriented along the velocity
  const bulletPools = {};
  function bulletPool(cartId) {
    if (bulletPools[cartId]) return bulletPools[cartId];
    const model = cartridgeModel(CARTRIDGES[cartId], brassMats, { withBullet: true });
    const geos = []; model.updateMatrixWorld(true);
    model.traverse((o) => { if (o.isMesh && o.name !== 'case' && o.name !== 'primer') { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos.push(g); } });
    const merged = geos.length > 1 ? mergeAll(geos) : geos[0];
    // the bullet sits with its base at the case mouth; shift so the geometry is centred on its own length
    const cl = CARTRIDGES[cartId].case.len / 1000, bl = (CARTRIDGES[cartId].oalMm - CARTRIDGES[cartId].case.len) / 1000;
    merged.translate(0, 0, cl + bl * 0.5);
    const mesh = new THREE.InstancedMesh(merged, mat('copper'), 64); mesh.count = 0; mesh.frustumCulled = false; scene.add(mesh);
    return (bulletPools[cartId] = mesh);
  }
  const _fwd = new THREE.Vector3(0, 0, -1), _dir = new THREE.Vector3();
  const bulletCounts = {};

  const api = {
    sparks, dust, smoke, showTraces: () => showTraces, setShowTraces(v) { showTraces = v; for (const t of traces) t.visible = v; },
    muzzleFlash(pos, dir, weaponSpec, slowmo) {
      flash.visible = true; flash.position.copy(pos).addScaledVector(dir, 0.03);
      flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      const big = weaponSpec.caliber === '.308' || weaponSpec.caliber === '6.5' ? 1.5 : weaponSpec.caliber === '9mm' ? 0.55 : 1.0;
      for (const p of flashPlanes) { const s = (0.30 + Math.random() * 0.18) * big; p.scale.set(s, s, 1); p.rotation.z = Math.random() * Math.PI * 2; p.position.set(0, 0, -Math.random() * 0.06 * big); }
      flashPlanes[0].rotation.set(0, 0, Math.random() * 6); flashPlanes[1].rotation.set(0, Math.PI / 2, Math.random() * 6); flashPlanes[2].rotation.set(Math.PI / 2, 0, Math.random() * 6);
      flashT = 0; flashDur = 0.042; void slowmo;
      flashLight.visible = true; flashLight.position.copy(pos).addScaledVector(dir, 0.15); flashLight.intensity = 140 * big;
      // smoke
      for (let i = 0; i < 10; i++) { _v.copy(dir).multiplyScalar(4 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random()) * 1.2, (Math.random() - 0.5) * 1.5)); smoke.emit(pos, _v, 0.9 + Math.random() * 0.8, 0.05, 0.45 * big, 0.55, 0.55, 0.55, 0.28, -0.4, 3.5); }
      for (let i = 0; i < 12; i++) { _v.copy(dir).multiplyScalar(12 + Math.random() * 25).add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6)); sparks.emit(pos, _v, 0.05 + Math.random() * 0.12, 0.012, 0.004, 1.0, 0.75, 0.35, 0.9, 6, 2); }
    },
    portGas(pos, dir) { for (let i = 0; i < 3; i++) { _v.copy(dir).multiplyScalar(1.5 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6)); smoke.emit(pos, _v, 0.5 + Math.random() * 0.4, 0.02, 0.14, 0.6, 0.6, 0.6, 0.22, -0.3, 3); } },
    impact(point, normal, material, outcome, energy) {
      const n = normal; const k = Math.min(1, energy / 1500);
      if (material === 'ar500' || material === 'steel' || material === 'aluminum' || material === 'concrete') {
        const cnt = 16 + Math.floor(20 * k);
        for (let i = 0; i < cnt; i++) { _v.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize().multiplyScalar(6 + Math.random() * 18 * (0.5 + k)); _v.addScaledVector(n, 4 + Math.random() * 8); sparks.emit(point, _v, 0.15 + Math.random() * 0.3, 0.02, 0.006, 1.0, 0.8 + Math.random() * 0.2, 0.4, 1.0, 9.81, 1.5); }
        for (let i = 0; i < 6; i++) { _v.copy(n).multiplyScalar(1 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8, (Math.random() - 0.5))); dust.emit(point, _v, 0.6 + Math.random() * 0.6, 0.03, 0.25, 0.7, 0.7, 0.68, 0.35, -0.2, 3); }
        if (material === 'concrete') for (let i = 0; i < 10; i++) { _v.copy(n).multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3)); dust.emit(point, _v, 0.4 + Math.random() * 0.4, 0.01, 0.02, 0.6, 0.6, 0.58, 0.9, 9.81, 0.5); }
      } else if (material === 'soil' || material === 'gravel') {
        const cnt = 18 + Math.floor(25 * k);
        for (let i = 0; i < cnt; i++) { _v.copy(n).multiplyScalar(2 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)); dust.emit(point, _v, 1.0 + Math.random() * 1.4, 0.05, 0.55, 0.5, 0.42, 0.32, 0.5, 0.8, 2.0); }
        for (let i = 0; i < 12; i++) { _v.copy(n).multiplyScalar(3 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5)); dust.emit(point, _v, 0.6 + Math.random() * 0.6, 0.012, 0.02, 0.45, 0.36, 0.26, 1.0, 9.81, 0.3); }
      } else if (material === 'plywood' || material === 'pine') {
        for (let i = 0; i < 10; i++) { _v.copy(n).multiplyScalar(2 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)); dust.emit(point, _v, 0.5 + Math.random() * 0.5, 0.012, 0.02, 0.75, 0.62, 0.42, 1.0, 9.81, 0.6); }
        for (let i = 0; i < 4; i++) { _v.copy(n).multiplyScalar(0.6 + Math.random()); dust.emit(point, _v, 0.5, 0.03, 0.15, 0.7, 0.62, 0.5, 0.3, 0, 2); }
      } else if (material === 'paper') {
        for (let i = 0; i < 4; i++) { _v.copy(n).multiplyScalar(-(0.5 + Math.random())).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0)); dust.emit(point, _v, 0.35, 0.01, 0.06, 0.85, 0.8, 0.7, 0.45, 1, 3); }
      } else if (material === 'rubber' || material === 'polymer') {
        for (let i = 0; i < 5; i++) { _v.copy(n).multiplyScalar(1 + Math.random() * 2); dust.emit(point, _v, 0.4, 0.01, 0.03, 0.2, 0.2, 0.2, 0.8, 9.81, 0.5); }
      }
      if (outcome.type === 'ricochet') for (let i = 0; i < 8; i++) { _v.set(...outcome.dir).multiplyScalar(20 + Math.random() * 30).add(new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8)); sparks.emit(point, _v, 0.2 + Math.random() * 0.2, 0.02, 0.005, 1, 0.85, 0.5, 1, 9.81, 1); }
    },
    /** draw the live projectiles (called once per frame with the manager's bullet list) */
    drawBullets(bullets) {
      for (const k in bulletCounts) bulletCounts[k] = 0;
      for (const b of bullets) {
        const id = b.tag.cart.id; const mesh = bulletPool(id); const i = bulletCounts[id] || 0; if (i >= 64) continue;
        _p.set(b.pos[0], b.pos[1], b.pos[2]); _dir.set(b.vel[0], b.vel[1], b.vel[2]).normalize();
        _q.setFromUnitVectors(_fwd, _dir);
        if (b.deformed) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_dir, b.t * 200)); // tumbling
        _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m); bulletCounts[id] = i + 1;
      }
      for (const id in bulletPools) { bulletPools[id].count = bulletCounts[id] || 0; bulletPools[id].instanceMatrix.needsUpdate = true; }
    },
    /** per-bullet streak between two points (fades each frame) */
    streak(id, a, b, brightness = 1) {
      let s = streaks[id];
      if (!s) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); s = new THREE.Line(g, streakMat.clone()); s.frustumCulled = false; s.renderOrder = 7; scene.add(s); streaks[id] = s; }
      const p = s.geometry.attributes.position.array; p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z; s.geometry.attributes.position.needsUpdate = true;
      s.material.opacity = 0.32 * brightness; s.visible = true; s.userData.age = 0;
    },
    hideStreak(id) { if (streaks[id]) streaks[id].visible = false; },
    /** shot trace replay line from recorded path points */
    addTrace(points, impact) {
      const g = new THREE.BufferGeometry().setFromPoints(points); const l = new THREE.Line(g, traceMat); l.visible = showTraces; l.frustumCulled = false; scene.add(l); traces.push(l);
      if (impact) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 })); m.position.copy(impact); m.visible = showTraces; scene.add(m); traces.push(m); }
      while (traces.length > 60) { const t = traces.shift(); scene.remove(t); }
    },
    clearTraces() { for (const t of traces) scene.remove(t); traces.length = 0; },
    /** eject a case as a rigid body */
    ejectCase(info) {
      const c = info.cart.case; const pool = brassPool(info.cart.id, !info.spent);
      const len = (info.spent ? c.len : info.cart.oalMm) / 1000, radius = c.base / 2000;
      const body = physics.addCase(info.pos, info.quat, info.vel, info.angVel, len, radius, (c.massG + (info.spent ? 0 : info.cart.bulletMassG)) / 1000);
      pool.list.push({ body, t: 0, lastV: info.vel.length(), bounces: 0, cartId: info.cart.id, live: !info.spent });
      if (pool.list.length > 280) { const old = pool.list.shift(); physics.remove(old.body); }
    },
    dropMag(info, sceneMesh) {
      const mesh = sceneMesh; scene.add(mesh); mesh.position.copy(info.pos); mesh.quaternion.copy(info.quat);
      const body = physics.addBox(info.pos, info.quat, info.vel, info.half, info.massKg);
      mags.push({ body, mesh, t: 0, lastV: info.vel.length() });
      if (mags.length > 8) { const old = mags.shift(); physics.remove(old.body); scene.remove(old.mesh); }
    },
    update(dt, hooks) {
      sparks.update(dt); dust.update(dt); smoke.update(dt);
      if (flash.visible) { flashT += dt; const k = flashT / flashDur; if (k >= 1) { flash.visible = false; flashLight.visible = false; } else { flashLight.intensity *= Math.exp(-dt * 90); flashMat.opacity = 1 - k * k; } }
      for (const s of streaks) if (s && s.visible) { s.userData.age += dt; s.material.opacity *= Math.exp(-dt * 40); if (s.userData.age > 0.12) s.visible = false; }
      // brass sync + bounce sounds
      for (const key in brass) {
        const pool = brass[key]; const mesh = pool.mesh; let i = 0;
        for (const it of pool.list) {
          const b = it.body; const tr = b.translation(), ro = b.rotation();
          _p.set(tr.x, tr.y, tr.z); _q.set(ro.x, ro.y, ro.z, ro.w); _m.compose(_p, _q, _s); mesh.setMatrixAt(i++, _m);
          it.t += dt;
          const lv = b.linvel(); const v = Math.hypot(lv.x, lv.y, lv.z);
          if (it.lastV - v > 1.2 && it.bounces < 6 && it.t > 0.05) { it.bounces++; hooks?.sound?.('brassTink', { pos: _p.clone(), gain: Math.min(1, (it.lastV - v) / 5), pitch: 0.85 + Math.random() * 0.4 }); }
          it.lastV = v;
        }
        mesh.count = i; mesh.instanceMatrix.needsUpdate = true;
      }
      for (const m of mags) {
        const tr = m.body.translation(), ro = m.body.rotation(); m.mesh.position.set(tr.x, tr.y, tr.z); m.mesh.quaternion.set(ro.x, ro.y, ro.z, ro.w); m.t += dt;
        const lv = m.body.linvel(); const v = Math.hypot(lv.x, lv.y, lv.z);
        if (m.lastV - v > 1.0 && m.t > 0.05 && !m.thud) { m.thud = true; hooks?.sound?.('magDrop', { pos: m.mesh.position.clone(), gain: Math.min(1, (m.lastV - v) / 4) }); }
        m.lastV = v;
      }
    },
  };
  return api;
}

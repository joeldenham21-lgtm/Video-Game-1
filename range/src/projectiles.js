// ============================================================================
// RANGE — projectiles.js
// Bullet manager: every shot is a real projectile integrated with RK4 on
// 0.4 ms sub-steps through the atmosphere/wind/Coriolis/spin-drift model,
// with a Rapier ray cast per sub-step segment (no tunnelling). Impacts go
// through the terminal model: stop / penetrate (continue with the exit
// velocity through real collider thickness) / ricochet.
// ============================================================================
import * as THREE from 'three';
import * as B from './ballistics.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();

export class ProjectileManager {
  constructor({ physics, effects, audio, hooks }) {
    this.physics = physics; this.effects = effects; this.audio = audio; this.hooks = hooks || {};
    this.bullets = []; this.env = B.makeEnv({}); this.nextId = 0;
    this.subDt = 0.0004; this.maxRange = 2500;
    this.lastShot = null;
  }
  setEnvironment(o) { this.env = B.makeEnv(o); }

  /** info from the viewmodel: origin, dir, mv, cart, weapon, twistMm */
  fire(info) {
    const c = info.cart;
    const massKg = c.bulletMassG / 1000, diameterM = c.diameterMm / 1000;
    const sg = B.millerStability({ massG: c.bulletMassG, diameterMm: c.diameterMm, lengthMm: c.lengthMm, twistMm: info.twistMm, velocity: info.mv, atm: this.env.atm });
    const vel = [info.dir.x * info.mv, info.dir.y * info.mv, info.dir.z * info.mv];
    const p = B.makeProjectile({ massKg, diameterM, bc: c.bc, model: c.model, sg, pos: [info.origin.x, info.origin.y, info.origin.z], vel, tag: { cart: c, weapon: info.weapon, id: this.nextId++ } });
    p.path = [new THREE.Vector3(info.origin.x, info.origin.y, info.origin.z)]; p.pathAcc = 0; p.origin = info.origin.clone();
    p.rng = Math.random; p.impacts = [];
    this.bullets.push(p);
    this.lastShot = { id: p.tag.id, cart: c, mv: info.mv, sg, origin: info.origin.clone(), impacts: [], tof: 0, dist: 0, done: false };
    p.shot = this.lastShot;
    return p;
  }

  update(dt) {
    const env = this.env;
    this.effects.drawBullets?.(this.bullets);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const p = this.bullets[i];
      let remaining = dt;
      while (remaining > 0 && p.alive) {
        const h = Math.min(this.subDt, remaining); remaining -= h;
        B.stepProjectile(p, h, env);
        // segment ray cast
        _a.set(p.prevPos[0], p.prevPos[1], p.prevPos[2]); _b.set(p.pos[0], p.pos[1], p.pos[2]);
        _d.subVectors(_b, _a); const segLen = _d.length();
        if (segLen > 1e-6) {
          _d.divideScalar(segLen);
          const hit = this.physics.castRay(_a, _d, segLen);
          if (hit) this.onImpact(p, hit, _d);
        }
        if (p.pos[1] < -5 || p.dist > this.maxRange || B.speed(p) < 15) p.alive = false;
        // path recording for the trace
        p.pathAcc += segLen;
        if (p.pathAcc > 2) { p.pathAcc = 0; p.path.push(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2])); }
      }
      // streak: last segment for the visual
      if (p.alive) { const v = B.speed(p); _a.set(p.pos[0], p.pos[1], p.pos[2]); _b.copy(_a).addScaledVector(_d.set(p.vel[0], p.vel[1], p.vel[2]).normalize(), -Math.min(1.2, v * 0.0025)); this.effects.streak(p.tag.id % 64, _b, _a, p.deformed ? 0.5 : 1); }
      else {
        this.effects.hideStreak(p.tag.id % 64);
        p.path.push(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
        this.effects.addTrace(p.path, p.impacts.length ? p.impacts[p.impacts.length - 1].point : null);
        p.shot.done = true; p.shot.tof = p.t; p.shot.dist = p.dist;
        this.hooks.onShotDone?.(p.shot);
        this.bullets.splice(i, 1);
      }
    }
  }

  onImpact(p, hit, dir) {
    const desc = hit.hit; const material = B.MATERIALS[desc.material] || B.MATERIALS.concrete;
    const n = hit.normal; if (n.dot(dir) > 0) n.negate();
    const v = B.speed(p), energy = 0.5 * p.massKg * v * v, momentum = p.massKg * v;
    // real thickness along the ray when we have a finite collider
    let thickness = desc.thickness ?? 0.05;
    if (thickness < 1) {
      const inside = _n.copy(hit.point).addScaledVector(dir, 0.0005);
      const t = this.physics.exitDistance(hit.collider, inside, dir, Math.max(0.01, thickness * 6 + 0.05));
      if (t != null) thickness = Math.max(0.0005, t + 0.0005);
    }
    const outcome = B.impactOutcome(p, [n.x, n.y, n.z], material, thickness, p.rng);
    const info = { point: hit.point.clone(), normal: n.clone(), dir: dir.clone(), energy, momentum, speed: v, cart: p.tag.cart, outcome, material: desc.material, name: desc.name, dist: hit.point.distanceTo(p.origin), tof: p.t, projectile: p };
    p.impacts.push(info); p.shot.impacts.push({ name: desc.name, material: desc.material, dist: info.dist, tof: p.t, speed: v, energy, outcome: outcome.type, depth: outcome.depth, grazingDeg: outcome.grazingDeg, point: info.point.clone(), target: desc.target?.name });
    // target reaction + effects + sound
    let splash = false;
    if (desc.target?.onHit) { const r = desc.target.onHit(info); splash = !!r?.splash; }
    this.effects.impact(info.point, n, desc.material, outcome, energy);
    this.playImpactSound(desc, info, outcome, splash);
    this.hooks.onImpact?.(info);
    // update projectile state
    if (outcome.type === 'stop') { p.alive = false; p.pos[0] = hit.point.x; p.pos[1] = hit.point.y; p.pos[2] = hit.point.z; return; }
    const vExit = outcome.vExit;
    if (vExit < 20) { p.alive = false; p.pos[0] = hit.point.x; p.pos[1] = hit.point.y; p.pos[2] = hit.point.z; return; }
    const od = outcome.dir;
    if (outcome.type === 'penetrate') {
      // continue from the exit point
      const ex = hit.point.x + dir.x * outcome.depth, ey = hit.point.y + dir.y * outcome.depth, ez = hit.point.z + dir.z * outcome.depth;
      p.pos[0] = ex + od[0] * 0.002; p.pos[1] = ey + od[1] * 0.002; p.pos[2] = ez + od[2] * 0.002;
      p.penetrations++; if (material.hard || outcome.depth > 0.02) p.deformed = true;
    } else {
      p.pos[0] = hit.point.x + n.x * 0.003 + od[0] * 0.002; p.pos[1] = hit.point.y + n.y * 0.003 + od[1] * 0.002; p.pos[2] = hit.point.z + n.z * 0.003 + od[2] * 0.002;
      p.ricochets++; p.deformed = true; p.stable = false;
    }
    p.vel[0] = od[0] * vExit; p.vel[1] = od[1] * vExit; p.vel[2] = od[2] * vExit;
    p.prevPos[0] = p.pos[0]; p.prevPos[1] = p.pos[1]; p.prevPos[2] = p.pos[2];
    p.path.push(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]));
  }

  playImpactSound(desc, info, outcome, splash) {
    const a = this.audio; const pos = info.point; const e = Math.min(1, info.energy / 1800);
    const target = desc.target;
    if (desc.material === 'ar500' || desc.material === 'steel') {
      const name = target?.gong ? 'gong' : (target?.dia && target.dia <= 0.26) ? 'plate' : target ? 'steelDing' : 'metal';
      a.play(name, { pos, gain: 0.5 + 0.5 * e, pitch: (target?.dia ? 0.3 / target.dia : 1) ** 0.35 * (0.95 + Math.random() * 0.1), refDistance: 6, rolloff: 0.7, echo: 0.3 });
    } else {
      const map = { soil: 'dirt', gravel: 'dirt', concrete: 'concrete', plywood: 'wood', pine: 'wood', paper: 'paper', rubber: 'rubber', aluminum: 'metal', polymer: 'rubber' };
      a.play(map[desc.material] || 'dirt', { pos, gain: 0.4 + 0.6 * e, pitch: 0.9 + Math.random() * 0.2, refDistance: 3, rolloff: 0.9 });
    }
    if (outcome.type === 'ricochet') a.play('ricochet', { pos, gain: 0.5, pitch: 0.85 + Math.random() * 0.3, refDistance: 4 });
    void splash;
  }
}

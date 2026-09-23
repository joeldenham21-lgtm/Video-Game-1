// Enemy system: spawning (warp-in), AI behaviours, damage/stagger/shatter, hit queries.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, damp, rand, pick, chance, raySphere, TAU, wrapAngle, DEG } from '../util.js';
import { buildMite, buildSentinel, buildLancer, buildBrute, buildWarden, buildBubble } from './enemyModels.js';
import { P } from './player.js';

export const TYPES = {
  mite:     { hp: 22,  radius: 0.45, mass: 0.6, speed: 11, score: 60,  build: buildMite,     stagger: false, hover: 2.2, name: 'MITE', threat: 1 },
  sentinel: { hp: 120, radius: 0.85, mass: 2,   speed: 6,  score: 150, build: buildSentinel, stagger: 0.28, hover: 2.8, name: 'SENTINEL', threat: 3 },
  lancer:   { hp: 85,  radius: 0.7,  mass: 1.5, speed: 7,  score: 180, build: buildLancer,   stagger: 0.3, hover: 5.5, name: 'LANCER', threat: 3.5 },
  brute:    { hp: 540, radius: 1.45, mass: 8,   speed: 4.6, score: 450, build: buildBrute,   stagger: 0.3, hover: 1.05, name: 'BRUTE', threat: 8 },
  warden:   { hp: 170, radius: 0.95, mass: 2.5, speed: 6.5, score: 260, build: buildWarden,  stagger: 0.3, hover: 4.2, name: 'WARDEN', threat: 5 },
};

// Hit spheres in local space (x right, y up, z = -forward) [x, y, z, r, part]
const HIT = {
  mite: [[0, 0, 0, 0.42, 'body'], [0, 0, -0.42, 0.16, 'core']],
  sentinel: [[0, 0, 0, 0.78, 'body'], [0, 0, -0.5, 0.26, 'core']],
  lancer: [[0, 0.8, 0, 0.42, 'body'], [0, -0.1, 0, 0.5, 'body'], [0, -0.9, 0, 0.38, 'body'], [0, 0.1, -0.28, 0.26, 'core']],
  brute: [[0, 0.1, -1.38, 1.18, 'shield'], [0, 0, -0.2, 1.1, 'body'], [0, 0, 0.55, 1.05, 'body'], [0, 0.15, 1.12, 0.42, 'core']],
  warden: [[0, 0, 0, 0.95, 'body'], [0, 0, 0, 0.36, 'core']],
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export function createEnemies() {
  const group = new THREE.Group();
  G.scene.add(group);
  const list = [];
  const hitList = [];

  function spawn(type, x, y, z, opts = {}) {
    const def = TYPES[type];
    const elite = !!opts.elite;
    const model = def.build(elite);
    const scale = elite ? 1.15 : 1;
    model.root.scale.setScalar(0.01);
    group.add(model.root);
    const run = G.run || { floor: 1 };
    const hpMul = (G.director?.hpMul() ?? 1) * (elite ? 1.9 : 1);
    const e = {
      type, def, elite, alive: true, warp: opts.delay ? 0.9 + opts.delay : 0.9, delay: opts.delay || 0,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), yaw: Math.random() * TAU,
      hp: def.hp * hpMul, maxHp: def.hp * hpMul, radius: def.radius * scale, scale,
      model, root: model.root, flash: 0, staggered: false, staggerT: 0, staggerUsed: false, stunT: 0,
      aimPoint: new THREE.Vector3(x, y, z), state: 'idle', t: rand(0.5, 1.5), cool: rand(1.5, 3), los: true, losT: 0,
      speedMul: elite ? 1.2 : 1, rateMul: elite ? 1.3 : 1, bubble: null, bubbleHp: 0, lastHurtSound: 0,
      hitSpheres: HIT[type].map(h => ({ x: h[0] * scale, y: h[1] * scale, z: h[2] * scale, r: h[3] * scale, part: h[4], abs: !!h[5] })),
      strafe: chance(0.5) ? 1 : -1, orbitA: Math.random() * TAU, dmgMul: G.director?.dmgMul() ?? 1,
      id: Math.random(),
    };
    e.damage = (amount, info) => damage(e, amount, info);
    e.root.position.copy(e.pos);
    list.push(e);
    if (!opts.silent) {
      G.particles?.warpIn({ x, y: y - def.hover * 0.6, z }, 3 + def.radius * 2, elite ? 0xffd070 : 0xbfe8ff);
      G.beams?.add(x, y - 3, z, x, y + 5, z, elite ? 0xffc050 : 0x9fe8ff, 3, 0.35 + def.radius * 0.3, 0.9 + e.delay, 'fade', 0);
      G.audio?.play('enemyWarpIn', { pos: e.pos, volume: 0.8 });
      G.lights?.flash(e.pos, 0x9fe8ff, 12, 10, 0.4);
    }
    G.events.emit('enemySpawned', e);
    return e;
  }

  function updateAimPoint(e) {
    const core = e.hitSpheres.find(h => h.part === 'core');
    const body = e.hitSpheres.find(h => h.part === 'body');
    const h = (e.type === 'brute' ? body : core) || body;
    localToWorld(e, h, e.aimPoint);
  }

  function localToWorld(e, h, out) {
    if (h.abs) return out.set(h.x, h.y, h.z); // world-space sphere driven by the AI (boss parts)
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    // yaw rotation about Y; local -z is forward
    out.set(e.pos.x + h.x * c + h.z * s, e.pos.y + h.y, e.pos.z - h.x * s + h.z * c);
    return out;
  }

  // ---------------- queries ----------------
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null, bt = maxDist;
    for (const e of list) {
      if (!e.alive || e.warp > 0) continue;
      const bx = e.pos.x - ox, by = e.pos.y - oy, bz = e.pos.z - oz;
      const proj = bx * dx + by * dy + bz * dz;
      if (proj < -3 || proj > bt + 3) continue;
      const bound = e.radius * 1.9 + 0.6;
      const px = bx - dx * proj, py = by - dy * proj, pz = bz - dz * proj;
      if (px * px + py * py + pz * pz > bound * bound) continue;
      for (const h of e.hitSpheres) {
        localToWorld(e, h, tmpV);
        const t = raySphere(ox, oy, oz, dx, dy, dz, tmpV.x, tmpV.y, tmpV.z, h.r);
        if (t >= 0 && t < bt) { bt = t; best = { enemy: e, part: h.part, t }; }
      }
      if (e.bubble) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, e.pos.x, e.pos.y, e.pos.z, e.radius * 1.6);
        if (t >= 0 && t <= bt + 0.01) { bt = t; best = { enemy: e, part: 'bubble', t }; }
      }
    }
    if (best) { best.x = ox + dx * best.t; best.y = oy + dy * best.t; best.z = oz + dz * best.t; }
    return best;
  }

  function raycastAll(ox, oy, oz, dx, dy, dz, maxDist) {
    hitList.length = 0;
    for (const e of list) {
      if (!e.alive || e.warp > 0) continue;
      let bt = Infinity, part = null;
      for (const h of e.hitSpheres) {
        localToWorld(e, h, tmpV);
        const t = raySphere(ox, oy, oz, dx, dy, dz, tmpV.x, tmpV.y, tmpV.z, h.r * 1.15);
        if (t >= 0 && t < bt && t < maxDist) { bt = t; part = h.part === 'shield' ? 'body' : h.part; }
      }
      // piercing shots prefer the core if the line passes through it
      const core = e.hitSpheres.find(h => h.part === 'core');
      if (core && part) {
        localToWorld(e, core, tmpV);
        if (raySphere(ox, oy, oz, dx, dy, dz, tmpV.x, tmpV.y, tmpV.z, core.r * 1.3) >= 0) part = 'core';
      }
      if (part) hitList.push({ enemy: e, part, t: bt, x: ox + dx * bt, y: oy + dy * bt, z: oz + dz * bt });
    }
    hitList.sort((a, b) => a.t - b.t);
    return hitList.slice();
  }

  function findStaggered(eye, fwd, range, cone) {
    let best = null, bd = Infinity;
    for (const e of list) {
      if (!e.alive || !e.staggered) continue;
      const dx = e.aimPoint.x - eye.x, dy = e.aimPoint.y - eye.y, dz = e.aimPoint.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range + e.radius) continue;
      const a = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / d, -1, 1));
      const tol = cone + Math.atan(e.radius / Math.max(d, 0.1));
      if (a > tol) continue;
      if (!G.world.lineOfSight(eye.x, eye.y, eye.z, e.aimPoint.x, e.aimPoint.y, e.aimPoint.z)) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function meleeSweep(eye, fwd, range, cone) {
    let n = 0;
    const dmg = 48 * (G.augments?.mods.meleeDamage ?? 1);
    for (const e of list) {
      if (!e.alive || e.warp > 0) continue;
      const dx = e.aimPoint.x - eye.x, dy = e.aimPoint.y - eye.y, dz = e.aimPoint.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range + e.radius) continue;
      const a = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 0.01), -1, 1));
      if (a > cone && d > e.radius + 0.6) continue;
      if (e.staggered) { shatter(e); n++; continue; }
      const res = damage(e, dmg, { part: 'body', x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z, dir: tmpV2.set(dx / d, dy / d, dz / d), source: 'melee', knock: 12, crit: false });
      reportHit(e, { dmg: res.dealt, crit: false, killed: res.killed, x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z });
      n++;
    }
    return n;
  }

  // ---------------- damage ----------------
  function damage(e, amount, info) {
    if (!e.alive || e.warp > 0) return { dealt: 0, killed: false };
    if (e.invuln) {
      if (G.time - e.lastHurtSound > 0.12) { G.audio?.play('shieldHit', { pos: info, volume: 0.6 }); e.lastHurtSound = G.time; }
      G.particles?.energyHit(info, 0x7fd8ff, 3);
      return { dealt: 0, killed: false, shielded: true };
    }
    if (e.def.onDamage) amount = e.def.onDamage(e, amount, info);
    let shielded = false;
    if (e.bubble) {
      // warden bubble soaks damage
      const soak = Math.min(e.bubbleHp, amount);
      e.bubbleHp -= soak; amount -= soak; shielded = true;
      e.bubble.material.uniforms.uHit.value = 1;
      if (e.bubbleHp <= 0) popBubble(e);
      if (amount <= 0) {
        if (G.time - e.lastHurtSound > 0.12) { G.audio?.play('shieldHit', { pos: e.pos, volume: 0.6 }); e.lastHurtSound = G.time; }
        G.particles?.energyHit(info, 0x7fd8ff, 4);
        return { dealt: 0, killed: false, shielded: true };
      }
    }
    if (info.part === 'shield' && !(e.stunT > 0)) {
      amount *= info.source === 'lance' ? 0.45 : 0.12;
      shielded = true;
      if (G.time - e.lastHurtSound > 0.1) { G.audio?.play('shieldHit', { pos: info, volume: 0.7 }); e.lastHurtSound = G.time; }
      G.particles?.sparks(info, { x: -info.dir.x, y: -info.dir.y + 0.3, z: -info.dir.z }, 0xffe0a0, 6, 8, 3);
    } else if (e.stunT > 0 && e.type === 'brute') {
      amount *= 1.5;
    }
    if (e.staggered) amount *= 1.3;
    const dealt = Math.min(e.hp, amount);
    e.hp -= amount;
    e.flash = 1;
    G.player.damageDealt += dealt;
    G.player.addOverdrive(dealt * 0.05);
    G.augments?.onHit(e, dealt, info);
    // knockback
    if (info.dir && info.knock) {
      const k = info.knock / e.def.mass;
      e.vel.x += info.dir.x * k; e.vel.y += info.dir.y * k * 0.4; e.vel.z += info.dir.z * k;
    }
    if (!shielded) G.particles?.energyHit(info, info.crit ? 0xffd257 : 0xbfe8ff, info.crit ? 8 : 4, info.crit);
    if (G.time - e.lastHurtSound > 0.15 && !shielded) { G.audio?.play('enemyHurt', { pos: e.pos, volume: 0.5 }); e.lastHurtSound = G.time; }

    if (e.hp <= 0) {
      kill(e, info);
      return { dealt, killed: true, shielded };
    }
    // stagger threshold
    if (e.def.stagger && !e.staggerUsed && e.hp <= e.maxHp * e.def.stagger) {
      e.staggered = true; e.staggerUsed = true; e.staggerT = 3.6;
      e.state = 'stagger';
      if (e.lancerBeam) { e.lancerBeam.dead = true; e.lancerBeam = null; }
      G.events.emit('enemyStaggered', e);
    }
    return { dealt, killed: false, shielded };
  }

  // Aggregated per-shot feedback (hitmarkers, numbers, sounds)
  function reportHit(e, info) {
    if (info.dmg <= 0 && !info.shielded) return;
    const kind = info.killed ? 'kill' : info.crit ? 'crit' : info.shielded ? 'shield' : 'hit';
    G.hud?.hitmarker(kind);
    if (info.dmg > 0) G.hud?.damageNumber(info.x, info.y + 0.2, info.z, info.dmg, info.crit);
    if (!info.killed) G.audio?.play(info.crit ? 'crit' : 'hit', { volume: info.crit ? 0.8 : 0.55 });
  }

  function kill(e, info = {}) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const big = e.type === 'brute';
    const p = e.aimPoint.clone();
    updateAimPoint(e);
    G.particles?.deathBurst(e.pos, e.elite ? 0xffd257 : 0xbfe8ff, big ? 2.2 : e.type === 'mite' ? 0.7 : 1.2);
    G.debris?.burst(e.pos, big ? 26 : e.type === 'mite' ? 6 : 14, 0xe4e8ee, big ? 9 : 7, big ? 0.22 : 0.13, 0xff5a2a);
    G.lights?.flash(e.pos, 0xbfe8ff, big ? 40 : 18, big ? 16 : 10, 0.25);
    G.audio?.play(big ? 'enemyDeathBig' : 'enemyDeath', { pos: e.pos });
    G.audio?.play('kill', { volume: 0.8 });
    if (info.crit) G.audio?.play('crit', { volume: 0.5 });
    if (e.bubble) popBubble(e);
    if (e.lancerBeam) { e.lancerBeam.dead = true; e.lancerBeam = null; }
    if (e.tethers) for (const t of e.tethers) t.beam.dead = true;
    for (const o of list) if (o.bubbleOwner === e && o.bubble) popBubble(o);
    if (!e.def.keepRoot) group.remove(e.root);
    G.player.kills++;
    G.player.addOverdrive(e.type === 'mite' ? 4 : big ? 14 : 8);
    const ctx = { enemy: e, source: info.source, crit: !!info.crit, shatter: !!info.shatter, airborne: !G.player.grounded, deflect: info.source === 'deflect', pos: p, elite: e.elite };
    G.pickups?.onKill(e, ctx);
    G.events.emit('enemyKilled', ctx);
    G.player.addTrauma(big ? 0.25 : 0.06);
    if ((big || e.elite) && info.source !== 'boss') G.hitstop = Math.max(G.hitstop, 0.06);
  }

  function shatter(e) {
    if (!e.alive) return;
    const p = e.aimPoint.clone();
    if (e.def.boss) {
      // bosses take a heavy chunk instead of dying outright
      e.staggered = false; e.staggerT = 0;
      G.hitstop = Math.max(G.hitstop, 0.1);
      G.slowmo = Math.max(G.slowmo, 0.35);
      G.audio?.play('shatter');
      G.particles?.explosion(p, 4, 0xbfe8ff, true);
      G.debris?.burst(p, 30, 0xe4e8ee, 12, 0.2, 0xff6a2a);
      G.renderer.post.uFlash.value = 0.4;
      G.player.addTrauma(0.4);
      G.player.addOverdrive(25);
      G.pickups?.drop('health', p.x, p.y, p.z, 4);
      const res = damage(e, e.maxHp * (e.def.shatterFrac || 0.08), { part: 'core', x: p.x, y: p.y, z: p.z, dir: null, source: 'melee', crit: true });
      reportHit(e, { dmg: res.dealt, crit: true, killed: res.killed, x: p.x, y: p.y, z: p.z });
      G.events.emit('bossShattered', e);
      return;
    }
    G.hitstop = Math.max(G.hitstop, 0.085);
    G.slowmo = Math.max(G.slowmo, 0.22);
    G.audio?.play('shatter');
    G.particles?.explosion(p, 3, 0xbfe8ff);
    G.debris?.burst(p, 24, 0xe4e8ee, 11, 0.16, 0xff6a2a);
    G.renderer.post.uFlash.value = 0.35;
    G.renderer.post.uFlashColor.value.set(0xbfe8ff);
    G.player.addTrauma(0.3);
    G.player.addOverdrive(18);
    G.input.vibrate(35);
    G.hud?.hitmarker('kill');
    kill(e, { source: 'melee', shatter: true });
  }

  function damageRadius(pos, radius, dmg, source = 'nova', knock = 10, owner = 'player') {
    let hits = 0;
    for (const e of list) {
      if (!e.alive || e.warp > 0) continue;
      const d = e.pos.distanceTo(pos) - e.radius * 0.7;
      if (d > radius) continue;
      const f = clamp(1 - d / radius, 0.25, 1);
      tmpV2.subVectors(e.pos, pos).normalize();
      const res = damage(e, dmg * f, { part: 'body', x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z, dir: tmpV2, source, knock: knock * f, crit: false });
      reportHit(e, { dmg: res.dealt, crit: false, killed: res.killed, x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z });
      hits++;
    }
    return hits;
  }

  function popBubble(e) {
    if (!e.bubble) return;
    G.particles?.deathBurst(e.pos, 0x7fd8ff, 0.8);
    G.audio?.play('shieldBreak', { pos: e.pos, volume: 0.6 });
    e.root.remove(e.bubble);
    e.bubble = null; e.bubbleHp = 0;
    if (e.bubbleOwner?.tethers) {
      const t = e.bubbleOwner.tethers.find(t => t.target === e);
      if (t) { t.beam.dead = true; e.bubbleOwner.tethers.splice(e.bubbleOwner.tethers.indexOf(t), 1); }
    }
    e.bubbleOwner = null;
  }

  // ---------------- movement helpers ----------------
  function steer(e, tx, ty, tz, speed, dt, sharp = 3) {
    const dx = tx - e.pos.x, dy = ty - e.pos.y, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const s = Math.min(speed, d * 2.5);
    const k = 1 - Math.exp(-sharp * dt);
    e.vel.x += (dx / d * s - e.vel.x) * k;
    e.vel.y += (dy / d * s - e.vel.y) * k;
    e.vel.z += (dz / d * s - e.vel.z) * k;
  }

  function groundBelow(x, z, y) {
    const g = G.world.groundHeight(x, z, 0.3, y + 0.5);
    return g === -Infinity ? null : g;
  }

  function integrate(e, dt, hover = true) {
    // separation
    for (const o of list) {
      if (o === e || !o.alive) continue;
      const dx = e.pos.x - o.pos.x, dy = e.pos.y - o.pos.y, dz = e.pos.z - o.pos.z;
      const min = e.radius + o.radius + 0.2;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d * 4 * dt * (o.def.mass / (e.def.mass + o.def.mass)) * 2;
        e.vel.x += dx * push * 6; e.vel.y += dy * push * 2; e.vel.z += dz * push * 6;
      }
    }
    // keep inside the arena volume
    const r = Math.hypot(e.pos.x, e.pos.z);
    const bounds = G.arena.bounds;
    if (r > bounds) { e.vel.x -= e.pos.x / r * (r - bounds) * 3 * dt * 10; e.vel.z -= e.pos.z / r * (r - bounds) * 3 * dt * 10; }
    if (e.pos.y > 22) e.vel.y -= (e.pos.y - 22) * dt * 10;
    e.pos.addScaledVector(e.vel, dt);
    // world collision
    G.world.pushSphere(e.pos, e.radius * 0.85, e.vel);
    if (hover) {
      const g = groundBelow(e.pos.x, e.pos.z, e.pos.y);
      if (g !== null && e.pos.y < g + e.radius * 0.8) { e.pos.y = g + e.radius * 0.8; if (e.vel.y < 0) e.vel.y = 0; }
    }
    if (e.pos.y < -20) kill(e, { source: 'void' });
  }

  function faceYaw(e, tx, tz, rate, dt) {
    const target = Math.atan2(-(tx - e.pos.x), -(tz - e.pos.z));
    e.yaw += wrapAngle(target - e.yaw) * Math.min(1, rate * dt);
  }

  function hasLOS(e, dt) {
    e.losT -= dt;
    if (e.losT <= 0) {
      e.losT = 0.2 + Math.random() * 0.15;
      const eye = G.player.eyePos;
      e.los = G.world.lineOfSight(e.aimPoint.x, e.aimPoint.y, e.aimPoint.z, eye.x, eye.y - 0.2, eye.z);
    }
    return e.los;
  }

  // lead the target: where will the player be when a projectile of this speed arrives?
  function leadTarget(from, speed, out, amount = 0.7) {
    const pl = G.player;
    const tx = pl.pos.x, ty = pl.pos.y + 1.1, tz = pl.pos.z;
    const d = Math.hypot(tx - from.x, ty - from.y, tz - from.z);
    const t = d / speed * amount;
    out.set(tx + pl.vel.x * t, ty + Math.max(-2, pl.vel.y * t * 0.3), tz + pl.vel.z * t);
    return out;
  }

  // ---------------- behaviours ----------------
  const AI = {
    mite(e, dt) {
      const pl = G.player;
      const ep = pl.eyePos;
      e.t -= dt;
      const parts = e.model.parts;
      parts.spin.rotation.z += dt * 6;
      if (e.state === 'idle' || e.state === 'orbit') {
        e.state = 'orbit';
        e.orbitA += dt * 0.9 * e.strafe;
        const R = 7 + Math.sin(e.id * 50 + G.worldTime) * 2;
        const tx = pl.pos.x + Math.cos(e.orbitA) * R, tz = pl.pos.z + Math.sin(e.orbitA) * R;
        const ty = pl.pos.y + 2.5 + Math.sin(G.worldTime * 1.3 + e.id * 9) * 1.5;
        steer(e, tx, ty, tz, e.def.speed * 0.8 * e.speedMul, dt, 2.5);
        // only a few dive at once
        const diving = list.filter(o => o.alive && o.type === 'mite' && (o.state === 'windup' || o.state === 'dive')).length;
        if (e.t <= 0 && diving < 2 + Math.floor((G.run?.floor || 1) / 3)) {
          e.state = 'windup'; e.t = 0.55;
          G.audio?.play('miteScreech', { pos: e.pos, volume: 0.8 });
        } else if (e.t <= 0) e.t = rand(0.5, 1.5);
      } else if (e.state === 'windup') {
        e.vel.multiplyScalar(Math.exp(-4 * dt));
        e.root.position.x += rand(-0.03, 0.03);
        e.model.coreMat.color.setRGB(6, 2.5, 1.2);
        if (e.t <= 0) {
          e.state = 'dive'; e.t = 1.6;
          leadTarget(e.pos, 18, tmpV, 0.5);
          tmpV.sub(e.pos).normalize().multiplyScalar(18 * e.speedMul);
          e.vel.copy(tmpV);
        }
      } else if (e.state === 'dive') {
        // slight homing
        tmpV.set(ep.x, ep.y - 0.4, ep.z).sub(e.pos);
        const d = tmpV.length();
        tmpV.normalize().multiplyScalar(19 * e.speedMul);
        e.vel.lerp(tmpV, Math.min(1, dt * 1.6));
        if (d < 1.05) {
          pl.damage(12 * e.dmgMul, e.pos, 'mite');
          G.particles?.explosion(e.pos, 1.6, 0xff7a3a);
          G.audio?.play('miteExplode', { pos: e.pos });
          kill(e, { source: 'self' });
          return;
        }
        if (e.t <= 0) { e.state = 'orbit'; e.t = rand(1.5, 3); e.model.coreMat.color.set(0xff4a2a).multiplyScalar(4.5); }
      }
      integrate(e, dt, false);
      const g = groundBelow(e.pos.x, e.pos.z, e.pos.y);
      if (g !== null && e.pos.y < g + 0.5) { e.pos.y = g + 0.5; e.vel.y = Math.abs(e.vel.y) * 0.5; }
      // ember trail keeps these small, fast targets readable
      e.trailT = (e.trailT || 0) - dt;
      if (e.trailT <= 0) { e.trailT = e.state === 'dive' ? 0.02 : 0.06; G.particles?.trail(e.aimPoint, e.state === 'orbit' ? 0xff7a4a : 0xffb070, 0.22, 0.28, e.state === 'orbit' ? 1.6 : 3); }
      // face velocity
      const sp = Math.hypot(e.vel.x, e.vel.z);
      if (sp > 0.5) e.yaw += wrapAngle(Math.atan2(-e.vel.x, -e.vel.z) - e.yaw) * Math.min(1, dt * 8);
    },

    sentinel(e, dt) {
      const pl = G.player;
      const parts = e.model.parts;
      parts.halo.rotation.x += dt * 0.8; parts.halo.rotation.y += dt * 1.3;
      const toP = tmpV.set(pl.pos.x - e.pos.x, 0, pl.pos.z - e.pos.z);
      const dist = toP.length() || 1;
      toP.divideScalar(dist);
      const los = hasLOS(e, dt);
      // preferred range 11-18, strafe sideways
      if (chance(dt * 0.35)) e.strafe *= -1;
      const want = dist > 18 ? 1 : dist < 10 ? -1 : 0;
      const g = groundBelow(e.pos.x, e.pos.z, e.pos.y);
      const ty = (g ?? pl.pos.y) + e.def.hover + Math.sin(G.worldTime * 0.9 + e.id * 7) * 0.6;
      const sx = -toP.z * e.strafe, sz = toP.x * e.strafe;
      const tx = e.pos.x + toP.x * want * 4 + sx * 3, tz = e.pos.z + toP.z * want * 4 + sz * 3;
      steer(e, tx, ty, tz, e.def.speed * e.speedMul * (los ? 1 : 1.4), dt, 2);
      faceYaw(e, pl.pos.x, pl.pos.z, 5, dt);
      // attack
      e.cool -= dt * e.rateMul;
      let open = 0;
      if (e.state === 'idle' && e.cool <= 0 && los && dist < 34) {
        e.state = 'windup'; e.t = 0.65;
        G.audio?.play('sentinelCharge', { pos: e.pos, volume: 0.8 });
      }
      if (e.state === 'windup') {
        e.t -= dt; open = 1 - e.t / 0.65;
        e.model.coreMat.color.setRGB(4.5 + open * 4, 1.3 + open * 2, 0.8 + open);
        if (e.t <= 0) { e.state = 'burst'; e.shots = e.elite ? 5 : 3; e.t = 0; }
      } else if (e.state === 'burst') {
        open = 1;
        e.t -= dt;
        if (e.t <= 0) {
          e.t = 0.17;
          e.shots--;
          localToWorld(e, e.hitSpheres[1], tmpV2);
          leadTarget(tmpV2, 15, tmpV, 0.65);
          tmpV.sub(tmpV2).normalize();
          tmpV.x += rand(-0.03, 0.03); tmpV.y += rand(-0.02, 0.02);
          G.projectiles?.orb(tmpV2, tmpV.normalize().multiplyScalar(15), 11 * e.dmgMul, e);
          G.audio?.play('orbFire', { pos: tmpV2, volume: 0.7 });
          if (e.shots <= 0) { e.state = 'idle'; e.cool = rand(2.2, 3.2); e.model.coreMat.color.set(0xff4a2a).multiplyScalar(4.5); }
        }
      }
      for (const p of parts.petals) p.rotation.x = -0.35 - open * 0.55;
      integrate(e, dt);
    },

    lancer(e, dt) {
      const pl = G.player;
      const parts = e.model.parts;
      parts.orbit.rotation.y += dt * 2;
      const los = hasLOS(e, dt);
      const eye = pl.eyePos;
      faceYaw(e, pl.pos.x, pl.pos.z, 3, dt);
      // drift around a high perch
      if (!e.perch || e.state === 'relocate') {
        const pts = G.arena.spawns.high;
        const p = pick(pts);
        e.perch = new THREE.Vector3(p[0] + rand(-1.5, 1.5), p[1] + e.def.hover * 0.5 + rand(0, 1.5), p[2] + rand(-1.5, 1.5));
        if (e.state === 'relocate') {
          // blink
          G.particles?.warpIn(e.pos, 2.5, 0xff8fa0);
          e.pos.copy(e.perch);
          G.particles?.warpIn(e.pos, 2.5, 0xff8fa0);
          G.audio?.play('teleport', { pos: e.pos, volume: 0.5 });
          e.state = 'idle'; e.cool = rand(1.2, 2);
        }
      }
      steer(e, e.perch.x + Math.sin(G.worldTime * 0.7 + e.id * 5) * 1.2, e.perch.y + Math.sin(G.worldTime * 1.1) * 0.4, e.perch.z, e.def.speed * 0.5, dt, 1.5);
      e.cool -= dt * e.rateMul;
      if (e.state === 'idle' && e.cool <= 0 && los) {
        e.state = 'aim'; e.t = 1.55 / e.rateMul;
        e.aimAt = new THREE.Vector3(eye.x, eye.y - 0.3, eye.z);
        localToWorld(e, { x: 0, y: 1.25 * e.scale, z: 0 }, tmpV2);
        e.lancerBeam = G.beams?.add(tmpV2.x, tmpV2.y, tmpV2.z, e.aimAt.x, e.aimAt.y, e.aimAt.z, 0xff2040, 1.2, 0.02, 1, 'hold');
        e.chargeLoop = G.audio?.loop('lancerBeam', { pos: e.pos, volume: 0.9 });
        G.audio?.play('lancerCharge', { pos: e.pos, volume: 1 });
        G.events.emit('lancerAiming', e);
      }
      if (e.state === 'aim') {
        e.t -= dt;
        const locked = e.t < 0.35;
        if (!locked) e.aimAt.lerp(tmpV.set(eye.x, eye.y - 0.3, eye.z), Math.min(1, dt * 7));
        localToWorld(e, { x: 0, y: 1.25 * e.scale, z: 0 }, tmpV2);
        const k = 1 - Math.max(0, e.t) / 1.55;
        if (e.lancerBeam) {
          const b = e.lancerBeam;
          // extend the line past the target so it reads as a sightline
          tmpV.subVectors(e.aimAt, tmpV2).normalize();
          b.sx = tmpV2.x; b.sy = tmpV2.y; b.sz = tmpV2.z;
          b.ex = tmpV2.x + tmpV.x * 90; b.ey = tmpV2.y + tmpV.y * 90; b.ez = tmpV2.z + tmpV.z * 90;
          const wh = G.world.raycast(tmpV2.x, tmpV2.y, tmpV2.z, tmpV.x, tmpV.y, tmpV.z, 90);
          if (wh) { b.ex = wh.x; b.ey = wh.y; b.ez = wh.z; }
          const blink = locked ? (Math.sin(G.time * 60) > 0 ? 1 : 0.4) : 1;
          b.r = 3 * (0.3 + k); b.g = 0.2 * k; b.b = 0.5 * k; b.width = 0.012 + k * 0.03; b.alpha = blink;
        }
        e.chargeLoop?.setPitch?.(0.8 + k * 0.8);
        e.chargeLoop?.setPos?.(e.pos);
        parts.tip.scale.setScalar(1 + k * 1.5);
        e.model.coreMat.color.setRGB(4 + k * 5, 1 + k * 2, 1 + k);
        if (e.t <= 0) {
          // fire along the locked line
          tmpV.subVectors(e.aimAt, tmpV2).normalize();
          const wh = G.world.raycast(tmpV2.x, tmpV2.y, tmpV2.z, tmpV.x, tmpV.y, tmpV.z, 120);
          const maxT = wh ? wh.t : 120;
          // player capsule test
          const pp = G.player.pos;
          let hitP = false;
          for (let s = 0; s <= 1.6; s += 0.4) {
            const t = raySphere(tmpV2.x, tmpV2.y, tmpV2.z, tmpV.x, tmpV.y, tmpV.z, pp.x, pp.y + 0.2 + s, pp.z, P.radius + 0.12);
            if (t >= 0 && t < maxT) { hitP = true; break; }
          }
          const endT = maxT;
          G.beams?.add(tmpV2.x, tmpV2.y, tmpV2.z, tmpV2.x + tmpV.x * endT, tmpV2.y + tmpV.y * endT, tmpV2.z + tmpV.z * endT, 0xff3050, 6, 0.12, 0.3, 'fade', 0.05);
          G.beams?.add(tmpV2.x, tmpV2.y, tmpV2.z, tmpV2.x + tmpV.x * endT, tmpV2.y + tmpV.y * endT, tmpV2.z + tmpV.z * endT, 0xffffff, 3, 0.03, 0.2, 'fade', 0);
          G.audio?.play('lancerFire', { pos: e.pos });
          if (wh) G.particles?.sparks(wh, { x: wh.nx, y: wh.ny, z: wh.nz }, 0xff4060, 10, 8, 3);
          if (hitP) G.player.damage(26 * e.dmgMul, e.pos, 'lancer');
          if (e.lancerBeam) { e.lancerBeam.dead = true; e.lancerBeam = null; }
          e.chargeLoop?.stop(0.05); e.chargeLoop = null;
          parts.tip.scale.setScalar(1);
          e.model.coreMat.color.set(0xff4a2a).multiplyScalar(4.5);
          e.state = chance(0.55) ? 'relocate' : 'idle';
          e.cool = rand(2.6, 3.6);
        }
      }
      integrate(e, dt, false);
    },

    brute(e, dt) {
      const pl = G.player;
      const parts = e.model.parts;
      const toP = tmpV.set(pl.pos.x - e.pos.x, 0, pl.pos.z - e.pos.z);
      const dist = toP.length() || 1;
      toP.divideScalar(dist);
      const g = groundBelow(e.pos.x, e.pos.z, e.pos.y + 1);
      const floorY = g ?? pl.pos.y;
      const hoverY = floorY + e.def.hover + Math.sin(G.worldTime * 2 + e.id) * 0.08;
      for (const j of parts.jets) j.scale.setScalar(1.2 + Math.sin(G.time * 30 + j.id) * 0.25 + (e.state === 'charge' ? 1.2 : 0));
      if (e.stunT > 0) {
        e.stunT -= dt;
        e.vel.multiplyScalar(Math.exp(-5 * dt));
        e.root.rotation.z = Math.sin(G.time * 20) * 0.04;
        parts.shield.position.y = 0.05 - 0.35;
        parts.shield.rotation.x = 0.5;
        e.model.coreMat.color.setRGB(7, 3, 1.5);
        if (e.stunT <= 0) { parts.shield.position.y = 0.05; parts.shield.rotation.x = 0; e.state = 'idle'; e.cool = 1.5; e.model.coreMat.color.set(0xff4a2a).multiplyScalar(4.5); }
        integrate(e, dt);
        return;
      }
      e.cool -= dt * e.rateMul;
      const los = hasLOS(e, dt);
      if (e.state === 'idle') {
        steer(e, pl.pos.x, hoverY, pl.pos.z, e.def.speed * e.speedMul, dt, 1.5);
        e.vel.y = (hoverY - e.pos.y) * 4;
        faceYaw(e, pl.pos.x, pl.pos.z, 2.2, dt);
        if (dist < 5.5 && e.cool <= 0 && pl.pos.y < floorY + 2.5) {
          e.state = 'slamUp'; e.t = 0.6;
          G.audio?.play('bruteRev', { pos: e.pos, volume: 0.8 });
        } else if (dist < 20 && dist > 6 && e.cool <= 0 && los) {
          e.state = 'rev'; e.t = 1.0;
          G.audio?.play('bruteRev', { pos: e.pos });
        }
      } else if (e.state === 'rev') {
        e.t -= dt;
        e.vel.multiplyScalar(Math.exp(-6 * dt));
        faceYaw(e, pl.pos.x, pl.pos.z, 6, dt);
        e.root.position.x += rand(-0.04, 0.04);
        // telegraph: dust + red streaks
        if (chance(dt * 30)) G.particles?.trail({ x: e.pos.x + rand(-1, 1), y: floorY + 0.1, z: e.pos.z + rand(-1, 1) }, 0xff5030, 0.4, 0.4, 2);
        if (e.t <= 0) {
          e.state = 'charge'; e.t = 1.5;
          e.chargeDir = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
          G.audio?.play('bruteCharge', { pos: e.pos });
        }
      } else if (e.state === 'charge') {
        e.t -= dt;
        const sp = 22 * e.speedMul;
        e.vel.x = e.chargeDir.x * sp; e.vel.z = e.chargeDir.z * sp;
        e.vel.y = (hoverY - e.pos.y) * 4;
        if (chance(dt * 40)) G.particles?.sparks({ x: e.pos.x, y: floorY + 0.05, z: e.pos.z }, { x: -e.chargeDir.x, y: 0.4, z: -e.chargeDir.z }, 0xffa040, 3, 6, 2);
        // hit player
        const dx = pl.pos.x - e.pos.x, dz = pl.pos.z - e.pos.z;
        if (Math.hypot(dx, dz) < e.radius + 0.7 && Math.abs(pl.pos.y + 0.9 - e.pos.y) < 1.8) {
          if (pl.damage(32 * e.dmgMul, e.pos, 'brute')) {
            pl.vel.x += e.chargeDir.x * 18; pl.vel.z += e.chargeDir.z * 18; pl.vel.y = 7; pl.grounded = false;
          }
          e.state = 'idle'; e.cool = 2.5; e.vel.multiplyScalar(0.2);
        }
        // hit wall?
        const before = e.pos.clone();
        integrate(e, dt);
        const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z);
        if (e.state === 'charge' && (moved < sp * dt * 0.45 || Math.hypot(e.pos.x, e.pos.z) > G.arena.bounds - 1)) {
          // slammed into something: stunned, core exposed
          e.state = 'stunned'; e.stunT = 2.3;
          G.audio?.play('bruteSlam', { pos: e.pos });
          G.particles?.explosion(tmpV2.copy(e.pos).addScaledVector(e.chargeDir, e.radius), 2.2, 0xffc080);
          pl.addTrauma(0.35 * clamp(1 - dist / 25, 0, 1));
          G.events.emit('bruteStunned', e);
        }
        if (e.t <= 0 && e.state === 'charge') { e.state = 'idle'; e.cool = 2; }
        return;
      } else if (e.state === 'slamUp') {
        e.t -= dt;
        e.vel.set(0, (floorY + 3.2 - e.pos.y) * 5, 0);
        if (e.t <= 0) { e.state = 'slamDown'; e.t = 0.25; }
      } else if (e.state === 'slamDown') {
        e.vel.y = -28;
        e.t -= dt;
        if (e.pos.y <= hoverY + 0.05 || e.t <= 0) {
          e.state = 'idle'; e.cool = rand(2.5, 3.5);
          G.projectiles?.shockwave(e.pos.x, floorY, e.pos.z, 13, 14, 22 * e.dmgMul);
          G.audio?.play('bruteSlam', { pos: e.pos });
          G.particles?.ring({ x: e.pos.x, y: floorY, z: e.pos.z }, 4, 0xffb070, 40, 0.4, 3);
          G.particles?.puff({ x: e.pos.x, y: floorY, z: e.pos.z }, 10, 0x30343c, 1.4, 0.6);
          pl.addTrauma(0.4 * clamp(1 - dist / 20, 0, 1));
        }
      }
      integrate(e, dt);
    },

    warden(e, dt) {
      const pl = G.player;
      const parts = e.model.parts;
      parts.plates.rotation.y += dt * 1.2;
      parts.body.rotation.y += dt * 0.6;
      const toP = tmpV.set(pl.pos.x - e.pos.x, 0, pl.pos.z - e.pos.z);
      const dist = toP.length() || 1;
      toP.divideScalar(dist);
      // hover near the centroid of allies, away from the player
      let cx = 0, cz = 0, n = 0;
      for (const o of list) if (o.alive && o !== e && o.type !== 'warden') { cx += o.pos.x; cz += o.pos.z; n++; }
      if (n) { cx /= n; cz /= n; } else { cx = e.pos.x; cz = e.pos.z; }
      const flee = dist < 14 ? 1 : 0;
      const g = groundBelow(e.pos.x, e.pos.z, e.pos.y);
      const ty = (g ?? pl.pos.y) + e.def.hover + Math.sin(G.worldTime + e.id * 3) * 0.7;
      steer(e, cx - toP.x * (6 + flee * 8), ty, cz - toP.z * (6 + flee * 8), e.def.speed * e.speedMul, dt, 1.6);
      faceYaw(e, pl.pos.x, pl.pos.z, 2, dt);
      e.tethers = e.tethers || [];
      for (const t of e.tethers) {
        const b = t.beam;
        b.sx = e.pos.x; b.sy = e.pos.y; b.sz = e.pos.z;
        b.ex = t.target.pos.x; b.ey = t.target.pos.y; b.ez = t.target.pos.z;
        b.alpha = 0.6 + Math.sin(G.time * 8) * 0.3;
      }
      e.cool -= dt * e.rateMul;
      if (e.cool <= 0) {
        e.cool = 6;
        const cands = list.filter(o => o.alive && o !== e && o.warp <= 0 && !o.bubble && o.type !== 'warden' && o.pos.distanceTo(e.pos) < 16)
          .sort((a, b) => b.def.threat - a.def.threat).slice(0, e.elite ? 4 : 3);
        for (const o of cands) {
          o.bubble = buildBubble();
          o.bubble.scale.setScalar(o.radius * 1.6 / o.scale);
          o.root.add(o.bubble);
          o.bubbleHp = 70 * (G.director?.hpMul() ?? 1);
          o.bubbleOwner = e;
          const beam = G.beams.add(e.pos.x, e.pos.y, e.pos.z, o.pos.x, o.pos.y, o.pos.z, 0x7fd8ff, 1.5, 0.03, 1, 'hold', 0.15);
          e.tethers.push({ target: o, beam });
        }
        if (cands.length) G.audio?.play('wardenShield', { pos: e.pos });
      }
      integrate(e, dt);
    },
  };

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive) { list.splice(i, 1); continue; }
      if (e.warp > 0) {
        e.warp -= dt;
        const k = clamp(1 - (e.warp) / 0.9, 0, 1);
        const s = e.warp > 0.9 ? 0.01 : (k < 0.7 ? k / 0.7 * 1.1 : 1.1 - (k - 0.7) / 0.3 * 0.1) * e.scale;
        e.root.scale.setScalar(Math.max(0.01, s));
        e.model.shellMat.emissive.setRGB(2 * (1 - k), 2.4 * (1 - k), 3 * (1 - k));
        e.root.position.copy(e.pos);
        e.root.rotation.y = e.yaw;
        updateAimPoint(e);
        continue;
      }
      if (e.staggered && !e.def.boss) {
        e.staggerT -= dt;
        e.vel.multiplyScalar(Math.exp(-3 * dt));
        e.vel.y -= 1.5 * dt;
        integrate(e, dt, true);
        const f = Math.sin(G.time * 18) > 0;
        e.model.coreMat.color.setRGB(f ? 8 : 3, f ? 6 : 1.5, f ? 4 : 0.6);
        e.root.rotation.z = Math.sin(G.time * 9 + e.id) * 0.15;
        if (e.staggerT <= 0) {
          e.staggered = false; e.state = 'idle'; e.cool = 1.5; e.root.rotation.z = 0;
          e.model.coreMat.color.set(0xff4a2a).multiplyScalar(4.5);
        }
      } else {
        AI[e.type](e, dt, helpers);
      }
      if (!e.alive) continue;
      // hit flash decay
      e.flash = Math.max(0, e.flash - dt * 7);
      const fl = e.flash;
      e.model.shellMat.emissive.setRGB(fl * 1.4, fl * 1.5, fl * 1.7);
      if (e.bubble) {
        e.bubble.material.uniforms.uTime.value = G.time;
        e.bubble.material.uniforms.uHit.value = Math.max(0, e.bubble.material.uniforms.uHit.value - dt * 4);
      }
      e.root.position.copy(e.pos);
      e.root.rotation.y = e.yaw;
      updateAimPoint(e);
      // soft body push on the player
      const pl = G.player;
      const dx = pl.pos.x - e.pos.x, dz = pl.pos.z - e.pos.z;
      const dyc = (pl.pos.y + 0.9) - e.pos.y;
      const min = e.radius + P.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && Math.abs(dyc) < e.radius + 0.9 && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const push = (min - d);
        pl.pos.x += dx / d * push * 0.7; pl.pos.z += dz / d * push * 0.7;
      }
    }
  }

  function clear() {
    for (const e of list) {
      group.remove(e.root);
      if (e.lancerBeam) e.lancerBeam.dead = true;
      e.chargeLoop?.stop(0.05);
      if (e.tethers) for (const t of e.tethers) t.beam.dead = true;
    }
    list.length = 0;
  }

  const helpers = { steer, integrate, faceYaw, hasLOS, leadTarget, groundBelow, kill, spawn, localToWorld, updateAimPoint, list };

  // Bosses and special parts plug their own types in here
  function register(type, def, hits, ai) {
    TYPES[type] = def;
    HIT[type] = hits;
    AI[type] = ai;
  }

  return {
    list, group, spawn, update, clear, raycast, raycastAll, damage: (e, a, i) => damage(e, a, i), reportHit,
    findStaggered, meleeSweep, shatter, kill, damageRadius, localToWorld, register, helpers,
    get alive() { let n = 0; for (const e of list) if (e.alive) n++; return n; },
  };
}

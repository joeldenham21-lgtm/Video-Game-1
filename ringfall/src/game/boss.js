// Bosses: THE CONDUCTOR (floor 5) and THE HEART OF THE CHOIR (floor 10).
// Both are registered as special enemy types so every weapon, hit and aim system works on them.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, rand, pick, chance, TAU, distSqPointSegment, damp } from '../util.js';
import { enemyMaterials, buildBubble } from './enemyModels.js';
import { P } from './player.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

function glowMat(hex, i) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(i), toneMapped: false }); }

// ------------------------------------------------------------------ models
function buildConductor() {
  const s = enemyMaterials();
  const shellMat = s.porcelain.clone(); shellMat.emissive = new THREE.Color(0);
  const coreMat = s.core.clone();
  const root = new THREE.Group();
  const eyePivot = new THREE.Group();
  root.add(eyePivot);
  const housing = new THREE.Mesh(new THREE.SphereGeometry(1.45, 32, 20, 0, TAU, 0.55, Math.PI - 0.55), shellMat);
  housing.rotation.x = -Math.PI / 2;
  housing.castShadow = true;
  eyePivot.add(housing);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 16), s.inner);
  eyePivot.add(inner);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), coreMat);
  eye.position.z = -0.72;
  eyePivot.add(eye);
  const iris = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.07, 8, 40), glowMat(0x9fe8ff, 3));
  iris.position.z = -0.88;
  eyePivot.add(iris);
  const rings = [];
  const ringDefs = [[2.5, 0.2, [1, 0.3, 0]], [3.25, 0.22, [0.2, 1, 0.4]], [4.0, 0.24, [0.6, 0.2, 1]]];
  for (const [R, tube, axis] of ringDefs) {
    const pivot = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 10, 64), shellMat);
    ring.castShadow = true;
    const seam = new THREE.Mesh(new THREE.TorusGeometry(R, tube * 0.35, 6, 64), glowMat(0x9fe8ff, 2.6));
    seam.scale.set(1, 1, 1.9);
    pivot.add(ring, seam);
    // spikes on the outer ring
    if (R > 3.8) for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 5), shellMat);
      sp.position.set(Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), 0);
      sp.rotation.z = a - Math.PI / 2;
      pivot.add(sp);
    }
    root.add(pivot);
    rings.push({ pivot, R, axis: new THREE.Vector3(...axis).normalize(), speed: rand(0.5, 0.9) * (rings.length % 2 ? -1 : 1), scale: 1 });
  }
  const crown = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.05, 6, 80), glowMat(0xff4a6a, 2.5));
  crown.rotation.x = Math.PI / 2;
  root.add(crown);
  return { root, shellMat, coreMat, parts: { eyePivot, eye, rings, crown, iris } };
}

function buildHeart() {
  const s = enemyMaterials();
  const shellMat = s.porcelain.clone(); shellMat.emissive = new THREE.Color(0); shellMat.flatShading = true;
  const coreMat = s.core.clone();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), coreMat);
  body.add(core);
  const shards = [];
  const shardGeo = new THREE.OctahedronGeometry(1, 0).scale(0.55, 2.2, 0.55);
  for (let i = 0; i < 14; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / 14), th = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    const m = new THREE.Mesh(shardGeo, shellMat);
    m.position.copy(dir).multiplyScalar(2.6);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.castShadow = true;
    body.add(m);
    shards.push({ m, dir });
  }
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 0), glowMat(0x9fe8ff, 1.6));
  cage.material.wireframe = true;
  body.add(cage);
  const shell = buildBubble();
  shell.scale.setScalar(5.6);
  shell.material.uniforms.uColor.value.set(0x9fd8ff).multiplyScalar(1.6);
  root.add(shell);
  return { root, shellMat, coreMat, parts: { body, core, shards, cage, shell } };
}

function buildPylon() {
  const s = enemyMaterials();
  const shellMat = s.porcelain.clone(); shellMat.emissive = new THREE.Color(0);
  const coreMat = s.core.clone();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const ob = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0).scale(0.9, 3.2, 0.9), shellMat);
  ob.castShadow = true;
  body.add(ob);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), coreMat);
  core.position.set(0, 0.2, 0);
  body.add(core);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.04, 6, 32), glowMat(0x9fe8ff, 2.4));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1.2 + i * 1.2;
    body.add(ring);
  }
  return { root, shellMat, coreMat, parts: { body, core } };
}

// ------------------------------------------------------------------ shared attack helpers
function spiralShot(from, angle, speed, dmg, targetY = 1.25, spread = 32) {
  tmp.set(from.x + Math.cos(angle) * spread, targetY, from.z + Math.sin(angle) * spread).sub(from).normalize().multiplyScalar(speed);
  G.projectiles.orb(from, tmp, dmg, null, { r: 0.32, color: 0xff3a5c });
}

function beamHitsPlayer(sx, sy, sz, ex, ey, ez, radius) {
  const pl = G.player;
  for (let h = 0.2; h <= 1.7; h += 0.5) {
    if (distSqPointSegment(pl.pos.x, pl.pos.y + h, pl.pos.z, sx, sy, sz, ex, ey, ez) < (radius + P.radius) ** 2) return true;
  }
  return false;
}

export function createBoss() {
  const E = G.enemies;
  const B = {
    active: false, type: null, e: null, phase: 1, hpFrac: 1, pylons: [], cycle: 0, t: 0,
    attack: null, attackT: 0, cool: 3, sweep: null, dying: 0, intro: 0, exposedT: 0,

    start(type) {
      B.active = true; B.type = type; B.phase = 1; B.cycle = 0; B.t = 0;
      B.attack = null; B.cool = 3.5; B.sweep = null; B.dying = 0; B.intro = 3;
      B.pylons = [];
      if (type === 'conductor') {
        B.e = E.spawn('conductor', 0, 9, 0, { silent: true });
        B.e.warp = 2.2;
        G.story.say('conductor', { delay: 0.3 });
      } else {
        B.e = E.spawn('heart', 0, 7.5, 0, { silent: true });
        B.e.warp = 2.2;
        B.e.invuln = true;
        G.story.say('heart', { delay: 0.3 });
        spawnPylons();
      }
      G.audio?.play('bossRoar');
      B.hum = G.audio?.loop('bossHum', { pos: B.e.pos, volume: 0.8 });
      G.particles?.warpIn(B.e.pos, 12, 0xff8fa0);
      G.lights?.flash(B.e.pos, 0xff6a8a, 60, 40, 1.2);
      G.player.addTrauma(0.5);
      G.hud?.announce(type === 'conductor' ? 'THE CONDUCTOR' : 'THE HEART', type === 'conductor' ? 'KEEPER OF THE SWARM' : 'SOURCE OF THE CHOIR', 'warn');
    },

    clear() {
      if (B.e) { E.group.remove(B.e.root); }
      if (B.sweep) { for (const b of B.sweep.beams) b.dead = true; B.sweep = null; }
      for (const p of B.pylons) if (p.tether) p.tether.dead = true;
      B.hum?.stop(0.3); B.hum = null;
      B.active = false; B.e = null; B.pylons = [];
      G.hud?.bossBar(false);
    },

    update(dt) {
      if (!B.active || !B.e) return;
      const e = B.e;
      B.hpFrac = clamp(e.hp / e.maxHp, 0, 1);
      if (B.dying > 0) { deathSequence(dt); return; }
      let sub = '';
      if (B.type === 'heart') {
        const alive = B.pylons.filter(p => p.alive).length;
        sub = e.invuln ? `SHIELDED — DESTROY THE PYLONS ${4 - alive}/4` : 'EXPOSED — STRIKE THE CORE';
      } else if (e.invuln) sub = 'REALIGNING';
      else if (e.staggered) sub = 'STUNNED — SHATTER IT';
      G.hud?.bossBar(true, B.type === 'conductor' ? 'THE CONDUCTOR' : 'HEART OF THE CHOIR', B.hpFrac, [1 / 3, 2 / 3], sub);
      B.hum?.setPos?.(e.pos);
    },
  };

  // ------------------------------------------------------------------ CONDUCTOR
  const CONDUCTOR_HITS = [[0, 0, 0, 0.95, 'core', true], [0, 0, 0, 1.45, 'body', true]];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 10; i++) CONDUCTOR_HITS.push([0, 0, 0, 0.5, 'shield', true]);

  E.register('conductor', {
    hp: 4600, radius: 4.2, mass: 60, speed: 5, score: 3000, build: buildConductor, stagger: false, hover: 0, name: 'THE CONDUCTOR', threat: 50,
    boss: true, keepRoot: true, shatterFrac: 0.08,
    onDamage(e, amount, info) {
      if (info.part === 'shield') { G.particles?.sparks(info, { x: 0, y: 1, z: 0 }, 0xffe0a0, 4, 6, 2.5); return amount * 0.18 / 0.12; }
      return amount;
    },
  }, CONDUCTOR_HITS, (e, dt, H) => {
    const pl = G.player;
    const parts = e.model.parts;
    B.t += dt;
    const phaseNow = e.hp / e.maxHp > 2 / 3 ? 1 : e.hp / e.maxHp > 1 / 3 ? 2 : 3;
    if (phaseNow > B.phase) phaseChange(e, phaseNow);
    if (e.invuln && B.invulnT > 0) { B.invulnT -= dt; if (B.invulnT <= 0) e.invuln = false; }
    const ph = B.phase;
    // rings spin and spread with phase
    const spreadTarget = ph === 1 ? 1 : ph === 2 ? 1.22 : 1.5;
    parts.rings.forEach((r, i) => {
      r.scale = damp(r.scale, spreadTarget, 2, dt);
      r.pivot.rotateOnAxis(r.axis, r.speed * dt * (1 + (ph - 1) * 0.5));
      r.pivot.scale.setScalar(r.scale);
    });
    parts.crown.rotation.z += dt * 0.4;
    // movement
    let tx, ty, tz;
    const atk = B.attack;
    if (atk === 'sweep' || atk === 'slam' || atk === 'recover' || e.staggered) {
      tx = B.anchor.x; tz = B.anchor.z; ty = B.anchor.y;
    } else {
      tx = Math.sin(B.t * 0.16) * 10; tz = Math.cos(B.t * 0.13) * 10; ty = 8.5 + Math.sin(B.t * 0.7) * 1.2;
    }
    const k = atk === 'sweep' ? 3 : 1.2;
    e.vel.x = (tx - e.pos.x) * k; e.vel.y = (ty - e.pos.y) * k; e.vel.z = (tz - e.pos.z) * k;
    e.pos.addScaledVector(e.vel, dt);
    // eye tracks the player
    H.faceYaw(e, pl.pos.x, pl.pos.z, 3, dt);
    const eye = pl.eyePos;
    const dh = Math.hypot(eye.x - e.pos.x, eye.z - e.pos.z);
    parts.eyePivot.rotation.x = damp(parts.eyePivot.rotation.x, Math.atan2(eye.y - e.pos.y, dh), 4, dt);
    // hit spheres
    const hs = e.hitSpheres;
    e.root.position.copy(e.pos); e.root.rotation.y = e.yaw; e.root.updateMatrixWorld(true);
    parts.eye.getWorldPosition(tmp);
    hs[0].x = tmp.x; hs[0].y = tmp.y; hs[0].z = tmp.z;
    hs[1].x = e.pos.x; hs[1].y = e.pos.y; hs[1].z = e.pos.z;
    let idx = 2;
    for (const r of parts.rings) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        tmp.set(Math.cos(a) * r.R, Math.sin(a) * r.R, 0).applyMatrix4(r.pivot.matrixWorld);
        const h = hs[idx++];
        h.x = tmp.x; h.y = tmp.y; h.z = tmp.z; h.r = 0.55 * r.scale;
      }
    }
    // stagger window after a sweep
    if (e.staggered) {
      e.staggerT -= dt;
      const f = Math.sin(G.time * 18) > 0;
      e.model.coreMat.color.setRGB(f ? 8 : 3, f ? 6 : 1.5, f ? 4 : 0.6);
      if (e.staggerT <= 0) { e.staggered = false; resetCore(e); B.attack = null; B.cool = 1.2; }
      return;
    }
    if (B.intro > 0) { B.intro -= dt; return; }
    // attack scheduler
    if (!B.attack) {
      B.cool -= dt;
      if (B.cool <= 0) {
        const opts = ph === 1 ? ['spiral', 'burst', 'spiral', 'summon'] : ph === 2 ? ['spiral', 'sweep', 'burst', 'summon', 'sweep'] : ['sweep', 'slam', 'spiral', 'burst', 'summon', 'slam'];
        let a = pick(opts);
        if (a === 'summon' && E.alive > 7) a = 'burst';
        if (a === B.last && chance(0.6)) a = pick(opts);
        B.last = a;
        startAttack(e, a);
      }
    } else runAttack(e, dt);
  });

  function resetCore(e) { e.model.coreMat.color.set(0xff4a2a).multiplyScalar(4.5); }

  function phaseChange(e, ph) {
    B.phase = ph;
    e.invuln = true; B.invulnT = 2.4;
    if (B.sweep) { for (const b of B.sweep.beams) b.dead = true; B.sweep = null; }
    B.attack = null; B.cool = 2.8;
    e.staggered = false;
    resetCore(e);
    G.audio?.play('bossPhase');
    G.audio?.play('bossRoar', { volume: 0.8 });
    G.particles?.explosion(e.pos, 5, 0xff6a8a, true);
    G.player.addTrauma(0.45);
    G.renderer.post.uFlash.value = 0.4;
    G.renderer.post.uFlashColor.value.set(0xff8aa0);
    if (B.type === 'conductor') {
      G.story.say(ph === 2 ? 'conductorPhase2' : 'conductorPhase3');
      G.hud?.announce(ph === 2 ? 'PHASE II' : 'FINAL PHASE', ph === 2 ? 'THE RINGS BREAK LOOSE' : 'IT\'S DESPERATE', 'warn');
      summon(ph === 2 ? [['mite', 5], ['sentinel', 1]] : [['sentinel', 2], ['mite', 5], ['lancer', 1]]);
    }
  }

  function summon(groups) {
    let d = 0;
    for (const [type, n] of groups) for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = rand(10, 22);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const g = G.world.groundHeight(x, z, 0.4, 20);
      const y = (g > -1e6 ? g : 0) + (type === 'mite' ? rand(3, 6) : type === 'lancer' ? 7 : 3);
      setTimeout(() => { if (B.active && G.mode === 'playing') E.spawn(type, x, y, z); }, d * 1000);
      d += 0.25;
    }
  }

  function startAttack(e, a) {
    B.attack = a; B.attackT = 0; B.shots = 0; B.base = rand(0, TAU);
    const pl = G.player;
    if (a === 'spiral') { G.audio?.play('bossSpiral', { pos: e.pos }); }
    if (a === 'summon') {
      G.audio?.play('bossRoar', { pos: e.pos, volume: 0.6 });
      summon(B.phase === 1 ? [['mite', 4]] : B.phase === 2 ? [['mite', 5], ['sentinel', 1]] : [['sentinel', 2], ['mite', 4]]);
      B.attack = null; B.cool = 2.5;
    }
    if (a === 'sweep') {
      // descend to the floor near the center, then spin a jumpable beam
      B.anchor = new THREE.Vector3(rand(-3, 3), 1.15, rand(-3, 3));
      B.sweep = null;
      G.hud?.announce('JUMP THE BEAM', '', 'warn');
    }
    if (a === 'slam') {
      B.anchor = new THREE.Vector3(pl.pos.x * 0.6, 13, pl.pos.z * 0.6);
    }
  }

  function runAttack(e, dt) {
    B.attackT += dt;
    const t = B.attackT;
    const ph = B.phase;
    const pl = G.player;
    const src = e.hitSpheres[0];
    tmp3.set(src.x, src.y, src.z);
    if (B.attack === 'spiral') {
      const arms = ph + 2;
      const rate = ph === 3 ? 0.075 : 0.09;
      while (B.shots * rate < t && t < 3.4) {
        const tt = B.shots * rate;
        for (let k = 0; k < arms; k++) spiralShot(tmp3, B.base + k * TAU / arms + tt * (1.4 + ph * 0.2) * (ph === 2 ? -1 : 1), 10 + ph, 10 * e.dmgMul);
        B.shots++;
      }
      if (t > 3.6) { B.attack = null; B.cool = rand(1.2, 2.2); }
    } else if (B.attack === 'burst') {
      const volleys = ph === 3 ? 4 : 3;
      if (B.shots < volleys && t > 0.5 + B.shots * 0.55) {
        H_lead(tmp3, 18, tmp);
        tmp.sub(tmp3).normalize();
        const n = 5;
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.07;
          tmp2.copy(tmp).applyAxisAngle(new THREE.Vector3(0, 1, 0), off).multiplyScalar(18);
          G.projectiles.orb(tmp3, tmp2, 12 * e.dmgMul, e, { r: 0.34, homing: 0.4, heavy: true });
        }
        G.audio?.play('orbFire', { pos: tmp3 });
        B.shots++;
      }
      if (t > 0.5 + volleys * 0.55 + 0.6) { B.attack = null; B.cool = rand(1.4, 2.4); }
    } else if (B.attack === 'sweep') {
      if (!B.sweep && t > 1.3) {
        // charge
        B.sweep = { beams: [], angle: Math.atan2(pl.pos.z - e.pos.z, pl.pos.x - e.pos.x) + Math.PI, hitCool: 0, fired: false };
        G.audio?.play('lancerCharge', { pos: e.pos });
        G.particles?.ring({ x: e.pos.x, y: 0.05, z: e.pos.z }, 30, 0xff3050, 60, 1.0, 1.5);
      }
      if (B.sweep) {
        const s = B.sweep;
        const charging = t < 2.4;
        const beams = ph === 3 ? 2 : 1;
        if (!s.fired && !charging) {
          s.fired = true;
          G.audio?.play('bossLaser', { pos: e.pos });
          for (let i = 0; i < beams; i++) {
            s.beams.push(G.beams.add(0, 0, 0, 0, 0, 0, 0xff3050, 6, 0.3, 1, 'hold', 0.06));
            s.beams.push(G.beams.add(0, 0, 0, 0, 0, 0, 0xffffff, 3, 0.08, 1, 'hold', 0));
          }
        }
        const spin = charging ? 0 : (ph === 3 ? 1.9 : 1.55) * dt;
        s.angle += spin;
        const y = 1.0;
        s.hitCool -= dt;
        for (let i = 0; i < beams; i++) {
          const a = s.angle + i * Math.PI;
          const dx = Math.cos(a), dz = Math.sin(a);
          const sx = e.pos.x + dx * 1.5, sz = e.pos.z + dz * 1.5;
          const wh = G.world.raycast(sx, y, sz, dx, 0, dz, 45);
          const len = wh ? wh.t : 45;
          const ex = sx + dx * len, ez = sz + dz * len;
          if (s.fired) {
            for (let j = 0; j < 2; j++) { const b = s.beams[i * 2 + j]; b.sx = sx; b.sy = y; b.sz = sz; b.ex = ex; b.ey = y; b.ez = ez; }
            if (wh && chance(dt * 30)) G.particles?.sparks(wh, { x: wh.nx, y: wh.ny, z: wh.nz }, 0xff4060, 3, 6, 3);
            if (s.hitCool <= 0 && beamHitsPlayer(sx, y, sz, ex, y, ez, 0.35)) {
              if (pl.damage(24 * e.dmgMul, { x: sx, y, z: sz }, 'laser')) s.hitCool = 0.6;
            }
          } else if (chance(dt * 20)) {
            G.beams.add(sx, y, sz, sx + dx * 30, y, sz + dz * 30, 0xff2040, 1.2, 0.02, 0.12, 'fade');
          }
        }
        if (s.fired && t > 2.4 + (TAU / (ph === 3 ? 1.9 : 1.55)) * (ph === 3 ? 0.55 : 1.02)) {
          for (const b of s.beams) b.dead = true;
          B.sweep = null;
          // exhausted: vulnerable to a shatter
          e.staggered = true; e.staggerT = 3.2;
          G.hud?.tip('stagger', 3);
          B.attack = 'recover';
        }
      }
    } else if (B.attack === 'slam') {
      if (t > 1.4 && !B.slammed) { B.anchor.y = 1.3; }
      if (t > 1.4 && e.pos.y < 2.2 && !B.slammed) {
        B.slammed = true;
        const g = 0;
        G.projectiles.shockwave(e.pos.x, g, e.pos.z, 32, 15, 20 * e.dmgMul, 0xff4a6a);
        setTimeout(() => { if (B.active && B.e) G.projectiles.shockwave(B.e.pos.x, 0, B.e.pos.z, 32, 10, 20 * B.e.dmgMul, 0xff4a6a); }, 550);
        G.audio?.play('bruteSlam', { pos: e.pos, volume: 1 });
        G.particles?.explosion({ x: e.pos.x, y: 0.5, z: e.pos.z }, 5, 0xff8a6a, true);
        G.player.addTrauma(0.5);
      }
      if (t > 3.2) { B.slammed = false; B.attack = null; B.cool = 1.5; }
    } else if (B.attack === 'recover') {
      if (!e.staggered) { B.attack = null; B.cool = 1.5; }
    }
  }

  function H_lead(from, speed, out) { return E.helpers.leadTarget(from, speed, out, 0.7); }

  // ------------------------------------------------------------------ HEART
  E.register('heart', {
    hp: 5200, radius: 4, mass: 100, speed: 0, score: 6000, build: buildHeart, stagger: false, hover: 0, name: 'THE HEART', threat: 80,
    boss: true, keepRoot: true, shatterFrac: 0.07,
  }, [[0, 0, 0, 2.3, 'core', true], [0, 0, 0, 3.2, 'body', true]], (e, dt, H) => {
    const pl = G.player;
    const parts = e.model.parts;
    B.t += dt;
    // heartbeat pulse synced to music when possible
    const beat = Math.pow(Math.max(0, Math.sin(B.t * 2 * Math.PI * 1.1)), 8);
    parts.body.rotation.y += dt * 0.25; parts.body.rotation.x = Math.sin(B.t * 0.3) * 0.2;
    for (const s of parts.shards) s.m.position.copy(s.dir).multiplyScalar(2.6 + beat * 0.35 + (e.invuln ? 0 : 0.5));
    parts.core.scale.setScalar(1 + beat * 0.12);
    parts.cage.rotation.y -= dt * 0.4;
    parts.shell.visible = e.invuln;
    if (e.invuln) { parts.shell.material.uniforms.uTime.value = G.time; parts.shell.material.uniforms.uHit.value = Math.max(0, parts.shell.material.uniforms.uHit.value - dt * 3); }
    const targetY = e.invuln ? 7.5 : 4.2;
    e.pos.y = damp(e.pos.y, targetY + Math.sin(B.t * 0.8) * 0.4, 1.5, dt);
    e.root.position.copy(e.pos);
    e.hitSpheres[0].x = e.pos.x; e.hitSpheres[0].y = e.pos.y; e.hitSpheres[0].z = e.pos.z;
    e.hitSpheres[1].x = e.pos.x; e.hitSpheres[1].y = e.pos.y; e.hitSpheres[1].z = e.pos.z;
    // tethers
    for (const p of B.pylons) {
      if (!p.tether) continue;
      if (!p.alive) { p.tether.dead = true; p.tether = null; continue; }
      const b = p.tether;
      b.sx = p.aimPoint.x; b.sy = p.aimPoint.y; b.sz = p.aimPoint.z;
      b.ex = e.pos.x; b.ey = e.pos.y; b.ez = e.pos.z;
      b.alpha = 0.5 + beat * 0.5;
    }
    if (e.staggered) {
      e.staggerT -= dt;
      const f = Math.sin(G.time * 18) > 0;
      e.model.coreMat.color.setRGB(f ? 8 : 3, f ? 6 : 1.5, f ? 4 : 0.6);
      if (e.staggerT <= 0) { e.staggered = false; resetCore(e); rebuild(e); }
      return;
    }
    if (B.intro > 0) { B.intro -= dt; return; }
    // shell drops when every pylon is gone
    if (e.invuln && B.pylons.length && B.pylons.every(p => !p.alive)) {
      e.invuln = false;
      B.exposedT = 0;
      B.segmentStart = e.hp;
      G.audio?.play('shieldBreak', { volume: 1 });
      G.audio?.play('bossPhase');
      G.particles?.explosion(e.pos, 6, 0x9fd8ff, true);
      G.player.addTrauma(0.4);
      G.story.say('heartOpen');
      G.hud?.announce('SHELL BROKEN', 'STRIKE THE HEART', 'gold');
    }
    if (!e.invuln) {
      B.exposedT += dt;
      // lose a third of health (or time out) → it stumbles, then rebuilds
      const seg = e.maxHp / 3;
      if ((B.segmentStart - e.hp >= seg * 0.98 || B.exposedT > 26) && e.hp > 1) {
        e.staggered = true; e.staggerT = 3;
        G.hud?.tip('stagger', 3);
        if (B.sweep) { for (const b of B.sweep.beams) b.dead = true; B.sweep = null; }
        B.attack = null;
        return;
      }
    }
    // attacks
    if (!B.attack) {
      B.cool -= dt;
      if (B.cool <= 0) {
        const opts = e.invuln ? ['rings', 'rain', 'rings'] : ['beams', 'burst', 'rings', 'rain', 'beams'];
        let a = pick(opts);
        if (a === B.last && chance(0.6)) a = pick(opts);
        B.last = a;
        B.attack = a; B.attackT = 0; B.shots = 0; B.base = rand(0, TAU);
        if (a === 'beams') { B.sweep = null; }
      }
    } else runHeartAttack(e, dt);
  });

  function runHeartAttack(e, dt) {
    B.attackT += dt;
    const t = B.attackT;
    const pl = G.player;
    const cyc = B.cycle;
    if (B.attack === 'rings') {
      const rings = 2 + cyc;
      if (B.shots < rings && t > B.shots * 1.1) {
        const n = 22;
        const gap = Math.floor(rand(0, n));
        const origin = { x: e.pos.x, y: 1.25, z: e.pos.z };
        for (let i = 0; i < n; i++) {
          if (Math.abs(i - gap) <= 1 || Math.abs(i - gap) >= n - 1) continue;
          const a = (i / n) * TAU + B.shots * 0.4;
          G.projectiles.orb(origin, { x: Math.cos(a) * 9, y: 0, z: Math.sin(a) * 9 }, 11 * e.dmgMul, null, { r: 0.36, color: 0xff3a5c, life: 5 });
        }
        G.audio?.play('bossSpiral', { pos: e.pos, volume: 0.8 });
        B.shots++;
      }
      if (t > rings * 1.1 + 1) { B.attack = null; B.cool = rand(1.5, 2.6) - cyc * 0.3; }
    } else if (B.attack === 'rain') {
      const drops = 10 + cyc * 4;
      if (!B.targets) {
        B.targets = [];
        for (let i = 0; i < drops; i++) {
          const a = rand(0, TAU), r = i < 3 ? rand(0, 2) : rand(2, 9);
          const x = pl.pos.x + Math.cos(a) * r + pl.vel.x * 0.6, z = pl.pos.z + Math.sin(a) * r + pl.vel.z * 0.6;
          const g = G.world.groundHeight(x, z, 0.2, 30);
          B.targets.push({ x, z, y: g > -1e6 ? g : 0, t: 0.25 + i * 0.09, fired: false, warned: false });
        }
      }
      for (const d of B.targets) {
        if (!d.warned && t > d.t - 0.25) { d.warned = true; G.particles?.ring({ x: d.x, y: d.y + 0.05, z: d.z }, 1.6, 0xff3050, 16, 0.9, 2); }
        if (!d.fired && t > d.t) {
          d.fired = true;
          G.projectiles.orb({ x: d.x, y: d.y + 22, z: d.z }, { x: 0, y: -26, z: 0 }, 14 * e.dmgMul, null, { r: 0.42, color: 0xff5a3a, heavy: true, life: 3 });
        }
      }
      if (t > drops * 0.09 + 1.6) { B.targets = null; B.attack = null; B.cool = rand(1.6, 2.4); }
    } else if (B.attack === 'burst') {
      if (B.shots < 4 && t > 0.3 + B.shots * 0.45) {
        const from = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
        H_lead(from, 18, tmp);
        tmp.sub(tmp2.set(from.x, from.y, from.z)).normalize();
        for (let i = 0; i < 7; i++) {
          tmp2.copy(tmp).applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - 3) * 0.08).multiplyScalar(18);
          G.projectiles.orb(from, tmp2, 12 * e.dmgMul, e, { r: 0.34, homing: 0.35, heavy: true });
        }
        G.audio?.play('orbFire', { pos: from });
        B.shots++;
      }
      if (t > 2.6) { B.attack = null; B.cool = rand(1.2, 2); }
    } else if (B.attack === 'beams') {
      if (!B.sweep && t > 0.9) {
        B.sweep = { beams: [], angle: rand(0, TAU), hitCool: 0, fired: false };
        G.audio?.play('lancerCharge', { pos: e.pos });
        G.hud?.announce('JUMP THE BEAMS', '', 'warn');
      }
      if (B.sweep) {
        const s = B.sweep;
        const n = 2 + (cyc >= 2 ? 1 : 0);
        const charging = t < 2.0;
        if (!s.fired && !charging) {
          s.fired = true;
          G.audio?.play('bossLaser', { pos: e.pos });
          for (let i = 0; i < n; i++) {
            s.beams.push(G.beams.add(0, 0, 0, 0, 0, 0, 0xff3050, 6, 0.3, 1, 'hold', 0.06));
            s.beams.push(G.beams.add(0, 0, 0, 0, 0, 0, 0xffffff, 3, 0.08, 1, 'hold', 0));
          }
        }
        s.angle += charging ? 0 : (1.1 + cyc * 0.2) * dt;
        s.hitCool -= dt;
        const y = 1.0;
        for (let i = 0; i < n; i++) {
          const a = s.angle + i * TAU / n;
          const dx = Math.cos(a), dz = Math.sin(a);
          const sx = e.pos.x + dx * 5.2, sz = e.pos.z + dz * 5.2;
          const wh = G.world.raycast(sx, y, sz, dx, 0, dz, 40);
          const len = wh ? wh.t : 40;
          const ex = sx + dx * len, ez = sz + dz * len;
          if (s.fired) {
            for (let j = 0; j < 2; j++) { const b = s.beams[i * 2 + j]; b.sx = sx; b.sy = y; b.sz = sz; b.ex = ex; b.ey = y; b.ez = ez; }
            if (s.hitCool <= 0 && beamHitsPlayer(sx, y, sz, ex, y, ez, 0.35)) { if (pl.damage(22 * e.dmgMul, { x: sx, y, z: sz }, 'laser')) s.hitCool = 0.6; }
          } else if (chance(dt * 16)) G.beams.add(sx, y, sz, ex, y, ez, 0xff2040, 1.2, 0.02, 0.12, 'fade');
        }
        if (s.fired && t > 2.0 + 5.5) {
          for (const b of s.beams) b.dead = true;
          B.sweep = null; B.attack = null; B.cool = 1.5;
        }
      }
    }
  }

  function spawnPylons() {
    B.pylons = [];
    const hpScale = 1 + B.cycle * 0.2;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const x = Math.cos(a) * 20, z = Math.sin(a) * 20;
      const p = E.spawn('pylon', x, 0.8 + 3.3, z);
      p.hp *= hpScale; p.maxHp *= hpScale;
      p.tether = G.beams.add(x, 4, z, 0, 7.5, 0, 0x9fe8ff, 2, 0.05, 1, 'hold', 0.2);
      B.pylons.push(p);
    }
    G.hud?.tip('pylons', 5);
  }

  function rebuild(e) {
    if (e.hp <= 1) return;
    B.cycle++;
    e.invuln = true;
    B.attack = null; B.cool = 3;
    G.story.say('heartPhase');
    G.hud?.announce('THE HEART REBUILDS', 'DESTROY THE PYLONS', 'warn');
    G.audio?.play('bossRoar');
    spawnPylons();
    const adds = B.cycle === 1 ? [['lancer', 2], ['sentinel', 2]] : [['warden', 1], ['brute', 1], ['mite', 6]];
    summon(adds);
  }

  E.register('pylon', {
    hp: 600, radius: 1.3, mass: 1000, speed: 0, score: 400, build: buildPylon, stagger: false, hover: 0, name: 'PYLON', threat: 6,
  }, [[0, 1.6, 0, 0.8, 'body'], [0, -1.2, 0, 0.8, 'body'], [0, 0.2, 0, 0.9, 'core']], (e, dt, H) => {
    e.model.parts.body.rotation.y += dt * 0.6;
    e.cool -= dt;
    if (e.cool <= 0 && H.hasLOS(e, dt)) {
      e.cool = rand(3, 4.2) - B.cycle * 0.5;
      H.localToWorld(e, e.hitSpheres[2], tmp3);
      H.leadTarget(tmp3, 14, tmp, 0.6);
      tmp.sub(tmp3).normalize().multiplyScalar(14);
      for (let i = -1; i <= 1; i++) {
        tmp2.copy(tmp).applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.12);
        G.projectiles.orb(tmp3, tmp2, 10 * e.dmgMul, e, { r: 0.3 });
      }
      G.audio?.play('orbFire', { pos: e.pos, volume: 0.7 });
    }
  });

  // ------------------------------------------------------------------ death
  G.events.on('enemyKilled', (ctx) => {
    if (!B.active || ctx.enemy !== B.e) {
      if (B.active && ctx.enemy.type === 'pylon') {
        G.audio?.play('bossPhase', { volume: 0.5 });
        G.particles?.explosion(ctx.enemy.pos, 4, 0x9fe8ff, true);
      }
      return;
    }
    B.dying = 3.2;
    B.boomT = 0;
    G.slowmo = 2.5;
    B.hum?.stop(1); B.hum = null;
    if (B.sweep) { for (const b of B.sweep.beams) b.dead = true; B.sweep = null; }
    for (const e of E.list) if (e.alive && e !== B.e) E.kill(e, { source: 'boss' });
    G.projectiles.clear();
    G.audio?.play('bossDeath');
    G.hud?.bossBar(false);
  });

  function deathSequence(dt) {
    const e = B.e;
    B.dying -= G.dt;
    B.boomT -= G.dt;
    e.root.rotation.y += G.dt * 2;
    e.root.position.y -= G.dt * 0.6;
    if (B.boomT <= 0) {
      B.boomT = 0.22;
      tmp.set(e.pos.x + rand(-3, 3), e.pos.y + rand(-2, 2), e.pos.z + rand(-3, 3));
      G.particles?.explosion(tmp, rand(2, 4), pick([0xbfe8ff, 0xff6a3a, 0xffffff]), true);
      G.debris?.burst(tmp, 12, 0xe4e8ee, 10, 0.25, 0xff6a2a);
      G.lights?.flash(tmp, 0xffc0a0, 50, 30, 0.3);
      G.player.addTrauma(0.3);
    }
    if (B.dying <= 0) {
      G.particles?.explosion(e.pos, 9, 0xffffff, true);
      G.debris?.burst(e.pos, 60, 0xe4e8ee, 16, 0.3, 0xff6a2a);
      G.renderer.post.uFlash.value = 1.2;
      G.renderer.post.uFlashColor.value.set(0xffffff);
      G.player.addTrauma(0.8);
      E.group.remove(e.root);
      const type = B.type;
      B.active = false; B.e = null;
      if (type === 'conductor') G.story.say('conductorDown', { delay: 0.8 });
      G.style.add(150, type === 'conductor' ? 'CONDUCTOR DESTROYED' : 'HEART DESTROYED', true);
      G.director.bossDefeated();
    }
  }

  return B;
}

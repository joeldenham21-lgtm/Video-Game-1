// Weapons: hitscan/projectile firing, spread, recoil, reload, swap, melee (with lunge + deflect), viewmodel animation.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, damp, lerp, rand, DEG, V1, V2 } from '../util.js';
import { buildCarbine, buildScatter, buildLance, buildNova, buildFist, buildFlash } from './viewmodels.js';

export const WEAPONS = {
  carbine: {
    id: 'carbine', name: 'PULSE CARBINE', short: 'CARBINE', key: 1, rate: 10.5, dmg: 14, crit: 2.0, pellets: 1,
    spread: 1.0, adsSpread: 0.22, bloom: 0.22, maxBloom: 2.2, mag: 36, reload: 1.25, range: 110,
    falloff: [35, 80, 0.6], recoil: 0.0055, kick: 0.035, adsZoom: 1.4, knock: 0.8, magnet: 3.0,
    autoRange: 60, color: 0x7fe6ff, sound: 'carbineShot', tracer: 1.0,
  },
  scatter: {
    id: 'scatter', name: 'SCATTERGUN', short: 'SCATTER', key: 2, rate: 1.55, dmg: 9.5, crit: 1.6, pellets: 11,
    spread: 5.2, adsSpread: 3.6, bloom: 0, maxBloom: 0, mag: 6, reload: 1.6, range: 45,
    falloff: [7, 26, 0.25], recoil: 0.04, kick: 0.12, adsZoom: 1.15, knock: 11, magnet: 4.5,
    autoRange: 18, color: 0xffa24a, sound: 'scatterShot', tracer: 0.5,
  },
  lance: {
    id: 'lance', name: 'ARC LANCE', short: 'LANCE', key: 3, rate: 1.1, dmg: 125, crit: 2.0, pellets: 1, pierce: true,
    spread: 0.15, adsSpread: 0, bloom: 0, maxBloom: 0, mag: 5, reload: 1.85, range: 180,
    falloff: [200, 300, 1], recoil: 0.032, kick: 0.1, adsZoom: 2.4, knock: 6, magnet: 2.4, charge: 0.14,
    autoRange: 120, color: 0xc6a0ff, sound: 'lanceShot', tracer: 2.2,
  },
  nova: {
    id: 'nova', name: 'NOVA LAUNCHER', short: 'NOVA', key: 4, rate: 1.35, dmg: 95, crit: 1, pellets: 0, projectile: true,
    spread: 0.4, adsSpread: 0.1, bloom: 0, maxBloom: 0, mag: 4, reload: 1.9, range: 70,
    recoil: 0.026, kick: 0.1, adsZoom: 1.2, knock: 14, magnet: 3.5, speed: 38, radius: 5.2,
    autoRange: 40, color: 0x6dff9a, sound: 'novaShot',
  },
};
export const ORDER = ['carbine', 'scatter', 'lance', 'nova'];

const BUILDERS = { carbine: buildCarbine, scatter: buildScatter, lance: buildLance, nova: buildNova };

// Springy scalar for viewmodel animation
class Spring {
  constructor(k = 140, d = 16) { this.x = 0; this.v = 0; this.k = k; this.d = d; }
  update(dt, target = 0) {
    const a = -this.k * (this.x - target) - this.d * this.v;
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  }
  kick(v) { this.v += v; }
}

export function createWeapons() {
  const root = new THREE.Group();          // follows the viewmodel camera
  G.vmCamera.add(root);
  const models = {};
  for (const id of ORDER) {
    const m = BUILDERS[id]();
    m.group.visible = false;
    root.add(m.group);
    models[id] = m;
  }
  const fist = buildFist();
  fist.group.visible = false;
  root.add(fist.group);
  const flash = buildFlash();
  root.add(flash);
  const vmLight = new THREE.PointLight(0xffffff, 0, 3, 2);
  root.add(vmLight);

  const springs = { px: new Spring(), py: new Spring(), pz: new Spring(160, 18), rx: new Spring(150, 15), ry: new Spring(), rz: new Spring() };
  const sway = { x: 0, y: 0 };
  const eye = new THREE.Vector3(), dir = new THREE.Vector3(), fwd = new THREE.Vector3(), muzzleW = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3();

  const W = {
    owned: ['carbine', 'scatter'],
    current: 'carbine',
    ammo: {}, reloadT: 0, cool: 0, swapT: 0, swapTo: null, chargeT: 0, charging: false,
    bloom: 0, meleeCool: 0, meleeT: -1, meleeHitDone: false, lungeTarget: null, lungeT: 0,
    spreadNow: 1, lastShot: -10, shotsFired: 0, shotsHit: 0, autoTarget: false, flashT: 0,
    models, root,

    get def() { return WEAPONS[W.current]; },
    reset() {
      W.owned = ['carbine', 'scatter'];
      for (const id of ORDER) W.ammo[id] = WEAPONS[id].mag;
      W.equip('carbine', true);
      W.reloadT = 0; W.cool = 0; W.bloom = 0; W.meleeCool = 0; W.meleeT = -1; W.lungeTarget = null;
      W.shotsFired = 0; W.shotsHit = 0;
    },
    give(id) {
      if (!W.owned.includes(id)) W.owned.push(id);
      W.owned.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      W.ammo[id] = W.magSize(id);
      W.equip(id);
    },
    magSize(id) { return Math.round(WEAPONS[id].mag * (G.augments?.mods.magSize ?? 1)); },
    equip(id, instant = false) {
      if (!W.owned.includes(id)) return;
      if (instant) {
        W.current = id; W.swapT = 0; W.swapTo = null;
        for (const k of ORDER) models[k].group.visible = k === id;
        G.hud?.weaponChanged();
        return;
      }
      if (id === W.current && !W.swapTo) return;
      W.swapTo = id; W.swapT = 0.32; W.reloadT = 0; W.charging = false;
      G.audio?.play('swap', { volume: 0.7 });
    },
    canAds() { return W.swapT <= 0 && W.meleeT < 0; },
    get reloading() { return W.reloadT > 0; },
    startReload() {
      const id = W.current;
      if (W.reloadT > 0 || W.ammo[id] >= W.magSize(id) || W.swapT > 0) return;
      W.reloadT = WEAPONS[id].reload * (G.augments?.mods.reloadTime ?? 1);
      W.reloadDur = W.reloadT;
      W._reloadDone = false;
      G.audio?.play('reload', { volume: 0.8 });
    },

    update(dt, rawDt) {
      const input = G.input;
      const player = G.player;
      const def = W.def;
      W.cool -= dt; W.meleeCool -= dt;

      // weapon selection
      if (G.mode === 'playing' && player.alive) {
        for (const id of ORDER) if (input.pressed('weapon' + WEAPONS[id].key)) W.equip(id);
        if (input.pressed('swapNext') || input.pressed('swapPrev')) {
          const i = W.owned.indexOf(W.swapTo || W.current);
          const n = W.owned.length;
          W.equip(W.owned[(i + (input.pressed('swapPrev') ? n - 1 : 1)) % n]);
        }
        if (input.pressed('reload')) W.startReload();
      }

      // swap animation
      if (W.swapT > 0) {
        W.swapT -= dt;
        if (W.swapTo && W.swapT < 0.16) {
          W.current = W.swapTo; W.swapTo = null;
          for (const k of ORDER) models[k].group.visible = k === W.current;
          G.hud?.weaponChanged();
        }
      }

      // reload
      if (W.reloadT > 0) {
        W.reloadT -= dt;
        if (!W._reloadDone && W.reloadT < W.reloadDur * 0.3) {
          W._reloadDone = true;
          W.ammo[W.current] = W.magSize(W.current);
          G.audio?.play('reloadDone', { volume: 0.8 });
        }
        if (W.reloadT <= 0) W.reloadT = 0;
      }

      // bloom recovery
      W.bloom = Math.max(0, W.bloom - dt * 7 * DEG);

      // melee
      updateMelee(dt);

      // firing
      eye.copy(G.camera.position);
      player.forward(fwd);
      W.autoTarget = false;
      const canFire = G.mode === 'playing' && player.alive && W.swapT <= 0 && W.meleeT < 0 && !W.lungeTarget;
      let wantFire = input.isHeld('fire');
      if (!wantFire && canFire && G.settings.autoFire && input.source === 'touch') {
        W.autoTarget = autoFireCheck(def);
        wantFire = W.autoTarget;
      }
      if (canFire && wantFire) {
        if (W.ammo[W.current] <= 0 && player.odActive <= 0) {
          if (W.reloadT <= 0) W.startReload();
        } else if (W.reloadT > 0 && W.ammo[W.current] > 0) {
          // allow cancelling a reload by firing if bullets remain
          W.reloadT = 0;
        }
        if (W.reloadT <= 0 && W.cool <= 0 && (W.ammo[W.current] > 0 || player.odActive > 0)) {
          if (def.charge && !W.charging) {
            W.charging = true; W.chargeT = def.charge;
            G.audio?.play('lanceCharge', { volume: 0.8 });
          }
          if (!def.charge) fire(def);
        }
      }
      if (W.charging) {
        W.chargeT -= dt;
        if (W.chargeT <= 0) { W.charging = false; if (canFire) fire(def); }
      }
      // auto reload when empty and not firing
      if (W.ammo[W.current] <= 0 && W.reloadT <= 0 && W.cool <= 0 && player.odActive <= 0 && W.swapT <= 0) W.startReload();

      const adsSpread = lerp(def.spread, def.adsSpread, player.ads);
      W.spreadNow = adsSpread * DEG + W.bloom * (1 - player.ads * 0.7) + (player.grounded ? 0 : 0.35 * DEG) + Math.min(1, player.speedNow / 9) * 0.25 * DEG;

      animate(dt, rawDt);
      G.hud?.setAmmo(W.ammo[W.current], W.magSize(W.current), W.reloadT > 0);
    },
  };

  // Is an enemy under (or very near) the reticle within this weapon's useful range?
  function autoFireCheck(def) {
    const hit = G.enemies?.raycast(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, def.autoRange);
    if (hit) {
      const wh = G.world.raycast(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, hit.t);
      return !wh;
    }
    const m = findMagnetTarget(fwd, def.autoRange, 2.2 * DEG);
    return !!m;
  }

  function findMagnetTarget(d, range, cone) {
    if (!G.enemies) return null;
    let best = null, bestA = cone;
    for (const e of G.enemies.list) {
      if (!e.alive || e.warp > 0) continue;
      const ap = e.aimPoint;
      const dx = ap.x - eye.x, dy = ap.y - eye.y, dz = ap.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range || dist < 0.3) continue;
      const cos = (dx * d.x + dy * d.y + dz * d.z) / dist;
      const a = Math.acos(clamp(cos, -1, 1)) - Math.atan(e.radius * 0.8 / dist);
      if (a < bestA && G.world.lineOfSight(eye.x, eye.y, eye.z, ap.x, ap.y, ap.z)) { bestA = a; best = e; }
    }
    return best;
  }

  function muzzleWorld(out) {
    const m = models[W.current];
    out.copy(m.muzzle);
    m.group.localToWorld(out);          // in vm-camera space (vmCamera at origin, same orientation as camera)
    // convert viewmodel space to world: vmCamera shares the camera's orientation, sits at the origin
    out.add(G.camera.position);
    // pull toward the eye so tracers read correctly with the narrower viewmodel FOV
    return out.lerp(G.camera.position, 0.25);
  }

  function fire(def) {
    const player = G.player;
    const mods = G.augments?.mods || {};
    W.cool = 1 / (def.rate * (mods.fireRate ?? 1) * (G.augments?.fireRateBonus() ?? 1) * (player.odActive > 0 ? 1.25 : 1));
    if (player.odActive <= 0) W.ammo[W.current]--;
    W.lastShot = G.time;
    W.shotsFired++;
    G.audio?.play(def.sound, { volume: def.id === 'carbine' ? 0.8 : 1 });
    G.events.emit('weaponFired', def.id);

    // viewmodel + camera kick
    springs.pz.kick(def.kick * 9);
    springs.rx.kick(def.kick * 14);
    springs.ry.kick(rand(-1, 1) * def.kick * 3);
    const recoilScale = 1 - player.ads * 0.45;
    player.addRecoil(def.recoil * recoilScale * rand(0.8, 1.2), rand(-1, 1) * def.recoil * 0.35);
    if (def.id !== 'carbine') player.addTrauma(def.id === 'scatter' ? 0.16 : 0.12);
    W.flashT = 0.05;
    flash.material.color.set(def.color).multiplyScalar(3);
    vmLight.color.set(def.color);
    const mz = muzzleWorld(muzzleW);
    if (def.id !== 'carbine' || W.shotsFired % 3 === 0) G.lights?.flash(mz, def.color, def.id === 'carbine' ? 10 : 28, 9, 0.08);
    G.input.vibrate(def.id === 'carbine' ? 6 : 22);

    // aim direction with magnetism
    const eyeP = eye;
    dir.copy(fwd);
    const directHit = G.enemies?.raycast(eyeP.x, eyeP.y, eyeP.z, dir.x, dir.y, dir.z, def.range);
    let blocked = false;
    if (directHit) blocked = !!G.world.raycast(eyeP.x, eyeP.y, eyeP.z, dir.x, dir.y, dir.z, directHit.t);
    if (!directHit || blocked) {
      const magnetDeg = def.magnet * (G.input.source === 'touch' ? 1 : G.input.source === 'pad' ? 0.8 : 0.25) * (G.settings.aimAssist > 0 || G.input.source === 'kbm' ? 1 : 0.3);
      const target = findMagnetTarget(dir, def.range, magnetDeg * DEG);
      if (target) {
        dir.set(target.aimPoint.x - eyeP.x, target.aimPoint.y - eyeP.y, target.aimPoint.z - eyeP.z).normalize();
      }
    }
    right.set(1, 0, 0).applyQuaternion(G.camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(G.camera.quaternion);

    if (def.projectile) {
      const spread = W.spreadNow;
      const d = V1.copy(dir).addScaledVector(right, rand(-1, 1) * spread).addScaledVector(up, rand(-1, 1) * spread + 0.035).normalize();
      G.projectiles?.playerGrenade(mz, d.multiplyScalar(def.speed), def);
      return;
    }

    let anyHit = false;
    const pellets = def.pellets;
    const dmgMul = (mods.damage ?? 1) * (player.odActive > 0 ? 1.5 : 1) * (G.augments?.situationalDamage() ?? 1);
    const hitEnemies = new Map();
    for (let i = 0; i < pellets; i++) {
      const sp = pellets > 1 ? W.spreadNow * Math.sqrt(Math.random()) : W.spreadNow * Math.random();
      const ang = Math.random() * Math.PI * 2;
      const d = V2.copy(dir).addScaledVector(right, Math.cos(ang) * sp).addScaledVector(up, Math.sin(ang) * sp).normalize();
      const wh = G.world.raycast(eyeP.x, eyeP.y, eyeP.z, d.x, d.y, d.z, def.range);
      const wt = wh ? wh.t : def.range;
      let endT = wt;
      const whCopy = wh ? { x: wh.x, y: wh.y, z: wh.z, nx: wh.nx, ny: wh.ny, nz: wh.nz } : null;
      if (def.pierce) {
        const hits = G.enemies?.raycastAll(eyeP.x, eyeP.y, eyeP.z, d.x, d.y, d.z, wt) || [];
        for (const h of hits) { applyHit(def, h, d, dmgMul, hitEnemies); anyHit = true; }
      } else {
        const h = G.enemies?.raycast(eyeP.x, eyeP.y, eyeP.z, d.x, d.y, d.z, wt);
        if (h) { applyHit(def, h, d, dmgMul, hitEnemies); endT = h.t; anyHit = true; }
      }
      const end = V1.set(eyeP.x + d.x * endT, eyeP.y + d.y * endT, eyeP.z + d.z * endT);
      if (endT === wt && whCopy) {
        // world impact
        const n = { x: whCopy.nx, y: whCopy.ny, z: whCopy.nz };
        if (i % (pellets > 4 ? 3 : 1) === 0) {
          G.particles?.sparks(end, n, def.color, def.id === 'lance' ? 16 : 5, def.id === 'lance' ? 12 : 7, 2.5);
          G.decals?.add(end, n, def.id === 'lance' ? 0.6 : def.id === 'scatter' ? 0.22 : 0.26, def.color);
        }
        G.events.emit('worldImpact', { x: end.x, y: end.y, z: end.z, weapon: def.id });
      }
      // tracer
      if (def.id === 'lance') {
        G.beams?.add(mz.x, mz.y, mz.z, end.x, end.y, end.z, def.color, 5, 0.09, 0.35, 'fade', 0.08);
        G.beams?.add(mz.x, mz.y, mz.z, end.x, end.y, end.z, 0xffffff, 3, 0.025, 0.2, 'fade', 0);
        G.beams?.add(mz.x, mz.y, mz.z, end.x, end.y, end.z, def.color, 3, 0.02, 0.5, 'fade', 0.35);
      } else if (i < 6) {
        G.beams?.add(mz.x, mz.y, mz.z, end.x, end.y, end.z, def.color, 3.2 * def.tracer, pellets > 1 ? 0.018 : 0.028, pellets > 1 ? 0.09 : 0.07, 'tracer');
      }
    }
    for (const [e, info] of hitEnemies) G.enemies.reportHit(e, info);
    if (anyHit) W.shotsHit++;
    W.bloom = Math.min(def.maxBloom * DEG, W.bloom + def.bloom * DEG);
  }

  function applyHit(def, h, d, dmgMul, hitEnemies) {
    const e = h.enemy;
    const [near, far, minMul] = def.falloff;
    const fall = h.t <= near ? 1 : lerp(1, minMul, clamp((h.t - near) / (far - near), 0, 1));
    const crit = h.part === 'core';
    let dmg = def.dmg * fall * dmgMul * (crit ? def.crit * (G.augments?.mods.critDamage ?? 1) : 1);
    const res = e.damage(dmg, { part: h.part, x: h.x, y: h.y, z: h.z, dir: d, source: def.id, crit, knock: def.knock / Math.max(1, def.pellets * 0.5) });
    const agg = hitEnemies.get(e) || { dmg: 0, crit: false, killed: false, x: h.x, y: h.y, z: h.z, part: h.part, shielded: false };
    agg.dmg += res.dealt; agg.crit = agg.crit || crit; agg.killed = agg.killed || res.killed; agg.shielded = agg.shielded || res.shielded;
    hitEnemies.set(e, agg);
  }

  function updateMelee(dt) {
    const input = G.input;
    const player = G.player;
    if (G.mode === 'playing' && player.alive && input.pressed('melee') && W.meleeCool <= 0 && !W.lungeTarget) {
      W.meleeCool = 0.5 * (G.augments?.mods.meleeCool ?? 1);
      W.charging = false;
      // lunge onto a staggered target in front of us
      const t = G.enemies?.findStaggered(eye, player.forward(fwd), 9.5 * (G.augments?.mods.lungeRange ?? 1), 34 * DEG);
      if (t) {
        W.lungeTarget = t; W.lungeT = 0.32;
        player.iframes = Math.max(player.iframes, 0.5);
        G.audio?.play('dash', { volume: 0.8 });
      } else {
        W.meleeT = 0; W.meleeHitDone = false;
        G.audio?.play('melee');
      }
    }
    if (W.lungeTarget) {
      const e = W.lungeTarget;
      W.lungeT -= dt;
      const tp = e.aimPoint;
      const dx = tp.x - player.pos.x, dz = tp.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (!e.alive || W.lungeT <= 0) { W.lungeTarget = null; }
      else if (dist < 1.8 + e.radius) {
        W.lungeTarget = null;
        W.meleeT = 0; W.meleeHitDone = true;
        player.vel.x *= 0.2; player.vel.z *= 0.2;
        G.enemies.shatter(e);
        G.audio?.play('meleeHit');
      } else {
        const sp = 34;
        player.vel.x = dx / dist * sp; player.vel.z = dz / dist * sp;
        player.vel.y = clamp((tp.y - 1.2 - player.pos.y) * 6, -8, 8);
        // look at target
        const eyeP = player.eyePos;
        const tyaw = Math.atan2(-(tp.x - eyeP.x), -(tp.z - eyeP.z));
        player.yaw += (((tyaw - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 14);
        player.fovKick = Math.max(player.fovKick, 10);
      }
    }
    if (W.meleeT >= 0) {
      W.meleeT += dt;
      if (!W.meleeHitDone && W.meleeT >= 0.08) {
        W.meleeHitDone = true;
        const f = player.forward(fwd);
        const hits = G.enemies?.meleeSweep(eye, f, 3.4 * (G.augments?.mods.meleeRange ?? 1), 50 * DEG) || 0;
        const deflected = G.projectiles?.deflect(eye, f, 4.2, 70 * DEG) || 0;
        if (hits || deflected) {
          G.audio?.play(deflected ? 'deflect' : 'meleeHit');
          player.addTrauma(0.15);
          G.hitstop = Math.max(G.hitstop, 0.05);
        }
      }
      if (W.meleeT > 0.4) W.meleeT = -1;
    }
  }

  let t = 0;
  function animate(dt, rawDt) {
    t += rawDt;
    const player = G.player;
    const m = models[W.current];
    const def = W.def;
    // sway from look input (lags behind camera)
    sway.x = damp(sway.x, clamp(G.input.lookX * 8, -0.06, 0.06), 10, rawDt);
    sway.y = damp(sway.y, clamp(G.input.lookY * 8, -0.06, 0.06), 10, rawDt);
    const adsK = player.ads;
    const bob = player.bobAmt * (1 - adsK * 0.8);
    const bx = Math.cos(player.bobPhase) * 0.012 * bob;
    const by = -Math.abs(Math.sin(player.bobPhase)) * 0.014 * bob;
    const breath = Math.sin(t * 1.6) * 0.0025;
    const air = clamp(-player.vel.y * 0.0025, -0.03, 0.03) * (player.grounded ? 0 : 1);

    // reload pose
    let rl = 0;
    if (W.reloadT > 0) {
      const ph = 1 - W.reloadT / W.reloadDur;
      rl = ph < 0.2 ? ph / 0.2 : ph > 0.8 ? (1 - ph) / 0.2 : 1;
      rl = rl * rl * (3 - 2 * rl);
      if (m.mag) { m.mag.position.y = -0.05 - (ph > 0.25 && ph < 0.65 ? 0.2 : 0); m.mag.visible = !(ph > 0.3 && ph < 0.6); }
    } else if (m.mag) { m.mag.position.y = -0.05; m.mag.visible = true; }
    // swap pose (lower then raise)
    let sw = 0;
    if (W.swapT > 0) sw = W.swapT > 0.16 ? (0.32 - W.swapT) / 0.16 : W.swapT / 0.16;
    // melee pose (weapon dips right)
    let ml = 0;
    if (W.meleeT >= 0) ml = Math.sin(clamp(W.meleeT / 0.4, 0, 1) * Math.PI);

    const rest = m.rest;
    const adsX = lerp(rest.x, 0, adsK), adsY = lerp(rest.y, -(m.sightY || 0.11), adsK), adsZ = lerp(rest.z, -0.32, adsK);
    const px = springs.px.update(rawDt), py = springs.py.update(rawDt), pz = springs.pz.update(rawDt);
    const rx = springs.rx.update(rawDt), ry = springs.ry.update(rawDt), rz = springs.rz.update(rawDt);
    const dashTilt = player.dashTimer > 0 ? 0.12 : 0;
    m.group.position.set(
      adsX + bx - sway.x * (1 - adsK * 0.7) + px + ml * 0.06,
      adsY + by + breath + sway.y * 0.6 * (1 - adsK * 0.7) + py - rl * 0.07 - sw * 0.35 - ml * 0.08 + air,
      adsZ + pz * 0.012 * 3 + rl * 0.04,
    );
    m.group.rotation.set(
      rx * 0.03 + rl * 0.35 + sw * 0.6 + sway.y * 0.5,
      ry * 0.02 + sway.x * 0.8 + ml * 0.4 + 0.12 * (1 - adsK),
      rz + -rl * 0.55 + dashTilt + player.roll * 1.5 + ml * 0.3 - 0.05 * (1 - adsK),
    );
    // weapon-specific parts
    if (m.pump) m.pump.position.z = -0.3 + Math.max(0, W.cool * WEAPONS.scatter.rate - 0.45) * 0.14;
    if (m.drum) m.drum.rotation.z = damp(m.drum.rotation.z, (m.drumTarget = (m.drumTarget || 0)), 12, rawDt);
    if (m.orb) m.orb.visible = W.ammo.nova > 0 && W.reloadT <= 0;
    if (m.core) {
      const c = W.charging ? 1 - W.chargeT / (def.charge || 1) : Math.max(0, 1 - (G.time - W.lastShot) * 3);
      m.core.scale.set(1 + c * 2, 1 + c * 3, 1);
    }
    const od = player.odActive > 0 ? 1.8 + Math.sin(G.time * 12) * 0.3 : 1;
    const heat = Math.max(0, 1 - (G.time - W.lastShot) * 4);
    m.accent.color.set(def.color).multiplyScalar((1.9 + heat * 0.8) * od);
    m.readout.set(player.odActive > 0 ? '∞' : String(W.ammo[W.current]).padStart(2, '0'), W.ammo[W.current] <= Math.ceil(W.magSize(W.current) * 0.25));

    // muzzle flash
    W.flashT -= rawDt;
    if (W.flashT > 0) {
      m.group.updateMatrix();
      flash.position.copy(m.muzzle).applyMatrix4(m.group.matrix);
      flash.rotation.z = Math.random() * Math.PI;
      const s = def.id === 'carbine' ? rand(0.35, 0.55) : rand(0.9, 1.3);
      flash.scale.setScalar(s);
      flash.material.opacity = def.id === 'carbine' ? 0.55 : 0.9;
      vmLight.position.copy(flash.position);
      vmLight.intensity = def.id === 'carbine' ? 0.5 : 2.5;
    } else {
      flash.material.opacity = 0;
      vmLight.intensity = 0;
    }

    // fist
    if (W.meleeT >= 0 || W.lungeTarget) {
      fist.group.visible = true;
      const ph = W.lungeTarget ? 0.2 : clamp(W.meleeT / 0.4, 0, 1);
      const punch = ph < 0.25 ? ph / 0.25 : 1 - (ph - 0.25) / 0.75;
      const p = punch * punch * (3 - 2 * punch);
      fist.group.position.set(lerp(-0.35, -0.06, p), lerp(-0.45, -0.1, p), lerp(-0.1, -0.5, p));
      fist.group.rotation.set(lerp(0.4, 0, p), lerp(0.5, 0.1, p), lerp(0.6, 0.15, p));
      fist.glow.material.opacity = p * 0.9;
      fist.glow.scale.setScalar(0.6 + p * 0.8);
    } else fist.group.visible = false;
  }

  G.events.on('weaponFired', (id) => { if (id === 'nova' && models.nova) models.nova.drumTarget = (models.nova.drumTarget || 0) + Math.PI / 2; });
  W.reset();
  return W;
}

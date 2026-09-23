// First-person player: movement physics, camera feel, health/shield, dash, overdrive meter, aim assist.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, damp, lerp, noise1, DEG, wrapAngle } from '../util.js';

export const P = {
  radius: 0.4, height: 1.8, eye: 1.62, step: 0.5,
  speed: 8.6, groundAccel: 16, airAccel: 3.2, gravity: 24,
  jumpV: 8.6, airJumpV: 8.0,
  dashSpeed: 25, dashTime: 0.16, dashRecharge: 1.2,
  coyote: 0.12, jumpBuffer: 0.14,
};

const DIFF = {
  recruit: { dmgTaken: 0.55, shieldRegen: 1.3 },
  veteran: { dmgTaken: 1.0, shieldRegen: 1.0 },
  nightmare: { dmgTaken: 1.45, shieldRegen: 0.8 },
};

export function createPlayer() {
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const lastSafe = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const camera = G.camera;
  const tmp = new THREE.Vector3();

  const p = {
    pos, vel,
    yaw: 0, pitch: 0,
    grounded: false, groundTime: 0, airTime: 0, coyote: 0, jumpBuffer: 0,
    airJumps: 1, maxAirJumps: 1,
    dashCharges: 2, maxDash: 2, dashCool: 0, dashTimer: 0, dashDir: new THREE.Vector3(),
    iframes: 0, padLock: 0,
    hp: 100, maxHp: 100, shield: 50, maxShield: 50, shieldDelay: 0, shieldRegenRate: 26,
    od: 0, odActive: 0, odDuration: 7, odReadyAnnounced: false,
    alive: true, god: false,
    // camera feel
    eyeY: P.eye, bobPhase: 0, bobAmt: 0, roll: 0, landDip: 0, trauma: 0, fovKick: 0, recoil: 0, recoilYaw: 0,
    ads: 0, adsZoom: 1,
    stepDist: 0,
    speedNow: 0,
    kills: 0, damageDealt: 0,
    lowHealthBeat: 0,
    assistTarget: null,
    difficulty: DIFF.veteran,

    reset(start) {
      pos.set(start[0], start[1] + 0.05, start[2]);
      lastSafe.copy(pos);
      vel.set(0, 0, 0);
      p.yaw = start[3] || 0; p.pitch = 0;
      p.grounded = false; p.dashTimer = 0; p.padLock = 0; p.iframes = 0;
      p.airJumps = p.maxAirJumps;
      p.trauma = 0; p.recoil = 0; p.landDip = 0;
    },
    fullReset() {
      p.maxHp = 100; p.hp = 100; p.maxShield = 50; p.shield = 50; p.od = 0; p.odActive = 0;
      p.maxDash = 2; p.dashCharges = 2; p.maxAirJumps = 1; p.alive = true; p.kills = 0; p.damageDealt = 0;
      p.shieldRegenRate = 26; p.odDuration = 7; p.odReadyAnnounced = false;
      p.difficulty = DIFF[G.run?.difficulty] || DIFF.veteran;
    },

    get eyePos() { return tmp.set(pos.x, pos.y + p.eyeY, pos.z); },
    forward(out) {
      const cp = Math.cos(p.pitch);
      return out.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
    },

    addTrauma(t) { p.trauma = clamp(p.trauma + t * (G.settings?.shake ?? 1), 0, 1); },
    addRecoil(pitch, yaw = 0) { p.recoil += pitch; p.recoilYaw += yaw; },
    addOverdrive(x) {
      if (p.odActive > 0) return;
      const before = p.od;
      p.od = clamp(p.od + x * (G.augments?.mods.odGain ?? 1), 0, 100);
      if (before < 100 && p.od >= 100) {
        G.audio?.play('overdriveReady');
        G.hud?.announce('OVERDRIVE READY', G.input.source === 'touch' ? 'Tap ⚡' : G.input.source === 'pad' ? 'Press LB' : 'Press Q', 'od');
      }
    },

    heal(x) {
      if (!p.alive) return 0;
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + x);
      return p.hp - before;
    },
    addShield(x) { p.shield = Math.min(p.maxShield, p.shield + x); },

    damage(amount, from = null, kind = 'hit') {
      if (!p.alive || p.god || p.iframes > 0 || G.mode !== 'playing') return false;
      amount *= p.difficulty.dmgTaken * (G.augments?.mods.dmgTaken ?? 1);
      if (amount <= 0) return false;
      p.shieldDelay = 3.2;
      let toHp = amount;
      if (p.shield > 0) {
        const absorbed = Math.min(p.shield, amount);
        p.shield -= absorbed; toHp -= absorbed;
        if (p.shield <= 0) { G.audio?.play('shieldBreak'); G.hud?.flashShieldBreak(); }
      }
      if (toHp > 0) {
        p.hp -= toHp;
        G.audio?.play('playerHurt', { volume: clamp(0.5 + toHp / 30, 0.5, 1) });
      } else {
        G.audio?.play('shieldHit', { volume: 0.7 });
      }
      G.renderer.post.uDamage.value = Math.min(1, G.renderer.post.uDamage.value + 0.35 + amount / 40);
      p.addTrauma(0.18 + amount / 60);
      if (from) G.hud?.damageFrom(from);
      G.input.vibrate(toHp > 0 ? 40 : 18);
      G.events.emit('playerDamaged', { amount, toHp, kind });
      if (p.hp <= 0) {
        p.hp = 0;
        if (G.augments?.tryCheatDeath()) {
          if (p.hp <= 0) p.hp = 1;
          p.iframes = 2;
          return true;
        }
        p.hp = 0;
        p.alive = false;
        G.events.emit('playerDied');
      }
      return true;
    },

    update(dt, rawDt) {
      const input = G.input;
      const world = G.world;
      if (!p.alive) { updateCamera(rawDt); return; }

      // ---------- look ----------
      let lx = input.lookX, ly = input.lookY;
      if (p.ads > 0.5) { lx *= 0.62; ly *= 0.62; }
      const assist = aimAssist(lx, ly, rawDt);
      lx = assist.lx; ly = assist.ly;
      p.yaw = wrapAngle(p.yaw + lx);
      p.pitch = clamp(p.pitch + ly, -1.52, 1.52);

      // ---------- timers ----------
      if (p.iframes > 0) p.iframes -= dt;
      if (p.padLock > 0) p.padLock -= dt;
      if (p.dashCharges < p.maxDash) {
        p.dashCool += dt * (G.augments?.mods.dashRecharge ?? 1);
        if (p.dashCool >= P.dashRecharge) { p.dashCool = 0; p.dashCharges++; }
      } else p.dashCool = 0;
      if (p.shieldDelay > 0) p.shieldDelay -= dt;
      else if (p.shield < p.maxShield) {
        if (p.shield === 0 || p._regenSound !== true) { G.audio?.play('shieldRegen', { volume: 0.5 }); p._regenSound = true; }
        p.shield = Math.min(p.maxShield, p.shield + p.shieldRegenRate * p.difficulty.shieldRegen * dt);
      } else p._regenSound = false;

      // ---------- overdrive ----------
      if (p.odActive > 0) {
        p.odActive -= rawDt;
        p.od = Math.max(0, (p.odActive / p.odDuration) * 100);
        if (p.odActive <= 0) {
          p.odActive = 0; p.od = 0;
          G.audio?.play('overdriveEnd');
          G.audio?.music.setOverdrive(false);
          G.events.emit('overdrive', false);
        }
      } else if (input.pressed('overdrive') && p.od >= 100) {
        const dur = 7 + (G.augments?.mods.odDuration ?? 0);
        p.odActive = dur;
        p.odDuration = dur;
        G.audio?.play('overdriveStart');
        G.audio?.music.setOverdrive(true);
        G.renderer.post.uFlash.value = 0.5;
        G.renderer.post.uFlashColor.value.set(0x9fe8ff);
        p.addTrauma(0.3);
        G.hud?.announce('OVERDRIVE', 'Time slows. You don\'t.', 'od');
        G.events.emit('overdrive', true);
      }

      // ---------- movement ----------
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const mx = input.move.x, my = input.move.y;
      let wx = cy * mx - sy * my;   // right * x + forward * y
      let wz = -sy * mx - cy * my;
      const wishLen = Math.hypot(wx, wz);
      const speed = P.speed * (G.augments?.mods.moveSpeed ?? 1) * (p.ads > 0.5 ? 0.72 : 1);

      // jump buffering / coyote time
      if (input.pressed('jump')) p.jumpBuffer = P.jumpBuffer;
      else p.jumpBuffer -= dt;
      if (p.grounded) p.coyote = P.coyote; else p.coyote -= dt;

      // dash
      if (input.pressed('dash') && p.dashCharges > 0 && p.dashTimer <= 0) {
        p.dashCharges--;
        if (wishLen > 0.1) p.dashDir.set(wx / wishLen, 0, wz / wishLen);
        else p.dashDir.set(-sy, 0, -cy);
        p.dashTimer = P.dashTime;
        p.iframes = Math.max(p.iframes, 0.24);
        vel.x = p.dashDir.x * P.dashSpeed; vel.z = p.dashDir.z * P.dashSpeed;
        if (!p.grounded) vel.y = Math.max(vel.y, 1.2);
        p.fovKick = Math.min(p.fovKick + 9, 14);
        G.renderer.post.uChroma.value = Math.min(1.4, G.renderer.post.uChroma.value + 0.9);
        G.audio?.play('dash');
        G.particles?.dashBurst(pos, p.dashDir);
        G.events.emit('dash');
      }

      if (p.dashTimer > 0) {
        p.dashTimer -= dt;
        vel.x = p.dashDir.x * P.dashSpeed; vel.z = p.dashDir.z * P.dashSpeed;
        vel.y = Math.max(vel.y, p.grounded ? 0 : -2);
        if (p.dashTimer <= 0) {
          const h = Math.hypot(vel.x, vel.z), cap = speed * 1.3;
          if (h > cap) { vel.x *= cap / h; vel.z *= cap / h; }
        }
      } else {
        const tx = wishLen > 0 ? wx * speed : 0, tz = wishLen > 0 ? wz * speed : 0;
        if (p.grounded) {
          const k = 1 - Math.exp(-P.groundAccel * dt);
          vel.x += (tx - vel.x) * k; vel.z += (tz - vel.z) * k;
        } else if (wishLen > 0.05) {
          const ctrl = p.padLock > 0 ? 0.15 : 1;
          const k = 1 - Math.exp(-P.airAccel * ctrl * dt);
          // preserve momentum above run speed in the air
          const h = Math.hypot(vel.x, vel.z);
          vel.x += (tx - vel.x) * k; vel.z += (tz - vel.z) * k;
          const h2 = Math.hypot(vel.x, vel.z);
          const keep = Math.max(speed, h * 0.995);
          if (h2 > keep) { vel.x *= keep / h2; vel.z *= keep / h2; }
        }
      }

      // jumping
      if (p.jumpBuffer > 0) {
        if (p.grounded || p.coyote > 0) {
          vel.y = P.jumpV; p.grounded = false; p.coyote = 0; p.jumpBuffer = 0;
          G.audio?.play('jump', { volume: 0.6 });
          G.events.emit('jump');
        } else if (p.airJumps > 0 && p.padLock <= 0) {
          vel.y = P.airJumpV; p.airJumps--; p.jumpBuffer = 0;
          G.audio?.play('doubleJump');
          G.particles?.jumpRing(pos);
          p.fovKick = Math.min(p.fovKick + 3, 14);
          G.events.emit('jump');
        }
      }

      // gravity
      if (!p.grounded && p.dashTimer <= 0) vel.y -= P.gravity * dt;
      if (vel.y < -40) vel.y = -40;

      // integrate with sub-steps to avoid tunneling at dash speed
      const wasGrounded = p.grounded;
      const fallSpeed = -vel.y;
      const travel = Math.hypot(vel.x, vel.y, vel.z) * dt;
      const steps = Math.min(6, Math.max(1, Math.ceil(travel / 0.22)));
      const sdt = dt / steps;
      let grounded = false;
      for (let s = 0; s < steps; s++) {
        pos.x += vel.x * sdt; pos.z += vel.z * sdt;
        world.pushCylinder(pos, vel, P.radius, P.height, P.step);
        pos.y += vel.y * sdt;
        // ceiling
        if (vel.y > 0) {
          const ceil = world.ceilingHeight(pos.x, pos.z, P.radius * 0.8, pos.y + P.height - vel.y * sdt - 0.05);
          if (pos.y + P.height > ceil) { pos.y = ceil - P.height; vel.y = 0; }
        }
        // ground
        const g = world.groundHeight(pos.x, pos.z, P.radius * 0.72, pos.y + P.step);
        if (vel.y <= 0 && pos.y <= g + 0.001) {
          const rise = g - pos.y;
          pos.y = g; vel.y = 0; grounded = true;
          if (rise > 0.05) p.eyeY -= rise; // smooth step-ups
        } else if (wasGrounded && vel.y <= 0 && pos.y - g < 0.35 && p.dashTimer <= 0) {
          pos.y = g; vel.y = 0; grounded = true; // stick to slopes / small drops
        }
      }
      p.grounded = grounded;
      if (grounded) {
        p.groundTime += dt; p.airTime = 0; p.airJumps = p.maxAirJumps;
        if (!wasGrounded) {
          if (fallSpeed > 5) {
            p.landDip = Math.min(0.28, fallSpeed * 0.016);
            G.audio?.play('land', { volume: clamp(fallSpeed / 20, 0.25, 1) });
            if (fallSpeed > 14) p.addTrauma(0.12);
          }
          G.events.emit('land', fallSpeed);
        }
        if (Math.abs(pos.y - lastSafe.y) < 6 && p.padLock <= 0) lastSafe.copy(pos);
      } else { p.groundTime = 0; p.airTime += dt; }

      // jump pads
      for (const pad of G.arena.pads) {
        if (pad.cool > 0) continue;
        const dx = pos.x - pad.x, dz = pos.z - pad.z;
        if (dx * dx + dz * dz < pad.r * pad.r && Math.abs(pos.y - pad.y) < 0.6 && vel.y <= 0.5) launch(pad);
      }

      // void
      if (pos.y < world.killY || Math.hypot(pos.x, pos.z) > G.arena.bounds + 60) fellOff();

      // footsteps
      p.speedNow = Math.hypot(vel.x, vel.z);
      if (p.grounded && p.speedNow > 1) {
        p.stepDist += p.speedNow * dt;
        if (p.stepDist > 2.6) { p.stepDist = 0; G.audio?.play('footstep', { volume: 0.35 }); }
      }

      // ADS
      const wantAds = input.isHeld('ads') && G.weapons?.canAds();
      p.ads = damp(p.ads, wantAds ? 1 : 0, 14, rawDt);

      // low health heartbeat
      const lowHp = p.hp / p.maxHp < 0.3;
      if (lowHp) {
        p.lowHealthBeat -= rawDt;
        if (p.lowHealthBeat <= 0) { p.lowHealthBeat = 0.85; G.audio?.play('lowHealth', { volume: 0.7 }); }
      }
      G.renderer.post.uLowHealth.value = damp(G.renderer.post.uLowHealth.value, lowHp ? 0.6 + 0.4 * Math.sin(G.time * 7.4) : 0, 6, rawDt);
      if (p._low !== lowHp) { p._low = lowHp; G.audio?.music.setLowHealth(lowHp); }

      updateCamera(rawDt);
    },
  };

  function launch(pad) {
    const d = tmp.subVectors(pad.to, pos);
    const horiz = Math.hypot(d.x, d.z);
    let T = clamp(horiz / 12, 0.8, 1.45);
    const vy = (d.y + 0.5 * P.gravity * T * T) / T;
    vel.set(d.x / T, vy, d.z / T);
    p.grounded = false; p.padLock = T * 0.85; p.airJumps = p.maxAirJumps;
    pad.cool = 0.6;
    p.fovKick = Math.min(p.fovKick + 8, 14);
    G.audio?.play('jumpPad', { pos: { x: pad.x, y: pad.y, z: pad.z } });
    G.particles?.padBurst(pad);
    G.events.emit('jumpPad');
  }

  function fellOff() {
    // return to the closest safe ground spawn
    let best = null, bd = Infinity;
    const cands = [lastSafe.toArray(), ...G.arena.spawns.ground];
    for (const c of cands) {
      const d = (c[0] - pos.x) ** 2 + (c[2] - pos.z) ** 2;
      if (d < bd && G.world.groundHeight(c[0], c[2], 0.3, c[1] + 1) > -5) { bd = d; best = c; }
    }
    best = best || G.arena.start;
    pos.set(best[0], best[1] + 0.2, best[2]);
    vel.set(0, 0, 0);
    p.iframes = 0;
    p.damage(18, null, 'fall');
    p.iframes = 1.2;
    G.renderer.post.uFade.value = 0.9;
    G.renderer.post.uFadeColor.value.set(0x000000);
    G.hud?.announce('SIGNAL LOST', 'Frame recovered · -18', 'warn');
    G.audio?.play('teleport', { volume: 0.7 });
    G.events.emit('fell');
  }

  // Aim assist for touch & gamepad: slows the reticle over targets and gently pulls toward them.
  function aimAssist(lx, ly, dt) {
    const strength = G.settings?.aimAssist ?? 1;
    p.assistTarget = null;
    if (strength <= 0 || G.input.source === 'kbm' || !G.enemies) return { lx, ly };
    const eye = p.eyePos;
    const f = p.forward(fwd);
    const maxAng = (G.input.source === 'touch' ? 9 : 7) * DEG * (0.7 + strength * 0.3);
    let best = null, bestAng = maxAng, bestPoint = null;
    for (const e of G.enemies.list) {
      if (!e.alive || e.warp > 0) continue;
      const ap = e.aimPoint;
      const dx = ap.x - eye.x, dy = ap.y - eye.y, dz = ap.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 55 || dist < 0.5) continue;
      const cos = (dx * f.x + dy * f.y + dz * f.z) / dist;
      const ang = Math.acos(clamp(cos, -1, 1)) - Math.atan(e.radius / dist) * 0.6;
      if (ang < bestAng && G.world.lineOfSight(eye.x, eye.y, eye.z, ap.x, ap.y, ap.z)) {
        bestAng = ang; best = e; bestPoint = ap;
      }
    }
    if (!best) return { lx, ly };
    p.assistTarget = best;
    const lookMag = Math.hypot(lx, ly);
    // friction: slow the reticle while it crosses a target
    const fr = 1 - 0.38 * strength * (1 - bestAng / maxAng);
    lx *= fr; ly *= fr;
    // magnetism: pull toward the target while the player is actively aiming or moving
    const moving = Math.hypot(G.input.move.x, G.input.move.y) > 0.2;
    if (lookMag > 0.0005 || moving || G.input.isHeld('fire')) {
      const dx = bestPoint.x - eye.x, dy = bestPoint.y - eye.y, dz = bestPoint.z - eye.z;
      const tYaw = Math.atan2(-dx, -dz);
      const tPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const k = (G.input.source === 'touch' ? 5.5 : 3.8) * strength * dt * (1 - bestAng / maxAng * 0.6);
      lx += wrapAngle(tYaw - p.yaw) * Math.min(1, k);
      ly += (tPitch - p.pitch) * Math.min(1, k * 0.8);
    }
    return { lx, ly };
  }

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function updateCamera(dt) {
    // eye height smoothing after step-ups (and a slow collapse on death)
    p.eyeY = damp(p.eyeY, p.alive ? P.eye : 0.4, p.alive ? 18 : 2.2, dt);
    // head bob
    const moving = p.grounded && p.speedNow > 1.5;
    p.bobAmt = damp(p.bobAmt, moving ? Math.min(1, p.speedNow / P.speed) : 0, 10, dt);
    if (moving) p.bobPhase += dt * p.speedNow * 1.25;
    const bobY = Math.sin(p.bobPhase * 2) * 0.035 * p.bobAmt;
    const bobX = Math.cos(p.bobPhase) * 0.02 * p.bobAmt;
    p.landDip = damp(p.landDip, 0, 9, dt);
    // strafe roll
    const right = Math.cos(p.yaw) * vel.x - Math.sin(p.yaw) * vel.z;
    p.roll = damp(p.roll, p.alive ? -right / P.speed * 1.6 * DEG : 0.45, p.alive ? 8 : 1.5, dt);
    // shake
    p.trauma = Math.max(0, p.trauma - dt * 1.7);
    const sh = p.trauma * p.trauma;
    const t = G.time * 22;
    const shYaw = noise1(t) * 0.05 * sh, shPitch = noise1(t + 50) * 0.05 * sh, shRoll = noise1(t + 100) * 0.07 * sh;
    // recoil recovery
    p.recoil = damp(p.recoil, 0, 9, dt);
    p.recoilYaw = damp(p.recoilYaw, 0, 9, dt);

    camera.position.set(pos.x + bobX * Math.cos(p.yaw), pos.y + p.eyeY + bobY - p.landDip, pos.z - bobX * Math.sin(p.yaw));
    euler.set(p.pitch + p.recoil + shPitch, p.yaw + p.recoilYaw + shYaw, p.roll + shRoll);
    camera.quaternion.setFromEuler(euler);

    // FOV (settings are horizontal degrees; convert for the current aspect)
    p.fovKick = damp(p.fovKick, 0, 5, dt);
    const hfov = (G.settings?.fov ?? 100) + p.fovKick + (p.odActive > 0 ? -4 : 0);
    const aspect = camera.aspect || 1.6;
    let vfov = 2 * Math.atan(Math.tan(hfov * DEG / 2) / Math.max(aspect, 0.75)) / DEG;
    vfov = clamp(vfov, 40, 95);
    const zoom = lerp(1, p.adsZoom, p.ads);
    vfov = 2 * Math.atan(Math.tan(vfov * DEG / 2) / zoom) / DEG;
    if (Math.abs(camera.fov - vfov) > 0.01) { camera.fov = vfov; camera.updateProjectionMatrix(); }
  }

  return p;
}

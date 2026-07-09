// ============================================================================
// ELDERFALL — player.js
// First-person controller: smooth accel/friction movement, terrain following
// with steep-slope slide, cylinder-collider push-out, water swim/buoyancy,
// jump/gravity/fall damage, sprint + stamina, head-bob with footstep events,
// landing dip, sprint FOV lerp, trauma-style screen shake, stats/XP/leveling,
// damage/heal/respawn, save serialization.
// Owns the camera TRANSFORM (position/rotation + FOV offset from base).
// ============================================================================
import * as THREE from 'three';
import {
  terrainHeight, terrainNormal, biomeAt, BIOME, WATER_LEVEL,
  clamp, lerp, dist2d, POIS,
} from './core.js';

// ---------------------------------------------------------------------------
// Tuning (the FEEL) — units are meters / seconds / radians
// ---------------------------------------------------------------------------
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 7.6;
const ACCEL = 40;              // ground acceleration toward wish velocity
const AIR_ACCEL = 10;          // reduced air control
const FRICTION = 10;           // exp ground friction when no input (snappy stop)
const AIR_DRAG = 0.35;
const GRAVITY = 22;
const JUMP_VEL = 7.6;
const PITCH_MAX = 1.35;
const PLAYER_HEIGHT = 1.8;     // vertical span for collider hMin/hMax tests

const STAM_SPRINT_DRAIN = 12;  // per second
const STAM_REGEN = 16;         // per second
const STAM_REGEN_DELAY = 0.8;  // seconds after last spend
const STAM_JUMP_COST = 12;
const STAM_RECOVER_AT = 20;    // exhausted until stamina climbs back here

const FALL_DMG_SPEED = 12;     // m/s impact threshold
const FALL_DMG_SCALE = 5;      // hp per m/s over threshold

const WATER_MOVE_MULT = 0.45;
const WATER_FLOAT_Y = WATER_LEVEL - 1.15; // buoyancy spring target (feet)
const WATER_MAX_SINK = 1.4;              // can't sink deeper than this

const SLIDE_NY = 0.75;         // slope steepness (normal.y) below which we slide
const SNAP_DOWN = 0.35;        // stick-to-ground distance when walking downhill
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;

// Head bob — SUBTLE. Vertical is sin(2*phase); one footstep per PI of phase.
const BOB_FREQ = 1.55;         // phase rad per meter travelled
const BOB_AMP_WALK = 0.018;
const BOB_AMP_SPRINT = 0.042;

const SPRINT_FOV_ADD = 6;

export function createPlayer(g) {
  // --- kinematic state -----------------------------------------------------
  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  let dead = false;

  // --- camera feel state ---------------------------------------------------
  const camera = g.camera;
  camera.rotation.order = 'YXZ';
  const baseFov = camera.fov;    // main owns the base; we add a sprint offset
  let fovOff = 0;
  let bobPhase = 0, bobAmp = 0, lastStepIdx = 0;
  let dipPos = 0, dipVel = 0;    // landing dip spring (camera Y offset)
  let shake = 0;                 // trauma 0..1, amplitude = shake^2

  // --- stamina / misc timers -----------------------------------------------
  let staminaIdle = STAM_REGEN_DELAY; // time since last stamina spend
  let exhausted = false;
  let coyoteT = 0, jumpBufT = 0;
  let sliding = false;           // on a too-steep slope last resolve

  // --- preallocated scratch (zero per-frame allocations) ---------------------
  const groundNormal = { x: 0, y: 1, z: 0 };
  const nullInput = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    jumpPressed: false, sprintOn: false,
  };
  const footstepEvt = { surface: 'grass' };
  const damagedEvt = { amount: 0, fromPos: null };
  const diedEvt = {};
  const levelEvt = { level: 1 };

  // POIs whose ground reads as stone underfoot
  const stonePois = [];
  for (const p of POIS) {
    if (p.id === 'ruins' || p.id === 'tower' || p.id === 'stones' || p.id === 'shrine') {
      stonePois.push(p);
    }
  }

  const player = {
    update,
    position,
    velocity,
    yaw: 0,
    pitch: 0,
    onGround: true,
    inWater: false,
    isBlocking: false, // SET BY combat
    stats: {
      hp: 100, maxHp: 100,
      stamina: 100, maxStamina: 100,
      mana: 60, maxMana: 60,
      level: 1, xp: 0, xpNext: 100,
      gold: 25, potions: 2,
    },
    bonus: { dmg: 0, maxHp: 0 }, // quest rewards add here
    eyeHeight: 1.7,
    radius: 0.45,
    damage, heal, addXP, addGold, addShake, respawn,
    serialize, deserialize,
  };
  const stats = player.stats;

  const effMaxHp = () => stats.maxHp + player.bonus.maxHp;

  function placeAtSpawn() {
    // Spawn just outside the village center, facing the well at (0,0)
    position.set(6, terrainHeight(6, 14), 14);
    player.yaw = Math.atan2(6, 14); // forward = (-sin,0,-cos) → points at origin
    player.pitch = 0;
    velocity.set(0, 0, 0);
    player.onGround = true;
    player.inWater = false;
    coyoteT = 0; jumpBufT = 0;
    bobAmp = 0; dipPos = 0; dipVel = 0; shake = 0; fovOff = 0;
    lastStepIdx = Math.floor((bobPhase + Math.PI * 0.25) / Math.PI);
  }
  placeAtSpawn();
  applyCamera(); // valid camera on frame 0

  // -------------------------------------------------------------------------
  // Public: stats / lifecycle
  // -------------------------------------------------------------------------
  function damage(amount, fromPos) {
    if (dead || !(amount > 0)) return;
    stats.hp -= amount;
    addShake(clamp(0.22 + amount * 0.014, 0, 0.65));
    // Death is decided BEFORE any event fires: listeners (rpg XP -> level-up
    // full restore) must never be able to cancel a lethal hit.
    const lethal = stats.hp <= 0;
    if (lethal) {
      stats.hp = 0;
      dead = true; // emit playerDied exactly once; ui shows death screen
    }
    damagedEvt.amount = amount;
    damagedEvt.fromPos = fromPos || null;
    g.events.emit('playerDamaged', damagedEvt);
    if (lethal) g.events.emit('playerDied', diedEvt);
  }

  function heal(n) {
    if (dead || !(n > 0)) return;
    stats.hp = Math.min(stats.hp + n, effMaxHp());
  }

  function addXP(n) {
    if (!(n > 0)) return;
    stats.xp += n;
    while (stats.xp >= stats.xpNext) {
      stats.xp -= stats.xpNext;
      stats.level += 1;
      stats.xpNext = Math.round(stats.xpNext * 1.35);
      stats.maxHp += 10;
      stats.maxStamina += 8;
      stats.maxMana += 6;
      // Full restore on level-up — but never resurrect a corpse (post-mortem
      // XP from in-flight kills/quests must not refill the bar under the
      // death screen; respawn() handles revival).
      if (!dead) {
        stats.hp = effMaxHp();
        stats.stamina = stats.maxStamina;
        stats.mana = stats.maxMana;
        exhausted = false;
      }
      levelEvt.level = stats.level;
      g.events.emit('levelUp', levelEvt);
    }
  }

  function addGold(n) {
    stats.gold = Math.max(0, stats.gold + (n | 0));
  }

  // Screen-shake impulse, strength 0..1 (trauma model: amplitude = trauma^2)
  function addShake(strength) {
    shake = Math.min(1, shake + (strength || 0));
  }

  function respawn() {
    dead = false;
    placeAtSpawn();
    stats.hp = Math.max(1, Math.ceil(effMaxHp() * 0.5));
    stats.stamina = stats.maxStamina;
    stats.mana = stats.maxMana;
    exhausted = false;
    staminaIdle = STAM_REGEN_DELAY;
    player.isBlocking = false;
    applyCamera();
  }

  function serialize() {
    return {
      pos: { x: position.x, y: position.y, z: position.z },
      yaw: player.yaw,
      pitch: player.pitch,
      stats: Object.assign({}, stats),
      bonus: Object.assign({}, player.bonus),
    };
  }

  function deserialize(o) {
    if (!o) return;
    if (o.pos && typeof o.pos.x === 'number') {
      position.set(o.pos.x, o.pos.y || 0, o.pos.z || 0);
    }
    if (typeof o.yaw === 'number') player.yaw = o.yaw;
    if (typeof o.pitch === 'number') player.pitch = clamp(o.pitch, -PITCH_MAX, PITCH_MAX);
    if (o.stats) {
      for (const k in stats) {
        if (typeof o.stats[k] === 'number' && isFinite(o.stats[k])) stats[k] = o.stats[k];
      }
    }
    if (o.bonus) {
      for (const k in player.bonus) {
        if (typeof o.bonus[k] === 'number' && isFinite(o.bonus[k])) player.bonus[k] = o.bonus[k];
      }
    }
    if (stats.hp <= 0) stats.hp = 1; // never load into a dead state
    dead = false;
    exhausted = false;
    velocity.set(0, 0, 0);
    // Keep feet safely on/above ground after terrain-independent saves
    const gh = terrainHeight(position.x, position.z);
    if (position.y < gh) position.y = gh;
    player.onGround = true;
    player.inWater = position.y < WATER_LEVEL;
    applyCamera();
  }

  // -------------------------------------------------------------------------
  // Footstep surface (only evaluated on step events — not per-frame)
  // -------------------------------------------------------------------------
  function surfaceUnderfoot() {
    if (player.inWater) return 'water';
    for (let i = 0; i < stonePois.length; i++) {
      const p = stonePois[i];
      if (dist2d(position.x, position.z, p.x, p.z) < p.r) return 'stone';
    }
    const b = biomeAt(position.x, position.z);
    if (b === BIOME.ROCKY || b === BIOME.SNOW) return 'stone';
    if (b === BIOME.SAND || b === BIOME.MARSH) return 'sand';
    return 'grass';
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  function update(dt) {
    if (g.paused) return;
    const rawDt = g.time.rawDt;
    const input = (g.ui && g.ui.input) ? g.ui.input : nullInput;

    // ---- look -------------------------------------------------------------
    if (!dead && input.look) {
      player.yaw -= input.look.dx || 0;
      player.pitch = clamp(player.pitch - (input.look.dy || 0), -PITCH_MAX, PITCH_MAX);
      // keep yaw bounded for float precision
      if (player.yaw > Math.PI) player.yaw -= Math.PI * 2;
      else if (player.yaw < -Math.PI) player.yaw += Math.PI * 2;
    }

    // ---- move intent --------------------------------------------------------
    let mx = 0, my = 0;
    if (!dead && input.move) {
      mx = input.move.x || 0;
      my = input.move.y || 0;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1) { mx /= mlen; my /= mlen; }
    }
    const moving = (mx * mx + my * my) > 0.0025;

    // ---- sprint / stamina ---------------------------------------------------
    if (stats.stamina <= 0) { stats.stamina = 0; exhausted = true; }
    else if (stats.stamina >= STAM_RECOVER_AT) exhausted = false;

    const sprinting = !dead && !!input.sprintOn && moving && !exhausted &&
      !player.inWater && !player.isBlocking;

    if (sprinting) {
      stats.stamina -= STAM_SPRINT_DRAIN * dt;
      staminaIdle = 0;
    } else {
      staminaIdle += dt;
      if (staminaIdle >= STAM_REGEN_DELAY && stats.stamina < stats.maxStamina) {
        stats.stamina = Math.min(stats.maxStamina, stats.stamina + STAM_REGEN * dt);
      }
    }

    // ---- target speed -------------------------------------------------------
    let speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (player.inWater) speed = WALK_SPEED * WATER_MOVE_MULT; // sprint disabled
    if (player.isBlocking) speed *= 0.5;

    // ---- wish direction (yaw space → world) ---------------------------------
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const wishX = -sy * my + cy * mx;
    const wishZ = -cy * my - sy * mx;
    const targetVx = wishX * speed;
    const targetVz = wishZ * speed;

    // ---- horizontal friction + acceleration ---------------------------------
    if (player.onGround || player.inWater) {
      if (!moving || dead) {
        // hard exp friction only when coasting → crisp, weighty stops
        const f = Math.exp(-(sliding ? 1.5 : FRICTION) * dt);
        velocity.x *= f; velocity.z *= f;
      }
    } else {
      const f = Math.exp(-AIR_DRAG * dt);
      velocity.x *= f; velocity.z *= f;
    }
    if (moving && !dead) {
      let accel = player.onGround ? ACCEL : AIR_ACCEL;
      if (player.inWater) accel *= 0.6;
      const dvx = targetVx - velocity.x;
      const dvz = targetVz - velocity.z;
      const dlen = Math.hypot(dvx, dvz);
      if (dlen > 1e-6) {
        const step = accel * dt;
        if (step >= dlen) { velocity.x = targetVx; velocity.z = targetVz; }
        else {
          velocity.x += (dvx / dlen) * step;
          velocity.z += (dvz / dlen) * step;
        }
      }
    }

    // ---- steep slope slide ---------------------------------------------------
    sliding = false;
    if (player.onGround && !player.inWater) {
      terrainNormal(position.x, position.z, 1.0, groundNormal);
      if (groundNormal.y < SLIDE_NY) {
        sliding = true;
        // horizontal part of the normal points downhill
        const hl = Math.hypot(groundNormal.x, groundNormal.z);
        if (hl > 1e-5) {
          const k = (SLIDE_NY - groundNormal.y) / SLIDE_NY; // 0..1 steepness
          const a = 14 + 80 * k;
          velocity.x += (groundNormal.x / hl) * a * dt;
          velocity.z += (groundNormal.z / hl) * a * dt;
        }
      }
    }

    // ---- vertical: gravity or water buoyancy ----------------------------------
    if (player.inWater && !player.onGround) {
      // spring toward float depth + damping = gentle bobbing at the surface
      velocity.y += clamp(WATER_FLOAT_Y - position.y, -1.2, 1.2) * 11 * dt;
      velocity.y -= GRAVITY * 0.1 * dt; // slight weight so it settles low
      velocity.y *= Math.exp(-2.6 * dt);
    } else {
      velocity.y -= GRAVITY * dt;
    }

    // ---- jump (buffered + coyote time; no jumping while swimming) --------------
    coyoteT = player.onGround ? COYOTE_TIME : Math.max(0, coyoteT - dt);
    jumpBufT = (!dead && input.jumpPressed) ? JUMP_BUFFER : Math.max(0, jumpBufT - dt);
    if (jumpBufT > 0 && coyoteT > 0 && !player.inWater && !dead) {
      velocity.y = JUMP_VEL;
      player.onGround = false;
      coyoteT = 0; jumpBufT = 0;
      stats.stamina = Math.max(0, stats.stamina - STAM_JUMP_COST);
      staminaIdle = 0;
    }

    // ---- integrate --------------------------------------------------------------
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    position.z += velocity.z * dt;

    // ---- cylinder collider push-out ----------------------------------------------
    const colliders = g.colliders;
    const R = player.radius;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const rr = c.r + R;
      let dx = position.x - c.x;
      if (dx > rr || dx < -rr) continue;
      let dz = position.z - c.z;
      if (dz > rr || dz < -rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      if (c.hMax !== undefined && position.y >= c.hMax) continue;
      if (c.hMin !== undefined && position.y + PLAYER_HEIGHT <= c.hMin) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const nx = dx / d, nz = dz / d;
      position.x = c.x + nx * rr;
      position.z = c.z + nz * rr;
      const into = velocity.x * nx + velocity.z * nz;
      if (into < 0) { velocity.x -= nx * into; velocity.z -= nz * into; }
    }

    // ---- ground resolve / landing --------------------------------------------------
    const wasOnGround = player.onGround;
    const gh = terrainHeight(position.x, position.z);
    if (position.y <= gh) {
      if (!wasOnGround) {
        const impact = -velocity.y;
        if (impact > 3.2) {
          // landing dip: quick crouch that springs back
          dipVel -= clamp(impact * 0.028, 0.08, 0.5);
          addShake(clamp((impact - 6) * 0.02, 0, 0.18));
        }
        // fall damage (water landings are cushioned)
        if (impact > FALL_DMG_SPEED && gh > WATER_LEVEL && !player.inWater) {
          damage((impact - FALL_DMG_SPEED) * FALL_DMG_SCALE);
        }
      }
      position.y = gh;
      velocity.y = 0;
      player.onGround = true;
    } else if (wasOnGround && velocity.y <= 0.001 && position.y - gh < SNAP_DOWN) {
      // stick to ground walking downhill so stairsteps don't feel floaty
      position.y = gh;
      velocity.y = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    // ---- water state / max sink -------------------------------------------------------
    player.inWater = position.y < WATER_LEVEL;
    if (!player.onGround && position.y < WATER_LEVEL - WATER_MAX_SINK) {
      position.y = WATER_LEVEL - WATER_MAX_SINK; // auto-float: can't go deeper
      if (velocity.y < 0) velocity.y = 0;
    }

    // ---- head bob + footsteps --------------------------------------------------------
    const hSpeed = Math.hypot(velocity.x, velocity.z);
    const bobActive = player.onGround && hSpeed > 0.6 && !dead;
    const targetAmp = bobActive
      ? lerp(BOB_AMP_WALK, BOB_AMP_SPRINT,
          clamp((hSpeed - WALK_SPEED * 0.6) / (SPRINT_SPEED - WALK_SPEED * 0.6), 0, 1))
      : 0;
    bobAmp += (targetAmp - bobAmp) * (1 - Math.exp(-10 * dt));
    if (bobActive) {
      bobPhase += hSpeed * BOB_FREQ * dt;
      const stepIdx = Math.floor((bobPhase + Math.PI * 0.25) / Math.PI);
      if (stepIdx !== lastStepIdx) {
        lastStepIdx = stepIdx;
        footstepEvt.surface = surfaceUnderfoot();
        g.events.emit('footstep', footstepEvt);
      }
    } else {
      lastStepIdx = Math.floor((bobPhase + Math.PI * 0.25) / Math.PI);
    }

    // ---- landing dip spring -------------------------------------------------------------
    dipPos += dipVel * dt;
    dipVel += (-dipPos * 140 - dipVel * 13) * dt;

    // ---- sprint FOV ------------------------------------------------------------------------
    const fovTarget = (sprinting && hSpeed > WALK_SPEED + 0.2) ? SPRINT_FOV_ADD : 0;
    fovOff += (fovTarget - fovOff) * (1 - Math.exp(-6 * dt));
    const wantFov = baseFov + fovOff;
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }

    // ---- shake decay (real time so hitstop doesn't stall it noticeably) ----------------------
    shake = Math.max(0, shake * Math.exp(-4.5 * rawDt) - 0.35 * rawDt);

    applyCamera();
  }

  // -------------------------------------------------------------------------
  // Camera transform: eye + bob + dip, rotation + trauma shake jitter
  // -------------------------------------------------------------------------
  function applyCamera() {
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const bobY = Math.sin(bobPhase * 2) * bobAmp;
    const bobLat = Math.cos(bobPhase) * bobAmp * 1.1;
    const roll = Math.cos(bobPhase) * bobAmp * 0.12; // tiny sway roll

    // right vector = (cos yaw, 0, -sin yaw)
    camera.position.x = position.x + cy * bobLat;
    camera.position.y = position.y + player.eyeHeight + bobY + dipPos;
    camera.position.z = position.z - sy * bobLat;

    // trauma-style shake: amplitude = shake^2, pure rotational jitter
    const tr = shake * shake;
    const shPitch = (Math.random() * 2 - 1) * 0.045 * tr;
    const shYaw = (Math.random() * 2 - 1) * 0.045 * tr;
    const shRoll = (Math.random() * 2 - 1) * 0.06 * tr;

    camera.rotation.x = player.pitch + shPitch;
    camera.rotation.y = player.yaw + shYaw;
    camera.rotation.z = roll + shRoll;
  }

  return player;
}

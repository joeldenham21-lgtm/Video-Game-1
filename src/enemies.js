// ============================================================================
// ELDERFALL — enemies.js
// Enemy AI, procedural low-poly models & animation, seeded spawn system,
// the drake boss (Vhastrix), the barrowlord mini-boss, and the nemesis
// bandit lord Vargr Redfang. Owns `enemyKilled`, `spawnLoot`, `combatState`
// and `bossBar` events.
//
// Contract §5. Only imports: three + core.js. Zero per-frame allocations in
// update() — all temps are preallocated; query results reuse module arrays.
// ============================================================================
import * as THREE from 'three';
import {
  WORLD_SEED, WATER_LEVEL, clamp, lerp, dist2d, hash2,
  terrainHeight, biomeAt, BIOME, POI,
} from './core.js';

// ---------------------------------------------------------------------------
// Type stat table (hp / dmg / speed / xp per contract)
// ---------------------------------------------------------------------------
const TYPES = {
  wolf:       { hp: 30,  dmg: 8,  speed: 6.2, xp: 20,  reach: 1.6, bodyR: 0.60, height: 1.05, sightR: 20, atkCd: 1.4, mass: 1.00, name: 'Wolf' },
  goblin:     { hp: 40,  dmg: 10, speed: 4.4, xp: 25,  reach: 1.7, bodyR: 0.50, height: 1.25, sightR: 16, atkCd: 1.6, mass: 1.00, name: 'Goblin' },
  bandit:     { hp: 70,  dmg: 14, speed: 4.8, xp: 40,  reach: 2.0, bodyR: 0.60, height: 1.85, sightR: 18, atkCd: 1.8, mass: 0.80, name: 'Bandit' },
  skeleton:   { hp: 55,  dmg: 12, speed: 3.6, xp: 35,  reach: 1.9, bodyR: 0.55, height: 1.80, sightR: 15, atkCd: 1.9, mass: 1.00, name: 'Skeleton' },
  barrowlord: { hp: 260, dmg: 22, speed: 3.2, xp: 150, reach: 2.7, bodyR: 1.00, height: 2.75, sightR: 20, atkCd: 2.3, mass: 0.30, name: 'Barrow Lord' },
  drake:      { hp: 700, dmg: 28, speed: 8.0, xp: 500, reach: 3.4, bodyR: 2.40, height: 3.20, sightR: 90, atkCd: 2.2, mass: 0.10, name: 'Vhastrix' },
  // Nemesis: bandit ×2.2 (per-win +15% applied at spawn)
  vargr:      { hp: 154, dmg: 31, speed: 5.2, xp: 200, reach: 2.1, bodyR: 0.65, height: 1.95, sightR: 22, atkCd: 1.5, mass: 0.60, name: 'Vargr Redfang' },
};
const GOLD = {
  wolf: [3, 8], goblin: [4, 12], bandit: [8, 18], skeleton: [5, 14],
  barrowlord: [50, 90], drake: [120, 200], vargr: [60, 100],
};

const TELEGRAPH_T = 0.55;   // readable windup — contract
const STRIKE_T    = 0.30;   // lunge duration; hit lands at STRIKE_HIT_T
const STRIKE_HIT_T = 0.12;
const FLINCH_T    = 0.24;
const STAGGER_T   = 1.2;
const GUARD_T     = 0.9;
const SINK_AFTER  = 6.0;    // corpse sits, then sinks
const SINK_T      = 1.4;
const ACTIVE_CAP  = 10;     // non-boss actives within range
const SPAWN_R     = 260;
const DESPAWN_R   = 320;
const DEAGGRO_R   = 45;
const DRAKE_DEAGGRO_R = 160;
const RESPAWN_T   = 180;
const NIGHT_RESPAWN_T = 60; // skeletons at ruins respawn fast at night

// ---------------------------------------------------------------------------
// Preallocated temps (no per-frame allocations)
// ---------------------------------------------------------------------------
const _hits = [];
const _pts = [];
const _bb = { name: '', hp: 0, maxHp: 0 };
const CS_ON = { inCombat: true };
const CS_OFF = { inCombat: false };

function isNightFrac(f) { return f < 0.23 || f > 0.77; }

// ===========================================================================
export function createEnemies(g) {
  const events = g.events;

  // -------------------------------------------------------------------------
  // SHARED geometry / material library — built exactly once
  // -------------------------------------------------------------------------
  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 6),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  function lam(color, emissive = 0x000000) {
    return new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });
  }
  const M = {
    fur: lam(0x7d746a), furDark: lam(0x4e463f),
    goblin: lam(0x7a9c4e), rag: lam(0x8a5a2e),
    skin: lam(0xc49a76), cloth: lam(0x5a4636), armor: lam(0x70747c),
    bone: lam(0xddd3b8), boneDark: lam(0xa99e85),
    steel: lam(0xaab2bc), wood: lam(0x6b4a2c),
    red: lam(0xa82a22, 0x2a0402), coat: lam(0x46262a),
    drake: lam(0x6e2430, 0x140404),
    drakeWing: new THREE.MeshLambertMaterial({ color: 0x8c4a3a, flatShading: true, side: THREE.DoubleSide }),
    horn: lam(0xd8cfb6),
  };

  // Blob shadow: shared radial-gradient CanvasTexture quad ---------------------
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,0.42)');
    gr.addColorStop(0.7, 'rgba(0,0,0,0.22)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  // Floating HP bar: shared CanvasTexture frame + flat fill quad ---------------
  const barFrameTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,6,4,0.78)';
    ctx.fillRect(0, 0, 64, 8);
    ctx.strokeStyle = 'rgba(190,160,100,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 63, 7);
    return new THREE.CanvasTexture(c);
  })();
  const barBgMat = new THREE.MeshBasicMaterial({ map: barFrameTex, transparent: true, depthTest: false, depthWrite: false });
  const barFillMat = new THREE.MeshBasicMaterial({ color: 0xc03828, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });

  // -------------------------------------------------------------------------
  // Model builders — ≤7 meshes per enemy, pivots (Groups) carry the animation
  // -------------------------------------------------------------------------
  function part(parent, geo, mat, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true; // flagship target: shadows often on
    parent.add(m);
    return m;
  }
  function pivot(parent, x, y, z) {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.userData.bx = x; p.userData.by = y; p.userData.bz = z;
    parent.add(p);
    return p;
  }

  // Models face +Z (yaw = atan2(dx, dz)).
  function buildWolf() {
    const group = new THREE.Group();
    const body = pivot(group, 0, 0.62, 0);
    part(body, GEO.box, M.fur, 0, 0, 0, 0.48, 0.5, 1.15);
    const head = pivot(group, 0, 0.86, 0.62);
    part(head, GEO.box, M.furDark, 0, 0.02, 0.14, 0.3, 0.3, 0.5);
    const tail = pivot(group, 0, 0.76, -0.6);
    part(tail, GEO.box, M.furDark, 0, 0.1, -0.26, 0.12, 0.12, 0.52, -0.45);
    const legs = [];
    const lp = [[-0.17, 0.36], [0.17, 0.36], [-0.17, -0.38], [0.17, -0.38]];
    for (let i = 0; i < 4; i++) {
      const L = pivot(group, lp[i][0], 0.56, lp[i][1]);
      part(L, GEO.box, M.fur, 0, -0.28, 0, 0.13, 0.56, 0.14);
      legs.push(L);
    }
    return { group, parts: { body, head, tail, legFL: legs[0], legFR: legs[1], legBL: legs[2], legBR: legs[3] }, kind: 'quad' };
  }

  function buildBiped(o) {
    // Shared humanoid recipe: 2 legs, torso, head, 2 arms, weapon = 7 meshes
    const group = new THREE.Group();
    const s = o.scale;
    const legL = pivot(group, -0.13 * s, 0.78 * s, 0);
    part(legL, GEO.box, o.legMat, 0, -0.39 * s, 0, o.thin * s, 0.78 * s, o.thin * 1.06 * s);
    const legR = pivot(group, 0.13 * s, 0.78 * s, 0);
    part(legR, GEO.box, o.legMat, 0, -0.39 * s, 0, o.thin * s, 0.78 * s, o.thin * 1.06 * s);
    const body = pivot(group, 0, 1.12 * s, 0);
    part(body, GEO.box, o.bodyMat, 0, 0, 0, 0.5 * s * o.bulk, 0.62 * s, 0.28 * s * o.bulk);
    const head = pivot(group, 0, 1.58 * s, 0);
    part(head, GEO.box, o.headMat, 0, 0.1 * s, 0, 0.27 * s * o.headS, 0.28 * s * o.headS, 0.27 * s * o.headS);
    const armL = pivot(group, -0.33 * s * o.bulk, 1.38 * s, 0);
    part(armL, GEO.box, o.armMat, 0, -0.27 * s, 0, o.thin * 0.85 * s, 0.56 * s, o.thin * 0.9 * s);
    const armR = pivot(group, 0.33 * s * o.bulk, 1.38 * s, 0);
    part(armR, GEO.box, o.armMat, 0, -0.27 * s, 0, o.thin * 0.85 * s, 0.56 * s, o.thin * 0.9 * s);
    let weapon = null;
    if (o.weapon === 'club') {
      weapon = part(armR, GEO.box, M.wood, 0.02, -0.52 * s, 0.16 * s, 0.1 * s, 0.44 * s, 0.1 * s, 0.9);
    } else if (o.weapon === 'sword') {
      weapon = part(armR, GEO.box, M.steel, 0.02, -0.5 * s, 0.34 * s, 0.05 * s, 0.06 * s, 0.85 * s);
    } else if (o.weapon === 'axe') {
      weapon = part(armR, GEO.box, M.steel, 0.02, -0.62 * s, 0.3 * s, 0.2 * s, 0.09 * s, 0.62 * s);
    }
    return { group, parts: { legL, legR, body, head, armL, armR, weapon }, kind: 'biped' };
  }

  function buildGoblin() {
    return buildBiped({ scale: 0.68, thin: 0.2, bulk: 1.08, headS: 1.5, legMat: M.goblin, bodyMat: M.rag, headMat: M.goblin, armMat: M.goblin, weapon: 'club' });
  }
  function buildBandit() {
    return buildBiped({ scale: 1.0, thin: 0.17, bulk: 1.0, headS: 1.0, legMat: M.cloth, bodyMat: M.armor, headMat: M.skin, armMat: M.cloth, weapon: 'sword' });
  }
  function buildSkeleton() {
    return buildBiped({ scale: 0.98, thin: 0.11, bulk: 0.92, headS: 1.0, legMat: M.bone, bodyMat: M.boneDark, headMat: M.bone, armMat: M.bone, weapon: 'sword' });
  }
  function buildBarrowlord() {
    return buildBiped({ scale: 1.5, thin: 0.16, bulk: 1.25, headS: 1.15, legMat: M.boneDark, bodyMat: M.boneDark, headMat: M.bone, armMat: M.boneDark, weapon: 'axe' });
  }

  function buildVargr() {
    // 7 meshes: coat cone, torso, head, red plume, 2 arms, sword.
    // Scar stripes (one per nemesis win, ≤3) are added dynamically.
    const group = new THREE.Group();
    const legL = pivot(group, 0, 0.55, 0); // coat sways in place of legs
    part(legL, GEO.cone, M.coat, 0, 0, 0, 1.3, 1.14, 1.1);
    const body = pivot(group, 0, 1.28, 0);
    const bodyMesh = part(body, GEO.box, M.armor, 0, 0, 0, 0.58, 0.62, 0.34);
    const head = pivot(group, 0, 1.74, 0);
    part(head, GEO.box, M.skin, 0, 0.1, 0, 0.29, 0.3, 0.29);
    part(head, GEO.cone, M.red, 0, 0.36, -0.04, 0.34, 0.44, 0.34); // red plume
    const armL = pivot(group, -0.38, 1.52, 0);
    part(armL, GEO.box, M.coat, 0, -0.28, 0, 0.16, 0.58, 0.17);
    const armR = pivot(group, 0.38, 1.52, 0);
    part(armR, GEO.box, M.coat, 0, -0.28, 0, 0.16, 0.58, 0.17);
    const weapon = part(armR, GEO.box, M.steel, 0.02, -0.52, 0.4, 0.06, 0.07, 1.0);
    return { group, parts: { legL, legR: null, body, head, armL, armR, weapon, bodyMesh, scars: [] }, kind: 'biped' };
  }

  function buildDrake() {
    // 7 meshes: body, neck, head, horn, tail, 2 wings.
    const group = new THREE.Group();
    const body = pivot(group, 0, 1.3, 0);
    part(body, GEO.box, M.drake, 0, 0, 0, 1.5, 1.25, 3.6);
    const neck = pivot(group, 0, 1.9, 1.7);
    part(neck, GEO.box, M.drake, 0, 0.5, 0.5, 0.6, 0.55, 1.5, -0.55);
    const head = pivot(neck, 0, 1.05, 1.05);
    part(head, GEO.box, M.drake, 0, 0.05, 0.35, 0.72, 0.55, 1.15);
    part(head, GEO.cone, M.horn, 0, 0.45, -0.1, 0.4, 0.6, 0.4, -0.5);
    const tail = pivot(group, 0, 1.4, -1.8);
    part(tail, GEO.cone, M.drake, 0, 0, -1.5, 0.9, 3.0, 0.9, -Math.PI / 2);
    const wingL = pivot(group, -0.7, 2.15, 0.3);
    part(wingL, GEO.box, M.drakeWing, -2.0, 0, 0, 3.9, 0.09, 1.7);
    const wingR = pivot(group, 0.7, 2.15, 0.3);
    part(wingR, GEO.box, M.drakeWing, 2.0, 0, 0, 3.9, 0.09, 1.7);
    return { group, parts: { body, neck, head, tail, wingL, wingR }, kind: 'drake' };
  }

  const BUILDERS = {
    wolf: buildWolf, goblin: buildGoblin, bandit: buildBandit,
    skeleton: buildSkeleton, barrowlord: buildBarrowlord,
    vargr: buildVargr, drake: buildDrake,
  };

  // -------------------------------------------------------------------------
  // Holders (model + shadow + hp bar) — pooled per type, kept in scene
  // -------------------------------------------------------------------------
  const pools = { wolf: [], goblin: [], bandit: [], skeleton: [], barrowlord: [], vargr: [], drake: [] };

  function makeHolder(type) {
    const model = BUILDERS[type]();
    model.group.visible = false;
    g.scene.add(model.group);

    const shadow = new THREE.Mesh(GEO.plane, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    shadow.visible = false;
    g.scene.add(shadow);

    const barW = type === 'drake' ? 3.0 : type === 'barrowlord' ? 1.8 : 1.1;
    const bar = new THREE.Group();
    const barBg = new THREE.Mesh(GEO.plane, barBgMat);
    barBg.scale.set(barW, 0.13, 1);
    barBg.renderOrder = 20;
    const barFill = new THREE.Mesh(GEO.plane, barFillMat);
    barFill.scale.set(barW - 0.06, 0.08, 1);
    barFill.position.z = 0.002;
    barFill.renderOrder = 21;
    bar.add(barBg); bar.add(barFill);
    bar.visible = false;
    g.scene.add(bar);

    return { type, model, shadow, bar, barFill, barW };
  }
  function acquireHolder(type) {
    return pools[type].length ? pools[type].pop() : makeHolder(type);
  }
  function releaseHolder(h) {
    h.model.group.visible = false;
    h.shadow.visible = false;
    h.bar.visible = false;
    pools[h.type].push(h);
  }

  // -------------------------------------------------------------------------
  // Seeded spawn system: home spawners across the map
  // -------------------------------------------------------------------------
  const spawners = [];
  let spawnerId = 0;
  function addSpawner(type, x, z, opts) {
    const s = {
      id: spawnerId++, type, x, z,
      packId: (opts && opts.packId !== undefined) ? opts.packId : -1,
      boss: !!(opts && opts.boss),
      isVargr: !!(opts && opts.isVargr),
      nightOnly: !!(opts && opts.nightOnly),
      nightRespawn: !!(opts && opts.nightRespawn),
      enemy: null, respawnAt: -1, permaDead: false,
    };
    spawners.push(s);
    return s;
  }
  function farFromPOIs(x, z, pad) {
    for (const k in POI) {
      const p = POI[k];
      if (!p.r) continue;
      if (dist2d(x, z, p.x, p.z) < p.r + pad) return false;
    }
    return true;
  }

  // Wolf packs (~14) via hash grid over the map
  {
    let packs = 0;
    for (let gx = -7; gx <= 7 && packs < 15; gx++) {
      for (let gz = -7; gz <= 7 && packs < 15; gz++) {
        if (hash2(gx + 31, gz - 17, WORLD_SEED + 91) > 0.1) continue;
        const px = gx * 170 + (hash2(gx, gz, WORLD_SEED + 7) - 0.5) * 120;
        const pz = gz * 170 + (hash2(gz, gx, WORLD_SEED + 13) - 0.5) * 120;
        const h = terrainHeight(px, pz);
        if (h < WATER_LEVEL + 2 || h > 85) continue;
        const b = biomeAt(px, pz, h);
        if (b !== BIOME.FOREST && b !== BIOME.MEADOW) continue;
        if (dist2d(px, pz, 0, 0) < 150 || !farFromPOIs(px, pz, 40)) continue;
        const size = 2 + (hash2(gx * 3, gz * 5, WORLD_SEED + 99) < 0.5 ? 0 : 1); // packs of 2-3
        for (let i = 0; i < size; i++) {
          const a = i * 2.4 + hash2(gx, gz + i, 55) * 2;
          addSpawner('wolf', px + Math.cos(a) * (2 + i * 2), pz + Math.sin(a) * (2 + i * 2), { packId: packs });
        }
        packs++;
      }
    }
  }
  // Goblins: near rocks always, wilderness at night
  {
    let spots = 0;
    for (let gx = -7; gx <= 7 && spots < 14; gx++) {
      for (let gz = -7; gz <= 7 && spots < 14; gz++) {
        if (hash2(gx - 53, gz + 27, WORLD_SEED + 417) > 0.12) continue;
        const px = gx * 160 + (hash2(gx + 5, gz, WORLD_SEED + 21) - 0.5) * 110;
        const pz = gz * 160 + (hash2(gz + 9, gx, WORLD_SEED + 43) - 0.5) * 110;
        const h = terrainHeight(px, pz);
        if (h < WATER_LEVEL + 2 || h > 105) continue;
        const b = biomeAt(px, pz, h);
        let nightOnly = false;
        if (b === BIOME.ROCKY) nightOnly = false;
        else if ((b === BIOME.MEADOW || b === BIOME.FOREST) && hash2(gx, gz, WORLD_SEED + 61) < 0.6) nightOnly = true;
        else continue;
        if (dist2d(px, pz, 0, 0) < 150 || !farFromPOIs(px, pz, 40)) continue;
        const size = 1 + (hash2(gx * 7, gz * 3, WORLD_SEED + 77) < 0.4 ? 1 : 0);
        for (let i = 0; i < size; i++) {
          addSpawner('goblin', px + i * 3.2 - 1.6, pz + (hash2(i, gx, 5) - 0.5) * 4, { nightOnly });
        }
        spots++;
      }
    }
  }
  // Skeletons at Barrowdeep Ruins (fast respawn at night)
  for (let i = 0; i < 5; i++) {
    const a = i * 2.51 + 0.7;
    const rad = 14 + hash2(i, 3, WORLD_SEED + 5) * 24;
    addSpawner('skeleton', POI.ruins.x + Math.cos(a) * rad, POI.ruins.z + Math.sin(a) * rad, { nightRespawn: true });
  }
  // Bandits ×4 + Vargr Redfang at Redfang Camp
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + 0.4;
    const rad = 10 + hash2(i, 8, WORLD_SEED + 3) * 14;
    addSpawner('bandit', POI.camp.x + Math.cos(a) * rad, POI.camp.z + Math.sin(a) * rad);
  }
  addSpawner('vargr', POI.camp.x + 4, POI.camp.z - 6, { isVargr: true });
  // Barrowlord in the ruins crypt area; drake at Drakespire peak
  addSpawner('barrowlord', POI.ruins.x + 8, POI.ruins.z - 16, { boss: true });
  addSpawner('drake', POI.peak.x, POI.peak.z, { boss: true });

  // Persistent boss state (serialized)
  const bossState = {
    drake: { dead: false, hp: TYPES.drake.hp },
    barrowlord: { dead: false, hp: TYPES.barrowlord.hp },
  };

  // -------------------------------------------------------------------------
  // Drake fire-breath particles (one pooled Points system, built once)
  // -------------------------------------------------------------------------
  const FIRE_N = 96;
  const firePos = new Float32Array(FIRE_N * 3);
  const fireVel = new Float32Array(FIRE_N * 3);
  const fireLife = new Float32Array(FIRE_N);
  for (let i = 0; i < FIRE_N; i++) { firePos[i * 3 + 1] = -9999; fireLife[i] = 0; }
  const fireGeo = new THREE.BufferGeometry();
  const firePosAttr = new THREE.BufferAttribute(firePos, 3);
  firePosAttr.setUsage(THREE.DynamicDrawUsage);
  fireGeo.setAttribute('position', firePosAttr);
  const firePoints = new THREE.Points(fireGeo, new THREE.PointsMaterial({
    color: 0xff7722, size: 0.75, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  firePoints.frustumCulled = false;
  g.scene.add(firePoints);
  let fireAlive = 0;
  let fireCursor = 0;
  function emitFire(x, y, z, vx, vy, vz) {
    const i = fireCursor; fireCursor = (fireCursor + 1) % FIRE_N;
    firePos[i * 3] = x; firePos[i * 3 + 1] = y; firePos[i * 3 + 2] = z;
    fireVel[i * 3] = vx; fireVel[i * 3 + 1] = vy; fireVel[i * 3 + 2] = vz;
    if (fireLife[i] <= 0) fireAlive++;
    fireLife[i] = 0.55 + Math.random() * 0.4;
  }
  function updateFire(dt) {
    if (fireAlive === 0) return;
    for (let i = 0; i < FIRE_N; i++) {
      if (fireLife[i] <= 0) continue;
      fireLife[i] -= dt;
      if (fireLife[i] <= 0) { firePos[i * 3 + 1] = -9999; fireAlive--; continue; }
      firePos[i * 3] += fireVel[i * 3] * dt;
      firePos[i * 3 + 1] += fireVel[i * 3 + 1] * dt;
      firePos[i * 3 + 2] += fireVel[i * 3 + 2] * dt;
      fireVel[i * 3 + 1] -= 2.5 * dt; // gentle arc down
    }
    firePosAttr.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Enemy lifecycle
  // -------------------------------------------------------------------------
  const list = []; // exposed active enemy list

  function sfx(name) { if (g.audio) g.audio.play(name); }

  function spawnEnemy(type, x, z, spawner) {
    const T = TYPES[type];
    const holder = acquireHolder(type);
    let hpMul = 1, dmgMul = 1;
    if (type === 'vargr') {
      const wins = g.flags.vargrWins | 0;
      hpMul = dmgMul = 1 + 0.15 * wins;
    }
    let hp = Math.round(T.hp * hpMul);
    if ((type === 'drake' || type === 'barrowlord') && bossState[type] && !bossState[type].dead) {
      hp = clamp(Math.round(bossState[type].hp), 1, T.hp); // bosses resume saved hp
    }
    const y = terrainHeight(x, z);
    const e = {
      type, name: T.name, hp, maxHp: Math.round(T.hp * hpMul),
      dmg: Math.round(T.dmg * dmgMul), speed: T.speed, xp: T.xp,
      reach: T.reach, bodyR: T.bodyR, height: T.height,
      sightR: T.sightR, atkCd: T.atkCd, mass: T.mass,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
      yaw: hash2(x | 0, z | 0, 3) * Math.PI * 2,
      home: { x, z },
      state: 'idle', stateT: 0, cooldown: 1 + Math.random(),
      aggro: false, alive: true, dead: false, hitApplied: false,
      walkPhase: 0, animSpd: 0, wanderT: 1 + Math.random() * 3, wanderX: x, wanderZ: z,
      deadT: 0, fallDir: Math.random() < 0.5 ? 1 : -1,
      seed: hash2(spawner ? spawner.id : (x | 0), z | 0, 17),
      vocalT: 2 + Math.random() * 5,
      packId: spawner ? spawner.packId : -1,
      orbitA: Math.random() * Math.PI * 2,
      orbitDir: (spawner && spawner.id % 2 === 0) ? 1 : -1,
      boss: !!(spawner && spawner.boss) || type === 'drake' || type === 'barrowlord',
      isVargr: type === 'vargr',
      spawner: spawner || null,
      summoned: false, taunted: false,
      holder,
      // drake:
      fly: false, dstate: '', atkT: 0, phaseT: 0, breathTick: 0, roared: false,
      swoopA: null, swoopB: null, swoopC: null, breathTarget: null,
    };
    if (type === 'drake') {
      e.fly = true;
      e.dstate = 'perch';
      e.swoopA = new THREE.Vector3(); e.swoopB = new THREE.Vector3(); e.swoopC = new THREE.Vector3();
      e.breathTarget = new THREE.Vector3();
    }
    if (type === 'vargr') refreshVargrScars(e);
    const gp = holder.model.group;
    gp.position.set(x, y, z);
    gp.rotation.set(0, e.yaw, 0);
    gp.visible = true;
    const shadowD = type === 'drake' ? 7 : type === 'barrowlord' ? 3 : e.bodyR * 2.6;
    holder.shadow.scale.set(shadowD, shadowD, 1);
    holder.shadow.visible = true;
    e.shadowD = shadowD;
    if (spawner) spawner.enemy = e;
    list.push(e);
    return e;
  }

  function refreshVargrScars(e) {
    // One red scar stripe per nemesis win (capped at 3) across the chest.
    const wins = Math.min(g.flags.vargrWins | 0, 3);
    const P = e.holder.model.parts;
    while (P.scars.length < wins) {
      const i = P.scars.length;
      const m = new THREE.Mesh(GEO.box, M.red);
      m.castShadow = false;
      m.position.set(-0.1 + i * 0.12, 0.05 - i * 0.1, 0.19);
      m.scale.set(0.06, 0.5, 0.02);
      m.rotation.z = 0.5 - i * 0.25;
      P.body.add(m);
      P.scars.push(m);
    }
    for (let i = 0; i < P.scars.length; i++) P.scars[i].visible = i < wins;
  }

  function despawn(e) {
    if (e.spawner) e.spawner.enemy = null;
    releaseHolder(e.holder);
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
  }

  function dropLoot(e) {
    const gr = GOLD[e.type] || [4, 10];
    const p = { x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z };
    events.emit('spawnLoot', { pos: p, kind: 'gold', amount: Math.round(gr[0] + Math.random() * (gr[1] - gr[0])) });
    if (Math.random() < 0.25) {
      events.emit('spawnLoot', { pos: { x: p.x + 0.5, y: p.y, z: p.z + 0.3 }, kind: 'potion', amount: 1 });
    }
    if (e.type === 'wolf') {
      events.emit('spawnLoot', { pos: { x: p.x - 0.4, y: p.y, z: p.z - 0.3 }, kind: 'item', amount: 1, itemId: 'pelt' });
    }
  }

  function kill(e) {
    e.alive = false; e.dead = true; e.aggro = false;
    e.state = 'dead'; e.deadT = 0;
    if (e.spawner) {
      const night = isNightFrac(g.time.dayFrac);
      e.spawner.respawnAt = g.time.elapsed + (e.spawner.nightRespawn && night ? NIGHT_RESPAWN_T : RESPAWN_T);
      if (e.boss || e.isVargr) e.spawner.permaDead = true; // bosses & Vargr stay dead
    }
    if (e.type === 'drake') { bossState.drake.dead = true; bossState.drake.hp = 0; sfx('drakeRoar'); }
    if (e.type === 'barrowlord') { bossState.barrowlord.dead = true; bossState.barrowlord.hp = 0; }
    if (e.isVargr) g.flags.vargrDead = true;
    events.emit('enemyKilled', { type: e.type, name: e.name, pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z }, xp: e.xp });
    if (g.player && g.player.addXP) g.player.addXP(e.xp);
    dropLoot(e);
  }

  // -------------------------------------------------------------------------
  // Public combat interface
  // -------------------------------------------------------------------------
  function queryHit(origin, dir, range, halfAngle) {
    _hits.length = 0;
    const cosA = Math.cos(halfAngle);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const cx = e.pos.x - origin.x;
      const cy = e.pos.y + e.height * 0.5 - origin.y;
      const cz = e.pos.z - origin.z;
      const d = Math.hypot(cx, cy, cz);
      if (d > range + e.bodyR) continue;
      if (d > 0.001) {
        const dot = (cx * dir.x + cy * dir.y + cz * dir.z) / d;
        // slack widens the cone for fat targets at close range
        if (dot < cosA - e.bodyR / Math.max(d, 0.8)) continue;
      }
      _hits.push(e);
    }
    return _hits;
  }

  function queryPoint(pos, r) {
    _pts.length = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const cx = e.pos.x - pos.x;
      const cy = e.pos.y + e.height * 0.5 - pos.y;
      const cz = e.pos.z - pos.z;
      if (Math.hypot(cx, cy, cz) <= r + e.bodyR) _pts.push(e);
    }
    return _pts;
  }

  function damage(e, amount, dir, opts) {
    if (!e || e.dead || !e.alive) return;
    if (e.state === 'guard') { amount *= 0.35; sfx('block'); }
    e.hp -= amount;
    if (e.type === 'drake') bossState.drake.hp = Math.max(0, e.hp);
    if (e.type === 'barrowlord') bossState.barrowlord.hp = Math.max(0, e.hp);
    // knockback impulse along dir (scaled by mass)
    if (dir) {
      const k = ((opts && opts.heavy) ? 7 : 3.5) * e.mass;
      e.vel.x += dir.x * k;
      e.vel.z += dir.z * k;
    }
    // Barrowlord summons 2 skeletons at half hp
    if (e.type === 'barrowlord' && !e.summoned && e.hp <= e.maxHp * 0.5 && e.hp > 0) {
      e.summoned = true;
      startAggro(spawnEnemy('skeleton', e.pos.x + 2.2, e.pos.z + 1.4, null), true);
      startAggro(spawnEnemy('skeleton', e.pos.x - 2.2, e.pos.z - 1.4, null), true);
      sfx('skeletonRattle');
    }
    if (e.hp <= 0) { kill(e); return; }
    // Getting hit always aggros (pack too), even without LOS
    if (!e.aggro && e.state !== 'flee') startAggro(e, true);
    // Flinch — a heavy hit or parry interrupts the windup, light hits don't
    if (e.state === 'telegraph') {
      if ((opts && opts.heavy) || (opts && opts.parried)) { e.state = 'flinch'; e.stateT = 0; }
    } else if (e.state !== 'strike' && e.state !== 'stagger' && e.state !== 'dead' && !e.fly) {
      e.state = 'flinch'; e.stateT = 0;
    }
    // Wolves break and flee below 25% hp
    if (e.type === 'wolf' && e.hp < e.maxHp * 0.25 && e.state !== 'flee') {
      e.state = 'flee'; e.stateT = 0; e.aggro = false;
    }
  }

  function stagger(e) {
    if (e.dead) return;
    e.state = 'stagger'; e.stateT = 0;
  }

  function countAlive(type) {
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i].alive && list[i].type === type) n++;
    return n;
  }
  function bossAlive() {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive && (e.type === 'drake' || e.type === 'barrowlord')) return true;
    }
    return false;
  }

  function spawnAt(type, x, z) {
    if (!TYPES[type]) return null;
    return spawnEnemy(type, x, z, null);
  }

  // -------------------------------------------------------------------------
  // AI helpers
  // -------------------------------------------------------------------------
  let night = false;
  let lastHowl = -99, lastCackle = -99, nextRattle = 0;

  function losClear(e) {
    // Rough LOS: 3 samples along the sightline vs terrain
    const p = g.player.position;
    const y0 = e.pos.y + e.height * 0.8;
    const y1 = p.y + 1.5;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const x = lerp(e.pos.x, p.x, t);
      const z = lerp(e.pos.z, p.z, t);
      const y = lerp(y0, y1, t);
      if (terrainHeight(x, z) > y + 0.6) return false;
    }
    return true;
  }

  function startAggro(e, silent) {
    if (e.aggro || e.dead) return;
    e.aggro = true;
    if (e.state !== 'flinch' && e.state !== 'stagger') { e.state = 'chase'; e.stateT = 0; }
    const t = g.time.elapsed;
    if (e.type === 'wolf' && t - lastHowl > 4) { lastHowl = t; sfx('wolfHowl'); }
    else if (e.type === 'goblin' && t - lastCackle > 3) { lastCackle = t; sfx('goblinCackle'); }
    else if (e.type === 'skeleton') sfx('skeletonRattle');
    else if (e.type === 'drake' && !e.roared) { e.roared = true; sfx('drakeRoar'); }
    if (e.isVargr && !e.taunted && (g.flags.vargrWins | 0) > 0) {
      e.taunted = true;
      events.emit('notify', { text: 'Vargr Redfang remembers you', sub: 'His scars have made him stronger.' });
    }
    // Pack aggro: wolves hunt together
    if (e.packId >= 0) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o !== e && o.alive && o.packId === e.packId && !o.aggro && o.state !== 'flee') {
          o.aggro = true;
          if (o.state === 'idle' || o.state === 'wander') { o.state = 'chase'; o.stateT = 0; }
        }
      }
    }
  }

  function turnTo(e, target, rate, dt) {
    let d = target - e.yaw;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    e.yaw += d * Math.min(1, rate * dt);
  }

  // Steer toward (tx,tz) at spd, avoiding deep water and colliders.
  function moveToward(e, tx, tz, spd, dt, face) {
    let dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { dx = 0; dz = 0; }
    else { dx /= d; dz /= d; }
    // Water avoidance: probe one step ahead; if drowning-deep, try turning
    if (dx !== 0 || dz !== 0) {
      const px = e.pos.x + dx * 1.6, pz = e.pos.z + dz * 1.6;
      if (terrainHeight(px, pz) < WATER_LEVEL - 1) {
        const c = Math.cos(1.1), s = Math.sin(1.1);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;   // left
        const rx = dx * c + dz * s, rz = -dx * s + dz * c;  // right
        const hl = terrainHeight(e.pos.x + lx * 1.6, e.pos.z + lz * 1.6);
        const hr = terrainHeight(e.pos.x + rx * 1.6, e.pos.z + rz * 1.6);
        if (hl < WATER_LEVEL - 1 && hr < WATER_LEVEL - 1) { dx = 0; dz = 0; }
        else if (hl >= hr) { dx = lx; dz = lz; }
        else { dx = rx; dz = rz; }
      }
    }
    const k = Math.min(1, 9 * dt);
    e.vel.x += (dx * spd - e.vel.x) * k;
    e.vel.z += (dz * spd - e.vel.z) * k;
    if (face && (dx !== 0 || dz !== 0)) turnTo(e, Math.atan2(dx, dz), 8, dt);
  }

  function integrate(e, dt) {
    // velocity damping (knockback bleeds off)
    const damp = Math.min(1, 4 * dt);
    if (e.state === 'idle' || e.state === 'dead' || e.state === 'telegraph' || e.state === 'stagger' || e.state === 'flinch' || e.state === 'guard') {
      e.vel.x -= e.vel.x * Math.min(1, 8 * dt);
      e.vel.z -= e.vel.z * Math.min(1, 8 * dt);
    } else {
      e.vel.x -= e.vel.x * damp * 0.15;
      e.vel.z -= e.vel.z * damp * 0.15;
    }
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    if (!e.fly) {
      const gh = terrainHeight(e.pos.x, e.pos.z);
      e.groundY = gh;
      e.pos.y = gh; // terrain-following
    } else {
      e.groundY = terrainHeight(e.pos.x, e.pos.z);
    }
    // Collider push-out (structures / trees register cylinders)
    const R = e.bodyR;
    const cols = g.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      let ddx = e.pos.x - c.x;
      if (ddx > c.r + R || ddx < -c.r - R) continue;
      let ddz = e.pos.z - c.z;
      if (ddz > c.r + R || ddz < -c.r - R) continue;
      if (c.hMax !== undefined && e.pos.y >= c.hMax) continue;
      if (c.hMin !== undefined && e.pos.y + e.height <= c.hMin) continue;
      const dd = Math.hypot(ddx, ddz);
      const rr = c.r + R;
      if (dd >= rr || dd < 0.0001) continue;
      const nx = ddx / dd, nz = ddz / dd;
      e.pos.x = c.x + nx * rr;
      e.pos.z = c.z + nz * rr;
    }
  }

  function tryStrikeHit(e) {
    const p = g.player;
    const d = Math.hypot(p.position.x - e.pos.x, p.position.z - e.pos.z);
    if (d > e.reach + 0.6) return;
    if (p.stats.hp <= 0) return;
    let res = null;
    if (g.combat && g.combat.tryBlock) res = g.combat.tryBlock(e.dmg);
    if (res && res.parried) { stagger(e); return; }
    if (res && res.blocked) return; // combat handled stamina cost, no hp
    p.damage(e.dmg, e.pos);
    lastHitter = e;
    lastHitT = g.time.elapsed;
  }

  // -------------------------------------------------------------------------
  // Grounded state machine (all types except flying drake)
  // -------------------------------------------------------------------------
  function updateGrounded(e, dt, t, pd) {
    const p = g.player;
    const sight = e.sightR * (night ? 1.6 : 1);
    e.cooldown -= dt;
    e.stateT += dt;

    switch (e.state) {
      case 'idle': {
        e.wanderT -= dt;
        if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.04 * dt); // heal at home
        if (e.wanderT <= 0) {
          const a = hash2((t * 13) | 0, e.spawner ? e.spawner.id : 1, 7) * Math.PI * 2;
          const r = 2 + hash2((t * 7) | 0, e.spawner ? e.spawner.id : 2, 9) * 7;
          e.wanderX = e.home.x + Math.sin(a) * r;
          e.wanderZ = e.home.z + Math.cos(a) * r;
          e.wanderT = 3 + hash2((t * 3) | 0, e.seed * 100 | 0, 11) * 4;
          e.state = 'wander'; e.stateT = 0;
        }
        if (pd < sight && losClear(e)) startAggro(e, false);
        break;
      }
      case 'wander': {
        moveToward(e, e.wanderX, e.wanderZ, e.speed * 0.42, dt, true);
        if (Math.hypot(e.wanderX - e.pos.x, e.wanderZ - e.pos.z) < 1.2 || e.stateT > 6) {
          e.state = 'idle'; e.stateT = 0; e.wanderT = 1.5 + e.seed * 4;
        }
        if (pd < sight && losClear(e)) startAggro(e, false);
        break;
      }
      case 'chase': {
        const dr = e.type === 'drake' ? DRAKE_DEAGGRO_R : DEAGGRO_R;
        if (pd > dr || p.stats.hp <= 0) { e.aggro = false; e.state = 'return'; e.stateT = 0; break; }
        let tx = p.position.x, tz = p.position.z;
        if (e.type === 'wolf' && e.cooldown > 0.35 && pd < 9) {
          // wolves circle their prey between bites, offset per pack member
          e.orbitA += dt * 1.15 * e.orbitDir;
          tx = p.position.x + Math.cos(e.orbitA) * 4.5;
          tz = p.position.z + Math.sin(e.orbitA) * 4.5;
        } else if (e.type === 'goblin') {
          // jittery zigzag approach
          const perp = Math.sin(t * 4.2 + e.seed * 31) * 2.4;
          const inv = 1 / Math.max(pd, 0.01);
          tx += -(p.position.z - e.pos.z) * inv * perp;
          tz += (p.position.x - e.pos.x) * inv * perp;
        }
        moveToward(e, tx, tz, e.speed, dt, true);
        turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 6, dt);
        // bandits (and Vargr) raise their blade sometimes
        if ((e.type === 'bandit' || e.isVargr) && e.cooldown > 0.4 && pd < 5 &&
            hash2((t * 10) | 0, e.spawner ? e.spawner.id : 5, 23) < (e.isVargr ? 0.09 : 0.06)) {
          e.state = 'guard'; e.stateT = 0;
          break;
        }
        if (pd < e.reach + 0.4 && e.cooldown <= 0) {
          e.state = 'telegraph'; e.stateT = 0;
          sfx(e.type === 'barrowlord' || e.type === 'drake' ? 'swingHeavy' : 'swing'); // audible windup cue
        }
        // combat vocals
        e.vocalT -= dt;
        if (e.vocalT <= 0) {
          e.vocalT = 5 + e.seed * 6;
          if (e.type === 'goblin') sfx('goblinCackle');
          else if (e.type === 'skeleton') sfx('skeletonRattle');
        }
        break;
      }
      case 'guard': {
        turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 8, dt);
        if (e.stateT >= GUARD_T) { e.state = 'chase'; e.stateT = 0; }
        break;
      }
      case 'telegraph': {
        // 0.55s readable windup: lean back / raise weapon, no movement
        turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 5, dt);
        if (e.stateT >= TELEGRAPH_T) { e.state = 'strike'; e.stateT = 0; e.hitApplied = false; }
        break;
      }
      case 'strike': {
        if (e.stateT < 0.16) { // lunge
          e.pos.x += Math.sin(e.yaw) * e.speed * 1.9 * dt;
          e.pos.z += Math.cos(e.yaw) * e.speed * 1.9 * dt;
        }
        if (!e.hitApplied && e.stateT >= STRIKE_HIT_T) {
          e.hitApplied = true;
          tryStrikeHit(e);
        }
        if (e.stateT >= STRIKE_T) {
          e.state = 'chase'; e.stateT = 0;
          e.cooldown = e.atkCd * (0.85 + e.seed * 0.4);
        }
        break;
      }
      case 'flinch': {
        if (e.stateT >= FLINCH_T) { e.state = e.aggro ? 'chase' : 'idle'; e.stateT = 0; }
        break;
      }
      case 'stagger': {
        if (e.stateT >= STAGGER_T) { e.state = e.aggro ? 'chase' : 'idle'; e.stateT = 0; }
        break;
      }
      case 'flee': {
        // run away from the player, back toward home
        const ax = e.pos.x + (e.pos.x - p.position.x) * 0.5 + (e.home.x - e.pos.x) * 0.5;
        const az = e.pos.z + (e.pos.z - p.position.z) * 0.5 + (e.home.z - e.pos.z) * 0.5;
        moveToward(e, ax, az, e.speed * 1.05, dt, true);
        if (pd > 32 || e.stateT > 10) { e.state = 'return'; e.stateT = 0; }
        break;
      }
      case 'return': {
        moveToward(e, e.home.x, e.home.z, e.speed * 0.6, dt, true);
        if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.04 * dt);
        if (Math.hypot(e.home.x - e.pos.x, e.home.z - e.pos.z) < 2) { e.state = 'idle'; e.stateT = 0; }
        if (pd < sight * 0.8 && e.type !== 'wolf' && losClear(e)) startAggro(e, true);
        break;
      }
    }
    integrate(e, dt);
  }

  // -------------------------------------------------------------------------
  // Drake boss: circling flight, swoops, fire breath, landing phase at 40% hp
  // -------------------------------------------------------------------------
  function updateDrake(e, dt, t, pd) {
    const p = g.player;
    e.stateT += dt;
    e.cooldown -= dt;
    if (!e.fly) { updateGrounded(e, dt, t, pd); return; } // landed melee phase

    // De-aggro far away → return to the peak
    if (e.aggro && (pd > DRAKE_DEAGGRO_R || p.stats.hp <= 0)) {
      e.aggro = false; e.dstate = 'homeward'; e.roared = false;
    }

    switch (e.dstate) {
      case 'perch': {
        e.pos.y = e.groundY = terrainHeight(e.pos.x, e.pos.z);
        if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * dt);
        if (pd < e.sightR) { startAggro(e, false); e.dstate = 'circle'; e.atkT = 2.5; }
        break;
      }
      case 'circle': {
        e.orbitA += dt * (e.speed / 26);
        const tx = p.position.x + Math.cos(e.orbitA) * 26;
        const tz = p.position.z + Math.sin(e.orbitA) * 26;
        const ty = Math.max(e.groundY + 8, p.position.y + 13);
        flyToward(e, tx, ty, tz, e.speed, dt);
        e.atkT -= dt;
        if (e.hp <= e.maxHp * 0.4) { e.dstate = 'landing'; e.phaseT = 0; sfx('drakeRoar'); break; }
        if (e.atkT <= 0) {
          if (Math.random() < 0.55) {
            e.dstate = 'swoop'; e.phaseT = 0; e.hitApplied = false;
            e.swoopA.copy(e.pos);
            e.swoopB.set(p.position.x, p.position.y + 1.2, p.position.z);
            const dx = p.position.x - e.pos.x, dz = p.position.z - e.pos.z;
            const dl = Math.max(Math.hypot(dx, dz), 0.01);
            e.swoopC.set(p.position.x + (dx / dl) * 22, p.position.y + 13, p.position.z + (dz / dl) * 22);
            if (Math.random() < 0.34) sfx('drakeRoar');
          } else {
            e.dstate = 'breath'; e.phaseT = 0; e.breathTick = 0;
            e.breathTarget.copy(p.position);
            sfx('fireCast');
          }
        }
        break;
      }
      case 'swoop': {
        const dur = 1.5;
        e.phaseT += dt;
        const s = clamp(e.phaseT / dur, 0, 1);
        const u = 1 - s;
        // quadratic bezier A→B→C: dive through the player and pull up
        e.pos.x = u * u * e.swoopA.x + 2 * u * s * e.swoopB.x + s * s * e.swoopC.x;
        e.pos.y = u * u * e.swoopA.y + 2 * u * s * e.swoopB.y + s * s * e.swoopC.y;
        e.pos.z = u * u * e.swoopA.z + 2 * u * s * e.swoopB.z + s * s * e.swoopC.z;
        e.yaw = Math.atan2(e.swoopC.x - e.swoopA.x, e.swoopC.z - e.swoopA.z);
        if (!e.hitApplied && s > 0.4 && s < 0.68) {
          const d3 = e.pos.distanceTo(p.position);
          if (d3 < 4.2) { e.hitApplied = true; tryStrikeHit(e); }
        }
        if (s >= 1) { e.dstate = 'circle'; e.atkT = 2.5 + Math.random() * 1.5; }
        break;
      }
      case 'breath': {
        const dur = 2.4;
        e.phaseT += dt;
        // hover, face the mark, track it slowly
        e.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
        e.pos.y += (Math.max(e.groundY + 7, p.position.y + 9) - e.pos.y) * Math.min(1, 2 * dt);
        e.breathTarget.x += (p.position.x - e.breathTarget.x) * Math.min(1, 0.7 * dt);
        e.breathTarget.z += (p.position.z - e.breathTarget.z) * Math.min(1, 0.7 * dt);
        turnTo(e, Math.atan2(e.breathTarget.x - e.pos.x, e.breathTarget.z - e.pos.z), 4, dt);
        // line of fire particles mouth → target
        const mx = e.pos.x + Math.sin(e.yaw) * 4.0;
        const my = e.pos.y + 2.6;
        const mz = e.pos.z + Math.cos(e.yaw) * 4.0;
        let n = Math.min(4, Math.ceil(dt * 60));
        while (n-- > 0) {
          const spread = 0.15;
          let vx = e.breathTarget.x - mx, vy = (e.breathTarget.y + 0.5) - my, vz = e.breathTarget.z - mz;
          const vl = Math.max(Math.hypot(vx, vy, vz), 0.01);
          const spd = 22 + Math.random() * 6;
          emitFire(mx, my, mz,
            (vx / vl + (Math.random() - 0.5) * spread) * spd,
            (vy / vl + (Math.random() - 0.5) * spread) * spd,
            (vz / vl + (Math.random() - 0.5) * spread) * spd);
        }
        // damage ticks while the player stands in the stream
        e.breathTick -= dt;
        if (e.breathTick <= 0) {
          e.breathTick = 0.3;
          const lx = e.breathTarget.x - mx, lz = e.breathTarget.z - mz;
          const ll = Math.max(Math.hypot(lx, lz), 0.01);
          const px = p.position.x - mx, pz = p.position.z - mz;
          const along = clamp((px * lx + pz * lz) / (ll * ll), 0, 1);
          const cx = mx + lx * along, cz = mz + lz * along;
          if (Math.hypot(p.position.x - cx, p.position.z - cz) < 2.8 && p.stats.hp > 0) {
            let res = null;
            if (g.combat && g.combat.tryBlock) res = g.combat.tryBlock(7);
            if (!res || (!res.blocked && !res.parried)) p.damage(7, e.pos);
            lastHitter = e; lastHitT = t;
          }
        }
        if (e.phaseT >= dur) { e.dstate = 'circle'; e.atkT = 3.2 + Math.random() * 1.6; }
        break;
      }
      case 'landing': {
        // 40% hp: descend near the player for the melee phase
        const ty = e.groundY + 0.0;
        flyToward(e, p.position.x + Math.sin(e.orbitA) * 6, ty, p.position.z + Math.cos(e.orbitA) * 6, e.speed * 0.8, dt);
        if (e.pos.y - e.groundY < 0.8) {
          e.fly = false;
          e.pos.y = e.groundY;
          e.speed = 5.0; // grounded pace
          e.state = 'chase'; e.stateT = 0; e.cooldown = 1.2;
          sfx('drakeRoar');
          if (g.player.addShake) g.player.addShake(0.6);
        }
        break;
      }
      case 'homeward': {
        flyToward(e, e.home.x, terrainHeight(e.home.x, e.home.z) + 4, e.home.z, e.speed, dt);
        if (Math.hypot(e.home.x - e.pos.x, e.home.z - e.pos.z) < 6) {
          e.dstate = 'perch';
          e.pos.y = terrainHeight(e.pos.x, e.pos.z);
          e.vel.set(0, 0, 0);
        }
        if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * dt);
        break;
      }
    }

    if (e.fly && e.dstate !== 'swoop') {
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      e.pos.z += e.vel.z * dt;
      if (e.dstate !== 'perch') {
        const minY = terrainHeight(e.pos.x, e.pos.z) + (e.dstate === 'landing' ? 0 : 3);
        if (e.pos.y < minY) e.pos.y = minY;
      }
    }
    e.groundY = terrainHeight(e.pos.x, e.pos.z);
  }

  function flyToward(e, tx, ty, tz, spd, dt) {
    let dx = tx - e.pos.x, dy = ty - e.pos.y, dz = tz - e.pos.z;
    const d = Math.max(Math.hypot(dx, dy, dz), 0.01);
    dx /= d; dy /= d; dz /= d;
    const k = Math.min(1, 2.5 * dt);
    e.vel.x += (dx * spd - e.vel.x) * k;
    e.vel.y += (dy * spd - e.vel.y) * k;
    e.vel.z += (dz * spd - e.vel.z) * k;
    if (Math.abs(e.vel.x) + Math.abs(e.vel.z) > 0.5) {
      turnTo(e, Math.atan2(e.vel.x, e.vel.z), 3, dt);
    }
  }

  // -------------------------------------------------------------------------
  // Procedural animation — pose is recomputed from state each frame (no drift)
  // -------------------------------------------------------------------------
  function animate(e, dt, t) {
    const P = e.holder.model.parts;
    const gp = e.holder.model.group;
    const spd = Math.hypot(e.vel.x, e.vel.z);
    e.animSpd += (spd - e.animSpd) * Math.min(1, 10 * dt);
    const walk = clamp(e.animSpd / Math.max(e.speed, 0.01), 0, 1.3);
    e.walkPhase += e.animSpd * dt * 2.3;
    const ph = e.walkPhase;
    const breathe = Math.sin(t * 2.2 + e.seed * 9) * 0.03;

    gp.position.copy(e.pos);
    let tiltX = 0, tiltZ = 0;

    if (e.state === 'dead') {
      const f = Math.min(1, e.deadT / 0.5);
      gp.rotation.set(0, e.yaw, e.fallDir * f * 1.5);
      if (e.deadT > SINK_AFTER) gp.position.y -= (e.deadT - SINK_AFTER) / SINK_T * (e.height + 0.6);
      return;
    }

    if (e.state === 'telegraph') {
      const f = e.stateT / TELEGRAPH_T;
      tiltX = -0.4 * f; // lean back — the readable tell
    } else if (e.state === 'strike') {
      tiltX = 0.45 * (1 - e.stateT / STRIKE_T);
    } else if (e.state === 'flinch') {
      tiltX = -0.3 * (1 - e.stateT / FLINCH_T);
    } else if (e.state === 'stagger') {
      tiltZ = Math.sin(e.stateT * 9) * 0.28 * (1 - e.stateT / STAGGER_T);
    }

    const kind = e.holder.model.kind;

    if (kind === 'quad') {
      const s = Math.sin(ph) * 0.7 * walk;
      P.legFL.rotation.x = s; P.legBR.rotation.x = s;
      P.legFR.rotation.x = -s; P.legBL.rotation.x = -s;
      P.body.position.y = P.body.userData.by + Math.abs(Math.sin(ph)) * 0.05 * walk + breathe;
      P.tail.rotation.y = Math.sin(t * 3 + e.seed * 5) * 0.3;
      P.head.rotation.x = e.state === 'telegraph' ? -0.5 * (e.stateT / TELEGRAPH_T)
        : e.state === 'strike' ? 0.4 : Math.sin(t * 1.5 + e.seed * 3) * 0.06;
      if (e.state === 'telegraph') P.body.position.y -= 0.16 * (e.stateT / TELEGRAPH_T); // crouch before pounce
    } else if (kind === 'biped') {
      const s = Math.sin(ph) * 0.55 * walk;
      if (P.legL) P.legL.rotation.x = s;
      if (P.legR) P.legR.rotation.x = -s;
      P.armL.rotation.x = -s * 0.8;
      let armR = s * 0.8;
      if (e.state === 'telegraph') armR = -2.1 * (e.stateT / TELEGRAPH_T);        // raise weapon high
      else if (e.state === 'strike') armR = -2.1 + 3.1 * Math.min(1, e.stateT / 0.18); // chop down
      else if (e.state === 'guard') armR = -1.3;                                   // blade across
      P.armR.rotation.x = armR;
      P.armR.rotation.z = e.state === 'guard' ? -0.7 : 0;
      P.body.position.y = P.body.userData.by + Math.abs(Math.sin(ph)) * 0.04 * walk + breathe;
      P.head.rotation.y = Math.sin(t * 0.9 + e.seed * 7) * 0.12 * (e.aggro ? 0 : 1);
      if (e.type === 'skeleton') P.body.rotation.z = Math.sin(t * 8 + e.seed * 4) * 0.02; // bone rattle jitter
      if (e.isVargr && P.legL) P.legL.rotation.z = Math.sin(ph) * 0.06 * walk;     // coat sway
    } else { // drake
      const flap = e.fly ? (e.dstate === 'breath' ? 4.5 : 6.5) : 1.2;
      const amp = e.fly ? 0.55 : 0.1;
      const w = Math.sin(t * flap) * amp;
      P.wingL.rotation.z = w + (e.fly ? 0.15 : 1.15);
      P.wingR.rotation.z = -w - (e.fly ? 0.15 : 1.15);
      P.tail.rotation.y = Math.sin(t * 2.1) * 0.25;
      P.neck.rotation.x = e.dstate === 'breath' ? 0.35 :
        e.state === 'telegraph' ? -0.5 * (e.stateT / TELEGRAPH_T) :
        e.state === 'strike' ? 0.5 : Math.sin(t * 1.3) * 0.06;
      P.body.position.y = P.body.userData.by + breathe * 2;
      if (e.fly) tiltX = clamp(-e.vel.y * 0.04, -0.45, 0.45);
    }

    gp.rotation.set(tiltX, e.yaw, tiltZ);
  }

  // -------------------------------------------------------------------------
  // Billboards: blob shadow + floating hp bar
  // -------------------------------------------------------------------------
  function updateBillboards(e, pd) {
    const h = e.holder;
    // blob shadow hugs the terrain; shrinks as the drake climbs
    h.shadow.position.set(e.pos.x, e.groundY + 0.06, e.pos.z);
    if (e.type === 'drake') {
      const sc = clamp(1 - (e.pos.y - e.groundY) / 45, 0.25, 1) * e.shadowD;
      h.shadow.scale.set(sc, sc, 1);
    }
    if (e.state === 'dead' && e.deadT > SINK_AFTER) h.shadow.visible = false;
    // hp bar: only when hurt, aggroed and close (drake uses the boss bar)
    const show = e.alive && e.aggro && e.hp < e.maxHp && pd < 40 && e.type !== 'drake';
    h.bar.visible = show;
    if (show) {
      h.bar.position.set(e.pos.x, e.pos.y + e.height + 0.55, e.pos.z);
      h.bar.quaternion.copy(g.camera.quaternion);
      const frac = clamp(e.hp / e.maxHp, 0, 1);
      const w = h.barW - 0.06;
      h.barFill.scale.x = Math.max(w * frac, 0.001);
      h.barFill.position.x = -w * 0.5 * (1 - frac);
    }
  }

  // -------------------------------------------------------------------------
  // Spawn scan (throttled)
  // -------------------------------------------------------------------------
  let scanT = 0;
  function scanSpawners(t) {
    const p = g.player.position;
    let active = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.boss && !e.isVargr) active++;
    }
    for (let i = 0; i < spawners.length; i++) {
      const s = spawners[i];
      if (s.enemy || s.permaDead) continue;
      if (s.isVargr && g.flags.vargrDead) { s.permaDead = true; continue; }
      if (s.boss && bossState[s.type] && bossState[s.type].dead) { s.permaDead = true; continue; }
      if (s.nightOnly && !night) continue;
      if (t < s.respawnAt) continue;
      const d = dist2d(s.x, s.z, p.x, p.z);
      const maxR = s.type === 'drake' ? 300 : SPAWN_R;
      if (d > maxR || (d < 26 && !s.boss && !s.isVargr)) continue;
      if (!s.boss && !s.isVargr && active >= ACTIVE_CAP) continue;
      spawnEnemy(s.type, s.x, s.z, s);
      if (!s.boss && !s.isVargr) active++;
    }
  }

  // -------------------------------------------------------------------------
  // Nemesis bookkeeping: Vargr remembers his victories
  // -------------------------------------------------------------------------
  let lastHitter = null;
  let lastHitT = -99;
  events.on('playerDied', () => {
    if (lastHitter && lastHitter.isVargr && lastHitter.alive &&
        g.time.elapsed - lastHitT < 6) {
      g.flags.vargrWins = (g.flags.vargrWins | 0) + 1;
      refreshVargrScars(lastHitter);
    }
    // everyone stands down
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      e.aggro = false;
      if (e.type === 'drake' && e.fly) e.dstate = 'homeward';
      else if (e.state !== 'dead') { e.state = 'return'; e.stateT = 0; }
    }
  });

  // -------------------------------------------------------------------------
  // combatState + bossBar bookkeeping
  // -------------------------------------------------------------------------
  let inCombat = false;
  let lastAggroT = -99;
  let bossBarShown = false;
  let bossBarT = 0;

  function updateGlobalState(t) {
    let anyAggro = false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive && e.aggro) { anyAggro = true; break; }
    }
    if (anyAggro) {
      lastAggroT = t;
      if (!inCombat) { inCombat = true; events.emit('combatState', CS_ON); }
    } else if (inCombat && t - lastAggroT > 5) {
      inCombat = false; events.emit('combatState', CS_OFF);
    }

    // Boss bar: drake within 120u takes priority, then an aggroed barrowlord
    let bbe = null;
    const p = g.player.position;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.type === 'drake' && dist2d(e.pos.x, e.pos.z, p.x, p.z) < 120) { bbe = e; break; }
      if (e.type === 'barrowlord' && e.aggro) bbe = e;
    }
    if (bbe) {
      bossBarT -= g.time.dt;
      if (!bossBarShown || bossBarT <= 0) {
        bossBarT = 0.15;
        bossBarShown = true;
        _bb.name = bbe.name; _bb.hp = Math.max(0, bbe.hp); _bb.maxHp = bbe.maxHp;
        events.emit('bossBar', _bb);
      }
    } else if (bossBarShown) {
      bossBarShown = false;
      events.emit('bossBar', null);
    }
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  function update(dt) {
    if (g.paused || !g.player) return;
    const t = g.time.elapsed;
    night = isNightFrac(g.time.dayFrac);
    const p = g.player.position;

    scanT -= dt;
    if (scanT <= 0) { scanT = 0.6; scanSpawners(t); }

    // Cheap pairwise separation (before state updates, uses last positions)
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      if (!a.alive || a.fly) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.fly) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.bodyR + b.bodyR;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5 / d;
        a.pos.x -= dx * push; a.pos.z -= dz * push;
        b.pos.x += dx * push; b.pos.z += dz * push;
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const pd = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);

      if (e.state === 'dead') {
        e.deadT += dt;
        if (e.type === 'drake' && e.fly) { // shot from the sky: fall first
          e.pos.y -= 14 * dt;
          if (e.pos.y <= e.groundY) { e.pos.y = e.groundY; e.fly = false; }
          e.deadT = Math.min(e.deadT, 0.4);
        }
        animate(e, dt, t);
        updateBillboards(e, pd);
        if (e.deadT > SINK_AFTER + SINK_T) despawn(e);
        continue;
      }

      // Despawn wanderers that drift far behind (bosses persist)
      if (!e.boss && !e.isVargr && pd > DESPAWN_R) { despawn(e); continue; }

      if (e.type === 'drake') updateDrake(e, dt, t, pd);
      else updateGrounded(e, dt, t, pd);

      animate(e, dt, t);
      updateBillboards(e, pd);
    }

    // Skeleton night rattle ambience
    if (night && t > nextRattle) {
      nextRattle = t + 6 + Math.random() * 8;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.alive && e.type === 'skeleton' && dist2d(e.pos.x, e.pos.z, p.x, p.z) < 28) {
          sfx('skeletonRattle');
          break;
        }
      }
    }

    updateFire(dt);
    updateGlobalState(t);
  }

  // -------------------------------------------------------------------------
  // Save / load: bosses + nemesis persistence
  // -------------------------------------------------------------------------
  function serialize() {
    return {
      drake: { dead: bossState.drake.dead, hp: Math.round(bossState.drake.hp) },
      barrowlord: { dead: bossState.barrowlord.dead, hp: Math.round(bossState.barrowlord.hp) },
      // vargrDead / vargrWins live in g.flags (saved by save.js)
    };
  }
  function deserialize(o) {
    if (!o) return;
    if (o.drake) {
      bossState.drake.dead = !!o.drake.dead;
      if (typeof o.drake.hp === 'number' && !bossState.drake.dead) {
        bossState.drake.hp = clamp(o.drake.hp, 1, TYPES.drake.hp);
      }
    }
    if (o.barrowlord) {
      bossState.barrowlord.dead = !!o.barrowlord.dead;
      if (typeof o.barrowlord.hp === 'number' && !bossState.barrowlord.dead) {
        bossState.barrowlord.hp = clamp(o.barrowlord.hp, 1, TYPES.barrowlord.hp);
      }
    }
    // Despawn any live bosses that the save says are dead
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if ((e.type === 'drake' && bossState.drake.dead) ||
          (e.type === 'barrowlord' && bossState.barrowlord.dead)) {
        despawn(e);
      }
    }
  }

  return {
    update, list, spawnAt, queryHit, queryPoint, damage,
    countAlive, bossAlive, serialize, deserialize,
  };
}

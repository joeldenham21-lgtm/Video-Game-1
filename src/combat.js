// ============================================================================
// ELDERFALL — combat.js
// Weapons, first-person viewmodel (procedural low-poly arm + weapons parented
// to the camera), hand-animated attack curves, hitstop/parry juice, pooled
// projectiles (arrows + fireballs), loot pickups, and ONE pooled additive
// particle system for sparks / blood / embers / heal swirls / explosions.
// Owns the shared g.pointLight (torch / fireball / explosion flash).
// ============================================================================
import * as THREE from 'three';
import { clamp, lerp, terrainHeight } from './core.js';

// ---------------------------------------------------------------------------
// Module-scope temps (ZERO per-frame allocations in update)
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _hitPos = new THREE.Vector3(); // reused hitLanded payload position

// Easing helpers ------------------------------------------------------------
const easeIn2 = (t) => t * t;
const easeIn3 = (t) => t * t * t;
const easeOut3 = (t) => { const u = 1 - t; return 1 - u * u * u; };
const easeOut4 = (t) => { const u = 1 - t; return 1 - u * u * u * u; };
const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Weapon definitions (contract section 4)
// ---------------------------------------------------------------------------
const WEAPONS = {
  sword:  { name: 'Iron Sword',    light: 14, heavy: 26, range: 2.9, arc: 65 },
  bow:    { name: 'Hunting Bow',   dmgMin: 10, dmgMax: 34, drawTime: 0.9 },
  fire:   { name: 'Flamecall',     mana: 14, dmg: 30, radius: 3.5 },
  heal:   { name: 'Mending Light', mana: 20, amount: 35 },
  torch:  { name: 'Torch',         light: 6, range: 2.2, arc: 50 },
  potion: { name: 'Health Potion', amount: 45 },
};
const HOTBAR = ['sword', 'bow', 'fire', 'heal', 'torch', 'potion'];

const STAMINA_LIGHT = 10;
const STAMINA_HEAVY = 22;
const HEAVY_HOLD = 0.35;      // hold this long → heavy on release (sword)
const PARRY_WINDOW = 0.22;    // seconds after block start

// Particle FX presets (preallocated — passed by reference, never per-frame)
const FX = {
  spark:   { c1: [1.0, 0.95, 0.6], c2: [1.0, 0.55, 0.15], speed: 6.5, up: 0.35, grav: 9,  drag: 2.0, life: 0.34 },
  parry:   { c1: [1.0, 1.0, 0.9],  c2: [0.6, 0.85, 1.0],  speed: 9.0, up: 0.4,  grav: 6,  drag: 1.5, life: 0.5  },
  blood:   { c1: [0.9, 0.1, 0.08], c2: [0.55, 0.03, 0.03], speed: 4.2, up: 0.5, grav: 13, drag: 1.2, life: 0.55 },
  ember:   { c1: [1.0, 0.6, 0.15], c2: [1.0, 0.25, 0.05], speed: 0.8, up: 1.0,  grav: -1.5, drag: 1.0, life: 0.6 },
  flame:   { c1: [1.0, 0.75, 0.3], c2: [1.0, 0.35, 0.05], speed: 0.5, up: 1.0,  grav: -2.5, drag: 1.0, life: 0.45 },
  heal:    { c1: [0.45, 1.0, 0.6], c2: [0.15, 0.85, 0.9], speed: 1.4, up: 0.9,  grav: -1.8, drag: 0.8, life: 1.0 },
  boom:    { c1: [1.0, 0.85, 0.4], c2: [1.0, 0.3, 0.05],  speed: 11,  up: 0.45, grav: 8,  drag: 2.2, life: 0.6  },
  smoke:   { c1: [0.45, 0.35, 0.25], c2: [0.2, 0.15, 0.1], speed: 2.0, up: 0.8, grav: -1.0, drag: 2.0, life: 0.9 },
  sparkle: { c1: [1.0, 0.95, 0.55], c2: [1.0, 0.8, 0.2],  speed: 2.2, up: 0.8,  grav: 3,  drag: 1.5, life: 0.45 },
  dust:    { c1: [0.55, 0.5, 0.4], c2: [0.35, 0.3, 0.22], speed: 2.0, up: 0.7,  grav: 5,  drag: 2.0, life: 0.4  },
};

// ===========================================================================
export function createCombat(g) {
  const events = g.events;

  // Camera must be in the scene graph for viewmodel children to render.
  // (Does not alter camera transform/projection — player still owns those.)
  if (!g.camera.parent) g.scene.add(g.camera);

  // -------------------------------------------------------------------------
  // Shared materials / geometries (built ONCE)
  // -------------------------------------------------------------------------
  const M = {
    skin:    new THREE.MeshLambertMaterial({ color: 0xd7a06a, flatShading: true }),
    sleeve:  new THREE.MeshLambertMaterial({ color: 0x4a4433, flatShading: true }),
    leather: new THREE.MeshLambertMaterial({ color: 0x6b4a2b, flatShading: true }),
    steel:   new THREE.MeshLambertMaterial({ color: 0xb9c2cc, flatShading: true }),
    ember:   new THREE.MeshLambertMaterial({ color: 0x7a4a3a, emissive: 0xff5a18, emissiveIntensity: 0.9, flatShading: true }),
    gold:    new THREE.MeshLambertMaterial({ color: 0xc9a23f, flatShading: true }),
    wood:    new THREE.MeshLambertMaterial({ color: 0x5a3d22, flatShading: true }),
    woodDark:new THREE.MeshLambertMaterial({ color: 0x3d2a17, flatShading: true }),
    string:  new THREE.MeshLambertMaterial({ color: 0xd8d2c0, flatShading: true }),
    feather: new THREE.MeshLambertMaterial({ color: 0xe8e2d0, flatShading: true }),
    fireOrb: new THREE.MeshLambertMaterial({ color: 0x442200, emissive: 0xff7722, emissiveIntensity: 1.6, flatShading: true }),
    healOrb: new THREE.MeshLambertMaterial({ color: 0x0a3320, emissive: 0x33ee77, emissiveIntensity: 1.4, flatShading: true }),
    flame:   new THREE.MeshLambertMaterial({ color: 0x331100, emissive: 0xffa030, emissiveIntensity: 1.7, flatShading: true }),
    flask:   new THREE.MeshLambertMaterial({ color: 0x7a1420, emissive: 0xaa1122, emissiveIntensity: 0.35, flatShading: true }),
    rune:    new THREE.MeshLambertMaterial({ color: 0x0a2a3a, emissive: 0x35c8ff, emissiveIntensity: 1.3, flatShading: true }),
    fireball:new THREE.MeshLambertMaterial({ color: 0x552200, emissive: 0xff8830, emissiveIntensity: 2.0, flatShading: true }),
  };
  const GEO = {
    box:    new THREE.BoxGeometry(1, 1, 1),
    cone:   new THREE.ConeGeometry(0.5, 1, 6),
    sphere: new THREE.SphereGeometry(0.5, 8, 6),
    octa:   new THREE.OctahedronGeometry(0.5, 0),
  };
  function part(mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0, geo = GEO.box) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.frustumCulled = false;
    return m;
  }

  // -------------------------------------------------------------------------
  // Viewmodel: low-poly right arm + one group per weapon, parented to camera
  // -------------------------------------------------------------------------
  const vmRoot = new THREE.Group();
  vmRoot.frustumCulled = false;
  g.camera.add(vmRoot);

  // Arm (origin of vmRoot = the hand)
  const arm = new THREE.Group();
  arm.add(part(M.skin,   0.085, 0.085, 0.12, 0, 0, 0.02));                 // hand
  arm.add(part(M.skin,   0.075, 0.075, 0.22, 0.03, -0.045, 0.16, -0.25, 0.12, 0)); // forearm
  arm.add(part(M.sleeve, 0.11,  0.11,  0.24, 0.085, -0.12, 0.32, -0.4, 0.2, 0));   // sleeve
  arm.add(part(M.leather,0.095, 0.03,  0.13, 0, 0.045, 0.05));             // bracer strap
  vmRoot.add(arm);

  // --- Sword (blade material swappable for Aldric's Ember) ---
  const swordG = new THREE.Group();
  const blade = part(M.steel, 0.055, 0.68, 0.016, 0, 0.44, 0);
  const bladeTip = part(M.steel, 0.11, 0.09, 0.032, 0, 0.82, 0, 0, 0, 0, GEO.cone);
  swordG.add(blade, bladeTip);
  swordG.add(part(M.gold,    0.17, 0.032, 0.045, 0, 0.095, 0));  // crossguard
  swordG.add(part(M.leather, 0.04, 0.15, 0.04, 0, 0, 0));        // grip
  swordG.add(part(M.gold,    0.055, 0.055, 0.055, 0, -0.095, 0, 0, 0, 0, GEO.sphere)); // pommel

  // --- Bow (vertical limbs + string + nocked arrow shown while drawing) ---
  const bowG = new THREE.Group();
  bowG.add(part(M.wood, 0.035, 0.22, 0.05, 0, 0, 0));                    // grip riser
  bowG.add(part(M.wood, 0.03, 0.42, 0.04, 0, 0.28, -0.05, 0.35, 0, 0));  // upper limb
  bowG.add(part(M.wood, 0.03, 0.42, 0.04, 0, -0.28, -0.05, -0.35, 0, 0));// lower limb
  const bowString = part(M.string, 0.008, 0.84, 0.008, 0, 0, -0.12);
  bowG.add(bowString);
  const nockArrow = new THREE.Group(); // slides back with draw
  nockArrow.add(part(M.woodDark, 0.016, 0.016, 0.55, 0, 0, 0.1));
  nockArrow.add(part(M.steel, 0.03, 0.06, 0.03, 0, 0, -0.2, -Math.PI / 2, 0, 0, GEO.cone));
  nockArrow.add(part(M.feather, 0.05, 0.012, 0.07, 0, 0, 0.34));
  nockArrow.add(part(M.feather, 0.012, 0.05, 0.07, 0, 0, 0.34));
  nockArrow.visible = false;
  bowG.add(nockArrow);

  // --- Fire / Heal casting orbs (hover over the open palm) ---
  const fireG = new THREE.Group();
  const fireOrbMesh = part(M.fireOrb, 0.13, 0.13, 0.13, 0, 0.1, -0.06, 0, 0, 0, GEO.sphere);
  fireG.add(fireOrbMesh);
  fireG.add(part(M.ember, 0.2, 0.2, 0.2, 0, 0.1, -0.06, 0.5, 0.4, 0, GEO.octa));
  const healG = new THREE.Group();
  const healOrbMesh = part(M.healOrb, 0.12, 0.12, 0.12, 0, 0.1, -0.06, 0, 0, 0, GEO.sphere);
  healG.add(healOrbMesh);
  healG.add(part(M.rune, 0.17, 0.17, 0.17, 0, 0.1, -0.06, 0.4, 0.6, 0, GEO.octa));

  // --- Torch ---
  const torchG = new THREE.Group();
  torchG.add(part(M.wood, 0.045, 0.42, 0.045, 0, 0.14, 0));
  torchG.add(part(M.woodDark, 0.09, 0.1, 0.09, 0, 0.37, 0));
  const torchFlame = part(M.flame, 0.11, 0.2, 0.11, 0, 0.5, 0, 0, 0, 0, GEO.cone);
  torchG.add(torchFlame);

  // --- Potion flask ---
  const potionG = new THREE.Group();
  potionG.add(part(M.flask, 0.13, 0.15, 0.13, 0, 0.02, 0, 0, 0, 0, GEO.sphere));
  potionG.add(part(M.flask, 0.045, 0.09, 0.045, 0, 0.12, 0));
  potionG.add(part(M.wood, 0.05, 0.03, 0.05, 0, 0.17, 0));

  const weaponGroups = { sword: swordG, bow: bowG, fire: fireG, heal: healG, torch: torchG, potion: potionG };
  for (const id in weaponGroups) {
    weaponGroups[id].visible = false;
    vmRoot.add(weaponGroups[id]);
  }

  // Per-weapon base pose of vmRoot (camera-local): px py pz rx ry rz
  const BASE_POSE = {
    sword:  [0.36, -0.35, -0.62, -0.35, -0.30, 0.10],
    bow:    [0.20, -0.26, -0.58,  0.00,  0.35, -0.12],
    fire:   [0.32, -0.32, -0.56, -0.25, -0.15, 0.00],
    heal:   [0.32, -0.32, -0.56, -0.25, -0.15, 0.00],
    torch:  [0.36, -0.30, -0.60, -0.20, -0.20, 0.08],
    potion: [0.32, -0.36, -0.55, -0.15, -0.10, 0.00],
  };

  // -------------------------------------------------------------------------
  // ONE pooled additive Points particle system (~300 verts)
  // -------------------------------------------------------------------------
  const P_MAX = 300;
  const pPos = new Float32Array(P_MAX * 3);
  const pCol = new Float32Array(P_MAX * 3);
  const pVel = new Float32Array(P_MAX * 3);
  const pBase = new Float32Array(P_MAX * 3); // base color, faded by life
  const pLife = new Float32Array(P_MAX);
  const pMaxLife = new Float32Array(P_MAX);
  const pGrav = new Float32Array(P_MAX);
  const pDrag = new Float32Array(P_MAX);
  for (let i = 0; i < P_MAX; i++) pPos[i * 3 + 1] = -9999;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.13, vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  g.scene.add(points);
  let pCursor = 0;
  let pDirty = false;

  function spawnDirected(fx, x, y, z, vx, vy, vz) {
    const i = pCursor; pCursor = (pCursor + 1) % P_MAX;
    const i3 = i * 3;
    pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
    pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = vz;
    const m = Math.random();
    pBase[i3]     = fx.c1[0] + (fx.c2[0] - fx.c1[0]) * m;
    pBase[i3 + 1] = fx.c1[1] + (fx.c2[1] - fx.c1[1]) * m;
    pBase[i3 + 2] = fx.c1[2] + (fx.c2[2] - fx.c1[2]) * m;
    pCol[i3] = pBase[i3]; pCol[i3 + 1] = pBase[i3 + 1]; pCol[i3 + 2] = pBase[i3 + 2];
    pLife[i] = pMaxLife[i] = fx.life * (0.7 + Math.random() * 0.6);
    pGrav[i] = fx.grav; pDrag[i] = fx.drag;
    pDirty = true;
  }
  function spawnBurst(fx, x, y, z, count, speedScale = 1) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() * 2 - 1) * (1 - fx.up) + fx.up * Math.random();
      const s = fx.speed * speedScale * (0.4 + Math.random() * 0.8);
      const ch = Math.sqrt(Math.max(0, 1 - e * e));
      spawnDirected(fx, x, y, z, Math.cos(a) * ch * s, e * s + fx.up * fx.speed * 0.4 * speedScale, Math.sin(a) * ch * s);
    }
  }
  function updateParticles(dt) {
    let any = false;
    for (let i = 0; i < P_MAX; i++) {
      if (pLife[i] <= 0) continue;
      any = true;
      pLife[i] -= dt;
      const i3 = i * 3;
      if (pLife[i] <= 0) { pPos[i3 + 1] = -9999; continue; }
      const dr = Math.max(0, 1 - pDrag[i] * dt);
      pVel[i3] *= dr; pVel[i3 + 2] *= dr;
      pVel[i3 + 1] = pVel[i3 + 1] * dr - pGrav[i] * dt;
      pPos[i3] += pVel[i3] * dt;
      pPos[i3 + 1] += pVel[i3 + 1] * dt;
      pPos[i3 + 2] += pVel[i3 + 2] * dt;
      const f = pLife[i] / pMaxLife[i];
      const ff = f * f * (3 - 2 * f);
      pCol[i3] = pBase[i3] * ff; pCol[i3 + 1] = pBase[i3 + 1] * ff; pCol[i3 + 2] = pBase[i3 + 2] * ff;
    }
    if (any || pDirty) {
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
      pDirty = false;
    }
  }

  // -------------------------------------------------------------------------
  // Projectiles: pooled arrows + fireballs
  // -------------------------------------------------------------------------
  const ARROW_MAX = 8;
  const arrows = [];
  for (let i = 0; i < ARROW_MAX; i++) {
    const gr = new THREE.Group();
    gr.add(part(M.woodDark, 0.022, 0.022, 0.62, 0, 0, 0));
    gr.add(part(M.steel, 0.035, 0.08, 0.035, 0, 0, -0.34, -Math.PI / 2, 0, 0, GEO.cone));
    gr.add(part(M.feather, 0.06, 0.014, 0.09, 0, 0, 0.26));
    gr.add(part(M.feather, 0.014, 0.06, 0.09, 0, 0, 0.26));
    gr.visible = false;
    gr.frustumCulled = false;
    g.scene.add(gr);
    arrows.push({ obj: gr, vel: new THREE.Vector3(), life: 0, active: false, stuck: 0, dmg: 0 });
  }

  const FIREBALL_MAX = 4;
  const fireballs = [];
  for (let i = 0; i < FIREBALL_MAX; i++) {
    const m = part(M.fireball, 0.3, 0.3, 0.3, 0, 0, 0, 0, 0, 0, GEO.sphere);
    m.visible = false;
    g.scene.add(m);
    fireballs.push({ obj: m, vel: new THREE.Vector3(), life: 0, active: false, trailT: 0 });
  }

  function firstFreeOf(pool) {
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
    return pool[0]; // recycle
  }

  // -------------------------------------------------------------------------
  // Loot pickups (pool ≤ 40), listening to spawnLoot
  // -------------------------------------------------------------------------
  const lootGeo = {
    gold:   new THREE.OctahedronGeometry(0.13, 0),
    potion: new THREE.SphereGeometry(0.13, 8, 6),
    item:   new THREE.OctahedronGeometry(0.17, 0),
  };
  const lootMat = {
    gold:   new THREE.MeshLambertMaterial({ color: 0x8a6a20, emissive: 0xc9a23f, emissiveIntensity: 0.8, flatShading: true }),
    potion: M.flask,
    item:   M.rune,
  };
  const LOOT_MAX = 40;
  const loot = [];
  for (let i = 0; i < LOOT_MAX; i++) {
    const m = new THREE.Mesh(lootGeo.gold, lootMat.gold);
    m.visible = false;
    m.frustumCulled = false;
    g.scene.add(m);
    loot.push({ obj: m, active: false, kind: 'gold', amount: 0, itemId: null, baseY: 0, phase: 0, stamp: 0 });
  }
  let lootStamp = 0;

  events.on('spawnLoot', (d) => {
    if (!d || !d.pos) return;
    let slot = null, oldest = null;
    for (let i = 0; i < LOOT_MAX; i++) {
      if (!loot[i].active) { slot = loot[i]; break; }
      if (!oldest || loot[i].stamp < oldest.stamp) oldest = loot[i];
    }
    if (!slot) slot = oldest;
    const kind = d.kind || 'gold';
    slot.active = true;
    slot.kind = kind;
    slot.amount = d.amount != null ? d.amount : 1;
    slot.itemId = d.itemId || null;
    slot.stamp = ++lootStamp;
    slot.phase = Math.random() * Math.PI * 2;
    const groundY = terrainHeight(d.pos.x, d.pos.z) + 0.45;
    slot.baseY = Math.max(d.pos.y != null ? d.pos.y : groundY, groundY);
    slot.obj.position.set(d.pos.x, slot.baseY, d.pos.z);
    slot.obj.geometry = lootGeo[kind] || lootGeo.item;
    slot.obj.material = lootMat[kind] || lootMat.item;
    slot.obj.scale.setScalar(kind === 'gold' ? Math.min(1.3, 0.8 + slot.amount * 0.012) : 1);
    slot.obj.visible = true;
  });

  function updateLoot(dt) {
    const pl = g.player;
    if (!pl) return;
    const t = g.time.elapsed;
    for (let i = 0; i < LOOT_MAX; i++) {
      const L = loot[i];
      if (!L.active) continue;
      const o = L.obj;
      o.rotation.y += dt * 2.4;
      _v1.set(pl.position.x, pl.position.y + 0.9, pl.position.z);
      const d = o.position.distanceTo(_v1);
      if (d < 1.2) {
        // Collect
        L.active = false;
        o.visible = false;
        spawnBurst(FX.sparkle, o.position.x, o.position.y, o.position.z, 8, 1);
        if (L.kind === 'gold') pl.addGold(L.amount);
        else if (L.kind === 'potion') pl.stats.potions += L.amount;
        else if (L.itemId) g.flags['item_' + L.itemId] = true;
        events.emit('pickup', { kind: L.kind, amount: L.amount, itemId: L.itemId || undefined });
        continue;
      }
      if (d < 3.5) {
        // Magnet toward player, accelerating as it closes
        const pull = (4 + (3.5 - d) * 5) * dt;
        _v2.subVectors(_v1, o.position).normalize().multiplyScalar(pull);
        o.position.add(_v2);
      } else {
        o.position.y = L.baseY + Math.sin(t * 2.2 + L.phase) * 0.14;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Combat / viewmodel state
  // -------------------------------------------------------------------------
  let current = 'sword';
  let prevWeapon = 'sword';   // for potion auto-return
  let pendingEquip = null;
  let state = 'raise';        // idle|charge|swingL|swingH|draw|shootRecoil|cast|heal|drink|lower|raise
  let stateT = 0;
  let didAct = false;         // one-shot flag per state (hit test / spawn / apply)
  let chargeT = 0;            // attack button hold time (sword heavy)
  let drawT = 0;              // bow draw time
  let lastDraw01 = 0;
  let blockBlend = 0;
  let blockStartAt = -10;
  let blocking = false;
  let swayX = 0, swayY = 0;   // look-delta sway (spring)
  let bobPhase = 0;
  let emberT = 0, flameT = 0, healSwirlT = 0, healSwirlLeft = 0;
  let castOrbCharge = 0;
  let flashT = 0;             // explosion light flash
  const flashPos = new THREE.Vector3();
  let aldricApplied = false;

  function setWeaponVisible(id) {
    for (const k in weaponGroups) weaponGroups[k].visible = (k === id);
  }
  setWeaponVisible('sword');

  function checkAldric() {
    if (g.flags.hasAldricSword && !aldricApplied) {
      aldricApplied = true;
      blade.material = M.ember;
      bladeTip.material = M.ember;
    }
  }

  function swordDmg(heavy) {
    const bonus = g.flags.hasAldricSword ? 10 : 0;
    return (heavy ? WEAPONS.sword.heavy : WEAPONS.sword.light) + bonus;
  }
  function dmgMul() {
    return 1 + ((g.player && g.player.bonus) ? g.player.bonus.dmg : 0);
  }

  // Best-effort enemy world position (contract doesn't pin the field name)
  function enemyPos(e, out) {
    const p = e.pos || e.position || (e.group && e.group.position) || (e.mesh && e.mesh.position);
    if (p) { out.set(p.x, (p.y || 0) + 0.9, p.z); return out; }
    return out.copy(_camPos).addScaledVector(_camDir, 2);
  }
  function isDead(e) {
    return (e.hp !== undefined && e.hp <= 0) || e.dead === true || e.alive === false;
  }

  // The juice package: EVERY landed hit stacks hitstop + shake + particles + sound
  function hitJuice(pos, heavy, kill) {
    g.requestHitstop(70);
    g.player.addShake(heavy ? 0.5 : 0.25);
    spawnBurst(FX.spark, pos.x, pos.y, pos.z, heavy ? 10 : 6, heavy ? 1.3 : 1);
    spawnBurst(FX.blood, pos.x, pos.y, pos.z, heavy ? 14 : 8, heavy ? 1.25 : 1);
    if (g.flags.hasAldricSword && (current === 'sword')) {
      spawnBurst(FX.ember, pos.x, pos.y, pos.z, 6, 1.4);
    }
    if (g.audio) g.audio.play('hitFlesh');
    _hitPos.copy(pos);
    events.emit('hitLanded', { pos: _hitPos, kill: !!kill, heavy: !!heavy });
  }

  // Melee swing hit test at swing apex
  function meleeHit(heavy) {
    if (!g.enemies || !g.enemies.queryHit) return;
    const w = current === 'torch' ? WEAPONS.torch : WEAPONS.sword;
    const base = current === 'torch' ? WEAPONS.torch.light : swordDmg(heavy);
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    const halfAngle = (w.arc * 0.5) * Math.PI / 180;
    const hits = g.enemies.queryHit(_camPos, _camDir, w.range, halfAngle);
    if (!hits || hits.length === 0) return;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      enemyPos(e, _v3);
      _v2.subVectors(_v3, _camPos).normalize();
      g.enemies.damage(e, base * dmgMul(), _v2, { heavy });
      hitJuice(_v3, heavy, isDead(e));
    }
  }

  // ---- Projectile launches --------------------------------------------------
  function shootArrow(draw01) {
    const a = firstFreeOf(arrows);
    a.active = true; a.stuck = 0; a.life = 6;
    a.dmg = lerp(WEAPONS.bow.dmgMin, WEAPONS.bow.dmgMax, draw01) * dmgMul();
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    a.obj.position.copy(_camPos).addScaledVector(_camDir, 0.5);
    a.obj.position.y -= 0.12;
    a.vel.copy(_camDir).multiplyScalar(lerp(24, 52, draw01));
    _v1.copy(a.obj.position).add(a.vel);
    a.obj.lookAt(_v1);
    a.obj.visible = true;
    if (g.audio) g.audio.play('bowShoot');
    events.emit('attackSwing', { weapon: 'bow', heavy: draw01 > 0.85 });
  }

  function castFireball() {
    const f = firstFreeOf(fireballs);
    f.active = true; f.life = 6; f.trailT = 0;
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    f.obj.position.copy(_camPos).addScaledVector(_camDir, 0.7);
    f.obj.position.y -= 0.1;
    f.vel.copy(_camDir).multiplyScalar(26);
    f.obj.visible = true;
    if (g.audio) g.audio.play('fireCast');
    events.emit('attackSwing', { weapon: 'fire', heavy: false });
  }

  function explodeFireball(f) {
    f.active = false;
    f.obj.visible = false;
    const p = f.obj.position;
    spawnBurst(FX.boom, p.x, p.y, p.z, 34, 1);
    spawnBurst(FX.spark, p.x, p.y, p.z, 12, 1.8);
    spawnBurst(FX.smoke, p.x, p.y + 0.4, p.z, 8, 1);
    flashT = 0.28;
    flashPos.copy(p);
    if (g.audio) g.audio.play('fireExplode');
    // AoE damage
    if (g.enemies && g.enemies.queryPoint) {
      const hits = g.enemies.queryPoint(p, WEAPONS.fire.radius);
      if (hits && hits.length) {
        for (let i = 0; i < hits.length; i++) {
          const e = hits[i];
          enemyPos(e, _v3);
          _v2.subVectors(_v3, p); _v2.y = 0.4; _v2.normalize();
          g.enemies.damage(e, WEAPONS.fire.dmg * dmgMul(), _v2, { heavy: true });
          hitJuice(_v3, true, isDead(e));
        }
      }
    }
    // Player shake by proximity even without a hit
    if (g.player) {
      const d = p.distanceTo(g.player.position);
      if (d < 14) g.player.addShake(clamp(0.7 - d * 0.05, 0, 0.6));
    }
  }

  function updateProjectiles(dt) {
    // Arrows: gravity, terrain + enemy collision, brief stick, 6s life
    for (let i = 0; i < ARROW_MAX; i++) {
      const a = arrows[i];
      if (!a.active) continue;
      a.life -= dt;
      if (a.life <= 0) { a.active = false; a.obj.visible = false; continue; }
      if (a.stuck > 0) continue; // resting in terrain, just age out
      a.vel.y -= 16 * dt;
      a.obj.position.addScaledVector(a.vel, dt);
      _v1.copy(a.obj.position).add(a.vel);
      a.obj.lookAt(_v1);
      const p = a.obj.position;
      if (g.enemies && g.enemies.queryPoint) {
        const hits = g.enemies.queryPoint(p, 0.7);
        if (hits && hits.length) {
          const e = hits[0];
          enemyPos(e, _v3);
          _v2.copy(a.vel).normalize();
          const heavy = a.dmg > 26;
          g.enemies.damage(e, a.dmg, _v2, { heavy });
          hitJuice(_v3, heavy, isDead(e));
          if (g.audio) g.audio.play('arrowHit');
          a.active = false; a.obj.visible = false;
          continue;
        }
      }
      const th = terrainHeight(p.x, p.z);
      if (p.y <= th + 0.05) {
        p.y = th + 0.05;
        a.stuck = 1;
        a.life = Math.min(a.life, 2.5);
        spawnBurst(FX.dust, p.x, p.y + 0.1, p.z, 5, 1);
        if (g.audio) g.audio.play('arrowHit');
      }
    }
    // Fireballs: straight flight, trail embers, explode on contact/expiry
    for (let i = 0; i < FIREBALL_MAX; i++) {
      const f = fireballs[i];
      if (!f.active) continue;
      f.life -= dt;
      f.obj.position.addScaledVector(f.vel, dt);
      const p = f.obj.position;
      f.trailT += dt;
      while (f.trailT > 0.03) {
        f.trailT -= 0.03;
        spawnDirected(FX.ember, p.x, p.y, p.z,
          (Math.random() - 0.5) * 1.5, (Math.random() - 0.2) * 1.5, (Math.random() - 0.5) * 1.5);
      }
      let boom = f.life <= 0 || p.y <= terrainHeight(p.x, p.z) + 0.2;
      if (!boom && g.enemies && g.enemies.queryPoint) {
        const hits = g.enemies.queryPoint(p, 1.1);
        if (hits && hits.length) boom = true;
      }
      if (boom) explodeFireball(f);
    }
  }

  // -------------------------------------------------------------------------
  // Block / parry — enemies call g.combat.tryBlock(dmg)
  // -------------------------------------------------------------------------
  function tryBlock(dmg) {
    if (!blocking) return { blocked: false, parried: false };
    const sinceBlock = g.time.elapsed - blockStartAt;
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    _v1.copy(_camPos).addScaledVector(_camDir, 1.1);
    if (sinceBlock <= PARRY_WINDOW) {
      // PARRY — the best feeling in the game: spark burst + 250ms slow-mo
      g.requestHitstop(250);
      g.player.addShake(0.35);
      spawnBurst(FX.parry, _v1.x, _v1.y, _v1.z, 22, 1);
      spawnBurst(FX.spark, _v1.x, _v1.y, _v1.z, 10, 1.5);
      if (g.audio) g.audio.play('parry');
      events.emit('parry', {});
      return { blocked: true, parried: true };
    }
    // Normal block: costs stamina instead of hp; guard breaks when exhausted
    const cost = dmg * 0.8;
    if (g.player.stats.stamina < cost * 0.4) return { blocked: false, parried: false };
    g.player.stats.stamina = Math.max(0, g.player.stats.stamina - cost);
    g.player.addShake(0.18);
    spawnBurst(FX.spark, _v1.x, _v1.y, _v1.z, 5, 0.7);
    if (g.audio) g.audio.play('block');
    return { blocked: true, parried: false };
  }

  // -------------------------------------------------------------------------
  // Equip
  // -------------------------------------------------------------------------
  function equip(id) {
    if (!WEAPONS[id]) return;
    if (id === 'potion') {
      if (!g.player || g.player.stats.potions <= 0) {
        events.emit('notify', { text: 'No potions left' });
        return;
      }
      if (state === 'drink' || pendingEquip === 'potion') return;
      if (current !== 'potion') prevWeapon = current;
    } else if (id === current && state !== 'lower' && pendingEquip === null) {
      return;
    }
    pendingEquip = id;
    if (state !== 'lower') { state = 'lower'; stateT = 0; }
    events.emit('equip', { id });
  }

  function finishLower() {
    const id = pendingEquip || current;
    pendingEquip = null;
    current = id;
    api.current = id;
    setWeaponVisible(id);
    checkAldric();
    state = 'raise'; stateT = 0;
  }

  // -------------------------------------------------------------------------
  // Attack input state machine
  // -------------------------------------------------------------------------
  function startLight() {
    const st = g.player.stats;
    if (st.stamina < STAMINA_LIGHT) return;
    st.stamina -= STAMINA_LIGHT;
    state = 'swingL'; stateT = 0; didAct = false;
    if (g.audio) g.audio.play('swing');
    events.emit('attackSwing', { weapon: current, heavy: false });
  }
  function startHeavy() {
    const st = g.player.stats;
    if (st.stamina < STAMINA_HEAVY) { startLight(); return; } // downgrade
    st.stamina -= STAMINA_HEAVY;
    state = 'swingH'; stateT = 0; didAct = false;
    if (g.audio) g.audio.play('swingHeavy');
    events.emit('attackSwing', { weapon: current, heavy: true });
  }

  function updateAttackInput(input, dt) {
    const busy = state === 'lower' || state === 'raise' || state === 'drink' ||
                 state === 'cast' || state === 'heal' || state === 'swingL' ||
                 state === 'swingH' || state === 'shootRecoil';
    if (current === 'sword' || current === 'torch') {
      if (input.attackPressed && !busy && state !== 'charge') {
        state = 'charge'; chargeT = 0;
      }
      if (state === 'charge') {
        if (input.attackReleased || !input.attackHeld) {
          state = 'idle'; stateT = 0; // startLight/Heavy override on success
          if (current === 'sword' && chargeT >= HEAVY_HOLD) startHeavy();
          else startLight();
        } else {
          chargeT += dt;
        }
      }
    } else if (current === 'bow') {
      if (input.attackPressed && !busy && state !== 'draw') {
        state = 'draw'; drawT = 0;
        nockArrow.visible = true;
        if (g.audio) g.audio.play('bowDraw');
      }
      if (state === 'draw') {
        if (input.attackReleased || !input.attackHeld) {
          nockArrow.visible = false;
          if (drawT >= 0.12) {
            lastDraw01 = clamp(drawT / WEAPONS.bow.drawTime, 0, 1);
            shootArrow(lastDraw01);
            state = 'shootRecoil'; stateT = 0;
          } else {
            state = 'idle'; stateT = 0;
          }
        } else {
          drawT += dt;
        }
      }
    } else if (current === 'fire') {
      if (input.attackPressed && !busy) {
        if (g.player.stats.mana >= WEAPONS.fire.mana) {
          g.player.stats.mana -= WEAPONS.fire.mana;
          state = 'cast'; stateT = 0; didAct = false;
        }
      }
    } else if (current === 'heal') {
      if (input.attackPressed && !busy) {
        const st = g.player.stats;
        if (st.mana >= WEAPONS.heal.mana && st.hp < st.maxHp + (g.player.bonus.maxHp || 0)) {
          st.mana -= WEAPONS.heal.mana;
          state = 'heal'; stateT = 0; didAct = false;
          if (g.audio) g.audio.play('heal');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Viewmodel animation — hand-tuned curves. Snappy anticipation, sharp
  // contact, smooth recovery. All applied as offsets on the base pose.
  // -------------------------------------------------------------------------
  let px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0; // pose offsets (module of closure)

  function poseSwingLight(t) {
    // 0.32s: fast pull-back → violent diagonal slash → smooth recovery
    if (t < 0.25) {
      const k = easeIn3(t / 0.25);
      ry += 0.55 * k; rx += -0.35 * k; px += 0.10 * k; pz += 0.14 * k; rz += 0.25 * k;
    } else if (t < 0.55) {
      const k = easeOut4((t - 0.25) / 0.3);
      ry += lerp(0.55, -1.15, k); rx += lerp(-0.35, 0.45, k); rz += lerp(0.25, -0.7, k);
      px += lerp(0.10, -0.28, k); pz += lerp(0.14, -0.30, k); py += -0.10 * k;
    } else {
      const k = smooth((t - 0.55) / 0.45);
      ry += lerp(-1.15, 0, k); rx += lerp(0.45, 0, k); rz += lerp(-0.7, 0, k);
      px += lerp(-0.28, 0, k); pz += lerp(-0.30, 0, k); py += lerp(-0.10, 0, k);
    }
  }
  function poseSwingHeavy(t) {
    // 0.55s: overhead raise → crash down with body weight → slow recovery
    if (t < 0.22) {
      const k = easeIn2(t / 0.22);
      rx += -0.95 * k; ry += 0.35 * k; py += 0.22 * k; pz += 0.16 * k;
    } else if (t < 0.48) {
      const k = easeOut4((t - 0.22) / 0.26);
      rx += lerp(-0.95, 0.85, k); ry += lerp(0.35, -0.35, k); rz += -0.35 * k;
      py += lerp(0.22, -0.24, k); pz += lerp(0.16, -0.34, k);
    } else {
      const k = smooth((t - 0.48) / 0.52);
      rx += lerp(0.85, 0, k); ry += lerp(-0.35, 0, k); rz += lerp(-0.35, 0, k);
      py += lerp(-0.24, 0, k); pz += lerp(-0.34, 0, k);
    }
  }
  function poseCharge(hold01) {
    // Windup pose while holding for a heavy: blade raised over shoulder, quiver
    const k = smooth(hold01);
    rx += -0.8 * k; ry += 0.4 * k; py += 0.18 * k; pz += 0.12 * k;
    if (hold01 >= 1) {
      const t = g.time.elapsed * 34;
      px += Math.sin(t) * 0.004; py += Math.cos(t * 1.3) * 0.004;
    }
  }
  function poseDraw(d01, elapsed) {
    // Bow swings to screen center, hand draws back; trembles at full draw
    const k = easeOut3(clamp(d01 * 2.2, 0, 1));
    px += -0.14 * k; py += 0.06 * k; ry += -0.30 * k; rz += 0.12 * k;
    pz += 0.10 * smooth(d01);
    nockArrow.position.z = 0.1 + smooth(d01) * 0.24;
    bowString.position.z = -0.12 + smooth(d01) * 0.10;
    if (d01 >= 1) {
      const t = elapsed * 42;
      px += Math.sin(t) * 0.0045; py += Math.cos(t * 1.17) * 0.0045;
    }
  }
  function poseShootRecoil(t) {
    const k = 1 - easeOut3(t);
    pz += 0.12 * k; rx += -0.18 * k; ry += -0.10 * k;
    bowString.position.z = -0.12;
  }
  function poseCast(t) {
    // Fire: draw hand back to hip charging, then hard palm-thrust forward
    if (t < 0.42) {
      const k = easeIn2(t / 0.42);
      pz += 0.20 * k; px += 0.08 * k; rx += -0.35 * k;
      castOrbCharge = k;
    } else if (t < 0.62) {
      const k = easeOut4((t - 0.42) / 0.2);
      pz += lerp(0.20, -0.30, k); px += lerp(0.08, -0.10, k);
      rx += lerp(-0.35, 0.25, k); ry += -0.20 * k;
      castOrbCharge = 1 - k;
    } else {
      const k = smooth((t - 0.62) / 0.38);
      pz += lerp(-0.30, 0, k); px += lerp(-0.10, 0, k);
      rx += lerp(0.25, 0, k); ry += lerp(-0.20, 0, k);
      castOrbCharge = 0;
    }
  }
  function poseHeal(t) {
    // Raise open palm, glow swells, gentle release
    const up = t < 0.45 ? easeOut3(t / 0.45) : 1 - smooth(clamp((t - 0.7) / 0.3, 0, 1));
    py += 0.14 * up; pz += -0.08 * up; rx += 0.35 * up; px += -0.08 * up;
    castOrbCharge = up;
  }
  function poseDrink(t) {
    // Flask up to the face, tip back, lower
    if (t < 0.3) {
      const k = easeOut3(t / 0.3);
      py += 0.26 * k; px += -0.16 * k; pz += 0.22 * k; rx += 0.3 * k;
    } else if (t < 0.75) {
      const k = smooth((t - 0.3) / 0.45);
      py += 0.26; px += -0.16; pz += 0.22;
      rx += 0.3 + 0.9 * Math.sin(k * Math.PI); // tip the flask
    } else {
      const k = smooth((t - 0.75) / 0.25);
      py += 0.26 * (1 - k); px += -0.16 * (1 - k); pz += 0.22 * (1 - k); rx += 0.3 * (1 - k);
    }
  }

  const STATE_DUR = {
    swingL: 0.32, swingH: 0.55, shootRecoil: 0.18, cast: 0.5,
    heal: 0.85, drink: 1.0, lower: 0.13, raise: 0.16,
  };
  const ACT_T = { swingL: 0.38, swingH: 0.42, cast: 0.5, heal: 0.45, drink: 0.6 }; // normalized

  function updateViewmodel(input, dt) {
    const dur = STATE_DUR[state];
    if (dur !== undefined) stateT += dt;
    const t01 = dur ? clamp(stateT / dur, 0, 1) : 0;

    // One-shot action moments (hit test / projectile spawn / apply effect)
    if (!didAct && ACT_T[state] !== undefined && t01 >= ACT_T[state]) {
      didAct = true;
      if (state === 'swingL') meleeHit(false);
      else if (state === 'swingH') meleeHit(true);
      else if (state === 'cast') castFireball();
      else if (state === 'heal') {
        g.player.heal(WEAPONS.heal.amount);
        healSwirlLeft = 26; healSwirlT = 0;
      } else if (state === 'drink') {
        const st = g.player.stats;
        if (st.potions > 0) {
          st.potions--;
          g.player.heal(WEAPONS.potion.amount);
          if (g.audio) g.audio.play('potion');
          healSwirlLeft = 14; healSwirlT = 0;
        }
      }
    }

    // State completion / transitions
    if (dur !== undefined && stateT >= dur) {
      if (state === 'lower') finishLower();
      else if (state === 'raise') {
        stateT = 0; didAct = false;
        state = current === 'potion' ? 'drink' : 'idle';
      } else if (state === 'drink') {
        state = 'idle'; stateT = 0;
        equip(prevWeapon); // auto-return to previous weapon
      } else {
        state = 'idle'; stateT = 0;
      }
    }
    // Mid-anim equip request → cut to lower once current swing/cast finishes
    if (pendingEquip !== null && state === 'idle') { state = 'lower'; stateT = 0; }

    // ---- Compose pose: base + state curve + block + sway + bob -------------
    const bp = BASE_POSE[current] || BASE_POSE.sword;
    px = 0; py = 0; pz = 0; rx = 0; ry = 0; rz = 0;

    switch (state) {
      case 'swingL': poseSwingLight(t01); break;
      case 'swingH': poseSwingHeavy(t01); break;
      case 'charge': poseCharge(current === 'sword' ? clamp(chargeT / HEAVY_HOLD, 0, 1) : 0); break;
      case 'draw': poseDraw(clamp(drawT / WEAPONS.bow.drawTime, 0, 1), g.time.elapsed); break;
      case 'shootRecoil': poseShootRecoil(t01); break;
      case 'cast': poseCast(t01); break;
      case 'heal': poseHeal(t01); break;
      case 'drink': poseDrink(t01); break;
      case 'lower': { const k = easeIn2(t01); py += -0.5 * k; rx += -0.6 * k; break; }
      case 'raise': { const k = 1 - easeOut3(t01); py += -0.5 * k; rx += -0.6 * k; break; }
      default: {
        // Idle breathe
        const t = g.time.elapsed;
        py += Math.sin(t * 1.7) * 0.006;
        rz += Math.sin(t * 1.3) * 0.008;
      }
    }
    if (state !== 'draw') { nockArrow.position.z = 0.1; bowString.position.z = -0.12; }

    // Block pose blend (weapon raised across the face)
    blockBlend += ((blocking ? 1 : 0) - blockBlend) * Math.min(1, dt * 14);
    if (blockBlend > 0.001) {
      const k = blockBlend;
      px += -0.16 * k; py += 0.12 * k; pz += 0.06 * k;
      rz += 0.9 * k; rx += 0.15 * k; ry += 0.3 * k;
    }

    // Look sway (spring toward recent look deltas)
    if (input) {
      swayX += (clamp(-input.look.dx * 2.2, -0.09, 0.09) - swayX) * Math.min(1, dt * 10);
      swayY += (clamp(input.look.dy * 2.2, -0.09, 0.09) - swayY) * Math.min(1, dt * 10);
    } else {
      swayX *= 1 - Math.min(1, dt * 10); swayY *= 1 - Math.min(1, dt * 10);
    }

    // Movement bob
    let speed = 0;
    if (g.player && g.player.velocity) {
      speed = Math.hypot(g.player.velocity.x, g.player.velocity.z);
      if (!g.player.onGround) speed = 0;
    }
    bobPhase += dt * (4 + speed * 1.4);
    const bobAmt = clamp(speed / 7.6, 0, 1) * 0.011;
    const bobX = Math.sin(bobPhase) * bobAmt;
    const bobY = Math.abs(Math.cos(bobPhase)) * bobAmt * -1.2;

    vmRoot.position.set(bp[0] + px + swayX * 0.4 + bobX, bp[1] + py + swayY * 0.4 + bobY, bp[2] + pz);
    vmRoot.rotation.set(bp[3] + rx + swayY, bp[4] + ry + swayX, bp[5] + rz);

    // Cast orb pulse / charge scale
    if (current === 'fire') {
      const s = 1 + Math.sin(g.time.elapsed * 6) * 0.08 + castOrbCharge * 0.9;
      fireOrbMesh.scale.set(0.13 * s, 0.13 * s, 0.13 * s);
    } else if (current === 'heal') {
      const s = 1 + Math.sin(g.time.elapsed * 4) * 0.1 + castOrbCharge * 0.8;
      healOrbMesh.scale.set(0.12 * s, 0.12 * s, 0.12 * s);
    }
    // Torch flame flicker scale
    if (current === 'torch') {
      const t = g.time.elapsed;
      const f = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23.7) * 0.08;
      torchFlame.scale.set(0.11 * f, 0.2 * (2 - f) * f, 0.11 * f);
    }
  }

  // -------------------------------------------------------------------------
  // Ambient VFX: torch embers, Aldric blade embers, heal swirl
  // -------------------------------------------------------------------------
  function updateAmbientFX(dt) {
    const t = g.time.elapsed;
    if (current === 'torch') {
      flameT += dt;
      if (flameT > 0.07) {
        flameT = 0;
        torchFlame.getWorldPosition(_v1);
        spawnDirected(FX.flame, _v1.x, _v1.y, _v1.z,
          (Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4);
      }
    }
    if (current === 'sword' && g.flags.hasAldricSword) {
      emberT += dt;
      if (emberT > 0.12) {
        emberT = 0;
        blade.getWorldPosition(_v1);
        _v1.y += (Math.random() - 0.3) * 0.3;
        spawnDirected(FX.ember, _v1.x, _v1.y, _v1.z,
          (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5);
      }
    }
    // Heal swirl: green motes spiraling up around the player
    if (healSwirlLeft > 0 && g.player) {
      healSwirlT += dt;
      while (healSwirlT > 0.03 && healSwirlLeft > 0) {
        healSwirlT -= 0.03;
        healSwirlLeft--;
        const a = (healSwirlLeft * 0.55) + t * 2;
        const p = g.player.position;
        spawnDirected(FX.heal,
          p.x + Math.cos(a) * 0.7, p.y + 0.3 + Math.random() * 1.2, p.z + Math.sin(a) * 0.7,
          -Math.sin(a) * 0.9, 1.3 + Math.random() * 0.8, Math.cos(a) * 0.9);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shared point light: explosion flash > fireball in flight > torch > off
  // -------------------------------------------------------------------------
  function updateLight(dt) {
    const L = g.pointLight;
    const t = g.time.elapsed;
    if (flashT > 0) {
      flashT -= dt;
      L.position.copy(flashPos);
      L.color.setHex(0xffb050);
      L.distance = 16;
      L.intensity = 9 * clamp(flashT / 0.28, 0, 1);
      return;
    }
    let fb = null;
    for (let i = 0; i < FIREBALL_MAX; i++) if (fireballs[i].active) { fb = fireballs[i]; break; }
    if (fb) {
      L.position.copy(fb.obj.position);
      L.color.setHex(0xff8833);
      L.distance = 12;
      L.intensity = 2.8 + Math.sin(t * 27) * 0.4;
      return;
    }
    if (current === 'torch') {
      g.camera.getWorldPosition(_camPos);
      g.camera.getWorldDirection(_camDir);
      L.position.copy(_camPos).addScaledVector(_camDir, 0.5);
      L.position.y -= 0.1;
      L.color.setHex(0xffa544);
      L.distance = 9;
      const flick = Math.sin(t * 9.3) * 0.18 + Math.sin(t * 21.7) * 0.12 + Math.sin(t * 3.1) * 0.08;
      L.intensity += ((2.1 + flick) - L.intensity) * Math.min(1, dt * 12);
      return;
    }
    if (L.intensity > 0.01) L.intensity *= Math.max(0, 1 - dt * 8);
    else L.intensity = 0;
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  function update(dt) {
    if (g.paused) return; // gameplay frozen (menus/dialogue)
    checkAldric();

    const input = g.ui && g.ui.input;

    // Consume weapon-wheel / hotkey selection
    if (input && input.hotkeySelected) {
      const id = input.hotkeySelected;
      input.hotkeySelected = null;
      equip(id);
    }

    // Blocking state (parry window measured from block press)
    const canBlock = state !== 'drink' && state !== 'cast' && state !== 'heal' &&
                     state !== 'swingL' && state !== 'swingH';
    const wantBlock = !!(input && input.blockHeld) && canBlock;
    if (wantBlock && !blocking) blockStartAt = g.time.elapsed;
    blocking = wantBlock;
    if (g.player) g.player.isBlocking = blocking;
    if (blocking && (state === 'charge' || state === 'draw')) {
      state = 'idle'; stateT = 0;
      nockArrow.visible = false;
    }

    if (input && g.player && !blocking) updateAttackInput(input, dt);

    updateViewmodel(input, dt);
    updateProjectiles(dt);
    updateLoot(dt);
    updateAmbientFX(dt);
    updateParticles(dt);
    updateLight(dt);
  }

  // -------------------------------------------------------------------------
  const api = {
    update,
    equip,
    tryBlock,
    current,
    WEAPONS,
    HOTBAR,
  };
  return api;
}

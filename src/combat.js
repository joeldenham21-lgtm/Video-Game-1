// ============================================================================
// ELDERFALL — combat.js (wave 2: state-of-the-art combat)
// Weapons, first-person viewmodel (procedural low-poly arm + weapons parented
// to the camera, real KayKit weapon meshes streamed in where they exist),
// hand-animated attack curves, hitstop/parry juice, pooled projectiles
// (arrows + fireballs), loot pickups, and ONE pooled additive particle system
// for sparks / blood / embers / heal swirls / explosions / frost / lightning.
// Owns the shared g.pointLight (torch / fireball / explosion / storm flash).
// Wave-2 additions: dodge roll w/ i-frames + PERFECT DODGE slow-mo, sword
// 3-hit combo chains, Mordor-style counter window + riposte, kill finishers,
// axe / greatsword / frost / lightning weapons, rpg.mult hooks, spellCast.
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
const _box = new THREE.Box3();
const _chain = [];                   // reused lightning chain target list

// Easing helpers ------------------------------------------------------------
const easeIn2 = (t) => t * t;
const easeIn3 = (t) => t * t * t;
const easeOut3 = (t) => { const u = 1 - t; return 1 - u * u * u; };
const easeOut4 = (t) => { const u = 1 - t; return 1 - u * u * u * u; };
const smooth = (t) => t * t * (3 - 2 * t);
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Weapon definitions (contract section 4 + wave-2 additions)
// ---------------------------------------------------------------------------
const WEAPONS = {
  sword:      { name: 'Iron Sword',     light: 14, heavy: 26, range: 2.9, arc: 65 },
  axe:        { name: 'Battle Axe',     light: 34, heavy: 48, range: 3.0, arc: 100 },
  greatsword: { name: 'Greatsword',     light: 42, heavy: 46, range: 3.3, arc: 80, spinR: 3.8 },
  bow:        { name: 'Hunting Bow',    dmgMin: 10, dmgMax: 34, drawTime: 0.9 },
  fire:       { name: 'Flamecall',      mana: 14, dmg: 30, radius: 3.5 },
  frost:      { name: "Winter's Breath", mana: 18, dmg: 18, range: 7.5, arc: 70, slow: 0.45, slowDur: 3 },
  lightning:  { name: 'Stormcall',      mana: 22, dmg: 26, range: 18, chain: 3, jumpR: 8 },
  heal:       { name: 'Mending Light',  mana: 20, amount: 35 },
  torch:      { name: 'Torch',          light: 6, heavy: 6, range: 2.2, arc: 50 },
  potion:     { name: 'Health Potion',  amount: 45 },
};
// Weapon wheel ids (ui builds the 8-slot wheel from this; torch & potion
// moved to quick-buttons — still fully equippable via hotkeySelected).
const HOTBAR = ['sword', 'axe', 'greatsword', 'bow', 'fire', 'frost', 'lightning', 'heal'];
const QUICK = ['torch', 'potion'];

const MELEE = { sword: 1, axe: 1, greatsword: 1, torch: 1 };
const MELEE_TIME = { sword: [0.32, 0.55], torch: [0.32, 0.55], axe: [0.5, 0.72], greatsword: [0.62, 0.95] };
const STAM_LIGHT = { sword: 10, torch: 10, axe: 13, greatsword: 15 };
const STAM_HEAVY = { sword: 22, torch: 22, axe: 26, greatsword: 30 };
const HEAVY_HOLD = 0.35;      // hold this long → heavy on release (melee)
const PARRY_WINDOW = 0.22;    // seconds after block start

// Dodge roll ------------------------------------------------------------------
const DODGE_T = 0.32;         // roll duration
const DODGE_IFRAME = 0.25;    // invulnerable window from roll start
const DODGE_STAMINA = 18;
const DODGE_SPEED = 13.5;     // initial roll speed (eases off)
const DODGE_CD = 0.55;        // min real seconds between rolls
const DOUBLE_TAP_T = 0.32;    // double-tap window (real seconds)

// Sword combo -----------------------------------------------------------------
const COMBO_MULT = [1, 1.1, 1.25];
const COMBO_WINDOW = 1.1;

// Counter window --------------------------------------------------------------
const COUNTER_RANGE = 3.5;

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
  frost:   { c1: [0.8, 0.92, 1.0], c2: [0.45, 0.68, 1.0], speed: 3.6, up: 0.35, grav: 2.5, drag: 2.0, life: 0.55 },
  mist:    { c1: [0.7, 0.85, 1.0], c2: [0.5, 0.7, 0.95],  speed: 0.7, up: 0.6,  grav: -0.5, drag: 1.2, life: 0.9 },
  zap:     { c1: [1.0, 1.0, 1.0],  c2: [0.55, 0.75, 1.0], speed: 5.5, up: 0.4,  grav: 3,  drag: 2.6, life: 0.26 },
};

// ---------------------------------------------------------------------------
// Forge / enchant support (wave 3) — school colors, wisp presets, undead set,
// tier steel-brightening curve. Read via g.forge (guarded ?? everywhere).
// ---------------------------------------------------------------------------
const SCHOOL_HEX = {
  flametongue: 0xff5a22, frostbite: 0x66ccff, stormbrand: 0xb18cff,
  bloodthirst: 0xaa1133, gravebane: 0x9fffce,
};
const FX_SCHOOL = {
  flametongue: { c1: [1.0, 0.45, 0.16], c2: [1.0, 0.24, 0.05], speed: 0.5,  up: 0.9, grav: -1.6, drag: 1.4, life: 0.5  },
  frostbite:   { c1: [0.55, 0.82, 1.0], c2: [0.3, 0.62, 1.0],  speed: 0.45, up: 0.7, grav: -0.8, drag: 1.4, life: 0.55 },
  stormbrand:  { c1: [0.78, 0.62, 1.0], c2: [0.52, 0.4, 0.95], speed: 0.7,  up: 0.6, grav: -0.6, drag: 1.6, life: 0.4  },
  bloodthirst: { c1: [0.75, 0.08, 0.22], c2: [0.45, 0.02, 0.1], speed: 0.4, up: 0.5, grav: 0.5,  drag: 1.4, life: 0.55 },
  gravebane:   { c1: [0.62, 1.0, 0.8],  c2: [0.35, 0.85, 0.6], speed: 0.45, up: 0.8, grav: -1.0, drag: 1.4, life: 0.55 },
};
const UNDEAD = { skeleton: 1, skelarcher: 1, barrowlord: 1, wraith: 1, thrall: 1, morvane: 1 };
const TIER_BRIGHT = [0, 0.5, 0.6, 0.7, 0.8]; // color lerp toward bright steel per tier
const LOOK_IDS = ['sword', 'axe', 'greatsword', 'bow'];
const _cA = new THREE.Color();
const _cB = new THREE.Color();

// ===========================================================================
export function createCombat(g) {
  const events = g.events;

  // Camera must be in the scene graph for viewmodel children to render.
  // (Does not alter camera transform/projection — player still owns those.)
  if (!g.camera.parent) g.scene.add(g.camera);

  // rpg.mult hook — safe before rpg exists (??1 fallback everywhere)
  const rmult = (name) => (g.rpg && g.rpg.mult ? (g.rpg.mult(name) ?? 1) : 1);

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
    frostOrb:new THREE.MeshLambertMaterial({ color: 0x0a2035, emissive: 0x66ccff, emissiveIntensity: 1.5, flatShading: true }),
    stormOrb:new THREE.MeshLambertMaterial({ color: 0x1a1030, emissive: 0xb9a4ff, emissiveIntensity: 1.7, flatShading: true }),
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
  const blade = part(M.steel, 0.05, 0.62, 0.015, 0, 0.4, 0);
  const bladeTip = part(M.steel, 0.1, 0.08, 0.03, 0, 0.75, 0, 0, 0, 0, GEO.cone);
  swordG.add(blade, bladeTip);
  const swordProc = [blade, bladeTip];
  swordProc.push(part(M.gold,    0.16, 0.03, 0.042, 0, 0.09, 0));  // crossguard
  swordProc.push(part(M.leather, 0.038, 0.14, 0.038, 0, 0, 0));    // grip
  swordProc.push(part(M.gold,    0.05, 0.05, 0.05, 0, -0.09, 0, 0, 0, 0, GEO.sphere)); // pommel
  for (let i = 2; i < swordProc.length; i++) swordG.add(swordProc[i]);

  // --- Battle axe (procedural placeholder, real 2H_Axe streams in) ---
  const axeG = new THREE.Group();
  const axeProc = [
    part(M.wood, 0.045, 0.82, 0.045, 0, 0.3, 0),                     // haft
    part(M.steel, 0.3, 0.22, 0.035, 0.14, 0.62, 0),                  // head plate
    part(M.steel, 0.14, 0.3, 0.03, 0.27, 0.62, 0, 0, 0, Math.PI / 2, GEO.cone), // edge wedge
    part(M.leather, 0.055, 0.12, 0.055, 0, -0.02, 0),                // grip wrap
  ];
  for (const p of axeProc) axeG.add(p);

  // --- Greatsword (procedural placeholder, real 2H_Sword streams in) ---
  const gsG = new THREE.Group();
  const gsProc = [
    part(M.steel, 0.07, 0.92, 0.02, 0, 0.58, 0),                     // long blade
    part(M.steel, 0.14, 0.12, 0.038, 0, 1.1, 0, 0, 0, 0, GEO.cone),  // tip
    part(M.gold, 0.24, 0.035, 0.05, 0, 0.11, 0),                     // wide crossguard
    part(M.leather, 0.045, 0.2, 0.045, 0, -0.02, 0),                 // two-hand grip
    part(M.gold, 0.06, 0.06, 0.06, 0, -0.14, 0, 0, 0, 0, GEO.sphere),// pommel
  ];
  for (const p of gsProc) gsG.add(p);

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

  // --- Casting orbs (hover over the open palm) ---
  const fireG = new THREE.Group();
  const fireOrbMesh = part(M.fireOrb, 0.13, 0.13, 0.13, 0, 0.1, -0.06, 0, 0, 0, GEO.sphere);
  fireG.add(fireOrbMesh);
  fireG.add(part(M.ember, 0.2, 0.2, 0.2, 0, 0.1, -0.06, 0.5, 0.4, 0, GEO.octa));
  const healG = new THREE.Group();
  const healOrbMesh = part(M.healOrb, 0.12, 0.12, 0.12, 0, 0.1, -0.06, 0, 0, 0, GEO.sphere);
  healG.add(healOrbMesh);
  healG.add(part(M.rune, 0.17, 0.17, 0.17, 0, 0.1, -0.06, 0.4, 0.6, 0, GEO.octa));
  const frostG = new THREE.Group();
  const frostOrbMesh = part(M.frostOrb, 0.12, 0.12, 0.12, 0, 0.1, -0.06, 0, 0, 0, GEO.sphere);
  frostG.add(frostOrbMesh);
  frostG.add(part(M.frostOrb, 0.19, 0.19, 0.19, 0, 0.1, -0.06, 0.4, 0.5, 0, GEO.octa));
  const lightG = new THREE.Group();
  const stormOrbMesh = part(M.stormOrb, 0.12, 0.12, 0.12, 0, 0.1, -0.06, 0, 0, 0, GEO.sphere);
  lightG.add(stormOrbMesh);
  lightG.add(part(M.stormOrb, 0.18, 0.18, 0.18, 0, 0.1, -0.06, 0.6, 0.3, 0, GEO.octa));

  // --- Torch (real dungeon torch prop streams in) ---
  const torchG = new THREE.Group();
  const torchProc = [
    part(M.wood, 0.045, 0.42, 0.045, 0, 0.14, 0),
    part(M.woodDark, 0.09, 0.1, 0.09, 0, 0.37, 0),
  ];
  for (const p of torchProc) torchG.add(p);
  const torchFlame = part(M.flame, 0.11, 0.2, 0.11, 0, 0.5, 0, 0, 0, 0, GEO.cone);
  torchG.add(torchFlame);

  // --- Potion flask ---
  const potionG = new THREE.Group();
  potionG.add(part(M.flask, 0.13, 0.15, 0.13, 0, 0.02, 0, 0, 0, 0, GEO.sphere));
  potionG.add(part(M.flask, 0.045, 0.09, 0.045, 0, 0.12, 0));
  potionG.add(part(M.wood, 0.05, 0.03, 0.05, 0, 0.17, 0));

  const weaponGroups = {
    sword: swordG, axe: axeG, greatsword: gsG, bow: bowG,
    fire: fireG, frost: frostG, lightning: lightG, heal: healG,
    torch: torchG, potion: potionG,
  };
  for (const id in weaponGroups) {
    weaponGroups[id].visible = false;
    vmRoot.add(weaponGroups[id]);
  }

  // Per-weapon base pose of vmRoot (camera-local): px py pz rx ry rz.
  // Tuned so weapons sit LOWER-RIGHT and angled forward like a modern FPS
  // melee viewmodel (≲35% of screen height) instead of towering upright.
  const BASE_POSE = {
    sword:      [0.40, -0.54, -0.76, -0.66, -0.44, 0.30],
    axe:        [0.42, -0.55, -0.78, -0.66, -0.36, 0.30],
    greatsword: [0.38, -0.56, -0.80, -0.68, -0.34, 0.22],
    bow:        [0.20, -0.26, -0.58,  0.00,  0.35, -0.12],
    fire:       [0.32, -0.34, -0.56, -0.25, -0.15, 0.00],
    frost:      [0.32, -0.34, -0.56, -0.25, -0.15, 0.00],
    lightning:  [0.32, -0.34, -0.56, -0.25, -0.15, 0.00],
    heal:       [0.32, -0.34, -0.56, -0.25, -0.15, 0.00],
    torch:      [0.36, -0.34, -0.60, -0.28, -0.20, 0.08],
    potion:     [0.32, -0.36, -0.55, -0.15, -0.10, 0.00],
  };

  // -------------------------------------------------------------------------
  // Real KayKit weapon meshes — streamed in async, replacing the procedural
  // placeholders (logic-first, mesh-on-arrival). Weapon meshes live inside
  // the character GLBs (Knight: 1H_Sword/2H_Sword, Barbarian: 2H_Axe) as
  // plain meshes parented to the hand bone; the dungeon pack has a torch.
  // -------------------------------------------------------------------------
  let realSword = null;
  let assetsRequested = false;

  // Normalize a cloned weapon mesh: +Y is the blade axis with the grip near
  // the origin in KayKit rigs; scale so the total length = len.
  function mountReal(root, name, group, hideParts, len) {
    const src = root.getObjectByName(name);
    if (!src) return null;
    const m = src.clone(true);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    _box.setFromObject(m);
    _box.getSize(_v1);
    const longest = Math.max(_v1.x, _v1.y, _v1.z, 1e-4);
    m.scale.setScalar(len / longest);
    m.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    group.add(m);
    for (const h of hideParts) h.visible = false;
    return m;
  }

  function requestRealWeapons() {
    const A = g.assets;
    if (!A || !A.char) return;
    A.char('knight').then((c) => {
      realSword = mountReal(c.scene, '1H_Sword', swordG, swordProc, 0.8);
      realLook.sword = realSword;
      realLook.greatsword = mountReal(c.scene, '2H_Sword', gsG, gsProc, 1.08);
      if (realSword && aldricApplied) applyAldricToReal();
      applyLook('sword');
      applyLook('greatsword');
    }).catch(() => {});
    A.char('barbarian').then((c) => {
      realLook.axe = mountReal(c.scene, '2H_Axe', axeG, axeProc, 0.92);
      applyLook('axe');
    }).catch(() => {});
    if (A.prop) {
      A.prop('dungeon/torch.gltf.glb').then((obj) => {
        // prop() returns a plain Object3D clone — normalize it directly
        obj.position.set(0, 0, 0);
        obj.rotation.set(0, 0, 0);
        obj.scale.set(1, 1, 1);
        _box.setFromObject(obj);
        _box.getSize(_v1);
        const longest = Math.max(_v1.x, _v1.y, _v1.z, 1e-4);
        obj.scale.setScalar(0.48 / longest);
        obj.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
        torchG.add(obj);
        for (const h of torchProc) h.visible = false;
      }).catch(() => {});
    }
  }

  function applyAldricToReal() {
    if (realSword && g.assets && g.assets.tint) {
      g.assets.tint(realSword, '#ffb27a', { emissive: '#ff5a18', emissiveIntensity: 0.7 });
    }
  }

  // -------------------------------------------------------------------------
  // Forge visual progression (wave 3) — refreshWeaponLook(). Each upgradeable
  // weapon gets its OWN cloned blade/accent materials (built once) so tiers
  // and enchants restyle one weapon without touching the shared library mats.
  // Tier: steel brightens → emissive edge-light + darkened guard → gold
  // accents + ×1.04 heft → ember runes + slow pulse. Enchant: school emissive
  // ~0.55 + wisp motes along the blade (stronger during swings). Bow enchants
  // tint the arrow trail. Subtle > over-the-top.
  // -------------------------------------------------------------------------
  const realLook = { sword: null, axe: null, greatsword: null, bow: null };
  const lookParts = {
    sword:      { blade: [blade, bladeTip], accent: [swordProc[2], swordProc[4]], baseHex: 0xb9c2cc, accentHex: 0xc9a23f, accentSrc: M.gold },
    axe:        { blade: [axeProc[1], axeProc[2]], accent: [axeProc[3]], baseHex: 0xb9c2cc, accentHex: 0x6b4a2b, accentSrc: M.leather },
    greatsword: { blade: [gsProc[0], gsProc[1]], accent: [gsProc[2], gsProc[4]], baseHex: 0xb9c2cc, accentHex: 0xc9a23f, accentSrc: M.gold },
    // bow children: [0] grip riser, [1] upper limb, [2] lower limb
    bow:        { blade: [bowG.children[1], bowG.children[2]], accent: [bowG.children[0]], baseHex: 0x5a3d22, accentHex: 0x5a3d22, accentSrc: M.wood },
  };
  const lookMats = {};
  for (const id of LOOK_IDS) {
    const lp = lookParts[id];
    const bladeMat = (id === 'bow' ? M.wood : M.steel).clone();
    const accentMat = lp.accentSrc.clone();
    for (const m of lp.blade) m.material = bladeMat;   // identical at tier 0
    for (const m of lp.accent) m.material = accentMat;
    lookMats[id] = { blade: bladeMat, accent: accentMat };
  }
  function hex6(h) { return '#' + h.toString(16).padStart(6, '0'); }

  function applyLook(id) {
    const lp = lookParts[id], lm = lookMats[id];
    if (!lp || !lm) return;
    const tier = fTier(id);
    const ench = fEnch(id);
    // Tier: blade steel brightens toward polished bright metal (bow: less)
    _cA.setHex(lp.baseHex);
    _cB.setHex(0xd8dde4);
    lm.blade.color.copy(_cA.lerp(_cB, (TIER_BRIGHT[tier] || 0) * (id === 'bow' ? 0.35 : 1)));
    // Enchant school glow beats the tier-2 steel edge-light
    if (ench && SCHOOL_HEX[ench]) {
      lm.blade.emissive.setHex(SCHOOL_HEX[ench]);
      lm.blade.emissiveIntensity = id === 'bow' ? 0.3 : 0.55;
    } else if (tier >= 2) {
      lm.blade.emissive.setHex(0x222833);
      lm.blade.emissiveIntensity = 0.5;
    } else {
      lm.blade.emissive.setHex(0x000000);
      lm.blade.emissiveIntensity = 0;
    }
    // Accents: tier 2 darkened guard → tier 3+ gold-touched fittings
    _cA.setHex(lp.accentHex);
    if (tier >= 3) _cA.lerp(_cB.setHex(0xe6c05a), 0.75);
    else if (tier === 2) _cA.multiplyScalar(0.62);
    lm.accent.color.copy(_cA);
    // Tier 3+: very subtle extra heft
    weaponGroups[id].scale.setScalar(tier >= 3 ? 1.04 : 1);
    // Streamed KayKit meshes keep their authored colors — emissive tint only
    const rm = realLook[id];
    if (rm && g.assets && g.assets.tint) {
      if (ench && SCHOOL_HEX[ench]) g.assets.tint(rm, '#ffffff', { emissive: hex6(SCHOOL_HEX[ench]), emissiveIntensity: 0.5 });
      else if (tier >= 2) g.assets.tint(rm, '#ffffff', { emissive: '#222833', emissiveIntensity: 0.5 });
    }
  }

  // Cached look of the CURRENT weapon (drives per-frame pulse/wisps cheaply)
  let curTier = 0, curEnch = null, curLm = null;
  function syncCurrentLook() {
    if (LOOK_IDS.indexOf(current) >= 0) {
      curTier = fTier(current);
      curEnch = fEnch(current);
      curLm = lookMats[current];
    } else {
      curTier = 0; curEnch = null; curLm = null;
    }
  }
  function refreshWeaponLook() {
    for (let i = 0; i < LOOK_IDS.length; i++) applyLook(LOOK_IDS[i]);
    syncCurrentLook();
  }
  events.on('weaponForged', refreshWeaponLook);
  events.on('weaponEnchanted', refreshWeaponLook);
  events.on('gameLoaded', refreshWeaponLook);

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
  // Lightning bolt renderer — one pooled jagged LineSegments flash
  // -------------------------------------------------------------------------
  const BOLT_SUB = 6;                       // subdivisions per chain hop
  const BOLT_MAX = (5 + 1) * BOLT_SUB * 2;  // verts (pairs) — sized for the tome-upgraded 5-target chain
  const boltPos = new Float32Array(BOLT_MAX * 3);
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
  boltGeo.setDrawRange(0, 0);
  const boltMat = new THREE.LineBasicMaterial({
    color: 0xd8ecff, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const boltLine = new THREE.LineSegments(boltGeo, boltMat);
  boltLine.frustumCulled = false;
  boltLine.visible = false;
  g.scene.add(boltLine);
  let boltT = 0;
  let boltVerts = 0;

  // Append a jagged run from (ax,ay,az) → (bx,by,bz) into boltPos
  function boltRun(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.max(0.001, Math.hypot(dx, dy, dz));
    // Perpendicular basis for jitter
    let ux = -dz / len, uy = 0, uz = dx / len;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uz /= ul;
    const wx = (dy * uz - dz * uy) / len, wy = (dz * ux - dx * uz) / len, wz = (dx * uy - dy * ux) / len;
    let px = ax, py = ay, pz = az;
    for (let s = 1; s <= BOLT_SUB; s++) {
      const t = s / BOLT_SUB;
      const jag = s === BOLT_SUB ? 0 : (0.12 + len * 0.045);
      const j1 = (Math.random() * 2 - 1) * jag;
      const j2 = (Math.random() * 2 - 1) * jag;
      const nx = ax + dx * t + ux * j1 + wx * j2;
      const ny = ay + dy * t + uy * j1 + wy * j2;
      const nz = az + dz * t + uz * j1 + wz * j2;
      if (boltVerts + 2 <= BOLT_MAX) {
        let o = boltVerts * 3;
        boltPos[o] = px; boltPos[o + 1] = py; boltPos[o + 2] = pz;
        boltPos[o + 3] = nx; boltPos[o + 4] = ny; boltPos[o + 5] = nz;
        boltVerts += 2;
      }
      px = nx; py = ny; pz = nz;
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
    arrows.push({ obj: gr, vel: new THREE.Vector3(), life: 0, active: false, stuck: 0, dmg: 0, school: null, trailT: 0 });
  }

  // Pool sized for the Twin Flame tome: 1 in flight + 3 bomblets + margin
  const FIREBALL_MAX = 7;
  const fireballs = [];
  for (let i = 0; i < FIREBALL_MAX; i++) {
    const m = part(M.fireball, 0.3, 0.3, 0.3, 0, 0, 0, 0, 0, 0, GEO.sphere);
    m.visible = false;
    g.scene.add(m);
    fireballs.push({ obj: m, vel: new THREE.Vector3(), life: 0, active: false, trailT: 0, bomblet: false });
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
  let torchPrev = 'sword';    // for useTorch() toggle-back
  let pendingEquip = null;
  let state = 'raise';        // idle|charge|swingL|swingH|draw|shootRecoil|cast|heal|drink|lower|raise
  let stateT = 0;
  let didAct = false;         // one-shot flag per state (hit test / spawn / apply)
  let chargeT = 0;            // attack button hold time (melee heavy)
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
  let flashColor = 0xffb050;
  const flashPos = new THREE.Vector3();
  let aldricApplied = false;
  let swingDur = 0.32;        // dynamic melee state duration (attackSpeed-aware)
  let swingVariant = 0;       // sword combo arc variant 0|1|2

  // Wave-2 systems state ------------------------------------------------------
  let rawClock = 0;           // unscaled seconds (accumulated rawDt, unpaused)
  let comboIdx = 0;
  let comboExpire = -10;      // g.time.elapsed deadline for next chain hit
  let dodging = false, dodgeT = 0, dodgeLat = 0, dodgeCdUntil = -10, perfectUsed = false;
  const dodgeDir = new THREE.Vector3();
  let tapT = -10, tapAng = 0, moveWasActive = false, keyDodge = false;
  let slowmoLeft = 0, slowmoF = 1;
  let fovKick = 0;            // added to camera.fov post-player, decays exp
  let counterOpen = false;
  let counterTarget = null;
  let finisherCdUntil = -10;
  let damageWrapped = false;
  const counterEvt = { open: false };
  const spellCastEvt = { school: '', cost: 0 };

  // Frost slow bookkeeping (fields stored on the enemy objects themselves)
  const frostSlowed = [];

  // Wave-3 forge state ---------------------------------------------------------
  let forgeSeen = false;                    // first sight of g.forge → refresh look
  let wispT = 0;                            // enchant wisp / tier-4 rune emitter
  let regenLeft = 0, regenAcc = 0, regenFxT = 0; // heal-tome lingering regen

  function setWeaponVisible(id) {
    for (const k in weaponGroups) weaponGroups[k].visible = (k === id);
  }
  setWeaponVisible('sword');

  function checkAldric() {
    if (g.flags.hasAldricSword && !aldricApplied) {
      aldricApplied = true;
      blade.material = M.ember;
      bladeTip.material = M.ember;
      applyAldricToReal();
    }
  }

  function swordDmg(heavy) {
    const bonus = g.flags.hasAldricSword ? 10 : 0;
    return (heavy ? WEAPONS.sword.heavy : WEAPONS.sword.light) + bonus;
  }
  function dmgMul() {
    return 1 + ((g.player && g.player.bonus) ? g.player.bonus.dmg : 0);
  }
  function isMeleeId(id) { return !!MELEE[id]; }

  // ---- Forge hooks (wave 3) — every accessor is safe with g.forge missing --
  const fTier = (id) => (g.forge && g.forge.tierOf ? (g.forge.tierOf(id) | 0) : 0);
  const fEnch = (id) => (g.forge && g.forge.enchantOf ? g.forge.enchantOf(id) : null);
  const fMult = (id) => (g.forge && g.forge.dmgMult ? (g.forge.dmgMult(id) ?? 1) : 1);
  const fSpellTier = (school) => (g.forge && g.forge.spellTier ? g.forge.spellTier(school) : 1);
  const fSpellPower = (school) => (g.forge && g.forge.spellPower ? (g.forge.spellPower(school) ?? 1) : 1);
  // Frost-tome brittle debuff: +15% damage taken for 3s (timestamp on enemy)
  function brittleMul(e) {
    return (e._brittleUntil !== undefined && g.time.elapsed < e._brittleUntil) ? 1.15 : 1;
  }
  // Gravebane enchant: +35% vs the risen dead
  function baneMul(e, id) {
    return (UNDEAD[e.type] && fEnch(id) === 'gravebane') ? 1.35 : 1;
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
  // Lighter event-only variant for spells (no blood — frost/zap FX supplied by caller)
  function hitLandedEvt(pos, heavy, kill) {
    _hitPos.copy(pos);
    events.emit('hitLanded', { pos: _hitPos, kill: !!kill, heavy: !!heavy });
  }

  // Crit roll — base 5% scaled by rpg critChance mult
  function rollCrit() { return Math.random() < 0.05 * rmult('critChance'); }
  // Sneak multiplier for a target (only un-aggroed enemies can be sneak-hit)
  function sneakMul(e, name) {
    return (g.player && g.player.sneaking && !e.aggro) ? rmult(name) : 1;
  }

  // Kill finisher: cinematic on melee killing blows that weren't trivial
  // one-shots (prevHp had to be a meaningful chunk of the damage dealt).
  function maybeFinisher(prevHp, dmg) {
    if (rawClock < finisherCdUntil) return;
    if (prevHp < dmg * 0.35) return; // massive overkill on trash — skip
    finisherCdUntil = rawClock + 2.5;
    g.requestHitstop(120);
    startSlowmo(0.3, 0.6);
    fovKick = -8;
  }

  function startSlowmo(f, dur) {
    slowmoF = f;
    slowmoLeft = Math.max(slowmoLeft, dur);
  }

  // Melee swing hit test at swing apex
  function meleeHit(heavy) {
    if (!g.enemies || !g.enemies.queryHit) return;
    const w = WEAPONS[current] || WEAPONS.sword;
    const cleave = current === 'sword' && !heavy && comboIdx === 2; // 3rd combo hit
    const spin = current === 'greatsword' && heavy;                 // 360° AoE
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    let hits;
    if (spin && g.enemies.queryPoint) {
      _v1.set(g.player.position.x, g.player.position.y + 0.9, g.player.position.z);
      hits = g.enemies.queryPoint(_v1, w.spinR || 3.8);
    } else {
      const arcScale = cleave ? 1.7 : 1;
      const range = w.range + (cleave ? 0.3 : 0);
      const halfAngle = (w.arc * arcScale * 0.5) * Math.PI / 180;
      hits = g.enemies.queryHit(_camPos, _camDir, range, halfAngle);
    }
    if (!hits || hits.length === 0) return;
    let base;
    if (current === 'sword') base = swordDmg(heavy) * (heavy ? 1 : COMBO_MULT[comboIdx]);
    else base = heavy ? w.heavy : w.light;
    const mul = rmult('meleeDmg') * (heavy ? rmult('heavyDmg') : 1) * dmgMul() * fMult(current);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      enemyPos(e, _v3);
      _v2.subVectors(_v3, _camPos).normalize();
      let dmg = base * mul * sneakMul(e, 'sneakMeleeMult') * baneMul(e, current) * brittleMul(e);
      const crit = rollCrit();
      if (crit) dmg *= 1.5;
      const prevHp = e.hp !== undefined ? e.hp : dmg;
      // Axe hits count as heavy for interrupt/knockback purposes — it staggers
      g.enemies.damage(e, dmg, _v2, { heavy: heavy || current === 'axe' });
      if (current === 'axe' && heavy && e.alive && !e.dead && !e.fly && !e.boss) {
        e.state = 'stagger'; e.stateT = 0;
      }
      const kill = isDead(e);
      hitJuice(_v3, heavy || crit, kill);
      if (crit) spawnBurst(FX.sparkle, _v3.x, _v3.y, _v3.z, 6, 1.4);
      procEnchant(current, e, _v3.x, _v3.y, _v3.z, dmg); // may clobber _v temps — keep last
      if (kill) maybeFinisher(prevHp, dmg);
    }
    if (cleave || spin) g.player.addShake(spin ? 0.6 : 0.45);
  }

  // ---- Projectile launches --------------------------------------------------
  function shootArrow(draw01) {
    const a = firstFreeOf(arrows);
    a.active = true; a.stuck = 0; a.life = 6;
    a.dmg = lerp(WEAPONS.bow.dmgMin, WEAPONS.bow.dmgMax, draw01) * dmgMul() * rmult('bowDmg') * fMult('bow');
    a.school = fEnch('bow'); // enchanted bow → school-tinted arrow trail + procs
    a.trailT = 0;
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
    f.bomblet = false;
    f.obj.scale.setScalar(0.3);
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
    const px = p.x, py = p.y, pz = p.z; // scalars survive pool recycling below
    const small = f.bomblet;
    // Twin Flame tome: +40% damage, and the burst mothers three sparks
    const t2 = fSpellTier('fire') === 2;
    spawnBurst(FX.boom, px, py, pz, small ? 12 : 34, small ? 0.6 : 1);
    spawnBurst(FX.spark, px, py, pz, small ? 5 : 12, small ? 1.2 : 1.8);
    if (!small) spawnBurst(FX.smoke, px, py + 0.4, pz, 8, 1);
    flashT = small ? 0.16 : 0.28;
    flashColor = 0xffb050;
    flashPos.copy(p);
    if (g.audio) g.audio.play('fireExplode');
    // AoE damage
    if (g.enemies && g.enemies.queryPoint) {
      const hits = g.enemies.queryPoint(p, small ? 2.2 : WEAPONS.fire.radius);
      if (hits && hits.length) {
        const base = WEAPONS.fire.dmg * (small ? 0.35 : (t2 ? 1.4 : 1)) *
                     dmgMul() * rmult('spellDmg') * fSpellPower('fire');
        for (let i = 0; i < hits.length; i++) {
          const e = hits[i];
          enemyPos(e, _v3);
          _v2.subVectors(_v3, p); _v2.y = 0.4; _v2.normalize();
          g.enemies.damage(e, base * brittleMul(e), _v2, { heavy: true, kind: 'fire' });
          hitJuice(_v3, true, isDead(e));
        }
      }
    }
    // Player shake by proximity even without a hit
    if (g.player) {
      const d = p.distanceTo(g.player.position);
      if (d < 14) g.player.addShake(clamp(0.7 - d * 0.05, 0, 0.6));
    }
    // Greater Fireball: three arcing bomblets scatter from the blast
    if (t2 && !small) {
      for (let b = 0; b < 3; b++) {
        const nb = firstFreeOf(fireballs);
        nb.active = true; nb.life = 2.5; nb.trailT = 0; nb.bomblet = true;
        nb.obj.scale.setScalar(0.18);
        nb.obj.position.set(px, py + 0.4, pz);
        const a = Math.random() * TWO_PI;
        const sp = 3.5 + Math.random() * 3;
        nb.vel.set(Math.cos(a) * sp, 7 + Math.random() * 2.5, Math.sin(a) * sp);
        nb.obj.visible = true;
      }
    }
  }

  // ---- Frost cone: 45% slow 3s + damage + ice mist ---------------------------
  // (parameterized for the Deep Winter tome and the frostbite enchant proc)
  function applyFrost(e, slow, dur) {
    if (e._frostBase === undefined) {
      e._frostBase = e.speed;
      e._mistT = 0;
      frostSlowed.push(e);
    }
    e.speed = e._frostBase * (1 - slow);
    e._frostUntil = g.time.elapsed + dur;
  }
  function castFrost() {
    const w = WEAPONS.frost;
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    if (g.audio) g.audio.play('fireCast');
    events.emit('attackSwing', { weapon: 'frost', heavy: false });
    // Ice mist cone billowing from the palm
    for (let n = 0; n < 26; n++) {
      const s = 3 + Math.random() * 5.5;
      const spX = (Math.random() - 0.5) * 2.4;
      const spY = (Math.random() - 0.5) * 1.6;
      spawnDirected(n % 3 ? FX.frost : FX.mist,
        _camPos.x + _camDir.x * 0.7, _camPos.y - 0.15 + _camDir.y * 0.7, _camPos.z + _camDir.z * 0.7,
        _camDir.x * s + spX, _camDir.y * s + spY + 0.4, _camDir.z * s + spX * 0.5);
    }
    if (!g.enemies || !g.enemies.queryHit) return;
    const halfAngle = (w.arc * 0.5) * Math.PI / 180;
    const hits = g.enemies.queryHit(_camPos, _camDir, w.range, halfAngle);
    if (!hits || hits.length === 0) return;
    const mul = rmult('spellDmg') * dmgMul() * fSpellPower('frost');
    // Deep Winter tome: slow 45% → 60%, +50% duration, leaves bone brittle
    const t2 = fSpellTier('frost') === 2;
    const slow = t2 ? 0.6 : w.slow;
    const dur = w.slowDur * (t2 ? 1.5 : 1);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      enemyPos(e, _v3);
      _v2.subVectors(_v3, _camPos).normalize();
      g.enemies.damage(e, w.dmg * mul * brittleMul(e), _v2, {});
      applyFrost(e, slow, dur);
      if (t2) e._brittleUntil = g.time.elapsed + 3; // +15% damage taken 3s
      spawnBurst(FX.frost, _v3.x, _v3.y, _v3.z, 9, 1);
      hitLandedEvt(_v3, false, isDead(e));
    }
    g.player.addShake(0.15);
  }

  function updateFrostSlows() {
    const t = g.time.elapsed;
    for (let i = frostSlowed.length - 1; i >= 0; i--) {
      const e = frostSlowed[i];
      if (e.dead || !e.alive || t >= e._frostUntil) {
        if (e._frostBase !== undefined) { e.speed = e._frostBase; e._frostBase = undefined; }
        frostSlowed.splice(i, 1);
        continue;
      }
      // Cold mist wisps off slowed enemies
      e._mistT += g.time.dt;
      if (e._mistT > 0.14) {
        e._mistT = 0;
        spawnDirected(FX.mist,
          e.pos.x + (Math.random() - 0.5) * 0.8, e.pos.y + 0.4 + Math.random() * 0.8, e.pos.z + (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
      }
    }
  }

  // ---- Enchant procs (wave 3): burn / slow / chain arc / lifesteal ------------
  const burning = [];                       // enemies with an active burn DoT
  const _burnOpts = { kind: 'burn' };       // preallocated damage opts
  const _chainOpts = {};
  let lifestealAcc = 0;                     // bloodthirst heals whole points

  function applyBurn(e) {
    if (!e._burnOn) { e._burnOn = true; burning.push(e); }
    e._burnLeft = 2;    // 4 dmg/s for 2s, in 2-damage half-second ticks
    e._burnTick = 0.5;
  }
  function updateBurns(dt) {
    for (let i = burning.length - 1; i >= 0; i--) {
      const e = burning[i];
      if (isDead(e) || e._burnLeft <= 0) {
        e._burnOn = false;
        burning.splice(i, 1);
        continue;
      }
      e._burnLeft -= dt;
      e._burnTick -= dt;
      if (e._burnTick <= 0) {
        e._burnTick += 0.5;
        if (e.pos) spawnBurst(FX.ember, e.pos.x, e.pos.y + 0.7 + Math.random() * 0.5, e.pos.z, 3, 1);
        if (g.enemies && g.enemies.damage) g.enemies.damage(e, 2, null, _burnOpts);
      }
    }
  }

  // Stormbrand: small lightning arc from the struck enemy to its nearest ally
  function chainArc(src, sx, sy, sz) {
    if (!g.enemies || !g.enemies.queryPoint) return;
    _v1.set(sx, sy, sz);
    const near = g.enemies.queryPoint(_v1, 8);
    let nb = null, nd = 1e9;
    for (let i = 0; i < (near ? near.length : 0); i++) {
      const c = near[i];
      if (c === src || isDead(c)) continue;
      enemyPos(c, _v3);
      const d = _v3.distanceToSquared(_v1);
      if (d < nd) { nd = d; nb = c; }
    }
    if (!nb) return;
    enemyPos(nb, _v3);
    boltVerts = 0;
    boltRun(sx, sy, sz, _v3.x, _v3.y, _v3.z);
    boltGeo.setDrawRange(0, boltVerts);
    boltGeo.attributes.position.needsUpdate = true;
    boltLine.visible = true;
    boltT = 0.1;
    _v2.subVectors(_v3, _v1).normalize();
    g.enemies.damage(nb, 8, _v2, _chainOpts);
    spawnBurst(FX.zap, _v3.x, _v3.y, _v3.z, 8, 1);
    hitLandedEvt(_v3, false, isDead(nb));
  }

  // Called after every landed melee blow / arrow with the weapon that hit.
  // (gravebane is a pre-damage multiplier — see baneMul.) Uses scalar coords
  // so callers' _v temps stay valid.
  function procEnchant(id, e, hx, hy, hz, dealt) {
    const ench = fEnch(id);
    if (!ench) return;
    if (ench === 'bloodthirst') {
      lifestealAcc += dealt * 0.12;
      if (lifestealAcc >= 1 && g.player) {
        const n = Math.floor(lifestealAcc);
        lifestealAcc -= n;
        g.player.heal(n);
      }
      spawnBurst(FX_SCHOOL.bloodthirst, hx, hy, hz, 3, 2.5);
      return;
    }
    if (isDead(e)) return;
    if (ench === 'flametongue') {
      applyBurn(e);
      spawnBurst(FX_SCHOOL.flametongue, hx, hy, hz, 4, 2.5);
    } else if (ench === 'frostbite') {
      applyFrost(e, 0.25, 1.5);
      spawnBurst(FX_SCHOOL.frostbite, hx, hy, hz, 4, 2.5);
    } else if (ench === 'stormbrand' && Math.random() < 0.1) {
      chainArc(e, hx, hy, hz);
    }
  }

  // ---- Lightning: instant chain bolt up to 3 enemies --------------------------
  function castLightning() {
    const w = WEAPONS.lightning;
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    events.emit('attackSwing', { weapon: 'lightning', heavy: false });
    if (g.audio) g.audio.play('thunder');
    // The Storm Court tome: the writ names five souls instead of three
    const chainN = fSpellTier('lightning') === 2 ? 5 : w.chain;
    // Pick first target: nearest in a narrow forward cone
    _chain.length = 0;
    if (g.enemies && g.enemies.queryHit) {
      const hits = g.enemies.queryHit(_camPos, _camDir, w.range, 12 * Math.PI / 180);
      let best = null, bestD = 1e9;
      for (let i = 0; i < (hits ? hits.length : 0); i++) {
        enemyPos(hits[i], _v3);
        const d = _v3.distanceToSquared(_camPos);
        if (d < bestD) { bestD = d; best = hits[i]; }
      }
      if (best) {
        _chain.push(best);
        // Chain to nearest unhit enemies within jump radius of the last struck
        while (_chain.length < chainN && g.enemies.queryPoint) {
          const last = _chain[_chain.length - 1];
          enemyPos(last, _v1);
          const near = g.enemies.queryPoint(_v1, w.jumpR);
          let nb = null, nd = 1e9;
          for (let i = 0; i < (near ? near.length : 0); i++) {
            const c = near[i];
            if (_chain.indexOf(c) >= 0) continue;
            enemyPos(c, _v3);
            const d = _v3.distanceToSquared(_v1);
            if (d < nd) { nd = d; nb = c; }
          }
          if (!nb) break;
          _chain.push(nb);
        }
      }
    }
    // Build the jagged bolt: hand muzzle → each chained target (or a fizzle arc)
    boltVerts = 0;
    const yaw = g.player ? g.player.yaw : 0;
    const mx = _camPos.x + _camDir.x * 0.45 + Math.cos(yaw) * 0.25;
    const my = _camPos.y - 0.22 + _camDir.y * 0.45;
    const mz = _camPos.z + _camDir.z * 0.45 - Math.sin(yaw) * 0.25;
    if (_chain.length === 0) {
      boltRun(mx, my, mz, _camPos.x + _camDir.x * 11, _camPos.y + _camDir.y * 11, _camPos.z + _camDir.z * 11);
      flashPos.copy(_camPos).addScaledVector(_camDir, 4);
    } else {
      let px = mx, py = my, pz = mz;
      const mul = rmult('spellDmg') * dmgMul() * fSpellPower('lightning');
      let dmg = w.dmg * mul;
      for (let i = 0; i < _chain.length; i++) {
        const e = _chain[i];
        enemyPos(e, _v3);
        boltRun(px, py, pz, _v3.x, _v3.y, _v3.z);
        px = _v3.x; py = _v3.y; pz = _v3.z;
        _v2.subVectors(_v3, _camPos).normalize();
        g.enemies.damage(e, dmg * brittleMul(e), _v2, { heavy: i === 0 });
        spawnBurst(FX.zap, _v3.x, _v3.y, _v3.z, 10, 1.2);
        spawnBurst(FX.spark, _v3.x, _v3.y, _v3.z, 5, 1);
        hitLandedEvt(_v3, i === 0, isDead(e));
        dmg *= 0.75; // falloff per hop
      }
      enemyPos(_chain[0], flashPos);
      g.requestHitstop(60);
    }
    boltGeo.setDrawRange(0, boltVerts);
    boltGeo.attributes.position.needsUpdate = true;
    boltLine.visible = true;
    boltT = 0.14;
    flashT = 0.22;
    flashColor = 0xa9c8ff;
    g.player.addShake(0.35);
    _chain.length = 0;
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
      // Swept collision: at low frame rates an arrow can cross a whole enemy
      // in one step, so sample the movement segment instead of the endpoint.
      const stepLen = a.vel.length() * dt;
      const subSteps = Math.min(6, Math.max(1, Math.ceil(stepLen / 0.6)));
      let hits = null;
      for (let ss = 1; ss <= subSteps; ss++) {
        a.obj.position.addScaledVector(a.vel, dt / subSteps);
        if (g.enemies && g.enemies.queryPoint) {
          hits = g.enemies.queryPoint(a.obj.position, 0.7);
          if (hits && hits.length) break;
        }
      }
      _v1.copy(a.obj.position).add(a.vel);
      a.obj.lookAt(_v1);
      const p = a.obj.position;
      // Enchanted bow: school-colored wisps stream off the arrow in flight
      if (a.school && FX_SCHOOL[a.school]) {
        a.trailT += dt;
        while (a.trailT > 0.045) {
          a.trailT -= 0.045;
          spawnDirected(FX_SCHOOL[a.school], p.x, p.y, p.z,
            (Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5);
        }
      }
      if (g.enemies && g.enemies.queryPoint) {
        if (hits && hits.length) {
          const e = hits[0];
          enemyPos(e, _v3);
          _v2.copy(a.vel).normalize();
          let dmg = a.dmg * sneakMul(e, 'sneakBowMult') * baneMul(e, 'bow') * brittleMul(e);
          const crit = rollCrit();
          if (crit) dmg *= 1.5;
          const heavy = dmg > 26;
          g.enemies.damage(e, dmg, _v2, { heavy, kind: 'arrow' });
          hitJuice(_v3, heavy || crit, isDead(e));
          procEnchant('bow', e, _v3.x, _v3.y, _v3.z, dmg);
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
      if (f.bomblet) f.vel.y -= 18 * dt; // bomblets arc down like mortar sparks
      f.obj.position.addScaledVector(f.vel, dt);
      const p = f.obj.position;
      f.trailT += dt;
      while (f.trailT > 0.03) {
        f.trailT -= 0.03;
        spawnDirected(FX.ember, p.x, p.y, p.z,
          (Math.random() - 0.5) * 1.5, (Math.random() - 0.2) * 1.5, (Math.random() - 0.5) * 1.5);
      }
      let boom = f.life <= 0 || p.y <= terrainHeight(p.x, p.z) + 0.2;
      // Bomblets arm after 0.15s so they scatter instead of re-popping in place
      if (!boom && (!f.bomblet || f.life < 2.35) && g.enemies && g.enemies.queryPoint) {
        const hits = g.enemies.queryPoint(p, 1.1);
        if (hits && hits.length) boom = true;
      }
      if (boom) explodeFireball(f);
    }
  }

  // -------------------------------------------------------------------------
  // Dodge roll: i-frames, camera dip + FOV kick, PERFECT DODGE slow-mo
  // -------------------------------------------------------------------------
  function iframesActive() { return dodging && dodgeT <= DODGE_IFRAME; }

  function onPerfectDodge() {
    if (perfectUsed) return;
    perfectUsed = true;
    startSlowmo(0.35, 1.2);              // Witcher time-dilation
    fovKick = -8;
    g.requestHitstop(60);
    if (g.player) g.player.addShake(0.2);
    g.camera.getWorldPosition(_camPos);
    g.camera.getWorldDirection(_camDir);
    _v1.copy(_camPos).addScaledVector(_camDir, 1.2);
    spawnBurst(FX.parry, _v1.x, _v1.y, _v1.z, 16, 1);
    if (g.audio) g.audio.play('parry');
    events.emit('perfectDodge', {});
  }

  function tryDodge(mx, my) {
    if (dodging || rawClock < dodgeCdUntil) return;
    if (!g.player || g.player.stats.hp <= 0) return;
    const st = g.player.stats;
    if (st.stamina < DODGE_STAMINA) return;
    st.stamina -= DODGE_STAMINA;
    let dx = mx, dy = my;
    if (Math.hypot(dx, dy) < 0.3) { dx = 0; dy = -1; } // idle → hop backward
    const n = Math.hypot(dx, dy);
    dx /= n; dy /= n;
    const yaw = g.player.yaw;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    // Same input→world mapping as the player controller
    dodgeDir.set(-sy * dy + cy * dx, 0, -cy * dy - sy * dx);
    dodgeLat = dx; // lateral component in view space (for camera roll)
    dodging = true; dodgeT = 0; perfectUsed = false;
    dodgeCdUntil = rawClock + DODGE_CD;
    fovKick = Math.max(fovKick, 4.5);
    if (g.audio) g.audio.play('swing');
    // Cancel charge/draw so the roll reads clean
    if (state === 'charge' || state === 'draw') {
      state = 'idle'; stateT = 0;
      nockArrow.visible = false;
    }
  }

  function detectDodgeInput(input, dt) {
    // 1) explicit button/key from ui (input.dodgePressed — may not exist yet)
    let want = !!(input && input.dodgePressed) || keyDodge;
    keyDodge = false;
    // 2) double-tap a move direction (we own this detection)
    if (input && input.move) {
      const mvx = input.move.x || 0, mvy = input.move.y || 0;
      const mag = Math.hypot(mvx, mvy);
      if (!moveWasActive && mag > 0.5) {
        const ang = Math.atan2(mvx, mvy);
        let da = Math.abs(ang - tapAng);
        if (da > Math.PI) da = TWO_PI - da;
        if (rawClock - tapT < DOUBLE_TAP_T && da < 1.0) {
          tryDodge(mvx, mvy);
          tapT = -10;
        } else {
          tapT = rawClock; tapAng = ang;
        }
      }
      moveWasActive = mag > 0.35;
      if (want) tryDodge(mvx, mvy);
    } else if (want) {
      tryDodge(0, -1);
    }
    // Advance the roll: drive player velocity along the dodge arc
    if (dodging) {
      dodgeT += dt;
      const t01 = clamp(dodgeT / DODGE_T, 0, 1);
      const sp = DODGE_SPEED * (1 - 0.55 * t01);
      if (g.player && g.player.velocity) {
        g.player.velocity.x = dodgeDir.x * sp;
        g.player.velocity.z = dodgeDir.z * sp;
      }
      if (dodgeT >= DODGE_T) dodging = false;
    }
  }

  // Desktop fallback dodge key (C) — ui also exposes a DODGE control that
  // sets input.dodgePressed; the dodging guard makes double-triggers a no-op.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC' && !e.repeat && !g.paused) keyDodge = true;
  });

  // -------------------------------------------------------------------------
  // Counter window (Mordor): enemy telegraphs in range → block tap = riposte
  // -------------------------------------------------------------------------
  function scanCounterWindow() {
    counterTarget = null;
    if (g.enemies && g.enemies.list && g.player) {
      const list = g.enemies.list;
      const p = g.player.position;
      let bestD = COUNTER_RANGE;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || e.state !== 'telegraph' || !e.aggro) continue;
        const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
        if (d < bestD) { bestD = d; counterTarget = e; }
      }
    }
    const open = counterTarget !== null;
    if (open !== counterOpen) {
      counterOpen = open;
      counterEvt.open = open;
      events.emit('counterWindow', counterEvt);
    }
  }

  function riposte(e) {
    g.camera.getWorldPosition(_camPos);
    enemyPos(e, _v3);
    _v2.subVectors(_v3, _camPos).normalize();
    const w = WEAPONS[current];
    const base = isMeleeId(current)
      ? (current === 'sword' ? swordDmg(false) : w.light)
      : WEAPONS.sword.light;
    const dmg = base * 2 * rmult('meleeDmg') * dmgMul() * fMult(current) *
                baneMul(e, current) * brittleMul(e);
    const prevHp = e.hp !== undefined ? e.hp : dmg;
    g.enemies.damage(e, dmg, _v2, { heavy: true, parried: true });
    if (e.alive && !e.dead && !e.fly) { e.state = 'stagger'; e.stateT = 0; }
    g.requestHitstop(150);
    g.player.addShake(0.4);
    spawnBurst(FX.parry, _v3.x, _v3.y, _v3.z, 18, 1);
    hitJuice(_v3, true, isDead(e));
    procEnchant(current, e, _v3.x, _v3.y, _v3.z, dmg);
    if (g.audio) g.audio.play('parry');
    if (isDead(e)) maybeFinisher(prevHp, dmg);
    // Snap the viewmodel through a strike (no stamina, hit already applied)
    state = 'swingL'; stateT = 0; didAct = true;
    swingVariant = 0;
    swingDur = 0.32;
  }

  // -------------------------------------------------------------------------
  // Block / parry — enemies call g.combat.tryBlock(dmg)
  // -------------------------------------------------------------------------
  function tryBlock(dmg) {
    // i-frames swallow the hit entirely — and reward a PERFECT DODGE
    if (iframesActive()) {
      onPerfectDodge();
      return { blocked: true, parried: false };
    }
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

  // Wrap player.damage once so i-frames also negate direct damage calls
  // (drake breath ticks, AoEs) — signature and behavior otherwise unchanged.
  function wrapPlayerDamage() {
    if (damageWrapped || !g.player || typeof g.player.damage !== 'function') return;
    damageWrapped = true;
    const orig = g.player.damage;
    g.player.damage = function (amount, fromPos) {
      if (iframesActive()) { onPerfectDodge(); return; }
      return orig.call(g.player, amount, fromPos);
    };
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
    if (id === 'torch' && current !== 'torch' && current !== 'potion') torchPrev = current;
    pendingEquip = id;
    if (state !== 'lower') { state = 'lower'; stateT = 0; }
    events.emit('equip', { id });
  }

  // Quick-button API for ui: torch toggle + potion use
  function useTorch() {
    if (current === 'torch' || pendingEquip === 'torch') {
      if (current === 'torch') equip(torchPrev || 'sword');
    } else {
      equip('torch');
    }
  }
  function usePotion() { equip('potion'); }

  function finishLower() {
    const id = pendingEquip || current;
    pendingEquip = null;
    current = id;
    api.current = id;
    setWeaponVisible(id);
    checkAldric();
    syncCurrentLook();
    state = 'raise'; stateT = 0;
  }

  // -------------------------------------------------------------------------
  // Attack input state machine
  // -------------------------------------------------------------------------
  function meleeSwingDur(heavy) {
    const t = (MELEE_TIME[current] || MELEE_TIME.sword)[heavy ? 1 : 0];
    return t / Math.max(0.25, rmult('attackSpeed'));
  }

  function startLight() {
    const st = g.player.stats;
    const cost = STAM_LIGHT[current] ?? 10;
    if (st.stamina < cost) return;
    st.stamina -= cost;
    // Sword combo chain: consecutive lights within the window escalate
    if (current === 'sword') {
      const now = g.time.elapsed;
      comboIdx = now < comboExpire ? (comboIdx + 1) % 3 : 0;
      comboExpire = now + COMBO_WINDOW;
      swingVariant = comboIdx;
    } else {
      comboIdx = 0;
      swingVariant = 0;
    }
    swingDur = meleeSwingDur(false) * (current === 'sword' && comboIdx === 2 ? 1.12 : 1);
    state = 'swingL'; stateT = 0; didAct = false;
    if (g.audio) g.audio.play(current === 'axe' || current === 'greatsword' ? 'swingHeavy' : 'swing');
    events.emit('attackSwing', { weapon: current, heavy: false });
  }
  function startHeavy() {
    const st = g.player.stats;
    const cost = STAM_HEAVY[current] ?? 22;
    if (st.stamina < cost) { startLight(); return; } // downgrade
    st.stamina -= cost;
    comboIdx = 0; comboExpire = -10;
    swingDur = meleeSwingDur(true);
    state = 'swingH'; stateT = 0; didAct = false;
    if (g.audio) g.audio.play('swingHeavy');
    events.emit('attackSwing', { weapon: current, heavy: true });
  }

  function effDrawTime() { return WEAPONS.bow.drawTime / Math.max(0.25, rmult('drawSpeed')); }

  function tryCastSpell(school) {
    const w = WEAPONS[school];
    const cost = Math.round(w.mana * rmult('spellCost'));
    if (g.player.stats.mana < cost) return false;
    g.player.stats.mana -= cost;
    spellCastEvt.school = school;
    spellCastEvt.cost = cost;
    events.emit('spellCast', spellCastEvt);
    return true;
  }

  function updateAttackInput(input, dt) {
    const busy = state === 'lower' || state === 'raise' || state === 'drink' ||
                 state === 'cast' || state === 'heal' || state === 'swingL' ||
                 state === 'swingH' || state === 'shootRecoil';
    if (isMeleeId(current)) {
      if (input.attackPressed && !busy && state !== 'charge') {
        state = 'charge'; chargeT = 0;
      }
      if (state === 'charge') {
        if (input.attackReleased || !input.attackHeld) {
          state = 'idle'; stateT = 0; // startLight/Heavy override on success
          if (current !== 'torch' && chargeT >= HEAVY_HOLD) startHeavy();
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
            lastDraw01 = clamp(drawT / effDrawTime(), 0, 1);
            shootArrow(lastDraw01);
            state = 'shootRecoil'; stateT = 0;
          } else {
            state = 'idle'; stateT = 0;
          }
        } else {
          drawT += dt;
        }
      }
    } else if (current === 'fire' || current === 'frost' || current === 'lightning') {
      if (input.attackPressed && !busy) {
        if (tryCastSpell(current)) {
          state = 'cast'; stateT = 0; didAct = false;
        }
      }
    } else if (current === 'heal') {
      if (input.attackPressed && !busy) {
        const st = g.player.stats;
        if (st.mana >= Math.round(WEAPONS.heal.mana * rmult('spellCost')) &&
            st.hp < st.maxHp + (g.player.bonus.maxHp || 0)) {
          tryCastSpell('heal');
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
    // 0.32s: fast pull-back → violent horizontal slash → smooth recovery
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
  function poseSwingDiag(t) {
    // Combo hit 2: reverse diagonal — left-to-right rising cut
    if (t < 0.25) {
      const k = easeIn3(t / 0.25);
      ry += -0.5 * k; rx += 0.3 * k; px += -0.16 * k; pz += 0.14 * k; rz += -0.24 * k;
    } else if (t < 0.55) {
      const k = easeOut4((t - 0.25) / 0.3);
      ry += lerp(-0.5, 1.05, k); rx += lerp(0.3, -0.4, k); rz += lerp(-0.24, 0.62, k);
      px += lerp(-0.16, 0.24, k); pz += lerp(0.14, -0.30, k); py += -0.08 * k;
    } else {
      const k = smooth((t - 0.55) / 0.45);
      ry += lerp(1.05, 0, k); rx += lerp(-0.4, 0, k); rz += lerp(0.62, 0, k);
      px += lerp(0.24, 0, k); pz += lerp(-0.30, 0, k); py += lerp(-0.08, 0, k);
    }
  }
  function poseSwingChop(t) {
    // Combo hit 3 / axe light: quick overhead chop with body weight
    if (t < 0.24) {
      const k = easeIn2(t / 0.24);
      rx += -1.0 * k; py += 0.22 * k; pz += 0.15 * k; ry += 0.18 * k;
    } else if (t < 0.52) {
      const k = easeOut4((t - 0.24) / 0.28);
      rx += lerp(-1.0, 0.85, k); ry += lerp(0.18, -0.15, k); rz += -0.22 * k;
      py += lerp(0.22, -0.26, k); pz += lerp(0.15, -0.36, k);
    } else {
      const k = smooth((t - 0.52) / 0.48);
      rx += lerp(0.85, 0, k); ry += lerp(-0.15, 0, k); rz += lerp(-0.22, 0, k);
      py += lerp(-0.26, 0, k); pz += lerp(-0.36, 0, k);
    }
  }
  function poseSwingHeavy(t) {
    // 0.55s+: overhead raise → crash down with body weight → slow recovery
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
  function poseSpin(t) {
    // Greatsword heavy: wind up, whirl a full 360°, settle
    if (t < 0.28) {
      const k = easeIn2(t / 0.28);
      ry += 0.85 * k; rx += -0.4 * k; px += 0.12 * k; py += 0.08 * k;
    } else if (t < 0.74) {
      const k = smooth((t - 0.28) / 0.46);
      ry += 0.85 - TWO_PI * k;
      rx += lerp(-0.4, 0.25, k);
      py += -0.12 * Math.sin(k * Math.PI);
      pz += -0.26 * Math.sin(k * Math.PI);
    } else {
      const k = smooth((t - 0.74) / 0.26);
      // Finish the revolution: (0.85 − 2π) → −2π ≡ 0.85 → 0 visually
      ry += lerp(0.85 - TWO_PI, -TWO_PI, k);
      rx += lerp(0.25, 0, k);
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
    // Fire/frost/lightning: draw hand back to hip charging, then hard palm-thrust
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
    let dur = STATE_DUR[state];
    if (state === 'swingL' || state === 'swingH') dur = swingDur;
    if (dur !== undefined) stateT += dt;
    const t01 = dur ? clamp(stateT / dur, 0, 1) : 0;

    // One-shot action moments (hit test / projectile spawn / apply effect)
    let actT = ACT_T[state];
    if (state === 'swingH' && current === 'greatsword') actT = 0.5; // spin apex
    if (!didAct && actT !== undefined && t01 >= actT) {
      didAct = true;
      if (state === 'swingL') meleeHit(false);
      else if (state === 'swingH') meleeHit(true);
      else if (state === 'cast') {
        if (current === 'frost') castFrost();
        else if (current === 'lightning') castLightning();
        else castFireball();
      } else if (state === 'heal') {
        g.player.heal(Math.round(WEAPONS.heal.amount * rmult('spellDmg') * fSpellPower('heal')));
        // Rites of Mending tome: the light lingers — 4 hp/s for 5s
        if (fSpellTier('heal') === 2) { regenLeft = 5; regenAcc = 0; }
        healSwirlLeft = 26; healSwirlT = 0;
      } else if (state === 'drink') {
        const st = g.player.stats;
        if (st.potions > 0) {
          st.potions--;
          events.emit('potionUsed', { left: st.potions }); // duelist AI punishes chugging
          g.player.heal(Math.round(WEAPONS.potion.amount * rmult('potionPower')));
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
      case 'swingL':
        if (current === 'sword') {
          if (swingVariant === 1) poseSwingDiag(t01);
          else if (swingVariant === 2) poseSwingChop(t01);
          else poseSwingLight(t01);
        } else if (current === 'axe') poseSwingChop(t01);
        else poseSwingLight(t01);
        break;
      case 'swingH':
        if (current === 'greatsword') poseSpin(t01);
        else poseSwingHeavy(t01);
        break;
      case 'charge': poseCharge(isMeleeId(current) && current !== 'torch' ? clamp(chargeT / HEAVY_HOLD, 0, 1) : 0); break;
      case 'draw': poseDraw(clamp(drawT / effDrawTime(), 0, 1), g.time.elapsed); break;
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

    // Dodge roll body-lean on the viewmodel
    if (dodging) {
      const k = Math.sin(Math.PI * clamp(dodgeT / DODGE_T, 0, 1));
      py += -0.06 * k;
      rz += 0.16 * k * (dodgeLat >= 0 ? 1 : -1);
    }

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
    } else if (current === 'frost') {
      const s = 1 + Math.sin(g.time.elapsed * 5) * 0.09 + castOrbCharge * 0.9;
      frostOrbMesh.scale.set(0.12 * s, 0.12 * s, 0.12 * s);
    } else if (current === 'lightning') {
      const s = 1 + Math.sin(g.time.elapsed * 13) * 0.14 + castOrbCharge * 0.9;
      stormOrbMesh.scale.set(0.12 * s, 0.12 * s, 0.12 * s);
    }
    // Torch flame flicker scale
    if (current === 'torch') {
      const t = g.time.elapsed;
      const f = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 23.7) * 0.08;
      torchFlame.scale.set(0.11 * f, 0.2 * (2 - f) * f, 0.11 * f);
    }
  }

  // -------------------------------------------------------------------------
  // Camera feel layered AFTER player.update (we run later in the tick):
  // dodge dip/roll + FOV kick pulses (dodge out-kick, finisher/perfect in-kick)
  // -------------------------------------------------------------------------
  function updateCameraFeel() {
    const rawDt = g.time.rawDt;
    if (dodging) {
      const t01 = clamp(dodgeT / DODGE_T, 0, 1);
      const k = Math.sin(Math.PI * t01);
      g.camera.position.y -= 0.16 * k;                      // roll dip
      g.camera.rotation.z += -dodgeLat * 0.09 * k;          // lean into it
    }
    if (fovKick !== 0) {
      g.camera.fov += fovKick;
      g.camera.updateProjectionMatrix();
      fovKick *= Math.exp(-6.5 * rawDt);
      if (Math.abs(fovKick) < 0.05) fovKick = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Ambient VFX: torch embers, Aldric blade embers, heal swirl, frost mist
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
    // Forge look: school wisps along an enchanted blade (stronger during
    // swings), or faint ember runes + slow emissive pulse at tier 4.
    if (curLm && (curEnch || curTier >= 4)) {
      const swinging = state === 'swingL' || state === 'swingH';
      if (curEnch) curLm.blade.emissiveIntensity = 0.55 + Math.sin(t * 2.3) * 0.1 + (swinging ? 0.3 : 0);
      else curLm.blade.emissiveIntensity = 0.5 + Math.sin(t * 1.6) * 0.18 + (swinging ? 0.15 : 0);
      wispT += dt;
      const wispEvery = curEnch ? (swinging ? 0.11 : 0.38) : 0.6;
      if (wispT > wispEvery) {
        wispT = 0;
        lookParts[current].blade[0].getWorldPosition(_v1);
        _v1.x += (Math.random() - 0.5) * 0.22;
        _v1.y += (Math.random() - 0.4) * 0.34;
        _v1.z += (Math.random() - 0.5) * 0.22;
        spawnDirected(curEnch ? FX_SCHOOL[curEnch] : FX.ember, _v1.x, _v1.y, _v1.z,
          (Math.random() - 0.5) * 0.3, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3);
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
  // Shared point light: flash (explosion/storm) > fireball in flight > torch
  // -------------------------------------------------------------------------
  function updateLight(dt) {
    const L = g.pointLight;
    const t = g.time.elapsed;
    if (flashT > 0) {
      flashT -= dt;
      L.position.copy(flashPos);
      L.color.setHex(flashColor);
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
    // Cinematics/photo mode: hide first-person arms, ignore combat input
    if (vmRoot.visible === !!g.cameraLock) vmRoot.visible = !g.cameraLock;
    if (g.cameraLock) { if (typeof updateParticles === 'function') updateParticles(dt); return; }
    if (g.paused) return; // gameplay frozen (menus/dialogue)
    const rawDt = g.time.rawDt;
    rawClock += rawDt;
    checkAldric();
    wrapPlayerDamage();
    if (!assetsRequested && g.assets) { assetsRequested = true; requestRealWeapons(); }
    // Forge arrives after combat in boot order — style weapons on first sight
    if (!forgeSeen && g.forge) { forgeSeen = true; refreshWeaponLook(); }

    const input = g.ui && g.ui.input;

    // Consume weapon-wheel / hotkey selection (backward-compatible: all 10 ids)
    if (input && input.hotkeySelected) {
      const id = input.hotkeySelected;
      input.hotkeySelected = null;
      equip(id);
    }

    // Timed slow-mo (perfect dodge / finisher) — real-time countdown
    if (slowmoLeft > 0) {
      g.requestSlowmo(slowmoF);
      slowmoLeft -= rawDt;
      if (slowmoLeft <= 0) { slowmoLeft = 0; g.releaseSlowmo(); }
    }

    // Dodge input (double-tap + dodgePressed + desktop C) & roll motion
    detectDodgeInput(input, dt);

    // Counter window: telegraphing enemy in range → prompt via event
    scanCounterWindow();

    // Blocking state (parry window measured from block press)
    const canBlock = state !== 'drink' && state !== 'cast' && state !== 'heal' &&
                     state !== 'swingL' && state !== 'swingH';
    const wantBlock = !!(input && input.blockHeld) && canBlock;
    if (wantBlock && !blocking) {
      blockStartAt = g.time.elapsed;
      // Mordor counter: block TAP during an open window = instant riposte
      if (counterOpen && counterTarget && counterTarget.alive) riposte(counterTarget);
    }
    blocking = wantBlock;
    if (g.player) g.player.isBlocking = blocking;
    if (blocking && (state === 'charge' || state === 'draw')) {
      state = 'idle'; stateT = 0;
      nockArrow.visible = false;
    }

    if (input && g.player && !blocking) updateAttackInput(input, dt);

    updateViewmodel(input, dt);
    updateProjectiles(dt);
    updateFrostSlows();
    updateBurns(dt);
    // Rites of Mending: lingering 4 hp/s regen with soft green motes
    if (regenLeft > 0 && g.player && g.player.stats.hp > 0) {
      regenLeft -= dt;
      regenAcc += 4 * dt;
      if (regenAcc >= 1) {
        const n = Math.floor(regenAcc);
        regenAcc -= n;
        g.player.heal(n);
      }
      regenFxT += dt;
      if (regenFxT > 0.3) {
        regenFxT = 0;
        const pp = g.player.position;
        spawnDirected(FX.heal,
          pp.x + (Math.random() - 0.5) * 0.8, pp.y + 0.4 + Math.random(), pp.z + (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.3, 1.0 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3);
      }
      if (regenLeft <= 0) { regenLeft = 0; regenAcc = 0; }
    }
    updateLoot(dt);
    updateAmbientFX(dt);
    updateParticles(dt);
    updateLight(dt);
    updateCameraFeel();

    // Lightning bolt flash fade (real time so hitstop doesn't freeze it)
    if (boltT > 0) {
      boltT -= rawDt;
      boltMat.opacity = clamp(boltT / 0.14, 0, 1);
      if (boltT <= 0) { boltLine.visible = false; boltMat.opacity = 1; }
    }
  }

  // -------------------------------------------------------------------------
  // Duelist AI support: fill `out` with live player projectiles so agile
  // enemies can read time-to-impact and dodge. Zero-alloc: caller owns `out`.
  function getProjectiles(out) {
    out.length = 0;
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i];
      if (a.active && !(a.stuck > 0)) out.push({ x: a.obj.position.x, y: a.obj.position.y, z: a.obj.position.z, vx: a.vel.x, vy: a.vel.y, vz: a.vel.z, kind: 'arrow' });
    }
    for (let i = 0; i < fireballs.length; i++) {
      const f = fireballs[i];
      if (f.active) out.push({ x: f.obj.position.x, y: f.obj.position.y, z: f.obj.position.z, vx: f.vel.x, vy: f.vel.y, vz: f.vel.z, kind: 'fireball' });
    }
    return out;
  }

  const api = {
    update,
    equip,
    tryBlock,
    getProjectiles,
    useTorch,
    usePotion,
    refreshWeaponLook,
    current,
    WEAPONS,
    HOTBAR,
    QUICK,
  };
  return api;
}

// ============================================================================
// ELDERFALL — enemies.js  (art overhaul wave 2)
// Enemy AI, animated KayKit character rigs (AnimationMixer state machines,
// crossfades, speed-matched locomotion, distance-LOD), seeded spawn system,
// the drake boss (Vhastrix, rebuilt menacing procedural), the barrowlord,
// nemesis bandit lord Vargr Redfang, and the wave-2 roster: wraiths, vampire
// thralls + Lord Morvane, witch Grimhilde, the Stonebridge troll, night
// werewolves, skeleton archers and atmospheric village guards.
// Owns `enemyKilled`, `spawnLoot`, `combatState` and `bossBar` events.
// Wave-3 endgame (FORGE-ECON.md, revised scaling): the whole world scales
// WITH the player (base × (1 + 0.05×(lvl−1)), soft cap ~×2.6; XP/loot follow);
// danger areas differ by ENCOUNTER DESIGN (bigger packs, ~15% elite chance,
// mixed ranged/melee, ridge ambushes, ≤+15% flat mod) — never stat walls.
// Bosses lock their scale at first engagement (challenge floor = base stats).
// Plus: elite variants, material drops, the inn Hunt Board, Blood Moon siege
// nights and the Trial of Echoes at the Shrine of Aldric.
//
// Contract §5 + ASSETS-ART.md. Only imports: three + core.js. Zero per-frame
// allocations in update() — all temps are preallocated; query results reuse
// module arrays. Assets stream in async: every enemy is an empty logic Group
// immediately (colliders/AI/blob shadow/hp bar work), the skinned mesh
// attaches when its GLB resolves.
// ============================================================================
import * as THREE from 'three';
import {
  WORLD_SEED, WATER_LEVEL, clamp, lerp, dist2d, hash2,
  terrainHeight, biomeAt, BIOME, POI,
} from './core.js';

// ---------------------------------------------------------------------------
// Type stat table (hp / dmg / speed / xp per contract; wave-2 additions)
// ---------------------------------------------------------------------------
const TYPES = {
  wolf:       { hp: 30,  dmg: 8,  speed: 6.2, xp: 20,  reach: 1.6, bodyR: 0.60, height: 1.05, sightR: 20, atkCd: 1.4, mass: 1.00, name: 'Wolf' },
  goblin:     { hp: 40,  dmg: 10, speed: 4.4, xp: 25,  reach: 1.7, bodyR: 0.50, height: 1.25, sightR: 16, atkCd: 1.6, mass: 1.00, name: 'Goblin' },
  bandit:     { hp: 70,  dmg: 14, speed: 4.8, xp: 40,  reach: 2.0, bodyR: 0.60, height: 1.85, sightR: 18, atkCd: 1.8, mass: 0.80, name: 'Bandit' },
  skeleton:   { hp: 55,  dmg: 12, speed: 3.6, xp: 35,  reach: 1.9, bodyR: 0.55, height: 1.80, sightR: 15, atkCd: 1.9, mass: 1.00, name: 'Skeleton' },
  skelarcher: { hp: 45,  dmg: 11, speed: 3.4, xp: 40,  reach: 1.9, bodyR: 0.52, height: 1.75, sightR: 20, atkCd: 2.4, mass: 1.00, teleT: 0.7, name: 'Skeleton Archer' },
  barrowlord: { hp: 260, dmg: 22, speed: 3.2, xp: 150, reach: 2.7, bodyR: 1.00, height: 2.85, sightR: 20, atkCd: 2.3, mass: 0.30, name: 'Barrow Lord' },
  drake:      { hp: 700, dmg: 28, speed: 8.0, xp: 500, reach: 3.4, bodyR: 2.40, height: 3.20, sightR: 90, atkCd: 2.2, mass: 0.10, name: 'Vhastrix' },
  // Nemesis: bandit ×2.2 (per-win +15% applied at spawn)
  vargr:      { hp: 154, dmg: 31, speed: 5.2, xp: 200, reach: 2.1, bodyR: 0.65, height: 2.05, sightR: 22, atkCd: 1.5, mass: 0.60, name: 'Vargr Redfang' },
  // --- wave 2 roster ---
  wraith:     { hp: 60,  dmg: 13, speed: 3.6, xp: 55,  reach: 2.0, bodyR: 0.55, height: 1.90, sightR: 22, atkCd: 2.6, mass: 0.90, teleT: 0.8, name: 'Wraith', dawnFade: true },
  thrall:     { hp: 55,  dmg: 12, speed: 5.6, xp: 45,  reach: 1.8, bodyR: 0.55, height: 1.80, sightR: 20, atkCd: 1.5, mass: 0.90, name: 'Vampire Thrall', dawnFade: true },
  morvane:    { hp: 240, dmg: 20, speed: 5.2, xp: 260, reach: 2.1, bodyR: 0.60, height: 2.02, sightR: 24, atkCd: 1.7, mass: 0.45, teleT: 0.5, name: 'Lord Morvane', dawnFade: true },
  witch:      { hp: 120, dmg: 15, speed: 3.8, xp: 90,  reach: 2.0, bodyR: 0.55, height: 1.75, sightR: 20, atkCd: 2.4, mass: 0.80, teleT: 0.9, name: 'Grimhilde' },
  troll:      { hp: 400, dmg: 40, speed: 3.4, xp: 300, reach: 3.0, bodyR: 1.10, height: 4.15, sightR: 20, atkCd: 2.6, mass: 0.15, teleT: 1.0, strikeT: 0.6, name: 'Stonebridge Troll' },
  werewolf:   { hp: 90,  dmg: 18, speed: 7.2, xp: 80,  reach: 1.9, bodyR: 0.62, height: 2.25, sightR: 26, atkCd: 1.1, mass: 0.85, teleT: 0.45, name: 'Werewolf' },
};
const GOLD = {
  wolf: [3, 8], goblin: [4, 12], bandit: [8, 18], skeleton: [5, 14],
  skelarcher: [6, 15], barrowlord: [50, 90], drake: [120, 200], vargr: [60, 100],
  wraith: [10, 20], thrall: [12, 22], morvane: [80, 140], witch: [30, 60],
  troll: [90, 150], werewolf: [15, 30],
};

// Ranged casters/shooters: preferred distance band + bolt kind
const RANGED = {
  wraith:     { min: 5, max: 14, bolt: 'wraith' },
  witch:      { min: 6, max: 16, bolt: 'witch' },
  skelarcher: { min: 5, max: 16, bolt: 'arrow' },
};

// New POI coordinates (ASSETS-ART.md; structures.js builds the scenery)
const WITCH_HUT   = { x: -260, z: -520 };
const STONEBRIDGE = { x: 330,  z: -260 };

const TELEGRAPH_T = 0.55;   // readable windup — contract (per-type teleT overrides)
const STRIKE_T    = 0.30;   // lunge duration; hit lands at STRIKE_HIT_T
const STRIKE_HIT_T = 0.12;
const FLINCH_T    = 0.24;
const STAGGER_T   = 1.2;
const GUARD_T     = 0.9;
const DODGE_T     = 0.4;    // thrall sidestep
const BLINK_T     = 0.55;   // Morvane teleport-blink
const SINK_AFTER  = 6.0;    // corpse sits, then sinks
const SINK_T      = 1.4;
const ACTIVE_CAP  = 10;     // non-boss actives within range
const SPAWN_R     = 260;
const DESPAWN_R   = 320;
const DEAGGRO_R   = 45;
const DRAKE_DEAGGRO_R = 160;
const RESPAWN_T   = 180;
const NIGHT_RESPAWN_T = 60; // skeletons at ruins respawn fast at night

// Locomotion clip reference speeds (KayKit clips as authored)
const REF_WALK = 2.2;
const REF_RUN  = 5.5;

// ---------------------------------------------------------------------------
// Preallocated temps (no per-frame allocations)
// ---------------------------------------------------------------------------
const _hits = [];
const _pts = [];
const _bb = { name: '', hp: 0, maxHp: 0 };
const CS_ON = { inCombat: true };
const CS_OFF = { inCombat: false };
const _box = new THREE.Box3();
const _tv = new THREE.Vector3();

function isNightFrac(f) { return f < 0.23 || f > 0.77; }

// ===========================================================================
export function createEnemies(g) {
  const events = g.events;

  // -------------------------------------------------------------------------
  // Character rig specs — which KayKit char, target world height, tint, clips
  // -------------------------------------------------------------------------
  const SPEC = {
    wolf:       { char: 'fox', h: 1.25, tint: '#9a938a', simple: true,
                  locoIdle: 'Survey', locoWalk: 'Walk', locoRun: 'Run' },
    goblin:     { char: 'skeleton_minion', h: 1.30, tint: '#7fae5a',
                  attacks: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop'] },
    bandit:     { char: 'rogue', h: 1.80, tint: '#cdb69a',
                  attacks: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab'] },
    skeleton:   { char: 'skeleton_warrior', h: 1.80,
                  attacks: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop'] },
    skelarcher: { char: 'skeleton_rogue', h: 1.75, cast: '1H_Ranged_Shoot' },
    barrowlord: { char: 'skeleton_warrior', h: 2.85, tint: '#d8b860',
                  tintOpts: { emissive: '#3a2a08', emissiveIntensity: 0.35 },
                  locoIdle: '2H_Melee_Idle',
                  attacks: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin'] },
    vargr:      { char: 'rogue', h: 2.05, tint: '#d9a8a0', isVargr: true,
                  attacks: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab'] },
    wraith:     { char: 'skeleton_mage', h: 1.90, tint: '#9fd8ff',
                  tintOpts: { emissive: '#66ccff', emissiveIntensity: 0.7, opacity: 0.55 },
                  loco: 'Spellcasting', cast: 'Spellcast_Shoot' },
    thrall:     { char: 'rogue_hooded', h: 1.80, tint: '#cfd4e6',
                  tintOpts: { emissive: '#3a0910', emissiveIntensity: 0.35 },
                  attacks: ['1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Diagonal'] },
    morvane:    { char: 'rogue_hooded', h: 2.02, tint: '#d8dcec',
                  tintOpts: { emissive: '#58101c', emissiveIntensity: 0.55 },
                  attacks: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab'] },
    witch:      { char: 'mage', h: 1.75, tint: '#8a6aae',
                  tintOpts: { emissive: '#1e3a14', emissiveIntensity: 0.4 },
                  cast: 'Spellcast_Shoot', handGlow: true },
    troll:      { char: 'barbarian', h: 4.15, tint: '#8a9086',
                  locoIdle: '2H_Melee_Idle',
                  attacks: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Spin'] },
    werewolf:   { char: 'barbarian', h: 2.25, tint: '#5a4636', hunch: true, runTs: 1.2,
                  attacks: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Kick'] },
    guard:      { char: 'knight', h: 1.85 },
  };
  for (const k in SPEC) {
    const s = SPEC[k];
    if (!s.locoIdle) s.locoIdle = 'Idle';
    if (!s.locoWalk) s.locoWalk = 'Walking_A';
    if (!s.locoRun) s.locoRun = 'Running_A';
  }

  // -------------------------------------------------------------------------
  // SHARED geometry / material library — built exactly once
  // -------------------------------------------------------------------------
  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 6),
    plane: new THREE.PlaneGeometry(1, 1),
    orb: new THREE.SphereGeometry(0.14, 6, 5),
  };
  function lam(color, emissive = 0x000000) {
    return new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });
  }
  const M = {
    // drake palette (single boss — dedicated materials are fine)
    drake: lam(0x571d26, 0x0d0304),
    drakeBelly: lam(0x3a2b30, 0x060202),
    drakeHorn: lam(0x2c2622),
    drakeWing: new THREE.MeshLambertMaterial({
      color: 0x8c3424, emissive: 0x1c0505, flatShading: true,
      side: THREE.DoubleSide, transparent: true, opacity: 0.94,
    }),
    drakeEye: lam(0x100804, 0xffa020),
    drakeThroat: lam(0x30161a, 0xff4408),
    witchHand: new THREE.MeshBasicMaterial({ color: 0x55ff44, transparent: true, opacity: 0.85 }),
  };
  M.drakeEye.emissiveIntensity = 2.0;
  M.drakeThroat.emissiveIntensity = 0.0;

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
  // Skinned rig loading + animation controller
  // -------------------------------------------------------------------------
  const nativeH = {}; // char name -> measured native height (Box3, once)

  function buildRig(h, spec, res) {
    if (h.rig) return; // already built (pool re-entry safety)
    const scene = res.scene;
    let nh = nativeH[spec.char];
    if (!nh) {
      _box.setFromObject(scene);
      nh = Math.max(0.01, _box.max.y - _box.min.y);
      nativeH[spec.char] = nh;
    }
    scene.scale.setScalar(spec.h / nh);
    if (spec.tint) g.assets.tint(scene, spec.tint, spec.tintOpts || undefined);
    h.rig = scene;
    h.root.add(scene);
    h.mixer = new THREE.AnimationMixer(scene);
    h.clips = {};
    for (let i = 0; i < res.animations.length; i++) h.clips[res.animations[i].name] = res.animations[i];
    h.actions = {};
    h.cur = null; h.curName = '';
    if (spec.hunch) {
      let sp = null;
      scene.traverse((o) => { if (!sp && o.isBone && /spine/i.test(o.name)) sp = o; });
      h.spine = sp;
      h.spineBase = sp ? sp.rotation.x : 0;
    }
    if (spec.handGlow) {
      let n = 0;
      scene.traverse((o) => {
        if (n < 2 && o.isBone && /hand/i.test(o.name)) {
          const orb = new THREE.Mesh(GEO.orb, M.witchHand);
          orb.scale.setScalar(0.55 / scene.scale.x);
          orb.castShadow = false;
          o.add(orb);
          n++;
        }
      });
    }
    if (spec.isVargr) applyVargrLook(h, Math.min(g.flags.vargrWins | 0, 3));
  }

  function requestRig(h, specKey) {
    const spec = SPEC[specKey];
    if (!spec) return;
    h.spec = spec;
    const got = g.assets.charSync(spec.char);
    if (got) { buildRig(h, spec, got); return; }
    g.assets.char(spec.char)
      .then((res) => { buildRig(h, spec, res); })
      .catch(() => {});
  }

  // Play a looping clip (no-op if already current; updates timeScale)
  function play(h, name, fade, ts) {
    const clip = h.clips[name];
    if (!clip) return null;
    let a = h.actions[name];
    if (!a) { a = h.mixer.clipAction(clip); h.actions[name] = a; }
    if (h.curName === name) { a.timeScale = ts; return a; }
    a.reset();
    a.timeScale = ts;
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    if (h.cur && h.cur !== a) h.cur.fadeOut(fade);
    a.fadeIn(fade);
    a.play();
    h.cur = a; h.curName = name;
    return a;
  }

  // Restart a one-shot clip (always retriggers)
  function playOnce(h, name, fade, ts) {
    const clip = h.clips[name];
    if (!clip) return null;
    let a = h.actions[name];
    if (!a) { a = h.mixer.clipAction(clip); h.actions[name] = a; }
    if (h.cur && h.cur !== a) h.cur.fadeOut(fade);
    a.reset();
    a.timeScale = ts;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.fadeIn(fade);
    a.play();
    h.cur = a; h.curName = name;
    return a;
  }

  function clipDur(h, name) {
    const c = h.clips[name];
    return c ? c.duration : 1;
  }

  // Vargr's scars: red tint + emissive stripes deepen per nemesis win
  const VARGR_EMISS = ['#000000', '#6a0e0e', '#9a1414', '#c81a1a'];
  function applyVargrLook(h, wins) {
    if (!h.rig || h.vargrWins === wins) return;
    h.vargrWins = wins;
    if (wins > 0) {
      g.assets.tint(h.rig, '#e6bcb2', {
        emissive: VARGR_EMISS[Math.min(wins, 3)],
        emissiveIntensity: 0.12 + 0.16 * Math.min(wins, 3),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Drake Vhastrix — rebuilt menacing procedural body (kept boneless: its
  // flight/pose code is bespoke). Sleek tapered neck/tail, bat-wing membranes,
  // dorsal spikes, swept horns, emissive eyes + throat glow before fire.
  // -------------------------------------------------------------------------
  function part(parent, geo, mat, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
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

  const wingGeo = (() => {
    // Bat-wing membrane: fan of triangles, scalloped trailing edge (local -X out)
    const v = new Float32Array([
      0.0, 0.0, 0.3,      // 0 shoulder
      -1.7, 0.25, 0.45,   // 1 elbow
      -4.1, -0.05, 0.0,   // 2 wing tip
      -3.3, -0.5, -1.35,  // 3 scallop 1
      -2.0, -0.42, -1.85, // 4 scallop 2
      -0.7, -0.2, -1.55,  // 5 scallop 3
      0.0, -0.1, -1.05,   // 6 root trailing
    ]);
    const idx = [0, 1, 5, 1, 4, 5, 1, 3, 4, 1, 2, 3, 0, 5, 6];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  })();

  function buildDrake() {
    const group = new THREE.Group();
    // Body: deep chest tapering to hips + pale belly + dorsal spikes
    const body = pivot(group, 0, 1.45, 0);
    part(body, GEO.box, M.drake, 0, 0.1, 0.7, 1.5, 1.3, 2.0);          // chest
    part(body, GEO.box, M.drake, 0, 0.0, -1.0, 1.1, 1.0, 1.7);         // hips
    part(body, GEO.box, M.drakeBelly, 0, -0.55, 0.3, 1.05, 0.5, 2.6);  // belly plates
    for (let i = 0; i < 5; i++) {
      const s = 0.55 - i * 0.07;
      part(body, GEO.cone, M.drakeHorn, 0, 0.75 - i * 0.06, 1.0 - i * 0.62, s, s * 1.6, s * 0.55, -0.35);
    }
    part(body, GEO.box, M.drake, -0.85, -0.65, -0.7, 0.55, 0.9, 0.85, 0.25);  // haunch L
    part(body, GEO.box, M.drake, 0.85, -0.65, -0.7, 0.55, 0.9, 0.85, 0.25);   // haunch R
    // Neck: three tapering segments arcing up to the skull
    const neck = pivot(group, 0, 2.0, 1.55);
    part(neck, GEO.box, M.drake, 0, 0.18, 0.28, 0.78, 0.68, 0.95, -0.35);
    part(neck, GEO.box, M.drake, 0, 0.62, 0.72, 0.62, 0.56, 0.85, -0.55);
    part(neck, GEO.box, M.drake, 0, 1.06, 1.06, 0.5, 0.46, 0.75, -0.7);
    const throat = part(neck, GEO.box, M.drakeThroat, 0, 0.5, 0.85, 0.34, 0.9, 0.55, -0.6);
    throat.castShadow = false;
    const head = pivot(neck, 0, 1.42, 1.38);
    part(head, GEO.box, M.drake, 0, 0.08, 0.15, 0.6, 0.42, 0.7);              // skull
    part(head, GEO.box, M.drake, 0, 0.0, 0.68, 0.38, 0.26, 0.62);             // snout
    const jaw = pivot(head, 0, -0.1, 0.15);
    part(jaw, GEO.box, M.drake, 0, -0.06, 0.42, 0.32, 0.12, 0.72);
    part(head, GEO.cone, M.drakeHorn, -0.22, 0.3, -0.18, 0.16, 0.85, 0.16, -2.3, 0, 0.25);  // horn L
    part(head, GEO.cone, M.drakeHorn, 0.22, 0.3, -0.18, 0.16, 0.85, 0.16, -2.3, 0, -0.25);  // horn R
    part(head, GEO.cone, M.drakeHorn, -0.13, 0.34, 0.18, 0.09, 0.4, 0.09, -2.0);            // brow spike L
    part(head, GEO.cone, M.drakeHorn, 0.13, 0.34, 0.18, 0.09, 0.4, 0.09, -2.0);             // brow spike R
    const eyeL = part(head, GEO.box, M.drakeEye, -0.26, 0.14, 0.34, 0.1, 0.07, 0.12);
    const eyeR = part(head, GEO.box, M.drakeEye, 0.26, 0.14, 0.34, 0.1, 0.07, 0.12);
    eyeL.castShadow = eyeR.castShadow = false;
    // Tail: tapering whip with a fin
    const tail = pivot(group, 0, 1.4, -1.75);
    part(tail, GEO.box, M.drake, 0, 0, -0.7, 0.62, 0.5, 1.5);
    part(tail, GEO.box, M.drake, 0, 0.04, -1.95, 0.4, 0.32, 1.35);
    part(tail, GEO.box, M.drake, 0, 0.08, -3.0, 0.24, 0.2, 1.1);
    part(tail, GEO.cone, M.drakeWing, 0, 0.1, -3.7, 0.7, 1.2, 0.08, -Math.PI / 2);  // tail fin
    // Wings: bone leading edge + membrane fan
    const wingL = pivot(group, -0.75, 2.35, 0.55);
    part(wingL, GEO.box, M.drake, -0.9, 0.12, 0.35, 1.9, 0.16, 0.2, 0, -0.08);      // arm bone
    part(wingL, GEO.box, M.drake, -2.9, 0.08, 0.2, 2.4, 0.11, 0.13, 0, -0.06);      // finger bone
    const memL = new THREE.Mesh(wingGeo, M.drakeWing);
    memL.castShadow = true;
    wingL.add(memL);
    const wingR = pivot(group, 0.75, 2.35, 0.55);
    const wr = new THREE.Group();
    wr.scale.x = -1;
    wingR.add(wr);
    part(wr, GEO.box, M.drake, -0.9, 0.12, 0.35, 1.9, 0.16, 0.2, 0, -0.08);
    part(wr, GEO.box, M.drake, -2.9, 0.08, 0.2, 2.4, 0.11, 0.13, 0, -0.06);
    const memR = new THREE.Mesh(wingGeo, M.drakeWing);
    memR.castShadow = true;
    wr.add(memR);
    return { group, parts: { body, neck, head, jaw, tail, wingL, wingR } };
  }

  // -------------------------------------------------------------------------
  // Holders (rig root + shadow + hp bar) — pooled per type, kept in scene
  // -------------------------------------------------------------------------
  const pools = {};
  for (const k in TYPES) pools[k] = [];

  function makeHolder(type) {
    const holder = {
      type, root: null, parts: null,
      rig: null, mixer: null, clips: null, actions: null, cur: null, curName: '',
      spec: SPEC[type] || null, spine: null, spineBase: 0, vargrWins: -1,
      deathPlayed: false,
      shadow: null, bar: null, barFill: null, barW: 1.1,
    };
    if (type === 'drake') {
      const d = buildDrake();
      holder.root = d.group;
      holder.parts = d.parts;
    } else {
      holder.root = new THREE.Group(); // logic-first: empty until GLB resolves
      requestRig(holder, type);
    }
    holder.root.visible = false;
    g.scene.add(holder.root);

    const shadow = new THREE.Mesh(GEO.plane, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    shadow.visible = false;
    g.scene.add(shadow);
    holder.shadow = shadow;

    const barW = type === 'drake' ? 3.0 : type === 'barrowlord' ? 1.8 :
      type === 'troll' ? 2.2 : type === 'morvane' ? 1.7 : 1.1;
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
    holder.bar = bar; holder.barFill = barFill; holder.barW = barW;

    return holder;
  }
  function acquireHolder(type) {
    return pools[type].length ? pools[type].pop() : makeHolder(type);
  }
  function releaseHolder(h) {
    h.root.visible = false;
    h.shadow.visible = false;
    h.bar.visible = false;
    if (h.mixer) { h.mixer.stopAllAction(); h.cur = null; h.curName = ''; }
    h.deathPlayed = false;
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
      deadFlag: (opts && opts.deadFlag) || null,
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
  // Skeleton archers on the ruin walls' line (night respawn like their kin)
  addSpawner('skelarcher', POI.ruins.x - 12, POI.ruins.z - 30, { nightRespawn: true });
  addSpawner('skelarcher', POI.ruins.x + 26, POI.ruins.z - 4, { nightRespawn: true });
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
  // Wraiths: night-only, ruins + wardstones (spirits of the old barrows)
  addSpawner('wraith', POI.ruins.x - 22, POI.ruins.z + 26, { nightOnly: true });
  addSpawner('wraith', POI.ruins.x + 32, POI.ruins.z + 10, { nightOnly: true });
  addSpawner('wraith', POI.stones.x + 14, POI.stones.z - 10, { nightOnly: true });
  addSpawner('wraith', POI.stones.x - 15, POI.stones.z + 13, { nightOnly: true });
  // Cemetery ring by the ruins (structures.js dresses it) — vampire territory
  const CEMETERY = { x: POI.ruins.x - 58, z: POI.ruins.z + 42 };
  addSpawner('thrall', CEMETERY.x + 8, CEMETERY.z - 6, { nightOnly: true });
  addSpawner('thrall', CEMETERY.x - 9, CEMETERY.z + 4, { nightOnly: true });
  addSpawner('thrall', CEMETERY.x + 2, CEMETERY.z + 12, { nightOnly: true });
  // Vampire lord Morvane in the cemetery crypt, night mini-boss
  addSpawner('morvane', CEMETERY.x, CEMETERY.z, { boss: true, nightOnly: true, deadFlag: 'morvaneDead' });
  // Witch Grimhilde at her hut (neutral until provoked / quest-flagged)
  addSpawner('witch', WITCH_HUT.x + 6, WITCH_HUT.z + 5, { deadFlag: 'witchDead' });
  // The Stonebridge troll, living under the bridge on the ruins road
  addSpawner('troll', STONEBRIDGE.x + 3, STONEBRIDGE.z + 4, { boss: true, deadFlag: 'trollDead' });

  // Persistent boss state (serialized — format unchanged; new minibosses
  // persist through g.flags which save.js already stores)
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
  // Generic colored burst particles (troll slam ring, Morvane blink, bolt
  // impacts) — one pooled vertex-colored Points system
  // -------------------------------------------------------------------------
  const BURST_N = 96;
  const burstPos = new Float32Array(BURST_N * 3);
  const burstVel = new Float32Array(BURST_N * 3);
  const burstLife = new Float32Array(BURST_N);
  const burstCol = new Float32Array(BURST_N * 3);
  for (let i = 0; i < BURST_N; i++) { burstPos[i * 3 + 1] = -9999; burstLife[i] = 0; }
  const burstGeo = new THREE.BufferGeometry();
  const burstPosAttr = new THREE.BufferAttribute(burstPos, 3);
  burstPosAttr.setUsage(THREE.DynamicDrawUsage);
  const burstColAttr = new THREE.BufferAttribute(burstCol, 3);
  burstColAttr.setUsage(THREE.DynamicDrawUsage);
  burstGeo.setAttribute('position', burstPosAttr);
  burstGeo.setAttribute('color', burstColAttr);
  const burstPoints = new THREE.Points(burstGeo, new THREE.PointsMaterial({
    size: 0.5, vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  burstPoints.frustumCulled = false;
  g.scene.add(burstPoints);
  let burstAlive = 0;
  let burstCursor = 0;
  // style: 0 = radial ground ring (slam dust), 1 = spherical puff (magic)
  function emitBurst(x, y, z, n, r, gr, b, style) {
    for (let k = 0; k < n; k++) {
      const i = burstCursor; burstCursor = (burstCursor + 1) % BURST_N;
      burstPos[i * 3] = x; burstPos[i * 3 + 1] = y; burstPos[i * 3 + 2] = z;
      if (style === 0) {
        const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
        const s = 7 + Math.random() * 4;
        burstVel[i * 3] = Math.cos(a) * s;
        burstVel[i * 3 + 1] = 1.5 + Math.random() * 2;
        burstVel[i * 3 + 2] = Math.sin(a) * s;
      } else {
        burstVel[i * 3] = (Math.random() - 0.5) * 6;
        burstVel[i * 3 + 1] = (Math.random() - 0.3) * 6;
        burstVel[i * 3 + 2] = (Math.random() - 0.5) * 6;
      }
      burstCol[i * 3] = r; burstCol[i * 3 + 1] = gr; burstCol[i * 3 + 2] = b;
      if (burstLife[i] <= 0) burstAlive++;
      burstLife[i] = 0.4 + Math.random() * 0.35;
    }
    burstColAttr.needsUpdate = true;
  }
  function updateBurst(dt) {
    if (burstAlive === 0) return;
    for (let i = 0; i < BURST_N; i++) {
      if (burstLife[i] <= 0) continue;
      burstLife[i] -= dt;
      if (burstLife[i] <= 0) { burstPos[i * 3 + 1] = -9999; burstAlive--; continue; }
      burstPos[i * 3] += burstVel[i * 3] * dt;
      burstPos[i * 3 + 1] += burstVel[i * 3 + 1] * dt;
      burstPos[i * 3 + 2] += burstVel[i * 3 + 2] * dt;
      burstVel[i * 3 + 1] -= 4.5 * dt;
    }
    burstPosAttr.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Enemy bolt projectiles (wraith spirit bolts, witch arcing hexes,
  // skeleton archer arrows) — pooled meshes, owned here
  // -------------------------------------------------------------------------
  const BOLT_KINDS = {
    wraith: { mat: new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.95 }), spd: 15, grav: 0, scale: 1.4, long: 1.6, trail: [0.5, 0.8, 1.0] },
    witch:  { mat: new THREE.MeshBasicMaterial({ color: 0x66ff55, transparent: true, opacity: 0.95 }), spd: 13, grav: 9, scale: 1.5, long: 1.2, trail: [0.35, 1.0, 0.3] },
    arrow:  { mat: new THREE.MeshBasicMaterial({ color: 0xd8c8a0, transparent: true, opacity: 0.95 }), spd: 27, grav: 4, scale: 0.8, long: 4.5, trail: null },
  };
  const BOLT_N = 14;
  const bolts = [];
  for (let i = 0; i < BOLT_N; i++) {
    const mesh = new THREE.Mesh(GEO.orb, BOLT_KINDS.arrow.mat);
    mesh.castShadow = false;
    mesh.visible = false;
    g.scene.add(mesh);
    bolts.push({ mesh, vel: new THREE.Vector3(), active: false, life: 0, dmg: 0, grav: 0, kind: null, trailT: 0 });
  }
  let boltCursor = 0;

  function fireBolt(e, R) {
    const K = BOLT_KINDS[R.bolt];
    const b = bolts[boltCursor]; boltCursor = (boltCursor + 1) % BOLT_N;
    const p = g.player;
    const ox = e.pos.x + Math.sin(e.yaw) * 0.6;
    const oy = e.pos.y + e.height * 0.72;
    const oz = e.pos.z + Math.cos(e.yaw) * 0.6;
    // lead the target slightly with player velocity
    const lead = p.velocity ? 0.35 : 0;
    const tx = p.position.x + (lead ? p.velocity.x * lead : 0);
    const ty = p.position.y + 1.1;
    const tz = p.position.z + (lead ? p.velocity.z * lead : 0);
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const dh = Math.max(Math.hypot(dx, dz), 0.01);
    if (K.grav > 0) {
      // ballistic arc onto the target
      const tArr = dh / K.spd;
      b.vel.set((dx / dh) * K.spd, dy / tArr + 0.5 * K.grav * tArr, (dz / dh) * K.spd);
    } else {
      const d3 = Math.max(Math.hypot(dx, dy, dz), 0.01);
      b.vel.set((dx / d3) * K.spd, (dy / d3) * K.spd, (dz / d3) * K.spd);
    }
    b.active = true; b.life = 5; b.dmg = e.dmg; b.grav = K.grav; b.kind = K; b.trailT = 0;
    b.mesh.material = K.mat;
    b.mesh.scale.set(K.scale, K.scale, K.scale * K.long);
    b.mesh.position.set(ox, oy, oz);
    _tv.set(ox + b.vel.x, oy + b.vel.y, oz + b.vel.z);
    b.mesh.lookAt(_tv);
    b.mesh.visible = true;
    sfx(R.bolt === 'arrow' ? 'bowShoot' : 'fireCast');
  }

  function updateBolts(dt) {
    const p = g.player;
    for (let i = 0; i < BOLT_N; i++) {
      const b = bolts[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = false; continue; }
      b.vel.y -= b.grav * dt;
      const m = b.mesh.position;
      m.x += b.vel.x * dt; m.y += b.vel.y * dt; m.z += b.vel.z * dt;
      _tv.set(m.x + b.vel.x, m.y + b.vel.y, m.z + b.vel.z);
      b.mesh.lookAt(_tv);
      if (b.kind.trail) {
        b.trailT -= dt;
        if (b.trailT <= 0) {
          b.trailT = 0.05;
          emitBurst(m.x, m.y, m.z, 1, b.kind.trail[0], b.kind.trail[1], b.kind.trail[2], 1);
        }
      }
      // player hit
      if (p && p.stats.hp > 0) {
        const px = p.position.x - m.x, py = (p.position.y + 1.0) - m.y, pz = p.position.z - m.z;
        if (px * px + py * py + pz * pz < 1.25) {
          let res = null;
          if (g.combat && g.combat.tryBlock) res = g.combat.tryBlock(b.dmg);
          if (!res || (!res.blocked && !res.parried)) p.damage(b.dmg, m);
          if (b.kind.trail) emitBurst(m.x, m.y, m.z, 6, b.kind.trail[0], b.kind.trail[1], b.kind.trail[2], 1);
          b.active = false; b.mesh.visible = false;
          continue;
        }
      }
      // terrain hit
      if (m.y <= terrainHeight(m.x, m.z) + 0.1) {
        if (b.kind.trail) emitBurst(m.x, m.y + 0.2, m.z, 5, b.kind.trail[0], b.kind.trail[1], b.kind.trail[2], 1);
        b.active = false; b.mesh.visible = false;
      }
    }
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
      teleT: T.teleT || TELEGRAPH_T, strikeT: T.strikeT || STRIKE_T,
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
      boss: !!(spawner && spawner.boss) || type === 'drake' || type === 'barrowlord' ||
            type === 'morvane' || type === 'troll',
      isVargr: type === 'vargr',
      spawner: spawner || null,
      summoned: false, taunted: false,
      holder,
      // animation bookkeeping
      animState: '', atkIdx: -1, hitTog: false, blockHit: false,
      lodAcc: 0, frameC: (Math.random() * 4) | 0,
      // wave-2 behaviors
      ranged: RANGED[type] || null,
      hover: type === 'wraith', hoverPh: Math.random() * 6.28,
      drains: type === 'thrall' || type === 'morvane',
      dawnFade: !!T.dawnFade,
      castMove: type === 'witch',
      dodgeT: 1.2 + Math.random() * 2, dodgeDir: 1,
      blinkT: 3 + Math.random() * 3, blinkDone: false,
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
    const gp = holder.root;
    gp.position.set(x, y, z);
    gp.rotation.set(0, e.yaw, 0);
    gp.scale.setScalar(1);
    gp.visible = true;
    holder.deathPlayed = false;
    if (holder.mixer) { holder.mixer.stopAllAction(); holder.cur = null; holder.curName = ''; }
    const shadowD = type === 'drake' ? 8 : type === 'troll' ? 3.4 :
      type === 'barrowlord' ? 3 : e.bodyR * 2.6;
    holder.shadow.scale.set(shadowD, shadowD, 1);
    holder.shadow.visible = true;
    e.shadowD = shadowD;
    if (spawner) spawner.enemy = e;
    list.push(e);
    return e;
  }

  function refreshVargrScars(e) {
    // Deepening red scar-glow per nemesis win (capped at 3) on the rig
    applyVargrLook(e.holder, Math.min(g.flags.vargrWins | 0, 3));
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
    if (e.type === 'morvane') {
      events.emit('spawnLoot', { pos: { x: p.x - 0.4, y: p.y, z: p.z - 0.3 }, kind: 'item', amount: 1, itemId: 'bloodseal' });
    }
    if (e.type === 'troll') {
      events.emit('spawnLoot', { pos: { x: p.x - 0.5, y: p.y, z: p.z - 0.4 }, kind: 'item', amount: 1, itemId: 'trollheart' });
    }
  }

  function kill(e) {
    e.alive = false; e.dead = true; e.aggro = false;
    e.state = 'dead'; e.deadT = 0;
    if (e.spawner) {
      const night = isNightFrac(g.time.dayFrac);
      e.spawner.respawnAt = g.time.elapsed + (e.spawner.nightRespawn && night ? NIGHT_RESPAWN_T : RESPAWN_T);
      if (e.boss || e.isVargr || e.spawner.deadFlag) e.spawner.permaDead = true; // bosses & flagged uniques stay dead
    }
    if (e.type === 'drake') { bossState.drake.dead = true; bossState.drake.hp = 0; sfx('drakeRoar'); }
    if (e.type === 'barrowlord') { bossState.barrowlord.dead = true; bossState.barrowlord.hp = 0; }
    if (e.isVargr) g.flags.vargrDead = true;
    if (e.type === 'morvane') g.flags.morvaneDead = true;
    if (e.type === 'troll') g.flags.trollDead = true;
    if (e.type === 'witch') g.flags.witchDead = true;
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
      // wraiths are incorporeal to projectile-sized point tests: arrows and
      // fireball bodies (r ≤ 1.2) sail straight through — AoE still connects
      if (e.hover && r <= 1.2) continue;
      const cx = e.pos.x - pos.x;
      const cy = e.pos.y + e.height * 0.5 - pos.y;
      const cz = e.pos.z - pos.z;
      if (Math.hypot(cx, cy, cz) <= r + e.bodyR) _pts.push(e);
    }
    return _pts;
  }

  function damage(e, amount, dir, opts) {
    if (!e || e.dead || !e.alive) return;
    // Wraith: arrow-immune, fire-weak
    if (e.type === 'wraith') {
      if (opts && opts.kind === 'arrow') {
        if (!g.flags.wraithHint) {
          g.flags.wraithHint = true;
          events.emit('notify', { text: 'Arrows pass through the wraith', sub: 'Fire will burn what steel cannot touch.' });
        }
        return;
      }
      if (opts && (opts.kind === 'fire' || opts.heavy)) amount *= 1.6; // flame (and committed blows) rend spirit
    }
    if (e.state === 'guard') { amount *= 0.35; e.blockHit = true; sfx('block'); }
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
    // Morvane calls his thralls from the graves at half hp
    if (e.type === 'morvane' && !e.summoned && e.hp <= e.maxHp * 0.5 && e.hp > 0) {
      e.summoned = true;
      startAggro(spawnEnemy('thrall', e.pos.x + 2.4, e.pos.z + 1.2, null), true);
      startAggro(spawnEnemy('thrall', e.pos.x - 2.4, e.pos.z - 1.2, null), true);
      emitBurst(e.pos.x, e.pos.y + 1.2, e.pos.z, 14, 0.8, 0.1, 0.2, 1);
      sfx('fireCast');
      events.emit('notify', { text: 'Morvane calls to the graves', sub: 'His thralls rise.' });
    }
    if (e.hp <= 0) { kill(e); return; }
    // Morvane blinks away from punishment sometimes
    if (e.type === 'morvane' && e.aggro && e.blinkT < 2 && Math.random() < 0.3 &&
        e.state !== 'blink' && e.state !== 'telegraph' && e.state !== 'strike') {
      beginBlink(e);
    }
    // Getting hit always aggros (pack too), even without LOS
    if (!e.aggro && e.state !== 'flee') startAggro(e, true);
    // Flinch — a heavy hit or parry interrupts the windup, light hits don't
    if (e.state === 'telegraph') {
      if ((opts && opts.heavy) || (opts && opts.parried)) { e.state = 'flinch'; e.stateT = 0; }
    } else if (e.state !== 'strike' && e.state !== 'stagger' && e.state !== 'dead' &&
               e.state !== 'blink' && !e.fly) {
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

  // Sight-based aggro gates: the witch stays neutral until the quest turns
  // her hostile (damage always provokes); the troll stands down once paid.
  function canSightAggro(e) {
    if (e.type === 'witch') return !!g.flags.witchHostile;
    if (e.type === 'troll') return !g.flags.trollPaid;
    return true;
  }

  // Effective sight radius: night bonus ×1.6, sneaking shrinks it via the
  // shadow skill (g.rpg mult 'sneakDetect')
  function sightOf(e) {
    let s = e.sightR * (night ? 1.6 : 1);
    if (g.player.sneaking) s *= 0.6 * (g.rpg && g.rpg.mult ? g.rpg.mult('sneakDetect') : 1);
    return s;
  }

  function startAggro(e, silent) {
    if (e.aggro || e.dead) return;
    e.aggro = true;
    if (e.state !== 'flinch' && e.state !== 'stagger') { e.state = 'chase'; e.stateT = 0; }
    const t = g.time.elapsed;
    if ((e.type === 'wolf' || e.type === 'werewolf') && t - lastHowl > 4) { lastHowl = t; sfx('wolfHowl'); }
    else if ((e.type === 'goblin' || e.type === 'witch') && t - lastCackle > 3) { lastCackle = t; sfx('goblinCackle'); }
    else if (e.type === 'skeleton' || e.type === 'skelarcher') sfx('skeletonRattle');
    else if (e.type === 'drake' && !e.roared) { e.roared = true; sfx('drakeRoar'); }
    else if (e.type === 'troll') sfx('swingHeavy');
    if (e.isVargr && !e.taunted && (g.flags.vargrWins | 0) > 0) {
      e.taunted = true;
      events.emit('notify', { text: 'Vargr Redfang remembers you', sub: 'His scars have made him stronger.' });
    }
    if (e.type === 'wraith' && !g.flags.wraithHint) {
      g.flags.wraithHint = true;
      events.emit('notify', { text: 'The wraith shimmers between worlds', sub: 'Arrows pass through it — fire burns spirit.' });
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
    const anchored = e.state === 'idle' || e.state === 'dead' ||
      (e.state === 'telegraph' && !e.castMove) ||
      e.state === 'stagger' || e.state === 'flinch' || e.state === 'guard' || e.state === 'blink';
    if (anchored) {
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
      if (e.hover) {
        // wraiths drift above the ground on a slow sine — never clamped
        e.hoverPh += dt * 1.7;
        const ty = gh + 0.85 + Math.sin(e.hoverPh) * 0.4;
        e.pos.y += (ty - e.pos.y) * Math.min(1, 5 * dt);
      } else {
        e.pos.y = gh; // terrain-following
      }
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
    // Vampires drain: a landed bite feeds them
    if (e.drains) e.hp = Math.min(e.maxHp, e.hp + e.dmg * 0.7);
    lastHitter = e;
    lastHitT = g.time.elapsed;
  }

  // Troll ground-slam: radial dust ring + AoE damage + heavy knockback
  function doSlam(e) {
    const p = g.player;
    const ix = e.pos.x + Math.sin(e.yaw) * 2.0;
    const iz = e.pos.z + Math.cos(e.yaw) * 2.0;
    const iy = terrainHeight(ix, iz);
    emitBurst(ix, iy + 0.4, iz, 26, 0.62, 0.55, 0.44, 0);
    sfx('thunder');
    if (g.player.addShake) g.player.addShake(0.5);
    if (p.stats.hp <= 0) return;
    const d = Math.hypot(p.position.x - ix, p.position.z - iz);
    if (d > 5.2) return;
    let res = null;
    if (g.combat && g.combat.tryBlock) res = g.combat.tryBlock(e.dmg);
    if (res && res.parried) { stagger(e); return; }
    // knockback lands even through a block — the mountain does not care
    const nx = d > 0.01 ? (p.position.x - ix) / d : Math.sin(e.yaw);
    const nz = d > 0.01 ? (p.position.z - iz) / d : Math.cos(e.yaw);
    if (p.velocity) {
      p.velocity.x += nx * 13;
      p.velocity.z += nz * 13;
      p.velocity.y = Math.max(p.velocity.y, 5.5);
    }
    if (!(res && res.blocked)) {
      p.damage(e.dmg, e.pos);
      lastHitter = e;
      lastHitT = g.time.elapsed;
    }
    if (g.player.addShake) g.player.addShake(0.75);
  }

  // Morvane's teleport-blink: collapse in crimson mist, reappear 6u away
  function beginBlink(e) {
    e.state = 'blink'; e.stateT = 0;
    e.blinkDone = false;
    e.blinkT = 5 + Math.random() * 3;
    emitBurst(e.pos.x, e.pos.y + 1.1, e.pos.z, 10, 0.8, 0.1, 0.2, 1);
    sfx('fireCast');
  }
  function doBlinkJump(e) {
    const p = g.player.position;
    for (let tries = 0; tries < 4; tries++) {
      const a = Math.random() * Math.PI * 2;
      const nx = p.x + Math.sin(a) * 6;
      const nz = p.z + Math.cos(a) * 6;
      const nh = terrainHeight(nx, nz);
      if (nh > WATER_LEVEL - 0.5) {
        e.pos.set(nx, nh, nz);
        e.vel.set(0, 0, 0);
        break;
      }
    }
    emitBurst(e.pos.x, e.pos.y + 1.1, e.pos.z, 14, 0.8, 0.1, 0.2, 1);
  }

  // -------------------------------------------------------------------------
  // Grounded state machine (all types except flying drake)
  // -------------------------------------------------------------------------
  function updateGrounded(e, dt, t, pd) {
    const p = g.player;
    const sight = sightOf(e);
    e.cooldown -= dt;
    e.stateT += dt;
    const R = e.ranged;

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
        if (pd < sight && canSightAggro(e) && losClear(e)) startAggro(e, false);
        break;
      }
      case 'wander': {
        moveToward(e, e.wanderX, e.wanderZ, e.speed * 0.42, dt, true);
        if (Math.hypot(e.wanderX - e.pos.x, e.wanderZ - e.pos.z) < 1.2 || e.stateT > 6) {
          e.state = 'idle'; e.stateT = 0; e.wanderT = 1.5 + e.seed * 4;
        }
        if (pd < sight && canSightAggro(e) && losClear(e)) startAggro(e, false);
        break;
      }
      case 'chase': {
        const dr = e.type === 'drake' ? DRAKE_DEAGGRO_R : DEAGGRO_R;
        if (pd > dr || p.stats.hp <= 0) { e.aggro = false; e.state = 'return'; e.stateT = 0; break; }
        if (R) {
          // ranged: hold the band, back off when crowded, fire when clear
          if (pd < R.min) {
            const ax = e.pos.x + (e.pos.x - p.position.x);
            const az = e.pos.z + (e.pos.z - p.position.z);
            moveToward(e, ax, az, e.speed, dt, false);
          } else if (pd > R.max) {
            moveToward(e, p.position.x, p.position.z, e.speed, dt, false);
          } else {
            // slow strafing drift while holding range
            e.orbitA += dt * 0.5 * e.orbitDir;
            moveToward(e, p.position.x + Math.cos(e.orbitA) * pd, p.position.z + Math.sin(e.orbitA) * pd, e.speed * 0.4, dt, false);
          }
          turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 7, dt);
          if (e.cooldown <= 0 && pd > R.min * 0.5 && pd < R.max + 3 && losClear(e)) {
            e.state = 'telegraph'; e.stateT = 0;
            sfx(e.type === 'skelarcher' ? 'bowDraw' : 'fireCast');
          }
          break;
        }
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
        // vampire thralls sidestep in a blur between closes
        if (e.type === 'thrall' && pd < 8 && pd > 2.2) {
          e.dodgeT -= dt;
          if (e.dodgeT <= 0) {
            e.dodgeT = 1.6 + e.seed * 2.2;
            e.dodgeDir = Math.random() < 0.5 ? 1 : -1;
            e.state = 'dodge'; e.stateT = 0;
            const inv = 1 / Math.max(pd, 0.01);
            e.vel.x += -(p.position.z - e.pos.z) * inv * 10 * e.dodgeDir;
            e.vel.z += (p.position.x - e.pos.x) * inv * 10 * e.dodgeDir;
            break;
          }
        }
        // Morvane blinks through the fight
        if (e.type === 'morvane') {
          e.blinkT -= dt;
          if (e.blinkT <= 0 && pd < 16) { beginBlink(e); break; }
        }
        // bandits (and Vargr) raise their blade sometimes
        if ((e.type === 'bandit' || e.isVargr) && e.cooldown > 0.4 && pd < 5 &&
            hash2((t * 10) | 0, e.spawner ? e.spawner.id : 5, 23) < (e.isVargr ? 0.09 : 0.06)) {
          e.state = 'guard'; e.stateT = 0;
          break;
        }
        if (pd < e.reach + 0.4 && e.cooldown <= 0) {
          e.state = 'telegraph'; e.stateT = 0;
          sfx(e.type === 'barrowlord' || e.type === 'drake' || e.type === 'troll' ? 'swingHeavy' : 'swing'); // audible windup cue
        }
        // combat vocals
        e.vocalT -= dt;
        if (e.vocalT <= 0) {
          e.vocalT = 5 + e.seed * 6;
          if (e.type === 'goblin') sfx('goblinCackle');
          else if (e.type === 'skeleton' || e.type === 'skelarcher') sfx('skeletonRattle');
          else if (e.type === 'werewolf') sfx('wolfHowl');
          else if (e.type === 'witch') sfx('goblinCackle');
        }
        break;
      }
      case 'guard': {
        turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 8, dt);
        if (e.stateT >= GUARD_T) { e.state = 'chase'; e.stateT = 0; }
        break;
      }
      case 'telegraph': {
        // readable windup (0.55s default, 1.0s troll): weapon rises, no closing
        turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 5, dt);
        if (e.castMove) {
          // Grimhilde drifts backwards while her hex gathers
          const ax = e.pos.x + (e.pos.x - p.position.x);
          const az = e.pos.z + (e.pos.z - p.position.z);
          moveToward(e, ax, az, e.speed * 0.55, dt, false);
        }
        if (e.stateT >= e.teleT) { e.state = 'strike'; e.stateT = 0; e.hitApplied = false; }
        break;
      }
      case 'strike': {
        if (e.ranged) {
          if (!e.hitApplied && e.stateT >= STRIKE_HIT_T) {
            e.hitApplied = true;
            fireBolt(e, e.ranged);
          }
          if (e.stateT >= e.strikeT) {
            e.state = 'chase'; e.stateT = 0;
            e.cooldown = e.atkCd * (0.85 + e.seed * 0.4);
          }
          break;
        }
        if (e.type === 'troll') {
          // the slam: no lunge, the earth answers instead
          if (!e.hitApplied && e.stateT >= 0.18) { e.hitApplied = true; doSlam(e); }
          if (e.stateT >= e.strikeT) {
            e.state = 'chase'; e.stateT = 0;
            e.cooldown = e.atkCd * (0.85 + e.seed * 0.4);
          }
          break;
        }
        if (e.stateT < 0.16) { // lunge
          e.pos.x += Math.sin(e.yaw) * e.speed * 1.9 * dt;
          e.pos.z += Math.cos(e.yaw) * e.speed * 1.9 * dt;
        }
        if (!e.hitApplied && e.stateT >= STRIKE_HIT_T) {
          e.hitApplied = true;
          tryStrikeHit(e);
        }
        if (e.stateT >= e.strikeT) {
          e.state = 'chase'; e.stateT = 0;
          e.cooldown = e.atkCd * (0.85 + e.seed * 0.4);
        }
        break;
      }
      case 'dodge': {
        // thrall blur-step: brief burst of lateral velocity, then re-engage
        turnTo(e, Math.atan2(p.position.x - e.pos.x, p.position.z - e.pos.z), 6, dt);
        if (e.stateT >= DODGE_T) { e.state = e.aggro ? 'chase' : 'idle'; e.stateT = 0; }
        break;
      }
      case 'blink': {
        if (!e.blinkDone && e.stateT >= BLINK_T * 0.45) {
          e.blinkDone = true;
          doBlinkJump(e);
        }
        if (e.stateT >= BLINK_T) { e.state = e.aggro ? 'chase' : 'idle'; e.stateT = 0; }
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
        if (pd < sight * 0.8 && e.type !== 'wolf' && canSightAggro(e) && losClear(e)) startAggro(e, true);
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
  // Animation clip selection — mixer state machine driven by e.state.
  // Attack/cast clips are time-stretched so the clip's windup occupies the
  // telegraph and the swing lands at the strike moment (feet don't slide:
  // locomotion clips run at actualSpeed/referenceSpeed).
  // -------------------------------------------------------------------------
  function driveAnim(e, h) {
    const spec = h.spec;
    const entered = e.state !== e.animState;
    if (entered) e.animState = e.state;
    switch (e.state) {
      case 'telegraph':
      case 'strike': {
        const total = e.teleT + e.strikeT;
        if (spec.cast) {
          if (entered && e.state === 'telegraph') {
            playOnce(h, spec.cast, 0.12, clipDur(h, spec.cast) / Math.max(total, 0.3));
          }
          break;
        }
        if (spec.attacks) {
          if (entered && e.state === 'telegraph') {
            e.atkIdx = (e.atkIdx + 1) % spec.attacks.length;
            const nm = spec.attacks[e.atkIdx];
            playOnce(h, nm, 0.1, clipDur(h, nm) / Math.max(total, 0.3));
          }
          break;
        }
        // fox pounce: crouch (root tilt) through telegraph, burst of Run on strike
        if (e.state === 'telegraph') play(h, spec.locoIdle, 0.15, 1);
        else play(h, spec.locoRun, 0.08, 2.0);
        break;
      }
      case 'guard': {
        if (e.blockHit && h.clips.Block_Hit) {
          e.blockHit = false;
          playOnce(h, 'Block_Hit', 0.06, clipDur(h, 'Block_Hit') / 0.4);
        } else if (h.curName !== 'Block_Hit' || !h.cur || !h.cur.isRunning()) {
          play(h, 'Blocking', 0.15, 1);
        }
        break;
      }
      case 'flinch': {
        if (entered) {
          e.hitTog = !e.hitTog;
          const nm = e.hitTog && h.clips.Hit_B ? 'Hit_B' : 'Hit_A';
          if (h.clips[nm]) playOnce(h, nm, 0.08, clipDur(h, nm) / 0.38);
          else play(h, spec.locoIdle, 0.1, 1);
        }
        break;
      }
      case 'stagger': {
        if (entered && h.clips.Hit_B) playOnce(h, 'Hit_B', 0.1, clipDur(h, 'Hit_B') / 0.85);
        else if (!entered && h.cur && !h.cur.isRunning()) play(h, spec.locoIdle, 0.25, 1);
        break;
      }
      case 'dodge': {
        if (entered) {
          const nm = e.dodgeDir > 0 ? 'Dodge_Right' : 'Dodge_Left';
          if (h.clips[nm]) playOnce(h, nm, 0.06, clipDur(h, nm) / (DODGE_T + 0.05));
        }
        break;
      }
      case 'blink': {
        if (entered && h.clips.Spellcast_Raise) {
          playOnce(h, 'Spellcast_Raise', 0.06, clipDur(h, 'Spellcast_Raise') / (BLINK_T + 0.1));
        }
        break;
      }
      case 'dead': {
        if (!h.deathPlayed) {
          const nm = e.seed > 0.5 && h.clips.Death_B ? 'Death_B' : 'Death_A';
          if (h.clips[nm]) { playOnce(h, nm, 0.1, clipDur(h, nm) / 1.1); h.deathPlayed = true; }
        }
        break;
      }
      default: {
        // locomotion: idle / wander / chase / flee / return / guard-walk
        if (spec.loco) { // wraith: perpetual eerie weaving, drifting on the hover
          play(h, spec.loco, 0.3, 0.85);
          break;
        }
        const spd = e.animSpd;
        if (spd > 0.35) {
          if (spd > 3.1 && h.clips[spec.locoRun]) {
            play(h, spec.locoRun, 0.2, clamp(spd / REF_RUN, 0.5, 2.2) * (spec.runTs || 1));
          } else {
            play(h, spec.locoWalk, 0.2, clamp(spd / REF_WALK, 0.4, 2.4));
          }
        } else {
          play(h, spec.locoIdle, 0.3, 1);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame visual update: root transform, mixer (with distance LOD),
  // special tilts (fox pounce, werewolf hunch fallback), drake procedural pose
  // -------------------------------------------------------------------------
  function animate(e, dt, t, pd) {
    const h = e.holder;
    const gp = h.root;
    const spd = Math.hypot(e.vel.x, e.vel.z);
    e.animSpd += (spd - e.animSpd) * Math.min(1, 10 * dt);

    gp.position.copy(e.pos);
    let tiltX = 0, tiltZ = 0;

    if (e.type === 'drake') { animateDrake(e, dt, t); return; }

    if (e.state === 'dead') {
      // rigged chars fall via Death clip; clipless (fox) tip over procedurally
      if (h.mixer) {
        driveAnim(e, h);
        h.mixer.update(dt);
      }
      const noClip = !h.clips || (!h.clips.Death_A && !h.clips.Death_B);
      if (noClip) {
        const f = Math.min(1, e.deadT / 0.5);
        tiltZ = e.fallDir * f * 1.5;
      }
      if (e.hover && e.pos.y > e.groundY) e.pos.y = Math.max(e.groundY, e.pos.y - 3 * dt); // wraith settles
      gp.rotation.set(0, e.yaw, tiltZ);
      if (e.deadT > SINK_AFTER) gp.position.y -= (e.deadT - SINK_AFTER) / SINK_T * (e.height + 0.6);
      if (gp.scale.x !== 1) gp.scale.setScalar(1);
      return;
    }

    // fox pounce telegraph reads through the root (no attack clips on the fox)
    if (h.spec && h.spec.simple) {
      if (e.state === 'telegraph') tiltX = -0.3 * (e.stateT / e.teleT);
      else if (e.state === 'strike') tiltX = 0.4 * (1 - e.stateT / e.strikeT);
      else if (e.state === 'flinch') tiltX = -0.3 * (1 - e.stateT / FLINCH_T);
      else if (e.state === 'stagger') tiltZ = Math.sin(e.stateT * 9) * 0.28 * (1 - e.stateT / STAGGER_T);
    }
    // werewolf hunch fallback when no spine bone was found
    if (h.spec && h.spec.hunch && h.rig && !h.spine) tiltX += 0.35;

    // Morvane blink: collapse to mist and re-form
    if (e.state === 'blink') {
      const f = e.stateT / BLINK_T;
      const s = f < 0.4 ? 1 - (f / 0.4) * 0.96 : f < 0.55 ? 0.04 : 0.04 + ((f - 0.55) / 0.45) * 0.96;
      gp.scale.setScalar(clamp(s, 0.04, 1));
    } else if (gp.scale.x !== 1) {
      gp.scale.setScalar(1);
    }

    gp.rotation.set(tiltX, e.yaw, tiltZ);

    if (h.mixer) {
      driveAnim(e, h);
      // LOD: full rate <40u, half to 80u, quarter beyond — time accumulates
      e.lodAcc += dt;
      e.frameC++;
      const step = pd > 80 ? 4 : pd > 40 ? 2 : 1;
      if (step === 1 || (e.frameC % step) === 0) {
        h.mixer.update(e.lodAcc);
        e.lodAcc = 0;
        if (h.spine) h.spine.rotation.x = h.spineBase + 0.55; // hunched lope (post-mixer)
      }
    }
  }

  // Drake procedural pose: wing flaps, neck/tail sway, jaw + throat glow
  function animateDrake(e, dt, t) {
    const h = e.holder;
    const P = h.parts;
    const gp = h.root;
    const breathe = Math.sin(t * 2.2 + e.seed * 9) * 0.03;
    gp.position.copy(e.pos);

    if (e.state === 'dead') {
      const f = Math.min(1, e.deadT / 0.5);
      gp.rotation.set(0, e.yaw, e.fallDir * f * 1.5);
      if (e.deadT > SINK_AFTER) gp.position.y -= (e.deadT - SINK_AFTER) / SINK_T * (e.height + 0.6);
      M.drakeThroat.emissiveIntensity = 0;
      return;
    }

    let tiltX = 0, tiltZ = 0;
    if (e.state === 'telegraph') tiltX = -0.4 * (e.stateT / e.teleT);
    else if (e.state === 'strike') tiltX = 0.45 * (1 - e.stateT / e.strikeT);
    else if (e.state === 'stagger') tiltZ = Math.sin(e.stateT * 9) * 0.28 * (1 - e.stateT / STAGGER_T);

    const breath = e.fly && e.dstate === 'breath';
    const flap = e.fly ? (breath ? 4.5 : 6.5) : 1.2;
    const amp = e.fly ? 0.55 : 0.1;
    const w = Math.sin(t * flap) * amp;
    P.wingL.rotation.z = w + (e.fly ? 0.15 : 1.05);
    P.wingR.rotation.z = -w - (e.fly ? 0.15 : 1.05);
    P.tail.rotation.y = Math.sin(t * 2.1) * 0.25;
    P.tail.rotation.x = Math.sin(t * 1.4 + 2) * 0.08;
    P.neck.rotation.x = breath ? 0.35 :
      e.state === 'telegraph' ? -0.5 * (e.stateT / e.teleT) :
      e.state === 'strike' ? 0.5 : Math.sin(t * 1.3) * 0.06;
    P.body.position.y = P.body.userData.by + breathe * 2;
    // jaw gapes for fire and grounded strikes
    const jawT = (breath || e.state === 'strike') ? 0.55 : e.state === 'telegraph' ? 0.35 : 0.06;
    P.jaw.rotation.x += (jawT - P.jaw.rotation.x) * Math.min(1, 8 * dt);
    // throat ignites before/through the flame; eyes smolder harder in combat
    const glowT = breath ? 2.4 : (e.state === 'telegraph' ? 1.0 : 0.0);
    M.drakeThroat.emissiveIntensity += (glowT - M.drakeThroat.emissiveIntensity) * Math.min(1, 6 * dt);
    M.drakeEye.emissiveIntensity = e.aggro ? 2.6 + Math.sin(t * 11) * 0.5 : 1.6;
    if (e.fly) tiltX = clamp(-e.vel.y * 0.04, -0.45, 0.45);

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
  // Village guards — 2 knights at the gates, purely atmospheric (no combat AI,
  // not in the enemy list): Idle/Walking_A patrol along the road mouths
  // -------------------------------------------------------------------------
  const guards = [];
  function addGuard(ax, az, bx, bz) {
    const holder = {
      type: 'guard', root: new THREE.Group(), rig: null, mixer: null, clips: null,
      actions: null, cur: null, curName: '', spec: SPEC.guard, spine: null,
    };
    g.scene.add(holder.root);
    requestRig(holder, 'guard');
    const shadow = new THREE.Mesh(GEO.plane, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    shadow.scale.set(1.5, 1.5, 1);
    g.scene.add(shadow);
    const gd = {
      holder, shadow, ax, az, bx, bz, dir: 1,
      x: ax, z: az, yaw: 0, pauseT: 1 + Math.random() * 2, frameC: (Math.random() * 4) | 0, lodAcc: 0,
    };
    holder.root.position.set(ax, terrainHeight(ax, az), az);
    shadow.position.set(ax, terrainHeight(ax, az) + 0.06, az);
    guards.push(gd);
    return gd;
  }
  // South gate (spawn approach) + north road mouth
  addGuard(-3, 60, 3, 63);
  addGuard(-7, -54, -3, -62);

  const GUARD_SPD = 1.5;
  function updateGuards(dt) {
    const p = g.player.position;
    for (let i = 0; i < guards.length; i++) {
      const gd = guards[i];
      const h = gd.holder;
      const pd = Math.hypot(p.x - gd.x, p.z - gd.z);
      if (pd > 140) continue; // out of sight, skip entirely
      let walking = false;
      if (gd.pauseT > 0) {
        gd.pauseT -= dt;
      } else {
        const tx = gd.dir > 0 ? gd.bx : gd.ax;
        const tz = gd.dir > 0 ? gd.bz : gd.az;
        let dx = tx - gd.x, dz = tz - gd.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          gd.dir = -gd.dir;
          gd.pauseT = 2.5 + Math.random() * 4;
        } else {
          dx /= d; dz /= d;
          gd.x += dx * GUARD_SPD * dt;
          gd.z += dz * GUARD_SPD * dt;
          const want = Math.atan2(dx, dz);
          let dy = want - gd.yaw;
          dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          gd.yaw += dy * Math.min(1, 6 * dt);
          walking = true;
        }
      }
      const y = terrainHeight(gd.x, gd.z);
      h.root.position.set(gd.x, y, gd.z);
      h.root.rotation.set(0, gd.yaw, 0);
      gd.shadow.position.set(gd.x, y + 0.06, gd.z);
      if (h.mixer) {
        if (walking) play(h, 'Walking_A', 0.25, GUARD_SPD / REF_WALK);
        else play(h, 'Idle', 0.3, 1);
        gd.lodAcc += dt;
        gd.frameC++;
        const step = pd > 80 ? 4 : pd > 40 ? 2 : 1;
        if (step === 1 || (gd.frameC % step) === 0) {
          h.mixer.update(gd.lodAcc);
          gd.lodAcc = 0;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Spawn scan (throttled) + dynamic night-forest werewolves
  // -------------------------------------------------------------------------
  let scanT = 0;
  let wwNextT = 30;       // next werewolf spawn attempt time
  let dawnNotified = false;
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
      if (s.deadFlag && g.flags[s.deadFlag]) { s.permaDead = true; continue; }
      if (s.nightOnly && !night) continue;
      if (t < s.respawnAt) continue;
      const d = dist2d(s.x, s.z, p.x, p.z);
      const maxR = s.type === 'drake' ? 300 : SPAWN_R;
      if (d > maxR || (d < 26 && !s.boss && !s.isVargr)) continue;
      if (!s.boss && !s.isVargr && active >= ACTIVE_CAP) continue;
      spawnEnemy(s.type, s.x, s.z, s);
      if (!s.boss && !s.isVargr) active++;
    }
    // Werewolves stalk the night forest (2 max, spawned around the player)
    if (night) {
      dawnNotified = false;
      if (t >= wwNextT && active < ACTIVE_CAP && countAlive('werewolf') < 2) {
        const ph = terrainHeight(p.x, p.z);
        if (biomeAt(p.x, p.z, ph) === BIOME.FOREST && dist2d(p.x, p.z, 0, 0) > 110) {
          const a = Math.random() * Math.PI * 2;
          const r = 40 + Math.random() * 18;
          const wx = p.x + Math.sin(a) * r, wz = p.z + Math.cos(a) * r;
          if (terrainHeight(wx, wz) > WATER_LEVEL + 1) {
            spawnEnemy('werewolf', wx, wz, null);
            sfx('wolfHowl');
            wwNextT = t + 24 + Math.random() * 20;
          } else {
            wwNextT = t + 4;
          }
        } else {
          wwNextT = t + 6;
        }
      }
    } else {
      // dawn: the beasts escape
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.type === 'werewolf' && e.alive) {
          despawn(e);
          if (!dawnNotified) {
            dawnNotified = true;
            events.emit('notify', { text: 'The beast escapes into the dawn...', sub: '' });
          }
        } else if (e.dawnFade && e.alive && !e.aggro) {
          despawn(e); // wraiths & vampires quietly fade with the night
        }
      }
      wwNextT = t + 10;
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

    // Boss bar: drake within 120u takes priority, then aggroed minibosses
    // (barrowlord, Morvane, the Stonebridge troll)
    let bbe = null;
    const p = g.player.position;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.type === 'drake' && dist2d(e.pos.x, e.pos.z, p.x, p.z) < 120) { bbe = e; break; }
      if (e.type === 'barrowlord' && e.aggro) bbe = e;
      if ((e.type === 'morvane' || e.type === 'troll') && e.aggro && !bbe) bbe = e;
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
        animate(e, dt, t, pd);
        updateBillboards(e, pd);
        if (e.deadT > SINK_AFTER + SINK_T) despawn(e);
        continue;
      }

      // Despawn wanderers that drift far behind (bosses persist)
      if (!e.boss && !e.isVargr && pd > DESPAWN_R) { despawn(e); continue; }

      if (e.type === 'drake') updateDrake(e, dt, t, pd);
      else updateGrounded(e, dt, t, pd);

      animate(e, dt, t, pd);
      updateBillboards(e, pd);
    }

    // Skeleton night rattle ambience
    if (night && t > nextRattle) {
      nextRattle = t + 6 + Math.random() * 8;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.alive && (e.type === 'skeleton' || e.type === 'skelarcher') &&
            dist2d(e.pos.x, e.pos.z, p.x, p.z) < 28) {
          sfx('skeletonRattle');
          break;
        }
      }
    }

    updateGuards(dt);
    updateFire(dt);
    updateBurst(dt);
    updateBolts(dt);
    updateGlobalState(t);
  }

  // -------------------------------------------------------------------------
  // Save / load: bosses + nemesis persistence (format unchanged; wave-2
  // uniques persist through g.flags, which save.js stores)
  // -------------------------------------------------------------------------
  function serialize() {
    return {
      drake: { dead: bossState.drake.dead, hp: Math.round(bossState.drake.hp) },
      barrowlord: { dead: bossState.barrowlord.dead, hp: Math.round(bossState.barrowlord.hp) },
      // vargrDead / vargrWins / morvaneDead / trollDead / witchDead live in
      // g.flags (saved by save.js)
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
    // Despawn any live uniques that the loaded state says are dead
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if ((e.type === 'drake' && bossState.drake.dead) ||
          (e.type === 'barrowlord' && bossState.barrowlord.dead) ||
          (e.spawner && e.spawner.deadFlag && g.flags[e.spawner.deadFlag])) {
        despawn(e);
      }
    }
  }

  return {
    update, list, spawnAt, queryHit, queryPoint, damage,
    countAlive, bossAlive, serialize, deserialize,
  };
}

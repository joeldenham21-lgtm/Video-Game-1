// ============================================================================
// ELDERFALL — explore.js (desktop-cinematic wave)
// Three traveler's tools, per NEXT-LEVEL.md:
//
//  · FAST-TRAVEL SIGNPOSTS — one carved low-poly signpost (post + three
//    direction fingers, single InstancedMesh) at each of the nine major
//    POIs. Interactable "Signpost — Travel" is enabled only once that place
//    is discovered and refuses service while aggroed enemies are within
//    30u. Travel = 0.5s fade to black → teleport to a safe landing by the
//    destination signpost → day advances by distance/3000 (min 0.01) →
//    fade back in. Position persists through the normal save path.
//
//  · HUNTER SENSES — V key (or double-tap on the compass strip, mobile):
//    a 4s pulse that desaturates/darkens the frame (backdrop-filter with a
//    clear radial center) and projects DOM pips over nearby interactables
//    (gold ✦, ≤30u), live enemies (faint red dots, ≤40u) and the active
//    hunt mark (red ☠, edge-clamped when off-screen). 8s cooldown after
//    the pulse ends; soft whoosh via g.audio.
//
//  · PHOTO MODE — P key or the pause-menu button (ui.js calls
//    g.explore.openPhoto()). Pauses the game, takes g.cameraLock='photo'
//    (player freezes, combat hides the viewmodel), stamps 'ef-photo' on
//    <body> so ui.css hides the whole HUD, and gives a free-fly camera:
//    WASD + Q/E down/up + drag-look, Shift fast. Sliders scrub time-of-day
//    (g.time.dayFrac — sky updates even while paused) and FOV (40–100).
//    Capture renders explicitly (postfx composer when present) right
//    before canvas.toBlob and downloads 'elderfall.png'. Exit restores
//    FOV, parks the camera back at the player's eye and releases the lock.
//
// Owns only self-injected DOM + its own scene objects. Reads (never edits)
// g.enemies.list / g.interactables / g.compassMarkers / g.flags.
// ============================================================================
import * as THREE from 'three';
import {
  POI, terrainHeight, clamp, dist2d, hash2, WATER_LEVEL,
} from './core.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const TRAVEL_FADE_OUT = 0.5;   // s, to black (per contract)
const TRAVEL_HOLD = 0.85;      // s, held black while world chunks rebuild
const TRAVEL_FADE_IN = 0.7;    // s, back to the world
const TRAVEL_BLOCK_R = 30;     // aggroed enemy within this radius blocks travel
const TRAVEL_DAY_DIV = 3000;   // dayFrac advance = dist / this (min 0.01)

const SENSE_T = 4;             // s, pulse duration
const SENSE_CD = 8;            // s, cooldown AFTER the pulse ends
const SENSE_INTER_R = 30;      // interactable pip radius
const SENSE_ENEMY_R = 40;      // enemy pip radius
const PIP_INTER_N = 14;        // pip pool sizes
const PIP_ENEMY_N = 18;

const PHOTO_SPEED = 13;        // u/s free-fly (Shift ×3.2)
const PHOTO_FAST = 3.2;
const PHOTO_RANGE = 170;       // max distance from entry point (world streaming
                               // is frozen while paused — stay where it's built)
const PHOTO_LOOK = 0.0034;     // rad per px drag

export function createExplore(g) {
  const ev = g.events;
  const notify = (text, sub) => ev.emit('notify', { text, sub });
  const sfx = (n) => { if (g.audio && g.audio.play) g.audio.play(n); };

  // --- preallocated scratch (zero per-frame allocations) ---------------------
  const _v = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _wish = new THREE.Vector3();

  // ==========================================================================
  // Destinations — the nine signposted places.
  // sx/sz = signpost spot, cx/cz = the POI it belongs to (landing faces it).
  // ==========================================================================
  // The Mirrormere dock is placed by the same deterministic shore scan
  // structures.js uses, so the signpost stands beside the real planks.
  function dockSpot() {
    const L = POI.lake;
    for (const a of [0.7, 2.6, 4.4, 5.5]) {
      if (terrainHeight(L.x + Math.cos(a) * 30, L.z + Math.sin(a) * 30) > WATER_LEVEL - 1) continue;
      let shoreR = -1;
      for (let r = 33; r < 320; r += 3) {
        if (terrainHeight(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r) > WATER_LEVEL + 0.5) { shoreR = r; break; }
      }
      if (shoreR < 0) continue;
      return {
        sx: L.x + Math.cos(a) * (shoreR + 6.0),
        sz: L.z + Math.sin(a) * (shoreR + 6.0),
        ax: Math.cos(a), az: Math.sin(a), // inland direction (away from water)
      };
    }
    return { sx: L.x + 60, sz: L.z, ax: 1, az: 0 }; // never in practice
  }
  const dock = dockSpot();

  const disc = () => g.flags.discovered || {};
  const DESTS = [
    { id: 'village', name: 'Emberhollow', glyph: '⌂', cx: 0, cz: 0, sx: 12, sz: 22, isDisc: () => !!disc().village },
    { id: 'ruins', name: 'Barrowdeep Ruins', glyph: '◆', cx: 620, cz: -420, sx: 590, sz: -386, isDisc: () => !!disc().ruins },
    { id: 'stones', name: 'The Wardstones', glyph: '◆', cx: -540, cz: -620, sx: -512, sz: -594, isDisc: () => !!disc().stones },
    { id: 'tower', name: 'Greywatch Tower', glyph: '◆', cx: 380, cz: 520, sx: 360, sz: 543, isDisc: () => !!disc().tower },
    { id: 'camp', name: 'Redfang Camp', glyph: '◆', cx: -620, cz: 180, sx: -586, sz: 209, isDisc: () => !!disc().camp },
    { id: 'shrine', name: 'Shrine of Aldric', glyph: '✦', cx: 260, cz: -180, sx: 273, sz: -167, isDisc: () => !!disc().shrine },
    { id: 'witchhut', name: 'The Witch Hut', glyph: '◆', cx: -260, cz: -520, sx: -242, sz: -502, isDisc: () => !!g.flags.spotHut },
    // the bridge itself spans open water — the sign stands on the dry west
    // bank where the causeway meets the Emberhollow road
    { id: 'stonebridge', name: 'Stonebridge', glyph: '◆', cx: 330, cz: -260, sx: 299, sz: -281, isDisc: () => !!g.flags.spotBridge },
    { id: 'dock', name: 'The Mirrormere Dock', glyph: '●', cx: POI.lake.x, cz: POI.lake.z, sx: dock.sx, sz: dock.sz, isDisc: () => !!(disc().lake || g.flags.spotDock) },
  ];

  // Landing spot: 2.4u from the signpost toward its POI (dock: inland instead,
  // toward-center would be open water). Always re-grounded on arrival.
  for (const d of DESTS) {
    let dx = d.cx - d.sx, dz = d.cz - d.sz;
    if (d.id === 'dock') { dx = dock.ax; dz = dock.az; }
    const l = Math.hypot(dx, dz) || 1;
    d.lx = d.sx + (dx / l) * 2.4;
    d.lz = d.sz + (dz / l) * 2.4;
    d.gy = terrainHeight(d.sx, d.sz);
  }

  // ==========================================================================
  // Signpost prop — one merged vertex-colored geometry, 9 instances.
  // ==========================================================================
  function buildSignGeometry() {
    const P = [], N = [], C = [];
    const col = new THREE.Color();
    let faceSeed = 0;
    // 8 box corners / 6 CCW faces (outward)
    const FACES = [
      [1, 2, 6, 5, 1, 0, 0], [4, 7, 3, 0, -1, 0, 0],
      [3, 7, 6, 2, 0, 1, 0], [0, 1, 5, 4, 0, -1, 0],
      [4, 5, 6, 7, 0, 0, 1], [1, 0, 3, 2, 0, 0, -1],
    ];
    const cor = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    function box(cx, cy, cz, sx, sy, sz, yaw, hex) {
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      for (const f of FACES) {
        faceSeed++;
        // rotated face normal
        const nx = f[4] * cs + f[6] * sn, ny = f[5], nz = -f[4] * sn + f[6] * cs;
        // carved-wood shading: lit tops, darker undersides, slight face jitter
        const sh = 0.78 + 0.30 * Math.max(0, ny) + 0.08 * Math.max(0, nx) +
          (hash2(faceSeed, 31) - 0.5) * 0.1;
        col.setHex(hex).multiplyScalar(sh);
        const idx = [0, 1, 2, 0, 2, 3];
        for (const k of idx) {
          const c = cor[f[k]];
          const lx = c[0] * hx, ly = c[1] * hy, lz = c[2] * hz;
          P.push(cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs);
          N.push(nx, ny, nz);
          C.push(col.r, col.g, col.b);
        }
      }
    }
    const WOOD_POST = 0x5f462a, WOOD_PLANK = 0x84653b, WOOD_CARVE = 0x3a2a16;
    // stone footing + post + cap
    box(0, 0.14, 0, 0.85, 0.28, 0.85, 0.35, 0x7d7668);
    box(0, 0.35, 0, 0.55, 0.18, 0.55, -0.2, 0x6f6a5c);
    box(0, 1.62, 0, 0.2, 2.7, 0.2, 0, WOOD_POST);
    box(0, 3.02, 0, 0.32, 0.13, 0.32, Math.PI / 4, WOOD_CARVE);
    // three direction fingers (finger 0 points along local +X)
    const FINGERS = [[2.68, 0], [2.34, 2.35], [2.0, -1.85]];
    for (const [fy, fyaw] of FINGERS) {
      const dx = Math.cos(fyaw), dz = -Math.sin(fyaw);
      box(dx * 0.52, fy, dz * 0.52, 1.2, 0.17, 0.075, fyaw, WOOD_PLANK);   // plank
      box(dx * 1.1, fy, dz * 1.1, 0.15, 0.17, 0.15, fyaw + Math.PI / 4, WOOD_PLANK); // pointed tip
      box(dx * 0.5, fy, dz * 0.5, 0.86, 0.055, 0.09, fyaw, WOOD_CARVE);   // carved groove
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    return geo;
  }

  {
    const geo = buildSignGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, DESTS.length);
    mesh.frustumCulled = false; // 9 instances spread across the whole map
    mesh.castShadow = !!g.quality.shadows;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s1 = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < DESTS.length; i++) {
      const d = DESTS[i];
      // finger 0 (local +X = (cosθ, 0, −sinθ)) points home: the village sign
      // points at Drakespire, every other sign points back to Emberhollow.
      const tx = d.id === 'village' ? POI.peak.x : 0;
      const tz = d.id === 'village' ? POI.peak.z : 0;
      const yaw = Math.atan2(-(tz - d.sz), tx - d.sx);
      q.setFromAxisAngle(up, yaw);
      m4.compose(_v.set(d.sx, d.gy, d.sz), q, s1);
      mesh.setMatrixAt(i, m4);
      g.colliders.push({ x: d.sx, z: d.sz, r: 0.42 });
    }
    mesh.instanceMatrix.needsUpdate = true;
    g.scene.add(mesh);
  }

  // ==========================================================================
  // CSS + DOM (self-injected, parchment/leather styling to match ui.js)
  // ==========================================================================
  const style = document.createElement('style');
  style.textContent = `
#ef-x-root{position:fixed;inset:0;pointer-events:none;z-index:44;
  font-family:Georgia,'Times New Roman',serif;color:#e8dcc0;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
#ef-x-root *{box-sizing:border-box;}
#ef-x-root .ef-rule{height:1px;margin:9px auto;width:82%;
  background:linear-gradient(90deg,transparent,#a3813f 28%,#d9b46a 50%,#a3813f 72%,transparent);}

/* ---------- fast-travel fade ---------- */
#ef-x-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;}

/* ---------- travel panel ---------- */
#ef-trv-dim{position:absolute;inset:0;background:rgba(5,4,2,.45);opacity:0;
  transition:opacity .2s ease;pointer-events:none;}
#ef-trv-dim.on{opacity:1;pointer-events:auto;}
#ef-trv{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.97);
  width:min(92vw,430px);max-height:min(84dvh,560px);overflow-y:auto;touch-action:pan-y;
  padding:18px 22px 20px;border-radius:10px;border:1px solid #a3813f;
  background:linear-gradient(160deg,#251b10,#160f08);opacity:0;pointer-events:none;
  box-shadow:0 12px 44px rgba(0,0,0,.7),inset 0 0 60px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,230,170,.14);
  transition:opacity .22s ease,transform .22s ease;}
#ef-trv.on{opacity:1;transform:translate(-50%,-50%) scale(1);pointer-events:auto;}
#ef-trv h2{font-weight:400;letter-spacing:.26em;text-align:center;color:#f2e6c6;
  font-size:20px;margin:2px 0 2px;}
#ef-trv .sub{text-align:center;font-style:italic;font-size:12.5px;color:#9a8a68;}
#ef-trv .x{position:absolute;top:10px;right:12px;width:30px;height:30px;display:flex;cursor:pointer;
  align-items:center;justify-content:center;color:#a3813f;font-size:18px;border-radius:6px;}
#ef-trv .x:hover{color:#ffd873;}
.ef-trow{display:flex;align-items:center;justify-content:space-between;width:100%;
  font-family:inherit;font-size:15px;color:#e6d5ac;cursor:pointer;text-align:left;
  background:rgba(217,180,106,.06);border:1px solid rgba(217,180,106,.3);border-radius:5px;
  padding:10px 12px;margin:7px 0;transition:background .12s ease,border-color .12s ease;}
.ef-trow:hover{background:rgba(217,180,106,.18);border-color:#d9b46a;}
.ef-trow .n{letter-spacing:.05em;}
.ef-trow .n .g{color:#d9b46a;margin-right:9px;}
.ef-trow .d{font-size:12px;color:#9a8a68;font-style:italic;white-space:nowrap;margin-left:10px;}
.ef-trow.here{opacity:.45;pointer-events:none;}
#ef-trv .none{font-style:italic;color:#84714a;font-size:13.5px;text-align:center;margin:14px 0 8px;}
#ef-trv .foot{text-align:center;font-size:11.5px;font-style:italic;color:#84714a;margin-top:10px;}

/* ---------- hunter senses ---------- */
#ef-sn-ov{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .4s ease;
  backdrop-filter:grayscale(.6) brightness(.8);-webkit-backdrop-filter:grayscale(.6) brightness(.8);
  -webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 11%,#000 44%);
  mask-image:radial-gradient(circle at 50% 50%,transparent 11%,#000 44%);
  background:radial-gradient(circle at 50% 50%,transparent 40%,rgba(30,55,90,.22) 100%);}
#ef-sn-ov.on{opacity:1;}
.ef-sn-pip{position:absolute;left:0;top:0;pointer-events:none;opacity:0;line-height:1;
  will-change:transform;transition:opacity .25s ease;}
.ef-sn-pip.g{color:#ffd873;font-size:16px;text-shadow:0 0 9px rgba(255,216,115,.95),0 1px 2px #000;}
.ef-sn-pip.e{width:9px;height:9px;border-radius:50%;background:rgba(255,64,44,.55);
  box-shadow:0 0 10px rgba(255,64,44,.7);}
.ef-sn-pip.h{color:#ff5040;font-size:24px;text-shadow:0 0 12px rgba(255,60,40,.95),0 1px 3px #000;}
#ef-sn-tap{position:absolute;top:calc(4px + env(safe-area-inset-top,0px));left:50%;
  transform:translateX(-50%);width:min(62vw,440px);height:40px;pointer-events:auto;touch-action:none;}
body.ef-photo #ef-sn-tap{display:none;}

/* ---------- photo mode ---------- */
#ef-ph{position:absolute;inset:0;display:none;}
#ef-ph.on{display:block;}
#ef-ph-catch{position:absolute;inset:0;pointer-events:auto;cursor:grab;touch-action:none;}
#ef-ph-hint{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));left:50%;
  transform:translateX(-50%);padding:7px 16px;border-radius:16px;font-size:12px;letter-spacing:.1em;
  background:linear-gradient(180deg,rgba(30,22,13,.85),rgba(18,13,8,.85));
  border:1px solid rgba(217,180,106,.45);color:#cbb98f;white-space:nowrap;max-width:94vw;
  overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
#ef-ph-bar{position:absolute;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%);width:min(94vw,460px);padding:12px 16px 12px;border-radius:10px;
  background:linear-gradient(160deg,rgba(37,27,16,.94),rgba(22,15,8,.94));
  border:1px solid #a3813f;pointer-events:auto;touch-action:none;
  box-shadow:0 8px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,230,170,.14);}
#ef-ph-bar .row{display:flex;align-items:center;gap:10px;margin:6px 0;
  font-size:12.5px;letter-spacing:.14em;color:#cbb98f;text-transform:uppercase;}
#ef-ph-bar .row span{width:44px;}
#ef-ph-bar input[type=range]{flex:1;accent-color:#d9b46a;touch-action:none;}
#ef-ph-bar .btns{display:flex;gap:10px;margin-top:9px;}
#ef-ph-bar button{flex:1;font-family:inherit;font-size:13.5px;letter-spacing:.16em;cursor:pointer;
  color:#f0e4c4;text-transform:uppercase;padding:9px 0;border-radius:5px;
  background:linear-gradient(180deg,rgba(90,66,38,.9),rgba(52,38,22,.9));
  border:1px solid #a3813f;box-shadow:inset 0 1px 0 rgba(255,230,170,.2);}
#ef-ph-bar button:active{transform:scale(.97);}
#ef-ph-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;}
`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ef-x-root';
  root.innerHTML = `
<div id="ef-sn-ov"></div>
<div id="ef-sn-pips"></div>
<div id="ef-sn-tap"></div>
<div id="ef-x-fade"></div>
<div id="ef-trv-dim"></div>
<div id="ef-trv">
  <div class="x" id="ef-trv-x">✕</div>
  <h2>SIGNPOST</h2>
  <div class="ef-rule"></div>
  <div class="sub">The carved fingers of the vale</div>
  <div id="ef-trv-list"></div>
  <div class="foot">The road takes time — the sun will move.</div>
</div>
<div id="ef-ph">
  <div id="ef-ph-catch"></div>
  <div id="ef-ph-hint">PHOTO MODE · WASD fly · Q/E sink/rise · Shift fast · drag to look · P / Esc exit</div>
  <div id="ef-ph-bar">
    <div class="row"><span>Time</span><input id="ef-ph-time" type="range" min="0" max="1" step="0.001"></div>
    <div class="row"><span>FOV</span><input id="ef-ph-fov" type="range" min="40" max="100" step="1"></div>
    <div class="btns"><button id="ef-ph-cap">✦ Capture</button><button id="ef-ph-exit">Exit</button></div>
  </div>
  <div id="ef-ph-flash"></div>
</div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const elFade = $('ef-x-fade');
  const elDim = $('ef-trv-dim'), elTrv = $('ef-trv'), elTrvList = $('ef-trv-list');
  const elSnOv = $('ef-sn-ov'), elSnPips = $('ef-sn-pips'), elSnTap = $('ef-sn-tap');
  const elPh = $('ef-ph'), elPhCatch = $('ef-ph-catch');
  const elPhTime = $('ef-ph-time'), elPhFov = $('ef-ph-fov');
  const elPhFlash = $('ef-ph-flash');

  // ==========================================================================
  // Fast travel — panel + fade/teleport state machine
  // ==========================================================================
  let trvOpen = false;
  const travel = { phase: 'idle', t: 0, dest: null, dist: 0 }; // idle|out|hold|in

  function aggroNear() {
    const list = g.enemies && g.enemies.list;
    const p = g.player && g.player.position;
    if (!list || !p) return false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && e.alive && e.aggro && e.pos &&
          dist2d(e.pos.x, e.pos.z, p.x, p.z) < TRAVEL_BLOCK_R) return true;
    }
    return false;
  }

  function dirWord(dx, dz) {
    const a = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8];
  }

  function openTravel(from) {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    if (trvOpen || g.paused || g.cameraLock || travel.phase !== 'idle') return;
    if (aggroNear()) {
      notify('Enemies nearby', 'Deal with your pursuers before taking the road.');
      return;
    }
    trvOpen = true;
    g.paused = true;
    const p = g.player.position;
    let html = '', any = false;
    for (const d of DESTS) {
      if (!d.isDisc()) continue;
      any = true;
      const dist = Math.round(dist2d(p.x, p.z, d.lx, d.lz));
      const here = from && d.id === from.id || dist < 28;
      const hrs = Math.max(1, Math.round(Math.max(0.01, dist / TRAVEL_DAY_DIV) * 24));
      html += `<button class="ef-trow${here ? ' here' : ''}" data-id="${d.id}">` +
        `<span class="n"><span class="g">${d.glyph}</span>${d.name}</span>` +
        `<span class="d">${here ? 'you are here' : dist + 'm ' + dirWord(d.lx - p.x, d.lz - p.z) + ' · ~' + hrs + ' h'}</span></button>`;
    }
    if (!any) html = '<div class="none">No roads known yet — walk the vale first.</div>';
    elTrvList.innerHTML = html;
    elTrvList.querySelectorAll('.ef-trow').forEach((b) => {
      b.addEventListener('click', () => {
        const d = DESTS.find((x) => x.id === b.dataset.id);
        if (d) beginTravel(d);
      });
    });
    elTrv.classList.add('on');
    elDim.classList.add('on');
    sfx('uiClick');
  }

  function closeTravel() {
    if (!trvOpen) return;
    trvOpen = false;
    elTrv.classList.remove('on');
    elDim.classList.remove('on');
    g.paused = false;
    sfx('uiClick');
  }

  function beginTravel(dest) {
    if (travel.phase !== 'idle') return;
    const p = g.player.position;
    travel.dest = dest;
    travel.dist = dist2d(p.x, p.z, dest.lx, dest.lz);
    travel.phase = 'out';
    travel.t = 0;
    closeTravel();
  }

  function doTeleport() {
    const d = travel.dest;
    const pl = g.player;
    const gy = terrainHeight(d.lx, d.lz);
    pl.position.set(d.lx, gy + 0.1, d.lz);
    pl.velocity.set(0, 0, 0);
    // land facing the place itself
    const fx = d.cx - d.lx, fz = d.cz - d.lz;
    if (fx * fx + fz * fz > 1) { pl.yaw = Math.atan2(-fx, -fz); pl.pitch = 0; }
    // the road takes time: distance/3000 of a day, at least 0.01
    const adv = Math.max(0.01, travel.dist / TRAVEL_DAY_DIV);
    if (g.time.dayFrac + adv >= 1) g.flags.dayCount = (g.flags.dayCount | 0) + 1; // midnight crossed in transit
    g.time.dayFrac = (g.time.dayFrac + adv) % 1;
    notify(d.name, 'The road took ~' + Math.max(1, Math.round(adv * 24)) + ' hours.');
  }

  function updateTravel(rawDt) {
    if (travel.phase === 'idle') return;
    travel.t += rawDt;
    if (travel.phase === 'out') {
      elFade.style.opacity = String(clamp(travel.t / TRAVEL_FADE_OUT, 0, 1));
      if (travel.t >= TRAVEL_FADE_OUT) {
        doTeleport();
        travel.phase = 'hold';
        travel.t = 0;
      }
    } else if (travel.phase === 'hold') {
      elFade.style.opacity = '1';
      if (travel.t >= TRAVEL_HOLD) { travel.phase = 'in'; travel.t = 0; }
    } else if (travel.phase === 'in') {
      elFade.style.opacity = String(clamp(1 - travel.t / TRAVEL_FADE_IN, 0, 1));
      if (travel.t >= TRAVEL_FADE_IN) {
        elFade.style.opacity = '0';
        travel.phase = 'idle';
        travel.dest = null;
      }
    }
  }

  // Register the interactables (one per signpost)
  for (const d of DESTS) {
    g.interactables.push({
      pos: new THREE.Vector3(d.sx, d.gy + 1.3, d.sz),
      radius: 3.8,
      label: 'Signpost — Travel',
      enabled: () => !g.paused && d.isDisc() && travel.phase === 'idle',
      onInteract: () => openTravel(d),
    });
  }

  $('ef-trv-x').addEventListener('click', closeTravel);
  elDim.addEventListener('pointerdown', closeTravel);

  // ==========================================================================
  // Hunter senses
  // ==========================================================================
  let senseLeft = 0;   // remaining pulse seconds
  let senseCd = 0;     // remaining lockout (pulse + cooldown)
  const pipsG = [], pipsE = [];
  for (let i = 0; i < PIP_INTER_N; i++) {
    const el = document.createElement('div');
    el.className = 'ef-sn-pip g';
    el.textContent = '✦';
    elSnPips.appendChild(el);
    pipsG.push(el);
  }
  for (let i = 0; i < PIP_ENEMY_N; i++) {
    const el = document.createElement('div');
    el.className = 'ef-sn-pip e';
    elSnPips.appendChild(el);
    pipsE.push(el);
  }
  const pipH = document.createElement('div');
  pipH.className = 'ef-sn-pip h';
  pipH.textContent = '☠';
  elSnPips.appendChild(pipH);

  function triggerSenses() {
    if (senseCd > 0 || senseLeft > 0) return;
    if (g.paused || g.cameraLock || travel.phase !== 'idle') return;
    if (!g.player || g.player.stats.hp <= 0) return;
    senseLeft = SENSE_T;
    senseCd = SENSE_T + SENSE_CD;
    elSnOv.classList.add('on');
    sfx('wheelOpen');
  }

  function hidePips() {
    for (let i = 0; i < pipsG.length; i++) pipsG[i].style.opacity = '0';
    for (let i = 0; i < pipsE.length; i++) pipsE[i].style.opacity = '0';
    pipH.style.opacity = '0';
  }

  // world → screen. Returns false when behind the camera or far off-frame.
  function project(wx, wy, wz, el, fade) {
    const cam = g.camera;
    _v.set(wx, wy, wz);
    _d.subVectors(_v, cam.position);
    if (_d.dot(_fwd) < 0.3) return false;
    _v.project(cam);
    if (_v.x < -1.05 || _v.x > 1.05 || _v.y < -1.05 || _v.y > 1.05) return false;
    const sx = (_v.x * 0.5 + 0.5) * innerWidth;
    const sy = (-_v.y * 0.5 + 0.5) * innerHeight;
    el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%)`;
    el.style.opacity = String(fade);
    return true;
  }

  function updateSensePips(fade) {
    const cam = g.camera;
    const p = g.player.position;
    cam.getWorldDirection(_fwd);
    // interactables (gold ✦) within 30u — skip disabled ones
    let gi = 0;
    const inters = g.interactables;
    for (let i = 0; i < inters.length && gi < pipsG.length; i++) {
      const it = inters[i];
      if (!it || !it.pos) continue;
      if (dist2d(it.pos.x, it.pos.z, p.x, p.z) > SENSE_INTER_R) continue;
      if (it.enabled && !it.enabled()) continue;
      if (project(it.pos.x, it.pos.y + 0.4, it.pos.z, pipsG[gi], fade)) gi++;
    }
    for (let i = gi; i < pipsG.length; i++) pipsG[i].style.opacity = '0';
    // live enemies (faint red dots) within 40u
    let ei = 0;
    const list = g.enemies && g.enemies.list;
    if (list) {
      for (let i = 0; i < list.length && ei < pipsE.length; i++) {
        const e = list[i];
        if (!e || !e.alive || !e.pos) continue;
        if (dist2d(e.pos.x, e.pos.z, p.x, p.z) > SENSE_ENEMY_R) continue;
        if (project(e.pos.x, e.pos.y + (e.height || 1.6) * 0.7, e.pos.z, pipsE[ei], fade * 0.7)) ei++;
      }
    }
    for (let i = ei; i < pipsE.length; i++) pipsE[i].style.opacity = '0';
    // the active hunt mark (red ☠) — edge-clamped so it always gives a bearing
    let hunt = null;
    const marks = g.compassMarkers;
    if (marks) {
      for (let i = 0; i < marks.length; i++) {
        if (marks[i] && marks[i].id === 'hunt') { hunt = marks[i]; break; }
      }
    }
    if (hunt) {
      const hy = terrainHeight(hunt.x, hunt.z) + 2.2;
      if (!project(hunt.x, hy, hunt.z, pipH, fade)) {
        // off-frame: clamp to the screen edge on the side it lies
        _d.set(hunt.x - cam.position.x, 0, hunt.z - cam.position.z);
        _right.set(-_fwd.z, 0, _fwd.x); // fwd × up = camera-right on the ground

        const side = _d.dot(_right) > 0 ? innerWidth - 36 : 36;
        pipH.style.transform = `translate(${side}px,${(innerHeight * 0.42).toFixed(0)}px) translate(-50%,-50%)`;
        pipH.style.opacity = String(fade);
      }
    } else {
      pipH.style.opacity = '0';
    }
  }

  // double-tap the compass strip (mobile path for V)
  let lastTapT = -10;
  elSnTap.addEventListener('pointerdown', () => {
    const now = performance.now() * 0.001;
    if (now - lastTapT < 0.35) { lastTapT = -10; triggerSenses(); }
    else lastTapT = now;
  });

  // ==========================================================================
  // Photo mode
  // ==========================================================================
  const photo = {
    active: false, yaw: 0, pitch: 0, fovSaved: 75,
    vel: new THREE.Vector3(), anchor: new THREE.Vector3(),
    keys: new Set(), lookId: -1, lx: 0, ly: 0,
  };

  function openPhoto() {
    if (photo.active || g.cameraLock || g.paused || travel.phase !== 'idle') return;
    const pl = g.player;
    if (!pl || !pl.stats || pl.stats.hp <= 0) return;
    photo.active = true;
    // a running senses pulse would freeze mid-fade under the pause — end it
    senseLeft = 0;
    elSnOv.classList.remove('on');
    hidePips();
    document.body.classList.add('ef-photo'); // ui.css hides #hud entirely
    g.paused = true;
    g.cameraLock = 'photo'; // player freezes; combat hides the viewmodel
    // drop pointer lock so the DOM sliders are usable (ui skips its
    // lock-loss auto-pause while the ef-photo class is up)
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    photo.yaw = pl.yaw;
    photo.pitch = pl.pitch;
    photo.anchor.copy(g.camera.position);
    photo.fovSaved = g.camera.fov;
    photo.vel.set(0, 0, 0);
    photo.keys.clear();
    photo.lookId = -1;
    elPhTime.value = String(g.time.dayFrac.toFixed(3));
    elPhFov.value = String(Math.round(clamp(g.camera.fov, 40, 100)));
    g.camera.rotation.z = 0; // clear any residual head-bob roll
    elPh.classList.add('on');
    sfx('wheelOpen');
  }

  function closePhoto() {
    if (!photo.active) return;
    photo.active = false;
    elPh.classList.remove('on');
    document.body.classList.remove('ef-photo');
    const cam = g.camera;
    cam.fov = photo.fovSaved; // restore FOV (ui's base-fov rebase resumes)
    cam.updateProjectionMatrix();
    // park the camera back at the player's eye so there is no visible snap
    const pl = g.player;
    cam.position.set(pl.position.x, pl.position.y + (pl.eyeHeight || 1.7), pl.position.z);
    cam.rotation.set(pl.pitch, pl.yaw, 0);
    g.cameraLock = null;
    g.paused = false;
    sfx('uiClick');
  }

  function updatePhoto(rawDt) {
    const cam = g.camera;
    const k = photo.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const sp = PHOTO_SPEED * ((k.has('ShiftLeft') || k.has('ShiftRight')) ? PHOTO_FAST : 1);
    const cy = Math.cos(photo.yaw), sy = Math.sin(photo.yaw), cp = Math.cos(photo.pitch);
    _wish.set(
      (-sy * cp) * f + cy * s,
      Math.sin(photo.pitch) * f + u,
      (-cy * cp) * f - sy * s,
    );
    if (_wish.lengthSq() > 1) _wish.normalize();
    _wish.multiplyScalar(sp);
    const t = 1 - Math.exp(-9 * rawDt);
    photo.vel.lerp(_wish, t);
    cam.position.addScaledVector(photo.vel, rawDt);
    // stay in the built world: streaming is frozen while paused
    _d.subVectors(cam.position, photo.anchor);
    if (_d.length() > PHOTO_RANGE) {
      _d.setLength(PHOTO_RANGE);
      cam.position.copy(photo.anchor).add(_d);
    }
    const gy = terrainHeight(cam.position.x, cam.position.z);
    if (cam.position.y < gy + 0.25) cam.position.y = gy + 0.25;
    if (cam.position.y > photo.anchor.y + 240) cam.position.y = photo.anchor.y + 240;
    cam.rotation.set(photo.pitch, photo.yaw, 0);
  }

  function capture() {
    // Explicit render right before toBlob: the drawing buffer is not
    // preserved, so we repaint (through the postfx composer when present)
    // and grab the pixels in the same task.
    if (g.postfx && g.postfx.render) g.postfx.render();
    else g.renderer.render(g.scene, g.camera);
    g.canvas.toBlob((blob) => {
      if (!blob) { notify('Capture failed', 'The canvas gave no image.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'elderfall.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
    // shutter flash
    elPhFlash.style.transition = 'none';
    elPhFlash.style.opacity = '0.85';
    void elPhFlash.offsetWidth;
    elPhFlash.style.transition = 'opacity .45s ease';
    elPhFlash.style.opacity = '0';
    sfx('uiClick');
  }

  // ---- photo input: drag look + captured keys --------------------------------
  elPhCatch.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (photo.lookId !== -1) return;
    photo.lookId = e.pointerId;
    photo.lx = e.clientX;
    photo.ly = e.clientY;
    try { elPhCatch.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
  });
  elPhCatch.addEventListener('pointermove', (e) => {
    if (e.pointerId !== photo.lookId) return;
    photo.yaw -= (e.clientX - photo.lx) * PHOTO_LOOK;
    photo.pitch = clamp(photo.pitch - (e.clientY - photo.ly) * PHOTO_LOOK, -1.5, 1.5);
    photo.lx = e.clientX;
    photo.ly = e.clientY;
  });
  const phPtrEnd = (e) => { if (e.pointerId === photo.lookId) photo.lookId = -1; };
  elPhCatch.addEventListener('pointerup', phPtrEnd);
  elPhCatch.addEventListener('pointercancel', phPtrEnd);
  elPhCatch.addEventListener('wheel', (e) => { // scroll = zoom
    e.preventDefault();
    const v = clamp(parseFloat(elPhFov.value) + Math.sign(e.deltaY) * 2, 40, 100);
    elPhFov.value = String(v);
    g.camera.fov = v;
    g.camera.updateProjectionMatrix();
  }, { passive: false });

  // While photo mode is up we own the keyboard (capture phase, before ui):
  // WASDQE/Shift fly, P/Esc exit, everything else is swallowed so gameplay
  // and menu bindings can't fire underneath.
  window.addEventListener('keydown', (e) => {
    if (!photo.active || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { closePhoto(); return; }
    photo.keys.add(e.code);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!photo.active) return;
    e.stopImmediatePropagation();
    photo.keys.delete(e.code);
  }, true);
  window.addEventListener('blur', () => { photo.keys.clear(); });

  elPhTime.addEventListener('input', () => {
    const v = parseFloat(elPhTime.value);
    if (isFinite(v)) g.time.dayFrac = clamp(v, 0, 1) % 1; // sky reads it live
  });
  elPhFov.addEventListener('input', () => {
    const v = parseFloat(elPhFov.value);
    if (!isFinite(v)) return;
    g.camera.fov = clamp(v, 40, 100);
    g.camera.updateProjectionMatrix();
  });
  $('ef-ph-cap').addEventListener('click', capture);
  $('ef-ph-exit').addEventListener('click', closePhoto);
  // keep slider/button presses away from the look-catcher underneath
  $('ef-ph-bar').addEventListener('pointerdown', (e) => e.stopPropagation());

  // ==========================================================================
  // Global keys (bubble phase — ui's handlers ignore V and P)
  // ==========================================================================
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyP') { if (!photo.active) openPhoto(); }
    else if (e.code === 'KeyV') triggerSenses();
  });
  // Escape / E close the travel panel (capture, like the other table panels)
  window.addEventListener('keydown', (e) => {
    if (trvOpen && (e.code === 'Escape' || e.code === 'KeyE')) {
      e.stopPropagation();
      closeTravel();
    }
  }, true);

  // A fresh load tears down any transient state
  ev.on('gameLoaded', () => {
    if (photo.active) closePhoto();
    if (trvOpen) closeTravel();
    travel.phase = 'idle';
    travel.dest = null;
    elFade.style.opacity = '0';
    senseLeft = 0;
    senseCd = 0;
    elSnOv.classList.remove('on');
    hidePips();
  });
  ev.on('playerDied', () => {
    senseLeft = 0;
    elSnOv.classList.remove('on');
    hidePips();
  });

  // ==========================================================================
  // Update
  // ==========================================================================
  let dockT = 0;

  function update() {
    const rawDt = g.time.rawDt || 0.016;

    if (photo.active) updatePhoto(rawDt);

    if (!g.paused) {
      updateTravel(rawDt);

      // senses timers + pips
      if (senseCd > 0) senseCd -= rawDt;
      if (senseLeft > 0) {
        senseLeft -= rawDt;
        const fade = senseLeft > 0.6 ? 1 : Math.max(0, senseLeft / 0.6);
        if (senseLeft <= 0.6) elSnOv.classList.remove('on');
        if (senseLeft <= 0) { senseLeft = 0; hidePips(); }
        else updateSensePips(fade);
      }

      // first-visit callout for the dock signpost (Mirrormere's own POI ring
      // can sit far from the shore, so the pier announces itself)
      dockT += rawDt;
      if (dockT > 0.5) {
        dockT = 0;
        if (!g.flags.spotDock && g.player &&
            dist2d(g.player.position.x, g.player.position.z, dock.sx, dock.sz) < 30) {
          g.flags.spotDock = true;
          notify('The Mirrormere Dock', 'Grey planks over quiet water. A signpost leans seaward.');
        }
      }
    }

    // hold the pause while the travel panel is open (mirrors dice.js)
    if (trvOpen && !g.paused) g.paused = true;
  }

  return {
    update,
    openPhoto,
    // debug/test hooks (underscore convention, cf. dice.js/economy.js)
    _openTravel: (id) => openTravel(id ? DESTS.find((d) => d.id === id) : null),
    _travelTo: (id) => { const d = DESTS.find((x) => x.id === id); if (d) beginTravel(d); },
    _senses: triggerSenses,
    _dests: DESTS,
    _travelPhase: () => travel.phase,
    _photo: photo,
    _capture: capture,
  };
}

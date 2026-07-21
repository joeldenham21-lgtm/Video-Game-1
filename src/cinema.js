// ============================================================================
// ELDERFALL — cinema.js  (wave 4: desktop cinematic tier)
// Letterbox bars, over-the-shoulder dialogue cameras, first-time boss intro
// title cards, main-quest-complete vista pans, and the flag-aware EPILOGUE
// SLIDESHOW (Witcher-style ending cards on painted parchment panels).
//
// createCinema(g) → { update(dt) }
//
// Camera handoff per NEXT-LEVEL.md: we set g.cameraLock = 'cinema' (player
// freezes input/camera writes; combat hides the viewmodel) and ALWAYS glide
// the camera back to the player's eye before releasing the lock. Every
// cinematic is skippable and hard time-capped; boss intros run once per boss
// (g.flags.cinemaSeen) and the epilogue runs once (g.flags.epilogueSeen).
// All timing uses g.time.rawDt so hitstop / slow-mo / pause never stall us.
// ============================================================================
import * as THREE from 'three';
import { terrainHeight, clamp } from './core.js';

export function createCinema(g) {
  const ev = g.events;
  const camera = g.camera;

  // ==========================================================================
  // Preallocated temps — zero per-frame allocation
  // ==========================================================================
  const UP = new THREE.Vector3(0, 1, 0);
  const _axis = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _eye = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _m4 = new THREE.Matrix4();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _qPath = new THREE.Quaternion();
  const qStart = new THREE.Quaternion();
  const pStart = new THREE.Vector3();
  const qOutStart = new THREE.Quaternion();
  const pOutStart = new THREE.Vector3();
  const dlgPos = new THREE.Vector3();
  const dlgLook = new THREE.Vector3();

  // ==========================================================================
  // DOM — letterbox + boss title card (below HUD) and epilogue (above HUD)
  // ==========================================================================
  const style = document.createElement('style');
  style.textContent = `
#cin-root{position:fixed;inset:0;pointer-events:none;z-index:9;
  font-family:Georgia,'Times New Roman',serif;}
.cin-bar{position:absolute;left:0;right:0;height:12vh;background:#000;
  transition:transform .35s ease;will-change:transform;}
#cin-bar-top{top:0;transform:translateY(-102%);}
#cin-bar-bot{bottom:0;transform:translateY(102%);}
#cin-root.lb #cin-bar-top,#cin-root.lb #cin-bar-bot{transform:translateY(0);}

/* ---------- boss title card ---------- */
#cin-title{position:absolute;left:0;right:0;top:31%;text-align:center;opacity:0;
  transform:scale(1.045);transition:opacity .45s ease,transform 2.9s linear;}
#cin-title.on{opacity:1;transform:scale(1);}
#cin-title .n{font-size:clamp(38px,6.2vw,84px);font-weight:400;letter-spacing:.2em;
  padding-left:.2em;line-height:1.08;
  background:linear-gradient(180deg,#f4e8c8 20%,#d9b46a 70%,#a67c3d 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.85)) drop-shadow(0 0 26px rgba(230,180,90,.3));}
#cin-title .r{height:1px;width:min(46vw,420px);margin:14px auto 10px;
  background:linear-gradient(90deg,transparent,#a3813f 30%,#d9b46a 50%,#a3813f 70%,transparent);}
#cin-title .e{font-size:clamp(13px,1.5vw,19px);letter-spacing:.44em;padding-left:.44em;
  color:#c9a86a;text-shadow:0 1px 4px rgba(0,0,0,.9);}

/* ---------- epilogue slideshow ---------- */
#cin-epi{position:fixed;inset:0;z-index:60;background:#000;opacity:0;
  pointer-events:none;transition:opacity 1.15s ease;cursor:pointer;
  font-family:Georgia,'Times New Roman',serif;}
#cin-epi.on{opacity:1;pointer-events:auto;}
.cin-card{position:absolute;inset:0;display:flex;align-items:center;
  justify-content:center;opacity:0;transition:opacity .85s ease;pointer-events:none;}
.cin-card.on{opacity:1;}
.cin-panel{position:relative;width:min(88vw,840px);max-height:76vh;overflow:hidden;
  padding:clamp(26px,5vh,50px) clamp(24px,4.5vw,60px);text-align:center;
  border:1px solid #6f5a33;border-radius:3px;
  outline:1px solid rgba(120,90,44,.55);outline-offset:-8px;
  background:
    radial-gradient(ellipse at 26% 16%,rgba(255,247,216,.55),transparent 55%),
    radial-gradient(ellipse at 76% 84%,rgba(118,82,38,.32),transparent 62%),
    repeating-linear-gradient(97deg,rgba(96,66,30,.05) 0 3px,transparent 3px 8px),
    repeating-linear-gradient(9deg,rgba(96,66,30,.04) 0 2px,transparent 2px 7px),
    linear-gradient(163deg,#e7d4ad 0%,#dcc496 45%,#c9ad7c 100%);
  box-shadow:0 14px 70px rgba(0,0,0,.85),inset 0 0 90px rgba(62,40,15,.5),
    inset 0 0 16px rgba(62,40,15,.35);}
.cin-panel::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at 50% 42%,transparent 50%,rgba(56,36,14,.4) 100%);}
.cin-glyph{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);
  font-size:clamp(150px,36vh,290px);line-height:1;color:rgba(94,66,28,.13);
  pointer-events:none;}
.cin-mark{position:relative;font-size:clamp(22px,3.4vh,32px);color:#7a5c2c;opacity:.8;}
.cin-cap{position:relative;font-size:clamp(12px,1.5vw,17px);letter-spacing:.42em;
  padding-left:.42em;color:#6d5124;text-transform:uppercase;margin:6px 0 4px;}
.cin-prule{position:relative;height:1px;width:58%;margin:10px auto 16px;
  background:linear-gradient(90deg,transparent,rgba(111,90,51,.85) 30%,#8a6a33 50%,rgba(111,90,51,.85) 70%,transparent);}
.cin-body{position:relative;font-size:clamp(15px,1.9vw,20px);line-height:1.75;
  color:#3a2c16;font-style:italic;max-width:33em;margin:0 auto;}
#cin-dots{position:absolute;left:0;right:0;bottom:5vh;text-align:center;
  letter-spacing:.55em;font-size:13px;color:rgba(232,220,192,.35);}
#cin-dots b{color:rgba(217,180,106,.9);font-weight:400;}
#cin-hint{position:absolute;left:0;right:0;bottom:2vh;text-align:center;
  font-size:10px;letter-spacing:.32em;padding-left:.32em;color:rgba(232,220,192,.4);
  opacity:0;transition:opacity 1s ease;}
#cin-epi.hint #cin-hint{opacity:1;}
`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'cin-root';
  root.innerHTML =
    '<div class="cin-bar" id="cin-bar-top"></div>' +
    '<div class="cin-bar" id="cin-bar-bot"></div>' +
    '<div id="cin-title"><div class="n"></div><div class="r"></div><div class="e"></div></div>';
  document.body.appendChild(root);
  const titleEl = root.querySelector('#cin-title');
  const titleName = titleEl.querySelector('.n');
  const titleEpi = titleEl.querySelector('.e');

  const epiEl = document.createElement('div');
  epiEl.id = 'cin-epi';
  document.body.appendChild(epiEl);

  const lb = (on) => root.classList.toggle('lb', !!on);

  // ==========================================================================
  // Boss identity: title + epithet + intro sfx (contract epithets, exact)
  // ==========================================================================
  const EPITHETS = {
    'Vhastrix': ['VHASTRIX', 'THE EMBER TYRANT'],
    'Lord Morvane': ['LORD MORVANE', 'THE THIRST BELOW'],
    'Barrow Lord': ['THE BARROW LORD', 'KING OF DUST'],
    'Stonebridge Troll': ['STONEBRIDGE TROLL', 'THE TOLL'],
    'Vargr Redfang': ['VARGR REDFANG', 'YOUR DEATH, REMEMBERED'],
  };
  const BOSS_SFX = {
    'Vhastrix': 'drakeRoar', 'Barrow Lord': 'skeletonRattle',
    'Lord Morvane': 'thunder', 'Stonebridge Troll': 'drakeRoar',
    'Vargr Redfang': 'wolfHowl',
  };
  function bossCardFor(name) {
    let base = name, echo = false;
    if (/^echo of /i.test(name)) { echo = true; base = name.slice(8); }
    const hit = EPITHETS[base];
    const title = hit ? hit[0] : base.toUpperCase();
    return {
      title: echo ? 'ECHO OF ' + title : title,
      epithet: hit ? hit[1] : (echo ? 'A MEMORY GIVEN TEETH' : ''),
      sfx: BOSS_SFX[base] || 'drakeRoar',
    };
  }

  // ==========================================================================
  // State machine
  // ==========================================================================
  // idle | dlgIn | dlg | dlgOut | boss | bossCard | bossOut | vista | vistaOut
  // | epiFade | epiCards | epiOut
  let state = 'idle';
  let t = 0;                 // seconds in current state (raw time)
  let bossTarget = null;     // live enemy entry during 'boss'
  let bossAngBase = 0, bossHeight = 2;
  let vistaYaw0 = 0;
  let pendingVista = false, pendingVistaT = 0;
  let pendingEpilogue = false;
  let vargrPollT = 0;
  let advanceGuard = 0;      // debounce for epilogue card advancing
  let epiCards = [];         // DOM nodes
  let epiIdx = 0;
  let epiCardT = 0;

  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  function eyePos(out) {
    out.copy(g.player.position);
    out.y += g.player.eyeHeight;
    return out;
  }
  function playerQuat(out) {
    _e.set(g.player.pitch, g.player.yaw, 0);
    return out.setFromEuler(_e);
  }
  function lookQuat(from, to, out) {
    _m4.lookAt(from, to, UP);
    return out.setFromRotationMatrix(_m4);
  }
  // Snap the camera exactly onto the player's eye and hand control back.
  function releaseLock() {
    eyePos(_eye);
    camera.position.copy(_eye);
    camera.rotation.set(g.player.pitch, g.player.yaw, 0); // order already YXZ
    if (g.cameraLock === 'cinema') g.cameraLock = null;
  }
  // Begin a glide from wherever the camera is now back to the player's eye.
  function beginOut(next) {
    pOutStart.copy(camera.position);
    qOutStart.copy(camera.quaternion);
    state = next;
    t = 0;
    lb(false);
  }
  function runOut(dur) {
    const k = smooth(t / dur);
    eyePos(_eye);
    playerQuat(_qPath);
    camera.position.lerpVectors(pOutStart, _eye, k);
    camera.quaternion.slerpQuaternions(qOutStart, _qPath, k);
    if (t >= dur) { releaseLock(); state = 'idle'; }
  }

  // ==========================================================================
  // Dialogue camera — over-the-shoulder ¾ framing
  // ==========================================================================
  // Distance from (x,z) to the nearest collider edge — used to pick which
  // shoulder the dialogue camera peeks over (avoids well canopies, walls…).
  function clearance(x, z) {
    let best = 9;
    const C = g.colliders;
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      const dx = x - c.x, dz = z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz) - (c.r || 0);
      if (d < best) best = d;
    }
    return best;
  }
  function onDialogueStart(d) {
    // Only quests NPCs expose a .group with a world position; books/merchant
    // panels pass a bare {name} — skip those entirely.
    if (!d || !d.npc || !d.npc.group || !d.npc.group.position) return;
    if (g.cameraLock && g.cameraLock !== 'cinema') return; // photo mode etc.
    const rejoin = state === 'dlgOut' && g.cameraLock === 'cinema';
    if (state !== 'idle' && !rejoin) return;
    const npcPos = d.npc.group.position;
    const pp = g.player.position;
    _axis.set(pp.x - npcPos.x, 0, pp.z - npcPos.z);
    const len = _axis.length();
    if (len < 0.001) _axis.set(0, 0, 1); else _axis.divideScalar(len);
    _right.set(-_axis.z, 0, _axis.x);
    // ~2.2u back-right of the player↔npc axis; pick the shoulder with more
    // clearance so props (the village well!) don't block the frame.
    const bx = npcPos.x + _axis.x * 2.4, bz = npcPos.z + _axis.z * 2.4;
    const sgn = clearance(bx + _right.x * 1.15, bz + _right.z * 1.15) >=
                clearance(bx - _right.x * 1.15, bz - _right.z * 1.15) ? 1 : -1;
    _right.multiplyScalar(sgn);
    dlgPos.set(bx + _right.x * 1.15, npcPos.y + 1.5, bz + _right.z * 1.15);
    dlgPos.y = Math.max(dlgPos.y, terrainHeight(dlgPos.x, dlgPos.z) + 0.6);
    // aim at the face, below oversized hat brims (chibi rigs: eyes ~1.2u)
    dlgLook.copy(npcPos);
    dlgLook.y += 1.22;
    pStart.copy(camera.position);
    qStart.copy(camera.quaternion);
    if (!rejoin) g.cameraLock = 'cinema';
    state = 'dlgIn';
    t = 0;
    lb(true);
  }
  function onDialogueEnd() {
    if (state === 'dlgIn' || state === 'dlg') beginOut('dlgOut');
  }

  // ==========================================================================
  // Boss intros — 2.6s swing + serif title card, once per boss name
  // ==========================================================================
  function onBossBar(b) {
    if (!b || !b.name || g.paused || g.cameraLock || state !== 'idle') return;
    if (!g.flags.cinemaSeen) g.flags.cinemaSeen = {};
    if (g.flags.cinemaSeen[b.name]) return;
    startBossIntro(b.name);
  }
  function startBossIntro(name) {
    if (!g.flags.cinemaSeen) g.flags.cinemaSeen = {};
    g.flags.cinemaSeen[name] = true;
    // find the live enemy so the camera can frame it
    let target = null;
    const L = g.enemies && g.enemies.list;
    if (L) for (let i = 0; i < L.length; i++) {
      if (L[i].alive && L[i].name === name) { target = L[i]; break; }
    }
    const card = bossCardFor(name);
    titleName.textContent = card.title;
    titleEpi.textContent = card.epithet;
    if (g.audio && g.audio.play) g.audio.play(card.sfx);
    lb(true);
    t = 0;
    if (target) {
      bossTarget = target;
      bossHeight = target.height || 2;
      bossAngBase = Math.atan2(g.player.position.x - target.pos.x,
                               g.player.position.z - target.pos.z);
      pStart.copy(camera.position);
      qStart.copy(camera.quaternion);
      g.cameraLock = 'cinema';
      state = 'boss';
    } else {
      state = 'bossCard'; // letterbox + card only; camera stays with player
    }
  }
  const BOSS_DUR = 2.6;
  function runBoss() {
    const e = bossTarget;
    if (!e || !e.alive) { endBossIntro(); return; }
    const u = clamp(t / BOSS_DUR, 0, 1);
    const s = smooth(u);
    // slow swing around the boss (from off-axis toward the player axis) with
    // a gentle dolly-in from ~11.5u to ~8.5u
    const ang = bossAngBase + 0.5 - 0.62 * s;
    const d = 11.5 - 3.0 * s;
    _pos.set(e.pos.x + Math.sin(ang) * d,
             e.pos.y + Math.min(2.6, bossHeight * 0.55) + 0.9 * s,
             e.pos.z + Math.cos(ang) * d);
    _pos.y = Math.max(_pos.y, terrainHeight(_pos.x, _pos.z) + 0.6);
    _look.set(e.pos.x, e.pos.y + bossHeight * 0.72, e.pos.z);
    lookQuat(_pos, _look, _qPath);
    const k = smooth(t / 0.7); // entry blend from wherever the camera was
    camera.position.lerpVectors(pStart, _pos, k);
    camera.quaternion.slerpQuaternions(qStart, _qPath, k);
    titleEl.classList.toggle('on', t > 0.35 && t < BOSS_DUR - 0.12);
    if (t >= BOSS_DUR) endBossIntro();
  }
  function endBossIntro() {
    titleEl.classList.remove('on');
    bossTarget = null;
    beginOut('bossOut');
  }
  function runBossCard() {
    titleEl.classList.toggle('on', t > 0.15 && t < 2.1);
    if (t >= 2.25) endBossCard();
  }
  function endBossCard() {
    titleEl.classList.remove('on');
    lb(false);
    state = 'idle';
  }
  // Vargr never drives the bossBar event — poll his aggro so his card plays.
  function pollVargr(dt) {
    vargrPollT -= dt;
    if (vargrPollT > 0) return;
    vargrPollT = 0.3;
    if (g.paused || g.cameraLock || state !== 'idle') return;
    if (g.flags.vargrDead) return;
    if (g.flags.cinemaSeen && g.flags.cinemaSeen['Vargr Redfang']) return;
    const L = g.enemies && g.enemies.list;
    if (!L) return;
    for (let i = 0; i < L.length; i++) {
      const e = L[i];
      if (e.alive && e.isVargr && e.aggro && !e.echo) { startBossIntro('Vargr Redfang'); return; }
    }
  }

  // ==========================================================================
  // Main-quest-complete vista pan — 2s, 25° orbital sweep
  // ==========================================================================
  function onQuestCompleted(q) {
    if (!q || !q.quest || typeof q.quest.id !== 'string') return;
    if (q.quest.id.indexOf('main') === -1) return;
    if (g.flags.drakeDead && !g.flags.epilogueSeen) {
      pendingEpilogue = true; // the finale gets the slideshow, not a pan
      return;
    }
    pendingVista = true;
    pendingVistaT = 30; // give the closing dialogue time; drop it after that
  }
  const VISTA_DUR = 2.0;
  function startVista() {
    pendingVista = false;
    vistaYaw0 = g.player.yaw;
    pStart.copy(camera.position);
    qStart.copy(camera.quaternion);
    g.cameraLock = 'cinema';
    state = 'vista';
    t = 0;
    lb(true);
  }
  function runVista() {
    const u = clamp(t / VISTA_DUR, 0, 1);
    const s = smooth(u);
    const env = Math.sin(Math.PI * u);       // rises then settles back to eye
    const yawA = vistaYaw0 + 0.4363 * s;     // 25° sweep
    const fx = -Math.sin(yawA), fz = -Math.cos(yawA);
    eyePos(_eye);
    _pos.set(_eye.x - fx * env * 2.0, _eye.y + env * 1.1, _eye.z - fz * env * 2.0);
    _pos.y = Math.max(_pos.y, terrainHeight(_pos.x, _pos.z) + 0.5);
    _look.set(_eye.x + fx * 26, _eye.y + 2.2 * env, _eye.z + fz * 26);
    lookQuat(_pos, _look, _qPath);
    const k = smooth(t / 0.25); // absorb head-bob offset at entry
    camera.position.lerpVectors(pStart, _pos, k);
    camera.quaternion.slerpQuaternions(qStart, _qPath, k);
    if (t >= VISTA_DUR) beginOut('vistaOut');
  }

  // ==========================================================================
  // EPILOGUE SLIDESHOW — the crown
  // ==========================================================================
  function card(glyph, caption, text) {
    return '<div class="cin-card"><div class="cin-panel">' +
      '<div class="cin-glyph">' + glyph + '</div>' +
      '<div class="cin-mark">' + glyph + '</div>' +
      '<div class="cin-cap">' + caption + '</div>' +
      '<div class="cin-prule"></div>' +
      '<div class="cin-body">' + text + '</div>' +
      '</div></div>';
  }
  function buildEpilogueHTML() {
    const F = g.flags;
    const cards = [];

    // 1 — the village, saved (always)
    cards.push(card('❧', 'Emberhollow',
      'The drake’s shadow no longer crosses the valley, and Emberhollow is learning ' +
      'again to sleep with its shutters open. Fields blacken with plough-turned earth ' +
      'instead of fire; the inn glows late; nobody counts the road’s travelers with ' +
      'fear anymore. In twenty years they will tell it taller and brighter, with a ' +
      'better ending for everyone. But the children who were there remember the true ' +
      'shape of it: a stranger came, and stayed, and the mountain went quiet.'));

    // 2 — the witch of the pines
    if (F.witchDead) {
      cards.push(card('☽', 'The Crone of the Pines',
        'The hut beneath the pines stands empty now, its door swinging to the wind’s ' +
        'opinion. Villagers still make the old signs when the path bends that way, ' +
        'though nothing waits there but cold ash and herbs gone to seed. Whatever ' +
        'Grimhilde was — monster, healer, both — the pines do not say. They only ' +
        'grow a little darker, remembering.'));
    } else if (F.croneChoice === 'peace') {
      cards.push(card('☽', 'The Crone of the Pines',
        'Grimhilde keeps her hut beneath the pines, and the pines keep her secrets. ' +
        'On market days she comes down with salves and bitter teas, and the same ' +
        'mothers who once hung iron over their cradles now queue at her stall and ' +
        'call her “goodwife.” Peace, it turns out, is a habit like any other. ' +
        'It only needed someone willing to go first.'));
    } else {
      cards.push(card('☽', 'The Crone of the Pines',
        'Somewhere beneath the pines a fire still burns in a crooked hut, and the ' +
        'villagers still leave the old path untrodden. Grimhilde was never brought ' +
        'to answer — not for her cures, not for her curses. Some stories simply ' +
        'keep, like jars in a dark cellar, waiting for a hand on the lid.'));
    }

    // 3 — Lord Morvane
    if (F.morvaneDead) {
      cards.push(card('♰', 'The Thirst Below',
        'Dawn found the cemetery merely sad again — no hunger beneath it, no patient ' +
        'voice in the dark. Lord Morvane’s long thirst ended on a night the village ' +
        'will not name, at the hand of one it will never stop naming. The dead of ' +
        'Emberhollow sleep now as the dead should: deeply, and asked for nothing.'));
    } else if (F.morvanePact) {
      cards.push(card('♰', 'The Thirst Below',
        'In the cemetery below the chapel hill the earth stays quiet — that was the ' +
        'bargain, and Lord Morvane keeps his bargains. But some nights a lamp gutters ' +
        'where no wind is, and a bed is found empty at cock-crow, and no one asks ' +
        'aloud where the missing have gone. The village calls it peace. The thing ' +
        'beneath the graves calls it a tithe, and smiles with your handshake still ' +
        'warm in its palm.'));
    } else {
      cards.push(card('♰', 'The Thirst Below',
        'Beneath the cemetery something old still waits, patient as mortar, courteous ' +
        'as a debt. Lord Morvane was never faced, never bargained with, never burned ' +
        'out of his dark. The village hangs iron and garlic and hopes, as villages ' +
        'have always hoped, that hunger forgets its way upstairs.'));
    }

    // 4 — Vargr Redfang
    if (F.vargrDead) {
      cards.push(card('⚔', 'Vargr Redfang',
        'They burned the totems of the Redfang camp and let the crows keep the rest. ' +
        'Vargr died as he lived — certain, to the last breath, that he was the hero ' +
        'of the story. Bram drinks a little easier now, and the road through the pass ' +
        'has grown strangely gentle. Even so, old travelers still glance at the ' +
        'treeline where the red tents stood.'));
    } else if ((F.vargrWins | 0) > 0) {
      cards.push(card('⚔', 'Vargr Redfang',
        'Vargr Redfang lives, and that is not an ending — only a pause between ' +
        'verses. He wears his victories over you like rings and tells them around ' +
        'his fire, embellishing nothing; he has never needed to. Somewhere beyond ' +
        'the pass he sharpens his blade and remembers your face. He is patient. ' +
        'So are winters.'));
    } else if (F.campPeaceful) {
      cards.push(card('⚔', 'Vargr Redfang',
        'The debt was settled in coin instead of blood, and Vargr Redfang — to the ' +
        'quiet astonishment of everyone — kept his word. The red tents trade now ' +
        'more than they take. It is not friendship; it is arithmetic. But in the ' +
        'borderlands, arithmetic keeps more people alive than love does.'));
    } else {
      cards.push(card('⚔', 'Vargr Redfang',
        'The red tents still stand beyond the pass, and Vargr Redfang still holds his ' +
        'small kingdom of cutthroats and debts. You never gave him the fight he ' +
        'wanted, which may be the one insult he cannot forgive. Travelers pay his ' +
        'toll and hurry on, and the pass remains a place where the birds sing ' +
        'carefully.'));
    }

    // 5 — the amulet (only if the thread was touched)
    if (F.amuletReturned) {
      cards.push(card('❈', 'The Mirrormere Light',
        'Every evening at dusk a small lantern is lit in Wendel’s window, the silver ' +
        'amulet hanging just behind the glass where the lake can see it. He talks to ' +
        'Enna while he works now, easy as breathing, and swears the barley grows ' +
        'better for it. Grief did not leave him. It only, at last, sat down at his ' +
        'table like a guest instead of a thief.'));
    } else if (F.amuletSold) {
      cards.push(card('❈', 'The Mirrormere Light',
        'Enna’s amulet went to a merchant’s tray for a handful of silver, and by now ' +
        'it hangs on a stranger’s neck in some far town that never knew her name. ' +
        'Wendel never asked after it; he only stopped walking out to the lake of an ' +
        'evening. Gold spends, and then it is spent. Some purchases keep charging ' +
        'you long after.'));
    } else if (F.amuletKept) {
      cards.push(card('❈', 'The Mirrormere Light',
        'The amulet from the lake stayed in a wanderer’s pack — warm from being ' +
        'carried, cold from never being worn. Wendel waits without knowing what he ' +
        'is waiting for, and the dock boards grey a little more each winter. It is a ' +
        'small thing, a swallow of silver. But the lake remembers everything it has ' +
        'ever been given, and everything taken back.'));
    }

    // 6 — the Wardstones
    if (F.stonesCleansed) {
      cards.push(card('❖', 'The Wardstones',
        'On the high moor the five Wardstones burn again with their old cyan fire, ' +
        'and the dead keep to their side of it. Shepherds cut their paths close by ' +
        'the circle now, the way their grandmothers taught before fear redrew the ' +
        'maps. Stones do not gloat; they simply hold. That is the whole of their ' +
        'magic, and it is enough.'));
    } else {
      cards.push(card('❖', 'The Wardstones',
        'On the high moor the five Wardstones stand dark, waiting for a hand willing ' +
        'to wake them. The old wards drowse; the dead test their fences. Some work ' +
        'is always left over, even after a mountain has been made quiet.'));
    }

    // 7 — the road goes on (always last)
    cards.push(card('✦', 'The Road Goes On',
      'And you — Dragonslayer of Emberhollow — you find that legends make poor ' +
      'pillows. There are still hunts pinned to the village board, still blood moons ' +
      'that pull the wolves wrong, still an echo on the peak that wears Vhastrix’s ' +
      'shape when the light goes thin. The fire is warm, and the road is long, and ' +
      'both of them are yours. The world continues. It always does.'));

    return cards.join('');
  }
  function startEpilogue() {
    pendingEpilogue = false;
    g.flags.epilogueSeen = true;
    epiEl.innerHTML = buildEpilogueHTML() +
      '<div id="cin-dots"></div>' +
      '<div id="cin-hint">TAP OR PRESS ANY KEY TO CONTINUE</div>';
    epiCards = Array.prototype.slice.call(epiEl.querySelectorAll('.cin-card'));
    epiIdx = -1;
    epiEl.classList.add('on');
    g.cameraLock = 'cinema'; // freezes the player while the world fades away
    state = 'epiFade';
    t = 0;
  }
  function epiDots() {
    const el = epiEl.querySelector('#cin-dots');
    if (!el) return;
    let s = '';
    for (let i = 0; i < epiCards.length; i++) s += i === epiIdx ? '<b>✦</b>' : '·';
    el.innerHTML = s;
  }
  function showEpiCard(i) {
    if (epiIdx >= 0 && epiCards[epiIdx]) epiCards[epiIdx].classList.remove('on');
    epiIdx = i;
    epiCardT = 0;
    advanceGuard = 0.6;
    if (epiCards[i]) epiCards[i].classList.add('on');
    epiDots();
    if (g.audio && g.audio.play) g.audio.play('uiClick');
  }
  function advanceEpilogue() {
    if (advanceGuard > 0) return;
    if (epiIdx + 1 < epiCards.length) showEpiCard(epiIdx + 1);
    else endEpilogue();
  }
  function endEpilogue() {
    g.paused = false;
    releaseLock();
    epiEl.classList.remove('on', 'hint');
    state = 'epiOut';
    t = 0;
    ev.emit('notify', { text: 'Elderfall — thank you for playing', sub: 'The world continues' });
  }

  // ==========================================================================
  // Skip / advance input (capture phase so menus don't swallow or open)
  // ==========================================================================
  function consumeKeys() {
    return state === 'epiFade' || state === 'epiCards' || state === 'epiOut' ||
           state === 'boss' || state === 'bossCard' || state === 'vista';
  }
  window.addEventListener('keydown', (e) => {
    if (!consumeKeys()) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (state === 'epiCards') advanceEpilogue();
    else if (state === 'boss') endBossIntro();
    else if (state === 'bossCard') endBossCard();
    else if (state === 'vista') beginOut('vistaOut');
  }, true);
  window.addEventListener('pointerdown', (e) => {
    if (!consumeKeys()) return;
    e.stopPropagation();
    if (state === 'epiCards') advanceEpilogue();
    else if (state === 'boss') endBossIntro();
    else if (state === 'bossCard') endBossCard();
    else if (state === 'vista') beginOut('vistaOut');
  }, true);

  // ==========================================================================
  // Events
  // ==========================================================================
  ev.on('dialogueStart', onDialogueStart);
  ev.on('dialogueEnd', onDialogueEnd);
  ev.on('bossBar', onBossBar);
  ev.on('questCompleted', onQuestCompleted);
  // "invulnerable" during boss intros the simple way: any hit ends the intro
  ev.on('playerDamaged', () => { if (state === 'boss') endBossIntro(); });

  // ==========================================================================
  // Update
  // ==========================================================================
  function update() {
    const dt = g.time.rawDt || 0; // real time: immune to pause/hitstop/slow-mo
    t += dt;
    if (advanceGuard > 0) advanceGuard -= dt;

    switch (state) {
      case 'idle': {
        pollVargr(dt);
        if (pendingVista) {
          pendingVistaT -= dt;
          if (pendingVistaT <= 0) pendingVista = false;
          else if (!g.paused && !g.cameraLock) { startVista(); break; }
        }
        if (pendingEpilogue && !g.paused && !g.cameraLock) startEpilogue();
        break;
      }

      case 'dlgIn': {
        const k = smooth(t / 0.8);
        lookQuat(dlgPos, dlgLook, _qPath);
        camera.position.lerpVectors(pStart, dlgPos, k);
        camera.quaternion.slerpQuaternions(qStart, _qPath, k);
        if (t >= 0.8) { state = 'dlg'; t = 0; }
        break;
      }
      case 'dlg': {
        // breathing dolly ±0.08u along the framing axis + a whisper of rise
        camera.position.copy(dlgPos)
          .addScaledVector(_axis, Math.sin(t * 0.55) * 0.08);
        camera.position.y += Math.sin(t * 0.34 + 1.3) * 0.035;
        camera.lookAt(dlgLook);
        // safety: dialogue always pauses; if we're somehow unpaused with no
        // dialogueEnd seen, glide home rather than hold the camera hostage
        if (!g.paused && t > 1.2) beginOut('dlgOut');
        break;
      }
      case 'dlgOut': runOut(0.5); break;

      case 'boss': runBoss(); break;
      case 'bossCard': runBossCard(); break;
      case 'bossOut': runOut(0.45); break;

      case 'vista': runVista(); break;
      case 'vistaOut': runOut(0.4); break;

      case 'epiFade': {
        if (t >= 1.2) {
          g.paused = true; // world holds its breath; music keeps playing
          state = 'epiCards';
          t = 0;
          showEpiCard(0);
          epiEl.classList.add('hint');
        }
        break;
      }
      case 'epiCards': {
        g.paused = true; // re-assert every frame — nothing may unpause us
        epiCardT += dt;
        if (epiCardT >= 9) { advanceGuard = 0; advanceEpilogue(); }
        break;
      }
      case 'epiOut': {
        if (t >= 1.3) { epiEl.innerHTML = ''; epiCards.length = 0; state = 'idle'; }
        break;
      }
    }
  }

  return { update };
}

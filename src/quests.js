// ============================================================================
// ELDERFALL — quests.js
// Village NPCs (animated KayKit characters), data-driven dialogue trees, the
// 5-act main quest, six side quests with meaningful choices (Fangs in the
// Fold, The Redfang Debt, The Mirrormere Light, The Crone of the Pines,
// Blood Below the Barrows, The Toll of Stonebridge), Bram's potion shop,
// and POI discovery. Owns events: `discover`, `questStarted`, `questUpdated`,
// `questCompleted`, `dialogueStart`.
// NPC visuals follow the wave-2 async asset pattern: logic + interactables
// exist immediately on an empty Group; the skinned mesh attaches when
// g.assets.char() resolves. Idle/Walking_A locomotion is speed-matched
// (walk clip authored ≈2.2 u/s), Interact plays during dialogue.
// ============================================================================
import * as THREE from 'three';
import {
  POIS, POI, terrainHeight, dist2d, WATER_LEVEL,
} from './core.js';

export function createQuests(g) {
  const ev = g.events;

  // ==========================================================================
  // Quest definitions & state
  // ==========================================================================
  const QUESTS = {
    main1: { id: 'main1', name: 'Embers at Dusk' },
    main2: { id: 'main2', name: 'The Silent Watch' },
    main3: { id: 'main3', name: 'The Blade of Aldric' },
    main4: { id: 'main4', name: 'Ward of Stones' },
    main5: { id: 'main5', name: 'Drakespire' },
    fold:  { id: 'fold',  name: 'Fangs in the Fold' },
    debt:  { id: 'debt',  name: 'The Redfang Debt' },
    mere:  { id: 'mere',  name: 'The Mirrormere Light' },
    crone: { id: 'crone', name: 'The Crone of the Pines' },
    blood: { id: 'blood', name: 'Blood Below the Barrows' },
    toll:  { id: 'toll',  name: 'The Toll of Stonebridge' },
  };

  // state.main: 0 = not started, 1..5 = act, 6 = saga complete.
  // state.stage: progress within the current act.
  // side quests: 0 = not taken, 1 = active, 2 = resolved.
  // crone: 0 none, 1 seek the hut, 2 inspect the well, 3 truth known,
  //        4 resolved (peace), 5 hostile hunt, 6 witch dead, 7 resolved (blood)
  // blood: 0 none, 1 search cemetery (night), 2 enter the crypt (night),
  //        3 pact made (dawns count), 4 re-opened (finish him), 5 resolved
  // toll:  0 none, 1 troll met, 2 resolved (respect, paid twice), 3 resolved (dead)
  // vanished: villagers taken at dawn while the pact held (guilt echoes).
  const state = {
    main: 0, stage: 0, pelts: 0, fold: 0, debt: 0, mere: 0,
    crone: 0, blood: 0, toll: 0, vanished: 0,
  };

  const qStart  = (q, text) => ev.emit('questStarted',   { quest: q, text });
  const qUpdate = (q, text) => ev.emit('questUpdated',   { quest: q, text });
  const qDone   = (q, text) => ev.emit('questCompleted', { quest: q, text });
  const notify  = (text, sub) => ev.emit('notify', { text, sub });

  function mainObjective() {
    const s = state.stage;
    switch (state.main) {
      case 1: return 'Speak with Elder Maera by the well';
      case 2: return s === 0 ? 'Light the beacon atop Greywatch Tower'
            : s === 1 ? 'Survive the goblin ambush'
            : 'Return to Elder Maera';
      case 3: return s === 0 ? "Claim Aldric's blade from the Barrowdeep crypt"
            : 'Bring the blade to Torvald the smith';
      case 4: return s === 0 ? 'Speak with Elder Maera'
            : s === 1 ? 'Cleanse the Wardstones'
            : s === 2 ? 'Survive the risen dead'
            : 'Return to Elder Maera';
      case 5: return s === 0 ? 'Slay Vhastrix atop Drakespire'
            : 'Return to Emberhollow in triumph';
      default: return null;
    }
  }

  // ==========================================================================
  // Villager NPCs — animated KayKit characters (async: logic first, mesh on
  // load). Tints per the wave-2 art spec; blob shadows stay.
  // ==========================================================================
  const NPC_DEFS = [
    { id: 'maera',   name: 'Maera',   x: 2.5, z: -5,  char: 'mage',         tint: '#aea7bc', height: 1.72, homeR: 2.2 },
    { id: 'torvald', name: 'Torvald', x: 16,  z: 7,   char: 'barbarian',    tint: '#7a5230', height: 1.95, homeR: 2.0 },
    { id: 'sylva',   name: 'Sylva',   x: -26, z: 24,  char: 'rogue',        tint: '#6f8f58', height: 1.76, homeR: 3.2 },
    { id: 'bram',    name: 'Bram',    x: -9,  z: -13, char: 'knight',       tint: '#d9b184', height: 1.84, homeR: 1.8 },
    { id: 'wendel',  name: 'Wendel',  x: 24,  z: -21, char: 'rogue_hooded', tint: '#9a8a68', height: 1.70, homeR: 2.6 },
  ];

  // Locomotion references (KayKit clips as authored)
  const WALK_CLIP_SPEED = 2.2;  // u/s the Walking_A clip was animated at
  const NPC_WALK_SPEED = 0.85;  // u/s villagers actually amble at

  // Blob shadow — shared radial-gradient CanvasTexture quad
  const shCanvas = document.createElement('canvas');
  shCanvas.width = shCanvas.height = 64;
  {
    const c = shCanvas.getContext('2d');
    const grd = c.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,0.42)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
  }
  const shTex = new THREE.CanvasTexture(shCanvas);
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });
  const shGeo = new THREE.PlaneGeometry(1.5, 1.5);
  shGeo.rotateX(-Math.PI / 2);

  const npcs = {};
  const npcList = [];

  // Attach the skinned KayKit model to an already-live npc group.
  function attachModel(npc, def, asset) {
    const { scene, animations } = asset;
    // Scale to the def's target height (KayKit humans ≈1.9u as authored)
    const box = new THREE.Box3().setFromObject(scene);
    const rawH = Math.max(0.1, box.max.y - box.min.y);
    scene.scale.setScalar(def.height / rawH);
    if (g.assets && g.assets.tint) g.assets.tint(scene, def.tint);
    npc.group.add(scene);

    npc.mixer = new THREE.AnimationMixer(scene);
    npc.actions = {};
    for (const want of ['Idle', 'Walking_A', 'Interact']) {
      let clip = null;
      for (let i = 0; i < animations.length; i++) {
        const nm = animations[i].name;
        if (nm === want || nm.endsWith('|' + want)) { clip = animations[i]; break; }
      }
      if (clip) npc.actions[want] = npc.mixer.clipAction(clip);
    }
    const idle = npc.actions.Idle;
    if (idle) {
      idle.play();
      idle.time = Math.random() * (idle.getClip().duration || 1); // desync
      npc.current = idle;
    }
  }

  function makeVillager(def) {
    // Logic object with an empty Group IMMEDIATELY — interactables and
    // wander AI work before the mesh streams in.
    const group = new THREE.Group();
    const shadow = new THREE.Mesh(shGeo, shMat);
    shadow.position.y = 0.02;
    group.add(shadow);

    const gy = terrainHeight(def.x, def.z);
    group.position.set(def.x, gy, def.z);
    g.scene.add(group);

    const npc = {
      id: def.id, name: def.name, group,
      homeX: def.x, homeZ: def.z, homeR: def.homeR,
      tgtX: def.x, tgtZ: def.z, waitT: 1 + Math.random() * 4,
      phase: Math.random() * 6.28, t: 0, walking: false, talking: false,
      mixer: null, actions: null, current: null, animAcc: 0,
    };
    npcs[def.id] = npc;
    npcList.push(npc);

    // Fire-and-forget: mesh arrives whenever the char pack finishes loading.
    if (g.assets && g.assets.char) {
      g.assets.char(def.char)
        .then((asset) => { if (asset) attachModel(npc, def, asset); })
        .catch(() => {});
    }

    g.interactables.push({
      pos: group.position, radius: 2.8,
      label: 'Talk — ' + def.name,
      onInteract: () => talkTo(npc),
      enabled: () => !g.paused,
    });
    return npc;
  }
  for (const d of NPC_DEFS) makeVillager(d);

  function talkTo(npc) {
    if (!g.ui || !g.ui.openDialogue) return;
    const tree = treeFor(npc);
    if (!tree) return;
    npc.talking = true;
    ev.emit('dialogueStart', { npc, node: tree.start });
    g.ui.openDialogue(npc, tree);
  }

  // Dialogue closed → drop the Interact pose on everyone.
  ev.on('dialogueEnd', () => {
    for (let i = 0; i < npcList.length; i++) npcList[i].talking = false;
  });

  // Crossfade helper — swaps the active clip, keeps timeScale speed-matched.
  function setClip(n, name, timeScale) {
    const a = n.actions && n.actions[name];
    if (!a) return;
    if (n.current !== a) {
      if (n.current) n.current.fadeOut(0.22);
      a.reset().fadeIn(0.22).play();
      n.current = a;
    }
    a.timeScale = timeScale;
  }

  // NPC idle wander + face-player + animation state machine (zero allocs).
  // Movement freezes while paused; mixers keep ticking so the Interact clip
  // plays during dialogue. LOD: mixer updates every 2nd frame beyond 40u,
  // every 4th beyond 80u (accumulated dt, no dropped time).
  let npcFrame = 0;
  function updateNPCs(dt) {
    const p = g.player ? g.player.position : null;
    npcFrame++;
    for (let i = 0; i < npcList.length; i++) {
      const n = npcList[i];
      n.t += dt;
      const gp = n.group.position;
      const pd = p ? dist2d(gp.x, gp.z, p.x, p.z) : 1e9;
      const nearPlayer = pd < 4;

      if (!g.paused) {
        n.walking = false;
        if (nearPlayer) {
          // Face the player
          const want = Math.atan2(p.x - gp.x, p.z - gp.z);
          let d = want - n.group.rotation.y;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          n.group.rotation.y += d * Math.min(1, dt * 6);
        } else if (n.waitT > 0) {
          n.waitT -= dt;
          if (n.waitT <= 0) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * n.homeR;
            n.tgtX = n.homeX + Math.sin(a) * r;
            n.tgtZ = n.homeZ + Math.cos(a) * r;
          }
        } else {
          const dx = n.tgtX - gp.x, dz = n.tgtZ - gp.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.15) {
            n.waitT = 3 + Math.random() * 6;
          } else {
            const sp = Math.min(d, NPC_WALK_SPEED * dt) / d;
            gp.x += dx * sp; gp.z += dz * sp;
            const want = Math.atan2(dx, dz);
            let rd = want - n.group.rotation.y;
            while (rd > Math.PI) rd -= Math.PI * 2;
            while (rd < -Math.PI) rd += Math.PI * 2;
            n.group.rotation.y += rd * Math.min(1, dt * 5);
            n.walking = true;
          }
        }
        gp.y = terrainHeight(gp.x, gp.z);
      } else if (n.talking && p) {
        // Paused in dialogue: keep turning to face the player
        const want = Math.atan2(p.x - gp.x, p.z - gp.z);
        let d = want - n.group.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        n.group.rotation.y += d * Math.min(1, dt * 6);
      }

      // Animation: Interact while talked to, Walking_A speed-matched, Idle
      if (n.mixer) {
        setClip(n,
          n.talking ? 'Interact' : n.walking ? 'Walking_A' : 'Idle',
          n.walking && !n.talking ? NPC_WALK_SPEED / WALK_CLIP_SPEED : 1);
        n.animAcc += dt;
        const step = pd > 80 ? 4 : pd > 40 ? 2 : 1;
        if (step === 1 || ((npcFrame + i) % step) === 0) {
          n.mixer.update(n.animAcc);
          n.animAcc = 0;
        }
      }
    }
  }

  // ==========================================================================
  // World interactables owned by quests
  // ==========================================================================
  // Watchman's note at the base of Greywatch Tower (act 2 flavor + fate)
  const notePos = new THREE.Vector3(
    POI.tower.x + 7, terrainHeight(POI.tower.x + 7, POI.tower.z + 5) + 0.4, POI.tower.z + 5);
  g.interactables.push({
    pos: notePos, radius: 2.4,
    label: 'Read the bloodstained note',
    onInteract: () => {
      if (!g.ui || !g.ui.openDialogue) return;
      g.ui.openDialogue({ name: 'A Bloodstained Note' }, noteTree());
    },
    enabled: () => state.main >= 2 && !g.flags.watchNote && !g.paused,
  });

  // Wardstone cleansing (act 4)
  const stonesPos = new THREE.Vector3(
    POI.stones.x, terrainHeight(POI.stones.x, POI.stones.z) + 1, POI.stones.z);
  g.interactables.push({
    pos: stonesPos, radius: 5,
    label: 'Cleanse the Wardstones',
    onInteract: () => beginStonesRite(),
    enabled: () => state.main === 4 && state.stage === 1 && !g.paused,
  });

  // The sunken amulet — march from Mirrormere's center toward the village
  // until we climb out of the water: that's the old south dock's shore.
  let dockX = POI.lake.x, dockZ = POI.lake.z;
  {
    const len = Math.hypot(POI.lake.x, POI.lake.z);
    const dx = -POI.lake.x / len, dz = -POI.lake.z / len;
    for (let d = 8; d < 420; d += 4) {
      const x = POI.lake.x + dx * d, z = POI.lake.z + dz * d;
      if (terrainHeight(x, z) > WATER_LEVEL + 0.4) { dockX = x; dockZ = z; break; }
    }
  }
  const amuletPos = new THREE.Vector3(dockX, terrainHeight(dockX, dockZ) + 0.3, dockZ);
  g.interactables.push({
    pos: amuletPos, radius: 2.6,
    label: 'Search beneath the rotten dock',
    onInteract: () => {
      g.flags.amuletFound = true;
      notify('The Mirrormere Amulet', 'Lake-silver, a moon on its face. Cold as the deep.');
      qUpdate(QUESTS.mere, "You found Enna's amulet. Wendel waits — or Bram pays for silver.");
    },
    enabled: () => state.mere === 1 && !g.flags.amuletFound && !g.paused,
  });

  // --------------------------------------------------------------------------
  // Wave-2 locations (match ASSETS-ART.md / structures & enemies agents):
  // witch hut (-260,-520), Stonebridge (330,-260), cemetery + crypt at the
  // Barrowdeep ruins (crypt chamber sits ~16u south of the POI center, door
  // facing north).
  // --------------------------------------------------------------------------
  const SPOT = {
    hut:    { x: -260, z: -520, name: "The Crone's Hut" },
    bridge: { x: 330,  z: -260, name: 'Stonebridge' },
    graves: { x: POI.ruins.x - 26, z: POI.ruins.z + 18, name: 'The Barrowdeep Cemetery' },
    crypt:  { x: POI.ruins.x, z: POI.ruins.z - 25, name: 'The Barrow Crypt' },
    well:   { x: -64, z: 58, name: 'The Old Stock-Well' },
  };
  const spotVec = (s, lift) => new THREE.Vector3(s.x, terrainHeight(s.x, s.z) + (lift || 0.5), s.z);

  function openTalk(name, tree) {
    if (!g.ui || !g.ui.openDialogue || !tree) return;
    const who = { name };
    ev.emit('dialogueStart', { npc: who, node: tree.start });
    g.ui.openDialogue(who, tree);
  }

  // --- The Crone of the Pines ---
  // Grimhilde herself is enemies.js' entity (neutral until g.flags.witchHostile);
  // this is her door — where words happen.
  const hutPos = spotVec(SPOT.hut, 0.6);
  g.interactables.push({
    pos: hutPos, radius: 4.2,
    label: 'Speak — Grimhilde',
    onInteract: () => openTalk('Grimhilde', grimhildeTree()),
    enabled: () => !g.paused && !g.flags.witchHostile && !g.flags.witchDead,
  });
  // Her cauldron — lootable only after the torch-and-pitchfork ending.
  g.interactables.push({
    pos: hutPos, radius: 4.2,
    label: "Loot the witch's cauldron",
    onInteract: () => {
      if (g.flags.cauldronLooted) return;
      g.flags.cauldronLooted = true;
      notify('The cauldron scraped clean', 'Coin, herbs, and two draughts that smell of pine.');
      ev.emit('spawnLoot', { pos: { x: SPOT.hut.x, y: hutPos.y, z: SPOT.hut.z }, kind: 'gold', amount: 45 });
      ev.emit('spawnLoot', { pos: { x: SPOT.hut.x + 1, y: hutPos.y, z: SPOT.hut.z + 1 }, kind: 'potion', amount: 1 });
      ev.emit('spawnLoot', { pos: { x: SPOT.hut.x - 1, y: hutPos.y, z: SPOT.hut.z + 1 }, kind: 'potion', amount: 1 });
    },
    enabled: () => !g.paused && !!g.flags.witchDead && !!g.flags.witchHostile && !g.flags.cauldronLooted,
  });
  // The sick stock-well north of the fold — the real culprit.
  const wellPos = spotVec(SPOT.well, 0.5);
  g.interactables.push({
    pos: wellPos, radius: 3,
    label: 'Inspect the old stock-well',
    onInteract: () => openTalk('The Old Stock-Well', wellTree()),
    enabled: () => !g.paused && state.crone === 2 && !g.flags.wellCleansed,
  });

  // --- Blood Below the Barrows ---
  const gravesPos = spotVec(SPOT.graves, 0.5);
  g.interactables.push({
    pos: gravesPos, radius: 5,
    label: 'Search among the graves',
    onInteract: () => openTalk('The Cemetery', gravesTree()),
    enabled: () => !g.paused && state.blood === 1 && isNight(),
  });
  const cryptPos = spotVec(SPOT.crypt, 0.6);
  g.interactables.push({
    pos: cryptPos, radius: 4.5,
    label: 'Call into the crypt-dark',
    onInteract: () => openTalk('Morvane', morvaneTree()),
    enabled: () => !g.paused && isNight() && !g.flags.morvaneDead &&
      (state.blood === 2 || state.blood === 3 || state.blood === 4),
  });

  // --- The Toll of Stonebridge ---
  const bridgePos = spotVec(SPOT.bridge, 0.6);
  g.interactables.push({
    pos: bridgePos, radius: 5.5,
    label: 'Parley — the troll',
    onInteract: () => openTalk('Grum the Troll', trollTree()),
    enabled: () => !g.paused && state.toll >= 1 && !g.flags.trollDead,
  });

  // ==========================================================================
  // Wave spawning (ambushes) — tracked enemy refs, completion callback
  // ==========================================================================
  const wave = { list: [], active: false, done: null };

  function spawnWave(type, n, cx, cz, done) {
    wave.list.length = 0;
    if (g.enemies && g.enemies.spawnAt) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.7;
        const r = 9 + (i % 3) * 2.5;
        const e = g.enemies.spawnAt(type, cx + Math.sin(a) * r, cz + Math.cos(a) * r);
        if (e) wave.list.push(e);
      }
    }
    wave.done = done;
    if (wave.list.length === 0) { finishWave(); return; }
    wave.active = true;
  }
  function finishWave() {
    wave.active = false;
    wave.list.length = 0;
    const cb = wave.done;
    wave.done = null;
    if (cb) cb();
  }
  function checkWave() {
    if (!wave.active) return;
    for (let i = 0; i < wave.list.length; i++) {
      if (wave.list[i].alive) return;
    }
    finishWave();
  }

  const isNight = () => g.time.dayFrac < 0.22 || g.time.dayFrac > 0.78;

  function beginStonesRite() {
    if (state.main !== 4 || state.stage !== 1) return;
    state.stage = 2;
    const n = 4 + (isNight() ? 2 : 0);
    notify('The stones wake', 'The dead take offense.');
    qUpdate(QUESTS.main4, 'Survive the risen dead');
    spawnWave('skeleton', n, POI.stones.x, POI.stones.z, () => {
      if (state.main !== 4) return;
      g.flags.stonesCleansed = true;
      state.stage = 3;
      notify('The Wardstones burn cyan', 'The ward holds. The sky will feel it.');
      qUpdate(QUESTS.main4, 'Return to Elder Maera');
    });
  }

  // ==========================================================================
  // Quest event listeners
  // ==========================================================================
  ev.on('enemyKilled', (d) => {
    if (!d) return;
    if (d.type === 'barrowlord') {
      g.flags.barrowlordDead = true;
      if (state.main === 3 && state.stage === 0) {
        qUpdate(QUESTS.main3, "Take Aldric's blade from the barrow chest");
      }
    }
    if (d.type === 'drake') {
      g.flags.drakeDead = true;
      if (state.main === 5 && state.stage === 0) {
        state.stage = 1;
        notify('Vhastrix is slain', 'The mountain is quiet.');
        qUpdate(QUESTS.main5, 'Return to Emberhollow in triumph');
      }
    }
  });

  ev.on('pickup', (d) => {
    if (!d || !d.itemId) return;
    if (d.itemId === 'pelt') {
      state.pelts = Math.min(99, state.pelts + 1);
      if (state.fold === 1 && state.pelts <= 5) {
        qUpdate(QUESTS.fold, 'Wolf pelts for Sylva: ' + Math.min(state.pelts, 5) + '/5');
      }
    }
    if (d.itemId === 'aldricSword' && state.main === 3 && state.stage === 0) {
      state.stage = 1;
      notify("Aldric's Ember", 'Cold in the hand. Waiting.');
      qUpdate(QUESTS.main3, 'Bring the blade to Torvald the smith');
    }
  });

  // ==========================================================================
  // Update: auto-start, beacon watch, waves, discovery
  // ==========================================================================
  let discT = 0;

  function update(dt) {
    if (g.paused) return;

    updateNPCs(dt);

    // Act 1 auto-start ~8s into a new game
    if (state.main === 0 && g.time.elapsed > 8) {
      state.main = 1; state.stage = 0;
      qStart(QUESTS.main1, mainObjective());
      notify('Smoke over the south fields', 'Elder Maera is asking for you — by the well.');
    }

    // Act 2: the brazier is lit (structures sets the flag) → goblin ambush
    if (state.main === 2 && state.stage === 0 && g.flags.beaconLit) {
      state.stage = 1;
      notify('The beacon burns', 'Something answered. Not wardens.');
      qUpdate(QUESTS.main2, 'Survive the goblin ambush');
      spawnWave('goblin', 3, POI.tower.x, POI.tower.z, () => {
        if (state.main !== 2) return;
        state.stage = 2;
        qUpdate(QUESTS.main2, 'Return to Elder Maera');
      });
    }

    checkWave();

    // POI discovery (throttled 0.5s)
    discT -= dt;
    if (discT <= 0) {
      discT = 0.5;
      const p = g.player && g.player.position;
      if (p) {
        const disc = g.flags.discovered || (g.flags.discovered = {});
        for (let i = 0; i < POIS.length; i++) {
          const poi = POIS[i];
          if (disc[poi.id]) continue;
          const r = (poi.r || 100) + 30;
          if (dist2d(p.x, p.z, poi.x, poi.z) < r) {
            disc[poi.id] = true;
            ev.emit('discover', { poi });
          }
        }
      }
    }
  }

  // ==========================================================================
  // Compass marker for the active main objective (reused Vector3)
  // ==========================================================================
  const _marker = new THREE.Vector3();
  function markAt(x, z) { return _marker.set(x, terrainHeight(x, z) + 1.5, z); }
  function markNpc(n) { return _marker.copy(n.group.position); }

  function markerPos() {
    const s = state.stage;
    switch (state.main) {
      case 1: return markNpc(npcs.maera);
      case 2: return s < 2 ? markAt(POI.tower.x, POI.tower.z) : markNpc(npcs.maera);
      case 3: return s === 0 ? markAt(POI.ruins.x, POI.ruins.z) : markNpc(npcs.torvald);
      case 4: return s === 0 || s === 3 ? markNpc(npcs.maera) : markAt(POI.stones.x, POI.stones.z);
      case 5: return s === 0 ? markAt(POI.peak.x, POI.peak.z) : markNpc(npcs.maera);
      default: return null;
    }
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================
  function serialize() {
    return {
      main: state.main, stage: state.stage, pelts: state.pelts,
      fold: state.fold, debt: state.debt, mere: state.mere,
    };
  }

  function deserialize(o) {
    if (!o) return;
    for (const k of ['main', 'stage', 'pelts', 'fold', 'debt', 'mere']) {
      if (typeof o[k] === 'number' && isFinite(o[k])) state[k] = o[k];
    }
    // Survive-stages can't restore tracked wave enemies — roll back one step
    // so the ambush re-arms cleanly on load.
    if (state.main === 2 && state.stage === 1) state.stage = 0;
    if (state.main === 4 && state.stage === 2) state.stage = 1;
    // Repopulate the journal for whatever is in flight.
    const mq = QUESTS['main' + state.main];
    if (mq && state.main >= 1 && state.main <= 5) qStart(mq, mainObjective());
    if (state.fold === 1) qStart(QUESTS.fold, 'Wolf pelts for Sylva: ' + Math.min(state.pelts, 5) + '/5');
    if (state.debt === 1) qStart(QUESTS.debt, "Settle Bram's debt — 60 gold, or Vargr Redfang's head");
    if (state.mere === 1) {
      qStart(QUESTS.mere, g.flags.amuletFound
        ? "You have Enna's amulet. Wendel waits — or Bram pays for silver."
        : "Search the old dock on Mirrormere's south shore");
    }
  }

  // ==========================================================================
  // Dialogue trees — built fresh per conversation from quest state.
  // Format: { start, nodes: { id: { text, speaker?, choices:[{label,next?,if?,do?}] } } }
  // ==========================================================================
  function treeFor(npc) {
    switch (npc.id) {
      case 'maera': return maeraTree();
      case 'torvald': return torvaldTree();
      case 'sylva': return sylvaTree();
      case 'bram': return bramTree();
      case 'wendel': return wendelTree();
      default: return null;
    }
  }

  function noteTree() {
    return {
      start: 'n1',
      nodes: {
        n1: {
          text: '"Day nine without relief. Goblins on the scree every dusk, bolder each night. ' +
            'Valley sends no one. If no one comes tomorrow I will light the beacon myself and—" ' +
            'The stroke tears through the page. There is no more.',
          choices: [{
            label: 'Hedric held nine days alone. Take the beacon fire up.',
            next: null,
            do: () => {
              g.flags.watchNote = true;
              if (state.main === 2 && state.stage === 0) {
                qUpdate(QUESTS.main2, 'Light the beacon brazier atop the tower');
              }
            },
          }],
        },
      },
    };
  }

  // --------------------------------------------------------------- Maera ---
  function maeraTree() {
    const N = {};
    let start = 'idle';

    if (state.main === 0) {
      N.idle = {
        text: "Rest your feet, stranger. The well water's sweet, and it's free — " +
          'only thing in this valley that still is.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 1) {
      start = 'm1';
      const accept = () => {
        if (state.main !== 1) return;
        qDone(QUESTS.main1);
        state.main = 2; state.stage = 0;
        qStart(QUESTS.main2, mainObjective());
      };
      N.m1 = {
        text: "You're the one who came up the south road. Good — stand, this won't take long. " +
          'You saw the smoke on your way in?',
        choices: [
          { label: 'I saw burnt farms.', next: 'm2' },
          { label: 'Smoke? I saw nothing.', next: 'm2b' },
        ],
      };
      N.m2 = {
        text: 'The Hollis steading. The Brae fields before that. Something is burning us out ' +
          'croft by croft, and old Wendel swears he saw wings against the moon.',
        choices: [
          { label: 'Wings. You believe him?', next: 'm3' },
        ],
      };
      N.m2b = {
        text: 'Then you walked with your eyes shut. The Hollis steading is ash and the Brae ' +
          'fields with it. Something is burning us out croft by croft — Wendel swears he saw ' +
          'wings against the moon.',
        choices: [
          { label: 'Wings. You believe him?', next: 'm3' },
        ],
      };
      N.m3 = {
        text: "I believe his sheep are cooked in the field where they stand. Here's what I need: " +
          "Greywatch Tower guards the south pass, and its keeper Hedric hasn't sent word in nine " +
          'days. Climb it. Light the beacon. If any warden in this valley still draws breath, ' +
          "they'll answer the flame.",
        choices: [
          { label: 'Why me?', next: 'm4' },
          { label: "I'll light it.", next: 'm5', do: accept },
        ],
      };
      N.m4 = {
        text: "Because you're armed, you're breathing, and you're not one of mine to bury. " +
          'Emberhollow has farmers, one smith, and me. You look like trouble already came for ' +
          'you once — and lost.',
        choices: [{ label: "Fair enough. I'll go.", next: 'm5', do: accept }],
      };
      N.m5 = {
        text: 'South-east, past the shrine road — you\'ll see it on the ridge. And if you find ' +
          'Hedric... be kinder to him than the crows were.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 2 && state.stage < 2) {
      N.idle = {
        text: 'The beacon still stands dark, and every dusk I count more smoke in the south. ' +
          'Greywatch, stranger. The ridge south-east.',
        choices: [{ label: 'I\'m going.', next: null }],
      };
    } else if (state.main === 2 && state.stage === 2) {
      start = 'r1';
      const advance = () => {
        if (state.main !== 2) return;
        qDone(QUESTS.main2);
        state.main = 3; state.stage = 0;
        qStart(QUESTS.main3, mainObjective());
      };
      N.r1 = {
        text: 'Fire on the Greywatch — the whole valley saw it. And goblins on your heels the ' +
          "moment it caught, I'll wager. They watch that tower like it owes them money.",
        choices: [
          { label: 'Your watchman is dead.', next: 'r2', if: () => !!g.flags.watchNote },
          { label: 'No warden answered the flame.', next: 'r3' },
        ],
      };
      N.r2 = {
        text: 'Hedric... He held nine days alone, then. We\'ll cut his name into the well-stone. ' +
          "That's how Emberhollow buries its own: deep as memory goes. Now listen, because his " +
          'nine days must buy us something.',
        choices: [{ label: 'Go on.', next: 'r3' }],
      };
      N.r3 = {
        text: "No warden will. There are none left — just us, and the thing with wings. A drake, " +
          "as Wendel said. Common steel will only make it laugh. But my grandmother beat a story " +
          'into me: Aldric the Wardensking carried a blade that drank fire, and he lies under ' +
          'Barrowdeep with it still — north-east, in the deep crypt, past everything that keeps ' +
          'honest folk out.',
        choices: [
          { label: 'What keeps honest folk out?', next: 'r4' },
          { label: "I'll fetch the blade.", next: 'r5', do: advance },
        ],
      };
      N.r4 = {
        text: 'The barrow-lord. Dead four hundred years and still won\'t lie down — bone and old ' +
          'kingship and spite. Take your heaviest swing and don\'t bow to anything that bows first.',
        choices: [{ label: "I'll fetch the blade.", next: 'r5', do: advance }],
      };
      N.r5 = {
        text: 'Follow the dark pines north-east and down the sunken stair. And stranger — thank ' +
          'you. I don\'t say it twice.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 3) {
      N.idle = {
        text: state.stage === 0
          ? 'Barrowdeep, north-east under the dark pines. The crypt stair sinks below the ' +
            'broken circle. Mind the dead — they mind you.'
          : 'You have it? Then why are you standing in my square — take it to Torvald before ' +
            'whatever sleeps in that steel goes back to sleep.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 4 && state.stage === 0) {
      start = 'w1';
      const advance = () => {
        if (state.main !== 4 || state.stage !== 0) return;
        state.stage = 1;
        qUpdate(QUESTS.main4, mainObjective());
      };
      N.w1 = {
        text: "Show me. ...Gods. It hums like a kettle. All right, listen: a blade alone won't " +
          'bring a drake down to you — it hunts from a sky you can\'t reach. The old folk raised ' +
          'five Wardstones west of here to gather the sky\'s anger to a point. They\'ve stood ' +
          'silent since before my mother. Wake them.',
        choices: [
          { label: 'How does one wake a stone?', next: 'w2' },
          { label: "I'll go west.", next: 'w3', do: advance },
        ],
      };
      N.w2 = {
        text: 'Lay your hand on the circle and stand your ground, if the stories are true. The ' +
          'dead planted round those stones take the touching personally. Bring steel and a full ' +
          'stomach.',
        choices: [{ label: "I'll go west.", next: 'w3', do: advance }],
      };
      N.w3 = {
        text: 'West past the marsh, on the high heath. Five stones, one circle. Come back with ' +
          'the ward lit and I\'ll tell you where the beast dens.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 4 && state.stage < 3) {
      N.idle = {
        text: 'The Wardstones, west on the high heath. Until they burn, the sky belongs to the drake.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 4 && state.stage === 3) {
      start = 'f1';
      const advance = () => {
        if (state.main !== 4) return;
        qDone(QUESTS.main4);
        state.main = 5; state.stage = 0;
        qStart(QUESTS.main5, mainObjective());
      };
      N.f1 = {
        text: 'The western sky went cyan at moonrise — the whole village stood in the lanes and ' +
          'watched. The ward holds, the blade wakes, and the beast will feel both. Its name is ' +
          'Vhastrix, if names matter to you. They mattered to Aldric.',
        choices: [
          { label: 'Where do I find it?', next: 'f2', do: advance },
        ],
      };
      N.f2 = {
        text: 'Drakespire. Due north, where the snow never melts and the horizon bends up. ' +
          'Climb until the air bites, and don\'t stop when it starts circling — that\'s just it ' +
          'deciding you\'re worth the trouble. You are.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 5 && state.stage === 0) {
      N.idle = {
        text: 'North, stranger. Climb. Don\'t look down and don\'t stop. Emberhollow will keep ' +
          'a light burning — Wendel insists on it lately.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.main === 5 && state.stage === 1) {
      start = 'c1';
      N.c1 = {
        text: 'They saw it from the mill roof — a star going down the mountainside, burning as ' +
          'it fell. Vhastrix is dead and Emberhollow stands. I have buried too many neighbors ' +
          'to say this lightly: you gave us back our sky.',
        choices: [{
          label: 'It\'s done.',
          next: 'c2',
          do: () => {
            if (state.main !== 5) return;
            state.main = 6; state.stage = 0;
            if (g.player) g.player.addGold(300);
            notify('Dragonslayer of Emberhollow', 'The village will tell this one for a hundred years.');
            qDone(QUESTS.main5, 'The saga is complete — 300 gold');
          },
        }],
      };
      N.c2 = {
        text: 'Three hundred in gold — every purse in the village opened without being asked. ' +
          'And your name goes on the well-stone above Hedric\'s, while you\'re still alive to ' +
          'be embarrassed by it. Drink at Bram\'s. Tell him the first one\'s mine to pay.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else {
      N.idle = {
        text: 'Quiet, isn\'t it? First quiet season in three years. I find I don\'t trust it yet ' +
          '— but that\'s an old woman\'s habit, not a prophecy. Go enjoy what you paid for.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  // ------------------------------------------------------------- Torvald ---
  function torvaldTree() {
    const N = {};
    let start = 'idle';

    if (state.main === 3 && state.stage === 1) {
      start = 't1';
      N.t1 = {
        text: 'Where did you— give it HERE. Careful with it! ...Four hundred years in the wet ' +
          'dark and not one bloom of rust on her. That\'s not steel, friend. That\'s a promise ' +
          'somebody forged and never broke.',
        choices: [{ label: 'Maera says it drinks fire.', next: 't2' }],
      };
      N.t2 = {
        text: 'Old work sleeps, is all. Watch.  ...He lays the blade in the coals and speaks to ' +
          'it — low, like gentling a horse. The edge catches, ember by ember, and does not stop ' +
          'glowing when it leaves the fire.',
        choices: [{
          label: 'Take up Aldric\'s Ember.',
          next: 't3',
          do: () => {
            if (state.main !== 3) return;
            g.flags.hasAldricSword = true;
            notify("Aldric's Ember awakened", 'Your sword burns: +10 damage');
            qDone(QUESTS.main3);
            state.main = 4; state.stage = 0;
            qStart(QUESTS.main4, mainObjective());
          },
        }],
      };
      N.t3 = {
        text: 'Feel the grip warm? She\'s awake. A blade like this you don\'t own — you just ' +
          'carry it somewhere worthy. Maera will know where that is. She always does.',
        choices: [{ label: 'My thanks, smith.', next: null }],
      };
    } else if (g.flags.hasAldricSword) {
      N.idle = {
        text: g.flags.drakeDead
          ? 'The blade that killed a drake, resting in MY doorway. Fifty years at the anvil and ' +
            'the best work I ever did was waking someone else\'s. I\'ll take it.'
          : 'How\'s the old blade sit? ...Thought so. Best work I never did. Keep her out of ' +
            'the rain anyway — habit\'s habit.',
        choices: [
          {
            label: 'Heard anything of the roads?',
            next: 'gossip',
            if: () => !!g.flags.vargrDead,
          },
          { label: 'Farewell.', next: null },
        ],
      };
      N.gossip = {
        text: 'Only that Redfang\'s dead and nobody\'s weeping. He bent my nephew\'s arm for two ' +
          'seasons\' coin once. I\'d have paid to watch, and I\'m careful with money.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else {
      N.idle = {
        text: 'Mind the sparks. You need something hammered, dented, or un-dented, I\'m your ' +
          'man. Conversation, though — try the inn. Bram sells it by the mug.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  // --------------------------------------------------------------- Sylva ---
  function sylvaTree() {
    const N = {};
    let start = 'idle';

    if (state.fold === 0) {
      start = 's1';
      const accept = () => {
        if (state.fold !== 0) return;
        state.fold = 1;
        qStart(QUESTS.fold, 'Wolf pelts for Sylva: ' + Math.min(state.pelts, 5) + '/5');
      };
      N.s1 = {
        text: 'You hunt? No — you fight. Different walk, same tools. Good enough. Something\'s ' +
          'been at the fold three nights running: not one wolf, a pack that\'s stopped fearing ' +
          'fire. Six ewes dead and Marta\'s boy nearly the seventh.',
        choices: [
          { label: 'What do you need?', next: 's2' },
          { label: 'Wolves are just hungry.', next: 's3' },
        ],
      };
      N.s2 = {
        text: 'Pelts. Five. That\'s the pack\'s spine broken and proof it\'s broken — the flock ' +
          'won\'t sleep for less and neither will I. They den in the pines and hunt the meadows ' +
          'at dusk.',
        choices: [
          { label: 'I\'ll thin them.', next: 's4', do: accept },
          { label: 'Not my flock, not my fight.', next: null },
        ],
      };
      N.s3 = {
        text: 'So are we. Difference is I don\'t apologize to my dinner. Five pelts breaks the ' +
          'pack and saves the fold — will you do it or won\'t you?',
        choices: [
          { label: 'I\'ll thin them.', next: 's4', do: accept },
          { label: 'Find another blade.', next: null },
        ],
      };
      N.s4 = {
        text: 'Skin them clean — a torn pelt tells the pack nothing. Dusk and the forest edge. ' +
          'Come back whole.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.fold === 1 && state.pelts < 5) {
      N.idle = {
        text: 'Count again: ' + state.pelts + ' of five. The pack won\'t mourn the ones you ' +
          'took, but the fold might live out the week. Dusk, forest edge. Go.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (state.fold === 1) {
      start = 'p1';
      N.p1 = {
        text: 'Five. And clean cuts — you didn\'t panic in the dark, then. The fold owes you, ' +
          'and I pay debts one of two ways. Coin... or an hour of my time, and I\'ll show you ' +
          'where to put a blade so nothing gets up after. Hunter\'s trade. Pick.',
        choices: [
          {
            label: 'The coin. (50 gold)',
            next: 'pCoin',
            do: () => {
              if (state.fold !== 1) return;
              state.fold = 2; g.flags.foldChoice = 'coin';
              if (g.player) g.player.addGold(50);
              qDone(QUESTS.fold, 'Sylva paid 50 gold');
            },
          },
          {
            label: 'Teach me.',
            next: 'pCraft',
            do: () => {
              if (state.fold !== 1) return;
              state.fold = 2; g.flags.foldChoice = 'craft';
              if (g.player) g.player.bonus.dmg += 0.08;
              notify("Hunter's craft", 'All damage +8%');
              qDone(QUESTS.fold, "Learned Sylva's craft: +8% damage");
            },
          },
        ],
      };
      N.pCoin = {
        text: 'Smart. Coin spends anywhere and lessons die with the student. ...That was a ' +
          'joke, mostly. Wool\'s safe, stranger. Drink one for the sheep.',
        choices: [{ label: 'Farewell.', next: null }],
      };
      N.pCraft = {
        text: 'Shoulders first, then the wrist — the blade arrives before the arm does. ' +
          'Again. ...Again. There. Now you kill like you mean it instead of like you\'re ' +
          'apologizing. Go be terrible somewhere useful.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else {
      N.idle = {
        text: g.flags.foldChoice === 'craft'
          ? 'Shoulders, then wrist — you remember. I can tell by the dead things you leave ' +
            'lying around the valley. Best coin I never spent.'
          : 'Spent that gold yet? Wool\'s back on the hills either way. The fold sleeps, so ' +
            'I sleep. Simple ledger.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  // ---------------------------------------------------------------- Bram ---
  function bramTree() {
    const N = {};
    const gold = () => (g.player ? g.player.stats.gold : 0);
    const buyChoice = {
      label: 'Buy a healing draught. (20 gold)',
      next: 'shop',
      if: () => gold() >= 20,
      do: () => {
        if (!g.player || g.player.stats.gold < 20) return;
        g.player.addGold(-20);
        g.player.stats.potions += 1;
        notify('Healing draught bought', 'Potions: ' + g.player.stats.potions);
      },
    };
    const sellAmulet = {
      label: 'Sell the lake-silver amulet. (80 gold)',
      next: 'amulet',
      if: () => !!g.flags.amuletKept && !g.flags.amuletSold && !g.flags.amuletReturned,
      do: () => {
        g.flags.amuletSold = true;
        if (g.player) g.player.addGold(80);
        if (state.mere === 1) { state.mere = 2; }
        qDone(QUESTS.mere, "Sold Enna's amulet for 80 gold");
      },
    };

    let greet;
    if (state.debt === 2) {
      greet = g.flags.debtChoice === 'blood'
        ? 'The Ember\'s Rest, safest taproom in the valley — ask anyone, now that Redfang\'s ' +
          'feeding crows. What\'ll it be, friend? And it IS friend.'
        : 'Welcome back! Trade\'s up since the west road opened — Redfang keeps a bargain once ' +
          'it\'s bought, I\'ll give the pig that much. What\'ll it be?';
    } else if (g.flags.drakeDead) {
      greet = 'The dragonslayer drinks at MY inn. I\'ve told the story eleven times today and ' +
        'it gets better every telling. What\'ll it be?';
    } else {
      greet = 'Welcome to the Ember\'s Rest — beds upstairs, stew\'s brown, ale\'s browner. ' +
        'What\'ll it be?';
    }
    N.greet = {
      text: greet,
      choices: [
        buyChoice,
        {
          label: 'You count your coin like it hurts. What\'s wrong?',
          next: 'd1',
          if: () => state.debt === 0,
        },
        {
          label: 'About your debt — here\'s the sixty. I\'ll see it delivered.',
          next: 'dPaid',
          if: () => state.debt === 1 && !g.flags.vargrDead && gold() >= 60,
          do: payDebt,
        },
        {
          label: 'Vargr Redfang is dead. Your ledger\'s clear.',
          next: 'dBlood',
          if: () => state.debt === 1 && !!g.flags.vargrDead,
          do: bloodDebt,
        },
        sellAmulet,
        { label: 'Farewell.', next: null },
      ],
    };
    N.shop = {
      text: 'Careful with those — I brew them strong enough to wake a stone. Anything else?',
      choices: [buyChoice, sellAmulet, { label: 'That\'s all.', next: null }],
    };
    N.amulet = {
      text: 'Lake-silver! Rare as honest weather, that... moon on the face, even. Wendel\'s ' +
        'Enna had one just like it, gods rest her. Well — eighty, as agreed. Odd how things ' +
        'wash around, isn\'t it?',
      choices: [{ label: 'Odd. Yes.', next: null }],
    };

    function payDebt() {
      if (state.debt !== 1 || !g.player || g.player.stats.gold < 60) return;
      g.player.addGold(-60);
      settleDebt('coin');
    }
    function bloodDebt() {
      if (state.debt !== 1) return;
      settleDebt('blood');
    }
    function settleDebt(how) {
      state.debt = 2;
      g.flags.debtChoice = how;
      if (how === 'coin') g.flags.campPeaceful = true;
      if (g.player) g.player.stats.potions += 3;
      notify('Bram\'s gratitude', 'Three of his own draughts, pressed into your hands');
      qDone(QUESTS.debt, how === 'coin'
        ? 'Paid Vargr off — the west road is quiet'
        : 'Vargr Redfang is dead — the debt died with him');
    }

    N.d1 = {
      text: 'That obvious? ...Vargr Redfang. Bandit lord squatting in the west hills. My boy ' +
        'ran the inn\'s strongbox through his valley in spring and Vargr "taxed" it — calls ' +
        'the shortfall a debt now. Sixty gold, or he collects in fingers. Mine or the boy\'s. ' +
        'He wasn\'t specific.',
      choices: [
        {
          label: 'Here\'s sixty. Consider it settled.',
          next: 'dPaid',
          if: () => gold() >= 60,
          do: () => {
            state.debt = 1;
            qStart(QUESTS.debt, "Settle Bram's debt");
            payDebt();
          },
        },
        {
          label: 'Redfang can collect from my blade.',
          next: 'd2',
          do: () => {
            if (state.debt !== 0) return;
            state.debt = 1;
            qStart(QUESTS.debt, "Settle Bram's debt — 60 gold, or Vargr Redfang's head");
          },
        },
        { label: 'Not my ledger.', next: 'd3' },
      ],
    };
    N.d2 = {
      text: 'He\'s no field bandit — he remembers faces, holds grudges like coin, and every ' +
        'man who\'s hurt him has paid double for it later. However it lands, gold or blood... ' +
        'I won\'t forget it. Camp\'s west, under the skull totems.',
      choices: [{ label: 'Farewell.', next: null }],
    };
    N.d3 = {
      text: 'No. No, of course not. Forget I— the stew\'s brown, the ale\'s browner, and ' +
        'everything here is fine.',
      choices: [{ label: 'Farewell.', next: null }],
    };
    N.dPaid = {
      text: 'You\'d carry sixty gold west for a fat innkeep you barely know? I— gods. Take ' +
        'these, and don\'t argue: brewed for bad nights, and it sounds like you go looking ' +
        'for yours. The road just got safer for everyone. One purse lighter, but safer.',
      choices: [{ label: 'Keep the stew warm.', next: null }],
    };
    N.dBlood = {
      text: 'Dead? Vargr Redfang is DEAD? Ha! HA! ...I shouldn\'t laugh at a killing. Yes I ' +
        'should. Take these — brewed for bad nights, and you clearly make your own. First ' +
        'ale\'s free until I stop grinning, which may be never.',
      choices: [{ label: 'Keep the stew warm.', next: null }],
    };

    return { start: 'greet', nodes: N };
  }

  // -------------------------------------------------------------- Wendel ---
  function wendelTree() {
    const N = {};
    let start = 'idle';
    const found = () => !!g.flags.amuletFound;
    const doReturn = () => {
      g.flags.amuletReturned = true;
      g.flags.amuletKept = false;
      g.flags.wendelLantern = true;
      if (state.mere === 1) {
        state.mere = 2;
        if (g.player) g.player.addGold(30);
        qDone(QUESTS.mere, 'Enna\'s amulet is home — 30 gold');
      }
    };

    if (g.flags.amuletReturned) {
      N.idle = {
        text: 'She\'s here. ...He taps his chest, where a moon-faced coin of silver hangs. ' +
          'The lamp\'s lit tonight, and it\'ll be lit tomorrow. That\'s more than most men my ' +
          'age get to say.',
        choices: [{ label: 'Good night, Wendel.', next: null }],
      };
    } else if (g.flags.amuletSold) {
      N.idle = {
        text: 'Bram says a trader came through with lake-silver. Moon on the face, he says. ' +
          'Funny old world — that the lake would give up its dead to a stranger and not to ' +
          'me. ...Well. The seam of the day\'s come loose again. Good night.',
        choices: [{ label: 'Good night, Wendel.', next: null }],
      };
    } else if (state.mere === 0) {
      start = 'w1';
      N.w1 = {
        text: 'Evening. Or morning — I lose the seam of the day out here. You\'re the one ' +
          'Maera has running the whole valley? Then you\'ll pass Mirrormere sooner or later, ' +
          'and I\'d ask a small thing of anyone passing.',
        choices: [
          { label: 'Ask it.', next: 'w2' },
          { label: 'Another time, old man.', next: null },
        ],
      };
      N.w2 = {
        text: 'My Enna. Three winters gone. She\'d row out at dusk and the lake would go still ' +
          'for her — I\'d swear it on the harvest. Her amulet went down with the boat, off the ' +
          'old south dock. Lake-silver, a moon on its face. It\'s all of her that\'s left to ' +
          'find, and I\'m too old to dive.',
        choices: [
          {
            label: 'I\'ll search the dock.',
            next: 'w3',
            do: () => {
              if (state.mere !== 0) return;
              state.mere = 1;
              qStart(QUESTS.mere, "Search the old dock on Mirrormere's south shore");
            },
          },
          { label: 'The lake keeps what it takes.', next: 'w4' },
        ],
      };
      N.w3 = {
        text: 'The boards are half-rot, mind your step. And... whatever you find or don\'t — ' +
          'come tell me either way. Not knowing is the heaviest part.',
        choices: [{ label: 'Farewell.', next: null }],
      };
      N.w4 = {
        text: 'Aye. Maybe it does. But it doesn\'t love what it takes, and I did. If you pass ' +
          'the south dock — that\'s all I ask. If you pass.',
        choices: [
          {
            label: 'If I pass... I\'ll look.',
            next: 'w3',
            do: () => {
              if (state.mere !== 0) return;
              state.mere = 1;
              qStart(QUESTS.mere, "Search the old dock on Mirrormere's south shore");
            },
          },
          { label: 'Farewell.', next: null },
        ],
      };
    } else if (state.mere >= 1 && !found()) {
      N.idle = {
        text: 'The south dock — where the shore looks back at the village. The boards are ' +
          'half-rot. Enna would tell you to mind your boots and never mind her silver.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    } else if (found() && g.flags.amuletKept) {
      // The player lied. Redemption is still on the table until it's sold.
      start = 'k1';
      N.k1 = {
        text: 'You\'d think the lake would give SOMETHING back, wouldn\'t you. Silt and old ' +
          'rope, you said. ...Forgive me. An old man shouldn\'t pick at a kindness like a scab.',
        choices: [
          {
            label: 'About the dock. I found this — it\'s yours.',
            next: 'k2',
            do: doReturn,
          },
          { label: 'Good night, Wendel.', next: null },
        ],
      };
      N.k2 = {
        text: 'Oh. ...Oh, there she is. He doesn\'t ask why. He never will. He ties it round ' +
          'his neck with shaking hands and looks twenty years younger and a hundred years ' +
          'older, both at once. The lamp will be lit tonight. You\'ll see it from the fields.',
        choices: [{ label: 'Good night, Wendel.', next: null }],
      };
    } else if (found()) {
      start = 'f1';
      N.f1 = {
        text: 'You went out there. I can see it in your boots — Mirrormere mud dries grey. ' +
          'Did the water... did you find her silver?',
        choices: [
          {
            label: 'It\'s here. Take it.',
            next: 'f2',
            do: doReturn,
          },
          {
            label: 'The dock was bare. Silt and old rope.',
            next: 'f3',
            do: () => {
              g.flags.amuletKept = true;
              qUpdate(QUESTS.mere, 'You kept the amulet. Lake-silver sells — Bram would pay 80 gold.');
            },
          },
        ],
      };
      N.f2 = {
        text: 'Oh. Oh, there she is. He ties it round his neck with shaking hands. I\'ll light ' +
          'the lamp for her tonight — she always found the house by it. You\'ll see it burning ' +
          'any night you pass, and you\'ll know why. Here — thirty in silver. It\'s nothing ' +
          'against what you\'ve carried back, but take it.',
        choices: [{ label: 'Wear it well, Wendel.', next: null }],
      };
      N.f3 = {
        text: '...Aye. Of course. Three winters of current — it was a foolish hope, and old men ' +
          'keep those the way other men keep dogs. Thank you for wading, stranger. Truly. Few ' +
          'would have.',
        choices: [{ label: 'Good night, Wendel.', next: null }],
      };
    } else {
      N.idle = {
        text: 'The fields don\'t weed themselves, and the day\'s lost its seam again. Safe ' +
          'roads, stranger.',
        choices: [{ label: 'Farewell.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  return { update, markerPos, serialize, deserialize, npcs };
}


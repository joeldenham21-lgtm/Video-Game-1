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
  // Loose matcher — the enemies agent owns exact type strings for the new
  // roster, so match on type OR display name.
  function killedIs(d, keys) {
    const s = ((d.type || '') + ' ' + (d.name || '')).toLowerCase();
    for (let i = 0; i < keys.length; i++) if (s.indexOf(keys[i]) >= 0) return true;
    return false;
  }

  ev.on('enemyKilled', (d) => {
    if (!d) return;

    // --- The Crone of the Pines: Grimhilde slain ---
    if (killedIs(d, ['grimhilde', 'witch', 'crone'])) {
      g.flags.witchDead = true;
      g.flags.witchHostile = true; // she certainly is no friend of yours now
      if (state.crone >= 1 && state.crone <= 5) {
        state.crone = 6;
        notify('Grimhilde is dead', 'The green light gutters out among the pines.');
        qUpdate(QUESTS.crone, 'The witch is dead — bring word to Wendel');
      }
    }

    // --- Blood Below the Barrows: Morvane destroyed ---
    if (killedIs(d, ['morvane', 'vampire lord', 'vampire_lord', 'vampirelord'])) {
      g.flags.morvaneDead = true;
      if (state.blood >= 1 && state.blood <= 4) {
        const pact = !!g.flags.morvanePact;
        state.blood = 5;
        notify('Morvane is ash', pact
          ? 'The pact-mark on your wrist goes quiet. Three doors stay dark.'
          : 'The crypt exhales, and the dark below is only dark.');
        qDone(QUESTS.blood, pact
          ? 'The bargain is paid in ash — but Jori, Hessa and Marta are not coming home'
          : 'Morvane is destroyed. Osric is avenged');
      }
    }

    // --- The Toll of Stonebridge: the direct approach ---
    if (killedIs(d, ['troll'])) {
      g.flags.trollDead = true;
      if (state.toll === 1) {
        state.toll = 3;
        qDone(QUESTS.toll, 'The troll is dead — Stonebridge stands open');
      }
    }

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
    // Morvane's drop (destroyed-him path): the seal works for the living too.
    if (d.itemId === 'bloodseal') {
      notify('The Bloodseal', 'A cold sigil, taken not given. Your blade drinks deeper after dark: +15% night damage.');
    }
  });

  // ==========================================================================
  // Update: auto-start, beacon watch, waves, discovery
  // ==========================================================================
  let discT = 0;
  let wasNight = null; // dawn edge detector for the pact (null = uninitialized)

  // The Bloodseal: +15% damage after sundown. Applied/removed through
  // player.bonus.dmg with a persisted marker flag so save/load (which stores
  // both flags AND bonus) stays consistent in every combination.
  function hasBloodseal() {
    return !!(g.flags.morvanePact || g.flags.item_bloodseal);
  }
  function updateBloodseal() {
    if (!g.player || !g.player.bonus) return;
    const want = hasBloodseal() && isNight();
    if (want && !g.flags.bloodsealApplied) {
      g.player.bonus.dmg += 0.15;
      g.flags.bloodsealApplied = true;
    } else if (!want && g.flags.bloodsealApplied) {
      g.player.bonus.dmg -= 0.15;
      g.flags.bloodsealApplied = false;
    }
  }

  // A villager vanishes each dawn while Morvane's pact stands.
  function onDawn() {
    if (!g.flags.morvanePact || g.flags.morvaneDead) return;
    if (state.blood !== 3 && state.blood !== 4) return;
    state.vanished++;
    if (state.vanished === 1) {
      notify('Dawn over Emberhollow', "Jori the cooper's lad did not come to the well this morning.");
    } else if (state.vanished === 2) {
      notify('Another dawn', "Old Hessa's loom stands silent. Her door was open to the wind.");
    } else if (state.vanished === 3) {
      notify('A third dawn', "Marta's garden gate swings unlatched. The pact keeps its terms.");
    } else {
      notify('Dawn', 'Another door in Emberhollow stands open to the wind.');
    }
    if (state.blood === 3 && state.vanished >= 3) {
      state.blood = 4;
      qUpdate(QUESTS.blood, 'End Morvane — no bargain is worth the dawn count');
    } else if (state.blood === 3) {
      qUpdate(QUESTS.blood, 'The pact holds. ' + state.vanished + ' gone at dawn. Morvane waits below.');
    }
  }

  // First-visit callouts for the wave-2 spots (not core.POIS — notify only).
  function checkSpots(px, pz) {
    if (!g.flags.spotHut && dist2d(px, pz, SPOT.hut.x, SPOT.hut.z) < 42) {
      g.flags.spotHut = true;
      notify("The Crone's Hut", 'Smoke through the pines that does not rise straight.');
    }
    if (!g.flags.spotGraves && dist2d(px, pz, SPOT.graves.x, SPOT.graves.z) < 45) {
      g.flags.spotGraves = true;
      notify('The Barrowdeep Cemetery', 'Leaning stones and dead trees. The ground remembers.');
    }
    if (dist2d(px, pz, SPOT.bridge.x, SPOT.bridge.z) < 42) {
      if (!g.flags.spotBridge) {
        g.flags.spotBridge = true;
        notify('Stonebridge', 'Something huge shifts in the shadow beneath the span.');
      }
      // Meeting the troll starts the quest — he makes sure of that.
      if (state.toll === 0 && !g.flags.trollDead) {
        state.toll = 1;
        qStart(QUESTS.toll, 'A troll bars Stonebridge — pay his toll, or argue in steel');
      }
    }
  }

  function update(dt) {
    // NPC visuals tick even while paused (Interact clip during dialogue);
    // movement freezes inside updateNPCs when g.paused.
    updateNPCs(dt);
    if (g.paused) return;

    // Bloodseal night buff + dawn ledger
    updateBloodseal();
    const night = isNight();
    if (wasNight === null) wasNight = night;
    else if (wasNight && !night) { wasNight = night; onDawn(); }
    else wasNight = night;

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
        checkSpots(p.x, p.z);
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
    }
    // No main objective → guide the most urgent side quest.
    if (state.blood === 4) return markAt(SPOT.crypt.x, SPOT.crypt.z); // the dawns are counting
    if (state.crone === 1 || state.crone === 5) return markAt(SPOT.hut.x, SPOT.hut.z);
    if (state.crone === 2) return markAt(SPOT.well.x, SPOT.well.z);
    if (state.crone === 3) return markAt(SPOT.hut.x, SPOT.hut.z);
    if (state.crone === 6) return markNpc(npcs.wendel);
    if (state.blood === 1) return markAt(SPOT.graves.x, SPOT.graves.z);
    if (state.blood === 2) return markAt(SPOT.crypt.x, SPOT.crypt.z); // pact (3) shows no marker — you chose this
    if (state.toll === 1) return markAt(SPOT.bridge.x, SPOT.bridge.z);
    return null;
  }

  // ==========================================================================
  // Serialization
  // ==========================================================================
  function serialize() {
    return {
      main: state.main, stage: state.stage, pelts: state.pelts,
      fold: state.fold, debt: state.debt, mere: state.mere,
      crone: state.crone, blood: state.blood, toll: state.toll,
      vanished: state.vanished,
    };
  }

  function deserialize(o) {
    if (!o) return;
    for (const k of ['main', 'stage', 'pelts', 'fold', 'debt', 'mere',
      'crone', 'blood', 'toll', 'vanished']) {
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
    // Wave-2 side quests — repopulate journal entries for whatever's live.
    if (state.crone >= 1 && state.crone <= 3) {
      qStart(QUESTS.crone, state.crone === 1
        ? "Seek the witch's hut in the southern pines"
        : state.crone === 2
          ? 'Inspect the old stock-well north of the fold'
          : 'Bring the truth to Grimhilde — or to Wendel');
    } else if (state.crone === 5) {
      qStart(QUESTS.crone, 'Drive Grimhilde from the pines');
    } else if (state.crone === 6) {
      qStart(QUESTS.crone, 'The witch is dead — bring word to Wendel');
    }
    if (state.blood >= 1 && state.blood <= 4) {
      qStart(QUESTS.blood, state.blood === 1
        ? 'Search the cemetery by Barrowdeep — after dark'
        : state.blood === 2
          ? 'Enter the barrow crypt — at night, when it wakes'
          : state.blood === 3
            ? 'The pact holds. Do not count the dawns.'
            : 'End Morvane — no bargain is worth the dawn count');
    }
    if (state.toll === 1) {
      qStart(QUESTS.toll, (g.flags.trollPaid | 0) >= 1
        ? 'The troll honors one toll... once. Pay again, or fight'
        : 'A troll bars Stonebridge — pay his toll, or argue in steel');
    }
    // Dawn detector re-arms from current time-of-day on load.
    wasNight = null;
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

    // --- The Crone of the Pines: Maera does not forgive the torch. Her
    // disapproval shadows every later conversation on the idle branches.
    if (g.flags.croneChoice === 'blood' && N.idle) {
      N.mCrone = {
        text: 'I\'ve buried plague-dead, drake-burned, and men who picked fights with rivers. ' +
          'Grimhilde set half their bones and asked for firewood in return. Her tea was ' +
          'bitter and her tongue worse, and this valley was safer with both. She looks past ' +
          'you, toward the pines. You did what a frightened village asked of you. Sit with ' +
          'how easy that was, some night.',
        choices: [
          { label: 'The herds were dying, Maera.', next: 'mCrone2' },
          { label: 'Farewell.', next: null },
        ],
      };
      N.mCrone2 = {
        text: 'Herds die, stranger. That is what winter is FOR. Courage would have been the ' +
          'truth carried up the square in daylight; fear only needed a blade, and blades are ' +
          'cheap. She turns back to the well. We won\'t speak of it again. But I will think ' +
          'of it every time you pass.',
        choices: [{ label: 'Farewell.', next: null }],
      };
      N.idle.choices.unshift({ label: 'You\'ve been cold since the pines, Maera.', next: 'mCrone' });
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
        {
          label: 'You look like a man who hasn\'t slept.',
          next: 'v1',
          if: () => state.blood === 0,
        },
        {
          label: 'Any word of the missing?',
          next: 'vGuilt',
          if: () => state.blood === 3 || state.blood === 4,
        },
        {
          label: 'About Osric. It\'s finished.',
          next: 'vDone',
          if: () => state.blood === 5 && !g.flags.bramBloodClosure,
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

    // --- Blood Below the Barrows: Bram's night terrors and the missing guest.
    N.v1 = {
      text: 'That obvious too? ...Nine nights now. A wool-trader — Osric — took the corner ' +
        'bed, paid a week through, ate like a man with nowhere better to be. Walked out at ' +
        'dusk to "see the old stones" and never came back for his boots. His BOOTS, stranger. ' +
        'A man comes back for his boots.',
      choices: [
        { label: 'And the dreams?', next: 'v2' },
        { label: 'Travelers wander off. It happens.', next: 'vDecl' },
      ],
    };
    N.v2 = {
      text: 'He leans close and drops his voice under the fire-crackle. He stands in the lane. ' +
        'Every night since. Wrong-eyed — like lamplight behind smoked glass. He asks to come ' +
        'in, polite as Sunday, and I wake with the window open and frost on the INSIDE of the ' +
        'glass. My gran had a word for guests like that. It wasn\'t "guest".',
      choices: [
        {
          label: 'I\'ll search the barrows. After dark.',
          next: 'v3',
          do: () => {
            if (state.blood !== 0) return;
            state.blood = 1;
            qStart(QUESTS.blood, 'Search the cemetery by Barrowdeep — after dark');
          },
        },
        { label: 'Dreams are dreams, Bram. Sleep with the window barred.', next: 'vDecl' },
      ],
    };
    N.v3 = {
      text: 'The graves by Barrowdeep — that\'s where folk say the ground\'s been turned. Go ' +
        'armed, go fed, and if a polite voice asks you to come CLOSER... you charge it my ' +
        'full winter rate. He tries to smile. It doesn\'t take.',
      choices: [{ label: 'Keep the lamps lit.', next: null }],
    };
    N.vDecl = {
      text: 'No. No, fair enough. He wipes a clean mug cleaner. I\'ll keep the corner bed ' +
        'made, then. He paid the week through, after all. Paid the whole week through.',
      choices: [{ label: 'Farewell.', next: null }],
    };
    N.vGuilt = {
      text: state.vanished === 0
        ? 'Osric, still. But the nights have gone quiet — no one in the lane, no frost. He ' +
          'looks at you a moment too long. You went out to the barrows, didn\'t you. And came ' +
          'back... rested.'
        : state.vanished < 3
          ? 'Jori didn\'t come for the morning bread. Then Hessa\'s loom stopped mid-cloth. ' +
            'He counts mugs without seeing them. Doors don\'t open THEMSELVES at dawn, ' +
            'stranger. Something out there is keeping terms with somebody.'
          : 'Three. THREE, and no wardens, and the roads quiet, and nobody counting but me. ' +
            'He grips the bar until the wood complains. Whatever you found under the barrows ' +
            '— and I think you found something — FINISH it. I\'ll pay what an innkeep can. ' +
            'Just finish it.',
      choices: [{ label: 'The nights aren\'t done with me yet.', next: null }],
    };
    N.vDone = {
      text: state.vanished > 0
        ? 'He sets three mugs on the bar, then a fourth, and fills none of them. Done, you ' +
          'said. Ash, you said. He nods, slow. I\'ll tell you what I tell my dreams: done ' +
          'matters. Done is worth something. But it isn\'t worth three of everything, ever ' +
          'again.'
        : 'You gave a stranger his grave back, and this valley one less polite voice in the ' +
          'dark. He slides a purse across the bar. Osric\'s board — the week he paid and ' +
          'never slept. He\'d want the one who avenged him to drink it. That\'s innkeep ' +
          'theology, and I\'m sticking to it.',
      choices: [
        {
          label: state.vanished > 0 ? 'I\'ll carry the count, Bram.' : 'To Osric, then.',
          next: null,
          do: () => {
            if (g.flags.bramBloodClosure) return;
            g.flags.bramBloodClosure = true;
            if (state.vanished === 0 && g.player) {
              g.player.addGold(40);
              notify("Osric's board", '40 gold — innkeep theology');
            }
          },
        },
      ],
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

    // --- The Crone of the Pines: Wendel is the herds' man, so the whisper,
    // the truth, and the reckoning all pass through him. Hook into whatever
    // branch of his amulet-tree is live.
    const croneAccept = () => {
      if (state.crone !== 0) return;
      state.crone = 1;
      qStart(QUESTS.crone, "Seek the witch's hut in the southern pines");
    };
    N.cw1 = {
      text: 'Ehh. You\'ve heard the whispering, then. Two heifers dead, a third gone hollow ' +
        'and dry, and Sunna\'s boy swears he saw the crone digging at the field\'s edge by ' +
        'moonlight. Folk want her burned. I\'ve... buried a wife, stranger. It makes a man ' +
        'slow to bury anyone else on a maybe.',
      choices: [
        { label: 'I\'ll find the truth of it.', next: 'cw2', do: croneAccept },
        { label: 'Maybe the village is right to be afraid.', next: 'cw3' },
        { label: 'Not my herds.', next: null },
      ],
    };
    N.cw2 = {
      text: 'Her hut\'s south-west, deep in the pines — follow the smoke that doesn\'t rise ' +
        'straight. And stranger... whatever you find out there, bring back the TRUTH. Not ' +
        'just a story. We\'ve enough stories; it\'s truth we\'re short of.',
      choices: [{ label: 'Farewell.', next: null }],
    };
    N.cw3 = {
      text: 'Maybe. Fear\'s right about once a year, by my count. It\'s the other three ' +
        'hundred days that worry me — fear doesn\'t clean up after itself.',
      choices: [
        { label: 'Then I\'ll find the truth of it.', next: 'cw2', do: croneAccept },
        { label: 'Farewell.', next: null },
      ],
    };
    N.cwT = {
      text: 'A stag? In the STOCK-WELL? He sits down slowly on the fence rail. ...Gods. Two ' +
        'moons we drank fear like it was water, and it was just — winter. And her out there ' +
        'pulling the rot out of our cattle while we sharpened her name at supper.',
      choices: [
        {
          label: 'Grimhilde heals your herds. She has for years.',
          next: 'cwT2',
          do: () => {
            if (state.crone !== 3) return;
            state.crone = 4;
            g.flags.croneChoice = 'peace';
            grantCharm();
            qDone(QUESTS.crone, 'The valley and its witch have made peace — her door is open to you');
          },
        },
      ],
    };
    N.cwT2 = {
      text: 'Then the village will hear it from ME, and they\'ll sit still for it. He nods, ' +
        'firming up around the idea. I\'ll take her honey myself. First basket. A man should ' +
        'carry his own apologies while his legs still work. ...Days later, a knot of ' +
        'pine-root and red thread hangs at your door. It smells of resin, and of being wrong.',
      choices: [{ label: 'Good ending to a bad season.', next: null }],
    };
    N.cwD = {
      text: 'It\'s done, then. There was smoke over the pines this morning. He looks at his ' +
        'boots for a while. Folk are grateful — Marta sent a cake to the inn, first cake in ' +
        'this village since the burnings up north. Here. The herd-money we\'d scraped for a ' +
        'witch-finder. You\'ve... earned it. That\'s the word we\'re using.',
      choices: [
        {
          label: 'Take the purse.',
          next: 'cwD2',
          do: () => {
            if (state.crone !== 6) return;
            state.crone = 7;
            g.flags.croneChoice = 'blood';
            if (g.player) g.player.addGold(60);
            qDone(QUESTS.crone, 'The witch is gone. The village calls it justice — 60 gold');
            notify('Maera said nothing', 'Her door was shut before you crossed the square.');
          },
        },
      ],
    };
    N.cwD2 = {
      text: g.flags.wellCleansed
        ? 'The herds are mending, anyway — since the well came clean. He doesn\'t look up ' +
          'when he says it. Since the WELL came clean. Funny, how that worked out. ...Well. ' +
          'Safe roads, stranger.'
        : 'The third heifer\'s still sick, mind. Curse takes a while to lift, they say. He ' +
          'watches the pines a moment too long. ...They say. Safe roads, stranger.',
      choices: [{ label: 'Farewell.', next: null }],
    };
    N.cwP = {
      text: g.flags.croneChoice === 'peace'
        ? 'Fat and stupid, gods keep them. The crone sent a salve for Marta\'s knee, and ' +
          'Marta sent honey back. Strange season. Good strange — the kind you don\'t question ' +
          'too loud in case it hears you.'
        : g.flags.wellCleansed
          ? 'Mending, since the well came clean. He busies his hands with the fence. We ' +
            'don\'t talk about the pines much. Turns out there\'s not much to say that sits well.'
          : 'The third heifer died Tuesday. Curse takes a while to lift, folk say. ...Folk ' +
            'say a lot of things. Said a lot of things.',
      choices: [{ label: 'Farewell.', next: null }],
    };
    {
      // Inject the live crone topic into whatever node greets the player —
      // but only where the greeting already ends in a farewell, so we never
      // wedge gossip into the middle of the amulet decision.
      const entry = N[start];
      const last = entry && entry.choices && entry.choices[entry.choices.length - 1];
      if (last && last.next === null) {
        let hook = null;
        if (state.crone === 0) {
          hook = { label: 'Folk say a witch is souring the herds.', next: 'cw1' };
        } else if (state.crone === 3 && g.flags.wellCleansed) {
          hook = { label: 'About the witch — and your well.', next: 'cwT' };
        } else if (state.crone === 6) {
          hook = { label: 'The witch of the pines is dead.', next: 'cwD' };
        } else if (state.crone === 4 || state.crone === 7) {
          hook = { label: 'How fare the herds?', next: 'cwP' };
        }
        if (hook) entry.choices.splice(Math.max(0, entry.choices.length - 1), 0, hook);
      }
    }

    return { start, nodes: N };
  }

  // ----------------------------------------------------------- Grimhilde ---
  // The witch of the pines. Innocent, prickly, and very tired of torches.
  function grimhildeTree() {
    const N = {};
    let start = 'g1';
    const gold = () => (g.player ? g.player.stats.gold : 0);

    // One-time charm + reconciliation reward, shared by both peace endings.
    const makePeace = () => {
      if (state.crone === 4 || state.crone === 7) return;
      state.crone = 4;
      g.flags.croneChoice = 'peace';
      grantCharm();
      qDone(QUESTS.crone, 'The valley and its witch have made peace — her door is open to you');
    };

    if (g.flags.croneChoice === 'peace') {
      // Vendor: potions at 15g (Bram charges 20 — she undercuts him happily).
      start = 'v1';
      const buy = {
        label: 'Buy a pine-bitter draught. (15 gold)',
        next: 'vBuy',
        if: () => gold() >= 15,
        do: () => {
          if (!g.player || g.player.stats.gold < 15) return;
          g.player.addGold(-15);
          g.player.stats.potions += 1;
          notify('Pine-bitter draught', 'Potions: ' + g.player.stats.potions);
        },
      };
      N.v1 = {
        text: 'The kettle knows your step now. Sit, or don\'t — you strike me as a don\'t. ' +
          'The village sends its sick to me openly again. Wendel brought honey. HONEY. Fifty ' +
          'years in these pines and it took a stranger with well-rot on their boots.',
        choices: [
          buy,
          { label: 'What\'s in the draughts?', next: 'v2' },
          { label: 'Farewell, Grimhilde.', next: null },
        ],
      };
      N.vBuy = {
        text: 'Drink it slow or it comes back up singing. Fifteen — the fat innkeep charges ' +
          'twenty and his taste like regret. Anything else?',
        choices: [buy, { label: 'That\'s all.', next: null }],
      };
      N.v2 = {
        text: 'Pine resin, marsh-mallow root, three things you\'d rather not know, and one ' +
          'thing I\'ll never tell. It mends what\'s torn and quiets what\'s loud. The village ' +
          'called that witchcraft for fifty years. Now they call it "the old woman\'s way." ' +
          'Progress limps, but it walks.',
        choices: [buy, { label: 'Farewell.', next: null }],
      };
    } else if (state.crone === 3) {
      // The player has hauled the stag from the well: the truth is in hand.
      start = 'r1';
      N.r1 = {
        text: 'You smell of well-rot and honest work — there\'s a sentence I don\'t say twice. ' +
          'So. A winter stag, drowned and swelling since the thaw, poisoning every trough from ' +
          'the fold to the mill. And they burned MY name for it around their suppers.',
        choices: [
          { label: 'Wendel will hear the truth. The village will stand down.', next: 'r2', do: makePeace },
          { label: 'They were afraid. Fear needed a face.', next: 'r3' },
        ],
      };
      N.r2 = {
        text: 'Then take this. Pine-root, red thread, and a word older than the valley — wear ' +
          'it, and hurts will find you harder to hold. And tell them my door is open. To the ' +
          'sick, and to you. For the rest it can stay a story — stories keep the firewood ' +
          'thieves away.',
        choices: [{ label: 'Wear it well yourself, Grimhilde.', next: null }],
      };
      N.r3 = {
        text: 'Fear always needs a face, and mine\'s cheap: old, alone, and good with herbs. ' +
          'You could have given them the stag\'s face instead. You still can.',
        choices: [
          { label: 'I will. The village stands down today.', next: 'r2', do: makePeace },
          { label: 'I need to think.', next: null },
        ],
      };
    } else if (state.crone === 1 || state.crone === 2) {
      // Investigation: her side of the story.
      start = 'q1';
      const goHostile = () => {
        if (state.crone >= 4) return;
        g.flags.witchHostile = true;
        state.crone = 5;
        qUpdate(QUESTS.crone, 'You chose the torch — drive Grimhilde from the pines');
      };
      N.q1 = {
        text: 'Come to burn the witch? You\'d be the third this year. The first two left with ' +
          'poultices for their trouble. Well? The kettle\'s on and my patience isn\'t.',
        choices: [
          { label: 'The herds sicken. The village names you.', next: 'q2' },
          { label: 'The valley wants you gone, crone.', next: 'qWarn' },
        ],
      };
      N.q2 = {
        text: 'My work is why only the herds are sick and not the children. Two moons I\'ve ' +
          'been pulling the same rot out of cattle that drink at the old stock-well past the ' +
          'fold — something died in its throat this winter and nobody thought to look, because ' +
          'looking is work and hating me is Sunday sport. Go see for yourself. Or fetch your ' +
          'torch. I\'m here either way. I\'m always here.',
        choices: [
          {
            label: 'I\'ll look at the well.',
            next: 'q3',
            do: () => {
              if (state.crone === 1) {
                state.crone = 2;
                qUpdate(QUESTS.crone, 'Inspect the old stock-well north of the fold');
              }
            },
          },
          { label: 'Or I end this now.', next: 'qWarn' },
        ],
      };
      N.q3 = {
        text: 'North of Sylva\'s fold, sunk in the pasture weeds. Mind the rope — it was old ' +
          'when I was young. And when you\'ve seen what\'s down there, tell THEM. Truth from ' +
          'me is witchcraft. From you it\'s news.',
        choices: [{ label: 'Farewell.', next: null }],
      };
      N.qWarn = {
        text: 'Then you\'re exactly the fool this village deserves. She rises, and the green ' +
          'light gathers in her hands like sickness given shape. Fifty years I healed them. ' +
          'Know this before you swing: I heal slow, and I hate fast.',
        choices: [
          { label: 'So be it, witch.', next: null, do: goHostile },
          { label: 'Wait. Show me your proof first.', next: 'q2' },
        ],
      };
    } else {
      // No rumor yet — a stranger at a strange door.
      N.g1 = {
        text: 'Lost, or curious? Both pay the same toll here: none. But the pines are mine ' +
          'after dark, stranger, and the village will tell you worse than that about me. ' +
          'Believe what you like. They will anyway.',
        choices: [{ label: 'Just passing, old mother.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  function grantCharm() {
    if (g.flags.witchCharm) return;
    g.flags.witchCharm = true;
    if (g.player) g.player.bonus.maxHp += 15;
    notify("The Crone's Charm", 'Pine-root and red thread: +15 max health');
  }

  // The sick well — the real culprit behind the cursed herds.
  function wellTree() {
    return {
      start: 'w1',
      nodes: {
        w1: {
          text: 'The rope is green with slime, and far below the water lies still and wrong. ' +
            'Something pale turns in it: a winter-dead stag, wedged and swollen, a whole ' +
            'season of poison seeping into every trough the herds drink from.',
          choices: [
            {
              label: 'Haul the carcass out. (Filthy work)',
              next: 'w2',
              do: () => {
                g.flags.wellCleansed = true;
                if (state.crone === 2) {
                  state.crone = 3;
                  qUpdate(QUESTS.crone, 'Bring the truth to Grimhilde — or to Wendel');
                }
                notify('The well runs foul no more', 'A dead stag. Not witchcraft. Someone owes an old woman an apology.');
              },
            },
            { label: 'Leave it. (Come back later)', next: null },
          ],
        },
        w2: {
          text: 'It comes up in pieces, and the smell will live in your clothes for days — ' +
            'but by the next rain the water will run clean. This was never witchcraft. Just ' +
            'winter, and bad luck, and fear filling the silence where the truth should be.',
          choices: [{ label: 'The village needs to hear this.', next: null }],
        },
      },
    };
  }

  // ---------------------------------------------------- the cemetery, night --
  function gravesTree() {
    return {
      start: 'c1',
      nodes: {
        c1: {
          text: 'Lantern-light finds the third grave open — thrown wide from the INSIDE, soil ' +
            'scattered like a door kicked off its hinges. In the dew lies a trader\'s satchel, ' +
            'wool samples still neatly tied. Osric\'s. Drag-marks lead away between the stones, ' +
            'down toward the barrow crypt, and in their bottom the dew has not settled.',
          choices: [
            {
              label: 'Something passed here tonight. Follow the drag-marks.',
              next: null,
              do: () => {
                if (state.blood !== 1) return;
                g.flags.guestFound = true;
                if (g.flags.morvaneDead) {
                  // The player already burned the crypt clean before asking why.
                  state.blood = 5;
                  qDone(QUESTS.blood, 'The thing that took Osric is already ash — the graves can rest');
                  return;
                }
                state.blood = 2;
                notify("Osric's satchel", 'He never left the barrows. Something carried him below.');
                qUpdate(QUESTS.blood, 'Enter the barrow crypt — at night, when it wakes');
              },
            },
          ],
        },
      },
    };
  }

  // ------------------------------------------------------------- Morvane ---
  // The vampire lord under Barrowdeep. Courteous, ancient, and utterly wrong.
  function morvaneTree() {
    const N = {};
    let start = 'm1';

    if (state.blood === 2) {
      const makePact = () => {
        if (state.blood !== 2) return;
        state.blood = 3;
        g.flags.morvanePact = true;
        g.flags.item_bloodseal = true;
        notify('The Bloodseal', 'Cold sinks into your wrist like a nail. +15% damage after dark.');
        qUpdate(QUESTS.blood, 'The pact holds. Do not count the dawns.');
      };
      N.m1 = {
        text: '"You smell of the road. Woodsmoke, iron... and the innkeep\'s stew." A pale ' +
          'figure unfolds from the dark between the coffins, courteous as a hangman. "He ' +
          'worries after his wool-trader. How touching. Worry is the better part of grief — ' +
          'I have spared him the rest."',
        choices: [
          { label: 'Where is Osric?', next: 'm2' },
          { label: 'You\'ll answer for him.', next: 'm3' },
        ],
      };
      N.m2 = {
        text: '"Below. What remains keeps well down here — the cold is kind that way. He was ' +
          'sweet with fear, if it comforts you. The fearful always are. The brave are thinner ' +
          'fare, but I confess... I prefer the conversation."',
        choices: [
          { label: 'Enough. This ends here.', next: 'm3' },
        ],
      };
      N.m3 = {
        text: '"Does it? Kill me, and you bleed for a stranger who is already bones. Or — ' +
          'leave me the dark below, and I make your nights profitable. My seal on your sword ' +
          'hand: after sundown, your blade drinks as I drink. And no villager will miss what ' +
          'I take from... travelers." He smiles. It has too much patience in it.',
        choices: [
          { label: 'Give me the seal. Keep your dark.', next: 'mPact', do: makePact },
          { label: 'The only thing you\'ll give me is ashes.', next: 'mFight' },
          { label: 'I need to think.', next: null },
        ],
      };
      N.mPact = {
        text: '"A wise hunger." His thumb presses your wrist and the cold goes in like a nail, ' +
          'and stays. "Hunt well after dark, little wolf. And do not count the dawns too ' +
          'closely — arithmetic has ruined finer arrangements than ours."',
        choices: [{ label: 'Leave the crypt.', next: null }],
      };
      N.mFight = {
        text: '"Then the stew-fat fool will grieve twice." He bows — courtly, unhurried, ' +
          'wrong. "Come, little wolf. The dark down here has been so dull."',
        choices: [{ label: 'Draw steel.', next: null }],
      };
    } else if (state.blood === 3 || state.blood === 4) {
      // Returning while the pact stands. He keeps the ledger better than you.
      start = 'p1';
      N.p1 = {
        text: state.vanished > 0
          ? '"You counted the dawns after all." He does not turn around. "Jori. Hessa. Marta. ' +
            'You knew their names — I never did. That was your half of the bargain, little ' +
            'wolf. Mine was only the taking."'
          : '"Back so soon? The seal itches, doesn\'t it. New gifts always do." He trails a ' +
            'finger along a coffin lid. "Go. Enjoy your nights. They are the finest part of ' +
            'our arrangement — for both of us."',
        choices: [
          { label: 'It ends tonight, Morvane.', next: 'p2' },
          { label: 'Not yet.', next: 'p3' },
        ],
      };
      N.p2 = {
        text: '"It always does, eventually." He turns, and the pact-mark on your wrist burns ' +
          'cold. "Keep the seal. I made it well, and the dead have no use for craftsmanship. ' +
          'Come, then — you owe me a better ending than the wool-trader gave."',
        choices: [{ label: 'Draw steel.', next: null }],
      };
      N.p3 = {
        text: '"No. Not yet. Never quite yet." The smile again, patient as winter. "Then go ' +
          'and eat at the inn, little wolf... and see who serves you."',
        choices: [{ label: 'Leave the crypt.', next: null }],
      };
    } else {
      // Shouldn't be reachable (interactable gates on blood state), but safe.
      N.m1 = {
        text: 'The crypt-dark swallows your voice. Nothing answers. Nothing needs to.',
        choices: [{ label: 'Leave.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  // ------------------------------------------------------- Grum the Troll ---
  function trollTree() {
    const N = {};
    let start = 't1';
    const gold = () => (g.player ? g.player.stats.gold : 0);
    const paid = () => (g.flags.trollPaid | 0);

    const payToll = () => {
      if (!g.player || g.player.stats.gold < 30) return;
      g.player.addGold(-30);
      g.flags.trollPaid = paid() + 1;
      if (g.flags.trollPaid >= 2) {
        g.flags.trollRespect = true;
        if (state.toll === 1) {
          state.toll = 2;
          qDone(QUESTS.toll, 'Twice paid — the troll respects coin. Stonebridge is free to you, forever');
        }
        notify('Coin-friend', 'Grum will never charge you again. He is very moved.');
      } else {
        if (state.toll === 1) {
          qUpdate(QUESTS.toll, 'Toll paid — the bridge is yours today. The troll remains');
        }
        notify('Toll paid', 'The troll bites your coin, nods gravely. It passes inspection.');
      }
    };

    if (g.flags.trollRespect) {
      start = 'f1';
      N.f1 = {
        text: 'COIN-FRIEND! Grum\'s bridge is your bridge. Walk in middle, is strongest part. ' +
          '...Nobody else pays toll now. All go around through river. Wet and stupid. Times ' +
          'is hard for honest troll.',
        choices: [
          { label: 'Times are hard everywhere, Grum.', next: 'f2' },
          { label: 'Keep the bridge standing.', next: null },
        ],
      };
      N.f2 = {
        text: 'Yes. YES. You understand economy. He sits down. The bridge groans. Grum had ' +
          'plan once: two bridges, double toll. But two bridges is two places to be, and Grum ' +
          'is one troll. He sighs, boulder-deep. Business is complicate.',
        choices: [{ label: 'Farewell, coin-friend.', next: null }],
      };
    } else if (paid() === 1) {
      N.t1 = {
        text: 'Small thing AGAIN. He holds up a finger the size of your forearm. Rule is rule: ' +
          'toll is for CROSSING, not for LIFE. Bridge got fresh-closed since you left. Thirty ' +
          'shiny. Is good bridge. Best bridge. Only bridge.',
        choices: [
          { label: 'Pay the thirty. Again. (30 gold)', next: 'tPay2', if: () => gold() >= 30, do: payToll },
          { label: 'I already paid you once, you great heap.', next: 't2' },
          { label: 'Walk away.', next: null },
        ],
      };
      N.tPay2 = {
        text: 'TWO thirty. He stares at the coins, then at you, then at the coins. Grum has ' +
          'never had two thirty from same small thing. You are... coin-friend. He says it like ' +
          'a coronation. Bridge is YOUR bridge now. Toll-free. Forever. Tell other small ' +
          'things: still closed.',
        choices: [{ label: 'An honor, Grum.', next: null }],
      };
      N.t2 = {
        text: 'Yes! And it was GOOD paying. Grum remembers. Grum tells the under-bridge fish ' +
          'about it. But yesterday-shiny is yesterday-bridge. He shrugs with geological ' +
          'slowness. Is not Grum\'s fault you keep leaving.',
        choices: [
          { label: 'Fine. Thirty. (30 gold)', next: 'tPay2', if: () => gold() >= 30, do: payToll },
          { label: 'The only toll I pay today is in teeth.', next: 'tFight' },
          { label: 'Walk away.', next: null },
        ],
      };
      N.tFight = {
        text: 'Teeth is bad money. He stands. The sun goes somewhere else. Grum gives refunds ' +
          'in FLAT.',
        choices: [{ label: 'Draw steel.', next: null }],
      };
    } else {
      N.t1 = {
        text: 'BRIDGE CLOSED. He rises from under the span like a hillside changing its mind. ' +
          'Is troll bridge. Troll law: small thing pays thirty shiny, or small thing goes ' +
          'around. Or — he cracks knuckles like falling masonry — small thing gets FLAT.',
        choices: [
          { label: 'Pay the toll. (30 gold)', next: 'tPay1', if: () => gold() >= 30, do: payToll },
          { label: 'Who taught a troll to count to thirty?', next: 't3' },
          { label: 'I could just kill you.', next: 'tThreat' },
          { label: 'Walk away.', next: null },
        ],
      };
      N.tPay1 = {
        text: 'He counts it twice, moving his lips, loses count, starts over, gives up and ' +
          'bites one. Mm. Real. Bridge open for you, small thing. TODAY. Tomorrow is new ' +
          'bridge. He pauses. Same bridge. New DAY. Toll rules is complicate.',
        choices: [{ label: 'A pleasure doing business.', next: null }],
      };
      N.t3 = {
        text: 'Grum taught Grum. He looks proud enough to burst. Started at one. Was long ' +
          'winter. He leans in, confidential, breath like a wet cave: past thirty is just ' +
          '"more thirty". Is why toll stops there. Honest pricing.',
        choices: [
          { label: 'Honest pricing. Here\'s thirty. (30 gold)', next: 'tPay1', if: () => gold() >= 30, do: payToll },
          { label: 'Walk away.', next: null },
        ],
      };
      N.tThreat = {
        text: 'Many small things say that. He nods slowly, agreeably. Grum counts them. ' +
          'A pause, vast and untroubled. Grum cannot count. Is MANY.',
        choices: [
          { label: 'Then it\'s teeth.', next: 'tFight' },
          { label: '...Thirty it is. (30 gold)', next: 'tPay1', if: () => gold() >= 30, do: payToll },
          { label: 'Walk away.', next: null },
        ],
      };
      N.tFight = {
        text: 'Teeth is bad money. He stands all the way up. The bridge stops being the ' +
          'biggest thing at the bridge. Grum gives refunds in FLAT.',
        choices: [{ label: 'Draw steel.', next: null }],
      };
    }

    return { start, nodes: N };
  }

  return { update, markerPos, serialize, deserialize, npcs };
}


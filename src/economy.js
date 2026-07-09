// ============================================================================
// ELDERFALL — economy.js (wave 3)
// The valley's coin: materials registry + inventory (g.flags.materials),
// vendor shops with a two-column barter panel (tap = trade 1, hold = ×5),
// reputation/daily seeded pricing with "market mood" lines, 8 respawning
// ore-vein interactables, chest valuables, and Fenwick the wandering
// merchant who walks the village↔Stonebridge road on a daily schedule.
// createEconomy(g) → { update(dt), MATERIALS, give, take, count,
//                      priceOf(id, vendor, buying), openShop(vendorId),
//                      closeShop(), rep(), gold(), addGold(n) }
// All state lives under g.flags (materials, matSeen, econDay, econRep,
// veinsMined, tomeHint_*) so save/load just works.
// ============================================================================
import * as THREE from 'three';
import {
  POIS, terrainHeight, terrainNormal, biomeAt, BIOME, dist2d, hash2,
  WATER_LEVEL,
} from './core.js';

export function createEconomy(g) {
  const ev = g.events;
  const notify = (text, sub) => ev.emit('notify', { text, sub });
  const sfx = (n) => { if (g.audio && g.audio.play) g.audio.play(n); };

  // ==========================================================================
  // Materials registry — ids/values are the wave-3 contract; forge/endgame
  // agents read this through g.economy.MATERIALS. Valuables are sell-only.
  // ==========================================================================
  const MATERIALS = {
    iron_ore:       { name: 'Iron Ore',        value: 8,   desc: 'Rust-red stone, heavy with promise.' },
    iron_ingot:     { name: 'Iron Ingot',      value: 20,  desc: "Smelted bar stock — the smith's daily bread." },
    silver_ore:     { name: 'Silver Ore',      value: 18,  desc: 'Pale ore threaded with moonlight.' },
    silver_ingot:   { name: 'Silver Ingot',    value: 45,  desc: 'Purified silver. Death to the restless dead.' },
    leather:        { name: 'Leather',         value: 12,  desc: 'Tanned hide, supple and strong.' },
    pelt:           { name: 'Wolf Pelt',       value: 10,  desc: 'A thick grey pelt, cleanly taken.' },
    ancient_bone:   { name: 'Ancient Bone',    value: 15,  desc: "Barrow-dry bone, older than the valley's name." },
    ember_crystal:  { name: 'Ember Crystal',   value: 40,  desc: 'It stays warm no matter the weather.' },
    frost_shard:    { name: 'Frost Shard',     value: 40,  desc: 'Cold that never melts, caught mid-gleam.' },
    storm_core:     { name: 'Storm Core',      value: 60,  desc: 'A knot of caged lightning. It hums to the touch.' },
    blood_gem:      { name: 'Blood Gem',       value: 55,  desc: 'A dark red stone with a slow pulse inside.' },
    troll_heart:    { name: 'Troll Heart',     value: 120, desc: 'Enormous, leathery — and faintly beating still.' },
    drake_scale:    { name: 'Drake Scale',     value: 150, desc: 'A palm-sized scale, warm as a hearthstone.' },
    wardstone_dust: { name: 'Wardstone Dust',  value: 30,  desc: 'Ground rune-stone that glimmers faintly cyan.' },
    // Valuables — no crafting use; merchants pay well for them.
    old_goblet:     { name: 'Old Goblet',      value: 25,  desc: 'Dented plate-silver. A collector will pay.', valuable: true },
    silver_ring:    { name: 'Silver Ring',     value: 35,  desc: 'A plain band of true silver.', valuable: true },
    rune_trinket:   { name: 'Rune Trinket',    value: 50,  desc: 'A carved charm from a forgotten craft.', valuable: true },
  };
  const MAT_IDS = Object.keys(MATERIALS);
  // Loot itemId aliases (enemies.js drops 'trollheart' for Grum)
  const ALIAS = { trollheart: 'troll_heart' };

  // ==========================================================================
  // Flag-backed state — NEVER cache these objects (save.load() swaps g.flags
  // contents in place), always re-fetch through the helpers.
  // ==========================================================================
  const mats = () => g.flags.materials || (g.flags.materials = {});
  const seen = () => g.flags.matSeen || (g.flags.matSeen = {});
  const veinsMined = () => g.flags.veinsMined || (g.flags.veinsMined = {});
  const day = () => g.flags.econDay | 0;

  // Deterministic uniform roll in [0,1). core.hash2's float multiply drops
  // low bits for these parameter ranges and skews badly (it never returns
  // > 0.5 for the daily-price inputs), so pricing/loot rolls use a proper
  // imul-based mix (mulberry32 step). Placement keeps hash2 per contract.
  function rand01(x, y, seed) {
    let a = ((seed | 0) ^ Math.imul(x | 0, 0x9E3779B1) ^ Math.imul(y | 0, 0x85EBCA77)) >>> 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ==========================================================================
  // Inventory API
  // ==========================================================================
  function count(id) { return mats()[id] | 0; }

  function give(id, n, quiet) {
    id = ALIAS[id] || id;
    const m = MATERIALS[id];
    if (!m || !(n > 0)) return;
    const inv = mats();
    inv[id] = (inv[id] | 0) + n;
    const sn = seen();
    if (!sn[id]) {
      sn[id] = true;
      if (!quiet) notify('New material: ' + m.name, m.desc);
    }
  }

  function take(id, n) {
    id = ALIAS[id] || id;
    n = n | 0;
    const inv = mats();
    if ((inv[id] | 0) < n || n <= 0) return false;
    inv[id] -= n;
    if (inv[id] <= 0) delete inv[id];
    return true;
  }

  const gold = () => (g.player ? g.player.stats.gold : 0);
  const addGold = (n) => { if (g.player) g.player.addGold(n); };

  // Materials arriving as world loot (enemy drops, chest items, mined ore)
  // flow in automatically when combat's pickup system collects them.
  ev.on('pickup', (d) => {
    if (!d || !d.itemId) return;
    const id = ALIAS[d.itemId] || d.itemId;
    if (MATERIALS[id]) give(id, d.amount > 0 ? d.amount : 1);
  });

  // ==========================================================================
  // Reputation — 5% better prices per completed quest, capped at 25%.
  // ==========================================================================
  ev.on('questCompleted', () => {
    g.flags.econRep = (g.flags.econRep | 0) + 1;
  });
  function rep() {
    return Math.min(0.25, 0.05 * (g.flags.econRep | 0));
  }

  // ==========================================================================
  // Vendors & pricing
  // sell-to-vendor = base × 45% × like × (1+rep) × daily
  // buy-from-vendor = base × 110% × (1−rep) × daily
  // daily = seeded ±15% per vendor per game-day.
  // ==========================================================================
  const VENDORS = {
    torvald: {
      idx: 0, name: 'Torvald', title: 'Torvald — Smith of Emberhollow',
      sells: [{ id: 'iron_ore' }, { id: 'iron_ingot' }, { id: 'silver_ore' }, { id: 'leather', px: 13 }],
      likes: { iron_ore: 1.15, iron_ingot: 1.15, silver_ore: 1.15, silver_ingot: 1.15, leather: 1.15, pelt: 1.1, ancient_bone: 1.15 },
      mood: ['Torvald pays well for metal and bone today.',
        'Coin sits tight at the forge — Torvald buys thin today.',
        'The forge burns steady. Fair prices, fair work.'],
    },
    bram: {
      idx: 1, name: 'Bram', title: "Bram — The Ember's Rest",
      sells: [{ id: 'potion' }],
      likes: { old_goblet: 1.25, silver_ring: 1.25, rune_trinket: 1.25 },
      mood: ["Bram's purse is open — trinkets fetch a fine price today.",
        'A slow night at the inn; Bram haggles hard today.',
        "Stew's brown, ale's browner, prices honest."],
    },
    sylva: {
      idx: 2, name: 'Sylva', title: "Sylva — Hunter's Trade",
      sells: [{ id: 'leather' }, { id: 'pelt' }],
      likes: { pelt: 1.2 },
      mood: ["Sylva pays a hunter's premium for pelts today.",
        "The fold is quiet — Sylva counts her coin twice today.",
        'Wool is safe and trade is calm at the fold.'],
    },
    grimhilde: {
      idx: 3, name: 'Grimhilde', title: "Grimhilde — The Crone's Hut",
      enabled: () => g.flags.croneChoice === 'peace' && !g.flags.witchDead && !g.flags.witchHostile,
      sells: [{ id: 'wardstone_dust', px: 32 }, { id: 'ember_crystal', px: 41 }, { id: 'frost_shard', px: 41 }],
      likes: { wardstone_dust: 1.2, ember_crystal: 1.2, frost_shard: 1.2, storm_core: 1.2, blood_gem: 1.2, ancient_bone: 1.15 },
      mood: ["The kettle is generous — Grimhilde pays well for reagents today.",
        'The pines are lean; her coin-jar sits low today.',
        'Herbs, embers and honest trade at the hut.'],
    },
    fenwick: {
      idx: 4, name: 'Fenwick', title: 'Fenwick — Wandering Merchant',
      sellRate: 0.55, // buys ANYTHING at 55%
      likes: {},
      mood: ['Fenwick is feeling flush — he pays over the odds today.',
        'Hard road behind him — Fenwick haggles like a troll today.',
        'The pack is heavy and the road is long. Everything is for sale.'],
    },
  };

  // Special goods that are not registry materials
  const SPECIAL_BASE = { potion: 18, tome_note: 45 };

  function dailyFor(vendorId) {
    const v = VENDORS[vendorId];
    const idx = v ? v.idx : 0;
    return 0.85 + 0.30 * rand01(day() * 13 + 7, idx * 29 + 3, 4177);
  }

  function baseOf(id, vendorId, buying) {
    if (SPECIAL_BASE[id] !== undefined) return SPECIAL_BASE[id];
    let base = MATERIALS[id] ? MATERIALS[id].value : 0;
    if (buying) {
      // per-stock nominal overrides (e.g. Torvald's leather at 13)
      const v = VENDORS[vendorId];
      const stock = v && v.sells;
      if (stock) {
        for (let i = 0; i < stock.length; i++) {
          if (stock[i].id === id && stock[i].px !== undefined) { base = stock[i].px; break; }
        }
      }
    }
    return base;
  }

  function priceOf(id, vendorId, buying) {
    const v = VENDORS[vendorId] || VENDORS.torvald;
    const base = baseOf(id, vendorId, buying);
    if (!base) return 0;
    const d = dailyFor(vendorId);
    const r = rep();
    if (buying) return Math.max(1, Math.round(base * 1.10 * (1 - r) * d));
    const like = v.likes && v.likes[id] ? v.likes[id] : 1;
    return Math.max(1, Math.round(base * (v.sellRate || 0.45) * like * (1 + r) * d));
  }

  function moodFor(vendorId) {
    const v = VENDORS[vendorId];
    if (!v) return '';
    const d = dailyFor(vendorId);
    return d > 1.06 ? v.mood[0] : d < 0.94 ? v.mood[1] : v.mood[2];
  }

  // ==========================================================================
  // Fenwick's rotating daily stock: one rare material + one tome-hint note.
  // ==========================================================================
  const FEN_RARES = ['silver_ingot', 'ember_crystal', 'frost_shard', 'storm_core', 'blood_gem', 'wardstone_dust', 'ancient_bone'];
  const TOMES = [
    { key: 'fire2',  name: 'Twin Flame',       hint: 'the crypt beneath Barrowdeep, close to where Aldric’s blade once lay' },
    { key: 'frost2', name: 'Deep Winter',      hint: 'the very top of Greywatch Tower, where the wind keeps the pages cold' },
    { key: 'lightning2', name: 'The Storm Court', hint: 'the drake’s perch upon Drakespire’s peak' },
    { key: 'heal2',  name: 'Rites of Mending', hint: 'a crowded shelf inside the crone’s hut, south among the pines' },
  ];

  function fenwickRare() {
    return FEN_RARES[Math.floor(rand01(day() * 7 + 1, 91, 5511) * FEN_RARES.length) % FEN_RARES.length];
  }
  function fenwickNote() {
    if (g.flags.fenNoteDay === day()) return null; // one map note per day
    const open = [];
    for (let i = 0; i < TOMES.length; i++) {
      const t = TOMES[i];
      if (!g.flags['tomeHint_' + t.key] && !g.flags['tome_' + t.key]) open.push(t);
    }
    if (!open.length) return null;
    return open[Math.floor(rand01(day() * 3 + 2, 57, 6613) * open.length) % open.length];
  }
  function stockFor(vendorId) {
    if (vendorId !== 'fenwick') return (VENDORS[vendorId] && VENDORS[vendorId].sells) || [];
    const rows = [{ id: fenwickRare(), tag: 'rare of the day' }];
    const note = fenwickNote();
    if (note) rows.push({ id: 'tome_note', note, tag: 'map note' });
    return rows;
  }

  function buyNote(note, price) {
    if (!g.player || g.player.stats.gold < price) return false;
    addGold(-price);
    g.flags['tomeHint_' + note.key] = true;
    g.flags.fenNoteDay = day(); // the pack holds one map a day
    // Pin the location on the compass until the tome is claimed
    const TOME_POS = { fire2: { x: 620, z: -420 }, frost2: { x: 380, z: 520 }, lightning2: { x: 150, z: -1250 }, heal2: { x: -260, z: -520 } };
    const tp = TOME_POS[note.key];
    if (tp) {
      if (!g.compassMarkers) g.compassMarkers = [];
      g.compassMarkers.push({ id: 'tome_' + note.key, x: tp.x, z: tp.z, icon: '✦', label: 'Tome: ' + note.name });
    }
    notify('Map note — ' + note.name, 'Fenwick taps the page: “Look to ' + note.hint + '.”');
    return true;
  }

  // ==========================================================================
  // Chest valuables — deterministic ~40% of chests hide one (chestOpened
  // carries no position, so it goes straight to the pack).
  // ==========================================================================
  function strHash(s) {
    s = String(s);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return h;
  }
  ev.on('chestOpened', (d) => {
    if (!d || d.id === undefined || d.id === null) return;
    const h = strHash(d.id);
    if (rand01(h, 811, 7717) >= 0.40) return;
    const roll = rand01(h, 977, 7717);
    const id = roll < 0.5 ? 'old_goblet' : roll < 0.85 ? 'silver_ring' : 'rune_trinket';
    give(id, 1, true);
    notify('Tucked beneath the coin', MATERIALS[id].name + ' — a merchant will pay for this.');
  });

  // ==========================================================================
  // Ore veins — 8 seeded, sparkling, mineable, respawn next game-day.
  // 5 iron (rocky ground / forest edges), 3 silver (high slopes h>55).
  // ==========================================================================
  function nearPOI(x, z) {
    for (let i = 0; i < POIS.length; i++) {
      const p = POIS[i];
      if (dist2d(x, z, p.x, p.z) < Math.max(p.r, 30) + 22) return true;
    }
    return false;
  }

  function findVeinSpots() {
    const spots = [];
    const clearOf = (x, z, r) => {
      for (let i = 0; i < spots.length; i++) if (dist2d(x, z, spots[i].x, spots[i].z) < r) return false;
      return true;
    };
    // Iron ×5 — rocky patches or forest edges within honest walking range.
    for (let pass = 0; pass < 2 && spots.length < 5; pass++) {
      for (let i = 0; i < 6000 && spots.length < 5; i++) {
        const x = (hash2(i, 71 + pass, 9301) * 2 - 1) * 640;
        const z = (hash2(i, 137 + pass, 9301) * 2 - 1) * 640;
        const h = terrainHeight(x, z);
        if (h < WATER_LEVEL + 2.5 || h > 96) continue;
        const dv = dist2d(x, z, 0, 0);
        if (dv < 95 || dv > 640) continue;
        const b = biomeAt(x, z, h);
        let ok = b === BIOME.ROCKY;
        if (!ok && b === BIOME.FOREST) {
          ok = biomeAt(x + 9, z) !== BIOME.FOREST || biomeAt(x - 9, z) !== BIOME.FOREST ||
               biomeAt(x, z + 9) !== BIOME.FOREST || biomeAt(x, z - 9) !== BIOME.FOREST;
        }
        if (pass === 1) ok = ok || b === BIOME.MEADOW; // relaxed fallback
        if (!ok || nearPOI(x, z) || !clearOf(x, z, 70)) continue;
        spots.push({ kind: 'iron', x, z, y: h });
      }
    }
    // Silver ×3 — high slopes (h>55) on the northern rise, still standable.
    for (let pass = 0; pass < 2 && spots.length < 8; pass++) {
      for (let i = 0; i < 6000 && spots.length < 8; i++) {
        const x = (hash2(i, 311 + pass, 9307) * 2 - 1) * 700;
        const z = -330 - hash2(i, 419 + pass, 9307) * 820;
        const h = terrainHeight(x, z);
        if (h <= 55 || h > 175) continue;
        const n = terrainNormal(x, z, 2);
        const minY = pass === 0 ? 0.72 : 0.6;
        if (n.y < minY || n.y > 0.97) continue;
        if (biomeAt(x, z, h) === BIOME.SNOW) continue;
        if (nearPOI(x, z) || !clearOf(x, z, 70)) continue;
        spots.push({ kind: 'silver', x, z, y: h });
      }
    }
    return spots;
  }

  // --- vein meshes: rock hump + emissive crystal cluster (merged geometry) ---
  function mergedGeo(parts) {
    // parts: [{geo (non-indexed clone-safe), px,py,pz, sx,sy,sz, rx,ry,rz}]
    let vc = 0;
    const prepared = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const src = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      e.set(p.rx || 0, p.ry || 0, p.rz || 0);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(p.px || 0, p.py || 0, p.pz || 0),
        q,
        new THREE.Vector3(p.sx || 1, p.sy || 1, p.sz || 1));
      src.applyMatrix4(m4);
      prepared.push(src);
      vc += src.attributes.position.count;
    }
    const pos = new Float32Array(vc * 3);
    const nor = new Float32Array(vc * 3);
    let o = 0;
    for (let i = 0; i < prepared.length; i++) {
      pos.set(prepared[i].attributes.position.array, o);
      nor.set(prepared[i].attributes.normal.array, o);
      o += prepared[i].attributes.position.array.length;
      prepared[i].dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  }

  const rockBase = new THREE.DodecahedronGeometry(0.9, 0);
  const crysBase = new THREE.OctahedronGeometry(0.22, 0);
  const rockGeo = mergedGeo([
    { geo: rockBase, sx: 1.25, sy: 0.62, sz: 1.05, ry: 0.4 },
    { geo: rockBase, px: 0.75, pz: 0.35, py: -0.08, sx: 0.7, sy: 0.45, sz: 0.75, ry: 1.9 },
    { geo: rockBase, px: -0.6, pz: -0.45, py: -0.1, sx: 0.55, sy: 0.4, sz: 0.6, ry: 3.4 },
  ]);
  const crysParts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const r = 0.28 + hash2(i, 5, 881) * 0.42;
    crysParts.push({
      geo: crysBase,
      px: Math.cos(a) * r, py: 0.42 + hash2(i, 9, 881) * 0.22, pz: Math.sin(a) * r,
      sx: 0.55 + hash2(i, 3, 881) * 0.3, sy: 1.5 + hash2(i, 7, 881) * 0.9, sz: 0.55 + hash2(i, 3, 881) * 0.3,
      rx: (hash2(i, 11, 881) - 0.5) * 0.7, rz: (hash2(i, 13, 881) - 0.5) * 0.7, ry: a,
    });
  }
  const crysGeo = mergedGeo(crysParts);
  rockBase.dispose(); crysBase.dispose();

  const rockMat = new THREE.MeshLambertMaterial({ color: 0x63666e, flatShading: true });
  const ironCrysMat = new THREE.MeshLambertMaterial({
    color: 0x7c5030, emissive: 0xc06a2e, emissiveIntensity: 0.55, flatShading: true,
  });
  const silverCrysMat = new THREE.MeshLambertMaterial({
    color: 0xc7d3da, emissive: 0x8fd0ff, emissiveIntensity: 0.55, flatShading: true,
  });

  const veins = [];
  {
    const spots = findVeinSpots();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const grp = new THREE.Group();
      grp.position.set(s.x, s.y - 0.18, s.z);
      grp.rotation.y = hash2(i, 21, 6007) * Math.PI * 2;
      const scl = 1.0 + hash2(i, 33, 6007) * 0.35;
      grp.scale.setScalar(scl);
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.castShadow = true; rock.receiveShadow = true;
      const crys = new THREE.Mesh(crysGeo, s.kind === 'iron' ? ironCrysMat : silverCrysMat);
      crys.castShadow = false;
      grp.add(rock, crys);
      g.scene.add(grp);
      const vein = { i, kind: s.kind, x: s.x, z: s.z, y: s.y, crys };
      veins.push(vein);

      const ipos = new THREE.Vector3(s.x, s.y + 0.7, s.z);
      g.interactables.push({
        pos: ipos, radius: 2.8,
        label: s.kind === 'iron' ? '⛏ Mine — Iron Vein' : '⛏ Mine — Silver Vein',
        onInteract: () => mineVein(vein),
        enabled: () => !g.paused && veinReady(vein),
      });
    }
  }

  function veinReady(v) {
    const md = veinsMined()[v.i];
    return md === undefined || md === null || md < day();
  }

  function mineVein(v) {
    if (!veinReady(v)) return;
    veinsMined()[v.i] = day();
    v.crys.visible = false;
    sfx('hitClang');
    setTimeout(() => sfx('hitClang'), 240);
    setTimeout(() => sfx('hitClang'), 500);
    if (g.player && g.player.addShake) g.player.addShake(0.18);
    const ore = v.kind === 'iron' ? 'iron_ore' : 'silver_ore';
    const n = 2 + Math.floor(Math.random() * 3); // 2-4 (transient roll)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.8;
      ev.emit('spawnLoot', {
        pos: { x: v.x + Math.cos(a) * 0.9, y: v.y + 0.7, z: v.z + Math.sin(a) * 0.9 },
        kind: 'item', amount: 1, itemId: ore,
      });
    }
    if (Math.random() < 0.08) {
      ev.emit('spawnLoot', { pos: { x: v.x, y: v.y + 0.9, z: v.z }, kind: 'item', amount: 1, itemId: 'blood_gem' });
      notify('A gleam in the seam', 'A dark gem tumbles out with the ore.');
    }
    notify('The pick bites deep', 'Ore breaks loose. The vein will regrow by tomorrow.');
  }

  function refreshVeins() {
    for (let i = 0; i < veins.length; i++) veins[i].crys.visible = veinReady(veins[i]);
  }

  // ==========================================================================
  // Fenwick — wandering merchant on the village↔Stonebridge road.
  // Position is a pure function of dayFrac (no drift, save/load safe).
  // ==========================================================================
  const FEN_ROUTE = [[16, -26], [52, -52], [110, -96], [170, -140], [235, -190], [285, -225], [303, -238]];
  const FEN_SEG = [];
  let FEN_LEN = 0;
  for (let i = 1; i < FEN_ROUTE.length; i++) {
    const l = Math.hypot(FEN_ROUTE[i][0] - FEN_ROUTE[i - 1][0], FEN_ROUTE[i][1] - FEN_ROUTE[i - 1][1]);
    FEN_SEG.push(l);
    FEN_LEN += l;
  }
  const FEN_WALK_SPEED = FEN_LEN / (0.18 * 720); // u/s during a walking window
  const _fp = { x: 0, z: 0 }; // scratch route point (no per-frame allocs)

  function routePoint(u, out) {
    let dist = Math.max(0, Math.min(1, u)) * FEN_LEN;
    for (let i = 0; i < FEN_SEG.length; i++) {
      if (dist <= FEN_SEG[i] || i === FEN_SEG.length - 1) {
        const t = FEN_SEG[i] > 0 ? Math.min(1, dist / FEN_SEG[i]) : 0;
        out.x = FEN_ROUTE[i][0] + (FEN_ROUTE[i + 1][0] - FEN_ROUTE[i][0]) * t;
        out.z = FEN_ROUTE[i][1] + (FEN_ROUTE[i + 1][1] - FEN_ROUTE[i][1]) * t;
        return out;
      }
      dist -= FEN_SEG[i];
    }
    out.x = FEN_ROUTE[0][0]; out.z = FEN_ROUTE[0][1];
    return out;
  }

  // schedule: 0.30→0.48 walk out, →0.56 trade at the bridge, →0.74 walk home,
  // otherwise stalls his little pack at the village edge.
  const _sc = { u: 0, walking: false }; // reused, no per-frame allocs
  function fenSchedule(f) {
    if (f >= 0.30 && f < 0.48) { _sc.u = (f - 0.30) / 0.18; _sc.walking = true; }
    else if (f >= 0.48 && f < 0.56) { _sc.u = 1; _sc.walking = false; }
    else if (f >= 0.56 && f < 0.74) { _sc.u = 1 - (f - 0.56) / 0.18; _sc.walking = true; }
    else { _sc.u = 0; _sc.walking = false; }
    return _sc;
  }

  // Blob shadow (own tiny canvas — same look as the villagers')
  const shCv = document.createElement('canvas');
  shCv.width = shCv.height = 64;
  {
    const c = shCv.getContext('2d');
    const grd = c.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, 'rgba(0,0,0,0.42)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
  }
  const shTex = new THREE.CanvasTexture(shCv);
  const shGeo = new THREE.PlaneGeometry(1.5, 1.5);
  shGeo.rotateX(-Math.PI / 2);

  const fen = {
    group: new THREE.Group(), mixer: null, actions: null, current: null,
    walking: false, talking: false, animAcc: 0, frame: 0,
  };
  {
    const shadow = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
    shadow.position.y = 0.02;
    fen.group.add(shadow);
    // Pack crate on his back — merchant silhouette even before the mesh streams in
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x7a5a34, flatShading: true });
    const strapMat = new THREE.MeshLambertMaterial({ color: 0x3c2c1a, flatShading: true });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.44, 0.32), crateMat);
    crate.position.set(0, 1.18, -0.3);
    crate.rotation.x = 0.08;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.34), strapMat);
    strap.position.set(0, 1.18, -0.3);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6), strapMat);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 1.46, -0.3);
    crate.castShadow = true;
    fen.group.add(crate, strap, roll);

    routePoint(0, _fp);
    fen.group.position.set(_fp.x, terrainHeight(_fp.x, _fp.z), _fp.z);
    g.scene.add(fen.group);

    // Skinned rogue arrives whenever the char pack finishes loading.
    if (g.assets && g.assets.char) {
      g.assets.char('rogue_hooded', { gear: { r: null, l: null } }).then((asset) => {
        if (!asset) return;
        const { scene, animations } = asset;
        const box = new THREE.Box3().setFromObject(scene);
        const rawH = Math.max(0.1, box.max.y - box.min.y);
        scene.scale.setScalar(1.74 / rawH);
        if (g.assets.tint) g.assets.tint(scene, '#7d94a6');
        fen.group.add(scene);
        fen.mixer = new THREE.AnimationMixer(scene);
        fen.actions = {};
        for (const want of ['Idle', 'Walking_A', 'Interact']) {
          let clip = null;
          for (let i = 0; i < animations.length; i++) {
            const nm = animations[i].name;
            if (nm === want || nm.endsWith('|' + want)) { clip = animations[i]; break; }
          }
          if (clip) fen.actions[want] = fen.mixer.clipAction(clip);
        }
        if (fen.actions.Idle) { fen.actions.Idle.play(); fen.current = fen.actions.Idle; }
      }).catch(() => {});
    }

    g.interactables.push({
      pos: fen.group.position, radius: 3,
      label: 'Talk — Fenwick',
      onInteract: () => talkToFenwick(),
      enabled: () => !g.paused,
    });
  }

  function fenSetClip(name, timeScale) {
    const a = fen.actions && fen.actions[name];
    if (!a) return;
    if (fen.current !== a) {
      if (fen.current) fen.current.fadeOut(0.22);
      a.reset().fadeIn(0.22).play();
      fen.current = a;
    }
    a.timeScale = timeScale;
  }

  function fenwickTree() {
    const rare = MATERIALS[fenwickRare()];
    const note = fenwickNote();
    const N = {
      greet: {
        text: 'Fenwick, friend — pots, pans, wonders and maps, walked in fresh from the ' +
          'Stonebridge road. The troll takes his toll and I take my margin; between us the ' +
          'valley stays honest. ' + moodFor('fenwick'),
        choices: [
          { label: 'Trade — open the pack.', next: null, do: () => openShop('fenwick') },
          { label: 'Anything special today?', next: 'today' },
          { label: 'Farewell.', next: null },
        ],
      },
      today: {
        text: (rare ? 'Today only: ' + rare.name.toLowerCase() + ' — genuine, mostly legal, priced with love. ' : '') +
          (note ? 'And a map note in a dead scholar’s hand: they say it points to a tome called ' +
            note.name + '. Fifty-ish gold buys the pointing.' : 'The maps are all sold — knowledge moves fast out here.'),
        choices: [
          { label: 'Trade — open the pack.', next: null, do: () => openShop('fenwick') },
          { label: 'Farewell.', next: null },
        ],
      },
    };
    return { start: 'greet', nodes: N };
  }

  function talkToFenwick() {
    if (!g.ui || !g.ui.openDialogue) return;
    fen.talking = true;
    const tree = fenwickTree();
    ev.emit('dialogueStart', { npc: { name: 'Fenwick' }, node: tree.start });
    g.ui.openDialogue({ name: 'Fenwick' }, tree);
  }
  ev.on('dialogueEnd', () => { fen.talking = false; });

  // ==========================================================================
  // Barter panel — parchment two-column buy/sell. Tap = 1, hold = ×5.
  // ==========================================================================
  const style = document.createElement('style');
  style.textContent = `
#ef-shoproot{position:fixed;inset:0;z-index:38;display:none;pointer-events:auto;
  font-family:Georgia,'Times New Roman',serif;-webkit-tap-highlight-color:transparent;}
#ef-shoproot.on{display:block;}
#ef-shoproot *{box-sizing:border-box;-webkit-user-select:none;user-select:none;}
#ef-shopdim{position:absolute;inset:0;opacity:0;transition:opacity .22s ease;
  background:radial-gradient(ellipse at center,rgba(10,7,4,.5),rgba(6,4,2,.8));}
#ef-shoproot.on #ef-shopdim{opacity:1;}
#ef-shop{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;
  width:min(94vw,660px);max-height:min(88dvh,560px);display:flex;flex-direction:column;
  border-radius:6px;overflow:hidden;padding:14px 16px 10px;
  background:linear-gradient(165deg,#efe4c8,#e6d7b2 55%,#d9c99e);
  border:1px solid #a3813f;box-shadow:0 0 0 3px rgba(26,18,10,.9),0 0 0 4px rgba(217,180,106,.45),
  0 18px 60px rgba(0,0,0,.75);transition:transform .2s ease,opacity .2s ease;}
#ef-shoproot.on #ef-shop{transform:translate(-50%,-50%) scale(1);opacity:1;}
#ef-shop::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at center,transparent 58%,rgba(90,62,25,.2) 100%);}
#ef-shopname{color:#3a2a16;font-size:17px;letter-spacing:.14em;text-transform:uppercase;
  text-align:center;text-shadow:0 1px 0 rgba(255,248,225,.5);padding:0 34px;}
#ef-shopmood{color:#7a6238;font-style:italic;font-size:12.5px;text-align:center;margin-top:3px;}
.ef-shoprule{height:1px;margin:9px auto 8px;width:82%;flex:none;
  background:linear-gradient(90deg,transparent,#a3813f 30%,#d9b46a 50%,#a3813f 70%,transparent);}
#ef-shopcols{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.ef-shopcol{display:flex;flex-direction:column;min-height:0;}
.ef-shopcol h3{font-weight:400;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;
  color:#6b4f22;border-bottom:1px solid rgba(107,79,34,.4);padding-bottom:3px;margin-bottom:4px;
  display:flex;justify-content:space-between;}
.ef-shopcol h3 .sub{letter-spacing:.04em;font-style:italic;text-transform:none;color:#8a6c2f;}
.ef-shoplist{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:70px;padding-right:2px;}
.ef-shoprow{display:flex;align-items:baseline;gap:8px;padding:7px 8px;margin:2px 0;cursor:pointer;
  border:1px solid rgba(107,79,34,.25);border-radius:4px;background:rgba(255,248,225,.25);
  transition:background .12s ease,border-color .12s ease;position:relative;overflow:hidden;}
.ef-shoprow:hover{background:rgba(217,180,106,.3);border-color:#8a6f3c;}
.ef-shoprow.hold{background:rgba(217,180,106,.5);border-color:#6b4f22;}
.ef-shoprow.hold::after{content:'×5';position:absolute;right:6px;top:2px;font-size:10px;color:#6b4f22;}
.ef-shoprow.off{opacity:.42;cursor:default;pointer-events:auto;}
.ef-shoprow .nm{flex:1;color:#33261a;font-size:14px;line-height:1.25;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ef-shoprow .nm .tag{display:block;font-size:10.5px;font-style:italic;color:#8a6c2f;}
.ef-shoprow .ct{color:#7a6238;font-size:11.5px;font-style:italic;flex:none;}
.ef-shoprow .pr{color:#6d4a1c;font-size:14px;flex:none;min-width:38px;text-align:right;}
.ef-shopnone{font-style:italic;color:#84714a;font-size:12.5px;padding:10px 4px;}
#ef-shopfoot{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:9px 2px calc(2px + env(safe-area-inset-bottom,0px));}
#ef-shopgold{color:#3a2a16;font-size:15px;display:flex;align-items:center;gap:7px;}
#ef-shopgold .coin{width:13px;height:13px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 35% 30%,#ffe9a8,#d9b46a 55%,#8a6520);
  box-shadow:0 1px 2px rgba(0,0,0,.4);}
#ef-shopgold.no{animation:ef-shopno .3s ease;}
@keyframes ef-shopno{25%{transform:translateX(-3px);color:#8a2a1a;}75%{transform:translateX(3px);color:#8a2a1a;}}
#ef-shophint{color:#8a6c2f;font-size:10.5px;font-style:italic;flex:1;text-align:center;}
#ef-shopleave{pointer-events:auto;cursor:pointer;color:#e8dcc0;font-size:13px;letter-spacing:.14em;
  text-transform:uppercase;font-family:inherit;padding:8px 22px;border-radius:5px;border:1px solid #a3813f;
  background:linear-gradient(180deg,rgba(60,44,24,.95),rgba(34,24,13,.95));box-shadow:0 2px 6px rgba(0,0,0,.4);}
#ef-shopleave:active{transform:scale(.95);}
#ef-shopx{position:absolute;top:6px;right:8px;z-index:2;width:34px;height:34px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;border-radius:50%;color:#d9b46a;font-size:15px;
  border:1px solid rgba(163,129,63,.7);
  background:radial-gradient(circle at 35% 30%,rgba(60,44,24,.95),rgba(28,20,11,.95));}
#ef-shopx:active{transform:scale(.92);}
@media (max-height:430px){
  #ef-shop{padding:10px 12px 6px;}
  #ef-shopname{font-size:14px;}
  .ef-shoprow{padding:5px 7px;}
  .ef-shoprow .nm{font-size:12.5px;}
}`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ef-shoproot';
  root.innerHTML = `
<div id="ef-shopdim"></div>
<div id="ef-shop">
  <div id="ef-shopx">✕</div>
  <div id="ef-shopname"></div>
  <div id="ef-shopmood"></div>
  <div class="ef-shoprule"></div>
  <div id="ef-shopcols">
    <div class="ef-shopcol"><h3>Buy <span class="sub">their goods</span></h3><div class="ef-shoplist" id="ef-shopbuy"></div></div>
    <div class="ef-shopcol"><h3>Sell <span class="sub">your pack</span></h3><div class="ef-shoplist" id="ef-shopsell"></div></div>
  </div>
  <div id="ef-shopfoot">
    <div id="ef-shopgold"><span class="coin"></span><span id="ef-shopgoldn">0</span></div>
    <div id="ef-shophint">tap: trade one · hold: ×5</div>
    <button id="ef-shopleave">Leave</button>
  </div>
</div>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);
  const elName = $('ef-shopname'), elMood = $('ef-shopmood');
  const elBuy = $('ef-shopbuy'), elSell = $('ef-shopsell');
  const elGold = $('ef-shopgold'), elGoldN = $('ef-shopgoldn');

  let shopVendor = null; // vendorId while open
  const rowsLive = [];   // {row, entry, selling, elCt, elPr, price}

  function goodName(entry) {
    if (entry.id === 'potion') return 'Healing Draught';
    if (entry.id === 'tome_note') return 'Map Note — ' + entry.note.name;
    return MATERIALS[entry.id] ? MATERIALS[entry.id].name : entry.id;
  }
  function ownedOf(entry) {
    if (entry.id === 'potion') return g.player ? g.player.stats.potions : 0;
    if (entry.id === 'tome_note') return 0;
    return count(entry.id);
  }

  function makeRow(entry, selling, listEl) {
    const price = priceOf(entry.id, shopVendor, !selling);
    const row = document.createElement('div');
    row.className = 'ef-shoprow';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = goodName(entry);
    if (entry.tag) {
      const tg = document.createElement('span');
      tg.className = 'tag';
      tg.textContent = entry.tag;
      nm.appendChild(tg);
    }
    const ct = document.createElement('span');
    ct.className = 'ct';
    const pr = document.createElement('span');
    pr.className = 'pr';
    pr.textContent = price + 'g';
    row.appendChild(nm); row.appendChild(ct); row.appendChild(pr);
    listEl.appendChild(row);
    const live = { row, entry, selling, elCt: ct, price };
    rowsLive.push(live);

    let holdT = 0, fired = false, pid = null;
    row.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (row.classList.contains('off')) return;
      pid = e.pointerId;
      fired = false;
      try { row.setPointerCapture(pid); } catch (_) { /* older browsers */ }
      row.classList.add('hold');
      holdT = setTimeout(() => {
        fired = true;
        row.classList.remove('hold');
        trade(live, 5);
      }, 460);
    });
    row.addEventListener('pointerup', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      clearTimeout(holdT);
      row.classList.remove('hold');
      if (!fired) trade(live, 1);
      pid = null;
    });
    row.addEventListener('pointercancel', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      clearTimeout(holdT);
      row.classList.remove('hold');
      pid = null;
    });
    return live;
  }

  function goldFlash() {
    elGold.classList.remove('no');
    void elGold.offsetWidth;
    elGold.classList.add('no');
    sfx('uiClick');
  }

  function trade(live, n) {
    const pl = g.player;
    if (!pl || !shopVendor) return;
    const e = live.entry;
    if (live.selling) {
      const k = Math.min(n, count(e.id));
      if (k <= 0) { goldFlash(); return; }
      take(e.id, k);
      addGold(live.price * k);
      sfx('pickupCoin');
    } else if (e.id === 'tome_note') {
      if (!buyNote(e.note, live.price)) { goldFlash(); return; }
      sfx('pickupCoin');
      buildShop(shopVendor); // note is gone from stock
      return;
    } else {
      const k = Math.min(n, Math.floor(pl.stats.gold / live.price));
      if (k <= 0) { goldFlash(); return; }
      addGold(-live.price * k);
      if (e.id === 'potion') {
        pl.stats.potions += k;
      } else {
        give(e.id, k);
      }
      sfx('pickupCoin');
    }
    refreshShop();
  }

  function sellables() {
    const out = [];
    for (let i = 0; i < MAT_IDS.length; i++) {
      if (count(MAT_IDS[i]) > 0) out.push(MAT_IDS[i]);
    }
    return out;
  }

  function buildShop(vendorId) {
    shopVendor = vendorId;
    rowsLive.length = 0;
    const v = VENDORS[vendorId];
    elName.textContent = v.title || v.name;
    elMood.textContent = moodFor(vendorId);
    elBuy.textContent = '';
    elSell.textContent = '';
    const stock = stockFor(vendorId);
    if (!stock.length) {
      const d = document.createElement('div');
      d.className = 'ef-shopnone';
      d.textContent = 'Nothing for sale today.';
      elBuy.appendChild(d);
    }
    for (let i = 0; i < stock.length; i++) makeRow(stock[i], false, elBuy);
    const inv = sellables();
    if (!inv.length) {
      const d = document.createElement('div');
      d.className = 'ef-shopnone';
      d.textContent = 'Nothing in your pack worth coin. Yet.';
      elSell.appendChild(d);
    }
    for (let i = 0; i < inv.length; i++) makeRow({ id: inv[i] }, true, elSell);
    refreshShop();
  }

  function refreshShop() {
    if (!shopVendor) return;
    // A freshly-bought material should appear in the sell column live —
    // rebuild only that column (buy rows keep any active hold state).
    const inv = sellables();
    let missing = false;
    for (let i = 0; i < inv.length && !missing; i++) {
      let found = false;
      for (let j = 0; j < rowsLive.length; j++) {
        if (rowsLive[j].selling && rowsLive[j].entry.id === inv[i]) { found = true; break; }
      }
      if (!found) missing = true;
    }
    if (missing) {
      for (let i = rowsLive.length - 1; i >= 0; i--) if (rowsLive[i].selling) rowsLive.splice(i, 1);
      elSell.textContent = '';
      for (let i = 0; i < inv.length; i++) makeRow({ id: inv[i] }, true, elSell);
    }
    const gd = gold();
    elGoldN.textContent = gd;
    for (let i = 0; i < rowsLive.length; i++) {
      const L = rowsLive[i];
      const owned = ownedOf(L.entry);
      L.elCt.textContent = L.entry.id === 'tome_note' ? '' : '×' + owned;
      const off = L.selling ? owned <= 0 : gd < L.price;
      L.row.classList.toggle('off', off);
    }
  }

  function reallyOpen(vendorId) {
    const v = VENDORS[vendorId];
    if (!v) return;
    if (v.enabled && !v.enabled()) return;
    buildShop(vendorId);
    root.classList.add('on');
    g.paused = true;
    sfx('uiClick');
  }

  // Deferred a tick so a dialogue's own close (which clears g.paused)
  // finishes before the shop claims the pause.
  function openShop(vendorId) {
    setTimeout(() => reallyOpen(vendorId), 40);
  }

  function closeShop() {
    if (!shopVendor) return;
    shopVendor = null;
    rowsLive.length = 0;
    root.classList.remove('on');
    g.paused = false;
    sfx('uiClick');
  }

  $('ef-shopleave').addEventListener('click', closeShop);
  $('ef-shopx').addEventListener('click', closeShop);
  $('ef-shopdim').addEventListener('pointerdown', closeShop);
  window.addEventListener('keydown', (e) => {
    if (shopVendor && (e.code === 'Escape' || e.code === 'KeyE')) {
      e.stopPropagation();
      closeShop();
    }
  }, true);

  // ==========================================================================
  // Save/load + day rollover
  // ==========================================================================
  ev.on('gameLoaded', () => {
    if (shopVendor) closeShop();
    prevFrac = null;
    refreshVeins();
  });

  let prevFrac = null;
  let veinT = 0;

  function update(dt) {
    if (g.compassMarkers && g.compassMarkers.length) {
      for (let i = g.compassMarkers.length - 1; i >= 0; i--) {
        const mk = g.compassMarkers[i];
        if (mk.id && mk.id.startsWith('tome_') && g.flags[mk.id]) g.compassMarkers.splice(i, 1);
      }
    }
    const t = g.time.elapsed;
    // Sparkle: crystal emissive breathes (shared materials, all veins)
    ironCrysMat.emissiveIntensity = 0.5 + 0.32 * Math.sin(t * 2.6);
    silverCrysMat.emissiveIntensity = 0.5 + 0.32 * Math.sin(t * 2.9 + 1.7);

    // While the barter panel is open the world holds its breath.
    if (shopVendor && !g.paused) g.paused = true;

    // Fenwick — anim mixer ticks even during dialogue (Interact pose)
    if (fen.mixer) {
      const p = g.player ? g.player.position : null;
      const gp = fen.group.position;
      const pd = p ? dist2d(gp.x, gp.z, p.x, p.z) : 1e9;
      fenSetClip(
        fen.talking ? 'Interact' : fen.walking ? 'Walking_A' : 'Idle',
        fen.walking && !fen.talking ? FEN_WALK_SPEED / 2.2 : 1);
      fen.frame++;
      fen.animAcc += dt;
      const step = pd > 80 ? 4 : pd > 40 ? 2 : 1;
      if (step === 1 || (fen.frame % step) === 0) {
        fen.mixer.update(fen.animAcc);
        fen.animAcc = 0;
      }
    }

    if (g.paused) return;

    // Game-day rollover (dayFrac wraps past midnight)
    const f = g.time.dayFrac;
    if (prevFrac !== null && prevFrac > 0.8 && f < 0.2) {
      g.flags.econDay = day() + 1;
      refreshVeins(); // veins regrow with the new day
    }
    prevFrac = f;

    // Vein respawn visual (covers load/rollback cases), throttled
    veinT -= dt;
    if (veinT <= 0) { veinT = 0.5; refreshVeins(); }

    // Fenwick walks his route — position is a pure function of dayFrac
    const sc = fenSchedule(f);
    fen.walking = sc.walking;
    routePoint(sc.u, _fp);
    const gp = fen.group.position;
    const dx = _fp.x - gp.x, dz = _fp.z - gp.z;
    gp.x = _fp.x;
    gp.z = _fp.z;
    gp.y = terrainHeight(gp.x, gp.z);
    const p = g.player ? g.player.position : null;
    if (sc.walking && (dx * dx + dz * dz) > 1e-8) {
      // face along this frame's step (already points the way he walks)
      const want = Math.atan2(dx, dz);
      let rd = want - fen.group.rotation.y;
      while (rd > Math.PI) rd -= Math.PI * 2;
      while (rd < -Math.PI) rd += Math.PI * 2;
      fen.group.rotation.y += rd * Math.min(1, dt * 5);
    } else if (p && dist2d(gp.x, gp.z, p.x, p.z) < 4.5) {
      const want = Math.atan2(p.x - gp.x, p.z - gp.z);
      let rd = want - fen.group.rotation.y;
      while (rd > Math.PI) rd -= Math.PI * 2;
      while (rd < -Math.PI) rd += Math.PI * 2;
      fen.group.rotation.y += rd * Math.min(1, dt * 6);
    }
  }

  return {
    update, MATERIALS, give, take, count, priceOf, openShop, closeShop,
    rep, gold, addGold,
    // exposed for debugging/tests
    _veins: veins, _vendors: VENDORS, _fenwick: fen,
  };
}

// ============================================================================
// ELDERFALL — forge.js (wave 3: smithing, enchanting, spell tomes)
// The weighty gear-progression loop:
//   • The village forge (Torvald's smithy yard): smelt ore → ingots, tan
//     pelts → leather, and a 4-tier upgrade track (Fine / Tempered /
//     Masterwork / Legendary) for the martial weapons. HOLD-to-forge 1.2s
//     with three timed anvil clangs and a spark burst.
//   • Enchanting rituals at the cleansed Wardstones and (peace path) at
//     Grimhilde's cauldron: five school enchants, HOLD 1.5s rising chime,
//     rune-circle flash.
//   • Four hidden spell tomes (glowing book pickups) that upgrade one spell
//     school each via a brief parchment reading overlay (books.js styling).
//   • The Wardstone blessing (pray post-cleanse: +15% spell damage, 300s)
//     and the Dragonslayer's Cinder (drake kill: permanent +15% fire).
// State lives under g.flags.forge (+ g.flags.tome_*, g.flags.cinder) so it
// all survives save/load. Emits `weaponForged {id,tier}` and
// `weaponEnchanted {id,school}`. combat.js reads tierOf / enchantOf /
// dmgMult / spellTier / spellPower for damage + weapon visuals.
// ============================================================================
import * as THREE from 'three';
import { POI, terrainHeight, clamp } from './core.js';

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------
const UPGRADEABLE = ['sword', 'axe', 'greatsword', 'bow'];
const WHEEL_ROWS = ['sword', 'axe', 'greatsword', 'bow', 'fire', 'frost', 'lightning', 'heal', 'torch'];
const WNAME = {
  sword: 'Iron Sword', axe: 'Battle Axe', greatsword: 'Greatsword', bow: 'Hunting Bow',
  fire: 'Flamecall', frost: "Winter's Breath", lightning: 'Stormcall', heal: 'Mending Light',
  torch: 'Torch',
};
const TIER_NAME = ['', 'Fine', 'Tempered', 'Masterwork', 'Legendary'];
const TIER_BONUS = [0, 0.12, 0.25, 0.40, 0.60];

// Material display names (economy owns the canonical registry; this is a
// fallback so the forge reads well even if economy boots later).
const MAT_NAME = {
  iron_ore: 'Iron Ore', iron_ingot: 'Iron Ingot', silver_ore: 'Silver Ore',
  silver_ingot: 'Silver Ingot', pelt: 'Wolf Pelt', leather: 'Leather',
  ancient_bone: 'Ancient Bone', ember_crystal: 'Ember Crystal',
  frost_shard: 'Frost Shard', storm_core: 'Storm Core', blood_gem: 'Blood Gem',
  troll_heart: 'Troll Heart', drake_scale: 'Drake Scale', wardstone_dust: 'Wardstone Dust',
};

// Upgrade recipes. Legendary consumes ONE of troll_heart / drake_scale.
function tierRecipe(id, tier) {
  switch (tier) {
    case 1: return { gold: 40, lvl: 1, mats: [['iron_ingot', 2]] };
    case 2: return { gold: 120, lvl: 5, mats: [['iron_ingot', 4], ['leather', 1]] };
    case 3: return {
      gold: 300, lvl: 10,
      mats: id === 'bow'
        ? [['iron_ingot', 6], ['ancient_bone', 3]]
        : [['iron_ingot', 6], ['silver_ingot', 2]],
    };
    case 4: return { gold: 800, lvl: 15, mats: [], oneOf: [['troll_heart', 1], ['drake_scale', 1]] };
    default: return null;
  }
}

// Enchant recipes — one enchant per weapon; replacing costs the full price.
const ENCHANTS = {
  flametongue: {
    name: 'Flametongue', hex: '#ff5a22', gold: 150,
    mats: [['ember_crystal', 1], ['wardstone_dust', 1]],
    desc: 'Strikes kindle — foes burn for 4 damage a second, 2 seconds.',
  },
  frostbite: {
    name: 'Frostbite', hex: '#66ccff', gold: 150,
    mats: [['frost_shard', 1], ['wardstone_dust', 1]],
    desc: 'Strikes chill — foes slowed by a quarter for 1.5 seconds.',
  },
  stormbrand: {
    name: 'Stormbrand', hex: '#b18cff', gold: 220,
    mats: [['storm_core', 1], ['wardstone_dust', 1]],
    desc: 'One strike in ten arcs lightning to a nearby foe (8 damage).',
  },
  bloodthirst: {
    name: 'Bloodthirst', hex: '#aa1133', gold: 220,
    mats: [['blood_gem', 1], ['wardstone_dust', 1]],
    desc: 'Drink deep — heal 12% of the damage you deal.',
  },
  gravebane: {
    name: 'Gravebane', hex: '#9fffce', gold: 180,
    mats: [['silver_ingot', 1], ['ancient_bone', 2], ['wardstone_dust', 1]],
    desc: '+35% damage against the risen dead.',
  },
};
const ENCH_IDS = ['flametongue', 'frostbite', 'stormbrand', 'bloodthirst', 'gravebane'];

// The four hidden spell tomes. Positions are fixed against structures.js
// landmarks (crypt coffin, Greywatch platform, Drakespire perch, witch hut).
const TOMES = [
  {
    id: 'fire2', title: 'Twin Flame', school: 'fire', hex: 0xff5a22,
    note: 'Your Fireball is now Greater Fireball.',
    text: 'The first flame asks; the second answers.\n\nCast not a stone of fire but a family of them. Let the burst mother three sparks, and let each spark remember its parent’s anger. A hearth warms one room — a scattered hearth warms the whole of your enemy’s line.\n\nWritten in a steady hand, signed only: A.',
  },
  {
    id: 'frost2', title: 'Deep Winter', school: 'frost', hex: 0x66ccff,
    note: "Winter's Breath deepens — slows harder, leaves bone brittle.",
    text: 'Cold is not the absence of heat. It is a patience.\n\nDo not blow the frost across the skin and count it done. Sit it in the marrow. Let it stay until the bone forgets how to bend — and then, only then, strike. What is brittle, breaks.\n\nThe ink of this page glitters faintly, as if frozen.',
  },
  {
    id: 'lightning2', title: 'The Storm Court', school: 'lightning', hex: 0xb18cff,
    note: 'Stormcall now arcs to five souls.',
    text: 'Lightning is a court in session. It visits every guilty head in the room, and it visits none of them twice.\n\nThree summonses is a clerk’s work. Hold the sky’s writ with both hands and name five — the storm keeps its own ledger of who is owed.\n\nThe page smells of rain on hot stone.',
  },
  {
    id: 'heal2', title: 'Rites of Mending', school: 'heal', hex: 0x8affb0,
    note: 'Mending Light lingers — 4 health a second, for five breaths.',
    text: 'A wound closed in haste reopens. Any herbwife knows it; few mages will hear it.\n\nDo not slam the light shut like a door. Leave it stitched into the skin — a slow, warm needle, five breaths long — and the flesh will finish what the spell began.\n\nSomeone has pressed a sprig of pine between these pages.',
  },
];

// ===========================================================================
export function createForge(g) {
  const ev = g.events;
  const notify = (text, sub) => ev.emit('notify', { text, sub });
  const sfx = (name) => { if (g.audio && g.audio.play) g.audio.play(name); };

  // -------------------------------------------------------------------------
  // Persistent state under g.flags.forge (survives save/load; the flags
  // object's CONTENTS are swapped on load, so always re-read through F()).
  // -------------------------------------------------------------------------
  function F() {
    let f = g.flags.forge;
    if (!f || typeof f !== 'object') { f = {}; g.flags.forge = f; }
    if (!f.tiers || typeof f.tiers !== 'object') f.tiers = {};
    if (!f.enchants || typeof f.enchants !== 'object') f.enchants = {};
    for (const id of UPGRADEABLE) {
      if (typeof f.tiers[id] !== 'number') f.tiers[id] = 0;
      if (f.enchants[id] === undefined) f.enchants[id] = null;
    }
    if (typeof f.blessLeft !== 'number') f.blessLeft = 0;
    return f;
  }

  // -------------------------------------------------------------------------
  // Materials — prefer the economy module; fall back to the SAME storage
  // (g.flags.materials) so boot order / missing module never breaks the forge.
  // -------------------------------------------------------------------------
  function matStore() {
    if (!g.flags.materials || typeof g.flags.materials !== 'object') g.flags.materials = {};
    return g.flags.materials;
  }
  function mName(id) {
    const M = g.economy && g.economy.MATERIALS;
    return (M && M[id] && M[id].name) || MAT_NAME[id] || id;
  }
  function mCount(id) {
    if (g.economy && g.economy.count) return g.economy.count(id) | 0;
    return matStore()[id] | 0;
  }
  function mGive(id, n) {
    if (g.economy && g.economy.give) { g.economy.give(id, n); return; }
    const s = matStore();
    s[id] = (s[id] | 0) + n;
  }
  function mTake(id, n) {
    if (g.economy && g.economy.take) return !!g.economy.take(id, n);
    const s = matStore();
    if ((s[id] | 0) < n) return false;
    s[id] = (s[id] | 0) - n;
    return true;
  }
  const gold = () => (g.player ? g.player.stats.gold : 0);
  const plevel = () => (g.player ? g.player.stats.level : 1);
  const spendGold = (n) => { if (g.player) g.player.addGold(-n); };

  const wname = (id) =>
    (g.combat && g.combat.WEAPONS && g.combat.WEAPONS[id] && g.combat.WEAPONS[id].name) || WNAME[id] || id;

  // -------------------------------------------------------------------------
  // Combat-facing API
  // -------------------------------------------------------------------------
  function tierOf(id) { return F().tiers[id] | 0; }
  function enchantOf(id) { return F().enchants[id] || null; }
  function dmgMult(id) { return 1 + (TIER_BONUS[tierOf(id)] || 0); }
  function spellTier(school) { return g.flags['tome_' + school + '2'] ? 2 : 1; }
  function spellPower(school) {
    let m = 1;
    if (F().blessLeft > 0) m *= 1.15;                       // Wardstone blessing
    if (school === 'fire' && g.flags.cinder) m *= 1.15;     // Dragonslayer's Cinder
    return m;
  }

  // Dragonslayer's Cinder — permanent +15% fire on the drake kill.
  ev.on('enemyKilled', (d) => {
    if (d && d.type === 'drake' && !g.flags.cinder) {
      g.flags.cinder = true;
      notify("Dragonslayer's Cinder", 'A coal of Vhastrix burns in you — +15% fire damage, forever.');
    }
  });

  // -------------------------------------------------------------------------
  // World placement anchors
  // -------------------------------------------------------------------------
  // Torvald's smithy: the blacksmith building sits at (-17, 12) in the
  // village (structures/details agree); the anvil + hearth face the square.
  const FORGE_X = -15.6, FORGE_Z = 10.6;
  const STONES = POI.stones;
  const stonesY = terrainHeight(STONES.x, STONES.z);
  // Witch-hut cauldron (structures.js: hut at (-260,-520), ry=0.7, cauldron
  // at hut + fwd*6.2 + side*1.6).
  const HUT_RY = 0.7;
  const hfx = Math.sin(HUT_RY), hfz = Math.cos(HUT_RY);
  const hsx = Math.cos(HUT_RY), hsz = -Math.sin(HUT_RY);
  const CAULDRON_X = -260 + hfx * 6.2 + hsx * 1.6;
  const CAULDRON_Z = -520 + hfz * 6.2 + hsz * 1.6;

  const peacePath = () => g.flags.croneChoice === 'peace' && !g.flags.witchDead;

  g.interactables.push({
    pos: new THREE.Vector3(FORGE_X, terrainHeight(FORGE_X, FORGE_Z) + 1.1, FORGE_Z),
    radius: 3,
    label: '⚒ Use the Forge',
    onInteract: () => openForge(),
    enabled: () => !g.paused,
  });
  g.interactables.push({
    pos: new THREE.Vector3(STONES.x, stonesY + 1.2, STONES.z),
    radius: 3,
    label: '✦ Enchant at the Wardstones',
    onInteract: () => openEnchant('stones'),
    enabled: () => !g.paused && !!g.flags.stonesCleansed,
  });
  // Pray at the first monolith (offset from the central altar so the two
  // prompts don't fight over the same spot).
  const prayX = STONES.x + Math.cos(0.55) * 8.5, prayZ = STONES.z + Math.sin(0.55) * 8.5;
  g.interactables.push({
    pos: new THREE.Vector3(prayX, terrainHeight(prayX, prayZ) + 1.4, prayZ),
    radius: 2.5,
    label: '✦ Pray at the Wardstones',
    onInteract: () => {
      F().blessLeft = 300;
      sfx('heal');
      notify('The Ward answers', 'Cyan light settles into your hands — +15% spell damage for five minutes.');
    },
    enabled: () => !g.paused && !!g.flags.stonesCleansed,
  });
  g.interactables.push({
    pos: new THREE.Vector3(CAULDRON_X, terrainHeight(CAULDRON_X, CAULDRON_Z) + 1.5, CAULDRON_Z),
    radius: 3,
    label: '✦ Enchant at the Cauldron',
    onInteract: () => openEnchant('cauldron'),
    enabled: () => !g.paused && peacePath(),
  });

  // -------------------------------------------------------------------------
  // Spell tomes — glowing book meshes + interactables
  // -------------------------------------------------------------------------
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  const pageMat = new THREE.MeshLambertMaterial({ color: 0xe4d7b4, flatShading: true });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x4e3a24, flatShading: true });

  // Fixed world spots (deterministic — matches structures.js landmarks):
  const cryY = terrainHeight(POI.ruins.x, POI.ruins.z - 16);
  const towY = terrainHeight(POI.tower.x, POI.tower.z) + 14.3;
  const TOME_POS = {
    fire2: [POI.ruins.x - 2.4, cryY + 0.74, POI.ruins.z - 16 + 1.2],   // crypt, on the coffin by Aldric's chest
    frost2: [POI.tower.x - 2.2, towY + 0.42, POI.tower.z + 2.3],        // tower-top platform
    lightning2: [147.5, terrainHeight(147.5, -1246.5) + 0.42, -1246.5], // Drakespire perch
    heal2: [-257.19, terrainHeight(-257.19, -519.62) + 1.14, -519.62],  // witch hut wall shelf
  };

  // Little wall shelf for the witch-hut tome (two boxes, static).
  {
    const [sx, sy, sz] = TOME_POS.heal2;
    const plank = new THREE.Mesh(bookGeo, woodMat);
    plank.scale.set(0.78, 0.05, 0.4);
    plank.position.set(sx, sy - 0.1, sz);
    plank.rotation.y = HUT_RY;
    const bracket = new THREE.Mesh(bookGeo, woodMat);
    bracket.scale.set(0.08, 0.3, 0.3);
    bracket.position.set(sx, sy - 0.26, sz);
    bracket.rotation.y = HUT_RY;
    g.scene.add(plank, bracket);
  }

  const tomeObjs = []; // { def, group, coverMat, glyphMat, baseY, phase }
  for (let i = 0; i < TOMES.length; i++) {
    const def = TOMES[i];
    const [tx, ty, tz] = TOME_POS[def.id];
    const group = new THREE.Group();
    group.position.set(tx, ty, tz);
    group.rotation.y = i * 1.7 + 0.4;
    const coverMat = new THREE.MeshLambertMaterial({
      color: 0x2c2318, emissive: def.hex, emissiveIntensity: 0.55, flatShading: true,
    });
    const glyphMat = new THREE.MeshLambertMaterial({
      color: 0x111111, emissive: def.hex, emissiveIntensity: 1.2, flatShading: true,
    });
    const pages = new THREE.Mesh(bookGeo, pageMat);
    pages.scale.set(0.3, 0.06, 0.22);
    const cover = new THREE.Mesh(bookGeo, coverMat);
    cover.scale.set(0.35, 0.085, 0.26);
    cover.position.y = 0; // cover wraps the pages block
    pages.position.y = 0.005;
    const glyph = new THREE.Mesh(bookGeo, glyphMat);
    glyph.scale.set(0.1, 0.012, 0.1);
    glyph.position.y = 0.05;
    glyph.rotation.y = 0.8;
    group.add(cover, pages, glyph);
    g.scene.add(group);
    const o = { def, group, coverMat, glyphMat, baseY: ty, phase: i * 1.9 };
    tomeObjs.push(o);
    g.interactables.push({
      pos: new THREE.Vector3(tx, ty + 0.2, tz),
      radius: 2.6,
      label: 'Read',
      prompt: 'Read — “' + def.title + '”',
      onInteract: () => openTome(o),
      enabled: () => !g.paused && !g.flags['tome_' + def.id],
    });
  }

  function syncTomes() {
    for (const o of tomeObjs) o.group.visible = !g.flags['tome_' + o.def.id];
  }
  ev.on('gameLoaded', () => { syncTomes(); closePanel(true); closeTome(true); });
  syncTomes();

  // -------------------------------------------------------------------------
  // CSS — parchment/ember styling matching ui.js + books.js conventions
  // -------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
#ef-fgroot,#ef-tomeroot{position:fixed;inset:0;z-index:44;display:none;pointer-events:auto;
  font-family:Georgia,'Times New Roman',serif;-webkit-tap-highlight-color:transparent;}
#ef-fgroot.on,#ef-tomeroot.on{display:block;}
#ef-fgroot *,#ef-tomeroot *{box-sizing:border-box;-webkit-user-select:none;user-select:none;}
#ef-fgdim,#ef-tomedim{position:absolute;inset:0;background:radial-gradient(ellipse at center,
  rgba(14,8,3,.55),rgba(8,4,2,.84));opacity:0;transition:opacity .25s ease;}
#ef-fgroot.on #ef-fgdim,#ef-tomeroot.on #ef-tomedim{opacity:1;}
#ef-fgpanel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;
  width:min(94vw,620px);height:min(88vh,680px);max-height:calc(100vh - 20px);
  display:flex;flex-direction:column;border-radius:6px;overflow:hidden;
  background:linear-gradient(165deg,#efe4c8,#e6d7b2 55%,#d9c99e);
  border:1px solid #a3813f;box-shadow:0 0 0 3px rgba(26,18,10,.9),0 0 0 4px rgba(217,180,106,.45),
  0 18px 60px rgba(0,0,0,.75);transition:transform .22s ease,opacity .22s ease;}
#ef-fgroot.on #ef-fgpanel{transform:translate(-50%,-50%) scale(1);opacity:1;}
#ef-fgpanel::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at center,transparent 55%,rgba(90,62,25,.22) 100%);}
#ef-fghead{padding:16px 52px 0;text-align:center;flex:none;position:relative;}
#ef-fgtitle{color:#3a2a16;font-size:19px;letter-spacing:.09em;text-transform:uppercase;
  text-shadow:0 1px 0 rgba(255,248,225,.5);}
#ef-fgsub{color:#7a6238;font-style:italic;font-size:12.5px;margin-top:3px;}
.ef-fgrule{height:1px;margin:10px auto 0;width:80%;flex:none;
  background:linear-gradient(90deg,transparent,#a3813f 28%,#d9b46a 50%,#a3813f 72%,transparent);}
#ef-fgroot.m-forge .ef-fgrule{background:linear-gradient(90deg,transparent,#a3512a 28%,#ff8a3c 50%,#a3512a 72%,transparent);}
#ef-fgclose{position:absolute;top:8px;right:8px;z-index:3;width:38px;height:38px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;border-radius:50%;
  color:#d9b46a;font-size:17px;border:1px solid rgba(163,129,63,.7);
  background:radial-gradient(circle at 35% 30%,rgba(60,44,24,.95),rgba(28,20,11,.95));}
#ef-fgclose:active{transform:scale(.92);}
#ef-fgmats{flex:none;display:flex;flex-wrap:wrap;gap:5px;justify-content:center;
  padding:9px 12px 2px;}
.ef-fgchip{font-size:11.5px;flex:none;color:#4a381f;padding:3px 8px;border-radius:10px;
  border:1px solid rgba(163,129,63,.5);background:rgba(255,248,225,.35);white-space:nowrap;}
.ef-fgchip b{color:#2f2210;}
.ef-fgchip.gold{border-color:#c9a23f;background:rgba(217,180,106,.28);}
#ef-fgbody{flex:1;overflow-y:auto;padding:8px 14px 6px;-webkit-overflow-scrolling:touch;}
#ef-fgsmelt{display:flex;gap:8px;margin-bottom:10px;}
.ef-fgcard{flex:1;cursor:pointer;text-align:center;padding:9px 6px;border-radius:6px;
  border:1px solid rgba(163,129,63,.55);background:linear-gradient(180deg,rgba(255,248,225,.5),rgba(224,205,160,.4));
  color:#3a2a16;position:relative;overflow:hidden;}
.ef-fgcard .t{font-size:13px;letter-spacing:.03em;}
.ef-fgcard .r{font-size:11px;color:#7a6238;font-style:italic;margin-top:2px;}
.ef-fgcard:active{transform:scale(.97);}
.ef-fgcard.off{opacity:.45;cursor:default;}
.ef-fgrow{display:flex;align-items:center;gap:9px;padding:8px 8px;border-radius:5px;cursor:pointer;
  border-bottom:1px dotted rgba(122,98,56,.4);color:#33261a;position:relative;}
.ef-fgrow.sel{background:linear-gradient(90deg,rgba(217,180,106,.34),rgba(217,180,106,.08));
  border-left:3px solid #a3813f;padding-left:5px;}
.ef-fgrow .nm{flex:1;font-size:14.5px;}
.ef-fgrow .tier{font-size:12px;letter-spacing:.16em;color:#a3813f;}
.ef-fgrow .tier b{color:#8a5a1c;}
.ef-fgrow .bon{font-size:11.5px;color:#5c7a3a;min-width:44px;text-align:right;}
.ef-fgrow .ench{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 6px currentColor;}
.ef-fgrow.na{opacity:.5;cursor:default;}
.ef-fgrow.na .bon{color:#7a6238;font-style:italic;}
#ef-fgdetail{flex:none;border-top:1px solid rgba(163,129,63,.5);padding:9px 14px
  calc(10px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,rgba(224,205,160,.25),rgba(200,178,130,.45));
  position:relative;min-height:96px;}
#ef-fgdname{color:#3a2a16;font-size:14.5px;letter-spacing:.03em;}
#ef-fgdname i{color:#7a6238;font-size:12px;}
#ef-fgrecipe{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 8px;}
.ef-fgreq{font-size:11.5px;padding:2px 8px;border-radius:9px;border:1px solid rgba(163,129,63,.5);
  color:#2f2210;background:rgba(255,248,225,.4);}
.ef-fgreq.lack{color:#8a2a1c;border-color:rgba(160,50,30,.6);background:rgba(190,60,40,.12);}
#ef-fghold{position:relative;overflow:hidden;height:52px;border-radius:6px;cursor:pointer;
  border:1px solid #7a5a28;display:flex;align-items:center;justify-content:center;
  color:#f2e6c6;font-size:14.5px;letter-spacing:.12em;text-transform:uppercase;
  background:linear-gradient(180deg,#4a3320,#241708);text-shadow:0 1px 3px rgba(0,0,0,.8);
  box-shadow:0 3px 10px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,220,150,.18);}
#ef-fghold.off{opacity:.5;cursor:default;}
#ef-fghold.holding{animation:ef-fgshake .12s linear infinite;}
@keyframes ef-fgshake{0%{transform:translate(0,0)}25%{transform:translate(.6px,-.4px)}
  50%{transform:translate(-.5px,.5px)}75%{transform:translate(.4px,.3px)}}
#ef-fgholdfill{position:absolute;left:0;top:0;bottom:0;width:0%;pointer-events:none;
  background:linear-gradient(90deg,rgba(255,120,40,.28),rgba(255,170,70,.55));
  box-shadow:0 0 18px rgba(255,150,60,.55);}
#ef-fgroot.m-ench #ef-fgholdfill{background:linear-gradient(90deg,rgba(120,160,255,.25),rgba(190,150,255,.5));
  box-shadow:0 0 18px rgba(170,140,255,.55);}
#ef-fgholdtx{position:relative;pointer-events:none;}
#ef-fghint{font-size:10.5px;color:#7a6238;font-style:italic;text-align:center;margin-top:5px;}
#ef-fgfx{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
#ef-fgfx i{position:absolute;width:5px;height:5px;border-radius:50%;background:var(--c,#ffd873);
  box-shadow:0 0 8px var(--c,#ffd873);animation:ef-fgspark .65s ease-out forwards;}
@keyframes ef-fgspark{from{opacity:1;transform:translate(0,0) scale(1);}
  to{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.3);}}
#ef-fgrune{position:absolute;left:50%;top:50%;width:150px;height:150px;margin:-75px 0 0 -75px;
  border-radius:50%;pointer-events:none;opacity:0;display:flex;align-items:center;justify-content:center;
  border:2px dashed rgba(177,140,255,.9);color:rgba(217,190,255,.95);font-size:19px;letter-spacing:.5em;
  text-indent:.5em;box-shadow:0 0 40px rgba(150,120,255,.5),inset 0 0 26px rgba(150,120,255,.35);}
#ef-fgrune.go{animation:ef-fgrune .95s ease-out forwards;}
@keyframes ef-fgrune{0%{opacity:0;transform:scale(.55) rotate(-16deg);}
  30%{opacity:1;}100%{opacity:0;transform:scale(1.45) rotate(14deg);}}
#ef-fgtoast{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);pointer-events:none;
  color:#f5ecd2;font-size:14.5px;letter-spacing:.05em;padding:8px 18px;border-radius:6px;opacity:0;
  background:linear-gradient(180deg,rgba(60,40,18,.95),rgba(30,19,8,.95));border:1px solid #a3813f;
  box-shadow:0 4px 16px rgba(0,0,0,.55),0 0 22px rgba(255,150,60,.25);white-space:nowrap;}
#ef-fgtoast.go{animation:ef-fgtoast 1.9s ease forwards;}
@keyframes ef-fgtoast{0%{opacity:0;transform:translateX(-50%) translateY(10px);}
  12%{opacity:1;transform:translateX(-50%) translateY(0);}80%{opacity:1;}100%{opacity:0;}}
/* ---- tome reading overlay ---- */
#ef-tomeroot{z-index:45;}
#ef-tomepanel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;
  width:min(92vw,480px);max-height:84vh;display:flex;flex-direction:column;border-radius:6px;overflow:hidden;
  background:linear-gradient(165deg,#efe4c8,#e6d7b2 55%,#d9c99e);
  border:1px solid #a3813f;box-shadow:0 0 0 3px rgba(26,18,10,.9),0 0 0 4px rgba(217,180,106,.45),
  0 0 46px var(--glow,rgba(255,140,60,.35)),0 18px 60px rgba(0,0,0,.75);
  transition:transform .22s ease,opacity .22s ease;}
#ef-tomeroot.on #ef-tomepanel{transform:translate(-50%,-50%) scale(1);opacity:1;}
#ef-tometitle{color:#3a2a16;font-size:19px;letter-spacing:.1em;text-transform:uppercase;
  text-align:center;padding:18px 24px 0;text-shadow:0 1px 0 rgba(255,248,225,.5);}
#ef-tomeschool{text-align:center;color:#7a6238;font-style:italic;font-size:12.5px;margin-top:3px;}
.ef-tomerule{height:1px;margin:12px auto 0;width:74%;
  background:linear-gradient(90deg,transparent,#a3813f 30%,#d9b46a 50%,#a3813f 70%,transparent);}
#ef-tomebody{overflow-y:auto;padding:12px 24px 6px;color:#33261a;font-size:15px;line-height:1.6;
  white-space:pre-wrap;font-style:italic;-webkit-overflow-scrolling:touch;}
#ef-tomebody::first-letter{font-size:2.5em;line-height:.9;float:left;padding:4px 7px 0 0;
  color:#6d4a1c;font-weight:bold;font-style:normal;}
#ef-tomebtn{margin:12px auto calc(16px + env(safe-area-inset-bottom,0px));cursor:pointer;
  color:#e8dcc0;font-size:13.5px;letter-spacing:.08em;padding:10px 22px;border-radius:5px;
  border:1px solid #a3813f;background:linear-gradient(180deg,rgba(60,44,24,.95),rgba(34,24,13,.95));
  box-shadow:0 2px 6px rgba(0,0,0,.4);}
#ef-tomebtn:active{transform:scale(.95);}
@media (max-height:500px){
  #ef-fghead{padding-top:9px;}#ef-fgtitle{font-size:16px;}
  #ef-fgdetail{min-height:78px;}#ef-fghold{height:44px;}
}`;
  document.head.appendChild(style);

  // -------------------------------------------------------------------------
  // Panel DOM
  // -------------------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'ef-fgroot';
  root.innerHTML = `
<div id="ef-fgdim"></div>
<div id="ef-fgpanel">
  <div id="ef-fgclose">✕</div>
  <div id="ef-fghead"><div id="ef-fgtitle"></div><div id="ef-fgsub"></div></div>
  <div class="ef-fgrule"></div>
  <div id="ef-fgmats"></div>
  <div id="ef-fgbody"></div>
  <div id="ef-fgdetail">
    <div id="ef-fgdname"></div>
    <div id="ef-fgrecipe"></div>
    <div id="ef-fghold"><div id="ef-fgholdfill"></div><span id="ef-fgholdtx"></span></div>
    <div id="ef-fghint"></div>
  </div>
  <div id="ef-fgfx"></div>
  <div id="ef-fgrune">ᚠᛟᚱᚷᛖ</div>
  <div id="ef-fgtoast"></div>
</div>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);
  const elTitle = $('ef-fgtitle'), elSub = $('ef-fgsub'), elMats = $('ef-fgmats');
  const elBody = $('ef-fgbody'), elDName = $('ef-fgdname'), elRecipe = $('ef-fgrecipe');
  const elHold = $('ef-fghold'), elFill = $('ef-fgholdfill'), elHoldTx = $('ef-fgholdtx');
  const elHint = $('ef-fghint'), elFx = $('ef-fgfx'), elRune = $('ef-fgrune'), elToast = $('ef-fgtoast');

  // Tome overlay DOM
  const troot = document.createElement('div');
  troot.id = 'ef-tomeroot';
  troot.innerHTML = `
<div id="ef-tomedim"></div>
<div id="ef-tomepanel">
  <div id="ef-tometitle"></div>
  <div id="ef-tomeschool"></div>
  <div class="ef-tomerule"></div>
  <div id="ef-tomebody"></div>
  <div id="ef-tomebtn">Commit to Memory</div>
</div>`;
  document.body.appendChild(troot);

  // -------------------------------------------------------------------------
  // Panel state + rendering
  // -------------------------------------------------------------------------
  let open = false;          // forge/enchant panel visible
  let mode = 'forge';        // 'forge' | 'ench'
  let site = 'stones';       // enchant flavor
  let selW = 'sword';
  let selE = 'flametongue';
  let wasPaused = false;

  function esc(s) { return String(s); } // static data only — no user input

  function chipRow() {
    const ids = mode === 'forge'
      ? ['iron_ore', 'iron_ingot', 'silver_ore', 'silver_ingot', 'pelt', 'leather']
      : ['wardstone_dust', 'ember_crystal', 'frost_shard', 'storm_core', 'blood_gem', 'ancient_bone', 'silver_ingot'];
    let h = `<span class="ef-fgchip gold">✦ <b>${gold()}</b> gold</span>`;
    for (const id of ids) h += `<span class="ef-fgchip">${esc(mName(id))} <b>${mCount(id)}</b></span>`;
    elMats.innerHTML = h;
  }

  function tierPips(t) {
    let s = '';
    for (let i = 1; i <= 4; i++) s += i <= t ? '◆' : '◇';
    return s;
  }

  function renderForgeList() {
    let h = `
<div id="ef-fgsmelt">
  <div class="ef-fgcard${mCount('iron_ore') >= 2 && gold() >= 5 ? '' : ' off'}" data-act="smelt_iron">
    <div class="t">Smelt Iron</div><div class="r">2 ore + 5g → ingot</div></div>
  <div class="ef-fgcard${mCount('silver_ore') >= 2 && gold() >= 5 ? '' : ' off'}" data-act="smelt_silver">
    <div class="t">Smelt Silver</div><div class="r">2 ore + 5g → ingot</div></div>
  <div class="ef-fgcard${mCount('pelt') >= 2 ? '' : ' off'}" data-act="tan">
    <div class="t">Tan Hides</div><div class="r">2 pelts → leather</div></div>
</div>`;
    for (const id of WHEEL_ROWS) {
      const up = UPGRADEABLE.indexOf(id) >= 0;
      const t = tierOf(id);
      const ench = enchantOf(id);
      if (up) {
        h += `<div class="ef-fgrow${id === selW ? ' sel' : ''}" data-w="${id}">
  ${ench ? `<span class="ench" style="color:${ENCHANTS[ench].hex};background:${ENCHANTS[ench].hex}"></span>` : ''}
  <span class="nm">${esc(wname(id))}${t ? ' <i style="color:#8a5a1c">· ' + TIER_NAME[t] + '</i>' : ''}</span>
  <span class="tier">${tierPips(t)}</span>
  <span class="bon">${t ? '+' + Math.round(TIER_BONUS[t] * 100) + '%' : '—'}</span>
</div>`;
      } else {
        const note = id === 'torch' ? 'burns fine as it is' : 'honed by tomes, not hammers';
        h += `<div class="ef-fgrow na"><span class="nm">${esc(wname(id))}</span><span class="bon">${note}</span></div>`;
      }
    }
    elBody.innerHTML = h;
  }

  function renderEnchList() {
    let h = '<div id="ef-fgsmelt">';
    for (const id of UPGRADEABLE) {
      const ench = enchantOf(id);
      h += `<div class="ef-fgcard${id === selW ? '' : ' off'}" data-w="${id}" style="${id === selW ? 'border-color:#8a6cc9;' : ''}">
  <div class="t">${esc(wname(id))}</div>
  <div class="r">${ench ? '<span style="color:' + ENCHANTS[ench].hex + ';text-shadow:0 0 6px ' + ENCHANTS[ench].hex + '">' + ENCHANTS[ench].name + '</span>' : 'unbound'}</div></div>`;
    }
    h += '</div>';
    for (const id of ENCH_IDS) {
      const e = ENCHANTS[id];
      const bound = enchantOf(selW) === id;
      h += `<div class="ef-fgrow${id === selE ? ' sel' : ''}" data-e="${id}">
  <span class="ench" style="color:${e.hex};background:${e.hex}"></span>
  <span class="nm">${e.name}${bound ? ' <i style="color:#8a5a1c">· bound</i>' : ''}
    <div style="font-size:11.5px;color:#7a6238;font-style:italic;">${e.desc}</div></span>
</div>`;
    }
    elBody.innerHTML = h;
  }

  // Affordability check → { ok, why, pay() }
  function forgePlan(id) {
    const t = tierOf(id);
    if (t >= 4) return { maxed: true };
    const r = tierRecipe(id, t + 1);
    if (plevel() < r.lvl) return { r, why: 'Requires level ' + r.lvl };
    for (const [m, n] of r.mats) if (mCount(m) < n) return { r, why: 'Not enough ' + mName(m).toLowerCase() };
    let rare = null;
    if (r.oneOf) {
      for (const [m, n] of r.oneOf) if (mCount(m) >= n) { rare = [m, n]; break; }
      if (!rare) return { r, why: 'Needs a troll heart or a drake scale' };
    }
    if (gold() < r.gold) return { r, why: 'Costs ' + r.gold + ' gold' };
    return {
      r, ok: true,
      pay() {
        for (const [m, n] of r.mats) mTake(m, n);
        if (rare) mTake(rare[0], rare[1]);
        spendGold(r.gold);
      },
    };
  }
  function enchPlan(wid, eid) {
    const e = ENCHANTS[eid];
    for (const [m, n] of e.mats) if (mCount(m) < n) return { e, why: 'Not enough ' + mName(m).toLowerCase() };
    if (gold() < e.gold) return { e, why: 'Costs ' + e.gold + ' gold' };
    return {
      e, ok: true,
      pay() {
        for (const [m, n] of e.mats) mTake(m, n);
        spendGold(e.gold);
      },
    };
  }

  function recipeChips(list, oneOf, goldCost) {
    let h = '';
    for (const [m, n] of list) {
      const have = mCount(m);
      h += `<span class="ef-fgreq${have < n ? ' lack' : ''}">${esc(mName(m))} ${Math.min(have, n)}/${n}</span>`;
    }
    if (oneOf) {
      const names = oneOf.map(([m]) => mName(m) + ' (' + mCount(m) + ')').join(' or ');
      const any = oneOf.some(([m, n]) => mCount(m) >= n);
      h += `<span class="ef-fgreq${any ? '' : ' lack'}">1× ${names}</span>`;
    }
    h += `<span class="ef-fgreq${gold() < goldCost ? ' lack' : ''}">✦ ${goldCost} gold</span>`;
    return h;
  }

  function renderDetail() {
    elHold.classList.remove('holding');
    elFill.style.width = '0%';
    if (mode === 'forge') {
      if (UPGRADEABLE.indexOf(selW) < 0) selW = 'sword';
      const t = tierOf(selW);
      const plan = forgePlan(selW);
      if (plan.maxed) {
        elDName.innerHTML = `${esc(wname(selW))} — <i>Legendary. The anvil has no more to teach it.</i>`;
        elRecipe.innerHTML = '';
        elHold.classList.add('off');
        elHoldTx.textContent = 'Masterwork of a lifetime';
        elHint.textContent = '';
        return;
      }
      const r = plan.r;
      elDName.innerHTML = `${esc(wname(selW))} → <b>${TIER_NAME[t + 1]}</b> <i>(+${Math.round(TIER_BONUS[t + 1] * 100)}% damage${r.lvl > 1 ? ', level ' + r.lvl : ''})</i>`;
      elRecipe.innerHTML = recipeChips(r.mats, r.oneOf, r.gold);
      elHold.classList.toggle('off', !plan.ok);
      elHoldTx.textContent = plan.ok ? '⚒ Hold to Forge' : plan.why;
      elHint.textContent = plan.ok ? 'Keep the hammer down — three strikes make the temper.' : '';
    } else {
      const e = ENCHANTS[selE];
      const bound = enchantOf(selW) === selE;
      const plan = enchPlan(selW, selE);
      elDName.innerHTML = `${e.name} on ${esc(wname(selW))}${bound ? ' — <i>already bound (rebinding costs the full rite)</i>' : enchantOf(selW) ? ' — <i>replaces ' + ENCHANTS[enchantOf(selW)].name + '</i>' : ''}`;
      elRecipe.innerHTML = recipeChips(e.mats, null, e.gold);
      elHold.classList.toggle('off', !plan.ok);
      elHoldTx.textContent = plan.ok ? '✦ Hold to Bind' : plan.why;
      elHint.textContent = plan.ok ? 'Hold steady — the rite takes a breath and a half.' : '';
    }
  }

  function renderAll() {
    chipRow();
    if (mode === 'forge') renderForgeList();
    else renderEnchList();
    renderDetail();
  }

  // -------------------------------------------------------------------------
  // FX in the panel: spark bursts, rune circle, toast
  // -------------------------------------------------------------------------
  function domSparks(x, y, colorA, colorB) {
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('i');
      const a = Math.random() * Math.PI * 2;
      const d = 26 + Math.random() * 60;
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d - 22).toFixed(0) + 'px');
      s.style.setProperty('--c', Math.random() < 0.5 ? colorA : colorB);
      elFx.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
  }
  function sparksAt(el, colorA, colorB) {
    const pr = root.querySelector('#ef-fgpanel').getBoundingClientRect();
    const br = el.getBoundingClientRect();
    domSparks(br.left - pr.left + br.width / 2, br.top - pr.top + br.height / 2,
      colorA || '#ffd873', colorB || '#ff8a3c');
  }
  function runeFlash(hex) {
    elRune.style.borderColor = hex;
    elRune.style.color = hex;
    elRune.style.boxShadow = `0 0 40px ${hex}88, inset 0 0 26px ${hex}55`;
    elRune.classList.remove('go');
    void elRune.offsetWidth;
    elRune.classList.add('go');
  }
  function toast(text) {
    elToast.textContent = text;
    elToast.classList.remove('go');
    void elToast.offsetWidth;
    elToast.classList.add('go');
  }

  // -------------------------------------------------------------------------
  // The weighty HOLD interaction (rAF-driven; runs fine while g.paused)
  // -------------------------------------------------------------------------
  let holding = false, holdT0 = 0, holdPrev = 0, holdRaf = 0;

  function holdDur() { return mode === 'forge' ? 1.2 : 1.5; }

  function holdTick() {
    if (!holding) return;
    const p = clamp((performance.now() - holdT0) / 1000 / holdDur(), 0, 1);
    elFill.style.width = (p * 100).toFixed(1) + '%';
    if (mode === 'forge') {
      // three anvil strikes as the temper sets
      for (const th of [0.29, 0.62, 0.95]) {
        if (holdPrev < th && p >= th) { sfx('hitClang'); sparksAt(elHold, '#ffd873', '#ff8a3c'); }
      }
    } else {
      if (holdPrev < 0.55 && p >= 0.55) sfx('heal'); // the chime rises
    }
    holdPrev = p;
    if (p >= 1) { holding = false; elHold.classList.remove('holding'); completeHold(); return; }
    holdRaf = requestAnimationFrame(holdTick);
  }
  function startHold() {
    if (holding || elHold.classList.contains('off')) return;
    holding = true;
    holdT0 = performance.now();
    holdPrev = 0;
    elHold.classList.add('holding');
    if (mode === 'ench') sfx('heal');
    holdRaf = requestAnimationFrame(holdTick);
  }
  function cancelHold() {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(holdRaf);
    elHold.classList.remove('holding');
    elFill.style.width = '0%';
  }

  function completeHold() {
    if (mode === 'forge') {
      const plan = forgePlan(selW);
      if (!plan.ok) { renderDetail(); return; }
      plan.pay();
      const f = F();
      f.tiers[selW] = (f.tiers[selW] | 0) + 1;
      const t = f.tiers[selW];
      ev.emit('weaponForged', { id: selW, tier: t });
      sfx('hitClang');
      sparksAt(elHold, '#ffd873', '#ff8a3c');
      toast('⚒ ' + TIER_NAME[t] + ' ' + wname(selW) + ' forged');
    } else {
      const plan = enchPlan(selW, selE);
      if (!plan.ok) { renderDetail(); return; }
      plan.pay();
      F().enchants[selW] = selE;
      ev.emit('weaponEnchanted', { id: selW, school: selE });
      sfx('levelUp');
      runeFlash(ENCHANTS[selE].hex);
      sparksAt(elHold, ENCHANTS[selE].hex, '#e8dcff');
      toast('✦ ' + ENCHANTS[selE].name + ' bound to ' + wname(selW));
    }
    renderAll();
  }

  // -------------------------------------------------------------------------
  // Open / close
  // -------------------------------------------------------------------------
  function openPanel() {
    if (open) return;
    open = true;
    wasPaused = g.paused;
    g.paused = true;
    root.classList.add('on');
    sfx('uiClick');
    renderAll();
  }
  function closePanel(silent) {
    if (!open) return;
    open = false;
    cancelHold();
    root.classList.remove('on');
    if (!wasPaused) g.paused = false;
    if (!silent) sfx('uiClick');
  }

  function openForge() {
    mode = 'forge';
    root.classList.remove('m-ench');
    root.classList.add('m-forge');
    elTitle.textContent = '⚒ The Village Forge';
    elSub.textContent = 'Torvald keeps the coals hot. Iron remembers the hammer.';
    if (UPGRADEABLE.indexOf(selW) < 0) selW = 'sword';
    openPanel();
  }
  function openEnchant(which) {
    mode = 'ench';
    site = which || 'stones';
    root.classList.remove('m-forge');
    root.classList.add('m-ench');
    elTitle.textContent = '✦ Enchanting Rite';
    elSub.textContent = site === 'cauldron'
      ? 'Grimhilde’s cauldron simmers green. “Don’t stir it,” she says. “Just hold.”'
      : 'The cleansed Wardstones hum. The runes are listening.';
    if (UPGRADEABLE.indexOf(selW) < 0) selW = 'sword';
    openPanel();
  }

  // Panel input wiring ---------------------------------------------------------
  $('ef-fgclose').addEventListener('click', () => closePanel());
  $('ef-fgdim').addEventListener('click', () => closePanel());

  elBody.addEventListener('click', (e2) => {
    const card = e2.target.closest('.ef-fgcard');
    if (card && mode === 'forge' && card.dataset.act) {
      const act = card.dataset.act;
      let did = false;
      if (act === 'smelt_iron' && mCount('iron_ore') >= 2 && gold() >= 5) {
        mTake('iron_ore', 2); spendGold(5); mGive('iron_ingot', 1);
        toast('⚒ Iron Ingot smelted'); did = true;
      } else if (act === 'smelt_silver' && mCount('silver_ore') >= 2 && gold() >= 5) {
        mTake('silver_ore', 2); spendGold(5); mGive('silver_ingot', 1);
        toast('⚒ Silver Ingot smelted'); did = true;
      } else if (act === 'tan' && mCount('pelt') >= 2) {
        mTake('pelt', 2); mGive('leather', 1);
        toast('Leather tanned and oiled'); did = true;
      }
      if (did) {
        sfx('hitClang');
        sparksAt(card, '#ffd873', '#ff8a3c');
        renderAll();
      }
      return;
    }
    if (card && mode === 'ench' && card.dataset.w) {
      selW = card.dataset.w;
      sfx('uiClick');
      renderAll();
      return;
    }
    const row = e2.target.closest('.ef-fgrow');
    if (!row || row.classList.contains('na')) return;
    if (mode === 'forge' && row.dataset.w) { selW = row.dataset.w; sfx('uiClick'); renderAll(); }
    else if (mode === 'ench' && row.dataset.e) { selE = row.dataset.e; sfx('uiClick'); renderAll(); }
  });

  elHold.addEventListener('pointerdown', (e2) => { e2.preventDefault(); startHold(); });
  elHold.addEventListener('pointerup', cancelHold);
  elHold.addEventListener('pointerleave', cancelHold);
  elHold.addEventListener('pointercancel', cancelHold);

  // -------------------------------------------------------------------------
  // Tome reading overlay
  // -------------------------------------------------------------------------
  let tomeOpen = false;
  let curTome = null;
  let tomeWasPaused = false;
  const SCHOOL_LABEL = { fire: 'the school of flame', frost: 'the school of frost', lightning: 'the school of storm', heal: 'the school of mending' };

  function openTome(o) {
    if (tomeOpen || open) return;
    tomeOpen = true;
    curTome = o;
    tomeWasPaused = g.paused;
    g.paused = true;
    troot.querySelector('#ef-tometitle').textContent = o.def.title;
    troot.querySelector('#ef-tomeschool').textContent = 'A spell tome — ' + SCHOOL_LABEL[o.def.school];
    troot.querySelector('#ef-tomebody').textContent = o.def.text;
    const hx = '#' + o.def.hex.toString(16).padStart(6, '0');
    troot.querySelector('#ef-tomepanel').style.setProperty('--glow', hx + '59');
    troot.classList.add('on');
    sfx('chestOpen');
  }
  function learnTome() {
    if (!curTome) return;
    const o = curTome;
    if (!g.flags['tome_' + o.def.id]) {
      g.flags['tome_' + o.def.id] = true;
      o.group.visible = false;
      sfx('levelUp');
      notify(o.def.title, o.def.note);
    }
  }
  function closeTome(silent) {
    if (!tomeOpen) return;
    learnTome();
    tomeOpen = false;
    curTome = null;
    troot.classList.remove('on');
    if (!tomeWasPaused) g.paused = false;
    if (!silent) sfx('uiClick');
  }
  troot.querySelector('#ef-tomebtn').addEventListener('click', () => closeTome());
  troot.querySelector('#ef-tomedim').addEventListener('click', () => closeTome());

  // Keyboard: Esc closes whichever overlay is up (capture-phase, like books.js)
  window.addEventListener('keydown', (e2) => {
    if (!open && !tomeOpen) return;
    switch (e2.code) {
      case 'Escape':
        e2.preventDefault(); e2.stopImmediatePropagation();
        if (tomeOpen) closeTome(); else closePanel();
        break;
      case 'KeyJ': case 'Tab': case 'KeyQ': case 'KeyE': case 'Space':
        e2.preventDefault(); e2.stopImmediatePropagation();
        break;
    }
  }, true);

  // -------------------------------------------------------------------------
  // update — blessing countdown + tome idle animation. No allocations.
  // -------------------------------------------------------------------------
  let blessWarned = false;

  function update(dt) {
    if (g.paused) return;
    const f = F();
    if (f.blessLeft > 0) {
      f.blessLeft = Math.max(0, f.blessLeft - dt);
      if (f.blessLeft === 0 && !blessWarned) {
        blessWarned = true;
        notify('The blessing fades', 'The Wardstones fall quiet again.');
      } else if (f.blessLeft > 0) {
        blessWarned = false;
      }
    }
    // Glowing tomes: bob, turn, pulse — only when near enough to matter.
    const p = g.player && g.player.position;
    if (p) {
      const t = g.time.elapsed;
      for (let i = 0; i < tomeObjs.length; i++) {
        const o = tomeObjs[i];
        if (!o.group.visible) continue;
        const dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
        if (dx * dx + dz * dz > 6400) continue; // >80u — skip
        o.group.position.y = o.baseY + Math.sin(t * 1.4 + o.phase) * 0.05;
        o.group.rotation.y += dt * 0.45;
        o.coverMat.emissiveIntensity = 0.55 + Math.sin(t * 2.1 + o.phase) * 0.22;
        o.glyphMat.emissiveIntensity = 1.0 + Math.sin(t * 3.1 + o.phase) * 0.4;
      }
    }
  }

  return {
    update,
    openForge,
    openEnchant,
    tierOf,
    enchantOf,
    dmgMult,
    spellTier,
    spellPower,
  };
}

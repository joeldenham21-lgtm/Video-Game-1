// ============================================================================
// ELDERFALL — rpg.js
// Learn-by-doing skill system + constellation perk trees.
// createRPG(g) → { update(dt), addSkillXP(id, xp), mult(name), has(perkId),
//                  points, skills, serialize(), deserialize(o),
//                  openTree(), closeTree() }
// - 6 skills (blade/marksman/sorcery/vitality/athletics/shadow), levels 1-100,
//   xp curve needed = 60 * 1.11^level, leveled by DOING (events + throttled
//   polling of g.player).
// - 48 perks across 6 constellation trees, tier-gated by skill level 20/40/
//   60/80 + prerequisite perks. Perk points from levelUp and every 10 skill
//   levels gained.
// - mult(name)/has(id): cached composed modifier table, recomputed only when
//   perks/skills/night-state change.
// - Full-screen Skyrim-style constellation UI: starfield, SVG star nodes +
//   lines, per-skill xp bars, tap → detail card → hold-to-unlock.
// State persists under g.flags.rpg (save.js persists flags wholesale).
// Only imports './core.js'. Degrades gracefully if other modules are absent.
// ============================================================================
import { clamp, dist2d, makeRng, WORLD_SEED } from './core.js';

// ---------------------------------------------------------------------------
// Skill definitions
// ---------------------------------------------------------------------------
const SKILL_IDS = ['blade', 'marksman', 'sorcery', 'vitality', 'athletics', 'shadow'];
const SKILL_META = {
  blade:     { name: 'Blade',     flavor: 'The way of steel' },
  marksman:  { name: 'Marksman',  flavor: 'The patient eye' },
  sorcery:   { name: 'Sorcery',   flavor: 'The burning word' },
  vitality:  { name: 'Vitality',  flavor: 'The unbroken' },
  athletics: { name: 'Athletics', flavor: 'The long road' },
  shadow:    { name: 'Shadow',    flavor: 'The unseen path' },
};
const MAX_LEVEL = 100;
const xpNeeded = (level) => 60 * Math.pow(1.11, level);

// ---------------------------------------------------------------------------
// Perk trees. Each perk: id, name, lbl (short constellation label), req
// (skill level), pre (array of prerequisite ids — ANY satisfies), x/y
// (constellation coords in a 0..100 × 0..118 viewBox), desc.
// ---------------------------------------------------------------------------
const TREES = {
  blade: [
    { id: 'bld_edge',    name: 'Keen Edge',      lbl: 'Edge',    req: 0,  pre: null,                        x: 50, y: 104, desc: 'Your blade bites deeper. Melee damage +15%.' },
    { id: 'bld_flow',    name: 'Flowing Steel',  lbl: 'Flow',    req: 20, pre: ['bld_edge'],                x: 30, y: 82,  desc: 'Light strikes that land refund 5 stamina.' },
    { id: 'bld_heavy',   name: 'Crushing Blows', lbl: 'Crush',   req: 20, pre: ['bld_edge'],                x: 70, y: 84,  desc: 'Heavy attacks deal +35% damage.' },
    { id: 'bld_riposte', name: 'Riposte',        lbl: 'Riposte', req: 40, pre: ['bld_flow'],                x: 22, y: 58,  desc: 'After a parry, your next strike is a devastating ×3 critical.' },
    { id: 'bld_cleave',  name: 'Cleave',         lbl: 'Cleave',  req: 40, pre: ['bld_heavy'],               x: 76, y: 60,  desc: 'Wider swings: attack arc +25°, each swing strikes one extra foe.' },
    { id: 'bld_dance',   name: 'Blade Dance',    lbl: 'Dance',   req: 60, pre: ['bld_riposte'],             x: 30, y: 36,  desc: 'Attack speed +20%.' },
    { id: 'bld_bleed',   name: 'Rend',           lbl: 'Rend',    req: 60, pre: ['bld_cleave'],              x: 68, y: 34,  desc: 'Heavy attacks open wounds, bleeding foes for 6 damage over 3s.' },
    { id: 'bld_master',  name: 'Blademaster',    lbl: 'Master',  req: 80, pre: ['bld_dance', 'bld_bleed'],  x: 50, y: 12,  desc: 'Capstone. Kills refresh 25% of your stamina. Melee damage +25%.' },
  ],
  marksman: [
    { id: 'mrk_draw',    name: 'Strong Draw',    lbl: 'Draw',    req: 0,  pre: null,                        x: 50, y: 104, desc: 'Bow damage +20%.' },
    { id: 'mrk_speed',   name: 'Quick Hands',    lbl: 'Quick',   req: 20, pre: ['mrk_draw'],                x: 28, y: 84,  desc: 'Draw your bow 25% faster.' },
    { id: 'mrk_calm',    name: 'Steady Breath',  lbl: 'Steady',  req: 20, pre: ['mrk_draw'],                x: 72, y: 82,  desc: 'Your aim does not waver — no bob while drawing.' },
    { id: 'mrk_knees',   name: 'Crippling Shot', lbl: 'Cripple', req: 40, pre: ['mrk_speed'],               x: 20, y: 58,  desc: 'Arrows slow struck foes by 30% for 2s.' },
    { id: 'mrk_pierce',  name: 'Piercing Shaft', lbl: 'Pierce',  req: 40, pre: ['mrk_calm'],                x: 78, y: 56,  desc: 'Arrows punch clean through the first target they strike.' },
    { id: 'mrk_recover', name: 'Deadeye',        lbl: 'Deadeye', req: 60, pre: ['mrk_knees'],               x: 30, y: 34,  desc: 'Full-draw shots gain +30% critical chance.' },
    { id: 'mrk_eagle',   name: 'Eagle Eye',      lbl: 'Eagle',   req: 60, pre: ['mrk_pierce'],              x: 66, y: 32,  desc: 'Holding a full draw slows time to 0.45× for up to 1.5s.' },
    { id: 'mrk_double',  name: 'Twin Shaft',     lbl: 'Twin',    req: 80, pre: ['mrk_recover', 'mrk_eagle'], x: 48, y: 10, desc: 'Capstone. Every third arrow forks into two.' },
  ],
  sorcery: [
    { id: 'src_kindle',  name: 'Kindling',       lbl: 'Kindle',  req: 0,  pre: null,                        x: 50, y: 104, desc: 'Spell damage +20%.' },
    { id: 'src_thrift',  name: 'Frugal Weave',   lbl: 'Thrift',  req: 20, pre: ['src_kindle'],              x: 30, y: 82,  desc: 'Spells cost 25% less mana.' },
    { id: 'src_mend',    name: 'Soothing Mend',  lbl: 'Mend',    req: 20, pre: ['src_kindle'],              x: 70, y: 84,  desc: 'Healing spells also restore 15 stamina.' },
    { id: 'src_ember',   name: 'Scorched Earth', lbl: 'Ember',   req: 40, pre: ['src_thrift'],              x: 22, y: 56,  desc: 'Fireballs leave burning ground for 4s.' },
    { id: 'src_surge',   name: 'Mana Surge',     lbl: 'Surge',   req: 40, pre: ['src_mend'],                x: 74, y: 60,  desc: 'Mana regenerates twice as fast out of combat.' },
    { id: 'src_ward',    name: 'Arcane Ward',    lbl: 'Ward',    req: 60, pre: ['src_surge'],               x: 60, y: 38,  desc: 'While mana exceeds 20, blocking draws on mana instead of stamina.' },
    { id: 'src_twin',    name: 'Twin Flame',     lbl: 'Twin',    req: 80, pre: ['src_ember'],               x: 28, y: 26,  desc: 'Capstone. Fireballs launch twinned.' },
    { id: 'src_arch',    name: 'Archmage',       lbl: 'Arch',    req: 80, pre: ['src_ward'],                x: 52, y: 12,  desc: 'Capstone. Spell damage +40%, and your spells stagger foes.' },
  ],
  vitality: [
    { id: 'vit_stone',   name: 'Stonehide',      lbl: 'Stone',   req: 0,  pre: null,                        x: 50, y: 104, desc: '+25 maximum health.' },
    { id: 'vit_thick',   name: 'Thick Hide',     lbl: 'Hide',    req: 20, pre: ['vit_stone'],               x: 28, y: 84,  desc: 'You take 15% less damage.' },
    { id: 'vit_potent',  name: 'Potent Draughts', lbl: 'Potent', req: 20, pre: ['vit_stone'],               x: 72, y: 84,  desc: 'Potions are 50% more effective.' },
    { id: 'vit_grit',    name: 'Grit',           lbl: 'Grit',    req: 40, pre: ['vit_thick'],               x: 20, y: 60,  desc: 'Blocked hits stoke your rage: your next attack deals +40% damage.' },
    { id: 'vit_thorns',  name: 'Shield Thorns',  lbl: 'Thorns',  req: 40, pre: ['vit_potent'],              x: 78, y: 58,  desc: 'Blocked melee blows reflect 20% of their damage.' },
    { id: 'vit_stand',   name: 'Stalwart',       lbl: 'Stand',   req: 60, pre: ['vit_grit'],                x: 36, y: 38,  desc: 'You cannot be staggered while blocking.' },
    { id: 'vit_second',  name: 'Second Wind',    lbl: 'Second',  req: 80, pre: ['vit_thorns'],              x: 66, y: 26,  desc: 'Capstone. A fatal blow leaves you at 1 hp and invulnerable for 3s. Once per 300s.' },
    { id: 'vit_titan',   name: "Titan's Blood",  lbl: 'Titan',   req: 80, pre: ['vit_stand'],               x: 34, y: 12,  desc: 'Capstone. +50 maximum health. Immune to knockback.' },
  ],
  athletics: [
    { id: 'ath_wind',    name: 'Fleet Foot',     lbl: 'Fleet',   req: 0,  pre: null,                        x: 50, y: 104, desc: 'Move 10% faster.' },
    { id: 'ath_lungs',   name: 'Deep Lungs',     lbl: 'Lungs',   req: 20, pre: ['ath_wind'],                x: 30, y: 84,  desc: '+30 maximum stamina.' },
    { id: 'ath_leap',    name: 'Springheel',     lbl: 'Leap',    req: 20, pre: ['ath_wind'],                x: 70, y: 84,  desc: 'Jump 30% higher.' },
    { id: 'ath_sprintstrike', name: 'Charging Strike', lbl: 'Charge', req: 40, pre: ['ath_lungs'],          x: 24, y: 60,  desc: 'Attacks made while sprinting deal +30% damage.' },
    { id: 'ath_surefoot', name: 'Surefooted',    lbl: 'Sure',    req: 40, pre: ['ath_leap'],                x: 76, y: 60,  desc: 'No falling damage from landings under 20 m/s.' },
    { id: 'ath_swim',    name: 'Riverborn',      lbl: 'Swim',    req: 60, pre: ['ath_surefoot'],            x: 62, y: 38,  desc: 'Swim at full speed.' },
    { id: 'ath_runner',  name: 'Marathoner',     lbl: 'Run',     req: 80, pre: ['ath_sprintstrike'],        x: 24, y: 26,  desc: 'Capstone. Sprinting costs 40% less stamina.' },
    { id: 'ath_flash',   name: 'Windrush',       lbl: 'Rush',    req: 80, pre: ['ath_swim'],                x: 52, y: 12,  desc: 'Capstone. Double-tap jump in the air to dash. 8s cooldown.' },
  ],
  shadow: [
    { id: 'shd_soft',    name: 'Soft Step',      lbl: 'Soft',    req: 0,  pre: null,                        x: 50, y: 104, desc: 'You are 35% harder to detect while sneaking.' },
    { id: 'shd_blade',   name: 'Backstab',       lbl: 'Backstab', req: 20, pre: ['shd_soft'],               x: 30, y: 84,  desc: 'Sneak melee strikes deal ×3 damage.' },
    { id: 'shd_bolt',    name: 'Silent Bolt',    lbl: 'Bolt',    req: 20, pre: ['shd_soft'],                x: 70, y: 84,  desc: 'Sneak bow shots deal ×2.5 damage.' },
    { id: 'shd_night',   name: 'Nightstalker',   lbl: 'Night',   req: 40, pre: ['shd_blade'],               x: 22, y: 58,  desc: 'Deal +15% damage at night.' },
    { id: 'shd_pockets', name: 'Deep Pockets',   lbl: 'Pockets', req: 40, pre: ['shd_bolt'],                x: 78, y: 58,  desc: 'Find 30% more gold.' },
    { id: 'shd_ghost',   name: 'Ghost',          lbl: 'Ghost',   req: 60, pre: ['shd_night'],               x: 50, y: 44,  desc: 'Kills made while undetected do not alert others.' },
    { id: 'shd_assassin', name: 'Assassin',      lbl: 'Assassin', req: 80, pre: ['shd_ghost'],              x: 30, y: 20,  desc: 'Capstone. Sneak melee strikes deal ×6 damage.' },
    { id: 'shd_veil',    name: 'Shadow Veil',    lbl: 'Veil',    req: 80, pre: ['shd_pockets'],             x: 70, y: 22,  desc: 'Capstone. Crouch still for 2s to become near-invisible until you move.' },
  ],
};
const PERK_BY_ID = {};
for (const sk of SKILL_IDS) for (const p of TREES[sk]) { p.skill = sk; PERK_BY_ID[p.id] = p; }

// XP tuning (generous — playing the game levels you)
const XP = {
  bladeHit: 4.5, bladeHeavy: 8, bladeKill: 4, parry: 8,
  bowHit: 5, bowKill: 12,
  spellPerCost: 0.7,
  vitPerDmg: 0.6, vitPerBlockStam: 0.5,
  sprintPerSec: 1.2, jumpLand: 2,
  sneakPerSec: 3, sneakKill: 30,
  questLow: 40, discoverLow: 15,
};
const HOLD_MS = 650;           // hold-to-unlock duration
const CHAR_XP_PER_SKILL_LVL = 8;

// ============================================================================
export function createRPG(g) {
  // --------------------------------------------------------------------------
  // Durable state — lives under g.flags.rpg (save.js persists flags wholesale)
  // --------------------------------------------------------------------------
  function freshState() {
    const skills = {};
    for (const id of SKILL_IDS) skills[id] = { level: 1, xp: 0 };
    return { skills, perks: {}, points: 0, gained: 0 };
  }
  let state = freshState();
  // Adopt pre-existing flag state (e.g. flags loaded before we were built)
  if (g.flags.rpg && typeof g.flags.rpg === 'object') {
    applyState(g.flags.rpg);
  }
  g.flags.rpg = state;

  // --------------------------------------------------------------------------
  // Cached modifier table
  // --------------------------------------------------------------------------
  const cache = {};
  let dirty = true;
  let isNight = false;          // polled; dirties cache on change
  let charmOn = false;          // g.flags.gravekeepersCharm (books module)

  const skillPass = (id) => 1 + 0.004 * (state.skills[id].level - 1);

  function recompute() {
    dirty = false;
    const p = state.perks;
    const nightMul = (p.shd_night && isNight) ? 1.15 : 1;
    cache.meleeDmg      = skillPass('blade') * (p.bld_edge ? 1.15 : 1) * (p.bld_master ? 1.25 : 1) * nightMul;
    cache.heavyDmg      = p.bld_heavy ? 1.35 : 1;
    cache.bowDmg        = skillPass('marksman') * (p.mrk_draw ? 1.2 : 1) * nightMul;
    cache.drawSpeed     = p.mrk_speed ? 1.25 : 1;
    cache.spellDmg      = skillPass('sorcery') * (p.src_kindle ? 1.2 : 1) * (p.src_arch ? 1.4 : 1) * nightMul;
    cache.spellCost     = p.src_thrift ? 0.75 : 1;
    // Flat hp/stamina perks expressed against the base-100 pools as factors
    cache.maxHp         = skillPass('vitality') * (1 + (p.vit_stone ? 0.25 : 0) + (p.vit_titan ? 0.5 : 0));
    cache.maxStamina    = skillPass('athletics') * (1 + (p.ath_lungs ? 0.3 : 0));
    cache.dmgTaken      = p.vit_thick ? 0.85 : 1;
    cache.moveSpeed     = p.ath_wind ? 1.1 : 1;
    cache.sprintCost    = p.ath_runner ? 0.6 : 1;
    cache.jumpPower     = p.ath_leap ? 1.3 : 1;
    cache.potionPower   = p.vit_potent ? 1.5 : 1;
    // < 1 means harder to detect (enemies scale sight range by this)
    cache.sneakDetect   = Math.max(0.25, 1 - 0.004 * (state.skills.shadow.level - 1)) * (p.shd_soft ? 0.65 : 1);
    cache.sneakMeleeMult = p.shd_assassin ? 6 : (p.shd_blade ? 3 : 1);
    cache.sneakBowMult  = p.shd_bolt ? 2.5 : 1;
    cache.goldFind      = (p.shd_pockets ? 1.3 : 1) * (charmOn ? 1.1 : 1);
    cache.attackSpeed   = p.bld_dance ? 1.2 : 1;
    cache.critChance    = 1 + (p.mrk_recover ? 0.3 : 0);
  }

  function mult(name) {
    if (dirty) recompute();
    const v = cache[name];
    return v === undefined ? 1 : v;
  }
  const has = (id) => !!state.perks[id];

  // --------------------------------------------------------------------------
  // Skill XP / leveling
  // --------------------------------------------------------------------------
  const skillUpEvt = { skill: '', level: 0 };
  const notifyEvt = { text: '', sub: '' };
  const perkEvt = { perk: null };

  function addSkillXP(id, xp) {
    const s = state.skills[id];
    if (!s || !(xp > 0)) return;
    if (s.level >= MAX_LEVEL) return;
    s.xp += xp;
    let leveled = false;
    while (s.level < MAX_LEVEL && s.xp >= xpNeeded(s.level)) {
      s.xp -= xpNeeded(s.level);
      s.level++;
      state.gained++;
      leveled = true;
      skillUpEvt.skill = id;
      skillUpEvt.level = s.level;
      g.events.emit('skillUp', skillUpEvt);
      notifyEvt.text = 'Skill Increased';
      notifyEvt.sub = SKILL_META[id].name + ' improved (' + s.level + ')';
      g.events.emit('notify', notifyEvt);
      if (g.player && g.player.addXP) g.player.addXP(CHAR_XP_PER_SKILL_LVL);
      if (state.gained % 10 === 0) grantPoint('Your training bears fruit');
    }
    if (s.level >= MAX_LEVEL) s.xp = 0;
    if (leveled) {
      dirty = true;
      uiOnSkillChanged(id);
    }
  }

  function grantPoint(subText) {
    state.points++;
    notifyEvt.text = 'Perk Point Earned';
    notifyEvt.sub = subText + ' — open ✦ Skills';
    g.events.emit('notify', notifyEvt);
    uiOnPointsChanged();
  }

  // Perk unlock
  function canUnlock(perk) {
    if (state.perks[perk.id] || state.points <= 0) return false;
    if (state.skills[perk.skill].level < perk.req) return false;
    if (perk.pre && !perk.pre.some((id) => state.perks[id])) return false;
    return true;
  }
  function unlock(perk) {
    if (!canUnlock(perk)) return false;
    state.points--;
    state.perks[perk.id] = true;
    dirty = true;
    perkEvt.perk = perk;
    g.events.emit('perkUnlocked', perkEvt);
    if (g.audio && g.audio.play) g.audio.play('levelUp');
    if (navigator.vibrate) { try { navigator.vibrate(24); } catch (_) { /* ok */ } }
    uiOnPointsChanged();
    return true;
  }

  // --------------------------------------------------------------------------
  // Serialization
  // --------------------------------------------------------------------------
  function serialize() {
    const skills = {};
    for (const id of SKILL_IDS) skills[id] = { level: state.skills[id].level, xp: state.skills[id].xp };
    return { skills, perks: Object.assign({}, state.perks), points: state.points, gained: state.gained };
  }
  function applyState(o) {
    if (!o || typeof o !== 'object' || o === state) return;
    if (o.skills) {
      for (const id of SKILL_IDS) {
        const src = o.skills[id];
        if (src) {
          state.skills[id].level = clamp(Math.round(src.level) || 1, 1, MAX_LEVEL);
          state.skills[id].xp = (typeof src.xp === 'number' && isFinite(src.xp) && src.xp >= 0) ? src.xp : 0;
        }
      }
    }
    if (o.perks && typeof o.perks === 'object') {
      for (const k in state.perks) delete state.perks[k];
      for (const k in o.perks) if (PERK_BY_ID[k] && o.perks[k]) state.perks[k] = true;
    }
    if (typeof o.points === 'number' && isFinite(o.points)) state.points = Math.max(0, Math.round(o.points));
    if (typeof o.gained === 'number' && isFinite(o.gained)) state.gained = Math.max(0, Math.round(o.gained));
    dirty = true;
  }
  function deserialize(o) {
    applyState(o);
    g.flags.rpg = state;
    uiOnPointsChanged();
    if (treeOpen) { refreshAllTabs(); refreshTree(); }
  }

  // --------------------------------------------------------------------------
  // XP sources — event subscriptions
  // --------------------------------------------------------------------------
  g.events.on('hitLanded', (e) => {
    const w = g.combat ? g.combat.current : null;
    if (w === 'sword' || w === 'torch') {
      addSkillXP('blade', (e && e.heavy ? XP.bladeHeavy : XP.bladeHit) + (e && e.kill ? XP.bladeKill : 0));
    } else if (w === 'bow') {
      addSkillXP('marksman', XP.bowHit + (e && e.kill ? XP.bowKill : 0));
    }
  });
  g.events.on('parry', () => addSkillXP('blade', XP.parry));
  g.events.on('spellCast', (e) => {
    if (e && e.cost > 0) addSkillXP('sorcery', e.cost * XP.spellPerCost);
  });
  g.events.on('playerDamaged', (e) => {
    if (e && e.amount > 0) addSkillXP('vitality', e.amount * XP.vitPerDmg);
  });
  g.events.on('enemyKilled', (e) => {
    if (g.player && g.player.sneaking) addSkillXP('shadow', XP.sneakKill);
    else if (g.combat && g.combat.current === 'bow') addSkillXP('marksman', 3); // arrows that kill at range
  });
  g.events.on('questCompleted', () => {
    // +40 xp to the two LOWEST skills — no grinding needed
    let lo1 = null, lo2 = null;
    for (const id of SKILL_IDS) {
      const s = state.skills[id];
      const key = s.level + s.xp / (xpNeeded(s.level) + 1);
      if (lo1 === null || key < lo1.k) { lo2 = lo1; lo1 = { id, k: key }; }
      else if (lo2 === null || key < lo2.k) lo2 = { id, k: key };
    }
    if (lo1) addSkillXP(lo1.id, XP.questLow);
    if (lo2) addSkillXP(lo2.id, XP.questLow);
  });
  g.events.on('discover', () => {
    let lo = SKILL_IDS[0], lok = Infinity;
    for (const id of SKILL_IDS) {
      const s = state.skills[id];
      const key = s.level + s.xp / (xpNeeded(s.level) + 1);
      if (key < lok) { lok = key; lo = id; }
    }
    addSkillXP(lo, XP.discoverLow);
  });
  g.events.on('levelUp', () => {
    grantPoint('You feel stronger');
    btnFlash();
  });
  g.events.on('gameLoaded', () => {
    if (g.flags.rpg && g.flags.rpg !== state) { applyState(g.flags.rpg); }
    g.flags.rpg = state;
    uiOnPointsChanged();
    if (treeOpen) { refreshAllTabs(); refreshTree(); }
  });

  // --------------------------------------------------------------------------
  // Polled XP sources (athletics / shadow / blocked hits) — throttled
  // --------------------------------------------------------------------------
  let pollT = 0;                 // 10Hz poll accumulator
  let scanT = 0;                 // enemy-proximity scan (slower)
  let nearStealthTarget = false;
  let sprintBuf = 0, sneakBuf = 0, jumpBuf = 0;
  let prevOnGround = true, airT = 0;
  let lastStamina = -1;

  function pollGameplay(pdt) {
    const pl = g.player;
    if (!pl) return;

    // flags-object swap detection (save.js may replace g.flags wholesale)
    if (g.flags.rpg !== state) {
      if (g.flags.rpg && typeof g.flags.rpg === 'object') applyState(g.flags.rpg);
      g.flags.rpg = state;
      uiOnPointsChanged();
    }

    // night / charm state → dirty cache when they flip
    const night = g.time.dayFrac < 0.22 || g.time.dayFrac > 0.78;
    if (night !== isNight) { isNight = night; dirty = true; }
    const charm = !!g.flags.gravekeepersCharm;
    if (charm !== charmOn) { charmOn = charm; dirty = true; }

    // vitality: blocked hits cost stamina — credit stamina lost while blocking
    const st = pl.stats;
    if (st) {
      if (pl.isBlocking && lastStamina >= 0 && st.stamina < lastStamina - 2) {
        addSkillXP('vitality', (lastStamina - st.stamina) * XP.vitPerBlockStam);
      }
      lastStamina = st.stamina;
    }

    // shadow: refresh "near a living, non-aggroed enemy (<25u)" flag at ~3Hz
    scanT += pdt;
    if (scanT >= 0.35) {
      scanT = 0;
      nearStealthTarget = false;
      const list = g.enemies ? g.enemies.list : null;
      if (list) {
        const px = pl.position.x, pz = pl.position.z;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (e.alive && !e.aggro && dist2d(px, pz, e.pos.x, e.pos.z) < 25) {
            nearStealthTarget = true;
            break;
          }
        }
      }
    }

    // flush per-frame accumulators
    if (sprintBuf > 0.5) { addSkillXP('athletics', sprintBuf * XP.sprintPerSec); sprintBuf = 0; }
    if (jumpBuf > 0) { addSkillXP('athletics', jumpBuf); jumpBuf = 0; }
    if (sneakBuf > 0.4) { addSkillXP('shadow', sneakBuf * XP.sneakPerSec); sneakBuf = 0; }
  }

  // --------------------------------------------------------------------------
  // ========================  CONSTELLATION TREE UI  =========================
  // --------------------------------------------------------------------------
  const hud = document.getElementById('hud');
  let treeOpen = false;
  let curSkill = 'blade';
  let selPerk = null;            // perk currently shown in the detail card
  let holding = false, holdStart = 0;
  let wasPausedByUs = false;

  const style = document.createElement('style');
  style.textContent = `
/* ===================== rpg.js — Skills constellation ===================== */
#ef-rpg-btn{position:absolute;pointer-events:auto;width:40px;height:40px;border-radius:9px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none;
  top:calc(12px + env(safe-area-inset-top,0px));right:calc(114px + env(safe-area-inset-right,0px));
  color:var(--gold);font-size:19px;line-height:1;
  background:linear-gradient(180deg,rgba(40,30,18,.85),rgba(22,16,10,.85));
  border:1px solid rgba(217,180,106,.5);box-shadow:0 2px 8px rgba(0,0,0,.5);
  transition:transform .08s ease,box-shadow .3s ease;}
#ef-rpg-btn:active{transform:scale(.9);}
#ef-rpg-btn .bdg{position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;
  border-radius:9px;display:none;align-items:center;justify-content:center;
  font-size:11px;color:#241a06;font-family:Georgia,serif;
  background:radial-gradient(circle at 35% 30%,#ffe9a8,#d9a83f);
  border:1px solid #8a6a2a;box-shadow:0 1px 4px rgba(0,0,0,.6);}
#ef-rpg-btn.pts .bdg{display:flex;}
#ef-rpg-btn.pts{animation:ef-rpg-btng 2.4s ease-in-out infinite;}
@keyframes ef-rpg-btng{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.5);}
  50%{box-shadow:0 0 16px rgba(255,216,115,.55),0 2px 8px rgba(0,0,0,.5);}}
#ef-rpg-btn.flash{animation:ef-rpg-btnf 1.1s ease;}
@keyframes ef-rpg-btnf{0%{transform:scale(1);}18%{transform:scale(1.35);
  box-shadow:0 0 26px rgba(255,216,115,.95);}100%{transform:scale(1);}}
#hud.ef-modal-open #ef-rpg-btn,#hud.ef-wheel-open #ef-rpg-btn{opacity:0;pointer-events:none;}
#hud.ef-rpg-open #ef-touch,#hud.ef-rpg-open #ef-pill,#hud.ef-rpg-open #ef-cross,
#hud.ef-rpg-open #ef-joy,#hud.ef-rpg-open #ef-hint,#hud.ef-rpg-open #ef-stats,
#hud.ef-rpg-open #ef-compass,#hud.ef-rpg-open #ef-rpg-btn{opacity:0!important;pointer-events:none!important;}
#hud.ef-rpg-open #ef-touch *{pointer-events:none!important;}

/* ---------- panel ---------- */
#ef-rpg{position:absolute;inset:0;opacity:0;pointer-events:none;overflow:hidden;
  display:flex;flex-direction:column;transition:opacity .35s ease;
  background:
    radial-gradient(ellipse at 22% 18%, rgba(64,72,140,.22), transparent 52%),
    radial-gradient(ellipse at 80% 70%, rgba(110,60,130,.14), transparent 55%),
    radial-gradient(ellipse at 50% 115%, rgba(190,130,50,.12), transparent 50%),
    linear-gradient(180deg,#070a14 0%,#0a0e1c 55%,#0d1020 100%);}
#ef-rpg.on{opacity:1;pointer-events:auto;}
#ef-rpg-stars{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;
  animation:ef-rpg-tw 5.5s ease-in-out infinite;}
@keyframes ef-rpg-tw{0%,100%{opacity:.9;}50%{opacity:.65;}}
#ef-rpg-vin{position:absolute;inset:0;pointer-events:none;
  box-shadow:inset 0 0 140px 40px rgba(0,0,0,.55);}
#ef-rpg-wrap{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;
  transform:scale(.965);transition:transform .35s cubic-bezier(.2,.9,.25,1);}
#ef-rpg.on #ef-rpg-wrap{transform:scale(1);}

/* ---------- header ---------- */
#ef-rpg-head{display:flex;align-items:center;gap:14px;
  padding:calc(10px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) 8px
          calc(16px + env(safe-area-inset-left,0px));}
#ef-rpg-title{font-size:19px;letter-spacing:.34em;color:#f2e6c6;
  text-shadow:0 1px 6px #000,0 0 18px rgba(217,180,106,.35);}
#ef-rpg-pts{flex:1;text-align:right;font-size:14px;letter-spacing:.1em;color:var(--gold);
  text-shadow:0 1px 3px #000;}
#ef-rpg-pts b{color:var(--goldhi);font-weight:400;font-size:16px;}
#ef-rpg-x{width:36px;height:36px;display:flex;align-items:center;justify-content:center;
  color:var(--gold2);font-size:19px;cursor:pointer;border:1px solid rgba(217,180,106,.35);
  border-radius:8px;background:rgba(20,15,9,.5);transition:color .15s,border-color .15s;}
#ef-rpg-x:hover,#ef-rpg-x:active{color:var(--goldhi);border-color:var(--gold);}

/* ---------- skill tabs ---------- */
#ef-rpg-tabs{display:flex;gap:8px;overflow-x:auto;flex:none;scrollbar-width:none;
  padding:4px calc(16px + env(safe-area-inset-right,0px)) 8px calc(16px + env(safe-area-inset-left,0px));}
#ef-rpg-tabs::-webkit-scrollbar{display:none;}
.ef-rpg-tab{flex:1 0 auto;min-width:104px;padding:7px 10px 8px;border-radius:7px;cursor:pointer;
  background:linear-gradient(180deg,rgba(30,24,16,.72),rgba(16,12,8,.78));
  border:1px solid rgba(217,180,106,.28);text-align:center;
  transition:border-color .2s ease,background .2s ease,transform .2s ease;}
.ef-rpg-tab:active{transform:scale(.97);}
.ef-rpg-tab .n{font-size:13px;letter-spacing:.14em;color:#cbb98f;text-transform:uppercase;
  transition:color .2s ease;}
.ef-rpg-tab .l{font-size:11px;color:#8a7c62;margin-top:1px;}
.ef-rpg-tab .l b{color:var(--gold);font-weight:400;font-size:13px;}
.ef-rpg-tab .xp{height:3px;margin-top:5px;border-radius:2px;overflow:hidden;
  background:rgba(8,6,4,.8);border:1px solid rgba(217,180,106,.2);}
.ef-rpg-tab .xp i{display:block;height:100%;transform-origin:0 50%;transform:scaleX(0);
  background:linear-gradient(90deg,var(--gold2),var(--goldhi));transition:transform .4s ease;}
.ef-rpg-tab.on{border-color:var(--gold);
  background:linear-gradient(180deg,rgba(64,48,26,.85),rgba(30,22,12,.9));
  box-shadow:0 0 14px rgba(217,180,106,.22),inset 0 1px 0 rgba(255,230,170,.15);}
.ef-rpg-tab.on .n{color:var(--goldhi);}

/* ---------- constellation view ---------- */
#ef-rpg-view{position:relative;flex:1;min-height:0;display:flex;
  align-items:center;justify-content:center;}
#ef-rpg-sub{position:absolute;top:2px;left:0;right:0;text-align:center;pointer-events:none;
  font-style:italic;font-size:12.5px;letter-spacing:.18em;color:rgba(203,185,143,.75);
  text-shadow:0 1px 3px #000;transition:opacity .3s ease;}
#ef-rpg-svg{width:100%;height:100%;max-width:640px;display:block;
  filter:drop-shadow(0 0 22px rgba(30,40,90,.5));
  transition:transform .32s cubic-bezier(.2,.9,.25,1);}
#ef-rpg-view.carded #ef-rpg-svg{transform:translateY(-9%) scale(.92);}
.ef-rpg-tree{opacity:0;pointer-events:none;transition:opacity .32s ease,transform .32s ease;
  transform:translateY(3px);}
.ef-rpg-tree.on{opacity:1;pointer-events:auto;transform:none;}
.ef-rpg-line{stroke:rgba(190,205,245,.16);stroke-width:.45;stroke-linecap:round;
  transition:stroke .4s ease;}
.ef-rpg-line.half{stroke:rgba(220,228,255,.34);}
.ef-rpg-line.lit{stroke:rgba(255,216,115,.6);}
.ef-rpg-node{cursor:pointer;}
.ef-rpg-node .halo{fill:url(#ef-rpg-glow);opacity:0;transition:opacity .35s ease;}
.ef-rpg-node .star{fill:#4d5878;stroke:rgba(210,220,255,.25);stroke-width:.3;
  transition:fill .3s ease,transform .3s ease;transform:scale(.8);}
.ef-rpg-node .lbl{fill:#5d688c;font-size:3.4px;text-anchor:middle;
  font-family:Georgia,'Times New Roman',serif;letter-spacing:.08em;pointer-events:none;
  transition:fill .3s ease;}
/* hit targets only active in the visible tree — pointer-events on children
   would otherwise override the hidden groups' pointer-events:none */
.ef-rpg-node .hit{fill:transparent;stroke:none;pointer-events:none;}
.ef-rpg-tree.on .ef-rpg-node .hit{pointer-events:all;}
.ef-rpg-node.avail .star{fill:#dfe8ff;transform:scale(1);stroke:rgba(255,255,255,.5);}
.ef-rpg-node.avail .lbl{fill:#c6d0ec;}
.ef-rpg-node.avail .halo{opacity:.5;animation:ef-rpg-np 2.2s ease-in-out infinite;}
@keyframes ef-rpg-np{0%,100%{opacity:.28;}50%{opacity:.7;}}
.ef-rpg-node.owned .star{fill:var(--goldhi);transform:scale(1.18);stroke:rgba(255,240,190,.7);}
.ef-rpg-node.owned .lbl{fill:var(--gold);}
.ef-rpg-node.owned .halo{opacity:.85;}
.ef-rpg-node.sel .star{stroke:#fff;stroke-width:.55;}
.ef-rpg-node.burst .halo{animation:ef-rpg-burst .8s ease-out;}
@keyframes ef-rpg-burst{0%{opacity:1;transform:scale(1);}100%{opacity:0;transform:scale(3.2);}}

/* ---------- detail card ---------- */
#ef-rpg-card{position:absolute;left:50%;bottom:calc(12px + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%) translateY(130%);width:min(94vw,430px);
  padding:13px 16px 14px;border-radius:9px;border:1px solid var(--gold2);
  background:linear-gradient(180deg,rgba(36,27,16,.97),rgba(19,14,9,.98));
  box-shadow:0 10px 34px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,230,170,.14);
  transition:transform .32s cubic-bezier(.2,.9,.25,1);pointer-events:auto;}
#ef-rpg-card.on{transform:translateX(-50%) translateY(0);}
#ef-rpg-card .nm{font-size:17px;letter-spacing:.12em;color:#f2e6c6;text-transform:uppercase;}
#ef-rpg-card .rq{font-size:12px;letter-spacing:.06em;margin-top:3px;color:#9a8a68;font-style:italic;}
#ef-rpg-card .rq.bad{color:#c98a70;}
#ef-rpg-card .rq.ok{color:#a9c087;}
#ef-rpg-card .ds{font-size:14px;line-height:1.45;color:var(--parch);margin-top:7px;}
#ef-rpg-unlock{position:relative;overflow:hidden;display:block;width:100%;margin-top:11px;
  font-family:inherit;font-size:14px;letter-spacing:.18em;color:#f0e4c4;text-transform:uppercase;
  cursor:pointer;padding:11px 0;border-radius:5px;
  background:linear-gradient(180deg,rgba(90,66,38,.9),rgba(52,38,22,.9));
  border:1px solid var(--gold2);box-shadow:inset 0 1px 0 rgba(255,230,170,.22);
  transition:opacity .2s ease;touch-action:none;-webkit-user-select:none;user-select:none;}
#ef-rpg-unlock[disabled]{opacity:.45;pointer-events:none;}
#ef-rpg-unlock.owned{color:var(--goldhi);border-color:var(--gold);pointer-events:none;
  background:linear-gradient(180deg,rgba(64,48,24,.9),rgba(38,28,14,.9));}
#ef-rpg-unlock .fill{position:absolute;inset:0;transform:scaleX(0);transform-origin:0 50%;
  background:linear-gradient(90deg,rgba(255,216,115,.22),rgba(255,216,115,.5));
  transition:transform ${HOLD_MS / 1000}s linear;pointer-events:none;}
#ef-rpg-unlock.holding .fill{transform:scaleX(1);}
#ef-rpg-unlock span{position:relative;}
`;
  document.head.appendChild(style);

  // ---- root DOM -------------------------------------------------------------
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;';
  root.innerHTML = `
<div id="ef-rpg-btn">✦<div class="bdg">0</div></div>
<div id="ef-rpg">
  <canvas id="ef-rpg-stars"></canvas>
  <div id="ef-rpg-vin"></div>
  <div id="ef-rpg-wrap">
    <div id="ef-rpg-head">
      <div id="ef-rpg-title">SKILLS</div>
      <div id="ef-rpg-pts">✦ <b>0</b> perk points</div>
      <div id="ef-rpg-x">✕</div>
    </div>
    <div id="ef-rpg-tabs"></div>
    <div id="ef-rpg-view">
      <div id="ef-rpg-sub"></div>
      <svg id="ef-rpg-svg" viewBox="0 0 100 118" preserveAspectRatio="xMidYMid meet"></svg>
      <div id="ef-rpg-card">
        <div class="nm"></div>
        <div class="rq"></div>
        <div class="ds"></div>
        <button id="ef-rpg-unlock"><i class="fill"></i><span></span></button>
      </div>
    </div>
  </div>
</div>`;
  if (hud) hud.appendChild(root);

  const $ = (id) => root.querySelector('#' + id);
  const elBtn = $('ef-rpg-btn');
  const elBdg = elBtn ? elBtn.querySelector('.bdg') : null;
  const elPanel = $('ef-rpg');
  const elStars = $('ef-rpg-stars');
  const elPts = $('ef-rpg-pts') ? $('ef-rpg-pts').querySelector('b') : null;
  const elTabs = $('ef-rpg-tabs');
  const elSub = $('ef-rpg-sub');
  const elSvg = $('ef-rpg-svg');
  const elCard = $('ef-rpg-card');
  const elCardNm = elCard.querySelector('.nm');
  const elCardRq = elCard.querySelector('.rq');
  const elCardDs = elCard.querySelector('.ds');
  const elUnlock = $('ef-rpg-unlock');
  const elUnlockTxt = elUnlock.querySelector('span');

  // ---- SVG: defs + all 6 constellation groups built once --------------------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const STAR_PATH = 'M0 -3.3 L0.82 -0.82 L3.3 0 L0.82 0.82 L0 3.3 L-0.82 0.82 L-3.3 0 L-0.82 -0.82 Z';
  {
    const defs = document.createElementNS(SVGNS, 'defs');
    defs.innerHTML =
      '<radialGradient id="ef-rpg-glow">' +
      '<stop offset="0%" stop-color="#ffe6a8" stop-opacity="0.9"/>' +
      '<stop offset="45%" stop-color="#ffd873" stop-opacity="0.35"/>' +
      '<stop offset="100%" stop-color="#ffd873" stop-opacity="0"/>' +
      '</radialGradient>';
    elSvg.appendChild(defs);
  }
  const treeGroups = {};   // skill → <g>
  const nodeEls = {};      // perkId → <g.ef-rpg-node>
  const lineEls = {};      // skill → [{el, from, to}]
  for (const sk of SKILL_IDS) {
    const gEl = document.createElementNS(SVGNS, 'g');
    gEl.setAttribute('class', 'ef-rpg-tree');
    lineEls[sk] = [];
    // lines first (under the stars)
    for (const p of TREES[sk]) {
      if (!p.pre) continue;
      for (const preId of p.pre) {
        const q = PERK_BY_ID[preId];
        const ln = document.createElementNS(SVGNS, 'line');
        ln.setAttribute('class', 'ef-rpg-line');
        ln.setAttribute('x1', q.x); ln.setAttribute('y1', q.y);
        ln.setAttribute('x2', p.x); ln.setAttribute('y2', p.y);
        gEl.appendChild(ln);
        lineEls[sk].push({ el: ln, from: preId, to: p.id });
      }
    }
    // star nodes
    for (const p of TREES[sk]) {
      const n = document.createElementNS(SVGNS, 'g');
      n.setAttribute('class', 'ef-rpg-node');
      n.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
      n.setAttribute('data-id', p.id);
      const halo = document.createElementNS(SVGNS, 'circle');
      halo.setAttribute('class', 'halo'); halo.setAttribute('r', '5.4');
      const star = document.createElementNS(SVGNS, 'path');
      star.setAttribute('class', 'star'); star.setAttribute('d', STAR_PATH);
      const lbl = document.createElementNS(SVGNS, 'text');
      lbl.setAttribute('class', 'lbl'); lbl.setAttribute('y', '7.6');
      lbl.textContent = p.lbl;
      const hit = document.createElementNS(SVGNS, 'circle');
      hit.setAttribute('class', 'hit'); hit.setAttribute('r', '7.5');
      n.appendChild(halo); n.appendChild(star); n.appendChild(lbl); n.appendChild(hit);
      gEl.appendChild(n);
      nodeEls[p.id] = n;
    }
    elSvg.appendChild(gEl);
    treeGroups[sk] = gEl;
  }

  // ---- tabs ------------------------------------------------------------------
  const tabEls = {};
  for (const sk of SKILL_IDS) {
    const t = document.createElement('div');
    t.className = 'ef-rpg-tab';
    t.innerHTML = '<div class="n">' + SKILL_META[sk].name + '</div>' +
      '<div class="l">Lv <b>1</b></div><div class="xp"><i></i></div>';
    t.addEventListener('click', () => { sfx(); selectSkill(sk); });
    elTabs.appendChild(t);
    tabEls[sk] = { root: t, lvl: t.querySelector('.l b'), xp: t.querySelector('.xp i') };
  }

  function sfx() { if (g.audio && g.audio.play) g.audio.play('uiClick'); }

  // ---- starfield canvas (drawn once per open/resize; deterministic) ----------
  function drawStars() {
    if (!elStars) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = elPanel.clientWidth || innerWidth;
    const h = elPanel.clientHeight || innerHeight;
    elStars.width = Math.floor(w * dpr);
    elStars.height = Math.floor(h * dpr);
    const ctx = elStars.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const rng = makeRng(WORLD_SEED + 77);
    const n = 210;
    for (let i = 0; i < n; i++) {
      const x = rng() * w, y = rng() * h;
      const r = 0.3 + rng() * 1.1;
      const warm = rng() < 0.22;
      const a = 0.15 + rng() * 0.65;
      ctx.beginPath();
      ctx.fillStyle = warm
        ? 'rgba(255,222,160,' + a.toFixed(2) + ')'
        : 'rgba(214,226,255,' + a.toFixed(2) + ')';
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
      if (r > 1.15) { // faint glow for the brightest few
        ctx.beginPath();
        ctx.fillStyle = warm ? 'rgba(255,222,160,0.08)' : 'rgba(214,226,255,0.08)';
        ctx.arc(x, y, r * 3.4, 0, 6.2832);
        ctx.fill();
      }
    }
  }
  window.addEventListener('resize', () => { if (treeOpen) drawStars(); });

  // ---- UI refresh helpers ------------------------------------------------------
  function uiOnPointsChanged() {
    if (elBdg) elBdg.textContent = String(state.points);
    if (elBtn) elBtn.classList.toggle('pts', state.points > 0);
    if (elPts) elPts.textContent = String(state.points);
    if (treeOpen) refreshTree();
  }
  function btnFlash() {
    if (!elBtn) return;
    elBtn.classList.remove('flash');
    // force reflow so the animation can retrigger
    void elBtn.offsetWidth;
    elBtn.classList.add('flash');
  }
  function uiOnSkillChanged(id) {
    if (!treeOpen) return;
    refreshTab(id);
    if (id === curSkill) { refreshTree(); refreshSub(); }
  }
  function refreshTab(sk) {
    const s = state.skills[sk];
    const t = tabEls[sk];
    if (!t) return;
    t.lvl.textContent = String(s.level);
    const frac = s.level >= MAX_LEVEL ? 1 : clamp(s.xp / xpNeeded(s.level), 0, 1);
    t.xp.style.transform = 'scaleX(' + frac.toFixed(3) + ')';
  }
  function refreshAllTabs() { for (const sk of SKILL_IDS) refreshTab(sk); }
  function refreshSub() {
    const s = state.skills[curSkill];
    elSub.textContent = SKILL_META[curSkill].flavor + ' — ' +
      SKILL_META[curSkill].name + ' ' + s.level;
  }

  function nodeState(p) {
    if (state.perks[p.id]) return 'owned';
    if (canUnlock(p)) return 'avail';
    return 'locked';
  }
  function refreshTree() {
    for (const p of TREES[curSkill]) {
      const el = nodeEls[p.id];
      const st = nodeState(p);
      el.classList.toggle('owned', st === 'owned');
      el.classList.toggle('avail', st === 'avail');
      el.classList.toggle('sel', selPerk === p);
    }
    for (const ln of lineEls[curSkill]) {
      const a = !!state.perks[ln.from], b = !!state.perks[ln.to];
      ln.el.classList.toggle('lit', a && b);
      ln.el.classList.toggle('half', a && !b);
    }
  }

  function selectSkill(sk) {
    if (!SKILL_META[sk]) return;
    if (curSkill !== sk) closeCard();
    curSkill = sk;
    for (const id of SKILL_IDS) {
      tabEls[id].root.classList.toggle('on', id === sk);
      treeGroups[id].classList.toggle('on', id === sk);
    }
    refreshSub();
    refreshTree();
  }

  // ---- detail card ---------------------------------------------------------------
  function openCard(perk) {
    selPerk = perk;
    elCardNm.textContent = perk.name;
    elCardDs.textContent = perk.desc;
    const owned = !!state.perks[perk.id];
    const lvlOk = state.skills[perk.skill].level >= perk.req;
    const preOk = !perk.pre || perk.pre.some((id) => state.perks[id]);
    // requirement line
    if (owned) {
      elCardRq.textContent = 'Unlocked';
      elCardRq.className = 'rq ok';
    } else {
      let rq = perk.req > 0 ? SKILL_META[perk.skill].name + ' ' + perk.req : 'No skill requirement';
      if (perk.pre) {
        const names = [];
        for (const id of perk.pre) names.push(PERK_BY_ID[id].name);
        rq += ' · Requires ' + names.join(' or ');
      }
      elCardRq.textContent = rq;
      elCardRq.className = 'rq' + (lvlOk && preOk ? ' ok' : ' bad');
    }
    // button
    elUnlock.classList.remove('holding', 'owned');
    if (owned) {
      elUnlock.classList.add('owned');
      elUnlock.disabled = false;
      elUnlockTxt.textContent = '✦ Unlocked';
    } else if (canUnlock(perk)) {
      elUnlock.disabled = false;
      elUnlockTxt.textContent = 'Hold to Unlock — ✦ 1';
    } else {
      elUnlock.disabled = true;
      elUnlockTxt.textContent = state.points <= 0 && lvlOk && preOk ? 'No perk points' : 'Locked';
    }
    elCard.classList.add('on');
    elCard.parentElement.classList.add('carded'); // shift constellation up
    refreshTree();
  }
  function closeCard() {
    selPerk = null;
    cancelHold();
    elCard.classList.remove('on');
    elCard.parentElement.classList.remove('carded');
    refreshTree();
  }

  // node tap (event delegation on the svg)
  elSvg.addEventListener('click', (e) => {
    const n = e.target && e.target.closest ? e.target.closest('g[data-id]') : null;
    if (!n) { closeCard(); return; }
    const perk = PERK_BY_ID[n.getAttribute('data-id')];
    if (perk) { sfx(); openCard(perk); }
  });

  // ---- hold-to-unlock --------------------------------------------------------------
  function cancelHold() {
    holding = false;
    elUnlock.classList.remove('holding');
  }
  function finishUnlock() {
    cancelHold();
    if (!selPerk || !unlock(selPerk)) return;
    const n = nodeEls[selPerk.id];
    n.classList.add('burst');
    setTimeout(() => n.classList.remove('burst'), 850);
    openCard(selPerk); // refresh card into "Unlocked" state
    refreshAllTabs();
  }
  elUnlock.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!selPerk || state.perks[selPerk.id] || !canUnlock(selPerk)) return;
    try { elUnlock.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    holding = true;
    holdStart = performance.now();
    elUnlock.classList.add('holding');
    sfx();
  });
  elUnlock.addEventListener('pointerup', cancelHold);
  elUnlock.addEventListener('pointercancel', cancelHold);
  elUnlock.addEventListener('lostpointercapture', cancelHold);

  // ---- open / close ------------------------------------------------------------------
  function openTree() {
    if (treeOpen) return;
    // never open on top of another modal (dialogue / pause / journal / book)
    // or the death screen
    if (g.paused) return;
    if (g.player && g.player.stats && g.player.stats.hp <= 0) return;
    treeOpen = true;
    wasPausedByUs = true;
    g.paused = true;
    if (hud) hud.classList.add('ef-rpg-open');
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (_) { /* ok */ } }
    drawStars();
    refreshAllTabs();
    uiOnPointsChanged();
    selectSkill(curSkill);
    closeCard();
    elPanel.classList.add('on');
    sfx();
  }
  function closeTree() {
    if (!treeOpen) return;
    treeOpen = false;
    cancelHold();
    elPanel.classList.remove('on');
    if (hud) hud.classList.remove('ef-rpg-open');
    if (wasPausedByUs) { g.paused = false; wasPausedByUs = false; }
    sfx();
  }

  if (elBtn) {
    // open on pointerdown — snappy on touch, and immune to suppressed clicks
    elBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTree();
    });
  }
  $('ef-rpg-x').addEventListener('click', closeTree);

  // Esc / K handling — capture phase so ui.js's Esc (pause menu) doesn't also fire
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyK' && !e.repeat) {
      if (treeOpen) { closeTree(); e.stopPropagation(); }
      else if (!g.paused) { openTree(); e.stopPropagation(); }
    } else if (e.code === 'Escape' && treeOpen) {
      closeTree();
      e.stopPropagation();
    }
  }, true);

  // initial button state
  uiOnPointsChanged();

  // --------------------------------------------------------------------------
  // update(dt)
  // --------------------------------------------------------------------------
  function update(dt) {
    if (treeOpen) {
      g.paused = true; // re-assert: ui.refreshModal() may have cleared it
      if (holding && performance.now() - holdStart >= HOLD_MS) finishUnlock();
      return;
    }
    if (g.paused) return;

    const pl = g.player;
    if (pl) {
      // per-frame cheap accumulators (no allocation)
      const vx = pl.velocity.x, vz = pl.velocity.z;
      const hSpeed2 = vx * vx + vz * vz;
      // athletics: sprinting seconds (fast + grounded + not swimming)
      if (pl.onGround && !pl.inWater && hSpeed2 > 38) sprintBuf += dt;
      // athletics: jumps landed (airborne > 0.3s)
      if (!pl.onGround) airT += dt;
      else {
        if (!prevOnGround && airT > 0.3) jumpBuf += XP.jumpLand;
        airT = 0;
      }
      prevOnGround = pl.onGround;
      // shadow: sneaking + moving near a living non-aggroed enemy
      if (pl.sneaking && hSpeed2 > 0.2 && nearStealthTarget) sneakBuf += dt;
    }

    pollT += dt;
    if (pollT >= 0.12) { pollGameplay(pollT); pollT = 0; }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------
  const api = {
    update,
    addSkillXP,
    mult,
    has,
    skills: state.skills,
    serialize,
    deserialize,
    openTree,
    closeTree,
  };
  Object.defineProperty(api, 'points', {
    get() { return state.points; },
    set(v) {
      if (typeof v === 'number' && isFinite(v)) {
        state.points = Math.max(0, Math.round(v));
        uiOnPointsChanged();
      }
    },
    enumerable: true,
  });
  return api;
}

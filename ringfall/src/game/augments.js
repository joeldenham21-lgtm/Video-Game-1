// Roguelite augments: stat mods + event hooks. Offered as 1-of-3 after each floor.
import * as THREE from 'three';
import { G } from '../state.js';
import { rand, shuffle, chance, pick } from '../util.js';

export const RARITY = {
  common: { label: 'COMMON', color: '#9fd8ff', weight: 1 },
  rare: { label: 'RARE', color: '#c6a0ff', weight: 1 },
  legendary: { label: 'LEGENDARY', color: '#ffd257', weight: 1 },
};

// icon keys map to small SVGs in the UI
export const AUGMENTS = [
  { id: 'hvRounds', name: 'High-Velocity Rounds', rarity: 'common', icon: 'bullet', max: 3, desc: '+15% weapon damage.', apply: m => { m.damage *= 1.15; } },
  { id: 'hairTrigger', name: 'Hair Trigger', rarity: 'common', icon: 'rate', max: 3, desc: '+12% fire rate.', apply: m => { m.fireRate *= 1.12; } },
  { id: 'deepMags', name: 'Deep Magazines', rarity: 'common', icon: 'mag', max: 2, desc: '+35% magazine size. Reload 15% faster.', apply: m => { m.magSize *= 1.35; m.reloadTime *= 0.85; } },
  { id: 'coreLens', name: 'Core Lens', rarity: 'common', icon: 'crit', max: 2, desc: 'Core hits deal +40% damage.', apply: m => { m.critDamage *= 1.4; } },
  { id: 'frame', name: 'Reinforced Frame', rarity: 'common', icon: 'hp', max: 3, desc: '+25 max health. Repairs 25 now.', apply: (m, p) => { p.maxHp += 25; p.heal(25); } },
  { id: 'capacitor', name: 'Capacitor Shield', rarity: 'common', icon: 'shield', max: 2, desc: '+25 max shield. Shield recharges 25% faster.', apply: (m, p) => { p.maxShield += 25; p.shield = p.maxShield; p.shieldRegenRate *= 1.25; } },
  { id: 'servo', name: 'Servo Legs', rarity: 'common', icon: 'speed', max: 2, desc: '+8% move speed. Dashes recharge 20% faster.', apply: m => { m.moveSpeed *= 1.08; m.dashRecharge *= 1.2; } },
  { id: 'magnetCoil', name: 'Magnet Coil', rarity: 'common', icon: 'magnet', max: 1, desc: 'Pickups fly to you from 80% farther. Repair orbs heal 30% more.', apply: m => { m.magnet *= 1.8; m.healMul *= 1.3; } },
  { id: 'heavyKnuckles', name: 'Heavy Knuckles', rarity: 'common', icon: 'fist', max: 1, desc: 'Melee deals 80% more damage, reaches 25% farther and recovers faster.', apply: m => { m.meleeDamage *= 1.8; m.meleeRange *= 1.25; m.meleeCool *= 0.7; m.lungeRange *= 1.3; } },
  { id: 'overclock', name: 'Overclock', rarity: 'common', icon: 'od', max: 2, desc: 'Overdrive charges 35% faster.', apply: m => { m.odGain *= 1.35; } },

  { id: 'thruster', name: 'Tertiary Thruster', rarity: 'rare', icon: 'dash', max: 1, desc: '+1 dash charge.', apply: (m, p) => { p.maxDash += 1; p.dashCharges = p.maxDash; } },
  { id: 'gravBoots', name: 'Grav Boots', rarity: 'rare', icon: 'jump', max: 1, desc: '+1 mid-air jump.', apply: (m, p) => { p.maxAirJumps += 1; } },
  { id: 'chainArc', name: 'Chain Arc', rarity: 'rare', icon: 'arc', max: 2, desc: 'Kills arc lightning into 2 nearby enemies for 35 damage.', apply: m => { m.chainArc += 2; } },
  { id: 'volatile', name: 'Volatile Cores', rarity: 'rare', icon: 'boom', max: 1, desc: 'Destroyed constructs explode, damaging everything nearby.', apply: m => { m.volatile = true; } },
  { id: 'siphon', name: 'Siphon', rarity: 'rare', icon: 'leech', max: 2, desc: 'Heal for 3% of all damage you deal.', apply: m => { m.lifesteal += 0.03; } },
  { id: 'harvester', name: 'Harvester', rarity: 'rare', icon: 'harvest', max: 1, desc: 'Shatters drop 2 extra repair orbs and refund a dash.', apply: m => { m.shatterOrbs += 2; m.harvester = true; } },
  { id: 'mirror', name: 'Mirror Palm', rarity: 'rare', icon: 'mirror', max: 1, desc: 'Punched-back projectiles deal double damage and explode.', apply: m => { m.deflectDamage *= 2; m.deflectExplode = true; } },
  { id: 'skyborne', name: 'Skyborne', rarity: 'rare', icon: 'wing', max: 1, desc: '+30% damage while airborne.', apply: m => { m.airDamage = 1.3; } },
  { id: 'bladeDash', name: 'Blade Dash', rarity: 'rare', icon: 'blade', max: 1, desc: 'Dashing through enemies slices them for 70 damage.', apply: m => { m.dashStrike = 70; } },
  { id: 'longOD', name: 'Extended Overdrive', rarity: 'rare', icon: 'clock', max: 2, desc: 'Overdrive lasts 3 seconds longer.', apply: m => { m.odDuration += 3; } },
  { id: 'kinetic', name: 'Kinetic Plating', rarity: 'rare', icon: 'wave', max: 1, desc: 'Taking hull damage releases a shockwave that hurls enemies away.', apply: m => { m.kinetic = true; } },

  { id: 'lastStand', name: 'Last Stand', rarity: 'legendary', icon: 'fury', max: 1, desc: 'Below 40% health: +50% damage and fire rate.', apply: m => { m.lastStand = true; } },
  { id: 'secondWind', name: 'Second Wind', rarity: 'legendary', icon: 'heart', max: 1, desc: 'Once per floor, lethal damage leaves you at 1 health, invulnerable for 2s.', apply: m => { m.secondWind = true; } },
  { id: 'storm', name: 'Storm Crown', rarity: 'legendary', icon: 'storm', max: 1, desc: 'Every 7th hit calls down lightning: 90 damage that chains.', apply: m => { m.storm = true; } },
  { id: 'chrono', name: 'Chrono Dash', rarity: 'legendary', icon: 'chrono', max: 1, desc: 'Dashing bends time: 1s of slow motion (6s cooldown).', apply: m => { m.chrono = true; } },
  { id: 'singularity', name: 'Singularity Shells', rarity: 'legendary', icon: 'sing', max: 1, desc: 'Nova blasts are 25% larger and drag enemies into the core.', apply: m => { m.singularity = true; m.blastRadius *= 1.25; } },
  { id: 'phoenix', name: 'Phoenix Protocol', rarity: 'legendary', icon: 'phoenix', max: 1, desc: 'Once per run, rise from destruction with full health.', apply: m => { m.phoenix = 1; } },
];

function baseMods() {
  return {
    damage: 1, fireRate: 1, magSize: 1, reloadTime: 1, critDamage: 1, moveSpeed: 1, dmgTaken: 1, dashRecharge: 1,
    odGain: 1, odDuration: 0, meleeDamage: 1, meleeRange: 1, meleeCool: 1, lungeRange: 1, deflectDamage: 1, deflectExplode: false,
    shatterOrbs: 0, healMul: 1, magnet: 1, blastRadius: 1, singularity: false, chainArc: 0, volatile: false, lifesteal: 0,
    harvester: false, airDamage: 1, dashStrike: 0, kinetic: false, lastStand: false, secondWind: false, storm: false, chrono: false, phoenix: 0,
  };
}

export function createAugments() {
  const A = {
    mods: baseMods(),
    owned: {},        // id -> stacks
    list: [],         // in pick order
    hitCounter: 0, kineticCool: 0, chronoCool: 0, secondWindUsed: false, lifestealAcc: 0,

    reset() {
      A.mods = baseMods();
      A.owned = {}; A.list = [];
      A.hitCounter = 0; A.kineticCool = 0; A.chronoCool = 0; A.secondWindUsed = false;
    },
    floorStart() { A.secondWindUsed = false; },
    has(id) { return !!A.owned[id]; },
    take(id) {
      const def = AUGMENTS.find(a => a.id === id);
      if (!def) return;
      A.owned[id] = (A.owned[id] || 0) + 1;
      A.list.push(id);
      def.apply(A.mods, G.player);
      G.audio?.play('augmentPick');
      G.audio?.music.stinger('augment');
    },
    // re-apply after a checkpoint restore
    restore(ids) {
      A.reset();
      for (const id of ids) A.take(id);
    },

    // Offer 3 distinct augments; after bosses bias toward legendaries
    offer(kind = 'normal') {
      const pool = AUGMENTS.filter(a => (A.owned[a.id] || 0) < a.max);
      const byR = (r) => shuffle(pool.filter(a => a.rarity === r));
      const picks = [];
      const want = kind === 'boss' ? ['legendary', 'legendary', 'rare'] : [chance(0.07) ? 'legendary' : 'rare', 'common', chance(0.35) ? 'rare' : 'common'];
      for (const r of want) {
        const cands = byR(r).filter(a => !picks.includes(a));
        const alt = shuffle(pool.filter(a => !picks.includes(a)));
        const p = cands[0] || alt[0];
        if (p) picks.push(p);
      }
      return shuffle(picks);
    },

    situationalDamage() {
      let m = 1;
      if (A.mods.airDamage > 1 && !G.player.grounded) m *= A.mods.airDamage;
      if (A.mods.lastStand && G.player.hp / G.player.maxHp < 0.4) m *= 1.5;
      return m;
    },
    fireRateBonus() { return A.mods.lastStand && G.player.hp / G.player.maxHp < 0.4 ? 1.5 : 1; },

    onHit(e, dealt, info) {
      if (A.mods.lifesteal > 0 && dealt > 0) {
        A.lifestealAcc += dealt * A.mods.lifesteal;
        if (A.lifestealAcc >= 1) { const h = Math.floor(A.lifestealAcc); A.lifestealAcc -= h; G.player.heal(h); }
      }
      if (A.mods.storm && dealt > 0 && info.source !== 'storm' && info.source !== 'arc') {
        A.hitCounter++;
        if (A.hitCounter >= 7) { A.hitCounter = 0; lightning(e); }
      }
    },

    tryCheatDeath() {
      if (A.mods.secondWind && !A.secondWindUsed) {
        A.secondWindUsed = true;
        G.hud?.announce('SECOND WIND', 'Frame integrity restored', 'gold');
        G.audio?.play('shieldRegen');
        G.slowmo = 0.8;
        return true;
      }
      if (A.mods.phoenix > 0) {
        A.mods.phoenix--;
        G.player.hp = G.player.maxHp; G.player.shield = G.player.maxShield;
        G.hud?.announce('PHOENIX PROTOCOL', 'Rebuilt from ash', 'gold');
        G.enemies.damageRadius(G.player.pos, 10, 200, 'phoenix', 20);
        G.particles?.explosion(G.player.pos, 6, 0xffb040, true);
        G.slowmo = 1.2;
        return true;
      }
      if (G.run?.revives > 0) {
        G.run.revives--;
        G.player.hp = Math.round(G.player.maxHp * 0.5);
        G.player.shield = G.player.maxShield;
        G.hud?.announce('BACKUP FRAME', G.run.revives ? `${G.run.revives} left this sector` : 'Last one this sector', 'gold');
        G.enemies.damageRadius(G.player.pos, 7, 80, 'phoenix', 18);
        G.particles?.ring({ x: G.player.pos.x, y: G.player.pos.y + 0.4, z: G.player.pos.z }, 7, 0xffd257, 40, 0.35, 3);
        G.slowmo = 0.8;
        return true;
      }
      return false;
    },

    update(dt) {
      if (A.kineticCool > 0) A.kineticCool -= dt;
      if (A.chronoCool > 0) A.chronoCool -= dt;
      // blade dash: slice through enemies during the dash
      if (A.mods.dashStrike && G.player.dashTimer > 0) {
        for (const e of G.enemies.list) {
          if (!e.alive || e.warp > 0 || e._dashHit === G.player._dashId) continue;
          if (e.pos.distanceTo(G.player.pos) < e.radius + 1.3 || e.aimPoint.distanceTo(G.player.eyePos) < e.radius + 1.2) {
            e._dashHit = G.player._dashId;
            const res = e.damage(A.mods.dashStrike * A.mods.damage, { part: 'body', x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z, dir: G.player.dashDir, source: 'dash', knock: 6 });
            G.enemies.reportHit(e, { dmg: res.dealt, crit: false, killed: res.killed, x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z });
            G.particles?.sparks(e.aimPoint, { x: 0, y: 1, z: 0 }, 0x9fe8ff, 12, 10, 3);
          }
        }
      }
    },
  };

  function arc(from, target, dmg) {
    G.beams?.add(from.x, from.y, from.z, target.aimPoint.x, target.aimPoint.y, target.aimPoint.z, 0x9fe8ff, 4, 0.05, 0.25, 'fade', 0.4);
    const res = target.damage(dmg, { part: 'body', x: target.aimPoint.x, y: target.aimPoint.y, z: target.aimPoint.z, dir: null, source: 'arc' });
    G.enemies.reportHit(target, { dmg: res.dealt, crit: false, killed: res.killed, x: target.aimPoint.x, y: target.aimPoint.y, z: target.aimPoint.z });
  }

  function nearest(pos, n, range, exclude) {
    return G.enemies.list.filter(e => e.alive && e.warp <= 0 && e !== exclude && e.pos.distanceTo(pos) < range)
      .sort((a, b) => a.pos.distanceTo(pos) - b.pos.distanceTo(pos)).slice(0, n);
  }

  function lightning(e) {
    const p = e.aimPoint;
    G.beams?.add(p.x + rand(-2, 2), p.y + 18, p.z + rand(-2, 2), p.x, p.y, p.z, 0xd8ecff, 6, 0.12, 0.3, 'fade', 0.8);
    G.lights?.flash(p, 0xd8ecff, 40, 16, 0.2);
    G.audio?.play('lanceShot', { pos: p, volume: 0.7 });
    const res = e.damage(90 * A.mods.damage, { part: 'body', x: p.x, y: p.y, z: p.z, dir: null, source: 'storm' });
    G.enemies.reportHit(e, { dmg: res.dealt, crit: false, killed: res.killed, x: p.x, y: p.y, z: p.z });
    for (const t of nearest(p, 2, 9, e)) arc(p, t, 40 * A.mods.damage);
  }

  // singularity: pull enemies toward the blast center
  A.singularity = (pos, radius) => {
    for (const e of G.enemies.list) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius * 2.2 && d > 0.5) {
        const k = (1 - d / (radius * 2.2)) * 18 / e.def.mass;
        e.vel.x += (pos.x - e.pos.x) / d * k; e.vel.y += (pos.y + 1 - e.pos.y) / d * k * 0.5; e.vel.z += (pos.z - e.pos.z) / d * k;
      }
    }
    G.particles?.ring(pos, -radius * 1.5, 0xc6a0ff, 30, 0.35, 3);
  };

  G.events.on('enemyKilled', (ctx) => {
    const m = A.mods;
    const p = ctx.pos;
    if (m.chainArc > 0 && ctx.source !== 'arc') for (const t of nearest(p, m.chainArc, 10, ctx.enemy)) arc(p, t, 35 * m.damage);
    if (m.volatile && ctx.source !== 'volatile') {
      setTimeout(() => {
        if (G.mode !== 'playing') return;
        G.particles?.explosion(p, 3, 0xff8a3a);
        G.audio?.play('miteExplode', { pos: p });
        const r = ctx.enemy.type === 'brute' ? 6 : 3.8;
        for (const e of G.enemies.list) {
          if (!e.alive || e.warp > 0) continue;
          if (e.pos.distanceTo(p) < r + e.radius) {
            const res = e.damage(40 * m.damage, { part: 'body', x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z, dir: null, source: 'volatile', knock: 6 });
            G.enemies.reportHit(e, { dmg: res.dealt, crit: false, killed: res.killed, x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z });
          }
        }
      }, 90);
    }
    if (m.harvester && ctx.shatter) G.player.dashCharges = Math.min(G.player.maxDash, G.player.dashCharges + 1);
  });
  G.events.on('dash', () => {
    G.player._dashId = (G.player._dashId || 0) + 1;
    if (A.mods.chrono && A.chronoCool <= 0) { A.chronoCool = 6; G.slowmo = Math.max(G.slowmo, 1.0); G.audio?.play('overdriveStart', { volume: 0.4 }); }
  });
  G.events.on('playerDamaged', ({ toHp }) => {
    if (A.mods.kinetic && toHp > 0 && A.kineticCool <= 0) {
      A.kineticCool = 4;
      const pos = G.player.pos;
      G.particles?.ring({ x: pos.x, y: pos.y + 0.5, z: pos.z }, 7, 0x9fe8ff, 40, 0.3, 3);
      G.audio?.play('shockwave', { volume: 0.8 });
      for (const e of G.enemies.list) {
        if (!e.alive) continue;
        const d = e.pos.distanceTo(pos);
        if (d < 8) {
          const dir = new THREE.Vector3().subVectors(e.pos, pos).normalize();
          e.damage(30, { part: 'body', x: e.aimPoint.x, y: e.aimPoint.y, z: e.aimPoint.z, dir, source: 'kinetic', knock: 26 });
        }
      }
    }
  });
  return A;
}

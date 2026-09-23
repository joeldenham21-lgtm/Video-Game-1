// Run director: floors, waves, spawning, pacing, rewards, checkpoints, victory/defeat flow.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, rand, pick, chance, shuffle, damp } from '../util.js';
import { loadStage } from '../world/stage.js';
import { TYPES } from './enemies.js';
import { saveMeta } from './settings.js';

const W = (...groups) => ({ groups });
export const FLOORS = [
  { layout: 'aperture', title: 'APERTURE DECK', sector: 1, story: 'intro', waves: [
    W(['mite', 4]),
    W(['mite', 4], ['sentinel', 1]),
    W(['sentinel', 2], ['mite', 5]),
  ] },
  { layout: 'spindle', title: 'SPINDLE ARRAY', sector: 1, reward: 'lance', waves: [
    W(['sentinel', 2], ['mite', 5]),
    W(['lancer', 1], ['sentinel', 2]),
    W(['lancer', 2], ['mite', 6], ['sentinel', 1]),
  ] },
  { layout: 'aperture', title: 'APERTURE DECK — DEEP', sector: 1, waves: [
    W(['mite', 6], ['sentinel', 1]),
    W(['brute', 1], ['mite', 3]),
    W(['sentinel', 3], ['lancer', 1]),
    W(['brute', 1], ['sentinel', 2], ['lancer', 1], ['mite', 4]),
  ] },
  { layout: 'spindle', title: 'SPINDLE CROWN', sector: 1, elites: 0.12, waves: [
    W(['sentinel', 3], ['mite', 6]),
    W(['lancer', 2], ['brute', 1]),
    W(['brute', 2], ['mite', 8]),
    W(['sentinel', 3], ['lancer', 2], ['brute', 1]),
  ] },
  { layout: 'crucible', title: 'THE CRUCIBLE', sector: 1, boss: 'conductor', reward: 'nova' },
  { layout: 'shards', title: 'SHATTERED CONCOURSE', sector: 2, story: 'sector2', elites: 0.15, waves: [
    W(['sentinel', 3], ['mite', 6]),
    W(['warden', 1], ['sentinel', 3]),
    W(['warden', 1], ['brute', 1], ['lancer', 2]),
    W(['mite', 10], ['sentinel', 2], ['lancer', 1]),
  ] },
  { layout: 'nave', title: 'CHOIR NAVE', sector: 2, elites: 0.2, waves: [
    W(['brute', 1], ['sentinel', 3], ['mite', 5]),
    W(['lancer', 3], ['warden', 1]),
    W(['brute', 2], ['warden', 1], ['mite', 6]),
    W(['sentinel', 4], ['lancer', 2], ['warden', 1]),
  ] },
  { layout: 'shards', title: 'CONCOURSE — BREACH', sector: 2, elites: 0.25, waves: [
    W(['mite', 12], ['sentinel', 2]),
    W(['brute', 2], ['lancer', 2]),
    W(['warden', 2], ['sentinel', 4], ['mite', 4]),
    W(['brute', 2], ['warden', 1], ['lancer', 3]),
  ] },
  { layout: 'nave', title: 'NAVE OF ECHOES', sector: 2, elites: 0.32, waves: [
    W(['sentinel', 4], ['mite', 8], ['warden', 1]),
    W(['brute', 3], ['lancer', 2]),
    W(['lancer', 4], ['warden', 2], ['mite', 6]),
    W(['brute', 2], ['sentinel', 4], ['lancer', 2], ['warden', 1]),
  ] },
  { layout: 'sanctum', title: 'HEART OF THE CHOIR', sector: 2, boss: 'heart' },
];

const DIFF = {
  recruit: { hp: 0.72, count: 0.85, revives: 1 },
  veteran: { hp: 1.0, count: 1.0, revives: 0 },
  nightmare: { hp: 1.3, count: 1.3, revives: 0 },
};

function endlessFloor(n) {
  const layouts = ['aperture', 'spindle', 'shards', 'nave'];
  const level = n - FLOORS.length; // 1, 2, ...
  if (level % 5 === 0) return { layout: level % 10 === 0 ? 'sanctum' : 'crucible', title: 'ECHO OF THE ' + (level % 10 === 0 ? 'HEART' : 'CONDUCTOR'), sector: 3, boss: level % 10 === 0 ? 'heart' : 'conductor' };
  const types = ['mite', 'sentinel', 'lancer', 'brute', 'warden'];
  const waves = [];
  const budget = 14 + level * 3;
  for (let w = 0; w < 4; w++) {
    let b = budget * (0.7 + w * 0.15);
    const groups = [];
    while (b > 0) {
      const t = pick(types);
      const c = t === 'mite' ? 4 : t === 'brute' ? 1 : 2;
      groups.push([t, c]);
      b -= TYPES[t].threat * c;
    }
    waves.push({ groups });
  }
  return { layout: pick(layouts), title: `ENDLESS · DEPTH ${level}`, sector: 3, elites: Math.min(0.6, 0.3 + level * 0.03), waves };
}

export function createDirector() {
  const queue = [];
  const D = {
    state: 'idle', waveIdx: 0, waveT: 0, stateT: 0, plan: null, waveTotal: 0, waveKilled: 0,

    hpMul() {
      const r = G.run;
      if (!r) return 1;
      return DIFF[r.difficulty].hp * (1 + 0.075 * (r.floor - 1)) * (r.floor > FLOORS.length ? 1.25 : 1);
    },
    dmgMul() {
      const r = G.run;
      if (!r) return 1;
      return 1 + 0.045 * (r.floor - 1);
    },

    startRun(difficulty = 'veteran', opts = {}) {
      G.run = {
        difficulty, floor: 1, time: 0, kills: 0, shatters: 0, damageTaken: 0, revives: DIFF[difficulty].revives,
        seen: new Set(), startedAt: Date.now(), endless: false, bossTimes: [], fromCheckpoint: !!opts.checkpoint,
      };
      G.meta.runs++;
      saveMeta();
      G.player.fullReset();
      G.weapons.reset();
      G.augments.reset();
      G.style.reset();
      G.story.reset();
      if (opts.checkpoint) {
        // true = the saved Garden checkpoint; an object = an explicit snapshot (e.g. restored after an update)
        const cp = opts.checkpoint === true ? G.meta.checkpoint : opts.checkpoint;
        G.run.floor = cp.floor;
        for (const w of cp.weapons) if (!G.weapons.owned.includes(w)) G.weapons.owned.push(w);
        G.augments.restore(cp.augments);
        G.style.score = cp.score || 0;
        G.run.seen = new Set(cp.seen || []);
        if (opts.checkpoint === true) G.story.say('checkpoint');
      }
      D.startFloor(G.run.floor);
    },

    get floorDef() { const f = G.run.floor; return f <= FLOORS.length ? FLOORS[f - 1] : endlessFloor(f); },

    startFloor(n) {
      G.run.floor = n;
      const def = D.floorDef;
      D.plan = def;
      queue.length = 0;
      G.enemies.clear(); G.projectiles.clear(); G.pickups.clear(); G.particles.clear(); G.fx.clear();
      G.boss?.clear();
      loadStage(def.layout);
      G.player.reset(G.arena.start);
      G.player.shield = G.player.maxShield;
      G.augments.floorStart();
      if (def.sector === 2 && FLOORS[n - 2]?.sector === 1) G.run.revives = DIFF[G.run.difficulty].revives;
      D.waveIdx = -1; D.stateT = 0;
      D.state = 'intro';
      G.mode = 'playing';
      G.input.setEnabled(true);
      G.renderer.post.uFade.value = 1;
      G.renderer.post.uFadeColor.value.set(0xffffff);
      G.hud?.floorCard(n, def);
      G.audio?.music.play(def.boss ? 'boss' : n >= FLOORS.length ? 'final' : 'combat');
      G.audio?.music.setIntensity(0.15);
      if (def.story) G.story.say(def.story, { delay: 1.2 });
      if (D.pendingTip) {
        const tip = D.pendingTip;
        D.pendingTip = null;
        setTimeout(() => { if (G.mode === 'playing') G.hud?.tipOnce(tip, 7); }, 4000);
      }
      G.events.emit('floorStart', n);
    },

    update(dt) {
      if (!G.run || G.mode !== 'playing') return;
      G.run.time += dt;
      D.stateT += dt;
      // spawn queue
      for (let i = queue.length - 1; i >= 0; i--) {
        queue[i].t -= dt;
        if (queue[i].t <= 0) { const q = queue.splice(i, 1)[0]; spawnOne(q.type, q.elite); }
      }
      const alive = G.enemies.alive;
      if (D.state === 'intro') {
        if (D.stateT > (G.run.floor === 1 && !G.run.fromCheckpoint ? 3.2 : 2.2)) {
          if (D.plan.boss) {
            D.state = 'boss';
            G.boss.start(D.plan.boss);
          } else nextWave();
        }
      } else if (D.state === 'waves') {
        D.waveT += dt;
        const last = D.waveIdx >= D.plan.waves.length - 1;
        const thresh = last ? 0 : Math.max(1, Math.floor(D.waveTotal * 0.2));
        if (queue.length === 0 && D.waveT > 3 && alive <= thresh) {
          if (last) floorCleared();
          else { D.state = 'break'; D.stateT = 0; }
        }
        G.audio?.music.setIntensity(clamp(0.35 + alive * 0.06 + D.waveIdx * 0.08 + (G.player.odActive > 0 ? 0.2 : 0), 0.35, 1));
      } else if (D.state === 'break') {
        if (D.stateT > 1.3) nextWave();
      } else if (D.state === 'boss') {
        G.audio?.music.setIntensity(clamp(0.6 + (1 - (G.boss.hpFrac ?? 1)) * 0.4, 0.6, 1));
      } else if (D.state === 'clear') {
        if (D.stateT > 2.8) { D.state = 'reward'; showRewards(); }
      }
    },

    bossDefeated() {
      G.run.bossTimes.push(G.run.time);
      floorCleared(true);
    },

    // continue after the final boss
    goEndless() {
      G.run.endless = true;
      G.meta.endless = true;
      saveMeta();
      D.startFloor(FLOORS.length + 1);
    },
  };

  function nextWave() {
    D.waveIdx++;
    D.waveT = 0; D.stateT = 0;
    D.state = 'waves';
    const wave = D.plan.waves[D.waveIdx];
    const diff = DIFF[G.run.difficulty];
    let delay = 0;
    let total = 0;
    G.style.waveDamage = 0;
    for (const [type, count] of wave.groups) {
      const n = Math.max(1, Math.round(count * diff.count));
      for (let i = 0; i < n; i++) {
        const elite = type !== 'mite' && chance(D.plan.elites || 0);
        queue.push({ type, elite, t: delay + i * 0.28 });
        total++;
      }
      delay += 1.1;
      if (!G.run.seen.has(type)) {
        G.run.seen.add(type);
        if (G.run.floor > 1 || type !== 'mite' || D.waveIdx > 0) G.hud?.newHostile(TYPES[type].name, type);
        G.story.say(type, { delay: 0.6 });
      }
    }
    D.waveTotal = total;
    G.hud?.waveBanner(D.waveIdx + 1, D.plan.waves.length);
    G.audio?.play('waveStart', { volume: 0.7 });
    G.audio?.music.stinger('waveStart');
    if (G.run.floor === 1 && D.waveIdx === 1) G.hud?.tipOnce('dash');
    if (G.run.floor === 1 && D.waveIdx === 2) G.hud?.tipOnce('pads');
  }

  function spawnPoint(type) {
    const sp = G.arena.spawns;
    const pl = G.player;
    const f = pl.forward(new THREE.Vector3());
    let pool;
    if (type === 'lancer') pool = sp.high;
    else if (type === 'brute') pool = sp.ground;
    else if (type === 'mite') pool = sp.air.concat(sp.high);
    else pool = sp.air.concat(sp.ground);
    let best = null, bs = -Infinity;
    for (let i = 0; i < 10; i++) {
      const p = pick(pool);
      const x = p[0] + rand(-1.8, 1.8), z = p[2] + rand(-1.8, 1.8);
      const dx = x - pl.pos.x, dz = z - pl.pos.z;
      const d = Math.hypot(dx, dz);
      let s = -Math.abs(d - 20) * 0.3;
      if (d < 9) s -= 40;
      const facing = (dx * f.x + dz * f.z) / (d || 1);
      s += facing * 4 + rand(0, 3);
      if (s > bs) { bs = s; best = [x, p[1], z]; }
    }
    const def = TYPES[type];
    let y = best[1];
    if (type === 'brute' || pool === sp.ground) {
      const g = G.world.groundHeight(best[0], best[2], 0.5, best[1] + 2);
      y = (g > -1e8 ? g : best[1]) + def.hover + (type === 'brute' ? 0 : 1.5);
    } else if (type !== 'lancer') y += rand(-0.5, 1.5);
    else y += 1.5;
    if (G.world.insideSolid(best[0], y, best[2])) y += 2;
    return best.length ? [best[0], y, best[2]] : [0, 4, 0];
  }

  function spawnOne(type, elite) {
    if (G.mode !== 'playing') return;
    const [x, y, z] = spawnPoint(type);
    G.enemies.spawn(type, x, y, z, { elite });
  }

  function floorCleared(boss = false) {
    D.state = 'clear'; D.stateT = 0;
    queue.length = 0;
    G.pickups.vacuum();
    G.slowmo = Math.max(G.slowmo, boss ? 1.4 : 0.6);
    G.player.heal(boss ? 60 : 25);
    G.player.shield = G.player.maxShield;
    G.hud?.announce(boss ? 'TARGET DESTROYED' : 'SECTOR CLEAR', `${G.player.kills} kills · ${Math.floor(G.run.time / 60)}:${String(Math.floor(G.run.time % 60)).padStart(2, '0')}`, 'clear');
    G.audio?.play('sectorClear');
    G.audio?.music.stinger(boss ? 'bossDefeated' : 'sectorClear');
    G.audio?.music.setIntensity(0.1);
    if (G.style.waveDamage === 0 && !boss) G.style.add(40, 'FLAWLESS WAVE', true);
    if (!boss) G.story.say('floorClear', { random: true, delay: 0.5 });
    G.meta.bestFloor = Math.max(G.meta.bestFloor, G.run.floor);
    saveMeta();
    G.events.emit('floorCleared', G.run.floor);
  }

  function showRewards() {
    const def = D.plan;
    const n = G.run.floor;
    // final boss → victory
    if (def.boss === 'heart' && n === FLOORS.length) {
      G.events.emit('victory');
      return;
    }
    let weapon = null;
    if (def.reward && !G.weapons.owned.includes(def.reward)) {
      weapon = def.reward;
      G.weapons.give(weapon);
      D.pendingTip = weapon;
      G.audio?.play('weaponUnlock');
      G.story.say(weapon === 'lance' ? 'lanceUnlock' : 'novaUnlock', { delay: 0.4 });
    }
    const choices = G.augments.offer(def.boss ? 'boss' : 'normal');
    G.mode = 'augment';
    G.input.setEnabled(false);
    G.input.exitLock();
    G.menus.showAugments(choices, { weapon, floor: n, boss: !!def.boss }, (id) => {
      if (id) G.augments.take(id);
      // checkpoint after the first boss
      if (def.boss === 'conductor' && n === 5) {
        G.meta.checkpoint = {
          floor: 6, difficulty: G.run.difficulty, weapons: G.weapons.owned.slice(), augments: G.augments.list.slice(),
          score: G.style.score, seen: [...G.run.seen],
        };
        saveMeta();
      }
      transition(() => D.startFloor(n + 1));
    });
  }

  function transition(then) {
    G.mode = 'transition';
    G.audio?.play('teleport');
    G.hud?.warpTransition();
    let t = 0;
    const post = G.renderer.post;
    post.uFadeColor.value.set(0xffffff);
    const step = () => {
      t += 1 / 60;
      post.uFade.value = Math.min(1, t / 0.7);
      post.uChroma.value = t * 2;
      if (t < 0.75) requestAnimationFrame(step);
      else then();
    };
    requestAnimationFrame(step);
  }

  G.events.on('enemyKilled', (ctx) => {
    if (!G.run) return;
    G.run.kills++;
    if (ctx.shatter) G.run.shatters++;
  });
  G.events.on('playerDamaged', ({ amount }) => { if (G.run) G.run.damageTaken += amount; });
  return D;
}

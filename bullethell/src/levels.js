// Seven worlds. Each level owns a palette, a music spec, dialogue, a stage
// mechanic (cover, mirrors, spores, glitch, gravity, time bubbles, rhythm),
// a scripted wave timeline and a boss.
import { TAU, PI, clamp, lerp, dist, dist2, angTo, rgba, RNG } from './math.js';
import * as P from './patterns.js';
import { BOSS_FACTORIES } from './bosses.js';

// ---------- timeline helpers ----------
function timeline() {
  const ev = [];
  const at = (t, fn) => ev.push({ t, fn });
  const wave = (t, n, gap, fn) => { for (let i = 0; i < n; i++) at(t + i * gap, (g) => fn(g, i, n)); };
  return { ev, at, wave };
}
// standard entrances
const enter = (x, y, hold = 4, dur = 1.6, exitX) => [{ x, y, dur, ease: 'outCubic' }, { hold }, { x: exitX ?? x, y: -80, dur: 1.8, ease: 'inCubic' }];
const sweep = (x0, y0, x1, y1, dur) => [{ x: x1, y: y1, dur, ease: 'linear' }];
const dive = (vx, vy) => [{ vx, vy, dur: 30 }];

// =====================================================================
export const LEVELS = [
  // -------------------------------------------------------------------
  { id: 'ember', num: 1, name: 'EMBER SHOALS', sub: 'the burnt orbit of a stolen world', tip: 'Drifting rock blocks bullets from both sides. Shatter it for gems, but beware the shards.',
    pal: { bg0: '#1a0806', bg1: '#4a1408', e: '#ff7a2a', e2: '#ffd9a8', b1: '#ff5a3c', b2: '#ffc65a', accent: '#ff8c42' },
    music: { bpm: 128, scale: 'phrygian', root: 45, drums: 'four', bass: 'drive', bassWave: 'sawtooth', arp: 'up', arpWave: 'square', leadWave: 'sawtooth', chords: [0, 5, 3, 4], seed: 11 },
    intro: [['ORACLE', 'Ember Shoals. This was a homeworld, before the Choir sang it into slag.'], ['PILOT', 'Then we start where it started.']],
    bossIntro: [['CINDER WARDEN', 'You are late, little spark. The fire has already won.'], ['PILOT', 'Fire goes out. That is the whole point of it.']],
    mechanic: () => new EmberMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      wave(1, 6, 0.35, (g, i) => g.spawnEnemy('dart', 80 + i * 20, -20, { seq: dive(0, 260) }));
      wave(1, 6, 0.35, (g, i) => g.spawnEnemy('dart', W - 80 - i * 20, -20, { seq: dive(0, 260) }));
      wave(5, 3, 0.9, (g, i) => g.spawnEnemy('drone', 120 + i * 150, -30, { seq: enter(120 + i * 150, 160 + (i % 2) * 40, 5) }));
      at(8, (g) => g.level.spawnAsteroid(g, W * 0.5, -40));
      wave(11, 8, 0.3, (g, i) => g.spawnEnemy('dart', -20, 80 + i * 25, { seq: dive(240, 120) }));
      at(15, (g) => { g.spawnEnemy('turret', W * 0.3, -30, { seq: enter(W * 0.3, 140, 7) }); g.spawnEnemy('turret', W * 0.7, -30, { seq: enter(W * 0.7, 140, 7) }); });
      at(17, (g) => g.level.spawnAsteroid(g, W * 0.2, -40)); at(19, (g) => g.level.spawnAsteroid(g, W * 0.8, -40));
      wave(22, 5, 0.6, (g, i) => g.spawnEnemy('spinner', 60 + i * 105, -30, { seq: [{ vy: 70, dur: 20 }] }));
      wave(28, 8, 0.3, (g, i) => g.spawnEnemy('dart', W + 20, 80 + i * 25, { seq: dive(-240, 120) }));
      at(32, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 150, 12, 2.5) }));
      wave(34, 4, 1.2, (g, i) => g.spawnEnemy('drone', i % 2 ? 90 : W - 90, -30, { seq: enter(i % 2 ? 90 : W - 90, 220, 4) }));
      at(40, (g) => { g.level.spawnAsteroid(g, W * 0.35, -40); g.level.spawnAsteroid(g, W * 0.65, -40); });
      wave(46, 10, 0.25, (g, i) => g.spawnEnemy('dart', W / 2 + Math.sin(i) * 150, -20, { seq: dive(Math.cos(i) * 60, 280) }));
      wave(50, 3, 1.0, (g, i) => g.spawnEnemy('turret', 100 + i * 170, -30, { seq: enter(100 + i * 170, 120 + i * 30, 6) }));
      at(56, (g) => g.level.spawnAsteroid(g, W * 0.5, -40));
      wave(58, 6, 0.5, (g, i) => g.spawnEnemy('mine', 60 + i * 84, -20, { seq: [{ vy: 90, dur: 20 }], onDeath: (e, g) => P.ring(g, e.x, e.y, { n: 8, spd: 120, r: 3.5, color: g.pal.b2 }) }));
      at(64, (g) => { g.spawnEnemy('carrier', W * 0.3, -50, { seq: enter(W * 0.3, 140, 10, 2.5) }); g.spawnEnemy('carrier', W * 0.7, -50, { seq: enter(W * 0.7, 140, 10, 2.5) }); });
      wave(68, 8, 0.4, (g, i) => g.spawnEnemy('spinner', i % 2 ? -20 : W + 20, 200 + i * 30, { seq: dive(i % 2 ? 120 : -120, 30) }));
      return ev;
    },
    bossAt: 80, boss: 0 },

  // -------------------------------------------------------------------
  { id: 'glass', num: 2, name: 'GLASS TIDE', sub: 'an ocean moon frozen mid-wave', tip: 'The ice walls throw bullets back. A needle that misses you once will try again from the other side.',
    pal: { bg0: '#03101f', bg1: '#0c3352', e: '#7be0ff', e2: '#e6fbff', b1: '#8ff0ff', b2: '#ffffff', accent: '#5fd0ff' },
    music: { bpm: 108, scale: 'dorian', root: 50, drums: 'half', bass: 'slow', bassWave: 'triangle', padWave: 'triangle', arp: 'wide', arpWave: 'triangle', arpSend: 0.5, leadWave: 'triangle', chords: [0, 3, 4, 2], seed: 22, sparse: 0.45 },
    intro: [['ORACLE', 'Theia-9. An ocean moon, frozen mid-wave when the Choir stopped its heart.'], ['PILOT', 'It is beautiful.'], ['ORACLE', 'It is a grave. Watch the walls. The ice throws everything back.']],
    bossIntro: [['LEVIATHAN CHOIR', 'I sang beneath the ice for a thousand years. Come. Hear the chorus.'], ['PILOT', 'I brought my own instrument.']],
    mechanic: () => new GlassMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      const needleFire = (e, g, dt) => { if (P.every(e, 'f', 1.5, dt)) P.fan(g, e.x, e.y, { n: 3, spread: 0.6, spd: 210, kind: 'needle', r: 3.5, bounces: 1 }); };
      wave(1, 5, 0.6, (g, i) => g.spawnEnemy('drone', 70 + i * 100, -30, { seq: enter(70 + i * 100, 150, 5), fire: needleFire }));
      wave(7, 8, 0.3, (g, i) => g.spawnEnemy('dart', -20, 60 + i * 20, { seq: dive(260, 100), fire: (e, g, dt) => { if (P.every(e, 'f', 1.2, dt)) P.single(g, e.x, e.y, { spd: 200, kind: 'needle', r: 3.5, bounces: 1 }); } }));
      at(12, (g) => g.level.spawnSerpent(g, W + 30, 120, 8, -1));
      wave(16, 4, 0.8, (g, i) => g.spawnEnemy('spinner', 90 + i * 120, -30, { seq: [{ vy: 60, dur: 20 }], fire: (e, g, dt) => { if (P.every(e, 'f', 0.14, dt)) { e.data.a = (e.data.a || 0) + 0.5; P.spiralStep(g, e.x, e.y, { arms: 2, ang: e.data.a, spd: 140, kind: 'needle', r: 3.5, bounces: 1 }); } } }));
      at(22, (g) => { g.spawnEnemy('turret', W * 0.25, -30, { seq: enter(W * 0.25, 130, 8), fire: (e, g, dt) => { if (P.every(e, 'f', 1.8, dt)) P.ring(g, e.x, e.y, { n: 12, spd: 120, kind: 'ring', r: 5, wave: 10, waveFreq: 4 }); } }); g.spawnEnemy('turret', W * 0.75, -30, { seq: enter(W * 0.75, 130, 8), fire: (e, g, dt) => { if (P.every(e, 'f', 1.8, dt)) P.ring(g, e.x, e.y, { n: 12, spd: 120, kind: 'ring', r: 5, wave: 10, waveFreq: 4 }); } }); });
      at(28, (g) => g.level.spawnSerpent(g, -30, 200, 10, 1));
      wave(33, 10, 0.25, (g, i) => g.spawnEnemy('dart', W / 2 + (i % 2 ? 1 : -1) * (40 + i * 20), -20, { seq: dive((i % 2 ? 1 : -1) * 40, 260) }));
      at(38, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 140, 12, 2.5), fire: (e, g, dt) => { if (P.every(e, 'f', 0.8, dt)) P.fan(g, e.x, e.y + 10, { n: 5, spread: 1.2, spd: 200, kind: 'needle', r: 3.5, bounces: 1 }); if (P.every(e, 's', 3, dt)) g.spawnEnemy('mine', e.x, e.y + 30, { seq: [{ vy: 100, dur: 20 }], onDeath: (m, g) => P.ring(g, m.x, m.y, { n: 6, spd: 130, kind: 'needle', r: 3.5, bounces: 1 }) }); } }));
      wave(44, 6, 0.5, (g, i) => g.spawnEnemy('mine', 50 + i * 90, -20, { seq: [{ vy: 80, dur: 20 }], onDeath: (m, g) => { P.ring(g, m.x, m.y, { n: 6, spd: 130, kind: 'shard', r: 3.5, bounces: 1 }); g.audio.sfx('shatter'); } }));
      at(50, (g) => { g.level.spawnSerpent(g, W + 30, 100, 9, -1); g.level.spawnSerpent(g, -30, 260, 9, 1); });
      wave(58, 4, 0.9, (g, i) => g.spawnEnemy('knight', 100 + i * 115, -30, { seq: enter(100 + i * 115, 180, 6), fire: needleFire }));
      wave(66, 12, 0.25, (g, i) => g.spawnEnemy('dart', i % 2 ? -20 : W + 20, 100 + i * 15, { seq: dive(i % 2 ? 250 : -250, 90) }));
      at(70, (g) => { g.spawnEnemy('carrier', W * 0.3, -50, { seq: enter(W * 0.3, 150, 10, 2.5) }); g.spawnEnemy('carrier', W * 0.7, -50, { seq: enter(W * 0.7, 150, 10, 2.5) }); });
      return ev;
    },
    bossAt: 84, boss: 1 },

  // -------------------------------------------------------------------
  { id: 'bloom', num: 3, name: 'THE BLOOM', sub: 'a garden world taught to hunt', tip: 'Spore clouds slow your hull. Seeds burst into rings when they ripen. Do not linger in the pollen.',
    pal: { bg0: '#061407', bg1: '#123d1a', e: '#c6ff8a', e2: '#ff5fb0', b1: '#ff6ec7', b2: '#b8ff7a', accent: '#ff5fb0' },
    music: { bpm: 122, scale: 'lydian', root: 48, drums: 'break', bass: 'walk', bassWave: 'square', arp: 'updown', arpWave: 'triangle', leadWave: 'square', chords: [0, 4, 5, 3], seed: 33 },
    intro: [['ORACLE', 'Vessary. A garden world. The Choir did not burn this one. It taught the flowers to hunt.'], ['PILOT', 'Pollen on the hull. Keep moving.']],
    bossIntro: [['MOTHER ROOT', 'Every seed I drop is a world you failed to save.'], ['PILOT', 'Then I will be quick about the weeding.']],
    mechanic: () => new BloomMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      wave(1, 4, 0.8, (g, i) => g.spawnEnemy('seedpod', 90 + i * 120, -30, { seq: [{ vy: 45, dur: 25 }] }));
      wave(5, 8, 0.3, (g, i) => g.spawnEnemy('dart', 60 + i * 60, -20, { seq: dive(0, 240), fire: null }));
      at(9, (g) => g.level.spawnSpore(g, W * 0.5, 450));
      wave(12, 3, 1, (g, i) => g.spawnEnemy('drone', 130 + i * 140, -30, { seq: enter(130 + i * 140, 170, 5), fire: (e, g, dt) => { if (P.every(e, 'f', 1.5, dt)) P.seed(g, e.x, e.y, { spd: 130, fuse: 1.2, r: 7, child: { n: 7, spd: 110 } }); } }));
      at(18, (g) => { g.level.spawnSpore(g, W * 0.25, 350); g.level.spawnSpore(g, W * 0.75, 600); });
      wave(20, 6, 0.5, (g, i) => g.spawnEnemy('spinner', -20, 120 + i * 40, { seq: dive(110, 20), fire: (e, g, dt) => { if (P.every(e, 'f', 0.4, dt)) P.fan(g, e.x, e.y, { n: 3, spread: 0.7, ang: PI / 2, spd: 110, wave: 16, waveFreq: 4, r: 3.5 }); } }));
      at(26, (g) => g.spawnEnemy('turret', W / 2, -30, { seq: enter(W / 2, 150, 9), fire: (e, g, dt) => { if (P.every(e, 'f', 2.0, dt)) { for (let i = 0; i < 4; i++) P.seed(g, e.x, e.y, { ang: PI / 2 + (i - 1.5) * 0.5, spd: 140, fuse: 1.4, r: 8, child: { n: 8, spd: 120, aim: true } }); } } }));
      wave(30, 5, 0.7, (g, i) => g.spawnEnemy('seedpod', W - 80 - i * 100, -30, { seq: [{ vy: 55, dur: 25 }] }));
      at(36, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 140, 12, 2.5), fire: (e, g, dt) => { if (P.every(e, 'f', 0.5, dt)) P.spray(g, e.x, e.y + 10, { n: 4, arc: 1.6, spd: 60, spd1: 150, r: 3.5, wave: 10, waveFreq: 5 }); if (P.every(e, 'p', 3.5, dt)) g.level.spawnSpore(g, e.x, e.y + 200); } }));
      wave(40, 10, 0.3, (g, i) => g.spawnEnemy('dart', W + 20, 60 + i * 22, { seq: dive(-240, 110) }));
      wave(46, 4, 0.9, (g, i) => g.spawnEnemy('knight', 90 + i * 120, -30, { seq: enter(90 + i * 120, 200, 6), fire: (e, g, dt) => { if (P.every(e, 'f', 1.3, dt)) P.fan(g, e.x, e.y, { n: 4, spread: 0.6, spd: 190, kind: 'knife', r: 4 }); } }));
      at(52, (g) => { for (let i = 0; i < 3; i++) g.level.spawnSpore(g, 90 + i * 180, 400 + (i % 2) * 200); });
      wave(54, 8, 0.4, (g, i) => g.spawnEnemy('seedpod', 60 + i * 60, -30, { seq: [{ vy: 70, dur: 25 }] }));
      at(60, (g) => { g.spawnEnemy('turret', W * 0.25, -30, { seq: enter(W * 0.25, 130, 8) }); g.spawnEnemy('turret', W * 0.75, -30, { seq: enter(W * 0.75, 130, 8) }); });
      wave(66, 12, 0.22, (g, i) => g.spawnEnemy('dart', W / 2 + Math.sin(i * 0.7) * 200, -20, { seq: dive(0, 300) }));
      at(70, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 160, 10, 2.5) }));
      return ev;
    },
    bossAt: 84, boss: 2 },

  // -------------------------------------------------------------------
  { id: 'static', num: 4, name: 'CATHEDRAL OF STATIC', sub: 'a city archived as noise', tip: 'Lasers telegraph before they fire: read the dotted line. Shielded knights only open up for a moment.',
    pal: { bg0: '#0a0618', bg1: '#251247', e: '#b56bff', e2: '#e9d7ff', b1: '#d98cff', b2: '#7de3ff', accent: '#b56bff' },
    music: { bpm: 142, scale: 'minorPent', root: 43, drums: 'four', bass: 'drive', bassWave: 'square', bassCut: 900, arp: 'down', arpWave: 'square', arpVol: 0.09, leadWave: 'square', pad: 'none', chords: [0, 0, 3, 4], seed: 44, sparse: 0.2 },
    intro: [['ORACLE', 'Nothing organic left. The Choir archived the whole population as noise.'], ['PILOT', 'Then I am deleting the archive.']],
    bossIntro: [['THE ARCHIVIST', 'I have indexed four thousand versions of your death. Let us find which one is canon.'], ['PILOT', 'Write this one down.']],
    mechanic: () => new StaticMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      wave(1, 5, 0.5, (g, i) => g.spawnEnemy('drone', 70 + i * 100, -30, { seq: enter(70 + i * 100, 140, 5), fire: (e, g, dt) => { if (P.every(e, 'f', 1.3, dt)) P.fan(g, e.x, e.y, { n: 3, spread: 0.4, spd: 200, kind: 'star', r: 4.5 }); } }));
      at(6, (g) => g.level.laserRow(g, 'v', 3));
      wave(9, 8, 0.3, (g, i) => g.spawnEnemy('dart', -20, 60 + i * 20, { seq: dive(280, 90) }));
      at(13, (g) => { for (let i = -1; i <= 1; i += 2) g.spawnEnemy('knight', W / 2 + i * 120, -30, { shield: true, seq: enter(W / 2 + i * 120, 220, 8) }); });
      at(18, (g) => g.level.laserRow(g, 'h', 2));
      wave(21, 4, 0.7, (g, i) => g.spawnEnemy('spinner', 90 + i * 120, -30, { seq: [{ vy: 65, dur: 20 }], fire: (e, g, dt) => { if (P.every(e, 'f', 0.11, dt)) { e.data.a = (e.data.a || 0) + 0.6; P.spiralStep(g, e.x, e.y, { arms: 2, ang: e.data.a, spd: 150, kind: 'needle', r: 3.5 }); } } }));
      at(27, (g) => g.spawnEnemy('turret', W / 2, -30, { seq: enter(W / 2, 140, 9), fire: (e, g, dt) => { if (P.every(e, 'f', 1.6, dt)) { g.audio.sfx('glitch'); P.ring(g, g.player.x, g.player.y, { n: 10, spd: 150, kind: 'orb', r: 4, delay: 0.9, noScale: true }); } } }));
      at(30, (g) => g.level.laserRow(g, 'v', 2));
      wave(33, 10, 0.25, (g, i) => g.spawnEnemy('dart', W + 20, 60 + i * 20, { seq: dive(-280, 90) }));
      at(38, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 150, 12, 2.5), fire: (e, g, dt) => { if (P.every(e, 'f', 1.0, dt)) P.curtain(g, { n: 9, gapW: 130, spd: 150, kind: 'needle', r: 3.5, y: e.y + 20 }); if (P.every(e, 's', 3, dt)) g.spawnEnemy('knight', e.x, e.y + 20, { shield: true, seq: [{ vy: 70, dur: 20 }] }); } }));
      at(44, (g) => g.level.laserRow(g, 'h', 3));
      wave(48, 3, 1.1, (g, i) => g.spawnEnemy('knight', 110 + i * 160, -30, { shield: true, seq: enter(110 + i * 160, 200 + (i % 2) * 60, 7) }));
      at(54, (g) => { g.level.laserRow(g, 'v', 3); g.level.glitch(g); });
      wave(57, 12, 0.22, (g, i) => g.spawnEnemy('dart', W / 2 + (i % 2 ? 1 : -1) * (30 + i * 15), -20, { seq: dive((i % 2 ? 1 : -1) * 50, 300) }));
      at(62, (g) => { g.spawnEnemy('turret', W * 0.25, -30, { seq: enter(W * 0.25, 130, 8) }); g.spawnEnemy('turret', W * 0.75, -30, { seq: enter(W * 0.75, 130, 8) }); });
      at(68, (g) => g.level.laserRow(g, 'h', 3));
      at(70, (g) => { g.spawnEnemy('carrier', W * 0.3, -50, { seq: enter(W * 0.3, 150, 10, 2.5) }); g.spawnEnemy('carrier', W * 0.7, -50, { seq: enter(W * 0.7, 150, 10, 2.5) }); });
      return ev;
    },
    bossAt: 85, boss: 3 },

  // -------------------------------------------------------------------
  { id: 'grave', num: 5, name: 'GRAVE OF SUNS', sub: 'two dead stars, still circling', tip: 'Gravity wells bend every bullet, and tug your hull. Curves are safe where straight lines are not.',
    pal: { bg0: '#050308', bg1: '#1a1030', e: '#ffd166', e2: '#b08cff', b1: '#ffd166', b2: '#b08cff', accent: '#ffd166' },
    music: { bpm: 92, scale: 'aeolian', root: 41, drums: 'sparse', bass: 'slow', bassWave: 'sawtooth', bassCut: 400, padWave: 'sawtooth', padVol: 0.13, arp: 'none', leadWave: 'sine', leadVol: 0.12, chords: [0, 5, 6, 4], seed: 55, sparse: 0.55 },
    intro: [['ORACLE', 'Two dead stars, still circling. Their pull bends everything: bullets, light, you.'], ['PILOT', 'Then I will bend too.']],
    bossIntro: [['UMBRA TWINS', 'We were the first to fall silent. We will be the last thing you see.'], ['PILOT', 'You have been staring at each other too long.']],
    mechanic: () => new GraveMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      at(0.5, (g) => g.level.setWell(g, W / 2, 420, 0.8));
      wave(1, 5, 0.6, (g, i) => g.spawnEnemy('drone', 70 + i * 100, -30, { seq: enter(70 + i * 100, 140, 6), fire: (e, g, dt) => { if (P.every(e, 'f', 1.4, dt)) P.fan(g, e.x, e.y, { n: 3, spread: 0.5, spd: 160, r: 4 }); } }));
      wave(8, 8, 0.35, (g, i) => g.spawnEnemy('dart', -20, 60 + i * 25, { seq: dive(220, 60) }));
      at(13, (g) => { g.spawnEnemy('turret', W * 0.25, -30, { seq: enter(W * 0.25, 130, 9), fire: (e, g, dt) => { if (P.every(e, 'f', 1.5, dt)) P.ring(g, e.x, e.y, { n: 12, spd: 110, kind: 'big', r: 6, grav: 2 }); } }); g.spawnEnemy('turret', W * 0.75, -30, { seq: enter(W * 0.75, 130, 9), fire: (e, g, dt) => { if (P.every(e, 'f', 1.5, dt)) P.ring(g, e.x, e.y, { n: 12, spd: 110, kind: 'star', r: 5, grav: 2, color: g.pal.b2 }); } }); });
      wave(20, 6, 0.5, (g, i) => g.spawnEnemy('mine', 60 + i * 84, -20, { seq: [{ vy: 70, dur: 25 }], grav: 1, onDeath: (m, g) => P.ring(g, m.x, m.y, { n: 8, spd: 100, r: 4, grav: 2 }) }));
      at(26, (g) => g.level.setWell(g, W * 0.3, 380, 1.1));
      wave(28, 10, 0.3, (g, i) => g.spawnEnemy('dart', W + 20, 60 + i * 25, { seq: dive(-220, 60) }));
      at(33, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 150, 12, 2.5), fire: (e, g, dt) => { if (P.every(e, 'f', 0.7, dt)) P.spray(g, e.x, e.y + 10, { n: 5, arc: 2.0, spd: 80, spd1: 160, r: 4, grav: 1.5 }); } }));
      at(40, (g) => g.level.setWell(g, W * 0.7, 380, 1.1));
      wave(42, 5, 0.6, (g, i) => g.spawnEnemy('spinner', 80 + i * 95, -30, { seq: [{ vy: 60, dur: 25 }], fire: (e, g, dt) => { if (P.every(e, 'f', 0.16, dt)) { e.data.a = (e.data.a || 0) + 0.45; P.spiralStep(g, e.x, e.y, { arms: 3, ang: e.data.a, spd: 120, r: 4, grav: 1.5 }); } } }));
      wave(50, 4, 0.9, (g, i) => g.spawnEnemy('knight', 100 + i * 115, -30, { seq: enter(100 + i * 115, 200, 6), fire: (e, g, dt) => { if (P.every(e, 'f', 1.2, dt)) P.fan(g, e.x, e.y, { n: 4, spread: 0.6, spd: 180, kind: 'star', r: 4.5, color: g.pal.b2 }); } }));
      at(56, (g) => g.level.setWell(g, W / 2, 450, 1.4));
      wave(58, 12, 0.25, (g, i) => g.spawnEnemy('dart', W / 2 + Math.sin(i) * 200, -20, { seq: dive(0, 260) }));
      at(64, (g) => { g.spawnEnemy('turret', W * 0.3, -30, { seq: enter(W * 0.3, 140, 8) }); g.spawnEnemy('turret', W * 0.7, -30, { seq: enter(W * 0.7, 140, 8) }); });
      at(70, (g) => { g.spawnEnemy('carrier', W * 0.3, -50, { seq: enter(W * 0.3, 150, 10, 2.5) }); g.spawnEnemy('carrier', W * 0.7, -50, { seq: enter(W * 0.7, 150, 10, 2.5) }); });
      at(80, (g) => g.level.setWell(g, 0, 0, 0));
      return ev;
    },
    bossAt: 86, boss: 4 },

  // -------------------------------------------------------------------
  { id: 'hourglass', num: 6, name: 'HOURGLASS REACH', sub: 'where the Choir rehearses one second forever', tip: 'Amber bubbles slow every bullet inside them. Stand in stopped time; step out to strike.',
    pal: { bg0: '#0a1a1c', bg1: '#2c2a12', e: '#ffc14d', e2: '#7ff5e8', b1: '#ffd27a', b2: '#7ff5e8', accent: '#ffc14d' },
    music: { bpm: 116, scale: 'harmMinor', root: 47, drums: 'half', bass: 'pulse', bassWave: 'triangle', arp: 'wide', arpWave: 'sine', arpSend: 0.6, leadWave: 'triangle', chords: [0, 3, 5, 4], seed: 66, sparse: 0.35 },
    intro: [['ORACLE', 'Time runs wrong here. The Choir rehearses the same second forever.'], ['PILOT', 'I have seen it move faster than that.']],
    bossIntro: [['CHRONARCH', 'I have watched you arrive. I have watched you leave. Neither ever happens.'], ['PILOT', 'Then this is new for both of us.']],
    mechanic: () => new HourglassMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      at(0.5, (g) => g.level.spawnBubble(g, W / 2, 560, 100, 14));
      wave(1, 5, 0.6, (g, i) => g.spawnEnemy('drone', 70 + i * 100, -30, { seq: enter(70 + i * 100, 140, 6), fire: (e, g, dt) => { if (P.every(e, 'f', 1.2, dt)) P.fan(g, e.x, e.y, { n: 3, spread: 0.4, spd: 220, kind: 'knife', r: 4 }); } }));
      wave(8, 10, 0.3, (g, i) => g.spawnEnemy('dart', W / 2 + (i % 2 ? 1 : -1) * (60 + i * 15), -20, { seq: dive((i % 2 ? 1 : -1) * 30, 280) }));
      at(13, (g) => { g.level.spawnBubble(g, W * 0.25, 450, 80, 12); g.level.spawnBubble(g, W * 0.75, 650, 80, 12); });
      at(15, (g) => g.spawnEnemy('turret', W / 2, -30, { seq: enter(W / 2, 140, 10), fire: (e, g, dt) => { if (P.every(e, 'f', 1.0, dt)) P.ring(g, e.x, e.y, { n: 14, spd: 260, accel: -260, minSpd: 0, kind: 'ring', r: 5, onUpdate: (b, g2, d) => { if (b.t > 1.6 && b.accel < 0) { b.accel = 160; b.ang = P.aimAt(g2, b.x, b.y); } } }); } }));
      wave(22, 6, 0.5, (g, i) => g.spawnEnemy('spinner', -20, 120 + i * 40, { seq: dive(110, 20), fire: (e, g, dt) => { if (P.every(e, 'f', 0.13, dt)) { e.data.a = (e.data.a || 0) + 0.5; P.spiralStep(g, e.x, e.y, { arms: 2, ang: e.data.a, spd: 150, kind: 'knife', r: 3.5 }); } } }));
      at(28, (g) => g.level.spawnBubble(g, W / 2, 500, 110, 14));
      wave(30, 4, 0.9, (g, i) => g.spawnEnemy('knight', 100 + i * 115, -30, { seq: enter(100 + i * 115, 190, 7), fire: (e, g, dt) => { if (P.every(e, 'f', 0.9, dt)) P.stack(g, e.x, e.y, { n: 4, spd: 120, spd1: 300, kind: 'knife', r: 4 }); } }));
      at(38, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 150, 12, 2.5), fire: (e, g, dt) => { if (P.every(e, 'f', 0.5, dt)) P.fan(g, e.x, e.y + 10, { n: 5, spread: 1.4, spd: 300, accel: -300, minSpd: -200, kind: 'knife', r: 4, life: 3 }); } }));
      wave(44, 10, 0.3, (g, i) => g.spawnEnemy('dart', W + 20, 60 + i * 25, { seq: dive(-260, 90) }));
      at(48, (g) => { g.level.spawnBubble(g, W * 0.3, 600, 90, 14); g.level.spawnBubble(g, W * 0.7, 400, 90, 14); });
      at(50, (g) => { g.spawnEnemy('turret', W * 0.25, -30, { seq: enter(W * 0.25, 130, 9) }); g.spawnEnemy('turret', W * 0.75, -30, { seq: enter(W * 0.75, 130, 9) }); });
      wave(57, 6, 0.5, (g, i) => g.spawnEnemy('mine', 60 + i * 84, -20, { seq: [{ vy: 90, dur: 25 }], onDeath: (m, g) => P.ring(g, m.x, m.y, { n: 8, spd: 200, accel: -160, minSpd: 20, kind: 'ring', r: 4.5 }) }));
      wave(63, 12, 0.22, (g, i) => g.spawnEnemy('dart', i % 2 ? -20 : W + 20, 100 + i * 15, { seq: dive(i % 2 ? 260 : -260, 80) }));
      at(68, (g) => g.level.spawnBubble(g, W / 2, 520, 120, 16));
      at(70, (g) => { g.spawnEnemy('carrier', W * 0.3, -50, { seq: enter(W * 0.3, 150, 10, 2.5) }); g.spawnEnemy('carrier', W * 0.7, -50, { seq: enter(W * 0.7, 150, 10, 2.5) }); });
      return ev;
    },
    bossAt: 86, boss: 5 },

  // -------------------------------------------------------------------
  { id: 'heart', num: 7, name: "THE CHOIR'S HEART", sub: 'where the song begins', tip: 'Everything fires on the beat. Every pulse of the heart pushes the bullets. Move with the rhythm.',
    pal: { bg0: '#1a0208', bg1: '#4d0a1e', e: '#ff3b5c', e2: '#ffffff', b1: '#ff4d6d', b2: '#ffd6de', accent: '#ff3b5c' },
    music: { bpm: 150, scale: 'phrygian', root: 40, drums: 'four', kick: 1.2, bass: 'drive', bassWave: 'sawtooth', bassCut: 800, arp: 'up', arpWave: 'sawtooth', arpVol: 0.06, leadWave: 'sawtooth', leadVol: 0.1, chords: [0, 1, 0, 4], seed: 77, sparse: 0.25 },
    intro: [['ORACLE', 'This is where the song begins. Every world it took is still singing in there.'], ['PILOT', 'Then let us give it a rest.']],
    bossIntro: [['THE CHOIR', 'You came to silence us? Child. We are the silence between your heartbeats.'], ['PILOT', 'Mine is steady. Listen.']],
    mechanic: () => new HeartMechanic(),
    script(g) {
      const { ev, at, wave } = timeline(), W = g.W;
      const beatFire = (kind, n = 8) => (e, g, dt) => { if (g.level.onBeat) P.ring(g, e.x, e.y, { n, spd: 140, kind, r: 4 }); };
      wave(1, 5, 0.6, (g, i) => g.spawnEnemy('drone', 70 + i * 100, -30, { seq: enter(70 + i * 100, 140, 6), fire: beatFire('orb', 6) }));
      wave(8, 12, 0.25, (g, i) => g.spawnEnemy('dart', W / 2 + Math.sin(i * 0.8) * 200, -20, { seq: dive(0, 300) }));
      at(13, (g) => { g.spawnEnemy('turret', W * 0.25, -30, { seq: enter(W * 0.25, 130, 9), fire: beatFire('star', 12) }); g.spawnEnemy('turret', W * 0.75, -30, { seq: enter(W * 0.75, 130, 9), fire: beatFire('orb', 12) }); });
      wave(20, 6, 0.5, (g, i) => g.spawnEnemy('spinner', -20, 120 + i * 40, { seq: dive(110, 20) }));
      wave(20, 6, 0.5, (g, i) => g.spawnEnemy('spinner', W + 20, 140 + i * 40, { seq: dive(-110, 20) }));
      at(27, (g) => g.spawnEnemy('carrier', W / 2, -50, { seq: enter(W / 2, 150, 12, 2.5), fire: (e, g, dt) => { if (g.level.onBeat) P.fan(g, e.x, e.y + 10, { n: 7, spread: 1.6, spd: 180, kind: 'needle', r: 3.5 }); } }));
      wave(33, 4, 0.9, (g, i) => g.spawnEnemy('knight', 100 + i * 115, -30, { shield: true, seq: enter(100 + i * 115, 200, 7), fire: beatFire('needle', 5) }));
      wave(40, 6, 0.5, (g, i) => g.spawnEnemy('seedpod', 60 + i * 84, -30, { seq: [{ vy: 60, dur: 25 }] }));
      wave(46, 10, 0.3, (g, i) => g.spawnEnemy('dart', -20, 60 + i * 25, { seq: dive(260, 80) }));
      wave(46, 10, 0.3, (g, i) => g.spawnEnemy('dart', W + 20, 80 + i * 25, { seq: dive(-260, 80) }));
      at(52, (g) => { g.spawnEnemy('turret', W / 2, -30, { seq: enter(W / 2, 150, 9), fire: (e, g, dt) => { if (g.level.onBeat) { g.audio.sfx('glitch'); P.ring(g, g.player.x, g.player.y, { n: 10, spd: 150, r: 4, delay: 0.8, noScale: true }); } } }); });
      wave(58, 6, 0.5, (g, i) => g.spawnEnemy('mine', 60 + i * 84, -20, { seq: [{ vy: 90, dur: 25 }], onDeath: (m, g) => P.ring(g, m.x, m.y, { n: 10, spd: 130, kind: 'star', r: 4 }) }));
      at(64, (g) => { g.spawnEnemy('carrier', W * 0.3, -50, { seq: enter(W * 0.3, 150, 12, 2.5) }); g.spawnEnemy('carrier', W * 0.7, -50, { seq: enter(W * 0.7, 150, 12, 2.5) }); });
      wave(70, 14, 0.2, (g, i) => g.spawnEnemy('dart', W / 2 + (i % 2 ? 1 : -1) * (30 + i * 14), -20, { seq: dive((i % 2 ? 1 : -1) * 40, 320) }));
      wave(76, 3, 1, (g, i) => g.spawnEnemy('knight', 130 + i * 140, -30, { shield: true, seq: enter(130 + i * 140, 220, 6) }));
      return ev;
    },
    bossAt: 90, boss: 6 },
];

// =====================================================================
// Stage mechanics
// =====================================================================
class Mechanic {
  init(g) {}
  update(g, dt) {}
  drawBack(ctx, g) {}
  drawFront(ctx, g) {}
}

// 1. Asteroid cover --------------------------------------------------------
class EmberMechanic extends Mechanic {
  constructor() { super(); this.rocks = []; }
  spawnAsteroid(g, x, y) {
    const r = g.rng.range(34, 52), pts = [];
    for (let i = 0; i < 9; i++) pts.push(r * g.rng.range(0.75, 1.15));
    this.rocks.push({ x, y, r, hp: 60, maxhp: 60, vy: g.rng.range(28, 44), rot: g.rng.range(0, TAU), vr: g.rng.range(-0.4, 0.4), pts, flash: 0 });
  }
  update(g, dt) {
    const R = this.rocks;
    for (let i = R.length - 1; i >= 0; i--) {
      const a = R[i]; a.y += a.vy * dt; a.rot += a.vr * dt; if (a.flash > 0) a.flash -= dt;
      if (a.y > g.H + 80) { R.splice(i, 1); continue; }
      // enemy bullets absorbed
      const L = g.bullets.list;
      for (let j = L.length - 1; j >= 0; j--) { const b = L[j]; if (b.ghost || b.delay > 0) continue; if (dist2(b.x, b.y, a.x, a.y) < (a.r + b.r) * (a.r + b.r)) { g.fx.spark(b.x, b.y, b.ang + PI, 2, b.color, { spd: 80 }); g.bullets.free.push(b); L[j] = L[L.length - 1]; L.pop(); } }
      // player bullets damage
      const PL = g.pbullets.list;
      for (let j = PL.length - 1; j >= 0; j--) { const b = PL[j]; if (dist2(b.x, b.y, a.x, a.y) < (a.r + b.r) * (a.r + b.r)) { a.hp -= b.dmg; a.flash = 0.06; g.fx.spark(b.x, b.y, b.ang + PI, 1, '#ffb070'); g.pbullets.free.push(b); PL[j] = PL[PL.length - 1]; PL.pop(); } }
      if (a.hp <= 0) {
        g.audio.sfx('shatter'); g.fx.burst(a.x, a.y, 30, '#a0603a', { spd: 200, size: 5, life: 0.9 }); g.fx.burst(a.x, a.y, 14, '#ff8c42', { spd: 160 }); g.fx.addShake(3);
        P.ring(g, a.x, a.y, { n: 6, spd: 90, kind: 'shard', r: 4, color: '#ffb070', ghost: 1, noScale: true, ang: g.rng.range(0, TAU) });
        for (let k = 0; k < 4; k++) g.items.spawn(a.x + g.rng.range(-20, 20), a.y, k === 0 ? 'big' : 'score');
        g.addScore(500, true); R.splice(i, 1);
      }
    }
  }
  drawBack(ctx, g) {
    for (const a of this.rocks) {
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
      ctx.fillStyle = a.flash > 0 ? '#c08060' : '#3d2418'; ctx.strokeStyle = '#7a4a2c'; ctx.lineWidth = 2;
      ctx.beginPath(); a.pts.forEach((r, i) => { const an = (i / a.pts.length) * TAU; i ? ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r) : ctx.moveTo(Math.cos(an) * r, Math.sin(an) * r); }); ctx.closePath(); ctx.fill(); ctx.stroke();
      const k = 1 - a.hp / a.maxhp; ctx.strokeStyle = rgba('#ff8c42', 0.3 + k * 0.7); ctx.lineWidth = 1 + k * 2;
      ctx.beginPath(); ctx.moveTo(-a.r * 0.5, -a.r * 0.2); ctx.lineTo(0, 0.1 * a.r); ctx.lineTo(a.r * 0.4, -a.r * 0.3); ctx.moveTo(0, 0.1 * a.r); ctx.lineTo(a.r * 0.1, a.r * 0.6); ctx.stroke();
      ctx.restore();
    }
  }
}

// 2. Mirror walls + serpents -------------------------------------------------
class GlassMechanic extends Mechanic {
  constructor() { super(); this.flashL = 0; this.flashR = 0; }
  init(g) { g.onBounce = (b) => { g.audio.sfx('tick'); if (b.x < 10) this.flashL = 0.25; else this.flashR = 0.25; g.fx.spark(b.x, b.y, b.ang, 3, '#cfffff', { spd: 120 }); }; }
  modBullet(b) { if (b.kind === 'needle' || b.kind === 'shard') b.bounces = Math.max(b.bounces, 1); }
  spawnSerpent(g, x, y, n, dir) {
    let prev = null;
    for (let i = 0; i < n; i++) {
      const seg = g.spawnEnemy('segment', x - dir * i * 26, y, { r: i === 0 ? 15 : 12, hp: i === 0 ? 24 : 12, despawnY: 9999,
        move: (e, g2, d) => { e.data.t = (e.data.t || 0) + d; e.x += dir * 150 * d; e.y = y + Math.sin(e.data.t * 2.2 + i * 0.5) * 60; },
        fire: i % 3 === 1 ? (e, g2, d) => { if (P.every(e, 'f', 1.4, d)) P.fan(g2, e.x, e.y, { n: 2, spread: PI, ang: PI / 2, spd: 170, kind: 'needle', r: 3.5, bounces: 1 }); } : null });
      seg.color = i === 0 ? g.pal.e2 : g.pal.e; prev = seg;
    }
  }
  update(g, dt) { if (this.flashL > 0) this.flashL -= dt; if (this.flashR > 0) this.flashR -= dt; }
  drawFront(ctx, g) {
    const grd = (x0, x1, a) => { const gr = ctx.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, rgba('#bff6ff', a)); gr.addColorStop(1, rgba('#bff6ff', 0)); ctx.fillStyle = gr; ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), g.H); };
    grd(0, 26, 0.25 + this.flashL * 2); grd(g.W, g.W - 26, 0.25 + this.flashR * 2);
    ctx.strokeStyle = rgba('#e6fbff', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, g.H); ctx.moveTo(g.W - 1, 0); ctx.lineTo(g.W - 1, g.H); ctx.stroke();
  }
}

// 3. Spore clouds -------------------------------------------------------------
class BloomMechanic extends Mechanic {
  constructor() { super(); this.spores = []; }
  spawnSpore(g, x, y) { this.spores.push({ x, y, r: 0, R: g.rng.range(70, 110), t: 0, life: 16, vx: g.rng.range(-12, 12), vy: g.rng.range(8, 20), seed: g.rng.range(0, 100) }); }
  update(g, dt) {
    const S = this.spores;
    for (let i = S.length - 1; i >= 0; i--) { const s = S[i]; s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.r = s.R * Math.min(1, s.t / 1.5) * (s.t > s.life - 2 ? (s.life - s.t) / 2 : 1); if (s.t > s.life || s.y > g.H + 100) S.splice(i, 1); }
  }
  playerSpeedMul(p) { for (const s of this.spores) if (dist2(p.x, p.y, s.x, s.y) < s.r * s.r) return 0.55; return 1; }
  drawBack(ctx, g) {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spores) {
      const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); gr.addColorStop(0, rgba('#ff5fb0', 0.28)); gr.addColorStop(0.7, rgba('#ff5fb0', 0.14)); gr.addColorStop(1, rgba('#ff5fb0', 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('#ffd6ee', 0.5);
      for (let i = 0; i < 10; i++) { const a = s.seed + i * 1.7 + s.t * 0.4, rr = s.r * (0.3 + ((i * 37) % 10) / 14); ctx.fillRect(s.x + Math.cos(a) * rr, s.y + Math.sin(a * 1.3) * rr, 2, 2); }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// 4. Laser rows + glitch -----------------------------------------------------
class StaticMechanic extends Mechanic {
  constructor() { super(); this.glitchT = 0; }
  laserRow(g, dir, n) {
    g.audio.sfx('warn');
    if (dir === 'v') { const gap = Math.floor(g.rng.range(0, 5)); for (let i = 0; i < 5; i++) { if (i === gap || (n < 3 && (i + gap) % 2 === 0)) continue; P.laser(g, { x: 60 + i * 105, y: -10, ang: PI / 2, len: 1000, warn: 1.5, dur: 0.8, w: 24, color: '#d9a8ff' }); } }
    else { const gap = Math.floor(g.rng.range(1, 5)); for (let i = 0; i < 5; i++) { if (i === gap || (n < 3 && (i + gap) % 2 === 0)) continue; P.laser(g, { x: -10, y: 250 + i * 130, ang: 0, len: 600, warn: 1.5, dur: 0.8, w: 24, color: '#d9a8ff' }); } }
  }
  glitch(g) { this.glitchT = 0.6; g.audio.sfx('glitch'); }
  update(g, dt) { if (this.glitchT > 0) this.glitchT -= dt; if (g.rng.chance(0.004)) this.glitchT = 0.15; }
  drawFront(ctx, g) {
    if (this.glitchT > 0) {
      for (let i = 0; i < 6; i++) { const y = g.rng.range(0, g.H), h = g.rng.range(2, 14); ctx.fillStyle = rgba(g.rng.chance(0.5) ? '#7de3ff' : '#d98cff', 0.25); ctx.fillRect(g.rng.range(-20, 20), y, g.W, h); }
    }
  }
}

// 5. Gravity wells ------------------------------------------------------------
class GraveMechanic extends Mechanic {
  constructor() { super(); this.wells = []; }
  setWell(g, x, y, s) { if (s === 0) { this.wells.length = 0; return; } if (!this.wells[0]) this.wells[0] = { x, y, s, t: 0 }; else Object.assign(this.wells[0], { tx: x, ty: y, s }); if (this.wells[0].tx === undefined) { this.wells[0].tx = x; this.wells[0].ty = y; } }
  update(g, dt) { for (const w of this.wells) { w.t += dt; if (w.tx !== undefined) { w.x = lerp(w.x, w.tx, 1 - Math.pow(0.05, dt)); w.y = lerp(w.y, w.ty, 1 - Math.pow(0.05, dt)); } } }
  bulletField(b, g) {
    if (!this.wells.length) return null;
    let fx = 0, fy = 0;
    for (const w of this.wells) { const dx = w.x - b.x, dy = w.y - b.y, d2 = dx * dx + dy * dy + 3000, d = Math.sqrt(d2); const a = (w.s * 260000 * b.grav) / d2; fx += (dx / d) * a; fy += (dy / d) * a; }
    return { x: fx, y: fy };
  }
  playerField(p, g) {
    if (!this.wells.length) return null;
    let fx = 0, fy = 0;
    for (const w of this.wells) { const dx = w.x - p.x, dy = w.y - p.y, d2 = dx * dx + dy * dy + 6000, d = Math.sqrt(d2); const a = (w.s * 90000) / d2; fx += (dx / d) * a; fy += (dy / d) * a; }
    return { x: fx, y: fy };
  }
  drawBack(ctx, g) {
    for (const w of this.wells) {
      const R = 60 + Math.sin(w.t * 2) * 4;
      const gr = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, R * 2.2); gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(w.x, w.y, R * 2.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(w.s > 0 ? '#ffd166' : '#b08cff', 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w.x, w.y, R * 0.55, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.15); ctx.lineWidth = 1; for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(w.x, w.y, R * 0.55 + i * 22 + ((w.t * 30 * -w.s) % 22), 0, TAU); ctx.stroke(); }
    }
  }
}

// 6. Time bubbles -------------------------------------------------------------
class HourglassMechanic extends Mechanic {
  constructor() { super(); this.bubbles = []; }
  spawnBubble(g, x, y, r, life) { this.bubbles.push({ x, y, r: 0, R: r, t: 0, life, vy: 12 }); g.audio.sfx('freeze'); }
  update(g, dt) { const B = this.bubbles; for (let i = B.length - 1; i >= 0; i--) { const b = B[i]; b.t += dt; b.y += b.vy * dt; b.r = b.R * Math.min(1, b.t / 0.8) * (b.t > b.life - 1 ? Math.max(0, b.life - b.t) : 1); if (b.t > b.life) B.splice(i, 1); } }
  bulletTimeAt(x, y, g) { for (const b of this.bubbles) if (dist2(x, y, b.x, b.y) < b.r * b.r) return 0.28; return 1; }
  drawBack(ctx, g) {
    for (const b of this.bubbles) {
      const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r); gr.addColorStop(0, rgba('#ffc14d', 0.06)); gr.addColorStop(0.85, rgba('#ffc14d', 0.14)); gr.addColorStop(1, rgba('#ffc14d', 0.3));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba('#fff2c2', 0.7); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.t * 0.3);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * b.r * 0.9, Math.sin(a) * b.r * 0.9); ctx.lineTo(Math.cos(a) * b.r, Math.sin(a) * b.r); ctx.stroke(); }
      ctx.restore();
    }
  }
}

// 7. Heartbeat rhythm ---------------------------------------------------------
class HeartMechanic extends Mechanic {
  constructor() { super(); this.beat = 0; this.beatT = 0; this.onBeat = false; this.pulse = 0; this.wells = []; this.bubbles = []; this.finale = false; }
  init(g) { this.interval = 60 / 150; }
  update(g, dt) {
    this.beatT += dt; this.onBeat = false;
    if (this.beatT >= this.interval) { this.beatT -= this.interval; this.beat++; this.onBeat = true; this.pulse = 1; if (this.beat % 2 === 0) { g.audio.sfx('beat'); g.fx.addShake(1); } }
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 5);
    // reuse sibling mechanics for reprise phases
    for (const w of this.wells) w.t += dt;
    const B = this.bubbles; for (let i = B.length - 1; i >= 0; i--) { const b = B[i]; b.t += dt; b.r = b.R * Math.min(1, b.t / 0.8) * (b.t > b.life - 1 ? Math.max(0, b.life - b.t) : 1); if (b.t > b.life) B.splice(i, 1); }
  }
  beatK() { return this.pulse; }
  bulletTimeAt(x, y, g) { for (const b of this.bubbles) if (dist2(x, y, b.x, b.y) < b.r * b.r) return 0.28; return 1 + this.pulse * 0.9; }
  setWell(g, x, y, s) { GraveMechanic.prototype.setWell.call(this, g, x, y, s); }
  bulletField(b, g) { return GraveMechanic.prototype.bulletField.call(this, b, g); }
  playerField(p, g) { return GraveMechanic.prototype.playerField.call(this, p, g); }
  spawnBubble(g, x, y, r, life) { HourglassMechanic.prototype.spawnBubble.call(this, g, x, y, r, life); }
  drawBack(ctx, g) { GraveMechanic.prototype.drawBack.call(this, ctx, g); HourglassMechanic.prototype.drawBack.call(this, ctx, g); }
  drawFront(ctx, g) {
    const k = this.pulse;
    if (k > 0.02) { const gr = ctx.createRadialGradient(g.W / 2, g.H / 2, g.H * 0.35, g.W / 2, g.H / 2, g.H * 0.8); gr.addColorStop(0, 'rgba(255,59,92,0)'); gr.addColorStop(1, rgba('#ff3b5c', 0.28 * k)); ctx.fillStyle = gr; ctx.fillRect(0, 0, g.W, g.H); }
  }
}

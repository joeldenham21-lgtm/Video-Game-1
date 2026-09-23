// RINGFALL — entry point: boot, game-state flow, main loop, time control.
import * as THREE from 'three';
import { G } from './state.js';
import { createRenderer } from './engine/renderer.js';
import { createInput } from './engine/input.js';
import audio from './audio.js';
import { createSky } from './world/sky.js';
import { initStage, loadStage, updateStage } from './world/stage.js';
import { createPlayer } from './game/player.js';
import { createWeapons } from './game/weapons.js';
import { createEnemies } from './game/enemies.js';
import { createProjectiles } from './game/projectiles.js';
import { createPickups } from './game/pickups.js';
import { createAugments, AUGMENTS } from './game/augments.js';
import { createStyle } from './game/style.js';
import { createStory } from './game/story.js';
import { createDirector } from './game/director.js';
import { createBoss } from './game/boss.js';
import { createParticles } from './fx/particles.js';
import { createEffects } from './fx/effects.js';
import { createHud } from './ui/hud.js';
import { createMenus } from './ui/menus.js';
import { CSS } from './ui/styles.js';
import { loadSettings, loadMeta, saveMeta } from './game/settings.js';
import { damp, clamp } from './util.js';

function detectTouch() {
  const mm = (q) => window.matchMedia && matchMedia(q).matches;
  const coarse = mm('(pointer: coarse)'), fine = mm('(any-pointer: fine)');
  return (coarse && !fine) || (navigator.maxTouchPoints > 1 && !fine) || (coarse && navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820);
}

function bootError(msg) {
  const el = document.getElementById('boot-err');
  if (el) { el.hidden = false; el.textContent = msg; }
}

const DEBUG = /[?&]debug/.test(location.search);
let titleDisplay = [];

async function boot() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  G.isTouch = detectTouch();
  G.isMobile = G.isTouch && Math.min(screen.width, screen.height) < 820;
  G.settings = loadSettings();
  G.meta = loadMeta();
  G.augmentDefs = AUGMENTS;

  const canvas = document.getElementById('game');
  try {
    G.renderer = createRenderer(canvas);
  } catch (e) {
    bootError('WebGL is unavailable on this device or browser. Try updating the browser or enabling hardware acceleration.');
    throw e;
  }
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1600);
  G.vmScene = new THREE.Scene();
  G.vmCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 20);
  G.vmScene.add(G.vmCamera);

  const q = G.settings.quality === 'auto' ? (G.isTouch ? 'medium' : 'high') : G.settings.quality;
  G.renderer.setQuality(q, G.settings.quality === 'auto');

  G.sky = createSky(q);
  G.scene.add(G.sky.mesh);
  initStage();
  G.particles = createParticles(G.scene, 1);
  G.fx = createEffects(G.scene);
  G.input = createInput(canvas, document.getElementById('touch'));
  G.audio = audio;
  G.player = createPlayer();
  G.weapons = createWeapons();
  G.enemies = createEnemies();
  G.projectiles = createProjectiles();
  G.pickups = createPickups();
  G.augments = createAugments();
  G.style = createStyle();
  G.story = createStory();
  G.director = createDirector();
  G.boss = createBoss();
  const uiRoot = document.getElementById('ui');
  G.hud = createHud(uiRoot);
  G.menus = createMenus(uiRoot);
  document.getElementById('touch').classList.toggle('lefty', !!G.settings.leftHanded);

  // first user gesture unlocks audio
  let unlocked = false;
  const unlock = () => {
    if (!unlocked) {
      // play through the iPhone silent switch — the soundtrack is half the game
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
      audio.setVolumes({ master: 1, music: G.settings.musicVol, sfx: G.settings.sfxVol });
      unlocked = true;
    }
    audio.init();
    if (G.mode === 'title') audio.music.play('menu');
    // high-altitude wind bed under everything
    if (!G._wind && audio.ready) G._wind = audio.loop('wind', { volume: 0.7 });
  };
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { passive: true });
  // no pinch-zoom or double-tap zoom mid-fight (iOS ignores user-scalable)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  wireFlow();
  loadStage('aperture');
  warmUp();
  enterTitle();

  document.getElementById('boot').classList.add('gone');
  window.g = G;
  if (DEBUG) setupDebug();
  resizeTouchVars();
  window.addEventListener('resize', resizeTouchVars);
  requestAnimationFrame(frame);
}

// Size touch controls from the smaller screen dimension so they fit every phone
function resizeTouchVars() {
  const m = Math.min(window.innerWidth, window.innerHeight);
  const u = clamp(m / 100, 3, 7.5);
  const root = document.getElementById('touch');
  root.style.setProperty('--u', `${u}px`);
  root.style.setProperty('--fire', `${Math.round(u * 21)}px`);
  root.style.setProperty('--b1', `${Math.round(u * 17)}px`);
  root.style.setProperty('--b2', `${Math.round(u * 14.5)}px`);
  root.style.setProperty('--b3', `${Math.round(u * 11.5)}px`);
  root.style.setProperty('--stick', `${Math.round(Math.max(96, u * 26))}px`);
}

// Compile every shader up front so the first fight doesn't hitch
function warmUp() {
  const types = ['mite', 'sentinel', 'lancer', 'brute', 'warden', 'pylon'];
  const tmp = types.map((t, i) => G.enemies.spawn(t, -6 + i * 2.5, 3, 6, { silent: true }));
  for (const e of tmp) { e.warp = 0; e.root.scale.setScalar(1); }
  G.player.reset(G.arena.start);
  G.camera.position.set(0, 4, 18);
  G.camera.lookAt(0, 3, 6);
  try { G.renderer.gl.compile(G.scene, G.camera); G.renderer.gl.compile(G.vmScene, G.vmCamera); } catch { /* ignore */ }
  G.renderer.render(G.scene, G.camera, G.vmScene, G.vmCamera);
  G.enemies.clear();
}

function enterTitle() {
  G.mode = 'title';
  G.run = null;
  G.input.setEnabled(false);
  G.input.exitLock();
  G.hud.show(false);
  G.hud.clearTransient();
  G.weapons.root.visible = false;
  G.enemies.clear(); G.projectiles.clear(); G.pickups.clear(); G.particles.clear(); G.fx.clear(); G.boss.clear();
  if (G.arena?.name !== 'aperture') loadStage('aperture');
  // a few constructs drifting over the deck
  titleDisplay = [];
  const spots = [['sentinel', 6, 5, -4], ['sentinel', -9, 6.5, 3], ['lancer', 13, 8, -12], ['mite', 2, 7, 0], ['mite', 3.2, 6.4, 1.4], ['mite', 1.2, 7.8, 1.6], ['brute', -2, 1.05, -10]];
  for (const [t, x, y, z] of spots) {
    const e = G.enemies.spawn(t, x, y, z, { silent: true });
    e.warp = 0; e.root.scale.setScalar(1); e.base = y;
    titleDisplay.push(e);
  }
  G.audio.music.play('menu');
  G.menus.showTitle();
}

function startRun({ difficulty, checkpoint }) {
  G.menus.hide();
  G.enemies.clear();
  titleDisplay = [];
  G.weapons.root.visible = true;
  G.hud.show(true);
  G.hud.clearTransient();
  G.hud.resetTips();
  G.director.startRun(difficulty, { checkpoint });
  G.hud.weaponChanged();
  if (G.input.source === 'kbm') G.input.requestLock();
  setTimeout(() => { if (G.mode === 'playing' && G.run?.floor === 1) G.hud.tipOnce('move', 7); }, 3500);
}

function pause() {
  if (G.mode !== 'playing') return;
  if (DEBUG) (window.__pauseTrace = window.__pauseTrace || []).push(new Error('pause').stack.split('\n').slice(1, 5).join(' <- '));
  G.mode = 'paused';
  G.input.setEnabled(false);
  G.input.exitLock();
  G.audio.suspend();
  G.menus.showPause();
}

function resume() {
  if (G.mode !== 'paused') return;
  G.menus.hide();
  G.mode = 'playing';
  G.input.setEnabled(true);
  G.audio.resume();
  if (G.input.source === 'kbm') G.input.requestLock();
}

function wireFlow() {
  const ev = G.events;
  ev.on('startRun', startRun);
  ev.on('resume', resume);
  ev.on('pointerUnlocked', () => { if (G.mode === 'playing' && G.input.source === 'kbm') pause(); });
  ev.on('focusLost', () => pause());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  ev.on('quitToTitle', () => { G.menus.hide(); G.audio.resume(); enterTitle(); });
  ev.on('playerDied', () => {
    G.mode = 'dying';
    G.dyingT = 2.2;
    G.slowmo = 2;
    G.input.setEnabled(false);
    G.audio.music.stinger('death');
    G.audio.play('death');
    G.story.say('death');
    G.renderer.post.uFadeColor.value.set(0x200006);
  });
  ev.on('victory', () => {
    G.mode = 'victory';
    G.meta.wins++;
    G.meta.bestScore = Math.max(G.meta.bestScore, G.style.score);
    G.meta.unlockedNightmare = true;
    saveMeta();
    G.input.setEnabled(false);
    G.input.exitLock();
    G.audio.music.play('victory');
    G.story.say('victory');
    G.hud.show(false);
    setTimeout(() => G.menus.showVictory(), 1600);
  });
  ev.on('endless', () => {
    G.hud.show(true);
    G.weapons.root.visible = true;
    G.director.goEndless();
    if (G.input.source === 'kbm') G.input.requestLock();
  });
}

let last = performance.now();
let worldScale = 1;
let titleT = 0;

// ?debug&sim=N runs N fixed simulation steps per rendered frame (fast headless playtests)
const SIM = DEBUG ? +(location.search.match(/sim=(\d+)/)?.[1] || 1) : 1;

function frame(now) {
  requestAnimationFrame(frame);
  const frameMs = now - last;
  last = now;
  if (SIM > 1) {
    for (let i = 0; i < SIM; i++) { step(1 / 30); if (i < SIM - 1) G.input.endFrame(); }
  } else {
    G.renderer.adapt(frameMs);
    step(Math.min(0.05, Math.max(0, frameMs / 1000)));
  }
  G.renderer.render(G.scene, G.camera, G.weapons.root.visible ? G.vmScene : null, G.vmCamera);
  G.hud.update(SIM > 1 ? 1 / 30 * SIM : Math.min(0.05, frameMs / 1000));
  G.input.endFrame();
}

function step(raw) {
  G.time += raw;
  G.dt = raw;
  G.input.update(raw);
  G.menus.update();
  if (DEBUG && G.debugHook) G.debugHook(raw);

  const mode = G.mode;
  if (mode === 'playing' && G.input.pressed('pause')) pause();

  // time control: overdrive slows the world, slowmo slows everything, hitstop freezes briefly
  const live = mode === 'playing' || mode === 'dying';
  if (live) {
    const target = G.player.odActive > 0 ? 0.33 : 1;
    worldScale = damp(worldScale, G.slowmo > 0 ? Math.min(target, 0.3) : target, 12, raw);
    if (G.slowmo > 0) G.slowmo -= raw;
    if (G.hitstop > 0) {
      G.hitstop -= raw;
      G.worldDt = 0; G.playerDt = raw * 0.1;
    } else {
      G.worldDt = raw * worldScale;
      G.playerDt = G.player.odActive > 0 ? raw : raw * (G.slowmo > 0 ? Math.max(worldScale, 0.35) : 1);
    }
    G.worldTime += G.worldDt;
    G.player.update(G.playerDt, raw);
    G.weapons.update(G.playerDt, raw);
    G.augments.update(G.worldDt);
    G.enemies.update(G.worldDt);
    G.boss.update(G.worldDt);
    G.projectiles.update(G.worldDt);
    G.pickups.update(G.worldDt);
    G.director.update(G.worldDt);
    G.style.update(raw);
    if (mode === 'dying') {
      G.dyingT -= raw;
      G.renderer.post.uFade.value = clamp(1 - G.dyingT / 2.2, 0, 0.75);
      if (G.dyingT <= 0) {
        G.mode = 'dead';
        G.meta.bestScore = Math.max(G.meta.bestScore, G.style.score);
        G.meta.totalKills += G.player.kills;
        saveMeta();
        G.input.exitLock();
        G.hud.show(false);
        G.audio.music.play('menu');
        G.menus.showDeath();
      }
    }
  } else {
    G.worldDt = mode === 'title' ? raw : 0;
    G.playerDt = 0;
  }

  if (mode === 'title') {
    titleT += raw;
    const a = titleT * 0.045 + 0.6;
    G.camera.position.set(Math.cos(a) * 31, 7.5 + Math.sin(titleT * 0.12) * 1.5, Math.sin(a) * 31);
    G.camera.lookAt(Math.cos(a + 1.4) * 4, 4.5, Math.sin(a + 1.4) * 4);
    const hfov = 88, vfov = 2 * Math.atan(Math.tan(hfov * Math.PI / 360) / Math.max(G.camera.aspect, 0.75)) * 180 / Math.PI;
    if (Math.abs(G.camera.fov - vfov) > 0.01) { G.camera.fov = clamp(vfov, 40, 90); G.camera.updateProjectionMatrix(); }
    for (const e of titleDisplay) {
      e.root.position.y = e.base + Math.sin(titleT * 0.8 + e.id * 10) * 0.35;
      e.root.rotation.y = titleT * 0.2 + e.id * 6;
      const p = e.model.parts;
      if (p.halo) { p.halo.rotation.x += raw * 0.8; p.halo.rotation.y += raw * 1.2; }
      if (p.spin) p.spin.rotation.z += raw * 5;
      if (p.orbit) p.orbit.rotation.y += raw * 2;
    }
  }

  const simDt = live || mode === 'title' ? G.worldDt : 0;
  G.particles.update(simDt);
  G.fx.update(simDt);
  updateStage(simDt, G.time);
  G.sky.update(G.camera, G.time);
  G.vmCamera.quaternion.copy(G.camera.quaternion);
  G.audio.setListener(G.camera.position, G.player.yaw);

  // transient post effects
  const post = G.renderer.post;
  post.uDamage.value = damp(post.uDamage.value, 0, 3.5, raw);
  post.uChroma.value = damp(post.uChroma.value, G.player.odActive > 0 ? 0.35 : 0, 5, raw);
  post.uFlash.value = damp(post.uFlash.value, 0, 7, raw);
  if (mode !== 'dying' && mode !== 'transition') post.uFade.value = damp(post.uFade.value, 0, 2.5, raw);
  post.uOverdrive.value = damp(post.uOverdrive.value, G.player.odActive > 0 ? 1 : 0, 6, raw);
  if (mode !== 'playing' && mode !== 'dying') post.uLowHealth.value = damp(post.uLowHealth.value, 0, 4, raw);
}

function setupDebug() {
  G.debug = {
    god(on = true) { G.player.god = on; },
    floor(n) { G.director.startFloor(n); },
    clear() { for (const e of G.enemies.list) if (e.alive && !e.def.boss) G.enemies.kill(e, { source: 'debug' }); },
    spawn(type, x = 0, y = 3, z = 0) { return G.enemies.spawn(type, x, y, z); },
    pause, resume, startRun,
  };
}

// When the hosted page is updated while someone is mid-run, carry the run across the reload.
const hot = window.claude?.hot;
try {
  hot?.snapshot?.(() => (G.run && G.mode !== 'title' && G.mode !== 'dead' && G.mode !== 'victory') ? {
    resume: {
      difficulty: G.run.difficulty, floor: G.run.floor, weapons: G.weapons.owned.slice(), augments: G.augments.list.slice(),
      score: G.style.score, seen: [...G.run.seen],
    },
  } : {});
} catch { /* hosting API unavailable */ }
const launch = (data) => {
  if (data && data.resume && data.resume.floor) G.hotResume = data.resume;
  boot().catch(e => { console.error(e); bootError(String(e && e.message || e)); });
};
if (hot?.ready) hot.ready(launch); else launch(hot?.data ?? {});

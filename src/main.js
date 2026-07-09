// ============================================================================
// ELDERFALL — main.js
// Boot, shared context, game loop, timeScale (hitstop/slow-mo), adaptive
// resolution. Owns the renderer; subsystems are created here in order.
// ============================================================================
import * as THREE from 'three';
import { makeEvents } from './core.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createSky } from './sky.js';
import { createStructures } from './structures.js';
import { createPlayer } from './player.js';
import { createEnemies } from './enemies.js';
import { createCombat } from './combat.js';
import { createQuests } from './quests.js';
import { createUI } from './ui.js';
import { createSave } from './save.js';
import { createRPG } from './rpg.js';
import { createBooks } from './books.js';
import { createFauna } from './fauna.js';
import { createVoice } from './voice.js';
import { createDetails } from './details.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

// ---------------------------------------------------------------------------
// Debug / error overlay (also active pre-boot so we can see startup failures)
// ---------------------------------------------------------------------------
const errBox = document.createElement('div');
errBox.style.cssText =
  'position:fixed;left:0;right:0;bottom:0;max-height:45%;overflow:auto;z-index:9999;' +
  'background:rgba(80,0,0,.92);color:#ffd;font:11px/1.5 monospace;padding:8px;display:none;white-space:pre-wrap;';
document.body.appendChild(errBox);
function showErr(msg) {
  errBox.style.display = 'block';
  errBox.textContent += msg + '\n';
}
window.addEventListener('error', (e) => showErr(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showErr('Promise: ' + (e.reason?.stack || e.reason)));

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const IS_COARSE = matchMedia('(pointer: coarse)').matches;
const DPR_CAP = 2.0; // flagship phones stay sharp; adaptive scaler protects weaker GPUs
let resScale = 1.0;
function applyResolution() {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP) * resScale);
  renderer.setSize(innerWidth, innerHeight);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(IS_COARSE ? 72 : 75, innerWidth / innerHeight, 0.1, 4200);
applyResolution();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyResolution();
});

// ---------------------------------------------------------------------------
// Quality tier
// ---------------------------------------------------------------------------
const qualityPref = localStorage.getItem('elderfall_quality');
const tier = qualityPref || (IS_COARSE ? 'high' : 'high'); // 'low' available via menu
const quality = { tier, shadows: tier === 'high' };
if (quality.shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------
const pointLight = new THREE.PointLight(0xffa544, 0, 14, 1.8);
scene.add(pointLight);

const g = {
  scene, camera, renderer, canvas,
  events: makeEvents(),
  time: { elapsed: 0, dt: 0, rawDt: 0, dayFrac: 0.3, dayLength: 720, timeScale: 1 },
  quality,
  flags: {},
  colliders: [],
  interactables: [],
  paused: false,
  pointLight,
};
if (DEBUG) window.g = g;

// Hitstop & slow-mo -----------------------------------------------------------
let hitstopUntil = 0;
let slowmo = 1;
g.requestHitstop = (ms) => { hitstopUntil = Math.max(hitstopUntil, performance.now() + ms); };
g.requestSlowmo = (f) => { slowmo = f; };
g.releaseSlowmo = () => { slowmo = 1; };

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const titleEl = document.getElementById('title');
const btnNew = document.getElementById('btn-new');
const btnContinue = document.getElementById('btn-continue');
const loadingEl = document.getElementById('loading');

if (localStorage.getItem('elderfall_save_v1')) btnContinue.style.display = 'block';

let booted = false;
function boot(loadSave) {
  if (booted) return;
  booted = true;
  btnNew.disabled = btnContinue.disabled = true;
  loadingEl.classList.add('on');

  // Give the browser one frame to paint the loading state, then build the world.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      g.audio = createAudio(g);
      g.audio.unlock(); // we are inside a user gesture chain
      g.world = createWorld(g);
      g.sky = createSky(g);
      g.structures = createStructures(g);
      g.player = createPlayer(g);
      g.enemies = createEnemies(g);
      g.combat = createCombat(g);
      g.quests = createQuests(g);
      g.ui = createUI(g);
      g.save = createSave(g);
      g.rpg = createRPG(g);
      g.books = createBooks(g);
      g.fauna = createFauna(g);
      g.voice = createVoice(g);
      g.details = createDetails(g);
      if (loadSave) g.save.load();
      titleEl.classList.add('hidden');
      setTimeout(() => titleEl.remove(), 1400);
      start();
    } catch (err) {
      showErr('BOOT FAILED: ' + (err.stack || err));
      console.error(err);
    }
  }));
}
btnNew.addEventListener('click', () => boot(false));
btnContinue.addEventListener('click', () => boot(true));

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = 0;
let frameEMA = 16.7;
let lastPerfCheck = 0;

function start() {
  last = performance.now();
  renderer.setAnimationLoop(tick);
}

function tick(now) {
  const rawDt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // timeScale: weapon-wheel slow-mo and combat hitstop
  const ts = now < hitstopUntil ? 0.05 : slowmo;
  g.time.timeScale = ts;
  const dt = rawDt * ts;
  g.time.rawDt = rawDt;
  g.time.dt = dt;

  if (!g.paused) {
    g.time.elapsed += dt;
    g.time.dayFrac = (g.time.dayFrac + dt / g.time.dayLength) % 1;
  }

  // Update order per CONTRACT.md
  try {
    g.player.update(dt);
    g.world.update(dt);
    g.sky.update(dt);
    g.structures.update(dt);
    g.enemies.update(dt);
    g.combat.update(dt);
    g.quests.update(dt);
    g.audio.update(dt);
    g.ui.update(dt);
    g.rpg.update(dt);
    g.books.update(dt);
    g.fauna.update(dt);
    g.voice.update(dt);
    g.details.update(dt);
    g.ui.input.endFrame();
  } catch (err) {
    if (DEBUG) showErr('TICK: ' + (err.stack || err));
    else console.error(err);
  }

  renderer.render(scene, camera);

  // Adaptive resolution: keep frame time healthy on weaker phones
  frameEMA = frameEMA * 0.95 + (rawDt * 1000) * 0.05;
  if (now - lastPerfCheck > 2000) {
    lastPerfCheck = now;
    if (frameEMA > 19 && resScale > 0.65) { resScale -= 0.15; applyResolution(); }
    else if (frameEMA < 12.5 && resScale < 1.0) { resScale = Math.min(1, resScale + 0.1); applyResolution(); }
  }
}

// Pause the clock when tab is hidden so dt doesn't explode
document.addEventListener('visibilitychange', () => { last = performance.now(); });

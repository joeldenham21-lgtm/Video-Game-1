// Shared game context. Every system registers itself here so modules never import each other in cycles.

// Render layer for glowing effects and the sky: drawn by the main camera, skipped by the depth/AO prepass
export const FX_LAYER = 2;
export function fxLayer(obj) { obj.layers.set(FX_LAYER); return obj; }

export const G = {
  // engine
  renderer: null,   // engine/renderer.js wrapper
  scene: null,
  camera: null,
  vmScene: null,    // first-person viewmodel scene
  vmCamera: null,
  input: null,
  audio: null,
  // world
  sky: null,
  arena: null,
  world: null,      // collision world
  // gameplay
  player: null,
  weapons: null,
  enemies: null,
  projectiles: null,
  pickups: null,
  director: null,
  style: null,
  augments: null,
  boss: null,
  // fx
  particles: null,
  beams: null,
  debris: null,
  decals: null,
  lights: null,
  // ui
  hud: null,
  menus: null,
  // timing
  time: 0,          // unscaled seconds since boot
  worldTime: 0,     // scaled game time
  dt: 0,            // unscaled frame delta (clamped)
  worldDt: 0,       // delta for enemies/projectiles (affected by overdrive + hitstop)
  playerDt: 0,      // delta for the player (affected by hitstop only)
  timeScale: 1,     // world time scale target (overdrive)
  hitstop: 0,       // seconds of freeze remaining
  slowmo: 0,        // seconds of dramatic slow motion remaining
  // state machine: 'boot' | 'title' | 'playing' | 'paused' | 'augment' | 'dead' | 'victory' | 'transition'
  mode: 'boot',
  isTouch: false,
  isMobile: false,
  settings: null,
  meta: null,       // persistent progression
  run: null,        // current run state
  events: null,     // event bus
};

// Minimal event bus
const handlers = new Map();
G.events = {
  on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
  off(name, fn) { const a = handlers.get(name); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
  emit(name, data) { const a = handlers.get(name); if (a) for (let i = 0; i < a.length; i++) a[i](data); },
};

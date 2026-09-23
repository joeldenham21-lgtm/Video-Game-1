// Player settings and persistent meta-progression (localStorage, never throws).
import { store } from '../util.js';
import { G } from '../state.js';

const SETTINGS_KEY = 'ringfall.settings.v1';
const META_KEY = 'ringfall.meta.v1';

export function defaultSettings() {
  const touch = G.isTouch;
  return {
    quality: 'auto',          // auto | low | medium | high | ultra
    fov: touch ? 96 : 100,    // horizontal degrees
    mouseSens: 1,
    touchSens: 1,
    padSens: 1,
    invertY: false,
    aimAssist: 1,             // 0 off, 1 standard, 1.6 strong
    autoFire: touch,          // touch: fire automatically when the reticle is on a target
    leftHanded: false,
    haptics: true,
    shake: 1,
    musicVol: 0.7,
    sfxVol: 0.9,
    showFps: false,
    damageNumbers: true,
  };
}

export function loadSettings() {
  const s = Object.assign(defaultSettings(), store.get(SETTINGS_KEY, {}));
  return s;
}

export function saveSettings() {
  store.set(SETTINGS_KEY, G.settings);
}

export function loadMeta() {
  return Object.assign({
    runs: 0, wins: 0, bestFloor: 0, bestScore: 0, totalKills: 0, bestRank: '',
    seenIntro: false, unlockedNightmare: false, endless: false, playtime: 0,
  }, store.get(META_KEY, {}));
}

export function saveMeta() {
  store.set(META_KEY, G.meta);
}

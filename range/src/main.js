// ============================================================================
// RANGE — main.js
// Bootstraps renderer, physics, world, weapons, viewmodel, projectiles,
// effects, audio, optics, HUD, and runs the frame loop.
// Rendering: world scene → weapon scene (depth cleared, same camera pose,
// near plane 8 mm) → bloom → output. The scope view is rendered to a texture
// before the main pass when the rifle is shouldered.
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { createPhysics } from './physics.js';
import { buildWorld, RANGE } from './world.js';
import { createTargets } from './targets.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { ProjectileManager } from './projectiles.js';
import { buildAR15 } from './weapons/ar15.js';
import { buildPistol } from './weapons/pistol.js';
import { buildBoltRifle } from './weapons/bolt.js';
import { buildHand } from './hands.js';
import { ViewModel } from './viewmodel.js';
import { createOptics } from './optics.js';
import { Player } from './player.js';
import { createHUD } from './hud.js';
import * as B from './ballistics.js';

const params = new URLSearchParams(location.search);
const settings = {
  windSpeed: 3, windDir: 90, tempC: 15, altitudeM: 0, humidity: 50, latitudeDeg: 40, azimuthDeg: 0, zeroRange: 50, fov: 68, sensitivity: 1.0,
  coriolis: true, spinDrift: true, earPro: true, crosshair: false, traces: false, postfx: !params.has('nopost'), gusts: true, timeScale: 1,
};

async function init() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const lowq = params.has('lowq');
  renderer.setPixelRatio(lowq ? 1 : Math.min(window.devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const viewScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.25, 3000);
  const viewCam = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.008, 6);
  scene.add(camera); viewScene.add(viewCam);

  const physics = await createPhysics();
  const world = buildWorld(scene, physics, renderer);
  if (lowq) { world.sun.shadow.mapSize.set(1024, 1024); }
  viewScene.environment = world.envTex;
  // viewmodel lighting: sun clone with a tight shadow frustum that follows the camera
  const vSun = new THREE.DirectionalLight(0xfff1dc, 3.0); vSun.castShadow = true; vSun.shadow.mapSize.set(lowq ? 1024 : 2048, lowq ? 1024 : 2048); vSun.shadow.camera.near = 0.05; vSun.shadow.camera.far = 8;
  vSun.shadow.camera.left = vSun.shadow.camera.bottom = -1.6; vSun.shadow.camera.right = vSun.shadow.camera.top = 1.6; vSun.shadow.bias = -0.0002; vSun.shadow.normalBias = 0.004;
  viewScene.add(vSun, vSun.target, new THREE.HemisphereLight(0xbfd4ee, 0x6b6a52, 0.55));

  const audio = createAudio();
  const effects = createEffects(scene, physics);
  const hudCb = {};
  const hud = createHUD(document.getElementById('hud'), settings, hudCb);
  const targets = createTargets(scene, physics, { onTargetHit: (t, info) => hud.targetReport(t, info), sound: (n, o) => audio.play(n, { ...o, refDistance: 4, rolloff: 0.8 }) });
  const projectiles = new ProjectileManager({ physics, effects, audio, hooks: { onShotDone: (shot) => hud.shotReport(shot) } });

  const weapons = { ar15: buildAR15(), pistol: buildPistol(), bolt: buildBoltRifle() };
  const hands = { right: buildHand('right'), left: buildHand('left') };
  const vm = new ViewModel({ camera: viewCam, weapons, hands, hooks: {
    onShot: (info) => {
      projectiles.fire(info); effects.muzzleFlash(info.origin, info.dir, info.weapon.spec, settings.timeScale < 0.9); audio.gunshot(info.weapon.spec);
      if (info.weapon.spec.action === 'gas') { const p = new THREE.Vector3().copy(info.weapon.anchors.ejection.pos).applyMatrix4(info.weapon.group.matrixWorld); const d = new THREE.Vector3().copy(info.weapon.anchors.ejection.dir).transformDirection(info.weapon.group.matrixWorld); setTimeout(() => effects.portGas(p, d), 12 / settings.timeScale); }
    },
    onEject: (info) => effects.ejectCase(info),
    onDropMag: (info) => { const mesh = info.weapon.parts.mag.obj.clone(true); mesh.traverse((o) => { if (o.name === 'topRound') o.visible = info.rounds > 0; }); const L = info.weapon.parts.mag.length; effects.dropMag({ ...info, half: [0.014, L / 2, 0.032], massKg: 0.12 + info.rounds * 0.012 }, mesh); },
    sound: (name, o) => audio.play(name, { gain: (o?.quiet ? 0.35 : 0.8), pitch: 0.95 + Math.random() * 0.1, ...(o || {}) }),
    onDryFire: () => hud.message(vm.state.magRounds === 0 ? 'click — empty. R to reload' : 'click — chamber empty. X to charge', 1800),
  } });
  const optics = createOptics({ renderer, worldScene: scene, viewmodel: vm, camera });
  for (const w of Object.values(weapons)) optics.attach(w);

  const player = new Player(camera, canvas, physics);
  const envOpts = { atm: {}, wind: [0, 0, 0], latitudeDeg: 40, azimuthDeg: 0, coriolis: true, spinDrift: true };
  const gust = { v: 0, target: 0, t: 0 };
  function applyEnvironment() {
    const atm = B.atmosphere({ tempC: settings.tempC, humidity: settings.humidity / 100, altitudeM: settings.altitudeM });
    const a = settings.windDir * Math.PI / 180; const sp = settings.windSpeed + (settings.gusts ? gust.v : 0);
    // windDir = direction the wind comes FROM, measured clockwise from downrange (-Z). 90° = from the right (+X) → blows toward -X.
    const wind = [-Math.sin(a) * sp, 0, Math.cos(a) * sp];
    Object.assign(envOpts, { atm: { tempC: settings.tempC, humidity: settings.humidity / 100, altitudeM: settings.altitudeM }, wind, latitudeDeg: settings.latitudeDeg, azimuthDeg: settings.azimuthDeg, coriolis: settings.coriolis, spinDrift: settings.spinDrift });
    projectiles.setEnvironment({ atm, wind, latitudeDeg: settings.latitudeDeg, azimuthDeg: settings.azimuthDeg, coriolis: settings.coriolis, spinDrift: settings.spinDrift });
    audio.state.speedOfSound = atm.c; audio.setWind(sp);
    vm.atm = atm;
    return { atm, wind };
  }
  let env = applyEnvironment();

  // ---------------------------------------------------------------- post-processing
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: lowq ? 0 : 4 }));
  const worldPass = new RenderPass(scene, camera); worldPass.clear = true;
  const viewPass = new RenderPass(viewScene, viewCam); viewPass.clear = false; viewPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 1.05);
  const output = new OutputPass();
  composer.addPass(worldPass); composer.addPass(viewPass); composer.addPass(bloom); composer.addPass(output);
  bloom.enabled = settings.postfx;

  window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); camera.aspect = viewCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); viewCam.updateProjectionMatrix(); });

  // ---------------------------------------------------------------- HUD callbacks + menu
  let paused = true;
  Object.assign(hudCb, {
    onResume: () => { paused = false; hud.showMenu(false); audio.unlock(); player.lock(); },
    onResetTargets: () => { targets.resetAll(); effects.clearTraces(); hud.message('targets reset'); },
    onSettings: (name) => {
      env = applyEnvironment(); audio.setEarPro(settings.earPro); effects.setShowTraces(settings.traces); bloom.enabled = settings.postfx; player.sensitivity = 0.0022 * settings.sensitivity;
      if (name === 'zeroRange') for (const id in vm.ws) { vm.ws[id].zeroRange = settings.zeroRange; } if (name === 'zeroRange') vm.refreshBallistics();
      hud.state.lastCalcKey = '';
    },
  });
  document.getElementById('loading').style.display = 'none';
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && !paused) { paused = true; hud.showMenu(true); } });

  // ---------------------------------------------------------------- input mapping
  vm.equip('ar15', true);
  for (const id in vm.ws) vm.ws[id].zeroRange = id === 'bolt' ? 100 : id === 'pistol' ? 25 : settings.zeroRange;
  vm.refreshBallistics();
  player.gunLength = 0.9;
  player.onMouse = (button, down) => { if (paused) return; if (button === 0) { if (down) vm.fireDown(); else vm.fireUp(); } };
  player.onKey = (k, down, e) => {
    if (!down) return;
    if (k === 'escape') { if (paused) hudCb.onResume(); else { paused = true; hud.showMenu(true); player.unlock(); } return; }
    if (paused) return;
    switch (k) {
      case '1': vm.equip('ar15'); player.gunLength = 0.9; break;
      case '2': vm.equip('pistol'); player.gunLength = 0.45; break;
      case '3': vm.equip('bolt'); player.gunLength = 1.15; break;
      case 'r': vm.reload(); break;
      case 'x': vm.chargeAction(); break;
      case 'z': vm.pressCheck(); break;
      case 'f': vm.inspect(); break;
      case 'v': vm.toggleMode(); hud.message(`mode: ${vm.state.mode.toUpperCase()}`, 1200); break;
      case 'b': { const c = vm.cycleAmmo(); hud.message(`next magazine: ${c.name}`, 2200); break; }
      case 't': settings.timeScale = settings.timeScale < 0.9 ? 1 : 0.08; audio.setTimeScale(settings.timeScale); vm.slowmo = settings.timeScale; break;
      case 'h': hud.toggleCalc(); break;
      case 'n': hud.setLRF(!hud.state.lrf, null); break;
      case 'l': settings.traces = !settings.traces; effects.setShowTraces(settings.traces); hud.syncSettings(); hud.message(`shot traces ${settings.traces ? 'on' : 'off'}`, 1200); break;
      case 'p': settings.earPro = !settings.earPro; audio.setEarPro(settings.earPro); hud.syncSettings(); hud.message(`hearing protection ${settings.earPro ? 'ON' : 'OFF'}`, 1400); break;
      case 'k': hudCb.onResetTargets(); break;
      case 'f1': hud.toggleHelp(); e.preventDefault(); break;
      case '[': vm.clickTurret('elev', -1); break;
      case ']': vm.clickTurret('elev', 1); break;
      case ';': vm.clickTurret('wind', -1); break;
      case "'": vm.clickTurret('wind', 1); break;
    }
  };
  canvas.addEventListener('wheel', (e) => { if (paused || !vm.weapon?.spec.scope) return; const S = vm.weapon.spec.scope; vm.state.scopeMag = THREE.MathUtils.clamp(vm.state.scopeMag + (e.deltaY < 0 ? 1 : -1), S.magMin, S.magMax); hud.message(`${vm.state.scopeMag}×`, 600); });
  hud.showMenu(true);

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock(); let time = 0; let frames = 0;
  const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _sp = new THREE.Vector3(), _los = new THREE.Vector3();
  let lrfTimer = 0;
  const dbg = { manual: false };
  function frame() {
    requestAnimationFrame(frame);
    const dtReal = Math.min(0.05, clock.getDelta());
    if (dbg.manual) return;
    step(dtReal); render();
  }
  function render() {
    if (settings.postfx) composer.render(); else { renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(viewScene, viewCam); }
  }
  function step(dtReal) {
    const ts = settings.timeScale; const dt = dtReal * ts; time += dt; frames++;
    // gusts (Ornstein–Uhlenbeck)
    if (settings.gusts) { gust.t += dtReal; if (gust.t > 2.5) { gust.t = 0; gust.target = (Math.random() - 0.5) * settings.windSpeed * 0.8; } gust.v += (gust.target - gust.v) * Math.min(1, dtReal * 0.4); if (frames % 20 === 0) env = applyEnvironment(); }
    // player & viewmodel
    const input = paused ? { ads: false, sprint: false, moveSpeed: 0, lookDelta: { yaw: 0, pitch: 0 }, breathHold: false, crouch: false, lean: 0, blocked: 0 } : player.update(dtReal, ts);
    player.viewKick = vm.viewKick; player.viewClimb = vm.viewClimb;
    // fov: hip → ads
    const adsFov = vm.weapon?.spec.scope ? 50 : 52;
    const fov = settings.fov + (adsFov - settings.fov) * vm.adsT;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; viewCam.fov = fov; camera.updateProjectionMatrix(); viewCam.updateProjectionMatrix(); }
    player.fovScale = (fov / settings.fov) * (vm.weapon?.spec.scope && vm.adsT > 0.5 ? 1 / (vm.state.scopeMag * 0.35) : 1);
    vm.update(dt, input);
    // view camera follows the world camera exactly
    player.update && void 0;
    camera.updateMatrixWorld(true);
    viewCam.position.copy(camera.position); viewCam.quaternion.copy(camera.quaternion); viewCam.updateMatrixWorld(true);
    vSun.position.copy(camera.position).addScaledVector(world.sunDir, 3); vSun.target.position.copy(camera.position); vSun.target.updateMatrixWorld();
    // sims
    const sub = dt > 1 / 55 ? 2 : 1; for (let i = 0; i < sub; i++) physics.step(dt / sub);
    projectiles.update(dt);
    targets.update(dt);
    effects.update(dt, { sound: (n, o) => audio.play(n, { ...o, refDistance: 2, rolloff: 1 }) });
    world.update(time, env.wind);
    // audio listener
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); _up.set(0, 1, 0).applyQuaternion(camera.quaternion); audio.setListener(camera.position, _fwd, _up);
    // laser rangefinder along the line of sight
    if (hud.state.lrf && vm.weapon) { lrfTimer += dtReal; if (lrfTimer > 0.15) { lrfTimer = 0; vm.worldLosDir(_los); vm.worldSightPoint(_sp); const h = physics.castRay(_sp, _los, 2000); hud.setLRF(true, h ? h.point.distanceTo(camera.position) : null); } }
    // optics (renders the scope RTT if needed)
    optics.update(vm);
    // HUD
    if (frames % 4 === 0) { hud.updateAmmo(vm); hud.updateTop(vm, { atm: B.atmosphere(envOpts.atm) }, env.wind); hud.updateCalc(vm, envOpts); if (hud.state.lrf && !vm.card) hud.updateCalc(vm, envOpts, true); }
  }
  frame();

  // debug / test API
  window.g = { scene, viewScene, camera, viewCam, renderer, physics, world, targets, effects, audio, projectiles, vm, player, hud, settings, weapons, optics, B,
    step, render, dbg, resume: () => hudCb.onResume(), pause: () => { paused = true; }, get paused() { return paused; }, setPaused(v) { paused = v; hud.showMenu(v); },
    /** deterministic stepping for tests: simulate `sec` seconds in fixed steps without rendering */
    advance(sec, dt = 1 / 90) { dbg.manual = true; let n = Math.round(sec / dt); while (n-- > 0) step(dt); },
    fire(hold = 0.08) { vm.fireDown(); setTimeout(() => vm.fireUp(), hold * 1000); },
    look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
  };
}
init().catch((e) => { console.error(e); const l = document.getElementById('loading'); if (l) l.textContent = 'ERROR: ' + e.message; });

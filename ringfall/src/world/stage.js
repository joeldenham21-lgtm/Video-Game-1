// Stage: the lit scene around an arena — sky theme, fog, sun + shadows, accent lights,
// reflections captured from the arena itself, ambient motes.
import * as THREE from 'three';
import { G, fxLayer } from '../state.js';
import { buildArena } from './arena.js';

let sun, hemi, vmSun, vmHemi, motes;
const accents = [];
const skyEnvCache = new Map();
const sceneEnvCache = new Map();

const ACCENT = {
  docks: { color: 0xffb070, intensity: 26 },
  garden: { color: 0xff6a70, intensity: 24 },
  heart: { color: 0x9fd8ff, intensity: 26 },
};

export function initStage() {
  const scene = G.scene;
  sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 170;
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0x8fb8ff, 0x1a1410, 0.55);
  scene.add(hemi);
  // warm practical lights at the pillars (high/ultra only; fixed count so shaders never recompile mid-fight)
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffb070, 0, 22, 2);
    l.visible = false;
    scene.add(l);
    accents.push(l);
  }
  // viewmodel lighting mirrors the world lights
  vmSun = new THREE.DirectionalLight(0xffffff, 2.0);
  vmHemi = new THREE.HemisphereLight(0x8fb8ff, 0x1a1410, 0.7);
  G.vmScene.add(vmSun, vmSun.target, vmHemi);
  motes = createMotes();
  scene.add(fxLayer(motes.points));
  G.events.on('quality', ({ q }) => {
    sun.castShadow = q.shadows > 0;
    if (q.shadows > 0) {
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    for (const l of accents) l.visible = q.accent > 0;
    G.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  });
}

export function loadStage(layoutName) {
  if (G.arena) {
    G.scene.remove(G.arena.group);
    G.arena.dispose();
  }
  const arena = buildArena(layoutName);
  G.arena = arena;
  G.world = arena.world;
  G.scene.add(arena.group);

  const theme = G.sky.setTheme(arena.theme);
  G.scene.fog = new THREE.FogExp2(theme.fog, 0.0036);
  const sd = new THREE.Vector3().fromArray(theme.sunDir).normalize();
  sun.color.set(theme.sunColor);
  sun.intensity = theme.sunI ?? 2.8;
  sun.position.copy(sd).multiplyScalar(80);
  sun.target.position.set(0, 0, 0);
  // sky light takes the planet's hue; the ground bounce is warm and dark
  hemi.color.set(theme.atmo).lerp(new THREE.Color(0xffffff), 0.45);
  hemi.groundColor.set(theme.fog).lerp(new THREE.Color(theme.bandB), 0.25).multiplyScalar(1.4);
  hemi.intensity = 1.05;
  vmSun.color.copy(sun.color); vmSun.intensity = 2.2;
  vmSun.position.copy(sd).multiplyScalar(10);
  vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = 0.85;

  // accent lights on the first four pillars (or evenly around the deck)
  const ac = ACCENT[arena.theme] || ACCENT.docks;
  const pillars = arena.layout.prims.filter(p => p.k === 'pillar').slice(0, 4);
  accents.forEach((l, i) => {
    const p = pillars[i];
    if (p) {
      const toC = Math.hypot(p.x, p.z) || 1;
      l.position.set(p.x - p.x / toC * (p.r + 0.6), p.y + Math.min(p.h * 0.55, 5), p.z - p.z / toC * (p.r + 0.6));
    } else {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      l.position.set(Math.cos(a) * 14, 4.5, Math.sin(a) * 14);
    }
    l.color.set(ac.color);
    l.intensity = pillars.length || i < 2 ? ac.intensity : 0;
    l.visible = (G.renderer.q.accent || 0) > 0;
  });

  applyEnvironment(arena, layoutName);
  motes.setColor(arena.theme);
  return arena;
}

// reflections: sky first (fast), then a capture of the finished arena so metal reflects its surroundings
function applyEnvironment(arena, layoutName) {
  let skyEnv = skyEnvCache.get(arena.theme);
  if (!skyEnv) { skyEnv = G.sky.buildEnvironment(G.renderer.gl); skyEnvCache.set(arena.theme, skyEnv); }
  G.scene.environment = skyEnv;
  G.vmScene.environment = skyEnv;
  let sceneEnv = sceneEnvCache.get(layoutName);
  if (!sceneEnv) { sceneEnv = captureEnvironment(); if (sceneEnv) sceneEnvCache.set(layoutName, sceneEnv); }
  if (sceneEnv) { G.scene.environment = sceneEnv; G.vmScene.environment = sceneEnv; }
}

// after a lost/restored WebGL context the baked reflection maps are blank: bake them again
export function rebuildEnvironment() {
  // (the old maps died with the old context; disposing them would touch stale GL handles)
  skyEnvCache.clear(); sceneEnvCache.clear();
  if (G.arena) applyEnvironment(G.arena, G.arena.name);
}

// Cube capture from head height above the deck centre, blurred into a PMREM
function captureEnvironment() {
  const gl = G.renderer.gl;
  try {
    const pmrem = new THREE.PMREMGenerator(gl);
    const skyMesh = G.sky.mesh;
    const u = G.sky.uniforms;
    const prevPos = skyMesh.position.clone();
    const hidden = [];
    // enemies/fx must not be baked in
    if (G.enemies?.group) { hidden.push([G.enemies.group, G.enemies.group.visible]); G.enemies.group.visible = false; }
    skyMesh.layers.enable(0);
    skyMesh.position.set(0, 0, 0);
    u.uSunBoost.value = 0.04; u.uStarBoost.value = 0.3;
    G.scene.position.y = -2.2;
    G.scene.updateMatrixWorld(true);
    const rt = pmrem.fromScene(G.scene, 0.015, 0.1, 1500);
    G.scene.position.y = 0;
    G.scene.updateMatrixWorld(true);
    u.uSunBoost.value = 1; u.uStarBoost.value = 1;
    skyMesh.layers.set(2);
    skyMesh.position.copy(prevPos);
    for (const [o, v] of hidden) o.visible = v;
    gl.setRenderTarget(null);
    pmrem.dispose();
    return rt.texture;
  } catch (e) {
    console.warn('environment capture failed', e);
    G.scene.position.y = 0;
    return null;
  }
}

export function updateStage(dt, time) {
  G.arena?.update(dt, time);
  // keep the shadow frustum centred near the player (snapped to avoid shimmering)
  if (G.player && sun.castShadow) {
    const sd = sun.position.clone().normalize();
    const cx = Math.round(G.player.pos.x * 0.1) * 5, cz = Math.round(G.player.pos.z * 0.1) * 5;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + sd.x * 80, sd.y * 80, cz + sd.z * 80);
  }
  // accent lights breathe very slightly, like real fixtures under load
  for (let i = 0; i < accents.length; i++) accents[i].distance = 22 + Math.sin(time * 1.3 + i) * 0.4;
  motes.update(dt, time);
}

// Floating dust motes that catch the light — cheap depth cue
function createMotes() {
  const N = 380;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 34;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 14 - 1; pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 0.8, 0.5) }, uScale: { value: 1 } },
    vertexShader: `attribute float seed; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.13 + seed * 40.0) * 1.6;
        p.y += sin(uTime * 0.21 + seed * 17.0) * 0.9;
        p.z += cos(uTime * 0.11 + seed * 23.0) * 1.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp(uScale * (0.9 + seed) * 22.0 / d, 1.0, 5.0);
        vA = smoothstep(40.0, 6.0, d) * smoothstep(0.3, 2.0, d) * (0.35 + 0.65 * sin(uTime * (0.5 + seed) + seed * 30.0) * 0.5 + 0.5);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vA; gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const COLORS = { docks: [1.0, 0.8, 0.55], garden: [1.0, 0.6, 0.55], heart: [0.6, 0.85, 1.0] };
  return {
    points,
    setColor(theme) { const c = COLORS[theme] || COLORS.docks; mat.uniforms.uColor.value.setRGB(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5); },
    update(dt, time) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uScale.value = (G.renderer?.size.h || 800) / 800 * (G.renderer?.size.dpr || 1);
    },
  };
}

export function getSun() { return sun; }

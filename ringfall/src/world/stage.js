// Stage: the lit scene around an arena — sky theme, fog, sun + shadows, reflections, ambient motes.
import * as THREE from 'three';
import { G } from '../state.js';
import { buildArena } from './arena.js';
import { SKY_THEMES } from './sky.js';

let sun, hemi, vmSun, vmHemi, motes;
const envCache = new Map();

export function initStage() {
  const scene = G.scene;
  sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0x8fb8ff, 0x1a1410, 0.55);
  scene.add(hemi);
  // viewmodel lighting mirrors the world lights
  vmSun = new THREE.DirectionalLight(0xffffff, 2.0);
  vmHemi = new THREE.HemisphereLight(0x8fb8ff, 0x1a1410, 0.7);
  G.vmScene.add(vmSun, vmSun.target, vmHemi);
  motes = createMotes();
  scene.add(motes.points);
  G.events.on('quality', ({ q }) => {
    sun.castShadow = q.shadows > 0;
    if (q.shadows > 0) {
      sun.shadow.mapSize.set(q.shadows, q.shadows);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
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
  // fog tuned to the horizon of the theme
  G.scene.fog = new THREE.FogExp2(theme.fog, 0.0042);
  const sd = new THREE.Vector3().fromArray(theme.sunDir).normalize();
  sun.color.set(theme.sunColor);
  sun.intensity = 2.5;
  sun.position.copy(sd).multiplyScalar(80);
  sun.target.position.set(0, 0, 0);
  hemi.color.set(theme.atmo).lerp(new THREE.Color(0xffffff), 0.35);
  hemi.groundColor.set(theme.fog).multiplyScalar(1.6);
  hemi.intensity = 0.95;
  vmSun.color.copy(sun.color); vmSun.intensity = 2.1;
  vmSun.position.copy(sd).multiplyScalar(10);
  vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = 0.75;

  // reflections
  let env = envCache.get(arena.theme);
  if (!env) { env = G.sky.buildEnvironment(G.renderer.gl); envCache.set(arena.theme, env); }
  G.scene.environment = env;
  G.vmScene.environment = env;
  motes.setColor(arena.theme);
  return arena;
}

export function updateStage(dt, time) {
  G.arena?.update(dt, time);
  // keep the shadow frustum centered near the player (stable texel snapping)
  if (G.player && sun.castShadow) {
    const sd = sun.position.clone().normalize();
    const cx = Math.round(G.player.pos.x * 0.1) * 5, cz = Math.round(G.player.pos.z * 0.1) * 5;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx + sd.x * 80, sd.y * 80, cz + sd.z * 80);
  }
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
        gl_PointSize = clamp(uScale * (0.9 + seed) * 26.0 / d, 1.0, 6.0);
        vA = smoothstep(40.0, 6.0, d) * smoothstep(0.3, 2.0, d) * (0.35 + 0.65 * sin(uTime * (0.5 + seed) + seed * 30.0) * 0.5 + 0.5);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vA; gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const COLORS = { docks: [1.0, 0.75, 0.45], garden: [1.0, 0.45, 0.5], heart: [0.55, 0.85, 1.0] };
  return {
    points,
    setColor(theme) { const c = COLORS[theme] || COLORS.docks; mat.uniforms.uColor.value.setRGB(c[0] * 0.9, c[1] * 0.9, c[2] * 0.9); },
    update(dt, time) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uScale.value = (G.renderer?.size.h || 800) / 800 * (G.renderer?.size.dpr || 1);
    },
  };
}

export function getSun() { return sun; }

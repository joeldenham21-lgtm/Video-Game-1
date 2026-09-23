// Procedural space sky: gas giant with rings, nebula, twinkling stars, hot white star.
// Rendered live as the scene backdrop, and once into a PMREM for metallic reflections.
import * as THREE from 'three';
import { G } from '../state.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to far plane
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uSunDir, uSunColor, uPlanetDir, uPlanetUp;
uniform float uPlanetRadius, uTime, uSunBoost, uStarBoost;
uniform vec3 uBandA, uBandB, uBandC, uAtmo, uSpaceA, uSpaceB, uNebA, uNebB, uRingA, uRingB;
varying vec3 vDir;

float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
vec3 stars(vec3 d, float scale, float thresh, float size) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  float h = hash13(cell);
  if (h < thresh) return vec3(0.0);
  vec3 sp = vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1)) * 0.7 + 0.15;
  float dist = length(fract(p) - sp);
  float bright = (h - thresh) / (1.0 - thresh);
  bright = bright * bright * 3.0 + 0.25;
  float tw = 0.7 + 0.3 * sin(uTime * (1.3 + h * 4.0) + h * 70.0);
  float s = smoothstep(size, 0.0, dist) * bright * tw;
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.82, 0.62), hash13(cell + 9.0));
  return tint * s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uSpaceB, uSpaceA, smoothstep(-0.45, 0.75, h));

  // nebula clouds and dust lanes
  float n = fbm(d * 2.1 + vec3(3.1, 1.7, 0.3));
  float n2 = fbm(d * 4.3 - vec3(1.0, 4.0, 2.0));
  float neb = smoothstep(0.42, 0.82, n);
  col += mix(uNebA, uNebB, smoothstep(0.3, 0.7, n2)) * neb * 0.55;
  col *= 1.0 - smoothstep(0.52, 0.78, n2) * 0.55 * neb;

  // galactic band
  float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.8, -0.45))) * 3.2, 2.0));
  col += uNebB * band * 0.05 * (0.6 + n);
  vec3 st = stars(d, 170.0, 0.982 - band * 0.01, 0.16) * 1.6 + stars(d, 430.0, 0.975 - band * 0.03, 0.2) * 0.7;
  col += st * uStarBoost;

  // hot white star
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (smoothstep(0.99975, 0.99988, sd) * 24.0 * uSunBoost + pow(sd, 1400.0) * 2.5 * uSunBoost + pow(sd, 90.0) * 0.18 + pow(sd, 8.0) * 0.04);

  // gas giant
  vec3 C = uPlanetDir * 1000.0;
  float R = 1000.0 * sin(uPlanetRadius);
  float b = dot(d, C);
  float disc = b * b - (dot(C, C) - R * R);
  float tPlanet = 1e9;
  if (disc > 0.0) {
    tPlanet = b - sqrt(disc);
    vec3 N = normalize(d * tPlanet - C);
    float lat = dot(N, uPlanetUp);
    vec3 side = normalize(cross(uPlanetUp, vec3(0.0, 0.0, 1.0)));
    float lon = atan(dot(N, side), dot(N, cross(uPlanetUp, side)));
    float swirl = fbm(vec3(lat * 6.0, lon * 1.5 + uTime * 0.004, 0.5));
    float bands = sin(lat * 17.0 + swirl * 3.5) * 0.5 + 0.5;
    float fine = sin(lat * 53.0 + swirl * 8.0) * 0.5 + 0.5;
    vec3 surf = mix(uBandA, uBandB, bands);
    surf = mix(surf, uBandC, fine * 0.35 + smoothstep(0.6, 0.9, swirl) * 0.4);
    // storm eye
    vec2 sp = vec2(lat - 0.28, (lon - 0.6) * 0.45);
    float storm = smoothstep(0.1, 0.0, length(sp));
    surf = mix(surf, uBandC * 1.2, storm * 0.7);
    float ndl = dot(N, uSunDir);
    float lit = smoothstep(-0.12, 0.55, ndl);
    float fres = pow(1.0 - max(dot(N, -d), 0.0), 2.5);
    vec3 pc = surf * (lit * 0.85 + 0.01) + uAtmo * fres * (0.2 + lit * 1.4);
    col = pc;
  } else {
    // atmospheric halo beyond the limb
    float cosA = clamp(dot(d, uPlanetDir), -1.0, 1.0);
    float ang = acos(cosA);
    float halo = exp(-max(ang - uPlanetRadius, 0.0) * 28.0);
    vec3 tang = d - uPlanetDir * cosA;
    float sunside = 0.25 + 0.75 * smoothstep(-0.4, 0.7, dot(normalize(tang + 1e-5), uSunDir));
    col += uAtmo * halo * sunside * 0.9;
  }

  // planetary rings
  float dn = dot(d, uPlanetUp);
  if (abs(dn) > 1e-4) {
    float t = dot(C, uPlanetUp) / dn;
    if (t > 0.0 && t < tPlanet) {
      vec3 Q = d * t;
      float rr = length(Q - C) / R;
      if (rr > 1.3 && rr < 2.45) {
        float x = (rr - 1.3) / 1.15;
        float dens = 0.55 + 0.45 * sin(x * 70.0 + sin(x * 13.0) * 2.0);
        dens *= smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.9, x);
        dens *= 1.0 - smoothstep(0.52, 0.55, x) * smoothstep(0.6, 0.57, x) * 0.9; // gap
        dens *= 0.7 + 0.3 * sin(x * 173.0 + 1.3) * sin(x * 41.0);
        vec3 oc = Q - C;
        float bb = dot(oc, uSunDir);
        float dd = bb * bb - (dot(oc, oc) - R * R);
        float shadow = (dd > 0.0 && bb < 0.0) ? 0.08 : 1.0;
        vec3 rc = mix(uRingA, uRingB, x) * (0.35 + 0.9 * max(dot(uSunDir, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0)) * shadow;
        col = mix(col, rc * 1.3, clamp(dens * 0.85, 0.0, 1.0));
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export const SKY_THEMES = {
  docks: {
    sunDir: [0.62, 0.4, 0.67], sunColor: 0xfff1dc,
    planetDir: [-0.52, 0.28, -0.8], planetRadius: 0.36, planetUp: [0.28, 0.93, 0.22],
    bandA: 0x2c5f78, bandB: 0x8fc0c8, bandC: 0xe8d9b8, atmo: 0x5fc8ff,
    spaceA: 0x020309, spaceB: 0x0b1424, nebA: 0x1c3a66, nebB: 0x5a2a6e, ringA: 0xc9bca0, ringB: 0x6a7f94,
    fog: 0x0e1726,
  },
  garden: {
    sunDir: [-0.3, 0.5, 0.81], sunColor: 0xffc49a,
    planetDir: [0.45, 0.2, -0.87], planetRadius: 0.42, planetUp: [-0.35, 0.9, 0.25],
    bandA: 0x6e2a1c, bandB: 0xd68a4a, bandC: 0xf2d6a8, atmo: 0xff7a4a,
    spaceA: 0x050208, spaceB: 0x1d0a14, nebA: 0x5a1430, nebB: 0x2a1a6a, ringA: 0xd9a57a, ringB: 0x7a4a5a,
    fog: 0x1c0c14,
  },
  heart: {
    sunDir: [0.3, 0.62, -0.72], sunColor: 0xd8f4ff,
    planetDir: [0.0, 0.5, -0.86], planetRadius: 0.5, planetUp: [0.15, 0.95, 0.27],
    bandA: 0x1a2440, bandB: 0x5a6ab0, bandC: 0xd6e6ff, atmo: 0x9ad8ff,
    spaceA: 0x010208, spaceB: 0x0a1030, nebA: 0x183070, nebB: 0x5a1a80, ringA: 0xdfe8ff, ringB: 0x8a9ac8,
    fog: 0x0a0f24,
  },
};

export function createSky(quality = 'high') {
  const octaves = quality === 'low' || quality === 'medium' ? 3 : 4;
  const uniforms = {
    uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uPlanetDir: { value: new THREE.Vector3() }, uPlanetUp: { value: new THREE.Vector3() },
    uPlanetRadius: { value: 0.35 }, uTime: { value: 0 }, uSunBoost: { value: 1 }, uStarBoost: { value: 1 },
    uBandA: { value: new THREE.Color() }, uBandB: { value: new THREE.Color() }, uBandC: { value: new THREE.Color() },
    uAtmo: { value: new THREE.Color() }, uSpaceA: { value: new THREE.Color() }, uSpaceB: { value: new THREE.Color() },
    uNebA: { value: new THREE.Color() }, uNebB: { value: new THREE.Color() },
    uRingA: { value: new THREE.Color() }, uRingB: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms, side: THREE.BackSide,
    depthWrite: false, depthTest: true, defines: { OCTAVES: octaves },
  });
  const geo = new THREE.SphereGeometry(1000, 48, 24);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  let theme = null;
  let envRT = null;

  function setTheme(name) {
    theme = SKY_THEMES[name] || SKY_THEMES.docks;
    uniforms.uSunDir.value.fromArray(theme.sunDir).normalize();
    uniforms.uSunColor.value.set(theme.sunColor);
    uniforms.uPlanetDir.value.fromArray(theme.planetDir).normalize();
    uniforms.uPlanetUp.value.fromArray(theme.planetUp).normalize();
    uniforms.uPlanetRadius.value = theme.planetRadius;
    for (const k of ['bandA', 'bandB', 'bandC', 'atmo', 'spaceA', 'spaceB', 'nebA', 'nebB', 'ringA', 'ringB']) {
      uniforms['u' + k[0].toUpperCase() + k.slice(1)].value.set(theme[k]);
    }
    return theme;
  }

  // Environment map for reflections (dimmer sun/stars to avoid fireflies)
  function buildEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(geo, material);
    envMesh.frustumCulled = false;
    envScene.add(envMesh);
    uniforms.uSunBoost.value = 0.05;
    uniforms.uStarBoost.value = 0.0;
    const prev = renderer.getRenderTarget();
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.02, 1, 2000);
    renderer.setRenderTarget(prev);
    uniforms.uSunBoost.value = 1;
    uniforms.uStarBoost.value = 1;
    pmrem.dispose();
    return envRT.texture;
  }

  function update(camera, time) {
    mesh.position.copy(camera.position);
    uniforms.uTime.value = time;
  }

  return { mesh, uniforms, setTheme, buildEnvironment, update, get theme() { return theme; } };
}

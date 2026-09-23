// Renderer + post-processing.
//   depth prepass (half res) → SSAO + bilateral blur → world render (HDR, MSAA) → AO multiply →
//   viewmodel → dual-filter bloom → sun shafts → AgX filmic composite.
// Quality tiers pick which stages run; dynamic resolution keeps frame times steady.
import * as THREE from 'three';
import { G, FX_LAYER } from '../state.js';
import { clamp } from '../util.js';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
vec3 fetch(vec2 uv) { return min(texture2D(tSrc, uv).rgb, vec3(24.0)); }
void main() {
  vec3 a = fetch(vUv + uTexel * vec2(-1.0, -1.0));
  vec3 b = fetch(vUv + uTexel * vec2( 1.0, -1.0));
  vec3 c = fetch(vUv + uTexel * vec2(-1.0,  1.0));
  vec3 d = fetch(vUv + uTexel * vec2( 1.0,  1.0));
  // Karis average suppresses single-pixel fireflies
  float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b)));
  float wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b)));
  float wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
  float wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(col * contrib, 1.0);
}`;

const DOWN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uBaseMix;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  s += texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2( 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(0.0,  2.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 2.0;
  s += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tBase, vUv).rgb * uBaseMix, 1.0);
}`;

// Scalable ambient occlusion: hemisphere samples in view space, normals rebuilt from depth.
const SSAO_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv; uniform vec2 uTexel;
uniform float uRadius, uIntensity, uBias; uniform vec3 uKernel[SAMPLES];
varying vec2 vUv;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 pr = viewPos(vUv + vec2(uTexel.x, 0.0)), pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, uTexel.y)), pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ang = n * 6.2831853;
  vec3 rv = vec3(cos(ang), sin(ang), 0.0);
  vec3 T = normalize(rv - N * dot(rv, N));
  vec3 B = cross(N, T);
  float radius = uRadius * clamp(-P.z / 6.0, 0.5, 2.5); // wider in the distance, tight up close
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    vec3 k = uKernel[i];
    vec3 S = P + (T * k.x + B * k.y + N * k.z) * radius;
    vec4 clip = uProj * vec4(S, 1.0);
    vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, radius / max(abs(P.z - sz), 1e-3));
    occ += step(S.z + uBias, sz) * range;
  }
  float ao = 1.0 - occ / float(SAMPLES) * uIntensity;
  gl_FragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
}`;

const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uDir; uniform float uNear, uFar;
varying vec2 vUv;
float lin(vec2 uv) { float d = texture2D(tDepth, uv).x; return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main() {
  float zc = lin(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float w = exp(-float(i * i) * 0.18) * exp(-abs(lin(uv) - zc) / (0.08 * zc + 0.05));
    sum += texture2D(tAO, uv).r * w; wsum += w;
  }
  gl_FragColor = vec4(vec3(sum / wsum), 1.0);
}`;

// Multiplies ambient occlusion into the world before the viewmodel is drawn on top
const AO_APPLY_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAO; uniform float uStrength;
varying vec2 vUv;
void main() { float ao = texture2D(tAO, vUv).r; gl_FragColor = vec4(vec3(mix(1.0, ao, uStrength)), 1.0); }`;

// Crepuscular rays: march from each pixel toward the star, gathering bright sky (depth-masked)
const SHAFT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uDensity, uDecay, uThreshold;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 delta = (uv - uSun) * (uDensity / float(STEPS));
  vec3 acc = vec3(0.0);
  float illum = 1.0;
  for (int i = 0; i < STEPS; i++) {
    uv -= delta;
    float sky = step(0.99995, texture2D(tDepth, uv).x);
    vec3 c = min(texture2D(tScene, uv).rgb, vec3(10.0));
    float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - uThreshold, 0.0);
    acc += c * (l / (l + uThreshold)) * sky * illum;
    illum *= uDecay;
  }
  gl_FragColor = vec4(acc / float(STEPS), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tShafts;
uniform vec2 uSceneTexel; uniform vec2 uRes;
uniform float uBloom, uExposure, uVignette, uChroma, uTime, uSharpen, uShafts, uGrain;
uniform float uDamage, uOverdrive, uFade, uLowHealth, uFlash, uSaturation, uContrast;
uniform vec3 uLift, uGain, uFadeColor, uFlashColor, uShaftColor;
varying vec2 vUv;

// AgX filmic tone mapping (Sobotka) with a mild "punchy" look — natural highlight roll-off, no neon clipping
const mat3 SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 R2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AGX_IN = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AGX_OUT = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  c = SRGB_TO_2020 * c;
  c = AGX_IN * c;
  c = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
  c = agxContrast(c);
  // look: gentle contrast + saturation in the display domain
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(c, 0.0), vec3(uContrast));
  c = l + (c - l) * uSaturation;
  c = AGX_OUT * c;
  c = pow(max(c, 0.0), vec3(2.2));
  c = R2020_TO_SRGB * c;
  return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float r2 = dot(dc, dc);
  float ca = uChroma * (0.35 + r2 * 2.0) * 0.012;
  vec3 col;
  if (ca > 0.00005) {
    col.r = texture2D(tScene, uv - dc * ca).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv + dc * ca).b;
  } else {
    col = texture2D(tScene, uv).rgb;
  }
  if (uOverdrive > 0.01) {
    vec3 acc = col;
    for (int i = 1; i <= 3; i++) {
      float k = float(i) * 0.012 * uOverdrive * (0.3 + r2 * 3.0);
      acc += texture2D(tScene, uv - dc * k).rgb;
    }
    col = mix(col, acc * 0.25, 0.8);
  }
  if (uSharpen > 0.001) {
    vec3 n = texture2D(tScene, uv + vec2(0.0, uSceneTexel.y)).rgb + texture2D(tScene, uv - vec2(0.0, uSceneTexel.y)).rgb
           + texture2D(tScene, uv + vec2(uSceneTexel.x, 0.0)).rgb + texture2D(tScene, uv - vec2(uSceneTexel.x, 0.0)).rgb;
    col = max(col + (col * 4.0 - n) * uSharpen * 0.25, 0.0);
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  if (uShafts > 0.001) col += texture2D(tShafts, uv).rgb * uShafts * uShaftColor;
  col *= uExposure;
  col += uFlashColor * uFlash;

  vec3 mapped = agx(col);
  float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  mapped = mix(vec3(luma), mapped, 1.0 - uOverdrive * 0.5);
  mapped = mapped * uGain + uLift * (1.0 - mapped);
  mapped = mix(mapped, mapped * vec3(0.8, 1.0, 1.1) + vec3(0.0, 0.012, 0.025), uOverdrive * 0.8);

  float vig = smoothstep(0.9, 0.18, r2 * (1.0 + uVignette));
  mapped *= mix(1.0, vig, 0.5 + uVignette * 0.25);
  float edge = smoothstep(0.08, 0.5, r2);
  mapped = mix(mapped, vec3(0.55, 0.02, 0.04), edge * clamp(uDamage, 0.0, 1.0) * 0.7);
  mapped = mix(mapped, vec3(0.35, 0.0, 0.02), edge * uLowHealth * 0.45);
  mapped = mix(mapped, uFadeColor, uFade);

  vec3 outc = toSRGB(clamp(mapped, 0.0, 1.0));
  // fine film grain in display space (in linear space the sRGB curve blows it up in the shadows)
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 413.0) - 0.5;
  outc += g * uGrain * (1.0 - dot(outc, vec3(0.333)) * 0.6);
  outc += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
}`;

// maxPixels: internal render budget (megapixels); dpr: canvas pixel-ratio cap; ao: 0 off / 1 / 2 samples tier
const QUALITY = {
  low:    { maxPixels: 0.55, dpr: 1.25, msaa: 0, bloomLevels: 4, shadows: 0,    lights: 2, accent: 0, particles: 0.6,  ao: 0, shafts: 0, tex: 512,  physical: false, grain: 0 },
  medium: { maxPixels: 1.0,  dpr: 1.75, msaa: 4, bloomLevels: 5, shadows: 1024, lights: 2, accent: 0, particles: 0.85, ao: 0, shafts: 1, tex: 512,  physical: false, grain: 0.014 },
  high:   { maxPixels: 2.1,  dpr: 2.0,  msaa: 4, bloomLevels: 5, shadows: 2048, lights: 4, accent: 4, particles: 1,    ao: 1, shafts: 1, tex: 1024, physical: true,  grain: 0.018 },
  ultra:  { maxPixels: 3.9,  dpr: 2.0,  msaa: 4, bloomLevels: 6, shadows: 4096, lights: 4, accent: 4, particles: 1,    ao: 2, shafts: 1, tex: 1024, physical: true,  grain: 0.018 },
};

// Picks a starting quality from the GPU name (the adaptive scaler still guards frame rate)
export function detectGpuTier(isTouch) {
  let name = '';
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = ctx && ctx.getExtension('WEBGL_debug_renderer_info');
    name = (dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx?.getParameter(ctx.RENDERER)) || '';
    ctx?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* ignore */ }
  const n = name.toLowerCase();
  let tier;
  if (/rtx|radeon rx|rx [5-9]\d{3}|arc a\d|apple m\d|gtx 1[06-9]\d0|gtx 16/.test(n)) tier = 'ultra';
  else if (/adreno.*(7[3-9]\d|8\d\d)|immortalis|mali-g(7[1-9]|[89]\d\d?|1\d\d\d?)|xclipse|apple gpu|nvidia|radeon/.test(n)) tier = 'high';
  else if (/adreno.*(6[4-9]\d|7[0-2]\d)|mali-g(5\d|6\d)|intel.*(iris|arc|xe)/.test(n)) tier = isTouch ? 'medium' : 'high';
  else if (/swiftshader|llvmpipe|software/.test(n)) tier = 'low';
  else tier = isTouch ? 'medium' : 'high';
  return { tier, name };
}

export function createRenderer(canvas) {
  const gl = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, stencil: false, depth: true,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  gl.toneMapping = THREE.NoToneMapping;
  gl.outputColorSpace = THREE.LinearSRGBColorSpace; // the composite pass encodes sRGB itself
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.autoClear = false;
  gl.info.autoReset = false;

  const caps = gl.capabilities;
  const quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
  quad.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
  const prefilterMat = mat(PREFILTER_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 2.2 }, uKnee: { value: 0.9 } });
  const downMat = mat(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const upMat = mat(UP_FRAG, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uBaseMix: { value: 1 } });
  const kernel = (n) => Array.from({ length: n }, (_, i) => {
    // hemisphere kernel, denser near the origin
    const a = i * 2.39996 + 0.5, z = 0.15 + 0.85 * ((i * 0.618034) % 1);
    const r = Math.sqrt(1 - z * z);
    let s = (i + 1) / n; s = 0.12 + 0.88 * s * s;
    return new THREE.Vector3(Math.cos(a) * r * s, Math.sin(a) * r * s, z * s);
  });
  const ssaoMats = {
    1: mat(SSAO_FRAG, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.7 }, uIntensity: { value: 1.25 }, uBias: { value: 0.03 }, uKernel: { value: kernel(10) } }, { defines: { SAMPLES: 10 } }),
    2: mat(SSAO_FRAG, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.7 }, uIntensity: { value: 1.25 }, uBias: { value: 0.03 }, uKernel: { value: kernel(16) } }, { defines: { SAMPLES: 16 } }),
  };
  const blurMat = mat(BLUR_FRAG, { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNear: { value: 0.05 }, uFar: { value: 1600 } });
  const aoApplyMat = mat(AO_APPLY_FRAG, { tAO: { value: null }, uStrength: { value: 0.85 } }, {
    transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const shaftMat = mat(SHAFT_FRAG, { tScene: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uDensity: { value: 0.9 }, uDecay: { value: 0.965 }, uThreshold: { value: 1.2 } }, { defines: { STEPS: 40 } });
  const compositeMat = mat(COMPOSITE_FRAG, {
    tScene: { value: null }, tBloom: { value: null }, tShafts: { value: null },
    uSceneTexel: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() },
    uBloom: { value: 0.32 }, uExposure: { value: 1.3 }, uVignette: { value: 0.0 }, uChroma: { value: 0.0 },
    uTime: { value: 0 }, uSharpen: { value: 0 }, uDamage: { value: 0 }, uOverdrive: { value: 0 },
    uFade: { value: 0 }, uLowHealth: { value: 0 }, uFlash: { value: 0 }, uSaturation: { value: 1.12 }, uContrast: { value: 1.12 },
    uShafts: { value: 0 }, uShaftColor: { value: new THREE.Color(1, 0.93, 0.82) }, uGrain: { value: 0.016 },
    uLift: { value: new THREE.Vector3(0.006, 0.008, 0.014) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uFadeColor: { value: new THREE.Color(0, 0, 0) }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
  });
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.needsUpdate = true;
  compositeMat.uniforms.tShafts.value = blackTex;

  // HDR targets need float colour-buffer support; very old mobile GPUs fall back to 8-bit
  const ext = gl.extensions;
  const hdrOK = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const halfFloat = hdrOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
  if (!hdrOK) { prefilterMat.uniforms.uThreshold.value = 0.85; prefilterMat.uniforms.uKnee.value = 0.3; }

  let sceneRT = null, depthRT = null, aoRT = null, aoTmp = null, shaftRT = null;
  let down = [], up = [];
  let q = QUALITY.high;
  let qualityName = 'high';
  let cssW = 1, cssH = 1, dpr = 1;
  let renderScale = 1;          // dynamic resolution factor (0.55..1)
  let baseScale = 1;            // resolution factor from the pixel budget
  let rtW = 1, rtH = 1;
  let autoQuality = true;
  let ftAcc = 0, ftCount = 0, ftTimer = 0, stableTimer = 0, slowTimer = 0;
  let lastDownscaleAt = -100;
  const depthCam = new THREE.PerspectiveCamera();
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const sunV = new THREE.Vector3(), camDir = new THREE.Vector3();

  function makeRT(w, h, samples, type = halfFloat) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type, format: THREE.RGBAFormat, depthBuffer: samples !== -1, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      samples: Math.max(0, samples),
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  const needDepth = () => q.ao > 0 || q.shafts > 0;

  function allocTargets() {
    const w = Math.max(2, Math.round(cssW * dpr * baseScale * renderScale));
    const h = Math.max(2, Math.round(cssH * dpr * baseScale * renderScale));
    const key = `${w}x${h}/${q.msaa}/${q.bloomLevels}/${q.ao}/${q.shafts}`;
    if (sceneRT && sceneRT._key === key) return;
    rtW = w; rtH = h;
    for (const t of [sceneRT, depthRT, aoRT, aoTmp, shaftRT, ...down, ...up]) t?.dispose();
    depthRT = aoRT = aoTmp = shaftRT = null;
    down = []; up = [];
    sceneRT = makeRT(w, h, caps.isWebGL2 ? q.msaa : 0);
    sceneRT._key = key;
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < q.bloomLevels; i++) {
      down.push(makeRT(bw, bh, -1));
      if (i < q.bloomLevels - 1) up.push(makeRT(bw, bh, -1));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    if (needDepth()) {
      const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
      depthRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
      depthRT.depthTexture = new THREE.DepthTexture(hw, hh, caps.isWebGL2 ? THREE.FloatType : THREE.UnsignedIntType);
      depthRT.depthTexture.minFilter = depthRT.depthTexture.magFilter = THREE.NearestFilter;
      if (q.ao) { aoRT = makeRT(hw, hh, -1, THREE.UnsignedByteType); aoTmp = makeRT(hw, hh, -1, THREE.UnsignedByteType); }
      if (q.shafts) shaftRT = makeRT(Math.max(2, w >> 2), Math.max(2, h >> 2), -1);
    }
  }

  function resize() {
    cssW = Math.max(1, Math.round(canvas.clientWidth || window.innerWidth));
    cssH = Math.max(1, Math.round(canvas.clientHeight || window.innerHeight));
    dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    gl.setPixelRatio(dpr);
    gl.setSize(cssW, cssH, false);
    const px = cssW * cssH * dpr * dpr / 1e6;
    baseScale = clamp(Math.sqrt(q.maxPixels / px), 0.35, 1);
    allocTargets();
    if (G.camera) { G.camera.aspect = cssW / cssH; G.camera.updateProjectionMatrix(); }
    if (G.vmCamera) { G.vmCamera.aspect = cssW / cssH; G.vmCamera.updateProjectionMatrix(); }
  }

  function setQuality(name, auto = autoQuality) {
    autoQuality = auto;
    qualityName = QUALITY[name] ? name : 'high';
    q = QUALITY[qualityName];
    renderScale = 1;
    gl.shadowMap.enabled = q.shadows > 0;
    gl.shadowMap.type = q.shadows >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    compositeMat.uniforms.uGrain.value = q.grain;
    G.events.emit('quality', { name: qualityName, q });
    resize();
  }

  function pass(material, target) {
    quad.material = material;
    gl.setRenderTarget(target);
    gl.render(quadScene, quadCam);
  }

  const post = compositeMat.uniforms;

  function render(scene, camera, vmScene, vmCamera) {
    gl.info.reset();
    const depth = needDepth() && depthRT;
    // 1) depth prepass (world geometry only; effects and sky live on FX_LAYER)
    if (depth) {
      depthCam.copy(camera);
      depthCam.layers.set(0);
      scene.overrideMaterial = depthOnly;
      const sa = gl.shadowMap.autoUpdate;
      gl.shadowMap.autoUpdate = false;
      gl.setRenderTarget(depthRT);
      gl.setClearColor(0x000000, 1);
      gl.clear(true, true, false);
      gl.render(scene, depthCam);
      gl.shadowMap.autoUpdate = sa;
      scene.overrideMaterial = null;
      if (gl.shadowMap.enabled) gl.shadowMap.needsUpdate = true;
    }
    // 2) ambient occlusion
    if (depth && q.ao && aoRT) {
      const m = ssaoMats[q.ao];
      m.uniforms.tDepth.value = depthRT.depthTexture;
      m.uniforms.uProj.value.copy(camera.projectionMatrix);
      m.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      m.uniforms.uTexel.value.set(1 / depthRT.width, 1 / depthRT.height);
      pass(m, aoRT);
      blurMat.uniforms.tDepth.value = depthRT.depthTexture;
      blurMat.uniforms.uNear.value = camera.near; blurMat.uniforms.uFar.value = camera.far;
      blurMat.uniforms.tAO.value = aoRT.texture;
      blurMat.uniforms.uDir.value.set(1.4 / aoRT.width, 0);
      pass(blurMat, aoTmp);
      blurMat.uniforms.tAO.value = aoTmp.texture;
      blurMat.uniforms.uDir.value.set(0, 1.4 / aoRT.height);
      pass(blurMat, aoRT);
    }
    // 3) world (HDR, MSAA), AO multiplied in before the viewmodel
    gl.setRenderTarget(sceneRT);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    gl.render(scene, camera);
    if (depth && q.ao && aoRT) {
      aoApplyMat.uniforms.tAO.value = aoRT.texture;
      quad.material = aoApplyMat;
      gl.render(quadScene, quadCam);
    }
    if (vmScene) {
      gl.clearDepth();
      gl.render(vmScene, vmCamera);
    }
    // 4) bloom
    prefilterMat.uniforms.tSrc.value = sceneRT.texture;
    prefilterMat.uniforms.uTexel.value.set(0.5 / rtW, 0.5 / rtH);
    pass(prefilterMat, down[0]);
    for (let i = 1; i < down.length; i++) {
      downMat.uniforms.tSrc.value = down[i - 1].texture;
      downMat.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
      pass(downMat, down[i]);
    }
    let src = down[down.length - 1];
    for (let i = down.length - 2; i >= 0; i--) {
      upMat.uniforms.tSrc.value = src.texture;
      upMat.uniforms.tBase.value = down[i].texture;
      upMat.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      upMat.uniforms.uBaseMix.value = 0.9;
      pass(upMat, up[i]);
      src = up[i];
    }
    // 5) sun shafts when the star is on or near the screen
    post.uShafts.value = 0;
    if (depth && q.shafts && shaftRT && G.sky) {
      sunV.copy(G.sky.uniforms.uSunDir.value).multiplyScalar(800).add(camera.position);
      camera.getWorldDirection(camDir);
      const facing = camDir.dot(G.sky.uniforms.uSunDir.value);
      if (facing > 0.15) {
        sunV.project(camera);
        const sx = sunV.x * 0.5 + 0.5, sy = sunV.y * 0.5 + 0.5;
        const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
        const vis = clamp((0.95 - off) / 0.45, 0, 1) * clamp((facing - 0.15) / 0.35, 0, 1);
        if (vis > 0.01) {
          shaftMat.uniforms.tScene.value = sceneRT.texture;
          shaftMat.uniforms.tDepth.value = depthRT.depthTexture;
          shaftMat.uniforms.uSun.value.set(sx, sy);
          pass(shaftMat, shaftRT);
          post.tShafts.value = shaftRT.texture;
          post.uShafts.value = vis * 0.55 * (G.sky.theme?.shafts ?? 1);
        }
      }
    }
    // 6) composite
    post.tScene.value = sceneRT.texture;
    post.tBloom.value = src.texture;
    post.uSceneTexel.value.set(1 / rtW, 1 / rtH);
    post.uRes.value.set(cssW * dpr, cssH * dpr);
    post.uTime.value = G.time;
    const upscale = (cssW * dpr) / rtW;
    post.uSharpen.value = clamp((upscale - 1) * 0.6, 0, 0.45) + (qualityName === 'ultra' || qualityName === 'high' ? 0.08 : 0);
    pass(compositeMat, null);
  }

  // Called once per frame with the raw frame time; adapts the internal resolution.
  function adapt(frameMs) {
    if (!autoQuality) return;
    // hitches (tab switch, shader compile, GC) aren't a sustained load: drop the window
    if (frameMs > 250) { ftAcc = 0; ftCount = 0; ftTimer = 0; return; }
    ftAcc += frameMs; ftCount++; ftTimer += frameMs;
    if (ftTimer < 1000) return;
    const avg = ftAcc / ftCount;
    ftAcc = 0; ftCount = 0; ftTimer = 0;
    if (document.hidden) return;
    const now = performance.now() / 1000;
    if (avg > 21 && renderScale > 0.6) {
      renderScale = Math.max(0.6, renderScale - (avg > 30 ? 0.15 : 0.08));
      lastDownscaleAt = now;
      stableTimer = 0;
      allocTargets();
    } else if (avg > 30 && renderScale <= 0.6 && qualityName !== 'low') {
      // still struggling at minimum scale for a few seconds: step quality down
      if (++slowTimer >= 3) {
        slowTimer = 0;
        const order = ['low', 'medium', 'high', 'ultra'];
        setQuality(order[Math.max(0, order.indexOf(qualityName) - 1)], true);
      }
    } else if (avg < 17.6) {
      slowTimer = 0;
      stableTimer++;
      if (renderScale < 1 && stableTimer >= 4 && now - lastDownscaleAt > 6) {
        renderScale = Math.min(1, renderScale + 0.05);
        stableTimer = 0;
        allocTargets();
      }
    } else {
      stableTimer = 0; slowTimer = 0;
    }
  }

  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  return {
    gl, post, render, resize, setQuality, adapt,
    get quality() { return qualityName; },
    get q() { return q; },
    get renderScale() { return renderScale * baseScale; },
    get size() { return { w: cssW, h: cssH, dpr }; },
    set auto(v) { autoQuality = v; },
    QUALITY,
  };
}

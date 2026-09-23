// Renderer + post-processing: HDR scene target (MSAA), dual-filter bloom, filmic composite.
// Dynamic resolution keeps frame times steady on phones.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp } from '../util.js';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
vec3 fetch(vec2 uv) { return texture2D(tSrc, uv).rgb; }
void main() {
  // 4-tap box downsample with Karis-style firefly suppression
  vec3 a = fetch(vUv + uTexel * vec2(-1.0, -1.0));
  vec3 b = fetch(vUv + uTexel * vec2( 1.0, -1.0));
  vec3 c = fetch(vUv + uTexel * vec2(-1.0,  1.0));
  vec3 d = fetch(vUv + uTexel * vec2( 1.0,  1.0));
  float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b)));
  float wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b)));
  float wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
  float wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(col * contrib, vec3(64.0)), 1.0);
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

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform vec2 uSceneTexel; uniform vec2 uRes;
uniform float uBloom, uExposure, uVignette, uChroma, uTime, uSharpen;
uniform float uDamage, uOverdrive, uFade, uLowHealth, uFlash, uSaturation;
uniform vec3 uLift, uGain, uFadeColor, uFlashColor;
varying vec2 vUv;

vec3 aces(vec3 x) {
  // Stephen Hill fitted ACES (sRGB -> AP1 RRT+ODT approximation)
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float r2 = dot(dc, dc);
  // chromatic aberration grows toward the edges
  float ca = uChroma * (0.35 + r2 * 2.0) * 0.012;
  vec3 col;
  if (ca > 0.00005) {
    col.r = texture2D(tScene, uv - dc * ca).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv + dc * ca).b;
  } else {
    col = texture2D(tScene, uv).rgb;
  }
  // overdrive: radial smear toward edges
  if (uOverdrive > 0.01) {
    vec3 acc = col;
    for (int i = 1; i <= 3; i++) {
      float k = float(i) * 0.012 * uOverdrive * (0.3 + r2 * 3.0);
      acc += texture2D(tScene, uv - dc * k).rgb;
    }
    col = mix(col, acc * 0.25, 0.8);
  }
  // light sharpen to recover detail when upscaling from a lower internal resolution
  if (uSharpen > 0.001) {
    vec3 n = texture2D(tScene, uv + vec2(0.0, uSceneTexel.y)).rgb + texture2D(tScene, uv - vec2(0.0, uSceneTexel.y)).rgb
           + texture2D(tScene, uv + vec2(uSceneTexel.x, 0.0)).rgb + texture2D(tScene, uv - vec2(uSceneTexel.x, 0.0)).rgb;
    col = max(col + (col * 4.0 - n) * uSharpen * 0.25, 0.0);
  }
  vec3 bloom = texture2D(tBloom, uv).rgb;
  col += bloom * uBloom;
  col *= uExposure;
  col += uFlashColor * uFlash;

  vec3 mapped = aces(col);
  // grade: lift/gain + saturation
  float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  float sat = uSaturation * (1.0 - uOverdrive * 0.55);
  mapped = mix(vec3(luma), mapped, sat);
  mapped = mapped * uGain + uLift * (1.0 - mapped);
  // overdrive tint (cold highlights, warm glow retained)
  mapped = mix(mapped, mapped * vec3(0.78, 1.02, 1.12) + vec3(0.0, 0.015, 0.03), uOverdrive * 0.8);

  // vignette + damage + low health pulse
  float vig = smoothstep(0.85, 0.2, r2 * (1.0 + uVignette));
  mapped *= mix(1.0, vig, 0.55 + uVignette * 0.25);
  float edge = smoothstep(0.08, 0.5, r2);
  mapped = mix(mapped, vec3(0.55, 0.02, 0.04), edge * clamp(uDamage, 0.0, 1.0) * 0.75);
  mapped = mix(mapped, vec3(0.35, 0.0, 0.02), edge * uLowHealth * 0.45);
  mapped = mix(mapped, uFadeColor, uFade);

  vec3 outc = toSRGB(clamp(mapped, 0.0, 1.0));
  outc += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) / 255.0; // dither vs banding
  gl_FragColor = vec4(outc, 1.0);
}`;

const QUALITY = {
  // maxPixels: internal render budget (megapixels); dpr: canvas pixel ratio cap
  low:    { maxPixels: 0.55, dpr: 1.25, msaa: 0, bloomLevels: 4, shadows: 0,    lights: 2, particles: 0.6 },
  medium: { maxPixels: 1.0,  dpr: 1.75, msaa: 4, bloomLevels: 5, shadows: 1024, lights: 2, particles: 0.85 },
  high:   { maxPixels: 2.1,  dpr: 2.0,  msaa: 4, bloomLevels: 5, shadows: 2048, lights: 4, particles: 1 },
  ultra:  { maxPixels: 3.8,  dpr: 2.0,  msaa: 4, bloomLevels: 6, shadows: 2048, lights: 4, particles: 1 },
};

export function createRenderer(canvas) {
  const gl = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, stencil: false, depth: true,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  gl.toneMapping = THREE.NoToneMapping;
  gl.outputColorSpace = THREE.LinearSRGBColorSpace; // composite shader encodes sRGB itself
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

  const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const prefilterMat = mat(PREFILTER_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.35 }, uKnee: { value: 0.5 } });
  const downMat = mat(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const upMat = mat(UP_FRAG, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uBaseMix: { value: 1 } });
  const compositeMat = mat(COMPOSITE_FRAG, {
    tScene: { value: null }, tBloom: { value: null },
    uSceneTexel: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() },
    uBloom: { value: 0.7 }, uExposure: { value: 1.0 }, uVignette: { value: 0.0 }, uChroma: { value: 0.0 },
    uTime: { value: 0 }, uSharpen: { value: 0 }, uDamage: { value: 0 }, uOverdrive: { value: 0 },
    uFade: { value: 0 }, uLowHealth: { value: 0 }, uFlash: { value: 0 }, uSaturation: { value: 1.08 },
    uLift: { value: new THREE.Vector3(0.01, 0.012, 0.02) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uFadeColor: { value: new THREE.Color(0, 0, 0) }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
  });

  // HDR targets need float colour-buffer support; very old mobile GPUs fall back to 8-bit (bloom threshold lowered)
  const ext = gl.extensions;
  const hdrOK = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const halfFloat = hdrOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
  if (!hdrOK) { prefilterMat.uniforms.uThreshold.value = 0.82; prefilterMat.uniforms.uKnee.value = 0.3; }
  let sceneRT = null;
  let down = [], up = [];
  let q = QUALITY.high;
  let qualityName = 'high';
  let cssW = 1, cssH = 1, dpr = 1;
  let renderScale = 1;          // dynamic resolution factor (0.5..1)
  let baseScale = 1;            // resolution factor from pixel budget
  let rtW = 1, rtH = 1;
  let autoQuality = true;

  // Frame timing for dynamic resolution
  let ftAcc = 0, ftCount = 0, ftTimer = 0, stableTimer = 0;
  let lastDownscaleAt = -100;

  function makeRT(w, h, samples) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: halfFloat, format: THREE.RGBAFormat, depthBuffer: samples !== -1, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      samples: Math.max(0, samples),
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  function allocTargets() {
    const w = Math.max(2, Math.round(cssW * dpr * baseScale * renderScale));
    const h = Math.max(2, Math.round(cssH * dpr * baseScale * renderScale));
    if (sceneRT && w === rtW && h === rtH && sceneRT.samples === (caps.isWebGL2 ? q.msaa : 0) && down.length === q.bloomLevels) return;
    rtW = w; rtH = h;
    if (sceneRT) sceneRT.dispose();
    down.forEach(t => t.dispose()); up.forEach(t => t.dispose());
    down = []; up = [];
    sceneRT = makeRT(w, h, caps.isWebGL2 ? q.msaa : 0);
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < q.bloomLevels; i++) {
      down.push(makeRT(bw, bh, -1));
      if (i < q.bloomLevels - 1) up.push(makeRT(bw, bh, -1));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
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
    if (G.camera) {
      G.camera.aspect = cssW / cssH;
      G.camera.updateProjectionMatrix();
    }
    if (G.vmCamera) {
      G.vmCamera.aspect = cssW / cssH;
      G.vmCamera.updateProjectionMatrix();
    }
  }

  function setQuality(name, auto = autoQuality) {
    autoQuality = auto;
    qualityName = QUALITY[name] ? name : 'high';
    q = QUALITY[qualityName];
    renderScale = 1;
    gl.shadowMap.enabled = q.shadows > 0;
    // soft PCF only where there's GPU to spare
    gl.shadowMap.type = q.shadows >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
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
    gl.setRenderTarget(sceneRT);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    gl.render(scene, camera);
    if (vmScene) {
      gl.clearDepth();
      gl.render(vmScene, vmCamera);
    }
    // bloom
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
    post.tScene.value = sceneRT.texture;
    post.tBloom.value = src.texture;
    post.uSceneTexel.value.set(1 / rtW, 1 / rtH);
    post.uRes.value.set(cssW * dpr, cssH * dpr);
    post.uTime.value = G.time;
    const upscale = (cssW * dpr) / rtW;
    post.uSharpen.value = clamp((upscale - 1) * 0.6, 0, 0.45);
    pass(compositeMat, null);
  }

  // Called once per frame with the raw frame time; adapts the internal resolution.
  function adapt(frameMs) {
    if (!autoQuality) return;
    ftAcc += frameMs; ftCount++; ftTimer += frameMs;
    if (ftTimer < 1000) return;
    const avg = ftAcc / ftCount;
    ftAcc = 0; ftCount = 0; ftTimer = 0;
    if (document.hidden) return;
    const now = performance.now() / 1000;
    if (avg > 21 && renderScale > 0.55) {
      renderScale = Math.max(0.55, renderScale - (avg > 30 ? 0.15 : 0.08));
      lastDownscaleAt = now;
      stableTimer = 0;
      allocTargets();
    } else if (avg > 34 && renderScale <= 0.55 && qualityName !== 'low') {
      // still struggling at minimum scale: step quality down
      const order = ['low', 'medium', 'high', 'ultra'];
      setQuality(order[Math.max(0, order.indexOf(qualityName) - 1)], true);
    } else if (avg < 17.6) {
      stableTimer++;
      if (renderScale < 1 && stableTimer >= 4 && now - lastDownscaleAt > 6) {
        renderScale = Math.min(1, renderScale + 0.05);
        stableTimer = 0;
        allocTargets();
      }
    } else {
      stableTimer = 0;
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

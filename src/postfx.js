// ============================================================================
// ELDERFALL — postfx.js
// Ultra-tier cinematic postprocessing chain (desktop 'ultra' quality ONLY).
//
//   RenderPass → UnrealBloomPass → grade ShaderPass → OutputPass
//
// r160 detail this file leans on: three only applies tone mapping + output
// color-space conversion when rendering to the DEFAULT framebuffer. Inside
// the composer every pass works on a linear HDR half-float buffer, and the
// final OutputPass applies ACES + sRGB from the renderer's own settings
// (renderer.toneMapping / .toneMappingExposure / .outputColorSpace). That
// keeps the composer path visually matched to the plain renderer.render()
// path — same exposure, same response — just richer. It also means anyone
// who modulates renderer.toneMappingExposure (weather) affects both paths
// identically, because OutputPass re-reads it every frame.
//
// The bloom threshold therefore operates on PRE-tonemap linear HDR values:
// day-lit terrain sits well under it, while emissives (lanterns, windows,
// fires, enchanted blades, spell orbs) and the sun/sky glow punch past it.
//
// API (per NEXT-LEVEL.md):
//   createPostfx(g) → { update(dt), render(), setEnabled(on) }   when ultra
//   createPostfx(g) → { update(dt) }  (NO render key)            otherwise,
//   so main.js falls back to renderer.render and the mobile path is untouched.
//
// Also owns: resize + pixel-ratio tracking (main's adaptive resScale calls
// renderer.setPixelRatio behind our back — we poll cheaply each frame), and
// a perf auto-tune guard (sustained >20ms frames → halve bloom resolution →
// disable bloom, with a single "Graphics auto-tuned" toast).
// ============================================================================

import * as THREE from 'three';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';

// ---------------------------------------------------------------------------
// Bloom tuning — thresholds are in linear HDR luminance (pre-tonemap).
// A soft knee (via the high-pass smoothWidth) lets warm, red-heavy emissives
// (low Rec.601 luma) contribute progressively instead of being cut off by a
// hard luminance gate, while day-lit terrain (~0.15–0.45 lum) stays dark.
// ---------------------------------------------------------------------------
// The threshold adapts to sun elevation. Reason: in linear luminance a noon
// white plaster wall (~0.84) is BRIGHTER than a night lantern's warm emissive
// (~0.79) or an ember blade (~0.25) — warm reds score terribly in Rec.601
// luma. One fixed gate cannot both keep noon terrain dark and let night
// emissives glow. So: by day the gate sits above sunlit albedo (only the sun
// disc / golden-hour sky glow pass); by night it drops low — moonlit terrain
// and night sky sit under ~0.06 lum, so ONLY emissives (windows, lanterns,
// fires, torch flames, enchanted blades, spell orbs) and stars/moon bloom.
const BLOOM = {
  dayThreshold: 0.66,   // above bright day albedo, below sun/sky glow
  dayKnee: 0.85,        // soft knee → full bloom only well past 1.0
  nightThreshold: 0.42, // above additive smoke/mist stacks, below emissives
  nightKnee: 0.45,
  strength: 0.55,
  radius: 0.4,
};

// Saturation-aware high-pass, swapped into the vendored UnrealBloomPass in
// place of its stock luminosity filter (same uniforms object — the pass
// keeps driving tDiffuse/threshold itself; NO vendor file is modified).
// Why: in plain Rec.601 luma the game's warm emissives score terribly —
// an ember blade (~0.25) ranks BELOW a grey additive smoke puff (~0.3-0.5)
// and a lantern (~0.78) below a sunlit white wall (~0.84). Emissives here
// are strongly SATURATED though, while smoke/walls/sky are grey-ish. So the
// gate value blends from luma toward the peak channel for saturated colors:
// fires, lanterns, windows, enchanted blades and spell orbs punch through,
// grey smoke and daylit surfaces stay dark.
const HighPassShader = {
  name: 'ElderfallBloomHighPass',
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = max(texel.rgb, vec3(0.0));
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      float peak = max(c.r, max(c.g, c.b));
      float sat = peak > 0.0001 ? 1.0 - min(c.r, min(c.g, c.b)) / peak : 0.0;
      // Grey sources (additive smoke stacks, moonlit walls, HP bars) are
      // penalized; saturated sources gate on their peak channel instead.
      float v = mix(luma * (0.55 + 0.45 * sat), peak, 0.7 * sat);
      float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
      gl_FragColor = vec4(c * alpha, 1.0);
    }`,
};

// ---------------------------------------------------------------------------
// Grade pass — runs on the linear HDR frame, BEFORE OutputPass tonemapping.
// Filmic contrast +6% (power law around 0.18 mid-grey ≈ log-space contrast,
// safe for >1 HDR values), saturation ×1.05, subtle corner vignette (0.22),
// very faint animated film grain (±0.015) driven by uTime.
// ---------------------------------------------------------------------------
const GradeShader = {
  name: 'ElderfallGradeShader',

  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uContrast:   { value: 1.06 },
    uSaturation: { value: 1.05 },
    uVignette:   { value: 0.22 },
    uGrain:      { value: 0.0 }, // grain disabled — clean, grounded image (user direction)
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = max(texel.rgb, vec3(0.0));

      // Filmic S-curve contrast: a power law around mid-grey in linear HDR
      // steepens the ACES curve applied later by OutputPass without clipping
      // highlights. Deep shadows are protected (blend to identity below
      // ~0.05 lum) so dark nights keep their exposure instead of crushing.
      float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 con = 0.18 * pow(col / 0.18, vec3(uContrast));
      col = mix(col, con, smoothstep(0.0, 0.05, l0));

      // Gentle saturation lift (Rec.709 luma preserves perceived brightness)
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(luma), col, uSaturation), vec3(0.0));

      // Subtle vignette — clear center, uVignette darkening at far corners
      float r = length(vUv - 0.5);
      col *= 1.0 - uVignette * smoothstep(0.30, 0.707, r);

      // Very faint film grain, re-seeded per frame via uTime. Slightly
      // luma-weighted so pitch-black night skies don't get noisy lift.
      float n = hash21(gl_FragCoord.xy + vec2(uTime * 127.1, uTime * 311.7)) - 0.5;
      col += n * uGrain * (0.6 + min(luma, 1.0));

      gl_FragColor = vec4(col, texel.a);
    }`,
};

// ---------------------------------------------------------------------------
// createPostfx
// ---------------------------------------------------------------------------
export function createPostfx(g) {
  // Not ultra → inert stub with NO render key: main.js keeps calling
  // renderer.render directly and the mobile/high path stays byte-identical.
  if (!g.quality || !g.quality.ultra) {
    return { update() {}, setEnabled() {}, enabled: false };
  }

  const renderer = g.renderer;
  const scene = g.scene;
  const camera = g.camera;

  // ---- composer + chain ----------------------------------------------------
  const composer = new EffectComposer(renderer); // HalfFloat HDR targets
  const renderPass = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(256, 256), // placeholder; addPass sizes it for real
    BLOOM.strength, BLOOM.radius, BLOOM.dayThreshold,
  );
  bloomPass.highPassUniforms['smoothWidth'].value = BLOOM.dayKnee;
  // Swap in the saturation-aware high-pass (see HighPassShader note above).
  // Reuses the pass's own uniforms object, so its render() keeps working.
  bloomPass.materialHighPassFilter.dispose();
  bloomPass.materialHighPassFilter = new THREE.ShaderMaterial({
    name: HighPassShader.name,
    uniforms: bloomPass.highPassUniforms,
    vertexShader: HighPassShader.vertexShader,
    fragmentShader: HighPassShader.fragmentShader,
  });

  const gradePass = new ShaderPass(GradeShader);
  const outputPass = new OutputPass(); // ACES + sRGB from renderer settings

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(outputPass);

  // ---- state ----------------------------------------------------------------
  let enabled = true;      // settings toggle (EXPLORE's row calls setEnabled)
  let bloomScale = 1;      // 1 → full res, 0.5 after first auto-tune stage
  let tuneStage = 0;       // 0 full | 1 half-res bloom | 2 bloom off
  let notified = false;    // "Graphics auto-tuned" fires at most once
  let grainT = 0;          // wrapped grain clock (shader precision)

  // resize / pixel-ratio tracking
  const _size = new THREE.Vector2();
  let lastW = 0, lastH = 0, lastPR = 0;

  // perf guard (own wall clock — g.time.rawDt is clamped to 50ms)
  let ema = 16.7;          // frame-time EMA in ms
  let overAcc = 0;         // seconds spent with ema above budget
  let lastNow = performanceNow();

  function performanceNow() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  // Re-apply the auto-tune bloom scale. composer.setSize() sets every pass to
  // FULL effective resolution, so this must run after any composer resize.
  function applyBloomScale() {
    if (!(lastW > 0 && lastH > 0)) return;
    const w = Math.max(2, Math.round(lastW * lastPR * bloomScale));
    const h = Math.max(2, Math.round(lastH * lastPR * bloomScale));
    bloomPass.setSize(w, h);
  }

  function escalateTune() {
    if (tuneStage === 0) {
      tuneStage = 1;
      bloomScale = 0.5;
      applyBloomScale();
    } else if (tuneStage === 1) {
      tuneStage = 2;
      bloomPass.enabled = false;
      if (!notified) {
        notified = true;
        if (g.events) g.events.emit('notify', {
          text: 'Graphics auto-tuned',
          sub: 'Bloom reduced to keep the framerate smooth',
        });
      }
    }
  }

  // ---- update ---------------------------------------------------------------
  function update(dt) {
    // Grain clock: wrapped so the shader hash never loses float precision.
    // Runs on rawDt so the film grain keeps breathing through pause menus.
    grainT = (grainT + (g.time ? g.time.rawDt : dt)) % 64;
    gradePass.uniforms.uTime.value = grainT;

    // Day/night adaptive bloom gate (see the BLOOM note above). Sun elevation
    // comes from sky when available (lazy — never at factory time), with a
    // dayFrac fallback that matches sky.js's own sun curve.
    const sunY = (g.sky && g.sky.sunDir)
      ? g.sky.sunDir.y
      : Math.sin((g.time.dayFrac - 0.25) * Math.PI * 2);
    let dayW = (sunY + 0.08) / 0.23; // smoothstep(-0.08, 0.15, sunY)
    dayW = dayW < 0 ? 0 : dayW > 1 ? 1 : dayW;
    dayW = dayW * dayW * (3 - 2 * dayW);
    bloomPass.threshold =
      BLOOM.nightThreshold + (BLOOM.dayThreshold - BLOOM.nightThreshold) * dayW;
    bloomPass.highPassUniforms['smoothWidth'].value =
      BLOOM.nightKnee + (BLOOM.dayKnee - BLOOM.nightKnee) * dayW;

    // Cheap per-frame resolution poll: catches window resizes AND main.js's
    // adaptive resScale (which calls renderer.setPixelRatio without telling us).
    renderer.getSize(_size);
    const pr = renderer.getPixelRatio();
    if (_size.x !== lastW || _size.y !== lastH || pr !== lastPR) {
      lastW = _size.x; lastH = _size.y; lastPR = pr;
      composer.setPixelRatio(pr);       // stores ratio (resizes with stale dims)
      composer.setSize(lastW, lastH);   // then size everything correctly
      applyBloomScale();                // restore auto-tuned bloom resolution
    }

    // Perf guard: sustained heavy frames at ultra → step bloom down.
    const now = performanceNow();
    const rawMs = now - lastNow;
    lastNow = now;
    const frameMs = Math.min(rawMs, 250); // clamp outliers for the EMA
    if (enabled && tuneStage < 2) {
      ema = ema * 0.92 + frameMs * 0.08;
      if (ema > 20) {
        // accumulate real wall time (capped so a hidden tab can't inflate it)
        overAcc += Math.min(rawMs, 1000) / 1000;
        if (overAcc > 5) { escalateTune(); overAcc = 0; }
      } else {
        overAcc = 0;
      }
    }
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!enabled) { renderer.render(scene, camera); return; } // plain path
    composer.render();
  }

  // ---- setEnabled (settings row) ---------------------------------------------
  function setEnabled(on) {
    on = !!on;
    enabled = on;
    api.enabled = on;
    if (on) {
      // Re-arm the auto-tuner from full quality — even if already enabled,
      // an explicit "on" means the user wants the full effect back.
      tuneStage = 0;
      bloomScale = 1;
      bloomPass.enabled = true;
      ema = 16.7;
      overAcc = 0;
      applyBloomScale();
    }
  }

  const api = {
    update,
    render,
    setEnabled,
    enabled: true,
    // debug/tuning handles (not part of the contract API)
    _composer: composer,
    _bloom: bloomPass,
    _grade: gradePass,
    _info: () => ({ enabled, tuneStage, bloomScale, ema: +ema.toFixed(1) }),
  };
  return api;
}

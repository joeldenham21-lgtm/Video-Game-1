// ============================================================================
// ELDERFALL — sky.js
// The sky dome, the sun and moon, day/night lighting, fog, and weather.
// This module owns the LOOK of the world: a full-shader gradient dome with
// sun disc + golden glow, procedural stars, two layers of drifting fbm
// clouds, and a soft moon. A DirectionalLight (sun by day, cool moonlight
// by night) and a HemisphereLight are driven from g.time.dayFrac through a
// hand-tuned palette: deep indigo starry nights → LONG rose/amber dawns →
// clear cyan days → LONG burnt-orange/violet dusks. Fog is owned here and
// always matches the horizon color so terrain melts into the sky.
//
// Exposes (per contract): { update(dt), sunDir, sunLight, horizonColor }
//   sunDir       — unit THREE.Vector3 toward the sun, updated IN PLACE
//   horizonColor — THREE.Color, updated IN PLACE (water fresnel, etc.)
// ============================================================================

import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm } from './core.js';

// ---------------------------------------------------------------------------
// Palette keyframes over dayFrac (0 = midnight, .25 sunrise, .5 noon, .75 sunset)
// The golden hours are deliberately wide: dawn spans ~0.185–0.38 and dusk
// ~0.62–0.90 of the cycle, so the gorgeous light lingers.
// Fields: t, horizon, mid, zenith sky colors; sun light color + intensity;
// hemisphere sky/ground tints + intensity; fogT (0 = tight night fog,
// 1 = clear day); stars alpha.
// ---------------------------------------------------------------------------
function K(t, h, m, z, sc, si, hs, hg, hi, ft, st) {
  return {
    t,
    h: new THREE.Color(h), m: new THREE.Color(m), z: new THREE.Color(z),
    sc: new THREE.Color(sc), si,
    hs: new THREE.Color(hs), hg: new THREE.Color(hg), hi,
    ft, st,
  };
}

const KEYS = [
  //      horizon    mid       zenith    sunColor  sunI  hemiSky   hemiGnd   hemiI fogT stars
  K(0.000, 0x1d2547, 0x0d1330, 0x05081a, 0x9db4e6, 0.00, 0x1b2440, 0x0a0d14, 0.50, 0.00, 1.00), // deep night
  K(0.155, 0x252b54, 0x10163a, 0x070b20, 0x9db4e6, 0.00, 0x202a4c, 0x0b0e15, 0.50, 0.05, 0.95), // pre-dawn hush
  K(0.205, 0x6d4468, 0x272b56, 0x0b102a, 0xff9a68, 0.05, 0x3d3a5e, 0x181420, 0.52, 0.18, 0.55), // first light, rose seeps in
  K(0.250, 0xf08a5f, 0x8f6b96, 0x25396b, 0xffb26e, 1.35, 0x8f80a4, 0x473c34, 0.62, 0.45, 0.08), // SUNRISE — rose & mauve
  K(0.300, 0xffc07a, 0x92a6c9, 0x3d6198, 0xffd9a2, 2.35, 0xaabdd9, 0x5a5340, 0.78, 0.75, 0.00), // long golden morning
  K(0.380, 0xd9e6e3, 0x82b3da, 0x3e77bd, 0xfff0d6, 2.70, 0xb8d2e6, 0x64644c, 0.92, 1.00, 0.00), // morning clears
  K(0.500, 0xd3e9ec, 0x74b7e0, 0x2e70c4, 0xfff6e4, 2.80, 0xc2dcec, 0x6b6a50, 0.98, 1.00, 0.00), // NOON — bright cyan-blue
  K(0.620, 0xe0e3d6, 0x86afd6, 0x3a6fb8, 0xffedc8, 2.65, 0xbcd2e2, 0x67624a, 0.92, 1.00, 0.00), // warm afternoon
  K(0.690, 0xffb46b, 0x93a0c6, 0x3a5a92, 0xffc67e, 2.35, 0xac9fb8, 0x5c4f3c, 0.80, 0.80, 0.00), // long golden hour
  K(0.750, 0xff7e40, 0xa86687, 0x2b3d6e, 0xff9552, 1.35, 0x8a6e8e, 0x44362e, 0.62, 0.50, 0.08), // SUNSET — burnt orange
  K(0.798, 0xd4532e, 0x6b4374, 0x19244c, 0xff7a45, 0.40, 0x4f3f66, 0x1f1820, 0.55, 0.28, 0.38), // ember dusk, violet above
  K(0.845, 0x663a5c, 0x2e2c58, 0x0d1230, 0xc09ab8, 0.05, 0x2c3050, 0x12101a, 0.50, 0.12, 0.72), // violet twilight
  K(0.900, 0x1d2547, 0x0d1330, 0x05081a, 0x9db4e6, 0.00, 0x1b2440, 0x0a0d14, 0.50, 0.00, 1.00), // night settles
  K(1.000, 0x1d2547, 0x0d1330, 0x05081a, 0x9db4e6, 0.00, 0x1b2440, 0x0a0d14, 0.50, 0.00, 1.00), // wrap
];

// ---------------------------------------------------------------------------
// Dome shader
// ---------------------------------------------------------------------------
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // dome is never rotated; local position = world direction
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3  uHorizon;
uniform vec3  uMid;
uniform vec3  uZenith;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunVis;      // 0..1 fade as sun sinks below horizon
uniform float uGlow;        // widened warm glow strength (peaks at golden hour)
uniform vec3  uMoonDir;
uniform vec3  uMoonColor;
uniform float uMoonVis;
uniform float uStars;       // star layer alpha
uniform float uCloudThresh; // lower = more cloud cover
uniform vec3  uCloudLit;
uniform vec3  uCloudShade;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.zxy + 19.19);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < CLOUD_OCT; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, -9.1);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;

  // --- Three-stop vertical gradient -------------------------------------
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.30, y));
  col = mix(col, uZenith, smoothstep(0.22, 0.85, y));
  // Below the horizon line, sink gently toward a darker horizon tone
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, 0.25, -y));

  float sd = dot(dir, uSunDir);
  float md = dot(dir, uMoonDir);

  // --- Stars (3D cell hash, soft dots, gentle twinkle) -------------------
  if (uStars > 0.001 && y > -0.05) {
    vec3 sp = dir * 170.0;
    vec3 ip = floor(sp);
    float h = hash31(ip);
    if (h > 0.80) {
      vec3 off = vec3(hash31(ip + 1.7), hash31(ip + 4.3), hash31(ip + 9.1));
      float d = length(fract(sp) - 0.3 - off * 0.4);
      float star = 1.0 - smoothstep(0.0, 0.22, d);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 5.0) + h * 43.0);
      float mag = 0.35 + 0.65 * smoothstep(0.80, 0.995, h); // few bright, many faint
      star *= tw * mag * uStars * smoothstep(-0.02, 0.22, y);
      col += vec3(0.85, 0.9, 1.0) * star;
    }
  }

  // --- Clouds: two drifting fbm layers, projected onto a virtual plane ---
  float cl = 0.0;
  if (y > 0.015) {
    vec2 uv = dir.xz / (y + 0.14);
    float l1 = fbm2(uv * 0.85 + uTime * vec2(0.0060, 0.0016));
    float l2 = fbm2(uv * 2.05 + uTime * vec2(-0.0110, 0.0042) + 41.7);
    float c = l1 * 0.62 + l2 * 0.48;
    cl = smoothstep(uCloudThresh, uCloudThresh + 0.30, c);
    cl *= smoothstep(0.015, 0.16, y); // thin out toward horizon
    // silver lining: cloud faces near the sun catch its color
    float lit = mix(0.35, 1.0, pow(max(sd, 0.0), 2.5));
    vec3 ccol = mix(uCloudShade, uCloudLit, lit * (1.15 - cl * 0.55));
    col = mix(col, ccol, cl * 0.92);
  }

  // --- Sun: crisp disc + medium halo + wide warm glow (through-cloud dim) -
  float occl = 1.0 - cl * 0.85;
  float sdp = max(sd, 0.0);
  float disc = smoothstep(0.99930, 0.99985, sd);
  float halo = pow(sdp, 60.0) * 0.55;
  float glow = pow(sdp, 5.0) * 0.22 * uGlow;
  col += uSunColor * ((disc * 3.2 + halo) * occl + glow) * uSunVis;

  // --- Moon: soft pale disc + faint halo ---------------------------------
  float mdisc = smoothstep(0.99958, 0.99987, md);
  float mhalo = pow(max(md, 0.0), 160.0) * 0.30;
  // simple limb shading so the moon reads as a sphere, not a sticker
  float limb = 0.75 + 0.25 * smoothstep(0.99958, 0.99992, md);
  col += uMoonColor * (mdisc * 1.55 * limb + mhalo) * uMoonVis * occl;

  // --- Dither to kill gradient banding on mobile --------------------------
  col += (hash21(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// createSky
// ---------------------------------------------------------------------------
export function createSky(g) {
  // ---- exposed, updated-in-place objects ---------------------------------
  const sunDir = new THREE.Vector3(0, 1, 0);
  const horizonColor = new THREE.Color(0xf08a5f);

  // ---- palette scratch (all preallocated) ---------------------------------
  const midColor = new THREE.Color();
  const zenithColor = new THREE.Color();
  const sunColKF = new THREE.Color();
  const hemiSkyC = new THREE.Color();
  const hemiGndC = new THREE.Color();
  const cloudLit = new THREE.Color();
  const cloudShade = new THREE.Color();
  const lightCol = new THREE.Color();
  const MOON_BLUE = new THREE.Color(0x9db4e6);
  const MOON_FACE = new THREE.Color(0xdfe8f5);
  const CLOUD_WHITE = new THREE.Color(0xf5f2ec);
  const OVERCAST_GREY = new THREE.Color(0x9aa1a8);
  const moonDir = new THREE.Vector3(0, -1, 0);

  const _fwd = new THREE.Vector3();
  const _anchor = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _upv = new THREE.Vector3();
  const _UP = new THREE.Vector3(0, 1, 0);

  const cur = { si: 0, hi: 0, ft: 1, st: 0 }; // interpolated scalars

  // ---- dome ---------------------------------------------------------------
  const uniforms = {
    uHorizon:     { value: horizonColor }, // shared instance — fog & water match by construction
    uMid:         { value: midColor },
    uZenith:      { value: zenithColor },
    uSunDir:      { value: sunDir },       // shared instance
    uSunColor:    { value: new THREE.Color(0xffd9a2) },
    uSunVis:      { value: 1 },
    uGlow:        { value: 1 },
    uMoonDir:     { value: moonDir },
    uMoonColor:   { value: MOON_FACE },
    uMoonVis:     { value: 0 },
    uStars:       { value: 0 },
    uCloudThresh: { value: 0.6 },
    uCloudLit:    { value: cloudLit },
    uCloudShade:  { value: cloudShade },
    uTime:        { value: 0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    defines: { CLOUD_OCT: g.quality.tier === 'low' ? 3 : 4 },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 15), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = 1; // draw after opaque world → depth test culls hidden sky fill
  dome.matrixAutoUpdate = false;
  g.scene.add(dome);

  // ---- lights ---------------------------------------------------------------
  // ONE DirectionalLight serves as sun by day and cool moonlight by night;
  // its intensity dips through ~0 at twilight so the direction swap never pops.
  const sunLight = new THREE.DirectionalLight(0xffffff, 0);
  sunLight.position.set(0, 200, 0);
  g.scene.add(sunLight);
  g.scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0xc2dcec, 0x6b6a50, 0.9);
  g.scene.add(hemi);

  // ---- shadows (optional 1024 PCF bubble following the camera) --------------
  const SHADOW_EXTENT = (g.quality && g.quality.ultra) ? 52 : 36; // desktop: wider bubble at 2048
  const SHADOW_TEXEL = (SHADOW_EXTENT * 2) / 1024;
  if (g.quality.shadows) {
    sunLight.castShadow = true;
    const ultra = !!(g.quality && g.quality.ultra);
    sunLight.shadow.mapSize.set(ultra ? 2048 : 1024, ultra ? 2048 : 1024);
    if (ultra && g.renderer) g.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const sc = sunLight.shadow.camera;
    sc.left = -SHADOW_EXTENT; sc.right = SHADOW_EXTENT;
    sc.top = SHADOW_EXTENT;   sc.bottom = -SHADOW_EXTENT;
    sc.near = 1; sc.far = 175; // light sits 150u out — far must clear receivers (+margin)
    sc.updateProjectionMatrix();
    sunLight.shadow.bias = -0.0006;
    sunLight.shadow.normalBias = 1.2; // flat-shaded low-poly: generous normal bias kills acne
  }

  // ---- fog (owned here, matched to horizon every frame) ---------------------
  const fog = new THREE.Fog(horizonColor.getHex(), 180, 1500);
  g.scene.fog = fog;
  g.scene.background = horizonColor; // same instance → always in sync (dome covers it anyway)

  // ---- palette evaluation ----------------------------------------------------
  function evalPalette(f) {
    let i = 0;
    while (KEYS[i + 1].t < f) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    let t = (f - a.t) / (b.t - a.t);
    t = t * t * (3 - 2 * t); // ease each segment for buttery transitions
    horizonColor.lerpColors(a.h, b.h, t);
    midColor.lerpColors(a.m, b.m, t);
    zenithColor.lerpColors(a.z, b.z, t);
    sunColKF.lerpColors(a.sc, b.sc, t);
    hemiSkyC.lerpColors(a.hs, b.hs, t);
    hemiGndC.lerpColors(a.hg, b.hg, t);
    cur.si = lerp(a.si, b.si, t);
    cur.hi = lerp(a.hi, b.hi, t);
    cur.ft = lerp(a.ft, b.ft, t);
    cur.st = lerp(a.st, b.st, t);
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  function update(dt) {
    const time = g.time;
    const f = time.dayFrac;

    // --- celestial geometry -------------------------------------------------
    // Sun: rises in the east (+x) at f=0.25, arcs high with a southerly lean,
    // sets in the west (-x) at f=0.75. Elevation is a pure sine of the cycle.
    const ang = (f - 0.25) * Math.PI * 2;
    const sunEl = Math.sin(ang); // -1..1, >0 means sun above horizon
    sunDir.set(Math.cos(ang) * 0.92, sunEl, 0.5).normalize(); // southerly lean: noon still models forms
    // Moon: roughly opposite the sun, on a slightly different (northern) track
    const mAng = ang + Math.PI * 1.045;
    moonDir.set(Math.cos(mAng) * 0.95, Math.sin(mAng), -0.30).normalize();

    // --- palette -------------------------------------------------------------
    evalPalette(f);

    // --- weather: slow clear ↔ overcast breathing over tens of minutes -------
    const cover = clamp(0.5 + 0.62 * fbm(time.elapsed * 0.0045 + 3.1, 47.7, 3), 0, 1);
    const overcastDim = 1 - 0.30 * cover;
    const dayL = smoothstep(-0.08, 0.25, sunEl); // broad "how day is it" factor
    // overcast greys the horizon a touch (day only, so nights stay indigo)
    horizonColor.lerp(OVERCAST_GREY, 0.12 * cover * dayL);

    // --- light weights: sun ↔ moon crossfade through a twilight dip ----------
    const dayW = smoothstep(-0.03, 0.08, sunDir.y);
    const moonW = smoothstep(0.04, 0.18, moonDir.y) * smoothstep(0.06, -0.06, sunDir.y);

    // Direction: whichever body dominates (intensity ~0 during the swap)
    if (dayW >= moonW) {
      _fwd.copy(sunDir);
    } else {
      _fwd.copy(moonDir);
    }
    const wSum = dayW + moonW;
    if (wSum > 1e-4) lightCol.lerpColors(MOON_BLUE, sunColKF, dayW / wSum);
    else lightCol.copy(MOON_BLUE);
    sunLight.color.copy(lightCol);
    sunLight.intensity = cur.si * dayW * overcastDim + 0.52 * moonW; // readable nights
    // Moonlight casts no shadows: halves night draw calls, and moon shadows read as noise anyway
    if (sunLight.castShadow !== undefined && g.quality.shadows) sunLight.castShadow = dayW > 0.08;

    // --- position the light (and snap the shadow bubble to texels) -----------
    if (g.quality.shadows) {
      // Anchor a bit ahead of the camera so the useful shadow area is in view
      g.camera.getWorldDirection(_anchor);
      _anchor.multiplyScalar(18).add(g.camera.position);
      // Build a stable basis perpendicular to the light and snap the anchor
      // to shadow-texel increments in that plane → no shimmering edges.
      _right.crossVectors(_UP, _fwd);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _right.normalize();
      _upv.crossVectors(_fwd, _right);
      const px = Math.round(_anchor.dot(_right) / SHADOW_TEXEL) * SHADOW_TEXEL;
      const py = Math.round(_anchor.dot(_upv) / SHADOW_TEXEL) * SHADOW_TEXEL;
      const pz = _anchor.dot(_fwd);
      _anchor.set(0, 0, 0)
        .addScaledVector(_right, px)
        .addScaledVector(_upv, py)
        .addScaledVector(_fwd, pz);
      sunLight.position.copy(_anchor).addScaledVector(_fwd, 150);
      sunLight.target.position.copy(_anchor);
    } else {
      sunLight.position.copy(_fwd).multiplyScalar(200);
      sunLight.target.position.set(0, 0, 0);
    }

    // --- hemisphere ambience ---------------------------------------------------
    hemi.color.copy(hemiSkyC);
    hemi.groundColor.copy(hemiGndC);
    hemi.intensity = cur.hi * (1 - 0.12 * cover * dayL);

    // --- dome uniforms -----------------------------------------------------------
    uniforms.uTime.value = time.elapsed;
    uniforms.uSunVis.value = smoothstep(-0.10, 0.02, sunEl);
    // wide warm glow blooms at golden hour (sun near the horizon)
    const golden = clamp(1 - Math.abs(sunEl) / 0.38, 0, 1);
    uniforms.uGlow.value = 0.8 + 2.0 * golden * golden;
    uniforms.uSunColor.value.copy(sunColKF);
    uniforms.uMoonVis.value =
      smoothstep(0.02, 0.14, moonDir.y) * (0.30 + 0.70 * (1 - dayL));
    uniforms.uStars.value = cur.st;
    uniforms.uCloudThresh.value = lerp(0.74, 0.46, cover);
    // Cloud lit face: sun-tinted at golden hour, white by day, moonlit at night
    cloudLit.copy(sunColKF).lerp(CLOUD_WHITE, 0.55)
      .multiplyScalar(0.18 + 0.88 * dayL);
    cloudLit.r += 0.05 * (1 - dayL); // faint cold night sheen
    cloudLit.g += 0.06 * (1 - dayL);
    cloudLit.b += 0.09 * (1 - dayL);
    cloudShade.copy(midColor).multiplyScalar(0.72);

    // --- fog: owned here, always the horizon color -------------------------------
    const clearT = cur.ft * (1 - 0.15 * cover); // overcast pulls the veil closer
    fog.near = lerp(60, 180, clearT);
    fog.far = lerp(500, 1500, clearT);
    fog.color.copy(horizonColor);

    // --- dome follows the camera ---------------------------------------------------
    dome.position.copy(g.camera.position);
    dome.updateMatrix();
  }

  return { update, sunDir, sunLight, horizonColor };
}

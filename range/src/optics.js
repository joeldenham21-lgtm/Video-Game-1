// ============================================================================
// RANGE — optics.js
// • Reflex sight: a collimated reticle. The dot is drawn where the ray from
//   the eye through each lens fragment is parallel to the sight's line of
//   sight, so it stays on target as the head moves (true parallax-free dot).
// • Rifle scope: the world is rendered a second time from the scope's
//   optical axis into a texture with the true field of view; the ocular lens
//   shader maps eye→fragment rays to apparent angles, clips the image to the
//   exit-pupil cone (scope shadow when the eye is off axis / wrong eye relief),
//   draws a first-focal-plane mil reticle and adds edge CA + vignette.
// ============================================================================
import * as THREE from 'three';

const REDDOT_VS = `varying vec3 vWorld; varying vec3 vNormalW;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; vNormalW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const REDDOT_FS = `precision highp float;
uniform vec3 losDir; uniform float dotRad; uniform vec3 dotColor; uniform float brightness; uniform float on;
varying vec3 vWorld; varying vec3 vNormalW;
void main(){
  vec3 ray = normalize(vWorld - cameraPosition);
  float s = length(cross(ray, losDir));           // sin(angle between the eye ray and the LOS)
  float core = 1.0 - smoothstep(dotRad * 0.75, dotRad * 1.25, s);
  float halo = exp(-s / (dotRad * 2.2)) * 0.22;
  float fres = pow(1.0 - abs(dot(ray, vNormalW)), 3.0);
  vec3 tint = vec3(0.04, 0.09, 0.12) * 0.7 + fres * 0.25;
  vec3 dotC = dotColor * (core * 6.0 + halo * 2.0) * brightness * on;
  float alpha = 0.16 + fres * 0.35 + core * on;
  gl_FragColor = vec4(tint + dotC, clamp(alpha, 0.0, 1.0));
}`;

const SCOPE_VS = REDDOT_VS;
const SCOPE_FS = `precision highp float;
uniform sampler2D tex; uniform vec3 axis; uniform vec3 rightV; uniform vec3 upV; uniform vec3 center; uniform float eyeRelief; uniform float halfTan; uniform float mag; uniform float exitPupil; uniform float illum; uniform float scopeOn;
varying vec3 vWorld; varying vec3 vNormalW;
float lineAA(float d, float w, float aa){ return 1.0 - smoothstep(w, w + aa, abs(d)); }
void main(){
  vec3 ray = normalize(vWorld - cameraPosition);
  float cz = dot(ray, axis);
  if (cz < 0.2) { gl_FragColor = vec4(0.01,0.01,0.015,1.0); return; }
  vec2 a = vec2(dot(ray, rightV), dot(ray, upV)) / cz;         // apparent tan-angles
  vec2 uv = 0.5 + a / halfTan * 0.5;
  // eye position relative to the ideal eye point (exit pupil)
  vec3 eyeRel = cameraPosition - (center - axis * eyeRelief);
  float axial = dot(eyeRel, axis);
  vec2 lat = vec2(dot(eyeRel, rightV), dot(eyeRel, upV));
  vec2 shadowC = -lat * (halfTan / (exitPupil * 0.55));
  float shadowR = halfTan * clamp(1.0 - abs(axial) / (eyeRelief * 0.9) * 0.8, 0.15, 1.0);
  float d = length(a - shadowC);
  float vis = 1.0 - smoothstep(shadowR * 0.82, shadowR * 1.02, d);
  float field = 1.0 - smoothstep(halfTan * 0.965, halfTan * 1.0, length(a));
  float v = vis * field * scopeOn;
  // chromatic aberration & slight edge softness
  float r = length(a) / halfTan;
  vec2 ca = (uv - 0.5) * 0.006 * r * r;
  vec3 img = vec3(texture2D(tex, uv + ca).r, texture2D(tex, uv).g, texture2D(tex, uv - ca).b);
  img *= 1.0 - 0.35 * r * r * r;
  // FFP mil reticle: true mrad = apparent tan / mag * 1000
  vec2 mil = a / mag * 1000.0;
  float aa = fwidth(mil.x) * 1.2;
  float w = 0.035;                                      // line half-width in mil (FFP: scales with magnification)
  float reticle = 0.0;
  reticle = max(reticle, lineAA(mil.y, w, aa) * step(abs(mil.x), 12.0));   // horizontal
  reticle = max(reticle, lineAA(mil.x, w, aa) * step(abs(mil.y), 12.0));   // vertical
  // hash marks every 1 mil (0.5 mil half-length), half-mil ticks (0.25)
  float fx = abs(mil.x - floor(mil.x + 0.5)), fy = abs(mil.y - floor(mil.y + 0.5));
  float hx = abs(mil.x - floor(mil.x) - 0.5), hy = abs(mil.y - floor(mil.y) - 0.5);
  reticle = max(reticle, lineAA(fx, w, aa) * step(abs(mil.y), 0.5) * step(0.5, abs(mil.x)) * step(abs(mil.x), 10.0));
  reticle = max(reticle, lineAA(fy, w, aa) * step(abs(mil.x), 0.5) * step(0.5, abs(mil.y)) * step(abs(mil.y), 10.0));
  reticle = max(reticle, lineAA(hx, w, aa) * step(abs(mil.y), 0.25) * step(0.5, abs(mil.x)) * step(abs(mil.x), 10.0));
  reticle = max(reticle, lineAA(hy, w, aa) * step(abs(mil.x), 0.25) * step(0.5, abs(mil.y)) * step(abs(mil.y), 10.0));
  // thick posts beyond 12 mil
  reticle = max(reticle, lineAA(mil.y, 0.35, aa) * step(12.0, abs(mil.x)));
  reticle = max(reticle, lineAA(mil.x, 0.35, aa) * step(12.0, abs(mil.y)));
  // wind-hold dots on the horizontal at 1..6 mil
  float dots = 0.0;
  for (int i = 1; i <= 6; i++) { float fi = float(i); dots = max(dots, 1.0 - smoothstep(0.06, 0.06 + aa, length(vec2(abs(mil.x) - fi, mil.y - 1.0)))); }
  reticle = max(reticle, dots);
  float centerDot = 1.0 - smoothstep(0.05, 0.05 + aa, length(mil));
  vec3 col = img * (1.0 - reticle * 0.92) * (1.0 - centerDot);
  col += vec3(1.0, 0.15, 0.05) * illum * (lineAA(mil.x, w, aa) * step(abs(mil.y), 2.0) + lineAA(mil.y, w, aa) * step(abs(mil.x), 2.0)) * 1.5;
  col += vec3(1.0, 0.15, 0.05) * illum * centerDot * 2.0;
  col = mix(vec3(0.012, 0.014, 0.02), col, v);
  // glass reflection when not looking through it
  float fres = pow(1.0 - abs(dot(ray, vNormalW)), 4.0);
  col += fres * 0.15 * (1.0 - v);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createOptics({ renderer, worldScene, viewmodel, camera, rtSize = 1024 }) {
  const redDot = new THREE.ShaderMaterial({ vertexShader: REDDOT_VS, fragmentShader: REDDOT_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { losDir: { value: new THREE.Vector3(0, 0, -1) }, dotRad: { value: 0.00058 }, dotColor: { value: new THREE.Color(1.0, 0.16, 0.08) }, brightness: { value: 1.0 }, on: { value: 1 } } });
  const RT_SIZE = rtSize;
  const rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, { type: THREE.HalfFloatType, samples: 0 });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const scopeCam = new THREE.PerspectiveCamera(2.4, 1, 0.5, 4000);
  const scopeMat = new THREE.ShaderMaterial({ vertexShader: SCOPE_VS, fragmentShader: SCOPE_FS, side: THREE.DoubleSide,
    uniforms: { tex: { value: rt.texture }, axis: { value: new THREE.Vector3(0, 0, -1) }, rightV: { value: new THREE.Vector3(1, 0, 0) }, upV: { value: new THREE.Vector3(0, 1, 0) }, center: { value: new THREE.Vector3() }, eyeRelief: { value: 0.09 }, halfTan: { value: Math.tan(12 * Math.PI / 180) }, mag: { value: 10 }, exitPupil: { value: 0.005 }, illum: { value: 0.0 }, scopeOn: { value: 0 } } });
  const APPARENT_FOV = 24; // degrees
  const _los = new THREE.Vector3(), _sp = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3(), _q = new THREE.Quaternion();
  let scopeRendered = false;

  const api = {
    redDot, scopeMat, scopeCam, rt, illum: 0,
    attach(weaponApi) {
      if (weaponApi.parts.reticle) weaponApi.parts.reticle.obj.material = redDot;
      if (weaponApi.parts.scope) weaponApi.parts.scope.ocular.material = scopeMat;
    },
    setMagnification(m) { scopeMat.uniforms.mag.value = m; scopeCam.fov = APPARENT_FOV / m; scopeCam.updateProjectionMatrix(); },
    setIllumination(v) { scopeMat.uniforms.illum.value = v; },
    setDotBrightness(v) { redDot.uniforms.brightness.value = v; },
    /** call once per frame before rendering: updates uniforms and renders the scope view if needed */
    update(vm, exposure) {
      const w = vm.weapon; if (!w) return;
      // 2 MOA dot, but never smaller than ~2.5 px so it reads like a real (bloomed) emitter
      const pxAngle = (camera.fov * Math.PI / 180) / renderer.domElement.height;
      redDot.uniforms.dotRad.value = Math.max(0.00058, pxAngle * 1.6);
      vm.worldLosDir(_los); vm.worldSightPoint(_sp);
      redDot.uniforms.losDir.value.copy(_los);
      if (w.parts.scope) {
        const S = w.spec.scope; const st = vm.state;
        api.setMagnification(st.scopeMag || S.mag);
        // orientation: axis = LOS, up = weapon up in world
        _up.set(0, 1, 0).transformDirection(w.group.matrixWorld); _right.crossVectors(_los, _up).normalize(); _up.crossVectors(_right, _los).normalize();
        const u = scopeMat.uniforms; u.axis.value.copy(_los); u.rightV.value.copy(_right); u.upV.value.copy(_up);
        // ocular centre world position
        u.center.value.set(0, S.eyeReliefM ? w.parts.scope.axisPoint.y : 0, w.parts.scope.ocularZ).setX(0).setY(w.parts.scope.axisPoint.y).applyMatrix4(w.group.matrixWorld);
        u.eyeRelief.value = S.eyeReliefM; u.exitPupil.value = (S.objectiveMm / (st.scopeMag || S.mag)) / 1000; u.halfTan.value = Math.tan(APPARENT_FOV / 2 * Math.PI / 180);
        const wantRender = vm.adsT > 0.02 || vm.player.active;
        u.scopeOn.value = wantRender ? 1 : 0;
        if (wantRender) {
          scopeCam.position.copy(_sp).addScaledVector(_los, 0.15);
          const m = new THREE.Matrix4().makeBasis(_right, _up, _los.clone().negate()); _q.setFromRotationMatrix(m); scopeCam.quaternion.copy(_q);
          scopeCam.updateMatrixWorld(true);
          const oldTarget = renderer.getRenderTarget(); const oldTM = renderer.toneMapping;
          renderer.toneMapping = THREE.NoToneMapping; // composited later through the ocular shader (its output is tone-mapped by the main pass)
          renderer.setRenderTarget(rt); renderer.clear(); renderer.render(worldScene, scopeCam);
          renderer.setRenderTarget(oldTarget); renderer.toneMapping = oldTM;
          scopeRendered = true;
        }
      }
      void exposure; void camera;
    },
  };
  return api;
}

// Beams (tracers, lasers, arcs), pooled point lights, impact decals, and physical debris shards.
import * as THREE from 'three';
import { G, fxLayer } from '../state.js';
import { rand, TAU } from '../util.js';
import { makeScorchTexture } from '../world/textures.js';

// ---------------------------------------------------------------- beams
const BEAM_VERT = /* glsl */`
attribute vec3 iStart; attribute vec3 iEnd; attribute vec4 iColor; attribute vec3 iParams; // width, jitter, seed
uniform float uTime;
varying vec2 vUv; varying vec4 vColor; varying float vAlong;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float t = position.x + 0.5;
  vec3 dir = iEnd - iStart;
  vec3 p = iStart + dir * t;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(normalize(dir + vec3(1e-6)), toCam));
  vec3 up2 = cross(side, normalize(dir + vec3(1e-6)));
  if (iParams.y > 0.0) {
    float k = floor(uTime * 30.0) + iParams.z * 13.0;
    float seg = floor(t * 12.0);
    float j1 = h(seg + k) - 0.5, j2 = h(seg + 1.0 + k) - 0.5;
    float j3 = h(seg + k + 7.0) - 0.5, j4 = h(seg + 8.0 + k) - 0.5;
    float f = fract(t * 12.0);
    float env = sin(t * 3.14159);
    p += side * mix(j1, j2, f) * iParams.y * env + up2 * mix(j3, j4, f) * iParams.y * env;
  }
  p += side * position.y * iParams.x;
  vUv = vec2(t, position.y * 2.0);
  vColor = iColor;
  vAlong = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BEAM_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vColor; varying float vAlong;
void main() {
  float d = abs(vUv.y);
  float core = smoothstep(1.0, 0.0, d);
  float a = core * core * (0.6 + 0.4 * smoothstep(0.0, 0.08, vAlong)) ;
  vec3 c = vColor.rgb * a + vec3(1.0) * pow(core, 8.0) * length(vColor.rgb) * 0.25;
  gl_FragColor = vec4(c * vColor.a, 0.0);
}`;

function createBeams(scene, max = 160) {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1, 24, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  const aS = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aE = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iStart', aS); geo.setAttribute('iEnd', aE); geo.setAttribute('iColor', aC); geo.setAttribute('iParams', aP);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 25;
  fxLayer(mesh);
  scene.add(mesh);

  const list = [];
  const c = new THREE.Color();
  // kind: 'tracer' (moving streak), 'fade' (static fade), 'hold' (manually driven, e.g. lasers)
  function add(sx, sy, sz, ex, ey, ez, color, intensity, width, life, kind = 'fade', jitter = 0) {
    if (list.length >= max) list.shift();
    c.set(color);
    const b = { sx, sy, sz, ex, ey, ez, r: c.r * intensity, g: c.g * intensity, b: c.b * intensity, width, life, maxLife: life, kind, jitter, seed: Math.random() * 100, alpha: 1 };
    list.push(b);
    return b;
  }
  function update(dt) {
    mat.uniforms.uTime.value = G.time;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.kind !== 'hold') {
        b.life -= dt;
        if (b.life <= 0) { list.splice(i, 1); continue; }
      } else if (b.dead) { list.splice(i, 1); continue; }
    }
    for (const b of list) {
      let sx = b.sx, sy = b.sy, sz = b.sz, ex = b.ex, ey = b.ey, ez = b.ez;
      let a = b.alpha;
      const t = b.kind === 'hold' ? 0 : 1 - b.life / b.maxLife;
      if (b.kind === 'tracer') {
        // a streak that races from muzzle to impact
        const head = Math.min(1, t * 1.6 + 0.25), tail = Math.max(0, head - 0.45);
        const dx = ex - sx, dy = ey - sy, dz = ez - sz;
        ex = b.sx + dx * head; ey = b.sy + dy * head; ez = b.sz + dz * head;
        sx = b.sx + dx * tail; sy = b.sy + dy * tail; sz = b.sz + dz * tail;
        a *= 1 - t * 0.5;
      } else if (b.kind === 'fade') {
        a *= (1 - t) * (1 - t);
      }
      aS.array[n * 3] = sx; aS.array[n * 3 + 1] = sy; aS.array[n * 3 + 2] = sz;
      aE.array[n * 3] = ex; aE.array[n * 3 + 1] = ey; aE.array[n * 3 + 2] = ez;
      aC.array[n * 4] = b.r; aC.array[n * 4 + 1] = b.g; aC.array[n * 4 + 2] = b.b; aC.array[n * 4 + 3] = a;
      aP.array[n * 3] = b.width * (b.kind === 'fade' ? (1 - t * 0.5) : 1); aP.array[n * 3 + 1] = b.jitter; aP.array[n * 3 + 2] = b.seed;
      n++;
    }
    geo.instanceCount = n;
    if (n) { aS.needsUpdate = aE.needsUpdate = aC.needsUpdate = aP.needsUpdate = true; }
  }
  return { add, update, clear() { list.length = 0; geo.instanceCount = 0; }, list };
}

// ---------------------------------------------------------------- pooled point lights
function createLights(scene, count) {
  const pool = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 14, 2);
    l.visible = i < count;
    scene.add(l);
    pool.push({ light: l, life: 0, maxLife: 1, peak: 0 });
  }
  let active = count;
  return {
    setCount(n) { active = n; pool.forEach((p, i) => { p.light.visible = i < n; if (i >= n) p.light.intensity = 0; }); },
    flash(pos, color, intensity = 30, range = 12, life = 0.12) {
      let best = null;
      for (let i = 0; i < active; i++) {
        const p = pool[i];
        const rem = p.life > 0 ? p.peak * (p.life / p.maxLife) : 0;
        if (!best || rem < best.rem) best = { p, rem };
      }
      if (!best || best.rem > intensity) return;
      const p = best.p;
      p.light.position.set(pos.x, pos.y, pos.z);
      p.light.color.set(color);
      p.light.distance = range;
      p.peak = intensity; p.life = life; p.maxLife = life;
      p.light.intensity = intensity;
    },
    update(dt) {
      for (let i = 0; i < active; i++) {
        const p = pool[i];
        if (p.life > 0) {
          p.life -= dt;
          const k = Math.max(0, p.life / p.maxLife);
          p.light.intensity = p.peak * k * k;
        } else p.light.intensity = 0;
      }
    },
  };
}

// ---------------------------------------------------------------- decals (scorch + hot glow)
function createDecals(scene, max = 90) {
  const tex = makeScorchTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const birth = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  geo.setAttribute('iBirth', birth);
  geo.setAttribute('iTint', tint);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uTime: { value: 0 } },
    vertexShader: `attribute float iBirth; attribute vec3 iTint; varying vec2 vUv; varying float vAge; varying vec3 vTint;
      void main(){ vUv = uv; vAge = iBirth; vTint = iTint; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float uTime; varying vec2 vUv; varying float vAge; varying vec3 vTint;
      void main(){
        float age = uTime - vAge;
        float a = texture2D(map, vUv).a;
        float fade = clamp(1.0 - (age - 9.0) / 3.0, 0.0, 1.0);
        float hot = exp(-age * 2.2) * smoothstep(0.55, 0.0, length(vUv - 0.5));
        vec3 c = vTint * hot * 4.0;
        gl_FragColor = vec4(c, a * 0.75 * fade);
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 5;
  fxLayer(mesh);
  scene.add(mesh);
  let next = 0, used = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const c = new THREE.Color();
  return {
    add(pos, normal, size = 0.35, color = 0xff9a40) {
      n.set(normal.x, normal.y, normal.z);
      q.setFromUnitVectors(zAxis, n);
      const spin = new THREE.Quaternion().setFromAxisAngle(n, Math.random() * TAU);
      q.premultiply(spin);
      p.set(pos.x + n.x * 0.012, pos.y + n.y * 0.012, pos.z + n.z * 0.012);
      s.setScalar(size * rand(0.8, 1.2));
      m.compose(p, q, s);
      mesh.setMatrixAt(next, m);
      birth.array[next] = G.time;
      c.set(color);
      tint.array[next * 3] = c.r; tint.array[next * 3 + 1] = c.g; tint.array[next * 3 + 2] = c.b;
      next = (next + 1) % max;
      used = Math.min(max, used + 1);
      mesh.count = used;
      mesh.instanceMatrix.needsUpdate = true;
      birth.needsUpdate = true; tint.needsUpdate = true;
    },
    update() { mat.uniforms.uTime.value = G.time; },
    clear() { used = 0; next = 0; mesh.count = 0; },
  };
}

// ---------------------------------------------------------------- debris shards (instanced, physical)
function createDebris(scene, max = 280) {
  const geo = new THREE.TetrahedronGeometry(1, 0);
  geo.scale(0.7, 1, 0.45);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1, envMapIntensity: 1.2 });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.count = 0;
  scene.add(mesh);
  const items = [];
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  return {
    burst(pos, count = 10, color = 0xe8ecf2, speed = 7, size = 0.12, glow = null) {
      for (let i = 0; i < count; i++) {
        if (items.length >= max) items.shift();
        const d = [rand(-1, 1), rand(-0.2, 1.3), rand(-1, 1)];
        const m = Math.hypot(...d) || 1;
        const s = speed * rand(0.4, 1.2);
        const isGlow = glow && Math.random() < 0.3;
        items.push({
          x: pos.x + rand(-0.2, 0.2), y: pos.y + rand(-0.2, 0.2), z: pos.z + rand(-0.2, 0.2),
          vx: d[0] / m * s, vy: d[1] / m * s + 2, vz: d[2] / m * s,
          rx: rand(0, TAU), ry: rand(0, TAU), rz: rand(0, TAU), wx: rand(-12, 12), wy: rand(-12, 12),
          s: size * rand(0.5, 1.6), life: rand(2.2, 3.6), color: isGlow ? glow : color, glow: isGlow, rest: false,
        });
      }
    },
    update(dt) {
      const world = G.world;
      let n = 0;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.life -= dt;
        if (it.life <= 0 || it.y < -60) { items.splice(i, 1); continue; }
        if (!it.rest) {
          it.vy -= 20 * dt;
          it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
          it.rx += it.wx * dt; it.ry += it.wy * dt;
          if (world) {
            const gy = world.groundHeight(it.x, it.z, 0.02, it.y + 0.4);
            if (it.y < gy + it.s * 0.4) {
              it.y = gy + it.s * 0.4;
              if (Math.abs(it.vy) < 1.5) { it.rest = true; it.vy = 0; }
              it.vy = -it.vy * 0.35; it.vx *= 0.55; it.vz *= 0.55; it.wx *= 0.5; it.wy *= 0.5;
            }
          }
        }
      }
      for (const it of items) {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(it.rx, it.ry, it.rz);
        dummy.scale.setScalar(it.s * Math.min(1, it.life / 0.6));
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        c.set(it.color);
        if (it.glow) c.multiplyScalar(3 * Math.min(1, it.life / 1.5));
        mesh.setColorAt(n, c);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    clear() { items.length = 0; mesh.count = 0; },
  };
}

export function createEffects(scene) {
  G.beams = createBeams(scene);
  G.lights = createLights(scene, G.renderer.q.lights);
  G.decals = createDecals(scene);
  G.debris = createDebris(scene);
  G.events.on('quality', ({ q }) => G.lights.setCount(q.lights));
  return {
    update(dt) {
      G.beams.update(dt);
      G.lights.update(dt);
      G.decals.update();
      G.debris.update(dt);
    },
    clear() { G.beams.clear(); G.decals.clear(); G.debris.clear(); },
  };
}

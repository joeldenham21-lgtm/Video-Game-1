// GPU-instanced billboard particles (CPU simulated). One draw call per blend mode.
import * as THREE from 'three';
import { G } from '../state.js';
import { rand, TAU } from '../util.js';

const VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iColor; attribute vec3 iVel; attribute vec3 iSize;
varying vec2 vUv; varying vec4 vColor; varying float vStretch;
void main() {
  vec3 p = iPos;
  vec2 q = position.xy;
  if (iSize.y > 0.0) {
    vec3 vdir = normalize(iVel + vec3(1e-5));
    vec3 toCam = normalize(cameraPosition - p);
    vec3 right = normalize(cross(vdir, toCam));
    float len = iSize.x + iSize.y * length(iVel);
    p += right * q.x * iSize.x + vdir * q.y * len;
    vStretch = 1.0;
  } else {
    float c = cos(iSize.z), s = sin(iSize.z);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p += (right * r.x + up * r.y) * iSize.x;
    vStretch = 0.0;
  }
  vUv = position.xy * 2.0;
  vColor = iColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG_ADD = /* glsl */`
varying vec2 vUv; varying vec4 vColor; varying float vStretch;
void main() {
  float d = vStretch > 0.5 ? abs(vUv.x) * (0.6 + 0.4 * abs(vUv.y)) : length(vUv);
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a * (vStretch > 0.5 ? 1.0 : (0.5 + 0.5 * a));
  gl_FragColor = vec4(vColor.rgb * vColor.a * a, 0.0);
}`;

const FRAG_SMOKE = /* glsl */`
varying vec2 vUv; varying vec4 vColor; varying float vStretch;
void main() {
  float d = length(vUv);
  float a = smoothstep(1.0, 0.2, d) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a * 0.8);
}`;

class ParticleSystem {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    const F = (k) => new Float32Array(max * k);
    this.px = F(1); this.py = F(1); this.pz = F(1);
    this.vx = F(1); this.vy = F(1); this.vz = F(1);
    this.life = F(1); this.maxLife = F(1);
    this.s0 = F(1); this.s1 = F(1); this.stretch = F(1);
    this.r = F(1); this.g = F(1); this.b = F(1); this.a0 = F(1);
    this.drag = F(1); this.grav = F(1); this.rot = F(1); this.rotV = F(1);
    this.floor = new Uint8Array(max);

    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iColor', this.aCol);
    geo.setAttribute('iVel', this.aVel); geo.setAttribute('iSize', this.aSize);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: additive ? FRAG_ADD : FRAG_SMOKE,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    if (!additive) mat.blending = THREE.NormalBlending;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    this.geo = geo;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, opts) {
    let i = this.n;
    if (i >= this.max) {
      // overwrite the oldest-ish slot
      i = Math.floor(Math.random() * this.max);
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a0[i] = a;
    this.drag[i] = opts?.drag ?? 1.5;
    this.grav[i] = opts?.grav ?? 0;
    this.stretch[i] = opts?.stretch ?? 0;
    this.rot[i] = opts?.rot ?? Math.random() * TAU;
    this.rotV[i] = opts?.rotV ?? 0;
    this.floor[i] = opts?.floor ? 1 : 0;
  }

  update(dt) {
    let n = this.n;
    const P = this.aPos.array, C = this.aCol.array, V = this.aVel.array, S = this.aSize.array;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) this.move(n, i);
        i--;
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.floor[i] && G.world) {
        const gy = G.world.groundHeight(this.px[i], this.pz[i], 0.01, this.py[i] + 0.3);
        if (this.py[i] < gy) { this.py[i] = gy; this.vy[i] *= -0.35; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
      }
      this.rot[i] += this.rotV[i] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      P[i * 3] = this.px[i]; P[i * 3 + 1] = this.py[i]; P[i * 3 + 2] = this.pz[i];
      V[i * 3] = this.vx[i]; V[i * 3 + 1] = this.vy[i]; V[i * 3 + 2] = this.vz[i];
      C[i * 4] = this.r[i]; C[i * 4 + 1] = this.g[i]; C[i * 4 + 2] = this.b[i]; C[i * 4 + 3] = this.a0[i] * Math.max(0, fade);
      S[i * 3] = size; S[i * 3 + 1] = this.stretch[i]; S[i * 3 + 2] = this.rot[i];
    }
    this.n = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aVel.needsUpdate = true; this.aSize.needsUpdate = true;
      this.aPos.addUpdateRange?.(0, n * 3); this.aCol.addUpdateRange?.(0, n * 4);
      this.aVel.addUpdateRange?.(0, n * 3); this.aSize.addUpdateRange?.(0, n * 3);
    }
  }

  move(from, to) {
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 's0', 's1', 'stretch', 'r', 'g', 'b', 'a0', 'drag', 'grav', 'rot', 'rotV', 'floor']) this[k][to] = this[k][from];
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

const col = new THREE.Color();
function rgb(hex, i = 1) { col.set(hex); return [col.r * i, col.g * i, col.b * i]; }

export function createParticles(scene, quality = 1) {
  const add = new ParticleSystem(Math.round(2400 * quality), true);
  const smoke = new ParticleSystem(Math.round(500 * quality), false);
  scene.add(add.mesh, smoke.mesh);
  const Q = () => G.renderer?.q?.particles ?? 1;
  const cnt = (n) => Math.max(1, Math.round(n * Q()));

  const api = {
    add, smoke,
    update(dt) { add.update(dt); smoke.update(dt); },
    clear() { add.clear(); smoke.clear(); },

    // bright impact sparks bouncing off a surface
    sparks(p, n, color = 0xffc070, count = 10, speed = 9, intensity = 3) {
      const [r, g, b] = rgb(color, intensity);
      for (let i = 0; i < cnt(count); i++) {
        const dx = n.x + rand(-0.9, 0.9), dy = n.y + rand(-0.9, 0.9) + 0.3, dz = n.z + rand(-0.9, 0.9);
        const s = speed * rand(0.35, 1.1);
        add.emit(p.x, p.y, p.z, dx * s, dy * s, dz * s, rand(0.18, 0.5), 0.035, 0.012, r, g, b, 1, { drag: 3.5, grav: 14, stretch: 0.028, floor: true });
      }
      add.emit(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, 0, 0, 0, 0.09, 0.35, 0.6, r * 0.6, g * 0.6, b * 0.6, 1, { drag: 0 });
    },

    // puff of dust/smoke
    puff(p, count = 4, color = 0x2a2e36, size = 0.6, alpha = 0.5) {
      col.set(color);
      for (let i = 0; i < cnt(count); i++) {
        smoke.emit(p.x + rand(-0.2, 0.2), p.y + rand(-0.1, 0.2), p.z + rand(-0.2, 0.2), rand(-1, 1), rand(0.3, 1.4), rand(-1, 1), rand(0.7, 1.4), size * 0.5, size * rand(1.4, 2.4), col.r, col.g, col.b, alpha, { drag: 2.2, grav: -0.3, rotV: rand(-1, 1) });
      }
    },

    // energy hit on an enemy (colored flash + small shards of light)
    energyHit(p, color = 0x9fe8ff, count = 6, crit = false) {
      const [r, g, b] = rgb(color, crit ? 5 : 3);
      add.emit(p.x, p.y, p.z, 0, 0, 0, 0.08, crit ? 0.7 : 0.45, crit ? 1.1 : 0.7, r, g, b, 1, { drag: 0 });
      for (let i = 0; i < cnt(count); i++) {
        const s = rand(3, 8);
        add.emit(p.x, p.y, p.z, rand(-1, 1) * s, rand(-0.6, 1.2) * s, rand(-1, 1) * s, rand(0.15, 0.35), 0.04, 0.01, r, g, b, 1, { drag: 4, grav: 6, stretch: 0.03 });
      }
    },

    explosion(p, radius = 4, color = 0xff8a3a, big = false) {
      const [r, g, b] = rgb(color, 4);
      add.emit(p.x, p.y, p.z, 0, 0, 0, 0.16, radius * 0.4, radius * 1.3, r * 1.4, g * 1.4, b * 1.4, 1, { drag: 0 });
      add.emit(p.x, p.y, p.z, 0, 0, 0, 0.45, radius * 0.6, radius * 1.1, r * 0.5, g * 0.4, b * 0.3, 1, { drag: 0 });
      for (let i = 0; i < cnt(big ? 60 : 32); i++) {
        const dir = [rand(-1, 1), rand(-0.4, 1.2), rand(-1, 1)];
        const m = Math.hypot(...dir) || 1;
        const s = rand(6, 20) * (radius / 4);
        add.emit(p.x, p.y, p.z, dir[0] / m * s, dir[1] / m * s, dir[2] / m * s, rand(0.3, 0.8), 0.06, 0.02, r, g * 0.9, b * 0.7, 1, { drag: 2.5, grav: 12, stretch: 0.03, floor: true });
      }
      for (let i = 0; i < cnt(big ? 12 : 7); i++) {
        smoke.emit(p.x + rand(-1, 1), p.y + rand(-0.5, 1), p.z + rand(-1, 1), rand(-2, 2), rand(0.5, 3), rand(-2, 2), rand(1.2, 2.2), radius * 0.35, radius * rand(0.8, 1.3), 0.06, 0.06, 0.07, 0.55, { drag: 1.6, grav: -0.6, rotV: rand(-0.8, 0.8) });
      }
      // ember glow lingering
      for (let i = 0; i < cnt(8); i++) {
        add.emit(p.x + rand(-1, 1) * radius * 0.4, p.y + rand(0, 1), p.z + rand(-1, 1) * radius * 0.4, rand(-1, 1), rand(1, 3), rand(-1, 1), rand(0.6, 1.4), 0.12, 0.04, r * 0.7, g * 0.5, b * 0.3, 1, { drag: 1.2, grav: -1 });
      }
    },

    // shockwave ring flash on the ground
    ring(p, radius, color = 0x9fe8ff, count = 36, life = 0.35, intensity = 3) {
      const [r, g, b] = rgb(color, intensity);
      for (let i = 0; i < cnt(count); i++) {
        const a = (i / count) * TAU;
        const s = radius / life;
        add.emit(p.x, p.y + 0.1, p.z, Math.cos(a) * s, 0, Math.sin(a) * s, life, 0.3, 0.1, r, g, b, 1, { drag: 1.2, stretch: 0.01 });
      }
    },

    // column of light when an enemy warps in
    warpIn(p, height = 3, color = 0xbfe8ff) {
      const [r, g, b] = rgb(color, 3);
      for (let i = 0; i < cnt(26); i++) {
        const a = rand(0, TAU), rr = rand(0.3, 1.4);
        add.emit(p.x + Math.cos(a) * rr, p.y + rand(0, height), p.z + Math.sin(a) * rr, -Math.cos(a) * rr * 1.5, rand(1, 5), -Math.sin(a) * rr * 1.5, rand(0.4, 0.9), 0.07, 0.02, r, g, b, 1, { drag: 1, stretch: 0.04 });
      }
    },

    // enemy death burst of light
    deathBurst(p, color = 0xbfe8ff, scale = 1) {
      const [r, g, b] = rgb(color, 4);
      add.emit(p.x, p.y, p.z, 0, 0, 0, 0.14, 0.8 * scale, 2.6 * scale, r, g, b, 1, { drag: 0 });
      for (let i = 0; i < cnt(22 * scale); i++) {
        const s = rand(4, 13) * Math.sqrt(scale);
        const d = [rand(-1, 1), rand(-0.5, 1.2), rand(-1, 1)];
        const m = Math.hypot(...d) || 1;
        add.emit(p.x, p.y, p.z, d[0] / m * s, d[1] / m * s, d[2] / m * s, rand(0.25, 0.7), 0.06, 0.015, r, g, b, 1, { drag: 3, grav: 9, stretch: 0.035, floor: true });
      }
    },

    // sparkles drifting up (pickups, heals)
    sparkle(p, color = 0x5dffa8, count = 8, spread = 0.5) {
      const [r, g, b] = rgb(color, 2.5);
      for (let i = 0; i < cnt(count); i++) {
        add.emit(p.x + rand(-spread, spread), p.y + rand(-spread, spread), p.z + rand(-spread, spread), rand(-0.5, 0.5), rand(0.8, 2.2), rand(-0.5, 0.5), rand(0.4, 0.9), 0.08, 0.02, r, g, b, 1, { drag: 1.5 });
      }
    },

    trail(p, color, size = 0.2, life = 0.25, intensity = 2.5) {
      const [r, g, b] = rgb(color, intensity);
      add.emit(p.x, p.y, p.z, rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3), life, size, size * 0.2, r, g, b, 0.9, { drag: 2 });
    },

    dashBurst(pos, dir) {
      const [r, g, b] = rgb(0x9fe8ff, 1.6);
      for (let i = 0; i < cnt(14); i++) {
        const y = pos.y + rand(0.2, 1.7);
        add.emit(pos.x + rand(-0.5, 0.5), y, pos.z + rand(-0.5, 0.5), -dir.x * rand(6, 14), rand(-0.5, 0.5), -dir.z * rand(6, 14), rand(0.15, 0.3), 0.05, 0.02, r, g, b, 1, { drag: 3, stretch: 0.03 });
      }
    },

    jumpRing(pos) { api.ring({ x: pos.x, y: pos.y - 0.05, z: pos.z }, 1.8, 0x9fe8ff, 20, 0.25, 2); },

    padBurst(pad) {
      const [r, g, b] = rgb(0x58e0ff, 3);
      for (let i = 0; i < cnt(30); i++) {
        const a = rand(0, TAU), rr = rand(0, 1.1);
        add.emit(pad.x + Math.cos(a) * rr, pad.y + 0.1, pad.z + Math.sin(a) * rr, 0, rand(8, 18), 0, rand(0.25, 0.5), 0.06, 0.02, r, g, b, 1, { drag: 2.5, stretch: 0.04 });
      }
      api.ring({ x: pad.x, y: pad.y, z: pad.z }, 2.4, 0x58e0ff, 24, 0.3, 2.5);
    },
  };
  return api;
}

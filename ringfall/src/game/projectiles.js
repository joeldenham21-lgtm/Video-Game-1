// Projectiles: enemy plasma orbs (deflectable), player Nova grenades, ground shockwaves, boss volleys.
import * as THREE from 'three';
import { G } from '../state.js';
import { clamp, rand, distSqPointSegment, TAU, DEG } from '../util.js';
import { P } from './player.js';

const ORB_VERT = /* glsl */`
attribute vec4 iColor; varying vec4 vColor; varying vec3 vN; varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vColor = iColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ORB_FRAG = /* glsl */`
varying vec4 vColor; varying vec3 vN; varying vec3 vV;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  vec3 c = mix(vColor.rgb, vec3(1.0) * length(vColor.rgb) * 0.8, pow(f, 3.0));
  gl_FragColor = vec4(c * (0.6 + f), 1.0);
}`;

export function createProjectiles() {
  const MAX = 220;
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const mat = new THREE.ShaderMaterial({ vertexShader: ORB_VERT, fragmentShader: ORB_FRAG });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  mesh.geometry.setAttribute('iColor', colors);
  mesh.frustumCulled = false;
  mesh.count = 0;
  G.scene.add(mesh);

  // shockwave rings
  const ringGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
  ringGeo.translate(0, 0.5, 0);
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xff6a3a).multiplyScalar(3) }, uA: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.5) * uA; float band = smoothstep(0.0, 0.15, vUv.y) ; gl_FragColor = vec4(uColor * a * (0.4 + band), 0.0); }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
  });
  const rings = [];
  const orbs = [];
  const nades = [];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const tmp = new THREE.Vector3();

  const api = {
    orbs, nades, rings,
    // enemy plasma orb
    orb(pos, vel, dmg, owner, opts = {}) {
      if (orbs.length >= MAX - 20) return null;
      const o = {
        x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z,
        r: opts.r || 0.26, dmg, life: opts.life || 6, owner: 'enemy', src: owner,
        color: opts.color || 0xff3a5c, intensity: opts.intensity || 4, homing: opts.homing || 0, trail: 0, heavy: !!opts.heavy,
        gravity: opts.gravity || 0,
      };
      orbs.push(o);
      return o;
    },

    playerGrenade(pos, vel, def) {
      nades.push({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, def, life: 4, trail: 0, arm: 0.05 });
    },

    shockwave(x, y, z, maxR, speed, dmg, color = 0xff6a3a, height = 0.75) {
      const m = new THREE.Mesh(ringGeo, ringMat.clone());
      m.material.uniforms.uColor.value.set(color).multiplyScalar(3);
      m.position.set(x, y, z);
      m.scale.set(0.1, height, 0.1);
      G.scene.add(m);
      rings.push({ x, y, z, r: 0.2, maxR, speed, dmg, height, mesh: m, hit: false });
      G.audio?.play('shockwave', { pos: { x, y, z } });
    },

    // Punch projectiles back toward whatever the player is aiming at
    deflect(eye, fwd, range, cone) {
      let n = 0;
      const mods = G.augments?.mods || {};
      for (const o of orbs) {
        if (o.owner !== 'enemy') continue;
        const dx = o.x - eye.x, dy = o.y - eye.y, dz = o.z - eye.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > range) continue;
        const a = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 0.01), -1, 1));
        if (a > cone && d > 1.2) continue;
        // aim: nearest enemy near the crosshair, else straight ahead
        let target = null, best = 12 * DEG;
        for (const e of G.enemies.list) {
          if (!e.alive || e.warp > 0) continue;
          const ex = e.aimPoint.x - eye.x, ey = e.aimPoint.y - eye.y, ez = e.aimPoint.z - eye.z;
          const ed = Math.hypot(ex, ey, ez);
          const ea = Math.acos(clamp((ex * fwd.x + ey * fwd.y + ez * fwd.z) / ed, -1, 1));
          if (ea < best) { best = ea; target = e; }
        }
        if (!target && o.src && o.src.alive) target = o.src;
        const sp = Math.max(24, Math.hypot(o.vx, o.vy, o.vz) * 1.8);
        if (target) tmp.set(target.aimPoint.x - o.x, target.aimPoint.y - o.y, target.aimPoint.z - o.z).normalize();
        else tmp.copy(fwd);
        o.vx = tmp.x * sp; o.vy = tmp.y * sp; o.vz = tmp.z * sp;
        o.owner = 'player'; o.color = 0x9fe8ff; o.intensity = 6; o.life = 3;
        o.dmg = Math.max(40, o.dmg * 4) * (mods.deflectDamage ?? 1);
        o.homingTarget = target;
        G.particles?.energyHit(o, 0x9fe8ff, 10, true);
        n++;
      }
      if (n) G.events.emit('deflect', n);
      return n;
    },

    update(dt) {
      const pl = G.player;
      const world = G.world;
      // ---- orbs
      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i];
        o.life -= dt;
        if (o.homing && o.owner === 'enemy') {
          const ep = pl.eyePos;
          tmp.set(ep.x - o.x, ep.y - 0.4 - o.y, ep.z - o.z).normalize();
          const sp = Math.hypot(o.vx, o.vy, o.vz);
          const k = Math.min(1, o.homing * dt);
          o.vx += (tmp.x * sp - o.vx) * k; o.vy += (tmp.y * sp - o.vy) * k; o.vz += (tmp.z * sp - o.vz) * k;
        } else if (o.owner === 'player' && o.homingTarget?.alive) {
          const t = o.homingTarget.aimPoint;
          tmp.set(t.x - o.x, t.y - o.y, t.z - o.z).normalize();
          const sp = Math.hypot(o.vx, o.vy, o.vz);
          const k = Math.min(1, 6 * dt);
          o.vx += (tmp.x * sp - o.vx) * k; o.vy += (tmp.y * sp - o.vy) * k; o.vz += (tmp.z * sp - o.vz) * k;
        }
        o.vy -= o.gravity * dt;
        const px = o.x, py = o.y, pz = o.z;
        const len = Math.hypot(o.vx, o.vy, o.vz) * dt;
        let dead = o.life <= 0;
        if (len > 0) {
          const dx = o.vx * dt / len, dy = o.vy * dt / len, dz = o.vz * dt / len;
          const wh = world.raycast(px, py, pz, dx, dy, dz, len + o.r * 0.5);
          if (wh) {
            G.particles?.sparks(wh, { x: wh.nx, y: wh.ny, z: wh.nz }, o.color, 8, 6, 3);
            G.decals?.add(wh, { x: wh.nx, y: wh.ny, z: wh.nz }, 0.5, o.color);
            G.audio?.play('orbImpact', { pos: wh, volume: 0.6 });
            if (o.heavy) G.lights?.flash(wh, o.color, 10, 7, 0.2);
            dead = true;
          }
        }
        o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
        if (!dead) {
          if (o.owner === 'enemy') {
            // player capsule
            const d2 = distSqPointSegment(pl.pos.x, pl.pos.y + 0.35, pl.pos.z, px, py, pz, o.x, o.y, o.z);
            const d2b = distSqPointSegment(pl.pos.x, pl.pos.y + 1.4, pl.pos.z, px, py, pz, o.x, o.y, o.z);
            const rr = (o.r + P.radius) * (o.r + P.radius);
            if ((d2 < rr || d2b < rr) && pl.alive) {
              if (pl.damage(o.dmg, { x: px, y: py, z: pz }, 'orb')) {
                G.particles?.energyHit(o, o.color, 6);
                dead = true;
              }
            }
          } else {
            // deflected: hits enemies
            for (const e of G.enemies.list) {
              if (!e.alive || e.warp > 0) continue;
              const dx = e.pos.x - o.x, dy = e.pos.y - o.y, dz = e.pos.z - o.z;
              const rr = e.radius + o.r + 0.3;
              if (dx * dx + dy * dy + dz * dz < rr * rr) {
                tmp.set(o.vx, o.vy, o.vz).normalize();
                const res = e.damage(o.dmg, { part: 'core', x: o.x, y: o.y, z: o.z, dir: tmp, source: 'deflect', knock: 8, crit: true });
                G.enemies.reportHit(e, { dmg: res.dealt, crit: true, killed: res.killed, x: o.x, y: o.y, z: o.z });
                G.particles?.explosion(o, 2, 0x9fe8ff);
                if (G.augments?.mods.deflectExplode) G.enemies.damageRadius(o, 4, 45, 'deflect', 8);
                dead = true;
                break;
              }
            }
          }
        }
        if (dead) { orbs.splice(i, 1); continue; }
        o.trail -= dt;
        if (o.trail <= 0) { o.trail = 0.02; G.particles?.trail(o, o.color, o.r * 1.4, 0.22, o.intensity * 0.6); }
      }
      // ---- grenades
      for (let i = nades.length - 1; i >= 0; i--) {
        const n = nades[i];
        n.life -= dt; n.arm -= dt;
        n.vy -= 14 * dt;
        const len = Math.hypot(n.vx, n.vy, n.vz) * dt;
        let boom = n.life <= 0;
        let hitPoint = null;
        if (len > 0) {
          const dx = n.vx * dt / len, dy = n.vy * dt / len, dz = n.vz * dt / len;
          const wh = world.raycast(n.x, n.y, n.z, dx, dy, dz, len + 0.15);
          if (wh) { boom = true; hitPoint = { x: wh.x + wh.nx * 0.2, y: wh.y + wh.ny * 0.2, z: wh.z + wh.nz * 0.2 }; }
          const eh = G.enemies.raycast(n.x, n.y, n.z, dx, dy, dz, len + 0.35);
          if (eh && n.arm <= 0) { boom = true; hitPoint = { x: eh.x, y: eh.y, z: eh.z }; }
        }
        if (!hitPoint) { n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt; }
        else { n.x = hitPoint.x; n.y = hitPoint.y; n.z = hitPoint.z; }
        if (n.y < world.killY) { nades.splice(i, 1); continue; }
        if (boom) { explodeNade(n); nades.splice(i, 1); continue; }
        n.trail -= dt;
        if (n.trail <= 0) { n.trail = 0.015; G.particles?.trail(n, 0x6dff9a, 0.35, 0.3, 3); }
      }
      // ---- shockwaves
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const prev = r.r;
        r.r += r.speed * dt;
        const k = r.r / r.maxR;
        r.mesh.scale.set(r.r, r.height * (1 - k * 0.5), r.r);
        r.mesh.material.uniforms.uA.value = 1 - k;
        if (!r.hit && pl.alive) {
          const d = Math.hypot(pl.pos.x - r.x, pl.pos.z - r.z);
          const onGround = pl.pos.y < r.y + r.height * 0.9;
          if (d >= prev - 0.6 && d <= r.r + 0.6 && onGround) {
            r.hit = true;
            if (pl.damage(r.dmg, { x: r.x, y: r.y, z: r.z }, 'shockwave')) {
              pl.vel.y = 6; pl.grounded = false;
              const nx = (pl.pos.x - r.x) / (d || 1), nz = (pl.pos.z - r.z) / (d || 1);
              pl.vel.x += nx * 8; pl.vel.z += nz * 8;
            }
          }
        }
        if (r.r >= r.maxR) {
          G.scene.remove(r.mesh);
          r.mesh.material.dispose();
          rings.splice(i, 1);
        }
      }
      // ---- draw orbs
      let c = 0;
      for (const o of orbs) {
        dummy.position.set(o.x, o.y, o.z);
        dummy.scale.setScalar(o.r * (0.9 + Math.sin(G.time * 30 + c) * 0.1));
        dummy.updateMatrix();
        mesh.setMatrixAt(c, dummy.matrix);
        col.set(o.color);
        colors.array[c * 4] = col.r * o.intensity; colors.array[c * 4 + 1] = col.g * o.intensity; colors.array[c * 4 + 2] = col.b * o.intensity; colors.array[c * 4 + 3] = 1;
        c++;
      }
      for (const n of nades) {
        dummy.position.set(n.x, n.y, n.z);
        dummy.scale.setScalar(0.17);
        dummy.updateMatrix();
        mesh.setMatrixAt(c, dummy.matrix);
        colors.array[c * 4] = 0.4 * 5; colors.array[c * 4 + 1] = 1 * 5; colors.array[c * 4 + 2] = 0.6 * 5; colors.array[c * 4 + 3] = 1;
        c++;
      }
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      colors.needsUpdate = true;
    },

    clear() {
      orbs.length = 0; nades.length = 0;
      for (const r of rings) { G.scene.remove(r.mesh); r.mesh.material.dispose(); }
      rings.length = 0;
      mesh.count = 0;
    },
  };

  function explodeNade(n) {
    const def = n.def;
    const mods = G.augments?.mods || {};
    const radius = def.radius * (mods.blastRadius ?? 1);
    const dmg = def.dmg * (mods.damage ?? 1) * (G.player.odActive > 0 ? 1.5 : 1) * (G.augments?.situationalDamage() ?? 1);
    G.particles?.explosion(n, radius, 0x6dff9a, true);
    G.particles?.ring(n, radius, 0x9dffbe, 40, 0.3, 3);
    G.lights?.flash(n, 0x6dff9a, 45, radius * 3, 0.3);
    G.audio?.play('novaExplode', { pos: n });
    G.decals?.add(n, { x: 0, y: 1, z: 0 }, radius * 0.5, 0x6dff9a);
    if (mods.singularity) G.augments.singularity(n, radius);
    G.enemies.damageRadius(n, radius, dmg, 'nova', def.knock);
    // rocket jump: knock the player, no self damage
    const pl = G.player;
    const dx = pl.pos.x - n.x, dy = pl.pos.y + 0.9 - n.y, dz = pl.pos.z - n.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < radius) {
      const f = (1 - d / radius) * 16;
      pl.vel.x += dx / (d || 1) * f; pl.vel.y += Math.max(0, dy / (d || 1)) * f + f * 0.4; pl.vel.z += dz / (d || 1) * f;
      pl.grounded = false;
    }
    pl.addTrauma(clamp(0.5 - d / 40, 0.05, 0.4));
    G.events.emit('explosion', { x: n.x, y: n.y, z: n.z, radius });
  }

  return api;
}

// ============================================================================
// ELDERFALL — physics.js
// Lightweight dependency-free rigid-body layer: interactive props (crates,
// barrels, buckets, bones, skulls) that the player can shove, whack, and
// blast around. Sphere-approximated bodies, terrain + static-collider
// collision, tumble, damped bounce, sleep. Deliberately NOT a full engine —
// tuned for feel and mobile frame time (~0.2ms, bodies sleep aggressively).
// ============================================================================
import * as THREE from 'three';
import { terrainHeight, terrainNormal, POI, hash2, WATER_LEVEL } from './core.js';

const GRAV = 18;
const PROPS = [
  // [assetPath, radius, mass, count-per-site]
  ['hexagon/decoration/props/crate_A_small.gltf', 0.42, 1.0],
  ['hexagon/decoration/props/barrel.gltf', 0.40, 1.4],
  ['hexagon/decoration/props/bucket_empty.gltf', 0.30, 0.5],
  ['halloween/bone_A.gltf', 0.28, 0.35],
  ['halloween/bone_B.gltf', 0.28, 0.35],
  ['halloween/pumpkin_orange.gltf', 0.34, 0.6],
];

// Scatter sites: [x, z, radius, propIndices]
const SITES = [
  [POI.village.x + 14, POI.village.z + 8, 10, [0, 1, 2]],   // market side
  [POI.village.x - 18, POI.village.z - 12, 8, [0, 1]],      // forge side
  [POI.camp.x, POI.camp.z, 12, [0, 1, 5]],                  // bandit camp
  [POI.ruins.x, POI.ruins.z, 16, [3, 4]],                   // bones in ruins
  [POI.ruins.x + 30, POI.ruins.z + 22, 10, [3, 4, 5]],      // cemetery edge
  [POI.tower.x + 6, POI.tower.z + 6, 6, [0, 2]],
];

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export function createPhysics(g) {
  const bodies = [];
  const group = new THREE.Group();
  group.name = 'physicsProps';
  g.scene.add(group);

  let seed = 9001;
  for (const [sx, sz, sr, idxs] of SITES) {
    for (let i = 0; i < idxs.length + 2; i++) {
      const pi = idxs[i % idxs.length];
      const [path, radius, mass] = PROPS[pi];
      const a = hash2(seed, i * 7 + 1) * Math.PI * 2;
      const d = 2 + hash2(seed, i * 13 + 2) * sr;
      const x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d;
      const y = terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.5) { seed++; continue; }
      const body = {
        pos: new THREE.Vector3(x, y + radius, z),
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(seed, i) * 6.28),
        radius, mass, sleeping: true, mesh: null,
      };
      bodies.push(body);
      // async visual attach
      const holder = new THREE.Group();
      holder.position.copy(body.pos);
      group.add(holder);
      body.mesh = holder;
      g.assets?.prop(path).then((m) => {
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        const s = (radius * 2) / Math.max(size.x, size.y, size.z, 0.001);
        m.scale.setScalar(s);
        const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
        m.position.sub(c); // center on body
        holder.add(m);
      }).catch(() => {
        const m = new THREE.Mesh(fallbackGeo, fallbackMat);
        m.scale.setScalar(radius * 1.6);
        holder.add(m);
      });
      seed++;
    }
  }
  const fallbackGeo = new THREE.BoxGeometry(1, 1, 1);
  const fallbackMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44 });

  function wake(b) { b.sleeping = false; }

  function impulse(pos, radius, force) {
    for (const b of bodies) {
      const d = b.pos.distanceTo(pos);
      if (d > radius) continue;
      const f = force * (1 - d / radius) / b.mass;
      _v.copy(b.pos).sub(pos).normalize();
      _v.y = Math.max(_v.y, 0.35); // pop upward — reads great
      b.vel.addScaledVector(_v, f);
      b.angVel.set((Math.random() - 0.5) * 6 * f, (Math.random() - 0.5) * 6 * f, (Math.random() - 0.5) * 6 * f);
      wake(b);
    }
  }

  // Melee swings shove nearby props (no combat.js coupling needed)
  g.events.on('attackSwing', ({ heavy }) => {
    const cam = g.camera;
    _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const target = _v.multiplyScalar(1.6).add(cam.position);
    impulse(target, 2.2, heavy ? 7 : 4.5);
  });
  g.events.on('hitLanded', ({ pos }) => {
    if (pos && pos.x !== undefined) {
      _v.set(pos.x, pos.y, pos.z);
      impulse(_v, 2.0, 3);
    }
  });

  let soundCd = 0;

  return {
    impulse,
    update(dt) {
      if (g.paused || dt === 0) return;
      soundCd -= dt;
      const p = g.player;
      for (const b of bodies) {
        // player shove
        if (p) {
          const dx = b.pos.x - p.position.x, dz = b.pos.z - p.position.z;
          const dd = Math.hypot(dx, dz);
          const minD = b.radius + (p.radius || 0.45);
          if (dd < minD && Math.abs(b.pos.y - p.position.y) < 1.6) {
            const push = (minD - dd) * 6 / b.mass;
            b.vel.x += (dx / (dd || 1)) * push;
            b.vel.z += (dz / (dd || 1)) * push;
            wake(b);
          }
        }
        if (b.sleeping) continue;

        b.vel.y -= GRAV * dt;
        b.pos.addScaledVector(b.vel, dt);

        // terrain collision
        const ground = terrainHeight(b.pos.x, b.pos.z) + b.radius;
        if (b.pos.y < ground) {
          b.pos.y = ground;
          const n = terrainNormal(b.pos.x, b.pos.z);
          const vn = b.vel.x * n.x + b.vel.y * n.y + b.vel.z * n.z;
          if (vn < 0) {
            const rest = 0.32;
            b.vel.x -= (1 + rest) * vn * n.x;
            b.vel.y -= (1 + rest) * vn * n.y;
            b.vel.z -= (1 + rest) * vn * n.z;
            // impact tumble + friction
            b.angVel.x += b.vel.z * 1.5; b.angVel.z -= b.vel.x * 1.5;
            b.vel.x *= 0.82; b.vel.z *= 0.82;
            if (Math.abs(vn) > 2.2 && soundCd <= 0) { g.audio?.play('footstep_stone', { volume: 0.4 }); soundCd = 0.12; }
          }
        }

        // static colliders (cylinders)
        for (let i = 0; i < g.colliders.length; i++) {
          const c = g.colliders[i];
          const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
          const dd = Math.hypot(dx, dz);
          const minD = c.r + b.radius;
          if (dd < minD && dd > 0.0001) {
            b.pos.x = c.x + (dx / dd) * minD;
            b.pos.z = c.z + (dz / dd) * minD;
            const vn = (b.vel.x * dx + b.vel.z * dz) / dd;
            if (vn < 0) { b.vel.x -= 1.4 * vn * (dx / dd); b.vel.z -= 1.4 * vn * (dz / dd); }
          }
        }

        // water: float-ish drag
        if (b.pos.y - b.radius < WATER_LEVEL) {
          b.vel.multiplyScalar(1 - 2.5 * dt);
          b.vel.y += GRAV * 1.4 * dt; // buoyant
        }

        // damping + tumble integration
        b.vel.multiplyScalar(1 - 0.6 * dt);
        b.angVel.multiplyScalar(1 - 2.0 * dt);
        const w = b.angVel.length();
        if (w > 0.01) {
          _axis.copy(b.angVel).multiplyScalar(1 / w);
          _q.setFromAxisAngle(_axis, w * dt);
          b.quat.premultiply(_q);
        }

        // sleep
        if (b.vel.lengthSq() < 0.02 && b.angVel.lengthSq() < 0.05 && b.pos.y <= ground + 0.02) {
          b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); b.sleeping = true;
        }

        b.mesh.position.copy(b.pos);
        b.mesh.quaternion.copy(b.quat);
      }
    },
  };
}

// ============================================================================
// RANGE — physics.js
// Rapier (WASM) wrapper: static range colliders, ray queries for bullets,
// rigid-body brass and dropped magazines, hinged steel gongs.
// Every collider carries a `hit` descriptor { material, thickness, target }
// used by the projectile manager to decide penetration / ricochet / scoring.
// ============================================================================
import * as THREE from 'three';
import RAPIER from '../vendor/rapier3d-compat.mjs';

export async function createPhysics() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  const hitInfo = new Map();          // collider handle → { material, thickness, target, name }
  const bodies = [];                  // dynamic bodies we sync to meshes: { body, mesh|instance, kind }
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  const _v = new THREE.Vector3();

  const api = {
    RAPIER, world, hitInfo, bodies,
    /** static cuboid: center [x,y,z], half extents [hx,hy,hz], quaternion optional */
    addStaticBox(center, half, hit, quat) {
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]));
      if (quat) rb.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, false);
      const col = world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setFriction(0.6).setRestitution(0.25), rb);
      hitInfo.set(col.handle, hit);
      return { rb, col };
    },
    /** static trimesh from a BufferGeometry (world-space vertices) */
    addStaticMesh(geometry, hit) {
      const pos = geometry.attributes.position.array;
      const idx = geometry.index ? geometry.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const col = world.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(pos), Uint32Array.from(idx)).setFriction(0.8).setRestitution(0.1), rb);
      hitInfo.set(col.handle, hit);
      return { rb, col };
    },
    /** static cylinder along Y */
    addStaticCylinder(center, radius, halfHeight, hit) {
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1], center[2]));
      const col = world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius), rb);
      hitInfo.set(col.handle, hit);
      return { rb, col };
    },
    /**
     * Hinged plate (steel gong): a dynamic cuboid hanging from a fixed anchor by a revolute joint.
     * center = plate centre, hinge at (center.y + hangLen). Returns { rb, col }.
     */
    addHingedPlate(center, half, hangLen, hit, massKg = 8) {
      const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center[0], center[1] + hangLen, center[2]));
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(center[0], center[1], center[2]).setLinearDamping(0.6).setAngularDamping(0.8));
      const col = world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setMass(massKg).setRestitution(0.1), rb);
      const joint = world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: hangLen, z: 0 }, { x: 1, y: 0, z: 0 }), anchor, rb, true);
      hitInfo.set(col.handle, hit);
      return { rb, col, joint };
    },
    /** dynamic cylinder (brass case) along the body's local Z axis */
    addCase(pos, quat, linvel, angvel, len, radius, massKg) {
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinvel(linvel.x, linvel.y, linvel.z).setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }).setLinearDamping(0.05).setAngularDamping(0.4).setCcdEnabled(true);
      const rb = world.createRigidBody(desc);
      // Rapier cylinders are along local Y; rotate the collider so its axis is the body's Z
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const cd = RAPIER.ColliderDesc.cylinder(len / 2, radius).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setMass(massKg).setRestitution(0.38).setFriction(0.35);
      const col = world.createCollider(cd, rb);
      hitInfo.set(col.handle, { material: 'brass', thickness: 0.0005, name: 'case', noHit: true });
      return rb;
    },
    addBox(pos, quat, linvel, half, massKg) {
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }).setLinvel(linvel.x, linvel.y, linvel.z).setLinearDamping(0.1).setAngularDamping(0.5).setCcdEnabled(true);
      const rb = world.createRigidBody(desc);
      const col = world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setMass(massKg).setRestitution(0.2).setFriction(0.5), rb);
      hitInfo.set(col.handle, { material: 'polymer', thickness: 0.002, name: 'mag', noHit: true });
      return rb;
    },
    remove(rb) { world.removeRigidBody(rb); },
    /**
     * Ray cast against everything. Returns { point, normal, toi, hit (descriptor), collider } or null.
     */
    castRay(origin, dir, maxToi, excludeNoHit = true) {
      ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
      ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
      const pred = excludeNoHit ? (c) => !(hitInfo.get(c.handle)?.noHit) : undefined;
      const h = world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, undefined, pred);
      if (!h) return null;
      const p = ray.pointAt(h.timeOfImpact ?? h.toi);
      return { point: new THREE.Vector3(p.x, p.y, p.z), normal: new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z), toi: h.timeOfImpact ?? h.toi, hit: hitInfo.get(h.collider.handle) || { material: 'concrete', thickness: 1 }, collider: h.collider };
    },
    /** thickness of a collider along a ray starting just inside it (exit distance). */
    exitDistance(collider, origin, dir, maxToi = 2) {
      ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z; ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
      const t = collider.castRay(ray, maxToi, false);
      return t == null || t < 0 ? null : t;
    },
    step(dt) {
      world.timestep = Math.min(1 / 30, Math.max(1 / 1000, dt));
      world.step();
    },
    v3(o) { return _v.set(o.x, o.y, o.z); },
  };
  return api;
}

// Pickups: repair orbs (health), shield cells, overdrive sparks. Magnetised toward the player.
import * as THREE from 'three';
import { G, fxLayer } from '../state.js';
import { rand, chance, TAU } from '../util.js';

const KINDS = {
  health: { color: 0x5dffa8, size: 0.2, value: 10 },
  shield: { color: 0x6ac8ff, size: 0.24, value: 25 },
  od: { color: 0xc6a0ff, size: 0.16, value: 8 },
};

export function createPickups() {
  const MAX = 120;
  const geo = new THREE.OctahedronGeometry(1, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;
  G.scene.add(fxLayer(mesh));
  const items = [];
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();

  function drop(kind, x, y, z, n = 1) {
    for (let i = 0; i < n; i++) {
      if (items.length >= MAX) items.shift();
      const a = rand(0, TAU), s = rand(2, 5);
      items.push({ kind, x, y, z, vx: Math.cos(a) * s, vy: rand(4, 7), vz: Math.sin(a) * s, life: 20, t: rand(0, 10), magnet: false });
    }
  }

  return {
    drop,
    onKill(e, ctx) {
      const pl = G.player;
      const low = pl.hp / pl.maxHp;
      const mods = G.augments?.mods || {};
      let hp = 0;
      if (ctx.shatter) hp = 3 + (mods.shatterOrbs ?? 0);
      else if (e.type === 'brute') hp = 2;
      else if (chance(low < 0.35 ? 0.45 : e.type === 'mite' ? 0.1 : 0.22)) hp = 1;
      if (e.elite) hp += 2;
      if (hp) drop('health', e.pos.x, e.pos.y, e.pos.z, hp);
      if (ctx.shatter || chance(0.12)) drop('shield', e.pos.x, e.pos.y, e.pos.z, 1);
      if (e.type !== 'mite' && chance(0.35)) drop('od', e.pos.x, e.pos.y, e.pos.z, 2);
    },
    update(dt) {
      const pl = G.player;
      const ep = pl.pos;
      let n = 0;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.life -= dt; it.t += dt;
        if (it.life <= 0) { items.splice(i, 1); continue; }
        const dx = ep.x - it.x, dy = ep.y + 1 - it.y, dz = ep.z - it.z;
        const d = Math.hypot(dx, dy, dz);
        const wantsIt = !(it.kind === 'health' && pl.hp >= pl.maxHp) && !(it.kind === 'shield' && pl.shield >= pl.maxShield);
        const range = (G.augments?.mods.magnet ?? 1) * 6.5;
        if (pl.alive && wantsIt && (d < range || it.magnet)) {
          it.magnet = true;
          const s = 14 + (range - Math.min(d, range)) * 3;
          it.vx = dx / d * s; it.vy = dy / d * s; it.vz = dz / d * s;
        } else {
          it.magnet = false; // topped off mid-flight: let it fall and settle instead of drifting through walls
          it.vy -= 16 * dt;
          it.vx *= Math.exp(-2 * dt); it.vz *= Math.exp(-2 * dt);
        }
        it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
        if (!it.magnet) {
          const g = G.world.groundHeight(it.x, it.z, 0.05, it.y + 0.6);
          if (it.y < g + 0.45) { it.y = g + 0.45; it.vy = Math.abs(it.vy) * 0.3; }
          if (it.y < G.world.killY) { items.splice(i, 1); continue; }
        }
        if (d < 1.1 && pl.alive && wantsIt) {
          const k = KINDS[it.kind];
          if (it.kind === 'health') { pl.heal(k.value * (G.augments?.mods.healMul ?? 1)); G.audio?.play('pickupHealth', { volume: 0.6 }); G.hud?.pulse('heal'); }
          else if (it.kind === 'shield') { pl.addShield(k.value); G.audio?.play('pickupShield', { volume: 0.6 }); G.hud?.pulse('shield'); }
          else { pl.addOverdrive(k.value); G.audio?.play('pickupOrb', { volume: 0.5 }); }
          G.particles?.sparkle(it, k.color, 6, 0.3);
          items.splice(i, 1);
          continue;
        }
        if (it.kind === 'od' && !it.magnet && d < 16) it.magnet = true;
      }
      for (const it of items) {
        const k = KINDS[it.kind];
        dummy.position.set(it.x, it.y + Math.sin(it.t * 3) * 0.08, it.z);
        dummy.rotation.set(it.t * 1.3, it.t * 2, 0);
        const blink = it.life < 3 ? (Math.sin(it.t * 20) > 0 ? 1 : 0.3) : 1;
        dummy.scale.setScalar(k.size * blink);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        c.set(k.color).multiplyScalar(3.5);
        mesh.setColorAt(n, c);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    clear() { items.length = 0; mesh.count = 0; },
    // collect everything instantly (end of floor)
    vacuum() { for (const it of items) it.magnet = true; },
  };
}

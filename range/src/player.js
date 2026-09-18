// ============================================================================
// RANGE — player.js
// First-person controller: pointer lock look, WASD, sprint, crouch, lean
// (cants the rifle → real cant error downrange), breath hold, muzzle-blocked
// detection against the range geometry, soft collision with benches/dividers.
// ============================================================================
import * as THREE from 'three';
import { RANGE } from './world.js';

const KEYS = { w: 'fwd', s: 'back', a: 'left', d: 'right', shift: 'shift', c: 'crouch', q: 'leanL', e: 'leanR', ' ': 'space' };

export class Player {
  constructor(camera, dom, physics) {
    this.camera = camera; this.dom = dom; this.physics = physics;
    this.pos = new THREE.Vector3(2, 0, 4.0); this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.eye = RANGE.eyeHeight; this.crouchT = 0; this.leanT = 0; this.vel = new THREE.Vector3();
    this.keys = {}; this.mouse = { dx: 0, dy: 0 }; this.buttons = { l: false, r: false };
    this.sensitivity = 0.0022; this.fovScale = 1; this.locked = false; this.adsToggle = false; this.adsHeld = false;
    this.lookDelta = { yaw: 0, pitch: 0 }; this.moveSpeed = 0; this.blocked = 0; this.bobPhase = 0;
    this.onKey = null; this.onMouse = null;
    dom.addEventListener('mousemove', (e) => { if (!this.locked) return; this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    window.addEventListener('keydown', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase(); if (KEYS[k]) this.keys[KEYS[k]] = true; this.onKey?.(k, true, e); if (['Tab', ' '].includes(e.key)) e.preventDefault(); });
    window.addEventListener('keyup', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase(); if (KEYS[k]) this.keys[KEYS[k]] = false; this.onKey?.(k, false, e); });
    dom.addEventListener('mousedown', (e) => { if (!this.locked) return; if (e.button === 0) this.buttons.l = true; if (e.button === 2) this.buttons.r = true; this.onMouse?.(e.button, true); });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.buttons.l = false; if (e.button === 2) this.buttons.r = false; this.onMouse?.(e.button, false); });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.viewKick = { pitch: 0, yaw: 0, roll: 0 }; this.viewClimb = { pitch: 0, yaw: 0 };
  }
  lock() { this.dom.requestPointerLock?.(); }
  unlock() { document.exitPointerLock?.(); }

  /** dt = real seconds, ts = time scale */
  update(dt, ts = 1) {
    // look (never time-scaled)
    const s = this.sensitivity * this.fovScale;
    const dyaw = -this.mouse.dx * s, dpitch = -this.mouse.dy * s; this.mouse.dx = 0; this.mouse.dy = 0;
    this.yaw += dyaw; this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch, -1.45, 1.45);
    this.lookDelta.yaw = dyaw; this.lookDelta.pitch = dpitch;
    // lean & crouch
    const lean = (this.keys.leanR ? 1 : 0) - (this.keys.leanL ? 1 : 0);
    this.leanT += (lean - this.leanT) * Math.min(1, dt * 8);
    // movement (keyboard or touch stick)
    const T = this.touch;
    const joyMag = T ? Math.hypot(T.joy.x, T.joy.y) : 0;
    const sprint = (this.keys.shift && (this.keys.fwd || this.keys.left || this.keys.right)) || (T && T.sprint);
    const crouchKey = this.keys.crouch || (T && T.crouch);
    this.crouchT += ((crouchKey ? 1 : 0) - this.crouchT) * Math.min(1, dt * 6);
    const speed = (sprint ? 4.2 : 1.5) * (1 - 0.45 * this.crouchT);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
    const wish = new THREE.Vector3();
    if (this.keys.fwd) wish.add(fwd); if (this.keys.back) wish.sub(fwd); if (this.keys.right) wish.add(right); if (this.keys.left) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    else if (joyMag > 0.05) wish.addScaledVector(fwd, -T.joy.y).addScaledVector(right, T.joy.x).multiplyScalar(speed * Math.min(1, joyMag / 0.85));
    const accel = wish.lengthSq() > 0 ? 12 : 16;
    this.vel.lerp(wish, Math.min(1, dt * accel));
    this.pos.addScaledVector(this.vel, dt * ts);
    this.moveSpeed = this.vel.length();
    // bounds: the covered firing line
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -RANGE.width / 2 - 1, RANGE.width / 2 + 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -1.2, RANGE.roofZ0 - 0.6);
    // soft collisions: benches (x lanes, z 2.15..3.05) and dividers (x = ±4, ±8; z 0.2..2.4)
    for (const bx of [-10, -6, -2, 2, 6, 10]) { const dx = this.pos.x - bx, dz = this.pos.z - 2.6; if (Math.abs(dx) < 1.0 && Math.abs(dz) < 0.75) { if (Math.abs(dz) / 0.75 > Math.abs(dx) / 1.0) this.pos.z = 2.6 + Math.sign(dz || 1) * 0.75; else this.pos.x = bx + Math.sign(dx || 1) * 1.0; } }
    for (const wx of [-8, -4, 0, 4, 8]) { const dx = this.pos.x - wx; if (Math.abs(dx) < 0.32 && this.pos.z > 0.1 && this.pos.z < 2.5) this.pos.x = wx + Math.sign(dx || 1) * 0.32; }
    // camera
    if (this.moveSpeed > 0.1) this.bobPhase += dt * ts * (sprint ? 9.5 : 7.2);
    const bob = Math.abs(Math.sin(this.bobPhase)) * 0.006 * Math.min(1, this.moveSpeed / 1.5);
    const eye = this.eye - 0.52 * this.crouchT - bob - Math.abs(this.leanT) * 0.06;
    this.roll = -this.leanT * 0.26;
    const camPos = this.pos.clone(); camPos.y += eye; camPos.addScaledVector(right, -this.leanT * 0.38 * -1);
    this.camera.position.copy(camPos);
    const e = new THREE.Euler(this.pitch + this.viewKick.pitch + this.viewClimb.pitch, this.yaw + this.viewKick.yaw + this.viewClimb.yaw, this.roll + this.viewKick.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
    this.camera.updateMatrixWorld(true);
    // muzzle blocked?
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const hit = this.physics.castRay(this.camera.position, dir, 1.1);
    const want = hit && hit.toi < (this.gunLength || 0.85) ? 1 : 0;
    this.blocked += (want - this.blocked) * Math.min(1, dt * 10);
    this.sprinting = !!sprint;
    return this.input(dt);
  }
  input() {
    const T = this.touch;
    return { ads: this.buttons.r || this.adsToggle, sprint: this.sprinting, moveSpeed: this.moveSpeed, lookDelta: this.lookDelta, breathHold: (this.keys.shift && !this.sprinting) || (T && T.breath), crouch: this.keys.crouch || (T && T.crouch), lean: this.leanT, blocked: this.blocked };
  }
}

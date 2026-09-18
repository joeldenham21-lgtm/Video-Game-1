// ============================================================================
// RANGE — viewmodel.js
// First-person weapon rig: procedural animation layers + handling state
// machine + fire-control logic.
//
// Scene graph (all in view-camera space):
//   camera → root → kick (recoil, pivoted at the support point)
//                     → sway (aim wobble, breathing, bob, look lag)
//                        → pose (hip ⇄ ADS ⇄ lowered base placement)
//                           → holder (rotated by the zero angle so the sight
//                                     line, not the bore, sits on the camera axis)
//                              → weapon.group, right hand, left hand
//
// Time-critical mechanics are explicit: trigger travel → sear break → lock
// time → ignition → barrel time → muzzle exit; the reciprocating mass is
// simulated by RecoilSim and drives the visible bolt carrier / slide.
// ============================================================================
import * as THREE from 'three';
import { SimplexNoise } from '../vendor/addons/math/SimplexNoise.js';
import { RecoilSim } from './recoil.js';
import { buildSequences, SequencePlayer } from './sequences.js';
import { POSES } from './hands.js';
import { CARTRIDGES, muzzleVelocity } from './cartridges.js';
import { solveZeroAngle, STD_ATMOSPHERE, MRAD, MOA, gaussian } from './ballistics.js';

const noise = new SimplexNoise();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _elbowR = new THREE.Vector3(), _elbowL = new THREE.Vector3(), _zAxis = new THREE.Vector3(0, 0, 1);
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export class ViewModel {
  /**
   * @param o.camera view camera (its world transform == the world camera)
   * @param o.weapons { id: api }  built weapon apis
   * @param o.hands { right, left } from buildHand
   * @param o.hooks { onShot(info), onEject(info), onDropMag(info), sound(name, opts), onDryFire() }
   */
  constructor(o) {
    this.camera = o.camera; this.hooks = o.hooks || {};
    this.weapons = o.weapons; this.hands = o.hands;
    this.root = new THREE.Group(); this.kick = new THREE.Group(); this.sway = new THREE.Group(); this.pose = new THREE.Group(); this.holder = new THREE.Group();
    this.camera.add(this.root); this.root.add(this.kick); this.kick.add(this.sway); this.sway.add(this.pose); this.pose.add(this.holder);
    this.holder.add(this.hands.right.group, this.hands.left.group);
    this.ws = {};           // per-weapon ammo/mode state
    this.recoils = {};      // per-weapon RecoilSim
    this.seqs = {};
    for (const id in this.weapons) {
      const w = this.weapons[id];
      this.ws[id] = { magRounds: w.spec.magCapacity, chambered: true, mode: w.spec.fireModes[0], ammoId: w.spec.defaultAmmo, cocked: true, dustOpen: false, elevClicks: 0, windClicks: 0, zeroRange: w.spec.zeroRange, scopeMag: w.spec.scope?.mag ?? 1 };
      if (w.spec.id === 'ar15') this.ws[id].mode = 'safe';
      this.recoils[id] = new RecoilSim(w.spec); if (w.spec.action === 'gas') this.recoils[id].feedDrag = 28;
      this.seqs[id] = buildSequences(w);
      w.group.visible = false;
    }
    this.player = new SequencePlayer();
    this.weapon = null; this.id = null;
    this.adsHeld = false; this.adsT = 0; this.lowT = 0; this.sprint = false; this.blocked = 0;
    this.trigger = 0; this.triggerHeld = false; this.triggerBroke = false; this.pendingIgnition = -1; this.shotSinceReset = false;
    this.time = 0; this.walkPhase = 0; this.moveSpeed = 0; this.breath = { hold: false, lung: 1, t: 0 };
    this.lag = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
    this.viewKick = { pitch: 0, yaw: 0, roll: 0 };    // camera offset from recoil + sway (radians) — read by the player
    this.viewClimb = { pitch: 0, yaw: 0 };            // persistent recoil climb the player must correct
    this.atm = STD_ATMOSPHERE; this.zeroAngle = 0; this.mv = 0;
    this.slowmo = 1;
    this.chVal = 0; this.chActive = false;
    this.feeding = false; this.rng = Math.random;
    this.stance = { crouch: 0, lean: 0 };
  }

  // ------------------------------------------------------------------ equip / state
  equip(id, immediate = false) {
    if (this.id === id) return;
    const doDraw = () => {
      if (this.weapon) { this.holder.remove(this.weapon.group); this.weapon.group.visible = false; }
      this.id = id; this.weapon = this.weapons[id]; this.recoil = this.recoils[id]; this.seq = this.seqs[id];
      this.holder.add(this.weapon.group); this.weapon.group.visible = true;
      this.state = this.ws[id];
      this.refreshBallistics();
      this.weapon.setSelector(this.state.mode);
      this.weapon.setDustCover(this.state.dustOpen ? 1 : 0);
      this.weapon.setMagVisible(true); this.weapon.setMagOffset(new THREE.Vector3(), new THREE.Euler());
      this.weapon.setMagTopRound(this.state.magRounds > 0);
      this.hands.right.snapPose('gripSafe'); this.hands.left.snapPose(this.weapon.spec.action === 'recoil' ? 'pistolSupport' : 'cclamp');
      this.applySeqState(null);
      if (!immediate) this.player.play(this.seq.draw, (e) => this.onSeqEvent(e));
    };
    if (this.weapon && !immediate) { this.player.play(this.seq.holster, () => {}); this.player.onDone = doDraw; }
    else doDraw();
  }
  get cart() { return CARTRIDGES[this.state.ammoId]; }
  refreshBallistics() {
    const w = this.weapon, c = this.cart;
    this.mv = muzzleVelocity(c, w.spec.barrelIn);
    // sights are zeroed under standard conditions at the weapon's zero range; turret clicks add on top
    this.zeroAngle = solveZeroAngle({ massKg: c.bulletMassG / 1000, diameterM: c.diameterMm / 1000, bc: c.bc, model: c.model, mv: this.mv, sightHeight: w.spec.sightHeight, zeroRange: this.state.zeroRange, atm: STD_ATMOSPHERE });
    const click = w.spec.scope ? w.spec.scope.clickMrad * MRAD : 0.5 * MOA;
    this.holder.rotation.set(this.zeroAngle + this.state.elevClicks * click, -this.state.windClicks * click, 0);
    w.setTurrets?.(this.state.elevClicks, this.state.windClicks);
  }
  cycleAmmo() {
    const list = Object.values(CARTRIDGES).filter(c => c.caliber === this.weapon.spec.caliber).map(c => c.id);
    const i = list.indexOf(this.state.ammoId); this.state.ammoId = list[(i + 1) % list.length];
    this.refreshBallistics(); this.hooks.sound?.('uiTick'); return this.cart;
  }
  setZeroRange(r) { this.state.zeroRange = r; this.refreshBallistics(); }
  clickTurret(which, dir) { if (which === 'elev') this.state.elevClicks += dir; else this.state.windClicks += dir; this.refreshBallistics(); this.hooks.sound?.('turretClick'); }
  toggleMode() {
    const modes = this.weapon.spec.id === 'ar15' ? ['safe', 'semi', 'auto'] : this.weapon.spec.id === 'bolt' ? ['safe', 'semi'] : ['semi'];
    if (modes.length < 2) return;
    const i = modes.indexOf(this.state.mode); this.state.mode = modes[(i + 1) % modes.length];
    this.weapon.setSelector(this.state.mode); this.hooks.sound?.('selector');
  }
  get busy() { return this.player.active; }

  // ------------------------------------------------------------------ handling actions
  reload() {
    if (this.busy) return;
    const s = this.state, w = this.weapon;
    const empty = !s.chambered && s.magRounds === 0;
    this.player.play(empty || this.recoil.held ? this.seq.reloadEmpty : this.seq.reloadTac, (e) => this.onSeqEvent(e));
    this.reloadWasEmpty = empty || this.recoil.held;
    if (w.spec.action !== 'bolt') this.hooks.sound?.('cloth');
  }
  chargeAction() {
    if (this.busy) return;
    if (this.weapon.spec.action === 'bolt') { this.player.play(this.seq.boltCycle, (e) => this.onSeqEvent(e)); return; }
    this.player.play(this.seq.charge, (e) => this.onSeqEvent(e));
  }
  inspect() { if (this.busy) return; this.player.play(this.seq.inspect, (e) => this.onSeqEvent(e)); this.player.onDone = () => { if (this.state.dustOpen) { this.state.dustOpen = false; this.weapon.setDustCover(0); this.hooks.sound?.('dustCover'); } }; }
  pressCheck() { if (this.busy || !this.seq.pressCheck) return; this.player.play(this.seq.pressCheck, (e) => this.onSeqEvent(e)); }

  onSeqEvent(e) {
    const s = this.state, w = this.weapon, snd = (n, o) => this.hooks.sound?.(n, o);
    switch (e) {
      case 'magRelease': w.setMagRelease(1); snd('magRelease'); break;
      case 'magOut': snd('magOut'); w.setMagTopRound(s.magRounds > 0); break;
      case 'magDropped': { this.dropMag(); break; }
      case 'magStow': break;
      case 'magGrab': w.setMagTopRound(true); this.newMagRounds = w.spec.magCapacity; break;
      case 'magIn': s.magRounds = this.newMagRounds ?? w.spec.magCapacity; w.setMagRelease(0); snd('magIn'); w.setMagTopRound(true); break;
      case 'boltRelease': snd('boltRelease'); this.recoil.release(true); this.feeding = s.magRounds > 0; break;
      case 'chStart': this.chActive = true; this.recoil.held = true; this.ejectedDuringPull = false; break;
      case 'chRear': break;
      case 'chRelease': this.chActive = false; this.recoil.release(true); this.feeding = s.magRounds > 0; snd('chRelease'); break;
      case 'chHome': this.chActive = false; this.recoil.setManual(0); this.recoil.held = false; snd('chHome'); break;
      case 'slideRack': this.chActive = false; this.recoil.setManual(1); if (s.chambered && !this.ejectedDuringPull) { this.eject(false); s.chambered = false; } snd('slideRack'); break;
      case 'slideRelease': this.recoil.release(true); this.feeding = s.magRounds > 0; snd('slideRelease'); break;
      case 'boltLift': snd('boltLift'); s.cocked = true; break;
      case 'boltRear': if (s.chambered || s.spentInChamber) { this.eject(!!s.spentInChamber); s.chambered = false; s.spentInChamber = false; } snd('boltRear'); break;
      case 'boltHome': if (s.magRounds > 0) { s.magRounds--; s.chambered = true; w.setMagTopRound(s.magRounds > 0); } snd('boltHome'); break;
      case 'boltLock': snd('boltLock'); break;
    }
  }
  dropMag() {
    const w = this.weapon; w.parts.mag.obj.updateMatrixWorld(true);
    const pos = new THREE.Vector3().setFromMatrixPosition(w.parts.mag.obj.matrixWorld);
    const quat = new THREE.Quaternion().setFromRotationMatrix(w.parts.mag.obj.matrixWorld);
    this.hooks.onDropMag?.({ pos, quat, vel: new THREE.Vector3(0, -0.3, 0), weapon: w, rounds: this.state.magRounds });
    this.state.magRounds = 0;
  }
  eject(spent = true) {
    const w = this.weapon, A = w.anchors.ejection;
    w.group.updateMatrixWorld(true);
    const pos = _v.copy(A.pos).applyMatrix4(w.group.matrixWorld).clone();
    const dir = _v2.copy(A.dir).transformDirection(w.group.matrixWorld).clone();
    const vel = dir.multiplyScalar(A.speed * (0.8 + 0.4 * this.rng()));
    vel.x += (this.rng() - 0.5) * 1.2; vel.y += (this.rng() - 0.3) * 1.0; vel.z += (this.rng() - 0.5) * 1.0;
    const quat = new THREE.Quaternion().setFromRotationMatrix(w.group.matrixWorld);
    const ang = new THREE.Vector3((this.rng() - 0.5) * 60, (this.rng() - 0.5) * 60, (this.rng() - 0.5) * 40);
    this.hooks.onEject?.({ pos, vel, quat, angVel: ang, cart: this.cart, spent });
  }

  // ------------------------------------------------------------------ fire control
  fireDown() {
    this.triggerHeld = true;
    if (this.busy) return;
    if (this.state.mode === 'safe') { this.hooks.sound?.('safeClick'); this.hooks.onSafe?.(); return; }
    this.pulling = true;
  }
  fireUp() { this.triggerHeld = false; this.pulling = false; }

  /** called at ignition: the primer fires, the bullet leaves after the barrel time */
  ignite() {
    const s = this.state, w = this.weapon;
    if (!s.chambered) { this.hooks.onDryFire?.(); this.hooks.sound?.('dryFire'); s.cocked = false; return; }
    s.chambered = false; s.cocked = false;
    const cart = this.cart;
    const barrelTime = (w.spec.barrelIn * 0.0254) / (this.mv * 0.55); // average in-bore speed ≈ 55% of MV
    this.shotSinceReset = true;
    this.pendingExit = { t: barrelTime, cart };
  }
  muzzleExit(cart) {
    const s = this.state, w = this.weapon;
    // bore direction and muzzle position from the live rig transform
    w.group.updateMatrixWorld(true);
    const origin = _v.copy(w.anchors.muzzle).applyMatrix4(w.group.matrixWorld).clone();
    const dir = _v2.copy(w.anchors.boreDir).transformDirection(w.group.matrixWorld).clone();
    // dispersion: rifle + ammo (extreme spread ≈ 2.5σ each, combined in quadrature)
    const es = Math.hypot(w.spec.dispersionMoa, cart.accuracyMoa) * MOA;
    const sigma = es / 2.5;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, gaussian(this.rng) * sigma).addScaledVector(up, gaussian(this.rng) * sigma).normalize();
    // recoil + action cycling
    const hold = s.magRounds === 0 && w.spec.action !== 'bolt';
    this.recoil.holdAtRear = hold;
    this.recoil.stanceFactor = this.stanceFactor();
    this.recoil.fire(this.mv, cart, { rng: this.rng });
    this.feeding = s.magRounds > 0;
    if (w.spec.action === 'bolt') s.spentInChamber = true;
    if (w.spec.action === 'gas' && !s.dustOpen) { s.dustOpen = true; w.setDustCover(1); }
    const info = { origin, dir, mv: this.mv, cart, weapon: w, twistMm: w.spec.twistMm, muzzleWorld: origin, boreDirWorld: dir.clone() };
    this.hooks.onShot?.(info);
    this.lastShotTime = this.time;
  }
  stanceFactor() { return (1 + 0.35 * (1 - this.adsT)) * (1 + 0.4 * Math.min(1, this.moveSpeed / 2)) * (1 - 0.15 * this.stance.crouch); }

  // ------------------------------------------------------------------ per-frame update
  /**
   * @param dt seconds (already time-scaled for slow motion)
   * @param input { ads, sprint, moveSpeed (m/s), lookDelta {yaw, pitch} (rad this frame), breathHold, crouch, lean, blocked (0..1) }
   */
  update(dt, input) {
    if (!this.weapon) return;
    this.time += dt;
    const w = this.weapon, s = this.state, rc = this.recoil, spec = w.spec;
    this.moveSpeed = input.moveSpeed || 0;
    this.stance.crouch += ((input.crouch ? 1 : 0) - this.stance.crouch) * Math.min(1, dt * 6);
    this.stance.lean = input.lean || 0;
    // --- sequence playback
    this.player.update(dt);
    if (this.player.done && this.player.onDone) { const f = this.player.onDone; this.player.onDone = null; f(); }
    this.applySeqState(this.player.active ? this.player.state : null);

    // --- ADS / lowered blend
    const wantAds = input.ads && !this.player.active && !input.sprint && this.blocked < 0.5;
    const adsRate = 1 / (spec.action === 'recoil' ? 0.20 : spec.action === 'bolt' ? 0.38 : 0.26);
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * Math.min(1, dt * adsRate * 4.2);
    const wantLow = (input.sprint && this.moveSpeed > 0.5) || input.blocked > 0.5;
    this.lowT += ((wantLow ? 1 : 0) - this.lowT) * Math.min(1, dt * 5);
    this.blocked = input.blocked || 0;

    // --- trigger mechanics
    this.updateTrigger(dt);

    // --- recoil / action sim
    if (this.chActive) rc.setManual(this.chVal);
    const events = rc.update(dt);
    for (const ev of events) this.onActionEvent(ev);
    if (spec.action === 'bolt') { /* bolt driven by sequence */ } else if (!this.chActive) w.setActionPos(rc.actionPos);
    if (spec.action === 'gas' && this.chActive) { w.setChargingHandle(this.chVal); w.setActionPos(this.chVal); }
    else if (spec.action === 'gas') w.setChargingHandle(0);
    // eject during a manual full pull once the carrier passes 85% of the stroke
    if (this.chActive && this.chVal > 0.85 && !this.ejectedDuringPull) { this.ejectedDuringPull = true; if (s.chambered) { this.eject(false); s.chambered = false; } }

    // --- procedural layers
    this.updateSwayAndPose(dt, input);
    this.updateHands(dt);
    this.aimForearms();
  }

  updateTrigger(dt) {
    const spec = this.weapon.spec, s = this.state;
    const pullTime = 0.055, returnTime = 0.07;
    if (this.pulling && !this.busy && s.mode !== 'safe') {
      this.trigger = Math.min(1, this.trigger + dt / pullTime);
      if (!this.triggerBroke && this.trigger >= 0.85) {
        this.triggerBroke = true;
        if (s.cocked || spec.action !== 'bolt') {
          // sear releases → hammer/striker falls → primer ignites after the lock time
          this.hooks.sound?.(s.chambered ? 'hammerFall' : 'hammerFall', { quiet: true });
          if (s.chambered || spec.action === 'bolt' || spec.action === 'recoil' || spec.action === 'gas') {
            if (s.cocked || spec.action === 'gas' || spec.action === 'recoil') this.pendingIgnition = spec.lockTimeMs / 1000;
          }
          if (spec.action === 'bolt' && !s.cocked) { this.hooks.sound?.('deadTrigger'); }
          if (spec.action === 'recoil' && !s.chambered && this.recoil.held) this.pendingIgnition = -1; // slide locked back: trigger is dead
        }
      }
    } else {
      const wasBroke = this.triggerBroke;
      this.trigger = Math.max(0, this.trigger - dt / returnTime);
      if (this.trigger <= 0.45 && wasBroke) { this.triggerBroke = false; if (this.shotSinceReset) { this.hooks.sound?.('triggerReset'); this.shotSinceReset = false; } }
    }
    if (this.pendingIgnition >= 0) {
      this.pendingIgnition -= dt;
      if (this.pendingIgnition < 0) { this.pendingIgnition = -1; this.ignite(); }
    }
    if (this.pendingExit) { this.pendingExit.t -= dt; if (this.pendingExit.t <= 0) { const c = this.pendingExit.cart; this.pendingExit = null; this.muzzleExit(c); } }
    this.weapon.setTrigger(this.trigger);
  }

  onActionEvent(ev) {
    const s = this.state, w = this.weapon;
    if (ev.type === 'carrierRear') {
      if (s.spentPending !== false) this.eject(true);
      s.spentPending = false;
      this.hooks.sound?.(w.spec.action === 'recoil' ? 'slideRear' : 'carrierRear', { speed: ev.speed });
    } else if (ev.type === 'carrierHome') {
      if (this.feeding) { s.chambered = true; s.magRounds = Math.max(0, s.magRounds - 1); w.setMagTopRound(s.magRounds > 0); s.cocked = true; this.feeding = false; }
      this.hooks.sound?.(w.spec.action === 'recoil' ? 'slideHome' : 'carrierHome', { speed: ev.speed });
      s.spentPending = true;
      // full auto: the auto sear releases the hammer as the carrier closes
      if (s.mode === 'auto' && this.triggerHeld && s.chambered && !this.busy) this.pendingIgnition = 0.004;
    } else if (ev.type === 'holdOpen') {
      this.hooks.sound?.('holdOpen');
    }
  }

  applySeqState(st) {
    const w = this.weapon, A = w.anchors;
    // defaults: gun at rest, hands on the grips, mag seated
    const gun = st?.gun, lh = st?.lh, rh = st?.rh, mag = st?.mag;
    // sequence offsets rotate the weapon about its handling centre (the magazine seat), not the model origin
    const pivot = A.magSeat;
    w.group.rotation.set(0, 0, 0); w.group.position.set(0, 0, 0);
    if (gun) { w.group.rotation.copy(gun.rot); w.group.position.copy(gun.pos).add(pivot).sub(_v.copy(pivot).applyEuler(gun.rot)); }
    this.seqGun = gun;
    const R = this.hands.right.group, L = this.hands.left.group;
    const rhT = rh || { pos: A.gripR.pos, rot: A.gripR.rot, pose: null };
    const lhT = lh || { pos: A.gripL.pos, rot: A.gripL.rot, pose: null };
    // hands live in the weapon frame: apply the same offset to them
    R.position.copy(rhT.pos); R.rotation.copy(rhT.rot);
    L.position.copy(lhT.pos); L.rotation.copy(lhT.rot);
    if (gun) { R.position.applyEuler(gun.rot).add(w.group.position); L.position.applyEuler(gun.rot).add(w.group.position); _q.setFromEuler(gun.rot); R.quaternion.premultiply(_q); L.quaternion.premultiply(_q); }
    this.rhPose = rhT.pose; this.lhPose = lhT.pose;
    if (mag) { w.setMagVisible(mag.vis !== false); w.setMagOffset(mag.pos || new THREE.Vector3(), mag.rot || new THREE.Euler()); }
    else { w.setMagVisible(true); w.setMagOffset(new THREE.Vector3(), new THREE.Euler()); }
    if (st && st.ch !== undefined) this.chVal = st.ch;
    if (st && st.bolt && w.setBolt) w.setBolt(st.bolt.lift, st.bolt.pull);
  }
  /** point each forearm from its wrist toward the shoulder (camera space) */
  aimForearms() {
    this.holder.updateMatrixWorld(true);
    const camInv = _m.copy(this.camera.matrixWorld).invert();
    const pistol = this.weapon.spec.action === 'recoil';
    // elbow positions in camera space: pistol = both arms extended (isosceles), rifle = right elbow down, left elbow under the handguard
    if (pistol) { _elbowR.set(0.24, -0.38, -0.02); _elbowL.set(-0.24, -0.38, -0.02); } else { _elbowR.set(0.26, -0.36, 0.14); _elbowL.set(-0.30, -0.58, -0.22); }
    for (const [hand, shoulder] of [[this.hands.right, _elbowR], [this.hands.left, _elbowL]]) {
      const wrist = _v.setFromMatrixPosition(hand.group.matrixWorld).applyMatrix4(camInv);       // wrist in camera space
      const dirCam = _v2.subVectors(shoulder, wrist).normalize();
      // camera space → hand local: dir_local = inv(handWorldQuat) * camQuat * dirCam
      hand.group.getWorldQuaternion(_q).invert();
      const dirWorld = dirCam.applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
      const local = dirWorld.applyQuaternion(_q);
      if (hand.side === 'left') local.x *= -1;
      hand.armPivot.quaternion.setFromUnitVectors(_zAxis, local.normalize());
    }
  }

  updateSwayAndPose(dt, input) {
    const w = this.weapon, spec = w.spec, A = w.anchors, rc = this.recoil;
    const t = this.time;
    // ---- breathing & aim wobble
    const br = this.breath;
    if (input.breathHold && br.lung > 0 && this.adsT > 0.5) { br.hold = true; br.lung = Math.max(0, br.lung - dt / 7); }
    else { br.hold = false; br.lung = Math.min(1, br.lung + dt / 4); }
    const winded = Math.min(1, this.moveSpeed / 4);
    const breathAmp = (br.hold ? 0.08 + (1 - br.lung) * 0.9 : 1.0) * (1 + 1.5 * winded);
    const breathe = Math.sin(t * Math.PI * 2 * 0.24) * 0.0009 * breathAmp;              // rad, ~14 breaths/min
    const wob = (1 - 0.65 * this.adsT) * (1 + 0.5 * winded) * (br.hold ? 0.35 + (1 - br.lung) * 1.5 : 1) * (1 - 0.25 * this.stance.crouch);
    const nP = noise.noise(t * 0.55, 1.3) * 0.6 + noise.noise(t * 1.9, 7.1) * 0.3 + noise.noise(t * 5.5, 3.3) * 0.1;
    const nY = noise.noise(t * 0.5, 11.7) * 0.6 + noise.noise(t * 1.7, 5.9) * 0.3 + noise.noise(t * 6.1, 9.2) * 0.1;
    const swayPitch = nP * 0.0035 * wob + breathe, swayYaw = nY * 0.0035 * wob;
    // ---- walk bob
    const sp = this.moveSpeed;
    if (sp > 0.05) this.walkPhase += dt * (sp > 3.5 ? 9.5 : 7.2) ;
    const bobAmp = Math.min(1, sp / 1.6) * (input.sprint ? 1.8 : 1.0) * (1 - 0.7 * this.adsT);
    const bobY = -Math.abs(Math.sin(this.walkPhase)) * 0.0075 * bobAmp, bobX = Math.sin(this.walkPhase * 0.5) * 0.004 * bobAmp;
    const bobRoll = Math.sin(this.walkPhase * 0.5) * 0.012 * bobAmp, bobPitch = Math.abs(Math.cos(this.walkPhase)) * 0.004 * bobAmp;
    // ---- look lag (spring toward zero, kicked by the camera's angular velocity)
    const lag = this.lag, lagK = 1 - 0.85 * this.adsT;
    lag.vyaw += (-input.lookDelta.yaw * 22 * lagK) - lag.yaw * 380 * dt - lag.vyaw * 22 * dt;
    lag.vpitch += (-input.lookDelta.pitch * 22 * lagK) - lag.pitch * 380 * dt - lag.vpitch * 22 * dt;
    lag.yaw += lag.vyaw * dt; lag.pitch += lag.vpitch * dt;
    lag.yaw = THREE.MathUtils.clamp(lag.yaw, -0.12, 0.12); lag.pitch = THREE.MathUtils.clamp(lag.pitch, -0.10, 0.10);

    // ---- base pose: the SIGHT POINT (on the LOS) is what we place
    const sight = A.sightAxis;
    const adsPos = _v.set(0, 0, -(A.eyeZ - sight.z));                                     // sight point sits on the camera axis at (eyeZ - sightZ)
    const hip = A.hipOffset;
    const hipPos = _v2.copy(hip);                                                          // hipOffset = where the sight point goes
    const adsK = smooth(this.adsT), lowK = smooth(this.lowT);
    const posePos = new THREE.Vector3().lerpVectors(hipPos, adsPos, adsK);
    const poseRot = new THREE.Euler(spec.action === 'recoil' ? 0.06 * (1 - adsK) : 0.02 * (1 - adsK), -0.06 * (1 - adsK), 0.04 * (1 - adsK));
    // lowered (sprint / muzzle blocked): swing down-left
    posePos.lerp(new THREE.Vector3(hipPos.x - 0.02, hipPos.y - 0.10, hipPos.z + 0.10 + 0.25 * this.blocked), lowK);
    poseRot.x += -0.55 * lowK; poseRot.y += 0.35 * lowK; poseRot.z += 0.25 * lowK;
    // crouch: slightly closer
    posePos.z += 0.01 * this.stance.crouch;
    this.pose.position.copy(posePos);
    this.pose.rotation.copy(poseRot);
    // holder: zero angle already set; offset so the sight point is at the holder origin
    this.holder.position.set(-sight.x, -sight.y, -sight.z);
    // ---- sway group: weapon-space share of wobble/bob/lag (the rest goes to the view)
    const wShare = 1 - 0.8 * adsK;
    this.sway.rotation.set(swayPitch * wShare + lag.pitch + bobPitch, swayYaw * wShare + lag.yaw, bobRoll);
    this.sway.position.set(bobX, bobY, 0);
    // ---- recoil kick: pivot at the support point
    const pivot = spec.action === 'recoil' ? _v.set(0, -0.08, -0.36 - 0.08 * adsK) : _v.set(0.02, -0.06, 0.12);
    this.kick.position.copy(pivot);
    this.sway.position.sub(pivot);
    const cheek = spec.action === 'recoil' ? 0.10 + 0.06 * adsK : 0.45 + 0.35 * adsK;   // how much of the muzzle rise the eye follows (cheek weld on a rifle; almost none with a pistol)
    this.kick.rotation.set(rc.pitch * (1 - cheek), -rc.yaw * (1 - cheek), rc.roll * 0.6);
    this.kick.position.z += rc.x;                                                          // straight back into the shoulder/arms
    // ---- view (camera) share
    this.viewKick.pitch = rc.pitch * cheek + swayPitch * (1 - wShare) + bobPitch * 0.4;
    this.viewKick.yaw = rc.yaw * cheek + swayYaw * (1 - wShare);
    this.viewKick.roll = rc.roll * 0.3 + bobRoll * 0.3;
    // persistent climb: a fraction of the muzzle rise leaks into the aim; the shooter slowly re-centres
    const climbGain = spec.action === 'recoil' ? 0.05 : 0.4;   // rifles: the cheek weld drags the head up with the stock; pistols barely move the eye
    this.viewClimb.pitch += Math.max(0, rc.vp) * dt * climbGain * (1 + 0.5 * (1 - adsK));
    this.viewClimb.yaw += rc.vy * dt * climbGain * 0.8;
    const rec = Math.min(1, dt * (this.triggerHeld ? 0.35 : 1.8));
    this.viewClimb.pitch -= this.viewClimb.pitch * rec; this.viewClimb.yaw -= this.viewClimb.yaw * rec;
  }

  updateHands(dt) {
    const R = this.hands.right, L = this.hands.left;
    // right hand: sequence pose if any, otherwise grip with the trigger finger following the trigger
    if (this.rhPose) R.setPose(this.rhPose, 10);
    else {
      R.setPose('gripSafe', 10);
      const onTrigger = Math.max(this.adsT * 0.7, this.trigger > 0.01 ? 1 : 0, this.pulling ? 1 : 0);
      const a = POSES.gripSafe.index, b = POSES.gripFire.index;
      const f = onTrigger * (0.55 + 0.45 * this.trigger);
      R.setFinger('index', [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f], Math.min(1, dt * 18));
    }
    L.setPose(this.lhPose || (this.weapon.spec.action === 'recoil' ? 'pistolSupport' : 'cclamp'), 10);
    R.update(dt); L.update(dt);
  }

  /** world-space helpers for optics/effects */
  worldMuzzle(out) { this.weapon.group.updateMatrixWorld(true); return out.copy(this.weapon.anchors.muzzle).applyMatrix4(this.weapon.group.matrixWorld); }
  worldBoreDir(out) { return out.copy(this.weapon.anchors.boreDir).transformDirection(this.weapon.group.matrixWorld); }
  /** the sight line direction (bore pitched down by the zero angle in the weapon's own vertical plane) */
  worldLosDir(out) {
    const z = this.holder.rotation.x, y = this.holder.rotation.y;
    out.set(Math.sin(y) * Math.cos(z), -Math.sin(z), -Math.cos(z) * Math.cos(y));
    return out.transformDirection(this.weapon.group.matrixWorld).normalize();
  }
  worldSightPoint(out) { const s = this.weapon.anchors.sightAxis; return out.set(s.x, s.y, s.z).applyMatrix4(this.weapon.group.matrixWorld); }
}

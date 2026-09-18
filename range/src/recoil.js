// ============================================================================
// RANGE — recoil.js
// Physically based recoil + action cycling.
//   • Free-recoil impulse J = m_bullet·v + m_powder·k·v.
//   • Gas guns: the impulse first accelerates the reciprocating mass (slide /
//     bolt carrier); the frame feels the spring force and the end-of-travel
//     impacts. This is what gives the AR its "double thump" and a pistol its
//     delayed slap: the carrier is simulated as a 1-D mass on the buffer /
//     recoil spring with inelastic stops at both ends of its stroke.
//   • The gun + shooter is a mass–spring–damper in translation (into the
//     shoulder / arms) and rotation about the support point; bore height above
//     the support turns recoil into muzzle rise. Yaw gets a hand-asymmetry share.
//   • Output: gun translation (m), pitch/yaw (rad), action position (0..1),
//     plus discrete events (carrier at rear → eject, carrier home → feed).
// ============================================================================

export class RecoilSim {
  constructor(spec, shooter = {}) {
    this.spec = spec;
    this.M = spec.massKg + (shooter.massKg ?? (spec.action === 'recoil' ? 1.6 : 4.5)); // effective supported mass
    this.h = spec.action === 'recoil' ? spec.boreOverGrip + 0.05 : spec.boreOverButt + 0.045; // lever arm to the support pivot (wrist / shoulder pocket)
    this.I = spec.action === 'recoil' ? 0.028 : 0.30 + spec.massKg * 0.02;
    // shooter "stiffness": translation spring/damper, rotation spring/damper
    this.kx = this.M * (shooter.omegaX ?? (spec.action === 'recoil' ? 55 : 48)) ** 2; this.cx = 2 * (shooter.zetaX ?? 0.65) * Math.sqrt(this.kx * this.M);
    this.kr = this.I * (shooter.omegaR ?? (spec.action === 'recoil' ? 52 : 30)) ** 2; this.cr = 2 * (shooter.zetaR ?? (spec.action === 'recoil' ? 0.7 : 0.55)) * Math.sqrt(this.kr * this.I);
    this.x = 0; this.vx = 0;            // rearward displacement (m, +back)
    this.pitch = 0; this.vp = 0;        // muzzle rise (rad, +up)
    this.yaw = 0; this.vy = 0;          // rad, + right
    this.roll = 0; this.vr = 0;
    // reciprocating mass
    this.hasCarrier = spec.action === 'gas' || spec.action === 'recoil';
    this.mc = spec.action === 'gas' ? spec.bcgMassKg : spec.action === 'recoil' ? spec.slideMassKg + 0.09 : 0;
    this.stroke = spec.action === 'gas' ? spec.bcgStroke : spec.action === 'recoil' ? spec.slideStroke : 0;
    this.springN = spec.action === 'gas' ? spec.bufferSpringN : spec.action === 'recoil' ? spec.recoilSpringN : [0, 0];
    this.s = 0; this.u = 0;             // carrier position along the stroke (m, +rear) and velocity
    this.held = false;                  // carrier held back (bolt catch / slide stop / manual)
    this.pendingGas = 0; this.gasTimer = 0; this.gasDur = 0.0015;
    this.events = [];
    this.time = 0;
    this.t = 0;
    this.cycling = false;
    this.lastCycleMs = 0; this.cycleStart = 0;
    this.stanceFactor = 1;
  }

  /** Fire: apply the shot impulse. mv m/s, cart cartridge record */
  fire(mv, cart, opts = {}) {
    const mb = cart.bulletMassG / 1000, mp = cart.powderMassG / 1000;
    const J = mb * mv + mp * cart.gasVelFactor * mv;
    const sf = this.stanceFactor;
    if (this.spec.action === 'recoil') {
      // impulse into the slide/barrel unit; frame feels nothing yet
      this.u += J / this.mc;
      this.cycling = true; this.cycleStart = this.t;
    } else if (this.spec.action === 'gas') {
      // the frame takes the bullet/gas impulse, the carrier is kicked ~1 ms later by the gas port
      this.applyImpulse(J, sf, opts);
      this.pendingGas = this.mc * (opts.carrierKick ?? 5.6); this.gasTimer = 0.0009;
      this.cycling = true; this.cycleStart = this.t;
    } else {
      this.applyImpulse(J, sf, opts);
    }
    return J;
  }

  applyImpulse(J, sf = 1, opts = {}) {
    this.vx += J / this.M;
    const asym = (opts.rng ? opts.rng() : Math.random());
    const jitter = 0.7 + 0.6 * (opts.rng ? opts.rng() : Math.random());
    this.vp += (J * this.h / this.I) * sf * jitter;
    this.vy += (J * this.h / this.I) * sf * (0.05 + 0.35 * (asym - 0.35)); // right-hand bias
    this.vr += (J * this.h / this.I) * sf * 0.25 * (asym - 0.5);
  }

  /** Step the sim by dt seconds (sub-stepped internally). Returns events fired this step. */
  update(dt) {
    this.events.length = 0;
    const sub = Math.max(1, Math.ceil(dt / 0.0005));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.step(h);
    return this.events;
  }

  step(h) {
    this.t += h;
    const M = this.M;
    // gas kick on the carrier (reaction pushes the gun forward slightly)
    if (this.pendingGas > 0) {
      if (this.gasTimer > 0) this.gasTimer -= h;
      else {
        const dJ = Math.min(this.pendingGas, this.pendingGas * h / this.gasDur);
        this.u += dJ / this.mc; this.vx -= dJ / M * 0.35; this.pendingGas -= dJ;
        if (this.pendingGas < 1e-6) this.pendingGas = 0;
      }
    }
    if (this.hasCarrier && !this.held) {
      // spring force on the carrier (forward), reaction on the gun (rearward)
      const [F0, F1] = this.springN;
      const F = F0 + (F1 - F0) * (this.s / this.stroke);
      // friction + the drag of stripping a round from the magazine on the way home
      const friction = 12 * Math.sign(this.u) + (this.u < 0 && this.feedDrag ? -this.feedDrag : 0);
      if (this.u !== 0 || this.s > 0) {
        this.u -= (F + friction) / this.mc * h;
        this.vx += F / M * h * 0.9;
      }
      this.s += this.u * h;
      if (this.s >= this.stroke) {
        // buffer bottoms out: inelastic, momentum into the gun
        this.s = this.stroke;
        if (this.u > 0) { this.vx += this.u * this.mc / M; this.vp += this.u * this.mc * this.h * (this.spec.action === 'recoil' ? 1.0 : 0.6) / this.I; this.events.push({ type: 'carrierRear', speed: this.u }); }
        this.u = 0;
        if (this.holdAtRear) { this.held = true; this.holdAtRear = false; this.events.push({ type: 'holdOpen' }); }
      }
      if (this.s <= 0) {
        this.s = 0;
        if (this.u < 0) {
          // slams into battery: forward impulse on the gun
          this.vx += this.u * this.mc / M; this.vp += this.u * this.mc * this.h * 0.3 / this.I;
          this.events.push({ type: 'carrierHome', speed: -this.u });
          if (this.cycling) { this.cycling = false; this.lastCycleMs = (this.t - this.cycleStart) * 1000; }
        }
        this.u = 0;
      }
    }
    // gun + shooter mass-spring-damper
    const ax = (-this.kx * this.x - this.cx * this.vx) / M;
    this.vx += ax * h; this.x += this.vx * h;
    const ap = (-this.kr * this.pitch - this.cr * this.vp) / this.I;
    this.vp += ap * h; this.pitch += this.vp * h;
    const ay = (-this.kr * 1.4 * this.yaw - this.cr * 1.2 * this.vy) / this.I;
    this.vy += ay * h; this.yaw += this.vy * h;
    const ar = (-this.kr * 1.2 * this.roll - this.cr * 1.1 * this.vr) / this.I;
    this.vr += ar * h; this.roll += this.vr * h;
  }

  /** manual carrier control (charging handle / slide / bolt): position 0..1 */
  setManual(t) { this.held = true; this.s = t * this.stroke; this.u = 0; }
  release(fromRear = true) { this.held = false; if (fromRear) { this.s = this.stroke; this.u = -0.01; } }
  get actionPos() { return this.stroke > 0 ? this.s / this.stroke : 0; }
}

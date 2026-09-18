// ============================================================================
// RANGE — ballistics.js
// Exterior + terminal ballistics. Pure math, no three.js dependency so it can
// be unit-tested in node (see range/test/ballistics.mjs).
//
// Exterior model: point-mass trajectory with
//   • standard G1 / G7 drag functions (Cd vs Mach, linear interpolation)
//   • ballistic coefficient in lb/in² (industry convention) → metric
//   • atmosphere from temperature / pressure / humidity / altitude (ICAO)
//   • wind as a uniform vector (drag acts on air-relative velocity)
//   • Coriolis (full 3-D, latitude + range azimuth aware)
//   • gyroscopic spin drift (Litz empirical, Miller stability factor)
//   • RK4 integration on a fixed sub-step
// Terminal model: Poncelet resistance (closed form) for penetration through
// wood / steel / soil / concrete, plus a grazing-angle ricochet model.
// ============================================================================

// --- Standard drag functions: [Mach, Cd] ------------------------------------
export const G1_TABLE = [
  [0.00,0.2629],[0.05,0.2558],[0.10,0.2487],[0.15,0.2413],[0.20,0.2344],[0.25,0.2278],[0.30,0.2214],[0.35,0.2155],
  [0.40,0.2104],[0.45,0.2061],[0.50,0.2032],[0.55,0.2020],[0.60,0.2034],[0.70,0.2165],[0.725,0.2230],[0.75,0.2313],
  [0.775,0.2417],[0.80,0.2546],[0.825,0.2706],[0.85,0.2901],[0.875,0.3136],[0.90,0.3415],[0.925,0.3734],[0.95,0.4084],
  [0.975,0.4448],[1.00,0.4805],[1.025,0.5136],[1.05,0.5427],[1.075,0.5677],[1.10,0.5883],[1.125,0.6053],[1.15,0.6191],
  [1.20,0.6393],[1.25,0.6518],[1.30,0.6589],[1.35,0.6621],[1.40,0.6625],[1.45,0.6607],[1.50,0.6573],[1.55,0.6528],
  [1.60,0.6474],[1.65,0.6413],[1.70,0.6347],[1.75,0.6280],[1.80,0.6210],[1.85,0.6141],[1.90,0.6072],[1.95,0.6003],
  [2.00,0.5934],[2.05,0.5867],[2.10,0.5804],[2.15,0.5743],[2.20,0.5685],[2.25,0.5630],[2.30,0.5577],[2.35,0.5527],
  [2.40,0.5481],[2.45,0.5438],[2.50,0.5397],[2.60,0.5325],[2.70,0.5264],[2.80,0.5211],[2.90,0.5168],[3.00,0.5133],
  [3.10,0.5105],[3.20,0.5084],[3.30,0.5067],[3.40,0.5054],[3.50,0.5040],[3.60,0.5030],[3.70,0.5022],[3.80,0.5016],
  [3.90,0.5010],[4.00,0.5006],[4.20,0.4998],[4.40,0.4995],[4.60,0.4992],[4.80,0.4990],[5.00,0.4988],
];
export const G7_TABLE = [
  [0.00,0.1198],[0.05,0.1197],[0.10,0.1196],[0.15,0.1194],[0.20,0.1193],[0.25,0.1194],[0.30,0.1194],[0.35,0.1194],
  [0.40,0.1193],[0.45,0.1193],[0.50,0.1194],[0.55,0.1193],[0.60,0.1194],[0.65,0.1197],[0.70,0.1202],[0.725,0.1207],
  [0.75,0.1215],[0.775,0.1226],[0.80,0.1242],[0.825,0.1266],[0.85,0.1306],[0.875,0.1368],[0.90,0.1464],[0.925,0.1660],
  [0.95,0.2054],[0.975,0.2993],[1.00,0.3803],[1.025,0.4015],[1.05,0.4043],[1.075,0.4034],[1.10,0.4014],[1.125,0.3987],
  [1.15,0.3955],[1.20,0.3884],[1.25,0.3810],[1.30,0.3732],[1.35,0.3657],[1.40,0.3580],[1.50,0.3440],[1.55,0.3376],
  [1.60,0.3315],[1.65,0.3260],[1.70,0.3209],[1.75,0.3160],[1.80,0.3117],[1.85,0.3078],[1.90,0.3042],[1.95,0.3010],
  [2.00,0.2980],[2.05,0.2951],[2.10,0.2922],[2.15,0.2892],[2.20,0.2864],[2.25,0.2835],[2.30,0.2807],[2.35,0.2779],
  [2.40,0.2752],[2.45,0.2725],[2.50,0.2697],[2.55,0.2670],[2.60,0.2643],[2.65,0.2615],[2.70,0.2588],[2.75,0.2561],
  [2.80,0.2533],[2.85,0.2506],[2.90,0.2479],[2.95,0.2451],[3.00,0.2424],[3.10,0.2368],[3.20,0.2313],[3.30,0.2258],
  [3.40,0.2205],[3.50,0.2154],[3.60,0.2106],[3.70,0.2060],[3.80,0.2017],[3.90,0.1975],[4.00,0.1935],[4.20,0.1861],
  [4.40,0.1793],[4.60,0.1730],[4.80,0.1672],[5.00,0.1618],
];
export const DRAG_TABLES = { G1: G1_TABLE, G7: G7_TABLE };

/** Cd of the standard projectile at a given Mach number (linear interp). */
export function dragCd(table, mach) {
  if (mach <= 0) return table[0][1];
  const n = table.length;
  if (mach >= table[n - 1][0]) return table[n - 1][1];
  // tables are small (<100) — a binary search keeps this cheap in the inner loop
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid][0] <= mach) lo = mid; else hi = mid; }
  const [m0, c0] = table[lo], [m1, c1] = table[hi];
  return c0 + (c1 - c0) * (mach - m0) / (m1 - m0);
}

// --- Constants ------------------------------------------------------------
export const G = 9.80665;
export const LB_IN2_TO_KG_M2 = 0.45359237 / (0.0254 * 0.0254); // 703.0696
export const EARTH_OMEGA = 7.2921159e-5; // rad/s
export const GRAIN = 6.479891e-5; // kg
export const INCH = 0.0254;

// --- Atmosphere ---------------------------------------------------------------
/**
 * @param {object} o  tempC, humidity (0..1), altitudeM, pressureHPa (station pressure; derived from altitude if null)
 * @returns {{rho:number, c:number, T:number, p:number}} density kg/m³, speed of sound m/s, Kelvin, hPa
 */
export function atmosphere(o = {}) {
  const tempC = o.tempC ?? 15;
  const humidity = o.humidity ?? 0.5;
  const altitudeM = o.altitudeM ?? 0;
  const T = tempC + 273.15;
  let p = o.pressureHPa;
  if (p == null) p = 1013.25 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  const es = 6.1078 * Math.pow(10, 7.5 * tempC / (tempC + 237.3)); // saturation vapour pressure hPa (Tetens)
  const pv = humidity * es;
  const pd = p - pv;
  const rho = (pd * 100) / (287.058 * T) + (pv * 100) / (461.495 * T);
  const c = Math.sqrt(1.4 * 287.058 * T) * (1 + 0.16 * (pv / p)); // humid air is slightly faster
  return { rho, c, T, p, tempC, humidity, altitudeM };
}
export const STD_ATMOSPHERE = atmosphere({ tempC: 15, humidity: 0, altitudeM: 0 });

// --- Stability & spin drift ------------------------------------------------
/**
 * Miller twist rule gyroscopic stability factor.
 * massG grams, diameterMm, lengthMm, twistMm (mm per turn), velocity m/s, atmosphere.
 */
export function millerStability({ massG, diameterMm, lengthMm, twistMm, velocity, atm = STD_ATMOSPHERE }) {
  const m = massG / 1000 / GRAIN;          // grains
  const d = diameterMm / 25.4;             // in
  const t = (twistMm / 25.4) / d;          // calibers per turn
  const L = lengthMm / diameterMm;         // calibers
  const v = velocity / 0.3048;             // fps
  const tempF = atm.tempC * 9 / 5 + 32;
  const pInHg = atm.p / 33.8639;
  let sg = 30 * m / (t * t * d * d * d * L * (1 + L * L));
  sg *= Math.cbrt(v / 2800);
  sg *= ((tempF + 460) / 519) * (29.92 / pInHg);
  return sg;
}
/** Litz spin drift in metres after time-of-flight t (s). Positive = right for RH twist. */
export function spinDrift(sg, t) {
  return 1.25 * (sg + 1.2) * Math.pow(t, 1.83) * INCH;
}

// --- Environment for a shot --------------------------------------------------
/**
 * Build the constant environment used by the integrator.
 * @param {object} o
 *   atm        atmosphere()
 *   wind       [x,y,z] m/s in world coordinates (default 0)
 *   latitudeDeg, azimuthDeg   for Coriolis (range downrange = world -Z; azimuth = bearing of -Z, clockwise from north)
 *   coriolis   boolean
 *   spinDrift  boolean
 */
export function makeEnv(o = {}) {
  const atm = o.atm || STD_ATMOSPHERE;
  const wind = o.wind || [0, 0, 0];
  const lat = (o.latitudeDeg ?? 40) * Math.PI / 180;
  const az = (o.azimuthDeg ?? 0) * Math.PI / 180;
  // Ω in world coords: world -Z = bearing az, world +X = bearing az+90°, +Y up
  const omega = o.coriolis === false ? [0, 0, 0] : [
    -EARTH_OMEGA * Math.cos(lat) * Math.sin(az),
    EARTH_OMEGA * Math.sin(lat),
    -EARTH_OMEGA * Math.cos(lat) * Math.cos(az),
  ];
  return { atm, wind, omega, spinDrift: o.spinDrift !== false, gravity: o.gravity ?? G };
}

// --- Projectile -------------------------------------------------------------
/**
 * A projectile state. Positions/velocities are plain arrays [x,y,z] for speed.
 * @param {object} o
 *   massKg, diameterM, bc (lb/in²), model 'G1'|'G7', sg (stability; 0 disables spin drift), twistSign (+1 RH)
 *   pos [x,y,z], vel [x,y,z]
 */
export function makeProjectile(o) {
  const table = DRAG_TABLES[o.model || 'G7'];
  return {
    pos: o.pos.slice(), vel: o.vel.slice(),
    prevPos: o.pos.slice(),
    t: 0, dist: 0,
    massKg: o.massKg, diameterM: o.diameterM, area: Math.PI * o.diameterM * o.diameterM / 4,
    bc: o.bc, table,
    dragK: Math.PI / (8 * o.bc * LB_IN2_TO_KG_M2),   // a_drag = rho * v² * Cd * dragK
    sg: o.sg ?? 0, twistSign: o.twistSign ?? 1, spinAcc: 0,
    v0: Math.hypot(o.vel[0], o.vel[1], o.vel[2]),
    alive: true, stable: true, deformed: false,
    penetrations: 0, ricochets: 0,
    tag: o.tag || null,
  };
}

// scratch storage for RK4 (avoid allocations in the inner loop)
const _k = [new Float64Array(6), new Float64Array(6), new Float64Array(6), new Float64Array(6)];
const _tmp = new Float64Array(6);

function accel(p, vx, vy, vz, env, out) {
  const wx = env.wind[0], wy = env.wind[1], wz = env.wind[2];
  const rx = vx - wx, ry = vy - wy, rz = vz - wz;
  const vr = Math.sqrt(rx * rx + ry * ry + rz * rz);
  let ax = 0, ay = -env.gravity, az = 0;
  if (vr > 1e-6) {
    const mach = vr / env.atm.c;
    let cd = dragCd(p.table, mach);
    if (p.deformed) cd *= 2.2;      // deformed / tumbling bullet
    const a = env.atm.rho * vr * cd * p.dragK; // (rho * v * Cd * K) * v_vec
    ax -= a * rx; ay -= a * ry; az -= a * rz;
  }
  // Coriolis: a = -2 Ω × v
  const ox = env.omega[0], oy = env.omega[1], oz = env.omega[2];
  if (ox !== 0 || oy !== 0 || oz !== 0) {
    ax -= 2 * (oy * vz - oz * vy);
    ay -= 2 * (oz * vx - ox * vz);
    az -= 2 * (ox * vy - oy * vx);
  }
  out[0] = vx; out[1] = vy; out[2] = vz; out[3] = ax; out[4] = ay; out[5] = az;
}

/** Advance the projectile by dt (RK4). Updates pos/vel/t/dist/prevPos. */
export function stepProjectile(p, dt, env) {
  const s0 = p.pos, v0 = p.vel;
  p.prevPos[0] = s0[0]; p.prevPos[1] = s0[1]; p.prevPos[2] = s0[2];
  const k1 = _k[0], k2 = _k[1], k3 = _k[2], k4 = _k[3];
  accel(p, v0[0], v0[1], v0[2], env, k1);
  accel(p, v0[0] + 0.5 * dt * k1[3], v0[1] + 0.5 * dt * k1[4], v0[2] + 0.5 * dt * k1[5], env, k2);
  accel(p, v0[0] + 0.5 * dt * k2[3], v0[1] + 0.5 * dt * k2[4], v0[2] + 0.5 * dt * k2[5], env, k3);
  accel(p, v0[0] + dt * k3[3], v0[1] + dt * k3[4], v0[2] + dt * k3[5], env, k4);
  const dx = dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  const dy = dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  const dz = dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  s0[0] += dx; s0[1] += dy; s0[2] += dz;
  v0[0] += dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
  v0[1] += dt / 6 * (k1[4] + 2 * k2[4] + 2 * k3[4] + k4[4]);
  v0[2] += dt / 6 * (k1[5] + 2 * k2[5] + 2 * k3[5] + k4[5]);
  // spin drift: lateral offset grows as t^1.83 (Litz); applied along the trajectory's right vector
  if (env.spinDrift && p.sg > 0 && p.stable) {
    const sdNew = spinDrift(p.sg, p.t + dt);
    const d = (sdNew - p.spinAcc) * p.twistSign;
    p.spinAcc = sdNew;
    // right = normalize(v × up)
    const rx = -v0[2], rz = v0[0];
    const rl = Math.hypot(rx, rz);
    if (rl > 1e-6) { s0[0] += rx / rl * d; s0[2] += rz / rl * d; }
  }
  p.t += dt;
  p.dist += Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function speed(p) { return Math.hypot(p.vel[0], p.vel[1], p.vel[2]); }
export function energy(p) { const v = speed(p); return 0.5 * p.massKg * v * v; }

// --- Zeroing ---------------------------------------------------------------
/**
 * Solve the bore elevation angle (rad, relative to the line of sight) so the
 * bullet crosses the LOS at zeroRange. Sight sits sightHeight above the bore.
 * Solved in the vertical plane, no wind/Coriolis, under `atm` (zeroing-day conditions).
 */
export function solveZeroAngle({ massKg, diameterM, bc, model, mv, sightHeight, zeroRange, atm = STD_ATMOSPHERE }) {
  const env = makeEnv({ atm, coriolis: false, spinDrift: false });
  const dropAt = (theta) => {
    const p = makeProjectile({ massKg, diameterM, bc, model, pos: [0, -sightHeight, 0], vel: [0, mv * Math.sin(theta), -mv * Math.cos(theta)] });
    const dt = 0.001;
    let guard = 0;
    while (-p.pos[2] < zeroRange && guard++ < 100000 && p.pos[1] > -50) stepProjectile(p, dt, env);
    // linear interpolate back to exactly zeroRange
    const z1 = -p.pos[2], z0 = -p.prevPos[2];
    const f = z1 > z0 ? (zeroRange - z0) / (z1 - z0) : 1;
    return p.prevPos[1] + (p.pos[1] - p.prevPos[1]) * f;
  };
  let lo = -0.02, hi = 0.15;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (dropAt(mid) < 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Range card: fly one trajectory under the given env and sample it every `step` metres.
 * Returns rows {range, drop (m, + is above LOS), drift (m, + right), v, e, tof, mach}
 */
export function rangeCard({ massKg, diameterM, bc, model, mv, sightHeight, zeroAngle, env, maxRange = 800, step = 25, sg = 0 }) {
  const p = makeProjectile({ massKg, diameterM, bc, model, sg, pos: [0, -sightHeight, 0], vel: [0, mv * Math.sin(zeroAngle), -mv * Math.cos(zeroAngle)] });
  const rows = [];
  let next = 0;
  const dt = 0.0005;
  let guard = 0;
  while (-p.pos[2] <= maxRange && guard++ < 400000 && p.pos[1] > -100) {
    if (-p.pos[2] >= next) {
      const v = speed(p);
      rows.push({ range: next, drop: p.pos[1], drift: p.pos[0], v, e: 0.5 * p.massKg * v * v, tof: p.t, mach: v / env.atm.c });
      next += step;
    }
    stepProjectile(p, dt, env);
  }
  return rows;
}

// --- Terminal ballistics -------------------------------------------------------
/**
 * Materials for the Poncelet resistance model F = A (a + b v²).
 * a: static strength term (Pa), b: inertial term (kg/m³ ~ density), ricochetDeg: critical grazing angle,
 * hard: bullet splashes/fragments on non-penetrating hits (steel).
 */
export const MATERIALS = {
  ar500:    { a: 1.2e10, b: 7850, ricochetDeg: 30, hard: true,  sound: 'steel',    name: 'AR500 steel' },
  steel:    { a: 2.0e9,  b: 7850, ricochetDeg: 25, hard: true,  sound: 'steel',    name: 'mild steel' },
  aluminum: { a: 6.0e8,  b: 2700, ricochetDeg: 20, hard: true,  sound: 'metal',    name: 'aluminium' },
  plywood:  { a: 5.0e7,  b: 550,  ricochetDeg: 8,  hard: false, sound: 'wood',     name: 'plywood' },
  pine:     { a: 4.0e7,  b: 450,  ricochetDeg: 8,  hard: false, sound: 'wood',     name: 'pine' },
  paper:    { a: 2.0e6,  b: 100,  ricochetDeg: 2,  hard: false, sound: 'paper',    name: 'cardboard' },
  rubber:   { a: 3.0e6,  b: 1100, ricochetDeg: 3,  hard: false, sound: 'rubber',   name: 'rubber' },
  soil:     { a: 1.0e7,  b: 1600, ricochetDeg: 12, hard: false, sound: 'dirt',     name: 'soil berm' },
  concrete: { a: 3.0e8,  b: 2400, ricochetDeg: 20, hard: true,  sound: 'concrete', name: 'concrete' },
  gravel:   { a: 2.0e7,  b: 1800, ricochetDeg: 10, hard: false, sound: 'dirt',     name: 'gravel' },
};

/**
 * Closed-form Poncelet penetration.
 * @returns {{stopped:boolean, depth:number, vExit:number}}
 */
export function penetration({ massKg, area, v0, material, thickness = Infinity }) {
  const { a, b } = material;
  const k = massKg / (2 * area * b);
  const stopDepth = k * Math.log(1 + b * v0 * v0 / a);
  if (stopDepth <= thickness) return { stopped: true, depth: stopDepth, vExit: 0 };
  const v1sq = ((a + b * v0 * v0) * Math.exp(-thickness / k) - a) / b;
  return { stopped: false, depth: thickness, vExit: Math.sqrt(Math.max(0, v1sq)) };
}

/**
 * Decide the outcome of an impact.
 * @param p projectile, n surface normal [x,y,z] (unit, facing the bullet), material, thickness (m), rng ()=>[0,1)
 * @returns {{type:'ricochet'|'penetrate'|'stop', vExit?:number, dir?:number[], depth?:number, grazingDeg:number}}
 */
export function impactOutcome(p, n, material, thickness, rng = Math.random) {
  const v = speed(p);
  const d = [p.vel[0] / v, p.vel[1] / v, p.vel[2] / v];
  const cosInc = -(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]); // 1 = perpendicular
  const grazing = Math.asin(Math.max(0, Math.min(1, cosInc))); // angle between velocity and the surface plane
  const grazingDeg = grazing * 180 / Math.PI;
  // critical angle scales with velocity: fast bullets on hard targets break up rather than skip
  let crit = material.ricochetDeg;
  if (material.hard) crit *= Math.max(0.55, Math.min(1.25, 700 / Math.max(200, v)));
  else crit *= Math.max(0.7, Math.min(1.5, v / 500));
  crit *= 0.85 + 0.3 * rng();
  if (grazingDeg < crit) {
    // reflect: tangential component mostly kept, normal component crushed
    // tangential = v_vec - (v_vec·n) n ; v_vec·n = -cosInc*v
    const vn = -cosInc * v; // signed normal speed (negative = into the surface)
    const tanx = p.vel[0] + cosInc * v * n[0], tany = p.vel[1] + cosInc * v * n[1], tanz = p.vel[2] + cosInc * v * n[2];
    const eT = material.hard ? 0.55 + 0.25 * rng() : 0.4 + 0.3 * rng();
    const eN = material.hard ? 0.12 + 0.12 * rng() : 0.08 + 0.1 * rng();
    let ox = tanx * eT + n[0] * (-vn) * eN, oy = tany * eT + n[1] * (-vn) * eN, oz = tanz * eT + n[2] * (-vn) * eN;
    // random scatter ±6°
    const s = 0.1;
    ox += (rng() - 0.5) * s * v * eT; oy += (rng() - 0.5) * s * v * eT; oz += (rng() - 0.5) * s * v * eT;
    const vo = Math.hypot(ox, oy, oz);
    return { type: 'ricochet', vExit: vo, dir: [ox / vo, oy / vo, oz / vo], grazingDeg };
  }
  // effective path length through the material = thickness / cos(incidence)
  const pathLen = thickness / Math.max(0.15, cosInc);
  const pen = penetration({ massKg: p.massKg, area: p.area, v0: v, material, thickness: pathLen });
  if (pen.stopped) return { type: 'stop', depth: pen.depth, grazingDeg };
  // exit: deflect slightly toward the surface normal (bullet yaws on exit)
  const bend = 0.02 + 0.06 * rng();
  let ox = d[0] - n[0] * bend * cosInc, oy = d[1] - n[1] * bend * cosInc, oz = d[2] - n[2] * bend * cosInc;
  ox += (rng() - 0.5) * 0.04; oy += (rng() - 0.5) * 0.04; oz += (rng() - 0.5) * 0.04;
  const l = Math.hypot(ox, oy, oz);
  return { type: 'penetrate', vExit: pen.vExit, dir: [ox / l, oy / l, oz / l], depth: pathLen, grazingDeg };
}

// --- Handy conversions ---------------------------------------------------------
export const MOA = Math.PI / 180 / 60;      // rad
export const MRAD = 1e-3;                   // rad
export function moaAt(range, rad) { return range * Math.tan(rad); }
export function gaussian(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

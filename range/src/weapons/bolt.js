// ============================================================================
// RANGE — weapons/bolt.js
// Remington 700-pattern short-action precision rifle in an aluminium chassis,
// 24" heavy barrel, 10-round detachable box magazine, 34 mm tube 3-15×50
// scope in a one-piece mount (55 mm over bore). Chambered for .308 Win by
// default (6.5 Creedmoor selectable).
// Frame: origin on the bore axis at the receiver's rear face, -Z to the muzzle.
// Bolt cycle = lift (90° about the bore) → pull (95 mm) → push → lock.
// ============================================================================
import * as THREE from 'three';
import { mat } from '../materials.js';
import { box, cyl, lathe, sideProfile, frontProfile, plateWithSlots, picatinny, screw, place, cartridgeModel, DEG } from '../gunparts.js';
import { CARTRIDGES } from '../cartridges.js';
import { orientHand } from '../hands.js';

export const BOLT_SPEC = {
  id: 'bolt', name: 'R700-pattern precision rifle (.308)', short: 'R700 precision',
  caliber: '.308', defaultAmmo: '308_m118lr', magCapacity: 10,
  barrelIn: 24, twistMm: 254, massKg: 6.4,
  action: 'bolt', fireModes: ['semi'], cyclicRpm: 60,
  lockTimeMs: 2.6, triggerTravelMm: 1.5, triggerBreakN: 9, // 2 lb match trigger
  sightHeight: 0.0545, zeroRange: 100,
  boreOverGrip: 0.075, boreOverButt: 0.018, stockLength: 0.36,
  boltTravel: 0.095, boltLiftDeg: 90,
  dispersionMoa: 0.5,
  ejection: { pos: [0.020, 0.016, -0.150], dir: [0.75, 0.55, 0.30], speed: 2.4 },
  scope: { magMin: 3, magMax: 15, mag: 10, tubeMm: 34, objectiveMm: 50, eyeReliefM: 0.09, exitPupilMm: 5, fovDegAt1x: 26, reticle: 'mil-tree', ffp: true, clickMrad: 0.1 },
};

function annulusSector(rOut, rIn, a0, a1, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([Math.cos(a) * rOut, Math.sin(a) * rOut]); }
  for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n; pts.push([Math.cos(a) * rIn, Math.sin(a) * rIn]); }
  return pts;
}
function circle(r, n = 36) { const p = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }

export function buildBoltRifle() {
  const S = BOLT_SPEC;
  const M = {
    anod: mat('anodized'), fde: mat('anodizedFDE'), blued: mat('blued'), nitride: mat('nitride'), steel: mat('wornSteel'), knurl: mat('knurledSteel'),
    stainless: mat('stainless'), poly: mat('polymer'), stipple: mat('polymerStipple'), rubber: mat('rubber'), dark: mat('blackPaint'), glass: mat('glassLens'),
    brass: mat('brass'), primer: mat('primer'), copper: mat('copper'), greenTip: mat('greenTip'), redTip: mat('redTip'),
  };
  const root = new THREE.Group(); root.name = 'boltRifle';
  const parts = {};

  // ---------------------------------------------------------------- receiver (tubular, port cut top-right) + rail
  const RO = 0.0175, RI = 0.0125;
  const recv = new THREE.Group(); recv.name = 'receiver';
  const fullSec = (len, zc) => place(frontProfile(circle(RO), len, M.blued, { holes: [circle(RI)] }), [0, 0, zc]);
  recv.add(fullSec(0.095, -0.0475));            // rear bridge z 0 .. -0.095
  recv.add(fullSec(0.030, -0.205));             // front ring z -0.19 .. -0.22
  // port section: annulus minus the sector from -15° to 100° (right/top)
  recv.add(place(frontProfile(annulusSector(RO, RI, 100 * DEG, 345 * DEG, 40), 0.095, M.blued), [0, 0, -0.1425]));
  // flat bottom / bedding block + recoil lug
  recv.add(box(0.034, 0.010, 0.22, M.blued, { pos: [0, -0.016, -0.11] }));
  recv.add(box(0.034, 0.024, 0.006, M.blued, { pos: [0, -0.022, -0.217] }));
  // 20 MOA rail
  recv.add(box(0.026, 0.005, 0.215, M.anod, { pos: [0, RO + 0.0025, -0.11] }));
  recv.add(place(picatinny(0.21, M.anod), [0, RO + 0.0095, -0.11], [0.0058, 0, 0])); // 20 MOA cant
  // bolt stop (left rear), safety (right rear)
  recv.add(box(0.004, 0.008, 0.014, M.steel, { pos: [-(RO + 0.001), 0.0, -0.075], r: 0.001 }));
  const safety = box(0.004, 0.006, 0.014, M.steel, { pos: [RO - 0.002, 0.010, -0.012], r: 0.001 });
  recv.add(safety); parts.safety = { obj: safety, rest: safety.position.clone() };
  root.add(recv);

  // ---------------------------------------------------------------- bolt (rotates about the bore, slides along it)
  const bolt = new THREE.Group(); bolt.name = 'bolt';
  const BR = 0.0088;
  bolt.add(cyl(BR, BR, 0.205, M.blued, { axis: 'z', pos: [0, 0, -0.0875] }));                  // body: z +0.015 .. -0.19
  bolt.add(cyl(BR + 0.0025, BR + 0.0025, 0.012, M.steel, { axis: 'z', pos: [0, 0, -0.184] }));  // locking lugs ring at the face
  bolt.add(box(0.004, 0.008, 0.012, M.steel, { pos: [0.009, 0, -0.184] }));                         // extractor
  bolt.add(lathe([[0.006, 0.015], [0.011, 0.018], [0.011, 0.040], [0.008, 0.046], [0.004, 0.046], [0.004, 0.056], [0.0, 0.056]], M.blued, { seg: 24 })); // shroud + cocking piece
  // handle: root at z=-0.03, sweeps right, down and back to a ball knob
  const handle = new THREE.Group(); handle.position.set(0, 0, -0.030);
  const hPath = new THREE.CatmullRomCurve3([new THREE.Vector3(0.004, 0, 0), new THREE.Vector3(0.020, -0.004, 0.004), new THREE.Vector3(0.036, -0.016, 0.014), new THREE.Vector3(0.046, -0.028, 0.020)]);
  handle.add(new THREE.Mesh(new THREE.TubeGeometry(hPath, 24, 0.0045, 12, false), M.blued));
  handle.add(place(new THREE.Mesh(new THREE.SphereGeometry(0.0115, 24, 16), M.blued), [0.049, -0.031, 0.022]));
  bolt.add(handle);
  root.add(bolt);
  parts.bolt = { obj: bolt, rest: bolt.position.clone(), travel: S.boltTravel, lift: S.boltLiftDeg * DEG, knob: new THREE.Vector3(0.049, -0.031, -0.008) };

  // ---------------------------------------------------------------- barrel (24", heavy palma contour) + thread protector
  const barrelProf = [
    [0.0155, -0.220], [0.0155, -0.300], [0.0135, -0.330], [0.0115, -0.450], [0.0105, -0.780], [0.0105, -0.800],
    [0.0125, -0.800], [0.0125, -0.828], [0.0115, -0.830], [0.0039, -0.830], [0.0039, -0.826],
  ];
  const barrel = lathe(barrelProf, M.nitride, { seg: 40 }); barrel.name = 'barrel'; root.add(barrel);
  root.add(cyl(0.0125, 0.0125, 0.026, M.knurl, { axis: 'z', pos: [0, 0, -0.814] })); // knurled thread protector

  // ---------------------------------------------------------------- chassis (aluminium): forend, grip, folding-style stock
  const ch = new THREE.Group(); ch.name = 'chassis';
  // central spine under the action
  ch.add(box(0.046, 0.040, 0.40, M.anod, { pos: [0, -0.036, -0.04], r: 0.003 }));
  // forend: side + bottom panels with M-LOK slots, open top
  const FL = 0.40, FZ = -0.42;
  const slots = []; for (let i = -4; i <= 4; i++) slots.push({ x: i * 0.040, y: 0, w: 0.032, h: 0.007, r: 0.0035 });
  for (const sx of [-1, 1]) ch.add(place(plateWithSlots(FL, 0.046, 0.005, slots, M.anod), [sx * 0.0225, -0.021, FZ], [0, Math.PI / 2, 0]));
  ch.add(place(plateWithSlots(FL, 0.040, 0.005, slots, M.anod), [0, -0.0465, FZ], [Math.PI / 2, 0, Math.PI / 2]));
  ch.add(box(0.050, 0.008, 0.03, M.anod, { pos: [0, -0.040, -0.615], r: 0.002 })); // front cap
  // ARCA / pic rail on the bottom of the forend
  ch.add(place(picatinny(0.16, M.anod), [0, -0.049, -0.50], [Math.PI, 0, 0]));
  // grip (AR style) and trigger guard
  const grip = sideProfile([[0.030, -0.052], [0.066, -0.052], [0.098, -0.124], [0.096, -0.134], [0.066, -0.136], [0.058, -0.110], [0.050, -0.086], [0.042, -0.066]], 0.030, M.stipple, { bevel: 0.004, bevelSeg: 4 });
  ch.add(grip);
  ch.add(sideProfile([[-0.100, -0.056], [-0.096, -0.066], [-0.010, -0.066], [0.020, -0.056], [0.020, -0.052], [-0.100, -0.052]], 0.010, M.anod, { bevel: 0.001, holes: [[[-0.094, -0.055], [0.010, -0.055], [0.010, -0.063], [-0.092, -0.063]]] }));
  // stock: tube + buttpad + cheek riser + bag rider
  ch.add(box(0.036, 0.034, 0.24, M.anod, { pos: [0, -0.010, 0.20], r: 0.004 }));
  ch.add(box(0.044, 0.120, 0.016, M.rubber, { pos: [0, -0.030, 0.328], r: 0.004 }));
  ch.add(box(0.040, 0.110, 0.012, M.anod, { pos: [0, -0.030, 0.315], r: 0.003 }));
  const cheek = box(0.034, 0.018, 0.13, M.poly, { pos: [0, 0.028, 0.16], r: 0.004 });
  ch.add(cheek);
  for (const z of [0.12, 0.20]) ch.add(cyl(0.004, 0.004, 0.03, M.steel, { axis: 'y', pos: [0, 0.012, z] }));
  ch.add(box(0.030, 0.030, 0.050, M.anod, { pos: [0, -0.055, 0.29], r: 0.003 })); // bag rider / monopod mount
  for (const z of [-0.14, -0.05, 0.05]) for (const sx of [-1, 1]) ch.add(screw(0.0035, M.steel, M.dark, { pos: [sx * 0.016, -0.0565, z], rot: [Math.PI, 0, 0] }));
  root.add(ch);

  // ---------------------------------------------------------------- bipod (folded forward under the forend)
  const bp = new THREE.Group();
  bp.add(box(0.050, 0.020, 0.040, M.dark, { pos: [0, -0.062, -0.560], r: 0.002 }));
  for (const sx of [-1, 1]) bp.add(box(0.012, 0.012, 0.13, M.dark, { pos: [sx * 0.022, -0.066, -0.62], r: 0.002, rot: [0.08, 0, 0] }));
  root.add(bp);

  // ---------------------------------------------------------------- magazine (10 rd, steel AICS pattern)
  const mag = new THREE.Group(); mag.name = 'magazine';
  mag.add(box(0.030, 0.078, 0.076, M.nitride, { pos: [0, -0.039, 0], r: 0.002 }));
  mag.add(box(0.034, 0.006, 0.080, M.nitride, { pos: [0, -0.081, 0.002], r: 0.001 }));
  for (const sx of [-1, 1]) mag.add(box(0.006, 0.003, 0.050, M.steel, { pos: [sx * 0.011, 0.0015, 0.002] }));
  const topRound = cartridgeModel(CARTRIDGES['308_m118lr'], M); topRound.name = 'topRound';
  topRound.position.set(0, 0.002, 0.034); mag.add(topRound);
  mag.position.set(0, -0.056, -0.155);
  root.add(mag);
  parts.mag = { obj: mag, rest: mag.position.clone(), restRot: mag.rotation.clone(), length: 0.085 };

  // ---------------------------------------------------------------- trigger
  const trig = new THREE.Group(); trig.position.set(0, -0.045, -0.052);
  trig.add(sideProfile([[0.002, 0], [0.004, -0.006], [0.001, -0.016], [-0.004, -0.018], [-0.006, -0.015], [-0.004, -0.006], [-0.002, 0]], 0.008, M.blued, { bevel: 0.0006 }));
  root.add(trig); parts.trigger = { obj: trig, maxAngle: 4 * DEG };

  // ---------------------------------------------------------------- scope: 34 mm tube, 50 mm objective, one-piece mount
  const sc = new THREE.Group(); sc.name = 'scope';
  const SY = S.sightHeight, SZ = -0.060; // optical axis height and centre
  const railTop = RO + 0.012;
  // mount: base + two rings with cap screws
  sc.add(box(0.036, 0.010, 0.120, M.anod, { pos: [0, railTop + 0.005, -0.08], r: 0.002 }));
  for (const z of [-0.125, -0.035]) {
    sc.add(box(0.040, SY - railTop - 0.017 + 0.004, 0.022, M.anod, { pos: [0, railTop + 0.010 + (SY - railTop - 0.017) / 2 - 0.002, z], r: 0.002 }));
    sc.add(lathe([[0.017, -0.011], [0.0215, -0.011], [0.0215, 0.011], [0.017, 0.011]], M.anod, { seg: 40, pos: [0, SY, z] }));
    for (const sx of [-1, 1]) for (const dz of [-0.006, 0.006]) sc.add(screw(0.0025, M.steel, M.dark, { pos: [sx * 0.0175, SY + 0.0215, z + dz] }));
  }
  // main tube body: objective bell → tube → turret saddle → tube → magnification ring → ocular bell
  const tubeProf = [
    [0.0295, -0.240], [0.0295, -0.180], [0.0170, -0.150], [0.0170, -0.085], [0.0215, -0.080], [0.0215, -0.030], [0.0170, -0.025],
    [0.0170, 0.045], [0.0215, 0.050], [0.0215, 0.072], [0.0230, 0.075], [0.0230, 0.098], [0.0215, 0.100],
  ];
  sc.add(lathe(tubeProf, M.anod, { seg: 48, pos: [0, SY, 0] }));
  // turrets: elevation (top), windage (right), parallax/illumination (left)
  const elev = cyl(0.0165, 0.0165, 0.022, M.knurl, { axis: 'y', pos: [0, SY + 0.0215 + 0.011, SZ + 0.005] });
  const wind = cyl(0.014, 0.014, 0.018, M.knurl, { axis: 'x', pos: [0.0215 + 0.009, SY, SZ + 0.005] });
  const plx = cyl(0.014, 0.014, 0.020, M.knurl, { axis: 'x', pos: [-(0.0215 + 0.010), SY, SZ + 0.005] });
  sc.add(elev, wind, plx);
  sc.add(cyl(0.013, 0.013, 0.002, M.dark, { axis: 'y', pos: [0, SY + 0.0215 + 0.023, SZ + 0.005] })); // elevation index cap
  parts.turrets = { elev, wind, plx };
  // zero-stop indicator line on the elevation turret
  sc.add(box(0.001, 0.010, 0.001, mat('whitePaint'), { pos: [0, SY + 0.0215 + 0.011, SZ + 0.005 - 0.0165] }));
  // magnification ring with throw lever
  sc.add(cyl(0.0225, 0.0225, 0.020, M.knurl, { axis: 'z', pos: [0, SY, 0.062] }));
  sc.add(box(0.008, 0.024, 0.010, M.anod, { pos: [0, SY - 0.032, 0.062], r: 0.002 }));
  // lenses: objective (glass) & ocular (scope shader assigned by optics.js)
  const objective = new THREE.Mesh(new THREE.CircleGeometry(0.0245, 40), M.glass);
  objective.position.set(0, SY, -0.238); objective.rotation.y = Math.PI; sc.add(objective);
  sc.add(cyl(0.0245, 0.0245, 0.003, M.dark, { axis: 'z', pos: [0, SY, -0.236], seg: 40 })); // dark interior behind the objective
  const ocular = new THREE.Mesh(new THREE.CircleGeometry(0.0195, 40), null);
  ocular.position.set(0, SY, 0.0995); ocular.name = 'ocular'; sc.add(ocular);
  root.add(sc);
  parts.scope = { obj: sc, ocular, axisPoint: new THREE.Vector3(0, SY, SZ), ocularZ: 0.0995, ocularRadius: 0.0195, objectiveZ: -0.238 };

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const anchors = {
    muzzle: new THREE.Vector3(0, 0, -0.830),
    boreDir: new THREE.Vector3(0, 0, -1),
    sightAxis: { y: SY, x: 0, z: SZ },
    eyeZ: 0.0995 + S.scope.eyeReliefM,
    ejection: { pos: new THREE.Vector3(...S.ejection.pos), dir: new THREE.Vector3(...S.ejection.dir).normalize(), speed: S.ejection.speed },
    magSeat: new THREE.Vector3(0, -0.056, -0.155),
    gripR: { pos: new THREE.Vector3(0.032, -0.044, 0.112), rot: orientHand(new THREE.Vector3(0, -0.5, -0.866), new THREE.Vector3(-1, 0, 0)), forearm: new THREE.Vector3(0.10, -0.30, 1.0) },
    gripL: { pos: new THREE.Vector3(-0.040, -0.030, -0.380), rot: orientHand(new THREE.Vector3(0.25, -0.5, -0.83), new THREE.Vector3(1, 0.05, 0)), forearm: new THREE.Vector3(-0.25, -0.75, 0.9) },
    chargingHandle: new THREE.Vector3(0.049, -0.031, -0.008),
    magRelease: new THREE.Vector3(0, -0.060, -0.108),
    boltCatch: new THREE.Vector3(-0.02, 0, -0.075),
    chamber: new THREE.Vector3(0, 0, -0.19),
    hipOffset: new THREE.Vector3(0.085, -0.100, -0.28),
  };

  const api = {
    spec: S, group: root, parts, anchors, materials: M,
    cart: CARTRIDGES[S.defaultAmmo],
    /** bolt: lift 0..1 (rotation), pull 0..1 (travel) */
    setBolt(lift, pull) { bolt.rotation.z = lift * parts.bolt.lift; bolt.position.z = parts.bolt.rest.z + pull * parts.bolt.travel; },
    setActionPos(t) { api.setBolt(t > 0 ? 1 : 0, t); },
    setChargingHandle(t) { api.setActionPos(t); },
    setDustCover() {},
    setTrigger(t) { trig.rotation.x = -t * parts.trigger.maxAngle; },
    setSelector(mode) { safety.position.z = parts.safety.rest.z + (mode === 'safe' ? 0.006 : 0); },
    setMagRelease() {},
    setBoltCatch() {},
    setMagVisible(v) { mag.visible = v; },
    setMagOffset(pos, rot) { mag.position.copy(parts.mag.rest).add(pos); if (rot) mag.rotation.set(parts.mag.restRot.x + rot.x, parts.mag.restRot.y + rot.y, parts.mag.restRot.z + rot.z); },
    setMagTopRound(v) { topRound.visible = v; },
    setTurrets(elevClicks, windClicks) { elev.rotation.y = -elevClicks * (Math.PI * 2 / 100); wind.rotation.x = windClicks * (Math.PI * 2 / 100); },
  };
  return api;
}

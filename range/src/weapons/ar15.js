// ============================================================================
// RANGE — weapons/ar15.js
// M4-pattern 5.56 carbine, modelled to real dimensions (metres):
// 14.5" barrel + A2 flash hider, 13" free-float M-LOK handguard, flat-top
// upper with a T2-style red dot (absolute co-witness height 66 mm over bore),
// collapsible stock, 30-rd polymer magazine.
// Frame: origin on the bore axis at the rear face of the upper receiver,
// -Z toward the muzzle, +Y up, +X shooter's right.
// Animatable parts are exposed on `parts` with rest transforms; the viewmodel
// drives them through the setters at the bottom.
// ============================================================================
import * as THREE from 'three';
import { mat } from '../materials.js';
import { box, cyl, lathe, sideProfile, frontProfile, plateWithSlots, picatinny, screw, group, place, cartridgeModel, DEG } from '../gunparts.js';
import { CARTRIDGES } from '../cartridges.js';
import { orientHand } from '../hands.js';

export const AR15_SPEC = {
  id: 'ar15', name: 'M4A1-pattern carbine', short: 'M4 carbine',
  caliber: '5.56', defaultAmmo: '556_m855', magCapacity: 30,
  barrelIn: 14.5, twistMm: 177.8, massKg: 3.4, // loaded, with optic
  action: 'gas', fireModes: ['semi', 'auto'], cyclicRpm: 850,
  lockTimeMs: 6.0, triggerTravelMm: 6, triggerBreakN: 27, // ~6 lb mil-spec
  sightHeight: 0.066, zeroRange: 50,
  boreOverGrip: 0.085, boreOverButt: 0.012, stockLength: 0.35,
  bcgMassKg: 0.42, bcgStroke: 0.088, bufferSpringN: [35, 95], // preload → full compression force
  dispersionMoa: 1.5, // rifle's own mechanical dispersion, adds to ammo
  ejection: { pos: [0.024, 0.004, -0.124], dir: [0.82, 0.42, 0.38], speed: 6.5 },
  reflex: { size: 2, colour: 0xff2a1a },
};

export function buildAR15(opts = {}) {
  const S = AR15_SPEC;
  const M = {
    anod: mat('anodized'), phos: mat('phosphate'), nitride: mat('nitride'), steel: mat('wornSteel'), knurl: mat('knurledSteel'),
    poly: mat('polymer'), stipple: mat('polymerStipple'), rubber: mat('rubber'), dark: mat('blackPaint'), stainless: mat('stainless'),
    brass: mat('brass'), primer: mat('primer'), copper: mat('copper'), greenTip: mat('greenTip'), redTip: mat('redTip'), lensTint: mat('lensTint'),
  };
  const root = new THREE.Group(); root.name = 'ar15';
  const parts = {};

  // ---------------------------------------------------------------- upper receiver
  const upper = new THREE.Group(); upper.name = 'upper';
  const UW = 0.032, wall = 0.0035;
  const upperOutline = [[0, -0.014], [-0.197, -0.014], [-0.197, 0.019], [-0.03, 0.019], [-0.03, 0.022], [0.0, 0.022]];
  // left wall
  upper.add(place(sideProfile(upperOutline, wall, M.anod, { bevel: 0.0008 }), [-(UW / 2 - wall / 2), 0, 0]));
  // right wall with the ejection port
  const port = [[-0.152, -0.004], [-0.096, -0.004], [-0.096, 0.012], [-0.152, 0.012]];
  const portR = roundedOutline(port, 0.004);
  upper.add(place(sideProfile(upperOutline, wall, M.anod, { bevel: 0.0008, holes: [portR] }), [UW / 2 - wall / 2, 0, 0]));
  // top deck (charging handle channel roof) and rail
  upper.add(box(UW, 0.0045, 0.197, M.anod, { pos: [0, 0.0208, -0.0985] }));
  upper.add(box(0.022, 0.0035, 0.19, M.anod, { pos: [0, 0.0238, -0.1] }));
  upper.add(place(picatinny(0.19, M.anod), [0, 0.0300, -0.1]));
  // bottom plate behind the mag well + rear face
  upper.add(box(UW - 2 * wall, 0.005, 0.10, M.anod, { pos: [0, -0.0115, -0.05] }));
  upper.add(box(UW, 0.026, 0.004, M.anod, { pos: [0, 0.0, 0.0] }));
  // front ring / barrel nut
  upper.add(cyl(0.0175, 0.0175, 0.034, M.anod, { axis: 'z', pos: [0, 0, -0.214] }));
  upper.add(lathe([[0.019, -0.230], [0.019, -0.246], [0.017, -0.248], [0.013, -0.248], [0.013, -0.230]], M.steel, { seg: 24 })); // barrel nut, knurled steel
  // forward assist (right rear)
  upper.add(cyl(0.0075, 0.0075, 0.014, M.anod, { axis: 'z', pos: [UW / 2 + 0.004, 0.004, -0.045], rot: [0, 0.35, 0] }));
  upper.add(cyl(0.0062, 0.0062, 0.010, M.steel, { axis: 'z', pos: [UW / 2 + 0.004, 0.004, -0.034], rot: [0, 0.35, 0] }));
  // brass deflector (wedge behind the port)
  upper.add(place(sideProfile([[-0.094, -0.005], [-0.070, -0.005], [-0.070, 0.014], [-0.094, 0.014]], 0.012, M.anod, { bevel: 0.001 }), [UW / 2 + 0.004, 0, 0], [0, 0.35, 0]));
  // rear takedown / front pivot pins
  for (const z of [0.018, -0.182]) for (const sx of [-1, 1]) upper.add(cyl(0.0035, 0.0035, 0.003, M.steel, { axis: 'x', pos: [sx * (UW / 2 + 0.0005), -0.018, z] }));
  // inside: rear of the receiver (visible when the carrier is back)
  upper.add(box(UW - 2 * wall, 0.03, 0.004, M.dark, { pos: [0, 0.003, -0.002] }));
  root.add(upper);

  // ---------------------------------------------------------------- bolt carrier group (visible through the port)
  const bcg = new THREE.Group(); bcg.name = 'bcg';
  bcg.add(cyl(0.011, 0.011, 0.145, M.phos, { axis: 'z', pos: [0, 0.0, -0.0735] }));                 // carrier body (rear at z=-0.001)
  bcg.add(box(0.014, 0.008, 0.06, M.phos, { pos: [0, 0.0125, -0.09] }));                                // gas key
  for (const z of [-0.075, -0.105]) bcg.add(screw(0.003, M.steel, M.dark, { pos: [0, 0.0165, z] }));
  bcg.add(cyl(0.0095, 0.0095, 0.024, M.phos, { axis: 'z', pos: [0, 0, -0.157] }));                     // bolt body protruding
  bcg.add(cyl(0.0095, 0.0075, 0.004, M.stainless, { axis: 'z', pos: [0, 0, -0.166] }));                // bolt face (lugs ring)
  bcg.add(box(0.005, 0.006, 0.02, M.steel, { pos: [0.0085, 0.0015, -0.156] }));                          // extractor on the right
  bcg.add(cyl(0.0045, 0.0045, 0.008, M.steel, { axis: 'y', pos: [0.006, 0.010, -0.135] }));               // cam pin
  bcg.add(cyl(0.002, 0.002, 0.016, M.steel, { axis: 'x', pos: [0, -0.006, -0.02] }));                    // firing pin retaining pin
  bcg.position.set(0, 0, 0);
  root.add(bcg);
  parts.bcg = { obj: bcg, rest: bcg.position.clone(), stroke: S.bcgStroke };

  // ---------------------------------------------------------------- charging handle
  const ch = new THREE.Group(); ch.name = 'chargingHandle';
  ch.add(box(0.019, 0.005, 0.19, M.anod, { pos: [0, 0.0165, -0.085], r: 0.001 }));               // shaft
  ch.add(box(0.050, 0.010, 0.022, M.anod, { pos: [0, 0.015, 0.014], r: 0.0025 }));               // T handle
  ch.add(box(0.014, 0.008, 0.018, M.steel, { pos: [-0.030, 0.014, 0.016], r: 0.0015 }));         // latch (left, bare)
  ch.add(box(0.004, 0.012, 0.012, M.knurl, { pos: [0.026, 0.015, 0.014], r: 0.001 }));           // right wing serration
  root.add(ch);
  parts.chargingHandle = { obj: ch, rest: ch.position.clone(), stroke: 0.085 };

  // ---------------------------------------------------------------- dust cover (hinge on the port's top edge, right side)
  const dcPivot = new THREE.Group(); dcPivot.position.set(UW / 2 + 0.0005, 0.0125, -0.124);
  const dcPlate = box(0.0015, 0.0165, 0.058, M.anod, { pos: [0, -0.00825, 0] });
  dcPivot.add(dcPlate);
  dcPivot.add(cyl(0.0012, 0.0012, 0.062, M.steel, { axis: 'z', pos: [0, 0, 0] })); // hinge rod
  root.add(dcPivot);
  parts.dustCover = { obj: dcPivot, openAngle: 82 * DEG };

  // ---------------------------------------------------------------- lower receiver
  const lower = new THREE.Group(); lower.name = 'lower';
  const LW = 0.031;
  const lowerOutline = [
    [0.030, -0.014], [0.030, -0.048], [-0.020, -0.048], [-0.020, -0.052], [-0.096, -0.052], [-0.100, -0.062],
    [-0.176, -0.062], [-0.168, -0.030], [-0.185, -0.030], [-0.185, -0.014],
  ];
  // the trigger-guard opening is a real hole through the receiver profile
  const guardHole = roundedOutline([[-0.092, -0.048], [-0.024, -0.048], [-0.024, -0.030], [-0.092, -0.030]], 0.003);
  lower.add(sideProfile(lowerOutline, LW, M.anod, { bevel: 0.0012, holes: [guardHole] }));
  // rear of the lower: buffer tower + castle nut + end plate
  lower.add(box(0.030, 0.030, 0.012, M.anod, { pos: [0, -0.0, 0.028], r: 0.002 }));
  lower.add(cyl(0.019, 0.019, 0.006, M.anod, { axis: 'z', pos: [0, 0.006, 0.036] }));       // end plate
  lower.add(cyl(0.0175, 0.0175, 0.008, M.knurl, { axis: 'z', pos: [0, 0.006, 0.043] }));     // castle nut
  // mag release (right) with fence, bolt catch (left)
  const magFence = place(sideProfile([[-0.090, -0.020], [-0.106, -0.020], [-0.106, -0.036], [-0.090, -0.036]], 0.004, M.anod, { bevel: 0.001 }), [LW / 2 + 0.001, 0, 0]);
  lower.add(magFence);
  const magRel = cyl(0.0055, 0.0055, 0.006, M.steel, { axis: 'x', pos: [LW / 2 + 0.003, -0.028, -0.098] });
  lower.add(magRel); parts.magRelease = { obj: magRel, rest: magRel.position.clone(), travel: 0.003 };
  const boltCatch = box(0.004, 0.022, 0.011, M.anod, { pos: [-(LW / 2 + 0.002), -0.006, -0.112], r: 0.001 });
  lower.add(boltCatch); parts.boltCatch = { obj: boltCatch, rest: boltCatch.position.clone() };
  // selector (left)
  const sel = new THREE.Group(); sel.position.set(-(LW / 2 + 0.002), -0.024, -0.004);
  sel.add(cyl(0.0055, 0.0055, 0.004, M.anod, { axis: 'x' }));
  sel.add(box(0.004, 0.006, 0.026, M.anod, { pos: [0, 0, -0.013], r: 0.001 })); // lever pointing forward = SAFE
  lower.add(sel); parts.selector = { obj: sel };
  // selector markings (tiny plates): SAFE/SEMI — omitted at this scale
  // trigger
  const trig = new THREE.Group(); trig.position.set(0, -0.024, -0.045);
  const bow = sideProfile([[0, 0], [0.004, 0], [0.004, -0.010], [-0.004, -0.021], [-0.007, -0.022], [-0.008, -0.020], [-0.001, -0.010], [-0.001, 0]], 0.0075, M.nitride, { bevel: 0.0006 });
  trig.add(bow);
  lower.add(trig); parts.trigger = { obj: trig, maxAngle: 9 * DEG };
  // grip
  const grip = sideProfile([[-0.020, -0.046], [0.016, -0.046], [0.050, -0.118], [0.048, -0.128], [0.018, -0.130], [0.010, -0.104], [0.002, -0.080], [-0.006, -0.060]], 0.030, M.stipple, { bevel: 0.004, bevelSeg: 4 });
  lower.add(grip);
  // the little rear mounting screw of the grip is hidden; add a beavertail bump behind the selector
  lower.add(box(0.030, 0.012, 0.014, M.anod, { pos: [0, -0.052, 0.024], r: 0.003 }));
  root.add(lower);

  // ---------------------------------------------------------------- buffer tube + stock
  const tube = cyl(0.0147, 0.0147, 0.180, M.anod, { axis: 'z', pos: [0, 0.006, 0.13] });
  root.add(tube);
  // adjustment holes along the bottom of the tube
  for (let i = 0; i < 6; i++) root.add(cyl(0.002, 0.002, 0.004, M.dark, { axis: 'y', pos: [0, -0.008, 0.075 + i * 0.019] }));
  const stock = new THREE.Group(); stock.name = 'stock';
  const stockOutline = [[0.072, 0.025], [0.205, 0.025], [0.218, 0.014], [0.224, -0.020], [0.222, -0.060], [0.214, -0.070], [0.196, -0.070], [0.176, -0.058], [0.150, -0.038], [0.118, -0.024], [0.090, -0.020], [0.072, -0.020]];
  stock.add(sideProfile(stockOutline, 0.040, M.poly, { bevel: 0.004, bevelSeg: 4 }));
  stock.add(place(sideProfile([[0.216, 0.016], [0.228, 0.010], [0.234, -0.020], [0.232, -0.060], [0.222, -0.070], [0.214, -0.070]], 0.036, M.rubber, { bevel: 0.002 }), [0, 0, 0])); // butt pad
  stock.add(box(0.026, 0.006, 0.020, M.poly, { pos: [0, -0.022, 0.090], r: 0.0015 })); // adjustment lever
  stock.add(box(0.006, 0.012, 0.018, M.dark, { pos: [0, -0.044, 0.15] })); // QD sling slot block
  root.add(stock);

  // ---------------------------------------------------------------- barrel, gas system, muzzle device
  const barrelProf = [
    [0.0125, -0.200], [0.0125, -0.245], [0.0110, -0.252], [0.0089, -0.262], [0.0089, -0.362], [0.0095, -0.366], [0.0095, -0.396],
    [0.0089, -0.400], [0.0089, -0.520], [0.0063, -0.523], [0.0063, -0.540], [0.0030, -0.540], [0.0030, -0.535], [0.0028, -0.535],
  ];
  const barrel = lathe(barrelProf, M.nitride, { seg: 36 }); barrel.name = 'barrel'; root.add(barrel);
  // gas block + gas tube
  root.add(box(0.019, 0.021, 0.026, M.nitride, { pos: [0, 0.004, -0.378], r: 0.0015 }));
  root.add(cyl(0.0023, 0.0023, 0.19, M.stainless, { axis: 'z', pos: [0, 0.0145, -0.285], seg: 12 }));
  for (const sx of [-1, 1]) root.add(screw(0.0025, M.steel, M.dark, { pos: [sx * 0.007, -0.0075, -0.378], rot: [Math.PI, 0, 0] }));
  // A2 flash hider: base ring, 5 prongs (solid bottom), front ring
  const fh = new THREE.Group(); fh.name = 'flashHider';
  fh.add(lathe([[0.0063, -0.523], [0.0110, -0.523], [0.0110, -0.545], [0.0100, -0.546], [0.0063, -0.546]], M.phos, { seg: 32 }));
  fh.add(lathe([[0.0063, -0.574], [0.0110, -0.574], [0.0110, -0.580], [0.0045, -0.580], [0.0045, -0.576], [0.0063, -0.576]], M.phos, { seg: 32 }));
  // prongs: bars between the rings; 5 slots at the top (36° each) leave the bottom 108° solid
  const prongAngles = [90 - 36 * 2.5 - 18, 90 - 36 * 1.5 - 18, 90 - 36 * 0.5 - 18, 90 + 36 * 0.5 + 18, 90 + 36 * 1.5 + 18, 90 + 36 * 2.5 + 18];
  for (const a of prongAngles) {
    const r = 0.0092; const x = Math.cos(a * DEG) * r, y = Math.sin(a * DEG) * r;
    fh.add(box(0.0035, 0.0038, 0.030, M.phos, { pos: [x, y, -0.560], rot: [0, 0, a * DEG - Math.PI / 2] }));
  }
  fh.add(place(frontProfile([[-0.0095, -0.003], [0.0095, -0.003], [0.0095, -0.011], [-0.0095, -0.011]], 0.030, M.phos), [0, 0, -0.560])); // solid bottom
  fh.add(cyl(0.0032, 0.0032, 0.004, M.dark, { axis: 'z', pos: [0, 0, -0.5785] })); // bore (dark)
  root.add(fh);

  // ---------------------------------------------------------------- handguard (13" M-LOK) — real slots
  const hg = new THREE.Group(); hg.name = 'handguard';
  const HL = 0.330, HZ = -0.380; // centre z
  const slots = [];
  for (let i = -3; i <= 3; i++) slots.push({ x: i * 0.040, y: 0, w: 0.032, h: 0.007, r: 0.0035 });
  const sidePanel = (sx) => place(plateWithSlots(HL, 0.030, 0.004, slots, M.anod), [sx * 0.019, 0.001, HZ], [0, Math.PI / 2, 0]);
  hg.add(sidePanel(-1), sidePanel(1));
  hg.add(place(plateWithSlots(HL, 0.026, 0.004, slots, M.anod), [0, -0.021, HZ], [Math.PI / 2, 0, Math.PI / 2]));       // bottom
  const diag = (sx, y0, y1, x0, x1, withSlots) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const p = plateWithSlots(HL, len, 0.004, withSlots ? slots.map(s => ({ ...s, h: 0.006, r: 0.003 })) : [], M.anod);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    p.rotation.set(0, Math.PI / 2, 0);
    const g = new THREE.Group(); g.add(p); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, HZ); g.rotation.z = ang - Math.PI / 2;
    return g;
  };
  hg.add(diag(1, -0.021, -0.014, 0.013, 0.019, false), diag(-1, -0.021, -0.014, -0.013, -0.019, false));
  hg.add(diag(1, 0.016, 0.0255, 0.019, 0.011, true), diag(-1, 0.016, 0.0255, -0.019, -0.011, true));
  hg.add(box(0.022, 0.004, HL, M.anod, { pos: [0, 0.0255, HZ] }));                                  // top deck
  hg.add(place(picatinny(HL - 0.002, M.anod), [0, 0.0300, HZ]));                                     // continuous top rail
  // rear clamp collar over the barrel nut
  hg.add(place(frontProfile([[-0.022, -0.023], [0.022, -0.023], [0.022, 0.018], [0.013, 0.0275], [-0.013, 0.0275], [-0.022, 0.018]], 0.032, M.anod, { bevel: 0.0015 }), [0, 0, -0.230]));
  for (const z of [-0.222, -0.238]) for (const sx of [-1, 1]) hg.add(screw(0.003, M.steel, M.dark, { pos: [sx * 0.0125, -0.0245, z], rot: [Math.PI, 0, 0] }));
  // an angled foregrip-less handstop at the front bottom (common) — small
  hg.add(box(0.020, 0.010, 0.030, M.poly, { pos: [0, -0.028, -0.505], r: 0.003 }));
  root.add(hg);

  // ---------------------------------------------------------------- folded backup irons
  root.add(box(0.030, 0.007, 0.040, M.poly, { pos: [0, 0.0335, -0.035], r: 0.0015 }));   // rear MBUS folded
  root.add(box(0.026, 0.007, 0.034, M.poly, { pos: [0, 0.0335, -0.520], r: 0.0015 }));   // front MBUS folded

  // ---------------------------------------------------------------- red dot (T2-style, absolute co-witness)
  const rd = new THREE.Group(); rd.name = 'redDot';
  const RZ = -0.100; // optic centre
  rd.add(box(0.030, 0.0215, 0.050, M.anod, { pos: [0, 0.0300 + 0.01075, RZ], r: 0.002 }));                  // mount body
  rd.add(box(0.036, 0.008, 0.012, M.anod, { pos: [0, 0.036, RZ + 0.015], r: 0.0015 }));                        // cross-bolt block
  rd.add(cyl(0.004, 0.004, 0.036, M.steel, { axis: 'x', pos: [0, 0.036, RZ + 0.015] }));                       // cross bolt
  rd.add(box(0.005, 0.012, 0.026, M.anod, { pos: [0.020, 0.036, RZ + 0.010], r: 0.001 }));                     // throw lever
  const axisY = S.sightHeight;
  rd.add(lathe([[0.012, -0.020], [0.0152, -0.020], [0.0160, -0.017], [0.0160, 0.014], [0.0150, 0.017], [0.0125, 0.018], [0.0125, 0.014], [0.014, 0.012], [0.014, -0.015], [0.012, -0.017]], M.anod, { seg: 40, pos: [0, axisY, RZ] })); // tube
  rd.add(lathe([[0.0125, 0.014], [0.0165, 0.014], [0.0165, 0.019], [0.0125, 0.019]], M.knurl, { seg: 40, pos: [0, axisY, RZ] })); // rear ring (knurled)
  rd.add(cyl(0.006, 0.006, 0.006, M.anod, { axis: 'y', pos: [0, axisY + 0.017, RZ] }));                         // elevation turret cap
  rd.add(cyl(0.006, 0.006, 0.006, M.anod, { axis: 'x', pos: [0.017, axisY, RZ] }));                              // windage cap
  rd.add(cyl(0.009, 0.009, 0.008, M.knurl, { axis: 'x', pos: [-0.019, axisY, RZ - 0.002] }));                    // brightness dial / battery
  // lenses: front (objective, slightly tilted like a real reflex sight) and rear (ocular) — the rear disc carries the reticle shader
  const frontLens = cyl(0.0122, 0.0122, 0.0015, M.lensTint, { axis: 'z', pos: [0, axisY, RZ - 0.017], seg: 40 });
  frontLens.rotation.x = 0.12; rd.add(frontLens);
  const reticleLens = new THREE.Mesh(new THREE.CircleGeometry(0.0122, 40), null); // material assigned by optics.js
  reticleLens.position.set(0, axisY, RZ + 0.012); reticleLens.rotation.y = Math.PI; // faces the shooter
  reticleLens.name = 'reticle';
  rd.add(reticleLens);
  root.add(rd);
  parts.reticle = { obj: reticleLens, axisPoint: new THREE.Vector3(0, axisY, RZ), tubeRadius: 0.0125 };

  // ---------------------------------------------------------------- magazine (30-rd polymer)
  const mag = buildMagazine(M);
  mag.position.set(0, -0.014, -0.135);
  root.add(mag);
  parts.mag = { obj: mag, rest: mag.position.clone(), restRot: mag.rotation.clone(), length: 0.19 };

  // ---------------------------------------------------------------- anchors
  const anchors = {
    muzzle: new THREE.Vector3(0, 0, -0.580),
    boreDir: new THREE.Vector3(0, 0, -1),
    sightAxis: { y: axisY, x: 0, z: RZ },
    eyeZ: 0.19,                    // eye position (gun frame z) when aiming: ~29 cm behind the optic
    ejection: { pos: new THREE.Vector3(...S.ejection.pos), dir: new THREE.Vector3(...S.ejection.dir).normalize(), speed: S.ejection.speed },
    magSeat: new THREE.Vector3(0, -0.014, -0.135),
    gripR: { pos: new THREE.Vector3(0.033, -0.048, 0.064), rot: orientHand(new THREE.Vector3(0, -0.5, -0.866), new THREE.Vector3(-1, 0, 0)), forearm: new THREE.Vector3(0.10, -0.30, 1.0) },
    gripL: { pos: new THREE.Vector3(-0.037, -0.004, -0.355), rot: orientHand(new THREE.Vector3(0.25, -0.5, -0.83), new THREE.Vector3(1, 0.05, 0)), forearm: new THREE.Vector3(-0.25, -0.75, 0.9) },
    magInHand: { pos: new THREE.Vector3(0.0, -0.02, 0.0), rot: new THREE.Euler(0, 0, 0) },
    chargingHandle: new THREE.Vector3(0, 0.015, 0.022),
    magRelease: new THREE.Vector3(0.02, -0.028, -0.098),
    boltCatch: new THREE.Vector3(-0.02, -0.006, -0.112),
    selector: new THREE.Vector3(-0.02, -0.024, -0.004),
    chamber: new THREE.Vector3(0, 0, -0.17),
    hipOffset: new THREE.Vector3(0.085, -0.105, -0.30),
  };

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---------------------------------------------------------------- setters used by the animation system
  const api = {
    spec: S, group: root, parts, anchors, materials: M,
    cart: CARTRIDGES[S.defaultAmmo],
    /** 0 = in battery, 1 = fully rearward */
    setActionPos(t) { bcg.position.z = parts.bcg.rest.z + t * S.bcgStroke; },
    setChargingHandle(t) { ch.position.z = parts.chargingHandle.rest.z + t * parts.chargingHandle.stroke; },
    setDustCover(t) { dcPivot.rotation.z = t * parts.dustCover.openAngle; },
    setTrigger(t) { trig.rotation.x = -t * parts.trigger.maxAngle; },
    setSelector(mode) { sel.rotation.x = mode === 'safe' ? 0 : mode === 'semi' ? Math.PI / 2 : Math.PI; },
    setMagRelease(t) { magRel.position.x = parts.magRelease.rest.x - t * parts.magRelease.travel; },
    setBoltCatch(t) { boltCatch.rotation.x = t * 0.25; },
    setMagVisible(v) { mag.visible = v; },
    setMagOffset(pos, rot) { mag.position.copy(parts.mag.rest).add(pos); if (rot) mag.rotation.set(parts.mag.restRot.x + rot.x, parts.mag.restRot.y + rot.y, parts.mag.restRot.z + rot.z); },
    /** show/hide the top round in the magazine */
    setMagTopRound(v) { const r = mag.getObjectByName('topRound'); if (r) r.visible = v; },
    setChamberRound() {},
  };
  api.setSelector('safe');
  return api;
}

function roundedOutline(rect, r) {
  // rect: 4 points [z,y] axis-aligned; returns a rounded polygon
  const zs = rect.map(p => p[0]), ys = rect.map(p => p[1]);
  const z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pts = [];
  const corner = (cz, cy, a0, a1) => { for (let i = 0; i <= 5; i++) { const a = a0 + (a1 - a0) * i / 5; pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(z1 - r, y0 + r, -Math.PI / 2, 0);
  corner(z1 - r, y1 - r, 0, Math.PI / 2);
  corner(z0 + r, y1 - r, Math.PI / 2, Math.PI);
  corner(z0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return pts;
}

/** 30-round polymer magazine: curved body, floorplate, feed lips with a visible top round. Origin at the top-rear, y=0 = top. */
function buildMagazine(M) {
  const g = new THREE.Group(); g.name = 'magazine';
  const L = 0.190, k = 0.83, depthTop = 0.062, depthBot = 0.056;
  const back = [], front = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N, s = t * L;
    const zShift = -k * s * s; // curves forward with depth
    const depth = depthTop + (depthBot - depthTop) * t;
    back.push([0.031 + zShift, -s]);
    front.push([0.031 - depth + zShift, -s]);
  }
  const outline = [...back, ...front.reverse()];
  const body = sideProfile(outline, 0.0245, M.poly, { bevel: 0.0025, bevelSeg: 3 });
  g.add(body);
  // ribs (three horizontal ridges) — thin boxes following the curve
  for (const t of [0.35, 0.55, 0.75]) {
    const s = t * L, zShift = -k * s * s, depth = depthTop + (depthBot - depthTop) * t;
    g.add(box(0.0265, 0.004, depth - 0.004, M.poly, { pos: [0, -s, 0.031 - depth / 2 + zShift], r: 0.001 }));
  }
  // floorplate
  const sB = L, zB = -k * sB * sB;
  g.add(box(0.028, 0.008, depthBot + 0.004, M.poly, { pos: [0, -L - 0.002, 0.031 - depthBot / 2 + zB], r: 0.002, rot: [0.31, 0, 0] }));
  // feed lips + follower + top round (visible when the mag is out)
  g.add(box(0.0245, 0.004, 0.058, M.poly, { pos: [0, 0.002, 0.0], r: 0.001 }));
  for (const sx of [-1, 1]) g.add(box(0.005, 0.004, 0.040, M.poly, { pos: [sx * 0.0095, 0.006, -0.006], r: 0.001 }));
  const top = cartridgeModel(CARTRIDGES['556_m855'], M);
  top.name = 'topRound'; top.position.set(0.0, 0.0065, 0.026); top.rotation.x = -0.02;
  g.add(top);
  return g;
}

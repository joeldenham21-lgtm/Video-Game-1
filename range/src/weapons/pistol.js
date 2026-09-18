// ============================================================================
// RANGE — weapons/pistol.js
// Glock 17-pattern 9×19 service pistol at real dimensions. Frame: origin on
// the bore axis at the breech face, -Z toward the muzzle.
// Moving parts: slide (45 mm stroke, locks back on empty), tilting barrel
// (Browning short-recoil unlock), trigger with safety blade, magazine,
// slide stop, recoil spring assembly visible with the slide back.
// ============================================================================
import * as THREE from 'three';
import { mat } from '../materials.js';
import { box, cyl, lathe, sideProfile, frontProfile, screw, place, cartridgeModel, DEG } from '../gunparts.js';
import { CARTRIDGES } from '../cartridges.js';
import { orientHand } from '../hands.js';

export const PISTOL_SPEC = {
  id: 'pistol', name: 'G17-pattern 9 mm pistol', short: 'G17 pistol',
  caliber: '9mm', defaultAmmo: '9mm_124', magCapacity: 17,
  barrelIn: 4.49, twistMm: 250, massKg: 0.90,
  action: 'recoil', fireModes: ['semi'], cyclicRpm: 1100,
  lockTimeMs: 3.0, triggerTravelMm: 10, triggerBreakN: 25,
  sightHeight: 0.0165, zeroRange: 25,
  boreOverGrip: 0.032, boreOverButt: 0, stockLength: 0,
  slideMassKg: 0.36, slideStroke: 0.045, slideLockPos: 0.040, recoilSpringN: [18, 45],
  dispersionMoa: 2.5,
  ejection: { pos: [0.016, 0.016, -0.012], dir: [0.62, 0.70, 0.35], speed: 5.0 },
};

export function buildPistol() {
  const S = PISTOL_SPEC;
  const M = {
    slide: mat('nitride'), frame: mat('polymerGrey'), stipple: mat('polymerStipple'), steel: mat('wornSteel'), stainless: mat('stainless'),
    dark: mat('blackPaint'), white: mat('whiteDot'), brass: mat('brass'), primer: mat('primer'), copper: mat('copper'), greenTip: mat('greenTip'), redTip: mat('redTip'),
  };
  const root = new THREE.Group(); root.name = 'pistol';
  const parts = {};

  // ---------------------------------------------------------------- slide (three extruded sections so the ejection port is a real cut)
  const slide = new THREE.Group(); slide.name = 'slide';
  const W = 0.0255, top = 0.0112, bot = -0.0112;
  const full = [[-W / 2 + 0.001, bot], [W / 2 - 0.001, bot], [W / 2, bot + 0.001], [W / 2, top - 0.004], [W / 2 - 0.003, top - 0.001], [W / 2 - 0.006, top], [-W / 2 + 0.006, top], [-W / 2 + 0.003, top - 0.001], [-W / 2, top - 0.004], [-W / 2, bot + 0.001]];
  const portSec = [[-W / 2 + 0.001, bot], [W / 2 - 0.001, bot], [W / 2, bot + 0.001], [W / 2, -0.004], [-0.0025, -0.004], [-0.0025, top], [-W / 2 + 0.006, top], [-W / 2 + 0.003, top - 0.001], [-W / 2, top - 0.004], [-W / 2, bot + 0.001]];
  const rear = frontProfile(full, 0.046, M.slide); rear.position.z = 0.022;
  const portPart = frontProfile(portSec, 0.031, M.slide); portPart.position.z = -0.0155;
  const front = frontProfile(full, 0.110, M.slide); front.position.z = -0.086;
  slide.add(rear, portPart, front);
  // rear and front cocking serrations (grooves inset into both sides)
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
    slide.add(box(0.0012, 0.014, 0.0016, M.dark, { pos: [sx * (W / 2 - 0.0002), -0.001, 0.036 - i * 0.0036] }));
    slide.add(box(0.0012, 0.012, 0.0016, M.dark, { pos: [sx * (W / 2 - 0.0002), -0.001, -0.115 - i * 0.0036] }));
  }
  // slide front slant (small wedge) and muzzle opening
  slide.add(cyl(0.0088, 0.0088, 0.004, M.dark, { axis: 'z', pos: [0, 0, -0.140] }));
  // extractor (right side, at the port's rear)
  slide.add(box(0.003, 0.007, 0.018, M.steel, { pos: [W / 2 - 0.0012, -0.0005, 0.010] }));
  // sights
  const frontPost = box(0.0032, 0.0055, 0.0045, M.slide, { pos: [0, top + 0.00275, -0.126] });
  slide.add(frontPost);
  slide.add(cyl(0.0011, 0.0011, 0.0005, M.white, { axis: 'z', pos: [0, top + 0.0035, -0.1237], seg: 12 })); // white dot on the post's rear face
  const rearBlock = (sx) => box(0.0075, 0.0058, 0.0075, M.slide, { pos: [sx * (0.00375 + 0.0018), top + 0.0029, 0.033] });
  slide.add(rearBlock(-1), rearBlock(1));
  slide.add(box(0.0186, 0.002, 0.0075, M.slide, { pos: [0, top + 0.001, 0.033] })); // notch floor
  // white U outline on the rear sight — two dots
  for (const sx of [-1, 1]) slide.add(cyl(0.0009, 0.0009, 0.0005, M.white, { axis: 'z', pos: [sx * 0.0046, top + 0.0035, 0.0368], seg: 12 }));
  // striker back plate
  slide.add(box(0.020, 0.018, 0.002, M.slide, { pos: [0, -0.001, 0.0455] }));
  root.add(slide);
  parts.slide = { obj: slide, rest: slide.position.clone(), stroke: S.slideStroke, lock: S.slideLockPos };

  // ---------------------------------------------------------------- barrel (tilts on unlock) — pivot at the locking block
  const barrelPivot = new THREE.Group(); barrelPivot.position.set(0, 0, -0.030);
  const barrelProf = [[0.0075, 0.030], [0.0075, 0.000], [0.0060, -0.004], [0.0060, -0.081], [0.0052, -0.084], [0.0045, -0.084], [0.0045, -0.082]];
  const barrel = lathe(barrelProf, M.slide, { seg: 32 }); barrelPivot.add(barrel);
  barrelPivot.add(box(0.0135, 0.004, 0.024, M.slide, { pos: [0, 0.0085, 0.017] })); // barrel hood (locks into the port)
  barrelPivot.add(cyl(0.0045, 0.0045, 0.002, M.dark, { axis: 'z', pos: [0, 0, -0.0835] }));
  root.add(barrelPivot);
  parts.barrel = { obj: barrelPivot, rest: barrelPivot.position.clone(), tilt: -3 * DEG, travel: 0.003 };

  // ---------------------------------------------------------------- recoil spring assembly (guide rod + coil), visible with the slide back
  const rsa = new THREE.Group();
  rsa.add(cyl(0.0022, 0.0022, 0.090, M.stainless, { axis: 'z', pos: [0, -0.013, -0.088], seg: 12 }));
  rsa.add(cyl(0.0058, 0.0058, 0.004, M.stainless, { axis: 'z', pos: [0, -0.013, -0.045], seg: 16 })); // rear collar
  // helix from z=0 (rear, pushes on the slide) to z=-0.082 (front, anchored at the guide-rod head)
  const helix = new THREE.CatmullRomCurve3(Array.from({ length: 160 }, (_, i) => { const t = i / 159; const a = t * Math.PI * 2 * 20; return new THREE.Vector3(Math.cos(a) * 0.0047, Math.sin(a) * 0.0047, -t * 0.082); }));
  const spring = new THREE.Mesh(new THREE.TubeGeometry(helix, 480, 0.0009, 5, false), M.stainless);
  spring.castShadow = true; spring.position.set(0, -0.013, -0.048); rsa.add(spring);
  root.add(rsa);
  parts.spring = { obj: spring, rest: spring.position.clone(), freeLen: 0.082 };

  // ---------------------------------------------------------------- frame (polymer)
  const frame = new THREE.Group(); frame.name = 'frame';
  const FW = 0.0250;
  const frameOutline = [
    [-0.130, -0.012], [-0.130, -0.030], [-0.075, -0.031], [-0.073, -0.036], [-0.068, -0.049], [-0.060, -0.052], [-0.022, -0.052], [-0.012, -0.044],
    [-0.006, -0.050], [0.010, -0.115], [0.014, -0.121], [0.050, -0.121], [0.054, -0.116], [0.036, -0.040], [0.042, -0.026], [0.035, -0.016], [0.028, -0.012],
  ];
  const guardHole = [[-0.062, -0.026], [-0.020, -0.026], [-0.018, -0.030], [-0.018, -0.044], [-0.022, -0.047], [-0.058, -0.047], [-0.063, -0.042], [-0.064, -0.030]];
  frame.add(sideProfile(frameOutline, FW, M.frame, { bevel: 0.0022, bevelSeg: 4, holes: [guardHole] }));
  // frame rails (steel inserts) along the top edge
  for (const sx of [-1, 1]) frame.add(box(0.002, 0.003, 0.030, M.steel, { pos: [sx * (FW / 2 - 0.001), -0.0125, -0.015] }));
  for (const sx of [-1, 1]) frame.add(box(0.002, 0.003, 0.016, M.steel, { pos: [sx * (FW / 2 - 0.001), -0.0125, 0.020] }));
  // accessory rail slot under the dust cover
  frame.add(box(0.020, 0.002, 0.006, M.dark, { pos: [0, -0.0305, -0.100] }));
  // grip stippling panels (sides, front strap, back strap)
  const gripPanel = (sx) => place(sideProfile([[-0.002, -0.052], [0.030, -0.045], [0.050, -0.112], [0.012, -0.112]], 0.0025, M.stipple, { bevel: 0.0008 }), [sx * (FW / 2 + 0.0004), 0, 0]);
  frame.add(gripPanel(-1), gripPanel(1));
  frame.add(box(0.018, 0.070, 0.0025, M.stipple, { pos: [0, -0.085, 0.0018], rot: [-0.30, 0, 0] })); // front strap
  frame.add(box(0.018, 0.075, 0.0025, M.stipple, { pos: [0, -0.078, 0.044], rot: [-0.24, 0, 0] })); // back strap
  // controls: slide stop (left), takedown lever (both), mag release (left), pins
  const slideStop = box(0.0035, 0.006, 0.026, M.steel, { pos: [-(FW / 2 + 0.0015), -0.015, 0.002], r: 0.0008 });
  frame.add(slideStop); parts.slideStop = { obj: slideStop, rest: slideStop.position.clone() };
  for (const sx of [-1, 1]) frame.add(box(0.0025, 0.003, 0.018, M.steel, { pos: [sx * (FW / 2 + 0.001), -0.017, -0.046] }));
  const magRel = box(0.004, 0.008, 0.008, M.frame, { pos: [-(FW / 2 + 0.001), -0.040, 0.000], r: 0.001 });
  frame.add(magRel); parts.magRelease = { obj: magRel, rest: magRel.position.clone(), travel: 0.003 };
  for (const z of [-0.041, 0.004, 0.020]) for (const sx of [-1, 1]) frame.add(cyl(0.0022, 0.0022, 0.0015, M.steel, { axis: 'x', pos: [sx * (FW / 2 + 0.0002), z === 0.020 ? -0.030 : -0.020, z] }));
  root.add(frame);

  // ---------------------------------------------------------------- trigger with safety blade
  const trig = new THREE.Group(); trig.position.set(0, -0.026, -0.040);
  trig.add(sideProfile([[0.002, 0], [0.005, -0.006], [0.002, -0.018], [-0.003, -0.020], [-0.006, -0.017], [-0.005, -0.006], [-0.003, 0]], 0.0075, M.frame, { bevel: 0.0008 }));
  const blade = box(0.0018, 0.012, 0.0022, M.dark, { pos: [0, -0.016, -0.0035] });
  trig.add(blade);
  root.add(trig);
  parts.trigger = { obj: trig, maxAngle: 14 * DEG, blade };

  // ---------------------------------------------------------------- magazine (17 rd) — straight box, inserted at the grip angle
  const mag = new THREE.Group(); mag.name = 'magazine';
  mag.add(box(0.0225, 0.105, 0.0335, M.frame, { pos: [0, -0.0525, 0], r: 0.0025 }));
  mag.add(box(0.026, 0.007, 0.038, M.frame, { pos: [0, -0.1085, 0.001], r: 0.0015 })); // baseplate
  for (const sx of [-1, 1]) mag.add(box(0.004, 0.003, 0.028, M.steel, { pos: [sx * 0.0085, 0.0015, -0.002] })); // feed lips
  const topRound = cartridgeModel(CARTRIDGES['9mm_124'], M); topRound.name = 'topRound';
  topRound.position.set(0, 0.0015, 0.014); mag.add(topRound);
  // witness holes
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) mag.add(cyl(0.0012, 0.0012, 0.001, M.dark, { axis: 'x', pos: [sx * 0.0113, -0.025 - i * 0.022, 0.006] }));
  mag.position.set(0, -0.018, 0.012); mag.rotation.x = -18 * DEG;
  root.add(mag);
  parts.mag = { obj: mag, rest: mag.position.clone(), restRot: mag.rotation.clone(), length: 0.112 };

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const anchors = {
    muzzle: new THREE.Vector3(0, 0, -0.114),
    boreDir: new THREE.Vector3(0, 0, -1),
    sightAxis: { y: S.sightHeight, x: 0, z: -0.126 },
    eyeZ: 0.42,
    ejection: { pos: new THREE.Vector3(...S.ejection.pos), dir: new THREE.Vector3(...S.ejection.dir).normalize(), speed: S.ejection.speed },
    magSeat: new THREE.Vector3(0, -0.018, 0.012),
    gripR: { pos: new THREE.Vector3(0.032, -0.048, 0.080), rot: orientHand(new THREE.Vector3(0, -0.31, -0.95), new THREE.Vector3(-1, 0, 0)), forearm: new THREE.Vector3(0.12, -0.35, 1.0) },
    gripL: { pos: new THREE.Vector3(-0.058, -0.066, 0.054), rot: orientHand(new THREE.Vector3(0.1, -0.35, -0.93), new THREE.Vector3(1, 0.15, 0)), forearm: new THREE.Vector3(-0.18, -0.40, 1.0) },
    chargingHandle: new THREE.Vector3(0, 0.0, 0.035),
    magRelease: new THREE.Vector3(-0.014, -0.040, 0.0),
    boltCatch: new THREE.Vector3(-0.014, -0.015, 0.002),
    chamber: new THREE.Vector3(0, 0, -0.012),
    hipOffset: new THREE.Vector3(0.080, -0.110, -0.30),
  };

  const api = {
    spec: S, group: root, parts, anchors, materials: M,
    cart: CARTRIDGES[S.defaultAmmo],
    /** 0 = in battery, 1 = fully rearward. The barrel rides with the slide for the first 3 mm, then unlocks and tilts. */
    setActionPos(t) {
      const z = t * S.slideStroke;
      slide.position.z = parts.slide.rest.z + z;
      const bz = Math.min(z, parts.barrel.travel);
      barrelPivot.position.z = parts.barrel.rest.z + bz;
      const unlock = THREE.MathUtils.clamp((z - parts.barrel.travel) / 0.008, 0, 1);
      barrelPivot.rotation.x = -parts.barrel.tilt * unlock; // rear of the barrel drops
      // spring compresses between the slide (rear end) and the guide-rod head (front end stays put)
      const s = 1 - (z / parts.spring.freeLen);
      spring.scale.z = Math.max(0.3, s); spring.position.z = parts.spring.rest.z - parts.spring.freeLen * (1 - spring.scale.z);
    },
    setChargingHandle(t) { api.setActionPos(t); },
    setDustCover() {},
    setTrigger(t) { trig.rotation.x = -t * parts.trigger.maxAngle; blade.position.z = -0.0035 + Math.min(t * 3, 1) * 0.0025; },
    setSelector() {},
    setMagRelease(t) { magRel.position.x = parts.magRelease.rest.x + t * parts.magRelease.travel; },
    setBoltCatch(t) { slideStop.position.y = parts.slideStop.rest.y - t * 0.003; },
    setMagVisible(v) { mag.visible = v; },
    setMagOffset(pos, rot) { mag.position.copy(parts.mag.rest).add(pos); if (rot) mag.rotation.set(parts.mag.restRot.x + rot.x, parts.mag.restRot.y + rot.y, parts.mag.restRot.z + rot.z); },
    setMagTopRound(v) { topRound.visible = v; },
  };
  return api;
}

// ============================================================================
// RANGE — gunparts.js
// Geometry helpers for the procedural weapon models. Every helper returns a
// Mesh (or Group) in the weapon's local frame: -Z = muzzle direction, +Y up,
// +X = the shooter's right. Units are metres; call sites use real dimensions.
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/addons/geometries/RoundedBoxGeometry.js';
import * as BGU from '../vendor/addons/utils/BufferGeometryUtils.js';

export const DEG = Math.PI / 180;
export const IN = 0.0254;

export function place(mesh, pos, rot, scale) {
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}
export function shadow(mesh, cast = true, receive = true) {
  mesh.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return mesh;
}

/** Axis-aligned box, optionally with rounded/bevelled edges (radius r). */
export function box(w, h, d, material, o = {}) {
  const g = o.r ? new RoundedBoxGeometry(w, h, d, o.seg ?? 3, o.r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/**
 * Cylinder along an axis ('x'|'y'|'z'): radius r1 at the NEGATIVE end of the axis
 * (e.g. the muzzle end for z), r2 at the positive end. Centred at the origin unless o.pos is given.
 */
export function cyl(r1, r2, len, material, o = {}) {
  const axis = o.axis || 'y';
  // CylinderGeometry(radiusTop at +Y, radiusBottom at -Y)
  const g = new THREE.CylinderGeometry(r2, r1, len, o.seg ?? 32, 1, o.open ?? false);
  if (axis === 'z') g.rotateX(Math.PI / 2);        // +Y → +Z  (so r2 at +Z, r1 at -Z)
  else if (axis === 'x') g.rotateZ(-Math.PI / 2);  // +Y → +X
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/**
 * Lathe a profile [[radius, z], ...] around the Z axis (z increasing toward the muzzle if negative).
 * Points should go from one end to the other; radius 0 closes the end.
 */
export function lathe(profile, material, o = {}) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(r, z));
  if (pts[pts.length - 1].y < pts[0].y) pts.reverse(); // LatheGeometry wants increasing y for outward normals
  const g = new THREE.LatheGeometry(pts, o.seg ?? 40, o.phiStart ?? 0, o.phiLength ?? Math.PI * 2);
  g.rotateX(Math.PI / 2); // revolve axis Y → Z: profile z maps straight to world z
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/**
 * Extrude a 2-D outline drawn in the YZ plane (side profile, points [z, y]) along X (width, centred).
 * Handy for receivers, grips, stocks, magazines, triggers.
 */
export function sideProfile(points, width, material, o = {}) {
  // Draw the outline mirrored (shape.x = -z); rotateY(+90°) maps (x,y,z) → (z, y, -x) so world z = -shape.x = z.
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  if (o.holes) for (const h of o.holes) { const p = new THREE.Path(); h.forEach(([z, y], i) => (i === 0 ? p.moveTo(-z, y) : p.lineTo(-z, y))); p.closePath(); shape.holes.push(p); }
  const bevel = o.bevel ?? 0;
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: o.bevelSeg ?? 3, curveSegments: o.curveSeg ?? 12, steps: 1 });
  g.rotateY(Math.PI / 2);          // (x,y,z) → (z, y, -x): extrusion (+z in shape space) → world +x, shape.x → world -z
  g.translate(-depth / 2, 0, 0);   // centre on x
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/** Extrude a 2-D outline drawn in the XY plane (front profile, points [x, y]) along Z (length, centred). */
export function frontProfile(points, length, material, o = {}) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  if (o.holes) for (const h of o.holes) { const p = new THREE.Path(); h.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y))); p.closePath(); shape.holes.push(p); }
  const bevel = o.bevel ?? 0;
  const g = new THREE.ExtrudeGeometry(shape, { depth: length - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: o.bevelSeg ?? 2, curveSegments: o.curveSeg ?? 10, steps: 1 });
  g.translate(0, 0, -(length - 2 * bevel) / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/** Flat plate in the XZ or other plane with rectangular holes (for M-LOK panels). points [u,v] in plate space. */
export function plateWithSlots(w, h, thickness, slots, material, o = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2); shape.lineTo(w / 2, -h / 2); shape.lineTo(w / 2, h / 2); shape.lineTo(-w / 2, h / 2); shape.closePath();
  for (const s of slots) { // {x, y, w, h, r}
    const p = new THREE.Path();
    const r = s.r ?? Math.min(s.w, s.h) / 2;
    roundedRectPath(p, s.x, s.y, s.w, s.h, r);
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -thickness / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

export function roundedRectPath(p, cx, cy, w, h, r) {
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0); p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - r); p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  p.lineTo(x0 + r, y1); p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + r); p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  p.closePath();
  return p;
}

/**
 * MIL-STD-1913 Picatinny rail running along Z, centred, top surface at y=0 (the rail sits below y=0).
 * Profile: 21.2 mm across the top, 45° chamfers, recoil-groove slots 5.35 mm wide on a 10 mm pitch.
 */
export function picatinny(length, material, o = {}) {
  const W = 0.0212, chamfer = 0.0028, railH = 0.0045, baseW = 0.0195;
  const slotW = 0.00535, pitch = 0.01, slotDepth = 0.003;
  const parts = [];
  // rail cross-section (XY): top W wide at y=0, chamfer down to a neck, then the base
  const prof = [[-W / 2, 0], [W / 2, 0], [W / 2, -chamfer * 0.5], [W / 2 - chamfer, -chamfer * 1.6], [baseW / 2, -chamfer * 1.6], [baseW / 2, -railH], [-baseW / 2, -railH], [-baseW / 2, -chamfer * 1.6], [-W / 2 + chamfer, -chamfer * 1.6], [-W / 2, -chamfer * 0.5]];
  // build as alternating rail teeth (full profile) and slots (lower profile)
  const n = Math.floor(length / pitch);
  const teethLen = pitch - slotW;
  const shape = new THREE.Shape(); prof.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y))); shape.closePath();
  const slotProf = [[-baseW / 2, -slotDepth], [baseW / 2, -slotDepth], [baseW / 2, -railH], [-baseW / 2, -railH]];
  const slotShape = new THREE.Shape(); slotProf.forEach(([x, y], i) => (i === 0 ? slotShape.moveTo(x, y) : slotShape.lineTo(x, y))); slotShape.closePath();
  for (let i = 0; i < n; i++) {
    const z0 = -length / 2 + i * pitch;
    const tooth = new THREE.ExtrudeGeometry(shape, { depth: teethLen, bevelEnabled: false });
    tooth.translate(0, 0, z0 + slotW / 2); parts.push(tooth);
    const slot = new THREE.ExtrudeGeometry(slotShape, { depth: slotW, bevelEnabled: false });
    slot.translate(0, 0, z0 - slotW / 2); parts.push(slot);
  }
  const g = BGU.mergeGeometries(parts, false);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/** Hex/Torx screw head sitting on a surface, axis along local +Y (pointing out of the surface). */
export function screw(r, material, darkMaterial, o = {}) {
  const grp = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, r * 0.9, 16), material);
  head.position.y = r * 0.45;
  const star = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 0.3, 6), darkMaterial);
  star.position.y = r * 0.8;
  grp.add(head, star);
  head.castShadow = true;
  return place(grp, o.pos, o.rot);
}

/** Merge a list of meshes (same material) into one mesh; preserves each mesh's transform. */
export function mergeMeshes(meshes, material) {
  const geos = meshes.map((m) => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); return dropExtraAttributes(g); });
  const g = BGU.mergeGeometries(geos, false);
  const out = new THREE.Mesh(g, material || meshes[0].material);
  out.castShadow = out.receiveShadow = true;
  return out;
}
function dropExtraAttributes(g) {
  const keep = ['position', 'normal', 'uv'];
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) { const n = g.attributes.position.count; g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); }
  if (g.index) g = g.toNonIndexed ? g.toNonIndexed() : g;
  return g;
}

/** Simple capsule along Y. */
export function capsule(r, len, material, o = {}) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 12);
  const m = new THREE.Mesh(g, material);
  m.castShadow = m.receiveShadow = true;
  return place(m, o.pos, o.rot);
}

/** Torus ring around Z. */
export function ring(r, tube, material, o = {}) {
  const g = new THREE.TorusGeometry(r, tube, 10, 40);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return place(m, o.pos, o.rot);
}

/**
 * Cartridge case + bullet lathe profile from cartridge data (mm) → metres, along -Z (bullet tip at most negative z).
 * Returns a Group with named children: case, bullet, primer. Origin at the case head (base), pointing -Z.
 */
export function cartridgeModel(cart, materials, o = {}) {
  const k = 0.001;
  const c = cart.case;
  const grp = new THREE.Group();
  const withBullet = o.withBullet !== false;
  // case: base with an extractor groove, body, shoulder, neck
  const rim = c.rim * k / 2, base = c.base * k / 2, sh = c.shoulder * k / 2, neck = c.neck * k / 2;
  const groove = base * 0.86;
  const caseProf = [
    [0, 0], [rim * 0.93, 0], [rim, -0.0005], [rim, -0.0013], [groove, -0.0016], [groove, -0.0032], [base, -0.0038],
    [base, -c.shoulderAt * k], [sh, -c.shoulderAt * k], [neck, -(c.len - c.neckLen) * k], [neck, -c.len * k], [neck * 0.9, -c.len * k],
  ];
  const caseMesh = lathe(caseProf, materials.brass, { seg: 28 });
  caseMesh.name = 'case';
  grp.add(caseMesh);
  const primer = cyl(base * 0.42, base * 0.42, 0.0004, materials.primer, { axis: 'z', pos: [0, 0, -0.0001], seg: 16 });
  primer.name = 'primer';
  grp.add(primer);
  if (withBullet) {
    const r = cart.diameterMm * k / 2;
    const shape = cart.bulletShape;
    const prof = [];
    const mouth = -c.len * k;
    const bLen = (cart.oalMm - c.len) * k; // portion of the bullet outside the case
    if (shape === 'round-nose') {
      const n = 10; prof.push([r * 0.98, mouth]);
      for (let i = 1; i <= n; i++) { const t = i / n; prof.push([r * Math.cos(t * Math.PI / 2), mouth - bLen * (0.35 + 0.65 * Math.sin(t * Math.PI / 2))]); }
    } else if (shape === 'flat-nose') {
      prof.push([r * 0.98, mouth], [r, mouth - bLen * 0.45], [r * 0.85, mouth - bLen * 0.95], [r * 0.6, mouth - bLen], [0, mouth - bLen]);
    } else { // spitzer (tangent ogive) with optional boat tail already inside the case
      prof.push([r * 0.98, mouth], [r, mouth - bLen * 0.3]);
      const n = 12;
      for (let i = 1; i <= n; i++) { const t = i / n; const rr = r * Math.pow(1 - t * t, 0.62); prof.push([i === n ? 0 : Math.max(rr, r * 0.06), mouth - bLen * (0.3 + 0.7 * t)]); }
    }
    const bullet = lathe(prof, materials.copper, { seg: 28 });
    bullet.name = 'bullet';
    grp.add(bullet);
    if (cart.tip === 'green' || cart.tip === 'red') {
      const tip = lathe([[r * 0.32, mouth - bLen * 0.83], [r * 0.12, mouth - bLen * 0.98], [0, mouth - bLen]], cart.tip === 'green' ? materials.greenTip : materials.redTip, { seg: 16 });
      tip.position.z -= 0.0002; grp.add(tip);
    }
  }
  return grp;
}

/** Empty case (no bullet). */
export function emptyCaseModel(cart, materials) { return cartridgeModel(cart, materials, { withBullet: false }); }

/** Quick helper to make a group from children. */
export function group(children, o = {}) {
  const g = new THREE.Group();
  for (const c of children) if (c) g.add(c);
  return place(g, o.pos, o.rot);
}

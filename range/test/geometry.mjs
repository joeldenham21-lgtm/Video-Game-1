// Verifies axis conventions of the gunparts helpers (runs in node with the vendored three).
import * as THREE from '../../vendor/three.module.js';
import * as GP from '../src/gunparts.js';
const M = new THREE.MeshStandardMaterial();
function bbox(m) { m.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m); return { min: b.min.toArray().map(v => +v.toFixed(4)), max: b.max.toArray().map(v => +v.toFixed(4)) }; }
function outward(m) { // fraction of faces whose normal points away from the centroid
  const g = m.geometry; const p = g.attributes.position; const idx = g.index;
  const c = new THREE.Vector3(); for (let i = 0; i < p.count; i++) c.add(new THREE.Vector3().fromBufferAttribute(p, i)); c.divideScalar(p.count);
  let good = 0, n = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3(), cen = new THREE.Vector3();
  const tri = (i0, i1, i2) => { a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); d.fromBufferAttribute(p, i2); nrm.copy(b).sub(a).cross(d.clone().sub(a)); cen.copy(a).add(b).add(d).divideScalar(3).sub(c); if (nrm.dot(cen) > 0) good++; n++; };
  if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); else for (let i = 0; i < p.count; i += 3) tri(i, i + 1, i + 2);
  return +(good / n).toFixed(2);
}
// cyl along z: r1 (0.01) at -Z, r2 (0.02) at +Z
const cz = GP.cyl(0.01, 0.02, 0.1, M, { axis: 'z' });
const bz = bbox(cz); console.log('cyl z bbox', bz);
const posAttr = cz.geometry.attributes.position; let maxR_negZ = 0, maxR_posZ = 0;
for (let i = 0; i < posAttr.count; i++) { const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i); const r = Math.hypot(x, y); if (z < -0.04) maxR_negZ = Math.max(maxR_negZ, r); if (z > 0.04) maxR_posZ = Math.max(maxR_posZ, r); }
console.log('cyl z: radius at -Z', maxR_negZ.toFixed(3), 'at +Z', maxR_posZ.toFixed(3), '(expect 0.010 / 0.020)');
const cx = GP.cyl(0.01, 0.02, 0.1, M, { axis: 'x' }); console.log('cyl x bbox', bbox(cx));
// lathe: profile from z=0 (r=0.01) to z=-0.05 (r=0.005), then closed
const la = GP.lathe([[0.01, 0], [0.01, -0.03], [0.005, -0.05], [0, -0.05]], M);
console.log('lathe bbox', bbox(la), 'outward', outward(la), '(expect z from -0.05..0, outward ~1)');
// sideProfile: points [z,y]: a box from z=-0.1..0, y=0..0.05, width 0.03
const sp = GP.sideProfile([[0, 0], [-0.1, 0], [-0.1, 0.05], [0, 0.05]], 0.03, M);
console.log('sideProfile bbox', bbox(sp), 'outward', outward(sp), '(expect z -0.1..0, y 0..0.05, x ±0.015)');
const spb = GP.sideProfile([[0, 0], [-0.1, 0], [-0.1, 0.05], [0, 0.05]], 0.03, M, { bevel: 0.003 });
console.log('sideProfile bevel bbox', bbox(spb), 'outward', outward(spb));
const fp = GP.frontProfile([[-0.01, 0], [0.01, 0], [0.01, 0.02], [-0.01, 0.02]], 0.2, M);
console.log('frontProfile bbox', bbox(fp), 'outward', outward(fp), '(expect z ±0.1)');
const rail = GP.picatinny(0.1, M); console.log('rail bbox', bbox(rail), 'outward', outward(rail));
const box = GP.box(0.01, 0.02, 0.03, M, { r: 0.002 }); console.log('rbox bbox', bbox(box));
import { CARTRIDGES } from '../src/cartridges.js';
const mats = { brass: M, primer: M, copper: M, greenTip: M, redTip: M };
for (const id of ['556_m855', '9mm_124', '308_m118lr']) { const c = GP.cartridgeModel(CARTRIDGES[id], mats); const b = bbox(c); console.log(id, 'cartridge bbox', b, 'len mm', ((b.max[2] - b.min[2]) * 1000).toFixed(1), 'expect OAL', CARTRIDGES[id].oalMm); console.log('  case outward', outward(c.getObjectByName('case')), 'bullet outward', outward(c.getObjectByName('bullet'))); }
// radial normal check for lathe side faces
{
  const la = GP.lathe([[0.01, 0], [0.01, -0.03], [0.005, -0.05], [0, -0.05]], M);
  const p = la.geometry.attributes.position, n = la.geometry.attributes.normal; let ok = 0, tot = 0;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (z > -0.031 && z < -0.029) { tot++; if (n.getX(i) * x + n.getY(i) * y > 0) ok++; } }
  console.log('lathe side normals radially outward:', ok + '/' + tot);
  const sp = GP.sideProfile([[0, 0], [-0.1, 0], [-0.1, 0.05], [0, 0.05]], 0.03, M);
  console.log('sideProfile bbox (fixed)', bbox(sp));
  const c = GP.cartridgeModel(CARTRIDGES['556_m855'], mats); const b = bbox(c); console.log('5.56 len mm', ((b.max[2] - b.min[2]) * 1000).toFixed(1));
}

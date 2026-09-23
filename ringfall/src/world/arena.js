// Builds an arena from a layout: merged static meshes per material, emissive trims, colliders,
// jump pads, and the distant megastructure backdrop.
import * as THREE from 'three';
import { G, fxLayer } from '../state.js';
import { CollisionWorld } from './collision.js';
import { LAYOUTS } from './layouts.js';
import { makePlating } from './textures.js';
import { rng, TAU, clamp } from '../util.js';

const TEX_SCALE = 4; // meters per texture tile

// Accumulates triangles for one material bucket
class Bucket {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.col = null; }
  get count() { return this.pos.length / 3; }
  quad(a, b, c, d, n) {
    const base = this.count;
    // auto-wind so the face points along n
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      let u, v;
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      if (ay >= ax && ay >= az) { u = p[0]; v = p[2]; }
      else if (ax >= az) { u = p[2]; v = p[1]; }
      else { u = p[0]; v = p[1]; }
      this.uv.push(u / TEX_SCALE, v / TEX_SCALE);
    }
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c, n) {
    const base = this.count;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]);
      const ax = Math.abs(n[0]), az = Math.abs(n[2]);
      this.uv.push((ax > az ? p[2] : p[0]) / TEX_SCALE, p[1] / TEX_SCALE);
    }
    this.idx.push(base, base + 1, base + 2);
  }
  // Append an arbitrary geometry transformed by matrix; uvScale = [su, sv]
  geometry(geo, matrix, uvScale = [1, 1]) {
    const g = geo.index ? geo : geo;
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nrm.push(vn.x, vn.y, vn.z);
      this.uv.push(t ? t.getX(i) * uvScale[0] : 0, t ? t.getY(i) * uvScale[1] : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    if (!this.count) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

function boxInto(bTop, bSide, minX, minY, minZ, maxX, maxY, maxZ, bottom = null) {
  bTop.quad([minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ], [0, 1, 0]);
  bSide.quad([minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ], [0, 0, 1]);
  bSide.quad([maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ], [0, 0, -1]);
  bSide.quad([maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [1, 0, 0]);
  bSide.quad([minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ], [-1, 0, 0]);
  if (bottom) bottom.quad([minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ], [0, -1, 0]);
}

// Thin emissive strips along the top edges of a box
function boxTrim(bucket, minX, maxY, minZ, maxX, maxZ, t = 0.07) {
  const y0 = maxY - 0.1, y1 = maxY - 0.1 + t, o = 0.02;
  const e = (x0, z0, x1, z1) => boxInto(bucket, bucket, x0, y0, z0, x1, y1, z1);
  e(minX - o, maxZ - 0.0, maxX + o, maxZ + o);
  e(minX - o, minZ - o, maxX + o, minZ);
  e(maxX, minZ - o, maxX + o, maxZ + o);
  e(minX - o, minZ - o, minX, maxZ + o);
}

function annulusWall(bucketIn, bucketTop, x, z, rIn, rOut, y0, y1, segs = 96) {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const am = (a0 + a1) / 2;
    // inner face (normal toward center)
    bucketIn.quad([x + c1 * rIn, y0, z + s1 * rIn], [x + c0 * rIn, y0, z + s0 * rIn], [x + c0 * rIn, y1, z + s0 * rIn], [x + c1 * rIn, y1, z + s1 * rIn], [-Math.cos(am), 0, -Math.sin(am)]);
    // outer face
    bucketIn.quad([x + c0 * rOut, y0 - 1.5, z + s0 * rOut], [x + c1 * rOut, y0 - 1.5, z + s1 * rOut], [x + c1 * rOut, y1, z + s1 * rOut], [x + c0 * rOut, y1, z + s0 * rOut], [Math.cos(am), 0, Math.sin(am)]);
    // top
    bucketTop.quad([x + c0 * rIn, y1, z + s0 * rIn], [x + c0 * rOut, y1, z + s0 * rOut], [x + c1 * rOut, y1, z + s1 * rOut], [x + c1 * rIn, y1, z + s1 * rIn], [0, 1, 0]);
  }
}

// Flat emissive ring on a surface
function floorRing(bucket, x, y, z, r, w, segs = 96) {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    bucket.quad([x + c0 * r, y, z + s0 * r], [x + c0 * (r + w), y, z + s0 * (r + w)], [x + c1 * (r + w), y, z + s1 * (r + w)], [x + c1 * r, y, z + s1 * r], [0, 1, 0]);
  }
}

let SHARED = null;
function sharedMaterials() {
  if (SHARED) return SHARED;
  const aniso = G.renderer ? G.renderer.gl.capabilities.getMaxAnisotropy() : 4;
  const q = G.renderer?.q || {};
  const size = q.tex || 512;
  const floorT = makePlating('floor', { anisotropy: aniso, size });
  const wallT = makePlating('wall', { anisotropy: aniso, size });
  const darkT = makePlating('dark', { anisotropy: aniso, accent: '#c8923a', size });
  // high-end GPUs get physically based clear-coated decks (polished, lacquered metal)
  const std = (t, color, envI, coat = 0) => {
    const o = {
      map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap,
      roughness: 1, metalness: 1, color, envMapIntensity: envI, normalScale: new THREE.Vector2(1.1, 1.1),
    };
    if (q.physical && coat > 0) return new THREE.MeshPhysicalMaterial({ ...o, clearcoat: coat, clearcoatRoughness: 0.22 });
    return new THREE.MeshStandardMaterial(o);
  };
  SHARED = {
    floor: std(floorT, 0xc4c8d0, 1.0, 0.55),
    wall: std(wallT, 0xc8ccd2, 0.95, 0.25),
    dark: std(darkT, 0xb4b8be, 0.85, 0.35),
    underside: new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.5, metalness: 0.85, envMapIntensity: 0.8 }),
    trim: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    trimDim: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    padGlow: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    hull: new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, metalness: 0.7, envMapIntensity: 0.5 }),
    windows: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  };
  return SHARED;
}

export const ARENA_TRIM = {
  // emissive strengths are HDR; kept modest so the lighting, not the trim, carries the scene
  docks: { trim: 0xf0a060, trimI: 1.0, lamp: 0xfff0d8, lampI: 2.4, dim: 0xff9a30, dimI: 0.28 },
  garden: { trim: 0xe8766a, trimI: 0.95, lamp: 0xffd8c8, lampI: 2.4, dim: 0xff3050, dimI: 0.26 },
  heart: { trim: 0xa0d8ee, trimI: 1.0, lamp: 0xe8f6ff, lampI: 2.4, dim: 0x60c8ff, dimI: 0.28 },
};

export function buildArena(layoutName) {
  const layout = LAYOUTS[layoutName] || LAYOUTS.aperture;
  const M = sharedMaterials();
  const theme = ARENA_TRIM[layout.theme] || ARENA_TRIM.docks;
  M.trim.color.set(theme.trim).multiplyScalar(theme.trimI);
  M.trimDim.color.set(theme.dim).multiplyScalar(theme.dimI);
  M.lamp.color.set(theme.lamp).multiplyScalar(theme.lampI);
  M.padGlow.color.set(0x60e8ff).multiplyScalar(1.7);
  M.windows.color.set(theme.lamp).multiplyScalar(1.1);

  const world = new CollisionWorld();
  const group = new THREE.Group();
  group.name = 'arena';
  const B = { floor: new Bucket(), wall: new Bucket(), dark: new Bucket(), under: new Bucket(), trim: new Bucket(), dim: new Bucket(), lamp: new Bucket() };
  const pads = [];
  const lampPositions = [];
  const m4 = new THREE.Matrix4();

  for (const p of layout.prims) {
    if (p.k === 'disc') {
      const segs = Math.max(24, Math.round(p.r * 3.2));
      const top = p.mat === 'dark' ? B.dark : B.floor;
      const side = p.mat === 'dark' ? B.dark : B.wall;
      // top cap
      const cap = new THREE.CircleGeometry(p.r, segs);
      m4.makeRotationX(-Math.PI / 2).setPosition(p.x, p.y, p.z);
      // world-planar UVs for the cap
      const capUV = cap.attributes.uv;
      const cp = cap.attributes.position;
      for (let i = 0; i < cp.count; i++) capUV.setXY(i, (cp.getX(i) + p.x) / TEX_SCALE, (-cp.getY(i) + p.z) / TEX_SCALE);
      top.geometry(cap, m4);
      // side band
      const sideGeo = new THREE.CylinderGeometry(p.r, p.r, p.h, segs, 1, true);
      m4.makeTranslation(p.x, p.y - p.h / 2, p.z);
      side.geometry(sideGeo, m4, [TAU * p.r / TEX_SCALE, p.h / TEX_SCALE]);
      // tapered underside keel (only for big, thick platforms)
      if (p.h >= 2.5) {
        const keel = new THREE.CylinderGeometry(p.r, p.r * 0.35, p.r * 0.45, segs, 1, true);
        m4.makeTranslation(p.x, p.y - p.h - p.r * 0.225, p.z);
        B.under.geometry(keel, m4);
        const tip = new THREE.CylinderGeometry(p.r * 0.35, 0.01, p.r * 0.25, segs, 1, true);
        m4.makeTranslation(p.x, p.y - p.h - p.r * 0.45 - p.r * 0.125, p.z);
        B.under.geometry(tip, m4);
        // underside light ring
        const band = new THREE.CylinderGeometry(p.r * 0.36, p.r * 0.36, 0.25, segs, 1, true);
        m4.makeTranslation(p.x, p.y - p.h - p.r * 0.44, p.z);
        B.trim.geometry(band, m4);
      }
      if (p.trim) {
        const band = new THREE.CylinderGeometry(p.r + 0.03, p.r + 0.03, 0.09, segs, 1, true);
        m4.makeTranslation(p.x, p.y - 0.12, p.z);
        B.trim.geometry(band, m4);
        const band2 = new THREE.CylinderGeometry(p.r + 0.03, p.r + 0.03, 0.05, segs, 1, true);
        m4.makeTranslation(p.x, p.y - p.h + 0.35, p.z);
        B.trim.geometry(band2, m4);
      }
      if (p.rings) for (const rr of p.rings) floorRing(B.dim, p.x, p.y + 0.012, p.z, rr, 0.12, Math.round(rr * 4));
      world.addCyl(p.x, p.z, p.r, p.y - p.h, p.y);
    } else if (p.k === 'rim') {
      annulusWall(B.wall, B.dark, p.x, p.z, p.r - 0.35, p.r + 0.02, p.y, p.y + p.h, Math.round(p.r * 3.5));
      floorRing(B.trim, p.x, p.y + p.h + 0.01, p.z, p.r - 0.33, 0.06, Math.round(p.r * 3.5));
      world.addRing(p.x, p.z, p.r - 0.35, p.r + 0.02, p.y - 3, p.y + p.h);
    } else if (p.k === 'box') {
      const minX = p.x - p.w / 2, maxX = p.x + p.w / 2, minZ = p.z - p.d / 2, maxZ = p.z + p.d / 2;
      const minY = p.y, maxY = p.y + p.h;
      const mat = p.mat || 'wall';
      const top = p.floor || (mat === 'wall' && p.h < 1.5) ? B.floor : B[mat];
      boxInto(top, B[mat], minX, minY, minZ, maxX, maxY, maxZ, B.under);
      if (p.trim) boxTrim(B.trim, minX, maxY, minZ, maxX, maxZ);
      // small indicator lamps on cover blocks
      if (mat === 'dark' && p.h <= 2.4) {
        const lx = p.w > p.d ? p.x : (p.x + (p.w / 2 + 0.01));
        const lz = p.w > p.d ? (p.z + (p.d / 2 + 0.01)) : p.z;
        lampPositions.push([lx, maxY - 0.35, lz]);
      }
      world.addBox(minX, minY, minZ, maxX, maxY, maxZ);
    } else if (p.k === 'ramp') {
      const minX = p.x - p.w / 2, maxX = p.x + p.w / 2, minZ = p.z - p.d / 2, maxZ = p.z + p.d / 2;
      const base = Math.min(p.y0, p.y1) - 0.6;
      world.addRamp(minX, minZ, maxX, maxZ, base, p.y0, p.y1, p.axis, p.dir);
      // wedge geometry: heights at the 4 corners
      const hAt = (x, z) => {
        const a = p.axis === 'x' ? x : z;
        const lo = p.axis === 'x' ? (p.dir > 0 ? minX : maxX) : (p.dir > 0 ? minZ : maxZ);
        const len = p.axis === 'x' ? p.w : p.d;
        return p.y0 + (p.y1 - p.y0) * Math.abs(a - lo) / len;
      };
      const c00 = [minX, hAt(minX, minZ), minZ], c10 = [maxX, hAt(maxX, minZ), minZ], c11 = [maxX, hAt(maxX, maxZ), maxZ], c01 = [minX, hAt(minX, maxZ), maxZ];
      const e1 = new THREE.Vector3().subVectors(new THREE.Vector3(...c01), new THREE.Vector3(...c00));
      const e2 = new THREE.Vector3().subVectors(new THREE.Vector3(...c10), new THREE.Vector3(...c00));
      const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
      if (n.y < 0) n.negate();
      B.floor.quad(c01, c11, c10, c00, [n.x, n.y, n.z]);
      // sides
      const sq = (a, b, nn) => B.dark.quad([a[0], base, a[2]], [b[0], base, b[2]], b, a, nn);
      sq(c01, c11, [0, 0, 1]); sq(c10, c00, [0, 0, -1]); sq(c11, c10, [1, 0, 0]); sq(c00, c01, [-1, 0, 0]);
      // guide lights along the slope edges
      const side = p.axis === 'x' ? [[c00, c10], [c01, c11]] : [[c00, c01], [c10, c11]];
      for (const [a, b] of side) {
        const steps = 5;
        for (let i = 0; i < steps; i++) {
          const t = (i + 0.5) / steps;
          lampPositions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 0.03, a[2] + (b[2] - a[2]) * t]);
        }
      }
    } else if (p.k === 'pillar') {
      const col = new THREE.CylinderGeometry(p.r, p.r, p.h, 20, 1, true);
      m4.makeTranslation(p.x, p.y + p.h / 2, p.z);
      B.wall.geometry(col, m4, [TAU * p.r / TEX_SCALE, p.h / TEX_SCALE]);
      const collar = new THREE.CylinderGeometry(p.r * 1.3, p.r * 1.45, 0.8, 20);
      m4.makeTranslation(p.x, p.y + 0.4, p.z);
      B.dark.geometry(collar, m4, [2, 0.3]);
      const cap = new THREE.CylinderGeometry(p.r * 1.35, p.r * 1.2, 0.6, 20);
      m4.makeTranslation(p.x, p.y + p.h + 0.3, p.z);
      B.dark.geometry(cap, m4, [2, 0.3]);
      // vertical light strips
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        const sx = p.x + Math.cos(a) * (p.r + 0.01), sz = p.z + Math.sin(a) * (p.r + 0.01);
        const strip = new THREE.BoxGeometry(0.09, p.h * 0.7, 0.09);
        m4.makeRotationY(-a).setPosition(sx, p.y + 0.9 + p.h * 0.35, sz);
        B.trim.geometry(strip, m4);
      }
      const halo = new THREE.CylinderGeometry(p.r * 1.36, p.r * 1.36, 0.08, 20, 1, true);
      m4.makeTranslation(p.x, p.y + p.h + 0.12, p.z);
      B.lamp.geometry(halo, m4);
      world.addCyl(p.x, p.z, p.r * 1.3, p.y, p.y + p.h + 0.6);
    } else if (p.k === 'pad') {
      const base = new THREE.CylinderGeometry(1.25, 1.4, 0.16, 28);
      m4.makeTranslation(p.x, p.y + 0.08, p.z);
      B.dark.geometry(base, m4, [1, 0.1]);
      floorRing(B.trim, p.x, p.y + 0.165, p.z, 1.05, 0.12, 32);
      floorRing(B.trim, p.x, p.y + 0.165, p.z, 0.55, 0.07, 24);
      pads.push({ x: p.x, y: p.y + 0.16, z: p.z, r: 1.25, to: new THREE.Vector3(...p.to), power: p.power || 1, cool: 0 });
    }
  }

  // lamps (small emissive blocks)
  for (const [x, y, z] of lampPositions) boxInto(B.lamp, B.lamp, x - 0.07, y - 0.05, z - 0.07, x + 0.07, y + 0.05, z + 0.07);

  const mk = (bucket, mat, shadow = true) => {
    const geo = bucket.build();
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadow; mesh.receiveShadow = shadow;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return mesh;
  };
  mk(B.floor, M.floor); mk(B.wall, M.wall); mk(B.dark, M.dark); mk(B.under, M.underside, false);
  mk(B.trim, M.trim, false); mk(B.dim, M.trimDim, false); mk(B.lamp, M.lamp, false);

  // jump pad beams (animated)
  const padMeshes = [];
  const padGeo = new THREE.CylinderGeometry(0.95, 1.05, 3.2, 24, 1, true);
  padGeo.translate(0, 1.6, 0);
  const padMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x58e0ff).multiplyScalar(1.1) }, uBoost: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uBoost; varying vec2 vUv;
      void main(){
        float fade = pow(1.0 - vUv.y, 2.2);
        float bands = 0.5 + 0.5 * sin((vUv.y * 9.0 - uTime * 3.5) * 6.2831);
        float a = fade * (0.18 + 0.4 * bands * (1.0 - vUv.y)) * (1.0 + uBoost * 2.0);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const pad of pads) {
    const m = new THREE.Mesh(padGeo, padMat.clone());
    m.position.set(pad.x, pad.y, pad.z);
    group.add(fxLayer(m));
    padMeshes.push(m);
    pad.mesh = m;
  }

  const backdrop = buildBackdrop(layout, M);
  group.add(backdrop.group);

  world.killY = -30;

  const arena = {
    name: layoutName, layout, group, world, pads, spawns: layout.spawns, bounds: layout.bounds,
    start: layout.start, theme: layout.theme,
    update(dt, time) {
      for (const m of padMeshes) m.material.uniforms.uTime.value = time;
      for (const pad of pads) {
        if (pad.cool > 0) pad.cool -= dt;
        pad.mesh.material.uniforms.uBoost.value = Math.max(0, pad.cool) * 1.5;
      }
      backdrop.update(dt, time);
    },
    dispose() {
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !Object.values(M).includes(o.material)) o.material.dispose?.();
      });
    },
  };
  return arena;
}

// Distant megastructure: spires with window lights, orbiting ring segments, floating debris, sister platforms.
function buildBackdrop(layout, M) {
  const group = new THREE.Group();
  const r = rng(layout.name.length * 97 + 13);
  const hull = new Bucket(), lights = new Bucket(), trim = new Bucket();
  const m4 = new THREE.Matrix4();

  // spires rising from far below
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU, d = 140 + r() * 260;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const w = 8 + r() * 22, h = 80 + r() * 260, base = -220 + r() * 40;
    boxInto(hull, hull, x - w / 2, base, z - w / 2, x + w / 2, base + h, z + w / 2);
    // crown
    boxInto(hull, hull, x - w * 0.3, base + h, z - w * 0.3, x + w * 0.3, base + h + w * 0.8, z + w * 0.3);
    // window rows
    const rows = Math.floor(h / 9);
    for (let k = 0; k < rows; k++) {
      if (r() < 0.45) continue;
      const y = base + 6 + k * 9;
      const face = Math.floor(r() * 4);
      const len = w * (0.3 + r() * 0.6);
      const o = w / 2 + 0.1;
      if (face === 0) boxInto(lights, lights, x - len / 2, y, z + o - 0.2, x + len / 2, y + 0.9, z + o);
      else if (face === 1) boxInto(lights, lights, x - len / 2, y, z - o, x + len / 2, y + 0.9, z - o + 0.2);
      else if (face === 2) boxInto(lights, lights, x + o - 0.2, y, z - len / 2, x + o, y + 0.9, z + len / 2);
      else boxInto(lights, lights, x - o, y, z - len / 2, x - o + 0.2, y + 0.9, z + len / 2);
    }
    // aviation beacon
    boxInto(trim, trim, x - 0.8, base + h + w * 0.8, z - 0.8, x + 0.8, base + h + w * 0.8 + 1.6, z + 0.8);
  }
  // sister platforms at distance (other decks of the station)
  for (let i = 0; i < 7; i++) {
    const a = r() * TAU, d = 90 + r() * 120;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, y = -30 + r() * 50;
    const rad = 10 + r() * 18;
    const disc = new THREE.CylinderGeometry(rad, rad * 0.4, rad * 0.7, 28);
    m4.makeTranslation(x, y - rad * 0.35, z);
    hull.geometry(disc, m4);
    const band = new THREE.CylinderGeometry(rad + 0.2, rad + 0.2, 0.5, 28, 1, true);
    m4.makeTranslation(x, y - 0.4, z);
    trim.geometry(band, m4);
  }

  const mk = (bucket, mat) => {
    const geo = bucket.build();
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  mk(hull, M.hull); mk(lights, M.windows); mk(trim, M.trim);

  // giant orbital ring arcs
  const arcs = [];
  for (let i = 0; i < 2; i++) {
    const R = 360 + i * 160;
    const torus = new THREE.TorusGeometry(R, 7 + i * 4, 6, 160, Math.PI * (1.1 + i * 0.3));
    const mesh = new THREE.Mesh(torus, M.hull);
    const lightsGeo = new THREE.TorusGeometry(R, 7.6 + i * 4, 3, 160, Math.PI * (1.1 + i * 0.3));
    const lightMesh = new THREE.Mesh(lightsGeo, M.trim);
    lightMesh.scale.set(1, 1, 0.08);
    const pivot = new THREE.Group();
    pivot.add(mesh, lightMesh);
    pivot.rotation.set(Math.PI / 2 + (i ? -0.35 : 0.28), i ? 1.2 : -0.4, i ? 0.2 : -0.1);
    pivot.position.y = -60 - i * 40;
    group.add(pivot);
    arcs.push({ pivot, speed: (i ? -1 : 1) * 0.004 });
  }

  // floating debris (instanced)
  const debrisGeo = new THREE.IcosahedronGeometry(1, 0);
  const debris = new THREE.InstancedMesh(debrisGeo, M.hull, 40);
  const items = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 40; i++) {
    const a = r() * TAU, d = 45 + r() * 70;
    items.push({
      x: Math.cos(a) * d, y: -25 + r() * 45, z: Math.sin(a) * d,
      s: 0.6 + r() * 3.5, rx: r() * TAU, ry: r() * TAU, sp: (r() - 0.5) * 0.4, bob: r() * TAU,
    });
  }
  group.add(debris);

  function update(dt, time) {
    for (const a of arcs) a.pivot.rotation.z += a.speed * dt;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.rx += it.sp * dt; it.ry += it.sp * 0.7 * dt;
      dummy.position.set(it.x, it.y + Math.sin(time * 0.3 + it.bob) * 0.8, it.z);
      dummy.rotation.set(it.rx, it.ry, 0);
      dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      debris.setMatrixAt(i, dummy.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  return { group, update };
}

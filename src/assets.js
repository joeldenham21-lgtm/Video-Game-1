// ============================================================================
// ELDERFALL — assets.js
// Central manager for real CC0 art assets (KayKit packs + Khronos Fox).
// - GLTF loading with progress, caching, background streaming
// - Skinned character cloning (SkeletonUtils) with shared animation clips
// - Prop cloning with shared geometry/materials
// - Material conversion: everything → MeshLambertMaterial (mobile speed)
// - Tint variants cached per (asset, colorKey)
// All CC0 (Creative Commons Zero): KayKit by Kay Lousberg, Fox from
// Khronos glTF sample assets.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import * as SkeletonUtils from '../vendor/SkeletonUtils.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';

const CHAR_URLS = {
  knight: 'assets/chars/Knight.glb',
  barbarian: 'assets/chars/Barbarian.glb',
  mage: 'assets/chars/Mage.glb',
  rogue: 'assets/chars/Rogue.glb',
  rogue_hooded: 'assets/chars/Rogue_Hooded.glb',
  skeleton_warrior: 'assets/chars/Skeleton_Warrior.glb',
  skeleton_mage: 'assets/chars/Skeleton_Mage.glb',
  skeleton_rogue: 'assets/chars/Skeleton_Rogue.glb',
  skeleton_minion: 'assets/chars/Skeleton_Minion.glb',
  fox: 'assets/chars/Fox.glb',
};

// Load priority: things the player sees in the first minute come first.
const PRELOAD = [
  'char:knight', 'char:rogue', 'char:mage', 'char:barbarian', 'char:rogue_hooded',
  'char:fox',
  'prop:hexagon/building_blacksmith_red.gltf',
  'prop:hexagon/building_home_A_red.gltf',
  'prop:hexagon/building_home_B_red.gltf',
  'prop:hexagon/building_tavern_red.gltf',
  'prop:hexagon/building_church_red.gltf',
  'prop:hexagon/building_well_red.gltf',
  'prop:hexagon/building_windmill_red.gltf',
  'prop:hexagon/building_market_red.gltf',
  'char:skeleton_warrior', 'char:skeleton_mage', 'char:skeleton_rogue', 'char:skeleton_minion',
  'prop:dungeon/chest.glb',
];

const DEFAULT_GEAR = {
  knight: { r: '1H_Sword', l: 'Round_Shield' },
  barbarian: { r: '2H_Axe', l: null },
  mage: { r: '2H_Staff', l: null },
  rogue: { r: 'Knife', l: 'Knife_Offhand' },
  rogue_hooded: { r: 'Knife', l: null },
};

function applyGear(scene, name, opts) {
  const want = { ...(DEFAULT_GEAR[name] || {}), ...(opts && opts.gear) };
  for (const [slot, node] of [['l', 'handslot.l'], ['r', 'handslot.r']]) {
    const holder = scene.getObjectByName(node);
    if (!holder || !holder.children.length) continue;
    const desired = want[slot] !== undefined ? want[slot] : holder.children[0].name;
    for (const child of holder.children) {
      child.visible = child.name === desired;
    }
  }
}

export function createAssets(g) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map();      // url -> Promise<gltf>
  const tintCache = new Map();  // matUuid|colorKey -> material
  let loadedCount = 0;
  let targetCount = PRELOAD.length;

  function convertMaterials(root) {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      // Some sources (Khronos Fox) ship without normals — Lambert renders
      // them black. Compute once at load; all clones share the geometry.
      if (o.geometry && !o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
      // Small clutter (mugs, bones, bottles) doubles draw calls in the shadow
      // pass for zero visible benefit — gate by authored size.
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.isSkinnedMesh || o.geometry.boundingSphere.radius > 0.22;
      o.frustumCulled = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        if (!m || m.isMeshLambertMaterial) return m;
        const lam = new THREE.MeshLambertMaterial({
          map: m.map || null,
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          transparent: !!m.transparent,
          opacity: m.opacity !== undefined ? m.opacity : 1,
          side: m.side !== undefined ? m.side : THREE.FrontSide,
        });
        if (lam.map) {
          lam.map.colorSpace = THREE.SRGBColorSpace;
          lam.map.flipY = lam.map.flipY; // keep loader setting
        }
        lam.name = m.name;
        return lam;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    return root;
  }

  function loadUrl(url) {
    if (!cache.has(url)) {
      const p = new Promise((resolve, reject) => {
        loader.load(url,
          (gltf) => { convertMaterials(gltf.scene); loadedCount++; p._v = gltf; resolve(gltf); },
          undefined,
          (err) => { loadedCount++; console.warn('asset failed:', url, err); reject(err); }
        );
      });
      p.catch(() => {});
      cache.set(url, p);
    }
    return cache.get(url);
  }

  const api = {
    get progress() { return Math.min(1, loadedCount / Math.max(1, targetCount)); },

    // --- characters (skinned, animated) ---
    // char('knight', {gear:{r:'2H_Sword', l:null}}) → { scene, animations } —
    // scene is a fresh SkeletonUtils clone; animations are the SHARED clip
    // array (do not mutate). KayKit rigs carry EVERY gear variant under the
    // handslot bones — we keep one per hand (default loadout below, override
    // via opts.gear; null = empty hand) and hide the rest, which also saves
    // ~14 draw calls per humanoid.
    async char(name, opts) {
      const gltf = await loadUrl(CHAR_URLS[name]);
      const scene = SkeletonUtils.clone(gltf.scene);
      applyGear(scene, name, opts);
      return { scene, animations: gltf.animations };
    },
    charSync(name, opts) {
      const p = cache.get(CHAR_URLS[name]);
      let out = null;
      if (p && p._v) {
        const scene = SkeletonUtils.clone(p._v.scene);
        applyGear(scene, name, opts);
        out = { scene, animations: p._v.animations };
      }
      return out;
    },
    async clips(name) {
      const gltf = await loadUrl(CHAR_URLS[name]);
      return gltf.animations;
    },

    // --- props (static) ---
    // prop('dungeon/chest_common.gltf') → fresh Object3D clone (shared geo/mats)
    async prop(relPath) {
      const gltf = await loadUrl('assets/' + relPath);
      return gltf.scene.clone(true);
    },
    propSync(relPath) {
      const p = cache.get('assets/' + relPath);
      return p && p._v ? p._v.scene.clone(true) : null;
    },

    // Tint a clone: multiplies material colors. Cached per colorKey so
    // variants share materials. USE for enemy variants (troll green etc).
    tint(root, hexColor, opts = {}) {
      const key = hexColor + '|' + (opts.emissive || 0) + '|' + (opts.opacity ?? 1);
      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const out = mats.map((m) => {
          const ck = m.uuid + '|' + key;
          if (!tintCache.has(ck)) {
            const t = m.clone();
            t.color.multiply(new THREE.Color(hexColor));
            if (opts.emissive) { t.emissive = new THREE.Color(opts.emissive); t.emissiveIntensity = opts.emissiveIntensity ?? 0.6; }
            if (opts.opacity !== undefined && opts.opacity < 1) { t.transparent = true; t.opacity = opts.opacity; t.depthWrite = false; }
            tintCache.set(ck, t);
          }
          return tintCache.get(ck);
        });
        o.material = Array.isArray(o.material) ? out : out[0];
      });
      return root;
    },

    // Kick off background preloading (called by main after boot).
    preload() {
      for (const id of PRELOAD) {
        const kind = id.slice(0, id.indexOf(':'));
        const name = id.slice(id.indexOf(':') + 1);
        (kind === 'char' ? loadUrl(CHAR_URLS[name]) : loadUrl('assets/' + name)).catch(() => {});
      }
    },

    // Track extra loads in the progress denominator
    expect(n) { targetCount += n; },
  };

  return api;
}

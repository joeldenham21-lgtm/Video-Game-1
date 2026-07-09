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

export function createAssets(g) {
  const loader = new GLTFLoader();
  const cache = new Map();      // url -> Promise<gltf>
  const tintCache = new Map();  // matUuid|colorKey -> material
  let loadedCount = 0;
  let targetCount = PRELOAD.length;

  function convertMaterials(root) {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
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
    // char('knight') → { scene, animations } — scene is a fresh SkeletonUtils
    // clone; animations are the SHARED clip array (do not mutate).
    async char(name) {
      const gltf = await loadUrl(CHAR_URLS[name]);
      const scene = SkeletonUtils.clone(gltf.scene);
      return { scene, animations: gltf.animations };
    },
    charSync(name) {
      const p = cache.get(CHAR_URLS[name]);
      let out = null;
      if (p && p._v) out = { scene: SkeletonUtils.clone(p._v.scene), animations: p._v.animations };
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

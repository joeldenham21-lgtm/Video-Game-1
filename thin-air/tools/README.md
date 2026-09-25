# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Terrain texture layers | `python3 thin-air/tools/textures/gen_terrain.py [--only snow,rock] [--preview] [--no-write]` | `assets/textures/terrain/<layer>_{albedo,normal,roughness,height}.png`, packed `terrain_albedo_height.png` + `terrain_normal_rough.png` (Texture2DArray, 9 layers), `terrain_macro_noise.png`, `layers.json` (~2 min) |
| PBR material library | `python3 thin-air/tools/textures/gen_materials.py [--only bark_pine,rope] [--preview] [--no-write]` | `assets/textures/<set>/<set>_{albedo,normal,orm[,height]}.png`, `assets/materials/<set>.tres` (ORMMaterial3D), `assets/materials/materials.json` (~3 min) |
| Texture seam QA | `python3 thin-air/tools/textures/check_seams.py [set ...]` | prints wrap-around continuity per map (same statistic as `tests/test_textures.gd`) |
| Texture contact sheet | `python3 thin-air/tools/textures/contact_sheet.py out.jpg mat_rope terrain_rock ...` | tiles the CPU previews written by `--preview` (in `tools/textures/_cache/preview/`, git-ignored) |
| Material preview stage | `DISPLAY=:99 godot --path thin-air --write-movie /tmp/m.png --fixed-fps 30 --quit-after 10 res://scenes/dev/material_preview.tscn -- --mode=grid` | lit renders: `--mode=grid`, `--mode=sets --sets=a,b`, `--mode=terrain --layer=rock`, `--mode=strips --layers=a,b`, `--mode=wall --layer=cliff --ground=scree`; `--macro=1`, `--sun=elev,az`, `--perf` |
| Foliage card atlases | `blender -b -P thin-air/tools/blender/vegetation/cards.py -- [--only=spruce,fir] [--res=1024] [--spp=24]` | `assets/textures/foliage/<set>_{albedo,normal}.png` (needle/leaf/blade branchlets modelled and rendered orthographically), `cards.json` regions (~10 min, Cycles CPU) |
| Conifers + snags | `blender -b -P thin-air/tools/blender/vegetation/trees.py -- [--only=spruce_a,fir_b]` | `assets/models/vegetation/<variant>.glb` (LOD0/LOD1/LOD2 nodes, bark + card surfaces, wind/AO vertex colours) + manifest `vegetation.json` "trees" (~3 min) |
| Shrubs, ground cover, deadwood | `blender -b -P thin-air/tools/blender/vegetation/plants.py -- [--only=willow_a,log_a]` | willow/alder/juniper/huckleberry, grass/sedge tufts, dead fern, logs, stumps + manifest "plants", "groundcover", "deadwood" |
| Rocks | `blender -b -P thin-air/tools/blender/vegetation/rocks.py -- [--only=boulder_a] [--bake=512]` | `assets/models/rocks/<name>.glb` + `<name>_normal.png` (sculpt baked to LOD0) + manifest "rocks" (~6 min) |
| Tree impostors | `blender -b -P thin-air/tools/blender/vegetation/impostors.py -- [--frames=8] [--tile=128] [--spp=16]` | `assets/textures/foliage/impostor_{albedo,normal}.png` (8x8 hemi-octahedral views per tree, one 1024 px layer each, Texture2DArray) + manifest "impostors" (~11 min); then `python3.12 thin-air/tools/vegetation/atlas_webp.py` re-encodes both as lossless `.webp` (what ships) and repoints the manifest. Re-run after trees.py or a foliage-shader look change (`CROWN_BEND`/`FACING` mirror foliage.gdshader) |
| Vegetation QA (Blender) | `blender -b -P thin-air/tools/blender/vegetation/preview.py -- --only=spruce_a --lod=0 --out=/tmp/p.png`; `stats.py -- --only=spruce_a` | Cycles lineup render; triangle breakdown per LOD |
| Axe notch decal | `python3.12 thin-air/tools/vegetation/notch_texture.py` | `assets/textures/foliage/chop_notch_{albedo,normal}.png` |
| Card atlas contact sheet | `python3.12 thin-air/tools/vegetation/card_preview.py spruce,fir out.jpg [--size=512]` | albedo / lit / normal preview of card atlases |
| Vegetation QA stage | `thin-air/tools/vegetation/render.sh OUT.png FRAMES forward_plus\|mobile -- --mode=lineup\|forest\|fell ...` | renders `scenes/dev/vegetation_test.tscn` (see the header of `src/dev/vegetation_test.gd`: lineup of every asset, the real scatter on a synthetic valley, felling demo, `--perf`, `--no_near/--no_far/--no_grass` breakdown) |

Workstreams append their generators to this table.

## Texture & material library (textures stream)

Python: the generators need numpy, scipy and Pillow (`python3` must be the interpreter that has all three; in the
dev container that is `python3.12`). Output is bit-for-bit deterministic (seeds derive from the set name).
`texlib.py` = periodic toolkit (FFT noise, periodic Worley, domain warp, wrap-around rasterisers, Sobel normals
from heights in metres, horizon AO); `common.py` = granite grain, lichen colonies, stone shapes;
`terrain_ground.py` / `materials_*.py` = one function per layer/set; `godot_import.py` writes the `.import` files
(VRAM compressed + mipmaps, BC5/RGTC normal maps, roughness-from-normal-variance filtering, 2D arrays).

**Using a material** — `load("res://assets/materials/<set>.tres")` (share, don't duplicate). Mesh UVs are in
**metres** (1 UV unit = 1 m); the `.tres` `uv1_scale` converts to the real tile size, so a 4 m log and a 40 cm
stick show correctly sized grain. Grain/fibre/streak direction is image-vertical (V): bark, wood, planks,
corrugation. Exceptions: `rope` (U = metres along the rope, V = 0..1 around), `wood_endgrain` (the whole disc
is UV 0..1, not tiling), and `rock_boulder`, `snow_packed`, `concrete` (world triplanar, mesh UVs ignored).
`materials.json` lists every set with tile size, uv scale, average linear albedo and roughness.

**Terrain layers** — fixed index order `0 snow, 1 rock, 2 cliff, 3 scree, 4 gravel, 5 grass, 6 forest, 7 dirt,
8 ice` (`layers.json` gives `tiling_m`, average albedo/roughness, `height_range_m` and the footstep `surface`).
Sample the two arrays as `sampler2DArray` (`source_color` on `terrain_albedo_height` only): `.rgb` albedo,
`.a` height 0..1 (for height-based blending), `terrain_normal_rough.rgb` OpenGL (Y+) tangent normal, `.a`
roughness. UV = world metres / `tiling_m` (cliff: world XZ/Y triplanar, image-up = world-up). Albedo contains
baked cavity AO, there is no AO map. Recommended anti-tiling (see `--macro=1` in the preview shader):
multiply albedo by `terrain_macro_noise.png` sampled at world XZ / 256 m (R 1, G 3, B 9 cycles per repeat),
and beyond ~10 m blend in a second fetch of the same layer at 1/3.7 scale with a rotated UV.
The per-layer PNGs (`terrain/<layer>_{albedo,normal,roughness,height}.png`) are the sources of the arrays and stay
importable for tools/other uses; if nothing loads them at runtime, exclude them from exports (≈31 MB of ETC2 on
Android) with the preset exclude filter
`assets/textures/terrain/*_albedo.png, assets/textures/terrain/*_normal.png, assets/textures/terrain/*_roughness.png, assets/textures/terrain/*_height.png`.
VRAM: the two arrays are 12.6 MB each (BPTC on desktop, ASTC 4x4 on Android, mipmapped).

## Vegetation (vegetation stream)

Blender scripts run headless with Blender 4.0 (`blender -b -P <script> -- args`), share `vegcommon.py` (seeded numpy
geometry, glTF export, the vertex layout) and are deterministic. Order after a look change: `cards.py` ->
`trees.py` / `plants.py` -> `impostors.py`. `rocks.py` is independent. Cycles EXR passes are cached in
`tools/vegetation/_cache/` (git-ignored).

**Vertex layout** (read by `assets/shaders/{foliage,bark,grass}.gdshader`): `COLOR.r` wind weight (trunk 0 ->
branch tips 1), `COLOR.g` baked AO, `COLOR.b` branch phase, `COLOR.a` card width / 4 m (axial card facing);
`UV2.x` normalised height (trunk bend). Materials are assigned at load by `src/vegetation/veg_library.gd` from the
glTF material names (`bark_<set>`, `cards_<set>`, `rock*`), tinted per species from the manifest (`leaf_tint`,
`bark_tint`, `transl`, written from `trees.py` LOOK).

**Runtime** (`scenes/world/vegetation.tscn`, `src/vegetation/`): `VegScatter` places everything deterministically
per 64 m cell from TerrainData (ids = cell << 12 | index); cells within 360 m of the start are generated
synchronously, the rest stream in on low-priority worker threads. Near field: one MultiMesh per (asset, LOD band)
with dithered cross-fades (`lod_begin/lod_end` instance uniforms), shadow-only proxies (LOD1 -> LOD2 -> impostor
quads); far field: one impostor MultiMesh per 256 m cell. `veg_grass.gd` = ground-cover ring (24 m cells,
rank-sorted instances for density LOD), `veg_colliders.gd` = pooled `VegProxy` bodies near the player (trunks
layer 10, boulders layer 1, shrubs/small rocks interact-only layer 5), `veg_harvest.gd` + `veg_felled_tree.gd` =
chopping/felling/bucking, shrub and rock yields, persistence (key "vegetation").

# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Terrain texture layers | `python3 thin-air/tools/textures/gen_terrain.py [--only snow,rock] [--preview] [--no-write]` | `assets/textures/terrain/<layer>_{albedo,normal,roughness,height}.png`, packed `terrain_albedo_height.png` + `terrain_normal_rough.png` (Texture2DArray, 9 layers), `terrain_macro_noise.png`, `layers.json` (~2 min) |
| PBR material library | `python3 thin-air/tools/textures/gen_materials.py [--only bark_pine,rope] [--preview] [--no-write]` | `assets/textures/<set>/<set>_{albedo,normal,orm[,height]}.png`, `assets/materials/<set>.tres` (ORMMaterial3D), `assets/materials/materials.json` (~3 min) |
| Texture seam QA | `python3 thin-air/tools/textures/check_seams.py [set ...]` | prints wrap-around continuity per map (same statistic as `tests/test_textures.gd`) |
| Texture contact sheet | `python3 thin-air/tools/textures/contact_sheet.py out.jpg mat_rope terrain_rock ...` | tiles the CPU previews written by `--preview` (in `tools/textures/_cache/preview/`, git-ignored) |
| Terrain (heightfield, masks, layout) | `python3.12 thin-air/tools/terrain/gen_terrain.py [--stage far\|mid\|fine\|fine2\|out] [--stop out] [--preview DIR]` | `assets/terrain/{height.f32,mid.f32,far.f32,masks.bin,masks2.bin,normal.png,detail.png}`, `data/world_layout.json` (~7 min from `far`; stages cache in `tools/terrain/_cache/`, git-ignored) |
| Material preview stage | `DISPLAY=:99 godot --path thin-air --write-movie /tmp/m.png --fixed-fps 30 --quit-after 10 res://scenes/dev/material_preview.tscn -- --mode=grid` | lit renders: `--mode=grid`, `--mode=sets --sets=a,b`, `--mode=terrain --layer=rock`, `--mode=strips --layers=a,b`, `--mode=wall --layer=cliff --ground=scree`; `--macro=1`, `--sun=elev,az`, `--perf` |

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

## Terrain (terrain stream)

`tools/terrain/` builds the mountain deterministically (seed 20261024). Python 3.12 + numpy/scipy/Pillow; the heavy
kernels are C (`terrain_c.c`, compiled on first use into `_cache/libterrain.so` with `gcc -O2`, called via ctypes
from `tlib.py`). Files: `design.py` (the hand-designed world: POIs with altitudes, valley-floor and crest
skeletons, lake, rivers, trails, ramps, gorges, zones), `macro.py` (design surface), `fields.py` (polyline distance
fields with exact segment projection), `gen_terrain.py` (stages), `fine.py` (1.5 m map features), `outputs.py`
(masks, normals, stitching, layout JSON), `preview.py` (CPU hillshade + perspective previews).

Stages (`--stage X` resumes from a cached stage; `--preview DIR` writes hillshades and 6 perspective views):
1. **far** (48 m, +-24.6 km): the designed skeleton near the map, a sea of ridged-multifractal peaks over the
   regional valley network (warped, meandering) further out, fall-line erosion noise. Rendered as the horizon.
2. **mid** (12 m design -> 6 m, +-3,072 m): harmonic (Laplace) fields for the valley-to-crest coordinate and the
   floor / crest heights; a cliff-base profile (gentle below ~1,950 m, walls above, suppressed along the golden-path
   RAMPS); the lower envelope of valley-wall cones (<= 33 deg forested walls from every floor edge, steeper for high
   cirques and the designed GORGES) caps it; then facets, ragged crests, a coarse-to-fine cascade of fall-line
   erosion noise (C `erosion_noise`, dendritic gullies/spurs), layer-cake benches above the cliff base, footslope
   fillets, graded RAMP corridors. Matched to FAR at its border.
3. **fine** (1.5 m, the 2049^2 map): POI altitude corrections, metre-scale gullies/ribs/hummocks, strata cliff bands
   and ledges, the Corrigan Glacier (smooth ice with convex tongue, serac-chaos icefall, shallow crevasses, lateral
   moraines, steep snout), 1.6 M droplet hydraulic erosion + 36 deg thermal talus on soft ground (pads protected).
4. **fine2**: Loon Lake basin + shore, tarns, snout moraines, rivers (downstream-monotone isotonic water profile,
   channel + limited banks; braided gravel plain), POI pads (walkable blend rings), trails (least-cost switchback
   router with a turning penalty `route_turn`, grade-limited tread, bench cuts, fords graded to the water), summit
   cap (Mount Corrigan is the highest point).
5. **out**: masks (snow by altitude/aspect/wind/curvature incl. snow-filled couloirs; rock; meadow; forest with
   treeline, avalanche chutes and clearings; scree below its repose angle; gravel; glacier ice; wetness), world
   normals + horizon AO (`normal.png`), `detail.png` (trail, strata band index, crevasses, cliff bands), MID/FAR
   stitched to the map edge, `world_layout.json` (CONTRACT §6; compact numeric arrays).

Runtime: `src/autoload/terrain_data.gd` (queries + GPU textures + shader globals), `src/world/terrain.gd`
(geometry clipmap, Jolt heightfield collider with NaN holes for the mine adit / ice cave, map boundary, heightfield
sun-shadow pass `terrain_shadow_tex`), shaders `assets/shaders/terrain*.gdshader(inc)`. Tests: `tests/test_terrain.gd`.

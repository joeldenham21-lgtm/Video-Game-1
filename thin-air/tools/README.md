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
| Viewmodel textures (player) | `python3 thin-air/tools/player/gen_fp_textures.py` → import → `python3 thin-air/tools/player/gen_fp_textures.py --fix-imports` → import | `scenes/player/textures/*` (512² seamless PBR sets: wood ash/dark/raw, steel, stone, leather, fabric, knit, rubber, aluminium, plastic, canvas; topo map; flame/smoke/spark sprites). Needs numpy + PIL (`python3.12` in this container). |
| Item textures + campfire FX | `python3.12 thin-air/tools/icons/gen_item_textures.py [set ...]` | `scenes/items/materials/tex/*` (PBR sets for the item material library `scenes/items/materials/materials.json`), `scenes/items/fx/` flame flipbook, smoke puffs, ember/glow sprites |
| Item icon meshes | `godot --headless --path thin-air --import` then `godot --headless --path thin-air -s $PWD/thin-air/tools/icons/export_meshes.gd [-- --ids=a,b]` | `tools/icons/_cache/<id>.obj` + `manifest.json` (procedural `ItemVisuals` models; uses `assets/models/items/<id>.glb` instead when a hero model exists) |
| Item icon renders | `blender -b -P thin-air/tools/icons/render_icons.py -- [--ids=a,b] [--samples=96]` | `tools/icons/_cache/raw/<id>.png` (Cycles studio rig, 512 px, materials rebuilt from `materials.json`) |
| Item icon finish | `python3.12 thin-air/tools/icons/finish_icons.py [ids ...]` | `assets/icons/<id>.png` (256 px RGBA, cropped/centred/sharpened) + `assets/icons/_unknown.png` |
| Items dev scene / shots | `DISPLAY=:99 godot --path thin-air --fixed-fps 30 --resolution 1280x720 res://scenes/dev/items_test.tscn -- --shot=<campfire_night\|ui_inventory\|ui_equipment\|ui_crafting\|ui_container\|pickups> --save=<abs.jpg>` | `docs/shots/items_*.jpg` (add `--preset=mobile_high --rendering-method mobile` for the phone layout) |
| SFX + ambience synthesis (Audio) | `python3.12 thin-air/tools/audio/build_sfx.py [--only ids] [--preview DIR]` then `python3.12 thin-air/tools/audio/set_loop_flags.py` and `godot --headless --path thin-air --import` | `assets/audio/sfx/*.ogg`, `assets/audio/ambience/*.ogg`, `data/sfx.json` (≈2 min, 4 cores) |
| Voice casting analysis (Audio) | `python3.12 thin-air/tools/audio/voice/cast_voices.py` · `python3.12 thin-air/tools/audio/voice/audition.py DIR` | `tools/audio/_cache/casting.json`, audition WAV/PNGs |
| Voice lines, logs, prologue (Audio) | `python3.12 thin-air/tools/audio/voice/build_voice.py [--only ids] [--preview DIR]` (script: `tools/audio/voice/script.py`) | `assets/audio/voice/*.ogg`, `data/voice.json`, `data/logs.json` (≈10 min first run with parallel piper, ≈7 min re-process from the TTS cache; `--only ids --with-prologue` for quick edits) |
| Audio QA (Audio) | `python3.12 thin-air/tools/audio/qa_audio.py [--out DIR]` | loudness/true-peak/channels/loop-seam report + sox spectrograms |

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

# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Terrain texture layers | `python3 thin-air/tools/textures/gen_terrain.py [--only snow,rock] [--preview] [--no-write]` | `assets/textures/terrain/<layer>_{albedo,normal,roughness,height}.png`, packed `terrain_albedo_height.png` + `terrain_normal_rough.png` (Texture2DArray, 9 layers), `terrain_macro_noise.png`, `layers.json` (~2 min) |
| PBR material library | `python3 thin-air/tools/textures/gen_materials.py [--only bark_pine,rope] [--preview] [--no-write]` | `assets/textures/<set>/<set>_{albedo,normal,orm[,height]}.png`, `assets/materials/<set>.tres` (ORMMaterial3D), `assets/materials/materials.json` (~3 min) |
| Fauna models + clips + coats | `blender -b -P thin-air/tools/blender/fauna/build_fauna.py -- wolf deer bear goat hare birds [--preview=DIR]` (then `python3 thin-air/tools/blender/fauna/write_species.py` for the species .tres table) | `assets/models/fauna/<sp>.glb` (skinned, 9–12 baked clips) + `<sp>.json` (clip lengths, native gait speeds, events, UV metres), `assets/textures/fauna/<sp>_albedo.png` (RGB coat, A fur length; `bear_oldgrey` extra coat), `fur_strands.png`, static `raven.glb`/`eagle.glb` (~1 min per species) |
| Texture seam QA | `python3 thin-air/tools/textures/check_seams.py [set ...]` | prints wrap-around continuity per map (same statistic as `tests/test_textures.gd`) |
| Texture contact sheet | `python3 thin-air/tools/textures/contact_sheet.py out.jpg mat_rope terrain_rock ...` | tiles the CPU previews written by `--preview` (in `tools/textures/_cache/preview/`, git-ignored) |
| Props: gloved hands, tools, items, world props (Blender) | `blender -b -P thin-air/tools/blender/props/build.py -- --set=arms\|fp\|items\|props\|all [--only=id,id] [--preview=/abs/dir]` then `godot --headless --path thin-air --import` | `assets/models/fp/arms.glb` (one posed hand mesh per `FPHands.POSES` grip), `assets/models/fp/<tool>.glb` (first-person frames of the tool scripts), `assets/models/items/<id>.glb` (world/pickup/icon models), `assets/models/props/<id>.glb` + `scenes/props/<id>.tscn` (StaticBody layer 1 / RigidBody layer 4 + collision). Surfaces carry only item-material-library NAMES; `scenes/props/prop_import.gd` (set in each `.import`) binds the real `ItemMaterials` material at import. ~1 min for everything |
| Props QA lineup | `DISPLAY=:99 godot --path thin-air --write-movie /tmp/l.png --fixed-fps 30 --quit-after 8 --resolution 1600x900 res://scenes/props/props_lineup.tscn -- --set=props\|items [--only=a,b] [--cols=4] [--dist=0.7]` | in-engine lineup of every prop scene (with collision bodies) or item hero model; `docs/shots/props_*.jpg` |
| Terrain (heightfield, masks, layout) | `python3.12 thin-air/tools/terrain/gen_terrain.py [--stage far\|mid\|fine\|fine2\|out] [--stop out] [--preview DIR]` | `assets/terrain/{height.f32,mid.f32,far.f32,masks.bin,masks2.bin,normal.png,detail.png}`, `data/world_layout.json` (~7 min from `far`; stages cache in `tools/terrain/_cache/`, git-ignored) |
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
| Sky: atmosphere LUT (1/2) | `python3 thin-air/tools/sky/gen_atmosphere.py` (numpy+scipy; ~90 s) | `tools/sky/_cache/atmosphere_{lut,cpu}.bin` + `atmosphere_meta.json`: spectral (31 λ) Rayleigh + Mie + ozone single scattering with Hillaire-2020 multiple scattering, 4 camera altitudes × 64 sun elevations |
| Sky: atmosphere LUT (2/2) | `DISPLAY=:99 godot --path thin-air -s $PWD/thin-air/tools/sky/bake_sky_resources.gd` (needs a real renderer, not `--headless`, so the 3D texture can be read back) | `assets/textures/sky/atmosphere_lut.res` (ImageTexture3D 64×64×256 RGBE9995), `atmosphere_cpu.res` (Image, CPU lighting tables) |
| Sky: textures | `python3 thin-air/tools/sky/gen_sky_textures.py [clouds moon stars milky_way flakes blue_noise]` | `assets/textures/sky/`: `cloud_noise.png` (Perlin-Worley / billow / detail / cirrus), `moon_albedo.png` (near-side maria + ray craters), `stars.png` (≈230 real bright stars + ≈26k procedural, equatorial), `milky_way.png` (galactic model: bulge, Great Rift, star clouds, M31), `flakes.png`, `blue_noise.png` |
| Sky: import flags | `python3 thin-air/tools/sky/set_import_flags.py` then `godot --headless --path thin-air --import` | lossless / no-mipmap / untouched-alpha import settings for the sky data textures |
| Sky: look-dev renders | `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus\|mobile --write-movie /tmp/s.png --fixed-fps 30 --quit-after 12 --resolution 1280x720 res://scenes/dev/sky_test.tscn -- --hours=16.75 --weather=clear --look=300,5 [--day=N --moon=0.5 --aurora=0.8 --preset=P --perf]` (see header of `src/dev/sky_test.gd`) | sky/weather frames over a procedural mountain backdrop; the last PNG is the settled frame (`docs/shots/sky_*.jpg`) |
| Foliage card atlases | `blender -b -P thin-air/tools/blender/vegetation/cards.py -- [--only=spruce,fir] [--res=1024] [--spp=24]` | `assets/textures/foliage/<set>_{albedo,normal}.png` (needle/leaf/blade branchlets modelled and rendered orthographically), `cards.json` regions (~10 min, Cycles CPU) |
| Conifers + snags | `blender -b -P thin-air/tools/blender/vegetation/trees.py -- [--only=spruce_a,fir_b]` | `assets/models/vegetation/<variant>.glb` (LOD0/LOD1/LOD2 nodes, bark + card surfaces, wind/AO vertex colours) + manifest `vegetation.json` "trees" (~30 s) |
| Water textures | `python3.12 thin-air/tools/water/gen_water_textures.py [--preview]` then `godot --headless --path thin-air --import` | `assets/textures/water/`: `water_ripple_a_normal.png` (wind-wave spectrum), `water_ripple_b_normal.png` (capillary ripples), `water_foam.png` (R foam/bubble lattice, G flow streaks, B soft cloud noise for gusts / skim-ice mottling), `water_mist.png` (spray puff) — exactly periodic (Fourier / torus), VRAM-compressed imports written alongside (~7 s) |
| Shrubs, ground cover, deadwood | `blender -b -P thin-air/tools/blender/vegetation/plants.py -- [--only=willow_a,log_a]` | willow/alder/juniper/huckleberry, grass/sedge tufts, dead fern, logs, stumps + manifest "plants", "groundcover", "deadwood" |
| Rocks | `blender -b -P thin-air/tools/blender/vegetation/rocks.py -- [--only=boulder_a] [--bake=512]` | `assets/models/rocks/<name>.glb` + `<name>_normal.png` (sculpt baked to LOD0) + manifest "rocks" (~2 min) |
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
| Original score (music) | `python3.12 thin-air/tools/music/build.py [cue ...]` (`--qa-only` = score checks + MIDI export, no audio), then `godot --headless --path thin-air --import` and `godot --headless --path thin-air -s $PWD/thin-air/tools/music/verify_godot.gd` | `assets/audio/music/*.ogg` (+ `.import`, loop flags), `data/music.json`, `tools/music/midi/*.mid` (readable scores); QA pictures/reports in `tools/music/_cache/qa/` (git-ignored). See "Music" below. |
## Music (`tools/music/`)
Every note of the score is composed by hand in `tools/music/cues/*.py` (no generated notes). The
leitmotif "Thin Air" (a rising fifth, then a stepwise climb to the octave) and its forms are
documented in `cues/common.py`. Notation (`Part.phrase`) is bar-checked: a misplaced `|` fails the build.
Pipeline (`lib/`): score model + tempo maps (`score.py`) -> seconds-based MIDI per part, humanised
about ±10 ms / velocity, attack-compensated for slow sampled strings (`midi.py`, `render.py`) ->
fluidsynth stems (48 kHz, MuseScore_General_Full.sf3, cached by MIDI hash) + numpy synth layers
(`synth.py`: detuned-saw pads with filter sweeps, drones, glass partials, noise 'air', plucks, booms,
cymbals) -> mix: EQ, pan/width, synthetic stereo hall IR (frequency-dependent RT60, pre-delay)
convolution -> loop folding (tails wrap onto the loop start; periodic layers are sample-periodic) ->
slow leveler (one-shots) + bus compressor -> BS.1770 loudness (-18 LUFS cues, -16 stingers) +
4x-oversampled true-peak limiter (<= -1 dBTP) -> 44.1 kHz (FFT-periodic resampling for loops) ->
OGG Vorbis q6, verified with `ffmpeg ebur128`. `.import` files set `loop=true` for loops (Godot
restarts at sample 0, `loop_offset=0`; `bpm`/`beat_count` stay 0 so the loop point is the file end).
QA (`lib/qa.py`, printed by every build): instrument ranges, parallel 5ths/8ves between all voice
pairs and inside chord parts (declared doublings exempt), thirds below C3 / seconds below C4,
texture density; loop-seam continuity; spectrogram + loudness-envelope PNGs per cue.
Listening aids (`analyze.py`, on the cached renders): `bands [cue..]` octave-band balance vs 1 kHz +
stereo correlation, `clicks <cue>` broadband-click scan of the master and every stem,
`section <cue> <beat0> <beat1>` approximate loudness of each part inside a passage (finds a part
that buries another, e.g. a timpani heartbeat over the horn calls).
Requires `python3.12` (the system python that has numpy/scipy), fluidsynth, sox, ffmpeg.
| Cue (`data/music.json` key) | Title | Form | Length | Key / tempo |
|---|---|---|---|---|
| `menu` | Thin Air (main theme) | one-shot: solo piano → celli → strings/harp → choir + horns climax → piano coda | 2:41 | D Dorian, 58–68 BPM rubato |
| `explore` | Open Country | loop, piano + harp + soft strings, lots of air | 3:20 | G Lydian, 72 |
| `forest` | Under the Canopy | loop, pizzicato 'footsteps', clarinet/flute/bassoon, low strings | 3:00 | E Dorian, 66 (3/4) |
| `night` | Long Night | loop, dark saw pad, distant piano fragments, celesta, glass stars | 3:00 | D Aeolian, 56 |
| `alpine` | Thin Air (Altitude) | loop, high strings, solo violin, choir oohs, glass, thin air noise | 3:00 | E Lydian, 60 |
| `station` | Kestrel Station | loop, electric piano, solo cello (theme inverted), pad, beacon pings | 2:31 | F# minor, 70 |
| `danger` | Hunted | loop, spiccato/pizz ostinato, corrupted-fifth brass, taiko/timpani/bass drum | 1:30 | C Phrygian, 120 |
| `blizzard` | Whiteout | loop, string clusters swelling and collapsing, low drones, storm noise | 2:00 | B clusters, 60 |
| `summit` | The Summit | one-shot: build on a D pedal → E-major tutti statement ×2 → release | 2:25 | D minor → E major, 66–72 |
| `finale` | Dawn over the Aldous Range | one-shot: the theme resolved in D major, piano → strings → warm tutti → piano | 2:56 | D major, 66–72 |
| `stinger_discovery` / `_danger` / `_objective` / `_death` / `_blueprint` | stingers | one-shots, 5–10 s, -16 LUFS | | |
Loops are mastered so the file end flows into sample 0; the Audio director (`src/audio/`) may cross-fade
on `phrase_starts_s` (every 4 bars) listed per cue in `data/music.json`.

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
   erosion noise (C `erosion_noise`, dendritic gullies/spurs), benches above the cliff base (60-260 m bands on a
   folded structural surface - the dip swings up to ~10 deg over 0.5-2 km - broken wherever a big fall-line gully
   runs, then couloirs re-cut through them, so no bench runs level across a whole face), footslope fillets, graded
   RAMP corridors. Matched to FAR at its border.
3. **fine** (1.5 m, the 2049^2 map): POI altitude corrections, Mount Corrigan's summit pyramid (sharp aretes along
   the designed W/N/E summit crests, ~56 deg faces between them that only carve rock away, radial couloirs, a blocky
   summit block; blended out by 430 m, the col/station untouched), folded strata (thin-bedded runs and massive
   units, dip varying with folds, ledges that pinch out along strike; per-band rock colour), then metre-scale
   gullies/ribs/hummocks and incised couloirs that cut through the strata, the Corrigan Glacier (smooth ice with convex tongue, serac-chaos icefall, shallow crevasses, lateral
   moraines, steep snout), 1.6 M droplet hydraulic erosion + 36 deg thermal talus on soft ground (pads protected).
4. **fine2**: Loon Lake basin + shore, tarns, snout moraines, rivers (downstream-monotone isotonic water profile,
   channel + limited banks; braided gravel plain), POI pads (walkable blend rings), trails (least-cost switchback
   router with a turning penalty `route_turn`, grade-limited tread, bench cuts, fords graded to the water), summit
   cap (Mount Corrigan is the highest point).
5. **out**: masks (snow by altitude/aspect/wind/curvature; on steep faces snow only lodges in couloir floors and
   concave gullies and in broken ledge patches - never in even bands along the strata; rock; meadow; forest with
   treeline, avalanche chutes and clearings; scree below its repose angle; gravel; glacier ice; wetness), world
   normals + horizon AO (`normal.png`), `detail.png` (trail, strata band index, crevasses, cliff bands), MID/FAR
   stitched to the map edge, `world_layout.json` (CONTRACT §6; compact numeric arrays).

Shader (`assets/shaders/terrain_material.gdshaderinc`): up to 3 height-blended layers (desktop; 2 on Mobile),
biplanar X/Z projection with height-aware weights on steep ground (every layer on desktop, rock/cliff/snow on
Mobile), a noise-driven rotated 1/3.7 second fetch against tiling (desktop), a "macro rock" pass (the cliff layer
re-projected at ~37 m and ~150 m for albedo + normal, 10 m to 5 km) so faces stay rocky beyond the 360 m texture
range, snow that lodges in the macro rock's low parts on faces, weather dusting broken into patches on faces, and
ground texture relief/contrast flattened under mostly-snowy cover (no tiled tufts printing through).
Runtime: `src/autoload/terrain_data.gd` (queries + GPU textures + shader globals), `src/world/terrain.gd`
(geometry clipmap, Jolt heightfield collider with NaN holes for the mine adit / ice cave, map boundary, heightfield
sun-shadow pass `terrain_shadow_tex`), shaders `assets/shaders/terrain*.gdshader(inc)`. Tests: `tests/test_terrain.gd`.
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
chopping/felling/bucking, shrub and rock yields, persistence (key "vegetation"). Edges are kept natural: ground cover
and shrubs fade in over a noisy 14 m ring outside POI pads (`VegScatter.pad_keep`, pads themselves stay clear), the
shrub ecotone follows a noise-displaced forest edge and species grow in ~45 m patches, and open-grown edge trees
favour full-crowned spruce/fir (few lodgepole/snags at meadow edges). All vegetation shaders take the heightfield
sun shadow (`veg_light()` in `veg_common.gdshaderinc`), so trees and tufts in a ridge's shadow are not sunlit.
## Building (`tools/blender/building/`, building stream)
| Tool | Command (from repo root) | Output |
|---|---|---|
| Building pieces | `blender -b -P thin-air/tools/blender/building/build_all.py -- [--only=walls,roof,camp_bed,...] [--stats]` | `assets/models/building/*.glb` (≈20 s): `walls` (log wall / window / doorway bodies in even + odd courses, saddle-notch corner stubs), `gables` (log infill cut to the roof pitch), `roof` (shake roof slope / peak ± eave, gable overhang strips, ridge caps), `foundation` (puncheon deck, sill, stilt posts, footing, brace), `misc` (upper floor, stairs, pillar, railing, door leaf), `camp_*` (fire pit, torch stand, drying rack, snow melter, bough bed, hide bed, lean-to, rope ladder, windbreak) |
| Building textures | `python3.12 thin-air/tools/blender/building/gen_textures.py` | `assets/models/building/textures/spruce_bough_{albedo,normal}.png` (alpha-scissor spruce bough for beds, lean-to thatch) |
| Building QA scene / shots | `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --fixed-fps 30 --resolution 1280x720 res://scenes/dev/building_test.tscn -- --shot=<exterior\|interior\|stilts\|frames\|camp\|aerial\|closeup\|perf200\|ui_picker\|fp_ghost> [--save=/abs/x.jpg --perf]` | scripted camp (3×3 cabin, lean-to + fire, drying rack, beds, snow melter, frames); `docs/shots/building_*.jpg` |
Geometry is authored in Godot coordinates by `blib.py` (logs with per-log irregularity, chamfered endgrain caps,
boards, field stones, rope, lashings, alpha cards, plane clipping + capping) and exported with the vertex
conventions the building shaders read: UV in metres (V along the grain), UV2 = per-part random offset,
COLOR r = AO, g = build step (the order parts appear while a blueprint frame is filled), b = bark density /
weathering, a = surface flag (wood / endgrain / chinking). Constants shared with `src/building/build_grid.gd`:
2 m cells, 0.27 m log courses, wall plate 2.44 m, storey 2.6 m, roof rise 1.35 m per cell (34°).

### Fauna pipeline (`tools/blender/fauna/`)
`flib.py` builds a creature from a species spec (`sp_<id>.py`): anatomical SDF primitives in Godot axes (round
cones + ellipsoids, smooth-min blended, eye sockets smooth-subtracted, fine value-noise skin displacement) →
vectorised surface nets → Laplacian relax with SDF re-projection → Blender collapse decimation; separate lower
jaw (so the mouth opens), cupped ear shells and eyeballs. Skin weights come from primitive ownership (soft-min of
per-primitive distances accumulated per bone). The coat is baked by rasterising the smart-UV layout and evaluating
the species pattern on each texel's rest-pose position/normal/anatomical region. Clips are authored procedurally:
quadruped gait tables (lateral-sequence walk, diagonal trot, rotary gallop, stot, half-bound) drive planar 2-bone
IK with pole vectors, metapodial/toe angles, scapula swing, spine flexion, bob/pitch/roll; behaviour clips (idle
breathing + ear flicks, sniff/graze, look, howl, snarl, lunge-bite/swipe, hit, death roll) are pose functions of time.
## Story locations (`tools/blender/poi/`, poi stream)
| Tool | Command (from repo root) | Output |
|---|---|---|
| POI textures | `python3.12 thin-air/tools/blender/poi/gen_textures.py` | `assets/models/poi/textures/poi_decals_albedo.png` (2048×1024 RGBA decal atlas: C-FKTL registration, Otter panel, radio faces, station/mine/ranger/relay signage, hazard stripes, whiteboard, topo map, calendar, stencils, terminal screen), `poi_noise.png`; region table `tools/blender/poi/decals.json` |
| POI socket settle (after every POI scene build) | `godot --headless --path thin-air res://scenes/dev/settle_sockets.tscn [-- --check]` | snaps the `Loot_*` / `Log_*` markers of `scenes/poi/*.tscn` down onto what is under them (the location's render meshes + terrain at its world placement, `SocketSupport`), so loot and crew logs rest on tables, shelves, floors and the ground; `--check` only reports (exit 1). `tests/test_poi_assets.gd` fails on hovering sockets |
| POI models + scenes | `blender -b -P thin-air/tools/blender/poi/build.py -- [--only=crash_site,kestrel_station,...] [--nobake]` then `godot --headless --path thin-air --import` | per location (≈40 s for all): `assets/models/poi/<id>.glb` (merged static meshes per visibility bucket, one surface per material) + `.import` (materials remapped to `assets/models/poi/materials/*.tres`), `scenes/poi/<id>.tscn` (inherited scene: PoiSite root, collision boxes per footstep surface, Marker3D sockets, lights, reflection probes, shelter areas, heat slots), `tools/blender/poi/stats.json` |
| POI QA shots | `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --fixed-fps 30 --quit-after 900 --resolution 1280x720 res://scenes/dev/poi_test.tscn -- --batch=crash_site:nose,kestrel_station:hero,... --outdir=/abs/dir [--flat --lights=1 --torch=3 --hours=H --perf]` (or `--site=<id> --shot=<name> --save=/abs/x.jpg`) | the real world (terrain, vegetation, sky) with the locations placed by `scenes/poi/structures.gd` (`--flat`: sky + flat ground only, ~1.7 GB instead of ~3.5 GB of RAM); one world load renders every shot of the batch; shots per site in `src/dev/poi_test.gd` SHOTS; `docs/shots/poi_*.jpg` |
Sites (`sites/*.py`): crash_site (DHC-3 Otter C-FKTL wreck), kestrel_station, ranger_cabin, ashford_mine (+ `ashford_mine_interior`),
summit_relay, owens_bivouac, glacier_camp, fire_lookout, trapper_cabin, ice_cave (+ `ice_cave_entrance`). Libraries: `plib.py`
(Mesh soup, primitives - box/cyl/lathe/loft/tube/slab/heightpatch/blob, Site, terrain `Ground` sampler, BVH ray-cast vertex
bake, glTF export), `arch.py` (walls with openings, windows, doors, stairs, railings, roofs, log walls, lattice masts, guys),
`props.py` (crates, drums, jerrycans, bunks, stoves, lanterns, tents, rime ice …), `pscene.py` (materials, .import, .tscn).
The glb is written by plib's own glTF writer (split normals computed in Python) rather than Blender's exporter, so a
rebuild of unchanged sources is bit-identical (no redundant binaries in git history).
**Vertex layout** (read by `assets/models/poi/shaders/poi_common.gdshaderinc`): UV in metres (× 1/tile per material; V
along the grain), `COLOR.rgb` = paint tint × baked AO (near occlusion + sky openness) × ground grime, `COLOR.a` = sky
exposure (0 indoors .. 1 open sky) → snow settles on exposed up-facing surfaces (global `snow_cover` + altitude), rain
wets. Materials reuse the shared texture library (no duplicated textures): repaintable variants desaturate + tint.

## Story (story stream)
No generators: the story is data. `data/story.json` holds the objective graph (30 objectives over acts 1–6, each with
prerequisites, an optional trigger, a completion condition, start/complete actions and a stuck hint), the one-shot beats,
Mara's contextual radio hints, the interactables placed at location sockets ("uses"), extra scanner targets and Mara's
in-person talk lines. `data/loot.json` holds the loot tables and what lies at each Loot_* socket (seeded per site+socket).
Voice lines are the audio stream's `data/voice.json` (no new lines were needed).
| Tool | Command (from repo root) | Output |
|---|---|---|
| Story tests | `timeout 300 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_story.gd` | graph integrity + reachability, loot, Structures population, a scripted playthrough to the ending, save/load mid-act |
| Story QA shots | `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /abs/dir/f.png --fixed-fps 30 --quit-after 45 --resolution 960x540 res://scenes/story/story_shot.tscn -- --shot=wake` (or `--shot=station [--switch=24] [--view=mara] [--hours=20.6]`, `--shot=rescue [--remaining=110]`; `--size=960` = 3D render width) | `wake`: a real new game (prologue black + subtitles, auto-skipped by `Story.dev_fast`, then the fade-in at the wreck); `station`: Kestrel Station with the generator on, galley then the east module (`--view=mara`: her blanket curtain); `rescue`: Rescue One-Six on final to the pad at dawn; frames → `docs/shots/story_*.jpg` |

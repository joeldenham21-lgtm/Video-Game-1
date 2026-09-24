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
| Sky: atmosphere LUT (1/2) | `python3 thin-air/tools/sky/gen_atmosphere.py` (numpy+scipy; ~90 s) | `tools/sky/_cache/atmosphere_{lut,cpu}.bin` + `atmosphere_meta.json`: spectral (31 λ) Rayleigh + Mie + ozone single scattering with Hillaire-2020 multiple scattering, 4 camera altitudes × 64 sun elevations |
| Sky: atmosphere LUT (2/2) | `DISPLAY=:99 godot --path thin-air -s $PWD/thin-air/tools/sky/bake_sky_resources.gd` (needs a real renderer, not `--headless`, so the 3D texture can be read back) | `assets/textures/sky/atmosphere_lut.res` (ImageTexture3D 64×64×256 RGBE9995), `atmosphere_cpu.res` (Image, CPU lighting tables) |
| Sky: textures | `python3 thin-air/tools/sky/gen_sky_textures.py [clouds moon stars milky_way flakes blue_noise]` | `assets/textures/sky/`: `cloud_noise.png` (Perlin-Worley / billow / detail / cirrus), `moon_albedo.png` (near-side maria + ray craters), `stars.png` (≈230 real bright stars + ≈26k procedural, equatorial), `milky_way.png` (galactic model: bulge, Great Rift, star clouds, M31), `flakes.png`, `blue_noise.png` |
| Sky: import flags | `python3 thin-air/tools/sky/set_import_flags.py` then `godot --headless --path thin-air --import` | lossless / no-mipmap / untouched-alpha import settings for the sky data textures |
| Sky: look-dev renders | `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus\|mobile --write-movie /tmp/s.png --fixed-fps 30 --quit-after 12 --resolution 1280x720 res://scenes/dev/sky_test.tscn -- --hours=16.75 --weather=clear --look=300,5 [--day=N --moon=0.5 --aurora=0.8 --preset=P --perf]` (see header of `src/dev/sky_test.gd`) | sky/weather frames over a procedural mountain backdrop; the last PNG is the settled frame (`docs/shots/sky_*.jpg`) |

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

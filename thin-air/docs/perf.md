# THIN AIR — performance, load time and release audit

Measured 2026-09-27 on the dev container (4 vCPU, lavapipe/llvmpipe Vulkan — CPU rasteriser, so only the
*counts* are meaningful, not frame times). Budgets: CONTRACT.md §8.

## 1. Render budget audit (5 views × 2 renderers)

Harness: `scenes/dev/shot.tscn --perf` (the PERF line now also prints the shadow pass separately, from
`RenderingServer.viewport_get_render_info(…SHADOW…)`). Every run:

```
DISPLAY=:99 godot --path thin-air --rendering-method mobile|forward_plus --write-movie /tmp/x/f.png \
  --fixed-fps 30 --quit-after 40 --resolution 960x540 res://scenes/dev/shot.tscn -- <view> \
  --preset=mobile_high|high --weather=clear --perf --perf_at=35 --size=960
```

`--weather=clear` so the sun casts shadows (the first pass ran with the default random weather: overcast
at the crash site gave 0 shadow draw calls and was discarded). 10:00, day 1.

| View (args) | Renderer / preset | Draw calls | of which shadow | Primitives | Shadow prims | VRAM MB |
|---|---|---:|---:|---:|---:|---:|
| crash_site looking north `--pos=-520,g,870 --look=0,-3` | Mobile / mobile_high | 168 | 28 | 0.58 M | 0.09 M | 624 |
| | Forward+ / high | 687 | 321 | 2.85 M | 0.87 M | 990 |
| dense valley forest `--pos=150,g,300 --look=30,-2` | Mobile / mobile_high | 197 | 45 | 0.77 M | 0.11 M | 622 |
| | Forward+ / high | 692 | 381 | 3.57 M | 1.08 M | 982 |
| loon_lake shore `--pos=268,g,818 --look=0,-3` | Mobile / mobile_high | 174 | 33 | 0.61 M | 0.09 M | 621 |
| | Forward+ / high | 566 | 292 | 2.99 M | 0.91 M | 980 |
| kestrel_station from the south `--pos=-360,g,-930 --look=0,-3` | Mobile / mobile_high | 79 | 10 | 0.46 M | 0.07 M | 622 |
| | Forward+ / high | 225 | 139 | 2.16 M | 0.75 M | 972 |
| summit looking south `--pos=120,g,-1235 --look=180,-10` | Mobile / mobile_high | 88 | 3 | 0.34 M | 0.04 M | 622 |
| | Forward+ / high | 175 | 18 | 1.83 M | 0.44 M | 972 |
| **Budget** | Mobile (S25 Ultra) | **≤ 600** | **≤ 150** | **≤ 1.5 M** | | **≤ 1,536** |
| | Desktop High | **≤ 2,500** | **≤ 600** | **≤ 6 M** | | **≤ 3,584** |

Extra data points (camera inside/under the structures, first pass): forest-side lake view `--pos=268,g,850`
mobile 195 / 34 shadow / 0.69 M, Forward+ 635 / 305 / 3.45 M; kestrel_station POI centre looking south
mobile 126 / 7 / 0.66 M, Forward+ 416 / 193 / 2.50 M; summit POI centre looking south mobile 83 / 3 / 0.33 M,
Forward+ 212 / 50 / 1.90 M.

**Result: every view is inside every budget on both targets** — worst mobile view (dense forest) uses 33 % of
the draw-call, 30 % of the shadow-draw and 52 % of the triangle budget; worst desktop view (dense forest) 28 %,
64 % and 60 %. The biggest single consumer on desktop is the shadow pass (4 cascades × tree shadow proxies +
terrain shadow-caster: ~45–55 % of all draw calls). Because nothing is over budget, **no rendering setting was
changed** (visibility ranges, LOD bias, shadow casting, impostor distances and grass density stay as tuned by
the vegetation/terrain streams), so the "after" numbers equal the table above and the desktop look is
untouched. Where to cut first if a later content pass pushes a view over: (1) desktop tree shadow proxies
beyond `a*1.6` (impostor quads, `Vegetation.shadow_bands[TREE]`) → end them at `shadow_distance*0.6`;
(2) mobile `grass_distance` 24 → 18 m (grass is the largest mobile primitive consumer near the camera, it never
casts shadows); (3) `lod_bias` 1.4 → 1.8 on mobile_high.

Mobile draw calls equal the object count because the Mobile renderer issues one draw per visible
instance/multimesh (no depth pre-pass); on the Adreno 830 that is the relevant number.

## 2. World build / load time

`Game.new_game()` → `Game.on_world_built()`, headless, measured by the new `--autostart --autoquit` boot
option (see §4). TerrainData (heightfield, masks, layout, GPU textures) loads at autoload boot, before the menu.

| Stage | ms (editor, headless) | ms (exported Linux build, headless) |
|---|---:|---:|
| TerrainData (autoload, before the menu) | 74 | 69 |
| Sky | 100 | 89 |
| Terrain (clipmap + 2049² heightfield collider) | 236 | 200 |
| Water | 89 | 57 |
| Vegetation (sync scatter of the 122 cells ≤ 360 m, then 2,182 cells stream on worker threads) | 2,242 | 1,799 |
| Structures (POIs) | 220 | 257 |
| Fauna pools | 258 | 294 |
| Items / Building | 0 / 0 | 0 / 0 |
| Player / HUD | 82 / 20 | 121 / 20 |
| **World build total (new_game → on_world_built)** | **3,914** | **3,603** |

Under the 8 s threshold, so no stage needed rework; the vegetation near-field scatter is the largest stage
(it is already threaded: sync cells in a WorkerThreadPool group task, the rest of the map streams in at low
priority after the world is up). What changed for loading:

* `world.gd` builds **progressively** when entered through `Game.new_game/continue_game` (loading screen up):
  every part scene is requested with `ResourceLoader.load_threaded_request` up front, then one part is
  instanced per frame while the World node is `PROCESS_MODE_DISABLED` (nothing ticks half-built).
  Dev harnesses/tests (which instance `world.tscn` directly) keep the synchronous build.
* `Game.loading_progress` / `loading_stage` drive a determinate progress line and a stage caption ("Raising the
  mountain…", "Growing the forest…") on the loading screen (`docs/shots/release_loading_screen.jpg`).
* Every build prints `[World] parts built in N ms (Sky …, Terrain …)` and `[Game] world built in N ms`.

On lavapipe the windowed first world frame is dominated by Vulkan pipeline compilation (world build 58.8 s
windowed vs 3.6 s headless); on real GPUs Godot's pipeline cache/ubershaders keep that to seconds.

## 3. Sizes

| | Size |
|---|---:|
| `assets/` source (PNG/OGG/GLB/raw) | 406 MB |
| `.godot/imported` (desktop + mobile compressed textures) | 578 MB |
| Linux export: `ThinAir.x86_64` + `ThinAir.pck` | 73.5 MB + 389 MB |
| **Android APK (arm64, release, signed)** | **382 MB** (ETC2/ASTC textures 247 MB, OGG 63 MB, libgodot 71 MB) |
| Largest single files | impostor albedo/normal arrays 18.2 MB each, `height.f32` 16.8 MB, terrain albedo/normal arrays 12.6 MB each |
| VRAM (lavapipe, PERF line) | Mobile 621–624 MB, Forward+ high 972–990 MB |

APK is far under the 1.5 GB limit; no desktop (S3TC/BPTC) texture is packed into the APK.

## 4. Release (export) verification

New boot options (user args after `--`; `Game.boot_args`):
`--autostart` (main menu starts a new game immediately), `--autoquit=N` (quit N s after the world is ready and
print one line `BOOT OK|ERRORS world_build_ms=… draw_calls=… primitives=… fps=… vram_mb=… script_errors=…
errors=… warnings=…`, exit code 1 on errors; errors are counted by an `OS.add_logger()` Logger),
`--autoshot=/abs.png` (save the last frame). `application/run/flush_stdout_on_print=true` so release logs are
not lost when the process is killed.

```
godot --headless --path thin-air --import
godot --headless --path thin-air --export-release "Linux" build/linux/ThinAir.x86_64
timeout 600 ./thin-air/build/linux/ThinAir.x86_64 --headless -- --autostart --autoquit=20
  -> BOOT OK world_build_ms=3603 … script_errors=0 errors=0 warnings=0   (exit 0)
DISPLAY=:99 ./thin-air/build/linux/ThinAir.x86_64 --resolution 960x540 --write-movie /tmp/b/f.png --fixed-fps 30 \
  -- --autostart --autoquit=1 --autoshot=/tmp/b/shot.png
  -> BOOT OK world_build_ms=58773 draw_calls=555 primitives=1345305 vram_mb=1018 script_errors=0 errors=0 (exit 0)
GODOT_ANDROID_KEYSTORE_RELEASE_{PATH,USER,PASSWORD}=… godot --headless --path thin-air --export-release "Android" build/android/ThinAir.apk
  -> 382 MB, signed with apksigner (v2+v4 idsig)
```

Export-only issues checked: raw data (`*.f32`, `*.bin`, every `*.json` read with FileAccess) is in the preset
`include_filter`; `assets/CREDITS.md` (read raw by the credits roll) was **missing from the pack** and is now
included; the editor-only `EditorScenePostImport` script (`scenes/props/prop_import.gd`), the props lineup dev
scene, `tmp_probe/`, `docs/`, `tools/` and `build/` are excluded. No runtime `Image.load` of PNGs, no
`DirAccess` listing of `res://` outside dev tools, no editor APIs in shipped scripts. The exported pack was
listed (3,145 files) to confirm the raw files are present. Exit-time warnings only: a few leaked RIDs /
ObjectDB instances at shutdown (harmless).

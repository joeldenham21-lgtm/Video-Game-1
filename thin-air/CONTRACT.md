# THIN AIR — Engineering Contract (v1)

Read `DESIGN.md` first. Several agents build this game in parallel, each owning a workstream. This
contract fixes the shared interfaces. **If you need to deviate from a signature, don't — add a new method
instead and note it in your report.** When another system you depend on is not built yet, code against
this contract and guard with `has_method()` / null checks so the game still runs.

## 0. Environment & tools (already installed in the container)

| Tool | Command | Notes |
|---|---|---|
| Godot 4.7.2 | `godot` | `godot --headless --path thin-air --import` to import; tests via `res://tests/test_runner.tscn` (§9) |
| Screenshots | `Xvfb :99 &` then `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/x.png --fixed-fps 30 --quit-after 90 --resolution 1280x720 <scene or args>` | lavapipe CPU Vulkan: slow (≈5–10 fps) but correct. Also test `--rendering-method mobile`. |
| Blender 4.0.2 | `blender -b -P script.py -- args` | glTF export, Cycles CPU baking/rendering |
| Python 3.11 | numpy, scipy, PIL | texture/terrain/audio generation |
| Audio | `fluidsynth`, soundfonts `/usr/share/sounds/sf3/MuseScore_General_Full.sf3`, `/usr/share/sounds/sf2/FluidR3_GM.sf2`, `sox`, `ffmpeg` (libvorbis) | |
| TTS | `/opt/piper/piper/piper --model /opt/piper/en-us-libritts-high.onnx --speaker N` | 904 LibriTTS speakers (CC BY 4.0) |
| Android/Win export | `godot --headless --path thin-air --export-release "Android" build/x.apk` | presets in `export_presets.cfg` |

Screenshot harness: `res://scenes/dev/shot.tscn` (see header of `src/dev/shot.gd` for args: `--poi=`, `--pos=x,g,z`,
`--look=yaw,pitch`, `--hours=`, `--weather=`, `--preset=`, `--perf`). The last written PNG is the settled frame.
If Xvfb isn't running: `pgrep Xvfb || (Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &)`.
Only one agent should run a heavy render at a time is NOT guaranteed — keep renders short (≤ 120 frames,
≤ 1280×720).

## 1. Project layout (`thin-air/` is the Godot project root = `res://`)

```
src/autoload/     singletons (see §3)             src/world/      terrain renderer, water, world root
src/sky/          sky, weather FX, lighting        src/vegetation/ trees, grass, rocks, scatter, harvest
src/player/       controller, camera, viewmodel    src/survival/   vitals, status effects
src/items/        inventory, crafting, item nodes  src/building/   build mode, buildables
src/fauna/        animal AI, spawner               src/story/      objectives, logs, triggers, POIs, cinematics
src/ui/           HUD, menus, touch controls       src/audio/      audio helpers (Audio autoload lives in autoload/)
src/common/       small shared helpers/classes
scenes/…          .tscn mirrors src/ folders       assets/…        generated art/audio (see §7)
data/             JSON game data                   tools/          generators (Python/Blender) — has .gdignore
tests/            headless test scripts             docs/           notes, screenshots (.gdignore)
```

## 2. Conventions

- **GDScript only**, static typing everywhere (`var x: float`, typed arrays, `-> void`). Tabs for indentation.
  `class_name` for reusable classes. snake_case files, PascalCase classes. No C#, no GDExtensions.
- Godot 4.7 APIs only. The project must load with **zero script errors** under `godot --headless --import`
  and when running scenes. Check `get_tree()` / nodes for null in `_ready` of autoloads (they run before scenes).
- **Units**: metres, seconds, °C, kg. **Y = altitude above sea level** (valley ≈ 1,300, summit 3,452).
  North = −Z, East = +X. Map spans x, z ∈ [−1536, 1536].
- **No per-frame allocations** in hot paths; cache node refs; use `PackedFloat32Array` etc. for bulk data.
- **Mobile first**: every feature must have a cheaper path when `Settings.is_mobile()` / lower presets.
  Use `MultiMeshInstance3D` for anything repeated > 20 times, `visibility_range_*` for LOD/culling,
  alpha **scissor** (never blend) for foliage, ≤ 2 real-time omni lights near the player (fire + torch).
- Deterministic world content: seed everything (`RandomNumberGenerator.seed = hash(...)`).
- Physics engine: **Jolt**. Physics tick 60 Hz.
- Input: use the named actions in §5 only (never raw keycodes), so gamepad + touch work.
- Pausing: gameplay nodes use `process_mode = PROCESS_MODE_PAUSABLE` (default); UI that must work while
  paused uses `PROCESS_MODE_ALWAYS`. `Game.set_paused()` calls `get_tree().paused`.
- Groups: `"persistent"` (save system), `"interactable"`, `"damageable"`, `"harvestable"`, `"heat_source"`,
  `"shelter"`, `"creature"`, `"buildable"`, `"poi"`.

### Physics layers (named in project.godot)
| # | name | used by |
|---|---|---|
| 1 | world | terrain, rocks, static structures |
| 2 | player | player body |
| 3 | creatures | animals |
| 4 | items | pickups, physics props, felled logs |
| 5 | interact | interaction-only shapes (Area3D/StaticBody3D) |
| 6 | water | water volumes (Area3D) |
| 7 | building | player-built structures (collide like world) |
| 8 | triggers | story/zone Area3Ds |
| 9 | projectiles | arrows, flares |
| 10 | vegetation | tree trunks near the player (collide like world) |

Player collides with 1, 3, 7, 10 (and 4 for heavy props). Interaction ray hits 1, 4, 5, 7, 10.

## 3. Autoloads (order matters) — `src/autoload/*.gd`

### `Events` (events.gd) — global signal bus, no logic
```gdscript
signal notification(text: String, kind: StringName)        # kinds: &"info", &"item", &"warning", &"objective", &"discovery", &"blueprint"
signal interaction_prompt(text: String, hold_time: float)  # text "" hides; hold_time 0 = tap
signal interaction_progress(t: float)                      # 0..1 while holding interact; -1 cancel
signal item_picked_up(id: StringName, count: int)
signal item_dropped(id: StringName, count: int)
signal item_crafted(id: StringName, count: int)
signal item_consumed(id: StringName)
signal inventory_changed()
signal equipment_changed(slot: StringName, id: StringName)  # id &"" when unequipped
signal active_item_changed(id: StringName)
signal blueprint_unlocked(id: StringName)
signal scan_completed(target_id: StringName)
signal player_damaged(amount: float, type: StringName, source: Node)
signal player_died(cause: StringName)
signal player_respawned()
signal status_effect_changed(id: StringName, active: bool)
signal footstep(surface: StringName, position: Vector3, intensity: float)   # intensity 0..1 (sneak..sprint)
signal player_landed(fall_speed: float, surface: StringName)
signal noise_emitted(position: Vector3, radius: float, source: Node)        # AI hearing
signal poi_discovered(poi_id: StringName)
signal zone_entered(zone_id: StringName)                                   # biome/area changes
signal objective_added(id: StringName, text: String)
signal objective_completed(id: StringName)
signal log_found(log_id: StringName)
signal radio_message(message_id: StringName)
signal subtitle(speaker: String, text: String, duration: float)
signal weather_changed(weather: StringName)
signal hour_passed(hour: int)
signal day_started(day: int)
signal structure_built(buildable_id: StringName, node: Node3D)
signal structure_destroyed(buildable_id: StringName, node: Node3D)
signal tree_felled(position: Vector3, species: StringName)
signal resource_harvested(id: StringName, position: Vector3)
signal animal_killed(species: StringName, position: Vector3)
signal game_started(is_new: bool)
signal game_saved(slot: int)
signal game_loaded(slot: int)
signal settings_changed()
signal ui_screen_opened(screen: StringName)   # inventory, crafting, journal, map, pause, build, dialog…
signal ui_screen_closed(screen: StringName)
signal cinematic_started(id: StringName)
signal cinematic_ended(id: StringName)
signal sleep_started(hours: float)
signal sleep_ended()
```

### `Settings` (settings.gd)
```gdscript
const PRESETS: Dictionary          # &"mobile_low", &"mobile_high", &"low", &"medium", &"high", &"ultra" -> values
var preset: StringName
var values: Dictionary             # see keys below
func get_value(key: StringName, default: Variant = null) -> Variant
func set_value(key: StringName, value: Variant, apply_now := true) -> void
func apply_preset(p: StringName) -> void
func apply() -> void               # applies window/viewport/audio settings, emits Events.settings_changed
func save() -> void                # user://settings.cfg
func is_mobile() -> bool           # Android/iOS or touch-first
func is_forward_plus() -> bool
```
Keys (StringName): `render_scale` (0.4–1.0), `upscaler` (&"bilinear", &"fsr", &"fsr2"), `msaa` (0,2,4),
`taa` (bool), `fxaa` (bool), `shadow_quality` (0–3), `shadow_distance` (m), `view_distance` (m, camera far),
`lod_bias` (float, mesh LOD threshold multiplier), `vegetation_density` (0–1), `grass_distance` (m),
`tree_impostor_distance` (m), `volumetric_fog` (bool), `ssao` (bool), `ssil` (bool), `ssr` (bool),
`glow` (bool), `sky_quality` (0–2), `particles` (0–2), `dynamic_resolution` (bool), `target_fps` (int),
`max_fps` (int), `vsync` (bool), `fov` (deg), `mouse_sensitivity`, `look_sensitivity_touch`,
`look_sensitivity_pad`, `invert_y`, `head_bob` (0–1), `vol_master`, `vol_music`, `vol_sfx`,
`vol_ambience`, `vol_voice` (0–1 linear), `subtitles` (bool), `show_fps` (bool), `touch_ui_scale` (0.7–1.4),
`difficulty` (&"explorer", &"survivor", &"whiteout"), `language` (&"en").
Systems read what they need on `_ready` and on `Events.settings_changed`.

### `ItemDB` (item_db.gd) — static data from `data/*.json`
```gdscript
func get_item(id: StringName) -> Dictionary        # {} if unknown. Keys in §6.
func has_item(id: StringName) -> bool
func all_items() -> Array[StringName]
func get_recipe(id: StringName) -> Dictionary
func recipes_for_station(station: StringName) -> Array[Dictionary]
func get_buildable(id: StringName) -> Dictionary
func all_buildables() -> Array[StringName]
func get_icon(id: StringName) -> Texture2D          # falls back to a generic icon
```

### `TerrainData` (terrain_data.gd) — CPU heightfield + masks, pure queries
```gdscript
const SIZE := 2049; const CELL := 1.5; const WORLD_SIZE := 3072.0; const HALF := 1536.0
var heights: PackedFloat32Array                    # SIZE*SIZE, index = j*SIZE + i ; x = -HALF + i*CELL, z = -HALF + j*CELL
var height_texture: Texture2D                      # FORMAT_RF, for shaders (sample with texelFetch / manual bilinear)
var normal_texture: Texture2D                      # RGB = world normal * 0.5 + 0.5 (Y up)
var mask_texture: Texture2D                        # R snow, G rock, B alpine grass/meadow, A forest density
var layout: Dictionary                             # parsed data/world_layout.json
var min_height: float; var max_height: float
func is_loaded() -> bool
func get_height(x: float, z: float) -> float       # bilinear, clamps to bounds
func get_normal(x: float, z: float) -> Vector3
func get_slope_deg(x: float, z: float) -> float
func get_masks(x: float, z: float) -> Color
func get_surface(x: float, z: float) -> StringName # &"snow",&"rock",&"scree",&"grass",&"forest",&"dirt",&"ice",&"gravel"
func get_biome(x: float, z: float) -> StringName   # &"valley",&"forest",&"subalpine",&"alpine",&"glacier",&"summit"
func get_water_level(x: float, z: float) -> float  # surface Y of lake/river here, or -INF if none
func is_in_water(p: Vector3) -> bool
func get_poi(id: StringName) -> Dictionary         # {id, name, position: Vector3, radius, ...} from layout
func all_pois() -> Array[Dictionary]
func in_bounds(x: float, z: float, margin := 0.0) -> bool
func raycast(from: Vector3, dir: Vector3, max_dist: float) -> Dictionary  # {hit: bool, position, normal} vs heightfield
```

### `Climate` (climate.gd) — time, weather, temperature, wind
```gdscript
var day: int                        # starts at 1
var hours: float                    # 0..24 (game starts 17.3 = dusk in the prologue)
var day_length_minutes: float = 40.0
var time_scale: float = 1.0         # >1 while sleeping
var weather: StringName             # &"clear",&"cloudy",&"overcast",&"snow",&"blizzard",&"fog"
var cloud_cover: float              # 0..1  (smoothed, current)
var precipitation: float            # 0..1
var fog_density: float              # 0..1 (valley fog/whiteout factor)
var wind_speed: float               # m/s at 2,000 m reference, increases with altitude/exposure
var wind_direction: Vector3         # normalized, horizontal, direction wind blows TOWARD
var locked: bool                    # story can freeze weather/time
func get_sun_direction() -> Vector3 # unit vector from ground toward the sun (y<0 at night)
func get_moon_direction() -> Vector3
func get_daylight() -> float        # 0 night .. 1 full day
func get_air_temperature(pos: Vector3) -> float     # °C incl. lapse rate & weather
func get_wind_at(pos: Vector3) -> Vector3           # m/s vector
func get_heat_at(pos: Vector3) -> float             # extra °C from heat_source group nodes
func get_shelter_at(pos: Vector3) -> float          # 0..1 from shelter group Area3Ds
func get_felt_temperature(pos: Vector3, insulation: float, wet: bool) -> float
func set_weather(w: StringName, transition_s := 60.0) -> void
func advance_time(hours_to_add: float) -> void
func get_time_string() -> String    # "17:24"
```
Heat sources: nodes in group `"heat_source"` expose `var heat_radius: float`, `var heat_celsius: float`,
`func is_heat_active() -> bool`. Shelters: Area3D in group `"shelter"` with `var shelter_factor: float` (0..1,
1 = fully enclosed interior) — Climate checks overlap by distance/AABB, no physics query needed.

Global shader parameters (declared in project.godot, updated by Climate/sky every frame):
`wind_direction` (vec3), `wind_strength` (float 0..1+), `time_of_day` (float hours), `snow_cover` (float 0..1
extra global snow dusting), `player_position` (vec3, set by Player — grass bending/fade), `wetness` (float).

### `Game` (game.gd)
```gdscript
enum State { BOOT, MENU, LOADING, PLAYING, PAUSED, CINEMATIC, DEAD }
var state: State
var player: Node3D      # Player (CharacterBody3D) when in world, else null
var world: Node3D       # world root when loaded
var flags: Dictionary   # persistent story/world flags: StringName -> Variant
var difficulty: StringName
var is_new_game: bool
func new_game() -> void            # loads scenes/world/world.tscn, spawns player at crash site, starts prologue
func continue_game() -> void       # loads world then Save.load_game(0)
func quit_to_menu() -> void
func set_paused(p: bool) -> void
func is_playing() -> bool          # state == PLAYING
func set_flag(key: StringName, value: Variant = true) -> void
func get_flag(key: StringName, default: Variant = false) -> Variant
func notify(text: String, kind: StringName = &"info") -> void   # → Events.notification
func register_player(p: Node3D) -> void
func register_world(w: Node3D) -> void
```

### `Audio` (audio.gd)
```gdscript
func play_sfx(id: StringName, position: Variant = null, volume_db := 0.0, pitch := 1.0) -> void
    # position: Vector3 → 3D pooled player; null → non-positional. Unknown ids are ignored (warning once).
func play_sfx_attached(id: StringName, node: Node3D, volume_db := 0.0) -> AudioStreamPlayer3D   # follows node
func play_loop(id: StringName, node: Node3D, volume_db := 0.0) -> AudioStreamPlayer3D           # caller stops/frees
func play_ui(id: StringName) -> void
func play_voice(line_id: StringName) -> float          # radio/log line; returns duration; also emits Events.subtitle
func stop_voice() -> void
func set_music_state(state: StringName) -> void        # &"menu",&"explore",&"night",&"forest",&"alpine",&"station",&"danger",&"blizzard",&"summit",&"finale",&"silence"
func play_stinger(id: StringName) -> void              # &"discovery",&"danger",&"objective",&"death",&"blueprint"
func set_environment_reverb(kind: StringName) -> void  # &"outdoor",&"forest",&"interior",&"cave",&"station"
func set_muffled(amount: float) -> void                # 0..1 (underwater, blackout)
```
Audio catalog: `data/sfx.json`: `id -> {"files": ["res://assets/audio/sfx/..ogg", ...], "bus": "SFX",
"volume_db": 0, "pitch_var": 0.05, "max_distance": 60, "unit_size": 4}`. Voice catalog: `data/voice.json`
`line_id -> {"file", "speaker", "text", "radio": bool}`. Buses: Master → {Music, SFX, Ambience, Voice, UI};
SFX and Ambience send to "Reverb".
**Standard SFX ids** other systems may call (Audio agent must provide them all):
footsteps `step_<surface>` (snow, rock, scree, grass, forest, dirt, ice, gravel, wood, metal, water),
`land_soft`, `land_hard`, `jump`, `swim_stroke`, `splash`, `breath_exert`, `breath_cold`, `breath_altitude`,
`heartbeat`, `hurt`, `death`, `eat`, `drink`, `pickup`, `drop`, `craft`, `craft_done`, `equip`, `inventory_open`,
`inventory_close`, `ui_click`, `ui_hover`, `ui_back`, `notify`, `blueprint`, `scan_loop`, `scan_done`,
`axe_swing`, `axe_hit_wood`, `axe_hit_stone`, `knife_hit`, `pick_hit_stone`, `tree_crack`, `tree_fall`,
`tree_impact`, `log_split`, `bow_draw`, `bow_release`, `arrow_hit`, `spear_throw`, `fire_ignite`, `fire_loop`,
`torch_loop`, `flare_ignite`, `flare_loop`, `flaregun_fire`, `build_place`, `build_hammer`, `build_invalid`,
`door_open`, `door_close`, `metal_creak`, `wood_creak`, `ice_crack`, `avalanche`, `thunder`, `radio_static`,
`radio_beep`, `generator_start`, `generator_loop`, `wolf_howl`, `wolf_growl`, `wolf_bark`, `wolf_attack`,
`wolf_yelp`, `bear_roar`, `bear_huff`, `bear_attack`, `deer_bark`, `deer_flee`, `goat_bleat`, `hare_squeal`,
`raven_caw`, `eagle_cry`, `bird_chirp`, `helicopter_loop`, `water_stream_loop`, `waterfall_loop`,
`lake_lap_loop`, `wind_loop` (managed internally), `o2_hiss`, `climb_grab`, `crampon_step`.

### `Save` (save_manager.gd)
```gdscript
func save_game(slot := 0) -> bool
func load_game(slot := 0) -> bool
func has_save(slot := 0) -> bool
func delete_save(slot := 0) -> void
func get_save_info(slot := 0) -> Dictionary   # {day, hours, location, playtime, timestamp}
```
Every persistent node: in group `"persistent"`, implements `func get_save_key() -> String`,
`func save_state() -> Dictionary`, `func load_state(data: Dictionary) -> void`. Autoloads Game, Climate,
Story are saved explicitly. Values must be JSON-safe (convert Vector3 → [x,y,z]; use `SaveUtil.v3()` /
`SaveUtil.to_v3()` in `src/common/save_util.gd`). Dynamically spawned things (built structures, dropped
items, felled logs, killed animals' corpses) are saved by their owning manager, not by themselves.

### `Story` (story.gd)
```gdscript
var objectives: Array[Dictionary]      # {id, text, done}
var found_logs: Array[StringName]
var discovered_pois: Array[StringName]
func start_prologue() -> void
func add_objective(id: StringName, text: String) -> void
func complete_objective(id: StringName) -> void
func has_objective(id: StringName) -> bool
func is_objective_done(id: StringName) -> bool
func find_log(log_id: StringName) -> void    # adds to journal, plays voice if any
func discover_poi(poi_id: StringName) -> void
func trigger(event_id: StringName) -> void   # generic story hook used by world triggers/interactables
```
Logs data: `data/logs.json` `log_id -> {"title", "author", "date", "text", "voice": line_id|null}`.

## 4. Scenes & nodes

- `scenes/main.tscn` — boot scene (main menu). `scenes/world/world.tscn` — the world root
  (script `src/world/world.gd`, calls `Game.register_world(self)`), containing:
  `Terrain` (src/world/terrain.gd), `Water`, `Sky` (WorldEnvironment + DirectionalLight3D "Sun" + moon light
  — owned by src/sky), `Vegetation`, `Structures` (POIs), `Fauna`, `Items` (dropped/world pickups root),
  `Building` (player-built root), `Player` (instance of scenes/player/player.tscn), `HUD` (scenes/ui/hud.tscn).
- The **Sun** is a `DirectionalLight3D` named `Sun` in group `"sun"`; only Sky code changes it. Environment is
  owned by Sky code; other systems must not replace `WorldEnvironment.environment` (Settings toggles
  individual env features through `Settings.apply()` → Sky listens and updates).
- Player: `scenes/player/player.tscn`, root `CharacterBody3D` class `Player` (src/player/player.gd).
  Public API:
```gdscript
var inventory: Inventory              # src/items/inventory.gd (class_name Inventory, RefCounted)
var equipment: Dictionary             # slot StringName -> item id StringName (&"" empty)
var hotbar: Array[StringName]         # 6 entries, item ids or &""
var active_slot: int                  # -1 = empty hands
var vitals: Vitals                    # src/survival/vitals.gd (class_name Vitals, Node child "Vitals")
var is_swimming: bool; var is_climbing: bool; var is_crouching: bool; var is_sprinting: bool
var is_sheltered: float               # 0..1 cached from Climate
func get_camera() -> Camera3D
func get_eye_position() -> Vector3
func get_look_direction() -> Vector3
func teleport(pos: Vector3, yaw_deg := 0.0) -> void
func set_input_enabled(enabled: bool) -> void        # UI/cinematics
func get_active_item() -> StringName                 # &"" for empty hands
func select_hotbar(index: int) -> void
func equip(id: StringName) -> bool                   # clothing/gear into its slot, or tool into hands
func unequip(slot: StringName) -> void
func get_insulation() -> float                       # summed clothing warmth (°C equivalent)
func get_windproof() -> float                        # 0..1
func has_gear(tag: StringName) -> bool               # &"crampons", &"ice_axe", &"o2_mask", &"goggles", &"rope"
func take_damage(amount: float, type: StringName, source: Node = null, hit_position := Vector3.ZERO) -> void
func heal(amount: float) -> void
```
- **Vitals** (`class_name Vitals`): `var health, food, water, warmth, oxygen, stamina: float` (0..100),
  `var max_health: float`, `var body_temp: float` (°C), `var effects: Dictionary` (id → {time: float,
  strength: float}), `func add_effect(id, duration, strength := 1.0)`, `func remove_effect(id)`,
  `func has_effect(id) -> bool`, `func consume(item_id: StringName)` (applies ItemDB food/drink/medical values),
  `func use_stamina(amount) -> bool`, `func is_dead() -> bool`, `signal died(cause: StringName)`.
- **Interactables**: any `CollisionObject3D` in group `"interactable"` (or whose parent is) implementing
  `func get_interact_prompt(player: Node) -> String` ("" = not interactable now),
  `func interact(player: Node) -> void`, optional `func get_interact_hold_time() -> float`.
  The player's ray (layers 1,4,5,7,10, 2.6 m) checks the collider, then its parent, for these methods.
- **Damageable**: `func take_damage(amount: float, type: StringName, source: Node = null, hit_position := Vector3.ZERO) -> void`.
  Damage types: &"blunt", &"cut", &"pierce", &"bite", &"claw", &"fall", &"cold", &"hunger", &"thirst",
  &"hypoxia", &"fire", &"drown", &"bleed".
- **Harvestable** (trees, rocks, ore, ice, bushes, corpses): `func harvest_hit(tool_id: StringName, power: float,
  hit_position: Vector3, hit_normal: Vector3, player: Node) -> void` and `func get_harvest_tool_type() -> StringName`
  (&"axe", &"pickaxe", &"knife", &"hand").
- **Pickups**: `scenes/items/pickup.tscn` (`src/items/pickup.gd`, class `ItemPickup`, RigidBody3D layer 4)
  with `@export var item_id: StringName`, `@export var count := 1`. Static world pickups use the same scene with
  `freeze = true`. Visual = `ItemDB.get_item(id).model` glb if present, else a generic bundle mesh.

## 5. Input actions (defined in project.godot — keyboard/mouse + gamepad)

`move_forward, move_back, move_left, move_right, look_up, look_down, look_left, look_right` (pad right stick),
`jump, sprint, crouch, use` (LMB/RT), `aim` (RMB/LT), `interact` (E/X), `inventory` (Tab/I/Y), `journal` (J),
`map` (M), `build` (B), `pause` (Esc/Start), `hotbar_1..hotbar_6`, `hotbar_next`, `hotbar_prev` (wheel/RB/LB),
`drop` (G), `reload` (R), `torch_toggle` (F), `photo_mode` (P/F12), `ui_accept/ui_cancel` (built-in).
Touch controls (src/ui/touch_controls.gd) inject the same actions via `Input.action_press/release` and
emit look deltas through `TouchLook` (a static accumulator the player reads: `TouchLook.consume() -> Vector2`
in `src/common/touch_look.gd`).

## 6. Data formats

`data/items.json` — `{ "<id>": { "name", "desc", "category", "stack", "weight", "icon", "model", "tags": [],
  "equip_slot": ""|"hand"|"head"|"face"|"body"|"legs"|"hands"|"feet"|"back",
  "tool": {"type": "axe"|"pickaxe"|"knife"|"spear"|"bow"|"torch"|"ice_axe"|"flare"|"flaregun"|"scanner"|"canteen"|"binoculars"|"hammer"|"lantern"|"map",
           "damage", "chop", "mine", "range", "stamina", "cooldown", "durability"},
  "food": {"calories", "water", "warmth", "health", "stamina", "raw": bool, "spoil_hours"},
  "clothing": {"insulation", "windproof", "waterproof"},
  "fuel": {"burn_minutes"}, "gear": ["crampons"|"ice_axe"|"o2_mask"|"goggles"|"rope"] } }`
Categories: resource, food, drink, tool, weapon, ammo, clothing, medical, light, fuel, quest, placeable.
`data/recipes.json` — `[ {"id", "result", "count", "ingredients": {"id": n}, "tools": ["knife"],
  "station": "hand"|"campfire"|"workbench"|"fabricator", "time", "requires_blueprint": bool, "category"} ]`
`data/buildables.json` — `{ "<id>": {"name", "scene", "cost": {"log": 2}, "snap": "grid"|"free"|"wall"|"floor",
  "category", "icon", "desc"} }`
`data/world_layout.json` — written by the terrain generator: `{"pois": [{"id","name","x","y","z","radius","flat_radius"}],
  "lakes": [{"id","x","z","radius","level","polygon"?}], "rivers": [{"id","points": [[x,y,z,width]...]}],
  "trails": [...], "spawn": {"x","y","z","yaw"}, "zones": [...] }`

## 7. Assets

- Models: glTF binary (`.glb`) from Blender scripts in `tools/blender/`. Real-world scale, +Y up, −Z forward.
  Name meshes/materials meaningfully. Provide LODs through Godot's auto-LOD (import default) unless noted.
- Textures: `assets/textures/<set>/<set>_albedo.png` (+ `_normal.png` OpenGL-style/Y+, `_orm.png` =
  R occlusion, G roughness, B metallic, optional `_height.png`). 1024² default, 2048² for terrain & hero assets.
  All tileable textures must be seamless. Import as VRAM compressed with mipmaps.
- Materials: `assets/materials/*.tres` (StandardMaterial3D or ShaderMaterial) — shared library, reuse!
- Audio: `.ogg` (Vorbis, 44.1 kHz; mono for positional SFX, stereo for music/ambience beds).
- Every generator script must be re-runnable and deterministic and documented in `tools/README.md`.
- Licenses: only our own generated content, CC0, or OFL fonts. Record sources in `assets/CREDITS.md`.

## 8. Performance budgets (verify with the `perf` overlay / `Performance` monitors)

| Metric (worst view) | Mobile (S25 Ultra) | Desktop High |
|---|---|---|
| Draw calls | ≤ 600 | ≤ 2,500 |
| Visible triangles | ≤ 1.5 M | ≤ 6 M |
| Shadow-casting draw calls | ≤ 150 | ≤ 600 |
| Script time / frame | ≤ 3 ms | ≤ 3 ms |
| VRAM | ≤ 1.5 GB | ≤ 3.5 GB |

Report `Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)` /
`RENDER_TOTAL_PRIMITIVES_IN_FRAME` from your screenshot runs.

## 9. Testing & definition of done (every workstream)

1. `godot --headless --path thin-air --import` completes with **no errors from your files**.
2. A headless test `tests/test_<area>.gd` (`extends TestCase`, implement `func run() -> void`, call `check(cond, msg)`)
   covers your pure logic. Run: `timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_<area>.gd`
   (prints `PASS`/`FAIL` lines and `RESULT PASS|FAIL`, exit code 0/1). **Gotchas:** (a) do NOT use `-s` SceneTree
   scripts for anything touching autoloads/class_names that reference autoloads — they compile before autoloads
   exist; (b) after adding a new `class_name`, run `godot --headless --path thin-air --import` to refresh the class
   cache; (c) always wrap godot runs in `timeout` — a runtime error does not quit the process.
3. For visual work, render screenshots (Forward+ and Mobile) to `thin-air/docs/shots/<area>_*.png`, LOOK at them,
   and iterate until they look realistic. Keep only a few final screenshots (≤ 6 per area, ≤ 1280×720, jpg ok).
4. Commit your work (see your task prompt for branch rules). Never commit `.godot/`, `build/`, or temp files.
5. Final report: what you built, files, public APIs added beyond this contract, known gaps, and measured perf.

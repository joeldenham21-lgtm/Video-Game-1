# Configures project.godot deterministically (input map, layers, autoloads, globals, rendering).
# Run: godot --headless --path thin-air -s res://../thin-air/tools/godot/setup_project.gd  (see tools/README.md)
extends SceneTree

func key(k: Key) -> InputEventKey:
	var e := InputEventKey.new(); e.physical_keycode = k; return e

func mb(b: MouseButton) -> InputEventMouseButton:
	var e := InputEventMouseButton.new(); e.button_index = b; return e

func jb(b: JoyButton) -> InputEventJoypadButton:
	var e := InputEventJoypadButton.new(); e.button_index = b; return e

func ja(axis: JoyAxis, v: float) -> InputEventJoypadMotion:
	var e := InputEventJoypadMotion.new(); e.axis = axis; e.axis_value = v; return e

func action(name: String, events: Array, deadzone := 0.2) -> void:
	ProjectSettings.set_setting("input/" + name, {"deadzone": deadzone, "events": events})

func _init() -> void:
	var ps := ProjectSettings
	# --- Autoloads (order matters)
	var autoloads := [
		["Events", "src/autoload/events.gd"], ["Settings", "src/autoload/settings.gd"],
		["ItemDB", "src/autoload/item_db.gd"], ["TerrainData", "src/autoload/terrain_data.gd"],
		["Climate", "src/autoload/climate.gd"], ["Game", "src/autoload/game.gd"],
		["Audio", "src/autoload/audio.gd"], ["Save", "src/autoload/save_manager.gd"],
		["Story", "src/autoload/story.gd"],
	]
	for a in autoloads:
		ps.set_setting("autoload/" + a[0], "*res://" + a[1])
	# --- Display
	ps.set_setting("display/window/size/viewport_width", 1920)
	ps.set_setting("display/window/size/viewport_height", 1080)
	ps.set_setting("display/window/size/window_width_override", 1600)
	ps.set_setting("display/window/size/window_height_override", 900)
	ps.set_setting("display/window/stretch/mode", "canvas_items")
	ps.set_setting("display/window/stretch/aspect", "expand")
	ps.set_setting("display/window/handheld/orientation", 4)  # sensor landscape
	ps.set_setting("display/window/vsync/vsync_mode", 1)
	# --- Rendering
	ps.set_setting("rendering/renderer/rendering_method", "forward_plus")
	ps.set_setting("rendering/renderer/rendering_method.mobile", "mobile")
	ps.set_setting("rendering/textures/vram_compression/import_etc2_astc", true)
	ps.set_setting("rendering/textures/vram_compression/import_s3tc_bptc", true)
	ps.set_setting("rendering/lights_and_shadows/directional_shadow/size", 4096)
	ps.set_setting("rendering/lights_and_shadows/directional_shadow/size.mobile", 2048)
	ps.set_setting("rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality", 3)
	ps.set_setting("rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality.mobile", 1)
	ps.set_setting("rendering/lights_and_shadows/positional_shadow/atlas_size", 2048)
	ps.set_setting("rendering/lights_and_shadows/positional_shadow/atlas_size.mobile", 1024)
	ps.set_setting("rendering/mesh_lod/lod_change/threshold_pixels", 1.0)
	ps.set_setting("rendering/environment/defaults/default_clear_color", Color(0.05, 0.06, 0.08))
	ps.set_setting("rendering/anti_aliasing/quality/msaa_3d.mobile", 1)
	ps.set_setting("rendering/occlusion_culling/use_occlusion_culling", false)
	ps.set_setting("rendering/limits/global_shader_variables/buffer_size", 65536)
	# --- Physics
	ps.set_setting("physics/3d/physics_engine", "Jolt Physics")
	ps.set_setting("physics/common/physics_ticks_per_second", 60)
	ps.set_setting("physics/common/max_physics_steps_per_frame", 4)
	var layers := ["world", "player", "creatures", "items", "interact", "water", "building", "triggers", "projectiles", "vegetation"]
	for i in layers.size():
		ps.set_setting("layer_names/3d_physics/layer_%d" % (i + 1), layers[i])
	# --- Audio
	ps.set_setting("audio/buses/default_bus_layout", "res://assets/audio/bus_layout.tres")
	ps.set_setting("audio/general/3d_panning_strength", 0.75)
	# --- GUI
	ps.set_setting("gui/theme/custom_font", "res://assets/fonts/IBMPlexSans-Regular.ttf")
	ps.set_setting("gui/common/snap_controls_to_pixels", true)
	ps.set_setting("input_devices/pointing/emulate_mouse_from_touch", true)
	ps.set_setting("input_devices/pointing/emulate_touch_from_mouse", false)
	# --- Global shader params
	var globals := {
		"wind_direction": ["vec3", Vector3(1, 0, 0)], "wind_strength": ["float", 0.3],
		"time_of_day": ["float", 12.0], "snow_cover": ["float", 0.0], "player_position": ["vec3", Vector3.ZERO],
		"wetness": ["float", 0.0], "sun_direction": ["vec3", Vector3(0, 1, 0)], "fog_color": ["color", Color(0.7, 0.75, 0.8)],
	}
	for k in globals:
		ps.set_setting("shader_globals/" + k, {"type": globals[k][0], "value": globals[k][1]})
	# --- Export include filter for raw data
	# --- Input
	var ax := JOY_AXIS_LEFT_X; var ay := JOY_AXIS_LEFT_Y
	action("move_forward", [key(KEY_W), key(KEY_UP), ja(ay, -1.0)])
	action("move_back", [key(KEY_S), key(KEY_DOWN), ja(ay, 1.0)])
	action("move_left", [key(KEY_A), key(KEY_LEFT), ja(ax, -1.0)])
	action("move_right", [key(KEY_D), key(KEY_RIGHT), ja(ax, 1.0)])
	action("look_up", [ja(JOY_AXIS_RIGHT_Y, -1.0)], 0.15)
	action("look_down", [ja(JOY_AXIS_RIGHT_Y, 1.0)], 0.15)
	action("look_left", [ja(JOY_AXIS_RIGHT_X, -1.0)], 0.15)
	action("look_right", [ja(JOY_AXIS_RIGHT_X, 1.0)], 0.15)
	action("jump", [key(KEY_SPACE), jb(JOY_BUTTON_A)])
	action("sprint", [key(KEY_SHIFT), jb(JOY_BUTTON_LEFT_STICK)])
	action("crouch", [key(KEY_C), key(KEY_CTRL), jb(JOY_BUTTON_B)])
	action("use", [mb(MOUSE_BUTTON_LEFT), ja(JOY_AXIS_TRIGGER_RIGHT, 1.0)], 0.3)
	action("aim", [mb(MOUSE_BUTTON_RIGHT), ja(JOY_AXIS_TRIGGER_LEFT, 1.0)], 0.3)
	action("interact", [key(KEY_E), jb(JOY_BUTTON_X)])
	action("inventory", [key(KEY_TAB), key(KEY_I), jb(JOY_BUTTON_Y)])
	action("journal", [key(KEY_J), jb(JOY_BUTTON_BACK)])
	action("map", [key(KEY_M), jb(JOY_BUTTON_DPAD_DOWN)])
	action("build", [key(KEY_B), jb(JOY_BUTTON_DPAD_UP)])
	action("pause", [key(KEY_ESCAPE), jb(JOY_BUTTON_START)])
	for i in 6:
		action("hotbar_%d" % (i + 1), [key(KEY_1 + i)])
	var wu := mb(MOUSE_BUTTON_WHEEL_UP); var wd := mb(MOUSE_BUTTON_WHEEL_DOWN)
	action("hotbar_next", [wd, jb(JOY_BUTTON_RIGHT_SHOULDER)])
	action("hotbar_prev", [wu, jb(JOY_BUTTON_LEFT_SHOULDER)])
	action("drop", [key(KEY_G), jb(JOY_BUTTON_DPAD_LEFT)])
	action("reload", [key(KEY_R)])
	action("torch_toggle", [key(KEY_F), jb(JOY_BUTTON_DPAD_RIGHT)])
	action("photo_mode", [key(KEY_P), key(KEY_F12)])
	action("rotate_left", [key(KEY_Q)])
	action("rotate_right", [key(KEY_R)])
	var err := ps.save()
	print("setup_project: saved project.godot err=", err)
	_make_bus_layout()
	quit()

func _make_bus_layout() -> void:
	# Master -> Music, SFX, Ambience, Voice, UI ; SFX & Ambience also feed Reverb (send) -> Master
	var names := ["Reverb", "Music", "SFX", "Ambience", "Voice", "UI"]
	for n in names:
		AudioServer.add_bus()
		AudioServer.set_bus_name(AudioServer.bus_count - 1, n)
		AudioServer.set_bus_send(AudioServer.bus_count - 1, &"Master")
	var rev := AudioEffectReverb.new()
	rev.room_size = 0.55; rev.damping = 0.6; rev.wet = 0.35; rev.dry = 0.0; rev.spread = 1.0; rev.predelay_msec = 40.0
	AudioServer.add_bus_effect(AudioServer.get_bus_index(&"Reverb"), rev)
	# Master: gentle limiter + low-pass (used for muffling; cutoff raised to 20 kHz = off)
	var lp := AudioEffectLowPassFilter.new(); lp.cutoff_hz = 20500.0
	AudioServer.add_bus_effect(0, lp)
	var lim := AudioEffectHardLimiter.new(); lim.ceiling_db = -0.5
	AudioServer.add_bus_effect(0, lim)
	var comp := AudioEffectCompressor.new(); comp.threshold = -14.0; comp.ratio = 3.0; comp.sidechain = &"Voice"
	AudioServer.add_bus_effect(AudioServer.get_bus_index(&"Music"), comp)
	var err := ResourceSaver.save(AudioServer.generate_bus_layout(), "res://assets/audio/bus_layout.tres")
	print("setup_project: bus layout err=", err)

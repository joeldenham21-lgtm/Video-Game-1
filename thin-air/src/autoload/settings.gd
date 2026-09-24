extends Node
## Graphics/audio/control settings with platform presets and dynamic resolution. CONTRACT.md §3.

const SAVE_PATH := "user://settings.cfg"

const COMMON := {
	&"fov": 75.0, &"mouse_sensitivity": 0.12, &"look_sensitivity_touch": 0.22, &"look_sensitivity_pad": 2.6,
	&"invert_y": false, &"head_bob": 0.6, &"vol_master": 0.9, &"vol_music": 0.7, &"vol_sfx": 0.9,
	&"vol_ambience": 0.85, &"vol_voice": 1.0, &"subtitles": true, &"show_fps": false, &"touch_ui_scale": 1.0,
	&"difficulty": &"survivor", &"language": &"en", &"vsync": true,
}

const PRESETS := {
	&"mobile_low": {
		&"render_scale": 0.5, &"upscaler": &"fsr", &"msaa": 0, &"taa": false, &"fxaa": true,
		&"shadow_quality": 1, &"shadow_distance": 70.0, &"view_distance": 1800.0, &"lod_bias": 2.0,
		&"vegetation_density": 0.45, &"grass_distance": 14.0, &"tree_impostor_distance": 45.0,
		&"volumetric_fog": false, &"ssao": false, &"ssil": false, &"ssr": false, &"glow": true,
		&"sky_quality": 0, &"particles": 0, &"dynamic_resolution": true, &"target_fps": 45, &"max_fps": 60,
	},
	&"mobile_high": {
		&"render_scale": 0.62, &"upscaler": &"fsr", &"msaa": 2, &"taa": false, &"fxaa": false,
		&"shadow_quality": 2, &"shadow_distance": 110.0, &"view_distance": 2600.0, &"lod_bias": 1.4,
		&"vegetation_density": 0.75, &"grass_distance": 24.0, &"tree_impostor_distance": 70.0,
		&"volumetric_fog": false, &"ssao": false, &"ssil": false, &"ssr": false, &"glow": true,
		&"sky_quality": 1, &"particles": 1, &"dynamic_resolution": true, &"target_fps": 60, &"max_fps": 60,
	},
	&"low": {
		&"render_scale": 0.75, &"upscaler": &"fsr", &"msaa": 0, &"taa": false, &"fxaa": true,
		&"shadow_quality": 1, &"shadow_distance": 140.0, &"view_distance": 2800.0, &"lod_bias": 1.5,
		&"vegetation_density": 0.6, &"grass_distance": 30.0, &"tree_impostor_distance": 90.0,
		&"volumetric_fog": false, &"ssao": false, &"ssil": false, &"ssr": false, &"glow": true,
		&"sky_quality": 1, &"particles": 1, &"dynamic_resolution": true, &"target_fps": 60, &"max_fps": 0,
	},
	&"medium": {
		&"render_scale": 1.0, &"upscaler": &"bilinear", &"msaa": 0, &"taa": true, &"fxaa": false,
		&"shadow_quality": 2, &"shadow_distance": 250.0, &"view_distance": 3500.0, &"lod_bias": 1.2,
		&"vegetation_density": 0.8, &"grass_distance": 42.0, &"tree_impostor_distance": 120.0,
		&"volumetric_fog": true, &"ssao": false, &"ssil": false, &"ssr": false, &"glow": true,
		&"sky_quality": 2, &"particles": 2, &"dynamic_resolution": false, &"target_fps": 60, &"max_fps": 0,
	},
	&"high": {
		&"render_scale": 1.0, &"upscaler": &"bilinear", &"msaa": 0, &"taa": true, &"fxaa": false,
		&"shadow_quality": 3, &"shadow_distance": 350.0, &"view_distance": 4500.0, &"lod_bias": 1.0,
		&"vegetation_density": 1.0, &"grass_distance": 60.0, &"tree_impostor_distance": 160.0,
		&"volumetric_fog": true, &"ssao": true, &"ssil": false, &"ssr": false, &"glow": true,
		&"sky_quality": 2, &"particles": 2, &"dynamic_resolution": false, &"target_fps": 60, &"max_fps": 0,
	},
	&"ultra": {
		&"render_scale": 1.0, &"upscaler": &"bilinear", &"msaa": 0, &"taa": true, &"fxaa": false,
		&"shadow_quality": 3, &"shadow_distance": 450.0, &"view_distance": 6000.0, &"lod_bias": 0.75,
		&"vegetation_density": 1.0, &"grass_distance": 85.0, &"tree_impostor_distance": 230.0,
		&"volumetric_fog": true, &"ssao": true, &"ssil": true, &"ssr": true, &"glow": true,
		&"sky_quality": 2, &"particles": 2, &"dynamic_resolution": false, &"target_fps": 60, &"max_fps": 0,
	},
}

const PRESET_ORDER: Array[StringName] = [&"mobile_low", &"mobile_high", &"low", &"medium", &"high", &"ultra"]

var preset: StringName = &"high"
var values: Dictionary = {}

var _dyn_scale := 1.0
var _dyn_accum := 0.0
var _dyn_frames := 0
var _dyn_timer := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	values = COMMON.duplicate()
	var loaded := _load()
	if not loaded:
		apply_preset(auto_detect_preset(), false)
	_dyn_scale = float(values.get(&"render_scale", 1.0))
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	apply.call_deferred()


func get_value(key: StringName, default: Variant = null) -> Variant:
	return values.get(key, default)


func set_value(key: StringName, value: Variant, apply_now := true) -> void:
	values[key] = value
	if key == &"render_scale":
		_dyn_scale = float(value)
	if apply_now:
		apply()


func apply_preset(p: StringName, apply_now := true) -> void:
	if not PRESETS.has(p):
		push_warning("Settings: unknown preset %s" % p)
		return
	preset = p
	var d: Dictionary = PRESETS[p]
	for k in d:
		values[k] = d[k]
	_dyn_scale = float(values[&"render_scale"])
	if apply_now:
		apply()


func auto_detect_preset() -> StringName:
	if OS.has_feature("mobile") or OS.has_feature("android") or OS.has_feature("ios"):
		var gpu := RenderingServer.get_video_adapter_name().to_lower()
		# Adreno 7xx/8xx (S23+/S24/S25), Mali-G7xx Immortalis, Xclipse 9xx → high
		for tag in ["adreno (tm) 8", "adreno (tm) 7", "immortalis", "xclipse 9"]:
			if gpu.contains(tag):
				return &"mobile_high"
		return &"mobile_low"
	var name := RenderingServer.get_video_adapter_name().to_lower()
	if name.contains("llvmpipe") or name.contains("swiftshader"):
		return &"medium"
	if name.contains("rtx") or name.contains("radeon rx") or name.contains("arc a7"):
		return &"high"
	if name.contains("intel") or name.contains("uhd") or name.contains("iris"):
		return &"low"
	return &"medium"


func is_mobile() -> bool:
	return OS.has_feature("mobile") or OS.has_feature("android") or OS.has_feature("ios") \
		or String(preset).begins_with("mobile")


func is_forward_plus() -> bool:
	return RenderingServer.get_current_rendering_method() == "forward_plus"


func apply() -> void:
	var vp := get_tree().root
	var scale := clampf(_dyn_scale, 0.35, 1.0)
	var up: StringName = values.get(&"upscaler", &"bilinear")
	if not is_forward_plus():
		# FSR1/FSR2 are Forward+-only in Godot 4.7; the Mobile renderer upscales bilinearly (MSAA keeps edges clean).
		up = &"bilinear"
	match up:
		&"fsr": vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR
		&"fsr2": vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2
		_: vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = scale
	match int(values.get(&"msaa", 0)):
		2: vp.msaa_3d = Viewport.MSAA_2X
		4: vp.msaa_3d = Viewport.MSAA_4X
		_: vp.msaa_3d = Viewport.MSAA_DISABLED
	vp.use_taa = bool(values.get(&"taa", false)) and is_forward_plus() and up != &"fsr2"
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if bool(values.get(&"fxaa", false)) else Viewport.SCREEN_SPACE_AA_DISABLED
	vp.mesh_lod_threshold = float(values.get(&"lod_bias", 1.0))
	Engine.max_fps = int(values.get(&"max_fps", 0))
	if not OS.has_feature("mobile"):
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if values.get(&"vsync", true) else DisplayServer.VSYNC_DISABLED)
	var sq := int(values.get(&"shadow_quality", 2))
	var atlas: int = [1024, 2048, 4096, 4096][clampi(sq, 0, 3)]
	if is_mobile():
		atlas = mini(atlas, 2048)
	RenderingServer.directional_shadow_atlas_set_size(atlas, true)
	RenderingServer.directional_soft_shadow_filter_set_quality(
		[RenderingServer.SHADOW_QUALITY_HARD, RenderingServer.SHADOW_QUALITY_SOFT_VERY_LOW,
		RenderingServer.SHADOW_QUALITY_SOFT_LOW, RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM][clampi(sq, 0, 3)])
	_apply_audio()
	Events.settings_changed.emit()


func _apply_audio() -> void:
	var map := {&"Master": &"vol_master", &"Music": &"vol_music", &"SFX": &"vol_sfx",
		&"Ambience": &"vol_ambience", &"Voice": &"vol_voice"}
	for bus in map:
		var idx := AudioServer.get_bus_index(bus)
		if idx >= 0:
			var v := float(values.get(map[bus], 1.0))
			AudioServer.set_bus_volume_db(idx, linear_to_db(maxf(v, 0.0001)))
			AudioServer.set_bus_mute(idx, v <= 0.001)


func _process(delta: float) -> void:
	if not bool(values.get(&"dynamic_resolution", false)):
		return
	var vp_rid := get_viewport().get_viewport_rid()
	var gpu_ms := RenderingServer.viewport_get_measured_render_time_gpu(vp_rid)
	var frame_ms := gpu_ms if gpu_ms > 0.0 else delta * 1000.0
	_dyn_accum += frame_ms
	_dyn_frames += 1
	_dyn_timer += delta
	if _dyn_timer < 1.0:
		return
	var avg := _dyn_accum / maxf(1.0, float(_dyn_frames))
	_dyn_accum = 0.0; _dyn_frames = 0; _dyn_timer = 0.0
	var budget := 1000.0 / float(maxi(24, int(values.get(&"target_fps", 60))))
	var max_scale := float(values.get(&"render_scale", 1.0))
	var min_scale := max_scale * 0.7
	var new_scale := _dyn_scale
	if avg > budget * 1.08:
		new_scale = maxf(min_scale, _dyn_scale - 0.04)
	elif avg < budget * 0.75:
		new_scale = minf(max_scale, _dyn_scale + 0.02)
	if absf(new_scale - _dyn_scale) > 0.001:
		_dyn_scale = new_scale
		get_tree().root.scaling_3d_scale = _dyn_scale


func current_render_scale() -> float:
	return _dyn_scale


func save() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("general", "preset", String(preset))
	for k in values:
		var v: Variant = values[k]
		cfg.set_value("values", String(k), String(v) if v is StringName else v)
	cfg.save(SAVE_PATH)


func _load() -> bool:
	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) != OK:
		return false
	var p := StringName(cfg.get_value("general", "preset", "high"))
	apply_preset(p if PRESETS.has(p) else auto_detect_preset(), false)
	if cfg.has_section("values"):
		for k in cfg.get_section_keys("values"):
			var v: Variant = cfg.get_value("values", k)
			var key := StringName(k)
			if COMMON.has(key) and COMMON[key] is StringName:
				v = StringName(str(v))
			elif PRESETS[&"high"].has(key) and PRESETS[&"high"][key] is StringName:
				v = StringName(str(v))
			values[key] = v
	return true

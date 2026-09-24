class_name WeatherFX
extends Node3D
## Camera-following weather effects (child "WeatherFX" of the Sky scene).
##  * Snow: soft flakes of varied size in a wrap-around box around the camera, wind-driven with flutter,
##    stretched along their motion by a 1/60 s shutter; turns into wet sleet or rain streaks when the
##    valley air is above freezing (Climate.get_precipitation_type).
##  * Blizzard streaks: fast, fine, long-exposure snow when strong wind meets heavy snowfall.
##  * Spindrift: wisps of blowing snow skimming the ground in strong wind wherever there is snow cover.
##  * Diamond dust: sparse glinting ice crystals on clear, calm, very cold days (and sunlit light snow sparkles).
##  * Valley fog sea: seen from above, a depth-aware fog-top plane (all renderers, one draw call) whose opacity
##    is the fog actually crossed down to the terrain; near/inside it, a FogVolume (Forward+ volumetric fog)
##    and the environment fog carry the murk.
## Budgets (Settings.particles 0/1/2): 3,000 particles on mobile (all layers), ≈12k medium, ≈25k desktop high.
## Flakes live in a small wrap-around box (≤ 10 m radius): that is where individual flakes are resolvable;
## beyond it the snowfall is carried by the sky's precipitation veil and the fog.
## Particles are hidden inside shelters (Climate shelter factor at the camera).

const PROCESS_SHADER := "res://assets/shaders/weather_particles.gdshader"
const DRAW_SHADER := "res://assets/shaders/weather_flake.gdshader"
const FLAKES := "res://assets/textures/sky/flakes.png"
const FOG_SEA_SHADER := "res://assets/shaders/weather_valley_fog.gdshader"
const CLOUD_NOISE := "res://assets/textures/sky/cloud_noise.png"
## Visibility inside the valley fog bank (m) → extinction of the fog sea.
const VALLEY_FOG_VISIBILITY := 120.0

## Particle counts per Settings.particles level (0 = mobile).
const AMOUNTS := {
	&"snow": [1900, 8000, 20000],
	&"streaks": [500, 1500, 3200],
	&"drift": [400, 900, 1800],
	&"dust": [200, 400, 700],
}
const BOXES := {
	&"snow": [Vector3(12, 8, 12), Vector3(16, 10, 16), Vector3(20, 12, 20)],
	&"streaks": [Vector3(10, 6, 10), Vector3(12, 7, 12), Vector3(14, 8, 14)],
	&"drift": [Vector3(30, 2.4, 30), Vector3(36, 2.4, 36), Vector3(44, 2.6, 44)],
	&"dust": [Vector3(14, 10, 14), Vector3(18, 12, 18), Vector3(22, 14, 22)],
}

var _layers := {}
var _level := -1
var _time := 0.0
var _fog_volume: FogVolume
var _fog_sea: MeshInstance3D
var _fog_sea_mat: ShaderMaterial
var _fog_drift := Vector2.ZERO
var _fog_material: FogMaterial
var _sky: Node
var _shelter := 0.0
var _enabled := true
var _pixel_angle := 0.0017
var _fog_density := 0.0
## TAA averages away moving specks narrower than ~4 px (no motion vectors for blended particles), so
## flakes get a larger minimum footprint when it is on.
var _min_pixels := 3.0


func _ready() -> void:
	_sky = get_parent()
	if Events.has_signal("settings_changed"):
		Events.settings_changed.connect(_rebuild)
	_rebuild()


func set_enabled(on: bool) -> void:
	_enabled = on
	for k in _layers:
		(_layers[k][&"node"] as GPUParticles3D).visible = on


func _rebuild() -> void:
	var level := clampi(int(Settings.get_value(&"particles", 2)), 0, 2)
	if Settings.has_method("is_mobile") and Settings.is_mobile():
		level = mini(level, 0 if int(Settings.get_value(&"particles", 0)) <= 0 else 1)
	if level != _level:
		_level = level
		for k in _layers:
			(_layers[k][&"node"] as Node).queue_free()
		_layers.clear()
		for k in [&"snow", &"streaks", &"drift", &"dust"]:
			_layers[k] = _make_layer(k, level)
	if _fog_sea == null:
		_make_fog_sea()
	var want_fog := Settings.is_forward_plus() and bool(Settings.get_value(&"volumetric_fog", false))
	if want_fog and _fog_volume == null:
		_make_fog_volume()
	elif not want_fog and _fog_volume:
		_fog_volume.queue_free()
		_fog_volume = null


func _make_layer(kind: StringName, level: int) -> Dictionary:
	var p := GPUParticles3D.new()
	p.name = String(kind).capitalize()
	var amount: int = AMOUNTS[kind][level]
	var box: Vector3 = BOXES[kind][level]
	p.amount = amount
	p.lifetime = 600.0
	p.preprocess = 0.0
	p.explosiveness = 1.0
	p.randomness = 0.0
	p.local_coords = false
	p.interpolate = false
	p.fixed_fps = 0
	p.draw_order = GPUParticles3D.DRAW_ORDER_INDEX
	p.visibility_aabb = AABB(-box * 0.6 - Vector3(0, 4, 0), box * 1.2 + Vector3(0, 8, 0))
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	var proc := ShaderMaterial.new()
	proc.shader = load(PROCESS_SHADER)
	proc.set_shader_parameter(&"box_size", box)
	p.process_material = proc
	var quad := QuadMesh.new()
	quad.size = Vector2(1.0, 1.0)
	var draw := ShaderMaterial.new()
	draw.shader = load(DRAW_SHADER)
	draw.set_shader_parameter(&"flakes", load(FLAKES))
	draw.set_shader_parameter(&"far_fade", minf(box.x, box.z) * 0.5)
	quad.material = draw
	p.draw_pass_1 = quad
	match kind:
		&"snow":
			proc.set_shader_parameter(&"box_offset", Vector3(0, 2.0, 0))
			proc.set_shader_parameter(&"size_min", 0.008)
			proc.set_shader_parameter(&"size_max", 0.024)
		&"streaks":
			proc.set_shader_parameter(&"box_offset", Vector3(0, 1.0, 0))
			proc.set_shader_parameter(&"size_min", 0.004)
			proc.set_shader_parameter(&"size_max", 0.009)
			draw.set_shader_parameter(&"shutter", 1.0 / 30.0)
			draw.set_shader_parameter(&"round_mix", 0.6)
		&"drift":
			proc.set_shader_parameter(&"box_offset", Vector3(0, -1.05, 0))
			proc.set_shader_parameter(&"size_min", 0.12)
			proc.set_shader_parameter(&"size_max", 0.55)
			proc.set_shader_parameter(&"fall_speed", 0.15)
			proc.set_shader_parameter(&"turbulence", 1.4)
			proc.set_shader_parameter(&"lift", 0.35)
			proc.set_shader_parameter(&"wind_follow", 1.15)
			draw.set_shader_parameter(&"round_mix", 1.0)
			draw.set_shader_parameter(&"shutter", 1.0 / 20.0)
			draw.set_shader_parameter(&"near_fade", 1.2)
		&"dust":
			proc.set_shader_parameter(&"box_offset", Vector3(0, 1.5, 0))
			proc.set_shader_parameter(&"size_min", 0.002)
			proc.set_shader_parameter(&"size_max", 0.004)
			proc.set_shader_parameter(&"fall_speed", 0.12)
			proc.set_shader_parameter(&"turbulence", 0.25)
			draw.set_shader_parameter(&"round_mix", 1.0)
			draw.set_shader_parameter(&"near_fade", 0.2)
	add_child(p)
	p.emitting = true
	return {&"node": p, &"proc": proc, &"draw": draw, &"kind": kind}


func _make_fog_sea() -> void:
	_fog_sea = MeshInstance3D.new()
	_fog_sea.name = "ValleyFogSea"
	var pm := PlaneMesh.new()
	pm.size = Vector2(30000.0, 30000.0)
	_fog_sea.mesh = pm
	_fog_sea_mat = ShaderMaterial.new()
	_fog_sea_mat.shader = load(FOG_SEA_SHADER)
	_fog_sea_mat.set_shader_parameter(&"cloud_noise", load(CLOUD_NOISE))
	_fog_sea_mat.set_shader_parameter(&"extinction", 3.912 / VALLEY_FOG_VISIBILITY)
	_fog_sea.material_override = _fog_sea_mat
	_fog_sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_fog_sea.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	_fog_sea.visible = false
	add_child(_fog_sea)
	_fog_sea.top_level = true


func _make_fog_volume() -> void:
	_fog_volume = FogVolume.new()
	_fog_volume.name = "ValleyFog"
	_fog_volume.shape = RenderingServer.FOG_VOLUME_SHAPE_BOX
	_fog_volume.size = Vector3(1024.0, 200.0, 1024.0)
	_fog_material = FogMaterial.new()
	_fog_material.density = 0.0
	_fog_material.albedo = Color(0.9, 0.92, 0.95)
	_fog_material.height_falloff = 0.035
	_fog_material.edge_fade = 0.3
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = 0.035
	noise.fractal_octaves = 3
	noise.seed = 2027
	var tex := NoiseTexture3D.new()
	tex.width = 48
	tex.height = 16
	tex.depth = 48
	tex.seamless = true
	tex.noise = noise
	_fog_material.density_texture = tex
	_fog_volume.material = _fog_material
	add_child(_fog_volume)


func _process(delta: float) -> void:
	_time += delta
	if not _enabled:
		return
	var vp := get_viewport()
	var cam := vp.get_camera_3d() if vp else null
	if cam == null:
		return
	var cp := cam.global_position
	global_position = cp
	var vh := vp.get_visible_rect().size.y * vp.scaling_3d_scale
	_pixel_angle = deg_to_rad(cam.fov) / maxf(vh, 1.0)
	_min_pixels = 5.5 if vp.use_taa else 3.0
	var p: Dictionary = Climate.params
	var precip := Climate.precipitation
	var wind: Vector3 = Climate.get_wind_at(cp)
	var wind_speed := wind.length()
	var shelter := Climate.get_shelter_at(cp)
	_shelter = lerpf(_shelter, shelter, 1.0 - exp(-delta * 4.0))
	var open_sky := 1.0 - _shelter
	var ptype: StringName = Climate.get_precipitation_type(cp)
	var t_air := Climate.get_air_temperature(cp)
	# Lighting of a white diffuser from the sky controller (keeps flakes matched to exposure).
	var amb := Color(0.3, 0.32, 0.36)
	var sun_c := Color(0.6, 0.58, 0.55)
	var sun_dir: Vector3 = Climate.get_sun_direction()
	if _sky and _sky.has_method("get_particle_lighting"):
		var pl: Array = _sky.get_particle_lighting()
		amb = pl[0]
		sun_c = pl[1]
		sun_dir = pl[2]
	var amb_v := Vector3(amb.r, amb.g, amb.b)
	var sun_v := Vector3(sun_c.r, sun_c.g, sun_c.b)
	var sunlit := clampf(sun_v.length() / maxf(amb_v.length() * 3.0, 1e-5), 0.0, 1.0)
	var env: Environment = _sky.get(&"environment") if _sky else null
	_fog_density = env.fog_density if env and env.fog_enabled else 0.0

	# ------------------------------------------------------------------ snowfall / sleet / rain
	var snow: Dictionary = _layers.get(&"snow", {})
	if not snow.is_empty():
		var d := clampf(precip / 0.6, 0.0, 1.0) * open_sky
		var proc: ShaderMaterial = snow[&"proc"]
		var draw: ShaderMaterial = snow[&"draw"]
		var heavy := smoothstep(0.6, 1.0, precip)
		match ptype:
			&"rain":
				proc.set_shader_parameter(&"fall_speed", 6.5)
				proc.set_shader_parameter(&"fall_var", 0.15)
				proc.set_shader_parameter(&"turbulence", 0.1)
				proc.set_shader_parameter(&"size_min", 0.0018)
				proc.set_shader_parameter(&"size_max", 0.003)
				draw.set_shader_parameter(&"shutter", 1.0 / 30.0)
				draw.set_shader_parameter(&"round_mix", 1.0)
				draw.set_shader_parameter(&"opacity", 0.45)
				draw.set_shader_parameter(&"tint", Vector3(0.72, 0.76, 0.8))
			&"sleet":
				proc.set_shader_parameter(&"fall_speed", 2.3)
				proc.set_shader_parameter(&"fall_var", 0.25)
				proc.set_shader_parameter(&"turbulence", 0.25)
				proc.set_shader_parameter(&"size_min", 0.007)
				proc.set_shader_parameter(&"size_max", 0.016)
				draw.set_shader_parameter(&"shutter", 1.0 / 120.0)
				draw.set_shader_parameter(&"round_mix", 0.55)
				draw.set_shader_parameter(&"opacity", 0.7)
				draw.set_shader_parameter(&"tint", Vector3(0.85, 0.88, 0.9))
			_:
				# Dry snow; in a blizzard the flakes are smaller, faster and more numerous.
				proc.set_shader_parameter(&"fall_speed", lerpf(0.95, 1.4, heavy))
				proc.set_shader_parameter(&"fall_var", 0.35)
				proc.set_shader_parameter(&"turbulence", lerpf(0.45, 1.1, heavy))
				proc.set_shader_parameter(&"size_min", lerpf(0.008, 0.005, heavy))
				proc.set_shader_parameter(&"size_max", lerpf(0.024, 0.013, heavy))
				# The eye tracks gently falling flakes as dots; only a gale smears them into streaks.
				draw.set_shader_parameter(&"shutter", lerpf(1.0 / 250.0, 1.0 / 60.0, heavy))
				draw.set_shader_parameter(&"round_mix", 0.0)
				draw.set_shader_parameter(&"opacity", 1.0)
				draw.set_shader_parameter(&"tint", Vector3(1.0, 1.0, 1.0))
		proc.set_shader_parameter(&"wind", wind)
		proc.set_shader_parameter(&"density", d)
		draw.set_shader_parameter(&"sparkle", 0.35 * sunlit * (1.0 - heavy) if ptype == &"snow" else 0.0)
		_set_light(draw, amb_v, sun_v, sun_dir)
		(snow[&"node"] as GPUParticles3D).visible = d > 0.001

	# ------------------------------------------------------------------ blizzard streaks
	var st: Dictionary = _layers.get(&"streaks", {})
	if not st.is_empty():
		var d2 := smoothstep(7.0, 15.0, wind_speed) * smoothstep(0.35, 0.8, precip) * open_sky
		if ptype == &"rain":
			d2 = 0.0
		var proc2: ShaderMaterial = st[&"proc"]
		proc2.set_shader_parameter(&"wind", wind * 1.15)
		proc2.set_shader_parameter(&"fall_speed", 1.2)
		proc2.set_shader_parameter(&"turbulence", 1.6)
		proc2.set_shader_parameter(&"density", d2)
		var draw2: ShaderMaterial = st[&"draw"]
		draw2.set_shader_parameter(&"opacity", 0.55)
		_set_light(draw2, amb_v, sun_v, sun_dir)
		(st[&"node"] as GPUParticles3D).visible = d2 > 0.001

	# ------------------------------------------------------------------ spindrift (blowing snow at the surface)
	var dr: Dictionary = _layers.get(&"drift", {})
	if not dr.is_empty():
		var ground_snow := clampf(Climate.snow_cover * 2.0 + (cp.y - 1850.0) / 300.0, 0.0, 1.0)
		var forest := clampf(TerrainData.get_masks(cp.x, cp.z).a, 0.0, 1.0) if TerrainData.is_loaded() else 0.0
		var d3 := smoothstep(6.0, 13.0, wind_speed) * ground_snow * (1.0 - 0.8 * forest) * open_sky
		d3 *= 1.0 if t_air < 0.5 else 0.2    # wet snow does not drift
		var proc3: ShaderMaterial = dr[&"proc"]
		proc3.set_shader_parameter(&"wind", wind)
		proc3.set_shader_parameter(&"density", d3)
		var draw3: ShaderMaterial = dr[&"draw"]
		draw3.set_shader_parameter(&"opacity", 0.07 + 0.05 * precip)
		_set_light(draw3, amb_v, sun_v, sun_dir)
		(dr[&"node"] as GPUParticles3D).visible = d3 > 0.001

	# ------------------------------------------------------------------ diamond dust
	var du: Dictionary = _layers.get(&"dust", {})
	if not du.is_empty():
		var cold := 1.0 - smoothstep(-12.0, -6.0, t_air)
		var calm := 1.0 - smoothstep(3.0, 6.0, wind_speed)
		var clear := 1.0 - smoothstep(0.2, 0.5, Climate.cloud_cover)
		var d4 := cold * calm * clear * (1.0 - smoothstep(0.02, 0.1, precip)) * open_sky
		# Light snow in sunshine also glitters.
		var proc4: ShaderMaterial = du[&"proc"]
		proc4.set_shader_parameter(&"wind", wind * 0.6)
		proc4.set_shader_parameter(&"density", d4)
		var draw4: ShaderMaterial = du[&"draw"]
		draw4.set_shader_parameter(&"sparkle", 1.0)
		draw4.set_shader_parameter(&"opacity", 0.25)
		_set_light(draw4, amb_v, sun_v, sun_dir)
		(du[&"node"] as GPUParticles3D).visible = d4 > 0.001

	# ------------------------------------------------------------------ valley fog sea (seen from above)
	if _fog_sea:
		var vf_s := Climate.valley_fog
		var top_s := Climate.valley_fog_top
		var fog_on := vf_s > 0.01 and cp.y > top_s + 1.5
		_fog_sea.visible = fog_on
		if fog_on:
			_fog_drift += Vector2(wind.x, wind.z) * delta * 0.6
			_fog_drift = Vector2(fposmod(_fog_drift.x, 100000.0), fposmod(_fog_drift.y, 100000.0))
			_fog_sea.global_position = Vector3(roundf(cp.x / 64.0) * 64.0, top_s, roundf(cp.z / 64.0) * 64.0)
			_fog_sea_mat.set_shader_parameter(&"intensity", vf_s)
			_fog_sea_mat.set_shader_parameter(&"drift", -_fog_drift)
			_fog_sea_mat.set_shader_parameter(&"light_ambient", amb_v)
			_fog_sea_mat.set_shader_parameter(&"light_sun", sun_v)
			_fog_sea_mat.set_shader_parameter(&"sun_dir", sun_dir)

	# ------------------------------------------------------------------ valley fog bank (volumetric)
	if _fog_volume and _fog_material:
		var vf := Climate.valley_fog
		var top := Climate.valley_fog_top
		var floor_y := 1290.0
		var h := maxf(top - floor_y + 60.0, 40.0)
		_fog_volume.size = Vector3(1024.0, h, 1024.0)
		var snap := Vector3(roundf(cp.x / 256.0) * 256.0, floor_y + h * 0.5 - 30.0, roundf(cp.z / 256.0) * 256.0)
		_fog_volume.global_position = snap
		_fog_material.density = 0.03 * vf
		_fog_volume.visible = vf > 0.01


func _set_light(m: ShaderMaterial, amb: Vector3, sun: Vector3, sd: Vector3) -> void:
	m.set_shader_parameter(&"pixel_angle", _pixel_angle)
	m.set_shader_parameter(&"min_pixels", _min_pixels)
	m.set_shader_parameter(&"fog_density", _fog_density)
	m.set_shader_parameter(&"light_ambient", amb)
	m.set_shader_parameter(&"light_sun", sun)
	m.set_shader_parameter(&"sun_dir", sd)
	m.set_shader_parameter(&"time_s", _time)

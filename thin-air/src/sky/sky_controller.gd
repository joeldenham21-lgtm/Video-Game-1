class_name SkyController
extends Node3D
## Root of scenes/world/sky.tscn ("Sky"). Owns the WorldEnvironment/Environment, the physically based sky
## material, and the single shadow-casting DirectionalLight3D "Sun" (group "sun"), which becomes the
## moonlight at night. Everything is driven by Climate (time, weather) and Settings (quality):
##  * sky shader uniforms from a precomputed spectral atmosphere (assets/textures/sky/atmosphere_*.res),
##  * sun/moon light colour & energy from atmospheric transmittance at the camera altitude, dimmed by the
##    cloud deck actually crossing the sun, warm at golden hour, cool dim moonlight at night,
##  * exposure that adapts like an eye (daylight → moonlit night ≈ 8.5× gain; moonless nights stay dark),
##  * depth + height fog whose colour is the horizon sky (aerial perspective), valley fog banks, whiteouts,
##  * volumetric fog / SSAO / SSIL / SSR / glow / shadow cascades from Settings (on settings_changed).
## Other systems must not replace WorldEnvironment.environment; read get_exposure()/get_fog_color() instead.

const SUN_E := 10.0                # top-of-atmosphere sun irradiance (scene units; light energy = E/π)
const MOON_E := 0.035              # full-moon irradiance, boosted for night adaptation (≈ twilight at −5.5°)
const MOON_TINT := Color(0.72, 0.82, 1.0)   # Purkinje shift: moonlight reads cool
const STAR_K := 0.35               # mag-0 star peak radiance (saturates at night exposure)
const MILKY_WAY_K := 0.002         # Milky Way surface brightness at texture value 1
const AIRGLOW := 0.00006           # natural night sky (airglow + starlight) radiance at the zenith (≪ moonlit sky)
const KEY_REF := 2.6               # horizontal illuminance for exposure 1 (≈ sunny late-October midday)
const EXPOSURE_MIN := 1.0
const EXPOSURE_MAX := 8.5
const ADAPT_SECONDS := 3.0
const CLOUD_SCALE := 0.00005       # uv per metre on the cloud deck (one noise tile = 20 km)
const LUT_ALTS: Array[float] = [1300.0, 2000.0, 2700.0, 3450.0]
const T_ALTS: Array[float] = [1300.0, 2000.0, 2700.0, 3450.0, 4500.0, 6000.0, 9000.0]
const ROW_IRR := 7
const ROW_HOR := 11
const ROW_HOR_SUN := 15
const ROW_HOR_ANTI := 19
const ROW_ZEN := 23

const TEX_DIR := "res://assets/textures/sky/"
const SHADER_DESKTOP := "res://assets/shaders/sky.gdshader"
const SHADER_MOBILE := "res://assets/shaders/sky_mobile.gdshader"

@onready var world_env: WorldEnvironment = $WorldEnvironment
@onready var sun: DirectionalLight3D = $Sun

var environment: Environment
var sky: Sky
var sky_material: ShaderMaterial
var camera_attributes: CameraAttributesPractical

var _cpu: Image
var _cloud_img: Image
var _white_balance := Color(1, 1, 1)
var _exposure := 1.0
var _first := true
var _sky_quality := 2
var _mobile_shader := false
var _update_interval := 0.0
var _update_timer := 0.0
var _cloud_offset := Vector2(0.37, 0.61)
var _cirrus_offset := Vector2(0.13, 0.29)
var _aurora_time := 0.0
var _twinkle_time := 0.0
var _fog_color := Color(0.6, 0.65, 0.72)
var _light_is_moon := false
var _interior := 0.0
var _time := 0.0
var _u := {}                        # last computed uniforms (debug / tests)
var _particle_amb := Color(0.3, 0.3, 0.3)
var _particle_sun := Color(0.5, 0.5, 0.5)
var _particle_dir := Vector3.UP


func _ready() -> void:
	add_to_group(&"sky")
	_cpu = load(TEX_DIR + "atmosphere_cpu.res") as Image
	var cn: Texture2D = load(TEX_DIR + "cloud_noise.png")
	if cn:
		_cloud_img = cn.get_image()
		if _cloud_img and _cloud_img.is_compressed():
			_cloud_img.decompress()
	_white_balance = _compute_white_balance()
	_build_environment()
	_setup_sun()
	apply_settings()
	if Events.has_signal("settings_changed"):
		Events.settings_changed.connect(apply_settings)
	if Climate.has_method("register_sky"):
		Climate.register_sky(self)
	_update(0.0)


# ============================================================================================ setup
func _build_environment() -> void:
	environment = world_env.environment if world_env.environment else Environment.new()
	world_env.environment = environment
	environment.background_mode = Environment.BG_SKY
	sky = Sky.new()
	sky_material = ShaderMaterial.new()
	sky.sky_material = sky_material
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_sky_contribution = 1.0
	environment.ambient_light_energy = 1.0
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.tonemap_exposure = 1.0
	environment.tonemap_agx_contrast = 1.18
	# Fog: exponential distance fog + height fog, coloured by the sky (aerial perspective).
	environment.fog_enabled = true
	environment.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	environment.fog_density = 0.00007
	environment.fog_aerial_perspective = 1.0
	environment.fog_sky_affect = 0.0
	environment.fog_height = 0.0
	environment.fog_height_density = 0.0
	# Glow: subtle veiling glare around the sun, bright snow and fires.
	# Only genuinely hot sources bloom (sun, specular glints, fire): bright snow must not veil the image.
	environment.glow_intensity = 0.12
	environment.glow_strength = 1.0
	environment.glow_bloom = 0.0
	environment.glow_hdr_threshold = 3.0
	environment.glow_hdr_scale = 1.5
	environment.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	environment.set_glow_level(0, 0.2)
	environment.set_glow_level(1, 0.5)
	environment.set_glow_level(2, 0.8)
	environment.set_glow_level(3, 1.0)
	environment.set_glow_level(4, 0.5)
	environment.set_glow_level(5, 0.15)
	environment.set_glow_level(6, 0.0)
	# SSAO / SSIL / SSR tuned for first-person scale (enabled from Settings).
	environment.ssao_radius = 1.4
	environment.ssao_intensity = 1.7
	environment.ssao_power = 1.4
	environment.ssao_detail = 0.6
	environment.ssao_horizon = 0.06
	environment.ssao_light_affect = 0.15
	environment.ssil_radius = 6.0
	environment.ssil_intensity = 0.9
	environment.ssr_max_steps = 48
	environment.ssr_fade_in = 0.12
	environment.ssr_fade_out = 2.5
	# Volumetric fog (Forward+ only): local haze, sun shafts, snow murk.
	environment.volumetric_fog_density = 0.003
	environment.volumetric_fog_albedo = Color(0.92, 0.94, 0.97)
	environment.volumetric_fog_emission = Color(0, 0, 0)
	environment.volumetric_fog_anisotropy = 0.55
	environment.volumetric_fog_length = 96.0
	environment.volumetric_fog_detail_spread = 2.0
	environment.volumetric_fog_ambient_inject = 0.6
	environment.volumetric_fog_gi_inject = 0.0
	environment.volumetric_fog_sky_affect = 0.0
	environment.volumetric_fog_temporal_reprojection_enabled = true
	environment.volumetric_fog_temporal_reprojection_amount = 0.85
	environment.adjustment_enabled = true
	environment.adjustment_brightness = 1.0
	environment.adjustment_contrast = 1.0
	environment.adjustment_saturation = 1.0
	camera_attributes = CameraAttributesPractical.new()
	world_env.camera_attributes = camera_attributes
	var mat := sky_material
	mat.set_shader_parameter(&"atmosphere_lut", load(TEX_DIR + "atmosphere_lut.res"))
	mat.set_shader_parameter(&"cloud_noise", load(TEX_DIR + "cloud_noise.png"))
	mat.set_shader_parameter(&"moon_albedo", load(TEX_DIR + "moon_albedo.png"))
	mat.set_shader_parameter(&"star_map", load(TEX_DIR + "stars.png"))
	mat.set_shader_parameter(&"milky_way", load(TEX_DIR + "milky_way.png"))
	mat.set_shader_parameter(&"blue_noise", load(TEX_DIR + "blue_noise.png"))


func _setup_sun() -> void:
	sun.add_to_group(&"sun")
	sun.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	sun.shadow_enabled = true
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 1.1
	sun.shadow_blur = 1.0
	sun.directional_shadow_fade_start = 0.85
	sun.directional_shadow_pancake_size = 30.0
	sun.light_volumetric_fog_energy = 1.0


## Re-reads Settings (called on Events.settings_changed).
func apply_settings() -> void:
	if environment == null:
		return
	var fp := Settings.is_forward_plus() if Settings.has_method("is_forward_plus") else true
	var mobile := Settings.is_mobile() if Settings.has_method("is_mobile") else false
	environment.ssao_enabled = fp and bool(Settings.get_value(&"ssao", false))
	environment.ssil_enabled = fp and bool(Settings.get_value(&"ssil", false))
	environment.ssr_enabled = fp and bool(Settings.get_value(&"ssr", false))
	environment.volumetric_fog_enabled = fp and bool(Settings.get_value(&"volumetric_fog", false))
	environment.glow_enabled = bool(Settings.get_value(&"glow", true))
	if mobile or not fp:
		environment.set_glow_level(5, 0.0)
		environment.set_glow_level(6, 0.0)
	_sky_quality = clampi(int(Settings.get_value(&"sky_quality", 2)), 0, 2)
	if not fp:
		_sky_quality = mini(_sky_quality, 1)
	var want_mobile := _sky_quality == 0 or not fp
	if want_mobile != _mobile_shader or sky_material.shader == null:
		_mobile_shader = want_mobile
		sky_material.shader = load(SHADER_MOBILE if want_mobile else SHADER_DESKTOP)
	sky_material.set_shader_parameter(&"quality", _sky_quality)
	match _sky_quality:
		0:
			sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
			sky.radiance_size = Sky.RADIANCE_SIZE_64
			_update_interval = 0.25
		1:
			sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
			sky.radiance_size = Sky.RADIANCE_SIZE_128
			_update_interval = 0.1
		_:
			sky.process_mode = Sky.PROCESS_MODE_REALTIME
			sky.radiance_size = Sky.RADIANCE_SIZE_256
			_update_interval = 0.0
	_apply_shadows(mobile or not fp)
	# Smooth sky gradients: debanding in the tonemapper (cheap, all renderers).
	get_viewport().use_debanding = true
	_update_timer = 0.0


func _apply_shadows(mobile: bool) -> void:
	var sq := clampi(int(Settings.get_value(&"shadow_quality", 2)), 0, 3)
	var dist := float(Settings.get_value(&"shadow_distance", 250.0))
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = dist
	if mobile or sq <= 1:
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
		# First person: ~20 % of the range at full resolution (hands, tools, nearby trees).
		sun.directional_shadow_split_1 = 0.22
		sun.directional_shadow_blend_splits = false
	else:
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
		sun.directional_shadow_split_1 = 0.045
		sun.directional_shadow_split_2 = 0.14
		sun.directional_shadow_split_3 = 0.38
		sun.directional_shadow_blend_splits = sq >= 3
	# Physically sized sun (0.53°) gives soft contact-hardening shadows on Ultra/High.
	sun.light_angular_distance = 0.53 if (sq >= 3 and not mobile) else 0.0


# ============================================================================================ per frame
func _process(delta: float) -> void:
	_update(delta)


## Jump straight to the current state (no exposure adaptation lag) – teleports, cinematics, screenshots.
func snap() -> void:
	_first = true
	_update(0.0)


func get_exposure() -> float:
	return _exposure


func get_fog_color() -> Color:
	return _fog_color


func is_moonlight() -> bool:
	return _light_is_moon


func get_debug_uniforms() -> Dictionary:
	return _u


## [ambient radiance (Color), direct radiance facing the light (Color), light direction (Vector3)] of a
## white diffuser – used by weather particles so they always sit correctly in the exposed image.
func get_particle_lighting() -> Array:
	return [_particle_amb, _particle_sun, _particle_dir]


func _camera() -> Camera3D:
	var vp := get_viewport()
	return vp.get_camera_3d() if vp else null


func _update(delta: float) -> void:
	_time += delta
	var cam := _camera()
	var cam_pos := cam.global_position if cam else Vector3(0.0, 1500.0, 0.0)
	var alt := clampf(cam_pos.y, LUT_ALTS[0], LUT_ALTS[3])
	var sd: Vector3 = Climate.get_sun_direction()
	var md: Vector3 = Climate.get_moon_direction()
	var el_s := rad_to_deg(asin(clampf(sd.y, -1.0, 1.0)))
	var el_m := rad_to_deg(asin(clampf(md.y, -1.0, 1.0)))
	var p: Dictionary = Climate.params
	var cover := float(p.get(&"cloud_cover", 0.3))
	var density := float(p.get(&"cloud_density", 0.5))
	var cirrus := float(p.get(&"cirrus", 0.2))
	var overcast := float(p.get(&"overcast", 0.0))
	var precip := Climate.precipitation
	var fog := Climate.fog_density
	var haze := float(p.get(&"haze", 0.0))
	var base_asl := float(p.get(&"cloud_base", 4000.0))
	var cloud_h := maxf(base_asl - cam_pos.y, 350.0)
	var phase := float(Climate.get_moon_phase())
	var moon_bright := Astronomy.moon_brightness(phase)
	var moon_e := MOON_E * moon_bright
	# Twilight adaptation: the eye gains sensitivity as the sun sinks, so the sun-lit sky is boosted
	# (×1 at sunset → ×16 at −6° → ×250 at −12°), keeping blue hour blue and HDR values in half-float range.
	var sun_e := SUN_E * minf(pow(10.0, 0.2 * maxf(-el_s, 0.0)), 400.0)

	# ---------------------------------------------------------------- atmosphere tables
	var t_sun := _trans(alt, el_s)
	var t_moon := _trans(alt, el_m)
	var irr_s := _row4(ROW_IRR, alt, el_s) * sun_e
	var irr_m := _row4(ROW_IRR, alt, el_m) * moon_e
	var hor := _row4(ROW_HOR, alt, el_s) * sun_e + _row4(ROW_HOR, alt, el_m) * moon_e
	var hor_anti := _row4(ROW_HOR_ANTI, alt, el_s) * sun_e + _row4(ROW_HOR, alt, el_m) * moon_e
	var zen := _row4(ROW_ZEN, alt, el_s) * sun_e + _row4(ROW_ZEN, alt, el_m) * moon_e
	var airglow_rad := Color(AIRGLOW, AIRGLOW, AIRGLOW) * 1.8
	hor += airglow_rad * 2.5
	hor_anti += airglow_rad * 2.5
	zen += airglow_rad

	# ---------------------------------------------------------------- wind-driven cloud motion (real time)
	var wd: Vector3 = Climate.wind_direction
	var wind_ref := float(p.get(&"wind", 4.0))
	var cloud_wind := Vector2(wd.x, wd.z) * (4.0 + wind_ref * 1.9)
	_cloud_offset += cloud_wind * delta * CLOUD_SCALE
	var jet := Vector2(wd.x, wd.z).rotated(deg_to_rad(18.0))
	_cirrus_offset += Vector2(1.0, 0.0) * (22.0 + wind_ref) * delta * 0.000018
	_cloud_offset = Vector2(fposmod(_cloud_offset.x, 1.0), fposmod(_cloud_offset.y, 1.0))
	_cirrus_offset = Vector2(fposmod(_cirrus_offset.x, 1.0), fposmod(_cirrus_offset.y, 1.0))

	# ---------------------------------------------------------------- direct light through clouds
	var veil := clampf(pow(precip, 1.4) * 0.75 + fog * fog * 0.35, 0.0, 0.97)
	var ct_sun := _cloud_transmittance(sd, cover, density, overcast, cloud_h)
	var ct_moon := _cloud_transmittance(md, cover, density, overcast, cloud_h)
	# Thick decks let through only diffuse light; thin cloud still transmits some.
	var diffuse_t := lerpf(1.0, 0.24 + 0.2 * (1.0 - density), overcast)
	diffuse_t *= 1.0 - 0.35 * veil
	var sun_rgb := _mulc(t_sun, sun_e * ct_sun * (1.0 - veil) * smoothstep(-1.2, 0.4, el_s))
	var moon_rgb := _mulc(t_moon * MOON_TINT, moon_e * ct_moon * (1.0 - veil) * smoothstep(-1.0, 1.0, el_m))

	# ---------------------------------------------------------------- overcast / veil / fog colours
	var clear_global := _lum(t_sun) * sun_e * maxf(sd.y, 0.0) + _lum(irr_s) + (_lum(t_moon) * moon_e * maxf(md.y, 0.0) + _lum(irr_m))
	var under := clear_global * (0.24 + 0.22 * (1.0 - density))
	var lz := under * 9.0 / (7.0 * PI)
	# Overcast light is neutral grey; at dusk it keeps a hint of the low sun / blue hour.
	# Defined in camera (white-balanced) space as a faintly cool grey, then taken back to physical space.
	var tint := _norm(Color(0.965 / _white_balance.r, 0.985 / _white_balance.g, 1.0 / _white_balance.b)).lerp(_norm(zen + hor * 0.5), 0.08)
	var oc_zen := _mulc(tint, lz)
	var oc_hor := _mulc(tint, lz * 0.62)
	# Fog/haze colour: the horizon away from the sun's aureole (sun-scatter adds the sunward glow).
	var fog_col := hor_anti.lerp(hor, 0.35).lerp(oc_hor, overcast)
	fog_col = fog_col.lerp(oc_hor * 1.05, veil)
	fog_col += airglow_rad
	_fog_color = fog_col

	# ---------------------------------------------------------------- ground bounce (lower hemisphere)
	var snowy := clampf(Climate.snow_cover + (cam_pos.y - 1650.0) / 900.0, 0.0, 1.0)
	var albedo := lerpf(0.2, 0.72, snowy)
	var ground_e := sun_rgb * maxf(sd.y, 0.0) + moon_rgb * maxf(md.y, 0.0) + (irr_s + irr_m) * diffuse_t
	if overcast > 0.0:
		ground_e = ground_e.lerp(Color(under, under, under), overcast)
	var ground := _mulc(ground_e, albedo / PI)

	# ---------------------------------------------------------------- cloud lighting
	var t_cloud := _trans_any(base_asl + 600.0, el_s)
	var t_cirrus := _trans_any(9000.0, el_s)
	var cloud_sun := _mulc(t_cloud, sun_e)
	var cloud_moon := _mulc(_trans_any(base_asl + 600.0, el_m) * MOON_TINT, moon_e)
	var sky_above := _row4(ROW_IRR, LUT_ALTS[3], el_s) * sun_e + _row4(ROW_IRR, LUT_ALTS[3], el_m) * moon_e
	var amb_top := _mulc(sky_above, 1.25 / PI) + airglow_rad
	var amb_bottom := ground * 0.9 + _mulc(irr_s + irr_m, 0.25 / PI)

	# ---------------------------------------------------------------- exposure (eye adaptation)
	# Broken cloud brightens the diffuse light considerably (sunlit cloud sides), up to ~2× at half cover.
	var enhance := 1.0 + 2.2 * cover * (1.0 - cover) * (1.0 - overcast) * smoothstep(-2.0, 8.0, el_s)
	var key := _lum(sun_rgb) * maxf(sd.y, 0.0) + _lum(moon_rgb) * maxf(md.y, 0.0) + (_lum(irr_s) + _lum(irr_m)) * diffuse_t * enhance
	if overcast > 0.0:
		key = lerpf(key, under, overcast)
	key = maxf(key, 1.0e-6) + 2.0e-5
	var target := clampf(pow(KEY_REF / key, 0.6), EXPOSURE_MIN, EXPOSURE_MAX)
	if _first:
		_exposure = target
	else:
		_exposure = lerpf(_exposure, target, 1.0 - exp(-delta / ADAPT_SECONDS))

	# ---------------------------------------------------------------- light: sun, or moon at night
	var sun_w := smoothstep(-2.0, -0.4, el_s)
	var use_moon := el_s < -2.0
	var light_rgb: Color
	var light_dir: Vector3
	if use_moon:
		var fade_in := smoothstep(-2.0, -6.0, el_s)
		light_rgb = moon_rgb * fade_in
		light_dir = md
	else:
		light_rgb = sun_rgb * sun_w
		light_dir = sd
	_light_is_moon = use_moon
	var energy := _lum(light_rgb)
	var lc := _norm(light_rgb)
	sun.light_color = Color(lc.r * _white_balance.r, lc.g * _white_balance.g, lc.b * _white_balance.b)
	sun.light_energy = energy / PI   # Godot light energy = irradiance / π (radiance-consistent with the sky)
	sun.light_specular = 1.0 if not use_moon else 0.6
	var visible_light := energy > 1.0e-5 and light_dir.y > -0.02
	sun.visible = visible_light
	if visible_light:
		var d := -light_dir
		var up := Vector3.UP if absf(d.y) < 0.999 else Vector3.FORWARD
		sun.global_basis = Basis.looking_at(d, up)

	# ---------------------------------------------------------------- environment
	# Extinction consistent with the LUT atmosphere (Rayleigh + mountain aerosol at this altitude), raised by
	# weather haze; precipitation, whiteout and valley fog come from Climate's visibility model.
	var clean := 1.36e-5 * exp(-cam_pos.y / 8000.0) + 4.8e-5 * exp(-cam_pos.y / 2000.0)
	var vis := Climate.get_visibility_at(cam_pos)
	var dens := maxf(clean * (1.0 + 4.0 * haze), 3.912 / maxf(vis, 15.0) if vis < 20000.0 else 0.0)
	environment.fog_density = dens
	var vf := Climate.valley_fog
	var vf_inside := vf * clampf((Climate.valley_fog_top - cam_pos.y) / 40.0, 0.0, 1.0)
	var top := Climate.valley_fog_top + 12.0 * sin(_time * 0.021) + 6.0 * sin(_time * 0.057)
	if vf > 0.02 and cam_pos.y > top - 8.0:
		environment.fog_height = top
		environment.fog_height_density = 0.035 * vf
	else:
		environment.fog_height = top
		environment.fog_height_density = 0.0
	var whiteout := maxf(veil, fog * 0.8)
	# Mostly the CPU air-light colour: the radiance map also contains clouds, which the air in front of a
	# mountain does not scatter. A little view dependence keeps sunward haze warmer.
	environment.fog_aerial_perspective = lerpf(0.35, 0.05, whiteout)
	environment.fog_sky_affect = clampf(veil * 1.1 + fog * 0.4, 0.0, 1.0)
	# Volumetric fog saturates distant geometry in whiteouts; the sky must receive the same veil.
	environment.volumetric_fog_sky_affect = environment.fog_sky_affect
	var fe := maxf(fog_col.r, maxf(fog_col.g, fog_col.b))
	environment.fog_light_color = Color(fog_col.r / maxf(fe, 1e-6), fog_col.g / maxf(fe, 1e-6), fog_col.b / maxf(fe, 1e-6)) * Color(_white_balance.r, _white_balance.g, _white_balance.b)
	environment.fog_light_energy = fe
	environment.fog_sun_scatter = (0.015 + 0.12 * haze + 0.12 * vf) * (1.0 - overcast)
	if environment.volumetric_fog_enabled:
		# Extinction per metre: clean air ≈ 1e-4 (60 km visibility); snow murk and whiteouts are far denser.
		environment.volumetric_fog_density = 0.00012 * (1.0 + 6.0 * haze) + 0.006 * pow(precip, 1.5) + 0.05 * fog * fog + 0.004 * vf_inside
		environment.volumetric_fog_anisotropy = lerpf(0.6, 0.25, clampf(precip + overcast * 0.5, 0.0, 1.0))
	environment.tonemap_exposure = _exposure
	# Scotopic vision: colour drains from moonlit scenes.
	var darkness := 1.0 - smoothstep(-10.0, -2.0, el_s)
	environment.adjustment_saturation = lerpf(1.0, 0.78, darkness) * lerpf(1.0, 0.92, overcast)
	# Interiors: shelters shut out most of the sky light (SSAO/SSIL handle the rest on desktop).
	var shelter := Climate.get_shelter_at(cam_pos) if cam else 0.0
	_interior = lerpf(_interior, shelter, 1.0 - exp(-delta * 3.0)) if not _first else shelter
	environment.ambient_light_energy = lerpf(1.0, 0.3, _interior * _interior)

	RenderingServer.global_shader_parameter_set(&"fog_color", Color(fog_col.r * _white_balance.r, fog_col.g * _white_balance.g, fog_col.b * _white_balance.b))
	# Radiance of a small white scatterer (snowflake) lit by the sky below/above and by the sun/moon.
	var e_down := _lum(irr_s + irr_m) * diffuse_t
	if overcast > 0.0:
		e_down = lerpf(e_down, under, overcast)
	var e_up := _lum(ground) * PI
	var amb_tint := _norm(zen + hor).lerp(Color(1, 1, 1), 0.5 + 0.5 * overcast)
	_particle_amb = _wb(_mulc(amb_tint, 0.9 * 0.5 * (e_down + e_up) / PI))
	_particle_sun = _wb(_mulc(light_rgb, 0.9 * 0.5 / PI))
	_particle_dir = light_dir

	# ---------------------------------------------------------------- sky material (throttled on mobile)
	_update_timer -= delta
	_twinkle_time += delta
	_aurora_time += delta * 0.35
	if _update_timer > 0.0 and not _first:
		_first = false
		return
	_update_timer = _update_interval
	var m := sky_material
	var alt_index := _alt_index(cam_pos.y)
	var night := 1.0 - smoothstep(-10.0, -1.0, el_s)
	_u = {
		&"sun_dir": sd, &"moon_dir": md, &"sun_irradiance": SUN_E, &"moon_irradiance": moon_e,
		&"alt_index": alt_index, &"exposure": _exposure, &"fog": fog_col, &"sun_rgb": sun_rgb, &"moon_rgb": moon_rgb,
		&"key": key, &"el_s": el_s, &"el_m": el_m, &"cloud_t_sun": ct_sun, &"veil": veil,
	}
	m.set_shader_parameter(&"sun_dir", sd)
	m.set_shader_parameter(&"moon_dir", md)
	m.set_shader_parameter(&"sun_irradiance", sun_e)
	m.set_shader_parameter(&"moon_irradiance", moon_e)
	m.set_shader_parameter(&"alt_index", alt_index)
	m.set_shader_parameter(&"zenith_luminance", _lum(zen))
	m.set_shader_parameter(&"white_balance", Vector3(_white_balance.r, _white_balance.g, _white_balance.b))
	m.set_shader_parameter(&"ground_radiance", _v3(ground))
	m.set_shader_parameter(&"airglow", AIRGLOW)
	m.set_shader_parameter(&"haze_color", _v3(fog_col))
	m.set_shader_parameter(&"horizon_haze", clampf(haze * 0.45 + vf * 0.2, 0.0, 0.9))
	m.set_shader_parameter(&"precip_veil", veil)
	m.set_shader_parameter(&"veil_zenith", _v3(fog_col.lerp(oc_zen, 0.35 * (1.0 - veil))))
	m.set_shader_parameter(&"veil_horizon", _v3(fog_col))
	# discs
	m.set_shader_parameter(&"sun_disk_radiance", 55.0)
	m.set_shader_parameter(&"sun_transmittance", _v3(t_sun))
	m.set_shader_parameter(&"sun_angular_radius", deg_to_rad(Astronomy.SUN_ANGULAR_RADIUS_DEG))
	m.set_shader_parameter(&"moon_angular_radius", deg_to_rad(Astronomy.MOON_ANGULAR_RADIUS_DEG) * 1.08)
	var moon_frame := _moon_frame(md)
	m.set_shader_parameter(&"moon_right", moon_frame[0])
	m.set_shader_parameter(&"moon_up", moon_frame[1])
	# Physical lunar radiance relative to the sun (full moon ≈ 0.02·E_sun/sr); discs stay readable at night.
	m.set_shader_parameter(&"moon_disk_radiance", 0.028 * SUN_E * 1.2)
	m.set_shader_parameter(&"moon_transmittance", _v3(t_moon))
	m.set_shader_parameter(&"earthshine", 0.012 * (1.0 - Astronomy.moon_illumination(phase)))
	# night sky
	m.set_shader_parameter(&"world_to_eq", Astronomy.equatorial_to_world_basis(Climate.get_sidereal_time()).transposed())
	m.set_shader_parameter(&"star_brightness", STAR_K if el_s < -1.0 else 0.0)
	m.set_shader_parameter(&"milky_way_brightness", MILKY_WAY_K * night)
	m.set_shader_parameter(&"pixel_angle", _pixel_angle(cam))
	m.set_shader_parameter(&"twinkle_time", _twinkle_time)
	m.set_shader_parameter(&"star_extinction", 0.22 + 0.5 * haze)
	# clouds
	m.set_shader_parameter(&"cloud_cover", cover)
	m.set_shader_parameter(&"cloud_density", density)
	m.set_shader_parameter(&"cloud_height", cloud_h)
	m.set_shader_parameter(&"cloud_thickness", lerpf(600.0, 1800.0, density))
	m.set_shader_parameter(&"cloud_offset", _cloud_offset)
	m.set_shader_parameter(&"cloud_scale", CLOUD_SCALE)
	m.set_shader_parameter(&"cloud_sun_color", _v3(cloud_sun))
	m.set_shader_parameter(&"cloud_moon_color", _v3(cloud_moon))
	m.set_shader_parameter(&"cloud_ambient_top", _v3(amb_top))
	m.set_shader_parameter(&"cloud_ambient_bottom", _v3(amb_bottom))
	m.set_shader_parameter(&"cirrus_cover", cirrus)
	m.set_shader_parameter(&"cirrus_height", maxf(8800.0 - cam_pos.y, 4000.0))
	m.set_shader_parameter(&"cirrus_offset", _cirrus_offset)
	m.set_shader_parameter(&"cirrus_axis", jet.normalized() if jet.length() > 0.01 else Vector2(1, 0))
	m.set_shader_parameter(&"cirrus_sun_color", _v3(_mulc(t_cirrus, sun_e)))
	m.set_shader_parameter(&"overcast", overcast)
	m.set_shader_parameter(&"overcast_zenith", _v3(oc_zen))
	m.set_shader_parameter(&"overcast_horizon", _v3(oc_hor.lerp(fog_col, 0.5)))
	var cold := 1.0 - smoothstep(-8.0, 0.0, Climate.get_air_temperature(Vector3(0.0, 3000.0, 0.0)))
	m.set_shader_parameter(&"halo_strength", smoothstep(0.25, 0.55, cirrus) * (0.4 + 0.6 * cold) * (1.0 - cover))
	# aurora
	var ai := Climate.aurora_intensity
	m.set_shader_parameter(&"aurora_intensity", ai)
	m.set_shader_parameter(&"aurora_time", _aurora_time)
	m.set_shader_parameter(&"aurora_distance", lerpf(780000.0, 120000.0, ai))
	var vp := get_viewport()
	if vp:
		var sz := vp.get_visible_rect().size
		m.set_shader_parameter(&"noise_tiles", sz / 64.0)
	_first = false


# ============================================================================================ helpers
func _alt_index(y: float) -> float:
	if y <= LUT_ALTS[0]:
		return 0.0
	for i in 3:
		if y <= LUT_ALTS[i + 1]:
			return float(i) + (y - LUT_ALTS[i]) / (LUT_ALTS[i + 1] - LUT_ALTS[i])
	return 3.0


func _sun_t(el: float) -> float:
	return sqrt(clampf((el + 20.0) / 110.0, 0.0, 1.0)) * 63.0


func _cpu_px(row: int, el: float) -> Color:
	if _cpu == null:
		return Color(0.5, 0.5, 0.5)
	var t := _sun_t(el)
	var i0 := int(t)
	var i1 := mini(i0 + 1, 63)
	return _cpu.get_pixel(i0, row).lerp(_cpu.get_pixel(i1, row), t - float(i0))


## A 4-altitude block (camera altitudes) of the CPU table.
func _row4(base_row: int, alt: float, el: float) -> Color:
	var ai := _alt_index(alt)
	var a0 := int(ai)
	var a1 := mini(a0 + 1, 3)
	return _cpu_px(base_row + a0, el).lerp(_cpu_px(base_row + a1, el), ai - float(a0))


func _trans(alt: float, el: float) -> Color:
	return _trans_any(alt, el)


## Transmittance to the sun from any altitude 1,300 … 9,000 m.
func _trans_any(alt: float, el: float) -> Color:
	var a := clampf(alt, T_ALTS[0], T_ALTS[6])
	for i in 6:
		if a <= T_ALTS[i + 1]:
			var f := (a - T_ALTS[i]) / (T_ALTS[i + 1] - T_ALTS[i])
			return _cpu_px(i, el).lerp(_cpu_px(i + 1, el), f)
	return _cpu_px(6, el)


func _compute_white_balance() -> Color:
	# Daylight white point: the sun at 25° through the valley air renders neutral white.
	var ref := _trans_any(1300.0, 25.0) if _cpu else Color(1, 1, 1)
	var l := _lum(ref)
	return Color(l / maxf(ref.r, 1e-4), l / maxf(ref.g, 1e-4), l / maxf(ref.b, 1e-4))


func _cloud_transmittance(dir: Vector3, cover: float, density: float, overcast: float, cloud_h: float) -> float:
	if dir.y <= 0.0:
		return 1.0 - overcast
	var d := 0.0
	if cover > 0.01 and _cloud_img:
		var r := 6361500.0
		var b := r * dir.y
		var t := cloud_h * (2.0 * r + cloud_h) / (b + sqrt(b * b + cloud_h * (2.0 * r + cloud_h)))
		var uv := Vector2(dir.x, dir.z) * t * CLOUD_SCALE + _cloud_offset
		var base := _sample_cloud(uv, 0)
		var billow := _sample_cloud(uv * 2.3 + Vector2(0.31, 0.77), 1)
		var n := base * 0.64 + billow * 0.36
		var thr := lerpf(0.80, 0.18, cover)
		d = smoothstep(thr - 0.02, thr + 0.16, n)
	d = maxf(d, overcast)
	var tau := d * (2.0 + 16.0 * density)
	return clampf(exp(-tau * 0.8), 0.0, 1.0)


func _sample_cloud(uv: Vector2, ch: int) -> float:
	var w := _cloud_img.get_width()
	var h := _cloud_img.get_height()
	var x := fposmod(uv.x, 1.0) * float(w) - 0.5
	var y := fposmod(uv.y, 1.0) * float(h) - 0.5
	var x0 := int(floorf(x))
	var y0 := int(floorf(y))
	var fx := x - float(x0)
	var fy := y - float(y0)
	var c00: float = _cloud_img.get_pixel(posmod(x0, w), posmod(y0, h))[ch]
	var c10: float = _cloud_img.get_pixel(posmod(x0 + 1, w), posmod(y0, h))[ch]
	var c01: float = _cloud_img.get_pixel(posmod(x0, w), posmod(y0 + 1, h))[ch]
	var c11: float = _cloud_img.get_pixel(posmod(x0 + 1, w), posmod(y0 + 1, h))[ch]
	return lerpf(lerpf(c00, c10, fx), lerpf(c01, c11, fx), fy)


## Moon disc frame: "up" = celestial north projected on the disc (so the maria sit the right way up).
func _moon_frame(md: Vector3) -> Array[Vector3]:
	var pole := Astronomy.equatorial_to_world_basis(Climate.get_sidereal_time()) * Vector3(0, 0, 1)
	var up := (pole - md * pole.dot(md))
	if up.length() < 1e-4:
		up = Vector3.UP
	up = up.normalized()
	var right := md.cross(up).normalized()
	# Seen from the observer looking at the moon: right-handed with the view direction.
	return [-right, up]


func _pixel_angle(cam: Camera3D) -> float:
	var vp := get_viewport()
	if cam == null or vp == null:
		return 0.0012
	var h := vp.get_visible_rect().size.y * vp.scaling_3d_scale
	return deg_to_rad(cam.fov) / maxf(h, 1.0)


static func _lum(c: Color) -> float:
	return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b


static func _norm(c: Color) -> Color:
	var l := _lum(c)
	if l <= 1e-9:
		return Color(1, 1, 1)
	return Color(c.r / l, c.g / l, c.b / l)


static func _mulc(c: Color, k: float) -> Color:
	return Color(c.r * k, c.g * k, c.b * k, 1.0)


static func _v3(c: Color) -> Vector3:
	return Vector3(c.r, c.g, c.b)


func _wb(c: Color) -> Color:
	return Color(c.r * _white_balance.r, c.g * _white_balance.g, c.b * _white_balance.b)

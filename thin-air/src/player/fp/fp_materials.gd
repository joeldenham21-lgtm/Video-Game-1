class_name FPMaterials
extends RefCounted
## Material library for first-person models. `vm(kind)` returns the cached viewmodel ShaderMaterial
## (custom FOV + depth squeeze), `world(kind)` a StandardMaterial3D with the same look for things that
## leave the hands (arrows, thrown spears, flares). Textures: scenes/player/textures (tools/player/gen_fp_textures.py).

const TEX := "res://scenes/player/textures/"
const VM_SHADER_PATH := "res://src/player/shaders/viewmodel.gdshader"
const FX_ADD_PATH := "res://src/player/shaders/viewmodel_fx_add.gdshader"
const FX_MIX_PATH := "res://src/player/shaders/viewmodel_fx_mix.gdshader"
const SCREEN_PATH := "res://src/player/shaders/scanner_screen.gdshader"

## kind -> [texture set, albedo tint, uv_scale, triplanar scale (0 = UV), roughness offset, metallic scale,
##          normal strength, extra dict]
const PRESETS := {
	&"wood_ash": ["wood_ash", Color(1, 1, 1), Vector2(3.0, 2.2), 0.0, 0.0, 0.0, 1.0, {}],
	&"wood_dark": ["wood_dark", Color(1, 1, 1), Vector2(3.0, 2.2), 0.0, 0.0, 0.0, 1.0, {}],
	&"wood_raw": ["wood_raw", Color(1, 1, 1), Vector2(2.5, 2.0), 0.0, 0.05, 0.0, 1.2, {}],
	&"wood_tri": ["wood_raw", Color(0.95, 0.9, 0.85), Vector2.ONE, 10.0, 0.05, 0.0, 1.0, {}],
	&"steel": ["steel", Color(1, 1, 1), Vector2(9.0, 9.0), 0.0, 0.0, 1.0, 1.0,
		{"mask_enabled": 1.0, "mask_albedo": Color(0.78, 0.78, 0.8), "mask_roughness": 0.16}],
	&"steel_tri": ["steel", Color(1, 1, 1), Vector2.ONE, 14.0, 0.0, 1.0, 0.8,
		{"mask_enabled": 1.0, "mask_albedo": Color(0.78, 0.78, 0.8), "mask_roughness": 0.16}],
	&"steel_blued": ["steel", Color(0.55, 0.6, 0.68), Vector2(9.0, 9.0), 0.0, -0.08, 1.0, 0.6,
		{"mask_enabled": 1.0, "mask_albedo": Color(0.82, 0.82, 0.84), "mask_roughness": 0.12}],
	&"stone": ["stone", Color(1.05, 1.02, 0.98), Vector2(10.0, 10.0), 0.0, 0.0, 0.0, 1.3,
		{"mask_enabled": 1.0, "mask_albedo": Color(0.5, 0.48, 0.45), "mask_roughness": 0.38, "mask_metallic": 0.0}],
	&"glove": ["leather", Color(1, 1, 1), Vector2.ONE, 9.0, 0.0, 0.0, 1.0, {"sheen": 0.25}],
	&"glove_dark": ["leather_dark", Color(1, 1, 1), Vector2.ONE, 9.0, 0.0, 0.0, 1.0, {"sheen": 0.2}],
	&"mitt": ["knit", Color(0.34, 0.3, 0.27), Vector2.ONE, 14.0, 0.05, 0.0, 1.2, {"sheen": 0.35}],
	&"skin": ["plastic", Color(0.74, 0.54, 0.44), Vector2.ONE, 30.0, -0.05, 0.0, 0.35, {"sheen": 0.6}],
	&"sleeve": ["fabric", Color(0.2, 0.26, 0.31), Vector2.ONE, 5.0, -0.08, 0.0, 0.6, {"sheen": 0.3}],
	&"sleeve_parka": ["fabric", Color(0.5, 0.13, 0.09), Vector2.ONE, 5.0, -0.12, 0.0, 0.6, {"sheen": 0.3}],
	&"sleeve_down": ["fabric", Color(0.72, 0.36, 0.08), Vector2.ONE, 5.0, -0.15, 0.0, 0.6, {"sheen": 0.35}],
	&"sleeve_hide": ["leather_dark", Color(1.5, 1.25, 1.0), Vector2.ONE, 6.0, 0.08, 0.0, 1.3, {"sheen": 0.2}],
	&"sleeve_fleece": ["knit", Color(0.32, 0.33, 0.34), Vector2.ONE, 10.0, 0.0, 0.0, 0.6, {"sheen": 0.45}],
	&"cuff": ["knit", Color(0.09, 0.09, 0.1), Vector2.ONE, 16.0, 0.0, 0.0, 1.0, {}],
	&"leather": ["leather", Color(0.85, 0.75, 0.65), Vector2(6.0, 6.0), 0.0, 0.0, 0.0, 1.0, {}],
	&"leather_dark": ["leather_dark", Color(1, 1, 1), Vector2(6.0, 6.0), 0.0, 0.0, 0.0, 1.0, {}],
	&"cord": ["canvas", Color(0.55, 0.47, 0.36), Vector2(12.0, 4.0), 0.0, 0.0, 0.0, 1.5, {}],
	&"rubber": ["rubber", Color(1, 1, 1), Vector2(6.0, 6.0), 0.0, 0.0, 0.0, 1.0, {}],
	&"rubber_tri": ["rubber", Color(1, 1, 1), Vector2.ONE, 30.0, 0.0, 0.0, 0.8, {}],
	&"aluminium_blue": ["aluminium", Color(0.13, 0.2, 0.34), Vector2(2.0, 4.0), 0.0, 0.08, 1.0, 1.0, {}],
	&"aluminium_orange": ["aluminium", Color(0.95, 0.42, 0.1), Vector2(2.0, 4.0), 0.0, 0.0, 1.0, 1.0, {}],
	&"aluminium": ["aluminium", Color(0.9, 0.9, 0.9), Vector2(2.0, 4.0), 0.0, 0.0, 1.0, 1.0, {}],
	&"plastic_yellow": ["plastic", Color(0.9, 0.6, 0.08), Vector2.ONE, 18.0, 0.0, 0.0, 1.0, {}],
	&"plastic_dark": ["plastic", Color(0.12, 0.12, 0.13), Vector2.ONE, 18.0, 0.0, 0.0, 1.0, {}],
	&"plastic_orange": ["plastic", Color(0.95, 0.35, 0.05), Vector2.ONE, 18.0, -0.05, 0.0, 1.0, {}],
	&"plastic_red": ["plastic", Color(0.72, 0.07, 0.05), Vector2.ONE, 18.0, 0.0, 0.0, 1.0, {}],
	&"canvas": ["canvas", Color(0.52, 0.5, 0.38), Vector2(8.0, 8.0), 0.0, 0.0, 0.0, 1.0, {}],
	&"canvas_tri": ["canvas", Color(0.5, 0.48, 0.36), Vector2.ONE, 14.0, 0.0, 0.0, 1.0, {}],
	&"cloth_torch": ["canvas", Color(0.42, 0.36, 0.28), Vector2(10.0, 6.0), 0.0, 0.05, 0.0, 1.6,
		{"mask_enabled": 1.0, "mask_albedo": Color(0.05, 0.045, 0.04), "mask_roughness": 0.95, "mask_metallic": 0.0}],
	&"bandage": ["canvas", Color(0.92, 0.9, 0.86), Vector2(10.0, 10.0), 0.0, 0.0, 0.0, 0.8, {}],
	&"paper_red": ["plastic", Color(0.75, 0.08, 0.06), Vector2(3.0, 3.0), 0.0, 0.1, 0.0, 0.5, {}],
	&"map": ["map", Color(1, 1, 1), Vector2.ONE, 0.0, 0.3, 0.0, 0.3, {}],
	&"feather": ["canvas", Color(0.85, 0.82, 0.76), Vector2(20.0, 20.0), 0.0, 0.0, 0.0, 0.5, {}],
	&"glass_dark": ["plastic", Color(0.03, 0.035, 0.04), Vector2(4.0, 4.0), 0.0, -0.45, 0.0, 0.1, {}],
	&"food_bar": ["plastic", Color(0.55, 0.52, 0.3), Vector2(4.0, 4.0), 0.0, -0.1, 0.4, 0.5, {}],
	&"meat_cooked": ["leather", Color(0.55, 0.3, 0.16), Vector2.ONE, 30.0, -0.15, 0.0, 1.4, {}],
	&"meat_raw": ["leather", Color(0.9, 0.35, 0.33), Vector2.ONE, 30.0, -0.3, 0.0, 1.0, {}],
	&"berry": ["plastic", Color(0.12, 0.1, 0.3), Vector2(2.0, 2.0), 0.0, -0.35, 0.0, 0.2, {}],
	&"mushroom": ["leather", Color(1.1, 0.95, 0.75), Vector2.ONE, 30.0, 0.0, 0.0, 0.6, {}],
	&"skin_fish": ["aluminium", Color(0.55, 0.6, 0.55), Vector2(6.0, 6.0), 0.0, 0.1, 0.4, 0.6, {}],
}

static var _vm_cache: Dictionary = {}
static var _world_cache: Dictionary = {}
static var _tex_cache: Dictionary = {}
static var _shader_cache: Dictionary = {}
static var _fx_cache: Dictionary = {}
static var vm_fov := 62.0
static var wet_amount := 0.0


static func tex(file: String) -> Texture2D:
	if _tex_cache.has(file):
		return _tex_cache[file]
	var t: Texture2D = null
	var path := TEX + file
	if ResourceLoader.exists(path):
		t = load(path) as Texture2D
	_tex_cache[file] = t
	return t


static func _shader(path: String) -> Shader:
	if not _shader_cache.has(path):
		_shader_cache[path] = load(path)
	return _shader_cache[path]


static func _set_textures(m: ShaderMaterial, set_name: String) -> void:
	if set_name == "map":
		m.set_shader_parameter(&"albedo_tex", tex("map_albedo.jpg"))
		return
	m.set_shader_parameter(&"albedo_tex", tex(set_name + "_albedo.jpg"))
	m.set_shader_parameter(&"normal_tex", tex(set_name + "_normal.jpg"))
	m.set_shader_parameter(&"orm_tex", tex(set_name + "_orm.jpg"))


## Viewmodel material for a preset kind (shared, cached).
static func vm(kind: StringName) -> ShaderMaterial:
	if _vm_cache.has(kind):
		return _vm_cache[kind]
	var p: Array = PRESETS.get(kind, PRESETS[&"canvas"])
	var m := ShaderMaterial.new()
	m.shader = _shader(VM_SHADER_PATH)
	_set_textures(m, String(p[0]))
	m.set_shader_parameter(&"albedo", p[1])
	m.set_shader_parameter(&"uv_scale", p[2])
	var tri := float(p[3])
	m.set_shader_parameter(&"triplanar", 1.0 if tri > 0.0 else 0.0)
	if tri > 0.0:
		m.set_shader_parameter(&"tri_scale", tri)
	m.set_shader_parameter(&"roughness_offset", float(p[4]))
	m.set_shader_parameter(&"metallic_scale", float(p[5]))
	m.set_shader_parameter(&"normal_strength", float(p[6]))
	var extra: Dictionary = p[7]
	for k in extra:
		m.set_shader_parameter(StringName(k), extra[k])
	m.set_shader_parameter(&"vm_fov", vm_fov)
	m.set_shader_parameter(&"wet", wet_amount)
	_vm_cache[kind] = m
	return m


## A unique (non-shared) copy for per-instance parameters (bow bend, emission).
static func vm_unique(kind: StringName) -> ShaderMaterial:
	return vm(kind).duplicate() as ShaderMaterial


## Emissive viewmodel material (flare tip, embers).
static func vm_emissive(kind: StringName, emission: Color, energy: float) -> ShaderMaterial:
	var m := vm_unique(kind)
	m.set_shader_parameter(&"emission", emission)
	m.set_shader_parameter(&"emission_energy", energy)
	return m


## Additive (flame/spark) or lit smoke particle material with the viewmodel projection.
static func fx(kind: StringName) -> ShaderMaterial:
	if _fx_cache.has(kind):
		return _fx_cache[kind]
	var m := ShaderMaterial.new()
	match kind:
		&"flame":
			m.shader = _shader(FX_ADD_PATH)
			m.set_shader_parameter(&"tex", tex("flame.png"))
			m.set_shader_parameter(&"energy", 2.2)
			m.set_shader_parameter(&"stretch", 0.4)
		&"spark":
			m.shader = _shader(FX_ADD_PATH)
			m.set_shader_parameter(&"tex", tex("spark.png"))
			m.set_shader_parameter(&"energy", 4.0)
		&"glow":
			m.shader = _shader(FX_ADD_PATH)
			m.set_shader_parameter(&"tex", tex("spark.png"))
			m.set_shader_parameter(&"energy", 1.4)
		_:
			m.shader = _shader(FX_MIX_PATH)
			m.set_shader_parameter(&"tex", tex("smoke.png"))
	m.set_shader_parameter(&"vm_fov", vm_fov)
	_fx_cache[kind] = m
	return m


static func screen() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _shader(SCREEN_PATH)
	m.set_shader_parameter(&"vm_fov", vm_fov)
	return m


## In-world (normal projection) material with the same look.
static func world(kind: StringName) -> StandardMaterial3D:
	if _world_cache.has(kind):
		return _world_cache[kind]
	var p: Array = PRESETS.get(kind, PRESETS[&"canvas"])
	var m := StandardMaterial3D.new()
	var set_name := String(p[0])
	if set_name == "map":
		m.albedo_texture = tex("map_albedo.jpg")
	else:
		m.albedo_texture = tex(set_name + "_albedo.jpg")
		m.normal_enabled = true
		m.normal_texture = tex(set_name + "_normal.jpg")
		m.normal_scale = float(p[6])
		var orm := tex(set_name + "_orm.jpg")
		m.roughness_texture = orm
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
		m.metallic_texture = orm
		m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
		m.metallic = float(p[5])
		m.ao_enabled = true
		m.ao_texture = orm
		m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	m.albedo_color = p[1]
	var tri := float(p[3])
	if tri > 0.0:
		m.uv1_triplanar = true
		m.uv1_scale = Vector3.ONE * tri
	else:
		m.uv1_scale = Vector3(p[2].x, p[2].y, 1.0)
	_world_cache[kind] = m
	return m


## Updates the viewmodel FOV on every cached material (Settings change).
static func set_vm_fov(fov: float) -> void:
	vm_fov = fov
	for k in _vm_cache:
		(_vm_cache[k] as ShaderMaterial).set_shader_parameter(&"vm_fov", fov)
	for k in _fx_cache:
		(_fx_cache[k] as ShaderMaterial).set_shader_parameter(&"vm_fov", fov)


## Wet hands/tools look (after swimming / in rain).
static func set_wet(w: float) -> void:
	if is_equal_approx(w, wet_amount):
		return
	wet_amount = w
	for k in _vm_cache:
		(_vm_cache[k] as ShaderMaterial).set_shader_parameter(&"wet", w)


## Converts an imported (glTF) StandardMaterial3D into a viewmodel ShaderMaterial.
static func convert_standard(src: BaseMaterial3D) -> ShaderMaterial:
	var key := "conv_%d" % src.get_instance_id()
	if _vm_cache.has(key):
		return _vm_cache[key]
	var m := ShaderMaterial.new()
	m.shader = _shader(VM_SHADER_PATH)
	m.set_shader_parameter(&"albedo", src.albedo_color)
	if src.albedo_texture:
		m.set_shader_parameter(&"albedo_tex", src.albedo_texture)
	if src.normal_enabled and src.normal_texture:
		m.set_shader_parameter(&"normal_tex", src.normal_texture)
		m.set_shader_parameter(&"normal_strength", src.normal_scale)
	if src.roughness_texture:
		m.set_shader_parameter(&"orm_tex", src.roughness_texture)
		m.set_shader_parameter(&"roughness_scale", src.roughness)
		m.set_shader_parameter(&"metallic_scale", src.metallic)
	else:
		m.set_shader_parameter(&"roughness_scale", 0.0)
		m.set_shader_parameter(&"roughness_offset", src.roughness)
		m.set_shader_parameter(&"metallic_scale", 0.0)
	m.set_shader_parameter(&"emission", src.emission)
	m.set_shader_parameter(&"emission_energy", src.emission_energy_multiplier if src.emission_enabled else 0.0)
	m.set_shader_parameter(&"vm_fov", vm_fov)
	_vm_cache[key] = m
	return m

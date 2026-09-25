class_name BuildMaterials
extends RefCounted
## Materials for player-built pieces. The Blender exporter names each glb surface after a role
## ("log", "planks", "stone", "rope", "bough", "hide", "wool", "metal", …); `for_role()` maps it to a shared
## material: the building log / planks shaders (library textures wood_log, bark_spruce, wood_endgrain,
## wood_planks + snow/wetness) or a library .tres. Frame variants (per blueprint frame) cut away unbuilt
## steps and draw them as a pale ghost on a second pass.

const LIB := "res://assets/materials/%s.tres"
const TEX := "res://assets/textures/%s/%s_%s.png"
const SHADER_LOG := "res://src/building/shaders/building_log.gdshader"
const SHADER_LOG_FRAME := "res://src/building/shaders/building_log_frame.gdshader"
const SHADER_PLANKS := "res://src/building/shaders/building_planks.gdshader"
const SHADER_PLANKS_FRAME := "res://src/building/shaders/building_planks_frame.gdshader"
const SHADER_GHOST := "res://src/building/shaders/building_ghost.gdshader"
const BOUGH_TEX := "res://assets/models/building/textures/spruce_bough_albedo.png"
const BOUGH_NRM := "res://assets/models/building/textures/spruce_bough_normal.png"

const GHOST_OK := Color(0.55, 0.92, 0.62, 0.2)
const GHOST_BAD := Color(0.98, 0.42, 0.36, 0.24)
const GHOST_TODO := Color(0.78, 0.86, 0.95, 0.13)

static var _cache: Dictionary = {}
static var _noise: Texture2D = null


static func noise_texture() -> Texture2D:
	if _noise == null:
		var nt := NoiseTexture2D.new()
		nt.width = 256
		nt.height = 256
		nt.seamless = true
		nt.generate_mipmaps = true
		var fn := FastNoiseLite.new()
		fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		fn.frequency = 0.012
		fn.fractal_octaves = 4
		fn.fractal_gain = 0.55
		fn.seed = 1733
		nt.noise = fn
		nt.normalize = true
		_noise = nt
	return _noise


static func _tex(set_name: String, kind: String) -> Texture2D:
	var p := TEX % [set_name, set_name, kind]
	return load(p) as Texture2D if ResourceLoader.exists(p) else null


static func _log_material(frame: bool) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(SHADER_LOG_FRAME if frame else SHADER_LOG)
	m.set_shader_parameter(&"wood_albedo", _tex("wood_log", "albedo"))
	m.set_shader_parameter(&"wood_normal", _tex("wood_log", "normal"))
	m.set_shader_parameter(&"wood_orm", _tex("wood_log", "orm"))
	m.set_shader_parameter(&"bark_albedo", _tex("bark_spruce", "albedo"))
	m.set_shader_parameter(&"bark_normal", _tex("bark_spruce", "normal"))
	m.set_shader_parameter(&"bark_orm", _tex("bark_spruce", "orm"))
	m.set_shader_parameter(&"end_albedo", _tex("wood_endgrain", "albedo"))
	m.set_shader_parameter(&"end_normal", _tex("wood_endgrain", "normal"))
	m.set_shader_parameter(&"end_orm", _tex("wood_endgrain", "orm"))
	m.set_shader_parameter(&"noise_tex", noise_texture())
	m.resource_name = "building_log"
	return m


static func _planks_material(frame: bool) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(SHADER_PLANKS_FRAME if frame else SHADER_PLANKS)
	m.set_shader_parameter(&"planks_albedo", _tex("wood_planks", "albedo"))
	m.set_shader_parameter(&"planks_normal", _tex("wood_planks", "normal"))
	m.set_shader_parameter(&"planks_orm", _tex("wood_planks", "orm"))
	m.set_shader_parameter(&"noise_tex", noise_texture())
	m.resource_name = "building_planks"
	return m


## Shared material for a glb surface role. Unknown roles fall back to the log material.
static func for_role(role: String) -> Material:
	role = role.get_slice(".", 0)
	if _cache.has(role):
		return _cache[role]
	var m: Material = null
	match role:
		"log":
			m = _log_material(false)
		"planks":
			m = _planks_material(false)
		"stone":
			m = _lib("rock_boulder")
		"rope":
			m = _lib("rope")
		"hide":
			m = _lib("hide")
		"wool":
			m = _lib("fabric_wool")
		"cloth":
			m = _lib("canvas")
		"metal":
			m = _lib("metal_bare")
		"metal_dark":
			m = _lib("metal_rusty")
		"snow":
			m = _lib("snow_packed")
		"bark":
			m = _lib("bark_spruce")
		"bough":
			m = _bough_material()
		"meat":
			m = _simple(Color(0.36, 0.1, 0.07), 0.45, 0.35)
		"coal":
			m = _simple(Color(0.035, 0.03, 0.028), 0.95, 0.0)
		"water":
			m = _simple(Color(0.05, 0.07, 0.08), 0.06, 0.0)
		"fx":
			m = _simple(Color(1.0, 0.6, 0.25), 1.0, 0.0)
		_:
			m = _lib(role) if ResourceLoader.exists(LIB % role) else for_role("log")
	_cache[role] = m
	return m


static func _lib(name: String) -> Material:
	var p := LIB % name
	return load(p) as Material if ResourceLoader.exists(p) else _simple(Color(0.5, 0.5, 0.5), 0.8, 0.0)


static func _simple(c: Color, rough: float, clearcoat: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	if clearcoat > 0.0:
		m.clearcoat_enabled = true
		m.clearcoat = clearcoat
		m.clearcoat_roughness = 0.4
	return m


static func _bough_material() -> Material:
	var m := StandardMaterial3D.new()
	m.resource_name = "building_bough"
	if ResourceLoader.exists(BOUGH_TEX):
		m.albedo_texture = load(BOUGH_TEX)
	else:
		m.albedo_color = Color(0.09, 0.16, 0.08)
	if ResourceLoader.exists(BOUGH_NRM):
		m.normal_enabled = true
		m.normal_texture = load(BOUGH_NRM)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.alpha_scissor_threshold = 0.45
	m.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 0.82
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_BURLEY
	m.backlight_enabled = true
	m.backlight = Color(0.12, 0.16, 0.06)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m


## Replaces every surface material of the meshes under `root` by the shared role material.
static func apply_roles(root: Node) -> void:
	if root is MeshInstance3D:
		var mi := root as MeshInstance3D
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(i)
				var role := src.resource_name if src else "log"
				mi.mesh.surface_set_material(i, for_role(role))
	for c in root.get_children():
		apply_roles(c)


## Frame material for one surface: real material with steps > progress cut away + a ghost pass for them.
static func frame_material(role: String, progress: float) -> Material:
	var base: Material = null
	match role.get_slice(".", 0):
		"log":
			base = _log_material(true)
		"planks":
			base = _planks_material(true)
	var ghost := ghost_material(GHOST_TODO)
	ghost.set_shader_parameter(&"hide_below", progress)
	if base == null:
		# library material: show it once the frame is at least half built, ghost otherwise
		if progress >= 0.5:
			return for_role(role)
		return ghost
	(base as ShaderMaterial).set_shader_parameter(&"build_progress", progress)
	base.next_pass = ghost
	return base


static func set_frame_progress(m: Material, progress: float) -> void:
	if m is ShaderMaterial:
		var sm := m as ShaderMaterial
		if sm.shader and sm.shader.resource_path.ends_with("_frame.gdshader"):
			sm.set_shader_parameter(&"build_progress", progress)
		elif sm.shader and sm.shader.resource_path == SHADER_GHOST:
			sm.set_shader_parameter(&"hide_below", progress)
	if m and m.next_pass:
		set_frame_progress(m.next_pass, progress)


static func ghost_material(c: Color) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(SHADER_GHOST)
	m.set_shader_parameter(&"tint", c)
	m.render_priority = 1
	return m

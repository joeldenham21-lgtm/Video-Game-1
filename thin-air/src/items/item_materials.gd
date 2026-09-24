class_name ItemMaterials
extends RefCounted
## Shared PBR material library for items, pickups, stations and small props.
## Definitions: res://scenes/items/materials/materials.json (also read by the Blender icon renderer, so icons and
## in-game models match). Materials are built once and cached; every pickup of a kind shares them.
## Must not reference autoloads: the icon exporter runs this in a bare SceneTree (`godot -s`).

const DEF_PATH := "res://scenes/items/materials/materials.json"
const TEX_DIR := "res://scenes/items/materials/tex/"

static var _defs: Dictionary = {}
static var _cache: Dictionary = {}
## Cheaper materials (no normal maps, no anisotropic filtering). Set once at startup on low presets.
static var low_quality := false


static func definitions() -> Dictionary:
	if _defs.is_empty():
		var f := FileAccess.open(DEF_PATH, FileAccess.READ)
		if f != null:
			var parsed: Variant = JSON.parse_string(f.get_as_text())
			if parsed is Dictionary:
				_defs = parsed
	return _defs


## Resolved definition (with "base" inheritance applied).
static func definition(key: StringName) -> Dictionary:
	var defs := definitions()
	var k := String(key)
	if not defs.has(k):
		return {}
	var d: Dictionary = defs[k]
	if d.has("base"):
		var merged := definition(StringName(d["base"])).duplicate()
		for field in d:
			if field != "base":
				merged[field] = d[field]
		return merged
	return d


static func has_material(key: StringName) -> bool:
	return definitions().has(String(key))


static func get_material(key: StringName) -> Material:
	if _cache.has(key):
		return _cache[key]
	var m := _build(key)
	_cache[key] = m
	return m


static func clear_cache() -> void:
	_cache.clear()


static func _tex(file: String) -> Texture2D:
	if file == "":
		return null
	var path := TEX_DIR + file
	if not ResourceLoader.exists(path):
		push_warning("ItemMaterials: missing texture %s" % path)
		return null
	return load(path) as Texture2D


static func _color(a: Variant, fallback: Color) -> Color:
	if a is Array and (a as Array).size() >= 3:
		var arr: Array = a
		return Color(float(arr[0]), float(arr[1]), float(arr[2]), float(arr[3]) if arr.size() > 3 else 1.0)
	return fallback


static func _build(key: StringName) -> Material:
	var d := definition(key)
	if d.is_empty():
		push_warning("ItemMaterials: unknown material '%s'" % key)
		var fb := StandardMaterial3D.new()
		fb.albedo_color = Color(0.5, 0.5, 0.5)
		fb.resource_name = String(key)
		return fb
	var has_orm := String(d.get("orm", "")) != ""
	var m: BaseMaterial3D = ORMMaterial3D.new() if has_orm else StandardMaterial3D.new()
	m.resource_name = String(key)
	m.albedo_color = _color(d.get("tint", null), Color.WHITE)
	var alb := _tex(String(d.get("albedo", "")))
	if alb:
		m.albedo_texture = alb
	if has_orm:
		(m as ORMMaterial3D).orm_texture = _tex(String(d["orm"]))
		m.ao_enabled = true
		m.roughness = float(d.get("roughness", 1.0))           # multiplies ORM.g
		m.metallic = float(d.get("metallic", 1.0))             # multiplies ORM.b (0 for non-metals)
	else:
		m.roughness = clampf(float(d.get("roughness", 0.8)), 0.0, 1.0)
		m.metallic = clampf(float(d.get("metallic", 0.0)), 0.0, 1.0)
	var nrm := String(d.get("normal", ""))
	if nrm != "" and not low_quality:
		m.normal_enabled = true
		m.normal_texture = _tex(nrm)
		m.normal_scale = float(d.get("normal_strength", 1.0))
	var s := float(d.get("uv", 4.0))
	m.uv1_scale = Vector3(s, s, s)
	if bool(d.get("triplanar", false)):
		m.uv1_triplanar = true
		m.uv1_world_triplanar = false
		m.uv1_triplanar_sharpness = 4.0
	if bool(d.get("transparent", false)):
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_DEPTH_PRE_PASS
		if bool(d.get("glass", false)):
			m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
			m.rim_enabled = false
	if bool(d.get("double_sided", false)):
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	var em := String(d.get("emission", ""))
	if em != "" or d.has("emission_color"):
		m.emission_enabled = true
		m.emission = _color(d.get("emission_color", null), Color.WHITE)
		m.emission_energy_multiplier = float(d.get("emission_energy", 1.0))
		if em != "":
			m.emission_texture = _tex(em)
	if bool(d.get("unshaded", false)):
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS if low_quality \
		else BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m


## A plain, untextured stand-in carrying only the material name (used when exporting geometry).
static func placeholder(key: StringName) -> Material:
	var m := StandardMaterial3D.new()
	m.resource_name = String(key)
	return m

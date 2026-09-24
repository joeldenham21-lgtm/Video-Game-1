class_name VegLibrary
extends RefCounted
## Vegetation asset catalogue: reads assets/models/vegetation/vegetation.json (written by the Blender
## generators), loads each kind's LOD meshes from its .glb (nodes LOD0/LOD1/LOD2), and builds the shared
## ShaderMaterials (bark.gdshader / foliage.gdshader / rock.gdshader) exactly once per texture set.
## Use VegLibrary.get_shared() — every system shares the same meshes and materials (MultiMeshes, felled
## trees, stumps, previews), so a material parameter change (e.g. view_origin) reaches all of them.

const MANIFEST := "res://assets/models/vegetation/vegetation.json"
const MATERIALS_JSON := "res://assets/materials/materials.json"
const BARK_SHADER := "res://assets/shaders/bark.gdshader"
const FOLIAGE_SHADER := "res://assets/shaders/foliage.gdshader"
const ROCK_SHADER := "res://src/vegetation/shaders/rock.gdshader"
const IMPOSTOR_SHADER := "res://assets/shaders/impostor.gdshader"

## Categories (drive scatter rules, LOD bands, collision and harvesting).
enum Cat { TREE, SAPLING, SHRUB, DEADWOOD, ROCK_BIG, ROCK_SMALL }

## Per species look tweaks (bark tint, foliage tint/translucency). Values tuned against photographs.
const SPECIES_LOOK := {
	&"spruce": {"bark_tint": Color(0.72, 0.7, 0.72), "leaf_tint": Color(1.75, 1.8, 1.8), "transl": 0.5},
	&"fir": {"bark_tint": Color(0.92, 0.9, 0.95), "leaf_tint": Color(1.7, 1.75, 1.7), "transl": 0.45},
	&"lodgepole": {"bark_tint": Color(0.8, 0.82, 0.9), "leaf_tint": Color(1.5, 1.5, 1.5), "transl": 0.55},
	&"whitebark": {"bark_tint": Color(1.35, 1.75, 2.35), "leaf_tint": Color(1.5, 1.5, 1.5), "transl": 0.55},
	&"larch": {"bark_tint": Color(0.85, 0.78, 0.78), "leaf_tint": Color(1.45, 1.4, 1.1), "transl": 0.85},
	&"snag": {"bark_tint": Color(1.0, 1.0, 1.0), "leaf_tint": Color(1.0, 1.0, 1.0), "transl": 0.3},
}

static var _shared: VegLibrary = null

## kind name -> info Dictionary (manifest row + "cat", "index", "meshes": Array[Mesh])
var kinds: Dictionary = {}
## index -> kind name
var kind_names: Array[StringName] = []
var impostor_material: ShaderMaterial = null
var impostor_quad: Mesh = null
## all ShaderMaterials that read the view_origin uniform
var view_materials: Array[ShaderMaterial] = []
var _materials: Dictionary = {}   # key -> Material
var _mat_meta: Dictionary = {}
var _loaded := false


static func get_shared() -> VegLibrary:
	if _shared == null:
		_shared = VegLibrary.new()
		_shared.load_all()
	return _shared


## Drops the shared instance (tests / hot reload).
static func reset_shared() -> void:
	_shared = null


func load_all() -> void:
	if _loaded:
		return
	_loaded = true
	if FileAccess.file_exists(MATERIALS_JSON):
		var mj: Variant = JSON.parse_string(FileAccess.get_file_as_string(MATERIALS_JSON))
		if mj is Dictionary:
			_mat_meta = mj
	if not FileAccess.file_exists(MANIFEST):
		push_warning("VegLibrary: no manifest at %s" % MANIFEST)
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
	if not data is Dictionary:
		push_warning("VegLibrary: bad manifest")
		return
	var sections: Array = ["trees", "plants", "deadwood", "rocks"]
	for sec in sections:
		var rows: Dictionary = (data as Dictionary).get(sec, {})
		var names: Array = rows.keys()
		names.sort()
		for n in names:
			var row: Dictionary = (rows[n] as Dictionary).duplicate(true)
			row["name"] = StringName(n)
			row["cat"] = _category_of(sec, row)
			row["index"] = kind_names.size()
			row["meshes"] = []
			kinds[StringName(n)] = row
			kind_names.append(StringName(n))
	var imp: Variant = (data as Dictionary).get("impostors", {})
	if imp is Dictionary and not (imp as Dictionary).is_empty():
		_setup_impostors(imp)


func _category_of(section: String, row: Dictionary) -> int:
	match section:
		"trees":
			return Cat.SAPLING if bool(row.get("sapling", false)) else Cat.TREE
		"plants":
			return Cat.SHRUB
		"deadwood":
			return Cat.DEADWOOD
		"rocks":
			return Cat.ROCK_BIG if float(row.get("radius", 1.0)) >= 0.9 else Cat.ROCK_SMALL
	return Cat.TREE


func has_kind(kind: StringName) -> bool:
	return kinds.has(kind)


func info(kind: StringName) -> Dictionary:
	return kinds.get(kind, {})


func index_of(kind: StringName) -> int:
	return int(kinds[kind]["index"]) if kinds.has(kind) else -1


## LOD meshes of a kind (loads on first use). Missing LODs repeat the last one found.
func meshes(kind: StringName) -> Array:
	var row: Dictionary = kinds.get(kind, {})
	if row.is_empty():
		return []
	var arr: Array = row["meshes"]
	if not arr.is_empty():
		return arr
	var path := String(row.get("path", ""))
	if path == "" or not ResourceLoader.exists(path):
		push_warning("VegLibrary: missing model %s" % path)
		return []
	var ps := load(path) as PackedScene
	if ps == null:
		return []
	var root := ps.instantiate()
	for lod in 3:
		var mi := root.find_child("LOD%d" % lod, true, false) as MeshInstance3D
		if mi == null or mi.mesh == null:
			if not arr.is_empty():
				arr.append(arr[arr.size() - 1])
			continue
		var m := mi.mesh
		_assign_materials(m, row)
		arr.append(m)
	root.free()
	return arr


func _assign_materials(m: Mesh, row: Dictionary) -> void:
	for s in m.get_surface_count():
		var mat_name := ""
		var cur := m.surface_get_material(s)
		if cur:
			mat_name = cur.resource_name
		if mat_name == "" and m is ArrayMesh:
			mat_name = (m as ArrayMesh).surface_get_name(s)
		m.surface_set_material(s, material_for(mat_name, row))


## Material for a glTF material name: "bark_<set>", "cards_<set>", "rock_<set>", "wood_<set>".
func material_for(mat_name: String, row: Dictionary) -> Material:
	var species := StringName(row.get("species", ""))
	var look: Dictionary = SPECIES_LOOK.get(species, {})
	if mat_name.begins_with("cards_"):
		return foliage_material(mat_name.trim_prefix("cards_"), look)
	if mat_name.begins_with("bark_") or mat_name.begins_with("wood_"):
		return bark_material(mat_name, look.get("bark_tint", Color(1, 1, 1)), float(row.get("moss", 0.0)))
	if mat_name.begins_with("rock"):
		return rock_material(mat_name)
	return bark_material(String(row.get("bark", "bark_spruce")), Color(1, 1, 1), 0.0)


func bark_material(set_name: String, tint: Color, moss := 0.0) -> ShaderMaterial:
	var key := "bark:%s:%s:%.2f" % [set_name, tint.to_html(false), moss]
	if _materials.has(key):
		return _materials[key]
	var m := ShaderMaterial.new()
	m.shader = load(BARK_SHADER)
	var dir := "res://assets/textures/%s/%s_" % [set_name, set_name]
	m.set_shader_parameter(&"albedo_tex", _tex(dir + "albedo.png"))
	m.set_shader_parameter(&"normal_tex", _tex(dir + "normal.png"))
	m.set_shader_parameter(&"orm_tex", _tex(dir + "orm.png"))
	var meta: Dictionary = _mat_meta.get(set_name, {})
	var uvs: Array = meta.get("uv1_scale", [2.0, 1.0])
	m.set_shader_parameter(&"uv_scale", Vector2(float(uvs[0]), float(uvs[1])))
	m.set_shader_parameter(&"tint", Vector3(tint.r, tint.g, tint.b))
	m.set_shader_parameter(&"moss_amount", moss)
	m.resource_name = key
	_materials[key] = m
	view_materials.append(m)
	return m


func foliage_material(set_name: String, look: Dictionary) -> ShaderMaterial:
	var key := "cards:%s" % set_name
	if _materials.has(key):
		return _materials[key]
	var m := ShaderMaterial.new()
	m.shader = load(FOLIAGE_SHADER)
	var alb := _tex("res://assets/textures/foliage/%s_albedo.png" % set_name)
	m.set_shader_parameter(&"albedo_tex", alb)
	m.set_shader_parameter(&"normal_tex", _tex("res://assets/textures/foliage/%s_normal.png" % set_name))
	if alb:
		m.set_shader_parameter(&"atlas_size", Vector2(alb.get_width(), alb.get_height()))
	var tint: Color = look.get("leaf_tint", Color(1, 1, 1))
	m.set_shader_parameter(&"tint", Vector3(tint.r, tint.g, tint.b))
	m.set_shader_parameter(&"translucency", float(look.get("transl", 0.55)))
	m.resource_name = key
	_materials[key] = m
	view_materials.append(m)
	return m


func rock_material(mat_name: String) -> Material:
	var key := "rock:%s" % mat_name
	if _materials.has(key):
		return _materials[key]
	var m: Material
	if ResourceLoader.exists(ROCK_SHADER):
		var sm := ShaderMaterial.new()
		sm.shader = load(ROCK_SHADER)
		var dir := "res://assets/textures/rock_boulder/rock_boulder_"
		sm.set_shader_parameter(&"albedo_tex", _tex(dir + "albedo.png"))
		sm.set_shader_parameter(&"normal_tex", _tex(dir + "normal.png"))
		sm.set_shader_parameter(&"orm_tex", _tex(dir + "orm.png"))
		view_materials.append(sm)
		m = sm
	else:
		m = load("res://assets/materials/rock_boulder.tres")
	m.resource_name = key
	_materials[key] = m
	return m


func _tex(path: String) -> Texture2D:
	if ResourceLoader.exists(path):
		return load(path) as Texture2D
	push_warning("VegLibrary: missing texture %s" % path)
	return null


# ---------------------------------------------------------------------------------------------- impostors

func _setup_impostors(imp: Dictionary) -> void:
	if not ResourceLoader.exists(IMPOSTOR_SHADER):
		return
	var alb_path := String(imp.get("albedo", ""))
	var nrm_path := String(imp.get("normal", ""))
	if not ResourceLoader.exists(alb_path) or not ResourceLoader.exists(nrm_path):
		return
	var m := ShaderMaterial.new()
	m.shader = load(IMPOSTOR_SHADER)
	m.set_shader_parameter(&"albedo_array", load(alb_path))
	m.set_shader_parameter(&"normal_array", load(nrm_path))
	m.set_shader_parameter(&"frames", float(imp.get("frames", 8)))
	impostor_material = m
	view_materials.append(m)
	var layers: Dictionary = imp.get("layers", {})
	for k in layers:
		var kn := StringName(k)
		if kinds.has(kn):
			var l: Dictionary = layers[k]
			kinds[kn]["impostor_layer"] = int(l.get("layer", -1))
			kinds[kn]["impostor_size"] = float(l.get("size", 10.0))
			kinds[kn]["impostor_center"] = float(l.get("center_y", 5.0))
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 1.0)
	q.material = m
	impostor_quad = q


func has_impostors() -> bool:
	return impostor_material != null


## Pushes the main camera position to every vegetation material (LOD fades use it in all passes).
func set_view_origin(p: Vector3) -> void:
	for m in view_materials:
		m.set_shader_parameter(&"view_origin", p)

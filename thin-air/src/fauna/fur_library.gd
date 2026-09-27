class_name FurLibrary
extends RefCounted
## Shared fur materials per species: one base coat ShaderMaterial and shell chains (next_pass) for each
## shell count. Materials are created once and shared by every animal of the species (batching-friendly).
## Shell budget by preset: ultra 16, high 12, medium 8, low 4, mobile_high 3, mobile_low 2 — and only for animals
## close to the camera (Animal.set_lod()).

const BASE_SHADER := "res://assets/shaders/fur_base.gdshader"
const SHELL_SHADER := "res://assets/shaders/fur_shell.gdshader"
const STRAND_TEX := "res://assets/textures/fauna/fur_strands.png"
const STRAND_TILE_M := 0.26     ## metres of fur covered by one strand-texture tile (128 strands across)

static var _base: Dictionary = {}     # species id -> ShaderMaterial
static var _chains: Dictionary = {}   # "id:n" -> ShaderMaterial (head of chain)
static var _eyes: Dictionary = {}


static func shell_budget() -> int:
	var p := StringName(Settings.preset) if Settings.get("preset") != null else &"high"
	match p:
		&"ultra":
			return 16
		&"high":
			return 12
		&"medium":
			return 8
		&"low":
			return 4
		&"mobile_high":
			return 3
		&"mobile_low":
			return 2
	return 3 if Settings.is_mobile() else 12


static func _strand_scale(def: SpeciesDef) -> float:
	var uv_m := float(def.load_meta().get("uv_meters", 1.6))
	return uv_m / STRAND_TILE_M


static func base_material(def: SpeciesDef) -> ShaderMaterial:
	if _base.has(def.id):
		return _base[def.id]
	var m := ShaderMaterial.new()
	m.shader = load(BASE_SHADER)
	var coat: Texture2D = load(def.coat_path) if ResourceLoader.exists(def.coat_path) else null
	m.set_shader_parameter(&"coat_tex", coat)
	m.set_shader_parameter(&"strand_tex", load(STRAND_TEX) if ResourceLoader.exists(STRAND_TEX) else null)
	m.set_shader_parameter(&"strand_scale", _strand_scale(def))
	m.set_shader_parameter(&"tint", Vector3(def.fur_tint.r, def.fur_tint.g, def.fur_tint.b))
	m.set_shader_parameter(&"sheen", def.fur_sheen)
	_base[def.id] = m
	return m


## Head of a chain of `count` shell materials (shell_t = i / count), or null for count 0.
static func shell_chain(def: SpeciesDef, count: int) -> ShaderMaterial:
	if count <= 0 or def.fur_length <= 0.0:
		return null
	var key := "%s:%d" % [def.id, count]
	if _chains.has(key):
		return _chains[key]
	var base := base_material(def)
	var shader: Shader = load(SHELL_SHADER)
	var head: ShaderMaterial = null
	var prev: ShaderMaterial = null
	for i in count:
		var m := ShaderMaterial.new()
		m.shader = shader
		m.render_priority = i
		m.set_shader_parameter(&"coat_tex", base.get_shader_parameter(&"coat_tex"))
		m.set_shader_parameter(&"strand_tex", base.get_shader_parameter(&"strand_tex"))
		m.set_shader_parameter(&"strand_scale", base.get_shader_parameter(&"strand_scale"))
		m.set_shader_parameter(&"shell_t", float(i + 1) / float(count))
		m.set_shader_parameter(&"fur_length", def.fur_length)
		m.set_shader_parameter(&"comb", def.comb)
		m.set_shader_parameter(&"tint", Vector3(def.fur_tint.r, def.fur_tint.g, def.fur_tint.b))
		m.set_shader_parameter(&"sheen", def.fur_sheen)
		if prev:
			prev.next_pass = m
		else:
			head = m
		prev = m
	_chains[key] = head
	return head


static func eye_material(def: SpeciesDef) -> StandardMaterial3D:
	if _eyes.has(def.id):
		return _eyes[def.id]
	var m := StandardMaterial3D.new()
	m.albedo_color = def.eye_color
	m.roughness = 0.08
	m.metallic_specular = 0.9
	m.clearcoat_enabled = true
	m.clearcoat = 1.0
	m.clearcoat_roughness = 0.03
	_eyes[def.id] = m
	return m

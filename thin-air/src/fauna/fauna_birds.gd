extends Node3D
## Ambient birds (no physics, no AI ticks): a raven flock that finds carcasses and circles over them calling —
## a hint to the player — or passes over the valley in daylight; and a golden eagle soaring in wide circles above
## ridges at altitude by day. Meshes from the Blender fauna pipeline; wings flap in fur_bird.gdshader
## (instance uniforms: flap, flap_phase, flap_rate), so birds cost one draw call each and no skinning.

const RAVEN_MODEL := "res://assets/models/fauna/raven.glb"
const EAGLE_MODEL := "res://assets/models/fauna/eagle.glb"
const SHADER := "res://assets/shaders/fur_bird.gdshader"
const RAVENS := 6

var ravens: Array[MeshInstance3D] = []
var eagle: MeshInstance3D = null
var raven_center := Vector3.ZERO
var raven_mode := 0            # 0 away, 1 circling a carcass, 2 flyover
var raven_t := 0.0
var raven_fly_dir := Vector3.FORWARD
var eagle_center := Vector3.ZERO
var eagle_on := false
var eagle_t := 0.0
var _caw_t := 5.0
var _cry_t := 20.0
var _check_t := 0.0
var _rng := RandomNumberGenerator.new()
var _seeds := PackedFloat32Array()
var _mgr: FaunaManager = null


func _ready() -> void:
	_rng.seed = 555
	_mgr = get_parent() as FaunaManager
	var rm := _mesh_of(RAVEN_MODEL)
	if rm:
		var mat := _material(Color(0.025, 0.025, 0.03), Color(0.018, 0.018, 0.022), Color(0.025, 0.025, 0.03), 0.07, 0.62, 0.45)
		for i in RAVENS:
			var mi := MeshInstance3D.new()
			mi.mesh = rm
			mi.material_override = mat
			mi.visible = false
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mi)
			mi.set_instance_shader_parameter(&"flap_phase", _rng.randf() * TAU)
			mi.set_instance_shader_parameter(&"flap_rate", _rng.randf_range(3.2, 3.8))
			ravens.append(mi)
			_seeds.append(_rng.randf())
	var em := _mesh_of(EAGLE_MODEL)
	if em:
		eagle = MeshInstance3D.new()
		eagle.mesh = em
		eagle.material_override = _material(Color(0.2, 0.13, 0.07), Color(0.1, 0.07, 0.045), Color(0.55, 0.4, 0.2), -0.3, 1.05, 0.2)
		eagle.visible = false
		eagle.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		eagle.set_instance_shader_parameter(&"flap_rate", 2.2)
		add_child(eagle)


func _mesh_of(path: String) -> Mesh:
	if not ResourceLoader.exists(path):
		return null
	var inst := (load(path) as PackedScene).instantiate()
	var m: Mesh = null
	for n in inst.find_children("*", "MeshInstance3D", true, false):
		m = (n as MeshInstance3D).mesh
		break
	inst.free()
	return m


func _material(body: Color, wing: Color, head: Color, head_z: float, span_half: float, gloss: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(SHADER)
	m.set_shader_parameter(&"color_body", Vector3(body.r, body.g, body.b))
	m.set_shader_parameter(&"color_wing", Vector3(wing.r, wing.g, wing.b))
	m.set_shader_parameter(&"color_head", Vector3(head.r, head.g, head.b))
	m.set_shader_parameter(&"head_z", head_z)
	m.set_shader_parameter(&"span_half", span_half)
	m.set_shader_parameter(&"body_half", 0.07 if span_half < 0.8 else 0.1)
	m.set_shader_parameter(&"gloss", gloss)
	return m


## Dev/QA: force ravens circling at a point, or the eagle soaring around a centre.
func force_ravens(center: Vector3) -> void:
	raven_mode = 1
	raven_center = center
	for r in ravens:
		r.visible = true


func force_eagle(center: Vector3) -> void:
	eagle_on = true
	eagle_center = center
	if eagle:
		eagle.visible = true


func _physics_process(delta: float) -> void:
	if _mgr == null:
		return
	_check_t -= delta
	if _check_t <= 0.0:
		_check_t = 3.0
		if FaunaManager.spawning_enabled:
			_decide()
	_update_ravens(delta)
	_update_eagle(delta)


func _decide() -> void:
	var day := Climate.get_daylight()
	var pp := _mgr.player_pos
	if not _mgr.player_valid:
		return
	var best: Animal = null
	var bd := 380.0
	for a in _mgr.animals:
		if a.dead and not a.butchered:
			var d := a.global_position.distance_to(pp)
			if d < bd:
				bd = d
				best = a
	if best and day > 0.25:
		raven_mode = 1
		raven_center = best.global_position
	elif raven_mode == 1:
		raven_mode = 0
	if raven_mode == 0 and day > 0.4 and _rng.randf() < 0.02:
		raven_mode = 2
		raven_t = 0.0
		var a := _rng.randf() * TAU
		raven_fly_dir = Vector3(sin(a), 0.0, cos(a))
		raven_center = pp - raven_fly_dir * 300.0
	var alt_ok := pp.y > 1750.0 or TerrainData.get_biome(pp.x, pp.z) != &"valley"
	if day > 0.45 and alt_ok:
		if not eagle_on:
			eagle_on = true
			eagle_center = _ridge_near(pp)
	else:
		eagle_on = false
	for r in ravens:
		r.visible = raven_mode != 0
	if eagle:
		eagle.visible = eagle_on


func _ridge_near(p: Vector3) -> Vector3:
	var best := p
	var bh := -INF
	for i in 16:
		var a := TAU * float(i) / 16.0
		for r in [150.0, 300.0]:
			var x: float = p.x + sin(a) * r
			var z: float = p.z + cos(a) * r
			var h := TerrainData.get_height(x, z)
			if h > bh:
				bh = h
				best = Vector3(x, h, z)
	return best


func _update_ravens(delta: float) -> void:
	if raven_mode == 0 or ravens.is_empty():
		return
	raven_t += delta
	var t := raven_t
	for i in ravens.size():
		var r := ravens[i]
		var s := _seeds[i]
		var pos: Vector3
		var fwd: Vector3
		var flap := 0.0
		if raven_mode == 1:
			var rad := 9.0 + 7.0 * s
			var w := (0.35 + 0.2 * s) * (1.0 if i % 2 == 0 else -1.0)
			var a := t * w + s * TAU
			var h := 20.0 + 14.0 * s + 3.0 * sin(t * 0.3 + s * 9.0)
			pos = raven_center + Vector3(sin(a) * rad, h, cos(a) * rad)
			fwd = Vector3(cos(a), 0.0, -sin(a)) * signf(w)
			flap = 0.5 + 0.5 * sin(t * 0.7 + s * 17.0)
			flap = 1.0 if flap > 0.75 else 0.0
		else:
			pos = raven_center + raven_fly_dir * (t * 11.0 + s * 6.0) + Vector3(s * 8.0 - 4.0, 45.0 + 6.0 * s, float(i) * 3.0)
			pos.y = maxf(pos.y, TerrainData.get_height(pos.x, pos.z) + 35.0)
			fwd = raven_fly_dir
			flap = 1.0 if fmod(t + s * 3.0, 2.2) < 1.4 else 0.0
			if t > 60.0:
				raven_mode = 0
		r.set_instance_shader_parameter(&"flap", flap)
		var bank := 0.35 if raven_mode == 1 else 0.0
		r.global_transform = Transform3D(Basis.looking_at(fwd, Vector3.UP).rotated(fwd, bank * signf(sin(float(i)) + 0.1)), pos)
	_caw_t -= delta
	if _caw_t <= 0.0 and raven_mode != 0:
		_caw_t = _rng.randf_range(3.0, 9.0) if raven_mode == 1 else _rng.randf_range(6.0, 14.0)
		Audio.play_sfx(&"raven_caw", ravens[_rng.randi() % ravens.size()].global_position, 0.0, _rng.randf_range(0.9, 1.1))


func _update_eagle(delta: float) -> void:
	if eagle == null or not eagle_on:
		return
	eagle_t += delta
	var a := eagle_t * 0.09
	var rad := 70.0 + 15.0 * sin(eagle_t * 0.05)
	var pos := eagle_center + Vector3(sin(a) * rad, 130.0 + 25.0 * sin(eagle_t * 0.04), cos(a) * rad)
	var fwd := Vector3(cos(a), 0.0, -sin(a))
	eagle.global_transform = Transform3D(Basis.looking_at(fwd, Vector3.UP).rotated(fwd, -0.22), pos)
	eagle.set_instance_shader_parameter(&"flap", 1.0 if fmod(eagle_t, 40.0) < 2.5 else 0.0)
	_cry_t -= delta
	if _cry_t <= 0.0:
		_cry_t = _rng.randf_range(25.0, 60.0)
		Audio.play_sfx(&"eagle_cry", pos, 0.0, _rng.randf_range(0.95, 1.05))

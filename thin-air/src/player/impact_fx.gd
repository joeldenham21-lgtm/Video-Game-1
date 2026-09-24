class_name ImpactFX
extends RefCounted
## One-shot world-space impact particles for tool hits: wood chips, stone chips + sparks, snow and ice
## puffs, blood, dust. Cheap CPUParticles3D bursts (fewer on mobile), freed after they finish.

const KINDS := {
	# amount, lifetime, speed min/max, gravity, size min/max, colour, additive, spread
	&"wood": [12, 0.9, 1.8, 4.0, 9.0, 0.012, 0.03, Color(0.52, 0.38, 0.24), false, 55.0],
	&"stone": [10, 0.7, 1.5, 3.5, 9.0, 0.008, 0.022, Color(0.42, 0.41, 0.4), false, 60.0],
	&"sparks": [14, 0.32, 3.5, 7.5, 9.0, 0.006, 0.012, Color(3.0, 1.9, 0.8), true, 70.0],
	&"snow": [18, 1.1, 0.6, 2.2, 2.0, 0.03, 0.08, Color(0.95, 0.97, 1.0, 0.8), false, 80.0],
	&"ice": [12, 0.8, 1.2, 3.2, 9.0, 0.008, 0.02, Color(0.8, 0.9, 1.0), false, 60.0],
	&"blood": [10, 0.7, 0.8, 2.6, 9.0, 0.008, 0.018, Color(0.3, 0.02, 0.02), false, 45.0],
	&"dust": [10, 1.0, 0.4, 1.4, 1.0, 0.04, 0.09, Color(0.5, 0.46, 0.4, 0.5), false, 80.0],
	&"splash": [22, 0.9, 1.0, 3.2, 9.0, 0.02, 0.05, Color(0.85, 0.92, 0.95, 0.7), false, 40.0],
}

static var _mats: Dictionary = {}
static var _mesh: QuadMesh = null


static func _material(additive: bool) -> StandardMaterial3D:
	var key := additive
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_texture = FPMaterials.tex("spark.png") if additive else FPMaterials.tex("smoke.png")
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	else:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
		m.roughness = 1.0
	_mats[key] = m
	return m


static func spawn(parent: Node, kind: StringName, point: Vector3, normal: Vector3) -> void:
	if parent == null or not parent.is_inside_tree():
		return
	var cfg: Array = KINDS.get(kind, KINDS[&"dust"])
	if _mesh == null:
		_mesh = QuadMesh.new()
		_mesh.size = Vector2.ONE
	var p := CPUParticles3D.new()
	var additive: bool = cfg[8]
	var quad := _mesh.duplicate() as QuadMesh
	quad.material = _material(additive)
	p.mesh = quad
	var mobile := Settings.is_mobile() or int(Settings.get_value(&"particles", 2)) == 0
	p.amount = maxi(4, int(cfg[0]) / (2 if mobile else 1))
	p.lifetime = float(cfg[1])
	p.one_shot = true
	p.explosiveness = 0.95
	p.local_coords = false
	p.direction = Vector3(0.0, 0.0, 1.0)
	p.spread = float(cfg[9])
	p.initial_velocity_min = float(cfg[2])
	p.initial_velocity_max = float(cfg[3])
	p.gravity = Vector3(0.0, -float(cfg[4]), 0.0)
	p.damping_min = 0.5
	p.damping_max = 1.5
	p.scale_amount_min = float(cfg[5])
	p.scale_amount_max = float(cfg[6])
	p.angle_min = -180.0
	p.angle_max = 180.0
	var col: Color = cfg[7]
	var g := Gradient.new()
	g.set_color(0, col)
	g.set_color(1, Color(col.r, col.g, col.b, 0.0))
	p.color_ramp = g
	parent.add_child(p)
	var n := normal.normalized() if normal.length_squared() > 1e-6 else Vector3.UP
	var up := Vector3.UP if absf(n.y) < 0.95 else Vector3.RIGHT
	p.global_transform = Transform3D(Basis.looking_at(-n, up), point + n * 0.02)
	p.emitting = true
	var tree := p.get_tree()
	if tree:
		tree.create_timer(p.lifetime + 0.3, false).timeout.connect(p.queue_free)

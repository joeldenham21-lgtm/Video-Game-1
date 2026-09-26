class_name BuildFX
extends RefCounted
## Small fire / steam effects for camp pieces (torch stand, snow melter), built from the items stream's fire
## sprites (scenes/items/fx: 4×4 flame flipbook, smoke puffs, glow) so every flame in the game matches.

const FLAME_SHEET := "res://scenes/items/fx/flame_sheet.png"
const SMOKE_SHEET := "res://scenes/items/fx/smoke_sheet.png"
const GLOW := "res://scenes/items/fx/glow.png"


static func _gradient(stops: Array) -> GradientTexture1D:
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	for s in stops:
		offs.append(float(s[0]))
		cols.append(s[1])
	g.offsets = offs
	g.colors = cols
	var t := GradientTexture1D.new()
	t.gradient = g
	t.width = 64
	return t


static func _curve(points: Array) -> CurveTexture:
	var c := Curve.new()
	for p in points:
		c.add_point(Vector2(float(p[0]), float(p[1])))
	var t := CurveTexture.new()
	t.curve = c
	t.width = 32
	return t


## A torch-sized flame (flipbook sprites) + a thin smoke trail. Returns {"flames", "smoke", "glow"}.
static func torch_flame(parent: Node3D, at: Vector3, scale := 1.0, mobile := false) -> Dictionary:
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	fm.billboard_keep_scale = true
	fm.particles_anim_h_frames = 4
	fm.particles_anim_v_frames = 4
	fm.particles_anim_loop = true
	fm.vertex_color_use_as_albedo = true
	fm.albedo_texture = load(FLAME_SHEET)
	fm.albedo_color = Color(2.2, 2.05, 1.9)
	var q := QuadMesh.new()
	q.size = Vector2(0.3, 0.42) * scale
	q.center_offset = Vector3(0.0, 0.16 * scale, 0.0)
	q.material = fm
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.03 * scale
	pm.direction = Vector3.UP
	pm.spread = 8.0
	pm.initial_velocity_min = 0.05
	pm.initial_velocity_max = 0.15
	pm.gravity = Vector3(0.0, 0.25, 0.0)
	pm.scale_min = 0.75
	pm.scale_max = 1.15
	pm.anim_speed_min = 0.9
	pm.anim_speed_max = 1.3
	pm.anim_offset_max = 1.0
	pm.scale_curve = _curve([[0.0, 0.3], [0.25, 1.0], [1.0, 0.55]])
	pm.color_ramp = _gradient([[0.0, Color(1, 1, 1, 0)], [0.2, Color(1, 1, 1, 1)], [0.75, Color(1, 0.9, 0.8, 0.8)], [1.0, Color(1, 0.8, 0.6, 0)]])
	var flames := GPUParticles3D.new()
	flames.name = "Flame"
	flames.amount = 6
	flames.lifetime = 0.7
	flames.randomness = 0.3
	flames.fixed_fps = 30
	flames.draw_pass_1 = q
	flames.process_material = pm
	flames.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	flames.visibility_aabb = AABB(Vector3(-1, -0.5, -1), Vector3(2, 3, 2))
	flames.position = at
	flames.emitting = false
	parent.add_child(flames)
	var smoke := steam(parent, at + Vector3(0.0, 0.35 * scale, 0.0), Color(0.18, 0.17, 0.16, 0.35), 0.6 * scale, mobile)
	var glow := MeshInstance3D.new()
	glow.name = "Glow"
	var gq := QuadMesh.new()
	gq.size = Vector2(0.9, 0.9) * scale
	var gm := StandardMaterial3D.new()
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	gm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	gm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	gm.albedo_texture = load(GLOW)
	gm.albedo_color = Color(1.0, 0.5, 0.2, 0.35)
	gq.material = gm
	glow.mesh = gq
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	glow.position = at + Vector3(0.0, 0.12 * scale, 0.0)
	glow.visible = false
	parent.add_child(glow)
	return {"flames": flames, "smoke": smoke, "glow": glow}


## Rising steam / smoke puffs (snow melter steam, torch smoke).
static func steam(parent: Node3D, at: Vector3, col: Color, size := 0.5, mobile := false) -> GPUParticles3D:
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.particles_anim_h_frames = 2
	m.particles_anim_v_frames = 2
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = load(SMOKE_SHEET)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX if mobile else BaseMaterial3D.SHADING_MODE_PER_PIXEL
	m.roughness = 1.0
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	q.material = m
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.06
	pm.direction = Vector3.UP
	pm.spread = 12.0
	pm.initial_velocity_min = 0.2
	pm.initial_velocity_max = 0.45
	pm.gravity = Vector3(0.25, 0.3, 0.0)
	pm.damping_min = 0.2
	pm.damping_max = 0.4
	pm.scale_min = 0.6
	pm.scale_max = 1.1
	pm.anim_offset_max = 1.0
	pm.angle_min = -180.0
	pm.angle_max = 180.0
	pm.scale_curve = _curve([[0.0, 0.35], [1.0, 1.6]])
	pm.color_ramp = _gradient([[0.0, Color(col.r, col.g, col.b, 0.0)], [0.2, col], [1.0, Color(col.r, col.g, col.b, 0.0)]])
	var p := GPUParticles3D.new()
	p.name = "Steam"
	p.amount = 8 if not mobile else 5
	p.lifetime = 2.6
	p.randomness = 0.4
	p.fixed_fps = 30
	p.draw_pass_1 = q
	p.process_material = pm
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-2, -0.5, -2), Vector3(4, 5, 4))
	p.position = at
	p.emitting = false
	parent.add_child(p)
	return p


## Game hours elapsed since `last` (Climate clock, includes sleep / advance_time jumps). Returns [dt_h, now].
static func game_hours_since(last: float) -> Array:
	var now := float(Climate.day) * 24.0 + float(Climate.hours)
	if last < 0.0 or now < last:
		return [0.0, now]
	return [now - last, now]


## Nearest active heat source (not a room-heat helper) within `radius` m of `pos`, or null.
static func active_heat_near(pos: Vector3, radius: float, exclude: Node = null) -> Node3D:
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return null
	var best: Node3D = null
	var best_d := radius
	for n in tree.get_nodes_in_group(&"heat_source"):
		if n == exclude or n is BuildRoomHeat or not (n is Node3D):
			continue
		if n.has_method(&"is_heat_active") and not n.call(&"is_heat_active"):
			continue
		var d := (n as Node3D).global_position.distance_to(pos)
		if d <= best_d:
			best_d = d
			best = n
	return best

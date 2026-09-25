class_name VegFelledTree
extends RigidBody3D
## A felled tree: the upper part of the chopped tree as a rigid body (layer 4 "items": felled logs). It pivots
## on a hinge at the cut until the crown hits the ground (real trees hinge on the holding wood, then the
## butt kicks off the stump), hits the ground (tree_impact sound, noise event, camera shake / damage near the player, snow or
## needle puff), settles and freezes. Then it is bucked with an axe: every log's worth of damage cuts the
## butt section off as a 'log' pickup (clip plane + end cap move up the trunk); after the last log the crown
## is left as a few sticks. Body local frame: origin at the felling cut, +Y along the trunk.

enum State { FALLING, DOWN }

const LAYER_ITEMS := 1 << 3
## Falls through neighbouring trunks (layer 10) and pickups: in a 4 m-spaced forest almost every tree would
## otherwise hang up. Collides with terrain/rocks (1) and player structures (7).
const MASK := 1 | (1 << 6)
const LOG_LEN := 2.4                                  # m of trunk per 'log' item

var harvest: Node = null                  # VegHarvest
var instance_id := -1
var kind: StringName = &""
var species: StringName = &""
var s := 1.0                              # instance scale
var cut_obj := 0.5                        # object-space y of the felling cut
var buck_obj := 0.5                       # current butt end (object space)
var logs_left := 0
var log_obj := 2.4                        # object-space length of one log
var seg_hp := 30.0
var seg_max := 30.0
var state := State.FALLING
var fall_dir := Vector3.FORWARD           # horizontal, world
var trunk_r := 0.2                        # world radius at the cut

var mesh_node: MeshInstance3D
var cap_node: MeshInstance3D
var trunk_shape: CollisionShape3D
var crown_shape: CollisionShape3D
var joint: HingeJoint3D
var stump_body: PhysicsBody3D

var _t := 0.0
var _impacted := false
var _calm_t := 0.0
var _h_obj := 20.0
var _crown_base_obj := 3.0


## Builds the body (call after adding it to the tree). `mesh` = tree LOD0 (shared), `xf` = the standing
## instance transform, `cut_h` = world metres above the instance origin, `cap_r` = trunk radius at the cut.
func setup(p_harvest: Node, id: int, p_kind: StringName, info: Dictionary, mesh: Mesh, xf: Transform3D,
		cut_h: float, cap_r: float, cap_mesh: Mesh) -> void:
	harvest = p_harvest
	instance_id = id
	kind = p_kind
	species = StringName(info.get("species", "tree"))
	s = xf.basis.get_scale().x
	cut_obj = cut_h / s
	buck_obj = cut_obj
	_h_obj = float(info.get("height", 15.0))
	_crown_base_obj = float(info.get("crown_base", _h_obj * 0.3))
	trunk_r = cap_r
	collision_layer = LAYER_ITEMS
	collision_mask = MASK
	add_to_group(&"harvestable")
	add_to_group(&"felled_tree")
	set_meta(&"surface", &"wood")
	# frame: origin at the cut, same orientation as the standing tree (without scale)
	var rot := xf.basis.orthonormalized()
	global_transform = Transform3D(rot, xf.origin + rot.y * cut_h)
	mesh_node = MeshInstance3D.new()
	mesh_node.name = "Mesh"
	mesh_node.mesh = mesh
	mesh_node.transform = Transform3D(Basis().scaled(Vector3.ONE * s), Vector3(0.0, -cut_h, 0.0))
	mesh_node.set_instance_shader_parameter(&"clip_below", buck_obj)
	mesh_node.set_instance_shader_parameter(&"wind_scale", 0.0)
	add_child(mesh_node)
	cap_node = MeshInstance3D.new()
	cap_node.name = "Cap"
	cap_node.mesh = cap_mesh
	cap_node.scale = Vector3(cap_r, 1.0, cap_r)
	cap_node.rotation = Vector3(PI, 0.0, 0.0)          # facing down the trunk (the butt end)
	add_child(cap_node)
	# physics: trunk capsule + a thin crown cylinder that props the trunk up like real branch whorls do
	var length := maxf((_h_obj - cut_obj) * s, 1.0)
	trunk_shape = CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = maxf(cap_r * 0.9, 0.05)
	cap.height = maxf(length * 0.92, cap.radius * 2.0 + 0.1)
	trunk_shape.shape = cap
	trunk_shape.position = Vector3(0.0, cap.height * 0.5, 0.0)
	add_child(trunk_shape)
	var crown_r := clampf(float(info.get("crown_radius", 2.0)) * s * 0.28, 0.0, 1.1)
	if crown_r > cap.radius * 1.5 and info.get("cards") != null:
		crown_shape = CollisionShape3D.new()
		var cyl := CylinderShape3D.new()
		var c0 := maxf(_crown_base_obj - cut_obj, 0.5) * s
		var c1 := (_h_obj * 0.88 - cut_obj) * s
		cyl.radius = crown_r
		cyl.height = maxf(c1 - c0, 1.0)
		crown_shape.shape = cyl
		crown_shape.position = Vector3(0.0, (c0 + c1) * 0.5, 0.0)
		add_child(crown_shape)
	# mass: green wood (x1.6 of the manifest's dry density), cone volume + crown
	var vol := PI * cap_r * cap_r * length / 3.0
	mass = clampf(vol * float(info.get("wood_density", 550.0)) * 1.6 + crown_r * 60.0, 25.0, 4000.0)
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, length * 0.3, 0.0)
	var pm := PhysicsMaterial.new()
	pm.friction = 0.9
	pm.rough = true
	pm.bounce = 0.02
	physics_material_override = pm
	linear_damp = 0.05
	angular_damp = 0.15
	can_sleep = true
	contact_monitor = true
	max_contacts_reported = 4
	body_entered.connect(_on_body_entered)
	# bucking: merchantable stem to ~72 % of the height (the rest is crown / top)
	var merch := maxf((_h_obj * 0.72 - cut_obj) * s, 0.0)
	logs_left = clampi(int(floor(merch / LOG_LEN)), 1, 8)
	log_obj = LOG_LEN / s
	var dbh := float(info.get("dbh", 0.3)) * s
	seg_max = 10.0 + 60.0 * dbh
	seg_hp = seg_max


## Starts the fall away from `away` (horizontal world direction) with a hinge at the cut.
func start_fall(away: Vector3, stump: PhysicsBody3D) -> void:
	fall_dir = Vector3(away.x, 0.0, away.z).normalized()
	if fall_dir.length_squared() < 0.5:
		fall_dir = Vector3.FORWARD
	stump_body = stump
	if stump:
		add_collision_exception_with(stump)
	var axis := Vector3.UP.cross(fall_dir).normalized()
	joint = HingeJoint3D.new()
	joint.name = "Hinge"
	# HingeJoint3D rotates about its local Z
	var z := axis
	var y := Vector3.UP
	var x := y.cross(z).normalized()
	get_parent().add_child(joint)
	joint.global_transform = Transform3D(Basis(x, y, z), global_position + fall_dir * trunk_r * 0.6)
	joint.node_a = joint.get_path_to(stump) if stump else NodePath("")
	joint.node_b = joint.get_path_to(self)
	angular_velocity = axis * 0.1
	state = State.FALLING
	_t = 0.0


## Restores a settled trunk from a save.
func restore_down(xf: Transform3D, p_buck: float, p_logs: int, p_hp: float, settled: bool) -> void:
	global_transform = xf
	_set_buck(p_buck)
	logs_left = p_logs
	seg_hp = p_hp if p_hp > 0.0 else seg_max
	_impacted = true
	if settled:
		_settle()
	else:
		state = State.FALLING


func _tilt() -> float:
	return acos(clampf(global_transform.basis.y.normalized().dot(Vector3.UP), -1.0, 1.0))


func _physics_process(delta: float) -> void:
	if state != State.FALLING:
		return
	_t += delta
	var tilt := _tilt()
	# the holding wood keeps the butt on the stump until the crown is down (or it's nearly flat)
	if joint and (_impacted or tilt > deg_to_rad(84.0) or _t > 12.0):
		joint.queue_free()
		joint = null
	if not _impacted and tilt > deg_to_rad(80.0):
		_impact(_crown_point())
	var speed := linear_velocity.length() + angular_velocity.length() * 3.0
	if _impacted and speed < 0.25:
		_calm_t += delta
	else:
		_calm_t = 0.0
	if (_impacted and (_calm_t > 0.8 or sleeping)) or _t > 20.0:
		_settle()


func _on_body_entered(body: Node) -> void:
	if _impacted or state != State.FALLING or body == stump_body:
		return
	if _tilt() > deg_to_rad(55.0):
		_impact(_crown_point())


func _crown_point() -> Vector3:
	return global_transform * Vector3(0.0, (_h_obj * 0.6 - cut_obj) * s, 0.0)


func _impact(at: Vector3) -> void:
	_impacted = true
	angular_damp = 2.5          # branches crush and dig in: no rolling about the trunk
	var energy := clampf(mass / 700.0, 0.35, 1.4)
	Audio.play_sfx(&"tree_impact", at, clampf(-4.0 + energy * 5.0, -6.0, 4.0), randf_range(0.9, 1.05))
	Events.noise_emitted.emit(at, 60.0 + 40.0 * energy, self)
	if harvest and harvest.has_method("fx_impact"):
		harvest.fx_impact(at, global_transform.basis.y, energy)
	var p := Game.player
	if p and is_instance_valid(p):
		var a := global_position
		var b := global_transform * Vector3(0.0, (_h_obj - cut_obj) * s, 0.0)
		var d := _dist_to_segment_xz(p.global_position, a, b)
		if p.has_method("add_trauma"):
			p.add_trauma(clampf(1.0 - d / 35.0, 0.0, 1.0) * 0.7 * energy)
		if d < 1.0 and p.global_position.y < a.y + 3.0 and p.has_method("take_damage"):
			p.take_damage(clampf(mass / 12.0, 25.0, 120.0), &"blunt", self, p.global_position)


static func _dist_to_segment_xz(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := Vector2(b.x - a.x, b.z - a.z)
	var ap := Vector2(p.x - a.x, p.z - a.z)
	var l2 := ab.length_squared()
	var u := 0.0 if l2 < 1e-6 else clampf(ap.dot(ab) / l2, 0.0, 1.0)
	return (ap - ab * u).length()


func _settle() -> void:
	if joint:
		joint.queue_free()
		joint = null
	state = State.DOWN
	set_physics_process(false)
	contact_monitor = false
	freeze_mode = RigidBody3D.FREEZE_MODE_STATIC
	set_deferred(&"freeze", true)
	if harvest and harvest.has_method("on_tree_settled"):
		harvest.on_tree_settled(self)


func is_down() -> bool:
	return state == State.DOWN


# ---------------------------------------------------------------------------------------------- harvesting

func get_harvest_tool_type() -> StringName:
	return &"axe"


func get_interact_prompt(_player: Node) -> String:
	return ""


func harvest_hit(tool_id: StringName, power: float, hit_position: Vector3, hit_normal: Vector3, player: Node) -> void:
	if state != State.DOWN or logs_left <= 0:
		return
	var fam: StringName = harvest.tool_family(tool_id) if harvest else &"axe"
	if fam == &"hand" or fam == &"":
		return
	if harvest:
		harvest.fx_chips(hit_position, hit_normal, 0.8)
		if player == null:
			Audio.play_sfx(&"axe_hit_wood", hit_position)
	seg_hp -= power
	if seg_hp > 0.0:
		return
	# one log off the butt end
	var mid := global_transform * Vector3(0.0, (buck_obj + log_obj * 0.5 - cut_obj) * s, 0.0)
	Audio.play_sfx(&"log_split", mid)
	if harvest:
		harvest.spawn_pickup(&"log", 1, mid + Vector3.UP * 0.25, Vector3.UP * 0.6)
		Events.resource_harvested.emit(&"log", mid)
	logs_left -= 1
	seg_hp = seg_max
	if logs_left <= 0:
		# what's left is the crown / top: a few sticks and it's gone
		var top := global_transform * Vector3(0.0, (_h_obj * 0.8 - cut_obj) * s, 0.0)
		if harvest:
			harvest.spawn_pickup(&"stick", 3, top + Vector3.UP * 0.4, Vector3.UP * 0.5)
			harvest.on_tree_bucked(self)
		queue_free()
		return
	_set_buck(buck_obj + log_obj)


func _set_buck(b: float) -> void:
	buck_obj = b
	mesh_node.set_instance_shader_parameter(&"clip_below", buck_obj)
	var off := (buck_obj - cut_obj) * s
	cap_node.position = Vector3(0.0, off, 0.0)
	# the trunk tapers: shrink the end cap a little per log
	var k := clampf(1.0 - (buck_obj - cut_obj) / maxf(_h_obj - cut_obj, 1.0), 0.25, 1.0)
	cap_node.scale = Vector3(trunk_r * k, 1.0, trunk_r * k)
	var cap := trunk_shape.shape as CapsuleShape3D
	var length := maxf((_h_obj - buck_obj) * s * 0.92, cap.radius * 2.0 + 0.1)
	cap.height = length
	trunk_shape.position = Vector3(0.0, off + length * 0.5, 0.0)


func save_data() -> Dictionary:
	return {"xf": SaveUtil.xform(global_transform), "buck": buck_obj, "logs": logs_left, "hp": seg_hp,
		"down": state == State.DOWN}

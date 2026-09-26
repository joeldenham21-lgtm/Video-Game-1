class_name BuildDoor
extends BuildPiece
## Plank door hung in a log doorway on leather strap hinges. Interact opens / closes it (door_open /
## door_close), swinging about the hinge on an AnimatableBody3D so it pushes things aside; closing it seals the
## room (shelter factor, see BuildStructure.edge_closure). `props.flip` hangs it from the other jamb, opening
## the other way. Persists open/closed.

const OPEN_ANGLE := deg_to_rad(102.0)
const SWING_SPEED := 2.6          ## rad/s
const HINGE_X := -0.47

var is_open := false
var _angle := 0.0
var _leaf: AnimatableBody3D
var _leaf_mesh: MeshInstance3D


func _ready() -> void:
	super._ready()
	if build:
		build.has_own_use = true
	_leaf = AnimatableBody3D.new()
	_leaf.name = "Leaf"
	_leaf.collision_layer = BuildPiece.LAYER_BUILDING
	_leaf.collision_mask = 0
	_leaf.sync_to_physics = true
	_leaf.set_meta(&"surface", &"wood")
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.93, 1.85, 0.07)
	cs.shape = box
	cs.position = Vector3(0.47, 0.94, -0.01)
	_leaf.add_child(cs)
	_leaf_mesh = MeshInstance3D.new()
	_leaf_mesh.name = "Mesh"
	_leaf_mesh.mesh = BuildCatalog.get_mesh(&"door_leaf")
	_leaf.add_child(_leaf_mesh)
	add_child(_leaf)
	_apply_angle()
	_refresh_door_visual()
	if build:
		build.progressed.connect(func(_f: float) -> void: _refresh_door_visual())


func _refresh_door_visual() -> void:
	if _leaf_mesh == null or _leaf_mesh.mesh == null:
		return
	var done := is_complete()
	for i in _leaf_mesh.mesh.get_surface_count():
		if done:
			if _leaf_mesh.get_surface_override_material(i) != null:
				_leaf_mesh.set_surface_override_material(i, null)
		else:
			var role := BuildObject._role_of(_leaf_mesh.mesh.surface_get_material(i))
			_leaf_mesh.set_surface_override_material(i, BuildMaterials.frame_material(role, build.fraction()))
	# A frame is only an outline: walk through it (it stays interactable to fill it in).
	_leaf.collision_layer = BuildPiece.LAYER_BUILDING if done else BuildPiece.LAYER_INTERACT


func refresh_visual() -> void:
	# The leaf is drawn by the door itself (it moves), never by the structure's MultiMeshes.
	_refresh_door_visual()


func _physics_process(delta: float) -> void:
	var target := OPEN_ANGLE if is_open else 0.0
	if is_equal_approx(_angle, target):
		return
	_angle = move_toward(_angle, target, SWING_SPEED * delta)
	_apply_angle()


func _apply_angle() -> void:
	if _leaf:
		_leaf.transform = Transform3D(Basis(Vector3.UP, _angle), Vector3(HINGE_X, 0.0, 0.0))


func set_open(open: bool, quiet := false) -> void:
	if open == is_open:
		return
	is_open = open
	if not quiet:
		Audio.play_sfx(&"door_open" if open else &"door_close", global_position + Vector3(0.0, 1.0, 0.0))
	if structure:
		structure.rebuild_shelter()


func get_interact_prompt(player: Node) -> String:
	var o := build.override_prompt(player) if build else ""
	if o != "" or not is_complete():
		return o
	return "Close door" if is_open else "Open door"


func get_interact_hold_time() -> float:
	return build.override_hold_time(Game.player) if build else 0.0


func interact(player: Node) -> void:
	if build and build.override_interact(player):
		return
	if is_complete():
		set_open(not is_open)


func save_extra() -> Dictionary:
	return {"open": is_open}


func load_extra(d: Dictionary) -> void:
	is_open = bool(d.get("open", false))
	_angle = OPEN_ANGLE if is_open else 0.0
	_apply_angle()

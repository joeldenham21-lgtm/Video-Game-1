class_name BuildObject
extends StaticBody3D
## Base for free-placed camp pieces (fire pit, drying rack, snow melter, beds, torch stand, lean-to, rope
## ladder, windbreak): collision on layer 7, footstep surface meta, a BuildComponent frame (model revealed step
## by step with a ghost for the rest), dismantling with a hammer, and save hooks. The model is the glb node
## "Model" (instanced from `model_glb` when the scene has none). Subclasses override _on_built(),
## own_prompt()/own_interact(), save_extra()/load_extra().

@export var buildable_id: StringName = &""
@export var model_glb := ""
@export var surface: StringName = &"wood"

var build: BuildComponent = null
var model: Node3D = null
## Structure deck this object stands on (dismantling that deck topples it), set by BuildingRoot.
var support_structure: BuildStructure = null
var support_slot := Vector3i.ZERO
var _frame_state := -1.0


func _init() -> void:
	collision_layer = BuildPiece.LAYER_BUILDING
	collision_mask = 0


func _ready() -> void:
	add_to_group(&"buildable")
	add_to_group(&"interactable")
	set_meta(&"surface", surface)
	_ensure_build(false)
	model = get_node_or_null(^"Model") as Node3D
	if model == null and model_glb != "":
		model = BuildCatalog.instantiate_model(model_glb)
		if model:
			model.name = "Model"
			add_child(model)
	elif model:
		BuildCatalog._apply_roles_once(model)
	var has_shape := false
	for c in get_children():
		if c is CollisionShape3D:
			has_shape = true
	if not has_shape:
		for sh in collision_shapes():
			var cs := CollisionShape3D.new()
			cs.shape = sh[0]
			cs.transform = sh[1]
			add_child(cs)
	_refresh_frame()
	if build.complete:
		_on_built.call_deferred()


func _ensure_build(done: bool) -> void:
	if build != null:
		return
	build = get_node_or_null(^"Build") as BuildComponent
	if build == null:
		build = BuildComponent.new()
		build.name = "Build"
		add_child(build)
		build.setup(buildable_id, done)
	build.owner_node = self
	build.has_own_use = has_own_use()
	build.progressed.connect(func(_f: float) -> void: _refresh_frame())
	build.completed.connect(_completed)


## BuildingRoot calls this before adding the node to the tree.
func prepare(id: StringName, done: bool) -> void:
	buildable_id = id
	_ensure_build(done)
	build.setup(id, done)


func is_complete() -> bool:
	return build != null and build.complete


func _completed() -> void:
	_refresh_frame()
	Events.structure_built.emit(buildable_id, self)
	_on_built()


## [[Shape3D, Transform3D]] used when the scene defines no CollisionShape3D. Default: a box from buildables
## "size", resting on the ground.
func collision_shapes() -> Array:
	var sz := BuildCatalog.size_of(buildable_id)
	var b := BoxShape3D.new()
	b.size = sz
	return [[b, Transform3D(Basis.IDENTITY, Vector3(0.0, sz.y * 0.5, 0.0))]]


## Called once the object is fully built (and after loading a built one).
func _on_built() -> void:
	pass


func _refresh_frame() -> void:
	if model == null or build == null:
		return
	var f := build.fraction()
	if is_equal_approx(f, _frame_state):
		return
	_frame_state = f
	_apply_frame(model, f, build.complete)


static func _apply_frame(n: Node, f: float, done: bool) -> void:
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				if done:
					if mi.get_surface_override_material(i) != null:
						mi.set_surface_override_material(i, null)
				else:
					var role := _role_of(mi.mesh.surface_get_material(i))
					mi.set_surface_override_material(i, BuildMaterials.frame_material(role, f))
	for c in n.get_children():
		_apply_frame(c, f, done)


static func _role_of(m: Material) -> String:
	if m == null:
		return "log"
	match m.resource_name:
		"building_log": return "log"
		"building_planks": return "planks"
	return m.resource_name if m.resource_name != "" else "stone"


# ---------------------------------------------------------------------------------------------- interaction

func get_interact_prompt(player: Node) -> String:
	var o := build.override_prompt(player) if build else ""
	if o != "" or not is_complete():
		return o
	return own_prompt(player)


func get_interact_hold_time() -> float:
	if build and build.override_hold_time(Game.player) > 0.0:
		return build.override_hold_time(Game.player)
	return own_hold_time()


func interact(player: Node) -> void:
	if build and build.override_interact(player):
		return
	if is_complete():
		own_interact(player)


func get_harvest_tool_type() -> StringName:
	return &"hammer"


func harvest_hit(_tool_id: StringName, _power: float, _pos: Vector3, _normal: Vector3, player: Node) -> void:
	if build and BuildComponent.holds_hammer(player):
		build.on_hammer_hit(player)


## Whether the built object has a use of its own (see BuildComponent.has_own_use).
func has_own_use() -> bool:
	return true


func own_prompt(_player: Node) -> String:
	return ""


func own_hold_time() -> float:
	return 0.0


func own_interact(_player: Node) -> void:
	pass


# ---------------------------------------------------------------------------------------------- save

func save_extra() -> Dictionary:
	return {}


func load_extra(_d: Dictionary) -> void:
	pass

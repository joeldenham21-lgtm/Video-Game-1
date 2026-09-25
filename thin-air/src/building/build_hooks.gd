class_name BuildHooks
extends RefCounted
## Lets scenes owned by the items stream (campfire, storage box, workbench) be built like any camp piece:
## a BuildComponent child "Build", a ghost look while they are a blueprint frame, and the frame / dismantle
## interaction taking precedence over the object's own (see pieces/built_*.gd).


static func attach(n: Node, id: StringName, done: bool) -> BuildComponent:
	var c := n.get_node_or_null(^"Build") as BuildComponent
	if c == null:
		c = BuildComponent.new()
		c.name = "Build"
		n.add_child(c)
	c.setup(id, done)
	c.owner_node = n as Node3D
	if not c.progressed.is_connected(_on_progress.bind(n)):
		c.progressed.connect(_on_progress.bind(n))
	if not c.completed.is_connected(_on_completed.bind(n)):
		c.completed.connect(_on_completed.bind(n))
	return c


static func component(n: Node) -> BuildComponent:
	return n.get_node_or_null(^"Build") as BuildComponent if n else null


static func is_built(n: Node) -> bool:
	var c := component(n)
	return c == null or c.complete


## Prompt override ("" = let the object's own interaction run).
static func prompt(n: Node, player: Node) -> String:
	var c := component(n)
	return c.override_prompt(player) if c else ""


static func hold_time(n: Node) -> float:
	var c := component(n)
	return c.override_hold_time(Game.player) if c else 0.0


static func interact(n: Node, player: Node) -> bool:
	var c := component(n)
	return c != null and c.override_interact(player)


static func hammer_hit(n: Node, player: Node) -> void:
	var c := component(n)
	if c and BuildComponent.holds_hammer(player):
		c.on_hammer_hit(player)


static func _on_progress(_f: float, n: Node) -> void:
	refresh_ghost(n)


static func _on_completed(n: Node) -> void:
	refresh_ghost(n)
	Events.structure_built.emit(component(n).id, n)


## Ghosts every mesh of the object while it is a frame; restores the real materials once built.
static func refresh_ghost(n: Node) -> void:
	if not is_instance_valid(n):
		return
	var c := component(n)
	var ghost := c != null and not c.complete
	var mat: Material = null
	if ghost:
		mat = BuildMaterials.ghost_material(BuildMaterials.GHOST_TODO if c.fraction() < 0.999 else BuildMaterials.GHOST_OK)
		(mat as ShaderMaterial).set_shader_parameter(&"tint", Color(0.78, 0.86, 0.95, 0.12 + 0.25 * c.fraction()))
	_set_override(n, mat)


static func _set_override(n: Node, mat: Material) -> void:
	if n.has_meta(&"build_reveal"):
		# Blender-built models reveal step by step instead of ghosting whole.
		var c := component(n.get_parent())
		BuildObject._apply_frame(n, c.fraction() if c else 1.0, c == null or c.complete)
		return
	if n is GeometryInstance3D and not (n is GPUParticles3D or n is CPUParticles3D):
		if (n as GeometryInstance3D).material_override != mat:
			(n as GeometryInstance3D).material_override = mat
	for ch in n.get_children():
		_set_override(ch, mat)

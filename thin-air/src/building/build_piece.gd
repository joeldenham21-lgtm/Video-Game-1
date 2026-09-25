class_name BuildPiece
extends StaticBody3D
## One grid-snapped log piece of a BuildStructure (scenes/building/log_*.tscn set `buildable_id`). Collision on
## layer 7 "building" with footstep surface meta "wood". While it is a blueprint frame it draws its own meshes
## (built steps solid, the rest as a pale ghost); once complete its geometry is drawn by the structure's
## MultiMeshes and this node keeps only collision + interaction.

const LAYER_BUILDING := 1 << 6

@export var buildable_id: StringName = &""

var slot := Vector3i.ZERO
var props: Dictionary = {}
var structure: BuildStructure = null
var build: BuildComponent = null
var _frame_meshes: Array[MeshInstance3D] = []


func _init() -> void:
	collision_layer = LAYER_BUILDING
	collision_mask = 0


func _ready() -> void:
	add_to_group(&"buildable")
	add_to_group(&"interactable")
	set_meta(&"surface", BuildCatalog.info(buildable_id).get("surface", &"wood"))
	_build_shapes()
	refresh_visual()


## Called by the structure before the node enters the tree.
func setup(s: BuildStructure, id: StringName, at: Vector3i, p: Dictionary, done: bool) -> void:
	structure = s
	buildable_id = id
	slot = at
	props = p.duplicate()
	build = BuildComponent.new()
	build.name = "Build"
	build.setup(id, done)
	build.owner_node = self
	add_child(build)
	build.progressed.connect(_on_progress)
	build.completed.connect(_on_completed)
	transform = piece_transform()


func layer() -> StringName:
	return layer_of(buildable_id)


static func layer_of(id: StringName) -> StringName:
	match BuildCatalog.kind_of(id):
		&"deck": return &"deck"
		&"wall": return &"wall"
		&"roof": return &"roof"
		&"stairs": return &"stairs"
		&"node": return &"node"
		&"door": return &"door"
	return &"free"


func is_complete() -> bool:
	return build != null and build.complete


## Local transform inside the structure for this id/slot/props.
func piece_transform() -> Transform3D:
	return piece_transform_for(buildable_id, slot, props)


static func piece_transform_for(id: StringName, at: Vector3i, p: Dictionary) -> Transform3D:
	var pos := BuildGrid.slot_position(at)
	var yaw := 0.0
	match BuildCatalog.kind_of(id):
		&"wall":
			yaw = BuildGrid.edge_yaw(at)
		&"roof":
			yaw = BuildGrid.dir_yaw(int(p.get("dir", 0)))
			pos.y += BuildGrid.WALL_TOP + float(int(p.get("tier", 0))) * BuildGrid.ROOF_RISE
		&"stairs":
			yaw = BuildGrid.dir_yaw(int(p.get("dir", 0)))
		&"door":
			yaw = BuildGrid.edge_yaw(at) + (PI if bool(p.get("flip", false)) else 0.0)
	return Transform3D(Basis(Vector3.UP, yaw), pos)


# ---------------------------------------------------------------------------------------------- collision

func _build_shapes() -> void:
	for c in get_children():
		if c is CollisionShape3D:
			c.free()
	for s in shapes_for(buildable_id, slot, props):
		var cs := CollisionShape3D.new()
		cs.shape = s[0]
		cs.transform = s[1]
		add_child(cs)


## [[Shape3D, Transform3D]] in the piece's local frame.
static func shapes_for(id: StringName, at: Vector3i, p: Dictionary) -> Array:
	var out: Array = []
	match id:
		&"log_foundation", &"log_floor":
			out.append(_box(Vector3(2.0, 0.18, 2.0), Vector3(0.0, -0.09, 0.0)))
		&"log_wall":
			out.append(_box(Vector3(2.0, 2.44, 0.28), Vector3(0.0, 1.22, 0.0)))
		&"log_window_wall":
			var even := BuildGrid.kind_of(at) == BuildGrid.Kind.XEDGE
			var lo := 0.82 if even else 0.685
			var hi := 1.61 if even else 1.475
			out.append(_box(Vector3(2.0, lo, 0.28), Vector3(0.0, lo * 0.5, 0.0)))
			out.append(_box(Vector3(2.0, 2.44 - hi, 0.28), Vector3(0.0, (hi + 2.44) * 0.5, 0.0)))
			out.append(_box(Vector3(0.6, hi - lo, 0.28), Vector3(-0.7, (lo + hi) * 0.5, 0.0)))
			out.append(_box(Vector3(0.6, hi - lo, 0.28), Vector3(0.7, (lo + hi) * 0.5, 0.0)))
		&"log_doorway":
			out.append(_box(Vector3(0.52, 2.44, 0.28), Vector3(-0.74, 1.22, 0.0)))
			out.append(_box(Vector3(0.52, 2.44, 0.28), Vector3(0.74, 1.22, 0.0)))
			out.append(_box(Vector3(0.96, 0.52, 0.28), Vector3(0.0, 2.18, 0.0)))
		&"log_railing":
			out.append(_box(Vector3(2.0, 1.02, 0.12), Vector3(0.0, 0.51, 0.0)))
		&"log_pillar":
			var cy := CylinderShape3D.new()
			cy.radius = 0.14
			cy.height = BuildGrid.WALL_TOP
			out.append([cy, Transform3D(Basis.IDENTITY, Vector3(0.0, BuildGrid.WALL_TOP * 0.5, 0.0))])
		&"log_roof":
			var ang := atan(BuildGrid.ROOF_RISE / BuildGrid.CELL)
			var eave := int(p.get("tier", 0)) == 0
			if String(p.get("shape", "slope")) == "peak":
				for side: float in [-1.0, 1.0]:
					var run := 1.0 + (0.5 if eave else 0.0)
					var L := run / cos(ang) + 0.1
					var cx: float = side * run * 0.5
					var cy2 := 0.02 + BuildGrid.ROOF_SLOPE * (1.0 - absf(cx)) + 0.07
					var b := Basis(Vector3.BACK, -side * ang)
					out.append([_boxshape(Vector3(L, 0.14, 2.0)), Transform3D(b, Vector3(cx, cy2, 0.0))])
			else:
				var x0 := -1.0 - (0.5 if eave else 0.0)
				var run := 1.0 - x0
				var L := run / cos(ang)
				var cx := (x0 + 1.0) * 0.5
				var cy := 0.02 + 0.675 * (cx + 1.0) + 0.07
				out.append([_boxshape(Vector3(L, 0.14, 2.0)), Transform3D(Basis(Vector3.BACK, ang), Vector3(cx, cy, 0.0))])
		&"log_stairs":
			var rise := BuildGrid.LEVEL_H
			var run := 4.0
			var ang := atan2(rise, run)
			var L := sqrt(rise * rise + run * run)
			var b := Basis(Vector3.BACK, ang)
			var c := Vector3(1.0, rise * 0.5 + 0.02, 0.0) + b * Vector3(0.0, -0.08, 0.0)
			out.append([_boxshape(Vector3(L, 0.16, 1.3)), Transform3D(b, c)])
	return out


static func _boxshape(size: Vector3) -> BoxShape3D:
	var b := BoxShape3D.new()
	b.size = size
	return b


static func _box(size: Vector3, centre: Vector3) -> Array:
	return [_boxshape(size), Transform3D(Basis.IDENTITY, centre)]


# ---------------------------------------------------------------------------------------------- visuals

func refresh_visual() -> void:
	if build == null:
		return
	if build.complete:
		for m in _frame_meshes:
			if is_instance_valid(m):
				m.queue_free()
		_frame_meshes.clear()
		return
	if _frame_meshes.is_empty():
		for part in BuildCatalog.piece_parts(buildable_id, slot, props):
			var mesh := BuildCatalog.get_mesh(part[0])
			if mesh == null:
				continue
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			mi.transform = part[1]
			for i in mesh.get_surface_count():
				var src := mesh.surface_get_material(i)
				var role := "log"
				if src:
					role = "planks" if src.resource_name == "building_planks" else ("log" if src.resource_name == "building_log" else src.resource_name)
				mi.set_surface_override_material(i, BuildMaterials.frame_material(role, build.fraction()))
			mi.set_instance_shader_parameter(&"exposure", 0.0)
			add_child(mi)
			_frame_meshes.append(mi)
	var f := build.fraction()
	for mi in _frame_meshes:
		for i in mi.get_surface_override_material_count():
			BuildMaterials.set_frame_progress(mi.get_surface_override_material(i), f)


func _on_progress(_f: float) -> void:
	refresh_visual()


func _on_completed() -> void:
	refresh_visual()
	if structure:
		structure.on_piece_completed(self)


# ---------------------------------------------------------------------------------------------- interaction

func get_interact_prompt(player: Node) -> String:
	return build.override_prompt(player) if build else ""


func get_interact_hold_time() -> float:
	return build.override_hold_time(Game.player) if build else 0.0


func interact(player: Node) -> void:
	if build:
		build.override_interact(player)


func get_harvest_tool_type() -> StringName:
	return &"hammer"


func harvest_hit(_tool_id: StringName, _power: float, _pos: Vector3, _normal: Vector3, player: Node) -> void:
	if build and BuildComponent.holds_hammer(player):
		build.on_hammer_hit(player)


# ---------------------------------------------------------------------------------------------- save

func save_data() -> Dictionary:
	var d := build.save_data() if build else {}
	d["id"] = String(buildable_id)
	d["slot"] = [slot.x, slot.y, slot.z]
	if not props.is_empty():
		d["props"] = props.duplicate()
	var extra := save_extra()
	if not extra.is_empty():
		d["state"] = extra
	return d


## Subclasses (doors) add their own state.
func save_extra() -> Dictionary:
	return {}


func load_extra(_d: Dictionary) -> void:
	pass

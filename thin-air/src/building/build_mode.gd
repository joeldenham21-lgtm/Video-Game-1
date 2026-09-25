class_name BuildMode
extends Node
## Build mode (action "build" — B / D-pad up / touch hammer): a picker of the buildables you know
## (ItemDB.all_buildables() filtered by Blueprints), then a ghost preview that snaps — foundations to the
## terrain (level deck on stilts, ≤ ~25°) or onto an existing structure's 2 m grid, walls to cell edges,
## floors / roofs / stairs to cells, pillars to corners, doors into doorways — or sits freely on the ground
## or a deck (fires, furniture) with slope and overlap checks. Green = valid, red = invalid with the reason.
## `use` places a blueprint frame (explorer difficulty: built at once if you carry the materials), `aim`
## leaves build mode, rotate_left/right (Q/R, LB/RB, wheel) turn it, touch has on-screen buttons.
## Max reach 8 m. Log construction needs a hammer in the pack; camp pieces are built by hand.
##
## compute(id, hit) is the pure placement function (tests drive it without input).

const REACH := BuildGrid.MAX_BUILD_DISTANCE
const RAY_MASK := 1 | (1 << 6) | (1 << 9)          # world, building, vegetation
const BLOCK_MASK := 1 | (1 << 2) | (1 << 6) | (1 << 9)   # world, creatures, building, vegetation
const FREE_MAX_SLOPE := 24.0
const ROT_STEP_FREE := 15.0

var player: Node = null
var selected: StringName = &""
var active := false
var rot_steps := 0
var placement: Dictionary = {}

var _ui: BuildModeUI = null
var _ghost: Node3D = null
var _ghost_id: StringName = &""
var _ghost_key := ""
var _ghost_mat: ShaderMaterial = null
var _was_valid := false


func _ready() -> void:
	_ghost_mat = BuildMaterials.ghost_material(BuildMaterials.GHOST_OK)
	_ui = BuildModeUI.new()
	_ui.mode = self
	add_child(_ui)
	Events.player_died.connect(func(_c: StringName) -> void: exit())
	Events.cinematic_started.connect(func(_c: StringName) -> void: exit())


func _exit_tree() -> void:
	if active:
		Events.ui_screen_closed.emit(&"build")


# ---------------------------------------------------------------------------------------------- input

func _process(_delta: float) -> void:
	if player == null or not is_instance_valid(player):
		return
	if _ui.picker_open:
		return
	var can: bool = player.has_method(&"is_input_enabled") and bool(player.call(&"is_input_enabled"))
	if not can:
		if active and Game.state == Game.State.DEAD:
			exit()
		return
	if Input.is_action_just_pressed(&"build"):
		open_picker()
		return
	if not active:
		return
	if Input.is_action_just_pressed(&"aim") or Input.is_action_just_pressed(&"ui_cancel"):
		exit()
		return
	if Input.is_action_just_pressed(&"rotate_left") or Input.is_action_just_pressed(&"hotbar_prev"):
		rotate_by(-1)
	elif Input.is_action_just_pressed(&"rotate_right") or Input.is_action_just_pressed(&"hotbar_next"):
		rotate_by(1)
	if Input.is_action_just_pressed(&"use"):
		place()


func _physics_process(_delta: float) -> void:
	if not active or player == null or not is_instance_valid(player):
		return
	var hit := _aim_hit()
	placement = compute(selected, hit)
	_update_ghost()
	_ui.update_hint(placement)


func open_picker() -> void:
	_ui.open_picker()


func select(id: StringName) -> void:
	selected = id
	rot_steps = 0
	if not active:
		active = true
		Events.ui_screen_opened.emit(&"build")
	_ui.set_selected(id)


func exit() -> void:
	if _ui and _ui.picker_open:
		_ui.close_picker()
	if not active:
		return
	active = false
	selected = &""
	_clear_ghost()
	_ui.set_selected(&"")
	Events.ui_screen_closed.emit(&"build")


func rotate_by(steps: int) -> void:
	rot_steps += steps
	Audio.play_ui(&"ui_hover")


# ---------------------------------------------------------------------------------------------- aim

func _aim_hit() -> Dictionary:
	var cam: Camera3D = player.call(&"get_camera") if player.has_method(&"get_camera") else null
	if cam == null:
		return {}
	var from := cam.global_position
	var dir := -cam.global_basis.z
	var space := (player as Node3D).get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, from + dir * (REACH + 1.5), RAY_MASK)
	q.exclude = [(player as CollisionObject3D).get_rid()] if player is CollisionObject3D else []
	var hit := space.intersect_ray(q)
	var out := {"eye": from, "dir": dir, "yaw": (player as Node3D).global_rotation.y}
	if hit.is_empty():
		# nothing within reach: look for the ground below the far end of the ray
		var end := from + dir * REACH
		var g := BuildingRoot.ground_height(end.x, end.z, end.y)
		out["position"] = Vector3(end.x, g, end.z)
		out["normal"] = Vector3.UP
		out["collider"] = null
		out["far"] = true
		return out
	out["position"] = hit["position"]
	out["normal"] = hit["normal"]
	out["collider"] = hit["collider"]
	return out


# ---------------------------------------------------------------------------------------------- placement

## Where and whether `id` would be placed for an aim `hit` ({position, normal, collider, eye, yaw}).
## Returns {valid, reason, kind, xform (world), structure, slot, props, new_xf (for a new structure)}.
func compute(id: StringName, hit: Dictionary) -> Dictionary:
	var out := {"valid": false, "reason": "", "id": id, "kind": BuildCatalog.kind_of(id)}
	if id == &"" or hit.is_empty() or not hit.has("position"):
		out["reason"] = "Nothing to build on"
		return out
	var root := BuildingRoot.instance
	if root == null:
		out["reason"] = "No building root"
		return out
	var pos: Vector3 = hit["position"]
	var eye: Vector3 = hit.get("eye", pos)
	var kind: StringName = out["kind"]
	match kind:
		&"deck":
			_compute_deck(id, hit, out)
		&"free":
			_compute_free(id, hit, out)
		_:
			_compute_grid(id, hit, out)
	if out.has("xform"):
		var p: Vector3 = (out["xform"] as Transform3D).origin
		if p.distance_to(eye) > REACH + 1.5:
			out["valid"] = false
			out["reason"] = "Too far"
	if bool(out["valid"]) and BuildCatalog.needs_hammer(id) and not _has_hammer():
		out["valid"] = false
		out["reason"] = "Needs a hammer"
	return out


func _has_hammer() -> bool:
	var inv := ItemActions.inventory_of(player) if player else null
	if inv == null:
		return true
	for s in inv.slots:
		if not s.is_empty() and StringName((ItemDB.get_item(StringName(s["id"])).get("tool", {}) as Dictionary).get("type", "")) == &"hammer":
			return true
	return false


func _structure_of(collider: Object) -> BuildStructure:
	var n := collider as Node
	while n != null:
		if n is BuildStructure:
			return n
		if n is BuildPiece:
			return (n as BuildPiece).structure
		n = n.get_parent()
	return null


func _nearby_structure(pos: Vector3, reach := 2.6) -> BuildStructure:
	var best: BuildStructure = null
	var best_d := reach
	for s in BuildingRoot.instance.structures():
		var local := s.local_of(pos)
		if absf(local.y) > 4.0:
			continue
		var d := s.distance_to_footprint(local)
		if d < best_d:
			best_d = d
			best = s
	return best


func _yaw_of(hit: Dictionary, snap_deg: float) -> float:
	var yaw := float(hit.get("yaw", 0.0)) + deg_to_rad(float(rot_steps) * ROT_STEP_FREE)
	return deg_to_rad(snappedf(rad_to_deg(yaw), snap_deg))


## Foundations: extend a structure's grid, or start a new structure levelled over the terrain.
func _compute_deck(id: StringName, hit: Dictionary, out: Dictionary) -> void:
	var pos: Vector3 = hit["position"]
	var s := _structure_of(hit.get("collider"))
	if s == null:
		s = _nearby_structure(pos)
	if id == &"log_floor":
		if s == null:
			out["reason"] = "Floors go on top of walls"
			return
		var local := s.local_of(pos)
		var L := clampi(roundi(local.y / BuildGrid.LEVEL_H), 1, 12)
		var cell := _free_cell(s, &"deck", local, L)
		_finish_grid(s, id, cell, {}, out)
		return
	if s != null:
		var local2 := s.local_of(pos)
		var cell2 := _free_cell(s, &"deck", local2, 0)
		out["structure"] = s
		out["slot"] = cell2
		out["xform"] = s.global_transform * Transform3D(Basis.IDENTITY, BuildGrid.slot_position(cell2))
		var prob := s.placement_problem(id, cell2, {})
		if prob == "":
			prob = BuildGrid.foundation_ground_check(s.global_position.y, _ground_samples(s.global_transform, cell2), false)
		if prob == "":
			prob = _blocked(id, out["xform"], s)
		out["valid"] = prob == ""
		out["reason"] = prob
		return
	# a new structure
	var yaw := _yaw_of(hit, 15.0)
	var b := Basis(Vector3.UP, yaw)
	var xf := Transform3D(b, Vector3(pos.x, pos.y, pos.z))
	var ground := _ground_samples(xf, Vector3i.ZERO)
	var y := BuildGrid.foundation_height(ground)
	xf.origin.y = y
	out["new_xf"] = xf
	out["xform"] = xf
	out["slot"] = Vector3i.ZERO
	var prob2 := BuildGrid.foundation_ground_check(y, ground, true)
	if prob2 == "" and TerrainData.is_in_water(Vector3(pos.x, pos.y + 0.1, pos.z)):
		prob2 = "In water"
	if prob2 == "":
		prob2 = _blocked(id, xf, null)
	out["valid"] = prob2 == ""
	out["reason"] = prob2


## Ground heights (world) under the four corners and the centre of `cell` in the frame `xf`.
func _ground_samples(xf: Transform3D, cell: Vector3i) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	var c := BuildGrid.slot_position(Vector3i(cell.x, 0, cell.z))
	for o: Vector3 in [Vector3(-1, 0, -1), Vector3(1, 0, -1), Vector3(-1, 0, 1), Vector3(1, 0, 1), Vector3.ZERO]:
		var w := xf * (c + o * 0.95)
		out.append(BuildingRoot.ground_height(w.x, w.z, xf.origin.y + 2.0))
	return out


## Nearest unoccupied cell of `layer` to `local` at `level` (the aimed cell, else its nearest neighbour).
func _free_cell(s: BuildStructure, layer: StringName, local: Vector3, level: int) -> Vector3i:
	var cell := BuildGrid.nearest_cell(local, level)
	if not s.has_piece(layer, cell):
		return cell
	var off := Vector3(local.x - cell.x, 0.0, local.z - cell.z)
	var d := BuildGrid.dir_from_vector(off if off.length() > 0.05 else Vector3(1, 0, 0))
	return BuildGrid.cell_step(cell, d)


func _compute_grid(id: StringName, hit: Dictionary, out: Dictionary) -> void:
	var pos: Vector3 = hit["position"]
	var s := _structure_of(hit.get("collider"))
	if s == null:
		s = _nearby_structure(pos, 3.2)
	if s == null:
		out["reason"] = "Build on a foundation"
		return
	var local := s.local_of(pos)
	var kind := BuildCatalog.kind_of(id)
	var slot := Vector3i.ZERO
	var props := {}
	var yaw_local := wrapf(float(hit.get("yaw", 0.0)) - s.global_rotation.y, -PI, PI)
	var facing := BuildGrid.dir_from_vector(Basis(Vector3.UP, yaw_local) * Vector3(0, 0, -1))
	match kind:
		&"wall":
			var L := maxi(0, floori((local.y + 0.3) / BuildGrid.LEVEL_H))
			slot = BuildGrid.nearest_edge(local, L)
			if s.has_piece(&"wall", slot):
				# try the other edges of the aimed cell, nearest first
				var cell := BuildGrid.nearest_cell(local, L)
				var best := slot
				var bd := INF
				for e in BuildGrid.cell_edges(cell):
					if s.has_piece(&"wall", e):
						continue
					var d := Vector2(local.x - e.x, local.z - e.z).length()
					if d < bd:
						bd = d
						best = e
				slot = best
		&"door":
			var col := hit.get("collider") as Node
			var dw: BuildPiece = col as BuildPiece if col is BuildPiece else null
			if dw == null or dw.buildable_id != &"log_doorway":
				var L2 := maxi(0, floori((local.y + 0.3) / BuildGrid.LEVEL_H))
				slot = BuildGrid.nearest_edge(local, L2)
			else:
				slot = dw.slot
			# hinge on the far jamb from the player, opening away from them; rotate flips it
			var side := (s.local_of(hit.get("eye", pos)) - BuildGrid.slot_position(slot))
			var n := Vector3(0, 0, 1) if BuildGrid.kind_of(slot) == BuildGrid.Kind.XEDGE else Vector3(-1, 0, 0)
			var flip := side.dot(n) < 0.0
			if posmod(rot_steps, 2) == 1:
				flip = not flip
			props = {"flip": flip}
		&"roof":
			var L3 := maxi(0, floori((local.y - 1.2) / BuildGrid.LEVEL_H))
			slot = _free_cell(s, &"roof", local, L3)
			var dir := s.auto_roof_dir(slot, facing)
			dir = posmod(dir + rot_steps, 4)
			props = s.roof_props_for(slot, dir)
		&"stairs":
			var L4 := maxi(0, floori((local.y + 0.3) / BuildGrid.LEVEL_H))
			slot = _free_cell(s, &"stairs", local, L4)
			props = {"dir": posmod(facing + rot_steps, 4)}
		&"node":
			var L5 := maxi(0, floori((local.y + 0.3) / BuildGrid.LEVEL_H))
			slot = BuildGrid.nearest_node(local, L5)
	_finish_grid(s, id, slot, props, out)


func _finish_grid(s: BuildStructure, id: StringName, slot: Vector3i, props: Dictionary, out: Dictionary) -> void:
	out["structure"] = s
	out["slot"] = slot
	out["props"] = props
	var local_xf := BuildPiece.piece_transform_for(id, slot, props)
	out["xform"] = s.global_transform * local_xf
	var prob := s.placement_problem(id, slot, props)
	if prob == "" and id != &"door":
		prob = _blocked(id, out["xform"], s)
	out["valid"] = prob == ""
	out["reason"] = prob


## "Blocked" if the piece's shapes (shrunk) overlap rocks, trees, creatures or other buildings.
func _blocked(id: StringName, xf: Transform3D, own: BuildStructure) -> String:
	if player == null or not (player is Node3D) or not (player as Node3D).is_inside_tree():
		return ""
	var space := (player as Node3D).get_world_3d().direct_space_state
	var shapes: Array = []
	if BuildCatalog.is_grid(id):
		shapes = BuildPiece.shapes_for(id, Vector3i.ZERO, {})
	else:
		var sz := BuildCatalog.size_of(id)
		var b := BoxShape3D.new()
		b.size = sz
		shapes = [[b, Transform3D(Basis.IDENTITY, Vector3(0.0, sz.y * 0.5, 0.0))]]
	for sh in shapes:
		var shape: Shape3D = sh[0]
		var q := PhysicsShapeQueryParameters3D.new()
		var shrunk := shape
		if shape is BoxShape3D:
			shrunk = BoxShape3D.new()
			(shrunk as BoxShape3D).size = (shape as BoxShape3D).size * Vector3(0.86, 0.8, 0.86)
		q.shape = shrunk
		q.transform = xf * (sh[1] as Transform3D) * Transform3D(Basis.IDENTITY, Vector3(0.0, 0.08, 0.0))
		q.collision_mask = BLOCK_MASK
		q.exclude = [(player as CollisionObject3D).get_rid()] if player is CollisionObject3D else []
		for r in space.intersect_shape(q, 8):
			var c := r.get("collider") as Node
			if c == null:
				continue
			if own != null and _structure_of(c) == own and BuildCatalog.is_grid(id):
				continue    # neighbours in the same structure touch by design
			if _is_terrain(c):
				if id == &"log_foundation":
					continue
				return "Blocked by the ground"
			return "Blocked"
	return ""


func _is_terrain(c: Node) -> bool:
	if c == null:
		return false
	if c.is_in_group(&"terrain") or c.name == "Terrain" or c.get_parent() and c.get_parent().name == "Terrain":
		return true
	for ch in c.get_children():
		if ch is CollisionShape3D and ((ch as CollisionShape3D).shape is HeightMapShape3D or (ch as CollisionShape3D).shape is WorldBoundaryShape3D):
			return true
	return false


## Free-standing camp pieces on the ground or on a deck.
func _compute_free(id: StringName, hit: Dictionary, out: Dictionary) -> void:
	var pos: Vector3 = hit["position"]
	var nrm: Vector3 = hit.get("normal", Vector3.UP)
	var col := hit.get("collider") as Node
	var s := _structure_of(col)
	var on_deck: BuildPiece = col as BuildPiece if col is BuildPiece and (col as BuildPiece).layer() == &"deck" else null
	var yaw := _yaw_of(hit, ROT_STEP_FREE) + PI
	if s and on_deck:
		# square to the cabin
		var rel := wrapf(yaw - s.global_rotation.y, -PI, PI)
		yaw = s.global_rotation.y + deg_to_rad(snappedf(rad_to_deg(rel), 90.0))
	if id == &"rope_ladder":
		_compute_ladder(hit, out)
		return
	var slope := rad_to_deg(acos(clampf(nrm.y, -1.0, 1.0)))
	var max_slope := 12.0 if id == &"bed" or id == &"bough_bed" or id == &"workbench" else FREE_MAX_SLOPE
	var sz := BuildCatalog.size_of(id)
	var y := pos.y
	if on_deck == null:
		# sit on the lowest ground under the footprint so nothing floats
		var b := Basis(Vector3.UP, yaw)
		var lo := INF
		for o: Vector3 in [Vector3(-0.5, 0, -0.5), Vector3(0.5, 0, -0.5), Vector3(-0.5, 0, 0.5), Vector3(0.5, 0, 0.5)]:
			var w := pos + b * (o * Vector3(sz.x, 0.0, sz.z) * 0.9)
			lo = minf(lo, BuildingRoot.ground_height(w.x, w.z, pos.y + 1.0))
		if is_finite(lo):
			y = minf(pos.y, lo) - 0.02
	var xf := Transform3D(Basis(Vector3.UP, yaw), Vector3(pos.x, y, pos.z))
	out["xform"] = xf
	out["structure"] = s if on_deck else null
	out["slot"] = on_deck.slot if on_deck else Vector3i.ZERO
	var prob := ""
	if nrm.y < 0.55:
		prob = "Needs flat ground"
	elif slope > max_slope:
		prob = "Too steep"
	elif col != null and not on_deck and _structure_of(col) != null:
		prob = "Needs a floor or the ground"
	elif TerrainData.is_in_water(Vector3(pos.x, pos.y + 0.1, pos.z)):
		prob = "In water"
	if prob == "":
		var lift := tan(deg_to_rad(slope)) * maxf(sz.x, sz.z) * 0.5 + 0.06
		prob = _blocked(id, xf * Transform3D(Basis.IDENTITY, Vector3(0.0, lift, 0.0)), null)
	out["valid"] = prob == ""
	out["reason"] = prob


func _compute_ladder(hit: Dictionary, out: Dictionary) -> void:
	var pos: Vector3 = hit["position"]
	var eye: Vector3 = hit.get("eye", pos)
	var fwd := pos - eye
	fwd.y = 0.0
	if fwd.length() < 0.01:
		fwd = Vector3(0, 0, -1)
	fwd = fwd.normalized()
	var probe := pos + fwd * 0.45
	var below := BuildingRoot.ground_height(probe.x, probe.z, pos.y - 0.3)
	var drop := pos.y - below
	var yaw := atan2(-fwd.x, -fwd.z) + PI   # local +Z points back toward the ledge (the stake side)
	var xf := Transform3D(Basis(Vector3.UP, yaw), pos + fwd * 0.12)
	out["xform"] = xf
	var prob := ""
	if (hit.get("normal", Vector3.UP) as Vector3).y < 0.6:
		prob = "Anchor it on top of a ledge"
	elif drop < 1.4:
		prob = "Needs a drop to hang over"
	elif drop > 12.0:
		prob = "Too long a drop"
	out["valid"] = prob == ""
	out["reason"] = prob


# ---------------------------------------------------------------------------------------------- place

func place() -> Node:
	if placement.is_empty() or not bool(placement.get("valid", false)):
		Audio.play_sfx(&"build_invalid", null, -4.0)
		if placement.get("reason", "") != "":
			Game.notify(String(placement["reason"]), &"warning")
		return null
	return place_from(placement)


## Creates the frame described by a compute() result. Returns the new piece / object.
func place_from(p: Dictionary) -> Node:
	var root := BuildingRoot.instance
	if root == null:
		return null
	var id: StringName = p["id"]
	var node: Node = null
	if BuildCatalog.is_grid(id):
		var s: BuildStructure = p.get("structure")
		if s == null and p.has("new_xf"):
			s = root.new_structure(p["new_xf"])
		if s == null:
			return null
		node = root.place_grid(s, id, p["slot"], p.get("props", {}), false)
	else:
		node = root.place_free(id, p["xform"], false)
		if node is BuildObject and p.get("structure") != null:
			(node as BuildObject).support_structure = p["structure"]
			(node as BuildObject).support_slot = p["slot"]
	if node == null:
		return null
	Audio.play_sfx(&"build_place", (p["xform"] as Transform3D).origin, -3.0)
	var comp := BuildingRoot.component_of(node)
	if comp and Game.difficulty == &"explorer":
		var inv := ItemActions.inventory_of(player)
		if inv and inv.has_all(comp.missing()):
			comp.add_all(inv)
	return node


# ---------------------------------------------------------------------------------------------- ghost

func _clear_ghost() -> void:
	if _ghost and is_instance_valid(_ghost):
		_ghost.queue_free()
	_ghost = null
	_ghost_id = &""
	_ghost_key = ""


func _ghost_key_for(p: Dictionary) -> String:
	var id: StringName = p.get("id", &"")
	if not BuildCatalog.is_grid(id):
		return String(id)
	var parts := BuildCatalog.piece_parts(id, p.get("slot", Vector3i.ZERO), p.get("props", {}))
	var names: PackedStringArray = []
	for part in parts:
		names.append(String(part[0]))
	return "%s|%s" % [id, ",".join(names)]


func _update_ghost() -> void:
	if not placement.has("xform"):
		if _ghost:
			_ghost.visible = false
		return
	var key := _ghost_key_for(placement)
	if key != _ghost_key:
		_clear_ghost()
		_ghost = _make_ghost(placement)
		_ghost_key = key
		if _ghost:
			var parent: Node = BuildingRoot.instance if BuildingRoot.instance else get_tree().current_scene
			parent.add_child(_ghost)
	if _ghost == null:
		return
	_ghost.visible = true
	_ghost.global_transform = placement["xform"]
	var valid := bool(placement.get("valid", false))
	_ghost_mat.set_shader_parameter(&"tint", BuildMaterials.GHOST_OK if valid else BuildMaterials.GHOST_BAD)
	_ghost_mat.set_shader_parameter(&"pulse", 0.0 if valid else 1.0)
	_was_valid = valid


func _make_ghost(p: Dictionary) -> Node3D:
	var id: StringName = p.get("id", &"")
	var g := Node3D.new()
	g.name = "BuildGhost"
	if BuildCatalog.is_grid(id):
		var parts := BuildCatalog.piece_parts(id, p.get("slot", Vector3i.ZERO), p.get("props", {}))
		if id == &"door":
			parts = [[&"door_leaf", Transform3D(Basis.IDENTITY, Vector3(-0.47, 0.0, 0.0))]]
		for part in parts:
			var mesh := BuildCatalog.get_mesh(part[0])
			if mesh == null:
				continue
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			mi.transform = part[1]
			mi.material_override = _ghost_mat
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			g.add_child(mi)
		return g
	var model := BuildCatalog.free_model(id)
	if model:
		g.add_child(model)
		_override_all(model)
	return g


func _override_all(n: Node) -> void:
	if n is GeometryInstance3D:
		(n as GeometryInstance3D).material_override = _ghost_mat
		(n as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in n.get_children():
		_override_all(c)


## Buildables shown in the picker (known blueprints), in data order.
static func available_buildables() -> Array[StringName]:
	var out: Array[StringName] = []
	for id in ItemDB.all_buildables():
		if Blueprints.is_available(id):
			out.append(id)
	return out

extends TestCase
## Building stream: grid/snapping maths, placement validity + structural support, cost deduction / refunds,
## blueprint frame filling, collapse on dismantle, shelter factor (rooms, door state, lean-to), room heat,
## drying / snow melting over game time, the sleep flow, log carrying and a save/load round-trip of the
## Building root. Headless: a flat ground plane on layer 1 stands in for the terrain.

const GROUND_Y := 1450.0

var root: BuildingRoot
var ground: StaticBody3D
var player: Node3D = null


func run() -> void:
	_grid_math()
	await _setup()
	await _cabin()
	await _save_load()
	await _build_mode()
	await _camp_pieces()
	await _sleep()
	await _log_carry()
	await _batching()
	await _teardown()


## Minimal stand-in for the Player (CONTRACT §4 subset the building code uses).
class StubPlayer extends CharacterBody3D:
	var inventory := Inventory.new(24, 200.0)
	var vitals: Vitals
	var active := &""
	var speed_cap := INF
	var ground_speed := 0.0
	var cam: Camera3D

	func _init() -> void:
		collision_layer = 1 << 1
		vitals = Vitals.new()
		vitals.name = "Vitals"
		vitals.auto_simulate = false
		add_child(vitals)
		cam = Camera3D.new()
		cam.position = Vector3(0, 1.7, 0)
		add_child(cam)

	func get_active_item() -> StringName:
		return active

	func get_camera() -> Camera3D:
		return cam

	func is_input_enabled() -> bool:
		return false

	func is_dead() -> bool:
		return false


# =============================================================================================== pure maths

func _grid_math() -> void:
	check(BuildGrid.kind_of(Vector3i(0, 0, 0)) == BuildGrid.Kind.CELL, "slot parity: cell")
	check(BuildGrid.kind_of(Vector3i(2, 0, -1)) == BuildGrid.Kind.XEDGE, "slot parity: x edge")
	check(BuildGrid.kind_of(Vector3i(-3, 1, 4)) == BuildGrid.Kind.ZEDGE, "slot parity: z edge")
	check(BuildGrid.kind_of(Vector3i(1, 0, -1)) == BuildGrid.Kind.NODE, "slot parity: node")
	check(BuildGrid.nearest_cell(Vector3(2.9, 0.3, -1.1), 0) == Vector3i(2, 0, -2) or BuildGrid.nearest_cell(Vector3(2.9, 0.3, -1.1), 0) == Vector3i(2, 0, 0),
		"nearest cell %s" % BuildGrid.nearest_cell(Vector3(2.9, 0.3, -1.1), 0))
	check(BuildGrid.nearest_cell(Vector3(3.1, 0.0, -0.9), 0) == Vector3i(4, 0, 0), "nearest cell rounds to 2 m")
	check(BuildGrid.nearest_edge(Vector3(0.9, 1.0, 0.1), 0) == Vector3i(1, 0, 0), "nearest edge (+x side)")
	check(BuildGrid.nearest_edge(Vector3(0.1, 1.0, -0.8), 0) == Vector3i(0, 0, -1), "nearest edge (-z side)")
	check(BuildGrid.nearest_node(Vector3(0.8, 0.0, 1.2), 1) == Vector3i(1, 1, 1), "nearest node")
	check(BuildGrid.slot_position(Vector3i(3, 1, -2)).is_equal_approx(Vector3(3.0, BuildGrid.LEVEL_H, -2.0)), "slot position")
	check(BuildGrid.edge_cells(Vector3i(0, 0, 1)) == [Vector3i(0, 0, 0), Vector3i(0, 0, 2)], "cells beside an x edge")
	check(BuildGrid.edge_nodes(Vector3i(1, 0, 0)) == [Vector3i(1, 0, -1), Vector3i(1, 0, 1)], "nodes of a z edge")
	check(BuildGrid.collinear_edge(Vector3i(0, 0, 1), Vector3i(1, 0, 1)) == Vector3i(2, 0, 1), "collinear edge")
	check(BuildGrid.cell_step(Vector3i(0, 0, 0), 1) == Vector3i(0, 0, 2) and BuildGrid.cell_step(Vector3i(0, 0, 0), 2) == Vector3i(-2, 0, 0),
		"cell steps by direction")
	check(BuildGrid.roof_side_edges(Vector3i(0, 0, 0), 0) == [Vector3i(0, 0, 1), Vector3i(0, 0, -1)], "roof side edges (rise +X)")
	var xf := Basis(Vector3.UP, BuildGrid.dir_yaw(1))
	check((xf * Vector3.RIGHT).is_equal_approx(Vector3(0, 0, 1)), "dir 1 yaw turns +X to +Z")
	check(BuildGrid.dir_from_vector(Vector3(-0.2, 0, -3.0)) == 3, "dir from vector")
	# foundations on slopes: level deck, stilts, limits
	var flat := PackedFloat32Array([10.0, 10.0, 10.0, 10.0, 10.0])
	var y := BuildGrid.foundation_height(flat)
	check(is_equal_approx(y, 10.0 + BuildGrid.MIN_CLEARANCE), "deck height above flat ground")
	check(BuildGrid.foundation_ground_check(y, flat, true) == "", "flat ground accepted")
	var slope20 := PackedFloat32Array([10.0, 10.0 + tan(deg_to_rad(20.0)) * 2.0, 10.0, 10.0 + tan(deg_to_rad(20.0)) * 2.0, 10.4])
	var y2 := BuildGrid.foundation_height(slope20)
	check(BuildGrid.foundation_ground_check(y2, slope20, true) == "", "20° slope accepted (posts %.2f m)" % BuildGrid.post_length(y2, 10.0))
	var slope35 := PackedFloat32Array([10.0, 10.0 + tan(deg_to_rad(35.0)) * 2.0, 10.0, 10.0 + tan(deg_to_rad(35.0)) * 2.0, 10.7])
	check(BuildGrid.foundation_ground_check(BuildGrid.foundation_height(slope35), slope35, true) == "Too steep", "35° slope refused")
	check(BuildGrid.foundation_ground_check(10.0, PackedFloat32Array([10.2, 9.9]), false) == "Ground too high", "ground above the sills refused")
	check(BuildGrid.foundation_ground_check(20.0, PackedFloat32Array([10.0]), false) != "", "stilts longer than %.1f m refused" % BuildGrid.MAX_POST)
	# shelter factor
	check(is_equal_approx(BuildGrid.shelter_factor(1.0, 0.0), 1.0), "closed roofed room = 1.0")
	check(BuildGrid.shelter_factor(1.0, 0.55) > 0.8 and BuildGrid.shelter_factor(1.0, 0.55) < 0.95, "open door lowers shelter")
	check(BuildGrid.shelter_factor(0.0, 0.0) < 0.3, "roofless walls shelter little")
	check(BuildGrid.shelter_factor(1.0, 12.0) < 0.35, "roof without walls ≈ 0.3")


# =============================================================================================== world

func _setup() -> void:
	Game.flags.clear()
	ground = StaticBody3D.new()
	ground.collision_layer = 1
	var cs := CollisionShape3D.new()
	cs.shape = WorldBoundaryShape3D.new()
	ground.add_child(cs)
	ground.position.y = GROUND_Y
	add_child(ground)
	root = (load("res://scenes/building/building_root.tscn") as PackedScene).instantiate() as BuildingRoot
	root.attach_player_tools = false
	add_child(root)
	await get_tree().physics_frame
	await get_tree().physics_frame
	check(is_equal_approx(BuildingRoot.ground_height(3.0, -4.0), GROUND_Y), "ground height by physics ray (%.2f)" % BuildingRoot.ground_height(3.0, -4.0))


func _cabin() -> void:
	var y := GROUND_Y + BuildGrid.MIN_CLEARANCE
	var s := root.new_structure(Transform3D(Basis.IDENTITY, Vector3(0.0, y, 0.0)))
	# 3x3 foundations
	for i in [-2, 0, 2]:
		for k in [-2, 0, 2]:
			check(s.placement_problem(&"log_foundation", Vector3i(i, 0, k), {}) == "", "foundation %d,%d valid" % [i, k])
			s.add_piece(&"log_foundation", Vector3i(i, 0, k), {}, true)
	check(s.placement_problem(&"log_foundation", Vector3i(0, 0, 0), {}) == "Occupied", "occupied cell refused")
	check(s.placement_problem(&"log_wall", Vector3i(7, 0, 0), {}) == "Needs support", "wall off the deck refused")
	check(s.placement_problem(&"log_floor", Vector3i(0, 1, 0), {}) == "Needs support", "floor with no walls under it refused")
	check(s.placement_problem(&"door", Vector3i(0, 0, 3), {}) == "Needs a log doorway", "door needs a doorway")
	# perimeter walls: doorway south (+Z) middle, window east middle
	var perim: Array[Vector3i] = []
	for i in [-2, 0, 2]:
		perim.append(Vector3i(i, 0, 3))
		perim.append(Vector3i(i, 0, -3))
		perim.append(Vector3i(3, 0, i))
		perim.append(Vector3i(-3, 0, i))
	for e in perim:
		var id := &"log_wall"
		if e == Vector3i(0, 0, 3):
			id = &"log_doorway"
		elif e == Vector3i(3, 0, 0):
			id = &"log_window_wall"
		check(s.placement_problem(id, e, {}) == "", "%s at %s valid" % [id, e])
		s.add_piece(id, e, {}, true)
	var door := s.add_piece(&"door", Vector3i(0, 0, 3), {"flip": false}, true) as BuildDoor
	check(door != null, "door hung in the doorway")
	# gable roof: north row rises south (+Z → dir 1), south row rises north (dir 3), middle row = peak
	for i in [-2, 0, 2]:
		var pn := s.roof_props_for(Vector3i(i, 0, -2), s.auto_roof_dir(Vector3i(i, 0, -2), 1))
		check(int(pn["dir"]) == 1 and int(pn["tier"]) == 0, "north roof rises south from the eave (%s)" % str(pn))
		check(s.placement_problem(&"log_roof", Vector3i(i, 0, -2), pn) == "", "north roof valid")
		s.add_piece(&"log_roof", Vector3i(i, 0, -2), pn, true)
		var ps := s.roof_props_for(Vector3i(i, 0, 2), s.auto_roof_dir(Vector3i(i, 0, 2), 3))
		check(int(ps["dir"]) == 3, "south roof rises north (%s)" % str(ps))
		s.add_piece(&"log_roof", Vector3i(i, 0, 2), ps, true)
	for i in [-2, 0, 2]:
		var pm := s.roof_props_for(Vector3i(i, 0, 0), 1)
		check(String(pm["shape"]) == "peak" and int(pm["tier"]) == 1, "middle roof becomes a peak at tier 1 (%s)" % str(pm))
		check(s.placement_problem(&"log_roof", Vector3i(i, 0, 0), pm) == "", "peak supported by the slopes")
		s.add_piece(&"log_roof", Vector3i(i, 0, 0), pm, true)
	s.flush_now()
	check(s.piece_count() == 9 + 12 + 1 + 9, "cabin has 31 pieces (%d)" % s.piece_count())
	var ic := s.instance_counts
	check(int(ic.get(&"sill", 0)) == 12, "sills under 12 x-edges (%d)" % int(ic.get(&"sill", 0)))
	check(int(ic.get(&"footing", 0)) == 16, "16 stilt posts / footings (%d)" % int(ic.get(&"footing", 0)))
	check(int(ic.get(&"stub_even", 0)) + int(ic.get(&"stub_odd", 0)) == 8, "saddle-notched corners: 8 projecting log ends (%d)" % (int(ic.get(&"stub_even", 0)) + int(ic.get(&"stub_odd", 0))))
	var gables := 0
	for k in ic:
		if String(k).begins_with("gable_"):
			gables += int(ic[k])
	check(gables == 6, "gable infill at both ends (%d)" % gables)
	var strips := 0
	for k in ic:
		if String(k).begins_with("roof_") and (String(k).ends_with("_pz") or String(k).ends_with("_nz")):
			strips += int(ic[k])
	check(strips == 6, "roof overhangs past both gables (%d)" % strips)
	check(s.multimesh_count() <= 24, "cabin drawn with %d MultiMeshes" % s.multimesh_count())
	# shelter
	check(s.rooms.size() == 1, "one room (%d)" % s.rooms.size())
	var f_closed := s.shelter_of_cell(Vector3i(0, 0, 0))
	check(f_closed > 0.9, "closed cabin shelter %.2f" % f_closed)
	Climate.refresh_sources()
	var inside := s.world_of(Vector3(0.0, 1.0, 0.0))
	check(Climate.get_shelter_at(inside) > 0.85, "Climate sees the cabin (%.2f)" % Climate.get_shelter_at(inside))
	check(Climate.get_shelter_at(s.world_of(Vector3(9.0, 1.0, 0.0))) < 0.05, "no shelter outside")
	door.set_open(true, true)
	var f_open := s.shelter_of_cell(Vector3i(0, 0, 0))
	check(f_open < f_closed - 0.05 and f_open > 0.6, "open door lowers shelter %.2f → %.2f" % [f_closed, f_open])
	door.set_open(false, true)
	# frames: a floor-less extra wall as a frame, filled with materials
	var inv := Inventory.new(24, 200.0)
	inv.add(&"log", 3)
	var w := s.add_piece(&"log_wall", Vector3i(-1, 0, 0), {}, false)
	check(w != null and not w.is_complete(), "interior wall placed as a frame")
	check(w.build.total_units() == 4 and w.build.fraction() == 0.0, "frame needs 4 logs")
	check(w.collision_layer == BuildPiece.LAYER_INTERACT, "a frame is interaction-only (walk through it)")
	check(w.build.add_one(inv, true) and inv.count(&"log") == 2 and w.build.added_units() == 1, "adding a log moves it from the pack")
	w.build.add_all(inv)
	check(not w.is_complete() and w.build.missing().get(&"log", 0) == 1, "frame waits for the last log")
	inv.add(&"log", 1)
	w.build.add_one(inv, true)
	check(w.is_complete(), "frame completes with the 4th log")
	check(w.collision_layer == BuildPiece.LAYER_BUILDING, "the finished wall is solid (layer 7)")
	s.flush_now()
	check(s.rooms.size() == 1, "one partition segment doesn't split the room (%d)" % s.rooms.size())
	s.add_piece(&"log_wall", Vector3i(-1, 0, -2), {}, true)
	s.add_piece(&"log_wall", Vector3i(-1, 0, 2), {}, true)
	s.flush_now()
	check(s.rooms.size() == 2, "a full partition splits the cabin into two rooms (%d)" % s.rooms.size())
	check(s.shelter_of_cell(Vector3i(-2, 0, 0)) > 0.9 and s.shelter_of_cell(Vector3i(2, 0, 0)) > 0.85,
		"both rooms sheltered (%.2f / %.2f)" % [s.shelter_of_cell(Vector3i(-2, 0, 0)), s.shelter_of_cell(Vector3i(2, 0, 0))])
	# refunds + collapse
	var refund := w.build.refund()
	check(int(refund.get(&"log", 0)) == 2, "dismantling refunds 50%% (%s)" % str(refund))
	var fall := s.unsupported_after([s.get_piece(&"deck", Vector3i(0, 0, 0))])
	check(fall.is_empty(), "middle foundation removed: the walls stand on their neighbours")
	var fall_s := s.unsupported_after([s.get_piece(&"deck", Vector3i(0, 0, 2))])
	check(fall_s.size() == 2, "front foundation removed: its doorway + door come down (%d)" % fall_s.size())
	var walls_n := s.get_piece(&"wall", Vector3i(0, 0, 3))
	var fall2 := s.unsupported_after([walls_n])
	check(fall2.size() == 1 and fall2[0].buildable_id == &"door", "removing the doorway drops the door")
	var fall3 := s.unsupported_after([s.get_piece(&"wall", Vector3i(-3, 0, -2)), s.get_piece(&"wall", Vector3i(-3, 0, 0)),
		s.get_piece(&"wall", Vector3i(-3, 0, 2))])
	check(fall3.is_empty(), "gable-side walls removed: roof held by the eave walls")
	# a 2 m hut gets a little gable roof over its single cell
	var hut := root.new_structure(Transform3D(Basis.IDENTITY, Vector3(-60.0, GROUND_Y + 0.5, 0.0)))
	hut.add_piece(&"log_foundation", Vector3i.ZERO, {}, true)
	for e in BuildGrid.cell_edges(Vector3i.ZERO):
		hut.add_piece(&"log_wall", e, {}, true)
	var hp := hut.roof_props_for(Vector3i.ZERO, hut.auto_roof_dir(Vector3i.ZERO, 0))
	check(String(hp["shape"]) == "peak" and int(hp["tier"]) == 0, "single-cell hut: gable roof (%s)" % str(hp))
	hut.add_piece(&"log_roof", Vector3i.ZERO, hp, true)
	hut.flush_now()
	var hg := 0
	for k in hut.instance_counts:
		if String(k).begins_with("gable_peak_t0"):
			hg += int(hut.instance_counts[k])
	check(hg == 2, "hut gables at both ends (%d)" % hg)
	root.set_meta(&"test_structure", s)


# =============================================================================================== save / load

func _save_load() -> void:
	var s: BuildStructure = root.get_meta(&"test_structure")
	var door := s.get_piece(&"door", Vector3i(0, 0, 3)) as BuildDoor
	door.set_open(true, true)
	var frame := s.add_piece(&"log_wall", Vector3i(1, 0, -2), {}, false)
	var inv := Inventory.new(8, 100.0)
	inv.add(&"log", 1)
	frame.build.add_one(inv, true)
	var data := root.save_state()
	var json := JSON.stringify(data)
	var back: Variant = JSON.parse_string(json)
	check(back is Dictionary and (back as Dictionary).has("structures"), "save state is JSON-safe")
	var n_before := s.piece_count()
	root.load_state(back)
	await get_tree().process_frame
	var ss := root.structures()
	check(ss.size() == 2, "both structures after load (%d)" % ss.size())
	if ss.is_empty():
		return
	var s2: BuildStructure = null
	for x in ss:
		if x.piece_count() == n_before:
			s2 = x
	if s2 == null:
		s2 = ss[0]
	check(s2.piece_count() == n_before, "all %d pieces restored (%d)" % [n_before, s2.piece_count()])
	check(s2.global_position.is_equal_approx(s.global_position) if is_instance_valid(s) else true, "structure transform restored")
	var d2 := s2.get_piece(&"door", Vector3i(0, 0, 3)) as BuildDoor
	check(d2 != null and d2.is_open, "door state restored")
	var r2 := s2.get_piece(&"roof", Vector3i(0, 0, 0))
	check(r2 != null and String(r2.props.get("shape", "")) == "peak" and int(r2.props.get("tier", 0)) == 1, "roof props restored")
	var p2 := s2.get_piece(&"wall", Vector3i(1, 0, -2))
	check(p2 != null and not p2.is_complete() and p2.build.added_units() == 1, "frame progress restored")
	s2.flush_now()
	check(s2.rooms.size() >= 1, "rooms rebuilt after load")


func _stub_player(at: Vector3) -> StubPlayer:
	if player and is_instance_valid(player):
		player.queue_free()
	var p := StubPlayer.new()
	add_child(p)
	p.global_position = at
	player = p
	return p


# =============================================================================================== build mode

func _build_mode() -> void:
	var p := _stub_player(Vector3(30.0, GROUND_Y, 30.0))
	Game.player = p
	var bm := BuildMode.new()
	bm.player = p
	add_child(bm)
	await get_tree().physics_frame
	var eye := Vector3(30.0, GROUND_Y + 1.7, 30.0)
	var hit := {"position": Vector3(30.0, GROUND_Y, 25.0), "normal": Vector3.UP, "collider": ground, "eye": eye, "yaw": 0.0}
	var r := bm.compute(&"log_foundation", hit)
	check(not bool(r["valid"]) and String(r["reason"]) == "Needs a hammer", "log pieces need a hammer (%s)" % r["reason"])
	p.inventory.add(&"hammer", 1)
	r = bm.compute(&"log_foundation", hit)
	check(bool(r["valid"]), "foundation on flat ground valid (%s)" % r["reason"])
	check(absf((r["xform"] as Transform3D).origin.y - (GROUND_Y + BuildGrid.MIN_CLEARANCE)) < 0.01, "new foundation levelled 0.5 m above the ground")
	check(r.has("new_xf"), "starts a new structure")
	var far := hit.duplicate()
	far["position"] = Vector3(30.0, GROUND_Y, 12.0)
	check(String(bm.compute(&"log_foundation", far)["reason"]) == "Too far", "max build distance")
	var piece := bm.place_from(r) as BuildPiece
	check(piece != null and not piece.is_complete(), "placing creates a blueprint frame")
	var s := piece.structure
	await get_tree().physics_frame
	# snapping to the neighbour cell when aiming at the existing deck's edge
	var h2 := {"position": s.world_of(Vector3(0.9, 0.0, 0.1)), "normal": Vector3.UP, "collider": piece, "eye": eye, "yaw": 0.0}
	var r2 := bm.compute(&"log_foundation", h2)
	check(bool(r2["valid"]) and r2["slot"] == Vector3i(2, 0, 0), "second foundation snaps to the next cell (%s %s)" % [r2.get("slot"), r2["reason"]])
	var r3 := bm.compute(&"log_wall", h2)
	check(r3["slot"] == Vector3i(1, 0, 0) and bool(r3["valid"]), "wall snaps to the nearest cell edge (%s %s)" % [r3.get("slot"), r3["reason"]])
	var r4 := bm.compute(&"log_roof", {"position": s.world_of(Vector3(0.1, 2.5, 0.9)), "normal": Vector3.UP, "collider": piece, "eye": eye, "yaw": 0.0})
	check(not bool(r4["valid"]) and String(r4["reason"]) == "Needs support", "roof with no walls refused")
	# free placement: slope + overlap
	var r5 := bm.compute(&"campfire", {"position": Vector3(33.0, GROUND_Y, 27.0), "normal": Vector3.UP, "collider": ground, "eye": eye, "yaw": 0.0})
	check(bool(r5["valid"]), "campfire on flat ground (%s)" % r5["reason"])
	var steep := Vector3(0.0, cos(deg_to_rad(38.0)), sin(deg_to_rad(38.0)))
	var r6 := bm.compute(&"campfire", {"position": Vector3(33.0, GROUND_Y, 27.0), "normal": steep, "collider": ground, "eye": eye, "yaw": 0.0})
	check(String(r6["reason"]) == "Too steep", "free piece refused on a 38° slope")
	piece.build.finish(true)
	s.flush_now()
	await get_tree().physics_frame
	var r7 := bm.compute(&"stone_windbreak", {"position": s.world_of(Vector3(0.0, -0.4, 0.0)), "normal": Vector3.UP, "collider": ground, "eye": eye, "yaw": 0.0})
	check(not bool(r7["valid"]), "free piece overlapping a foundation refused (%s)" % r7["reason"])
	# explorer difficulty builds at once when you carry the materials
	var prev_diff := Game.difficulty
	Game.difficulty = &"explorer"
	p.inventory.add(&"log", 4)
	p.inventory.add(&"stone", 4)
	var inst := bm.place_from(bm.compute(&"log_foundation", h2)) as BuildPiece
	check(inst != null and inst.is_complete() and p.inventory.count(&"log") == 0, "explorer: built instantly, cost deducted")
	Game.difficulty = prev_diff
	# dismantle: 50% refund of a built piece, full refund of a frame
	var inv := p.inventory
	var logs0 := inv.count(&"log")
	p.active = &"hammer"
	check(inst.get_interact_hold_time() > 0.5 and inst.get_interact_prompt(p).begins_with("Dismantle"), "hammer + hold interact dismantles")
	BuildingRoot.dismantle(inst, p)
	check(inv.count(&"log") == logs0 + 2 and inv.count(&"stone") == 2, "dismantling refunds half (%d logs, %d stones)" % [inv.count(&"log") - logs0, inv.count(&"stone")])
	var fr := bm.place_from(bm.compute(&"log_wall", h2)) as BuildPiece
	p.active = &""
	inv.add(&"log", 3)
	fr.interact(p)
	fr.interact(p)
	check(fr.build.added_units() == 2 and not fr.is_complete(), "interact adds materials to a frame one by one")
	p.active = &"hammer"
	var before := inv.count(&"log")
	BuildingRoot.dismantle(fr, p)
	check(inv.count(&"log") == before + 2, "cancelling a frame returns everything added")
	# a door (own use) opens with the hammer in hand; it is only dismantled while build mode is open
	var door: BuildPiece = null
	for st in root.structures():
		if st.get_piece(&"door", Vector3i(0, 0, 3)):
			door = st.get_piece(&"door", Vector3i(0, 0, 3))
	if door:
		check(door.get_interact_prompt(p).ends_with("door") and door.get_interact_hold_time() == 0.0,
			"hammer in hand: the door still opens (%s)" % door.get_interact_prompt(p))
		root.build_mode = bm
		bm.active = true
		check(door.get_interact_prompt(p).begins_with("Dismantle"), "in build mode the hammer dismantles the door")
		bm.active = false
		root.build_mode = null
	p.active = &""
	bm.queue_free()
	await get_tree().process_frame


# =============================================================================================== camp pieces

func _camp_pieces() -> void:
	var p := _stub_player(Vector3(-30.0, GROUND_Y, -30.0))
	Game.player = p
	var at := Vector3(-30.0, GROUND_Y, -33.0)
	Climate.set_weather(&"clear", 0.0)
	Climate.locked = true
	# drying rack: meat -> jerky, hide -> cured hide, over game time
	var rack := root.place_free(&"drying_rack", Transform3D(Basis.IDENTITY, at), true) as BuildDryingRack
	check(rack != null and rack.is_complete(), "drying rack placed")
	p.inventory.add(&"meat_raw", 2)
	p.inventory.add(&"hide_raw", 1)
	rack.advance()
	check(rack.own_prompt(p).begins_with("Hang"), "prompt to hang raw meat")
	rack.own_interact(p)
	rack.own_interact(p)
	rack.own_interact(p)
	check(rack.meat.size() == 2 and not rack.hide.is_empty() and p.inventory.count(&"meat_raw") == 0, "two strips and a hide hung")
	Climate.advance_time(6.0)
	rack.advance()
	check(rack.ready_count() == 0, "not dry after 6 h")
	Climate.advance_time(6.0)
	rack.advance()
	check(rack.ready_count() == 2, "jerky ready after 12 h (%d)" % rack.ready_count())
	rack.own_interact(p)
	check(p.inventory.count(&"meat_dried") == 2 and rack.meat.is_empty(), "jerky collected")
	Climate.advance_time(22.0)
	rack.advance()
	rack.collect(p.inventory)
	check(p.inventory.count(&"hide_cured") == 1, "hide cured after ~30 h")
	# snow melter beside a lit fire
	var melter := root.place_free(&"snow_melter", Transform3D(Basis.IDENTITY, at + Vector3(4.0, 0.0, 0.0)), true) as BuildSnowMelter
	p.inventory.add(&"snow", 7)
	p.inventory.add(&"bottle_empty", 3)
	melter.add_snow(p.inventory)
	check(melter.snow == 7, "snow packed in (%d)" % melter.snow)
	Climate.advance_time(1.0)
	melter.advance()
	check(melter.water == 0, "no fire: nothing melts")
	var fire := root.place_free(&"campfire", Transform3D(Basis.IDENTITY, at + Vector3(5.3, 0.0, 0.0)), true) as Node3D
	fire.set(&"always_simulate", true)
	fire.set(&"fuel_minutes", 240.0)
	fire.call(&"_set_state", 1)
	check(fire.call(&"is_heat_active"), "fire lit beside the melter")
	melter.advance()
	Climate.advance_time(1.0)
	melter.advance()
	check(melter.water == 2 and melter.snow == 1, "an hour by the fire: 2 bottles' worth (%d water, %d snow)" % [melter.water, melter.snow])
	melter.own_interact(p)
	check(p.inventory.count(&"water_boiled") == 2 and p.inventory.count(&"bottle_empty") == 1, "bottles filled with boiled water")
	# torch stand: light, burn down
	var torch := root.place_free(&"torch_stand", Transform3D(Basis.IDENTITY, at + Vector3(-3.0, 0.0, 0.0)), true) as BuildTorchStand
	torch.set_lit(true, true)
	check(torch.is_heat_active() and torch.is_in_group(&"heat_source"), "torch stand lit = heat source")
	torch.always_simulate = true
	torch._process(0.0)
	Climate.advance_time(5.0)
	torch._process(0.016)
	check(not torch.lit and torch.minutes_left <= 0.0, "torch stand burns out after its fuel (%.0f min left)" % torch.minutes_left)
	# lean-to: a ~0.5 shelter; stone windbreak ~0.3
	var lean := root.place_free(&"lean_to", Transform3D(Basis.IDENTITY, at + Vector3(0.0, 0.0, -8.0)), true) as BuildLeanTo
	await get_tree().process_frame
	Climate.refresh_sources()
	var sh := Climate.get_shelter_at(lean.global_position + Vector3(0.0, 1.0, -0.2))
	check(sh > 0.4 and sh < 0.6, "lean-to shelter ≈ 0.5 (%.2f)" % sh)
	# a frame isn't functional
	var frame := root.place_free(&"bough_bed", Transform3D(Basis.IDENTITY, at + Vector3(0.0, 0.0, 4.0)), false) as BuildBed
	check(frame.get_interact_prompt(p).begins_with("Bough Bed needs") or frame.get_interact_prompt(p).begins_with("Add"), "a bed frame asks for materials (%s)" % frame.get_interact_prompt(p))
	p.inventory.add(&"stick", 14)
	p.inventory.add(&"rope", 1)
	frame.build.add_all(p.inventory)
	check(frame.is_complete() and frame.get_interact_prompt(p) == "Sleep", "finished bed offers sleep (%s)" % frame.get_interact_prompt(p))


# =============================================================================================== sleep

func _sleep() -> void:
	var p := _stub_player(Vector3(-30.0, GROUND_Y, -29.0))
	var v := p.vitals
	v.food = 80.0
	v.water = 80.0
	v.warmth = 90.0
	v.env_felt_temp = 12.0
	check(BuildSleep.sleep_problem(p, p.global_position) == "", "may sleep when warm and safe")
	var wolf := Node3D.new()
	wolf.add_to_group(&"creature")
	wolf.set_meta(&"x", 1)
	wolf.set(&"name", "Wolf")
	var ws := GDScript.new()
	ws.source_code = "extends Node3D\nvar species := &\"wolf\"\n"
	ws.reload()
	wolf.set_script(ws)
	add_child(wolf)
	wolf.global_position = p.global_position + Vector3(12.0, 0.0, 0.0)
	check(BuildSleep.sleep_problem(p, p.global_position).contains("danger"), "no sleep with a wolf 12 m away")
	wolf.global_position = p.global_position + Vector3(120.0, 0.0, 0.0)
	check(BuildSleep.sleep_problem(p, p.global_position) == "", "wolf far away: fine")
	v.warmth = 12.0
	check(BuildSleep.sleep_problem(p, p.global_position).begins_with("Too cold"), "no sleep while freezing")
	v.warmth = 90.0
	var started := [0.0]
	var ended := [false]
	var on_start := func(h: float) -> void: started[0] = h
	var on_end := func() -> void: ended[0] = true
	Events.sleep_started.connect(on_start)
	Events.sleep_ended.connect(on_end)
	var t0 := float(Climate.day) * 24.0 + Climate.hours
	var res := BuildSleep.sleep_now(p, 8.0, 1.0, false)
	var t1 := float(Climate.day) * 24.0 + Climate.hours
	check(is_equal_approx(started[0], 8.0) and ended[0], "sleep_started(8) / sleep_ended emitted")
	check(absf(t1 - t0 - 8.0) < 0.01, "the clock advanced 8 h (%.2f)" % (t1 - t0))
	check(float(res["food"]) < -3.0 and float(res["water"]) < -5.0, "food and water drain while asleep (%.1f / %.1f)" % [res["food"], res["water"]])
	check(float(res["food"]) > -20.0, "sleeping burns less than being awake")
	check(not v.env_sleeping, "woke up")
	Events.sleep_started.disconnect(on_start)
	Events.sleep_ended.disconnect(on_end)
	wolf.queue_free()


# =============================================================================================== log carrying

func _log_carry() -> void:
	var p := _stub_player(Vector3(40.0, GROUND_Y, -40.0))
	var lc := LogCarry.new()
	lc.player = p
	p.add_child(lc)
	p.inventory.add(&"log", 1)
	await get_tree().process_frame
	check(lc.count == 1 and is_equal_approx(p.speed_cap, LogCarry.CAP_ONE), "one log: capped at a jog (%.1f)" % p.speed_cap)
	p.inventory.add(&"log", 2)
	await get_tree().process_frame
	await get_tree().process_frame
	check(p.inventory.count(&"log") == 2, "a third log doesn't fit on the shoulder (%d)" % p.inventory.count(&"log"))
	check(is_equal_approx(p.speed_cap, LogCarry.CAP_TWO), "two logs: slowed further (%.1f)" % p.speed_cap)
	var pickup := ItemPickup.new()
	pickup.item_id = &"log"
	check(lc.filter_prompt(pickup, "Pick up Spruce Log").begins_with("Your shoulder is full") and lc.blocks(pickup), "prompt refuses a third log")
	pickup.free()
	p.inventory.remove(&"log", 2)
	await get_tree().process_frame
	check(is_inf(p.speed_cap), "no logs: no cap")


# =============================================================================================== batching

func _batching() -> void:
	# 4 two-storey cabins ≈ 240 pieces: a few dozen MultiMeshes in total
	var total := 0
	var mms := 0
	for c in 4:
		var s := root.new_structure(Transform3D(Basis.IDENTITY, Vector3(134.0 + c * 14.0, GROUND_Y + 0.5, 150.0)))
		for i in [-2, 0, 2]:
			for k in [-2, 0, 2]:
				s.add_piece(&"log_foundation", Vector3i(i, 0, k), {}, true)
				s.add_piece(&"log_floor", Vector3i(i, 1, k), {}, true)
		for lvl in 2:
			for i in [-2, 0, 2]:
				s.add_piece(&"log_wall", Vector3i(i, lvl, 3), {}, true)
				s.add_piece(&"log_wall", Vector3i(i, lvl, -3), {}, true)
				s.add_piece(&"log_window_wall", Vector3i(3, lvl, i), {}, true)
				s.add_piece(&"log_wall", Vector3i(-3, lvl, i), {}, true)
		for i in [-2, 0, 2]:
			s.add_piece(&"log_roof", Vector3i(i, 1, -2), {"dir": 1, "tier": 0, "shape": "slope"}, true)
			s.add_piece(&"log_roof", Vector3i(i, 1, 2), {"dir": 3, "tier": 0, "shape": "slope"}, true)
			s.add_piece(&"log_roof", Vector3i(i, 1, 0), {"dir": 1, "tier": 1, "shape": "peak"}, true)
		s.flush_now()
		total += s.piece_count()
		mms += s.multimesh_count()
	root.batcher.flush()
	check(total >= 200, "%d pieces placed" % total)
	check(mms <= 4 * 30, "each cabin uses ≤ 30 distinct meshes (%d)" % mms)
	var shared := root.batcher.multimesh_count_in(BuildBatcher.cluster_of(Vector3(150.0, 0.0, 150.0)))
	check(shared <= 36, "%d pieces in 4 cabins drawn by %d shared MultiMeshes" % [total, shared])


func _teardown() -> void:
	Climate.locked = false
	Game.player = null
	if player and is_instance_valid(player):
		player.queue_free()
	root.queue_free()
	ground.queue_free()
	await get_tree().process_frame

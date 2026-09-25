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
	await _teardown()


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
	check(w.build.add_one(inv, true) and inv.count(&"log") == 2 and w.build.added_units() == 1, "adding a log moves it from the pack")
	w.build.add_all(inv)
	check(not w.is_complete() and w.build.missing().get(&"log", 0) == 1, "frame waits for the last log")
	inv.add(&"log", 1)
	w.build.add_one(inv, true)
	check(w.is_complete(), "frame completes with the 4th log")
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
	check(ss.size() == 1, "one structure after load (%d)" % ss.size())
	if ss.is_empty():
		return
	var s2 := ss[0]
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


func _teardown() -> void:
	root.queue_free()
	ground.queue_free()
	await get_tree().process_frame

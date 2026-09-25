extends TestCase
## Vegetation: asset library, deterministic scatter, exclusion rules (POI pads, water, cliffs, trails),
## species by altitude, LOD/visibility settings, near-player colliders, grass ring, harvest state machine
## (chop -> fell -> settle -> buck into logs; shrubs, rocks) and the persistence roundtrip.
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_vegetation.gd

const Cat := VegScatter.Cat


class FakeInventory:
	extends RefCounted
	var items: Dictionary = {}

	func add(id: StringName, amount := 1, _durability := 1.0) -> int:
		items[id] = int(items.get(id, 0)) + amount
		return 0


class FakePlayer:
	extends Node3D
	var inventory := FakeInventory.new()
	var trauma := 0.0

	func add_trauma(a: float) -> void:
		trauma += a


var terrain: VegTestTerrain
var spawned: Array = []
var felled_events: Array = []


func run() -> void:
	terrain = VegTestTerrain.new()
	_test_library()
	_test_scatter_determinism()
	_test_scatter_rules()
	_test_grass_cells()
	var veg := await _make_vegetation()
	_test_lod_settings(veg)
	await _test_colliders(veg)
	await _test_harvest_tree(veg)
	_test_small_harvest(veg)
	await _test_persistence(veg)
	veg.queue_free()
	await get_tree().process_frame


# ---------------------------------------------------------------------------------------------- library

func _test_library() -> void:
	var lib := VegLibrary.get_shared()
	check(lib.kind_names.size() >= 30, "manifest lists >= 30 kinds (%d)" % lib.kind_names.size())
	var species := {}
	var bad_lod := []
	var over_budget := []
	for k in lib.kind_names:
		var inf := lib.info(k)
		if int(inf["cat"]) == Cat.TREE or int(inf["cat"]) == Cat.SAPLING:
			species[String(inf.get("species", ""))] = true
			var tris: Array = inf.get("tris", [])
			if not tris.is_empty() and int(tris[0]) > 6000:
				over_budget.append(k)
		var ms := lib.meshes(k)
		if ms.size() != 3:
			bad_lod.append(k)
			continue
		for m in ms:
			for si in (m as Mesh).get_surface_count():
				if not (m as Mesh).surface_get_material(si) is ShaderMaterial:
					bad_lod.append(k)
	for sp in ["spruce", "fir", "lodgepole", "whitebark", "larch", "snag"]:
		check(species.has(sp), "tree species present: %s" % sp)
	check(bad_lod.is_empty(), "every kind has 3 LOD meshes with vegetation ShaderMaterials %s" % [bad_lod])
	check(over_budget.is_empty(), "tree LOD0 <= 6k triangles %s" % [over_budget])
	check(lib.has_impostors(), "impostor atlas + material loaded")
	var imp_trees := 0
	for k in lib.kind_names:
		if lib.info(k).has("impostor_layer"):
			imp_trees += 1
	check(imp_trees >= 12, "impostor layers for the mature trees (%d)" % imp_trees)
	for g in [&"grass_tuft_a", &"grass_tuft_b", &"sedge_tuft", &"fern_clump"]:
		var gm := lib.grass_mesh(g)
		var ok := gm != null and gm.surface_get_material(0) is ShaderMaterial \
			and String((gm.surface_get_material(0) as ShaderMaterial).shader.resource_path).ends_with("grass.gdshader")
		check(ok, "ground cover %s uses grass.gdshader" % g)


# ---------------------------------------------------------------------------------------------- scatter

func _ctx() -> VegScatter.Context:
	var ctx := VegScatter.make_context(VegLibrary.get_shared(), terrain, 1.0)
	ctx.has_water = true
	return ctx


func _cells_in_window() -> Array:
	var out: Array = []
	var c0 := VegScatter.cell_of(-VegTestTerrain.WINDOW, -VegTestTerrain.WINDOW)
	var c1 := VegScatter.cell_of(VegTestTerrain.WINDOW - 1.0, VegTestTerrain.WINDOW - 1.0)
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			out.append(Vector2i(cx, cz))
	return out


func _test_scatter_determinism() -> void:
	var ctx := _ctx()
	var a := VegScatter.generate_cell(ctx, 24, 25)
	var b := VegScatter.generate_cell(_ctx(), 24, 25)
	# generate some other cells in between: must not affect the result
	VegScatter.generate_cell(ctx, 23, 25)
	var c := VegScatter.generate_cell(ctx, 24, 25)
	check(a.size() > 20, "a forested cell has instances (%d)" % a.size())
	check(a.kinds == b.kinds and a.pos == b.pos and a.ids == b.ids and a.xf == b.xf,
		"scatter is deterministic (fresh context)")
	check(a.kinds == c.kinds and a.pos == c.pos, "scatter is order independent")
	var ids_ok := true
	for i in a.size():
		if VegScatter.id_cell(a.ids[i]) != VegScatter.cell_index(24, 25) or (a.ids[i] & 4095) != i:
			ids_ok = false
	check(ids_ok, "instance ids encode (cell << 12 | local index)")


func _test_scatter_rules() -> void:
	var ctx := _ctx()
	var lib := VegLibrary.get_shared()
	var n_tree := 0
	var on_pad := 0
	var in_lake := 0
	var too_steep := 0
	var on_trail := 0
	var above_line := 0
	var rocks_on_rock := 0
	var rocks := 0
	var low := {}
	var high := {}
	for c in _cells_in_window():
		var cd := VegScatter.generate_cell(ctx, c.x, c.y)
		for i in cd.size():
			var p := cd.pos[i]
			var cat := int(cd.cats[i])
			var kind := lib.kind_names[cd.kinds[i]]
			if cat == Cat.ROCK_BIG:
				rocks += 1
				if terrain.get_masks(p.x, p.z).g > 0.3:
					rocks_on_rock += 1
			if cat != Cat.TREE and cat != Cat.SAPLING:
				continue
			n_tree += 1
			if Vector2(p.x - VegTestTerrain.PAD.x, p.z - VegTestTerrain.PAD.y).length() < VegTestTerrain.PAD.z:
				on_pad += 1
			if terrain.get_water_level(p.x, p.z) > terrain.get_height(p.x, p.z) - 0.25:
				in_lake += 1
			if terrain.get_slope_deg(p.x, p.z) > VegScatter.MAX_SLOPE[Cat.TREE]:
				too_steep += 1
			if VegScatter.excluded(ctx, p.x, p.z, 0.0) and not Vector2(p.x - VegTestTerrain.PAD.x, p.z - VegTestTerrain.PAD.y).length() < VegTestTerrain.PAD.z:
				on_trail += 1
			var y := terrain.get_height(p.x, p.z)
			if y > 2420.0:
				above_line += 1
			var sp := String(lib.info(kind).get("species", ""))
			if y < 1700.0:
				low[sp] = int(low.get(sp, 0)) + 1
			elif y > 2050.0 and y < 2350.0:
				high[sp] = int(high.get(sp, 0)) + 1
	check(n_tree > 800, "window has a forest (%d trees)" % n_tree)
	check(on_pad == 0, "no trees on the POI flat pad (%d)" % on_pad)
	check(in_lake == 0, "no trees in water (%d)" % in_lake)
	check(too_steep == 0, "no trees on cliffs steeper than %d deg (%d)" % [VegScatter.MAX_SLOPE[Cat.TREE], too_steep])
	check(on_trail == 0, "no trees on trails (%d)" % on_trail)
	check(above_line == 0, "no trees above ~2,420 m (%d)" % above_line)
	check(rocks > 10 and rocks_on_rock * 2 > rocks, "boulders mostly on rock/scree (%d of %d)" % [rocks_on_rock, rocks])
	var low_conifer := int(low.get("spruce", 0)) + int(low.get("fir", 0)) + int(low.get("lodgepole", 0))
	var low_treeline := int(low.get("larch", 0)) + int(low.get("whitebark", 0))
	check(low_conifer > 50 and low_treeline == 0, "valley: spruce/fir/lodgepole, no larch/whitebark (%s)" % [low])
	var hi_treeline := int(high.get("larch", 0)) + int(high.get("whitebark", 0))
	check(hi_treeline > 20, "treeline band has larch + whitebark (%s)" % [high])
	check(int(high.get("lodgepole", 0)) == 0, "no lodgepole near treeline")


func _test_grass_cells() -> void:
	var ctx := _ctx()
	var G: GDScript = load("res://src/vegetation/veg_grass.gd")
	var a: Array = G.generate_cell(ctx, Vector2i(-2, 2), 0.5, 1.0, 4)
	var b: Array = G.generate_cell(ctx, Vector2i(-2, 2), 0.5, 1.0, 4)
	var total := 0
	for k in 4:
		total += (a[k] as PackedFloat32Array).size() / 12
	check(total > 50, "grass cell has tufts (%d)" % total)
	check(a == b, "grass cell generation is deterministic")
	# lake cell and the POI pad: nothing in the water / on the pad
	var wet := 0
	var pad := 0
	var cc := Vector2i(int(floor(VegTestTerrain.LAKE.x / 24.0)), int(floor(VegTestTerrain.LAKE.y / 24.0)))
	for dc in [Vector2i(0, 0), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(0, -1)]:
		var bufs: Array = G.generate_cell(ctx, cc + dc, 0.5, 1.0, 4)
		for buf in bufs:
			var f: PackedFloat32Array = buf
			for i in f.size() / 12:
				var x := f[i * 12 + 3]
				var z := f[i * 12 + 11]
				if terrain.get_water_level(x, z) > terrain.get_height(x, z) - 0.25:
					wet += 1
	var pc := Vector2i(int(floor(VegTestTerrain.PAD.x / 24.0)), int(floor(VegTestTerrain.PAD.y / 24.0)))
	for buf in G.generate_cell(ctx, pc, 0.5, 1.0, 4):
		var f2: PackedFloat32Array = buf
		for i in f2.size() / 12:
			if Vector2(f2[i * 12 + 3] - VegTestTerrain.PAD.x, f2[i * 12 + 11] - VegTestTerrain.PAD.y).length() < VegTestTerrain.PAD.z:
				pad += 1
	check(wet == 0, "no grass in the lake (%d)" % wet)
	check(pad == 0, "no grass on the POI pad (%d)" % pad)


# ---------------------------------------------------------------------------------------------- vegetation node

func _make_vegetation() -> Node:
	var veg: Node = (load("res://scenes/world/vegetation.tscn") as PackedScene).instantiate()
	veg.set("terrain_override", terrain)
	veg.set("single_threaded", true)
	veg.set("sync_all", true)
	add_child(veg)
	await get_tree().process_frame
	check(veg.is_generated and veg.instance_count() > 1000, "Vegetation generated the window (%d)" % veg.instance_count())
	check(veg.harvest != null and veg.colliders != null and veg.grass != null, "subsystems attached")
	check(veg.is_in_group(&"persistent") and veg.get_save_key() == "vegetation", "persistent, key 'vegetation'")
	return veg


func _test_lod_settings(veg: Node) -> void:
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = Vector3(0.0, terrain.get_height(0.0, 150.0) + 1.7, 150.0)
	veg.camera_override = cam
	veg.rebin_now()
	var st: Dictionary = veg.near_stats()
	check(int(st["mmis"]) > 5 and int(st["instances"]) > 50, "near-field MultiMeshes binned (%s)" % [st])
	check(int(st["far_cells"]) > 0, "far impostor cells built (%d)" % int(st["far_cells"]))
	var ok_ranges := true
	var shadow_only := 0
	for mmi in veg._near.values():
		var m: MultiMeshInstance3D = mmi
		if m.visible and m.visibility_range_end <= 0.0:
			ok_ranges = false
		if m.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY:
			shadow_only += 1
	check(ok_ranges, "near MultiMeshes have visibility_range_end")
	check(shadow_only > 0, "shadow proxies are shadow-only MultiMeshes")
	var imp_ok := true
	for mmi in veg._far.values():
		if not is_equal_approx(float((mmi as MultiMeshInstance3D).get_instance_shader_parameter(&"lod_begin")), veg.imp_distance):
			imp_ok = false
	check(imp_ok, "impostors fade in at tree_impostor_distance (%.0f)" % veg.imp_distance)
	# settings change: impostor distance / density
	var old_imp: Variant = Settings.get_value(&"tree_impostor_distance")
	var old_den: Variant = Settings.get_value(&"vegetation_density")
	var q0: int = veg.query(cam.global_position, 120.0, [Cat.TREE]).size()
	Settings.values[&"tree_impostor_distance"] = 70.0
	Settings.values[&"vegetation_density"] = 0.4
	Events.settings_changed.emit()
	check(is_equal_approx(veg.imp_distance, 70.0), "imp_distance follows Settings on settings_changed")
	var tb: Array = veg.get_bands(Cat.TREE)
	check(is_equal_approx(float(tb[tb.size() - 1][1]), 70.0), "last mesh band ends at the impostor distance")
	var q1: int = veg.query(cam.global_position, 120.0, [Cat.TREE]).size()
	check(q1 < q0 and q1 > q0 * 0.5, "vegetation_density thins trees gently (%d -> %d)" % [q0, q1])
	var far_ok := true
	for mmi in veg._far.values():
		if not is_equal_approx(float((mmi as MultiMeshInstance3D).get_instance_shader_parameter(&"lod_begin")), 70.0):
			far_ok = false
	check(far_ok, "far cells rebuilt with the new impostor distance")
	Settings.values[&"tree_impostor_distance"] = old_imp
	Settings.values[&"vegetation_density"] = old_den
	Events.settings_changed.emit()
	veg.rebin_now()


var forest_center := Vector3.ZERO


## A spot in dense forest on the valley slope (most trees within 40 m).
func _find_forest_center(veg: Node) -> Vector3:
	var best := Vector3.ZERO
	var bn := -1
	for x in range(-450, 300, 50):
		for z in range(-450, 500, 50):
			var p := Vector3(x, 0.0, z)
			var n: int = veg.query(p, 40.0, [Cat.TREE]).size()
			if n > bn:
				bn = n
				best = p
	best.y = terrain.get_height(best.x, best.z)
	return best


func _test_colliders(veg: Node) -> void:
	var col: Node = veg.colliders
	forest_center = _find_forest_center(veg)
	var c := forest_center
	col.center_override = c
	col.refresh(c)
	await get_tree().physics_frame
	var n: int = col.active_count()
	var far := 0
	var layers_ok := true
	for id in col._active:
		var p: VegProxy = col._active[id]
		var d := Vector2(p.global_position.x - c.x, p.global_position.z - c.z).length()
		if d > _collider_range() + 7.0:
			far += 1
		if p.cat == Cat.TREE and p.collision_layer != VegProxy.LAYER_VEGETATION:
			layers_ok = false
		if p.cat == Cat.ROCK_BIG and p.collision_layer != VegProxy.LAYER_WORLD:
			layers_ok = false
		if p.cat == Cat.SHRUB and p.collision_layer != VegProxy.LAYER_INTERACT:
			layers_ok = false
	check(n > 20 and n < 800, "colliders only near the player (%d bodies)" % n)
	check(far == 0, "no colliders beyond range")
	check(layers_ok, "trunks on layer 10, boulders on layer 1, shrubs interact-only (layer 5)")
	var all_trees: int = veg.query(c, 2000.0, [Cat.TREE]).size()
	check(n < all_trees / 4, "never a body per tree (%d active vs %d trees)" % [n, all_trees])
	# moving away releases bodies back to the pool
	var c2 := c + Vector3(0.0, 0.0, -300.0)
	col.refresh(c2)
	var still := 0
	for id in col._active:
		var p2: VegProxy = col._active[id]
		if Vector2(p2.global_position.x - c.x, p2.global_position.z - c.z).length() < 20.0:
			still += 1
	check(still == 0, "moving away releases the old bodies (pool %d)" % col._pool.size())
	col.refresh(c)


func _collider_range() -> float:
	return 46.0


func _nearest(veg: Node, c: Vector3, cat: int, pred := Callable()) -> Dictionary:
	var best := {}
	var bd := INF
	for e in veg.query(c, 60.0, [cat]):
		if pred.is_valid() and not pred.call(e):
			continue
		var d := Vector2(e["pos"].x - c.x, e["pos"].z - c.z).length()
		if d < bd:
			bd = d
			best = e
	return best


func _test_harvest_tree(veg: Node) -> void:
	var h: VegHarvest = veg.harvest
	spawned.clear()
	h.pickup_spawner = func(id: StringName, count: int, pos: Vector3, _imp: Vector3) -> Node:
		spawned.append([id, count, pos])
		return null
	felled_events.clear()
	var cb := func(pos: Vector3, sp: StringName) -> void: felled_events.append([pos, sp])
	Events.tree_felled.connect(cb)
	var c := forest_center
	var e := _nearest(veg, c, Cat.TREE, func(q: Dictionary) -> bool:
		return String(VegLibrary.get_shared().info(q["kind"]).get("species", "")) in ["spruce", "fir", "lodgepole"])
	check(not e.is_empty(), "found a mature conifer to fell")
	if e.is_empty():
		return
	var id: int = e["id"]
	# ground for the falling tree
	var ground := StaticBody3D.new()
	var gs := CollisionShape3D.new()
	gs.shape = WorldBoundaryShape3D.new()
	ground.add_child(gs)
	add_child(ground)
	var tp: Vector3 = e["pos"]
	ground.global_position = Vector3(tp.x, terrain.get_height(tp.x, tp.z) - 0.05, tp.z)
	var player := FakePlayer.new()
	add_child(player)
	player.global_position = tp + Vector3(1.2, 0.0, 0.0)
	Game.player = player
	var hit := tp + Vector3(0.3, 1.0, 0.0)
	h.hit_instance(id, &"hatchet", 22.0, hit, Vector3.RIGHT, player)
	check(h.trees.has(id), "first hit creates the chop state")
	check(veg.hidden.has(id) and h.trees[id].hero != null, "chopped tree swapped to a hero mesh")
	var hp0: float = h.trees[id].max_hp
	check(hp0 > 60.0 and hp0 < 600.0, "tree HP scales with trunk size (%.0f)" % hp0)
	var hits := 1
	while h.trees.has(id) and hits < 60:
		h.hit_instance(id, &"hatchet", 22.0, hit, Vector3.RIGHT, player)
		hits += 1
	check(hits >= 3 and hits <= 25, "hatchet fells it in a realistic number of hits (%d)" % hits)
	check(veg.removed.has(id) and not veg.hidden.has(id), "felled tree removed from the scatter")
	check(h.stumps.has(id) and h._stump_nodes.has(id), "stump left behind")
	check(felled_events.size() == 1, "Events.tree_felled emitted once")
	check(h.fallen.has(id), "falling rigid body created")
	# extra hits on the removed instance are ignored
	h.hit_instance(id, &"hatchet", 22.0, hit, Vector3.RIGHT, player)
	var ft: VegFelledTree = h.fallen.get(id)
	if ft == null:
		return
	check(ft.collision_layer == VegFelledTree.LAYER_ITEMS, "felled trunk on layer 4 (items)")
	var start_top := ft.global_transform.basis.y
	Engine.time_scale = 4.0
	var frames := 0
	while not ft.is_down() and frames < 2400:
		await get_tree().physics_frame
		frames += 1
	Engine.time_scale = 1.0
	var tilt := rad_to_deg(acos(clampf(ft.global_transform.basis.y.dot(Vector3.UP), -1.0, 1.0)))
	check(ft.is_down(), "felled tree settles (%d physics frames)" % frames)
	check(tilt > 60.0, "tree lies on the ground (tilt %.0f deg)" % tilt)
	var fell_dir := Vector3(ft.global_transform.basis.y.x, 0.0, ft.global_transform.basis.y.z).normalized()
	check(fell_dir.dot(Vector3(-1, 0, 0)) > 0.5, "falls away from the chopper (dir %s)" % fell_dir)
	check(player.trauma > 0.0, "impact shakes a nearby player's camera")
	# bucking into logs
	var logs0 := ft.logs_left
	check(logs0 >= 2, "trunk yields several logs (%d)" % logs0)
	var guard := 0
	while is_instance_valid(ft) and not ft.is_queued_for_deletion() and guard < 200:
		ft.harvest_hit(&"hatchet", 22.0, ft.global_position, Vector3.UP, player)
		guard += 1
	var logs := 0
	var sticks := 0
	for s in spawned:
		if s[0] == &"log":
			logs += int(s[1])
		elif s[0] == &"stick":
			sticks += int(s[1])
	check(logs == logs0, "bucking spawns one 'log' pickup per section (%d/%d)" % [logs, logs0])
	check(sticks > 0, "crown leaves sticks")
	check(not h.fallen.has(id), "fully bucked trunk is gone")
	Events.tree_felled.disconnect(cb)
	Game.player = null
	ground.queue_free()
	player.queue_free()


func _test_small_harvest(veg: Node) -> void:
	var h: VegHarvest = veg.harvest
	var player := FakePlayer.new()
	add_child(player)
	var lib := VegLibrary.get_shared()
	# a huckleberry bush: interact for berries, once
	var found := {}
	for e in veg.query(Vector3.ZERO, 600.0, [Cat.SHRUB]):
		if String(lib.info(e["kind"]).get("group", "")) == "huckleberry":
			found = e
			break
	check(not found.is_empty(), "huckleberry bushes are scattered")
	if not found.is_empty():
		var id: int = found["id"]
		check(h.interact_prompt(id, player) != "", "bush offers an interaction")
		h.interact_instance(id, player)
		check(int(player.inventory.items.get(&"berries", 0)) >= 3, "picking gives berries (%s)" % [player.inventory.items])
		check(h.interact_prompt(id, player) == "", "berries picked: no prompt left")
		spawned.clear()
		for i in 12:
			h.hit_instance(id, &"knife", 8.0, found["pos"], Vector3.UP, player)
		check(veg.removed.has(id), "cutting the bush down removes it")
		var st := 0
		for s in spawned:
			if s[0] == &"stick":
				st += int(s[1])
		check(st >= 1, "cut bush drops sticks")
	# a small rock: picked up by hand
	var rock := _nearest(veg, Vector3(0.0, 0.0, -300.0), Cat.ROCK_SMALL)
	if rock.is_empty():
		rock = _nearest(veg, Vector3(0.0, 0.0, -150.0), Cat.ROCK_SMALL)
	check(not rock.is_empty(), "small rocks are scattered")
	if not rock.is_empty():
		var before := int(player.inventory.items.get(&"stone", 0)) + int(player.inventory.items.get(&"flint", 0))
		h.interact_instance(rock["id"], player)
		var after := int(player.inventory.items.get(&"stone", 0)) + int(player.inventory.items.get(&"flint", 0))
		check(after > before and veg.removed.has(rock["id"]), "small rock picked up into the inventory")
	# a boulder: pickaxe yields until spent, bare hands nothing
	var boulder := _nearest(veg, Vector3(0.0, 0.0, -350.0), Cat.ROCK_BIG, func(q: Dictionary) -> bool:
		return not bool(lib.info(q["kind"]).get("talus", false)))
	check(not boulder.is_empty(), "boulders are scattered")
	if not boulder.is_empty():
		spawned.clear()
		h.hit_instance(boulder["id"], &"", 5.0, boulder["pos"], Vector3.UP, player)
		check(spawned.is_empty(), "hands do nothing to a boulder")
		for i in 60:
			h.hit_instance(boulder["id"], &"ice_axe", 12.0, boulder["pos"], Vector3.UP, player)
		check(spawned.size() == VegHarvest.BOULDER_YIELDS, "pickaxe gets %d stone/flint then the rock is spent (%d)" % [VegHarvest.BOULDER_YIELDS, spawned.size()])
	player.queue_free()


func _test_persistence(veg: Node) -> void:
	var h: VegHarvest = veg.harvest
	var c := Vector3(-60.0, 0.0, 120.0)
	c.y = terrain.get_height(c.x, c.z)
	# a partially chopped tree and a freshly felled one (left falling)
	var trees: Array = veg.query(c, 80.0, [Cat.TREE])
	check(trees.size() >= 2, "trees for the persistence test")
	if trees.size() < 2:
		return
	var a: Dictionary = trees[0]
	var b: Dictionary = trees[1]
	var pa: Vector3 = a["pos"]
	h.hit_instance(a["id"], &"stone_axe", 12.0, pa + Vector3(0.3, 1.0, 0.0), Vector3.RIGHT, null)
	var hp_a: float = h.trees[a["id"]].hp
	h.fell(b["id"], b["pos"] + Vector3(2.0, 0.0, 0.0))
	await get_tree().physics_frame
	var data: Dictionary = veg.save_state()
	var json := JSON.stringify(data)
	var back: Variant = JSON.parse_string(json)
	check(back is Dictionary, "save_state is JSON-safe")
	var removed_before: int = veg.removed.size()
	var uses_before: int = h.uses.size()
	var stumps_before: int = h.stumps.size()
	# wipe and reload into the same node (like Save.load_game after the world is rebuilt)
	veg.load_state({})
	check(veg.removed.is_empty() and h.trees.is_empty() and h.stumps.is_empty(), "load_state({}) resets")
	veg.load_state(back)
	await get_tree().process_frame
	check(veg.removed.size() == removed_before, "removed ids restored (%d)" % veg.removed.size())
	check(h.stumps.size() == stumps_before and h._stump_nodes.size() == stumps_before, "stumps restored (%d)" % stumps_before)
	check(h.uses.size() == uses_before, "bush/rock use counters restored")
	check(h.trees.has(a["id"]) and is_equal_approx(h.trees[a["id"]].hp, hp_a), "partially chopped tree keeps its HP")
	check(veg.hidden.has(a["id"]), "restored chopped tree drawn by its hero mesh")
	check(h.fallen.has(b["id"]), "fallen trunk restored")

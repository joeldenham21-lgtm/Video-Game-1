class_name ItemVisuals
extends RefCounted
## Procedural models for every item and buildable (real-world scale, PBR materials from ItemMaterials).
## Used by world pickups (ItemPickup), the campfire/storage/station scenes and the icon renderer
## (tools/icons/), so a stick in your hand, on the ground and in the inventory are the same stick.
## Models rest on y = 0, centred in XZ; long items lie along X. When a hero model exists
## (ItemDB "model" glb), pickups and icons use that instead.
## Must not reference autoloads: the icon exporter runs in a bare SceneTree.

## Standing design (handle +Y, blade +X, flat faces ±Z) -> lying on the ground (handle +X, flat side up).
const LAY := Basis(Vector3(0, 0, 1), Vector3(1, 0, 0), Vector3(0, 1, 0))
## Profile drawn in XY with thickness along Z -> lying on its side (Z up).
const LAY_SIDE := Basis(Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 1, 0))

const UPRIGHT: Array[StringName] = [&"water_boiled", &"water_unsafe", &"bottle_empty", &"pine_tea", &"coffee",
	&"canned_beans", &"lantern", &"fuel_can", &"painkillers", &"lamp_oil", &"cooking_pot", &"canteen", &"wool_hat",
	&"fur_hat", &"boots", &"mountaineering_boots", &"backpack_torn", &"backpack", &"expedition_pack",
	&"radio_handheld", &"goggles", &"o2_mask", &"binoculars", &"tin_can", &"battery_pack", &"transceiver_module",
	&"herbal_poultice", &"mushroom", &"lighter", &"slit_goggles", &"first_aid_kit"]
const GARMENTS: Array[StringName] = [&"parka", &"field_jacket", &"wool_sweater", &"hide_coat", &"blanket_capote",
	&"down_suit", &"hiking_pants", &"insulated_pants", &"hide_leggings", &"hide_raw", &"work_gloves", &"fur_mitts"]
const SQUARE: Array[StringName] = [&"map", &"survival_manual", &"dale_logbook", &"station_keycard", &"cloth",
	&"wool_blanket", &"emergency_blanket", &"coffee_grounds", &"ration_bar", &"electronics", &"matches",
	&"scrap_metal", &"meat_raw", &"meat_cooked", &"meat_dried", &"crampons", &"charcoal", &"nails", &"berries",
	&"wool", &"tinder", &"resin", &"battery", &"flare_shell", &"bone_needle", &"sinew", &"usnea", &"pine_needles"]
const BUILD: Array[StringName] = [&"campfire", &"stone_fire_pit", &"lean_to", &"log_foundation", &"log_floor",
	&"log_wall", &"log_window_wall", &"log_doorway", &"door", &"log_roof", &"log_stairs", &"log_pillar",
	&"log_railing", &"stone_windbreak", &"storage_box", &"drying_rack", &"workbench", &"snow_melter", &"bough_bed",
	&"bed", &"torch_stand", &"rope_ladder"]

static var _cache: Dictionary = {}


## Cached, material-bearing mesh for an id (null if nothing could be built).
static func get_mesh(id: StringName, category := "") -> ArrayMesh:
	if _cache.has(id):
		return _cache[id]
	var m := build(id, 1.0, true, category)
	_cache[id] = m
	return m


static func clear_cache() -> void:
	_cache.clear()


## Adds a "Model" MeshInstance3D for `id` under `parent` (hero glb if `model_path` exists) and, optionally, a
## box CollisionShape3D "Shape" around it. Returns the model node (null if nothing could be built).
static func attach_model(parent: Node3D, id: StringName, with_collision := true, model_path := "") -> Node3D:
	var node: Node3D = null
	var aabb := AABB()
	if model_path != "" and ResourceLoader.exists(model_path):
		var ps := load(model_path) as PackedScene
		if ps:
			node = ps.instantiate() as Node3D
	if node == null:
		var mesh := get_mesh(id)
		if mesh == null:
			return null
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		aabb = mesh.get_aabb()
		node = mi
	node.name = "Model"
	parent.add_child(node)
	if with_collision and aabb.size != Vector3.ZERO and parent.get_node_or_null(^"Shape") == null:
		var col := CollisionShape3D.new()
		col.name = "Shape"
		var box := BoxShape3D.new()
		box.size = aabb.size
		col.shape = box
		col.position = aabb.get_center()
		parent.add_child(col)
	return node


## The campfire model with glowing-coal surfaces (material "charred_glow"; the Campfire node animates it).
static func campfire_mesh(detail := 1.0) -> ArrayMesh:
	var key := StringName("_campfire_lit_%.2f" % detail)
	if _cache.has(key):
		return _cache[key]
	var b := ItemMeshBuilder.new(detail)
	var r := RandomNumberGenerator.new()
	r.seed = String("campfire").hash()
	_campfire(b, r, true)
	var m := b.commit(true)
	_cache[key] = m
	return m


static func build(id: StringName, detail := 1.0, with_materials := true, category := "") -> ArrayMesh:
	var b := ItemMeshBuilder.new(detail)
	if not populate(b, id, category):
		return null
	b.recenter(true)
	return b.commit(with_materials)


## Icon framing hints consumed by tools/icons: view "flat" (lying, seen from above at 3/4) or "upright";
## yaw rotates the model about Y before framing; elev is the camera elevation in degrees.
static func icon_pose(id: StringName) -> Dictionary:
	if id in UPRIGHT:
		return {"view": "upright", "yaw": -28.0, "elev": 16.0}
	if id in BUILD:
		return {"view": "upright", "yaw": -32.0, "elev": 26.0}
	if id in GARMENTS:
		return {"view": "flat", "yaw": 0.0, "elev": 64.0}
	if id in SQUARE:
		return {"view": "flat", "yaw": 18.0, "elev": 50.0}
	return {"view": "flat", "yaw": 36.0, "elev": 50.0}


## Fills a builder with the model for `id` (falls back to a generic shape per category). False if nothing.
static func populate(b: ItemMeshBuilder, id: StringName, category := "") -> bool:
	var r := RandomNumberGenerator.new()
	r.seed = String(id).hash()
	match id:
		# ---- resources
		&"stick": _stick(b, r)
		&"log": _log_item(b)
		&"stone": b.rock(&"granite", 0.06, 11, 3, 0.07, Vector3(1.18, 0.7, 0.95), 0.25, 0, 0.18, 0.7)
		&"flint": b.rock(&"chert", 0.045, 23, 2, 0.08, Vector3(1.3, 0.55, 0.95), 0.1, 16, 0.4)
		&"fiber": _fiber(b, r, &"grass", 26, 0.42, &"grass")
		&"bark": _bark_sheet(b)
		&"resin": _resin(b, r)
		&"feather": _feather(b)
		&"bone": _bone(b)
		&"sinew": _fiber(b, r, &"sinew", 12, 0.24, &"sinew")
		&"hide_raw": _pelt(b)
		&"hide_cured": _hide_roll(b)
		&"wool": _wool(b, r)
		&"cloth": _cloth(b)
		&"scrap_metal": _scrap(b, r)
		&"wire": _wire(b)
		&"duct_tape": _tape(b)
		&"rope": _rope_coil(b, r, &"rope", 0.07, 4, 0.0085)
		&"nails": _nails(b, r)
		&"fuel_can": _jerrycan(b)
		&"battery": _battery(b)
		&"electronics": _pcb(b)
		&"charcoal": _charcoal(b, r)
		&"tinder": _tinder(b, r)
		&"snow": b.rock(&"snow", 0.055, 5, 3, 0.16, Vector3(1.1, 0.8, 1.0), 0.3, 0, 0.18, 1.6)
		&"pine_needles": _sprig(b, r)
		&"usnea": _usnea(b, r)
		&"tin_can": _tin_can(b)
		&"lamp_oil": _lamp_oil(b)
		&"wool_blanket": _blanket(b, r)
		&"emergency_blanket": _mylar(b)
		&"coffee_grounds": _sachet(b)
		&"o2_bottle", &"o2_bottle_empty": _o2(b)
		# ---- food & drink
		&"berries": _berries(b, r)
		&"mushroom": _mushroom(b)
		&"meat_raw": _steak(b, &"meat_raw", 1.0)
		&"meat_cooked": _steak(b, &"meat_cooked", 0.9)
		&"meat_dried": _jerky(b, r)
		&"fish_raw": _fish(b, &"fish", &"fin")
		&"fish_cooked": _fish(b, &"fish_cooked", &"charred")
		&"ration_bar": _ration(b)
		&"canned_beans": _can(b, &"label_beans")
		&"pine_tea": _bottle(b, &"tea", 0.8)
		&"coffee": _bottle(b, &"coffee_liquid", 0.8, &"plastic_black")
		&"water_unsafe": _bottle(b, &"water_murky", 0.9)
		&"water_boiled": _bottle(b, &"water", 0.86)
		&"bottle_empty": _bottle(b, &"", 0.0)
		# ---- tools & weapons
		&"stone_axe": _stone_axe(b, r)
		&"hatchet": _axe(b, 0.36, 1.0, &"steel_dark", &"wood_handle", 0.012)
		&"felling_axe": _axe(b, 0.8, 1.4, &"steel_black", &"wood_handle", 0.03)
		&"knife": _knife(b)
		&"stone_knife": _stone_knife(b, r)
		&"spear": _spear(b, r)
		&"bow": _bow(b)
		&"arrow": _arrows(b)
		&"torch": _torch(b, r)
		&"flare": _flare(b)
		&"flare_gun": _flare_gun(b)
		&"flare_shell": _shells(b)
		&"lantern": _lantern(b)
		&"ice_axe": _ice_axe(b)
		&"canteen": _canteen(b)
		&"cooking_pot": _pot(b)
		&"binoculars": _binoculars(b)
		&"survey_scanner": _scanner(b)
		&"map": _map(b)
		&"compass": _compass(b)
		&"hammer": _hammer(b)
		&"lighter": _lighter(b)
		&"matches": _matches(b)
		&"ferro_rod": _ferro(b)
		&"bow_drill": _bow_drill(b, r)
		&"bone_needle": _needles(b)
		&"crampons": _crampons(b)
		&"climbing_rope": _rope_coil(b, r, &"rope_red", 0.15, 9, 0.0058)
		&"o2_mask": _o2_mask(b)
		&"goggles": _goggles(b)
		&"slit_goggles": _slit_goggles(b)
		# ---- medical
		&"bandage": _bandage(b)
		&"first_aid_kit": _first_aid(b)
		&"painkillers": _pills(b)
		&"splint": _splint(b)
		&"herbal_poultice": _poultice(b)
		# ---- clothing
		&"wool_hat": _toque(b)
		&"fur_hat": _fur_hat(b)
		&"field_jacket": _jacket(b, &"weave_charcoal", 0.04, 0.006)
		&"wool_sweater": _sweater(b)
		&"hide_coat": _hide_coat(b)
		&"blanket_capote": _capote(b)
		&"parka": _parka(b)
		&"down_suit": _down_suit(b)
		&"hiking_pants": _pants(b, &"weave_grey", 0.03, false)
		&"insulated_pants": _pants(b, &"weave_charcoal", 0.06, true)
		&"hide_leggings": _leggings(b)
		&"work_gloves": _gloves(b, &"leather_pale", false)
		&"fur_mitts": _gloves(b, &"suede", true)
		&"boots": _boots(b, false)
		&"mountaineering_boots": _boots(b, true)
		&"backpack_torn": _pack(b, 0)
		&"backpack": _pack(b, 1)
		&"expedition_pack": _pack(b, 2)
		# ---- quest
		&"survival_manual": _book(b, Vector3(0.14, 0.02, 0.21), &"cover_green", &"label_manual", false)
		&"dale_logbook": _logbook(b)
		&"radio_handheld": _radio(b)
		&"transceiver_module": _transceiver(b)
		&"battery_pack": _battery_pack(b)
		&"mine_key": _key(b)
		&"station_keycard": _keycard(b)
		# ---- buildables
		&"campfire": _campfire(b, r, false)
		&"stone_fire_pit": _fire_pit(b, r)
		&"lean_to": _lean_to(b, r)
		&"log_foundation": _foundation(b, r, false)
		&"log_floor": _foundation(b, r, true)
		&"log_wall": _log_wall(b, 0)
		&"log_window_wall": _log_wall(b, 1)
		&"log_doorway": _log_wall(b, 2)
		&"door": _door(b)
		&"log_roof": _roof(b, r)
		&"log_stairs": _stairs(b)
		&"log_pillar": _log(b, Vector3.ZERO, Vector3(0, 2.5, 0), 0.14, &"bark", &"endgrain", 14)
		&"log_railing": _railing(b, r)
		&"stone_windbreak": _windbreak(b, r)
		&"storage_box": _crate(b)
		&"drying_rack": _drying_rack(b, r)
		&"workbench": _workbench(b, r)
		&"snow_melter": _snow_melter(b, r)
		&"bough_bed": _bough_bed(b, r)
		&"bed": _hide_bed(b)
		&"torch_stand": _torch_stand(b, r)
		&"rope_ladder": _rope_ladder(b, r)
		&"fabricator": _fabricator(b)
		_:
			return _fallback(b, r, category)
	return true


# =============================================================================================== helpers

static func _at(p: Vector3, rot := Vector3.ZERO, s := Vector3.ONE) -> Transform3D:
	return ItemMeshBuilder.at(p, rot, s)


static func _wobble_path(r: RandomNumberGenerator, a: Vector3, b: Vector3, n: int, wob: float) -> PackedVector3Array:
	var path := PackedVector3Array()
	var dir := (b - a).normalized()
	var side := dir.cross(Vector3.UP)
	side = side.normalized() if side.length_squared() > 1e-6 else Vector3.RIGHT
	var up := side.cross(dir).normalized()
	var k1 := r.randf_range(-1.0, 1.0)
	var k2 := r.randf_range(-1.0, 1.0)
	var ph := r.randf_range(0.0, TAU)
	for i in n + 1:
		var f := float(i) / n
		var bend := sin(f * PI) * wob
		var kink := sin(f * 9.0 + ph) * wob * 0.25
		path.append(a.lerp(b, f) + side * (k1 * bend + kink) + up * (k2 * bend * 0.5))
	return path


static func _taper(n: int, r0: float, r1: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for i in n + 1:
		out.append(lerpf(r0, r1, float(i) / n))
	return out


## A branch/stick between two points with bark and cut ends.
static func _branch(b: ItemMeshBuilder, r: RandomNumberGenerator, a: Vector3, e: Vector3, r0: float, r1: float,
		bark := &"bark", cap := &"wood_pale", wob := 0.012, sides := 7) -> void:
	var n := 8
	b.tube(bark, _wobble_path(r, a, e, n, wob), _taper(n, r0, r1), sides, true, true, cap)


## A straight log (bark, end grain caps) between two points.
static func _log(b: ItemMeshBuilder, a: Vector3, e: Vector3, rad: float, bark := &"bark", cap := &"endgrain", sides := 14) -> void:
	var path := PackedVector3Array([a, a.lerp(e, 0.5), e])
	b.tube(bark, path, PackedFloat32Array([rad * 1.03, rad, rad * 0.96]), sides, true, true, cap)


## Cord wrapped around an axis (lashings, grip wraps, ties).
static func _lash(b: ItemMeshBuilder, center: Vector3, axis: Vector3, rad: float, turns: float, width: float, mat: StringName,
		cord := 0.0022) -> void:
	var ax := axis.normalized()
	var q := Quaternion(Vector3.UP, ax)
	b.push(Transform3D(Basis(q), center - ax * width * 0.5))
	b.helix(mat, rad + cord, width / maxf(turns, 0.5), turns, cord, 5)
	b.pop()


## Ring (torus) around an axis at a point.
static func _ring(b: ItemMeshBuilder, center: Vector3, axis: Vector3, big_r: float, r: float, mat: StringName, n := 16) -> void:
	var q := Quaternion(Vector3.UP, axis.normalized())
	b.push(Transform3D(Basis(q), center))
	b.torus(mat, big_r, r, n, 6)
	b.pop()


static func _poly(pts: Array, s := 1.0) -> PackedVector2Array:
	var out := PackedVector2Array()
	for q in pts:
		out.append((q as Vector2) * s)
	return out


static func _mirror_x(poly: PackedVector2Array) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in range(poly.size() - 1, -1, -1):
		out.append(Vector2(-poly[i].x, poly[i].y))
	return out


## Hollow cylinder (rolls of tape/bandage) around +Y from y 0..h.
static func _annulus(b: ItemMeshBuilder, outer: StringName, side: StringName, inner: StringName, r_in: float, r_out: float, h: float) -> void:
	b.lathe(outer, PackedVector2Array([Vector2(r_out, 0.0), Vector2(r_out, h)]), 28, 40.0)
	b.lathe(side, PackedVector2Array([Vector2(r_out, h), Vector2(r_in, h)]), 28, 40.0)
	b.lathe(side, PackedVector2Array([Vector2(r_in, 0.0), Vector2(r_out, 0.0)]), 28, 40.0)
	b.lathe(inner, PackedVector2Array([Vector2(r_in, h), Vector2(r_in, 0.0)]), 28, 40.0)


# =============================================================================================== resources

static func _stick(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	_branch(b, r, Vector3(-0.36, 0, 0), Vector3(0.36, 0, 0), 0.017, 0.010, &"bark", &"wood_pale", 0.02)
	_branch(b, r, Vector3(-0.05, 0.004, 0.006), Vector3(0.0, 0.01, 0.05), 0.006, 0.004, &"bark", &"wood_pale", 0.003, 5)
	_branch(b, r, Vector3(0.16, 0.004, -0.005), Vector3(0.2, 0.012, -0.045), 0.005, 0.0035, &"bark", &"wood_pale", 0.002, 5)


static func _log_item(b: ItemMeshBuilder) -> void:
	_log(b, Vector3(-0.6, 0, 0), Vector3(0.6, 0, 0), 0.125, &"bark", &"endgrain", 18)
	b.push(_at(Vector3(-0.2, 0.1, 0.06), Vector3(30, 0, -20)))
	b.cylinder(&"bark", 0.022, 0.05, 8, true, &"endgrain")
	b.pop()
	b.push(_at(Vector3(0.28, 0.07, -0.1), Vector3(-50, 0, 10)))
	b.cylinder(&"bark", 0.018, 0.045, 8, true, &"endgrain")
	b.pop()


## A tied bundle of flat strands (plant fibre, sinew).
static func _fiber(b: ItemMeshBuilder, r: RandomNumberGenerator, mat: StringName, count: int, length: float, tie: StringName) -> void:
	for i in count:
		var z0 := r.randf_range(-0.03, 0.03)
		var y0 := r.randf_range(0.0, 0.018)
		var a := Vector3(-length * 0.5 + r.randf_range(-0.04, 0.03), y0, z0 * 1.6 + r.randf_range(-0.02, 0.02))
		var e := Vector3(length * 0.5 + r.randf_range(-0.03, 0.04), y0 + r.randf_range(-0.004, 0.004), z0 * 1.8 + r.randf_range(-0.03, 0.03))
		var path := _wobble_path(r, a, e, 8, 0.015)
		for k in path.size():
			var f := float(k) / (path.size() - 1)
			var pinch := 1.0 - 0.8 * exp(-pow((f - 0.5) * 5.0, 2.0))
			path[k] = Vector3(path[k].x, lerpf(0.012, path[k].y, pinch), path[k].z * pinch)
		b.tube(mat, path, PackedVector2Array([Vector2(0.0028, 0.0006)]), 4, false, false, &"", Vector3.UP)
	_lash(b, Vector3(0, 0.012, 0), Vector3.RIGHT, 0.012, 4, 0.03, tie, 0.0022)


static func _bark_sheet(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3.ZERO, Vector3(0, 0, 90)))
	b.lathe(&"birch", PackedVector2Array([Vector2(0.06, -0.12), Vector2(0.06, 0.12)]), 18, 40.0, Vector2.ONE, false, 0.5, 3.8)
	b.lathe(&"suede", PackedVector2Array([Vector2(0.0575, 0.12), Vector2(0.0575, -0.12)]), 18, 40.0, Vector2.ONE, false, 0.5, 3.8)
	b.pop()
	b.push(_at(Vector3(0.02, -0.02, 0.1), Vector3(0, 25, 90)))
	b.lathe(&"birch", PackedVector2Array([Vector2(0.035, -0.06), Vector2(0.035, 0.06)]), 14, 40.0, Vector2.ONE, false, 0.2, 4.2)
	b.lathe(&"suede", PackedVector2Array([Vector2(0.033, 0.06), Vector2(0.033, -0.06)]), 14, 40.0, Vector2.ONE, false, 0.2, 4.2)
	b.pop()


static func _resin(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	b.push(_at(Vector3(0, 0.006, 0), Vector3(0, 10, 0)))
	b.box(&"bark", Vector3(0.1, 0.012, 0.065), 0.005)
	b.pop()
	for i in 5:
		var p := Vector3(r.randf_range(-0.03, 0.03), 0.012, r.randf_range(-0.02, 0.02))
		b.push(_at(p))
		b.rock(&"resin", r.randf_range(0.007, 0.013), 40 + i, 2, 0.25, Vector3(1.25, 0.65, 1.0), 0.45)
		b.pop()


static func _feather(b: ItemMeshBuilder) -> void:
	var vane := _poly([Vector2(0.018, 0.001), Vector2(0.05, 0.009), Vector2(0.11, 0.012), Vector2(0.16, 0.009),
		Vector2(0.192, 0.002), Vector2(0.186, -0.006), Vector2(0.15, -0.018), Vector2(0.09, -0.023),
		Vector2(0.04, -0.018), Vector2(0.02, -0.006)])
	b.extrude(&"feather", vane, 0.0007, &"feather")
	b.push(_at(Vector3.ZERO, Vector3(0, 0, -90)))
	b.lathe(&"bone", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.0016, 0.002), Vector2(0.0014, 0.06),
		Vector2(0.0007, 0.17), Vector2(0.0, 0.195)]), 6)
	b.pop()
	b.transform_all(Transform3D(LAY_SIDE, Vector3.ZERO))


static func _bone(b: ItemMeshBuilder) -> void:
	var path := PackedVector3Array([Vector3(-0.1, 0, 0), Vector3(-0.03, 0.002, 0.002), Vector3(0.04, 0.0, -0.002), Vector3(0.1, 0, 0)])
	b.tube(&"bone", path, PackedFloat32Array([0.012, 0.0095, 0.0092, 0.0118]), 12, false, false)
	b.push(_at(Vector3(-0.112, 0.0, 0.0)))
	b.rock(&"bone", 0.021, 3, 2, 0.22, Vector3(0.95, 0.9, 1.25), 0.0, 0, 0.18, 2.5)
	b.pop()
	b.push(_at(Vector3(0.11, 0.0, 0.0)))
	b.rock(&"bone", 0.018, 4, 2, 0.25, Vector3(0.9, 1.0, 1.1), 0.0, 0, 0.18, 2.5)
	b.pop()


static func _pelt(b: ItemMeshBuilder) -> void:
	var o := _poly([Vector2(-0.05, -0.45), Vector2(0.08, -0.43), Vector2(0.18, -0.35), Vector2(0.34, -0.44),
		Vector2(0.3, -0.3), Vector2(0.26, -0.15), Vector2(0.28, 0.1), Vector2(0.37, 0.34), Vector2(0.22, 0.3),
		Vector2(0.12, 0.42), Vector2(0.0, 0.46), Vector2(-0.12, 0.42), Vector2(-0.22, 0.3), Vector2(-0.36, 0.35),
		Vector2(-0.28, 0.1), Vector2(-0.26, -0.15), Vector2(-0.31, -0.3), Vector2(-0.34, -0.45), Vector2(-0.18, -0.35)], 0.9)
	b.pillow(&"fur", o, 0.03, 0.035, &"hide_raw", 0.012, 5)


static func _hide_roll(b: ItemMeshBuilder) -> void:
	b.tube(&"suede", PackedVector3Array([Vector3(-0.2, 0, 0), Vector3(0.2, 0, 0)]), 0.065, 16, true, true, &"fur")
	b.push(_at(Vector3(0, 0.058, 0.03)))
	b.box(&"suede", Vector3(0.4, 0.006, 0.02), 0.002)
	b.pop()
	_ring(b, Vector3(-0.11, 0, 0), Vector3.RIGHT, 0.0665, 0.0035, &"rope", 20)
	_ring(b, Vector3(0.11, 0, 0), Vector3.RIGHT, 0.0665, 0.0035, &"rope", 20)


static func _wool(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 6:
		var p := Vector3(r.randf_range(-0.05, 0.05), 0.02, r.randf_range(-0.035, 0.035))
		b.push(_at(p))
		b.rock(&"wool_raw", r.randf_range(0.028, 0.042), 60 + i, 2, 0.5, Vector3(1.2, 0.7, 1.0), 0.3, 0, 0.18, 3.5)
		b.pop()


static func _cloth(b: ItemMeshBuilder) -> void:
	var sq := _poly([Vector2(-0.11, -0.08), Vector2(0.11, -0.08), Vector2(0.11, 0.08), Vector2(-0.11, 0.08)])
	b.pillow(&"weave_khaki", sq, 0.022, 0.015, &"weave_khaki", 0.005, 3)
	b.push(_at(Vector3(0.015, 0.018, 0.012), Vector3(0, 14, 0)))
	b.pillow(&"weave_blue", _poly([Vector2(-0.1, -0.07), Vector2(0.1, -0.07), Vector2(0.1, 0.07), Vector2(-0.1, 0.07)]), 0.018, 0.015, &"weave_blue", 0.005, 4)
	b.pop()
	b.push(_at(Vector3(-0.02, 0.032, -0.01), Vector3(0, -8, 0)))
	b.pillow(&"weave_plaid", _poly([Vector2(-0.08, -0.055), Vector2(0.09, -0.06), Vector2(0.085, 0.06), Vector2(-0.075, 0.055)]), 0.014, 0.012, &"weave_plaid", 0.006, 9)
	b.pop()


static func _scrap(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	var mats: Array[StringName] = [&"aluminium", &"paint_white", &"rust"]
	for i in 3:
		var p := Vector3(r.randf_range(-0.04, 0.04), 0.012 + i * 0.012, r.randf_range(-0.04, 0.04))
		b.push(_at(p, Vector3(0, r.randf_range(-50.0, 50.0), 0)))
		b.push(_at(Vector3(-0.035, 0, 0), Vector3(0, 0, r.randf_range(8.0, 20.0))))
		b.box(mats[i], Vector3(0.075, 0.002, 0.065), 0.0005)
		b.pop()
		b.push(_at(Vector3(0.03, 0.008, 0), Vector3(0, 0, -r.randf_range(18.0, 35.0))))
		b.box(mats[i], Vector3(0.06, 0.002, 0.065), 0.0005)
		b.pop()
		if i == 0:
			for k in 4:
				b.push(_at(Vector3(-0.06 + k * 0.016, 0.0012, 0.026)))
				b.sphere(&"steel", 0.0022, 8, 4)
				b.pop()
		b.pop()
	b.push(_at(Vector3(0.06, 0.004, -0.05), Vector3(0, 30, 0)))
	b.box(&"steel_dark", Vector3(0.06, 0.004, 0.02), 0.001)
	b.push(_at(Vector3(0.028, 0.012, 0)))
	b.box(&"steel_dark", Vector3(0.004, 0.024, 0.02), 0.001)
	b.pop()
	b.pop()


static func _wire(b: ItemMeshBuilder) -> void:
	b.helix(&"copper", 0.045, 0.0032, 6.0, 0.0013, 5)
	b.helix(&"steel", 0.041, 0.0034, 4.0, 0.0011, 5, 1.3)
	b.tube(&"copper", PackedVector3Array([Vector3(0.045, 0.0195, 0.0), Vector3(0.07, 0.02, 0.02), Vector3(0.09, 0.016, 0.01),
		Vector3(0.115, 0.01, 0.035), Vector3(0.12, 0.004, 0.05)]), 0.0013, 5)


static func _tape(b: ItemMeshBuilder) -> void:
	_annulus(b, &"tape_silver", &"tape_silver", &"cardboard", 0.037, 0.05, 0.048)
	b.lathe(&"cardboard", PackedVector2Array([Vector2(0.036, 0.048), Vector2(0.036, 0.0)]), 24, 40.0)
	b.push(_at(Vector3(0.05, 0.024, 0.0), Vector3(0, -20, 0)))
	b.box(&"tape_silver", Vector3(0.03, 0.048, 0.0012), 0.0004)
	b.pop()


static func _rope_coil(b: ItemMeshBuilder, r: RandomNumberGenerator, mat: StringName, radius: float, loops: int, cord: float) -> void:
	for i in loops:
		var rr := radius * (1.0 + r.randf_range(-0.07, 0.07))
		var y := cord + i * cord * 1.3
		b.push(_at(Vector3(r.randf_range(-0.008, 0.008), y, r.randf_range(-0.008, 0.008)),
			Vector3(r.randf_range(-5.0, 5.0), r.randf_range(0.0, 360.0), r.randf_range(-5.0, 5.0))))
		b.torus(mat, rr, cord, 40, 7)
		b.pop()
	var h := loops * cord * 1.3
	_lash(b, Vector3(radius, h * 0.5 + cord, 0), Vector3.FORWARD, h * 0.5 + cord, 4.0, radius * 0.4, mat, cord)
	var tail := PackedVector3Array([Vector3(radius + 0.01, cord, 0.02), Vector3(radius + 0.06, cord, 0.06),
		Vector3(radius + 0.08, cord, 0.13), Vector3(radius + 0.05, cord, 0.2)])
	b.tube(mat, tail, cord, 7, true, true)


static func _nails(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 8:
		var p := Vector3(r.randf_range(-0.03, 0.03), 0.0045 + i * 0.0015, r.randf_range(-0.03, 0.03))
		b.push(_at(p, Vector3(0, r.randf_range(0.0, 180.0), 90)))
		b.lathe(&"galvanized", PackedVector2Array([Vector2(0.0, -0.038), Vector2(0.0018, -0.032), Vector2(0.0018, 0.036),
			Vector2(0.0045, 0.037), Vector2(0.0045, 0.039), Vector2(0.0, 0.0395)]), 8)
		b.pop()


static func _jerrycan(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.12, 0)))
	b.box(&"paint_yellow", Vector3(0.2, 0.24, 0.12), 0.016, 3)
	b.pop()
	for ang in [38.0, -38.0]:
		b.push(_at(Vector3(0, 0.11, -0.061), Vector3(0, 0, ang)))
		b.box(&"paint_yellow", Vector3(0.22, 0.018, 0.006), 0.003)
		b.pop()
	b.push(_at(Vector3(0, 0.2, 0.0612)))
	b.box(&"paint_yellow", Vector3(0.18, 0.016, 0.006), 0.003)
	b.pop()
	b.push(_at(Vector3(0, 0.1, 0.0632), Vector3(90, 0, 0)))
	b.plane(&"label_diesel", Vector2(0.14, 0.09))
	b.pop()
	for x in [-0.045, 0.0, 0.045]:
		b.tube(&"paint_yellow", PackedVector3Array([Vector3(x, 0.235, -0.035), Vector3(x, 0.272, -0.03),
			Vector3(x, 0.272, 0.03), Vector3(x, 0.235, 0.035)]), 0.0062, 6)
	b.push(_at(Vector3(0.065, 0.235, 0.0), Vector3(0, 0, -25)))
	b.cylinder(&"steel_dark", 0.018, 0.035, 14)
	b.pop()


static func _battery(b: ItemMeshBuilder) -> void:
	for i in 2:
		b.push(_at(Vector3(0, 0.0167, i * 0.04 - 0.02), Vector3(0, i * 12.0, 90)))
		var rr := 0.0167
		var h := 0.0615
		b.lathe(&"label_battery", PackedVector2Array([Vector2(rr, -h * 0.5 + 0.002), Vector2(rr, h * 0.5 - 0.002)]), 24, 40.0, Vector2.ONE, true)
		b.lathe(&"steel", PackedVector2Array([Vector2(0.0, -h * 0.5), Vector2(rr * 0.92, -h * 0.5), Vector2(rr, -h * 0.5 + 0.002)]), 24)
		b.lathe(&"steel", PackedVector2Array([Vector2(rr, h * 0.5 - 0.002), Vector2(rr * 0.92, h * 0.5), Vector2(0.005, h * 0.5),
			Vector2(0.0045, h * 0.5 + 0.0016), Vector2(0.0, h * 0.5 + 0.0016)]), 24)
		b.pop()


static func _pcb(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.0008, 0)))
	b.box(&"plastic_green", Vector3(0.1, 0.0016, 0.07), 0.0003)
	b.pop()
	b.push(_at(Vector3(0, 0.00165, 0)))
	b.plane(&"print_pcb", Vector2(0.1, 0.07))
	b.pop()
	for p in [Vector3(0.03, 0.0016, 0.02), Vector3(0.038, 0.0016, -0.016)]:
		b.push(_at(p))
		b.cylinder(&"plastic_blue", 0.004, 0.011, 10)
		b.pop()
		b.push(_at(p + Vector3(0, 0.011, 0)))
		b.cylinder(&"aluminium", 0.0041, 0.0009, 10)
		b.pop()
	b.push(_at(Vector3(-0.042, 0.005, 0)))
	b.box(&"plastic_white", Vector3(0.008, 0.007, 0.03), 0.0008)
	b.pop()
	b.tube(&"plastic_red", PackedVector3Array([Vector3(-0.046, 0.005, 0.006), Vector3(-0.07, 0.004, 0.02), Vector3(-0.09, 0.0015, 0.012)]), 0.0013, 5)
	b.tube(&"plastic_black", PackedVector3Array([Vector3(-0.046, 0.005, -0.006), Vector3(-0.075, 0.003, -0.015), Vector3(-0.093, 0.0015, -0.022)]), 0.0013, 5)


static func _charcoal(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 5:
		var p := Vector3(r.randf_range(-0.035, 0.035), 0.015, r.randf_range(-0.03, 0.03))
		b.push(_at(p, Vector3(0, r.randf_range(0.0, 180.0), 0)))
		b.rock(&"coal", r.randf_range(0.018, 0.028), 80 + i, 2, 0.06, Vector3(1.4, 0.7, 1.0), 0.2, 9, 0.28)
		b.pop()


static func _tinder(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 26:
		var a0 := r.randf_range(0.0, TAU)
		var span := r.randf_range(1.2, 2.6)
		var rad := r.randf_range(0.028, 0.052)
		var path := PackedVector3Array()
		for k in 8:
			var a := a0 + span * k / 7.0
			path.append(Vector3(cos(a) * rad, 0.006 + r.randf_range(0.0, 0.022), sin(a) * rad))
		b.tube(&"birch" if i % 4 == 0 else &"grass", path, PackedVector2Array([Vector2(0.0022, 0.0005)]), 4, false, false, &"", Vector3.UP)
	b.push(_at(Vector3(0, 0.014, 0)))
	b.rock(&"usnea", 0.026, 7, 2, 0.5, Vector3(1.0, 0.6, 1.0), 0.2, 0, 0.18, 4.0)
	b.pop()


static func _sprig(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	var main := _wobble_path(r, Vector3(-0.1, 0.006, 0), Vector3(0.1, 0.006, 0), 6, 0.01)
	b.tube(&"bark", main, _taper(6, 0.003, 0.0015), 5, true, true, &"wood_pale")
	var twigs: Array[PackedVector3Array] = [main]
	for t in 5:
		var f := 0.15 + t * 0.15
		var base := main[int(f * 6.0)]
		var side := 1.0 if t % 2 == 0 else -1.0
		var tip := base + Vector3(0.035 + r.randf_range(0.0, 0.02), 0.0, side * r.randf_range(0.03, 0.05))
		var tw := PackedVector3Array([base, base.lerp(tip, 0.5) + Vector3(0, 0.002, 0), tip])
		b.tube(&"bark", tw, _taper(2, 0.0014, 0.0008), 4, false, true, &"wood_pale")
		twigs.append(tw)
	for tw in twigs:
		var n := 14 if tw.size() > 3 else 7
		for k in n * 2:
			var f := r.randf_range(0.05, 1.0)
			var seg := mini(int(f * (tw.size() - 1)), tw.size() - 2)
			var p := tw[seg].lerp(tw[seg + 1], f * (tw.size() - 1) - seg)
			var fwd := (tw[seg + 1] - tw[seg]).normalized()
			var side := fwd.cross(Vector3.UP).normalized() * (1.0 if k % 2 == 0 else -1.0)
			var dir := (side + fwd * 0.6 + Vector3.UP * r.randf_range(-0.2, 0.4)).normalized()
			b.tube(&"needles", PackedVector3Array([p, p + dir * r.randf_range(0.013, 0.019)]), PackedFloat32Array([0.0008, 0.0003]), 3, false, false)


static func _usnea(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 18:
		var path := PackedVector3Array()
		var ang := r.randf_range(-0.6, 0.6)
		var dir := Vector3(cos(ang), 0, sin(ang))
		var perp := Vector3(-dir.z, 0, dir.x)
		var ln := r.randf_range(0.07, 0.13)
		var ph := r.randf_range(0.0, TAU)
		for k in 10:
			var f := k / 9.0
			path.append(dir * (f * ln - 0.03) + perp * sin(f * 12.0 + ph) * 0.006 + Vector3(0, 0.004 + r.randf_range(0.0, 0.006), 0))
		b.tube(&"usnea", path, _taper(9, 0.0014, 0.0006), 4, false, false)
	b.push(_at(Vector3(-0.028, 0.006, 0)))
	b.rock(&"usnea", 0.012, 3, 1, 0.4, Vector3(1.2, 0.6, 1.2), 0.2)
	b.pop()


static func _tin_can(b: ItemMeshBuilder) -> void:
	var rad := 0.0375
	var h := 0.105
	b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.002), Vector2(rad - 0.003, 0.002), Vector2(rad - 0.002, 0.0),
		Vector2(rad, 0.004), Vector2(rad, h), Vector2(rad - 0.0012, h), Vector2(rad - 0.0012, 0.004), Vector2(0.0, 0.004)]), 28, 50.0)
	for y in [0.03, 0.052, 0.074]:
		b.push(_at(Vector3(0, y, 0)))
		b.torus(&"steel", rad, 0.0009, 28, 4)
		b.pop()
	b.push(_at(Vector3(0, h, 0)))
	b.torus(&"steel", rad - 0.0006, 0.0012, 28, 5)
	b.pop()
	b.push(_at(Vector3(rad * 0.92, h, 0), Vector3(0, 0, -115)))
	b.push(_at(Vector3(-rad + 0.002, 0, 0)))
	b.cylinder(&"steel", rad - 0.003, 0.0008, 24)
	b.pop()
	b.pop()


static func _lamp_oil(b: ItemMeshBuilder) -> void:
	b.lathe(&"paint_blue", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.038, 0.0), Vector2(0.04, 0.004), Vector2(0.04, 0.15),
		Vector2(0.036, 0.17), Vector2(0.02, 0.195), Vector2(0.013, 0.2), Vector2(0.013, 0.214)]), 24, 40.0)
	b.lathe(&"plastic_red", PackedVector2Array([Vector2(0.0, 0.21), Vector2(0.0152, 0.21), Vector2(0.0155, 0.232),
		Vector2(0.0145, 0.234), Vector2(0.0, 0.234)]), 16, 40.0)
	b.lathe(&"paper", PackedVector2Array([Vector2(0.0405, 0.04), Vector2(0.0405, 0.11)]), 24, 40.0)


static func _blanket(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 3:
		var w := 0.36 - i * 0.006
		var o := _poly([Vector2(-w * 0.5, 0.1), Vector2(w * 0.5, 0.1), Vector2(w * 0.5, 0.36), Vector2(-w * 0.5, 0.36)])
		b.push(_at(Vector3(r.randf_range(-0.004, 0.004), i * 0.036, -0.23)))
		b.pillow(&"blanket", o, 0.04, 0.02, &"blanket", 0.006, 11 + i)
		b.pop()


static func _mylar(b: ItemMeshBuilder) -> void:
	b.pillow(&"foil_gold", _poly([Vector2(-0.045, -0.065), Vector2(0.045, -0.065), Vector2(0.045, 0.065), Vector2(-0.045, 0.065)]), 0.012, 0.008, &"foil_gold", 0.004, 3)
	b.push(_at(Vector3(0.004, 0.011, -0.002), Vector3(0, 4, 0)))
	b.pillow(&"foil_gold", _poly([Vector2(-0.04, -0.06), Vector2(0.04, -0.06), Vector2(0.04, 0.06), Vector2(-0.04, 0.06)]), 0.008, 0.008, &"foil_gold", 0.003, 4)
	b.pop()


static func _sachet(b: ItemMeshBuilder) -> void:
	b.pillow(&"foil_brown", _poly([Vector2(-0.038, -0.055), Vector2(0.038, -0.055), Vector2(0.038, 0.055), Vector2(-0.038, 0.055)]), 0.009, 0.006, &"foil_brown", 0.002, 6)
	for z in [-0.056, 0.056]:
		b.push(_at(Vector3(0, 0.0015, z)))
		b.box(&"foil_brown", Vector3(0.078, 0.003, 0.008), 0.001)
		b.pop()


static func _o2(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3.ZERO, Vector3(0, 0, -90)))
	var rr := 0.05
	b.lathe(&"aluminium", PackedVector2Array([Vector2(0.0, 0.0), Vector2(rr * 0.8, 0.0), Vector2(rr, 0.012), Vector2(rr, 0.25)]), 24)
	b.lathe(&"label_o2", PackedVector2Array([Vector2(rr + 0.0005, 0.1), Vector2(rr + 0.0005, 0.24)]), 24, 40.0, Vector2.ONE, true)
	b.lathe(&"paint_green", PackedVector2Array([Vector2(rr, 0.25), Vector2(rr, 0.27), Vector2(rr * 0.85, 0.31), Vector2(rr * 0.4, 0.335),
		Vector2(0.012, 0.34)]), 24)
	b.lathe(&"brass", PackedVector2Array([Vector2(0.012, 0.34), Vector2(0.012, 0.36)]), 12)
	b.push(_at(Vector3(0, 0.372, 0)))
	b.box(&"brass", Vector3(0.03, 0.03, 0.026), 0.004)
	b.pop()
	b.push(_at(Vector3(0.015, 0.375, 0), Vector3(0, 0, -90)))
	b.cylinder(&"steel", 0.013, 0.012, 16)
	b.pop()
	b.disc(&"glass", 0.011, 16, Vector3(0.0275, 0.375, 0), Vector3.RIGHT)
	b.push(_at(Vector3(0, 0.387, 0)))
	b.cylinder(&"plastic_black", 0.012, 0.012, 14)
	b.pop()
	b.pop()


# =============================================================================================== food & drink

static func _bottle(b: ItemMeshBuilder, liquid: StringName, fill: float, cap := &"plastic_blue") -> void:
	var outer := PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.029, 0.0), Vector2(0.0335, 0.006), Vector2(0.034, 0.02),
		Vector2(0.0325, 0.03), Vector2(0.034, 0.042), Vector2(0.034, 0.15), Vector2(0.031, 0.172), Vector2(0.021, 0.196),
		Vector2(0.0148, 0.206), Vector2(0.0148, 0.214)])
	b.lathe(&"bottle_pet", outer, 24, 50.0)
	b.lathe(&"plastic_white", PackedVector2Array([Vector2(0.0345, 0.07), Vector2(0.0345, 0.125)]), 24, 50.0, Vector2.ONE, true)
	b.lathe(cap, PackedVector2Array([Vector2(0.0, 0.212), Vector2(0.0162, 0.212), Vector2(0.0165, 0.214),
		Vector2(0.0165, 0.228), Vector2(0.0155, 0.230), Vector2(0.0, 0.230)]), 20, 40.0)
	if liquid != &"" and fill > 0.0:
		var top := lerpf(0.006, 0.19, fill)
		var prof := PackedVector2Array([Vector2(0.0, 0.004), Vector2(0.031, 0.004), Vector2(0.0325, 0.012)])
		var rr := 0.0325
		if top > 0.15:
			prof.append(Vector2(rr, 0.148))
			rr = lerpf(0.0325, 0.02, clampf((top - 0.148) / 0.045, 0.0, 1.0))
		prof.append(Vector2(rr, top))
		prof.append(Vector2(0.0, top))
		b.lathe(liquid, prof, 20, 40.0)


static func _can(b: ItemMeshBuilder, label: StringName, rad := 0.0375, h := 0.11) -> void:
	b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.002), Vector2(rad - 0.003, 0.002), Vector2(rad - 0.002, 0.0),
		Vector2(rad, 0.004), Vector2(rad, h - 0.004), Vector2(rad - 0.002, h), Vector2(rad - 0.003, h - 0.002),
		Vector2(0.0, h - 0.002)]), 28, 50.0)
	b.lathe(label, PackedVector2Array([Vector2(rad + 0.0006, 0.009), Vector2(rad + 0.0006, h - 0.009)]), 28, 50.0,
		Vector2.ONE, true)
	for y in [0.004, h - 0.004]:
		b.push(_at(Vector3(0, y, 0)))
		b.torus(&"steel", rad - 0.0005, 0.0018, 28, 5)
		b.pop()


static func _berries(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	b.tube(&"bark", _wobble_path(r, Vector3(-0.05, 0.004, 0), Vector3(0.05, 0.006, 0.01), 5, 0.006), _taper(5, 0.0018, 0.001), 5)
	for i in 15:
		var p := Vector3(r.randf_range(-0.035, 0.04), 0.0055 + r.randf_range(0.0, 0.005), r.randf_range(-0.024, 0.024))
		b.push(_at(p))
		b.sphere(&"berry", r.randf_range(0.0045, 0.0062), 10, 6)
		b.pop()
	var leaf := _poly([Vector2(0.0, 0.0), Vector2(0.01, 0.007), Vector2(0.024, 0.008), Vector2(0.036, 0.0),
		Vector2(0.024, -0.008), Vector2(0.01, -0.007)])
	for i in 3:
		b.push(_at(Vector3(-0.04 + i * 0.03, 0.002, (i - 1) * 0.02), Vector3(0, r.randf_range(-160.0, 160.0), 0)))
		b.push(Transform3D(LAY_SIDE, Vector3.ZERO))
		b.extrude(&"leaf", leaf, 0.0005, &"leaf")
		b.pop()
		b.pop()


static func _mushroom(b: ItemMeshBuilder) -> void:
	b.lathe(&"mushroom_flesh", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.011, 0.0), Vector2(0.0125, 0.004),
		Vector2(0.0105, 0.03), Vector2(0.013, 0.048)]), 14)
	b.push(_at(Vector3(0.003, 0.0, 0.0), Vector3(6, 0, 8), Vector3(1.0, 1.0, 0.86)))
	b.lathe(&"mushroom_flesh", PackedVector2Array([Vector2(0.0, 0.047), Vector2(0.041, 0.049)]), 24, 40.0)
	b.lathe(&"mushroom_cap", PackedVector2Array([Vector2(0.041, 0.049), Vector2(0.045, 0.054), Vector2(0.043, 0.061),
		Vector2(0.032, 0.068), Vector2(0.016, 0.072), Vector2(0.0, 0.073)]), 24, 60.0)
	b.pop()


static func _steak(b: ItemMeshBuilder, mat: StringName, s: float) -> void:
	var o := _poly([Vector2(-0.08, -0.02), Vector2(-0.06, -0.05), Vector2(-0.01, -0.058), Vector2(0.05, -0.052),
		Vector2(0.085, -0.02), Vector2(0.08, 0.03), Vector2(0.045, 0.055), Vector2(-0.02, 0.05), Vector2(-0.07, 0.03)], s)
	b.pillow(mat, o, 0.028 * s, 0.012, mat, 0.004, 9)


static func _jerky(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for i in 4:
		var o := _poly([Vector2(-0.07, -0.012), Vector2(-0.02, -0.014), Vector2(0.04, -0.011), Vector2(0.072, -0.006),
			Vector2(0.07, 0.01), Vector2(0.02, 0.013), Vector2(-0.04, 0.012), Vector2(-0.072, 0.006)])
		b.push(_at(Vector3(r.randf_range(-0.01, 0.01), i * 0.004, r.randf_range(-0.02, 0.02)), Vector3(0, r.randf_range(-40.0, 40.0), 0)))
		b.pillow(&"jerky", o, 0.006, 0.006, &"jerky", 0.002, 20 + i)
		b.pop()


## Trout: lofted body (unit UVs for the skin texture), fins, eyes. Built upright, then laid on its side.
static func _fish(b: ItemMeshBuilder, body: StringName, fin: StringName) -> void:
	var rings: Array[PackedVector3Array] = []
	var n := 14
	for k in n + 1:
		var f := float(k) / n
		var x := lerpf(-0.15, 0.15, f)
		var env := sin(PI * clampf(f * 0.9 + 0.06, 0.0, 1.0))
		var hgt := maxf(0.027 * pow(env, 0.75), 0.003)
		var wid := maxf(0.014 * pow(env, 0.9), 0.0018)
		var cy := 0.002 * sin(f * PI)
		rings.append(b.ellipse_ring(Vector3(x, cy, 0), Vector3(0, -hgt, 0), Vector3(0, 0, wid), 14))
	b.loft(body, rings, true, true, Vector2.ONE, body, true)
	var tail := _poly([Vector2(-0.14, 0.004), Vector2(-0.19, 0.035), Vector2(-0.2, 0.03), Vector2(-0.185, 0.0),
		Vector2(-0.2, -0.03), Vector2(-0.19, -0.035), Vector2(-0.14, -0.004)])
	b.extrude(fin, tail, 0.0016, fin)
	b.extrude(fin, _poly([Vector2(-0.02, 0.022), Vector2(0.0, 0.042), Vector2(0.03, 0.036), Vector2(0.035, 0.024)]), 0.0014, fin)
	b.extrude(fin, _poly([Vector2(-0.1, -0.01), Vector2(-0.11, -0.022), Vector2(-0.085, -0.02), Vector2(-0.075, -0.01)]), 0.0014, fin)
	for sz in [-1.0, 1.0]:
		b.push(_at(Vector3(0.118, 0.006, sz * 0.009)))
		b.sphere(&"lens", 0.0045, 10, 6)
		b.pop()
		b.push(_at(Vector3(0.07, -0.01, sz * 0.012), Vector3(0, sz * 30.0, -20)))
		b.extrude(fin, _poly([Vector2(0.0, 0.0), Vector2(-0.03, -0.004), Vector2(-0.028, -0.014), Vector2(0.0, -0.006)]), 0.0012, fin)
		b.pop()
	b.transform_all(Transform3D(Basis(Vector3.RIGHT, -PI * 0.5), Vector3.ZERO))


static func _ration(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.01, 0)))
	b.box(&"aluminium", Vector3(0.095, 0.02, 0.052), 0.006, 2)
	b.pop()
	b.push(_at(Vector3(0, 0.0202, 0)))
	b.plane(&"label_ration", Vector2(0.084, 0.046))
	b.pop()
	for x in [-0.052, 0.052]:
		b.push(_at(Vector3(x, 0.01, 0)))
		b.box(&"aluminium", Vector3(0.01, 0.004, 0.054), 0.001)
		b.pop()


# =============================================================================================== tools & weapons

static func _stone_axe(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	var path := _wobble_path(r, Vector3(-0.26, 0, 0), Vector3(0.24, 0, 0), 8, 0.01)
	b.tube(&"wood", path, _taper(8, 0.017, 0.015), 9, true, true, &"wood_pale")
	b.push(_at(Vector3(0.17, 0.0, -0.035)))
	b.rock(&"granite_dark", 0.065, 77, 2, 0.05, Vector3(0.45, 0.5, 1.15), 0.0, 10, 0.2)
	b.pop()
	_lash(b, Vector3(0.12, 0, 0), Vector3.RIGHT, 0.017, 5.0, 0.03, &"rope", 0.0025)
	_lash(b, Vector3(0.215, 0, 0), Vector3.RIGHT, 0.016, 4.0, 0.022, &"rope", 0.0025)
	b.tube(&"rope", PackedVector3Array([Vector3(0.14, 0.02, 0.01), Vector3(0.17, 0.03, -0.012), Vector3(0.2, 0.02, 0.01)]), 0.0025, 5)


## Axe/hatchet designed standing (handle +Y, blade +X), then laid flat.
static func _axe(b: ItemMeshBuilder, handle_len: float, scale: float, head_mat: StringName, handle_mat: StringName, curve_amt: float) -> void:
	var s := scale
	var hl := handle_len
	var path := PackedVector3Array()
	var radii := PackedVector2Array()
	var n := 12
	for i in n + 1:
		var f := float(i) / n
		var curve := sin(f * PI) * curve_amt - f * 0.006 * s
		path.append(Vector3(curve, f * hl, 0))
		var swell := 1.0 + 0.35 * clampf(1.0 - f * 6.0, 0.0, 1.0)
		radii.append(Vector2(0.0125, 0.017) * minf(s, 1.15) * swell * lerpf(1.0, 0.9, f))
	b.tube(handle_mat, path, radii, 12, true, true, &"wood_dark", Vector3.RIGHT)
	var hy := hl - 0.035 * s
	var outline := _poly([Vector2(-0.034, 0.024), Vector2(-0.034, -0.024), Vector2(0.012, -0.026),
		Vector2(0.05, -0.036), Vector2(0.083, -0.058), Vector2(0.094, -0.03), Vector2(0.098, 0.0), Vector2(0.097, 0.03),
		Vector2(0.092, 0.05), Vector2(0.056, 0.032), Vector2(0.014, 0.026)], s)
	var thick := PackedFloat32Array([0.030, 0.030, 0.030, 0.016, 0.004, 0.0025, 0.0025, 0.0025, 0.004, 0.016, 0.030])
	for i in thick.size():
		thick[i] *= s
	b.push(_at(Vector3(0, hy, 0)))
	b.extrude(head_mat, outline, thick, head_mat)
	var edge := _poly([Vector2(0.078, -0.052), Vector2(0.083, -0.058), Vector2(0.094, -0.03), Vector2(0.098, 0.0),
		Vector2(0.097, 0.03), Vector2(0.092, 0.05), Vector2(0.084, 0.045), Vector2(0.089, 0.0), Vector2(0.085, -0.028)], s)
	var et := PackedFloat32Array()
	for i in edge.size():
		et.append(0.0048 * s)
	b.extrude(&"steel", edge, et, &"steel")
	b.pop()
	b.push(_at(Vector3(0, hy + 0.026 * s, 0)))
	b.box(&"wood_dark", Vector3(0.022, 0.003, 0.012) * s, 0.001)
	b.pop()
	b.transform_all(Transform3D(LAY, Vector3.ZERO))


static func _knife(b: ItemMeshBuilder) -> void:
	var blade := _poly([Vector2(0.0, 0.011), Vector2(0.075, 0.011), Vector2(0.097, 0.007),
		Vector2(0.112, 0.0), Vector2(0.1, -0.006), Vector2(0.075, -0.011), Vector2(0.03, -0.013), Vector2(0.0, -0.013)])
	var bt := PackedFloat32Array([0.0036, 0.0036, 0.0022, 0.0004, 0.0005, 0.0005, 0.0006, 0.0034])
	b.extrude(&"steel", blade, bt, &"steel")
	b.push(_at(Vector3(-0.056, -0.002, 0)))
	b.box(&"wood_dark", Vector3(0.11, 0.026, 0.02), 0.0075, 2)
	b.box(&"steel_dark", Vector3(0.112, 0.022, 0.0036), 0.0006, 1)
	b.pop()
	for x in [-0.085, -0.03]:
		b.push(_at(Vector3(x, -0.002, -0.0102), Vector3(90, 0, 0)))
		b.cylinder(&"brass", 0.0028, 0.0204, 10)
		b.pop()
	b.transform_all(Transform3D(LAY_SIDE, Vector3.ZERO))


static func _stone_knife(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	b.push(_at(Vector3(0.055, 0, 0)))
	b.rock(&"chert", 0.036, 31, 2, 0.05, Vector3(1.7, 0.28, 0.65), 0.0, 12, 0.3)
	b.pop()
	_branch(b, r, Vector3(-0.1, 0, 0), Vector3(0.012, 0, 0), 0.012, 0.011, &"bark", &"wood_pale", 0.004, 8)
	_lash(b, Vector3(0.004, 0, 0), Vector3.RIGHT, 0.0115, 6.0, 0.024, &"sinew", 0.0015)


static func _spear(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	_branch(b, r, Vector3(-1.0, 0, 0), Vector3(0.93, 0, 0), 0.016, 0.013, &"wood_pale", &"wood_pale", 0.02, 9)
	b.push(_at(Vector3(0.99, 0, 0)))
	b.rock(&"chert", 0.045, 91, 2, 0.04, Vector3(2.0, 0.3, 0.75), 0.0, 14, 0.3)
	b.pop()
	_lash(b, Vector3(0.92, 0, 0), Vector3.RIGHT, 0.013, 7.0, 0.05, &"sinew", 0.0016)


static func _bow(b: ItemMeshBuilder) -> void:
	var path := PackedVector3Array()
	var radii := PackedVector2Array()
	var n := 28
	for i in n + 1:
		var f := float(i) / n
		var y := lerpf(-0.72, 0.72, f)
		var t := y / 0.72
		var x := 0.14 * (1.0 - t * t)
		var tip := maxf(0.0, absf(t) - 0.85) / 0.15
		x -= tip * tip * 0.05
		path.append(Vector3(x, y, 0))
		var w := lerpf(0.017, 0.007, pow(absf(t), 1.4))
		var th := lerpf(0.011, 0.006, pow(absf(t), 1.2))
		if absf(t) < 0.12:
			w = 0.014
			th = 0.016
		radii.append(Vector2(w, th))
	b.tube(&"wood_handle", path, radii, 10, true, true, &"wood_dark", Vector3.RIGHT)
	var grip := PackedVector3Array([Vector3(0.1397, -0.07, 0), Vector3(0.14, 0.0, 0), Vector3(0.1397, 0.07, 0)])
	b.tube(&"leather_dark", grip, PackedVector2Array([Vector2(0.0158, 0.0178)]), 12, true, true, &"leather_dark", Vector3.RIGHT)
	b.tube(&"sinew", PackedVector3Array([Vector3(-0.046, 0.705, 0), Vector3(-0.046, -0.705, 0)]), 0.0014, 5)
	b.transform_all(Transform3D(LAY, Vector3.ZERO))


static func _arrow(b: ItemMeshBuilder) -> void:
	b.tube(&"wood_pale", PackedVector3Array([Vector3(-0.38, 0, 0), Vector3(0.36, 0, 0)]), 0.0042, 8, true, true, &"wood_pale")
	b.push(_at(Vector3(0.39, 0, 0)))
	b.rock(&"chert", 0.022, 5, 1, 0.03, Vector3(1.9, 0.28, 0.8), 0.0, 10, 0.25)
	b.pop()
	_lash(b, Vector3(0.36, 0, 0), Vector3.RIGHT, 0.0042, 5.0, 0.018, &"sinew", 0.0009)
	var vane := _poly([Vector2(-0.07, 0.004), Vector2(-0.064, 0.015), Vector2(-0.012, 0.012), Vector2(0.018, 0.004)])
	for k in 3:
		b.push(_at(Vector3(-0.3, 0, 0), Vector3(k * 120.0, 0, 0)))
		b.extrude(&"feather", vane, 0.0006, &"feather")
		b.pop()
	b.push(_at(Vector3(-0.385, 0, 0), Vector3(0, 0, -90)))
	b.cylinder(&"bone", 0.0046, 0.012, 8)
	b.pop()


static func _arrows(b: ItemMeshBuilder) -> void:
	for i in 3:
		b.push(_at(Vector3(0, 0.0045 + i * 0.009, (i - 1) * 0.022), Vector3(0, (i - 1) * 6.0, 0)))
		_arrow(b)
		b.pop()


static func _torch(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	_branch(b, r, Vector3(-0.34, 0, 0), Vector3(0.3, 0, 0), 0.016, 0.014, &"bark", &"wood_pale", 0.008)
	b.push(_at(Vector3(0.28, 0, 0), Vector3(0, 0, -90)))
	b.lathe(&"cloth_pitch", PackedVector2Array([Vector2(0.0, -0.075), Vector2(0.022, -0.075), Vector2(0.034, -0.05),
		Vector2(0.037, 0.0), Vector2(0.033, 0.05), Vector2(0.02, 0.07), Vector2(0.0, 0.074)]), 14, 70.0)
	b.pop()
	_ring(b, Vector3(0.225, 0, 0), Vector3.RIGHT, 0.031, 0.0025, &"rope")
	_ring(b, Vector3(0.28, 0, 0), Vector3.RIGHT, 0.0375, 0.0025, &"rope")
	_ring(b, Vector3(0.335, 0, 0), Vector3.RIGHT, 0.028, 0.0025, &"rope")


static func _flare(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3.ZERO, Vector3(0, 0, -90)))
	b.lathe(&"flare_paper", PackedVector2Array([Vector2(0.0, -0.13), Vector2(0.014, -0.13), Vector2(0.014, 0.13)]), 16)
	b.lathe(&"paper", PackedVector2Array([Vector2(0.0145, -0.06), Vector2(0.0145, 0.03)]), 16)
	b.lathe(&"plastic_black", PackedVector2Array([Vector2(0.0145, 0.13), Vector2(0.0155, 0.132), Vector2(0.0155, 0.165),
		Vector2(0.012, 0.17), Vector2(0.0, 0.17)]), 16)
	b.pop()
	b.tube(&"steel", PackedVector3Array([Vector3(-0.13, 0, 0), Vector3(-0.16, 0, 0), Vector3(-0.2, 0.0, 0.0)]), 0.0012, 5)


static func _flare_gun(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0.06, 0.03, 0), Vector3(0, 0, -90)))
	b.lathe(&"plastic_orange", PackedVector2Array([Vector2(0.0, -0.085), Vector2(0.019, -0.085), Vector2(0.019, 0.085),
		Vector2(0.016, 0.09), Vector2(0.011, 0.09), Vector2(0.011, 0.08), Vector2(0.0, 0.08)]), 18, 50.0)
	b.pop()
	b.extrude(&"plastic_orange", _poly([Vector2(-0.03, 0.05), Vector2(-0.03, 0.012), Vector2(-0.07, -0.1),
		Vector2(-0.025, -0.11), Vector2(0.0, -0.02), Vector2(0.03, 0.012), Vector2(0.03, 0.05)]), 0.03)
	b.extrude(&"plastic_black", _poly([Vector2(-0.055, -0.02), Vector2(-0.065, -0.09), Vector2(-0.034, -0.098),
		Vector2(-0.016, -0.03)]), 0.034)
	b.push(_at(Vector3(0.005, -0.012, 0), Vector3(90, 0, 0)))
	b.torus(&"plastic_orange", 0.022, 0.004, 16, 6, PI)
	b.pop()
	b.extrude(&"plastic_black", _poly([Vector2(0.0, 0.012), Vector2(0.004, 0.0), Vector2(0.002, -0.016),
		Vector2(-0.004, -0.014), Vector2(-0.004, 0.012)]), 0.008)
	b.extrude(&"plastic_black", _poly([Vector2(-0.03, 0.05), Vector2(-0.042, 0.064), Vector2(-0.036, 0.068), Vector2(-0.022, 0.05)]), 0.01)
	b.transform_all(Transform3D(LAY_SIDE, Vector3.ZERO))


static func _shells(b: ItemMeshBuilder) -> void:
	for i in 3:
		b.push(_at(Vector3(i * 0.004, 0.0112, i * 0.026 - 0.026), Vector3(0, i * 14.0 - 14.0, -90)))
		b.lathe(&"plastic_red", PackedVector2Array([Vector2(0.0, 0.014), Vector2(0.0102, 0.014), Vector2(0.0102, 0.068),
			Vector2(0.009, 0.07), Vector2(0.0, 0.07)]), 16)
		b.lathe(&"brass", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.0112, 0.0), Vector2(0.0112, 0.0015),
			Vector2(0.0104, 0.002), Vector2(0.0105, 0.016)]), 16)
		b.pop()


static func _lantern(b: ItemMeshBuilder) -> void:
	b.lathe(&"paint_red", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.07, 0.0), Vector2(0.078, 0.01), Vector2(0.08, 0.035),
		Vector2(0.07, 0.055), Vector2(0.03, 0.062), Vector2(0.028, 0.068)]), 24, 35.0)
	b.lathe(&"brass", PackedVector2Array([Vector2(0.028, 0.062), Vector2(0.03, 0.075), Vector2(0.022, 0.085), Vector2(0.0, 0.086)]), 16)
	b.lathe(&"glass", PackedVector2Array([Vector2(0.028, 0.08), Vector2(0.045, 0.1), Vector2(0.052, 0.13), Vector2(0.048, 0.165),
		Vector2(0.03, 0.19), Vector2(0.026, 0.198)]), 24, 50.0)
	b.lathe(&"paint_red", PackedVector2Array([Vector2(0.0, 0.198), Vector2(0.045, 0.198), Vector2(0.05, 0.205),
		Vector2(0.04, 0.225), Vector2(0.02, 0.235), Vector2(0.0, 0.237)]), 20, 35.0)
	for sx in [-1.0, 1.0]:
		b.tube(&"paint_red", PackedVector3Array([Vector3(sx * 0.074, 0.045, 0), Vector3(sx * 0.087, 0.1, 0),
			Vector3(sx * 0.085, 0.19, 0), Vector3(sx * 0.048, 0.215, 0)]), 0.0065, 8)
	for y in [0.105, 0.15]:
		_ring(b, Vector3(0, y, 0), Vector3.UP, 0.058, 0.0012, &"galvanized", 24)
	for k in 4:
		var a := TAU * k / 4.0 + PI * 0.25
		b.tube(&"galvanized", PackedVector3Array([Vector3(cos(a) * 0.045, 0.09, sin(a) * 0.045),
			Vector3(cos(a) * 0.058, 0.13, sin(a) * 0.058), Vector3(cos(a) * 0.045, 0.188, sin(a) * 0.045)]), 0.0012, 4)
	var bail := PackedVector3Array()
	for i in 13:
		var a := PI * i / 12.0
		bail.append(Vector3(-cos(a) * 0.05, 0.215 + sin(a) * 0.11, 0))
	b.tube(&"galvanized", bail, 0.0018, 6)


static func _ice_axe(b: ItemMeshBuilder) -> void:
	var path := PackedVector3Array()
	for i in 9:
		var f := i / 8.0
		path.append(Vector3(-0.025 * pow(1.0 - f, 3.0), f * 0.6, 0))
	b.tube(&"anodized_blue", path, PackedVector2Array([Vector2(0.011, 0.018)]), 12, true, true, &"steel", Vector3.RIGHT)
	b.tube(&"rubber", path.slice(0, 4), PackedVector2Array([Vector2(0.0122, 0.0195)]), 12, true, true, &"rubber", Vector3.RIGHT)
	b.push(_at(Vector3(path[0].x, 0.002, 0), Vector3(180, 0, 0)))
	b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.0125, 0.0), Vector2(0.009, 0.03), Vector2(0.0, 0.058)]), 10)
	b.pop()
	var head := _poly([Vector2(-0.165, 0.555), Vector2(-0.14, 0.572), Vector2(-0.09, 0.588), Vector2(-0.03, 0.598),
		Vector2(0.02, 0.598), Vector2(0.02, 0.64), Vector2(-0.03, 0.635), Vector2(-0.1, 0.618), Vector2(-0.16, 0.585)])
	var th := PackedFloat32Array([0.004, 0.006, 0.008, 0.009, 0.009, 0.009, 0.009, 0.008, 0.005])
	b.extrude(&"steel", head, th, &"steel")
	for k in 5:
		var x := -0.14 + k * 0.022
		b.extrude(&"steel", _poly([Vector2(x, 0.573 + k * 0.004), Vector2(x + 0.01, 0.576 + k * 0.004), Vector2(x + 0.004, 0.566 + k * 0.004)]), 0.006)
	b.push(_at(Vector3(0.065, 0.625, 0), Vector3(0, 0, -8)))
	b.box(&"steel", Vector3(0.09, 0.004, 0.04), 0.0012)
	b.pop()
	b.push(_at(Vector3(0.0, 0.612, 0)))
	b.box(&"steel", Vector3(0.042, 0.05, 0.022), 0.004)
	b.pop()
	b.transform_all(Transform3D(LAY, Vector3.ZERO))


static func _canteen(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3.ZERO, Vector3.ZERO, Vector3(1.0, 1.0, 0.5)))
	b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.05, 0.0), Vector2(0.062, 0.02), Vector2(0.066, 0.08),
		Vector2(0.06, 0.13), Vector2(0.04, 0.155), Vector2(0.016, 0.165)]), 24, 50.0)
	b.pop()
	b.lathe(&"steel", PackedVector2Array([Vector2(0.016, 0.165), Vector2(0.016, 0.18)]), 16)
	b.lathe(&"plastic_black", PackedVector2Array([Vector2(0.0, 0.176), Vector2(0.0195, 0.176), Vector2(0.0195, 0.196),
		Vector2(0.018, 0.198), Vector2(0.0, 0.198)]), 18)
	b.push(_at(Vector3(0.03, 0.186, 0), Vector3(90, 0, 0)))
	b.torus(&"steel", 0.012, 0.0012, 14, 4)
	b.pop()


static func _pot(b: ItemMeshBuilder) -> void:
	var rad := 0.055
	var h := 0.12
	b.lathe(&"aluminium_sooty", PackedVector2Array([Vector2(0.0, 0.0), Vector2(rad - 0.004, 0.0), Vector2(rad, 0.004), Vector2(rad, 0.065)]), 24, 50.0)
	b.lathe(&"aluminium", PackedVector2Array([Vector2(rad, 0.065), Vector2(rad, h)]), 24)
	b.lathe(&"aluminium", PackedVector2Array([Vector2(rad - 0.0012, h), Vector2(rad - 0.0012, 0.003), Vector2(0.0, 0.003)]), 24)
	b.push(_at(Vector3(0, h, 0)))
	b.torus(&"aluminium", rad, 0.0018, 28, 6)
	b.pop()
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * (rad + 0.004), h - 0.015, 0), Vector3(90, 0, 0)))
		b.torus(&"galvanized", 0.004, 0.0013, 8, 4)
		b.pop()
	var bail := PackedVector3Array()
	for i in 13:
		var a := PI * i / 12.0
		bail.append(Vector3(-cos(a) * (rad + 0.004), h - 0.015 + sin(a) * 0.1, 0))
	b.tube(&"galvanized", bail, 0.0017, 6)


static func _binoculars(b: ItemMeshBuilder) -> void:
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.034, 0.029, 0), Vector3(90, 0, 0)))
		b.lathe(&"rubber_olive", PackedVector2Array([Vector2(0.012, -0.075), Vector2(0.017, -0.07), Vector2(0.018, -0.04),
			Vector2(0.026, -0.01), Vector2(0.028, 0.06), Vector2(0.029, 0.072)]), 20, 35.0)
		b.lathe(&"rubber", PackedVector2Array([Vector2(0.029, 0.072), Vector2(0.025, 0.075), Vector2(0.022, 0.068)]), 20)
		b.disc(&"lens", 0.022, 20, Vector3(0, 0.068, 0), Vector3.UP, false)
		b.lathe(&"rubber", PackedVector2Array([Vector2(0.0, -0.082), Vector2(0.0145, -0.082), Vector2(0.015, -0.075)]), 16)
		b.disc(&"lens", 0.008, 12, Vector3(0, -0.0822, 0), Vector3.DOWN, false)
		b.pop()
	b.push(_at(Vector3(-0.02, 0.045, -0.035), Vector3(0, 0, -90)))
	b.cylinder(&"plastic_black", 0.009, 0.04, 14)
	b.pop()
	b.push(_at(Vector3(-0.012, 0.045, 0.02), Vector3(0, 0, -90)))
	b.cylinder(&"plastic_black", 0.006, 0.024, 12)
	b.pop()


static func _scanner(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.025, 0)))
	b.box(&"plastic_yellow", Vector3(0.1, 0.05, 0.2), 0.012, 2)
	b.pop()
	b.push(_at(Vector3(0, 0.0505, 0.02)))
	b.box(&"plastic_black", Vector3(0.078, 0.004, 0.1), 0.003)
	b.pop()
	b.push(_at(Vector3(0, 0.0528, 0.02)))
	b.plane(&"print_screen", Vector2(0.068, 0.09))
	b.pop()
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			b.push(_at(Vector3(sx * 0.048, 0.025, sz * 0.096)))
			b.box(&"rubber", Vector3(0.014, 0.054, 0.018), 0.004)
			b.pop()
	b.push(_at(Vector3(0, 0.028, -0.1), Vector3(-90, 0, 0)))
	b.lathe(&"steel_dark", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.022, 0.0), Vector2(0.022, 0.02),
		Vector2(0.018, 0.026), Vector2(0.0, 0.026)]), 18)
	b.disc(&"lens", 0.015, 18, Vector3(0, 0.0262, 0), Vector3.UP, false)
	b.pop()
	for k in 3:
		b.push(_at(Vector3(-0.022 + k * 0.022, 0.05, 0.085)))
		b.cylinder(&"rubber", 0.0055, 0.004, 10)
		b.pop()
	b.push(_at(Vector3(0, -0.018, 0.06), Vector3(20, 0, 0)))
	b.box(&"rubber", Vector3(0.04, 0.07, 0.035), 0.012)
	b.pop()


static func _map(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.003, 0)))
	b.box(&"paper", Vector3(0.13, 0.006, 0.21), 0.0015)
	b.pop()
	b.push(_at(Vector3(0, 0.00605, 0)))
	b.plane(&"print_map", Vector2(0.128, 0.208))
	b.pop()


static func _compass(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.002, 0.018)))
	b.box(&"acrylic", Vector3(0.056, 0.004, 0.1), 0.004)
	b.pop()
	b.lathe(&"plastic_black", PackedVector2Array([Vector2(0.0205, 0.004), Vector2(0.025, 0.004), Vector2(0.026, 0.012),
		Vector2(0.023, 0.0135), Vector2(0.0205, 0.013)]), 32, 40.0)
	b.disc(&"paper", 0.0205, 24, Vector3(0, 0.0045, 0), Vector3.UP)
	b.lathe(&"acrylic", PackedVector2Array([Vector2(0.0205, 0.0125), Vector2(0.0, 0.0132)]), 24)
	b.push(_at(Vector3(0, 0.007, 0), Vector3(-90, 0, 0)))
	b.extrude(&"paint_red", _poly([Vector2(0.0, 0.017), Vector2(0.003, 0.0), Vector2(-0.003, 0.0)]), 0.001)
	b.extrude(&"paint_white", _poly([Vector2(0.0, -0.017), Vector2(-0.003, 0.0), Vector2(0.003, 0.0)]), 0.001)
	b.pop()
	b.push(_at(Vector3(0, 0.0042, 0.05)))
	b.box(&"paint_red", Vector3(0.004, 0.0008, 0.028), 0.0003)
	b.pop()
	b.push(_at(Vector3(0, 0.002, 0.075)))
	b.torus(&"cord_orange", 0.012, 0.0016, 14, 5)
	b.pop()


static func _hammer(b: ItemMeshBuilder) -> void:
	b.tube(&"plastic_yellow", PackedVector3Array([Vector3(0, 0, 0), Vector3(0, 0.33, 0)]), PackedVector2Array([Vector2(0.012, 0.016)]), 12, true, true, &"plastic_yellow", Vector3.RIGHT)
	b.tube(&"rubber", PackedVector3Array([Vector3(0, -0.003, 0), Vector3(0, 0.13, 0)]), PackedVector2Array([Vector2(0.0142, 0.0192), Vector2(0.0138, 0.0185)]), 12, true, true, &"rubber", Vector3.RIGHT)
	b.push(_at(Vector3(0, 0.34, 0)))
	b.box(&"steel_dark", Vector3(0.05, 0.028, 0.024), 0.004)
	b.pop()
	b.push(_at(Vector3(-0.024, 0.34, 0), Vector3(0, 0, 90)))
	b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.015, 0.0), Vector2(0.015, 0.03), Vector2(0.014, 0.035), Vector2(0.0, 0.036)]), 18)
	b.pop()
	b.extrude(&"steel_dark", _poly([Vector2(0.02, 0.353), Vector2(0.06, 0.348), Vector2(0.092, 0.33), Vector2(0.105, 0.305),
		Vector2(0.096, 0.306), Vector2(0.075, 0.325), Vector2(0.04, 0.33), Vector2(0.02, 0.328)]), 0.018)
	b.transform_all(Transform3D(LAY, Vector3.ZERO))


static func _lighter(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.04, 0)))
	b.box(&"plastic_red", Vector3(0.025, 0.08, 0.012), 0.005, 2)
	b.pop()
	b.push(_at(Vector3(0, 0.087, 0)))
	b.box(&"steel", Vector3(0.023, 0.014, 0.0118), 0.002)
	b.pop()
	b.push(_at(Vector3(0.004, 0.096, -0.0035), Vector3(90, 0, 0)))
	b.cylinder(&"steel_dark", 0.0042, 0.007, 12)
	b.pop()
	b.push(_at(Vector3(-0.006, 0.092, 0)))
	b.box(&"plastic_black", Vector3(0.008, 0.006, 0.009), 0.001)
	b.pop()


static func _matches(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.008, 0)))
	b.box(&"cardboard", Vector3(0.058, 0.016, 0.038), 0.001)
	b.pop()
	b.push(_at(Vector3(0, 0.0161, 0)))
	b.plane(&"label_matches", Vector2(0.056, 0.036))
	b.pop()
	for sz in [-1.0, 1.0]:
		b.push(_at(Vector3(0, 0.008, sz * 0.0191), Vector3(sz * 90.0, 0, 0)))
		b.plane(&"striker", Vector2(0.05, 0.012))
		b.pop()
	for i in 3:
		b.push(_at(Vector3(0.05 + i * 0.004, 0.0015, -0.01 + i * 0.01), Vector3(0, 10.0 + i * 12.0, 0)))
		b.box(&"wood_pale", Vector3(0.05, 0.0022, 0.0022), 0.0003)
		b.push(_at(Vector3(0.026, 0, 0)))
		b.rock(&"paint_red", 0.0027, 3, 1, 0.1, Vector3(1.4, 1.0, 1.0))
		b.pop()
		b.pop()


static func _ferro(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0.02, 0, 0), Vector3(0, 0, -90)))
	b.cylinder(&"steel_black", 0.005, 0.08, 12)
	b.pop()
	b.push(_at(Vector3(-0.025, 0, 0), Vector3(0, 0, -90)))
	b.lathe(&"plastic_orange", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.009, 0.0), Vector2(0.01, 0.004), Vector2(0.01, 0.042),
		Vector2(0.007, 0.045), Vector2(0.005, 0.046)]), 14)
	b.pop()
	b.push(_at(Vector3(0.03, -0.004, 0.03), Vector3(0, 25, 0)))
	b.box(&"steel", Vector3(0.045, 0.002, 0.014), 0.0005)
	b.pop()
	b.tube(&"cord_orange", PackedVector3Array([Vector3(-0.027, 0, 0), Vector3(-0.045, 0, 0.01), Vector3(-0.05, -0.001, 0.03),
		Vector3(0.0, -0.003, 0.035), Vector3(0.012, -0.004, 0.03)]), 0.0016, 5)


static func _bow_drill(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	b.push(_at(Vector3(0, 0.009, 0)))
	b.box(&"wood", Vector3(0.3, 0.018, 0.05), 0.003)
	b.pop()
	for x in [-0.08, 0.02]:
		b.disc(&"charred", 0.008, 12, Vector3(x, 0.0182, 0.012), Vector3.UP, false)
	_branch(b, r, Vector3(-0.1, 0.03, 0.07), Vector3(0.12, 0.03, 0.05), 0.009, 0.008, &"wood_pale", &"charred", 0.002, 8)
	var arc := PackedVector3Array()
	for i in 9:
		var f := i / 8.0
		arc.append(Vector3(lerpf(-0.25, 0.25, f), 0.012, -0.08 - sin(f * PI) * 0.05))
	b.tube(&"bark", arc, _taper(8, 0.011, 0.008), 7, true, true, &"wood_pale")
	b.tube(&"rope", PackedVector3Array([arc[0], Vector3(0, 0.01, -0.085), arc[8]]), 0.0018, 5)


static func _needles(b: ItemMeshBuilder) -> void:
	for i in 2:
		b.push(_at(Vector3(0, 0.0023, i * 0.012), Vector3(0, i * 8.0, -90)))
		b.lathe(&"bone", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.0022, 0.004), Vector2(0.002, 0.06),
			Vector2(0.0009, 0.078), Vector2(0.0, 0.082)]), 8)
		b.pop()


static func _crampons(b: ItemMeshBuilder) -> void:
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.07, 0, 0), Vector3(0, sx * 4.0, 0)))
		var front := PackedVector3Array([Vector3(-0.04, 0.03, 0.02), Vector3(-0.045, 0.03, 0.09), Vector3(-0.03, 0.03, 0.13),
			Vector3(0.0, 0.03, 0.14), Vector3(0.03, 0.03, 0.13), Vector3(0.045, 0.03, 0.09), Vector3(0.04, 0.03, 0.02)])
		b.tube(&"steel", front, PackedVector2Array([Vector2(0.0022, 0.009)]), 4, true, true, &"steel", Vector3.UP)
		var heel := PackedVector3Array([Vector3(-0.035, 0.03, -0.1), Vector3(-0.04, 0.03, -0.16), Vector3(0.0, 0.03, -0.18),
			Vector3(0.04, 0.03, -0.16), Vector3(0.035, 0.03, -0.1)])
		b.tube(&"steel", heel, PackedVector2Array([Vector2(0.0022, 0.009)]), 4, true, true, &"steel", Vector3.UP)
		b.tube(&"steel", PackedVector3Array([Vector3(0, 0.036, 0.03), Vector3(0, 0.036, -0.105)]), PackedVector2Array([Vector2(0.008, 0.0015)]), 4, true, true, &"steel", Vector3.UP)
		var pts: Array[Vector3] = [front[0], front[1], front[2], front[4], front[5], front[6], heel[0], heel[1], heel[3], heel[4]]
		for p in pts:
			b.push(_at(p + Vector3(0, -0.008, 0), Vector3(180, 0, 0)))
			b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.004, 0.0), Vector2(0.0, 0.03)]), 6)
			b.pop()
		for fx in [-0.012, 0.012]:
			b.push(_at(Vector3(fx, 0.03, 0.138), Vector3(90, 0, 0)))
			b.lathe(&"steel", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.004, 0.0), Vector2(0.0, 0.035)]), 6)
			b.pop()
		var strap := PackedVector3Array()
		for i in 9:
			var a := PI * i / 8.0
			strap.append(Vector3(-cos(a) * 0.05, 0.03 + sin(a) * 0.05, 0.05))
		b.tube(&"strap_red", strap, PackedVector2Array([Vector2(0.0015, 0.011)]), 4, false, false, &"", Vector3.FORWARD)
		b.pop()


static func _o2_mask(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.055, 0), Vector3(90, 0, 0), Vector3(1.0, 1.0, 1.25)))
	b.lathe(&"silicone", PackedVector2Array([Vector2(0.042, 0.0), Vector2(0.04, 0.02), Vector2(0.03, 0.045), Vector2(0.016, 0.06), Vector2(0.0, 0.065)]), 20, 50.0)
	b.pop()
	b.push(_at(Vector3(0, 0.05, 0.062), Vector3(90, 0, 0)))
	b.cylinder(&"plastic_black", 0.014, 0.018, 16)
	b.pop()
	b.push(_at(Vector3(0, 0.04, 0.1), Vector3.ZERO, Vector3(1.0, 1.25, 0.8)))
	b.sphere(&"bag_green", 0.034, 16, 10)
	b.pop()
	b.tube(&"plastic_green", PackedVector3Array([Vector3(0.012, 0.045, 0.078), Vector3(0.04, 0.03, 0.09), Vector3(0.07, 0.012, 0.06),
		Vector3(0.09, 0.008, 0.0), Vector3(0.1, 0.008, -0.06)]), 0.0045, 8)
	var strap := PackedVector3Array()
	for i in 11:
		var a := lerpf(0.2, PI - 0.2, i / 10.0)
		strap.append(Vector3(cos(a) * 0.075, 0.055, -sin(a) * 0.08))
	b.tube(&"strap_black", strap, PackedVector2Array([Vector2(0.0015, 0.009)]), 4, true, true, &"", Vector3.UP)


static func _goggles(b: ItemMeshBuilder) -> void:
	var a0 := PI * 0.5 - 0.72
	var a1 := PI * 0.5 + 0.72
	b.push(_at(Vector3(0, 0.045, -0.08)))
	b.lathe(&"mirror_amber", PackedVector2Array([Vector2(0.11, -0.033), Vector2(0.11, 0.033)]), 24, 40.0, Vector2.ONE, false, a0, a1)
	var frame := PackedVector3Array()
	var steps := 10
	for i in steps + 1:
		var a := lerpf(a0, a1, i / float(steps))
		frame.append(Vector3(cos(a) * 0.112, 0.037, sin(a) * 0.112))
	for i in range(1, 5):
		frame.append(Vector3(cos(a1) * 0.112, lerpf(0.037, -0.037, i / 4.0), sin(a1) * 0.112))
	for i in range(1, steps + 1):
		var a := lerpf(a1, a0, i / float(steps))
		var nose := 0.012 * exp(-pow((a - PI * 0.5) * 6.0, 2.0))
		frame.append(Vector3(cos(a) * 0.112, -0.037 + nose, sin(a) * 0.112))
	for i in range(1, 4):
		frame.append(Vector3(cos(a0) * 0.112, lerpf(-0.037, 0.037, i / 4.0), sin(a0) * 0.112))
	b.tube(&"plastic_black", frame, PackedVector2Array([Vector2(0.006, 0.006)]), 6, false, false, &"", Vector3.ZERO, Vector2.ONE, true)
	var strap := PackedVector3Array()
	for i in 13:
		var a := lerpf(a1, a0 + TAU, i / 12.0)
		strap.append(Vector3(cos(a) * 0.1, 0.0, sin(a) * 0.1))
	b.tube(&"strap_black", strap, PackedVector2Array([Vector2(0.0015, 0.013)]), 4, true, true, &"", Vector3.UP)
	b.pop()


static func _slit_goggles(b: ItemMeshBuilder) -> void:
	var a0 := PI * 0.5 - 0.7
	var a1 := PI * 0.5 + 0.7
	b.push(_at(Vector3(0, 0.025, -0.1)))
	b.lathe(&"bone", PackedVector2Array([Vector2(0.1, -0.02), Vector2(0.1, 0.02)]), 20, 40.0, Vector2.ONE, false, a0, a1)
	b.lathe(&"bone", PackedVector2Array([Vector2(0.094, 0.02), Vector2(0.094, -0.02)]), 20, 40.0, Vector2.ONE, false, a0, a1)
	for sa in [-0.3, 0.3]:
		var a: float = PI * 0.5 + float(sa)
		b.push(_at(Vector3(cos(a) * 0.1005, 0.002, sin(a) * 0.1005), Vector3(0, rad_to_deg(-a) + 90.0, 0)))
		b.box(&"plastic_black", Vector3(0.038, 0.0035, 0.0015), 0.0006)
		b.pop()
	var cord := PackedVector3Array()
	for i in 13:
		var a := lerpf(a1, a0 + TAU, i / 12.0)
		cord.append(Vector3(cos(a) * 0.097, 0.0, sin(a) * 0.097))
	b.tube(&"sinew", cord, 0.0015, 5)
	b.pop()


# =============================================================================================== medical

static func _bandage(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.028, -0.025), Vector3(90, 0, 0)))
	_annulus(b, &"weave_white", &"weave_white", &"cardboard", 0.011, 0.028, 0.05)
	b.pop()
	b.pillow(&"weave_white", _poly([Vector2(0.0, -0.024), Vector2(0.11, -0.024), Vector2(0.12, 0.024), Vector2(0.0, 0.024)]), 0.0025, 0.01, &"weave_white", 0.001, 3)


static func _first_aid(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.035, 0)))
	b.box(&"plastic_red", Vector3(0.22, 0.07, 0.15), 0.012, 2)
	b.pop()
	b.push(_at(Vector3(0, 0.046, 0)))
	b.box(&"plastic_black", Vector3(0.2215, 0.0015, 0.1515), 0.0005)
	b.pop()
	b.push(_at(Vector3(0, 0.0703, 0)))
	b.plane(&"label_firstaid", Vector2(0.11, 0.11))
	b.pop()
	b.tube(&"plastic_black", PackedVector3Array([Vector3(-0.05, 0.05, 0.075), Vector3(-0.045, 0.05, 0.09), Vector3(0.045, 0.05, 0.09),
		Vector3(0.05, 0.05, 0.075)]), 0.005, 8)
	for x in [-0.075, 0.075]:
		b.push(_at(Vector3(x, 0.046, 0.0765)))
		b.box(&"plastic_white", Vector3(0.022, 0.02, 0.006), 0.002)
		b.pop()


static func _pills(b: ItemMeshBuilder) -> void:
	b.lathe(&"plastic_amber", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.017, 0.0), Vector2(0.018, 0.003), Vector2(0.018, 0.058)]), 20)
	b.lathe(&"label_pills", PackedVector2Array([Vector2(0.0185, 0.008), Vector2(0.0185, 0.052)]), 24, 40.0, Vector2.ONE, true)
	b.lathe(&"plastic_white", PackedVector2Array([Vector2(0.0182, 0.056), Vector2(0.0195, 0.057), Vector2(0.0195, 0.075),
		Vector2(0.017, 0.077), Vector2(0.0, 0.077)]), 20, 40.0)
	for k in 6:
		b.push(_at(Vector3(0, 0.059 + k * 0.0028, 0)))
		b.torus(&"plastic_white", 0.0196, 0.0006, 20, 4)
		b.pop()


static func _splint(b: ItemMeshBuilder) -> void:
	for sz in [-1.0, 1.0]:
		b.push(_at(Vector3(0, 0.008, sz * 0.022)))
		b.box(&"wood_pale", Vector3(0.36, 0.016, 0.02), 0.004)
		b.pop()
	for x in [-0.12, 0.0, 0.12]:
		var path := PackedVector3Array()
		for i in 16:
			var a := TAU * i / 16.0
			path.append(Vector3(x, 0.008 + sin(a) * 0.012, cos(a) * 0.034))
		b.tube(&"weave_white", path, PackedVector2Array([Vector2(0.002, 0.012)]), 4, false, false, &"", Vector3.RIGHT, Vector2.ONE, true)


static func _poultice(b: ItemMeshBuilder) -> void:
	b.lathe(&"weave_khaki", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.03, 0.0), Vector2(0.042, 0.015), Vector2(0.04, 0.035),
		Vector2(0.022, 0.05), Vector2(0.012, 0.056), Vector2(0.018, 0.066), Vector2(0.024, 0.075)]), 16, 60.0)
	_ring(b, Vector3(0, 0.056, 0), Vector3.UP, 0.0125, 0.0022, &"rope")
	for i in 9:
		var a := TAU * i / 9.0
		var path := PackedVector3Array()
		for k in 6:
			var f := k / 5.0
			path.append(Vector3(cos(a) * (0.006 + f * 0.02), 0.06 + f * 0.03 + sin(f * 7.0 + i) * 0.003, sin(a) * (0.006 + f * 0.02)))
		b.tube(&"usnea", path, _taper(5, 0.0016, 0.0007), 4, false, false)


# =============================================================================================== clothing

static func _toque(b: ItemMeshBuilder) -> void:
	b.lathe(&"knit_red", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.088, 0.0), Vector2(0.092, 0.004), Vector2(0.094, 0.05),
		Vector2(0.09, 0.1), Vector2(0.075, 0.14), Vector2(0.045, 0.17), Vector2(0.0, 0.18)]), 28, 60.0)
	b.lathe(&"knit_charcoal", PackedVector2Array([Vector2(0.093, 0.0), Vector2(0.099, 0.005), Vector2(0.1, 0.05),
		Vector2(0.096, 0.056), Vector2(0.093, 0.056)]), 28, 60.0)
	b.push(_at(Vector3(0, 0.19, 0)))
	b.rock(&"pompom_red", 0.034, 9, 2, 0.35, Vector3.ONE, 0.0, 0, 0.18, 5.0)
	b.pop()


static func _fur_hat(b: ItemMeshBuilder) -> void:
	b.lathe(&"suede", PackedVector2Array([Vector2(0.0, 0.03), Vector2(0.085, 0.03), Vector2(0.09, 0.08), Vector2(0.075, 0.13),
		Vector2(0.04, 0.155), Vector2(0.0, 0.16)]), 24, 60.0)
	b.lathe(&"fur", PackedVector2Array([Vector2(0.085, 0.03), Vector2(0.105, 0.04), Vector2(0.108, 0.07), Vector2(0.095, 0.086),
		Vector2(0.086, 0.08)]), 24, 50.0)
	var ear := _poly([Vector2(-0.04, 0.0), Vector2(0.04, 0.0), Vector2(0.035, 0.08), Vector2(0.0, 0.11), Vector2(-0.035, 0.08)])
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.1, 0.045, 0), Vector3(0, 0, sx * -78.0)))
		b.push(_at(Vector3.ZERO, Vector3(0, 90, 0)))
		b.pillow(&"fur", ear, 0.018, 0.01, &"suede", 0.003, 2)
		b.pop()
		b.pop()
	b.push(_at(Vector3(0, 0.07, 0.1), Vector3(-70, 0, 0)))
	b.pillow(&"fur", _poly([Vector2(-0.07, -0.03), Vector2(0.07, -0.03), Vector2(0.06, 0.02), Vector2(-0.06, 0.02)]), 0.016, 0.01, &"suede", 0.003, 3)
	b.pop()


## Torso + sleeves outline for tops laid flat (collar towards -Z, hem towards +Z).
static func _top_outline(hem := 0.32, sleeve_drop := 0.12, width := 0.26) -> PackedVector2Array:
	return _poly([Vector2(-0.07, -0.34), Vector2(-0.19, -0.31), Vector2(-0.36, -0.2), Vector2(-0.55, sleeve_drop),
		Vector2(-0.46, sleeve_drop + 0.07), Vector2(-width - 0.01, -0.03), Vector2(-width, hem), Vector2(width, hem),
		Vector2(width + 0.01, -0.03), Vector2(0.46, sleeve_drop + 0.07), Vector2(0.55, sleeve_drop), Vector2(0.36, -0.2),
		Vector2(0.19, -0.31), Vector2(0.07, -0.34), Vector2(0.0, -0.3)])


static func _zip(b: ItemMeshBuilder, y: float, z0: float, z1: float) -> void:
	b.push(_at(Vector3(0, y, (z0 + z1) * 0.5)))
	b.box(&"plastic_black", Vector3(0.011, 0.004, z1 - z0), 0.001)
	b.pop()
	b.push(_at(Vector3(0.006, y + 0.003, z0 + 0.03)))
	b.box(&"steel", Vector3(0.008, 0.003, 0.022), 0.001)
	b.pop()


static func _jacket(b: ItemMeshBuilder, mat: StringName, thick: float, wrinkle: float) -> void:
	var o := _top_outline(0.34)
	b.pillow(mat, o, thick, 0.028, mat, wrinkle, 7)
	var collar := _poly([Vector2(-0.1, -0.36), Vector2(0.1, -0.36), Vector2(0.09, -0.3), Vector2(0.0, -0.27), Vector2(-0.09, -0.3)])
	b.push(_at(Vector3(0, thick * 0.6, 0)))
	b.pillow(mat, collar, thick * 0.6, 0.02, mat, 0.002, 8)
	b.pop()
	_zip(b, thick + 0.002, -0.3, 0.34)
	b.push(_at(Vector3(0.12, thick + 0.001, -0.14)))
	b.box(&"plastic_black", Vector3(0.1, 0.003, 0.008), 0.001)
	b.pop()


static func _parka(b: ItemMeshBuilder) -> void:
	var o := _top_outline(0.42, 0.16, 0.27)
	b.pillow(&"weave_red", o, 0.075, 0.028, &"weave_red", 0.016, 7)
	var hood := _poly([Vector2(-0.13, -0.33), Vector2(-0.17, -0.44), Vector2(-0.1, -0.55), Vector2(0.0, -0.58),
		Vector2(0.1, -0.55), Vector2(0.17, -0.44), Vector2(0.13, -0.33)])
	b.pillow(&"weave_red", hood, 0.055, 0.025, &"weave_red", 0.008, 8)
	var ruff := PackedVector3Array()
	for i in 17:
		var a := lerpf(-2.5, 2.5, i / 16.0) - PI * 0.5
		ruff.append(Vector3(cos(a) * 0.13, 0.062, -0.45 + sin(a) * 0.11))
	b.tube(&"fur_grey", ruff, 0.03, 9, true, true, &"fur_grey")
	_zip(b, 0.077, -0.33, 0.42)
	for x in [-0.16, 0.16]:
		b.push(_at(Vector3(x, 0.07, 0.24)))
		b.pillow(&"weave_red", _poly([Vector2(-0.075, -0.06), Vector2(0.075, -0.06), Vector2(0.075, 0.06), Vector2(-0.075, 0.06)]), 0.02, 0.02, &"weave_red", 0.003, 3)
		b.pop()
	for z in [-0.1, 0.05, 0.2]:
		b.push(_at(Vector3(0, 0.04, z)))
		b.box(&"weave_red", Vector3(0.52, 0.066, 0.004), 0.002)
		b.pop()


static func _sweater(b: ItemMeshBuilder) -> void:
	var o := _top_outline(0.3, 0.1, 0.25)
	b.pillow(&"knit_cream", o, 0.045, 0.028, &"knit_cream", 0.008, 4)
	b.push(_at(Vector3(0, 0.043, -0.31)))
	b.torus(&"knit_cream", 0.075, 0.012, 24, 6)
	b.pop()
	b.push(_at(Vector3(0, 0.02, 0.29)))
	b.box(&"knit_cream", Vector3(0.52, 0.045, 0.05), 0.018)
	b.pop()
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.51, 0.02, 0.15), Vector3(0, sx * 55.0, 0)))
		b.box(&"knit_cream", Vector3(0.12, 0.04, 0.045), 0.016)
		b.pop()


static func _hide_coat(b: ItemMeshBuilder) -> void:
	var o := _top_outline(0.58, 0.16, 0.3)
	b.pillow(&"suede", o, 0.05, 0.03, &"fur", 0.012, 5)
	var hem := PackedVector3Array([Vector3(-0.3, 0.02, 0.575), Vector3(0.0, 0.025, 0.585), Vector3(0.3, 0.02, 0.575)])
	b.tube(&"fur", hem, 0.028, 8, true, true, &"fur")
	for sx in [-1.0, 1.0]:
		var cuff := PackedVector3Array([Vector3(sx * 0.46, 0.02, 0.24), Vector3(sx * 0.515, 0.02, 0.2), Vector3(sx * 0.56, 0.02, 0.17)])
		b.tube(&"fur", cuff, 0.026, 8, true, true, &"fur")
	var collar := PackedVector3Array()
	for i in 9:
		var a := lerpf(-2.4, 2.4, i / 8.0) - PI * 0.5
		collar.append(Vector3(cos(a) * 0.11, 0.045, -0.3 + sin(a) * 0.07))
	b.tube(&"fur", collar, 0.03, 8, true, true, &"fur")
	for z in [-0.18, -0.04, 0.1]:
		b.push(_at(Vector3(0.03, 0.055, z), Vector3(0, 0, 90)))
		b.cylinder(&"wood_dark", 0.006, 0.05, 8)
		b.pop()


static func _capote(b: ItemMeshBuilder) -> void:
	var o := _top_outline(0.6, 0.16, 0.3)
	var shifted := PackedVector2Array()
	for q in o:
		shifted.append(q + Vector2(0.0, 0.1))
	b.push(_at(Vector3(0, 0, -0.1)))
	b.pillow(&"blanket", shifted, 0.05, 0.03, &"blanket", 0.012, 6)
	b.pop()
	var hood := _poly([Vector2(-0.13, -0.33), Vector2(-0.12, -0.46), Vector2(0.0, -0.66), Vector2(0.12, -0.46), Vector2(0.13, -0.33)])
	b.pillow(&"blanket", hood, 0.04, 0.025, &"blanket", 0.006, 7)
	b.tube(&"rope_red", PackedVector3Array([Vector3(-0.3, 0.05, 0.12), Vector3(0.0, 0.058, 0.13), Vector3(0.3, 0.05, 0.12)]), 0.012, 8)
	b.tube(&"rope_red", PackedVector3Array([Vector3(0.05, 0.05, 0.13), Vector3(0.08, 0.03, 0.28), Vector3(0.06, 0.02, 0.4)]), 0.01, 8)


static func _down_suit(b: ItemMeshBuilder) -> void:
	var o := _poly([Vector2(-0.07, -0.42), Vector2(-0.19, -0.39), Vector2(-0.36, -0.28), Vector2(-0.56, 0.02),
		Vector2(-0.47, 0.08), Vector2(-0.26, -0.12), Vector2(-0.24, 0.12), Vector2(-0.27, 0.62), Vector2(-0.1, 0.62),
		Vector2(-0.02, 0.2), Vector2(0.02, 0.2), Vector2(0.1, 0.62), Vector2(0.27, 0.62), Vector2(0.24, 0.12),
		Vector2(0.26, -0.12), Vector2(0.47, 0.08), Vector2(0.56, 0.02), Vector2(0.36, -0.28), Vector2(0.19, -0.39),
		Vector2(0.07, -0.42), Vector2(0.0, -0.38)])
	b.pillow(&"weave_orange", o, 0.085, 0.028, &"weave_orange", 0.018, 9)
	for z in [-0.22, -0.08, 0.06]:
		b.push(_at(Vector3(0, 0.045, z)))
		b.box(&"weave_orange", Vector3(0.5, 0.075, 0.004), 0.002)
		b.pop()
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.16, 0.07, 0.42)))
		b.pillow(&"weave_charcoal", _poly([Vector2(-0.06, -0.05), Vector2(0.06, -0.05), Vector2(0.06, 0.05), Vector2(-0.06, 0.05)]), 0.02, 0.02, &"weave_charcoal", 0.003, 5)
		b.pop()
	_zip(b, 0.087, -0.38, 0.18)


static func _pants(b: ItemMeshBuilder, mat: StringName, thick: float, zips: bool) -> void:
	var o := _poly([Vector2(-0.2, -0.42), Vector2(0.2, -0.42), Vector2(0.22, 0.0), Vector2(0.25, 0.5), Vector2(0.06, 0.5),
		Vector2(0.01, -0.08), Vector2(-0.01, -0.08), Vector2(-0.06, 0.5), Vector2(-0.25, 0.5), Vector2(-0.22, 0.0)])
	b.pillow(mat, o, thick, 0.025, mat, thick * 0.2, 12)
	b.push(_at(Vector3(0, thick * 0.6, -0.4)))
	b.box(mat, Vector3(0.41, thick * 0.7, 0.05), 0.01)
	b.pop()
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.14, thick + 0.001, -0.27), Vector3(0, sx * -20.0, 0)))
		b.box(&"plastic_black", Vector3(0.006, 0.003, 0.09), 0.001)
		b.pop()
		if zips:
			b.push(_at(Vector3(sx * 0.235, thick * 0.9, 0.05), Vector3(0, sx * 3.0, 0)))
			b.box(&"plastic_black", Vector3(0.008, 0.004, 0.8), 0.001)
			b.pop()


static func _leggings(b: ItemMeshBuilder) -> void:
	var leg := _poly([Vector2(-0.09, -0.4), Vector2(0.09, -0.4), Vector2(0.07, 0.1), Vector2(0.06, 0.38), Vector2(-0.06, 0.38), Vector2(-0.07, 0.1)])
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.11, 0, 0), Vector3(0, sx * -5.0, 0)))
		b.pillow(&"suede", leg, 0.05, 0.025, &"suede", 0.01, 3)
		b.tube(&"fur", PackedVector3Array([Vector3(-0.09, 0.03, -0.39), Vector3(0.0, 0.035, -0.4), Vector3(0.09, 0.03, -0.39)]), 0.024, 8)
		for z in [0.0, 0.3]:
			b.tube(&"sinew", PackedVector3Array([Vector3(-0.07, 0.05, z), Vector3(0.0, 0.052, z + 0.005), Vector3(0.07, 0.05, z)]), 0.003, 5)
		b.pop()


static func _glove_outline(mitt: bool) -> PackedVector2Array:
	if mitt:
		return _poly([Vector2(-0.055, 0.1), Vector2(-0.058, 0.0), Vector2(-0.07, -0.03), Vector2(-0.1, -0.06), Vector2(-0.105, -0.085),
			Vector2(-0.085, -0.095), Vector2(-0.055, -0.07), Vector2(-0.052, -0.14), Vector2(-0.03, -0.175), Vector2(0.0, -0.18),
			Vector2(0.03, -0.165), Vector2(0.048, -0.12), Vector2(0.055, 0.0), Vector2(0.055, 0.1)])
	return _poly([Vector2(-0.045, 0.08), Vector2(-0.05, 0.0), Vector2(-0.058, -0.03), Vector2(-0.09, -0.06), Vector2(-0.1, -0.085),
		Vector2(-0.085, -0.095), Vector2(-0.05, -0.07), Vector2(-0.046, -0.1), Vector2(-0.048, -0.17), Vector2(-0.03, -0.176),
		Vector2(-0.025, -0.106), Vector2(-0.021, -0.186), Vector2(0.0, -0.19), Vector2(0.004, -0.108), Vector2(0.009, -0.176),
		Vector2(0.027, -0.171), Vector2(0.029, -0.1), Vector2(0.034, -0.142), Vector2(0.05, -0.136), Vector2(0.05, -0.06),
		Vector2(0.05, 0.08)])


static func _gloves(b: ItemMeshBuilder, mat: StringName, mitt: bool) -> void:
	var o := _glove_outline(mitt)
	var t := 0.034 if mitt else 0.024
	var cuff := _poly([Vector2(-0.066, -0.035), Vector2(0.066, -0.035), Vector2(0.07, 0.04), Vector2(-0.07, 0.04)])
	b.push(_at(Vector3(-0.07, 0, 0), Vector3(0, 8, 0)))
	b.pillow(mat, o, t, 0.007, mat, 0.003, 4)
	if mitt:
		b.push(_at(Vector3(0, 0.0, 0.09)))
		b.pillow(&"fur", cuff, 0.045, 0.012, &"fur", 0.004, 5)
		b.pop()
	b.pop()
	b.push(_at(Vector3(0.08, 0.008, 0.02), Vector3(0, -14, 0)))
	b.pillow(mat, _mirror_x(o), t, 0.007, mat, 0.003, 5)
	if mitt:
		b.push(_at(Vector3(0, 0.0, 0.09)))
		b.pillow(&"fur", cuff, 0.045, 0.012, &"fur", 0.004, 6)
		b.pop()
	b.pop()
	if mitt:
		b.tube(&"rope", PackedVector3Array([Vector3(-0.07, 0.03, 0.13), Vector3(-0.02, 0.01, 0.2), Vector3(0.04, 0.01, 0.2), Vector3(0.09, 0.035, 0.14)]), 0.003, 5)
	else:
		b.push(_at(Vector3(-0.07, 0.025, 0.06), Vector3(0, 8, 0)))
		b.box(&"leather_dark", Vector3(0.1, 0.004, 0.018), 0.002)
		b.pop()


static func _boot(b: ItemMeshBuilder, upper: StringName, lower: StringName, sole: StringName, tall: bool) -> void:
	var foot := _poly([Vector2(-0.125, -0.042), Vector2(-0.13, 0.0), Vector2(-0.125, 0.042), Vector2(-0.06, 0.047),
		Vector2(0.04, 0.05), Vector2(0.12, 0.042), Vector2(0.155, 0.02), Vector2(0.162, 0.0), Vector2(0.155, -0.02),
		Vector2(0.12, -0.042), Vector2(0.04, -0.05), Vector2(-0.06, -0.047)])
	b.push(_at(Vector3(0, 0.011, 0), Vector3(90, 0, 0)))
	b.extrude(sole, foot, 0.022, sole)
	b.pop()
	var rings: Array[PackedVector3Array] = []
	var xs: Array[float] = [0.152, 0.13, 0.08, 0.02, -0.04, -0.09, -0.118, -0.126]
	var cy: Array[float] = [0.034, 0.042, 0.052, 0.064, 0.07, 0.068, 0.062, 0.05]
	var hh: Array[float] = [0.012, 0.024, 0.036, 0.05, 0.056, 0.054, 0.046, 0.026]
	var ww: Array[float] = [0.018, 0.036, 0.046, 0.046, 0.043, 0.04, 0.034, 0.016]
	var s := 1.06 if tall else 1.0
	for k in xs.size():
		rings.append(b.ellipse_ring(Vector3(xs[k], cy[k], 0), Vector3(0, hh[k] * s, 0), Vector3(0, 0, ww[k] * s), 14, 0.35))
	b.loft(lower, rings, true, true)
	var top := 0.24 if tall else 0.17
	var shaft := PackedVector3Array([Vector3(-0.07, 0.06, 0), Vector3(-0.07, top * 0.6, 0), Vector3(-0.068, top, 0)])
	var sr := PackedVector2Array([Vector2(0.044, 0.056), Vector2(0.043, 0.052), Vector2(0.045, 0.054)])
	if tall:
		sr = PackedVector2Array([Vector2(0.05, 0.062), Vector2(0.048, 0.058), Vector2(0.05, 0.06)])
	b.tube(upper, shaft, sr, 16, false, false, &"", Vector3.RIGHT)
	b.disc(&"weave_charcoal", 0.042, 14, Vector3(-0.068, top - 0.01, 0), Vector3.UP, false)
	b.push(_at(Vector3(-0.068, top, 0), Vector3.ZERO, Vector3(1.2, 1.0, 1.0)))
	b.torus(&"rubber" if tall else &"leather_dark", 0.045, 0.008, 18, 6)
	b.pop()
	for k in 5:
		var x := 0.06 - k * 0.028
		var y := 0.1 + k * 0.012
		b.tube(&"cord_orange" if tall else &"rope", PackedVector3Array([Vector3(x, y, -0.022), Vector3(x - 0.012, y + 0.008, 0.0),
			Vector3(x, y, 0.022)]), 0.0022, 4)


static func _boots(b: ItemMeshBuilder, mountaineering: bool) -> void:
	var upper := &"weave_yellow" if mountaineering else &"leather"
	var lower := &"rubber" if mountaineering else &"leather"
	for i in 2:
		b.push(_at(Vector3(i * 0.02, 0, i * 0.12 - 0.06), Vector3(0, -12.0 + i * 16.0, 0)))
		_boot(b, upper, lower, &"rubber", mountaineering)
		b.pop()


static func _pack(b: ItemMeshBuilder, style: int) -> void:
	var body := &"weave_olive"
	var size := Vector3(0.3, 0.48, 0.18)
	var lid := &"weave_olive"
	if style == 1:
		body = &"weave_khaki"
		lid = &"weave_khaki"
		size = Vector3(0.31, 0.5, 0.19)
	elif style == 2:
		body = &"weave_red"
		lid = &"weave_black"
		size = Vector3(0.34, 0.72, 0.24)
	b.push(_at(Vector3(0, size.y * 0.5, 0)))
	b.box(body, size, 0.05, 3)
	b.pop()
	if style == 0:
		b.push(_at(Vector3(0.0, size.y + 0.002, -0.07), Vector3(-160, 0, 0)))
		b.pillow(lid, _poly([Vector2(-0.14, 0.0), Vector2(0.14, 0.0), Vector2(0.1, 0.14), Vector2(0.02, 0.1), Vector2(-0.13, 0.12)]), 0.02, 0.02, lid, 0.006, 3)
		b.pop()
		b.push(_at(Vector3(0.05, size.y * 0.55, size.z * 0.5 + 0.002), Vector3(90, 0, 0)))
		b.extrude(&"weave_black", _poly([Vector2(-0.05, 0.0), Vector2(-0.02, 0.012), Vector2(0.01, -0.004), Vector2(0.05, 0.02),
			Vector2(0.03, 0.03), Vector2(0.0, 0.012), Vector2(-0.03, 0.024)]), 0.004)
		b.pop()
	else:
		b.push(_at(Vector3(0, size.y + 0.015, 0.0)))
		b.box(lid, Vector3(size.x * 0.98, 0.07, size.z * 1.05), 0.03, 2)
		b.pop()
		b.push(_at(Vector3(0, size.y * 0.36, size.z * 0.5 + 0.02)))
		b.box(body, Vector3(size.x * 0.7, size.y * 0.4, 0.05), 0.02, 2)
		b.pop()
		if style == 1:
			for p in [Vector3(-0.08, size.y * 0.72, size.z * 0.5 + 0.002), Vector3(0.09, size.y * 0.16, size.z * 0.5 + 0.047)]:
				b.push(_at(p, Vector3(90, 0, 0)))
				b.pillow(&"suede", _poly([Vector2(-0.045, -0.035), Vector2(0.05, -0.03), Vector2(0.04, 0.04), Vector2(-0.04, 0.035)]), 0.004, 0.01, &"suede", 0.001, 4)
				b.pop()
	for sx in [-1.0, 1.0]:
		var strap := PackedVector3Array([Vector3(sx * 0.07, size.y * 0.9, -size.z * 0.5), Vector3(sx * 0.08, size.y * 0.75, -size.z * 0.5 - 0.035),
			Vector3(sx * 0.085, size.y * 0.4, -size.z * 0.5 - 0.04), Vector3(sx * 0.1, size.y * 0.12, -size.z * 0.5 - 0.01)])
		b.tube(&"strap_black", strap, PackedVector2Array([Vector2(0.03, 0.008)]), 6, true, true, &"", Vector3.BACK)
		if style == 2:
			for y in [0.35, 0.55]:
				b.push(_at(Vector3(sx * (size.x * 0.5 + 0.004), size.y * y, 0.0)))
				b.box(&"strap_black", Vector3(0.006, 0.022, size.z * 0.9), 0.002)
				b.pop()
	if style == 2:
		for sx in [-1.0, 1.0]:
			b.push(_at(Vector3(sx * 0.06, 0.06, size.z * 0.5 + 0.004), Vector3(90, 0, 0)))
			b.torus(&"strap_black", 0.018, 0.004, 12, 4)
			b.pop()
		b.push(_at(Vector3(0, 0.08, -size.z * 0.5 - 0.03)))
		b.box(&"strap_black", Vector3(size.x * 1.25, 0.1, 0.05), 0.02)
		b.pop()
	b.push(_at(Vector3(0, size.y + 0.05, -0.03), Vector3(90, 0, 0)))
	b.torus(&"strap_black", 0.025, 0.005, 12, 4, PI)
	b.pop()
	if style == 0:
		b.tube(&"strap_black", PackedVector3Array([Vector3(0.1, size.y * 0.12, -size.z * 0.5 - 0.01), Vector3(0.13, 0.02, -size.z * 0.5 + 0.02),
			Vector3(0.16, 0.004, -size.z * 0.5 + 0.08)]), PackedVector2Array([Vector2(0.028, 0.004)]), 6, true, true, &"", Vector3.UP)


# =============================================================================================== quest

static func _book(b: ItemMeshBuilder, size: Vector3, cover: StringName, label: StringName, hard: bool) -> void:
	var w := size.x
	var t := size.y
	var d := size.z
	var ct := 0.003 if hard else 0.0014
	b.push(_at(Vector3(0.003, t * 0.5, 0)))
	b.box(&"pages", Vector3(w - 0.006, t - ct * 2.0, d - 0.006), 0.001)
	b.pop()
	for y in [ct * 0.5, t - ct * 0.5]:
		b.push(_at(Vector3(0, y, 0)))
		b.box(cover, Vector3(w, ct, d), ct * 0.4)
		b.pop()
	b.push(_at(Vector3(-w * 0.5 + 0.0015, t * 0.5, 0)))
	b.box(cover, Vector3(0.003, t, d), 0.0014)
	b.pop()
	b.push(_at(Vector3(0, t + 0.0002, 0)))
	b.plane(label, Vector2(w - 0.004, d - 0.004))
	b.pop()


static func _logbook(b: ItemMeshBuilder) -> void:
	_book(b, Vector3(0.15, 0.024, 0.21), &"cover_black", &"label_logbook", true)
	b.push(_at(Vector3(0.1, 0.004, 0.02), Vector3(0, 70, -90)))
	b.lathe(&"paint_yellow", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.0038, 0.0), Vector2(0.0038, 0.15)]), 6)
	b.lathe(&"wood_pale", PackedVector2Array([Vector2(0.0038, 0.15), Vector2(0.0012, 0.165)]), 6)
	b.lathe(&"graphite", PackedVector2Array([Vector2(0.0012, 0.165), Vector2(0.0, 0.169)]), 6)
	b.pop()


static func _radio(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.065, 0)))
	b.box(&"plastic_black", Vector3(0.058, 0.13, 0.034), 0.008, 2)
	b.pop()
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.0292, 0.06, 0)))
		b.box(&"plastic_yellow", Vector3(0.003, 0.09, 0.024), 0.001)
		b.pop()
	for k in 6:
		b.push(_at(Vector3(0, 0.018 + k * 0.007, 0.0172)))
		b.box(&"rubber", Vector3(0.036, 0.0025, 0.002), 0.0006)
		b.pop()
	b.push(_at(Vector3(0, 0.1, 0.0172), Vector3(90, 0, 0)))
	b.plane(&"print_screen", Vector2(0.036, 0.022))
	b.pop()
	for k in 3:
		b.push(_at(Vector3(-0.014 + k * 0.014, 0.077, 0.0172), Vector3(90, 0, 0)))
		b.cylinder(&"rubber", 0.004, 0.002, 10)
		b.pop()
	b.push(_at(Vector3(0.015, 0.13, 0)))
	b.cylinder(&"rubber", 0.006, 0.012, 12)
	b.pop()
	b.push(_at(Vector3(-0.012, 0.13, 0)))
	b.lathe(&"rubber", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.006, 0.0), Vector2(0.0055, 0.02), Vector2(0.004, 0.09),
		Vector2(0.005, 0.1), Vector2(0.0, 0.102)]), 10)
	b.pop()
	b.push(_at(Vector3(0, 0.08, -0.019)))
	b.box(&"plastic_black", Vector3(0.03, 0.06, 0.004), 0.002)
	b.pop()


static func _transceiver(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.03, 0)))
	b.box(&"aluminium", Vector3(0.18, 0.06, 0.12), 0.004)
	b.pop()
	for k in 11:
		b.push(_at(Vector3(-0.08 + k * 0.016, 0.068, 0)))
		b.box(&"aluminium", Vector3(0.003, 0.016, 0.11), 0.0008)
		b.pop()
	for x in [-0.05, 0.0, 0.05]:
		b.push(_at(Vector3(x, 0.03, 0.06), Vector3(90, 0, 0)))
		b.lathe(&"brass", PackedVector2Array([Vector2(0.0, 0.0), Vector2(0.008, 0.0), Vector2(0.008, 0.014), Vector2(0.006, 0.016),
			Vector2(0.0, 0.016)]), 12)
		b.pop()
	b.push(_at(Vector3(0.0, 0.052, 0.0605), Vector3(90, 0, 0)))
	b.box(&"plastic_black", Vector3(0.08, 0.002, 0.012), 0.0005)
	b.pop()
	for sx in [-1.0, 1.0]:
		b.push(_at(Vector3(sx * 0.095, 0.03, 0), Vector3(0, 0, sx * 90.0)))
		b.torus(&"steel_dark", 0.02, 0.003, 12, 4, PI)
		b.pop()


static func _battery_pack(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.05, 0)))
	b.box(&"plastic_black", Vector3(0.22, 0.1, 0.14), 0.012, 2)
	b.pop()
	b.push(_at(Vector3(0, 0.068, 0)))
	b.box(&"paint_yellow", Vector3(0.2216, 0.012, 0.1416), 0.002)
	b.pop()
	b.tube(&"plastic_orange", PackedVector3Array([Vector3(-0.06, 0.1, 0), Vector3(-0.055, 0.135, 0), Vector3(0.055, 0.135, 0),
		Vector3(0.06, 0.1, 0)]), 0.008, 8)
	for x in [-0.08, 0.08]:
		b.push(_at(Vector3(x, 0.1, 0.04)))
		b.cylinder(&"brass", 0.008, 0.012, 12)
		b.pop()
		b.push(_at(Vector3(x, 0.112, 0.04)))
		b.cylinder(&"plastic_red" if x > 0.0 else &"plastic_black", 0.0095, 0.006, 12)
		b.pop()


static func _key(b: ItemMeshBuilder) -> void:
	var key := _poly([Vector2(-0.036, 0.0), Vector2(-0.034, 0.008), Vector2(-0.028, 0.012), Vector2(-0.018, 0.012),
		Vector2(-0.012, 0.006), Vector2(-0.012, 0.003), Vector2(0.032, 0.003), Vector2(0.034, 0.0), Vector2(0.032, -0.003),
		Vector2(0.028, -0.003), Vector2(0.028, -0.009), Vector2(0.023, -0.009), Vector2(0.021, -0.006), Vector2(0.018, -0.006),
		Vector2(0.016, -0.01), Vector2(0.011, -0.01), Vector2(0.009, -0.006), Vector2(0.006, -0.006), Vector2(0.006, -0.003),
		Vector2(-0.012, -0.003), Vector2(-0.012, -0.006), Vector2(-0.018, -0.012), Vector2(-0.028, -0.012), Vector2(-0.034, -0.008)])
	b.extrude(&"brass", key, 0.0025, &"brass")
	b.transform_all(Transform3D(LAY_SIDE, Vector3.ZERO))
	b.push(_at(Vector3(-0.05, 0.0, 0.0)))
	b.torus(&"cord_orange", 0.03, 0.0018, 24, 5)
	b.pop()
	b.push(_at(Vector3(-0.1, 0.0, 0.015), Vector3(0, 20, 0)))
	b.box(&"paper", Vector3(0.05, 0.0006, 0.028), 0.003)
	b.pop()


static func _keycard(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.0004, 0)))
	b.box(&"plastic_white", Vector3(0.0856, 0.0008, 0.054), 0.0003)
	b.pop()
	b.push(_at(Vector3(0, 0.00082, 0)))
	b.plane(&"label_keycard", Vector2(0.0852, 0.0536))
	b.pop()
	var lp := PackedVector3Array()
	for i in 13:
		var a := PI * i / 12.0
		lp.append(Vector3(-0.043 - sin(a) * 0.07, 0.0012, -cos(a) * 0.03))
	b.tube(&"strap_blue", lp, PackedVector2Array([Vector2(0.006, 0.0006)]), 4, true, true, &"", Vector3.UP)


# =============================================================================================== buildables

static func _campfire(b: ItemMeshBuilder, r: RandomNumberGenerator, lit: bool) -> void:
	b.lathe(&"ash", PackedVector2Array([Vector2(0.0, 0.035), Vector2(0.3, 0.03), Vector2(0.5, 0.015), Vector2(0.64, 0.0)]), 24, 60.0)
	_stone_ring(b, r, 10, 0.6, 0.09, 0.13, 100)
	for i in 6:
		var a := TAU * i / 6.0 + 0.3
		var foot := Vector3(cos(a) * 0.36, 0.03, sin(a) * 0.36)
		var top := Vector3(cos(a) * 0.05, 0.38 + r.randf_range(-0.04, 0.04), sin(a) * 0.05)
		var rr := r.randf_range(0.022, 0.035)
		_branch(b, r, foot, foot.lerp(top, 0.55), rr, rr * 0.95, &"bark", &"wood_pale", 0.006, 7)
		_branch(b, r, foot.lerp(top, 0.55), top, rr * 0.95, rr * 0.8, &"charred", &"charred", 0.004, 7)
	for i in 3:
		var a := TAU * i / 3.0 + 1.1
		var a0 := Vector3(cos(a) * 0.42, 0.06, sin(a) * 0.42)
		var a1 := Vector3(cos(a + 0.9) * 0.1, 0.07, sin(a + 0.9) * 0.1)
		_log(b, a0, a0.lerp(a1, 0.6), 0.05, &"bark", &"endgrain", 10)
		_log(b, a0.lerp(a1, 0.6), a1, 0.048, &"charred", &"charred", 10)
	for i in 7:
		var p := Vector3(r.randf_range(-0.14, 0.14), 0.04, r.randf_range(-0.14, 0.14))
		b.push(_at(p))
		b.rock(&"charred_glow" if lit else &"coal", r.randf_range(0.02, 0.035), 300 + i, 1, 0.1, Vector3(1.2, 0.7, 1.0), 0.0, 8, 0.3)
		b.pop()


static func _stone_ring(b: ItemMeshBuilder, r: RandomNumberGenerator, count: int, radius: float, rmin: float, rmax: float, seed0: int, y0 := 0.0) -> void:
	for i in count:
		var a := TAU * float(i) / count + r.randf_range(-0.12, 0.12)
		var rad := r.randf_range(rmin, rmax)
		var pos := Vector3(cos(a) * radius, y0 + rad * 0.42, sin(a) * radius)
		b.push(_at(pos, Vector3(0, rad_to_deg(-a), 0)))
		b.rock(&"granite_sooty" if i % 3 == 0 else &"granite", rad, seed0 + i, 2, 0.14, Vector3(1.25, 0.8, 0.95), 0.35)
		b.pop()


static func _fire_pit(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	b.lathe(&"ash", PackedVector2Array([Vector2(0.0, 0.03), Vector2(0.45, 0.025), Vector2(0.72, 0.0)]), 24, 60.0)
	_stone_ring(b, r, 13, 0.76, 0.12, 0.16, 200)
	_stone_ring(b, r, 11, 0.73, 0.1, 0.14, 230, 0.16)
	for i in 3:
		var a := TAU * i / 3.0 + 0.4
		_log(b, Vector3(cos(a) * 0.45, 0.07, sin(a) * 0.45), Vector3(cos(a + 1.3) * 0.2, 0.08, sin(a + 1.3) * 0.2), 0.05, &"charred", &"charred", 10)
	for i in 6:
		b.push(_at(Vector3(r.randf_range(-0.2, 0.2), 0.04, r.randf_range(-0.2, 0.2))))
		b.rock(&"coal", r.randf_range(0.025, 0.04), 260 + i, 1, 0.1, Vector3(1.2, 0.7, 1.0), 0.0, 8, 0.3)
		b.pop()


static func _lean_to(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for sx in [-1.0, 1.0]:
		_branch(b, r, Vector3(sx * 1.4, 0, 0), Vector3(sx * 1.4, 1.48, 0), 0.06, 0.045, &"bark", &"wood_pale", 0.03, 9)
	_log(b, Vector3(-1.6, 1.42, 0), Vector3(1.6, 1.42, 0), 0.055, &"bark", &"endgrain", 10)
	for i in 8:
		var x := lerpf(-1.4, 1.4, i / 7.0)
		_branch(b, r, Vector3(x, 1.46, 0.05), Vector3(x + r.randf_range(-0.05, 0.05), 0.0, -1.95), 0.035, 0.03, &"bark", &"wood_pale", 0.02, 7)
	for row in 5:
		for col in 7:
			var t := (row + 0.5) / 5.0
			var x := lerpf(-1.3, 1.3, col / 6.0) + r.randf_range(-0.05, 0.05)
			var p := Vector3(x, 1.46 - 1.46 * t, 0.05 - 2.0 * t) + Vector3(0, 0.8, -0.6) * 0.06
			b.push(_at(p, Vector3(-36.0, r.randf_range(-6.0, 6.0), r.randf_range(-3.0, 3.0))))
			b.box(&"bark" if (row + col) % 3 else &"bark_dark", Vector3(0.52, 0.02, 0.56), 0.008)
			b.pop()


static func _foundation(b: ItemMeshBuilder, r: RandomNumberGenerator, with_floor: bool) -> void:
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			b.push(_at(Vector3(sx * 1.4, 0.14, sz * 1.4)))
			b.rock(&"granite", 0.22, int(sx * 3.0 + sz * 7.0 + 20.0), 2, 0.1, Vector3(1.2, 0.7, 1.1), 0.3)
			b.pop()
	for sz in [-1.0, 1.0]:
		_log(b, Vector3(-1.62, 0.44, sz * 1.4), Vector3(1.62, 0.44, sz * 1.4), 0.15, &"bark", &"endgrain", 14)
	for sx in [-1.0, 1.0]:
		_log(b, Vector3(sx * 1.4, 0.62, -1.62), Vector3(sx * 1.4, 0.62, 1.62), 0.15, &"bark", &"endgrain", 14)
	for x in [-0.47, 0.47]:
		_log(b, Vector3(x, 0.6, -1.5), Vector3(x, 0.6, 1.5), 0.12, &"bark", &"endgrain", 12)
	if with_floor:
		for i in 11:
			var z := lerpf(-1.4, 1.4, i / 10.0)
			b.push(_at(Vector3(r.randf_range(-0.02, 0.02), 0.8, z), Vector3(0, r.randf_range(-1.0, 1.0), 0)))
			b.box(&"wood_weathered", Vector3(3.1, 0.07, 0.26), 0.01)
			b.pop()


static func _log_wall(b: ItemMeshBuilder, kind: int) -> void:
	var rows := 8
	var rad := 0.15
	for row in rows:
		var y := rad + row * rad * 1.9
		var gap := Vector2.ZERO
		if kind == 1 and row >= 3 and row <= 5:
			gap = Vector2(-0.5, 0.5)
		elif kind == 2 and row <= 6:
			gap = Vector2(-0.55, 0.55)
		var overhang := 0.2 if row % 2 == 0 else 0.1
		if gap == Vector2.ZERO:
			_log(b, Vector3(-1.5 - overhang, y, 0), Vector3(1.5 + overhang, y, 0), rad, &"bark", &"endgrain", 14)
		else:
			_log(b, Vector3(-1.5 - overhang, y, 0), Vector3(gap.x, y, 0), rad, &"bark", &"endgrain", 14)
			_log(b, Vector3(gap.y, y, 0), Vector3(1.5 + overhang, y, 0), rad, &"bark", &"endgrain", 14)
		if row > 0:
			b.tube(&"needles", PackedVector3Array([Vector3(-1.5, y - rad * 0.95, 0), Vector3(1.5, y - rad * 0.95, 0)]), 0.035, 6, true, true)
	if kind > 0:
		var y0 := rad + 3 * rad * 1.9 - rad if kind == 1 else 0.0
		var y1 := rad + 5 * rad * 1.9 + rad if kind == 1 else rad + 6 * rad * 1.9 + rad
		var w := 0.5 if kind == 1 else 0.55
		for sx in [-1.0, 1.0]:
			b.push(_at(Vector3(sx * (w + 0.03), (y0 + y1) * 0.5, 0)))
			b.box(&"wood_weathered", Vector3(0.07, y1 - y0, 0.3), 0.01)
			b.pop()
		b.push(_at(Vector3(0, y1 + 0.03, 0)))
		b.box(&"wood_weathered", Vector3(w * 2.0 + 0.14, 0.07, 0.3), 0.01)
		b.pop()
		if kind == 1:
			b.push(_at(Vector3(0, y0 - 0.03, 0)))
			b.box(&"wood_weathered", Vector3(w * 2.0 + 0.14, 0.07, 0.34), 0.01)
			b.pop()


static func _door(b: ItemMeshBuilder) -> void:
	for i in 6:
		b.push(_at(Vector3(-0.46 + i * 0.184, 1.05, 0)))
		b.box(&"wood_weathered", Vector3(0.178, 2.1, 0.045), 0.008)
		b.pop()
	for y in [0.35, 1.75]:
		b.push(_at(Vector3(0, y, -0.045)))
		b.box(&"wood", Vector3(1.0, 0.14, 0.045), 0.008)
		b.pop()
	b.push(_at(Vector3(0, 1.05, -0.045), Vector3(0, 0, 52)))
	b.box(&"wood", Vector3(1.65, 0.12, 0.04), 0.008)
	b.pop()
	for y in [0.35, 1.75]:
		b.push(_at(Vector3(-0.53, y, 0), Vector3(90, 0, 0)))
		b.torus(&"rope", 0.045, 0.012, 12, 6)
		b.pop()
	b.push(_at(Vector3(0.38, 1.05, 0.045)))
	b.box(&"wood_dark", Vector3(0.22, 0.05, 0.04), 0.01)
	b.pop()


static func _roof(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	var pitch := 42.0
	var run := 1.55
	var rise := run * tan(deg_to_rad(pitch))
	for sz in [-1.0, 1.0]:
		for i in 5:
			var x := lerpf(-1.45, 1.45, i / 4.0)
			_branch(b, r, Vector3(x, 0.05, sz * run), Vector3(x, rise, 0.0), 0.06, 0.05, &"bark", &"wood_pale", 0.01, 8)
		for row in 4:
			for col in 6:
				var t := (row + 0.5) / 4.0
				var p := Vector3(lerpf(-1.25, 1.25, col / 5.0) + r.randf_range(-0.04, 0.04), rise * t + 0.08, sz * run * (1.0 - t))
				b.push(_at(p, Vector3(sz * -pitch, r.randf_range(-4.0, 4.0), 0)))
				b.box(&"bark" if (row + col) % 3 else &"bark_dark", Vector3(0.56, 0.025, 0.6), 0.01)
				b.pop()
	_log(b, Vector3(-1.6, rise + 0.02, 0), Vector3(1.6, rise + 0.02, 0), 0.09, &"bark", &"endgrain", 12)


static func _stairs(b: ItemMeshBuilder) -> void:
	for sx in [-1.0, 1.0]:
		_log(b, Vector3(sx * 0.55, 0.1, 1.5), Vector3(sx * 0.55, 2.45, -1.4), 0.12, &"bark", &"endgrain", 12)
	for i in 8:
		var t := (i + 0.5) / 8.0
		var p := Vector3(0, lerpf(0.1, 2.45, t) + 0.12, lerpf(1.5, -1.4, t))
		b.tube(&"bark", PackedVector3Array([p + Vector3(-0.7, 0, 0), p + Vector3(0.7, 0, 0)]), PackedVector2Array([Vector2(0.14, 0.06)]),
			12, true, true, &"endgrain", Vector3.UP)
		b.push(_at(p + Vector3(0, 0.055, 0)))
		b.box(&"wood_weathered", Vector3(1.4, 0.02, 0.27), 0.005)
		b.pop()


static func _railing(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for sx in [-1.0, 1.0]:
		_log(b, Vector3(sx * 1.4, 0.0, 0), Vector3(sx * 1.4, 1.05, 0), 0.075, &"bark", &"endgrain", 10)
	_log(b, Vector3(-1.5, 0.98, 0), Vector3(1.5, 0.98, 0), 0.055, &"bark", &"endgrain", 10)
	_log(b, Vector3(-1.45, 0.5, 0), Vector3(1.45, 0.5, 0), 0.04, &"bark", &"endgrain", 8)
	for i in 5:
		var x := lerpf(-1.0, 1.0, i / 4.0)
		_branch(b, r, Vector3(x, 0.02, 0), Vector3(x + r.randf_range(-0.03, 0.03), 0.96, 0), 0.025, 0.022, &"bark", &"wood_pale", 0.01, 7)


static func _windbreak(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for course in 3:
		var count := 9 - course
		for i in count:
			var a := lerpf(-0.6, 0.6, (i + 0.5 * (course % 2)) / float(count - 1 + (course % 2)))
			var rad := r.randf_range(0.14, 0.2) - course * 0.015
			var p := Vector3(sin(a) * 2.0, rad * 0.8 + course * 0.3, 2.0 - cos(a) * 2.0)
			b.push(_at(p, Vector3(0, rad_to_deg(a) + r.randf_range(-15.0, 15.0), 0)))
			b.rock(&"granite_dark" if (i + course) % 3 == 0 else &"granite", rad, 500 + course * 20 + i, 2, 0.12,
				Vector3(1.4, 0.85, 1.0), 0.3, 6, 0.12)
			b.pop()


static func _crate(b: ItemMeshBuilder) -> void:
	var sx := 1.0
	var sy := 0.55
	var sz := 0.6
	b.push(_at(Vector3(0, 0.02, 0)))
	b.box(&"wood_weathered", Vector3(sx, 0.04, sz), 0.006)
	b.pop()
	for i in 3:
		var y := 0.1 + i * 0.16
		for side in [-1.0, 1.0]:
			b.push(_at(Vector3(0, y, side * (sz * 0.5 - 0.02))))
			b.box(&"wood_weathered", Vector3(sx, 0.15, 0.035), 0.006)
			b.pop()
			b.push(_at(Vector3(side * (sx * 0.5 - 0.02), y, 0)))
			b.box(&"wood_weathered", Vector3(0.035, 0.15, sz - 0.07), 0.006)
			b.pop()
	for cx in [-1.0, 1.0]:
		for cz in [-1.0, 1.0]:
			b.push(_at(Vector3(cx * (sx * 0.5 - 0.005), sy * 0.5, cz * (sz * 0.5 - 0.005))))
			b.box(&"wood", Vector3(0.05, sy, 0.05), 0.008)
			b.pop()
	b.push(_at(Vector3(0, sy + 0.035, -sz * 0.5), Vector3(-12, 0, 0)))
	b.push(_at(Vector3(0, 0, sz * 0.5)))
	for i in 4:
		b.push(_at(Vector3(0, 0, -sz * 0.5 + 0.075 + i * 0.15)))
		b.box(&"wood_weathered", Vector3(sx + 0.03, 0.035, 0.145), 0.006)
		b.pop()
	for x in [-0.4, 0.4]:
		b.push(_at(Vector3(x, 0.03, 0)))
		b.box(&"wood", Vector3(0.07, 0.03, sz), 0.006)
		b.pop()
	b.pop()
	b.pop()
	for side in [-1.0, 1.0]:
		b.push(_at(Vector3(side * (sx * 0.5 + 0.03), 0.36, 0), Vector3(0, 0, 90)))
		b.torus(&"rope", 0.05, 0.012, 12, 6, PI)
		b.pop()


static func _drying_rack(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			_branch(b, r, Vector3(sx * 0.95, 0, sz * 0.45), Vector3(sx * 0.95, 1.72, sz * -0.04), 0.035, 0.028, &"bark", &"wood_pale", 0.02, 7)
		_lash(b, Vector3(sx * 0.95, 1.62, 0), Vector3.RIGHT, 0.05, 4.0, 0.06, &"rope", 0.006)
	_log(b, Vector3(-1.15, 1.64, 0), Vector3(1.15, 1.64, 0), 0.035, &"bark", &"wood_pale", 8)
	_log(b, Vector3(-1.05, 1.05, 0.2), Vector3(1.05, 1.05, 0.2), 0.03, &"bark", &"wood_pale", 8)
	for i in 5:
		var x := lerpf(-0.7, 0.7, i / 4.0)
		b.push(_at(Vector3(x, 1.4, 0.0), Vector3(90, r.randf_range(-10.0, 10.0), 0)))
		b.pillow(&"jerky", _poly([Vector2(-0.03, -0.2), Vector2(0.03, -0.2), Vector2(0.025, 0.2), Vector2(-0.025, 0.2)]), 0.01, 0.01, &"jerky", 0.004, 30 + i)
		b.pop()
	b.push(_at(Vector3(0.0, 0.74, 0.22), Vector3(90, 0, 0)))
	b.pillow(&"suede", _poly([Vector2(-0.4, -0.3), Vector2(0.4, -0.3), Vector2(0.45, 0.25), Vector2(0.2, 0.3), Vector2(-0.2, 0.3), Vector2(-0.45, 0.25)]), 0.02, 0.04, &"fur", 0.01, 3)
	b.pop()


static func _workbench(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	b.push(_at(Vector3(0, 0.86, 0)))
	b.box(&"wood", Vector3(2.0, 0.1, 0.5), 0.012)
	b.pop()
	b.tube(&"bark", PackedVector3Array([Vector3(-1.0, 0.8, 0), Vector3(1.0, 0.8, 0)]), PackedVector2Array([Vector2(0.25, 0.07)]), 16, true, true, &"endgrain", Vector3.UP)
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			_branch(b, r, Vector3(sx * 0.78, 0.8, sz * 0.12), Vector3(sx * 0.92, 0.0, sz * 0.32), 0.05, 0.045, &"bark", &"endgrain", 0.01, 8)
	for x in [0.55, 0.75]:
		b.push(_at(Vector3(x, 0.91, 0.12)))
		b.cylinder(&"wood_dark", 0.018, 0.09, 8)
		b.pop()
	for i in 4:
		b.push(_at(Vector3(r.randf_range(-0.6, 0.2), 0.912, r.randf_range(-0.15, 0.15)), Vector3(0, r.randf_range(0.0, 180.0), 0)))
		b.box(&"wood_pale", Vector3(0.08, 0.004, 0.02), 0.002)
		b.pop()


static func _snow_melter(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	_stone_ring(b, r, 9, 0.42, 0.1, 0.13, 700)
	for i in 3:
		var a := TAU * i / 3.0
		_branch(b, r, Vector3(cos(a) * 0.3, 0.04, sin(a) * 0.3), Vector3(cos(a + 2.0) * 0.1, 0.06, sin(a + 2.0) * 0.1), 0.025, 0.02, &"charred", &"charred", 0.004, 7)
	var y := 0.3
	b.push(_at(Vector3(0, y, 0)))
	b.box(&"aluminium_sooty", Vector3(0.8, 0.012, 0.5), 0.004)
	for side in [-1.0, 1.0]:
		b.push(_at(Vector3(0, 0.09, side * 0.25)))
		b.box(&"aluminium", Vector3(0.8, 0.18, 0.01), 0.003)
		b.pop()
		b.push(_at(Vector3(side * 0.4, 0.09, 0)))
		b.box(&"aluminium", Vector3(0.01, 0.18, 0.5), 0.003)
		b.pop()
	b.push(_at(Vector3(0.05, 0.1, 0)))
	b.rock(&"snow", 0.24, 9, 2, 0.2, Vector3(1.4, 0.55, 0.9), 0.4)
	b.pop()
	b.pop()
	b.push(_at(Vector3(0.4, y + 0.02, 0.0), Vector3(0, 0, 80)))
	b.cylinder(&"aluminium", 0.02, 0.12, 10)
	b.pop()


static func _bough_bed(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	for sz in [-1.0, 1.0]:
		_log(b, Vector3(-1.05, 0.08, sz * 0.5), Vector3(1.05, 0.08, sz * 0.5), 0.08, &"bark", &"endgrain", 10)
	for sx in [-1.0, 1.0]:
		_log(b, Vector3(sx * 0.95, 0.2, -0.6), Vector3(sx * 0.95, 0.2, 0.6), 0.07, &"bark", &"endgrain", 10)
	b.push(_at(Vector3(0, 0.06, 0)))
	b.pillow(&"needles", _poly([Vector2(-0.95, -0.46), Vector2(0.95, -0.46), Vector2(0.95, 0.46), Vector2(-0.95, 0.46)]), 0.22, 0.05, &"needles", 0.06, 17)
	b.pop()
	for i in 10:
		var p := Vector3(r.randf_range(-0.8, 0.8), 0.25, r.randf_range(-0.35, 0.35))
		b.push(_at(p, Vector3(0, r.randf_range(0.0, 180.0), 0)))
		_branch(b, r, Vector3(-0.2, 0, 0), Vector3(0.2, 0.02, 0), 0.01, 0.006, &"bark", &"wood_pale", 0.02, 5)
		b.pop()


static func _hide_bed(b: ItemMeshBuilder) -> void:
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			_log(b, Vector3(sx * 1.02, 0.0, sz * 0.5), Vector3(sx * 1.02, 0.42, sz * 0.5), 0.07, &"bark", &"endgrain", 10)
	for sz in [-1.0, 1.0]:
		_log(b, Vector3(-1.1, 0.32, sz * 0.5), Vector3(1.1, 0.32, sz * 0.5), 0.07, &"bark", &"endgrain", 10)
	for sx in [-1.0, 1.0]:
		_log(b, Vector3(sx * 1.02, 0.3, -0.56), Vector3(sx * 1.02, 0.3, 0.56), 0.06, &"bark", &"endgrain", 10)
	b.push(_at(Vector3(0, 0.34, 0)))
	b.pillow(&"suede", _poly([Vector2(-1.0, -0.47), Vector2(1.0, -0.47), Vector2(1.0, 0.47), Vector2(-1.0, 0.47)]), 0.16, 0.05, &"suede", 0.02, 5)
	b.pop()
	b.push(_at(Vector3(0.25, 0.46, 0)))
	b.pillow(&"fur", _poly([Vector2(-0.6, -0.5), Vector2(0.72, -0.5), Vector2(0.75, 0.5), Vector2(-0.62, 0.5)]), 0.07, 0.05, &"suede", 0.02, 6)
	b.pop()


static func _torch_stand(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	_stone_ring(b, r, 6, 0.16, 0.08, 0.11, 800)
	for i in 3:
		var a := TAU * i / 3.0 + 0.5
		b.push(_at(Vector3(cos(a) * 0.08, 0.16, sin(a) * 0.08)))
		b.rock(&"granite", 0.07, 820 + i, 2, 0.12, Vector3(1.2, 0.8, 1.0), 0.3)
		b.pop()
	_branch(b, r, Vector3(0, 0, 0), Vector3(0.02, 1.65, 0.01), 0.032, 0.026, &"bark", &"wood_pale", 0.02, 8)
	b.push(_at(Vector3(0.02, 1.68, 0.01)))
	b.lathe(&"cloth_pitch", PackedVector2Array([Vector2(0.0, -0.1), Vector2(0.03, -0.1), Vector2(0.045, -0.06), Vector2(0.048, 0.0),
		Vector2(0.042, 0.06), Vector2(0.025, 0.09), Vector2(0.0, 0.095)]), 14, 70.0)
	b.pop()
	for y in [1.6, 1.68, 1.75]:
		_ring(b, Vector3(0.02, y, 0.01), Vector3.UP, 0.045 if y == 1.68 else 0.036, 0.004, &"rope")


static func _rope_ladder(b: ItemMeshBuilder, r: RandomNumberGenerator) -> void:
	var h := 3.6
	for sx in [-1.0, 1.0]:
		var path := PackedVector3Array()
		for i in 13:
			var f := i / 12.0
			path.append(Vector3(sx * 0.25, f * h, sin(f * PI) * 0.03))
		b.tube(&"rope", path, 0.012, 8)
	for i in 10:
		var y := 0.3 + i * 0.34
		var z := sin((y / h) * PI) * 0.03
		_branch(b, r, Vector3(-0.29, y, z), Vector3(0.29, y + r.randf_range(-0.01, 0.01), z), 0.02, 0.018, &"bark", &"wood_pale", 0.006, 7)
		for sx in [-1.0, 1.0]:
			b.push(_at(Vector3(sx * 0.25, y, z)))
			b.sphere(&"rope", 0.022, 8, 6)
			b.pop()


## Kestrel Station's fabricator: a steel cabinet with a lit work chamber, control screen and vents.
static func _fabricator(b: ItemMeshBuilder) -> void:
	b.push(_at(Vector3(0, 0.75, 0)))
	b.box(&"paint_white", Vector3(0.9, 1.5, 0.62), 0.02, 2)
	b.pop()
	b.push(_at(Vector3(0, 0.82, 0.29)))
	b.box(&"steel_black", Vector3(0.6, 0.46, 0.08), 0.012)
	b.pop()
	b.push(_at(Vector3(0, 0.82, 0.332), Vector3(90, 0, 0)))
	b.plane(&"acrylic", Vector2(0.58, 0.44))
	b.pop()
	b.push(_at(Vector3(0, 0.62, 0.3)))
	b.box(&"aluminium", Vector3(0.5, 0.012, 0.1), 0.004)
	b.pop()
	b.push(_at(Vector3(0.25, 1.26, 0.313), Vector3(90, 0, 0)))
	b.box(&"plastic_black", Vector3(0.24, 0.012, 0.16), 0.006)
	b.pop()
	b.push(_at(Vector3(0.25, 1.26, 0.3202), Vector3(90, 0, 0)))
	b.plane(&"print_screen", Vector2(0.21, 0.13))
	b.pop()
	for k in 3:
		b.push(_at(Vector3(-0.3 + k * 0.07, 1.26, 0.315), Vector3(90, 0, 0)))
		b.cylinder(&"paint_red" if k == 0 else &"rubber", 0.016, 0.012, 12)
		b.pop()
	for k in 6:
		b.push(_at(Vector3(0, 0.12 + k * 0.035, 0.312)))
		b.box(&"steel_dark", Vector3(0.7, 0.012, 0.01), 0.003)
		b.pop()
	b.push(_at(Vector3(0, 1.5, 0)))
	b.box(&"steel_dark", Vector3(0.92, 0.03, 0.64), 0.008)
	b.pop()
	b.tube(&"rubber", PackedVector3Array([Vector3(0.44, 1.3, -0.2), Vector3(0.5, 1.2, -0.28), Vector3(0.52, 0.6, -0.3),
		Vector3(0.5, 0.02, -0.34)]), 0.012, 8)
	b.tube(&"plastic_orange", PackedVector3Array([Vector3(0.44, 1.1, -0.1), Vector3(0.49, 1.0, -0.2), Vector3(0.5, 0.4, -0.25),
		Vector3(0.45, 0.02, -0.42)]), 0.01, 8)


# =============================================================================================== fallback

static func _fallback(b: ItemMeshBuilder, r: RandomNumberGenerator, category: String) -> bool:
	match category:
		"resource", "fuel":
			b.push(_at(Vector3(0, 0.04, 0)))
			b.box(&"cardboard", Vector3(0.16, 0.08, 0.12), 0.006)
			b.pop()
			_ring(b, Vector3(0, 0.04, 0), Vector3.RIGHT, 0.065, 0.002, &"rope")
		"food", "drink":
			b.box(&"foil_brown", Vector3(0.1, 0.03, 0.06), 0.008)
		"tool", "weapon", "light":
			_branch(b, r, Vector3(-0.2, 0, 0), Vector3(0.2, 0, 0), 0.014, 0.012, &"wood_handle", &"wood_dark", 0.004)
			b.push(_at(Vector3(0.2, 0, 0)))
			b.box(&"steel_dark", Vector3(0.05, 0.03, 0.05), 0.004)
			b.pop()
		"clothing":
			b.pillow(&"weave_grey", _poly([Vector2(-0.2, -0.15), Vector2(0.2, -0.15), Vector2(0.2, 0.15), Vector2(-0.2, 0.15)]), 0.05)
		"medical":
			b.box(&"plastic_white", Vector3(0.1, 0.04, 0.07), 0.008)
		_:
			b.box(&"weave_khaki", Vector3(0.18, 0.1, 0.12), 0.02, 2)
	return true

extends Node
## Building QA scene (scenes/dev/building_test.tscn): scripted camp in a forest clearing at ~1,480 m on a
## slope — a 3×3 log cabin on stilts (walls, doorway + door, window, gable roof), a lean-to with a fire, a
## drying rack, bed, snow melter, storage box, torch stand, frames in several stages — built through the real
## BuildingRoot / BuildStructure API. Renders with the world's sky (Sky stream) over a dev mountain backdrop.
##
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/b.png --fixed-fps 30 \
##     --quit-after 60 --resolution 1280x720 res://scenes/dev/building_test.tscn -- --shot=exterior
## Shots: exterior (golden hour), interior (night, fire lit), stilts, frames, camp, aerial, closeup, perf200
## Options: --hours=H --weather=W --preset=P --pos=x,y,z --look=yaw,pitch --fov=F --perf --perf_at=N
##          --bare (no backdrop / trees / ground mesh: count only what the buildings cost)
##          --snow=S (global snow cover) --save=abs.jpg (writes the frame at --perf_at and quits)

const GROUND_Y := 1480.0
const PATCH := 90.0
const PATCH_RES := 180

var args := {}
var cam: Camera3D
var frame := 0
var perf_at := 50
var root: BuildingRoot
var cabin: BuildStructure
var _ground_body: StaticBody3D
var _n := FastNoiseLite.new()
var _nb := FastNoiseLite.new()
var _fp := false

const SHOTS := {
	# pos, look (yaw, pitch), hours, fov
	"exterior": [Vector3(-7.8, 1.75, 10.6), Vector2(-36.0, 2.0), 16.55, 62.0],
	"interior": [Vector3(0.35, 1.55, -2.4), Vector2(186.0, -3.0), 22.4, 76.0],
	"stilts": [Vector3(-0.8, 1.6, -5.2), Vector2(-24.0, 13.0), 15.2, 58.0],
	"frames": [Vector3(7.0, 1.7, 13.0), Vector2(-35.5, -9.0), 11.5, 62.0],
	"camp": [Vector3(13.5, 1.9, 4.5), Vector2(38.0, -9.0), 16.7, 64.0],
	"aerial": [Vector3(-16.0, 13.0, 18.0), Vector2(-40.0, -30.0), 15.8, 55.0],
	"closeup": [Vector3(-4.4, 1.5, 5.6), Vector2(-30.0, 4.0), 16.4, 55.0],
	"perf200": [Vector3(-22.0, 6.0, 24.0), Vector2(-40.0, -10.0), 13.0, 70.0],
	# first person with the real Player (build mode UI, ghost, shoulder logs)
	"ui_picker": [Vector3(5.5, 0.0, 12.5), Vector2(20.0, -6.0), 14.5, 75.0],
	"fp_ghost": [Vector3(9.0, 0.0, 2.0), Vector2(-131.0, -16.0), 14.5, 75.0],
}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var shot := String(args.get("shot", "exterior"))
	var spec: Array = SHOTS.get(shot, SHOTS["exterior"])
	perf_at = int(args.get("perf_at", "50"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	var W = load("res://src/world/world.gd")
	_fp = shot.begins_with("ui_") or shot.begins_with("fp_")
	W.dev_no_player = not _fp
	Game.is_new_game = false
	Game.flags.clear()
	Climate.day = 3
	Climate.hours = float(args.get("hours", str(spec[2])))
	Climate.wind_speed = 2.0
	Climate.wind_direction = Vector3(0.8, 0.0, -0.6).normalized()
	Climate.snow_cover = float(args.get("snow", "0.15"))
	var world: Node = (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	Climate.set_weather(StringName(args.get("weather", "clear")), 0.0)
	Climate.locked = true
	var t := world.get_node_or_null("Terrain")
	if t:
		t.visible = false
		if t is CollisionObject3D:
			(t as CollisionObject3D).collision_layer = 0
	root = world.get_node_or_null("Building") as BuildingRoot
	_n.seed = 7
	_n.frequency = 0.045
	_n.fractal_octaves = 3
	_nb.seed = 11
	_nb.frequency = 0.004
	_build_ground()
	if args.has("bare"):
		# perf measurement: only the sky, a collision ground and the buildings
		(get_node("Ground") as Node3D).visible = false
	else:
		_build_backdrop()
	await get_tree().physics_frame
	await get_tree().physics_frame
	if root:
		if shot == "perf200":
			_build_perf_village()
		else:
			_build_camp(shot)
	if _fp:
		_setup_player.call_deferred(shot, spec)
		return
	cam = Camera3D.new()
	cam.fov = float(args.get("fov", str(spec[3])))
	cam.near = 0.05
	cam.far = 12000.0
	add_child(cam)
	var p: Vector3 = spec[0]
	if args.has("pos"):
		var a := String(args["pos"]).split(",")
		p = Vector3(float(a[0]), float(a[1]), float(a[2]))
	var look: Vector2 = spec[1]
	if args.has("look"):
		var l := String(args["look"]).split(",")
		look = Vector2(float(l[0]), float(l[1]))
	cam.global_position = Vector3(p.x, _ground(p.x, p.z) + p.y, p.z) if not args.has("abs") else p
	if shot == "interior" and cabin:
		cam.global_position = cabin.world_of(Vector3(p.x, p.y, p.z))
	cam.rotation_degrees = Vector3(look.y, look.x, 0.0)
	cam.make_current()
	RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)


func _setup_player(shot: String, spec: Array) -> void:
	var p := Game.player as Player
	if p == null:
		return
	Game.state = Game.State.PLAYING
	var at: Vector3 = spec[0]
	var yaw := float((spec[1] as Vector2).x)
	var pos := Vector3(at.x, _ground(at.x, at.z) + 0.05, at.z)
	p.teleport(pos, yaw)
	p.set_look(yaw, float((spec[1] as Vector2).y))
	p.inventory.add(&"hammer", 1)
	p.inventory.add(&"log", 2)
	p.inventory.add(&"stick", 12)
	p.inventory.add(&"stone", 9)
	p.inventory.add(&"rope", 3)
	await get_tree().process_frame
	await get_tree().process_frame
	var bm := root.build_mode as BuildMode if root else null
	if bm == null:
		return
	if shot == "ui_picker":
		bm.open_picker()
	elif shot == "fp_ghost":
		bm.select(&"log_wall")


func _process(_d: float) -> void:
	frame += 1
	if frame == 3:
		var sky := get_tree().get_first_node_in_group(&"sky")
		if sky and sky.has_method(&"snap"):
			sky.call(&"snap")
	if cam:
		RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)
	if frame == perf_at:
		if args.has("perf"):
			print("PERF draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
				" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
				" objects=", Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
				" pieces=", _count_pieces(), " multimeshes=", _count_mm())
		if args.has("save"):
			var img := get_viewport().get_texture().get_image()
			var path := String(args["save"])
			if path.ends_with(".jpg"):
				img.save_jpg(path, 0.9)
			else:
				img.save_png(path)
			print("saved ", path)
			get_tree().quit()


func _count_pieces() -> int:
	var n := 0
	if root:
		for s in root.structures():
			n += s.piece_count()
		n += root.free_objects().size()
	return n


func _count_mm() -> int:
	var n := 0
	if root:
		for s in root.structures():
			n += s.multimesh_count()
	return n


# =============================================================================================== ground

## Clearing on a hillside: flat-ish in front of the cabin, rising ~22° to the north-east under its back.
func _ground(x: float, z: float) -> float:
	var h := GROUND_Y
	var up := clampf((x * 0.35 - z * 0.94 - 3.5) / 7.0, 0.0, 1.8)
	h += up * up * 1.35 + maxf(0.0, (-z - 6.0)) * 0.28
	h += _n.get_noise_2d(x, z) * 0.18 + _nb.get_noise_2d(x, z) * 3.0
	return h


func _build_ground() -> void:
	var n := PATCH_RES
	var step := PATCH / float(n)
	var half := PATCH * 0.5
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var hm := PackedFloat32Array()
	hm.resize((n + 1) * (n + 1))
	for j in n + 1:
		for i in n + 1:
			hm[j * (n + 1) + i] = _ground(-half + i * step, -half + j * step)
	for j in n:
		for i in n:
			var quad := [Vector2i(i, j), Vector2i(i + 1, j), Vector2i(i + 1, j + 1), Vector2i(i, j + 1)]
			for k in [0, 1, 2, 0, 2, 3]:
				var q: Vector2i = quad[k]
				var x := -half + q.x * step
				var z := -half + q.y * step
				var y := hm[q.y * (n + 1) + q.x]
				var nx := hm[q.y * (n + 1) + mini(q.x + 1, n)] - hm[q.y * (n + 1) + maxi(q.x - 1, 0)]
				var nz := hm[mini(q.y + 1, n) * (n + 1) + q.x] - hm[maxi(q.y - 1, 0) * (n + 1) + q.x]
				st.set_normal(Vector3(-nx, 2.0 * step, -nz).normalized())
				st.set_uv(Vector2(x, z))
				st.add_vertex(Vector3(x, y, z))
	st.index()
	var mi := MeshInstance3D.new()
	mi.name = "Ground"
	mi.mesh = st.commit()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/building/dev/qa_ground.gdshader")
	for layer in ["forest", "grass", "dirt"]:
		for kind in ["albedo", "normal"]:
			var p := "res://assets/textures/terrain/%s_%s.png" % [layer, kind]
			if ResourceLoader.exists(p):
				mat.set_shader_parameter(StringName("%s_%s" % [layer, kind]), load(p))
	mi.material_override = mat
	add_child(mi)
	_ground_body = StaticBody3D.new()
	_ground_body.collision_layer = 1
	var cs := CollisionShape3D.new()
	var hs := HeightMapShape3D.new()
	hs.map_width = n + 1
	hs.map_depth = n + 1
	hs.map_data = hm
	cs.shape = hs
	cs.scale = Vector3(step, 1.0, step)
	_ground_body.add_child(cs)
	add_child(_ground_body)


func _build_backdrop() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 160
	var size := 16000.0
	for j in n:
		for i in n:
			for k in [Vector2i(0, 0), Vector2i(1, 0), Vector2i(1, 1), Vector2i(0, 0), Vector2i(1, 1), Vector2i(0, 1)]:
				var u := float(i + k.x) / n * 2.0 - 1.0
				var v := float(j + k.y) / n * 2.0 - 1.0
				var x := signf(u) * pow(absf(u), 1.7) * size * 0.5
				var z := signf(v) * pow(absf(v), 1.7) * size * 0.5
				var y := _far_h(x, z)
				var e := 6.0
				var nrm := Vector3(_far_h(x - e, z) - _far_h(x + e, z), 2.0 * e, _far_h(x, z - e) - _far_h(x, z + e)).normalized()
				st.set_normal(nrm)
				st.add_vertex(Vector3(x, y, z))
	var mi := MeshInstance3D.new()
	mi.name = "Backdrop"
	mi.mesh = st.commit()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/dev/sky_test_terrain.gdshader")
	mi.material_override = mat
	add_child(mi)
	_trees()


var _nr := FastNoiseLite.new()


func _far_h(x: float, z: float) -> float:
	_nr.seed = 1234
	_nr.frequency = 0.00025
	_nr.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_nr.fractal_octaves = 5
	# A broad bench above the valley: open to the low autumn sun in the south-west, the range to the north/east.
	var r := Vector2(x, z).length()
	var north := clampf((-z * 0.8 + x * 0.35) / maxf(r, 1.0) + 0.35, 0.0, 1.0)
	var valley := smoothstep(900.0, 6500.0, r) * (0.25 + 0.75 * north)
	var ridge := _nr.get_noise_2d(x, z) * 0.5 + 0.5
	var h := GROUND_Y - 4.0 + valley * (700.0 + 2000.0 * ridge * ridge) - (1.0 - north) * smoothstep(300.0, 2500.0, r) * 180.0
	var s := Vector2(x - 900.0, z + 6200.0).length()
	h += 1500.0 * exp(-s * s / (2600.0 * 2600.0))
	# blend into the local patch (sunk a little so it never pokes through)
	var inner := 1.0 - smoothstep(PATCH * 0.42, PATCH * 0.5, maxf(absf(x), absf(z)))
	return lerpf(h, _ground(x, z) - 1.5, inner) if inner > 0.0 else h


func _trees() -> void:
	var mesh := load("res://src/building/dev/qa_trees.gd").call(&"conifer") as Mesh
	if mesh == null:
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var xf: Array[Transform3D] = []
	var tries := 0
	while xf.size() < 1100 and tries < 40000:
		tries += 1
		var r := 20.0 + pow(rng.randf(), 1.3) * 1800.0
		var a := rng.randf() * TAU
		var x := cos(a) * r
		var z := sin(a) * r
		# keep the view from the camp toward the south-west open (a meadow)
		if r < 300.0 and absf(wrapf(a - atan2(12.0, -9.0), -PI, PI)) < 0.55:
			continue
		var y := _far_h(x, z)
		if y > 1950.0:
			continue
		var s := rng.randf_range(0.75, 1.3)
		xf.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.9, 1.25), s)), Vector3(x, y - 0.3, z)))
	mm.instance_count = xf.size()
	for i in xf.size():
		mm.set_instance_transform(i, xf[i])
		mm.set_instance_color(i, Color(rng.randf_range(0.85, 1.1), rng.randf_range(0.85, 1.1), rng.randf_range(0.85, 1.1)))
	mm.mesh = mesh
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)


# =============================================================================================== camp

func _cabin_origin() -> Transform3D:
	var yaw := deg_to_rad(12.0)
	var b := Basis(Vector3.UP, yaw)
	var ground: PackedFloat32Array = []
	for c in [Vector2(-3, -3), Vector2(3, -3), Vector2(-3, 3), Vector2(3, 3), Vector2(0, 0)]:
		var w := b * Vector3(c.x, 0.0, c.y)
		ground.append(BuildingRoot.ground_height(w.x, w.z))
	var y := BuildGrid.foundation_height(ground)
	return Transform3D(b, Vector3(0.0, y, 0.0))


func _build_camp(shot: String) -> void:
	cabin = root.new_structure(_cabin_origin())
	var s := cabin
	for i in [-2, 0, 2]:
		for k in [-2, 0, 2]:
			s.add_piece(&"log_foundation", Vector3i(i, 0, k), {}, true)
	for i in [-2, 0, 2]:
		s.add_piece(&"log_doorway" if i == 0 else &"log_wall", Vector3i(i, 0, 3), {}, true)
		s.add_piece(&"log_wall", Vector3i(i, 0, -3), {}, true)
		s.add_piece(&"log_window_wall" if i == 0 else &"log_wall", Vector3i(3, 0, i), {}, true)
		s.add_piece(&"log_window_wall" if i == 2 else &"log_wall", Vector3i(-3, 0, i), {}, true)
	var door := s.add_piece(&"door", Vector3i(0, 0, 3), {"flip": false}, true) as BuildDoor
	for i in [-2, 0, 2]:
		s.add_piece(&"log_roof", Vector3i(i, 0, -2), {"dir": 1, "tier": 0, "shape": "slope"}, true)
		s.add_piece(&"log_roof", Vector3i(i, 0, 2), {"dir": 3, "tier": 0, "shape": "slope"}, true)
	for i in [-2, 0, 2]:
		s.add_piece(&"log_roof", Vector3i(i, 0, 0), s.roof_props_for(Vector3i(i, 0, 0), 1), true)
	if shot == "interior" or shot == "camp":
		door.set_open(true, true)
	s.flush_now()
	# camp pieces (when their scenes exist)
	var place := func(id: StringName, local: Vector3, yaw_deg: float, on_cabin := false) -> Node3D:
		var wp := cabin.world_of(local) if on_cabin else local
		if not on_cabin:
			wp.y = BuildingRoot.ground_height(wp.x, wp.z)
		var yaw := deg_to_rad(yaw_deg) + (cabin.rotation.y if on_cabin else 0.0)
		if BuildCatalog.scene_of(id) == null:
			return null
		return root.place_free(id, Transform3D(Basis(Vector3.UP, yaw), wp), true)
	place.call(&"bed", Vector3(-2.35, 0.0, -1.2), 90.0, true)
	place.call(&"storage_box", Vector3(1.6, 0.0, -2.35), 0.0, true)
	var torch := place.call(&"torch_stand", Vector3(2.3, 0.0, 2.2), 0.0, true) as Node3D
	if torch and torch.has_method(&"set_lit"):
		torch.set(&"always_simulate", true)
		torch.call(&"set_lit", true, true)
	var fire := place.call(&"stone_fire_pit", cabin.world_of(Vector3(-0.1, 0.0, 6.2)), 0.0) as Node3D
	if fire and fire.has_method(&"add_fuel"):
		fire.set(&"always_simulate", true)
		fire.set(&"fuel_minutes", 180.0)
		fire.set(&"has_kindling", true)
		if fire.has_method(&"_set_state"):
			fire.call(&"_set_state", 1)
		fire.set(&"intensity", 1.0)
	# the old camp east of the cabin: lean-to facing its fire, windbreak on the weather side, bough bed inside
	place.call(&"lean_to", cabin.world_of(Vector3(9.2, 0.0, -1.5)), -78.0)
	var fire2 := place.call(&"campfire", cabin.world_of(Vector3(6.6, 0.0, -1.2)), 0.0) as Node3D
	if fire2:
		fire2.set(&"always_simulate", true)
		fire2.set(&"fuel_minutes", 150.0)
		fire2.set(&"has_kindling", true)
		fire2.call(&"_set_state", 1)
		fire2.set(&"intensity", 1.0)
	place.call(&"bough_bed", cabin.world_of(Vector3(9.5, 0.0, -1.5)), -78.0)
	place.call(&"stone_windbreak", cabin.world_of(Vector3(8.6, 0.0, -4.4)), 12.0)
	var rack := place.call(&"drying_rack", cabin.world_of(Vector3(4.2, 0.0, 5.2)), -35.0) as Node3D
	var melter := place.call(&"snow_melter", cabin.world_of(Vector3(1.7, 0.0, 6.9)), 20.0) as Node3D
	var stock := Inventory.new(20, 999.0)
	stock.add(&"meat_raw", 5)
	stock.add(&"hide_raw", 1)
	stock.add(&"snow", 9)
	if rack and rack.has_method(&"hang"):
		for _i in 5:
			rack.call(&"hang", &"meat_raw", stock)
		rack.call(&"hang", &"hide_raw", stock)
		var m: Array = rack.get(&"meat")
		for k in m.size():
			m[k]["t"] = 1.5 * k
		rack.call(&"_update_visuals")
	if melter and melter.has_method(&"add_snow"):
		melter.call(&"add_snow", stock)
	place.call(&"workbench", cabin.world_of(Vector3(-4.6, 0.0, 1.8)), 90.0)
	# an elevated food cache on stilts up the slope (bears can't reach it): tall posts, braces, a ladder
	var cpos := Vector3(3.0, 0.0, -11.5)
	var cb := Basis(Vector3.UP, deg_to_rad(-8.0))
	var cg: PackedFloat32Array = []
	for o: Vector3 in [Vector3(-1, 0, -1), Vector3(1, 0, -1), Vector3(-1, 0, 1), Vector3(1, 0, 1), Vector3.ZERO]:
		var w := cpos + cb * o
		cg.append(BuildingRoot.ground_height(w.x, w.z))
	var cache := root.new_structure(Transform3D(cb, Vector3(cpos.x, BuildGrid.foundation_height(cg) + 1.6, cpos.z)))
	cache.add_piece(&"log_foundation", Vector3i(0, 0, 0), {}, true)
	cache.add_piece(&"log_doorway", Vector3i(0, 0, 1), {}, true)
	cache.add_piece(&"door", Vector3i(0, 0, 1), {"flip": false}, true)
	cache.add_piece(&"log_wall", Vector3i(0, 0, -1), {}, true)
	cache.add_piece(&"log_wall", Vector3i(1, 0, 0), {}, true)
	cache.add_piece(&"log_wall", Vector3i(-1, 0, 0), {}, true)
	cache.add_piece(&"log_roof", Vector3i(0, 0, 0), {"dir": 0, "tier": 0, "shape": "peak"}, true)
	cache.flush_now()
	var lad_at := cache.world_of(Vector3(0.0, 0.0, 1.25))
	root.place_free(&"rope_ladder", Transform3D(cb * Basis(Vector3.UP, PI), lad_at), true)
	# a second, unfinished structure: frames at several stages
	var f := root.new_structure(Transform3D(Basis(Vector3.UP, deg_to_rad(12.0)), cabin.world_of(Vector3(11.0, 0.0, 8.0))))
	f.global_position.y = BuildGrid.foundation_height(PackedFloat32Array([BuildingRoot.ground_height(f.global_position.x - 1, f.global_position.z - 1),
		BuildingRoot.ground_height(f.global_position.x + 1, f.global_position.z + 1), BuildingRoot.ground_height(f.global_position.x + 1, f.global_position.z - 1),
		BuildingRoot.ground_height(f.global_position.x - 1, f.global_position.z + 1)]))
	f.add_piece(&"log_foundation", Vector3i(0, 0, 0), {}, true)
	f.add_piece(&"log_foundation", Vector3i(2, 0, 0), {}, true)
	var inv := Inventory.new(40, 999.0)
	var stages := [[Vector3i(0, 0, 1), 3], [Vector3i(2, 0, 1), 1], [Vector3i(-1, 0, 0), 2], [Vector3i(3, 0, 0), 0]]
	for st in stages:
		var w := f.add_piece(&"log_wall", st[0], {}, false)
		inv.add(&"log", int(st[1]))
		for _i in int(st[1]):
			w.build.add_one(inv, true)
	f.flush_now()


func _build_perf_village() -> void:
	# 200+ completed pieces in 4 cabins: MultiMesh batching check.
	for c in 4:
		var origin := Vector3(-8.0 + (c % 2) * 14.0, 0.0, -8.0 + (c / 2) * 14.0)
		var s := root.new_structure(Transform3D(Basis.IDENTITY, Vector3(origin.x, BuildingRoot.ground_height(origin.x, origin.z) + 1.4, origin.z)))
		for i in [-2, 0, 2]:
			for k in [-2, 0, 2]:
				s.add_piece(&"log_foundation", Vector3i(i, 0, k), {}, true)
		for lvl in 2:
			for i in [-2, 0, 2]:
				s.add_piece(&"log_wall", Vector3i(i, lvl, 3), {}, true)
				s.add_piece(&"log_wall", Vector3i(i, lvl, -3), {}, true)
				s.add_piece(&"log_window_wall", Vector3i(3, lvl, i), {}, true)
				s.add_piece(&"log_wall", Vector3i(-3, lvl, i), {}, true)
		for i in [-2, 0, 2]:
			for k in [-2, 0, 2]:
				s.add_piece(&"log_floor", Vector3i(i, 1, k), {}, true)
		for i in [-2, 0, 2]:
			s.add_piece(&"log_roof", Vector3i(i, 1, -2), {"dir": 1, "tier": 0, "shape": "slope"}, true)
			s.add_piece(&"log_roof", Vector3i(i, 1, 2), {"dir": 3, "tier": 0, "shape": "slope"}, true)
			s.add_piece(&"log_roof", Vector3i(i, 1, 0), {"dir": 1, "tier": 1, "shape": "peak"}, true)
		s.flush_now()

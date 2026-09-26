extends Node
## Fauna QA stage (dev only): the real world (terrain, sky, vegetation) without the player; population off; animals
## placed on an open, level meadow found near --center. Lineups, single-animal close-ups, clips, pack simulation.
##
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/f.png --fixed-fps 30 \
##     --quit-after 24 --resolution 960x540 res://scenes/dev/fauna_test.tscn -- --mode=single --species=wolf --dist=5
## Modes:
##   --mode=single  --species=wolf --clip=idle|walk|trot|gallop|stalk|howl|snarl|... [--t=seconds into clip]
##   --mode=lineup  --species=wolf,deer,bear,goat,hare [--clips=idle,trot,...] [--spacing=m]
##   --mode=pack    a wolf pack vs a stand-in target at --dist; prints the pack mode/states every second
##                  [--frames=N] [--torch] (a burning torch at the target) [--timescale=k]
##   --mode=birds   ravens circling a wolf carcass, eagle overhead
## Camera: --dist=m (to the subject) --az=deg (camera bearing around the subject) --height=m --fov=deg
## Light: --hours=H --weather=W --preset=P ; --perf prints draw calls / primitives at --perf_at.
## --center=x,z search centre for the meadow (default: south of the crash site).

var args := {}
var cam: Camera3D
var fauna: FaunaManager
var frame := 0
var perf_at := 20
var site := Vector3.ZERO
var subjects: Array[Animal] = []
var target: Node3D = null
var _print_t := 0.0
var _mode := "single"


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	perf_at = int(args.get("perf_at", "20"))
	if args.has("res"):
		var r := String(args["res"]).split("x")
		get_window().size = Vector2i(int(r[0]), int(r[1]))
	_mode = String(args.get("mode", "single"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	FaunaManager.spawning_enabled = false
	var W = load("res://src/world/world.gd")
	W.dev_no_player = true
	Game.is_new_game = false
	Climate.hours = float(args.get("hours", "10.5"))
	Climate.wind_speed = 3.0
	var world: Node = (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	Climate.set_weather(StringName(args.get("weather", "clear")), 0.0)
	Climate.locked = true
	fauna = world.get_node_or_null("Fauna") as FaunaManager
	cam = Camera3D.new()
	cam.fov = float(args.get("fov", "55"))
	cam.near = 0.05
	cam.far = 6000.0
	add_child(cam)
	cam.make_current()
	var c := String(args.get("center", "-470,905")).split(",")
	site = _find_site(Vector2(float(c[0]), float(c[1])))
	print("FAUNA_TEST site ", site, " biome ", TerrainData.get_biome(site.x, site.z))
	await get_tree().physics_frame
	await get_tree().physics_frame
	if fauna == null:
		push_error("fauna_test: no Fauna part")
		return
	match _mode:
		"lineup":
			_lineup()
		"pack":
			_pack()
		"birds":
			_birds()
		_:
			_single()
	RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)


func _find_site(c: Vector2) -> Vector3:
	var best := Vector3(c.x, TerrainData.get_height(c.x, c.y), c.y)
	var bs := INF
	for j in 21:
		for i in 21:
			var x := c.x + (i - 10) * 10.0
			var z := c.y + (j - 10) * 10.0
			var s := 0.0
			for k in 5:
				var ox := [0.0, 8.0, -8.0, 0.0, 0.0][k] as float
				var oz := [0.0, 0.0, 0.0, 8.0, -8.0][k] as float
				s += TerrainData.get_slope_deg(x + ox, z + oz) + 60.0 * TerrainData.get_masks(x + ox, z + oz).a
				if TerrainData.get_water_level(x + ox, z + oz) > -1e20:
					s += 500.0
			if s < bs:
				bs = s
				best = Vector3(x, TerrainData.get_height(x, z), z)
	return best


func _species() -> PackedStringArray:
	return String(args.get("species", "wolf")).split(",")


func _place_cam(subject: Vector3, dist: float, az_deg: float, h: float, look_h: float) -> void:
	var az := deg_to_rad(az_deg)
	var p := subject + Vector3(sin(az), 0.0, cos(az)) * dist
	p.y = maxf(TerrainData.get_height(p.x, p.z), subject.y - 0.5) + h
	cam.global_position = p
	cam.look_at(subject + Vector3(0.0, look_h, 0.0), Vector3.UP)


func _single() -> void:
	var sp := StringName(_species()[0])
	var az := float(args.get("az", "35"))
	var yaw := deg_to_rad(az + 90.0 + float(args.get("turn", "-25")))
	var a := fauna.spawn_animal(sp, site, yaw, 11)
	if a == null:
		push_error("fauna_test: no species " + String(sp))
		return
	subjects.append(a)
	a.debug_clip(StringName(args.get("clip", "idle")), float(args.get("t", "0.4")))
	var d := float(args.get("dist", "5"))
	var hgt := float(a.def.load_meta().get("height", 0.9))
	_place_cam(a.global_position, d, az, float(args.get("height", "1.55")), hgt * 0.55)


func _lineup() -> void:
	var sps := _species()
	var clips := String(args.get("clips", "")).split(",", false)
	var az := float(args.get("az", "0"))
	var side := Vector3(cos(deg_to_rad(az)), 0.0, -sin(deg_to_rad(az)))
	var total := 0.0
	var widths: Array[float] = []
	for s in sps:
		var d: SpeciesDef = fauna.defs.get(StringName(s))
		var w := float(d.load_meta().get("length", 1.5)) if d else 1.5
		widths.append(w + float(args.get("spacing", "0.6")))
		total += widths[-1]
	var x := -total * 0.5
	var hmax := 0.5
	for i in sps.size():
		x += widths[i] * 0.5
		var p := site + side * x
		p.y = TerrainData.get_height(p.x, p.z)
		var a := fauna.spawn_animal(StringName(sps[i]), p, deg_to_rad(az + 90.0 + float(args.get("turn", "-20"))), 20 + i)
		x += widths[i] * 0.5
		if a == null:
			continue
		subjects.append(a)
		a.debug_clip(StringName(clips[i % clips.size()]) if not clips.is_empty() else &"idle", 0.3 + 0.37 * i)
		hmax = maxf(hmax, float(a.def.load_meta().get("height", 0.9)))
	_place_cam(site, float(args.get("dist", "8")), az, float(args.get("height", "1.6")), hmax * 0.5)


func _pack() -> void:
	target = Node3D.new()
	target.name = "Target"
	add_child(target)
	target.global_position = site
	fauna.debug_target = target
	if args.has("torch"):
		var t := Node3D.new()
		t.set_script(load("res://src/dev/fauna_test_fire.gd"))
		target.add_child(t)
		t.position = Vector3(0.4, 1.2, 0.0)
	var d := float(args.get("dist", "90"))
	var p := site + Vector3(d, 0.0, 0.0)
	p.y = TerrainData.get_height(p.x, p.z)
	var pack := fauna.spawn_pack(p, int(args.get("count", "3")))
	for w in pack.get(&"members"):
		(w as Animal).awareness = float(args.get("aware", "0.5"))
		(w as Animal).last_known = site
	Engine.time_scale = float(args.get("timescale", "1"))
	_place_cam(site + Vector3(d * 0.5, 0.0, 0.0), d * 0.9, 180.0, d * 0.6, 0.0)


func _birds() -> void:
	var a := fauna.spawn_animal(&"wolf", site, 0.3, 5)
	if a:
		a.die(&"test")
		subjects.append(a)
	var b := fauna.get_node_or_null("Birds")
	if b:
		b.call(&"force_ravens", site)
		b.call(&"force_eagle", site + Vector3(60.0, 0.0, -40.0))
	_place_cam(site, 14.0, 20.0, 1.6, 12.0)


func _physics_process(delta: float) -> void:
	frame += 1
	if _mode == "pack" and fauna and not fauna.packs.is_empty():
		_print_t -= delta
		if _print_t <= 0.0:
			_print_t = 1.0
			var pk: RefCounted = fauna.packs[0]
			var s := "PACK t=%.0f mode=%s morale=%.2f courage=%.2f aware=%.2f |" % [fauna.now, pk.call(&"mode_name"),
				float(pk.get(&"morale")), float(pk.get(&"courage")), float(pk.get(&"awareness"))]
			for w in pk.get(&"members"):
				var a := w as Animal
				s += " %s d=%.0f v=%.1f %s;" % [Animal.State.keys()[a.state], a.dist_to_player, a.speed, a.current_clip()]
			print(s)
		if frame >= int(args.get("frames", "999999")):
			get_tree().quit()
	if args.has("perf") and frame == perf_at:
		print("PERF draw_calls=%d primitives=%d fps=%.1f animals=%d shells=%d" % [
			Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			Performance.get_monitor(Performance.TIME_FPS), fauna.animals.size() if fauna else 0,
			subjects[0].shell_count() if not subjects.is_empty() else 0])
		for s in subjects:
			var aabb := s.mesh.global_transform * s.mesh.get_aabb() if s.mesh else AABB()
			print("SUBJECT %s pos=%s visible=%s mesh_aabb=%s clip=%s" % [s.def.id, s.global_position, s.is_visible_in_tree(),
				aabb, s.current_clip()])

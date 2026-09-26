extends Node
## Story-location QA (scenes/dev/poi_test.tscn): loads the real world (sky, terrain, vegetation) without the
## player; scenes/poi/structures.tscn places every location on its flat pad (interiors at y 800) and a camera
## frames one of them from a preset shot (site-local, so shots follow the placement yaw).
##
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/p.png --fixed-fps 30 \
##     --quit-after 40 --resolution 1280x720 res://scenes/dev/poi_test.tscn -- --site=crash_site --shot=hero
## Options: --site=<scene id> --shot=<name> (see SHOTS)  --cam=x,y,z (site-local, Godot axes)  --look=yaw,pitch
##          (deg, relative to the site's yaw; 0 = site north)  --hours=H --weather=W --preset=P --fov=F
##          --lights=1 (site interior lights on)  --snow=S  --perf --perf_at=N  --save=abs.jpg (frame at perf_at, quit)
##          --all (instance every location, not only --site)  --list (print the sockets of the site)  --torch=E (a hand torch on the camera, energy E)
##          --batch=site:shot,site:shot,...  --outdir=/abs/dir  (one world load, every shot saved as <site>_<shot>.jpg)

const SHOTS := {
	# site -> shot -> [cam (site-local x, y above ground, z) | socket name, look (yaw, pitch), hours, fov, lights,
	#                  (socket shots) offset in the socket's frame (x right, y up, -z forward)]
	&"crash_site": {
		"hero": [Vector3(-7.5, 1.6, 7.0), Vector2(-48.0, -5.0), 16.3, 55.0, false],
		"wide": [Vector3(-12.5, 1.7, 9.0), Vector2(-62.0, -4.0), 16.9, 58.0, false],
		"trail": [Vector3(22.0, 2.4, 20.0), Vector2(55.0, -6.0), 16.6, 60.0, false],
		"cabin": ["Arrive_Wake", Vector2(0.0, -6.0), 16.9, 75.0, false, Vector3(0.1, 1.5, 1.2)],
		"cockpit": ["Arrive_Wake", Vector2(-4.0, -12.0), 16.9, 70.0, false, Vector3(0.15, 1.45, -0.7)],
		"nose": [Vector3(-7.0, 1.4, 0.1), Vector2(-83.0, -2.0), 15.6, 55.0, false],
		"aerial": [Vector3(-20.0, 16.0, 18.0), Vector2(-45.0, -32.0), 15.5, 55.0, false],
	},
	&"kestrel_station": {
		"hero": [Vector3(22.0, 3.0, 22.0), Vector2(45.0, -4.0), 16.6, 60.0, false],
		"shedside": [Vector3(14.0, 2.0, 30.0), Vector2(25.0, -1.0), 16.9, 58.0, false],
		"pad": [Vector3(-24.0, 2.2, 27.0), Vector2(-38.0, -2.0), 17.1, 60.0, false],
		"night": [Vector3(-14.0, 2.0, 20.0), Vector2(-30.0, 0.0), 21.5, 60.0, true],
		"galley": [Vector3(0.6, 3.45, 3.9), Vector2(8.0, -10.0), 13.0, 78.0, true],
		"comms": [Vector3(-1.2, 3.45, -1.5), Vector2(-25.0, -12.0), 13.0, 78.0, true],
		"lab": [Vector3(-10.2, 3.45, 5.0), Vector2(0.0, -10.0), 13.0, 78.0, true],
		"bunks": [Vector3(9.9, 3.45, -4.8), Vector2(180.0, -12.0), 22.0, 78.0, false],
		"shed": [Vector3(10.2, 1.9, 13.6), Vector2(160.0, -14.0), 13.0, 78.0, true],
		"helipad": [Vector3(-8.0, 6.0, 30.0), Vector2(55.0, -14.0), 9.0, 60.0, false],
	},
	&"ranger_cabin": {
		"hero": [Vector3(-7.0, 1.7, 9.0), Vector2(-36.0, 2.0), 16.4, 60.0, false],
		"interior": [Vector3(1.8, 1.62, 1.2), Vector2(46.0, -8.0), 20.5, 78.0, true],
		"lake": [Vector3(-3.0, 1.7, 38.0), Vector2(-4.5, 1.0), 16.8, 55.0, false],
	},
	&"ashford_mine": {
		"hero": [Vector3(-18.0, 1.8, 6.0), Vector2(57.0, 5.0), 15.4, 62.0, false],
		"camp": [Vector3(22.0, 1.8, 2.0), Vector2(84.0, 4.0), 15.8, 62.0, false],
		"portal": [Vector3(-28.0, 1.7, -3.0), Vector2(71.0, 4.0), 15.0, 62.0, false],
		"bunkhouse": [Vector3(-4.0, 1.8, 22.0), Vector2(45.0, -8.0), 15.5, 62.0, false],
	},
	&"summit_relay": {
		"hero": [Vector3(-3.0, 1.7, -11.0), Vector2(-160.0, 12.0), 16.9, 60.0, false],
	},
	&"owens_bivouac": {
		"hero": [Vector3(4.0, 1.6, 5.0), Vector2(34.0, -8.0), 16.5, 60.0, false],
	},
	&"glacier_camp": {
		"hero": [Vector3(6.0, 1.7, 8.0), Vector2(37.0, -6.0), 16.4, 60.0, false],
	},
	&"fire_lookout": {
		"hero": [Vector3(-12.0, 1.7, -4.0), Vector2(-108.0, 16.0), 16.6, 62.0, false],
		"cab": [Vector3(1.5, 13.7, 1.5), Vector2(45.0, -16.0), 16.6, 78.0, false],
	},
	&"trapper_cabin": {
		"hero": [Vector3(4.0, 1.7, 5.0), Vector2(39.0, -6.0), 16.2, 60.0, false],
	},
	&"ice_cave": {
		"passage": [Vector3(0.0, 1.6, -2.0), Vector2(0.0, 0.0), 13.0, 75.0, false],
		"chamber": [Vector3(2.0, 2.6, -36.0), Vector2(-14.0, -8.0), 13.0, 78.0, false],
	},
	&"ice_cave_entrance": {
		"hero": [Vector3(2.0, 1.7, 12.0), Vector2(11.0, 3.0), 14.5, 60.0, false],
	},
	&"ashford_mine_interior": {
		"adit": [Vector3(-2.0, 1.6, 0.0), Vector2(90.0, -3.0), 12.0, 75.0, false],
		"depot": [Vector3(-30.6, 1.6, 9.5), Vector2(180.0, -12.0), 12.0, 78.0, false],
		"stope": [Vector3(-70.0, 1.6, -9.0), Vector2(70.0, 8.0), 12.0, 80.0, false],
	},
}

var args := {}
var cam: Camera3D
var torch: SpotLight3D
var frame := 0
var perf_at := 30
var site: Node3D
var jobs: Array = []        # [site_id, shot]
var job := -1
var structures: Node


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	perf_at = int(args.get("perf_at", "30"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	if args.has("batch"):
		for j in String(args["batch"]).split(",", false):
			var p := j.split(":")
			jobs.append([StringName(p[0]), p[1] if p.size() > 1 else "hero"])
	else:
		jobs.append([StringName(args.get("site", "crash_site")), String(args.get("shot", "hero"))])
	var W = load("res://src/world/world.gd")
	W.dev_no_player = true
	if not args.has("all"):
		var S = load("res://scenes/poi/structures.gd")
		var ids: Array[StringName] = []
		for jb in jobs:
			if not ids.has(jb[0]):
				ids.append(jb[0])
		S.only_ids = ids
	Game.is_new_game = false
	Game.flags.clear()
	Climate.day = 3
	Climate.wind_speed = 3.0
	Climate.wind_direction = Vector3(0.8, 0.0, -0.6).normalized()
	if args.has("snow"):
		Climate.set(&"snow_cover", float(args["snow"]))
	Climate.hours = 12.0
	var world: Node = (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	Climate.set_weather(StringName(args.get("weather", "clear")), 0.0)
	Climate.locked = true
	structures = world.get_node_or_null(^"Structures")
	cam = Camera3D.new()
	cam.near = 0.05
	cam.far = float(Settings.get_value(&"view_distance", 4000.0))
	add_child(cam)
	cam.make_current()
	if args.has("torch"):
		torch = SpotLight3D.new()
		torch.light_energy = float(args["torch"])
		torch.spot_range = 25.0
		torch.spot_angle = 32.0
		torch.light_color = Color(1.0, 0.9, 0.78)
		torch.shadow_enabled = true
		torch.position = Vector3(0.25, -0.2, 0.0)
		cam.add_child(torch)
		torch.add_to_group(&"local_light")
	_next_job()


func _next_job() -> void:
	job += 1
	frame = 0
	if job >= jobs.size():
		get_tree().quit()
		return
	var site_id: StringName = jobs[job][0]
	var shots: Dictionary = SHOTS.get(site_id, {})
	var spec: Array = shots.get(jobs[job][1], [Vector3(0, 1.7, 12), Vector2(0, -5), 15.0, 60.0, false])
	Climate.hours = float(args.get("hours", str(spec[2])))
	site = null
	if structures and structures.has_method(&"get_site"):
		site = structures.call(&"get_site", site_id)
	if site == null:
		push_error("poi_test: site %s not placed" % site_id)
		_next_job()
		return
	for s in (structures.get(&"sites") as Dictionary).values():
		if s.has_method(&"set_interior_lights"):
			var on := args.has("lights") or bool(spec[4])
			s.call(&"set_interior_lights", on if s == site else bool(s.get(&"interior_lights_on")))
	if args.has("list") and site.has_method(&"get_sockets"):
		for m: Marker3D in site.call(&"get_sockets", ""):
			print("SOCKET ", m.name, " ", m.global_position)
	var socket_shot := spec[0] is String
	var local: Vector3 = spec[0] if not socket_shot else Vector3.ZERO
	if args.has("cam"):
		var c := String(args["cam"]).split(",")
		local = Vector3(float(c[0]), float(c[1]), float(c[2]))
	var look: Vector2 = spec[1]
	if args.has("look"):
		var l := String(args["look"]).split(",")
		look = Vector2(float(l[0]), float(l[1]))
	cam.fov = float(args.get("fov", str(spec[3])))
	var xf := site.global_transform
	if socket_shot and not args.has("cam"):
		var m := site.call(&"get_socket", String(spec[0])) as Marker3D
		var off: Vector3 = spec[5] if spec.size() > 5 else Vector3(0, 1.55, 0)
		var myaw := m.global_rotation.y
		cam.global_position = m.global_position + Basis(Vector3.UP, myaw) * off
		cam.rotation_degrees = Vector3(look.y, rad_to_deg(myaw) + look.x, 0.0)
	else:
		var wp := xf * Vector3(local.x, 0.0, local.z)
		var interior := bool(site.get(&"interior"))
		var gy := xf.origin.y if interior else TerrainData.get_height(wp.x, wp.z)
		cam.global_position = Vector3(wp.x, gy + local.y, wp.z)
		var site_yaw := rad_to_deg(xf.basis.get_euler().y)
		cam.rotation_degrees = Vector3(look.y, site_yaw + look.x, 0.0)


func _process(_d: float) -> void:
	frame += 1
	if frame == 3 or frame == perf_at - 4:
		var sky := get_tree().get_first_node_in_group(&"sky")
		if sky and sky.has_method(&"snap"):
			sky.call(&"snap")
	if cam:
		RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)
	if frame == perf_at and job < jobs.size():
		if args.has("perf"):
			print("PERF ", jobs[job][0], ":", jobs[job][1], " draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
				" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
				" objects=", Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
				" vram_mb=", snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1))
		var path := String(args.get("save", ""))
		if args.has("outdir"):
			path = String(args["outdir"]).path_join("%s_%s.jpg" % [jobs[job][0], jobs[job][1]])
		if path != "":
			var img := get_viewport().get_texture().get_image()
			if path.ends_with(".jpg"):
				img.save_jpg(path, 0.9)
			else:
				img.save_png(path)
			print("saved ", path)
		if path != "" or args.has("batch"):
			_next_job()

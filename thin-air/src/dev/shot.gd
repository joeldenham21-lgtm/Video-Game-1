extends Node
## Dev screenshot/perf harness. Loads the world without the player (or with --player) and frames a camera.
## Usage (see CONTRACT.md §0):
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/s.png \
##     --fixed-fps 30 --quit-after 90 --resolution 1280x720 res://scenes/dev/shot.tscn -- \
##     --poi=crash_site --look=30,-5 --hours=8.5 --weather=clear --preset=high --perf
## Options: --pos=x,y,z (y may be "g" = ground+1.7)  --poi=<id>  --look=yaw,pitch (deg, yaw 0 = north/-Z,
## 90 = west)  --hours=H  --weather=W  --preset=P  --fov=F  --player  --perf  --perf_at=N  --height=H (above ground)

var args := {}
var cam: Camera3D
var frame := 0
var perf_at := 60


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	perf_at = int(args.get("perf_at", "60"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	var player_mode := args.has("player")
	var W = load("res://src/world/world.gd")
	W.dev_no_player = not player_mode
	Game.is_new_game = false
	Climate.hours = float(args.get("hours", "10.0"))
	var world: Node = (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	if args.has("weather") and Climate.has_method("set_weather"):
		Climate.set_weather(StringName(args["weather"]), 0.0)
	Climate.locked = true
	if player_mode:
		return
	cam = Camera3D.new()
	cam.fov = float(args.get("fov", "70"))
	cam.far = float(Settings.get_value(&"view_distance", 4000.0))
	cam.near = 0.1
	add_child(cam)
	var pos := Vector3.ZERO
	if args.has("poi"):
		var poi: Dictionary = TerrainData.get_poi(StringName(args["poi"]))
		if not poi.is_empty():
			pos = poi["position"]
		pos.y = TerrainData.get_height(pos.x, pos.z) + float(args.get("height", "1.7"))
	if args.has("pos"):
		var p := String(args["pos"]).split(",")
		pos.x = float(p[0]); pos.z = float(p[2])
		pos.y = TerrainData.get_height(pos.x, pos.z) + float(args.get("height", "1.7")) if p[1] == "g" else float(p[1])
	cam.global_position = pos
	var look := String(args.get("look", "0,0")).split(",")
	cam.rotation_degrees = Vector3(float(look[1]) if look.size() > 1 else 0.0, float(look[0]), 0.0)
	cam.make_current()
	RenderingServer.global_shader_parameter_set(&"player_position", pos)


func _process(_d: float) -> void:
	frame += 1
	if cam:
		RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)
	if args.has("perf") and frame == perf_at:
		print("PERF draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			" objects=", Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
			" vram_mb=", snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1),
			" static_mem_mb=", snappedf(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, 0.1),
			" nodes=", Performance.get_monitor(Performance.OBJECT_NODE_COUNT))

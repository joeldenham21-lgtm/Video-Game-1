extends Node
## Dev screenshot/perf harness. Loads the world without the player (or with --player) and frames a camera.
## Usage (see CONTRACT.md §0):
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/s.png \
##     --fixed-fps 30 --quit-after 90 --resolution 1280x720 res://scenes/dev/shot.tscn -- \
##     --poi=crash_site --look=30,-5 --hours=8.5 --weather=clear --preset=high --perf
## Options: --pos=x,y,z (y may be "g" = ground+1.7)  --poi=<id>  --look=yaw,pitch (deg, yaw 0 = north/-Z,
## 90 = west)  --hours=H  --weather=W  --preset=P  --fov=F  --player  --perf  --perf_at=N  --height=H (above ground)
## With --player (the real Player, first-person view; --pos/--look place it):  --campfire=D (a lit campfire D m
## ahead, a little to the right)  --equip=<item id> (in hand, or worn)  --give=id,id,… (into the pack; "id*n" for n)
## --inventory=<frame>[,inventory|equipment|crafting] (open the inventory screen on that tab at that frame)

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
		_setup_player.call_deferred()
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


## --player: place the real Player, light a campfire in front of it, put an item in its hand.
func _setup_player() -> void:
	var p := Game.player as Player
	if p == null:
		return
	var look := String(args.get("look", "0,0")).split(",")
	var yaw := float(look[0])
	var pos := p.global_position
	if args.has("pos"):
		var a := String(args["pos"]).split(",")
		pos = Vector3(float(a[0]), 0.0, float(a[2]))
		pos.y = TerrainData.get_height(pos.x, pos.z) + 0.05 if a[1] == "g" else float(a[1])
	p.teleport(pos, yaw)
	p.set_look(yaw, float(look[1]) if look.size() > 1 else 0.0)
	if args.has("campfire"):
		var d := float(args["campfire"])
		var fwd := Vector3(-sin(deg_to_rad(yaw)), 0.0, -cos(deg_to_rad(yaw)))
		var right := Vector3(-fwd.z, 0.0, fwd.x)
		var at := pos + fwd * d + right * 0.35
		at.y = TerrainData.get_height(at.x, at.z)
		var fire := (load("res://scenes/items/campfire.tscn") as PackedScene).instantiate() as Node3D
		fire.set(&"start_fuel_minutes", 120.0)
		fire.set(&"start_lit", true)
		var parent: Node = ItemsRoot.instance if ItemsRoot.instance else Game.world
		parent.add_child(fire)
		fire.global_position = at
	if args.has("give"):
		for g in String(args["give"]).split(",", false):
			var parts := g.split("*")
			if ItemDB.has_item(StringName(parts[0])):
				p.inventory.add(StringName(parts[0]), int(parts[1]) if parts.size() > 1 else 1)
	if args.has("equip"):
		for e in String(args["equip"]).split(",", false):
			var id := StringName(e)
			if ItemDB.has_item(id):
				p.inventory.add(id, 1)
				p.equip(id)


func _process(_d: float) -> void:
	frame += 1
	# --player: once the campfire/torch exist, settle the eye adaptation (no 3 s lag in a 3 s clip).
	if args.has("player") and frame == 6:
		var sky := get_tree().get_first_node_in_group(&"sky")
		if sky and sky.has_method(&"snap"):
			sky.call(&"snap")
	if args.has("inventory") and frame == int(String(args["inventory"]).get_slice(",", 0)) and InventoryScreen.get_instance():
		var tab := String(args["inventory"]).get_slice(",", 1) if String(args["inventory"]).contains(",") else "inventory"
		var t: int = {"inventory": InventoryScreen.Tab.INVENTORY, "equipment": InventoryScreen.Tab.EQUIPMENT,
			"crafting": InventoryScreen.Tab.CRAFTING}.get(tab, InventoryScreen.Tab.INVENTORY)
		InventoryScreen.get_instance().open(t)
	if cam:
		RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)
	if args.has("perf") and frame == perf_at:
		print("PERF draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			" objects=", Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
			" vram_mb=", snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1),
			" static_mem_mb=", snappedf(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, 0.1),
			" nodes=", Performance.get_monitor(Performance.OBJECT_NODE_COUNT))

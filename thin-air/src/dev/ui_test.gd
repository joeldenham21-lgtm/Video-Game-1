extends Node
## UI QA harness (scenes/dev/ui_test.tscn): shows every screen/state of the UI stream over a live 3D backdrop.
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/u.png --fixed-fps 30 \
##     --quit-after 40 --resolution 1280x720 res://scenes/dev/ui_test.tscn -- --state=hud_fx
## States: hud (calm HUD with toasts/objective/prompt/subtitle), hud_fx (cold + hypoxia + wet + low health +
##   hit), hud_frost, hud_touch (phone layout + touch controls), pause, settings[=tab], journal[=tab], map,
##   death, menu (main menu), menu_new (difficulty select), loading, credits, glyphs_pad (pad glyph prompts).
## Options: --touch (force touch device) --pad (force pad glyphs) --backdrop=world|vista|none --hours=H
##   --save=<abs.png|jpg> (capture the viewport at --at=N frames then quit) --build-theme (write theme.tres, quit)
##   --scale=S (touch_ui_scale)

class MockPlayer extends Node3D:
	var vitals: Vitals
	var inventory: Inventory
	var equipment: Dictionary = {}
	var hotbar: Array[StringName] = [&"hatchet", &"knife", &"torch", &"canteen", &"map", &""]
	var active_slot := 0
	var camera: Camera3D

	func _init() -> void:
		inventory = Inventory.new(24, 30.0)

	func get_camera() -> Camera3D:
		return camera

	func get_active_item() -> StringName:
		return hotbar[active_slot] if active_slot >= 0 else &""

	func get_eye_position() -> Vector3:
		return camera.global_position

	func has_gear(_tag: StringName) -> bool:
		return false

	func select_hotbar(i: int) -> void:
		active_slot = i

	func set_input_enabled(_e: bool) -> void:
		pass

var args := {}
var frame := 0
var save_at := 36
var mock: MockPlayer
var hud: HUD
var cam: Camera3D


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if args.has("build-theme"):
		var th := UITheme.build_theme()
		var err := ResourceSaver.save(th, UITheme.THEME_PATH)
		print("theme saved: ", err == OK, " ", UITheme.THEME_PATH)
		get_tree().quit(0 if err == OK else 1)
		return
	save_at = int(args.get("at", "36"))
	if args.has("scale"):
		Settings.values[&"touch_ui_scale"] = float(args["scale"])
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	if args.has("touch"):
		InputGlyphs.device = InputGlyphs.TOUCH
	elif args.has("pad"):
		InputGlyphs.device = InputGlyphs.PAD
	else:
		InputGlyphs.device = InputGlyphs.KEYBOARD
	var state := String(args.get("state", "hud"))
	Climate.hours = float(args.get("hours", "15.5"))
	Climate.locked = true
	match state:
		"menu", "menu_new", "credits":
			_menu(state)
		"vista":
			_backdrop()
		"loading":
			var ls: Node = (load("res://scenes/ui/loading_screen.tscn") as PackedScene).instantiate()
			add_child(ls)
		_:
			_world_state(state)


func _backdrop() -> void:
	var kind := String(args.get("backdrop", "vista"))
	if kind == "world":
		var W = load("res://src/world/world.gd")
		W.dev_no_player = true
		Game.is_new_game = false
		add_child((load("res://scenes/world/world.tscn") as PackedScene).instantiate())
		cam = Camera3D.new()
		cam.far = 6000.0
		add_child(cam)
		cam.global_position = Vector3(0, TerrainData.get_height(0, 0) + 1.7, 0)
		cam.make_current()
	elif kind == "vista" and ResourceLoader.exists("res://scenes/ui/menu_vista.tscn"):
		var v: Node = (load("res://scenes/ui/menu_vista.tscn") as PackedScene).instantiate()
		v.set("drift", false)
		v.set("shot", String(args.get("shot", "hud")))
		add_child(v)
		cam = v.get_node_or_null("Camera") as Camera3D
	if cam == null:
		cam = Camera3D.new()
		add_child(cam)
		cam.make_current()


func _world_state(state: String) -> void:
	_backdrop()
	mock = MockPlayer.new()
	mock.name = "MockPlayer"
	mock.camera = cam
	add_child(mock)
	mock.global_position = cam.global_position - Vector3(0, 1.7, 0)
	var v := Vitals.new()
	v.name = "Vitals"
	v.auto_simulate = false
	mock.add_child(v)
	mock.vitals = v
	for pair in [[&"hatchet", 1], [&"knife", 1], [&"torch", 2], [&"canteen", 1], [&"map", 1], [&"stick", 6],
			[&"stone", 4], [&"compass", 1], [&"survival_manual", 1]]:
		mock.inventory.add(pair[0], pair[1])
	Game.flags.clear()
	Game.register_player(mock)
	Game.state = Game.State.PLAYING
	Game.playtime = 2 * 3600 + 13 * 60
	Climate.day = 3
	_seed_story()
	hud = (load("res://scenes/ui/hud.tscn") as PackedScene).instantiate() as HUD
	add_child(hud)
	hud.fade_in(0.0)
	_setup_state.call_deferred(state)


func _seed_story() -> void:
	Story.objectives.clear()
	Story.found_logs.clear()
	Story.discovered_pois.clear()
	Story.objectives.append({"id": &"get_warm", "text": "Get warm: build a campfire", "done": true})
	Story.objectives.append({"id": &"salvage", "text": "Salvage what you can from the wreck", "done": true})
	Story.objectives.append({"id": &"ranger_cabin", "text": "Find the ranger cabin at Loon Lake", "done": false, "poi": "ranger_cabin"})
	for l in [&"dale_logbook", &"ranger_logbook", &"log_burke_01", &"miner_diary_1"]:
		Story.found_logs.append(l)
	if TerrainData.layout.get("pois", []).is_empty():
		TerrainData.layout["pois"] = [
			{"id": "crash_site", "name": "Crash site", "x": -520, "y": 1480, "z": 820, "radius": 40},
			{"id": "loon_lake", "name": "Loon Lake", "x": 260, "y": 1450, "z": 640, "radius": 160},
			{"id": "ranger_cabin", "name": "Ranger cabin", "x": 420, "y": 1455, "z": 520, "radius": 25},
			{"id": "fire_lookout", "name": "Fire lookout", "x": -900, "y": 1720, "z": 260, "radius": 20},
			{"id": "ashford_mine", "name": "Ashford Mine", "x": 820, "y": 1950, "z": -80, "radius": 60},
			{"id": "kestrel_station", "name": "Kestrel Station", "x": -360, "y": 2950, "z": -980, "radius": 60},
			{"id": "summit", "name": "Mount Corrigan", "x": 120, "y": 3452, "z": -1260, "radius": 30},
		]
	for p in [&"crash_site", &"loon_lake", &"fire_lookout"]:
		Story.discovered_pois.append(p)
	Game.set_flag(&"blueprints", ["stone_axe", "torch", "campfire", "spear"])
	Game.set_flag(&"scanned", ["otter_wreck", "spruce", "wolf_tracks"])
	Game.set_flag(&"stat_distance_m", 6420.0)
	Game.set_flag(&"stat_max_altitude", 1731.0)
	Game.set_flag(&"stat_trees", 4)
	Game.set_flag(&"stat_crafted", 11)


func _setup_state(state: String) -> void:
	var v := mock.vitals
	v.health = 88.0
	v.food = 62.0
	v.water = 71.0
	v.warmth = 54.0
	v.stamina = 100.0
	v.oxygen = 100.0
	match state:
		"hud", "hud_touch", "glyphs_pad":
			v.add_effect(&"warmed_up", 200.0)
			v.add_effect(&"wet", 200.0)
			Events.notification.emit("+1 Stick", &"item")
			Events.notification.emit("+1 Stick", &"item")
			Events.notification.emit("New blueprint: Stone axe", &"blueprint")
			Events.notification.emit("Discovered: Fire lookout", &"discovery")
			Events.objective_added.emit(&"ranger_cabin", "Find the ranger cabin at Loon Lake")
			Events.interaction_prompt.emit("Pick up Survival manual", 0.0)
			Events.subtitle.emit("Mara Voss", "If anyone can hear this… this is Kestrel Station. Please respond.", 30.0)
			if state == "hud_touch":
				Events.interaction_prompt.emit("Light the campfire", 1.2)
				Events.interaction_progress.emit(0.45)
		"hud_fx":
			v.health = 21.0
			v.warmth = 12.0
			v.oxygen = 33.0
			v.stamina = 14.0
			v.food = 9.0
			v.add_effect(&"wet", 240.0)
			v.add_effect(&"bleeding", 100.0)
			v.add_effect(&"hypoxic", INF)
			v.add_effect(&"hypothermia", INF)
			mock.global_position.y = 2900.0
			Events.notification.emit("Oxygen bottle empty", &"warning")
			Events.interaction_prompt.emit("Scan: Weather mast", 2.0)
			Events.interaction_progress.emit(0.62)
			var src := Node3D.new()
			add_child(src)
			src.global_position = cam.global_position + cam.global_transform.basis.x * 5.0 - cam.global_transform.basis.z * 2.0
			Events.player_damaged.emit(18.0, &"bite", src)
		"hud_frost":
			v.warmth = 6.0
			v.health = 64.0
			v.add_effect(&"frostbite", INF)
		"pause":
			hud.open_pause()
		"settings":
			hud.open_pause()
			if hud.pause_menu and hud.pause_menu.has_method("open_settings"):
				hud.pause_menu.call("open_settings", String(args.get("tab", "graphics")))
		"journal":
			hud.open_journal(String(args.get("tab", "")))
		"map":
			hud.open_map()
		"death":
			v.health = 0.0
			Events.player_died.emit(&"cold")
	for k in ["hud", "hud_fx", "hud_frost", "hud_touch", "glyphs_pad"]:
		if state == k:
			hud.vitals.force_all = state == "hud_fx"


func _menu(state: String) -> void:
	var m: Node = (load("res://scenes/ui/main_menu.tscn") as PackedScene).instantiate()
	add_child(m)
	if state == "menu_new" and m.has_method("show_new_game"):
		m.call_deferred("show_new_game")
	elif state == "credits" and m.has_method("show_credits"):
		m.call_deferred("show_credits")


func _process(_delta: float) -> void:
	frame += 1
	if args.has("save") and frame == save_at:
		var img := get_viewport().get_texture().get_image()
		var path := String(args["save"])
		if path.ends_with(".jpg"):
			img.save_jpg(path, 0.9)
		else:
			img.save_png(path)
		print("saved ", path)
		get_tree().quit()

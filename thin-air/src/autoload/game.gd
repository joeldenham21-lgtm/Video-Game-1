extends Node
## Game state machine, scene flow and persistent flags. CONTRACT.md §3.

enum State { BOOT, MENU, LOADING, PLAYING, PAUSED, CINEMATIC, DEAD }

signal world_ready()
signal state_changed(new_state: int)

const WORLD_SCENE := "res://scenes/world/world.tscn"
const MENU_SCENE := "res://scenes/main.tscn"

var state: State = State.BOOT
var player: Node3D = null
var world: Node3D = null
var flags: Dictionary = {}
var difficulty: StringName = &"survivor"
var is_new_game := true
var playtime := 0.0

var _loading_layer: CanvasLayer = null
var _pending_load_slot := -1


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	Events.player_died.connect(_on_player_died)


func _process(delta: float) -> void:
	if state == State.PLAYING:
		playtime += delta


func _set_state(s: State) -> void:
	if state == s:
		return
	state = s
	state_changed.emit(s)


func is_playing() -> bool:
	return state == State.PLAYING


func new_game() -> void:
	is_new_game = true
	flags.clear()
	playtime = 0.0
	difficulty = Settings.get_value(&"difficulty", &"survivor")
	_pending_load_slot = -1
	_load_world()


func continue_game(slot := 0) -> void:
	is_new_game = false
	_pending_load_slot = slot
	_load_world()


func quit_to_menu() -> void:
	get_tree().paused = false
	player = null
	world = null
	_set_state(State.MENU)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().change_scene_to_file(MENU_SCENE)


func set_paused(p: bool) -> void:
	if state == State.MENU or state == State.LOADING or state == State.BOOT:
		return
	get_tree().paused = p
	if p:
		_set_state(State.PAUSED)
	elif state == State.PAUSED:
		_set_state(State.PLAYING)


func set_cinematic(active: bool) -> void:
	if active:
		_set_state(State.CINEMATIC)
	elif state == State.CINEMATIC:
		_set_state(State.PLAYING)


func set_flag(key: StringName, value: Variant = true) -> void:
	flags[key] = value


func get_flag(key: StringName, default: Variant = false) -> Variant:
	return flags.get(key, default)


func notify(text: String, kind: StringName = &"info") -> void:
	Events.notification.emit(text, kind)


func register_player(p: Node3D) -> void:
	player = p


func register_world(w: Node3D) -> void:
	world = w


## Called by world.gd once every part has been instanced and the player placed.
func on_world_built() -> void:
	_hide_loading()
	if _pending_load_slot >= 0:
		var ok: bool = Save.load_game(_pending_load_slot)
		_pending_load_slot = -1
		if not ok:
			push_warning("Game: load failed, starting fresh")
			is_new_game = true
	_set_state(State.PLAYING)
	world_ready.emit()
	Events.game_started.emit(is_new_game)
	if is_new_game and Story.has_method("start_prologue"):
		Story.start_prologue()


func _load_world() -> void:
	get_tree().paused = false
	_set_state(State.LOADING)
	_show_loading()
	player = null
	world = null
	# Let the loading screen draw before the heavy load.
	await get_tree().process_frame
	await get_tree().process_frame
	var err := get_tree().change_scene_to_file(WORLD_SCENE)
	if err != OK:
		push_error("Game: cannot load world scene (%s)" % err)
		_hide_loading()
		_set_state(State.MENU)


func _show_loading() -> void:
	if _loading_layer:
		return
	var scene_path := "res://scenes/ui/loading_screen.tscn"
	if ResourceLoader.exists(scene_path):
		_loading_layer = (load(scene_path) as PackedScene).instantiate()
	else:
		_loading_layer = CanvasLayer.new()
		var bg := ColorRect.new()
		bg.color = Color(0.03, 0.035, 0.045)
		bg.set_anchors_preset(Control.PRESET_FULL_RECT)
		_loading_layer.add_child(bg)
		var l := Label.new()
		l.text = "THIN AIR"
		l.set_anchors_preset(Control.PRESET_CENTER)
		l.add_theme_font_size_override("font_size", 42)
		_loading_layer.add_child(l)
	_loading_layer.layer = 100
	_loading_layer.process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().root.add_child.call_deferred(_loading_layer)


func _hide_loading() -> void:
	if _loading_layer:
		_loading_layer.queue_free()
		_loading_layer = null


func _on_player_died(_cause: StringName) -> void:
	_set_state(State.DEAD)


func respawn_after_death() -> void:
	# Reload from last save if any, otherwise restart.
	if Save.has_save(0):
		continue_game(0)
	else:
		new_game()


func save_state() -> Dictionary:
	var f := {}
	for k in flags:
		f[String(k)] = flags[k]
	return {"flags": f, "difficulty": String(difficulty), "playtime": playtime}


func load_state(d: Dictionary) -> void:
	flags.clear()
	var f: Dictionary = d.get("flags", {})
	for k in f:
		flags[StringName(k)] = f[k]
	difficulty = StringName(d.get("difficulty", "survivor"))
	playtime = float(d.get("playtime", 0.0))

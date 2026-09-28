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

## World build progress while State.LOADING (0..1, -1 = unknown) and the stage being built; the loading screen
## polls these. world_build_ms = Game.new_game/continue_game -> on_world_built (wall clock).
var loading_progress := -1.0
var loading_stage := ""
var world_build_ms := 0.0
var _build_t0 := 0

## Boot options (release QA; user args after `--`, also accepted before it):
##   --autostart   the main menu immediately starts a new game
##   --autoquit=N  quit N seconds after the world is ready, printing one `BOOT ...` summary line
##   --autoshot=/abs/path.png  with --autoquit: save the last frame there before quitting
var boot_args := {}
var errors: ErrorCounter = null


## Counts engine/script/shader errors (and warnings) for the BOOT summary. Called from any thread.
class ErrorCounter extends Logger:
	var mutex := Mutex.new()
	var errors := 0
	var script_errors := 0
	var warnings := 0
	var first: Array[String] = []

	func _log_error(function: String, file: String, line: int, code: String, rationale: String,
			_editor_notify: bool, error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
		mutex.lock()
		if error_type == ERROR_TYPE_WARNING:
			warnings += 1
		else:
			if error_type == ERROR_TYPE_SCRIPT:
				script_errors += 1
			else:
				errors += 1
			if first.size() < 3:
				first.append("%s (%s:%d %s)" % [rationale if rationale != "" else code, file.get_file(), line, function])
		mutex.unlock()

	func _log_message(_message: String, _error: bool) -> void:
		pass


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	Events.player_died.connect(_on_player_died)
	for a in Array(OS.get_cmdline_args()) + Array(OS.get_cmdline_user_args()):
		var s := String(a)
		if s == "--autostart" or s.begins_with("--autoquit") or s.begins_with("--autoshot="):
			var kv := s.trim_prefix("--").split("=", true, 1)
			boot_args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	errors = ErrorCounter.new()
	OS.add_logger(errors)


## True when launched with --autostart (the main menu starts a new game at once).
func boot_autostart() -> bool:
	return boot_args.has("autostart")


func set_loading_progress(p: float, stage := "") -> void:
	loading_progress = p
	if stage != "":
		loading_stage = stage


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
	if not Save.is_readable(slot):
		# a missing/corrupt save starts a fresh game (difficulty, flags and playtime reset before the world
		# builds, so nothing from the session in memory leaks into it)
		push_warning("Game: save %d unreadable, starting a new game" % slot)
		new_game()
		return
	is_new_game = false
	_pending_load_slot = slot
	_load_world()


func quit_to_menu() -> void:
	get_tree().paused = false
	_stop_world_audio()
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
	if _build_t0 > 0:
		world_build_ms = (Time.get_ticks_usec() - _build_t0) / 1000.0
		_build_t0 = 0
		print("[Game] world built in %.0f ms" % world_build_ms)
	loading_progress = 1.0
	_hide_loading()
	if _pending_load_slot >= 0:
		var ok: bool = Save.load_game(_pending_load_slot)
		_pending_load_slot = -1
		if not ok:
			push_warning("Game: load failed, starting fresh")
			is_new_game = true
			flags.clear()
			playtime = 0.0
	_set_state(State.PLAYING)
	world_ready.emit()
	Events.game_started.emit(is_new_game)
	if is_new_game and Story.has_method("start_prologue"):
		Story.start_prologue()
	if boot_args.has("autoquit"):
		get_tree().create_timer(maxf(float(boot_args["autoquit"]), 0.0), true, false, true).timeout.connect(_boot_quit)


## --autoquit: one-line boot summary, then quit (exit code 1 when any error was logged).
func _boot_quit() -> void:
	var e := errors
	e.mutex.lock()
	var n_err := e.errors
	var n_script := e.script_errors
	var n_warn := e.warnings
	var first := "; ".join(e.first)
	e.mutex.unlock()
	print("BOOT %s world_build_ms=%d draw_calls=%d primitives=%d fps=%d vram_mb=%.0f script_errors=%d errors=%d warnings=%d renderer=%s%s" % [
		"OK" if n_err + n_script == 0 else "ERRORS", int(world_build_ms),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)),
		int(Performance.get_monitor(Performance.TIME_FPS)),
		Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, n_script, n_err, n_warn,
		RenderingServer.get_current_rendering_method(), (" first=" + first) if first != "" else ""])
	if boot_args.has("autoshot") and DisplayServer.get_name() != "headless":
		var img := get_viewport().get_texture().get_image()
		if img:
			img.save_png(String(boot_args["autoshot"]))
	get_tree().quit(0 if n_err + n_script == 0 else 1)


## The voice (radio lines, crew recordings, the prologue) lives on the Audio autoload, not in the world: stop
## it when the world is torn down, or a recording kept playing over the main menu / into the reloaded world.
func _stop_world_audio() -> void:
	if Audio.has_method(&"stop_voice"):
		Audio.stop_voice()


func _load_world() -> void:
	get_tree().paused = false
	_stop_world_audio()
	_build_t0 = Time.get_ticks_usec()
	loading_progress = 0.0
	loading_stage = ""
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

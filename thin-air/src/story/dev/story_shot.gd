extends Node
## Dev QA harness for the story stream (Movie Maker renders, see tools/README.md "Story QA shots").
##   --shot=wake     a real new game: the prologue's black screen with subtitles (auto-skipped after 0.5 s,
##                   Story.dev_fast), the crash, then the fade-in at the wreck at dusk in light snow
##   --shot=station  Kestrel Station at night with the generator running (lights, heat, fabricator), viewed from
##                   the galley, then Mara's corner of the east module (--switch=frame)
## DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /abs/dir/f.png --fixed-fps 30 \
##   --quit-after 45 --resolution 960x540 res://scenes/story/story_shot.tscn -- --shot=wake [--preset=high]

var args := {}
var frame := 0
var world: Node = null
var _views: Array = []
var _switch := 24


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	_switch = int(args.get("switch", "24"))
	# Movie Maker keeps project.godot's window size (1600x900): render 3D at ~960 px wide to keep lavapipe fast
	get_viewport().scaling_3d_scale = clampf(float(args.get("size", "960")) / 1600.0, 0.25, 1.0)
	Story.dev_fast = true
	var shot := String(args.get("shot", "wake"))
	Game.is_new_game = shot == "wake"
	if shot == "wake":
		Game.flags.clear()
	world = (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	if shot == "station":
		_setup_station.call_deferred()
	elif shot == "rescue":
		_setup_rescue.call_deferred()


func _setup_station() -> void:
	Climate.hours = float(args.get("hours", "20.6"))
	Climate.set_weather(&"clear", 0.0)
	Climate.locked = true
	Story.reset_story()
	Story.events["woke"] = true
	Story.set_act(5, true)
	_story_done_until([&"reach_station", &"find_mara", &"fuel_generator", &"start_generator"], 5)
	Story.events["relay_explained"] = true
	for f in [&"generator_fueled", &"generator_running", &"station_power", &"met_mara", &"has_radio"]:
		Game.set_flag(f, true)
	var st := get_tree().get_first_node_in_group(&"poi_structures")
	if st:
		st.call(&"set_station_power", true, false)
	var site := st.call(&"get_site", &"kestrel_station") as Node3D if st else null
	if site == null:
		return
	# [local eye position, yaw, pitch] from the POI QA views (galley, bunks)
	_views = [[Vector3(0.6, 3.45, 3.9), 8.0, -10.0], [Vector3(9.9, 3.45, -4.8), 180.0, -12.0]]
	for v in _views:
		v[0] = site.global_transform * (v[0] as Vector3)
	_apply_view(0)


## Dawn after the storm: Rescue One-Six on short final to the pad, seen from beside the station.
func _setup_rescue() -> void:
	Climate.hours = float(args.get("hours", "7.6"))
	Climate.set_weather(&"clear", 0.0)
	Climate.locked = true
	Story.reset_story()
	Story.events["woke"] = true
	Story.set_act(6, true)
	_story_done_until([], 7)
	var st := get_tree().get_first_node_in_group(&"poi_structures")
	if st == null:
		return
	st.call(&"set_station_power", true, false)
	var heli := st.call(&"spawn_helicopter") as Node3D
	var site := st.call(&"get_site", &"kestrel_station") as Node3D
	if heli == null or site == null:
		return
	heli.call(&"skip_to_remaining", float(args.get("remaining", "110")))
	var eye := site.global_transform * Vector3(-6.0, 1.9, 24.0)
	eye.y = maxf(eye.y, TerrainData.get_height(eye.x, eye.z) + 1.7)
	var d := heli.global_position - eye
	var yaw := rad_to_deg(atan2(-d.x, -d.z))
	var pitch := rad_to_deg(atan2(d.y, Vector2(d.x, d.z).length()))
	_views = [[eye, yaw, pitch]]
	_apply_view(0)


## Marks every objective before `act` (plus `extra`) done without running its actions, and every beat as
## played, so the HUD shows the right objectives and no stray radio line plays over the shot.
func _story_done_until(extra: Array, act: int) -> void:
	for o in Story.graph.objectives:
		if int(o.get("act", 0)) < act or extra.has(StringName(o["id"])):
			Story.objectives.append({"id": StringName(o["id"]), "text": String(o["text"]), "done": true})
	for b in Story.graph.beats:
		Story.beats_done[String(b["id"])] = true
	Story.hint_log.clear()
	for h in Story.graph.hints:
		Story.hint_log[String(h["id"])] = {"n": 99, "at": 0.0}
	for f in [&"has_radio", &"met_mara"]:
		Game.set_flag(f, true)


func _apply_view(i: int) -> void:
	var pl := Game.player
	if pl == null or i >= _views.size():
		return
	var v: Array = _views[i]
	var eye_off: float = (pl.call(&"get_eye_position") as Vector3).y - pl.global_position.y
	pl.call(&"teleport", (v[0] as Vector3) - Vector3(0, eye_off, 0), float(v[1]))
	if pl.has_method(&"set_look"):
		pl.call(&"set_look", float(v[1]), float(v[2]))


func _process(_delta: float) -> void:
	frame += 1
	if not _views.is_empty() and frame == _switch:
		_apply_view(1)
	if frame == int(args.get("perf_at", "40")):
		print("PERF draw_calls=%d primitives=%d fps=%.1f" % [
			Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			Performance.get_monitor(Performance.TIME_FPS)])

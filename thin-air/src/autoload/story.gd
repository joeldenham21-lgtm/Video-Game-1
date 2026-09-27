extends Node
## Story autoload — CONTRACT.md §3 "Story", DESIGN.md §2. Owned by the Story workstream.
##
## * Objective graph from data/story.json (src/story/story_graph.gd): an objective is added when every
##   `requires` objective is done and its optional `trigger` holds; it completes when its `complete` condition
##   holds. Conditions are state-based (item acquired / held, POI discovered, event or interact-socket used,
##   Game flag, crafted or built, log found, scan, hours survived, dawn, altitude, distance, insulation…) so
##   finishing things out of order cascades naturally. Events.objective_added / objective_completed.
## * Discovery radius per POI → discover_poi → Events.poi_discovered + discovery stinger + notification.
## * Voice: one queue for story radio lines (Events.radio_message → Audio + subtitles), Mara in person
##   (Audio.play_voice_3d at her socket) and crew logs; beats (one-shot reactions), contextual radio hints and
##   "stuck" hints on a timer (radio once you carry the handheld, a text notification before that).
## * Acts: prologue cinematic (black screen, cockpit radio scene, crash) → wake at the wreck; generator,
##   relay repair, final night (blizzard, wolves), dawn rescue helicopter, credits, free roam.
## * Music hints per zone (station / summit / interiors) and per moment (danger, blizzard, finale).
## * save_state/load_state (JSON-safe), explicit in Save like Game/Climate.
##
## Public API beyond the contract: graph, act, events, instant, autosave_enabled, complete (bool),
## use_socket(site, socket, player) -> Dictionary, get_use_prompt(site, socket) -> String, can_use(site, socket),
## is_story_complete(), evaluate_now(), set_act(n), queue_voice(id, mode, at, then), voice_idle(),
## condition(c) -> bool, abs_hours(), reset_story(), revealed_pois, get_act_name(), save_is_complete(slot) (static),
## signals story_event(id), act_changed(act), story_completed().

signal story_event(id: StringName)
signal act_changed(act: int)
signal story_completed()

const StoryGraphScript := preload("res://src/story/story_graph.gd")
const OverlayScript := preload("res://src/story/cinematic_overlay.gd")
const VOICE_PATH := "res://data/voice.json"
const LOGS_PATH := "res://data/logs.json"
const DAWN_HOUR := 7.0
const INTERIOR_MAX_Y := 1100.0
const HINT_GAP_S := 90.0
const LOG_SCENE_ORDER := ["prologue", "wake"]

# ---------------------------------------------------------------------------------------------- contract
var objectives: Array[Dictionary] = []      # {id, text, done, poi?, act}
var found_logs: Array[StringName] = []
var discovered_pois: Array[StringName] = []

# ---------------------------------------------------------------------------------------------- state
var graph: StoryGraph
var act := 0
var events: Dictionary = {}          # String -> true
var acquired: Dictionary = {}        # item id String -> count ever picked up / crafted / given
var crafted: Dictionary = {}         # item or buildable id String -> count
var beats_done: Dictionary = {}      # beat id -> true
var hint_log: Dictionary = {}        # hint id -> {"n": int, "at": abs hours}
var obj_meta: Dictionary = {}        # objective id String -> {"t0": abs hours, "stuck": s, "hinted": bool}
var flag_time: Dictionary = {}       # flag -> abs hours when the story set it
var revealed_pois: Array[StringName] = []
var complete := false

## Tests / fast playthroughs: no audio, no waits, no cinematics, no scene changes.
var instant := false
## Autosave to slot 0 at act checkpoints (tests switch it off).
var autosave_enabled := true
## Dev: skip the 4-minute prologue scene (wake straight at the wreck).
var skip_prologue := false
## Dev QA renders (src/story/dev/story_shot.gd): the prologue auto-skips after half a second, waits are 20x shorter.
var dev_fast := false

var _voice: Dictionary = {}
var _logs: Dictionary = {}
var _vq: Array[Dictionary] = []      # {id, mode, at, then, low}
var _v_busy := 0.0
var _v_then := ""
var _v_low := false
var _hint_gap := 30.0
var _eval_t := 0.0
var _hint_t := 2.0
var _dirty := false
var _music := &""
var _running_seq: Dictionary = {}
var _overlay: CanvasLayer = null
var _beacon_t := 20.0
var _heli: Node3D = null
var _heli_landed := false
var _in_cinematic := false
var _salvage_seen := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE
	graph = StoryGraphScript.load_default()
	_voice = _read_json(VOICE_PATH)
	_logs = _read_json(LOGS_PATH)
	Events.item_picked_up.connect(_on_item_acquired)
	Events.item_crafted.connect(_on_item_crafted)
	Events.structure_built.connect(_on_structure_built)
	Events.scan_completed.connect(func(_id: StringName) -> void: _dirty = true)
	Events.game_loaded.connect(_on_game_loaded)
	Events.sleep_ended.connect(func() -> void: _dirty = true)
	Game.state_changed.connect(_on_game_state)


## Back at the main menu: drop the cinematic layer (it lives under this autoload) and any running scene.
func _on_game_state(st: int) -> void:
	if st != Game.State.MENU:
		return
	_in_cinematic = false
	_vq.clear()
	_v_busy = 0.0
	_running_seq.clear()
	if _overlay and is_instance_valid(_overlay):
		_overlay.queue_free()
	_overlay = null
	_heli = null


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return v if v is Dictionary else {}


# ============================================================================================ contract API

func start_prologue() -> void:
	reset_story()
	set_act(0, true)
	_give_starting_kit()
	if instant or skip_prologue:
		_wake(true)
		return
	_seq_prologue()


func add_objective(id: StringName, text: String) -> void:
	if has_objective(id):
		return
	var o := {"id": id, "text": text, "done": false}
	var def: Dictionary = graph.get_objective(id) if graph else {}
	if def.has("poi"):
		o["poi"] = String(def["poi"])
	o["act"] = int(def.get("act", act))
	objectives.append(o)
	if not obj_meta.has(String(id)):
		obj_meta[String(id)] = {"t0": abs_hours(), "stuck": 0.0, "hinted": false}
	Events.objective_added.emit(id, text)


func complete_objective(id: StringName) -> void:
	var found := false
	for o in objectives:
		if o["id"] == id and not o["done"]:
			o["done"] = true
			found = true
			break
	if not found:
		return
	Events.objective_completed.emit(id)
	var def: Dictionary = graph.get_objective(id) if graph else {}
	_run_actions(def.get("on_complete", []))
	if bool(def.get("autosave", false)):
		_autosave.call_deferred()
	_dirty = true


func has_objective(id: StringName) -> bool:
	for o in objectives:
		if o["id"] == id:
			return true
	return false


func is_objective_done(id: StringName) -> bool:
	for o in objectives:
		if o["id"] == id:
			return o["done"]
	return false


## Adds the log to the journal (Events.log_found → journal), plays its voice recording if any.
func find_log(log_id: StringName) -> void:
	var first := not found_logs.has(log_id)
	if first:
		found_logs.append(log_id)
		Events.log_found.emit(log_id)
		var d: Dictionary = _logs.get(String(log_id), {})
		Game.notify("Journal: %s" % String(d.get("title", String(log_id).capitalize())), &"info")
	var v: Variant = (_logs.get(String(log_id), {}) as Dictionary).get("voice", null)
	if v != null and String(v) != "":
		queue_voice(StringName(v), "plain", "", "", true, true)
	_dirty = true


func discover_poi(poi_id: StringName) -> void:
	if discovered_pois.has(poi_id):
		return
	discovered_pois.append(poi_id)
	Events.poi_discovered.emit(poi_id)
	if not instant:
		Audio.play_stinger(&"discovery")
		var poi: Dictionary = TerrainData.get_poi(poi_id)
		Game.notify("Discovered: %s" % String(poi.get("name", String(poi_id).capitalize())), &"discovery")
	_dirty = true


## Generic story hook for world triggers / interactables / other systems (campfire_lit, read_<item>,
## enter_<site>…). Records the event and re-evaluates the graph.
func trigger(event_id: StringName) -> void:
	if event_id == &"":
		return
	events[String(event_id)] = true
	story_event.emit(event_id)
	_dirty = true
	if instant:
		evaluate_now()


# ============================================================================================ extra API

func reset_story() -> void:
	objectives.clear(); found_logs.clear(); discovered_pois.clear(); revealed_pois.clear()
	events.clear(); acquired.clear(); crafted.clear(); beats_done.clear(); hint_log.clear()
	obj_meta.clear(); flag_time.clear(); _salvage_seen.clear()
	_vq.clear(); _v_busy = 0.0; _v_then = ""; _running_seq.clear()
	complete = false
	act = 0
	_music = &""
	_heli_landed = false
	if _heli and is_instance_valid(_heli):
		_heli.queue_free()
	_heli = null


func set_act(n: int, quiet := false) -> void:
	if n == act and not quiet:
		return
	act = n
	act_changed.emit(n)
	if quiet or instant or n <= 1:
		return
	var a: Dictionary = graph.acts.get(str(n), {})
	var ov := _get_overlay()
	if ov:
		ov.call(&"chapter", String(a.get("name", "")), 5.0)


## data/logs.json entry ({title, author, date, text, voice, location_hint, kind}) or {}.
func get_log(id: StringName) -> Dictionary:
	return _logs.get(String(id), {})


func get_act_name() -> String:
	return String((graph.acts.get(str(act), {}) as Dictionary).get("name", ""))


func is_story_complete() -> bool:
	return complete


## Absolute game hours since day 1, 00:00.
func abs_hours() -> float:
	return float(Climate.day - 1) * 24.0 + Climate.hours


func evaluate_now() -> void:
	_dirty = false
	_evaluate_graph()
	_evaluate_beats()


func voice_idle() -> bool:
	return _v_busy <= 0.0 and _vq.is_empty()


## Reads a save file and says whether it holds a finished story (main menu: "free roam").
static func save_is_complete(slot := 0) -> bool:
	var path := "user://save_%d.json" % slot
	if not FileAccess.file_exists(path):
		return false
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (v is Dictionary):
		return false
	return bool(((v as Dictionary).get("story", {}) as Dictionary).get("complete", false))


# ============================================================================================ uses (world interactables)

func _use_key(site: StringName, socket: StringName) -> String:
	return "%s/%s" % [site, socket]


func get_use_config(site: StringName, socket: StringName) -> Dictionary:
	return graph.uses.get(_use_key(site, socket), {})


## "" if the interactable is spent (a one-shot already used).
func get_use_prompt(site: StringName, socket: StringName) -> String:
	var key := _use_key(site, socket)
	var u: Dictionary = graph.uses.get(key, {})
	if u.is_empty():
		return ""
	if not bool(u.get("repeat", false)) and events.has("use:" + key) and _use_requirements_met(u):
		return ""
	if not _use_requirements_met(u):
		return String(u.get("locked_prompt", u.get("prompt", "Use")))
	return String(u.get("prompt", "Use"))


func can_use(site: StringName, socket: StringName) -> bool:
	return _use_requirements_met(get_use_config(site, socket))


func _use_requirements_met(u: Dictionary) -> bool:
	if u.has("requires_flag") and not bool(Game.get_flag(StringName(u["requires_flag"]), false)):
		return false
	var req: Dictionary = u.get("requires", {})
	for id in req:
		if _item_count(StringName(id), true) < int(req[id]):
			return false
	return true


## Interact with a story socket (StoryUse nodes call this). Returns {ok, text}.
func use_socket(site: StringName, socket: StringName, player: Node = null) -> Dictionary:
	var key := _use_key(site, socket)
	var u: Dictionary = graph.uses.get(key, {})
	if u.is_empty():
		return {"ok": false, "text": ""}
	if player == null:
		player = Game.player
	var first := not events.has("use:" + key)
	if not bool(u.get("repeat", false)) and not first and _use_requirements_met(u):
		return {"ok": false, "text": ""}
	if not _use_requirements_met(u):
		# locked: optional flag / event so the story can react ("the depot is padlocked")
		if u.has("locked_flag"):
			Game.set_flag(StringName(u["locked_flag"]), true)
			Blueprints.unlock_for_flag(StringName(u["locked_flag"]))
		if u.has("locked_event"):
			trigger(StringName(u["locked_event"]))
		var lt := String(u.get("locked_text", u.get("locked_prompt", "")))
		if lt != "" and not instant:
			Game.notify(lt, &"warning")
			Audio.play_ui(&"ui_back")
		return {"ok": false, "text": lt}
	var inv := _inventory()
	var cons: Dictionary = u.get("consume", {})
	if inv:
		for id in cons:
			inv.remove(StringName(id), int(cons[id]))
	var give: Dictionary = u.get("give", {})
	if first or bool(u.get("repeat_give", false)):
		for id in give:
			_give(StringName(id), int(give[id]))
	if u.has("flag"):
		_set_flag(StringName(u["flag"]))
	if u.has("blueprint_flag"):
		Blueprints.unlock_for_flag(StringName(u["blueprint_flag"]))
	for p in u.get("reveal", []):
		_reveal(StringName(p))
	var txt := String(u.get("text", ""))
	if txt != "" and not instant:
		Game.notify(txt, &"info")
	if u.has("sfx") and not instant and player is Node3D:
		Audio.play_sfx(StringName(u["sfx"]), (player as Node3D).global_position)
	var kind := String(u.get("kind", ""))
	match kind:
		"o2_fill":
			_use_o2_fill()
		"mara":
			if not first:
				_mara_talk()
	events["use:" + key] = true
	story_event.emit(StringName("use:" + key))
	if u.has("event"):
		trigger(StringName(u["event"]))
	if u.has("sequence"):
		_run_sequence(String(u["sequence"]))
	var st := _structures()
	if st and st.has_method(&"apply_use"):
		st.call(&"apply_use", site, socket, u, player)
	_dirty = true
	if instant:
		evaluate_now()
	return {"ok": true, "text": txt}


func _use_o2_fill() -> void:
	var inv := _inventory()
	if inv == null:
		return
	var n := inv.count(&"o2_bottle_empty")
	if n <= 0:
		if not instant:
			Game.notify("No empty cylinders to charge. The rack by the lab door holds charged ones.", &"info")
		return
	inv.remove(&"o2_bottle_empty", n)
	_give(&"o2_bottle", n)


func _mara_talk() -> void:
	for m in graph.mara_talk:
		if condition(m.get("when", {})):
			for l in m.get("lines", []):
				queue_voice(StringName(l), "3d", "kestrel_station/Npc_Mara")
			return


# ============================================================================================ process

func _process(delta: float) -> void:
	_update_voice(delta)
	if Game.world == null or Game.player == null or complete and not _in_cinematic:
		if complete:
			_update_free_roam(delta)
		return
	var playing := Game.state == Game.State.PLAYING
	_eval_t -= delta
	if _eval_t <= 0.0 or _dirty:
		_eval_t = 0.5
		_dirty = false
		if not _in_cinematic:
			_check_discovery()
		_evaluate_graph()
		_evaluate_beats()
		_update_music()
		_update_world_beats()
	if playing:
		_update_stuck(delta)
		_hint_gap -= delta
		_hint_t -= delta
		if _hint_t <= 0.0:
			_hint_t = 3.0
			_update_hints()
		_update_beacon(delta)


func _update_free_roam(_delta: float) -> void:
	pass


func _check_discovery() -> void:
	var p := _player_pos()
	if p == Vector3.INF:
		return
	for id: String in graph.pois:
		var sid := StringName(id)
		if discovered_pois.has(sid):
			continue
		var poi: Dictionary = TerrainData.get_poi(sid)
		if poi.is_empty():
			continue
		var c: Vector3 = poi["position"]
		var r := float((graph.pois[id] as Dictionary).get("radius", poi.get("radius", 40.0)))
		if Vector2(p.x - c.x, p.z - c.z).length() <= r:
			discover_poi(sid)


func _evaluate_graph() -> void:
	if graph == null or complete and not _in_cinematic:
		return
	for _pass in 24:
		var changed := false
		for o in graph.objectives:
			var id := StringName(o["id"])
			if is_objective_done(id):
				continue
			if not has_objective(id):
				if not _available(o):
					continue
				_start_objective(o)
				changed = true
			if condition(o.get("complete", {}), id):
				complete_objective(id)
				changed = true
		if not changed:
			break


func _available(o: Dictionary) -> bool:
	if act == 0 and not events.has("woke"):
		return false
	for r in o.get("requires", []):
		if not is_objective_done(StringName(r)):
			return false
	if o.has("trigger") and not condition(o["trigger"], StringName(o["id"])):
		return false
	return true


func _start_objective(o: Dictionary) -> void:
	var id := StringName(o["id"])
	obj_meta[String(id)] = {"t0": abs_hours(), "stuck": 0.0, "hinted": false}
	add_objective(id, String(o.get("text", String(id))))
	_run_actions(o.get("on_start", []))


func _evaluate_beats() -> void:
	if act == 0 and not events.has("woke"):
		return
	for b in graph.beats:
		var id := String(b.get("id", ""))
		if beats_done.has(id):
			continue
		if condition(b.get("when", {})):
			beats_done[id] = true
			_run_actions(b.get("do", []))


func _update_stuck(delta: float) -> void:
	if _in_cinematic:
		return
	for o in objectives:
		if o["done"]:
			continue
		var def: Dictionary = graph.get_objective(o["id"])
		var h: Dictionary = def.get("hint", {})
		if h.is_empty():
			continue
		var m: Dictionary = obj_meta.get(String(o["id"]), {})
		if m.is_empty() or bool(m.get("hinted", false)):
			continue
		m["stuck"] = float(m.get("stuck", 0.0)) + delta
		if float(m["stuck"]) < float(h.get("after", 300.0)):
			continue
		if not voice_idle():
			continue
		m["hinted"] = true
		if _has_radio() and h.has("voice") and _hint_gap <= 0.0:
			_hint_gap = HINT_GAP_S
			queue_voice(StringName(h["voice"]), "radio", "", "", true)
		elif h.has("text"):
			Game.notify(String(h["text"]), &"info")
		return


func _update_hints() -> void:
	if not _has_radio() or _in_cinematic or _hint_gap > 0.0 or not voice_idle() or _voice_elsewhere():
		return
	var now := abs_hours()
	for h in graph.hints:
		var id := String(h.get("id", ""))
		var rec: Dictionary = hint_log.get(id, {"n": 0, "at": -1000.0})
		if int(rec["n"]) >= int(h.get("max", 1)) or now - float(rec["at"]) < float(h.get("cooldown_h", 12.0)):
			continue
		if not condition(h.get("when", {})):
			continue
		hint_log[id] = {"n": int(rec["n"]) + 1, "at": now}
		_hint_gap = HINT_GAP_S
		queue_voice(StringName(id), "radio", "", "", true)
		return


## The wreck's radio keeps receiving the station's automated weather until you listen properly.
func _update_beacon(delta: float) -> void:
	if act > 2 or events.has("beacon_heard"):
		return
	_beacon_t -= delta
	if _beacon_t > 0.0:
		return
	_beacon_t = 80.0
	var n := _socket_node("crash_site/Use_Radio")
	var p := _player_pos()
	if n and p != Vector3.INF and n.global_position.distance_to(p) < 30.0 and voice_idle() and not _voice_elsewhere():
		Audio.play_voice_3d(&"beacon_awos", n)


func _update_music() -> void:
	if instant or _in_cinematic and not _running_seq.has("ending"):
		return
	var want := StringName((graph.acts.get(str(act), {}) as Dictionary).get("music", "explore"))
	var p := _player_pos()
	if p != Vector3.INF:
		var interior := _interior_at(p)
		if interior != &"":
			want = StringName((graph.interiors.get(String(interior), {}) as Dictionary).get("music", want))
		else:
			for id: String in graph.pois:
				var m := String((graph.pois[id] as Dictionary).get("music", ""))
				if m == "":
					continue
				var poi: Dictionary = TerrainData.get_poi(StringName(id))
				if poi.is_empty():
					continue
				var c: Vector3 = poi["position"]
				if Vector2(p.x - c.x, p.z - c.z).length() <= float((graph.pois[id] as Dictionary).get("radius", 60.0)) * 1.3:
					want = StringName(m)
	if bool(Game.get_flag(&"final_night", false)) and not is_objective_done(&"survive_night"):
		want = &"blizzard" if _interior_at(p) == &"" and not _near_poi(&"kestrel_station", 40.0) else &"station"
	if has_objective(&"return_station") and not is_objective_done(&"return_station"):
		want = &"blizzard"
	if condition({"type": "creature_near", "species": "old_grey", "radius": 55}):
		want = &"danger"
	if want != _music:
		_music = want
		Audio.set_music_state(want)


## World-side beats that need live nodes: the final-night wolves, boarding the helicopter.
func _update_world_beats() -> void:
	if bool(Game.get_flag(&"final_night", false)) and not bool(Game.get_flag(&"final_pack", false)) \
			and not is_objective_done(&"survive_night"):
		var h := Climate.hours
		if h >= 21.5 or h < 4.0:
			_spawn_final_pack()
	if _heli_landed and not events.has("rescue_boarded") and _heli and is_instance_valid(_heli):
		var p := _player_pos()
		if p != Vector3.INF and p.distance_to(_heli.global_position) < 14.0:
			trigger(&"rescue_boarded")


## The final night: a wolf pack comes up the col and circles the lit station (FaunaManager.spawn_pack).
func _spawn_final_pack() -> void:
	_set_flag(&"final_pack")
	var fm: Node = Game.world.get_node_or_null(^"Fauna") if Game.world else null
	var poi: Dictionary = TerrainData.get_poi(&"kestrel_station")
	if fm == null or poi.is_empty() or not fm.has_method(&"spawn_pack"):
		return
	var c: Vector3 = poi["position"]
	var at := c + Vector3(-95.0, 0.0, 85.0)
	at.y = TerrainData.get_height(at.x, at.z)
	fm.call(&"spawn_pack", at, 3)
	if not instant:
		Audio.play_ambient_event(&"wolf_howl", at + Vector3(0, 2, 0), 3.0)


# ============================================================================================ conditions

func condition(c: Variant, oid: StringName = &"") -> bool:
	if c == null:
		return true
	if c is Array:
		for x in c:
			if not condition(x, oid):
				return false
		return true
	if not (c is Dictionary):
		return true
	var d: Dictionary = c
	if d.is_empty():
		return true
	if d.has("all"):
		for x in d["all"]:
			if not condition(x, oid):
				return false
		return true
	if d.has("any"):
		for x in d["any"]:
			if condition(x, oid):
				return true
		return false
	if d.has("not"):
		return not condition(d["not"], oid)
	var id := String(d.get("id", ""))
	match String(d.get("type", "")):
		"item":
			return _item_count(StringName(id), bool(d.get("held", false))) >= int(d.get("count", 1))
		"poi":
			return discovered_pois.has(StringName(id))
		"event":
			return events.has(id)
		"use":
			return events.has("use:" + id)
		"flag":
			var v: Variant = Game.get_flag(StringName(id), false)
			return v == d["value"] if d.has("value") else bool(v)
		"crafted":
			return crafted.has(id)
		"log":
			return found_logs.has(StringName(id))
		"scan":
			var s: Variant = Game.get_flag(&"scanned", [])
			return s is Array and (s as Array).has(id)
		"objective":
			return is_objective_done(StringName(id))
		"time":
			var m: Dictionary = obj_meta.get(String(oid), {})
			return not m.is_empty() and abs_hours() - float(m.get("t0", 0.0)) >= float(d.get("hours", 1.0))
		"dawn":
			var t0 := -1.0
			if d.has("since_flag"):
				t0 = float(flag_time.get(String(d["since_flag"]), -1.0))
			elif oid != &"":
				t0 = float((obj_meta.get(String(oid), {}) as Dictionary).get("t0", -1.0))
			else:
				# beats: the first morning after the rest of the beat became possible (flag has_radio)
				t0 = float(flag_time.get("has_radio", -1.0))
			return t0 >= 0.0 and abs_hours() >= next_dawn(t0)
		"altitude":
			var p := _player_pos()
			if p == Vector3.INF or p.y < INTERIOR_MAX_Y:
				return false
			if d.has("min") and p.y < float(d["min"]):
				return false
			if d.has("max") and p.y > float(d["max"]):
				return false
			return true
		"near":
			return _near(d)
		"insulation":
			var pl := Game.player
			if pl == null or not pl.has_method(&"get_insulation"):
				return false
			return float(pl.call(&"get_insulation")) >= float(d.get("min", 0.0))
		"hour_between":
			var h := Climate.hours
			var a := float(d.get("from", 0.0))
			var b := float(d.get("to", 24.0))
			return (h >= a and h < b) if a <= b else (h >= a or h < b)
		"vital_below":
			var v := _vitals()
			if v == null:
				return false
			var val: Variant = v.get(StringName(d.get("vital", "health")))
			return val != null and float(val) < float(d.get("value", 0.0))
		"weather":
			return (d.get("ids", []) as Array).has(String(Climate.weather))
		"creature_near":
			return _creature_near(StringName(d.get("species", "")), float(d.get("radius", 50.0)))
	return false


static func next_dawn(t0: float) -> float:
	var from := t0 + 3.0
	var dawn := floorf(from / 24.0) * 24.0 + DAWN_HOUR
	if dawn < from:
		dawn += 24.0
	return dawn


func _near(d: Dictionary) -> bool:
	var p := _player_pos()
	if p == Vector3.INF:
		return false
	var r := float(d.get("radius", 10.0))
	if d.has("socket"):
		var n := _socket_node(String(d["socket"]))
		return n != null and n.global_position.distance_to(p) <= r
	return _near_poi(StringName(d.get("poi", "")), r)


func _near_poi(poi_id: StringName, r: float) -> bool:
	var p := _player_pos()
	var poi: Dictionary = TerrainData.get_poi(poi_id)
	if p == Vector3.INF or poi.is_empty() or p.y < INTERIOR_MAX_Y:
		return false
	var c: Vector3 = poi["position"]
	return Vector2(p.x - c.x, p.z - c.z).length() <= r


func _creature_near(species: StringName, r: float) -> bool:
	var p := _player_pos()
	if p == Vector3.INF or not is_inside_tree():
		return false
	for c in get_tree().get_nodes_in_group(&"creature"):
		if not (c is Node3D) or (c as Node3D).global_position.distance_to(p) > r:
			continue
		if c.has_method(&"is_dead") and bool(c.call(&"is_dead")):
			continue
		if c.get(&"dead") == true or c.get(&"active") == false:
			continue
		var pid: Variant = c.get(&"persistent_id")
		var sp: Variant = c.get(&"species")
		if (pid != null and StringName(str(pid)) == species) or (sp != null and StringName(str(sp)) == species):
			return true
		var def: Variant = c.get(&"def")
		if def is Object and (def as Object).get(&"id") != null and StringName(str((def as Object).get(&"id"))) == species:
			return true
	return false


func _item_count(id: StringName, held: bool) -> int:
	var n := 0
	var inv := _inventory()
	if inv:
		n += inv.count(id)
	var pl := Game.player
	if pl:
		var eq: Variant = pl.get(&"equipment")
		if eq is Dictionary:
			for s in eq:
				if StringName(eq[s]) == id:
					n += 1
	if held:
		return n
	return maxi(n, int(acquired.get(String(id), 0)))


# ============================================================================================ actions

func _run_actions(list: Array) -> void:
	for a in list:
		if not (a is Dictionary):
			continue
		var id := str(a.get("id", ""))
		match String(a.get("do", "")):
			"voice":
				if bool(a.get("radio", false)) and not _has_radio():
					continue
				queue_voice(StringName(id), "radio", "", String(a.get("then", "")))
			"voice3d":
				queue_voice(StringName(id), "3d", String(a.get("at", "")), String(a.get("then", "")))
			"stinger":
				if not instant:
					Audio.play_stinger(StringName(id))
			"music":
				if not instant:
					_music = StringName(a.get("state", "explore"))
					Audio.set_music_state(_music)
			"flag":
				_set_flag(StringName(id), a.get("value", true))
			"weather":
				Climate.set_weather(StringName(id), 0.0 if instant else float(a.get("transition", 60.0)))
				if a.has("lock"):
					Climate.weather_locked = bool(a["lock"])
			"notify":
				if not instant:
					Game.notify(String(a.get("text", "")), StringName(a.get("kind", "info")))
			"give":
				_give(StringName(id), int(a.get("count", 1)))
			"log":
				if not found_logs.has(StringName(id)):
					found_logs.append(StringName(id))
					Events.log_found.emit(StringName(id))
			"blueprint_flag":
				Blueprints.unlock_for_flag(StringName(id))
			"event":
				trigger(StringName(id))
			"sequence":
				_run_sequence(id)
			"reveal":
				for p in a.get("ids", []):
					_reveal(StringName(p))
			"act":
				set_act(int(a.get("id", act)))


func _set_flag(f: StringName, value: Variant = true) -> void:
	Game.set_flag(f, value)
	if not flag_time.has(String(f)):
		flag_time[String(f)] = abs_hours()
	story_event.emit(StringName("flag:" + String(f)))
	_dirty = true


func _reveal(p: StringName) -> void:
	if not revealed_pois.has(p):
		revealed_pois.append(p)


func _give(id: StringName, n: int) -> void:
	if not ItemDB.has_item(id) or n <= 0:
		return
	var inv := _inventory()
	var left := n
	if inv:
		left = inv.add(id, n)
	var got := n - left
	if got > 0:
		Events.item_picked_up.emit(id, got)
		if not instant:
			Game.notify("+%d %s" % [got, String(ItemDB.get_item(id).get("name", id))], &"item")
	if left > 0 and Game.player is Node3D:
		var root := get_tree().get_first_node_in_group(&"items_root")
		if root and root.has_method(&"spawn_pickup"):
			root.call(&"spawn_pickup", id, left, (Game.player as Node3D).global_position + Vector3.UP * 0.5)
	if inv == null:
		acquired[String(id)] = int(acquired.get(String(id), 0)) + n


func _give_starting_kit() -> void:
	var pl := Game.player
	var inv := _inventory()
	if pl == null or inv == null:
		return
	for id: StringName in [&"field_jacket", &"hiking_pants", &"boots"]:
		if not ItemDB.has_item(id):
			continue
		var eq: Variant = pl.get(&"equipment")
		if eq is Dictionary and (eq as Dictionary).values().has(id):
			continue
		if inv.add(id, 1) == 0 and pl.has_method(&"equip"):
			pl.call(&"equip", id)


# ============================================================================================ events in

func _on_item_acquired(id: StringName, count: int) -> void:
	acquired[String(id)] = int(acquired.get(String(id), 0)) + count
	_dirty = true
	# salvage progress toasts
	var sal: Dictionary = graph.get_objective(&"salvage_wreck") if graph else {}
	var prog: Array = sal.get("progress", [])
	if has_objective(&"salvage_wreck") and not is_objective_done(&"salvage_wreck") and prog.has(String(id)) and not _salvage_seen.has(String(id)):
		_salvage_seen[String(id)] = true
		var n := 0
		for p in prog:
			if int(acquired.get(String(p), 0)) > 0:
				n += 1
		if not instant and n < prog.size():
			Game.notify("Salvaged %d / %d" % [n, prog.size()], &"objective")


func _on_item_crafted(id: StringName, count: int) -> void:
	crafted[String(id)] = int(crafted.get(String(id), 0)) + count
	acquired[String(id)] = int(acquired.get(String(id), 0)) + count
	_dirty = true


func _on_structure_built(id: StringName, _node: Node3D) -> void:
	crafted[String(id)] = int(crafted.get(String(id), 0)) + 1
	_dirty = true


func _on_game_loaded(_slot: int) -> void:
	_after_load.call_deferred()


# ============================================================================================ voice

## mode: "radio" (Events.radio_message: the handheld / wreck radio), "3d" (in person at a socket, falls back
## to the radio when far away), "plain" (a dictaphone log). `then` = event raised when the line ends.
func queue_voice(id: StringName, mode := "radio", at := "", then := "", low := false, front := false) -> void:
	if not _voice.has(String(id)):
		push_warning("Story: unknown voice line %s" % id)
		if then != "":
			trigger(StringName(then))
		return
	var e := {"id": id, "mode": mode, "at": at, "then": then, "low": low}
	if instant:
		_vq.append(e)
		_drain_instant()
		return
	if front:
		# the player pressed play on a recording: interrupt hints, never story lines
		if _v_busy > 0.0 and _v_low:
			Audio.stop_voice()
			_finish_line()
		elif _v_busy <= 0.0 and _voice_elsewhere():
			Audio.stop_voice()      # the wreck's weather loop or another recording
		_vq.push_front(e)
	else:
		_vq.append(e)


func _drain_instant() -> void:
	while not _vq.is_empty():
		var e: Dictionary = _vq.pop_front()
		if String(e["then"]) != "":
			trigger(StringName(e["then"]))


func _update_voice(delta: float) -> void:
	if _v_busy > 0.0:
		if get_tree().paused:
			return
		_v_busy -= delta
		if _v_busy <= 0.0:
			_finish_line()
		return
	if _vq.is_empty():
		return
	if _voice_elsewhere():
		return    # a line started elsewhere (the wreck's weather loop, a log) finishes first
	var e: Dictionary = _vq.pop_front()
	_play_line(e)


func _play_line(e: Dictionary) -> void:
	var id: StringName = e["id"]
	var dur := float((_voice.get(String(id), {}) as Dictionary).get("duration_s", 3.0))
	match String(e["mode"]):
		"3d":
			var n := _socket_node(String(e["at"]))
			var p := _player_pos()
			if n and p != Vector3.INF and n.global_position.distance_to(p) < 28.0:
				dur = Audio.play_voice_3d(id, n)
			else:
				Events.radio_message.emit(id)
		"plain":
			dur = Audio.play_voice(id)
		_:
			Events.radio_message.emit(id)
	_v_busy = maxf(0.5, dur) + 0.8
	_v_then = String(e["then"])
	_v_low = bool(e.get("low", false))


func _finish_line() -> void:
	_v_busy = 0.0
	var t := _v_then
	_v_then = ""
	if t != "":
		trigger(StringName(t))


# ============================================================================================ sequences

func _run_sequence(id: String) -> void:
	if _running_seq.has(id) and id != "ending":
		return
	_running_seq[id] = true
	match id:
		"generator_on":
			_seq_generator_on()
		"relay_repair":
			_seq_relay_repair()
		"final_night":
			pass     # handled by _update_world_beats (restart-safe)
		"rescue":
			_seq_rescue()
		"ending":
			_seq_ending()
		_:
			push_warning("Story: unknown sequence %s" % id)


func _wait(seconds: float) -> void:
	if dev_fast:
		seconds *= 0.05
	if instant or seconds <= 0.0 or not is_inside_tree():
		return
	await get_tree().create_timer(seconds, false).timeout


func _seq_prologue() -> void:
	_in_cinematic = true
	Game.set_cinematic(true)
	Events.cinematic_started.emit(&"prologue")
	var pl := Game.player
	if pl and pl.has_method(&"set_input_enabled"):
		pl.call(&"set_input_enabled", false)
	_place_player(&"crash_site", &"Arrive_Wake")
	_face_socket("crash_site/Use_Radio", -6.0)
	Climate.locked = true
	var ov := _get_overlay()
	ov.call(&"show_black")
	ov.call(&"set_skip_visible", true)
	Audio.set_music_state(&"silence")
	_music = &"silence"
	var line: Dictionary = _voice.get("prologue", {})
	var evs: Dictionary = line.get("events", {})
	var impact := float(evs.get("impact", 222.65))
	var total := float(line.get("duration_s", impact + 9.0))
	Audio.play_voice(&"prologue")
	var t := 0.0
	var skipped := false
	var shook := {}
	while t < impact:
		await get_tree().process_frame
		if not is_inside_tree() or Game.world == null:
			return
		t += get_process_delta_time()
		for k in ["engine_rough", "engine_quit", "brace"]:
			if not shook.has(k) and evs.has(k) and t >= float(evs[k]):
				shook[k] = true
				if pl and pl.has_method(&"add_trauma"):
					pl.call(&"add_trauma", 0.25)
		if bool(ov.call(&"skip_requested")) or dev_fast and t > 0.45:
			skipped = true
			break
	ov.call(&"set_skip_visible", false)
	if skipped:
		Audio.stop_voice()
		ov.call(&"clear_subtitle")
	Audio.play_sfx(&"plane_crash")
	if pl and pl.has_method(&"add_trauma"):
		pl.call(&"add_trauma", 1.0)
	await _wait(maxf(3.0, total - impact) if not skipped else 3.5)
	Audio.stop_voice()
	ov.call(&"clear_subtitle")
	await _wait(1.5)
	ov.call(&"caption", "Aldous Range  ·  northern British Columbia", 5.0)
	_wake(false)


## The player comes to in the wreck at dusk, in light snow.
func _wake(fast: bool) -> void:
	Climate.locked = false
	if fast:
		Climate.reset_new_game()
		_place_player(&"crash_site", &"Arrive_Wake")
		_face_socket("crash_site/Use_Radio", -6.0)
	var ov := _get_overlay()
	events["woke"] = true
	set_act(1, true)
	if ov and not instant:
		var cockpit := _socket_node("crash_site/Use_Radio")
		if cockpit:
			Audio.play_sfx(&"metal_creak", cockpit.global_position)
		ov.call(&"fade_from_black", 0.6 if dev_fast else (1.2 if fast else 5.0))
	_in_cinematic = false
	Game.set_cinematic(false)
	Events.cinematic_ended.emit(&"prologue")
	var pl := Game.player
	if pl and pl.has_method(&"set_input_enabled"):
		pl.call(&"set_input_enabled", true)
	_music = &""
	_beacon_t = 25.0
	_dirty = true
	evaluate_now()


func _seq_generator_on() -> void:
	_set_flag(&"generator_running")
	_set_flag(&"station_power")
	trigger(&"generator_started")
	var st := _structures()
	if st and st.has_method(&"set_station_power"):
		st.call(&"set_station_power", true, not instant)
	if not instant:
		Game.notify("The generator catches, stumbles, and settles into a steady beat. Lights come on across the col.", &"info")
	_running_seq.erase("generator_on")


func _seq_relay_repair() -> void:
	_set_flag(&"relay_module")
	var st0 := _structures()
	if st0 and st0.has_method(&"set_relay_searching"):
		st0.call(&"set_relay_searching")
	if not instant:
		Audio.play_sfx(&"radio_beep", _player_pos() if _player_pos() != Vector3.INF else null)
		Game.notify("The relay powers up. An amber light blinks while it searches for the satellite…", &"info")
	await _wait(9.0)
	var st := _structures()
	if st and st.has_method(&"set_relay_online"):
		st.call(&"set_relay_online", true)
	_set_flag(&"relay_online")
	queue_voice(&"mara_relay_online", "radio")
	queue_voice(&"final_call", "radio", "", "relay_transmitted")
	while not instant and not events.has("relay_transmitted"):
		await get_tree().create_timer(0.5, false).timeout
		if not is_inside_tree() or Game.world == null:
			return
	_set_flag(&"relay_repaired")
	trigger(&"relay_repaired")
	_running_seq.erase("relay_repair")


func _seq_rescue() -> void:
	Climate.weather_locked = false
	Climate.set_weather(&"clear", 0.0 if instant else 45.0)
	Climate.weather_locked = true
	queue_voice(&"rescue_dawn", "radio")
	if instant:
		_heli_landed = true
		trigger(&"heli_landed")
		_running_seq.erase("rescue")
		return
	await _wait(6.0)
	var st := _structures()
	if st and st.has_method(&"spawn_helicopter"):
		_heli = st.call(&"spawn_helicopter") as Node3D
	if _heli == null:
		_heli_landed = true
		trigger(&"heli_landed")
		trigger(&"rescue_boarded")
		return
	Audio.set_music_state(&"finale")
	_music = &"finale"
	if _heli.has_signal(&"landed"):
		await Signal(_heli, &"landed")
	_heli_landed = true
	trigger(&"heli_landed")
	Game.notify("Rescue One-Six is down on the pad. Get aboard.", &"objective")
	_running_seq.erase("rescue")


func _seq_ending() -> void:
	_in_cinematic = true
	if not instant:
		Game.set_cinematic(true)
		Events.cinematic_started.emit(&"ending")
		var pl := Game.player
		if pl and pl.has_method(&"set_input_enabled"):
			pl.call(&"set_input_enabled", false)
		Audio.set_music_state(&"finale")
		var d := Audio.play_voice(&"mara_ending")
		await _wait(d + 1.0)
		var ov := _get_overlay()
		ov.call(&"fade_to_black", 3.0)
		await _wait(3.2)
	_set_flag(&"game_complete")
	trigger(&"story_complete")
	complete = true
	Climate.weather_locked = false
	if _heli and is_instance_valid(_heli):
		_heli.queue_free()
		_heli = null
	story_completed.emit()
	if instant:
		_in_cinematic = false
		return
	# Free roam afterwards: the save now holds the finished story, standing on the pad at dawn.
	var pl2 := Game.player
	if pl2 and pl2.has_method(&"set_input_enabled"):
		pl2.call(&"set_input_enabled", true)
	if autosave_enabled:
		Save.save_game(0)
	var ov2 := _get_overlay()
	ov2.call(&"show_credits")
	await Signal(ov2, &"credits_finished")
	if not is_instance_valid(ov2):
		return
	_in_cinematic = false
	Events.cinematic_ended.emit(&"ending")
	Game.quit_to_menu()


# ============================================================================================ save/load

func save_state() -> Dictionary:
	var objs := []
	for o in objectives:
		objs.append({"id": String(o["id"]), "text": o["text"], "done": o["done"]})
	return {
		"version": 2,
		"objectives": objs,
		"logs": found_logs.map(func(x): return String(x)),
		"pois": discovered_pois.map(func(x): return String(x)),
		"revealed": revealed_pois.map(func(x): return String(x)),
		"act": act,
		"events": events.keys(),
		"acquired": acquired.duplicate(),
		"crafted": crafted.duplicate(),
		"beats": beats_done.keys(),
		"hints": hint_log.duplicate(true),
		"meta": obj_meta.duplicate(true),
		"flag_time": flag_time.duplicate(),
		"complete": complete,
	}


func load_state(d: Dictionary) -> void:
	reset_story()
	for o in d.get("objectives", []):
		var def: Dictionary = graph.get_objective(StringName(o["id"])) if graph else {}
		var e := {"id": StringName(o["id"]), "text": String(o.get("text", "")), "done": bool(o.get("done", false)),
			"act": int(def.get("act", 0))}
		if def.has("poi"):
			e["poi"] = String(def["poi"])
		objectives.append(e)
	for l in d.get("logs", []):
		found_logs.append(StringName(l))
	for p in d.get("pois", []):
		discovered_pois.append(StringName(p))
	for p in d.get("revealed", []):
		revealed_pois.append(StringName(p))
	act = int(d.get("act", 1 if not objectives.is_empty() else 0))
	for e in d.get("events", []):
		events[String(e)] = true
	if not objectives.is_empty():
		events["woke"] = true
	for k in (d.get("acquired", {}) as Dictionary):
		acquired[String(k)] = int(d["acquired"][k])
	for k in (d.get("crafted", {}) as Dictionary):
		crafted[String(k)] = int(d["crafted"][k])
	for b in d.get("beats", []):
		beats_done[String(b)] = true
	hint_log = (d.get("hints", {}) as Dictionary).duplicate(true)
	obj_meta = (d.get("meta", {}) as Dictionary).duplicate(true)
	flag_time = (d.get("flag_time", {}) as Dictionary).duplicate()
	complete = bool(d.get("complete", false))
	_dirty = true


## Re-applies world state after a load (power, lights, depot loot) and resumes restart-safe sequences.
func _after_load() -> void:
	_in_cinematic = false
	var st := _structures()
	if st and st.has_method(&"apply_story_state"):
		st.call(&"apply_story_state")
	if has_objective(&"rescue") and not is_objective_done(&"rescue"):
		_running_seq.erase("rescue")
		_run_sequence("rescue")
	if complete:
		Climate.weather_locked = false
	_music = &""
	_dirty = true


func _autosave() -> void:
	if instant or not autosave_enabled or complete or Game.state != Game.State.PLAYING or Game.world == null:
		return
	if Save.save_game(0):
		Game.notify("Progress saved", &"info")


# ============================================================================================ helpers

func _structures() -> Node:
	if not is_inside_tree():
		return null
	return get_tree().get_first_node_in_group(&"poi_structures")


func _socket_node(key: String) -> Node3D:
	var parts := key.split("/")
	if parts.size() != 2:
		return null
	var st := _structures()
	if st == null or not st.has_method(&"get_socket"):
		return null
	return st.call(&"get_socket", StringName(parts[0]), StringName(parts[1])) as Node3D


func _place_player(site: StringName, socket: StringName) -> void:
	var pl := Game.player
	var n := _socket_node("%s/%s" % [site, socket])
	if pl == null or n == null:
		return
	if pl.has_method(&"teleport"):
		pl.call(&"teleport", n.global_position + Vector3.UP * 0.05, rad_to_deg(n.global_rotation.y))
	elif pl is Node3D:
		(pl as Node3D).global_position = n.global_position


## Turns the player to look at a socket (the wake: towards the cockpit, Dale and the radio).
func _face_socket(key: String, pitch_deg: float) -> void:
	var pl := Game.player
	var n := _socket_node(key)
	if pl == null or n == null or not (pl is Node3D):
		return
	var d := n.global_position - (pl as Node3D).global_position
	var yaw := rad_to_deg(atan2(-d.x, -d.z))
	if pl.has_method(&"set_look"):
		pl.call(&"set_look", yaw, pitch_deg)
	elif pl.has_method(&"teleport"):
		pl.call(&"teleport", (pl as Node3D).global_position, yaw)


func _player_pos() -> Vector3:
	var pl := Game.player
	if pl == null or not is_instance_valid(pl) or not (pl is Node3D):
		return Vector3.INF
	return (pl as Node3D).global_position


func _interior_at(p: Vector3) -> StringName:
	if p == Vector3.INF or p.y >= INTERIOR_MAX_Y:
		return &""
	var st := _structures()
	if st and st.has_method(&"interior_at"):
		return StringName(st.call(&"interior_at", p))
	return &""


func _inventory() -> Inventory:
	var pl := Game.player
	if pl == null:
		return null
	var v: Variant = pl.get(&"inventory")
	return v as Inventory if v is Inventory else null


func _vitals() -> Object:
	var pl := Game.player
	if pl == null:
		return null
	var v: Variant = pl.get(&"vitals")
	return v as Object if v is Object else null


## Mara can only reach you once you carry the ranger's handheld (channel 6).
func _has_radio() -> bool:
	if not bool(Game.get_flag(&"has_radio", false)):
		return false
	return _inventory() == null or _item_count(&"radio_handheld", true) > 0


func _voice_elsewhere() -> bool:
	return Audio.voice != null and bool(Audio.voice.call(&"is_playing"))


func _get_overlay() -> CanvasLayer:
	if instant or not is_inside_tree():
		return null
	if _overlay == null or not is_instance_valid(_overlay):
		_overlay = OverlayScript.new()
		_overlay.name = "StoryOverlay"
		add_child(_overlay)   # under this autoload: the root may be busy instancing the world right now
	return _overlay

extends Node
## Adaptive music director (Audio workstream). Plays cues from data/music.json by state.
##
## Pacing follows Subnautica: in exploration states a cue plays through once, then 1–4 minutes of silence
## before the next; urgent states (danger, blizzard, summit, finale, menu) start at once with a crossfade
## and keep music going. `explore` is an automatic state: it is refined from context (night, forest,
## alpine, blizzard) when cues for those exist. `danger` releases itself after DANGER_HOLD seconds unless
## it is requested again, so a creature system that forgets to reset it cannot leave combat music stuck.
##
## music.json schema (music stream): {cue_id: {file, loop, bpm, key, intensity, duration_s}}; optional
## "state" or "stinger" fields. Otherwise the state is inferred from the id prefix ("forest_2" → forest,
## "stinger_discovery" → discovery stinger).

signal cue_started(cue_id: StringName, state: StringName)
signal cue_ended(cue_id: StringName)

const PATH := "res://data/music.json"
const MUSIC_DIR := "res://assets/audio/music/"
const STATES: Array[StringName] = [&"menu", &"explore", &"night", &"forest", &"alpine", &"station", &"danger",
	&"blizzard", &"summit", &"finale", &"silence"]
const URGENT: Array[StringName] = [&"menu", &"danger", &"blizzard", &"summit", &"finale"]
const AMBIENT: Array[StringName] = [&"explore", &"night", &"forest", &"alpine", &"station"]
const STINGERS: Array[StringName] = [&"discovery", &"danger", &"objective", &"death", &"blueprint"]
const DANGER_HOLD := 45.0
const CROSSFADE_URGENT := 2.5
const FADE_AMBIENT := 6.0

var cues: Dictionary = {}              # StringName -> Dictionary (normalised cue)
var by_state: Dictionary = {}          # StringName -> Array[StringName]
var stingers: Dictionary = {}          # StringName -> Array[StringName]

var requested_state: StringName = &"explore"
var state: StringName = &""
var auto_context := true
## When set, replaces the detected context (tests, cinematics that want a fixed mood).
var context_override: StringName = &""
var gap_range := Vector2(60.0, 240.0)
var enabled := true

var _players: Array[AudioStreamPlayer] = []
var _gain: PackedFloat32Array = PackedFloat32Array([0.0, 0.0])
var _target: PackedFloat32Array = PackedFloat32Array([0.0, 0.0])
var _rate: PackedFloat32Array = PackedFloat32Array([1.0, 1.0])
var _cue_of: Array[StringName] = [&"", &""]
var _active := 0
var _stinger: AudioStreamPlayer
var _gap := 25.0
var _elapsed := 0.0
var _limit := 0.0
var _danger_timer := 0.0
var _last_cue: Dictionary = {}
var _duck := 1.0
var _duck_timer := 0.0
var _last_stinger_ms: Dictionary = {}
var _last_any_stinger_ms := -100000
var _context_timer := 0.0
var _context_state: StringName = &"explore"


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in 2:
		var p := AudioStreamPlayer.new()
		p.name = "Music%d" % i
		p.bus = &"Music"
		p.volume_db = -80.0
		add_child(p)
		p.finished.connect(_on_finished.bind(i))
		_players.append(p)
	_stinger = AudioStreamPlayer.new()
	_stinger.name = "Stinger"
	_stinger.bus = &"Music"
	add_child(_stinger)
	load_catalog()


func _exit_tree() -> void:
	for p in _players:
		p.stop()
		p.stream = null
	_stinger.stop()
	_stinger.stream = null


# ------------------------------------------------------------------------------------------------ catalog

func load_catalog(path: String = PATH) -> void:
	var data: Dictionary = {}
	if FileAccess.file_exists(path):
		var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
		if v is Dictionary:
			data = v
	set_catalog(data)


## Replace the cue table (also used by tests with synthetic data).
func set_catalog(data: Dictionary) -> void:
	cues.clear()
	by_state.clear()
	stingers.clear()
	for k in data:
		var d: Variant = data[k]
		if not (d is Dictionary):
			continue
		var cue := {
			"id": StringName(k),
			"file": _norm_path(String(d.get("file", ""))),
			"loop": bool(d.get("loop", false)),
			"intensity": float(d.get("intensity", 0.5)),
			"duration_s": float(d.get("duration_s", 0.0)),
			"bpm": float(d.get("bpm", 0.0)),
		}
		var stg := _stinger_of(String(k), d)
		if stg != &"":
			cue["stinger"] = stg
			if not stingers.has(stg):
				stingers[stg] = [] as Array[StringName]
			(stingers[stg] as Array[StringName]).append(StringName(k))
		else:
			var st := _state_of(String(k), d)
			if st == &"":
				continue
			cue["state"] = st
			if not by_state.has(st):
				by_state[st] = [] as Array[StringName]
			(by_state[st] as Array[StringName]).append(StringName(k))
		cues[StringName(k)] = cue


func has_cues_for(s: StringName) -> bool:
	return by_state.has(s) and not (by_state[s] as Array).is_empty()


func _norm_path(f: String) -> String:
	if f == "" or f.begins_with("res://"):
		return f
	if f.contains("/"):
		return "res://" + f.trim_prefix("/")
	return MUSIC_DIR + f


func _stinger_of(k: String, d: Dictionary) -> StringName:
	if d.has("stinger"):
		return StringName(d["stinger"])
	if String(d.get("type", "")) == "stinger" or k.begins_with("stinger_") or k.begins_with("stinger-"):
		var rest := k.substr(8)
		for s in STINGERS:
			if rest.begins_with(String(s)):
				return s
		return StringName(rest.get_slice("_", 0))
	return &""


func _state_of(k: String, d: Dictionary) -> StringName:
	if d.has("state"):
		return StringName(d["state"])
	var best := ""
	for s in STATES:
		var ss := String(s)
		if k == ss or k.begins_with(ss + "_") or k.begins_with(ss + "-") or (k.begins_with(ss) and k.length() > ss.length() and k[ss.length()].is_valid_int()):
			if ss.length() > best.length():
				best = ss
	# common synonyms from composers
	if best == "":
		var syn := {"title": "menu", "main": "menu", "theme": "menu", "day": "explore", "exploration": "explore",
			"combat": "danger", "chase": "danger", "storm": "blizzard", "whiteout": "blizzard", "ending": "finale",
			"credits": "finale", "rescue": "finale", "high": "alpine", "glacier": "alpine", "valley": "explore"}
		for w in syn:
			if k.begins_with(w):
				best = syn[w]
				break
	return StringName(best)


# ------------------------------------------------------------------------------------------------ API

func set_state(s: StringName) -> void:
	if not STATES.has(s):
		push_warning("Music: unknown state %s" % s)
		return
	requested_state = s
	if s == &"danger":
		_danger_timer = DANGER_HOLD
	_update_state(true)


func play_stinger(id: StringName) -> bool:
	var now := Time.get_ticks_msec()
	if now - int(_last_stinger_ms.get(id, -100000)) < 4000 or now - _last_any_stinger_ms < 1500:
		return false
	var list: Array = stingers.get(id, [])
	if list.is_empty():
		return false
	var cue: Dictionary = cues[list[randi() % list.size()]]
	var s := _load(cue["file"], false)
	if s == null:
		return false
	_last_stinger_ms[id] = now
	_last_any_stinger_ms = now
	_stinger.stream = s
	_stinger.volume_db = 0.0
	_stinger.play()
	_duck = 0.35
	_duck_timer = maxf(1.5, s.get_length() * 0.8)
	return true


func current_cue() -> StringName:
	return _cue_of[_active] if _players[_active].playing else &""


func is_playing() -> bool:
	return _players[0].playing or _players[1].playing


func seconds_until_next() -> float:
	return _gap


# ------------------------------------------------------------------------------------------------ core

func _process(delta: float) -> void:
	if not enabled:
		return
	if requested_state == &"danger":
		_danger_timer -= delta
		if _danger_timer <= 0.0:
			requested_state = &"explore"
	_context_timer -= delta
	if _context_timer <= 0.0:
		_context_timer = 1.0
		_context_state = _context()
		_update_state(false)
	# fades
	for i in 2:
		if _gain[i] != _target[i]:
			var step := delta / maxf(_rate[i], 0.01)
			_gain[i] = move_toward(_gain[i], _target[i], step)
			if _gain[i] <= 0.0005 and _target[i] == 0.0 and _players[i].playing:
				_players[i].stop()
				cue_ended.emit(_cue_of[i])
		_players[i].volume_db = linear_to_db(maxf(_gain[i] * _duck_value(), 0.00001))
	if _duck_timer > 0.0:
		_duck_timer -= delta
	else:
		_duck = move_toward(_duck, 1.0, delta / 2.0)
	# pacing
	if state == &"silence" or state == &"":
		return
	var playing := _players[_active].playing and _target[_active] > 0.0
	if playing:
		_elapsed += delta
		if _limit > 0.0 and _elapsed >= _limit:
			_fade_out(_active, FADE_AMBIENT)
			_gap = randf_range(gap_range.x, gap_range.y)
		return
	if URGENT.has(state) and has_cues_for(state):
		_start_cue(state, CROSSFADE_URGENT)
		return
	_gap -= delta
	if _gap <= 0.0 and has_cues_for(state):
		_start_cue(state, 3.0)


func _duck_value() -> float:
	return _duck


func _context() -> StringName:
	if context_override != &"":
		return context_override
	if Game.state == Game.State.MENU or (Game.world == null and Game.state != Game.State.LOADING and Game.state != Game.State.PLAYING):
		return &"menu"
	if Game.state == Game.State.LOADING:
		return &"silence"
	if not auto_context:
		return &"explore"
	var pos: Variant = _listener_pos()
	if pos == null:
		return &"explore"
	var p: Vector3 = pos
	var weather: StringName = Climate.weather if "weather" in Climate else &"clear"
	if weather == &"blizzard" and p.y > 1900.0 and has_cues_for(&"blizzard"):
		return &"blizzard"
	var daylight := 1.0
	if Climate.has_method("get_daylight"):
		daylight = Climate.get_daylight()
	if daylight < 0.12 and has_cues_for(&"night"):
		return &"night"
	var biome: StringName = &"valley"
	if TerrainData.has_method("get_biome"):
		biome = TerrainData.get_biome(p.x, p.z)
	if (p.y > 2250.0 or biome in [&"alpine", &"glacier", &"summit"]) and has_cues_for(&"alpine"):
		return &"alpine"
	if TerrainData.has_method("get_masks") and TerrainData.get_masks(p.x, p.z).a > 0.45 and has_cues_for(&"forest"):
		return &"forest"
	return &"explore"


func _listener_pos() -> Variant:
	var vp := get_viewport()
	if vp:
		var cam := vp.get_camera_3d()
		if cam and cam.is_inside_tree():
			return cam.global_position
	if Game.player and is_instance_valid(Game.player):
		return Game.player.global_position
	return null


func _effective() -> StringName:
	var r := requested_state
	if _context_state == &"silence":
		return &"silence"
	if r == &"explore":
		return _context_state
	# in the main menu, gameplay states make no sense
	if _context_state == &"menu" and r != &"silence" and r != &"finale" and r != &"menu":
		return &"menu"
	return r


func _update_state(force: bool) -> void:
	var eff := _effective()
	if eff == state and not force:
		return
	var old := state
	state = eff
	if eff == old:
		return
	_on_state_changed(old, eff)


func _on_state_changed(old: StringName, new_state: StringName) -> void:
	if new_state == &"silence":
		_fade_out(0, 4.0)
		_fade_out(1, 4.0)
		return
	var cur_playing := _players[_active].playing and _target[_active] > 0.0
	if URGENT.has(new_state):
		if new_state == &"danger":
			play_stinger(&"danger")
		if has_cues_for(new_state):
			_start_cue(new_state, CROSSFADE_URGENT)
		elif cur_playing and URGENT.has(old):
			_fade_out(_active, FADE_AMBIENT)
		return
	# ambient target
	if URGENT.has(old) or old == &"":
		if cur_playing:
			_fade_out(_active, 5.0 if old != &"menu" else 3.0)
		_gap = randf_range(20.0, 60.0) if old != &"" and old != &"menu" else randf_range(15.0, 35.0)
		return
	if cur_playing:
		# a strong mood change (e.g. into the station, or night falling) retires the current cue gently
		if new_state == &"station" or old == &"station" or new_state == &"night" or old == &"night":
			_fade_out(_active, 8.0)
			_gap = randf_range(10.0, 25.0)
		return
	_gap = minf(_gap, randf_range(10.0, 30.0))


func _pick(s: StringName) -> StringName:
	var list: Array = by_state.get(s, [])
	if list.is_empty():
		return &""
	if list.size() == 1:
		return list[0]
	var last: StringName = _last_cue.get(s, &"")
	var choices: Array = list.filter(func(c): return c != last)
	if s == &"danger" or s == &"blizzard":
		choices.sort_custom(func(a, b): return float(cues[a]["intensity"]) > float(cues[b]["intensity"]))
		return choices[randi() % mini(2, choices.size())]
	return choices[randi() % choices.size()]


func _start_cue(s: StringName, fade: float) -> void:
	var cid := _pick(s)
	if cid == &"":
		return
	var cue: Dictionary = cues[cid]
	var urgent := URGENT.has(s)
	var stream := _load(cue["file"], urgent and bool(cue["loop"]))
	if stream == null:
		return
	var nxt := 1 - _active
	if _players[_active].playing:
		_fade_out(_active, fade)
	var p := _players[nxt]
	p.stream = stream
	_gain[nxt] = 0.0 if fade > 0.05 else 1.0
	_target[nxt] = 1.0
	_rate[nxt] = maxf(fade, 0.01)
	_cue_of[nxt] = cid
	p.volume_db = linear_to_db(maxf(_gain[nxt], 0.00001))
	p.play()
	_active = nxt
	_elapsed = 0.0
	_last_cue[s] = cid
	var dur := float(cue["duration_s"])
	if dur <= 0.0:
		dur = stream.get_length()
	# ambient loop cues play for a limited time then fade (music comes and goes)
	_limit = minf(maxf(dur * 2.0, 60.0), 180.0) if (not urgent and bool(cue["loop"])) else 0.0
	cue_started.emit(cid, s)


func _fade_out(i: int, seconds: float) -> void:
	_target[i] = 0.0
	_rate[i] = maxf(seconds, 0.01)


func _on_finished(i: int) -> void:
	if i != _active:
		return
	cue_ended.emit(_cue_of[i])
	_gain[i] = 0.0
	_target[i] = 0.0
	if AMBIENT.has(state):
		_gap = randf_range(gap_range.x, gap_range.y) if state != &"station" else randf_range(30.0, 90.0)


func _load(path: String, loop: bool) -> AudioStream:
	if path == "" or not ResourceLoader.exists(path):
		return null
	var s := load(path) as AudioStream
	if s and "loop" in s:
		s.set("loop", loop)
	return s

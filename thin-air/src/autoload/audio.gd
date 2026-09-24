extends Node
## Audio autoload — CONTRACT.md §3 "Audio". Owned by the Audio workstream.
##
## * Data-driven SFX from data/sfx.json: random variation (never the same file twice in a row), pitch
##   variation, per-group cooldown de-duplication (a system calling play_sfx and an Events hook firing for
##   the same moment produce one sound), per-id voice limits, distance culling.
## * 24 pooled AudioStreamPlayer3D + 2D + UI players; play_sfx_attached / play_loop create owned players.
## * Music director (data/music.json), ambience manager (beds + spatial ambient events), voice director.
## * Reverb environments drive the "Reverb" bus (SFX & Ambience are routed through it at runtime, dry 1.0);
##   set_muffled drives the Master low-pass.
## * Common gameplay events are sonified automatically from the Events bus (footsteps with surface/cold/
##   crampons, landing, pain, death, pickups, crafting, eating/drinking, inventory, scans, blueprints,
##   stingers). Calling the same ids directly as well is harmless (de-duplicated).
##
## Additions beyond the contract (see docs/audio_notes.md): play_voice_3d, play_ambient_event,
## start_loop_with_intro, is_loop_active, stop_all, get_listener_position, has_sfx, get_sfx_ids, voice_line_exists,
## set_menu_ambience, env_kind, catalog/music/ambience/voice sub-systems.

const SfxCatalog := preload("res://src/audio/sfx_catalog.gd")
const MusicDirector := preload("res://src/audio/music_director.gd")
const AmbienceManager := preload("res://src/audio/ambience_manager.gd")
const VoiceDirector := preload("res://src/audio/voice_director.gd")

const POOL_3D := 24
const POOL_2D := 8
const POOL_UI := 4

const REVERB_PRESETS := {
	&"outdoor": {"room_size": 0.9, "damping": 0.78, "wet": 0.06, "predelay_msec": 120.0, "predelay_feedback": 0.25, "hipass": 0.3, "spread": 1.0},
	&"forest": {"room_size": 0.55, "damping": 0.72, "wet": 0.12, "predelay_msec": 22.0, "predelay_feedback": 0.1, "hipass": 0.2, "spread": 1.0},
	&"interior": {"room_size": 0.28, "damping": 0.6, "wet": 0.16, "predelay_msec": 6.0, "predelay_feedback": 0.05, "hipass": 0.1, "spread": 0.8},
	&"cave": {"room_size": 0.88, "damping": 0.35, "wet": 0.36, "predelay_msec": 28.0, "predelay_feedback": 0.2, "hipass": 0.08, "spread": 1.0},
	&"station": {"room_size": 0.32, "damping": 0.35, "wet": 0.14, "predelay_msec": 4.0, "predelay_feedback": 0.05, "hipass": 0.12, "spread": 0.7},
}
const PAIN_TYPES: Array[StringName] = [&"blunt", &"cut", &"pierce", &"bite", &"claw", &"fall", &"fire"]

var catalog = SfxCatalog.new()
var music: Node = null
var ambience: Node = null
var voice: Node = null
var env_kind: StringName = &"outdoor"

var _env_explicit: StringName = &""
var _reverb_cur := {}
var _reverb_fx: AudioEffectReverb = null
var _lpf: AudioEffectFilter = null
var _muffle := 0.0
var _muffle_target := 0.0
var _env_timer := 0.0

var _root3d: Node3D
var _root2d: Node
var _rootui: Node
var _pool: Array[AudioStreamPlayer3D] = []
var _pool_id: Array[StringName] = []
var _pool_t: PackedFloat64Array = PackedFloat64Array()
var _pool_low: Array[bool] = []
var _pool2d: Array[AudioStreamPlayer] = []
var _pool2d_id: Array[StringName] = []
var _pool2d_t: PackedFloat64Array = PackedFloat64Array()
var _ui: Array[AudioStreamPlayer] = []
var _ui_next := 0
var _last: Dictionary = {}           # group -> [time_s, position|null]
var _loops: Array = []               # [WeakRef(player), id]


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_setup_buses()
	catalog.load_catalog()
	catalog.warm_up()
	_root3d = Node3D.new()
	_root3d.name = "Pool3D"
	_root3d.top_level = true
	_root3d.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(_root3d)
	for i in POOL_3D:
		var p := AudioStreamPlayer3D.new()
		p.name = "P3D_%d" % i
		p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		p.max_polyphony = 1
		p.max_db = 6.0
		_root3d.add_child(p)
		_pool.append(p)
		_pool_id.append(&"")
		_pool_t.append(0.0)
		_pool_low.append(false)
	_root2d = Node.new()
	_root2d.name = "Pool2D"
	_root2d.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(_root2d)
	for i in POOL_2D:
		var p2 := AudioStreamPlayer.new()
		p2.name = "P2D_%d" % i
		_root2d.add_child(p2)
		_pool2d.append(p2)
		_pool2d_id.append(&"")
		_pool2d_t.append(0.0)
	_rootui = Node.new()
	_rootui.name = "PoolUI"
	_rootui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(_rootui)
	for i in POOL_UI:
		var pu := AudioStreamPlayer.new()
		pu.name = "UI_%d" % i
		pu.bus = &"UI"
		_rootui.add_child(pu)
		_ui.append(pu)
	music = MusicDirector.new()
	music.name = "Music"
	add_child(music)
	voice = VoiceDirector.new()
	voice.name = "VoiceDirector"
	add_child(voice)
	ambience = AmbienceManager.new()
	ambience.name = "Ambience"
	ambience.audio = self
	add_child(ambience)
	_connect_events()


func _exit_tree() -> void:
	# release cached streams/entries before engine shutdown (avoids leak reports at exit)
	for p in _pool:
		p.stop()
		p.stream = null
	for p2 in _pool2d:
		p2.stop()
		p2.stream = null
	for pu in _ui:
		pu.stop()
		pu.stream = null
	if catalog:
		catalog.release()


# ================================================================================================ contract API

func play_sfx(id: StringName, position: Variant = null, volume_db := 0.0, pitch := 1.0) -> void:
	var e: SfxCatalog.Entry = catalog.get_entry(id)
	if e == null:
		return
	_play_entry(e, position, volume_db, pitch, false, false)


func play_sfx_attached(id: StringName, node: Node3D, volume_db := 0.0) -> AudioStreamPlayer3D:
	var e: SfxCatalog.Entry = catalog.get_entry(id)
	if e == null or node == null or not is_instance_valid(node) or not node.is_inside_tree():
		return null
	if _deduped(e, node.global_position):
		return null
	var s: AudioStream = catalog.pick_stream(e)
	if s == null:
		return null
	var p := AudioStreamPlayer3D.new()
	_configure3d(p, e, volume_db)
	p.stream = s
	p.pitch_scale = _pitch(e, 1.0)
	node.add_child(p)
	p.play()
	if not e.loop:
		p.finished.connect(p.queue_free)
	return p


func play_loop(id: StringName, node: Node3D, volume_db := 0.0) -> AudioStreamPlayer3D:
	var e: SfxCatalog.Entry = catalog.get_entry(id)
	if e == null or node == null or not is_instance_valid(node):
		return null
	var s: AudioStream = catalog.stream_at(e, randi() % maxi(1, e.files.size()))
	if s == null:
		return null
	var p := AudioStreamPlayer3D.new()
	p.name = "Loop_" + String(id)
	_configure3d(p, e, volume_db)
	p.stream = s
	if not e.loop:
		p.finished.connect(p.play)
	node.add_child(p)
	_track_loop(p, id)
	if not p.is_inside_tree():
		# caller attached us to a node that is not in the scene yet: start when it enters
		p.autoplay = true
		return p
	var target_db := p.volume_db
	p.volume_db = target_db - 40.0
	p.play(randf() * maxf(0.0, s.get_length() - 0.5) if e.loop else 0.0)
	var tw := p.create_tween()
	tw.tween_property(p, "volume_db", target_db, 0.4)
	return p


func play_ui(id: StringName) -> void:
	var e: SfxCatalog.Entry = catalog.get_entry(id)
	if e == null or _deduped(e, null):
		return
	var s: AudioStream = catalog.pick_stream(e)
	if s == null:
		return
	var p: AudioStreamPlayer = _ui[_ui_next]
	_ui_next = (_ui_next + 1) % _ui.size()
	p.stream = s
	p.volume_db = e.volume_db
	p.pitch_scale = _pitch(e, 1.0)
	p.play()


func play_voice(line_id: StringName) -> float:
	var d: float = voice.play(line_id)
	_update_voice_duck()
	return d


func stop_voice() -> void:
	voice.stop()


func set_music_state(state: StringName) -> void:
	music.set_state(state)


func play_stinger(id: StringName) -> void:
	music.play_stinger(id)


func set_environment_reverb(kind: StringName) -> void:
	if not REVERB_PRESETS.has(kind):
		push_warning("Audio: unknown reverb environment %s" % kind)
		return
	# "outdoor" hands control back to automatic detection (forest / shelter interior / open)
	_env_explicit = &"" if kind == &"outdoor" else kind
	_env_timer = 0.0


func set_muffled(amount: float) -> void:
	_muffle_target = clampf(amount, 0.0, 1.0)


# ================================================================================================ additions

## Positional voice line (e.g. the crashed Otter's radio). Returns duration.
func play_voice_3d(line_id: StringName, node: Node3D) -> float:
	return voice.play(line_id, node)


## Low-priority positional one-shot for ambience: never steals a voice from gameplay sounds.
func play_ambient_event(id: StringName, position: Vector3, volume_db := 0.0) -> void:
	var e: SfxCatalog.Entry = catalog.get_entry(id)
	if e:
		_play_entry(e, position, volume_db, 1.0, true, false)


## Intro one-shot (e.g. generator_start) that hands over to a loop (generator_loop) with a crossfade.
## Returns the loop player (caller stops/frees it; freeing it also removes the intro).
func start_loop_with_intro(intro_id: StringName, loop_id: StringName, node: Node3D, volume_db := 0.0, overlap := 1.2) -> AudioStreamPlayer3D:
	var ei: SfxCatalog.Entry = catalog.get_entry(intro_id)
	var el: SfxCatalog.Entry = catalog.get_entry(loop_id)
	if el == null or node == null or not is_instance_valid(node):
		return null
	var lp := AudioStreamPlayer3D.new()
	lp.name = "Loop_" + String(loop_id)
	_configure3d(lp, el, volume_db)
	lp.stream = catalog.stream_at(el, 0)
	node.add_child(lp)
	_track_loop(lp, loop_id)
	if not lp.is_inside_tree():
		lp.autoplay = true
		return lp
	var delay := 0.0
	if ei:
		var s: AudioStream = catalog.pick_stream(ei)
		if s:
			var ip := AudioStreamPlayer3D.new()
			_configure3d(ip, ei, volume_db)
			ip.stream = s
			lp.add_child(ip)
			ip.play()
			ip.finished.connect(ip.queue_free)
			delay = maxf(0.0, s.get_length() - overlap)
	var target := lp.volume_db
	var start := func() -> void:
		if is_instance_valid(lp) and lp.is_inside_tree():
			lp.volume_db = target - 30.0
			lp.play()
			lp.create_tween().tween_property(lp, "volume_db", target, overlap)
	if delay <= 0.0:
		start.call()
	else:
		get_tree().create_timer(delay, false).timeout.connect(start)
	return lp


func _track_loop(p: AudioStreamPlayer3D, id: StringName) -> void:
	if _loops.size() >= 32:
		for i in range(_loops.size() - 1, -1, -1):
			var q = _loops[i][0].get_ref()
			if q == null or not is_instance_valid(q):
				_loops.remove_at(i)
	_loops.append([weakref(p), id])


func is_loop_active(id: StringName) -> bool:
	for i in range(_loops.size() - 1, -1, -1):
		var p = _loops[i][0].get_ref()
		if p == null or not is_instance_valid(p):
			_loops.remove_at(i)
			continue
		if _loops[i][1] == id and p.playing:
			return true
	return false


## Immediately silences every pooled one-shot, the voice and the ambience beds (music fades). Used when the
## world is torn down and by tests.
func stop_all() -> void:
	for p in _pool:
		p.stop()
	for p2 in _pool2d:
		p2.stop()
	for pu in _ui:
		pu.stop()
	stop_voice()
	music.set_state(&"silence")
	if ambience and ambience.has_method("stop_all"):
		ambience.stop_all()


func has_sfx(id: StringName) -> bool:
	return catalog.has(id)


func get_sfx_ids() -> Array:
	return catalog.entries.keys()


func voice_line_exists(line_id: StringName) -> bool:
	return voice.has_line(line_id)


func set_menu_ambience(enabled: bool) -> void:
	ambience.menu_ambience = enabled


func get_listener_position() -> Variant:
	var vp := get_viewport()
	if vp:
		var cam := vp.get_camera_3d()
		if cam and cam.is_inside_tree():
			return cam.global_position
	if Game.player and is_instance_valid(Game.player):
		return Game.player.global_position
	return null


# ================================================================================================ internals

func _setup_buses() -> void:
	var rev := AudioServer.get_bus_index(&"Reverb")
	for b in [&"SFX", &"Ambience"]:
		var i := AudioServer.get_bus_index(b)
		if i >= 0 and rev >= 0:
			AudioServer.set_bus_send(i, &"Reverb")
	if rev >= 0:
		for k in AudioServer.get_bus_effect_count(rev):
			var fx := AudioServer.get_bus_effect(rev, k)
			if fx is AudioEffectReverb:
				_reverb_fx = fx
				_reverb_fx.dry = 1.0
				break
	var m := AudioServer.get_bus_index(&"Master")
	for k in AudioServer.get_bus_effect_count(m):
		var fx2 := AudioServer.get_bus_effect(m, k)
		if fx2 is AudioEffectLowPassFilter:
			_lpf = fx2
			break
	_reverb_cur = (REVERB_PRESETS[&"outdoor"] as Dictionary).duplicate()
	_apply_reverb()


func _apply_reverb() -> void:
	if _reverb_fx == null:
		return
	_reverb_fx.room_size = _reverb_cur["room_size"]
	_reverb_fx.damping = _reverb_cur["damping"]
	_reverb_fx.wet = _reverb_cur["wet"]
	_reverb_fx.predelay_msec = _reverb_cur["predelay_msec"]
	_reverb_fx.predelay_feedback = _reverb_cur["predelay_feedback"]
	_reverb_fx.hipass = _reverb_cur["hipass"]
	_reverb_fx.spread = _reverb_cur["spread"]
	_reverb_fx.dry = 1.0


func _auto_env() -> StringName:
	var pos: Variant = get_listener_position()
	if pos == null:
		return &"outdoor"
	var p: Vector3 = pos
	if Climate.has_method("get_shelter_at") and Climate.get_shelter_at(p) >= 0.85:
		return &"interior"
	if TerrainData.has_method("get_masks") and TerrainData.get_masks(p.x, p.z).a > 0.5:
		return &"forest"
	return &"outdoor"


func _process(delta: float) -> void:
	catalog.warm_step(3)
	_env_timer -= delta
	if _env_timer <= 0.0:
		_env_timer = 0.5
		env_kind = _env_explicit if _env_explicit != &"" else _auto_env()
	var tgt: Dictionary = REVERB_PRESETS[env_kind]
	var changed := false
	var k := clampf(delta * 1.5, 0.0, 1.0)
	for key in tgt:
		var c: float = _reverb_cur[key]
		var t: float = tgt[key]
		if absf(c - t) > 0.0005:
			_reverb_cur[key] = lerpf(c, t, k)
			changed = true
	if changed:
		_apply_reverb()
	if absf(_muffle - _muffle_target) > 0.0005 or (_lpf and _muffle_target == 0.0 and _lpf.cutoff_hz < 20400.0):
		_muffle = move_toward(_muffle, _muffle_target, delta * 1.5)
		if _lpf:
			_lpf.cutoff_hz = 20500.0 * pow(320.0 / 20500.0, _muffle)
	_update_voice_duck()


func _update_voice_duck() -> void:
	if ambience:
		ambience.duck = 0.7 if voice.is_playing() else 1.0


func _pitch(e: SfxCatalog.Entry, pitch: float) -> float:
	return pitch * (1.0 + randf_range(-e.pitch_var, e.pitch_var))


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _deduped(e: SfxCatalog.Entry, position: Variant) -> bool:
	if e.cooldown <= 0.0:
		return false
	var now := _now()
	var last: Array = _last.get(e.group, [])
	if not last.is_empty() and now - float(last[0]) < e.cooldown:
		var lp: Variant = last[1]
		if position == null or lp == null or (position as Vector3).distance_to(lp) < 2.5:
			return true
	_last[e.group] = [now, position]
	return false


func _configure3d(p: AudioStreamPlayer3D, e: SfxCatalog.Entry, volume_db: float) -> void:
	p.bus = e.bus
	p.volume_db = e.volume_db + volume_db
	p.unit_size = e.unit_size
	p.max_distance = e.max_distance if e.max_distance > 0.0 else 0.0
	p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
	p.max_db = 6.0
	# distance darkening (air absorption); far-carrying calls keep more top end
	p.attenuation_filter_cutoff_hz = 7000.0 if e.max_distance > 500.0 else 5000.0
	p.attenuation_filter_db = -18.0 if e.max_distance > 500.0 else -24.0
	p.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_PHYSICS_STEP if e.doppler else AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
	p.panning_strength = 1.0
	if e.doppler:
		# Doppler needs the listening camera to track velocity as well
		var cam := get_viewport().get_camera_3d() if get_viewport() else null
		if cam and cam.doppler_tracking == Camera3D.DOPPLER_TRACKING_DISABLED:
			cam.doppler_tracking = Camera3D.DOPPLER_TRACKING_PHYSICS_STEP


func _play_entry(e: SfxCatalog.Entry, position: Variant, volume_db: float, pitch: float, low_priority: bool, ignore_cooldown: bool) -> Node:
	var positional := position is Vector3 and e.max_distance > 0.0
	if not ignore_cooldown and _deduped(e, position if position is Vector3 else null):
		return null
	if positional:
		var lp: Variant = get_listener_position()
		if lp != null and (lp as Vector3).distance_to(position) > e.max_distance * 1.05:
			return null
	var s: AudioStream = catalog.pick_stream(e)
	if s == null:
		return null
	if positional:
		var i := _acquire3d(e.id, e.max_voices, low_priority)
		if i < 0:
			return null
		var p := _pool[i]
		p.stop()
		_configure3d(p, e, volume_db)
		p.stream = s
		p.pitch_scale = _pitch(e, pitch)
		p.global_position = position
		p.play()
		_pool_id[i] = e.id
		_pool_t[i] = _now()
		_pool_low[i] = low_priority
		return p
	if e.bus == &"UI":
		# interface sounds must work while the tree is paused
		var pu: AudioStreamPlayer = _ui[_ui_next]
		_ui_next = (_ui_next + 1) % _ui.size()
		pu.stream = s
		pu.volume_db = e.volume_db + volume_db
		pu.pitch_scale = _pitch(e, pitch)
		pu.play()
		return pu
	var j := _acquire2d(e.id, e.max_voices)
	var p2 := _pool2d[j]
	p2.stop()
	p2.bus = e.bus
	p2.stream = s
	p2.volume_db = e.volume_db + volume_db
	p2.pitch_scale = _pitch(e, pitch)
	p2.play()
	_pool2d_id[j] = e.id
	_pool2d_t[j] = _now()
	return p2


func _acquire3d(id: StringName, max_voices: int, low_priority: bool) -> int:
	var count := 0
	var oldest_same := -1
	var free := -1
	var oldest_low := -1
	var oldest := -1
	for i in _pool.size():
		var busy := _pool[i].playing
		if not busy:
			if free < 0:
				free = i
			continue
		if _pool_id[i] == id:
			count += 1
			if oldest_same < 0 or _pool_t[i] < _pool_t[oldest_same]:
				oldest_same = i
		if _pool_low[i] and (oldest_low < 0 or _pool_t[i] < _pool_t[oldest_low]):
			oldest_low = i
		if oldest < 0 or _pool_t[i] < _pool_t[oldest]:
			oldest = i
	if max_voices > 0 and count >= max_voices:
		return -1 if low_priority else oldest_same
	if free >= 0:
		return free
	if low_priority:
		return -1
	return oldest_low if oldest_low >= 0 else oldest


func _acquire2d(id: StringName, max_voices: int) -> int:
	var count := 0
	var oldest_same := -1
	var free := -1
	var oldest := 0
	for i in _pool2d.size():
		if not _pool2d[i].playing:
			if free < 0:
				free = i
			continue
		if _pool2d_id[i] == id:
			count += 1
			if oldest_same < 0 or _pool2d_t[i] < _pool2d_t[oldest_same]:
				oldest_same = i
		if _pool2d_t[i] < _pool2d_t[oldest]:
			oldest = i
	if max_voices > 0 and count >= max_voices and oldest_same >= 0:
		return oldest_same
	return free if free >= 0 else oldest


# ================================================================================================ Events hooks

func _connect_events() -> void:
	var hooks := {
		"footstep": _on_footstep, "player_landed": _on_landed, "player_damaged": _on_damaged,
		"player_died": _on_died, "item_picked_up": _on_picked, "item_dropped": _on_dropped,
		"item_crafted": _on_crafted, "item_consumed": _on_consumed, "blueprint_unlocked": _on_blueprint,
		"scan_completed": _on_scan, "ui_screen_opened": _on_screen_opened, "ui_screen_closed": _on_screen_closed,
		"objective_added": _on_objective_added, "objective_completed": _on_objective_done,
		"poi_discovered": _on_poi, "log_found": _on_log, "game_started": _on_game_started,
		"equipment_changed": _on_equip, "player_respawned": _on_respawned,
	}
	for sig in hooks:
		if Events.has_signal(sig) and not Events.is_connected(sig, hooks[sig]):
			Events.connect(sig, hooks[sig])


func _player_has(tag: StringName) -> bool:
	var p := Game.player
	return p != null and is_instance_valid(p) and p.has_method("has_gear") and bool(p.has_gear(tag))


func _on_footstep(surface: StringName, position: Vector3, intensity: float) -> void:
	var s := String(surface)
	var id := StringName("step_" + s)
	if s == "snow" and Climate.has_method("get_air_temperature") and Climate.get_air_temperature(position) < -10.0:
		id = &"step_snow_cold"
	if not catalog.has(id):
		id = &"step_dirt"
	var e: SfxCatalog.Entry = catalog.get_entry(id)
	if e == null:
		return
	var it := clampf(intensity, 0.0, 1.0)
	var vol := lerpf(-10.0, 2.0, it)
	var crampons := (s == "snow" or s == "ice") and _player_has(&"crampons")
	if crampons:
		vol -= 5.0
	var played: Node = _play_entry(e, position, vol, 1.0 + (it - 0.5) * 0.06, false, false)
	if played != null and crampons:
		var c: SfxCatalog.Entry = catalog.get_entry(&"crampon_step")
		if c:
			_play_entry(c, position, lerpf(-8.0, 1.0, it), 1.0, false, true)


func _on_landed(fall_speed: float, surface: StringName) -> void:
	var pos: Variant = null
	if Game.player and is_instance_valid(Game.player):
		pos = Game.player.global_position
	var hard := fall_speed > 7.5
	play_sfx(&"land_hard" if hard else &"land_soft", null, lerpf(-6.0, 2.0, clampf(fall_speed / 12.0, 0.0, 1.0)))
	var step := StringName("step_" + String(surface))
	var e: SfxCatalog.Entry = catalog.get_entry(step) if catalog.has(step) else null
	if e and pos != null:
		_play_entry(e, pos, 3.0 if hard else 0.0, 0.92, false, true)


func _on_damaged(amount: float, type: StringName, _source: Node) -> void:
	if amount >= 2.0 and PAIN_TYPES.has(type):
		play_sfx(&"hurt", null, clampf(-6.0 + amount * 0.3, -6.0, 2.0))


func _on_died(_cause: StringName) -> void:
	play_sfx(&"death")
	music.play_stinger(&"death")
	music.set_state(&"silence")
	stop_voice()


func _on_picked(_id: StringName, _count: int) -> void:
	play_sfx(&"pickup")


func _on_dropped(_id: StringName, _count: int) -> void:
	play_sfx(&"drop")


func _on_crafted(_id: StringName, _count: int) -> void:
	play_sfx(&"craft_done")


func _on_consumed(id: StringName) -> void:
	var item: Dictionary = ItemDB.get_item(id) if ItemDB.has_method("get_item") else {}
	var cat := String(item.get("category", ""))
	var sid := String(id)
	if cat == "drink" or sid.contains("water") or sid.contains("tea") or sid.contains("coffee"):
		play_sfx(&"drink")
	elif cat == "food":
		play_sfx(&"eat")
	elif cat == "medical":
		play_sfx(&"equip", null, -4.0)


func _on_blueprint(_id: StringName) -> void:
	play_sfx(&"blueprint")
	music.play_stinger(&"blueprint")


func _on_scan(_target: StringName) -> void:
	play_sfx(&"scan_done")


func _on_screen_opened(screen: StringName) -> void:
	if screen == &"inventory" or screen == &"crafting":
		play_sfx(&"inventory_open")
	elif screen == &"pause":
		voice.set_paused(true)


func _on_screen_closed(screen: StringName) -> void:
	if screen == &"inventory" or screen == &"crafting":
		play_sfx(&"inventory_close")
	elif screen == &"pause":
		voice.set_paused(false)


func _on_objective_added(_id: StringName, _text: String) -> void:
	play_ui(&"notify")


func _on_objective_done(_id: StringName) -> void:
	music.play_stinger(&"objective")


func _on_poi(_id: StringName) -> void:
	music.play_stinger(&"discovery")


func _on_log(_id: StringName) -> void:
	play_ui(&"notify")


func _on_equip(_slot: StringName, id: StringName) -> void:
	if id != &"":
		play_sfx(&"equip")


func _on_respawned() -> void:
	set_muffled(0.0)
	music.set_state(&"explore")


func _on_game_started(_is_new: bool) -> void:
	music.requested_state = &"explore"
	music.set_state(&"explore")
	_env_explicit = &""
	set_muffled(0.0)

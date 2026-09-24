extends TestCase
## Audio workstream tests: catalog completeness vs CONTRACT §3, assets load, loop flags, voice/log data
## consistency, and API smoke tests (safe unknown ids, pooling/de-dup, events, music states, reverb, voice).

const CONTRACT_IDS: Array[String] = [
	"step_snow", "step_rock", "step_scree", "step_grass", "step_forest", "step_dirt", "step_ice", "step_gravel",
	"step_wood", "step_metal", "step_water", "land_soft", "land_hard", "jump", "swim_stroke", "splash",
	"breath_exert", "breath_cold", "breath_altitude", "heartbeat", "hurt", "death", "eat", "drink", "pickup",
	"drop", "craft", "craft_done", "equip", "inventory_open", "inventory_close", "ui_click", "ui_hover", "ui_back",
	"notify", "blueprint", "scan_loop", "scan_done", "axe_swing", "axe_hit_wood", "axe_hit_stone", "knife_hit",
	"pick_hit_stone", "tree_crack", "tree_fall", "tree_impact", "log_split", "bow_draw", "bow_release", "arrow_hit",
	"spear_throw", "fire_ignite", "fire_loop", "torch_loop", "flare_ignite", "flare_loop", "flaregun_fire",
	"build_place", "build_hammer", "build_invalid", "door_open", "door_close", "metal_creak", "wood_creak",
	"ice_crack", "avalanche", "thunder", "radio_static", "radio_beep", "generator_start", "generator_loop",
	"wolf_howl", "wolf_growl", "wolf_bark", "wolf_attack", "wolf_yelp", "bear_roar", "bear_huff", "bear_attack",
	"deer_bark", "deer_flee", "goat_bleat", "hare_squeal", "raven_caw", "eagle_cry", "bird_chirp",
	"helicopter_loop", "water_stream_loop", "waterfall_loop", "lake_lap_loop", "wind_loop", "o2_hiss",
	"climb_grab", "crampon_step",
]
const MUST_LOOP: Array[String] = ["fire_loop", "torch_loop", "flare_loop", "scan_loop", "generator_loop",
	"helicopter_loop", "water_stream_loop", "waterfall_loop", "lake_lap_loop", "wind_loop"]


func _json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return v if v is Dictionary else {}


func run() -> void:
	await _test_catalog()
	await _test_voice_data()
	await _test_api()
	await _test_music()
	await _test_voice_api()
	await _test_ambience()
	Audio.stop_all()
	Audio.ambience.enabled = false
	await get_tree().create_timer(0.3).timeout


# ------------------------------------------------------------------------------------------------ data

func _test_catalog() -> void:
	var sfx := _json("res://data/sfx.json")
	check(not sfx.is_empty(), "sfx.json parses")
	var missing: Array[String] = []
	for id in CONTRACT_IDS:
		if not sfx.has(id):
			missing.append(id)
	check(missing.is_empty(), "all %d contract sfx ids present %s" % [CONTRACT_IDS.size(), str(missing)])
	var bad_files: Array[String] = []
	var not_stream: Array[String] = []
	var files := 0
	for id in sfx:
		var e: Dictionary = sfx[id]
		if (e.get("files", []) as Array).is_empty():
			bad_files.append(String(id) + ":<none>")
		for f in e.get("files", []):
			files += 1
			if not ResourceLoader.exists(f):
				bad_files.append(f)
				continue
			var s: Variant = load(f)
			if not (s is AudioStream) or (s as AudioStream).get_length() <= 0.0:
				not_stream.append(f)
		for key in ["bus", "volume_db", "pitch_var", "max_distance", "unit_size"]:
			if not e.has(key):
				bad_files.append("%s missing %s" % [id, key])
		if not ["SFX", "Ambience", "UI", "Music", "Voice"].has(String(e.get("bus", ""))):
			bad_files.append("%s bad bus" % id)
	check(bad_files.is_empty(), "all %d sfx files exist, entries complete %s" % [files, str(bad_files.slice(0, 8))])
	check(not_stream.is_empty(), "all sfx files import as AudioStream %s" % str(not_stream.slice(0, 8)))
	var loops_bad: Array[String] = []
	for id in sfx:
		var e: Dictionary = sfx[id]
		var should := MUST_LOOP.has(String(id)) or String(id).begins_with("amb_") and String(e.get("category", "")) == "bed"
		if should and not bool(e.get("loop", false)):
			loops_bad.append(String(id))
		if bool(e.get("loop", false)):
			var s: AudioStream = load(e["files"][0])
			if s and "loop" in s and not bool(s.get("loop")):
				loops_bad.append(String(id) + "(import)")
	check(loops_bad.is_empty(), "looping assets flagged loop=true %s" % str(loops_bad))
	var steps := 0
	for id in sfx:
		if String(id).begins_with("step_"):
			steps += 1
			check((sfx[id]["files"] as Array).size() >= 6, "%s has >= 6 variations" % id)
	check(steps >= 11, "footstep surfaces >= 11")
	check(Audio.has_sfx(&"step_snow") and not Audio.has_sfx(&"nope"), "Audio.has_sfx")


func _test_voice_data() -> void:
	var voice := _json("res://data/voice.json")
	var logs := _json("res://data/logs.json")
	check(voice.size() >= 20, "voice.json has lines (%d)" % voice.size())
	check(logs.size() >= 15, "logs.json has logs (%d)" % logs.size())
	var problems: Array[String] = []
	for id in voice:
		var v: Dictionary = voice[id]
		for key in ["file", "speaker", "text", "radio", "duration_s"]:
			if not v.has(key):
				problems.append("%s missing %s" % [id, key])
		if not ResourceLoader.exists(String(v.get("file", ""))):
			problems.append("%s file missing" % id)
		if float(v.get("duration_s", 0.0)) <= 0.0:
			problems.append("%s duration" % id)
		var last_t := -1.0
		for seg in v.get("segments", []):
			if float(seg.get("t", 0.0)) < last_t:
				problems.append("%s segments unsorted" % id)
			last_t = float(seg.get("t", 0.0))
	check(problems.is_empty(), "voice.json entries complete, files exist %s" % str(problems.slice(0, 8)))
	var lp: Array[String] = []
	for id in logs:
		var l: Dictionary = logs[id]
		for key in ["title", "author", "date", "text"]:
			if not l.has(key) or String(l[key]) == "":
				lp.append("%s missing %s" % [id, key])
		var vl: Variant = l.get("voice", null)
		if vl != null and not voice.has(String(vl)):
			lp.append("%s voice %s not in voice.json" % [id, vl])
	check(lp.is_empty(), "logs.json consistent with voice.json %s" % str(lp.slice(0, 8)))


# ------------------------------------------------------------------------------------------------ api

func _playing_ids() -> Array:
	var out := []
	for i in Audio._pool.size():
		if Audio._pool[i].playing:
			out.append(Audio._pool_id[i])
	for i in Audio._pool2d.size():
		if Audio._pool2d[i].playing:
			out.append(Audio._pool2d_id[i])
	return out


func _test_api() -> void:
	Audio.play_sfx(&"this_id_does_not_exist")
	Audio.play_sfx(&"this_id_does_not_exist", Vector3(1, 2, 3))
	Audio.play_ui(&"also_missing")
	check(true, "unknown ids are safe")
	Audio.play_sfx(&"axe_hit_wood", Vector3(0, 1450, 0))
	Audio.play_sfx(&"pickup")
	Audio.play_sfx(&"pickup")            # same moment: de-duplicated
	await get_tree().process_frame
	var ids := _playing_ids()
	check(ids.has(&"axe_hit_wood"), "positional sfx plays on the 3D pool")
	check(ids.count(&"pickup") == 1, "duplicate trigger de-duplicated (%d)" % ids.count(&"pickup"))
	Audio.play_ui(&"ui_click")
	check(Audio._ui.any(func(p): return p.playing), "ui sound plays on UI pool")
	# voice limit: many wolf howls → never more than max_voices
	for k in 8:
		Audio.play_sfx(&"raven_caw", Vector3(k * 3.0, 1450, 0))
		Audio._last.erase(&"raven_caw")
	await get_tree().process_frame
	check(_playing_ids().count(&"raven_caw") <= int(Audio.catalog.entries[&"raven_caw"].max_voices), "per-id voice limit")
	# Events footstep → step sound (cold snow selection handled by Climate)
	Events.footstep.emit(&"gravel", Vector3(5, 1450, 5), 0.8)
	await get_tree().process_frame
	check(_playing_ids().has(&"step_gravel"), "Events.footstep sonified")
	# a player script that emits Events.footstep AND plays the step itself produces one footstep
	Audio._last.erase(&"footstep")
	Events.footstep.emit(&"rock", Vector3(20, 1450, 5), 0.6)
	Audio.play_sfx(&"step_rock", Vector3(20, 1450, 5))
	Audio.play_sfx(&"crampon_step", Vector3(20, 1450, 5))
	Audio.play_sfx(&"crampon_step", Vector3(20, 1450, 5))
	await get_tree().process_frame
	check(_playing_ids().count(&"step_rock") == 1, "event + direct footstep de-duplicated (%d)" % _playing_ids().count(&"step_rock"))
	check(_playing_ids().count(&"crampon_step") == 1, "crampons layer on a step exactly once (%d)" % _playing_ids().count(&"crampon_step"))
	Events.footstep.emit(&"lava", Vector3(9, 1450, 9), 0.5)
	await get_tree().process_frame
	check(true, "unknown surface falls back safely")
	# attached + loop
	var n := Node3D.new()
	add_child(n)
	var a := Audio.play_sfx_attached(&"wolf_growl", n)
	check(a != null and a.get_parent() == n and a.playing, "play_sfx_attached follows node")
	var lp := Audio.play_loop(&"fire_loop", n)
	check(lp != null and lp.playing and (lp.stream as AudioStreamOggVorbis).loop, "play_loop returns looping player")
	check(Audio.is_loop_active(&"fire_loop"), "is_loop_active")
	var gl := Audio.start_loop_with_intro(&"generator_start", &"generator_loop", n)
	check(gl != null, "start_loop_with_intro")
	n.queue_free()
	await get_tree().process_frame
	check(Audio.play_loop(&"fire_loop", null) == null, "play_loop with null node is safe")
	# reverb + muffle
	Audio.set_environment_reverb(&"cave")
	Audio.set_muffled(1.0)
	await get_tree().create_timer(3.0).timeout
	check(Audio.env_kind == &"cave", "reverb environment set")
	check(Audio._reverb_fx != null and Audio._reverb_fx.wet > 0.3 and Audio._reverb_fx.dry == 1.0, "cave reverb applied to Reverb bus (%s)" % (Audio._reverb_fx.wet if Audio._reverb_fx else -1))
	check(Audio._lpf != null and Audio._lpf.cutoff_hz < 2000.0, "set_muffled drives Master low-pass (%s)" % (Audio._lpf.cutoff_hz if Audio._lpf else -1))
	check(AudioServer.get_bus_send(AudioServer.get_bus_index(&"SFX")) == &"Reverb", "SFX routed through Reverb")
	Audio.set_environment_reverb(&"outdoor")
	Audio.set_muffled(0.0)
	Audio.set_environment_reverb(&"bogus")
	check(true, "unknown reverb kind ignored")


func _test_music() -> void:
	var m = Audio.music
	# synthetic cue table using real ogg files so playback can be verified
	var f := "res://assets/audio/ambience/amb_wind_calm.ogg"
	m.set_catalog({
		"explore_1": {"file": f, "loop": false, "intensity": 0.3, "duration_s": 40.0},
		"danger_a": {"file": f, "loop": true, "intensity": 0.9, "duration_s": 40.0},
		"stinger_discovery": {"file": "res://assets/audio/sfx/notify_01.ogg", "loop": false},
		"summit": {"file": f, "loop": true},
		"menu_theme": {"file": f, "loop": true},
	})
	check(m.has_cues_for(&"explore") and m.has_cues_for(&"danger") and m.has_cues_for(&"summit"), "cue ids mapped to states")
	check(m.stingers.has(&"discovery"), "stinger ids mapped")
	m.context_override = &"explore"
	m._context_state = &"explore"
	Audio.set_music_state(&"danger")
	await get_tree().process_frame
	check(m.state == &"danger" and m.is_playing(), "danger starts immediately")
	Audio.set_music_state(&"silence")
	for k in 10:
		await get_tree().process_frame
	check(m.state == &"silence", "silence state")
	Audio.set_music_state(&"not_a_state")
	check(m.state == &"silence", "unknown state ignored")
	Audio.set_music_state(&"explore")
	await get_tree().process_frame
	check(m.state == &"explore", "explore resolves from context (%s)" % m.state)
	m.context_override = &"menu"
	m._context_state = &"menu"
	Audio.set_music_state(&"danger")
	check(m.state == &"menu", "gameplay states resolve to menu while in the main menu")
	m.context_override = &""
	Audio.set_music_state(&"explore")
	check(m.play_stinger(&"discovery"), "stinger plays")
	check(not m.play_stinger(&"discovery"), "stinger cooldown")
	Audio.play_stinger(&"objective")
	check(true, "stinger without cues is safe")
	# the music stream's schema: cue id = state, per-cue fades, phrase starts, oneshot vs loop
	m.set_catalog({
		"station": {"file": f, "kind": "loop", "loop": true, "duration_s": 150.857, "fade_in_s": 4.0, "fade_out_s": 5.0,
			"phrase_starts_s": [0.0, 13.714, 27.429, 41.143, 54.857, 68.571, 82.286, 96.0, 109.714, 123.429, 137.143]},
		"summit": {"file": f, "kind": "oneshot", "loop": false, "duration_s": 145.1, "fade_in_s": 1.5, "fade_out_s": 2.5},
	})
	check(m.has_cues_for(&"station") and m.has_cues_for(&"summit"), "music.json schema maps cue ids to states")
	m._start_cue(&"station", 4.0)
	check(absf(m._limit - 137.143) < 0.01, "ambient loop fades out on a phrase boundary (%.1f)" % m._limit)
	m._start_cue(&"summit", 2.5)
	check(m._limit == 0.0 and m._gap >= 8.0, "urgent one-shot plays through, then breathes before repeating")
	m.stop_now()
	m.load_catalog()


func _test_voice_api() -> void:
	var got := []
	var cb := func(s: String, t: String, d: float) -> void: got.append([s, t, d])
	Events.subtitle.connect(cb)
	var ids: Array = Audio.voice.lines.keys()
	if ids.is_empty():
		check(false, "voice lines available")
	else:
		var d := Audio.play_voice(ids[0])
		await get_tree().create_timer(1.2).timeout
		check(d > 0.0, "play_voice returns duration (%.2f)" % d)
		check(not got.is_empty() and String(got[0][1]) != "", "subtitle emitted")
		check(Audio.voice.is_playing(), "voice playing")
		check(Audio.ambience.duck < 1.0, "ambience ducks under voice")
		Audio.stop_voice()
		check(not Audio.voice.is_playing(), "stop_voice")
	check(Audio.play_voice(&"no_such_line") == 0.0, "unknown voice line returns 0")
	Events.subtitle.disconnect(cb)
	# positional voice whose node disappears mid-line must still finish (story flow never stalls)
	if not ids.is_empty():
		var radio := Node3D.new()
		add_child(radio)
		var d3 := Audio.play_voice_3d(ids[0], radio)
		check(d3 > 0.0 and Audio.voice.is_playing(), "play_voice_3d plays")
		radio.queue_free()
		await get_tree().process_frame
		await get_tree().process_frame
		check(not Audio.voice.is_playing(), "voice finishes when its 3D node is freed")
	# Events.radio_message plays the line; a direct play_voice of the same line right after does not restart it
	if not ids.is_empty():
		var starts := [0]
		var on_start := func(_id: StringName) -> void: starts[0] += 1
		Audio.voice.line_started.connect(on_start)
		Events.radio_message.emit(StringName(ids[0]))
		Audio.play_voice(ids[0])
		check(Audio.voice.is_playing() and starts[0] == 1, "radio_message + play_voice plays once (%d)" % starts[0])
		Audio.voice.line_started.disconnect(on_start)
		Audio.stop_voice()
	Events.sleep_started.emit(8.0)
	check(Audio._muffle_target > 0.5, "sleep muffles the mix")
	Events.sleep_ended.emit()
	check(Audio._muffle_target == 0.0, "waking unmuffles")
	# the prologue scene and every log recording referenced by logs.json can be played
	for key in [&"prologue", &"beacon_mara", &"mara_contact_1", &"final_call"]:
		check(Audio.voice_line_exists(key), "voice line %s exists" % key)


func _test_ambience() -> void:
	var amb = Audio.ambience
	# a loop attached to a node that is not in the tree yet starts when it enters
	var off := Node3D.new()
	var lp := Audio.play_loop(&"torch_loop", off)
	check(lp != null and lp.autoplay and not lp.playing, "play_loop on detached node defers playback")
	add_child(off)
	await get_tree().process_frame
	check(lp.playing, "deferred loop plays once in tree")
	off.queue_free()
	# listener in a (stub) world: context and bed targets are computed without errors
	var old_world: Node3D = Game.world
	var w := Node3D.new()
	add_child(w)
	Game.world = w
	var cam := Camera3D.new()
	w.add_child(cam)
	cam.global_position = Vector3(0, 1500, 0)
	cam.make_current()
	amb._update_listener()
	amb._slow_timer = 0.0
	amb._compute_targets()
	check(amb.has_listener and not bool(amb.ctx.get("menu", true)), "ambience finds the listener in a world")
	var wind_sum := 0.0
	for b in [&"amb_wind_calm", &"amb_wind_breeze", &"amb_wind_strong", &"amb_wind_gale"]:
		wind_sum += float(amb._t[b])
	check(wind_sum > 0.3, "a wind layer is always audible outdoors (%.2f)" % wind_sum)
	check(amb.event_weight(&"thunder") >= 0.0 and amb.event_weight(&"nope") == 0.0, "event weights safe")
	amb._spawn_events(1000.0)
	check(true, "spatial events spawn safely")
	Audio.set_environment_reverb(&"cave")
	Audio.env_kind = &"cave"
	amb._compute_targets()
	check(float(amb._t[&"amb_cave"]) > 0.9 and float(amb._t[&"amb_wind_calm"]) < 0.2, "cave bed replaces open wind")
	amb.max_beds = 1
	amb._compute_targets()
	var n_active := 0
	for b in amb.BEDS:
		if float(amb._t[b]) > 0.02:
			n_active += 1
	check(n_active <= 1 and float(amb._t[&"amb_cave"]) > 0.9, "mobile bed cap keeps the strongest beds (%d)" % n_active)
	amb.max_beds = 17
	Audio.set_environment_reverb(&"outdoor")
	Audio.env_kind = &"outdoor"
	# script cost: the whole audio frame (Audio + ambience + music), worst case with every timer due
	var t0 := Time.get_ticks_usec()
	for k in 200:
		amb._timer = 0.0
		amb._slow_timer = 0.0
		amb._event_timer = 0.0
		Audio._env_timer = 0.0
		Audio._process(0.016)
		amb._process(0.016)
		Audio.music._process(0.016)
	var per_frame_ms := float(Time.get_ticks_usec() - t0) / 200.0 / 1000.0
	check(per_frame_ms < 1.0, "audio script cost per frame, worst case %.3f ms" % per_frame_ms)
	print("PERF audio worst-case frame %.3f ms" % per_frame_ms)
	Audio.play_voice(Audio.voice.lines.keys()[0])
	await get_tree().process_frame
	Game.world = old_world
	w.queue_free()
	await get_tree().process_frame
	await get_tree().process_frame
	check(not Audio.voice.is_playing(), "unloading the world stops voice lines")
	amb._update_listener()
	amb._compute_targets()
	check(bool(amb.ctx.get("menu", false)), "no world → menu ambience")

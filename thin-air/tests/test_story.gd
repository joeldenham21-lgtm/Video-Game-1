extends TestCase
## Story stream: objective graph integrity (ids, prerequisites, no cycles, every objective reachable, every
## referenced item / POI / log / voice line / socket exists), loot tables, the Structures part (placement at the
## pads, loot/logs/uses/scanners populated, the gated depot), a fast scripted playthrough that fakes each act's
## conditions from the data and reaches the ending, and a save/load roundtrip mid-act.

const SG := preload("res://src/story/story_graph.gd")
const LT := preload("res://src/story/loot_tables.gd")

var _scenes: Dictionary = {}
var _voice: Dictionary = {}
var _logs: Dictionary = {}


class FakePlayer extends Node3D:
	var inventory := Inventory.new(40, 400.0)
	var equipment: Dictionary = {&"head": &"", &"face": &"", &"body": &"", &"legs": &"", &"hands": &"", &"feet": &"", &"back": &""}
	var insulation := 6.0
	var input_enabled := true

	func get_insulation() -> float:
		return insulation

	func has_gear(_tag: StringName) -> bool:
		return true

	func teleport(pos: Vector3, _yaw := 0.0) -> void:
		global_position = pos

	func set_input_enabled(e: bool) -> void:
		input_enabled = e

	func equip(id: StringName) -> bool:
		var slot := StringName(ItemDB.get_item(id).get("equip_slot", ""))
		if slot == &"" or not inventory.remove(id, 1):
			return false
		equipment[slot] = id
		return true


func run() -> void:
	_voice = _json("res://data/voice.json")
	_logs = _json("res://data/logs.json")
	_test_graph()
	_test_loot()
	await _test_structures()
	await _test_playthrough()
	for k in _scenes:
		if is_instance_valid(_scenes[k]):
			(_scenes[k] as Node).free()


static func _json(path: String) -> Dictionary:
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return v if v is Dictionary else {}


func _scene(id: String) -> PoiSite:
	if _scenes.has(id):
		return _scenes[id]
	var path := "res://scenes/poi/%s.tscn" % id
	var n: PoiSite = null
	if ResourceLoader.exists(path):
		n = (load(path) as PackedScene).instantiate() as PoiSite
	_scenes[id] = n
	return n


func _socket_exists(key: String, g: StoryGraph) -> bool:
	var parts := key.split("/")
	if parts.size() != 2:
		return false
	if (g.uses.get(key, {}) as Dictionary).has("at"):
		return true
	var s := _scene(parts[0])
	return s != null and s.get_socket(parts[1]) != null


# ============================================================================================ graph

func _test_graph() -> void:
	var g: StoryGraph = SG.load_default()
	check(g.objectives.size() >= 25, "story.json has the full objective graph (%d objectives)" % g.objectives.size())
	var ids := {}
	var dup := false
	for o in g.objectives:
		if ids.has(o["id"]):
			dup = true
		ids[o["id"]] = true
	check(not dup, "objective ids are unique")
	var bad_req: Array[String] = []
	var bad_text: Array[String] = []
	for o in g.objectives:
		for r in o.get("requires", []):
			if not ids.has(r):
				bad_req.append("%s -> %s" % [o["id"], r])
		if String(o.get("text", "")).length() < 8 or int(o.get("act", 0)) < 1 or int(o.get("act", 0)) > 6:
			bad_text.append(String(o["id"]))
		if not o.has("complete"):
			bad_text.append(String(o["id"]) + " (no complete)")
	check(bad_req.is_empty(), "every prerequisite names an objective %s" % [bad_req])
	check(bad_text.is_empty(), "every objective has text, an act 1-6 and a completion condition %s" % [bad_text])
	check(not g.has_cycle() and g.order().size() == g.objectives.size(), "objective graph has no cycles")
	check(g.roots().size() >= 1 and g.leaves().has(&"rescue"), "graph starts at roots and ends with the rescue")

	var refs := g.collect_refs()
	var miss: Array[String] = []
	for id: String in refs["items"]:
		if not ItemDB.has_item(StringName(id)):
			miss.append("item " + id)
	for id: String in refs["pois"]:
		if TerrainData.is_loaded() and TerrainData.get_poi(StringName(id)).is_empty():
			miss.append("poi " + id)
	for id: String in refs["logs"]:
		if not _logs.has(id):
			miss.append("log " + id)
	for id: String in refs["voices"]:
		if not _voice.has(id):
			miss.append("voice " + id)
	for id: String in refs["sequences"]:
		if not SG.SEQUENCE_PRODUCES.has(id):
			miss.append("sequence " + id)
	for key: String in refs["sockets"]:
		if not _socket_exists(key, g):
			miss.append("socket " + key)
	check(miss.is_empty(), "every referenced item / POI / log / voice line / sequence / socket exists %s" % [miss])

	# hints are radio lines; every log is placed in the world or handed over by the story
	var bad_hint: Array[String] = []
	for h in g.hints:
		if not bool((_voice.get(String(h["id"]), {}) as Dictionary).get("radio", false)):
			bad_hint.append(String(h["id"]))
	check(bad_hint.is_empty(), "contextual hints are radio lines %s" % [bad_hint])
	var placed := {}
	for site in Structures_sites():
		var s := _scene(site)
		if s == null:
			continue
		for m in s.get_sockets("Log_"):
			placed[String(m.get_meta(&"log_id", ""))] = true
	for a in g.all_actions():
		if String(a.get("do", "")) == "log":
			placed[String(a["id"])] = true
	var unplaced: Array[String] = []
	for id: String in _logs:
		if not placed.has(id):
			unplaced.append(id)
	check(unplaced.is_empty(), "every crew log / document is placed at a Log_ socket or given by Mara %s" % [unplaced])

	# reachability: items obtainable from loot, story gives, recipes, the starting kit
	var obtainable := LT.all_items()
	for key: String in g.uses:
		for id in (g.uses[key] as Dictionary).get("give", {}):
			obtainable[String(id)] = true
	for a in g.all_actions():
		if String(a.get("do", "")) == "give":
			obtainable[String(a["id"])] = true
	for r in ItemDB.recipes:
		obtainable[String(r.get("result", ""))] = true
	for id in ["field_jacket", "hiking_pants", "boots", "stick", "stone"]:
		obtainable[id] = true
	var reach := g.reachable(obtainable)
	var unreach: Array[String] = []
	for o in g.objectives:
		if not reach.has(StringName(o["id"])):
			var why := g.unsatisfiable(o.get("complete", {}), g.producers(), obtainable)
			why.append_array(g.unsatisfiable(o.get("trigger", {}), g.producers(), obtainable))
			unreach.append("%s %s" % [o["id"], why])
	check(unreach.is_empty(), "every objective is reachable from the start %s" % [unreach])
	var quest := ["survival_manual", "radio_handheld", "mine_key", "transceiver_module", "battery_pack", "fuel_can", "ice_axe", "climbing_rope"]
	var qmiss: Array[String] = []
	for q in quest:
		if not obtainable.has(q):
			qmiss.append(q)
	check(qmiss.is_empty(), "every quest item can be found %s" % [qmiss])


func Structures_sites() -> Array:
	var S = load("res://scenes/poi/structures.gd")
	var out := []
	for k in S.SITES:
		out.append(String(k))
	return out


# ============================================================================================ loot

func _test_loot() -> void:
	var bad: Array[String] = []
	for tname: String in LT.tables():
		for e in LT.tables()[tname]:
			if not ItemDB.has_item(StringName(e.get("id", ""))) or float(e.get("w", 0)) <= 0.0 or int(e.get("min", 1)) > int(e.get("max", 1)):
				bad.append("%s:%s" % [tname, e.get("id", "?")])
	check(bad.is_empty(), "loot tables: items exist, weights > 0, min <= max %s" % [bad])
	var missing: Array[String] = []
	var keys := {}
	var dupkey := false
	var fixed := {}
	for site: String in (LT.data().get("sites", {}) as Dictionary):
		var s := _scene(site)
		if s == null:
			missing.append(site)
			continue
		for socket: String in LT.site_sockets(StringName(site)):
			if s.get_socket(socket) == null or not socket.begins_with("Loot_"):
				missing.append("%s/%s" % [site, socket])
			var a := LT.roll(StringName(site), socket)
			var b := LT.roll(StringName(site), socket)
			if JSON.stringify(a.map(func(x): return [String(x["item"]), x["count"], x["persist_id"]])) != JSON.stringify(b.map(func(x): return [String(x["item"]), x["count"], x["persist_id"]])):
				bad.append("nondeterministic " + socket)
			for e in a:
				if keys.has(e["persist_id"]):
					dupkey = true
				keys[e["persist_id"]] = true
				if not ItemDB.has_item(e["item"]):
					bad.append(String(e["item"]))
				fixed[String(e["item"])] = true
	check(missing.is_empty(), "loot sockets exist in their location scenes %s" % [missing])
	# the first fire: a match is spent per strike and fails ~25-60% of the time in the dusk wind, and there is
	# no other igniter before Act 2 — a single match from the cargo hold soft-locked 'Get warm' on a miss
	var matches := 0
	for socket: String in LT.site_sockets(&"crash_site"):
		for e in LT.roll(&"crash_site", socket):
			if e["item"] == &"matches":
				matches += int(e["count"])
	check(matches >= 8, "the wreck holds a box of matches, not one (%d)" % matches)
	check(bad.is_empty() and not dupkey, "loot rolls are deterministic with unique persist ids")
	var q: Array[String] = []
	for id in ["first_aid_kit", "flare_gun", "survival_manual", "emergency_blanket", "hatchet", "backpack_torn", "survey_scanner",
			"radio_handheld", "bow", "ice_axe", "climbing_rope", "fuel_can", "transceiver_module", "battery_pack", "matches", "parka"]:
		if not fixed.has(id):
			q.append(id)
	check(q.is_empty(), "quest and tutorial items are placed at fixed spots %s" % [q])


# ============================================================================================ structures

func _test_structures() -> void:
	if not TerrainData.is_loaded():
		check(true, "structures placement skipped (no terrain data)")
		return
	var ps := load("res://scenes/poi/structures.tscn") as PackedScene
	var st := ps.instantiate() as Node3D
	Game.flags.clear()
	add_child(st)
	await get_tree().process_frame
	await get_tree().process_frame
	var S = st.get_script()
	var sites: Dictionary = st.get(&"sites")
	check(sites.size() == S.SITES.size(), "every location scene is placed (%d/%d)" % [sites.size(), S.SITES.size()])
	var off: Array[String] = []
	for id: StringName in sites:
		var n := sites[id] as Node3D
		var spec: Array = S.SITES[id]
		var poi: Dictionary = TerrainData.get_poi(spec[0])
		var p: Vector3 = poi["position"]
		var o := n.global_position
		if String(spec[2]) == "pad" and (Vector2(o.x - p.x, o.z - p.z).length() > 0.01 or absf(o.y - TerrainData.get_height(o.x, o.z)) > 0.01):
			off.append(String(id))
		if String(spec[2]) == "interior" and o.y > TerrainData.min_height - 100.0:
			off.append(String(id) + " (interior above ground)")
	check(off.is_empty(), "locations sit at their POI pads, interiors below the terrain %s" % [off])
	# loot: fixed quest items at their sockets
	var loot: Array = st.call(&"loot_nodes")
	var by_item := {}
	for p in loot:
		by_item[String((p as ItemPickup).item_id)] = p
	check(loot.size() >= 40, "loot pickups placed (%d)" % loot.size())
	var tm := by_item.get("transceiver_module") as Node3D
	var sock := st.call(&"get_socket", &"kestrel_station", &"Loot_TransceiverModule") as Node3D
	check(tm != null and sock != null and tm.global_position.distance_to(sock.global_position) < 0.05,
		"transceiver module lies at Loot_TransceiverModule")
	check((by_item.get("survival_manual") as ItemPickup) != null and (by_item["survival_manual"] as ItemPickup).freeze
		and String((by_item["survival_manual"] as ItemPickup).persist_id).begins_with("loot:crash_site:"), "wreck loot is frozen world loot with a persist id")
	check(not by_item.has("ice_axe"), "Owen's depot stays shut until it is opened")
	Game.set_flag(&"depot_open", true)
	Story.story_event.emit(&"flag:depot_open")
	var found_axe := false
	for p in st.call(&"loot_nodes"):
		if (p as ItemPickup).item_id == &"ice_axe":
			found_axe = true
	check(found_axe, "opening the depot puts the ice axe on its shelf")
	# logs, uses, scanners
	var n_log_sockets := 0
	for id: StringName in sites:
		n_log_sockets += (sites[id] as PoiSite).get_sockets("Log_").size()
	var logs := get_tree().get_nodes_in_group(&"story_log")
	check(logs.size() == n_log_sockets and n_log_sockets >= 20, "a readable log at every Log_ socket (%d/%d)" % [logs.size(), n_log_sockets])
	# nothing the player must pick up or read is buried under the heightfield (the Otter's nose is in the snow:
	# the flare gun and Dale's logbook sockets sit a few cm below the pad, so the interaction ray hit terrain)
	var buried: Array[String] = []
	for n in Array(st.call(&"loot_nodes")) + logs:
		var g: Vector3 = (n as Node3D).global_position
		if g.y > Story.INTERIOR_MAX_Y and g.y < TerrainData.get_height(g.x, g.z) + 0.02:
			buried.append("%s %.2f m under" % [n.name, TerrainData.get_height(g.x, g.z) - g.y])
	check(buried.is_empty(), "no story loot or log under the terrain %s" % str(buried))
	var uses := get_tree().get_nodes_in_group(&"story_use")
	check(uses.size() == Story.graph.uses.size(), "every story interactable is placed (%d/%d)" % [uses.size(), Story.graph.uses.size()])
	var scans := 0
	for n in get_tree().get_nodes_in_group(&"scannable"):
		if st.is_ancestor_of(n) and n.has_method(&"get_scan_id") and String(n.call(&"get_scan_id")) != "":
			scans += 1
	check(scans >= Story.graph.scans.size(), "scanner targets placed (%d)" % scans)
	var relay_scan := false
	for n in get_tree().get_nodes_in_group(&"scannable"):
		if n.has_method(&"get_scan_id") and n.call(&"get_scan_id") == &"summit_relay":
			relay_scan = true
	check(relay_scan, "the summit relay can be scanned (battery pack blueprint)")
	check(String(Story.get_use_prompt(&"kestrel_station", &"Use_Generator")).contains("dry"), "generator is locked until fuelled")
	check(st.call(&"interior_at", (sites[&"ashford_mine_interior"] as Node3D).global_position + Vector3(-20, 1, 0)) == &"ashford_mine_interior",
		"interior lookup finds the mine tunnels")
	st.call(&"set_station_power", true, false)
	var station := sites[&"kestrel_station"] as PoiSite
	check(station.interior_lights_on, "station power switches the interior lights on")
	st.call(&"set_station_power", false, false)
	var heli := st.call(&"spawn_helicopter") as Node3D
	check(heli != null and heli.has_signal(&"landed"), "rescue helicopter spawns for the pad")
	if heli:
		heli.queue_free()
	Game.flags.clear()
	st.queue_free()
	await get_tree().process_frame


# ============================================================================================ playthrough

func _test_playthrough() -> void:
	var world := Node3D.new()
	add_child(world)
	var pl := FakePlayer.new()
	world.add_child(pl)
	Game.flags.clear()
	Game.register_world(world)
	Game.register_player(pl)
	Story.instant = true
	Story.autosave_enabled = false
	Climate.reset_new_game()
	Story.start_prologue()
	check(Story.act == 1 and Story.has_objective(&"gather_firewood") and Story.has_objective(&"salvage_wreck"),
		"new game: act 1 with the tutorial objectives")
	check(pl.equipment[&"body"] == &"field_jacket", "Sam starts dressed for the plane, not the mountain")
	var saved_mid := false
	var steps := 0
	var acts_seen := {}
	while not Story.complete and steps < 300:
		steps += 1
		acts_seen[Story.act] = true
		var active: Array[StringName] = []
		for o in Story.objectives:
			if not o["done"]:
				active.append(o["id"])
		if active.is_empty():
			break
		if Story.act == 3 and not saved_mid and Story.is_objective_done(&"enter_adit"):
			saved_mid = true
			_roundtrip()
		for id in active:
			if Story.is_objective_done(id):
				continue
			_satisfy(Story.graph.get_objective(id).get("complete", {}), id, pl)
			Story.evaluate_now()
		await get_tree().process_frame
	check(saved_mid, "save/load roundtrip ran mid-act")
	check(Story.complete and bool(Game.get_flag(&"game_complete", false)), "scripted playthrough reaches the ending in %d steps" % steps)
	var all_done := true
	for o in Story.graph.objectives:
		if not Story.is_objective_done(StringName(o["id"])):
			all_done = false
	check(all_done, "every objective was completed on the way")
	check(acts_seen.size() >= 6, "acts 1-6 were played (%s)" % [acts_seen.keys()])
	check(Story.found_logs.has(&"log_voss_03") and Story.found_logs.has(&"log_voss_04"), "Mara hands over her recordings")
	check(bool(Game.get_flag(&"generator_running", false)) and bool(Game.get_flag(&"relay_repaired", false)), "generator restarted and relay repaired")
	check(bool(Game.get_flag(&"has_radio", false)) and Story.beats_done.has("wreck_beacon"), "radio beats fired")
	var s := Story.save_state()
	check(bool(s["complete"]) and JSON.stringify(s) != "", "finished story saves as complete (free roam)")
	# cleanup
	Story.instant = false
	Story.autosave_enabled = true
	Story.reset_story()
	Game.flags.clear()
	Climate.weather_locked = false
	Game.player = null
	Game.world = null
	world.queue_free()
	await get_tree().process_frame


func _roundtrip() -> void:
	var s1 := Story.save_state()
	var g1 := Game.save_state()
	var txt := JSON.stringify({"story": s1, "game": g1})
	var back: Dictionary = JSON.parse_string(txt)
	var n_obj := Story.objectives.size()
	var done := 0
	for o in Story.objectives:
		if o["done"]:
			done += 1
	Story.reset_story()
	Game.flags.clear()
	Game.load_state(back["game"])
	Story.load_state(back["story"])
	var s2 := Story.save_state()
	var done2 := 0
	for o in Story.objectives:
		if o["done"]:
			done2 += 1
	check(Story.objectives.size() == n_obj and done == done2 and Story.act == int(s1["act"]), "mid-act load restores objectives and act")
	check(JSON.stringify(s1, "", true) == JSON.stringify(s2, "", true), "story state survives a JSON save/load roundtrip unchanged")
	check(bool(Game.get_flag(&"has_radio", false)), "game flags survive the roundtrip")


## Fakes whatever the condition needs, from the data (the same way the world would satisfy it).
func _satisfy(c: Variant, oid: StringName, pl: FakePlayer) -> void:
	if c is Array:
		for x in c:
			_satisfy(x, oid, pl)
		return
	if not (c is Dictionary):
		return
	var d: Dictionary = c
	if d.has("all"):
		for x in d["all"]:
			_satisfy(x, oid, pl)
		return
	if d.has("any"):
		_satisfy((d["any"] as Array)[0], oid, pl)
		return
	if d.has("not"):
		return
	var id := String(d.get("id", ""))
	match String(d.get("type", "")):
		"item":
			var need := int(d.get("count", 1)) - pl.inventory.count(StringName(id))
			if need > 0:
				pl.inventory.add(StringName(id), need)
				Events.item_picked_up.emit(StringName(id), need)
		"poi":
			_move_to_poi(pl, StringName(id))
			Story.discover_poi(StringName(id))
		"event":
			var via := _use_producing("event", id)
			if via != "":
				_use(via, pl)
			var beat: Variant = _beat_producing(id)
			if beat != null and not Story.events.has(id):
				_satisfy(beat, oid, pl)
				Story.evaluate_now()
			if not Story.events.has(id):
				Story.trigger(StringName(id))
		"use":
			_use(id, pl)
		"flag":
			var via := _use_producing("flag", id)
			if via != "":
				_use(via, pl)
			if not bool(Game.get_flag(StringName(id), false)):
				Game.set_flag(StringName(id), true)
		"crafted":
			Events.item_crafted.emit(StringName(id), 1)
		"log":
			Story.find_log(StringName(id))
		"time":
			Climate.advance_time(float(d.get("hours", 1.0)) + 0.1)
		"dawn":
			var t0 := float((Story.obj_meta.get(String(oid), {}) as Dictionary).get("t0", Story.abs_hours()))
			Climate.advance_time(maxf(0.1, Story.next_dawn(t0) - Story.abs_hours() + 0.1))
		"altitude":
			pl.global_position = Vector3(pl.global_position.x, float(d.get("min", 2000.0)) + 5.0, pl.global_position.z)
		"near":
			if d.has("poi"):
				_move_to_poi(pl, StringName(d["poi"]))
		"insulation":
			pl.insulation = float(d.get("min", 0.0)) + 1.0


func _move_to_poi(pl: FakePlayer, id: StringName) -> void:
	var poi: Dictionary = TerrainData.get_poi(id)
	if poi.is_empty():
		return
	var p: Vector3 = poi["position"]
	pl.global_position = Vector3(p.x, TerrainData.get_height(p.x, p.z) + 1.0, p.z)


func _use_producing(kind: String, id: String) -> String:
	for key: String in Story.graph.uses:
		var u: Dictionary = Story.graph.uses[key]
		if kind == "event" and (String(u.get("event", "")) == id or String(u.get("locked_event", "")) == id):
			return key
		if kind == "flag" and String(u.get("flag", "")) == id:
			return key
		# interactables that start a scripted sequence (generator, relay) produce what the sequence produces
		var seq: Dictionary = SG.SEQUENCE_PRODUCES.get(String(u.get("sequence", "")), {})
		if (seq.get("flags" if kind == "flag" else "events", []) as Array).has(id):
			return key
	return ""


## A beat whose voice chain ends by raising `id` (the wreck radio → "beacon_heard"): its trigger condition.
func _beat_producing(id: String) -> Variant:
	for b in Story.graph.beats:
		for a in b.get("do", []):
			if String(a.get("then", "")) == id:
				return b.get("when", {})
	return null


## Meets an interactable's requirements (items, flags) and uses it like the player would.
func _use(key: String, pl: FakePlayer) -> void:
	var u: Dictionary = Story.graph.uses.get(key, {})
	if u.has("requires_flag") and not bool(Game.get_flag(StringName(u["requires_flag"]), false)):
		var via := _use_producing("flag", String(u["requires_flag"]))
		if via != "" and via != key:
			_use(via, pl)
		if not bool(Game.get_flag(StringName(u["requires_flag"]), false)):
			Game.set_flag(StringName(u["requires_flag"]), true)
	var req: Dictionary = u.get("requires", {})
	for it in req:
		var need := int(req[it]) - pl.inventory.count(StringName(it))
		if need > 0:
			pl.inventory.add(StringName(it), need)
			Events.item_picked_up.emit(StringName(it), need)
	var parts := key.split("/")
	Story.use_socket(StringName(parts[0]), StringName(parts[1]), pl)

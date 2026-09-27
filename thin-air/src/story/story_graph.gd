class_name StoryGraph
extends RefCounted
## The objective graph of data/story.json (format in its "_doc"), pure data + static analysis. The Story
## autoload owns the runtime state and evaluates the conditions; this class parses the file and answers
## structural questions (prerequisite order, cycles, what every condition needs, what every action/use/sequence
## produces) so tests/test_story.gd can prove each objective is reachable and every reference exists.

const PATH := "res://data/story.json"

## What each scripted sequence (src/autoload/story.gd _seq_*) produces, so the analysis can see it.
const SEQUENCE_PRODUCES := {
	"generator_on": {"flags": ["generator_running", "station_power"], "events": ["generator_started"]},
	"relay_repair": {"flags": ["relay_repaired"], "events": ["relay_repaired"]},
	"final_night": {"flags": ["final_pack"], "events": []},
	"rescue": {"flags": [], "events": ["heli_landed", "rescue_boarded"]},
	"ending": {"flags": ["game_complete"], "events": ["story_complete"]},
}
## Events raised by other systems: Campfire.try_light, ItemActions.read_item ("read_<item>"),
## PoiDoor/Structures.travel ("enter_<site>"/"exit_<site>").
const EXTERNAL_EVENTS := ["campfire_lit", "read_survival_manual", "read_dale_logbook",
	"enter_ashford_mine_interior", "enter_ashford_mine", "enter_ice_cave", "enter_ice_cave_entrance"]

var data: Dictionary = {}
var objectives: Array[Dictionary] = []
var index: Dictionary = {}          # StringName id -> objective Dictionary
var beats: Array = []
var hints: Array = []
var uses: Dictionary = {}           # "site/socket" -> config
var scans: Dictionary = {}          # "site/socket" -> config
var pois: Dictionary = {}           # poi id -> {radius, music?}
var acts: Dictionary = {}
var interiors: Dictionary = {}
var mara_talk: Array = []


static func load_default() -> StoryGraph:
	var g := StoryGraph.new()
	g.load_from(PATH)
	return g


func load_from(path: String) -> bool:
	var txt := FileAccess.get_file_as_string(path)
	var v: Variant = JSON.parse_string(txt)
	if not (v is Dictionary):
		push_error("StoryGraph: cannot parse %s" % path)
		return false
	return load_dict(v)


func load_dict(d: Dictionary) -> bool:
	data = d
	objectives.clear()
	index.clear()
	for o in d.get("objectives", []):
		if o is Dictionary:
			objectives.append(o)
			index[StringName(o.get("id", ""))] = o
	beats = d.get("beats", [])
	hints = d.get("hints", [])
	uses = d.get("uses", {})
	scans = d.get("scans", {})
	pois = d.get("pois", {})
	acts = d.get("acts", {})
	interiors = d.get("interiors", {})
	mara_talk = d.get("mara_talk", [])
	return true


func get_objective(id: StringName) -> Dictionary:
	return index.get(id, {})


func has_objective(id: StringName) -> bool:
	return index.has(id)


func requires_of(id: StringName) -> Array[StringName]:
	var out: Array[StringName] = []
	for r in get_objective(id).get("requires", []):
		out.append(StringName(r))
	return out


## Objectives with no prerequisite objective (the graph's entry points).
func roots() -> Array[StringName]:
	var out: Array[StringName] = []
	for o in objectives:
		if (o.get("requires", []) as Array).is_empty():
			out.append(StringName(o["id"]))
	return out


## Topological order by `requires` (Kahn). Empty if there is a cycle.
func order() -> Array[StringName]:
	var indeg := {}
	for o in objectives:
		indeg[StringName(o["id"])] = 0
	for o in objectives:
		for r in o.get("requires", []):
			indeg[StringName(o["id"])] += 1
	var q: Array[StringName] = []
	for id: StringName in indeg:
		if indeg[id] == 0:
			q.append(id)
	var out: Array[StringName] = []
	while not q.is_empty():
		var id: StringName = q.pop_front()
		out.append(id)
		for o in objectives:
			if (o.get("requires", []) as Array).has(String(id)):
				var oid := StringName(o["id"])
				indeg[oid] -= 1
				if indeg[oid] == 0:
					q.append(oid)
	return out if out.size() == objectives.size() else ([] as Array[StringName])


func has_cycle() -> bool:
	return order().is_empty() and not objectives.is_empty()


## Objectives that are completed as the final step (nothing requires them).
func leaves() -> Array[StringName]:
	var needed := {}
	for o in objectives:
		for r in o.get("requires", []):
			needed[String(r)] = true
	var out: Array[StringName] = []
	for o in objectives:
		if not needed.has(String(o["id"])):
			out.append(StringName(o["id"]))
	return out


# ============================================================================================ references

## Every leaf condition inside a condition tree.
static func leaf_conditions(c: Variant) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if c is Array:
		for x in c:
			out.append_array(leaf_conditions(x))
	elif c is Dictionary:
		var d: Dictionary = c
		if d.has("all"):
			out.append_array(leaf_conditions(d["all"]))
		elif d.has("any"):
			out.append_array(leaf_conditions(d["any"]))
		elif d.has("not"):
			out.append_array(leaf_conditions(d["not"]))
		else:
			out.append(d)
	return out


## Every action list of the file (objective on_start/on_complete + beat do).
func all_actions() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for o in objectives:
		for key in ["on_start", "on_complete"]:
			for a in o.get(key, []):
				out.append(a)
	for b in beats:
		for a in b.get("do", []):
			out.append(a)
	return out


## All referenced ids by kind: items, pois, logs, voices, sockets ("site/socket"), sequences, blueprints.
func collect_refs() -> Dictionary:
	var r := {"items": {}, "pois": {}, "logs": {}, "voices": {}, "sockets": {}, "sequences": {}, "scans": {}}
	var conds: Array[Dictionary] = []
	for o in objectives:
		conds.append_array(leaf_conditions(o.get("complete", {})))
		conds.append_array(leaf_conditions(o.get("trigger", {})))
		var h: Dictionary = o.get("hint", {})
		if h.has("voice"):
			r["voices"][String(h["voice"])] = true
		for p in o.get("progress", []):
			r["items"][String(p)] = true
		if o.has("poi"):
			r["pois"][String(o["poi"])] = true
	for b in beats:
		conds.append_array(leaf_conditions(b.get("when", {})))
	for h in hints:
		conds.append_array(leaf_conditions(h.get("when", {})))
		r["voices"][String(h.get("id", ""))] = true
	for m in mara_talk:
		conds.append_array(leaf_conditions(m.get("when", {})))
		for l in m.get("lines", []):
			r["voices"][String(l)] = true
	for c in conds:
		match String(c.get("type", "")):
			"item":
				r["items"][String(c["id"])] = true
			"poi":
				r["pois"][String(c["id"])] = true
			"log":
				r["logs"][String(c["id"])] = true
			"use":
				r["sockets"][String(c["id"])] = true
			"scan":
				r["scans"][String(c["id"])] = true
			"near":
				if c.has("poi"):
					r["pois"][String(c["poi"])] = true
				if c.has("socket"):
					r["sockets"][String(c["socket"])] = true
	for a in all_actions():
		match String(a.get("do", "")):
			"voice", "voice3d":
				r["voices"][String(a["id"])] = true
				if a.has("at"):
					r["sockets"][String(a["at"])] = true
			"log":
				r["logs"][String(a["id"])] = true
			"give":
				r["items"][String(a["id"])] = true
			"sequence":
				r["sequences"][String(a["id"])] = true
			"reveal":
				for p in a.get("ids", []):
					r["pois"][String(p)] = true
	for key: String in uses:
		r["sockets"][key] = true
		var u: Dictionary = uses[key]
		for k in ["requires", "consume", "give"]:
			for id in (u.get(k, {}) as Dictionary):
				r["items"][String(id)] = true
		for p in u.get("reveal", []):
			r["pois"][String(p)] = true
		if u.has("sequence"):
			r["sequences"][String(u["sequence"])] = true
	for key: String in scans:
		r["sockets"][key] = true
	for p: String in pois:
		r["pois"][p] = true
	return r


## Events, flags and use-events that something in the game can produce (for reachability).
func producers() -> Dictionary:
	var ev := {}
	var fl := {}
	for e in EXTERNAL_EVENTS:
		ev[e] = true
	for a in all_actions():
		match String(a.get("do", "")):
			"flag":
				fl[String(a["id"])] = true
			"event":
				ev[String(a["id"])] = true
			"blueprint_flag":
				pass
			"sequence":
				_add_sequence(String(a["id"]), ev, fl)
		if a.has("then"):
			ev[String(a["then"])] = true
	for key: String in uses:
		var u: Dictionary = uses[key]
		ev["use:" + key] = true
		for k in ["event", "locked_event"]:
			if u.has(k):
				ev[String(u[k])] = true
		if u.has("flag"):
			fl[String(u["flag"])] = true
		if u.has("sequence"):
			_add_sequence(String(u["sequence"]), ev, fl)
	return {"events": ev, "flags": fl}


func _add_sequence(id: String, ev: Dictionary, fl: Dictionary) -> void:
	var s: Dictionary = SEQUENCE_PRODUCES.get(id, {})
	for e in s.get("events", []):
		ev[String(e)] = true
	for f in s.get("flags", []):
		fl[String(f)] = true


## Conditions of `c` that nothing can ever satisfy (events/flags/uses without a producer). `obtainable`
## is the set of item ids that can be found or made (loot, gives, recipes); pass {} to skip item checks.
func unsatisfiable(c: Variant, prod: Dictionary, obtainable: Dictionary) -> Array[String]:
	var bad: Array[String] = []
	if c is Dictionary and (c as Dictionary).has("any"):
		# an "any" is fine if one branch is satisfiable
		for b in (c as Dictionary)["any"]:
			if unsatisfiable(b, prod, obtainable).is_empty():
				return bad
		bad.append("no satisfiable branch in %s" % JSON.stringify(c))
		return bad
	if c is Dictionary and (c as Dictionary).has("not"):
		return bad
	if c is Dictionary and (c as Dictionary).has("all"):
		for b in (c as Dictionary)["all"]:
			bad.append_array(unsatisfiable(b, prod, obtainable))
		return bad
	for l in leaf_conditions(c):
		var t := String(l.get("type", ""))
		var id := String(l.get("id", ""))
		match t:
			"event":
				if not (prod["events"] as Dictionary).has(id):
					bad.append("event '%s' has no producer" % id)
			"use":
				if not uses.has(id):
					bad.append("use '%s' is not a placed interactable" % id)
			"flag":
				if not (prod["flags"] as Dictionary).has(id) and id != "has_radio":
					bad.append("flag '%s' has no producer" % id)
			"item":
				if not obtainable.is_empty() and not obtainable.has(id):
					bad.append("item '%s' cannot be found or made" % id)
			"objective":
				if not index.has(StringName(id)):
					bad.append("objective '%s' does not exist" % id)
	return bad


## Objective ids reachable from the roots: every prerequisite reachable and trigger/complete satisfiable.
func reachable(obtainable: Dictionary) -> Array[StringName]:
	var prod := producers()
	var ok := {}
	for id in order():
		var o := get_objective(id)
		var fine := true
		for r in o.get("requires", []):
			if not ok.has(StringName(r)):
				fine = false
		if fine and not unsatisfiable(o.get("trigger", {}), prod, obtainable).is_empty():
			fine = false
		if fine and not unsatisfiable(o.get("complete", {}), prod, obtainable).is_empty():
			fine = false
		if fine:
			ok[id] = true
	var out: Array[StringName] = []
	for id: StringName in ok:
		out.append(id)
	return out

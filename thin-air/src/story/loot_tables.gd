class_name LootTables
extends RefCounted
## data/loot.json: which items lie at the Loot_* sockets of each story location. Fixed entries (quest items,
## set dressing) always spawn; table entries roll deterministically per site + socket (seeded), so a world
## always holds the same loot and placed-loot keys stay stable across saves (ItemsRoot remembers collected keys).

const PATH := "res://data/loot.json"

static var _data: Dictionary = {}


static func data() -> Dictionary:
	if _data.is_empty():
		var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		_data = v if v is Dictionary else {}
	return _data


static func tables() -> Dictionary:
	return data().get("tables", {})


static func site_sockets(site: StringName) -> Dictionary:
	return (data().get("sites", {}) as Dictionary).get(String(site), {})


## Resolved pickups for one socket: [{item: StringName, count: int, offset: Vector3, requires_flag: StringName,
## persist_id: String}]. Deterministic.
static func roll(site: StringName, socket: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var entries: Array = site_sockets(site).get(socket, [])
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("thin-air-loot:%s:%s" % [site, socket])
	var n := 0
	for e in entries:
		if not (e is Dictionary):
			continue
		var ed: Dictionary = e
		var flag := StringName(ed.get("requires_flag", ""))
		var base := _v3(ed.get("offset", []))
		if ed.has("item"):
			out.append({"item": StringName(ed["item"]), "count": int(ed.get("count", 1)), "offset": base,
				"requires_flag": flag, "persist_id": "loot:%s:%s:%d" % [site, socket, n]})
			n += 1
		elif ed.has("table"):
			var t: Array = tables().get(String(ed["table"]), [])
			for r in int(ed.get("rolls", 1)):
				var pick := _pick(t, rng)
				if pick.is_empty():
					continue
				var c := rng.randi_range(int(pick.get("min", 1)), int(pick.get("max", 1)))
				# spread rolled items a little so they don't stack inside each other
				var off := base + Vector3(rng.randf_range(-0.16, 0.16), 0.0, rng.randf_range(-0.12, 0.12)) + Vector3(0.22 * float(r), 0.0, 0.0)
				out.append({"item": StringName(pick["id"]), "count": maxi(1, c), "offset": off,
					"requires_flag": flag, "persist_id": "loot:%s:%s:%d" % [site, socket, n]})
				n += 1
	return out


static func _pick(t: Array, rng: RandomNumberGenerator) -> Dictionary:
	var total := 0.0
	for e in t:
		total += float(e.get("w", 1.0))
	if total <= 0.0:
		return {}
	var x := rng.randf() * total
	for e in t:
		x -= float(e.get("w", 1.0))
		if x <= 0.0:
			return e
	return t[t.size() - 1]


static func _v3(a: Variant) -> Vector3:
	if a is Array and (a as Array).size() >= 3:
		return Vector3(float(a[0]), float(a[1]), float(a[2]))
	return Vector3.ZERO


## Every item id any table or fixed entry can produce (tests: all exist in ItemDB).
static func all_items() -> Dictionary:
	var out := {}
	for t in tables().values():
		for e in t:
			out[String(e.get("id", ""))] = true
	for s in (data().get("sites", {}) as Dictionary).values():
		for list in (s as Dictionary).values():
			for e in list:
				if (e as Dictionary).has("item"):
					out[String(e["item"])] = true
	return out

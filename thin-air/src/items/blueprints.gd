class_name Blueprints
extends RefCounted
## Blueprint unlocks for recipes and buildables (CONTRACT.md §6.1). Stored JSON-safe in
## Game.flags[&"blueprints"] as an Array of id Strings, so they save/load with the Game flags.
##
## Unlock rules live in the data: a recipe/buildable with "requires_blueprint": true may carry
## "unlock": {"pickup": [item ids], "read": [item ids], "scan": [scan target ids], "flag": [flag ids],
##            "craft": [recipe or item ids]}.
## Picking up / reading / scanning / setting a flag / crafting calls the matching unlock_for_*().

const FLAG := &"blueprints"


static func _list() -> Array:
	var l: Variant = Game.flags.get(FLAG, null)
	if not (l is Array):
		l = []
		Game.flags[FLAG] = l
	return l


static func is_unlocked(id: StringName) -> bool:
	return _list().has(String(id))


## Unlocks one blueprint. Emits Events.blueprint_unlocked and (unless silent) a toast. False if already known.
static func unlock(id: StringName, silent := false) -> bool:
	var l := _list()
	var s := String(id)
	if s == "" or l.has(s):
		return false
	l.append(s)
	Events.blueprint_unlocked.emit(id)
	if not silent:
		Game.notify("New blueprint: %s" % display_name(id), &"blueprint")
		Audio.play_stinger(&"blueprint")
	return true


## Unlocks several at once with a single combined toast. Returns the ids that were newly unlocked.
static func unlock_many(ids: Array[StringName], silent := false) -> Array[StringName]:
	var fresh: Array[StringName] = []
	for id in ids:
		if unlock(id, true):
			fresh.append(id)
	if fresh.is_empty() or silent:
		return fresh
	if fresh.size() == 1:
		Game.notify("New blueprint: %s" % display_name(fresh[0]), &"blueprint")
	else:
		var names: PackedStringArray = []
		for i in mini(fresh.size(), 3):
			names.append(display_name(fresh[i]))
		var more := "" if fresh.size() <= 3 else "  +%d more" % (fresh.size() - 3)
		Game.notify("%d new blueprints: %s%s" % [fresh.size(), ", ".join(names), more], &"blueprint")
	Audio.play_stinger(&"blueprint")
	return fresh


static func lock(id: StringName) -> void:
	_list().erase(String(id))


static func all_unlocked() -> Array[StringName]:
	var out: Array[StringName] = []
	for s in _list():
		out.append(StringName(s))
	return out


static func reset() -> void:
	Game.flags[FLAG] = []


## True if the recipe/buildable needs a blueprint at all.
static func needs_blueprint(id: StringName) -> bool:
	var r := ItemDB.get_recipe(id)
	if not r.is_empty():
		return bool(r.get("requires_blueprint", false))
	var b := ItemDB.get_buildable(id)
	if not b.is_empty():
		return bool(b.get("requires_blueprint", false))
	return false


## Craftable/buildable as far as knowledge goes (no blueprint needed, or unlocked).
static func is_available(id: StringName) -> bool:
	return not needs_blueprint(id) or is_unlocked(id)


static func is_recipe_available(recipe: Dictionary) -> bool:
	if not bool(recipe.get("requires_blueprint", false)):
		return true
	return is_unlocked(StringName(recipe.get("id", "")))


static func unlock_for_pickup(item_id: StringName) -> Array[StringName]:
	return _unlock_by_rule("pickup", item_id)


static func unlock_for_read(item_id: StringName) -> Array[StringName]:
	return _unlock_by_rule("read", item_id)


static func unlock_for_scan(target_id: StringName) -> Array[StringName]:
	return _unlock_by_rule("scan", target_id)


static func unlock_for_flag(flag: StringName) -> Array[StringName]:
	return _unlock_by_rule("flag", flag)


## Crafting something can teach the next step (e.g. a bow teaches arrows). Matches recipe id or result id.
static func unlock_for_craft(recipe_id: StringName, result_id: StringName = &"") -> Array[StringName]:
	var out := _unlock_by_rule("craft", recipe_id)
	if result_id != &"" and result_id != recipe_id:
		out.append_array(_unlock_by_rule("craft", result_id))
	return out


## Every blueprint id a given trigger would unlock (without unlocking). rule: pickup/read/scan/flag/craft.
static func candidates(rule: String, key: StringName) -> Array[StringName]:
	var out: Array[StringName] = []
	var k := String(key)
	for r in ItemDB.recipes:
		if bool(r.get("requires_blueprint", false)) and _rule_has(r, rule, k):
			out.append(StringName(r.get("id", "")))
	for bid in ItemDB.buildables:
		var b: Dictionary = ItemDB.buildables[bid]
		if bool(b.get("requires_blueprint", false)) and _rule_has(b, rule, k):
			out.append(bid)
	return out


static func _rule_has(entry: Dictionary, rule: String, key: String) -> bool:
	var u: Variant = entry.get("unlock", null)
	if not (u is Dictionary):
		return false
	var list: Variant = (u as Dictionary).get(rule, [])
	return list is Array and (list as Array).has(key)


static func _unlock_by_rule(rule: String, key: StringName) -> Array[StringName]:
	var todo: Array[StringName] = []
	for id in candidates(rule, key):
		if not is_unlocked(id):
			todo.append(id)
	if todo.is_empty():
		return todo
	return unlock_many(todo)


## Human name for a blueprint id: the result item's name (+ variant), or the buildable's name.
static func display_name(id: StringName) -> String:
	var r := ItemDB.get_recipe(id)
	if not r.is_empty():
		var item := ItemDB.get_item(StringName(r.get("result", "")))
		var n := String(item.get("name", String(id).capitalize()))
		var v := String(r.get("variant", ""))
		return n if v == "" else "%s (%s)" % [n, v]
	var b := ItemDB.get_buildable(id)
	if not b.is_empty():
		return String(b.get("name", String(id).capitalize()))
	var it := ItemDB.get_item(id)
	return String(it.get("name", String(id).capitalize()))

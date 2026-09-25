class_name Crafting
extends RefCounted
## Recipe logic (CONTRACT.md §6). Pure functions over an Inventory; the UI drives timed crafting with CraftJob.
##
## Stations: "hand" recipes work anywhere; "campfire" / "workbench" / "fabricator" recipes need that station,
## either passed explicitly or found near the player (nodes in group "crafting_station", see stations/station.gd).
## Tools listed in a recipe are matched against an item's id, its tool.type or its tags ("knife" matches the
## bushcraft knife and the chert blade; "boil_vessel" matches the cooking pot and the canteen).

const TOOL_WEAR := 0.02            ## durability fraction a tool loses per craft
const STATION_GROUP := &"crafting_station"


## Returns {ok, missing: {id: count}, missing_tools: [String], locked, station_ok, room, reason}.
static func can_craft(recipe: Dictionary, inventory: Inventory, station: StringName = &"hand", player: Node = null) -> Dictionary:
	var out := {"ok": false, "missing": {}, "missing_tools": [], "locked": false, "station_ok": true,
		"room": true, "reason": ""}
	if recipe.is_empty() or inventory == null:
		out["reason"] = "Unknown recipe"
		return out
	var need_station := StringName(recipe.get("station", "hand"))
	out["station_ok"] = station_satisfies(station, need_station) \
		or (player != null and available_stations(player).has(need_station))
	out["locked"] = not Blueprints.is_recipe_available(recipe)
	var ing: Dictionary = recipe.get("ingredients", {})
	var missing: Dictionary = out["missing"]
	for k in ing:
		var need := int(ing[k])
		var have := inventory.count(StringName(k))
		if have < need:
			missing[String(k)] = need - have
	var missing_tools: Array = out["missing_tools"]
	for t in recipe.get("tools", []):
		if find_tool(inventory, StringName(t)) < 0:
			missing_tools.append(String(t))
	out["room"] = _has_room_after(recipe, inventory)
	if bool(out["locked"]):
		out["reason"] = "Blueprint unknown"
	elif not bool(out["station_ok"]):
		out["reason"] = "Needs a %s" % station_name(need_station).to_lower()
	elif not missing.is_empty():
		out["reason"] = "Missing materials"
	elif not missing_tools.is_empty():
		out["reason"] = "Needs %s" % tool_name(StringName(missing_tools[0])).to_lower()
	out["ok"] = not bool(out["locked"]) and bool(out["station_ok"]) and missing.is_empty() and missing_tools.is_empty()
	return out


## Instant craft: takes ingredients, wears tools, adds the result. Does not check station/blueprint (use
## can_craft first). Returns {ok, result, count, overflow} — overflow is the count that did not fit.
static func craft(recipe: Dictionary, inventory: Inventory) -> Dictionary:
	if not take_ingredients(recipe, inventory):
		return {"ok": false, "result": &"", "count": 0, "overflow": 0}
	return complete(recipe, inventory)


## Starts a timed craft: ingredients are taken now (refunded by CraftJob.cancel()). Null if not craftable.
static func begin(recipe: Dictionary, inventory: Inventory, station: StringName = &"hand", player: Node = null,
		time_scale := 1.0) -> CraftJob:
	var chk := can_craft(recipe, inventory, station, player)
	if not bool(chk["ok"]):
		return null
	if not take_ingredients(recipe, inventory):
		return null
	var job := CraftJob.new()
	job.recipe = recipe
	job.inventory = inventory
	job.station = StringName(recipe.get("station", "hand"))
	job.duration = maxf(0.05, float(recipe.get("time", 3.0)) * time_scale)
	return job


static func take_ingredients(recipe: Dictionary, inventory: Inventory) -> bool:
	var ing: Dictionary = recipe.get("ingredients", {})
	if not inventory.has_all(ing):
		return false
	for t in recipe.get("tools", []):
		if find_tool(inventory, StringName(t)) < 0:
			return false
	return inventory.remove_all(ing)


static func refund_ingredients(recipe: Dictionary, inventory: Inventory) -> int:
	var overflow := 0
	var ing: Dictionary = recipe.get("ingredients", {})
	for k in ing:
		overflow += inventory.add(StringName(k), int(ing[k]))
	return overflow


## Second half of a craft (after the ingredients were taken): wear tools, add results, fire events/unlocks.
static func complete(recipe: Dictionary, inventory: Inventory) -> Dictionary:
	for t in recipe.get("tools", []):
		var idx := find_tool(inventory, StringName(t))
		if idx >= 0 and _wears(inventory.get_slot(idx)["id"]):
			inventory.use_durability(idx, TOOL_WEAR)
	var result := StringName(recipe.get("result", ""))
	var n := int(recipe.get("count", 1))
	var overflow := inventory.add(result, n)
	Events.item_crafted.emit(result, n)
	Blueprints.unlock_for_craft(StringName(recipe.get("id", "")), result)
	return {"ok": true, "result": result, "count": n, "overflow": overflow}


## Index of the first slot holding an item that satisfies a tool requirement, or -1.
static func find_tool(inventory: Inventory, key: StringName) -> int:
	for i in inventory.slots.size():
		var s := inventory.slots[i]
		if s.is_empty():
			continue
		if tool_matches(StringName(s["id"]), key):
			return i
	return -1


static func tool_matches(item_id: StringName, key: StringName) -> bool:
	if item_id == key:
		return true
	var d := ItemDB.get_item(item_id)
	var t: Variant = d.get("tool", null)
	if t is Dictionary and StringName((t as Dictionary).get("type", "")) == key:
		return true
	return (d.get("tags", []) as Array).has(String(key))


static func _wears(item_id: StringName) -> bool:
	var t: Variant = ItemDB.get_item(item_id).get("tool", null)
	# The canteen's slot durability is its fill level (player consumable), not wear: boiling in it must
	# not "wear" (and at 0 % destroy) it.
	if t is Dictionary and String((t as Dictionary).get("type", "")) == "canteen":
		return false
	return t is Dictionary and int((t as Dictionary).get("durability", 0)) > 1


static func _has_room_after(recipe: Dictionary, inventory: Inventory) -> bool:
	var result := StringName(recipe.get("result", ""))
	var n := int(recipe.get("count", 1))
	if inventory.can_add(result, n):
		return true
	# Ingredients free space when consumed: simulate on a copy.
	var sim := Inventory.new(inventory.size(), inventory.max_weight)
	for i in inventory.size():
		var s := inventory.slots[i]
		sim.slots[i] = {} if s.is_empty() else s.duplicate()
	if not sim.remove_all(recipe.get("ingredients", {})):
		return false
	return sim.can_add(result, n)


static func station_satisfies(current: StringName, required: StringName) -> bool:
	return required == &"hand" or required == &"" or current == required


## Stations usable right now by the player: always "hand", plus active stations within reach.
static func available_stations(player: Node) -> Array[StringName]:
	var out: Array[StringName] = [&"hand"]
	if player == null or not (player is Node3D) or not player.is_inside_tree():
		return out
	var p := (player as Node3D).global_position
	for n in player.get_tree().get_nodes_in_group(STATION_GROUP):
		if not (n is Node3D) or not n.has_method("is_station_active"):
			continue
		if not n.is_station_active():
			continue
		var r := float(n.get("use_radius")) if n.get("use_radius") != null else 3.0
		if (n as Node3D).global_position.distance_to(p) <= r:
			var sid: StringName = n.get("station_id")
			if not out.has(sid):
				out.append(sid)
	return out


## All recipes visible at a station (the station's own + hand recipes), in data order.
static func recipes_for(station: StringName, include_hand := true) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for r in ItemDB.recipes:
		var s := StringName(r.get("station", "hand"))
		if s == station or (include_hand and s == &"hand"):
			out.append(r)
	return out


static func station_name(station: StringName) -> String:
	match station:
		&"hand": return "Hand"
		&"campfire": return "Campfire"
		&"workbench": return "Workbench"
		&"fabricator": return "Fabricator"
	return String(station).capitalize()


static func tool_name(key: StringName) -> String:
	if ItemDB.has_item(key):
		return String(ItemDB.get_item(key).get("name", key))
	match key:
		&"knife": return "A knife"
		&"needle": return "A needle"
		&"boil_vessel": return "A pot or canteen"
		&"hammer": return "A hammer"
	return String(key).capitalize()

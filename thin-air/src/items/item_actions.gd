class_name ItemActions
extends RefCounted
## Player-facing item verbs shared by the inventory UI, stations and other workstreams: use/consume, read,
## wear/hold, take off, drop, hotbar assignment, carry capacity, ignition. Works against the Player contract
## (CONTRACT.md §4) and tolerates stand-ins: every player call is guarded with has_method()/get().
##
## Convention: worn equipment lives OUTSIDE the inventory (moved out on wear, back in on take-off). If the
## player's own equip()/unequip() already moved the item, these helpers notice and don't double-move it.

const BASE_SLOTS := 24          ## no backpack (matches the contract's Inventory default)
const BASE_WEIGHT := 30.0
## Worn slots. feet_addon (crampons over boots) and mask (O2 mask beside goggles) are the Player's extra slots.
const EQUIP_SLOTS: Array[StringName] = [&"head", &"face", &"body", &"legs", &"hands", &"feet", &"back",
	&"feet_addon", &"mask"]
const HOTBAR_SIZE := 6


static func inventory_of(player: Node) -> Inventory:
	if player == null:
		return null
	var v: Variant = player.get("inventory")
	return v as Inventory if v is Inventory else null


static func equipment_of(player: Node) -> Dictionary:
	if player == null:
		return {}
	var v: Variant = player.get("equipment")
	return v if v is Dictionary else {}


static func hotbar_of(player: Node) -> Array:
	if player == null:
		return []
	var v: Variant = player.get("hotbar")
	return v if v is Array else []


# ------------------------------------------------------------------------------------------------ use

## Primary action on an inventory slot (eat/drink/apply/read/wear/hold). Returns true if something happened.
static func use_slot(player: Node, inv: Inventory, index: int) -> bool:
	var s := inv.get_slot(index)
	if s.is_empty():
		return false
	var id: StringName = s["id"]
	var d := ItemDB.get_item(id)
	if d.has("food") or d.has("medical"):
		return consume_slot(player, inv, index)
	if d.has("read"):
		read_item(player, id)
		return true
	if ItemInfo.is_wearable(id):
		return equip_slot(player, inv, index)
	if ItemInfo.is_holdable(id):
		return hold_item(player, id)
	return false


static func consume_slot(player: Node, inv: Inventory, index: int) -> bool:
	var s := inv.get_slot(index)
	if s.is_empty():
		return false
	var id: StringName = s["id"]
	var d := ItemDB.get_item(id)
	var vitals: Variant = player.get("vitals") if player != null else null
	if vitals is Object and (vitals as Object).has_method("consume"):
		(vitals as Object).call("consume", id)     # Vitals.consume() emits Events.item_consumed itself
	else:
		Events.item_consumed.emit(id)
	inv.remove_at(index, 1)
	return_container(player, inv, id)
	var cat := String(d.get("category", ""))
	Audio.play_sfx(&"drink" if cat == "drink" or id == &"snow" else (&"eat" if cat == "food" else &"pickup"))
	return true


## Gives back the empty container of a used-up item (tin can, bottle, empty O2 bottle): into the pack, or
## dropped at the player's feet when the pack is full.
static func return_container(player: Node, inv: Inventory, id: StringName) -> void:
	var cont := StringName(ItemDB.get_item(id).get("container", ""))
	if cont == &"" or not ItemDB.has_item(cont) or inv == null:
		return
	if inv.add(cont, 1) > 0:
		drop_stack(player, {"id": cont, "count": 1, "durability": 1.0})


static func read_item(_player: Node, id: StringName) -> void:
	var d := ItemDB.get_item(id)
	var rd: Dictionary = d.get("read", {})
	var flag := StringName("read_%s" % id)
	var first := not bool(Game.get_flag(flag, false))
	Game.set_flag(flag, true)
	var unlocked: Array[StringName] = []
	if bool(rd.get("unlocks", false)):
		unlocked = Blueprints.unlock_for_read(id)
	var log_id := StringName(rd.get("log", ""))
	if log_id != &"" and Story.has_method("find_log"):
		Story.find_log(log_id)
	if Story.has_method("trigger"):
		Story.trigger(flag)
	if unlocked.is_empty() and log_id == &"":
		Game.notify(("You read the %s." if first else "You leaf through the %s again.") % ItemInfo.name_of(id).to_lower(), &"info")


# ------------------------------------------------------------------------------------------------ wear / hold

static func equip_slot(player: Node, inv: Inventory, index: int) -> bool:
	var s := inv.get_slot(index)
	if s.is_empty() or player == null:
		return false
	var id: StringName = s["id"]
	var slot := wear_slot(player, id)
	if slot == &"hand":
		return hold_item(player, id)
	if slot == &"":
		return false
	var eq := equipment_of(player)
	var prev: StringName = eq.get(slot, &"")
	var before := inv.count(id)
	var prev_before := inv.count(prev) if prev != &"" else 0
	if player.has_method("equip"):
		if not bool(player.call("equip", id)):
			return false
	else:
		eq[slot] = id
		Events.equipment_changed.emit(slot, id)
	eq = equipment_of(player)
	if StringName(eq.get(slot, &"")) != id:
		return false
	if inv.count(id) == before:
		if not inv.is_slot_empty(index) and inv.get_slot(index)["id"] == id:
			inv.remove_at(index, 1)
		else:
			inv.remove(id, 1)
	if prev != &"" and prev != id and inv.count(prev) == prev_before:
		if inv.add(prev, 1) > 0:
			drop_stack(player, {"id": prev, "count": 1, "durability": 1.0})
	if slot == &"back":
		apply_carry_capacity(player)
	Audio.play_sfx(&"equip")
	return true


## Slot `id` is worn in on this player (the Player's own rule when it has one, else ItemInfo.wear_slot()).
static func wear_slot(player: Node, id: StringName) -> StringName:
	if player != null and player.has_method("get_equip_slot"):
		return StringName(player.call("get_equip_slot", id))
	return ItemInfo.wear_slot(id)


## Takes off whatever is worn in `slot` and puts it back in the inventory. False if there's no room.
static func unequip(player: Node, slot: StringName) -> bool:
	var eq := equipment_of(player)
	var id: StringName = eq.get(slot, &"")
	if id == &"":
		return false
	var inv := inventory_of(player)
	if inv != null and not inv.can_add(id, 1):
		Game.notify("No room in your pack to take that off.", &"warning")
		return false
	var before := inv.count(id) if inv != null else 0
	if player.has_method("unequip"):
		player.call("unequip", slot)
	else:
		eq[slot] = &""
		Events.equipment_changed.emit(slot, &"")
	eq = equipment_of(player)
	if StringName(eq.get(slot, &"")) == id:
		return false
	if inv != null and inv.count(id) == before:
		inv.add(id, 1)
	if slot == &"back":
		apply_carry_capacity(player)
	Audio.play_sfx(&"equip")
	return true


## Puts a hand item (tool/weapon/light) on the hotbar (if not already) and selects it.
static func hold_item(player: Node, id: StringName) -> bool:
	var hb := hotbar_of(player)
	if hb.is_empty():
		return bool(player.call("equip", id)) if player != null and player.has_method("equip") else false
	var idx := hb.find(id)
	if idx < 0:
		idx = hb.find(&"")
		if idx < 0:
			var active := int(player.get("active_slot")) if player.get("active_slot") != null else 0
			idx = clampi(active, 0, hb.size() - 1)
		hb[idx] = id
		Events.inventory_changed.emit()
	if player.has_method("select_hotbar"):
		player.call("select_hotbar", idx)
	elif player.has_method("equip"):
		player.call("equip", id)
	Audio.play_sfx(&"equip")
	return true


## Assigns an item to hotbar slot `index` (removing it from any other hotbar slot). id &"" clears.
static func assign_hotbar(player: Node, index: int, id: StringName) -> void:
	var hb := hotbar_of(player)
	if index < 0 or index >= hb.size():
		return
	if id != &"":
		for i in hb.size():
			if hb[i] == id:
				hb[i] = &""
	hb[index] = id
	Events.inventory_changed.emit()


# ------------------------------------------------------------------------------------------------ drop

static func drop_slot(player: Node, inv: Inventory, index: int, count := -1) -> bool:
	var st := inv.remove_at(index, count)
	if st.is_empty():
		return false
	drop_stack(player, st)
	Events.item_dropped.emit(StringName(st["id"]), int(st["count"]))
	return true


## Spawns a stack as a physics pickup in front of the player (or at the world origin without a player).
static func drop_stack(player: Node, stack: Dictionary) -> ItemPickup:
	var pos := Vector3.ZERO
	var fwd := Vector3.FORWARD
	if player is Node3D and (player as Node3D).is_inside_tree():
		var p3 := player as Node3D
		pos = p3.global_position + Vector3.UP * 1.2
		if player.has_method("get_eye_position"):
			pos = player.call("get_eye_position")
		if player.has_method("get_look_direction"):
			fwd = player.call("get_look_direction")
		else:
			fwd = -p3.global_transform.basis.z
	var flat := Vector3(fwd.x, 0.0, fwd.z)
	flat = flat.normalized() if flat.length_squared() > 0.001 else Vector3.FORWARD
	var at := pos + flat * 0.75 - Vector3.UP * 0.45
	var impulse := (flat * 1.6 + Vector3.UP * 0.8)
	Audio.play_sfx(&"drop", at)
	var p := ItemsRoot.spawn(StringName(stack.get("id", "")), int(stack.get("count", 1)), at, impulse,
		float(stack.get("durability", 1.0)))
	if p:
		p.extra = stack_extra(stack)
	return p


## The per-stack state beyond {id, count, durability} that survives dropping/saving (JSON-safe values only).
static func stack_extra(stack: Dictionary) -> Dictionary:
	var out := {}
	for k in stack:
		var v: Variant = stack[k]
		if not (String(k) in ["id", "count", "durability"]) and (v is bool or v is int or v is float or v is String):
			out[String(k)] = v
	return out


# ------------------------------------------------------------------------------------------------ stats

static func apply_carry_capacity(player: Node) -> void:
	var inv := inventory_of(player)
	if inv == null:
		return
	var back: StringName = equipment_of(player).get(&"back", &"")
	var carry: Dictionary = ItemDB.get_item(back).get("carry", {}) if back != &"" else {}
	inv.max_weight = float(carry.get("weight", BASE_WEIGHT))
	inv.resize(int(carry.get("slots", BASE_SLOTS)))


## Summed clothing values over an equipment dictionary: {insulation °C, windproof 0..1, waterproof 0..1}.
## Wind/waterproofing is weighted towards the body layer (the biggest area of skin).
static func clothing_totals(equipment: Dictionary) -> Dictionary:
	const AREA := {&"head": 0.1, &"face": 0.05, &"body": 0.45, &"legs": 0.25, &"hands": 0.07, &"feet": 0.08, &"back": 0.0,
		&"mask": 0.03, &"feet_addon": 0.0}
	var ins := 0.0
	var wind := 0.0
	var water := 0.0
	var covered_legs := false
	for slot in equipment:
		var id: StringName = equipment[slot]
		if id == &"":
			continue
		var c: Dictionary = ItemDB.get_item(id).get("clothing", {})
		ins += float(c.get("insulation", 0.0))
		var a := float(AREA.get(StringName(slot), 0.0))
		wind += a * float(c.get("windproof", 0.0))
		water += a * float(c.get("waterproof", 0.0))
		if (ItemDB.get_item(id).get("covers", []) as Array).has("legs"):
			covered_legs = true
			wind += 0.25 * float(c.get("windproof", 0.0))
			water += 0.25 * float(c.get("waterproof", 0.0))
	if covered_legs:
		var legs: StringName = equipment.get(&"legs", &"")
		if legs != &"":
			var lc: Dictionary = ItemDB.get_item(legs).get("clothing", {})
			wind -= 0.25 * float(lc.get("windproof", 0.0))
			water -= 0.25 * float(lc.get("waterproof", 0.0))
	return {"insulation": ins, "windproof": clampf(wind, 0.0, 1.0), "waterproof": clampf(water, 0.0, 1.0)}


## Gear tags available to the player: worn items plus carried gear (crampons, rope, ice axe travel in the pack).
static func gear_tags(player: Node) -> Array[StringName]:
	var out: Array[StringName] = []
	var eq := equipment_of(player)
	for slot in eq:
		for g in ItemDB.get_item(StringName(eq[slot])).get("gear", []):
			if not out.has(StringName(g)):
				out.append(StringName(g))
	var inv := inventory_of(player)
	if inv != null:
		for s in inv.slots:
			if s.is_empty():
				continue
			var d := ItemDB.get_item(s["id"])
			# Carried gear counts (ice axe, rope); wearable gear (crampons, masks, goggles) only when worn.
			if ItemInfo.wear_slot_of(d) in [&"", &"hand"]:
				for g in d.get("gear", []):
					if not out.has(StringName(g)):
						out.append(StringName(g))
	return out


# ------------------------------------------------------------------------------------------------ fire

## The best igniter the player carries: slot index or -1. Prefers reliable ones (lighter > matches > rod > drill).
static func find_igniter(inv: Inventory) -> int:
	var best := -1
	var best_chance := -1.0
	for i in inv.slots.size():
		var s := inv.slots[i]
		if s.is_empty():
			continue
		var ign: Variant = ItemDB.get_item(s["id"]).get("ignite", null)
		if not (ign is Dictionary):
			continue
		var c := float((ign as Dictionary).get("chance", 0.0))
		if bool((ign as Dictionary).get("needs_tinder", false)) and inv.count(&"tinder") <= 0:
			c *= 0.15
		if c > best_chance:
			best_chance = c
			best = i
	return best


## One attempt to light a fire. `exposure` 0..1 (1 = full wind). Consumes a match / wears the lighter / uses
## tinder where needed. Returns {ok: bool, text: String}.
static func try_ignite(inv: Inventory, exposure := 1.0, rng: RandomNumberGenerator = null) -> Dictionary:
	var idx := find_igniter(inv)
	if idx < 0:
		return {"ok": false, "text": "You have nothing to light it with."}
	var id: StringName = inv.get_slot(idx)["id"]
	var ign: Dictionary = ItemDB.get_item(id).get("ignite", {})
	var chance := float(ign.get("chance", 0.5))
	var has_tinder := inv.count(&"tinder") > 0
	if bool(ign.get("needs_tinder", false)) and not has_tinder:
		chance *= 0.15
	elif has_tinder:
		chance = minf(0.98, chance + 0.15)
	var wind := 0.0
	if Climate.has_method("get_wind_at") and Game.player is Node3D:
		wind = (Climate.get_wind_at((Game.player as Node3D).global_position) as Vector3).length()
	chance *= clampf(1.0 - maxf(0.0, wind - 4.0) * 0.05 * exposure, 0.35, 1.0)
	if rng == null:
		rng = RandomNumberGenerator.new()
		rng.randomize()
	var ok := rng.randf() < chance
	if int(ign.get("consume", 0)) > 0:
		inv.remove_at(idx, int(ign["consume"]))
	elif float(ign.get("wear", 0.0)) > 0.0:
		inv.use_durability(idx, float(ign["wear"]))
	if ok and (bool(ign.get("needs_tinder", false)) or has_tinder) and has_tinder:
		inv.remove(&"tinder", 1)
	var name := ItemInfo.name_of(id).to_lower()
	if ok:
		return {"ok": true, "text": "", "igniter": id}
	var fails := {
		&"matches": "The match flares and dies in the wind.",
		&"lighter": "The lighter sparks but won't catch. Your fingers are numb.",
		&"ferro_rod": "Sparks shower the tinder, but nothing takes.",
		&"bow_drill": "Smoke, but no ember. Your arms burn.",
	}
	return {"ok": false, "text": String(fails.get(id, "The %s fails to catch." % name)), "igniter": id}

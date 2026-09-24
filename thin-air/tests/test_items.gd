extends TestCase
## Items workstream tests: data integrity, crafting, blueprints, pickups, storage persistence, campfire,
## item actions, procedural models and the inventory screen lifecycle.
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_items.gd

const CANONICAL := [
	"stick", "log", "stone", "flint", "fiber", "bark", "resin", "feather", "bone", "hide_raw", "hide_cured", "wool",
	"cloth", "scrap_metal", "wire", "duct_tape", "rope", "nails", "fuel_can", "battery", "electronics", "charcoal",
	"tinder", "berries", "mushroom", "meat_raw", "meat_cooked", "fish_raw", "fish_cooked", "ration_bar", "canned_beans",
	"pine_tea", "coffee", "water_unsafe", "water_boiled", "bottle_empty", "stone_axe", "hatchet", "felling_axe", "knife",
	"stone_knife", "spear", "bow", "arrow", "torch", "flare", "flare_gun", "flare_shell", "lantern", "ice_axe",
	"canteen", "cooking_pot", "binoculars", "survey_scanner", "map", "compass", "hammer", "lighter", "matches",
	"o2_bottle", "crampons", "climbing_rope", "o2_mask", "goggles", "bandage", "first_aid_kit", "painkillers", "splint",
	"herbal_poultice", "wool_hat", "fur_hat", "parka", "hide_coat", "down_suit", "hiking_pants", "insulated_pants",
	"work_gloves", "fur_mitts", "boots", "mountaineering_boots", "backpack_torn", "backpack", "expedition_pack",
	"survival_manual", "radio_handheld", "transceiver_module", "battery_pack", "mine_key", "station_keycard",
	"dale_logbook"]
const CATEGORIES := ["resource", "food", "drink", "tool", "weapon", "ammo", "clothing", "medical", "light", "fuel",
	"quest", "placeable"]
const SLOTS := ["", "hand", "head", "face", "body", "legs", "hands", "feet", "back"]
const TOOL_TYPES := ["axe", "pickaxe", "knife", "spear", "bow", "torch", "ice_axe", "flare", "flaregun", "scanner",
	"canteen", "binoculars", "hammer", "lantern", "map"]
const STATIONS := ["hand", "campfire", "workbench", "fabricator"]
const RECIPE_CATS := ["tools", "weapons", "survival", "clothing", "medical", "food", "materials"]

const PLAYER_SRC := """extends Node3D
var inventory: Inventory = Inventory.new(24, 30.0)
var equipment: Dictionary = {&"head": &"", &"face": &"", &"body": &"", &"legs": &"", &"hands": &"", &"feet": &"", &"back": &""}
var hotbar: Array[StringName] = [&"", &"", &"", &"", &"", &""]
var active_slot := -1
var consumed: Array[StringName] = []
func get_active_item() -> StringName:
	return hotbar[active_slot] if active_slot >= 0 else &""
func select_hotbar(i: int) -> void:
	active_slot = i
"""

var _events := {}


func run() -> void:
	Game.flags.clear()
	Blueprints.reset()
	_connect_events()
	_test_data()
	_test_crafting()
	_test_blueprints()
	_test_craft_job()
	_test_actions()
	await _test_pickups()
	await _test_storage()
	await _test_campfire()
	_test_models()
	await _test_screen()
	Game.flags.clear()


func _connect_events() -> void:
	for sig in ["item_picked_up", "item_crafted", "blueprint_unlocked", "ui_screen_opened", "ui_screen_closed",
			"notification", "item_consumed", "equipment_changed"]:
		_events[sig] = 0
		var s: String = sig
		Events.connect(sig, func(_a: Variant = null, _b: Variant = null) -> void: _events[s] = int(_events[s]) + 1)


func _make_player() -> Node3D:
	var gs := GDScript.new()
	gs.source_code = PLAYER_SRC
	gs.reload()
	var p: Node3D = gs.new()
	add_child(p)
	return p


# ---------------------------------------------------------------------------------------------- data

func _test_data() -> void:
	check(ItemDB.all_items().size() >= 100, "items.json has %d items" % ItemDB.all_items().size())
	var missing := []
	for id in CANONICAL:
		if not ItemDB.has_item(StringName(id)):
			missing.append(id)
	check(missing.is_empty(), "all canonical ids present %s" % str(missing))
	var bad := []
	for id in ItemDB.all_items():
		var d := ItemDB.get_item(id)
		if String(d.get("name", "")) == "" or String(d.get("desc", "")).length() < 20:
			bad.append("%s:name/desc" % id)
		if not CATEGORIES.has(String(d.get("category", ""))):
			bad.append("%s:category" % id)
		if int(d.get("stack", 0)) < 1 or float(d.get("weight", 0.0)) <= 0.0 or float(d.get("weight", 0.0)) > 15.0:
			bad.append("%s:stack/weight" % id)
		if not SLOTS.has(String(d.get("equip_slot", "?"))):
			bad.append("%s:slot" % id)
		if String(d.get("icon", "")) != "res://assets/icons/%s.png" % id:
			bad.append("%s:icon" % id)
		var t: Variant = d.get("tool", null)
		if t is Dictionary:
			var td: Dictionary = t
			if not TOOL_TYPES.has(String(td.get("type", ""))):
				bad.append("%s:tool.type" % id)
			for k in ["damage", "chop", "mine", "range", "stamina", "cooldown", "durability"]:
				if not td.has(k) or float(td[k]) < 0.0:
					bad.append("%s:tool.%s" % [id, k])
		var c: Variant = d.get("clothing", null)
		if c is Dictionary:
			var cd: Dictionary = c
			if float(cd.get("insulation", -1)) < 0.0 or float(cd.get("insulation", 0)) > 25.0 \
					or float(cd.get("windproof", -1)) < 0.0 or float(cd.get("windproof", 0)) > 1.0 \
					or float(cd.get("waterproof", -1)) < 0.0 or float(cd.get("waterproof", 0)) > 1.0:
				bad.append("%s:clothing" % id)
			if String(d.get("equip_slot", "")) in ["", "hand"]:
				bad.append("%s:clothing slot" % id)
		var f: Variant = d.get("food", null)
		if f is Dictionary:
			var fd: Dictionary = f
			if float(fd.get("calories", 0)) < 0.0 or absf(float(fd.get("food", 0)) - float(fd.get("calories", 0)) / 25.0) > 0.11:
				bad.append("%s:food points" % id)
			if bool(fd.get("raw", false)) and float(fd.get("raw_risk", 0)) <= 0.0 and id != &"mushroom":
				bad.append("%s:raw risk" % id)
		var fu: Variant = d.get("fuel", null)
		if fu is Dictionary and float((fu as Dictionary).get("burn_minutes", 0)) <= 0.0:
			bad.append("%s:fuel" % id)
		var cont := String(d.get("container", ""))
		if cont != "" and not ItemDB.has_item(StringName(cont)):
			bad.append("%s:container" % id)
	check(bad.is_empty(), "item fields sane %s" % str(bad))
	# gear tags for the contract's gear items
	for pair in [["crampons", "crampons"], ["climbing_rope", "rope"], ["o2_mask", "o2_mask"], ["goggles", "goggles"], ["ice_axe", "ice_axe"]]:
		check((ItemDB.get_item(StringName(pair[0])).get("gear", []) as Array).has(pair[1]), "%s has gear tag %s" % pair)
	# recipes
	check(ItemDB.recipes.size() >= 40, "recipes.json has %d recipes" % ItemDB.recipes.size())
	var ids := {}
	var rbad := []
	for r in ItemDB.recipes:
		var rid := String(r.get("id", ""))
		if ids.has(rid):
			rbad.append("dup " + rid)
		ids[rid] = true
		if not ItemDB.has_item(StringName(r.get("result", ""))):
			rbad.append("%s:result" % rid)
		if int(r.get("count", 0)) < 1 or float(r.get("time", 0)) <= 0.0:
			rbad.append("%s:count/time" % rid)
		if not STATIONS.has(String(r.get("station", ""))):
			rbad.append("%s:station" % rid)
		if not RECIPE_CATS.has(String(r.get("category", ""))):
			rbad.append("%s:category" % rid)
		var ing: Dictionary = r.get("ingredients", {})
		if ing.is_empty():
			rbad.append("%s:no ingredients" % rid)
		for k in ing:
			if not ItemDB.has_item(StringName(k)) or int(ing[k]) < 1:
				rbad.append("%s:ingredient %s" % [rid, k])
		for t in r.get("tools", []):
			var ok := false
			for iid in ItemDB.all_items():
				if Crafting.tool_matches(iid, StringName(t)):
					ok = true
					break
			if not ok:
				rbad.append("%s:tool %s unsatisfiable" % [rid, t])
		if bool(r.get("requires_blueprint", false)):
			var u: Dictionary = r.get("unlock", {})
			if u.is_empty():
				rbad.append("%s:locked forever" % rid)
			for key in ["pickup", "read"]:
				for iid in u.get(key, []):
					if not ItemDB.has_item(StringName(iid)):
						rbad.append("%s:unlock %s %s" % [rid, key, iid])
	check(rbad.is_empty(), "recipes valid %s" % str(rbad))
	for st in STATIONS:
		check(not Crafting.recipes_for(StringName(st), false).is_empty(), "recipes exist for station %s" % st)
	# buildables
	check(ItemDB.all_buildables().size() >= 20, "buildables.json has %d entries" % ItemDB.all_buildables().size())
	var bbad := []
	for bid in ItemDB.all_buildables():
		var b := ItemDB.get_buildable(bid)
		if String(b.get("scene", "")) != "res://scenes/building/%s.tscn" % bid:
			bbad.append("%s:scene" % bid)
		if not ["grid", "free", "wall", "floor", "door", "roof"].has(String(b.get("snap", ""))):
			bbad.append("%s:snap" % bid)
		var cost: Dictionary = b.get("cost", {})
		if cost.is_empty():
			bbad.append("%s:free" % bid)
		for k in cost:
			if not ItemDB.has_item(StringName(k)):
				bbad.append("%s:cost %s" % [bid, k])
		if not ItemDB.get_recipe(bid).is_empty():
			bbad.append("%s:id clashes with a recipe" % bid)
	check(bbad.is_empty(), "buildables valid %s" % str(bbad))
	for b in ["campfire", "stone_fire_pit", "lean_to", "log_foundation", "log_floor", "log_wall", "log_window_wall",
			"log_doorway", "door", "log_roof", "log_stairs", "storage_box", "drying_rack", "workbench", "snow_melter",
			"bed", "torch_stand", "rope_ladder"]:
		check(not ItemDB.get_buildable(StringName(b)).is_empty(), "buildable %s" % b)
	# icons on disk for everything
	var no_icon := []
	for id in ItemDB.all_items() + ItemDB.all_buildables():
		if not ResourceLoader.exists("res://assets/icons/%s.png" % id):
			no_icon.append(id)
	check(no_icon.is_empty(), "icons exist for all items/buildables %s" % str(no_icon))
	check(ResourceLoader.exists("res://assets/icons/_unknown.png"), "fallback icon exists")
	check(ItemDB.get_icon(&"stick") != null and ItemDB.get_icon(&"no_such_item") != null, "get_icon resolves + falls back")


# ---------------------------------------------------------------------------------------------- crafting

func _test_crafting() -> void:
	var inv := Inventory.new(12, 40.0)
	var axe := ItemDB.get_recipe(&"stone_axe")
	var c := Crafting.can_craft(axe, inv)
	check(not bool(c["ok"]) and (c["missing"] as Dictionary).size() == 3, "stone axe: nothing in pack -> 3 missing")
	inv.add(&"stick", 2)
	inv.add(&"stone", 1)
	inv.add(&"fiber", 4)
	c = Crafting.can_craft(axe, inv)
	check(bool(c["ok"]), "stone axe craftable with stick+stone+fibre")
	var res := Crafting.craft(axe, inv)
	check(bool(res["ok"]) and inv.count(&"stone_axe") == 1 and inv.count(&"stick") == 1 and inv.count(&"fiber") == 0,
		"craft consumes ingredients, adds result")
	check(_events["item_crafted"] >= 1, "item_crafted emitted")
	# blueprint lock
	var sk := ItemDB.get_recipe(&"stone_knife")
	inv.add(&"flint", 1)
	inv.add(&"fiber", 2)
	c = Crafting.can_craft(sk, inv)
	check(bool(c["locked"]) and not bool(c["ok"]), "stone knife locked without blueprint")
	Blueprints.unlock(&"stone_knife", true)
	check(bool(Crafting.can_craft(sk, inv)["ok"]), "stone knife craftable once unlocked")
	Crafting.craft(sk, inv)
	# tool requirement matched by tool type (chert blade counts as a knife)
	check(Crafting.find_tool(inv, &"knife") >= 0, "stone_knife satisfies tool 'knife'")
	check(Crafting.tool_matches(&"canteen", &"boil_vessel") and Crafting.tool_matches(&"cooking_pot", &"boil_vessel"), "boil_vessel tag")
	# station gating
	var cook := ItemDB.get_recipe(&"meat_cooked")
	inv.add(&"meat_raw", 1)
	check(not bool(Crafting.can_craft(cook, inv, &"hand")["station_ok"]), "cooking needs a campfire")
	check(bool(Crafting.can_craft(cook, inv, &"campfire")["ok"]), "cooking works at a campfire")
	var boil := ItemDB.get_recipe(&"water_from_snow")
	inv.add(&"snow", 3)
	inv.add(&"bottle_empty", 1)
	var cb := Crafting.can_craft(boil, inv, &"campfire")
	check(not bool(cb["ok"]) and (cb["missing_tools"] as Array).has("boil_vessel"), "boiling needs a pot or canteen")
	inv.add(&"cooking_pot", 1)
	check(bool(Crafting.can_craft(boil, inv, &"campfire")["ok"]), "boiling with a pot")
	# tools wear
	var before := float(inv.get_slot(Crafting.find_tool(inv, &"boil_vessel")).get("durability", 1.0))
	Crafting.craft(boil, inv)
	check(inv.count(&"water_boiled") == 1 and inv.count(&"snow") == 0, "boiled water from snow")
	check(is_equal_approx(float(inv.get_slot(Crafting.find_tool(inv, &"boil_vessel")).get("durability", 1.0)), before), "cookware has no durability to wear")
	# recipes_for includes hand recipes
	var at_fire := Crafting.recipes_for(&"campfire")
	var has_hand := false
	var has_fire := false
	for r in at_fire:
		has_hand = has_hand or String(r["station"]) == "hand"
		has_fire = has_fire or String(r["station"]) == "campfire"
	check(has_hand and has_fire, "recipes_for(campfire) = campfire + hand recipes")


func _test_blueprints() -> void:
	Blueprints.reset()
	var n0: int = _events["blueprint_unlocked"]
	var got := Blueprints.unlock_for_pickup(&"flint")
	check(got.has(&"stone_knife"), "picking up flint teaches the stone knife")
	check(Blueprints.is_unlocked(&"stone_knife") and not Blueprints.unlock(&"stone_knife"), "unlock is idempotent")
	var read := Blueprints.unlock_for_read(&"survival_manual")
	check(read.size() >= 8 and read.has(&"splint") and read.has(&"drying_rack"), "reading the manual unlocks recipes and buildables (%d)" % read.size())
	check(int(_events["blueprint_unlocked"]) - n0 == got.size() + read.size(), "blueprint_unlocked emitted per unlock")
	var stored: Variant = Game.flags.get(Blueprints.FLAG)
	check(stored is Array and (stored as Array).has("stone_knife") and (stored as Array)[0] is String, "stored as JSON-safe Array of Strings")
	var rt: Variant = JSON.parse_string(JSON.stringify(Game.save_state()))
	check(rt is Dictionary and ((rt as Dictionary)["flags"] as Dictionary).has("blueprints"), "blueprints survive Game save_state JSON roundtrip")
	check(Blueprints.unlock_for_scan(&"owen_depot").has(&"crampons"), "scanning Owen's depot teaches crampons")
	check(Blueprints.unlock_for_flag(&"relay_inspected").has(&"battery_pack"), "flag unlock")
	check(Blueprints.unlock_for_craft(&"bow", &"bow").has(&"arrow"), "crafting a bow teaches arrows")
	check(Blueprints.all_unlocked().size() >= read.size() + 3, "all_unlocked lists them")
	check(Blueprints.display_name(&"torch_bark") == "Torch (birch bark)", "display name with variant")
	check(Blueprints.is_available(&"stone_axe") and Blueprints.is_available(&"campfire"), "no-blueprint entries always available")


func _test_craft_job() -> void:
	var inv := Inventory.new(12, 40.0)
	inv.add(&"cloth", 4)
	var r := ItemDB.get_recipe(&"bandage")
	var job := Crafting.begin(r, inv)
	check(job != null and inv.count(&"cloth") == 2, "timed craft reserves ingredients at start")
	check(not job.advance(1.0) and job.progress() > 0.2 and job.progress() < 0.3, "job advances")
	check(job.cancel() == 0 and inv.count(&"cloth") == 4 and inv.count(&"bandage") == 0, "cancel refunds")
	job = Crafting.begin(r, inv, &"hand", null, 0.5)
	check(is_equal_approx(job.duration, 2.0), "time scale applies")
	var done := false
	for i in 10:
		if job.advance(0.25):
			done = true
			break
	check(done and inv.count(&"bandage") == 1 and inv.count(&"cloth") == 2, "timed craft completes")
	check(Crafting.begin(ItemDB.get_recipe(&"stone_axe"), inv) == null, "begin returns null when not craftable")


# ---------------------------------------------------------------------------------------------- actions

func _test_actions() -> void:
	var p := _make_player()
	var inv: Inventory = p.get("inventory")
	inv.add(&"parka", 1)
	inv.add(&"field_jacket", 1)
	inv.add(&"backpack_torn", 1)
	inv.add(&"water_boiled", 1)
	inv.add(&"hatchet", 1)
	var eq: Dictionary = p.get("equipment")
	check(ItemActions.equip_slot(p, inv, inv.find(&"field_jacket")) and eq[&"body"] == &"field_jacket" and inv.count(&"field_jacket") == 0,
		"wear moves clothing out of the pack")
	check(ItemActions.equip_slot(p, inv, inv.find(&"parka")) and eq[&"body"] == &"parka" and inv.count(&"field_jacket") == 1,
		"wearing over an occupied slot swaps the old item back")
	check(ItemActions.equip_slot(p, inv, inv.find(&"backpack_torn")) and inv.size() == 28 and is_equal_approx(inv.max_weight, 36.0),
		"backpack raises carry capacity")
	var tot := ItemActions.clothing_totals(eq)
	check(float(tot["insulation"]) >= 11.0 and float(tot["windproof"]) > 0.3, "clothing totals")
	check(ItemActions.unequip(p, &"back") and inv.size() >= 24 and is_equal_approx(inv.max_weight, ItemActions.BASE_WEIGHT), "taking the pack off restores base capacity")
	check(ItemActions.use_slot(p, inv, inv.find(&"water_boiled")) and inv.count(&"water_boiled") == 0 and inv.count(&"bottle_empty") == 1,
		"drinking returns the empty bottle")
	check(int(_events["item_consumed"]) >= 1, "item_consumed emitted")
	check(ItemActions.use_slot(p, inv, inv.find(&"hatchet")) and (p.get("hotbar") as Array)[0] == &"hatchet" and int(p.get("active_slot")) == 0,
		"hold puts a tool on the hotbar and selects it")
	ItemActions.assign_hotbar(p, 3, &"hatchet")
	check((p.get("hotbar") as Array)[3] == &"hatchet" and (p.get("hotbar") as Array)[0] == &"", "hotbar assignment is unique")
	inv.add(&"matches", 3)
	check(ItemActions.find_igniter(inv) >= 0, "igniter found")
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var r := ItemActions.try_ignite(inv, 0.0, rng)
	check(inv.count(&"matches") == 2 and r.has("ok"), "a match is used up per attempt")
	var gear := ItemActions.gear_tags(p)
	inv.add(&"crampons", 1)
	check(not gear.has(&"crampons") and ItemActions.gear_tags(p).has(&"crampons"), "carried crampons count as gear")
	p.queue_free()


# ---------------------------------------------------------------------------------------------- world nodes

func _test_pickups() -> void:
	var root := (load("res://scenes/items/items_root.tscn") as PackedScene).instantiate() as ItemsRoot
	add_child(root)
	await get_tree().process_frame
	check(ItemsRoot.instance == root and root.get_save_key() == "items" and root.is_in_group(&"persistent"), "ItemsRoot registered as persistent 'items'")
	var inv := Inventory.new(8, 30.0)
	var n0: int = _events["item_picked_up"]
	var pk := root.spawn_pickup(&"stick", 3, Vector3(0, 1, 0))
	await get_tree().process_frame
	check(pk != null and pk.dynamic and pk.collision_layer == 8 and pk.is_in_group(&"interactable"), "spawned pickup on layer 4, interactable")
	check(pk.get_interact_prompt(null).contains("Stick ×3"), "prompt names the stack: %s" % pk.get_interact_prompt(null))
	check(pk.get_node_or_null(^"Visual") != null and pk.get_node_or_null(^"Shape") != null, "pickup built visual + collision")
	check(pk.take_into(inv) == 3 and inv.count(&"stick") == 3 and pk.is_queued_for_deletion(), "pickup -> inventory")
	check(int(_events["item_picked_up"]) == n0 + 1, "item_picked_up emitted")
	# partial pickup when the pack is full
	var small := Inventory.new(1, 30.0)
	small.add(&"stone", 8)
	var pk2 := ItemsRoot.spawn(&"stone", 5, Vector3(2, 1, 0))
	check(pk2.take_into(small) == 2 and pk2.count == 3 and not pk2.is_queued_for_deletion(), "partial pickup leaves the rest")
	# placed loot remembered by key
	var loot := (load("res://scenes/items/pickup.tscn") as PackedScene).instantiate() as ItemPickup
	loot.item_id = &"flare"
	loot.freeze = true
	loot.persist_id = "test_loot_flare"
	add_child(loot)
	await get_tree().process_frame
	loot.take_into(inv)
	check(ItemsRoot.is_key_collected("test_loot_flare"), "collected loot remembered")
	var data: Dictionary = JSON.parse_string(JSON.stringify(root.save_state()))
	check((data["collected"] as Array).has("test_loot_flare") and (data["dropped"] as Array).size() == 1, "save_state: collected + dropped")
	# load: dropped items respawn, collected loot stays gone
	root.load_state(data)
	await get_tree().process_frame
	var dyn := root.dynamic_pickups()
	check(dyn.size() == 1 and dyn[0].item_id == &"stone" and dyn[0].count == 3, "dropped pickups restored on load")
	var again := (load("res://scenes/items/pickup.tscn") as PackedScene).instantiate() as ItemPickup
	again.item_id = &"flare"
	again.freeze = true
	again.persist_id = "test_loot_flare"
	add_child(again)
	await get_tree().process_frame
	check(not is_instance_valid(again) or again.is_queued_for_deletion(), "collected loot doesn't respawn after load")
	# every item can be a pickup
	var fails := []
	for id in ItemDB.all_items():
		var p := ItemsRoot.spawn(id, 1, Vector3(0, -50, 0))
		if p == null or p.get_node_or_null(^"Visual") == null:
			fails.append(id)
		elif p:
			p.queue_free()
	check(fails.is_empty(), "every item builds a pickup visual %s" % str(fails))
	await get_tree().process_frame
	root.queue_free()
	await get_tree().process_frame


func _test_storage() -> void:
	var root := (load("res://scenes/items/items_root.tscn") as PackedScene).instantiate() as ItemsRoot
	add_child(root)
	var box := (load("res://scenes/items/storage_box.tscn") as PackedScene).instantiate() as StorageContainer
	box.persist_id = "test_box"
	box.loot = {"rope": 2}
	add_child(box)
	await get_tree().process_frame
	check(box.inventory != null and box.inventory.count(&"rope") == 2, "storage starts with its loot")
	check(box.get_node_or_null(^"Model") != null and box.is_in_group(&"interactable"), "storage box model + interactable")
	box.inventory.add(&"meat_dried", 4)
	var saved: Dictionary = JSON.parse_string(JSON.stringify(root.save_state()))
	check((saved["nodes"] as Dictionary).has("test_box"), "storage contents saved via ItemsRoot")
	box.queue_free()
	await get_tree().process_frame
	# a new world: the box is created AFTER the save is applied (pending path)
	root.load_state(saved)
	var box2 := (load("res://scenes/items/storage_box.tscn") as PackedScene).instantiate() as StorageContainer
	box2.persist_id = "test_box"
	box2.loot = {"rope": 2}
	add_child(box2)
	await get_tree().process_frame
	check(box2.inventory.count(&"meat_dried") == 4 and box2.inventory.count(&"rope") == 2, "storage restored when registered after load")
	# and the other order: loaded after it registered
	box2.inventory.clear()
	root.load_state(saved)
	check(box2.inventory.count(&"meat_dried") == 4, "storage restored when already registered")
	box2.queue_free()
	root.queue_free()
	await get_tree().process_frame


func _test_campfire() -> void:
	var root := (load("res://scenes/items/items_root.tscn") as PackedScene).instantiate() as ItemsRoot
	add_child(root)
	var fire := (load("res://scenes/items/campfire.tscn") as PackedScene).instantiate() as Campfire
	fire.persist_id = "test_fire"
	fire.always_simulate = true
	add_child(fire)
	await get_tree().process_frame
	check(fire.is_in_group(&"heat_source") and fire.is_in_group(&"crafting_station") and fire.is_in_group(&"fire"), "campfire groups")
	check(fire.station_id == &"campfire" and fire.state == Campfire.FireState.UNLIT and not fire.is_heat_active(), "starts cold")
	check(fire.get_node_or_null(^"Model") != null and fire.get_node_or_null(^"Flames") != null and fire.get_node_or_null(^"Light") != null, "campfire model + FX built")
	var inv := Inventory.new(12, 40.0)
	inv.add(&"log", 1)
	check(not fire.try_light(inv)["ok"], "can't light an empty pit")
	check(fire.add_fuel(&"log", inv) and not fire.has_kindling, "a log alone is not kindling")
	inv.add(&"lighter", 1)
	check(not bool(fire.try_light(inv)["ok"]), "logs won't catch without kindling")
	inv.add(&"stick", 3)
	check(fire.add_fuel(&"stick", inv) and fire.has_kindling and is_equal_approx(fire.fuel_minutes, 98.0), "sticks add kindling and fuel")
	var lit := false
	for i in 12:
		if bool(fire.try_light(inv)["ok"]):
			lit = true
			break
	check(lit and fire.state == Campfire.FireState.BURNING, "lighter lights the fire")
	for i in 30:
		fire._process(0.5)
	check(fire.is_heat_active() and fire.heat_celsius > 10.0 and fire.is_station_active(), "burning fire is hot and a station (%.1f °C)" % fire.heat_celsius)
	check(fire.get_station_status().begins_with("Burning"), "status: %s" % fire.get_station_status())
	var st: Dictionary = JSON.parse_string(JSON.stringify(fire.save_state()))
	fire._burn(200.0)
	check(fire.state == Campfire.FireState.EMBERS and fire.fuel_minutes == 0.0, "burns down to embers")
	check(fire.is_heat_active() and fire.is_station_active(), "fresh embers still heat and cook")
	check(fire.add_fuel(&"stick", inv) and fire.state == Campfire.FireState.BURNING, "fuel rekindles embers")
	fire._burn(20.0)
	fire._burn(60.0)
	check(fire.state == Campfire.FireState.OUT and not fire.is_heat_active() and not fire.is_station_active(), "embers die out")
	fire.load_state(st)
	check(fire.state == Campfire.FireState.BURNING and fire.fuel_minutes > 80.0, "state restored from save")
	var saved: Dictionary = root.save_state()
	check((saved["nodes"] as Dictionary).has("test_fire"), "campfire state saved via ItemsRoot")
	fire.queue_free()
	root.queue_free()
	await get_tree().process_frame


# ---------------------------------------------------------------------------------------------- models

func _test_models() -> void:
	var defs := ItemMaterials.definitions()
	var bad := []
	var big := []
	for id in ItemDB.all_items() + ItemDB.all_buildables():
		var b := ItemMeshBuilder.new(1.0)
		if not ItemVisuals.populate(b, id, String(ItemDB.get_item(id).get("category", ""))):
			bad.append("%s:nothing" % id)
			continue
		for k in b.parts:
			if not defs.has(String(k)):
				bad.append("%s:material %s" % [id, k])
		var box := b.aabb()
		if ItemDB.has_item(id) and box.get_longest_axis_size() > 2.2:
			big.append("%s %.2f" % [id, box.get_longest_axis_size()])
		if b.triangle_count() == 0:
			bad.append("%s:empty" % id)
	check(bad.is_empty(), "every model builds with known materials %s" % str(bad))
	check(big.is_empty(), "item models are hand-sized %s" % str(big))
	var mesh := ItemVisuals.get_mesh(&"stick")
	check(mesh != null and mesh == ItemVisuals.get_mesh(&"stick"), "meshes are cached")
	check(mesh.get_aabb().size.x > 0.6 and mesh.get_aabb().size.x < 0.8 and mesh.get_aabb().position.y > -0.001, "stick ~0.7 m long, resting on y=0")
	var mat := ItemMaterials.get_material(&"bark")
	check(mat is ORMMaterial3D and (mat as BaseMaterial3D).albedo_texture != null and (mat as BaseMaterial3D).normal_enabled, "bark material textured")
	check(ItemMaterials.definition(&"granite_dark").has("albedo"), "material inheritance")


# ---------------------------------------------------------------------------------------------- UI

func _test_screen() -> void:
	var p := _make_player()
	var inv: Inventory = p.get("inventory")
	inv.add(&"stick", 12)
	inv.add(&"stone", 3)
	inv.add(&"fiber", 10)
	inv.add(&"hatchet", 1)
	inv.add(&"parka", 1)
	inv.add(&"meat_raw", 2)
	var prev_player := Game.player
	var prev_state := Game.state
	Game.player = p
	Game.state = Game.State.PLAYING
	var stale := InventoryScreen.get_instance()
	if stale:
		stale.free()
	var screen := (load("res://scenes/ui/inventory_screen.tscn") as PackedScene).instantiate() as InventoryScreen
	add_child(screen)
	await get_tree().process_frame
	check(InventoryScreen.get_instance() == screen and screen.process_mode == Node.PROCESS_MODE_ALWAYS, "screen singleton, always processing")
	var opened: int = _events["ui_screen_opened"]
	screen.open()
	await get_tree().process_frame
	check(screen.is_open and int(_events["ui_screen_opened"]) == opened + 1, "open emits ui_screen_opened")
	check(screen._pack_slots.size() == inv.size(), "pack grid mirrors inventory size")
	screen._select_slot(screen._pack_slots[inv.find(&"hatchet")])
	await get_tree().process_frame
	check((screen._detail["name"] as Label).text == "Hatchet", "detail pane shows the selected item")
	screen._set_tab(InventoryScreen.Tab.EQUIPMENT)
	await get_tree().process_frame
	screen._set_tab(InventoryScreen.Tab.CRAFTING)
	await get_tree().process_frame
	check(screen._recipe_rows.size() > 10, "crafting list populated")
	var fire := (load("res://scenes/items/campfire.tscn") as PackedScene).instantiate() as Campfire
	fire.start_fuel_minutes = 60.0
	fire.start_lit = true
	fire.always_simulate = true
	add_child(fire)
	await get_tree().process_frame
	screen.open_station(&"campfire", fire)
	await get_tree().process_frame
	await get_tree().process_frame
	check(screen.tab == InventoryScreen.Tab.CRAFTING and screen._station_card.visible, "open_station shows the station card")
	var shows_cooking := false
	for row in screen._recipe_rows:
		if row.visible and String((row as InventoryScreen.RecipeRow).recipe.get("id", "")) == "meat_cooked":
			shows_cooking = true
	check(shows_cooking, "campfire recipes listed at the fire")
	screen.select_recipe(ItemDB.get_recipe(&"meat_cooked"))
	screen._on_craft_pressed()
	check(screen.craft_job != null and inv.count(&"meat_raw") == 1, "craft button starts a timed job")
	for i in 40:
		screen._process(0.5)
	check(inv.count(&"meat_cooked") == 1, "timed campfire craft completes")
	var closed: int = _events["ui_screen_closed"]
	screen.close()
	check(not screen.is_open and int(_events["ui_screen_closed"]) == closed + 1, "close emits ui_screen_closed")
	Game.player = prev_player
	Game.state = prev_state
	screen.queue_free()
	fire.queue_free()
	p.queue_free()
	await get_tree().process_frame

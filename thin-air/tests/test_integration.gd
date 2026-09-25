extends TestCase
## Cross-stream integration: the merged world (flat fallback terrain until the terrain stream lands) with the
## sky, items root, inventory screen and the real Player, driven through the core survival loop:
## gather → craft a stone axe → lay, light and use a campfire → warmth rises → cook + eat → inventory screen
## (input blocked while open, equipment tab round-trips the player's extra slots) → Save.save_game(0) →
## mutate → Save.load_game(0) → everything restored. Also static schema checks between the streams: every
## SFX id the code plays exists in data/sfx.json, music states/stingers have cues, heat sources implement the
## Climate interface, and every items.json field the player/vitals read has the expected shape.

const SLOT := 0

var world: Node3D = null
var player: Player = null
var _backup := ""
var _had_backup := false


func run() -> void:
	_schema_checks()
	_audio_ids()
	_backup_save()
	await _spawn_world()
	if player == null:
		_restore_save()
		return
	await _gather_and_craft()
	var fire := await _campfire()
	await _cook_and_eat(fire)
	await _inventory_screen()
	await _pickups_and_storage()
	await _save_load(fire)
	await _teardown()
	_restore_save()


# =============================================================================================== static checks

func _schema_checks() -> void:
	var bad: Array[String] = []
	for id in ItemDB.all_items():
		var d := ItemDB.get_item(id)
		var f: Variant = d.get("food", null)
		if f is Dictionary:
			for k in ["calories", "food", "water", "warmth", "health", "stamina", "raw_risk"]:
				if (f as Dictionary).has(k) and not ((f as Dictionary)[k] is float or (f as Dictionary)[k] is int):
					bad.append("%s.food.%s" % [id, k])
		var m: Variant = d.get("medical", null)
		if m is Dictionary:
			if not ((m as Dictionary).get("stops", []) is Array):
				bad.append("%s.medical.stops" % id)
			if (m as Dictionary).has("effect") and not (m as Dictionary).has("duration_minutes"):
				bad.append("%s.medical.duration_minutes" % id)
		var l: Variant = d.get("light", null)
		if l is Dictionary:
			for k in ["radius", "energy", "burn_minutes", "heat_celsius"]:
				if not (l as Dictionary).has(k):
					bad.append("%s.light.%s" % [id, k])
			if not Color.html_is_valid(String((l as Dictionary).get("color", ""))):
				bad.append("%s.light.color" % id)
		var c: Variant = d.get("clothing", null)
		if c is Dictionary:
			for k in ["insulation", "windproof", "waterproof"]:
				if not (c as Dictionary).has(k):
					bad.append("%s.clothing.%s" % [id, k])
		var carry: Variant = d.get("carry", null)
		if carry is Dictionary and not ((carry as Dictionary).has("slots") and (carry as Dictionary).has("weight")):
			bad.append("%s.carry" % id)
		# Every wearable resolves to a slot the Player has.
		var ws := ItemInfo.wear_slot(id)
		if ws != &"" and ws != &"hand" and not Player.EQUIP_SLOTS.has(ws):
			bad.append("%s → unknown slot %s" % [id, ws])
	check(bad.is_empty(), "items.json fields the player/vitals/tools read are well-formed %s" % str(bad))
	# The inventory UI shows every slot the Player can fill.
	var ui_slots: Array[StringName] = []
	for e in InventoryScreen.EQUIP_LAYOUT:
		ui_slots.append(e[0])
	var missing: Array[StringName] = []
	for s in Player.EQUIP_SLOTS:
		if not ui_slots.has(s):
			missing.append(s)
	check(missing.is_empty(), "equipment page has a slot for every Player equipment slot %s" % str(missing))
	check(ItemInfo.wear_slot(&"crampons") == &"feet_addon" and ItemInfo.wear_slot(&"o2_mask") == &"mask"
		and ItemInfo.wear_slot(&"goggles") == &"face", "crampons → feet_addon, O2 mask → mask, goggles → face")
	# Music: every state the director knows (bar silence) and every stinger has a cue in data/music.json.
	var md: Node = Audio.music
	var no_cue: Array[StringName] = []
	for s in md.STATES:
		if s != &"silence" and not md.has_cues_for(s):
			no_cue.append(s)
	for st in md.STINGERS:
		if (md.stingers.get(st, []) as Array).is_empty():
			no_cue.append(StringName("stinger_" + String(st)))
	check(no_cue.is_empty(), "every music state and stinger has a cue in music.json %s" % str(no_cue))


## Every literal id passed to Audio.play_sfx/play_loop/play_sfx_attached/play_ui in src/ exists in sfx.json,
## plus the footstep ids for every surface TerrainData / meshes report.
func _audio_ids() -> void:
	var re := RegEx.create_from_string("Audio\\.(?:play_sfx|play_loop|play_sfx_attached|play_ui|start_loop_with_intro)\\(\\s*&\"([a-z0-9_]+)\"")
	var tern := RegEx.create_from_string("Audio\\.play_(?:sfx|ui)\\(\\s*&\"[a-z0-9_]+\" if [^,]*? else &\"([a-z0-9_]+)\"")
	var missing: Array[String] = []
	var n := 0
	for path in _gd_files("res://src"):
		var src := FileAccess.get_file_as_string(path)
		for rx in [re, tern]:
			for m in (rx as RegEx).search_all(src):
				n += 1
				var id := m.get_string(1)
				if not Audio.has_sfx(StringName(id)) and not missing.has(id):
					missing.append("%s (%s)" % [id, path.get_file()])
	for surf in ["snow", "rock", "scree", "grass", "forest", "dirt", "ice", "gravel", "wood", "metal", "water"]:
		if not Audio.has_sfx(StringName("step_" + surf)):
			missing.append("step_" + surf)
	for sid in [&"wood_creak", &"axe_swing", &"spear_throw", &"crampon_step", &"torch_loop", &"fire_loop", &"flare_loop"]:
		if not Audio.has_sfx(sid):
			missing.append(String(sid))
	check(n > 50 and missing.is_empty(), "all %d literal SFX ids in src/ exist in sfx.json %s" % [n, str(missing)])


func _gd_files(dir: String) -> PackedStringArray:
	var out := PackedStringArray()
	var da := DirAccess.open(dir)
	if da == null:
		return out
	for f in da.get_files():
		if f.ends_with(".gd"):
			out.append(dir.path_join(f))
	for d in da.get_directories():
		out.append_array(_gd_files(dir.path_join(d)))
	return out


# =============================================================================================== world

func _backup_save() -> void:
	var p := "user://save_%d.json" % SLOT
	_had_backup = FileAccess.file_exists(p)
	if _had_backup:
		_backup = FileAccess.get_file_as_string(p)


func _restore_save() -> void:
	var p := "user://save_%d.json" % SLOT
	if _had_backup:
		var f := FileAccess.open(p, FileAccess.WRITE)
		f.store_string(_backup)
		f.close()
	else:
		Save.delete_save(SLOT)


func _spawn_world() -> void:
	var W: GDScript = load("res://src/world/world.gd")
	W.set(&"dev_no_player", false)
	Game.is_new_game = false          # no prologue voice-over in the test
	Game.flags.clear()
	Climate.locked = true
	Climate.hours = 21.0              # night: cold, and the fire matters
	Climate.set_weather(&"clear", 0.0)
	world = (load("res://scenes/world/world.tscn") as PackedScene).instantiate() as Node3D
	add_child(world)
	for _i in 6:
		await get_tree().physics_frame
	player = Game.player as Player
	check(Game.world == world and Game.state == Game.State.PLAYING, "world registered and the game is PLAYING")
	check(player != null and player.get_parent() == world, "world spawned the real Player (%s)" % str(player))
	check(world.get_node_or_null("Sky") != null and get_tree().get_first_node_in_group(&"sun") is DirectionalLight3D,
		"sky scene with the Sun light")
	check(ItemsRoot.instance != null and ItemsRoot.instance.get_parent() == world, "items root in the world")
	check(InventoryScreen.get_instance() != null, "inventory screen created by the items root")
	if player == null:
		return
	check(player.is_on_floor() or player.global_position.y > 1449.0, "player stands on the fallback ground (y %.2f)" % player.global_position.y)
	player.vitals.reset()
	player.inventory.clear()
	player.hotbar.fill(&"")
	player.select_hotbar(-1)


# =============================================================================================== core loop

func _gather_and_craft() -> void:
	var inv := player.inventory
	# Gathering: pickups in the world go into the pack; a picked-up tool lands on the hotbar.
	var p1 := ItemsRoot.instance.spawn_pickup(&"stick", 6, player.global_position + Vector3(0.6, 0.3, -0.6))
	var p2 := ItemsRoot.instance.spawn_pickup(&"stone", 8, player.global_position + Vector3(-0.6, 0.3, -0.6))
	await get_tree().physics_frame
	p1.interact(player)
	p2.interact(player)
	inv.add(&"fiber", 6)
	check(inv.count(&"stick") == 6 and inv.count(&"stone") == 8, "picked up sticks and stones")
	var recipe := ItemDB.get_recipe(&"stone_axe")
	var chk := Crafting.can_craft(recipe, inv, &"hand", player)
	check(bool(chk["ok"]), "stone axe craftable by hand (%s)" % String(chk["reason"]))
	var res := Crafting.craft(recipe, inv)
	await get_tree().process_frame
	check(bool(res["ok"]) and inv.count(&"stone_axe") == 1, "crafted a stone axe")
	check(player.hotbar.has(&"stone_axe"), "crafted tool goes onto the hotbar")
	player.select_hotbar(player.hotbar.find(&"stone_axe"))
	check(player.get_active_item() == &"stone_axe", "stone axe in hand")
	check(not player.hotbar.has(&"stick") and not player.hotbar.has(&"stone"), "materials stay off the hotbar")


func _campfire() -> Campfire:
	var inv := player.inventory
	player.teleport(Vector3(0.0, TerrainData.get_height(0.0, 0.0) + 0.05, 0.0), 0.0)
	var fire := (load("res://scenes/items/campfire.tscn") as PackedScene).instantiate() as Campfire
	fire.position = Vector3(0.0, TerrainData.get_height(0.0, -1.6), -1.6)     # in front (north, −Z)
	ItemsRoot.instance.add_child(fire)
	await get_tree().process_frame
	Climate.refresh_sources()
	check(fire.is_in_group(&"heat_source") and fire.get("heat_radius") != null and fire.has_method(&"is_heat_active"),
		"campfire implements the Climate heat_source interface")
	# Lay kindling (interact takes the best kindling from the pack), then light it with matches.
	fire.interact(player)
	fire.interact(player)
	check(fire.fuel_minutes > 0.0 and fire.has_kindling, "sticks laid in the fire pit (%.0f min of fuel)" % fire.fuel_minutes)
	check(fire.get_interact_prompt(player).begins_with("Light fire"), "prompt offers to light it (%s)" % fire.get_interact_prompt(player))
	inv.add(&"matches", 10)
	for _i in 10:
		if fire.is_burning():
			break
		fire.interact(player)
	check(fire.is_burning(), "fire lit with matches (%d left)" % inv.count(&"matches"))
	# Warmth: cold body next to the fire warms up; Climate heat reaches the player's core.
	player.vitals.warmth = 40.0
	var w0 := player.vitals.warmth
	await _wait(2.5)
	var heat := Climate.get_heat_at(player.global_position + Vector3(0.0, Player.CORE_HEIGHT, 0.0))
	check(heat > 5.0 and player.vitals.env_heat > 5.0, "fire heat reaches the player (%.1f °C)" % heat)
	check(player.vitals.warmth > w0 + 0.5, "warmth rises by the fire (%.1f → %.1f)" % [w0, player.vitals.warmth])
	# Away from the fire it's cold.
	var far := Climate.get_heat_at(Vector3(30.0, 1451.0, 30.0))
	check(far == 0.0, "no fire heat 30 m away")
	# Eye adaptation: beside the fire the eye adapts to its light (the sky's night gain would otherwise
	# multiply the fire ~2.5× past how the items stream tuned it); away from it, full night adaptation.
	var sky := get_tree().get_first_node_in_group(&"sky")
	if sky and sky.has_method(&"get_local_light_key"):
		sky.call(&"snap")
		var near_eye := float(sky.call(&"get_eye_adaptation"))
		var near_exp := float(sky.call(&"get_exposure"))
		var near_key := float(sky.call(&"get_local_light_key"))
		var p0 := player.global_position
		player.teleport(Vector3(60.0, TerrainData.get_height(60.0, 60.0) + 0.05, 60.0), 0.0)
		await get_tree().process_frame
		sky.call(&"snap")
		var far_eye := float(sky.call(&"get_eye_adaptation"))
		var far_exp := float(sky.call(&"get_exposure"))
		player.teleport(p0, 0.0)
		await get_tree().process_frame
		sky.call(&"snap")
		check(near_key > 0.5 and near_eye < far_eye * 0.5 and near_exp < far_exp,
			"eye adapts to the firelight (key %.2f: eye %.2f / exposure %.2f by the fire, %.2f / %.2f 60 m away)"
			% [near_key, near_eye, near_exp, far_eye, far_exp])
	# A held torch is a heat source too and lights from the campfire without an igniter.
	inv.add(&"torch", 1)
	player.equip(&"torch")
	await _wait(0.8)
	var vm := player.viewmodel as Viewmodel
	var torch: HeldItem = vm.get_current() if vm else null
	check(torch != null and torch.item_id == &"torch" and torch.is_in_group(&"heat_source") and torch.call(&"is_heat_active"),
		"lit torch in hand is a heat source")
	if torch:
		var ld: Dictionary = ItemDB.get_item(&"torch").get("light", {})
		check(is_equal_approx(float(torch.get(&"heat_celsius")), float(ld.get("heat_celsius", -1.0))),
			"torch warmth from items.json light.heat_celsius")
		var light := torch.find_child("Light", true, false) as OmniLight3D
		check(light != null and is_equal_approx(light.omni_range, float(ld.get("radius", -1.0))), "torch light radius from items.json")
		torch.set(&"lit", false)
		torch.call(&"_set_lit", false)
		var m0 := inv.count(&"matches")
		check(bool(torch.call(&"relight")) and inv.count(&"matches") == m0, "doused torch relights from the campfire without a match")
		# items.json tool.durability 1 = doesn't wear: a swing that connects must not burn the torch up.
		var d0 := float(inv.get_slot(inv.find(&"torch")).get("durability", 1.0))
		check(not torch.wear(1.0) and inv.count(&"torch") == 1
			and is_equal_approx(float(inv.get_slot(inv.find(&"torch")).get("durability", 1.0)), d0),
			"hitting something with a torch doesn't use it up")
	player.select_hotbar(-1)
	return fire


func _cook_and_eat(fire: Campfire) -> void:
	var inv := player.inventory
	inv.add(&"meat_raw", 1)
	var stations := Crafting.available_stations(player)
	check(stations.has(&"campfire"), "burning campfire is an available crafting station %s" % str(stations))
	var recipe := ItemDB.get_recipe(&"meat_cooked")
	var chk := Crafting.can_craft(recipe, inv, &"hand", player)
	check(bool(chk["ok"]), "raw meat can be cooked here (%s)" % String(chk["reason"]))
	Crafting.craft(recipe, inv)
	check(inv.count(&"meat_cooked") == 1 and inv.count(&"meat_raw") == 0, "meat cooked on the fire")
	var v := player.vitals
	v.auto_simulate = false
	v.food = 40.0
	v.warmth = 60.0
	var f: Dictionary = ItemDB.get_item(&"meat_cooked").get("food", {})
	check(ItemActions.use_slot(player, inv, inv.find(&"meat_cooked")), "eat from the inventory")
	check(is_equal_approx(v.food, 40.0 + float(f.get("food", 0.0))), "food +%s (%.1f)" % [str(f.get("food")), v.food])
	check(v.warmth > 60.0 and v.has_effect(&"warmed_up"), "hot meal warms (%.1f)" % v.warmth)
	check(inv.count(&"meat_cooked") == 0, "meal used up")
	# Drinks give their bottle back; the held-item (hotbar) path too.
	inv.add(&"pine_tea", 1)
	check(ItemActions.use_slot(player, inv, inv.find(&"pine_tea")) and inv.count(&"bottle_empty") == 1, "tea drunk, bottle returned")
	v.auto_simulate = true


func _inventory_screen() -> void:
	var screen := InventoryScreen.get_instance()
	if screen == null:
		return
	check(player.is_input_enabled(), "input enabled before opening the inventory")
	screen.open(InventoryScreen.Tab.EQUIPMENT)
	await get_tree().process_frame
	check(screen.is_open and not player.is_input_enabled(), "inventory open: player input disabled")
	# Equipment tab: wear crampons and an O2 mask through the UI actions, see them in their slots, take off.
	var inv := player.inventory
	inv.add(&"crampons", 1)
	inv.add(&"o2_mask", 1)
	inv.add(&"goggles", 1)
	inv.add(&"parka", 1)
	await get_tree().process_frame
	var cs: ItemSlot = screen._equip_slots.get(&"feet_addon")
	check(cs != null and cs.accepts(&"crampons") and not (screen._equip_slots[&"feet"] as ItemSlot).accepts(&"crampons"),
		"crampons slot accepts crampons (and the boots slot doesn't)")
	check(ItemActions.use_slot(player, inv, inv.find(&"crampons")) and player.has_crampons() and inv.count(&"crampons") == 0,
		"Wear crampons from the pack → strapped on")
	check(ItemActions.use_slot(player, inv, inv.find(&"o2_mask")) and ItemActions.use_slot(player, inv, inv.find(&"goggles"))
		and player.equipment[&"mask"] == &"o2_mask" and player.equipment[&"face"] == &"goggles", "O2 mask and goggles worn together")
	check(ItemActions.use_slot(player, inv, inv.find(&"parka")) and player.equipment[&"body"] == &"parka", "parka worn")
	screen._refresh_equipment()
	check((screen._equip_slots[&"feet_addon"] as ItemSlot).item_id() == &"crampons"
		and (screen._equip_slots[&"mask"] as ItemSlot).item_id() == &"o2_mask", "equipment page shows crampons and O2 mask")
	check(is_equal_approx(player.get_insulation(), float(ItemActions.clothing_totals(player.equipment)["insulation"])),
		"page's protection summary matches the player's insulation (%.1f)" % player.get_insulation())
	screen._activate_slot(screen._equip_slots[&"feet_addon"])
	check(not player.has_crampons() and inv.count(&"crampons") == 1, "taking crampons off from the equipment page")
	screen._activate_slot(screen._equip_slots[&"mask"])
	check(player.equipment[&"mask"] == &"" and inv.count(&"o2_mask") == 1 and player.equipment[&"face"] == &"goggles",
		"O2 mask off, goggles stay on")
	screen.close()
	await get_tree().process_frame
	check(not screen.is_open and player.is_input_enabled(), "inventory closed: input back")


func _pickups_and_storage() -> void:
	var inv := player.inventory
	# A dropped tool is a saved world pickup; picking it back up re-assigns the hotbar.
	inv.add(&"knife", 1)
	player.equip(&"knife")
	var hb := player.hotbar.find(&"knife")
	player.drop_active_item()
	await get_tree().physics_frame
	check(inv.count(&"knife") == 0 and not player.hotbar.has(&"knife"), "dropped knife leaves pack and hotbar")
	var dropped: ItemPickup = null
	for p in ItemsRoot.instance.dynamic_pickups():
		if p.item_id == &"knife":
			dropped = p
	check(dropped != null, "dropped knife is a dynamic ItemsRoot pickup (saved with the world)")
	if dropped:
		dropped.interact(player)
		await get_tree().process_frame
		await get_tree().process_frame
		check(inv.count(&"knife") == 1 and player.hotbar.has(&"knife"), "picked back up → hotbar (slot %d)" % hb)
	# Storage: transfer into a box, persists through ItemsRoot.
	var box := (load("res://scenes/items/storage_box.tscn") as PackedScene).instantiate() as StorageContainer
	box.position = Vector3(2.0, 1450.0, 0.0)
	box.persist_id = "test_box"
	ItemsRoot.instance.add_child(box)
	await get_tree().process_frame
	inv.add(&"rope", 3)
	check(inv.transfer(inv.find(&"rope"), box.inventory) == 3 and box.inventory.count(&"rope") == 3, "stored rope in a box")


func _save_load(fire: Campfire) -> void:
	var inv := player.inventory
	var v := player.vitals
	v.auto_simulate = false
	player.teleport(Vector3(1.0, 1450.05, 0.5), 30.0)
	await get_tree().physics_frame
	v.food = 61.0
	v.water = 52.0
	v.warmth = 77.0
	v.health = 88.0
	inv.add(&"canteen", 1)
	# Canteen water uses Vitals' unit: capacity_l × 1000 / ml_per_water_point (1 L = 40 points).
	var cw := float(preload("res://src/player/tools/consumable.gd").full_water_points(ItemDB.get_item(&"canteen")))
	var cap := float(ItemDB.get_item(&"canteen").get("capacity_l", 1.0))
	check(is_equal_approx(cw, cap * 1000.0 / float(Vitals.TUNING[&"ml_per_water_point"])),
		"a full canteen holds %.0f water points (%.1f L)" % [cw, cap])
	# Crampons strapped on through the save (extra equipment slot round-trip).
	if inv.count(&"crampons") > 0:
		player.equip(&"crampons")
	check(player.equipment[&"feet_addon"] == &"crampons", "crampons worn for the save")
	var ci := inv.find(&"canteen")
	var cst := inv.get_slot(ci).duplicate()
	cst["durability"] = 0.5
	cst["unsafe"] = true
	inv.set_slot(ci, cst)
	var pos := player.global_position
	var inv_before := JSON.stringify(inv.to_dict())
	var hot_before := player.hotbar.duplicate()
	var fuel_before := fire.fuel_minutes
	var box := ItemsRoot.instance._registered.get("test_box") as StorageContainer
	check(Save.save_game(SLOT) and Save.has_save(SLOT), "Save.save_game(0)")
	# Mutate everything.
	player.teleport(Vector3(40.0, 1452.0, -25.0), 180.0)
	v.food = 3.0
	v.health = 20.0
	inv.clear()
	player.unequip(&"body")
	player.unequip(&"feet_addon")
	inv.clear()
	fire.extinguish()
	fire.fuel_minutes = 0.0
	if box:
		box.inventory.clear()
	ItemsRoot.spawn(&"stone", 1, Vector3(3.0, 1451.0, 3.0))
	await get_tree().physics_frame
	check(Save.load_game(SLOT), "Save.load_game(0)")
	await get_tree().physics_frame
	await get_tree().physics_frame
	check(player.global_position.distance_to(pos) < 0.15, "position restored (%s)" % str(player.global_position))
	check(is_equal_approx(v.food, 61.0) and is_equal_approx(v.water, 52.0) and is_equal_approx(v.health, 88.0)
		and is_equal_approx(v.warmth, 77.0), "vitals restored")
	check(JSON.stringify(inv.to_dict()) == inv_before, "inventory restored exactly")
	var cs2 := inv.get_slot(inv.find(&"canteen"))
	check(is_equal_approx(float(cs2.get("durability", 0.0)), 0.5) and bool(cs2.get("unsafe", false)),
		"canteen fill and untreated-water flag survive saving")
	check(player.hotbar == hot_before, "hotbar restored")
	check(player.equipment[&"body"] == &"parka" and player.equipment[&"face"] == &"goggles", "worn clothing restored")
	check(player.equipment[&"feet_addon"] == &"crampons" and player.has_crampons() and player.has_gear(&"crampons"),
		"crampons (feet_addon) restored and active")
	check(fire.is_burning() and absf(fire.fuel_minutes - fuel_before) < 2.0, "campfire burning with its fuel (%.1f / %.1f min)" % [fire.fuel_minutes, fuel_before])
	check(box != null and box.inventory.count(&"rope") == 3, "storage box contents restored")
	var stones := 0
	for p in ItemsRoot.instance.dynamic_pickups():
		if p.item_id == &"stone":
			stones += 1
	check(stones == 0, "pickups dropped after the save are gone after loading")
	v.auto_simulate = true


func _teardown() -> void:
	world.queue_free()
	await get_tree().process_frame
	await get_tree().process_frame
	Game.world = null
	Game.player = null
	Game.state = Game.State.MENU
	Climate.locked = false


func _wait(seconds: float) -> void:
	var t := 0.0
	while t < seconds:
		await get_tree().physics_frame
		t += 1.0 / float(Engine.physics_ticks_per_second)

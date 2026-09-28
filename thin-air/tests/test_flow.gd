extends TestCase
## The game shell and the first hour, driven like a player through the real scenes: main menu → New game →
## loading → prologue (hold to skip) → wake at the wreck → Act 1 in the real world (pick up sticks/stones near
## the wreck, the salvage at its sockets, read the manual, build + light the campfire through build mode, the
## cockpit radio) → pause menu save → quit to menu → Continue (state restored) → death → death screen →
## continue from the save → quit → a second New game starts clean (no state leaks between runs).
## Needs the whole world: ~1–2 min headless.

const SLOT := 0

var _backup := ""
var _had_backup := false
var _t0 := 0
var _errs0 := 0


func run() -> void:
	_t0 = Time.get_ticks_msec()
	_errs0 = Game.errors.errors + Game.errors.script_errors
	_backup_save()
	# The runner is the current scene: detach it so Game's scene changes don't free the test.
	get_tree().current_scene = null
	Story.autosave_enabled = true
	await _menu_new_game(1)
	if Game.player == null:
		_restore_save()
		return
	await _prologue_skip()
	_log("world ready + woke")
	await _salvage()
	_state("after salvage")
	await _gather()
	_state("after gather")
	await _read_manual()
	await _campfire()
	await _radio()
	await _to_ranger_cabin()
	await _first_night()
	await _pause_and_settings()
	var snap := await _save_from_pause()
	await _quit_to_menu_from_pause()
	await _continue_from_menu(snap)
	await _death_and_continue(snap, &"cold")
	await _death_and_continue(snap, &"fall")
	await _new_game_is_clean()
	await _difficulty_survives_relaunch()
	var errs := Game.errors.errors + Game.errors.script_errors - _errs0
	check(errs == 0, "no engine/script errors through the whole first hour (%d: %s)" % [errs, str(Game.errors.first)])
	_restore_save()


# ============================================================================================ helpers

func _log(s: String) -> void:
	print("[flow %5.1fs] %s" % [(Time.get_ticks_msec() - _t0) / 1000.0, s])


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _seconds(t: float) -> void:
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < int(t * 1000.0):
		await get_tree().process_frame


func _until(cond: Callable, timeout_s: float) -> bool:
	var t := Time.get_ticks_msec()
	while not bool(cond.call()):
		if Time.get_ticks_msec() - t > int(timeout_s * 1000.0):
			return false
		await get_tree().process_frame
	return true


func _backup_save() -> void:
	var p := "user://save_%d.json" % SLOT
	_had_backup = FileAccess.file_exists(p)
	if _had_backup:
		_backup = FileAccess.get_file_as_string(p)
	Save.delete_save(SLOT)


func _restore_save() -> void:
	Save.delete_save(SLOT)
	if _had_backup:
		var f := FileAccess.open("user://save_%d.json" % SLOT, FileAccess.WRITE)
		f.store_string(_backup)
		f.close()


func _menu() -> MainMenu:
	var cs := get_tree().current_scene
	return cs as MainMenu if cs is MainMenu else null


# ============================================================================================ steps

func _menu_new_game(diff_index: int) -> void:
	get_tree().change_scene_to_file("res://scenes/main.tscn")
	var ok := await _until(func() -> bool: return _menu() != null, 10.0)
	check(ok and Game.state == Game.State.MENU, "main menu up (state MENU)")
	var m := _menu()
	if m == null:
		return
	await _frames(5)
	m.show_new_game()
	await _frames(3)
	m._select_difficulty(diff_index)
	m._begin()
	var t := Time.get_ticks_msec()
	ok = await _until(func() -> bool: return Game.world != null and Game.player != null and Game.state != Game.State.LOADING, 120.0)
	_log("world built in %d ms" % (Time.get_ticks_msec() - t))
	check(ok, "New game builds the world and leaves LOADING")
	var want: StringName = MainMenu.DIFFICULTIES[diff_index][0]
	check(Game.difficulty == want, "Game.difficulty = %s (%s)" % [want, Game.difficulty])


func _prologue_skip() -> void:
	check(Game.state == Game.State.CINEMATIC, "prologue: state CINEMATIC (%d)" % Game.state)
	var pl: Player = Game.player as Player
	check(not pl.is_input_enabled(), "prologue: player input disabled")
	await _frames(10)
	Input.action_press(&"interact")
	var ok := await _until(func() -> bool: return Story.events.has("woke"), 20.0)
	Input.action_release(&"interact")
	check(ok, "holding interact skips the prologue")
	ok = await _until(func() -> bool: return Game.state == Game.State.PLAYING, 30.0)
	check(ok, "after the prologue: state PLAYING")
	check(pl.is_input_enabled(), "after the prologue: player input enabled")
	check(Story.has_objective(&"gather_firewood") and Story.has_objective(&"salvage_wreck"), "Act 1 objectives given")
	_log("hours %.2f weather %s locked %s act %d" % [Climate.hours, Climate.weather, Climate.locked, Story.act])


## The whole prologue, no skip (sped up): the crash, the caption, then control at the wreck.
func _prologue_full() -> void:
	check(Game.state == Game.State.CINEMATIC, "prologue (no skip): CINEMATIC")
	var pl: Player = Game.player as Player
	var h0 := Climate.hours
	# play it 20x faster, keeping the physics step at 1/60 s so the world simulates as it would
	var tps := Engine.physics_ticks_per_second
	var mps := Engine.max_physics_steps_per_frame
	Engine.physics_ticks_per_second = tps * 20
	Engine.max_physics_steps_per_frame = mps * 20
	Engine.time_scale = 20.0
	var ok := await _until(func() -> bool: return Story.events.has("woke"), 120.0)
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = tps
	Engine.max_physics_steps_per_frame = mps
	check(ok, "the prologue plays to the end and wakes the player")
	ok = await _until(func() -> bool: return Game.state == Game.State.PLAYING, 10.0)
	check(ok and pl.is_input_enabled(), "after the full prologue: PLAYING with control")
	check(absf(Climate.hours - h0) < 0.05 and not Climate.locked, "the clock was frozen during the prologue and runs again (%.2f → %.2f)" % [h0, Climate.hours])
	var ov: CanvasLayer = Story._overlay
	check(ov != null and not bool(ov.get(&"_skip_visible")), "skip hint hidden after the prologue")
	await _seconds(6.0)
	check(ov != null and (ov.get(&"black") as ColorRect).color.a < 0.05, "faded in from black (%.2f)" % ((ov.get(&"black") as ColorRect).color.a if ov else -1.0))
	check(Story.has_objective(&"gather_firewood") and Story.has_objective(&"salvage_wreck"), "Act 1 objectives after the full prologue")
	var hud := _hud()
	check(hud != null and not hud._cinematic, "HUD out of cinematic mode")


# ============================================================================================ acting in the world

## Stands next to `n` (on whatever floor is there), looks at it and presses (or holds) interact through the
## real interaction ray. Returns false if no standing spot let the ray resolve the target.
func _interact(n: Node3D, aim_offset := Vector3.ZERO) -> bool:
	var pl: Player = Game.player as Player
	var space := pl.get_world_3d().direct_space_state
	var c := n.global_position + aim_offset
	var spots: Array[Vector3] = [pl.global_position]
	var st: Node = get_tree().get_first_node_in_group(&"poi_structures")
	var wake: Node3D = st.call(&"get_socket", &"crash_site", &"Arrive_Wake") if st else null
	if wake and wake.global_position.distance_to(c) < 6.0:
		spots.append(wake.global_position)
	for dist in [1.1, 1.6, 0.8, 2.1]:
		for k in 12:
			var a := TAU * float(k) / 12.0
			var spot := c + Vector3(cos(a), 0.0, sin(a)) * float(dist)
			var q := PhysicsRayQueryParameters3D.create(spot + Vector3.UP * 0.6, spot + Vector3.DOWN * 2.5, 1 | (1 << 6))
			q.exclude = [pl.get_rid()]
			var hit := space.intersect_ray(q)
			var fy: float = (hit["position"] as Vector3).y if not hit.is_empty() else TerrainData.get_height(spot.x, spot.z)
			spots.append(Vector3(spot.x, fy + 0.02, spot.z))
	for i in spots.size():
		if i > 0:
			pl.teleport(spots[i], 0.0)
		_aim(c)
		for f in 3:
			await get_tree().physics_frame
			_aim(c)
		var tv: Variant = pl.interactor.target
		if not is_instance_valid(n):
			return false
		if is_instance_valid(tv) and (tv == n or n.is_ancestor_of(tv) or (tv as Node).is_ancestor_of(n)) and pl.interactor.prompt != "":
			await _press_interact(pl.interactor.hold_time)
			return true
	return false


func _aim(at: Vector3) -> void:
	var pl: Player = Game.player as Player
	var d := at - pl.get_eye_position()
	var yaw := rad_to_deg(atan2(-d.x, -d.z))
	var pitch := rad_to_deg(atan2(d.y, Vector2(d.x, d.z).length()))
	pl.set_look(yaw, pitch)


func _press_interact(hold: float) -> void:
	await get_tree().physics_frame
	Input.action_press(&"interact")
	if hold > 0.0:
		var t := Time.get_ticks_msec()
		while Time.get_ticks_msec() - t < int((hold + 0.4) * 1000.0):
			await get_tree().physics_frame
	else:
		await get_tree().physics_frame
		await get_tree().physics_frame
	Input.action_release(&"interact")
	await get_tree().physics_frame


func _inv() -> Inventory:
	return (Game.player as Player).inventory


func _pickups_near(ids: Array, center: Vector3, r: float) -> Array[ItemPickup]:
	var out: Array[ItemPickup] = []
	for n in get_tree().get_nodes_in_group(&"item_pickup"):
		if not is_instance_valid(n) or not (n is ItemPickup):
			continue
		var p: ItemPickup = n
		if not p.is_queued_for_deletion() and ids.has(p.item_id) and p.global_position.distance_to(center) <= r:
			out.append(p)
	out.sort_custom(func(a: ItemPickup, b: ItemPickup) -> bool: return a.global_position.distance_to(center) < b.global_position.distance_to(center))
	return out


func _crash() -> Vector3:
	return TerrainData.get_poi(&"crash_site")["position"]


func _salvage() -> void:
	var st: Node = get_tree().get_first_node_in_group(&"poi_structures")
	var loot: Array = st.call(&"loot_nodes") if st else []
	var failed: Array[String] = []
	for attempt in 3:
		failed.clear()
		for n in loot:
			if not is_instance_valid(n) or not (n is ItemPickup):
				continue
			var p: ItemPickup = n
			if p.is_queued_for_deletion() or p.is_queued_for_deletion() or p.global_position.distance_to(_crash()) > 25.0:
				continue
			var id := p.item_id
			var ok := await _interact(p, Vector3(0, 0.05, 0))
			await _frames(2)
			if not ok or (is_instance_valid(n) and not p.is_queued_for_deletion()):
				failed.append("%s(%s)" % [id, "unreachable" if not ok else "not taken"])
		if failed.is_empty():
			break
	if not failed.is_empty():
		_log("NOTE wreck extras not taken: %s" % str(failed))
	var pl: Player = Game.player as Player
	var missing: Array[String] = []
	for id in ["first_aid_kit", "flare_gun", "survival_manual", "emergency_blanket", "hatchet", "backpack_torn", "survey_scanner", "matches"]:
		if _inv().count(StringName(id)) <= 0 and not pl.equipment.values().has(StringName(id)):
			missing.append(id)
	check(missing.is_empty(), "salvage: all wreck items in the pack %s" % str(missing))
	await _until(func() -> bool: return Story.is_objective_done(&"salvage_wreck"), 3.0)
	check(Story.is_objective_done(&"salvage_wreck"), "salvage_wreck objective completes")
	# Dale's logbook in the cockpit door pocket
	var logn: Node3D = null
	for n in Game.world.find_children("*", "StaticBody3D", true, false):
		if n.get(&"log_id") == &"dale_logbook":
			logn = n
	check(logn != null, "Dale's logbook placed in the cockpit")
	if logn:
		var ok := await _interact(logn)
		await _frames(2)
		check(ok and Story.found_logs.has(&"dale_logbook"), "Dale's logbook can be picked up / read (reachable)")
		check(not pl.is_input_enabled() and pl._ui_screens.has(&"journal"), "reading the logbook opens the journal on its page")
		await _key_event(&"ui_cancel")
		await _frames(3)
		check(pl.is_input_enabled() and pl._ui_screens.is_empty(), "Esc closes the journal and gives control back %s" % str(pl._ui_screens))


## Forest-floor loot spots (veg_loot) around `center`, nearest first: [key, id, position].
func _loot_spots(id: StringName, center: Vector3, r: float) -> Array:
	var veg: Node = Game.world.get_node_or_null(^"Vegetation")
	var loot: Node = veg.get_node_or_null(^"Loot") if veg else null
	var out: Array = []
	if loot == null or veg.get("ctx") == null:
		return out
	var ctx: VegScatter.Context = veg.ctx
	var c0 := VegScatter.cell_of(center.x - r, center.z - r)
	var c1 := VegScatter.cell_of(center.x + r, center.z + r)
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			for sp in loot.cell_spots(ctx, cx, cz):
				var p: Vector3 = sp[2]
				if sp[1] == id and Vector2(p.x - center.x, p.z - center.z).length() <= r and not ItemsRoot.is_key_collected(sp[0]):
					out.append(sp)
	out.sort_custom(func(a: Array, b: Array) -> bool: return (a[2] as Vector3).distance_to(center) < (b[2] as Vector3).distance_to(center))
	return out


func _gather() -> void:
	var c := _crash()
	var want := {&"stick": 9, &"stone": 6}
	for id: StringName in want:
		var spots := _loot_spots(id, c, 300.0)
		var farthest := 0.0
		for sp in spots:
			if _inv().count(id) >= int(want[id]):
				break
			var p: Vector3 = sp[2]
			var pl: Player = Game.player as Player
			var to := p + (c - p).normalized() * 1.5
			pl.teleport(Vector3(to.x, TerrainData.get_height(to.x, to.z) + 0.05, to.z), 0.0)
			await _frames(3)
			var node: ItemPickup = null
			for n in _pickups_near([id], p, 0.5):
				if is_instance_valid(n) and n.persist_id == sp[0]:
					node = n
			if node == null:
				_log("no pickup spawned for %s at %s" % [sp[0], p])
				continue
			if await _interact(node, Vector3(0, 0.03, 0)):
				farthest = maxf(farthest, Vector2(p.x - c.x, p.z - c.z).length())
			await _frames(1)
		_log("gathered %d %s; farthest from the wreck %.0f m" % [_inv().count(id), id, farthest])
		check(_inv().count(id) >= int(want[id]), "gathered %d %s from the forest floor near the wreck (have %d)" % [want[id], id, _inv().count(id)])
	await _until(func() -> bool: return Story.is_objective_done(&"gather_firewood"), 3.0)
	check(Story.is_objective_done(&"gather_firewood"), "gather_firewood completes")


func _tap(action: StringName) -> void:
	Input.action_press(action)
	await _frames(2)
	Input.action_release(action)
	await _frames(2)


func _key_event(action: StringName) -> void:
	var e := InputEventAction.new()
	e.action = action
	e.pressed = true
	Input.parse_input_event(e)
	await _frames(1)
	var r := InputEventAction.new()
	r.action = action
	r.pressed = false
	Input.parse_input_event(r)
	await _frames(2)


func _read_manual() -> void:
	check(Story.has_objective(&"read_manual"), "picking up the manual adds 'Read the survival manual'")
	await _tap(&"inventory")
	var scr := InventoryScreen.get_instance()
	check(scr != null and scr.is_open, "inventory opens (Tab/I action)")
	if scr == null or not scr.is_open:
		return
	var pl: Player = Game.player as Player
	check(not pl.is_input_enabled(), "player input blocked while the inventory is open")
	var slot: ItemSlot = null
	for s in scr._pack_slots:
		if not s.stack.is_empty() and s.item_id() == &"survival_manual":
			slot = s
	check(slot != null, "the manual shows in the pack grid")
	if slot:
		scr._select_slot(slot)
		scr._action_use()
	await _frames(3)
	await _tap(&"inventory")
	await _frames(3)
	check(not scr.is_open, "inventory closes again")
	check(pl.is_input_enabled(), "player input restored after closing the inventory")
	await _until(func() -> bool: return Story.is_objective_done(&"read_manual"), 3.0)
	check(Story.is_objective_done(&"read_manual"), "read_manual completes (manual map reveals the ranger cabin)")


func _campfire() -> void:
	var pl: Player = Game.player as Player
	# a clear, flat spot on the meadow next to the wreck
	var c := _crash() + Vector3(8.0, 0.0, 10.0)
	pl.teleport(Vector3(c.x, TerrainData.get_height(c.x, c.z) + 0.05, c.z), 0.0)
	await _frames(3)
	pl.set_look(0.0, -38.0)
	await _tap(&"build")
	var bm: BuildMode = null
	for n in get_tree().get_nodes_in_group(&"build_mode"):
		bm = n as BuildMode
	if bm == null:
		bm = _find_build_mode(get_tree().root)
	check(bm != null and bm._ui.picker_open, "build key opens the build picker")
	if bm == null:
		return
	bm._ui._pick(&"campfire")
	var valid := false
	for yaw in [0.0, 90.0, 180.0, 270.0, 45.0, 135.0]:
		pl.set_look(yaw, -38.0)
		for i in 4:
			await get_tree().physics_frame
		if bool(bm.placement.get("valid", false)):
			valid = true
			break
	check(valid, "campfire ghost is valid on the meadow (%s)" % bm.placement.get("reason", ""))
	await get_tree().physics_frame
	Input.action_press(&"use")
	await _frames(2)
	Input.action_release(&"use")
	await _frames(2)
	var fire: Node3D = null
	for n in get_tree().get_nodes_in_group(&"heat_source"):
		if n is Campfire and (n as Node3D).global_position.distance_to(pl.global_position) < 8.0:
			fire = n
	check(fire != null, "use places the campfire frame")
	await _tap(&"aim")   # leave build mode
	check(not bm.active, "aim leaves build mode")
	if fire == null:
		return
	var guard := 0
	while not BuildHooks.is_built(fire) and guard < 20:
		guard += 1
		if not await _interact(fire, Vector3(0, 0.15, 0)):
			break
		await _frames(1)
	check(BuildHooks.is_built(fire), "interacting adds sticks and stones until the campfire is built (%d presses)" % guard)
	guard = 0
	while (fire as Campfire).state != Campfire.FireState.BURNING and guard < 8:
		guard += 1
		var pr := String(fire.get_interact_prompt(pl))
		_log("campfire prompt: '%s' (hold %.1f)" % [pr, fire.get_interact_hold_time()])
		if not await _interact(fire, Vector3(0, 0.15, 0)):
			break
		await _frames(2)
	check((fire as Campfire).state == Campfire.FireState.BURNING, "laying sticks and holding interact lights the fire")
	_log("matches left %d, wind %.1f m/s" % [_inv().count(&"matches"), (Climate.get_wind_at(pl.global_position) as Vector3).length()])
	await _until(func() -> bool: return Story.is_objective_done(&"build_campfire"), 3.0)
	check(Story.is_objective_done(&"build_campfire"), "build_campfire completes")


func _find_build_mode(n: Node) -> BuildMode:
	if n is BuildMode:
		return n
	for c in n.get_children():
		var r := _find_build_mode(c)
		if r:
			return r
	return null


func _radio() -> void:
	check(Story.has_objective(&"wreck_radio"), "wreck_radio objective given after the fire")
	var st: Node = get_tree().get_first_node_in_group(&"poi_structures")
	var sock: Node3D = st.call(&"get_socket", &"crash_site", &"Use_Radio")
	var use: Node3D = null
	for n in get_tree().get_nodes_in_group(&"interactable"):
		if n is Node3D and (n as Node3D).global_position.distance_to(sock.global_position) < 0.5:
			use = n
	check(use != null, "cockpit radio interactable exists")
	if use == null:
		return
	var ok := await _interact(use)
	check(ok, "cockpit radio reachable with the interaction ray")
	ok = await _until(func() -> bool: return Story.is_objective_done(&"wreck_radio"), 60.0)
	check(ok, "listening to the radio completes wreck_radio")
	check(Story.has_objective(&"find_ranger_cabin"), "next: find the ranger cabin")


func _state(tag: String) -> void:
	var pl: Player = Game.player as Player
	var inv := _inv()
	var items := []
	for i in inv.size():
		var st := inv.get_slot(i)
		if not st.is_empty():
			items.append("%s×%d" % [st["id"], st["count"]])
	_log("%s: state %d paused %s input %s screens %s dead %s | slots %d/%d weight %.1f/%.1f | %s | hp %.0f warmth %.0f temp %.1f | eq %s" % [tag, Game.state, get_tree().paused,
		pl.is_input_enabled(), pl._ui_screens, pl.vitals.is_dead(), inv.size() - inv.free_slots(), inv.size(), inv.total_weight(), inv.max_weight,
		", ".join(items), pl.vitals.health, pl.vitals.warmth, pl.vitals.body_temp, pl.equipment])


# ============================================================================================ shell

func _hud() -> HUD:
	return HUD.find()


func _pause_and_settings() -> void:
	var pl: Player = Game.player as Player
	await _key_event(&"pause")
	var pm: PauseMenu = _hud().pause_menu as PauseMenu
	check(pm != null and pm.is_open and get_tree().paused and Game.state == Game.State.PAUSED, "Esc opens the pause menu and pauses the game")
	if pm == null:
		return
	check(not pm._save_btn.disabled, "Save game enabled on Survivor")
	check(pm._objective.text != "" and pm._objective.text != "No open objectives.", "pause card shows the current objective (%s)" % pm._objective.text)
	pm.open_settings("")
	await _frames(2)
	var sp: SettingsPanel = pm._settings
	check(sp != null, "settings open from pause")
	if sp:
		var fov0 := float(Settings.get_value(&"fov", 75.0))
		var sl := sp.controls.get(&"fov") as Range
		var target := 90.0 if fov0 < 85.0 else 70.0
		if sl:
			sl.value = target
		await _seconds(0.5)
		check(is_equal_approx(float(Settings.get_value(&"fov", 0.0)), target), "fov slider changes the setting (%s)" % Settings.get_value(&"fov", 0.0))
		check(is_equal_approx(pl.head.base_fov, target), "fov applies live to the player camera while paused")
		var vol := sp.controls.get(&"vol_music") as Range
		if vol:
			vol.value = 0.3
		await _seconds(0.5)
		var bus := AudioServer.get_bus_index(&"Music")
		check(bus < 0 or absf(AudioServer.get_bus_volume_db(bus) - linear_to_db(0.3 * float(Settings.get_value(&"vol_master", 1.0)))) < 1.5 or absf(AudioServer.get_bus_volume_db(bus) - linear_to_db(0.3)) < 1.5,
			"music volume applies live (%.1f dB)" % (AudioServer.get_bus_volume_db(bus) if bus >= 0 else 0.0))
		await _key_event(&"ui_cancel")
		await _frames(3)
		check(pm._settings == null and pm.is_open, "Esc closes settings back to the pause menu")
	await _key_event(&"pause")
	await _frames(3)
	check(not pm.is_open and not get_tree().paused and Game.state == Game.State.PLAYING, "Esc resumes")
	check(pl.is_input_enabled(), "input back after resuming")
	await _seconds(1.0)
	check(absf(pl.camera.fov - pl.head.base_fov) < 3.0, "camera fov eased to the new setting after resume (%.1f)" % pl.camera.fov)


func _snapshot() -> Dictionary:
	var pl: Player = Game.player as Player
	var inv := {}
	for i in _inv().size():
		var st := _inv().get_slot(i)
		if not st.is_empty():
			inv[String(st["id"])] = int(inv.get(String(st["id"]), 0)) + int(st["count"])
	var objs := {}
	for o in Story.objectives:
		objs[String(o["id"])] = bool(o["done"])
	var fires := 0
	for n in get_tree().get_nodes_in_group(&"heat_source"):
		if n is Campfire and BuildHooks.is_built(n) and (n as Node3D).global_position.distance_to(_crash()) < 60.0:
			fires += 1
	return {"pos": pl.global_position, "inv": inv, "objs": objs, "act": Story.act, "day": Climate.day, "hours": Climate.hours,
		"weather": Climate.weather, "logs": Story.found_logs.duplicate(), "difficulty": Game.difficulty, "fires": fires,
		"health": pl.vitals.health, "flags": Game.flags.size(), "eq": pl.equipment.duplicate()}


func _save_from_pause() -> Dictionary:
	await _key_event(&"pause")
	var pm: PauseMenu = _hud().pause_menu as PauseMenu
	var snap := _snapshot()
	pm._save_btn.pressed.emit()
	await _frames(2)
	check(Save.has_save(0), "Save game writes slot 0")
	await _key_event(&"pause")
	await _frames(2)
	return snap


func _quit_to_menu_from_pause() -> void:
	await _key_event(&"pause")
	var pm: PauseMenu = _hud().pause_menu as PauseMenu
	pm._ask_quit()
	await _frames(2)
	var dlg: ConfirmDialog = null
	for c in pm.root.get_children():
		if c is ConfirmDialog:
			dlg = c
	check(dlg != null, "quit asks for confirmation")
	if dlg:
		dlg.confirmed.emit()
	var ok := await _until(func() -> bool: return _menu() != null and Game.world == null, 20.0)
	check(ok and Game.state == Game.State.MENU and not get_tree().paused, "quit returns to the main menu, unpaused")
	check(Input.mouse_mode == Input.MOUSE_MODE_VISIBLE, "mouse visible in the menu")
	await _frames(5)
	check(_menu() != null and _menu().buttons.size() > 0 and _menu().buttons[0].name == "Continue", "menu offers Continue")


func _compare(snap: Dictionary, tag: String, pos_tol := 1.5) -> void:
	var now := _snapshot()
	check((now["pos"] as Vector3).distance_to(snap["pos"]) < pos_tol, "%s: position restored (%s vs %s)" % [tag, now["pos"], snap["pos"]])
	check(now["inv"] == snap["inv"], "%s: inventory restored %s" % [tag, "" if now["inv"] == snap["inv"] else str([now["inv"], snap["inv"]])])
	check(now["objs"] == snap["objs"] and now["act"] == snap["act"], "%s: objectives + act restored %s" % [tag, "" if now["objs"] == snap["objs"] else str([now["objs"], snap["objs"]])])
	check(now["day"] == snap["day"] and absf(float(now["hours"]) - float(snap["hours"])) < 0.2, "%s: clock restored (%s %.2f vs %.2f)" % [tag, now["day"], now["hours"], snap["hours"]])
	check(now["logs"] == snap["logs"], "%s: journal logs restored" % tag)
	check(now["difficulty"] == snap["difficulty"], "%s: difficulty restored" % tag)
	check(now["fires"] == snap["fires"], "%s: the built campfire is still there (%d/%d)" % [tag, now["fires"], snap["fires"]])
	check(now["eq"] == snap["eq"], "%s: equipment restored" % tag)
	var pl: Player = Game.player as Player
	check(Game.state == Game.State.PLAYING and pl.is_input_enabled() and not pl.vitals.is_dead(), "%s: playing with control (state %d)" % [tag, Game.state])
	check(pl.vitals.difficulty == Game.difficulty, "%s: vitals run on the save's difficulty (%s / %s)" % [tag, pl.vitals.difficulty, Game.difficulty])
	var respawned: Array[String] = []
	var st: Node = get_tree().get_first_node_in_group(&"poi_structures")
	for n in st.call(&"loot_nodes"):
		if (n as Node3D).global_position.distance_to(_crash()) < 25.0 and ["flare_gun", "hatchet", "survival_manual", "matches"].has(String(n.item_id)):
			respawned.append(String(n.item_id))
	check(respawned.is_empty(), "%s: salvaged wreck items stay taken %s" % [tag, respawned])


func _continue_from_menu(snap: Dictionary) -> void:
	var m := _menu()
	if m == null:
		return
	m._continue()
	var ok := await _until(func() -> bool: return Game.world != null and Game.player != null and Game.state != Game.State.LOADING, 120.0)
	check(ok, "Continue loads the world")
	await _frames(10)
	check(not Story._in_cinematic and Game.state == Game.State.PLAYING, "Continue does not replay the prologue")
	_compare(snap, "continue")


func _death_and_continue(snap: Dictionary, cause: StringName) -> void:
	var pl: Player = Game.player as Player
	if pl == null:
		return
	if cause == &"fall":
		var p := pl.global_position + Vector3(0, 0, 0)
		pl.teleport(Vector3(p.x + 20.0, TerrainData.get_height(p.x + 20.0, p.z) + 45.0, p.z), 0.0)
	else:
		# freezing to death with the pack open: the inventory must get out of the way of the death screen
		await _tap(&"inventory")
		check(InventoryScreen.get_instance() != null and InventoryScreen.get_instance().is_open, "cold: inventory open before dying")
		pl.vitals.warmth = 0.0
		pl.vitals.apply_damage(500.0, &"cold")
	var ok := await _until(func() -> bool: return pl.vitals.is_dead(), 20.0)
	check(ok and Game.state == Game.State.DEAD, "%s: the player dies (%s)" % [cause, pl.vitals.death_cause])
	ok = await _until(func() -> bool: return _hud() != null and _hud().death_screen != null, 6.0)
	var ds: DeathScreen = _hud().death_screen as DeathScreen if _hud() else null
	check(ok and ds != null, "%s: death screen shows" % cause)
	if ds == null:
		return
	_log("death screen: '%s' / '%s'" % [ds._title.text, ds._sub.text])
	check(ds._title.text.begins_with(String(DeathScreen.CAUSES.get(cause, "You died"))), "%s: headline names the cause (%s)" % [cause, ds._title.text])
	check(Input.mouse_mode == Input.MOUSE_MODE_VISIBLE or DisplayServer.get_name() == "headless", "%s: mouse visible on the death screen" % cause)
	check(not _hud().can_open_screen(), "%s: pause/inventory can't open over the death screen" % cause)
	var inv_scr := InventoryScreen.get_instance()
	check(inv_scr == null or not inv_scr.is_open, "%s: no inventory left open under the death screen" % cause)
	await _tap(&"inventory")
	check(inv_scr == null or not inv_scr.is_open, "%s: the inventory can't be opened while dead" % cause)
	await _key_event(&"pause")
	check(_hud().pause_menu == null or not (_hud().pause_menu as PauseMenu).is_open, "%s: Esc doesn't open the pause menu over the death screen" % cause)
	ds._buttons[0].pressed.emit()
	var old_id := pl.get_instance_id()
	ok = await _until(func() -> bool: return Game.world != null and Game.player != null and Game.player.get_instance_id() != old_id and Game.state != Game.State.LOADING, 120.0)
	check(ok, "%s: Continue from last save reloads" % cause)
	await _frames(10)
	_compare(snap, "after %s death" % cause)


func _new_game_is_clean() -> void:
	# quit from the death flow's world through the pause menu, then New game on Explorer
	await _key_event(&"pause")
	var pm: PauseMenu = _hud().pause_menu as PauseMenu
	pm._ask_quit()
	await _frames(2)
	for c in pm.root.get_children():
		if c is ConfirmDialog:
			(c as ConfirmDialog).confirmed.emit()
	await _until(func() -> bool: return _menu() != null and Game.world == null, 20.0)
	await _frames(5)
	var m := _menu()
	if m == null:
		check(false, "back at the menu for a second new game")
		return
	m.show_new_game()
	await _frames(3)     # the panel focuses the current card first (deferred), then the player picks
	m._select_difficulty(0)
	m._begin()
	await _frames(2)
	for c in m.root.get_children():
		if c is ConfirmDialog:
			(c as ConfirmDialog).confirmed.emit()
	var ok := await _until(func() -> bool: return Game.world != null and Game.player != null and Game.state != Game.State.LOADING, 120.0)
	check(ok, "second New game builds the world")
	check(Game.difficulty == &"explorer", "second run on Explorer")
	var pl: Player = Game.player as Player
	check(pl.vitals.difficulty == &"explorer", "vitals on Explorer (%s)" % pl.vitals.difficulty)
	await _prologue_full()
	var inv := _snapshot()["inv"] as Dictionary
	check(not inv.has("stick") and not inv.has("flare_gun") and not inv.has("hatchet"), "fresh pack %s" % str(inv))
	check(Story.found_logs.is_empty() and not Story.is_objective_done(&"gather_firewood") and not Story.has_objective(&"find_ranger_cabin"), "story reset")
	check(Climate.day == 1 and absf(Climate.hours - 17.3) < 0.1 and Climate.weather == &"snow", "climate reset (%d %.2f %s)" % [Climate.day, Climate.hours, Climate.weather])
	check(not Game.flags.has(&"read_survival_manual"), "Game flags reset")
	var loot := []
	var st: Node = get_tree().get_first_node_in_group(&"poi_structures")
	for n in st.call(&"loot_nodes"):
		if (n as Node3D).global_position.distance_to(_crash()) < 25.0:
			loot.append(String(n.item_id))
	check(loot.has("flare_gun") and loot.has("survival_manual") and loot.has("matches"), "wreck loot back in a new game %s" % str(loot))
	var fires := 0
	for n in get_tree().get_nodes_in_group(&"heat_source"):
		if n is Campfire and (n as Node3D).global_position.distance_to(_crash()) < 60.0:
			fires += 1
	check(fires == 0, "no campfire from the previous run")
	check(Game.playtime < 60.0, "playtime reset (%.0f)" % Game.playtime)


## A fresh launch has Game.difficulty at its default; continuing an Explorer save must run the vitals on
## Explorer, and changing a setting from the pause menu must not swap it for the menu's last pick.
func _difficulty_survives_relaunch() -> void:
	await _key_event(&"pause")
	var pm: PauseMenu = _hud().pause_menu as PauseMenu
	pm._save_btn.pressed.emit()
	await _frames(2)
	pm._ask_quit()
	await _frames(2)
	for c in pm.root.get_children():
		if c is ConfirmDialog:
			(c as ConfirmDialog).confirmed.emit()
	await _until(func() -> bool: return _menu() != null and Game.world == null, 20.0)
	await _frames(5)
	Game.difficulty = &"survivor"                         # as after a fresh launch
	Settings.set_value(&"difficulty", &"whiteout", false)  # the menu's last pick (a new game never saved)
	_menu()._continue()
	var ok := await _until(func() -> bool: return Game.world != null and Game.player != null and Game.state != Game.State.LOADING, 120.0)
	await _frames(5)
	var pl: Player = Game.player as Player
	check(ok and Game.difficulty == &"explorer", "relaunch + Continue: Game.difficulty from the save (%s)" % Game.difficulty)
	check(pl.vitals.difficulty == &"explorer", "relaunch + Continue: vitals on the save's difficulty (%s)" % pl.vitals.difficulty)
	await _key_event(&"pause")
	pm = _hud().pause_menu as PauseMenu
	Settings.set_value(&"fov", 80.0, true)
	await _frames(2)
	check(pl.vitals.difficulty == &"explorer", "changing a setting while paused keeps the game's difficulty (%s)" % pl.vitals.difficulty)
	await _key_event(&"pause")
	Settings.set_value(&"difficulty", &"survivor", false)



## Reaching the ranger cabin finishes Act 1: act 2 starts and the story autosaves.
func _to_ranger_cabin() -> void:
	var pl: Player = Game.player as Player
	var poi: Dictionary = TerrainData.get_poi(&"ranger_cabin")
	var c: Vector3 = poi["position"]
	var at := c + Vector3(-12.0, 0.0, 14.0)
	var toasts: Array[String] = []
	var cb := func(t: String, _k: StringName) -> void: toasts.append(t)
	Events.notification.connect(cb)
	pl.teleport(Vector3(at.x, TerrainData.get_height(at.x, at.z) + 0.1, at.z), 0.0)
	var ok := await _until(func() -> bool: return Story.is_objective_done(&"find_ranger_cabin"), 8.0)
	check(ok and Story.act == 2, "reaching the ranger cabin completes Act 1 (act %d)" % Story.act)
	await _frames(5)
	Events.notification.disconnect(cb)
	var saved: Dictionary = Save._read(0)
	check(Save.has_save(0) and int((saved.get("story", {}) as Dictionary).get("act", 0)) == 2, "autosave at the Act 2 checkpoint")
	check(toasts.has("Progress saved"), "'Progress saved' toast %s" % str(toasts))


## The first night falls: darkness, the night score, the clock and weather keep running, nothing errors.
func _first_night() -> void:
	var errs0 := Game.errors.errors + Game.errors.script_errors
	var d0 := Climate.day
	Climate.advance_time(fposmod(22.5 - Climate.hours, 24.0))
	await _seconds(2.0)
	check(Climate.hours > 22.0 or Climate.hours < 1.0, "night: %s" % Climate.get_time_string())
	check(Climate.get_daylight() < 0.1, "night is dark (daylight %.2f)" % Climate.get_daylight())
	var mus: Variant = Audio.music.get(&"state") if Audio.music else null
	_log("music state at night: %s" % str(mus))
	Climate.time_scale = 40.0      # the clock runs fast (as while sleeping); physics and AI keep real time
	await _until(func() -> bool: return Climate.day > d0 and Climate.hours > 0.5, 60.0)
	Climate.time_scale = 1.0
	check(Climate.day == d0 + 1, "midnight rolls over to day %d" % Climate.day)
	var pl: Player = Game.player as Player
	check(not pl.vitals.is_dead() and Game.state == Game.State.PLAYING, "survived into the night at the cabin (hp %.0f)" % pl.vitals.health)
	var errs := Game.errors.errors + Game.errors.script_errors - errs0
	check(errs == 0, "no engine/script errors through the evening (%d: %s)" % [errs, str(Game.errors.first)])

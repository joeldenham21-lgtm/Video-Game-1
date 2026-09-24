extends Node3D
## Items dev scene (scenes/dev/items_test.tscn): a forest clearing at the crash-site altitude with a campfire,
## storage box, workbench, fabricator and scattered pickups, plus a temporary first-person stand-in for the
## Player (CONTRACT.md §4 API subset) so pickups, the campfire and the inventory / equipment / crafting UI can be
## exercised without the other workstreams.
##
## Play:  godot --path thin-air res://scenes/dev/items_test.tscn
##        WASD move · mouse look · E interact (hold for timed) · Tab/I inventory · 1–6 hotbar · Esc frees the mouse
## Shots: DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --fixed-fps 30 --resolution 1280x720 \
##          res://scenes/dev/items_test.tscn -- --shot=campfire_night --save=/abs/out.jpg
##        shots: campfire_night, campfire_dusk, pickups, ui_inventory, ui_equipment, ui_crafting, ui_container
## Options: --hours=H  --preset=P  --frames=N (capture frame)  --save=path (.jpg/.png; quits after saving)
##          --perf (prints draw calls / primitives at the capture frame)

const GROUND_Y := 1480.0          ## crash-site valley altitude (TerrainData stub is flat)
const BOX_POS := Vector3(-2.9, 0.0, 1.2)
const BENCH_POS := Vector3(3.6, 0.0, -2.4)
const FAB_POS := Vector3(-5.2, 0.0, 5.6)

var args: Dictionary = {}
var shot := ""
var player: StandIn
var fire: Campfire
var box: StorageContainer
var items_root: ItemsRoot
var hud: DevHud
var frame := 0
var capture_frame := 90
var _sun: DirectionalLight3D
var _env: Environment
var _sky_mat: ProceduralSkyMaterial


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	shot = String(args.get("shot", ""))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	var default_hours := 21.2 if shot in ["", "campfire_night"] else (17.7 if shot.begins_with("ui_") or shot == "campfire_dusk" else 11.0)
	Climate.hours = float(args.get("hours", str(default_hours)))
	Climate.locked = shot != ""
	Climate.wind_speed = 2.2
	Climate.wind_direction = Vector3(0.8, 0, -0.6).normalized()
	Game.flags.clear()
	Game.set_flag(&"generator_running", true)
	_build_environment()
	_build_ground()
	_build_forest()
	items_root = (load("res://scenes/items/items_root.tscn") as PackedScene).instantiate() as ItemsRoot
	items_root.name = "Items"
	add_child(items_root)
	_build_stations()
	_scatter_pickups()
	player = StandIn.new()
	player.name = "Player"
	add_child(player)
	player.teleport(Vector3(0.4, GROUND_Y, 3.4), 8.0)
	_give_starting_kit()
	hud = DevHud.new()
	add_child(hud)
	Game.register_player(player)
	Game.state = Game.State.PLAYING
	capture_frame = int(args.get("frames", "45" if shot.begins_with("ui_") else "90"))
	if shot != "":
		player.set_input_enabled(false)
		_setup_shot.call_deferred()
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _exit_tree() -> void:
	if Game.player == player:
		Game.player = null
	Game.state = Game.State.MENU


func _process(_delta: float) -> void:
	frame += 1
	if shot == "":
		return
	if shot.begins_with("ui_") and frame == 12:
		_open_ui_for_shot()
	if shot == "ui_crafting" and frame == 16:
		var screen := InventoryScreen.get_instance()
		if screen:
			screen.select_recipe(ItemDB.get_recipe(&"meat_cooked"))
			screen._on_craft_pressed()
	if frame == capture_frame:
		if args.has("perf"):
			print("PERF shot=%s draw_calls=%d primitives=%d objects=%d" % [shot,
				Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
				Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
				Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)])
		if args.has("save"):
			_save_frame.call_deferred(String(args["save"]))


func _save_frame(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_jpg(path, 0.9) if path.get_extension().to_lower() in ["jpg", "jpeg"] else img.save_png(path)
	print("saved %s (%s)" % [path, error_string(err)])
	get_tree().quit()


# =============================================================================================== world

func _build_environment() -> void:
	var we := WorldEnvironment.new()
	_env = Environment.new()
	_env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	_sky_mat = ProceduralSkyMaterial.new()
	sky.sky_material = _sky_mat
	_env.sky = sky
	_env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	_env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	_env.tonemap_mode = Environment.TONE_MAPPER_AGX
	_env.glow_enabled = true
	_env.glow_intensity = 0.55
	_env.glow_bloom = 0.04
	_env.glow_hdr_threshold = 1.1
	_env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	_env.fog_enabled = true
	_env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	var forward := Settings.is_forward_plus() and not Settings.is_mobile()
	_env.ssao_enabled = forward
	_env.ssao_radius = 0.8
	_env.ssao_intensity = 1.6
	we.environment = _env
	add_child(we)
	_sun = DirectionalLight3D.new()
	_sun.name = "Sun"
	_sun.shadow_enabled = true
	_sun.directional_shadow_max_distance = 40.0
	add_child(_sun)
	_apply_time_of_day()


## Sky, sun/moon and fog for Climate.hours (the real Sky stream replaces all of this in the world).
func _apply_time_of_day() -> void:
	var sun_dir: Vector3 = Climate.get_sun_direction()
	var day := clampf(sun_dir.y * 3.2 + 0.25, 0.0, 1.0)            # 0 night … 1 day
	var dusk := clampf(1.0 - absf(sun_dir.y) * 6.0, 0.0, 1.0) * (1.0 if sun_dir.y > -0.12 else 0.0)
	var night_top := Color(0.006, 0.009, 0.018)
	var night_hor := Color(0.018, 0.022, 0.03)
	var day_top := Color(0.26, 0.42, 0.66)
	var day_hor := Color(0.66, 0.72, 0.78)
	var dusk_hor := Color(0.78, 0.46, 0.26)
	_sky_mat.sky_top_color = night_top.lerp(day_top, day)
	_sky_mat.sky_horizon_color = night_hor.lerp(day_hor, day).lerp(dusk_hor, dusk * 0.7)
	_sky_mat.ground_horizon_color = _sky_mat.sky_horizon_color.darkened(0.3)
	_sky_mat.ground_bottom_color = Color(0.03, 0.03, 0.03).lerp(Color(0.18, 0.17, 0.15), day)
	_sky_mat.sky_energy_multiplier = lerpf(0.35, 1.0, day)
	_sky_mat.sun_angle_max = 20.0
	var light_dir := sun_dir if sun_dir.y > -0.05 else Climate.get_moon_direction()
	_sun.look_at_from_position(Vector3.ZERO, -light_dir, Vector3.UP if absf(light_dir.y) < 0.99 else Vector3.FORWARD)
	_sun.position = Vector3(0, GROUND_Y + 10.0, 0)
	if sun_dir.y > -0.05:
		_sun.light_color = Color(1.0, 0.93, 0.84).lerp(Color(1.0, 0.62, 0.36), dusk)
		_sun.light_energy = lerpf(0.25, 1.6, day)
	else:
		_sun.light_color = Color(0.62, 0.72, 1.0)                    # moonlight
		_sun.light_energy = 0.06
	_env.ambient_light_energy = lerpf(0.18, 0.8, day)
	_env.fog_light_color = _sky_mat.sky_horizon_color.darkened(0.2)
	_env.fog_density = lerpf(0.035, 0.006, day)
	_env.fog_sky_affect = 0.4
	_env.tonemap_exposure = lerpf(1.1, 1.0, day)


func _build_ground() -> void:
	var body := StaticBody3D.new()
	body.name = "Ground"
	var col := CollisionShape3D.new()
	col.shape = WorldBoundaryShape3D.new()
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(90, 90)
	mi.mesh = pm
	var mat := (ItemMaterials.get_material(&"forest_floor") as BaseMaterial3D).duplicate() as BaseMaterial3D
	mat.uv1_triplanar = true
	mat.uv1_world_triplanar = true
	mat.uv1_scale = Vector3(1.25, 1.25, 1.25)
	mi.material_override = mat
	body.add_child(mi)
	body.position.y = GROUND_Y
	add_child(body)


## A ring of spruce trunks around the clearing (their crowns are above the frame) plus a sitting log and boulders.
func _build_forest() -> void:
	var r := RandomNumberGenerator.new()
	r.seed = 1480
	var bark := (ItemMaterials.get_material(&"bark") as BaseMaterial3D).duplicate() as BaseMaterial3D
	bark.uv1_scale = Vector3(3.0, 9.0, 1.0)
	var root := Node3D.new()
	root.name = "Forest"
	add_child(root)
	for i in 34:
		var a := r.randf() * TAU
		var d := r.randf_range(7.5, 26.0)
		var p := Vector3(cos(a) * d, GROUND_Y, sin(a) * d)
		var rad := r.randf_range(0.14, 0.32)
		var cm := CylinderMesh.new()
		cm.top_radius = rad * 0.55
		cm.bottom_radius = rad * 1.15
		cm.height = 22.0
		cm.radial_segments = 12
		cm.rings = 1
		cm.material = bark
		var mi := MeshInstance3D.new()
		mi.mesh = cm
		mi.position = p + Vector3(0, 11.0, 0)
		mi.rotation = Vector3(r.randf_range(-0.03, 0.03), r.randf() * TAU, r.randf_range(-0.03, 0.03))
		root.add_child(mi)
		var sb := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var shape := CylinderShape3D.new()
		shape.radius = rad
		shape.height = 3.0
		cs.shape = shape
		sb.position = p + Vector3(0, 1.5, 0)
		sb.add_child(cs)
		root.add_child(sb)
	# a log to sit on and a couple of boulders
	var seat := MeshInstance3D.new()
	seat.mesh = ItemVisuals.get_mesh(&"log")
	seat.scale = Vector3(1.6, 1.25, 1.25)
	seat.position = Vector3(1.9, GROUND_Y, 0.9)
	seat.rotation.y = 1.15
	root.add_child(seat)
	for b in [[Vector3(-3.4, 0, -1.5), 7.5, 0.4], [Vector3(4.6, 0, 1.9), 5.0, 2.1], [Vector3(-1.2, 0, -5.8), 11.0, 1.2]]:
		var mi := MeshInstance3D.new()
		mi.mesh = ItemVisuals.get_mesh(&"stone")
		mi.scale = Vector3.ONE * float(b[1])
		mi.position = (b[0] as Vector3) + Vector3(0, GROUND_Y - 0.05 * float(b[1]), 0)
		mi.rotation.y = float(b[2])
		root.add_child(mi)


func _build_stations() -> void:
	fire = (load("res://scenes/items/campfire.tscn") as PackedScene).instantiate() as Campfire
	fire.persist_id = "dev_fire"
	var lit := shot in ["", "campfire_night", "campfire_dusk"] or shot.begins_with("ui_")
	fire.start_fuel_minutes = 140.0 if lit else 0.0
	fire.start_lit = lit
	fire.always_simulate = true
	fire.position = Vector3(0, GROUND_Y, 0)
	add_child(fire)
	box = (load("res://scenes/items/storage_box.tscn") as PackedScene).instantiate() as StorageContainer
	box.persist_id = "dev_box"
	box.title = "Supply Crate"
	box.loot = {"canned_beans": 2, "ration_bar": 3, "rope": 2, "wool_blanket": 1, "flare": 2, "matches": 20,
		"duct_tape": 1, "bandage": 2}
	box.position = Vector3(BOX_POS.x, GROUND_Y, BOX_POS.z)
	box.rotation.y = 0.5
	add_child(box)
	var bench := (load("res://scenes/items/workbench.tscn") as PackedScene).instantiate() as Node3D
	bench.position = Vector3(BENCH_POS.x, GROUND_Y, BENCH_POS.z)
	bench.rotation.y = -0.6
	add_child(bench)
	var fab := (load("res://scenes/items/fabricator.tscn") as PackedScene).instantiate() as Node3D
	fab.position = Vector3(FAB_POS.x, GROUND_Y, FAB_POS.z)
	fab.rotation.y = 0.8
	add_child(fab)


## Placed world loot (frozen pickups) around the clearing, the way the POI streams will place it.
func _scatter_pickups() -> void:
	var loot := [
		[&"stick", 3, Vector3(1.1, 0, 2.1), 0.3], [&"stick", 2, Vector3(-1.6, 0, 2.6), 1.9],
		[&"stone", 1, Vector3(-0.9, 0, 1.9), 0.0], [&"stone", 2, Vector3(1.9, 0, 2.9), 1.0],
		[&"log", 1, Vector3(-2.2, 0, -1.2), 0.7], [&"flint", 1, Vector3(0.3, 0, 2.5), 2.2],
		[&"hatchet", 1, Vector3(1.55, 0.0, 0.45), 2.6], [&"canned_beans", 1, Vector3(-0.8, 0, 3.3), 0.0],
		[&"water_boiled", 1, Vector3(-1.1, 0, 3.1), 0.0], [&"flare", 1, Vector3(0.9, 0, 3.6), 0.8],
		[&"first_aid_kit", 1, BOX_POS + Vector3(0.05, _top(&"storage_box"), 0.0), 0.4], [&"matches", 1, Vector3(-0.3, 0, 3.0), 1.4],
		[&"rope", 1, Vector3(2.7, 0, 2.2), 0.0], [&"meat_raw", 1, BENCH_POS + Vector3(-0.2, _top(&"workbench"), 0.1), 0.2],
		[&"fiber", 4, Vector3(-2.0, 0, 3.2), 0.9], [&"bark", 2, Vector3(2.2, 0, -0.9), 2.0],
		[&"survival_manual", 1, BENCH_POS + Vector3(0.25, _top(&"workbench"), -0.05), -0.4], [&"parka", 1, Vector3(-3.2, 0, 2.7), 0.6],
		[&"cooking_pot", 1, Vector3(0.75, 0, -0.9), 0.0], [&"torch", 1, Vector3(-1.4, 0, -2.0), 1.1],
	]
	for e in loot:
		var p := (load("res://scenes/items/pickup.tscn") as PackedScene).instantiate() as ItemPickup
		p.item_id = e[0]
		p.count = e[1]
		p.freeze = true
		p.persist_id = "dev_%s_%d" % [e[0], items_root.get_child_count()]
		p.position = (e[2] as Vector3) + Vector3(0, GROUND_Y, 0)
		p.rotation.y = float(e[3])
		items_root.add_child(p)


static func _top(model_id: StringName) -> float:
	var m := ItemVisuals.get_mesh(model_id)
	return m.get_aabb().end.y if m != null else 0.0


func _give_starting_kit() -> void:
	var inv := player.inventory
	for pair in [[&"stick", 14], [&"stone", 6], [&"fiber", 9], [&"flint", 2], [&"bark", 4], [&"resin", 2],
			[&"cloth", 3], [&"rope", 1], [&"matches", 12], [&"canned_beans", 1], [&"water_boiled", 1],
			[&"ration_bar", 3], [&"meat_raw", 2], [&"first_aid_kit", 1], [&"bandage", 2], [&"flare", 2],
			[&"survival_manual", 1], [&"wool_hat", 1], [&"parka", 1], [&"snow", 3], [&"bottle_empty", 1],
			[&"pine_needles", 4]]:
		inv.add(pair[0], pair[1])
	inv.add(&"hatchet", 1, 0.72)
	inv.add(&"knife", 1, 0.9)
	inv.add(&"cooking_pot", 1)
	player.equipment[&"body"] = &"field_jacket"
	player.equipment[&"legs"] = &"hiking_pants"
	player.equipment[&"feet"] = &"boots"
	player.equipment[&"hands"] = &"work_gloves"
	player.equipment[&"back"] = &"backpack_torn"
	ItemActions.apply_carry_capacity(player)
	player.hotbar[0] = &"hatchet"
	player.hotbar[1] = &"knife"
	player.hotbar[2] = &"flare"
	player.hotbar[3] = &"water_boiled"
	player.active_slot = 0


# =============================================================================================== shots

func _setup_shot() -> void:
	match shot:
		"campfire_night":
			_pose(Vector3(1.1, 1.08, 1.72), 32.0, -17.0)
		"campfire_dusk":
			_pose(Vector3(-2.3, 1.55, 3.0), -35.0, -20.0)
		"pickups":
			_pose(Vector3(0.1, 1.5, 4.9), 2.0, -38.0)
		_:
			_pose(Vector3(0.4, 1.62, 3.4), 8.0, -18.0)


func _pose(p: Vector3, yaw: float, pitch: float) -> void:
	player.teleport(Vector3(p.x, GROUND_Y, p.z), yaw)
	player.camera.position.y = p.y
	player.set_pitch(pitch)


func _open_ui_for_shot() -> void:
	var screen := InventoryScreen.get_instance()
	if screen == null:
		push_error("items_test: no inventory screen")
		return
	match shot:
		"ui_inventory":
			screen.open()
			screen._select_slot(screen._pack_slots[player.inventory.find(&"hatchet")])
		"ui_equipment":
			screen.open(InventoryScreen.Tab.EQUIPMENT)
			screen._select_slot(screen._equip_slots[&"body"])
		"ui_crafting":
			Blueprints.unlock_for_read(&"survival_manual")
			Blueprints.unlock_for_pickup(&"pine_needles")
			screen.open_station(&"campfire", fire)
		"ui_container":
			box.interact(player)
			screen._select_slot(screen._cont_slots[0])


# =============================================================================================== stand-in player

## Minimal first-person body implementing the parts of the Player contract the items stream uses.
class StandIn extends CharacterBody3D:
	var inventory: Inventory = Inventory.new(24, 30.0)
	var equipment: Dictionary = {&"head": &"", &"face": &"", &"body": &"", &"legs": &"", &"hands": &"", &"feet": &"", &"back": &""}
	var hotbar: Array[StringName] = [&"", &"", &"", &"", &"", &""]
	var active_slot := -1
	var is_swimming := false
	var is_climbing := false
	var is_crouching := false
	var is_sprinting := false
	var is_sheltered := 0.0
	var camera: Camera3D
	var input_enabled := true
	var _pitch := 0.0
	var _ray := PhysicsRayQueryParameters3D.new()
	var _target: Object = null
	var _prompt := ""
	var _hold := 0.0

	const INTERACT_MASK := 1 | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 9)

	func _ready() -> void:
		collision_layer = 1 << 1
		collision_mask = 1 | (1 << 2) | (1 << 6) | (1 << 9)
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = 0.3
		cap.height = 1.75
		cs.shape = cap
		cs.position.y = 0.875
		add_child(cs)
		camera = Camera3D.new()
		camera.position.y = 1.62
		camera.fov = 72.0
		camera.near = 0.05
		camera.far = 400.0
		add_child(camera)
		camera.make_current()
		_ray.collision_mask = INTERACT_MASK
		_ray.collide_with_areas = true
		_ray.exclude = [get_rid()]
		Events.ui_screen_opened.connect(func(_s: StringName) -> void: set_input_enabled(false))
		Events.ui_screen_closed.connect(func(_s: StringName) -> void: set_input_enabled(true))

	func get_camera() -> Camera3D:
		return camera

	func get_eye_position() -> Vector3:
		return camera.global_position

	func get_look_direction() -> Vector3:
		return -camera.global_transform.basis.z

	func teleport(pos: Vector3, yaw_deg := 0.0) -> void:
		global_position = pos
		rotation.y = deg_to_rad(yaw_deg)
		velocity = Vector3.ZERO

	func set_pitch(deg: float) -> void:
		_pitch = deg_to_rad(deg)
		camera.rotation.x = _pitch

	func set_input_enabled(enabled: bool) -> void:
		input_enabled = enabled
		if not enabled:
			_set_prompt(null, "")

	func get_active_item() -> StringName:
		return hotbar[active_slot] if active_slot >= 0 and active_slot < hotbar.size() else &""

	func select_hotbar(index: int) -> void:
		active_slot = -1 if index == active_slot else index
		Events.active_item_changed.emit(get_active_item())

	func get_insulation() -> float:
		return float(ItemActions.clothing_totals(equipment)["insulation"])

	func get_windproof() -> float:
		return float(ItemActions.clothing_totals(equipment)["windproof"])

	func has_gear(tag: StringName) -> bool:
		return ItemActions.gear_tags(self).has(tag)

	func _unhandled_input(event: InputEvent) -> void:
		if not input_enabled:
			return
		if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			var m := event as InputEventMouseMotion
			rotation.y -= m.relative.x * 0.0025
			_pitch = clampf(_pitch - m.relative.y * 0.0025, -1.45, 1.45)
			camera.rotation.x = _pitch
		elif event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		elif event.is_action_pressed("pause"):
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		for i in 6:
			if event.is_action_pressed("hotbar_%d" % (i + 1)):
				select_hotbar(i)

	func _physics_process(delta: float) -> void:
		var dir := Vector3.ZERO
		if input_enabled:
			var v := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
			dir = (global_transform.basis * Vector3(v.x, 0, v.y))
			dir.y = 0.0
			var look := Input.get_vector("look_left", "look_right", "look_up", "look_down")
			rotation.y -= look.x * 2.4 * delta
			_pitch = clampf(_pitch - look.y * 2.0 * delta, -1.45, 1.45)
			camera.rotation.x = _pitch
		is_sprinting = input_enabled and Input.is_action_pressed("sprint")
		var speed := 5.5 if is_sprinting else 2.8
		velocity.x = move_toward(velocity.x, dir.x * speed, 30.0 * delta)
		velocity.z = move_toward(velocity.z, dir.z * speed, 30.0 * delta)
		velocity.y = 0.0 if is_on_floor() else velocity.y - 9.81 * delta
		if input_enabled and is_on_floor() and Input.is_action_just_pressed("jump"):
			velocity.y = 4.2
		move_and_slide()
		_update_interaction(delta)

	func _update_interaction(delta: float) -> void:
		if not input_enabled:
			return
		_ray.from = camera.global_position
		_ray.to = _ray.from - camera.global_transform.basis.z * 2.6
		var hit := get_world_3d().direct_space_state.intersect_ray(_ray)
		var target: Object = null
		if not hit.is_empty():
			var c: Object = hit["collider"]
			if c != null and c.has_method("get_interact_prompt"):
				target = c
			elif c is Node and (c as Node).get_parent() != null and (c as Node).get_parent().has_method("get_interact_prompt"):
				target = (c as Node).get_parent()
		var text := String(target.call("get_interact_prompt", self)) if target != null else ""
		if text == "":
			target = null
		var hold := float(target.call("get_interact_hold_time")) if target != null and target.has_method("get_interact_hold_time") else 0.0
		_set_prompt(target, text, hold)
		if target == null:
			return
		if hold <= 0.0:
			if Input.is_action_just_pressed("interact"):
				target.call("interact", self)
		elif Input.is_action_pressed("interact"):
			_hold += delta
			Events.interaction_progress.emit(clampf(_hold / hold, 0.0, 1.0))
			if _hold >= hold:
				_hold = 0.0
				Events.interaction_progress.emit(-1.0)
				target.call("interact", self)
		elif _hold > 0.0:
			_hold = 0.0
			Events.interaction_progress.emit(-1.0)

	func _set_prompt(target: Object, text: String, hold := 0.0) -> void:
		if target != _target:
			_hold = 0.0
		_target = target
		if text != _prompt:
			_prompt = text
			Events.interaction_prompt.emit(text, hold)


# =============================================================================================== dev HUD

## Crosshair, interaction prompt with hold ring, and toast stack (Events.notification) — a stand-in for the HUD stream.
class DevHud extends CanvasLayer:
	var _prompt: Label
	var _toasts: VBoxContainer
	var _progress := -1.0
	var _dot: Control

	func _ready() -> void:
		layer = 10
		var root := Control.new()
		root.set_anchors_preset(Control.PRESET_FULL_RECT)
		root.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(root)
		_dot = Control.new()
		_dot.set_anchors_preset(Control.PRESET_CENTER)
		_dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_dot.draw.connect(_draw_dot)
		root.add_child(_dot)
		_prompt = InvStyle.label("", 22, InvStyle.TEXT, "Medium")
		_prompt.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
		_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
		_prompt.offset_top = -190
		_prompt.offset_bottom = -150
		_prompt.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
		_prompt.add_theme_constant_override("outline_size", 6)
		root.add_child(_prompt)
		_toasts = VBoxContainer.new()
		_toasts.position = Vector2(40, 40)
		_toasts.add_theme_constant_override("separation", 6)
		root.add_child(_toasts)
		Events.interaction_prompt.connect(_on_prompt)
		Events.interaction_progress.connect(func(t: float) -> void:
			_progress = t
			_dot.queue_redraw())
		Events.notification.connect(_on_notification)
		Events.ui_screen_opened.connect(func(_s: StringName) -> void: root.visible = false)
		Events.ui_screen_closed.connect(func(_s: StringName) -> void: root.visible = true)

	func _on_prompt(text: String, hold: float) -> void:
		_prompt.text = "" if text == "" else ("[E]  %s%s" % [text, "  (hold)" if hold > 0.0 else ""])

	func _draw_dot() -> void:
		_dot.draw_circle(Vector2.ZERO, 2.5, Color(1, 1, 1, 0.8))
		if _progress > 0.0:
			_dot.draw_arc(Vector2.ZERO, 16.0, -PI * 0.5, -PI * 0.5 + TAU * _progress, 40, InvStyle.ACCENT, 3.0, true)

	func _on_notification(text: String, kind: StringName) -> void:
		var pc := PanelContainer.new()
		var accent := InvStyle.ACCENT if kind == &"blueprint" else (InvStyle.BAD if kind == &"warning" else InvStyle.LINE_STRONG)
		pc.add_theme_stylebox_override("panel", InvStyle.panel(Color(0.05, 0.06, 0.07, 0.78), 5, accent, 1, 12))
		pc.add_child(InvStyle.label(text, 19, InvStyle.TEXT, "Medium"))
		_toasts.add_child(pc)
		while _toasts.get_child_count() > 5:
			_toasts.get_child(0).free()
		var tw := pc.create_tween()
		tw.tween_interval(3.5)
		tw.tween_property(pc, "modulate:a", 0.0, 0.6)
		tw.tween_callback(pc.queue_free)

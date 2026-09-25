class_name Player
extends CharacterBody3D
## First-person survival controller (CONTRACT §4). Weighty ground movement with inertia and surface grip,
## coyote time + jump buffer, step-up, slope sliding, deep snow, ice, carried weight, fall damage,
## swimming, ice-axe climbing, ladders, footsteps, interaction, hotbar/equipment and persistence.
##
## Scene: scenes/player/player.tscn. Yaw lives on this body, pitch on Head (PlayerCameraRig).

enum Move { GROUND, SWIM, CLIMB, LADDER, MANTLE }

const EQUIP_SLOTS: Array[StringName] = [&"head", &"face", &"body", &"legs", &"hands", &"feet", &"back",
	&"feet_addon", &"mask"]
const SLOT_ALIASES := {&"face": &"mask", &"feet": &"feet_addon"}
const HOTBAR_SIZE := 6
const BASE_SLOTS := 24
const BASE_WEIGHT := 30.0

const STAND_HEIGHT := 1.8
const CROUCH_HEIGHT := 1.15
const RADIUS := 0.3
const SWIM_ENTER_DEPTH := 1.32      # water above chest
const SWIM_EXIT_DEPTH := 1.12
const SWIM_FLOAT_DEPTH := 1.46      # feet below the surface while treading (eyes ~0.15 m above water)
const CLIMB_MIN_ANGLE := 60.0
const CLIMB_REACH := 0.95
const CLIMB_HOLD_DIST := 0.4
const INTERACT_MASK := 1 | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 9)
const BODY_MASK := 1 | (1 << 2) | (1 << 3) | (1 << 6) | (1 << 9)     # world, creatures, items, building, vegetation
const NON_BLOCKING_SCREENS: Array[StringName] = [&"build", &"hud"]
const HOTBAR_ACTIONS: Array[StringName] = [&"hotbar_1", &"hotbar_2", &"hotbar_3", &"hotbar_4", &"hotbar_5", &"hotbar_6"]
## Loose item pickups lighter than this (kg) don't block the body — you walk over sticks and stones instead
## of snagging on them. Heavier pickups (logs) and physics props (crates, felled logs) still collide.
const PASS_THROUGH_PICKUP_KG := 8.0

# ---- CONTRACT public state -------------------------------------------------------------------
var inventory: Inventory
var equipment: Dictionary = {}
var hotbar: Array[StringName] = []
var active_slot: int = -1
var vitals: Vitals
var is_swimming := false
var is_climbing := false
var is_crouching := false
var is_sprinting := false
var is_sheltered := 0.0

# ---- Extra public state (read by camera, viewmodel, HUD, tests) --------------------------------
var move_state: Move = Move.GROUND
var is_on_ladder := false
var is_sliding := false
var is_walking := false
var current_surface: StringName = &"grass"
var snow_depth := 0.0
var water_level := -INF
var water_depth := 0.0            # surface − feet (m), 0 when dry
var ground_speed := 0.0           # horizontal speed on the ground (m/s)
var stride_phase := 0.0           # radians; +π per step (footfall at multiples of π)
var breath_phase := 0.0
var breath_depth := 1.0
var shiver_amount := 0.0
var recent_exertion := 0.0        # 0..1 smoothed physical effort
var look_delta := Vector2.ZERO    # degrees this frame (viewmodel sway)
var speed_cap := INF              # held items can cap movement speed (bow drawn, eating…)
var look_scale := 1.0             # held items can slow look (binocular zoom)
var last_impact := 0.0
var air_time := 0.0
## True while build mode (or similar) owns the use/aim buttons — held items don't act.
var tool_blocked := false
## Smoothed / decaying-peak cost of this script's _physics_process (µs) — perf budget monitoring.
var perf_physics_us := 0.0
var perf_physics_peak_us := 0.0

# ---- Nodes -------------------------------------------------------------------------------------
@onready var head: PlayerCameraRig = $Head
@onready var camera: Camera3D = $Head/Shake/Camera3D
@onready var interactor: PlayerInteractor = $Head/InteractRay
@onready var melee_cast: ShapeCast3D = $Head/MeleeCast
@onready var viewmodel: Node3D = $Head/Shake/Camera3D/Viewmodel
@onready var collision: CollisionShape3D = $Collision
@onready var sounds: PlayerSounds = $Sounds
@onready var sensor: Area3D = $Sensor
@onready var foot_ray: RayCast3D = $FootRay
@onready var probes: Node3D = $Probes
@onready var climb_ray: RayCast3D = $Probes/ClimbRay
@onready var climb_ray_high: RayCast3D = $Probes/ClimbRayHigh
@onready var mantle_ray: RayCast3D = $Probes/MantleRay
@onready var ceiling_cast: ShapeCast3D = $CeilingCast

var _capsule: CapsuleShape3D
var _input_enabled := true
var _ui_screens: Array[StringName] = []
var _dead := false
var _gravity := PlayerMotion.GRAVITY

# input
var _move_input := Vector2.ZERO
var _wish_dir := Vector3.ZERO
var _jump_buffer := 0.0
var _coyote := 0.0
var _jumped := false
var _sprint_latched := false
var _walk_toggle := false
var _pad_active := false
var _look_accum := Vector2.ZERO
var _pad_turn_boost := 0.0

# settings cache
var _mouse_sens := 0.12
var _touch_sens := 0.22
var _pad_sens := 2.6
var _invert_y := false

# environment cache (sampled at 10 Hz / 4 Hz)
var _env_timer := 0.0
var _climate_timer := 0.0
var _surface_from_terrain := true
var _crampons := false
var _insulation := 0.0
var _windproof := 0.0
var _waterproof := 0.0
var _carried_weight := 0.0
var _weight_dirty := true
var _felt := 10.0

# movement internals
var _was_on_floor := true
var _floor_normal := Vector3.UP
var _step_dist := 0.0
var _last_step_side := 0
var _swim_stroke_t := 0.0
var _climb_normal := Vector3.BACK
var _climb_dist_acc := 0.0
var _ladder: Area3D = null
var _mantle_target := Vector3.ZERO
var _mantle_t := 0.0
var _ladder_step_acc := 0.0
var _exertion_target := 0.0
var _work_exertion := 0.0
var _water_volumes: Array[Area3D] = []
var _ladders: Array[Area3D] = []
var _near_bodies: Array[RigidBody3D] = []
var _pass_bodies: Array[RigidBody3D] = []
var _o2_timer := 0.0
var _phys_prev := Vector3.ZERO
var _phys_curr := Vector3.ZERO
var _own_interp := true
var _was_under := false
var _sleep_hours := 0.0

# motion test (step-up), preallocated
var _tm_params := PhysicsTestMotionParameters3D.new()
var _tm_result := PhysicsTestMotionResult3D.new()


func _init() -> void:
	inventory = Inventory.new(BASE_SLOTS, BASE_WEIGHT)
	hotbar.resize(HOTBAR_SIZE)
	hotbar.fill(&"")
	for s in EQUIP_SLOTS:
		equipment[s] = &""


func _ready() -> void:
	add_to_group(&"player")
	add_to_group(&"persistent")
	collision_layer = 1 << 1
	collision_mask = BODY_MASK
	floor_max_angle = deg_to_rad(51.0)
	floor_snap_length = 0.45
	floor_constant_speed = true
	floor_stop_on_slope = true
	floor_block_on_wall = true
	max_slides = 5
	safe_margin = 0.002
	vitals = get_node(^"Vitals") as Vitals
	_capsule = collision.shape as CapsuleShape3D
	head.player = self
	interactor.player = self
	sounds.player = self
	sounds.vapor = get_node_or_null(^"Head/Shake/BreathVapor") as CPUParticles3D
	if viewmodel and viewmodel.has_method(&"setup"):
		viewmodel.call(&"setup", self)
	vitals.died.connect(_on_died)
	inventory.changed.connect(_on_inventory_changed)
	sensor.area_entered.connect(_on_area_entered)
	sensor.area_exited.connect(_on_area_exited)
	sensor.body_entered.connect(_on_body_entered)
	sensor.body_exited.connect(_on_body_exited)
	Events.settings_changed.connect(_apply_settings)
	Events.ui_screen_opened.connect(_on_ui_opened)
	Events.ui_screen_closed.connect(_on_ui_closed)
	Events.item_picked_up.connect(_on_item_picked_up)
	Events.item_crafted.connect(_on_item_picked_up)
	Events.sleep_started.connect(_on_sleep_started)
	Events.sleep_ended.connect(_on_sleep_ended)
	Events.cinematic_started.connect(_on_cinematic_started)
	Events.cinematic_ended.connect(_on_cinematic_ended)
	_tm_params.margin = safe_margin
	_tm_params.recovery_as_collision = false
	_ensure_walk_action()
	_apply_settings()
	_recalc_gear()
	_own_interp = not get_tree().physics_interpolation
	_phys_prev = global_position
	_phys_curr = global_position
	Game.register_player(self)
	if not Settings.is_mobile() and not DisplayServer.get_name().begins_with("headless"):
		_capture_mouse(true)


func _exit_tree() -> void:
	if Game.player == self:
		Game.player = null


# =================================================================================================
# CONTRACT API
# =================================================================================================

func get_camera() -> Camera3D:
	return camera


func get_eye_position() -> Vector3:
	return camera.global_position if camera else global_position + Vector3(0.0, PlayerCameraRig.STAND_EYE, 0.0)


func get_look_direction() -> Vector3:
	return -head.global_transform.basis.z


func teleport(pos: Vector3, yaw_deg := 0.0) -> void:
	global_position = pos
	rotation = Vector3(0.0, deg_to_rad(yaw_deg), 0.0)
	velocity = Vector3.ZERO
	_phys_prev = pos
	_phys_curr = pos
	_was_on_floor = false
	air_time = 0.0
	_set_move_state(Move.GROUND)
	head.reset_smoothing()
	if is_inside_tree():
		reset_physics_interpolation()
		force_update_transform()


func set_input_enabled(enabled: bool) -> void:
	_input_enabled = enabled
	if not enabled:
		_move_input = Vector2.ZERO
		_wish_dir = Vector3.ZERO
		_sprint_latched = false
		interactor.clear()


func is_input_enabled() -> bool:
	return _input_enabled and _ui_screens.is_empty() and not _dead and Game.state != Game.State.CINEMATIC


func get_active_item() -> StringName:
	if active_slot < 0 or active_slot >= hotbar.size():
		return &""
	var id := hotbar[active_slot]
	if id == &"" or not inventory.has(id):
		return &""
	return id


## Selects hotbar slot `index` (selecting the active slot again, or -1, empties the hands).
func select_hotbar(index: int) -> void:
	var prev := get_active_item()
	if index == active_slot or index < 0 or index >= HOTBAR_SIZE:
		active_slot = -1
	else:
		active_slot = index
	var now := get_active_item()
	if now != prev:
		Events.active_item_changed.emit(now)
		Audio.play_sfx(&"equip", null, -8.0)
		if viewmodel and viewmodel.has_method(&"set_item"):
			viewmodel.call(&"set_item", now)


func equip(id: StringName) -> bool:
	var def: Dictionary = ItemDB.get_item(id)
	if def.is_empty():
		return false
	var slot := _equip_slot_for(def)
	if slot == &"" or slot == &"hand":
		if not inventory.has(id):
			return false
		var idx := hotbar.find(id)
		if idx < 0:
			idx = hotbar.find(&"")
		if idx < 0:
			idx = maxi(active_slot, 0)
		var prev := get_active_item()
		hotbar[idx] = id
		if active_slot != idx:
			select_hotbar(idx)
		elif get_active_item() != prev:
			Events.active_item_changed.emit(id)
			Audio.play_sfx(&"equip", null, -8.0)
			if viewmodel and viewmodel.has_method(&"set_item"):
				viewmodel.call(&"set_item", id)
		return true
	if not inventory.has(id):
		return false
	inventory.remove(id, 1)
	var prev: StringName = equipment.get(slot, &"")
	equipment[slot] = id
	if prev != &"" and inventory.add(prev, 1) > 0:
		_drop_to_world(prev, 1)
	_recalc_gear()
	Events.equipment_changed.emit(slot, id)
	Audio.play_sfx(&"equip", null, -4.0)
	return true


func unequip(slot: StringName) -> void:
	var id: StringName = equipment.get(slot, &"")
	# UI written against the data's equip_slot ("face" O2 mask, "feet" crampons) reaches the add-on slots.
	if id == &"" and SLOT_ALIASES.has(slot):
		slot = SLOT_ALIASES[slot]
		id = equipment.get(slot, &"")
	if id == &"":
		if slot == &"hand":
			select_hotbar(-1)
		return
	if inventory.add(id, 1) > 0:
		Game.notify("No room in your pack", &"warning")
		return
	equipment[slot] = &""
	_recalc_gear()
	Events.equipment_changed.emit(slot, &"")
	Audio.play_sfx(&"equip", null, -6.0)


func get_insulation() -> float:
	return _insulation


func get_windproof() -> float:
	return _windproof


func has_gear(tag: StringName) -> bool:
	var t := String(tag)
	for slot in EQUIP_SLOTS:
		var id: StringName = equipment.get(slot, &"")
		if id != &"" and _item_has_gear(id, t):
			return true
	var act := get_active_item()
	if act != &"" and (act == tag or _item_has_gear(act, t)):
		return true
	# Carried tools count for axe-and-rope style gear (you draw them when needed).
	if tag == &"ice_axe" or tag == &"rope":
		for s in inventory.slots:
			if not s.is_empty():
				var sid: StringName = s["id"]
				if sid == tag or (tag == &"rope" and sid == &"climbing_rope") or _item_has_gear(sid, t):
					return true
				if tag == &"ice_axe" and _tool_type(sid) == &"ice_axe":
					return true
	return false


func take_damage(amount: float, type: StringName, source: Node = null, hit_position := Vector3.ZERO) -> void:
	if _dead or amount <= 0.0:
		return
	var dmg := amount
	# Thick clothing blunts bites and claws a little.
	if type == &"bite" or type == &"claw" or type == &"cut":
		dmg *= clampf(1.0 - _insulation * 0.008, 0.75, 1.0)
	var dealt := vitals.apply_damage(dmg, type)
	Events.player_damaged.emit(dealt, type, source)
	head.add_trauma(clampf(dealt / 30.0, 0.12, 0.85))
	if type != &"cold" and type != &"hunger" and type != &"thirst" and type != &"hypoxia" and type != &"bleed":
		if dealt >= 1.0:
			Audio.play_sfx(&"hurt", null, lerpf(-8.0, 0.0, clampf(dealt / 30.0, 0.0, 1.0)))
	if (type == &"bite" or type == &"claw" or type == &"cut") and dealt >= 8.0:
		vitals.add_effect(&"bleeding", float(Vitals.TUNING[&"bleed_duration"]), clampf(dealt / 30.0, 0.35, 1.0))
	if hit_position != Vector3.ZERO and viewmodel and viewmodel.has_method(&"hit_reaction"):
		viewmodel.call(&"hit_reaction", (hit_position - global_position).normalized())


func heal(amount: float) -> void:
	vitals.heal(amount)


# =================================================================================================
# Extra public API
# =================================================================================================

func is_dead() -> bool:
	return _dead


func is_grounded() -> bool:
	return move_state == Move.GROUND and _was_on_floor


func has_crampons() -> bool:
	return _crampons


func add_trauma(amount: float) -> void:
	head.add_trauma(amount)


## Sets the view direction directly (degrees; yaw 0 = north/−Z, +pitch = up). Used by tests/cinematics.
func set_look(yaw_deg: float, pitch_deg: float) -> void:
	rotation.y = deg_to_rad(yaw_deg)
	head.pitch = clampf(deg_to_rad(pitch_deg), -PlayerCameraRig.MAX_PITCH, PlayerCameraRig.MAX_PITCH)
	head.rotation.x = head.pitch


func get_yaw_deg() -> float:
	return rad_to_deg(rotation.y)


func get_pitch_deg() -> float:
	return rad_to_deg(head.pitch)


func get_local_velocity() -> Vector3:
	return velocity.rotated(Vector3.UP, -rotation.y)


func get_carried_weight() -> float:
	if _weight_dirty:
		_carried_weight = inventory.total_weight()
		_weight_dirty = false
	return _carried_weight


## Tools report physical effort (0..1 per action) — feeds food/water burn and breathing.
func exert(amount: float) -> void:
	_work_exertion = clampf(_work_exertion + amount, 0.0, 1.0)


## Assigns an item id (or &"") to a hotbar slot (UI drag & drop).
func set_hotbar_slot(index: int, id: StringName) -> void:
	if index < 0 or index >= HOTBAR_SIZE:
		return
	var was_active := index == active_slot
	var prev := get_active_item()
	var dup := hotbar.find(id)
	if id != &"" and dup >= 0 and dup != index:
		hotbar[dup] = &""
	hotbar[index] = id
	if was_active and get_active_item() != prev:
		Events.active_item_changed.emit(get_active_item())
		if viewmodel and viewmodel.has_method(&"set_item"):
			viewmodel.call(&"set_item", get_active_item())


## Equipment slot an item would go into (&"hand" for tools). Besides the CONTRACT slots, crampons strap
## over boots into &"feet_addon" and an O2 mask goes into &"mask" so it can be worn with goggles.
func get_equip_slot(id: StringName) -> StringName:
	return _equip_slot_for(ItemDB.get_item(id))


## Slot currently holding `id`, or &"" if it isn't worn.
func find_equipped(id: StringName) -> StringName:
	for s in EQUIP_SLOTS:
		if equipment.get(s, &"") == id:
			return s
	return &""


## Inventory slot index of the active item (for durability), -1 if none.
func get_active_inventory_index() -> int:
	var id := get_active_item()
	return inventory.find(id) if id != &"" else -1


## Drops one of the active item in front of the player (needs scenes/items/pickup.tscn).
func drop_active_item() -> void:
	var id := get_active_item()
	if id == &"":
		return
	var idx := inventory.find(id)
	if idx < 0:
		return
	var st := inventory.remove_at(idx, 1)
	if st.is_empty():
		return
	_drop_to_world(id, 1, float(st.get("durability", 1.0)), ItemActions.stack_extra(st))
	Events.item_dropped.emit(id, 1)
	Audio.play_sfx(&"drop", global_position)


func respawn(pos: Vector3, yaw_deg := 0.0) -> void:
	_dead = false
	vitals.revive(true)
	head.reset_death()
	teleport(pos, yaw_deg)
	set_input_enabled(true)
	if viewmodel:
		viewmodel.visible = true
	Events.player_respawned.emit()


# =================================================================================================
# Input
# =================================================================================================

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and is_input_enabled():
			var rel := (event as InputEventMouseMotion).screen_relative
			_look_accum += rel * _mouse_sens
		return
	if event is InputEventJoypadButton or event is InputEventJoypadMotion:
		if event is InputEventJoypadMotion and absf((event as InputEventJoypadMotion).axis_value) < 0.3:
			return
		_pad_active = true
	elif event is InputEventKey or event is InputEventMouseButton:
		_pad_active = false
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and _ui_screens.is_empty() and not Settings.is_mobile():
			_capture_mouse(true)
			get_viewport().set_input_as_handled()
			return


## Discrete actions are polled (touch controls inject them with Input.action_press, which sends no events).
func _poll_actions() -> void:
	for i in HOTBAR_SIZE:
		if Input.is_action_just_pressed(HOTBAR_ACTIONS[i]):
			select_hotbar(i)
			return
	if Input.is_action_just_pressed(&"hotbar_next"):
		_cycle_hotbar(1)
	elif Input.is_action_just_pressed(&"hotbar_prev"):
		_cycle_hotbar(-1)
	elif Input.is_action_just_pressed(&"drop"):
		drop_active_item()
	elif Input.is_action_just_pressed(&"walk"):
		_walk_toggle = not _walk_toggle


func _process(delta: float) -> void:
	if is_input_enabled():
		_poll_actions()
	# Look (render rate for responsiveness).
	var look := Vector2.ZERO
	if is_input_enabled():
		look = _look_accum
		look += TouchLook.consume() * _touch_sens
		var pad := Input.get_vector(&"look_left", &"look_right", &"look_up", &"look_down")
		if pad.length_squared() > 0.0:
			var curved := PlayerMotion.pad_curve(pad, 1.8)
			# Turn acceleration at full deflection (easier 180s on a stick).
			if absf(pad.x) > 0.92:
				_pad_turn_boost = minf(_pad_turn_boost + delta * 1.6, 0.7)
			else:
				_pad_turn_boost = 0.0
			var rate := _pad_sens * 62.0
			look += Vector2(curved.x * (1.0 + _pad_turn_boost), curved.y) * rate * delta
		else:
			_pad_turn_boost = 0.0
	else:
		TouchLook.consume()
	_look_accum = Vector2.ZERO
	look *= look_scale
	if _invert_y:
		look.y = -look.y
	look_delta = look
	if look != Vector2.ZERO and not _dead:
		rotation.y -= deg_to_rad(look.x)
		head.add_pitch(-deg_to_rad(look.y))
	# Render-rate interpolation of the 60 Hz body.
	var off := Vector3.ZERO
	if _own_interp:
		var f := Engine.get_physics_interpolation_fraction()
		var p := _phys_prev.lerp(_phys_curr, f)
		off = (p - global_position).rotated(Vector3.UP, -rotation.y)
	head.update_rig(delta, off)
	RenderingServer.global_shader_parameter_set(&"player_position", global_position)


func _gather_input(delta: float) -> void:
	_jump_buffer = maxf(_jump_buffer - delta, 0.0)
	if not is_input_enabled():
		_move_input = Vector2.ZERO
		_wish_dir = Vector3.ZERO
		return
	_move_input = Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	var local := Vector3(_move_input.x, 0.0, _move_input.y)
	_wish_dir = local.rotated(Vector3.UP, rotation.y)
	if Input.is_action_just_pressed(&"jump"):
		_jump_buffer = PlayerMotion.JUMP_BUFFER
	if Input.is_action_just_pressed(&"crouch") and move_state == Move.GROUND:
		_set_crouch(not is_crouching)
	if Input.is_action_just_pressed(&"sprint") and _pad_active:
		_sprint_latched = true
	if _move_input.length_squared() < 0.04:
		_sprint_latched = false


# =================================================================================================
# Physics
# =================================================================================================

func _physics_process(delta: float) -> void:
	var t0 := Time.get_ticks_usec()
	_physics_step(delta)
	var us := float(Time.get_ticks_usec() - t0)
	perf_physics_us = lerpf(perf_physics_us, us, 0.02)
	perf_physics_peak_us = maxf(perf_physics_peak_us * 0.999, us)


func _physics_step(delta: float) -> void:
	_phys_prev = _phys_curr
	if _dead:
		_physics_dead(delta)
		_phys_curr = global_position
		return
	_gather_input(delta)
	_env_timer -= delta
	if _env_timer <= 0.0:
		_env_timer = 0.1
		_sample_ground()
		_sample_water_level()
		_check_fell_through()
	water_depth = maxf(water_level - global_position.y, 0.0) if water_level > -1e20 else 0.0
	_update_water_state()
	match move_state:
		Move.GROUND:
			_physics_ground(delta)
		Move.SWIM:
			_physics_swim(delta)
		Move.CLIMB:
			_physics_climb(delta)
		Move.LADDER:
			_physics_ladder(delta)
		Move.MANTLE:
			_physics_mantle(delta)
	_update_stride(delta)
	_update_exertion(delta)
	_climate_timer -= delta
	if _climate_timer <= 0.0:
		_climate_timer = 0.25
		_sample_climate(0.25)
	_feed_vitals()
	interactor.tick(delta, is_input_enabled())
	sounds.tick(delta)
	_phys_curr = global_position


func _physics_dead(delta: float) -> void:
	velocity.x = move_toward(velocity.x, 0.0, 6.0 * delta)
	velocity.z = move_toward(velocity.z, 0.0, 6.0 * delta)
	if move_state == Move.SWIM or water_depth > SWIM_ENTER_DEPTH:
		velocity.y = move_toward(velocity.y, -0.4, 2.0 * delta)
	elif not is_on_floor():
		velocity.y = maxf(velocity.y - _gravity * delta, -PlayerMotion.TERMINAL_SPEED)
	move_and_slide()


# ---- Ground / air ------------------------------------------------------------------------------

func _physics_ground(delta: float) -> void:
	var on_floor := is_on_floor()
	if on_floor:
		_coyote = PlayerMotion.COYOTE_TIME
		air_time = 0.0
		_jumped = false
	else:
		_coyote = maxf(_coyote - delta, 0.0)
		air_time += delta
	# Contact normal: floor, or a steep slope we are pressed against.
	var n := Vector3.UP
	var contact := false
	if on_floor:
		n = get_floor_normal()
		contact = true
	elif is_on_wall():
		var wn := get_wall_normal()
		if wn.y > 0.17:
			n = wn
			contact = true
	_floor_normal = n
	var slope := rad_to_deg(acos(clampf(n.y, -1.0, 1.0)))
	var limit := PlayerMotion.surface_slide_limit_deg(current_surface, _crampons)
	is_sliding = contact and slope > limit and not (_jumped and velocity.y > 0.0)
	# Ladders and climbing take over from here.
	if not _ladders.is_empty() and _try_attach_ladder():
		return
	if _jump_buffer > 0.0 and not on_floor and try_start_climb():
		return
	# Target speed.
	var target := _compute_target_velocity(on_floor, n, slope)
	if is_sliding:
		_apply_slide(delta, n, slope, target, on_floor)
	elif on_floor:
		var h := Vector3(velocity.x, 0.0, velocity.z)
		var grip := PlayerMotion.surface_grip(current_surface, _crampons)
		var accel := (PlayerMotion.ACCEL_SPRINT if is_sprinting else PlayerMotion.ACCEL) * grip
		var decel := PlayerMotion.DECEL * grip
		h = PlayerMotion.approach(h, target, accel, decel, delta)
		velocity.x = h.x
		velocity.z = h.z
		velocity.y = minf(velocity.y, 0.0)
	else:
		var h := Vector3(velocity.x, 0.0, velocity.z)
		# Minimal air control: only nudge, never brake hard.
		var nudged := h.move_toward(target, PlayerMotion.AIR_ACCEL * delta)
		if nudged.length() > h.length() and h.length() > target.length():
			nudged = nudged.limit_length(h.length())
		velocity.x = nudged.x
		velocity.z = nudged.z
		velocity.y = maxf(velocity.y - _gravity * delta, -PlayerMotion.TERMINAL_SPEED)
	# Jump (buffered, coyote). Pressing jump in front of a steep face with an ice axe grabs it instead.
	if _jump_buffer > 0.0 and is_input_enabled():
		if on_floor and try_start_climb():
			return
		if _coyote > 0.0 and not _jumped and (not is_sliding or slope < limit + 12.0):
			_do_jump()
	# Step up small ledges (rocks, stairs).
	if on_floor and not is_sliding and not _jumped:
		_try_step_up(delta, target)
	floor_snap_length = 0.45 if (on_floor and not _jumped and velocity.y <= 0.05) else 0.0
	var pre_vel := velocity
	move_and_slide()
	var now_floor := is_on_floor()
	if now_floor and not _was_on_floor:
		_on_landed(maxf(0.0, -pre_vel.dot(get_floor_normal())))
	_was_on_floor = now_floor
	if not _near_bodies.is_empty():
		_push_bodies()


func _compute_target_velocity(on_floor: bool, n: Vector3, slope: float) -> Vector3:
	var mag := minf(_move_input.length(), 1.0)
	is_walking = false
	var want_sprint := (Input.is_action_pressed(&"sprint") or _sprint_latched) and is_input_enabled()
	var forward := _move_input.y < -0.35
	var can_sprint := vitals.can_sprint() and not is_crouching and forward and speed_cap > PlayerMotion.JOG_SPEED \
		and get_carried_weight() < inventory.max_weight * 1.25 and water_depth < 0.7
	is_sprinting = want_sprint and can_sprint and mag > 0.5 and (on_floor or is_sprinting)
	if want_sprint and is_crouching and forward:
		_set_crouch(false)
	var speed: float
	if is_crouching:
		speed = PlayerMotion.CROUCH_SPEED
	elif is_sprinting:
		speed = PlayerMotion.SPRINT_SPEED
	elif mag < 0.55 or _walk_toggle:
		is_walking = true
		speed = PlayerMotion.WALK_SPEED * (clampf(mag / 0.55, 0.35, 1.0) if not _walk_toggle else 1.0)
	else:
		speed = PlayerMotion.JOG_SPEED
	if mag < 0.05:
		return Vector3.ZERO
	var mult := vitals.movement_multiplier()
	mult *= PlayerMotion.weight_speed_factor(get_carried_weight(), inventory.max_weight)
	if snow_depth > 0.0:
		mult *= PlayerMotion.snow_speed_factor(snow_depth)
	mult *= PlayerMotion.wading_factor(water_depth)
	if _move_input.y > 0.3:
		mult *= 0.72   # backpedalling
	var dir := _wish_dir.normalized()
	if on_floor and slope > 3.0:
		var uphill := Vector3(-n.x, 0.0, -n.z)
		if uphill.length_squared() > 1e-6:
			uphill = uphill.normalized()
			mult *= PlayerMotion.slope_speed_factor(slope, dir.dot(uphill))
	speed = minf(speed * mult, speed_cap)
	return dir * speed


func _apply_slide(delta: float, n: Vector3, slope: float, target: Vector3, on_floor: bool) -> void:
	var down := Vector3.DOWN - n * n.dot(Vector3.DOWN)
	if down.length_squared() < 1e-6:
		return
	down = down.normalized()
	var down_h := Vector3(down.x, 0.0, down.z)
	if down_h.length_squared() < 1e-6:
		return
	down_h = down_h.normalized()
	var a := PlayerMotion.slide_accel(slope, PlayerMotion.surface_friction(current_surface), _gravity)
	# You can steer sideways a little but never up the slope.
	var steer := target
	var up_part := steer.dot(-down_h)
	if up_part > 0.0:
		steer += down_h * up_part
	steer = steer.limit_length(1.0) * 1.8 * delta
	if on_floor:
		# On a "floor" slope the body keeps horizontal velocity and floor_constant_speed maps it along the
		# surface, so integrate the slide horizontally (Godot drops vertical velocity on floors).
		var h := Vector3(velocity.x, 0.0, velocity.z)
		h += down_h * a * delta + steer
		var lateral := h - down_h * h.dot(down_h)
		h -= lateral * minf(1.6 * delta, 1.0)
		h = h.limit_length(PlayerMotion.SLIDE_MAX_SPEED)
		velocity = Vector3(h.x, 0.0, h.z)
	else:
		# Pressed against a face steeper than floor_max_angle: slide along it with kinetic friction.
		var v := velocity - n * velocity.dot(n)
		v += down * a * delta + steer
		var lat := v - down * v.dot(down)
		v -= lat * minf(1.6 * delta, 1.0)
		velocity = v.limit_length(PlayerMotion.SLIDE_MAX_SPEED) - n * 0.5


func _do_jump() -> void:
	if is_crouching:
		if not _set_crouch(false):
			return
	var cost := 5.0
	if not vitals.use_stamina(cost):
		if vitals.stamina < 1.0:
			return
		vitals.drain_stamina(cost)
	var jf := PlayerMotion.weight_speed_factor(get_carried_weight(), inventory.max_weight)
	var jv := PlayerMotion.jump_velocity(PlayerMotion.JUMP_HEIGHT * lerpf(0.5, 1.0, jf))
	if vitals.has_effect(&"sprain"):
		jv *= 0.8
	velocity.y = jv
	_jumped = true
	_coyote = 0.0
	_jump_buffer = 0.0
	_was_on_floor = false
	floor_snap_length = 0.0
	sounds.jump(global_position)
	exert(0.25)


func _on_landed(impact: float) -> void:
	last_impact = impact
	_sample_ground()
	var surface := current_surface
	var eff := impact
	if surface == &"snow":
		eff *= 1.0 - 0.28 * snow_depth
	if water_depth > 1.0:
		eff *= 0.2
	Events.player_landed.emit(impact, surface)
	head.land(impact)
	sounds.land(impact, surface, global_position)
	if viewmodel and viewmodel.has_method(&"land"):
		viewmodel.call(&"land", impact)
	var dmg := PlayerMotion.fall_damage(eff)
	if dmg > 0.0:
		take_damage(dmg, &"fall")
		if eff > PlayerMotion.SPRAIN_IMPACT and not _dead:
			var st := clampf((eff - PlayerMotion.SPRAIN_IMPACT) / 4.0, 0.3, 1.0)
			vitals.add_effect(&"sprain", float(Vitals.TUNING[&"sprain_duration"]) * (0.6 + st), st)
	# A proper footfall on landing.
	if impact > 1.2:
		_step_dist = 0.0


func _try_step_up(delta: float, intended: Vector3) -> void:
	# Probe along the *intended* motion: when pressed against a step the real velocity is ~0.
	if intended.length_squared() < 0.04:
		return
	var dir := intended.normalized()
	var probe := dir * maxf(intended.length() * delta, 0.1)
	var xf := global_transform
	if not _test_motion(xf, probe):
		return
	var n := _tm_result.get_collision_normal()
	if n.y > cos(floor_max_angle):
		return   # walkable ramp, not a step
	var up := Vector3(0.0, PlayerMotion.STEP_HEIGHT + 0.02, 0.0)
	var up_travel := up
	if _test_motion(xf, up):
		up_travel = _tm_result.get_travel()
	if up_travel.y < 0.05:
		return
	var xf_up := xf.translated(up_travel)
	if _test_motion(xf_up, probe):
		return   # still blocked when raised: too tall
	var xf_fwd := xf_up.translated(probe)
	if not _test_motion(xf_fwd, Vector3(0.0, -up_travel.y - 0.02, 0.0)):
		return
	var fn := _tm_result.get_collision_normal()
	if fn.y < cos(floor_max_angle):
		return
	var down_travel := _tm_result.get_travel()
	var step_h := up_travel.y + down_travel.y
	if step_h < 0.03 or step_h > PlayerMotion.STEP_HEIGHT + 0.02:
		return
	global_position = xf_fwd.origin + down_travel
	head.step_up(step_h)
	_was_on_floor = true


func _test_motion(from: Transform3D, motion: Vector3) -> bool:
	_tm_params.from = from
	_tm_params.motion = motion
	return PhysicsServer3D.body_test_motion(get_rid(), _tm_params, _tm_result)


func _push_bodies() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var rb := c.get_collider() as RigidBody3D
		if rb == null or rb.freeze:
			continue
		var push := -c.get_normal()
		push.y = 0.0
		var strength := clampf(velocity.length() * 0.9, 0.0, 6.0) * clampf(60.0 / maxf(rb.mass, 1.0), 0.05, 1.0)
		rb.apply_impulse(push * strength * rb.mass * 0.02, c.get_position() - rb.global_position)


func _set_crouch(on: bool) -> bool:
	if on == is_crouching:
		return true
	if not on:
		ceiling_cast.force_shapecast_update()
		if ceiling_cast.is_colliding():
			return false
	is_crouching = on
	var h := CROUCH_HEIGHT if on else STAND_HEIGHT
	_capsule.height = h
	collision.position.y = h * 0.5
	if on:
		_sprint_latched = false
	return true


# ---- Water -------------------------------------------------------------------------------------

func _sample_water_level() -> void:
	var lvl := TerrainData.get_water_level(global_position.x, global_position.z)
	for a in _water_volumes:
		if is_instance_valid(a):
			lvl = maxf(lvl, _volume_surface(a))
	water_level = lvl


static func _volume_surface(a: Area3D) -> float:
	if a.has_method(&"get_water_surface"):
		return float(a.call(&"get_water_surface"))
	if a.has_meta(&"water_level"):
		return float(a.get_meta(&"water_level"))
	for c in a.get_children():
		var cs := c as CollisionShape3D
		if cs and cs.shape is BoxShape3D:
			return cs.global_position.y + (cs.shape as BoxShape3D).size.y * 0.5 * cs.global_basis.get_scale().y
	return a.global_position.y


func _update_water_state() -> void:
	if move_state == Move.SWIM:
		if water_depth < SWIM_EXIT_DEPTH and (is_on_floor() or water_depth < 0.9):
			_set_move_state(Move.GROUND)
	elif water_depth > SWIM_ENTER_DEPTH and move_state != Move.MANTLE:
		if velocity.y < -3.0:
			sounds.splash(global_position + Vector3(0.0, water_depth, 0.0), clampf(-velocity.y / 12.0, 0.2, 1.0))
		if move_state == Move.CLIMB or move_state == Move.LADDER:
			_detach()
		_set_crouch(false)
		_set_move_state(Move.SWIM)


func _physics_swim(delta: float) -> void:
	var exhausted := not vitals.can_exert()
	var pitch_deg := rad_to_deg(head.pitch)
	var fast := (Input.is_action_pressed(&"sprint") or _sprint_latched) and not exhausted and is_input_enabled()
	var spd := PlayerMotion.SWIM_FAST_SPEED if fast else PlayerMotion.SWIM_SPEED
	spd *= vitals.movement_multiplier() * PlayerMotion.weight_speed_factor(get_carried_weight(), inventory.max_weight)
	if exhausted:
		spd *= 0.45
	var dir := _wish_dir.normalized() if _wish_dir.length_squared() > 0.01 else Vector3.ZERO
	var target := dir * spd
	# Dive along the view when looking steeply down while swimming forward.
	var diving := _move_input.y < -0.3 and pitch_deg < -35.0 and not exhausted
	var h := Vector3(velocity.x, 0.0, velocity.z)
	h = h.move_toward(target, PlayerMotion.SWIM_ACCEL * delta)
	h *= 1.0 - minf(PlayerMotion.SWIM_DRAG * 0.25 * delta, 0.2)
	velocity.x = h.x
	velocity.z = h.z
	var float_y := water_level - SWIM_FLOAT_DEPTH
	if exhausted:
		float_y -= 0.42   # too tired to keep your head up
	if diving:
		velocity.y = move_toward(velocity.y, sin(head.pitch) * spd, 2.5 * delta)
	else:
		var ay := PlayerMotion.buoyancy_accel(global_position.y, float_y, velocity.y)
		if _jump_buffer > 0.0 and not exhausted and global_position.y > float_y - 0.5:
			velocity.y += 2.2
			_jump_buffer = 0.0
			vitals.drain_stamina(4.0)
		velocity.y += ay * delta
	velocity.y = clampf(velocity.y, -3.0, 3.5)
	floor_snap_length = 0.0
	move_and_slide()
	_was_on_floor = is_on_floor()
	# Strokes.
	var moving := h.length() > 0.25
	if moving or diving:
		_swim_stroke_t -= delta
		if _swim_stroke_t <= 0.0:
			_swim_stroke_t = 0.85 if fast else 1.25
			sounds.swim_stroke(global_position + Vector3(0.0, water_depth, 0.0), fast)
	# Stamina: treading water is work, glacial water is worse.
	var drain := 0.7
	if moving:
		drain = 6.5 if fast else 2.8
	vitals.drain_stamina(drain * delta)
	# Climb out onto steep banks with the ice axe.
	if _jump_buffer > 0.0 and try_start_climb():
		return


# ---- Climbing ----------------------------------------------------------------------------------

func _can_climb() -> bool:
	return has_gear(&"ice_axe") and vitals.can_exert() and not is_crouching


## Attempts to latch onto a steep face (> 60°) in front of the chest. Returns true on success.
func try_start_climb() -> bool:
	if not _can_climb() or move_state == Move.CLIMB or move_state == Move.MANTLE:
		return false
	probes.rotation = Vector3.ZERO
	climb_ray.force_raycast_update()
	if not climb_ray.is_colliding():
		return false
	var n := climb_ray.get_collision_normal()
	var angle := rad_to_deg(acos(clampf(n.y, -1.0, 1.0)))
	if angle < CLIMB_MIN_ANGLE:
		return false
	if climb_ray.get_collider() is RigidBody3D:
		return false
	_climb_normal = n
	_jump_buffer = 0.0
	_set_move_state(Move.CLIMB)
	velocity = Vector3.ZERO
	vitals.use_stamina(3.0)
	sounds.climb_grab(get_eye_position())
	head.add_trauma(0.12)
	# Draw the ice axe if it isn't in hand.
	if _tool_type(get_active_item()) != &"ice_axe":
		for i in HOTBAR_SIZE:
			if _tool_type(hotbar[i]) == &"ice_axe" and inventory.has(hotbar[i]):
				select_hotbar(i)
				break
	return true


func _physics_climb(delta: float) -> void:
	climb_ray.force_raycast_update()
	climb_ray_high.force_raycast_update()
	var chest_hit := climb_ray.is_colliding()
	var head_hit := climb_ray_high.is_colliding()
	var up_in := -_move_input.y
	if not chest_hit:
		if up_in > 0.2 and _try_mantle():
			return
		_detach()
		return
	var n := climb_ray.get_collision_normal()
	var ang := rad_to_deg(acos(clampf(n.y, -1.0, 1.0)))
	if ang < 40.0:
		# The face flattened out — stand up on it.
		_detach()
		return
	_climb_normal = _climb_normal.lerp(n, minf(12.0 * delta, 1.0)).normalized()
	var cn := _climb_normal
	# Keep the probes facing the wall whatever way the player looks.
	var face := Vector3(-cn.x, 0.0, -cn.z)
	if face.length_squared() > 1e-4:
		probes.global_basis = Basis.looking_at(face.normalized(), Vector3.UP)
	var up_s := Vector3.UP - cn * cn.dot(Vector3.UP)
	if up_s.length_squared() < 1e-5:
		up_s = Vector3.UP
	up_s = up_s.normalized()
	var right_s := up_s.cross(cn).normalized()
	var spd := PlayerMotion.CLIMB_SPEED_CRAMPONS if _crampons else PlayerMotion.CLIMB_SPEED
	spd *= vitals.movement_multiplier() * PlayerMotion.weight_speed_factor(get_carried_weight(), inventory.max_weight)
	var side_in := _move_input.x
	if not head_hit and up_in > 0.0:
		# Top edge at chest height: try to haul over it.
		if _try_mantle():
			return
	var move := up_s * up_in * spd + right_s * side_in * spd * 0.75
	var dist := climb_ray.global_position.distance_to(climb_ray.get_collision_point())
	# Stay close to the face: a horizontal, capped pull (a pull along −normal would fight the climb).
	var hold := clampf((dist - CLIMB_HOLD_DIST) * 6.0, -0.4, 0.5)
	velocity = move + face.normalized() * hold if face.length_squared() > 1e-4 else move
	floor_snap_length = 0.0
	var before := global_position
	move_and_slide()
	var moved := global_position.distance_to(before)
	_climb_dist_acc += moved
	if _climb_dist_acc > 0.42:
		_climb_dist_acc = 0.0
		sounds.climb_grab(get_eye_position())
		if viewmodel and viewmodel.has_method(&"climb_swing"):
			viewmodel.call(&"climb_swing")
		exert(0.35)
	# Stamina: hanging costs, moving costs more; crampons take weight off the arms.
	var drain := 5.5 if moved > 0.002 else 1.8
	if _crampons:
		drain *= 0.62
	if not vitals.drain_stamina(drain * delta):
		Game.notify("Too exhausted to hold on", &"warning")
		_detach()
		return
	if not is_input_enabled():
		return
	if _jump_buffer > 0.0:
		_jump_buffer = 0.0
		_detach()
		velocity = cn * 2.6 + Vector3.UP * 2.2
		return
	if Input.is_action_just_pressed(&"crouch"):
		_detach()
		return
	if is_on_floor() and up_in < -0.2:
		_detach()


func _try_mantle() -> bool:
	# Probe down from above-and-ahead of the chest for a standable top.
	mantle_ray.force_raycast_update()
	if not mantle_ray.is_colliding():
		return false
	var n := mantle_ray.get_collision_normal()
	if n.y < 0.7:
		return false
	var p := mantle_ray.get_collision_point()
	if p.y - global_position.y > 2.3:
		return false
	_mantle_target = p + Vector3(0.0, 0.05, 0.0)
	_mantle_t = 0.0
	_set_move_state(Move.MANTLE)
	sounds.climb_grab(get_eye_position())
	vitals.use_stamina(4.0)
	exert(0.5)
	return true


func _physics_mantle(delta: float) -> void:
	_mantle_t += delta
	var to := _mantle_target - global_position
	if global_position.y < _mantle_target.y:
		velocity = Vector3(0.0, 2.4, 0.0) + Vector3(to.x, 0.0, to.z).limit_length(0.3)
	else:
		velocity = Vector3(to.x, 0.0, to.z).normalized() * 1.8 + Vector3(0.0, 0.2, 0.0)
	floor_snap_length = 0.0
	move_and_slide()
	var flat := Vector2(to.x, to.z).length()
	if (global_position.y >= _mantle_target.y - 0.02 and flat < 0.12) or _mantle_t > 1.6:
		velocity = Vector3.ZERO
		_set_move_state(Move.GROUND)
		_was_on_floor = false


func _detach() -> void:
	_set_move_state(Move.GROUND)
	_was_on_floor = false
	_coyote = 0.0
	_jumped = true


# ---- Ladders -----------------------------------------------------------------------------------

func _try_attach_ladder() -> bool:
	if not is_input_enabled() or _move_input.y > -0.3:
		return false
	var fwd := -global_basis.z
	for l in _ladders:
		if not is_instance_valid(l):
			continue
		var to := l.global_position - global_position
		to.y = 0.0
		if to.length_squared() < 1e-4 or fwd.dot(to.normalized()) > 0.3:
			_ladder = l
			_set_move_state(Move.LADDER)
			velocity = Vector3.ZERO
			return true
	return false


func _physics_ladder(delta: float) -> void:
	if _ladder == null or not is_instance_valid(_ladder) or not _ladders.has(_ladder):
		# Left the ladder volume: at the top, hop forward onto the landing.
		var top_exit := velocity.y > 0.1
		_set_move_state(Move.GROUND)
		if top_exit:
			velocity = -global_basis.z * 1.6 + Vector3.UP * 2.6
		return
	var climb := -_move_input.y
	# Looking down while pushing forward climbs down (Source-style).
	if climb > 0.0 and head.pitch < deg_to_rad(-40.0):
		climb = -climb
	var spd := PlayerMotion.LADDER_SPEED * vitals.movement_multiplier()
	velocity = Vector3(0.0, climb * spd, 0.0)
	# Pull gently to the rungs.
	var to := _ladder.global_position - global_position
	to.y = 0.0
	var fwd := -_ladder.global_basis.z
	var along := to.dot(fwd) * fwd
	var lateral := to - along
	velocity += lateral * 3.0
	velocity += -global_basis.z * 0.3 * absf(climb)
	floor_snap_length = 0.0
	var before_y := global_position.y
	move_and_slide()
	_ladder_step_acc += absf(global_position.y - before_y)
	if _ladder_step_acc > 0.32:
		_ladder_step_acc = 0.0
		var surf: StringName = _ladder.get_meta(&"surface", &"wood")
		sounds.footstep(surf, 0.45, global_position)
	if absf(climb) > 0.1:
		vitals.drain_stamina(1.2 * delta)
		exert(0.2 * delta)
	if not is_input_enabled():
		return
	if _jump_buffer > 0.0:
		_jump_buffer = 0.0
		_set_move_state(Move.GROUND)
		velocity = global_basis.z * 2.5 + Vector3.UP * 1.8
		return
	if is_on_floor() and climb < -0.1:
		_set_move_state(Move.GROUND)


func _set_move_state(s: Move) -> void:
	if s == move_state:
		return
	move_state = s
	is_swimming = s == Move.SWIM
	is_climbing = s == Move.CLIMB or s == Move.MANTLE
	is_on_ladder = s == Move.LADDER
	is_sliding = false
	if s != Move.GROUND:
		is_sprinting = false
	if s != Move.LADDER:
		_ladder = null
	if s != Move.CLIMB and s != Move.MANTLE and probes:
		probes.rotation = Vector3.ZERO
	if is_climbing or is_swimming:
		_set_crouch(false)
	if viewmodel and viewmodel.has_method(&"on_move_state"):
		viewmodel.call(&"on_move_state", int(s))


# ---- Stride / footsteps ------------------------------------------------------------------------

func _update_stride(delta: float) -> void:
	var hv := Vector2(velocity.x, velocity.z)
	var grounded := move_state == Move.GROUND and _was_on_floor and not is_sliding
	ground_speed = hv.length() if grounded else 0.0
	if grounded and ground_speed > 0.25:
		var step_len := PlayerMotion.step_length(ground_speed)
		var d := ground_speed * delta
		var prev := stride_phase
		stride_phase += d / step_len * PI
		if floori(stride_phase / PI) != floori(prev / PI):
			_footstep()
		if stride_phase > TAU * 64.0:
			stride_phase -= TAU * 64.0
	else:
		# Settle the phase to the nearest foot-plant so the next step starts cleanly.
		var target := roundf(stride_phase / PI) * PI
		stride_phase = move_toward(stride_phase, target, delta * 2.5)
	if is_sliding and absf(velocity.y) + hv.length() > 1.5:
		_step_dist += hv.length() * delta
		if _step_dist > 1.2:
			_step_dist = 0.0
			sounds.footstep(current_surface, 0.35, global_position)
	# Breathing: rate & depth rise with exertion and thin air.
	var alt_k := clampf((global_position.y - 2400.0) / 1000.0, 0.0, 1.0)
	var hyp := clampf((60.0 - vitals.oxygen) / 60.0, 0.0, 1.0)
	var tired := clampf((50.0 - vitals.stamina) / 50.0, 0.0, 1.0)
	var rate := 0.24 + recent_exertion * 0.42 + tired * 0.3 + alt_k * 0.12 + hyp * 0.25
	breath_phase = fmod(breath_phase + TAU * rate * delta, TAU * 100.0)
	breath_depth = 1.0 + recent_exertion * 1.6 + tired * 2.0 + alt_k * 0.8 + hyp * 2.2
	shiver_amount = clampf((38.0 - vitals.warmth) / 30.0, 0.0, 1.0)
	if vitals.has_effect(&"wet"):
		shiver_amount = maxf(shiver_amount, 0.15 * clampf((12.0 - _felt) / 12.0, 0.0, 1.0))
	head.impairment = maxf(hyp * hyp, clampf((12.0 - vitals.warmth) / 12.0, 0.0, 1.0) * 0.6)


func _footstep() -> void:
	_sample_ground()
	var intensity := 0.65
	if is_crouching:
		intensity = 0.15
	elif is_sprinting:
		intensity = 1.0
	elif is_walking or ground_speed < 2.0:
		intensity = 0.35
	var surf := current_surface
	if water_depth > 0.15:
		surf = &"water"
	sounds.footstep(surf, intensity, global_position)
	# Deep snow costs effort every step.
	if surf == &"snow" and snow_depth > 0.3:
		vitals.drain_stamina(snow_depth * (1.4 if is_sprinting else 0.6))


# ---- Environment sampling ----------------------------------------------------------------------

func _sample_ground() -> void:
	foot_ray.force_raycast_update()
	var x := global_position.x
	var z := global_position.z
	_surface_from_terrain = true
	if foot_ray.is_colliding():
		var col := foot_ray.get_collider()
		if col != null and col.has_meta(&"surface"):
			current_surface = StringName(col.get_meta(&"surface"))
			_surface_from_terrain = false
			snow_depth = float(col.get_meta(&"snow_depth", 0.0)) if current_surface == &"snow" else 0.0
			return
	current_surface = TerrainData.get_surface(x, z)
	if current_surface == &"snow":
		snow_depth = PlayerMotion.snow_depth(TerrainData.get_masks(x, z).r, global_position.y)
	else:
		snow_depth = 0.0


## Safety net: if a collision gap (terrain chunk not streamed in yet, a bad seam) lets the body drop far
## below the heightfield in a long free fall, put it back on the surface without fall damage. Caves and
## mine adits sit under the heightfield too, so this only triggers after seconds of fast falling.
func _check_fell_through() -> void:
	if move_state != Move.GROUND or air_time < 2.5 or velocity.y > -12.0:
		return
	if not TerrainData.in_bounds(global_position.x, global_position.z):
		return
	# (A heightfield that isn't loaded yet reports ~0 m, far below the valley: never triggers.)
	var ground := TerrainData.get_height(global_position.x, global_position.z)
	if not is_finite(ground) or global_position.y > ground - 12.0:
		return
	print("[Player] fell through the ground at %s — restored to the surface" % global_position)
	teleport(Vector3(global_position.x, ground + 1.0, global_position.z), get_yaw_deg())


## Height of the body core above the feet where warmth is felt (fire heat, the torch in your hand, shelter).
const CORE_HEIGHT := 1.0


func _sample_climate(dt: float) -> void:
	var pos := global_position + Vector3(0.0, CORE_HEIGHT, 0.0)
	var wet := vitals.has_effect(&"wet")
	vitals.env_altitude = global_position.y
	vitals.env_air_temp = Climate.get_air_temperature(pos)
	_felt = Climate.get_felt_temperature(pos, _insulation, wet)
	vitals.env_felt_temp = _felt
	vitals.env_heat = Climate.get_heat_at(pos)
	is_sheltered = Climate.get_shelter_at(pos)
	vitals.env_shelter = is_sheltered
	vitals.env_insulation = _insulation
	vitals.env_waterproof = _waterproof
	vitals.env_precipitation = float(Climate.precipitation) * (1.0 - is_sheltered)
	# Bottled oxygen: mask + bottle feed you above 2,500 m and slowly empty the bottle (items.json
	# o2.minutes, game minutes; the empty bottle is returned).
	var supply := false
	if global_position.y > 2500.0 and has_gear(&"o2_mask"):
		var bi := inventory.find(&"o2_bottle")
		if bi >= 0:
			supply = true
			_o2_timer += dt
			if _o2_timer >= 1.0:
				var o2: Dictionary = ItemDB.get_item(&"o2_bottle").get("o2", {})
				var minutes := maxf(float(o2.get("minutes", 540.0)), 1.0)
				if inventory.use_durability(bi, _o2_timer * Climate.game_minutes_per_second() / minutes):
					Game.notify("Oxygen bottle empty", &"warning")
					ItemActions.return_container(self, inventory, &"o2_bottle")
				_o2_timer = 0.0
			if randf() < dt / 3.0:
				Audio.play_sfx(&"o2_hiss", null, -14.0)
	vitals.env_o2_supply = supply


func _update_exertion(delta: float) -> void:
	var e := 0.0
	match move_state:
		Move.GROUND:
			if ground_speed > 0.3:
				if is_sprinting:
					e = 0.9
				elif is_crouching:
					e = 0.15
				elif ground_speed < 2.0:
					e = 0.18
				else:
					e = 0.38
				e += snow_depth * 0.3
				if get_carried_weight() > inventory.max_weight:
					e += 0.2
		Move.SWIM:
			e = 0.55 if ground_speed < 0.1 else 0.7
		Move.CLIMB, Move.MANTLE:
			e = 0.85
		Move.LADDER:
			e = 0.4
	_work_exertion = maxf(_work_exertion - delta * 0.35, 0.0)
	_exertion_target = clampf(maxf(e, _work_exertion), 0.0, 1.0)
	recent_exertion = lerpf(recent_exertion, _exertion_target, 1.0 - exp(-delta / 1.8))
	if is_sprinting and ground_speed > 2.5:
		vitals.drain_stamina(11.0 * delta)
		if not vitals.can_exert():
			is_sprinting = false
			_sprint_latched = false


func _feed_vitals() -> void:
	vitals.env_exertion = recent_exertion
	vitals.env_moving = ground_speed > 0.3 or move_state != Move.GROUND
	var imm := 0.0
	if water_depth > 0.0:
		imm = clampf(water_depth / 1.4, 0.0, 1.0)
	vitals.env_immersion = imm
	vitals.env_head_underwater = water_level > -1e20 and get_eye_position().y < water_level - 0.05
	if vitals.env_head_underwater != _was_under:
		_was_under = vitals.env_head_underwater
		Audio.set_muffled(1.0 if _was_under else 0.0)


# ---- Sensor (ladders, water volumes, pushable props) -------------------------------------------

func _on_area_entered(a: Area3D) -> void:
	if a.is_in_group(&"ladder") and not _ladders.has(a):
		_ladders.append(a)
	if (a.is_in_group(&"water") or a.is_in_group(&"water_volume")) and not _water_volumes.has(a):
		_water_volumes.append(a)
		_sample_water_level()


func _on_area_exited(a: Area3D) -> void:
	_ladders.erase(a)
	if _water_volumes.has(a):
		_water_volumes.erase(a)
		_sample_water_level()


func _on_body_entered(b: Node3D) -> void:
	var rb := b as RigidBody3D
	if rb == null:
		return
	if _is_light_pickup(rb):
		if not _pass_bodies.has(rb):
			_pass_bodies.append(rb)
			add_collision_exception_with(rb)
		return
	if not _near_bodies.has(rb):
		_near_bodies.append(rb)


func _on_body_exited(b: Node3D) -> void:
	var rb := b as RigidBody3D
	if rb == null:
		return
	_near_bodies.erase(rb)
	if _pass_bodies.has(rb):
		_pass_bodies.erase(rb)
		if is_instance_valid(rb) and rb.is_inside_tree():
			remove_collision_exception_with(rb)


static func _is_light_pickup(rb: RigidBody3D) -> bool:
	var id: Variant = rb.get(&"item_id")
	if id == null or not (id is StringName or id is String) or String(id) == "":
		return false
	var d: Dictionary = ItemDB.get_item(StringName(id))
	var c: Variant = rb.get(&"count")
	var n := maxi(int(c), 1) if c is int else 1
	return float(d.get("weight", rb.mass)) * float(n) < PASS_THROUGH_PICKUP_KG


# =================================================================================================
# Gear, hotbar, inventory
# =================================================================================================

static func _tool_type(id: StringName) -> StringName:
	if id == &"":
		return &""
	var t: Dictionary = ItemDB.get_item(id).get("tool", {})
	return StringName(t.get("type", ""))


static func _item_has_gear(id: StringName, tag: String) -> bool:
	var g: Variant = ItemDB.get_item(id).get("gear", [])
	return g is Array and (g as Array).has(tag)


func _equip_slot_for(def: Dictionary) -> StringName:
	# Shared rule with the inventory UI: crampons → feet_addon, O2 mask → mask, tools → hand.
	var slot := ItemInfo.wear_slot_of(def)
	if slot != &"hand" and slot != &"" and not EQUIP_SLOTS.has(slot):
		return &""
	return slot


func _recalc_gear() -> void:
	# Same totals the inventory's equipment page shows: insulation sums, wind/waterproofing is weighted by
	# the skin area each garment covers (a wool hat doesn't make a parka-less body windproof).
	var tot := ItemActions.clothing_totals(equipment)
	_insulation = float(tot["insulation"])
	_windproof = float(tot["windproof"])
	_waterproof = float(tot["waterproof"])
	_crampons = has_gear(&"crampons")
	_apply_pack_capacity()


func _apply_pack_capacity() -> void:
	var pack: StringName = equipment.get(&"back", &"")
	var slots := BASE_SLOTS
	var weight := BASE_WEIGHT
	if pack != &"":
		# items.json "carry": {"slots", "weight"} — total slots and total comfortable load (kg) with this pack.
		var carry: Dictionary = ItemDB.get_item(pack).get("carry", {})
		if not carry.is_empty():
			slots = maxi(int(carry.get("slots", slots)), BASE_SLOTS)
			weight = maxf(float(carry.get("weight", weight)), BASE_WEIGHT)
	if inventory.size() != slots:
		inventory.resize(slots)
	inventory.max_weight = weight
	_weight_dirty = true


func _cycle_hotbar(dir: int) -> void:
	var i := active_slot
	for _n in HOTBAR_SIZE + 1:
		i += dir
		if i >= HOTBAR_SIZE:
			i = -1
		elif i < -1:
			i = HOTBAR_SIZE - 1
		if i == -1 or (hotbar[i] != &"" and inventory.has(hotbar[i])):
			break
	if i == active_slot:
		return
	if i == -1:
		select_hotbar(-1)
	else:
		active_slot = -1
		select_hotbar(i)


func _on_inventory_changed() -> void:
	_weight_dirty = true
	# Items used up / dropped leave the hotbar; the hands go empty if the active one is gone.
	var changed_active := false
	for i in HOTBAR_SIZE:
		var id := hotbar[i]
		if id != &"" and not inventory.has(id):
			hotbar[i] = &""
			if i == active_slot:
				changed_active = true
	if changed_active:
		active_slot = -1
		Events.active_item_changed.emit(&"")
		if viewmodel and viewmodel.has_method(&"set_item"):
			viewmodel.call(&"set_item", &"")


func _on_item_picked_up(id: StringName, _count: int) -> void:
	_auto_hotbar.call_deferred(id)


## New tools/weapons/lights you can hold (picked up, crafted, taken from storage) go to the first free
## hotbar slot. Worn gear (crampons), igniters, ammo and other pack items stay off the hotbar.
func _auto_hotbar(id: StringName) -> void:
	if hotbar.has(id) or not inventory.has(id):
		return
	if _equip_slot_for(ItemDB.get_item(id)) != &"hand":
		return
	var idx := hotbar.find(&"")
	if idx >= 0:
		hotbar[idx] = id


## Spawns a dropped stack through ItemsRoot (a "dynamic" pickup: saved with the world, keeps durability).
func _drop_to_world(id: StringName, count: int, durability := 1.0, extra := {}) -> void:
	var at := get_eye_position() + get_look_direction() * 0.7 + Vector3.DOWN * 0.3
	var node := ItemsRoot.spawn(id, count, at, Vector3.ZERO, durability)
	if node:
		node.extra = extra.duplicate()
		node.linear_velocity = get_look_direction() * 2.5 + velocity * 0.5


# =================================================================================================
# Settings, UI, lifecycle
# =================================================================================================

func _apply_settings() -> void:
	_mouse_sens = float(Settings.get_value(&"mouse_sensitivity", 0.12))
	_touch_sens = float(Settings.get_value(&"look_sensitivity_touch", 0.22))
	_pad_sens = float(Settings.get_value(&"look_sensitivity_pad", 2.6))
	_invert_y = bool(Settings.get_value(&"invert_y", false))
	head.apply_settings()


func _ensure_walk_action() -> void:
	# Optional keyboard walk toggle (analog sticks walk by partial deflection).
	if InputMap.has_action(&"walk"):
		return
	InputMap.add_action(&"walk", 0.2)
	var ev := InputEventKey.new()
	ev.physical_keycode = KEY_CAPSLOCK
	InputMap.action_add_event(&"walk", ev)


func _capture_mouse(on: bool) -> void:
	if Settings.is_mobile():
		return
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if on else Input.MOUSE_MODE_VISIBLE


func _on_ui_opened(screen: StringName) -> void:
	if screen == &"build":
		tool_blocked = true
	if NON_BLOCKING_SCREENS.has(screen):
		return
	if not _ui_screens.has(screen):
		_ui_screens.append(screen)
	_capture_mouse(false)
	interactor.clear()
	_sprint_latched = false


func _on_ui_closed(screen: StringName) -> void:
	if screen == &"build":
		tool_blocked = false
	_ui_screens.erase(screen)
	if _ui_screens.is_empty() and not _dead and Game.state != Game.State.CINEMATIC:
		_capture_mouse(true)


func _on_cinematic_started(_id: StringName) -> void:
	interactor.clear()


func _on_cinematic_ended(_id: StringName) -> void:
	pass


func _on_sleep_started(hours: float) -> void:
	_sleep_hours = hours
	vitals.env_sleeping = true
	set_input_enabled(false)


func _on_sleep_ended() -> void:
	vitals.env_sleeping = false
	vitals.on_slept(_sleep_hours)
	_sleep_hours = 0.0
	if not _dead:
		set_input_enabled(true)


func _on_died(_cause: StringName) -> void:
	_dead = true
	set_input_enabled(false)
	head.start_death()
	is_sprinting = false
	if viewmodel:
		viewmodel.visible = false
	Audio.play_sfx(&"death", null)
	Audio.play_stinger(&"death")
	_capture_mouse(false)


# =================================================================================================
# Persistence (group "persistent")
# =================================================================================================

func get_save_key() -> String:
	return "player"


func save_state() -> Dictionary:
	var eq := {}
	for s in EQUIP_SLOTS:
		eq[String(s)] = String(equipment.get(s, &""))
	var hb: Array = []
	for id in hotbar:
		hb.append(String(id))
	return {
		"position": SaveUtil.v3(global_position),
		"yaw": rad_to_deg(rotation.y),
		"pitch": rad_to_deg(head.pitch),
		"crouch": is_crouching,
		"vitals": vitals.save_state(),
		"inventory": inventory.to_dict(),
		"equipment": eq,
		"hotbar": hb,
		"active_slot": active_slot,
	}


func load_state(d: Dictionary) -> void:
	var eq: Dictionary = d.get("equipment", {})
	for s in EQUIP_SLOTS:
		var id := StringName(eq.get(String(s), ""))
		equipment[s] = id if ItemDB.has_item(id) else &""
	_recalc_gear()
	inventory.from_dict(d.get("inventory", {}))
	_apply_pack_capacity()
	var hb: Array = d.get("hotbar", [])
	for i in HOTBAR_SIZE:
		hotbar[i] = StringName(hb[i]) if i < hb.size() else &""
	vitals.load_state(d.get("vitals", {}))
	teleport(SaveUtil.to_v3(d.get("position"), global_position), float(d.get("yaw", 0.0)))
	head.pitch = deg_to_rad(float(d.get("pitch", 0.0)))
	if bool(d.get("crouch", false)):
		_set_crouch(true)
	active_slot = -1
	var a := int(d.get("active_slot", -1))
	if a >= 0:
		select_hotbar(a)
	else:
		Events.active_item_changed.emit(&"")
		if viewmodel and viewmodel.has_method(&"set_item"):
			viewmodel.call(&"set_item", &"")
	for s in EQUIP_SLOTS:
		if equipment[s] != &"":
			Events.equipment_changed.emit(s, equipment[s])
	_dead = vitals.dead
	if _dead:
		_on_died(vitals.death_cause)

class_name Viewmodel
extends Node3D
## First-person viewmodel root (child of the Camera3D). Owns the active HeldItem and layers procedural
## motion on top of the item's own animation: holster/draw transitions, spring sway from look input,
## stride-locked bob, idle breathing, inertia from acceleration, sprint and lowered poses, landing kick,
## hit reactions. Arms take their materials from the equipped gloves and jacket.

const TOOL_SCRIPTS := {
	&"": "res://src/player/tools/hands.gd",
	&"axe": "res://src/player/tools/axe.gd",
	&"pickaxe": "res://src/player/tools/axe.gd",
	&"hammer": "res://src/player/tools/axe.gd",
	&"knife": "res://src/player/tools/knife.gd",
	&"spear": "res://src/player/tools/spear.gd",
	&"bow": "res://src/player/tools/bow.gd",
	&"torch": "res://src/player/tools/torch.gd",
	&"lantern": "res://src/player/tools/torch.gd",
	&"flare": "res://src/player/tools/flare.gd",
	&"flaregun": "res://src/player/tools/flaregun.gd",
	&"ice_axe": "res://src/player/tools/ice_axe.gd",
	&"scanner": "res://src/player/tools/scanner.gd",
	&"canteen": "res://src/player/tools/consumable.gd",
	&"binoculars": "res://src/player/tools/binoculars.gd",
	&"map": "res://src/player/tools/map_compass.gd",
}
const CONSUMABLE_SCRIPT := "res://src/player/tools/consumable.gd"
const GENERIC_SCRIPT := "res://src/player/tools/generic.gd"
const HOLSTER_TIME := 0.2
const DRAW_TIME := 0.32
const VM_FOV_MAX := 70.0

var player: Player = null
var sway_node: Node3D = null
var current: HeldItem = null
var current_id: StringName = &"__none__"

var _pending_id: StringName = &""
var _switching := 0          # 0 idle, 1 holstering, 2 drawing
var _holster := 1.0          # 0 up .. 1 down (out of view)
var _lower := 0.0            # forced lowering (swimming, ladder…)
var _sprint_w := 0.0
var _sway := Vector2.ZERO    # degrees (yaw, pitch)
var _sway_vel := Vector2.ZERO
var _lag := Vector3.ZERO
var _lag_vel := Vector3.ZERO
var _prev_vel := Vector3.ZERO
var _land := 0.0
var _land_vel := 0.0
var _kick := Vector3.ZERO
var _kick_vel := Vector3.ZERO
var _bob_amp := 0.0
var _t := 0.0
var _arms: Array[Node3D] = []
var _hand_kind: StringName = &"glove"
var _sleeve_kind: StringName = &"sleeve"
var _wet := 0.0


func setup(p: Player) -> void:
	player = p
	sway_node = Node3D.new()
	sway_node.name = "Sway"
	add_child(sway_node)
	Events.equipment_changed.connect(_on_equipment_changed)
	Events.settings_changed.connect(_apply_settings)
	_apply_settings()
	_refresh_clothing_kinds()
	set_item(&"")


func _apply_settings() -> void:
	var fov := float(Settings.get_value(&"fov", 75.0))
	FPMaterials.set_vm_fov(minf(fov - 8.0, VM_FOV_MAX))


# ---- Public API -----------------------------------------------------------------------------------

func set_item(id: StringName) -> void:
	_pending_id = id
	if current == null:
		_swap()
		_switching = 2
		return
	if id == current_id and _switching == 0:
		return
	_switching = 1


func get_current() -> HeldItem:
	return current


func land(impact: float) -> void:
	_land_vel -= clampf(impact * 0.012, 0.0, 0.12)


func hit_reaction(dir_world: Vector3) -> void:
	if player == null:
		return
	var local := player.camera.global_basis.inverse() * dir_world
	_kick_vel += Vector3(-local.y * 90.0, local.x * 90.0, local.x * 140.0)


func climb_swing() -> void:
	if current:
		current.climb_swing()


func on_move_state(_state: int) -> void:
	pass


## Called by HeldItem.add_arm(); applies the equipped clothing materials.
func register_arm(arm: Node3D) -> void:
	_arms.append(arm)
	_apply_clothing(arm)


# ---- Switching ------------------------------------------------------------------------------------

func _swap() -> void:
	if current:
		current.on_holster()
		current.queue_free()
		current = null
	_arms.clear()
	current_id = _pending_id
	var script_path := _script_for(current_id)
	var scr := load(script_path) as Script
	if scr == null or not scr.can_instantiate():
		push_error("Viewmodel: cannot load %s" % script_path)
		scr = load(GENERIC_SCRIPT) as Script
	var item := scr.new() as HeldItem
	if item == null:
		push_error("Viewmodel: %s is not a HeldItem" % script_path)
		return
	item.name = "Held"
	sway_node.add_child(item)
	item.setup(player, self, current_id)
	item.depleted.connect(_on_depleted)
	current = item
	current.on_equip()
	if current_id != &"":
		Audio.play_sfx(&"equip", null, -10.0)


func _script_for(id: StringName) -> String:
	if id == &"":
		return TOOL_SCRIPTS[&""]
	var d: Dictionary = ItemDB.get_item(id)
	var t: Dictionary = d.get("tool", {})
	var tt := StringName(t.get("type", ""))
	if tt != &"" and TOOL_SCRIPTS.has(tt):
		return TOOL_SCRIPTS[tt]
	var cat := String(d.get("category", ""))
	if d.has("food") or cat == "food" or cat == "drink" or cat == "medical":
		return CONSUMABLE_SCRIPT
	return GENERIC_SCRIPT


func _on_depleted() -> void:
	# The inventory change already emptied the hotbar slot; make sure hands follow.
	if player and player.get_active_item() == current_id:
		return
	set_item(player.get_active_item() if player else &"")


# ---- Frame update ---------------------------------------------------------------------------------

func _process(delta: float) -> void:
	if player == null or sway_node == null:
		return
	_t += delta
	# Switching.
	if _switching == 1:
		var wait := current != null and current.busy
		if not wait:
			_holster = move_toward(_holster, 1.0, delta / HOLSTER_TIME)
			if _holster >= 1.0:
				_swap()
				_switching = 2
	elif _switching == 2:
		_holster = move_toward(_holster, 0.0, delta / DRAW_TIME)
		if _holster <= 0.0:
			_switching = 0
	# Forced lowering.
	var lowered := player.is_swimming or player.is_on_ladder or player.is_dead()
	if player.is_climbing and (current == null or current.tool_type != &"ice_axe"):
		lowered = true
	_lower = move_toward(_lower, 1.0 if lowered else 0.0, delta * 4.0)
	var can_act := _switching == 0 and _lower < 0.05 and player.is_input_enabled()
	if current:
		current.tick_cooldown(delta)
		current.item_process(delta, can_act or (player.is_climbing and current.tool_type == &"ice_axe"))
		player.speed_cap = current.get_speed_cap()
		player.look_scale = current.get_look_scale()
		player.head.fov_override = current.get_fov()
	_update_motion(delta)
	_update_wetness(delta)


func _update_motion(delta: float) -> void:
	var sw := current.sway_scale if current else 1.0
	# Spring sway: look input kicks the tool the opposite way, a damped spring brings it back.
	var ld := player.look_delta
	ld.x = clampf(ld.x, -12.0, 12.0)
	ld.y = clampf(ld.y, -12.0, 12.0)
	_sway_vel += Vector2(-ld.x, -ld.y) * 16.0 * sw
	var acc := -_sway * 110.0 - _sway_vel * 15.0
	_sway_vel += acc * delta
	_sway += _sway_vel * delta
	_sway = _sway.clamp(Vector2(-7.0, -7.0), Vector2(7.0, 7.0))
	# Inertia: the tool lags behind acceleration of the body.
	var lv := player.get_local_velocity()
	var accel := (lv - _prev_vel) / maxf(delta, 1e-4)
	_prev_vel = lv
	accel = accel.limit_length(25.0)
	_lag_vel += -accel * 0.0009
	var lacc := -_lag * 140.0 - _lag_vel * 18.0
	_lag_vel += lacc * delta
	_lag += _lag_vel * delta
	_lag = _lag.limit_length(0.03)
	# Landing kick.
	var la := -_land * 160.0 - _land_vel * 16.0
	_land_vel += la * delta
	_land += _land_vel * delta
	# Hit kick (rotational).
	var ka := -_kick * 120.0 - _kick_vel * 14.0
	_kick_vel += ka * delta
	_kick += _kick_vel * delta
	# Stride bob (figure-eight), idle breathing.
	var grounded := player.is_grounded()
	var target_amp := clampf(player.ground_speed / PlayerMotion.SPRINT_SPEED, 0.0, 1.3) if grounded else 0.0
	_bob_amp = lerpf(_bob_amp, target_amp, 1.0 - exp(-8.0 * delta))
	var ph := player.stride_phase
	var bob_scale := lerpf(0.5, 1.0, float(Settings.get_value(&"head_bob", 0.6)))
	var bx := sin(ph) * 0.011 * _bob_amp * bob_scale
	var by := (absf(sin(ph)) - 0.5) * 0.014 * _bob_amp * bob_scale
	var broll := sin(ph) * 1.4 * _bob_amp
	var br := sin(player.breath_phase) * player.breath_depth
	var bry := br * 0.0018
	var brp := br * 0.28
	# Shiver shakes the hands too.
	var shiver := Vector3.ZERO
	if player.shiver_amount > 0.01:
		shiver = Vector3(sin(_t * 71.0), sin(_t * 63.0 + 1.0), 0.0) * 0.0016 * player.shiver_amount
	# Sprint pose.
	_sprint_w = lerpf(_sprint_w, 1.0 if (player.is_sprinting and player.ground_speed > 3.0) else 0.0, 1.0 - exp(-7.0 * delta))
	var crouch_off := -0.012 if player.is_crouching else 0.0
	var pos := Vector3(bx, by + bry + crouch_off + _land, 0.0) + _lag + shiver
	var rot := Vector3(_sway.y + brp, _sway.x, broll) + _kick
	if current:
		pos += current.sprint_pos * _sprint_w
		rot += current.sprint_rot * _sprint_w
	# Holster / lowered: drop out of view and tip away.
	var h := maxf(HeldItem.smooth(_holster), HeldItem.smooth(_lower))
	pos += Vector3(0.02, -0.34, 0.08) * h
	rot += Vector3(-38.0, 8.0, 6.0) * h
	sway_node.position = pos
	sway_node.rotation_degrees = rot
	visible = h < 0.995 and not player.is_dead()
	if current:
		current.position = current.rest_pos + current.anim_pos
		current.rotation_degrees = current.rest_rot + current.anim_rot


func _update_wetness(delta: float) -> void:
	var target := 0.0
	if player.vitals and player.vitals.has_effect(&"wet"):
		target = clampf(player.vitals.get_effect_strength(&"wet"), 0.0, 1.0)
	if player.water_depth > 0.9:
		target = 1.0
	_wet = move_toward(_wet, target, delta * (2.0 if target > _wet else 0.05))
	FPMaterials.set_wet(snappedf(_wet, 0.02))


# ---- Clothing -------------------------------------------------------------------------------------

func _on_equipment_changed(slot: StringName, _id: StringName) -> void:
	if slot != &"hands" and slot != &"body":
		return
	_refresh_clothing_kinds()
	for arm in _arms:
		if is_instance_valid(arm):
			_apply_clothing(arm)


func _refresh_clothing_kinds() -> void:
	if player == null:
		return
	var hands: StringName = player.equipment.get(&"hands", &"")
	match hands:
		&"":
			_hand_kind = &"skin"
		&"fur_mitts":
			_hand_kind = &"mitt"
		_:
			_hand_kind = &"glove"
	var body: StringName = player.equipment.get(&"body", &"")
	match body:
		&"parka":
			_sleeve_kind = &"sleeve_parka"
		&"down_suit":
			_sleeve_kind = &"sleeve_down"
		&"hide_coat":
			_sleeve_kind = &"sleeve_hide"
		_:
			_sleeve_kind = &"sleeve"


func _apply_clothing(arm: Node3D) -> void:
	var fore := arm.get_node_or_null(^"Forearm") as MeshInstance3D
	if fore == null or fore.mesh == null or fore.mesh.get_surface_count() < 3:
		return   # external art: keep its own materials
	var hand := arm.get_node_or_null(^"Hand") as MeshInstance3D
	if hand:
		hand.set_surface_override_material(FPHands.SURF_HAND, FPMaterials.vm(_hand_kind))
	fore.set_surface_override_material(FPHands.SURF_GAUNTLET, FPMaterials.vm(_hand_kind))
	fore.set_surface_override_material(FPHands.SURF_SLEEVE, FPMaterials.vm(_sleeve_kind))
	fore.set_surface_override_material(FPHands.SURF_CUFF, FPMaterials.vm(&"cuff"))

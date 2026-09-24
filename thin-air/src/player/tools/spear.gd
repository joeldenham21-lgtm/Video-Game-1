extends MeleeTool
## Spear: `use` stabs (pull back, drive forward); hold `aim` to raise it over the shoulder and `use` to
## throw it as a projectile that sticks where it lands and can be picked back up.

const THROW_SPEED := 21.0
const THROW_STAMINA := 9.0

var _raise := 0.0
var _throw_anim := -1.0


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	t_windup = 0.22
	t_strike = 0.1
	t_follow = 0.12
	t_recover = 0.34
	super.setup(p, vm, id)
	damage_type = &"pierce"
	harvest_family = &"knife"
	swing_sfx = &"spear_throw"
	noise_radius = 10.0
	windup_pos = Vector3(0.02, -0.01, 0.2)
	windup_rot = Vector3(4.0, 0.0, 0.0)
	strike_pos = Vector3(-0.03, 0.03, -0.32)
	strike_rot = Vector3(-3.0, 2.0, 0.0)
	follow_pos = Vector3(-0.03, 0.02, -0.36)
	follow_rot = Vector3(-4.0, 2.0, 0.0)
	recoil_rot = Vector3(2.0, 0.0, 0.0)
	sprint_pos = Vector3(0.04, -0.05, 0.08)
	sprint_rot = Vector3(-12.0, 18.0, 8.0)


func build_visual() -> void:
	rest_pos = Vector3(0.2, -0.3, 0.0)
	var fwd := Vector3(-0.12, 0.12, -1.0).normalized()
	var zb := -fwd
	var yb := (Vector3.UP - zb * Vector3.UP.dot(zb)).normalized()
	var xb := yb.cross(zb).normalized()
	var basis := Basis(xb, yb, zb)
	var holder := Node3D.new()
	holder.name = "Spear"
	var grip_cam := Vector3(0.15, -0.2, -0.3)
	holder.transform = Transform3D(basis, grip_cam - rest_pos)
	model.add_child(holder)
	var ext := FPModels.external(item_id)
	if ext:
		holder.add_child(ext)
	else:
		var mi := MeshInstance3D.new()
		mi.mesh = FPModels.spear_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.add_child(mi)
	# Underhand grip: the shaft runs forward through the fist, thumb toward the point.
	var elbow := basis.inverse() * Vector3(0.3, -0.6, 0.74)
	var arm := FPHands.make_arm(&"grip", false, Vector3.ZERO, Vector3(0, 0, -1), elbow)
	holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


func item_process(delta: float, can_act: bool) -> void:
	if _throw_anim >= 0.0:
		# Throw follow-through, then the viewmodel switches away (the spear left the inventory).
		_throw_anim += delta
		var k := smooth(_throw_anim / 0.35)
		anim_pos = Vector3(0.05, 0.14, 0.1).lerp(Vector3(-0.1, -0.2, -0.4), k)
		anim_rot = Vector3(-6.0, 4.0, 0.0).lerp(Vector3(-40.0, 10.0, 0.0), k)
		model.visible = false
		if _throw_anim > 0.4:
			busy = false
			_throw_anim = -1.0
			depleted.emit()
		return
	var aiming := can_act and not player.tool_blocked and Input.is_action_pressed(&"aim") and phase == Phase.IDLE
	_raise = move_toward(_raise, 1.0 if aiming else 0.0, delta * 4.0)
	if _raise > 0.01:
		var r := smooth(_raise)
		anim_pos = Vector3(0.05, 0.14, 0.12) * r
		anim_rot = Vector3(-6.0 + sin(Time.get_ticks_msec() * 0.002) * 0.6, 4.0, 0.0) * r
		if aiming and _raise >= 1.0 and Input.is_action_just_pressed(&"use"):
			_throw()
		return
	super.item_process(delta, can_act)


func get_speed_cap() -> float:
	return PlayerMotion.WALK_SPEED * 1.4 if _raise > 0.5 else INF


func _throw() -> void:
	if not player.vitals.use_stamina(THROW_STAMINA):
		player.vitals.drain_stamina(THROW_STAMINA)
	var from := player.get_eye_position() + player.get_look_direction() * 0.6 + player.camera.global_basis.x * 0.15
	var vel := player.get_look_direction() * THROW_SPEED + player.velocity * 0.6 + Vector3.UP * 0.8
	var dmg := tool_value("damage", 22.0) * 1.4
	var parent: Node = Game.world if Game.world else player.get_parent()
	var idx := inventory_index()
	var dur := float(player.inventory.get_slot(idx).get("durability", 1.0)) if idx >= 0 else 1.0
	var p := PlayerProjectile.launch(parent, PlayerProjectile.Kind.SPEAR, item_id, from, vel, dmg, player)
	p.durability = dur
	Audio.play_sfx(&"spear_throw", from)
	player.exert(0.6)
	player.add_trauma(0.08)
	busy = true
	_throw_anim = 0.0
	if idx >= 0:
		player.inventory.remove_at(idx, 1)

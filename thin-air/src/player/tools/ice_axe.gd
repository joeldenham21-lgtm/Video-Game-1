extends MeleeTool
## Ice axe: a pick swing (pierce; mines ice as the "pickaxe" family) and the climbing tool — `use` or
## `jump` at a face steeper than 60° latches on. While climbing the axe is planted overhead and each
## hand-over-hand move re-plants it (climb_swing).

var _plant := 0.0


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	t_windup = 0.28
	t_strike = 0.09
	t_follow = 0.11
	t_recover = 0.34
	super.setup(p, vm, id)
	damage_type = &"pierce"
	harvest_family = &"pickaxe"
	swing_sfx = &"axe_swing"
	noise_radius = 18.0
	windup_pos = Vector3(0.06, 0.16, 0.12)
	windup_rot = Vector3(64.0, -10.0, -18.0)
	strike_pos = Vector3(-0.08, -0.05, -0.14)
	strike_rot = Vector3(-56.0, 8.0, 10.0)
	follow_pos = Vector3(-0.1, -0.12, -0.1)
	follow_rot = Vector3(-74.0, 10.0, 14.0)
	recoil_rot = Vector3(-20.0, 4.0, 4.0)
	sprint_pos = Vector3(0.04, -0.06, 0.1)
	sprint_rot = Vector3(-20.0, 16.0, 14.0)


func build_visual() -> void:
	rest_pos = Vector3(0.26, -0.42, 0.02)
	var handle_dir := Vector3(-0.28, 0.82, -0.5).normalized()
	var pick_dir := Vector3(-0.8, 0.1, -0.55)
	var grip_cam := Vector3(0.19, -0.2, -0.37)
	var y := handle_dir
	var zn := -(pick_dir - y * pick_dir.dot(y)).normalized()
	var x := y.cross(zn).normalized()
	var basis := Basis(x, y, zn)
	var holder := Node3D.new()
	holder.name = "IceAxe"
	var grip_y := 0.1
	holder.transform = Transform3D(basis, grip_cam - rest_pos - basis * Vector3(0.0, grip_y, 0.0))
	model.add_child(holder)
	var ext := FPModels.external(item_id)
	if ext:
		holder.add_child(ext)
	else:
		var mi := MeshInstance3D.new()
		mi.mesh = FPModels.ice_axe_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.add_child(mi)
	var elbow := basis.inverse() * elbow_toward(grip_cam, ELBOW_R)
	var arm := FPHands.make_arm(&"grip", false, Vector3(0.0, grip_y, 0.0), Vector3.UP, elbow)
	holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


func try_special_use() -> bool:
	return player.try_start_climb()


func item_process(delta: float, can_act: bool) -> void:
	if player.is_climbing:
		busy = false
		phase = Phase.IDLE
		# Planted overhead; each move pulls it out and swings it back in.
		_plant = maxf(_plant - delta * 3.2, 0.0)
		var swing := sin(_plant * PI)
		var target_pos := Vector3(-0.08, 0.3, -0.14) + Vector3(0.02, -0.06, 0.08) * swing
		var target_rot := Vector3(-20.0, 10.0, 12.0) + Vector3(38.0, 0.0, -8.0) * swing
		anim_pos = anim_pos.lerp(target_pos, 1.0 - exp(-12.0 * delta))
		anim_rot = anim_rot.lerp(target_rot, 1.0 - exp(-12.0 * delta))
		return
	super.item_process(delta, can_act)


func climb_swing() -> void:
	_plant = 1.0
	Audio.play_sfx(&"pick_hit_stone", player.get_eye_position() - player.get_look_direction() * -0.5, -8.0)
	player.add_trauma(0.05)

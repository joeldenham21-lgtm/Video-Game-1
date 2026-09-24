extends HeldItem
## Signal flare pistol: `use` fires a flare shell (consumes one flare_shell) in a high arc; the shell
## burns bright red for several seconds, loud enough to be heard across the valley and scare animals.

var _recoil := 0.0
var _holder: Node3D = null


func build_visual() -> void:
	rest_pos = Vector3(0.22, -0.34, 0.0)
	sprint_pos = Vector3(0.03, -0.06, 0.06)
	sprint_rot = Vector3(-24.0, 12.0, 14.0)
	_holder = Node3D.new()
	_holder.name = "FlareGun"
	var grip_cam := Vector3(0.14, -0.15, -0.35)
	var basis := Basis.from_euler(Vector3(deg_to_rad(5.0), deg_to_rad(9.0), deg_to_rad(-4.0)))
	_holder.transform = Transform3D(basis, grip_cam - rest_pos)
	model.add_child(_holder)
	var ext := FPModels.external(item_id)
	if ext:
		_holder.add_child(ext)
	else:
		var mi := MeshInstance3D.new()
		mi.mesh = _pistol_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_holder.add_child(mi)
	# Pistol grip: the grip runs down-back from the frame; thumb toward the barrel side (up).
	var grip_dir := Vector3(0.0, 0.94, 0.34).normalized()
	var arm := FPHands.make_arm(&"grip", false, Vector3(0.0, -0.045, 0.03), grip_dir, basis.inverse() * elbow_toward(grip_cam, ELBOW_R))
	_holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


static func _pistol_mesh() -> ArrayMesh:
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var barrel := FPMesh.Tube.new()
	barrel.add(Vector3(0, 0.01, 0.03), 0.016).add(Vector3(0, 0.01, -0.12), 0.0155).add(Vector3(0, 0.01, -0.125), 0.0165)
	b.tube(barrel, 16, Vector3.UP, 6.0, true, false)
	var frame := FPMesh.Tube.new()
	frame.add(Vector3(0, -0.005, 0.045), 0.012, 0.018).add(Vector3(0, -0.005, -0.02), 0.012, 0.016)
	b.tube(frame, 12, Vector3.UP, 6.0, true, true, 3.0)
	var grip := FPMesh.Tube.new()
	grip.add(Vector3(0, -0.01, 0.04), 0.0135, 0.019).add(Vector3(0, -0.1, 0.075), 0.0145, 0.021)
	grip.dome_end(2, 0.4)
	b.tube(grip, 12, Vector3.BACK, 6.0, true, false, 3.0)
	var guard := FPMesh.Tube.new()
	for i in 9:
		var a := float(i) / 8.0 * PI
		guard.add(Vector3(0, -0.012 - sin(a) * 0.022, 0.018 - cos(a) * 0.022), 0.003)
	b.tube(guard, 6, Vector3.RIGHT, 20.0)
	b.commit(mesh, FPMaterials.vm(&"plastic_orange"))
	var hole := FPMesh.Tube.new()
	hole.add(Vector3(0, 0.01, -0.126), 0.0115).add(Vector3(0, 0.01, -0.1), 0.0115)
	b.tube(hole, 14, Vector3.UP, 6.0, false, true)
	b.commit(mesh, FPMaterials.vm(&"glass_dark"))
	return mesh


func item_process(delta: float, can_act: bool) -> void:
	_recoil = move_toward(_recoil, 0.0, delta * 3.5)
	var r := ease_out(_recoil)
	anim_pos = Vector3(0.0, 0.02, 0.06) * r
	anim_rot = Vector3(22.0, 0.0, 3.0) * r
	if not can_act or player.tool_blocked or not cooldown_ready():
		return
	if Input.is_action_just_pressed(&"use"):
		if not player.inventory.remove(&"flare_shell", 1):
			Audio.play_sfx(&"ui_click", player.get_eye_position(), -4.0)
			Game.notify("No flare shells", &"warning")
			start_cooldown(0.4)
			return
		var dir := player.get_look_direction()
		var from := player.get_eye_position() + dir * 0.6
		var parent: Node = Game.world if Game.world else player.get_parent()
		var p := PlayerProjectile.launch(parent, PlayerProjectile.Kind.SHELL, &"flare_shell", from, dir * 55.0 + Vector3.UP * 6.0, tool_value("damage", 20.0), player)
		p.burn_time = 7.5
		Audio.play_sfx(&"flaregun_fire", player.get_eye_position(), 2.0)
		Events.noise_emitted.emit(player.global_position, 160.0, player)
		player.add_trauma(0.3)
		player.head.kick(2.5)
		_recoil = 1.0
		start_cooldown(1.2)

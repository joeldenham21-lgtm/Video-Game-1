extends MeleeTool
## Knife / stone knife: a quick diagonal slash (fast wind-up, short follow-through). Counts as the
## "knife" harvest family — skinning and butchering carcasses, cutting fibre and bark.


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	t_windup = 0.14
	t_strike = 0.075
	t_follow = 0.09
	t_recover = 0.22
	super.setup(p, vm, id)
	damage_type = &"cut"
	harvest_family = &"knife"
	swing_sfx = &"axe_swing"
	noise_radius = 8.0
	trauma_hit = 0.1
	windup_pos = Vector3(0.06, 0.06, 0.06)
	windup_rot = Vector3(18.0, -32.0, -30.0)
	strike_pos = Vector3(-0.14, -0.04, -0.12)
	strike_rot = Vector3(-12.0, 38.0, 26.0)
	follow_pos = Vector3(-0.17, -0.07, -0.08)
	follow_rot = Vector3(-18.0, 46.0, 30.0)
	recoil_rot = Vector3(-6.0, 12.0, 8.0)
	sprint_pos = Vector3(0.02, -0.06, 0.06)
	sprint_rot = Vector3(-24.0, 6.0, 20.0)


func build_visual() -> void:
	rest_pos = Vector3(0.22, -0.36, 0.0)
	var tip_dir := Vector3(-0.28, 0.48, -0.83).normalized()
	var edge_dir := Vector3(-0.45, -0.85, 0.2)
	var grip_cam := Vector3(0.14, -0.15, -0.29)
	# Model: tip toward −Z, edge toward −Y.
	var zb := -tip_dir
	var yb := -(edge_dir - tip_dir * edge_dir.dot(tip_dir)).normalized()
	var xb := yb.cross(zb).normalized()
	var basis := Basis(xb, yb, zb)
	var holder := Node3D.new()
	holder.name = "Knife"
	var grip_local := Vector3(0.0, -0.002, 0.055)
	holder.transform = Transform3D(basis, grip_cam - rest_pos - basis * grip_local)
	model.add_child(holder)
	var ext := FPModels.external(item_id)
	if ext:
		holder.add_child(ext)
	else:
		var mi := MeshInstance3D.new()
		mi.mesh = FPModels.knife_mesh(item_id)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.add_child(mi)
	var elbow := basis.inverse() * elbow_toward(grip_cam, ELBOW_R)
	var arm := FPHands.make_arm(&"grip", false, grip_local, Vector3(0, 0, -1), elbow)
	holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


func idle_rot() -> Vector3:
	var t := Time.get_ticks_msec() * 0.001
	return Vector3(sin(t * 1.1) * 0.8, sin(t * 0.8) * 0.6, sin(t * 0.6) * 0.5)

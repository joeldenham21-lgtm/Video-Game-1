extends MeleeTool
## Axes (stone axe, hatchet, felling axe), hammer and pickaxe. A diagonal overhead chop: the head is
## drawn back over the right shoulder (anticipation), whips down-left through the target and either bites
## (hit-stop + recoil) or follows through. Felling axes are two-handed and slower.

var two_handed := false


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	var ttype := StringName(ItemDB.get_item(id).get("tool", {}).get("type", "axe"))
	two_handed = id == &"felling_axe" or ttype == &"pickaxe"
	if two_handed:
		t_windup = 0.42
		t_strike = 0.11
		t_follow = 0.14
		t_recover = 0.5
	super.setup(p, vm, id)
	match tool_type:
		&"hammer":
			damage_type = &"blunt"
			harvest_family = &"hand"
			swing_sfx = &"axe_swing"
			noise_radius = 20.0
		&"pickaxe":
			damage_type = &"pierce"
			harvest_family = &"pickaxe"
		_:
			damage_type = &"cut"
			harvest_family = &"axe"
	sway_scale = 0.8 if two_handed else 1.0
	if two_handed:
		windup_pos = Vector3(0.1, 0.22, 0.16)
		windup_rot = Vector3(70.0, -18.0, -38.0)
		strike_pos = Vector3(-0.12, -0.06, -0.14)
		strike_rot = Vector3(-62.0, 16.0, 18.0)
		follow_pos = Vector3(-0.16, -0.16, -0.08)
		follow_rot = Vector3(-88.0, 22.0, 26.0)
		recoil_rot = Vector3(-30.0, 8.0, 8.0)
		trauma_hit = 0.26
	else:
		windup_pos = Vector3(0.06, 0.16, 0.12)
		windup_rot = Vector3(62.0, -14.0, -30.0)
		strike_pos = Vector3(-0.1, -0.06, -0.12)
		strike_rot = Vector3(-58.0, 14.0, 16.0)
		follow_pos = Vector3(-0.13, -0.14, -0.08)
		follow_rot = Vector3(-82.0, 18.0, 22.0)
		recoil_rot = Vector3(-24.0, 6.0, 6.0)
	sprint_pos = Vector3(0.05, -0.06, 0.1)
	sprint_rot = Vector3(-22.0, 18.0, 16.0)


func build_visual() -> void:
	var ext := FPModels.external(item_id)
	var variant: StringName = item_id
	if tool_type == &"hammer":
		variant = &"hammer"
	elif tool_type == &"pickaxe":
		variant = &"pickaxe"
	elif variant != &"stone_axe" and variant != &"felling_axe":
		variant = &"hatchet"
	# Pivot ≈ right shoulder/elbow; the model is placed so the grip sits low right in view.
	rest_pos = Vector3(0.26, -0.42, 0.02)
	var handle_dir := Vector3(-0.3, 0.8, -0.52).normalized()
	var blade_dir := Vector3(-0.85, 0.05, -0.45)
	var grip_y := 0.085
	var grip_cam := Vector3(0.19, -0.2, -0.37)
	if two_handed:
		handle_dir = Vector3(-0.38, 0.7, -0.6).normalized()
		grip_y = 0.07
		grip_cam = Vector3(0.2, -0.26, -0.32)
	var y := handle_dir
	var zn := -(blade_dir - y * blade_dir.dot(y)).normalized()
	var x := y.cross(zn).normalized()
	var basis := Basis(x, y, zn)
	var holder := Node3D.new()
	holder.name = "Axe"
	holder.transform = Transform3D(basis, grip_cam - rest_pos - basis * Vector3(0.0, grip_y, 0.0))
	model.add_child(holder)
	var mi := MeshInstance3D.new()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if ext:
		holder.add_child(ext)
	else:
		mi.mesh = FPModels.axe_mesh(variant)
		holder.add_child(mi)
	# Hands (in the axe's own frame so they swing with it).
	var elbow_r := basis.inverse() * Vector3(0.38, -0.5, 0.78)
	var arm := FPHands.make_arm(&"grip", false, Vector3(0.0, grip_y, 0.0), Vector3.UP, elbow_r)
	holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)
	if two_handed:
		var elbow_l := basis.inverse() * Vector3(-0.35, -0.55, 0.75)
		var arm_l := FPHands.make_arm(&"grip", true, Vector3(0.0, grip_y + 0.3, 0.0), Vector3.UP, elbow_l)
		holder.add_child(arm_l)
		if viewmodel and viewmodel.has_method(&"register_arm"):
			viewmodel.call(&"register_arm", arm_l)


func idle_rot() -> Vector3:
	# A faint wrist sway so the tool never looks frozen.
	var t := Time.get_ticks_msec() * 0.001
	return Vector3(sin(t * 0.9) * 0.6, sin(t * 0.7) * 0.5, 0.0)

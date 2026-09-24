extends HeldItem
## Paper map (both hands) or baseplate compass (right hand). `use`/`aim` brings it up close to read.
## The compass needle is live: it settles toward magnetic north (−Z) with a damped swing as you turn.
## (The full-screen map is the UI stream's `map` screen; this is the physical item in your hands.)

var is_compass := false
var _raise := 0.0
var _needle: MeshInstance3D = null
var _needle_angle := 0.0
var _needle_vel := 0.0
var _holder: Node3D = null


func build_visual() -> void:
	is_compass = item_id == &"compass"
	rest_pos = Vector3(0.0, -0.3, 0.0)
	sprint_pos = Vector3(0.0, -0.1, 0.06)
	sprint_rot = Vector3(-24.0, 0.0, 0.0)
	_holder = Node3D.new()
	_holder.name = "MapCompass"
	model.add_child(_holder)
	if is_compass:
		var basis := Basis.from_euler(Vector3(deg_to_rad(50.0), deg_to_rad(-10.0), 0.0))
		_holder.transform = Transform3D(basis, Vector3(0.1, -0.2, -0.3) - rest_pos)
		var data := FPModels.compass_mesh()
		var mi := MeshInstance3D.new()
		mi.mesh = data["mesh"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_holder.add_child(mi)
		_needle = MeshInstance3D.new()
		_needle.mesh = data["needle"]
		_needle.position = Vector3(0.0, 0.0065, 0.0)
		_needle.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_holder.add_child(_needle)
		var arm := FPHands.make_arm(&"hold", false, Vector3(0.004, -0.02, 0.02), Vector3(0, 0, -1), basis.inverse() * elbow_toward(Vector3(0.1, -0.2, -0.3), ELBOW_R))
		_holder.add_child(arm)
		_register(arm)
	else:
		var basis := Basis.from_euler(Vector3(deg_to_rad(-38.0), 0.0, 0.0))
		_holder.transform = Transform3D(basis, Vector3(0.0, -0.22, -0.36) - rest_pos)
		var mi := MeshInstance3D.new()
		mi.mesh = FPModels.map_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_holder.add_child(mi)
		for side in [-1.0, 1.0]:
			var arm := FPHands.make_arm(&"pinch", side < 0.0, Vector3(float(side) * 0.15, -0.04, -0.012), Vector3(0, 1, 0),
				basis.inverse() * elbow_toward(Vector3(float(side) * 0.15, -0.26, -0.36), ELBOW_L if side < 0.0 else ELBOW_R))
			_holder.add_child(arm)
			_register(arm)


func _register(arm: Node3D) -> void:
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


func item_process(delta: float, can_act: bool) -> void:
	var want := can_act and not player.tool_blocked and (Input.is_action_pressed(&"aim") or Input.is_action_pressed(&"use"))
	_raise = move_toward(_raise, 1.0 if want else 0.0, delta * 3.0)
	var k := smooth(_raise)
	if is_compass:
		anim_pos = Vector3(-0.08, 0.1, 0.06) * k
		anim_rot = Vector3(-8.0, 8.0, 0.0) * k
		_update_needle(delta)
	else:
		anim_pos = Vector3(0.0, 0.12, 0.1) * k
		anim_rot = Vector3(22.0, 0.0, 0.0) * k


func _update_needle(delta: float) -> void:
	# Needle angle in the compass frame so that it points to world −Z (north).
	var n_local := _holder.global_basis.inverse() * Vector3.FORWARD
	var target := atan2(-n_local.x, -n_local.z)
	var err := wrapf(target - _needle_angle, -PI, PI)
	_needle_vel += err * 60.0 * delta
	_needle_vel *= 1.0 - minf(5.0 * delta, 1.0)
	_needle_angle += _needle_vel * delta
	_needle.rotation.y = _needle_angle

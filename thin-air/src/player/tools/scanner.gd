extends HeldItem
## Survey scanner (Subnautica-style): hold `use` on anything in group "scannable" (collider or its parent)
## that implements get_scan_id(). Progress shows on the device screen and through
## Events.interaction_progress; on completion emits Events.scan_completed(id), records it in
## Game.flags[&"scanned"] and unlocks blueprints (target.get_scan_unlocks() / meta "unlocks") through
## Blueprints.unlock() when that helper exists.

const SCAN_TIME := 2.6
const BLUEPRINTS_PATH := "res://src/items/blueprints.gd"
const MASK := 1 | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 9)

var progress := 0.0
var target: Node = null
var _ray: RayCast3D = null
var _screen_mat: ShaderMaterial = null
var _done_flash := 0.0
var _loop: AudioStreamPlayer3D = null
var _beam: SpotLight3D = null
var _scanning := false
var _holder: Node3D = null
var _check_t := 0.0
var _target_done := false


func build_visual() -> void:
	rest_pos = Vector3(0.1, -0.34, 0.0)
	sprint_pos = Vector3(0.04, -0.08, 0.06)
	sprint_rot = Vector3(-30.0, 10.0, 10.0)
	_holder = Node3D.new()
	_holder.name = "Scanner"
	# Held upright in front, screen tilted toward the eyes.
	var basis := Basis.from_euler(Vector3(deg_to_rad(-28.0), deg_to_rad(-8.0), deg_to_rad(-4.0)))
	var grip_cam := Vector3(0.08, -0.25, -0.36)
	_holder.transform = Transform3D(basis, grip_cam - rest_pos)
	model.add_child(_holder)
	var ext := FPModels.external(item_id)
	if ext:
		_holder.add_child(ext)
	else:
		var data := FPModels.scanner_mesh()
		var mi := MeshInstance3D.new()
		mi.mesh = data["mesh"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_holder.add_child(mi)
	# LCD.
	var screen := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(0.074, 0.088)
	_screen_mat = FPMaterials.screen()
	qm.material = _screen_mat
	screen.mesh = qm
	screen.position = Vector3(0.0, 0.098, 0.0196)
	screen.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_holder.add_child(screen)
	# Right hand grips the lower body, left hand steadies it from the side.
	var arm_r := FPHands.make_arm(&"hold", false, Vector3(0.03, 0.03, 0.0), Vector3(0, 1, 0), basis.inverse() * elbow_toward(grip_cam, ELBOW_R))
	_holder.add_child(arm_r)
	var arm_l := FPHands.make_arm(&"hold", true, Vector3(-0.034, 0.045, 0.0), Vector3(0, 1, 0), basis.inverse() * elbow_toward(grip_cam, ELBOW_L))
	_holder.add_child(arm_l)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm_r)
		viewmodel.call(&"register_arm", arm_l)
	# Scan ray from the camera.
	_ray = RayCast3D.new()
	_ray.enabled = false
	_ray.collide_with_areas = true
	_ray.collision_mask = MASK
	_ray.target_position = Vector3(0.0, 0.0, -tool_value("range", 6.0))
	add_child(_ray)
	_ray.add_exception(player)
	if not Settings.is_mobile():
		_beam = SpotLight3D.new()
		_beam.light_color = Color(0.45, 0.95, 0.85)
		_beam.light_energy = 0.0
		_beam.spot_range = tool_value("range", 6.0) + 1.0
		_beam.spot_angle = 9.0
		_beam.spot_attenuation = 0.6
		_beam.position = Vector3(-0.012, 0.13, -0.025)
		_beam.rotation_degrees = Vector3(28.0, 0.0, 0.0)
		_holder.add_child(_beam)


func on_holster() -> void:
	_stop_scan(true)


func item_process(delta: float, can_act: bool) -> void:
	_done_flash = move_toward(_done_flash, 0.0, delta * 1.5)
	# Keep the ray on the camera axis (this node moves with the viewmodel).
	_ray.global_transform = player.camera.global_transform
	_check_t -= delta
	if _check_t <= 0.0 or _scanning:
		_check_t = 0.1
		_ray.force_raycast_update()
		var t := _resolve(_ray.get_collider() if _ray.is_colliding() else null)
		if t != target:
			if _scanning:
				_stop_scan(true)
			target = t
			_target_done = target != null and _already_scanned(target)
	var scannable := target != null and not _target_done
	var wants := can_act and not player.tool_blocked and Input.is_action_pressed(&"use")
	if wants and scannable:
		if not _scanning:
			_scanning = true
			busy = true
			_loop = Audio.play_loop(&"scan_loop", self, -8.0)
		var dur := float(target.call(&"get_scan_time")) if target.has_method(&"get_scan_time") else SCAN_TIME
		progress = minf(progress + delta / maxf(dur, 0.1), 1.0)
		Events.interaction_progress.emit(progress)
		player.speed_cap = PlayerMotion.WALK_SPEED
		if progress >= 1.0:
			_complete()
	elif _scanning:
		_stop_scan(true)
	if wants and target != null and not scannable and Input.is_action_just_pressed(&"use"):
		Audio.play_sfx(&"ui_back", player.get_eye_position(), -8.0)
	# Screen + beam.
	_screen_mat.set_shader_parameter(&"progress", progress)
	_screen_mat.set_shader_parameter(&"target_found", 1.0 if scannable else (0.35 if target else 0.0))
	_screen_mat.set_shader_parameter(&"done_flash", _done_flash)
	if _beam:
		_beam.light_energy = move_toward(_beam.light_energy, 1.6 if _scanning else 0.0, delta * 8.0)
	anim_pos = anim_pos.lerp(Vector3(0.0, 0.03, -0.03) if _scanning else Vector3.ZERO, 1.0 - exp(-8.0 * delta))
	var t2 := Time.get_ticks_msec() * 0.001
	anim_rot = Vector3(sin(t2 * 31.0), sin(t2 * 27.0), 0.0) * (0.25 if _scanning else 0.0)


func get_speed_cap() -> float:
	return PlayerMotion.WALK_SPEED if _scanning else INF


static func _resolve(col: Object) -> Node:
	var n := col as Node
	if n == null:
		return null
	if n.is_in_group(&"scannable") and n.has_method(&"get_scan_id"):
		return n
	var p := n.get_parent()
	if p and p.is_in_group(&"scannable") and p.has_method(&"get_scan_id"):
		return p
	return null


static func _scanned_list() -> Array:
	var a: Variant = Game.get_flag(&"scanned", [])
	if not (a is Array):
		a = []
	return a


func _already_scanned(t: Node) -> bool:
	return _scanned_list().has(String(t.call(&"get_scan_id")))


func _stop_scan(cancel: bool) -> void:
	if _scanning and cancel and progress < 1.0:
		Events.interaction_progress.emit(-1.0)
	_scanning = false
	busy = false
	progress = 0.0
	if _loop and is_instance_valid(_loop):
		_loop.stop()
		_loop.queue_free()
	_loop = null


func _complete() -> void:
	var id := StringName(target.call(&"get_scan_id"))
	var list := _scanned_list().duplicate()
	list.append(String(id))
	Game.set_flag(&"scanned", list)
	Events.interaction_progress.emit(1.0)
	Events.scan_completed.emit(id)
	Audio.play_sfx(&"scan_done", player.get_eye_position())
	_done_flash = 1.0
	var unlocks: Array = []
	if target.has_method(&"get_scan_unlocks"):
		unlocks = target.call(&"get_scan_unlocks")
	elif target.has_meta(&"unlocks"):
		unlocks = target.get_meta(&"unlocks")
	var bp: Script = load(BLUEPRINTS_PATH) if ResourceLoader.exists(BLUEPRINTS_PATH) else null
	for u in unlocks:
		if bp and bp.has_method(&"unlock"):
			bp.call(&"unlock", StringName(u))
		else:
			# Fallback: record directly in the contract's storage.
			var bps: Variant = Game.get_flag(&"blueprints", [])
			if not (bps is Array):
				bps = []
			if not (bps as Array).has(String(u)):
				(bps as Array).append(String(u))
				Game.set_flag(&"blueprints", bps)
				Events.blueprint_unlocked.emit(StringName(u))
	var nm := String(target.get_meta(&"scan_name", "")) if target.has_meta(&"scan_name") else String(id).capitalize()
	Game.notify("Scan complete: %s" % nm, &"discovery")
	_stop_scan(false)
	target = null

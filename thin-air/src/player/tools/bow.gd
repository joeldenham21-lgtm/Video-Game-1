extends HeldItem
## Self bow. Hold `use` to nock and draw (≈0.9 s to full draw), release to loose an arrow whose speed
## scales with the draw (15–58 m/s, gravity drop, drag). Holding at full draw costs stamina and grows
## a tremor; `aim` narrows the FOV slightly. Consumes arrows; arrows stick and can be recovered.

const DRAW_TIME := 0.9
const HOLD_STAMINA := 3.0
## Full-draw anchor (corner of the mouth, just below and right of the eye) and drawing elbow, camera space.
## The string hand ends up at the face — below the view — like a real anchor, not floating in front of it.
const ANCHOR_CAM := Vector3(0.035, -0.1, -0.07)
const DRAW_ELBOW_CAM := Vector3(0.36, -0.1, 0.22)
const REST_ELBOW := Vector3(0.5, -0.2, 0.84)

var draw := 0.0
var drawing := false
var _hold_t := 0.0
var _bow_mat: ShaderMaterial = null
var _bow_mi: MeshInstance3D = null
var _string_top: MeshInstance3D = null
var _string_bot: MeshInstance3D = null
var _arrow_mi: MeshInstance3D = null
var _hand_r: Node3D = null
var _bow_root: Node3D = null
var _loose_kick := 0.0
var _warned := false
var _aim := 0.0
var _draw_sfx_played := false


func build_visual() -> void:
	rest_pos = Vector3(-0.02, -0.3, 0.0)
	sprint_pos = Vector3(-0.02, -0.08, 0.06)
	sprint_rot = Vector3(-10.0, -12.0, -18.0)
	_bow_root = Node3D.new()
	_bow_root.name = "Bow"
	# Bow held in the left hand, canted ~12°, riser low-left in view.
	var grip_cam := Vector3(-0.1, -0.12, -0.52)
	_bow_root.transform = Transform3D(Basis.from_euler(Vector3(deg_to_rad(4.0), deg_to_rad(6.0), deg_to_rad(12.0))), grip_cam - rest_pos)
	model.add_child(_bow_root)
	_bow_mi = MeshInstance3D.new()
	_bow_mi.mesh = FPModels.bow_mesh()
	_bow_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_bow_mat = _bow_mi.mesh.surface_get_material(0) as ShaderMaterial
	_bow_root.add_child(_bow_mi)
	# Left hand around the grip: handle along +Y (thumb up), forearm toward the camera-left-down.
	var elbow_l := _bow_root.basis.inverse() * elbow_toward(grip_cam, ELBOW_L)
	var arm_l := FPHands.make_arm(&"grip", true, Vector3(0.0, 0.0, 0.0), Vector3.UP, elbow_l)
	_bow_root.add_child(arm_l)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm_l)
	# String halves (thin cylinders re-aimed every frame).
	_string_top = _string_segment()
	_string_bot = _string_segment()
	# Nocked arrow.
	_arrow_mi = MeshInstance3D.new()
	_arrow_mi.mesh = FPModels.arrow_mesh()
	_arrow_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_bow_root.add_child(_arrow_mi)
	# Right hand on the string (three-finger hook).
	_hand_r = FPHands.make_arm(&"hook", false, Vector3.ZERO, Vector3(0, -1, 0), Vector3(0.5, -0.2, 0.84))
	_bow_root.add_child(_hand_r)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", _hand_r)
	_update_string()


func _string_segment() -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0012
	cm.bottom_radius = 0.0012
	cm.height = 1.0
	cm.radial_segments = 5
	cm.rings = 1
	cm.material = FPMaterials.vm(&"cord")
	mi.mesh = cm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_bow_root.add_child(mi)
	return mi


func item_process(delta: float, can_act: bool) -> void:
	var has_arrow := player.inventory.has(&"arrow")
	var want := can_act and not player.tool_blocked and Input.is_action_pressed(&"use")
	if want and not drawing and not has_arrow:
		if not _warned:
			Game.notify("No arrows", &"warning")
			_warned = true
		want = false
	if not Input.is_action_pressed(&"use"):
		_warned = false
	if want and cooldown_ready():
		if not drawing:
			drawing = true
			_hold_t = 0.0
			_draw_sfx_played = false
		draw = move_toward(draw, 1.0, delta / DRAW_TIME * (0.75 if player.vitals.stamina < 10.0 else 1.0))
		if not _draw_sfx_played:
			Audio.play_sfx(&"bow_draw", player.get_eye_position(), -6.0)
			_draw_sfx_played = true
		if draw >= 1.0:
			_hold_t += delta
			if not player.vitals.drain_stamina(HOLD_STAMINA * delta):
				_loose()
	elif drawing:
		if draw > 0.15 and has_arrow:
			_loose()
		else:
			drawing = false
	else:
		draw = move_toward(draw, 0.0, delta * 4.0)
	busy = drawing
	_aim = move_toward(_aim, 1.0 if (can_act and Input.is_action_pressed(&"aim")) else 0.0, delta * 5.0)
	# Pose: drawing brings the bow up to the eye line, canted toward vertical.
	var d := smooth(draw)
	var tremor := 0.0
	if _hold_t > 2.2:
		tremor = clampf((_hold_t - 2.2) / 3.0, 0.0, 1.0) * (1.5 - player.vitals.stamina / 100.0)
	var t := Time.get_ticks_msec() * 0.001
	var shake := Vector3(sin(t * 17.0), sin(t * 13.0 + 1.0), 0.0) * tremor * 0.9
	_loose_kick = move_toward(_loose_kick, 0.0, delta * 5.0)
	anim_pos = Vector3(0.07, 0.065, -0.04) * d + Vector3(0.0, 0.0, 0.03) * _loose_kick
	anim_rot = Vector3(3.0, 6.0, -8.0) * d + shake + Vector3(-6.0, 0.0, 0.0) * _loose_kick
	_bow_mat.set_shader_parameter(&"bend", 0.22 * d)
	_arrow_mi.visible = has_arrow and (drawing or draw > 0.01 or _loose_kick <= 0.0)
	_update_string()


func _update_string() -> void:
	var d := smooth(draw)
	var bend := 0.22 * d
	var tip_y := FPModels.BOW_HALF - 0.012
	var tip_z := FPModels.bow_limb_z(tip_y) + bend * pow(tip_y - 0.08, 2.0) + 0.004
	var top := Vector3(0.0, tip_y - bend * pow(tip_y - 0.08, 3.0) * 0.8, tip_z)
	var bot := Vector3(0.0, -top.y, tip_z)
	var nock := Vector3(0.0, 0.01, tip_z + 0.005)
	var elbow := REST_ELBOW
	if d > 0.0 and is_inside_tree() and player and player.camera:
		# Pull the nock toward the anchor on the face (bow space ← camera space).
		var cam_to_bow := _bow_root.global_transform.affine_inverse() * player.camera.global_transform
		nock = nock.lerp(cam_to_bow * ANCHOR_CAM, d)
		elbow = REST_ELBOW.lerp((cam_to_bow.basis * (DRAW_ELBOW_CAM - ANCHOR_CAM)).normalized(), d).normalized()
	_place_segment(_string_top, top, nock)
	_place_segment(_string_bot, bot, nock)
	# Arrow rests on the riser and its nock sits on the string.
	var rest := Vector3(-0.012, 0.02, -0.02)
	var dir := (rest - nock).normalized()
	_arrow_mi.transform = Transform3D(Basis.looking_at(dir, Vector3.UP), nock + dir * 0.36)
	# Right hand hooks the string at the nock; the drawing elbow sits high and back.
	var hb := FPHands.grip_basis(Vector3(0.0, -1.0, 0.0), elbow, false)
	_hand_r.transform = Transform3D(hb, nock - hb * FPHands.grip_point(&"hook", false))
	FPHands.aim_forearm(_hand_r, elbow)
	_hand_r.visible = draw > 0.02 or drawing


static func _place_segment(mi: MeshInstance3D, a: Vector3, b: Vector3) -> void:
	var mid := (a + b) * 0.5
	var v := b - a
	var seg_len := v.length()
	if seg_len < 1e-4:
		return
	var y := v / seg_len
	var x := y.cross(Vector3.FORWARD)
	if x.length_squared() < 1e-6:
		x = y.cross(Vector3.RIGHT)
	x = x.normalized()
	var z := x.cross(y).normalized()
	mi.transform = Transform3D(Basis(x, y * seg_len, z), mid)


func _loose() -> void:
	var d := draw
	drawing = false
	draw = 0.0
	_hold_t = 0.0
	_loose_kick = 1.0
	if not player.inventory.remove(&"arrow", 1):
		return
	var speed := PlayerMotion.arrow_speed(d)
	var dir := player.get_look_direction()
	var from := player.get_eye_position() + dir * 0.5
	var dmg := tool_value("damage", 30.0) * (0.3 + 0.7 * d)
	var parent: Node = Game.world if Game.world else player.get_parent()
	PlayerProjectile.launch(parent, PlayerProjectile.Kind.ARROW, &"arrow", from, dir * speed + player.velocity * 0.5, dmg, player)
	Audio.play_sfx(&"bow_release", player.get_eye_position(), -2.0)
	Events.noise_emitted.emit(player.global_position, 6.0, player)
	player.add_trauma(0.05)
	wear(1.0)
	start_cooldown(tool_value("cooldown", 0.5))


func get_fov() -> float:
	if _aim > 0.01 and draw > 0.3:
		return float(Settings.get_value(&"fov", 75.0)) * lerpf(1.0, 0.78, _aim * smooth(draw))
	return 0.0


func get_speed_cap() -> float:
	return PlayerMotion.WALK_SPEED if draw > 0.2 else INF


func get_look_scale() -> float:
	return lerpf(1.0, 0.7, _aim * draw)

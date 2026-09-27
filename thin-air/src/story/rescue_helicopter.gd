class_name RescueHelicopter
extends Node3D
## Rescue One-Six: a single-engine light utility helicopter (AS350-class proportions, 10.7 m rotor) in a plain
## red-and-white rescue scheme, built from primitives (it is only ever seen from a distance and on the pad at
## dawn). Flies a terrain-clear approach from the south-west, decelerates, flares, hovers and lands on the pad
## socket; red anti-collision beacon, white strobes, landing light, rotor blur disc, helicopter_loop sound
## (Doppler) and a snow downwash ring when low. Emits `landed`.

signal landed()

const ROTOR_R := 5.35
const CRUISE := 48.0
const APPROACH_SLOW := 520.0     # m before the hover point where it starts slowing down

var pad: Vector3
var pad_yaw := 0.0
var _curve := Curve3D.new()
var _len := 0.0
var _s := 0.0
var _speed := CRUISE
var _phase := 0          # 0 approach, 1 hover/descend, 2 landed
var _hover_t := 0.0
var _hover_from := Vector3.ZERO
var _t := 0.0
var _mobile := false
var _body: Node3D
var _rotor: Node3D
var _blades: Node3D
var _tail_rotor: Node3D
var _beacon_mat: StandardMaterial3D
var _strobe_mat: StandardMaterial3D
var _beacon_light: OmniLight3D
var _landing_light: SpotLight3D
var _downwash: GPUParticles3D
var _loop: AudioStreamPlayer3D
var _prev_pos := Vector3.ZERO
var _vel := Vector3.ZERO
var _yaw := 0.0
var _pitch := 0.0
var _bank := 0.0


func _ready() -> void:
	_mobile = Settings.is_mobile()
	_build()


## Starts the approach: `pad_pos` = the landing point (skids), `yaw_deg` = heading on the pad.
func start(pad_pos: Vector3, yaw_deg: float, from_dir := Vector3(-0.72, 0.0, 0.69)) -> void:
	pad = pad_pos
	pad_yaw = deg_to_rad(yaw_deg)
	var d := from_dir.normalized()
	var start := pad + d * 2300.0 + Vector3.UP * 420.0
	var hover := pad + d * 45.0 + Vector3.UP * 22.0
	var ctrl := (start + hover) * 0.5 + Vector3(-d.z, 0.0, d.x) * 380.0 + Vector3.UP * 120.0
	var n := 64
	_curve.clear_points()
	for i in n + 1:
		var t := float(i) / n
		var p := start.lerp(ctrl, t).lerp(ctrl.lerp(hover, t), t)
		# keep a safe clearance over the terrain except in the final descent
		var clear := lerpf(90.0, 12.0, smoothstep(0.82, 1.0, t))
		var g := TerrainData.get_height(p.x, p.z) if TerrainData.is_loaded() else -INF
		p.y = maxf(p.y, g + clear)
		_curve.add_point(p)
	_len = _curve.get_baked_length()
	_s = 0.0
	_phase = 0
	global_position = start
	_prev_pos = start
	_yaw = atan2(-(hover - start).x, -(hover - start).z)
	if not Engine.is_editor_hint() and is_inside_tree():
		_loop = Audio.play_loop(&"helicopter_loop", self, 4.0)


## Dev/QA: jump along the approach to `metres` before the hover point.
func skip_to_remaining(metres: float) -> void:
	_s = clampf(_len - metres, 0.0, _len)
	_speed = lerpf(7.0, CRUISE, clampf(metres / APPROACH_SLOW, 0.0, 1.0))
	global_position = _curve.sample_baked(_s, true)
	_prev_pos = global_position
	var ahead := _curve.sample_baked(minf(_len, _s + 5.0), true) - global_position
	_yaw = atan2(-ahead.x, -ahead.z)


func is_landed() -> bool:
	return _phase == 2


func _process(delta: float) -> void:
	_t += delta
	_animate(delta)
	match _phase:
		0:
			var left := _len - _s
			var target := CRUISE if left > APPROACH_SLOW else lerpf(7.0, CRUISE, clampf(left / APPROACH_SLOW, 0.0, 1.0))
			_speed = move_toward(_speed, target, 6.0 * delta)
			_s = minf(_len, _s + _speed * delta)
			global_position = _curve.sample_baked(_s, true)
			if _s >= _len - 0.05:
				_phase = 1
				_hover_t = 0.0
				_hover_from = global_position
		1:
			_hover_t += delta
			var k := clampf(_hover_t / 14.0, 0.0, 1.0)
			var e := k * k * (3.0 - 2.0 * k)
			var p := _hover_from.lerp(pad, e)
			# hold height until over the pad, then settle
			p.y = lerpf(_hover_from.y, pad.y, clampf((e - 0.35) / 0.65, 0.0, 1.0))
			global_position = p
			_yaw = lerp_angle(_yaw, pad_yaw, delta * 0.8)
			if k >= 1.0:
				_phase = 2
				global_position = pad
				landed.emit()
		2:
			pass
	# attitude from velocity: nose down when fast, flare when slowing, bank into turns
	_vel = (global_position - _prev_pos) / maxf(delta, 1e-3)
	_prev_pos = global_position
	var hv := Vector2(_vel.x, _vel.z)
	if _phase == 0 and hv.length() > 1.0:
		var want_yaw := atan2(-_vel.x, -_vel.z)
		var dy := wrapf(want_yaw - _yaw, -PI, PI)
		_yaw += dy * clampf(delta * 1.5, 0.0, 1.0)
		_bank = lerpf(_bank, clampf(dy * 2.2, -0.35, 0.35), delta * 1.5)
	else:
		_bank = lerpf(_bank, 0.0, delta * 2.0)
	# _pitch > 0 = nose down (the body turns by -_pitch about X)
	var want_pitch := clampf(hv.length() / CRUISE, 0.0, 1.0) * 0.12
	if _phase == 0 and _len - _s < APPROACH_SLOW:
		want_pitch = -0.09 * clampf(_speed / CRUISE, 0.0, 1.0)
	if _phase == 2:
		want_pitch = 0.0
	_pitch = lerpf(_pitch, want_pitch, delta * 1.2)
	_body.rotation = Vector3(-_pitch, 0.0, _bank)
	rotation = Vector3(0.0, _yaw, 0.0)
	_update_downwash()


func _animate(delta: float) -> void:
	# visible blades turn slowly (a camera would strobe them); the blur disc carries the speed
	_blades.rotate_y(delta * (4.2 if _phase < 2 else 3.4))
	_tail_rotor.rotate_x(delta * 21.0)
	var beacon := fmod(_t, 1.1) < 0.12
	_beacon_mat.emission_energy_multiplier = 9.0 if beacon else 0.4
	_beacon_light.light_energy = 2.2 if beacon else 0.0
	var strobe := fmod(_t + 0.4, 1.35) < 0.06
	_strobe_mat.emission_energy_multiplier = 14.0 if strobe else 0.0


func _update_downwash() -> void:
	if _downwash == null:
		return
	var g := TerrainData.get_height(global_position.x, global_position.z) if TerrainData.is_loaded() else pad.y
	var h := global_position.y - g
	_downwash.emitting = h < 32.0 and _t > 1.0
	_downwash.global_position = Vector3(global_position.x, g + 0.2, global_position.z)
	_downwash.amount_ratio = clampf(1.15 - h / 32.0, 0.15, 1.0)


# ============================================================================================ model

func _mat(c: Color, rough: float, metal := 0.0, clearcoat := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if clearcoat > 0.0:
		m.clearcoat_enabled = true
		m.clearcoat = clearcoat
		m.clearcoat_roughness = 0.2
	return m


func _part(mesh: Mesh, m: Material, pos: Vector3, rot := Vector3.ZERO, scl := Vector3.ONE, parent: Node3D = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = m
	mi.position = pos
	mi.rotation = rot
	mi.scale = scl
	(parent if parent else _body).add_child(mi)
	return mi


func _build() -> void:
	_body = Node3D.new()
	_body.name = "Body"
	add_child(_body)
	var red := _mat(Color(0.56, 0.05, 0.04), 0.32, 0.1, 0.6)
	var white := _mat(Color(0.86, 0.86, 0.84), 0.35, 0.05, 0.5)
	var glass := _mat(Color(0.03, 0.045, 0.055), 0.04, 0.6)
	var dark := _mat(Color(0.07, 0.07, 0.075), 0.55, 0.5)
	var metal := _mat(Color(0.45, 0.46, 0.47), 0.38, 0.85)
	# cabin: a stretched capsule, white belly band, glass nose
	var cab := CapsuleMesh.new()
	cab.radius = 0.86
	cab.height = 3.9
	cab.radial_segments = 20
	cab.rings = 8
	_part(cab, red, Vector3(0.0, 1.45, -0.2), Vector3(PI * 0.5, 0.0, 0.0), Vector3(0.98, 1.0, 1.12))
	var belly := CapsuleMesh.new()
	belly.radius = 0.8
	belly.height = 3.5
	belly.radial_segments = 20
	belly.rings = 6
	_part(belly, white, Vector3(0.0, 1.22, -0.1), Vector3(PI * 0.5, 0.0, 0.0), Vector3(1.03, 1.0, 0.8))
	var nose := SphereMesh.new()
	nose.radius = 0.82
	nose.height = 1.5
	nose.radial_segments = 20
	nose.rings = 10
	_part(nose, glass, Vector3(0.0, 1.55, -1.72), Vector3.ZERO, Vector3(1.0, 0.95, 1.1))
	var side_window := BoxMesh.new()
	side_window.size = Vector3(1.78, 0.5, 1.2)
	_part(side_window, glass, Vector3(0.0, 1.75, -0.35))
	# engine fairing and mast
	var hump := CapsuleMesh.new()
	hump.radius = 0.5
	hump.height = 2.4
	_part(hump, red, Vector3(0.0, 2.2, 0.55), Vector3(PI * 0.5, 0.0, 0.0), Vector3(0.9, 0.75, 1.0))
	var mast := CylinderMesh.new()
	mast.top_radius = 0.1
	mast.bottom_radius = 0.16
	mast.height = 0.55
	_part(mast, dark, Vector3(0.0, 2.72, 0.15))
	# tail boom, fins, stabiliser, tail rotor
	var boom := CylinderMesh.new()
	boom.top_radius = 0.15
	boom.bottom_radius = 0.36
	boom.height = 5.3
	boom.radial_segments = 14
	_part(boom, red, Vector3(0.0, 1.72, 4.3), Vector3(PI * 0.5, 0.0, 0.0))
	var stripe := CylinderMesh.new()
	stripe.top_radius = 0.2
	stripe.bottom_radius = 0.28
	stripe.height = 1.3
	_part(stripe, white, Vector3(0.0, 1.72, 4.2), Vector3(PI * 0.5, 0.0, 0.0), Vector3(1.02, 1.0, 1.02))
	var fin := BoxMesh.new()
	fin.size = Vector3(0.07, 1.35, 0.85)
	_part(fin, red, Vector3(0.0, 2.25, 6.85), Vector3(-0.35, 0.0, 0.0))
	var ventral := BoxMesh.new()
	ventral.size = Vector3(0.06, 0.55, 0.5)
	_part(ventral, red, Vector3(0.0, 1.35, 6.8), Vector3(0.3, 0.0, 0.0))
	var stab := BoxMesh.new()
	stab.size = Vector3(2.0, 0.05, 0.42)
	_part(stab, red, Vector3(0.0, 1.72, 6.0))
	for sx in [-1.0, 1.0]:
		var end_plate := BoxMesh.new()
		end_plate.size = Vector3(0.04, 0.42, 0.36)
		_part(end_plate, red, Vector3(sx * 1.0, 1.78, 6.05))
	_tail_rotor = Node3D.new()
	_tail_rotor.position = Vector3(-0.16, 2.35, 7.05)
	_body.add_child(_tail_rotor)
	var tdisc := CylinderMesh.new()
	tdisc.top_radius = 0.93
	tdisc.bottom_radius = 0.93
	tdisc.height = 0.02
	tdisc.radial_segments = 24
	var blur := _mat(Color(0.12, 0.12, 0.13, 0.22), 0.6)
	blur.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	blur.cull_mode = BaseMaterial3D.CULL_DISABLED
	blur.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_part(tdisc, blur, Vector3.ZERO, Vector3(0.0, 0.0, PI * 0.5), Vector3.ONE, _tail_rotor)
	var tblade := BoxMesh.new()
	tblade.size = Vector3(0.03, 1.8, 0.12)
	_part(tblade, dark, Vector3.ZERO, Vector3.ZERO, Vector3.ONE, _tail_rotor)
	# skids and cross tubes
	for sx in [-1.0, 1.0]:
		var skid := CylinderMesh.new()
		skid.top_radius = 0.045
		skid.bottom_radius = 0.045
		skid.height = 3.3
		skid.radial_segments = 8
		_part(skid, metal, Vector3(sx * 1.12, 0.05, -0.15), Vector3(PI * 0.5, 0.0, 0.0))
		var tip := CylinderMesh.new()
		tip.top_radius = 0.045
		tip.bottom_radius = 0.045
		tip.height = 0.45
		tip.radial_segments = 8
		_part(tip, metal, Vector3(sx * 1.12, 0.16, -1.92), Vector3(PI * 0.5 - 0.55, 0.0, 0.0))
		for sz in [-0.95, 0.75]:
			var strut := CylinderMesh.new()
			strut.top_radius = 0.045
			strut.bottom_radius = 0.05
			strut.height = 1.05
			strut.radial_segments = 8
			_part(strut, metal, Vector3(sx * 0.9, 0.5, sz), Vector3(0.0, 0.0, sx * 0.42))
	# main rotor: slowly turning blades + a faint blur disc
	_rotor = Node3D.new()
	_rotor.position = Vector3(0.0, 3.02, 0.15)
	_body.add_child(_rotor)
	var hub := CylinderMesh.new()
	hub.top_radius = 0.28
	hub.bottom_radius = 0.28
	hub.height = 0.16
	_part(hub, dark, Vector3.ZERO, Vector3.ZERO, Vector3.ONE, _rotor)
	var disc := CylinderMesh.new()
	disc.top_radius = ROTOR_R
	disc.bottom_radius = ROTOR_R
	disc.height = 0.01
	disc.radial_segments = 40
	var dblur := _mat(Color(0.1, 0.1, 0.11, 0.13), 0.6)
	dblur.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	dblur.cull_mode = BaseMaterial3D.CULL_DISABLED
	dblur.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_part(disc, dblur, Vector3(0.0, 0.03, 0.0), Vector3.ZERO, Vector3.ONE, _rotor)
	_blades = Node3D.new()
	_rotor.add_child(_blades)
	for i in 3:
		var bl := BoxMesh.new()
		bl.size = Vector3(0.34, 0.035, ROTOR_R - 0.25)
		var a := TAU * float(i) / 3.0
		var off := Vector3(sin(a), 0.0, cos(a)) * (ROTOR_R * 0.5 + 0.1)
		_part(bl, dark, off, Vector3(0.0, a, 0.0), Vector3.ONE, _blades)
	# lights: red beacon on the fairing, white strobes at the stabiliser tips, landing light under the nose
	_beacon_mat = _mat(Color(0.9, 0.05, 0.03), 0.3)
	_beacon_mat.emission_enabled = true
	_beacon_mat.emission = Color(1.0, 0.06, 0.03)
	var bm := SphereMesh.new()
	bm.radius = 0.07
	bm.height = 0.1
	_part(bm, _beacon_mat, Vector3(0.0, 2.62, 1.35))
	_part(bm, _beacon_mat, Vector3(0.0, 0.52, 0.2))
	_strobe_mat = _mat(Color(0.95, 0.95, 1.0), 0.2)
	_strobe_mat.emission_enabled = true
	_strobe_mat.emission = Color(1.0, 1.0, 1.0)
	var sm := SphereMesh.new()
	sm.radius = 0.05
	sm.height = 0.08
	for sx in [-1.0, 1.0]:
		_part(sm, _strobe_mat, Vector3(sx * 1.02, 1.95, 6.05))
	_beacon_light = OmniLight3D.new()
	_beacon_light.light_color = Color(1.0, 0.12, 0.08)
	_beacon_light.omni_range = 9.0
	_beacon_light.shadow_enabled = false
	_beacon_light.position = Vector3(0.0, 2.75, 1.35)
	_body.add_child(_beacon_light)
	_landing_light = SpotLight3D.new()
	_landing_light.light_color = Color(1.0, 0.96, 0.9)
	_landing_light.light_energy = 5.0
	_landing_light.spot_range = 140.0
	_landing_light.spot_angle = 16.0
	_landing_light.shadow_enabled = false
	_landing_light.position = Vector3(0.0, 0.75, -1.9)
	_landing_light.rotation = Vector3(-0.45, 0.0, 0.0)
	_body.add_child(_landing_light)
	_build_downwash()


func _build_downwash() -> void:
	_downwash = GPUParticles3D.new()
	_downwash.name = "Downwash"
	_downwash.top_level = true
	_downwash.amount = 70 if _mobile else 220
	_downwash.lifetime = 1.8
	_downwash.emitting = false
	_downwash.visibility_aabb = AABB(Vector3(-30, -2, -30), Vector3(60, 16, 60))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	pm.emission_ring_axis = Vector3.UP
	pm.emission_ring_radius = 7.5
	pm.emission_ring_inner_radius = 2.0
	pm.emission_ring_height = 0.4
	pm.direction = Vector3(1.0, 0.35, 0.0)
	pm.spread = 180.0
	pm.flatness = 0.85
	pm.initial_velocity_min = 7.0
	pm.initial_velocity_max = 15.0
	pm.radial_velocity_min = 6.0
	pm.radial_velocity_max = 11.0
	pm.gravity = Vector3(0.0, -1.2, 0.0)
	pm.damping_min = 3.0
	pm.damping_max = 5.0
	pm.scale_min = 0.9
	pm.scale_max = 2.4
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.3))
	curve.add_point(Vector2(0.3, 1.0))
	curve.add_point(Vector2(1.0, 1.6))
	var ct := CurveTexture.new()
	ct.curve = curve
	pm.scale_curve = ct
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 0.0))
	grad.set_color(1, Color(1, 1, 1, 0.0))
	grad.add_point(0.15, Color(0.95, 0.97, 1.0, 0.5))
	grad.add_point(0.6, Color(0.95, 0.97, 1.0, 0.25))
	var gt := GradientTexture1D.new()
	gt.gradient = grad
	pm.color_ramp = gt
	_downwash.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(1.6, 1.2)
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_color = Color(0.92, 0.94, 0.97)
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(x - 15.5, y - 15.5).length() / 15.5
			img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - d, 0.0, 1.0) ** 1.8))
	m.albedo_texture = ImageTexture.create_from_image(img)
	q.material = m
	_downwash.draw_pass_1 = q
	add_child(_downwash)


func _exit_tree() -> void:
	if _loop and is_instance_valid(_loop):
		_loop.queue_free()

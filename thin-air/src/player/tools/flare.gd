extends HeldItem
## Road flare. `use` strikes the cap (ignites after a short strike motion); lit, it burns a fierce red for
## its fuel time (default 3 min) with sparks and dense smoke, lighting the snow around you and warning off
## wildlife. `use` again (or `aim` + `use`) throws it; it keeps burning where it lands.

const THROW_SPEED := 13.0

var lit := false
var burn := 0.0
var heat_radius := 1.0
var heat_celsius := 3.0

var _ignite_t := -1.0
var _throw_t := -1.0
var _light: OmniLight3D = null
var _tip: MeshInstance3D = null
var _tip_mat: ShaderMaterial = null
var _fx: Array[CPUParticles3D] = []
var _holder: Node3D = null
var _loop: AudioStreamPlayer3D = null
var _t := 0.0


func build_visual() -> void:
	rest_pos = Vector3(0.22, -0.36, 0.0)
	sprint_pos = Vector3(0.02, -0.04, 0.06)
	sprint_rot = Vector3(-14.0, 8.0, 8.0)
	_holder = Node3D.new()
	_holder.name = "Flare"
	var dir := Vector3(-0.3, 0.85, -0.42).normalized()
	var zn := (Vector3.BACK - dir * Vector3.BACK.dot(dir)).normalized()
	var basis := Basis(dir.cross(zn).normalized(), dir, zn)
	var grip_cam := Vector3(0.19, -0.2, -0.38)
	_holder.transform = Transform3D(basis, grip_cam - rest_pos - basis * Vector3(0.0, 0.07, 0.0))
	model.add_child(_holder)
	var mi := MeshInstance3D.new()
	mi.mesh = FPModels.flare_mesh()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_holder.add_child(mi)
	# Burning end: an emissive plug that glows once lit.
	_tip_mat = FPMaterials.vm_emissive(&"plastic_red", Color(1.0, 0.25, 0.1), 0.0)
	_tip = MeshInstance3D.new()
	var t := FPMesh.new()
	var tube := FPMesh.Tube.new()
	tube.add(Vector3(0, 0.235, 0), 0.0125).add(Vector3(0, 0.245, 0), 0.011).dome_end(2, 0.6)
	t.tube(tube, 12, Vector3.FORWARD, 8.0)
	var am := ArrayMesh.new()
	t.commit(am, _tip_mat)
	_tip.mesh = am
	_tip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_holder.add_child(_tip)
	var arm := FPHands.make_arm(&"grip", false, Vector3(0.0, 0.07, 0.0), Vector3.UP, basis.inverse() * Vector3(0.38, -0.5, 0.78))
	_holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)
	_light = OmniLight3D.new()
	_light.position = Vector3(0.0, 0.3, 0.0)
	_light.light_color = Color(1.0, 0.16, 0.07)
	_light.omni_range = 18.0
	_light.omni_attenuation = 1.3
	_light.shadow_enabled = not Settings.is_mobile() and int(Settings.get_value(&"shadow_quality", 2)) >= 2
	_light.visible = false
	_holder.add_child(_light)
	var mobile := Settings.is_mobile()
	_fx.append(_particles(&"spark", 10 if mobile else 26, 0.45, 0.006, 0.014, 0.6, 2.2, Vector3(0, -2.5, 0), 30.0))
	_fx.append(_particles(&"flame", 8 if mobile else 16, 0.25, 0.04, 0.08, 0.2, 0.6, Vector3(0, 1.0, 0), 20.0))
	if not mobile:
		_fx.append(_particles(&"smoke", 14, 3.0, 0.12, 0.35, 0.3, 0.8, Vector3(0, 0.7, 0), 25.0))


func _particles(kind: StringName, amount: int, life: float, s_min: float, s_max: float, v_min: float, v_max: float, grav: Vector3, spread: float) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.material = FPMaterials.fx(kind)
	p.mesh = q
	p.amount = amount
	p.lifetime = life
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = spread
	p.initial_velocity_min = v_min
	p.initial_velocity_max = v_max
	p.gravity = grav
	p.scale_amount_min = s_min
	p.scale_amount_max = s_max
	var g := Gradient.new()
	match kind:
		&"smoke":
			g.offsets = PackedFloat32Array([0.0, 0.15, 1.0])
			g.colors = PackedColorArray([Color(0.9, 0.5, 0.5, 0.0), Color(0.85, 0.55, 0.55, 0.5), Color(0.6, 0.55, 0.55, 0.0)])
			var c := Curve.new()
			c.add_point(Vector2(0.0, 0.3))
			c.add_point(Vector2(1.0, 1.0))
			p.scale_amount_curve = c
		&"flame":
			g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
			g.colors = PackedColorArray([Color(1.0, 0.8, 0.8, 1.0), Color(1.0, 0.2, 0.1, 0.8), Color(0.6, 0.0, 0.0, 0.0)])
		_:
			g.offsets = PackedFloat32Array([0.0, 1.0])
			g.colors = PackedColorArray([Color(1.0, 0.75, 0.6, 1.0), Color(1.0, 0.2, 0.05, 0.0)])
	p.color_ramp = g
	p.emitting = false
	p.position = Vector3(0.0, 0.245, 0.0)
	_holder.add_child(p)
	return p


func on_holster() -> void:
	# Putting a lit flare away isn't possible — drop it where you stand.
	if lit and _throw_t < 0.0:
		_launch(player.get_look_direction() * 1.5 + Vector3.DOWN)
	_stop_loop()


func _stop_loop() -> void:
	if _loop and is_instance_valid(_loop):
		_loop.stop()
		_loop.queue_free()
	_loop = null


func is_heat_active() -> bool:
	return lit


func item_process(delta: float, can_act: bool) -> void:
	_t += delta
	if _throw_t >= 0.0:
		_throw_t += delta
		var k := smooth(_throw_t / 0.3)
		anim_pos = Vector3(0.04, 0.12, 0.1).lerp(Vector3(-0.06, -0.25, -0.35), k)
		anim_rot = Vector3(40.0, 0.0, 0.0).lerp(Vector3(-50.0, 0.0, 0.0), k)
		if _throw_t > 0.12:
			_holder.visible = false
		if _throw_t > 0.35:
			busy = false
			_throw_t = -1.0
			depleted.emit()
		return
	if _ignite_t >= 0.0:
		_ignite_t += delta
		# Strike: the free hand's motion is implied by a sharp flick of the flare.
		var s := sin(clampf(_ignite_t / 0.45, 0.0, 1.0) * PI)
		anim_pos = Vector3(-0.05, 0.05, 0.02) * s
		anim_rot = Vector3(-20.0, 10.0, 25.0) * s
		if _ignite_t >= 0.3 and not lit:
			_ignite()
		if _ignite_t >= 0.45:
			_ignite_t = -1.0
			busy = false
		return
	anim_pos = anim_pos.lerp(Vector3.ZERO, 1.0 - exp(-8.0 * delta))
	anim_rot = anim_rot.lerp(Vector3.ZERO, 1.0 - exp(-8.0 * delta))
	if lit:
		burn -= delta
		_light.light_energy = 3.2 * (0.8 + 0.12 * sin(_t * 41.0) * sin(_t * 17.0) + 0.08 * sin(_t * 67.0))
		if burn <= 0.0:
			Game.notify("The flare sputters out", &"info")
			_set_fx(false)
			lit = false
			consume_one()
			return
	if not can_act or player.tool_blocked:
		return
	if Input.is_action_just_pressed(&"use"):
		if not lit:
			_ignite_t = 0.0
			busy = true
		else:
			_throw()


func _ignite() -> void:
	lit = true
	var fuel: Dictionary = def.get("fuel", {})
	burn = float(fuel.get("burn_minutes", 3.0)) * 60.0
	Audio.play_sfx(&"flare_ignite", player.get_eye_position(), 0.0)
	_loop = Audio.play_loop(&"flare_loop", _light, -4.0)
	_set_fx(true)
	add_to_group(&"heat_source")
	add_to_group(&"flare")
	Events.noise_emitted.emit(player.global_position, 12.0, player)


func _set_fx(on: bool) -> void:
	_light.visible = on
	_tip_mat.set_shader_parameter(&"emission_energy", 6.0 if on else 0.0)
	for p in _fx:
		p.emitting = on
	if not on:
		remove_from_group(&"heat_source")
		remove_from_group(&"flare")
		_stop_loop()


func _throw() -> void:
	busy = true
	_throw_t = 0.0
	_launch(player.get_look_direction() * THROW_SPEED + Vector3.UP * 2.0 + player.velocity * 0.6)
	Audio.play_sfx(&"spear_throw", player.get_eye_position(), -6.0)
	player.exert(0.3)


func _launch(vel: Vector3) -> void:
	var from := player.get_eye_position() + player.get_look_direction() * 0.5 + player.camera.global_basis.x * 0.2
	var parent: Node = Game.world if Game.world else player.get_parent()
	var p := PlayerProjectile.launch(parent, PlayerProjectile.Kind.FLARE, item_id, from, vel, 0.0, player)
	p.burn_time = burn if lit else 0.0
	_set_fx(false)
	lit = false
	var idx := inventory_index()
	if idx >= 0:
		player.inventory.remove_at(idx, 1)

extends MeleeTool
## Hand torch (and kerosene lantern): a flickering warm OmniLight with flame, ember and smoke particles.
## Light, colour, burn time and warmth come from the item's "light" block in items.json
## ({radius, energy, color, burn_minutes (game minutes), heat_celsius, fuel}).
## While lit it is a heat source (group "heat_source": heat_radius/heat_celsius/is_heat_active) that also
## keeps wildlife wary. Burns down in game time (the inventory slot's 0..1 durability is what's left; the
## next torch of a stack is lit from the last one), goes out underwater. `torch_toggle` douses it and
## relights it from a nearby fire or with the best igniter carried (ItemActions.try_ignite: matches,
## lighter, ferro rod…). An empty lantern is refilled with its light.fuel item (lamp oil) when relit.
## `use` swings it (fire damage).

const RELIGHT_FIRE_DIST := 2.2

var lit := true
var heat_radius := 1.8
var heat_celsius := 4.0
var is_lantern := false

var _light: OmniLight3D = null
var _flame: CPUParticles3D = null
var _embers: CPUParticles3D = null
var _smoke: CPUParticles3D = null
var _burn_minutes := 40.0
var _light_def: Dictionary = {}
var _burn_acc := 0.0
var _t := 0.0
var _base_energy := 1.7
var _loop: AudioStreamPlayer3D = null
var _head := Vector3.ZERO
var _holder: Node3D = null
var _globe_mat: ShaderMaterial = null


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	is_lantern = StringName(ItemDB.get_item(id).get("tool", {}).get("type", "")) == &"lantern"
	t_windup = 0.26
	t_strike = 0.1
	t_follow = 0.1
	t_recover = 0.32
	super.setup(p, vm, id)
	damage_type = &"fire"
	harvest_family = &"hand"
	swing_sfx = &"axe_swing"
	noise_radius = 10.0
	var fuel: Dictionary = def.get("fuel", {})
	_burn_minutes = maxf(float(_light_def.get("burn_minutes", fuel.get("burn_minutes", tool.get("burn_minutes",
		360.0 if is_lantern else 40.0)))), 0.5)
	heat_celsius = float(_light_def.get("heat_celsius", 1.0 if is_lantern else 4.0))
	if is_lantern:
		heat_radius = 1.0
		windup_rot = Vector3(10.0, -4.0, -6.0)
		strike_rot = Vector3(-12.0, 4.0, 6.0)
		follow_rot = Vector3(-14.0, 4.0, 6.0)
	else:
		windup_pos = Vector3(0.04, 0.1, 0.08)
		windup_rot = Vector3(40.0, -10.0, -24.0)
		strike_pos = Vector3(-0.1, -0.05, -0.1)
		strike_rot = Vector3(-45.0, 12.0, 14.0)
		follow_pos = Vector3(-0.12, -0.1, -0.06)
		follow_rot = Vector3(-60.0, 14.0, 18.0)
	sprint_pos = Vector3(0.02, -0.04, 0.06)
	sprint_rot = Vector3(-12.0, 10.0, 8.0)
	add_to_group(&"heat_source")


func build_visual() -> void:
	_light_def = def.get("light", {})
	if is_lantern and _fuel_left() <= 0.001:
		lit = false
	rest_pos = Vector3(0.24, -0.4, 0.02)
	_holder = Node3D.new()
	_holder.name = "Torch"
	model.add_child(_holder)
	var mi := MeshInstance3D.new()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var ext := FPModels.external(item_id)
	if is_lantern:
		# Lantern hangs from the bail in the right hand, a little forward.
		var grip_cam := Vector3(0.18, -0.05, -0.5)
		var basis := Basis.from_euler(Vector3(0.0, deg_to_rad(-20.0), 0.0))
		_holder.transform = Transform3D(basis, grip_cam - rest_pos - basis * Vector3(0.0, 0.25, 0.0))
		mi.mesh = FPModels.lantern_mesh()
		_globe_mat = FPMaterials.vm_emissive(&"glass_dark", Color(1.0, 0.64, 0.32), 0.0)
		mi.set_surface_override_material(1, _globe_mat)
		_head = Vector3(0.0, 0.1, 0.0)
		var elbow := basis.inverse() * Vector3(0.42, -0.3, 0.86).normalized()
		var arm := FPHands.make_arm(&"grip", false, Vector3(0.0, 0.25, 0.0), Vector3(-1, 0, 0), elbow)
		_holder.add_child(arm)
		_register(arm)
	else:
		var handle_dir := Vector3(-0.22, 0.9, -0.36).normalized()
		var grip_cam := Vector3(0.2, -0.22, -0.4)
		var y := handle_dir
		var zn := (Vector3.BACK - y * Vector3.BACK.dot(y)).normalized()
		var x := y.cross(zn).normalized()
		var basis := Basis(x, y, zn)
		var grip_y := 0.12
		_holder.transform = Transform3D(basis, grip_cam - rest_pos - basis * Vector3(0.0, grip_y, 0.0))
		mi.mesh = FPModels.torch_mesh()
		_head = Vector3(0.0, 0.49, 0.0)
		var arm := FPHands.make_arm(&"grip", false, Vector3(0.0, grip_y, 0.0), Vector3.UP, basis.inverse() * elbow_toward(grip_cam, ELBOW_R))
		_holder.add_child(arm)
		_register(arm)
	if ext:
		_holder.add_child(ext)
	else:
		_holder.add_child(mi)
	_light = OmniLight3D.new()
	_light.name = "Light"
	_light.position = _head + Vector3(0.0, 0.06, 0.0)
	var col := String(_light_def.get("color", ""))
	if col != "" and Color.html_is_valid(col):
		_light.light_color = Color.html(col)
	else:
		_light.light_color = Color(1.0, 0.58, 0.28) if not is_lantern else Color(1.0, 0.72, 0.42)
	_base_energy = float(_light_def.get("energy", 1.7 if not is_lantern else 1.25))
	_light.omni_range = float(_light_def.get("radius", 10.0 if not is_lantern else 8.0))
	_light.omni_attenuation = 1.25
	_light.light_size = 0.05
	_light.shadow_enabled = not Settings.is_mobile() and int(Settings.get_value(&"shadow_quality", 2)) >= 2
	_light.shadow_bias = 0.08
	_holder.add_child(_light)
	var mobile := Settings.is_mobile() or int(Settings.get_value(&"particles", 2)) == 0
	if is_lantern:
		_flame = _make_particles(&"flame", 6, 0.35, 0.03, 0.05, 0.05, 0.1, Vector3(0, 0.3, 0))
		_flame.position = _head
	else:
		_flame = _make_particles(&"flame", 14 if mobile else 28, 0.38, 0.06, 0.11, 0.12, 0.32, Vector3(0, 1.1, 0))
		_flame.position = _head + Vector3(0.0, -0.035, 0.0)
		_flame.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
		_flame.emission_sphere_radius = 0.03
		_embers = _make_particles(&"spark", 4 if mobile else 9, 0.8, 0.005, 0.011, 0.4, 1.1, Vector3(0, 0.5, 0))
		_embers.position = _head
		_embers.spread = 35.0
		if not mobile:
			_smoke = _make_particles(&"smoke", 10, 2.6, 0.09, 0.2, 0.3, 0.7, Vector3(0, 0.45, 0))
			_smoke.position = _head + Vector3(0.0, 0.1, 0.0)
	_set_lit(lit, true)


func _register(arm: Node3D) -> void:
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


func _make_particles(kind: StringName, amount: int, life: float, s_min: float, s_max: float, v_min: float, v_max: float, grav: Vector3) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	q.material = FPMaterials.fx(kind)
	p.mesh = q
	p.amount = amount
	p.lifetime = life
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 12.0
	p.initial_velocity_min = v_min
	p.initial_velocity_max = v_max
	p.gravity = grav
	p.damping_min = 0.2
	p.damping_max = 0.6
	p.scale_amount_min = s_min
	p.scale_amount_max = s_max
	var curve := Curve.new()
	var g := Gradient.new()
	match kind:
		&"flame":
			curve.add_point(Vector2(0.0, 0.55))
			curve.add_point(Vector2(0.3, 1.0))
			curve.add_point(Vector2(1.0, 0.15))
			g.offsets = PackedFloat32Array([0.0, 0.25, 0.6, 1.0])
			g.colors = PackedColorArray([Color(1.0, 0.72, 0.36, 0.95), Color(1.0, 0.46, 0.12, 0.85), Color(0.85, 0.18, 0.03, 0.45), Color(0.35, 0.04, 0.0, 0.0)])
		&"spark":
			curve.add_point(Vector2(0.0, 1.0))
			curve.add_point(Vector2(1.0, 0.3))
			g.offsets = PackedFloat32Array([0.0, 0.7, 1.0])
			g.colors = PackedColorArray([Color(1.0, 0.7, 0.3, 1.0), Color(1.0, 0.3, 0.05, 0.8), Color(0.6, 0.1, 0.0, 0.0)])
		_:
			curve.add_point(Vector2(0.0, 0.3))
			curve.add_point(Vector2(1.0, 1.0))
			g.offsets = PackedFloat32Array([0.0, 0.2, 1.0])
			g.colors = PackedColorArray([Color(0.3, 0.28, 0.26, 0.0), Color(0.3, 0.28, 0.26, 0.35), Color(0.4, 0.4, 0.4, 0.0)])
	p.scale_amount_curve = curve
	p.color_ramp = g
	_holder.add_child(p)
	return p


func on_equip() -> void:
	if lit:
		_loop = Audio.play_loop(&"torch_loop", _light if _light else self, -6.0)


func on_holster() -> void:
	_stop_loop()


func _stop_loop() -> void:
	if _loop and is_instance_valid(_loop):
		_loop.stop()
		_loop.queue_free()
	_loop = null


func is_heat_active() -> bool:
	return lit


func item_process(delta: float, can_act: bool) -> void:
	super.item_process(delta, can_act)
	_t += delta
	if can_act and Input.is_action_just_pressed(&"torch_toggle"):
		_toggle()
	if lit:
		# Flame flicker: layered noise, slightly stronger when moving.
		var move := clampf(player.ground_speed / 5.0, 0.0, 1.0)
		var fl := 0.82 + 0.1 * sin(_t * 23.0) * sin(_t * 7.3) + 0.08 * sin(_t * 41.0 + 1.3) - 0.08 * move * absf(sin(_t * 13.0))
		if is_lantern:
			fl = 0.95 + 0.05 * sin(_t * 11.0) * sin(_t * 5.1)
			if _globe_mat:
				_globe_mat.set_shader_parameter(&"emission_energy", 1.6 * fl)
		_light.light_energy = _base_energy * fl
		_light.position.x = sin(_t * 9.0) * 0.01
		# Going under water puts it out.
		if player.water_level > -1e20 and _light.global_position.y < player.water_level:
			_set_lit(false)
			Audio.play_sfx(&"splash", _light.global_position, -8.0, 1.6)
		# Burn down (game minutes, so it also burns while time is fast-forwarded).
		_burn_acc += delta
		if _burn_acc >= 1.0:
			_burn(_burn_acc * Climate.game_minutes_per_second() / _burn_minutes)
			_burn_acc = 0.0


## Uses up `fraction` of one torch / of the lantern's fill.
func _burn(fraction: float) -> void:
	var idx := inventory_index()
	if idx < 0:
		return
	var inv := player.inventory
	if is_lantern:
		# The lantern itself never burns away: it runs dry and waits for lamp oil.
		var left := float(inv.get_slot(idx).get("durability", 1.0)) - fraction
		_set_fuel(idx, maxf(left, 0.0))
		if left <= 0.0:
			_set_lit(false)
			Game.notify("The lantern ran dry", &"warning")
		return
	if inv.use_durability(idx, fraction):
		if inv.count(item_id) > 0:
			Game.notify("The torch gutters out; you light a fresh one from it", &"info")
		else:
			Game.notify("Your torch burned out", &"warning")
			depleted.emit()


func _fuel_left() -> float:
	var idx := inventory_index()
	return float(player.inventory.get_slot(idx).get("durability", 1.0)) if idx >= 0 else 1.0


func _set_fuel(idx: int, f: float) -> void:
	var st := player.inventory.get_slot(idx).duplicate()
	if st.is_empty():
		return
	st["durability"] = clampf(f, 0.0, 1.0)
	player.inventory.set_slot(idx, st)


func _toggle() -> void:
	if lit:
		_set_lit(false)
		Audio.play_sfx(&"fire_ignite", _light.global_position, -10.0, 0.6)
		return
	relight()


## Tries to light it again: an empty lantern takes a fill of its fuel item first; a burning fire within
## reach lights it for free, otherwise the best igniter carried is struck (may fail in wind). Returns true
## when it's burning.
func relight() -> bool:
	if lit:
		return true
	var inv := player.inventory
	if is_lantern and _fuel_left() <= 0.001:
		var oil := StringName(_light_def.get("fuel", "lamp_oil"))
		if not inv.remove(oil, 1):
			Game.notify("The lantern needs %s" % ItemInfo.name_of(oil).to_lower(), &"warning")
			return false
		_set_fuel(inventory_index(), 1.0)
	if not _near_fire():
		if ItemActions.find_igniter(inv) < 0:
			Game.notify("Nothing to light it with", &"warning")
			return false
		var res := ItemActions.try_ignite(inv, 0.5)
		if not bool(res.get("ok", false)):
			Game.notify(String(res.get("text", "It won't catch.")), &"warning")
			Audio.play_sfx(&"fire_ignite", _light.global_position, -18.0, 1.5)
			return false
	_set_lit(true)
	Audio.play_sfx(&"fire_ignite", _light.global_position, -4.0)
	return true


## A burning campfire (group "fire") close enough to hold the torch into.
func _near_fire() -> bool:
	for n in get_tree().get_nodes_in_group(&"fire"):
		if n == self or not (n is Node3D) or not (n as Node3D).is_inside_tree():
			continue
		if n.has_method(&"is_heat_active") and not n.call(&"is_heat_active"):
			continue
		if (n as Node3D).global_position.distance_to(player.global_position) <= RELIGHT_FIRE_DIST:
			return true
	return false


func _set_lit(on: bool, instant := false) -> void:
	lit = on
	if _light:
		_light.visible = on
	if _globe_mat:
		_globe_mat.set_shader_parameter(&"emission_energy", 1.6 if on else 0.0)
	for p in [_flame, _embers, _smoke]:
		if p:
			(p as CPUParticles3D).emitting = on
	if not on:
		_stop_loop()
	elif not instant and _loop == null:
		_loop = Audio.play_loop(&"torch_loop", _light, -6.0)
	damage_type = &"fire" if on else &"blunt"

class_name Campfire
extends CraftingStation
## Campfire (scenes/items/campfire.tscn): the prologue's key object and the "campfire" crafting station.
## Fuel burns in game minutes (sticks ~8, logs ~90, charcoal ~45; see items.json "fuel"), states
## UNLIT → BURNING → EMBERS → OUT. Burning or glowing, it is a heat source (group "heat_source":
## heat_radius / heat_celsius / is_heat_active(), read by Climate) and a "fire" that wildlife fears.
## Visuals: procedural stone ring + fuel, glowing coals, layered flipbook flames, lit smoke drifting with
## Climate wind, turbulent embers and a flickering (shadow-casting on desktop) OmniLight3D.

enum FireState { UNLIT, BURNING, EMBERS, OUT }

signal fire_state_changed(state: int)

@export var start_fuel_minutes := 0.0
@export var start_lit := false
@export var max_fuel_minutes := 480.0
@export var heat_radius := 4.0
@export var max_heat_celsius := 25.0
@export var ember_minutes_max := 50.0
## Build the procedural ring of stones + wood. Off when a building scene supplies its own model.
@export var build_model := true
## Keep burning even when Game isn't PLAYING (dev scenes, menus in the background).
@export var always_simulate := false

## Read by Climate.get_heat_at(): extra °C at the fire, fading to 0 at heat_radius.
var heat_celsius := 0.0
var fuel_minutes := 0.0
var state: FireState = FireState.UNLIT
var intensity := 0.0           ## 0..1 visual/heat strength (smoothed)
var ember_minutes := 0.0
var has_kindling := false      ## lighting needs kindling (sticks, bark, tinder) in the pit

const FUEL_BURNING_ORDER: Array[StringName] = [&"log", &"charcoal", &"stick", &"bark", &"resin", &"tinder", &"fiber"]
const FUEL_KINDLING_ORDER: Array[StringName] = [&"stick", &"bark", &"tinder", &"fiber", &"resin", &"charcoal", &"log"]

var _flames: GPUParticles3D
var _core: GPUParticles3D
var _smoke: GPUParticles3D
var _embers: GPUParticles3D
var _light: OmniLight3D
var _coal_mat: BaseMaterial3D
var _loop: AudioStreamPlayer3D
var _noise := FastNoiseLite.new()
var _t := 0.0
var _mobile := false
var _wind_timer := 0.0
var _light_base := Vector3(0, 0.5, 0)


func _init() -> void:
	station_id = &"campfire"
	display_name = "Campfire"
	use_radius = 2.6


func _ready() -> void:
	super._ready()
	add_to_group(&"heat_source")
	add_to_group(&"fire")
	_mobile = Settings.is_mobile()
	_noise.frequency = 2.2
	_noise.seed = get_instance_id() % 997
	if build_model:
		_build_model()
	_build_fx()
	fuel_minutes = start_fuel_minutes
	has_kindling = start_fuel_minutes > 0.0
	if start_lit and fuel_minutes > 0.0:
		_set_state(FireState.BURNING)
		intensity = _target_intensity()
	_apply_visuals(0.0)
	if not Events.settings_changed.is_connected(_on_settings_changed):
		Events.settings_changed.connect(_on_settings_changed)


# ---------------------------------------------------------------------------------------------- simulation

func _process(delta: float) -> void:
	_t += delta
	var simulate := always_simulate or Game.is_playing()
	if simulate:
		var minutes := delta * Climate.time_scale * 1440.0 / maxf(1.0, Climate.day_length_minutes * 60.0)
		_burn(minutes)
	var target := _target_intensity()
	var rate := 0.35 if target > intensity else 0.6
	intensity = move_toward(intensity, target, delta * rate)
	heat_celsius = max_heat_celsius * clampf(intensity * 1.15, 0.0, 1.0)
	_apply_visuals(delta)


func _burn(minutes: float) -> void:
	match state:
		FireState.BURNING:
			var rate := 1.0
			var wind := 0.0
			if Climate.has_method("get_wind_at"):
				wind = (Climate.get_wind_at(global_position) as Vector3).length()
			rate += 0.03 * maxf(0.0, wind - 3.0)
			var shelter := float(Climate.get_shelter_at(global_position)) if Climate.has_method("get_shelter_at") else 0.0
			if Climate.precipitation > 0.5 and shelter < 0.5:
				rate *= 1.0 + (Climate.precipitation - 0.5)
			fuel_minutes = maxf(0.0, fuel_minutes - minutes * rate)
			if fuel_minutes <= 0.0:
				ember_minutes = ember_minutes_max
				has_kindling = false
				_set_state(FireState.EMBERS)
		FireState.EMBERS:
			ember_minutes = maxf(0.0, ember_minutes - minutes)
			if ember_minutes <= 0.0:
				_set_state(FireState.OUT)


func _target_intensity() -> float:
	match state:
		FireState.BURNING:
			return clampf(0.35 + fuel_minutes / 45.0, 0.35, 1.0)
		FireState.EMBERS:
			return 0.16 * clampf(ember_minutes / ember_minutes_max, 0.15, 1.0)
	return 0.0


func _set_state(s: FireState) -> void:
	if state == s:
		return
	var prev := state
	state = s
	fire_state_changed.emit(s)
	if s == FireState.BURNING:
		if prev != FireState.EMBERS:
			Audio.play_sfx(&"fire_ignite", global_position)
		_start_loop()
	elif s == FireState.OUT or s == FireState.UNLIT:
		_stop_loop()


func is_heat_active() -> bool:
	return state == FireState.BURNING or (state == FireState.EMBERS and ember_minutes > 5.0)


## Cooking and boiling work over flames or a good bed of coals.
func is_station_active() -> bool:
	return state == FireState.BURNING or (state == FireState.EMBERS and ember_minutes > 12.0)


func is_burning() -> bool:
	return state == FireState.BURNING


# ---------------------------------------------------------------------------------------------- fuel & lighting

func fuel_value(item_id: StringName) -> float:
	var f: Variant = ItemDB.get_item(item_id).get("fuel", null)
	if f is Dictionary and not (ItemDB.get_item(item_id).get("tags", []) as Array).has("fuel_liquid"):
		return float((f as Dictionary).get("burn_minutes", 0.0))
	return 0.0


func is_kindling(item_id: StringName) -> bool:
	var tags: Array = ItemDB.get_item(item_id).get("tags", [])
	return tags.has("kindling") or tags.has("tinder")


## Best fuel the inventory holds (kindling first when the pit is cold). &"" if none.
func best_fuel(inv: Inventory, for_lighting := false) -> StringName:
	if inv == null:
		return &""
	for id in (FUEL_KINDLING_ORDER if for_lighting else FUEL_BURNING_ORDER):
		if inv.count(id) > 0 and fuel_value(id) > 0.0:
			return id
	for s in inv.slots:
		if not s.is_empty() and fuel_value(s["id"]) > 0.0:
			return s["id"]
	return &""


func can_add_fuel(item_id: StringName) -> bool:
	return fuel_value(item_id) > 0.0 and fuel_minutes < max_fuel_minutes - 1.0


## Takes one `item_id` from the inventory and feeds it to the fire. Embers rekindle with dry fuel.
func add_fuel(item_id: StringName, inv: Inventory) -> bool:
	if not can_add_fuel(item_id) or inv == null or not inv.remove(item_id, 1):
		if fuel_minutes >= max_fuel_minutes - 1.0:
			Game.notify("The fire can't take any more.", &"info")
		return false
	fuel_minutes = minf(max_fuel_minutes, fuel_minutes + fuel_value(item_id))
	if is_kindling(item_id):
		has_kindling = true
	Audio.play_sfx(&"drop", global_position, -6.0)
	if state == FireState.EMBERS:
		_set_state(FireState.BURNING)
		Game.notify("The embers catch again.", &"info")
	elif state == FireState.OUT:
		_set_state(FireState.UNLIT)
	return true


## One attempt to light the fire with the best igniter in `inv`. Returns {ok, text}.
func try_light(inv: Inventory) -> Dictionary:
	if state == FireState.BURNING:
		return {"ok": true, "text": ""}
	if fuel_minutes <= 0.5:
		return {"ok": false, "text": "There's nothing in the fire pit to burn."}
	if not has_kindling and (inv == null or inv.count(&"tinder") <= 0):
		return {"ok": false, "text": "Logs won't catch on their own. Add sticks, bark or tinder first."}
	var exposure := 1.0 - (float(Climate.get_shelter_at(global_position)) if Climate.has_method("get_shelter_at") else 0.0)
	var res := ItemActions.try_ignite(inv, exposure)
	if bool(res.get("ok", false)):
		_set_state(FireState.BURNING)
		intensity = 0.12
		Events.noise_emitted.emit(global_position, 6.0, self)
		if Story.has_method("trigger"):
			Story.trigger(&"campfire_lit")
		Game.notify("The fire catches.", &"info")
	return res


func extinguish() -> void:
	if state == FireState.BURNING or state == FireState.EMBERS:
		ember_minutes = 0.0
		_set_state(FireState.OUT)
		Audio.play_sfx(&"splash", global_position, -8.0)


func fuel_fraction() -> float:
	return clampf(fuel_minutes / max_fuel_minutes, 0.0, 1.0)


func state_name() -> String:
	match state:
		FireState.BURNING: return "Burning" if intensity > 0.3 else "Catching"
		FireState.EMBERS: return "Embers"
		FireState.OUT: return "Out"
	return "Unlit"


func get_station_status() -> String:
	match state:
		FireState.BURNING:
			return "Burning · %s of fuel" % ItemInfo.format_minutes(fuel_minutes)
		FireState.EMBERS:
			return "Embers · add fuel to rekindle"
		_:
			if fuel_minutes > 0.5:
				return "Unlit · %s of fuel laid" % ItemInfo.format_minutes(fuel_minutes)
			return "Cold · lay sticks to start a fire"


# ---------------------------------------------------------------------------------------------- interaction

func get_interact_prompt(player: Node) -> String:
	var inv := ItemActions.inventory_of(player)
	var held := _held_fuel(player)
	match state:
		FireState.BURNING:
			if held != &"" and can_add_fuel(held):
				return "Add %s to the fire" % ItemInfo.name_of(held).to_lower()
			return "Use campfire"
		FireState.EMBERS:
			var f := held if held != &"" else best_fuel(inv)
			if f != &"":
				return "Rekindle with %s" % ItemInfo.name_of(f).to_lower()
			return "Use campfire"
		_:
			if fuel_minutes <= 0.5 or not has_kindling:
				var k := best_fuel(inv, true)
				if k != &"":
					return "Lay %s in the fire pit" % ItemInfo.name_of(k).to_lower()
				return "Fire pit (needs sticks)"
			if inv != null and ItemActions.find_igniter(inv) >= 0:
				return "Light fire"
			return "Light fire (no lighter, matches or fire starter)"


func get_interact_hold_time() -> float:
	if (state == FireState.UNLIT or state == FireState.OUT) and fuel_minutes > 0.5 and has_kindling:
		return 1.2
	return 0.0


func interact(player: Node) -> void:
	var inv := ItemActions.inventory_of(player)
	var held := _held_fuel(player)
	match state:
		FireState.BURNING:
			if held != &"" and can_add_fuel(held):
				add_fuel(held, inv)
			else:
				open_ui()
		FireState.EMBERS:
			var f := held if held != &"" else best_fuel(inv)
			if f != &"":
				add_fuel(f, inv)
			else:
				open_ui()
		_:
			if fuel_minutes <= 0.5 or not has_kindling:
				var k := best_fuel(inv, true)
				if k != &"":
					add_fuel(k, inv)
				else:
					Game.notify("Gather sticks to build a fire.", &"info")
				return
			var res := try_light(inv)
			if not bool(res.get("ok", false)):
				Game.notify(String(res.get("text", "It won't catch.")), &"warning")


func _held_fuel(player: Node) -> StringName:
	if player == null or not player.has_method("get_active_item"):
		return &""
	var id: StringName = player.call("get_active_item")
	return id if fuel_value(id) > 0.0 else &""


# ---------------------------------------------------------------------------------------------- persistence

func save_state() -> Dictionary:
	return {"fuel": fuel_minutes, "state": int(state), "ember": ember_minutes, "kindling": has_kindling}


func load_state(d: Dictionary) -> void:
	fuel_minutes = float(d.get("fuel", 0.0))
	ember_minutes = float(d.get("ember", 0.0))
	has_kindling = bool(d.get("kindling", fuel_minutes > 0.0))
	_set_state(int(d.get("state", 0)) as FireState)
	intensity = _target_intensity()


# ---------------------------------------------------------------------------------------------- visuals

func _build_model() -> void:
	var mi := MeshInstance3D.new()
	mi.name = "Model"
	mi.mesh = ItemVisuals.campfire_mesh()
	add_child(mi)
	for i in mi.mesh.get_surface_count():
		if mi.mesh.surface_get_name(i) == "charred_glow":
			_coal_mat = (mi.mesh.surface_get_material(i) as BaseMaterial3D).duplicate()
			mi.set_surface_override_material(i, _coal_mat)


func _build_fx() -> void:
	var q := int(Settings.get_value(&"particles", 2))
	var amt := 1.0 if q >= 2 else (0.7 if q == 1 else 0.45)
	_flames = _particles("Flames", int(26 * amt), 0.8, _flame_draw(Vector2(0.42, 0.6), 0.27), _flame_process(false))
	_core = _particles("Core", int(12 * amt), 0.55, _flame_draw(Vector2(0.26, 0.36), 0.16), _flame_process(true))
	_smoke = _particles("Smoke", int(16 * amt), 5.5, _smoke_draw(), _smoke_process())
	_embers = _particles("Embers", int(24 * amt), 2.4, _ember_draw(), _ember_process())
	_smoke.position.y = 0.4
	_flames.position.y = 0.06
	_core.position.y = 0.05
	_embers.position.y = 0.1
	_light = OmniLight3D.new()
	_light.name = "Light"
	_light.light_color = Color(1.0, 0.56, 0.24)
	_light.omni_range = 10.0
	_light.omni_attenuation = 1.3
	_light.light_energy = 0.0
	_light.light_specular = 0.6
	_light.shadow_enabled = not _mobile
	_light.shadow_bias = 0.06
	_light.shadow_normal_bias = 1.5
	_light.omni_shadow_mode = OmniLight3D.SHADOW_CUBE
	_light.distance_fade_enabled = true
	_light.distance_fade_begin = 60.0 if not _mobile else 35.0
	_light.distance_fade_length = 15.0
	_light.position = _light_base
	add_child(_light)


func _particles(n: String, amount: int, lifetime: float, draw: Mesh, process: ParticleProcessMaterial) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.name = n
	p.amount = maxi(2, amount)
	p.lifetime = lifetime
	p.randomness = 0.35
	p.fixed_fps = 30
	p.draw_pass_1 = draw
	p.process_material = process
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-2, -0.5, -2), Vector3(4, 7, 4))
	p.emitting = false
	add_child(p)
	return p


static func _gradient(stops: Array) -> GradientTexture1D:
	var offsets := PackedFloat32Array()
	var colors := PackedColorArray()
	for st in stops:
		offsets.append(float(st[0]))
		colors.append(st[1])
	var g := Gradient.new()
	g.offsets = offsets
	g.colors = colors
	var t := GradientTexture1D.new()
	t.gradient = g
	t.width = 128
	return t


static func _curve(points: Array) -> CurveTexture:
	var c := Curve.new()
	for p in points:
		c.add_point(Vector2(float(p[0]), float(p[1])))
	var t := CurveTexture.new()
	t.curve = c
	t.width = 64
	return t


func _flame_draw(size: Vector2, lift: float) -> QuadMesh:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.particles_anim_h_frames = 4
	m.particles_anim_v_frames = 4
	m.particles_anim_loop = true
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = load("res://scenes/items/fx/flame_sheet.png")
	if not _mobile:
		m.proximity_fade_enabled = true
		m.proximity_fade_distance = 0.22
	var q := QuadMesh.new()
	q.size = size
	q.center_offset = Vector3(0, lift, 0)
	q.material = m
	return q


func _flame_process(core: bool) -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(0.09, 0.02, 0.09) if core else Vector3(0.17, 0.03, 0.17)
	pm.direction = Vector3.UP
	pm.spread = 8.0 if core else 14.0
	pm.initial_velocity_min = 0.2 if core else 0.3
	pm.initial_velocity_max = 0.42 if core else 0.65
	pm.gravity = Vector3(0, 0.8, 0)
	pm.damping_min = 0.2
	pm.damping_max = 0.6
	pm.angle_min = -14.0
	pm.angle_max = 14.0
	pm.scale_min = 0.75
	pm.scale_max = 1.25
	pm.scale_curve = _curve([[0.0, 0.45], [0.22, 1.0], [0.7, 0.75], [1.0, 0.2]])
	pm.anim_speed_min = 1.0
	pm.anim_speed_max = 1.3
	pm.anim_offset_min = 0.0
	pm.anim_offset_max = 1.0
	if core:
		pm.color_ramp = _gradient([[0.0, Color(1, 1, 1, 0)], [0.12, Color(1.0, 0.97, 0.88, 1)], [0.55, Color(1.0, 0.78, 0.45, 0.9)], [1.0, Color(1.0, 0.4, 0.1, 0)]])
	else:
		pm.color_ramp = _gradient([[0.0, Color(1, 1, 1, 0)], [0.1, Color(1.0, 0.9, 0.75, 0.95)], [0.45, Color(1.0, 0.6, 0.28, 0.8)], [0.8, Color(0.85, 0.26, 0.06, 0.4)], [1.0, Color(0.5, 0.1, 0.02, 0)]])
	pm.turbulence_enabled = not _mobile
	pm.turbulence_noise_strength = 0.8
	pm.turbulence_noise_scale = 2.4
	pm.turbulence_influence_min = 0.05
	pm.turbulence_influence_max = 0.15
	return pm


func _smoke_draw() -> QuadMesh:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.particles_anim_h_frames = 2
	m.particles_anim_v_frames = 2
	m.particles_anim_loop = false
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = load("res://scenes/items/fx/smoke_sheet.png")
	if not _mobile:
		m.proximity_fade_enabled = true
		m.proximity_fade_distance = 0.5
	var q := QuadMesh.new()
	q.size = Vector2(0.8, 0.8)
	q.material = m
	return q


func _smoke_process() -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(0.1, 0.05, 0.1)
	pm.direction = Vector3.UP
	pm.spread = 10.0
	pm.initial_velocity_min = 0.35
	pm.initial_velocity_max = 0.65
	pm.gravity = Vector3(0, 0.12, 0)
	pm.damping_min = 0.1
	pm.damping_max = 0.3
	pm.angle_min = 0.0
	pm.angle_max = 360.0
	pm.angular_velocity_min = -18.0
	pm.angular_velocity_max = 18.0
	pm.scale_min = 0.8
	pm.scale_max = 1.2
	pm.scale_curve = _curve([[0.0, 0.35], [0.4, 1.2], [1.0, 2.6]])
	pm.anim_speed_min = 0.0
	pm.anim_speed_max = 0.0
	pm.anim_offset_min = 0.0
	pm.anim_offset_max = 1.0
	pm.color_ramp = _gradient([[0.0, Color(0.55, 0.36, 0.22, 0.0)], [0.08, Color(0.42, 0.33, 0.27, 0.42)], [0.35, Color(0.30, 0.29, 0.28, 0.3)], [1.0, Color(0.36, 0.36, 0.37, 0.0)]])
	return pm


func _ember_draw() -> QuadMesh:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = load("res://scenes/items/fx/ember.png")
	var q := QuadMesh.new()
	q.size = Vector2(0.035, 0.035)
	q.material = m
	return q


func _ember_process() -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(0.18, 0.05, 0.18)
	pm.direction = Vector3.UP
	pm.spread = 22.0
	pm.initial_velocity_min = 0.7
	pm.initial_velocity_max = 1.7
	pm.gravity = Vector3(0, 0.3, 0)
	pm.damping_min = 0.3
	pm.damping_max = 0.8
	pm.scale_min = 0.5
	pm.scale_max = 1.2
	pm.scale_curve = _curve([[0.0, 1.0], [0.7, 0.8], [1.0, 0.0]])
	pm.color_ramp = _gradient([[0.0, Color(1.0, 0.85, 0.5, 1)], [0.4, Color(1.0, 0.45, 0.1, 1)], [0.8, Color(0.7, 0.12, 0.02, 0.8)], [1.0, Color(0.3, 0.02, 0.0, 0)]])
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 1.4
	pm.turbulence_noise_scale = 1.2
	pm.turbulence_influence_min = 0.25
	pm.turbulence_influence_max = 0.5
	return pm


func _apply_visuals(delta: float) -> void:
	var burning := state == FireState.BURNING
	var embers := state == FireState.EMBERS
	var i := intensity
	_flames.emitting = burning and i > 0.05
	_flames.amount_ratio = clampf(i * 1.1, 0.15, 1.0)
	_core.emitting = (burning and i > 0.02) or (embers and ember_minutes > ember_minutes_max * 0.4)
	_core.amount_ratio = clampf(i * 1.2, 0.2, 1.0) if burning else 0.25
	_embers.emitting = burning and i > 0.25
	_embers.amount_ratio = clampf(i, 0.2, 1.0)
	_smoke.emitting = burning or embers
	_smoke.amount_ratio = clampf(0.35 + (1.0 - i) * 0.5, 0.3, 1.0) if burning else 0.45
	# flicker: layered sines + noise; embers pulse slowly
	var flick := 0.86 + 0.07 * sin(_t * 9.3) + 0.05 * sin(_t * 15.1 + 1.7) + 0.12 * _noise.get_noise_1d(_t * 7.0)
	if embers:
		flick = 0.85 + 0.15 * sin(_t * 1.6) + 0.1 * _noise.get_noise_1d(_t * 1.5)
	var energy := (3.2 * i) * flick
	_light.light_energy = energy
	_light.visible = energy > 0.01
	_light.omni_range = lerpf(3.5, 11.0, clampf(i, 0.0, 1.0))
	_light.light_color = Color(1.0, lerpf(0.36, 0.58, i), lerpf(0.12, 0.26, i))
	_light.position = _light_base + Vector3(_noise.get_noise_2d(_t * 5.0, 3.0), _noise.get_noise_2d(_t * 4.0, 9.0) * 0.5, _noise.get_noise_2d(_t * 5.0, 17.0)) * 0.035
	if _coal_mat:
		var glow := 0.0
		if burning:
			glow = 2.2 * clampf(i + 0.2, 0.0, 1.0) * (0.9 + 0.1 * flick)
		elif embers:
			glow = 1.4 * clampf(ember_minutes / ember_minutes_max, 0.1, 1.0) * flick
		_coal_mat.emission_energy_multiplier = glow
	if _loop:
		_loop.volume_db = linear_to_db(maxf(0.001, clampf(i * 1.2, 0.0, 1.0)))
	# wind: flames lean and smoke drifts (update a few times a second)
	_wind_timer -= delta
	if _wind_timer <= 0.0:
		_wind_timer = 0.25
		var w := Vector3.ZERO
		if Climate.has_method("get_wind_at"):
			w = Climate.get_wind_at(global_position)
		var wl := minf(w.length(), 14.0)
		var wd := w.normalized() if wl > 0.01 else Vector3.ZERO
		(_flames.process_material as ParticleProcessMaterial).gravity = Vector3(0, 0.8, 0) + wd * wl * 0.06
		(_core.process_material as ParticleProcessMaterial).gravity = Vector3(0, 0.8, 0) + wd * wl * 0.04
		(_smoke.process_material as ParticleProcessMaterial).gravity = Vector3(0, 0.12, 0) + wd * wl * 0.18
		(_embers.process_material as ParticleProcessMaterial).gravity = Vector3(0, 0.3, 0) + wd * wl * 0.12


func _start_loop() -> void:
	if _loop == null:
		_loop = Audio.play_loop(&"fire_loop", self)


func _stop_loop() -> void:
	if _loop != null and is_instance_valid(_loop):
		_loop.stop()
		_loop.queue_free()
	_loop = null


func _on_settings_changed() -> void:
	var mobile := Settings.is_mobile()
	if mobile != _mobile:
		_mobile = mobile
		_light.shadow_enabled = not _mobile

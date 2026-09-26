class_name Animal
extends CharacterBody3D
## Base wildlife actor (CONTRACT §2 groups "creature", "damageable"; "harvestable" once dead).
## Pooled and ticked by FaunaManager (no _process of its own): tick(dt) at the LOD rate, advance_anim(dt) at the
## animation LOD rate. Movement is kinematic on TerrainData (height, slope and water limits, short detours, a
## forward RayCast3D against trees/structures near the player); perception = sight cone scaled by light, weather,
## crouch and cover + hearing (Events.noise_emitted/footstep via the manager) + smell downwind of the player
## (Climate wind) + fire/flare fear; memory = last known position / time seen / grudge.
## Behaviour: this base class is generic prey (graze → alert → flee); predators override think().
## Zero allocations per tick: cached nodes, StringName constants, no temporary arrays.

enum State { IDLE, GRAZE, WANDER, ALERT, FLEE, STALK, CIRCLE, CHARGE, ATTACK, RETREAT, HOWL, FOLLOW, FREEZE, DEAD }

const C_IDLE := &"idle"
const C_WALK := &"walk"
const C_TROT := &"trot"
const C_RUN := &"gallop"
const C_STALK := &"stalk"
const C_SNIFF := &"sniff"
const C_LOOK := &"look"
const C_HOWL := &"howl"
const C_SNARL := &"snarl"
const C_HIT := &"hit"
const C_DEATH := &"death"
const DETOURS := [0.55, -0.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4]
const RAY_MASK := 1 | (1 << 6) | (1 << 9)          # world, building, vegetation
const LAYER_CREATURE := 1 << 2

var def: SpeciesDef
var manager: FaunaManager
var active := false
var state: State = State.IDLE
var state_time := 0.0
var health := 1.0
var dead := false
var butchered := false
var awareness := 0.0
var fear := 0.0
var fire_threat := 0.0
var sees_player := false
var smells_player := false
var dist_to_player := 1e9
var last_known := Vector3.ZERO
var last_seen_t := -1e9
var grudge := 0.0
var home := Vector3.ZERO
var target_pos := Vector3.ZERO
var target_speed := 0.0
var face_pos := Vector3.ZERO
var face_on := false
var stalk_gait := false
var speed := 0.0
var yaw := 0.0
var lod := 0
var body_scale := 1.0
var voice_pitch := 1.0
var persistent_id := ""
var rng := RandomNumberGenerator.new()
var attack_cd := 0.0
var harvest_progress := 0.0
var harvest_index := 0
var corpse_age := 0.0
var pack: RefCounted = null          # WolfPack for wolves
var ai_enabled := true
var tick_acc := 0.0                  # FaunaManager LOD accumulators
var anim_acc := 0.0

var model: Node3D
var anim: AnimationPlayer
var mesh: MeshInstance3D
var shells: MeshInstance3D
var ray: RayCast3D
var col_shape: CollisionShape3D
var _clip := &""
var _override := &""
var _override_t := 0.0
var _attack_t := -1.0
var _attack_hit_at := 0.5
var _attack_len := 1.0
var _attack_move := 0.8
var _attack_done := false
var _shell_n := -1
var _avoid_t := 0.0
var _avoid_yaw := 0.0
var _ray_phase := 0
var _cos_half_fov := -0.5
var _loot_seq: PackedStringArray = PackedStringArray()
var _death_len := 1.7
var _anim_speed := 1.0
var _stuck_t := 0.0


# ================================================================================================ setup / pool
func setup(d: SpeciesDef, mgr: FaunaManager) -> void:
	def = d
	manager = mgr
	name = String(d.id).capitalize()
	collision_layer = 0
	collision_mask = 0
	col_shape = CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = d.body_radius
	cap.height = maxf(d.body_length, d.body_radius * 2.0 + 0.01)
	col_shape.shape = cap
	col_shape.rotation.x = PI * 0.5
	col_shape.position.y = d.body_height
	add_child(col_shape)
	ray = RayCast3D.new()
	ray.collision_mask = RAY_MASK
	ray.enabled = false
	ray.position = Vector3(0.0, d.body_height, 0.0)
	ray.target_position = Vector3(0.0, 0.0, -(d.body_length * 0.5 + 1.8))
	add_child(ray)
	model = Node3D.new()
	model.name = "Model"
	add_child(model)
	if ResourceLoader.exists(d.model_path):
		var ps: PackedScene = load(d.model_path)
		var inst := ps.instantiate() as Node3D
		model.add_child(inst)
		for n in inst.find_children("*", "AnimationPlayer", true, false):
			anim = n as AnimationPlayer
			break
		for n in inst.find_children("*", "MeshInstance3D", true, false):
			mesh = n as MeshInstance3D
			break
	_setup_visuals()
	_cos_half_fov = cos(deg_to_rad(clampf(d.fov_deg, 10.0, 359.0) * 0.5))
	for k in d.loot:
		for i in int(d.loot[k]):
			_loot_seq.append(String(k))
	var dc := d.clip(C_DEATH)
	_death_len = float(dc.get("length", 1.7))
	var ac := d.clip(d.attack_clip)
	_attack_len = float(ac.get("length", 1.0))
	_attack_hit_at = float((ac.get("events", {}) as Dictionary).values()[0]) if not (ac.get("events", {}) as Dictionary).is_empty() else _attack_len * 0.5
	_attack_move = float(ac.get("move", 0.8))
	visible = false
	process_mode = Node.PROCESS_MODE_PAUSABLE
	set_process(false)
	set_physics_process(false)


func _setup_visuals() -> void:
	if anim:
		anim.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
		var clips: Dictionary = def.load_meta().get("clips", {})
		for cn in clips:
			var a := anim.get_animation(StringName(cn)) if anim.has_animation(StringName(cn)) else null
			if a:
				a.loop_mode = Animation.LOOP_LINEAR if bool((clips[cn] as Dictionary).get("loop", true)) else Animation.LOOP_NONE
	if mesh == null:
		return
	var base := FurLibrary.base_material(def)
	var eye := FurLibrary.eye_material(def)
	for i in mesh.get_surface_override_material_count():
		var mn := ""
		var sm := mesh.mesh.surface_get_material(i)
		if sm:
			mn = sm.resource_name.to_lower()
		mesh.set_surface_override_material(i, eye if mn.begins_with("eye") else base)
	if def.fur_length > 0.0:
		shells = MeshInstance3D.new()
		shells.name = "FurShells"
		shells.mesh = mesh.mesh
		shells.skin = mesh.skin
		shells.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh.get_parent().add_child(shells)
		shells.transform = mesh.transform
		shells.skeleton = shells.get_path_to(mesh.get_node(mesh.skeleton)) if mesh.has_node(mesh.skeleton) else mesh.skeleton
		shells.visible = false


## Brings a pooled animal into the world.
func activate(pos: Vector3, yaw_rad: float, seed_value: int) -> void:
	rng.seed = seed_value
	active = true
	dead = false
	butchered = false
	health = def.health
	awareness = 0.0
	fear = 0.0
	grudge = 0.0
	speed = 0.0
	harvest_progress = 0.0
	harvest_index = 0
	corpse_age = 0.0
	attack_cd = 0.0
	_attack_t = -1.0
	_override = &""
	_clip = &""
	_avoid_t = 0.0
	last_seen_t = -1e9
	stalk_gait = false
	face_on = false
	pack = null
	persistent_id = ""
	yaw = yaw_rad
	home = pos
	target_pos = pos
	target_speed = 0.0
	body_scale = rng.randf_range(def.scale_range.x, def.scale_range.y)
	model.scale = Vector3.ONE * body_scale
	col_shape.scale = Vector3.ONE * body_scale
	col_shape.position.y = def.body_height * body_scale
	col_shape.rotation = Vector3(PI * 0.5, 0.0, 0.0)
	voice_pitch = rng.randf_range(0.93, 1.07)
	global_position = Vector3(pos.x, TerrainData.get_height(pos.x, pos.z), pos.z)
	_orient(0.0)
	collision_layer = LAYER_CREATURE
	visible = true
	add_to_group(&"creature")
	add_to_group(&"damageable")
	remove_from_group(&"harvestable")
	set_state(State.GRAZE if rng.randf() < 0.5 else State.IDLE)
	if anim:
		anim.play(C_IDLE)
		anim.seek(rng.randf() * 2.0, true)
	_shell_n = -1
	on_activated()


func deactivate() -> void:
	active = false
	visible = false
	collision_layer = 0
	remove_from_group(&"creature")
	remove_from_group(&"damageable")
	remove_from_group(&"harvestable")
	if shells:
		shells.visible = false
	pack = null


## Hook for subclasses.
func on_activated() -> void:
	pass


# ================================================================================================ ticking
func tick(dt: float) -> void:
	if not active:
		return
	if dead:
		corpse_age += dt
		return
	state_time += dt
	attack_cd = maxf(attack_cd - dt, 0.0)
	if _override != &"":
		_override_t -= dt
		if _override_t <= 0.0:
			_override = &""
	if not ai_enabled:
		return
	_perceive(dt)
	think(dt)
	_attack_update(dt)
	_locomote(dt)
	_select_anim()


func advance_anim(dt: float) -> void:
	if anim == null or not visible:
		return
	if dead and corpse_age > _death_len + 0.5:
		return
	anim.advance(dt * _anim_speed)


func set_state(s: State) -> void:
	if s == state and state_time < 0.01:
		return
	state = s
	state_time = 0.0
	on_state(s)


## Hook: entering a state.
func on_state(_s: State) -> void:
	pass


# ================================================================================================ perception
func _perceive(dt: float) -> void:
	var m := manager
	sees_player = false
	smells_player = false
	fire_threat = m.fire_threat_at(global_position) * def.fire_fear
	if fire_threat > 0.05:
		fear = minf(1.0, fear + fire_threat * dt * 1.5)
	else:
		fear = maxf(0.0, fear - dt * 0.05)
	if not m.player_valid:
		dist_to_player = 1e9
		awareness = maxf(awareness - dt * 0.05, 0.0)
		return
	var to := m.player_pos - global_position
	var dist := to.length()
	dist_to_player = dist
	# --- sight: cone, range scaled by light/weather (manager), crouch, movement and cover at the player
	var mv := 1.25 if m.player_speed > 3.5 else (0.7 if m.player_speed < 0.3 else 1.0)
	var rng_eff := def.sight_range * m.sight_mult * mv * (0.55 if m.player_crouch else 1.0) * m.player_cover
	if dist < rng_eff:
		var fx := -sin(yaw)
		var fz := -cos(yaw)
		var hd := sqrt(to.x * to.x + to.z * to.z)
		var cosang := (fx * to.x + fz * to.z) / hd if hd > 0.01 else 1.0
		if cosang > _cos_half_fov or dist < 5.0:
			var eye := global_position + Vector3(0.0, def.eye_height * body_scale, 0.0)
			if m.terrain_los(eye, m.player_eye):
				sees_player = true
				var k := 1.0 - dist / rng_eff
				awareness = minf(1.0, awareness + dt * (0.25 + 2.6 * k * k) * (0.5 + def.skittish))
				last_known = m.player_pos
				last_seen_t = m.now
	# --- smell: the scent cone travels downwind of the player
	if dist > 0.5:
		var down := (-to.x * m.wind_dir.x - to.z * m.wind_dir.z) / dist
		var srange := def.smell_range * clampf(m.wind_speed / 4.0, 0.45, 1.4) * (0.07 + 0.93 * smoothstep(0.25, 0.85, down))
		if dist < srange:
			smells_player = true
			awareness = minf(1.0, awareness + dt * 0.45 * (1.0 - dist / srange))
			if not sees_player:
				last_known = m.player_pos
	if not sees_player and not smells_player:
		awareness = maxf(0.0, awareness - dt * 0.035)


## Hearing (called by FaunaManager for Events.noise_emitted / footsteps).
func hear(pos: Vector3, radius: float, loudness: float) -> void:
	if dead or not active:
		return
	var r := radius * def.hearing
	var d := global_position.distance_to(pos)
	if d > r:
		return
	var k := 1.0 - d / r
	awareness = minf(1.0, awareness + 0.12 + 0.55 * k * loudness)
	if awareness > 0.3:
		last_known = pos
	on_heard(pos, loudness, k)


## Hook: a sound was heard (k = 0..1 closeness).
func on_heard(_pos: Vector3, _loudness: float, _k: float) -> void:
	pass


func time_since_seen() -> float:
	return manager.now - last_seen_t


# ================================================================================================ behaviour
## Generic prey: graze and wander around home, alert when something is noticed, flee from the threat.
func think(_dt: float) -> void:
	var threat := awareness > 0.7 or fear > 0.45 or (awareness > 0.35 and dist_to_player < def.flee_distance * 0.35)
	match state:
		State.IDLE, State.GRAZE, State.WANDER:
			target_speed = def.walk_speed * 0.8 if state == State.WANDER else 0.0
			if state_time > rng.randf_range(6.0, 14.0):
				_pick_wander()
			if state == State.WANDER and _arrived(1.5):
				set_state(State.GRAZE)
			if threat:
				start_flee()
			elif awareness > 0.3:
				set_state(State.ALERT)
				vocal(def.sfx_alarm, -2.0)
		State.ALERT:
			target_speed = 0.0
			face(last_known)
			if threat or fear > 0.3:
				start_flee()
			elif awareness < 0.15 and state_time > 5.0:
				set_state(State.GRAZE)
		State.FLEE:
			flee_step()
			if state_time > 5.0 and dist_to_player > def.flee_distance * 1.6 and fear < 0.2:
				awareness *= 0.5
				home = global_position
				set_state(State.WANDER)
				_pick_wander()


func start_flee() -> void:
	if state != State.FLEE:
		set_state(State.FLEE)
		vocal(def.sfx_alarm, 0.0)


## Run directly away from the last known threat / fire, biased by terrain the species is good at.
func flee_step() -> void:
	var away := global_position - last_known
	if fire_threat > 0.05:
		away += (global_position - manager.last_fire_pos).normalized() * 30.0
	away.y = 0.0
	if away.length_squared() < 0.01:
		away = Vector3(-sin(yaw), 0.0, -cos(yaw))
	away = away.normalized()
	target_pos = global_position + flee_bias(away) * 25.0
	target_speed = def.run_speed
	face_on = false


## Hook: bend the flee direction (goats uphill, hares zig-zag).
func flee_bias(away: Vector3) -> Vector3:
	return away


func _pick_wander() -> void:
	for i in 6:
		var a := rng.randf() * TAU
		var r := rng.randf_range(8.0, 35.0)
		var p := home + Vector3(sin(a) * r, 0.0, cos(a) * r)
		if walkable_point(p):
			target_pos = p
			set_state(State.WANDER if rng.randf() < 0.6 else State.GRAZE)
			return
	set_state(State.GRAZE)


func face(p: Vector3) -> void:
	face_pos = p
	face_on = true


func _arrived(r: float) -> bool:
	var dx := target_pos.x - global_position.x
	var dz := target_pos.z - global_position.z
	return dx * dx + dz * dz < r * r


# ================================================================================================ attack
## Starts the attack clip; damage lands at the clip's "bite"/"swipe" event if the player is still in reach.
func start_attack() -> void:
	if attack_cd > 0.0 or dead:
		return
	_attack_t = 0.0
	_attack_done = false
	attack_cd = def.attack_cooldown + _attack_len
	play_override(def.attack_clip, _attack_len)
	vocal(def.sfx_attack, 0.0)


func is_attacking() -> bool:
	return _attack_t >= 0.0


func _attack_update(dt: float) -> void:
	if _attack_t < 0.0:
		return
	_attack_t += dt
	var u := _attack_t / maxf(_attack_len, 0.1)
	if u > 0.28 and u < 0.56:
		# the lunge carries the body forward (the clip itself is in place)
		var step := _attack_move / (0.28 * _attack_len) * dt
		var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var np := global_position + fwd * step
		if dist_to_player > 0.9 and walkable_point(np):
			global_position = Vector3(np.x, TerrainData.get_height(np.x, np.z), np.z)
	if not _attack_done and _attack_t >= _attack_hit_at:
		_attack_done = true
		var p := manager.player
		if p and is_instance_valid(p) and p.has_method(&"take_damage"):
			var to := manager.player_pos - global_position
			var reach := def.attack_range * body_scale + 0.45
			var fx := -sin(yaw)
			var fz := -cos(yaw)
			var hd := sqrt(to.x * to.x + to.z * to.z)
			if hd < reach and (fx * to.x + fz * to.z) > hd * 0.45:
				var dmg := def.damage * rng.randf_range(0.8, 1.2) * (1.0 + 0.1 * (body_scale - 1.0) * 10.0)
				p.call(&"take_damage", dmg, def.damage_type, self, manager.player_pos + Vector3(0.0, 1.0, 0.0))
				on_attack_landed()
	if _attack_t >= _attack_len:
		_attack_t = -1.0


func on_attack_landed() -> void:
	pass


# ================================================================================================ damage / death
func take_damage(amount: float, type: StringName, source: Node = null, hit_position := Vector3.ZERO) -> void:
	if dead or not active or amount <= 0.0:
		return
	var mult := 1.0
	match type:
		&"fire":
			mult = 0.5
			fear = minf(1.0, fear + 0.6 * def.fire_fear)
		&"blunt":
			mult = 0.8
		&"fall", &"cold":
			mult = 0.5
	health -= amount * mult
	var hp := hit_position if hit_position != Vector3.ZERO else global_position + Vector3(0.0, def.body_height, 0.0)
	manager.spawn_blood(hp, clampf(amount / 25.0, 0.4, 1.4))
	awareness = 1.0
	if source is Node3D:
		last_known = (source as Node3D).global_position
	elif manager.player_valid:
		last_known = manager.player_pos
	last_seen_t = manager.now
	grudge = minf(1.0, grudge + amount / maxf(def.health, 1.0))
	if health <= 0.0:
		die(type)
		return
	vocal(def.sfx_hurt, 0.0)
	if not is_attacking():
		play_override(C_HIT, float(def.clip(C_HIT).get("length", 0.5)))
	on_damaged(amount, source)


## Hook: survived a hit.
func on_damaged(_amount: float, _source: Node) -> void:
	fear = minf(1.0, fear + 0.5)
	start_flee()


func die(_cause: StringName = &"") -> void:
	if dead:
		return
	dead = true
	health = 0.0
	speed = 0.0
	target_speed = 0.0
	_attack_t = -1.0
	corpse_age = 0.0
	state = State.DEAD
	remove_from_group(&"damageable")
	add_to_group(&"harvestable")
	col_shape.position.y = def.body_radius * 0.8 * body_scale
	vocal(def.sfx_death if def.sfx_death != &"" else def.sfx_hurt, 0.0)
	if anim and anim.has_animation(C_DEATH):
		anim.play(C_DEATH, 0.15)
		_clip = C_DEATH
	_anim_speed = 1.0
	Events.animal_killed.emit(def.id, global_position)
	manager.on_animal_killed(self)
	on_died()


func on_died() -> void:
	pass


## Lays a corpse down directly (loaded from a save): death pose, no event.
func make_corpse(harvested: int) -> void:
	dead = true
	health = 0.0
	state = State.DEAD
	remove_from_group(&"damageable")
	add_to_group(&"harvestable")
	col_shape.position.y = def.body_radius * 0.8 * body_scale
	harvest_index = clampi(harvested, 0, _loot_seq.size())
	harvest_progress = float(harvest_index) * _hits_per_item()
	corpse_age = _death_len + 1.0
	if anim and anim.has_animation(C_DEATH):
		anim.play(C_DEATH)
		anim.seek(_death_len, true)
		_clip = C_DEATH


# ================================================================================================ harvest
func get_harvest_tool_type() -> StringName:
	return &"knife"


func _hits_per_item() -> float:
	return float(def.harvest_hits) / maxf(float(_loot_seq.size()), 1.0)


func harvest_hit(tool_id: StringName, power: float, hit_position: Vector3, hit_normal: Vector3, _player: Node) -> void:
	if not dead or butchered:
		return
	var knife := String(tool_id).contains("knife")
	harvest_progress += maxf(power, 0.2) * (1.0 if knife else 0.35)
	manager.spawn_blood(hit_position, 0.5)
	var need := _hits_per_item()
	while harvest_index < _loot_seq.size() and harvest_progress >= need * float(harvest_index + 1):
		var id := StringName(_loot_seq[harvest_index])
		harvest_index += 1
		var at := hit_position + hit_normal * 0.25 + Vector3(0.0, 0.2, 0.0)
		var imp := (hit_normal + Vector3(rng.randf_range(-0.4, 0.4), 0.8, rng.randf_range(-0.4, 0.4))) * 1.2
		ItemsRoot.spawn(id, 1, at, imp)
		Events.resource_harvested.emit(id, at)
	if harvest_index >= _loot_seq.size():
		butchered = true
		manager.on_butchered(self)


func harvest_remaining() -> int:
	return _loot_seq.size() - harvest_index


# ================================================================================================ movement
func walkable_point(p: Vector3) -> bool:
	if not TerrainData.in_bounds(p.x, p.z, 24.0):
		return false
	if TerrainData.get_slope_deg(p.x, p.z) > def.max_slope:
		return false
	var wl := TerrainData.get_water_level(p.x, p.z)
	if wl > -1e20 and wl - TerrainData.get_height(p.x, p.z) > def.wade_depth:
		return false
	return true


func _locomote(dt: float) -> void:
	var p := global_position
	var tx := target_pos.x - p.x
	var tz := target_pos.z - p.z
	var d := sqrt(tx * tx + tz * tz)
	var want := target_speed
	if d < 0.6:
		want = 0.0
	elif d < 3.0 and want > def.walk_speed:
		want = maxf(def.walk_speed, want * d / 3.0)
	speed = move_toward(speed, want, def.accel * dt * (2.0 if want < speed else 1.0))
	var desired := yaw
	if want > 0.01 and d > 0.3:
		desired = atan2(-tx, -tz)
	elif face_on:
		desired = atan2(-(face_pos.x - p.x), -(face_pos.z - p.z))
	if _avoid_t > 0.0:
		_avoid_t -= dt
		desired = _avoid_yaw
	var turn := deg_to_rad(def.turn_rate) * dt * (1.0 + 0.25 * speed)
	yaw = rotate_toward(yaw, desired, turn)
	if speed > 0.02:
		var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var np := p + fwd * (speed * dt)
		if not _step_ok(p, np):
			var found := false
			for k in DETOURS:
				var y2: float = yaw + float(k)
				var f2 := Vector3(-sin(y2), 0.0, -cos(y2))
				var p2 := p + f2 * maxf(speed * dt, 0.5)
				if _step_ok(p, p2):
					_avoid_yaw = y2
					_avoid_t = 0.7
					found = true
					break
			if not found:
				speed = 0.0
				_stuck_t += dt
				if _stuck_t > 1.5:
					_stuck_t = 0.0
					on_blocked()
				_orient(dt)
				return
			np = p
		_stuck_t = 0.0
		if lod == 0:
			_obstacle_ray(fwd)
		global_position = Vector3(np.x, TerrainData.get_height(np.x, np.z), np.z)
	_orient(dt)


func _step_ok(from: Vector3, to: Vector3) -> bool:
	if not walkable_point(to):
		# allow stepping out of a bad spot (spawned on steep/wet ground) if it improves
		return not walkable_point(from) and TerrainData.get_slope_deg(to.x, to.z) < TerrainData.get_slope_deg(from.x, from.z)
	return true


## Hook: can't move toward the target (cliff, lake).
func on_blocked() -> void:
	_pick_wander()


func _obstacle_ray(fwd: Vector3) -> void:
	_ray_phase = (_ray_phase + 1) % 3
	if _ray_phase != 0 or _avoid_t > 0.0 or speed < 0.3:
		return
	ray.force_raycast_update()
	if ray.is_colliding():
		var n := ray.get_collision_normal()
		if n.y > 0.65:
			return
		var side := signf(fwd.x * n.z - fwd.z * n.x)
		if side == 0.0:
			side = 1.0
		_avoid_yaw = yaw + side * 0.9
		_avoid_t = 0.6


func _orient(_dt: float) -> void:
	var p := global_position
	var half := def.body_length * 0.45 * body_scale
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var hf := TerrainData.get_height(p.x + fx * half, p.z + fz * half)
	var hb := TerrainData.get_height(p.x - fx * half, p.z - fz * half)
	var pitch := atan2(hf - hb, 2.0 * half) * 0.85
	var w := def.body_radius * body_scale
	var hr := TerrainData.get_height(p.x - fz * w, p.z + fx * w)
	var hl := TerrainData.get_height(p.x + fz * w, p.z - fx * w)
	var roll := atan2(hl - hr, 2.0 * w) * 0.35
	if dead:
		pitch *= 0.5
	global_basis = Basis.from_euler(Vector3(pitch, yaw, roll))


# ================================================================================================ animation
func play_override(clip: StringName, dur: float) -> void:
	if anim == null or not anim.has_animation(clip):
		return
	_override = clip
	_override_t = dur
	_clip = clip
	_anim_speed = 1.0
	anim.play(clip, 0.12)
	anim.seek(0.0, false)


## Clip to show when standing still (subclasses: sniff/graze, look, snarl, howl).
func idle_clip() -> StringName:
	match state:
		State.GRAZE:
			return C_SNIFF
		State.ALERT, State.FREEZE:
			return C_LOOK
	return C_IDLE


func _select_anim() -> void:
	if anim == null or _override != &"":
		return
	var want := C_IDLE
	var spd := 1.0
	if speed < 0.12:
		want = idle_clip()
	elif stalk_gait and anim.has_animation(C_STALK):
		want = C_STALK
		spd = speed / def.clip_speed(C_STALK, 0.5)
	else:
		var g := def.gait_clips
		var n := g.size()
		var i := 0
		var v0 := def.clip_speed(StringName(g[0]), def.walk_speed)
		while i < n - 1:
			var va := def.clip_speed(StringName(g[i]), 1.0)
			var vb := def.clip_speed(StringName(g[i + 1]), 3.0)
			if speed < sqrt(va * vb) * 0.95:
				break
			i += 1
		want = StringName(g[i])
		spd = speed / def.clip_speed(want, v0)
	_anim_speed = clampf(spd, 0.45, 1.8)
	if want != _clip and anim.has_animation(want):
		anim.play(want, 0.3)
		_clip = want


func current_clip() -> StringName:
	return _clip


## Dev/QA: freeze the AI and hold a clip (locomotion clips play in place). t0 = start time in the clip.
func debug_clip(clip: StringName, t0 := 0.0) -> void:
	ai_enabled = false
	if anim == null or not anim.has_animation(clip):
		return
	_override = clip
	_override_t = 1e9
	_clip = clip
	_anim_speed = 1.0
	anim.play(clip, 0.0)
	anim.seek(t0, true)


# ================================================================================================ LOD / sound
## tier 0 near (full tick, shells by distance), 1 mid, 2 far. cam_dist in metres.
func set_lod(tier: int, cam_dist: float) -> void:
	lod = tier
	if shells == null:
		return
	var budget := FurLibrary.shell_budget()
	var n := 0
	if cam_dist < 14.0:
		n = budget
	elif cam_dist < 28.0:
		n = maxi(budget / 2, mini(budget, 2))
	elif cam_dist < 45.0 and budget >= 8:
		n = 3
	if n != _shell_n:
		_shell_n = n
		shells.visible = n > 0
		if n > 0:
			shells.material_override = FurLibrary.shell_chain(def, n)
	if mesh:
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cam_dist < 90.0 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func shell_count() -> int:
	return maxi(_shell_n, 0)


func vocal(id: StringName, vol_db: float) -> void:
	if id == &"" or not active:
		return
	Audio.play_sfx(id, global_position + Vector3(0.0, def.eye_height * body_scale, 0.0), vol_db, voice_pitch)
	manager.on_vocal(self, id)


# ================================================================================================ save helpers
func save_corpse() -> Dictionary:
	return {"species": String(def.id), "pos": SaveUtil.v3(global_position), "yaw": yaw, "harvested": harvest_index,
		"age": corpse_age, "id": persistent_id}

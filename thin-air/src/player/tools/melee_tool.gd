class_name MeleeTool
extends HeldItem
## Swing-based tool: anticipation (wind-up) → fast strike → impact frame (shape cast) → follow-through or
## recoil → recover. Hits call harvest_hit() on harvestables (power from tool chop/mine), take_damage() on
## damageables, and otherwise ring off the surface. Stamina cost, cooldown, durability, hit-stop, camera
## trauma, AI noise and impact particles. Holding `use` keeps swinging.

enum Phase { IDLE, WINDUP, STRIKE, FOLLOW, RECOVER }

var phase: Phase = Phase.IDLE
var phase_t := 0.0
# Phase durations (scaled so the whole swing ≈ tool.cooldown).
var t_windup := 0.3
var t_strike := 0.09
var t_follow := 0.12
var t_recover := 0.36
var reach := 1.6
var damage := 8.0
var damage_type: StringName = &"cut"
var stamina_cost := 6.0
var swing_sfx: StringName = &"axe_swing"
## Harvest tool family this tool counts as (&"axe", &"pickaxe", &"knife", &"hand").
var harvest_family: StringName = &"axe"
var noise_radius := 28.0
var trauma_hit := 0.18

# Key poses (offsets from rest): position (m), rotation (deg).
var windup_pos := Vector3(0.05, 0.12, 0.08)
var windup_rot := Vector3(55.0, -10.0, -25.0)
var strike_pos := Vector3(-0.08, -0.08, -0.12)
var strike_rot := Vector3(-65.0, 12.0, 10.0)
var follow_pos := Vector3(-0.1, -0.14, -0.1)
var follow_rot := Vector3(-80.0, 16.0, 14.0)
var recoil_rot := Vector3(-25.0, 6.0, 4.0)

var weak := false
var hit_something := false
var _hitstop := 0.0
var _from_pos := Vector3.ZERO
var _from_rot := Vector3.ZERO
var _idle_t := 0.0
var _impact_pos := Vector3.ZERO
var _impact_rot := Vector3.ZERO


func setup(p: Player, vm: Node3D, id: StringName) -> void:
	super.setup(p, vm, id)
	damage = tool_value("damage", damage)
	reach = tool_value("range", reach)
	stamina_cost = tool_value("stamina", stamina_cost)
	var cd := tool_value("cooldown", 0.0)
	if cd > 0.0:
		var total := t_windup + t_strike + t_follow + t_recover
		var k := cd / total
		t_windup *= k
		t_strike *= clampf(k, 0.8, 1.2)
		t_follow *= k
		t_recover *= k


func item_process(delta: float, can_act: bool) -> void:
	if _hitstop > 0.0:
		_hitstop -= delta
		return
	if phase == Phase.IDLE:
		_idle_t += delta
		anim_pos = anim_pos.lerp(Vector3.ZERO, 1.0 - exp(-10.0 * delta))
		anim_rot = anim_rot.lerp(idle_rot(), 1.0 - exp(-10.0 * delta))
		busy = false
		if can_act and not player.tool_blocked and Input.is_action_pressed(&"use") and cooldown_ready():
			if not try_special_use():
				start_swing()
		return
	phase_t += delta
	var slow := 1.35 if weak else 1.0
	match phase:
		Phase.WINDUP:
			var k := ease_out(phase_t / (t_windup * slow))
			anim_pos = _from_pos.lerp(windup_pos, k)
			anim_rot = _from_rot.lerp(windup_rot, k)
			if phase_t >= t_windup * slow:
				_next(Phase.STRIKE)
				Audio.play_sfx(swing_sfx, player.get_eye_position(), -4.0 if not weak else -9.0, randf_range(0.92, 1.08))
		Phase.STRIKE:
			var k := ease_in(phase_t / t_strike)
			anim_pos = _from_pos.lerp(strike_pos, k)
			anim_rot = _from_rot.lerp(strike_rot, k)
			if phase_t >= t_strike:
				_impact_pos = anim_pos
				_impact_rot = anim_rot
				hit_something = do_impact()
				if hit_something:
					_hitstop = 0.055
					_next(Phase.RECOVER)
				else:
					_next(Phase.FOLLOW)
		Phase.FOLLOW:
			var k := ease_out(phase_t / t_follow)
			anim_pos = _from_pos.lerp(follow_pos, k)
			anim_rot = _from_rot.lerp(follow_rot, k)
			if phase_t >= t_follow:
				_next(Phase.RECOVER)
		Phase.RECOVER:
			var dur := t_recover * (1.15 if hit_something else 1.0)
			var k := smooth(phase_t / dur)
			var mid_rot := _from_rot.lerp(recoil_rot, 0.35) if hit_something else _from_rot
			anim_pos = _from_pos.lerp(Vector3.ZERO, k)
			anim_rot = mid_rot.lerp(idle_rot(), k)
			if phase_t >= dur:
				phase = Phase.IDLE
				busy = false


func _next(p: Phase) -> void:
	phase = p
	phase_t = 0.0
	_from_pos = anim_pos
	_from_rot = anim_rot


## Idle rotation offset (subclasses add a slow hand tremor or breathing tilt).
func idle_rot() -> Vector3:
	return Vector3.ZERO


## Hook: return true if `use` did something else this frame (e.g. ice axe grabbing a wall).
func try_special_use() -> bool:
	return false


func start_swing() -> void:
	weak = not player.vitals.use_stamina(stamina_cost)
	if weak and player.vitals.stamina < 1.0:
		# Utterly spent: a feeble swing after a pause.
		start_cooldown(0.6)
	phase = Phase.WINDUP
	phase_t = 0.0
	_from_pos = anim_pos
	_from_rot = anim_rot
	busy = true
	hit_something = false
	player.exert(0.35)


## Performs the impact shape cast. Returns true if something solid was hit.
func do_impact() -> bool:
	var cast := player.melee_cast
	if cast == null:
		return false
	cast.target_position = Vector3(0.0, 0.0, -reach)
	cast.force_shapecast_update()
	var best := -1
	var best_d := INF
	var eye := cast.global_position
	for i in cast.get_collision_count():
		var c := cast.get_collider(i)
		if c == null or c == player:
			continue
		var d := cast.get_collision_point(i).distance_squared_to(eye)
		if d < best_d:
			best_d = d
			best = i
	if best < 0:
		return false
	var col := cast.get_collider(best)
	var point := cast.get_collision_point(best)
	var normal := cast.get_collision_normal(best)
	var mult := 0.5 if weak else 1.0
	var harv := resolve_target(col, &"harvest_hit")
	var dmg_target := resolve_target(col, &"take_damage")
	var fx: StringName = &"dust"
	if harv:
		var need: StringName = &"axe"
		if harv.has_method(&"get_harvest_tool_type"):
			need = StringName(harv.call(&"get_harvest_tool_type"))
		var power := harvest_power(need) * mult
		harv.call(&"harvest_hit", item_id, power, point, normal, player)
		fx = _fx_for_family(need)
		_play_hit_sfx(need, point)
		wear(1.0 if need == harvest_family or need == &"hand" else 2.5)
	elif dmg_target and dmg_target != player:
		dmg_target.call(&"take_damage", damage * mult, damage_type, player, point)
		fx = &"blood" if dmg_target.is_in_group(&"creature") else &"wood"
		Audio.play_sfx(&"knife_hit" if damage_type != &"blunt" else &"axe_hit_wood", point, -2.0)
		wear(1.0)
	else:
		var surf := _surface_of(col, point)
		fx = _fx_for_surface(surf)
		if surf == &"rock" or surf == &"scree" or surf == &"gravel" or surf == &"metal" or surf == &"ice":
			Audio.play_sfx(&"axe_hit_stone" if harvest_family != &"pickaxe" else &"pick_hit_stone", point, -2.0)
			wear(2.0 if harvest_family != &"pickaxe" else 1.0)
			player.add_trauma(0.08)
		else:
			Audio.play_sfx(&"axe_hit_wood", point, -6.0)
	ImpactFX.spawn(player.get_parent(), fx, point, normal)
	player.add_trauma(trauma_hit * (0.6 if weak else 1.0))
	Events.noise_emitted.emit(point, noise_radius, player)
	on_hit(col, point, normal)
	return true


## Hook after a hit (e.g. knife skinning feedback).
func on_hit(_col: Object, _point: Vector3, _normal: Vector3) -> void:
	pass


## Power passed to harvest_hit() for a harvestable that wants tool family `need`.
func harvest_power(need: StringName) -> float:
	var p := 0.0
	match need:
		&"axe":
			p = tool_value("chop", 0.2)
		&"pickaxe":
			p = tool_value("mine", 0.15)
		&"knife":
			p = tool_value("cut", tool_value("damage", 5.0) / 10.0)
		_:
			p = maxf(tool_value("chop", 0.0), 0.5)
	if need != harvest_family and need != &"hand":
		p *= 0.25
	return p


func _play_hit_sfx(need: StringName, point: Vector3) -> void:
	match need:
		&"axe":
			Audio.play_sfx(&"axe_hit_wood", point)
		&"pickaxe":
			Audio.play_sfx(&"pick_hit_stone", point)
		&"knife":
			Audio.play_sfx(&"knife_hit", point)
		_:
			Audio.play_sfx(&"axe_hit_wood", point, -6.0)


static func _surface_of(col: Object, point: Vector3) -> StringName:
	var n := col as Node
	if n and n.has_meta(&"surface"):
		return StringName(n.get_meta(&"surface"))
	return TerrainData.get_surface(point.x, point.z)


static func _fx_for_family(need: StringName) -> StringName:
	match need:
		&"axe": return &"wood"
		&"pickaxe": return &"stone"
		&"knife": return &"blood"
	return &"dust"


static func _fx_for_surface(s: StringName) -> StringName:
	match s:
		&"rock", &"scree", &"gravel", &"metal": return &"sparks"
		&"snow": return &"snow"
		&"ice": return &"ice"
		&"wood", &"forest": return &"wood"
	return &"dust"

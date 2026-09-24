class_name PlayerSounds
extends Node
## Footsteps, landings, breathing cues, heartbeat, swim strokes and cold-breath vapour for the Player.
## Emits the CONTRACT events (footstep, noise_emitted) and plays the standard SFX ids through Audio.

const SURFACES: Array[StringName] = [&"snow", &"rock", &"scree", &"grass", &"forest", &"dirt", &"ice",
	&"gravel", &"wood", &"metal", &"water"]
## AI hearing radius (m) per footstep intensity step (sneak .. sprint).
const NOISE_WALK := 5.0
const NOISE_JOG := 9.0
const NOISE_SPRINT := 18.0

var player: Player = null
var vapor: CPUParticles3D = null

var _step_ids: Dictionary = {}      # surface -> &"step_<surface>"
var _breath_timer := 2.0
var _heart_timer := 1.0
var _last_exhale := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()
	for s in SURFACES:
		_step_ids[s] = StringName("step_" + String(s))


func step_id(surface: StringName) -> StringName:
	var id: Variant = _step_ids.get(surface)
	if id == null:
		id = StringName("step_" + String(surface))
		_step_ids[surface] = id
	return id


## One footfall. intensity 0..1 (sneak..sprint).
func footstep(surface: StringName, intensity: float, pos: Vector3) -> void:
	Events.footstep.emit(surface, pos, intensity)
	var vol := lerpf(-14.0, 0.0, clampf(intensity, 0.0, 1.0))
	Audio.play_sfx(step_id(surface), pos, vol, _rng.randf_range(0.93, 1.07))
	if player and player.has_crampons() and (surface == &"ice" or surface == &"snow" or surface == &"rock"):
		Audio.play_sfx(&"crampon_step", pos, vol - 4.0, _rng.randf_range(0.95, 1.05))
	var radius := 0.0
	if intensity >= 0.9:
		radius = NOISE_SPRINT
	elif intensity >= 0.55:
		radius = NOISE_JOG
	elif intensity >= 0.3:
		radius = NOISE_WALK
	if radius > 0.0:
		if surface == &"snow":
			radius *= 0.7   # snow muffles
		elif surface == &"scree" or surface == &"gravel" or surface == &"metal":
			radius *= 1.35
		Events.noise_emitted.emit(pos, radius, player)


func land(impact: float, surface: StringName, pos: Vector3) -> void:
	if impact < 1.5:
		return
	var hard := impact > 5.5
	Audio.play_sfx(&"land_hard" if hard else &"land_soft", pos, lerpf(-10.0, 2.0, clampf(impact / 10.0, 0.0, 1.0)))
	Audio.play_sfx(step_id(surface), pos, -2.0, 0.85)
	Events.noise_emitted.emit(pos, clampf(impact * 2.8, 4.0, 30.0), player)
	if impact > PlayerMotion.SAFE_IMPACT:
		Audio.play_sfx(&"hurt", null, -2.0)


func jump(pos: Vector3) -> void:
	Audio.play_sfx(&"jump", pos, -6.0, _rng.randf_range(0.95, 1.05))


func splash(pos: Vector3, strength: float) -> void:
	Audio.play_sfx(&"splash", pos, lerpf(-10.0, 2.0, clampf(strength, 0.0, 1.0)))
	Events.noise_emitted.emit(pos, lerpf(6.0, 20.0, clampf(strength, 0.0, 1.0)), player)


func swim_stroke(pos: Vector3, strong: bool) -> void:
	Audio.play_sfx(&"swim_stroke", pos, -2.0 if strong else -8.0, _rng.randf_range(0.92, 1.08))
	Events.noise_emitted.emit(pos, 6.0, player)


func climb_grab(pos: Vector3) -> void:
	Audio.play_sfx(&"climb_grab", pos, -4.0, _rng.randf_range(0.92, 1.08))


## Breathing cues, heartbeat and vapour. Called every physics tick.
func tick(delta: float) -> void:
	if player == null or player.vitals == null or player.is_dead():
		return
	var v := player.vitals
	# Exhale moment: breath_phase crosses from positive to negative.
	var s := sin(player.breath_phase)
	if _last_exhale > 0.0 and s <= 0.0:
		_on_exhale()
	_last_exhale = s
	_breath_timer -= delta
	if _breath_timer <= 0.0:
		var eye := player.get_eye_position()
		if v.stamina < 35.0 and player.recent_exertion > 0.25:
			Audio.play_sfx(&"breath_exert", eye, lerpf(-2.0, -12.0, v.stamina / 35.0))
			_breath_timer = lerpf(1.6, 2.6, v.stamina / 35.0)
		elif player.global_position.y > 2800.0 and v.oxygen < 80.0:
			Audio.play_sfx(&"breath_altitude", eye, lerpf(-2.0, -12.0, v.oxygen / 80.0))
			_breath_timer = lerpf(2.2, 3.4, v.oxygen / 80.0)
		elif v.env_felt_temp < -5.0 or v.warmth < 35.0:
			Audio.play_sfx(&"breath_cold", eye, -8.0)
			_breath_timer = _rng.randf_range(4.0, 6.0)
		else:
			_breath_timer = 1.5
	if v.health < 28.0:
		_heart_timer -= delta
		if _heart_timer <= 0.0:
			Audio.play_sfx(&"heartbeat", null, lerpf(0.0, -12.0, v.health / 28.0))
			_heart_timer = lerpf(0.75, 1.1, v.health / 28.0)


func _on_exhale() -> void:
	if vapor == null or player.is_swimming:
		return
	var felt := player.vitals.env_felt_temp if player.vitals else 10.0
	var air := player.vitals.env_air_temp if player.vitals else 10.0
	if minf(felt, air) > 4.0:
		return
	# Colder air → denser, longer-lived vapour.
	var k := clampf((4.0 - minf(felt, air)) / 14.0, 0.0, 1.0)
	vapor.lifetime = lerpf(1.1, 2.2, k)
	vapor.restart()

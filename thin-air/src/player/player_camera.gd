class_name PlayerCameraRig
extends Node3D
## The Player's "Head" node: pitch, eye height (crouch/swim), stride-locked head bob, landing dip spring,
## step-up smoothing, breathing sway (heavier with exertion and altitude), cold shivering, camera trauma,
## sprint FOV and render-rate interpolation of the physics body. Children: Shake/Camera3D.

const STAND_EYE := 1.62
const CROUCH_EYE := 1.02
const SWIM_EYE := 1.6
const DEAD_EYE := 0.22
const MAX_PITCH := deg_to_rad(88.0)
const SPRINT_FOV := 4.0

var player: Player = null
var shake: Node3D = null
var camera: Camera3D = null

## Radians, + looks up.
var pitch := 0.0
var base_fov := 75.0
## Held items (binoculars, bow aim) set a target FOV; 0 = none.
var fov_override := 0.0
var head_bob_scale := 0.6
## 0..1 extra wobble set by vitals (hypoxia, hypothermia blur…) — HUD may also read it.
var impairment := 0.0

var _eye := STAND_EYE
var _dip := 0.0
var _dip_vel := 0.0
var _step_offset := 0.0
var _trauma := 0.0
var _t := 0.0
var _bob_amp := 0.0
var _roll := 0.0
var _fov := 75.0
var _death_t := -1.0
var _death_roll := 0.0
var _noise := FastNoiseLite.new()


func _ready() -> void:
	shake = get_node_or_null(^"Shake")
	camera = get_node_or_null(^"Shake/Camera3D")
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 1.0
	_noise.seed = 1337
	_eye = STAND_EYE
	position.y = _eye


func apply_settings() -> void:
	base_fov = float(Settings.get_value(&"fov", 75.0))
	head_bob_scale = clampf(float(Settings.get_value(&"head_bob", 0.6)), 0.0, 1.0)
	if camera:
		camera.near = 0.05
		camera.far = float(Settings.get_value(&"view_distance", 4000.0))
		if _fov <= 1.0:
			_fov = base_fov
		camera.fov = _fov


# ---- effects API --------------------------------------------------------------------------------

func add_trauma(amount: float) -> void:
	_trauma = clampf(_trauma + amount, 0.0, 1.0)


func get_trauma() -> float:
	return _trauma


## Landing impulse (impact speed m/s).
func land(impact: float) -> void:
	_dip_vel -= clampf(impact * 0.085, 0.0, 1.1)
	if impact > PlayerMotion.SAFE_IMPACT:
		add_trauma(clampf((impact - PlayerMotion.SAFE_IMPACT) / 6.0, 0.15, 0.8))


## The body just stepped up by `height` m — keep the eye where it was and ease it up.
func step_up(height: float) -> void:
	_step_offset = clampf(_step_offset - height, -0.5, 0.0)


func kick(pitch_deg: float) -> void:
	pitch = clampf(pitch + deg_to_rad(pitch_deg), -MAX_PITCH, MAX_PITCH)


func start_death() -> void:
	_death_t = 0.0
	_death_roll = deg_to_rad(68.0) * (1.0 if randf() > 0.5 else -1.0)


func reset_death() -> void:
	_death_t = -1.0
	if shake:
		shake.rotation = Vector3.ZERO
	_eye = STAND_EYE


func reset_smoothing() -> void:
	_dip = 0.0
	_dip_vel = 0.0
	_step_offset = 0.0
	_trauma = 0.0


func add_pitch(delta_rad: float) -> void:
	pitch = clampf(pitch + delta_rad, -MAX_PITCH, MAX_PITCH)


## Called by the Player from _process (render rate).
func update_rig(delta: float, interp_offset: Vector3) -> void:
	_t += delta
	var p := player
	if p == null or shake == null:
		return
	rotation.x = pitch
	# --- Eye height -------------------------------------------------------------------------
	var eye_target := STAND_EYE
	if p.is_crouching:
		eye_target = CROUCH_EYE
	elif p.is_swimming:
		eye_target = SWIM_EYE
	if _death_t >= 0.0:
		_death_t += delta
		var k := clampf(_death_t / 1.1, 0.0, 1.0)
		k = k * k * (3.0 - 2.0 * k)
		_eye = lerpf(STAND_EYE, DEAD_EYE, k)
		position = Vector3(interp_offset.x, _eye + interp_offset.y, interp_offset.z)
		shake.position = Vector3.ZERO
		shake.rotation = Vector3(deg_to_rad(-10.0) * k, 0.0, _death_roll * k)
		return
	_eye = lerpf(_eye, eye_target, 1.0 - exp(-9.0 * delta))
	# --- Landing dip spring + stair smoothing ------------------------------------------------
	var acc := -140.0 * _dip - 17.0 * _dip_vel
	_dip_vel += acc * delta
	_dip += _dip_vel * delta
	_dip = clampf(_dip, -0.35, 0.12)
	_step_offset = lerpf(_step_offset, 0.0, 1.0 - exp(-11.0 * delta))
	position = Vector3(interp_offset.x, _eye + _dip + _step_offset + interp_offset.y, interp_offset.z)
	# --- Stride-locked head bob -------------------------------------------------------------
	var grounded := p.is_grounded() and not p.is_climbing
	var speed := p.ground_speed
	var amp_target := clampf(speed / PlayerMotion.SPRINT_SPEED, 0.0, 1.25) if grounded else 0.0
	if p.is_swimming:
		amp_target = 0.0
	_bob_amp = lerpf(_bob_amp, amp_target, 1.0 - exp(-7.0 * delta))
	var ph := p.stride_phase
	var bob := _bob_amp * head_bob_scale
	var crouch_k := 0.6 if p.is_crouching else 1.0
	var bob_y := (absf(sin(ph)) - 0.62) * 0.052 * bob * crouch_k
	var bob_x := sin(ph) * 0.024 * bob * crouch_k
	var bob_roll := sin(ph) * deg_to_rad(0.55) * bob
	var bob_pitch := (absf(cos(ph)) - 0.5) * deg_to_rad(0.5) * bob
	# --- Breathing (rate and depth follow exertion + altitude) ------------------------------
	var breath := sin(p.breath_phase)
	var depth := p.breath_depth
	var br_y := breath * 0.004 * depth
	var br_pitch := breath * deg_to_rad(0.22) * depth
	# Swimming: gentle wave rocking.
	var swim_roll := 0.0
	var swim_y := 0.0
	if p.is_swimming:
		swim_roll = sin(_t * 0.9) * deg_to_rad(1.6)
		swim_y = sin(_t * 1.3) * 0.035
	# --- Strafe lean -------------------------------------------------------------------------
	var lateral := p.get_local_velocity().x
	_roll = lerpf(_roll, -lateral * deg_to_rad(0.32), 1.0 - exp(-6.0 * delta))
	# --- Shiver (cold) + impairment wobble --------------------------------------------------
	var sh_p := 0.0
	var sh_r := 0.0
	var shiver := p.shiver_amount
	if shiver > 0.01:
		sh_p = _noise.get_noise_2d(_t * 23.0, 11.0) * deg_to_rad(0.55) * shiver
		sh_r = _noise.get_noise_2d(_t * 21.0, 57.0) * deg_to_rad(0.45) * shiver
	if impairment > 0.01:
		sh_p += _noise.get_noise_2d(_t * 0.7, 3.0) * deg_to_rad(1.6) * impairment
		sh_r += _noise.get_noise_2d(_t * 0.6, 91.0) * deg_to_rad(2.2) * impairment
	# --- Trauma shake -----------------------------------------------------------------------
	var tr_p := 0.0
	var tr_y := 0.0
	var tr_r := 0.0
	var tr_off := Vector3.ZERO
	if _trauma > 0.001:
		var s := _trauma * _trauma
		tr_p = _noise.get_noise_2d(_t * 34.0, 200.0) * deg_to_rad(3.2) * s
		tr_y = _noise.get_noise_2d(_t * 34.0, 400.0) * deg_to_rad(3.2) * s
		tr_r = _noise.get_noise_2d(_t * 30.0, 600.0) * deg_to_rad(4.0) * s
		tr_off = Vector3(_noise.get_noise_2d(_t * 30.0, 800.0), _noise.get_noise_2d(_t * 30.0, 900.0), 0.0) * 0.03 * s
		_trauma = maxf(_trauma - delta * 1.35, 0.0)
	shake.position = Vector3(bob_x, bob_y + br_y + swim_y, 0.0) + tr_off
	shake.rotation = Vector3(bob_pitch + br_pitch + sh_p + tr_p, tr_y, bob_roll + _roll + swim_roll + sh_r + tr_r)
	# --- FOV ---------------------------------------------------------------------------------
	var fov_target := base_fov
	if fov_override > 0.0:
		fov_target = fov_override
	elif p.is_sprinting:
		fov_target = base_fov + SPRINT_FOV
	var fov_rate := 10.0 if fov_override > 0.0 else 5.0
	_fov = lerpf(_fov, fov_target, 1.0 - exp(-fov_rate * delta))
	if camera:
		camera.fov = _fov


func get_fov() -> float:
	return _fov

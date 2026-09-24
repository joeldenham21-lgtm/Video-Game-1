class_name PlayerMotion
extends RefCounted
## Pure movement math for the Player controller. No scene access, no allocations — unit-tested in
## tests/test_player.gd. All values are SI (m, s, m/s, m/s²) and degrees for angles.

const GRAVITY := 9.81
const TERMINAL_SPEED := 55.0

# Gait target speeds (m/s) — DESIGN: walk 1.4, jog (default) 3.2, sprint 5.2, crouch 1.0.
const WALK_SPEED := 1.4
const JOG_SPEED := 3.2
const SPRINT_SPEED := 5.2
const CROUCH_SPEED := 1.0
const SWIM_SPEED := 1.0
const SWIM_FAST_SPEED := 1.55
const CLIMB_SPEED := 0.55
const CLIMB_SPEED_CRAMPONS := 0.85
const LADDER_SPEED := 1.25

const JUMP_HEIGHT := 0.45
const STEP_HEIGHT := 0.35
const COYOTE_TIME := 0.12
const JUMP_BUFFER := 0.15

# Ground acceleration (m/s²) on full-grip surfaces. Sprinting builds up slower — you are carrying weight.
const ACCEL := 10.0
const ACCEL_SPRINT := 6.5
const DECEL := 12.5
const AIR_ACCEL := 1.1
const SWIM_ACCEL := 1.8
const SWIM_DRAG := 1.4

# Fall damage (impact speed along the landing normal).
const SAFE_IMPACT := 7.0
const LETHAL_IMPACT := 16.0
const SPRAIN_IMPACT := 9.5

const SLIDE_MAX_SPEED := 12.0

enum Gait { CROUCH, WALK, JOG, SPRINT }


static func gait_speed(gait: int) -> float:
	match gait:
		Gait.CROUCH: return CROUCH_SPEED
		Gait.WALK: return WALK_SPEED
		Gait.SPRINT: return SPRINT_SPEED
		_: return JOG_SPEED


## Stride length per single step (m) — drives head bob and footstep cadence.
static func step_length(speed: float) -> float:
	# ~0.62 m when strolling, ~1.0 jogging, ~1.45 sprinting (real human gait data, roughly linear).
	return clampf(0.42 + speed * 0.2, 0.5, 1.5)


## Initial vertical velocity for a jump of `height` metres.
static func jump_velocity(height := JUMP_HEIGHT, g := GRAVITY) -> float:
	return sqrt(2.0 * g * maxf(height, 0.0))


## Traction multiplier for acceleration/deceleration (1 = dry rock/wood).
static func surface_grip(surface: StringName, crampons: bool) -> float:
	match surface:
		&"ice":
			return 0.92 if crampons else 0.11
		&"snow":
			return 0.95 if crampons else 0.72
		&"scree":
			return 0.7
		&"gravel":
			return 0.85
		&"water":
			return 0.6
		&"grass", &"forest":
			return 0.92
		&"metal":
			return 0.85
		_:
			return 1.0


## Slope angle above which you slide and can't walk up (deg).
static func surface_slide_limit_deg(surface: StringName, crampons: bool) -> float:
	match surface:
		&"ice":
			return 50.0 if crampons else 26.0
		&"snow":
			return 48.0 if crampons else 40.0
		&"scree", &"gravel":
			return 38.0
		&"grass", &"forest", &"dirt":
			return 45.0
		_:
			return 50.0


## Kinetic friction coefficient while sliding on the surface.
static func surface_friction(surface: StringName) -> float:
	match surface:
		&"ice": return 0.04
		&"snow": return 0.22
		&"scree", &"gravel": return 0.45
		&"grass", &"forest", &"dirt": return 0.4
		_: return 0.5


## Along-slope acceleration while sliding (m/s², always a little positive so you keep sliding).
static func slide_accel(slope_deg: float, friction: float, g := GRAVITY) -> float:
	var t := deg_to_rad(slope_deg)
	return maxf(g * (sin(t) - friction * cos(t)), 0.6)


## 0..1 snow depth from the terrain snow mask and altitude (deep powder above ~2,300 m).
static func snow_depth(mask_snow: float, altitude: float) -> float:
	var alt_f := clampf((altitude - 1500.0) / 900.0, 0.15, 1.0)
	return clampf(mask_snow * alt_f, 0.0, 1.0)


static func snow_speed_factor(depth: float) -> float:
	return lerpf(1.0, 0.52, clampf(depth, 0.0, 1.0))


## Movement slow-down when carrying more than `max_weight` (kg).
static func weight_speed_factor(weight: float, max_weight: float) -> float:
	if max_weight <= 0.0 or weight <= max_weight:
		return 1.0
	var over := (weight - max_weight) / max_weight
	return clampf(1.0 - over * 1.25, 0.35, 1.0)


## Speed factor for walking up/down a slope. `uphill` = dot(move dir, horizontal uphill dir) in −1..1.
static func slope_speed_factor(slope_deg: float, uphill: float) -> float:
	if slope_deg < 4.0:
		return 1.0
	var grade := clampf(sin(deg_to_rad(slope_deg)) / sin(deg_to_rad(45.0)), 0.0, 1.0)
	if uphill > 0.0:
		return lerpf(1.0, 0.45, grade * uphill)
	# Going down steep ground you instinctively brake a little.
	return lerpf(1.0, 0.8, clampf(grade - 0.45, 0.0, 1.0) * -uphill)


## Wading slows you from knee depth to chest depth.
static func wading_factor(depth: float) -> float:
	return lerpf(1.0, 0.42, clampf((depth - 0.35) / 0.9, 0.0, 1.0))


## Health damage for a landing at `impact_speed` (m/s along the ground normal). 0 below SAFE_IMPACT,
## 100 (lethal for a healthy person) at LETHAL_IMPACT.
static func fall_damage(impact_speed: float) -> float:
	if impact_speed <= SAFE_IMPACT:
		return 0.0
	var t := (impact_speed - SAFE_IMPACT) / (LETHAL_IMPACT - SAFE_IMPACT)
	return 100.0 * pow(t, 1.45)


## Moves horizontal velocity `current` toward `target`, using `accel` when gaining speed along the target
## and `decel` when braking or turning.
static func approach(current: Vector3, target: Vector3, accel: float, decel: float, dt: float) -> Vector3:
	var gaining := target.length_squared() > current.length_squared() and current.dot(target) >= 0.0
	var rate := accel if gaining else decel
	return current.move_toward(target, rate * dt)


## Analog response curve (sign-preserving power) applied to a stick vector after deadzone.
static func pad_curve(v: Vector2, expo := 1.8) -> Vector2:
	var l := v.length()
	if l < 1e-4:
		return Vector2.ZERO
	var m := pow(minf(l, 1.0), expo)
	return v / l * m


## Vertical acceleration of a swimmer: spring toward the float height + water damping.
static func buoyancy_accel(y: float, target_y: float, vy: float, stiffness := 10.0, damping := 3.6) -> float:
	return stiffness * (target_y - y) - damping * vy


## Ballistic speed of an arrow for a draw fraction (0..1) — 15 m/s when barely drawn, 58 m/s full draw.
static func arrow_speed(draw: float) -> float:
	var d := clampf(draw, 0.0, 1.0)
	return lerpf(15.0, 58.0, d * d * (3.0 - 2.0 * d))


## Effective temperature (°C) felt when immersed in lake/stream water. Water conducts heat ~25× faster than
## air, so 3 °C water feels like a −32 °C day: hypothermia sets in after roughly a minute of swimming.
static func immersion_temperature(water_c := 3.0) -> float:
	return water_c - 35.0

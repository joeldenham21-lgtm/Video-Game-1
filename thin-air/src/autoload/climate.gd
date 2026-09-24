extends Node
## Climate — time of day, sun/moon, weather state machine, air temperature, wind, heat sources,
## shelters and felt temperature. CONTRACT.md §3 "Climate". Owned by the Sky workstream.
##
## Model summary
## * Clock: 40-minute day by default. Day 1 = 29 October at 56° N (sunrise ≈07:50, sunset ≈17:20).
## * Weather: Markov chain over clear/cloudy/overcast/snow/blizzard/fog with 30–180 game-minute spells,
##   time-of-day biases (valley fog before dawn) and smooth parameter blending. Story can force a state
##   with set_weather() and freeze it with `locked` (time + weather) or `weather_locked` (weather only).
## * Air temperature: valley (1,300 m) diurnal cycle ≈ −7 °C at dawn → +3 °C mid-afternoon, lapse rate
##   −6.5 °C/km, weather offsets (clear nights colder, cloud keeps nights mild, blizzards bitterly cold),
##   a shallow cold-air-pool inversion on clear calm nights, and a slow autumn cooling trend.
## * Wind: prevailing south-westerly that slowly veers, layered-noise gusts travelling downwind, stronger
##   with altitude and on exposed ridges, weaker in forest (TerrainData masks.a) and inside shelters.
## * Felt temperature: air + Environment Canada wind chill (reduced by windproof clothing) + fire heat +
##   shelter + clothing insulation − wet penalty (+ a little solar gain in calm sunshine).
## Global shader params (wind_direction, wind_strength, time_of_day, snow_cover, sun_direction, wetness,
## fog_color) are pushed every frame. The Sky scene registers itself to own fog_color.

# ---------------------------------------------------------------------------------------------- contract
var day: int = 1
var hours: float = 17.3
var day_length_minutes: float = 40.0
var time_scale: float = 1.0
var weather: StringName = &"snow"
var cloud_cover: float = 1.0
var precipitation: float = 0.3
var fog_density: float = 0.2
var wind_speed: float = 5.0
var wind_direction: Vector3 = Vector3(0.7071, 0.0, -0.7071)
var locked: bool = false

# ---------------------------------------------------------------------------------------------- extensions
## Freeze only the weather chain (time keeps running).
var weather_locked: bool = false
## Global extra snow dusting 0..1 (accumulates in snowfall, melts in valley sunshine). Shader global snow_cover.
var snow_cover: float = 0.3
## Surface wetness 0..1 (melt water, wet snow, fog). Shader global wetness.
var wetness: float = 0.1
## Visible aurora strength 0..1 (the sky reads this; clouds still hide it).
var aurora_intensity: float = 0.0
## Story override for the aurora (>= 0 forces that strength).
var aurora_forced: float = -1.0
## Override for the moon phase (>= 0 forces; dev/photo tools). 0 = new, 0.5 = full.
var moon_phase_override: float = -1.0
## Current blended weather parameters (see WeatherTable.PARAMS). Read-only for other systems.
var params: Dictionary = {}
## Wind bearing the wind blows FROM, degrees clockwise from north (225 = south-west).
var wind_from_deg: float = 225.0
## Seconds of real time the Markov chain has left in the current spell (in game minutes).
var weather_minutes_left: float = 90.0
## Top altitude (m ASL) of the valley fog layer and its intensity 0..1 (sky renders it).
var valley_fog_top: float = 1420.0
var valley_fog: float = 0.0

const VALLEY_FLOOR := 1300.0
const REFERENCE_WIND_ALT := 2000.0
const LAPSE_RATE := -6.5            # °C per km
const VALLEY_MEAN_C := -2.0         # diurnal mean at 1,300 m on day 1
const VALLEY_AMPLITUDE_C := 5.0     # half range: −7 … +3
const SEASONAL_TREND_C := -0.12     # °C per day into November
const DAWN_MIN_HOUR := 8.0          # coldest just after sunrise
const AFTERNOON_MAX_HOUR := 14.5
const HEAT_CAP_C := 38.0
const SHELTER_EDGE_M := 0.6
const SHELTER_BONUS_C := 4.0
const WIND_CHILL_MIN_KMH := 4.8

var _from_params: Dictionary = {}
var _to_params: Dictionary = {}
var _blend: float = 1.0
var _blend_seconds: float = 0.0
var _rng := RandomNumberGenerator.new()
var _gust_noise := FastNoiseLite.new()
var _veer_noise := FastNoiseLite.new()
var _wind_time: float = 0.0
var _gust_value: float = 0.0
var _aurora_tonight: float = 0.0
var _sky: Node = null

var _cache_key: Vector2 = Vector2(-1.0, -1.0)
var _sun_dir: Vector3 = Vector3.UP
var _moon_dir: Vector3 = Vector3.DOWN
var _lst: float = 0.0

var _heat_nodes: Array[Node] = []
var _shelter_nodes: Array[Node] = []
var _group_refresh: float = 0.0
var _exposure_cache: Dictionary = {}
var _terrain_seen_loaded: bool = false
var _globals_ok: bool = false


func _ready() -> void:
	_rng.seed = hash("thin-air-climate")
	_gust_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_gust_noise.seed = 4721
	_gust_noise.frequency = 1.0
	_veer_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_veer_noise.seed = 913
	_veer_noise.frequency = 1.0
	_set_weather_immediate(weather)
	weather_minutes_left = WeatherTable.roll_duration(weather, _rng)
	_globals_ok = not DisplayServer.get_name().is_empty() and DisplayServer.get_name() != "headless"
	if Events.has_signal("game_started"):
		Events.game_started.connect(_on_game_started)
	_update_wind(0.0)
	_update_aurora()


## Restore the new-game defaults: day 1, 17:18, light snow at dusk (the prologue crash).
func reset_new_game() -> void:
	day = 1
	hours = 17.3
	time_scale = 1.0
	locked = false
	weather_locked = false
	_rng.seed = hash("thin-air-climate")
	snow_cover = 0.3
	wetness = 0.1
	wind_from_deg = 225.0
	aurora_forced = -1.0
	moon_phase_override = -1.0
	_aurora_tonight = 0.0
	_set_weather_immediate(&"snow")
	weather_minutes_left = WeatherTable.roll_duration(weather, _rng)
	_update_wind(0.0)


func _on_game_started(is_new: bool) -> void:
	if is_new:
		reset_new_game()


func register_sky(sky: Node) -> void:
	_sky = sky


# ============================================================================================ main loop
func _process(delta: float) -> void:
	var playing := Game.is_playing() if Game else false
	var game_dt := delta * time_scale
	if playing and not locked:
		_advance_clock(game_dt * 24.0 / maxf(day_length_minutes * 60.0, 1.0))
		if not weather_locked:
			weather_minutes_left -= game_dt * 1440.0 / maxf(day_length_minutes * 60.0, 1.0)
			if weather_minutes_left <= 0.0:
				_next_weather()
	# Blending, wind and derived values always run (story freezes still animate the sky).
	_update_blend(game_dt if playing else delta)
	_update_wind(delta)
	var game_hours := game_dt * 24.0 / maxf(day_length_minutes * 60.0, 1.0) if (playing and not locked) else 0.0
	_update_surface(game_hours)
	_update_aurora()
	_group_refresh -= delta
	if _group_refresh <= 0.0:
		_refresh_groups()
	_push_globals()


func _advance_clock(dh: float) -> void:
	var remaining := dh
	while remaining > 0.0:
		var to_next := floorf(hours) + 1.0 - hours
		if remaining < to_next:
			hours += remaining
			break
		remaining -= to_next
		hours = floorf(hours) + 1.0
		if hours >= 24.0:
			hours -= 24.0
			day += 1
			Events.hour_passed.emit(0)
			Events.day_started.emit(day)
			_on_hour(0)
		else:
			Events.hour_passed.emit(int(hours))
			_on_hour(int(hours))


func _on_hour(h: int) -> void:
	# Each evening decide whether tonight brings aurora (clear, cold, northern BC ≈ 62° geomagnetic).
	if h == 18:
		var clearish := float(params.get(&"cloud_cover", 1.0)) < 0.6
		_aurora_tonight = _rng.randf_range(0.35, 1.0) if clearish and _rng.randf() < 0.3 else 0.0


# ============================================================================================ time
func advance_time(hours_to_add: float) -> void:
	if hours_to_add <= 0.0:
		return
	# Run the weather chain through the skipped time so sleeping through a storm ends elsewhere.
	var remaining_min := hours_to_add * 60.0
	if not weather_locked and not locked:
		while remaining_min > weather_minutes_left:
			remaining_min -= weather_minutes_left
			var nxt := WeatherTable.pick_next(weather, fposmod(hours + (hours_to_add * 60.0 - remaining_min) / 60.0, 24.0), _rng)
			_set_weather_immediate(nxt)
			weather_minutes_left = WeatherTable.roll_duration(nxt, _rng)
		weather_minutes_left -= remaining_min
	_advance_clock(hours_to_add)
	# Surface state catches up (snow keeps falling while you sleep).
	var steps := int(ceilf(hours_to_add * 4.0))
	for _i in steps:
		_update_surface(hours_to_add / float(steps))
	_blend = 1.0
	_update_blend(0.0)


func get_time_string() -> String:
	var total_min := int(floorf(hours * 60.0 + 0.0001))
	return "%02d:%02d" % [(total_min / 60) % 24, total_min % 60]


func get_sunrise_hour() -> float:
	return Astronomy.sunrise_hour(day)


func get_sunset_hour() -> float:
	return Astronomy.sunset_hour(day)


func is_night() -> bool:
	return get_sun_direction().y < sin(deg_to_rad(-6.0))


# ============================================================================================ sun & moon
func _refresh_astro() -> void:
	var key := Vector2(float(day), hours)
	if key == _cache_key:
		return
	_cache_key = key
	_sun_dir = Astronomy.sun_direction(day, hours)
	_moon_dir = Astronomy.moon_direction(day, hours)
	_lst = Astronomy.local_sidereal_time(day, hours)


func get_sun_direction() -> Vector3:
	_refresh_astro()
	return _sun_dir


func get_moon_direction() -> Vector3:
	_refresh_astro()
	return _moon_dir


## Local sidereal time (radians) – the sky uses it to rotate stars/Milky Way.
func get_sidereal_time() -> float:
	_refresh_astro()
	return _lst


## 0 = new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
func get_moon_phase() -> float:
	if moon_phase_override >= 0.0:
		return fposmod(moon_phase_override, 1.0)
	return Astronomy.moon_phase(day, hours)


## Illuminated fraction 0..1.
func get_moon_illumination() -> float:
	return Astronomy.moon_illumination(get_moon_phase())


## 0 night .. 1 full day, following civil twilight (sun −6° → +6°).
func get_daylight() -> float:
	var el := Astronomy.elevation_deg(get_sun_direction())
	return smoothstep(-6.0, 6.0, el)


## Rough ambient light level 0..1 for AI sight / gameplay: daylight, twilight, moonlight, cloud.
func get_light_level() -> float:
	var el := Astronomy.elevation_deg(get_sun_direction())
	var sun := smoothstep(-10.0, 8.0, el)
	var moon_el := Astronomy.elevation_deg(get_moon_direction())
	var moon := 0.12 * Astronomy.moon_brightness(get_moon_phase()) * smoothstep(-1.0, 12.0, moon_el)
	var cloud := 1.0 - 0.55 * cloud_cover * float(params.get(&"cloud_density", 0.5))
	return clampf(maxf(sun, moon) * cloud, 0.0, 1.0)


# ============================================================================================ weather
func set_weather(w: StringName, transition_s := 60.0) -> void:
	if not WeatherTable.is_valid(w):
		push_warning("Climate: unknown weather '%s'" % w)
		return
	var changed := w != weather
	weather = w
	weather_minutes_left = WeatherTable.roll_duration(w, _rng)
	if transition_s <= 0.0:
		_set_weather_immediate(w)
	else:
		_from_params = params.duplicate()
		_to_params = WeatherTable.params_for(w).duplicate()
		_blend = 0.0
		_blend_seconds = transition_s
	if changed:
		Events.weather_changed.emit(w)


func _set_weather_immediate(w: StringName) -> void:
	weather = w
	_to_params = WeatherTable.params_for(w).duplicate()
	_from_params = _to_params.duplicate()
	params = _to_params.duplicate()
	_blend = 1.0
	_blend_seconds = 0.0
	_apply_params()


func _next_weather() -> void:
	var nxt := WeatherTable.pick_next(weather, hours, _rng)
	var minutes: float = WeatherTable.TRANSITION_MINUTES.get(nxt, 30.0)
	var real_s := minutes / 1440.0 * day_length_minutes * 60.0
	if nxt == weather:
		weather_minutes_left = WeatherTable.roll_duration(nxt, _rng)
		return
	set_weather(nxt, real_s)


## Weather transition progress 0..1 (1 = settled).
func get_weather_blend() -> float:
	return _blend


func _update_blend(dt: float) -> void:
	if _blend < 1.0:
		_blend = 1.0 if _blend_seconds <= 0.0 else minf(1.0, _blend + dt / _blend_seconds)
		var t := smoothstep(0.0, 1.0, _blend)
		WeatherTable.lerp_params(_from_params, _to_params, t, params)
	_apply_params()


func _apply_params() -> void:
	cloud_cover = float(params.get(&"cloud_cover", 0.5))
	precipitation = float(params.get(&"precipitation", 0.0))
	# Valley fog: the weather's own fog bank plus a thin radiation mist on calm, clear dawns.
	var dawn := _dawn_factor(hours)
	var calm := clampf(1.0 - (float(params.get(&"wind", 4.0)) - 1.5) / 4.0, 0.0, 1.0)
	var mist := 0.35 * dawn * calm * (1.0 - cloud_cover) * (1.0 - precipitation)
	valley_fog = clampf(maxf(float(params.get(&"valley_fog", 0.0)), mist), 0.0, 1.0)
	# The fog layer deepens before dawn, then lifts and thins through the morning.
	var lift := smoothstep(8.5, 12.0, hours) if hours < 18.0 else 0.0
	valley_fog_top = VALLEY_FLOOR + 110.0 + 160.0 * valley_fog + 180.0 * lift
	valley_fog *= 1.0 - 0.85 * lift * (1.0 if weather != &"fog" else 0.5)
	fog_density = clampf(float(params.get(&"fog", 0.0)), 0.0, 1.0)


static func _dawn_factor(h: float) -> float:
	# 0 → 1 between 03:00 and 06:30, holds to 08:30, fades by 11:00.
	if h < 3.0 or h > 11.0:
		return 0.0
	if h < 6.5:
		return smoothstep(3.0, 6.5, h)
	if h < 8.5:
		return 1.0
	return 1.0 - smoothstep(8.5, 11.0, h)


# ============================================================================================ wind
func _update_wind(delta: float) -> void:
	_wind_time += delta
	var base := float(params.get(&"wind", 4.0))
	var gust := float(params.get(&"gust", 0.4))
	_gust_value = _gust_at_time(_wind_time)
	wind_speed = maxf(0.0, base * maxf(0.15, 1.0 + gust * 1.3 * _gust_value))
	# Slow veer: weather-driven offset + a wandering component (tens of game-minutes).
	var wander := 28.0 * _veer_noise.get_noise_1d(_wind_time * 0.004 + float(day) * 3.1)
	var target := 225.0 + float(params.get(&"veer", 0.0)) + wander
	var diff := wrapf(target - wind_from_deg, -180.0, 180.0)
	wind_from_deg = fposmod(wind_from_deg + diff * clampf(delta * 0.05, 0.0, 1.0), 360.0)
	var b := deg_to_rad(wind_from_deg)
	wind_direction = Vector3(-sin(b), 0.0, cos(b))


## Layered gust noise in ~[-1, 1]: slow swells, gusts, and flutter.
func _gust_at_time(t: float) -> float:
	var g := 0.60 * _gust_noise.get_noise_1d(t * 0.07)
	g += 0.30 * _gust_noise.get_noise_1d(t * 0.31 + 57.0)
	g += 0.15 * _gust_noise.get_noise_1d(t * 1.30 + 131.0)
	return clampf(g * 1.6, -1.0, 1.0)


## Wind vector (m/s) at a world position: reference wind scaled by altitude, ridge exposure, forest
## shelter and shelters, with gust fronts that travel downwind.
func get_wind_at(pos: Vector3) -> Vector3:
	var base := float(params.get(&"wind", 4.0))
	var gustiness := float(params.get(&"gust", 0.4))
	# Gust front: the same gust signal, delayed by travel time along the wind.
	var along := pos.x * wind_direction.x + pos.z * wind_direction.z
	var t_local := _wind_time - along / maxf(base * 1.2, 2.0)
	var g := _gust_at_time(t_local)
	var speed := base * maxf(0.15, 1.0 + gustiness * 1.3 * g)
	speed *= altitude_wind_factor(pos.y) * get_exposure_at(pos)
	speed *= 1.0 - 0.9 * get_shelter_at(pos)
	# Small direction wobble in gusts.
	var wob := deg_to_rad(9.0 * _veer_noise.get_noise_1d(t_local * 0.2 + 400.0))
	var dir := wind_direction.rotated(Vector3.UP, wob)
	return dir * speed


## Wind grows with height above the valley floor (≈0.5× at 1,300 m, 1× at 2,000 m, 1.5× at the summit).
static func altitude_wind_factor(y: float) -> float:
	return pow(clampf((y - 1100.0) / 900.0, 0.1, 4.0), 0.42)


## Terrain exposure multiplier: ridges and summits > 1, hollows and forest < 1.
func get_exposure_at(pos: Vector3) -> float:
	var loaded := TerrainData.is_loaded()
	if loaded != _terrain_seen_loaded:
		_terrain_seen_loaded = loaded
		_exposure_cache.clear()
	var key := Vector2i(int(floorf(pos.x / 24.0)), int(floorf(pos.z / 24.0)))
	var terrain_factor: float
	if _exposure_cache.has(key):
		terrain_factor = _exposure_cache[key]
	else:
		terrain_factor = _compute_terrain_exposure(pos.x, pos.z)
		if _exposure_cache.size() > 512:
			_exposure_cache.clear()
		_exposure_cache[key] = terrain_factor
	var ground := TerrainData.get_height(pos.x, pos.z)
	var above := clampf((pos.y - ground - 2.0) / 60.0, 0.0, 0.35)
	return terrain_factor + above


func _compute_terrain_exposure(x: float, z: float) -> float:
	var forest := clampf(TerrainData.get_masks(x, z).a, 0.0, 1.0)
	var ridge := 1.0
	if TerrainData.is_loaded():
		var h0 := TerrainData.get_height(x, z)
		var sum := 0.0
		for i in 8:
			var a := TAU * float(i) / 8.0
			sum += TerrainData.get_height(x + cos(a) * 90.0, z + sin(a) * 90.0)
		var rel := h0 - sum / 8.0
		ridge = clampf(1.0 + rel / 80.0, 0.5, 1.45)
	return ridge * (1.0 - 0.6 * forest)


# ============================================================================================ temperature
## Diurnal shape −1 (dawn minimum) … +1 (afternoon maximum).
static func diurnal_curve(h: float) -> float:
	var span_up := AFTERNOON_MAX_HOUR - DAWN_MIN_HOUR
	if h >= DAWN_MIN_HOUR and h <= AFTERNOON_MAX_HOUR:
		return -cos(PI * (h - DAWN_MIN_HOUR) / span_up)
	var x := fposmod(h - AFTERNOON_MAX_HOUR, 24.0) / (24.0 - span_up)
	# Fast cooling after sunset, slow through the night.
	var s := (1.0 - exp(-2.2 * x)) / (1.0 - exp(-2.2))
	return cos(PI * s)


## Valley-floor (1,300 m) temperature before weather offsets.
func get_base_valley_temperature(h: float = -1.0) -> float:
	var hh := hours if h < 0.0 else h
	var trend := maxf(SEASONAL_TREND_C * float(day - 1), -5.0)
	return VALLEY_MEAN_C + trend + VALLEY_AMPLITUDE_C * diurnal_curve(hh)


func get_air_temperature(pos: Vector3) -> float:
	var d := diurnal_curve(hours)
	var w_day := 0.5 * (d + 1.0)
	var t := get_base_valley_temperature()
	t += lerpf(float(params.get(&"temp_night", 0.0)), float(params.get(&"temp_day", 0.0)), w_day)
	t += LAPSE_RATE * (pos.y - VALLEY_FLOOR) / 1000.0
	# Cold-air pooling on clear, calm nights: the valley floor is colder than the lower slopes.
	var calm := clampf(1.0 - (float(params.get(&"wind", 4.0)) - 1.5) / 5.0, 0.0, 1.0)
	# The pool builds after dusk and is mixed out once the low sun has warmed the valley (~2 h).
	var night := 1.0 - smoothstep(-2.0, 14.0, Astronomy.elevation_deg(get_sun_direction()))
	var inversion := (1.0 - cloud_cover) * calm * night
	t -= 3.0 * inversion * clampf(1.0 - (pos.y - VALLEY_FLOOR) / 350.0, 0.0, 1.0)
	return t


## Environment Canada wind-chill index (°C). Valid for T ≤ 10 °C and V ≥ 4.8 km/h; returns T otherwise.
static func wind_chill(t_air: float, wind_kmh: float) -> float:
	if t_air > 10.0 or wind_kmh < WIND_CHILL_MIN_KMH:
		return t_air
	var v := pow(wind_kmh, 0.16)
	return minf(t_air, 13.12 + 0.6215 * t_air - 11.37 * v + 0.3965 * t_air * v)


## Heat (°C) from nodes in the "heat_source" group: smooth falloff to zero at heat_radius.
func get_heat_at(pos: Vector3) -> float:
	var total := 0.0
	for n in _heat_nodes:
		if not is_instance_valid(n) or not (n is Node3D) or not n.is_inside_tree():
			continue
		if n.has_method("is_heat_active") and not n.is_heat_active():
			continue
		var r := float(n.get("heat_radius")) if n.get("heat_radius") != null else 0.0
		var c := float(n.get("heat_celsius")) if n.get("heat_celsius") != null else 0.0
		if r <= 0.0 or c == 0.0:
			continue
		var d := (n as Node3D).global_position.distance_to(pos)
		total += c * heat_falloff(d, r)
	# Several fires don't stack linearly; soft cap.
	return HEAT_CAP_C * tanh(total / HEAT_CAP_C) if total > 0.0 else total


## 1 at the source → 0 at radius, smooth (C1) at both ends.
static func heat_falloff(d: float, radius: float) -> float:
	if d >= radius:
		return 0.0
	var x := d / radius
	var f := 1.0 - x * x
	return f * f


## 0..1 shelter from Area3D nodes in the "shelter" group (max over overlapping shelters).
func get_shelter_at(pos: Vector3) -> float:
	var best := 0.0
	for n in _shelter_nodes:
		if not is_instance_valid(n) or not n.is_inside_tree():
			continue
		var s := _shelter_amount(n, pos)
		if s > best:
			best = s
	return clampf(best, 0.0, 1.0)


func _shelter_amount(n: Node, pos: Vector3) -> float:
	if n.has_method("get_shelter_at"):
		return float(n.call("get_shelter_at", pos))
	var factor := float(n.get("shelter_factor")) if n.get("shelter_factor") != null else 1.0
	if factor <= 0.0 or not (n is Node3D):
		return 0.0
	var inside := 0.0
	var found_shape := false
	for c in n.get_children():
		if c is CollisionShape3D and (c as CollisionShape3D).shape and not (c as CollisionShape3D).disabled:
			found_shape = true
			var cs := c as CollisionShape3D
			var local := cs.global_transform.affine_inverse() * pos
			inside = maxf(inside, _inside_shape(cs.shape, local))
	if not found_shape:
		var r := float(n.get("shelter_radius")) if n.get("shelter_radius") != null else 0.0
		if r > 0.0:
			var d := (n as Node3D).global_position.distance_to(pos)
			inside = 1.0 - smoothstep(r - SHELTER_EDGE_M, r, d)
	return inside * factor


## Soft inside test in the shape's local space: 1 well inside, → 0 across SHELTER_EDGE_M at the boundary.
static func _inside_shape(shape: Shape3D, p: Vector3) -> float:
	var sd := 1e9   # signed distance: negative inside
	if shape is BoxShape3D:
		var h := (shape as BoxShape3D).size * 0.5
		var q := p.abs() - h
		sd = Vector3(maxf(q.x, 0.0), maxf(q.y, 0.0), maxf(q.z, 0.0)).length() + minf(maxf(q.x, maxf(q.y, q.z)), 0.0)
	elif shape is SphereShape3D:
		sd = p.length() - (shape as SphereShape3D).radius
	elif shape is CylinderShape3D:
		var cy := shape as CylinderShape3D
		var dxz := Vector2(p.x, p.z).length() - cy.radius
		var dy := absf(p.y) - cy.height * 0.5
		sd = Vector2(maxf(dxz, 0.0), maxf(dy, 0.0)).length() + minf(maxf(dxz, dy), 0.0)
	elif shape is CapsuleShape3D:
		var cp := shape as CapsuleShape3D
		var half := maxf(cp.height * 0.5 - cp.radius, 0.0)
		var qy := clampf(p.y, -half, half)
		sd = Vector3(p.x, p.y - qy, p.z).length() - cp.radius
	elif shape:
		var mesh := shape.get_debug_mesh()
		if mesh:
			var aabb := mesh.get_aabb()
			var c := aabb.get_center()
			var h2 := aabb.size * 0.5
			var q2 := (p - c).abs() - h2
			sd = Vector3(maxf(q2.x, 0.0), maxf(q2.y, 0.0), maxf(q2.z, 0.0)).length() + minf(maxf(q2.x, maxf(q2.y, q2.z)), 0.0)
	return 1.0 - smoothstep(-SHELTER_EDGE_M, 0.0, sd)


## Felt temperature (°C). `insulation` = clothing warmth (°C equivalent, Player.get_insulation()).
## `windproof` 0..1 (defaults to the player's clothing when < 0).
func get_felt_temperature(pos: Vector3, insulation: float, wet: bool, windproof: float = -1.0) -> float:
	var air := get_air_temperature(pos)
	var wind := get_wind_at(pos).length()          # already reduced by shelter/forest
	var shelter := get_shelter_at(pos)
	if windproof < 0.0:
		windproof = 0.0
		if Game and Game.player and Game.player.has_method("get_windproof"):
			windproof = clampf(float(Game.player.get_windproof()), 0.0, 1.0)
	var chill := (wind_chill(air, wind * 3.6) - air) * (1.0 - windproof)
	var heat := get_heat_at(pos) * (1.0 + 0.4 * shelter)
	var bonus := SHELTER_BONUS_C * shelter
	var ins := insulation * (0.45 if wet else 1.0)
	var wet_pen := 0.0
	if wet:
		wet_pen = (4.0 + 0.35 * wind) * (1.0 - 0.5 * shelter)
	# Calm sunshine warms you noticeably even on a freezing day.
	var sun := get_sun_direction()
	var solar := 0.0
	if sun.y > 0.0:
		var clouds := 1.0 - cloud_cover * float(params.get(&"cloud_density", 0.5))
		solar = 3.0 * clampf(sun.y * 2.5, 0.0, 1.0) * clouds * (1.0 - shelter) * clampf(1.0 - wind / 12.0, 0.0, 1.0)
	return air + chill + heat + bonus + ins - wet_pen + solar


# ============================================================================================ visibility
## Meteorological visibility (m) at a position: precipitation, whiteout and valley fog.
func get_visibility_at(pos: Vector3) -> float:
	var vis := 60000.0 / (1.0 + 4.0 * float(params.get(&"haze", 0.0)))
	var p := precipitation
	if p > 0.0:
		# Log-linear in snowfall rate: light snow (0.2) ≈ 4.5 km, moderate (0.55) ≈ 900 m,
		# blizzard (1.0) ≈ 60 m before the whiteout factor.
		vis = minf(vis, 8000.0 * pow(60.0 / 8000.0, pow(p, 1.35)))
	vis = minf(vis, lerpf(vis, 25.0, pow(fog_density, 2.5)))
	if valley_fog > 0.01 and pos.y < valley_fog_top:
		var depth := clampf((valley_fog_top - pos.y) / 60.0, 0.0, 1.0)
		vis = minf(vis, lerpf(vis, 120.0, valley_fog * depth))
	return maxf(vis, 20.0)


## Precipitation type at a position from the air temperature (wet snow / rain in a warm valley).
func get_precipitation_type(pos: Vector3) -> StringName:
	var t := get_air_temperature(pos)
	if t > 2.8:
		return &"rain"
	if t > 0.6:
		return &"sleet"
	return &"snow"


# ============================================================================================ surface
func _update_surface(game_hours: float) -> void:
	if game_hours <= 0.0:
		return
	var ref := Vector3(0.0, 1500.0, 0.0)
	var t := get_air_temperature(ref)
	var sun := clampf(get_sun_direction().y * 3.0, 0.0, 1.0) * (1.0 - 0.8 * cloud_cover)
	# Accumulation: heavy snow buries everything in ~3 h; wet snow sticks less.
	var accum := precipitation * 0.35 * (1.0 if t < 0.5 else clampf(1.0 - (t - 0.5) / 2.0, 0.0, 1.0))
	var melt := 0.0
	if t > 0.0:
		melt += 0.035 * t
	melt += 0.06 * sun * clampf((t + 4.0) / 6.0, 0.0, 1.0)
	snow_cover = clampf(snow_cover + (accum - melt) * game_hours, 0.0, 1.0)
	var wet_gain := melt * (1.0 if snow_cover > 0.02 else 0.3) * 2.0
	if precipitation > 0.0 and t > -0.5:
		wet_gain += precipitation * 0.5
	wet_gain += 0.08 * valley_fog
	var dry := 0.12 * (0.5 + sun) * (1.0 + wind_speed / 8.0)
	if t < -3.0:
		dry += 0.05   # freezes / sublimates
	wetness = clampf(wetness + (wet_gain - dry * wetness) * game_hours, 0.0, 1.0)


func _update_aurora() -> void:
	if aurora_forced >= 0.0:
		aurora_intensity = clampf(aurora_forced, 0.0, 1.0)
		return
	var h := hours
	# Activity from ~20:00 to 04:00 with a substorm peak just before local midnight.
	var hh := h if h >= 12.0 else h + 24.0
	var env := exp(-pow((hh - 23.5) / 2.4, 2.0)) * 0.85 + 0.15 * smoothstep(19.5, 21.0, hh) * (1.0 - smoothstep(27.0, 28.5, hh))
	var dark := 1.0 - smoothstep(-15.0, -9.0, Astronomy.elevation_deg(get_sun_direction()))
	aurora_intensity = clampf(_aurora_tonight * env * dark, 0.0, 1.0)


# ============================================================================================ groups & globals
func _refresh_groups() -> void:
	_group_refresh = 0.5
	var tree := get_tree()
	if tree == null:
		return
	_heat_nodes.assign(tree.get_nodes_in_group(&"heat_source"))
	_shelter_nodes.assign(tree.get_nodes_in_group(&"shelter"))


## Force the heat/shelter caches to refresh now (tests, or after spawning a fire).
func refresh_sources() -> void:
	_refresh_groups()


func _push_globals() -> void:
	if not _globals_ok:
		return
	var ref := Vector3(0.0, REFERENCE_WIND_ALT, 0.0)
	if Game and Game.player and is_instance_valid(Game.player):
		ref = Game.player.global_position
	else:
		var cam := get_viewport().get_camera_3d() if get_viewport() else null
		if cam:
			ref = cam.global_position
	var w := get_wind_at(ref).length() if ref.y > 0.0 else wind_speed
	RenderingServer.global_shader_parameter_set(&"wind_direction", wind_direction)
	RenderingServer.global_shader_parameter_set(&"wind_strength", w / 12.0)
	RenderingServer.global_shader_parameter_set(&"time_of_day", hours)
	RenderingServer.global_shader_parameter_set(&"snow_cover", snow_cover)
	RenderingServer.global_shader_parameter_set(&"sun_direction", get_sun_direction())
	RenderingServer.global_shader_parameter_set(&"wetness", wetness)
	if _sky == null or not is_instance_valid(_sky):
		_sky = null
		RenderingServer.global_shader_parameter_set(&"fog_color", _fallback_fog_color())
	# else: the Sky pushes fog_color matched to its horizon haze.


func _fallback_fog_color() -> Color:
	var d := get_daylight()
	var day_c := Color(0.62, 0.70, 0.80).lerp(Color(0.72, 0.74, 0.77), cloud_cover)
	return Color(0.02, 0.025, 0.035).lerp(day_c, d)


# ============================================================================================ save/load
func save_state() -> Dictionary:
	var p := {}
	for k in params:
		p[String(k)] = params[k]
	var tp := {}
	for k in _to_params:
		tp[String(k)] = _to_params[k]
	var fp := {}
	for k in _from_params:
		fp[String(k)] = _from_params[k]
	return {
		"day": day, "hours": hours, "day_length_minutes": day_length_minutes,
		"weather": String(weather), "weather_minutes_left": weather_minutes_left,
		"blend": _blend, "blend_seconds": _blend_seconds, "params": p, "from": fp, "to": tp,
		"weather_locked": weather_locked, "locked": locked,
		"snow_cover": snow_cover, "wetness": wetness, "wind_from_deg": wind_from_deg,
		"wind_time": _wind_time, "aurora_tonight": _aurora_tonight, "aurora_forced": aurora_forced,
		"rng_state": str(_rng.state),
	}


func load_state(d: Dictionary) -> void:
	if d.is_empty():
		return
	day = int(d.get("day", 1))
	hours = fposmod(float(d.get("hours", 12.0)), 24.0)
	day_length_minutes = float(d.get("day_length_minutes", day_length_minutes))
	var w := StringName(str(d.get("weather", "clear")))
	if not WeatherTable.is_valid(w):
		w = &"clear"
	_set_weather_immediate(w)
	weather_minutes_left = float(d.get("weather_minutes_left", 60.0))
	var p: Dictionary = d.get("params", {})
	for k in p:
		params[StringName(k)] = float(p[k])
	var fp: Dictionary = d.get("from", {})
	for k in fp:
		_from_params[StringName(k)] = float(fp[k])
	var tp: Dictionary = d.get("to", {})
	for k in tp:
		_to_params[StringName(k)] = float(tp[k])
	_blend = float(d.get("blend", 1.0))
	_blend_seconds = float(d.get("blend_seconds", 0.0))
	weather_locked = bool(d.get("weather_locked", false))
	locked = bool(d.get("locked", false))
	snow_cover = float(d.get("snow_cover", snow_cover))
	wetness = float(d.get("wetness", wetness))
	wind_from_deg = float(d.get("wind_from_deg", wind_from_deg))
	_wind_time = float(d.get("wind_time", 0.0))
	_aurora_tonight = float(d.get("aurora_tonight", 0.0))
	aurora_forced = float(d.get("aurora_forced", -1.0))
	if d.has("rng_state"):
		_rng.state = int(str(d["rng_state"]))
	_cache_key = Vector2(-1.0, -1.0)
	_apply_params()
	_update_wind(0.0)
	_update_aurora()

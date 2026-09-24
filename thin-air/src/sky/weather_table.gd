class_name WeatherTable
## Static weather data for Climate: per-state target parameters, durations and the Markov transition
## weights (with time-of-day biases). Pure data + pure functions so it can be unit-tested.

const STATES: Array[StringName] = [&"clear", &"cloudy", &"overcast", &"snow", &"blizzard", &"fog"]

## Parameter keys blended during transitions (all floats).
##  cloud_cover   0..1 sky fraction covered by the main cloud deck
##  cloud_density 0..1 optical thickness of that deck (dark bases when high)
##  cloud_base    m ASL of the deck base (always kept above the player by the sky)
##  cirrus        0..1 high ice-cloud veil (also drives halos / sundogs when cold)
##  overcast      0..1 flat, featureless grey stratus look
##  precipitation 0..1 snowfall rate (0.55 = moderate snow, 1 = blizzard)
##  fog           0..1 general murk / whiteout factor (→ Climate.fog_density)
##  valley_fog    0..1 low radiation/valley fog bank intensity
##  haze          0..1 humid haze in the lower atmosphere
##  wind          m/s mean wind at the 2,000 m reference
##  gust          0..1 gustiness
##  temp_day      °C offset applied around the afternoon maximum
##  temp_night    °C offset applied around the dawn minimum
##  veer          deg the prevailing SW wind veers (clockwise) in this weather
const PARAMS := {
	&"clear": {
		&"cloud_cover": 0.10, &"cloud_density": 0.35, &"cloud_base": 4300.0, &"cirrus": 0.30, &"overcast": 0.0,
		&"precipitation": 0.0, &"fog": 0.0, &"valley_fog": 0.0, &"haze": 0.0,
		&"wind": 3.2, &"gust": 0.35, &"temp_day": 1.0, &"temp_night": -3.0, &"veer": 10.0,
	},
	&"cloudy": {
		&"cloud_cover": 0.50, &"cloud_density": 0.60, &"cloud_base": 3950.0, &"cirrus": 0.35, &"overcast": 0.0,
		&"precipitation": 0.0, &"fog": 0.03, &"valley_fog": 0.0, &"haze": 0.12,
		&"wind": 5.0, &"gust": 0.45, &"temp_day": 0.0, &"temp_night": 0.0, &"veer": 0.0,
	},
	&"overcast": {
		&"cloud_cover": 0.97, &"cloud_density": 0.85, &"cloud_base": 3650.0, &"cirrus": 0.0, &"overcast": 0.88,
		&"precipitation": 0.0, &"fog": 0.10, &"valley_fog": 0.0, &"haze": 0.30,
		&"wind": 6.0, &"gust": 0.40, &"temp_day": -1.5, &"temp_night": 2.0, &"veer": -10.0,
	},
	&"snow": {
		&"cloud_cover": 1.0, &"cloud_density": 0.95, &"cloud_base": 3350.0, &"cirrus": 0.0, &"overcast": 1.0,
		&"precipitation": 0.55, &"fog": 0.35, &"valley_fog": 0.0, &"haze": 0.50,
		&"wind": 6.5, &"gust": 0.45, &"temp_day": -2.0, &"temp_night": 1.5, &"veer": 0.0,
	},
	&"blizzard": {
		&"cloud_cover": 1.0, &"cloud_density": 1.0, &"cloud_base": 3050.0, &"cirrus": 0.0, &"overcast": 1.0,
		&"precipitation": 1.0, &"fog": 0.95, &"valley_fog": 0.0, &"haze": 0.85,
		&"wind": 16.0, &"gust": 0.55, &"temp_day": -6.0, &"temp_night": -4.0, &"veer": 35.0,
	},
	&"fog": {
		&"cloud_cover": 0.18, &"cloud_density": 0.40, &"cloud_base": 4100.0, &"cirrus": 0.20, &"overcast": 0.0,
		&"precipitation": 0.0, &"fog": 0.25, &"valley_fog": 1.0, &"haze": 0.55,
		&"wind": 1.2, &"gust": 0.20, &"temp_day": -2.0, &"temp_night": 0.5, &"veer": 0.0,
	},
}

## Duration ranges in game minutes.
const DURATION := {
	&"clear": Vector2(60.0, 180.0),
	&"cloudy": Vector2(45.0, 150.0),
	&"overcast": Vector2(45.0, 150.0),
	&"snow": Vector2(40.0, 140.0),
	&"blizzard": Vector2(30.0, 90.0),
	&"fog": Vector2(30.0, 120.0),
}

## Transition time (game minutes) when the Markov chain moves on – fronts roll in slowly, fog lifts slowly.
const TRANSITION_MINUTES := {
	&"clear": 35.0, &"cloudy": 30.0, &"overcast": 35.0, &"snow": 25.0, &"blizzard": 18.0, &"fog": 30.0,
}

## Base transition weights: from -> {to: weight}. Staying put re-rolls a new duration.
const TRANSITIONS := {
	&"clear": {&"clear": 0.22, &"cloudy": 0.55, &"overcast": 0.13, &"fog": 0.10},
	&"cloudy": {&"cloudy": 0.10, &"clear": 0.33, &"overcast": 0.40, &"snow": 0.10, &"fog": 0.07},
	&"overcast": {&"overcast": 0.08, &"cloudy": 0.30, &"snow": 0.45, &"blizzard": 0.08, &"fog": 0.09},
	&"snow": {&"snow": 0.15, &"overcast": 0.40, &"blizzard": 0.22, &"cloudy": 0.23},
	&"blizzard": {&"blizzard": 0.10, &"snow": 0.60, &"overcast": 0.30},
	&"fog": {&"fog": 0.05, &"clear": 0.45, &"cloudy": 0.35, &"overcast": 0.15},
}


static func params_for(w: StringName) -> Dictionary:
	return PARAMS.get(w, PARAMS[&"cloudy"])


static func is_valid(w: StringName) -> bool:
	return PARAMS.has(w)


## Time-of-day multiplier for moving INTO state `to` at clock hour `h`.
## Radiation/valley fog forms in the calm hours before dawn and burns off by late morning.
static func time_bias(to: StringName, h: float) -> float:
	match to:
		&"fog":
			if h >= 3.0 and h < 9.0:
				return 4.0
			if h >= 11.0 and h < 18.0:
				return 0.0
			return 0.8
		&"clear":
			# Fog tends to burn off into clear skies mid-morning.
			if h >= 9.0 and h < 13.0:
				return 1.4
			return 1.0
		&"blizzard":
			# Storms are marginally likelier in the evening/night (frontal passages, no solar mixing).
			if h >= 18.0 or h < 4.0:
				return 1.25
			return 1.0
	return 1.0


## Weighted transition table from `from` at hour `h` (weights not normalised).
static func weights(from: StringName, h: float) -> Dictionary:
	var base: Dictionary = TRANSITIONS.get(from, TRANSITIONS[&"cloudy"])
	var out := {}
	for k in base:
		out[k] = float(base[k]) * time_bias(k, h)
	# Fog that has sat in the valley past late morning lifts.
	if from == &"fog" and h >= 10.0 and h < 18.0:
		out[&"fog"] = 0.0
	return out


static func pick_next(from: StringName, h: float, rng: RandomNumberGenerator) -> StringName:
	var w := weights(from, h)
	var total := 0.0
	for k in w:
		total += float(w[k])
	if total <= 0.0:
		return &"cloudy"
	var r := rng.randf() * total
	for k in w:
		r -= float(w[k])
		if r <= 0.0:
			return k
	return from


static func roll_duration(w: StringName, rng: RandomNumberGenerator) -> float:
	var d: Vector2 = DURATION.get(w, Vector2(60.0, 120.0))
	# Triangular-ish: average of two uniforms keeps extremes rarer.
	return lerpf(d.x, d.y, 0.5 * (rng.randf() + rng.randf()))


static func lerp_params(a: Dictionary, b: Dictionary, t: float, out: Dictionary) -> void:
	for k in b:
		out[k] = lerpf(float(a.get(k, b[k])), float(b[k]), t)

extends Node
## STUB — owned by the Sky/Climate workstream. Minimal clock + constant weather.
## Full API: CONTRACT.md §3 "Climate".

var day := 1
var hours := 17.3
var day_length_minutes := 40.0
var time_scale := 1.0
var weather: StringName = &"cloudy"
var cloud_cover := 0.5
var precipitation := 0.0
var fog_density := 0.1
var wind_speed := 4.0
var wind_direction := Vector3(1, 0, 0)
var locked := false


func _process(delta: float) -> void:
	if locked or not Game.is_playing():
		return
	var prev := int(hours)
	hours += delta * time_scale * 24.0 / (day_length_minutes * 60.0)
	if hours >= 24.0:
		hours -= 24.0
		day += 1
		Events.day_started.emit(day)
	if int(hours) != prev:
		Events.hour_passed.emit(int(hours))


func get_sun_direction() -> Vector3:
	var a := (hours - 6.0) / 12.0 * PI
	return Vector3(cos(a), sin(a), -0.35).normalized()


func get_moon_direction() -> Vector3:
	return -get_sun_direction()


func get_daylight() -> float:
	return clampf(get_sun_direction().y * 4.0 + 0.3, 0.0, 1.0)


func get_air_temperature(pos: Vector3) -> float:
	return 4.0 - 6.5 * (pos.y - 1300.0) / 1000.0


func get_wind_at(_pos: Vector3) -> Vector3:
	return wind_direction * wind_speed


func get_heat_at(_pos: Vector3) -> float:
	return 0.0


func get_shelter_at(_pos: Vector3) -> float:
	return 0.0


func get_felt_temperature(pos: Vector3, insulation: float, wet: bool) -> float:
	return get_air_temperature(pos) + insulation - (6.0 if wet else 0.0)


func set_weather(w: StringName, _transition_s := 60.0) -> void:
	weather = w
	Events.weather_changed.emit(w)


func advance_time(hours_to_add: float) -> void:
	hours = fmod(hours + hours_to_add, 24.0)


func get_time_string() -> String:
	return "%02d:%02d" % [int(hours), int(fmod(hours, 1.0) * 60.0)]


func save_state() -> Dictionary:
	return {"day": day, "hours": hours, "weather": String(weather)}


func load_state(d: Dictionary) -> void:
	day = int(d.get("day", 1)); hours = float(d.get("hours", 12.0)); weather = StringName(d.get("weather", "clear"))

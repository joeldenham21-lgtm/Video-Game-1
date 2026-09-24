extends TestCase
## Climate / astronomy tests: sun path, moon, temperature, wind chill, heat, shelter, felt temperature,
## weather transitions & blending, save/load.
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_climate.gd


func _near(a: float, b: float, tol: float) -> bool:
	return absf(a - b) <= tol


func run() -> void:
	var saved := Climate.save_state()
	Climate.locked = true
	_test_sun_path()
	_test_moon_and_stars()
	_test_temperature()
	_test_wind()
	_test_wind_chill()
	await _test_heat_and_shelter()
	_test_felt()
	_test_weather()
	_test_save_load()
	_test_misc()
	await _test_sky_lighting()
	Climate.load_state(saved)
	Climate.locked = false


func _test_sun_path() -> void:
	var rise := Astronomy.sunrise_hour(1)
	var set_h := Astronomy.sunset_hour(1)
	print("  sunrise %.3f  sunset %.3f" % [rise, set_h])
	check(_near(rise, 7.0 + 50.0 / 60.0, 6.0 / 60.0), "sunrise ≈ 07:50 (got %02d:%02d)" % [int(rise), int(fmod(rise, 1.0) * 60.0)])
	check(_near(set_h, 17.0 + 20.0 / 60.0, 6.0 / 60.0), "sunset ≈ 17:20 (got %02d:%02d)" % [int(set_h), int(fmod(set_h, 1.0) * 60.0)])
	# Noon: sun due south, low (≈21° at 56° N on 29 Oct; see Astronomy header).
	var noon := Astronomy.sun_direction(1, Astronomy.SOLAR_NOON_CLOCK)
	var el := Astronomy.elevation_deg(noon)
	var az := Astronomy.azimuth_deg(noon)
	print("  noon elevation %.2f azimuth %.2f" % [el, az])
	check(el > 18.0 and el < 28.0, "low noon sun (%.1f°)" % el)
	check(_near(az, 180.0, 1.5), "noon sun due south (%.1f°)" % az)
	# Sunrise in the ESE, sunset in the WSW (late autumn).
	var az_rise := Astronomy.azimuth_deg(Astronomy.sun_direction(1, rise))
	var az_set := Astronomy.azimuth_deg(Astronomy.sun_direction(1, set_h))
	check(az_rise > 105.0 and az_rise < 125.0, "sunrise azimuth ESE (%.1f°)" % az_rise)
	check(az_set > 235.0 and az_set < 255.0, "sunset azimuth WSW (%.1f°)" % az_set)
	# Midnight: well below the horizon (≈ −47°), nights are long.
	var mid_el := Astronomy.elevation_deg(Astronomy.sun_direction(1, 0.6))
	check(mid_el < -40.0, "midnight sun far below horizon (%.1f°)" % mid_el)
	# Days shorten through November.
	var len1 := Astronomy.sunset_hour(1) - Astronomy.sunrise_hour(1)
	var len15 := Astronomy.sunset_hour(15) - Astronomy.sunrise_hour(15)
	check(len15 < len1 - 0.4, "days shorten (%.2f h → %.2f h)" % [len1, len15])
	# Climate API matches Astronomy and reports daylight correctly.
	Climate.day = 1
	Climate.hours = 12.5
	check(Climate.get_sun_direction().is_equal_approx(Astronomy.sun_direction(1, 12.5)), "Climate sun direction")
	check(Climate.get_daylight() > 0.99, "daylight at noon")
	Climate.hours = 1.0
	check(Climate.get_daylight() < 0.01 and Climate.is_night(), "night at 01:00")
	Climate.hours = 17.3
	var dusk := Climate.get_daylight()
	check(dusk > 0.2 and dusk < 0.8, "dusk light at prologue start 17:18 (%.2f)" % dusk)
	check(Climate.get_time_string() == "17:18", "time string (%s)" % Climate.get_time_string())


func _test_moon_and_stars() -> void:
	check(_near(Astronomy.moon_illumination(0.5), 1.0, 1e-4), "full moon fully lit")
	check(_near(Astronomy.moon_illumination(0.0), 0.0, 1e-4), "new moon dark")
	check(_near(Astronomy.moon_brightness(0.5), 1.0, 1e-4), "full moon brightness 1")
	var q := Astronomy.moon_brightness(0.25)
	check(q > 0.05 and q < 0.15, "quarter moon ≈ 1/10 of full (%.3f)" % q)
	# Phase cycles over a synodic month.
	var p0 := Astronomy.moon_phase(1, 0.0)
	var p1 := Astronomy.moon_phase(31, 0.0)
	check(_near(fposmod(p1 - p0, 1.0), fposmod(30.0 / Astronomy.SYNODIC_MONTH, 1.0), 1e-4), "phase advances 1/29.53 per day")
	# Full moon (~day 7) is opposite the sun: rises near sunset, high near midnight.
	var full_day := 1
	for d in range(1, 30):
		if absf(Astronomy.moon_phase(d, 0.0) - 0.5) < absf(Astronomy.moon_phase(full_day, 0.0) - 0.5):
			full_day = d
	var md := Astronomy.moon_direction(full_day, 0.3)
	var sd := Astronomy.sun_direction(full_day, 0.3)
	check(md.dot(sd) < -0.95, "full moon opposite the sun (day %d)" % full_day)
	check(Astronomy.elevation_deg(md) > 35.0, "late-October full moon rides high at midnight (%.1f°)" % Astronomy.elevation_deg(md))
	# Polaris stays put at the latitude altitude, due north.
	for h in [0.0, 6.0, 18.0]:
		var pol_eq := Vector3(cos(deg_to_rad(89.26)) * cos(deg_to_rad(37.95)), cos(deg_to_rad(89.26)) * sin(deg_to_rad(37.95)), sin(deg_to_rad(89.26)))
		var pol := Astronomy.equatorial_to_world(pol_eq, Astronomy.local_sidereal_time(1, h))
		check(_near(Astronomy.elevation_deg(pol), 56.0, 1.0) and (Astronomy.azimuth_deg(pol) < 2.0 or Astronomy.azimuth_deg(pol) > 358.0),
			"Polaris at 56° due north at %02d:00" % int(h))
	# Sidereal basis is orthonormal.
	var b := Astronomy.equatorial_to_world_basis(1.234)
	check(b.is_equal_approx(b.orthonormalized()) and _near(b.determinant(), 1.0, 1e-4), "celestial basis orthonormal")


func _test_temperature() -> void:
	Climate.set_weather(&"cloudy", 0.0)
	Climate.day = 1
	var valley := Vector3(0.0, 1300.0, 0.0)
	Climate.hours = 14.5
	var t_day := Climate.get_air_temperature(valley)
	Climate.hours = 8.0
	var t_night := Climate.get_air_temperature(valley)
	print("  valley cloudy: day %.2f  dawn %.2f" % [t_day, t_night])
	check(_near(t_day, 3.0, 1.0), "valley afternoon ≈ +3 °C (%.1f)" % t_day)
	check(_near(t_night, -7.0, 1.0), "valley dawn ≈ −7 °C (%.1f)" % t_night)
	Climate.hours = 12.0
	var t_1300 := Climate.get_air_temperature(Vector3(0, 1300, 0))
	var t_2300 := Climate.get_air_temperature(Vector3(0, 2300, 0))
	var t_3452 := Climate.get_air_temperature(Vector3(0, 3452, 0))
	check(_near(t_1300 - t_2300, 6.5, 0.05), "lapse rate 6.5 °C/km (%.2f)" % (t_1300 - t_2300))
	check(t_3452 < t_1300 - 13.0, "summit much colder (%.1f vs %.1f)" % [t_3452, t_1300])
	# Weather offsets: clear nights colder than cloudy nights; overcast nights milder; blizzard colder.
	Climate.hours = 7.5
	var cloudy_night := Climate.get_air_temperature(Vector3(0, 1800, 0))
	Climate.set_weather(&"clear", 0.0)
	var clear_night := Climate.get_air_temperature(Vector3(0, 1800, 0))
	Climate.set_weather(&"overcast", 0.0)
	var oc_night := Climate.get_air_temperature(Vector3(0, 1800, 0))
	Climate.set_weather(&"blizzard", 0.0)
	Climate.hours = 14.0
	var bliz_day := Climate.get_air_temperature(Vector3(0, 1800, 0))
	Climate.set_weather(&"cloudy", 0.0)
	var cloudy_day := Climate.get_air_temperature(Vector3(0, 1800, 0))
	check(clear_night < cloudy_night - 2.0, "clear nights colder (%.1f < %.1f)" % [clear_night, cloudy_night])
	check(oc_night > cloudy_night + 1.0, "overcast nights milder (%.1f)" % oc_night)
	check(bliz_day < cloudy_day - 4.0, "blizzard colder (%.1f vs %.1f)" % [bliz_day, cloudy_day])
	# Clear calm nights pool cold air on the valley floor (inversion).
	Climate.set_weather(&"clear", 0.0)
	Climate.hours = 6.0
	var floor_t := Climate.get_air_temperature(Vector3(0, 1300, 0))
	var slope_t := Climate.get_air_temperature(Vector3(0, 1650, 0))
	var expected_lapse := 6.5 * 0.35
	check(floor_t - slope_t < expected_lapse, "cold-air pooling weakens the lapse at night (Δ %.2f)" % (floor_t - slope_t))
	# Diurnal curve continuity.
	var jump := 0.0
	for i in 2400:
		var h := float(i) / 100.0
		jump = maxf(jump, absf(Climate.diurnal_curve(h + 0.01) - Climate.diurnal_curve(h)))
	check(jump < 0.02, "diurnal curve continuous (max step %.4f)" % jump)


func _test_wind() -> void:
	Climate.set_weather(&"cloudy", 0.0)
	Climate._update_wind(0.016)
	var d := Climate.wind_direction
	check(_near(d.length(), 1.0, 1e-3) and absf(d.y) < 1e-5, "wind direction unit & horizontal")
	# Prevailing SW: blows toward the north-east quadrant.
	check(d.x > 0.0 and d.z < 0.0, "south-westerly blows toward NE (%s, from %.0f°)" % [d, Climate.wind_from_deg])
	var low := Climate.get_wind_at(Vector3(0, 1300, 0)).length()
	var ref := Climate.get_wind_at(Vector3(0, 2000, 0)).length()
	var high := Climate.get_wind_at(Vector3(0, 3400, 0)).length()
	check(low < ref and ref < high, "wind grows with altitude (%.1f < %.1f < %.1f)" % [low, ref, high])
	check(_near(Climate.altitude_wind_factor(2000.0), 1.0, 1e-3), "reference altitude factor 1")
	Climate.set_weather(&"blizzard", 0.0)
	Climate._update_wind(0.016)
	var storm := Climate.get_wind_at(Vector3(0, 3000, 0)).length()
	check(storm > 12.0, "blizzard gales on the col (%.1f m/s)" % storm)
	# Gusts vary over time.
	var mn := 1e9
	var mx := 0.0
	for i in 200:
		Climate._update_wind(0.25)
		mn = minf(mn, Climate.wind_speed)
		mx = maxf(mx, Climate.wind_speed)
	check(mx - mn > 2.0, "gusty (%.1f .. %.1f m/s)" % [mn, mx])
	Climate.set_weather(&"cloudy", 0.0)


func _test_wind_chill() -> void:
	# Environment Canada reference values.
	check(_near(Climate.wind_chill(-10.0, 20.0), -17.9, 0.15), "WCI(-10 °C, 20 km/h) = -17.9 (%.2f)" % Climate.wind_chill(-10.0, 20.0))
	check(_near(Climate.wind_chill(-20.0, 30.0), -32.6, 0.15), "WCI(-20 °C, 30 km/h) = -32.6 (%.2f)" % Climate.wind_chill(-20.0, 30.0))
	check(_near(Climate.wind_chill(0.0, 10.0), -3.3, 0.15), "WCI(0 °C, 10 km/h) = -3.3 (%.2f)" % Climate.wind_chill(0.0, 10.0))
	check(_near(Climate.wind_chill(-5.0, 2.0), -5.0, 1e-4), "no chill in calm air")
	check(_near(Climate.wind_chill(15.0, 40.0), 15.0, 1e-4), "no chill above 10 °C")


func _test_heat_and_shelter() -> void:
	check(_near(Climate.heat_falloff(0.0, 4.0), 1.0, 1e-5), "heat full at source")
	check(_near(Climate.heat_falloff(4.0, 4.0), 0.0, 1e-5), "heat zero at radius")
	var prev := 2.0
	var mono := true
	for i in 41:
		var f := Climate.heat_falloff(float(i) * 0.1, 4.0)
		mono = mono and f <= prev + 1e-6
		prev = f
	check(mono, "heat falloff monotonic")
	# A campfire in the heat_source group.
	var fire := Node3D.new()
	fire.set_script(_fire_script())
	fire.position = Vector3(10, 1450, 10)
	add_child(fire)
	fire.add_to_group(&"heat_source")
	# A 4x3x4 m cabin shelter.
	var area := Area3D.new()
	area.set_script(_shelter_script())
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(4, 3, 4)
	cs.shape = box
	area.add_child(cs)
	area.position = Vector3(-20, 1451.5, 0)
	add_child(area)
	area.add_to_group(&"shelter")
	await get_tree().process_frame
	Climate.refresh_sources()
	var h0 := Climate.get_heat_at(Vector3(10, 1450, 10))
	var h1 := Climate.get_heat_at(Vector3(11.5, 1450, 10))
	var h2 := Climate.get_heat_at(Vector3(20, 1450, 10))
	check(_near(h0, 25.0 * tanh(25.0 / Climate.HEAT_CAP_C) * Climate.HEAT_CAP_C / 25.0, 0.2) and h0 > 15.0, "fire heat at the fire (%.1f)" % h0)
	check(h1 > 0.0 and h1 < h0, "fire heat falls off (%.1f)" % h1)
	check(h2 == 0.0, "no heat beyond radius")
	fire.set("active", false)
	check(Climate.get_heat_at(Vector3(10, 1450, 10)) == 0.0, "extinguished fire gives no heat")
	fire.set("active", true)
	var s_in := Climate.get_shelter_at(Vector3(-20, 1451.5, 0))
	var s_edge := Climate.get_shelter_at(Vector3(-18.1, 1451.5, 0))
	var s_out := Climate.get_shelter_at(Vector3(-10, 1451.5, 0))
	check(_near(s_in, 0.9, 1e-3), "inside shelter = shelter_factor (%.2f)" % s_in)
	check(s_edge > 0.0 and s_edge < s_in, "soft shelter edge (%.2f)" % s_edge)
	check(s_out == 0.0, "outside shelter 0")
	var w_out := Climate.get_wind_at(Vector3(-10, 1451.5, 0)).length()
	var w_in := Climate.get_wind_at(Vector3(-20, 1451.5, 0)).length()
	check(w_in < w_out * 0.3, "shelter blocks wind (%.2f vs %.2f)" % [w_in, w_out])
	_fire = fire
	_area = area


var _fire: Node3D
var _area: Area3D


func _test_felt() -> void:
	Climate.set_weather(&"blizzard", 0.0)
	Climate.hours = 22.0
	var p_out := Vector3(-10, 1451.5, 0)
	var p_in := Vector3(-20, 1451.5, 0)
	var air := Climate.get_air_temperature(p_out)
	var felt_bare := Climate.get_felt_temperature(p_out, 0.0, false, 0.0)
	var felt_windproof := Climate.get_felt_temperature(p_out, 0.0, false, 1.0)
	var felt_dressed := Climate.get_felt_temperature(p_out, 12.0, false, 0.0)
	var felt_wet := Climate.get_felt_temperature(p_out, 12.0, true, 0.0)
	var felt_in := Climate.get_felt_temperature(p_in, 0.0, false, 0.0)
	print("  blizzard night: air %.1f bare %.1f windproof %.1f dressed %.1f wet %.1f shelter %.1f" % [air, felt_bare, felt_windproof, felt_dressed, felt_wet, felt_in])
	check(felt_bare < air - 3.0, "wind chill bites in a blizzard")
	check(_near(felt_windproof, air, 0.01), "fully windproof removes wind chill")
	check(_near(felt_dressed - felt_bare, 12.0, 0.01), "insulation adds warmth")
	check(felt_wet < felt_dressed - 8.0, "being wet is dangerous (%.1f vs %.1f)" % [felt_wet, felt_dressed])
	check(felt_in > felt_bare + 5.0, "shelter helps (%.1f vs %.1f)" % [felt_in, felt_bare])
	var near_fire := Climate.get_felt_temperature(Vector3(11, 1450, 10), 0.0, false, 0.0)
	var no_fire := Climate.get_felt_temperature(Vector3(40, 1450, 10), 0.0, false, 0.0)
	check(near_fire > no_fire + 10.0, "fire warms (%.1f vs %.1f)" % [near_fire, no_fire])
	_fire.queue_free()
	_area.queue_free()
	Climate.set_weather(&"cloudy", 0.0)


func _test_weather() -> void:
	# Blending: parameters move smoothly from cloudy to snow over the transition.
	Climate.set_weather(&"cloudy", 0.0)
	var got_signal := [false]
	var cb := func(w: StringName) -> void: got_signal[0] = (w == &"snow")
	Events.weather_changed.connect(cb)
	Climate.set_weather(&"snow", 10.0)
	check(got_signal[0], "weather_changed emitted")
	Events.weather_changed.disconnect(cb)
	check(Climate.weather == &"snow", "target weather set")
	var start_cover := Climate.cloud_cover
	var last := start_cover
	var smooth := true
	for i in 10:
		Climate._update_blend(1.0)
		smooth = smooth and Climate.cloud_cover >= last - 1e-6 and Climate.cloud_cover - last < 0.3
		last = Climate.cloud_cover
	check(_near(start_cover, 0.5, 0.02), "blend starts at cloudy cover (%.2f)" % start_cover)
	check(smooth, "cloud cover rises smoothly")
	check(_near(Climate.cloud_cover, 1.0, 1e-3) and _near(Climate.precipitation, 0.55, 1e-3), "blend completes to snow")
	Climate.set_weather(&"cloudy", 20.0)
	Climate._update_blend(10.0)
	var mid := Climate.precipitation
	check(mid > 0.05 and mid < 0.5, "halfway through the blend (%.2f)" % mid)
	Climate.set_weather(&"cloudy", 0.0)
	# Markov chain: valid states, realistic durations, fog biased to dawn, no clear→blizzard jumps.
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var fog_dawn := 0
	var fog_noon := 0
	for i in 2000:
		if WeatherTable.pick_next(&"clear", 5.5, rng) == &"fog":
			fog_dawn += 1
		if WeatherTable.pick_next(&"clear", 14.0, rng) == &"fog":
			fog_noon += 1
	check(fog_dawn > 400 and fog_noon == 0, "valley fog forms at dawn, not mid-afternoon (%d vs %d)" % [fog_dawn, fog_noon])
	var bad := false
	for i in 500:
		if WeatherTable.pick_next(&"clear", rng.randf() * 24.0, rng) == &"blizzard":
			bad = true
	check(not bad, "no clear → blizzard jumps")
	var dur_ok := true
	for w in WeatherTable.STATES:
		for i in 50:
			var dd := WeatherTable.roll_duration(w, rng)
			dur_ok = dur_ok and dd >= 30.0 and dd <= 180.0
	check(dur_ok, "spell durations within 30–180 game-minutes")
	# Every state reachable over a long run.
	var seen := {}
	var cur: StringName = &"clear"
	for i in 3000:
		cur = WeatherTable.pick_next(cur, float(i % 24), rng)
		seen[cur] = true
	check(seen.size() == WeatherTable.STATES.size(), "all weather states reachable (%d)" % seen.size())
	# Lock semantics: a locked climate never changes by itself.
	Climate.weather_locked = true
	Climate.weather_minutes_left = -1.0
	var before := Climate.weather
	Climate.locked = false
	var was_state: int = Game.state
	Game.state = Game.State.PLAYING
	Climate._process(0.1)
	check(Climate.weather == before, "weather_locked holds the weather")
	Game.state = was_state
	Climate.locked = true
	Climate.weather_locked = false
	# Snowfall accumulates, sunshine melts at low altitude.
	Climate.set_weather(&"snow", 0.0)
	Climate.snow_cover = 0.2
	Climate.hours = 22.0
	Climate._update_surface(1.0)
	check(Climate.snow_cover > 0.33, "snow accumulates (%.2f)" % Climate.snow_cover)
	Climate.set_weather(&"clear", 0.0)
	Climate.snow_cover = 0.5
	Climate.hours = 13.5
	Climate._update_surface(2.0)
	check(Climate.snow_cover < 0.5, "valley sun melts the dusting (%.2f)" % Climate.snow_cover)


func _test_save_load() -> void:
	Climate.day = 4
	Climate.hours = 5.75
	Climate.set_weather(&"fog", 30.0)
	Climate._update_blend(7.0)
	Climate.snow_cover = 0.37
	Climate.wetness = 0.22
	var cover := Climate.cloud_cover
	var st := Climate.save_state()
	var json := JSON.stringify(st)
	Climate.day = 9
	Climate.hours = 13.0
	Climate.set_weather(&"blizzard", 0.0)
	Climate.snow_cover = 0.0
	Climate.load_state(JSON.parse_string(json))
	check(Climate.day == 4 and _near(Climate.hours, 5.75, 1e-4), "save/load time")
	check(Climate.weather == &"fog", "save/load weather")
	check(_near(Climate.cloud_cover, cover, 1e-4), "save/load mid-blend parameters (%.3f vs %.3f)" % [Climate.cloud_cover, cover])
	check(_near(Climate.snow_cover, 0.37, 1e-4) and _near(Climate.wetness, 0.22, 1e-4), "save/load surface state")
	Climate._update_blend(100.0)
	check(_near(Climate.cloud_cover, float(WeatherTable.PARAMS[&"fog"][&"cloud_cover"]), 1e-3), "loaded blend completes")
	# RNG continues identically after load.
	var a := Climate.save_state()
	var n1 := WeatherTable.pick_next(&"cloudy", 12.0, Climate._rng)
	Climate.load_state(a)
	var n2 := WeatherTable.pick_next(&"cloudy", 12.0, Climate._rng)
	check(n1 == n2, "rng state restored")


func _test_misc() -> void:
	# advance_time crosses midnight and emits signals.
	Climate.day = 2
	Climate.hours = 22.5
	var hours_seen: Array[int] = []
	var days_seen: Array[int] = []
	var ch := func(h: int) -> void: hours_seen.append(h)
	var cd := func(d: int) -> void: days_seen.append(d)
	Events.hour_passed.connect(ch)
	Events.day_started.connect(cd)
	Climate.advance_time(4.0)
	Events.hour_passed.disconnect(ch)
	Events.day_started.disconnect(cd)
	check(Climate.day == 3 and _near(Climate.hours, 2.5, 1e-3), "advance_time over midnight (day %d, %.2f)" % [Climate.day, Climate.hours])
	check(hours_seen == [23, 0, 1, 2] and days_seen == [3], "hour_passed/day_started emitted (%s %s)" % [hours_seen, days_seen])
	check(Climate.get_visibility_at(Vector3(0, 1400, 0)) > 1000.0 or Climate.weather != &"clear", "visibility sane")
	Climate.set_weather(&"snow", 0.0)
	var vis_snow := Climate.get_visibility_at(Vector3(0, 2500, 0))
	check(vis_snow > 500.0 and vis_snow < 1400.0, "moderate snowfall visibility ≈ 900 m (%.0f)" % vis_snow)
	Climate.set_weather(&"blizzard", 0.0)
	check(Climate.get_visibility_at(Vector3(0, 2500, 0)) < 60.0, "blizzard visibility < 60 m (%.0f)" % Climate.get_visibility_at(Vector3(0, 2500, 0)))
	Climate.set_weather(&"clear", 0.0)
	Climate.hours = 12.0
	check(Climate.get_light_level() > 0.9, "bright at noon")
	Climate.hours = 1.0
	Climate.moon_phase_override = 0.0
	check(Climate.get_light_level() < 0.05, "dark on a moonless night")
	Climate.moon_phase_override = -1.0


## The Sky scene: sun colour temperature, moonlight switch, exposure adaptation, fog colour, Settings hooks.
func _test_sky_lighting() -> void:
	var ps: PackedScene = load("res://scenes/world/sky.tscn")
	check(ps != null, "sky.tscn loads")
	if ps == null:
		return
	var sky: Node = ps.instantiate()
	add_child(sky)
	await get_tree().process_frame
	var sun: DirectionalLight3D = sky.get_node("Sun")
	var env: Environment = (sky.get_node("WorldEnvironment") as WorldEnvironment).environment
	check(sun.is_in_group(&"sun") and sun.shadow_enabled, "Sun light in group 'sun' casting shadows")
	check(env.tonemap_mode == Environment.TONE_MAPPER_AGX and env.fog_enabled and env.sky != null, "AgX + fog + sky")
	Climate.day = 1
	Climate.set_weather(&"clear", 0.0)
	Climate.moon_phase_override = -1.0
	# Noon: near-neutral white sunlight, bright, exposure ≈ 1.
	Climate.hours = 12.5
	sky.snap()
	var c_noon := sun.light_color
	var e_noon := sun.light_energy
	var x_noon: float = sky.get_exposure()
	# Golden hour: warm, dimmer.
	Climate.hours = 16.9
	sky.snap()
	var c_gold := sun.light_color
	var e_gold := sun.light_energy
	print("  noon colour %s energy %.2f exp %.2f | golden %s energy %.2f exp %.2f" % [c_noon, e_noon, x_noon, c_gold, e_gold, sky.get_exposure()])
	check(absf(c_noon.r - c_noon.b) < 0.25 * c_noon.g, "neutral white noon sun (%s)" % c_noon)
	check(c_gold.r > c_gold.b * 1.6, "warm golden low sun (%s)" % c_gold)
	check(e_gold < e_noon * 0.7, "low sun dimmer")
	check(x_noon > 0.9 and x_noon < 1.5, "daylight exposure ≈ 1 (%.2f)" % x_noon)
	check(not sky.is_moonlight(), "sun is the light by day")
	# Full-moon night (day 7): the single directional light becomes cool, dim moonlight.
	Climate.day = 7
	Climate.hours = 23.5
	sky.snap()
	var c_moon := sun.light_color
	print("  moonlight %s energy %.4f exp %.2f visible %s" % [c_moon, sun.light_energy, sky.get_exposure(), sun.visible])
	check(sky.is_moonlight() and sun.visible, "moonlight at night under a full moon")
	check(sun.light_energy / sky.get_light_boost() < e_noon * 0.02 and sun.light_energy > 0.0, "moonlight far dimmer than sunlight")
	check(c_moon.b > c_moon.r, "moonlight reads cool")
	check(sky.get_eye_adaptation() > 4.0, "eyes adapt at night (%.2f)" % sky.get_eye_adaptation())
	check(sky.get_exposure() <= sky.EXPOSURE_MAX + 1e-4 and sky.get_light_boost() > 1.0, "camera exposure capped at night (%.2f), sky lights boosted (×%.2f)" % [sky.get_exposure(), sky.get_light_boost()])
	check(is_equal_approx(sky.get_exposure() * sky.get_light_boost(), sky.get_eye_adaptation()), "exposure × boost = eye adaptation")
	# New moon (day 22): no directional light at all – genuinely dark.
	Climate.day = 22
	Climate.hours = 23.5
	sky.snap()
	check(not sun.visible, "no light casting shadows on a moonless night")
	var fog_night: Color = sky.get_fog_color()
	Climate.day = 1
	Climate.hours = 12.5
	sky.snap()
	var fog_day: Color = sky.get_fog_color()
	check(fog_day.get_luminance() > fog_night.get_luminance() * 50.0, "fog colour follows the sky (day %s night %s)" % [fog_day, fog_night])
	# Blizzard: whiteout fog, sky flattened by the precipitation veil.
	Climate.set_weather(&"blizzard", 0.0)
	sky.snap()
	var u: Dictionary = sky.get_debug_uniforms()
	check(float(u.get(&"veil", 0.0)) > 0.6, "blizzard veils the sky (%.2f)" % float(u.get(&"veil", 0.0)))
	check(env.fog_density > 0.05, "blizzard whiteout fog density (%.3f/m)" % env.fog_density)
	check(env.fog_sky_affect > 0.6, "blizzard fog covers the sky")
	Climate.set_weather(&"clear", 0.0)
	sky.snap()
	check(env.fog_density < 0.0002, "clean-air fog on a clear day (%.6f/m)" % env.fog_density)
	# Weather FX: snowfall layers exist, the fog sea only shows with valley fog.
	var wfx: Node = sky.get_node_or_null("WeatherFX")
	check(wfx != null and wfx.get_node_or_null("Snow") is GPUParticles3D, "WeatherFX snowfall layer")
	check(wfx != null and wfx.get_node_or_null("ValleyFogSea") is MeshInstance3D, "WeatherFX valley fog sea")
	# Settings hooks.
	var prev := Settings.preset
	Settings.apply_preset(&"mobile_low")
	await get_tree().process_frame
	var budget := 0
	for c in wfx.get_children():
		if c is GPUParticles3D:
			budget += (c as GPUParticles3D).amount
	check(budget <= 3000, "mobile particle budget ≤ 3k (%d)" % budget)
	check(sky.sky.radiance_size == Sky.RADIANCE_SIZE_64 and sky.sun.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS, "mobile_low: small radiance map, 2 cascades")
	check(String(sky.sky_material.shader.resource_path).ends_with("sky_mobile.gdshader"), "mobile_low uses the cheap sky shader")
	check(not env.volumetric_fog_enabled and not env.ssao_enabled, "no volumetric fog / SSAO on mobile")
	Settings.apply_preset(&"ultra")
	await get_tree().process_frame
	if Settings.is_forward_plus():
		check(sky.sky.process_mode == Sky.PROCESS_MODE_REALTIME and sky.sun.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS, "ultra: realtime sky, 4 cascades")
	Settings.apply_preset(prev)
	sky.queue_free()
	await get_tree().process_frame


func _fire_script() -> GDScript:
	var s := GDScript.new()
	s.source_code = "extends Node3D\nvar heat_radius := 4.0\nvar heat_celsius := 25.0\nvar active := true\nfunc is_heat_active() -> bool:\n\treturn active\n"
	s.reload()
	return s


func _shelter_script() -> GDScript:
	var s := GDScript.new()
	s.source_code = "extends Area3D\nvar shelter_factor := 0.9\n"
	s.reload()
	return s

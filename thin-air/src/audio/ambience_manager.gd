extends Node
## Ambience manager (Audio workstream): blends stereo beds from the listener's context every frame and
## schedules sparse spatial ambient events (distant birds, owls, rockfall, creaks…).
##
## Inputs (all optional, stubs work): Climate.get_wind_at / weather / precipitation / get_daylight /
## get_shelter_at / get_air_temperature, TerrainData.get_masks (A = forest) / get_height (exposure) /
## get_biome / get_water_level / layout (rivers, lakes, POIs), the Audio reverb environment, voice ducking.

const SfxCatalog := preload("res://src/audio/sfx_catalog.gd")

const BEDS: Array[StringName] = [&"amb_wind_calm", &"amb_wind_breeze", &"amb_wind_strong", &"amb_wind_gale",
	&"amb_wind_alpine", &"amb_wind_spruce", &"amb_blizzard", &"amb_forest_day", &"amb_forest_night", &"amb_creek",
	&"amb_river", &"amb_lake_shore", &"amb_waterfall", &"amb_cave", &"amb_station_hum", &"amb_station_dead",
	&"amb_interior_wind"]

## Rates are events per second at full context weight. dist: spawn distance range (m); h: height above ground.
const EVENTS := {
	&"bird_chirp": {"rate": 1.0 / 9.0, "dist": Vector2(12, 70), "h": Vector2(3, 12)},
	&"amb_woodpecker": {"rate": 1.0 / 100.0, "dist": Vector2(40, 150), "h": Vector2(4, 10)},
	&"raven_caw": {"rate": 1.0 / 70.0, "dist": Vector2(60, 300), "h": Vector2(20, 80)},
	&"eagle_cry": {"rate": 1.0 / 150.0, "dist": Vector2(150, 600), "h": Vector2(100, 250)},
	&"amb_ptarmigan": {"rate": 1.0 / 120.0, "dist": Vector2(30, 120), "h": Vector2(0.5, 2)},
	&"amb_nutcracker": {"rate": 1.0 / 90.0, "dist": Vector2(40, 160), "h": Vector2(4, 12)},
	&"amb_owl": {"rate": 1.0 / 50.0, "dist": Vector2(60, 300), "h": Vector2(6, 15)},
	&"wolf_howl": {"rate": 1.0 / 240.0, "dist": Vector2(400, 1200), "h": Vector2(0, 5)},
	&"rockfall": {"rate": 1.0 / 140.0, "dist": Vector2(200, 900), "h": Vector2(20, 120)},
	&"serac_fall": {"rate": 1.0 / 260.0, "dist": Vector2(400, 1500), "h": Vector2(20, 150)},
	&"avalanche": {"rate": 1.0 / 700.0, "dist": Vector2(900, 2500), "h": Vector2(100, 400)},
	&"ice_crack": {"rate": 1.0 / 120.0, "dist": Vector2(50, 400), "h": Vector2(0, 2)},
	&"wood_creak": {"rate": 1.0 / 20.0, "dist": Vector2(8, 40), "h": Vector2(2, 10)},
	&"metal_creak": {"rate": 1.0 / 40.0, "dist": Vector2(3, 8), "h": Vector2(0, 3)},
	&"thunder": {"rate": 1.0 / 360.0, "dist": Vector2(2500, 7000), "h": Vector2(1500, 2500)},
}

var audio: Node = null                 # the Audio autoload
var enabled := true
var events_enabled := true
var menu_ambience := true
var duck := 1.0                        # set by Audio while a voice line plays
var station_powered: Variant = null    # null = auto (generator_loop playing or Game flag)

var listener := Vector3.ZERO
var has_listener := false
var ctx := {}                          # last computed context (debug/tests)

var _players: Dictionary = {}          # StringName -> AudioStreamPlayer
var _w: Dictionary = {}                # current linear gain
var _t: Dictionary = {}                # target linear gain
var _timer := 0.0
var _event_timer := 0.0
var _slow_timer := 0.0
var _exposure := 1.0
var _water := {"creek": INF, "river": INF, "lake": INF, "fall": INF, "creek_p": Vector3.ZERO,
	"river_p": Vector3.ZERO, "lake_p": Vector3.ZERO, "fall_p": Vector3.ZERO}
var _emitters: Dictionary = {}         # "creek"/"river"/"lake"/"fall" -> AudioStreamPlayer3D
var _speed := 1.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE
	for b in BEDS:
		_w[b] = 0.0
		_t[b] = 0.0


func _bed_player(id: StringName) -> AudioStreamPlayer:
	if _players.has(id):
		return _players[id]
	var e: SfxCatalog.Entry = audio.catalog.get_entry(id) if audio else null
	if e == null:
		return null
	var p := AudioStreamPlayer.new()
	p.name = String(id)
	p.bus = e.bus
	p.stream = audio.catalog.stream_at(e, 0)
	if p.stream == null:
		p.queue_free()
		return null
	add_child(p)
	_players[id] = p
	return p


func _emitter(key: String, id: StringName) -> AudioStreamPlayer3D:
	if _emitters.has(key):
		return _emitters[key]
	var e: SfxCatalog.Entry = audio.catalog.get_entry(id) if audio else null
	if e == null:
		return null
	var p := AudioStreamPlayer3D.new()
	p.name = "Water_" + key
	p.bus = e.bus
	p.stream = audio.catalog.stream_at(e, 0)
	p.unit_size = e.unit_size
	p.max_distance = e.max_distance
	p.attenuation_filter_cutoff_hz = 6000.0
	p.attenuation_filter_db = -12.0
	p.panning_strength = 0.9
	p.top_level = true
	add_child(p)
	_emitters[key] = p
	return p


# ------------------------------------------------------------------------------------------------ frame

func _process(delta: float) -> void:
	if not enabled or audio == null:
		return
	_timer -= delta
	if _timer <= 0.0:
		_timer = 0.25
		_update_listener()
		_compute_targets()
	_slow_timer -= delta
	var fast: float = clampf(delta * (2.5 if _speed > 1.0 else 0.8), 0.0, 1.0)
	for b in BEDS:
		var tgt: float = _t[b] * duck
		var cur: float = _w[b]
		if absf(cur - tgt) > 0.0005:
			cur = lerpf(cur, tgt, fast)
			_w[b] = cur
		var p: AudioStreamPlayer = _players.get(b)
		if cur > 0.002:
			if p == null:
				p = _bed_player(b)
			if p:
				var base: float = audio.catalog.entries[b].volume_db if audio.catalog.entries.has(b) else 0.0
				p.volume_db = base + linear_to_db(cur)
				if not p.playing:
					var len := p.stream.get_length() if p.stream else 0.0
					p.play(randf() * len * 0.9 if len > 1.0 else 0.0)
		elif p and p.playing and tgt <= 0.0:
			p.stop()
	if events_enabled and has_listener and Game.world != null:
		_event_timer -= delta
		if _event_timer <= 0.0:
			_event_timer = 0.5
			_spawn_events(0.5)


func _update_listener() -> void:
	has_listener = false
	var vp := get_viewport()
	if vp:
		var cam := vp.get_camera_3d()
		if cam and cam.is_inside_tree():
			listener = cam.global_position
			has_listener = true
			return
	if Game.player and is_instance_valid(Game.player):
		listener = Game.player.global_position + Vector3(0, 1.6, 0)
		has_listener = true


func _smooth(a: float, b: float, x: float) -> float:
	return smoothstep(a, b, x)


func _compute_targets() -> void:
	for b in BEDS:
		_t[b] = 0.0
	# ---- menu / no world
	if Game.world == null or not has_listener:
		if menu_ambience and Game.world == null:
			_t[&"amb_wind_breeze"] = 0.35
			_t[&"amb_wind_calm"] = 0.4
		ctx = {"menu": true}
		_update_emitters(false)
		return
	var p := listener
	var wind_v := Vector3.ZERO
	if Climate.has_method("get_wind_at"):
		wind_v = Climate.get_wind_at(p)
	var wind := wind_v.length()
	var forest := 0.0
	var masks := Color(0, 0, 0, 0)
	if TerrainData.has_method("get_masks"):
		masks = TerrainData.get_masks(p.x, p.z)
		forest = masks.a
	var shelter := 0.0
	if Climate.has_method("get_shelter_at"):
		shelter = Climate.get_shelter_at(p)
	var day := 1.0
	if Climate.has_method("get_daylight"):
		day = Climate.get_daylight()
	var weather: StringName = Climate.weather if "weather" in Climate else &"clear"
	var precip: float = Climate.precipitation if "precipitation" in Climate else 0.0
	if _slow_timer <= 0.0:
		_slow_timer = 1.0
		_exposure = _compute_exposure(p)
		_compute_water(p)
	var env: StringName = audio.env_kind if "env_kind" in audio else &"outdoor"
	var indoor := shelter
	if env == &"interior" or env == &"station" or env == &"cave":
		indoor = maxf(indoor, 0.92)
	_speed = 2.0 if absf(indoor - float(ctx.get("indoor", indoor))) > 0.2 else 1.0
	var outdoor := 1.0 - indoor * 0.9
	var eff := wind * _exposure * (1.0 - 0.55 * forest)
	var alt := p.y
	var storm := 0.0
	if weather == &"blizzard":
		storm = 1.0
	elif precip > 0.8 and wind > 12.0:
		storm = 0.6
	# ---- wind layers (partition of unity over effective speed)
	var calm := 1.0 - _smooth(2.0, 6.0, eff)
	var breeze := _smooth(2.0, 6.0, eff) * (1.0 - _smooth(8.0, 12.0, eff))
	var strong := _smooth(8.0, 12.0, eff) * (1.0 - _smooth(15.0, 20.0, eff))
	var gale := _smooth(15.0, 20.0, eff)
	var alpine := _smooth(2150.0, 2600.0, alt) * _smooth(4.0, 10.0, eff)
	var blizz := storm * clampf(0.4 + 0.6 * _exposure, 0.3, 1.2)
	var spruce := _smooth(0.2, 0.6, forest) * _smooth(1.5, 8.0, wind) * (1.0 - 0.5 * storm)
	_t[&"amb_wind_calm"] = sqrt(calm) * (1.0 - 0.5 * alpine) * outdoor
	_t[&"amb_wind_breeze"] = sqrt(breeze) * (1.0 - 0.5 * alpine) * outdoor * (1.0 - 0.6 * blizz)
	_t[&"amb_wind_strong"] = sqrt(strong) * outdoor * (1.0 - 0.5 * blizz)
	_t[&"amb_wind_gale"] = sqrt(gale) * outdoor * (1.0 - 0.5 * blizz)
	_t[&"amb_wind_alpine"] = sqrt(alpine) * outdoor * (1.0 - 0.4 * blizz)
	_t[&"amb_wind_spruce"] = sqrt(spruce) * outdoor
	_t[&"amb_blizzard"] = clampf(blizz, 0.0, 1.0) * outdoor
	# ---- living forest beds
	var calm_enough := 1.0 - _smooth(10.0, 16.0, wind)
	var f := _smooth(0.25, 0.6, forest) * calm_enough * (1.0 - storm) * (1.0 - _smooth(2100.0, 2400.0, alt))
	_t[&"amb_forest_day"] = sqrt(f * day) * outdoor
	_t[&"amb_forest_night"] = sqrt(f * (1.0 - day)) * outdoor
	# ---- water (bed only close-by for width; positional emitters carry distance & direction)
	_t[&"amb_creek"] = (1.0 - _smooth(3.0, 22.0, _water["creek"])) * outdoor
	_t[&"amb_river"] = (1.0 - _smooth(6.0, 40.0, _water["river"])) * outdoor
	_t[&"amb_lake_shore"] = (1.0 - _smooth(2.0, 18.0, _water["lake"])) * outdoor
	_t[&"amb_waterfall"] = (1.0 - _smooth(15.0, 80.0, _water["fall"])) * outdoor
	_update_emitters(true)
	# ---- interiors
	if env == &"cave":
		_t[&"amb_cave"] = 1.0
	elif env == &"station":
		if _is_station_powered():
			_t[&"amb_station_hum"] = 1.0
		else:
			_t[&"amb_station_dead"] = 1.0
	if indoor > 0.3 and env != &"cave":
		_t[&"amb_interior_wind"] = indoor * _smooth(2.0, 12.0, wind * _exposure) * (0.5 if env == &"station" else 1.0)
	ctx = {"wind": wind, "eff": eff, "forest": forest, "day": day, "alt": alt, "indoor": indoor, "storm": storm,
		"exposure": _exposure, "env": env, "biome": _biome(p), "creek": _water["creek"], "river": _water["river"],
		"lake": _water["lake"], "fall": _water["fall"], "menu": false}


func _is_station_powered() -> bool:
	if station_powered != null:
		return bool(station_powered)
	if Game.has_method("get_flag") and bool(Game.get_flag(&"station_power", false)):
		return true
	return audio.has_method("is_loop_active") and audio.is_loop_active(&"generator_loop")


func _biome(p: Vector3) -> StringName:
	if TerrainData.has_method("get_biome"):
		return TerrainData.get_biome(p.x, p.z)
	return &"valley"


## Openness: listener ground height relative to the surrounding terrain (ridges > 1, gullies < 1).
func _compute_exposure(p: Vector3) -> float:
	if not TerrainData.has_method("get_height"):
		return 1.0
	var h0 := TerrainData.get_height(p.x, p.z)
	var acc := 0.0
	for k in 8:
		var a := k * TAU / 8.0
		acc += TerrainData.get_height(p.x + cos(a) * 45.0, p.z + sin(a) * 45.0)
	var rel := h0 - acc / 8.0
	return clampf(1.0 + rel / 35.0, 0.45, 1.5)


# ------------------------------------------------------------------------------------------------ water

func _compute_water(p: Vector3) -> void:
	_water["creek"] = INF
	_water["river"] = INF
	_water["lake"] = INF
	_water["fall"] = INF
	var layout: Dictionary = TerrainData.layout if "layout" in TerrainData else {}
	var found := false
	for rv in layout.get("rivers", []):
		var pts: Array = rv.get("points", [])
		for k in range(pts.size() - 1):
			var a: Array = pts[k]
			var b: Array = pts[k + 1]
			if a.size() < 3 or b.size() < 3:
				continue
			var pa := Vector3(float(a[0]), float(a[1]), float(a[2]))
			var pb := Vector3(float(b[0]), float(b[1]), float(b[2]))
			var width := float(a[3]) if a.size() > 3 else 6.0
			var q := Geometry3D.get_closest_point_to_segment(p, pa, pb)
			var d := maxf(0.0, Vector2(p.x - q.x, p.z - q.z).length() - width * 0.5)
			var key := "creek" if width < 7.0 else "river"
			if d < _water[key]:
				_water[key] = d
				_water[key + "_p"] = q
			found = true
	for lk in layout.get("lakes", []):
		var c := Vector2(float(lk.get("x", 0)), float(lk.get("z", 0)))
		var rad := float(lk.get("radius", 0))
		var lvl := float(lk.get("level", p.y))
		var v := Vector2(p.x, p.z) - c
		var dist := absf(v.length() - rad)
		if v.length() > 0.01 and dist < _water["lake"] and absf(p.y - lvl) < 40.0:
			_water["lake"] = dist
			var sp := c + v.normalized() * rad
			_water["lake_p"] = Vector3(sp.x, lvl, sp.y)
		found = true
	for poi in layout.get("pois", []):
		var pid := String(poi.get("id", ""))
		if pid.contains("waterfall") or pid.contains("falls"):
			var fp := Vector3(float(poi.get("x", 0)), float(poi.get("y", p.y)), float(poi.get("z", 0)))
			var d2 := fp.distance_to(p)
			if d2 < _water["fall"]:
				_water["fall"] = d2
				_water["fall_p"] = fp
	if found or not TerrainData.has_method("get_water_level"):
		return
	# fallback: probe the water surface around the listener
	for r: float in [6.0, 18.0, 40.0, 80.0]:
		for k in 8:
			var a := k * TAU / 8.0
			var x := p.x + cos(a) * r
			var z := p.z + sin(a) * r
			var wl := TerrainData.get_water_level(x, z)
			if wl > -1e20 and is_finite(wl):
				_water["creek"] = r
				_water["creek_p"] = Vector3(x, wl, z)
				return


func _update_emitters(active: bool) -> void:
	var spec := {"creek": &"water_stream_loop", "river": &"water_stream_loop", "lake": &"lake_lap_loop",
		"fall": &"waterfall_loop"}
	var ranges := {"creek": 70.0, "river": 160.0, "lake": 45.0, "fall": 300.0}
	for key in spec:
		var d: float = _water[key] if active else INF
		var em: AudioStreamPlayer3D = _emitters.get(key)
		if d < ranges[key]:
			if em == null:
				em = _emitter(key, spec[key])
			if em:
				em.global_position = _water[key + "_p"]
				var base: float = audio.catalog.entries[spec[key]].volume_db if audio.catalog.entries.has(spec[key]) else 0.0
				em.volume_db = base + (4.0 if key == "river" else 0.0) + linear_to_db(maxf(duck, 0.01))
				if key == "river":
					em.unit_size = 14.0
					em.max_distance = 200.0
				if not em.playing:
					em.play(randf() * maxf(em.stream.get_length() - 1.0, 0.0) if em.stream else 0.0)
		elif em and em.playing:
			em.stop()


# ------------------------------------------------------------------------------------------------ events

func event_weight(id: StringName) -> float:
	if ctx.get("menu", true):
		return 0.0
	var day: float = ctx["day"]
	var night := 1.0 - day
	var forest: float = ctx["forest"]
	var alt: float = ctx["alt"]
	var storm: float = ctx["storm"]
	var wind: float = ctx["wind"]
	var indoor: float = ctx["indoor"]
	var out := 1.0 - indoor * 0.85
	var calm := 1.0 - smoothstep(9.0, 16.0, wind)
	match id:
		&"bird_chirp":
			return day * (0.3 + 0.7 * forest) * (1.0 - smoothstep(2200.0, 2500.0, alt)) * (1.0 - storm) * calm * out
		&"amb_woodpecker":
			return day * forest * (1.0 - storm) * calm * out
		&"raven_caw":
			return day * (1.0 - storm) * out
		&"eagle_cry":
			return day * smoothstep(1700.0, 2300.0, alt) * (1.0 - storm) * out
		&"amb_ptarmigan":
			return day * smoothstep(2100.0, 2300.0, alt) * (1.0 - smoothstep(2800.0, 3000.0, alt)) * (1.0 - storm) * out
		&"amb_nutcracker":
			return day * smoothstep(1850.0, 2000.0, alt) * (1.0 - smoothstep(2350.0, 2500.0, alt)) * (1.0 - storm) * out
		&"amb_owl":
			return night * forest * (1.0 - smoothstep(2100.0, 2300.0, alt)) * calm * out
		&"wolf_howl":
			if Game.has_method("get_flag") and bool(Game.get_flag(&"wolves_silent", false)):
				return 0.0
			return night * (1.0 - smoothstep(2200.0, 2400.0, alt)) * (1.0 - storm) * out
		&"rockfall":
			return smoothstep(1900.0, 2500.0, alt) * out
		&"serac_fall":
			return smoothstep(2300.0, 2800.0, alt) * out
		&"avalanche":
			return smoothstep(1800.0, 2400.0, alt) * (0.4 + 0.6 * float(Climate.precipitation if "precipitation" in Climate else 0.0)) * out
		&"ice_crack":
			var cold := 0.0
			if Climate.has_method("get_air_temperature"):
				cold = smoothstep(-2.0, -12.0, Climate.get_air_temperature(listener))
			var glacier := 1.0 if ctx["biome"] == &"glacier" else 0.0
			var lake := 1.0 - smoothstep(20.0, 200.0, float(ctx["lake"]))
			return cold * maxf(glacier, lake) * out
		&"wood_creak":
			return forest * smoothstep(5.0, 14.0, wind) * out
		&"metal_creak":
			return (1.0 if ctx["env"] == &"station" else 0.0) * smoothstep(4.0, 14.0, wind)
		&"thunder":
			return storm * 0.6
	return 0.0


func _spawn_events(dt: float) -> void:
	for id in EVENTS:
		var cfg: Dictionary = EVENTS[id]
		var w := event_weight(id)
		if w <= 0.0:
			continue
		if randf() < float(cfg["rate"]) * w * dt:
			var dist: Vector2 = cfg["dist"]
			var h: Vector2 = cfg["h"]
			var a := randf() * TAU
			var d := randf_range(dist.x, dist.y)
			var x := listener.x + cos(a) * d
			var z := listener.z + sin(a) * d
			var gy := listener.y - 1.6
			if TerrainData.has_method("get_height"):
				gy = TerrainData.get_height(x, z)
			var pos := Vector3(x, gy + randf_range(h.x, h.y), z)
			if id == &"metal_creak":
				pos = listener + Vector3(cos(a) * d, randf_range(0.0, 3.0), sin(a) * d)
			audio.play_ambient_event(id, pos)

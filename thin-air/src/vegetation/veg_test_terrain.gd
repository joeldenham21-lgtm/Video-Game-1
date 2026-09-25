class_name VegTestTerrain
extends RefCounted
## Synthetic stand-in for the TerrainData autoload (same query API, CONTRACT §3) used by the vegetation tests
## and the QA stage: a 1.3 km valley in the northern BC Rockies — a lake at ~1,460 m on the valley floor in
## the south, forested slopes rising north; east of an escarpment (cliff) a high bench through the treeline
## (~2,200 m) to alpine scree and snow (~2,450 m); a POI pad and a trail. Heights and masks are baked
## into grids at init (like the real TerrainData) so queries are cheap. Outside WINDOW it reports bare
## 3,000 m ground so the scatter's quick probe skips those cells.

const WINDOW := 640.0          # half size of the active square (m)
const RES := 2.0               # height grid spacing (m)
const MRES := 4.0              # mask grid spacing (m)
const HALF := 1536.0
const LAKE := Vector3(-170.0, 330.0, 70.0)      # x, z, radius
const PAD := Vector3(60.0, 250.0, 22.0)         # x, z, flat radius
const CLIFF_X := 330.0

var layout: Dictionary = {
	"pois": [{"id": "test_cabin", "name": "Test cabin", "x": PAD.x, "y": 0.0, "z": PAD.y, "radius": 40.0,
		"flat_radius": PAD.z}],
	"trails": [{"id": "test_trail", "width": 2.5, "points": [[-480.0, 0.0, 420.0], [-100.0, 0.0, 300.0],
		[60.0, 0.0, 250.0], [180.0, 0.0, -60.0], [240.0, 0.0, -380.0]]}],
	"lakes": [{"id": "test_lake", "x": LAKE.x, "z": LAKE.y, "radius": LAKE.z}],
}
var min_height := 1440.0
var max_height := 3000.0
var lake_level := 0.0
var _hn := 0
var _h := PackedFloat32Array()
var _mn := 0
var _m := PackedColorArray()


func _init() -> void:
	lake_level = _raw_height(LAKE.x, LAKE.y) + 0.6
	layout["lakes"][0]["level"] = lake_level
	_hn = int(2.0 * WINDOW / RES) + 1
	_h.resize(_hn * _hn)
	var hp := _raw_height(PAD.x, PAD.y)
	for j in _hn:
		for i in _hn:
			var x := -WINDOW + i * RES
			var z := -WINDOW + j * RES
			var h := _raw_height(x, z)
			var pd := Vector2(x - PAD.x, z - PAD.y).length()
			if pd < PAD.z * 1.6:
				h = lerpf(hp, h, smoothstep(PAD.z, PAD.z * 1.6, pd))
			_h[j * _hn + i] = h
	_mn = int(2.0 * WINDOW / MRES) + 1
	_m.resize(_mn * _mn)
	for j in _mn:
		for i in _mn:
			_m[j * _mn + i] = _compute_masks(-WINDOW + i * MRES, -WINDOW + j * MRES)
	layout["pois"][0]["y"] = get_height(PAD.x, PAD.y)


func is_loaded() -> bool:
	return true


func in_window(x: float, z: float) -> bool:
	return absf(x) <= WINDOW and absf(z) <= WINDOW


func _noise(x: float, z: float, s: float, salt: int) -> float:
	return VegScatter.noise2(x + 5000.0, z + 5000.0, s, salt)


func _raw_height(x: float, z: float) -> float:
	# west: valley floor in the south (+Z) rising gently north (-Z) to ~1,950 m (15-25 deg slopes);
	# east of CLIFF_X: an escarpment (~65 deg rock band) up to a high bench 1,950 -> 2,480 m that carries
	# the treeline, larch/whitebark parkland, alpine scree and snow
	var u := clampf((WINDOW - z) / (2.0 * WINDOW), 0.0, 1.0)
	var h := 1450.0 + 500.0 * pow(u, 1.3)
	var bench := smoothstep(CLIFF_X - 60.0, CLIFF_X + 60.0, x)
	h += bench * (470.0 + 60.0 * u)
	h += (_noise(x, z, 170.0, 1) - 0.5) * 40.0 + (_noise(x, z, 45.0, 2) - 0.5) * 8.0
	# lake basin
	var ld := Vector2(x - LAKE.x, z - LAKE.y).length()
	h -= 9.0 * (1.0 - smoothstep(LAKE.z * 0.3, LAKE.z * 1.25, ld))
	return h


func get_height(x: float, z: float) -> float:
	if not in_window(x, z):
		return 3000.0
	var fx := (x + WINDOW) / RES
	var fz := (z + WINDOW) / RES
	var i := clampi(int(fx), 0, _hn - 2)
	var j := clampi(int(fz), 0, _hn - 2)
	var tx := clampf(fx - i, 0.0, 1.0)
	var tz := clampf(fz - j, 0.0, 1.0)
	var k := j * _hn + i
	return lerpf(lerpf(_h[k], _h[k + 1], tx), lerpf(_h[k + _hn], _h[k + _hn + 1], tx), tz)


func get_normal(x: float, z: float) -> Vector3:
	var e := 1.5
	var dx := get_height(x + e, z) - get_height(x - e, z)
	var dz := get_height(x, z + e) - get_height(x, z - e)
	return Vector3(-dx, 2.0 * e, -dz).normalized()


func get_slope_deg(x: float, z: float) -> float:
	return rad_to_deg(acos(clampf(get_normal(x, z).y, -1.0, 1.0)))


func get_masks(x: float, z: float) -> Color:
	if not in_window(x, z):
		return Color(1.0, 0.0, 0.0, 0.0)
	var fx := (x + WINDOW) / MRES
	var fz := (z + WINDOW) / MRES
	var i := clampi(int(fx), 0, _mn - 2)
	var j := clampi(int(fz), 0, _mn - 2)
	var tx := clampf(fx - i, 0.0, 1.0)
	var tz := clampf(fz - j, 0.0, 1.0)
	var k := j * _mn + i
	return _m[k].lerp(_m[k + 1], tx).lerp(_m[k + _mn].lerp(_m[k + _mn + 1], tx), tz)


func _compute_masks(x: float, z: float) -> Color:
	var y := get_height(x, z)
	var slope := get_slope_deg(x, z)
	var snow := smoothstep(2380.0, 2520.0, y + (_noise(x, z, 40.0, 5) - 0.5) * 60.0)
	var rock := clampf(smoothstep(34.0, 46.0, slope) + smoothstep(2280.0, 2450.0, y) * 0.7 * (1.0 - snow * 0.5), 0.0, 1.0)
	var forest := (1.0 - smoothstep(2150.0, 2330.0, y + (_noise(x, z, 60.0, 6) - 0.5) * 80.0)) * (1.0 - rock)
	forest *= smoothstep(0.3, 0.52, _noise(x, z, 110.0, 7))     # natural openings / meadows
	var meadow := clampf((1.0 - forest) * (1.0 - rock) * (1.0 - snow) * 0.9, 0.0, 1.0)
	return Color(snow, rock, meadow, clampf(forest, 0.0, 1.0))


func get_surface(x: float, z: float) -> StringName:
	var m := get_masks(x, z)
	if m.r > 0.6:
		return &"snow"
	if m.g > 0.55:
		return &"scree" if get_slope_deg(x, z) < 36.0 else &"rock"
	if m.a > 0.5:
		return &"forest"
	return &"grass"


func get_biome(x: float, z: float) -> StringName:
	var y := get_height(x, z)
	if y < 1550.0:
		return &"valley"
	if y < 2100.0:
		return &"forest"
	if y < 2450.0:
		return &"subalpine"
	return &"alpine"


func get_water_level(x: float, z: float) -> float:
	if Vector2(x - LAKE.x, z - LAKE.y).length() < LAKE.z * 1.3 and _raw_height(x, z) < lake_level:
		return lake_level
	return -INF


func is_in_water(p: Vector3) -> bool:
	return p.y < get_water_level(p.x, p.z)


func in_bounds(x: float, z: float, margin := 0.0) -> bool:
	return absf(x) <= HALF - margin and absf(z) <= HALF - margin


func all_pois() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for p in layout["pois"]:
		var d: Dictionary = (p as Dictionary).duplicate()
		d["position"] = Vector3(float(p["x"]), float(p["y"]), float(p["z"]))
		out.append(d)
	return out


func get_poi(id: StringName) -> Dictionary:
	for p in all_pois():
		if StringName(p["id"]) == id:
			return p
	return {}

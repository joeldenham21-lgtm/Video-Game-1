class_name WaterQuery
extends RefCounted
## Autoload-free water helpers (Water stream). Everything here agrees with TerrainData.get_water_level(),
## which stays the single source of truth for where water is and how high it stands.
##
##   WaterQuery.is_drinkable_at(pos)        -> bool     open water within arm's reach of pos (shores, banks)
##   WaterQuery.drink_point(pos, reach)     -> Vector3  that water surface point, or Vector3.INF
##   WaterQuery.surface_at(x, z)            -> float    water surface Y or -INF (= TerrainData.get_water_level)
##   WaterQuery.depth_at(x, z)              -> float    surface − bed, 0 when dry
##   WaterQuery.is_underwater(pos)          -> bool     pos below the surface (camera, eyes, items)
##   WaterQuery.flow_at(pos)                -> Vector3  river current (m/s) at pos, ZERO on lakes / dry land
##   WaterQuery.flow_speed(slope, width)    -> float    the current model the river shader and buoyancy share

const HASH_CELL := 32.0
const HASH_N := 96                     # 3072 m / 32 m
const DRINK_REACH := 1.9               # m, crouching at the water's edge
const MIN_DRINK_DEPTH := 0.06          # m of actual water (not a wet gravel bar)

static var _segs := PackedFloat32Array()   # ax, ay, az, bx, by, bz, half_w, speed  (8 floats / segment)
static var _grid: Array = []
static var _built_for := -1


## Surface speed of a mountain river reach (m/s) from its slope (rise/run) and width (m): Manning-like,
## capped for whitewater. Shared by the river shader (UV2.x) and item drift.
static func flow_speed(slope: float, width: float) -> float:
	var s := clampf(slope, 0.0, 4.0)
	var depth_term := clampf(width / 12.0, 0.4, 1.4)
	return clampf(0.35 + 3.4 * sqrt(s) * depth_term, 0.3, 7.5)


static func surface_at(x: float, z: float) -> float:
	return TerrainData.get_water_level(x, z)


static func depth_at(x: float, z: float) -> float:
	var wl := TerrainData.get_water_level(x, z)
	if wl == -INF:
		return 0.0
	return maxf(wl - TerrainData.get_height(x, z), 0.0)


static func is_underwater(pos: Vector3) -> bool:
	var wl := TerrainData.get_water_level(pos.x, pos.z)
	return wl != -INF and pos.y < wl and wl - TerrainData.get_height(pos.x, pos.z) > 0.0


## Open water the player could scoop from standing at `pos` (feet or an interaction hit point): any point
## within `reach` horizontally whose surface is at most ~reach below / 0.5 m above pos and actually wet.
static func is_drinkable_at(pos: Vector3, reach := DRINK_REACH) -> bool:
	return drink_point(pos, reach) != Vector3.INF


static func drink_point(pos: Vector3, reach := DRINK_REACH) -> Vector3:
	var best := Vector3.INF
	var best_d := INF
	# centre, then two rings (8 + 12 probes): cheap, only called on interaction
	var probes: Array[Vector2] = [Vector2.ZERO]
	for k in 8:
		var a := TAU * k / 8.0
		probes.append(Vector2(cos(a), sin(a)) * reach * 0.5)
	for k in 12:
		var a2 := TAU * (k + 0.5) / 12.0
		probes.append(Vector2(cos(a2), sin(a2)) * reach)
	for o in probes:
		var x := pos.x + o.x
		var z := pos.z + o.y
		var wl := TerrainData.get_water_level(x, z)
		if wl == -INF:
			continue
		if wl - TerrainData.get_height(x, z) < MIN_DRINK_DEPTH:
			continue
		var dy := pos.y - wl
		if dy < -0.5 or dy > reach + 0.3:
			continue
		var d := o.length()
		if d < best_d:
			best_d = d
			best = Vector3(x, wl, z)
	return best


## River current at pos (m/s, along the channel, downhill). ZERO on lakes and dry land.
static func flow_at(pos: Vector3) -> Vector3:
	_ensure_index()
	if _grid.is_empty() or not TerrainData.in_bounds(pos.x, pos.z):
		return Vector3.ZERO
	var ci := clampi(int((pos.x + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1)
	var cj := clampi(int((pos.z + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1)
	var cand: PackedInt32Array = _grid[cj * HASH_N + ci]
	var best_level := -INF
	var best := Vector3.ZERO
	var p := Vector2(pos.x, pos.z)
	for si in cand:
		var o := si * 8
		var a := Vector2(_segs[o], _segs[o + 2])
		var b := Vector2(_segs[o + 3], _segs[o + 5])
		var ab := b - a
		var l2 := ab.length_squared()
		var t := 0.0 if l2 < 1e-6 else clampf((p - a).dot(ab) / l2, 0.0, 1.0)
		var q := a + ab * t
		var hw := _segs[o + 6]
		if p.distance_squared_to(q) > hw * hw:
			continue
		var lvl := lerpf(_segs[o + 1], _segs[o + 4], t)
		if lvl <= best_level:
			continue
		best_level = lvl
		var d3 := Vector3(_segs[o + 3] - _segs[o], _segs[o + 4] - _segs[o + 1], _segs[o + 5] - _segs[o + 2])
		# slow at the banks, full speed mid-channel
		var across := clampf(sqrt(p.distance_squared_to(q)) / maxf(hw, 0.1), 0.0, 1.0)
		best = d3.normalized() * _segs[o + 7] * (1.0 - across * across * 0.7)
	return best


static func _ensure_index() -> void:
	var rivers: Array = TerrainData.get_rivers() if TerrainData.has_method(&"get_rivers") else []
	var key := rivers.size() * 7919 + (1 if TerrainData.is_loaded() else 0)
	if _built_for == key and not _grid.is_empty():
		return
	_built_for = key
	_segs = PackedFloat32Array()
	_grid = []
	_grid.resize(HASH_N * HASH_N)
	for k in _grid.size():
		_grid[k] = PackedInt32Array()
	for rv in rivers:
		var pts: Array = rv.get("points", [])
		for s in range(pts.size() - 1):
			var a: Array = pts[s]
			var b: Array = pts[s + 1]
			var run := Vector2(float(b[0]) - float(a[0]), float(b[2]) - float(a[2])).length()
			var slope := maxf(float(a[1]) - float(b[1]), 0.0) / maxf(run, 0.5)
			var width := (float(a[3]) + float(b[3])) * 0.5
			var hw := maxf(float(a[3]), float(b[3])) * 0.5 + 0.5
			var si := _segs.size() / 8
			_segs.append_array(PackedFloat32Array([float(a[0]), float(a[1]), float(a[2]), float(b[0]), float(b[1]),
				float(b[2]), hw, flow_speed(slope, width)]))
			var x0 := minf(float(a[0]), float(b[0])) - hw
			var x1 := maxf(float(a[0]), float(b[0])) + hw
			var z0 := minf(float(a[2]), float(b[2])) - hw
			var z1 := maxf(float(a[2]), float(b[2])) + hw
			for cj in range(clampi(int((z0 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1),
					clampi(int((z1 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1) + 1):
				for ci in range(clampi(int((x0 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1),
						clampi(int((x1 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1) + 1):
					var arr: PackedInt32Array = _grid[cj * HASH_N + ci]
					arr.append(si)
					_grid[cj * HASH_N + ci] = arr

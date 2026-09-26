class_name WaterQuery
extends RefCounted
## Autoload-free water helpers (Water stream). surface_at() is the surface exactly as the water meshes draw
## it: lake polygons at their level, rivers at the level of the NEAREST reach (the polyline profile). It equals
## TerrainData.get_water_level() on lakes and on most of every river; they differ where TerrainData takes the
## max over overlapping round-capped segments — on steep or very wide reaches (the braided Hollow River) that
## reports the level of a reach upstream, up to a few metres above the drawn water (see the Water report).
##
##   WaterQuery.is_drinkable_at(pos)        -> bool     open water within arm's reach of pos (shores, banks)
##   WaterQuery.drink_point(pos, reach)     -> Vector3  that water surface point, or Vector3.INF
##   WaterQuery.surface_at(x, z)            -> float    drawn water surface Y or -INF
##   WaterQuery.depth_at(x, z)              -> float    surface − bed, 0 when dry
##   WaterQuery.is_underwater(pos)          -> bool     pos below the surface (camera, eyes, items)
##   WaterQuery.flow_at(pos)                -> Vector3  river current (m/s) at pos, ZERO on lakes / dry land
##   WaterQuery.flow_speed(slope, width)    -> float    the current model the river shader and buoyancy share

const HASH_CELL := 32.0
const HASH_N := 96                     # 3072 m / 32 m
const DRINK_REACH := 2.4               # m, crouching at the water's edge (interaction ray is 2.6 m)
const MIN_DRINK_DEPTH := 0.05          # m of actual water (not a wet gravel bar)

static var _segs := PackedFloat32Array()   # ax, ay, az, bx, by, bz, half_w, speed  (8 floats / segment)
static var _grid: Array = []
static var _built_for := -1
static var _lakes: Array = []              # [PackedVector2Array polygon, level, Rect2 bounds]


## Surface speed of a mountain river reach (m/s) from its slope (rise/run) and width (m): Manning-like,
## capped for whitewater. Shared by the river shader (UV2.x) and item drift.
static func flow_speed(slope: float, width: float) -> float:
	var s := clampf(slope, 0.0, 4.0)
	var depth_term := clampf(width / 12.0, 0.4, 1.4)
	return clampf(0.35 + 3.4 * sqrt(s) * depth_term, 0.3, 7.5)


## The drawn water surface at (x, z): max(lake level if inside a lake, nearest river reach level), or -INF.
static func surface_at(x: float, z: float) -> float:
	_ensure_index()
	var best := -INF
	var p := Vector2(x, z)
	for lk in _lakes:
		if (lk[2] as Rect2).has_point(p) and Geometry2D.is_point_in_polygon(p, lk[0]):
			best = maxf(best, float(lk[1]))
	var r := _nearest_reach(x, z)
	if r.x >= 0.0:
		best = maxf(best, r.y)
	return best


static func depth_at(x: float, z: float) -> float:
	var wl := surface_at(x, z)
	if wl == -INF:
		return 0.0
	return maxf(wl - TerrainData.get_height(x, z), 0.0)


static func is_underwater(pos: Vector3) -> bool:
	var wl := surface_at(pos.x, pos.z)
	return wl != -INF and pos.y < wl and wl - TerrainData.get_height(pos.x, pos.z) > 0.0


## Nearest river reach covering (x, z): Vector3(segment index, level, distance to the centre line); x = −1 if none.
static func _nearest_reach(x: float, z: float) -> Vector3:
	if _grid.is_empty() or not TerrainData.in_bounds(x, z):
		return Vector3(-1.0, -INF, INF)
	var ci := clampi(int((x + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1)
	var cj := clampi(int((z + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1)
	var cand: PackedInt32Array = _grid[cj * HASH_N + ci]
	var p := Vector2(x, z)
	var best := Vector3(-1.0, -INF, INF)
	for si in cand:
		var o := si * 8
		var a := Vector2(_segs[o], _segs[o + 2])
		var b := Vector2(_segs[o + 3], _segs[o + 5])
		var ab := b - a
		var l2 := ab.length_squared()
		var t := 0.0 if l2 < 1e-6 else clampf((p - a).dot(ab) / l2, 0.0, 1.0)
		var d := p.distance_to(a + ab * t)
		if d > _segs[o + 6] or d > best.z + 0.01:
			continue
		var lvl := lerpf(_segs[o + 1], _segs[o + 4], t)
		if d < best.z - 0.01 or lvl > best.y:
			best = Vector3(float(si), lvl, d)
	return best


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
		var wl := surface_at(x, z)
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
	var r := _nearest_reach(pos.x, pos.z)
	if r.x < 0.0:
		return Vector3.ZERO
	var o := int(r.x) * 8
	# inside a lake that is higher than the reach (a river mouth): still water
	for lk in _lakes:
		if float(lk[1]) > r.y + 0.05 and Geometry2D.is_point_in_polygon(Vector2(pos.x, pos.z), lk[0]):
			return Vector3.ZERO
	var d3 := Vector3(_segs[o + 3] - _segs[o], _segs[o + 4] - _segs[o + 1], _segs[o + 5] - _segs[o + 2])
	# slow at the banks, full speed mid-channel
	var across := clampf(r.z / maxf(_segs[o + 6], 0.1), 0.0, 1.0)
	return d3.normalized() * _segs[o + 7] * (1.0 - across * across * 0.7)


static func _ensure_index() -> void:
	var rivers: Array = TerrainData.get_rivers() if TerrainData.has_method(&"get_rivers") else []
	var lakes: Array = TerrainData.get_lakes() if TerrainData.has_method(&"get_lakes") else []
	var key := rivers.size() * 7919 + lakes.size() * 31 + (1 if TerrainData.is_loaded() else 0)
	if _built_for == key and not _grid.is_empty():
		return
	_built_for = key
	_segs = PackedFloat32Array()
	_grid = []
	_grid.resize(HASH_N * HASH_N)
	for k in _grid.size():
		_grid[k] = PackedInt32Array()
	_lakes = []
	var lake_polys: Array = []
	for lk in lakes:
		var poly := WaterBuilder.lake_polygon(lk)
		var bb := Rect2(poly[0], Vector2.ZERO)
		for q in poly:
			bb = bb.expand(q)
		_lakes.append([poly, float(lk.get("level", 0.0)), bb.grow(0.5)])
		lake_polys.append(poly)
	for rv in rivers:
		# the same cross-sections the ribbon mesh is built from (render heights, glitch-seated)
		var secs := WaterBuilder.river_sections(rv, lake_polys)
		for s in range(secs.size() - 1):
			var a: Vector3 = secs[s]["p"]
			var b: Vector3 = secs[s + 1]["p"]
			if Vector2(b.x - a.x, b.z - a.z).length() > 40.0:
				continue
			var hw := maxf(float(secs[s]["hw"]), float(secs[s + 1]["hw"])) - WaterBuilder.RIVER_EDGE_MARGIN
			var sp := (float(secs[s]["speed"]) + float(secs[s + 1]["speed"])) * 0.5
			var si := _segs.size() / 8
			_segs.append_array(PackedFloat32Array([a.x, a.y, a.z, b.x, b.y, b.z, hw, sp]))
			var x0 := minf(a.x, b.x) - hw
			var x1 := maxf(a.x, b.x) + hw
			var z0 := minf(a.z, b.z) - hw
			var z1 := maxf(a.z, b.z) + hw
			for cj in range(clampi(int((z0 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1),
					clampi(int((z1 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1) + 1):
				for ci in range(clampi(int((x0 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1),
						clampi(int((x1 + TerrainData.HALF) / HASH_CELL), 0, HASH_N - 1) + 1):
					var arr: PackedInt32Array = _grid[cj * HASH_N + ci]
					arr.append(si)
					_grid[cj * HASH_N + ci] = arr

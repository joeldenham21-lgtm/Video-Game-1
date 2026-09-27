class_name WaterBuilder
extends RefCounted
## Builds the water geometry from data/world_layout.json (via TerrainData) — Water stream.
##   lakes:  flat polygons at the lake level, the layout polygon (or the tarn circle) grown a little past the
##           shoreline so the terrain's depth test draws the true shore; one surface for every lake.
##   rivers: ribbons along the river polylines at the data surface height (flat across, following the
##           reach down steps and falls), split into a 2×2 grid of meshes; attributes documented in
##           assets/shaders/water_river.gdshader.
##   falls:  steep reaches (slope ≥ FALL_SLOPE over ≥ FALL_MIN_DROP m) → mist + waterfall audio sites.
## Deterministic: same layout → same meshes.

const LAKE_MARGIN := 2.0              # m the loon polygon is grown past the shore (terrain clips it)
const CIRCLE_SEGMENTS := 56
const RIVER_EDGE_MARGIN := 0.3        # m beyond TerrainData's half width (w/2 + 0.5), faded out in the shader
const END_FADE := 6.0                 # m of fade at the open ends of a ribbon
const FALL_SLOPE := 1.0               # rise/run (45°)
const FALL_MIN_DROP := 8.0
const CASCADE_SLOPE := 0.45
const MAX_ABOVE_BED := 1.6            # data surface this far above every bank sample is a data glitch: clamp


static func lake_polygon(lk: Dictionary) -> PackedVector2Array:
	var poly := PackedVector2Array()
	for p in lk.get("polygon", []):
		poly.append(Vector2(float(p[0]), float(p[1])))
	if poly.size() >= 3:
		return poly
	var c := Vector2(float(lk.get("x", 0.0)), float(lk.get("z", 0.0)))
	var r := float(lk.get("radius", 10.0))
	for k in CIRCLE_SEGMENTS:
		var a := TAU * k / CIRCLE_SEGMENTS
		# inscribed so the edge never leaves TerrainData's circle
		poly.append(c + Vector2(cos(a), sin(a)) * r)
	return poly


static func lake_mesh_polygon(lk: Dictionary) -> PackedVector2Array:
	var poly := lake_polygon(lk)
	if not lk.has("polygon"):
		return poly
	var grown := Geometry2D.offset_polygon(poly, LAKE_MARGIN, Geometry2D.JOIN_ROUND)
	var best := poly
	var best_a := -1.0
	for g in grown:
		var gp: PackedVector2Array = g
		if Geometry2D.is_polygon_clockwise(gp):
			continue
		var a := absf(_area(gp))
		if a > best_a:
			best_a = a
			best = gp
	return best


static func _area(p: PackedVector2Array) -> float:
	var s := 0.0
	for i in p.size():
		var a := p[i]
		var b := p[(i + 1) % p.size()]
		s += a.x * b.y - b.x * a.y
	return s * 0.5


## Coldness of a water body's altitude: 0 in the valley (≤ 1,450 m) .. 1 at 2,400 m.
static func coldness(level: float) -> float:
	return clampf((level - 1450.0) / 950.0, 0.0, 1.0)


static func build_lakes(lakes: Array) -> ArrayMesh:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for lk in lakes:
		var level := float(lk.get("level", 0.0))
		var poly := lake_mesh_polygon(lk)
		var tris := Geometry2D.triangulate_polygon(poly)
		if tris.is_empty():
			continue
		var base := verts.size()
		var cold := coldness(level)
		for p in poly:
			verts.append(Vector3(p.x, level, p.y))
			norms.append(Vector3.UP)
			cols.append(Color(cold, 0.0, 0.0, 1.0))
			uvs.append(p)
		for t in range(0, tris.size(), 3):
			var a := verts[base + tris[t]]
			var b := verts[base + tris[t + 1]]
			var c := verts[base + tris[t + 2]]
			# Godot front faces are clockwise seen from the front: Plane(a, b, c).normal must point up
			if (a - c).cross(a - b).y >= 0.0:
				idx.append_array([base + tris[t], base + tris[t + 1], base + tris[t + 2]])
			else:
				idx.append_array([base + tris[t], base + tris[t + 2], base + tris[t + 1]])
	var mesh := ArrayMesh.new()
	if idx.is_empty():
		return mesh
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_INDEX] = idx
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return mesh


## Point inside any lake polygon (the data one, as TerrainData tests it)?
static func _in_lake(p: Vector2, lake_polys: Array) -> bool:
	for poly in lake_polys:
		if Geometry2D.is_point_in_polygon(p, poly):
			return true
	return false


## River cross-sections for one polyline: Array of {p: Vector3 centre (render height), dir: Vector2,
## hw: float, slope: float, speed: float, s: float (3D distance), fade: float, clamped: bool}.
static func river_sections(rv: Dictionary, lake_polys: Array) -> Array:
	var pts: Array = rv.get("points", [])
	var n := pts.size()
	var out: Array = []
	if n < 2:
		return out
	var braided := String(rv.get("kind", "")) == "braided"
	var P := PackedVector3Array()
	var W := PackedFloat32Array()
	for p in pts:
		P.append(Vector3(float(p[0]), float(p[1]), float(p[2])))
		W.append(float(p[3]))
	# keep one section inside a lake at either end so the ribbon runs into it (and fades out there)
	var inside := []
	for i in n:
		inside.append(_in_lake(Vector2(P[i].x, P[i].z), lake_polys))
	var s_acc := 0.0
	for i in n:
		if inside[i] and (i == 0 or inside[i - 1]) and (i == n - 1 or inside[i + 1]):
			continue
		var i0 := maxi(i - 2, 0)
		var i1 := mini(i + 2, n - 1)
		var d := Vector2(P[i1].x - P[i0].x, P[i1].z - P[i0].z)
		if d.length_squared() < 1e-6:
			d = Vector2(0, 1)
		d = d.normalized()
		var j0 := maxi(i - 1, 0)
		var j1 := mini(i + 1, n - 1)
		var run := Vector2(P[j1].x - P[j0].x, P[j1].z - P[j0].z).length()
		var slope := maxf(P[j0].y - P[j1].y, 0.0) / maxf(run, 0.5)
		var hw := W[i] * 0.5 + 0.5 + RIVER_EDGE_MARGIN
		var c := P[i]
		# a surface hanging in the air over every bank sample is a data glitch: sit it on the channel
		var perp := Vector2(-d.y, d.x)
		var bank := maxf(TerrainData.get_height(c.x, c.z), maxf(
			TerrainData.get_height(c.x + perp.x * hw * 0.8, c.z + perp.y * hw * 0.8),
			TerrainData.get_height(c.x - perp.x * hw * 0.8, c.z - perp.y * hw * 0.8)))
		var clamped := false
		if c.y > bank + MAX_ABOVE_BED and slope < FALL_SLOPE * 0.8:
			c.y = bank + 0.6
			clamped = true
		if not out.is_empty():
			s_acc += (c - (out[out.size() - 1]["p"] as Vector3)).length()
		out.append({"p": c, "dir": d, "hw": hw, "slope": slope, "speed": WaterQuery.flow_speed(slope, W[i]),
			"s": s_acc, "fade": 1.0, "clamped": clamped, "braided": braided})
	# end fades (open ends only: a ribbon that starts at a source spring fades in quickly)
	var total: float = out[out.size() - 1]["s"] if not out.is_empty() else 0.0
	for sec in out:
		var s: float = sec["s"]
		sec["fade"] = clampf(minf(s, total - s) / END_FADE, 0.0, 1.0) if total > END_FADE * 2.0 else 1.0
	return out


## All river ribbons, bucketed into a 2×2 grid of meshes. Returns Array[ArrayMesh] (empty buckets skipped).
static func build_rivers(rivers: Array, lakes: Array) -> Array[ArrayMesh]:
	var lake_polys: Array = []
	for lk in lakes:
		lake_polys.append(lake_polygon(lk))
	var buckets: Array = []
	for k in 4:
		buckets.append({"v": PackedVector3Array(), "n": PackedVector3Array(), "t": PackedFloat32Array(),
			"uv": PackedVector2Array(), "uv2": PackedVector2Array(), "c": PackedColorArray(), "i": PackedInt32Array()})
	for rv in rivers:
		var secs := river_sections(rv, lake_polys)
		for k in range(secs.size() - 1):
			var a: Dictionary = secs[k]
			var b: Dictionary = secs[k + 1]
			var pa: Vector3 = a["p"]
			var pb: Vector3 = b["p"]
			if Vector2(pb.x - pa.x, pb.z - pa.z).length() > 40.0:
				continue          # a gap where the river passes through a lake
			var mid := (pa + pb) * 0.5
			var bi := (1 if mid.x >= 0.0 else 0) + (2 if mid.z >= 0.0 else 0)
			_add_quad(buckets[bi], a, b)
	var meshes: Array[ArrayMesh] = []
	for bk in buckets:
		if (bk["i"] as PackedInt32Array).is_empty():
			continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = bk["v"]
		arr[Mesh.ARRAY_NORMAL] = bk["n"]
		arr[Mesh.ARRAY_TANGENT] = bk["t"]
		arr[Mesh.ARRAY_TEX_UV] = bk["uv"]
		arr[Mesh.ARRAY_TEX_UV2] = bk["uv2"]
		arr[Mesh.ARRAY_COLOR] = bk["c"]
		arr[Mesh.ARRAY_INDEX] = bk["i"]
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		meshes.append(m)
	return meshes


static func _section_frame(sec: Dictionary, nxt: Vector3) -> Array:
	var d: Vector2 = sec["dir"]
	var across := Vector3(-d.y, 0.0, d.x)       # left bank → right bank is −across … +across
	var p: Vector3 = sec["p"]
	var along := nxt - p
	if along.length_squared() < 1e-6:
		along = Vector3(d.x, 0.0, d.y)
	var n := across.cross(along).normalized()
	if n.y < 0.0:
		n = -n
	return [across, n]


static func _add_quad(bk: Dictionary, a: Dictionary, b: Dictionary) -> void:
	var v: PackedVector3Array = bk["v"]
	var nn: PackedVector3Array = bk["n"]
	var tt: PackedFloat32Array = bk["t"]
	var uv: PackedVector2Array = bk["uv"]
	var uv2: PackedVector2Array = bk["uv2"]
	var cc: PackedColorArray = bk["c"]
	var ii: PackedInt32Array = bk["i"]
	var base := v.size()
	var pa: Vector3 = a["p"]
	var pb: Vector3 = b["p"]
	var fa := _section_frame(a, pb)
	var fb := _section_frame(b, pb + (pb - pa))
	for pair in [[a, fa, pa], [b, fb, pb]]:
		var sec: Dictionary = pair[0]
		var fr: Array = pair[1]
		var c: Vector3 = pair[2]
		var across: Vector3 = fr[0]
		var n: Vector3 = fr[1]
		var hw: float = sec["hw"]
		var braided: bool = sec["braided"]
		var col := Color(0.25 if braided else 0.0, 1.0 if braided else 0.0, float(sec["fade"]), 1.0)
		for side in [-1.0, 1.0]:
			v.append(c + across * hw * side)
			nn.append(n)
			tt.append_array(PackedFloat32Array([across.x, across.y, across.z, 1.0]))
			uv.append(Vector2(side, float(sec["s"])))
			uv2.append(Vector2(float(sec["speed"]), float(sec["slope"])))
			cc.append(col)
	# vertices: 0 = a left, 1 = a right, 2 = b left, 3 = b right; winding so Plane() normal points up
	var p0 := v[base]
	var p1 := v[base + 1]
	var p2 := v[base + 2]
	if (p0 - p2).cross(p0 - p1).dot(nn[base]) >= 0.0:
		ii.append_array([base, base + 1, base + 2, base + 1, base + 3, base + 2])
	else:
		ii.append_array([base, base + 2, base + 1, base + 1, base + 2, base + 3])
	bk["v"] = v
	bk["n"] = nn
	bk["t"] = tt
	bk["uv"] = uv
	bk["uv2"] = uv2
	bk["c"] = cc
	bk["i"] = ii


## Steep reaches: waterfalls (≥ FALL_SLOPE) and cascades. Returns Array of {river, kind (&"fall"/&"cascade"),
## top: Vector3, base: Vector3, drop: float}, biggest first.
static func find_falls(rivers: Array) -> Array:
	var out: Array = []
	for rv in rivers:
		var pts: Array = rv.get("points", [])
		var run_start := -1
		var run_kind := &""
		for i in range(pts.size()):
			var slope := 0.0
			if i + 1 < pts.size():
				var a: Array = pts[i]
				var b: Array = pts[i + 1]
				var run := Vector2(float(b[0]) - float(a[0]), float(b[2]) - float(a[2])).length()
				slope = maxf(float(a[1]) - float(b[1]), 0.0) / maxf(run, 0.5)
			var kind := &"fall" if slope >= FALL_SLOPE else (&"cascade" if slope >= CASCADE_SLOPE else &"")
			if kind != run_kind or i == pts.size() - 1:
				if run_start >= 0 and run_kind != &"":
					var top: Array = pts[run_start]
					var bot: Array = pts[i]
					var drop := float(top[1]) - float(bot[1])
					var min_drop := FALL_MIN_DROP if run_kind == &"fall" else 5.0
					if drop >= min_drop:
						out.append({"river": String(rv.get("id", "")), "kind": run_kind,
							"top": Vector3(float(top[0]), float(top[1]), float(top[2])),
							"base": Vector3(float(bot[0]), float(bot[1]), float(bot[2])), "drop": drop,
							"width": float(bot[3])})
				run_start = i if kind != &"" else -1
				run_kind = kind
	out.sort_custom(func(x: Dictionary, y: Dictionary) -> bool: return float(x["drop"]) > float(y["drop"]))
	return out

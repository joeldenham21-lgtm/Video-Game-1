class_name VegScatter
extends RefCounted
## Deterministic vegetation placement from TerrainData (pure; safe to run on worker threads).
## The map is split into CELL x CELL m cells; every cell is generated independently from a seed derived from
## its coordinates, so any subset of cells can be (re)generated in any order and always gives the same
## result. Instance ids are stable: (cell index << 12) | local index.
##
## Rules (see DESIGN.md §3, late October in the northern BC Rockies):
##   trees     density = forest mask (masks.a) x clumping noise; species by altitude, aspect (south-facing =
##             dry -> lodgepole/whitebark) and moisture (valley bottoms, lake/river margins -> spruce);
##             larch + whitebark near treeline 1,900-2,300 m, stunted above 2,150 m, none above ~2,380 m;
##             snags sprinkled everywhere, more near treeline and in old-burn patches
##   rocks     boulders/outcrops on rock & scree (masks.g, surface), moraines above 2,250 m, rare erratics in
##             forest; small rocks around them
##   shrubs    willow/alder along water and wet meadows, juniper on dry open slopes, huckleberry in openings
##   deadwood  fallen logs and stumps in forest
##   never     in water, on cliffs steeper than the per-category limit, on POI flat pads, on trails, off map

const CELL := 64.0
const GRID := 48                       # 3072 / 64
const HALF := 1536.0
const WORLD_SEED := 0x7A11_2E0
const MAX_LOCAL := 4096

enum Cat { TREE, SAPLING, SHRUB, DEADWOOD, ROCK_BIG, ROCK_SMALL }
const CAT_COUNT := 6

const TREE_SPACING := 4.4
const ROCK_SPACING := 8.0
const SMALL_ROCK_SPACING := 4.0
const SHRUB_SPACING := 5.5
const LOG_SPACING := 13.0
## Largest margin passed to excluded() + slack (m).
const EXCL_REACH := 6.0

const MAX_SLOPE := {Cat.TREE: 38.0, Cat.SAPLING: 38.0, Cat.SHRUB: 40.0, Cat.DEADWOOD: 30.0, Cat.ROCK_BIG: 48.0,
	Cat.ROCK_SMALL: 44.0}
## Footprint radius used for overlap rejection (m).
const FOOTPRINT := {Cat.TREE: 1.1, Cat.SAPLING: 0.6, Cat.SHRUB: 0.9, Cat.DEADWOOD: 0.6, Cat.ROCK_BIG: 1.6,
	Cat.ROCK_SMALL: 0.35}


## Everything the generator needs, prepared once on the main thread (no scene access afterwards).
class Context:
	var terrain: Object                       # TerrainData or a stand-in with the same query methods
	var kinds_by_cat: Array = []              # Cat -> Array[Dictionary] {index, name, weight tags...}
	var species_variants: Dictionary = {}     # species -> Array[{index, name, sapling, height}]
	var rock_big: Array = []                  # [{index, name, radius}]
	var rock_small: Array = []
	var shrubs: Dictionary = {}               # "willow"/"alder"/"juniper"/"huckleberry" -> [{index, name}]
	var logs: Array = []
	var stumps: Array = []
	var pads: Array = []                      # [Vector3(x, z, radius)]
	var trails: Array = []                    # [PackedVector3Array of (x, z, half_width)] segments polyline
	## Per scatter cell: pads and trail segments that come within EXCL_REACH of it (excluded() is called for
	## every candidate, and a real map has ~1,500 trail segments).
	var cell_pads: Dictionary = {}            # cell index -> Array[Vector3]
	var cell_segs: Dictionary = {}            # cell index -> PackedFloat32Array (ax, az, bx, bz, ha, hb)
	var density_mul := 1.0
	var has_water := true
	var has_masks2 := false                   # TerrainData.get_masks2(): R scree/talus/moraine, G gravel, B ice, A wetness


class CellData:
	var cx := 0
	var cz := 0
	var kinds := PackedInt32Array()
	var cats := PackedByteArray()
	var ids := PackedInt32Array()
	var pos := PackedVector3Array()
	var yaw := PackedFloat32Array()
	var scale := PackedFloat32Array()
	var rank := PackedFloat32Array()          # 0..1, instances with rank >= density keep-fraction are hidden
	var xf := PackedFloat32Array()            # 12 floats per instance (MultiMesh 3D transform layout)

	func size() -> int:
		return kinds.size()


static func cell_index(cx: int, cz: int) -> int:
	return cz * GRID + cx


static func cell_of(x: float, z: float) -> Vector2i:
	return Vector2i(clampi(int(floor((x + HALF) / CELL)), 0, GRID - 1), clampi(int(floor((z + HALF) / CELL)), 0, GRID - 1))


static func cell_origin(cx: int, cz: int) -> Vector2:
	return Vector2(-HALF + cx * CELL, -HALF + cz * CELL)


static func make_id(cx: int, cz: int, local: int) -> int:
	return (cell_index(cx, cz) << 12) | (local & (MAX_LOCAL - 1))


static func id_cell(id: int) -> int:
	return id >> 12


# ---------------------------------------------------------------------------------------------- context

## Builds the generation context from the vegetation library and TerrainData.layout.
static func make_context(lib: VegLibrary, terrain: Object, density_mul := 1.0) -> Context:
	var ctx := Context.new()
	ctx.terrain = terrain
	ctx.density_mul = density_mul
	ctx.has_masks2 = terrain.has_method("get_masks2")
	for n in lib.kind_names:
		var inf: Dictionary = lib.info(n)
		var entry := {"index": int(inf["index"]), "name": n, "height": float(inf.get("height", 1.0)),
			"radius": float(inf.get("radius", inf.get("crown_radius", 1.0))), "sapling": bool(inf.get("sapling", false))}
		match int(inf["cat"]):
			VegLibrary.Cat.TREE, VegLibrary.Cat.SAPLING:
				var sp := String(inf.get("species", ""))
				if not ctx.species_variants.has(sp):
					ctx.species_variants[sp] = []
				ctx.species_variants[sp].append(entry)
			VegLibrary.Cat.SHRUB:
				var group := String(inf.get("group", String(n).get_slice("_", 0)))
				if not ctx.shrubs.has(group):
					ctx.shrubs[group] = []
				ctx.shrubs[group].append(entry)
			VegLibrary.Cat.DEADWOOD:
				if String(n).begins_with("stump"):
					ctx.stumps.append(entry)
				else:
					ctx.logs.append(entry)
			VegLibrary.Cat.ROCK_BIG:
				ctx.rock_big.append(entry)
			VegLibrary.Cat.ROCK_SMALL:
				ctx.rock_small.append(entry)
	var layout: Dictionary = terrain.get("layout") if terrain.get("layout") is Dictionary else {}
	for p in layout.get("pois", []):
		if p is Dictionary:
			var fr := float(p.get("flat_radius", p.get("radius", 0.0)))
			if fr > 0.0:
				ctx.pads.append(Vector3(float(p.get("x", 0.0)), float(p.get("z", 0.0)), fr))
	for t in layout.get("trails", []):
		var pts := PackedVector3Array()
		var width := 2.0
		var raw: Variant = t
		if t is Dictionary:
			raw = (t as Dictionary).get("points", [])
			width = float((t as Dictionary).get("width", 2.0))
		if raw is Array:
			for q in raw:
				if q is Array and (q as Array).size() >= 2:
					var a: Array = q
					var qx := float(a[0])
					var qz := float(a[2]) if a.size() >= 3 else float(a[1])
					# world_layout.json trail points are [x, y, z, flags]: the 4th value is not a width
					var qw := float(a[3]) if a.size() >= 4 and float(a[3]) > 0.3 else width
					pts.append(Vector3(qx, qz, qw * 0.5))
				elif q is Dictionary:
					pts.append(Vector3(float(q.get("x", 0.0)), float(q.get("z", 0.0)), float(q.get("width", width)) * 0.5))
		if pts.size() >= 2:
			ctx.trails.append(pts)
	_index_exclusions(ctx)
	return ctx


static func _cells_touching(x0: float, z0: float, x1: float, z1: float) -> Array:
	var out: Array = []
	var c0 := cell_of(minf(x0, x1), minf(z0, z1))
	var c1 := cell_of(maxf(x0, x1), maxf(z0, z1))
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			out.append(cell_index(cx, cz))
	return out


static func _index_exclusions(ctx: Context) -> void:
	for p in ctx.pads:
		var pad: Vector3 = p
		var r := pad.z + EXCL_REACH
		for ci in _cells_touching(pad.x - r, pad.y - r, pad.x + r, pad.y + r):
			if not ctx.cell_pads.has(ci):
				ctx.cell_pads[ci] = []
			(ctx.cell_pads[ci] as Array).append(pad)
	var acc := {}                              # cell index -> Array of floats
	for t in ctx.trails:
		var pts: PackedVector3Array = t
		for i in pts.size() - 1:
			var a := pts[i]
			var b := pts[i + 1]
			var r := maxf(a.z, b.z) + EXCL_REACH
			for ci in _cells_touching(minf(a.x, b.x) - r, minf(a.y, b.y) - r, maxf(a.x, b.x) + r, maxf(a.y, b.y) + r):
				if not acc.has(ci):
					acc[ci] = []
				(acc[ci] as Array).append_array([a.x, a.y, b.x, b.y, a.z, b.z])
	for ci in acc:
		ctx.cell_segs[ci] = PackedFloat32Array(acc[ci])


# ---------------------------------------------------------------------------------------------- queries

static func _hash(a: int, b: int, c: int) -> int:
	var h := (a * 374761393 + b * 668265263 + c * 1442695041 + WORLD_SEED) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	h = ((h ^ (h >> 16)) * 2246822519) & 0xffffffff
	return (h ^ (h >> 13)) & 0x7fffffff


## Smooth value noise in [0, 1] (deterministic, no allocations).
static func noise2(x: float, z: float, scale: float, salt: int) -> float:
	var fx := x / scale
	var fz := z / scale
	var ix := int(floor(fx))
	var iz := int(floor(fz))
	var tx := fx - ix
	var tz := fz - iz
	tx = tx * tx * (3.0 - 2.0 * tx)
	tz = tz * tz * (3.0 - 2.0 * tz)
	var a := float(_hash(ix, iz, salt) % 10007) / 10007.0
	var b := float(_hash(ix + 1, iz, salt) % 10007) / 10007.0
	var c := float(_hash(ix, iz + 1, salt) % 10007) / 10007.0
	var d := float(_hash(ix + 1, iz + 1, salt) % 10007) / 10007.0
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), tz)


## True when (x, z) is on a POI flat pad (+margin) or within half-width+margin of a trail (margin <=
## EXCL_REACH). Uses the per-cell index built by make_context().
static func excluded(ctx: Context, x: float, z: float, margin: float) -> bool:
	var ci := cell_index(cell_of(x, z).x, cell_of(x, z).y)
	var pads: Variant = ctx.cell_pads.get(ci)
	if pads != null:
		for p in pads:
			var pad: Vector3 = p
			var dx := x - pad.x
			var dz := z - pad.y
			var r := pad.z + margin
			if dx * dx + dz * dz < r * r:
				return true
	var segs: Variant = ctx.cell_segs.get(ci)
	if segs == null:
		return false
	var f: PackedFloat32Array = segs
	for k in range(0, f.size(), 6):
		var ax := f[k]
		var az := f[k + 1]
		var abx := f[k + 2] - ax
		var abz := f[k + 3] - az
		var l2 := abx * abx + abz * abz
		var u := 0.0
		if l2 > 1e-6:
			u = clampf(((x - ax) * abx + (z - az) * abz) / l2, 0.0, 1.0)
		var px := ax + abx * u - x
		var pz := az + abz * u - z
		var hw := lerpf(f[k + 4], f[k + 5], u) + margin
		if px * px + pz * pz < hw * hw:
			return true
	return false


## Secondary masks: R scree/talus/moraine, G gravel bars, B glacier ice, A wetness. Falls back to
## get_surface() == scree when the terrain has no get_masks2().
static func masks2(ctx: Context, x: float, z: float) -> Color:
	if ctx.has_masks2:
		return ctx.terrain.get_masks2(x, z)
	return Color(1.0 if StringName(ctx.terrain.get_surface(x, z)) == &"scree" else 0.0, 0.0, 0.0, 0.0)


static func in_water(ctx: Context, x: float, z: float, y: float, margin: float) -> bool:
	if not ctx.has_water:
		return false
	var t := ctx.terrain
	var wl: float = t.get_water_level(x, z)
	if wl > -1e20 and wl > y - 0.25:
		return true
	if margin > 0.0:
		for o in [Vector2(margin, 0), Vector2(-margin, 0), Vector2(0, margin), Vector2(0, -margin)]:
			var w2: float = t.get_water_level(x + o.x, z + o.y)
			if w2 > -1e20 and w2 > float(t.get_height(x + o.x, z + o.y)) - 0.25:
				return true
	return false


# ---------------------------------------------------------------------------------------------- species

## Species weights at a site: altitude y (m), south = how much the slope faces south (0..1),
## moist = 0..1, burn = old-burn patch 0..1.
static func species_weights(y: float, south: float, moist: float, burn: float) -> Dictionary:
	var w := {}
	w["spruce"] = _bell(y, 1300.0, 1650.0, 2050.0, 2200.0) * (0.55 + 0.9 * moist) * (1.0 - 0.6 * south)
	w["fir"] = _bell(y, 1420.0, 1750.0, 2150.0, 2330.0) * (0.75 + 0.4 * moist) * (1.0 - 0.35 * south)
	w["lodgepole"] = _bell(y, 1300.0, 1400.0, 1800.0, 1980.0) * (0.12 + 1.3 * south * (1.0 - moist) + 0.9 * burn)
	w["larch"] = _bell(y, 1920.0, 2040.0, 2230.0, 2340.0) * (0.9 + 0.4 * (1.0 - south))
	w["whitebark"] = _bell(y, 1950.0, 2080.0, 2280.0, 2380.0) * (0.5 + 1.2 * south)
	w["snag"] = 0.05 + 0.08 * _bell(y, 2000.0, 2150.0, 2300.0, 2400.0) + 0.5 * burn
	return w


## Trapezoid 0 -> 1 -> 0 over [a, b, c, d].
static func _bell(y: float, a: float, b: float, c: float, d: float) -> float:
	if y <= a or y >= d:
		return 0.0
	if y < b:
		return smoothstep(a, b, y)
	if y > c:
		return 1.0 - smoothstep(c, d, y)
	return 1.0


static func _pick_weighted(w: Dictionary, r: float) -> String:
	var total := 0.0
	for k in w:
		total += float(w[k])
	if total <= 0.0:
		return ""
	var acc := 0.0
	var t := r * total
	for k in w:
		acc += float(w[k])
		if t <= acc:
			return String(k)
	return String(w.keys()[w.size() - 1])


# ---------------------------------------------------------------------------------------------- generation

static func generate_cell(ctx: Context, cx: int, cz: int) -> CellData:
	var out := CellData.new()
	out.cx = cx
	out.cz = cz
	var o := cell_origin(cx, cz)
	var t := ctx.terrain
	var rng := RandomNumberGenerator.new()
	var placed: Array[Vector3] = []          # (x, z, radius)
	# quick probe: skip empty high-alpine / glacier cells
	var probe := 0.0
	var alt_min := 1e9
	for i in 3:
		for j in 3:
			var px := o.x + CELL * (0.17 + 0.33 * i)
			var pz := o.y + CELL * (0.17 + 0.33 * j)
			var m: Color = t.get_masks(px, pz)
			probe = maxf(probe, maxf(m.a, maxf(m.g, m.b)))
			alt_min = minf(alt_min, float(t.get_height(px, pz)))
	if probe < 0.02 and alt_min > 2500.0:
		return out
	# 1) big rocks (boulders, outcrop slabs): rock/scree masks, moraines, rare forest erratics
	if not ctx.rock_big.is_empty():
		rng.seed = _hash(cx, cz, 11)
		_grid(ctx, out, rng, placed, o, ROCK_SPACING, Cat.ROCK_BIG, func(x: float, z: float, y: float, m: Color, slope: float) -> float:
			var m2 := masks2(ctx, x, z)
			if m2.b > 0.4:
				return 0.0
			var moraine := smoothstep(2250.0, 2450.0, y) * (1.0 - m.r * 0.6)
			return clampf(m.g * 0.55 + m2.r * 0.35 + moraine * 0.12 + m.a * 0.03, 0.0, 0.8))
	# 2) trees
	rng.seed = _hash(cx, cz, 23)
	_grid(ctx, out, rng, placed, o, TREE_SPACING, Cat.TREE, func(x: float, z: float, _y: float, m: Color, _slope: float) -> float:
		var clump := noise2(x, z, 38.0, 3) * 0.7 + noise2(x, z, 11.0, 4) * 0.3
		var gap := smoothstep(0.18, 0.42, clump)
		return clampf(m.a * ctx.density_mul, 0.0, 1.0) * gap * 1.15)
	# 3) fallen logs & stumps (forest floor)
	if not ctx.logs.is_empty() or not ctx.stumps.is_empty():
		rng.seed = _hash(cx, cz, 37)
		_grid(ctx, out, rng, placed, o, LOG_SPACING, Cat.DEADWOOD, func(_x: float, _z: float, y: float, m: Color, _slope: float) -> float:
			return m.a * 0.55 * (1.0 - smoothstep(2150.0, 2350.0, y)))
	# 4) shrubs
	if not ctx.shrubs.is_empty():
		rng.seed = _hash(cx, cz, 41)
		_grid(ctx, out, rng, placed, o, SHRUB_SPACING, Cat.SHRUB, func(x: float, z: float, y: float, m: Color, _slope: float) -> float:
			var open := 1.0 - m.a
			var edge := m.a * (1.0 - m.a) * 4.0
			var patch := smoothstep(0.35, 0.7, noise2(x, z, 23.0, 7))
			return clampf((m.b * 0.25 + edge * 0.25 + open * 0.1 * (1.0 - m.r)) * patch * (1.0 - smoothstep(2300.0, 2500.0, y)), 0.0, 0.7))
	# 5) small rocks and talus stones
	if not ctx.rock_small.is_empty():
		rng.seed = _hash(cx, cz, 53)
		_grid(ctx, out, rng, placed, o, SMALL_ROCK_SPACING, Cat.ROCK_SMALL, func(x: float, z: float, _y: float, m: Color, _slope: float) -> float:
			var m2 := masks2(ctx, x, z)
			if m2.b > 0.4:
				return 0.0
			return clampf(m.g * 0.3 + m2.r * 0.45 + m2.g * 0.12 + 0.03 + m.a * 0.03, 0.0, 0.7))
	_build_transforms(out)
	return out


static func _grid(ctx: Context, out: CellData, rng: RandomNumberGenerator, placed: Array[Vector3], o: Vector2,
		spacing: float, cat: int, density: Callable) -> void:
	var t := ctx.terrain
	var n := int(CELL / spacing)
	var step := CELL / n
	var max_slope: float = MAX_SLOPE[cat]
	var foot: float = FOOTPRINT[cat]
	for j in n:
		for i in n:
			var x := o.x + (i + 0.5 + rng.randf_range(-0.42, 0.42)) * step
			var z := o.y + (j + 0.5 + rng.randf_range(-0.42, 0.42)) * step
			var r_accept := rng.randf()
			var r_pick := rng.randf()
			var r_size := rng.randf()
			var r_yaw := rng.randf()
			var r_rank := rng.randf()
			if not t.in_bounds(x, z, 3.0):
				continue
			var m: Color = t.get_masks(x, z)
			var y: float = t.get_height(x, z)
			var dens: float = density.call(x, z, y, m, 0.0)
			if r_accept >= dens:
				continue
			var slope: float = t.get_slope_deg(x, z)
			if slope > max_slope:
				continue
			var margin := 4.0 if cat == Cat.TREE else 1.5
			if excluded(ctx, x, z, margin):
				continue
			if in_water(ctx, x, z, y, 2.5 if cat == Cat.TREE else 1.0):
				continue
			var kind := -1
			var scl := 1.0
			var ccat := cat
			match cat:
				Cat.TREE:
					var res := _pick_tree(ctx, t, x, z, y, r_pick, r_size)
					kind = res.x
					scl = res.y
					if kind >= 0 and bool(_variant_by_index(ctx, kind).get("sapling", false)):
						ccat = Cat.SAPLING
				Cat.ROCK_BIG:
					var e: Dictionary = ctx.rock_big[int(r_pick * ctx.rock_big.size()) % ctx.rock_big.size()]
					kind = int(e["index"])
					scl = lerpf(0.7, 1.3, r_size)
				Cat.ROCK_SMALL:
					var e2: Dictionary = ctx.rock_small[int(r_pick * ctx.rock_small.size()) % ctx.rock_small.size()]
					kind = int(e2["index"])
					scl = lerpf(0.6, 1.5, r_size * r_size)
				Cat.SHRUB:
					kind = _pick_shrub(ctx, t, x, z, y, m, r_pick)
					scl = lerpf(0.75, 1.2, r_size)
				Cat.DEADWOOD:
					var use_stump := r_pick < 0.28 and not ctx.stumps.is_empty() or ctx.logs.is_empty()
					var lst: Array = ctx.stumps if use_stump else ctx.logs
					if lst.is_empty():
						continue
					kind = int(lst[int(r_size * 7919.0) % lst.size()]["index"])
					scl = lerpf(0.8, 1.15, r_size)
			if kind < 0:
				continue
			var fr: float = foot * scl
			if cat == Cat.TREE and ccat == Cat.SAPLING:
				fr = FOOTPRINT[Cat.SAPLING]
			var clash := false
			for q in placed:
				var dx := q.x - x
				var dz := q.y - z
				var rr := q.z + fr
				if dx * dx + dz * dz < rr * rr:
					clash = true
					break
			if clash:
				continue
			if out.kinds.size() >= MAX_LOCAL:
				return
			placed.append(Vector3(x, z, fr))
			var ground := y
			if ccat == Cat.TREE or ccat == Cat.SAPLING or ccat == Cat.SHRUB:
				ground -= 0.05 + 0.02 * slope    # sink a little on slopes: the root flare hides the gap
			elif ccat == Cat.ROCK_BIG:
				ground -= 0.25 * scl
			out.kinds.append(kind)
			out.cats.append(ccat)
			out.ids.append(make_id(out.cx, out.cz, out.kinds.size() - 1))
			out.pos.append(Vector3(x, ground, z))
			out.yaw.append(r_yaw * TAU)
			out.scale.append(scl)
			out.rank.append(r_rank)


static func _variant_by_index(ctx: Context, idx: int) -> Dictionary:
	for sp in ctx.species_variants:
		for e in ctx.species_variants[sp]:
			if int(e["index"]) == idx:
				return e
	return {}


## Returns Vector2(kind index or -1, scale).
static func _pick_tree(ctx: Context, t: Object, x: float, z: float, y: float, r_pick: float, r_size: float) -> Vector2:
	var nrm: Vector3 = t.get_normal(x, z)
	var south := clampf(nrm.z * 2.5, 0.0, 1.0)            # +Z = south-facing slope
	var wl: float = t.get_water_level(x, z)
	var wetness := masks2(ctx, x, z).a if ctx.has_masks2 else 0.0
	var moist := clampf(0.35 + (0.4 if wl > -1e20 else 0.0) + wetness * 0.4 + (1.0 - smoothstep(1350.0, 1700.0, y)) * 0.35 - south * 0.3, 0.0, 1.0)
	var burn := smoothstep(0.72, 0.85, noise2(x, z, 160.0, 9))
	var w := species_weights(y, south, moist, burn)
	var keys := w.keys()
	for k in keys:
		if not ctx.species_variants.has(k):
			w.erase(k)
	var sp := _pick_weighted(w, fmod(r_pick * 7.31, 1.0))
	if sp == "":
		return Vector2(-1, 1)
	var vars: Array = ctx.species_variants[sp]
	# saplings favour openings and treeline; mature trees elsewhere
	var mature: Array = []
	var young: Array = []
	for e in vars:
		if bool(e["sapling"]):
			young.append(e)
		else:
			mature.append(e)
	var pick_young := not young.is_empty() and (r_size < 0.14 or mature.is_empty())
	var pool: Array = young if pick_young else mature
	var e: Dictionary = pool[int(fmod(r_pick * 131.7, 1.0) * pool.size()) % pool.size()]
	var scl := lerpf(0.82, 1.14, fmod(r_size * 17.3, 1.0))
	# treeline stunting (krummholz-like) and exposure
	scl *= lerpf(1.0, 0.55, smoothstep(2120.0, 2340.0, y))
	return Vector2(int(e["index"]), scl)


static func _pick_shrub(ctx: Context, t: Object, x: float, z: float, y: float, m: Color, r: float) -> int:
	var nrm: Vector3 = t.get_normal(x, z)
	var south := clampf(nrm.z * 2.5, 0.0, 1.0)
	var wl: float = t.get_water_level(x, z)
	var wet := 1.0 if wl > -1e20 else maxf(m.b * 0.6, masks2(ctx, x, z).a if ctx.has_masks2 else 0.0)
	var w := {}
	w["willow"] = wet * 1.2 * (1.0 - smoothstep(2100.0, 2350.0, y)) + 0.1
	w["alder"] = (0.3 + wet * 0.6) * (1.0 - smoothstep(1900.0, 2150.0, y))
	w["juniper"] = (0.2 + south * 1.0) * (1.0 - m.a) + smoothstep(1900.0, 2150.0, y) * 0.6
	w["huckleberry"] = m.a * 0.9 * _bell(y, 1350.0, 1450.0, 1950.0, 2150.0)
	for k in w.keys():
		if not ctx.shrubs.has(k):
			w.erase(k)
	var g := _pick_weighted(w, r)
	if g == "":
		return -1
	var lst: Array = ctx.shrubs[g]
	return int(lst[int(fmod(r * 97.1, 1.0) * lst.size()) % lst.size()]["index"])


static func _build_transforms(out: CellData) -> void:
	var n := out.size()
	out.xf.resize(n * 12)
	for i in n:
		var b := Basis(Vector3.UP, out.yaw[i]).scaled(Vector3.ONE * out.scale[i])
		var p := out.pos[i]
		var k := i * 12
		out.xf[k] = b.x.x
		out.xf[k + 1] = b.y.x
		out.xf[k + 2] = b.z.x
		out.xf[k + 3] = p.x
		out.xf[k + 4] = b.x.y
		out.xf[k + 5] = b.y.y
		out.xf[k + 6] = b.z.y
		out.xf[k + 7] = p.y
		out.xf[k + 8] = b.x.z
		out.xf[k + 9] = b.y.z
		out.xf[k + 10] = b.z.z
		out.xf[k + 11] = p.z


static func transform_of(cell: CellData, i: int) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, cell.yaw[i]).scaled(Vector3.ONE * cell.scale[i]), cell.pos[i])

class_name ItemMeshBuilder
extends RefCounted
## Procedural mesh kit for item/prop models (sticks, stones, bottles, garments, tools…). Geometry is gathered per
## material key; commit() emits one surface per material (so a model costs one draw call per material).
## Units are metres; UVs are metric (texture repeats are set per material) except where `unit_uv` is used for
## labels. Winding is fixed automatically from the intended normal, so primitives never render inside-out.
## Must not reference autoloads (used from the icon exporter's bare SceneTree).

class Part:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()

var parts: Dictionary = {}                  ## StringName material key -> Part (insertion order = surface order)
var xf := Transform3D.IDENTITY               ## transform applied to everything added
var detail := 1.0                            ## tessellation multiplier (icons use > 1)
var _nb := Basis.IDENTITY
var _stack: Array[Transform3D] = []


func _init(detail_mult := 1.0) -> void:
	detail = detail_mult


func segs(n: int) -> int:
	return maxi(3, roundi(n * detail))


# ---------------------------------------------------------------------------------------------- transforms

func push(t: Transform3D) -> void:
	_stack.append(xf)
	xf = xf * t
	_nb = xf.basis.inverse().transposed()


func pop() -> void:
	xf = _stack.pop_back() if not _stack.is_empty() else Transform3D.IDENTITY
	_nb = xf.basis.inverse().transposed()


static func at(pos: Vector3, rot_deg := Vector3.ZERO, scl := Vector3.ONE) -> Transform3D:
	var b := Basis.from_euler(rot_deg * (PI / 180.0)).scaled(scl)
	return Transform3D(b, pos)


# ---------------------------------------------------------------------------------------------- low level

func _p(mat: StringName) -> Part:
	var p: Part = parts.get(mat)
	if p == null:
		p = Part.new()
		parts[mat] = p
	return p


func _v(p: Part, pos: Vector3, n: Vector3, uv: Vector2) -> int:
	p.verts.append(xf * pos)
	p.norms.append((_nb * n).normalized())
	p.uvs.append(uv)
	return p.verts.size() - 1


## Triangle with automatic winding: faces the direction of the (average) vertex normal.
func _tri(p: Part, a: int, b: int, c: int) -> void:
	var va := p.verts[a]
	var face := (p.verts[b] - va).cross(p.verts[c] - va)
	if face.length_squared() < 1e-18:
		return
	var nrm := p.norms[a] + p.norms[b] + p.norms[c]
	# Godot's front faces are clockwise: emit (a, c, b) when (a, b, c) is counter-clockwise about the normal.
	if face.dot(nrm) > 0.0:
		p.idx.append(a); p.idx.append(c); p.idx.append(b)
	else:
		p.idx.append(a); p.idx.append(b); p.idx.append(c)


func _quad(p: Part, a: int, b: int, c: int, d: int) -> void:
	_tri(p, a, b, c)
	_tri(p, a, c, d)


# ---------------------------------------------------------------------------------------------- lathe

## Surface of revolution around +Y. profile: (radius, y) from bottom to top. Points with radius 0 close the
## shape (caps). Creases sharper than crease_deg get split normals.
func lathe(mat: StringName, profile: PackedVector2Array, n_segs := 16, crease_deg := 40.0, uv_scale := Vector2.ONE,
		unit_uv := false, a0 := 0.0, a1 := TAU) -> void:
	var p := _p(mat)
	var ns := segs(n_segs)
	var n := profile.size()
	if n < 2:
		return
	var en: Array[Vector2] = []
	var total := 0.0
	var rmax := 0.001
	for i in n - 1:
		var t := profile[i + 1] - profile[i]
		total += t.length()
		en.append(Vector2(t.y, -t.x).normalized() if t.length() > 1e-7 else Vector2.ZERO)
		rmax = maxf(rmax, profile[i].x)
	rmax = maxf(rmax, profile[n - 1].x)
	var cos_c := cos(deg_to_rad(crease_deg))
	var vacc := 0.0
	for i in n - 1:
		var e := en[i]
		var seg_len := (profile[i + 1] - profile[i]).length()
		if e == Vector2.ZERO:
			continue
		var n0 := e
		if i > 0 and en[i - 1] != Vector2.ZERO and en[i - 1].dot(e) > cos_c:
			n0 = (en[i - 1] + e).normalized()
		var n1 := e
		if i < n - 2 and en[i + 1] != Vector2.ZERO and en[i + 1].dot(e) > cos_c:
			n1 = (en[i + 1] + e).normalized()
		var v0 := vacc
		var v1 := vacc + seg_len
		vacc = v1
		var base := p.verts.size()
		for s in ns + 1:
			var f := float(s) / ns
			var th := lerpf(a0, a1, f)
			var c := cos(th)
			var sn := sin(th)
			# unit UVs (labels): u runs so text reads left-to-right from outside, v = 0 at the top edge
			var u := 1.0 - f if unit_uv else th * rmax * uv_scale.x
			var va := 1.0 - v0 / total if unit_uv else v0 * uv_scale.y
			var vb := 1.0 - v1 / total if unit_uv else v1 * uv_scale.y
			_v(p, Vector3(profile[i].x * c, profile[i].y, profile[i].x * sn), Vector3(n0.x * c, n0.y, n0.x * sn), Vector2(u, va))
			_v(p, Vector3(profile[i + 1].x * c, profile[i + 1].y, profile[i + 1].x * sn), Vector3(n1.x * c, n1.y, n1.x * sn), Vector2(u, vb))
		for s in ns:
			var a := base + s * 2
			_quad(p, a, a + 2, a + 3, a + 1)


func cylinder(mat: StringName, r: float, h: float, n_segs := 16, caps := true, cap_mat: StringName = &"") -> void:
	if cap_mat == &"" or not caps:
		var prof := PackedVector2Array()
		if caps:
			prof.append(Vector2(0, 0))
		prof.append(Vector2(r, 0)); prof.append(Vector2(r, h))
		if caps:
			prof.append(Vector2(0, h))
		lathe(mat, prof, n_segs)
	else:
		lathe(mat, PackedVector2Array([Vector2(r, 0), Vector2(r, h)]), n_segs)
		disc(cap_mat, r, n_segs, Vector3(0, h, 0), Vector3.UP)
		disc(cap_mat, r, n_segs, Vector3.ZERO, Vector3.DOWN)


func sphere(mat: StringName, r: float, n_segs := 16, rings := 10, uv_scale := Vector2.ONE) -> void:
	var prof := PackedVector2Array()
	var nr := segs(rings)
	for i in nr + 1:
		var a := -PI * 0.5 + PI * float(i) / nr
		prof.append(Vector2(cos(a) * r, sin(a) * r))
	lathe(mat, prof, n_segs, 80.0, uv_scale)


## Flat disc facing `normal` at `center` (planar unit UVs: the texture circle maps onto it, e.g. end grain).
func disc(mat: StringName, r: float, n_segs := 16, center := Vector3.ZERO, normal := Vector3.UP, unit_uv := true, uv_rot := 0.0) -> void:
	var p := _p(mat)
	var ns := segs(n_segs)
	var t := normal.cross(Vector3.RIGHT if absf(normal.x) < 0.9 else Vector3.FORWARD).normalized()
	var bt := normal.cross(t).normalized()
	var c := _v(p, center, normal, Vector2(0.5, 0.5))
	var first := p.verts.size()
	for s in ns + 1:
		var th := TAU * float(s) / ns
		var d := t * cos(th) + bt * sin(th)
		var uv := Vector2(0.5 + 0.5 * cos(th + uv_rot), 0.5 + 0.5 * sin(th + uv_rot)) if unit_uv else Vector2(cos(th), sin(th)) * r
		_v(p, center + d * r, normal, uv)
	for s in ns:
		_tri(p, c, first + s, first + s + 1)


# ---------------------------------------------------------------------------------------------- tube

## Sweeps a (possibly elliptical) section along a path. radius: float, PackedFloat32Array (per point) or
## PackedVector2Array (per point, x = half-width across, y = half-height along `up_hint`). up_hint orients
## the section (Vector3.ZERO = parallel transport). cap_mat: material for end caps (e.g. endgrain).
func tube(mat: StringName, path: PackedVector3Array, radius: Variant, sides := 8, cap_a := true, cap_b := true,
		cap_mat: StringName = &"", up_hint := Vector3.ZERO, uv_scale := Vector2.ONE, closed := false) -> void:
	var n := path.size()
	if n < 2:
		return
	var p := _p(mat)
	var ns := segs(sides)
	var radii := PackedVector2Array()
	for i in n:
		var r := Vector2.ONE * 0.01
		if radius is float or radius is int:
			r = Vector2.ONE * float(radius)
		elif radius is PackedFloat32Array:
			r = Vector2.ONE * (radius as PackedFloat32Array)[mini(i, (radius as PackedFloat32Array).size() - 1)]
		elif radius is PackedVector2Array:
			r = (radius as PackedVector2Array)[mini(i, (radius as PackedVector2Array).size() - 1)]
		radii.append(r)
	# frames
	var T: Array[Vector3] = []
	for i in n:
		var a := path[maxi(i - 1, 0)]
		var b := path[mini(i + 1, n - 1)]
		if closed:
			a = path[(i - 1 + n) % n]
			b = path[(i + 1) % n]
		T.append((b - a).normalized())
	var N: Array[Vector3] = []
	var B: Array[Vector3] = []
	var n0: Vector3
	if up_hint != Vector3.ZERO:
		n0 = up_hint
	else:
		n0 = Vector3.UP if absf(T[0].y) < 0.9 else Vector3.RIGHT
	for i in n:
		var ref := up_hint if up_hint != Vector3.ZERO else (n0 if i == 0 else N[i - 1])
		var nn := (ref - T[i] * ref.dot(T[i]))
		if nn.length_squared() < 1e-10:
			nn = (Vector3.RIGHT - T[i] * T[i].x)
		nn = nn.normalized()
		N.append(nn)
		B.append(T[i].cross(nn).normalized())
	var rref := 0.0
	for r in radii:
		rref = maxf(rref, maxf(r.x, r.y))
	var dist := 0.0
	var base := p.verts.size()
	for i in n:
		if i > 0:
			dist += path[i].distance_to(path[i - 1])
		for s in ns + 1:
			var th := TAU * float(s) / ns
			var c := cos(th)
			var sn := sin(th)
			var off := B[i] * (c * radii[i].x) + N[i] * (sn * radii[i].y)
			var nrm := B[i] * (c / maxf(radii[i].x, 1e-5)) + N[i] * (sn / maxf(radii[i].y, 1e-5))
			_v(p, path[i] + off, nrm.normalized(), Vector2(th * rref * uv_scale.x, dist * uv_scale.y))
	var ring := ns + 1
	var last := n - 1 if not closed else n
	for i in last:
		var i2 := (i + 1) % n
		for s in ns:
			var a := base + i * ring + s
			var b := base + i2 * ring + s
			_quad(p, a, a + 1, b + 1, b)
	if closed:
		return
	var cm := cap_mat if cap_mat != &"" else mat
	if cap_a:
		_tube_cap(cm, path[0], -T[0], N[0], B[0], radii[0], ns)
	if cap_b:
		_tube_cap(cm, path[n - 1], T[n - 1], N[n - 1], B[n - 1], radii[n - 1], ns)


func _tube_cap(mat: StringName, center: Vector3, nrm: Vector3, nn: Vector3, bb: Vector3, r: Vector2, ns: int) -> void:
	var p := _p(mat)
	var c := _v(p, center, nrm, Vector2(0.5, 0.5))
	var first := p.verts.size()
	for s in ns + 1:
		var th := TAU * float(s) / ns
		var off := bb * (cos(th) * r.x) + nn * (sin(th) * r.y)
		_v(p, center + off, nrm, Vector2(0.5 + 0.5 * cos(th), 0.5 + 0.5 * sin(th)))
	for s in ns:
		_tri(p, c, first + s, first + s + 1)


func torus(mat: StringName, big_r: float, r: float, n_segs := 24, sides := 8, arc := TAU) -> void:
	var path := PackedVector3Array()
	var ns := segs(n_segs)
	var full := is_equal_approx(arc, TAU)
	var count := ns if full else ns + 1
	for i in count:
		var a := arc * float(i) / ns
		path.append(Vector3(cos(a) * big_r, 0, sin(a) * big_r))
	tube(mat, path, r, sides, not full, not full, &"", Vector3.UP, Vector2.ONE, full)


## Helix around +Y (coils, lashings, wire). Starts at angle a0.
func helix(mat: StringName, radius: float, pitch: float, turns: float, cord_r: float, sides := 6, a0 := 0.0) -> void:
	var path := PackedVector3Array()
	var steps := maxi(8, roundi(turns * 14.0 * detail))
	for i in steps + 1:
		var f := float(i) / steps
		var a := a0 + f * turns * TAU
		path.append(Vector3(cos(a) * radius, f * turns * pitch, sin(a) * radius))
	tube(mat, path, cord_r, sides)


# ---------------------------------------------------------------------------------------------- box

## Box centred on the origin with optionally rounded edges (bevel radius, smooth normals).
func box(mat: StringName, size: Vector3, bevel := 0.0, bevel_segs := 2, uv_scale := Vector2.ONE) -> void:
	var p := _p(mat)
	var h := size * 0.5
	var b := minf(bevel, minf(h.x, minf(h.y, h.z)) * 0.999)
	var inner := h - Vector3.ONE * b
	var bs := maxi(1, roundi(bevel_segs * detail)) if b > 0.0 else 0
	var lines := [_axis_lines(h.x, b, bs), _axis_lines(h.y, b, bs), _axis_lines(h.z, b, bs)]
	for axis in 3:
		for sgn in [-1.0, 1.0]:
			var ua := (axis + 1) % 3
			var va := (axis + 2) % 3
			var lu: PackedFloat32Array = lines[ua]
			var lv: PackedFloat32Array = lines[va]
			var base := p.verts.size()
			for j in lv.size():
				for i in lu.size():
					var q := Vector3.ZERO
					q[axis] = sgn * h[axis]
					q[ua] = lu[i]
					q[va] = lv[j]
					var cq := q.clamp(-inner, inner)
					var d := q - cq
					var pos := q
					var nrm := Vector3.ZERO
					nrm[axis] = sgn
					if b > 0.0 and d.length_squared() > 1e-12:
						nrm = d.normalized()
						pos = cq + nrm * b
					_v(p, pos, nrm, Vector2(pos[ua], pos[va]) * uv_scale)
			var w := lu.size()
			for j in lv.size() - 1:
				for i in w - 1:
					var a := base + j * w + i
					_quad(p, a, a + 1, a + w + 1, a + w)


static func _axis_lines(h: float, b: float, n: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	if b <= 0.0 or n <= 0:
		out.append(-h); out.append(h)
		return out
	var inner := h - b
	for k in n + 1:
		out.append(-h + b * float(k) / n)
	if inner > 1e-6:
		for k in n + 1:
			out.append(inner + b * float(k) / n)
	else:
		for k in range(1, n + 1):
			out.append(b * float(k) / n - h + b)
	return out


## Flat rectangle in the XZ plane facing +Y (labels, paper). unit UVs by default.
func plane(mat: StringName, size: Vector2, unit_uv := true, double_sided := false) -> void:
	var p := _p(mat)
	var hx := size.x * 0.5
	var hz := size.y * 0.5
	for side in ([1.0, -1.0] if double_sided else [1.0]):
		var nrm: Vector3 = Vector3.UP * float(side)
		var a := _v(p, Vector3(-hx, 0, -hz), nrm, Vector2(0, 0) if unit_uv else Vector2(-hx, -hz))
		var b2 := _v(p, Vector3(hx, 0, -hz), nrm, Vector2(1, 0) if unit_uv else Vector2(hx, -hz))
		var c := _v(p, Vector3(hx, 0, hz), nrm, Vector2(1, 1) if unit_uv else Vector2(hx, hz))
		var d := _v(p, Vector3(-hx, 0, hz), nrm, Vector2(0, 1) if unit_uv else Vector2(-hx, hz))
		_quad(p, a, b2, c, d)


# ---------------------------------------------------------------------------------------------- rock

## Displaced icosphere (stones, chunks, blobs). facets > 0 cuts flat knapped planes (flint, charcoal).
func rock(mat: StringName, radius: float, seed: int, subdiv := 2, bumpiness := 0.22, scale := Vector3.ONE,
		flatten := 0.0, facets := 0, facet_depth := 0.18, noise_freq := 1.3) -> void:
	var p := _p(mat)
	var ico := _icosphere(clampi(roundi(subdiv + (detail - 1.0) * 0.8), 0, 4))
	var verts: PackedVector3Array = ico[0]
	var faces: PackedInt32Array = ico[1]
	var noise := FastNoiseLite.new()
	noise.seed = seed
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 4
	noise.frequency = noise_freq
	var rng := RandomNumberGenerator.new()
	rng.seed = seed * 7919 + 13
	var planes: Array[Vector4] = []
	for k in facets:
		var nrm := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized()
		planes.append(Vector4(nrm.x, nrm.y, nrm.z, radius * (1.0 - facet_depth * rng.randf_range(0.3, 1.0))))
	var out := PackedVector3Array()
	out.resize(verts.size())
	for i in verts.size():
		var d := verts[i]
		var v := d * radius * (1.0 + bumpiness * noise.get_noise_3dv(d * 1.7))
		for pl in planes:
			var pn := Vector3(pl.x, pl.y, pl.z)
			var over := v.dot(pn) - pl.w
			if over > 0.0:
				v -= pn * over
		v *= scale
		if flatten > 0.0:
			var floor_y := -radius * scale.y * (1.0 - flatten)
			if v.y < floor_y:
				v.y = lerpf(v.y, floor_y, 0.85)
		out[i] = v
	var circ := TAU * radius
	if facets > 0:
		for f in range(0, faces.size(), 3):
			var a := out[faces[f]]
			var b := out[faces[f + 1]]
			var c := out[faces[f + 2]]
			var fn := (b - a).cross(c - a).normalized()
			if fn.dot(a + b + c) < 0.0:
				fn = -fn
			var ia := _v(p, a, fn, _sph_uv(a, circ))
			var ib := _v(p, b, fn, _sph_uv(b, circ))
			var ic := _v(p, c, fn, _sph_uv(c, circ))
			_tri(p, ia, ib, ic)
		return
	var acc := PackedVector3Array()
	acc.resize(out.size())
	for f in range(0, faces.size(), 3):
		var a := out[faces[f]]
		var b := out[faces[f + 1]]
		var c := out[faces[f + 2]]
		var fn := (b - a).cross(c - a)
		if fn.dot(a + b + c) < 0.0:
			fn = -fn
		acc[faces[f]] += fn
		acc[faces[f + 1]] += fn
		acc[faces[f + 2]] += fn
	var base := p.verts.size()
	for i in out.size():
		_v(p, out[i], acc[i].normalized(), _sph_uv(out[i], circ))
	for f in range(0, faces.size(), 3):
		_tri(p, base + faces[f], base + faces[f + 1], base + faces[f + 2])


static func _sph_uv(v: Vector3, circ: float) -> Vector2:
	return Vector2(atan2(v.z, v.x) / TAU * circ, v.y)


static var _ico_cache: Dictionary = {}


static func _icosphere(level: int) -> Array:
	if _ico_cache.has(level):
		return _ico_cache[level]
	var t := (1.0 + sqrt(5.0)) * 0.5
	var v: Array[Vector3] = [
		Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
		Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
		Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	for i in v.size():
		v[i] = v[i].normalized()
	var f := PackedInt32Array([0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6,
		7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1])
	for _l in level:
		var mid := {}
		var nf := PackedInt32Array()
		for k in range(0, f.size(), 3):
			var a := f[k]
			var b := f[k + 1]
			var c := f[k + 2]
			var ab := _mid(v, mid, a, b)
			var bc := _mid(v, mid, b, c)
			var ca := _mid(v, mid, c, a)
			nf.append_array(PackedInt32Array([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca]))
		f = nf
	var res := [PackedVector3Array(v), f]
	_ico_cache[level] = res
	return res


static func _mid(v: Array[Vector3], cache: Dictionary, a: int, b: int) -> int:
	var key := Vector2i(mini(a, b), maxi(a, b))
	if cache.has(key):
		return cache[key]
	v.append(((v[a] + v[b]) * 0.5).normalized())
	cache[key] = v.size() - 1
	return v.size() - 1


# ---------------------------------------------------------------------------------------------- pillow

## Soft, puffy slab from a 2D outline in the XZ plane (garments laid flat, pelts, steaks, sachets). The top
## surface bulges up to `thickness`, the bottom rests on y = 0. wrinkle adds soft folds.
func pillow(mat: StringName, outline: PackedVector2Array, thickness: float, res := 0.02, bottom_mat: StringName = &"",
		wrinkle := 0.0, seed := 1, edge := -1.0, top_ratio := 0.72) -> void:
	var poly := _resample(outline, res)
	var pts := PackedVector2Array(poly)
	var mn := Vector2(INF, INF)
	var mx := Vector2(-INF, -INF)
	for q in poly:
		mn = mn.min(q)
		mx = mx.max(q)
	var step := res / sqrt(detail)
	var y := mn.y + step * 0.5
	var row := 0
	while y < mx.y:
		var x := mn.x + step * (0.5 if row % 2 == 0 else 1.0)
		while x < mx.x:
			var q := Vector2(x, y)
			if Geometry2D.is_point_in_polygon(q, poly) and _dist_to_poly(q, poly) > step * 0.45:
				pts.append(q)
			x += step
		y += step * 0.866
		row += 1
	var tris := Geometry2D.triangulate_delaunay(pts)
	var keep := PackedInt32Array()
	for k in range(0, tris.size(), 3):
		var c := (pts[tris[k]] + pts[tris[k + 1]] + pts[tris[k + 2]]) / 3.0
		if Geometry2D.is_point_in_polygon(c, poly):
			keep.append(tris[k]); keep.append(tris[k + 1]); keep.append(tris[k + 2])
	var ew := edge if edge > 0.0 else thickness * 1.6
	var noise := FastNoiseLite.new()
	noise.seed = seed
	noise.frequency = 6.0
	var heights := PackedFloat32Array()
	heights.resize(pts.size())
	for i in pts.size():
		var d := _dist_to_poly(pts[i], poly) if i >= poly.size() else 0.0
		var x := clampf(d / ew, 0.0, 1.0)
		var h := thickness * sqrt(maxf(0.0, 1.0 - (1.0 - x) * (1.0 - x)))
		if wrinkle > 0.0:
			h += noise.get_noise_2dv(pts[i]) * wrinkle * x
		heights[i] = h
	var bot := bottom_mat if bottom_mat != &"" else mat
	for side in [0, 1]:
		var m := mat if side == 0 else bot
		var p := _p(m)
		var pos := PackedVector3Array()
		pos.resize(pts.size())
		for i in pts.size():
			var hy := heights[i] * top_ratio if side == 0 else -heights[i] * (1.0 - top_ratio)
			pos[i] = Vector3(pts[i].x, hy + thickness * (1.0 - top_ratio), pts[i].y)
		var acc := PackedVector3Array()
		acc.resize(pts.size())
		var want := Vector3.UP if side == 0 else Vector3.DOWN
		for k in range(0, keep.size(), 3):
			var a := pos[keep[k]]
			var fn := (pos[keep[k + 1]] - a).cross(pos[keep[k + 2]] - a)
			if fn.dot(want) < 0.0:
				fn = -fn
			acc[keep[k]] += fn
			acc[keep[k + 1]] += fn
			acc[keep[k + 2]] += fn
		var base := p.verts.size()
		for i in pts.size():
			var nrm := acc[i].normalized() if acc[i].length_squared() > 0.0 else want
			_v(p, pos[i], nrm, Vector2(pts[i].x, pts[i].y) * (1.0 if side == 0 else -1.0))
		for k in range(0, keep.size(), 3):
			_tri(p, base + keep[k], base + keep[k + 1], base + keep[k + 2])


static func _resample(poly: PackedVector2Array, step: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var n := poly.size()
	for i in n:
		var a := poly[i]
		var b := poly[(i + 1) % n]
		var l := a.distance_to(b)
		var k := maxi(1, ceili(l / step))
		for j in k:
			out.append(a.lerp(b, float(j) / k))
	return out


static func _dist_to_poly(q: Vector2, poly: PackedVector2Array) -> float:
	var best := INF
	var n := poly.size()
	for i in n:
		var c := Geometry2D.get_closest_point_to_segment(q, poly[i], poly[(i + 1) % n])
		best = minf(best, q.distance_to(c))
	return best


# ---------------------------------------------------------------------------------------------- extrude

## Prism from a 2D outline in the XY plane, extruded symmetrically along Z. thickness: float or a
## PackedFloat32Array per outline vertex (blades thin towards the edge). side_mat for the rim.
func extrude(mat: StringName, outline: PackedVector2Array, thickness: Variant, side_mat: StringName = &"",
		unit_uv := false, uv_scale := Vector2.ONE) -> void:
	var n := outline.size()
	if n < 3:
		return
	var th := PackedFloat32Array()
	for i in n:
		if thickness is PackedFloat32Array:
			th.append((thickness as PackedFloat32Array)[mini(i, (thickness as PackedFloat32Array).size() - 1)])
		else:
			th.append(float(thickness))
	var tri := Geometry2D.triangulate_polygon(outline)
	if tri.is_empty():
		return
	var mn := Vector2(INF, INF)
	var mx := Vector2(-INF, -INF)
	for q in outline:
		mn = mn.min(q)
		mx = mx.max(q)
	var sz := (mx - mn).max(Vector2(1e-4, 1e-4))
	var p := _p(mat)
	for side in [1.0, -1.0]:
		var pos := PackedVector3Array()
		for i in n:
			pos.append(Vector3(outline[i].x, outline[i].y, side * th[i] * 0.5))
		var acc := PackedVector3Array()
		acc.resize(n)
		for k in range(0, tri.size(), 3):
			var fn := (pos[tri[k + 1]] - pos[tri[k]]).cross(pos[tri[k + 2]] - pos[tri[k]])
			if fn.z * side < 0.0:
				fn = -fn
			acc[tri[k]] += fn
			acc[tri[k + 1]] += fn
			acc[tri[k + 2]] += fn
		var base := p.verts.size()
		for i in n:
			var uv := (outline[i] - mn) / sz if unit_uv else outline[i] * uv_scale
			if unit_uv:
				uv.y = 1.0 - uv.y
				if side < 0.0:
					uv.x = 1.0 - uv.x
			_v(p, pos[i], acc[i].normalized() if acc[i].length_squared() > 0 else Vector3(0, 0, side), uv)
		for k in range(0, tri.size(), 3):
			_tri(p, base + tri[k], base + tri[k + 1], base + tri[k + 2])
	var sp := _p(side_mat if side_mat != &"" else mat)
	var orient := 0.0
	for i in n:
		orient += outline[i].cross(outline[(i + 1) % n])
	var dist := 0.0
	for i in n:
		var a := outline[i]
		var b := outline[(i + 1) % n]
		var e := b - a
		var out_n := Vector2(e.y, -e.x).normalized() * (1.0 if orient < 0.0 else -1.0)
		var nrm := Vector3(out_n.x, out_n.y, 0)
		var l := e.length()
		var i0 := _v(sp, Vector3(a.x, a.y, th[i] * 0.5), nrm, Vector2(dist, th[i] * 0.5))
		var i1 := _v(sp, Vector3(b.x, b.y, th[(i + 1) % n] * 0.5), nrm, Vector2(dist + l, th[(i + 1) % n] * 0.5))
		var i2 := _v(sp, Vector3(b.x, b.y, -th[(i + 1) % n] * 0.5), nrm, Vector2(dist + l, -th[(i + 1) % n] * 0.5))
		var i3 := _v(sp, Vector3(a.x, a.y, -th[i] * 0.5), nrm, Vector2(dist, -th[i] * 0.5))
		_quad(sp, i0, i1, i2, i3)
		dist += l


# ---------------------------------------------------------------------------------------------- loft

## Skins a series of closed rings (each the same vertex count) into a smooth surface; optional flat caps.
func loft(mat: StringName, rings: Array[PackedVector3Array], cap_a := true, cap_b := true, uv_scale := Vector2.ONE,
		cap_mat: StringName = &"", unit_uv := false) -> void:
	var nr := rings.size()
	if nr < 2:
		return
	var m := rings[0].size()
	var p := _p(mat)
	var acc := PackedVector3Array()          # flat [ring * m + s]
	acc.resize(nr * m)
	for r in nr - 1:
		var ring_c := Vector3.ZERO
		for q in rings[r]:
			ring_c += q
		ring_c /= float(m)
		for s in m:
			var s2 := (s + 1) % m
			var a := rings[r][s]
			var b := rings[r][s2]
			var c := rings[r + 1][s2]
			var d := rings[r + 1][s]
			var fn := (b - a).cross(d - a)
			if fn.dot((a + b + c + d) * 0.25 - ring_c) < 0.0:
				fn = -fn
			acc[r * m + s] += fn
			acc[r * m + s2] += fn
			acc[(r + 1) * m + s] += fn
			acc[(r + 1) * m + s2] += fn
	var dist := 0.0
	var base := p.verts.size()
	for r in nr:
		if r > 0:
			var dd := 0.0
			for s in m:
				dd += rings[r][s].distance_to(rings[r - 1][s])
			dist += dd / m
		var ring_len := 0.0
		for s in m:
			ring_len += rings[r][s].distance_to(rings[r][(s + 1) % m])
		var perim := 0.0
		for s in m + 1:
			var q := rings[r][s % m]
			if s > 0:
				perim += q.distance_to(rings[r][s - 1])
			var nrm := acc[r * m + (s % m)]
			var uv := Vector2(perim / maxf(ring_len, 1e-6), float(r) / (nr - 1)) if unit_uv else Vector2(perim, dist) * uv_scale
			_v(p, q, nrm.normalized() if nrm.length_squared() > 0.0 else Vector3.UP, uv)
	var w := m + 1
	for r in nr - 1:
		for s in m:
			var a := base + r * w + s
			_quad(p, a, a + 1, a + w + 1, a + w)
	var cm := cap_mat if cap_mat != &"" else mat
	if cap_a:
		_ring_cap(cm, rings[0], rings[0][0] - rings[1][0])
	if cap_b:
		_ring_cap(cm, rings[nr - 1], rings[nr - 1][0] - rings[nr - 2][0])


func _ring_cap(mat: StringName, ring: PackedVector3Array, outward: Vector3) -> void:
	var p := _p(mat)
	var c := Vector3.ZERO
	for q in ring:
		c += q
	c /= float(ring.size())
	var nrm := Vector3.ZERO
	for i in ring.size():
		nrm += (ring[i] - c).cross(ring[(i + 1) % ring.size()] - c)
	nrm = nrm.normalized()
	if nrm.dot(outward) < 0.0:
		nrm = -nrm
	var ci := _v(p, c, nrm, Vector2.ZERO)
	var first := p.verts.size()
	for q in ring:
		_v(p, q, nrm, Vector2((q - c).x, (q - c).z))
	for i in ring.size():
		_tri(p, ci, first + i, first + (i + 1) % ring.size())


## Elliptical ring helper for loft(): centre, axes u/v (radii baked into their lengths), n points.
func ellipse_ring(center: Vector3, u: Vector3, v: Vector3, n := 12, squash_bottom := 0.0) -> PackedVector3Array:
	var out := PackedVector3Array()
	var ns := segs(n)
	for i in ns:
		var a := TAU * float(i) / ns
		var s := sin(a)
		if squash_bottom > 0.0 and s < 0.0:
			s *= (1.0 - squash_bottom)
		out.append(center + u * cos(a) + v * s)
	return out


# ---------------------------------------------------------------------------------------------- output

func aabb() -> AABB:
	var box := AABB()
	var first := true
	for k in parts:
		var p: Part = parts[k]
		for v in p.verts:
			if first:
				box = AABB(v, Vector3.ZERO)
				first = false
			else:
				box = box.expand(v)
	return box


## Applies a transform to everything built so far (e.g. design a tool standing up, then lay it flat).
func transform_all(t: Transform3D) -> void:
	var nb := t.basis.inverse().transposed()
	for k in parts:
		var p: Part = parts[k]
		for i in p.verts.size():
			p.verts[i] = t * p.verts[i]
			p.norms[i] = (nb * p.norms[i]).normalized()


## Moves everything so the model rests on y = 0 and is centred in XZ.
func recenter(ground := true) -> void:
	var b := aabb()
	var c := b.get_center()
	var off := Vector3(-c.x, -b.position.y if ground else -c.y, -c.z)
	for k in parts:
		var p: Part = parts[k]
		for i in p.verts.size():
			p.verts[i] += off


func triangle_count() -> int:
	var t := 0
	for k in parts:
		t += floori((parts[k] as Part).idx.size() / 3.0)
	return t


## One surface per material. with_materials=false only names surfaces (geometry export).
func commit(with_materials := true) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	for k in parts:
		var p: Part = parts[k]
		if p.idx.is_empty():
			continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = p.verts
		arr[Mesh.ARRAY_NORMAL] = p.norms
		arr[Mesh.ARRAY_TEX_UV] = p.uvs
		arr[Mesh.ARRAY_INDEX] = p.idx
		var st := SurfaceTool.new()
		st.create_from_arrays(arr)
		st.generate_tangents()
		var out := st.commit_to_arrays()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, out)
		var si := mesh.get_surface_count() - 1
		mesh.surface_set_name(si, String(k))
		mesh.surface_set_material(si, ItemMaterials.get_material(k) if with_materials else ItemMaterials.placeholder(k))
	return mesh

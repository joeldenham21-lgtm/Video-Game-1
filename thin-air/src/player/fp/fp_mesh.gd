class_name FPMesh
extends RefCounted
## Procedural mesh builder for first-person models: lofted tubes (parallel-transport frames, elliptical or
## superelliptical sections, rounded ends), parametric blade slabs (tapering to a sharp edge) and simple
## boxes. Accumulates one surface; `commit()` adds it (with tangents) to an ArrayMesh.
## Vertex COLOR.r is a free mask channel (honed steel edge, char…) read by the viewmodel shader.

var verts := PackedVector3Array()
var normals := PackedVector3Array()
var uvs := PackedVector2Array()
var colors := PackedColorArray()
var indices := PackedInt32Array()
## Colour written with every new vertex (mask channels).
var color := Color(0.0, 0.0, 0.0, 1.0)


func vertex_count() -> int:
	return verts.size()


func add_vertex(p: Vector3, n: Vector3, uv: Vector2) -> int:
	verts.append(p)
	normals.append(n)
	uvs.append(uv)
	colors.append(color)
	return verts.size() - 1


## Triangle with Godot's clockwise front-face winding (as seen from the side the normal points to).
func tri(a: int, b: int, c: int) -> void:
	indices.append(a)
	indices.append(c)
	indices.append(b)


## Quad a-b-c-d counter-clockwise when viewed from the front.
func quad(a: int, b: int, c: int, d: int) -> void:
	tri(a, b, c)
	tri(a, c, d)


## Applies `xf` to every vertex added since `start`.
func xform_from(start: int, xf: Transform3D) -> void:
	var nb := xf.basis.inverse().transposed()
	for i in range(start, verts.size()):
		verts[i] = xf * verts[i]
		normals[i] = (nb * normals[i]).normalized()


## Mirrors everything added since `start` across the YZ plane (x → −x), fixing winding.
func mirror_x_from(start: int, index_start: int) -> void:
	for i in range(start, verts.size()):
		var p := verts[i]
		verts[i] = Vector3(-p.x, p.y, p.z)
		var n := normals[i]
		normals[i] = Vector3(-n.x, n.y, n.z)
	var i2 := index_start
	while i2 + 2 < indices.size():
		var t := indices[i2 + 1]
		indices[i2 + 1] = indices[i2 + 2]
		indices[i2 + 2] = t
		i2 += 3


## Lofts a tube along `path`. `rx`/`ry` are per-point half-widths across B (side) and N (reference "up").
## `exponent` 2 = ellipse, higher = rounded rectangle. Rings use parallel transport, starting from `up`.
## `v_scale` maps arc length to V. Caps are flat fans (use rounded radius profiles for domes instead).
func loft(path: PackedVector3Array, rx: PackedFloat32Array, ry: PackedFloat32Array, sides := 12,
		up := Vector3.UP, v_scale := 1.0, cap_start := false, cap_end := false, exponent := 2.0,
		u_offset := 0.0) -> void:
	var count := path.size()
	if count < 2:
		return
	# Arc length.
	var s := PackedFloat32Array()
	s.resize(count)
	s[0] = 0.0
	for i in range(1, count):
		s[i] = s[i - 1] + path[i].distance_to(path[i - 1])
	# Frames.
	var tangents := PackedVector3Array()
	tangents.resize(count)
	for i in count:
		var a := path[maxi(i - 1, 0)]
		var b := path[mini(i + 1, count - 1)]
		var t := b - a
		tangents[i] = t.normalized() if t.length_squared() > 1e-12 else Vector3.FORWARD
	var nrm := PackedVector3Array()
	nrm.resize(count)
	var n0 := up - tangents[0] * up.dot(tangents[0])
	if n0.length_squared() < 1e-8:
		n0 = Vector3.RIGHT - tangents[0] * tangents[0].x
	nrm[0] = n0.normalized()
	for i in range(1, count):
		var t0 := tangents[i - 1]
		var t1 := tangents[i]
		var axis := t0.cross(t1)
		var n := nrm[i - 1]
		if axis.length_squared() > 1e-10:
			var ang := acos(clampf(t0.dot(t1), -1.0, 1.0))
			n = n.rotated(axis.normalized(), ang)
		n = (n - t1 * n.dot(t1)).normalized()
		nrm[i] = n
	var base := verts.size()
	var e := maxf(exponent, 0.5)
	for i in count:
		var t := tangents[i]
		var n := nrm[i]
		var b := t.cross(n).normalized()
		var r_a := rx[i]
		var r_b := ry[i]
		# Radius slope for taper-correct normals.
		var i0 := maxi(i - 1, 0)
		var i1 := mini(i + 1, count - 1)
		var ds := maxf(s[i1] - s[i0], 1e-6)
		var slope := ((rx[i1] + ry[i1]) - (rx[i0] + ry[i0])) * 0.5 / ds
		for j in sides + 1:
			var th := TAU * float(j) / float(sides)
			var c := cos(th)
			var sn := sin(th)
			var cx := signf(c) * pow(absf(c), 2.0 / e)
			var sy := signf(sn) * pow(absf(sn), 2.0 / e)
			var p := path[i] + b * (cx * r_a) + n * (sy * r_b)
			# Implicit-surface gradient for the superellipse.
			var gx := signf(cx) * pow(absf(cx), e - 1.0) / maxf(r_a, 1e-5)
			var gy := signf(sy) * pow(absf(sy), e - 1.0) / maxf(r_b, 1e-5)
			var radial := (b * gx + n * gy)
			if radial.length_squared() < 1e-12:
				radial = b * c + n * sn
			radial = radial.normalized()
			var nn := (radial - t * slope).normalized()
			add_vertex(p, nn, Vector2(u_offset + float(j) / float(sides), s[i] * v_scale))
	var ring := sides + 1
	for i in count - 1:
		for j in sides:
			var a := base + i * ring + j
			var b2 := a + 1
			var c2 := a + ring + 1
			var d := a + ring
			quad(a, d, c2, b2)
	if cap_start:
		_cap(base, sides, path[0], -tangents[0], false)
	if cap_end:
		_cap(base + (count - 1) * ring, sides, path[count - 1], tangents[count - 1], true)


func _cap(ring_start: int, sides: int, center: Vector3, n: Vector3, is_end: bool) -> void:
	var c := add_vertex(center, n, Vector2(0.5, 0.5))
	var first := verts.size()
	for j in sides + 1:
		var p := verts[ring_start + j]
		var d := p - center
		add_vertex(p, n, Vector2(0.5 + d.x * 4.0, 0.5 + d.z * 4.0))
	for j in sides:
		if is_end:
			tri(c, first + j + 1, first + j)
		else:
			tri(c, first + j, first + j + 1)


## Lofts a Tube (see below).
func tube(t: Tube, sides := 12, up := Vector3.UP, v_scale := 1.0, cap_start := false, cap_end := false,
		exponent := 2.0) -> void:
	loft(t.path, t.rx, t.ry, sides, up, v_scale, cap_start, cap_end, exponent)


## A path with per-point radii, built fluently, with optional rounded (domed) ends.
class Tube extends RefCounted:
	var path := PackedVector3Array()
	var rx := PackedFloat32Array()
	var ry := PackedFloat32Array()

	func add(p: Vector3, a: float, b := -1.0) -> Tube:
		path.append(p)
		rx.append(a)
		ry.append(a if b < 0.0 else b)
		return self

	## Replaces the flat end with a dome of `segments` rings (length_scale < 1 flattens it).
	func dome_end(segments := 4, length_scale := 1.0) -> Tube:
		_dome(true, segments, length_scale)
		return self

	func dome_start(segments := 4, length_scale := 1.0) -> Tube:
		_dome(false, segments, length_scale)
		return self

	func _dome(at_end: bool, segments: int, length_scale: float) -> void:
		var count := path.size()
		if count < 2:
			return
		var i_end := count - 1 if at_end else 0
		var i_in := count - 2 if at_end else 1
		var dir := (path[i_end] - path[i_in]).normalized()
		var p0 := path[i_end]
		var ra := rx[i_end]
		var rb := ry[i_end]
		var r := (ra + rb) * 0.5 * length_scale
		for k in range(1, segments + 1):
			var phi := float(k) / float(segments) * PI * 0.5
			var f := cos(phi)
			var p := p0 + dir * (sin(phi) * r)
			var fa := maxf(ra * f, 0.0003)
			var fb := maxf(rb * f, 0.0003)
			if at_end:
				path.append(p)
				rx.append(fa)
				ry.append(fb)
			else:
				path.insert(0, p)
				rx.insert(0, fa)
				ry.insert(0, fb)


## Parametric slab: `shape(u, v) -> Vector2` gives the outline in XY, `thick(u, v) -> float` the half
## thickness (0 = sharp edge). Front at +z, back at −z. `mask(u, v) -> float` goes into COLOR.r.
## `walls`: bitmask 1 = u0 side, 2 = u1 side, 4 = v0 side, 8 = v1 side.
func slab(shape: Callable, thick: Callable, nu: int, nv: int, uv_scale: Vector2, mask: Callable, walls := 15) -> void:
	var eps := 0.001
	for side in 2:
		var sz := 1.0 if side == 0 else -1.0
		var base := verts.size()
		for i in nu + 1:
			var u := float(i) / float(nu)
			for j in nv + 1:
				var v := float(j) / float(nv)
				var p := _slab_point(shape, thick, u, v, sz)
				var du := _slab_point(shape, thick, minf(u + eps, 1.0), v, sz) - _slab_point(shape, thick, maxf(u - eps, 0.0), v, sz)
				var dv := _slab_point(shape, thick, u, minf(v + eps, 1.0), sz) - _slab_point(shape, thick, u, maxf(v - eps, 0.0), sz)
				var n := du.cross(dv).normalized() * sz
				if n.z * sz < 0.0:
					n = -n
				color = Color(float(mask.call(u, v)), 0.0, 0.0, 1.0)
				add_vertex(p, n, Vector2(p.x, p.y) * uv_scale)
		for i in nu:
			for j in nv:
				var a := base + i * (nv + 1) + j
				var b := a + (nv + 1)
				var c := b + 1
				var d := a + 1
				if side == 0:
					quad(a, b, c, d)
				else:
					quad(a, d, c, b)
	# Side walls.
	if walls & 1:
		_slab_wall(shape, thick, mask, uv_scale, nv, false, 0.0)
	if walls & 2:
		_slab_wall(shape, thick, mask, uv_scale, nv, false, 1.0)
	if walls & 4:
		_slab_wall(shape, thick, mask, uv_scale, nu, true, 0.0)
	if walls & 8:
		_slab_wall(shape, thick, mask, uv_scale, nu, true, 1.0)
	color = Color(0.0, 0.0, 0.0, 1.0)


static func _slab_point(shape: Callable, thick: Callable, u: float, v: float, sz: float) -> Vector3:
	var q: Vector2 = shape.call(u, v)
	return Vector3(q.x, q.y, float(thick.call(u, v)) * sz)


func _slab_wall(shape: Callable, thick: Callable, mask: Callable, uv_scale: Vector2, n: int, along_u: bool, fixed: float) -> void:
	var base := verts.size()
	for k in n + 1:
		var t := float(k) / float(n)
		var u := t if along_u else fixed
		var v := fixed if along_u else t
		var q: Vector2 = shape.call(u, v)
		var th := float(thick.call(u, v))
		# Outward in-plane normal from the boundary tangent.
		var t2 := minf(t + 0.01, 1.0)
		var t1 := maxf(t - 0.01, 0.0)
		var qa: Vector2 = shape.call(t2 if along_u else fixed, fixed if along_u else t2)
		var qb: Vector2 = shape.call(t1 if along_u else fixed, fixed if along_u else t1)
		var tan2 := (qa - qb).normalized()
		var out := Vector2(tan2.y, -tan2.x)
		# Pick the side pointing away from the slab centre.
		var mid: Vector2 = shape.call(0.5, 0.5)
		if out.dot(q - mid) < 0.0:
			out = -out
		var nn := Vector3(out.x, out.y, 0.0)
		color = Color(float(mask.call(u, v)), 0.0, 0.0, 1.0)
		add_vertex(Vector3(q.x, q.y, th), nn, Vector2(t * 0.1, th) * uv_scale)
		add_vertex(Vector3(q.x, q.y, -th), nn, Vector2(t * 0.1, -th) * uv_scale)
	for k in n:
		var a := base + k * 2
		var b := a + 2
		# Orientation depends on which way the boundary runs; test against the normal.
		var p0 := verts[a]
		var p1 := verts[b]
		var p2 := verts[a + 1]
		var face_n := (p1 - p0).cross(p2 - p0)
		if face_n.dot(normals[a]) > 0.0:
			quad(a, a + 1, b + 1, b)
		else:
			quad(a, b, b + 1, a + 1)


## Axis-aligned box centred at `c` (for small hardware parts), with per-face UVs.
func box(c: Vector3, size: Vector3, uv_scale := 1.0) -> void:
	var h := size * 0.5
	var faces := [
		[Vector3.RIGHT, Vector3.UP, Vector3.BACK], [Vector3.LEFT, Vector3.UP, Vector3.FORWARD],
		[Vector3.UP, Vector3.BACK, Vector3.RIGHT], [Vector3.DOWN, Vector3.FORWARD, Vector3.RIGHT],
		[Vector3.BACK, Vector3.UP, Vector3.LEFT], [Vector3.FORWARD, Vector3.UP, Vector3.RIGHT],
	]
	for f in faces:
		var n: Vector3 = f[0]
		var up: Vector3 = f[1]
		var right: Vector3 = f[2]
		var center := c + n * (h * n.abs()).length()
		var ue := right * (h * right.abs()).length()
		var ve := up * (h * up.abs()).length()
		var a := add_vertex(center - ue - ve, n, Vector2(0, 1) * uv_scale)
		var b := add_vertex(center + ue - ve, n, Vector2(1, 1) * uv_scale)
		var cc := add_vertex(center + ue + ve, n, Vector2(1, 0) * uv_scale)
		var d := add_vertex(center - ue + ve, n, Vector2(0, 0) * uv_scale)
		quad(a, b, cc, d)


## Adds the accumulated geometry as a new surface of `mesh` (with tangents) and clears the builder.
func commit(mesh: ArrayMesh, material: Material) -> void:
	if verts.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var st := SurfaceTool.new()
	st.create_from_arrays(arrays)
	st.generate_tangents()
	st.set_material(material)
	st.commit(mesh)
	clear()


func clear() -> void:
	verts = PackedVector3Array()
	normals = PackedVector3Array()
	uvs = PackedVector2Array()
	colors = PackedColorArray()
	indices = PackedInt32Array()
	color = Color(0.0, 0.0, 0.0, 1.0)


# ---- Path helpers -------------------------------------------------------------------------------

## Straight path from a to b with `n` segments.
static func line(a: Vector3, b: Vector3, n: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in n + 1:
		out.append(a.lerp(b, float(i) / float(n)))
	return out


## Samples a Curve-like radius profile: `pts` are [t, r] pairs (t 0..1), linearly interpolated.
static func profile(pts: Array, count: int, scale := 1.0) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for i in count:
		var t := float(i) / float(maxi(count - 1, 1))
		var r := float(pts[0][1])
		for k in pts.size() - 1:
			var a: Array = pts[k]
			var b: Array = pts[k + 1]
			if t >= float(a[0]) and t <= float(b[0]):
				var f := (t - float(a[0])) / maxf(float(b[0]) - float(a[0]), 1e-6)
				f = f * f * (3.0 - 2.0 * f)
				r = lerpf(float(a[1]), float(b[1]), f)
				break
			if t > float(b[0]):
				r = float(b[1])
		out.append(r * scale)
	return out

class_name FPModels
extends RefCounted
## Procedural first-person models with real-world proportions and PBR materials. Every builder returns an
## ArrayMesh (cached per variant); `world = true` builds the same geometry with in-world materials
## (thrown spears, arrows, flares). External art overrides: assets/models/fp/<item_id>.glb is used
## instead when present (authored in the same model space: handle along +Y, blade toward −Z).

const EXTERNAL_DIR := "res://assets/models/fp/"

static var _cache: Dictionary = {}


static func _mat(kind: StringName, world: bool) -> Material:
	return FPMaterials.world(kind) if world else FPMaterials.vm(kind)


static func _cached(key: String) -> ArrayMesh:
	return _cache.get(key, null)


## Loads assets/models/fp/<id>.glb if it exists, converting materials to the viewmodel shader.
static func external(id: StringName) -> Node3D:
	var path := EXTERNAL_DIR + String(id) + ".glb"
	if not ResourceLoader.exists(path):
		return null
	var ps := load(path) as PackedScene
	if ps == null:
		return null
	var root := ps.instantiate() as Node3D
	_convert_tree(root)
	return root


static func _convert_tree(n: Node) -> void:
	var mi := n as MeshInstance3D
	if mi and mi.mesh:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s)
			if m is BaseMaterial3D:
				mi.set_surface_override_material(s, FPMaterials.convert_standard(m as BaseMaterial3D))
	for c in n.get_children():
		_convert_tree(c)


# =================================================================================================
# Axes, hammer, pick
# =================================================================================================

## Handle along +Y from the butt (y = 0). Oval section: deeper toward the blade (−Z) than wide.
static func _handle(b: FPMesh, length: float, depth: float, width: float, curve: float, knob := true) -> void:
	var t := FPMesh.Tube.new()
	var n := 14
	for i in n + 1:
		var f := float(i) / float(n)
		var y := f * length
		# Gentle S-curve and the flared "fawn foot" at the butt.
		var z := sin(f * PI) * curve - (0.012 * (1.0 - smoothstep(0.0, 0.12, f)) if knob else 0.0)
		var swell := (1.0 - smoothstep(0.0, 0.1, f)) * 0.35 if knob else 0.0
		var neck := 1.0 - 0.12 * smoothstep(0.55, 0.85, f) + 0.1 * smoothstep(0.88, 1.0, f)
		t.add(Vector3(0.0, y, z), width * (1.0 + swell * 0.6) * neck, depth * (1.0 + swell) * neck)
	t.dome_start(2, 0.35)
	b.tube(t, 14, Vector3.FORWARD, 2.2, false, true, 2.2)


static func axe_mesh(variant: StringName, world := false) -> ArrayMesh:
	var key := "axe_%s_%s" % [variant, world]
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var length := 0.4
	match variant:
		&"felling_axe":
			length = 0.78
		&"stone_axe":
			length = 0.5
		&"hammer":
			length = 0.33
		&"pickaxe":
			length = 0.72
	# --- Handle
	if variant == &"stone_axe":
		# A split branch, slightly crooked, bark-stripped.
		var t := FPMesh.Tube.new()
		for i in 13:
			var f := float(i) / 12.0
			t.add(Vector3(sin(f * 7.0) * 0.004, f * length, sin(f * 4.0 + 1.0) * 0.006), 0.0145 - f * 0.002, 0.0155 - f * 0.002)
		t.dome_start(2, 0.4)
		t.dome_end(2, 0.4)
		b.tube(t, 12, Vector3.FORWARD, 2.0, false, false, 2.0)
		b.commit(mesh, _mat(&"wood_raw", world))
	else:
		var depth := 0.0165 if variant != &"felling_axe" else 0.019
		var width := 0.0115 if variant != &"felling_axe" else 0.0135
		_handle(b, length, depth, width, 0.01 if variant != &"hammer" else 0.004)
		b.commit(mesh, _mat(&"wood_ash", world))
	# --- Head
	var head_y := length - 0.03
	match variant:
		&"hatchet":
			_hatchet_head(b, head_y)
			b.commit(mesh, _mat(&"steel", world))
		&"felling_axe":
			_felling_head(b, head_y)
			b.commit(mesh, _mat(&"steel", world))
		&"stone_axe":
			_stone_head(b, head_y - 0.04)
			b.commit(mesh, _mat(&"stone", world))
			_lashing(b, head_y - 0.04, 0.016)
			b.commit(mesh, _mat(&"cord", world))
		&"hammer":
			_hammer_head(b, head_y + 0.005)
			b.commit(mesh, _mat(&"steel_blued", world))
		&"pickaxe":
			_pick_head(b, head_y)
			b.commit(mesh, _mat(&"steel", world))
		_:
			_hatchet_head(b, head_y)
			b.commit(mesh, _mat(&"steel", world))
	_cache[key] = mesh
	return mesh


## Slab-space → model-space for axe heads: slab X (bit direction) → −Z, slab Y → +Y, thickness → X.
static func _head_xform(y: float) -> Transform3D:
	return Transform3D(Basis(Vector3(0, 0, -1), Vector3(0, 1, 0), Vector3(1, 0, 0)), Vector3(0.0, y, 0.0))


static func _hatchet_head(b: FPMesh, y: float) -> void:
	var start := b.vertex_count()
	var poll := -0.036
	var bit := 0.104
	var shape := func(u: float, v: float) -> Vector2:
		var x := lerpf(poll, bit, u)
		var top := 0.021 + 0.013 * smoothstep(0.35, 1.0, u)
		var bottom := -0.021 + 0.004 * smoothstep(0.2, 0.45, u) - 0.045 * pow(smoothstep(0.42, 1.0, u), 1.6)
		var yy := lerpf(bottom, top, v)
		# Convex cutting edge.
		var bow := 1.0 - pow(2.0 * v - 1.0, 2.0)
		x += 0.009 * bow * smoothstep(0.85, 1.0, u)
		return Vector2(x, yy)
	var thick := func(u: float, v: float) -> float:
		var cheek := 0.0165 * (1.0 - smoothstep(0.28, 1.0, u)) + 0.0006
		var hone := 1.0 - 0.55 * smoothstep(0.9, 1.0, u)
		var round_top := 1.0 - 0.25 * pow(absf(2.0 * v - 1.0), 6.0)
		return cheek * hone * round_top
	var mask := func(u: float, _v: float) -> float:
		return smoothstep(0.86, 0.97, u)
	b.slab(shape, thick, 22, 8, Vector2.ONE, mask, 13)
	b.xform_from(start, _head_xform(y))


static func _felling_head(b: FPMesh, y: float) -> void:
	var start := b.vertex_count()
	var shape := func(u: float, v: float) -> Vector2:
		var x := lerpf(-0.05, 0.135, u)
		var h := 0.026 + 0.03 * pow(smoothstep(0.3, 1.0, u), 1.3)
		var yy := lerpf(-h, h, v)
		var bow := 1.0 - pow(2.0 * v - 1.0, 2.0)
		x += 0.012 * bow * smoothstep(0.85, 1.0, u)
		return Vector2(x, yy)
	var thick := func(u: float, v: float) -> float:
		var cheek := 0.02 * (1.0 - smoothstep(0.25, 1.0, u)) + 0.0006
		var hone := 1.0 - 0.55 * smoothstep(0.9, 1.0, u)
		return cheek * hone * (1.0 - 0.2 * pow(absf(2.0 * v - 1.0), 6.0))
	var mask := func(u: float, _v: float) -> float:
		return smoothstep(0.86, 0.97, u)
	b.slab(shape, thick, 24, 8, Vector2.ONE, mask, 13)
	b.xform_from(start, _head_xform(y))


static func _stone_head(b: FPMesh, y: float) -> void:
	var start := b.vertex_count()
	var shape := func(u: float, v: float) -> Vector2:
		var x := lerpf(-0.025, 0.085, u)
		var h := 0.026 + 0.012 * sin(u * PI) + 0.004 * sin(u * 17.0 + v * 5.0)
		var yy := lerpf(-h, h, v)
		var bow := 1.0 - pow(2.0 * v - 1.0, 2.0)
		x += 0.012 * bow * smoothstep(0.7, 1.0, u) + 0.002 * sin(v * 23.0)
		return Vector2(x, yy)
	var thick := func(u: float, v: float) -> float:
		var t := 0.019 * (1.0 - smoothstep(0.35, 1.0, u)) + 0.0025
		return t * (1.0 - 0.35 * pow(absf(2.0 * v - 1.0), 3.0)) * (1.0 + 0.08 * sin(u * 29.0 + v * 13.0))
	var mask := func(u: float, v: float) -> float:
		return smoothstep(0.75, 0.95, u) * (0.6 + 0.4 * sin(v * 31.0))
	b.slab(shape, thick, 16, 8, Vector2.ONE, mask, 15)
	b.xform_from(start, _head_xform(y))


static func _lashing(b: FPMesh, y: float, r: float) -> void:
	# Crossed wraps of cordage binding the head into the split handle.
	for k in 5:
		var t := FPMesh.Tube.new()
		var yy := y - 0.035 + k * 0.016
		var tilt := (0.25 if k % 2 == 0 else -0.25)
		for i in 17:
			var a := float(i) / 16.0 * TAU
			var p := Vector3(cos(a) * (r + 0.0035), yy + sin(a) * tilt * 0.02, sin(a) * (r + 0.004) * 1.25)
			t.add(p, 0.0026)
		b.tube(t, 6, Vector3.UP, 40.0, false, false)
	# Wraps over the head as well.
	for k in 3:
		var t2 := FPMesh.Tube.new()
		var zz := -0.02 - k * 0.012
		for i in 17:
			var a := float(i) / 16.0 * TAU
			t2.add(Vector3(cos(a) * 0.024, y + sin(a) * 0.03, zz), 0.0024)
		b.tube(t2, 6, Vector3.FORWARD, 40.0, false, false)


static func _hammer_head(b: FPMesh, y: float) -> void:
	# Face toward −Z, claw toward +Z.
	var t := FPMesh.Tube.new()
	t.add(Vector3(0.0, y, -0.058), 0.0135, 0.0135)
	t.add(Vector3(0.0, y, -0.05), 0.015, 0.015)
	t.add(Vector3(0.0, y, -0.035), 0.0125, 0.0125)
	t.add(Vector3(0.0, y, 0.0), 0.012, 0.016)
	t.add(Vector3(0.0, y + 0.004, 0.025), 0.009, 0.011)
	t.add(Vector3(0.0, y - 0.004, 0.05), 0.006, 0.005)
	t.add(Vector3(0.0, y - 0.016, 0.07), 0.004, 0.002)
	b.tube(t, 14, Vector3.UP, 8.0, true, false, 3.0)


static func _pick_head(b: FPMesh, y: float) -> void:
	var t := FPMesh.Tube.new()
	for i in 17:
		var f := float(i) / 16.0
		var x := lerpf(-0.24, 0.2, f)
		var yy := y - 0.05 * pow(absf(x) / 0.24, 2.0)
		var r := 0.017 * (1.0 - pow(absf(f - 0.55) / 0.55, 1.5)) + 0.002
		t.add(Vector3(0.0, yy, x), r * 0.8, r)
	b.tube(t, 10, Vector3.UP, 6.0, true, true, 2.4)


# =================================================================================================
# Blades
# =================================================================================================

## Knife along −Z (tip forward), handle toward +Z, edge down (−Y).
static func knife_mesh(variant: StringName, world := false) -> ArrayMesh:
	var key := "knife_%s_%s" % [variant, world]
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var stone := variant == &"stone_knife"
	var blade_len := 0.105 if not stone else 0.09
	# Blade.
	var start := b.vertex_count()
	var shape := func(u: float, v: float) -> Vector2:
		var x := u * blade_len
		var spine := 0.011 - 0.011 * pow(smoothstep(0.62, 1.0, u), 1.4)
		var edge := -0.011 + 0.0105 * pow(smoothstep(0.45, 1.0, u), 2.2)
		if stone:
			spine = 0.012 * (1.0 - pow(u, 2.2)) + 0.001 * sin(u * 25.0)
			edge = -0.012 * (1.0 - pow(u, 1.6)) + 0.0012 * sin(u * 31.0)
		return Vector2(x, lerpf(edge, spine, v))
	var thick := func(u: float, v: float) -> float:
		var t := (0.0016 if not stone else 0.004) * pow(v, 0.85) * (1.0 - 0.6 * pow(u, 5.0))
		return t + 0.0002
	var mask := func(_u: float, v: float) -> float:
		return 1.0 - smoothstep(0.0, 0.16, v)
	b.slab(shape, thick, 18, 6, Vector2.ONE, mask, 13)
	b.xform_from(start, Transform3D(Basis(Vector3(0, 0, -1), Vector3(0, 1, 0), Vector3(1, 0, 0)), Vector3.ZERO))
	b.commit(mesh, _mat(&"stone" if stone else &"steel", world))
	# Guard (steel) — omitted on the stone knife.
	if not stone:
		b.box(Vector3(0.0, -0.001, 0.003), Vector3(0.012, 0.03, 0.006), 0.05)
		b.commit(mesh, _mat(&"steel_blued", world))
	# Handle.
	var h := FPMesh.Tube.new()
	for i in 11:
		var f := float(i) / 10.0
		var z := 0.006 + f * 0.108
		var swell := sin(f * PI) * 0.0025
		var pommel := smoothstep(0.85, 1.0, f) * 0.0015
		h.add(Vector3(0.0, -0.001 - sin(f * PI) * 0.0015, z), 0.0085 + swell * 0.6 + pommel, 0.0115 + swell + pommel)
	h.dome_end(3, 0.5)
	b.tube(h, 14, Vector3.UP, 4.0, true, false, 2.8)
	b.commit(mesh, _mat(&"cord" if stone else &"wood_dark", world))
	_cache[key] = mesh
	return mesh


# =================================================================================================
# Spear, bow, arrow
# =================================================================================================

## Spear along −Z: point at z = −length·0.62, butt behind.
static func spear_mesh(world := false) -> ArrayMesh:
	var key := "spear_%s" % world
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var fwd := 1.15
	var back := 0.75
	var t := FPMesh.Tube.new()
	for i in 21:
		var f := float(i) / 20.0
		var z := lerpf(back, -fwd, f)
		t.add(Vector3(sin(f * 9.0) * 0.002, sin(f * 5.0) * 0.002, z), 0.0145 - f * 0.002)
	t.dome_start(2, 0.5)
	b.tube(t, 12, Vector3.UP, 1.5, false, true, 2.0)
	b.commit(mesh, _mat(&"wood_raw", world))
	# Knapped stone point.
	var start := b.vertex_count()
	var shape := func(u: float, v: float) -> Vector2:
		var x := u * 0.15
		var w := 0.022 * sin(pow(u, 0.7) * PI) * (1.0 - 0.3 * u) + 0.0015 * sin(u * 30.0 + v * 7.0)
		return Vector2(x, lerpf(-w, w, v))
	var thick := func(u: float, v: float) -> float:
		return (0.0065 * (1.0 - absf(2.0 * v - 1.0)) * sin(pow(u, 0.6) * PI * 0.95) + 0.0006)
	var mask := func(_u: float, v: float) -> float:
		return smoothstep(0.7, 1.0, absf(2.0 * v - 1.0))
	b.slab(shape, thick, 16, 8, Vector2.ONE, mask, 15)
	b.xform_from(start, Transform3D(Basis(Vector3(0, 0, -1), Vector3(0, 1, 0), Vector3(1, 0, 0)), Vector3(0.0, 0.0, -fwd + 0.045)))
	b.commit(mesh, _mat(&"stone", world))
	# Lashing.
	for k in 6:
		var w := FPMesh.Tube.new()
		var zz := -fwd + 0.04 + k * 0.011
		for i in 13:
			var a := float(i) / 12.0 * TAU
			w.add(Vector3(cos(a) * 0.0145, sin(a) * 0.0145, zz + sin(a) * 0.004), 0.0024)
		b.tube(w, 6, Vector3.FORWARD, 30.0, false, false)
	b.commit(mesh, _mat(&"cord", world))
	_cache[key] = mesh
	return mesh


const BOW_HALF := 0.64


## Self bow in the XY plane: limbs along ±Y, string on the +Z side (toward the archer).
static func bow_mesh() -> ArrayMesh:
	var key := "bow"
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var t := FPMesh.Tube.new()
	var n := 30
	for i in n + 1:
		var f := float(i) / float(n)
		var y := lerpf(-BOW_HALF, BOW_HALF, f)
		var a := absf(y) / BOW_HALF
		var z := bow_limb_z(y)
		var width := lerpf(0.017, 0.0065, pow(a, 1.3)) if a > 0.1 else 0.0155
		var thick := lerpf(0.0105, 0.0055, pow(a, 1.2)) if a > 0.1 else 0.0135
		t.add(Vector3(0.0, y, z), width, thick)
	t.dome_start(2, 0.4)
	t.dome_end(2, 0.4)
	b.tube(t, 10, Vector3.BACK, 3.0, false, false, 2.6)
	b.commit(mesh, FPMaterials.vm_unique(&"wood_dark"))
	# Leather grip wrap.
	var g := FPMesh.Tube.new()
	for i in 7:
		var f := float(i) / 6.0
		g.add(Vector3(0.0, lerpf(-0.055, 0.055, f), 0.0), 0.0175, 0.0155)
	b.tube(g, 12, Vector3.BACK, 30.0, true, true, 2.4)
	b.commit(mesh, FPMaterials.vm(&"leather_dark"))
	_cache[key] = mesh
	return mesh


## Unstrained limb curve (z offset toward the archer) at height y.
static func bow_limb_z(y: float) -> float:
	var a := absf(y) / BOW_HALF
	return 0.055 * a * a


## Arrow along −Z: tip at z = −0.72 · 0.5 … nock at +0.36.
static func arrow_mesh(world := false) -> ArrayMesh:
	var key := "arrow_%s" % world
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var t := FPMesh.Tube.new()
	t.add(Vector3(0, 0, 0.36), 0.0038)
	t.add(Vector3(0, 0, -0.33), 0.0042)
	t.add(Vector3(0, 0, -0.345), 0.0034)
	t.dome_start(1, 0.6)
	b.tube(t, 8, Vector3.UP, 1.0, false, true)
	b.commit(mesh, _mat(&"wood_dark", world))
	# Knapped head.
	var start := b.vertex_count()
	var shape := func(u: float, v: float) -> Vector2:
		var w := 0.011 * sin(pow(u, 0.75) * PI) * (1.0 - 0.35 * u)
		return Vector2(u * 0.045, lerpf(-w, w, v))
	var thick := func(u: float, v: float) -> float:
		return 0.003 * (1.0 - absf(2.0 * v - 1.0)) * sin(pow(u, 0.6) * PI * 0.95) + 0.0004
	var mask := func(_u: float, v: float) -> float:
		return smoothstep(0.6, 1.0, absf(2.0 * v - 1.0))
	b.slab(shape, thick, 10, 6, Vector2.ONE, mask, 15)
	b.xform_from(start, Transform3D(Basis(Vector3(0, 0, -1), Vector3(0, 1, 0), Vector3(1, 0, 0)), Vector3(0.0, 0.0, -0.335)))
	b.commit(mesh, _mat(&"stone", world))
	# Fletching: three vanes.
	for k in 3:
		var s2 := b.vertex_count()
		var vshape := func(u: float, v: float) -> Vector2:
			var h := 0.013 * sin(pow(u, 0.8) * PI * 0.85) + 0.002
			return Vector2(u * 0.11, v * h)
		var vthick := func(_u: float, _v: float) -> float:
			return 0.0005
		var vmask := func(_u: float, _v: float) -> float:
			return 0.0
		b.slab(vshape, vthick, 8, 2, Vector2.ONE, vmask, 15)
		var rot := Basis(Vector3(0, 0, 1), float(k) * TAU / 3.0)
		b.xform_from(s2, Transform3D(rot * Basis(Vector3(0, 0, 1), Vector3(0, 1, 0), Vector3(-1, 0, 0)), Vector3(0.0, 0.0, 0.215)).translated_local(Vector3(0.0, 0.003, 0.0)))
	b.commit(mesh, _mat(&"feather", world))
	_cache[key] = mesh
	return mesh


# =================================================================================================
# Lights
# =================================================================================================

## Torch along +Y: grip at y = 0.12, head from y ≈ 0.38 to 0.5.
static func torch_mesh(world := false) -> ArrayMesh:
	var key := "torch_%s" % world
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var t := FPMesh.Tube.new()
	for i in 11:
		var f := float(i) / 10.0
		t.add(Vector3(sin(f * 6.0) * 0.003, f * 0.47, cos(f * 5.0) * 0.003), 0.0165 - f * 0.002)
	t.dome_start(2, 0.4)
	b.tube(t, 10, Vector3.FORWARD, 2.0, false, true)
	b.commit(mesh, _mat(&"wood_raw", world))
	# Wrapped, resin-soaked cloth head: lumpy, charred toward the top (mask).
	var h := FPMesh.Tube.new()
	for i in 13:
		var f := float(i) / 12.0
		var y := 0.36 + f * 0.135
		var lump := 0.004 * sin(f * 19.0) + 0.003 * sin(f * 31.0 + 2.0)
		var r := 0.027 + 0.008 * sin(f * PI) + lump
		h.add(Vector3(0.0, y, 0.0), r, r * 0.95)
	h.dome_end(3, 0.6)
	h.dome_start(2, 0.3)
	var start := b.vertex_count()
	b.tube(h, 14, Vector3.FORWARD, 12.0, false, false)
	for i in range(start, b.vertex_count()):
		var y := b.verts[i].y
		b.colors[i] = Color(clampf((y - 0.41) / 0.07, 0.0, 1.0), 0.0, 0.0, 1.0)
	b.commit(mesh, _mat(&"cloth_torch", world))
	_cache[key] = mesh
	return mesh


## Road flare along +Y: striker cap at the top (y ≈ 0.24).
static func flare_mesh(world := false) -> ArrayMesh:
	var key := "flare_%s" % world
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var t := FPMesh.Tube.new()
	t.add(Vector3(0, 0.0, 0), 0.0135)
	t.add(Vector3(0, 0.235, 0), 0.0135)
	b.tube(t, 16, Vector3.FORWARD, 4.0, true, true)
	b.commit(mesh, _mat(&"paper_red", world))
	var c := FPMesh.Tube.new()
	c.add(Vector3(0, -0.012, 0), 0.0148)
	c.add(Vector3(0, 0.03, 0), 0.0148)
	b.tube(c, 16, Vector3.FORWARD, 8.0, true, true)
	b.commit(mesh, _mat(&"plastic_dark", world))
	_cache[key] = mesh
	return mesh


## Kerosene lantern along +Y (bail handle on top).
static func lantern_mesh() -> ArrayMesh:
	var key := "lantern"
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var fount := FPMesh.Tube.new()
	fount.add(Vector3(0, 0.0, 0), 0.05).add(Vector3(0, 0.03, 0), 0.055).add(Vector3(0, 0.05, 0), 0.045)
	b.tube(fount, 18, Vector3.FORWARD, 4.0, true, true)
	var top := FPMesh.Tube.new()
	top.add(Vector3(0, 0.17, 0), 0.042).add(Vector3(0, 0.19, 0), 0.03).add(Vector3(0, 0.205, 0), 0.012)
	b.tube(top, 18, Vector3.FORWARD, 4.0, true, true)
	for k in 4:
		var a := float(k) / 4.0 * TAU + 0.4
		var wire := FPMesh.Tube.new()
		wire.add(Vector3(cos(a) * 0.046, 0.045, sin(a) * 0.046), 0.0025).add(Vector3(cos(a) * 0.044, 0.172, sin(a) * 0.044), 0.0025)
		b.tube(wire, 6, Vector3.FORWARD, 10.0)
	var bail := FPMesh.Tube.new()
	for i in 13:
		var a := float(i) / 12.0 * PI
		bail.add(Vector3(cos(a) * 0.05, 0.2 + sin(a) * 0.05, 0.0), 0.0022)
	b.tube(bail, 6, Vector3.FORWARD, 10.0)
	b.commit(mesh, FPMaterials.vm(&"steel_blued"))
	var glass := FPMesh.Tube.new()
	glass.add(Vector3(0, 0.05, 0), 0.036).add(Vector3(0, 0.11, 0), 0.042).add(Vector3(0, 0.17, 0), 0.034)
	b.tube(glass, 18, Vector3.FORWARD, 4.0)
	b.commit(mesh, FPMaterials.vm(&"glass_dark"))
	_cache[key] = mesh
	return mesh


# =================================================================================================
# Ice axe
# =================================================================================================

## Classic straight mountaineering axe along +Y: spike at y = 0, head at y ≈ 0.56. Pick toward −Z.
static func ice_axe_mesh(world := false) -> ArrayMesh:
	var key := "ice_axe_%s" % world
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var length := 0.56
	var t := FPMesh.Tube.new()
	for i in 9:
		var f := float(i) / 8.0
		t.add(Vector3(0.0, 0.03 + f * (length - 0.03), 0.0), 0.0105, 0.0145)
	b.tube(t, 14, Vector3.FORWARD, 2.0, false, false, 2.3)
	b.commit(mesh, _mat(&"aluminium_blue", world))
	# Rubber grip over the lower shaft.
	var g := FPMesh.Tube.new()
	for i in 7:
		var f := float(i) / 6.0
		g.add(Vector3(0.0, 0.035 + f * 0.13, 0.0), 0.0118 + sin(f * PI) * 0.0008, 0.0158 + sin(f * PI) * 0.0008)
	g.dome_start(1, 0.3)
	g.dome_end(1, 0.3)
	b.tube(g, 14, Vector3.FORWARD, 8.0, false, false, 2.3)
	b.commit(mesh, _mat(&"rubber", world))
	# Spike + ferrule.
	var s := FPMesh.Tube.new()
	s.add(Vector3(0, 0.04, 0), 0.0112, 0.0152).add(Vector3(0, 0.012, 0), 0.0095, 0.012).add(Vector3(0, -0.035, 0), 0.0012, 0.0012)
	b.tube(s, 12, Vector3.FORWARD, 8.0, false, false, 2.2)
	# Head: pick (drooped, toothed) toward −Z, adze toward +Z.
	var hy := length - 0.012
	var start := b.vertex_count()
	var pick_shape := func(u: float, v: float) -> Vector2:
		var x := lerpf(-0.012, 0.155, u)
		var droop := -0.04 * pow(u, 1.8)
		var top := 0.014 - 0.012 * pow(u, 1.2) + droop
		var bottom := -0.016 + 0.014 * pow(u, 1.1) + droop
		# Teeth along the underside of the outer half.
		if u > 0.45:
			bottom += 0.0035 * maxf(sin(u * 70.0), 0.0) * smoothstep(0.45, 0.6, u)
		return Vector2(x, lerpf(bottom, top, v))
	var pick_thick := func(u: float, _v: float) -> float:
		return 0.0048 * (1.0 - 0.55 * u) + 0.0004
	var pick_mask := func(u: float, v: float) -> float:
		return smoothstep(0.85, 1.0, u) + (1.0 - smoothstep(0.0, 0.25, v)) * smoothstep(0.4, 0.6, u) * 0.6
	b.slab(pick_shape, pick_thick, 18, 5, Vector2.ONE, pick_mask, 15)
	b.xform_from(start, _head_xform(hy))
	start = b.vertex_count()
	var adze_shape := func(u: float, v: float) -> Vector2:
		var x := lerpf(-0.012, 0.075, u)
		var w := 0.01 + 0.012 * u
		return Vector2(x, lerpf(-w, w, v))
	var adze_thick := func(u: float, _v: float) -> float:
		return 0.0055 * (1.0 - smoothstep(0.5, 1.0, u)) + 0.0005
	var adze_mask := func(u: float, _v: float) -> float:
		return smoothstep(0.85, 1.0, u)
	b.slab(adze_shape, adze_thick, 12, 5, Vector2.ONE, adze_mask, 15)
	# Adze blade lies flat (perpendicular to the pick), pointing +Z and slightly drooped.
	b.xform_from(start, Transform3D(Basis(Vector3(0, -0.2, 1).normalized(), Vector3(1, 0, 0), Vector3(0, 1, 0.2).normalized()), Vector3(0.0, hy + 0.004, 0.0)))
	b.box(Vector3(0.0, hy + 0.002, 0.0), Vector3(0.018, 0.04, 0.03), 0.1)
	b.commit(mesh, _mat(&"steel", world))
	_cache[key] = mesh
	return mesh


# =================================================================================================
# Devices
# =================================================================================================

## Survey scanner body along +Y; screen on +Z (toward the user); sensor window at the top front (−Z).
static func scanner_mesh() -> Dictionary:
	var key := "scanner"
	if _cache.has(key):
		return _cache[key]
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var body := FPMesh.Tube.new()
	body.add(Vector3(0, 0.0, 0), 0.041, 0.017).add(Vector3(0, 0.02, 0), 0.046, 0.019).add(Vector3(0, 0.15, 0), 0.046, 0.019).add(Vector3(0, 0.168, -0.003), 0.043, 0.02)
	body.dome_start(2, 0.3)
	body.dome_end(2, 0.35)
	b.tube(body, 20, Vector3.BACK, 8.0, false, false, 4.0)
	b.commit(mesh, FPMaterials.vm(&"plastic_yellow"))
	# Rubber bumpers + grip band.
	var band := FPMesh.Tube.new()
	band.add(Vector3(0, 0.012, 0), 0.0485, 0.0205).add(Vector3(0, 0.055, 0), 0.0485, 0.0205)
	b.tube(band, 20, Vector3.BACK, 8.0, true, true, 4.0)
	var top := FPMesh.Tube.new()
	top.add(Vector3(0, 0.135, 0), 0.0482, 0.0207).add(Vector3(0, 0.16, -0.002), 0.046, 0.021)
	b.tube(top, 20, Vector3.BACK, 8.0, true, true, 4.0)
	# Stub antenna.
	var ant := FPMesh.Tube.new()
	ant.add(Vector3(0.03, 0.16, -0.004), 0.0055).add(Vector3(0.03, 0.215, -0.004), 0.004).dome_end(2)
	b.tube(ant, 10, Vector3.BACK, 8.0, true, false)
	b.commit(mesh, FPMaterials.vm(&"rubber"))
	# Sensor window on the front face.
	var lens := FPMesh.Tube.new()
	lens.add(Vector3(-0.012, 0.13, -0.017), 0.013).add(Vector3(-0.012, 0.13, -0.023), 0.012)
	b.tube(lens, 16, Vector3.UP, 8.0, false, true)
	b.commit(mesh, FPMaterials.vm(&"glass_dark"))
	var out := {"mesh": mesh}
	_cache[key] = out
	return out


static func canteen_mesh() -> ArrayMesh:
	var key := "canteen"
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var body := FPMesh.Tube.new()
	body.add(Vector3(0, 0.0, 0), 0.06, 0.03).add(Vector3(0, 0.02, 0), 0.07, 0.036).add(Vector3(0, 0.14, 0), 0.07, 0.036)
	body.add(Vector3(0, 0.17, 0), 0.055, 0.03).add(Vector3(0, 0.185, 0), 0.02, 0.018)
	body.dome_start(2, 0.3)
	b.tube(body, 20, Vector3.BACK, 5.0, false, false, 2.3)
	b.commit(mesh, FPMaterials.vm(&"aluminium"))
	var cover := FPMesh.Tube.new()
	cover.add(Vector3(0, -0.004, 0), 0.062, 0.032).add(Vector3(0, 0.02, 0), 0.0735, 0.039).add(Vector3(0, 0.13, 0), 0.0735, 0.039).add(Vector3(0, 0.145, 0), 0.07, 0.037)
	cover.dome_start(2, 0.3)
	b.tube(cover, 20, Vector3.BACK, 6.0, false, false, 2.3)
	b.commit(mesh, FPMaterials.vm(&"canvas"))
	var cap := FPMesh.Tube.new()
	cap.add(Vector3(0, 0.183, 0), 0.0175).add(Vector3(0, 0.205, 0), 0.0175).add(Vector3(0, 0.21, 0), 0.014)
	b.tube(cap, 14, Vector3.BACK, 8.0, false, true)
	b.commit(mesh, FPMaterials.vm(&"plastic_dark"))
	_cache[key] = mesh
	return mesh


## Binoculars looking toward −Z, eyecups at +Z.
static func binoculars_mesh() -> ArrayMesh:
	var key := "binoculars"
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	for side in [-1.0, 1.0]:
		var t := FPMesh.Tube.new()
		var x := float(side) * 0.036
		t.add(Vector3(x, 0, 0.03), 0.017).add(Vector3(x, 0, 0.0), 0.019).add(Vector3(x, -0.004, -0.06), 0.022)
		t.add(Vector3(x, -0.006, -0.12), 0.026).add(Vector3(x, -0.006, -0.135), 0.027)
		b.tube(t, 18, Vector3.UP, 6.0, false, false)
	b.box(Vector3(0, 0.002, -0.02), Vector3(0.05, 0.02, 0.05), 0.2)
	b.commit(mesh, FPMaterials.vm(&"rubber"))
	for side in [-1.0, 1.0]:
		var x := float(side) * 0.036
		var lens := FPMesh.Tube.new()
		lens.add(Vector3(x, -0.006, -0.13), 0.0235).add(Vector3(x, -0.006, -0.133), 0.023)
		b.tube(lens, 18, Vector3.UP, 6.0, false, true)
		var eye := FPMesh.Tube.new()
		eye.add(Vector3(x, 0, 0.028), 0.011).add(Vector3(x, 0, 0.033), 0.01)
		b.tube(eye, 14, Vector3.UP, 6.0, false, true)
	b.commit(mesh, FPMaterials.vm(&"glass_dark"))
	var knob := FPMesh.Tube.new()
	knob.add(Vector3(-0.009, 0.014, -0.005), 0.009).add(Vector3(0.009, 0.014, -0.005), 0.009)
	b.tube(knob, 14, Vector3.UP, 20.0, true, true)
	b.commit(mesh, FPMaterials.vm(&"steel_blued"))
	_cache[key] = mesh
	return mesh


## Folded topo map sheet in the XY plane facing +Z, 0.3 × 0.21 m, gentle fold ridges.
static func map_mesh() -> ArrayMesh:
	var key := "map"
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var w := 0.3
	var h := 0.21
	var nx := 12
	var ny := 8
	for side in 2:
		var base := b.vertex_count()
		for i in nx + 1:
			for j in ny + 1:
				var u := float(i) / float(nx)
				var v := float(j) / float(ny)
				var fold := absf(sin(u * PI * 2.0)) * 0.006 + absf(sin(v * PI)) * 0.003
				var p := Vector3((u - 0.5) * w, (v - 0.5) * h, fold - 0.004 - (0.0006 if side == 1 else 0.0))
				var n := Vector3(0, 0, 1) if side == 0 else Vector3(0, 0, -1)
				b.add_vertex(p, n, Vector2(u, 1.0 - v) if side == 0 else Vector2(u * 3.0, v * 3.0))
		for i in nx:
			for j in ny:
				var a := base + i * (ny + 1) + j
				if side == 0:
					b.quad(a, a + ny + 1, a + ny + 2, a + 1)
				else:
					b.quad(a, a + 1, a + ny + 2, a + ny + 1)
		b.commit(mesh, FPMaterials.vm(&"map") if side == 0 else FPMaterials.vm(&"bandage"))
	_cache[key] = mesh
	return mesh


## Baseplate compass lying in the XZ plane (dial up +Y). Returns {"mesh", "needle"}.
static func compass_mesh() -> Dictionary:
	var key := "compass"
	if _cache.has(key):
		return _cache[key]
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var plate := FPMesh.Tube.new()
	plate.add(Vector3(0, 0, 0.055), 0.028, 0.0025).add(Vector3(0, 0, -0.06), 0.028, 0.0025)
	b.tube(plate, 16, Vector3.UP, 10.0, true, true, 6.0)
	b.commit(mesh, FPMaterials.vm(&"plastic_dark"))
	var ring := FPMesh.Tube.new()
	ring.add(Vector3(0, 0.001, 0), 0.024).add(Vector3(0, 0.009, 0), 0.024).add(Vector3(0, 0.0105, 0), 0.0225)
	b.tube(ring, 24, Vector3.FORWARD, 10.0, false, false)
	b.commit(mesh, FPMaterials.vm(&"plastic_red"))
	var face := FPMesh.Tube.new()
	face.add(Vector3(0, 0.0075, 0), 0.0222).add(Vector3(0, 0.008, 0), 0.0222)
	b.tube(face, 24, Vector3.FORWARD, 10.0, false, true)
	b.commit(mesh, FPMaterials.vm(&"bandage"))
	var nmesh := ArrayMesh.new()
	var nb := FPMesh.new()
	# Needle: red north half (−Z), white south half.
	var north := FPMesh.Tube.new()
	north.add(Vector3(0, 0, 0), 0.0028, 0.0008).add(Vector3(0, 0, -0.018), 0.0003, 0.0003)
	nb.tube(north, 6, Vector3.UP, 10.0, true, false, 1.2)
	nb.commit(nmesh, FPMaterials.vm_emissive(&"plastic_red", Color(0.8, 0.1, 0.05), 0.4))
	var south := FPMesh.Tube.new()
	south.add(Vector3(0, 0, 0), 0.0028, 0.0008).add(Vector3(0, 0, 0.018), 0.0003, 0.0003)
	nb.tube(south, 6, Vector3.UP, 10.0, true, false, 1.2)
	nb.commit(nmesh, FPMaterials.vm(&"aluminium"))
	var out := {"mesh": mesh, "needle": nmesh}
	_cache[key] = out
	return out


# =================================================================================================
# Consumables & generic props
# =================================================================================================

## Model for food/drink/medical items held in one hand (centre at the origin).
static func consumable_mesh(id: StringName) -> ArrayMesh:
	var key := "cons_%s" % id
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var s := String(id)
	if s.begins_with("meat") or s.begins_with("fish"):
		var t := FPMesh.Tube.new()
		for i in 9:
			var f := float(i) / 8.0
			var r := 0.028 * sin(f * PI) + 0.006 + 0.004 * sin(f * 11.0)
			t.add(Vector3(sin(f * 4.0) * 0.006, 0.0, (f - 0.5) * 0.13), r * 1.3, r * 0.7)
		t.dome_start(2, 0.6)
		t.dome_end(2, 0.6)
		b.tube(t, 12, Vector3.UP, 10.0)
		var kind: StringName = &"meat_cooked" if s.ends_with("cooked") else &"meat_raw"
		if s.begins_with("fish"):
			kind = &"skin_fish" if s.ends_with("raw") else &"meat_cooked"
		b.commit(mesh, FPMaterials.vm(kind))
	elif s == "berries":
		var rng := RandomNumberGenerator.new()
		rng.seed = 77
		for k in 11:
			var c := Vector3(rng.randf_range(-0.025, 0.025), rng.randf_range(0.0, 0.012), rng.randf_range(-0.025, 0.025))
			var t2 := FPMesh.Tube.new()
			var r := rng.randf_range(0.0055, 0.0075)
			t2.add(c + Vector3(0, -r * 0.3, 0), r).add(c + Vector3(0, r * 0.3, 0), r)
			t2.dome_start(3)
			t2.dome_end(3)
			b.tube(t2, 8, Vector3.FORWARD, 10.0)
		b.commit(mesh, FPMaterials.vm(&"berry"))
	elif s == "mushroom":
		var stem := FPMesh.Tube.new()
		stem.add(Vector3(0, -0.03, 0), 0.008).add(Vector3(0, 0.02, 0), 0.007)
		b.tube(stem, 10, Vector3.FORWARD, 10.0, true, false)
		var cap := FPMesh.Tube.new()
		cap.add(Vector3(0, 0.014, 0), 0.034).add(Vector3(0, 0.022, 0), 0.03)
		cap.dome_end(4, 0.7)
		b.tube(cap, 16, Vector3.FORWARD, 10.0, true, false)
		b.commit(mesh, FPMaterials.vm(&"mushroom"))
	elif s == "canned_beans":
		var can := FPMesh.Tube.new()
		can.add(Vector3(0, -0.055, 0), 0.037).add(Vector3(0, 0.055, 0), 0.037)
		b.tube(can, 20, Vector3.FORWARD, 6.0, true, true)
		b.commit(mesh, FPMaterials.vm(&"aluminium"))
	elif s == "bandage" or s == "splint" or s == "herbal_poultice":
		var roll := FPMesh.Tube.new()
		roll.add(Vector3(-0.03, 0, 0), 0.022).add(Vector3(0.03, 0, 0), 0.022)
		b.tube(roll, 18, Vector3.UP, 8.0, true, true)
		b.commit(mesh, FPMaterials.vm(&"bandage" if s != "herbal_poultice" else &"canvas"))
	elif s == "first_aid_kit":
		b.box(Vector3.ZERO, Vector3(0.14, 0.09, 0.05), 1.0)
		b.commit(mesh, FPMaterials.vm(&"plastic_red"))
	elif s == "painkillers":
		var bottle := FPMesh.Tube.new()
		bottle.add(Vector3(0, -0.035, 0), 0.018).add(Vector3(0, 0.03, 0), 0.018)
		b.tube(bottle, 14, Vector3.FORWARD, 6.0, true, true)
		b.commit(mesh, FPMaterials.vm(&"plastic_orange"))
	elif s.begins_with("water") or s == "bottle_empty" or s == "pine_tea" or s == "coffee":
		# Enamel/steel mug for hot drinks, bottle for water.
		if s == "pine_tea" or s == "coffee":
			var mug := FPMesh.Tube.new()
			mug.add(Vector3(0, -0.04, 0), 0.036).add(Vector3(0, 0.045, 0), 0.04)
			b.tube(mug, 18, Vector3.FORWARD, 6.0, true, false)
			var handle := FPMesh.Tube.new()
			for i in 9:
				var a := float(i) / 8.0 * PI
				handle.add(Vector3(0.04 + sin(a) * 0.02, cos(a) * 0.025, 0.0), 0.0035)
			b.tube(handle, 6, Vector3.FORWARD, 20.0)
			b.commit(mesh, FPMaterials.vm(&"steel_blued"))
		else:
			var bottle2 := FPMesh.Tube.new()
			bottle2.add(Vector3(0, -0.09, 0), 0.03).add(Vector3(0, 0.05, 0), 0.03).add(Vector3(0, 0.08, 0), 0.012).add(Vector3(0, 0.095, 0), 0.012)
			bottle2.dome_start(2, 0.2)
			b.tube(bottle2, 16, Vector3.FORWARD, 6.0, false, true)
			b.commit(mesh, FPMaterials.vm(&"aluminium"))
	else:
		# Ration bar / generic wrapped item.
		var bar := FPMesh.Tube.new()
		bar.add(Vector3(0, 0, -0.06), 0.02, 0.009).add(Vector3(0, 0, 0.06), 0.02, 0.009)
		b.tube(bar, 12, Vector3.UP, 8.0, true, true, 5.0)
		b.commit(mesh, FPMaterials.vm(&"food_bar"))
	_cache[key] = mesh
	return mesh


## Bundle for items without a dedicated model (a wrapped cloth parcel tied with cord).
static func generic_mesh() -> ArrayMesh:
	var key := "generic"
	var cached := _cached(key)
	if cached:
		return cached
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var t := FPMesh.Tube.new()
	t.add(Vector3(0, 0, -0.05), 0.035, 0.028).add(Vector3(0, 0, 0.05), 0.035, 0.028)
	t.dome_start(3, 0.5)
	t.dome_end(3, 0.5)
	b.tube(t, 14, Vector3.UP, 8.0, false, false, 2.5)
	b.commit(mesh, FPMaterials.vm(&"canvas_tri"))
	_cache[key] = mesh
	return mesh

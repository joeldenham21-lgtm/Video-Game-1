class_name FPHands
extends RefCounted
## Procedural first-person arms: gloved (or bare) hand with posed fingers, gauntlet cuff, knit wrist cuff
## and jacket sleeve. Right-hand local frame: wrist at the origin, fingers toward −Z, back of the hand +Y,
## thumb on the −X side, forearm toward +Z. Left hands are mirrored geometry.
##
## Surfaces: 0 = hand (glove/skin), 1 = sleeve, 2 = wrist cuff — materials are swapped to match the
## player's equipped clothing (see Viewmodel.refresh_clothing()).

const SURF_HAND := 0
const SURF_SLEEVE := 1
const SURF_CUFF := 2

# Finger layout (right hand): knuckle (MCP) position, segment lengths, base radius, tip radius.
const FINGERS := [
	{"mcp": Vector3(-0.0285, 0.0015, -0.0815), "len": [0.043, 0.026, 0.023], "r0": 0.0104, "r1": 0.0091},
	{"mcp": Vector3(-0.0095, 0.0025, -0.0855), "len": [0.048, 0.030, 0.024], "r0": 0.0108, "r1": 0.0094},
	{"mcp": Vector3(0.0105, 0.0015, -0.0825), "len": [0.045, 0.028, 0.023], "r0": 0.0102, "r1": 0.009},
	{"mcp": Vector3(0.0285, -0.0005, -0.0755), "len": [0.035, 0.021, 0.020], "r0": 0.0092, "r1": 0.0081},
]
const THUMB_BASE := Vector3(-0.022, -0.009, -0.014)
const THUMB_LEN := [0.042, 0.032, 0.027]
const THUMB_R := [0.0152, 0.0122, 0.0108, 0.0098]

## Pose: fingers = [[spread°, mcp°, pip°, dip°] × 4 (index..pinky)], thumb = 3 direction vectors,
## grip = handle centre inside the fist (hand space), for hand placement.
const POSES := {
	&"relaxed": {
		"fingers": [[-3, 16, 26, 14], [0, 20, 30, 16], [3, 24, 34, 18], [7, 28, 38, 20]],
		"thumb": [Vector3(-0.72, -0.3, -0.62), Vector3(-0.42, -0.38, -0.82), Vector3(-0.25, -0.42, -0.87)],
		"grip": Vector3(0.0, -0.03, -0.075),
	},
	&"grip": {
		"fingers": [[-2, 62, 88, 42], [0, 66, 90, 44], [2, 70, 92, 46], [5, 74, 94, 48]],
		"thumb": [Vector3(-0.62, -0.5, -0.6), Vector3(-0.05, -0.72, -0.69), Vector3(0.42, -0.62, -0.66)],
		"grip": Vector3(0.0, -0.034, -0.071),
	},
	&"grip_loose": {
		"fingers": [[-2, 52, 76, 36], [0, 56, 78, 38], [2, 60, 80, 40], [5, 64, 84, 42]],
		"thumb": [Vector3(-0.66, -0.45, -0.6), Vector3(-0.22, -0.66, -0.72), Vector3(0.18, -0.64, -0.75)],
		"grip": Vector3(0.0, -0.036, -0.074),
	},
	&"fist": {
		"fingers": [[-2, 86, 100, 62], [0, 88, 102, 64], [2, 90, 104, 66], [5, 92, 106, 68]],
		"thumb": [Vector3(-0.55, -0.55, -0.62), Vector3(0.12, -0.72, -0.68), Vector3(0.62, -0.5, -0.6)],
		"grip": Vector3(0.0, -0.028, -0.062),
	},
	&"open": {
		"fingers": [[-8, 4, 6, 4], [-2, 4, 6, 4], [4, 5, 7, 4], [10, 6, 8, 5]],
		"thumb": [Vector3(-0.8, -0.2, -0.56), Vector3(-0.66, -0.2, -0.72), Vector3(-0.55, -0.2, -0.81)],
		"grip": Vector3(0.0, -0.03, -0.08),
	},
	&"hold": {
		"fingers": [[-4, 34, 44, 24], [-1, 38, 46, 26], [2, 42, 48, 28], [6, 46, 50, 30]],
		"thumb": [Vector3(-0.7, -0.42, -0.58), Vector3(-0.3, -0.56, -0.77), Vector3(-0.05, -0.58, -0.81)],
		"grip": Vector3(0.0, -0.045, -0.085),
	},
	&"hook": {
		"fingers": [[-2, 18, 82, 58], [0, 20, 84, 60], [2, 24, 86, 62], [5, 70, 96, 60]],
		"thumb": [Vector3(-0.7, -0.35, -0.62), Vector3(-0.3, -0.5, -0.81), Vector3(-0.08, -0.55, -0.83)],
		"grip": Vector3(0.0, -0.035, -0.105),
	},
	&"pinch": {
		"fingers": [[-2, 44, 62, 30], [0, 58, 86, 44], [2, 64, 90, 46], [5, 70, 94, 48]],
		"thumb": [Vector3(-0.68, -0.46, -0.57), Vector3(-0.2, -0.62, -0.76), Vector3(0.18, -0.6, -0.78)],
		"grip": Vector3(-0.012, -0.03, -0.1),
	},
}

static var _mesh_cache: Dictionary = {}


## Builds (cached) the arm mesh for `pose`. Sleeve length in metres from the wrist.
static func get_mesh(pose: StringName, left: bool, sleeve_len := 0.42) -> ArrayMesh:
	var key := "%s_%s_%d" % [pose, "L" if left else "R", int(sleeve_len * 100.0)]
	if _mesh_cache.has(key):
		return _mesh_cache[key]
	var mesh := ArrayMesh.new()
	var b := FPMesh.new()
	var p: Dictionary = POSES.get(pose, POSES[&"relaxed"])
	_build_hand(b, p)
	if left:
		b.mirror_x_from(0, 0)
	b.commit(mesh, FPMaterials.vm(&"glove"))
	_build_sleeve(b, sleeve_len)
	if left:
		b.mirror_x_from(0, 0)
	b.commit(mesh, FPMaterials.vm(&"sleeve"))
	_build_cuff(b)
	if left:
		b.mirror_x_from(0, 0)
	b.commit(mesh, FPMaterials.vm(&"cuff"))
	_mesh_cache[key] = mesh
	return mesh


## Grip centre (handle axis point) of a pose, in hand space (mirrored for left).
static func grip_point(pose: StringName, left: bool) -> Vector3:
	var p: Dictionary = POSES.get(pose, POSES[&"relaxed"])
	var g: Vector3 = p["grip"]
	return Vector3(-g.x, g.y, g.z) if left else g


## Hand basis so the handle runs toward the thumb along `thumb_dir` and the forearm points to `elbow_dir`.
static func grip_basis(thumb_dir: Vector3, elbow_dir: Vector3, left: bool) -> Basis:
	var x := thumb_dir.normalized() if left else -thumb_dir.normalized()
	var z := (elbow_dir - x * elbow_dir.dot(x)).normalized()
	var y := z.cross(x).normalized()
	return Basis(x, y, z)


## Creates a MeshInstance3D arm placed so the pose's grip point sits at `grip_pos` with the given axes.
static func make_arm(pose: StringName, left: bool, grip_pos: Vector3, thumb_dir: Vector3, elbow_dir: Vector3,
		sleeve_len := 0.42) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = "ArmL" if left else "ArmR"
	mi.mesh = get_mesh(pose, left, sleeve_len)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	var basis := grip_basis(thumb_dir, elbow_dir, left)
	mi.transform = Transform3D(basis, grip_pos - basis * grip_point(pose, left))
	mi.set_meta(&"pose", pose)
	return mi


# ---- Geometry ------------------------------------------------------------------------------------

static func _build_hand(b: FPMesh, pose: Dictionary) -> void:
	# Palm: flattened rounded box from the wrist to the knuckles.
	var palm := FPMesh.Tube.new()
	palm.add(Vector3(0.0, -0.001, 0.012), 0.028, 0.019)
	palm.add(Vector3(0.0, 0.0, -0.005), 0.031, 0.0185)
	palm.add(Vector3(0.001, 0.0005, -0.03), 0.038, 0.0175)
	palm.add(Vector3(0.001, 0.0005, -0.055), 0.042, 0.016)
	palm.add(Vector3(0.0, 0.0, -0.074), 0.043, 0.0145)
	palm.dome_end(3, 0.55)
	b.tube(palm, 16, Vector3.UP, 6.0, true, false, 2.6)
	# Fingers.
	var fingers: Array = pose["fingers"]
	for i in 4:
		var f: Dictionary = FINGERS[i]
		var a: Array = fingers[i]
		_finger(b, f["mcp"], f["len"], float(f["r0"]), float(f["r1"]), float(a[0]), float(a[1]), float(a[2]), float(a[3]))
	# Thumb.
	var dirs: Array = pose["thumb"]
	var joints := PackedVector3Array()
	joints.append(THUMB_BASE)
	var pos := THUMB_BASE
	for k in 3:
		pos += (dirs[k] as Vector3).normalized() * float(THUMB_LEN[k])
		joints.append(pos)
	var t := FPMesh.Tube.new()
	var path := _smooth(joints, 4)
	for k in path.size():
		var f := float(k) / float(path.size() - 1)
		var r := _lerp4(THUMB_R, f)
		t.add(path[k], r * 1.05, r * 0.92)
	t.dome_end(4, 0.9)
	t.dome_start(2, 0.5)
	b.tube(t, 10, Vector3.UP, 10.0, false, false, 2.0)
	# Thenar pad (the fleshy base of the thumb).
	var pad := FPMesh.Tube.new()
	pad.add(THUMB_BASE + Vector3(0.006, 0.0, 0.01), 0.012, 0.012)
	pad.add(THUMB_BASE.lerp(joints[1], 0.55) + Vector3(0.004, 0.0, 0.0), 0.0135, 0.012)
	pad.add(joints[1] + Vector3(0.003, 0.002, 0.0), 0.0105, 0.0095)
	pad.dome_start(2, 0.6)
	pad.dome_end(2, 0.6)
	b.tube(pad, 10, Vector3.UP, 10.0, false, false, 2.0)
	# Glove seam ridge across the knuckles.
	var ridge := FPMesh.Tube.new()
	for k in 7:
		var x := lerpf(-0.036, 0.036, float(k) / 6.0)
		ridge.add(Vector3(x, 0.0125 - absf(x) * 0.05, -0.064 - (0.0045 - absf(x) * 0.08)), 0.0028, 0.002)
	b.tube(ridge, 6, Vector3.UP, 30.0, true, true)
	# Gauntlet of the glove, flaring toward the forearm.
	var g := FPMesh.Tube.new()
	g.add(Vector3(0.0, -0.001, -0.006), 0.0305, 0.0205)
	g.add(Vector3(0.0, 0.0, 0.012), 0.034, 0.026)
	g.add(Vector3(0.0, 0.001, 0.034), 0.038, 0.031)
	g.add(Vector3(0.0, 0.002, 0.052), 0.0415, 0.0345)
	g.add(Vector3(0.0, 0.002, 0.056), 0.0412, 0.0342)
	b.tube(g, 18, Vector3.UP, 6.0, false, false, 2.0)


static func _finger(b: FPMesh, mcp: Vector3, lens: Array, r0: float, r1: float, spread: float, a_mcp: float, a_pip: float, a_dip: float) -> void:
	var dir := Vector3(0.0, 0.0, -1.0).rotated(Vector3.UP, deg_to_rad(-spread))
	var lateral := Vector3.RIGHT.rotated(Vector3.UP, deg_to_rad(-spread))
	var joints := PackedVector3Array()
	# Start a little inside the palm so the knuckle blends.
	joints.append(mcp - dir * 0.012)
	joints.append(mcp)
	var p := mcp
	var angles := [a_mcp, a_pip, a_dip]
	for k in 3:
		dir = dir.rotated(lateral, -deg_to_rad(float(angles[k])))
		p += dir * float(lens[k])
		joints.append(p)
	var path := _smooth(joints, 4)
	var t := FPMesh.Tube.new()
	var n := path.size()
	for k in n:
		var f := float(k) / float(n - 1)
		var r := lerpf(r0 * 1.05, r1, f)
		# Knuckle swell at each joint.
		var swell := 0.0
		for jf in [0.25, 0.62, 0.84]:
			swell += exp(-pow((f - float(jf)) / 0.05, 2.0)) * 0.0009
		t.add(path[k], r + swell, (r + swell) * 0.9)
	t.dome_end(4, 0.95)
	b.tube(t, 10, Vector3.UP, 12.0, true, false, 2.0)


static func _build_sleeve(b: FPMesh, length: float) -> void:
	# Jacket sleeve with soft compression folds.
	var s := FPMesh.Tube.new()
	var steps := 16
	for k in steps + 1:
		var f := float(k) / float(steps)
		var z := lerpf(0.045, length, f)
		var fold := sin(f * 23.0) * 0.0022 + sin(f * 41.0 + 1.3) * 0.0012
		var bulge := sin(f * PI) * 0.004
		var rx := lerpf(0.047, 0.064, f) + fold + bulge
		var ry := lerpf(0.043, 0.058, f) + fold * 0.8 + bulge
		s.add(Vector3(sin(f * 3.0) * 0.002, 0.002 + f * 0.004, z), rx, ry)
	s.dome_start(2, 0.3)
	b.tube(s, 18, Vector3.UP, 5.0, false, true, 2.0)


static func _build_cuff(b: FPMesh) -> void:
	var c := FPMesh.Tube.new()
	c.add(Vector3(0.0, 0.0015, 0.03), 0.0405, 0.0355)
	c.add(Vector3(0.0, 0.002, 0.05), 0.0435, 0.038)
	c.add(Vector3(0.0, 0.002, 0.066), 0.045, 0.0395)
	c.dome_start(2, 0.4)
	b.tube(c, 18, Vector3.UP, 12.0, false, false, 2.0)


## Catmull-Rom subdivision through `pts` (rounded joints).
static func _smooth(pts: PackedVector3Array, sub: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	var n := pts.size()
	for i in n - 1:
		var p0 := pts[maxi(i - 1, 0)]
		var p1 := pts[i]
		var p2 := pts[i + 1]
		var p3 := pts[mini(i + 2, n - 1)]
		for k in sub:
			var t := float(k) / float(sub)
			out.append(_catmull(p0, p1, p2, p3, t))
	out.append(pts[n - 1])
	return out


static func _catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


static func _lerp4(a: Array, f: float) -> float:
	var x := clampf(f, 0.0, 1.0) * float(a.size() - 1)
	var i := mini(int(x), a.size() - 2)
	return lerpf(float(a[i]), float(a[i + 1]), x - float(i))

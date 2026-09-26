extends TestCase
## Props stream: hero models (tools/blender/props) — coverage, loading, library materials bound at import,
## poly budgets, real-world scale, first-person frames/sockets the tool scripts rely on, posed hands, world prop
## scenes (bodies, layers, collision) and pickups built from hero models.

const ITEMS_DIR := "res://assets/models/items/"
const FP_DIR := "res://assets/models/fp/"
const PROPS_DIR := "res://assets/models/props/"
const SCENES_DIR := "res://scenes/props/"
const BUDGET := {"items": 3600, "fp": 3600, "props": 5000}


func run() -> void:
	_test_coverage()
	_test_glbs("items", ITEMS_DIR)
	_test_glbs("fp", FP_DIR)
	_test_glbs("props", PROPS_DIR)
	_test_item_scale()
	_test_fp_frames()
	_test_hands()
	_test_prop_scenes()
	await _test_pickup()


# ---- every item has a model (hero glb or procedural) and an icon --------------------------------------

func _test_coverage() -> void:
	var missing_model: Array[String] = []
	var missing_icon: Array[String] = []
	var hero := 0
	for id in ItemDB.all_items():
		var glb := ITEMS_DIR + String(id) + ".glb"
		if ResourceLoader.exists(glb):
			hero += 1
		elif ItemVisuals.get_mesh(id) == null:
			missing_model.append(String(id))
		if not ResourceLoader.exists("res://assets/icons/%s.png" % id):
			missing_icon.append(String(id))
	check(missing_model.is_empty(), "every item has a hero or procedural model (missing: %s)" % [missing_model])
	check(missing_icon.is_empty(), "every item has an icon (missing: %s)" % [missing_icon])
	check(hero >= 20, "at least 20 items use Blender hero models (%d)" % hero)


# ---- glbs load, materials are the library ones, budgets ------------------------------------------------

func _glb_files(dir: String) -> Array[String]:
	var out: Array[String] = []
	for f in DirAccess.get_files_at(dir):
		var fn := String(f).trim_suffix(".import")
		if fn.ends_with(".glb") and not out.has(fn):
			out.append(fn)
	out.sort()
	return out


static func tris_of(root: Node) -> int:
	var n := 0
	for c in root.find_children("*", "MeshInstance3D", true, false):
		var mesh := (c as MeshInstance3D).mesh as ArrayMesh
		if mesh == null:
			continue
		for s in mesh.get_surface_count():
			var idx: int = mesh.surface_get_array_index_len(s)
			n += (idx if idx > 0 else mesh.surface_get_array_len(s)) / 3
	return n


static func aabb_of(root: Node) -> AABB:
	var out := AABB()
	var first := true
	for c in root.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf := Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != root:
			if p is Node3D:
				xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var b := xf * mi.mesh.get_aabb()
		out = b if first else out.merge(b)
		first = false
	return out


func _test_glbs(kind: String, dir: String) -> void:
	var files := _glb_files(dir)
	check(not files.is_empty(), "%s: hero models present (%d)" % [kind, files.size()])
	var unbound: Array[String] = []
	var over: Array[String] = []
	var broken: Array[String] = []
	for f in files:
		var ps := load(dir + f) as PackedScene
		if ps == null:
			broken.append(f)
			continue
		var root := ps.instantiate()
		var meshes := root.find_children("*", "MeshInstance3D", true, false)
		if meshes.is_empty():
			broken.append(f)
		for c in meshes:
			var mesh := (c as MeshInstance3D).mesh
			for s in mesh.get_surface_count():
				var m := mesh.surface_get_material(s)
				var key := m.resource_name.get_slice(".", 0) if m else ""
				var d := ItemMaterials.definition(StringName(key))
				var ok := m != null and not d.is_empty()
				# bound = the post-import script replaced the flat placeholder with the textured library material
				if ok and String(d.get("albedo", "")) != "" and m is BaseMaterial3D:
					ok = (m as BaseMaterial3D).albedo_texture != null
				if not ok:
					unbound.append("%s:%s" % [f, key])
		var budget: int = BUDGET[kind]
		if f == "arms.glb":
			budget = 6000 * FPHands.POSES.size()
		var t := tris_of(root)
		if t > budget:
			over.append("%s=%d" % [f, t])
		root.free()
	check(broken.is_empty(), "%s: every glb loads with meshes (broken: %s)" % [kind, broken])
	check(unbound.is_empty(), "%s: every surface uses a bound library material (%s)" % [kind, unbound.slice(0, 8)])
	check(over.is_empty(), "%s: triangle budget %d (over: %s)" % [kind, BUDGET[kind], over])


# ---- real-world scale and resting pose of the world models ---------------------------------------------

func _test_item_scale() -> void:
	var expect := {   # id -> [min longest side, max longest side] in metres
		&"hatchet": [0.36, 0.46], &"felling_axe": [0.72, 0.86], &"knife": [0.18, 0.26], &"spear": [1.7, 2.1],
		&"lantern": [0.22, 0.3], &"fuel_can": [0.26, 0.36], &"stone": [0.07, 0.14], &"bone": [0.18, 0.3],
		&"canteen": [0.18, 0.26], &"ice_axe": [0.5, 0.7], &"torch": [0.5, 0.62], &"meat_raw": [0.1, 0.2],
	}
	for id in expect:
		var path := ITEMS_DIR + String(id) + ".glb"
		if not ResourceLoader.exists(path):
			check(false, "hero model for %s" % id)
			continue
		var root := (load(path) as PackedScene).instantiate()
		var b := aabb_of(root)
		var longest := b.get_longest_axis_size()
		var r: Array = expect[id]
		check(longest >= float(r[0]) and longest <= float(r[1]), "%s real-world size %.3f m in [%s, %s]" % [id, longest, r[0], r[1]])
		check(absf(b.position.y) < 0.01, "%s rests on y = 0 (min y %.4f)" % [id, b.position.y])
		root.free()


# ---- first-person frames: where the tool scripts put hands, flames, screens ----------------------------

func _test_fp_frames() -> void:
	var cases := {
		# id: [check description, Callable(aabb) -> bool]
		&"hatchet": ["handle +Y from the butt (0..0.42), bit toward -Z", func(b: AABB) -> bool:
			return absf(b.position.y) < 0.02 and b.end.y > 0.38 and b.end.y < 0.43 and b.position.z < -0.08],
		&"felling_axe": ["0.78 m haft, bit -Z", func(b: AABB) -> bool:
			return b.end.y > 0.76 and b.end.y < 0.82 and b.position.z < -0.1],
		&"knife": ["blade tip -Z, handle +Z around the grip at z 0.055", func(b: AABB) -> bool:
			return b.position.z < -0.09 and b.end.z > 0.1],
		&"spear": ["point far along -Z, butt behind the grip", func(b: AABB) -> bool:
			return b.position.z < -1.2 and b.end.z > 0.7],
		&"torch": ["cloth head around the flame socket y = 0.49", func(b: AABB) -> bool:
			return b.end.y > 0.53 and b.end.y < 0.6],
		&"lantern": ["bail (grip) top at y = 0.25", func(b: AABB) -> bool:
			return b.end.y > 0.24 and b.end.y < 0.27 and absf(b.position.y) < 0.01],
		&"flare": ["striker end at y = 0.24 under the emissive tip", func(b: AABB) -> bool:
			return b.end.y > 0.235 and b.end.y < 0.25],
		&"ice_axe": ["spike below y = 0, head at 0.55", func(b: AABB) -> bool:
			return b.position.y < -0.02 and b.end.y > 0.55 and b.end.y < 0.62],
		&"canteen": ["body centred on the hand (fp offset -0.09)", func(b: AABB) -> bool:
			return b.position.y < -0.08 and b.end.y > 0.1],
		&"survey_scanner": ["screen face stays behind the live screen quad (z 0.0196) in the screen area", func(b: AABB) -> bool:
			return b.end.y > 0.2 and b.position.y > -0.01],
	}
	for id in cases:
		var ext := FPModels.external(id)
		if ext == null:
			check(false, "fp model %s exists" % id)
			continue
		var b := aabb_of(ext)
		var c: Array = cases[id]
		check((c[1] as Callable).call(b), "fp %s: %s (aabb %s)" % [id, c[0], b])
		# converted to the viewmodel shader (FOV / depth squeeze), keeping library tiling
		var mi := ext.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
		var mat := mi.get_surface_override_material(0)
		check(mat is ShaderMaterial, "fp %s surfaces use the viewmodel shader" % id)
		ext.free()
	# The scanner's screen rectangle must be clear of geometry in front of the quad.
	var sc := FPModels.external(&"survey_scanner")
	if sc:
		var blocked := false
		for n in sc.find_children("*", "MeshInstance3D", true, false):
			var mesh := (n as MeshInstance3D).mesh
			for s in mesh.get_surface_count():
				var v: PackedVector3Array = mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]
				for p in v:
					if absf(p.x) < 0.035 and absf(p.y - 0.098) < 0.043 and p.z > 0.0196:
						blocked = true
		check(not blocked, "scanner: nothing in front of the live screen quad")
		sc.free()


# ---- posed gloved hands --------------------------------------------------------------------------------

func _test_hands() -> void:
	check(ResourceLoader.exists(FPHands.EXTERNAL_ARMS), "arms.glb exists")
	for pose in FPHands.POSES:
		var m := FPHands.external_hand(pose)
		check(m != null, "authored hand mesh for pose %s" % pose)
		if m:
			var b := m.get_aabb()
			# wrist at the origin, fingers toward -Z, hand ~16-21 cm long, 8-12 cm wide (gloved)
			check(b.position.z < -0.09 and b.end.z < 0.05 and b.size.x > 0.075 and b.size.x < 0.16,
				"hand %s in the Hand frame (aabb %s)" % [pose, b])
	var arm := FPHands.make_arm(&"grip", true, Vector3(0, 0.1, 0), Vector3.UP, Vector3(0.3, -0.5, 0.8))
	var hand := arm.get_node_or_null(^"Hand") as MeshInstance3D
	check(hand != null and hand.mesh == FPHands.external_hand(&"grip"), "make_arm uses the authored hand")
	check(hand != null and hand.scale.x < 0.0, "left hand mirrored")
	var fore := arm.get_node_or_null(^"Forearm") as MeshInstance3D
	check(fore != null and fore.mesh.get_surface_count() >= 3, "procedural sleeve/cuff kept for clothing swaps")
	FPHands.set_pose(arm, &"fist")
	check(hand != null and hand.mesh == FPHands.external_hand(&"fist"), "set_pose swaps the authored hand")
	arm.free()


# ---- world prop scenes ---------------------------------------------------------------------------------

func _test_prop_scenes() -> void:
	var n := 0
	var bad: Array[String] = []
	for f in DirAccess.get_files_at(SCENES_DIR):
		var fn := String(f).trim_suffix(".remap")
		if not fn.ends_with(".tscn") or fn.begins_with("props_lineup"):
			continue
		n += 1
		var ps := load(SCENES_DIR + fn) as PackedScene
		var root := ps.instantiate() if ps else null
		var ok := root is CollisionObject3D
		if ok:
			var co := root as CollisionObject3D
			if co is RigidBody3D:
				ok = co.collision_layer == 8 and (co as RigidBody3D).mass > 0.0
			else:
				ok = co is StaticBody3D and co.collision_layer == 1
			var shapes := root.find_children("*", "CollisionShape3D", false, false)
			ok = ok and not shapes.is_empty()
			for s in shapes:
				ok = ok and (s as CollisionShape3D).shape != null
			ok = ok and root.get_node_or_null(^"Model") != null and tris_of(root) > 0
			var b := aabb_of(root)
			ok = ok and b.position.y > -0.02 and b.get_longest_axis_size() < 3.5
		if not ok:
			bad.append(fn)
		if root:
			root.free()
	check(n >= 20, "world prop scenes present (%d)" % n)
	check(bad.is_empty(), "prop scenes: body/layer/collision/model valid (bad: %s)" % [bad])


# ---- a pickup built from a hero model gets a proper collision box --------------------------------------

func _test_pickup() -> void:
	var ps := load("res://scenes/items/pickup.tscn") as PackedScene
	if ps == null:
		check(false, "pickup scene loads")
		return
	var p := ps.instantiate()
	p.set(&"item_id", &"hatchet")
	p.set(&"freeze", true)
	add_child(p)
	await get_tree().process_frame
	var shape := p.get_node_or_null(^"Shape") as CollisionShape3D
	var box := shape.shape as BoxShape3D if shape else null
	check(box != null and box.size.x > 0.3 and box.size.y < 0.1, "hatchet pickup: collision from the hero model (%s)" % (box.size if box else Vector3.ZERO))
	p.queue_free()

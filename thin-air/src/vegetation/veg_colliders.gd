extends Node
## Near-player physics for the scatter (child "Colliders" of Vegetation). Every REFRESH_STEP metres the player
## moves (or when the scatter changes), instances within range get a pooled VegProxy body; bodies that fall
## out of range (+ hysteresis) go back to the pool. Nothing is ever created for the whole map.
##   trees / snags   trunk cylinder (+ second stem for multi-stem whitebark)     layer 10  within 40 m
##   logs / stumps   capsule along the log / cylinder                             layer 10  within 40 m
##   boulders        convex hull of LOD2, cached per kind and scale bucket        layer 1   within 40 m
##   shrubs, saplings, small rocks, talus: interaction-only shapes                layer 5   within 16 m

const Cat := VegScatter.Cat
const TREE_RANGE := 40.0
const SMALL_RANGE := 16.0
const HYSTERESIS := 6.0
const REFRESH_STEP := 2.5
const POOL_MAX := 400

var vegetation: Node = null
## Dev/tests: position to centre physics on (else the player, else the camera).
var center_override: Variant = null

var _active: Dictionary = {}          # instance id -> VegProxy
var _pool: Array[VegProxy] = []
var _last := Vector3(INF, INF, INF)
var _dirty := true
var _hull_cache: Dictionary = {}      # "kind:scale" -> ConvexPolygonShape3D
var _root: Node3D


func _ready() -> void:
	_root = Node3D.new()
	_root.name = "Bodies"
	add_child(_root)
	set_physics_process(true)


func mark_dirty() -> void:
	_dirty = true


func active_count() -> int:
	return _active.size()


func proxy_for(id: int) -> VegProxy:
	return _active.get(id)


func _center() -> Vector3:
	if center_override is Vector3:
		return center_override
	if Game.player and is_instance_valid(Game.player):
		return Game.player.global_position
	if vegetation and vegetation.has_method("_camera_pos"):
		return vegetation._camera_pos()
	return Vector3.ZERO


func _physics_process(_delta: float) -> void:
	if vegetation == null or not bool(vegetation.get("is_generated")):
		return
	var c := _center()
	if _dirty or c.distance_squared_to(_last) >= REFRESH_STEP * REFRESH_STEP:
		refresh(c)


## Rebuilds the set of active proxies around `c` (synchronous; cheap: a few cells are scanned).
func refresh(c: Vector3) -> void:
	_dirty = false
	_last = c
	var want := {}
	var big: Array = vegetation.query(c, TREE_RANGE + HYSTERESIS, [Cat.TREE, Cat.DEADWOOD, Cat.ROCK_BIG])
	for e in big:
		var d := Vector2(e["pos"].x - c.x, e["pos"].z - c.z).length()
		if d <= TREE_RANGE or (_active.has(e["id"]) and d <= TREE_RANGE + HYSTERESIS):
			want[e["id"]] = e
	var small: Array = vegetation.query(c, SMALL_RANGE + HYSTERESIS, [Cat.SAPLING, Cat.SHRUB, Cat.ROCK_SMALL])
	for e in small:
		var d := Vector2(e["pos"].x - c.x, e["pos"].z - c.z).length()
		if d <= SMALL_RANGE or (_active.has(e["id"]) and d <= SMALL_RANGE + HYSTERESIS):
			want[e["id"]] = e
	for id in _active.keys():
		if not want.has(id):
			release(id)
	for id in want:
		if not _active.has(id):
			_acquire(want[id])


## Returns a proxy to the pool (felled / removed instances, out of range).
func release(id: int) -> void:
	var p: VegProxy = _active.get(id)
	if p == null:
		return
	_active.erase(id)
	p.instance_id = -1
	p.collision_layer = 0
	p.shape_node.disabled = true
	p.shape_node2.disabled = true
	p.process_mode = Node.PROCESS_MODE_DISABLED
	if _pool.size() < POOL_MAX:
		_pool.append(p)
	else:
		p.queue_free()


func _acquire(e: Dictionary) -> void:
	var p: VegProxy
	if _pool.is_empty():
		p = VegProxy.new()
		p.name = "P%d" % (_active.size() + _pool.size())
		_root.add_child(p)
	else:
		p = _pool.pop_back()
		p.process_mode = Node.PROCESS_MODE_INHERIT
	var id: int = e["id"]
	var kind: StringName = e["kind"]
	var cat: int = e["cat"]
	var s: float = e["scale"]
	p.vegetation = vegetation
	p.instance_id = id
	p.kind = kind
	p.cat = cat
	# no scale on physics bodies: shapes are sized instead
	p.global_transform = Transform3D(Basis(Vector3.UP, float(e["yaw"])), e["pos"])
	_configure(p, VegLibrary.get_shared().info(kind), cat, s)
	_active[id] = p


func _configure(p: VegProxy, inf: Dictionary, cat: int, s: float) -> void:
	var sn := p.shape_node
	var sn2 := p.shape_node2
	sn.disabled = false
	sn2.disabled = true
	sn.transform = Transform3D.IDENTITY
	sn2.transform = Transform3D.IDENTITY
	p.remove_from_group(&"interactable")
	match cat:
		Cat.TREE:
			var r := maxf(float(inf.get("trunk_radius", 0.15)) * s, 0.05)
			var h := minf(float(inf.get("height", 10.0)) * s, 14.0)
			var cyl := sn.shape as CylinderShape3D
			if cyl == null:
				cyl = CylinderShape3D.new()
				sn.shape = cyl
			cyl.radius = r
			cyl.height = h
			sn.position = Vector3(0.0, h * 0.5 - 0.3, 0.0)
			if int(inf.get("stems", 1)) > 1:
				# multi-stem whitebark: a fatter base reads as the stem cluster
				cyl.radius = r * 1.7
			p.collision_layer = VegProxy.LAYER_VEGETATION
			p.set_meta(&"surface", &"wood")
		Cat.DEADWOOD:
			var lr := maxf(float(inf.get("log_radius", 0.2)) * s, 0.05)
			var length := float(inf.get("length", 0.0)) * s
			if length > 0.5:
				var cap := sn.shape as CapsuleShape3D
				if cap == null:
					cap = CapsuleShape3D.new()
					sn.shape = cap
				cap.radius = lr
				cap.height = length + lr * 2.0
				sn.transform = Transform3D(Basis(Vector3.BACK, PI * 0.5), Vector3(0.0, lr * 0.6, 0.0))
				p.add_to_group(&"interactable")
			else:
				var cy := sn.shape as CylinderShape3D
				if cy == null:
					cy = CylinderShape3D.new()
					sn.shape = cy
				var hh := float(inf.get("height", 0.5)) * s
				cy.radius = lr * 1.15
				cy.height = hh + 0.2
				sn.position = Vector3(0.0, hh * 0.5 - 0.1, 0.0)
			p.collision_layer = VegProxy.LAYER_VEGETATION
			p.set_meta(&"surface", &"wood")
		Cat.ROCK_BIG:
			sn.shape = _hull(StringName(inf.get("name", "")), s)
			p.collision_layer = VegProxy.LAYER_WORLD
			p.set_meta(&"surface", &"rock")
			if bool(inf.get("talus", false)):
				p.add_to_group(&"interactable")
		Cat.SAPLING:
			var sc := sn.shape as CylinderShape3D
			if sc == null:
				sc = CylinderShape3D.new()
				sn.shape = sc
			sc.radius = clampf(float(inf.get("crown_radius", 0.6)) * s * 0.45, 0.2, 0.6)
			sc.height = minf(float(inf.get("height", 2.0)) * s, 2.2)
			sn.position = Vector3(0.0, sc.height * 0.5, 0.0)
			p.collision_layer = VegProxy.LAYER_INTERACT
			p.set_meta(&"surface", &"wood")
		Cat.SHRUB:
			var ss := sn.shape as CylinderShape3D
			if ss == null:
				ss = CylinderShape3D.new()
				sn.shape = ss
			ss.radius = clampf(float(inf.get("radius", 1.0)) * s * 0.55, 0.25, 1.4)
			ss.height = clampf(float(inf.get("height", 1.0)) * s * 0.8, 0.3, 2.2)
			sn.position = Vector3(0.0, ss.height * 0.5, 0.0)
			p.collision_layer = VegProxy.LAYER_INTERACT
			p.add_to_group(&"interactable")
			p.set_meta(&"surface", &"grass")
		Cat.ROCK_SMALL:
			var sp := sn.shape as SphereShape3D
			if sp == null:
				sp = SphereShape3D.new()
				sn.shape = sp
			sp.radius = clampf(float(inf.get("radius", 0.2)) * s, 0.15, 0.6)
			sn.position = Vector3(0.0, sp.radius * 0.4, 0.0)
			p.collision_layer = VegProxy.LAYER_INTERACT
			p.add_to_group(&"interactable")
			p.set_meta(&"surface", &"rock")


func _hull(kind: StringName, s: float) -> Shape3D:
	var bucket := snappedf(s, 0.05)
	var key := "%s:%.2f" % [kind, bucket]
	if _hull_cache.has(key):
		return _hull_cache[key]
	var ms := VegLibrary.get_shared().meshes(kind)
	var shape: Shape3D
	if ms.is_empty():
		var sp := SphereShape3D.new()
		sp.radius = 1.0 * bucket
		shape = sp
	else:
		var base: Mesh = ms[ms.size() - 1]
		var cvx := base.create_convex_shape(true, true) as ConvexPolygonShape3D
		var pts := PackedVector3Array()
		for q in cvx.points:
			pts.append(q * bucket)
		var out := ConvexPolygonShape3D.new()
		out.points = pts
		shape = out
	_hull_cache[key] = shape
	return shape

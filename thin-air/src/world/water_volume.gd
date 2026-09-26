class_name WaterVolume
extends Area3D
## A lake or river water volume (physics layer 6 "water") — Water stream.
## * Buoyancy: RigidBody3D items/logs (layer 4) inside get an Archimedes lift from the submerged fraction of
##   their bounds, water drag relative to the river current (WaterQuery.flow_at) and extra angular damping:
##   wood floats and drifts downstream, stones sink.
## * Lakes join group "water" and answer get_water_surface() (the Player's sensor uses it on top of
##   TerrainData.get_water_level); river volumes are sloped, so they stay out of that group ("water_river")
##   and everything asks TerrainData for the level there.
## The surface height always comes from TerrainData.get_water_level() — the same number the renderer uses.

const LAYER_WATER := 1 << 5
const MASK_ITEMS := 1 << 3
const WATER_DENSITY := 1000.0
const DRAG := 2.2                     # 1/s linear drag relative to the water
const ANGULAR_DRAG := 1.6
## Items that float whatever their collision bounds say (wood, fibre, hides, empty containers).
const FLOATERS: Array[StringName] = [&"log", &"stick", &"bark", &"feather", &"fiber", &"tinder", &"charcoal",
	&"hide_raw", &"hide_cured", &"wool", &"cloth", &"rope", &"bottle_empty", &"canteen", &"resin", &"berries",
	&"mushroom", &"bone"]
## Items that sink (stone, metal).
const SINKERS: Array[StringName] = [&"stone", &"flint", &"scrap_metal", &"nails", &"wire", &"battery",
	&"fuel_can", &"hatchet", &"felling_axe", &"knife", &"ice_axe", &"crampons", &"o2_bottle", &"cooking_pot"]

var water_id: StringName = &""
var is_lake := false
var lake_level := -INF

var _bodies: Array[RigidBody3D] = []
var _info: Dictionary = {}            # body -> Vector2(half_height, volume m³)


func _init() -> void:
	collision_layer = LAYER_WATER
	collision_mask = MASK_ITEMS
	monitoring = true
	monitorable = true
	gravity_space_override = Area3D.SPACE_OVERRIDE_DISABLED
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)


func setup_lake(id: StringName, level: float) -> void:
	water_id = id
	is_lake = true
	lake_level = level
	add_to_group(&"water")
	add_to_group(&"water_volume_body")


func setup_river(id: StringName) -> void:
	water_id = id
	is_lake = false
	add_to_group(&"water_river")
	add_to_group(&"water_volume_body")


## Player sensor API (lakes): the flat surface height.
func get_water_surface() -> float:
	return lake_level


func get_bodies_in_water() -> Array[RigidBody3D]:
	return _bodies


func _on_body_entered(b: Node3D) -> void:
	var rb := b as RigidBody3D
	if rb == null or _bodies.has(rb):
		return
	_bodies.append(rb)
	_info[rb] = estimate_body(rb)
	set_physics_process(true)


func _on_body_exited(b: Node3D) -> void:
	var rb := b as RigidBody3D
	if rb == null:
		return
	_bodies.erase(rb)
	_info.erase(rb)
	if _bodies.is_empty():
		set_physics_process(false)


func _ready() -> void:
	set_physics_process(false)


## Half height (m) and displacement volume (m³) of a body, from its collision shapes, with the item's
## material (FLOATERS / SINKERS) overriding the bounds-derived density.
static func estimate_body(rb: RigidBody3D) -> Vector2:
	var aabb := AABB()
	var first := true
	for c in rb.get_children():
		var cs := c as CollisionShape3D
		if cs == null or cs.shape == null or cs.disabled:
			continue
		var sa := _shape_aabb(cs.shape)
		sa = cs.transform * sa
		if first:
			aabb = sa
			first = false
		else:
			aabb = aabb.merge(sa)
	if first:
		aabb = AABB(Vector3(-0.1, -0.1, -0.1), Vector3(0.2, 0.2, 0.2))
	var half_h := maxf(minf(aabb.size.y, minf(aabb.size.x, aabb.size.z)) * 0.5, 0.03)
	var vol := maxf(aabb.size.x * aabb.size.y * aabb.size.z * 0.55, 1e-4)
	var id: StringName = &""
	if "item_id" in rb:
		id = StringName(str(rb.get(&"item_id")))
	var mass := maxf(rb.mass, 0.01)
	if FLOATERS.has(id) or rb.is_in_group(&"felled_log") or rb.get_class() == "VegFelledTree" \
			or (rb.get_script() and String(rb.get_script().resource_path).contains("felled")):
		vol = mass / 520.0                        # wood ~520 kg/m³
	elif SINKERS.has(id):
		vol = mass / 2600.0
	return Vector2(half_h, vol)


static func _shape_aabb(s: Shape3D) -> AABB:
	if s is BoxShape3D:
		var e: Vector3 = (s as BoxShape3D).size
		return AABB(-e * 0.5, e)
	if s is SphereShape3D:
		var r: float = (s as SphereShape3D).radius
		return AABB(Vector3(-r, -r, -r), Vector3(r, r, r) * 2.0)
	if s is CapsuleShape3D:
		var cr: float = (s as CapsuleShape3D).radius
		var ch: float = (s as CapsuleShape3D).height
		return AABB(Vector3(-cr, -ch * 0.5, -cr), Vector3(cr * 2.0, ch, cr * 2.0))
	if s is CylinderShape3D:
		var yr: float = (s as CylinderShape3D).radius
		var yh: float = (s as CylinderShape3D).height
		return AABB(Vector3(-yr, -yh * 0.5, -yr), Vector3(yr * 2.0, yh, yr * 2.0))
	if s is ConvexPolygonShape3D:
		var pts: PackedVector3Array = (s as ConvexPolygonShape3D).points
		if pts.size() > 0:
			var a := AABB(pts[0], Vector3.ZERO)
			for p in pts:
				a = a.expand(p)
			return a
	return AABB(Vector3(-0.15, -0.15, -0.15), Vector3(0.3, 0.3, 0.3))


func _physics_process(delta: float) -> void:
	var g := float(ProjectSettings.get_setting("physics/3d/default_gravity", 9.8))
	for i in range(_bodies.size() - 1, -1, -1):
		var rb := _bodies[i]
		if not is_instance_valid(rb):
			_bodies.remove_at(i)
			continue
		if rb.freeze:
			continue
		apply_buoyancy(rb, _info.get(rb, Vector2(0.1, 0.001)), g, delta)


## Archimedes + drag for one body (static so tests can drive it directly).
static func apply_buoyancy(rb: RigidBody3D, info: Vector2, g: float, delta: float) -> float:
	var p := rb.global_position
	var lvl := TerrainData.get_water_level(p.x, p.z)
	if lvl == -INF:
		return 0.0
	var hh := info.x
	var sub := clampf((lvl - (p.y - hh)) / (hh * 2.0), 0.0, 1.0)
	if sub <= 0.0:
		return 0.0
	var lift := WATER_DENSITY * info.y * sub * g
	rb.apply_central_force(Vector3.UP * lift)
	var flow := WaterQuery.flow_at(p)
	var rel := rb.linear_velocity - flow
	rb.apply_central_force(-rel * rb.mass * DRAG * sub)
	rb.angular_velocity *= maxf(1.0 - ANGULAR_DRAG * sub * delta, 0.0)
	if rb.sleeping and (flow.length_squared() > 0.01 or absf(lift - rb.mass * g) > rb.mass * 0.5):
		rb.sleeping = false
	return sub

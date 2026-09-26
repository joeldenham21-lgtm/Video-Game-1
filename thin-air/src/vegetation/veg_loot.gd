extends Node3D
## Forest-floor loot (child "Loot" of Vegetation): a few dry sticks under the trees and loose stones on rocky
## ground, placed deterministically per 64 m scatter cell and spawned as static ItemPickups (the items stream's
## scenes/items/pickup.tscn, `freeze = true`) only within RANGE of the player. Each spot has a stable
## `persist_id`, so ItemsRoot remembers what was picked up and it stays gone after loading. Disabled when the
## pickup scene does not exist.

const PICKUP_SCENE := "res://scenes/items/pickup.tscn"
const RANGE := 28.0
const STEP := 3.0

var vegetation: Node = null
var center_override: Variant = null
var _scene: PackedScene = null
var _active: Dictionary = {}      # key -> Node
var _last := Vector3(INF, INF, INF)
var _items_root_script: Script = null   # items stream's ItemsRoot (static is_key_collected), if present


func _ready() -> void:
	if ResourceLoader.exists(PICKUP_SCENE):
		_scene = load(PICKUP_SCENE) as PackedScene
	for g in ProjectSettings.get_global_class_list():
		if String(g.get("class", "")) == "ItemsRoot":
			var sc := load(String(g.get("path", ""))) as Script
			if sc and sc.has_method(&"is_key_collected"):
				_items_root_script = sc
	set_process(_scene != null)


## Deterministic loot spots of scatter cell (cx, cz): Array of [key, item id, Vector3 position, yaw].
static func cell_spots(ctx: VegScatter.Context, cx: int, cz: int) -> Array:
	var out: Array = []
	var t: Object = ctx.terrain
	var o := VegScatter.cell_origin(cx, cz)
	var mid: Color = t.get_masks(o.x + VegScatter.CELL * 0.5, o.y + VegScatter.CELL * 0.5)
	var rng := RandomNumberGenerator.new()
	rng.seed = VegScatter._hash(cx, cz, 7771)
	var n_sticks := int(round(mid.a * 5.0))
	var n_stones := int(round(clampf(mid.g * 1.5 + mid.b * 0.3, 0.0, 1.0) * 3.0))
	var k := 0
	for i in n_sticks + n_stones:
		var x := o.x + rng.randf() * VegScatter.CELL
		var z := o.y + rng.randf() * VegScatter.CELL
		var yaw := rng.randf() * TAU
		var item: StringName = &"stick" if i < n_sticks else &"stone"
		k += 1
		if not t.in_bounds(x, z, 2.0) or float(t.get_slope_deg(x, z)) > 32.0:
			continue
		var y: float = t.get_height(x, z)
		if VegScatter.in_water(ctx, x, z, y, 0.5) or VegScatter.excluded(ctx, x, z, 1.0):
			continue
		var m: Color = t.get_masks(x, z)
		if m.r > 0.6 or (item == &"stick" and m.a < 0.25):
			continue
		out.append(["veg_loot_%d_%d" % [VegScatter.cell_index(cx, cz), k], item, Vector3(x, y + 0.04, z), yaw])
	return out


func _center() -> Vector3:
	if center_override is Vector3:
		return center_override
	if Game.player and is_instance_valid(Game.player):
		return Game.player.global_position
	if vegetation and vegetation.has_method("_camera_pos"):
		return vegetation._camera_pos()
	return Vector3.ZERO


func _process(_delta: float) -> void:
	if vegetation == null or vegetation.get("ctx") == null:
		return
	var c := _center()
	if c.distance_squared_to(_last) < STEP * STEP:
		return
	_last = c
	var ctx: VegScatter.Context = vegetation.ctx
	var want := {}
	var c0 := VegScatter.cell_of(c.x - RANGE, c.z - RANGE)
	var c1 := VegScatter.cell_of(c.x + RANGE, c.z + RANGE)
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			for s in cell_spots(ctx, cx, cz):
				var p: Vector3 = s[2]
				if Vector2(p.x - c.x, p.z - c.z).length() <= RANGE:
					want[s[0]] = s
	for key in _active.keys():
		var node: Node = _active[key]
		if not is_instance_valid(node) or node.is_queued_for_deletion():
			_active.erase(key)          # picked up (ItemsRoot remembers the key)
		elif not want.has(key):
			node.queue_free()
			_active.erase(key)
	for key in want:
		if _active.has(key) or _collected(key):
			continue
		var s: Array = want[key]
		var pk := _scene.instantiate()
		pk.set("item_id", s[1])
		pk.set("count", 1)
		pk.set("persist_id", key)
		if pk is RigidBody3D:
			(pk as RigidBody3D).freeze = true
		add_child(pk)
		(pk as Node3D).global_position = s[2]
		(pk as Node3D).rotation.y = s[3]
		_active[key] = pk


func _collected(key: String) -> bool:
	return _items_root_script != null and bool(_items_root_script.call(&"is_key_collected", key))

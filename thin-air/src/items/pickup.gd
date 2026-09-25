class_name ItemPickup
extends RigidBody3D
## A world item you can pick up (CONTRACT.md §4 "Pickups"). Physics layer 4 ("items").
## - Dropped/spawned pickups are dynamic rigid bodies, saved by ItemsRoot.
## - Placed world loot uses the same scene with `freeze = true`: it stays put, and once collected it is
##   remembered by ItemsRoot (by `persist_id`, or a key derived from item + position) so it stays gone after load.
## Visual: the item's hero model (ItemDB "model" .glb) when present, else the procedural ItemVisuals model;
## small stackables show a few copies (three sticks look like three sticks).

@export var item_id: StringName = &"":
	set(v):
		item_id = v
		if is_inside_tree():
			_rebuild()
@export var count := 1:
	set(v):
		count = maxi(1, v)
		if is_inside_tree():
			_rebuild()
@export_range(0.0, 1.0) var durability := 1.0
## Stable id for placed loot (optional; derived from item + position when empty).
@export var persist_id := ""

## Set by ItemsRoot.spawn(): a dropped item (saved as part of ItemsRoot's state, never "collected").
var dynamic := false
## Extra per-stack state carried through the world and saves (a canteen's "unsafe" water): JSON-safe values.
var extra: Dictionary = {}
var _visual_root: Node3D
var _shape_node: CollisionShape3D
var _built_key := ""
var _key := ""

const LAYER_ITEMS := 1 << 3
const MASK := 1 | (1 << 3) | (1 << 6) | (1 << 9)   # world, items, building, vegetation


func _ready() -> void:
	collision_layer = LAYER_ITEMS
	collision_mask = MASK
	add_to_group(&"interactable")
	add_to_group(&"item_pickup")
	can_sleep = true
	continuous_cd = false
	linear_damp = 0.4
	angular_damp = 1.2
	if physics_material_override == null:
		var pm := PhysicsMaterial.new()
		pm.friction = 0.85
		pm.bounce = 0.05
		pm.rough = true
		physics_material_override = pm
	_rebuild()
	if not dynamic and freeze:
		freeze_mode = RigidBody3D.FREEZE_MODE_STATIC
		_key = get_loot_key()
		if ItemsRoot.is_key_collected(_key):
			queue_free()


## Key under which collected placed loot is remembered.
func get_loot_key() -> String:
	if persist_id != "":
		return persist_id
	var p := global_position if is_inside_tree() else position
	return "%s@%d,%d,%d" % [item_id, roundi(p.x * 10.0), roundi(p.y * 10.0), roundi(p.z * 10.0)]


# ---------------------------------------------------------------------------------------------- interaction

func get_interact_prompt(_player: Node) -> String:
	if item_id == &"" or not ItemDB.has_item(item_id):
		return ""
	return "Pick up %s" % ItemInfo.stack_text(item_id, count)


func get_interact_hold_time() -> float:
	return 0.35 if float(ItemDB.get_item(item_id).get("weight", 0.0)) >= 8.0 else 0.0


func interact(player: Node) -> void:
	var inv := ItemActions.inventory_of(player)
	if inv == null:
		return
	var n := take_into(inv)
	if n <= 0:
		Game.notify("No room in your pack.", &"warning")
		Audio.play_ui(&"ui_back")
		return
	if inv.is_overweight():
		Game.notify("You're carrying too much.", &"warning")


## Moves as much of this stack as fits into `inv`; frees the pickup when empty. Returns how many were taken.
func take_into(inv: Inventory) -> int:
	var left := count
	if extra.is_empty():
		left = inv.add(item_id, count, durability)
	else:
		var st := extra.duplicate()
		st["id"] = item_id
		st["count"] = count
		st["durability"] = durability
		left = inv.add_stack(st)
	var got := count - left
	if got <= 0:
		return 0
	Events.item_picked_up.emit(item_id, got)
	Game.notify("+%d %s" % [got, ItemInfo.name_of(item_id)], &"item")
	Audio.play_sfx(&"pickup", global_position)
	Blueprints.unlock_for_pickup(item_id)
	if left > 0:
		count = left
	else:
		_collected()
	return got


func _collected() -> void:
	if not dynamic and freeze:
		ItemsRoot.mark_key_collected(_key if _key != "" else get_loot_key())
	queue_free()


func save_data() -> Dictionary:
	var d := {"id": String(item_id), "count": count, "durability": durability, "xf": SaveUtil.xform(global_transform)}
	if not extra.is_empty():
		d["extra"] = extra.duplicate()
	return d


# ---------------------------------------------------------------------------------------------- visuals

func _rebuild() -> void:
	var key := "%s:%d" % [item_id, _copies()]
	if key == _built_key:
		return
	_built_key = key
	if _visual_root:
		_visual_root.queue_free()
		_visual_root = null
	if item_id == &"":
		return
	var d := ItemDB.get_item(item_id)
	var template := _make_visual(d)
	if template == null:
		return
	_visual_root = Node3D.new()
	_visual_root.name = "Visual"
	add_child(_visual_root)
	var box := _aabb_of(template)
	var copies := _copies()
	var offsets := [Vector3.ZERO, Vector3(0.02, box.size.y * 0.85, box.size.z * 0.6), Vector3(-0.03, box.size.y * 0.9, -box.size.z * 0.55)]
	var yaws := [0.0, 9.0, -12.0]
	var total := AABB()
	for i in copies:
		var v: Node3D = template if i == 0 else template.duplicate()
		v.position = offsets[i]
		v.rotation_degrees.y = yaws[i]
		_visual_root.add_child(v)
		var b := box
		b.position += offsets[i]
		total = b if i == 0 else total.merge(b)
	_configure_visuals(_visual_root, box)
	# collision: a box around the visual (cheap and stable for small props)
	if _shape_node == null:
		_shape_node = CollisionShape3D.new()
		_shape_node.name = "Shape"
		add_child(_shape_node)
	var shape := BoxShape3D.new()
	shape.size = total.size.max(Vector3(0.03, 0.02, 0.03))
	_shape_node.shape = shape
	_shape_node.position = total.get_center()
	mass = clampf(float(d.get("weight", 0.2)) * count, 0.05, 40.0)


func _copies() -> int:
	var d := ItemDB.get_item(item_id)
	if int(d.get("stack", 1)) <= 1 or float(d.get("weight", 1.0)) > 2.0:
		return 1
	return clampi(count, 1, 3)


func _make_visual(d: Dictionary) -> Node3D:
	var model := String(d.get("model", ""))
	if model != "" and ResourceLoader.exists(model):
		var ps := load(model) as PackedScene
		if ps:
			var inst := ps.instantiate()
			if inst is Node3D:
				return inst
	var mesh := ItemVisuals.get_mesh(item_id, String(d.get("category", "")))
	if mesh == null:
		return null
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	return mi


func _configure_visuals(root: Node, box: AABB) -> void:
	var mobile := Settings.is_mobile()
	var small := box.get_longest_axis_size() < 0.2
	for n in root.find_children("*", "GeometryInstance3D", true, false):
		var gi := n as GeometryInstance3D
		gi.visibility_range_end = 35.0 if mobile else 70.0
		gi.visibility_range_end_margin = 4.0
		gi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED if mobile \
			else GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		gi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if (mobile and small) \
			else GeometryInstance3D.SHADOW_CASTING_SETTING_ON


static func _aabb_of(n: Node3D) -> AABB:
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		return (n as MeshInstance3D).mesh.get_aabb()
	var out := AABB()
	var first := true
	for c in n.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		if mi.mesh == null:
			continue
		var b := mi.transform * mi.mesh.get_aabb()
		out = b if first else out.merge(b)
		first = false
	return out if not first else AABB(Vector3(-0.1, 0, -0.1), Vector3(0.2, 0.1, 0.2))

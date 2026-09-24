class_name ItemsRoot
extends Node3D
## World "Items" root (scenes/items/items_root.tscn, instanced by world.gd). Owns everything item-related
## that must persist (CONTRACT.md §3 Save): dropped pickups, which placed loot has been collected, and the
## state of storage containers and item stations (campfires, workbenches…) wherever they live in the tree.
## Persistent key "items". Also wires blueprint unlocks to pickup/scan events and makes sure the inventory
## screen exists in the world.
##
## API: spawn_pickup(id, count, pos, impulse := Vector3.ZERO) -> ItemPickup (contract), plus static
## ItemsRoot.spawn(...) usable from anywhere, register_persistent(key, node) for containers/stations.

const PICKUP_SCENE := "res://scenes/items/pickup.tscn"
const INVENTORY_SCREEN := "res://scenes/ui/inventory_screen.tscn"

static var instance: ItemsRoot = null
## Collected placed-loot keys; static so pickups created before/without the root still resolve.
static var _collected: Dictionary = {}

var _registered: Dictionary = {}     # key -> Node with save_state/load_state
var _pending: Dictionary = {}        # key -> state loaded before that node registered
var _pickup_scene: PackedScene


func _enter_tree() -> void:
	instance = self
	add_to_group(&"persistent")
	add_to_group(&"items_root")


func _exit_tree() -> void:
	if instance == self:
		instance = null
		_collected.clear()   # leaving the world (quit to menu / reload): the next world starts clean


func _ready() -> void:
	_pickup_scene = load(PICKUP_SCENE) as PackedScene
	if not Events.item_picked_up.is_connected(_on_item_picked_up):
		Events.item_picked_up.connect(_on_item_picked_up)
	if not Events.scan_completed.is_connected(_on_scan_completed):
		Events.scan_completed.connect(_on_scan_completed)
	_ensure_inventory_screen.call_deferred()


func _ensure_inventory_screen() -> void:
	if not is_inside_tree() or get_tree().get_first_node_in_group(&"inventory_screen") != null:
		return
	if not ResourceLoader.exists(INVENTORY_SCREEN):
		return
	var ps := load(INVENTORY_SCREEN) as PackedScene
	if ps:
		add_child(ps.instantiate())


func _on_item_picked_up(id: StringName, _count: int) -> void:
	Blueprints.unlock_for_pickup(id)


func _on_scan_completed(target_id: StringName) -> void:
	Blueprints.unlock_for_scan(target_id)


# ---------------------------------------------------------------------------------------------- pickups

## Contract API: spawns a dynamic pickup under this root.
func spawn_pickup(id: StringName, count: int, pos: Vector3, impulse := Vector3.ZERO) -> ItemPickup:
	return spawn(id, count, pos, impulse)


## Spawns a dynamic (dropped) pickup under the active ItemsRoot, or the current scene if there is none.
static func spawn(id: StringName, count: int, pos: Vector3, impulse := Vector3.ZERO, durability := 1.0) -> ItemPickup:
	if id == &"" or count <= 0:
		return null
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = instance if instance != null and is_instance_valid(instance) else (tree.current_scene if tree else null)
	if parent == null:
		return null
	var ps: PackedScene = instance._pickup_scene if instance != null and instance._pickup_scene != null else load(PICKUP_SCENE)
	var p := ps.instantiate() as ItemPickup
	p.dynamic = true
	p.item_id = id
	p.count = count
	p.durability = durability
	p.freeze = false
	parent.add_child(p)
	p.global_position = pos
	p.rotation.y = randf() * TAU
	if impulse != Vector3.ZERO:
		p.apply_central_impulse(impulse * p.mass)
		p.apply_torque_impulse(Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * 0.02 * p.mass)
	return p


static func is_key_collected(key: String) -> bool:
	return _collected.has(key)


static func mark_key_collected(key: String) -> void:
	if key != "":
		_collected[key] = true


func dynamic_pickups() -> Array[ItemPickup]:
	var out: Array[ItemPickup] = []
	for c in get_children():
		if c is ItemPickup and (c as ItemPickup).dynamic and not c.is_queued_for_deletion():
			out.append(c)
	return out


# ---------------------------------------------------------------------------------------------- containers / stations

## Storage containers and stations register here so their state is saved no matter who spawned them.
func register_persistent(key: String, node: Node) -> void:
	if key == "" or node == null:
		return
	_registered[key] = node
	if _pending.has(key) and node.has_method("load_state"):
		node.load_state(_pending[key])
		_pending.erase(key)


func unregister_persistent(key: String, node: Node) -> void:
	if _registered.get(key) == node:
		_registered.erase(key)


## Registers with the active root (static convenience for nodes that may load before it).
static func register(key: String, node: Node) -> void:
	if instance != null and is_instance_valid(instance):
		instance.register_persistent(key, node)


static func unregister(key: String, node: Node) -> void:
	if instance != null and is_instance_valid(instance):
		instance.unregister_persistent(key, node)


# ---------------------------------------------------------------------------------------------- save

func get_save_key() -> String:
	return "items"


func save_state() -> Dictionary:
	var dropped := []
	for p in dynamic_pickups():
		dropped.append(p.save_data())
	var collected := []
	for k in _collected:
		collected.append(String(k))
	var nodes := {}
	for k in _pending:
		nodes[k] = _pending[k]
	for k in _registered:
		var n: Node = _registered[k]
		if is_instance_valid(n) and n.has_method("save_state"):
			nodes[k] = n.save_state()
	var out := {"dropped": dropped, "collected": collected, "nodes": nodes}
	# A timed craft already took its ingredients: save them as a refund so a save mid-craft loses nothing.
	var screen := InventoryScreen.get_instance()
	if screen != null and screen.craft_job != null and screen.craft_job.is_running():
		out["craft_refund"] = (screen.craft_job.recipe.get("ingredients", {}) as Dictionary).duplicate()
	return out


func load_state(d: Dictionary) -> void:
	for p in dynamic_pickups():
		p.queue_free()
	_collected.clear()
	for k in d.get("collected", []):
		_collected[String(k)] = true
	for n in get_tree().get_nodes_in_group(&"item_pickup"):
		var p := n as ItemPickup
		if p and not p.dynamic and p.freeze and _collected.has(p.get_loot_key()):
			p.queue_free()
	for e in d.get("dropped", []):
		if not (e is Dictionary):
			continue
		var ed: Dictionary = e
		var id := StringName(ed.get("id", ""))
		if not ItemDB.has_item(id):
			continue
		var p := spawn(id, int(ed.get("count", 1)), Vector3.ZERO, Vector3.ZERO, float(ed.get("durability", 1.0)))
		if p:
			p.global_transform = SaveUtil.to_xform(ed.get("xf", []))
			p.sleeping = true
	var refund: Variant = d.get("craft_refund", null)
	if refund is Dictionary and not (refund as Dictionary).is_empty():
		_refund_after_load.call_deferred(refund)
	var nodes: Dictionary = d.get("nodes", {})
	for k in nodes:
		var n: Node = _registered.get(k)
		if n != null and is_instance_valid(n) and n.has_method("load_state"):
			n.load_state(nodes[k])
		else:
			_pending[k] = nodes[k]


## Runs after every persistent node has loaded (the player's inventory included).
func _refund_after_load(refund: Dictionary) -> void:
	var inv := ItemActions.inventory_of(Game.player)
	for k in refund:
		var id := StringName(k)
		if not ItemDB.has_item(id):
			continue
		var left := inv.add(id, int(refund[k])) if inv != null else int(refund[k])
		if left > 0:
			ItemActions.drop_stack(Game.player, {"id": id, "count": left, "durability": 1.0})

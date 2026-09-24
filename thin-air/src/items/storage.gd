class_name StorageContainer
extends StaticBody3D
## A container with its own Inventory (player-built storage box, cabin shelves, station lockers, wreck cargo).
## Interact to open the inventory screen in transfer mode. Contents persist through ItemsRoot under
## `persist_id` (or a key derived from position), whether the container was placed in a scene or built.

@export var title := "Storage Box"
@export var slot_count := 16
@export var max_weight := 150.0
@export var persist_id := ""
## Initial contents, e.g. {"stick": 4, "cloth": 2}. Applied once; saved state replaces it.
@export var loot: Dictionary = {}
@export var open_sound: StringName = &"wood_creak"
## When set (and the scene has no "Model" child), builds the ItemVisuals model + box collision.
@export var model_id: StringName = &""

var inventory: Inventory
var _persist_key := ""


func _ready() -> void:
	inventory = Inventory.new(slot_count, max_weight)
	for k in loot:
		inventory.add(StringName(k), int(loot[k]))
	add_to_group(&"interactable")
	add_to_group(&"storage")
	if model_id != &"" and get_node_or_null(^"Model") == null:
		ItemVisuals.attach_model(self, model_id, true)
	_persist_key = get_persist_key()
	ItemsRoot.register(_persist_key, self)


func _exit_tree() -> void:
	ItemsRoot.unregister(_persist_key, self)


func get_persist_key() -> String:
	if persist_id != "":
		return persist_id
	var p := global_position
	return "storage@%d,%d,%d" % [roundi(p.x * 10.0), roundi(p.y * 10.0), roundi(p.z * 10.0)]


func get_interact_prompt(_player: Node) -> String:
	if inventory == null:
		return ""
	var n := inventory.size() - inventory.free_slots()
	return "Open %s%s" % [title, "" if n > 0 else " (empty)"]


func interact(_player: Node) -> void:
	var screen := InventoryScreen.get_instance()
	if screen:
		Audio.play_sfx(open_sound, global_position)
		screen.open_container(inventory, title, self)


func save_state() -> Dictionary:
	return {"inv": inventory.to_dict()}


func load_state(d: Dictionary) -> void:
	if d.has("inv"):
		inventory.from_dict(d["inv"])
		if inventory.size() < slot_count:
			inventory.resize(slot_count)

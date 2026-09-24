class_name CraftingStation
extends StaticBody3D
## Base for crafting stations (campfire, workbench, fabricator). A station is an interactable that opens the
## inventory screen on its recipes, is findable by Crafting.available_stations() (group "crafting_station")
## and persists its state through ItemsRoot. Subclasses override is_station_active(), the prompt and state.

@export var station_id: StringName = &"workbench"
@export var display_name := "Workbench"
## Crafting at this station works within this distance (also used for "hand + nearby station" crafting).
@export var use_radius := 3.0
## Stable save id; derived from position when empty.
@export var persist_id := ""
## When set (and the scene has no "Model" child), builds the ItemVisuals model + a box collision for it.
@export var model_id: StringName = &""

var _persist_key := ""


func _ready() -> void:
	add_to_group(Crafting.STATION_GROUP)
	add_to_group(&"interactable")
	if model_id != &"" and get_node_or_null(^"Model") == null:
		_build_station_model()
	_persist_key = get_persist_key()
	ItemsRoot.register(_persist_key, self)


func _build_station_model() -> void:
	ItemVisuals.attach_model(self, model_id, true)


func _exit_tree() -> void:
	ItemsRoot.unregister(_persist_key, self)


func get_persist_key() -> String:
	if persist_id != "":
		return persist_id
	var p := global_position
	return "%s@%d,%d,%d" % [station_id, roundi(p.x * 10.0), roundi(p.y * 10.0), roundi(p.z * 10.0)]


func is_station_active() -> bool:
	return true


## One-line status for the UI header ("Burning · 2 h of fuel"). Empty = none.
func get_station_status() -> String:
	return ""


func get_interact_prompt(_player: Node) -> String:
	return "Use %s" % display_name if is_station_active() else ""


func interact(_player: Node) -> void:
	open_ui()


func open_ui() -> void:
	var screen := InventoryScreen.get_instance()
	if screen:
		screen.open_station(station_id, self)


func save_state() -> Dictionary:
	return {}


func load_state(_d: Dictionary) -> void:
	pass

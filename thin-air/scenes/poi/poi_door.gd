class_name PoiDoor
extends StaticBody3D
## Transition door of a story location (mine adit door, ice-cave mouth, their exits). Interactable (group
## "interactable", collision layer 5 "interact"): moves the player to `target_socket` of the location scene
## `target_site` placed by scenes/poi/structures.gd (interiors live 1 km under the terrain). No story logic:
## `locked_flag` (a Game flag that must be true) lets the story gate it.

@export var target_site: StringName
@export var target_socket: StringName
@export var prompt := "Enter"
@export var hold_time := 0.35
@export var locked_flag: StringName = &""
@export var locked_prompt := "Locked"


func _ready() -> void:
	add_to_group(&"interactable")


func get_interact_prompt(_player: Node) -> String:
	if locked_flag != &"" and not bool(Game.get_flag(locked_flag, false)):
		return locked_prompt
	return prompt


func get_interact_hold_time() -> float:
	return hold_time


func interact(player: Node) -> void:
	if locked_flag != &"" and not bool(Game.get_flag(locked_flag, false)):
		return
	var st := get_tree().get_first_node_in_group(&"poi_structures")
	if st == null or not st.has_method(&"get_socket"):
		return
	var m := st.call(&"get_socket", target_site, target_socket) as Marker3D
	if m == null:
		return
	Audio.play_sfx(&"door_open", global_position)
	if player.has_method(&"teleport"):
		player.call(&"teleport", m.global_position + Vector3.UP * 0.05, rad_to_deg(m.global_rotation.y))
	elif player is Node3D:
		(player as Node3D).global_position = m.global_position
	Audio.play_sfx(&"door_close", m.global_position)

class_name Fabricator
extends CraftingStation
## Kestrel Station's fabricator / oxygen concentrator bench. Works only while the station has power
## (Game flag `power_flag`, set by the story/generator when the generator runs).

@export var power_flag: StringName = &"generator_running"


func _init() -> void:
	station_id = &"fabricator"
	display_name = "Fabricator"
	model_id = &"fabricator"
	use_radius = 2.5


func is_station_active() -> bool:
	return power_flag == &"" or bool(Game.get_flag(power_flag, false))


func get_interact_prompt(_player: Node) -> String:
	return "Use fabricator" if is_station_active() else "Fabricator (no power)"


func interact(_player: Node) -> void:
	if is_station_active():
		Audio.play_sfx(&"radio_beep", global_position)
		open_ui()
	else:
		Game.notify("The fabricator is dark. The station has no power.", &"info")


func get_station_status() -> String:
	return "Online · oxygen concentrator ready" if is_station_active() else "Offline · no power"

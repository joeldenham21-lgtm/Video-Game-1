extends Node3D
## Heat-source slot of a story location (wood stove, station heater), group "heat_source". Inactive until the
## story/items code lights it: set_active(true). Climate reads heat_radius / heat_celsius / is_heat_active().

@export var heat_radius := 4.5
@export var heat_celsius := 18.0
@export var active := false


func is_heat_active() -> bool:
	return active


func set_active(on: bool) -> void:
	active = on

extends Node3D
## Dev/QA stand-in for a burning torch (group heat_source, CONTRACT §3 Climate heat source API).

var heat_radius := 1.8
var heat_celsius := 4.0
var lit := true


func _ready() -> void:
	add_to_group(&"heat_source")
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.62, 0.3)
	l.light_energy = 1.6
	l.omni_range = 9.0
	add_child(l)


func is_heat_active() -> bool:
	return lit

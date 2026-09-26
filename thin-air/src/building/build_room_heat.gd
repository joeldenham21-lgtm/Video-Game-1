class_name BuildRoomHeat
extends Node3D
## Enclosed rooms hold the heat of a fire: while a heat source burns inside the room's shelter area, the whole
## room becomes a gentle heat source (group "heat_source", CONTRACT §3) scaled by how closed the room is.
## Open lean-tos and roofless walls barely trap anything; a closed cabin with a stove fire stays warm corner
## to corner.

const TRAP := 0.5          ## fraction of an inside fire's heat the room redistributes at shelter_factor 1

var area: BuildShelterArea = null
var heat_radius := 4.0
var heat_celsius := 0.0
var _t := 0.0


func _enter_tree() -> void:
	add_to_group(&"heat_source")
	add_to_group(&"room_heat")


func _process(delta: float) -> void:
	_t -= delta
	if _t > 0.0:
		return
	_t = 1.0
	update_now()


func update_now() -> void:
	if area == null or not is_instance_valid(area) or not is_inside_tree():
		heat_celsius = 0.0
		return
	var total := 0.0
	for n in get_tree().get_nodes_in_group(&"heat_source"):
		if n == self or n is BuildRoomHeat or not (n is Node3D):
			continue
		if n.has_method(&"is_heat_active") and not n.call(&"is_heat_active"):
			continue
		var c: Variant = n.get(&"heat_celsius")
		if c == null or float(c) <= 0.0:
			continue
		if area.contains_point((n as Node3D).global_position + Vector3(0.0, 0.3, 0.0)):
			total += float(c)
	var f := clampf(area.shelter_factor, 0.0, 1.0)
	heat_celsius = total * TRAP * f * f


func is_heat_active() -> bool:
	return heat_celsius > 0.05

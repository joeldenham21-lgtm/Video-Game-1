class_name BuildShelterArea
extends Area3D
## A room (or lean-to) of a player-built shelter: group "shelter" with `shelter_factor` (CONTRACT §3 Climate).
## Climate reads the child CollisionShape3D boxes directly (soft inside test), so the area needs no physics
## monitoring.

var shelter_factor := 0.0
## False for helper volumes that only mark a region (e.g. a lean-to's fire reach).
var is_shelter := true


func _init() -> void:
	collision_layer = 0
	collision_mask = 0
	monitoring = false
	monitorable = false


func _enter_tree() -> void:
	if is_shelter:
		add_to_group(&"shelter")


## True if a world point is inside one of the room's boxes.
func contains_point(p: Vector3) -> bool:
	for c in get_children():
		var cs := c as CollisionShape3D
		if cs == null or not (cs.shape is BoxShape3D):
			continue
		var local := cs.global_transform.affine_inverse() * p
		var h := (cs.shape as BoxShape3D).size * 0.5
		if absf(local.x) <= h.x and absf(local.y) <= h.y and absf(local.z) <= h.z:
			return true
	return false

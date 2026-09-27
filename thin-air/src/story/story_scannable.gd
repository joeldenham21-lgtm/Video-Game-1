class_name StoryScannable
extends StaticBody3D
## Survey-scanner target at a story location (wreck engine, headframe, depot, station equipment, relay).
## Group "scannable" + get_scan_id(); unlocks blueprints through get_scan_unlocks() and the data rules
## ("unlock": {"scan": [...]}) that ItemsRoot applies on Events.scan_completed. Layer 5 "interact".

var scan_id: StringName
var unlocks: Array = []


func setup(id: StringName, display: String, unlock_ids: Array, size: Vector3) -> void:
	scan_id = id
	unlocks = unlock_ids
	name = "Scan_%s" % String(id)
	set_meta(&"scan_name", display)
	collision_layer = 1 << 4
	collision_mask = 0
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	cs.shape = box
	add_child(cs)
	add_to_group(&"scannable")


func get_scan_id() -> StringName:
	return scan_id


func get_scan_unlocks() -> Array:
	return unlocks

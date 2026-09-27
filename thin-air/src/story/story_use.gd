class_name StoryUse
extends StaticBody3D
## An invisible story interactable at a location socket (radio, generator, relay, Mara, depot locker…), placed
## by scenes/poi/structures.gd from data/story.json "uses". Layer 5 "interact". Prompt, hold time, requirements
## and effects all come from Story (use_socket / get_use_prompt), so the data drives everything.

var site: StringName
var socket: StringName
var hold := 0.0


func setup(site_id: StringName, socket_name: StringName, cfg: Dictionary) -> void:
	site = site_id
	socket = socket_name
	hold = float(cfg.get("hold", 0.0))
	name = "Use_%s" % String(socket_name).trim_prefix("Use_")
	collision_layer = 1 << 4
	collision_mask = 0
	var sz: Array = cfg.get("size", [0.7, 0.7, 0.7])
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(float(sz[0]), float(sz[1]), float(sz[2]))
	cs.shape = box
	add_child(cs)
	add_to_group(&"interactable")
	add_to_group(&"story_use")


func get_interact_prompt(_player: Node) -> String:
	return Story.get_use_prompt(site, socket)


func get_interact_hold_time() -> float:
	return hold if Story.can_use(site, socket) else 0.0


func interact(player: Node) -> void:
	Story.use_socket(site, socket, player)


# ---------------------------------------------------------------------------------------------- scanning
## A use socket that is also a scanner target (generator, comms rack, relay…): data/story.json "scans".
var scan_id: StringName = &""
var scan_unlocks: Array = []


func make_scannable(id: StringName, display: String, unlock_ids: Array) -> void:
	scan_id = id
	scan_unlocks = unlock_ids
	set_meta(&"scan_name", display)
	add_to_group(&"scannable")


func get_scan_id() -> StringName:
	return scan_id


func get_scan_unlocks() -> Array:
	return scan_unlocks

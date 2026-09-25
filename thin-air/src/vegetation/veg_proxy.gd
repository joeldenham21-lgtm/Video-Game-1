class_name VegProxy
extends StaticBody3D
## Physics stand-in for ONE scattered vegetation instance near the player (pooled by VegColliders; there is
## never a body per tree on the map). Trees, snags, logs and stumps: trunk shapes on layer 10 "vegetation";
## boulders/outcrops: convex hull on layer 1 "world"; shrubs, saplings and small rocks: interaction-only
## shapes on layer 5 "interact" (the player walks through them but can hit / use them).
## Contract (CONTRACT.md §4): group "harvestable" -> harvest_hit() / get_harvest_tool_type(); shrubs, small
## rocks, talus and deadwood are also "interactable" -> get_interact_prompt() / interact(). Everything is
## forwarded to the owning Vegetation's VegHarvest by instance id.

const LAYER_WORLD := 1
const LAYER_INTERACT := 1 << 4
const LAYER_VEGETATION := 1 << 9

var vegetation: Node = null
var instance_id := -1
var kind: StringName = &""
var cat := -1
var shape_node: CollisionShape3D
var shape_node2: CollisionShape3D


func _init() -> void:
	shape_node = CollisionShape3D.new()
	shape_node.name = "Shape"
	add_child(shape_node)
	shape_node2 = CollisionShape3D.new()
	shape_node2.name = "Shape2"
	shape_node2.disabled = true
	add_child(shape_node2)
	collision_mask = 0
	add_to_group(&"harvestable")


func _harvest() -> Node:
	if vegetation and is_instance_valid(vegetation):
		return vegetation.get("harvest")
	return null


## Surface for footstep / impact effects (player melee reads meta "surface").
func get_surface() -> StringName:
	return StringName(get_meta(&"surface", &"wood"))


func get_harvest_tool_type() -> StringName:
	var h := _harvest()
	if h and h.has_method("tool_type_for"):
		return h.tool_type_for(instance_id, cat)
	return &"axe"


func harvest_hit(tool_id: StringName, power: float, hit_position: Vector3, hit_normal: Vector3, player: Node) -> void:
	var h := _harvest()
	if h and h.has_method("hit_instance"):
		h.hit_instance(instance_id, tool_id, power, hit_position, hit_normal, player)


func get_interact_prompt(player: Node) -> String:
	var h := _harvest()
	if h and h.has_method("interact_prompt"):
		return h.interact_prompt(instance_id, player)
	return ""


func get_interact_hold_time() -> float:
	var h := _harvest()
	if h and h.has_method("interact_hold_time"):
		return h.interact_hold_time(instance_id)
	return 0.0


func interact(player: Node) -> void:
	var h := _harvest()
	if h and h.has_method("interact_instance"):
		h.interact_instance(instance_id, player)

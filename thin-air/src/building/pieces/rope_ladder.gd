class_name BuildRopeLadder
extends BuildObject
## Stick rungs on doubled rope, staked at the top of a ledge and hanging 4 m down its face (local −Y, rungs
## facing +Z). Once built it is a climbable ladder volume (Area3D in group "ladder", layer 8 triggers) the
## Player's ladder movement uses; footsteps on the rungs sound as wood.

const LENGTH := 4.0
var ladder: Area3D


func _ready() -> void:
	model_glb = "camp_rope_ladder.glb"
	super._ready()


func _on_built() -> void:
	if ladder != null:
		return
	ladder = Area3D.new()
	ladder.name = "Ladder"
	ladder.collision_layer = 1 << 7
	ladder.collision_mask = 0
	ladder.monitoring = false
	ladder.add_to_group(&"ladder")
	ladder.set_meta(&"surface", &"wood")
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.8, LENGTH + 0.9, 0.9)
	cs.shape = box
	cs.position = Vector3(0.0, -LENGTH * 0.5 + 0.35, 0.35)
	ladder.add_child(cs)
	# the volume faces the climber: its −Z (forward) points at the rungs from the open side
	ladder.rotation.y = PI
	add_child(ladder)


func own_prompt(_player: Node) -> String:
	return ""


func collision_shapes() -> Array:
	var c := CylinderShape3D.new()
	c.radius = 0.06
	c.height = 0.7
	return [[c, Transform3D(Basis.IDENTITY, Vector3(0.0, 0.0, 0.17))]]


func has_own_use() -> bool:
	return false

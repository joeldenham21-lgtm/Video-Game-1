class_name BuildLeanTo
extends BuildObject
## Pole lean-to thatched with bark slabs and spruce boughs, open to the front (+Z) where the fire goes. Once
## built it is a shelter (group "shelter", buildables.json shelter_factor ≈ 0.5) and it reflects the heat of a
## fire burning just in front of it back over the sleeper (a BuildRoomHeat that also counts fires ~2 m out).

var shelter: BuildShelterArea
var _heat: BuildRoomHeat


func _ready() -> void:
	model_glb = "camp_lean_to.glb"
	super._ready()


func _on_built() -> void:
	if shelter != null:
		return
	shelter = BuildShelterArea.new()
	shelter.name = "Shelter"
	shelter.shelter_factor = float(ItemDB.get_buildable(buildable_id).get("shelter_factor", 0.5))
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(3.2, 1.9, 2.4)
	cs.shape = box
	cs.position = Vector3(0.0, 0.9, -0.05)
	shelter.add_child(cs)
	add_child(shelter)
	# the reflector: fires up to ~2.5 m in front count
	var reach := BuildShelterArea.new()
	reach.name = "FireReach"
	reach.is_shelter = false
	var cs2 := CollisionShape3D.new()
	var b2 := BoxShape3D.new()
	b2.size = Vector3(3.6, 2.0, 5.0)
	cs2.shape = b2
	cs2.position = Vector3(0.0, 0.9, 1.3)
	reach.add_child(cs2)
	reach.shelter_factor = 0.55
	add_child(reach)
	_heat = BuildRoomHeat.new()
	_heat.name = "Reflect"
	_heat.area = reach
	_heat.heat_radius = 2.6
	_heat.position = Vector3(0.0, 0.8, -0.1)
	add_child(_heat)
	Climate.refresh_sources()


func collision_shapes() -> Array:
	var slope := atan2(2.0, 2.03)
	var b := BoxShape3D.new()
	b.size = Vector3(3.1, 0.12, 2.85)
	var out: Array = [[b, Transform3D(Basis(Vector3.RIGHT, -slope), Vector3(0.0, 0.88, -0.06))]]
	for x in [-1.4, 1.4]:
		var c := CylinderShape3D.new()
		c.radius = 0.06
		c.height = 1.9
		out.append([c, Transform3D(Basis.IDENTITY, Vector3(x, 0.95, 0.92))])
	return out


func own_prompt(_player: Node) -> String:
	return ""


func has_own_use() -> bool:
	return false

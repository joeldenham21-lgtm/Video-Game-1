class_name BuildWindbreak
extends BuildObject
## Chest-high dry-stone wall, the climber's bivouac wall above the trees: once built it cuts the wind for a
## couple of metres around it (shelter area, buildables.json shelter_factor ≈ 0.3). Footsteps sound as rock.

var shelter: BuildShelterArea


func _ready() -> void:
	model_glb = "camp_windbreak.glb"
	surface = &"rock"
	super._ready()


func _on_built() -> void:
	if shelter != null:
		return
	shelter = BuildShelterArea.new()
	shelter.name = "Shelter"
	shelter.shelter_factor = float(ItemDB.get_buildable(buildable_id).get("shelter_factor", 0.3))
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(3.2, 1.8, 3.4)
	cs.shape = box
	cs.position = Vector3(0.0, 0.85, 0.0)
	shelter.add_child(cs)
	add_child(shelter)
	Climate.refresh_sources()


func collision_shapes() -> Array:
	var b := BoxShape3D.new()
	b.size = Vector3(2.6, 1.1, 0.7)
	return [[b, Transform3D(Basis.IDENTITY, Vector3(0.0, 0.55, 0.12))]]

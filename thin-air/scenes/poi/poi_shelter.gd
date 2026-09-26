extends Area3D
## Shelter volume of a story location (group "shelter"): Climate.get_shelter_at() reads the child box shape and
## this factor (1 = closed, heated-capable interior; lower for tents, ruins and lean-tos).

@export var shelter_factor := 1.0

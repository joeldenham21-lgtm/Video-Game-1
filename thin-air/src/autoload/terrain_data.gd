extends Node
## STUB — owned by the World/Terrain workstream. Flat world until the real heightfield exists.
## Full API: CONTRACT.md §3 "TerrainData".

const SIZE := 2049
const CELL := 1.5
const WORLD_SIZE := 3072.0
const HALF := 1536.0
const FLAT_Y := 1450.0

var heights: PackedFloat32Array
var height_texture: Texture2D
var normal_texture: Texture2D
var mask_texture: Texture2D
var layout: Dictionary = {}
var min_height := FLAT_Y
var max_height := FLAT_Y


func is_loaded() -> bool:
	return false


func get_height(_x: float, _z: float) -> float:
	return FLAT_Y


func get_normal(_x: float, _z: float) -> Vector3:
	return Vector3.UP


func get_slope_deg(_x: float, _z: float) -> float:
	return 0.0


func get_masks(_x: float, _z: float) -> Color:
	return Color(0.2, 0.0, 0.6, 0.3)


func get_surface(_x: float, _z: float) -> StringName:
	return &"grass"


func get_biome(_x: float, _z: float) -> StringName:
	return &"valley"


func get_water_level(_x: float, _z: float) -> float:
	return -INF


func is_in_water(p: Vector3) -> bool:
	return p.y < get_water_level(p.x, p.z)


func get_poi(id: StringName) -> Dictionary:
	for p in all_pois():
		if StringName(p.get("id", "")) == id:
			return p
	return {}


func all_pois() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for p in layout.get("pois", []):
		var d: Dictionary = p.duplicate()
		d["position"] = Vector3(float(p.get("x", 0)), float(p.get("y", FLAT_Y)), float(p.get("z", 0)))
		out.append(d)
	return out


func in_bounds(x: float, z: float, margin := 0.0) -> bool:
	return absf(x) <= HALF - margin and absf(z) <= HALF - margin


func raycast(from: Vector3, dir: Vector3, max_dist: float) -> Dictionary:
	if absf(dir.y) < 1e-5:
		return {"hit": false}
	var t := (FLAT_Y - from.y) / dir.y
	if t < 0.0 or t > max_dist:
		return {"hit": false}
	return {"hit": true, "position": from + dir * t, "normal": Vector3.UP}

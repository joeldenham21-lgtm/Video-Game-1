extends Node3D
## World part "Structures" (src/world/world.gd PARTS -> scenes/poi/structures.tscn): instances every story
## location scene (scenes/poi/<id>.tscn, root PoiSite) at its anchor from data/world_layout.json via TerrainData:
## exteriors at the POI's flat pad (ground height at the anchor) with the yaw below; interiors (mine tunnels, ice
## cave) far below the terrain at INTERIOR_Y under their POI, entered through the Use_Door_* sockets of the
## exterior; entrances at the layout's portal point. Scenes that don't exist yet are skipped.

const INTERIOR_Y := 800.0

## scene id -> [layout poi id, yaw (deg, Godot), kind ("pad" | "interior" | "adit" | "entrance")]
const SITES := {
	&"crash_site": [&"crash_site", 0.0, "pad"],
	&"ranger_cabin": [&"ranger_cabin", -50.0, "pad"],
	&"fire_lookout": [&"fire_lookout", 0.0, "pad"],
	&"ashford_mine": [&"ashford_mine", 0.0, "pad"],
	&"ashford_mine_interior": [&"ashford_mine", 0.0, "interior"],
	&"trapper_cabin": [&"trapper_cabin", 0.0, "pad"],
	&"owens_bivouac": [&"owens_bivouac", 0.0, "pad"],
	&"glacier_camp": [&"glacier_camp", 0.0, "pad"],
	&"ice_cave_entrance": [&"ice_cave", 0.0, "entrance"],
	&"ice_cave": [&"ice_cave", 0.0, "interior"],
	&"kestrel_station": [&"kestrel_station", 0.0, "pad"],
	&"summit_relay": [&"summit", 0.0, "pad"],
}

var sites: Dictionary = {}   # scene id -> PoiSite

## Dev/QA filter: when non-empty only these scene ids are instanced (src/dev/poi_test.gd).
static var only_ids: Array[StringName] = []


func _ready() -> void:
	for id: StringName in SITES:
		if not only_ids.is_empty() and not only_ids.has(id):
			continue
		var path := "res://scenes/poi/%s.tscn" % id
		if not ResourceLoader.exists(path):
			continue
		var xf := placement(id)
		if xf == Transform3D.IDENTITY and not TerrainData.is_loaded():
			continue
		var ps := load(path) as PackedScene
		if ps == null:
			push_warning("Structures: cannot load %s" % path)
			continue
		var node := ps.instantiate() as Node3D
		node.name = String(id)
		add_child(node)
		node.global_transform = xf
		sites[id] = node


func get_site(id: StringName) -> Node3D:
	return sites.get(id)


## World transform of a location scene's root (its local origin = the POI anchor on the ground).
static func placement(id: StringName) -> Transform3D:
	var spec: Array = SITES.get(id, [])
	if spec.is_empty():
		return Transform3D.IDENTITY
	var poi: Dictionary = TerrainData.get_poi(spec[0])
	if poi.is_empty():
		return Transform3D.IDENTITY
	var p: Vector3 = poi["position"]
	var kind: String = spec[2]
	if kind == "entrance" and poi.has("entrance"):
		var e: Dictionary = poi["entrance"]
		p = Vector3(float(e["x"]), 0.0, float(e["z"]))
	if kind == "interior":
		p.y = INTERIOR_Y
	else:
		p.y = TerrainData.get_height(p.x, p.z)
	return Transform3D(Basis(Vector3.UP, deg_to_rad(float(spec[1]))), p)

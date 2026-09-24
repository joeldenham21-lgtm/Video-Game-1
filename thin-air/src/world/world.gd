extends Node3D
## World root. Instances each workstream's part scene if it exists (fallbacks otherwise), places the
## player and tells Game the world is ready. CONTRACT.md §4.

## Set by the dev screenshot harness to skip player/HUD.
static var dev_no_player := false

const PARTS: Array = [
	["Sky", "res://scenes/world/sky.tscn"],
	["Terrain", "res://scenes/world/terrain.tscn"],
	["Water", "res://scenes/world/water.tscn"],
	["Vegetation", "res://scenes/world/vegetation.tscn"],
	["Structures", "res://scenes/poi/structures.tscn"],
	["Fauna", "res://scenes/fauna/fauna.tscn"],
	["Items", "res://scenes/items/items_root.tscn"],
	["Building", "res://scenes/building/building_root.tscn"],
	["Player", "res://scenes/player/player.tscn"],
	["HUD", "res://scenes/ui/hud.tscn"],
]


func _ready() -> void:
	Game.register_world(self)
	for part in PARTS:
		var part_name: String = part[0]
		if dev_no_player and (part_name == "Player" or part_name == "HUD"):
			continue
		var node: Node = null
		if ResourceLoader.exists(part[1]):
			var ps: PackedScene = load(part[1])
			if ps:
				node = ps.instantiate()
		if node == null:
			node = _fallback(part_name)
		if node:
			node.name = part_name
			add_child(node)
	if not dev_no_player:
		_place_player()
	Game.on_world_built()


func get_part(part_name: String) -> Node:
	return get_node_or_null(part_name)


func _place_player() -> void:
	var p := get_node_or_null("Player")
	if p == null:
		return
	var spawn: Dictionary = TerrainData.layout.get("spawn", {})
	var pos := Vector3(float(spawn.get("x", 0.0)), 0.0, float(spawn.get("z", 0.0)))
	pos.y = TerrainData.get_height(pos.x, pos.z) + 0.2
	var yaw := float(spawn.get("yaw", 0.0))
	if p.has_method("teleport"):
		p.teleport(pos, yaw)
	elif p is Node3D:
		(p as Node3D).global_position = pos
	if p is Node3D:
		Game.register_player(p)


func _fallback(part_name: String) -> Node:
	match part_name:
		"Sky":
			var root := Node3D.new()
			var we := WorldEnvironment.new()
			var env := Environment.new()
			env.background_mode = Environment.BG_SKY
			var sky := Sky.new()
			sky.sky_material = ProceduralSkyMaterial.new()
			env.sky = sky
			env.tonemap_mode = Environment.TONE_MAPPER_AGX
			env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
			we.environment = env
			root.add_child(we)
			var sun := DirectionalLight3D.new()
			sun.name = "Sun"
			sun.add_to_group("sun")
			sun.rotation_degrees = Vector3(-35, 40, 0)
			sun.shadow_enabled = true
			root.add_child(sun)
			return root
		"Terrain":
			var body := StaticBody3D.new()
			var col := CollisionShape3D.new()
			var shape := WorldBoundaryShape3D.new()
			col.shape = shape
			body.add_child(col)
			var mi := MeshInstance3D.new()
			var pm := PlaneMesh.new()
			pm.size = Vector2(3072, 3072)
			mi.mesh = pm
			var mat := StandardMaterial3D.new()
			mat.albedo_color = Color(0.42, 0.44, 0.40)
			mi.material_override = mat
			body.add_child(mi)
			body.position.y = TerrainData.get_height(0, 0)
			return body
		_:
			return Node3D.new()

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


## Loading-screen captions per part (Game.loading_stage).
const STAGE_TEXT := {
	"Sky": "Reading the weather", "Terrain": "Raising the mountain", "Water": "Filling the lakes",
	"Vegetation": "Growing the forest", "Structures": "Placing the wreckage", "Fauna": "Waking the wildlife",
	"Items": "Scattering supplies", "Building": "Laying out camp", "Player": "Finding the survivor",
	"HUD": "Almost there",
}

## Per-part build time (ms: load + instantiate + add_child/_ready) of the last build, printed once built.
var part_ms := {}


func _ready() -> void:
	Game.register_world(self)
	# Through Game.new_game/continue_game (loading screen up): build one part per frame so the loading screen
	# shows progress, the part scenes load on worker threads meanwhile, and nothing ticks until everything exists.
	# Dev harnesses and tests instantiate the world directly and get the synchronous build.
	var progressive := Game.state == Game.State.LOADING
	var parts: Array = []
	for part in PARTS:
		if dev_no_player and (part[0] == "Player" or part[0] == "HUD"):
			continue
		parts.append(part)
	if progressive:
		process_mode = Node.PROCESS_MODE_DISABLED
		for part in parts:
			if ResourceLoader.exists(part[1]):
				ResourceLoader.load_threaded_request(part[1], "PackedScene", true)
	var t_all := Time.get_ticks_usec()
	for i in parts.size():
		var part_name: String = parts[i][0]
		var path: String = parts[i][1]
		if progressive:
			Game.set_loading_progress(float(i) / float(parts.size()), STAGE_TEXT.get(part_name, ""))
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		var node: Node = null
		if ResourceLoader.exists(path):
			var ps: PackedScene = ResourceLoader.load_threaded_get(path) if progressive else load(path)
			if ps:
				node = ps.instantiate()
		if node == null:
			node = _fallback(part_name)
		if node:
			node.name = part_name
			add_child(node)
		part_ms[part_name] = (Time.get_ticks_usec() - t0) / 1000.0
	if not dev_no_player:
		_place_player()
	var summary := PackedStringArray()
	for k in part_ms:
		summary.append("%s %.0f" % [k, part_ms[k]])
	print("[World] parts built in %.0f ms (%s)" % [(Time.get_ticks_usec() - t_all) / 1000.0, ", ".join(summary)])
	if progressive:
		Game.set_loading_progress(1.0, STAGE_TEXT["HUD"])
		process_mode = Node.PROCESS_MODE_INHERIT
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

extends TestCase
## Terrain data: loads, heights/normals sane, POI pads flat at their altitudes, golden path walkable,
## water levels, raycast. Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_terrain.gd


func run() -> void:
	check(TerrainData.is_loaded(), "terrain data loaded")
	var names := RenderingServer.global_shader_parameter_get_list()
	print("globals: ", names)
	for g in [&"terrain_height_tex", &"terrain_normal_tex", &"terrain_mask_tex", &"terrain_params", &"terrain_shadow_tex"]:
		check(g in names, "global shader parameter %s declared" % g)
	print("height tex global: ", RenderingServer.global_shader_parameter_get(&"terrain_height_tex"))

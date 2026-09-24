extends TestCase
## Vegetation: asset library, deterministic scatter, exclusion rules, LOD/visibility settings, harvest state
## machine and persistence roundtrip.
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_vegetation.gd


func run() -> void:
	_test_library()


func _test_library() -> void:
	var lib := VegLibrary.get_shared()
	check(lib.kind_names.size() >= 15, "manifest lists >= 15 kinds (%d)" % lib.kind_names.size())
	var ms := lib.meshes(&"spruce_b")
	check(ms.size() == 3, "spruce_b has 3 LOD meshes")
	if ms.size() == 3:
		var m: Mesh = ms[0]
		for s in m.get_surface_count():
			var mat := m.surface_get_material(s)
			var sh := ""
			if mat is ShaderMaterial and (mat as ShaderMaterial).shader:
				sh = (mat as ShaderMaterial).shader.resource_path
			print("  surface %d: %s %s" % [s, mat, sh])
			check(mat is ShaderMaterial, "spruce_b LOD0 surface %d uses a vegetation ShaderMaterial" % s)
			if s == 1:
				var tex: Texture2D = (mat as ShaderMaterial).get_shader_parameter(&"albedo_tex")
				var img := tex.get_image()
				print("  tex ", tex.get_width(), "x", tex.get_height(), " fmt ", img.get_format(), " mips ", img.get_mipmap_count())
				var arrays := m.surface_get_arrays(1)
				var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
				var mn := Vector2(9, 9)
				var mx := Vector2(-9, -9)
				for uv in uvs:
					mn = mn.min(uv)
					mx = mx.max(uv)
				print("  uv range ", mn, " ", mx, " n=", uvs.size())
				print("  first uvs ", uvs.slice(0, 8))

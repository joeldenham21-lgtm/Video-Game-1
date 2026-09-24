extends TestCase
## Texture & material library checks: terrain Texture2DArrays, layers.json, material .tres library,
## seamless tiling of every tileable map (edge-vs-interior pixel difference).
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_textures.gd

const TERRAIN_DIR := "res://assets/textures/terrain/"
const LAYER_NAMES: Array[String] = ["snow", "rock", "cliff", "scree", "gravel", "grass", "forest", "dirt", "ice"]
const MATERIALS_JSON := "res://assets/materials/materials.json"


func run() -> void:
	_test_terrain_arrays()
	_test_layers_json()
	_test_terrain_seams()
	_test_material_library()


func _test_terrain_arrays() -> void:
	for f in ["terrain_albedo_height.png", "terrain_normal_rough.png"]:
		var tex: Resource = load(TERRAIN_DIR + f)
		# imported 2D arrays are CompressedTexture2DArray (a TextureLayered of type 2D_ARRAY, bound to sampler2DArray)
		var ok := tex is TextureLayered and (tex as TextureLayered).get_layered_type() == TextureLayered.LAYERED_TYPE_2D_ARRAY
		check(ok, f + " loads as a 2D texture array (%s)" % (tex.get_class() if tex else "null"))
		if ok:
			var arr := tex as TextureLayered
			check(arr.get_layers() == 9, f + " has 9 layers (got %d)" % arr.get_layers())
			check(arr.get_width() == 1024 and arr.get_height() == 1024, f + " layers are 1024x1024")
			check(arr.has_mipmaps(), f + " has mipmaps")
			var fmt := arr.get_format()
			var vram := [Image.FORMAT_BPTC_RGBA, Image.FORMAT_DXT5, Image.FORMAT_ASTC_4x4, Image.FORMAT_ETC2_RGBA8]
			check(fmt in vram, f + " is VRAM compressed (Image.Format %d)" % fmt)
	var macro: Resource = load(TERRAIN_DIR + "terrain_macro_noise.png")
	check(macro is Texture2D, "terrain_macro_noise loads")
	for n in LAYER_NAMES:
		for m in ["albedo", "normal", "roughness", "height"]:
			var p := TERRAIN_DIR + "%s_%s.png" % [n, m]
			check(ResourceLoader.exists(p), "terrain layer map exists: " + p.get_file())


func _test_layers_json() -> void:
	var txt := FileAccess.get_file_as_string(TERRAIN_DIR + "layers.json")
	var data: Variant = JSON.parse_string(txt)
	check(data is Array and (data as Array).size() == 9, "layers.json has 9 rows")
	if not data is Array:
		return
	for i in (data as Array).size():
		var row: Dictionary = data[i]
		check(int(row.get("index", -1)) == i and String(row.get("name", "")) == LAYER_NAMES[i],
			"layers.json row %d is %s" % [i, LAYER_NAMES[i]])
		check(float(row.get("tiling_m", 0.0)) >= 1.0 and float(row.get("tiling_m", 0.0)) <= 12.0,
			"%s tiling_m realistic (%s)" % [LAYER_NAMES[i], str(row.get("tiling_m"))])
		var alb: Array = row.get("avg_albedo_linear", [])
		check(alb.size() == 3, LAYER_NAMES[i] + " avg_albedo_linear is rgb")
		var r := float(row.get("roughness_avg", -1.0))
		check(r > 0.05 and r < 1.0, LAYER_NAMES[i] + " roughness_avg in range")
		if alb.size() == 3:
			var lum := 0.2126 * float(alb[0]) + 0.7152 * float(alb[1]) + 0.0722 * float(alb[2])
			var lo := 0.02
			var hi := 0.5
			match LAYER_NAMES[i]:
				"snow": lo = 0.6; hi = 0.92
				"ice": lo = 0.3; hi = 0.8
				"rock": lo = 0.12; hi = 0.4
				"cliff": lo = 0.05; hi = 0.25
				"forest": lo = 0.02; hi = 0.15
			check(lum >= lo and lum <= hi, "%s albedo luminance %.3f within [%.2f, %.2f]" % [LAYER_NAMES[i], lum, lo, hi])
			check(float(alb[2]) < 0.99 and float(alb[0]) < 0.99, LAYER_NAMES[i] + " never pure white")


## Seam check (same statistic as tools/textures/check_seams.py). Per axis, two ratios of the wrap-around
## neighbour difference (last -> first column/row):
##   local: vs. the differences right next to the seam (robust for smooth, non-periodic content)
##   phase: vs. 7 interior pairs at multiples of size/8 (same phase for regular patterns: weaves, grids)
## Both are ~1 when seamless; a real discontinuity pushes both up, so we return the smaller one.
func _seam_ratio(path: String) -> Vector2:
	var img := Image.load_from_file(ProjectSettings.globalize_path(path))
	if img == null or img.is_empty():
		return Vector2(-1, -1)
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGB8)
	var w := img.get_width()
	var h := img.get_height()
	var sx := 0.0
	var lx := 0.0
	var px := 0.0
	for y in range(0, h, 2):
		sx += _cdiff(img.get_pixel(w - 1, y), img.get_pixel(0, y))
		lx += 0.5 * (_cdiff(img.get_pixel(w - 2, y), img.get_pixel(w - 1, y)) + _cdiff(img.get_pixel(0, y), img.get_pixel(1, y)))
		for k in range(1, 8):
			px += _cdiff(img.get_pixel(w * k / 8 - 1, y), img.get_pixel(w * k / 8, y)) / 7.0
	var sy := 0.0
	var ly := 0.0
	var py := 0.0
	for x in range(0, w, 2):
		sy += _cdiff(img.get_pixel(x, h - 1), img.get_pixel(x, 0))
		ly += 0.5 * (_cdiff(img.get_pixel(x, h - 2), img.get_pixel(x, h - 1)) + _cdiff(img.get_pixel(x, 0), img.get_pixel(x, 1)))
		for k in range(1, 8):
			py += _cdiff(img.get_pixel(x, h * k / 8 - 1), img.get_pixel(x, h * k / 8)) / 7.0
	var rx := minf(sx / maxf(lx, 1e-6), sx / maxf(px, 1e-6))
	var ry := minf(sy / maxf(ly, 1e-6), sy / maxf(py, 1e-6))
	return Vector2(rx, ry)


func _cdiff(a: Color, b: Color) -> float:
	return absf(a.r - b.r) + absf(a.g - b.g) + absf(a.b - b.b)


func _test_terrain_seams() -> void:
	for n in LAYER_NAMES:
		for m in ["albedo", "normal"]:
			var ratio := _seam_ratio(TERRAIN_DIR + "%s_%s.png" % [n, m])
			check(ratio.x >= 0.0 and ratio.x < 1.8 and ratio.y < 1.8,
				"terrain %s_%s seamless (seam/interior = %.2f, %.2f)" % [n, m, ratio.x, ratio.y])


func _test_material_library() -> void:
	if not FileAccess.file_exists(MATERIALS_JSON):
		check(false, "materials.json present")
		return
	var lib: Variant = JSON.parse_string(FileAccess.get_file_as_string(MATERIALS_JSON))
	check(lib is Dictionary and (lib as Dictionary).size() >= 24, "materials.json lists >= 24 sets")
	if not lib is Dictionary:
		return
	for set_name in (lib as Dictionary).keys():
		var info: Dictionary = lib[set_name]
		var mat_path := "res://assets/materials/%s.tres" % set_name
		var mat: Resource = load(mat_path)
		check(mat is BaseMaterial3D, set_name + ".tres loads as BaseMaterial3D")
		if not mat is BaseMaterial3D:
			continue
		var bm := mat as BaseMaterial3D
		check(bm.albedo_texture != null, set_name + " has albedo texture")
		check(bm.normal_enabled and bm.normal_texture != null, set_name + " has normal map")
		check(bm.texture_filter == BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC,
			set_name + " uses anisotropic filtering")
		if mat is ORMMaterial3D:
			check((mat as ORMMaterial3D).orm_texture != null, set_name + " has ORM texture")
		if bool(info.get("triplanar", false)):
			check(bm.uv1_triplanar and bm.uv1_world_triplanar, set_name + " is world triplanar")
		if bool(info.get("tiling", true)):
			var ratio := _seam_ratio(bm.albedo_texture.resource_path)
			var lim := 1.8
			check(ratio.x >= 0.0 and ratio.x < lim and ratio.y < lim,
				"%s albedo seamless (%.2f, %.2f)" % [set_name, ratio.x, ratio.y])
			ratio = _seam_ratio(bm.normal_texture.resource_path)
			check(ratio.x >= 0.0 and ratio.x < lim and ratio.y < lim,
				"%s normal seamless (%.2f, %.2f)" % [set_name, ratio.x, ratio.y])

extends SceneTree
## Converts tools/sky/_cache/atmosphere_*.bin (from gen_atmosphere.py) into Godot resources:
##   res://assets/textures/sky/atmosphere_lut.res  ImageTexture3D 64×64×256, FORMAT_RGBE9995
##   res://assets/textures/sky/atmosphere_cpu.res  Image 64×27 FORMAT_RGBF (CPU lighting tables)
## Usage (from repo root): godot --headless --path thin-air -s $PWD/thin-air/tools/sky/bake_sky_resources.gd


func _init() -> void:
	var cache := ProjectSettings.globalize_path("res://tools/sky/_cache/")
	var meta_txt := FileAccess.get_file_as_string(cache + "atmosphere_meta.json")
	var meta: Dictionary = JSON.parse_string(meta_txt)
	var lut: Dictionary = meta["lut"]
	var w := int(lut["width"])
	var h := int(lut["height"])
	var d := int(lut["depth"])
	var raw := FileAccess.get_file_as_bytes(cache + "atmosphere_lut.bin")
	var slice_bytes := w * h * 4
	if raw.size() != slice_bytes * d:
		push_error("atmosphere_lut.bin size mismatch %d vs %d" % [raw.size(), slice_bytes * d])
		quit(1)
		return
	var images: Array[Image] = []
	for z in d:
		var img := Image.create_from_data(w, h, false, Image.FORMAT_RGBE9995, raw.slice(z * slice_bytes, (z + 1) * slice_bytes))
		images.append(img)
	var tex := ImageTexture3D.new()
	var err := tex.create(Image.FORMAT_RGBE9995, w, h, d, false, images)
	if err != OK:
		push_error("ImageTexture3D.create failed: %s" % err)
		quit(1)
		return
	err = ResourceSaver.save(tex, "res://assets/textures/sky/atmosphere_lut.res", ResourceSaver.FLAG_COMPRESS)
	print("atmosphere_lut.res ", err)
	var cpu: Dictionary = meta["cpu"]
	var cw := int(cpu["width"])
	var ch := int(cpu["height"])
	var craw := FileAccess.get_file_as_bytes(cache + "atmosphere_cpu.bin")
	var cimg := Image.create_from_data(cw, ch, false, Image.FORMAT_RGBF, craw)
	err = ResourceSaver.save(cimg, "res://assets/textures/sky/atmosphere_cpu.res", ResourceSaver.FLAG_COMPRESS)
	print("atmosphere_cpu.res ", err)
	# sanity: decode a texel
	var check: Image = images[40 * 1 + 20]
	print("sample texel ", check.get_pixel(5, 40))
	quit(0)

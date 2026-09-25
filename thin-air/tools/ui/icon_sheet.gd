extends SceneTree
## QA contact sheet of assets/ui/icons/*.svg (Godot's own SVG rasterizer, the one the game uses).
## godot --headless --path thin-air -s res://../thin-air/tools/ui/icon_sheet.gd is not possible (tools/ has
## .gdignore), so run: godot --headless -s <abs path>/icon_sheet.gd -- <icons dir> <out.png>

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var dir := args[0]
	var out := args[1]
	var files: PackedStringArray = []
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".svg"):
			files.append(f)
	files.sort()
	var cell := 112
	var cols := 10
	var rows := int(ceil(files.size() / float(cols)))
	var sheet := Image.create(cols * cell, rows * cell, false, Image.FORMAT_RGBA8)
	sheet.fill(Color(0.1, 0.11, 0.12))
	for i in files.size():
		var src := FileAccess.get_file_as_string(dir.path_join(files[i]))
		var img := Image.new()
		img.load_svg_from_string(src, 3.0)
		var x := (i % cols) * cell + (cell - img.get_width()) / 2
		var y := (i / cols) * cell + 12
		sheet.blend_rect(img, Rect2i(Vector2i.ZERO, img.get_size()), Vector2i(x, y))
	sheet.save_png(out)
	print("sheet: ", out, " (", files.size(), " icons)")
	for i in files.size():
		if i % cols == 0:
			printraw("\nrow %d: " % (i / cols))
		printraw(files[i].get_basename() + "  ")
	print("")
	quit()

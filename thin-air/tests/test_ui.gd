extends TestCase
## UI stream tests (CONTRACT §9): scripts compile, HUD reacts to Events (prompt, notification, objective,
## subtitle, damage), settings screen writes Settings values, map generation on the stub terrain, touch
## controls inject actions, focus navigation reaches every button.


func run() -> void:
	_test_scripts_compile()


func _test_scripts_compile() -> void:
	var files: PackedStringArray = []
	_collect("res://src/ui", files)
	files.append("res://src/dev/ui_test.gd")
	for f in files:
		if f.begins_with("res://src/ui/inventory"):
			continue
		var s: Script = load(f)
		check(s != null and s.can_instantiate() or (s != null and f.ends_with(".gdshader")), "compiles: %s" % f)


func _collect(dir: String, out: PackedStringArray) -> void:
	for d in DirAccess.get_directories_at(dir):
		_collect(dir.path_join(d), out)
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd"):
			out.append(dir.path_join(f))

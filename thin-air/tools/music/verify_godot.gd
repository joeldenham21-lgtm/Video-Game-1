# Verifies the imported music in Godot itself: every entry of data/music.json must load as an
# AudioStreamOggVorbis whose loop flag and length match the JSON. Prints PASS/FAIL lines.
# Run (after `godot --headless --path thin-air --import`):
#   godot --headless --path thin-air -s $PWD/thin-air/tools/music/verify_godot.gd
extends SceneTree


func _init() -> void:
	var f := FileAccess.open("res://data/music.json", FileAccess.READ)
	if f == null:
		print("RESULT FAIL (no data/music.json)")
		quit(1)
		return
	var data: Dictionary = JSON.parse_string(f.get_as_text())
	var bad := 0
	for key: String in data.keys():
		var e: Dictionary = data[key]
		var s := load(String(e["file"])) as AudioStreamOggVorbis
		if s == null:
			print("FAIL %-20s cannot load %s" % [key, e["file"]])
			bad += 1
			continue
		var ok := s.loop == bool(e["loop"]) and absf(s.get_length() - float(e["duration_s"])) < 0.05
		print("%s %-20s loop=%-5s length=%7.3fs  loop_offset=%.1f" % ["PASS" if ok else "FAIL", key,
				s.loop, s.get_length(), s.loop_offset])
		if not ok:
			bad += 1
	print("RESULT %s" % ("PASS" if bad == 0 else "FAIL"))
	quit(1 if bad else 0)

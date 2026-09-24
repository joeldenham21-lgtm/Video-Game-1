extends TestCase
## Music stream (tools/music): data/music.json schema + imported OGG streams (loop flags, lengths).
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_music.gd

const STATES: Array[String] = ["menu", "explore", "forest", "night", "alpine", "station", "danger",
	"blizzard", "summit", "finale"]
const LOOPING: Array[String] = ["explore", "forest", "night", "alpine", "station", "danger", "blizzard"]
const STINGERS: Array[String] = ["discovery", "danger", "objective", "death", "blueprint"]
const FIELDS: Array[String] = ["file", "loop", "bpm", "key", "intensity", "duration_s"]


func run() -> void:
	var f := FileAccess.open("res://data/music.json", FileAccess.READ)
	check(f != null, "data/music.json exists")
	if f == null:
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	check(parsed is Dictionary, "music.json parses to a Dictionary")
	if not parsed is Dictionary:
		return
	var data: Dictionary = parsed
	for s in STATES:
		check(data.has(s), "cue '%s' present" % s)
	for s in STINGERS:
		check(data.has("stinger_" + s), "stinger '%s' present" % s)
	for key: String in data.keys():
		var e: Dictionary = data[key]
		var ok_fields := true
		for fld in FIELDS:
			ok_fields = ok_fields and e.has(fld)
		check(ok_fields, "%s has fields %s" % [key, FIELDS])
		if not ok_fields:
			continue
		var intensity := float(e["intensity"])
		check(intensity >= 0.0 and intensity <= 1.0, "%s intensity in 0..1" % key)
		var stream := load(String(e["file"])) as AudioStreamOggVorbis
		check(stream != null, "%s loads as AudioStreamOggVorbis" % key)
		if stream == null:
			continue
		check(stream.loop == bool(e["loop"]), "%s loop flag matches json (%s)" % [key, e["loop"]])
		var length := stream.get_length()
		check(absf(length - float(e["duration_s"])) < 0.05, "%s length %.2fs matches json" % [key, length])
		if key in LOOPING:
			check(stream.loop and length >= 85.0, "%s is a long loop" % key)
		if key.begins_with("stinger_"):
			check(not stream.loop and length >= 3.0 and length <= 11.0, "%s is a short one-shot" % key)

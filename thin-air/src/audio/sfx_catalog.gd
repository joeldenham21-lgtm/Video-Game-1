extends RefCounted
## SFX catalog: parses data/sfx.json into typed entries and caches AudioStreams.
## Owned by the Audio workstream. Used only through the Audio autoload.

const PATH := "res://data/sfx.json"

## Categories whose streams are warmed up at boot (small, frequently used) so the first footstep never hitches.
const PRELOAD_CATEGORIES: Array[String] = ["foot", "ui", "body", "handling", "breath", "swing", "tool", "device", "radio"]

class Entry:
	var id: StringName
	var files: PackedStringArray = PackedStringArray()
	var bus: StringName = &"SFX"
	var volume_db := 0.0
	var pitch_var := 0.0
	var max_distance := 60.0
	var unit_size := 4.0
	var loop := false
	var cooldown := 0.0
	var max_voices := 4
	var category := ""
	var doppler := false
	var group: StringName = &""
	var streams: Array[AudioStream] = []
	var last_index := -1


var entries: Dictionary = {}          # StringName -> Entry
var _warned: Dictionary = {}
var _pending: PackedStringArray = PackedStringArray()


func load_catalog(path: String = PATH) -> bool:
	entries.clear()
	if not FileAccess.file_exists(path):
		push_warning("Audio: %s missing — all SFX silent" % path)
		return false
	var txt := FileAccess.get_file_as_string(path)
	var data: Variant = JSON.parse_string(txt)
	if not (data is Dictionary):
		push_warning("Audio: cannot parse %s" % path)
		return false
	for k in (data as Dictionary):
		var d: Dictionary = data[k]
		var e := Entry.new()
		e.id = StringName(k)
		for f in d.get("files", []):
			e.files.append(String(f))
		e.bus = StringName(d.get("bus", "SFX"))
		e.volume_db = float(d.get("volume_db", 0.0))
		e.pitch_var = float(d.get("pitch_var", 0.0))
		e.max_distance = float(d.get("max_distance", 60.0))
		e.unit_size = float(d.get("unit_size", 4.0))
		e.loop = bool(d.get("loop", false))
		e.cooldown = float(d.get("cooldown", 0.0))
		e.max_voices = int(d.get("max_voices", 4))
		e.category = String(d.get("category", ""))
		e.doppler = bool(d.get("doppler", false))
		e.group = StringName(d.get("group", "footstep" if String(k).begins_with("step_") or String(k) == "crampon_step" else k))
		entries[e.id] = e
	return true


func has(id: StringName) -> bool:
	return entries.has(id)


func get_entry(id: StringName) -> Entry:
	var e: Entry = entries.get(id)
	if e == null and not _warned.has(id):
		_warned[id] = true
		push_warning("Audio: unknown sfx id '%s'" % id)
	return e


## Start background loads for small, frequently used categories.
func warm_up() -> void:
	for id in entries:
		var e: Entry = entries[id]
		if not PRELOAD_CATEGORIES.has(e.category):
			continue
		for f in e.files:
			if ResourceLoader.exists(f):
				if ResourceLoader.load_threaded_request(f, "AudioStream") == OK:
					_pending.append(f)


## Returns a stream for the entry (random variation, never the same file twice in a row).
func pick_stream(e: Entry) -> AudioStream:
	var n := e.files.size()
	if n == 0:
		return null
	if e.streams.size() != n:
		e.streams.resize(n)
	var idx := 0
	if n > 1:
		idx = randi() % n
		if idx == e.last_index:
			idx = (idx + 1 + randi() % (n - 1)) % n
	e.last_index = idx
	var s: AudioStream = e.streams[idx]
	if s == null:
		s = _load(e.files[idx], e.loop)
		e.streams[idx] = s
	return s


func stream_at(e: Entry, idx: int) -> AudioStream:
	if idx < 0 or idx >= e.files.size():
		return null
	if e.streams.size() != e.files.size():
		e.streams.resize(e.files.size())
	if e.streams[idx] == null:
		e.streams[idx] = _load(e.files[idx], e.loop)
	return e.streams[idx]


func _load(path: String, loop: bool) -> AudioStream:
	var s: AudioStream = null
	if _pending.has(path):
		var st := ResourceLoader.load_threaded_get_status(path)
		if st == ResourceLoader.THREAD_LOAD_LOADED or st == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			s = ResourceLoader.load_threaded_get(path) as AudioStream
		_pending.remove_at(_pending.find(path))
	if s == null and ResourceLoader.exists(path):
		s = load(path) as AudioStream
	if s == null:
		if not _warned.has(path):
			_warned[path] = true
			push_warning("Audio: cannot load %s" % path)
		return null
	if "loop" in s:
		s.set("loop", loop)
	return s

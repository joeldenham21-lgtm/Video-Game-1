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


func release() -> void:
	for id in entries:
		var e: Entry = entries[id]
		e.streams.clear()
	entries.clear()
	_pending.clear()


func has(id: StringName) -> bool:
	return entries.has(id)


func get_entry(id: StringName) -> Entry:
	var e: Entry = entries.get(id)
	if e == null and not _warned.has(id):
		_warned[id] = true
		push_warning("Audio: unknown sfx id '%s'" % id)
	return e


## Queue small, frequently used streams for warm-up; warm_step() loads a few per frame so the first
## footstep/UI click never hitches and boot is not blocked.
func warm_up() -> void:
	_pending.clear()
	for id in entries:
		var e: Entry = entries[id]
		if PRELOAD_CATEGORIES.has(e.category):
			_pending.append(String(id))


func warm_step(count: int) -> void:
	while count > 0 and not _pending.is_empty():
		var id := StringName(_pending[_pending.size() - 1])
		_pending.remove_at(_pending.size() - 1)
		var e: Entry = entries.get(id)
		if e:
			for i in e.files.size():
				stream_at(e, i)
		count -= 1


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
	if ResourceLoader.exists(path):
		s = load(path) as AudioStream
	if s == null:
		if not _warned.has(path):
			_warned[path] = true
			push_warning("Audio: cannot load %s" % path)
		return null
	if "loop" in s:
		s.set("loop", loop)
	return s

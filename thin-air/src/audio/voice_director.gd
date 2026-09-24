extends Node
## Voice lines (radio transmissions, dictaphone logs, the prologue) with timed subtitles.
## data/voice.json: line_id -> {file, speaker, text, radio, duration_s, kind?, segments?: [{t, d, text}]}
## Subtitles are emitted per segment (sentence) through Events.subtitle(speaker, text, duration).
## Voice keeps playing while the game is paused for inventory/journal, and pauses with the pause menu.

signal line_started(line_id: StringName)
signal line_finished(line_id: StringName)

const PATH := "res://data/voice.json"

var lines: Dictionary = {}
var current: StringName = &""
var player: AudioStreamPlayer
var player3d: AudioStreamPlayer3D = null

var _segments: Array = []
var _seg := 0
var _speaker := ""
var _active: Node = null
var _clock := 0.0
var _duration := 0.0
var _missing_audio := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	player = AudioStreamPlayer.new()
	player.name = "Voice"
	player.bus = &"Voice"
	add_child(player)
	player.finished.connect(_on_finished)
	load_lines()


func load_lines(path: String = PATH) -> void:
	lines.clear()
	if not FileAccess.file_exists(path):
		return
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if v is Dictionary:
		for k in v:
			lines[StringName(k)] = v[k]


func has_line(id: StringName) -> bool:
	return lines.has(id)


func get_line(id: StringName) -> Dictionary:
	return lines.get(id, {})


func is_playing() -> bool:
	return current != &""


## Plays a line (2D, or attached to `node` when given). Returns its duration in seconds (0 if unknown).
func play(id: StringName, node: Node3D = null) -> float:
	var e: Dictionary = lines.get(id, {})
	if e.is_empty():
		push_warning("Audio: unknown voice line '%s'" % id)
		return 0.0
	stop(false)
	var path := String(e.get("file", ""))
	var stream: AudioStream = null
	if path != "" and ResourceLoader.exists(path):
		stream = load(path) as AudioStream
	_duration = float(e.get("duration_s", 0.0))
	if stream:
		if "loop" in stream:
			stream.set("loop", false)
		if _duration <= 0.0:
			_duration = stream.get_length()
	if _duration <= 0.0:
		_duration = maxf(1.5, String(e.get("text", "")).length() / 15.0)
	_speaker = String(e.get("speaker", ""))
	_segments = e.get("segments", [])
	if _segments.is_empty():
		_segments = [{"t": 0.0, "d": _duration, "text": String(e.get("text", ""))}]
	_seg = 0
	_clock = 0.0
	current = id
	_missing_audio = stream == null
	if stream:
		if node and is_instance_valid(node):
			if player3d == null or not is_instance_valid(player3d):
				player3d = AudioStreamPlayer3D.new()
				player3d.name = "Voice3D"
				player3d.bus = &"Voice"
				player3d.unit_size = 3.0
				player3d.max_distance = 30.0
				player3d.process_mode = Node.PROCESS_MODE_ALWAYS
				player3d.finished.connect(_on_finished)
			if player3d.get_parent() != node:
				if player3d.get_parent():
					player3d.get_parent().remove_child(player3d)
				node.add_child(player3d)
			player3d.stream = stream
			player3d.play()
			_active = player3d
		else:
			player.stream = stream
			player.stream_paused = false
			player.play()
			_active = player
	line_started.emit(id)
	_emit_due()
	return _duration


func stop(clear_subtitle := true) -> void:
	if current == &"":
		return
	var id := current
	current = &""
	player.stop()
	if player3d and is_instance_valid(player3d):
		player3d.stop()
	_active = null
	if clear_subtitle:
		Events.subtitle.emit("", "", 0.0)
	line_finished.emit(id)


func set_paused(p: bool) -> void:
	player.stream_paused = p
	if player3d and is_instance_valid(player3d):
		player3d.stream_paused = p


func _position() -> float:
	if _active and is_instance_valid(_active) and _active.has_method("get_playback_position") and _active.get("playing"):
		return _active.get_playback_position()
	return _clock


func _process(delta: float) -> void:
	if current == &"":
		return
	if not player.stream_paused:
		_clock += delta
	_emit_due()
	# lines without audio (missing file) still finish on time so story flow never stalls
	if _missing_audio and _clock >= _duration:
		_on_finished()


func _emit_due() -> void:
	var pos := _position()
	while _seg < _segments.size():
		var s: Dictionary = _segments[_seg]
		if float(s.get("t", 0.0)) > pos + 0.02:
			break
		Events.subtitle.emit(_speaker, String(s.get("text", "")), float(s.get("d", 3.0)))
		_seg += 1


func _on_finished() -> void:
	if current == &"":
		return
	var id := current
	current = &""
	_active = null
	line_finished.emit(id)

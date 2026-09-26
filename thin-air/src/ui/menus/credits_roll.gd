class_name CreditsRoll
extends Control
## Credits roll: the built-in credits (tools, music, sound, voices, type, cast) followed by every licence row
## of assets/CREDITS.md. Scrolls slowly; hold accept / touch to speed up, Back to leave.

signal finished()

const SPEED := 46.0
const MD_PATH := "res://assets/CREDITS.md"

const SECTIONS := [
	["", ["A game made with Godot, Blender, Python and a great deal of care."]],
	["Developed with", ["Claude Code (Anthropic)"]],
	["Made with", ["Godot Engine 4.7 — MIT licence", "Blender 4.0 — models, icons, bakes", "Python · NumPy · SciPy · Pillow — terrain, textures, audio",
		"FluidSynth · SoX · FFmpeg — music and sound", "Piper — neural text to speech"]],
	["World", ["Terrain, textures and materials generated in-house", "Physically based sky, atmosphere and weather", "No photographs, no scanned assets"]],
	["Music", ["Original score for THIN AIR, written note by note", "Rendered with the MuseScore General SoundFont (S. Christian Collins) — MIT"]],
	["Sound", ["Every sound synthesised from physical models", "Wind, water, fire, footsteps, wildlife — no recorded samples"]],
	["Voices", ["Piper TTS (rhasspy) · en-US LibriTTS high", "LibriTTS corpus (Zen et al., 2019), from LibriVox public-domain audiobooks — CC BY 4.0"]],
	["Type", ["IBM Plex Sans and IBM Plex Mono (IBM) — SIL Open Font License 1.1", "Inter (Rasmus Andersson) — SIL Open Font License 1.1"]],
	["Characters", ["Sam Calder", "Dr. Mara Voss", "Dr. Elias Hale", "Tomas Reyes", "June Park", "Owen Burke", "Dale Morrow"]],
]

var _content: VBoxContainer
var _y := 0.0
var _done := false
var root: Control


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	process_mode = Node.PROCESS_MODE_ALWAYS
	var bg := ColorRect.new()
	bg.color = Color(0.01, 0.012, 0.016, 0.82)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	root = Control.new()
	root.clip_contents = true
	add_child(root)
	_content = UITheme.vbox(6)
	root.add_child(_content)
	_build()
	get_viewport().size_changed.connect(_layout)
	_layout()
	_y = root.size.y * 0.75


static func licence_rows() -> Array[PackedStringArray]:
	var out: Array[PackedStringArray] = []
	if not FileAccess.file_exists(MD_PATH):
		return out
	var txt := FileAccess.get_file_as_string(MD_PATH)
	for line in txt.split("\n"):
		var l := line.strip_edges()
		if not l.begins_with("|") or l.begins_with("|---") or l.begins_with("| Asset") or l.begins_with("| ---"):
			continue
		var cells := l.trim_prefix("|").trim_suffix("|").split("|")
		if cells.size() < 3:
			continue
		var row := PackedStringArray()
		for c in cells:
			row.append(c.strip_edges().replace("`", "").replace("**", ""))
		out.append(row)
	return out


func _build() -> void:
	var title := UITheme.label("THIN AIR", 84, UITheme.TEXT, "Light")
	title.add_theme_font_override("font", UITheme.caps_font("Light", 22))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_content.add_child(title)
	for s in SECTIONS:
		_gap(40)
		if String(s[0]) != "":
			var h := UITheme.caps(String(s[0]), 15, UITheme.ACCENT, 5)
			h.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			_content.add_child(h)
			_gap(6)
		for line in s[1]:
			var l := UITheme.label(String(line), UITheme.FS_LEAD, UITheme.TEXT, "Light")
			l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			_content.add_child(l)
	var rows := licence_rows()
	if not rows.is_empty():
		_gap(56)
		var h2 := UITheme.caps("Assets and licences", 15, UITheme.ACCENT, 5)
		h2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_content.add_child(h2)
		for r in rows:
			_gap(12)
			var a := UITheme.label(r[0], UITheme.FS_BODY, UITheme.TEXT, "Medium")
			a.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			a.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			_content.add_child(a)
			var b := UITheme.label("%s — %s" % [r[1], r[2]], UITheme.FS_SMALL, UITheme.TEXT_DIM)
			b.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			_content.add_child(b)
	_gap(120)
	var end := UITheme.label("Thank you for playing.", UITheme.FS_H2, UITheme.TEXT, "Light")
	end.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_content.add_child(end)


func _gap(h: float) -> void:
	var c := Control.new()
	c.custom_minimum_size.y = h
	_content.add_child(c)


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var w := minf(root.size.x - 120.0, 1100.0)
	_content.custom_minimum_size.x = w
	_content.size = Vector2(w, _content.get_combined_minimum_size().y)
	_content.position.x = (root.size.x - w) * 0.5


func _process(delta: float) -> void:
	if _done:
		return
	var fast := Input.is_action_pressed(&"ui_accept") or Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	_y -= delta * SPEED * (5.0 if fast else 1.0)
	_content.position.y = _y
	if _y + _content.size.y < root.size.y * 0.45:
		_done = true
		finished.emit()


func _input(event: InputEvent) -> void:
	InputGlyphs.track(event)
	if event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause"):
		get_viewport().set_input_as_handled()
		UISounds.back()
		_done = true
		finished.emit()

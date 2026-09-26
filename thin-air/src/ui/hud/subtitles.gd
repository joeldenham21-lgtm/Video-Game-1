class_name HUDSubtitles
extends PanelContainer
## Subtitles (Events.subtitle(speaker, text, duration); empty text clears). Speaker in tracked caps above
## the line, readable size, soft translucent backing. Respects Settings "subtitles".

const MAX_W := 1100.0

var _speaker: Label
var _text: Label
var _t := 0.0
var _enabled := true


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := UITheme.panel(Color(0.02, 0.025, 0.03, 0.58), 5, Color(0, 0, 0, 0), 0, 0)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 10
	sb.content_margin_bottom = 12
	add_theme_stylebox_override("panel", sb)
	var v := UITheme.vbox(2)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(v)
	_speaker = UITheme.caps("", 14, UITheme.DISCOVERY, 3)
	_speaker.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_speaker)
	_text = UITheme.label("", 27, UITheme.TEXT, "Regular")
	_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(_text)
	visible = false
	_apply_settings()
	Events.settings_changed.connect(_apply_settings)


func _apply_settings() -> void:
	_enabled = bool(Settings.get_value(&"subtitles", true))
	if not _enabled:
		visible = false


func show_line(speaker: String, text: String, duration: float) -> void:
	if text.strip_edges() == "":
		_t = minf(_t, 0.25)
		return
	if not _enabled:
		return
	_speaker.text = speaker.to_upper()
	_speaker.visible = speaker != ""
	_text.text = text
	var f := _text.get_theme_font("font")
	var w := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 27).x if f else MAX_W
	_text.custom_minimum_size.x = minf(w + 4.0, MAX_W)
	_t = maxf(duration, 1.2 + text.length() * 0.05) + 0.4
	visible = true
	modulate.a = 1.0
	size = Vector2.ZERO


func current_text() -> String:
	return _text.text if visible else ""


func _process(delta: float) -> void:
	if not visible:
		return
	_t -= delta
	if _t <= 0.25:
		modulate.a = maxf(0.0, _t / 0.25)
	if _t <= 0.0:
		visible = false

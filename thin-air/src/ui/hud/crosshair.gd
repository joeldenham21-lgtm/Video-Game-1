class_name HUDCrosshair
extends Control
## Centre dot + interaction prompt ("[E] Pick up Stick", hold ring for timed interactions / scanning).
## Driven by Events.interaction_prompt(text, hold_time) and Events.interaction_progress(t) (−1 = cancel).
## The glyph follows the last-used device (keyboard key, pad button, touch icon).

var prompt_text := ""
var hold_time := 0.0
var progress := -1.0
var dot_visible := true

var _prompt: HBoxContainer
var _glyph: GlyphIcon
var _label: Label
var _hold_label: Label
var _prompt_a := 0.0
var _focus := 0.0          # dot grows when something is interactable
var _done_flash := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_prompt = HBoxContainer.new()
	_prompt.add_theme_constant_override("separation", 10)
	_prompt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_prompt)
	_glyph = GlyphIcon.new()
	_glyph.action = &"interact"
	_glyph.glyph_height = 30.0
	_glyph.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_prompt.add_child(_glyph)
	var col := UITheme.vbox(0)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_prompt.add_child(col)
	_hold_label = UITheme.hud_label("HOLD", 13, UITheme.TEXT_DIM, "SemiBold")
	_hold_label.add_theme_font_override("font", UITheme.caps_font("SemiBold", 2))
	col.add_child(_hold_label)
	_label = UITheme.hud_label("", UITheme.FS_BODY, UITheme.TEXT, "Medium")
	col.add_child(_label)
	_prompt.modulate.a = 0.0


func set_prompt(text: String, hold: float) -> void:
	prompt_text = text
	hold_time = hold
	if text != "":
		_label.text = text
		_hold_label.visible = hold > 0.0
		_glyph.hold = hold > 0.0
	if text == "" and progress < 0.0:
		pass
	queue_redraw()


func set_progress(t: float) -> void:
	if t >= 1.0 and progress >= 0.0:
		_done_flash = 1.0
	progress = t if t >= 0.0 and t < 1.0 else -1.0
	queue_redraw()


func _process(delta: float) -> void:
	var want := 1.0 if prompt_text != "" else 0.0
	var old_a := _prompt_a
	_prompt_a = move_toward(_prompt_a, want, delta * (8.0 if want > _prompt_a else 5.0))
	_prompt.modulate.a = _prompt_a
	if _prompt_a <= 0.0 and prompt_text == "":
		_label.text = ""
	_prompt.size = _prompt.get_combined_minimum_size()
	_prompt.position = Vector2(size.x * 0.5 + 26.0, size.y * 0.5 - _prompt.size.y * 0.5 + 2.0)
	var old_f := _focus
	_focus = move_toward(_focus, want, delta * 8.0)
	if _done_flash > 0.0:
		_done_flash = maxf(0.0, _done_flash - delta * 2.5)
	if old_a != _prompt_a or old_f != _focus or _done_flash > 0.0 or progress >= 0.0:
		queue_redraw()


func _draw() -> void:
	var c := size * 0.5
	if dot_visible:
		var r := 2.4 + _focus * 0.8
		draw_circle(c, r + 1.3, Color(0, 0, 0, 0.35))
		draw_circle(c, r, Color(1, 1, 1, 0.88))
	if _focus > 0.0 and progress < 0.0:
		draw_arc(c, 11.0, 0.0, TAU, 48, Color(1, 1, 1, 0.22 * _focus), 1.5, true)
	if progress >= 0.0:
		draw_arc(c, 13.0, 0.0, TAU, 48, Color(0, 0, 0, 0.35), 5.0, true)
		draw_arc(c, 13.0, 0.0, TAU, 48, Color(1, 1, 1, 0.18), 3.0, true)
		draw_arc(c, 13.0, -PI * 0.5, -PI * 0.5 + TAU * clampf(progress, 0.0, 1.0), 48, UITheme.ACCENT, 3.0, true)
	if _done_flash > 0.0:
		draw_arc(c, 13.0 + (1.0 - _done_flash) * 8.0, 0.0, TAU, 48, Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, _done_flash), 2.0, true)

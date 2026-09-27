extends CanvasLayer
## Story cinematic layer (above the HUD and its fade): black screen for the prologue with its own subtitles
## (the HUD hides during cinematics), a hold-to-skip hint, captions ("Aldous Range…"), act chapter cards, fades,
## and the end credits (CreditsRoll). Created on demand by the Story autoload; runs while paused.

signal credits_finished()

const SKIP_HOLD := 1.0
const SKIP_ACTIONS: Array[StringName] = [&"interact", &"ui_accept", &"jump", &"pause"]

var black: ColorRect
var sub_label: Label
var speaker_label: Label
var caption_label: Label
var chapter_label: Label
var chapter_sub: Label
var skip_label: Label
var _skip_bar: ColorRect
var _skip_t := 0.0
var _skip_done := false
var _skip_visible := false
var _sub_t := 0.0
var _tween: Tween
var _cap_tween: Tween
var _chap_tween: Tween
var _credits: Control = null
var _touch_held := false


func _ready() -> void:
	layer = 97
	process_mode = Node.PROCESS_MODE_ALWAYS
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UITheme.get_theme()
	add_child(root)
	black = ColorRect.new()
	black.color = Color(0, 0, 0, 0)
	black.set_anchors_preset(Control.PRESET_FULL_RECT)
	black.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(black)

	var subs := VBoxContainer.new()
	subs.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	subs.anchor_left = 0.12
	subs.anchor_right = 0.88
	subs.anchor_top = 0.78
	subs.anchor_bottom = 0.93
	subs.alignment = BoxContainer.ALIGNMENT_END
	subs.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(subs)
	speaker_label = UITheme.caps("", UITheme.FS_CAPTION, Color(0.86, 0.72, 0.52, 0.9), 3)
	speaker_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subs.add_child(speaker_label)
	sub_label = UITheme.label("", UITheme.FS_LEAD, Color(0.93, 0.94, 0.95), "Regular")
	sub_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sub_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	sub_label.add_theme_constant_override("shadow_offset_y", 2)
	subs.add_child(sub_label)

	caption_label = UITheme.caps("", UITheme.FS_BODY, Color(1, 1, 1, 0.85), 6, "Medium")
	caption_label.set_anchors_preset(Control.PRESET_FULL_RECT)
	caption_label.anchor_top = 0.16
	caption_label.anchor_bottom = 0.24
	caption_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	caption_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
	caption_label.modulate.a = 0.0
	root.add_child(caption_label)

	var chap := VBoxContainer.new()
	chap.set_anchors_preset(Control.PRESET_FULL_RECT)
	chap.anchor_top = 0.36
	chap.anchor_bottom = 0.5
	chap.alignment = BoxContainer.ALIGNMENT_CENTER
	chap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(chap)
	chapter_sub = UITheme.caps("", UITheme.FS_CAPTION, Color(1, 1, 1, 0.7), 5)
	chapter_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	chap.add_child(chapter_sub)
	chapter_label = UITheme.label("", UITheme.FS_H1, Color(1, 1, 1, 0.95), "Light")
	chapter_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	chapter_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	chapter_label.add_theme_constant_override("shadow_offset_y", 2)
	chap.add_child(chapter_label)
	chap.modulate.a = 0.0
	chapter_label.set_meta(&"box", chap)

	skip_label = UITheme.caps("", UITheme.FS_CAPTION, Color(1, 1, 1, 0.5), 2)
	skip_label.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	skip_label.anchor_left = 0.7
	skip_label.anchor_top = 0.94
	skip_label.anchor_right = 0.97
	skip_label.anchor_bottom = 0.98
	skip_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	skip_label.visible = false
	root.add_child(skip_label)
	_skip_bar = ColorRect.new()
	_skip_bar.color = Color(1, 1, 1, 0.55)
	_skip_bar.anchor_left = 0.97
	_skip_bar.anchor_right = 0.97
	_skip_bar.anchor_top = 0.985
	_skip_bar.anchor_bottom = 0.985
	_skip_bar.offset_bottom = 2
	_skip_bar.visible = false
	root.add_child(_skip_bar)
	Events.subtitle.connect(_on_subtitle)


func _process(delta: float) -> void:
	if _sub_t > 0.0:
		_sub_t -= delta
		if _sub_t <= 0.0:
			clear_subtitle()
	if _skip_visible and not _skip_done:
		var held := _touch_held
		for a in SKIP_ACTIONS:
			if InputMap.has_action(a) and Input.is_action_pressed(a):
				held = true
		_skip_t = _skip_t + delta if held else maxf(0.0, _skip_t - delta * 2.0)
		var w := get_viewport().get_visible_rect().size.x * 0.27 * clampf(_skip_t / SKIP_HOLD, 0.0, 1.0)
		_skip_bar.offset_left = -w
		_skip_bar.visible = _skip_t > 0.0
		if _skip_t >= SKIP_HOLD:
			_skip_done = true


func _input(event: InputEvent) -> void:
	# phones: hold a finger anywhere on the black screen to skip
	if _skip_visible and event is InputEventScreenTouch:
		_touch_held = (event as InputEventScreenTouch).pressed


func _on_subtitle(speaker: String, text: String, duration: float) -> void:
	# the HUD shows subtitles in play; this layer shows them only over black (it hides the HUD's)
	if black.color.a < 0.5 or not Settings.get_value(&"subtitles", true) and text != "":
		sub_label.text = ""
		speaker_label.text = ""
		return
	sub_label.text = text
	speaker_label.text = speaker.to_upper()
	_sub_t = maxf(duration, 0.5) + 0.3 if text != "" else 0.0


func clear_subtitle() -> void:
	sub_label.text = ""
	speaker_label.text = ""
	_sub_t = 0.0


func show_black() -> void:
	if _tween and _tween.is_valid():
		_tween.kill()
	black.color.a = 1.0


func is_black() -> bool:
	return black.color.a > 0.99


func fade_from_black(duration := 3.0) -> Tween:
	return _fade(0.0, duration)


func fade_to_black(duration := 2.0) -> Tween:
	return _fade(1.0, duration)


func _fade(a: float, duration: float) -> Tween:
	if _tween and _tween.is_valid():
		_tween.kill()
	_tween = create_tween()
	_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	# a slow, uneven wake: light seeps in, then the last of the dark lifts
	if a < 0.5 and duration > 2.0:
		_tween.tween_property(black, "color:a", 0.55, duration * 0.45).set_trans(Tween.TRANS_SINE)
		_tween.tween_property(black, "color:a", 0.7, duration * 0.12)
		_tween.tween_property(black, "color:a", 0.0, duration * 0.43).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	else:
		_tween.tween_property(black, "color:a", a, maxf(duration, 0.01)).set_trans(Tween.TRANS_SINE)
	if a < 0.5:
		_tween.tween_callback(clear_subtitle)
	return _tween


func set_skip_visible(on: bool) -> void:
	_skip_visible = on
	_skip_done = false
	_skip_t = 0.0
	skip_label.visible = on
	_skip_bar.visible = false
	if on:
		skip_label.text = "Hold to skip" if Settings.is_mobile() else "Hold %s to skip" % _action_key(&"interact")


func skip_requested() -> bool:
	return _skip_done


func caption(text: String, seconds := 4.0) -> void:
	caption_label.text = text
	if _cap_tween and _cap_tween.is_valid():
		_cap_tween.kill()
	_cap_tween = create_tween()
	_cap_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	_cap_tween.tween_property(caption_label, "modulate:a", 1.0, 1.6)
	_cap_tween.tween_interval(seconds)
	_cap_tween.tween_property(caption_label, "modulate:a", 0.0, 2.0)


## Act card: "ACT II" over the act's name, fades in and out without covering play.
func chapter(title: String, seconds := 5.0) -> void:
	if title == "":
		return
	var box := chapter_label.get_meta(&"box") as Control
	chapter_label.text = title
	var n := Story.act if Story else 0
	chapter_sub.text = "Act %s" % _roman(n) if n > 0 else ""
	if _chap_tween and _chap_tween.is_valid():
		_chap_tween.kill()
	_chap_tween = create_tween()
	_chap_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	_chap_tween.tween_property(box, "modulate:a", 1.0, 1.8)
	_chap_tween.tween_interval(seconds)
	_chap_tween.tween_property(box, "modulate:a", 0.0, 2.2)


func show_credits() -> void:
	black.color.a = 1.0
	clear_subtitle()
	if _credits and is_instance_valid(_credits):
		_credits.queue_free()
	var script: Script = load("res://src/ui/menus/credits_roll.gd") if ResourceLoader.exists("res://src/ui/menus/credits_roll.gd") else null
	if script == null:
		await get_tree().create_timer(6.0, true).timeout
		credits_finished.emit()
		return
	var c := script.new() as Control
	var host := Control.new()
	host.set_anchors_preset(Control.PRESET_FULL_RECT)
	host.theme = UITheme.get_theme()
	add_child(host)
	host.add_child(c)
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	_credits = host
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if c.has_signal(&"finished"):
		await Signal(c, &"finished")
	credits_finished.emit()


static func _roman(n: int) -> String:
	var r := ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"]
	return r[n] if n >= 0 and n < r.size() else str(n)


static func _action_key(action: StringName) -> String:
	if not InputMap.has_action(action):
		return "E"
	for e in InputMap.action_get_events(action):
		if e is InputEventKey:
			var k := e as InputEventKey
			var code := k.physical_keycode if k.physical_keycode != KEY_NONE else k.keycode
			return OS.get_keycode_string(code)
	return "E"

class_name ChoiceSelector
extends HBoxContainer
## "‹  Value  ›" selector: pad/keyboard friendly (left/right cycles, accept advances), mouse/touch via the
## arrow buttons or a tap on the value. Emits changed(value). options = [[value, label], …].

signal changed(value: Variant)

var options: Array = []:
	set(v):
		options = v
		_update()
var index := 0
var disabled := false:
	set(v):
		disabled = v
		if _l:
			_l.disabled = v
			_r.disabled = v
		focus_mode = Control.FOCUS_NONE if v else Control.FOCUS_ALL
		_update()
## Shown instead of the option label when not empty (e.g. "Custom" preset).
var override_text := "":
	set(v):
		override_text = v
		_update()

var _l: Button
var _r: Button
var _label: Label


func _init() -> void:
	focus_mode = Control.FOCUS_ALL
	mouse_filter = Control.MOUSE_FILTER_STOP
	add_theme_constant_override("separation", 4)
	_l = _arrow("chevron_left")
	add_child(_l)
	_label = UITheme.label("", UITheme.FS_BODY, UITheme.TEXT, "Medium")
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_label.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(_label)
	_r = _arrow("chevron_right")
	add_child(_r)
	_l.pressed.connect(func() -> void: step(-1))
	_r.pressed.connect(func() -> void: step(1))
	focus_entered.connect(queue_redraw)
	focus_exited.connect(queue_redraw)


func _arrow(icon_name: String) -> Button:
	var b := Button.new()
	b.theme_type_variation = &"GhostButton"
	b.icon = UITheme.icon(icon_name)
	b.expand_icon = true
	b.custom_minimum_size = Vector2(44, 44)
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_constant_override("icon_max_width", 22)
	for st in ["normal", "hover", "pressed", "disabled", "hover_pressed", "focus"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(1, 1, 1, 0.08 if st == "hover" else (0.14 if st == "pressed" else 0.0))
		sb.set_corner_radius_all(4)
		sb.set_content_margin_all(10)
		if st == "focus":
			sb.draw_center = false
		b.add_theme_stylebox_override(st, sb)
	return b


func set_value(v: Variant) -> void:
	for i in options.size():
		if str(options[i][0]) == str(v):
			index = i
			_update()
			return


func get_value() -> Variant:
	return options[index][0] if index < options.size() else null


func step(d: int) -> void:
	if disabled or options.size() < 2:
		return
	index = wrapi(index + d, 0, options.size())
	override_text = ""
	_update()
	changed.emit(options[index][0])


func _update() -> void:
	if _label == null:
		return
	var t := override_text
	if t == "" and index < options.size():
		t = String(options[index][1])
	_label.text = t
	_label.modulate.a = 0.45 if disabled else 1.0
	queue_redraw()


func _gui_input(event: InputEvent) -> void:
	if disabled:
		return
	if event.is_action_pressed(&"ui_left"):
		step(-1)
		accept_event()
	elif event.is_action_pressed(&"ui_right") or event.is_action_pressed(&"ui_accept"):
		step(1)
		accept_event()
	elif event is InputEventMouseButton and (event as InputEventMouseButton).pressed \
			and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var x := (event as InputEventMouseButton).position.x
		if x > _l.size.x and x < size.x - _r.size.x:
			step(1)
			accept_event()


func _draw() -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 1, 1, 0.04)
	sb.set_corner_radius_all(4)
	sb.border_color = UITheme.LINE_STRONG
	sb.set_border_width_all(1)
	draw_style_box(sb, Rect2(Vector2.ZERO, size))
	if has_focus():
		draw_style_box(UITheme.focus_box(), Rect2(Vector2.ZERO, size))

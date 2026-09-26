class_name ConfirmDialog
extends Control
## Modal confirmation over a dimmed backdrop: title, body, confirm (amber) and cancel buttons. Cancel with
## ui_cancel / B / Esc. Focus starts on the safe choice (cancel) unless `focus_confirm`.

signal confirmed()
signal cancelled()

var _panel: PanelContainer
var _prev_focus: Control


static func ask(parent: Node, title: String, body: String, confirm_text := "Confirm", cancel_text := "Cancel", focus_confirm := false) -> ConfirmDialog:
	var d := ConfirmDialog.new()
	parent.add_child(d)
	d._setup(title, body, confirm_text, cancel_text, focus_confirm)
	return d


func _setup(title: String, body: String, confirm_text: String, cancel_text: String, focus_confirm: bool) -> void:
	_prev_focus = get_viewport().gui_get_focus_owner()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	process_mode = Node.PROCESS_MODE_ALWAYS
	var scrim := ColorRect.new()
	scrim.color = Color(0, 0, 0, 0.55)
	scrim.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(scrim)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	_panel = PanelContainer.new()
	_panel.theme_type_variation = &"SolidPanel"
	_panel.custom_minimum_size.x = 560
	center.add_child(_panel)
	var v := UITheme.vbox(16)
	_panel.add_child(v)
	v.add_child(UITheme.label(title, UITheme.FS_H3, UITheme.TEXT, "Medium"))
	var b := UITheme.label(body, UITheme.FS_BODY, UITheme.TEXT_DIM)
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.custom_minimum_size.x = 500
	v.add_child(b)
	var row := UITheme.hbox(12)
	row.alignment = BoxContainer.ALIGNMENT_END
	v.add_child(row)
	var cancel := UITheme.button(cancel_text)
	cancel.custom_minimum_size = Vector2(150, 50)
	cancel.set_meta(&"back_sound", true)
	row.add_child(cancel)
	var ok := UITheme.button(confirm_text, "PrimaryButton")
	ok.custom_minimum_size = Vector2(170, 50)
	row.add_child(ok)
	cancel.pressed.connect(_cancel)
	ok.pressed.connect(func() -> void:
		confirmed.emit()
		_close())
	UISounds.wire(self)
	(ok if focus_confirm else cancel).grab_focus.call_deferred()
	modulate.a = 0.0
	create_tween().tween_property(self, "modulate:a", 1.0, 0.15)


func _input(event: InputEvent) -> void:
	if event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause"):
		get_viewport().set_input_as_handled()
		UISounds.back()
		_cancel()


func _cancel() -> void:
	cancelled.emit()
	_close()


func _close() -> void:
	set_process_input(false)
	if _prev_focus and is_instance_valid(_prev_focus) and _prev_focus.is_visible_in_tree():
		_prev_focus.grab_focus()
	queue_free()

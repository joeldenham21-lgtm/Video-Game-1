class_name UISounds
extends RefCounted
## Wires UI sounds (Audio.play_ui ui_hover / ui_click / ui_back) to every BaseButton, Slider and tab under a
## root, including ones added later. Hover plays on mouse enter and on gamepad/keyboard focus changes.

const META := &"_ui_sounds"
static var _last_hover_ms := 0


static func wire(root: Node) -> void:
	_wire_one(root)
	for c in root.find_children("*", "", true, false):
		_wire_one(c)
	if not root.child_entered_tree.is_connected(_on_child):
		root.child_entered_tree.connect(_on_child)


static func _on_child(n: Node) -> void:
	_wire_one(n)
	for c in n.find_children("*", "", true, false):
		_wire_one(c)
	if not n.child_entered_tree.is_connected(_on_child):
		n.child_entered_tree.connect(_on_child)


static func _wire_one(n: Node) -> void:
	if n.has_meta(META):
		return
	if n is BaseButton:
		var b := n as BaseButton
		b.set_meta(META, true)
		b.mouse_entered.connect(func() -> void:
			if not b.disabled:
				hover())
		b.focus_entered.connect(func() -> void:
			if InputGlyphs.current() != InputGlyphs.TOUCH and not b.is_hovered():
				hover())
		b.pressed.connect(func() -> void: click(b))
	elif n is Range and n is Control:
		var r := n as Range
		r.set_meta(META, true)
		(n as Control).focus_entered.connect(hover)


static func hover() -> void:
	var now := Time.get_ticks_msec()
	if now - _last_hover_ms < 45:
		return
	_last_hover_ms = now
	Audio.play_ui(&"ui_hover")


static func click(b: BaseButton = null) -> void:
	if b and b.has_meta(&"back_sound"):
		Audio.play_ui(&"ui_back")
	else:
		Audio.play_ui(&"ui_click")


static func back() -> void:
	Audio.play_ui(&"ui_back")

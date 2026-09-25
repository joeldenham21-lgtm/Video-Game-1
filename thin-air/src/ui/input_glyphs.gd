class_name InputGlyphs
extends RefCounted
## Maps input actions to the glyph of the device the player used last (keyboard/mouse, Xbox-style pad,
## touch) and tracks that device. UI nodes forward their input events to InputGlyphs.track(); listeners
## connect to InputGlyphs.bus().device_changed. GlyphIcon (src/ui/glyph_icon.gd) draws the glyphs.

signal device_changed(device: StringName)

const KEYBOARD := &"keyboard"
const PAD := &"pad"
const TOUCH := &"touch"

## Xbox layout names for JoyButton indices (SDL order used by Godot).
const PAD_BUTTONS := {
	0: "A", 1: "B", 2: "X", 3: "Y", 4: "View", 5: "Guide", 6: "Menu", 7: "LS", 8: "RS", 9: "LB", 10: "RB",
	11: "D-pad up", 12: "D-pad down", 13: "D-pad left", 14: "D-pad right", 15: "Share",
}
const PAD_BUTTON_SHORT := {
	0: "A", 1: "B", 2: "X", 3: "Y", 4: "View", 5: "Guide", 6: "Menu", 7: "LS", 8: "RS", 9: "LB", 10: "RB",
	11: "↑", 12: "↓", 13: "←", 14: "→", 15: "Share",
}
## Face-button colours, muted to sit in the palette.
const PAD_COLORS := {
	0: Color(0.42, 0.72, 0.36), 1: Color(0.86, 0.36, 0.3), 2: Color(0.33, 0.56, 0.9), 3: Color(0.93, 0.76, 0.3),
}
const PAD_AXES := {4: "LT", 5: "RT"}
## Touch-control icon per action (assets/ui/icons).
const TOUCH_ICONS := {
	&"interact": "interact", &"use": "use", &"aim": "aim", &"jump": "jump", &"crouch": "crouch",
	&"inventory": "inventory", &"build": "build", &"journal": "journal", &"map": "map", &"pause": "pause",
	&"torch_toggle": "torch", &"sprint": "sprint",
}

static var device: StringName = &""
static var _bus: InputGlyphs = null


static func bus() -> InputGlyphs:
	if _bus == null:
		_bus = InputGlyphs.new()
	return _bus


static func current() -> StringName:
	if device == &"":
		device = TOUCH if Settings.is_mobile() else KEYBOARD
	return device


static func set_device(d: StringName) -> void:
	if current() == d:
		return
	device = d
	bus().device_changed.emit(d)


## Call from _input of any UI. Tiny stick noise and mouse jitter don't count.
static func track(event: InputEvent) -> void:
	if event is InputEventJoypadButton:
		if (event as InputEventJoypadButton).pressed:
			set_device(PAD)
	elif event is InputEventJoypadMotion:
		if absf((event as InputEventJoypadMotion).axis_value) > 0.45:
			set_device(PAD)
	elif event is InputEventScreenTouch or event is InputEventScreenDrag:
		set_device(TOUCH)
	elif event is InputEventKey:
		if (event as InputEventKey).pressed:
			set_device(KEYBOARD)
	elif event is InputEventMouseButton:
		# emulated mouse from touch has device == -1 (InputEvent.DEVICE_ID_EMULATION)
		if event.device != InputEvent.DEVICE_ID_EMULATION and (event as InputEventMouseButton).pressed:
			set_device(KEYBOARD)
	elif event is InputEventMouseMotion:
		if event.device != InputEvent.DEVICE_ID_EMULATION and (event as InputEventMouseMotion).relative.length() > 6.0:
			set_device(KEYBOARD)


## Glyph description for `action` on `dev` (current device when empty):
## {kind: "key"|"mouse"|"pad_button"|"pad_axis"|"touch"|"none", text: String, color: Color, icon: String, index: int}
static func glyph(action: StringName, dev: StringName = &"") -> Dictionary:
	if dev == &"":
		dev = current()
	if dev == TOUCH:
		return {"kind": "touch", "text": "", "icon": TOUCH_ICONS.get(action, "interact"), "color": UITheme.TEXT, "index": -1}
	if not InputMap.has_action(action):
		return {"kind": "none", "text": "?", "icon": "", "color": UITheme.TEXT, "index": -1}
	var events := InputMap.action_get_events(action)
	if dev == PAD:
		for e in events:
			if e is InputEventJoypadButton:
				var bi := (e as InputEventJoypadButton).button_index
				return {"kind": "pad_button", "text": PAD_BUTTON_SHORT.get(bi, str(bi)), "icon": "",
					"color": PAD_COLORS.get(bi, Color(0, 0, 0, 0)), "index": bi, "name": PAD_BUTTONS.get(bi, str(bi))}
		for e in events:
			if e is InputEventJoypadMotion:
				var ax := (e as InputEventJoypadMotion).axis
				if PAD_AXES.has(ax):
					return {"kind": "pad_axis", "text": PAD_AXES[ax], "icon": "", "color": Color(0, 0, 0, 0), "index": ax}
				return {"kind": "pad_axis", "text": "L" if ax < 2 else "R", "icon": "", "color": Color(0, 0, 0, 0), "index": ax}
	for e in events:
		if e is InputEventKey:
			return {"kind": "key", "text": key_name(e as InputEventKey), "icon": "", "color": Color(0, 0, 0, 0), "index": -1}
		if e is InputEventMouseButton:
			var mb := (e as InputEventMouseButton).button_index
			var t := {MOUSE_BUTTON_LEFT: "LMB", MOUSE_BUTTON_RIGHT: "RMB", MOUSE_BUTTON_MIDDLE: "MMB",
				MOUSE_BUTTON_WHEEL_UP: "Wheel", MOUSE_BUTTON_WHEEL_DOWN: "Wheel"}.get(mb, "Mouse")
			return {"kind": "mouse", "text": t, "icon": "", "color": Color(0, 0, 0, 0), "index": mb}
	return {"kind": "none", "text": "—", "icon": "", "color": UITheme.TEXT, "index": -1}


## Layout-aware key label ("E", "Tab", "Esc", "Space"…).
static func key_name(e: InputEventKey) -> String:
	var kc := e.keycode
	if kc == KEY_NONE and e.physical_keycode != KEY_NONE:
		kc = e.physical_keycode
		if DisplayServer.get_name() != "headless":
			var mapped := DisplayServer.keyboard_get_keycode_from_physical(e.physical_keycode)
			if mapped != KEY_NONE:
				kc = mapped
	match kc:
		KEY_ESCAPE: return "Esc"
		KEY_SPACE: return "Space"
		KEY_SHIFT: return "Shift"
		KEY_CTRL: return "Ctrl"
		KEY_TAB: return "Tab"
		KEY_ENTER: return "Enter"
		KEY_CAPSLOCK: return "Caps"
		KEY_UP: return "↑"
		KEY_DOWN: return "↓"
		KEY_LEFT: return "←"
		KEY_RIGHT: return "→"
	var s := OS.get_keycode_string(kc)
	return s if s != "" else "?"


## Plain-text form for inline hints: "E", "X", "LMB".
static func text_for(action: StringName, dev: StringName = &"") -> String:
	var g := glyph(action, dev)
	if g["kind"] == "pad_button":
		return String(g.get("name", g["text"]))
	return String(g["text"])

class_name TouchControls
extends CanvasLayer
## On-screen touch controls (scenes/ui/touch_controls.tscn; the HUD adds them on phones or when a touchscreen
## is used, and hides them again on keyboard/pad input). CONTRACT §5: they inject the named actions with
## Input.action_press/release and send look deltas through TouchLook.
##
##  · floating move stick: spawns where the left thumb lands; pushing past the rim sprints
##  · right half: drag to look (TouchLook.add)
##  · thumb cluster (bottom right): use/attack (hold), aim (hold), jump, crouch, torch; a contextual interact
##    pill that shows the current prompt ("Pick up Stick"; hold for timed interactions)
##  · top right: build, map, journal, inventory; top left: pause
##  · the HUD's hotbar strip becomes tappable/swipeable
## Multi-touch: every finger is tracked by index and owned by one control until it lifts. Sizes follow
## Settings.touch_ui_scale, never below MIN_MM, and respect the display safe area (notches, rounded corners).

const MIN_MM := 9.0
const STICK_R := 110.0
const KNOB_R := 46.0
const SPRINT_PAST := 1.18
const TAP_HOLD := 0.08          # s — taps are held at least this long so the game's polls see them
const LOOK_ZONE_X := 0.42       # fraction of the width where the look zone starts

## id → [action, icon, anchor ("br" | "tr" | "tl"), offset (logical units from the anchored corner), radius, mode]
## mode: "hold" (pressed while touched) or "tap" (press + minimum hold).
const BUTTONS := {
	&"use": [&"use", "use", "br", Vector2(-150, -190), 70.0, "hold"],
	&"aim": [&"aim", "aim", "br", Vector2(-140, -370), 46.0, "hold"],
	&"jump": [&"jump", "jump", "br", Vector2(-310, -126), 52.0, "tap"],
	&"crouch": [&"crouch", "crouch", "br", Vector2(-310, -276), 42.0, "tap"],
	&"torch": [&"torch_toggle", "torch", "br", Vector2(-60, -470), 36.0, "tap"],
	&"inventory": [&"inventory", "inventory", "tr", Vector2(-58, 60), 34.0, "tap"],
	&"journal": [&"journal", "journal", "tr", Vector2(-146, 60), 34.0, "tap"],
	&"map": [&"map", "map", "tr", Vector2(-234, 60), 34.0, "tap"],
	&"build": [&"build", "build", "tr", Vector2(-322, 60), 34.0, "tap"],
	&"pause": [&"pause", "pause", "tl", Vector2(52, 52), 30.0, "tap"],
}

var active := true
var root: Control
var scale_k := 1.0
var prompt_text := ""
var prompt_hold := 0.0

var _centers := {}            # id -> Vector2 (root-local)
var _radii := {}              # id -> float
var _owner := {}              # touch index -> id (&"stick", &"look", button id, &"interact")
var _pressed := {}            # button id -> true
var _release_at := {}         # action -> msec when to release (tap buttons)
var _stick_base := Vector2.ZERO
var _stick_knob := Vector2.ZERO
var _stick_on := false
var _stick_vec := Vector2.ZERO
var _sprinting := false
var _last_look := {}          # touch index -> last position
var _interact_rect := Rect2()
var _safe := Rect2()
var _font: Font
var _photo_hidden := false
var _screens := {}


func _ready() -> void:
	layer = 30
	process_mode = Node.PROCESS_MODE_ALWAYS
	_font = UITheme.font("Medium")
	root = Control.new()
	root.name = "Root"
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.draw.connect(_draw_controls)
	add_child(root)
	Events.interaction_prompt.connect(func(t: String, h: float) -> void:
		prompt_text = t
		prompt_hold = h
		root.queue_redraw())
	Events.ui_screen_opened.connect(func(s: StringName) -> void:
		if s != &"build" and s != &"hud":
			_screens[s] = true
			release_all())
	Events.ui_screen_closed.connect(func(s: StringName) -> void: _screens.erase(s))
	Events.settings_changed.connect(_layout)
	get_viewport().size_changed.connect(_layout)
	_layout()


func set_active(on: bool) -> void:
	active = on
	if not on:
		release_all()
	visible = on and not _photo_hidden


func set_hidden_for_photo(h: bool) -> void:
	_photo_hidden = h
	visible = active and not h
	if h:
		release_all()


func is_blocked() -> bool:
	return not active or _photo_hidden or not _screens.is_empty() or get_tree().paused or Game.state == Game.State.DEAD


# ============================================================================================= layout

func _layout() -> void:
	UITheme.fit_root(root, 900.0, 480.0)
	var s := float(Settings.get_value(&"touch_ui_scale", 1.0))
	scale_k = clampf(s, 0.7, 1.4)
	var W := root.size.x
	var H := root.size.y
	# safe area (screen px → root units)
	_safe = Rect2(Vector2.ZERO, root.size)
	if DisplayServer.get_name() != "headless":
		var sa := DisplayServer.get_display_safe_area()
		var ws := DisplayServer.window_get_size()
		if sa.size.x > 0 and ws.x > 0:
			var k := root.size.x / float(ws.x)
			_safe = Rect2(Vector2(sa.position) * k, Vector2(sa.size) * k).intersection(Rect2(Vector2.ZERO, root.size))
	var min_r := UITheme.mm_to_units(root, MIN_MM) * 0.5
	for id in BUTTONS:
		var b: Array = BUTTONS[id]
		var r := maxf(float(b[4]) * scale_k, min_r)
		var off: Vector2 = b[3] * scale_k
		var c := Vector2.ZERO
		match String(b[2]):
			"br": c = _safe.end + off
			"tr": c = Vector2(_safe.end.x, _safe.position.y) + off
			"tl": c = _safe.position + off
		_centers[id] = c
		_radii[id] = r
	root.queue_redraw()
	# the HUD moves its right column below our top-right buttons
	var hud := HUD.find()
	if hud and hud.right_col:
		hud.right_col.position.y = maxf(hud.right_col.position.y, 60.0 + 34.0 * scale_k * 2.0 + 20.0)


func button_center(id: StringName) -> Vector2:
	return _centers.get(id, Vector2.ZERO)


func button_radius(id: StringName) -> float:
	return _radii.get(id, 0.0)


func _hit_button(p: Vector2) -> StringName:
	for id in BUTTONS:
		if id == &"torch" and not _torch_available():
			continue
		if p.distance_to(_centers[id]) <= float(_radii[id]) * 1.12:
			return id
	return &""


func _torch_available() -> bool:
	return true


func _interact_visible() -> bool:
	return prompt_text != ""


# ============================================================================================= input

func _to_root(p: Vector2) -> Vector2:
	return root.get_global_transform_with_canvas().affine_inverse() * p


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		InputGlyphs.track(event)
		if is_blocked():
			return
		var st := event as InputEventScreenTouch
		var p := _to_root(st.position)
		if st.pressed:
			if _touch_down(st.index, p):
				get_viewport().set_input_as_handled()
		else:
			if _owner.has(st.index):
				_touch_up(st.index)
				get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		if is_blocked():
			return
		var sd := event as InputEventScreenDrag
		if _owner.has(sd.index):
			_touch_drag(sd.index, _to_root(sd.position), sd.screen_relative if sd.screen_relative != Vector2.ZERO else sd.relative)
			get_viewport().set_input_as_handled()


## Returns true if a control claimed the touch.
func _touch_down(index: int, p: Vector2) -> bool:
	if _owner.has(index):
		return true
	if _interact_visible() and _interact_rect.has_point(p):
		_owner[index] = &"interact"
		_press_action(&"interact")
		_pressed[&"interact"] = true
		root.queue_redraw()
		return true
	var id := _hit_button(p)
	if id != &"":
		_owner[index] = id
		_pressed[id] = true
		var b: Array = BUTTONS[id]
		_press_action(b[0])
		if String(b[5]) == "tap":
			_release_at[b[0]] = Time.get_ticks_msec() + int(TAP_HOLD * 1000.0)
		root.queue_redraw()
		return true
	# leave the hotbar strip to the HUD
	var hud := HUD.find()
	if hud and hud.hotbar and hud.hotbar.get_global_rect().has_point(root.get_global_transform_with_canvas() * p):
		return false
	var W := root.size.x
	if p.x < W * LOOK_ZONE_X and p.y > root.size.y * 0.28 and not _stick_on:
		_owner[index] = &"stick"
		_stick_on = true
		_stick_base = p
		_stick_knob = p
		_stick_vec = Vector2.ZERO
		root.queue_redraw()
		return true
	if p.x >= W * LOOK_ZONE_X:
		_owner[index] = &"look"
		_last_look[index] = p
		return true
	return false


func _touch_drag(index: int, p: Vector2, rel_screen: Vector2) -> void:
	var who: StringName = _owner[index]
	if who == &"stick":
		var r := STICK_R * scale_k
		var d := p - _stick_base
		# floating: the base follows a thumb that slides far past the rim
		if d.length() > r * 1.6:
			_stick_base = p - d.normalized() * r * 1.6
			d = p - _stick_base
		_stick_knob = _stick_base + d.limit_length(r)
		_stick_vec = d / r
		_apply_stick()
		root.queue_redraw()
	elif who == &"look":
		var last: Vector2 = _last_look.get(index, p)
		_last_look[index] = p
		# pixels of the physical screen, like a mouse
		TouchLook.add(rel_screen if rel_screen != Vector2.ZERO else (p - last))
	elif BUTTONS.has(who):
		# sliding off a hold button keeps it held (thumbs wander); nothing to do
		pass


func _touch_up(index: int) -> void:
	var who: StringName = _owner[index]
	_owner.erase(index)
	_last_look.erase(index)
	if who == &"stick":
		_stick_on = false
		_stick_vec = Vector2.ZERO
		_apply_stick()
	elif who == &"interact":
		_release_action(&"interact")
		_pressed.erase(&"interact")
	elif BUTTONS.has(who):
		var b: Array = BUTTONS[who]
		_pressed.erase(who)
		if String(b[5]) == "hold" or not _release_at.has(b[0]):
			_release_action(b[0])
	root.queue_redraw()


func _apply_stick() -> void:
	var v := _stick_vec.limit_length(1.0)
	_set_axis(&"move_left", &"move_right", v.x)
	_set_axis(&"move_forward", &"move_back", v.y)
	var sprint := _stick_vec.length() > SPRINT_PAST and v.y < -0.4
	if sprint != _sprinting:
		_sprinting = sprint
		if sprint:
			_press_action(&"sprint")
		else:
			_release_action(&"sprint")


func _set_axis(neg: StringName, pos: StringName, v: float) -> void:
	if v > 0.05:
		Input.action_press(pos, v)
		Input.action_release(neg)
	elif v < -0.05:
		Input.action_press(neg, -v)
		Input.action_release(pos)
	else:
		Input.action_release(neg)
		Input.action_release(pos)


func _press_action(a: StringName) -> void:
	if InputMap.has_action(a):
		Input.action_press(a)


func _release_action(a: StringName) -> void:
	_release_at.erase(a)
	if InputMap.has_action(a):
		Input.action_release(a)


func release_all() -> void:
	for id in BUTTONS:
		Input.action_release(BUTTONS[id][0])
	for a in [&"interact", &"sprint", &"move_left", &"move_right", &"move_forward", &"move_back"]:
		if InputMap.has_action(a):
			Input.action_release(a)
	_owner.clear()
	_pressed.clear()
	_release_at.clear()
	_last_look.clear()
	_stick_on = false
	_stick_vec = Vector2.ZERO
	_sprinting = false
	if root:
		root.queue_redraw()


func _process(_delta: float) -> void:
	var show := not is_blocked()
	if root.visible != show:
		root.visible = show
		if not show:
			release_all()
	if _release_at.is_empty():
		return
	var now := Time.get_ticks_msec()
	for a in _release_at.keys():
		if now >= int(_release_at[a]):
			# still held by a finger? keep it pressed until that finger lifts
			var held := false
			for idx in _owner:
				var who: StringName = _owner[idx]
				if BUTTONS.has(who) and BUTTONS[who][0] == a:
					held = true
			if not held:
				Input.action_release(a)
			_release_at.erase(a)


# ============================================================================================= drawing

func _draw_controls() -> void:
	if is_blocked():
		return
	var rt := root
	# move stick
	var r := STICK_R * scale_k
	if _stick_on:
		rt.draw_circle(_stick_base, r, Color(0.02, 0.025, 0.03, 0.22))
		rt.draw_arc(_stick_base, r, 0.0, TAU, 64, Color(1, 1, 1, 0.3), 2.0, true)
		if _sprinting:
			rt.draw_arc(_stick_base, r * SPRINT_PAST, -PI * 0.75, -PI * 0.25, 24, UITheme.ACCENT, 3.0, true)
		rt.draw_circle(_stick_knob, KNOB_R * scale_k, Color(1, 1, 1, 0.34))
		rt.draw_arc(_stick_knob, KNOB_R * scale_k, 0.0, TAU, 48, Color(1, 1, 1, 0.6), 1.5, true)
	else:
		# resting hint where the stick usually spawns
		var hint := Vector2(_safe.position.x + 200.0 * scale_k, _safe.end.y - 190.0 * scale_k)
		rt.draw_arc(hint, r * 0.8, 0.0, TAU, 64, Color(1, 1, 1, 0.14), 1.5, true)
		rt.draw_circle(hint, KNOB_R * scale_k * 0.8, Color(1, 1, 1, 0.08))
	# buttons
	for id in BUTTONS:
		var b: Array = BUTTONS[id]
		var c: Vector2 = _centers[id]
		var br: float = _radii[id]
		var on := _pressed.has(id)
		rt.draw_circle(c, br, Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, 0.42) if on else Color(0.02, 0.025, 0.03, 0.36))
		rt.draw_arc(c, br, 0.0, TAU, 48, Color(1, 1, 1, 0.5 if on else 0.28), 1.5, true)
		var tex := UITheme.icon(String(b[1]))
		if tex:
			var s := br * 0.95
			rt.draw_texture_rect(tex, Rect2(c - Vector2(s, s) * 0.5, Vector2(s, s)), false, Color(1, 1, 1, 0.92 if on else 0.8))
	# contextual interact pill (left of the thumb cluster)
	_interact_rect = Rect2()
	if _interact_visible():
		var fs := int(22 * scale_k)
		var ts := _font.get_string_size(prompt_text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		var h := maxf(64.0 * scale_k, UITheme.mm_to_units(root, MIN_MM))
		var w := ts.x + h + 34.0 * scale_k
		# left of the jump / crouch buttons, level with crouch: the right thumb slides onto it
		var jc: Vector2 = _centers[&"jump"]
		var cc: Vector2 = _centers[&"crouch"]
		var pos := Vector2(jc.x - float(_radii[&"jump"]) - 26.0 * scale_k - w, cc.y - h * 0.5)
		pos.x = maxf(pos.x, root.size.x * LOOK_ZONE_X)
		_interact_rect = Rect2(pos, Vector2(w, h))
		var on2 := _pressed.has(&"interact")
		var sb := StyleBoxFlat.new()
		sb.set_corner_radius_all(int(h * 0.5))
		sb.bg_color = Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, 0.5) if on2 else Color(0.02, 0.025, 0.03, 0.55)
		sb.border_color = Color(1, 1, 1, 0.45)
		sb.set_border_width_all(1)
		sb.anti_aliasing = true
		rt.draw_style_box(sb, _interact_rect)
		var ic := UITheme.icon("interact")
		if ic:
			var s2 := h * 0.56
			rt.draw_texture_rect(ic, Rect2(pos + Vector2(h * 0.26, (h - s2) * 0.5), Vector2(s2, s2)), false, Color(1, 1, 1, 0.9))
		rt.draw_string(_font, pos + Vector2(h + 4.0 * scale_k, h * 0.5 + fs * 0.36), prompt_text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.95))
		if prompt_hold > 0.0:
			rt.draw_string(UITheme.caps_font("SemiBold", 2), pos + Vector2(h + 4.0 * scale_k, h * 0.5 - fs * 0.62), "HOLD", HORIZONTAL_ALIGNMENT_LEFT, -1, int(12 * scale_k), Color(1, 1, 1, 0.6))

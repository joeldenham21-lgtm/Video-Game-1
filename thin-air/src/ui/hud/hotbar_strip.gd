class_name HUDHotbar
extends Control
## Quick-select hotbar (bottom centre): six slots with item icons, stack counts and a condition bar for tools;
## the active slot is amber and its item name shows above. On desktop it fades out a few seconds after the
## last change; with touch controls it stays visible and is interactive (tap = select, swipe = cycle), which
## injects the hotbar actions (CONTRACT §5) instead of calling the player.

signal slot_tapped(index: int)

const SLOTS := 6
const SLOT := 64.0
const GAP := 8.0
const SHOW_TIME := 3.5

var interactive := false:
	set(v):
		interactive = v
		mouse_filter = Control.MOUSE_FILTER_STOP if v else Control.MOUSE_FILTER_IGNORE
var always_visible := false
var ids: Array[StringName] = []
var counts: Array[int] = []
var conditions: Array[float] = []     # 0..1, <0 = none
var active := -1

var _show_t := 0.0
var _alpha := 0.0
var _name_a := 0.0
var _font: Font
var _font_mono: Font
var _touch_start := Vector2.ZERO
var _touch_idx := -1
var _pending_release: Array[StringName] = []
var _sig := 0


func _ready() -> void:
	_font = UITheme.font("Medium")
	_font_mono = UITheme.mono_font()
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i in SLOTS:
		ids.append(&"")
		counts.append(0)
		conditions.append(-1.0)
	custom_minimum_size = Vector2(SLOTS * SLOT + (SLOTS - 1) * GAP, SLOT + 34.0)


## Pull from a player (duck-typed: hotbar, active_slot, inventory).
func sample(p: Object) -> void:
	if p == null:
		return
	var hb: Variant = p.get("hotbar")
	var inv: Variant = p.get("inventory")
	var act := int(p.get("active_slot")) if p.get("active_slot") != null else -1
	var sig := act * 7919
	for i in SLOTS:
		var id: StringName = &""
		if hb is Array and i < (hb as Array).size():
			id = StringName((hb as Array)[i])
		ids[i] = id
		var n := 0
		var cond := -1.0
		if id != &"" and inv != null and inv is Object:
			n = int((inv as Object).call("count", id))
			var def := ItemDB.get_item(id)
			if def.has("tool") and float((def["tool"] as Dictionary).get("durability", 0.0)) > 0.0:
				var si := int((inv as Object).call("find", id))
				if si >= 0:
					var st: Dictionary = (inv as Object).call("get_slot", si)
					cond = clampf(float(st.get("durability", 1.0)), 0.0, 1.0)
		counts[i] = n
		conditions[i] = cond
		sig = hash([sig, id, n, snappedf(cond, 0.02)])
	if act != active:
		_show_t = SHOW_TIME
		_name_a = 1.0
	active = act
	if sig != _sig:
		_sig = sig
		queue_redraw()


func flash() -> void:
	_show_t = SHOW_TIME
	_name_a = 1.0


func _process(delta: float) -> void:
	for a in _pending_release:
		Input.action_release(a)
	_pending_release.clear()
	_show_t = maxf(0.0, _show_t - delta)
	var want := 1.0 if (always_visible or _show_t > 0.0) else 0.0
	var na := move_toward(_alpha, want, delta * (6.0 if want > _alpha else 1.5))
	var nn := move_toward(_name_a, 1.0 if _show_t > 0.8 else 0.0, delta * 2.0)
	if na != _alpha or nn != _name_a:
		_alpha = na
		_name_a = nn
		queue_redraw()


func slot_rect(i: int) -> Rect2:
	var w := SLOTS * SLOT + (SLOTS - 1) * GAP
	var x0 := (size.x - w) * 0.5
	return Rect2(Vector2(x0 + i * (SLOT + GAP), size.y - SLOT), Vector2(SLOT, SLOT))


func _draw() -> void:
	if _alpha <= 0.01:
		return
	var a := _alpha
	for i in SLOTS:
		var r := slot_rect(i)
		var is_act := i == active
		var sb := StyleBoxFlat.new()
		sb.set_corner_radius_all(5)
		sb.anti_aliasing = true
		sb.bg_color = Color(0.02, 0.025, 0.03, 0.46 * a) if not is_act else Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, 0.14 * a)
		sb.set_border_width_all(2 if is_act else 1)
		sb.border_color = Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, a) if is_act else Color(1, 1, 1, 0.12 * a)
		draw_style_box(sb, r)
		var id := ids[i]
		if id != &"":
			var tex := ItemDB.get_icon(id)
			if tex:
				var ir := r.grow(-7.0)
				draw_texture_rect(tex, ir, false, Color(1, 1, 1, a * (1.0 if counts[i] > 0 else 0.35)))
			if counts[i] > 1:
				_text(str(counts[i]), r.end - Vector2(6, 6), 15, Color(1, 1, 1, a), _font_mono, 2)
			if conditions[i] >= 0.0:
				var bw := (r.size.x - 14.0)
				var br := Rect2(r.position + Vector2(7, r.size.y - 6), Vector2(bw, 2.5))
				draw_rect(br, Color(0, 0, 0, 0.45 * a))
				var cc := InvStyle.durability_color(conditions[i])
				draw_rect(Rect2(br.position, Vector2(bw * conditions[i], 2.5)), Color(cc.r, cc.g, cc.b, a))
		_text(str(i + 1), r.position + Vector2(6, 16), 13, Color(1, 1, 1, 0.5 * a), _font_mono, 0)
	# active item name
	if active >= 0 and active < SLOTS and ids[active] != &"" and _name_a > 0.01:
		var nm := String(ItemDB.get_item(ids[active]).get("name", String(ids[active]).capitalize()))
		_text(nm, Vector2(size.x * 0.5, size.y - SLOT - 12.0), 19, Color(1, 1, 1, a * _name_a), _font, 1)


func _text(t: String, pos: Vector2, fs: int, col: Color, f: Font, align: int) -> void:
	var ts := f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var p := pos
	if align == 1:
		p.x -= ts.x * 0.5
	elif align == 2:
		p.x -= ts.x
	draw_string_outline(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.45 * col.a))
	draw_string(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


func slot_at(pos: Vector2) -> int:
	for i in SLOTS:
		if slot_rect(i).grow(GAP * 0.5).has_point(pos):
			return i
	return -1


## Touch: tap a slot to select, swipe sideways across the strip to cycle.
func _gui_input(event: InputEvent) -> void:
	if not interactive:
		return
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_touch_start = st.position
			_touch_idx = st.index
		elif st.index == _touch_idx:
			var d := st.position - _touch_start
			if absf(d.x) > SLOT * 0.8:
				_press(&"hotbar_prev" if d.x > 0.0 else &"hotbar_next")
			else:
				var i := slot_at(st.position)
				if i >= 0:
					_press(StringName("hotbar_%d" % (i + 1)))
					slot_tapped.emit(i)
			_touch_idx = -1
		accept_event()
	elif event is InputEventMouseButton and (event as InputEventMouseButton).pressed and event.device == InputEvent.DEVICE_ID_EMULATION:
		accept_event()


func _press(action: StringName) -> void:
	Input.action_press(action)
	_pending_release.append(action)
	flash()

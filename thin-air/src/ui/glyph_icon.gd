class_name GlyphIcon
extends Control
## Draws the input glyph for `action` on the last-used device: a keycap ("E", "Tab"), a mouse button, an
## Xbox-style face button (coloured letter disc), shoulder/trigger pill, D-pad cross, View/Menu buttons, or
## the touch-control icon. Follows InputGlyphs device changes. `hold` adds a small ring hint for hold actions.

@export var action: StringName = &"interact":
	set(v):
		action = v
		_refresh()
@export var glyph_height := 30.0:
	set(v):
		glyph_height = v
		_refresh()
@export var force_device: StringName = &""
var hold := false:
	set(v):
		hold = v
		queue_redraw()
var tint := Color(1, 1, 1, 1)

var _g: Dictionary = {}
var _font: Font


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = UITheme.font("SemiBold")
	InputGlyphs.bus().device_changed.connect(func(_d: StringName) -> void: _refresh())
	_refresh()


func set_action(a: StringName) -> void:
	action = a


func _refresh() -> void:
	if not is_inside_tree():
		return
	_g = InputGlyphs.glyph(action, force_device)
	var h := glyph_height
	var w := h
	match String(_g.get("kind", "none")):
		"key":
			var t := String(_g["text"])
			if _font:
				w = maxf(h, _font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, int(h * 0.5)).x + h * 0.55)
		"mouse":
			w = h * 0.78
		"pad_axis":
			w = h * 1.35
		"pad_button":
			var bi := int(_g["index"])
			if bi in [9, 10, 7, 8]:
				w = h * 1.35
		"none":
			w = 0.0 if String(_g.get("text", "")) == "" else h
	custom_minimum_size = Vector2(w, h)
	update_minimum_size()
	queue_redraw()


func _draw() -> void:
	if _g.is_empty():
		return
	var h := glyph_height
	var sz := Vector2(custom_minimum_size.x, h)
	var off := Vector2(0.0, (size.y - h) * 0.5)
	var fg := UITheme.TEXT * tint
	var kind := String(_g.get("kind", "none"))
	match kind:
		"key":
			var r := Rect2(off + Vector2(0.5, 0.5), sz - Vector2(1, 1))
			_rounded(r, h * 0.2, Color(1, 1, 1, 0.1 * tint.a), true)
			_rounded(r, h * 0.2, Color(fg.r, fg.g, fg.b, 0.75 * tint.a), false, 1.5)
			# key travel shadow line
			draw_line(r.position + Vector2(h * 0.18, r.size.y - 1.5), r.end - Vector2(h * 0.18, 1.5), Color(fg.r, fg.g, fg.b, 0.25 * tint.a), 1.0)
			_text_centered(String(_g["text"]), r, int(h * 0.5), fg)
		"mouse":
			var r2 := Rect2(off + Vector2(sz.x * 0.08, 0.5), Vector2(sz.x * 0.84, h - 1.0))
			_rounded(r2, r2.size.x * 0.48, Color(fg.r, fg.g, fg.b, 0.8 * tint.a), false, 1.5)
			var mid := r2.position.x + r2.size.x * 0.5
			draw_line(Vector2(mid, r2.position.y + 1), Vector2(mid, r2.position.y + r2.size.y * 0.42), Color(fg.r, fg.g, fg.b, 0.6 * tint.a), 1.2)
			draw_line(Vector2(r2.position.x + 1, r2.position.y + r2.size.y * 0.42), Vector2(r2.end.x - 1, r2.position.y + r2.size.y * 0.42), Color(fg.r, fg.g, fg.b, 0.6 * tint.a), 1.2)
			var t := String(_g["text"])
			var hl := Rect2(r2.position + Vector2(2, 2), Vector2(r2.size.x * 0.5 - 3, r2.size.y * 0.42 - 3))
			if t == "RMB":
				hl.position.x = mid + 1
			if t == "LMB" or t == "RMB":
				_rounded(hl, 3.0, Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, 0.95 * tint.a), true)
			elif t == "Wheel" or t == "MMB":
				draw_line(Vector2(mid, r2.position.y + 4), Vector2(mid, r2.position.y + r2.size.y * 0.32), UITheme.ACCENT * tint, 3.0)
		"pad_button":
			var bi := int(_g["index"])
			if bi <= 3:
				var c := off + Vector2(h, h) * 0.5
				var col: Color = _g["color"]
				draw_circle(c, h * 0.5 - 0.5, Color(0.08, 0.09, 0.1, 0.85 * tint.a))
				draw_arc(c, h * 0.5 - 1.2, 0.0, TAU, 32, Color(col.r, col.g, col.b, 0.9 * tint.a), 1.6, true)
				_text_centered(String(_g["text"]), Rect2(off, Vector2(h, h)), int(h * 0.52), Color(col.r, col.g, col.b, tint.a).lightened(0.15))
			elif bi >= 11 and bi <= 14:
				_dpad(off, h, bi, fg)
			elif bi == 4 or bi == 6 or bi == 5 or bi == 15:
				var c2 := off + Vector2(h, h) * 0.5
				draw_circle(c2, h * 0.5 - 0.5, Color(0.08, 0.09, 0.1, 0.85 * tint.a))
				draw_arc(c2, h * 0.5 - 1.2, 0.0, TAU, 32, Color(fg.r, fg.g, fg.b, 0.7 * tint.a), 1.4, true)
				var u := h * 0.16
				if bi == 4:
					draw_rect(Rect2(c2 + Vector2(-u * 1.3, -u * 1.1), Vector2(u * 1.7, u * 1.4)), fg, false, 1.3)
					draw_rect(Rect2(c2 + Vector2(-u * 0.4, -u * 0.3), Vector2(u * 1.7, u * 1.4)), fg, false, 1.3)
				elif bi == 6:
					for k in 3:
						var y := c2.y + (k - 1) * u * 0.9
						draw_line(Vector2(c2.x - u * 1.2, y), Vector2(c2.x + u * 1.2, y), fg, 1.5)
				else:
					draw_circle(c2, u, fg)
			else:
				_pill(off, sz, String(_g["text"]), fg)
		"pad_axis":
			_pill(off, sz, String(_g["text"]), fg, true)
		"touch":
			var tex := UITheme.icon(String(_g.get("icon", "interact")))
			var c3 := off + Vector2(h, h) * 0.5
			draw_circle(c3, h * 0.5 - 0.5, Color(0.08, 0.09, 0.1, 0.6 * tint.a))
			draw_arc(c3, h * 0.5 - 1.0, 0.0, TAU, 32, Color(fg.r, fg.g, fg.b, 0.6 * tint.a), 1.3, true)
			if tex:
				var s := h * 0.6
				draw_texture_rect(tex, Rect2(c3 - Vector2(s, s) * 0.5, Vector2(s, s)), false, fg)
		_:
			if String(_g.get("text", "")) != "":
				_text_centered(String(_g["text"]), Rect2(off, sz), int(h * 0.5), fg)
	if hold:
		var c4 := off + Vector2(sz.x, h) * 0.5
		draw_arc(c4, h * 0.5 + 3.5, -PI * 0.5, PI * 1.5, 40, Color(fg.r, fg.g, fg.b, 0.35 * tint.a), 1.5, true)


func _pill(off: Vector2, sz: Vector2, text: String, fg: Color, trigger := false) -> void:
	var r := Rect2(off + Vector2(0.5, 0.5), sz - Vector2(1, 1))
	var rad := sz.y * (0.28 if trigger else 0.5)
	_rounded(r, rad, Color(0.08, 0.09, 0.1, 0.85 * tint.a), true)
	_rounded(r, rad, Color(fg.r, fg.g, fg.b, 0.7 * tint.a), false, 1.4)
	_text_centered(text, r, int(sz.y * 0.44), fg)


func _dpad(off: Vector2, h: float, bi: int, fg: Color) -> void:
	var c := off + Vector2(h, h) * 0.5
	var a := h * 0.19
	var l := h * 0.47
	var base := Color(fg.r, fg.g, fg.b, 0.35 * tint.a)
	draw_rect(Rect2(c - Vector2(a, l), Vector2(a * 2, l * 2)), base)
	draw_rect(Rect2(c - Vector2(l, a), Vector2(l * 2, a * 2)), base)
	var dir := {11: Vector2(0, -1), 12: Vector2(0, 1), 13: Vector2(-1, 0), 14: Vector2(1, 0)}[bi] as Vector2
	var arm := Rect2()
	if dir.x == 0.0:
		arm = Rect2(Vector2(c.x - a, c.y + (0.0 if dir.y > 0 else -l)), Vector2(a * 2, l))
	else:
		arm = Rect2(Vector2(c.x + (0.0 if dir.x > 0 else -l), c.y - a), Vector2(l, a * 2))
	draw_rect(arm.grow(-0.5), Color(fg.r, fg.g, fg.b, tint.a))


func _rounded(r: Rect2, radius: float, col: Color, filled: bool, width := 1.0) -> void:
	var sb := StyleBoxFlat.new()
	sb.set_corner_radius_all(int(radius))
	sb.anti_aliasing = true
	if filled:
		sb.bg_color = col
	else:
		sb.draw_center = false
		sb.set_border_width_all(int(ceilf(width)))
		sb.border_color = col
	draw_style_box(sb, r)


func _text_centered(t: String, r: Rect2, fs: int, col: Color) -> void:
	if _font == null:
		return
	var ts := _font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var asc := _font.get_ascent(fs)
	var desc := _font.get_descent(fs)
	var pos := Vector2(r.position.x + (r.size.x - ts.x) * 0.5, r.position.y + (r.size.y + asc - desc) * 0.5 - 1.0)
	draw_string(_font, pos, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)

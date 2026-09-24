class_name InvStyle
extends RefCounted
## Visual language of the inventory/crafting screens: field-gear PDA — dark translucent panels, hairline
## borders, IBM Plex, one warm accent. Everything is built here so every sub-page stays consistent.

const BG := Color(0.055, 0.066, 0.078, 0.84)
const BG_SOFT := Color(0.09, 0.105, 0.12, 0.72)
const SLOT_BG := Color(0.0, 0.0, 0.0, 0.34)
const LINE := Color(1, 1, 1, 0.075)
const LINE_STRONG := Color(1, 1, 1, 0.2)
const TEXT := Color(0.9, 0.92, 0.93)
const TEXT_DIM := Color(0.58, 0.63, 0.67)
const TEXT_FAINT := Color(0.4, 0.44, 0.48)
const ACCENT := Color(0.93, 0.64, 0.24)
const ACCENT_DIM := Color(0.93, 0.64, 0.24, 0.22)
const GOOD := Color(0.49, 0.78, 0.55)
const BAD := Color(0.9, 0.39, 0.34)
const WARN := Color(0.96, 0.78, 0.35)
const COLD := Color(0.55, 0.78, 0.95)

const FONT_DIR := "res://assets/fonts/"

static var _fonts: Dictionary = {}


static func font(weight := "Regular") -> Font:
	if _fonts.has(weight):
		return _fonts[weight]
	var f: Font = null
	var path := FONT_DIR + ("IBMPlexMono-Medium.ttf" if weight == "Mono" else "IBMPlexSans-%s.ttf" % weight)
	if ResourceLoader.exists(path):
		f = load(path)
	_fonts[weight] = f
	return f


## Caps label font with generous tracking (section titles, tab names).
static func caps_font(weight := "SemiBold", spacing := 2) -> Font:
	var key := "caps_%s_%d" % [weight, spacing]
	if _fonts.has(key):
		return _fonts[key]
	var fv := FontVariation.new()
	fv.base_font = font(weight)
	fv.spacing_glyph = spacing
	_fonts[key] = fv
	return fv


static func panel(bg := BG, radius := 6, border := LINE, border_w := 1, pad := 16) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.set_border_width_all(border_w)
	sb.border_color = border
	sb.set_content_margin_all(pad)
	sb.anti_aliasing = true
	return sb


static func slot_box(state: int) -> StyleBoxFlat:
	# 0 normal, 1 hover, 2 selected, 3 drop-target, 4 disabled/empty-locked
	var sb := StyleBoxFlat.new()
	sb.bg_color = SLOT_BG
	sb.set_corner_radius_all(5)
	sb.set_border_width_all(1)
	sb.border_color = LINE
	sb.anti_aliasing = true
	match state:
		1:
			sb.border_color = LINE_STRONG
			sb.bg_color = Color(1, 1, 1, 0.045)
		2:
			sb.border_color = ACCENT
			sb.set_border_width_all(2)
			sb.bg_color = Color(ACCENT.r, ACCENT.g, ACCENT.b, 0.1)
			sb.shadow_color = Color(ACCENT.r, ACCENT.g, ACCENT.b, 0.18)
			sb.shadow_size = 6
		3:
			sb.border_color = Color(1, 1, 1, 0.55)
			sb.set_border_width_all(2)
			sb.bg_color = Color(1, 1, 1, 0.08)
		4:
			sb.bg_color = Color(0, 0, 0, 0.2)
			sb.border_color = Color(1, 1, 1, 0.035)
	return sb


static func button_box(kind: String, state: String) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.set_corner_radius_all(5)
	sb.anti_aliasing = true
	sb.content_margin_left = 18
	sb.content_margin_right = 18
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	sb.set_border_width_all(1)
	if kind == "primary":
		sb.bg_color = ACCENT if state != "disabled" else Color(ACCENT.r, ACCENT.g, ACCENT.b, 0.25)
		sb.border_color = Color(1, 1, 1, 0.0)
		if state == "hover":
			sb.bg_color = ACCENT.lightened(0.12)
		elif state == "pressed":
			sb.bg_color = ACCENT.darkened(0.12)
		elif state == "focus":
			sb.bg_color = Color(0, 0, 0, 0)
			sb.border_color = Color(1, 1, 1, 0.9)
			sb.set_border_width_all(2)
			sb.draw_center = false
	elif kind == "ghost":
		sb.bg_color = Color(0, 0, 0, 0)
		sb.border_color = Color(0, 0, 0, 0)
		if state == "hover":
			sb.bg_color = Color(1, 1, 1, 0.06)
		elif state == "pressed":
			sb.bg_color = Color(1, 1, 1, 0.1)
		elif state == "focus":
			sb.draw_center = false
			sb.border_color = ACCENT
			sb.set_border_width_all(2)
	else:
		sb.bg_color = Color(1, 1, 1, 0.04)
		sb.border_color = LINE_STRONG
		if state == "hover":
			sb.bg_color = Color(1, 1, 1, 0.1)
			sb.border_color = Color(1, 1, 1, 0.35)
		elif state == "pressed":
			sb.bg_color = Color(1, 1, 1, 0.16)
		elif state == "disabled":
			sb.bg_color = Color(1, 1, 1, 0.015)
			sb.border_color = Color(1, 1, 1, 0.06)
		elif state == "focus":
			sb.draw_center = false
			sb.border_color = ACCENT
			sb.set_border_width_all(2)
	return sb


static func style_button(b: Button, kind := "secondary", font_size := 20) -> void:
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		b.add_theme_stylebox_override(st, button_box(kind, st))
	b.add_theme_font_override("font", font("SemiBold"))
	b.add_theme_font_size_override("font_size", font_size)
	var fg := Color(0.08, 0.07, 0.05) if kind == "primary" else TEXT
	b.add_theme_color_override("font_color", fg)
	b.add_theme_color_override("font_hover_color", fg)
	b.add_theme_color_override("font_pressed_color", fg)
	b.add_theme_color_override("font_focus_color", fg if kind == "primary" else TEXT)
	b.add_theme_color_override("font_disabled_color", Color(fg.r, fg.g, fg.b, 0.35) if kind == "primary" else TEXT_FAINT)
	b.focus_mode = Control.FOCUS_ALL


static func label(text: String, size := 20, color := TEXT, weight := "Regular") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(weight))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func caps(text: String, size := 15, color := TEXT_DIM, spacing := 2) -> Label:
	var l := Label.new()
	l.text = text.to_upper()
	l.add_theme_font_override("font", caps_font("SemiBold", spacing))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func hline(color := LINE) -> ColorRect:
	var r := ColorRect.new()
	r.color = color
	r.custom_minimum_size = Vector2(0, 1)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r


static func theme() -> Theme:
	var t := Theme.new()
	t.default_font = font("Regular")
	t.default_font_size = 20
	t.set_color("font_color", "Label", TEXT)
	var sb_scroll := StyleBoxFlat.new()
	sb_scroll.bg_color = Color(1, 1, 1, 0.04)
	sb_scroll.set_corner_radius_all(3)
	var sb_grab := StyleBoxFlat.new()
	sb_grab.bg_color = Color(1, 1, 1, 0.22)
	sb_grab.set_corner_radius_all(3)
	var sb_grab_hl := sb_grab.duplicate()
	sb_grab_hl.bg_color = Color(1, 1, 1, 0.35)
	t.set_stylebox("scroll", "VScrollBar", sb_scroll)
	t.set_stylebox("grabber", "VScrollBar", sb_grab)
	t.set_stylebox("grabber_highlight", "VScrollBar", sb_grab_hl)
	t.set_stylebox("grabber_pressed", "VScrollBar", sb_grab_hl)
	t.set_constant("scroll_speed", "ScrollContainer", 60)
	var tip := panel(Color(0.04, 0.05, 0.06, 0.95), 4, LINE_STRONG, 1, 10)
	t.set_stylebox("panel", "TooltipPanel", tip)
	t.set_color("font_color", "TooltipLabel", TEXT)
	t.set_font_size("font_size", "TooltipLabel", 17)
	return t


## Colour for a durability fraction.
static func durability_color(f: float) -> Color:
	if f > 0.5:
		return GOOD.lerp(WARN, (1.0 - f) * 2.0 * 0.4)
	if f > 0.2:
		return WARN
	return BAD

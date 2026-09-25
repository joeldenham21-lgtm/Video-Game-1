class_name UITheme
extends RefCounted
## THIN AIR UI design system: palette, type scale, spacing, icons, the project Theme (assets/ui/theme.tres)
## and small widget factories. Same visual language as the inventory ("field kit": translucent charcoal,
## hairlines, IBM Plex, one warm accent) — the palette below IS InvStyle's, so both screens stay in sync.
##
## Colour roles: off-white text · amber = focus/selection and warnings · cyan = oxygen only ·
## red = critical only · a pale gold for discoveries, a cool blue for cold.
##
## Scaling: every full-screen UI root is laid out on a logical canvas (the 1920×1080 stretch base, expanded
## to the window aspect) and scaled by ui_scale() — Settings.touch_ui_scale × 1.6 on phones (a 6.8" screen
## at arm's length) — never below what the layout needs. Use fit_root() on each screen's root Control.

# ------------------------------------------------------------------------------------------ palette
const BG := InvStyle.BG
const BG_SOFT := InvStyle.BG_SOFT
const BG_SOLID := Color(0.045, 0.052, 0.062, 0.96)
const SCRIM := Color(0.02, 0.025, 0.03, 0.62)
const LINE := InvStyle.LINE
const LINE_STRONG := InvStyle.LINE_STRONG
const TEXT := InvStyle.TEXT
const TEXT_DIM := InvStyle.TEXT_DIM
const TEXT_FAINT := InvStyle.TEXT_FAINT
const ACCENT := InvStyle.ACCENT
const ACCENT_DIM := InvStyle.ACCENT_DIM
const WARNING := InvStyle.WARN
const CRITICAL := Color(0.92, 0.3, 0.26)
const GOOD := InvStyle.GOOD
const COLD := InvStyle.COLD
const OXYGEN := Color(0.4, 0.84, 0.94)
const DISCOVERY := Color(0.95, 0.86, 0.62)
const SHADOW := Color(0.0, 0.0, 0.0, 0.55)
const PAPER := Color(0.93, 0.9, 0.83)

# ------------------------------------------------------------------------------------------ type scale
## Logical px at the 1080-high canvas. HUD text is never below FS_SMALL.
const FS_CAPTION := 15
const FS_SMALL := 17
const FS_BODY := 20
const FS_LEAD := 24
const FS_H3 := 28
const FS_H2 := 34
const FS_H1 := 46
const FS_TITLE := 118

# ------------------------------------------------------------------------------------------ spacing
## 4-pt scale: SP[1] = 4 … SP[8] = 64.
const SP: Array[int] = [0, 4, 8, 12, 16, 24, 32, 48, 64]
const RADIUS := 6
const RADIUS_SM := 4

const FONT_DIR := "res://assets/fonts/"
const ICON_DIR := "res://assets/ui/icons/"
const THEME_PATH := "res://assets/ui/theme.tres"
const MOBILE_UI_FACTOR := 1.6

static var _fonts: Dictionary = {}
static var _icons: Dictionary = {}


# ================================================================================================ fonts

## "Light", "Regular", "Medium", "SemiBold", "Bold", "Italic", "Mono", "MonoRegular".
static func font(weight := "Regular") -> Font:
	if _fonts.has(weight):
		return _fonts[weight]
	var path := FONT_DIR + "IBMPlexSans-%s.ttf" % weight
	if weight == "Mono":
		path = FONT_DIR + "IBMPlexMono-Medium.ttf"
	elif weight == "MonoRegular":
		path = FONT_DIR + "IBMPlexMono-Regular.ttf"
	var f: Font = load(path) if ResourceLoader.exists(path) else ThemeDB.fallback_font
	_fonts[weight] = f
	return f


## Tracked capitals (section titles, tabs, HUD labels). spacing in px per glyph.
static func caps_font(weight := "SemiBold", spacing := 2) -> Font:
	var key := "caps_%s_%d" % [weight, spacing]
	if _fonts.has(key):
		return _fonts[key]
	var fv := FontVariation.new()
	fv.base_font = font(weight)
	fv.spacing_glyph = spacing
	_fonts[key] = fv
	return fv


## Tabular figures for numbers that change (altitude, timers) so they don't jitter.
static func mono_font() -> Font:
	return font("Mono")


# ================================================================================================ icons

## Line icon from assets/ui/icons (white; tint with modulate / self_modulate / draw colour).
static func icon(name: String) -> Texture2D:
	if _icons.has(name):
		return _icons[name]
	var path := ICON_DIR + name + ".svg"
	var t: Texture2D = load(path) if ResourceLoader.exists(path) else null
	_icons[name] = t
	return t


# ================================================================================================ scale

## UI scale for the logical canvas `vp` (in stretch units).
static func ui_scale(vp: Vector2, min_w := 1180.0, min_h := 620.0) -> float:
	var s := float(Settings.get_value(&"touch_ui_scale", 1.0))
	if Settings.is_mobile():
		s *= MOBILE_UI_FACTOR
	s = clampf(s, 0.6, 2.4)
	return minf(s, minf(vp.x / min_w, vp.y / min_h))


## Scales `root` (anchored top-left) so it covers the viewport on a canvas of vp / scale. Returns the scale.
static func fit_root(root: Control, min_w := 1180.0, min_h := 620.0) -> float:
	var vp := root.get_viewport().get_visible_rect().size if root.is_inside_tree() else Vector2(1920, 1080)
	var s := ui_scale(vp, min_w, min_h)
	root.set_anchors_preset(Control.PRESET_TOP_LEFT)
	root.scale = Vector2(s, s)
	root.position = Vector2.ZERO
	root.size = vp / s
	return s


## Physical size → logical units of `ctrl`'s canvas (after its own scale). Uses the screen DPI when known;
## headless / unknown displays assume a 1080-unit-high canvas on a ~90 mm tall screen.
static func mm_to_units(ctrl: Control, mm: float) -> float:
	var own := 1.0
	if ctrl.is_inside_tree():
		own = maxf(0.01, ctrl.get_global_transform_with_canvas().x.length())
	var dpi := float(DisplayServer.screen_get_dpi())
	if DisplayServer.get_name() == "headless" or dpi < 60.0 or not ctrl.is_inside_tree():
		return mm * 12.0 / own
	var px := mm * dpi / 25.4
	var win_scale := ctrl.get_viewport().get_final_transform().x.x
	var units := px / maxf(0.01, win_scale * own)
	# guard against odd window/DPI reports: stay within 4–40 canvas units per mm
	return clampf(units, mm * 4.0 / own, mm * 40.0 / own)


# ================================================================================================ styles

static func panel(bg := BG, radius := RADIUS, border := LINE, border_w := 1, pad := 16) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(radius)
	sb.set_border_width_all(border_w)
	sb.border_color = border
	sb.set_content_margin_all(pad)
	sb.anti_aliasing = true
	return sb


static func empty_box(pad := 0) -> StyleBoxEmpty:
	var sb := StyleBoxEmpty.new()
	sb.set_content_margin_all(pad)
	return sb


## Focus ring used everywhere (visible on any background, gamepad/keyboard only — mouse hides it).
static func focus_box(radius := RADIUS_SM, grow := 3.0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.draw_center = false
	sb.set_border_width_all(2)
	sb.border_color = ACCENT
	sb.set_corner_radius_all(radius + int(grow))
	sb.expand_margin_left = grow
	sb.expand_margin_right = grow
	sb.expand_margin_top = grow
	sb.expand_margin_bottom = grow
	sb.anti_aliasing = true
	return sb


static func _btn(bg: Color, border: Color, pad_h := 18, pad_v := 10, radius := RADIUS_SM) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(radius)
	sb.content_margin_left = pad_h
	sb.content_margin_right = pad_h
	sb.content_margin_top = pad_v
	sb.content_margin_bottom = pad_v
	sb.anti_aliasing = true
	return sb


## Menu entry (main menu / pause): text only, a slim amber bar on the left when hovered or focused.
static func _menu_btn(state: String) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 1, 1, 0.0)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 9
	sb.content_margin_bottom = 9
	sb.anti_aliasing = true
	match state:
		"hover", "focus":
			sb.bg_color = Color(1, 1, 1, 0.06)
			sb.border_width_left = 3
			sb.border_color = ACCENT
		"pressed":
			sb.bg_color = Color(1, 1, 1, 0.1)
			sb.border_width_left = 3
			sb.border_color = ACCENT.darkened(0.15)
	return sb


## The project-wide Theme. Saved to assets/ui/theme.tres (project setting gui/theme/custom) by
## `ui_test.tscn -- --build-theme`; every UI script also applies it to its own root so it holds without it.
static func build_theme() -> Theme:
	var t := Theme.new()
	t.default_font = font("Regular")
	t.default_font_size = FS_BODY
	# ---- Label
	t.set_color("font_color", "Label", TEXT)
	t.set_color("font_shadow_color", "Label", Color(0, 0, 0, 0))
	t.set_constant("line_spacing", "Label", 3)
	_label_variation(t, "CaptionLabel", "SemiBold", FS_CAPTION, TEXT_DIM, 2)
	_label_variation(t, "DimLabel", "Regular", FS_SMALL, TEXT_DIM, 0)
	_label_variation(t, "HeadingLabel", "Medium", FS_H3, TEXT, 0)
	_label_variation(t, "TitleLabel", "Light", FS_H1, TEXT, 0)
	_label_variation(t, "MonoLabel", "Mono", FS_SMALL, TEXT, 0)
	# ---- Buttons (secondary by default)
	t.set_stylebox("normal", "Button", _btn(Color(1, 1, 1, 0.04), LINE_STRONG))
	t.set_stylebox("hover", "Button", _btn(Color(1, 1, 1, 0.1), Color(1, 1, 1, 0.35)))
	t.set_stylebox("pressed", "Button", _btn(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.35)))
	t.set_stylebox("hover_pressed", "Button", _btn(Color(1, 1, 1, 0.16), Color(1, 1, 1, 0.35)))
	t.set_stylebox("disabled", "Button", _btn(Color(1, 1, 1, 0.015), Color(1, 1, 1, 0.06)))
	t.set_stylebox("focus", "Button", focus_box())
	t.set_font("font", "Button", font("SemiBold"))
	t.set_font_size("font_size", "Button", FS_BODY)
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		t.set_color(c, "Button", TEXT)
	t.set_color("font_disabled_color", "Button", TEXT_FAINT)
	t.set_color("icon_normal_color", "Button", TEXT)
	t.set_color("icon_disabled_color", "Button", TEXT_FAINT)
	t.set_constant("h_separation", "Button", 10)
	t.set_constant("icon_max_width", "Button", 26)
	# primary (amber)
	t.set_type_variation("PrimaryButton", "Button")
	t.set_stylebox("normal", "PrimaryButton", _btn(ACCENT, Color(0, 0, 0, 0)))
	t.set_stylebox("hover", "PrimaryButton", _btn(ACCENT.lightened(0.12), Color(0, 0, 0, 0)))
	t.set_stylebox("pressed", "PrimaryButton", _btn(ACCENT.darkened(0.12), Color(0, 0, 0, 0)))
	t.set_stylebox("disabled", "PrimaryButton", _btn(Color(ACCENT.r, ACCENT.g, ACCENT.b, 0.25), Color(0, 0, 0, 0)))
	var dark := Color(0.08, 0.07, 0.05)
	for c in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		t.set_color(c, "PrimaryButton", dark)
	t.set_color("icon_normal_color", "PrimaryButton", dark)
	t.set_color("font_disabled_color", "PrimaryButton", Color(dark.r, dark.g, dark.b, 0.4))
	# ghost / flat
	t.set_type_variation("GhostButton", "Button")
	t.set_stylebox("normal", "GhostButton", _btn(Color(0, 0, 0, 0), Color(0, 0, 0, 0)))
	t.set_stylebox("hover", "GhostButton", _btn(Color(1, 1, 1, 0.06), Color(0, 0, 0, 0)))
	t.set_stylebox("pressed", "GhostButton", _btn(Color(1, 1, 1, 0.1), Color(0, 0, 0, 0)))
	t.set_stylebox("disabled", "GhostButton", _btn(Color(0, 0, 0, 0), Color(0, 0, 0, 0)))
	# menu entries
	t.set_type_variation("MenuEntryButton", "Button")
	for st in ["normal", "hover", "pressed", "disabled", "hover_pressed"]:
		t.set_stylebox(st, "MenuEntryButton", _menu_btn(st))
	t.set_stylebox("focus", "MenuEntryButton", _menu_btn("focus"))
	t.set_font("font", "MenuEntryButton", font("Regular"))
	t.set_font_size("font_size", "MenuEntryButton", 30)
	t.set_color("font_color", "MenuEntryButton", Color(TEXT.r, TEXT.g, TEXT.b, 0.82))
	t.set_color("font_hover_color", "MenuEntryButton", TEXT)
	t.set_color("font_focus_color", "MenuEntryButton", TEXT)
	t.set_color("font_pressed_color", "MenuEntryButton", ACCENT)
	t.set_color("font_disabled_color", "MenuEntryButton", Color(TEXT.r, TEXT.g, TEXT.b, 0.3))
	# tabs (text + amber underline drawn by the owner)
	t.set_type_variation("TabButton", "Button")
	for st in ["normal", "hover", "pressed", "disabled", "hover_pressed"]:
		var sb := _btn(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 14, 8)
		sb.set_border_width_all(0)
		if st == "hover":
			sb.bg_color = Color(1, 1, 1, 0.05)
		t.set_stylebox(st, "TabButton", sb)
	t.set_font("font", "TabButton", caps_font("SemiBold", 3))
	t.set_font_size("font_size", "TabButton", 18)
	t.set_color("font_color", "TabButton", TEXT_DIM)
	t.set_color("font_hover_color", "TabButton", TEXT)
	t.set_color("font_pressed_color", "TabButton", TEXT)
	t.set_color("font_focus_color", "TabButton", TEXT)
	t.set_color("font_hover_pressed_color", "TabButton", TEXT)
	# ---- Panels
	t.set_stylebox("panel", "PanelContainer", panel())
	t.set_stylebox("panel", "Panel", panel())
	t.set_type_variation("CardPanel", "PanelContainer")
	t.set_stylebox("panel", "CardPanel", panel(Color(1, 1, 1, 0.03), RADIUS, LINE, 1, 16))
	t.set_type_variation("SolidPanel", "PanelContainer")
	t.set_stylebox("panel", "SolidPanel", panel(BG_SOLID, RADIUS, LINE_STRONG, 1, 24))
	# ---- Toggles
	var ck_on := _toggle_icon(true)
	var ck_off := _toggle_icon(false)
	for cls in ["CheckBox", "CheckButton"]:
		t.set_icon("checked", cls, ck_on)
		t.set_icon("unchecked", cls, ck_off)
		t.set_icon("checked_disabled", cls, ck_on)
		t.set_icon("unchecked_disabled", cls, ck_off)
		t.set_stylebox("normal", cls, empty_box(4))
		t.set_stylebox("hover", cls, empty_box(4))
		t.set_stylebox("pressed", cls, empty_box(4))
		t.set_stylebox("hover_pressed", cls, empty_box(4))
		t.set_stylebox("focus", cls, focus_box())
		t.set_color("font_color", cls, TEXT)
		t.set_color("font_hover_color", cls, TEXT)
		t.set_color("font_pressed_color", cls, TEXT)
		t.set_color("font_focus_color", cls, TEXT)
		t.set_constant("icon_max_width", cls, 0)       # the switch art is wider than Button's icon cap
		t.set_constant("h_separation", cls, 12)
	# ---- Slider
	var track := StyleBoxFlat.new()
	track.bg_color = Color(1, 1, 1, 0.14)
	track.set_corner_radius_all(2)
	track.content_margin_top = 2
	track.content_margin_bottom = 2
	var fill := track.duplicate() as StyleBoxFlat
	fill.bg_color = Color(TEXT.r, TEXT.g, TEXT.b, 0.85)
	var fill_hl := track.duplicate() as StyleBoxFlat
	fill_hl.bg_color = ACCENT
	t.set_stylebox("slider", "HSlider", track)
	t.set_stylebox("grabber_area", "HSlider", fill)
	t.set_stylebox("grabber_area_highlight", "HSlider", fill_hl)
	t.set_stylebox("focus", "HSlider", focus_box(8, 6.0))
	t.set_icon("grabber", "HSlider", _dot_icon(18, TEXT))
	t.set_icon("grabber_highlight", "HSlider", _dot_icon(20, ACCENT))
	t.set_icon("grabber_disabled", "HSlider", _dot_icon(16, TEXT_FAINT))
	t.set_constant("center_grabber", "HSlider", 1)
	t.set_constant("grabber_offset", "HSlider", 0)
	# ---- Scroll
	var sb_scroll := StyleBoxFlat.new()
	sb_scroll.bg_color = Color(1, 1, 1, 0.04)
	sb_scroll.set_corner_radius_all(3)
	sb_scroll.content_margin_left = 3
	sb_scroll.content_margin_right = 3
	var sb_grab := StyleBoxFlat.new()
	sb_grab.bg_color = Color(1, 1, 1, 0.22)
	sb_grab.set_corner_radius_all(3)
	var sb_grab_hl := sb_grab.duplicate() as StyleBoxFlat
	sb_grab_hl.bg_color = Color(1, 1, 1, 0.38)
	for cls in ["VScrollBar", "HScrollBar"]:
		t.set_stylebox("scroll", cls, sb_scroll)
		t.set_stylebox("grabber", cls, sb_grab)
		t.set_stylebox("grabber_highlight", cls, sb_grab_hl)
		t.set_stylebox("grabber_pressed", cls, sb_grab_hl)
	t.set_constant("scroll_speed", "ScrollContainer", 60)
	t.set_stylebox("panel", "ScrollContainer", empty_box())
	# ---- Progress bar
	var pb_bg := StyleBoxFlat.new()
	pb_bg.bg_color = Color(1, 1, 1, 0.1)
	pb_bg.set_corner_radius_all(2)
	var pb_fill := pb_bg.duplicate() as StyleBoxFlat
	pb_fill.bg_color = TEXT
	t.set_stylebox("background", "ProgressBar", pb_bg)
	t.set_stylebox("fill", "ProgressBar", pb_fill)
	# ---- LineEdit / OptionButton / PopupMenu
	t.set_stylebox("normal", "LineEdit", _btn(Color(0, 0, 0, 0.3), LINE_STRONG, 12, 8))
	t.set_stylebox("focus", "LineEdit", focus_box())
	t.set_color("font_color", "LineEdit", TEXT)
	t.set_stylebox("panel", "PopupMenu", panel(BG_SOLID, RADIUS_SM, LINE_STRONG, 1, 8))
	t.set_stylebox("hover", "PopupMenu", _btn(Color(1, 1, 1, 0.08), Color(0, 0, 0, 0), 8, 4))
	t.set_color("font_color", "PopupMenu", TEXT)
	t.set_color("font_hover_color", "PopupMenu", TEXT)
	# ---- Tooltip
	t.set_stylebox("panel", "TooltipPanel", panel(Color(0.04, 0.05, 0.06, 0.95), RADIUS_SM, LINE_STRONG, 1, 10))
	t.set_color("font_color", "TooltipLabel", TEXT)
	t.set_font_size("font_size", "TooltipLabel", FS_SMALL)
	t.set_font("font", "TooltipLabel", font("Regular"))
	# ---- RichTextLabel
	t.set_font("normal_font", "RichTextLabel", font("Regular"))
	t.set_font("bold_font", "RichTextLabel", font("SemiBold"))
	t.set_font("italics_font", "RichTextLabel", font("Italic"))
	t.set_font("mono_font", "RichTextLabel", font("MonoRegular"))
	t.set_font_size("normal_font_size", "RichTextLabel", FS_BODY)
	t.set_font_size("bold_font_size", "RichTextLabel", FS_BODY)
	t.set_font_size("italics_font_size", "RichTextLabel", FS_BODY)
	t.set_font_size("mono_font_size", "RichTextLabel", FS_SMALL)
	t.set_color("default_color", "RichTextLabel", TEXT)
	t.set_constant("line_separation", "RichTextLabel", 6)
	t.set_stylebox("focus", "RichTextLabel", empty_box())
	t.set_stylebox("normal", "RichTextLabel", empty_box())
	return t


static func _label_variation(t: Theme, name: String, weight: String, size: int, color: Color, spacing: int) -> void:
	t.set_type_variation(name, "Label")
	t.set_font("font", name, caps_font(weight, spacing) if spacing > 0 else font(weight))
	t.set_font_size("font_size", name, size)
	t.set_color("font_color", name, color)


## Pill switch drawn into an image (on = amber track + white knob right, off = hairline track).
static func _toggle_icon(on: bool) -> ImageTexture:
	var w := 52
	var h := 28
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var track := ACCENT if on else Color(1, 1, 1, 0.16)
	var knob := Color(0.1, 0.09, 0.07) if on else TEXT
	var r := h * 0.5
	var kx := w - r if on else r
	for y in h:
		for x in w:
			var px := Vector2(x + 0.5, y + 0.5)
			# capsule distance
			var cx := clampf(px.x, r, w - r)
			var d := px.distance_to(Vector2(cx, r)) - (r - 1.0)
			var a := clampf(0.5 - d, 0.0, 1.0)
			var col := Color(track.r, track.g, track.b, track.a * a)
			var dk := px.distance_to(Vector2(kx, r)) - (r - 4.0)
			var ak := clampf(0.5 - dk, 0.0, 1.0)
			col = col.blend(Color(knob.r, knob.g, knob.b, ak))
			img.set_pixel(x, y, col)
	return ImageTexture.create_from_image(img)


static func _dot_icon(size: int, color: Color) -> ImageTexture:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c := Vector2(size, size) * 0.5
	for y in size:
		for x in size:
			var d := Vector2(x + 0.5, y + 0.5).distance_to(c) - (size * 0.5 - 1.5)
			var a := clampf(0.5 - d, 0.0, 1.0)
			var ring := clampf(0.5 - absf(d + 1.2), 0.0, 1.0) * 0.35
			img.set_pixel(x, y, Color(color.r, color.g, color.b, a).blend(Color(0, 0, 0, ring)))
	return ImageTexture.create_from_image(img)


static func get_theme() -> Theme:
	if _fonts.has("__theme"):
		return _fonts["__theme"]
	var th: Theme = null
	if ResourceLoader.exists(THEME_PATH):
		th = load(THEME_PATH) as Theme
	if th == null:
		th = build_theme()
	_fonts["__theme"] = th
	return th


# ================================================================================================ widgets

static func label(text: String, size := FS_BODY, color := TEXT, weight := "Regular") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(weight))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func caps(text: String, size := FS_CAPTION, color := TEXT_DIM, spacing := 2, weight := "SemiBold") -> Label:
	var l := Label.new()
	l.text = text.to_upper()
	l.add_theme_font_override("font", caps_font(weight, spacing))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


## HUD text over the world: soft dark outline keeps it legible on sunlit snow.
static func hud_label(text: String, size := FS_SMALL, color := TEXT, weight := "Medium") -> Label:
	var l := label(text, size, color, weight)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.42))
	l.add_theme_constant_override("outline_size", 5)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static func hline(color := LINE) -> ColorRect:
	var r := ColorRect.new()
	r.color = color
	r.custom_minimum_size = Vector2(0, 1)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r


static func button(text: String, variation := "", icon_name := "") -> Button:
	var b := Button.new()
	b.text = text
	if variation != "":
		b.theme_type_variation = variation
	if icon_name != "":
		b.icon = icon(icon_name)
		b.expand_icon = false
	b.focus_mode = Control.FOCUS_ALL
	return b


static func menu_button(text: String) -> Button:
	var b := button(text, "MenuEntryButton")
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	return b


static func icon_rect(name: String, size := 24.0, color := TEXT) -> TextureRect:
	var r := TextureRect.new()
	r.texture = icon(name)
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.custom_minimum_size = Vector2(size, size)
	r.modulate = color
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r


static func margin(all := 16) -> MarginContainer:
	var m := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		m.add_theme_constant_override(side, all)
	return m


static func vbox(sep := 8) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	return v


static func hbox(sep := 8) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	return h


# ================================================================================================ formatting

## 2431 → "2,431"
static func thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("−" if n < 0 else "") + s + out


## −8 °C with a real minus sign.
static func celsius(c: float) -> String:
	var r := roundi(c)
	return ("−%d °C" % absi(r)) if r < 0 else ("%d °C" % r)


static func metres(m: float) -> String:
	return thousands(roundi(m)) + " m"


static func duration(seconds: float) -> String:
	var mins := int(seconds / 60.0)
	if mins < 60:
		return "%d min" % maxi(mins, 0)
	return "%d h %02d min" % [mins / 60, mins % 60]


static func clock(hours: float) -> String:
	var total := posmod(int(floorf(fposmod(hours, 24.0) * 60.0 + 0.001)), 1440)
	return "%02d:%02d" % [total / 60, total % 60]

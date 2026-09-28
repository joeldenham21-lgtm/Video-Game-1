class_name BuildModeUI
extends CanvasLayer
## Build mode screens: the picker (category tabs + cards with icon, name and cost — what you carry in green,
## what's missing in red, "needs a hammer" / "blueprint" notes) and, while placing, a bottom hint with the
## piece, its cost, the controls for the current device and the reason a red ghost can't go down. On touch
## devices: Place / Rotate / Cancel / Menu buttons (and a hammer button if the HUD has none).

const CATEGORIES := [
	["structure", "Cabin"],
	["shelter", "Shelter"],
	["fire", "Fire"],
	["furniture", "Furniture"],
	["utility", "Camp"],
]

var mode: BuildMode = null
var picker_open := false

## Everything lives under one root scaled like the other screens (UITheme.fit_root): readable on a phone.
var _root: Control
var _margin: MarginContainer
var _scroll: ScrollContainer
var _touch_box: VBoxContainer

var _picker: Control
var _tabs: HBoxContainer
var _grid: GridContainer
var _detail: Label
var _category := "structure"
var _hint: PanelContainer
var _hint_title: Label
var _hint_cost: RichTextLabel
var _hint_keys: Label
var _reason: Label
var _touch: Control
var _hammer_btn: Button
var _selected: StringName = &""
var _first_card: Button = null
var _pad := false


func _ready() -> void:
	layer = 30
	process_mode = Node.PROCESS_MODE_ALWAYS
	_root = Control.new()
	_root.name = "Root"
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_build_picker()
	_build_hint()
	_build_touch()
	get_viewport().size_changed.connect(_layout)
	Events.settings_changed.connect(_layout)
	_layout()


func _layout() -> void:
	UITheme.fit_root(_root, 1180.0, 620.0)
	# short (phone) canvases: tighter margins and a shorter card list so the picker never overflows
	var short := _root.size.y < 760.0
	_margin.add_theme_constant_override("margin_top", 24 if short else 70)
	_margin.add_theme_constant_override("margin_bottom", 24 if short else 90)
	_scroll.custom_minimum_size.y = clampf(_root.size.y - (48.0 if short else 160.0) - 230.0, 160.0, 420.0)


# ---------------------------------------------------------------------------------------------- picker

func _build_picker() -> void:
	_picker = Control.new()
	_picker.set_anchors_preset(Control.PRESET_FULL_RECT)
	_picker.visible = false
	_root.add_child(_picker)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.35)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_picker.add_child(dim)
	var margin := MarginContainer.new()
	_margin = margin
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 60)
	margin.add_theme_constant_override("margin_top", 70)
	margin.add_theme_constant_override("margin_bottom", 90)
	_picker.add_child(margin)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override(&"panel", InvStyle.panel(InvStyle.BG, 8, InvStyle.LINE, 1, 20))
	panel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	panel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	panel.custom_minimum_size = Vector2(980, 0)
	margin.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override(&"separation", 14)
	panel.add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	var title := Label.new()
	title.text = "BUILD"
	title.add_theme_font_override(&"font", InvStyle.caps_font("SemiBold", 3))
	title.add_theme_font_size_override(&"font_size", 22)
	title.add_theme_color_override(&"font_color", InvStyle.TEXT)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var close := Button.new()
	close.text = "Close"
	InvStyle.style_button(close, "ghost", 16)
	close.pressed.connect(close_picker)
	head.add_child(close)
	_tabs = HBoxContainer.new()
	_tabs.add_theme_constant_override(&"separation", 6)
	v.add_child(_tabs)
	for c in CATEGORIES:
		var b := Button.new()
		b.text = String(c[1])
		b.toggle_mode = true
		InvStyle.style_button(b, "tab", 17)
		b.pressed.connect(_set_category.bind(String(c[0])))
		b.set_meta(&"cat", String(c[0]))
		_tabs.add_child(b)
	var scroll := ScrollContainer.new()
	_scroll = scroll
	scroll.custom_minimum_size = Vector2(0, 420)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(scroll)
	_grid = GridContainer.new()
	_grid.columns = 5
	_grid.add_theme_constant_override(&"h_separation", 10)
	_grid.add_theme_constant_override(&"v_separation", 10)
	_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_grid)
	_detail = Label.new()
	_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_detail.custom_minimum_size = Vector2(0, 46)
	_detail.add_theme_font_override(&"font", InvStyle.font("Regular"))
	_detail.add_theme_font_size_override(&"font_size", 16)
	_detail.add_theme_color_override(&"font_color", InvStyle.TEXT_DIM)
	v.add_child(_detail)


func open_picker() -> void:
	if picker_open:
		close_picker()
		return
	picker_open = true
	_picker.visible = true
	Events.ui_screen_opened.emit(&"build_menu")
	Audio.play_ui(&"inventory_open")
	var cat := _category
	if _selected != &"":
		cat = String(ItemDB.get_buildable(_selected).get("category", cat))
	_set_category(cat)


func close_picker() -> void:
	if not picker_open:
		return
	picker_open = false
	_picker.visible = false
	Events.ui_screen_closed.emit(&"build_menu")
	Audio.play_ui(&"inventory_close")


func _set_category(cat: String) -> void:
	_category = cat
	for b in _tabs.get_children():
		(b as Button).button_pressed = String(b.get_meta(&"cat")) == cat
	for c in _grid.get_children():
		c.queue_free()
	_first_card = null
	var inv := ItemActions.inventory_of(mode.player) if mode and mode.player else null
	var n := 0
	for id in BuildMode.available_buildables():
		if String(ItemDB.get_buildable(id).get("category", "structure")) != cat:
			continue
		var card := _make_card(id, inv)
		_grid.add_child(card)
		if _first_card == null or id == _selected:
			_first_card = card
		n += 1
	if n == 0:
		var l := Label.new()
		l.text = "No blueprints in this category yet."
		l.add_theme_color_override(&"font_color", InvStyle.TEXT_FAINT)
		_grid.add_child(l)
	if _first_card:
		_first_card.grab_focus.call_deferred()


func _make_card(id: StringName, inv: Inventory) -> Button:
	var b := Button.new()
	b.custom_minimum_size = Vector2(178, 150)
	InvStyle.style_button(b, "card", 15)
	b.clip_text = true
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 8
	v.offset_right = -8
	v.offset_top = 8
	v.offset_bottom = -6
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	b.add_child(v)
	var icon := TextureRect.new()
	icon.texture = ItemDB.get_icon(id)
	icon.custom_minimum_size = Vector2(0, 72)
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(icon)
	var title := Label.new()
	title.text = BuildCatalog.display_name(id)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_override(&"font", InvStyle.font("Medium"))
	title.add_theme_font_size_override(&"font_size", 15)
	title.add_theme_color_override(&"font_color", InvStyle.TEXT)
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(title)
	var cost := RichTextLabel.new()
	cost.bbcode_enabled = true
	cost.fit_content = true
	cost.scroll_active = false
	cost.autowrap_mode = TextServer.AUTOWRAP_OFF
	cost.add_theme_font_override(&"normal_font", InvStyle.font("Regular"))
	cost.add_theme_font_size_override(&"normal_font_size", 13)
	cost.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cost.text = "[center]%s[/center]" % cost_bbcode(id, inv)
	v.add_child(cost)
	if BuildCatalog.needs_hammer(id) and mode and not mode._has_hammer():
		b.modulate = Color(1, 1, 1, 0.55)
	b.pressed.connect(_pick.bind(id))
	b.focus_entered.connect(_show_detail.bind(id))
	b.mouse_entered.connect(_show_detail.bind(id))
	return b


static func cost_bbcode(id: StringName, inv: Inventory) -> String:
	var parts: PackedStringArray = []
	var cost := BuildCatalog.cost_of(id)
	for k in cost:
		var have := inv.count(k) if inv else 0
		var need := int(cost[k])
		var col := InvStyle.GOOD if have >= need else InvStyle.BAD
		parts.append("[color=#%s]%d %s[/color]" % [col.to_html(false), need, ItemInfo.name_of(k)])
	return "  ".join(parts)


func _show_detail(id: StringName) -> void:
	var note := ""
	if BuildCatalog.needs_hammer(id) and mode and not mode._has_hammer():
		note = "  Needs a hammer."
	_detail.text = "%s — %s%s" % [BuildCatalog.display_name(id), String(ItemDB.get_buildable(id).get("desc", "")), note]


func _pick(id: StringName) -> void:
	Audio.play_ui(&"ui_click")
	close_picker()
	if mode:
		mode.select(id)


func set_selected(id: StringName) -> void:
	_selected = id
	_hint.visible = id != &""
	if _touch:
		_touch.visible = id != &"" and InputGlyphs.current() == InputGlyphs.TOUCH
	if id != &"":
		_hint_title.text = BuildCatalog.display_name(id)


func _input(event: InputEvent) -> void:
	# remember the last device for the control hints
	if event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf((event as InputEventJoypadMotion).axis_value) > 0.4):
		_pad = true
	elif event is InputEventKey or event is InputEventMouseButton or event is InputEventScreenTouch:
		_pad = false


func _unhandled_input(event: InputEvent) -> void:
	if not picker_open:
		return
	if event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"build") or event.is_action_pressed(&"pause"):
		get_viewport().set_input_as_handled()
		close_picker()
	elif event.is_action_pressed(&"hotbar_next") or event.is_action_pressed(&"hotbar_prev"):
		get_viewport().set_input_as_handled()
		var i := 0
		for k in CATEGORIES.size():
			if String(CATEGORIES[k][0]) == _category:
				i = k
		i = posmod(i + (1 if event.is_action_pressed(&"hotbar_next") else -1), CATEGORIES.size())
		_set_category(String(CATEGORIES[i][0]))


# ---------------------------------------------------------------------------------------------- hint

func _build_hint() -> void:
	_hint = PanelContainer.new()
	_hint.add_theme_stylebox_override(&"panel", InvStyle.panel(InvStyle.BG_SOFT, 6, InvStyle.LINE, 1, 12))
	_hint.anchor_left = 0.5
	_hint.anchor_right = 0.5
	_hint.anchor_top = 1.0
	_hint.anchor_bottom = 1.0
	_hint.offset_left = -300
	_hint.offset_right = 300
	_hint.offset_top = -150
	_hint.offset_bottom = -64
	_hint.visible = false
	_hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_hint)
	var v := VBoxContainer.new()
	v.add_theme_constant_override(&"separation", 4)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hint.add_child(v)
	_hint_title = Label.new()
	_hint_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint_title.add_theme_font_override(&"font", InvStyle.font("SemiBold"))
	_hint_title.add_theme_font_size_override(&"font_size", 19)
	_hint_title.add_theme_color_override(&"font_color", InvStyle.TEXT)
	v.add_child(_hint_title)
	_hint_cost = RichTextLabel.new()
	_hint_cost.bbcode_enabled = true
	_hint_cost.fit_content = true
	_hint_cost.scroll_active = false
	_hint_cost.add_theme_font_override(&"normal_font", InvStyle.font("Regular"))
	_hint_cost.add_theme_font_size_override(&"normal_font_size", 15)
	_hint_cost.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(_hint_cost)
	_hint_keys = Label.new()
	_hint_keys.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint_keys.add_theme_font_override(&"font", InvStyle.font("Regular"))
	_hint_keys.add_theme_font_size_override(&"font_size", 14)
	_hint_keys.add_theme_color_override(&"font_color", InvStyle.TEXT_DIM)
	v.add_child(_hint_keys)
	_reason = Label.new()
	_reason.anchor_left = 0.5
	_reason.anchor_right = 0.5
	_reason.anchor_top = 0.5
	_reason.anchor_bottom = 0.5
	_reason.offset_left = -240
	_reason.offset_right = 240
	_reason.offset_top = 36
	_reason.offset_bottom = 64
	_reason.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_reason.add_theme_font_override(&"font", InvStyle.font("Medium"))
	_reason.add_theme_font_size_override(&"font_size", 17)
	_reason.add_theme_color_override(&"font_color", InvStyle.BAD)
	_reason.add_theme_color_override(&"font_outline_color", Color(0, 0, 0, 0.7))
	_reason.add_theme_constant_override(&"outline_size", 4)
	_reason.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_reason)


func update_hint(p: Dictionary) -> void:
	if not _hint.visible:
		_reason.text = ""
		return
	var inv := ItemActions.inventory_of(mode.player) if mode and mode.player else null
	var id: StringName = p.get("id", _selected)
	var extra := ""
	if id == &"log_roof" and p.has("props"):
		var pr: Dictionary = p["props"]
		extra = "  ·  %s, tier %d" % ["ridge" if String(pr.get("shape", "slope")) == "peak" else "slope", int(pr.get("tier", 0)) + 1]
	_hint_title.text = BuildCatalog.display_name(id) + extra
	_hint_cost.text = "[center]%s[/center]" % cost_bbcode(id, inv)
	_hint_keys.text = _keys_text()
	_reason.text = "" if bool(p.get("valid", false)) else String(p.get("reason", ""))


func _keys_text() -> String:
	if _pad:
		return "RT place   LB/RB rotate   LT exit   D-pad up menu"
	if InputGlyphs.current() == InputGlyphs.TOUCH:
		return "Place a blueprint, then fill it with materials"
	return "LMB place   Q/R or wheel rotate   RMB exit   B menu"


# ---------------------------------------------------------------------------------------------- touch

func _build_touch() -> void:
	_touch = Control.new()
	_touch.set_anchors_preset(Control.PRESET_FULL_RECT)
	_touch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_touch.visible = false
	_root.add_child(_touch)
	# Rotate ⟲ ⟳ / Place / Menu Exit — a compact block that fits the pocket left of the touch controls' aim
	# button and above their crouch button (see _place_touch_box), so it never covers the thumb cluster.
	_touch_box = VBoxContainer.new()
	_touch_box.add_theme_constant_override(&"separation", 8)
	_touch.add_child(_touch_box)
	var rows: Array = [
		[["⟲", "secondary", func() -> void: mode.rotate_by(-1)], ["⟳", "secondary", func() -> void: mode.rotate_by(1)]],
		[["Place", "primary", func() -> void: mode.place()]],
		[["Menu", "secondary", func() -> void: mode.open_picker()], ["Exit", "secondary", func() -> void: mode.exit()]],
	]
	for row in rows:
		var h := HBoxContainer.new()
		h.add_theme_constant_override(&"separation", 8)
		_touch_box.add_child(h)
		for spec in row:
			var b := Button.new()
			b.text = String(spec[0])
			b.name = String(spec[0]) if String(spec[0]).is_valid_identifier() else ("RotateLeft" if spec[0] == "⟲" else "RotateRight")
			InvStyle.style_button(b, String(spec[1]), 26 if String(spec[0]).length() == 1 else 19)
			b.custom_minimum_size = Vector2(76.0 if row.size() > 1 else 160.0, 60.0)
			b.focus_mode = Control.FOCUS_NONE
			b.pressed.connect(spec[2])
			h.add_child(b)
	# A hammer button while not building, unless the HUD's touch controls provide one.
	_hammer_btn = Button.new()
	_hammer_btn.text = "Build"
	InvStyle.style_button(_hammer_btn, "secondary", 18)
	_hammer_btn.anchor_left = 1.0
	_hammer_btn.anchor_right = 1.0
	_hammer_btn.offset_left = -130
	_hammer_btn.offset_right = -20
	_hammer_btn.offset_top = 150
	_hammer_btn.offset_bottom = 206
	_hammer_btn.pressed.connect(func() -> void: mode.open_picker())
	_hammer_btn.visible = false
	_root.add_child(_hammer_btn)


## Canvas point → _root units.
func _to_root(p: Vector2) -> Vector2:
	return _root.get_global_transform_with_canvas().affine_inverse() * p


## Puts the touch block in the free pocket of the TouchControls thumb cluster (left of aim, above crouch);
## without touch controls it sits at the right edge, vertically centred.
func _place_touch_box() -> void:
	var sz := _touch_box.get_combined_minimum_size()
	_touch_box.size = sz
	var pos := Vector2(_root.size.x - sz.x - 24.0, (_root.size.y - sz.y) * 0.5)
	var tc := get_tree().get_first_node_in_group(&"touch_controls") as TouchControls
	if tc and tc.active and tc.root:
		var xf := tc.root.get_global_transform_with_canvas()
		var k := xf.x.length() / maxf(0.001, _root.get_global_transform_with_canvas().x.length())
		var aim := _to_root(xf * tc.button_center(&"aim"))
		var crouch := _to_root(xf * tc.button_center(&"crouch"))
		var right := aim.x - tc.button_radius(&"aim") * k - 14.0
		var bottom := crouch.y - tc.button_radius(&"crouch") * k - 14.0
		pos = Vector2(right - sz.x, bottom - sz.y)
		pos.y = maxf(pos.y, 110.0)
	_touch_box.position = pos


## The placement hint sits above the HUD hotbar when that is always shown (touch layout).
func _place_hint() -> void:
	var bottom := _root.size.y - 64.0
	var hud := HUD.find()
	if hud and hud.hotbar and hud.hotbar.always_visible and hud.hotbar.is_visible_in_tree():
		bottom = minf(bottom, _to_root(hud.hotbar.get_global_rect().position).y - 10.0)
	_hint.offset_bottom = bottom - _root.size.y
	_hint.offset_top = _hint.offset_bottom - maxf(86.0, _hint.get_combined_minimum_size().y)


func _process(_delta: float) -> void:
	# a pad picked up on the phone hides the touch block (and brings it back on the next touch)
	if _touch:
		_touch.visible = _selected != &"" and InputGlyphs.current() == InputGlyphs.TOUCH
	if _touch and _touch.visible:
		_place_touch_box()
	if _hint and _hint.visible:
		_place_hint()
	if _hammer_btn:
		var want := InputGlyphs.current() == InputGlyphs.TOUCH and not picker_open and _selected == &"" and Game.is_playing() \
			and get_tree().get_first_node_in_group(&"touch_controls") == null
		_hammer_btn.visible = want

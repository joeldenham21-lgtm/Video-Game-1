class_name SettingsPanel
extends Control
## Settings screen (main menu and pause menu). Covers every Settings key of CONTRACT §3, grouped Graphics /
## Display / Controls / Audio / Accessibility / Gameplay, with a quality-preset selector ("Custom" once a
## value differs), live apply (debounced for sliders), restore defaults, and Settings.save() on close.
## A description pane explains the focused/hovered option. Fully navigable with pad/keyboard: up/down moves
## between options, left/right changes the value, LB/RB (Q/R) switches tabs, B/Esc goes back.
## Extra keys stored in Settings.values (persisted by Settings.save): window_mode, screen_fx.

signal closed()

const TABS := ["Graphics", "Display", "Controls", "Audio", "Accessibility", "Gameplay"]
const PRESET_NAMES := {&"mobile_low": "Phone — Low", &"mobile_high": "Phone — High", &"low": "Low",
	&"medium": "Medium", &"high": "High", &"ultra": "Ultra"}
const DIFFICULTY_TEXT := {
	&"explorer": ["Explorer", "No hunger or thirst, gentler cold. For taking in the mountains."],
	&"survivor": ["Survivor", "The intended experience. Cold, hunger and altitude will test you."],
	&"whiteout": ["Whiteout", "Harsh cold and faster drain. Saving only at a bed."],
}

## [key, label, kind, spec, description]. kind: "slider" spec [min, max, step, fmt]; "toggle";
## "choice" spec [[value, label], …]; "preset"; "bindings".
var SPECS := {
	"Graphics": [
		[&"preset", "Quality preset", "preset", [], "Sets every graphics option at once. Changing any option below switches to Custom."],
		[&"render_scale", "Render scale", "slider", [0.4, 1.0, 0.05, "pct"], "Resolution of the 3D view relative to the screen. Lower is faster; the upscaler restores sharpness."],
		[&"upscaler", "Upscaler", "choice", [[&"bilinear", "Bilinear"], [&"fsr", "AMD FSR 1"], [&"fsr2", "AMD FSR 2"]], "How the 3D view is scaled to the screen when render scale is below 100 %. FSR needs the Forward+ renderer (desktop)."],
		[&"msaa", "Multisample AA", "choice", [[0, "Off"], [2, "2×"], [4, "4×"]], "Smooths geometry edges. Cheap on phones (tile GPUs), costly on desktop."],
		[&"taa", "Temporal AA", "toggle", [], "Smooth, stable edges and foliage on desktop. Slight softness in motion."],
		[&"fxaa", "FXAA", "toggle", [], "Very cheap edge smoothing. Softens the image a little."],
		[&"shadow_quality", "Shadow quality", "choice", [[0, "Low"], [1, "Medium"], [2, "High"], [3, "Ultra"]], "Shadow map resolution and filtering."],
		[&"shadow_distance", "Shadow distance", "slider", [50.0, 500.0, 10.0, "m"], "How far from you the sun casts shadows."],
		[&"view_distance", "View distance", "slider", [1000.0, 6000.0, 100.0, "m"], "How far the camera sees. Distant ranges beyond use cheap impostors."],
		[&"lod_bias", "Mesh LOD bias", "slider", [0.5, 2.5, 0.05, "x"], "Higher values switch to simpler meshes sooner. Lower is sharper and slower."],
		[&"vegetation_density", "Vegetation density", "slider", [0.2, 1.0, 0.05, "pct"], "Density of trees, shrubs and grass."],
		[&"grass_distance", "Grass distance", "slider", [10.0, 100.0, 1.0, "m"], "How far grass and small plants are drawn."],
		[&"tree_impostor_distance", "Tree detail distance", "slider", [30.0, 300.0, 5.0, "m"], "Beyond this distance trees are drawn as impostors."],
		[&"volumetric_fog", "Volumetric fog", "toggle", [], "Light shafts and depth in fog and snowfall. Desktop only."],
		[&"ssao", "Ambient occlusion", "toggle", [], "Contact shadows in creases and under objects (SSAO)."],
		[&"ssil", "Indirect lighting", "toggle", [], "Screen-space bounced light (SSIL). Ultra."],
		[&"ssr", "Reflections", "toggle", [], "Screen-space reflections on water and ice."],
		[&"glow", "Glow", "toggle", [], "Bloom around bright light: the sun, fire, snow glare."],
		[&"sky_quality", "Sky quality", "choice", [[0, "Low"], [1, "Medium"], [2, "High"]], "Cloud and atmosphere detail."],
		[&"particles", "Particles", "choice", [[0, "Low"], [1, "Medium"], [2, "High"]], "Snowfall, smoke, embers and breath."],
	],
	"Display": [
		[&"window_mode", "Window mode", "choice", [[&"windowed", "Windowed"], [&"fullscreen", "Fullscreen"], [&"exclusive", "Exclusive fullscreen"]], "Exclusive fullscreen can lower latency on some systems."],
		[&"vsync", "V-Sync", "toggle", [], "Prevents tearing. Always on for phones."],
		[&"max_fps", "Frame rate limit", "choice", [[0, "Unlimited"], [30, "30"], [60, "60"], [90, "90"], [120, "120"], [144, "144"]], "Caps the frame rate to save power and heat."],
		[&"dynamic_resolution", "Dynamic resolution", "toggle", [], "Lowers the render scale on heavy scenes to hold the target frame rate."],
		[&"target_fps", "Target frame rate", "choice", [[30, "30"], [45, "45"], [60, "60"], [90, "90"], [120, "120"]], "The frame rate dynamic resolution aims for."],
		[&"fov", "Field of view", "slider", [60.0, 100.0, 1.0, "deg"], "Vertical field of view. Wider shows more; narrower feels closer."],
		[&"show_fps", "Show frame rate", "toggle", [], "Frame rate counter in the corner."],
	],
	"Controls": [
		[&"mouse_sensitivity", "Mouse sensitivity", "slider", [0.02, 0.5, 0.01, "f2"], "Look speed with a mouse."],
		[&"look_sensitivity_pad", "Controller look speed", "slider", [0.5, 6.0, 0.1, "f1"], "Look speed with a gamepad stick."],
		[&"look_sensitivity_touch", "Touch look speed", "slider", [0.05, 0.6, 0.01, "f2"], "Look speed when dragging on the right side of the screen."],
		[&"invert_y", "Invert look", "toggle", [], "Push up to look down."],
		[&"bindings", "Controls", "bindings", [], "Keyboard, mouse and controller layout."],
	],
	"Audio": [
		[&"vol_master", "Master volume", "slider", [0.0, 1.0, 0.05, "pct"], "Overall volume."],
		[&"vol_music", "Music", "slider", [0.0, 1.0, 0.05, "pct"], "The score."],
		[&"vol_sfx", "Effects", "slider", [0.0, 1.0, 0.05, "pct"], "Footsteps, tools, wildlife, fire."],
		[&"vol_ambience", "Ambience", "slider", [0.0, 1.0, 0.05, "pct"], "Wind, water, forest."],
		[&"vol_voice", "Voices", "slider", [0.0, 1.0, 0.05, "pct"], "Radio transmissions and recorded logs."],
	],
	"Accessibility": [
		[&"subtitles", "Subtitles", "toggle", [], "Text for radio transmissions and recorded logs."],
		[&"touch_ui_scale", "Interface scale", "slider", [0.7, 1.4, 0.05, "pct"], "Size of the HUD, menus and touch controls."],
		[&"head_bob", "Head bob", "slider", [0.0, 1.0, 0.05, "pct"], "Camera motion while walking. Lower it if you feel motion sick."],
		[&"screen_fx", "Screen effects", "slider", [0.0, 1.0, 0.05, "pct"], "Strength of frost, hypoxia, wet and injury effects on the screen."],
	],
	"Gameplay": [
		[&"difficulty", "Difficulty", "choice", [[&"explorer", "Explorer"], [&"survivor", "Survivor"], [&"whiteout", "Whiteout"]], ""],
		[&"language", "Language", "choice", [[&"en", "English"]], "Text and subtitle language."],
	],
}
const EXTRA_DEFAULTS := {&"window_mode": &"windowed", &"screen_fx": 1.0}
const BINDINGS := [["Move", [&"move_forward", &"move_left", &"move_back", &"move_right"]], ["Sprint", [&"sprint"]],
	["Crouch", [&"crouch"]], ["Jump", [&"jump"]], ["Use / attack", [&"use"]], ["Aim / block", [&"aim"]],
	["Interact (hold for timed)", [&"interact"]], ["Inventory & crafting", [&"inventory"]], ["Build", [&"build"]],
	["Journal", [&"journal"]], ["Map", [&"map"]], ["Torch", [&"torch_toggle"]], ["Drop", [&"drop"]],
	["Hotbar next / previous", [&"hotbar_next", &"hotbar_prev"]], ["Photo mode", [&"photo_mode"]], ["Pause", [&"pause"]]]

var in_game := false
var tab := 0
var controls := {}                # key -> Control (the interactive widget)
var _rows := {}                   # key -> row Control
var _tab_buttons: Array[Button] = []
var _underline: ColorRect
var _pages: Array[Control] = []
var _scroll: ScrollContainer
var _desc_title: Label
var _desc_body: Label
var _desc_note: Label
var _apply_timer := -1.0
var _save_timer := -1.0
var _refreshing := false
var _root: Control
var _hint: HBoxContainer


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	process_mode = Node.PROCESS_MODE_ALWAYS
	for k in EXTRA_DEFAULTS:
		if not Settings.values.has(k):
			Settings.values[k] = EXTRA_DEFAULTS[k]
	_build()
	UISounds.wire(self)
	refresh()
	_set_tab(0)
	Events.settings_changed.connect(_on_settings_changed)
	get_viewport().size_changed.connect(_layout)
	_layout()


func _exit_tree() -> void:
	if _apply_timer >= 0.0:
		Settings.apply()
	Settings.save()


# ============================================================================================= build

func _build() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.02, 0.025, 0.03, 0.7)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	_root = Control.new()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	var m := UITheme.margin(0)
	m.name = "Margin"
	m.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(m)
	var col := UITheme.vbox(0)
	m.add_child(col)
	# header
	var head := UITheme.hbox(28)
	head.custom_minimum_size.y = 64
	col.add_child(head)
	var title := UITheme.caps("Settings", 17, UITheme.TEXT, 4)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(title)
	var tabs_box := Control.new()
	tabs_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tabs_box.custom_minimum_size.y = 64
	head.add_child(tabs_box)
	var tabs := UITheme.hbox(4)
	tabs.position = Vector2(0, 10)
	tabs_box.add_child(tabs)
	for i in TABS.size():
		var tb := UITheme.button(TABS[i], "TabButton")
		tb.focus_mode = Control.FOCUS_NONE
		tb.pressed.connect(_set_tab.bind(i, true))
		tabs.add_child(tb)
		_tab_buttons.append(tb)
	_underline = ColorRect.new()
	_underline.color = UITheme.ACCENT
	_underline.size = Vector2(40, 2)
	tabs_box.add_child(_underline)
	col.add_child(UITheme.hline(UITheme.LINE_STRONG))
	# body
	var body := UITheme.hbox(32)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	_scroll = ScrollContainer.new()
	_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.size_flags_stretch_ratio = 1.9
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.follow_focus = true
	body.add_child(_scroll)
	var pages := UITheme.vbox(0)
	pages.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(pages)
	for t in TABS:
		var page := UITheme.vbox(2)
		page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var pm := UITheme.margin(0)
		pm.add_theme_constant_override("margin_top", 18)
		pm.add_theme_constant_override("margin_right", 18)
		pm.add_theme_constant_override("margin_bottom", 18)
		pm.add_child(page)
		pages.add_child(pm)
		_pages.append(pm)
		for spec in SPECS[t]:
			var row := _make_row(spec)
			if row:
				page.add_child(row)
	# description pane
	var desc := PanelContainer.new()
	desc.theme_type_variation = &"CardPanel"
	desc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	desc.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var dm := UITheme.margin(0)
	dm.add_theme_constant_override("margin_top", 18)
	var dwrap := UITheme.vbox(0)
	dwrap.add_child(dm)
	dm.add_child(desc)
	dwrap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(dwrap)
	var dv := UITheme.vbox(10)
	desc.add_child(dv)
	_desc_title = UITheme.label("", UITheme.FS_H3, UITheme.TEXT, "Medium")
	dv.add_child(_desc_title)
	_desc_body = UITheme.label("", UITheme.FS_BODY, UITheme.TEXT_DIM)
	_desc_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_desc_body.custom_minimum_size.x = 300
	dv.add_child(_desc_body)
	_desc_note = UITheme.label("", UITheme.FS_SMALL, UITheme.ACCENT)
	_desc_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	dv.add_child(_desc_note)
	# footer
	col.add_child(UITheme.hline(UITheme.LINE_STRONG))
	var foot := UITheme.hbox(14)
	foot.custom_minimum_size.y = 76
	col.add_child(foot)
	var restore := UITheme.button("Restore defaults", "", "back")
	restore.icon = null
	restore.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	restore.pressed.connect(_ask_restore)
	restore.name = "Restore"
	foot.add_child(restore)
	_hint = UITheme.hbox(18)
	_hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_hint.alignment = BoxContainer.ALIGNMENT_END
	_hint.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	foot.add_child(_hint)
	var back := UITheme.button("Back", "PrimaryButton")
	back.custom_minimum_size = Vector2(150, 50)
	back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	back.set_meta(&"back_sound", true)
	back.pressed.connect(close)
	back.name = "Back"
	foot.add_child(back)
	_build_hints()
	InputGlyphs.bus().device_changed.connect(func(_d: StringName) -> void: _build_hints())


func _build_hints() -> void:
	for c in _hint.get_children():
		c.queue_free()
	if InputGlyphs.current() == InputGlyphs.TOUCH:
		return
	var pad := InputGlyphs.current() == InputGlyphs.PAD
	for pair in [[&"hotbar_prev" if pad else &"rotate_left", &"hotbar_next" if pad else &"rotate_right", "Tabs"], [&"ui_cancel", &"", "Back"]]:
		for a in [pair[0], pair[1]]:
			if a == &"":
				continue
			var g := GlyphIcon.new()
			g.action = a
			g.glyph_height = 26
			g.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			_hint.add_child(g)
		var l := UITheme.label(pair[2], UITheme.FS_SMALL, UITheme.TEXT_DIM)
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_hint.add_child(l)


func _layout() -> void:
	UITheme.fit_root(_root, 1100.0, 600.0)
	var m: MarginContainer = _root.get_node("Margin")
	var mh := clampf(_root.size.x * 0.06, 32.0, 120.0)
	m.add_theme_constant_override("margin_left", int(mh))
	m.add_theme_constant_override("margin_right", int(mh))
	m.add_theme_constant_override("margin_top", 24)
	m.add_theme_constant_override("margin_bottom", 8)
	_place_underline.call_deferred()


func _make_row(spec: Array) -> Control:
	var key: StringName = spec[0]
	var kind: String = spec[2]
	if kind == "bindings":
		return _bindings_block()
	var row := PanelContainer.new()
	row.name = String(key)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 1, 1, 0.0)
	sb.set_corner_radius_all(4)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	row.add_theme_stylebox_override("panel", sb)
	row.custom_minimum_size.y = 58
	var h := UITheme.hbox(16)
	row.add_child(h)
	var lab := UITheme.label(String(spec[1]), UITheme.FS_BODY, UITheme.TEXT)
	lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lab.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(lab)
	var ctl: Control = null
	match kind:
		"slider":
			var box := UITheme.hbox(14)
			box.custom_minimum_size.x = 360
			var sl := HSlider.new()
			sl.min_value = spec[3][0]
			sl.max_value = spec[3][1]
			sl.step = spec[3][2]
			sl.custom_minimum_size = Vector2(250, 32)
			sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			sl.focus_mode = Control.FOCUS_ALL
			var val := UITheme.label("", UITheme.FS_BODY, UITheme.TEXT, "Medium")
			val.add_theme_font_override("font", UITheme.mono_font())
			val.custom_minimum_size.x = 92
			val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			val.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			box.add_child(sl)
			box.add_child(val)
			h.add_child(box)
			sl.value_changed.connect(func(v: float) -> void:
				val.text = _fmt(v, String(spec[3][3]))
				if not _refreshing:
					_set_setting(key, v, true))
			sl.set_meta(&"value_label", val)
			sl.set_meta(&"fmt", String(spec[3][3]))
			ctl = sl
		"toggle":
			var cb := CheckButton.new()
			cb.focus_mode = Control.FOCUS_ALL
			cb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			cb.toggled.connect(func(on: bool) -> void:
				if not _refreshing:
					_set_setting(key, on, false))
			h.add_child(cb)
			ctl = cb
		"choice", "preset":
			var sel := ChoiceSelector.new()
			if kind == "preset":
				var opts: Array = []
				for p in Settings.PRESET_ORDER:
					opts.append([p, PRESET_NAMES[p]])
				sel.options = opts
			else:
				sel.options = spec[3]
			sel.custom_minimum_size.x = 360
			sel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			sel.changed.connect(func(v: Variant) -> void:
				if _refreshing:
					return
				if kind == "preset":
					Settings.apply_preset(StringName(v))
					refresh()
				else:
					_set_setting(key, v, false))
			h.add_child(sel)
			ctl = sel
	controls[key] = ctl
	_rows[key] = row
	ctl.focus_entered.connect(_on_row_focus.bind(key, spec, row, true))
	ctl.focus_exited.connect(_on_row_focus.bind(key, spec, row, false))
	row.mouse_entered.connect(func() -> void: _describe(key, spec))
	return row


func _bindings_block() -> Control:
	var v := UITheme.vbox(2)
	var sp := Control.new()
	sp.custom_minimum_size.y = 14
	v.add_child(sp)
	var head := UITheme.hbox(10)
	head.add_child(UITheme.caps("Controls", 14, UITheme.TEXT_DIM, 3))
	v.add_child(head)
	v.add_child(UITheme.hline())
	for b in BINDINGS:
		var h := UITheme.hbox(10)
		h.custom_minimum_size.y = 40
		var l := UITheme.label(String(b[0]), UITheme.FS_SMALL, UITheme.TEXT_DIM)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(l)
		for dev in [InputGlyphs.KEYBOARD, InputGlyphs.PAD]:
			var cell := UITheme.hbox(4)
			cell.custom_minimum_size.x = 170 if dev == InputGlyphs.KEYBOARD else 90
			for a in b[1]:
				if dev == InputGlyphs.PAD and b[1].size() == 4:
					var lab := UITheme.label("Left stick", UITheme.FS_SMALL, UITheme.TEXT)
					cell.add_child(lab)
					break
				var g := GlyphIcon.new()
				g.force_device = dev
				g.action = a
				g.glyph_height = 26
				g.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				cell.add_child(g)
			h.add_child(cell)
		v.add_child(h)
	return v


# ============================================================================================= values

func refresh() -> void:
	_refreshing = true
	for key in controls:
		var c: Control = controls[key]
		if key == &"preset":
			(c as ChoiceSelector).set_value(Settings.preset)
			(c as ChoiceSelector).override_text = "" if _preset_matches() else "Custom"
			continue
		var v: Variant = Settings.get_value(key, EXTRA_DEFAULTS.get(key, null))
		if c is HSlider:
			(c as HSlider).value = float(v)
			var vl: Label = c.get_meta(&"value_label")
			vl.text = _fmt(float(v), String(c.get_meta(&"fmt")))
		elif c is CheckButton:
			(c as CheckButton).set_pressed_no_signal(bool(v))
		elif c is ChoiceSelector:
			(c as ChoiceSelector).set_value(v)
	# context locks
	var mob := Settings.is_mobile()
	_lock(&"difficulty", in_game, "Difficulty is chosen when starting a new game.")
	_lock(&"vsync", mob, "Always on for phones.")
	_lock(&"window_mode", mob, "Not available on phones.")
	_lock(&"upscaler", not Settings.is_forward_plus(), "FSR needs the Forward+ renderer; this device upscales bilinearly.")
	_lock(&"volumetric_fog", not Settings.is_forward_plus(), "Needs the Forward+ renderer.")
	_lock(&"ssil", not Settings.is_forward_plus(), "Needs the Forward+ renderer.")
	_refreshing = false


func _lock(key: StringName, locked: bool, _why: String) -> void:
	var c: Control = controls.get(key)
	if c == null:
		return
	if c is BaseButton:
		(c as BaseButton).disabled = locked
	elif c is ChoiceSelector:
		(c as ChoiceSelector).disabled = locked
	elif c is Range:
		(c as Range).editable = not locked
	var row: Control = _rows.get(key)
	if row:
		row.modulate.a = 0.5 if locked else 1.0
	c.set_meta(&"lock_note", _why if locked else "")


func _preset_matches() -> bool:
	var d: Dictionary = Settings.PRESETS.get(Settings.preset, {})
	for k in d:
		var a: Variant = Settings.get_value(k)
		var b: Variant = d[k]
		if (a is float or b is float) and (a is float or a is int) and (b is float or b is int):
			if absf(float(a) - float(b)) > 0.001:
				return false
		elif str(a) != str(b):
			return false
	return true


func _set_setting(key: StringName, v: Variant, debounce: bool) -> void:
	# keep integer keys integers
	if Settings.PRESETS[&"high"].has(key) and Settings.PRESETS[&"high"][key] is int:
		v = int(v)
	elif Settings.COMMON.has(key) and Settings.COMMON[key] is StringName:
		v = StringName(v)
	Settings.set_value(key, v, false)
	if key == &"window_mode":
		apply_window_mode()
	if debounce:
		_apply_timer = 0.15
	else:
		_apply_timer = -1.0
		Settings.apply()
	_save_timer = 1.5
	var pc: ChoiceSelector = controls.get(&"preset")
	if pc:
		pc.override_text = "" if _preset_matches() else "Custom"
	if key.begins_with("vol_") and key != &"vol_music":
		Audio.play_ui(&"ui_click")


## Applies Settings.values.window_mode (extra key) to the OS window. Desktop only.
static func apply_window_mode() -> void:
	if Settings.is_mobile() or DisplayServer.get_name() == "headless":
		return
	match StringName(Settings.get_value(&"window_mode", &"windowed")):
		&"fullscreen":
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
		&"exclusive":
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN)
		_:
			if DisplayServer.window_get_mode() in [DisplayServer.WINDOW_MODE_FULLSCREEN, DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN]:
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)


func _on_settings_changed() -> void:
	if not _refreshing and is_visible_in_tree():
		refresh.call_deferred()


func _ask_restore() -> void:
	var d := ConfirmDialog.ask(self, "Restore defaults?", "Every setting returns to the recommended values for this device.", "Restore")
	d.confirmed.connect(restore_defaults)


func restore_defaults() -> void:
	var diff: Variant = Settings.get_value(&"difficulty", &"survivor")
	for k in Settings.COMMON:
		Settings.values[k] = Settings.COMMON[k]
	for k in EXTRA_DEFAULTS:
		Settings.values[k] = EXTRA_DEFAULTS[k]
	Settings.values[&"difficulty"] = diff
	Settings.apply_preset(Settings.auto_detect_preset())
	apply_window_mode()
	Settings.save()
	refresh()


func close() -> void:
	if _apply_timer >= 0.0:
		Settings.apply()
		_apply_timer = -1.0
	Settings.save()
	closed.emit()


# ============================================================================================= UI

func _fmt(v: float, f: String) -> String:
	match f:
		"pct": return "%d %%" % roundi(v * 100.0)
		"m": return UITheme.metres(v)
		"deg": return "%d°" % roundi(v)
		"x": return "%.2f×" % v
		"f1": return "%.1f" % v
		"f2": return "%.2f" % v
	return str(v)


func _set_tab(i: int, sfx := false) -> void:
	tab = clampi(i, 0, TABS.size() - 1)
	for k in _pages.size():
		_pages[k].visible = k == tab
	for k in _tab_buttons.size():
		_tab_buttons[k].add_theme_color_override("font_color", UITheme.TEXT if k == tab else UITheme.TEXT_DIM)
	_scroll.scroll_vertical = 0
	_place_underline.call_deferred()
	if sfx:
		Audio.play_ui(&"ui_click")
	var first := _first_control(tab)
	if first and InputGlyphs.current() != InputGlyphs.TOUCH and is_visible_in_tree():
		first.grab_focus.call_deferred()
	var spec: Array = SPECS[TABS[tab]][0]
	_describe(spec[0], spec)


func _first_control(t: int) -> Control:
	for spec in SPECS[TABS[t]]:
		var c: Control = controls.get(spec[0])
		if c and c.focus_mode != Control.FOCUS_NONE:
			return c
	return null


func focus_first() -> void:
	var c := _first_control(tab)
	if c:
		c.grab_focus()


func _place_underline() -> void:
	if _tab_buttons.is_empty():
		return
	var b := _tab_buttons[tab]
	var tw := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	var target := Vector2(b.position.x + 14.0, 10.0 + b.size.y + 2.0)
	tw.tween_property(_underline, "position", target, 0.15)
	tw.parallel().tween_property(_underline, "size:x", maxf(10.0, b.size.x - 28.0), 0.15)


func _on_row_focus(key: StringName, spec: Array, row: PanelContainer, focused: bool) -> void:
	var sb := row.get_theme_stylebox("panel") as StyleBoxFlat
	sb.bg_color = Color(1, 1, 1, 0.06) if focused else Color(1, 1, 1, 0.0)
	if focused:
		_describe(key, spec)


func _describe(key: StringName, spec: Array) -> void:
	_desc_title.text = String(spec[1])
	var body := String(spec[4])
	if key == &"difficulty":
		var d: StringName = StringName(Settings.get_value(&"difficulty", &"survivor"))
		body = String(DIFFICULTY_TEXT.get(d, ["", ""])[1])
	_desc_body.text = body
	var c: Control = controls.get(key)
	var note := String(c.get_meta(&"lock_note", "")) if c else ""
	if note == "" and Settings.PRESETS.get(Settings.preset, {}).has(key):
		var rec: Variant = Settings.PRESETS[Settings.preset][key]
		note = "Preset value: %s" % _display_value(key, spec, rec)
	_desc_note.text = note


func _display_value(_key: StringName, spec: Array, v: Variant) -> String:
	match String(spec[2]):
		"slider": return _fmt(float(v), String(spec[3][3]))
		"toggle": return "On" if bool(v) else "Off"
		"choice":
			for o in spec[3]:
				if str(o[0]) == str(v):
					return String(o[1])
	return str(v)


func _process(delta: float) -> void:
	if _apply_timer >= 0.0:
		_apply_timer -= delta
		if _apply_timer < 0.0:
			Settings.apply()
	if _save_timer >= 0.0:
		_save_timer -= delta
		if _save_timer < 0.0:
			Settings.save()


func _input(event: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	InputGlyphs.track(event)
	if get_viewport().gui_get_focus_owner() == null or not is_ancestor_of(get_viewport().gui_get_focus_owner()):
		if event is InputEventJoypadButton or event is InputEventKey:
			if event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ui_up"):
				focus_first()
				get_viewport().set_input_as_handled()
				return
	if event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause"):
		if get_children().any(func(c: Node) -> bool: return c is ConfirmDialog):
			return
		UISounds.back()
		close()
		get_viewport().set_input_as_handled()
		return
	var prev := false
	var next := false
	if event is InputEventJoypadButton and (event as InputEventJoypadButton).pressed:
		prev = (event as InputEventJoypadButton).button_index == JOY_BUTTON_LEFT_SHOULDER
		next = (event as InputEventJoypadButton).button_index == JOY_BUTTON_RIGHT_SHOULDER
	elif event is InputEventKey and (event as InputEventKey).pressed and not event.is_echo():
		prev = event.is_action_pressed(&"rotate_left")
		next = event.is_action_pressed(&"rotate_right")
	if prev or next:
		_set_tab(wrapi(tab + (1 if next else -1), 0, TABS.size()), true)
		get_viewport().set_input_as_handled()

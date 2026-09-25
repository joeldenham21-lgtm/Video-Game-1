class_name MainMenu
extends Node
## Main menu (scenes/ui/main_menu.tscn, opened by scenes/main.tscn): live golden-hour vista of the range
## (MenuVista) behind a restrained title and menu — Continue (with day, time, altitude, playtime), New Game
## (Explorer / Survivor / Whiteout), Settings, Credits, Quit (not on phones).

const DIFFICULTIES := [
	[&"explorer", "Explorer", "No hunger or thirst, and gentler cold. For taking in the mountains.", "Hunger & thirst off  ·  Cold ×0.6"],
	[&"survivor", "Survivor", "The intended experience. Cold, hunger and altitude will test you.", "Balanced  ·  Save anywhere"],
	[&"whiteout", "Whiteout", "Harsh cold and faster drain. You can only save by sleeping in a bed.", "Cold ×1.3  ·  Beds only"],
]

var vista: MenuVista
var ui: CanvasLayer
var root: Control
var home: Control
var new_game_panel: Control
var buttons: Array[Button] = []
var _scrim: TextureRect
var _title: Label
var _subtitle: Label
var _info: Label
var _hints: HBoxContainer
var _version: Label
var _fade: ColorRect
var _cards: Array[Button] = []
var _selected := 1
var _overlay: Control = null
var _busy := false


func _ready() -> void:
	Game.state = Game.State.MENU
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	SettingsPanel.apply_window_mode()
	if Audio.has_method("set_music_state"):
		Audio.set_music_state(&"menu")
	if Audio.has_method("set_menu_ambience"):
		Audio.call("set_menu_ambience", true)
	var vs := "res://scenes/ui/menu_vista.tscn"
	if ResourceLoader.exists(vs):
		vista = (load(vs) as PackedScene).instantiate() as MenuVista
		add_child(vista)
	ui = CanvasLayer.new()
	ui.name = "UI"
	ui.layer = 20
	add_child(ui)
	_build()
	UISounds.wire(root)
	get_viewport().size_changed.connect(_layout)
	InputGlyphs.bus().device_changed.connect(func(_d: StringName) -> void: _build_hints())
	_layout()
	_intro()


func _exit_tree() -> void:
	if Audio.has_method("set_menu_ambience"):
		Audio.call("set_menu_ambience", false)


# ============================================================================================= build

func _build() -> void:
	root = Control.new()
	root.name = "Root"
	root.theme = UITheme.get_theme()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(root)
	_scrim = TextureRect.new()
	var gt := GradientTexture2D.new()
	var g := Gradient.new()
	g.set_offset(0, 0.0)
	g.set_color(0, Color(0.015, 0.018, 0.024, 0.78))
	g.set_offset(1, 1.0)
	g.set_color(1, Color(0.015, 0.018, 0.024, 0.0))
	g.add_point(0.38, Color(0.015, 0.018, 0.024, 0.5))
	gt.gradient = g
	gt.fill_from = Vector2(0, 0)
	gt.fill_to = Vector2(1, 0)
	_scrim.texture = gt
	_scrim.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_scrim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_scrim)

	home = UITheme.vbox(0)
	home.name = "Home"
	root.add_child(home)
	_title = UITheme.label("THIN AIR", UITheme.FS_TITLE, UITheme.TEXT, "Light")
	_title.add_theme_font_override("font", UITheme.caps_font("Light", 30))
	_title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.25))
	_title.add_theme_constant_override("shadow_offset_y", 2)
	home.add_child(_title)
	_subtitle = UITheme.caps("The Aldous Range  ·  Northern British Columbia", 15, Color(1, 1, 1, 0.72), 5, "Medium")
	home.add_child(_subtitle)
	var sp := Control.new()
	sp.custom_minimum_size.y = 64
	home.add_child(sp)
	var has_save := Save.has_save(0)
	var entries: Array = []
	if has_save:
		entries.append(["Continue", _continue])
	entries.append(["New game", show_new_game])
	entries.append(["Settings", show_settings])
	entries.append(["Credits", show_credits])
	if not (OS.has_feature("android") or OS.has_feature("ios") or OS.has_feature("web")):
		entries.append(["Quit", _quit])
	for e in entries:
		var b := UITheme.menu_button(e[0])
		b.custom_minimum_size = Vector2(420, 58)
		b.pressed.connect(e[1])
		b.name = String(e[0]).replace(" ", "")
		home.add_child(b)
		buttons.append(b)
		if e[0] == "Continue":
			_info = UITheme.label(_save_line(), UITheme.FS_SMALL, Color(1, 1, 1, 0.62))
			_info.add_theme_constant_override("margin_left", 22)
			var im := UITheme.margin(0)
			im.add_theme_constant_override("margin_left", 25)
			im.add_theme_constant_override("margin_bottom", 8)
			im.add_child(_info)
			home.add_child(im)
	_version = UITheme.label("v%s" % ProjectSettings.get_setting("application/config/version", "0.1"), UITheme.FS_CAPTION, Color(1, 1, 1, 0.4))
	_version.add_theme_font_override("font", UITheme.mono_font())
	root.add_child(_version)
	_hints = UITheme.hbox(10)
	root.add_child(_hints)
	_build_hints()
	_build_new_game()
	_fade = ColorRect.new()
	_fade.color = Color(0, 0, 0, 1)
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(_fade)


func _save_line() -> String:
	var info: Dictionary = Save.get_save_info(0)
	var parts: PackedStringArray = ["Day %d" % int(info.get("day", 1)), UITheme.clock(float(info.get("hours", 12.0)))]
	var loc := String(info.get("location", ""))
	if loc != "":
		var digits := loc.to_int()
		parts.append(UITheme.metres(digits) if digits > 0 else loc)
	parts.append("%s played" % UITheme.duration(float(info.get("playtime", 0.0))))
	return "  ·  ".join(parts)


func _build_new_game() -> void:
	new_game_panel = UITheme.vbox(18)
	new_game_panel.name = "NewGame"
	new_game_panel.visible = false
	root.add_child(new_game_panel)
	new_game_panel.add_child(UITheme.caps("New game", 17, UITheme.ACCENT, 5))
	new_game_panel.add_child(UITheme.label("Choose how hard the mountain is.", UITheme.FS_LEAD, UITheme.TEXT, "Light"))
	var cards := UITheme.vbox(10)
	new_game_panel.add_child(cards)
	for i in DIFFICULTIES.size():
		var d: Array = DIFFICULTIES[i]
		var b := Button.new()
		b.name = String(d[0])
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(620, 104)
		b.focus_mode = Control.FOCUS_ALL
		var inner := UITheme.vbox(4)
		inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
		inner.position = Vector2(24, 16)
		b.add_child(inner)
		var top := UITheme.hbox(14)
		top.mouse_filter = Control.MOUSE_FILTER_IGNORE
		inner.add_child(top)
		var n := UITheme.label(String(d[1]), UITheme.FS_H3, UITheme.TEXT, "Medium")
		n.mouse_filter = Control.MOUSE_FILTER_IGNORE
		top.add_child(n)
		var tag := UITheme.caps(String(d[3]), 12, UITheme.TEXT_DIM, 2)
		tag.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		top.add_child(tag)
		var desc := UITheme.label(String(d[2]), UITheme.FS_BODY - 1, UITheme.TEXT_DIM)
		desc.mouse_filter = Control.MOUSE_FILTER_IGNORE
		inner.add_child(desc)
		b.pressed.connect(_select_difficulty.bind(i))
		b.focus_entered.connect(_select_difficulty.bind(i, false))
		cards.add_child(b)
		_cards.append(b)
	var row := UITheme.hbox(12)
	new_game_panel.add_child(row)
	var back := UITheme.button("Back")
	back.custom_minimum_size = Vector2(150, 54)
	back.set_meta(&"back_sound", true)
	back.pressed.connect(show_home)
	back.name = "Back"
	row.add_child(back)
	var begin := UITheme.button("Begin", "PrimaryButton")
	begin.custom_minimum_size = Vector2(220, 54)
	begin.pressed.connect(_begin)
	begin.name = "Begin"
	row.add_child(begin)
	_selected = maxi(0, [&"explorer", &"survivor", &"whiteout"].find(StringName(Settings.get_value(&"difficulty", &"survivor"))))
	_style_cards()


func _style_cards() -> void:
	for i in _cards.size():
		var on := i == _selected
		var b := _cards[i]
		b.set_pressed_no_signal(on)
		for st in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
			var sb := UITheme.panel(Color(1, 1, 1, 0.07 if on else 0.03), 6, UITheme.ACCENT if on else UITheme.LINE_STRONG, 2 if on else 1, 0)
			if st == "hover" and not on:
				sb.bg_color = Color(1, 1, 1, 0.06)
			if st == "focus":
				sb = UITheme.focus_box(6)
			b.add_theme_stylebox_override(st, sb)


func _select_difficulty(i: int, _from_click := true) -> void:
	_selected = i
	_style_cards()


func _build_hints() -> void:
	for c in _hints.get_children():
		c.queue_free()
	if InputGlyphs.current() == InputGlyphs.TOUCH:
		return
	for pair in [[&"ui_accept", "Select"], [&"ui_cancel", "Back"]]:
		var g := GlyphIcon.new()
		g.action = pair[0]
		g.glyph_height = 26
		g.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_hints.add_child(g)
		var l := UITheme.label(String(pair[1]), UITheme.FS_SMALL, Color(1, 1, 1, 0.7))
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_hints.add_child(l)
		var s := Control.new()
		s.custom_minimum_size.x = 10
		_hints.add_child(s)


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var W := root.size.x
	var H := root.size.y
	_scrim.position = Vector2.ZERO
	_scrim.size = Vector2(maxf(W * 0.62, 760.0), H)
	var m := clampf(W * 0.07, 48.0, 150.0)
	var hs := home.get_combined_minimum_size()
	home.size = hs
	home.position = Vector2(m, maxf(40.0, H * 0.5 - hs.y * 0.5 - 20.0))
	var ns := new_game_panel.get_combined_minimum_size()
	new_game_panel.size = ns
	new_game_panel.position = Vector2(m, maxf(30.0, (H - ns.y) * 0.5))
	_version.position = Vector2(m, H - 44.0)
	_version.size = _version.get_combined_minimum_size()
	var hsz := _hints.get_combined_minimum_size()
	_hints.size = hsz
	_hints.position = Vector2(W - m - hsz.x, H - 48.0)
	# the title scales down on narrow canvases
	var fs := int(clampf(W * 0.058, 72.0, UITheme.FS_TITLE))
	_title.add_theme_font_size_override("font_size", fs)


func _intro() -> void:
	_fade.color.a = 1.0
	home.modulate.a = 0.0
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", 0.0, 1.6).set_trans(Tween.TRANS_SINE)
	tw.parallel().tween_property(home, "modulate:a", 1.0, 1.2).set_delay(0.7)
	if InputGlyphs.current() != InputGlyphs.TOUCH and not buttons.is_empty():
		buttons[0].grab_focus.call_deferred()


# ============================================================================================= navigation

func show_home() -> void:
	_close_overlay()
	new_game_panel.visible = false
	home.visible = true
	_layout()
	if InputGlyphs.current() != InputGlyphs.TOUCH and not buttons.is_empty():
		buttons[0].grab_focus.call_deferred()


func show_new_game() -> void:
	home.visible = false
	new_game_panel.visible = true
	_layout()
	new_game_panel.modulate.a = 0.0
	create_tween().tween_property(new_game_panel, "modulate:a", 1.0, 0.2)
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		_cards[_selected].grab_focus.call_deferred()


func show_settings() -> void:
	var s := SettingsPanel.new()
	s.in_game = false
	_open_overlay(s)
	s.closed.connect(show_home)


func show_credits() -> void:
	var c := CreditsRoll.new()
	_open_overlay(c)
	c.finished.connect(show_home)


func _open_overlay(c: Control) -> void:
	_close_overlay()
	home.visible = false
	new_game_panel.visible = false
	_overlay = c
	root.add_child(c)
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.size = root.size


func _close_overlay() -> void:
	if _overlay and is_instance_valid(_overlay):
		_overlay.queue_free()
	_overlay = null


func _continue() -> void:
	if _busy:
		return
	_busy = true
	_leave(func() -> void: Game.continue_game(0))


func _begin() -> void:
	if Save.has_save(0):
		var info: Dictionary = Save.get_save_info(0)
		var d := ConfirmDialog.ask(root, "Start a new game?", "Your saved game (day %d) will be replaced the next time you save." % int(info.get("day", 1)), "Start")
		d.confirmed.connect(_start_new)
	else:
		_start_new()


func _start_new() -> void:
	if _busy:
		return
	_busy = true
	Settings.set_value(&"difficulty", DIFFICULTIES[_selected][0], false)
	Settings.save()
	_leave(func() -> void: Game.new_game())


func _leave(then: Callable) -> void:
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", 1.0, 0.7).set_trans(Tween.TRANS_SINE)
	tw.tween_callback(then)


func _quit() -> void:
	Settings.save()
	get_tree().quit()


func _input(event: InputEvent) -> void:
	InputGlyphs.track(event)
	if _overlay != null or _busy:
		return
	if root.get_children().any(func(c: Node) -> bool: return c is ConfirmDialog):
		return
	if event.is_action_pressed(&"ui_cancel") or (event.is_action_pressed(&"pause") and new_game_panel.visible):
		if new_game_panel.visible:
			UISounds.back()
			show_home()
			get_viewport().set_input_as_handled()
	elif (event is InputEventJoypadButton or event is InputEventKey) and (event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ui_up")):
		var f := get_viewport().gui_get_focus_owner()
		if f == null or not root.is_ancestor_of(f):
			if new_game_panel.visible:
				_cards[_selected].grab_focus()
			elif not buttons.is_empty():
				buttons[0].grab_focus()
			get_viewport().set_input_as_handled()

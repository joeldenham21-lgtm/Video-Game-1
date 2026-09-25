class_name Journal
extends CanvasLayer
## Field journal (J / pad View / pause menu): Objectives (Story.objectives), Logs (Story.found_logs →
## data/logs.json, "Play recording" for voiced ones through Audio.play_voice), Blueprints (Blueprints.all_unlocked
## + locked silhouettes), Field notes (survey-scanner scans, Game.flags["scanned"]), Stats (days survived,
## distance walked, highest altitude, …). LB/RB (Q/R) switch tabs; B/Esc/J close.
## Emits Events.ui_screen_opened/closed(&"journal"). Read logs are remembered in Game.flags["logs_read"].

const SCREEN := &"journal"
const TABS := ["Objectives", "Logs", "Blueprints", "Field notes", "Stats"]
const TAB_IDS := ["objectives", "logs", "blueprints", "notes", "stats"]
const TAB_ICONS := ["objective", "recording", "blueprint", "notes", "stats"]
const LOGS_PATH := "res://data/logs.json"

var is_open := false
var tab := 0
var root: Control
var _backdrop: ColorRect
var _frame: MarginContainer
var _tab_buttons: Array[Button] = []
var _underline: ColorRect
var _pages: Array[Control] = []
var _page_builders: Array[Callable] = []
var _header_info: Label
var _hint: HBoxContainer
var _from_pause: Node = null
var _opened_frame := -10
var _logs: Dictionary = {}
var _log_list: VBoxContainer
var _reader_title: Label
var _reader_meta: Label
var _reader_text: RichTextLabel
var _play_btn: Button
var _current_log: StringName = &""
var _playing: StringName = &""
var _play_t := 0.0
var _play_len := 0.0
var _play_bar: ProgressBar
var _note_title: Label
var _note_text: Label
var _tween: Tween


func _ready() -> void:
	layer = 50
	process_mode = Node.PROCESS_MODE_ALWAYS
	_load_logs()
	_build()
	visible = false
	get_viewport().size_changed.connect(_layout)
	InputGlyphs.bus().device_changed.connect(func(_d: StringName) -> void: _build_hints())


func _load_logs() -> void:
	if not FileAccess.file_exists(LOGS_PATH):
		return
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(LOGS_PATH))
	if d is Dictionary:
		_logs = d


# ============================================================================================= open / close

func open(tab_name := "") -> void:
	if is_open:
		return
	is_open = true
	_opened_frame = Engine.get_process_frames()
	visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Events.ui_screen_opened.emit(SCREEN)
	Audio.play_ui(&"ui_click")
	var i := TAB_IDS.find(tab_name.to_lower().replace(" ", ""))
	if i < 0:
		i = TABS.find(tab_name.capitalize())
	_set_tab(i if i >= 0 else tab)
	_layout()
	_animate(true)


func open_from_pause(pause_menu: Node) -> void:
	_from_pause = pause_menu
	open()


func close() -> void:
	if not is_open:
		return
	is_open = false
	_stop_recording()
	Events.ui_screen_closed.emit(SCREEN)
	UISounds.back()
	_animate(false)
	if _from_pause and is_instance_valid(_from_pause) and _from_pause.has_method("on_journal_closed"):
		_from_pause.call("on_journal_closed")
	_from_pause = null


func _animate(opening: bool) -> void:
	if _tween:
		_tween.kill()
	var mat := _backdrop.material as ShaderMaterial
	_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	if opening:
		root.modulate.a = 0.0
		_frame.position.y = 12.0
		_tween.tween_property(root, "modulate:a", 1.0, 0.18)
		_tween.tween_property(_frame, "position:y", 0.0, 0.22)
		_tween.tween_method(func(f: float) -> void: mat.set_shader_parameter("fade", f), 0.0, 1.0, 0.2)
	else:
		_tween.tween_property(root, "modulate:a", 0.0, 0.12)
		_tween.tween_method(func(f: float) -> void: mat.set_shader_parameter("fade", f), 1.0, 0.0, 0.14)
		_tween.chain().tween_callback(func() -> void:
			if not is_open:
				visible = false)


# ============================================================================================= build

func _build() -> void:
	_backdrop = ColorRect.new()
	_backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/ui/menus/blur_backdrop.gdshader")
	mat.set_shader_parameter("dim", 0.72)
	_backdrop.material = mat
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_backdrop)
	root = Control.new()
	root.theme = UITheme.get_theme()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_frame = UITheme.margin(0)
	_frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(_frame)
	var col := UITheme.vbox(0)
	_frame.add_child(col)
	# header
	var head := UITheme.hbox(26)
	head.custom_minimum_size.y = 64
	col.add_child(head)
	var brand := UITheme.caps("Journal", 17, UITheme.TEXT, 4)
	brand.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(brand)
	var tabs_box := Control.new()
	tabs_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tabs_box.custom_minimum_size.y = 64
	head.add_child(tabs_box)
	var tabs := UITheme.hbox(2)
	tabs.position = Vector2(0, 10)
	tabs_box.add_child(tabs)
	for i in TABS.size():
		var tb := UITheme.button(String(TABS[i]).to_upper(), "TabButton")
		tb.focus_mode = Control.FOCUS_NONE
		tb.pressed.connect(_set_tab.bind(i, true))
		tabs.add_child(tb)
		_tab_buttons.append(tb)
	_underline = ColorRect.new()
	_underline.color = UITheme.ACCENT
	_underline.size = Vector2(40, 2)
	tabs_box.add_child(_underline)
	_header_info = UITheme.label("", UITheme.FS_SMALL, UITheme.TEXT_DIM, "Medium")
	_header_info.add_theme_font_override("font", UITheme.mono_font())
	_header_info.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(_header_info)
	var x := UITheme.button("", "GhostButton", "close")
	x.custom_minimum_size = Vector2(48, 48)
	x.focus_mode = Control.FOCUS_NONE
	x.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	x.pressed.connect(close)
	head.add_child(x)
	col.add_child(UITheme.hline(UITheme.LINE_STRONG))
	var body := Control.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	for i in TABS.size():
		var page := MarginContainer.new()
		page.set_anchors_preset(Control.PRESET_FULL_RECT)
		page.add_theme_constant_override("margin_top", 22)
		page.add_theme_constant_override("margin_bottom", 12)
		page.visible = false
		body.add_child(page)
		_pages.append(page)
	_page_builders = [_build_objectives, _build_logs, _build_blueprints, _build_notes, _build_stats]
	col.add_child(UITheme.hline(UITheme.LINE_STRONG))
	_hint = UITheme.hbox(14)
	_hint.custom_minimum_size.y = 52
	_hint.alignment = BoxContainer.ALIGNMENT_END
	col.add_child(_hint)
	_build_hints()
	UISounds.wire(root)


func _build_hints() -> void:
	if _hint == null:
		return
	for c in _hint.get_children():
		c.queue_free()
	if InputGlyphs.current() == InputGlyphs.TOUCH:
		return
	var pad := InputGlyphs.current() == InputGlyphs.PAD
	for pair in [[[&"hotbar_prev" if pad else &"rotate_left", &"hotbar_next" if pad else &"rotate_right"], "Tabs"],
			[[&"ui_accept"], "Select"], [[&"journal"], "Close"]]:
		for a in pair[0]:
			var g := GlyphIcon.new()
			g.action = a
			g.glyph_height = 26
			g.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			_hint.add_child(g)
		var l := UITheme.label(String(pair[1]), UITheme.FS_SMALL, UITheme.TEXT_DIM)
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_hint.add_child(l)
		var s := Control.new()
		s.custom_minimum_size.x = 8
		_hint.add_child(s)


func _layout() -> void:
	UITheme.fit_root(root, 1100.0, 600.0)
	var mh := clampf(root.size.x * 0.05, 28.0, 110.0)
	_frame.add_theme_constant_override("margin_left", int(mh))
	_frame.add_theme_constant_override("margin_right", int(mh))
	_frame.add_theme_constant_override("margin_top", 22)
	_frame.add_theme_constant_override("margin_bottom", 6)
	_place_underline.call_deferred()


func _set_tab(i: int, sfx := false) -> void:
	tab = clampi(i, 0, TABS.size() - 1)
	for k in _pages.size():
		_pages[k].visible = k == tab
		_tab_buttons[k].add_theme_color_override("font_color", UITheme.TEXT if k == tab else UITheme.TEXT_DIM)
	# rebuild the page from live data every time it is shown
	var page := _pages[tab]
	for c in page.get_children():
		c.queue_free()
	var content: Control = _page_builders[tab].call()
	page.add_child(content)
	_header_info.text = "Day %d  ·  %s" % [Climate.day, Climate.get_time_string()]
	_place_underline.call_deferred()
	if sfx:
		Audio.play_ui(&"ui_click")
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		_focus_first.call_deferred()


func _focus_first() -> void:
	var page := _pages[tab]
	for c in page.find_children("*", "BaseButton", true, false):
		var b := c as BaseButton
		if b.focus_mode != Control.FOCUS_NONE and b.is_visible_in_tree() and not b.disabled:
			b.grab_focus()
			return


func _place_underline() -> void:
	var b := _tab_buttons[tab]
	var tw := create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	tw.tween_property(_underline, "position", Vector2(b.position.x + 14.0, 10.0 + b.size.y + 2.0), 0.15)
	tw.parallel().tween_property(_underline, "size:x", maxf(10.0, b.size.x - 28.0), 0.15)


func _two_columns(left_ratio := 1.0) -> Array:
	var h := UITheme.hbox(28)
	var l := UITheme.vbox(8)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.size_flags_stretch_ratio = left_ratio
	var r := UITheme.vbox(8)
	r.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	h.add_child(r)
	return [h, l, r]


func _scroll(child: Control) -> ScrollContainer:
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.follow_focus = true
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	child.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(child)
	return sc


# ============================================================================================= objectives

func _build_objectives() -> Control:
	var cols := _two_columns(1.5)
	var l: VBoxContainer = cols[1]
	var r: VBoxContainer = cols[2]
	l.add_child(UITheme.caps("Current", 14, UITheme.TEXT_DIM, 3))
	var list := UITheme.vbox(4)
	var open_n := 0
	for o in Story.objectives:
		if not bool(o.get("done", false)):
			list.add_child(_objective_row(o, false))
			open_n += 1
	if open_n == 0:
		list.add_child(UITheme.label("Nothing pressing. Stay warm.", UITheme.FS_BODY, UITheme.TEXT_DIM))
	var done := UITheme.vbox(4)
	var done_n := 0
	for i in range(Story.objectives.size() - 1, -1, -1):
		var o: Dictionary = Story.objectives[i]
		if bool(o.get("done", false)):
			done.add_child(_objective_row(o, true))
			done_n += 1
	var v := UITheme.vbox(10)
	v.add_child(list)
	if done_n > 0:
		var sp := Control.new()
		sp.custom_minimum_size.y = 20
		v.add_child(sp)
		v.add_child(UITheme.caps("Completed", 14, UITheme.TEXT_DIM, 3))
		v.add_child(done)
	l.add_child(_scroll(v))
	# right: where you are
	var card := PanelContainer.new()
	card.theme_type_variation = &"CardPanel"
	r.add_child(card)
	var cv := UITheme.vbox(12)
	card.add_child(cv)
	cv.add_child(UITheme.caps("Situation", 14, UITheme.TEXT_DIM, 3))
	var p := Game.player as Node3D
	var lines: Array = [["calendar", "Day %d, %s" % [Climate.day, Climate.get_time_string()]]]
	if p and is_instance_valid(p):
		lines.append(["altitude", "%s above sea level" % UITheme.metres(p.global_position.y)])
		lines.append(["temperature", "Air %s" % UITheme.celsius(Climate.get_air_temperature(p.global_position))])
		var near := _nearest_poi(p.global_position)
		if near != "":
			lines.append(["discovery", near])
	lines.append(["sun", String(Climate.weather).capitalize().replace("Snow", "Snowing").replace("Fog", "Valley fog")])
	for ln in lines:
		var h := UITheme.hbox(12)
		h.add_child(UITheme.icon_rect(String(ln[0]), 22.0, UITheme.TEXT_DIM))
		var t := UITheme.label(String(ln[1]), UITheme.FS_BODY, UITheme.TEXT)
		h.add_child(t)
		cv.add_child(h)
	return cols[0]


func _objective_row(o: Dictionary, done: bool) -> Control:
	var b := Button.new()
	b.theme_type_variation = &"GhostButton"
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.custom_minimum_size.y = 52
	b.focus_mode = Control.FOCUS_ALL
	b.text = String(o.get("text", ""))
	b.icon = UITheme.icon("check" if done else "poi")
	b.add_theme_color_override("icon_normal_color", UITheme.GOOD if done else UITheme.ACCENT)
	b.add_theme_color_override("icon_focus_color", UITheme.GOOD if done else UITheme.ACCENT)
	b.add_theme_color_override("icon_hover_color", UITheme.GOOD if done else UITheme.ACCENT)
	b.add_theme_constant_override("icon_max_width", 16)
	b.add_theme_font_override("font", UITheme.font("Regular"))
	b.add_theme_font_size_override("font_size", UITheme.FS_LEAD if not done else UITheme.FS_BODY)
	var fc := UITheme.TEXT_DIM if done else UITheme.TEXT
	for c in ["font_color", "font_hover_color", "font_focus_color", "font_pressed_color"]:
		b.add_theme_color_override(c, fc)
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return b


func _nearest_poi(pos: Vector3) -> String:
	var best := ""
	var bd := INF
	for id in Story.discovered_pois:
		var poi: Dictionary = TerrainData.get_poi(id)
		if poi.is_empty():
			continue
		var d := Vector2(pos.x, pos.z).distance_to(Vector2(poi["position"].x, poi["position"].z))
		if d < bd:
			bd = d
			best = String(poi.get("name", String(id).capitalize()))
	if best == "":
		return ""
	if bd < 150.0:
		return "At %s" % best
	var km := bd / 1000.0
	return "%s from %s" % [("%.1f km" % km) if km >= 1.0 else ("%d m" % (roundi(bd / 10.0) * 10)), best]


# ============================================================================================= logs

func _build_logs() -> Control:
	var cols := _two_columns(0.8)
	var l: VBoxContainer = cols[1]
	var r: VBoxContainer = cols[2]
	r.size_flags_stretch_ratio = 1.4
	var found := Story.found_logs
	l.add_child(UITheme.caps("Found  %d / %d" % [found.size(), _logs.size()], 14, UITheme.TEXT_DIM, 3))
	_log_list = UITheme.vbox(4)
	l.add_child(_scroll(_log_list))
	var read: Array = Game.get_flag(&"logs_read", [])
	for i in range(found.size() - 1, -1, -1):
		var id: StringName = found[i]
		var d: Dictionary = _logs.get(String(id), {})
		var b := Button.new()
		b.theme_type_variation = &"GhostButton"
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.custom_minimum_size.y = 66
		b.focus_mode = Control.FOCUS_ALL
		b.name = String(id)
		var voiced := d.get("voice", null) != null
		b.icon = UITheme.icon("recording" if voiced else "document")
		b.add_theme_constant_override("icon_max_width", 22)
		b.text = "%s\n%s" % [String(d.get("title", String(id).capitalize())), _log_meta(d)]
		b.add_theme_font_size_override("font_size", 19)
		if not read.has(String(id)):
			b.add_theme_color_override("icon_normal_color", UITheme.ACCENT)
		b.pressed.connect(_show_log.bind(id))
		b.focus_entered.connect(_show_log.bind(id))
		_log_list.add_child(b)
	if found.is_empty():
		_log_list.add_child(UITheme.label("No logs yet. Recorders, notebooks and notes you find are kept here.", UITheme.FS_BODY, UITheme.TEXT_DIM))
	# reader
	var card := PanelContainer.new()
	card.theme_type_variation = &"CardPanel"
	card.size_flags_vertical = Control.SIZE_EXPAND_FILL
	r.add_child(card)
	var rv := UITheme.vbox(10)
	card.add_child(rv)
	_reader_title = UITheme.label("", UITheme.FS_H2, UITheme.TEXT, "Light")
	_reader_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rv.add_child(_reader_title)
	_reader_meta = UITheme.caps("", 13, UITheme.TEXT_DIM, 2)
	rv.add_child(_reader_meta)
	var prow := UITheme.hbox(12)
	rv.add_child(prow)
	_play_btn = UITheme.button("Play recording", "", "play")
	_play_btn.custom_minimum_size = Vector2(0, 46)
	_play_btn.pressed.connect(_toggle_recording)
	prow.add_child(_play_btn)
	_play_bar = ProgressBar.new()
	_play_bar.show_percentage = false
	_play_bar.custom_minimum_size = Vector2(200, 3)
	_play_bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_play_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	prow.add_child(_play_bar)
	rv.add_child(UITheme.hline())
	_reader_text = RichTextLabel.new()
	_reader_text.fit_content = false
	_reader_text.scroll_active = true
	_reader_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_reader_text.add_theme_font_override("normal_font", UITheme.font("Light"))
	_reader_text.add_theme_font_size_override("normal_font_size", 23)
	_reader_text.add_theme_constant_override("line_separation", 9)
	_reader_text.focus_mode = Control.FOCUS_NONE
	rv.add_child(_reader_text)
	if not found.is_empty():
		_show_log(found[found.size() - 1])
	else:
		_reader_title.text = ""
		_play_btn.visible = false
		_play_bar.visible = false
	return cols[0]


func _log_meta(d: Dictionary) -> String:
	var parts: PackedStringArray = []
	if String(d.get("author", "")) != "":
		parts.append(String(d["author"]))
	if String(d.get("date", "")) != "":
		parts.append(String(d["date"]))
	return "  ·  ".join(parts)


func _show_log(id: StringName) -> void:
	if _current_log == id and _reader_title.text != "":
		return
	_current_log = id
	var d: Dictionary = _logs.get(String(id), {})
	_reader_title.text = String(d.get("title", String(id).capitalize()))
	_reader_meta.text = _log_meta(d).to_upper()
	_reader_text.text = String(d.get("text", ""))
	_reader_text.scroll_to_line(0)
	var voiced := d.get("voice", null) != null
	_play_btn.visible = voiced
	_play_bar.visible = voiced
	_update_play_button()
	var read: Array = Game.get_flag(&"logs_read", [])
	if not read.has(String(id)):
		read = read.duplicate()
		read.append(String(id))
		Game.set_flag(&"logs_read", read)
		var b := _log_list.get_node_or_null(NodePath(String(id))) as Button
		if b:
			b.remove_theme_color_override("icon_normal_color")


func _toggle_recording() -> void:
	if _playing != &"" and _playing == _current_log:
		_stop_recording()
		return
	var d: Dictionary = _logs.get(String(_current_log), {})
	var line: Variant = d.get("voice", null)
	if line == null:
		return
	_stop_recording()
	_play_len = Audio.play_voice(StringName(line))
	_play_t = 0.0
	_playing = _current_log
	_update_play_button()


func _stop_recording() -> void:
	if _playing != &"":
		Audio.stop_voice()
	_playing = &""
	_update_play_button()


func _update_play_button() -> void:
	if _play_btn == null or not is_instance_valid(_play_btn):
		return
	var on := _playing != &"" and _playing == _current_log
	_play_btn.text = "Stop" if on else "Play recording"
	_play_btn.icon = UITheme.icon("stop" if on else "play")
	_play_bar.value = 0.0 if not on else _play_bar.value


# ============================================================================================= blueprints

func _build_blueprints() -> Control:
	var v := UITheme.vbox(18)
	var known := Blueprints.all_unlocked()
	var groups := {}
	var total := 0
	for r in ItemDB.recipes:
		if not bool(r.get("requires_blueprint", false)):
			continue
		var cat := String(r.get("category", "other")).capitalize()
		if not groups.has(cat):
			groups[cat] = []
		groups[cat].append([StringName(r.get("id", "")), StringName(r.get("result", ""))])
		total += 1
	for bid in ItemDB.buildables:
		var b: Dictionary = ItemDB.buildables[bid]
		if not bool(b.get("requires_blueprint", false)):
			continue
		if not groups.has("Building"):
			groups["Building"] = []
		groups["Building"].append([StringName(bid), StringName(bid)])
		total += 1
	var n_known := 0
	for g in groups:
		for e in groups[g]:
			if known.has(e[0]):
				n_known += 1
	v.add_child(UITheme.caps("Known  %d / %d" % [n_known, total], 14, UITheme.TEXT_DIM, 3))
	var inner := UITheme.vbox(22)
	for g in groups:
		var sec := UITheme.vbox(10)
		sec.add_child(UITheme.label(String(g), UITheme.FS_LEAD, UITheme.TEXT, "Medium"))
		var grid := HFlowContainer.new()
		grid.add_theme_constant_override("h_separation", 10)
		grid.add_theme_constant_override("v_separation", 10)
		for e in groups[g]:
			grid.add_child(_blueprint_card(e[0], e[1], known.has(e[0])))
		sec.add_child(grid)
		inner.add_child(sec)
	v.add_child(_scroll(inner))
	return v


func _blueprint_card(id: StringName, icon_id: StringName, unlocked: bool) -> Control:
	var b := Button.new()
	b.custom_minimum_size = Vector2(170, 176)
	b.focus_mode = Control.FOCUS_ALL
	b.theme_type_variation = &"GhostButton"
	var sb := UITheme.panel(Color(1, 1, 1, 0.035 if unlocked else 0.015), 6, UITheme.LINE if unlocked else Color(1, 1, 1, 0.04), 1, 0)
	b.add_theme_stylebox_override("normal", sb)
	var hb := sb.duplicate() as StyleBoxFlat
	hb.bg_color = Color(1, 1, 1, 0.07)
	b.add_theme_stylebox_override("hover", hb)
	var v := UITheme.vbox(8)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	b.add_child(v)
	var tr := TextureRect.new()
	tr.texture = ItemDB.get_icon(icon_id)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.custom_minimum_size = Vector2(96, 96)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if not unlocked:
		tr.modulate = Color(0, 0, 0, 0.55)       # silhouette
	v.add_child(tr)
	var nm := Blueprints.display_name(id) if unlocked else "Unknown"
	var l := UITheme.label(nm, UITheme.FS_SMALL, UITheme.TEXT if unlocked else UITheme.TEXT_FAINT, "Medium")
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 150
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(l)
	if not unlocked:
		b.tooltip_text = _unlock_hint(id)
	else:
		var desc := String(ItemDB.get_item(icon_id).get("desc", ItemDB.get_buildable(id).get("desc", "")))
		b.tooltip_text = desc
	return b


func _unlock_hint(id: StringName) -> String:
	var entry := ItemDB.get_recipe(id)
	if entry.is_empty():
		entry = ItemDB.get_buildable(id)
	var u: Variant = entry.get("unlock", null)
	if u is Dictionary:
		if (u as Dictionary).has("scan"):
			return "Learned by scanning something with the survey scanner."
		if (u as Dictionary).has("read"):
			return "Learned by reading."
		if (u as Dictionary).has("pickup"):
			return "Learned by finding the right material."
		if (u as Dictionary).has("craft"):
			return "Learned by crafting something first."
	return "Not yet learned."


# ============================================================================================= field notes

func _build_notes() -> Control:
	var cols := _two_columns(0.8)
	var l: VBoxContainer = cols[1]
	var r: VBoxContainer = cols[2]
	r.size_flags_stretch_ratio = 1.4
	var scanned: Variant = Game.get_flag(&"scanned", [])
	var ids: Array = scanned if scanned is Array else []
	l.add_child(UITheme.caps("Scanned  %d" % ids.size(), 14, UITheme.TEXT_DIM, 3))
	var list := UITheme.vbox(4)
	l.add_child(_scroll(list))
	var card := PanelContainer.new()
	card.theme_type_variation = &"CardPanel"
	card.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	r.add_child(card)
	var rv := UITheme.vbox(12)
	card.add_child(rv)
	_note_title = UITheme.label("", UITheme.FS_H2, UITheme.TEXT, "Light")
	rv.add_child(_note_title)
	_note_text = UITheme.label("", 22, UITheme.TEXT, "Light")
	_note_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note_text.custom_minimum_size.x = 420
	rv.add_child(_note_text)
	for i in range(ids.size() - 1, -1, -1):
		var id := StringName(ids[i])
		var e := FieldNotes.entry(id)
		var b := UITheme.button(String(e[0]), "GhostButton", "scan")
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.custom_minimum_size.y = 52
		b.add_theme_constant_override("icon_max_width", 20)
		b.pressed.connect(_show_note.bind(id))
		b.focus_entered.connect(_show_note.bind(id))
		list.add_child(b)
	if ids.is_empty():
		list.add_child(UITheme.label("Hold the survey scanner on wreckage, equipment, plants and animals to log them here.", UITheme.FS_BODY, UITheme.TEXT_DIM))
		card.visible = false
	else:
		_show_note(StringName(ids[ids.size() - 1]))
	return cols[0]


func _show_note(id: StringName) -> void:
	var e := FieldNotes.entry(id)
	_note_title.text = String(e[0])
	_note_text.text = String(e[1])


# ============================================================================================= stats

func _build_stats() -> Control:
	var v := UITheme.vbox(18)
	v.add_child(UITheme.caps("Expedition", 14, UITheme.TEXT_DIM, 3))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 14)
	v.add_child(grid)
	var n_pois := TerrainData.all_pois().size()
	var dist := float(Game.get_flag(&"stat_distance_m", 0.0))
	var bps := Blueprints.all_unlocked().size()
	var tiles := [
		["Days survived", str(maxi(Climate.day - 1, 0)) if Climate.hours < 12.0 else str(Climate.day), "calendar"],
		["Time on the mountain", UITheme.duration(Game.playtime), "clock"],
		["Distance walked", ("%.1f km" % (dist / 1000.0)) if dist >= 1000.0 else "%d m" % roundi(dist), "route"],
		["Highest point", UITheme.metres(float(Game.get_flag(&"stat_max_altitude", 0.0))), "altitude"],
		["Logs found", "%d / %d" % [Story.found_logs.size(), _logs.size()], "recording"],
		["Places discovered", "%d / %d" % [Story.discovered_pois.size(), n_pois] if n_pois > 0 else str(Story.discovered_pois.size()), "discovery"],
		["Blueprints known", str(bps), "blueprint"],
		["Items crafted", str(int(Game.get_flag(&"stat_crafted", 0))), "build"],
		["Trees felled", str(int(Game.get_flag(&"stat_trees", 0))), "use"],
		["Structures built", str(int(Game.get_flag(&"stat_built", 0))), "cabin"],
		["Animals taken", str(int(Game.get_flag(&"stat_animals", 0))), "aim"],
		["Difficulty", String(Game.difficulty).capitalize(), "stats"],
	]
	for t in tiles:
		var p := PanelContainer.new()
		p.theme_type_variation = &"CardPanel"
		p.custom_minimum_size = Vector2(250, 118)
		p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var pv := UITheme.vbox(6)
		p.add_child(pv)
		var top := UITheme.hbox(8)
		top.add_child(UITheme.icon_rect(String(t[2]), 18.0, UITheme.TEXT_DIM))
		top.add_child(UITheme.caps(String(t[0]), 12, UITheme.TEXT_DIM, 2))
		pv.add_child(top)
		var val := UITheme.label(String(t[1]), UITheme.FS_H2, UITheme.TEXT, "Light")
		pv.add_child(val)
		grid.add_child(p)
	# a focusable anchor so pads can scroll/close on this page
	var b := UITheme.button("Close journal", "GhostButton")
	b.pressed.connect(close)
	b.set_meta(&"back_sound", true)
	v.add_child(b)
	return _scroll(v)


# ============================================================================================= input

func _process(delta: float) -> void:
	if not is_open:
		return
	if _playing != &"":
		_play_t += delta
		if _play_bar and is_instance_valid(_play_bar) and _play_len > 0.0:
			_play_bar.value = clampf(_play_t / _play_len, 0.0, 1.0) * 100.0
		if _play_t > _play_len + 0.3:
			_playing = &""
			_update_play_button()
	# touch-injected actions
	if Engine.get_process_frames() != _opened_frame and (Input.is_action_just_pressed(&"journal") or Input.is_action_just_pressed(&"pause")) \
			and InputGlyphs.current() == InputGlyphs.TOUCH:
		close()


func _input(event: InputEvent) -> void:
	if not is_open:
		return
	InputGlyphs.track(event)
	if Engine.get_process_frames() == _opened_frame:
		return
	if event.is_action_pressed(&"journal") or event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause"):
		get_viewport().set_input_as_handled()
		close()
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
		return
	# right stick scrolls the reading pane
	if event is InputEventJoypadMotion and (event as InputEventJoypadMotion).axis == JOY_AXIS_RIGHT_Y and _reader_text and is_instance_valid(_reader_text):
		var vs := _reader_text.get_v_scroll_bar()
		vs.value += (event as InputEventJoypadMotion).axis_value * 40.0
	if (event is InputEventJoypadButton or event is InputEventKey) and (event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ui_up")):
		var f := get_viewport().gui_get_focus_owner()
		if f == null or not root.is_ancestor_of(f):
			_focus_first()
			get_viewport().set_input_as_handled()

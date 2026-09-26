class_name MapScreen
extends CanvasLayer
## Full-screen topographic map (M / pad D-pad down / using the map item): the survey-style paper map of the
## Aldous Range generated from TerrainData (TopoMap + MapView), labelled discovered places, the tracked
## objective, and your position only if you carry a compass or GPS-capable device. Legend on the right.
## Emits Events.ui_screen_opened/closed(&"map").

const SCREEN := &"map"

var is_open := false
var view: MapView
var root: Control
var _frame: MarginContainer
var _legend: PanelContainer
var _hint: HBoxContainer
var _locate_btn: Button
var _where: Label
var _opened_frame := -10
var _tween: Tween


func _ready() -> void:
	layer = 50
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()
	visible = false
	get_viewport().size_changed.connect(_layout)
	InputGlyphs.bus().device_changed.connect(func(_d: StringName) -> void: _build_hints())


func _build() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.03, 0.035, 0.042, 0.94)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	root = Control.new()
	root.theme = UITheme.get_theme()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_frame = UITheme.margin(0)
	_frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(_frame)
	var col := UITheme.vbox(12)
	_frame.add_child(col)
	var head := UITheme.hbox(18)
	head.custom_minimum_size.y = 56
	col.add_child(head)
	var tv := UITheme.vbox(0)
	tv.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(tv)
	tv.add_child(UITheme.caps("Map", 17, UITheme.TEXT, 4))
	tv.add_child(UITheme.label("Aldous Range  ·  Mount Corrigan  ·  contour interval 50 m", UITheme.FS_SMALL, UITheme.TEXT_DIM))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	_where = UITheme.label("", UITheme.FS_SMALL, UITheme.TEXT_DIM, "Medium")
	_where.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(_where)
	_locate_btn = UITheme.button("Centre on me", "", "locate")
	_locate_btn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_locate_btn.focus_mode = Control.FOCUS_NONE
	_locate_btn.pressed.connect(center_on_player)
	head.add_child(_locate_btn)
	for z in [["plus", 1.0 / 1.5], ["minus", 1.5]]:
		var zb := UITheme.button("", "", String(z[0]))
		zb.custom_minimum_size = Vector2(48, 48)
		zb.focus_mode = Control.FOCUS_NONE
		zb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		zb.pressed.connect(func() -> void: view.zoom_at(view.size * 0.5, float(z[1])))
		head.add_child(zb)
	var x := UITheme.button("", "GhostButton", "close")
	x.custom_minimum_size = Vector2(48, 48)
	x.focus_mode = Control.FOCUS_NONE
	x.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	x.pressed.connect(close)
	head.add_child(x)
	var body := UITheme.hbox(16)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	var map_panel := PanelContainer.new()
	map_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sb := UITheme.panel(Color(0.9, 0.88, 0.82), 4, Color(0, 0, 0, 0.5), 1, 0)
	sb.shadow_color = Color(0, 0, 0, 0.45)
	sb.shadow_size = 18
	map_panel.add_theme_stylebox_override("panel", sb)
	body.add_child(map_panel)
	view = MapView.new()
	view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	map_panel.add_child(view)
	_legend = _build_legend()
	body.add_child(_legend)
	_hint = UITheme.hbox(12)
	_hint.custom_minimum_size.y = 40
	_hint.alignment = BoxContainer.ALIGNMENT_END
	col.add_child(_hint)
	_build_hints()
	UISounds.wire(root)


func _build_legend() -> PanelContainer:
	var p := PanelContainer.new()
	p.theme_type_variation = &"CardPanel"
	p.custom_minimum_size.x = 250
	var v := UITheme.vbox(10)
	p.add_child(v)
	v.add_child(UITheme.caps("Legend", 13, UITheme.TEXT_DIM, 3))
	var items := [
		["line", Color(0.62, 0.42, 0.26), "Contour, 50 m"], ["line_bold", Color(0.62, 0.42, 0.26), "Index contour, 250 m"],
		["line", Color(0.3, 0.52, 0.72), "Contour on snow and ice"], ["swatch", Color(0.79, 0.86, 0.72), "Forest"],
		["swatch", Color(0.975, 0.985, 1.0), "Snow and glacier"], ["swatch", Color(0.63, 0.78, 0.87), "Lake"],
		["dash", Color(0.55, 0.22, 0.15), "Trail"], ["line", Color(0.42, 0.55, 0.7, 0.6), "Grid, 500 m"],
		["icon", Color(0.95, 0.93, 0.88), "Known place"], ["diamond", UITheme.ACCENT, "Objective"],
		["arrow", Color(0.85, 0.2, 0.12), "You (with a compass)"],
	]
	for it in items:
		var h := UITheme.hbox(10)
		var sw := Control.new()
		sw.custom_minimum_size = Vector2(34, 20)
		sw.draw.connect(_legend_swatch.bind(sw, String(it[0]), it[1] as Color))
		h.add_child(sw)
		var l := UITheme.label(String(it[2]), UITheme.FS_SMALL, UITheme.TEXT)
		h.add_child(l)
		v.add_child(h)
	return p


func _legend_swatch(c: Control, kind: String, col: Color) -> void:
	var y := c.size.y * 0.5
	match kind:
		"line": c.draw_line(Vector2(2, y), Vector2(32, y), col, 1.2, true)
		"line_bold": c.draw_line(Vector2(2, y), Vector2(32, y), col, 2.4, true)
		"dash": c.draw_dashed_line(Vector2(2, y), Vector2(32, y), col, 1.8, 6.0)
		"swatch":
			c.draw_rect(Rect2(4, 3, 26, 14), col)
			c.draw_rect(Rect2(4, 3, 26, 14), Color(0, 0, 0, 0.3), false, 1.0)
		"icon":
			c.draw_circle(Vector2(17, y), 9.0, col)
			var ic := UITheme.icon("cabin")
			if ic:
				c.draw_texture_rect(ic, Rect2(Vector2(11, y - 6), Vector2(12, 12)), false, Color(0.2, 0.18, 0.16))
		"diamond":
			c.draw_colored_polygon(PackedVector2Array([Vector2(17, y - 8), Vector2(25, y), Vector2(17, y + 8), Vector2(9, y)]), col)
		"arrow":
			c.draw_colored_polygon(PackedVector2Array([Vector2(17, y - 9), Vector2(24, y + 7), Vector2(17, y + 3), Vector2(10, y + 7)]), col)


func _build_hints() -> void:
	if _hint == null:
		return
	for c in _hint.get_children():
		c.queue_free()
	var dev := InputGlyphs.current()
	if dev == InputGlyphs.TOUCH:
		_hint.add_child(UITheme.label("Drag to move  ·  pinch to zoom", UITheme.FS_SMALL, UITheme.TEXT_DIM))
		return
	var rows: Array = []
	if dev == InputGlyphs.PAD:
		rows = [[[&"move_forward"], "Move"], [[&"aim", &"use"], "Zoom"], [[&"interact"], "Centre on me"], [[&"map"], "Close"]]
	else:
		rows = [[[&"move_forward", &"move_left", &"move_back", &"move_right"], "Move"], [[&"rotate_left", &"rotate_right"], "Zoom"],
			[[&"jump"], "Centre on me"], [[&"map"], "Close"]]
	for r in rows:
		for a in r[0]:
			if dev == InputGlyphs.PAD and a == &"move_forward":
				var ls := UITheme.label("Left stick", UITheme.FS_SMALL, UITheme.TEXT)
				ls.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				_hint.add_child(ls)
				continue
			var g := GlyphIcon.new()
			g.action = a
			g.glyph_height = 24
			g.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			_hint.add_child(g)
		var l := UITheme.label(String(r[1]), UITheme.FS_SMALL, UITheme.TEXT_DIM)
		l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		_hint.add_child(l)
		var s := Control.new()
		s.custom_minimum_size.x = 8
		_hint.add_child(s)


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var mh := clampf(root.size.x * 0.035, 20.0, 80.0)
	_frame.add_theme_constant_override("margin_left", int(mh))
	_frame.add_theme_constant_override("margin_right", int(mh))
	_frame.add_theme_constant_override("margin_top", 16)
	_frame.add_theme_constant_override("margin_bottom", 8)
	_legend.visible = root.size.x > 1350.0


# ============================================================================================= open / close

func open() -> void:
	if is_open:
		return
	is_open = true
	_opened_frame = Engine.get_process_frames()
	visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Events.ui_screen_opened.emit(SCREEN)
	Audio.play_ui(&"ui_click")
	_layout()
	refresh()
	if view.player_pos != Vector3.INF and view.show_player:
		view.set_view(Vector2(view.player_pos.x, view.player_pos.z), 2.2)
	elif view.m_per_unit == 3.0:
		view.set_view(Vector2(0.0, -150.0), view.max_m_per_unit() * 0.8)
	root.modulate.a = 0.0
	if _tween:
		_tween.kill()
	_tween = create_tween()
	_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	_tween.tween_property(root, "modulate:a", 1.0, 0.18)
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		view.grab_focus.call_deferred()


func close() -> void:
	if not is_open:
		return
	is_open = false
	Events.ui_screen_closed.emit(SCREEN)
	UISounds.back()
	if _tween:
		_tween.kill()
	_tween = create_tween()
	_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	_tween.tween_property(root, "modulate:a", 0.0, 0.12)
	_tween.tween_callback(func() -> void:
		if not is_open:
			visible = false)


## Pulls places, objective and (if locatable) the player into the view.
func refresh() -> void:
	var places: Array[Dictionary] = []
	var shown := {}
	for id in Story.discovered_pois:
		var poi: Dictionary = TerrainData.get_poi(id)
		if poi.is_empty():
			continue
		shown[String(id)] = true
		places.append({"pos": poi["position"], "name": String(poi.get("name", String(id).capitalize())), "icon": HUD.poi_icon(String(id))})
	var summit: Dictionary = TerrainData.get_poi(&"summit")
	if not summit.is_empty() and not shown.has("summit"):
		places.append({"pos": summit["position"], "name": String(summit.get("name", "Mount Corrigan")), "icon": "peak"})
	view.places = places
	view.objective = HUD.objective_location()
	var p := Game.player as Node3D
	view.show_player = false
	view.player_pos = Vector3.INF
	if p and is_instance_valid(p):
		view.player_pos = p.global_position
		var cam: Camera3D = p.call("get_camera") if p.has_method("get_camera") else null
		if cam:
			view.player_bearing = HUDCompass.bearing_of(-cam.global_transform.basis.z)
		view.show_player = can_locate(p)
	_locate_btn.visible = view.show_player
	var where := "Position unknown — no compass" if not view.show_player else "%s  ·  %s" % [UITheme.metres(view.player_pos.y), _bearing_text(view.player_bearing)]
	_where.text = where
	view._mark()


static func can_locate(p: Node) -> bool:
	var inv: Variant = p.get("inventory")
	if inv == null:
		return false
	for id in MapView.LOCATOR_ITEMS:
		if (inv as Object).call("has", id, 1):
			return true
	return false


func _bearing_text(b: float) -> String:
	var names := ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
	return "facing %s" % names[int(round(b / 45.0)) % 8]


func center_on_player() -> void:
	if view.show_player and view.player_pos != Vector3.INF:
		view.set_view(Vector2(view.player_pos.x, view.player_pos.z), minf(view.m_per_unit, 2.2))
		Audio.play_ui(&"ui_click")


func _process(_d: float) -> void:
	if not is_open:
		return
	if Engine.get_process_frames() != _opened_frame and InputGlyphs.current() == InputGlyphs.TOUCH \
			and (Input.is_action_just_pressed(&"map") or Input.is_action_just_pressed(&"pause")):
		close()


func _input(event: InputEvent) -> void:
	if not is_open:
		return
	InputGlyphs.track(event)
	if Engine.get_process_frames() == _opened_frame:
		return
	if event.is_action_pressed(&"map") or event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause"):
		get_viewport().set_input_as_handled()
		close()
	elif event.is_action_pressed(&"interact") or (event is InputEventKey and event.is_action_pressed(&"jump")):
		center_on_player()
		get_viewport().set_input_as_handled()

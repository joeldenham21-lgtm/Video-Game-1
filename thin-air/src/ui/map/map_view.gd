class_name MapView
extends Control
## Pannable, zoomable topographic map. The terrain is rendered by topo_map.gdshader into a SubViewport that
## only re-renders when the view changes (cheap while idle, crisp at any zoom); water, trails, places, the
## objective, the player arrow (only with a compass or GPS-like device), scale bar and north arrow are
## vector overlays. Mouse: wheel zoom at the cursor, drag to pan. Touch: drag, pinch. Pad: left stick pan,
## right stick / triggers zoom. Keyboard: WASD pan, Q/R or +/− zoom.

signal view_changed()

const MIN_M_PER_UNIT := 0.35
const LOCATOR_ITEMS: Array[StringName] = [&"compass", &"survey_scanner"]

var center := Vector2.ZERO           # world x, z at the view centre
var m_per_unit := 3.0                # metres per logical unit of this control
var show_player := false
var player_pos := Vector3.INF
var player_bearing := 0.0
var objective := Vector3.INF
var places: Array[Dictionary] = []   # {pos: Vector3, name, icon, discovered}

var _sv: SubViewport
var _rect: ColorRect
var _mat: ShaderMaterial
var _tex: TextureRect
var _overlay: Control
var _data: Dictionary
var _dirty := true
var _touches := {}
var _pinch_d0 := 0.0
var _pinch_m0 := 0.0
var _dragging := false
var _font: Font
var _font_i: Font
var _font_caps: Font


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_ALL
	_font = UITheme.font("Medium")
	_font_i = UITheme.font("Italic")
	_font_caps = UITheme.caps_font("SemiBold", 2)
	_data = TopoMap.data()
	_sv = SubViewport.new()
	_sv.disable_3d = true
	_sv.transparent_bg = false
	_sv.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(_sv)
	_rect = ColorRect.new()
	_mat = TopoMap.make_material()
	_rect.material = _mat
	_sv.add_child(_rect)
	_tex = TextureRect.new()
	_tex.texture = _sv.get_texture()
	_tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_tex.stretch_mode = TextureRect.STRETCH_SCALE
	_tex.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tex.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_tex)
	_overlay = Control.new()
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.draw.connect(_draw_overlay)
	add_child(_overlay)
	resized.connect(_mark)
	focus_entered.connect(queue_redraw)
	focus_exited.connect(queue_redraw)


func max_m_per_unit() -> float:
	return TerrainData.WORLD_SIZE * 1.15 / maxf(1.0, minf(size.x, size.y))


func set_view(c: Vector2, mpu: float) -> void:
	center = c
	m_per_unit = clampf(mpu, MIN_M_PER_UNIT, max_m_per_unit())
	var lim := TerrainData.HALF + 200.0
	center = center.clamp(Vector2(-lim, -lim), Vector2(lim, lim))
	_mark()


func _mark() -> void:
	_dirty = true
	_overlay.queue_redraw()
	view_changed.emit()


func world_to_local(xz: Vector2) -> Vector2:
	return size * 0.5 + (xz - center) / m_per_unit


func local_to_world(p: Vector2) -> Vector2:
	return center + (p - size * 0.5) * m_per_unit


func zoom_at(local_pos: Vector2, factor: float) -> void:
	var before := local_to_world(local_pos)
	m_per_unit = clampf(m_per_unit * factor, MIN_M_PER_UNIT, max_m_per_unit())
	var after := local_to_world(local_pos)
	set_view(center + (before - after), m_per_unit)


func pan_px(d: Vector2) -> void:
	set_view(center - d * m_per_unit, m_per_unit)


func _process(delta: float) -> void:
	if not is_visible_in_tree():
		return
	# pad / keyboard
	var mv := Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	if mv.length_squared() > 0.01:
		set_view(center + mv * 700.0 * delta * m_per_unit, m_per_unit)
	var ry := Input.get_axis(&"look_up", &"look_down")          # right stick: up zooms in
	if absf(ry) > 0.2:
		zoom_at(size * 0.5, 1.0 + ry * delta * 1.6)
	elif InputGlyphs.current() == InputGlyphs.PAD:
		var zin := Input.get_action_strength(&"use")              # RT in, LT out
		var zout := Input.get_action_strength(&"aim")
		if zin > 0.3 or zout > 0.3:
			zoom_at(size * 0.5, 1.0 + (zout - zin) * delta * 1.6)
	if _dirty:
		_render()


func _render() -> void:
	_dirty = false
	var s := get_global_transform_with_canvas().get_scale().x * get_viewport().get_final_transform().get_scale().x
	var px := Vector2i(maxi(8, int(size.x * s)), maxi(8, int(size.y * s)))
	if _sv.size != px:
		_sv.size = px
	_rect.size = Vector2(px)
	_mat.set_shader_parameter("rect_px", Vector2(px))
	_mat.set_shader_parameter("view_center", center)
	_mat.set_shader_parameter("m_per_px", m_per_unit / s)
	_sv.render_target_update_mode = SubViewport.UPDATE_ONCE


# ============================================================================================= input

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_at(mb.position, 1.0 / 1.18)
			accept_event()
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_at(mb.position, 1.18)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and event.device != InputEvent.DEVICE_ID_EMULATION:
			_dragging = mb.pressed
			if mb.double_click:
				zoom_at(mb.position, 0.5)
			accept_event()
	elif event is InputEventMouseMotion and _dragging and event.device != InputEvent.DEVICE_ID_EMULATION:
		pan_px((event as InputEventMouseMotion).relative)
		accept_event()
	elif event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_touches[st.index] = st.position
		else:
			_touches.erase(st.index)
		if _touches.size() == 2:
			var pts: Array = _touches.values()
			_pinch_d0 = (pts[0] as Vector2).distance_to(pts[1])
			_pinch_m0 = m_per_unit
		accept_event()
	elif event is InputEventScreenDrag:
		var sd := event as InputEventScreenDrag
		if _touches.size() >= 2:
			var old: Vector2 = _touches.get(sd.index, sd.position)
			_touches[sd.index] = sd.position
			var pts2: Array = _touches.values()
			var mid := ((pts2[0] as Vector2) + (pts2[1] as Vector2)) * 0.5
			var dd := (pts2[0] as Vector2).distance_to(pts2[1])
			if _pinch_d0 > 10.0:
				var target := _pinch_m0 * _pinch_d0 / maxf(dd, 1.0)
				zoom_at(mid, target / m_per_unit)
			pan_px((sd.position - old) * 0.5)
		else:
			_touches[sd.index] = sd.position
			pan_px(sd.relative)
		accept_event()
	elif event is InputEventMagnifyGesture:
		zoom_at((event as InputEventMagnifyGesture).position, 1.0 / (event as InputEventMagnifyGesture).factor)
		accept_event()
	elif event is InputEventPanGesture:
		pan_px(-(event as InputEventPanGesture).delta * 8.0)
		accept_event()
	elif event is InputEventKey and (event as InputEventKey).pressed:
		var k := (event as InputEventKey).keycode
		if k == KEY_EQUAL or k == KEY_KP_ADD or event.is_action(&"rotate_right"):
			zoom_at(size * 0.5, 1.0 / 1.25)
			accept_event()
		elif k == KEY_MINUS or k == KEY_KP_SUBTRACT or event.is_action(&"rotate_left"):
			zoom_at(size * 0.5, 1.25)
			accept_event()


# ============================================================================================= overlay

func _draw_overlay() -> void:
	var o := _overlay
	var water := Color(0.63, 0.78, 0.87)
	var water_line := Color(0.26, 0.47, 0.64)
	# lakes
	for l in _data.get("lakes", []):
		var poly: PackedVector2Array = l["poly"]
		var pts := PackedVector2Array()
		for q in poly:
			pts.append(world_to_local(q))
		if pts.size() >= 3 and Geometry2D.triangulate_polygon(pts).size() > 0:
			o.draw_colored_polygon(pts, water)
			var closed := pts.duplicate()
			closed.append(pts[0])
			o.draw_polyline(closed, water_line, 1.4, true)
			var nm := String(l.get("name", ""))
			if nm == "":
				nm = String(l.get("id", "")).replace("_", " ").capitalize()
			var named_place := false
			for pl in places:
				if String(pl.get("name", "")).to_lower() == nm.to_lower():
					named_place = true
			if nm != "" and m_per_unit < 6.0 and not named_place:
				var c := Vector2.ZERO
				for q in pts:
					c += q
				c /= pts.size()
				_label(o, nm, c, 17, water_line, _font_i, true)
	# rivers
	for r in _data.get("rivers", []):
		var pts2 := PackedVector2Array()
		for q in r["points"]:
			pts2.append(world_to_local(q))
		var w := 1.3
		var ws: PackedFloat32Array = r["widths"]
		if ws.size() > 0:
			w = clampf(ws[ws.size() / 2] / m_per_unit, 1.2, 6.0)
		o.draw_polyline(pts2, water_line, w, true)
	# trails (dashed)
	for t in _data.get("trails", []):
		var pts3: PackedVector2Array = t["points"]
		for i in pts3.size() - 1:
			var a := world_to_local(pts3[i])
			var b := world_to_local(pts3[i + 1])
			o.draw_dashed_line(a, b, Color(0.55, 0.22, 0.15, 0.85), 1.6, 7.0, true)
	# places
	for p in places:
		var lp := world_to_local(Vector2(p["pos"].x, p["pos"].z))
		if not Rect2(Vector2(-60, -60), size + Vector2(120, 120)).has_point(lp):
			continue
		var icon := UITheme.icon(String(p.get("icon", "poi")))
		var col := Color(0.18, 0.16, 0.14)
		o.draw_circle(lp, 15.0, Color(0.97, 0.95, 0.9, 0.92))
		o.draw_arc(lp, 15.0, 0.0, TAU, 32, Color(0.2, 0.18, 0.16, 0.7), 1.3, true)
		if icon:
			o.draw_texture_rect(icon, Rect2(lp - Vector2(10, 10), Vector2(20, 20)), false, col)
		_label(o, String(p.get("name", "")), lp + Vector2(20, -2), 18, col, _font, false)
		var elev := float(p["pos"].y)
		if elev > 0.0:
			_label(o, UITheme.metres(elev), lp + Vector2(20, 17), 14, Color(0.35, 0.3, 0.26), UITheme.mono_font(), false)
	# objective
	if objective != Vector3.INF:
		var op := world_to_local(Vector2(objective.x, objective.z))
		var r := 11.0
		var dia := PackedVector2Array([op + Vector2(0, -r), op + Vector2(r, 0), op + Vector2(0, r), op + Vector2(-r, 0)])
		o.draw_colored_polygon(dia, UITheme.ACCENT)
		dia.append(dia[0])
		o.draw_polyline(dia, Color(0.3, 0.18, 0.05), 1.5, true)
		o.draw_arc(op, 20.0, 0.0, TAU, 36, Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, 0.6), 2.0, true)
	# player
	if show_player and player_pos != Vector3.INF:
		var pp := world_to_local(Vector2(player_pos.x, player_pos.z))
		var ang := deg_to_rad(player_bearing)
		var fwd := Vector2(sin(ang), -cos(ang))
		var right := Vector2(-fwd.y, fwd.x)
		var tip := pp + fwd * 16.0
		var arrow := PackedVector2Array([tip, pp - fwd * 10.0 + right * 10.0, pp - fwd * 5.0, pp - fwd * 10.0 - right * 10.0])
		o.draw_circle(pp, 22.0, Color(0.85, 0.2, 0.12, 0.15))
		o.draw_colored_polygon(arrow, Color(0.85, 0.2, 0.12))
		arrow.append(arrow[0])
		o.draw_polyline(arrow, Color(1, 1, 1, 0.9), 1.6, true)
	_draw_scale_bar(o)
	_draw_north(o)
	if has_focus() and InputGlyphs.current() != InputGlyphs.TOUCH:
		o.draw_line(size * 0.5 - Vector2(10, 0), size * 0.5 + Vector2(10, 0), Color(0.1, 0.1, 0.1, 0.6), 1.2)
		o.draw_line(size * 0.5 - Vector2(0, 10), size * 0.5 + Vector2(0, 10), Color(0.1, 0.1, 0.1, 0.6), 1.2)


func _draw_scale_bar(o: Control) -> void:
	var target_px := 160.0
	var m := target_px * m_per_unit
	var nice := 50.0
	for v in [50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0]:
		if v <= m:
			nice = v
	var w := nice / m_per_unit
	var p := Vector2(24, size.y - 30)
	o.draw_rect(Rect2(p - Vector2(8, 26), Vector2(w + 64, 40)), Color(0.97, 0.95, 0.9, 0.85))
	o.draw_rect(Rect2(p, Vector2(w * 0.5, 5)), Color(0.15, 0.14, 0.12))
	o.draw_rect(Rect2(p + Vector2(w * 0.5, 0), Vector2(w * 0.5, 5)), Color(0.97, 0.95, 0.9))
	o.draw_rect(Rect2(p, Vector2(w, 5)), Color(0.15, 0.14, 0.12), false, 1.0)
	var label := ("%d km" % int(nice / 1000.0)) if nice >= 1000.0 else "%d m" % int(nice)
	_label(o, "0", p + Vector2(0, -6), 13, Color(0.15, 0.14, 0.12), UITheme.mono_font(), true)
	_label(o, label, p + Vector2(w, -6), 13, Color(0.15, 0.14, 0.12), UITheme.mono_font(), true)


func _draw_north(o: Control) -> void:
	var c := Vector2(size.x - 40, 52)
	o.draw_circle(c, 24.0, Color(0.97, 0.95, 0.9, 0.85))
	o.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -18), c + Vector2(7, 8), c + Vector2(0, 3)]), Color(0.15, 0.14, 0.12))
	o.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -18), c + Vector2(-7, 8), c + Vector2(0, 3)]), Color(0.45, 0.42, 0.38))
	_label(o, "N", c + Vector2(0, -26), 15, Color(0.15, 0.14, 0.12), _font_caps, true)


func _label(o: Control, t: String, pos: Vector2, fs: int, col: Color, f: Font, centered: bool) -> void:
	if t == "" or f == null:
		return
	var ts := f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var p := pos
	if centered:
		p.x -= ts.x * 0.5
	o.draw_string_outline(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 5, Color(0.97, 0.95, 0.9, 0.9))
	o.draw_string(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


class_name HUDCompass
extends Control
## Compass strip (top centre): bearing ticks every 5°, cardinal + intercardinal letters, degree numbers,
## discovered POI markers (icon, with distance near the centre) and the tracked objective marker (amber,
## pinned to the strip edge when behind you). Fades towards both ends. Redraws only when something moved.
## Bearing: 0° = north (−Z), 90° = east (+X).

const SPAN_DEG := 150.0          # visible range across the strip
const LETTERS := {0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW"}
const STRIP_H := 30.0

var bearing := 0.0               # degrees
## [{bearing: float, distance: float, icon: String, label: String}]
var markers: Array[Dictionary] = []
## {bearing, distance} or {} when no objective location
var objective := {}

var _font: Font
var _font_caps: Font
var _font_mono: Font
var _last_hash := 0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = UITheme.font("Regular")
	_font_caps = UITheme.caps_font("SemiBold", 1)
	_font_mono = UITheme.mono_font()
	custom_minimum_size = Vector2(620, 64)


static func bearing_of(v: Vector3) -> float:
	return fposmod(rad_to_deg(atan2(v.x, -v.z)), 360.0)


static func delta_deg(a: float, b: float) -> float:
	return wrapf(a - b, -180.0, 180.0)


func set_state(b: float, mk: Array[Dictionary], obj: Dictionary) -> void:
	set_markers(mk, obj)
	set_bearing(b)


## Every frame: redraw only when the view turned noticeably.
func set_bearing(b: float) -> void:
	if absf(HUDCompass.delta_deg(b, bearing)) > 0.05:
		bearing = b
		queue_redraw()


## ~10 Hz: places and the objective.
func set_markers(mk: Array[Dictionary], obj: Dictionary) -> void:
	var h := hash([mk.size(), snappedf(float(obj.get("bearing", -1.0)), 0.2), int(float(obj.get("distance", 0.0)) / 10.0)])
	for m in mk:
		h = hash([h, snappedf(float(m["bearing"]), 0.2), int(float(m.get("distance", 0.0)) / 10.0)])
	markers = mk
	objective = obj
	if h != _last_hash:
		_last_hash = h
		queue_redraw()


func _x_for(deg_off: float) -> float:
	return size.x * 0.5 + deg_off / SPAN_DEG * size.x


func _edge_alpha(x: float) -> float:
	var t := absf(x - size.x * 0.5) / (size.x * 0.5)
	return clampf(1.0 - smoothstep(0.62, 1.0, t), 0.0, 1.0)


func _draw() -> void:
	var w := size.x
	var base_y := STRIP_H
	var shadow := Color(0, 0, 0, 0.38)
	# faint baseline
	var steps := 24
	for i in steps:
		var x0 := w * i / steps
		var x1 := w * (i + 1) / steps
		var a := _edge_alpha((x0 + x1) * 0.5)
		draw_line(Vector2(x0, base_y), Vector2(x1, base_y), Color(1, 1, 1, 0.22 * a), 1.0)
	# ticks
	var start := int(floorf((bearing - SPAN_DEG * 0.5) / 5.0)) * 5
	var end := int(ceilf((bearing + SPAN_DEG * 0.5) / 5.0)) * 5
	for d in range(start, end + 1, 5):
		var off := d - bearing
		var x := _x_for(off)
		if x < 0.0 or x > w:
			continue
		var a := _edge_alpha(x)
		if a <= 0.01:
			continue
		var deg := posmod(d, 360)
		var major := deg % 45 == 0
		var mid := deg % 15 == 0
		var h := 12.0 if major else (8.0 if mid else 4.0)
		var col := Color(1, 1, 1, (0.9 if major else 0.55) * a)
		draw_line(Vector2(x + 1, base_y - h + 1), Vector2(x + 1, base_y + 1), Color(shadow.r, shadow.g, shadow.b, shadow.a * a), 1.5)
		draw_line(Vector2(x, base_y - h), Vector2(x, base_y), col, 1.5 if major else 1.0)
		if major:
			var letter: String = LETTERS[deg]
			var fs := 22 if letter.length() == 1 else 16
			var cc := UITheme.TEXT if deg != 0 else UITheme.ACCENT.lightened(0.1)
			_text(letter, Vector2(x, base_y - 16.0), fs, Color(cc.r, cc.g, cc.b, a), _font_caps, true)
		elif mid:
			_text(str(deg), Vector2(x, base_y - 12.0), 13, Color(1, 1, 1, 0.5 * a), _font_mono, true)
	# POI markers
	for m in markers:
		var off2 := delta_deg(float(m["bearing"]), bearing)
		if absf(off2) > SPAN_DEG * 0.5:
			continue
		var x2 := _x_for(off2)
		var a2 := _edge_alpha(x2)
		var tex := UITheme.icon(String(m.get("icon", "poi")))
		var s := 18.0
		var y := base_y + 6.0
		if tex:
			draw_texture_rect(tex, Rect2(Vector2(x2 - s * 0.5 + 1, y + 1), Vector2(s, s)), false, Color(0, 0, 0, 0.4 * a2))
			draw_texture_rect(tex, Rect2(Vector2(x2 - s * 0.5, y), Vector2(s, s)), false, Color(UITheme.DISCOVERY.r, UITheme.DISCOVERY.g, UITheme.DISCOVERY.b, 0.9 * a2))
		if absf(off2) < 9.0:
			var near_a := a2 * (1.0 - absf(off2) / 9.0)
			var label := String(m.get("label", ""))
			var dist := float(m.get("distance", 0.0))
			var txt := "%s  %s" % [label, _dist(dist)] if label != "" else _dist(dist)
			_text(txt, Vector2(x2, y + s + 16.0), 15, Color(1, 1, 1, 0.85 * near_a), _font, true)
	# objective marker (pinned at the edge when out of range)
	if not objective.is_empty():
		var off3 := delta_deg(float(objective["bearing"]), bearing)
		var pinned := absf(off3) > SPAN_DEG * 0.5 - 6.0
		off3 = clampf(off3, -SPAN_DEG * 0.5 + 6.0, SPAN_DEG * 0.5 - 6.0)
		var x3 := _x_for(off3)
		var c := Vector2(x3, base_y + 14.0)
		var r := 7.0
		var pts := PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)])
		draw_colored_polygon(PackedVector2Array([pts[0] + Vector2(1, 1), pts[1] + Vector2(1, 1), pts[2] + Vector2(1, 1), pts[3] + Vector2(1, 1)]), Color(0, 0, 0, 0.4))
		draw_colored_polygon(pts, UITheme.ACCENT)
		if pinned:
			var dir := signf(off3)
			draw_polyline(PackedVector2Array([c + Vector2(dir * 11, -5), c + Vector2(dir * 16, 0), c + Vector2(dir * 11, 5)]), UITheme.ACCENT, 2.0, true)
		elif absf(off3) < 12.0:
			_text(_dist(float(objective.get("distance", 0.0))), c + Vector2(0, 24), 15, Color(UITheme.ACCENT.r, UITheme.ACCENT.g, UITheme.ACCENT.b, 0.95), _font_mono, true)
	# centre notch + bearing readout
	var cx := w * 0.5
	draw_colored_polygon(PackedVector2Array([Vector2(cx - 5, base_y + 2), Vector2(cx + 5, base_y + 2), Vector2(cx, base_y + 8)]), UITheme.ACCENT)
	_text("%03d°" % (roundi(bearing) % 360), Vector2(cx, base_y + 26.0), 15, Color(1, 1, 1, 0.75), _font_mono, true)


func _dist(m: float) -> String:
	if m >= 1000.0:
		return "%.1f km" % (m / 1000.0)
	return "%d m" % (roundi(m / 10.0) * 10 if m > 100.0 else roundi(m))


func _text(t: String, pos: Vector2, fs: int, col: Color, f: Font, centered: bool) -> void:
	if f == null:
		return
	var ts := f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var p := pos - Vector2(ts.x * 0.5 if centered else 0.0, 0.0)
	draw_string_outline(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.35 * col.a))
	draw_string(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)

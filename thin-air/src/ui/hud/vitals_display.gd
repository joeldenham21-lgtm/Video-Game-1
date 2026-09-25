class_name HUDVitals
extends Control
## Minimal segmented ring gauges for health, food, water, warmth, oxygen, stamina (DESIGN §8: vitals only
## appear when not full or changing). Each ring fades in when its meter is below full, moving, or low;
## steady non-urgent meters sit dimmed; low meters turn amber, critical ones red and pulse. A small chevron
## shows the trend (warmth falling, oxygen recovering…). Health shows max-health lost to frostbite as a dark
## red sector. Oxygen appears only above OXYGEN_ALTITUDE or when not full. Hidden rings collapse smoothly.

const METERS: Array[StringName] = [&"health", &"food", &"water", &"warmth", &"oxygen", &"stamina"]
const NAMES := {&"health": "Health", &"food": "Food", &"water": "Water", &"warmth": "Warmth",
	&"oxygen": "Oxygen", &"stamina": "Stamina"}
const WARN_AT := {&"health": 35.0, &"food": 25.0, &"water": 25.0, &"warmth": 35.0, &"oxygen": 60.0, &"stamina": 25.0}
const CRIT_AT := {&"health": 18.0, &"food": 8.0, &"water": 8.0, &"warmth": 15.0, &"oxygen": 40.0, &"stamina": 6.0}
const OXYGEN_ALTITUDE := 2600.0
const RING_R := 23.0
const RING_W := 4.0
const SEGMENTS := 20
const PITCH := 64.0
const HIDE_DELAY := 3.0

var values := {}          # meter -> current value (0..100)
var max_health := 100.0
var altitude := 0.0
var exhausted := false
var force_all := false    # QA / tests: show every ring

var _alpha := {}          # meter -> displayed alpha
var _x := {}              # meter -> displayed x offset
var _rate := {}           # meter -> smoothed rate (/s)
var _prev := {}
var _hide_t := {}
var _time := 0.0
var _any_visible := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	for m in METERS:
		values[m] = 100.0
		_alpha[m] = 0.0
		_x[m] = 0.0
		_rate[m] = 0.0
		_prev[m] = 100.0
		_hide_t[m] = 0.0
	custom_minimum_size = Vector2(PITCH * METERS.size(), RING_R * 2.0 + 18.0)


## Feed from the player's Vitals (HUD calls this at ~10 Hz with dt since the last call).
func sample(v: Object, alt: float, dt: float) -> void:
	if v == null:
		return
	altitude = alt
	max_health = float(v.get("max_health")) if v.get("max_health") != null else 100.0
	for m in METERS:
		var val := float(v.get(m)) if v.get(m) != null else 100.0
		var prev := float(_prev[m])
		if dt > 0.0:
			var r := (val - prev) / dt
			_rate[m] = lerpf(float(_rate[m]), r, clampf(dt * 1.5, 0.0, 1.0))
		_prev[m] = val
		values[m] = val
	exhausted = v.has_method("has_effect") and bool(v.call("has_effect", &"exhausted"))


## 0 hidden · 0.55 steady/not full · 1 urgent. Pure function (tests).
func wanted_alpha(m: StringName) -> float:
	if force_all:
		return 1.0
	var val := float(values.get(m, 100.0))
	var full := (max_health if m == &"health" else 100.0) - 0.6
	var moving := absf(float(_rate.get(m, 0.0))) > 0.12
	if m == &"oxygen" and altitude < OXYGEN_ALTITUDE and val >= full:
		return 0.0
	if val <= float(WARN_AT[m]) or (m == &"stamina" and exhausted):
		return 1.0
	if moving:
		return 1.0 if m != &"stamina" else 0.8
	if val < full:
		return 0.55
	return 0.0


func is_critical(m: StringName) -> bool:
	return float(values.get(m, 100.0)) <= float(CRIT_AT[m])


func color_for(m: StringName) -> Color:
	var val := float(values.get(m, 100.0))
	if val <= float(CRIT_AT[m]):
		return UITheme.CRITICAL
	if m == &"oxygen":
		return UITheme.OXYGEN
	if val <= float(WARN_AT[m]) or (m == &"stamina" and exhausted):
		return UITheme.WARNING
	if m == &"warmth" and val < 60.0:
		return UITheme.TEXT.lerp(UITheme.COLD, 0.55)
	return UITheme.TEXT


func any_visible() -> bool:
	return _any_visible


func _process(delta: float) -> void:
	_time += delta
	var k := clampf(delta * 6.0, 0.0, 1.0)
	var slot := 0
	var redraw := false
	_any_visible = false
	for m in METERS:
		var want := wanted_alpha(m)
		if want > 0.0:
			_hide_t[m] = HIDE_DELAY
		elif float(_hide_t[m]) > 0.0:
			_hide_t[m] = float(_hide_t[m]) - delta
			want = minf(float(_alpha[m]), 0.55)
		var a := float(_alpha[m])
		var na := move_toward(a, want, delta * (4.0 if want > a else 1.6))
		if absf(na - a) > 0.0005:
			redraw = true
		_alpha[m] = na
		var target_x := slot * PITCH
		if na > 0.02:
			slot += 1
			_any_visible = true
		var x := float(_x[m])
		var nx := lerpf(x, target_x, k) if na > 0.02 else target_x
		if absf(nx - x) > 0.05:
			redraw = true
		_x[m] = nx
		if na > 0.02 and (is_critical(m) or absf(float(_rate[m])) > 0.12):
			redraw = true
	if redraw:
		queue_redraw()


func _draw() -> void:
	var cy := RING_R + 2.0
	for m in METERS:
		var a := float(_alpha[m])
		if a <= 0.02:
			continue
		var c := Vector2(float(_x[m]) + RING_R + 2.0, cy)
		var col := color_for(m)
		var crit := is_critical(m)
		var scale_k := 1.0
		if crit:
			var p := 0.5 + 0.5 * sin(_time * TAU * 1.3)
			a *= 0.7 + 0.3 * p
			scale_k = 1.0 + 0.05 * p
		_draw_ring(c, m, col, a, scale_k)
		var tex := UITheme.icon(String(m))
		if tex:
			var s := 20.0 * scale_k
			draw_texture_rect(tex, Rect2(c - Vector2(s, s) * 0.5, Vector2(s, s)), false, Color(col.r, col.g, col.b, a))
		# trend chevron under the ring
		var rate := float(_rate[m])
		if absf(rate) > 0.12 and m != &"stamina":
			var up := rate > 0.0
			var y0 := c.y + RING_R + 9.0
			var w := 5.0
			var ch := 3.5 * (1.0 if up else -1.0)
			var tc := Color(col.r, col.g, col.b, a * clampf(absf(rate) / 0.6, 0.45, 1.0))
			draw_polyline(PackedVector2Array([Vector2(c.x - w, y0 + ch * 0.5), Vector2(c.x, y0 - ch * 0.5),
				Vector2(c.x + w, y0 + ch * 0.5)]), tc, 1.6, true)


func _draw_ring(c: Vector2, m: StringName, col: Color, a: float, scale_k: float) -> void:
	var r := RING_R * scale_k
	var val := clampf(float(values[m]), 0.0, 100.0) / 100.0
	var cap := 1.0
	if m == &"health":
		cap = clampf(max_health / 100.0, 0.0, 1.0)
	var seg := TAU / SEGMENTS
	var gap := 0.075
	# backing disc for legibility over bright snow
	draw_circle(c, r + RING_W * 0.5 + 3.0, Color(0.02, 0.025, 0.03, 0.34 * a))
	for i in SEGMENTS:
		var f0 := float(i) / SEGMENTS
		var f1 := float(i + 1) / SEGMENTS
		var a0 := -PI * 0.5 + i * seg + gap * 0.5
		var a1 := a0 + seg - gap
		var sc := Color(col.r, col.g, col.b, 0.16 * a)
		if f0 >= cap:
			sc = Color(0.55, 0.12, 0.1, 0.55 * a)       # max health lost (frostbite)
		elif f1 <= val + 0.0001:
			sc = Color(col.r, col.g, col.b, 0.95 * a)
		elif f0 < val:
			# partial segment: split
			var am := a0 + (a1 - a0) * ((val - f0) / (f1 - f0))
			draw_arc(c, r, a0, am, 6, Color(col.r, col.g, col.b, 0.95 * a), RING_W, true)
			draw_arc(c, r, am, a1, 6, sc, RING_W, true)
			continue
		draw_arc(c, r, a0, a1, 6, sc, RING_W, true)

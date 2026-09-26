class_name HUDToasts
extends VBoxContainer
## Notification toasts (Events.notification). Newest on top, at most MAX visible, each fades after a
## reading-time-based delay. Kinds: info, item, warning, objective, discovery, blueprint (+ critical).
## Repeated item pickups merge ("+1 Stick" twice → "+2 Stick"); identical messages refresh instead of stacking.

const MAX := 5
const KINDS := {
	&"info": ["info", Color(0.72, 0.76, 0.8)],
	&"item": ["item", Color(0.9, 0.92, 0.93)],
	&"warning": ["warning", InvStyle.WARN],
	&"objective": ["objective", InvStyle.ACCENT],
	&"discovery": ["discovery", Color(0.95, 0.86, 0.62)],
	&"blueprint": ["blueprint", Color(0.55, 0.78, 0.95)],
	&"critical": ["warning", Color(0.92, 0.3, 0.26)],
	&"save": ["save", Color(0.49, 0.78, 0.55)],
}

var _items: Array[Dictionary] = []    # {root, label, text, kind, t, life, count, name}
var _re_item := RegEx.new()


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_re_item.compile("^\\+(\\d+) (.+)$")


func push(text: String, kind: StringName = &"info") -> void:
	if text.strip_edges() == "":
		return
	if not KINDS.has(kind):
		kind = &"info"
	# merge item pickups / refresh duplicates
	var m := _re_item.search(text) if kind == &"item" else null
	for it in _items:
		if it["kind"] != kind or float(it["t"]) > float(it["life"]) - 0.4:
			continue
		if m and it.get("name", "") == m.get_string(2):
			it["count"] = int(it["count"]) + int(m.get_string(1))
			(it["label"] as Label).text = "+%d %s" % [it["count"], it["name"]]
			it["t"] = 0.0
			_bump(it["root"])
			return
		if it["text"] == text:
			it["t"] = 0.0
			_bump(it["root"])
			return
	var info: Array = KINDS[kind]
	var col: Color = info[1]
	var panel := PanelContainer.new()
	var sb := UITheme.panel(Color(0.04, 0.05, 0.06, 0.72), 5, Color(1, 1, 1, 0.07), 1, 0)
	sb.content_margin_left = 14
	sb.content_margin_right = 16
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	sb.border_width_left = 3
	sb.border_color = Color(col.r, col.g, col.b, 0.85)
	panel.add_theme_stylebox_override("panel", sb)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var row := UITheme.hbox(12)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(row)
	var ic := UITheme.icon_rect(String(info[0]), 22.0, col)
	ic.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(ic)
	var lab := UITheme.label(text, UITheme.FS_BODY - 1, UITheme.TEXT, "Regular")
	lab.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lab.custom_minimum_size.x = 320
	lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(lab)
	add_child(panel)
	move_child(panel, 0)
	var life := clampf(3.2 + text.length() * 0.045, 3.5, 8.0)
	if kind == &"warning" or kind == &"critical" or kind == &"objective":
		life += 1.0
	var entry := {"root": panel, "label": lab, "text": text, "kind": kind, "t": 0.0, "life": life, "count": 0, "name": ""}
	if m:
		entry["count"] = int(m.get_string(1))
		entry["name"] = m.get_string(2)
	_items.push_front(entry)
	panel.modulate.a = 0.0
	var tw := panel.create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(panel, "modulate:a", 1.0, 0.25)
	while _items.size() > MAX:
		var old: Dictionary = _items.pop_back()
		(old["root"] as Control).queue_free()


func _bump(c: Control) -> void:
	c.modulate = Color(1.25, 1.25, 1.25, 1.0)
	var tw := c.create_tween()
	tw.tween_property(c, "modulate", Color(1, 1, 1, 1), 0.35)


func count() -> int:
	return _items.size()


func clear() -> void:
	for it in _items:
		(it["root"] as Control).queue_free()
	_items.clear()


func _process(delta: float) -> void:
	var i := _items.size() - 1
	while i >= 0:
		var it: Dictionary = _items[i]
		var t := float(it["t"]) + delta
		it["t"] = t
		var life := float(it["life"])
		var root: Control = it["root"]
		if t > life:
			var a := 1.0 - (t - life) / 0.5
			if a <= 0.0:
				root.queue_free()
				_items.remove_at(i)
			else:
				root.modulate.a = a
		i -= 1

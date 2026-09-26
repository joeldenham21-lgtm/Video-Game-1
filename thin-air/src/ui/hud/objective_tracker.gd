class_name HUDObjectives
extends VBoxContainer
## Objective tracker (top right). Shows open objectives (at most MAX_SHOWN), newest first. A new objective
## slides in highlighted with a "NEW OBJECTIVE" caption; a completed one ticks, dims and leaves after a
## moment. The block settles to a lower opacity when nothing has changed for a while.

const MAX_SHOWN := 3
const IDLE_ALPHA := 0.7
const IDLE_AFTER := 12.0

var _rows := {}           # id -> {root, label, mark, done_t}
var left_aligned := false
var _order: Array[StringName] = []
var _header: Label
var _idle := 0.0


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	alignment = BoxContainer.ALIGNMENT_BEGIN
	_header = UITheme.caps("Objectives", 13, UITheme.TEXT_DIM, 3)
	_header.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.35))
	_header.add_theme_constant_override("outline_size", 4)
	_header.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	add_child(_header)
	_header.visible = false


## Rebuild from Story.objectives ([{id, text, done}]) without animation (load / scene start).
func sync_from(objectives: Array) -> void:
	for id in _rows.keys():
		(_rows[id]["root"] as Control).queue_free()
	_rows.clear()
	_order.clear()
	for o in objectives:
		if not bool(o.get("done", false)):
			_add_row(StringName(o.get("id", "")), String(o.get("text", "")), false)
	_relayout()


func add_objective(id: StringName, text: String) -> void:
	if _rows.has(id):
		return
	_add_row(id, text, true)
	_relayout()
	_idle = 0.0


func complete_objective(id: StringName) -> void:
	if not _rows.has(id):
		return
	var r: Dictionary = _rows[id]
	if float(r["done_t"]) >= 0.0:
		return
	r["done_t"] = 0.0
	var mark: TextureRect = r["mark"]
	mark.texture = UITheme.icon("check")
	mark.modulate = UITheme.GOOD
	var lab: Label = r["label"]
	lab.add_theme_color_override("font_color", UITheme.TEXT_DIM)
	_idle = 0.0


## Touch layout puts the tracker on the left: flip the alignment of every row.
func set_left_aligned(on: bool) -> void:
	left_aligned = on
	_header.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if on else HORIZONTAL_ALIGNMENT_RIGHT
	for id in _rows:
		_apply_align(_rows[id])


func _apply_align(r: Dictionary) -> void:
	var lab: Label = r["label"]
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if left_aligned else HORIZONTAL_ALIGNMENT_RIGHT
	var row: HBoxContainer = lab.get_parent()
	row.alignment = BoxContainer.ALIGNMENT_BEGIN if left_aligned else BoxContainer.ALIGNMENT_END
	var mark: Control = r["mark"]
	row.move_child(mark, 0 if left_aligned else row.get_child_count() - 1)
	var cap: Label = r.get("cap")
	if cap and is_instance_valid(cap):
		cap.horizontal_alignment = lab.horizontal_alignment


func open_count() -> int:
	var n := 0
	for id in _rows:
		if float(_rows[id]["done_t"]) < 0.0:
			n += 1
	return n


func _add_row(id: StringName, text: String, animate: bool) -> void:
	var root := UITheme.vbox(0)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cap: Label = null
	if animate:
		cap = UITheme.caps("New objective", 12, UITheme.ACCENT, 3)
		cap.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		cap.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.35))
		cap.add_theme_constant_override("outline_size", 4)
		root.add_child(cap)
	var row := UITheme.hbox(10)
	row.alignment = BoxContainer.ALIGNMENT_END
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(row)
	var lab := UITheme.hud_label(text, UITheme.FS_BODY - 1, UITheme.TEXT, "Regular")
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	lab.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lab.custom_minimum_size.x = 300
	row.add_child(lab)
	var mark := UITheme.icon_rect("poi", 14.0, UITheme.ACCENT)
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(mark)
	add_child(root)
	move_child(root, 1)
	_rows[id] = {"root": root, "label": lab, "mark": mark, "done_t": -1.0, "cap": cap, "cap_t": 6.0}
	_apply_align(_rows[id])
	_order.push_front(id)
	if animate:
		root.modulate = Color(1.4, 1.3, 1.1, 0.0)
		var tw := root.create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tw.tween_property(root, "modulate", Color(1, 1, 1, 1), 0.6)


func _relayout() -> void:
	var shown := 0
	for id in _order:
		var r: Dictionary = _rows[id]
		var vis := shown < MAX_SHOWN
		(r["root"] as Control).visible = vis
		if vis:
			shown += 1
	_header.visible = shown > 0


func _process(delta: float) -> void:
	_idle += delta
	var target := 1.0 if _idle < IDLE_AFTER else IDLE_ALPHA
	modulate.a = move_toward(modulate.a, target, delta * 0.8)
	var removed := false
	for id in _rows.keys():
		var r: Dictionary = _rows[id]
		var cap: Label = r["cap"]
		if cap:
			r["cap_t"] = float(r["cap_t"]) - delta
			if float(r["cap_t"]) <= 0.0:
				cap.queue_free()
				r["cap"] = null
		var dt := float(r["done_t"])
		if dt >= 0.0:
			dt += delta
			r["done_t"] = dt
			var root: Control = r["root"]
			if dt > 3.0:
				root.modulate.a = maxf(0.0, 1.0 - (dt - 3.0) / 0.8)
			if dt > 3.8:
				root.queue_free()
				_rows.erase(id)
				_order.erase(id)
				removed = true
	if removed:
		_relayout()

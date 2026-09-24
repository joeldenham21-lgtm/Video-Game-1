class_name ItemSlot
extends Button
## One inventory / equipment / hotbar slot. Draws the item icon, stack count, durability and hotkey;
## supports mouse drag & drop, double-click / right-click quick use, shift-click quick transfer, touch taps and
## focus-driven gamepad navigation. The screen owns all logic; slots only report intent through signals.

signal selected(slot: ItemSlot)
signal activated(slot: ItemSlot)
signal quick_transfer(slot: ItemSlot)
signal split_requested(slot: ItemSlot)
signal dropped_on(from: ItemSlot, to: ItemSlot)

enum Kind { INV, EQUIP, HOTBAR }

var kind: Kind = Kind.INV
var inventory: Inventory = null
var index := -1
var equip_slot: StringName = &""
var stack: Dictionary = {}
var hotkey := ""
var empty_label := ""
var is_selected := false
var is_target := false
var dimmed := false

var _hover := false
var _styles: Array[StyleBoxFlat] = []


func _init() -> void:
	focus_mode = Control.FOCUS_ALL
	toggle_mode = false
	clip_contents = false
	mouse_filter = Control.MOUSE_FILTER_STOP
	for i in 5:
		_styles.append(InvStyle.slot_box(i))
	_apply_style()


func _ready() -> void:
	focus_entered.connect(_on_focus)
	mouse_entered.connect(func() -> void:
		_hover = true
		_apply_style())
	mouse_exited.connect(func() -> void:
		_hover = false
		_apply_style())
	pressed.connect(func() -> void: selected.emit(self))


func set_stack(s: Dictionary) -> void:
	stack = s
	tooltip_text = "" if s.is_empty() else ItemInfo.name_of(s["id"])
	queue_redraw()


func item_id() -> StringName:
	return StringName(stack.get("id", &"")) if not stack.is_empty() else &""


func set_selected(v: bool) -> void:
	if is_selected != v:
		is_selected = v
		_apply_style()


func set_target(v: bool) -> void:
	if is_target != v:
		is_target = v
		_apply_style()


func _apply_style() -> void:
	var st := 0
	if is_target:
		st = 3
	elif is_selected:
		st = 2
	elif _hover:
		st = 1
	var sb := _styles[st]
	add_theme_stylebox_override("normal", sb)
	add_theme_stylebox_override("hover", _styles[2] if is_selected else (_styles[3] if is_target else _styles[1]))
	add_theme_stylebox_override("pressed", _styles[2])
	add_theme_stylebox_override("focus", _styles[2])
	add_theme_stylebox_override("disabled", _styles[4])
	queue_redraw()


func _on_focus() -> void:
	selected.emit(self)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.double_click:
			activated.emit(self)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and mb.shift_pressed:
			quick_transfer.emit(self)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT and mb.ctrl_pressed:
			split_requested.emit(self)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			grab_focus()
			selected.emit(self)
			activated.emit(self)
			accept_event()


# ---------------------------------------------------------------------------------------------- drawing

func _draw() -> void:
	var r := Rect2(Vector2.ZERO, size)
	var pad := size.x * 0.1
	if stack.is_empty():
		if empty_label != "":
			var f := InvStyle.caps_font("SemiBold", 1)
			var fs := int(clampf(size.x * 0.13, 10, 15))
			var w := f.get_string_size(empty_label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			draw_string(f, Vector2((size.x - w) * 0.5, size.y * 0.5 + fs * 0.35), empty_label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, InvStyle.TEXT_FAINT)
		_draw_hotkey()
		return
	var id := item_id()
	var tex := ItemDB.get_icon(id)
	if tex:
		var icon_rect := Rect2(r.position + Vector2(pad, pad * 0.8), r.size - Vector2(pad * 2.0, pad * 2.0))
		draw_texture_rect(tex, icon_rect, false, Color(1, 1, 1, 0.45 if dimmed else 1.0))
	var n := int(stack.get("count", 1))
	if n > 1:
		var f := InvStyle.font("Mono")
		var fs := int(clampf(size.x * 0.19, 13, 22))
		var txt := str(n)
		var w := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		var p := Vector2(size.x - w - pad * 0.55, size.y - pad * 0.55)
		draw_string_outline(f, p, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 5, Color(0, 0, 0, 0.75))
		draw_string(f, p, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, InvStyle.TEXT)
	var dur := float(stack.get("durability", 1.0))
	if dur < 0.995 and _has_durability(id):
		var bw := size.x - pad * 1.6
		var bh := maxf(3.0, size.y * 0.035)
		var bp := Vector2(pad * 0.8, size.y - bh - pad * 0.35)
		draw_rect(Rect2(bp, Vector2(bw, bh)), Color(0, 0, 0, 0.55))
		draw_rect(Rect2(bp, Vector2(bw * clampf(dur, 0.0, 1.0), bh)), InvStyle.durability_color(dur))
	_draw_hotkey()


func _draw_hotkey() -> void:
	if hotkey == "":
		return
	var f := InvStyle.font("Mono")
	var fs := int(clampf(size.x * 0.15, 11, 17))
	draw_string(f, Vector2(size.x * 0.09, fs + size.y * 0.05), hotkey, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, InvStyle.TEXT_DIM)


static func _has_durability(id: StringName) -> bool:
	var d := ItemDB.get_item(id)
	var t: Variant = d.get("tool", null)
	if t is Dictionary and int((t as Dictionary).get("durability", 0)) > 1:
		return true
	return d.has("ignite") and float((d["ignite"] as Dictionary).get("wear", 0.0)) > 0.0


# ---------------------------------------------------------------------------------------------- drag & drop

func _get_drag_data(_at: Vector2) -> Variant:
	if stack.is_empty():
		return null
	var tex := ItemDB.get_icon(item_id())
	var prev := TextureRect.new()
	prev.texture = tex
	prev.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	prev.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	prev.size = size * 0.9
	prev.position = -size * 0.45
	prev.modulate = Color(1, 1, 1, 0.85)
	prev.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	var holder := Control.new()
	holder.add_child(prev)
	set_drag_preview(holder)
	return {"thin_air_slot": self}


func _can_drop_data(_at: Vector2, data: Variant) -> bool:
	if not (data is Dictionary) or not (data as Dictionary).has("thin_air_slot"):
		return false
	var from: ItemSlot = data["thin_air_slot"]
	if from == self or from == null:
		return false
	var ok := accepts(from.item_id())
	set_target(ok)
	return ok


func _drop_data(_at: Vector2, data: Variant) -> void:
	set_target(false)
	var from: ItemSlot = data["thin_air_slot"]
	dropped_on.emit(from, self)


func _notification(what: int) -> void:
	if what == NOTIFICATION_DRAG_END or what == NOTIFICATION_MOUSE_EXIT:
		if is_target:
			set_target(false)


## Whether an item may be placed in this slot.
func accepts(id: StringName) -> bool:
	if id == &"":
		return false
	match kind:
		Kind.EQUIP:
			return StringName(ItemDB.get_item(id).get("equip_slot", "")) == equip_slot
		Kind.HOTBAR:
			return ItemInfo.is_holdable(id) or ItemInfo.is_consumable(id) or ItemDB.get_item(id).has("light")
	return true

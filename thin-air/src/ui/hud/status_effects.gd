class_name HUDStatusEffects
extends HBoxContainer
## Status effect icons (wet, bleeding, sprain, frostbite, hypoxic, sick, well_fed, warmed_up, rested, …).
## Each has a tooltip; when an effect starts its name shows beside the icon for a few seconds, so it reads
## without hovering. Negative effects are amber, dangerous ones red, beneficial ones a soft green.

const INFO := {
	&"wet": ["Wet", "wet", 1, "Losing heat fast. Dry off by a fire or in shelter."],
	&"bleeding": ["Bleeding", "bleeding", 2, "Losing health. Apply a bandage."],
	&"sprain": ["Sprain", "sprain", 1, "Moving slower. A splint or rest helps."],
	&"frostbite": ["Frostbite", "frostbite", 2, "Maximum health reduced. Get warm and stay warm."],
	&"hypoxic": ["Hypoxic", "hypoxic", 2, "Not enough oxygen. Descend, rest, or breathe bottled oxygen."],
	&"hypothermia": ["Hypothermia", "hypothermia", 2, "Body temperature falling. Find heat now."],
	&"sick": ["Sick", "sick", 1, "Food poisoning or bad water. Rest and drink boiled water."],
	&"exhausted": ["Exhausted", "exhausted", 1, "Out of breath. Stop and recover."],
	&"starving": ["Starving", "starving", 2, "No food left. Eat something."],
	&"dehydrated": ["Dehydrated", "dehydrated", 2, "No water left. Drink."],
	&"well_fed": ["Well fed", "well_fed", 0, "Better stamina recovery."],
	&"warmed_up": ["Warmed up", "warmed_up", 0, "You lose heat more slowly for a while."],
	&"rested": ["Rested", "rested", 0, "Slept well. Stamina recovers faster."],
	&"painkiller": ["Painkillers", "pill", 0, "Pain dulled. Sprains hurt less."],
	&"healing": ["Healing", "leaf", 0, "Wounds heal faster."],
}
const ORDER: Array[StringName] = [&"bleeding", &"hypothermia", &"hypoxic", &"frostbite", &"starving", &"dehydrated",
	&"wet", &"sick", &"sprain", &"exhausted", &"painkiller", &"healing", &"warmed_up", &"well_fed", &"rested"]
const LABEL_TIME := 4.0
const ICON := 26.0

var active: Array[StringName] = []
var _chips := {}        # id -> {root, icon, label, t}


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


static func tint_for(level: int) -> Color:
	match level:
		0: return UITheme.GOOD.lerp(UITheme.TEXT, 0.35)
		2: return UITheme.CRITICAL
	return UITheme.WARNING


static func display_name(id: StringName) -> String:
	return String(INFO[id][0]) if INFO.has(id) else String(id).capitalize()


## Sync with the Vitals' effects dictionary (ids → {time, strength}).
func sync(effects: Dictionary) -> void:
	var want: Array[StringName] = []
	for id in ORDER:
		if effects.has(id):
			want.append(id)
	for id in effects:
		var sid := StringName(id)
		if not want.has(sid) and INFO.has(sid):
			want.append(sid)
	if want == active:
		return
	for id in active:
		if not want.has(id):
			_remove(id)
	for id in want:
		if not _chips.has(id):
			_add(id)
	active = want
	for i in active.size():
		move_child(_chips[active[i]]["root"], i)


func _add(id: StringName) -> void:
	var info: Array = INFO.get(id, [String(id).capitalize(), "info", 1, ""])
	var col := tint_for(int(info[2]))
	var chip := HBoxContainer.new()
	chip.add_theme_constant_override("separation", 6)
	chip.mouse_filter = Control.MOUSE_FILTER_PASS
	chip.tooltip_text = "%s — %s" % [info[0], info[3]] if String(info[3]) != "" else String(info[0])
	var disc := Panel.new()
	disc.custom_minimum_size = Vector2(ICON + 10, ICON + 10)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.025, 0.03, 0.42)
	sb.set_corner_radius_all(int((ICON + 10) * 0.5))
	sb.border_color = Color(col.r, col.g, col.b, 0.55)
	sb.set_border_width_all(1)
	sb.anti_aliasing = true
	disc.add_theme_stylebox_override("panel", sb)
	disc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ic := UITheme.icon_rect(String(info[1]), ICON - 4.0, col)
	ic.position = Vector2(7, 7)
	disc.add_child(ic)
	chip.add_child(disc)
	var lab := UITheme.hud_label(String(info[0]), UITheme.FS_SMALL, col, "Medium")
	lab.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	chip.add_child(lab)
	add_child(chip)
	_chips[id] = {"root": chip, "label": lab, "t": LABEL_TIME}
	chip.modulate.a = 0.0
	var tw := chip.create_tween()
	tw.tween_property(chip, "modulate:a", 1.0, 0.3)


func _remove(id: StringName) -> void:
	var c: Dictionary = _chips.get(id, {})
	_chips.erase(id)
	if c.is_empty():
		return
	var root: Control = c["root"]
	var tw := root.create_tween()
	tw.tween_property(root, "modulate:a", 0.0, 0.35)
	tw.tween_callback(root.queue_free)


func _process(delta: float) -> void:
	for id in _chips:
		var c: Dictionary = _chips[id]
		var t := float(c["t"])
		if t > 0.0:
			t -= delta
			c["t"] = t
			var lab: Label = c["label"]
			if t <= 0.0:
				lab.visible = false
			elif t < 0.5:
				lab.modulate.a = t / 0.5

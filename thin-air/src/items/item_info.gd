class_name ItemInfo
extends RefCounted
## Display helpers for item data: names, category labels, formatted stats. Used by the inventory UI,
## interaction prompts and toasts so every surface describes items the same way.

const CATEGORY_LABELS := {
	"resource": "Material", "food": "Food", "drink": "Drink", "tool": "Tool", "weapon": "Weapon",
	"ammo": "Ammunition", "clothing": "Clothing", "medical": "Medical", "light": "Light", "fuel": "Fuel",
	"quest": "Key item", "placeable": "Placeable",
}

const SLOT_LABELS := {
	"head": "Head", "face": "Face", "body": "Body", "legs": "Legs", "hands": "Hands", "feet": "Feet",
	"back": "Back", "hand": "Hands (tool)", "feet_addon": "Crampons", "mask": "Oxygen mask",
}

const GEAR_LABELS := {
	"crampons": "Crampons", "ice_axe": "Ice axe", "o2_mask": "Oxygen mask", "goggles": "Goggles", "rope": "Rope",
}


static func name_of(id: StringName) -> String:
	var d := ItemDB.get_item(id)
	return String(d.get("name", String(id).capitalize()))


static func category_of(id: StringName) -> String:
	return String(ItemDB.get_item(id).get("category", "resource"))


static func category_label(cat: String) -> String:
	return String(CATEGORY_LABELS.get(cat, cat.capitalize()))


static func stack_text(id: StringName, count: int) -> String:
	return name_of(id) if count <= 1 else "%s ×%d" % [name_of(id), count]


static func format_weight(kg: float) -> String:
	if kg < 0.1:
		return "%d g" % roundi(kg * 1000.0)
	if kg < 10.0:
		return "%.1f kg" % kg
	return "%d kg" % roundi(kg)


## Game minutes → "45 min", "1 h 30 min", "6 h".
static func format_minutes(minutes: float) -> String:
	var m := roundi(minutes)
	if m < 60:
		return "%d min" % m
	var h := floori(m / 60.0)
	var r := m % 60
	return "%d h" % h if r == 0 else "%d h %02d min" % [h, r]


static func format_seconds(s: float) -> String:
	if s < 60.0:
		return "%d s" % ceili(s)
	return "%d:%02d" % [floori(s / 60.0), int(s) % 60]


## Verb for the primary action on an item ("" if none).
static func primary_action(id: StringName) -> String:
	var d := ItemDB.get_item(id)
	var cat := String(d.get("category", ""))
	if d.has("food"):
		return "Drink" if cat == "drink" else ("Eat" if cat == "food" else "Use")
	if d.has("medical"):
		return "Apply" if id != &"painkillers" else "Take"
	if d.has("read"):
		return "Read"
	var slot := wear_slot_of(d)
	if slot == &"hand":
		return "Hold"
	if slot != &"":
		return "Wear"
	return ""


## Equipment slot an item is worn in (&"" = not wearable, &"hand" = held tool). Besides the data's equip_slot,
## boot add-ons ("addon_slot": "feet", crampons) strap on in &"feet_addon" and an oxygen mask (gear o2_mask)
## goes in its own &"mask" slot so it can be worn together with goggles. Tools with a "tool" block but no
## equip_slot (the canteen) are held in the hands. Player.equip() and the inventory UI both use this.
static func wear_slot(id: StringName) -> StringName:
	return wear_slot_of(ItemDB.get_item(id))


static func wear_slot_of(d: Dictionary) -> StringName:
	if d.is_empty():
		return &""
	var addon := String(d.get("addon_slot", ""))
	var g: Variant = d.get("gear", [])
	if addon != "" or (g is Array and (g as Array).has("crampons")):
		return StringName((addon if addon != "" else "feet") + "_addon")
	if g is Array and (g as Array).has("o2_mask"):
		return &"mask"
	var slot := String(d.get("equip_slot", ""))
	if slot == "" and d.get("tool", null) is Dictionary and String((d["tool"] as Dictionary).get("type", "")) != "":
		return &"hand"
	return StringName(slot)


static func is_wearable(id: StringName) -> bool:
	var slot := wear_slot(id)
	return slot != &"" and slot != &"hand"


static func is_holdable(id: StringName) -> bool:
	return wear_slot(id) == &"hand"


static func is_consumable(id: StringName) -> bool:
	var d := ItemDB.get_item(id)
	return d.has("food") or d.has("medical")


## Stat rows for the detail pane: Array of {label: String, value: String, bar: float (-1 = no bar), good: bool}.
static func stat_rows(id: StringName) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var d := ItemDB.get_item(id)
	var t: Variant = d.get("tool", null)
	if t is Dictionary:
		var td: Dictionary = t
		_row(rows, "Damage", td.get("damage", 0), 50.0)
		_row(rows, "Chopping", td.get("chop", 0), 40.0)
		_row(rows, "Mining", td.get("mine", 0), 12.0)
		if float(td.get("range", 0)) >= 5.0:
			rows.append({"label": "Range", "value": "%d m" % int(td.get("range", 0)), "bar": -1.0, "good": true})
		if float(td.get("stamina", 0)) > 0.0:
			rows.append({"label": "Stamina / use", "value": "%s" % _num(td.get("stamina", 0)), "bar": -1.0, "good": false})
		if float(td.get("cooldown", 0)) > 0.0 and float(td.get("damage", 0)) > 0.0:
			rows.append({"label": "Swing time", "value": "%.2f s" % float(td.get("cooldown", 0)), "bar": -1.0, "good": true})
	var f: Variant = d.get("food", null)
	if f is Dictionary:
		var fd: Dictionary = f
		if int(fd.get("calories", 0)) > 0:
			rows.append({"label": "Energy", "value": "%d kcal" % int(fd.get("calories", 0)),
				"bar": clampf(float(fd.get("food", 0)) / 20.0, 0.0, 1.0), "good": true})
		_signed_row(rows, "Hydration", fd.get("water", 0))
		_signed_row(rows, "Warmth", fd.get("warmth", 0))
		_signed_row(rows, "Health", fd.get("health", 0))
		_signed_row(rows, "Stamina", fd.get("stamina", 0))
		if bool(fd.get("raw", false)) and float(fd.get("raw_risk", 0)) > 0.0:
			rows.append({"label": "Illness risk", "value": "%d%%" % roundi(float(fd.get("raw_risk", 0)) * 100.0),
				"bar": -1.0, "good": false})
		if float(fd.get("spoil_hours", 0)) > 0.0:
			var sh := float(fd.get("spoil_hours", 0))
			rows.append({"label": "Keeps", "value": ("%d days" % roundi(sh / 24.0)) if sh >= 48.0 else ("%d h" % roundi(sh)),
				"bar": -1.0, "good": true})
	var m: Variant = d.get("medical", null)
	if m is Dictionary:
		var md: Dictionary = m
		_signed_row(rows, "Health", md.get("health", 0))
		_signed_row(rows, "Warmth", md.get("warmth", 0))
		var stops: Array = md.get("stops", [])
		if not stops.is_empty():
			var names: PackedStringArray = []
			for s in stops:
				names.append(String(s).capitalize())
			rows.append({"label": "Treats", "value": ", ".join(names), "bar": -1.0, "good": true})
	var c: Variant = d.get("clothing", null)
	if c is Dictionary:
		var cd: Dictionary = c
		rows.append({"label": "Insulation", "value": "+%s °C" % _num(cd.get("insulation", 0)),
			"bar": clampf(float(cd.get("insulation", 0)) / 18.0, 0.0, 1.0), "good": true})
		rows.append({"label": "Windproof", "value": "%d%%" % roundi(float(cd.get("windproof", 0)) * 100.0),
			"bar": float(cd.get("windproof", 0)), "good": true})
		rows.append({"label": "Waterproof", "value": "%d%%" % roundi(float(cd.get("waterproof", 0)) * 100.0),
			"bar": float(cd.get("waterproof", 0)), "good": true})
	var carry: Variant = d.get("carry", null)
	if carry is Dictionary:
		rows.append({"label": "Capacity", "value": "%d slots · %d kg" % [int(carry.get("slots", 0)), int(carry.get("weight", 0))],
			"bar": -1.0, "good": true})
	var fuel: Variant = d.get("fuel", null)
	if fuel is Dictionary and float(fuel.get("burn_minutes", 0)) > 0.0:
		rows.append({"label": "Burn time", "value": format_minutes(float(fuel.get("burn_minutes", 0))),
			"bar": clampf(float(fuel.get("burn_minutes", 0)) / 90.0, 0.0, 1.0), "good": true})
	var light: Variant = d.get("light", null)
	if light is Dictionary:
		rows.append({"label": "Light radius", "value": "%d m" % int(light.get("radius", 0)), "bar": -1.0, "good": true})
		rows.append({"label": "Burns for", "value": format_minutes(float(light.get("burn_minutes", 0))), "bar": -1.0, "good": true})
	var ign: Variant = d.get("ignite", null)
	if ign is Dictionary:
		rows.append({"label": "Ignition", "value": "%d%%" % roundi(float(ign.get("chance", 0)) * 100.0),
			"bar": float(ign.get("chance", 0)), "good": true})
		if bool(ign.get("needs_tinder", false)):
			rows.append({"label": "Needs", "value": "Tinder", "bar": -1.0, "good": false})
	var o2: Variant = d.get("o2", null)
	if o2 is Dictionary:
		rows.append({"label": "Oxygen", "value": "%d min" % int(o2.get("minutes", 0)), "bar": -1.0, "good": true})
	var gear: Array = d.get("gear", [])
	if not gear.is_empty():
		var g: PackedStringArray = []
		for x in gear:
			g.append(String(GEAR_LABELS.get(String(x), String(x).capitalize())))
		rows.append({"label": "Gear", "value": ", ".join(g), "bar": -1.0, "good": true})
	return rows


static func _row(rows: Array[Dictionary], label: String, v: Variant, max_v: float) -> void:
	var f := float(v)
	if f <= 0.0:
		return
	rows.append({"label": label, "value": _num(f), "bar": clampf(f / max_v, 0.0, 1.0), "good": true})


static func _signed_row(rows: Array[Dictionary], label: String, v: Variant) -> void:
	var f := float(v)
	if is_zero_approx(f):
		return
	rows.append({"label": label, "value": ("+" if f > 0.0 else "−") + _num(absf(f)), "bar": -1.0, "good": f > 0.0})


static func _num(v: Variant) -> String:
	var f := float(v)
	if is_equal_approx(f, roundf(f)):
		return "%d" % roundi(f)
	return "%.1f" % f

class_name BuildDryingRack
extends BuildObject
## Pole rack for drying meat into jerky and curing raw hides (DESIGN §5). Strips and hides dry over game time
## (sleeping counts): faster in smoke and heat from a fire nearby, in wind, and slower when rain or snow falls
## on an unsheltered rack. Visible strips darken as they dry; a hide lightens.

const MEAT_SLOTS := 6
## item -> [result, hours to dry in good conditions]
const RECIPES := {
	&"meat_raw": [&"meat_dried", 10.0],
	&"hide_raw": [&"hide_cured", 30.0],
}
const RAW_MEAT := Color(0.42, 0.075, 0.06)
const DRY_MEAT := Color(0.2, 0.075, 0.05)

## [{"id": StringName, "t": hours dried}] — meat strips, then at most one hide.
var meat: Array[Dictionary] = []
var hide: Dictionary = {}
var _last_h := -1.0
var _tick := 0.0
var _mats: Array[StandardMaterial3D] = []
var _hide_mat: Material = null


func _ready() -> void:
	model_glb = "camp_drying_rack.glb"
	super._ready()
	_update_visuals()


func _process(delta: float) -> void:
	_tick -= delta
	if _tick > 0.0:
		return
	_tick = 0.5
	advance()


## Integrates drying up to the current game time.
func advance() -> void:
	var r := BuildFX.game_hours_since(_last_h)
	_last_h = r[1]
	var h: float = r[0]
	if h <= 0.0 or not is_complete():
		return
	var rate := drying_rate()
	var changed := false
	for m in meat:
		var before := float(m["t"])
		m["t"] = before + h * rate
		changed = changed or _stage(before) != _stage(float(m["t"]))
	if not hide.is_empty():
		hide["t"] = float(hide["t"]) + h * rate
		changed = true
	if changed or h > 0.05:
		_update_visuals()


func _stage(t: float) -> int:
	return int(clampf(t / 10.0, 0.0, 1.0) * 5.0)


## Drying speed multiplier from fire, wind, precipitation and shelter.
func drying_rate() -> float:
	var rate := 1.0
	if BuildFX.active_heat_near(global_position, 3.5, self) != null:
		rate *= 1.8
	var wind := (Climate.get_wind_at(global_position + Vector3.UP) as Vector3).length() if Climate.has_method(&"get_wind_at") else 0.0
	rate *= 1.0 + clampf(wind / 15.0, 0.0, 0.5)
	var shelter := float(Climate.get_shelter_at(global_position + Vector3.UP)) if Climate.has_method(&"get_shelter_at") else 0.0
	if Climate.precipitation > 0.2 and shelter < 0.5:
		rate *= lerpf(1.0, 0.25, clampf(Climate.precipitation, 0.0, 1.0))
	return rate


static func is_done(entry: Dictionary) -> bool:
	var rec: Array = RECIPES.get(StringName(entry.get("id", "")), [])
	return not rec.is_empty() and float(entry.get("t", 0.0)) >= float(rec[1])


func ready_count() -> int:
	var n := 0
	for m in meat:
		if is_done(m):
			n += 1
	if not hide.is_empty() and is_done(hide):
		n += 1
	return n


## Hangs one raw item from `inv`. Returns true if hung.
func hang(id: StringName, inv: Inventory) -> bool:
	if not RECIPES.has(id) or inv == null or inv.count(id) <= 0:
		return false
	advance()
	if id == &"hide_raw":
		if not hide.is_empty():
			return false
		inv.remove(id, 1)
		hide = {"id": id, "t": 0.0}
	else:
		if meat.size() >= MEAT_SLOTS:
			return false
		inv.remove(id, 1)
		meat.append({"id": id, "t": 0.0})
	Audio.play_sfx(&"pickup", global_position + Vector3.UP, -6.0)
	_update_visuals()
	return true


## Moves everything that has finished drying into `inv`. Returns the number of items taken.
func collect(inv: Inventory) -> int:
	if inv == null:
		return 0
	var n := 0
	var keep: Array[Dictionary] = []
	for m in meat:
		if is_done(m):
			var res: StringName = RECIPES[StringName(m["id"])][0]
			if inv.add(res, 1) == 0:
				n += 1
				Events.item_picked_up.emit(res, 1)
				continue
		keep.append(m)
	meat = keep
	if not hide.is_empty() and is_done(hide):
		var res2: StringName = RECIPES[StringName(hide["id"])][0]
		if inv.add(res2, 1) == 0:
			n += 1
			Events.item_picked_up.emit(res2, 1)
			hide = {}
	if n > 0:
		Audio.play_sfx(&"pickup", global_position + Vector3.UP)
		Game.notify("+%d from the drying rack" % n, &"item")
	_update_visuals()
	return n


func _hangable(inv: Inventory) -> StringName:
	if inv == null:
		return &""
	if meat.size() < MEAT_SLOTS and inv.count(&"meat_raw") > 0:
		return &"meat_raw"
	if hide.is_empty() and inv.count(&"hide_raw") > 0:
		return &"hide_raw"
	return &""


func own_prompt(player: Node) -> String:
	var inv := ItemActions.inventory_of(player)
	if ready_count() > 0:
		return "Take dried goods (%d)" % ready_count()
	var h := _hangable(inv)
	if h != &"":
		return "Hang %s to dry" % ItemInfo.name_of(h).to_lower()
	if meat.is_empty() and hide.is_empty():
		return "Drying rack (hang raw meat or hides)"
	return "Drying rack · %s" % status_text()


func own_interact(player: Node) -> void:
	var inv := ItemActions.inventory_of(player)
	if ready_count() > 0:
		collect(inv)
		return
	var h := _hangable(inv)
	if h != &"":
		hang(h, inv)


func status_text() -> String:
	var parts: PackedStringArray = []
	if not meat.is_empty():
		var avg := 0.0
		for m in meat:
			avg += clampf(float(m["t"]) / float(RECIPES[StringName(m["id"])][1]), 0.0, 1.0)
		parts.append("%d strip%s %d%%" % [meat.size(), "" if meat.size() == 1 else "s", roundi(avg / meat.size() * 100.0)])
	if not hide.is_empty():
		parts.append("hide %d%%" % roundi(clampf(float(hide["t"]) / float(RECIPES[StringName(hide["id"])][1]), 0.0, 1.0) * 100.0))
	return ", ".join(parts)


func _update_visuals() -> void:
	if model == null:
		return
	var root := model.get_parent() if model.get_parent() else self
	for i in MEAT_SLOTS:
		var mi := _find_mesh(root, "Meat%d" % i)
		if mi == null:
			continue
		mi.visible = i < meat.size() and is_complete()
		if mi.visible:
			while _mats.size() <= i:
				var m := StandardMaterial3D.new()
				m.roughness = 0.5
				m.clearcoat_enabled = true
				m.clearcoat = 0.3
				_mats.append(m)
			var f := clampf(float(meat[i]["t"]) / 10.0, 0.0, 1.0)
			_mats[i].albedo_color = RAW_MEAT.lerp(DRY_MEAT, f)
			_mats[i].roughness = lerpf(0.35, 0.7, f)
			_mats[i].clearcoat = lerpf(0.5, 0.05, f)
			mi.material_override = _mats[i]
	var hm := _find_mesh(root, "Hide0")
	if hm:
		hm.visible = not hide.is_empty() and is_complete()


func _find_mesh(root: Node, n: String) -> MeshInstance3D:
	var found := root.find_child(n, true, false)
	return found as MeshInstance3D


func _refresh_frame() -> void:
	super._refresh_frame()
	_update_visuals()


func save_extra() -> Dictionary:
	var m := []
	for e in meat:
		m.append({"id": String(e["id"]), "t": float(e["t"])})
	var d := {"meat": m}
	if not hide.is_empty():
		d["hide"] = {"id": String(hide["id"]), "t": float(hide["t"])}
	return d


func load_extra(d: Dictionary) -> void:
	meat.clear()
	for e in d.get("meat", []):
		if e is Dictionary and RECIPES.has(StringName(e.get("id", ""))):
			meat.append({"id": StringName(e["id"]), "t": float(e.get("t", 0.0))})
	hide = {}
	var h: Variant = d.get("hide", null)
	if h is Dictionary and RECIPES.has(StringName((h as Dictionary).get("id", ""))):
		hide = {"id": StringName(h["id"]), "t": float(h.get("t", 0.0))}
	_last_h = -1.0
	_update_visuals()


func collision_shapes() -> Array:
	var b := BoxShape3D.new()
	b.size = Vector3(2.0, 1.7, 0.8)
	return [[b, Transform3D(Basis.IDENTITY, Vector3(0.0, 0.85, 0.0))]]

extends HeldItem
## Food, drink, medical items and the canteen. `use` raises the item to the mouth (eat/drink/apply),
## applies it via Vitals.consume() and removes one. The canteen stores its fill level in the inventory
## slot's durability (0..1, 4 sips) and never disappears; `use` while standing in or looking at open water
## refills it (untreated water — boil it to be safe).

const SIP := 0.25

enum Act { NONE, RAISE, CONSUME, LOWER, FILL }

var act: Act = Act.NONE
var act_t := 0.0
var is_canteen := false
var _applied := false
var _holder: Node3D = null
var _kind := &"eat"


func build_visual() -> void:
	is_canteen = tool_type == &"canteen" or item_id == &"canteen"
	var cat := String(def.get("category", ""))
	if is_canteen or cat == "drink" or String(item_id).begins_with("water"):
		_kind = &"drink"
	elif cat == "medical":
		_kind = &"medical"
	rest_pos = Vector3(0.2, -0.34, 0.0)
	sprint_pos = Vector3(0.02, -0.08, 0.06)
	sprint_rot = Vector3(-20.0, 10.0, 10.0)
	_holder = Node3D.new()
	_holder.name = "Item"
	var grip_cam := Vector3(0.15, -0.16, -0.37)
	if is_canteen:
		grip_cam = Vector3(0.17, -0.155, -0.42)
	var basis := Basis.from_euler(Vector3(deg_to_rad(-10.0), deg_to_rad(-25.0), deg_to_rad(-6.0)))
	_holder.transform = Transform3D(basis, grip_cam - rest_pos)
	model.add_child(_holder)
	var ext := FPModels.external(item_id)
	var mi := MeshInstance3D.new()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var hand_off := Vector3(0.0, 0.0, 0.0)
	if is_canteen:
		mi.mesh = FPModels.canteen_mesh()
		mi.position = Vector3(0.0, -0.09, 0.0)
		hand_off = Vector3(0.02, -0.02, 0.0)
	else:
		mi.mesh = FPModels.consumable_mesh(item_id)
	if ext:
		_holder.add_child(ext)
	else:
		_holder.add_child(mi)
	var arm := FPHands.make_arm(&"hold", false, hand_off + Vector3(0.012, -0.012, 0.0), Vector3(0, 1, 0), basis.inverse() * elbow_toward(grip_cam, ELBOW_R))
	_holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


func item_process(delta: float, can_act: bool) -> void:
	match act:
		Act.NONE:
			anim_pos = anim_pos.lerp(Vector3.ZERO, 1.0 - exp(-10.0 * delta))
			anim_rot = anim_rot.lerp(Vector3.ZERO, 1.0 - exp(-10.0 * delta))
			busy = false
			if can_act and not player.tool_blocked and Input.is_action_just_pressed(&"use") and not player.is_sprinting:
				if is_canteen and _near_water():
					_start(Act.FILL)
				elif is_canteen and _fill() <= 0.01:
					Game.notify("The canteen is empty", &"info")
				else:
					_start(Act.RAISE)
		Act.RAISE:
			act_t += delta
			var k := smooth(act_t / 0.35)
			anim_pos = Vector3(-0.14, 0.14, 0.12) * k
			anim_rot = Vector3(38.0 if _kind == &"drink" else 20.0, 18.0, 10.0) * k
			if act_t >= 0.35:
				_start(Act.CONSUME)
				Audio.play_sfx(&"drink" if _kind == &"drink" else &"eat", player.get_eye_position(), -2.0)
		Act.CONSUME:
			act_t += delta
			var wob := sin(act_t * 14.0) * (1.5 if _kind == &"eat" else 0.6)
			anim_pos = Vector3(-0.14, 0.14, 0.12) + Vector3(0.0, 0.0, 0.01) * sin(act_t * 9.0)
			anim_rot = Vector3(38.0 if _kind == &"drink" else 20.0, 18.0, 10.0) + Vector3(wob, 0.0, 0.0)
			if act_t >= 0.9 and not _applied:
				_apply()
			if act_t >= 1.0:
				_start(Act.LOWER)
		Act.LOWER:
			act_t += delta
			var k := 1.0 - smooth(act_t / 0.35)
			anim_pos = Vector3(-0.14, 0.14, 0.12) * k
			anim_rot = Vector3(38.0 if _kind == &"drink" else 20.0, 18.0, 10.0) * k
			if act_t >= 0.35:
				act = Act.NONE
				_finish()
		Act.FILL:
			act_t += delta
			var s := sin(clampf(act_t / 1.4, 0.0, 1.0) * PI)
			anim_pos = Vector3(-0.02, -0.18, -0.1) * s
			anim_rot = Vector3(-50.0, 0.0, 20.0) * s
			if act_t >= 0.7 and not _applied:
				_applied = true
				_set_fill(1.0, true)
				Audio.play_sfx(&"splash", player.get_eye_position() + Vector3.DOWN, -8.0, 1.3)
				Game.notify("Canteen filled — untreated water", &"item")
			if act_t >= 1.4:
				act = Act.NONE
				busy = false


func _start(a: Act) -> void:
	act = a
	act_t = 0.0
	busy = true
	if a == Act.RAISE or a == Act.FILL:
		_applied = false


func _apply() -> void:
	_applied = true
	var v := player.vitals
	if is_canteen:
		var f := _fill()
		var sip := minf(SIP, f)
		var wdef: Dictionary = def.get("food", {})
		var gain := float(wdef.get("water", 25.0)) * (sip / SIP)
		if Vitals.DIFFICULTY.get(v.difficulty, {}).get(&"metabolism", 1.0) > 0.0:
			v.water = minf(v.water + gain, 100.0)
		var idx := inventory_index()
		var unsafe := idx >= 0 and bool(player.inventory.get_slot(idx).get("unsafe", false))
		if unsafe and randf() < float(Vitals.TUNING[&"unsafe_water_sick_chance"]) * 0.5:
			v.add_effect(&"sick", float(Vitals.TUNING[&"sick_duration"]))
		_set_fill(f - sip, unsafe)
		Events.item_consumed.emit(item_id)
		return
	if v.consume(item_id):
		Audio.play_sfx(&"eat" if _kind == &"eat" else &"drink", player.get_eye_position(), -8.0, 0.9)
	var idx2 := inventory_index()
	if idx2 >= 0:
		player.inventory.remove_at(idx2, 1)


func _finish() -> void:
	busy = false
	if not is_canteen and player.inventory.count(item_id) <= 0:
		depleted.emit()


func get_speed_cap() -> float:
	return PlayerMotion.WALK_SPEED * 1.3 if act != Act.NONE else INF


func _fill() -> float:
	var idx := inventory_index()
	return float(player.inventory.get_slot(idx).get("durability", 0.0)) if idx >= 0 else 0.0


func _set_fill(f: float, unsafe: bool) -> void:
	var idx := inventory_index()
	if idx < 0:
		return
	var st := player.inventory.get_slot(idx).duplicate()
	st["durability"] = clampf(f, 0.0, 1.0)
	if unsafe:
		st["unsafe"] = true
	else:
		st.erase("unsafe")
	player.inventory.set_slot(idx, st)


func _near_water() -> bool:
	if player.water_depth > 0.25:
		return true
	# Looking at open water close by (TerrainData lakes/rivers).
	var eye := player.get_eye_position()
	var dir := player.get_look_direction()
	if dir.y > -0.2:
		return false
	for i in range(1, 6):
		var p := eye + dir * (float(i) * 0.5)
		var wl := TerrainData.get_water_level(p.x, p.z)
		if wl > -1e20 and p.y <= wl + 0.05:
			return true
	return false

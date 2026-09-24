extends Node
## JSON save games in user://. Persistent nodes: group "persistent" with get_save_key/save_state/load_state.

const VERSION := 1


func _path(slot: int) -> String:
	return "user://save_%d.json" % slot


func has_save(slot := 0) -> bool:
	return FileAccess.file_exists(_path(slot))


func delete_save(slot := 0) -> void:
	if has_save(slot):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(_path(slot)))


func save_game(slot := 0) -> bool:
	if Game.world == null:
		return false
	var data := {
		"version": VERSION,
		"timestamp": Time.get_unix_time_from_system(),
		"game": Game.save_state(),
		"climate": Climate.save_state() if Climate.has_method("save_state") else {},
		"story": Story.save_state() if Story.has_method("save_state") else {},
		"nodes": {},
		"info": _make_info(),
	}
	for n in get_tree().get_nodes_in_group("persistent"):
		if n.has_method("get_save_key") and n.has_method("save_state"):
			data["nodes"][n.get_save_key()] = n.save_state()
	var f := FileAccess.open(_path(slot), FileAccess.WRITE)
	if f == null:
		push_error("Save: cannot write %s" % _path(slot))
		return false
	f.store_string(JSON.stringify(data))
	f.close()
	Events.game_saved.emit(slot)
	return true


func load_game(slot := 0) -> bool:
	var d := _read(slot)
	if d.is_empty():
		return false
	Game.load_state(d.get("game", {}))
	if Climate.has_method("load_state"):
		Climate.load_state(d.get("climate", {}))
	if Story.has_method("load_state"):
		Story.load_state(d.get("story", {}))
	var nodes: Dictionary = d.get("nodes", {})
	for n in get_tree().get_nodes_in_group("persistent"):
		if n.has_method("get_save_key") and n.has_method("load_state"):
			var key: String = n.get_save_key()
			if nodes.has(key):
				n.load_state(nodes[key])
	Events.game_loaded.emit(slot)
	return true


func get_save_info(slot := 0) -> Dictionary:
	var d := _read(slot)
	var info: Dictionary = d.get("info", {})
	info["timestamp"] = d.get("timestamp", 0)
	return info


func _read(slot: int) -> Dictionary:
	if not has_save(slot):
		return {}
	var f := FileAccess.open(_path(slot), FileAccess.READ)
	if f == null:
		return {}
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	return parsed if parsed is Dictionary else {}


func _make_info() -> Dictionary:
	var loc := ""
	if Game.player:
		var p: Vector3 = Game.player.global_position
		loc = "%d m" % int(p.y)
	return {"day": Climate.day, "hours": Climate.hours, "location": loc, "playtime": Game.playtime}

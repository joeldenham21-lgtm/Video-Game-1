extends Node
## STUB — owned by the Story workstream. Objectives + logs bookkeeping only.
## Full API: CONTRACT.md §3 "Story".

var objectives: Array[Dictionary] = []
var found_logs: Array[StringName] = []
var discovered_pois: Array[StringName] = []


func start_prologue() -> void:
	add_objective(&"get_warm", "Get warm: build a campfire")


func add_objective(id: StringName, text: String) -> void:
	if has_objective(id):
		return
	objectives.append({"id": id, "text": text, "done": false})
	Events.objective_added.emit(id, text)


func complete_objective(id: StringName) -> void:
	for o in objectives:
		if o["id"] == id and not o["done"]:
			o["done"] = true
			Events.objective_completed.emit(id)


func has_objective(id: StringName) -> bool:
	for o in objectives:
		if o["id"] == id:
			return true
	return false


func is_objective_done(id: StringName) -> bool:
	for o in objectives:
		if o["id"] == id:
			return o["done"]
	return false


func find_log(log_id: StringName) -> void:
	if not found_logs.has(log_id):
		found_logs.append(log_id)
		Events.log_found.emit(log_id)


func discover_poi(poi_id: StringName) -> void:
	if not discovered_pois.has(poi_id):
		discovered_pois.append(poi_id)
		Events.poi_discovered.emit(poi_id)


func trigger(_event_id: StringName) -> void:
	pass


func save_state() -> Dictionary:
	var objs := []
	for o in objectives:
		objs.append({"id": String(o["id"]), "text": o["text"], "done": o["done"]})
	return {"objectives": objs, "logs": found_logs.map(func(x): return String(x)),
		"pois": discovered_pois.map(func(x): return String(x))}


func load_state(d: Dictionary) -> void:
	objectives.clear(); found_logs.clear(); discovered_pois.clear()
	for o in d.get("objectives", []):
		objectives.append({"id": StringName(o["id"]), "text": o["text"], "done": o["done"]})
	for l in d.get("logs", []):
		found_logs.append(StringName(l))
	for p in d.get("pois", []):
		discovered_pois.append(StringName(p))

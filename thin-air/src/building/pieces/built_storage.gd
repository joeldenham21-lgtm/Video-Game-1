extends StorageContainer
## Storage box placed through build mode (inherits scenes/items/storage_box.tscn): frame first, then a
## container; dismantling drops what was inside.


func _ready() -> void:
	super._ready()
	if BuildHooks.component(self) == null:
		BuildHooks.attach(self, &"storage_box", true)
	BuildHooks.refresh_ghost.call_deferred(self)


func get_interact_prompt(player: Node) -> String:
	var o := BuildHooks.prompt(self, player)
	if o != "" or not BuildHooks.is_built(self):
		return o
	return super.get_interact_prompt(player)


func get_interact_hold_time() -> float:
	return BuildHooks.hold_time(self)


func interact(player: Node) -> void:
	if BuildHooks.component(self) and BuildComponent.holds_hammer(player) and inventory:
		# Spill the contents before the box comes apart.
		for i in inventory.size():
			var st := inventory.get_slot(i)
			if not st.is_empty():
				ItemsRoot.spawn(StringName(st["id"]), int(st["count"]), global_position + Vector3(0, 0.5, 0), Vector3(0, 1.0, 0))
		inventory.clear()
	if BuildHooks.interact(self, player):
		return
	super.interact(player)


func get_harvest_tool_type() -> StringName:
	return &"hammer"


func harvest_hit(_tool_id: StringName, _power: float, _pos: Vector3, _normal: Vector3, player: Node) -> void:
	BuildHooks.hammer_hit(self, player)

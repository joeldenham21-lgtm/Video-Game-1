extends CraftingStation
## Workbench placed through build mode (inherits scenes/items/workbench.tscn): crafting only once built.


func _ready() -> void:
	super._ready()
	if BuildHooks.component(self) == null:
		BuildHooks.attach(self, &"workbench", true)
	BuildHooks.refresh_ghost.call_deferred(self)


func is_station_active() -> bool:
	return BuildHooks.is_built(self)


func get_interact_prompt(player: Node) -> String:
	var o := BuildHooks.prompt(self, player)
	if o != "" or not BuildHooks.is_built(self):
		return o
	return super.get_interact_prompt(player)


func get_interact_hold_time() -> float:
	return BuildHooks.hold_time(self)


func interact(player: Node) -> void:
	if BuildHooks.interact(self, player):
		return
	super.interact(player)


func get_harvest_tool_type() -> StringName:
	return &"hammer"


func harvest_hit(_tool_id: StringName, _power: float, _pos: Vector3, _normal: Vector3, player: Node) -> void:
	BuildHooks.hammer_hit(self, player)

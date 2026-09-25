extends Campfire
## Stone fire pit (scenes/building/stone_fire_pit.tscn inherits the items stream's campfire): the same fire —
## fuel, lighting, cooking station, heat source, flames and light — in a deeper dry-stone ring that shelters
## the flame (hotter, burns longer, less wind loss) and a model that is revealed stone by stone while built.

const PIT_GLB := "camp_fire_pit.glb"

var _pit: Node3D


func _init() -> void:
	super._init()
	build_model = false
	display_name = "Stone Fire Pit"
	max_heat_celsius = 29.0
	heat_radius = 4.6
	max_fuel_minutes = 600.0
	ember_minutes_max = 90.0


func _ready() -> void:
	_pit = BuildCatalog.instantiate_model(PIT_GLB)
	if _pit:
		_pit.name = "PitModel"
		_pit.set_meta(&"build_reveal", true)
		add_child(_pit)
	super._ready()
	if BuildHooks.component(self) == null:
		BuildHooks.attach(self, &"stone_fire_pit", true)
	BuildHooks.refresh_ghost.call_deferred(self)


func get_interact_prompt(player: Node) -> String:
	var o := BuildHooks.prompt(self, player)
	if o != "" or not BuildHooks.is_built(self):
		return o
	return super.get_interact_prompt(player).replace("campfire", "fire pit")


func get_interact_hold_time() -> float:
	var h := BuildHooks.hold_time(self)
	return h if h > 0.0 or not BuildHooks.is_built(self) else super.get_interact_hold_time()


func interact(player: Node) -> void:
	if BuildHooks.interact(self, player):
		return
	super.interact(player)


func is_station_active() -> bool:
	return BuildHooks.is_built(self) and super.is_station_active()


func get_harvest_tool_type() -> StringName:
	return &"hammer"


func harvest_hit(_tool_id: StringName, _power: float, _pos: Vector3, _normal: Vector3, player: Node) -> void:
	BuildHooks.hammer_hit(self, player)

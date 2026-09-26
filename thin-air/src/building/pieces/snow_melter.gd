class_name BuildSnowMelter
extends BuildObject
## Folded aircraft-aluminium trough on two stone piers, set beside a fire: packed snow melts and comes to the
## boil while a lit fire (any active heat source) is within reach, filling empty bottles with boiled water.
## 3 snow -> 1 bottle (items.json: water_boiled, container bottle_empty), ~25 game minutes per bottle.

const MAX_SNOW := 12
const MAX_WATER := 4
const SNOW_PER_BOTTLE := 3
const MINUTES_PER_BOTTLE := 25.0
const HEAT_REACH := 2.2

var snow := 0                  ## units of packed snow in the trough
var water := 0                 ## bottles' worth of boiled water ready
var progress := 0.0            ## 0..1 toward the next bottle
var heated := false
var _last_h := -1.0
var _tick := 0.0
var _steam: GPUParticles3D
var _snow_node: Node3D
var _water_node: Node3D


func _ready() -> void:
	model_glb = "camp_snow_melter.glb"
	surface = &"rock"
	super._ready()
	_steam = BuildFX.steam(self, Vector3(0.0, 0.62, 0.0), Color(0.82, 0.84, 0.86, 0.3), 0.45, Settings.is_mobile())
	if model:
		_snow_node = model.get_parent().find_child("Snow", true, false) as Node3D
		_water_node = model.get_parent().find_child("Water", true, false) as Node3D
	_update_visuals()


func _process(delta: float) -> void:
	_tick -= delta
	if _tick > 0.0:
		return
	_tick = 0.5
	advance()


## Integrates melting up to the current game time.
func advance() -> void:
	var r := BuildFX.game_hours_since(_last_h)
	_last_h = r[1]
	var was := heated
	heated = is_complete() and BuildFX.active_heat_near(global_position, HEAT_REACH, self) != null
	var h: float = r[0]
	if heated and h > 0.0:
		var minutes := h * 60.0
		while minutes > 0.0 and snow >= SNOW_PER_BOTTLE and water < MAX_WATER:
			var need := (1.0 - progress) * MINUTES_PER_BOTTLE
			if minutes >= need:
				minutes -= need
				progress = 0.0
				snow -= SNOW_PER_BOTTLE
				water += 1
			else:
				progress += minutes / MINUTES_PER_BOTTLE
				minutes = 0.0
	if was != heated or h > 0.0:
		_update_visuals()


func add_snow(inv: Inventory, amount := -1) -> int:
	if inv == null:
		return 0
	advance()
	var room := MAX_SNOW - snow
	var n := mini(room, inv.count(&"snow"))
	if amount >= 0:
		n = mini(n, amount)
	if n <= 0:
		return 0
	inv.remove(&"snow", n)
	snow += n
	Audio.play_sfx(&"step_snow", global_position + Vector3(0, 0.5, 0), -8.0)
	_update_visuals()
	return n


## Fills empty bottles from `inv` with boiled water. Returns bottles filled.
func fill_bottles(inv: Inventory) -> int:
	if inv == null:
		return 0
	advance()
	var n := 0
	while water > 0 and inv.count(&"bottle_empty") > 0:
		inv.remove(&"bottle_empty", 1)
		if inv.add(&"water_boiled", 1) > 0:
			inv.add(&"bottle_empty", 1)
			break
		water -= 1
		n += 1
	if n > 0:
		Events.item_picked_up.emit(&"water_boiled", n)
		Game.notify("+%d Boiled Water" % n, &"item")
		Audio.play_sfx(&"drink", global_position + Vector3(0, 0.5, 0), -8.0)
	_update_visuals()
	return n


func own_prompt(player: Node) -> String:
	var inv := ItemActions.inventory_of(player)
	if water > 0 and inv and inv.count(&"bottle_empty") > 0:
		return "Fill %d bottle%s with boiled water" % [mini(water, inv.count(&"bottle_empty")), "" if mini(water, inv.count(&"bottle_empty")) == 1 else "s"]
	if snow < MAX_SNOW and inv and inv.count(&"snow") > 0:
		return "Pack snow into the melter (%d/%d)" % [snow, MAX_SNOW]
	return "Snow melter · %s" % status_text()


func own_interact(player: Node) -> void:
	var inv := ItemActions.inventory_of(player)
	if water > 0 and inv and inv.count(&"bottle_empty") > 0:
		fill_bottles(inv)
	elif inv and inv.count(&"snow") > 0:
		add_snow(inv)
	elif water > 0:
		Game.notify("You need an empty bottle.", &"info")


func status_text() -> String:
	var parts: PackedStringArray = []
	parts.append("%d snow" % snow)
	if water > 0:
		parts.append("%d bottle%s ready" % [water, "" if water == 1 else "s"])
	if snow >= SNOW_PER_BOTTLE and water < MAX_WATER:
		parts.append("boiling %d%%" % roundi(progress * 100.0) if heated else "needs a fire alongside")
	return ", ".join(parts)


func _update_visuals() -> void:
	var built := is_complete()
	if _snow_node:
		_snow_node.visible = built and snow > 0
		var k := clampf(float(snow) / float(MAX_SNOW), 0.15, 1.0)
		_snow_node.scale = Vector3(1.0, k, 1.0)
	if _water_node:
		_water_node.visible = built and (water > 0 or (heated and snow > 0))
		_water_node.position.y = -0.05 + 0.05 * clampf(float(water) / float(MAX_WATER), 0.0, 1.0)
	if _steam:
		_steam.emitting = built and heated and (snow > 0 or water > 0)


func save_extra() -> Dictionary:
	return {"snow": snow, "water": water, "progress": progress}


func load_extra(d: Dictionary) -> void:
	snow = int(d.get("snow", 0))
	water = int(d.get("water", 0))
	progress = float(d.get("progress", 0.0))
	_last_h = -1.0
	_update_visuals()


func collision_shapes() -> Array:
	var b := BoxShape3D.new()
	b.size = Vector3(1.15, 0.62, 0.5)
	return [[b, Transform3D(Basis.IDENTITY, Vector3(0.0, 0.31, 0.0))]]

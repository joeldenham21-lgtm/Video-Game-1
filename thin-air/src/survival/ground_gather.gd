class_name GroundGather
extends StaticBody3D
## The terrain heightfield collider as an interactable (DESIGN §1 "Boil snow for water"): hold interact while
## looking at snowy ground to scoop snow (the only water above the treeline: melt or boil it), or at a lake /
## creek with an empty bottle to fill it (untreated water: boil it). Created by TerrainRenderer as its
## "TerrainBody"; the interaction ray resolves the collider itself, so nothing else is needed.

const SNOW_MIN_DEPTH := 0.08        ## PlayerMotion.snow_depth() needed to scoop from the snow mask
const SNOW_COVER_MIN := 0.45        ## …or fresh snowfall lying everywhere (Climate.snow_cover)
const SNOW_PER_SCOOP := 3           ## water_from_snow takes 3 snow per bottle
const HOLD_S := 1.1
const WATER_MARGIN := 0.15          ## m: the ray hit is on the bed below / at the water surface


## What the ground at `p` (a ray hit on the heightfield) offers: &"water", &"snow" or &"".
static func kind_at(p: Vector3) -> StringName:
	if not TerrainData.is_loaded():
		return &""
	var wl := TerrainData.get_water_level(p.x, p.z)
	if wl > -1e20 and p.y <= wl + WATER_MARGIN:
		return &"water"
	var m := TerrainData.get_masks(p.x, p.z)
	if PlayerMotion.snow_depth(m.r, p.y) >= SNOW_MIN_DEPTH or TerrainData.get_surface(p.x, p.z) == &"snow":
		return &"snow"
	if float(Climate.snow_cover) >= SNOW_COVER_MIN and Climate.get_air_temperature(p) < 1.0:
		return &"snow"
	return &""


static func _aim(player: Node) -> Vector3:
	var ray: Variant = player.get("interactor") if player else null
	if ray is RayCast3D and (ray as RayCast3D).is_colliding():
		return (ray as RayCast3D).get_collision_point()
	return Vector3.INF


static func _inventory(player: Node) -> Inventory:
	return ItemActions.inventory_of(player)


func get_interact_prompt(player: Node) -> String:
	var p := _aim(player)
	var inv := _inventory(player)
	if p == Vector3.INF or inv == null:
		return ""
	match kind_at(p):
		&"water":
			return "Fill a bottle (untreated water)" if inv.count(&"bottle_empty") > 0 else ""
		&"snow":
			return "Scoop snow" if inv.can_add(&"snow", 1) else ""
	return ""


func get_interact_hold_time() -> float:
	return HOLD_S


func interact(player: Node) -> void:
	var p := _aim(player)
	var inv := _inventory(player)
	if p == Vector3.INF or inv == null:
		return
	gather(kind_at(p), inv, p)


## Applies one gather of `kind` into `inv`. Returns the item id given (or &"").
static func gather(kind: StringName, inv: Inventory, at := Vector3.ZERO) -> StringName:
	match kind:
		&"water":
			if inv.count(&"bottle_empty") <= 0 or not inv.remove(&"bottle_empty", 1):
				return &""
			if inv.add(&"water_unsafe", 1) > 0:
				inv.add(&"bottle_empty", 1)
				return &""
			Events.item_picked_up.emit(&"water_unsafe", 1)
			Audio.play_sfx(&"splash", null, -8.0, 1.3)
			Game.notify("Bottle filled — untreated water", &"item")
			return &"water_unsafe"
		&"snow":
			var left := inv.add(&"snow", SNOW_PER_SCOOP)
			var got := SNOW_PER_SCOOP - left
			if got <= 0:
				return &""
			Events.resource_harvested.emit(&"snow", at)
			Events.item_picked_up.emit(&"snow", got)
			Audio.play_sfx(&"pickup", null, -8.0)
			Game.notify("+%d %s" % [got, ItemInfo.name_of(&"snow")], &"item")
			return &"snow"
	return &""

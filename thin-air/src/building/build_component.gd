class_name BuildComponent
extends Node
## Blueprint-frame bookkeeping for anything the player builds (child node "Build" of a grid piece or a
## free-placed object). Sons-of-the-Forest style: placing creates a frame; the player adds the materials one
## by one (interact, or swinging a hammer at it) and the piece appears step by step; explorer difficulty
## builds instantly. With a hammer in hand, holding interact dismantles (50 % refund) or cancels a frame
## (full refund of what was added).
##
## The owner (the interactable body) forwards get_interact_prompt / get_interact_hold_time / interact /
## harvest_hit here first: override_prompt() returns "" when the owner's own interaction should run.

signal progressed(fraction: float)
signal completed()

const DISMANTLE_HOLD := 1.2
const REFUND_FRACTION := 0.5

var id: StringName = &""
var cost: Dictionary = {}          ## StringName -> int
var added: Dictionary = {}         ## StringName -> int
var complete := false
## Node that owns this frame (grid piece or free object); refreshes visuals on progress.
var owner_node: Node3D = null


func setup(buildable_id: StringName, done: bool) -> void:
	id = buildable_id
	cost = BuildCatalog.cost_of(id)
	complete = done
	if done:
		added = cost.duplicate()


func total_units() -> int:
	var n := 0
	for k in cost:
		n += int(cost[k])
	return maxi(n, 1)


func added_units() -> int:
	var n := 0
	for k in added:
		n += int(added[k])
	return n


func fraction() -> float:
	return 1.0 if complete else clampf(float(added_units()) / float(total_units()), 0.0, 1.0)


func missing() -> Dictionary:
	var out := {}
	for k in cost:
		var left := int(cost[k]) - int(added.get(k, 0))
		if left > 0:
			out[k] = left
	return out


## First still-needed material the inventory can supply (&"" if none).
func next_needed(inv: Inventory) -> StringName:
	if inv == null:
		return &""
	# Logs first (they're what's on your shoulder), then the rest in cost order.
	var miss := missing()
	if miss.has(&"log") and inv.count(&"log") > 0:
		return &"log"
	for k in miss:
		if inv.count(k) > 0:
			return k
	return &""


## Moves one unit of the next needed material from `inv` into the frame. True if something was added.
func add_one(inv: Inventory, quiet := false) -> bool:
	if complete:
		return false
	var k := next_needed(inv)
	if k == &"" or not inv.remove(k, 1):
		return false
	added[k] = int(added.get(k, 0)) + 1
	var at := owner_node.global_position if owner_node and owner_node.is_inside_tree() else Vector3.ZERO
	if not quiet:
		Audio.play_sfx(&"build_hammer", at, -2.0, randf_range(0.92, 1.08))
		Events.noise_emitted.emit(at, 18.0, owner_node)
	progressed.emit(fraction())
	if missing().is_empty():
		finish(quiet)
	return true


## Adds everything the inventory can supply. Returns units added.
func add_all(inv: Inventory) -> int:
	var n := 0
	while not complete and add_one(inv, true):
		n += 1
	return n


func finish(quiet := false) -> void:
	if complete:
		return
	complete = true
	added = cost.duplicate()
	if not quiet and owner_node and owner_node.is_inside_tree():
		Audio.play_sfx(&"build_place", owner_node.global_position)
	progressed.emit(1.0)
	completed.emit()


## Materials returned when this is taken apart.
func refund() -> Dictionary:
	var out := {}
	if complete:
		for k in cost:
			var n := int(floor(float(cost[k]) * REFUND_FRACTION))
			if n > 0:
				out[k] = n
	else:
		for k in added:
			if int(added[k]) > 0:
				out[k] = int(added[k])
	return out


# ---------------------------------------------------------------------------------------------- interaction

static func _inventory(player: Node) -> Inventory:
	return ItemActions.inventory_of(player) if player else null


static func holds_hammer(player: Node) -> bool:
	if player == null or not player.has_method(&"get_active_item"):
		return false
	var a: StringName = player.get_active_item()
	if a == &"":
		return false
	var t: Dictionary = ItemDB.get_item(a).get("tool", {})
	return StringName(t.get("type", "")) == &"hammer"


## Prompt if the frame/dismantle interaction applies, else "" (owner handles it).
func override_prompt(player: Node) -> String:
	var nm := BuildCatalog.display_name(id)
	if holds_hammer(player):
		return ("Dismantle %s" % nm) if complete else ("Cancel %s blueprint" % nm)
	if complete:
		return ""
	var inv := _inventory(player)
	var k := next_needed(inv)
	if k != &"":
		return "Add %s to %s  (%d/%d)" % [ItemInfo.name_of(k), nm, added_units(), total_units()]
	return "%s needs %s" % [nm, missing_text()]


func override_hold_time(player: Node) -> float:
	return DISMANTLE_HOLD if holds_hammer(player) else 0.0


## Returns true if handled.
func override_interact(player: Node) -> bool:
	if holds_hammer(player):
		BuildingRoot.dismantle(owner_node, player)
		return true
	if complete:
		return false
	var inv := _inventory(player)
	if not add_one(inv):
		Game.notify("%s needs %s" % [BuildCatalog.display_name(id), missing_text()], &"warning")
		Audio.play_sfx(&"build_invalid", null, -6.0)
	return true


## Hammer swings add material to frames (SotF style).
func on_hammer_hit(player: Node) -> void:
	if complete:
		Audio.play_sfx(&"wood_creak", owner_node.global_position if owner_node else Vector3.ZERO, -10.0)
		return
	var inv := _inventory(player)
	if not add_one(inv):
		Game.notify("%s needs %s" % [BuildCatalog.display_name(id), missing_text()], &"warning")


func missing_text() -> String:
	var parts: PackedStringArray = []
	var miss := missing()
	for k in miss:
		parts.append("%d %s" % [int(miss[k]), ItemInfo.name_of(k)])
	return ", ".join(parts)


func save_data() -> Dictionary:
	var a := {}
	for k in added:
		a[String(k)] = int(added[k])
	return {"done": complete, "added": a}


func load_data(d: Dictionary) -> void:
	complete = bool(d.get("done", complete))
	added.clear()
	var a: Dictionary = d.get("added", {})
	for k in a:
		added[StringName(k)] = int(a[k])
	if complete:
		added = cost.duplicate()

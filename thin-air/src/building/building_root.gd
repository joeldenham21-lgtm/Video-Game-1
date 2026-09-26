class_name BuildingRoot
extends Node3D
## The world's "Building" part (scenes/building/building_root.tscn, CONTRACT §4): every player-built structure
## (BuildStructure children) and free-placed camp piece (children of "Free"). Persistent key "building": saves
## structures (grid pieces, frames' progress, door state) and free pieces (type, transform, progress, their own
## processing state — drying rack, snow melter…; campfire / storage / workbench state rides on ItemsRoot).
## Once a Player exists it attaches the build-mode controller and the log-carry helper to it.
##
## API: new_structure(xf), place_grid(structure, id, slot, props, done), place_free(id, xf, done),
## static dismantle(node, player), static ground_height(x, z, from_y), structures_near(pos, r).

const BUILD_MODE_SCRIPT := "res://src/building/build_mode.gd"
const LOG_CARRY_SCRIPT := "res://src/building/log_carry.gd"

static var instance: BuildingRoot = null

var free_root: Node3D
var batcher: BuildBatcher
var _next_sid := 1
var _attached_player: Node = null
var build_mode: Node = null
var log_carry: Node = null
## Dev/test: don't attach build mode / log carry to the player.
var attach_player_tools := true


func _enter_tree() -> void:
	instance = self
	add_to_group(&"persistent")
	add_to_group(&"building_root")


func _exit_tree() -> void:
	if instance == self:
		instance = null


func _ready() -> void:
	_ensure_free_root()


func _ensure_free_root() -> void:
	if batcher == null:
		batcher = BuildBatcher.new()
		batcher.name = "Batcher"
		add_child(batcher)
	if free_root == null:
		free_root = get_node_or_null(^"Free") as Node3D
	if free_root == null:
		free_root = Node3D.new()
		free_root.name = "Free"
		add_child(free_root)


func _process(_delta: float) -> void:
	if not attach_player_tools:
		return
	var p := Game.player
	if p != null and is_instance_valid(p) and p != _attached_player and p is Player:
		_attach_player(p)


func _attach_player(p: Node) -> void:
	_attached_player = p
	if build_mode and is_instance_valid(build_mode):
		build_mode.queue_free()
	if log_carry and is_instance_valid(log_carry):
		log_carry.queue_free()
	build_mode = (load(BUILD_MODE_SCRIPT) as GDScript).new()
	build_mode.name = "BuildMode"
	build_mode.set(&"player", p)
	add_child(build_mode)
	log_carry = (load(LOG_CARRY_SCRIPT) as GDScript).new()
	log_carry.name = "LogCarry"
	log_carry.set(&"player", p)
	p.add_child(log_carry)


# ---------------------------------------------------------------------------------------------- queries

func structures() -> Array[BuildStructure]:
	var out: Array[BuildStructure] = []
	for c in get_children():
		if c is BuildStructure and not c.is_queued_for_deletion():
			out.append(c)
	return out


func free_objects() -> Array[Node3D]:
	_ensure_free_root()
	var out: Array[Node3D] = []
	for c in free_root.get_children():
		if c is Node3D and not c.is_queued_for_deletion():
			out.append(c)
	return out


func structures_near(pos: Vector3, radius: float) -> Array[BuildStructure]:
	var out: Array[BuildStructure] = []
	for s in structures():
		var local := s.local_of(pos)
		if s.distance_to_footprint(local) <= radius + 1.5 and absf(local.y) < 40.0:
			out.append(s)
	return out


func structure_by_id(sid: int) -> BuildStructure:
	for s in structures():
		if s.sid == sid:
			return s
	return null


## Terrain / world height below (x, z), ignoring player-built pieces. Physics ray first (works with any
## world collision), TerrainData as the fallback.
static func ground_height(x: float, z: float, from_y: float = INF) -> float:
	var td := TerrainData.get_height(x, z)
	var root := instance
	if root != null and root.is_inside_tree():
		var space := root.get_world_3d().direct_space_state
		if space:
			# From just above a known surface (so an overhang above doesn't count), else from high up.
			var top := maxf(from_y + 4.0, td + 4.0) if is_finite(from_y) else td + 400.0
			var q := PhysicsRayQueryParameters3D.create(Vector3(x, top, z), Vector3(x, minf(top, td) - 600.0, z), 1)
			q.collide_with_areas = false
			var hit := space.intersect_ray(q)
			if not hit.is_empty():
				return (hit["position"] as Vector3).y
	return td


# ---------------------------------------------------------------------------------------------- placing

func new_structure(xf: Transform3D) -> BuildStructure:
	var s := BuildStructure.new()
	s.sid = _next_sid
	_next_sid += 1
	s.name = "Structure%d" % s.sid
	s.transform = xf
	add_child(s)
	return s


func place_grid(s: BuildStructure, id: StringName, slot: Vector3i, props: Dictionary = {}, done := false) -> BuildPiece:
	if s == null:
		return null
	return s.add_piece(id, slot, props, done)


## Instances a free piece's scene at `xf` (world). done = already built.
func place_free(id: StringName, xf: Transform3D, done := false) -> Node3D:
	_ensure_free_root()
	var ps := BuildCatalog.scene_of(id)
	if ps == null:
		push_warning("BuildingRoot: no scene for %s" % id)
		return null
	var n := ps.instantiate() as Node3D
	if n == null:
		return null
	n.transform = xf
	if n is BuildObject:
		(n as BuildObject).prepare(id, done)
	else:
		BuildHooks.attach(n, id, done)
	free_root.add_child(n)
	if done:
		Events.structure_built.emit(id, n)
	return n


static func component_of(n: Node) -> BuildComponent:
	if n == null:
		return null
	if n is BuildPiece:
		return (n as BuildPiece).build
	if n is BuildObject:
		return (n as BuildObject).build
	return n.get_node_or_null(^"Build") as BuildComponent


# ---------------------------------------------------------------------------------------------- dismantling

## Takes `node` apart (hammer + hold interact): refunds into the player's pack (overflow is dropped); grid
## pieces that lose their support collapse and drop their own refund; camp pieces standing on a removed deck
## topple too.
static func dismantle(node: Node, player: Node) -> void:
	if node == null or not is_instance_valid(node):
		return
	var root := instance
	var inv := ItemActions.inventory_of(player) if player else null
	var comp := component_of(node)
	var at := (node as Node3D).global_position if node is Node3D else Vector3.ZERO
	if comp:
		_give(comp.refund(), inv, at + Vector3(0.0, 0.8, 0.0))
	Audio.play_sfx(&"wood_creak", at + Vector3(0.0, 1.0, 0.0))
	Audio.play_sfx(&"drop", at)
	if node is BuildPiece:
		var piece := node as BuildPiece
		var s := piece.structure
		var falling: Array[BuildPiece] = s.unsupported_after([piece]) if s else []
		var removed_decks: Array[Vector3i] = []
		if piece.layer() == &"deck":
			removed_decks.append(piece.slot)
		Events.structure_destroyed.emit(piece.buildable_id, piece)
		if s:
			s.remove_piece(piece)
		for f in falling:
			var fc := f.build
			if fc:
				_give(fc.refund(), null, f.global_position + Vector3(0.0, 0.5, 0.0))
			if f.layer() == &"deck":
				removed_decks.append(f.slot)
			Events.structure_destroyed.emit(f.buildable_id, f)
			s.remove_piece(f)
		if root and s:
			root._topple_objects_on(s, removed_decks)
			if s.piece_count() == 0:
				s.queue_free()
		if not falling.is_empty():
			Game.notify("%d unsupported piece%s came down" % [falling.size(), "" if falling.size() == 1 else "s"], &"warning")
	else:
		var id: StringName = comp.id if comp else &""
		Events.structure_destroyed.emit(id, node)
		node.queue_free()


func _topple_objects_on(s: BuildStructure, decks: Array[Vector3i]) -> void:
	if decks.is_empty():
		return
	for o in free_objects():
		if o is BuildObject and (o as BuildObject).support_structure == s and decks.has((o as BuildObject).support_slot):
			var c := component_of(o)
			if c:
				_give(c.refund(), null, o.global_position + Vector3(0.0, 0.4, 0.0))
			Events.structure_destroyed.emit(c.id if c else &"", o)
			o.queue_free()


## Puts items into `inv` (if any); what doesn't fit is dropped as pickups at `at`.
static func _give(items: Dictionary, inv: Inventory, at: Vector3) -> void:
	for k in items:
		var n := int(items[k])
		if n <= 0:
			continue
		var left := inv.add(StringName(k), n) if inv != null else n
		if inv != null and left < n:
			Events.item_picked_up.emit(StringName(k), n - left)
		var limit := maxi(Inventory.stack_limit(StringName(k)), 1)
		while left > 0:
			var c := mini(left, limit)
			ItemsRoot.spawn(StringName(k), c, at + Vector3(randf_range(-0.3, 0.3), 0.0, randf_range(-0.3, 0.3)),
				Vector3(randf_range(-1.0, 1.0), 1.5, randf_range(-1.0, 1.0)))
			left -= c


# ---------------------------------------------------------------------------------------------- persistence

func get_save_key() -> String:
	return "building"


func save_state() -> Dictionary:
	var list := []
	for s in structures():
		if s.piece_count() > 0:
			list.append(s.save_state())
	var objs := []
	for o in free_objects():
		var c := component_of(o)
		if c == null:
			continue
		var d := {"id": String(c.id), "xf": SaveUtil.xform(o.transform)}
		d.merge(c.save_data())
		if o.has_method(&"save_extra"):
			var extra: Dictionary = o.call(&"save_extra")
			if not extra.is_empty():
				d["state"] = extra
		if o is BuildObject and (o as BuildObject).support_structure != null and is_instance_valid((o as BuildObject).support_structure):
			var bo := o as BuildObject
			d["on"] = [bo.support_structure.sid, bo.support_slot.x, bo.support_slot.y, bo.support_slot.z]
		objs.append(d)
	return {"version": 1, "structures": list, "free": objs}


func load_state(d: Dictionary) -> void:
	for s in structures():
		remove_child(s)
		s.queue_free()
	for o in free_objects():
		free_root.remove_child(o)
		o.queue_free()
	_next_sid = 1
	for sd in d.get("structures", []):
		if not (sd is Dictionary):
			continue
		var s := new_structure(Transform3D.IDENTITY)
		if (sd as Dictionary).has("sid"):
			s.sid = int(sd["sid"])
			_next_sid = maxi(_next_sid, s.sid + 1)
		s.load_state(sd)
	for od in d.get("free", []):
		if not (od is Dictionary):
			continue
		var odd: Dictionary = od
		var id := StringName(odd.get("id", ""))
		if ItemDB.get_buildable(id).is_empty():
			continue
		var n := place_free(id, SaveUtil.to_xform(odd.get("xf", [])), bool(odd.get("done", false)))
		if n == null:
			continue
		var c := component_of(n)
		if c:
			c.load_data(odd)
			c.progressed.emit(c.fraction())
		if odd.get("state", null) is Dictionary and n.has_method(&"load_extra"):
			n.call(&"load_extra", odd["state"])
		if odd.get("on", null) is Array and n is BuildObject:
			var on: Array = odd["on"]
			if on.size() == 4:
				(n as BuildObject).support_structure = structure_by_id(int(on[0]))
				(n as BuildObject).support_slot = Vector3i(int(on[1]), int(on[2]), int(on[3]))

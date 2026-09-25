class_name BuildStructure
extends Node3D
## A connected log building on its own 2 m grid (see BuildGrid). Owns its grid pieces (BuildPiece children,
## one per slot and layer), derives the joinery that depends on neighbours — sills and stilt posts under the
## foundations, projecting saddle-notched log ends at corners, gable infill under roof ends, roof overhangs at
## the gables, ridge caps — and draws every completed piece through one MultiMesh per mesh (a cabin of
## 200 pieces is a few dozen draw calls). Also: structural support rules, rooms → shelter Area3Ds (group
## "shelter", shelter_factor from walls/roof/door state) with a room-heat source that makes fires inside count
## for the whole room, and save/load of its pieces.

signal changed()

const LAYERS: Array[StringName] = [&"deck", &"wall", &"roof", &"stairs", &"node", &"door"]
const VIS_RANGE_DESKTOP := 900.0
const VIS_RANGE_MOBILE := 420.0
const BRACE_MIN_POST := 1.25

var sid := 0
var pieces: Dictionary = {}                  # "layer:x,y,z" -> BuildPiece
var rooms: Array[Dictionary] = []            # {cells: Array[Vector3i], level, factor, area: Area3D, heat: Node3D}
var instance_counts: Dictionary = {}         # mesh name -> instances (tests / perf)

var _visual: Node3D
var _posts: StaticBody3D
var _rooms_root: Node3D
var _mms: Dictionary = {}                    # StringName -> MultiMeshInstance3D
var _dirty := false
var _ground_cache: Dictionary = {}           # node Vector3i -> ground y (local)


func _ready() -> void:
	add_to_group(&"build_structure")
	_ensure_children()
	if not pieces.is_empty():
		mark_dirty()


func _ensure_children() -> void:
	if _visual != null:
		return
	_visual = Node3D.new()
	_visual.name = "Visual"
	add_child(_visual)
	_posts = StaticBody3D.new()
	_posts.name = "Posts"
	_posts.collision_layer = BuildPiece.LAYER_BUILDING
	_posts.collision_mask = 0
	_posts.set_meta(&"surface", &"wood")
	add_child(_posts)
	_rooms_root = Node3D.new()
	_rooms_root.name = "Rooms"
	add_child(_rooms_root)


static func key(layer: StringName, slot: Vector3i) -> String:
	return "%s:%d,%d,%d" % [layer, slot.x, slot.y, slot.z]


func get_piece(layer: StringName, slot: Vector3i) -> BuildPiece:
	var p: Variant = pieces.get(key(layer, slot))
	return p if p != null and is_instance_valid(p) else null


func has_piece(layer: StringName, slot: Vector3i) -> bool:
	return get_piece(layer, slot) != null


func piece_list() -> Array[BuildPiece]:
	var out: Array[BuildPiece] = []
	for k in pieces:
		var p: BuildPiece = pieces[k]
		if is_instance_valid(p) and not p.is_queued_for_deletion():
			out.append(p)
	return out


func piece_count() -> int:
	return piece_list().size()


# ---------------------------------------------------------------------------------------------- add / remove

func add_piece(id: StringName, slot: Vector3i, props: Dictionary = {}, done := false, announce := true) -> BuildPiece:
	_ensure_children()
	var layer := BuildPiece.layer_of(id)
	var k := key(layer, slot)
	if pieces.has(k) and is_instance_valid(pieces[k]):
		return null
	var piece: BuildPiece = null
	var ps := BuildCatalog.scene_of(id)
	if ps:
		piece = ps.instantiate() as BuildPiece
	if piece == null:
		piece = BuildDoor.new() if id == &"door" else BuildPiece.new()
	piece.name = "%s_%d_%d_%d" % [id, slot.x, slot.y, slot.z]
	piece.setup(self, id, slot, props, done)
	pieces[k] = piece
	add_child(piece)
	mark_dirty()
	if done and announce:
		Events.structure_built.emit(id, piece)
	return piece


func remove_piece(piece: BuildPiece) -> void:
	if piece == null:
		return
	var k := key(piece.layer(), piece.slot)
	if pieces.get(k) == piece:
		pieces.erase(k)
	if piece.is_inside_tree():
		piece.get_parent().remove_child(piece)
	piece.queue_free()
	mark_dirty()


func on_piece_completed(piece: BuildPiece) -> void:
	Events.structure_built.emit(piece.buildable_id, piece)
	mark_dirty()


func mark_dirty() -> void:
	if _dirty:
		return
	_dirty = true
	_flush.call_deferred()


func _flush() -> void:
	if not _dirty or not is_inside_tree():
		return
	_dirty = false
	rebuild_visuals()
	rebuild_shelter()
	changed.emit()


## Rebuild now (tests, loading screens).
func flush_now() -> void:
	_dirty = true
	_flush()


# ---------------------------------------------------------------------------------------------- queries

func _complete(layer: StringName, slot: Vector3i) -> BuildPiece:
	var p := get_piece(layer, slot)
	return p if p != null and p.is_complete() else null


func is_wallish(slot: Vector3i, only_complete := false) -> bool:
	var p := _complete(&"wall", slot) if only_complete else get_piece(&"wall", slot)
	return p != null and p.buildable_id != &"log_railing"


func deck_at(cell: Vector3i, only_complete := false) -> bool:
	return (_complete(&"deck", cell) if only_complete else get_piece(&"deck", cell)) != null


func roof_at(cell: Vector3i, only_complete := false) -> BuildPiece:
	return _complete(&"roof", cell) if only_complete else get_piece(&"roof", cell)


## A cell is covered (no snow on its deck, sheltered from above) by a roof at its level or a floor above.
func is_covered(cell: Vector3i, only_complete := true) -> bool:
	return roof_at(cell, only_complete) != null or deck_at(cell + Vector3i(0, 1, 0), only_complete)


func local_of(world: Vector3) -> Vector3:
	return global_transform.affine_inverse() * world


func world_of(local: Vector3) -> Vector3:
	return global_transform * local


## Cells of all decks (any level) — used for "near this structure" tests.
func footprint_cells() -> Array[Vector3i]:
	var out: Array[Vector3i] = []
	for p in piece_list():
		if p.layer() == &"deck":
			out.append(p.slot)
	return out


## Distance (m, XZ) from a local point to the nearest deck cell centre.
func distance_to_footprint(local: Vector3) -> float:
	var best := INF
	for c in footprint_cells():
		best = minf(best, Vector2(local.x - c.x, local.z - c.z).length())
	return best


# ---------------------------------------------------------------------------------------------- support

## "" if a piece `id` may go at `slot` (with `props`) given the current pieces, else the reason.
func placement_problem(id: StringName, slot: Vector3i, props: Dictionary) -> String:
	var layer := BuildPiece.layer_of(id)
	if has_piece(layer, slot):
		return "Occupied"
	var kind := BuildCatalog.kind_of(id)
	match kind:
		&"deck":
			if id == &"log_foundation" and slot.y != 0:
				return "Foundations sit on the ground"
			if id == &"log_floor" and slot.y < 1:
				return "Floors go on top of walls"
			if BuildGrid.kind_of(slot) != BuildGrid.Kind.CELL:
				return "Invalid slot"
		&"wall":
			var k := BuildGrid.kind_of(slot)
			if k != BuildGrid.Kind.XEDGE and k != BuildGrid.Kind.ZEDGE:
				return "Invalid slot"
		&"roof":
			if deck_at(slot + Vector3i(0, 1, 0)):
				return "Occupied"
		&"stairs":
			if slot.y < 0:
				return "Invalid slot"
		&"door":
			var dw := get_piece(&"wall", slot)
			if dw == null or dw.buildable_id != &"log_doorway":
				return "Needs a log doorway"
	var ok := func(l: StringName, s: Vector3i) -> bool: return has_piece(l, s)
	if not _rule(id, slot, props, ok):
		return "Needs support"
	return ""


## Support rule for one piece; `ok.call(layer, slot)` says whether a supporting piece exists there.
func _rule(id: StringName, slot: Vector3i, props: Dictionary, ok: Callable) -> bool:
	var L := slot.y
	var down := Vector3i(0, -1, 0)
	match BuildCatalog.kind_of(id):
		&"deck":
			if id == &"log_foundation":
				return true
			if _floor_direct(slot, ok):
				return true
			for d in 4:
				var n := BuildGrid.cell_step(slot, d)
				if ok.call(&"deck", n) and _floor_direct(n, ok):
					return true
			return false
		&"wall":
			for c in BuildGrid.edge_cells(slot):
				if ok.call(&"deck", c):
					return true
			return ok.call(&"wall", slot + down)
		&"door":
			return ok.call(&"wall", slot)
		&"node":
			for c in BuildGrid.node_cells(slot):
				if ok.call(&"deck", c):
					return true
			return false
		&"stairs":
			return ok.call(&"deck", slot)
		&"roof":
			var dir := int(props.get("dir", 0))
			var tier := int(props.get("tier", 0))
			var shape := String(props.get("shape", "slope"))
			if tier == 0:
				for e in BuildGrid.cell_edges(slot):
					if ok.call(&"wall", e):
						return true
				for n in BuildGrid.cell_nodes(slot):
					if ok.call(&"node", n):
						return true
			for e in BuildGrid.roof_side_edges(slot, dir):
				if ok.call(&"wall", e):
					return true
			if tier > 0:
				var lows := [BuildGrid.cell_step(slot, dir + 2)]
				if shape == "peak":
					lows.append(BuildGrid.cell_step(slot, dir))
				for n in lows:
					if ok.call(&"roof", n):
						return true
			for sd in [dir + 1, dir + 3]:
				var n2 := BuildGrid.cell_step(slot, sd)
				if ok.call(&"roof", n2):
					var rp := get_piece(&"roof", n2)
					if rp and int(rp.props.get("tier", 0)) == tier:
						return true
			return false
	return true


func _floor_direct(cell: Vector3i, ok: Callable) -> bool:
	var below := cell + Vector3i(0, -1, 0)
	for e in BuildGrid.cell_edges(below):
		if ok.call(&"wall", e):
			return true
	for n in BuildGrid.cell_nodes(below):
		if ok.call(&"node", n):
			return true
	return false


## Pieces that would lose support if `removed` were taken away (fixpoint from the foundations up).
func unsupported_after(removed: Array) -> Array[BuildPiece]:
	var gone := {}
	for r in removed:
		if r is BuildPiece:
			gone[key((r as BuildPiece).layer(), (r as BuildPiece).slot)] = true
	var good := {}
	var all := piece_list()
	var changed_any := true
	var okc := func(l: StringName, s: Vector3i) -> bool: return good.has(key(l, s))
	while changed_any:
		changed_any = false
		for p in all:
			var k := key(p.layer(), p.slot)
			if gone.has(k) or good.has(k):
				continue
			if _rule(p.buildable_id, p.slot, p.props, okc):
				good[k] = true
				changed_any = true
	var out: Array[BuildPiece] = []
	for p in all:
		var k := key(p.layer(), p.slot)
		if not gone.has(k) and not good.has(k):
			out.append(p)
	return out


# ---------------------------------------------------------------------------------------------- roof helpers

## Tier / shape / eave a roof would get at `cell` rising toward `dir` (auto peak between two facing slopes).
func roof_props_for(cell: Vector3i, dir: int) -> Dictionary:
	# Between two roofs rising toward this cell along either axis: a peak.
	for axis in [dir, dir + 1]:
		var a := get_piece(&"roof", BuildGrid.cell_step(cell, axis + 2))
		var b := get_piece(&"roof", BuildGrid.cell_step(cell, axis))
		if a and b and String(a.props.get("shape", "slope")) == "slope" and String(b.props.get("shape", "slope")) == "slope":
			if posmod(int(a.props.get("dir", 0)), 4) == posmod(axis, 4) and posmod(int(b.props.get("dir", 0)), 4) == posmod(axis + 2, 4) \
					and int(a.props.get("tier", 0)) == int(b.props.get("tier", 0)):
				return {"dir": posmod(axis, 4), "tier": int(a.props.get("tier", 0)) + 1, "shape": "peak"}
	var low := get_piece(&"roof", BuildGrid.cell_step(cell, dir + 2))
	if low and posmod(int(low.props.get("dir", 0)), 4) == posmod(dir, 4) and String(low.props.get("shape", "slope")) == "slope":
		return {"dir": posmod(dir, 4), "tier": int(low.props.get("tier", 0)) + 1, "shape": "slope"}
	# Same tier as a neighbour along the ridge line.
	for sd in [dir + 1, dir + 3]:
		var s := get_piece(&"roof", BuildGrid.cell_step(cell, sd))
		if s and posmod(int(s.props.get("dir", 0)), 4) == posmod(dir, 4):
			return {"dir": posmod(dir, 4), "tier": int(s.props.get("tier", 0)), "shape": String(s.props.get("shape", "slope"))}
	# A single cell between two walls (a 2 m wide hut or cache): a small gable roof over it.
	if is_wallish(BuildGrid.cell_side_edge(cell, dir)) and is_wallish(BuildGrid.cell_side_edge(cell, dir + 2)):
		return {"dir": posmod(dir, 4), "tier": 0, "shape": "peak"}
	return {"dir": posmod(dir, 4), "tier": 0, "shape": "slope"}


## Natural rise direction for a new roof at `cell`: continue a slope, or rise away from an eave wall, facing
## `prefer` first.
func auto_roof_dir(cell: Vector3i, prefer: int) -> int:
	for i in 4:
		var d := posmod(prefer + i, 4)
		var low := get_piece(&"roof", BuildGrid.cell_step(cell, d + 2))
		if low and posmod(int(low.props.get("dir", 0)), 4) == d:
			return d
	for i in 4:
		var d := posmod(prefer + i, 4)
		# eave wall on the low side and the high side leads into the structure
		if is_wallish(BuildGrid.cell_side_edge(cell, d + 2)) and deck_at(BuildGrid.cell_step(cell, d) + Vector3i(0, 0, 0)):
			return d
	for i in 4:
		var d := posmod(prefer + i, 4)
		if is_wallish(BuildGrid.cell_side_edge(cell, d + 2)):
			return d
	return posmod(prefer, 4)


# ---------------------------------------------------------------------------------------------- visuals

func _push(inst: Dictionary, mesh_name: StringName, xf: Transform3D, exposure: float, seed := -1.0) -> void:
	if not inst.has(mesh_name):
		inst[mesh_name] = []
	var s := seed
	if s < 0.0:
		var o := xf.origin
		s = fposmod(sin(o.x * 12.9898 + o.y * 78.233 + o.z * 37.719) * 43758.5453, 1.0)
	(inst[mesh_name] as Array).append([xf, exposure, s])


func rebuild_visuals() -> void:
	_ensure_children()
	var inst := {}
	var sill_edges := {}
	var post_nodes := {}
	var gable_edges := {}
	for p in piece_list():
		if not p.is_complete():
			continue
		var exposure := _exposure_of(p)
		for part in BuildCatalog.piece_parts(p.buildable_id, p.slot, p.props):
			_push(inst, part[0], p.transform * (part[1] as Transform3D), exposure)
		match p.buildable_id:
			&"log_foundation":
				sill_edges[p.slot + Vector3i(0, 0, 1)] = true
				sill_edges[p.slot + Vector3i(0, 0, -1)] = true
				for n in BuildGrid.cell_nodes(p.slot):
					post_nodes[n] = true
			&"log_wall", &"log_window_wall", &"log_doorway":
				_wall_stubs(inst, p, exposure)
			&"log_roof":
				_roof_extras(inst, p, gable_edges)
	for e in sill_edges:
		_push(inst, &"sill", Transform3D(Basis.IDENTITY, BuildGrid.slot_position(e)), 1.0)
	_build_posts(inst, post_nodes)
	instance_counts.clear()
	for n in inst:
		instance_counts[n] = (inst[n] as Array).size()
	var batcher := _batcher()
	if batcher:
		for n in _mms.keys():
			(_mms[n] as Node).queue_free()
		_mms.clear()
		batcher.submit(self, inst)
	else:
		_apply_multimeshes(inst)


func _batcher() -> BuildBatcher:
	var root := get_parent() as BuildingRoot
	return root.batcher if root and root.batcher and is_instance_valid(root.batcher) else null


func _exit_tree() -> void:
	var b := _batcher()
	if b:
		b.remove(self)


func _exposure_of(p: BuildPiece) -> float:
	match p.layer():
		&"deck":
			return 0.0 if is_covered(p.slot) else 1.0
		&"wall":
			for c in BuildGrid.edge_cells(p.slot):
				if is_covered(c):
					return 0.0
			return 1.0
		&"node":
			return 0.4
	return 1.0


func _wall_stubs(inst: Dictionary, p: BuildPiece, exposure: float) -> void:
	var parity := BuildGrid.edge_parity(p.slot)
	for n in BuildGrid.edge_nodes(p.slot):
		if is_wallish(BuildGrid.collinear_edge(p.slot, n), true):
			continue
		var d := n - p.slot
		var yaw := atan2(-float(d.z), float(d.x))
		_push(inst, StringName("stub_" + parity), Transform3D(Basis(Vector3.UP, yaw), BuildGrid.slot_position(n)),
			maxf(exposure, 0.6))


func _roof_extras(inst: Dictionary, p: BuildPiece, gable_edges: Dictionary) -> void:
	var dir := int(p.props.get("dir", 0))
	var tier := int(p.props.get("tier", 0))
	var shape := String(p.props.get("shape", "slope"))
	var cell := p.slot
	var yaw := BuildGrid.dir_yaw(dir)
	# gable infill where a wall stands under a side edge of this roof piece
	var max_tier := 2 if shape == "slope" else 1
	if tier <= max_tier:
		for e in BuildGrid.roof_side_edges(cell, dir):
			if gable_edges.has(e) or not is_wallish(e, true):
				continue
			gable_edges[e] = true
			var gname := StringName("gable_%s_t%d_%s" % [shape, tier, BuildGrid.edge_parity(e)])
			_push(inst, gname, Transform3D(Basis(Vector3.UP, yaw), BuildGrid.slot_position(e)), 1.0)
	# overhang past the gable where no roof continues sideways
	for side in [["pz", dir + 1], ["nz", dir + 3]]:
		if roof_at(BuildGrid.cell_step(cell, side[1]), true) == null:
			_push(inst, BuildCatalog.roof_mesh_name(p.props, cell, side[0]), p.transform, 1.0)
	# ridge cap where two slopes meet high edge to high edge
	if shape == "slope" and (dir == 0 or dir == 1):
		var nb := roof_at(BuildGrid.cell_step(cell, dir), true)
		if nb and String(nb.props.get("shape", "slope")) == "slope" and posmod(int(nb.props.get("dir", 0)), 4) == posmod(dir + 2, 4) \
				and int(nb.props.get("tier", 0)) == tier:
			var e := BuildGrid.cell_side_edge(cell, dir)
			var pos := BuildGrid.slot_position(e) + Vector3(0.0, BuildGrid.WALL_TOP + tier * BuildGrid.ROOF_RISE, 0.0)
			var xf := Transform3D(Basis(Vector3.UP, yaw), pos)
			_push(inst, &"ridge_cap", xf, 1.0)
			if roof_at(BuildGrid.cell_step(cell, dir + 1), true) == null:
				_push(inst, &"ridge_cap_pz", xf, 1.0)
			if roof_at(BuildGrid.cell_step(cell, dir + 3), true) == null:
				_push(inst, &"ridge_cap_nz", xf, 1.0)


func _build_posts(inst: Dictionary, nodes: Dictionary) -> void:
	for c in _posts.get_children():
		c.free()
	var lengths := {}
	for n in nodes:
		var local := BuildGrid.slot_position(n)
		var g: float
		if _ground_cache.has(n):
			g = _ground_cache[n]
		else:
			var wp := world_of(Vector3(local.x, 0.0, local.z))
			g = local_of(Vector3(wp.x, BuildingRoot.ground_height(wp.x, wp.z, wp.y + 1.0), wp.z)).y
			_ground_cache[n] = g
		var L := BuildGrid.post_length(0.0, g)
		lengths[n] = L
		if L < 0.12:
			continue
		var mesh_name := &"post_s"
		var nominal := 0.8
		if L > 2.2:
			mesh_name = &"post_l"
			nominal = 3.2
		elif L > 1.05:
			mesh_name = &"post_m"
			nominal = 1.6
		var top := Vector3(local.x, BuildGrid.POST_TOP, local.z)
		var yaw := fposmod(float(n.x * 7 + n.z * 13), TAU)
		var b := Basis(Vector3.UP, yaw).scaled(Vector3(1.0, L / nominal, 1.0))
		_push(inst, mesh_name, Transform3D(b, top), 1.0)
		_push(inst, &"footing", Transform3D(Basis(Vector3.UP, yaw * 1.7), Vector3(local.x, g + 0.03, local.z)), 1.0)
		var cs := CollisionShape3D.new()
		var cy := CylinderShape3D.new()
		cy.radius = 0.13
		cy.height = maxf(L - 0.08, 0.1)
		cs.shape = cy
		cs.position = Vector3(local.x, BuildGrid.POST_TOP - cy.height * 0.5, local.z)
		_posts.add_child(cs)
	# tall stilts get diagonal braces to their neighbours (along the sills and across)
	for n in lengths:
		for step in [Vector3i(2, 0, 0), Vector3i(0, 0, 2)]:
			var m: Vector3i = n + step
			if not lengths.has(m):
				continue
			var la: float = lengths[n]
			var lb: float = lengths[m]
			if minf(la, lb) < BRACE_MIN_POST:
				continue
			var flip := posmod((n.x + n.z) / 2, 2) == 1
			var a := BuildGrid.slot_position(n)
			var b := BuildGrid.slot_position(m)
			var top := BuildGrid.POST_TOP - 0.12
			var pa := Vector3(a.x, top if not flip else top - minf(la, lb) * 0.72, a.z)
			var pb := Vector3(b.x, top - minf(la, lb) * 0.72 if not flip else top, b.z)
			var d := pb - pa
			var xa := d * 0.5
			var ya := Vector3.UP.cross(d).cross(d).normalized() * -1.0
			var za := xa.normalized().cross(ya).normalized()
			_push(inst, &"brace", Transform3D(Basis(xa, ya, za), (pa + pb) * 0.5), 1.0)


## Forgets cached ground heights (terrain changed / tests).
func clear_ground_cache() -> void:
	_ground_cache.clear()


func _apply_multimeshes(inst: Dictionary) -> void:
	var mobile := Settings.is_mobile()
	for name in _mms.keys():
		if not inst.has(name):
			(_mms[name] as Node).queue_free()
			_mms.erase(name)
	for name in inst:
		var list: Array = inst[name]
		var mesh := BuildCatalog.get_mesh(name)
		if mesh == null:
			continue
		var mmi: MultiMeshInstance3D = _mms.get(name)
		if mmi == null:
			mmi = MultiMeshInstance3D.new()
			mmi.name = String(name)
			mmi.visibility_range_end = VIS_RANGE_MOBILE if mobile else VIS_RANGE_DESKTOP
			mmi.visibility_range_end_margin = 20.0
			mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
			_visual.add_child(mmi)
			_mms[name] = mmi
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = mesh
		mm.instance_count = list.size()
		for i in list.size():
			var e: Array = list[i]
			mm.set_instance_transform(i, e[0])
			mm.set_instance_custom_data(i, Color(float(e[2]), float(e[1]), 0.0, 1.0))
		mmi.multimesh = mm
		# Distant structures: drop fine shadow detail (stubs/strips/footings) on mobile.
		if mobile and (String(name).begins_with("stub_") or String(name).begins_with("footing") or String(name).ends_with("_pz") or String(name).ends_with("_nz")):
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


## Distinct meshes this structure draws (each is one MultiMesh in its cluster).
func multimesh_count() -> int:
	return instance_counts.size()


# ---------------------------------------------------------------------------------------------- shelter

func rebuild_shelter() -> void:
	_ensure_children()
	for r in rooms:
		if is_instance_valid(r.get("area")):
			(r["area"] as Node).queue_free()
		if is_instance_valid(r.get("heat")):
			(r["heat"] as Node).queue_free()
	rooms.clear()
	var decks := {}
	for p in piece_list():
		if p.layer() == &"deck" and p.is_complete():
			decks[p.slot] = true
	var seen := {}
	for c in decks:
		if seen.has(c):
			continue
		var cells: Array[Vector3i] = []
		var stack: Array[Vector3i] = [c]
		seen[c] = true
		while not stack.is_empty():
			var cur: Vector3i = stack.pop_back()
			cells.append(cur)
			for d in 4:
				var e := BuildGrid.cell_side_edge(cur, d)
				var w := _complete(&"wall", e)
				if w != null and BuildCatalog.partitions(w.buildable_id):
					continue
				var n := BuildGrid.cell_step(cur, d)
				if decks.has(n) and not seen.has(n):
					seen[n] = true
					stack.append(n)
		_make_room(cells)
	if Climate.has_method(&"refresh_sources"):
		Climate.refresh_sources()


## Openness of a room's perimeter (Σ 1 − closure) and roof cover (0..1).
func room_metrics(cells: Array[Vector3i]) -> Dictionary:
	var inside := {}
	for c in cells:
		inside[c] = true
	var openness := 0.0
	var perimeter := 0
	var covered := 0
	for c in cells:
		if is_covered(c):
			covered += 1
		for d in 4:
			if inside.has(BuildGrid.cell_step(c, d)):
				continue
			perimeter += 1
			openness += 1.0 - edge_closure(BuildGrid.cell_side_edge(c, d))
	return {"openness": openness, "perimeter": perimeter, "cover": float(covered) / maxf(1.0, float(cells.size()))}


func edge_closure(e: Vector3i) -> float:
	var w := _complete(&"wall", e)
	if w == null:
		return 0.0
	if w.buildable_id == &"log_doorway":
		var door := _complete(&"door", e) as BuildDoor
		if door:
			return 1.0 if not door.is_open else 0.45
		return BuildCatalog.closure_of(w.buildable_id)
	return BuildCatalog.closure_of(w.buildable_id)


func _make_room(cells: Array[Vector3i]) -> void:
	var m := room_metrics(cells)
	var factor := BuildGrid.shelter_factor(float(m["cover"]), float(m["openness"]))
	var level := cells[0].y
	var area := BuildShelterArea.new()
	area.name = "Room%d" % rooms.size()
	area.shelter_factor = factor
	var height := BuildGrid.WALL_TOP + 0.6
	for c in cells:
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(2.9, height, 2.9)
		cs.shape = box
		cs.position = BuildGrid.slot_position(c) + Vector3(0.0, height * 0.5 - 0.1, 0.0)
		area.add_child(cs)
	_rooms_root.add_child(area)
	var centre := Vector3.ZERO
	for c in cells:
		centre += BuildGrid.slot_position(c)
	centre /= float(cells.size())
	var radius := 0.0
	for c in cells:
		radius = maxf(radius, (BuildGrid.slot_position(c) - centre).length())
	var heat := BuildRoomHeat.new()
	heat.name = "Heat%d" % rooms.size()
	heat.area = area
	heat.heat_radius = radius + 2.2
	heat.position = centre + Vector3(0.0, 1.1, 0.0)
	_rooms_root.add_child(heat)
	rooms.append({"cells": cells, "level": level, "factor": factor, "area": area, "heat": heat,
		"openness": m["openness"], "cover": m["cover"]})


## Shelter factor of the room containing a local cell (0 if none).
func shelter_of_cell(cell: Vector3i) -> float:
	for r in rooms:
		if (r["cells"] as Array).has(cell):
			return float(r["factor"])
	return 0.0


# ---------------------------------------------------------------------------------------------- save

func save_state() -> Dictionary:
	var list := []
	for p in piece_list():
		list.append(p.save_data())
	return {"sid": sid, "xf": SaveUtil.xform(transform), "pieces": list}


func load_state(d: Dictionary) -> void:
	transform = SaveUtil.to_xform(d.get("xf", []))
	for e in d.get("pieces", []):
		if not (e is Dictionary):
			continue
		var ed: Dictionary = e
		var id := StringName(ed.get("id", ""))
		if not BuildCatalog.is_grid(id):
			continue
		var s: Array = ed.get("slot", [0, 0, 0])
		var slot := Vector3i(int(s[0]), int(s[1]), int(s[2]))
		var props: Dictionary = ed.get("props", {})
		var p := add_piece(id, slot, props, bool(ed.get("done", false)), false)
		if p:
			p.build.load_data(ed)
			if ed.get("state", null) is Dictionary:
				p.load_extra(ed["state"])
			p.refresh_visual()
	mark_dirty()

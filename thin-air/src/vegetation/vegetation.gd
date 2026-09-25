class_name Vegetation
extends Node3D
## World "Vegetation" part (scenes/world/vegetation.tscn). Owns every tree, shrub, log and rock on the map.
##
## Pipeline
##   1. VegScatter generates all 48x48 cells (64 m) deterministically from TerrainData on worker threads.
##   2. NEAR FIELD — per-tree LOD: instances within the mesh range are binned (on a worker thread, whenever
##      the camera moved REBIN_STEP m) into one MultiMeshInstance3D per (asset, LOD band). Each band MMI
##      carries instance uniforms lod_begin/lod_end, and the shaders cross-fade neighbouring bands per
##      instance with complementary dithers — no per-cell popping, and only trees near the camera pay for
##      LOD0. Main bands never cast shadows; cheap shadow-only proxies (LOD1 near, LOD2 further, only
##      within shadow distance) do. Each MMI also gets visibility_range_end as a coarse cull.
##   3. FAR FIELD — per 256 m cell one MultiMesh of hemi-octahedral impostor quads for all species (one draw
##      call per cell), fading in at Settings tree_impostor_distance, culled at view_distance.
##   4. Grass / ground cover ring (VegGrass), trunk & boulder colliders near the player (VegColliders),
##      harvesting/felling (VegHarvest), persistence (group "persistent", key "vegetation").
## Settings honoured: vegetation_density, grass_distance, tree_impostor_distance, view_distance, shadow
## quality (mobile path: fewer shadowed bands). Rebuilds on Events.settings_changed.

## The cells around the start position are ready (systems can run).
signal generated()
## Every cell of the map is generated (background streaming finished).
signal all_generated()

const Cat := VegScatter.Cat
const FAR_CELL := 256.0
const REBIN_STEP := 5.0
const SAVE_KEY := "vegetation"
## Cells within this radius of the start position are generated before _ready returns; the rest of the map
## streams in on low-priority worker threads, nearest first.
const SYNC_RADIUS := 360.0

## Set before adding to the tree (dev / tests): multiplies the forest density of the scatter.
@export var density_override := -1.0
## Dev: camera to follow instead of the viewport camera.
var camera_override: Camera3D = null
## Dev/tests: generate on the calling thread (deterministic timing).
var single_threaded := false
## Dev/tests: an object with the TerrainData query API to scatter on instead of the autoload.
var terrain_override: Object = null
## Tests: generate the whole map before _ready returns (no background streaming).
var sync_all := false

var lib: VegLibrary
var ctx: VegScatter.Context
var cells: Array = []                 # VegScatter.CellData per cell index
var removed: Dictionary = {}          # instance id -> true (felled trees, taken rocks) — persisted
var hidden: Dictionary = {}           # instance id -> true (drawn by a hero node, e.g. a tree being chopped)
var is_generated := false
var fully_generated := false
var gen_msec := 0

var bands: Array = []                 # per Cat: Array of [begin, end, lod] (main pass, no shadows); lod 3 = impostor
var shadow_bands: Array = []          # per Cat: Array of [begin, end, lod] (shadow-only proxies)
var keep_frac: PackedFloat32Array = PackedFloat32Array([1, 1, 1, 1, 1, 1])
var _imp_custom: Array = []           # per kind index: impostor INSTANCE_CUSTOM Color, or null (no impostor)
var imp_distance := 160.0
var view_distance := 4000.0
var band_margin := 3.0

var _near_root: Node3D
var _far_root: Node3D
var _near: Dictionary = {}            # Vector4i(kind, band code, tile x, tile z) -> MultiMeshInstance3D
                                      # band code: main bands 0..7, shadow proxies 8..15
var _far: Dictionary = {}             # far cell index -> MultiMeshInstance3D
var _far_index: Dictionary = {}       # instance id -> Vector2i(far cell index, instance index)
var _far_centers: Dictionary = {}     # far cell index -> Vector3 centre
var _last_rebin_pos := Vector3(INF, INF, INF)
var _rebin_task := -1
var _rebin_result: Dictionary = {}
var _rebin_pending := false
var _mutex := Mutex.new()
var _gen_ctx_cells: Array = []
var _changed_since_rebin: Array = []  # ids removed/hidden while a worker rebin was running
var _bg_task := -1
var _bg_order := PackedInt32Array()
var _bg_done: Array = []              # [cell index, CellData] from the background worker (under _mutex)
var _bg_cancel := false
var _far_pending: Dictionary = {}     # far cell key -> true: waiting for its scatter cells
var _gen_t0 := 0

var harvest: Node = null
var colliders: Node = null
var grass: Node = null


func _ready() -> void:
	add_to_group(&"persistent")
	add_to_group(&"vegetation")
	lib = VegLibrary.get_shared()
	_near_root = Node3D.new()
	_near_root.name = "Near"
	add_child(_near_root)
	_far_root = Node3D.new()
	_far_root.name = "Far"
	add_child(_far_root)
	for k in lib.kind_names:
		lib.meshes(k)
		_imp_custom.append(lib.impostor_custom(k) if lib.has_impostors() and lib.info(k).has("impostor_layer") else null)
	_read_settings()
	generate()
	_attach_subsystems()
	if not Events.settings_changed.is_connected(_on_settings_changed):
		Events.settings_changed.connect(_on_settings_changed)
	set_process(true)


func _exit_tree() -> void:
	_bg_cancel = true
	if _bg_task >= 0:
		WorkerThreadPool.wait_for_group_task_completion(_bg_task)
		_bg_task = -1
	if _rebin_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_rebin_task)
		_rebin_task = -1


func _attach_subsystems() -> void:
	var scripts := {
		"Grass": "res://src/vegetation/veg_grass.gd",
		"Colliders": "res://src/vegetation/veg_colliders.gd",
		"Harvest": "res://src/vegetation/veg_harvest.gd",
	}
	for n in scripts:
		var path: String = scripts[n]
		if not ResourceLoader.exists(path):
			continue
		var node: Node = (load(path) as GDScript).new()
		node.name = n
		if "vegetation" in node:
			node.set("vegetation", self)
		add_child(node)
		match n:
			"Grass":
				grass = node
			"Colliders":
				colliders = node
			"Harvest":
				harvest = node


# ---------------------------------------------------------------------------------------------- settings

func _read_settings() -> void:
	imp_distance = float(Settings.get_value(&"tree_impostor_distance", 160.0))
	view_distance = float(Settings.get_value(&"view_distance", 4000.0))
	var dens := clampf(float(Settings.get_value(&"vegetation_density", 1.0)), 0.1, 1.0)
	# trees thin out gently (forests must stay forests), ground clutter scales directly
	keep_frac = PackedFloat32Array([0.55 + 0.45 * dens, 0.3 + 0.7 * dens, dens, 0.4 + 0.6 * dens, 1.0, dens])
	var mobile: bool = Settings.is_mobile()
	# LOD0 (<= 6k tris) only where its detail is visible; LOD1 (~1k) to ~55 % of the impostor distance
	var a := clampf(imp_distance * 0.2, 16.0, 36.0)
	var b := maxf(30.0, imp_distance * 0.55)
	var imp := imp_distance
	band_margin = clampf(imp * 0.04, 2.0, 6.0)
	var sq := int(Settings.get_value(&"shadow_quality", 2))
	var far_shadow := sq >= 2 and not mobile
	var rock_far := clampf(view_distance * 0.2, 260.0, 900.0)
	bands.clear()
	bands.resize(VegScatter.CAT_COUNT)
	shadow_bands.clear()
	shadow_bands.resize(VegScatter.CAT_COUNT)
	# main bands [begin, end, lod] (never cast shadows); shadow proxies [begin, end, lod] (SHADOWS_ONLY)
	var sh_dist := float(Settings.get_value(&"shadow_distance", 200.0))
	var sh_end := minf(imp, sh_dist)
	bands[Cat.TREE] = [[0.0, a, 0], [a, b, 1], [b, imp, 2]]
	# shadow casters: LOD1 right around the player (crisp needle-spray shadows), LOD2 tier fans, then impostor
	# quads (lod 3: 2 triangles, billboarded toward the light) out to the shadow distance — a dense forest has
	# thousands of casters within 160 m and every directional cascade draws them
	shadow_bands[Cat.TREE] = [[0.0, a * 0.5, 1], [a * 0.5, a * 1.6, 2], [a * 1.6, sh_end, 3]] if not mobile \
		else [[0.0, a, 2], [a, sh_end, 3]]
	bands[Cat.SAPLING] = [[0.0, a * 0.8, 0], [a * 0.8, b * 0.75, 1], [b * 0.75, imp * 0.8, 2]]
	shadow_bands[Cat.SAPLING] = [[0.0, minf(a, sh_end), 2]]
	var sh0 := maxf(14.0, imp * 0.22)
	var sh1 := clampf(imp * 0.6, 35.0, 110.0)
	bands[Cat.SHRUB] = [[0.0, sh0, 0], [sh0, sh1, 1], [sh1, sh1 * 1.5, 2]]
	shadow_bands[Cat.SHRUB] = [] if mobile else [[0.0, sh0, 1]]
	bands[Cat.DEADWOOD] = [[0.0, a, 0], [a, b * 1.2, 1], [b * 1.2, imp * 1.3, 2]]
	shadow_bands[Cat.DEADWOOD] = [[0.0, minf(b, sh_end), 1]]
	var r0 := 25.0 + imp * 0.18
	var r1 := 70.0 + imp * 0.6
	bands[Cat.ROCK_BIG] = [[0.0, r0, 0], [r0, r1, 1], [r1, rock_far, 2]]
	shadow_bands[Cat.ROCK_BIG] = [[0.0, minf(r1, sh_dist), 2]] if not far_shadow else [[0.0, minf(r1, sh_dist), 2], [r1, minf(rock_far, sh_dist), 2]]
	var s0 := 12.0 + imp * 0.08
	bands[Cat.ROCK_SMALL] = [[0.0, s0, 0], [s0, 22.0 + imp * 0.22, 1]]
	shadow_bands[Cat.ROCK_SMALL] = []
	var taa: bool = bool(Settings.get_value(&"taa", false)) and Settings.is_forward_plus()
	for m in lib.view_materials:
		if m.shader and m.shader.resource_path.ends_with("foliage.gdshader") or m.shader and m.shader.resource_path.ends_with("impostor.gdshader"):
			m.set_shader_parameter(&"temporal_dither", taa)


func _on_settings_changed() -> void:
	if _rebin_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_rebin_task)
		_rebin_task = -1
		_rebin_result = {}
	var old_imp := imp_distance
	var old_keep := keep_frac
	_read_settings()
	if old_imp != imp_distance or old_keep != keep_frac:
		_build_far()
	for k in _near:
		(_near[k] as MultiMeshInstance3D).queue_free()
	_near.clear()
	_last_rebin_pos = Vector3(INF, INF, INF)


## Band list of a category: Array of [begin, end, lod].
func get_bands(cat: int) -> Array:
	return bands[cat]


# ---------------------------------------------------------------------------------------------- generation

func generate() -> void:
	var t0 := Time.get_ticks_msec()
	_gen_t0 = t0
	var dens := density_override if density_override > 0.0 else 1.0
	var terrain: Object = terrain_override if terrain_override else TerrainData
	ctx = VegScatter.make_context(lib, terrain, dens)
	ctx.has_water = terrain.has_method("get_water_level")
	var n := VegScatter.GRID * VegScatter.GRID
	cells.clear()
	cells.resize(n)
	fully_generated = false
	var sp := _start_pos()
	var near := PackedInt32Array()
	var rest: Array = []
	for i in n:
		var d := _cell_distance(i % VegScatter.GRID, i / VegScatter.GRID, sp)
		if sync_all or d <= SYNC_RADIUS:
			near.append(i)
		else:
			rest.append([d, i])
	_gen_list(near)
	gen_msec = Time.get_ticks_msec() - t0
	is_generated = true
	print("VEG scatter: %d instances in %d cells in %d ms (%d cells streaming)" % [instance_count(), near.size(), gen_msec, rest.size()])
	_build_far()
	generated.emit()
	if rest.is_empty():
		_finish_generation()
		return
	rest.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	_bg_order.resize(rest.size())
	for k in rest.size():
		_bg_order[k] = rest[k][1]
	_bg_cancel = false
	var threads := clampi(OS.get_processor_count() / 2, 1, 4)
	_bg_task = WorkerThreadPool.add_group_task(_bg_cell, _bg_order.size(), threads, false, "veg_scatter_bg")


func _gen_list(list: PackedInt32Array) -> void:
	if list.is_empty():
		return
	if single_threaded:
		for i in list:
			cells[i] = VegScatter.generate_cell(ctx, i % VegScatter.GRID, i / VegScatter.GRID)
		return
	var gid := WorkerThreadPool.add_group_task(func(k: int) -> void:
		var i := list[k]
		var cd := VegScatter.generate_cell(ctx, i % VegScatter.GRID, i / VegScatter.GRID)
		_mutex.lock()
		cells[i] = cd
		_mutex.unlock(), list.size(), -1, true, "veg_scatter")
	WorkerThreadPool.wait_for_group_task_completion(gid)


func _bg_cell(k: int) -> void:
	if _bg_cancel:
		return
	var i := _bg_order[k]
	var cd := VegScatter.generate_cell(ctx, i % VegScatter.GRID, i / VegScatter.GRID)
	_mutex.lock()
	_bg_done.append([i, cd])
	_mutex.unlock()


## Main thread: moves finished background cells into `cells` (never while a rebin worker reads them).
func _drain_background() -> void:
	if _bg_task < 0:
		return
	_mutex.lock()
	var done := _bg_done
	_bg_done = []
	_mutex.unlock()
	if not done.is_empty():
		var cp := _camera_pos()
		var near_changed := false
		for pair in done:
			var i: int = pair[0]
			if cells[i] == null:
				cells[i] = pair[1]
			if _cell_distance(i % VegScatter.GRID, i / VegScatter.GRID, cp) < imp_distance + 64.0:
				near_changed = true
		if near_changed:
			_rebin_pending = true
			if colliders and colliders.has_method("mark_dirty"):
				colliders.mark_dirty()
	if WorkerThreadPool.is_group_task_completed(_bg_task):
		WorkerThreadPool.wait_for_group_task_completion(_bg_task)
		_bg_task = -1
		_mutex.lock()
		var tail := _bg_done
		_bg_done = []
		_mutex.unlock()
		for pair in tail:
			if cells[pair[0]] == null:
				cells[pair[0]] = pair[1]
		_finish_generation()


func _finish_generation() -> void:
	fully_generated = true
	_build_pending_far(1000000)
	print("VEG scatter complete: %d instances, %d ms after start" % [instance_count(), Time.get_ticks_msec() - _gen_t0])
	all_generated.emit()


## Makes sure the cells around `p` exist (teleports / loading a save far from the start position).
func ensure_generated_around(p: Vector3, radius := 200.0) -> void:
	var list := PackedInt32Array()
	var c0 := VegScatter.cell_of(p.x - radius, p.z - radius)
	var c1 := VegScatter.cell_of(p.x + radius, p.z + radius)
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			var i := VegScatter.cell_index(cx, cz)
			if cells[i] == null:
				list.append(i)
	if list.is_empty():
		return
	if _rebin_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_rebin_task)
		_rebin_task = -1
	_gen_list(list)
	_rebin_pending = true
	for i in list:
		_far_pending[_far_key_of_cell(i)] = true
	_build_pending_far(100)
	if colliders and colliders.has_method("mark_dirty"):
		colliders.mark_dirty()


func _start_pos() -> Vector3:
	if camera_override or get_viewport() and get_viewport().get_camera_3d() or Game.player:
		return _camera_pos()
	var terrain: Object = terrain_override if terrain_override else TerrainData
	var lay: Variant = terrain.get("layout")
	if lay is Dictionary:
		var spawn: Dictionary = (lay as Dictionary).get("spawn", {})
		if not spawn.is_empty():
			return Vector3(float(spawn.get("x", 0.0)), 0.0, float(spawn.get("z", 0.0)))
	return Vector3.ZERO


static func _cell_distance(cx: int, cz: int, p: Vector3) -> float:
	var o := VegScatter.cell_origin(cx, cz)
	var dx := maxf(maxf(o.x - p.x, p.x - (o.x + VegScatter.CELL)), 0.0)
	var dz := maxf(maxf(o.y - p.z, p.z - (o.y + VegScatter.CELL)), 0.0)
	return sqrt(dx * dx + dz * dz)


func instance_count() -> int:
	var total := 0
	for c in cells:
		if c:
			total += (c as VegScatter.CellData).size()
	return total


## Instance lookup: {cell: CellData, index: int} or {} if unknown.
func find_instance(id: int) -> Dictionary:
	var ci := VegScatter.id_cell(id)
	if ci < 0 or ci >= cells.size() or cells[ci] == null:
		return {}
	var cd: VegScatter.CellData = cells[ci]
	var li := id & (VegScatter.MAX_LOCAL - 1)
	if li >= cd.size() or cd.ids[li] != id:
		return {}
	return {"cell": cd, "index": li}


func instance_transform(id: int) -> Transform3D:
	var f := find_instance(id)
	if f.is_empty():
		return Transform3D.IDENTITY
	return VegScatter.transform_of(f["cell"], f["index"])


func instance_kind(id: int) -> StringName:
	var f := find_instance(id)
	if f.is_empty():
		return &""
	return lib.kind_names[(f["cell"] as VegScatter.CellData).kinds[f["index"]]]


## Instances of the given categories within radius of p: Array of {id, kind, cat, pos, scale, yaw}.
func query(p: Vector3, radius: float, cats: Array = []) -> Array:
	var out: Array = []
	var c0 := VegScatter.cell_of(p.x - radius, p.z - radius)
	var c1 := VegScatter.cell_of(p.x + radius, p.z + radius)
	var r2 := radius * radius
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			var cd: VegScatter.CellData = cells[VegScatter.cell_index(cx, cz)]
			if cd == null:
				continue
			for i in cd.size():
				var q := cd.pos[i]
				var dx := q.x - p.x
				var dz := q.z - p.z
				if dx * dx + dz * dz > r2:
					continue
				var cat := int(cd.cats[i])
				if not cats.is_empty() and not cats.has(cat):
					continue
				if removed.has(cd.ids[i]) or cd.rank[i] >= keep_frac[cat]:
					continue
				out.append({"id": cd.ids[i], "kind": lib.kind_names[cd.kinds[i]], "cat": cat, "pos": q,
					"scale": cd.scale[i], "yaw": cd.yaw[i]})
	return out


## Removes an instance for good (felled, picked up, cut down): hidden everywhere, persisted, no collider.
func remove_instance(id: int) -> void:
	if removed.has(id):
		return
	removed[id] = true
	hidden.erase(id)
	_hide_in_far(id)
	_hide_in_near(id)
	_changed_since_rebin.append(id)
	if colliders and colliders.has_method("release"):
		colliders.call_deferred("release", id)


func restore_instance(id: int) -> void:
	if removed.erase(id):
		_build_far()
		_last_rebin_pos = Vector3(INF, INF, INF)
		if colliders and colliders.has_method("mark_dirty"):
			colliders.mark_dirty()


## Temporarily stops drawing an instance (a hero node draws it instead); it keeps its collider. Not saved.
func hide_instance(id: int) -> void:
	if hidden.has(id) or removed.has(id):
		return
	hidden[id] = true
	_hide_in_far(id)
	_hide_in_near(id)
	_changed_since_rebin.append(id)


func unhide_instance(id: int) -> void:
	if hidden.erase(id):
		_build_far()
		_last_rebin_pos = Vector3(INF, INF, INF)


# ---------------------------------------------------------------------------------------------- far field

## Rebuilds every far impostor cell whose scatter cells exist; the others wait in _far_pending.
func _build_far() -> void:
	for k in _far:
		(_far[k] as MultiMeshInstance3D).queue_free()
	_far.clear()
	_far_index.clear()
	_far_centers.clear()
	_far_pending.clear()
	if not lib.has_impostors() or not is_generated:
		return
	var per := int(FAR_CELL / VegScatter.CELL)
	var fg := VegScatter.GRID / per
	for key in fg * fg:
		_far_pending[key] = true
	_build_pending_far(1000000)
	_update_far_thinning(_camera_pos())


func _far_key_of_cell(ci: int) -> int:
	var per := int(FAR_CELL / VegScatter.CELL)
	var fg := VegScatter.GRID / per
	return ((ci / VegScatter.GRID) / per) * fg + (ci % VegScatter.GRID) / per


func _far_ready(key: int) -> bool:
	var per := int(FAR_CELL / VegScatter.CELL)
	var fg := VegScatter.GRID / per
	var fx := key % fg
	var fz := key / fg
	for cz in range(fz * per, fz * per + per):
		for cx in range(fx * per, fx * per + per):
			if cells[VegScatter.cell_index(cx, cz)] == null:
				return false
	return true


## Builds up to `budget` pending far cells whose scatter cells are all generated.
func _build_pending_far(budget: int) -> void:
	if not lib.has_impostors() or not is_generated:
		return
	var built := 0
	for key in _far_pending.keys():
		if built >= budget:
			break
		if not _far_ready(key):
			continue
		_far_pending.erase(key)
		if _far.has(key):
			(_far[key] as MultiMeshInstance3D).queue_free()
			_far.erase(key)
		_build_far_cell(key)
		built += 1
	if built > 0 and budget < 1000:
		_update_far_thinning(_camera_pos())


func _build_far_cell(key: int) -> void:
	var per := int(FAR_CELL / VegScatter.CELL)
	var fg := VegScatter.GRID / per
	var fx := key % fg
	var fz := key / fg
	var refs: Array = []              # [rank, ref]
	for cz in range(fz * per, fz * per + per):
		for cx in range(fx * per, fx * per + per):
			var ci := VegScatter.cell_index(cx, cz)
			var cd: VegScatter.CellData = cells[ci]
			if cd == null:
				continue
			for i in cd.size():
				if cd.cats[i] != Cat.TREE or removed.has(cd.ids[i]) or hidden.has(cd.ids[i]) \
						or cd.rank[i] >= keep_frac[Cat.TREE]:
					continue
				if not lib.info(lib.kind_names[cd.kinds[i]]).has("impostor_layer"):
					continue
				refs.append([cd.rank[i], (ci << 12) | i])
	if refs.is_empty():
		return
	# sorted by rank: distant cells draw only the first visible_instance_count (uniform thinning)
	refs.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
	var n := refs.size()
	var buf := PackedFloat32Array()
	buf.resize(n * 16)
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for k in n:
		var ref: int = refs[k][1]
		var cd: VegScatter.CellData = cells[ref >> 12]
		var i := ref & 4095
		for e in 12:
			buf[k * 16 + e] = cd.xf[i * 12 + e]
		var kind := lib.kind_names[cd.kinds[i]]
		var c := lib.impostor_custom(kind)
		buf[k * 16 + 12] = c.r
		buf[k * 16 + 13] = c.g
		buf[k * 16 + 14] = c.b
		buf[k * 16 + 15] = c.a
		_far_index[cd.ids[i]] = Vector2i(key, k)
		var p := cd.pos[i]
		var r := c.g * cd.scale[i] * 1.3
		lo = lo.min(p - Vector3(r, 1.0, r))
		hi = hi.max(p + Vector3(r, c.a * cd.scale[i] * 1.25, r))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = lib.impostor_quad
	mm.instance_count = n
	mm.buffer = buf
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Imp_%d_%d" % [fx, fz]
	mmi.multimesh = mm
	mmi.custom_aabb = AABB(lo, hi - lo)
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	mmi.set_instance_shader_parameter(&"lod_begin", imp_distance)
	mmi.set_instance_shader_parameter(&"lod_end", 0.0)
	mmi.set_instance_shader_parameter(&"lod_margin", band_margin)
	mmi.visibility_range_end = view_distance
	mmi.visibility_range_end_margin = view_distance * 0.05
	mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	_far_root.add_child(mmi)
	_far[key] = mmi
	_far_centers[key] = (lo + hi) * 0.5


## Distance thinning of far impostor cells (rank-sorted instances): full density within ~700 m, 40% at
## 2.5 km — the impostor shader enlarges the survivors a little so canopy cover reads the same.
func _update_far_thinning(cp: Vector3) -> void:
	for key in _far:
		var mmi: MultiMeshInstance3D = _far[key]
		var c: Vector3 = _far_centers[key]
		var d := maxf(Vector2(c.x - cp.x, c.z - cp.z).length() - FAR_CELL * 0.7, 0.0)
		var keep := lerpf(1.0, 0.4, smoothstep(700.0, 2500.0, d))
		var n := mmi.multimesh.instance_count
		mmi.multimesh.visible_instance_count = clampi(int(ceil(n * keep)), 1, n)


func _hide_in_far(id: int) -> void:
	if not _far_index.has(id):
		return
	var v: Vector2i = _far_index[id]
	var mmi: MultiMeshInstance3D = _far.get(v.x)
	if mmi and mmi.multimesh:
		var t := mmi.multimesh.get_instance_transform(v.y)
		mmi.multimesh.set_instance_transform(v.y, Transform3D(Basis().scaled(Vector3.ZERO), t.origin))


# ---------------------------------------------------------------------------------------------- near field

func _camera_pos() -> Vector3:
	if camera_override and is_instance_valid(camera_override):
		return camera_override.global_position
	var vp := get_viewport()
	var cam := vp.get_camera_3d() if vp else null
	if cam:
		return cam.global_position
	if Game.player and is_instance_valid(Game.player):
		return Game.player.global_position
	return Vector3.ZERO


func _process(_delta: float) -> void:
	if not is_generated:
		return
	var cp := _camera_pos()
	lib.set_view_origin(cp)
	if _rebin_task >= 0:
		if WorkerThreadPool.is_task_completed(_rebin_task):
			WorkerThreadPool.wait_for_task_completion(_rebin_task)
			_rebin_task = -1
			_apply_rebin()
		else:
			return
	if _bg_task >= 0:
		_drain_background()
	if not _far_pending.is_empty():
		_build_pending_far(2)
	if cells[VegScatter.cell_index(VegScatter.cell_of(cp.x, cp.z).x, VegScatter.cell_of(cp.x, cp.z).y)] == null:
		ensure_generated_around(cp)
	if cp.distance_to(_last_rebin_pos) >= REBIN_STEP or _rebin_pending:
		_rebin_pending = false
		_last_rebin_pos = cp
		_update_far_thinning(cp)
		var excl := removed.merged(hidden)
		if single_threaded:
			_rebin_result = _compute_rebin(cp, excl)
			_apply_rebin()
		else:
			var snapshot := cp
			_changed_since_rebin.clear()
			_rebin_task = WorkerThreadPool.add_task(func() -> void:
				var res := _compute_rebin(snapshot, excl)
				_mutex.lock()
				_rebin_result = res
				_mutex.unlock(), true, "veg_rebin")


## Forces an immediate synchronous rebin (tests / teleports).
func rebin_now() -> void:
	if _rebin_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_rebin_task)
		_rebin_task = -1
	var cp := _camera_pos()
	_last_rebin_pos = cp
	lib.set_view_origin(cp)
	_rebin_result = _compute_rebin(cp, removed.merged(hidden))
	_apply_rebin()


## World-aligned tile size for a band ending at `end` m: every (asset, band) is split into tiles so frustum
## culling and the shadow cascades only touch the tiles they overlap (a ring-shaped MultiMesh around the camera
## would be drawn whole in every pass and every cascade).
## Tile size = band end x scale; 0 = one tile per (asset, band). Measured on a dense-forest view (Forward+
## high): tiling cut primitives by only ~5 % (directional shadow cascades still see every tile) for +12 % draw
## calls, so bands are untiled by default.
static var tile_scale := 0.0
static var shadow_tile_scale := 0.0


static func band_tile(end: float, shadow := false) -> float:
	var k := shadow_tile_scale if shadow else tile_scale
	return 1.0e6 if k <= 0.0 else clampf(end * k, 24.0, 1.0e6)


## Worker: bins instances into per (asset, band, tile) transform buffers — main bands 0..7, shadow proxies
## 8..15. Returns Vector4i key -> {buf, ids, kind, band, cat, shadow}.
func _compute_rebin(cp: Vector3, excl: Dictionary) -> Dictionary:
	var lists := {}                       # Vector4i key -> Array of int refs (cell index << 12 | local index)
	var slack := REBIN_STEP + band_margin + 1.0
	var reach := 0.0
	var cat_reach := PackedFloat32Array()
	cat_reach.resize(VegScatter.CAT_COUNT)
	for cat in VegScatter.CAT_COUNT:
		var r := -1.0
		for bl in [bands[cat], shadow_bands[cat]]:
			if not (bl as Array).is_empty():
				r = maxf(r, float(bl[(bl as Array).size() - 1][1]) + slack)
		cat_reach[cat] = r
		reach = maxf(reach, r)
	var c0 := VegScatter.cell_of(cp.x - reach, cp.z - reach)
	var c1 := VegScatter.cell_of(cp.x + reach, cp.z + reach)
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			var ci := VegScatter.cell_index(cx, cz)
			var cd: VegScatter.CellData = cells[ci]
			if cd == null or cd.size() == 0:
				continue
			var o := VegScatter.cell_origin(cx, cz)
			var ddx := maxf(maxf(o.x - cp.x, cp.x - (o.x + VegScatter.CELL)), 0.0)
			var ddz := maxf(maxf(o.y - cp.z, cp.z - (o.y + VegScatter.CELL)), 0.0)
			if sqrt(ddx * ddx + ddz * ddz) > reach:
				continue
			for i in cd.size():
				var cat := int(cd.cats[i])
				var p := cd.pos[i]
				var d := p.distance_to(cp)
				if d > cat_reach[cat] or cd.rank[i] >= keep_frac[cat]:
					continue
				if excl.has(cd.ids[i]):
					continue
				var ref := (ci << 12) | i
				var kind: int = cd.kinds[i]
				for pass_i in 2:
					var bl: Array = bands[cat] if pass_i == 0 else shadow_bands[cat]
					for b in bl.size():
						var band: Array = bl[b]
						if d >= float(band[0]) - slack and d <= float(band[1]) + slack:
							if int(band[2]) == 3 and _imp_custom[kind] == null:
								continue
							var t := band_tile(float(band[1]), pass_i == 1)
							var key := Vector4i(kind, b + 8 * pass_i, int(floor(p.x / t)), int(floor(p.z / t)))
							var lst: Array = lists.get(key, [])
							if lst.is_empty():
								lists[key] = lst
							lst.append(ref)
	var out := {}
	for key in lists:
		var lst: Array = lists[key]
		var n := lst.size()
		var k4: Vector4i = key
		var first: int = lst[0]
		var cd0: VegScatter.CellData = cells[first >> 12]
		var cat := int(cd0.cats[first & 4095])
		var band: Array = (shadow_bands if k4.y >= 8 else bands)[cat][k4.y & 7]
		var imp: Variant = _imp_custom[k4.x] if int(band[2]) == 3 else null
		var stride := 16 if imp != null else 12
		var buf := PackedFloat32Array()
		buf.resize(n * stride)
		var ids := PackedInt32Array()
		ids.resize(n)
		for j in n:
			var ref: int = lst[j]
			var cd: VegScatter.CellData = cells[ref >> 12]
			var li := ref & 4095
			var k := li * 12
			var o := j * stride
			for e in 12:
				buf[o + e] = cd.xf[k + e]
			if imp != null:
				var c: Color = imp
				buf[o + 12] = c.r
				buf[o + 13] = c.g
				buf[o + 14] = c.b
				buf[o + 15] = c.a
			ids[j] = cd.ids[li]
		out[key] = {"buf": buf, "ids": ids, "kind": k4.x, "band": k4.y & 7, "cat": cat, "shadow": k4.y >= 8,
			"stride": stride}
	return out


func _apply_rebin() -> void:
	_mutex.lock()
	var res := _rebin_result
	_rebin_result = {}
	_mutex.unlock()
	var used := {}
	for key in res:
		var e: Dictionary = res[key]
		var mmi: MultiMeshInstance3D = _near.get(key)
		var kind: StringName = lib.kind_names[int(e["kind"])]
		var band_i := int(e["band"])
		var is_shadow := bool(e["shadow"])
		var band: Array = (shadow_bands if is_shadow else bands)[int(e["cat"])][band_i]
		var stride := int(e.get("stride", 12))
		if mmi == null:
			var ms := lib.meshes(kind)
			if ms.is_empty():
				continue
			mmi = MultiMeshInstance3D.new()
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			if stride == 16:
				mm.use_custom_data = true
				mm.mesh = lib.impostor_quad
			else:
				mm.mesh = ms[mini(int(band[2]), ms.size() - 1)]
			mmi.multimesh = mm
			mmi.extra_cull_margin = 4.0
			mmi.set_instance_shader_parameter(&"lod_begin", float(band[0]))
			mmi.set_instance_shader_parameter(&"lod_end", float(band[1]))
			mmi.set_instance_shader_parameter(&"lod_margin", band_margin)
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if is_shadow \
				else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mmi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
			# coarse cull (Godot measures to the AABB centre, so allow for the tile size)
			mmi.visibility_range_end = float(band[1]) + band_tile(float(band[1])) * 0.75 + band_margin * 2.0 + REBIN_STEP
			_near_root.add_child(mmi)
			_near[key] = mmi
		var buf: PackedFloat32Array = e["buf"]
		var n := buf.size() / stride
		mmi.multimesh.instance_count = n
		if n > 0:
			mmi.multimesh.buffer = buf
		mmi.set_meta(&"ids", e["ids"])
		mmi.visible = n > 0
		used[key] = true
	# tiles that fell out of every band: free (tiles are world-aligned, so the set drifts as you travel)
	for key in _near.keys():
		if not used.has(key):
			(_near[key] as MultiMeshInstance3D).queue_free()
			_near.erase(key)
	# instances removed/hidden while the worker was binning
	for id in _changed_since_rebin:
		_hide_in_near(id)
	_changed_since_rebin.clear()


func _hide_in_near(id: int) -> void:
	for key in _near:
		var mmi: MultiMeshInstance3D = _near[key]
		if not mmi.visible or not mmi.has_meta(&"ids"):
			continue
		var ids: PackedInt32Array = mmi.get_meta(&"ids")
		var k := ids.find(id)
		if k >= 0:
			var t := mmi.multimesh.get_instance_transform(k)
			mmi.multimesh.set_instance_transform(k, Transform3D(Basis().scaled(Vector3.ZERO), t.origin))


## Near-field statistics (tests / perf readout).
func near_stats() -> Dictionary:
	var mmis := 0
	var inst := 0
	for key in _near:
		var m: MultiMeshInstance3D = _near[key]
		if m.visible:
			mmis += 1
			inst += m.multimesh.instance_count
	return {"mmis": mmis, "instances": inst, "far_cells": _far.size()}


# ---------------------------------------------------------------------------------------------- persistence

func get_save_key() -> String:
	return SAVE_KEY


func save_state() -> Dictionary:
	var d := {"removed": removed.keys()}
	if harvest and harvest.has_method("save_state"):
		d["harvest"] = harvest.save_state()
	return d


func load_state(data: Dictionary) -> void:
	if harvest and harvest.has_method("clear_state"):
		harvest.clear_state()
	removed.clear()
	hidden.clear()
	for id in data.get("removed", []):
		removed[int(id)] = true
	# stumps / fallen trunks / notched trees need their scatter cells now, even if they are still streaming
	var need := {}
	for id in removed:
		need[VegScatter.id_cell(int(id))] = true
	var hs: Dictionary = data.get("harvest", {})
	for sec in ["trees", "stumps", "fallen", "uses"]:
		for k in (hs.get(sec, {}) as Dictionary):
			need[VegScatter.id_cell(int(k))] = true
	var list := PackedInt32Array()
	for ci in need:
		if ci >= 0 and ci < cells.size() and cells[ci] == null:
			list.append(ci)
	if not list.is_empty():
		if _rebin_task >= 0:
			WorkerThreadPool.wait_for_task_completion(_rebin_task)
			_rebin_task = -1
		_gen_list(list)
	_build_far()
	_last_rebin_pos = Vector3(INF, INF, INF)
	if colliders and colliders.has_method("mark_dirty"):
		colliders.mark_dirty()
	if harvest and harvest.has_method("load_state"):
		harvest.load_state(data.get("harvest", {}))

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

signal generated()

const Cat := VegScatter.Cat
const FAR_CELL := 256.0
const REBIN_STEP := 5.0
const SAVE_KEY := "vegetation"

## Set before adding to the tree (dev / tests): multiplies the forest density of the scatter.
@export var density_override := -1.0
## Dev: camera to follow instead of the viewport camera.
var camera_override: Camera3D = null
## Dev/tests: generate on the calling thread (deterministic timing).
var single_threaded := false

var lib: VegLibrary
var ctx: VegScatter.Context
var cells: Array = []                 # VegScatter.CellData per cell index
var removed: Dictionary = {}          # instance id -> true (felled trees, taken rocks)
var is_generated := false
var gen_msec := 0

var bands: Array = []                 # per Cat: Array of [begin, end, lod] (main pass, no shadows)
var shadow_bands: Array = []          # per Cat: Array of [begin, end, lod] (shadow-only proxies)
var keep_frac: PackedFloat32Array = PackedFloat32Array([1, 1, 1, 1, 1, 1])
var imp_distance := 160.0
var view_distance := 4000.0
var band_margin := 3.0

var _near_root: Node3D
var _far_root: Node3D
var _near: Dictionary = {}            # int key (kind << 4 | band, shadow bands 8..15) -> MultiMeshInstance3D
var _far: Dictionary = {}             # far cell index -> MultiMeshInstance3D
var _far_index: Dictionary = {}       # instance id -> Vector2i(far cell index, instance index)
var _far_centers: Dictionary = {}     # far cell index -> Vector3 centre
var _last_rebin_pos := Vector3(INF, INF, INF)
var _rebin_task := -1
var _rebin_result: Dictionary = {}
var _rebin_pending := false
var _mutex := Mutex.new()
var _gen_ctx_cells: Array = []

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
	_read_settings()
	generate()
	_build_far()
	_attach_subsystems()
	if not Events.settings_changed.is_connected(_on_settings_changed):
		Events.settings_changed.connect(_on_settings_changed)
	set_process(true)


func _exit_tree() -> void:
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
	var a := maxf(18.0, imp_distance * 0.32)
	var b := maxf(32.0, imp_distance * 0.62)
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
	shadow_bands[Cat.TREE] = [[0.0, a, 1], [a, sh_end, 2]] if not mobile else [[0.0, sh_end, 2]]
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
	var dens := density_override if density_override > 0.0 else 1.0
	ctx = VegScatter.make_context(lib, TerrainData, dens)
	ctx.has_water = TerrainData.has_method("get_water_level")
	var n := VegScatter.GRID * VegScatter.GRID
	cells.clear()
	cells.resize(n)
	if single_threaded:
		for i in n:
			_gen_cell(i)
	else:
		var gid := WorkerThreadPool.add_group_task(_gen_cell, n, -1, true, "veg_scatter")
		WorkerThreadPool.wait_for_group_task_completion(gid)
	gen_msec = Time.get_ticks_msec() - t0
	is_generated = true
	var total := 0
	for c in cells:
		if c:
			total += (c as VegScatter.CellData).size()
	print("VEG scatter: %d instances in %d ms" % [total, gen_msec])
	generated.emit()


func _gen_cell(i: int) -> void:
	var cd := VegScatter.generate_cell(ctx, i % VegScatter.GRID, i / VegScatter.GRID)
	_mutex.lock()
	cells[i] = cd
	_mutex.unlock()


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


## Hides an instance everywhere (near bands on the next rebin, far impostor immediately).
func remove_instance(id: int) -> void:
	if removed.has(id):
		return
	removed[id] = true
	_hide_in_far(id)
	_hide_in_near(id)


func restore_instance(id: int) -> void:
	if removed.erase(id):
		_build_far()
		_last_rebin_pos = Vector3(INF, INF, INF)


# ---------------------------------------------------------------------------------------------- far field

func _build_far() -> void:
	for k in _far:
		(_far[k] as MultiMeshInstance3D).queue_free()
	_far.clear()
	_far_index.clear()
	_far_centers.clear()
	if not lib.has_impostors() or not is_generated:
		return
	var per := int(FAR_CELL / VegScatter.CELL)
	var fg := VegScatter.GRID / per
	for fz in fg:
		for fx in fg:
			var refs: Array = []              # [rank, ref]
			for cz in range(fz * per, fz * per + per):
				for cx in range(fx * per, fx * per + per):
					var ci := VegScatter.cell_index(cx, cz)
					var cd: VegScatter.CellData = cells[ci]
					if cd == null:
						continue
					for i in cd.size():
						if cd.cats[i] != Cat.TREE or removed.has(cd.ids[i]) or cd.rank[i] >= keep_frac[Cat.TREE]:
							continue
						if not lib.info(lib.kind_names[cd.kinds[i]]).has("impostor_layer"):
							continue
						refs.append([cd.rank[i], (ci << 12) | i])
			if refs.is_empty():
				continue
			# sorted by rank: distant cells draw only the first visible_instance_count (uniform thinning)
			refs.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
			var n := refs.size()
			var buf := PackedFloat32Array()
			buf.resize(n * 16)
			var lo := Vector3(INF, INF, INF)
			var hi := Vector3(-INF, -INF, -INF)
			var key := fz * fg + fx
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
	_update_far_thinning(_camera_pos())


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
	if cp.distance_to(_last_rebin_pos) >= REBIN_STEP or _rebin_pending:
		_rebin_pending = false
		_last_rebin_pos = cp
		_update_far_thinning(cp)
		if single_threaded:
			_rebin_result = _compute_rebin(cp)
			_apply_rebin()
		else:
			var snapshot := cp
			_rebin_task = WorkerThreadPool.add_task(func() -> void:
				var res := _compute_rebin(snapshot)
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
	_rebin_result = _compute_rebin(cp)
	_apply_rebin()


## Worker: bins instances into per (asset, band) transform buffers — main bands 0..7, shadow proxies 8..15.
## Returns int key -> {buf, ids, kind, band, cat, shadow}.
func _compute_rebin(cp: Vector3) -> Dictionary:
	var lists := {}                       # int key -> Array of int refs (cell index << 12 | local index)
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
				if removed.has(cd.ids[i]):
					continue
				var ref := (ci << 12) | i
				var kk: int = cd.kinds[i] << 4
				var bl: Array = bands[cat]
				for b in bl.size():
					var band: Array = bl[b]
					if d >= float(band[0]) - slack and d <= float(band[1]) + slack:
						var key: int = kk | b
						var lst: Array = lists.get(key, [])
						if lst.is_empty():
							lists[key] = lst
						lst.append(ref)
				var sl: Array = shadow_bands[cat]
				for b in sl.size():
					var sband: Array = sl[b]
					if d >= float(sband[0]) - slack and d <= float(sband[1]) + slack:
						var skey: int = kk | (8 + b)
						var slst: Array = lists.get(skey, [])
						if slst.is_empty():
							lists[skey] = slst
						slst.append(ref)
	var out := {}
	for key in lists:
		var lst: Array = lists[key]
		var n := lst.size()
		var buf := PackedFloat32Array()
		buf.resize(n * 12)
		var ids := PackedInt32Array()
		ids.resize(n)
		var first: int = lst[0]
		var cd0: VegScatter.CellData = cells[first >> 12]
		var cat := int(cd0.cats[first & 4095])
		for j in n:
			var ref: int = lst[j]
			var cd: VegScatter.CellData = cells[ref >> 12]
			var li := ref & 4095
			var k := li * 12
			var o := j * 12
			for e in 12:
				buf[o + e] = cd.xf[k + e]
			ids[j] = cd.ids[li]
		var bi: int = key & 15
		out[key] = {"buf": buf, "ids": ids, "kind": key >> 4, "band": bi & 7, "cat": cat, "shadow": bi >= 8}
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
		if mmi == null:
			var ms := lib.meshes(kind)
			if ms.is_empty():
				continue
			mmi = MultiMeshInstance3D.new()
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = ms[mini(int(band[2]), ms.size() - 1)]
			mmi.multimesh = mm
			mmi.name = "N_%d" % key
			mmi.extra_cull_margin = 4.0
			mmi.set_instance_shader_parameter(&"lod_begin", float(band[0]))
			mmi.set_instance_shader_parameter(&"lod_end", float(band[1]))
			mmi.set_instance_shader_parameter(&"lod_margin", band_margin)
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if is_shadow \
				else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mmi.visibility_range_end = float(band[1]) + band_margin * 2.0 + REBIN_STEP
			_near_root.add_child(mmi)
			_near[key] = mmi
		var buf: PackedFloat32Array = e["buf"]
		var n := buf.size() / 12
		mmi.multimesh.instance_count = n
		if n > 0:
			mmi.multimesh.buffer = buf
		mmi.set_meta(&"ids", e["ids"])
		mmi.visible = n > 0
		used[key] = true
	for key in _near.keys():
		if not used.has(key):
			var m: MultiMeshInstance3D = _near[key]
			m.multimesh.instance_count = 0
			m.visible = false


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
	removed.clear()
	for id in data.get("removed", []):
		removed[int(id)] = true
	_build_far()
	_last_rebin_pos = Vector3(INF, INF, INF)
	if harvest and harvest.has_method("load_state"):
		harvest.load_state(data.get("harvest", {}))

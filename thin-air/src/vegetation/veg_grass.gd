extends Node3D
## Ground cover ring (child "Grass" of Vegetation): dry grass / sedge tufts and dead fern clumps in CELL x CELL
## cells streamed around the camera out to Settings grass_distance. Each cell is generated deterministically on
## a worker thread from TerrainData (meadow mask B, forest mask A as sparse forest-floor cover; nothing on
## snow-covered, rocky, steep or wet ground, POI pads or trails) and drawn as one MultiMeshInstance3D per
## ground-cover kind (no shadows). The grass shader thins/shrinks tufts toward the ring edge, so there is no
## visible border. Cheap mobile path: shorter distance, sparser grid, fewer kinds (see _read_settings).

const CELL := 24.0
const MAX_TASKS := 3

var vegetation: Node = null
## Dev/tests: follow this position instead of the camera.
var center_override: Variant = null

var kinds: Array[StringName] = []
var meshes: Array[Mesh] = []
var distance := 60.0
var spacing := 0.5
var density := 1.0
var enabled := true

var _cells: Dictionary = {}          # Vector2i -> Array[MultiMeshInstance3D]
var _tasks: Dictionary = {}          # Vector2i -> task id
var _results: Dictionary = {}        # Vector2i -> Array[PackedFloat32Array]
var _mutex := Mutex.new()
var _last_center := Vector3(INF, INF, INF)
var _gen_ctx: VegScatter.Context = null
var _terrain: Object = null


func _ready() -> void:
	var lib := VegLibrary.get_shared()
	for k in [&"grass_tuft_a", &"grass_tuft_b", &"sedge_tuft", &"fern_clump"]:
		var m := lib.grass_mesh(k)
		if m:
			kinds.append(k)
			meshes.append(m)
	_read_settings()
	if not Events.settings_changed.is_connected(_on_settings_changed):
		Events.settings_changed.connect(_on_settings_changed)


func _exit_tree() -> void:
	for c in _tasks:
		WorkerThreadPool.wait_for_task_completion(_tasks[c])
	_tasks.clear()


func _read_settings() -> void:
	distance = clampf(float(Settings.get_value(&"grass_distance", 60.0)), 0.0, 150.0)
	var dens := clampf(float(Settings.get_value(&"vegetation_density", 1.0)), 0.0, 1.0)
	var mobile: bool = Settings.is_mobile()
	spacing = 0.62 if mobile else 0.5
	density = dens * (0.75 if mobile else 1.0)
	enabled = distance > 1.0 and density > 0.02 and not meshes.is_empty()
	VegLibrary.get_shared().set_grass_params(distance * 0.55, distance)


func _on_settings_changed() -> void:
	var old := [distance, spacing, density]
	_read_settings()
	if old != [distance, spacing, density]:
		clear()


## Drops every cell (they regenerate around the camera).
func clear() -> void:
	for c in _tasks:
		WorkerThreadPool.wait_for_task_completion(_tasks[c])
	_tasks.clear()
	_results.clear()
	for c in _cells:
		for m in _cells[c]:
			(m as Node).queue_free()
	_cells.clear()
	_last_center = Vector3(INF, INF, INF)


func cell_count() -> int:
	return _cells.size()


func instance_count() -> int:
	var n := 0
	for c in _cells:
		for m in _cells[c]:
			n += (m as MultiMeshInstance3D).multimesh.instance_count
	return n


func _center() -> Vector3:
	if center_override is Vector3:
		return center_override
	if vegetation and vegetation.has_method("_camera_pos"):
		return vegetation._camera_pos()
	return Vector3.ZERO


func _process(_delta: float) -> void:
	if vegetation == null or vegetation.get("ctx") == null:
		return
	_gen_ctx = vegetation.ctx
	_terrain = _gen_ctx.terrain
	# finished cells -> MultiMeshes (at most two per frame)
	var built := 0
	for c in _tasks.keys():
		if built >= 2:
			break
		var tid: int = _tasks[c]
		if WorkerThreadPool.is_task_completed(tid):
			WorkerThreadPool.wait_for_task_completion(tid)
			_tasks.erase(c)
			_mutex.lock()
			var bufs: Array = _results.get(c, [])
			_results.erase(c)
			_mutex.unlock()
			if _wanted(c, _center()):
				_build_cell(c, bufs)
				built += 1
	if not enabled:
		return
	var cp := _center()
	if cp.distance_squared_to(_last_center) < 1.0 and _tasks.size() == 0:
		return
	_last_center = cp
	# drop far cells
	for c in _cells.keys():
		if not _wanted(c, cp, CELL * 0.5):
			for m in _cells[c]:
				(m as Node).queue_free()
			_cells.erase(c)
	# request missing cells, nearest first
	if _tasks.size() >= MAX_TASKS:
		return
	var r := int(ceil(distance / CELL))
	var cc := Vector2i(int(floor(cp.x / CELL)), int(floor(cp.z / CELL)))
	var todo: Array = []
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var c := cc + Vector2i(dx, dz)
			if _cells.has(c) or _tasks.has(c) or not _wanted(c, cp):
				continue
			todo.append([_cell_dist(c, cp), c])
	todo.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	for t in todo:
		if _tasks.size() >= MAX_TASKS:
			break
		_request(t[1])


func _cell_dist(c: Vector2i, cp: Vector3) -> float:
	var x0 := c.x * CELL
	var z0 := c.y * CELL
	var dx := maxf(maxf(x0 - cp.x, cp.x - (x0 + CELL)), 0.0)
	var dz := maxf(maxf(z0 - cp.z, cp.z - (z0 + CELL)), 0.0)
	return sqrt(dx * dx + dz * dz)


func _wanted(c: Vector2i, cp: Vector3, slack := 0.0) -> bool:
	return enabled and _cell_dist(c, cp) <= distance + slack


func _request(c: Vector2i) -> void:
	var ctx := _gen_ctx
	var sp := spacing
	var dens := density
	var nk := kinds.size()
	_tasks[c] = WorkerThreadPool.add_task(func() -> void:
		var bufs := generate_cell(ctx, c, sp, dens, nk)
		_mutex.lock()
		_results[c] = bufs
		_mutex.unlock(), false, "veg_grass")


## Pure: per-kind MultiMesh buffers (12 floats per instance) for grass cell `c`. Kinds: 0/1 grass tufts,
## 2 sedge, 3 fern.
static func generate_cell(ctx: VegScatter.Context, c: Vector2i, sp: float, dens: float, nk: int) -> Array:
	var t: Object = ctx.terrain
	var bufs: Array = []
	var acc: Array = []              # per kind: plain Array of floats (Packed arrays are copy-on-write)
	for k in nk:
		bufs.append(PackedFloat32Array())
		acc.append([])
	var x0 := c.x * CELL
	var z0 := c.y * CELL
	if not t.in_bounds(x0 + CELL * 0.5, z0 + CELL * 0.5, -CELL):
		return bufs
	var rng := RandomNumberGenerator.new()
	rng.seed = VegScatter._hash(c.x + 7919, c.y - 104729, 97)
	var n := int(CELL / sp)
	var step := CELL / n
	# coarse probe: empty for glaciers / bare rock
	var m0: Color = t.get_masks(x0 + CELL * 0.5, z0 + CELL * 0.5)
	var m1: Color = t.get_masks(x0, z0)
	var m2: Color = t.get_masks(x0 + CELL, z0 + CELL)
	if maxf(maxf(m0.b, m0.a), maxf(maxf(m1.b, m1.a), maxf(m2.b, m2.a))) < 0.03:
		return bufs
	for j in n:
		for i in n:
			var x := x0 + (i + 0.5 + rng.randf_range(-0.45, 0.45)) * step
			var z := z0 + (j + 0.5 + rng.randf_range(-0.45, 0.45)) * step
			var r_acc := rng.randf()
			var r_kind := rng.randf()
			var r_yaw := rng.randf()
			var r_sc := rng.randf()
			if not t.in_bounds(x, z, 1.0):
				continue
			var m: Color = t.get_masks(x, z)
			var open := (1.0 - m.r * 0.9) * (1.0 - m.g)
			var meadow := clampf(m.b * 1.15 + (1.0 - m.a) * 0.12, 0.0, 1.0) * open
			var floor_cover := m.a * 0.22 * open
			var clump := VegScatter.noise2(x, z, 6.0, 31) * 0.6 + VegScatter.noise2(x, z, 1.7, 32) * 0.4
			var p := (meadow + floor_cover) * dens * smoothstep(0.2, 0.62, clump) * 1.5
			if r_acc >= p:
				continue
			var slope: float = t.get_slope_deg(x, z)
			if slope > 38.0:
				continue
			var y: float = t.get_height(x, z)
			if VegScatter.in_water(ctx, x, z, y, 0.0) or VegScatter.excluded(ctx, x, z, 0.5):
				continue
			var kind := 0
			var forest_share := floor_cover / maxf(meadow + floor_cover, 1e-4)
			if r_kind < forest_share:
				kind = 3 if r_kind < forest_share * 0.45 else 2
			else:
				var q := (r_kind - forest_share) / maxf(1.0 - forest_share, 1e-4)
				kind = 0 if q < 0.5 else (1 if q < 0.8 else 2)
			if kind >= nk:
				kind = nk - 1
			var sc := lerpf(0.75, 1.3, r_sc) * (0.8 if kind == 3 else 1.0)
			# lean with the slope a little (tufts grow up, not normal to the ground)
			var nrm: Vector3 = t.get_normal(x, z)
			var up := Vector3.UP.lerp(nrm, 0.3).normalized()
			var b := Basis(Vector3.UP, r_yaw * TAU)
			var axis := Vector3.UP.cross(up)
			if axis.length_squared() > 1e-6:
				b = Basis(axis.normalized(), Vector3.UP.angle_to(up)) * b
			b = b.scaled(Vector3.ONE * sc)
			(acc[kind] as Array).append_array([b.x.x, b.y.x, b.z.x, x, b.x.y, b.y.y, b.z.y, y - 0.02,
				b.x.z, b.y.z, b.z.z, z])
	for k in nk:
		bufs[k] = PackedFloat32Array(acc[k])
	return bufs


func _build_cell(c: Vector2i, bufs: Array) -> void:
	var list: Array = []
	var lo := Vector3(c.x * CELL - 1.0, INF, c.y * CELL - 1.0)
	var hi := Vector3((c.x + 1) * CELL + 1.0, -INF, (c.y + 1) * CELL + 1.0)
	for k in mini(bufs.size(), meshes.size()):
		var buf: PackedFloat32Array = bufs[k]
		var n := buf.size() / 12
		if n == 0:
			continue
		for i in n:
			var y := buf[i * 12 + 7]
			lo.y = minf(lo.y, y)
			hi.y = maxf(hi.y, y)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = meshes[k]
		mm.instance_count = n
		mm.buffer = buf
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "G_%d_%d_%d" % [c.x, c.y, k]
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		add_child(mmi)
		list.append(mmi)
	if lo.y <= hi.y:
		for mmi in list:
			(mmi as MultiMeshInstance3D).custom_aabb = AABB(lo - Vector3(0, 0.5, 0), hi - lo + Vector3(0, 1.8, 0))
			(mmi as MultiMeshInstance3D).visibility_range_end = distance + CELL
	_cells[c] = list

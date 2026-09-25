class_name TerrainRenderer
extends Node3D
## "Terrain" part of the world (scenes/world/terrain.tscn): GPU geometry clipmap renderer, heightfield
## collision, map-boundary walls and the heightfield sun-shadow pass. Data from the TerrainData autoload.
##
## Clipmap (after Losasso & Hoppe 2004 / M. Savage's tile layout): level l has grid spacing 1.5·2^l m and is
## made of 12 tiles of T×T quads (16 for level 0) + a 1-quad filler cross + two 1-quad trim strips, all
## following the camera snapped to the level's grid. Far levels use 4 strips instead of 12 tiles (fewer draw
## calls). Vertex displacement + geomorphing happen in assets/shaders/terrain_common.gdshaderinc; every piece
## keeps a height-range AABB so Godot frustum-culls it. Levels that reach past the camera's far plane are
## drawn radially compressed (see the shader) and are culled here against the side planes only.
## The last level reaches ~49 km: FAR data to 24.6 km, then procedural distant ranges.
##
## Shadows: the visible tiles cast no shadows; one merged mesh per near level is drawn into the shadow maps
## only (SHADOWS_ONLY), so shadows cost 2–3 draw calls per cascade.

const S0 := 1.5
const SHADER_HQ := "res://assets/shaders/terrain.gdshader"
const SHADER_MOBILE := "res://assets/shaders/terrain_mobile.gdshader"
const SHADER_SHADOW := "res://assets/shaders/terrain_shadowcaster.gdshader"
const SHADER_SUN := "res://assets/shaders/terrain_sunshadow.gdshader"
const LAYERS_JSON := "res://assets/textures/terrain/layers.json"
const TEX_AH := "res://assets/textures/terrain/terrain_albedo_height.png"
const TEX_NR := "res://assets/textures/terrain/terrain_normal_rough.png"
const TEX_MACRO := "res://assets/textures/terrain/terrain_macro_noise.png"
const RANGE_M := 24000.0            # outermost level must reach this far (FAR data ends at 24.6 km)
const BOUNDARY_INSET := 4.0         # invisible walls this far inside the map edge

@export var tiles_desktop := 64
@export var tiles_mobile := 32
## Shadow casters use their own, coarser ring size (they only need to cover the shadow distance).
@export var shadow_tiles_desktop := 32
@export var shadow_tiles_mobile := 16
@export var build_collision := true
@export var sun_shadow_enabled := true

var T := 64
var Ts := 32
var mobile := false
var level_count := 0
var detail_far := 360.0

var _levels: Array[Dictionary] = []   # per level: {scale, mat, tiles:[MeshInstance3D], offs:[Vector2i], trim_x, trim_z, filler, manual}
var _shadow_levels: Array[Dictionary] = []
var _tile_mesh: ArrayMesh
var _quad_mesh: ArrayMesh
var _strip_h: ArrayMesh               # far-level strips
var _strip_v: ArrayMesh
var _filler0: ArrayMesh
var _filler: ArrayMesh
var _trim_x: ArrayMesh
var _trim_z: ArrayMesh
var _shadow_meshes: Dictionary = {}   # "l0" -> mesh, "ring" + variant -> mesh
var _ymin := 0.0
var _ymax := 4000.0
var _last_snap: Array = []
var _shader: Shader
var _shadow_shader: Shader
var _layer_avg := PackedVector3Array()
var _layer_rough := PackedFloat32Array()
var _layer_tiling := PackedFloat32Array()
var _tex_ah: TextureLayered
var _tex_nr: TextureLayered
var _tex_macro: Texture2D
var _root_tiles: Node3D
var _body: StaticBody3D
var _sun_vp: SubViewport
var _sun_rect: ColorRect
var _sun_mat: ShaderMaterial
var _sun_last := Vector3.ZERO
var _sun_timer := 0.0
var _compress := Vector4(1e9, 1e9, 1e9, 1.0)
var _cam_far := -1.0
var _shadow_distance := 110.0


func _ready() -> void:
	if not TerrainData.is_loaded():
		TerrainData.load_data()
	_ymin = TerrainData.min_height
	_ymax = TerrainData.max_height
	if not TerrainData.far_heights.is_empty():
		_ymin = minf(_ymin, 250.0)
	_ymin -= 20.0
	_ymax += 20.0
	_load_layers()
	_configure()
	_build()
	if build_collision:
		_build_collision()
	_build_boundary()
	if sun_shadow_enabled:
		_build_sun_shadow()
	if Events.has_signal("settings_changed"):
		Events.settings_changed.connect(_on_settings_changed)



func _configure() -> void:
	mobile = Settings.is_mobile() or String(Settings.preset).begins_with("mobile") or not Settings.is_forward_plus()
	T = tiles_mobile if mobile else tiles_desktop
	Ts = shadow_tiles_mobile if mobile else shadow_tiles_desktop
	if String(Settings.preset) == "low":
		T = 48
	detail_far = 220.0 if mobile else 360.0
	_shadow_distance = float(Settings.get_value(&"shadow_distance", 110.0))
	level_count = 1
	var half := 2.0 * T * S0
	while half < RANGE_M:
		half *= 2.0
		level_count += 1
	level_count += 1


func _on_settings_changed() -> void:
	var was_mobile := mobile
	var was_t := T
	var sd := _shadow_distance
	_configure()
	if was_mobile != mobile or was_t != T or not is_equal_approx(sd, _shadow_distance):
		_clear()
		_build()


func _clear() -> void:
	if _root_tiles:
		_root_tiles.queue_free()
		_root_tiles = null
	_levels.clear()
	_shadow_levels.clear()
	_last_snap.clear()


# =========================================================================================== materials
func _load_layers() -> void:
	var lj: Variant = JSON.parse_string(FileAccess.get_file_as_string(LAYERS_JSON)) if FileAccess.file_exists(LAYERS_JSON) else null
	_layer_avg.resize(9)
	_layer_rough.resize(9)
	_layer_tiling.resize(9)
	for i in 9:
		_layer_avg[i] = Vector3(0.3, 0.3, 0.3)
		_layer_rough[i] = 0.8
		_layer_tiling[i] = 4.0
	if lj is Array:
		for e in lj:
			var i := int(e.get("index", 0))
			if i < 0 or i > 8:
				continue
			var a: Array = e.get("avg_albedo_linear", [0.3, 0.3, 0.3])
			_layer_avg[i] = Vector3(float(a[0]), float(a[1]), float(a[2]))
			_layer_rough[i] = float(e.get("roughness_avg", 0.8))
			_layer_tiling[i] = float(e.get("tiling_m", 4.0))
	if ResourceLoader.exists(TEX_AH):
		_tex_ah = load(TEX_AH)
	if ResourceLoader.exists(TEX_NR):
		_tex_nr = load(TEX_NR)
	if ResourceLoader.exists(TEX_MACRO):
		_tex_macro = load(TEX_MACRO)


func _make_material(scale: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter(&"map_height_tex", TerrainData.height_texture)
	m.set_shader_parameter(&"mid_height_tex", TerrainData.mid_texture)
	m.set_shader_parameter(&"far_height_tex", TerrainData.far_texture)
	m.set_shader_parameter(&"lvl_scale", scale)
	m.set_shader_parameter(&"lvl_morph", scale * T * 0.35)
	if _shader != _shadow_shader:
		m.set_shader_parameter(&"layer_ah", _tex_ah)
		m.set_shader_parameter(&"layer_nr", _tex_nr)
		m.set_shader_parameter(&"macro_noise", _tex_macro)
		m.set_shader_parameter(&"detail_tex", TerrainData.detail_texture)
		m.set_shader_parameter(&"layer_avg", _layer_avg)
		m.set_shader_parameter(&"layer_rough", _layer_rough)
		m.set_shader_parameter(&"layer_tiling", _layer_tiling)
		m.set_shader_parameter(&"detail_far", detail_far)
		m.set_shader_parameter(&"shadow_distance", _shadow_distance)
		for arg in OS.get_cmdline_user_args():
			if String(arg).begins_with("--terrain_debug="):
				m.set_shader_parameter(&"debug_view", int(String(arg).get_slice("=", 1)))
	return m


# =========================================================================================== meshes
## Grid of nx × nz quads in local grid units (x right, z down), diagonal from (i,j) to (i+1,j+1) — the same split
## as Jolt's heightfield, so the rendered surface matches the collider.
static func grid_mesh(nx: int, nz: int, hole := Rect2i(), ymin := 0.0, ymax := 1.0) -> ArrayMesh:
	var verts := PackedVector3Array()
	verts.resize((nx + 1) * (nz + 1))
	var k := 0
	for j in nz + 1:
		for i in nx + 1:
			verts[k] = Vector3(i, 0.0, j)
			k += 1
	var idx := PackedInt32Array()
	for j in nz:
		for i in nx:
			if hole.size.x > 0 and hole.has_point(Vector2i(i, j)):
				continue
			var a := j * (nx + 1) + i
			var b := a + 1
			var c := a + nx + 1
			var d := c + 1
			# clockwise seen from above (Godot front faces), split along a–d like Jolt's heightfield
			idx.append_array(PackedInt32Array([a, b, d, a, d, c]))
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	mesh.custom_aabb = AABB(Vector3(0, ymin, 0), Vector3(nx, ymax - ymin, nz))
	return mesh


## Union of rectangles as one mesh (filler cross pieces).
static func rects_mesh(rects: Array[Rect2i], ymin: float, ymax: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var bb := Rect2i()
	var first := true
	for r in rects:
		for j in r.size.y:
			for i in r.size.x:
				var x0 := float(r.position.x + i)
				var z0 := float(r.position.y + j)
				var a := Vector3(x0, 0, z0)
				var b := Vector3(x0 + 1, 0, z0)
				var c := Vector3(x0, 0, z0 + 1)
				var d := Vector3(x0 + 1, 0, z0 + 1)
				for v in [a, b, d, a, d, c]:
					st.add_vertex(v)
		bb = r if first else bb.merge(r)
		first = false
	st.index()
	var mesh := st.commit()
	mesh.custom_aabb = AABB(Vector3(bb.position.x, ymin, bb.position.y), Vector3(bb.size.x, ymax - ymin, bb.size.y))
	return mesh


func _build() -> void:
	_shader = load(SHADER_MOBILE if mobile else SHADER_HQ)
	_shadow_shader = load(SHADER_SHADOW)
	_root_tiles = Node3D.new()
	_root_tiles.name = "Clipmap"
	add_child(_root_tiles)
	var n4 := 4 * T + 1
	_tile_mesh = grid_mesh(T, T, Rect2i(), _ymin, _ymax)
	_quad_mesh = grid_mesh(2 * T, 2 * T, Rect2i(), _ymin, _ymax)
	_strip_h = grid_mesh(n4, T, Rect2i(), _ymin, _ymax)
	_strip_v = grid_mesh(T, 2 * T + 1, Rect2i(), _ymin, _ymax)
	_trim_x = grid_mesh(4 * T + 2, 1, Rect2i(), _ymin, _ymax)
	_trim_z = grid_mesh(1, n4, Rect2i(), _ymin, _ymax)
	var arms: Array[Rect2i] = [Rect2i(2 * T, 0, 1, T), Rect2i(2 * T, 3 * T + 1, 1, T), Rect2i(0, 2 * T, T, 1),
		Rect2i(3 * T + 1, 2 * T, T, 1)]
	_filler = rects_mesh(arms, _ymin, _ymax)
	var cross: Array[Rect2i] = [Rect2i(2 * T, 0, 1, n4), Rect2i(0, 2 * T, 2 * T, 1), Rect2i(2 * T + 1, 2 * T, 2 * T, 1)]
	_filler0 = rects_mesh(cross, _ymin, _ymax)
	var far_strips_from := 3
	for l in level_count:
		var sc := S0 * pow(2.0, l)
		var mat := _make_material(sc)
		var lv := {"scale": sc, "mat": mat, "tiles": [], "offs": [], "strip": l >= far_strips_from}
		var parent := Node3D.new()
		parent.name = "L%d" % l
		_root_tiles.add_child(parent)
		if l >= far_strips_from:
			# 4 strips: top / bottom full width, left / right between them
			lv["tiles"].append(_mk(parent, _strip_h, mat, "top"))
			lv["offs"].append(Vector2i(0, 0))
			lv["tiles"].append(_mk(parent, _strip_h, mat, "bottom"))
			lv["offs"].append(Vector2i(0, 3 * T + 1))
			lv["tiles"].append(_mk(parent, _strip_v, mat, "left"))
			lv["offs"].append(Vector2i(0, T))
			lv["tiles"].append(_mk(parent, _strip_v, mat, "right"))
			lv["offs"].append(Vector2i(3 * T + 1, T))
		elif l == 0:
			# the innermost level: 4 quadrant meshes (2T x 2T each) around the filler cross
			for q in 4:
				var qx := q & 1
				var qy := q >> 1
				lv["tiles"].append(_mk(parent, _quad_mesh, mat, "q%d" % q))
				lv["offs"].append(Vector2i(qx * (2 * T + 1), qy * (2 * T + 1)))
			lv["filler"] = _mk(parent, _filler0, mat, "filler")
		else:
			for ty in 4:
				for tx in 4:
					if (tx == 1 or tx == 2) and (ty == 1 or ty == 2):
						continue
					lv["tiles"].append(_mk(parent, _tile_mesh, mat, "t%d%d" % [tx, ty]))
					lv["offs"].append(Vector2i(tx * T + (1 if tx >= 2 else 0), ty * T + (1 if ty >= 2 else 0)))
			lv["filler"] = _mk(parent, _filler, mat, "filler")
		if l < level_count - 1:
			lv["trim_x"] = _mk(parent, _trim_x, mat, "trim_x")
			lv["trim_z"] = _mk(parent, _trim_z, mat, "trim_z")
		_levels.append(lv)
		_last_snap.append(Vector2(INF, INF))
	_build_shadow_casters()


func _mk(parent: Node3D, mesh: Mesh, mat: Material, nm: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = nm
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	parent.add_child(mi)
	return mi


func _build_shadow_casters() -> void:
	# level 0 + its trims: one (4Ts+2)^2 grid placed on the hole of level 1; rings for levels 1.. (4 variants).
	# The casters use their own ring size Ts (coarser than the visible clipmap's T) and only reach the shadow
	# distance, so the terrain costs few shadow triangles per cascade.
	var n := 4 * Ts + 2
	var need := 0
	var half := (2.0 * Ts + 1.0) * S0
	while half < _shadow_distance * 1.15 and need < level_count - 1:
		need += 1
		half *= 2.0
	need = maxi(need, 1)
	_shadow_meshes["l0"] = grid_mesh(n, n, Rect2i(), _ymin, _ymax)
	for v in 4:
		var ox := v & 1
		var oz := (v >> 1) & 1
		_shadow_meshes["ring%d" % v] = grid_mesh(n, n, Rect2i(Ts + ox, Ts + oz, 2 * Ts + 1, 2 * Ts + 1), _ymin, _ymax)
	var holder := Node3D.new()
	holder.name = "ShadowCasters"
	_root_tiles.add_child(holder)
	for l in need + 1:
		var m := ShaderMaterial.new()
		m.shader = _shadow_shader
		m.set_shader_parameter(&"map_height_tex", TerrainData.height_texture)
		m.set_shader_parameter(&"mid_height_tex", TerrainData.mid_texture)
		m.set_shader_parameter(&"far_height_tex", TerrainData.far_texture)
		m.set_shader_parameter(&"lvl_scale", S0 * pow(2.0, l))
		m.set_shader_parameter(&"lvl_morph", S0 * pow(2.0, l) * Ts * 0.35)
		var mi := MeshInstance3D.new()
		mi.name = "ShadowL%d" % l
		mi.mesh = _shadow_meshes["l0"] if l == 0 else _shadow_meshes["ring0"]
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
		holder.add_child(mi)
		_shadow_levels.append({"mi": mi, "mat": m, "level": l})


# =========================================================================================== per frame
func _process(delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null or _levels.is_empty():
		return
	var cp := cam.global_position
	if not is_equal_approx(cam.far, _cam_far):
		_cam_far = cam.far
		_compress = _compression_for(cam.far)
	var c2 := Vector2(cp.x, cp.z)
	var snaps: Array[Vector2] = []
	for l in level_count:
		var sc: float = _levels[l]["scale"]
		snaps.append(Vector2(floorf(c2.x / sc) * sc, floorf(c2.y / sc) * sc))
	for l in level_count:
		var lv: Dictionary = _levels[l]
		var sc: float = lv["scale"]
		var snap: Vector2 = snaps[l]
		var base := snap - Vector2(2 * T * sc, 2 * T * sc)
		var mat: ShaderMaterial = lv["mat"]
		mat.set_shader_parameter(&"main_cam_pos", cp)
		mat.set_shader_parameter(&"compress", _compress)
		if snap != _last_snap[l]:
			_last_snap[l] = snap
			var tiles: Array = lv["tiles"]
			var offs: Array = lv["offs"]
			for k in tiles.size():
				var o: Vector2i = offs[k]
				_place(tiles[k], base + Vector2(o) * sc, sc)
			if lv.has("filler"):
				_place(lv["filler"], base, sc)
			# hole of the next level = morph target edge
			if l < level_count - 1:
				var sn: Vector2 = snaps[l + 1]
				var hole0 := sn - Vector2(2 * T * sc, 2 * T * sc)
				var hole1 := sn + Vector2((2 * T + 2) * sc, (2 * T + 2) * sc)
				mat.set_shader_parameter(&"lvl_hole", Vector4(hole0.x, hole0.y, hole1.x, hole1.y))
				# trims fill the one-quad gap between this level and the next level's hole
				var dxs := is_equal_approx(snap.x, sn.x)
				var dzs := is_equal_approx(snap.y, sn.y)
				var trim_z_row := (sn.y + (2 * T + 1) * sc) if dzs else hole0.y
				var trim_x_col := (sn.x + (2 * T + 1) * sc) if dxs else hole0.x
				_place(lv["trim_x"], Vector2(hole0.x, trim_z_row), sc)
				_place(lv["trim_z"], Vector2(trim_x_col, snap.y - 2 * T * sc), sc)
			else:
				mat.set_shader_parameter(&"lvl_hole", Vector4(-1e9, -1e9, 1e9, 1e9))
	_update_shadow_casters(snaps, cp)
	_update_far_culling(cam)
	_sync_fog()
	if _sun_vp:
		_update_sun_shadow(delta)


func _place(mi: MeshInstance3D, origin: Vector2, sc: float) -> void:
	mi.transform = Transform3D(Basis.from_scale(Vector3(sc, 1.0, sc)), Vector3(origin.x, 0.0, origin.y))


func _update_shadow_casters(snaps: Array[Vector2], cp: Vector3) -> void:
	for e in _shadow_levels:
		var l: int = e["level"]
		var sc := S0 * pow(2.0, l)
		var mat: ShaderMaterial = e["mat"]
		mat.set_shader_parameter(&"main_cam_pos", cp)
		if l + 1 >= level_count:
			continue
		var sn: Vector2 = snaps[l + 1]
		var hole0 := sn - Vector2(2 * Ts * sc, 2 * Ts * sc)
		var hole1 := sn + Vector2((2 * Ts + 2) * sc, (2 * Ts + 2) * sc)
		mat.set_shader_parameter(&"lvl_hole", Vector4(hole0.x, hole0.y, hole1.x, hole1.y))
		var mi: MeshInstance3D = e["mi"]
		if l > 0:
			# the ring's inner hole (this level's own hole) sits T + o quads in, o = 1 when this level's snap is
			# one quad past the next level's snap
			var own: Vector2 = snaps[l]
			var ox := 0 if is_equal_approx(own.x, sn.x) else 1
			var oz := 0 if is_equal_approx(own.y, sn.y) else 1
			mi.mesh = _shadow_meshes["ring%d" % (ox + oz * 2)]
		_place(mi, hole0, sc)


## Compressed geometry lies on the segment camera -> true position and within `end` of the camera, so each
## piece's rendered bounds are (true box U camera) intersected with the cube camera +- end. Keeping that as the
## custom AABB lets Godot frustum-cull far pieces normally (including against the far plane).
func _update_far_culling(cam: Camera3D) -> void:
	var start := _compress.x
	var endd := _compress.y
	var cp := cam.global_position
	var cube := AABB(cp - Vector3(endd, endd, endd), Vector3(endd, endd, endd) * 2.0)
	for l in level_count:
		var lv: Dictionary = _levels[l]
		var sc: float = lv["scale"]
		var reach := 2.0 * T * sc * 1.45 + absf(cp.y - _ymin)
		var far_level := reach > start * 0.95
		if not far_level:
			if bool(lv.get("far", false)):
				lv["far"] = false
				for mi in _level_instances(lv):
					mi.custom_aabb = AABB()
			continue
		lv["far"] = true
		for mi in _level_instances(lv):
			var ab: AABB = mi.mesh.get_aabb()
			var o: Vector3 = mi.transform.origin
			var wab := AABB(o + Vector3(ab.position.x * sc, ab.position.y, ab.position.z * sc),
				Vector3(ab.size.x * sc, ab.size.y, ab.size.z * sc))
			var b := wab.expand(cp).intersection(cube)
			if b.size == Vector3.ZERO:
				b = AABB(cp, Vector3(0.01, 0.01, 0.01))
			mi.custom_aabb = AABB(Vector3((b.position.x - o.x) / sc, b.position.y, (b.position.z - o.z) / sc),
				Vector3(b.size.x / sc, b.size.y, b.size.z / sc))


func _level_instances(lv: Dictionary) -> Array:
	var out: Array = lv["tiles"].duplicate()
	for k in ["filler", "trim_x", "trim_z"]:
		if lv.has(k):
			out.append(lv[k])
	return out


## Radial compression of everything beyond 0.9·far into [0.9·far, 0.995·far] (log mapping, slope 1 at the
## start), so terrain to ~60 km renders inside any camera far plane.
static func _compression_for(far: float) -> Vector4:
	var start := far * 0.9
	var end := far * 0.995
	var dmax := 60000.0
	if start >= dmax * 0.8:
		return Vector4(1e9, 1e9, 1e9, 1.0)
	var r := (dmax - start) / (end - start)
	var k := r
	for _i in 30:
		k = r * log(1.0 + k)
	return Vector4(start, end, dmax, maxf(k, 1.0))


func _sync_fog() -> void:
	var env: Environment = null
	var w := get_world_3d()
	if w:
		env = w.environment if w.environment else w.fallback_environment
	var dens := 0.0
	var col := Vector3(0.6, 0.65, 0.72)
	if env and env.fog_enabled:
		dens = env.fog_density
		var c := env.fog_light_color.srgb_to_linear() * env.fog_light_energy
		col = Vector3(c.r, c.g, c.b)
	for lv in _levels:
		var m: ShaderMaterial = lv["mat"]
		m.set_shader_parameter(&"fog_density", dens)
		m.set_shader_parameter(&"fog_col", col)


# =========================================================================================== collision
func _build_collision() -> void:
	var t0 := Time.get_ticks_msec()
	_body = StaticBody3D.new()
	_body.name = "TerrainBody"
	_body.collision_layer = 1
	_body.collision_mask = 0
	_body.set_meta(&"terrain", true)
	var cs := CollisionShape3D.new()
	cs.name = "Heightfield"
	var hs := HeightMapShape3D.new()
	hs.map_width = TerrainData.SIZE
	hs.map_depth = TerrainData.SIZE
	hs.map_data = TerrainData.heights
	cs.shape = hs
	cs.scale = Vector3(TerrainData.CELL, 1.0, TerrainData.CELL)
	_body.add_child(cs)
	add_child(_body)
	print("[Terrain] heightfield collider %d² built in %d ms" % [TerrainData.SIZE, Time.get_ticks_msec() - t0])


func _build_boundary() -> void:
	var b := StaticBody3D.new()
	b.name = "MapBoundary"
	b.collision_layer = 1
	b.collision_mask = 0
	var h := TerrainData.HALF - BOUNDARY_INSET
	for pl in [Plane(Vector3(1, 0, 0), -h), Plane(Vector3(-1, 0, 0), -h), Plane(Vector3(0, 0, 1), -h),
			Plane(Vector3(0, 0, -1), -h)]:
		var cs := CollisionShape3D.new()
		var ws := WorldBoundaryShape3D.new()
		ws.plane = pl
		cs.shape = ws
		b.add_child(cs)
	add_child(b)


# =========================================================================================== sun shadow
func _build_sun_shadow() -> void:
	if DisplayServer.get_name() == "headless":
		return
	var size := 512 if mobile else 1024
	_sun_vp = SubViewport.new()
	_sun_vp.name = "SunShadow"
	_sun_vp.size = Vector2i(size, size)
	_sun_vp.disable_3d = true
	_sun_vp.transparent_bg = false
	_sun_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	_sun_rect = ColorRect.new()
	_sun_rect.size = Vector2(size, size)
	_sun_mat = ShaderMaterial.new()
	_sun_mat.shader = load(SHADER_SUN)
	_sun_mat.set_shader_parameter(&"map_height_tex", TerrainData.height_texture)
	_sun_mat.set_shader_parameter(&"mid_height_tex", TerrainData.mid_texture)
	_sun_mat.set_shader_parameter(&"steps", 72 if mobile else 110)
	_sun_mat.set_shader_parameter(&"growth", 1.085 if mobile else 1.06)
	_sun_rect.material = _sun_mat
	_sun_vp.add_child(_sun_rect)
	add_child(_sun_vp)
	RenderingServer.global_shader_parameter_set(&"terrain_shadow_tex", _sun_vp.get_texture())
	RenderingServer.global_shader_parameter_set(&"terrain_shadow_params", Vector4(-3072.0, -3072.0, 6144.0, 0.0))
	_sun_last = Vector3.ZERO


func _sun_direction() -> Vector3:
	var sun := get_tree().get_first_node_in_group(&"sun") as DirectionalLight3D
	if sun:
		return sun.global_transform.basis.z.normalized()
	if Climate.has_method(&"get_sun_direction"):
		return Climate.get_sun_direction()
	return Vector3(0.3, 0.8, -0.4).normalized()


func _update_sun_shadow(delta: float) -> void:
	_sun_timer += delta
	var d := _sun_direction()
	var moved := _sun_last == Vector3.ZERO or rad_to_deg(d.angle_to(_sun_last)) > 0.2
	if not moved and _sun_timer < 30.0:
		return
	_sun_timer = 0.0
	_sun_last = d
	_sun_mat.set_shader_parameter(&"sun_dir", d)
	_sun_mat.set_shader_parameter(&"near_skip", clampf(_shadow_distance * 0.45, 40.0, 180.0))
	_sun_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	RenderingServer.global_shader_parameter_set(&"terrain_shadow_params", Vector4(-3072.0, -3072.0, 6144.0, 1.0))


## Force a sun-shadow refresh (e.g. after a time skip).
func refresh_sun_shadow() -> void:
	_sun_last = Vector3.ZERO

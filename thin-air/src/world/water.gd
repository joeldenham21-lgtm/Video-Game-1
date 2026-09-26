class_name WaterSystem
extends Node3D
## THIN AIR — lakes, rivers, falls, water volumes and the underwater view (Water stream).
## Instanced by world.gd as the "Water" part (scenes/world/water.tscn). Everything is generated at load from
## data/world_layout.json via TerrainData: lakes at their levels, rivers along the polyline profiles. The drawn
## surface is WaterQuery.surface_at(); tests/test_water.gd samples it against the meshes and against
## TerrainData.get_water_level() (equal on lakes and gentle reaches; see WaterQuery for the steep/braided caveat).
##
## Children built at runtime:
##   Lakes (1 draw call: Loon Lake + tarns)      Rivers_* (≤ 4 draw calls, 2×2 map buckets)
##   Volumes/<id> WaterVolume Area3Ds (layer 6: buoyancy, player sensor)
##   Falls/Mist_* GPUParticles3D spray (visibility range 240 m)   Falls/Audio_* waterfall/stream loop emitters
##   Underwater (WaterUnderwater CanvasLayer overlay)
## Shaders: water_lake.gdshader (Forward+: + screen-space reflections), water_lake_mobile.gdshader (no screen or
## depth texture), water_river.gdshader (both renderers).
##
## Public API: WaterSystem.instance, get_lake_mesh(), get_river_meshes(), get_volumes(), get_fall_sites(),
## get_emitters(), is_camera_underwater(), water_draw_calls(), rebuild().

static var instance: WaterSystem

const TEX := "res://assets/textures/water/"
const SH_LAKE := "res://assets/shaders/water_lake.gdshader"
const SH_LAKE_MOBILE := "res://assets/shaders/water_lake_mobile.gdshader"
const SH_RIVER := "res://assets/shaders/water_river.gdshader"
const MAX_MIST := 3
const MAX_FALL_AUDIO := 4
const MAX_STREAM_AUDIO := 3
const MIST_RANGE := 240.0

var lake_material: ShaderMaterial
var river_material: ShaderMaterial
var fall_sites: Array = []

var _lakes_mi: MeshInstance3D
var _river_mis: Array[MeshInstance3D] = []
var _volumes: Array[WaterVolume] = []
var _mists: Array[GPUParticles3D] = []
var _emitters: Array[Dictionary] = []      # {node: Node3D, id: StringName, range: float, player: AudioStreamPlayer3D}
var _underwater: WaterUnderwater
var _sun: DirectionalLight3D
var _sky: Node
var _tick := 0.0
var _built := false


func _enter_tree() -> void:
	instance = self


func _exit_tree() -> void:
	if instance == self:
		instance = null


func _ready() -> void:
	add_to_group(&"water_system")
	if TerrainData.is_loaded() or not TerrainData.get_lakes().is_empty():
		rebuild()
	elif TerrainData.has_signal(&"data_loaded"):
		TerrainData.data_loaded.connect(rebuild, CONNECT_ONE_SHOT)
	if Events.has_signal(&"settings_changed"):
		Events.settings_changed.connect(_on_settings_changed)


func rebuild() -> void:
	for c in get_children():
		c.queue_free()
		remove_child(c)
	_river_mis.clear()
	_volumes.clear()
	_mists.clear()
	_emitters.clear()
	_make_materials()
	var lakes: Array = TerrainData.get_lakes()
	var rivers: Array = TerrainData.get_rivers()
	# ---- surfaces
	_lakes_mi = MeshInstance3D.new()
	_lakes_mi.name = "Lakes"
	_lakes_mi.mesh = WaterBuilder.build_lakes(lakes)
	_setup_mi(_lakes_mi, lake_material)
	add_child(_lakes_mi)
	var k := 0
	for m in WaterBuilder.build_rivers(rivers, lakes):
		var mi := MeshInstance3D.new()
		mi.name = "Rivers_%d" % k
		mi.mesh = m
		_setup_mi(mi, river_material)
		add_child(mi)
		_river_mis.append(mi)
		k += 1
	# ---- volumes
	var vol_root := Node3D.new()
	vol_root.name = "Volumes"
	add_child(vol_root)
	for lk in lakes:
		var v := _lake_volume(lk)
		if v:
			vol_root.add_child(v)
			_volumes.append(v)
	for rv in rivers:
		var rvv := _river_volume(rv)
		if rvv:
			vol_root.add_child(rvv)
			_volumes.append(rvv)
	# ---- falls: mist + audio
	fall_sites = WaterBuilder.find_falls(rivers)
	var falls_root := Node3D.new()
	falls_root.name = "Falls"
	add_child(falls_root)
	_build_falls(falls_root)
	# ---- underwater overlay
	_underwater = WaterUnderwater.new()
	_underwater.name = "Underwater"
	add_child(_underwater)
	_built = true
	_update_params()


func _setup_mi(mi: MeshInstance3D, mat: Material) -> void:
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	mi.add_to_group(&"water_surface")


func _make_materials() -> void:
	var ra: Texture2D = load(TEX + "water_ripple_a_normal.png")
	var rb: Texture2D = load(TEX + "water_ripple_b_normal.png")
	var foam: Texture2D = load(TEX + "water_foam.png")
	lake_material = ShaderMaterial.new()
	lake_material.shader = load(_lake_shader_path())
	river_material = ShaderMaterial.new()
	river_material.shader = load(SH_RIVER)
	for m in [lake_material, river_material]:
		m.set_shader_parameter(&"ripple_a", ra)
		m.set_shader_parameter(&"ripple_b", rb)
		m.set_shader_parameter(&"foam_tex", foam)
	river_material.set_shader_parameter(&"refl_terrain", 0.0)
	# lakes sort behind rivers where a river runs into one
	lake_material.render_priority = -1


func _lake_shader_path() -> String:
	return SH_LAKE if Settings.is_forward_plus() and not Settings.is_mobile() else SH_LAKE_MOBILE


func _on_settings_changed() -> void:
	if lake_material:
		var want: Shader = load(_lake_shader_path())
		if lake_material.shader != want:
			lake_material.shader = want
	_apply_particles_setting()


# ------------------------------------------------------------------------------------------------ volumes
func _lake_volume(lk: Dictionary) -> WaterVolume:
	var poly := WaterBuilder.lake_polygon(lk)
	var level := float(lk.get("level", 0.0))
	var depth := float(lk.get("max_depth", 20.0)) + 4.0
	var v := WaterVolume.new()
	v.name = "Lake_" + String(lk.get("id", "lake"))
	v.setup_lake(StringName(str(lk.get("id", ""))), level)
	var pieces := Geometry2D.decompose_polygon_in_convex(poly)
	for piece in pieces:
		var pts := PackedVector3Array()
		for p in (piece as PackedVector2Array):
			pts.append(Vector3(p.x, level + 0.25, p.y))
			pts.append(Vector3(p.x, level - depth, p.y))
		var shape := ConvexPolygonShape3D.new()
		shape.points = pts
		var cs := CollisionShape3D.new()
		cs.shape = shape
		v.add_child(cs)
	return v if v.get_child_count() > 0 else null


func _river_volume(rv: Dictionary) -> WaterVolume:
	var pts: Array = rv.get("points", [])
	if pts.size() < 2:
		return null
	var v := WaterVolume.new()
	v.name = "River_" + String(rv.get("id", "river"))
	v.setup_river(StringName(str(rv.get("id", ""))))
	var step := 3
	var i := 0
	while i < pts.size() - 1:
		var j := mini(i + step, pts.size() - 1)
		var a: Array = pts[i]
		var b: Array = pts[j]
		var pa := Vector3(float(a[0]), float(a[1]), float(a[2]))
		var pb := Vector3(float(b[0]), float(b[1]), float(b[2]))
		var flat := Vector3(pb.x - pa.x, 0.0, pb.z - pa.z)
		var length := flat.length()
		if length > 0.05:
			var w := maxf(float(a[3]), float(b[3])) + 1.0
			var drop := absf(pa.y - pb.y)
			var box := BoxShape3D.new()
			box.size = Vector3(w, drop + 4.5, length + 1.0)
			var cs := CollisionShape3D.new()
			cs.shape = box
			var fwd := flat / length
			var basis := Basis(Vector3.UP.cross(fwd).normalized(), Vector3.UP, fwd)
			var mid := (pa + pb) * 0.5
			cs.transform = Transform3D(basis, Vector3(mid.x, minf(pa.y, pb.y) - 4.0 + (drop + 4.5) * 0.5 + 0.25, mid.z))
			v.add_child(cs)
		i = j
	return v if v.get_child_count() > 0 else null


# ------------------------------------------------------------------------------------------------ falls
func _build_falls(root: Node3D) -> void:
	var mist_tex: Texture2D = load(TEX + "water_mist.png")
	var n_mist := 0
	var n_fall_audio := 0
	var n_stream := 0
	for site in fall_sites:
		var base: Vector3 = site["base"]
		var top: Vector3 = site["top"]
		if site["kind"] == &"fall":
			if n_mist < MAX_MIST:
				var mist := _make_mist(mist_tex, float(site["drop"]), float(site["width"]))
				mist.name = "Mist_%d" % n_mist
				root.add_child(mist)
				mist.global_position = base + Vector3(0.0, 1.0, 0.0)
				_mists.append(mist)
				n_mist += 1
			if n_fall_audio < MAX_FALL_AUDIO:
				_add_emitter(root, "Audio_fall_%d" % n_fall_audio, base.lerp(top, 0.15), &"waterfall_loop", 270.0)
				n_fall_audio += 1
		elif n_stream < MAX_STREAM_AUDIO:
			_add_emitter(root, "Audio_cascade_%d" % n_stream, base.lerp(top, 0.5), &"water_stream_loop", 80.0)
			n_stream += 1
	_apply_particles_setting()


func _make_mist(tex: Texture2D, drop: float, width: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 24
	p.lifetime = 4.0
	p.preprocess = 4.0
	p.fixed_fps = 20
	p.visibility_aabb = AABB(Vector3(-25, -5, -25), Vector3(50, 40, 50))
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_range_end = MIST_RANGE
	p.visibility_range_end_margin = 30.0
	p.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(maxf(width, 3.0) * 0.6, 0.6, maxf(width, 3.0) * 0.6)
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 70.0
	pm.initial_velocity_min = 1.0
	pm.initial_velocity_max = 2.5 + clampf(drop / 40.0, 0.0, 3.0)
	pm.gravity = Vector3(0, -0.4, 0)
	pm.damping_min = 0.6
	pm.damping_max = 1.2
	pm.scale_min = 2.5
	pm.scale_max = 5.5 + clampf(drop / 30.0, 0.0, 4.0)
	pm.angle_min = -180.0
	pm.angle_max = 180.0
	var grad := Gradient.new()
	grad.offsets = PackedFloat32Array([0.0, 0.2, 0.7, 1.0])
	grad.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, 0.3), Color(1, 1, 1, 0.14), Color(1, 1, 1, 0)])
	var gt := GradientTexture1D.new()
	gt.gradient = grad
	pm.color_ramp = gt
	var sc := Curve.new()
	sc.add_point(Vector2(0, 0.45))
	sc.add_point(Vector2(1, 1.0))
	var st := CurveTexture.new()
	st.curve = sc
	pm.scale_curve = st
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.billboard_keep_scale = true            # particle scale (2.5–9 m puffs) survives billboarding
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = tex
	mat.albedo_color = Color(0.92, 0.95, 0.97)
	mat.disable_receive_shadows = true
	quad.material = mat
	p.draw_pass_1 = quad
	return p


func _apply_particles_setting() -> void:
	var q := int(Settings.get_value(&"particles", 2))
	for m in _mists:
		if is_instance_valid(m):
			m.visible = q > 0
			m.amount = 24 if q >= 2 else 12


func _add_emitter(root: Node3D, nm: String, pos: Vector3, id: StringName, rng: float) -> void:
	var n := Node3D.new()
	n.name = nm
	root.add_child(n)
	n.global_position = pos
	_emitters.append({"node": n, "id": id, "range": rng, "player": null})


func _update_emitters(cam_pos: Vector3) -> void:
	for e in _emitters:
		var n: Node3D = e["node"]
		var d := n.global_position.distance_to(cam_pos)
		var pl: AudioStreamPlayer3D = e["player"]
		if d < float(e["range"]) and (pl == null or not is_instance_valid(pl)):
			e["player"] = Audio.play_loop(e["id"], n, -2.0) if Audio.has_method(&"play_loop") else null
		elif d > float(e["range"]) + 25.0 and pl != null and is_instance_valid(pl):
			pl.stop()
			pl.queue_free()
			e["player"] = null


# ------------------------------------------------------------------------------------------------ frame
func _process(delta: float) -> void:
	if not _built:
		return
	_tick -= delta
	if _tick > 0.0:
		return
	_tick = 0.25
	_update_params()
	var cam := get_viewport().get_camera_3d()
	if cam:
		_update_emitters(cam.global_position)


func _update_params() -> void:
	if _sun == null or not is_instance_valid(_sun):
		_sun = get_tree().get_first_node_in_group(&"sun") as DirectionalLight3D
	if _sky == null or not is_instance_valid(_sky):
		_sky = get_tree().get_first_node_in_group(&"sky")
	var sun_col := Vector3(1.0, 0.97, 0.92) * 3.0
	if _sun:
		var c := _sun.light_color * _sun.light_energy
		sun_col = Vector3(c.r, c.g, c.b) if _sun.visible else Vector3.ZERO
	var amb := Vector3(0.35, 0.42, 0.5)
	if _sky and _sky.has_method(&"get_fog_color"):
		var fc: Color = _sky.call(&"get_fog_color")
		amb = Vector3(fc.r, fc.g, fc.b)
	var daylight := float(Climate.get_daylight()) if Climate.has_method(&"get_daylight") else 1.0
	var t_air := 5.0
	if Climate.has_method(&"get_air_temperature"):
		t_air = float(Climate.get_air_temperature(Vector3(268.0, 1420.0, 628.0)))
	# late-October skim ice: nightly freezes leave a rim that survives in shade; colder → wider
	var ice := clampf(0.12 + (3.0 - t_air) / 10.0, 0.0, 1.0)
	for m in [lake_material, river_material]:
		if m == null:
			continue
		m.set_shader_parameter(&"refl_sun", sun_col)
		m.set_shader_parameter(&"refl_amb", amb)
		m.set_shader_parameter(&"night", clampf(1.0 - daylight * 4.0, 0.0, 1.0))
	if lake_material:
		lake_material.set_shader_parameter(&"ice_amount", ice)


# ------------------------------------------------------------------------------------------------ API
func get_lake_mesh() -> MeshInstance3D:
	return _lakes_mi


func get_river_meshes() -> Array[MeshInstance3D]:
	return _river_mis


func get_volumes() -> Array[WaterVolume]:
	return _volumes


func get_fall_sites() -> Array:
	return fall_sites


func get_emitters() -> Array[Dictionary]:
	return _emitters


func get_underwater() -> WaterUnderwater:
	return _underwater


func is_camera_underwater() -> bool:
	return _underwater != null and _underwater.underwater


## Worst-case water draw calls: every surface mesh + every mist system (each is one draw).
func water_draw_calls() -> int:
	var n := 0
	if _lakes_mi and _lakes_mi.mesh and _lakes_mi.mesh.get_surface_count() > 0:
		n += _lakes_mi.mesh.get_surface_count()
	for mi in _river_mis:
		n += mi.mesh.get_surface_count()
	return n + _mists.size()

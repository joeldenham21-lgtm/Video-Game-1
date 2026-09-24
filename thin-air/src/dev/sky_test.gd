extends Node
## Sky / weather look-dev scene. Same arguments as scenes/dev/shot.tscn, plus a procedural mountain
## backdrop (dev stand-in until the real terrain lands) so aerial perspective, lighting and weather can be
## judged against mountains, snow and conifer forest.
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/s.png --fixed-fps 30 \
##     --quit-after 40 --resolution 1280x720 res://scenes/dev/sky_test.tscn -- --hours=16.75 --weather=clear \
##     --look=240,4 [--pos=x,g,z] [--moon=0.5] [--aurora=0.8] [--snow=0.4] [--day=3] [--preset=high] [--perf]
##     [--fov=70] [--no_backdrop] [--timelapse=HOURS_PER_SECOND]
## yaw: 0 = north (−Z), 90 = west, 180 = south, 270 = east (Godot Y rotation).

const TERRAIN_SIZE := 18000.0
const TERRAIN_RES := 256

var args := {}
var cam: Camera3D
var frame := 0
var perf_at := 30
var timelapse := 0.0
var _gpu_accum := 0.0
var _gpu_n := 0


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	perf_at = int(args.get("perf_at", "30"))
	timelapse = float(args.get("timelapse", "0"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	if args.has("taa"):
		Settings.set_value(&"taa", args["taa"] == "1")
	var W = load("res://src/world/world.gd")
	W.dev_no_player = true
	Game.is_new_game = false
	Climate.day = int(args.get("day", "1"))
	Climate.hours = float(args.get("hours", "10.0"))
	if args.has("moon"):
		Climate.moon_phase_override = float(args["moon"])
	if args.has("snow"):
		Climate.snow_cover = float(args["snow"])
	var world: Node = (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	if args.has("weather"):
		Climate.set_weather(StringName(args["weather"]), 0.0)
	if args.has("aurora"):
		Climate.aurora_forced = float(args["aurora"])
	Climate.locked = timelapse <= 0.0
	if not args.has("no_backdrop"):
		var t := world.get_node_or_null("Terrain")
		if t:
			t.visible = false
		_build_backdrop()
	cam = Camera3D.new()
	cam.fov = float(args.get("fov", "70"))
	cam.far = 14000.0
	cam.near = 0.1
	add_child(cam)
	var pos := Vector3(0.0, 0.0, 0.0)
	if args.has("pos"):
		var p := String(args["pos"]).split(",")
		pos.x = float(p[0])
		pos.z = float(p[2])
		pos.y = _height(pos.x, pos.z) + float(args.get("height", "1.7")) if p[1] == "g" else float(p[1])
	else:
		pos.y = _height(0.0, 0.0) + 1.7
	cam.global_position = pos
	var look := String(args.get("look", "180,5")).split(",")
	cam.rotation_degrees = Vector3(float(look[1]) if look.size() > 1 else 0.0, float(look[0]), 0.0)
	cam.make_current()
	RenderingServer.global_shader_parameter_set(&"player_position", pos)
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	var sky := get_tree().get_first_node_in_group(&"sky")
	if sky and sky.has_method("snap"):
		sky.call_deferred("snap")
	if args.has("pdebug"):
		call_deferred("_particle_debug", int(args["pdebug"]))
	if args.has("probe_mats"):
		_probe_materials(pos, cam.global_basis)


## Dev: emissive / unshaded / lit reference cubes in front of the camera (exposure pipeline checks).
func _probe_materials(pos: Vector3, basis: Basis) -> void:
	var kinds := ["emissive", "unshaded", "lit"]
	for i in kinds.size():
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.6, 0.6, 0.6)
		mi.mesh = bm
		var m := StandardMaterial3D.new()
		match kinds[i]:
			"emissive":
				m.albedo_color = Color(0, 0, 0)
				m.emission_enabled = true
				m.emission = Color(1.0, 0.5, 0.2)
				m.emission_energy_multiplier = 0.05
			"unshaded":
				m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
				m.albedo_color = Color(0.05, 0.05, 0.05)
			"lit":
				m.albedo_color = Color(0.8, 0.8, 0.8)
		mi.material_override = m
		add_child(mi)
		mi.global_position = pos + basis * Vector3((float(i) - 1.0) * 1.0, -0.3, -3.0)


func _particle_debug(mode: int) -> void:
	var sky := get_tree().get_first_node_in_group(&"sky")
	var snow := sky.get_node_or_null("WeatherFX/Snow") as GPUParticles3D
	if snow == null:
		print("SKY no snow node")
		return
	if args.has("pamount"):
		snow.amount = int(args["pamount"])
	if mode == 1:
		var sm := StandardMaterial3D.new()
		sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		sm.albedo_color = Color(1, 0, 0)
		sm.disable_fog = true
		(snow.draw_pass_1 as QuadMesh).material = sm
		if args.has("psize"):
			(snow.draw_pass_1 as QuadMesh).size = Vector2.ONE * float(args["psize"])
	elif mode == 2:
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
		pm.emission_box_extents = Vector3(8, 5, 8)
		pm.gravity = Vector3(0, -1, 0)
		snow.process_material = pm
		snow.lifetime = 8.0
	elif mode == 9:
		var pm9 := snow.process_material as ShaderMaterial
		var big := args.has("pbig")
		var bs := Vector3(28, 16, 28) if big else Vector3(4, 3, 4)
		var bo := Vector3(0, 4, -16) if big else Vector3(0, 0, -6)
		if args.has("pbox"):
			var b := String(args["pbox"]).split(",")
			bs = Vector3(float(b[0]), float(b[1]), float(b[2]))
		if args.has("poff"):
			var o := String(args["poff"]).split(",")
			bo = Vector3(float(o[0]), float(o[1]), float(o[2]))
		pm9.set_shader_parameter(&"box_size", bs)
		pm9.set_shader_parameter(&"box_offset", bo)
		((snow.draw_pass_1 as QuadMesh).material as ShaderMaterial).set_shader_parameter(&"debug_mode", 1)
	elif mode >= 3:
		var dm := ((snow.draw_pass_1 as QuadMesh).material as ShaderMaterial)
		dm.set_shader_parameter(&"debug_mode", mode - 2 if mode < 10 else mode - 10)
		print("SKY size range ", (snow.process_material as ShaderMaterial).get_shader_parameter(&"size_min"), " far ", dm.get_shader_parameter(&"far_fade"))
	print("SKY particle debug mode ", mode)


func _process(delta: float) -> void:
	frame += 1
	if timelapse > 0.0:
		Climate.advance_time(timelapse * delta)
	if frame > 5:
		var g := RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid())
		if g > 0.0:
			_gpu_accum += g
			_gpu_n += 1
	if args.has("perf") and frame == perf_at:
		var sky := get_tree().get_first_node_in_group(&"sky")
		print("PERF draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			" objects=", Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
			" vram_mb=", snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1),
			" gpu_ms_avg=", snappedf(_gpu_accum / maxf(float(_gpu_n), 1.0), 0.01),
			" exposure=", snappedf(sky.get_exposure(), 0.01) if sky else -1.0,
			" renderer=", RenderingServer.get_current_rendering_method())
		if sky and args.has("debug"):
			print("SKY ", sky.get_debug_uniforms())
			var wfx := sky.get_node_or_null("WeatherFX")
			if wfx:
				for c in wfx.get_children():
					if c is GPUParticles3D:
						var gp := c as GPUParticles3D
						print("SKY particles ", gp.name, " visible=", gp.is_visible_in_tree(), " emitting=", gp.emitting,
							" amount=", gp.amount, " pos=", gp.global_position, " density=", (gp.process_material as ShaderMaterial).get_shader_parameter(&"density"))


# ============================================================================================ backdrop
func _height(x: float, z: float) -> float:
	return _terrain_h(x, z)


var _n1 := FastNoiseLite.new()
var _n2 := FastNoiseLite.new()
var _n3 := FastNoiseLite.new()
var _noise_ready := false


func _init_noise() -> void:
	if _noise_ready:
		return
	_noise_ready = true
	_n1.seed = 1234
	_n1.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_n1.frequency = 0.00022
	_n1.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_n1.fractal_octaves = 6
	_n1.fractal_gain = 0.5
	_n1.fractal_lacunarity = 2.1
	_n2.seed = 99
	_n2.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_n2.frequency = 0.00011
	_n2.fractal_octaves = 3
	_n3.seed = 7
	_n3.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_n3.frequency = 0.0035
	_n3.fractal_octaves = 3


## Valley around the origin at ~1,450 m, rising into ridges and peaks (summit massif to the north).
func _terrain_h(x: float, z: float) -> float:
	_init_noise()
	var r := Vector2(x, z * 0.8).length()
	var ridge := _n1.get_noise_2d(x, z) * 0.5 + 0.5          # 0..1, sharp crests
	var broad := _n2.get_noise_2d(x, z) * 0.5 + 0.5
	var valley := smoothstep(700.0, 4200.0, r)
	var h := 1450.0 + valley * (450.0 + 1300.0 * broad + 1500.0 * ridge * ridge * ridge)
	# summit massif to the north-north-east
	var s := Vector2(x - 900.0, z + 5200.0).length()
	h += 1300.0 * exp(-s * s / (2600.0 * 2600.0)) * (0.7 + 0.3 * ridge)
	# gentle valley floor texture
	h += (1.0 - valley) * 6.0 * _n3.get_noise_2d(x, z)
	return h


func _build_backdrop() -> void:
	var n := TERRAIN_RES
	var step := TERRAIN_SIZE / float(n)
	var half := TERRAIN_SIZE * 0.5
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var idx := PackedInt32Array()
	verts.resize((n + 1) * (n + 1))
	norms.resize((n + 1) * (n + 1))
	var hs := PackedFloat32Array()
	hs.resize((n + 1) * (n + 1))
	for j in n + 1:
		for i in n + 1:
			# denser near the centre: warp the grid radially
			var u := float(i) / float(n) * 2.0 - 1.0
			var v := float(j) / float(n) * 2.0 - 1.0
			var wu := signf(u) * pow(absf(u), 1.6)
			var wv := signf(v) * pow(absf(v), 1.6)
			var x := wu * half
			var z := wv * half
			var y := _terrain_h(x, z)
			hs[j * (n + 1) + i] = y
			verts[j * (n + 1) + i] = Vector3(x, y, z)
	for j in n + 1:
		for i in n + 1:
			var c := verts[j * (n + 1) + i]
			var l := verts[j * (n + 1) + maxi(i - 1, 0)]
			var r := verts[j * (n + 1) + mini(i + 1, n)]
			var d := verts[maxi(j - 1, 0) * (n + 1) + i]
			var u2 := verts[mini(j + 1, n) * (n + 1) + i]
			norms[j * (n + 1) + i] = (u2 - d).cross(r - l).normalized()
			if norms[j * (n + 1) + i].y < 0.0:
				norms[j * (n + 1) + i] = -norms[j * (n + 1) + i]
	for j in n:
		for i in n:
			var a := j * (n + 1) + i
			idx.append_array([a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.name = "DevBackdrop"
	mi.mesh = mesh
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/dev/sky_test_terrain.gdshader")
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mi)
	_scatter_trees()


func _scatter_trees() -> void:
	var tree_mesh := _make_conifer()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	var xforms: Array[Transform3D] = []
	var cols: Array[Color] = []
	var tries := 0
	while xforms.size() < 3500 and tries < 60000:
		tries += 1
		var r := pow(rng.randf(), 0.7) * 3200.0
		var a := rng.randf() * TAU
		var x := cos(a) * r
		var z := sin(a) * r
		if Vector2(x, z).length() < 25.0:
			continue
		var y := _terrain_h(x, z)
		if y > 1950.0 + 150.0 * rng.randf():
			continue
		var slope := Vector3(_terrain_h(x + 4.0, z) - _terrain_h(x - 4.0, z), 8.0, _terrain_h(x, z + 4.0) - _terrain_h(x, z - 4.0)).normalized().y
		if slope < 0.78:
			continue
		# clumpy forest with meadows
		if _n3.get_noise_2d(x * 0.35, z * 0.35) < -0.05:
			continue
		var s := rng.randf_range(0.7, 1.35) * lerpf(1.0, 0.6, clampf((y - 1500.0) / 500.0, 0.0, 1.0))
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.9, 1.2), s))
		xforms.append(Transform3D(b, Vector3(x, y - 0.3, z)))
		cols.append(Color(rng.randf_range(0.85, 1.1), rng.randf_range(0.85, 1.1), rng.randf_range(0.85, 1.1)))
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		mm.set_instance_color(i, cols[i])
	mm.mesh = tree_mesh
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "DevForest"
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mmi)


## Simple spruce/fir: stacked irregular cones (≈ 18 m tall) with a snow-dusted top surface in the shader.
func _make_conifer() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var tiers := 7
	var height := 18.0
	var seg := 7
	for t in tiers:
		var f := float(t) / float(tiers)
		var y0 := 1.5 + f * (height - 3.0)
		var y1 := y0 + (height - 1.5) / float(tiers) * 1.9
		var r0 := lerpf(3.0, 0.5, f)
		for k in seg:
			var a0 := TAU * float(k) / float(seg)
			var a1 := TAU * float(k + 1) / float(seg)
			var p0 := Vector3(cos(a0) * r0, y0, sin(a0) * r0)
			var p1 := Vector3(cos(a1) * r0, y0, sin(a1) * r0)
			var tip := Vector3(0.0, y1, 0.0)
			var nrm := (p1 - p0).cross(tip - p0).normalized()
			if nrm.y < 0.0:
				nrm = -nrm
			for p in [p0, tip, p1]:
				st.set_normal((nrm + Vector3(p.x, 0.0, p.z).normalized() * 0.6).normalized())
				st.set_uv(Vector2(0.0, p.y / height))
				st.add_vertex(p)
	# trunk
	for k in 5:
		var a0 := TAU * float(k) / 5.0
		var a1 := TAU * float(k + 1) / 5.0
		var b0 := Vector3(cos(a0) * 0.25, 0.0, sin(a0) * 0.25)
		var b1 := Vector3(cos(a1) * 0.25, 0.0, sin(a1) * 0.25)
		var t0 := b0 + Vector3(0, 3.0, 0)
		var t1 := b1 + Vector3(0, 3.0, 0)
		for p in [b0, t0, b1, b1, t0, t1]:
			st.set_normal(Vector3(p.x, 0.0, p.z).normalized())
			st.set_uv(Vector2(1.0, 0.0))
			st.add_vertex(p)
	var mesh := st.commit()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/dev/sky_test_tree.gdshader")
	mesh.surface_set_material(0, mat)
	return mesh

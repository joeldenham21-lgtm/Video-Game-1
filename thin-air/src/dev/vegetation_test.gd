extends Node3D
## Vegetation QA stage (dev only): every asset in a lineup on flat ground under the sky, a dense forest
## scatter on the stub terrain (the real Vegetation system), felling demo, wind/snow/LOD controls.
##
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/v.png --fixed-fps 30 \
##     --quit-after 60 --resolution 1280x720 res://scenes/dev/vegetation_test.tscn -- --mode=lineup
## Modes:
##   --mode=lineup   [--kinds=spruce_a,fir_a] [--lod=0|1|2|3 (3 = impostor)] [--spacing=m]
##   --mode=forest   the real Vegetation system (scenes/world/vegetation.tscn) on VegTestTerrain: a valley with
##                   a lake, forested slopes, an escarpment and a treeline bench, rendered as a terrain mesh
##                   with collision [--density=1.0] [--flat = the flat TerrainData stub instead]
##   --mode=fell     forest + chops the tree nearest to the camera (--hits=N, default: fell it) at frame
##                   --chop_at (default 20); the tree falls to the camera's right (--fall=left|right|away)
## Camera: --cam=x,y,z (y may be "g" = ground + --height) --look=yaw,pitch (yaw 0 = north/-Z) --fov=deg
## Light/weather: --hours=H (sun from time of day) or --sun=elev,az ; --wind=0..1.5 ; --snow=0..1 ; --wet=0..1
## --preset=P (Settings preset) --perf (prints PERF line at --perf_at frame) --fog=density --exposure=f
## Perf breakdown: --no_near --no_far --no_grass --no_terrain hide those parts.

const GROUND_Y := 1450.0

var args := {}
var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var frame := 0
var perf_at := 60
var lib: VegLibrary
var vegetation: Node = null
var terrain: VegTestTerrain = null


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	perf_at = int(args.get("perf_at", "60"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
	if args.has("tile_scale"):
		Vegetation.tile_scale = float(args["tile_scale"])
	if args.has("shadow_tile_scale"):
		Vegetation.shadow_tile_scale = float(args["shadow_tile_scale"])
	RenderingServer.global_shader_parameter_set(&"wind_strength", float(args.get("wind", "0.35")))
	RenderingServer.global_shader_parameter_set(&"wind_direction", Vector3(0.8, 0.0, 0.6).normalized())
	RenderingServer.global_shader_parameter_set(&"snow_cover", float(args.get("snow", "0.0")))
	RenderingServer.global_shader_parameter_set(&"wetness", float(args.get("wet", "0.0")))
	_build_environment()
	lib = VegLibrary.get_shared()
	cam = Camera3D.new()
	cam.fov = float(args.get("fov", "65"))
	cam.near = 0.08
	cam.far = float(Settings.get_value(&"view_distance", 4000.0))
	add_child(cam)
	match String(args.get("mode", "lineup")):
		"forest":
			_build_forest()
		"fell":
			_build_forest()
		_:
			_build_lineup()
	_place_camera()
	cam.make_current()


func _ground_at(x: float, z: float) -> float:
	return terrain.get_height(x, z) if terrain else GROUND_Y


func _place_camera() -> void:
	var c := String(args.get("cam", "")).split(",")
	if c.size() == 3:
		var y := _ground_at(float(c[0]), float(c[2])) + float(args.get("height", "1.7")) if c[1] == "g" else float(c[1])
		cam.global_position = Vector3(float(c[0]), y, float(c[2]))
	var look := String(args.get("look", "0,0")).split(",")
	cam.rotation_degrees = Vector3(float(look[1]) if look.size() > 1 else 0.0, float(look[0]), 0.0)


func _process(_d: float) -> void:
	frame += 1
	if cam:
		lib.set_view_origin(cam.global_position)
		RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)
	if args.get("mode", "") == "fell" and frame == int(args.get("chop_at", "20")):
		_chop_nearest()
	if vegetation and frame == 2:
		for part in ["Near", "Far", "Grass", "Terrain"]:
			if args.has("no_" + part.to_lower()):
				var n := vegetation.get_node_or_null(part) if part != "Terrain" else get_node_or_null("TestTerrain")
				if n:
					n.visible = false
	if args.has("perf") and frame == perf_at:
		print("PERF draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			" objects=", Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
			" vram_mb=", snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1),
			" nodes=", Performance.get_monitor(Performance.OBJECT_NODE_COUNT))


# ---------------------------------------------------------------------------------------------- environment

func _build_environment() -> void:
	var sky_scene := "res://scenes/world/sky.tscn"
	if args.get("own_sky", "0") == "0" and ResourceLoader.exists(sky_scene) and not args.has("sun"):
		Climate.hours = float(args.get("hours", "10.5"))
		Climate.locked = true
		add_child((load(sky_scene) as PackedScene).instantiate())
		return
	var we := WorldEnvironment.new()
	env = Environment.new()
	var sky := Sky.new()
	var psky := ProceduralSkyMaterial.new()
	psky.sky_top_color = Color(0.16, 0.3, 0.55)
	psky.sky_horizon_color = Color(0.55, 0.62, 0.7)
	psky.sky_curve = 0.1
	psky.ground_bottom_color = Color(0.12, 0.12, 0.11)
	psky.ground_horizon_color = Color(0.45, 0.5, 0.55)
	psky.sun_angle_max = 12.0
	psky.energy_multiplier = 1.0
	sky.sky_material = psky
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = float(args.get("exposure", "1.0"))
	env.ssao_enabled = Settings.is_forward_plus() and not Settings.is_mobile()
	env.ssao_radius = 1.2
	env.ssao_intensity = 1.0
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_density = float(args.get("fog", "0.0009"))
	env.fog_light_color = Color(0.64, 0.71, 0.8)
	env.fog_aerial_perspective = 0.7
	env.fog_sky_affect = 0.0
	env.glow_enabled = true
	env.glow_intensity = 0.3
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.add_to_group(&"sun")
	sun.shadow_enabled = args.get("shadows", "1") == "1"
	sun.shadow_bias = float(args.get("sbias", "0.1"))
	sun.shadow_normal_bias = float(args.get("snbias", "2.0"))
	sun.light_angular_distance = 0.53
	sun.directional_shadow_max_distance = float(Settings.get_value(&"shadow_distance", 200.0))
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS if Settings.is_mobile() \
		else DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.light_energy = float(args.get("sun_energy", "2.6"))
	sun.light_color = Color(1.0, 0.95, 0.88)
	var elev := 30.0
	var az := 150.0
	if args.has("sun"):
		var se := String(args["sun"]).split(",")
		elev = float(se[0])
		az = float(se[1]) if se.size() > 1 else az
	else:
		var h := float(args.get("hours", "10.5"))
		# 56 deg N late October: noon elevation ~ 23 deg, sunrise ~ 8:00, sunset ~ 17:30
		var t := (h - 12.5) / 5.0
		elev = maxf(-5.0, 23.0 * cos(clampf(t, -1.2, 1.2) * PI * 0.5) * 1.0)
		az = 180.0 + t * 62.0
	# light comes FROM azimuth az (0 = north, 90 = east) at elevation elev
	sun.rotation_degrees = Vector3(-elev, 180.0 - az, 0.0)
	if elev < 12.0:
		sun.light_color = Color(1.0, 0.8, 0.6)
		sun.light_energy *= 0.75
	add_child(sun)
	RenderingServer.global_shader_parameter_set(&"sun_direction", -sun.global_transform.basis.z)


func _ground(size: float, layer := "forest") -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(size, size)
	pm.subdivide_width = 16
	pm.subdivide_depth = 16
	mi.mesh = pm
	var m := StandardMaterial3D.new()
	var dir := "res://assets/textures/terrain/%s_" % layer
	m.albedo_texture = load(dir + "albedo.png")
	m.normal_enabled = true
	m.normal_texture = load(dir + "normal.png")
	m.roughness_texture = load(dir + "roughness.png")
	m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GRAYSCALE
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3.ONE / (2.5 if layer == "forest" else 3.0)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	mi.material_override = m
	mi.position = Vector3(0.0, GROUND_Y, 0.0)
	add_child(mi)


# ---------------------------------------------------------------------------------------------- lineup

func _build_lineup() -> void:
	_ground(600.0, String(args.get("ground", "forest")))
	var names: Array = []
	if args.has("kinds"):
		names = String(args["kinds"]).split(",")
	else:
		names = lib.kind_names.duplicate()
	var lod := int(args.get("lod", "0"))
	var spacing := float(args.get("spacing", "0"))
	var x := 0.0
	var prev_r := 0.0
	for i in names.size():
		var kind := StringName(names[i])
		if not lib.has_kind(kind):
			continue
		var inf := lib.info(kind)
		var r := clampf(float(inf.get("crown_radius", inf.get("radius", 1.0))), 0.4, 6.0)
		x += (prev_r + r + 1.2) if spacing <= 0.0 else spacing
		prev_r = r
		var pos := Vector3(x, GROUND_Y, 0.0)
		if lod >= 3 and lib.has_impostors() and inf.has("impostor_layer"):
			_add_impostor(kind, pos)
			continue
		var ms := lib.meshes(kind)
		if ms.is_empty():
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = ms[mini(lod, ms.size() - 1)]
		mi.position = pos
		mi.rotation.y = float(i) * 1.3
		add_child(mi)
		var l := Label3D.new()
		l.text = String(kind)
		l.pixel_size = 0.01
		l.font_size = 40
		l.outline_size = 8
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.position = pos + Vector3(0.0, -0.2, r + 0.6)
		if args.get("labels", "1") == "1":
			add_child(l)
	if not args.has("cam"):
		cam.global_position = Vector3(x * 0.5, GROUND_Y + 9.0, maxf(x * 0.62, 30.0))
		cam.rotation_degrees = Vector3(-4.0, 0.0, 0.0)
		args["cam"] = "%f,%f,%f" % [cam.global_position.x, cam.global_position.y, cam.global_position.z]


func _add_impostor(kind: StringName, pos: Vector3) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = lib.impostor_quad
	mm.instance_count = 1
	mm.set_instance_transform(0, Transform3D(Basis(), pos))
	mm.set_instance_custom_data(0, lib.impostor_custom(kind))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.set_instance_shader_parameter(&"lod_begin", 0.0)
	mmi.custom_aabb = AABB(Vector3(-10, -1, -10), Vector3(20, 40, 20))
	add_child(mmi)


# ---------------------------------------------------------------------------------------------- forest

func _build_forest() -> void:
	var path := "res://scenes/world/vegetation.tscn"
	if args.has("flat"):
		_ground(3000.0, String(args.get("ground", "forest")))
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		cs.shape = WorldBoundaryShape3D.new()
		body.add_child(cs)
		body.position.y = GROUND_Y
		add_child(body)
	else:
		terrain = VegTestTerrain.new()
		_build_terrain()
	if not ResourceLoader.exists(path):
		return
	vegetation = (load(path) as PackedScene).instantiate()
	if args.has("density") and "density_override" in vegetation:
		vegetation.set("density_override", float(args["density"]))
	if terrain:
		vegetation.set("terrain_override", terrain)
	vegetation.set("camera_override", cam)
	vegetation.set("sync_all", true)
	add_child(vegetation)


## Terrain mesh (4 m grid, vertex colours = masks) + heightmap collision + lake for VegTestTerrain.
func _build_terrain() -> void:
	var step := 4.0
	var half := VegTestTerrain.WINDOW
	var n := int(2.0 * half / step) + 1
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	verts.resize(n * n)
	norms.resize(n * n)
	cols.resize(n * n)
	var hm := PackedFloat32Array()
	hm.resize(n * n)
	for j in n:
		for i in n:
			var x := -half + i * step
			var z := -half + j * step
			var y := terrain.get_height(x, z)
			verts[j * n + i] = Vector3(x, y, z)
			norms[j * n + i] = terrain.get_normal(x, z)
			cols[j * n + i] = terrain.get_masks(x, z)
			hm[j * n + i] = y
	var idx := PackedInt32Array()
	idx.resize((n - 1) * (n - 1) * 6)
	var k := 0
	for j in n - 1:
		for i in n - 1:
			var a := j * n + i
			idx[k] = a
			idx[k + 1] = a + 1
			idx[k + 2] = a + n
			idx[k + 3] = a + 1
			idx[k + 4] = a + n + 1
			idx[k + 5] = a + n
			k += 6
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.name = "TestTerrain"
	mi.mesh = am
	var sh := Shader.new()
	sh.code = TERRAIN_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = sh
	for layer in ["forest", "grass", "rock", "scree", "snow", "cliff"]:
		var dir := "res://assets/textures/terrain/%s_" % layer
		mat.set_shader_parameter(StringName(layer + "_a"), load(dir + "albedo.png"))
		mat.set_shader_parameter(StringName(layer + "_n"), load(dir + "normal.png"))
	mi.material_override = mat
	add_child(mi)
	# collision
	var body := StaticBody3D.new()
	body.name = "TerrainBody"
	var cs := CollisionShape3D.new()
	var hs := HeightMapShape3D.new()
	hs.map_width = n
	hs.map_depth = n
	hs.map_data = hm
	cs.shape = hs
	cs.scale = Vector3(step, 1.0, step)
	body.add_child(cs)
	add_child(body)
	# lake
	var lake := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(VegTestTerrain.LAKE.z * 3.0, VegTestTerrain.LAKE.z * 3.0)
	lake.mesh = pm
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.02, 0.035, 0.04)
	wm.roughness = 0.04
	wm.metallic_specular = 0.6
	lake.material_override = wm
	lake.position = Vector3(VegTestTerrain.LAKE.x, terrain.lake_level, VegTestTerrain.LAKE.y)
	add_child(lake)


const TERRAIN_SHADER := """
shader_type spatial;
render_mode diffuse_burley;
uniform sampler2D forest_a : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D forest_n : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D grass_a : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D grass_n : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D rock_a : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D rock_n : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D scree_a : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D scree_n : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D snow_a : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D snow_n : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D cliff_a : source_color, filter_linear_mipmap_anisotropic;
uniform sampler2D cliff_n : hint_normal, filter_linear_mipmap_anisotropic;
global uniform float snow_cover;
varying vec4 m;
varying vec3 wp;
varying vec3 wn;
void vertex() {
	m = COLOR;
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = NORMAL;
}
void fragment() {
	float steep = smoothstep(0.82, 0.62, wn.y);
	vec2 uf = wp.xz / 2.5;
	vec2 ug = wp.xz / 3.0;
	vec2 ur = wp.xz / 4.0;
	vec2 uc = (abs(wn.x) > abs(wn.z) ? wp.zy : wp.xy) / 8.0;
	float wf = m.a;
	float wg = m.b * (1.0 - m.a);
	float wr = m.g * (1.0 - steep);
	float ws = max(m.r, smoothstep(0.1, 0.9, snow_cover) * smoothstep(0.55, 0.85, wn.y));
	float wc = steep;
	wf *= 1.0 - ws;
	wg *= 1.0 - ws;
	wr *= 1.0 - ws;
	float wsum = wf + wg + wr + ws + wc + 1e-3;
	vec3 a = (texture(forest_a, uf).rgb * wf + texture(grass_a, ug).rgb * wg + mix(texture(scree_a, ur).rgb,
		texture(rock_a, ur).rgb, 0.5) * wr + texture(snow_a, ur).rgb * ws + texture(cliff_a, uc).rgb * wc) / wsum;
	vec3 nt = (texture(forest_n, uf).rgb * wf + texture(grass_n, ug).rgb * wg + texture(rock_n, ur).rgb * wr
		+ texture(snow_n, ur).rgb * ws + texture(cliff_n, uc).rgb * wc) / wsum;
	ALBEDO = a;
	NORMAL_MAP = nt;
	ROUGHNESS = mix(0.85, 0.7, ws);
}
"""


func _chop_nearest() -> void:
	if vegetation == null or vegetation.get("harvest") == null:
		return
	var h: Node = vegetation.harvest
	var cp := cam.global_position
	var best := {}
	var bd := INF
	for e in vegetation.query(cp, 60.0, [VegScatter.Cat.TREE]):
		var sp := String(lib.info(e["kind"]).get("species", ""))
		if sp == "snag":
			continue
		var d := Vector2(e["pos"].x - cp.x, e["pos"].z - cp.z).length()
		# in front of the camera, 8-30 m away
		var to: Vector3 = (e["pos"] - cp).normalized()
		if d < 8.0 or d > 30.0 or to.dot(-cam.global_transform.basis.z) < 0.8:
			continue
		if d < bd:
			bd = d
			best = e
	if best.is_empty():
		print("VEG fell: no tree in view")
		return
	var right := cam.global_transform.basis.x
	var away := Vector3(best["pos"].x - cp.x, 0.0, best["pos"].z - cp.z).normalized()
	var fall := right
	match String(args.get("fall", "right")):
		"left":
			fall = -right
		"away":
			fall = away
	var chopper: Vector3 = best["pos"] - fall * 1.5
	var hits := int(args.get("hits", "0"))
	var hit_pos: Vector3 = best["pos"] + Vector3.UP * 0.9 - fall * 0.2
	if hits > 0:
		for i in hits:
			h.hit_instance(best["id"], &"felling_axe", 40.0, hit_pos, -fall, null)
	else:
		h.fell(best["id"], chopper)
	print("VEG fell: %s at %.1f m" % [best["kind"], bd])

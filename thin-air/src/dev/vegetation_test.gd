extends Node3D
## Vegetation QA stage (dev only): every asset in a lineup on flat ground under the sky, a dense forest
## scatter on the stub terrain (the real Vegetation system), felling demo, wind/snow/LOD controls.
##
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/v.png --fixed-fps 30 \
##     --quit-after 60 --resolution 1280x720 res://scenes/dev/vegetation_test.tscn -- --mode=lineup
## Modes:
##   --mode=lineup   [--kinds=spruce_a,fir_a] [--lod=0|1|2|3 (3 = impostor)] [--spacing=m]
##   --mode=forest   dense forest on the stub terrain via scenes/world/vegetation.tscn [--density=1.0]
##   --mode=fell     chops a tree next to the camera and lets it fall (harvest state machine demo)
## Camera: --cam=x,y,z (y may be "g" = ground + --height) --look=yaw,pitch (yaw 0 = north/-Z) --fov=deg
## Light/weather: --hours=H (sun from time of day) or --sun=elev,az ; --wind=0..1.5 ; --snow=0..1 ; --wet=0..1
## --preset=P (Settings preset) --perf (prints PERF line at --perf_at frame) --fog=density --exposure=f

const GROUND_Y := 1450.0

var args := {}
var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var frame := 0
var perf_at := 60
var lib: VegLibrary
var vegetation: Node = null


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	perf_at = int(args.get("perf_at", "60"))
	if args.has("preset"):
		Settings.apply_preset(StringName(args["preset"]))
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


func _place_camera() -> void:
	var c := String(args.get("cam", "")).split(",")
	if c.size() == 3:
		var y := GROUND_Y + float(args.get("height", "1.7")) if c[1] == "g" else float(c[1])
		cam.global_position = Vector3(float(c[0]), y, float(c[2]))
	var look := String(args.get("look", "0,0")).split(",")
	cam.rotation_degrees = Vector3(float(look[1]) if look.size() > 1 else 0.0, float(look[0]), 0.0)


func _process(_d: float) -> void:
	frame += 1
	if cam:
		lib.set_view_origin(cam.global_position)
		RenderingServer.global_shader_parameter_set(&"player_position", cam.global_position)
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
	var inf := lib.info(kind)
	mm.set_instance_custom_data(0, Color(float(inf["impostor_layer"]), float(inf["impostor_size"]),
		float(inf["impostor_center"]), 0.0))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.set_instance_shader_parameter(&"lod_begin", 0.0)
	add_child(mmi)


# ---------------------------------------------------------------------------------------------- forest

func _build_forest() -> void:
	var path := "res://scenes/world/vegetation.tscn"
	_ground(3000.0, String(args.get("ground", "forest")))
	if not ResourceLoader.exists(path):
		return
	vegetation = (load(path) as PackedScene).instantiate()
	if args.has("density") and "density_override" in vegetation:
		vegetation.set("density_override", float(args["density"]))
	vegetation.set("camera_override", cam)
	add_child(vegetation)

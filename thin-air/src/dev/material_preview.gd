extends Node3D
## Material & terrain-layer QA stage (dev only). Builds sky + sun + AgX tone mapping and lays out the
## texture library procedurally so renders can be compared against photographs.
##
## Usage (see CONTRACT.md §0 for the screenshot recipe):
##   DISPLAY=:99 godot --path thin-air --rendering-method forward_plus --write-movie /tmp/m.png --fixed-fps 30 \
##     --quit-after 40 --resolution 1280x720 res://scenes/dev/material_preview.tscn -- --mode=grid
## Modes:
##   --mode=grid                       every material (sphere on a ground patch) + every terrain layer patch
##   --mode=sets --sets=a,b,c          close-up row of the named material sets (sphere + patch + cylinder)
##   --mode=terrain --layer=snow       one terrain layer on a 400 m plane at its real tiling, eye height 1.7 m
##   --mode=strips --layers=a,b,c      side-by-side terrain strips from eye height (compare / repetition)
## Common options: --sun=elev,azimuth (deg; azimuth 0 = light from +Z/behind the camera, 90 = from +X/right,
##   180 = against the camera)
##   --cam=x,y,z --look=yaw,pitch --fov=deg --exposure=f --time=hours (sets a sun elevation preset)

const TERRAIN_DIR := "res://assets/textures/terrain/"
const MAT_DIR := "res://assets/materials/"
const LAYERS: Array[String] = ["snow", "rock", "cliff", "scree", "gravel", "grass", "forest", "dirt", "ice"]

const TERRAIN_SHADER := """
shader_type spatial;
render_mode cull_back, depth_draw_opaque;
uniform sampler2DArray albedo_height : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray normal_rough : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float layer = 0.0;
uniform float tiling_m = 4.0;
uniform float normal_depth = 1.0;
uniform bool vertical = false;   // map world Y to V (cliff faces)
varying vec3 wpos;
void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	UV = vertical ? vec2(wpos.x, -wpos.y) / tiling_m : wpos.xz / tiling_m;
}
void fragment() {
	vec4 ah = texture(albedo_height, vec3(UV, layer));
	vec4 nr = texture(normal_rough, vec3(UV, layer));
	ALBEDO = ah.rgb;
	NORMAL_MAP = nr.rgb;
	NORMAL_MAP_DEPTH = normal_depth;
	ROUGHNESS = nr.a;
	SPECULAR = 0.5;
}
"""

var args := {}
var layer_info: Array = []
var material_info: Dictionary = {}
var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var terrain_shader: Shader
var frame := 0


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	_load_meta()
	_build_environment()
	terrain_shader = Shader.new()
	terrain_shader.code = TERRAIN_SHADER
	var ah: Resource = load(TERRAIN_DIR + "terrain_albedo_height.png")
	var nr: Resource = load(TERRAIN_DIR + "terrain_normal_rough.png")
	cam = Camera3D.new()
	cam.fov = float(args.get("fov", "60"))
	cam.near = 0.05
	cam.far = 3000.0
	add_child(cam)
	match String(args.get("mode", "grid")):
		"terrain":
			_build_terrain(String(args.get("layer", "rock")), ah, nr)
		"strips":
			_build_strips(String(args.get("layers", "snow,rock,cliff")).split(","), ah, nr)
		"sets":
			_build_sets(String(args.get("sets", "rock_boulder,wood_log")).split(","), ah, nr)
		_:
			_build_grid(ah, nr)
	if args.has("cam"):
		var p := String(args["cam"]).split(",")
		cam.position = Vector3(float(p[0]), float(p[1]), float(p[2]))
	if args.has("look"):
		var l := String(args["look"]).split(",")
		cam.rotation_degrees = Vector3(float(l[1]), float(l[0]), 0.0)
	cam.make_current()


func _load_meta() -> void:
	var lj: Variant = JSON.parse_string(FileAccess.get_file_as_string(TERRAIN_DIR + "layers.json"))
	if lj is Array:
		layer_info = lj
	if FileAccess.file_exists(MAT_DIR + "materials.json"):
		var mj: Variant = JSON.parse_string(FileAccess.get_file_as_string(MAT_DIR + "materials.json"))
		if mj is Dictionary:
			material_info = mj


func _build_environment() -> void:
	var we := WorldEnvironment.new()
	env = Environment.new()
	var sky := Sky.new()
	var psky := ProceduralSkyMaterial.new()
	psky.sky_top_color = Color(0.13, 0.26, 0.52)
	psky.sky_horizon_color = Color(0.46, 0.54, 0.64)
	psky.sky_curve = 0.12
	psky.ground_bottom_color = Color(0.20, 0.19, 0.18)
	psky.ground_horizon_color = Color(0.55, 0.58, 0.62)
	psky.sun_angle_max = 20.0
	psky.energy_multiplier = float(args.get("sky_energy", "0.8"))
	sky.sky_material = psky
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = float(args.get("exposure", "1.0"))
	env.ssao_enabled = true
	env.ssao_radius = 0.6
	env.ssao_intensity = 1.2
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_density = 0.0012
	env.fog_light_color = Color(0.62, 0.7, 0.8)
	env.fog_aerial_perspective = 0.6
	env.fog_sky_affect = 0.0
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.light_angular_distance = 0.53
	sun.directional_shadow_max_distance = 120.0
	sun.light_energy = float(args.get("sun_energy", "2.4"))
	sun.light_color = Color(1.0, 0.96, 0.9)
	var se := String(args.get("sun", "32,50")).split(",")
	var elev := float(se[0])
	var az := float(se[1]) if se.size() > 1 else 125.0
	# DirectionalLight shines along its -Z: rotate so the light comes FROM azimuth az at elevation elev
	sun.rotation_degrees = Vector3(-elev, az, 0.0)
	if elev < 15.0:
		sun.light_color = Color(1.0, 0.82, 0.62)
	add_child(sun)


func _terrain_material(layer_name: String, ah: Resource, nr: Resource, vertical := false) -> ShaderMaterial:
	var idx := LAYERS.find(layer_name)
	var m := ShaderMaterial.new()
	m.shader = terrain_shader
	m.set_shader_parameter("albedo_height", ah)
	m.set_shader_parameter("normal_rough", nr)
	m.set_shader_parameter("layer", float(maxi(idx, 0)))
	var tiling := 4.0
	if idx >= 0 and idx < layer_info.size():
		tiling = float(layer_info[idx].get("tiling_m", 4.0))
	m.set_shader_parameter("tiling_m", tiling)
	m.set_shader_parameter("vertical", vertical)
	return m


func _material(set_name: String, uv_mul: Vector2) -> Material:
	var path := MAT_DIR + set_name + ".tres"
	if not ResourceLoader.exists(path):
		push_warning("missing material " + path)
		var fb := StandardMaterial3D.new()
		fb.albedo_color = Color(1, 0, 1)
		return fb
	var src: BaseMaterial3D = load(path)
	var m: BaseMaterial3D = src.duplicate()
	if not m.uv1_triplanar:
		m.uv1_scale = Vector3(src.uv1_scale.x * uv_mul.x, src.uv1_scale.y * uv_mul.y, 1.0)
	return m


func _label(text: String, pos: Vector3, size := 0.25) -> void:
	var l := Label3D.new()
	l.text = text
	l.position = pos
	l.pixel_size = 0.004 * size / 0.25
	l.font_size = 48
	l.outline_size = 8
	l.modulate = Color(1, 1, 1, 0.92)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.no_depth_test = true
	add_child(l)


func _add_mesh(mesh: Mesh, mat: Material, pos: Vector3, rot_deg := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation_degrees = rot_deg
	add_child(mi)
	return mi


func _ground(size: float, mat: Material) -> void:
	var pm := PlaneMesh.new()
	pm.size = Vector2(size, size)
	pm.subdivide_width = 8
	pm.subdivide_depth = 8
	_add_mesh(pm, mat, Vector3.ZERO)


func _neutral_ground(size: float) -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.18, 0.18, 0.18)
	m.roughness = 0.9
	var pm := PlaneMesh.new()
	pm.size = Vector2(size, size)
	_add_mesh(pm, m, Vector3(0, -0.002, 0))


## Every material as a sphere (r 0.45 m) standing on a 2 m ground patch of itself; terrain patches in front.
func _build_grid(ah: Resource, nr: Resource) -> void:
	_neutral_ground(200.0)
	var names: Array = material_info.keys()
	names.sort()
	var cols := 6
	var sp := 2.6
	var sphere := SphereMesh.new()
	sphere.radius = 0.45
	sphere.height = 0.9
	sphere.radial_segments = 96
	sphere.rings = 48
	var patch := PlaneMesh.new()
	patch.size = Vector2(2.0, 2.0)
	for i in names.size():
		var n: String = names[i]
		var x := (i % cols - (cols - 1) * 0.5) * sp
		var z := -float(i / cols) * sp - 4.0
		_add_mesh(sphere, _material(n, Vector2(TAU * 0.45, PI * 0.45)), Vector3(x, 0.47, z))
		_add_mesh(patch, _material(n, Vector2(2.0, 2.0)), Vector3(x, 0.001, z))
		_label(n, Vector3(x, 1.15, z), 0.2)
	var tp := PlaneMesh.new()
	tp.size = Vector2(2.4, 2.4)
	for i in LAYERS.size():
		var x := (i - 4) * 2.5
		_add_mesh(tp, _terrain_material(LAYERS[i], ah, nr), Vector3(x, 0.002, 0.0))
		_label(LAYERS[i], Vector3(x, 0.35, 1.1), 0.2)
	cam.position = Vector3(0, 9.0, 4.5)
	cam.rotation_degrees = Vector3(-52, 0, 0)


## A row of named sets, each as sphere + ground patch + upright cylinder (bark/logs read correctly on it).
func _build_sets(sets: PackedStringArray, ah: Resource, nr: Resource) -> void:
	_neutral_ground(200.0)
	var sp := 2.4
	var sphere := SphereMesh.new()
	sphere.radius = 0.5
	sphere.height = 1.0
	sphere.radial_segments = 128
	sphere.rings = 64
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.28
	cyl.bottom_radius = 0.3
	cyl.height = 2.0
	cyl.radial_segments = 96
	var patch := PlaneMesh.new()
	patch.size = Vector2(2.2, 2.2)
	for i in sets.size():
		var n := String(sets[i])
		var x := (i - (sets.size() - 1) * 0.5) * sp
		if LAYERS.has(n):
			_add_mesh(patch, _terrain_material(n, ah, nr), Vector3(x, 0.002, 0))
			var bm := BoxMesh.new()
			bm.size = Vector3(1.2, 1.6, 1.2)
			_add_mesh(bm, _terrain_material(n, ah, nr, true), Vector3(x, 0.8, -0.3))
		elif not bool(material_info.get(n, {}).get("tiling", true)):
			# decal-like / end-cap sets: show the whole UV square upright, and on a small ground patch
			var q := QuadMesh.new()
			q.size = Vector2(1.2, 1.2)
			_add_mesh(q, _material(n, Vector2(1, 1)), Vector3(x, 0.9, -0.2))
			_add_mesh(patch, _material(n, Vector2(1, 1)), Vector3(x, 0.002, 0))
		else:
			_add_mesh(patch, _material(n, Vector2(2.2, 2.2)), Vector3(x, 0.002, 0))
			_add_mesh(sphere, _material(n, Vector2(TAU * 0.5, PI * 0.5)), Vector3(x - 0.45, 0.5, 0.35))
			_add_mesh(cyl, _material(n, Vector2(TAU * 0.3, 2.0)), Vector3(x + 0.55, 1.0, -0.45))
		_label(n, Vector3(x, 2.25, -0.4), 0.18)
	var span := sets.size() * sp
	cam.position = Vector3(0, 1.25, 0.6 + span * 0.40)
	cam.rotation_degrees = Vector3(-7, 0, 0)


## One terrain layer across a 400 m plane at its real tiling, seen from eye height.
func _build_terrain(layer_name: String, ah: Resource, nr: Resource) -> void:
	var pm := PlaneMesh.new()
	pm.size = Vector2(400, 400)
	pm.subdivide_width = 32
	pm.subdivide_depth = 32
	_add_mesh(pm, _terrain_material(layer_name, ah, nr), Vector3.ZERO)
	cam.position = Vector3(0, 1.7, 0)
	cam.rotation_degrees = Vector3(-22, 0, 0)


## Side-by-side strips (6 m wide, 300 m long) of several layers, from eye height.
func _build_strips(layers: PackedStringArray, ah: Resource, nr: Resource) -> void:
	var w := 6.0
	for i in layers.size():
		var pm := PlaneMesh.new()
		pm.size = Vector2(w, 300)
		pm.subdivide_depth = 32
		var x := (i - (layers.size() - 1) * 0.5) * w
		_add_mesh(pm, _terrain_material(String(layers[i]), ah, nr), Vector3(x, 0, -148))
		_label(String(layers[i]), Vector3(x, 0.4, -3.0), 0.25)
	cam.position = Vector3(0, 1.7, 1.0)
	cam.rotation_degrees = Vector3(-20, 0, 0)


func _process(_d: float) -> void:
	frame += 1
	if frame == 20 and args.has("perf"):
		print("PERF draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			" primitives=", Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			" vram_mb=", snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1))

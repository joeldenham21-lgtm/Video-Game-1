class_name MenuVista
extends Node3D
## Live 3D background for the main menu (scenes/ui/menu_vista.tscn) and backdrop for UI QA shots: the real
## Sky part (scenes/world/sky.tscn) at golden hour over the mountain, with a slowly drifting camera.
##
## The terrain is a light GPU-displaced version of the game world: TerrainData's heightfield (plus its
## mid/far rings and surface masks when the terrain stream provides them), so the menu shows the actual
## Aldous Range. Without terrain data it falls back to a procedural range laid out like DESIGN §3.
## Conifer stands (with golden larches near the treeline) come from the forest mask; lakes from the layout.
## Climate time/weather are borrowed for the menu and restored on exit.

const SHADER := preload("res://src/ui/menus/vista_terrain.gdshader")
const TEX := "res://assets/textures/terrain/"
const FALLBACK_SIZE := 384
const FALLBACK_CELL := 40.0
const MENU_HOURS := 16.55

## Camera drifts slowly when true (menu); false = still frame (screenshots/loading art).
@export var drift := true
## Framing preset: "menu" (wide, summit left of centre), "hud" (lower, over a ridge), "loading".
@export var shot := "menu"

var camera: Camera3D
var sky: Node
var focus := Vector3.ZERO           # summit
var real_terrain := false
var _t := 0.0
var _cam_a := Vector3.ZERO
var _cam_b := Vector3.ZERO
var _saved := {}
var _fallback_img: Image
var _noise: FastNoiseLite
var _noise2: FastNoiseLite


func _ready() -> void:
	_saved = {"hours": Climate.hours, "weather": Climate.weather, "locked": Climate.locked,
		"snow_cover": Climate.snow_cover}
	Climate.locked = true
	Climate.hours = MENU_HOURS
	Climate.snow_cover = 0.35
	Climate.set_weather(&"cloudy" if shot == "menu" else &"clear", 0.0)
	var sky_scene := "res://scenes/world/sky.tscn"
	if ResourceLoader.exists(sky_scene):
		sky = (load(sky_scene) as PackedScene).instantiate()
		sky.name = "Sky"
		add_child(sky)
	camera = get_node_or_null(^"Camera") as Camera3D
	if camera == null:
		camera = Camera3D.new()
		camera.name = "Camera"
		add_child(camera)
	camera.fov = 58.0 if shot != "hud" else 72.0
	camera.near = 0.5
	camera.far = 60000.0
	camera.make_current()
	_build_terrain()
	_frame()
	_update_camera(0.0)
	if sky and sky.has_method("snap"):
		sky.call_deferred("snap")


func _exit_tree() -> void:
	if _saved.is_empty():
		return
	Climate.hours = float(_saved["hours"])
	Climate.locked = bool(_saved["locked"])
	Climate.snow_cover = float(_saved["snow_cover"])
	Climate.set_weather(StringName(_saved["weather"]), 0.0)


func _process(delta: float) -> void:
	if drift:
		_t += delta
		_update_camera(_t)


# ============================================================================================= camera

func _frame() -> void:
	# focus: the summit (layout POI) or the highest ground we know of
	var poi: Dictionary = TerrainData.get_poi(&"summit")
	if not poi.is_empty() and real_terrain:
		focus = poi["position"]
		focus.y = maxf(focus.y, height_at(focus.x, focus.z))
	elif real_terrain:
		focus = Vector3(120.0, TerrainData.max_height, -1260.0)
	else:
		focus = Vector3(120.0, height_at(120.0, -1260.0), -1260.0)
	# look at the summit from the south-south-west, across the valley, so the low western sun rakes the faces
	var dir := Vector3(-0.3, 0.0, 1.0).normalized()
	var dist := 3300.0
	var up := 1180.0
	match shot:
		"hud":
			dir = Vector3(-0.45, 0.0, 1.0).normalized()
			dist = 1900.0
			up = 1150.0
		"loading":
			dir = Vector3(0.2, 0.0, 1.0).normalized()
			dist = 3000.0
			up = 1050.0
	var base := focus + dir * dist
	var side := Vector3(dir.z, 0.0, -dir.x)
	_cam_a = base - side * 170.0
	_cam_b = base + side * 170.0
	_cam_a.y = maxf(focus.y - up, height_at(_cam_a.x, _cam_a.z) + 60.0)
	_cam_b.y = maxf(focus.y - up, height_at(_cam_b.x, _cam_b.z) + 60.0)


func _update_camera(t: float) -> void:
	# slow ping-pong along a short lateral track (≈ 2.5 min per pass), gently rising, always framing the summit
	var s := 0.5 - 0.5 * cos(t * TAU / 300.0)
	var pos := _cam_a.lerp(_cam_b, s)
	pos.y += sin(t * 0.21) * 4.0 + s * 20.0
	camera.global_position = pos
	var target := focus + Vector3(0.0, -150.0, 0.0)
	var fwd := (target - pos).normalized()
	# summit a little left of centre and in the upper third
	var yaw_off := deg_to_rad(9.0 if shot == "menu" else 0.0)
	fwd = fwd.rotated(Vector3.UP, -yaw_off)
	camera.look_at(pos + fwd, Vector3.UP)
	camera.rotate_object_local(Vector3.RIGHT, deg_to_rad(-6.5 if shot != "hud" else -9.0))


# ============================================================================================= terrain

func height_at(x: float, z: float) -> float:
	if real_terrain:
		if TerrainData.has_method("get_height_extended"):
			return float(TerrainData.call("get_height_extended", x, z))
		return TerrainData.get_height(x, z)
	return _fallback_height(x, z)


func _build_terrain() -> void:
	real_terrain = TerrainData.is_loaded() and TerrainData.height_texture != null
	var mask: Texture2D = TerrainData.mask_texture if real_terrain else null
	var mask2: Texture2D = TerrainData.get("mask2_texture") as Texture2D if real_terrain and "mask2_texture" in TerrainData else null
	if real_terrain:
		# far ring (48 m), mid ring (6 m), the world (1.5 m) — each hides the coarser one under it
		var far_tex: Texture2D = TerrainData.get("far_texture") as Texture2D if "far_texture" in TerrainData else null
		var mid_tex: Texture2D = TerrainData.get("mid_texture") as Texture2D if "mid_texture" in TerrainData else null
		if far_tex:
			_add_grid("Far", 49152.0, 320, far_tex, Vector4(-24576.0, -24576.0, 48.0, far_tex.get_width()), 96.0,
				Vector4(0, 0, 3072.0 - 60.0 if mid_tex else 1536.0 - 30.0, 140.0), mask, mask2)
		else:
			_build_fallback()
			_add_grid("Far", 30000.0, 240, ImageTexture.create_from_image(_fallback_img),
				Vector4(-FALLBACK_SIZE * FALLBACK_CELL * 0.5, -FALLBACK_SIZE * FALLBACK_CELL * 0.5, FALLBACK_CELL, FALLBACK_SIZE),
				FALLBACK_CELL, Vector4(0, 0, 1536.0 - 30.0, 200.0), mask, mask2)
		if mid_tex:
			_add_grid("Mid", 6144.0, 384, mid_tex, Vector4(-3072.0, -3072.0, 6.0, mid_tex.get_width()), 16.0,
				Vector4(0, 0, 1536.0 - 24.0, 60.0), mask, mask2)
		_add_grid("World", 3072.0, 448, TerrainData.height_texture, Vector4(-1536.0, -1536.0, TerrainData.CELL, TerrainData.SIZE),
			8.0, Vector4.ZERO, mask, mask2)
	else:
		_build_fallback()
		var half := FALLBACK_SIZE * FALLBACK_CELL * 0.5
		var tex := ImageTexture.create_from_image(_fallback_img)
		_add_grid("Range", FALLBACK_SIZE * FALLBACK_CELL, 400, tex, Vector4(-half, -half, FALLBACK_CELL, FALLBACK_SIZE),
			FALLBACK_CELL, Vector4.ZERO, null, null)
	_add_lakes()
	_scatter_trees()


func _add_grid(nm: String, size_m: float, subdiv: int, tex: Texture2D, hp: Vector4, nstep: float, hole: Vector4,
		mask: Texture2D, mask2: Texture2D) -> void:
	var pm := PlaneMesh.new()
	pm.size = Vector2(size_m, size_m)
	pm.subdivide_width = subdiv
	pm.subdivide_depth = subdiv
	pm.custom_aabb = AABB(Vector3(-size_m * 0.5, 0.0, -size_m * 0.5), Vector3(size_m, 6000.0, size_m))
	var mat := ShaderMaterial.new()
	mat.shader = SHADER
	mat.set_shader_parameter("height_tex", tex)
	mat.set_shader_parameter("hparams", hp)
	mat.set_shader_parameter("normal_step", nstep)
	mat.set_shader_parameter("hole", hole)
	mat.set_shader_parameter("has_masks", mask != null)
	if mask:
		mat.set_shader_parameter("mask_tex", mask)
		mat.set_shader_parameter("mparams", Vector4(-1536.0, -1536.0, 3072.0, 0.0))
	mat.set_shader_parameter("has_mask2", mask2 != null)
	if mask2:
		mat.set_shader_parameter("mask2_tex", mask2)
	for pair in [["rock_albedo", "rock_albedo"], ["rock_normal", "rock_normal"], ["cliff_albedo", "cliff_albedo"],
			["snow_albedo", "snow_albedo"], ["snow_normal", "snow_normal"], ["grass_albedo", "grass_albedo"],
			["forest_albedo", "forest_albedo"], ["scree_albedo", "scree_albedo"], ["ice_albedo", "ice_albedo"]]:
		var path := TEX + String(pair[1]) + ".png"
		if ResourceLoader.exists(path):
			mat.set_shader_parameter(pair[0], load(path))
	var mi := MeshInstance3D.new()
	mi.name = nm
	mi.mesh = pm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if nm != "Far" else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## Procedural stand-in range (only without terrain data): valley in the south, the Corrigan massif north.
func _build_fallback() -> void:
	if _fallback_img:
		return
	_noise = FastNoiseLite.new()
	_noise.seed = 20261024
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 0.00032
	_noise.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_noise.fractal_octaves = 6
	_noise.fractal_lacunarity = 2.05
	_noise.fractal_gain = 0.5
	_noise2 = FastNoiseLite.new()
	_noise2.seed = 77
	_noise2.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise2.frequency = 0.00012
	_noise2.fractal_octaves = 3
	var data := PackedFloat32Array()
	data.resize(FALLBACK_SIZE * FALLBACK_SIZE)
	var half := FALLBACK_SIZE * FALLBACK_CELL * 0.5
	for j in FALLBACK_SIZE:
		var z := -half + j * FALLBACK_CELL
		for i in FALLBACK_SIZE:
			var x := -half + i * FALLBACK_CELL
			data[j * FALLBACK_SIZE + i] = _fallback_formula(x, z)
	_fallback_img = Image.create_from_data(FALLBACK_SIZE, FALLBACK_SIZE, false, Image.FORMAT_RF, data.to_byte_array())


func _fallback_formula(x: float, z: float) -> float:
	var ridge := _noise.get_noise_2d(x, z) * 0.5 + 0.5
	var broad := _noise2.get_noise_2d(x, z) * 0.5 + 0.5
	# valley axis runs east-west through z ≈ +700, opening to the south
	var dv := absf(z - 700.0) + 0.25 * absf(x)
	var valley := smoothstep(350.0, 2600.0, dv)
	var h := 1380.0 + valley * (380.0 + 900.0 * broad + 1350.0 * ridge * ridge * ridge)
	var s := Vector2(x - 120.0, z + 1260.0).length()
	h += 1450.0 * exp(-s * s / (1500.0 * 1500.0)) * (0.62 + 0.38 * ridge)
	var s2 := Vector2(x + 1700.0, z + 1900.0).length()
	h += 700.0 * exp(-s2 * s2 / (1300.0 * 1300.0)) * (0.5 + 0.5 * ridge)
	return h


func _fallback_height(x: float, z: float) -> float:
	_build_fallback()
	var half := FALLBACK_SIZE * FALLBACK_CELL * 0.5
	var tx := clampf((x + half) / FALLBACK_CELL, 0.0, FALLBACK_SIZE - 1.001)
	var tz := clampf((z + half) / FALLBACK_CELL, 0.0, FALLBACK_SIZE - 1.001)
	var i := int(tx)
	var j := int(tz)
	var fx := tx - i
	var fz := tz - j
	var a := _fallback_img.get_pixel(i, j).r
	var b := _fallback_img.get_pixel(i + 1, j).r
	var c := _fallback_img.get_pixel(i, j + 1).r
	var d := _fallback_img.get_pixel(i + 1, j + 1).r
	return lerpf(lerpf(a, b, fx), lerpf(c, d, fx), fz)


func _add_lakes() -> void:
	var lakes: Array = TerrainData.layout.get("lakes", []) if real_terrain else []
	if lakes.is_empty() and not real_terrain:
		lakes = [{"x": 260.0, "z": 640.0, "radius": 230.0, "level": _fallback_height(260.0, 640.0) + 1.5}]
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.03, 0.05, 0.06)
	mat.roughness = 0.04
	mat.metallic = 0.0
	mat.metallic_specular = 0.9
	for l in lakes:
		var r := float(l.get("radius", 100.0))
		var level := float(l.get("level", l.get("y", 1400.0)))
		var mi := MeshInstance3D.new()
		var poly: Variant = l.get("polygon", null)
		if poly is Array and (poly as Array).size() >= 3:
			var pts := PackedVector2Array()
			for p in poly:
				pts.append(Vector2(float(p[0]), float(p[1])))
			var tri := Geometry2D.triangulate_polygon(pts)
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			st.set_normal(Vector3.UP)
			for k in tri:
				st.add_vertex(Vector3(pts[k].x, level, pts[k].y))
			mi.mesh = st.commit()
		else:
			var cm := CylinderMesh.new()
			cm.top_radius = r
			cm.bottom_radius = r
			cm.height = 0.2
			cm.radial_segments = 48
			mi.mesh = cm
			mi.position = Vector3(float(l.get("x", 0.0)), level, float(l.get("z", 0.0)))
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)


# ============================================================================================= trees

func _scatter_trees() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242
	var xf: Array[Transform3D] = []
	var cols: Array[Color] = []
	var step := 14.0
	var ext := 1500.0 if real_terrain else 2600.0
	var cx := 0.0
	var cz := 300.0 if not real_terrain else 0.0
	var budget := 14000 if not Settings.is_mobile() else 6000
	var z := cz - ext
	while z < cz + ext and xf.size() < budget:
		var x := cx - ext
		while x < cx + ext and xf.size() < budget:
			var px := x + rng.randf_range(-0.45, 0.45) * step
			var pz := z + rng.randf_range(-0.45, 0.45) * step
			x += step
			var density := _forest_density(px, pz)
			if density <= 0.0 or rng.randf() > density:
				continue
			var y := height_at(px, pz)
			var s := rng.randf_range(0.75, 1.35) * lerpf(1.0, 0.55, clampf((y - 1900.0) / 350.0, 0.0, 1.0))
			var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.9, 1.15), s))
			xf.append(Transform3D(b, Vector3(px, y - 0.4, pz)))
			var larch := y > 1850.0 and y < 2250.0 and rng.randf() < 0.28
			var c := Color(0.62, 0.42, 0.1) if larch else Color(0.07, 0.1, 0.075).lerp(Color(0.05, 0.075, 0.07), rng.randf())
			if not larch and y > 1750.0 and rng.randf() < 0.5:
				c = c.lerp(Color(0.75, 0.78, 0.82), 0.35)          # snow in the crowns
			cols.append(c)
		z += step
	if xf.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = _conifer_mesh()
	mm.instance_count = xf.size()
	for i in xf.size():
		mm.set_instance_transform(i, xf[i])
		mm.set_instance_color(i, cols[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Trees"
	mmi.multimesh = mm
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.95
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mmi)


func _forest_density(x: float, z: float) -> float:
	if real_terrain:
		if not TerrainData.in_bounds(x, z, 4.0):
			return 0.0
		var m := TerrainData.get_masks(x, z)
		if TerrainData.get_water_level(x, z) > -INF:
			return 0.0
		return clampf(m.a * 1.15, 0.0, 0.95)
	var y := _fallback_height(x, z)
	if y < 1395.0 or y > 2180.0:
		return 0.0
	var e := 12.0
	var sx := _fallback_height(x + e, z) - _fallback_height(x - e, z)
	var sz := _fallback_height(x, z + e) - _fallback_height(x, z - e)
	var slope := Vector2(sx, sz).length() / (2.0 * e)
	if slope > 0.85:
		return 0.0
	var patch := _noise2.get_noise_2d(x * 9.0, z * 9.0) * 0.5 + 0.5
	return clampf((1.0 - smoothstep(1950.0, 2180.0, y)) * smoothstep(0.3, 0.55, patch) * (1.0 - slope), 0.0, 0.9)


## 7-tier spruce silhouette, 9 m tall (instances scale it), ~70 triangles.
func _conifer_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sides := 6
	var tiers := 5
	var h := 9.0
	for t in tiers:
		var y0 := 0.8 + t * (h - 0.8) / tiers * 0.92
		var y1 := y0 + (h - 0.8) / tiers * 1.5
		var r := 1.9 * (1.0 - float(t) / tiers) + 0.25
		for k in sides:
			var a0 := TAU * k / sides
			var a1 := TAU * (k + 1) / sides
			var p0 := Vector3(cos(a0) * r, y0, sin(a0) * r)
			var p1 := Vector3(cos(a1) * r, y0, sin(a1) * r)
			var tip := Vector3(0.0, minf(y1, h), 0.0)
			var n := (p1 - p0).cross(tip - p0).normalized()
			if n.y < 0.0:
				n = -n
			st.set_normal(n)
			st.add_vertex(p0)
			st.add_vertex(tip)
			st.add_vertex(p1)
	# trunk
	for k in 4:
		var a0 := TAU * k / 4.0
		var a1 := TAU * (k + 1) / 4.0
		var p0 := Vector3(cos(a0) * 0.18, 0.0, sin(a0) * 0.18)
		var p1 := Vector3(cos(a1) * 0.18, 0.0, sin(a1) * 0.18)
		st.set_normal(Vector3(cos(a0), 0.0, sin(a0)))
		st.add_vertex(p0)
		st.add_vertex(p1 + Vector3(0, 1.2, 0))
		st.add_vertex(p1)
		st.add_vertex(p0)
		st.add_vertex(p0 + Vector3(0, 1.2, 0))
		st.add_vertex(p1 + Vector3(0, 1.2, 0))
	return st.commit()

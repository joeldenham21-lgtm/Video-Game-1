extends Node3D
## QA lineup of the Blender hero models (tools/blender/props): every world prop scene (scenes/props/*.tscn,
## with its collision) or every item model (assets/models/items/*.glb), in a grid under a daylight rig.
##   DISPLAY=:99 godot --path thin-air --write-movie /tmp/l.png --fixed-fps 30 --quit-after 12 \
##     --resolution 1280x720 res://scenes/props/props_lineup.tscn -- --set=props|items [--only=a,b] [--cols=6]

var _args := {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := String(a).trim_prefix("--").split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var set_name := String(_args.get("set", "props"))
	var only: PackedStringArray = String(_args.get("only", "")).split(",", false)
	var paths: Array[String] = []
	var dir := "res://scenes/props/" if set_name == "props" else "res://assets/models/items/"
	var ext := ".tscn" if set_name == "props" else ".glb"
	for f in DirAccess.get_files_at(dir):
		var fn := String(f).trim_suffix(".remap").trim_suffix(".import")
		if fn.begins_with("props_lineup"):
			continue
		if fn.ends_with(ext) and not paths.has(dir + fn) and (only.is_empty() or only.has(fn.get_basename())):
			paths.append(dir + fn)
	paths.sort()
	var cols := int(_args.get("cols", "6"))
	var cell := 1.4 if set_name == "props" else 0.42
	var rows := int(ceil(float(paths.size()) / float(cols)))
	for i in paths.size():
		var ps := load(paths[i]) as PackedScene
		if ps == null:
			continue
		var n := ps.instantiate() as Node3D
		if n is RigidBody3D:
			(n as RigidBody3D).freeze = true
		n.position = Vector3((i % cols - (cols - 1) * 0.5) * cell, 0.0, (i / cols - (rows - 1) * 0.5) * cell)
		add_child(n)
	_rig(cell * max(cols, rows))


func _rig(extent: float) -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.36, 0.52, 0.78)
	sm.sky_horizon_color = Color(0.72, 0.78, 0.84)
	sm.ground_horizon_color = Color(0.5, 0.5, 0.48)
	sm.ground_bottom_color = Color(0.3, 0.29, 0.27)
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.ssao_enabled = true
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48.0, -35.0, 0.0)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = extent * 3.0
	add_child(sun)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(extent * 4.0, extent * 4.0)
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.36, 0.35, 0.32)
	gm.roughness = 0.95
	pm.material = gm
	ground.mesh = pm
	add_child(ground)
	var cam := Camera3D.new()
	cam.fov = 40.0
	add_child(cam)
	var d := extent * float(_args.get("dist", "0.95"))
	cam.look_at_from_position(Vector3(0.0, d * 0.75, d * 1.05), Vector3(0.0, extent * 0.02, 0.0))
	cam.current = true

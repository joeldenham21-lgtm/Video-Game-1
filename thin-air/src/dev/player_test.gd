class_name PlayerTestCourse
extends Node3D
## Player test course: flat ground, ramps (20/35/45/60°), a 75° rock face, stairs + ledges, a pool with a
## local water volume, ice + deep snow patches, a ladder, pickups, a harvestable stump, a damage dummy, a
## campfire heat source and a scannable wreck. Scripted trials drive the real Player with Input actions.
##
## Visual / manual:  godot --path thin-air res://scenes/dev/player_test.tscn
## Automated trials: godot --headless --path thin-air res://scenes/dev/player_test.tscn -- --auto
## Viewmodel shots:  ... --write-movie /tmp/p.png --fixed-fps 30 --quit-after 40 res://scenes/dev/player_test.tscn -- --shot=stone_axe
## (tests/test_player.gd runs the same trials headless through the test runner.)

const Y0 := 1450.0
const PLAYER_SCENE := "res://scenes/player/player.tscn"

var player: Player = null
var stump: DevStump = null
var target: DevTarget = null
var scannable: DevScannable = null
var campfire: DevFire = null
var pickup: DevPickup = null
var args := {}
var _signals := {}
var _mats := {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	inject_test_items()
	Game.state = Game.State.PLAYING
	Climate.locked = true
	build_course()
	spawn_player()
	if args.has("shot"):
		_setup_shot.call_deferred(StringName(args["shot"]))
	elif args.has("auto"):
		_run_auto.call_deferred()


# =================================================================================================
# Test item definitions (injected only if the real data doesn't define them)
# =================================================================================================

static func inject_test_items() -> void:
	var defs := {
		&"stone_axe": {"name": "Stone Axe", "category": "tool", "stack": 1, "weight": 1.6, "equip_slot": "hand",
			"tool": {"type": "axe", "damage": 9, "chop": 1.0, "mine": 0.2, "range": 1.7, "stamina": 7, "cooldown": 0.9, "durability": 60}},
		&"hatchet": {"name": "Hatchet", "category": "tool", "stack": 1, "weight": 1.1, "equip_slot": "hand",
			"tool": {"type": "axe", "damage": 12, "chop": 1.6, "mine": 0.3, "range": 1.6, "stamina": 6, "cooldown": 0.75, "durability": 160}},
		&"felling_axe": {"name": "Felling Axe", "category": "tool", "stack": 1, "weight": 2.4, "equip_slot": "hand",
			"tool": {"type": "axe", "damage": 18, "chop": 2.6, "mine": 0.3, "range": 1.9, "stamina": 10, "cooldown": 1.15, "durability": 260}},
		&"knife": {"name": "Knife", "category": "tool", "stack": 1, "weight": 0.3, "equip_slot": "hand",
			"tool": {"type": "knife", "damage": 11, "chop": 0.2, "range": 1.3, "stamina": 3, "cooldown": 0.45, "durability": 220}},
		&"spear": {"name": "Spear", "category": "weapon", "stack": 1, "weight": 1.4, "equip_slot": "hand",
			"tool": {"type": "spear", "damage": 22, "range": 2.3, "stamina": 6, "cooldown": 0.8, "durability": 70}},
		&"bow": {"name": "Bow", "category": "weapon", "stack": 1, "weight": 0.9, "equip_slot": "hand",
			"tool": {"type": "bow", "damage": 34, "range": 60, "stamina": 3, "cooldown": 0.5, "durability": 300}},
		&"arrow": {"name": "Arrow", "category": "ammo", "stack": 20, "weight": 0.04},
		&"torch": {"name": "Torch", "category": "light", "stack": 5, "weight": 0.5, "equip_slot": "hand",
			"tool": {"type": "torch", "damage": 4, "range": 1.4, "stamina": 4, "cooldown": 0.7, "durability": 1}, "fuel": {"burn_minutes": 6}},
		&"flare": {"name": "Road Flare", "category": "light", "stack": 5, "weight": 0.2, "equip_slot": "hand",
			"tool": {"type": "flare", "durability": 1}, "fuel": {"burn_minutes": 3}},
		&"ice_axe": {"name": "Ice Axe", "category": "tool", "stack": 1, "weight": 0.6, "equip_slot": "hand", "gear": ["ice_axe"],
			"tool": {"type": "ice_axe", "damage": 14, "mine": 0.6, "range": 1.5, "stamina": 5, "cooldown": 0.8, "durability": 400}},
		&"survey_scanner": {"name": "Survey Scanner", "category": "tool", "stack": 1, "weight": 0.8, "equip_slot": "hand",
			"tool": {"type": "scanner", "range": 6.0}},
		&"canteen": {"name": "Canteen", "category": "drink", "stack": 1, "weight": 0.9, "equip_slot": "hand",
			"tool": {"type": "canteen"}, "food": {"water": 25}},
		&"ration_bar": {"name": "Ration Bar", "category": "food", "stack": 10, "weight": 0.1,
			"food": {"calories": 250, "water": -2}},
		&"meat_cooked": {"name": "Cooked Meat", "category": "food", "stack": 6, "weight": 0.3,
			"food": {"calories": 600, "warmth": 8}},
		&"water_boiled": {"name": "Boiled Water", "category": "drink", "stack": 5, "weight": 0.5,
			"food": {"water": 35, "warmth": 6}},
		&"bandage": {"name": "Bandage", "category": "medical", "stack": 10, "weight": 0.05},
		&"first_aid_kit": {"name": "First Aid Kit", "category": "medical", "stack": 3, "weight": 0.5},
		&"binoculars": {"name": "Binoculars", "category": "tool", "stack": 1, "weight": 0.7, "equip_slot": "hand",
			"tool": {"type": "binoculars"}},
		&"map": {"name": "Map", "category": "tool", "stack": 1, "weight": 0.1, "equip_slot": "hand", "tool": {"type": "map"}},
		&"compass": {"name": "Compass", "category": "tool", "stack": 1, "weight": 0.1, "equip_slot": "hand", "tool": {"type": "map"}},
		&"flare_gun": {"name": "Flare Gun", "category": "weapon", "stack": 1, "weight": 0.6, "equip_slot": "hand",
			"tool": {"type": "flaregun", "damage": 20}},
		&"flare_shell": {"name": "Flare Shell", "category": "ammo", "stack": 10, "weight": 0.05},
		&"lantern": {"name": "Lantern", "category": "light", "stack": 1, "weight": 1.0, "equip_slot": "hand",
			"tool": {"type": "lantern", "durability": 1}, "fuel": {"burn_minutes": 30}},
		&"hammer": {"name": "Hammer", "category": "tool", "stack": 1, "weight": 0.8, "equip_slot": "hand",
			"tool": {"type": "hammer", "damage": 7, "range": 1.5, "stamina": 4, "cooldown": 0.6, "durability": 300}},
		&"crampons": {"name": "Crampons", "category": "clothing", "stack": 1, "weight": 0.9, "equip_slot": "feet", "gear": ["crampons"]},
		&"o2_mask": {"name": "Oxygen Mask", "category": "clothing", "stack": 1, "weight": 0.4, "equip_slot": "face", "gear": ["o2_mask"]},
		&"o2_bottle": {"name": "Oxygen Bottle", "category": "tool", "stack": 1, "weight": 3.0},
		&"parka": {"name": "Parka", "category": "clothing", "stack": 1, "weight": 1.8, "equip_slot": "body",
			"clothing": {"insulation": 12, "windproof": 0.7, "waterproof": 0.6}},
		&"wool_hat": {"name": "Wool Hat", "category": "clothing", "stack": 1, "weight": 0.1, "equip_slot": "head",
			"clothing": {"insulation": 3, "windproof": 0.1, "waterproof": 0.0}},
		&"work_gloves": {"name": "Work Gloves", "category": "clothing", "stack": 1, "weight": 0.2, "equip_slot": "hands",
			"clothing": {"insulation": 2, "windproof": 0.3, "waterproof": 0.2}},
		&"fur_mitts": {"name": "Fur Mitts", "category": "clothing", "stack": 1, "weight": 0.3, "equip_slot": "hands",
			"clothing": {"insulation": 5, "windproof": 0.6, "waterproof": 0.3}},
		&"stick": {"name": "Stick", "category": "resource", "stack": 20, "weight": 0.3},
		&"stone": {"name": "Stone", "category": "resource", "stack": 20, "weight": 1.2},
		&"_test_boulder": {"name": "Test Boulder", "category": "resource", "stack": 1, "weight": 22.0},
	}
	for id in defs:
		if not ItemDB.items.has(id):
			var d: Dictionary = defs[id]
			d["id"] = id
			ItemDB.items[id] = d


# =================================================================================================
# Course construction
# =================================================================================================

func build_course() -> void:
	_build_environment()
	# Ground with a 16×16 m hole for the pool (x −8..8, z 18..34).
	_box("GroundS", Vector3(0, Y0 - 2.0, -41.0), Vector3(200, 4, 118), &"grass")
	_box("GroundN", Vector3(0, Y0 - 2.0, 67.0), Vector3(200, 4, 66), &"grass")
	_box("GroundW", Vector3(-54.0, Y0 - 2.0, 26.0), Vector3(92, 4, 16), &"grass")
	_box("GroundE", Vector3(54.0, Y0 - 2.0, 26.0), Vector3(92, 4, 16), &"grass")
	_box("PoolFloor", Vector3(0, Y0 - 3.5, 26.0), Vector3(16, 1, 16), &"gravel")
	# Entry ramp down into the pool (25°): foot on the pool floor, top edge at the south lip (z = 18).
	var pool_a := deg_to_rad(25.0)
	_ramp("PoolRamp", Vector3(0, Y0 - 3.0, 18.0 + 3.0 / tan(pool_a)), 25.0, 3.0 / sin(pool_a) + 0.3, 3.0, &"dirt", -1.0)
	_water_volume(Vector3(0, Y0 - 1.6, 26.0), Vector3(16, 3.8, 16), Y0 - 0.25)
	# Ramps rising toward −Z.
	var angles := [20.0, 35.0, 45.0, 45.0, 60.0]
	var surfs: Array[StringName] = [&"grass", &"snow", &"snow", &"rock", &"rock"]
	for i in angles.size():
		_ramp("Ramp%d" % i, Vector3(10.0 + i * 6.0, Y0, -6.0), angles[i], 14.0, 4.0, surfs[i], -1.0)
	# Rock face (75°) with a flat top for mantling.
	_rock_face(Vector3(-12.0, Y0, -8.0))
	# Stairs (0.2 m rise) up to a 1.6 m platform, plus test ledges.
	for s in 8:
		_box("Stair%d" % s, Vector3(-24.0, Y0 + (s + 1) * 0.1, -6.0 - s * 0.3), Vector3(2.4, (s + 1) * 0.2, 0.3), &"wood")
	_box("StairTop", Vector3(-24.0, Y0 + 0.8, -9.25), Vector3(2.4, 1.6, 2.0), &"wood")
	_box("Ledge30", Vector3(-30.0, Y0 + 0.15, -8.0), Vector3(2.0, 0.3, 3.0), &"rock")
	_box("Ledge50", Vector3(-34.0, Y0 + 0.25, -8.0), Vector3(2.0, 0.5, 3.0), &"rock")
	# Ice & deep snow lanes.
	_box("Ice", Vector3(40.0, Y0 + 0.02, -18.0), Vector3(8, 0.04, 30), &"ice")
	var snow := _box("DeepSnow", Vector3(52.0, Y0 + 0.02, -18.0), Vector3(8, 0.04, 30), &"snow")
	snow.set_meta(&"snow_depth", 0.9)
	# Ladder against a 4 m platform.
	_box("LadderTower", Vector3(-18.0, Y0 + 2.0, 13.5), Vector3(3, 4, 3), &"wood")
	_ladder(Vector3(-18.0, Y0, 11.8), 4.2)
	# Props.
	stump = DevStump.new()
	stump.position = Vector3(4.0, Y0, 6.0)
	add_child(stump)
	target = DevTarget.new()
	target.position = Vector3(-4.0, Y0, 6.0)
	add_child(target)
	scannable = DevScannable.new()
	scannable.position = Vector3(0.0, Y0, 12.0)
	add_child(scannable)
	campfire = DevFire.new()
	campfire.position = Vector3(-6.0, Y0, -2.0)
	add_child(campfire)
	pickup = DevPickup.new()
	pickup.item_id = &"stick"
	pickup.count = 3
	pickup.position = Vector3(2.0, Y0, 2.5)
	add_child(pickup)
	for i in 3:
		var rb := DevCrate.new()
		rb.position = Vector3(-4.5 + i * 0.8, Y0 + 0.3, -3.0)
		add_child(rb)


func _build_environment() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.32, 0.45, 0.66)
	sm.sky_horizon_color = Color(0.72, 0.76, 0.8)
	sm.ground_horizon_color = Color(0.5, 0.52, 0.52)
	sm.ground_bottom_color = Color(0.24, 0.24, 0.23)
	sm.sun_angle_max = 20.0
	sky.sky_material = sm
	env.sky = sky
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.8
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.ssao_enabled = Settings.is_forward_plus()
	env.glow_enabled = true
	env.glow_intensity = 0.25
	env.fog_enabled = true
	env.fog_light_color = Color(0.72, 0.76, 0.82)
	env.fog_density = 0.0015
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.add_to_group(&"sun")
	sun.rotation_degrees = Vector3(-38.0, 150.0, 0.0)
	sun.light_energy = 1.25
	sun.light_color = Color(1.0, 0.95, 0.88)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 80.0
	add_child(sun)


func _mat(surface: StringName) -> StandardMaterial3D:
	if _mats.has(surface):
		return _mats[surface]
	var m := StandardMaterial3D.new()
	var c := Color(0.4, 0.42, 0.36)
	var r := 0.9
	match surface:
		&"grass": c = Color(0.3, 0.36, 0.22)
		&"snow": c = Color(0.86, 0.88, 0.92); r = 0.75
		&"rock": c = Color(0.38, 0.37, 0.35)
		&"ice": c = Color(0.62, 0.74, 0.82); r = 0.12
		&"wood": c = Color(0.42, 0.3, 0.2)
		&"dirt": c = Color(0.33, 0.27, 0.2)
		&"gravel": c = Color(0.45, 0.43, 0.4)
	m.albedo_color = c
	m.roughness = r
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(0.5, 0.5, 0.5)
	_mats[surface] = m
	return m


func _box(n: String, center: Vector3, size: Vector3, surface: StringName) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = n
	body.collision_layer = 1
	body.set_meta(&"surface", surface)
	body.position = center
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	bm.material = _mat(surface)
	mi.mesh = bm
	body.add_child(mi)
	add_child(body)
	return body


## A slab tilted `angle` degrees, lower edge at `base` (ground level), rising along `dir_z` (−1 = toward −Z).
func _ramp(n: String, base: Vector3, angle: float, length: float, width: float, surface: StringName, dir_z: float) -> StaticBody3D:
	var thick := 0.6
	var a := deg_to_rad(angle)
	var body := StaticBody3D.new()
	body.name = n
	body.set_meta(&"surface", surface)
	var up_dir := Vector3(0.0, sin(a), cos(a) * dir_z)          # along the slope, upward
	var nrm := Vector3(0.0, cos(a), -sin(a) * dir_z)            # slab normal (up-ish)
	var center := base + up_dir * (length * 0.5) - nrm * (thick * 0.5)
	# Basis: X = right, Y = normal, Z = −up_dir (so local −Z runs up the slope).
	var b := Basis(Vector3.RIGHT, nrm, -up_dir).orthonormalized()
	body.transform = Transform3D(b, center)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = Vector3(width, thick, length)
	col.shape = sh
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = sh.size
	bm.material = _mat(surface)
	mi.mesh = bm
	body.add_child(mi)
	add_child(body)
	return body


func _rock_face(base: Vector3) -> void:
	# A 6 m wide block whose +Z face leans back 15° (a 75° face) from the ground line at `base` up to 4.5 m.
	# Its top is a 15° slope (standable) for mantling.
	var h := 4.5
	var t := deg_to_rad(15.0)
	var yr := Vector3(0.0, cos(t), -sin(t))      # up along the face
	var zr := Vector3(0.0, sin(t), cos(t))       # face normal
	var s_top := h / cos(t)
	var s_bot := -1.2 / cos(t)
	var depth := 4.0
	var face_center := base + yr * ((s_top + s_bot) * 0.5)
	var body := StaticBody3D.new()
	body.name = "RockFace"
	body.set_meta(&"surface", &"rock")
	body.transform = Transform3D(Basis(Vector3.RIGHT, yr, zr), face_center - zr * (depth * 0.5))
	var size := Vector3(6.0, s_top - s_bot, depth)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	bm.material = _mat(&"rock")
	mi.mesh = bm
	body.add_child(mi)
	add_child(body)


func _water_volume(center: Vector3, size: Vector3, level: float) -> void:
	var a := Area3D.new()
	a.name = "Water"
	a.collision_layer = 1 << 5
	a.collision_mask = 0
	a.monitoring = false
	a.add_to_group(&"water_volume")
	a.set_meta(&"water_level", level)
	a.position = center
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	a.add_child(col)
	add_child(a)
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(size.x, size.z)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.06, 0.16, 0.18, 0.78)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.04
	m.metallic_specular = 0.9
	pm.material = m
	mi.mesh = pm
	mi.position = Vector3(center.x, level, center.z)
	add_child(mi)


func _ladder(base: Vector3, height: float) -> void:
	var a := Area3D.new()
	a.name = "Ladder"
	a.collision_layer = 1 << 7
	a.collision_mask = 0
	a.monitoring = false
	a.add_to_group(&"ladder")
	a.set_meta(&"surface", &"wood")
	# Faces −Z toward the approaching player? The tower is at +Z, so the ladder's front faces −Z.
	a.position = base + Vector3(0.0, height * 0.5, 0.0)
	a.rotation.y = PI
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.9, height, 0.9)
	col.shape = sh
	a.add_child(col)
	add_child(a)
	var wood := _mat(&"wood")
	for side in [-0.25, 0.25]:
		var rail := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.06, height, 0.08)
		bm.material = wood
		rail.mesh = bm
		rail.position = base + Vector3(side, height * 0.5, 0.2)
		add_child(rail)
	var rung_count := int(height / 0.3)
	for r in rung_count:
		var rung := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.02
		cm.bottom_radius = 0.02
		cm.height = 0.5
		cm.material = wood
		rung.mesh = cm
		rung.rotation.z = PI * 0.5
		rung.position = base + Vector3(0.0, 0.25 + r * 0.3, 0.2)
		add_child(rung)


func spawn_player() -> void:
	player = (load(PLAYER_SCENE) as PackedScene).instantiate() as Player
	add_child(player)
	player.teleport(Vector3(0.0, Y0 + 0.05, 0.0), 0.0)


# =================================================================================================
# Dummies
# =================================================================================================

class DevStump extends StaticBody3D:
	var hits := 0
	var total_power := 0.0
	var last_tool: StringName = &""

	func _init() -> void:
		collision_layer = 1 << 9
		add_to_group(&"harvestable")
		set_meta(&"surface", &"wood")
		var col := CollisionShape3D.new()
		var sh := CylinderShape3D.new()
		sh.radius = 0.35
		sh.height = 0.9
		col.shape = sh
		col.position.y = 0.45
		add_child(col)
		var mi := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.33
		cm.bottom_radius = 0.4
		cm.height = 0.9
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.36, 0.26, 0.18)
		m.roughness = 0.95
		cm.material = m
		mi.mesh = cm
		mi.position.y = 0.45
		add_child(mi)

	func get_harvest_tool_type() -> StringName:
		return &"axe"

	func harvest_hit(tool_id: StringName, power: float, _hit_position: Vector3, _hit_normal: Vector3, _player: Node) -> void:
		hits += 1
		total_power += power
		last_tool = tool_id


class DevTarget extends StaticBody3D:
	var damage_taken := 0.0
	var last_type: StringName = &""

	func _init() -> void:
		collision_layer = 1
		add_to_group(&"damageable")
		set_meta(&"surface", &"wood")
		var col := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(0.6, 1.8, 0.35)
		col.shape = sh
		col.position.y = 0.9
		add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = sh.size
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.6, 0.5, 0.35)
		bm.material = m
		mi.mesh = bm
		mi.position.y = 0.9
		add_child(mi)

	func take_damage(amount: float, type: StringName, _source: Node = null, _hit_position := Vector3.ZERO) -> void:
		damage_taken += amount
		last_type = type


class DevScannable extends StaticBody3D:
	func _init() -> void:
		collision_layer = 1
		add_to_group(&"scannable")
		set_meta(&"surface", &"metal")
		var col := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(1.6, 0.9, 1.0)
		col.shape = sh
		col.position.y = 0.45
		add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = sh.size
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.55, 0.57, 0.6)
		m.metallic = 0.8
		m.roughness = 0.45
		bm.material = m
		mi.mesh = bm
		mi.position.y = 0.45
		add_child(mi)

	func get_scan_id() -> StringName:
		return &"test_wreck"

	func get_scan_unlocks() -> Array:
		return ["test_blueprint"]


class DevFire extends Node3D:
	var heat_radius := 3.0
	var heat_celsius := 25.0
	var lit := true

	func _init() -> void:
		add_to_group(&"heat_source")
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.6, 0.3)
		light.light_energy = 2.0
		light.omni_range = 7.0
		light.position.y = 0.5
		add_child(light)
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.25, 0.17, 0.1)
		for i in 4:
			var log_mi := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.06
			cm.bottom_radius = 0.07
			cm.height = 0.8
			cm.material = m
			log_mi.mesh = cm
			log_mi.rotation = Vector3(deg_to_rad(70.0), i * PI * 0.5, 0.0)
			log_mi.position.y = 0.15
			add_child(log_mi)

	func is_heat_active() -> bool:
		return lit


class DevPickup extends StaticBody3D:
	var item_id: StringName = &"stick"
	var count := 1

	func _init() -> void:
		collision_layer = 1 << 3
		add_to_group(&"interactable")
		var col := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(0.5, 0.15, 0.5)
		col.shape = sh
		col.position.y = 0.075
		add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.5, 0.08, 0.12)
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.45, 0.33, 0.2)
		bm.material = m
		mi.mesh = bm
		mi.position.y = 0.04
		add_child(mi)

	func get_interact_prompt(_player: Node) -> String:
		return "Pick up %s" % String(ItemDB.get_item(item_id).get("name", item_id))

	func interact(p: Node) -> void:
		var pl := p as Player
		if pl == null:
			return
		var left := pl.inventory.add(item_id, count)
		if left < count:
			Events.item_picked_up.emit(item_id, count - left)
			queue_free()


class DevCrate extends RigidBody3D:
	func _init() -> void:
		collision_layer = 1 << 3
		collision_mask = 1 | (1 << 1) | (1 << 3)
		mass = 4.0
		var col := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(0.4, 0.4, 0.4)
		col.shape = sh
		add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = sh.size
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.5, 0.4, 0.28)
		bm.material = m
		mi.mesh = bm
		add_child(mi)


class DevLoosePickup extends RigidBody3D:
	var item_id: StringName = &"stone"
	var count := 1

	func _init() -> void:
		collision_layer = 1 << 3
		collision_mask = 1
		freeze = true
		var col := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(0.24, 0.2, 0.26)
		col.shape = sh
		add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = sh.size
		mi.mesh = bm
		add_child(mi)


# =================================================================================================
# Automated trials — shared by `-- --auto` and tests/test_player.gd
# =================================================================================================

var _t: Object = null
var _landed_speed := -1.0
var _prompts: Array[String] = []
var _scans: Array[StringName] = []


func _run_auto() -> void:
	var r := AutoChecker.new()
	await run_trials(r)
	print("RESULT %s (%d passed, %d failed) player_test --auto" % ["FAIL" if r.failures else "PASS", r.passes, r.failures])
	get_tree().quit(1 if r.failures else 0)


class AutoChecker extends RefCounted:
	var passes := 0
	var failures := 0

	func check(cond: bool, msg: String) -> void:
		if cond:
			passes += 1
			print("PASS ", msg)
		else:
			failures += 1
			print("FAIL ", msg)


func _check(cond: bool, msg: String) -> void:
	_t.call(&"check", cond, msg)


func _release_all() -> void:
	for a in [&"move_forward", &"move_back", &"move_left", &"move_right", &"sprint", &"jump", &"crouch",
			&"use", &"aim", &"interact", &"walk"]:
		if InputMap.has_action(a):
			Input.action_release(a)


## Waits `seconds` of *simulated* time (physics ticks), so measurements don't depend on machine load.
func _wait(seconds: float) -> void:
	var n := maxi(int(roundf(seconds * float(Engine.physics_ticks_per_second))), 1)
	for i in n:
		await get_tree().physics_frame


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _tap(action: StringName) -> void:
	Input.action_press(action)
	await _frames(2)
	Input.action_release(action)
	await _frames(1)


func _reset(pos: Vector3, yaw := 0.0, pitch := 0.0) -> void:
	_release_all()
	if player.is_dead():
		player.respawn(pos, yaw)
	player.teleport(pos, yaw)
	player.set_look(yaw, pitch)
	if player.is_crouching:
		player.call(&"_set_crouch", false)
	player.vitals.reset()
	player.vitals.auto_simulate = false
	player.speed_cap = INF
	await _frames(20)


func _measure_speed(seconds: float) -> float:
	var p0 := player.global_position
	await _wait(seconds)
	var p1 := player.global_position
	return Vector2(p1.x - p0.x, p1.z - p0.z).length() / seconds


func run_trials(t: Object) -> void:
	_t = t
	Events.player_landed.connect(func(s: float, _surf: StringName) -> void: _landed_speed = s)
	Events.interaction_prompt.connect(func(text: String, _h: float) -> void: _prompts.append(text))
	Events.scan_completed.connect(func(id: StringName) -> void: _scans.append(id))
	await _trial_speeds()
	await _trial_surfaces()
	await _trial_slopes()
	await _trial_steps()
	await _trial_falls()
	await _trial_swim()
	await _trial_climb()
	await _trial_ladder()
	await _trial_interact()
	await _trial_tools()
	_release_all()


func _trial_speeds() -> void:
	await _reset(Vector3(0, Y0 + 0.05, -2.0), 0.0)
	Input.action_press(&"move_forward")
	await _wait(1.2)
	var jog := await _measure_speed(0.8)
	_check(jog > 3.0 and jog < 3.4, "jog speed ≈ 3.2 m/s (%.2f)" % jog)
	Input.action_press(&"sprint")
	await _wait(1.2)
	var sprint := await _measure_speed(0.8)
	_check(sprint > 4.9 and sprint < 5.45, "sprint speed ≈ 5.2 m/s (%.2f)" % sprint)
	_check(player.is_sprinting, "is_sprinting while sprinting")
	_check(player.vitals.stamina < 90.0, "sprinting drains stamina (%.1f)" % player.vitals.stamina)
	Input.action_release(&"sprint")
	await _tap(&"crouch")
	_check(player.is_crouching, "crouch toggles on")
	await _wait(0.8)
	var crouch := await _measure_speed(0.8)
	_check(crouch > 0.85 and crouch < 1.1, "crouch speed ≈ 1.0 m/s (%.2f)" % crouch)
	await _tap(&"crouch")
	_check(not player.is_crouching, "crouch toggles off")
	await _tap(&"walk")
	await _wait(0.8)
	var walk := await _measure_speed(0.8)
	_check(walk > 1.25 and walk < 1.55, "walk speed ≈ 1.4 m/s (%.2f)" % walk)
	await _tap(&"walk")
	# Analog half-tilt walks too.
	Input.action_press(&"move_forward", 0.4)
	await _wait(0.8)
	var analog := await _measure_speed(0.6)
	_check(analog > 0.4 and analog < 1.5, "analog half tilt walks (%.2f)" % analog)
	Input.action_press(&"move_forward", 1.0)
	await _wait(1.0)
	Input.action_release(&"move_forward")
	await _wait(0.12)
	var v_after := Vector2(player.velocity.x, player.velocity.z).length()
	_check(v_after > 0.5, "inertia: still moving shortly after release (%.2f)" % v_after)
	await _wait(0.5)
	v_after = Vector2(player.velocity.x, player.velocity.z).length()
	_check(v_after < 0.05, "stops on grass within ~0.5 s (%.2f)" % v_after)
	# Jump height ≈ 0.45 m.
	await _reset(Vector3(0, Y0 + 0.05, -2.0), 0.0)
	var y0 := player.global_position.y
	var peak := y0
	Input.action_press(&"jump")
	for i in 50:
		await get_tree().physics_frame
		peak = maxf(peak, player.global_position.y)
	Input.action_release(&"jump")
	_check(peak - y0 > 0.38 and peak - y0 < 0.52, "jump height ≈ 0.45 m (%.2f)" % (peak - y0))
	# Carry weight slows.
	await _reset(Vector3(0, Y0 + 0.05, -2.0), 0.0)
	player.inventory.add(&"_test_boulder", 2)
	Input.action_press(&"move_forward")
	await _wait(1.0)
	var heavy := await _measure_speed(0.8)
	_check(heavy < 2.8 and heavy > 1.0, "over max weight slows (%.2f)" % heavy)
	player.inventory.remove(&"_test_boulder", 2)
	_release_all()


func _trial_surfaces() -> void:
	# Ice: long stopping distance; deep snow: slow.
	await _reset(Vector3(40.0, Y0 + 0.1, -4.0), 0.0)
	Input.action_press(&"move_forward")
	await _wait(3.5)
	_check(player.current_surface == &"ice", "standing on ice (%s)" % player.current_surface)
	Input.action_release(&"move_forward")
	var p0 := player.global_position
	await _wait(2.5)
	var slide_dist := Vector2(player.global_position.x - p0.x, player.global_position.z - p0.z).length()
	_check(slide_dist > 1.5, "ice without crampons is slippery (stop dist %.2f m)" % slide_dist)
	await _reset(Vector3(52.0, Y0 + 0.1, -4.0), 0.0)
	Input.action_press(&"move_forward")
	await _wait(1.2)
	var snow := await _measure_speed(0.8)
	_check(snow < 2.4 and snow > 1.2, "deep snow slows jog (%.2f)" % snow)
	_release_all()


func _trial_slopes() -> void:
	var names := ["20° grass", "35° snow", "45° snow", "45° rock", "60° rock"]
	var expect_climb := [true, true, false, true, false]
	for i in 5:
		await _reset(Vector3(10.0 + i * 6.0, Y0 + 0.05, -4.5), 0.0)
		var y0 := player.global_position.y
		Input.action_press(&"move_forward")
		await _wait(3.0)
		var gained := player.global_position.y - y0
		Input.action_release(&"move_forward")
		if expect_climb[i]:
			_check(gained > 1.0, "%s: walks up (gained %.2f m)" % [names[i], gained])
		else:
			_check(gained < 0.8, "%s: can't walk up / slides (gained %.2f m)" % [names[i], gained])
	# Put the player high on the 45° snow ramp: must slide down.
	await _reset(Vector3(22.0, Y0 + 5.2, -11.2), 0.0)
	await _wait(0.6)
	var slid := player.is_sliding
	await _wait(1.5)
	_check(slid or player.global_position.y < Y0 + 3.0, "45° snow slope slides you down (y %.2f)" % (player.global_position.y - Y0))


func _walk_max_height(seconds: float) -> float:
	var top := player.global_position.y
	Input.action_press(&"move_forward")
	for i in maxi(int(roundf(seconds * float(Engine.physics_ticks_per_second))), 1):
		await get_tree().physics_frame
		top = maxf(top, player.global_position.y)
	Input.action_release(&"move_forward")
	return top - Y0


func _trial_steps() -> void:
	await _reset(Vector3(-24.0, Y0 + 0.05, -4.0), 0.0)
	var h := await _walk_max_height(2.2)
	_check(h > 1.5, "climbs 0.2 m stairs to the 1.6 m landing (max y +%.2f)" % h)
	await _reset(Vector3(-30.0, Y0 + 0.05, -4.0), 0.0)
	h = await _walk_max_height(1.4)
	_check(h > 0.28, "steps up a 0.3 m ledge (max y +%.2f)" % h)
	await _reset(Vector3(-34.0, Y0 + 0.05, -4.0), 0.0)
	h = await _walk_max_height(1.4)
	_check(h < 0.1, "blocked by a 0.5 m ledge (max y +%.2f)" % h)
	# A light loose pickup (a stone) lying in the path doesn't snag or lift the body.
	var stone := DevLoosePickup.new()
	stone.position = Vector3(-40.0, Y0 + 0.1, -7.0)
	add_child(stone)
	await _reset(Vector3(-40.0, Y0 + 0.05, -4.0), 0.0)
	h = await _walk_max_height(1.4)
	_check(h < 0.05 and player.global_position.z < -7.6, "walks over a loose stone pickup (z %.2f, max y +%.2f)" % [player.global_position.z, h])
	stone.queue_free()


func _trial_falls() -> void:
	await _reset(Vector3(0.0, Y0 + 2.0, -20.0), 0.0)
	_landed_speed = -1.0
	await _wait(1.2)
	_check(_landed_speed > 5.5 and _landed_speed < 7.0, "2 m drop lands at ~6.3 m/s (%.2f)" % _landed_speed)
	_check(player.vitals.health > 99.0, "2 m drop: no damage (%.1f)" % player.vitals.health)
	await _reset(Vector3(0.0, Y0 + 5.0, -20.0), 0.0)
	_landed_speed = -1.0
	await _wait(1.6)
	_check(_landed_speed > 9.0 and _landed_speed < 10.6, "5 m drop lands at ~9.9 m/s (%.2f)" % _landed_speed)
	var h := player.vitals.health
	_check(h < 95.0 and h > 60.0, "5 m drop hurts (health %.1f)" % h)
	await _reset(Vector3(0.0, Y0 + 15.0, -20.0), 0.0)
	await _wait(2.4)
	_check(player.is_dead(), "15 m drop is lethal")
	_check(player.vitals.death_cause == &"fall", "death cause = fall (%s)" % player.vitals.death_cause)


func _trial_swim() -> void:
	await _reset(Vector3(0.0, Y0 + 0.05, 16.5), 180.0)
	Input.action_press(&"move_forward")
	await _wait(5.0)
	_check(player.is_swimming, "wades in and starts swimming")
	player.vitals.simulate(0.1)
	_check(player.vitals.has_effect(&"wet"), "swimming makes you wet")
	Input.action_release(&"move_forward")
	await _wait(1.5)
	var eye := player.get_eye_position().y
	_check(eye > Y0 - 0.25 and eye < Y0 + 0.2, "floats with eyes at the surface (eye %.2f vs water %.2f)" % [eye - Y0, -0.25])
	var st0 := player.vitals.stamina
	Input.action_press(&"move_forward")
	await _wait(1.0)
	Input.action_release(&"move_forward")
	_check(player.vitals.stamina < st0, "swimming costs stamina")
	player.vitals.warmth = 100.0
	player.vitals.simulate(10.0)
	_check(player.vitals.warmth < 95.0, "glacial water chills fast (warmth %.1f after 10 s)" % player.vitals.warmth)


func _trial_climb() -> void:
	# No ice axe: jump does not attach.
	player.inventory.remove(&"ice_axe", player.inventory.count(&"ice_axe"))
	await _reset(Vector3(-12.0, Y0 + 0.05, -6.8), 0.0)
	Input.action_press(&"move_forward")
	await _wait(0.6)
	Input.action_release(&"move_forward")
	await _tap(&"jump")
	await _frames(5)
	_check(not player.is_climbing, "no ice axe: can't climb")
	await _wait(1.0)
	player.inventory.add(&"ice_axe", 1)
	await _reset(Vector3(-12.0, Y0 + 0.05, -6.8), 0.0)
	Input.action_press(&"move_forward")
	await _wait(0.6)
	await _tap(&"jump")
	await _frames(3)
	_check(player.is_climbing, "ice axe + jump at a 75° face attaches")
	var y0 := player.global_position.y
	var st0 := player.vitals.stamina
	var topped := false
	for i in 900:
		await get_tree().physics_frame
		if player.move_state == Player.Move.GROUND and player.global_position.y > Y0 + 3.5:
			topped = true
			break
		if not player.is_climbing and player.move_state != Player.Move.MANTLE:
			break
	Input.action_release(&"move_forward")
	_check(player.global_position.y - y0 > 2.0, "climbs up the face (+%.2f m)" % (player.global_position.y - y0))
	_check(player.vitals.stamina < st0, "climbing drains stamina (%.1f)" % player.vitals.stamina)
	_check(topped, "mantles onto the top (y +%.2f)" % (player.global_position.y - Y0))
	# Exhaustion drops you.
	await _reset(Vector3(-12.0, Y0 + 0.05, -6.8), 0.0)
	Input.action_press(&"move_forward")
	await _wait(0.5)
	await _tap(&"jump")
	await _frames(3)
	player.vitals.stamina = 2.0
	await _wait(1.6)
	_check(not player.is_climbing, "stamina 0 → lose grip")
	_release_all()


func _trial_ladder() -> void:
	await _reset(Vector3(-18.0, Y0 + 0.05, 10.3), 180.0, 20.0)
	Input.action_press(&"move_forward")
	var got_on := false
	for i in 420:
		await get_tree().physics_frame
		got_on = got_on or player.is_on_ladder
		if player.global_position.y > Y0 + 3.95 and not player.is_on_ladder:
			break
	await _wait(0.6)
	Input.action_release(&"move_forward")
	_check(got_on, "attaches to the ladder")
	_check(player.global_position.y > Y0 + 3.9, "climbs the ladder onto the tower (y +%.2f)" % (player.global_position.y - Y0))


func _trial_interact() -> void:
	_prompts.clear()
	await _reset(Vector3(2.0, Y0 + 0.05, 4.4), 0.0, -38.0)
	await _wait(0.4)
	var saw := false
	for p in _prompts:
		if p.begins_with("Pick up"):
			saw = true
	_check(saw, "interaction prompt shown for the pickup (%s)" % str(_prompts))
	var before := player.inventory.count(&"stick")
	await _tap(&"interact")
	await _frames(3)
	_check(player.inventory.count(&"stick") == before + 3, "interact picks up 3 sticks")


func _held() -> HeldItem:
	var vm := player.viewmodel as Viewmodel
	return vm.get_current() if vm else null


func _give_and_equip(id: StringName, count := 1) -> void:
	player.inventory.add(id, count)
	player.equip(id)
	await _wait(0.75)


func _trial_tools() -> void:
	# Hotbar: tools picked up land in free slots; number keys select them.
	player.hotbar.fill(&"")
	player.select_hotbar(-1)
	player.inventory.add(&"stone_axe", 1)
	Events.item_picked_up.emit(&"stone_axe", 1)
	await _frames(2)
	_check(player.hotbar.has(&"stone_axe"), "picked-up tool auto-assigned to the hotbar")
	var slot := player.hotbar.find(&"stone_axe")
	await _tap(StringName("hotbar_%d" % (slot + 1)))
	await _wait(0.7)
	_check(player.get_active_item() == &"stone_axe", "hotbar key selects the axe")
	_check(_held() != null and _held().item_id == &"stone_axe", "viewmodel shows the axe")
	# --- Axe on the stump.
	await _reset(Vector3(4.0, Y0 + 0.05, 7.25), 0.0, -38.0)
	var dur0 := float(player.inventory.get_slot(player.inventory.find(&"stone_axe")).get("durability", 1.0))
	Input.action_press(&"use")
	await _wait(1.3)
	Input.action_release(&"use")
	await _wait(0.8)
	_check(stump.hits >= 1, "axe swing harvest_hit()s the stump (%d hits)" % stump.hits)
	_check(stump.hits == 0 or absf(stump.total_power / stump.hits - 1.0) < 0.01, "harvest power = tool chop (%.2f)" % (stump.total_power / maxf(stump.hits, 1)))
	_check(player.vitals.stamina < 100.0, "chopping costs stamina (%.1f)" % player.vitals.stamina)
	var dur1 := float(player.inventory.get_slot(player.inventory.find(&"stone_axe")).get("durability", 1.0))
	_check(dur1 < dur0, "chopping wears the axe (%.3f → %.3f)" % [dur0, dur1])
	# --- Knife on the damage dummy.
	await _give_and_equip(&"knife")
	await _reset(Vector3(-4.0, Y0 + 0.05, 7.0), 0.0, -5.0)
	var dmg0 := target.damage_taken
	Input.action_press(&"use")
	await _wait(0.6)
	Input.action_release(&"use")
	await _wait(0.4)
	_check(target.damage_taken > dmg0, "knife slash damages the dummy (%.1f, %s)" % [target.damage_taken - dmg0, target.last_type])
	# --- Bow: draw, release, arrow flies and sticks.
	await _give_and_equip(&"bow")
	player.inventory.add(&"arrow", 5)
	await _reset(Vector3(-4.0, Y0 + 0.05, 16.0), 0.0, 2.0)
	Input.action_press(&"use")
	await _wait(1.1)
	var bow := _held()
	_check(bow != null and float(bow.get(&"draw")) > 0.95, "holding use draws the bow to full")
	Input.action_release(&"use")
	await _frames(3)
	_check(player.inventory.count(&"arrow") == 4, "loosing consumes an arrow (%d left)" % player.inventory.count(&"arrow"))
	var arrows := _projectiles(PlayerProjectile.Kind.ARROW)
	_check(arrows.size() >= 1, "arrow projectile launched")
	await _wait(1.2)
	var stuck := false
	for a in _projectiles(PlayerProjectile.Kind.ARROW):
		stuck = stuck or a.stuck
	_check(stuck, "arrow hits and sticks (dummy damage %.1f)" % target.damage_taken)
	# --- Spear throw.
	await _give_and_equip(&"spear")
	await _reset(Vector3(8.0, Y0 + 0.05, 10.0), 0.0, 5.0)
	Input.action_press(&"aim")
	await _wait(0.5)
	await _tap(&"use")
	Input.action_release(&"aim")
	await _wait(1.0)
	_check(player.inventory.count(&"spear") == 0, "thrown spear leaves the inventory")
	var spears := _projectiles(PlayerProjectile.Kind.SPEAR)
	_check(spears.size() == 1 and spears[0].stuck, "spear flies and sticks")
	if spears.size() == 1:
		spears[0].interact(player)
		await _frames(2)
		_check(player.inventory.count(&"spear") == 1, "stuck spear can be picked back up")
	# --- Torch: light + heat source + toggle.
	await _give_and_equip(&"torch")
	var torch := _held()
	_check(torch != null and torch.is_in_group(&"heat_source") and torch.call(&"is_heat_active"), "lit torch is an active heat source")
	await _tap(&"torch_toggle")
	_check(torch != null and not torch.call(&"is_heat_active"), "torch_toggle douses it")
	await _tap(&"torch_toggle")
	_check(torch != null and torch.call(&"is_heat_active"), "torch_toggle relights it")
	# --- Flare: strike, then throw.
	await _give_and_equip(&"flare", 2)
	await _tap(&"use")
	await _wait(0.6)
	var fl := _held()
	_check(fl != null and bool(fl.get(&"lit")), "flare ignites")
	await _tap(&"use")
	await _wait(0.8)
	_check(player.inventory.count(&"flare") == 1, "lit flare thrown (1 left)")
	var flares := _projectiles(PlayerProjectile.Kind.FLARE)
	_check(flares.size() >= 1 and flares[0].burn_time > 100.0, "thrown flare keeps burning")
	# --- Scanner.
	await _give_and_equip(&"survey_scanner")
	await _reset(Vector3(0.0, Y0 + 0.05, 9.6), 180.0, -24.0)
	_scans.clear()
	Input.action_press(&"use")
	await _wait(3.2)
	Input.action_release(&"use")
	_check(_scans.has(&"test_wreck"), "holding use scans the wreck (%s)" % str(_scans))
	var bps: Variant = Game.get_flag(&"blueprints", [])
	_check(bps is Array and (bps as Array).has("test_blueprint"), "scan unlocks its blueprint")
	# --- Eating.
	await _give_and_equip(&"ration_bar", 2)
	player.vitals.food = 50.0
	await _tap(&"use")
	await _wait(1.9)
	_check(player.vitals.food > 60.0, "eating a ration bar restores food (%.1f)" % player.vitals.food)
	_check(player.inventory.count(&"ration_bar") == 1, "eating consumes one bar")
	# --- Canteen sips.
	await _give_and_equip(&"canteen")
	player.vitals.water = 40.0
	await _tap(&"use")
	await _wait(1.9)
	var fill := float(player.inventory.get_slot(player.inventory.find(&"canteen")).get("durability", 0.0))
	_check(player.vitals.water > 60.0 and absf(fill - 0.75) < 0.01, "canteen sip: water %.1f, fill %.2f" % [player.vitals.water, fill])
	# --- Binoculars zoom.
	await _give_and_equip(&"binoculars")
	Input.action_press(&"aim")
	await _wait(1.2)
	var zoom_fov := player.camera.fov
	Input.action_release(&"aim")
	_check(zoom_fov < 25.0, "binoculars zoom the view (fov %.1f)" % zoom_fov)
	await _wait(0.8)
	# --- Empty hands shove a crate.
	player.select_hotbar(-1)
	await _wait(0.7)
	var crate: RigidBody3D = null
	for c in get_children():
		if c is DevCrate:
			crate = c
			break
	if crate:
		await _reset(Vector3(crate.global_position.x, Y0 + 0.05, crate.global_position.z + 0.6), 0.0, -55.0)
		await _tap(&"crouch")
		await _wait(0.4)
		var c0 := crate.global_position
		await _tap(&"use")
		await _wait(0.8)
		_check(crate.global_position.distance_to(c0) > 0.05, "hands shove a loose crate (%.2f m)" % crate.global_position.distance_to(c0))


func _projectiles(kind: PlayerProjectile.Kind) -> Array[PlayerProjectile]:
	var out: Array[PlayerProjectile] = []
	for n in get_tree().get_nodes_in_group(&"_dummy_none"):
		n.queue_free()
	for n in find_children("*", "Node3D", true, false):
		var p := n as PlayerProjectile
		if p and p.kind == kind:
			out.append(p)
	return out


# =================================================================================================
# Screenshot setups
# =================================================================================================

func _setup_shot(item: StringName) -> void:
	player.vitals.auto_simulate = false
	var pos := String(args.get("at", "1.5,9.0,20,-8")).split(",")
	player.teleport(Vector3(float(pos[0]), Y0 + 0.05, float(pos[1])), float(pos[2]))
	player.set_look(float(pos[2]), float(pos[3]))
	if args.has("night"):
		_make_night()
	var gloves := StringName(args.get("gloves", "work_gloves"))
	if gloves != &"none" and ItemDB.has_item(gloves):
		player.inventory.add(gloves, 1)
		player.equip(gloves)
	if args.has("body") and ItemDB.has_item(StringName(args["body"])):
		player.inventory.add(StringName(args["body"]), 1)
		player.equip(StringName(args["body"]))
	var items := String(item).split(",")
	var per := int(args.get("per", "26"))
	for i in items.size():
		var id := StringName(items[i])
		if id != &"none" and ItemDB.has_item(id):
			player.inventory.add(id, 1)
			if id == &"bow":
				player.inventory.add(&"arrow", 12)
			if id == &"flare":
				player.inventory.add(&"flare", 1)
			player.equip(id)
		elif id == &"none":
			player.select_hotbar(-1)
		print("SHOT %s frames %d-%d" % [id, i * per, i * per + per - 1])
		var hold := String(args.get("hold", ""))
		if hold != "":
			for f in int(args.get("hold_after", "16")):
				await get_tree().process_frame
			Input.action_press(StringName(hold))
		for f in per:
			await get_tree().process_frame
		if hold != "":
			Input.action_release(StringName(hold))
	if args.has("tap_at"):
		pass


func _make_night() -> void:
	for c in get_children():
		if c is DirectionalLight3D:
			(c as DirectionalLight3D).light_energy = 0.03
			(c as DirectionalLight3D).light_color = Color(0.5, 0.6, 0.9)
		if c is WorldEnvironment:
			var env := (c as WorldEnvironment).environment
			env.ambient_light_energy = 0.04
			env.background_energy_multiplier = 0.03
			env.fog_light_color = Color(0.02, 0.025, 0.04)
			env.tonemap_exposure = 1.0

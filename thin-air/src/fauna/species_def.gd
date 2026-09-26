class_name SpeciesDef
extends Resource
## Static description of one animal species (src/fauna/species/*.tres). Model, coat and clips come from the
## Blender fauna pipeline (tools/blender/fauna): assets/models/fauna/<id>.glb + <id>.json sidecar
## (clip lengths, native gait speeds, events) and assets/textures/fauna/<id>_albedo.png.

@export var id: StringName = &""
@export var display_name := ""
@export var model_path := ""
@export var coat_path := ""
@export var ai_script := "res://src/fauna/animal.gd"
@export_group("Body")
@export var scale_range := Vector2(0.95, 1.05)
@export var mass := 40.0
@export var health := 60.0
@export var body_radius := 0.22           ## collision capsule radius (m)
@export var body_length := 1.2            ## capsule length along the body (m)
@export var body_height := 0.55           ## capsule centre height above the ground (m)
@export var eye_height := 0.8
@export_group("Coat")
@export var fur_length := 0.035           ## shell length at coat alpha 1 (m); 0 = no shells
@export var fur_tint := Color(1, 1, 1)
@export var fur_sheen := 0.5
@export var eye_color := Color(0.42, 0.28, 0.06)
@export var comb := Vector3(0.0, -0.3, 0.95)
@export_group("Locomotion")
@export var walk_speed := 1.15
@export var trot_speed := 2.6
@export var run_speed := 9.0
@export var accel := 6.0
@export var turn_rate := 200.0            ## deg/s at walking pace
@export var max_slope := 38.0
@export var wade_depth := 0.45
@export var gait_clips: PackedStringArray = PackedStringArray(["walk", "trot", "gallop"])
@export_group("Senses")
@export var sight_range := 90.0
@export var fov_deg := 250.0
@export var hearing := 1.0                ## multiplier on a noise's radius
@export var smell_range := 180.0          ## straight downwind, moderate breeze
@export var fire_fear := 1.0
@export var skittish := 0.5               ## how fast alarm builds (0..1)
@export_group("Behaviour")
@export var aggression := 0.5             ## 0 pure prey .. 1 apex predator
@export var flee_distance := 80.0
@export var damage := 14.0
@export var damage_type: StringName = &"bite"
@export var attack_range := 1.7
@export var attack_cooldown := 1.6
@export var attack_clip: StringName = &"attack"
@export_group("Harvest")
@export var loot: Dictionary = {"meat_raw": 3, "hide_raw": 1, "bone": 2}
@export var harvest_hits := 6
@export_group("Sound")
@export var sfx_call: StringName = &""       ## social / territorial call
@export var sfx_alarm: StringName = &""
@export var sfx_hurt: StringName = &""
@export var sfx_attack: StringName = &""
@export var sfx_threat: StringName = &""
@export var sfx_death: StringName = &""
@export_group("Population")
@export var biomes: PackedStringArray = PackedStringArray(["valley", "forest"])
@export var min_alt := 1300.0
@export var max_alt := 2300.0
@export var group_min := 1
@export var group_max := 1
@export var night_weight := 1.0             ## spawn weight multiplier at night
@export var day_weight := 1.0
@export var spawn_weight := 1.0
@export var slope_pref := Vector2(0.0, 30.0)   ## preferred slope range for spawn points (deg)

## Runtime (not saved in the .tres): parsed <model>.json sidecar.
var meta: Dictionary = {}
var _meta_loaded := false


func load_meta() -> Dictionary:
	if _meta_loaded:
		return meta
	_meta_loaded = true
	var jp := model_path.get_basename() + ".json"
	if FileAccess.file_exists(jp):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(jp))
		if d is Dictionary:
			meta = d
	return meta


## Clip info from the sidecar: {length, loop, speed?, events?}.
func clip(name: StringName) -> Dictionary:
	var clips: Dictionary = load_meta().get("clips", {})
	return clips.get(String(name), {})


func clip_speed(name: StringName, fallback: float) -> float:
	return float(clip(name).get("speed", fallback))

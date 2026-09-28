class_name FaunaManager
extends Node3D
## The world's "Fauna" part (scenes/fauna/fauna.tscn). Owns every animal:
##  - species resources (src/fauna/species/*.tres) and pre-instantiated pools (no instancing at runtime);
##  - population: biome / altitude / time-of-day weighted spawning 110–190 m from the player, out of view;
##    ≤ MAX_ACTIVE living animals; despawn beyond DESPAWN m (Old Grey is virtualised, not forgotten);
##  - LOD: full tick ≤ NEAR m, 15 Hz to MID, 4 Hz beyond; animation 60/30/10 Hz, frozen past 160 m; fur shells
##    only close to the camera;
##  - shared perception inputs, refreshed a few times a second: player position/eye/speed/crouch/cover, sight
##    multiplier (Climate light level, fog, snowfall), wind for smell, fire/flare sources (+ torch waving);
##  - hearing: Events.noise_emitted / Events.footstep → Animal.hear();
##  - wolf packs, howl answers at night, blood decals, ambient birds (ravens over carcasses, a soaring eagle);
##  - persistence (group "persistent", key "fauna"): Old Grey alive/position/health, corpses, kill counts.

const MAX_ACTIVE := 12
const MAX_CORPSES := 6
const NEAR := 60.0
const MID := 150.0
const DESPAWN := 250.0
const SPAWN_MIN := 110.0
const SPAWN_MAX := 190.0
const SPECIES_DIR := "res://src/fauna/species/"
const SPECIES := ["wolf", "deer", "bear", "old_grey", "goat", "hare"]
const POOL := {"wolf": 5, "deer": 5, "bear": 1, "old_grey": 1, "goat": 4, "hare": 3}
const BLOOD_POOL := 16

## Dev/test switch: no automatic population (QA scenes place animals themselves).
static var spawning_enabled := true
static var instance: FaunaManager = null

var defs: Dictionary = {}
var pools: Dictionary = {}
var animals: Array[Animal] = []
var packs: Array = []
var kills: Dictionary = {}
var old_grey: Dictionary = {"alive": true, "pos": [], "health": -1.0}
var now := 0.0

var player: Node3D = null
var debug_target: Node3D = null      ## tests: stands in for the player
var player_valid := false
var player_pos := Vector3.ZERO
var player_eye := Vector3.ZERO
var player_speed := 0.0
var player_crouch := false
var player_cover := 1.0
var player_health := 1.0
var player_has_fire := false
var sight_mult := 1.0
var light_level := 1.0
var wind_dir := Vector3(1.0, 0.0, 0.0)
var wind_speed := 3.0
var last_fire_pos := Vector3.ZERO
var fire_wave_t := -100.0

var _fire_pos := PackedVector3Array()
var _fire_rad := PackedFloat32Array()
var _fire_str := PackedFloat32Array()
var _fire_held := PackedByteArray()
var _fire_n := 0
var _refresh_t := 0.0
var _spawn_t := 3.0
var _despawn_t := 0.0
var _frame := 0
var _spawn_counter := 0
var _rng := RandomNumberGenerator.new()
var _blood: Array[Decal] = []
var _blood_i := 0
var _blood_tex: Texture2D = null
var _howl_answer_t := -1.0
var _howl_answer_dir := Vector3.ZERO
var _ambient_howl_t := 120.0
var _pack_cooldown := 60.0
var _prev_cam_yaw := 0.0
var birds: Node3D = null
var _cam: Camera3D = null


func _enter_tree() -> void:
	instance = self


func _exit_tree() -> void:
	if instance == self:
		instance = null


func _ready() -> void:
	add_to_group(&"persistent")
	_rng.seed = 7331
	for sp in SPECIES:
		var path: String = SPECIES_DIR + sp + ".tres"
		if not ResourceLoader.exists(path):
			continue
		var d := load(path) as SpeciesDef
		if d == null or not ResourceLoader.exists(d.model_path):
			continue
		defs[d.id] = d
		var arr: Array[Animal] = []
		for i in int(POOL.get(sp, 2)):
			arr.append(_make(d))
		pools[d.id] = arr
	_fire_pos.resize(24)
	_fire_rad.resize(24)
	_fire_str.resize(24)
	_fire_held.resize(24)
	_build_blood()
	var bs: GDScript = load("res://src/fauna/fauna_birds.gd")
	birds = bs.new()
	birds.name = "Birds"
	add_child(birds)
	Events.noise_emitted.connect(_on_noise)
	Events.footstep.connect(_on_footstep)


func _make(d: SpeciesDef) -> Animal:
	var scr: GDScript = load(d.ai_script) if ResourceLoader.exists(d.ai_script) else load("res://src/fauna/animal.gd")
	var a: Animal = scr.new()
	add_child(a)
	a.setup(d, self)
	return a


# ================================================================================================ public API
## Takes an animal from the pool (or instantiates one if the pool is empty) and activates it.
func spawn_animal(species: StringName, pos: Vector3, yaw := 0.0, seed_value := -1) -> Animal:
	if not defs.has(species):
		return null
	var arr: Array[Animal] = pools[species]
	var a: Animal = arr.pop_back() if not arr.is_empty() else _make(defs[species])
	_spawn_counter += 1
	a.activate(pos, yaw, seed_value if seed_value >= 0 else hash(Vector3i(int(pos.x), int(pos.z), _spawn_counter)))
	animals.append(a)
	return a


func release(a: Animal) -> void:
	if a.pack and a.pack.has_method(&"remove_member"):
		a.pack.call(&"remove_member", a)
	a.deactivate()
	animals.erase(a)
	(pools[a.def.id] as Array).append(a)


func release_all() -> void:
	for i in range(animals.size() - 1, -1, -1):
		release(animals[i])
	packs.clear()


## Creates a wolf pack of the given size around pos.
func spawn_pack(pos: Vector3, count: int) -> RefCounted:
	var P: GDScript = load("res://src/fauna/wolf_pack.gd")
	var pack: RefCounted = P.new()
	for i in count:
		var a2 := _rng.randf() * TAU
		var p := pos + Vector3(sin(a2), 0.0, cos(a2)) * _rng.randf_range(1.5, 6.0)
		var w := spawn_animal(&"wolf", p, _rng.randf() * TAU)
		if w:
			pack.call(&"add_member", w)
	packs.append(pack)
	return pack


func count_alive(species: StringName = &"") -> int:
	var n := 0
	for a in animals:
		if not a.dead and (species == &"" or a.def.id == species):
			n += 1
	return n


func count_corpses() -> int:
	var n := 0
	for a in animals:
		if a.dead:
			n += 1
	return n


func corpses() -> Array[Animal]:
	var out: Array[Animal] = []
	for a in animals:
		if a.dead and not a.butchered:
			out.append(a)
	return out


## 0..1 threat from fires, torches and flares at pos (updates last_fire_pos).
func fire_threat_at(pos: Vector3) -> float:
	var best := 0.0
	var waving := now - fire_wave_t < 1.5
	for i in _fire_n:
		var fp := _fire_pos[i]
		var r := _fire_rad[i]
		var s := _fire_str[i]
		if _fire_held[i] == 1 and waving:
			r *= 1.5
			s *= 1.35
		var d := pos.distance_to(fp)
		if d < r:
			var t := s * (1.0 - d / r)
			if t > best:
				best = t
				last_fire_pos = fp
	return best


## Line of sight over the terrain (8 samples, no physics).
func terrain_los(a: Vector3, b: Vector3) -> bool:
	for i in range(1, 8):
		var t := float(i) / 8.0
		var p := a.lerp(b, t)
		if TerrainData.get_height(p.x, p.z) > p.y - 0.25:
			return false
	return true


func spawn_blood(pos: Vector3, size := 1.0) -> void:
	if _blood.is_empty():
		return
	var d := _blood[_blood_i]
	_blood_i = (_blood_i + 1) % _blood.size()
	var gy := TerrainData.get_height(pos.x, pos.z)
	d.global_position = Vector3(pos.x + _rng.randf_range(-0.2, 0.2), gy, pos.z + _rng.randf_range(-0.2, 0.2))
	d.rotation = Vector3(0.0, _rng.randf() * TAU, 0.0)
	var s := _rng.randf_range(0.35, 0.6) * size
	d.size = Vector3(s, 0.8, s)
	d.visible = true


func on_animal_killed(a: Animal) -> void:
	var k := String(a.def.id)
	kills[k] = int(kills.get(k, 0)) + 1
	if a.persistent_id == "old_grey":
		old_grey["alive"] = false
	if a.pack and a.pack.has_method(&"on_member_died"):
		a.pack.call(&"on_member_died", a)


func on_butchered(a: Animal) -> void:
	a.set_meta(&"butchered_at", a.corpse_age)


func on_vocal(a: Animal, id: StringName) -> void:
	if id == &"wolf_howl" and Climate.is_night() and _howl_answer_t < 0.0 and _rng.randf() < 0.75:
		var ang := _rng.randf() * TAU
		_howl_answer_dir = Vector3(sin(ang), 0.0, cos(ang))
		_howl_answer_t = now + _rng.randf_range(4.0, 11.0)
	if a and a.def.id == &"wolf" and a.pack and id == &"wolf_howl":
		a.pack.call(&"on_howl", a)


func kill_count(species: StringName) -> int:
	return int(kills.get(String(species), 0))


# ================================================================================================ frame
func _physics_process(delta: float) -> void:
	now += delta
	_frame += 1
	_update_player(delta)
	_refresh_t -= delta
	if _refresh_t <= 0.0:
		_refresh_t = 0.3
		_refresh_env()
	if spawning_enabled:
		_spawn_t -= delta
		if _spawn_t <= 0.0:
			_spawn_t = 2.5
			_population()
		_ambient_howls(delta)
	for pk in packs:
		pk.call(&"update", delta, self)
	var cam := _camera_pos()
	var n := animals.size()
	for i in n:
		var a := animals[i]
		var d := a.global_position.distance_to(cam)
		var tier := 0 if d < NEAR else (1 if d < MID else 2)
		if tier != a.lod or (_frame + i) % 20 == 0:
			a.set_lod(tier, d)
		var interval := 1 if tier == 0 else (4 if tier == 1 else 15)
		a.tick_acc += delta
		if (_frame + i) % interval == 0:
			a.tick(a.tick_acc)
			a.tick_acc = 0.0
		var ai := 1 if d < 40.0 else (2 if d < 90.0 else (6 if d < 160.0 else 0))
		a.anim_acc += delta
		if ai > 0 and (_frame + i) % ai == 0:
			a.advance_anim(a.anim_acc)
			a.anim_acc = 0.0
	_despawn_t -= delta
	if _despawn_t <= 0.0:
		_despawn_t = 1.0
		_despawn()
	if _howl_answer_t > 0.0 and now >= _howl_answer_t:
		_howl_answer_t = -1.0
		var lp := player_pos if player_valid else cam
		Audio.play_sfx(&"wolf_howl", lp + _howl_answer_dir * _rng.randf_range(650.0, 950.0) + Vector3.UP * 60.0,
			-3.0, _rng.randf_range(0.9, 1.05))


func _camera_pos() -> Vector3:
	if _cam == null or not is_instance_valid(_cam) or not _cam.is_inside_tree() or not _cam.current:
		_cam = get_viewport().get_camera_3d() if get_viewport() else null
	if _cam:
		return _cam.global_position
	return player_pos


func _update_player(_delta: float) -> void:
	var p: Node3D = debug_target if debug_target and is_instance_valid(debug_target) else Game.player
	player = p
	player_valid = p != null and is_instance_valid(p) and p.is_inside_tree()
	if p and p.has_method(&"is_dead") and bool(p.call(&"is_dead")):
		player_valid = false
	if not player_valid:
		return
	player_pos = p.global_position
	player_eye = p.call(&"get_eye_position") if p.has_method(&"get_eye_position") else player_pos + Vector3(0.0, 1.6, 0.0)
	if p is CharacterBody3D:
		var v := (p as CharacterBody3D).velocity
		player_speed = sqrt(v.x * v.x + v.z * v.z)
	var c = p.get(&"is_crouching")
	player_crouch = bool(c) if c != null else false
	# torch / flare waving: swinging it or sweeping the view fast
	if player_has_fire:
		var cam := _cam
		if cam:
			var y := cam.global_rotation.y
			var rate := absf(wrapf(y - _prev_cam_yaw, -PI, PI)) / maxf(get_physics_process_delta_time(), 1e-4)
			_prev_cam_yaw = y
			if rate > 2.6:
				fire_wave_t = now
		if Input.is_action_just_pressed(&"use"):
			fire_wave_t = now


func _refresh_env() -> void:
	light_level = Climate.get_light_level()
	var fog := clampf(Climate.fog_density, 0.0, 1.0)
	var snow := clampf(Climate.precipitation, 0.0, 1.0)
	sight_mult = lerpf(0.28, 1.0, light_level) * (1.0 - 0.6 * fog) * (1.0 - 0.45 * snow)
	if Climate.weather == &"blizzard":
		sight_mult *= 0.45
	wind_dir = Climate.wind_direction
	wind_speed = Climate.get_wind_at(player_pos).length() if player_valid else Climate.wind_speed
	if player_valid:
		var forest := TerrainData.get_masks(player_pos.x, player_pos.z).a
		player_cover = 1.0 - 0.35 * forest
		var v = player.get(&"vitals")
		if v != null:
			player_health = clampf(float(v.get(&"health")) / maxf(float(v.get(&"max_health")), 1.0), 0.0, 1.0)
	# fires, torches, flares
	_fire_n = 0
	player_has_fire = false
	for n in get_tree().get_nodes_in_group(&"heat_source"):
		_add_fire(n)
	for n in get_tree().get_nodes_in_group(&"fire"):
		if not n.is_in_group(&"heat_source"):
			_add_fire(n)
	if player_has_fire and light_level < 0.5:
		player_cover *= 1.6       # a torch at night is visible from far away


func _add_fire(n: Node) -> void:
	if _fire_n >= _fire_pos.size() or not (n is Node3D) or not n.is_inside_tree():
		return
	if n.has_method(&"is_heat_active") and not bool(n.call(&"is_heat_active")):
		return
	var flare := n.is_in_group(&"flare")
	var held := player != null and is_instance_valid(player) and player.is_ancestor_of(n)
	var hr = n.get(&"heat_radius")
	var r := 16.0 if flare else (9.0 if held else maxf(float(hr) * 4.0 if hr != null else 8.0, 8.0))
	var s := 1.0 if flare else (0.75 if held else 0.85)
	_fire_pos[_fire_n] = (n as Node3D).global_position
	_fire_rad[_fire_n] = r
	_fire_str[_fire_n] = s
	_fire_held[_fire_n] = 1 if held else 0
	_fire_n += 1
	if held:
		player_has_fire = true


func _on_noise(pos: Vector3, radius: float, _source: Node) -> void:
	var loud := 1.5 if radius >= 60.0 else 1.0
	for a in animals:
		if not a.dead:
			a.hear(pos, radius, loud)


func _on_footstep(surface: StringName, pos: Vector3, intensity: float) -> void:
	var k := 0.7 if surface == &"snow" else (1.2 if surface == &"scree" or surface == &"gravel" or surface == &"wood" else 1.0)
	var r := lerpf(3.0, 26.0, clampf(intensity, 0.0, 1.0)) * k
	for a in animals:
		if not a.dead and a.dist_to_player < r * 2.5:
			a.hear(pos, r, 0.35)


# ================================================================================================ population
func _population() -> void:
	if not player_valid or not TerrainData.is_loaded():
		return
	var alive := count_alive()
	if alive >= MAX_ACTIVE:
		return
	_pack_cooldown -= 2.5
	var day := Climate.get_daylight()
	# Old Grey lives near Ashford Mine
	if bool(old_grey.get("alive", true)) and not _has_persistent("old_grey"):
		var mine := TerrainData.get_poi(&"ashford_mine")
		if not mine.is_empty():
			var mp: Vector3 = mine["position"]
			if Vector2(mp.x - player_pos.x, mp.z - player_pos.z).length() < 420.0:
				var at := _saved_old_grey_pos(mp)
				if at == Vector3.INF:
					at = _find_spawn(defs.get(&"old_grey"), mp, 40.0, 170.0)
				if at != Vector3.INF and at.distance_to(player_pos) > 90.0:
					_spawn_old_grey(at)
					return
	var biome := TerrainData.get_biome(player_pos.x, player_pos.z)
	var total := 0.0
	var weights := PackedFloat32Array()
	var ids: Array[StringName] = []
	for id in defs:
		var d: SpeciesDef = defs[id]
		var w := d.spawn_weight * lerpf(d.night_weight, d.day_weight, day)
		if not d.biomes.has(String(biome)) and not (biome == &"glacier" and d.biomes.has("alpine")):
			w *= 0.15
		if id == &"wolf" and (not packs.is_empty() or _pack_cooldown > 0.0):
			w = 0.0
		if id == &"bear" and count_alive(&"bear") >= 1:
			w = 0.0
		if count_alive(id) >= d.group_max * (1 if id == &"wolf" or id == &"bear" else 2):
			w = 0.0
		if w > 0.0:
			weights.append(w)
			ids.append(id)
			total += w
	if total <= 0.0 or _rng.randf() > 0.3:
		return
	var r := _rng.randf() * total
	var pick: StringName = ids[0]
	for i in ids.size():
		r -= weights[i]
		if r <= 0.0:
			pick = ids[i]
			break
	var def: SpeciesDef = defs[pick]
	var at := _find_spawn(def, player_pos, SPAWN_MIN, SPAWN_MAX)
	if at == Vector3.INF:
		return
	var n := _rng.randi_range(def.group_min, def.group_max)
	n = mini(n, MAX_ACTIVE - alive)
	if pick == &"wolf":
		if n >= 2:
			spawn_pack(at, n)
			_pack_cooldown = 240.0
		return
	for i in n:
		var a2 := _rng.randf() * TAU
		var p := at + Vector3(sin(a2), 0.0, cos(a2)) * (0.0 if i == 0 else _rng.randf_range(3.0, 9.0))
		spawn_animal(pick, p, _rng.randf() * TAU)


func _find_spawn(def: SpeciesDef, center: Vector3, rmin: float, rmax: float) -> Vector3:
	if def == null:
		return Vector3.INF
	var cam := _cam
	# a camera with a broken (non-finite) transform can't say what is in view: skip the in-view test rather
	# than normalize NaNs 12 times a spawn tick
	if cam and (not is_instance_valid(cam) or not cam.is_inside_tree() or not cam.global_transform.is_finite()):
		cam = null
	for i in 12:
		var a := _rng.randf() * TAU
		var r := _rng.randf_range(rmin, rmax)
		var x := center.x + sin(a) * r
		var z := center.z + cos(a) * r
		if not TerrainData.in_bounds(x, z, 40.0):
			continue
		var y := TerrainData.get_height(x, z)
		if y < def.min_alt or y > def.max_alt:
			continue
		var sl := TerrainData.get_slope_deg(x, z)
		if sl < def.slope_pref.x or sl > def.slope_pref.y:
			continue
		var wl := TerrainData.get_water_level(x, z)
		if wl > -1e20 and wl > y - 0.1:
			continue
		var p := Vector3(x, y, z)
		if player_valid and p.distance_to(player_pos) < rmin * 0.8:
			continue
		if cam and is_instance_valid(cam):
			var to := p + Vector3.UP - cam.global_position
			if (-cam.global_basis.z).dot(to.normalized()) > 0.3 and terrain_los(cam.global_position, p + Vector3.UP):
				continue
		if fire_threat_at(p) > 0.0:
			continue
		return p
	return Vector3.INF


func _despawn() -> void:
	var ref := player_pos if player_valid else _camera_pos()
	var corpses_n := 0
	for i in range(animals.size() - 1, -1, -1):
		var a := animals[i]
		var d := a.global_position.distance_to(ref)
		if a.persistent_id == "old_grey" and not a.dead:
			old_grey["pos"] = SaveUtil.v3(a.global_position)
			old_grey["health"] = a.health
		if a.dead:
			corpses_n += 1
			var bt = a.get_meta(&"butchered_at", -1.0)
			if (a.butchered and a.corpse_age - float(bt) > 1.5) or (d > DESPAWN * 1.2 and a.corpse_age > 60.0) \
					or corpses_n > MAX_CORPSES:
				release(a)
			continue
		if spawning_enabled and d > DESPAWN:
			release(a)
	for i in range(packs.size() - 1, -1, -1):
		if int(packs[i].call(&"size")) == 0:
			packs.remove_at(i)


func _has_persistent(pid: String) -> bool:
	for a in animals:
		if a.persistent_id == pid and not a.dead:
			return true
	return false


func _saved_old_grey_pos(mine: Vector3) -> Vector3:
	var p: Array = old_grey.get("pos", [])
	if p.size() == 3:
		var v := SaveUtil.to_v3(p)
		if v.distance_to(player_pos) > 90.0 and v.distance_to(mine) < 400.0:
			return v
	return Vector3.INF


func _spawn_old_grey(at: Vector3) -> Animal:
	var a := spawn_animal(&"old_grey", at, _rng.randf() * TAU, 4242)
	if a and a.has_method(&"make_old_grey"):
		a.call(&"make_old_grey", float(old_grey.get("health", -1.0)))
	return a


func _ambient_howls(delta: float) -> void:
	if not player_valid or not Climate.is_night():
		return
	_ambient_howl_t -= delta
	if _ambient_howl_t > 0.0:
		return
	_ambient_howl_t = _rng.randf_range(90.0, 260.0)
	var b := TerrainData.get_biome(player_pos.x, player_pos.z)
	if b == &"summit" or b == &"glacier":
		return
	var ang := _rng.randf() * TAU
	var dir := Vector3(sin(ang), 0.0, cos(ang))
	Audio.play_sfx(&"wolf_howl", player_pos + dir * _rng.randf_range(600.0, 900.0) + Vector3.UP * 60.0, -4.0,
		_rng.randf_range(0.92, 1.05))
	if _rng.randf() < 0.6:
		_howl_answer_dir = dir.rotated(Vector3.UP, _rng.randf_range(1.2, 2.6))
		_howl_answer_t = now + _rng.randf_range(5.0, 12.0)


# ================================================================================================ blood
func _build_blood() -> void:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	var r := RandomNumberGenerator.new()
	r.seed = 99
	var blobs: Array[Vector3] = []
	for i in 9:
		blobs.append(Vector3(r.randf_range(14, 50), r.randf_range(14, 50), r.randf_range(3, 11) * (1.6 if i == 0 else 1.0)))
	for y in 64:
		for x in 64:
			var v := 0.0
			for b in blobs:
				var dd := Vector2(x - b.x, y - b.y).length()
				v = maxf(v, 1.0 - dd / b.z)
			var a := clampf(v * 3.0, 0.0, 1.0)
			img.set_pixel(x, y, Color(0.28, 0.02, 0.02, a))
	img.generate_mipmaps()
	_blood_tex = ImageTexture.create_from_image(img)
	for i in BLOOD_POOL:
		var d := Decal.new()
		d.texture_albedo = _blood_tex
		d.albedo_mix = 0.92
		d.modulate = Color(0.55, 0.05, 0.04)
		d.cull_mask = 1
		d.visible = false
		d.upper_fade = 0.2
		d.lower_fade = 0.2
		d.distance_fade_enabled = true
		d.distance_fade_begin = 40.0
		d.distance_fade_length = 10.0
		add_child(d)
		_blood.append(d)


# ================================================================================================ persistence
func get_save_key() -> String:
	return "fauna"


func save_state() -> Dictionary:
	var cs: Array = []
	for a in animals:
		if a.dead and not a.butchered:
			cs.append(a.save_corpse())
		elif a.persistent_id == "old_grey":
			old_grey["pos"] = SaveUtil.v3(a.global_position)
			old_grey["health"] = a.health
	return {"version": 1, "kills": kills.duplicate(), "old_grey": old_grey.duplicate(true), "corpses": cs}


func load_state(d: Dictionary) -> void:
	release_all()
	kills = (d.get("kills", {}) as Dictionary).duplicate()
	var og: Dictionary = d.get("old_grey", {})
	old_grey = {"alive": bool(og.get("alive", true)), "pos": og.get("pos", []), "health": float(og.get("health", -1.0))}
	for c in d.get("corpses", []):
		var cd := c as Dictionary
		var sp := StringName(String(cd.get("species", "")))
		if not defs.has(sp):
			continue
		var a := spawn_animal(sp, SaveUtil.to_v3(cd.get("pos", [0, 0, 0])), float(cd.get("yaw", 0.0)))
		if a:
			a.persistent_id = String(cd.get("id", ""))
			a.make_corpse(int(cd.get("harvested", 0)))
			a.corpse_age = maxf(a.corpse_age, float(cd.get("age", 0.0)))

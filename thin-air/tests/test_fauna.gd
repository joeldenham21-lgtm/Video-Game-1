extends TestCase
## Fauna: species data + clips, perception (sight / crouch / night, smell by wind, hearing, fire fear), state
## transitions (deer flight, wolf pack chain, torch retreat), damage / death / harvest, attacks on the player,
## spawner limits, persistence roundtrip and per-frame cost.
## timeout 300 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_fauna.gd

const TARGET_SRC := """extends Node3D
var is_crouching := false
var velocity := Vector3.ZERO
var hits: Array = []
func get_eye_position() -> Vector3:
	return global_position + Vector3(0.0, 1.6, 0.0)
func take_damage(amount: float, type: StringName, source: Node = null, hit_position := Vector3.ZERO) -> void:
	hits.append([amount, type, source])
"""

var fauna: FaunaManager
var target: Node3D
var site := Vector3.ZERO
var _killed := 0
var _harvested: Array[StringName] = []


func run() -> void:
	FaunaManager.spawning_enabled = false
	Climate.locked = true
	Climate.set_weather(&"clear", 0.0)
	Climate.hours = 12.0
	site = _flat_spot(Vector2(-470.0, 905.0))
	var sc := GDScript.new()
	sc.source_code = TARGET_SRC
	sc.reload()
	target = Node3D.new()
	target.set_script(sc)
	add_child(target)
	target.global_position = site
	fauna = (load("res://scenes/fauna/fauna.tscn") as PackedScene).instantiate() as FaunaManager
	add_child(fauna)
	fauna.debug_target = target
	Events.animal_killed.connect(func(_s: StringName, _p: Vector3) -> void: _killed += 1)
	Events.resource_harvested.connect(func(id: StringName, _p: Vector3) -> void: _harvested.append(id))
	_test_species()
	_test_sight()
	_test_smell_hearing_fire()
	_test_deer_flight()
	_test_damage_death_harvest()
	_test_attack()
	_test_pack()
	_test_spawner()
	_test_persistence()
	_test_cost()
	FaunaManager.spawning_enabled = true


func _flat_spot(c: Vector2) -> Vector3:
	var best := Vector3(c.x, 0.0, c.y)
	var bs := INF
	for j in 15:
		for i in 15:
			var x := c.x + (i - 7) * 12.0
			var z := c.y + (j - 7) * 12.0
			var s := TerrainData.get_slope_deg(x, z) + (500.0 if TerrainData.get_water_level(x, z) > -1e20 else 0.0)
			if s < bs:
				bs = s
				best = Vector3(x, 0.0, z)
	best.y = TerrainData.get_height(best.x, best.z)
	return best


func _env() -> void:
	fauna._update_player(0.0)
	fauna._refresh_env()


func _place(a: Animal, offset: Vector3, face_target: bool) -> void:
	var p := site + offset
	p.y = TerrainData.get_height(p.x, p.z)
	a.global_position = p
	var to := site - p
	a.yaw = atan2(-to.x, -to.z) if face_target else atan2(to.x, to.z)
	a._orient(0.0)
	a.awareness = 0.0
	a.fear = 0.0


func _perceive(a: Animal, seconds: float) -> void:
	var n := int(seconds / 0.1)
	for i in n:
		fauna.now += 0.1
		a._perceive(0.1)


# ------------------------------------------------------------------------------------------------ tests
func _test_species() -> void:
	for sp in [&"wolf", &"deer", &"bear", &"old_grey"]:
		check(fauna.defs.has(sp), "species %s loaded" % sp)
	var wolf: SpeciesDef = fauna.defs.get(&"wolf")
	if wolf:
		for c in ["idle", "walk", "trot", "gallop", "stalk", "sniff", "look", "howl", "snarl", "attack", "hit", "death"]:
			check(not wolf.clip(StringName(c)).is_empty(), "wolf clip '%s' in sidecar" % c)
		check(absf(wolf.clip_speed(&"trot", 0.0) - 2.6) < 0.01, "wolf trot native speed from sidecar")
		var a := fauna.spawn_animal(&"wolf", site, 0.0, 1)
		check(a.anim != null and a.anim.has_animation(&"gallop"), "wolf glb has baked gallop clip")
		check(a.anim.get_animation(&"trot").loop_mode == Animation.LOOP_LINEAR, "gait clips loop")
		check(a.anim.get_animation(&"death").loop_mode == Animation.LOOP_NONE, "death clip does not loop")
		check(a.mesh != null and a.shells != null, "wolf has a mesh and a fur-shell layer")
		check(a.is_in_group(&"creature") and a.is_in_group(&"damageable"), "live animal groups")
		check(a.collision_layer == 1 << 2, "animals on the creatures physics layer")
		a.set_lod(0, 5.0)
		check(a.shell_count() == FurLibrary.shell_budget(), "full shell budget close up (%d)" % a.shell_count())
		a.set_lod(1, 80.0)
		check(a.shell_count() == 0, "no shells at 80 m")
		fauna.release(a)
	var deer: SpeciesDef = fauna.defs.get(&"deer")
	if deer:
		check(not deer.clip(&"stot").is_empty(), "deer has the stotting clip")


func _test_sight() -> void:
	Climate.hours = 12.0
	Climate.wind_direction = Vector3(0.0, 0.0, 1.0)      # blows south: wolves north of the target are upwind (no scent)
	var a := fauna.spawn_animal(&"wolf", site, 0.0, 2)
	_env()
	_place(a, Vector3(0.0, 0.0, -30.0), true)
	_perceive(a, 2.0)
	var day_front := a.awareness
	check(a.sees_player and day_front > 0.5, "sight: sees a standing player 30 m ahead by day (%.2f)" % day_front)
	_place(a, Vector3(0.0, 0.0, -30.0), false)
	_perceive(a, 2.0)
	check(not a.sees_player and a.awareness < 0.05, "sight: blind directly behind (%.2f)" % a.awareness)
	_place(a, Vector3(0.0, 0.0, -70.0), true)
	_perceive(a, 1.5)
	var day70 := a.awareness
	target.set(&"is_crouching", true)
	_env()
	_place(a, Vector3(0.0, 0.0, -70.0), true)
	_perceive(a, 1.5)
	check(a.awareness < day70 * 0.5, "sight: crouching halves the distance it is seen at (%.2f vs %.2f)" % [a.awareness, day70])
	target.set(&"is_crouching", false)
	Climate.hours = 1.0
	_env()
	_place(a, Vector3(0.0, 0.0, -70.0), true)
	_perceive(a, 1.5)
	check(a.awareness < day70 * 0.5, "sight: night cuts sight range (%.2f vs %.2f)" % [a.awareness, day70])
	Climate.hours = 12.0
	fauna.release(a)


func _test_smell_hearing_fire() -> void:
	var a := fauna.spawn_animal(&"wolf", site, 0.0, 3)
	# the wolf is 120 m north (-z) of the target, facing away; wind blows north -> wolf is downwind
	Climate.wind_direction = Vector3(0.0, 0.0, -1.0)
	_env()
	_place(a, Vector3(0.0, 0.0, -120.0), false)
	_perceive(a, 3.0)
	check(a.smells_player and a.awareness > 0.3, "smell: scents the player 120 m upwind (%.2f)" % a.awareness)
	Climate.wind_direction = Vector3(0.0, 0.0, 1.0)
	_env()
	_place(a, Vector3(0.0, 0.0, -120.0), false)
	_perceive(a, 3.0)
	check(not a.smells_player and a.awareness < 0.05, "smell: nothing when the player is downwind (%.2f)" % a.awareness)
	# hearing
	_place(a, Vector3(0.0, 0.0, -50.0), false)
	var noise_at := site + Vector3(3.0, 0.0, 0.0)
	Events.noise_emitted.emit(noise_at, 60.0, target)
	check(a.awareness > 0.3 and a.last_known.distance_to(noise_at) < 0.01, "hearing: a noise in range alerts and is remembered")
	a.awareness = 0.0
	Events.noise_emitted.emit(site, 8.0, target)
	check(a.awareness < 0.01, "hearing: a quiet noise far away is not heard")
	# fire: a lit torch held by the player
	var torch := Node3D.new()
	torch.set_script(load("res://src/dev/fauna_test_fire.gd"))
	target.add_child(torch)
	_env()
	check(fauna.player_has_fire, "fire: a torch carried by the player is detected")
	_place(a, Vector3(0.0, 0.0, -4.0), true)
	var th := fauna.fire_threat_at(a.global_position)
	check(th > 0.3, "fire: torch threat close by (%.2f)" % th)
	check(fauna.fire_threat_at(site + Vector3(0.0, 0.0, -30.0)) == 0.0, "fire: no threat 30 m away")
	_perceive(a, 1.0)
	check(a.fear > 0.3, "fire: wolf fears the torch (%.2f)" % a.fear)
	fauna.fire_wave_t = fauna.now
	check(fauna.fire_threat_at(a.global_position) > th, "fire: waving the torch scares more")
	torch.free()
	_env()
	fauna.release(a)


func _test_deer_flight() -> void:
	if not fauna.defs.has(&"deer"):
		return
	var d := fauna.spawn_animal(&"deer", site + Vector3(0.0, 0.0, -40.0), 0.0, 4)
	_env()
	d.set_state(Animal.State.GRAZE)
	d.awareness = 0.9
	d.last_known = site
	d.think(0.1)
	check(d.state == Animal.State.FLEE, "deer: high alarm -> flee")
	check(d.gait_override() == &"stot", "deer: flight starts with stotting")
	for i in 60:
		d.tick(0.1)
	check(d.global_position.distance_to(site) > 55.0, "deer: ran away from the threat (%.0f m)" % d.global_position.distance_to(site))
	check(d.gait_override() == &"", "deer: stot gives way to the gallop")
	fauna.release(d)


func _test_damage_death_harvest() -> void:
	var a := fauna.spawn_animal(&"wolf", site + Vector3(3.0, 0.0, -3.0), 0.0, 5)
	var k0 := _killed
	a.take_damage(20.0, &"pierce", target, a.global_position + Vector3.UP * 0.5)
	check(not a.dead and absf(a.health - 35.0) < 0.01 and a.awareness == 1.0, "damage: arrow wound, alerted")
	check(a.current_clip() == &"hit", "damage: hit reaction plays")
	var hp := a.health
	a.harvest_hit(&"knife", 1.0, a.global_position, Vector3.UP, target)
	check(not a.dead and a.health < hp and a.harvest_index == 0, "melee: a knife swing at a live animal wounds it")
	a.take_damage(100.0, &"pierce", target)
	check(a.dead and _killed == k0 + 1, "death: killed, Events.animal_killed emitted")
	check(a.is_in_group(&"harvestable") and not a.is_in_group(&"damageable"), "death: corpse is harvestable, not damageable")
	check(fauna.kill_count(&"wolf") >= 1, "death: kill counted")
	check(a.get_harvest_tool_type() == &"knife", "harvest: needs a knife")
	_harvested.clear()
	for i in 12:
		a.harvest_hit(&"knife", 1.0, a.global_position + Vector3.UP * 0.3, Vector3.UP, target)
	check(_harvested.size() == 6, "harvest: 6 items from a wolf (%d)" % _harvested.size())
	check(_harvested.count(&"meat_raw") == 3 and _harvested.count(&"hide_raw") == 1 and _harvested.count(&"bone") == 2,
		"harvest: meat x3, hide, bone x2")
	check(a.butchered, "harvest: carcass butchered")
	fauna.release(a)


func _test_attack() -> void:
	var a := fauna.spawn_animal(&"wolf", site, 0.0, 6)
	_env()
	_place(a, Vector3(0.0, 0.0, -1.3), true)
	target.set(&"hits", [])
	a.ai_enabled = false
	a.start_attack()
	for i in 14:
		a._attack_update(0.1)
	var hits: Array = target.get(&"hits")
	check(hits.size() == 1, "attack: one bite lands on a player in reach (%d)" % hits.size())
	if hits.size() == 1:
		check(hits[0][1] == &"bite" and float(hits[0][0]) > 8.0 and hits[0][2] == a, "attack: bite damage from the wolf")
	target.set(&"hits", [])
	_place(a, Vector3(0.0, 0.0, -6.0), true)
	a.attack_cd = 0.0
	a.start_attack()
	for i in 14:
		a._attack_update(0.1)
	check((target.get(&"hits") as Array).is_empty(), "attack: out of reach misses")
	fauna.release(a)


func _test_pack() -> void:
	Climate.hours = 23.0
	Climate.wind_direction = Vector3(1.0, 0.0, 0.0)
	_env()
	var pack: RefCounted = fauna.spawn_pack(site + Vector3(90.0, 0.0, 0.0), 3)
	for w in pack.get(&"members"):
		(w as Animal).awareness = 0.6
		(w as Animal).last_known = site
	var seen := {}
	for i in 2400:
		fauna._physics_process(1.0 / 30.0)
		seen[pack.call(&"mode_name")] = true
		if seen.has("TEST") or seen.has("ATTACK"):
			break
	check(seen.has("TRACK") and seen.has("STALK"), "pack: tracks then stalks (%s)" % str(seen.keys()))
	check(seen.has("CIRCLE"), "pack: circles the player")
	check(seen.has("TEST") or seen.has("ATTACK"), "pack: tests with a false charge at night")
	# a torch waved in their faces breaks them
	var torch := Node3D.new()
	torch.set_script(load("res://src/dev/fauna_test_fire.gd"))
	target.add_child(torch)
	for w in pack.get(&"members"):
		var a := w as Animal
		a.global_position = site + (a.global_position - site).normalized() * 4.0
	fauna._refresh_env()
	fauna.fire_wave_t = fauna.now
	for i in 30:
		fauna._physics_process(1.0 / 30.0)
		fauna.fire_wave_t = fauna.now
	check(pack.call(&"mode_name") == "RETREAT", "pack: retreats from a waved torch (%s)" % pack.call(&"mode_name"))
	torch.free()
	fauna.release_all()
	Climate.hours = 12.0


func _test_spawner() -> void:
	FaunaManager.spawning_enabled = true
	Climate.hours = 21.0
	_env()
	var min_d := INF
	for i in 400:
		fauna._pack_cooldown = 0.0
		fauna._population()
		for a in fauna.animals:
			min_d = minf(min_d, a.global_position.distance_to(site))
	check(fauna.count_alive() <= FaunaManager.MAX_ACTIVE, "spawner: never more than %d animals (%d)" % [FaunaManager.MAX_ACTIVE, fauna.count_alive()])
	check(fauna.count_alive() > 0, "spawner: populates the valley")
	check(fauna.packs.size() <= 1, "spawner: one wolf pack at a time")
	check(min_d > FaunaManager.SPAWN_MIN * 0.75, "spawner: spawns out of the player's way (closest %.0f m)" % min_d)
	# walking away despawns everything
	target.global_position = site + Vector3(0.0, 0.0, -600.0)
	_env()
	fauna._despawn()
	check(fauna.count_alive() == 0, "spawner: despawns beyond %.0f m" % FaunaManager.DESPAWN)
	target.global_position = site
	FaunaManager.spawning_enabled = false
	fauna.release_all()
	Climate.hours = 12.0


func _test_persistence() -> void:
	var d := fauna.spawn_animal(&"deer" if fauna.defs.has(&"deer") else &"wolf", site + Vector3(5.0, 0.0, 5.0), 0.7, 7)
	d.die(&"test")
	d.harvest_hit(&"knife", 1.5, d.global_position, Vector3.UP, target)
	var harvested := d.harvest_index
	fauna.old_grey["alive"] = false
	var kills_before := fauna.kill_count(d.def.id)
	var json := JSON.stringify(fauna.save_state())
	var data: Dictionary = JSON.parse_string(json)
	var f2 := (load("res://scenes/fauna/fauna.tscn") as PackedScene).instantiate() as FaunaManager
	add_child(f2)
	f2.load_state(data)
	check(f2.count_corpses() == 1, "persistence: corpse restored")
	if f2.count_corpses() == 1:
		var c := f2.animals[0]
		check(c.def.id == d.def.id and c.global_position.distance_to(d.global_position) < 0.05, "persistence: same species and place")
		check(c.dead and c.harvest_index == harvested and c.is_in_group(&"harvestable"), "persistence: harvest progress kept")
	check(not bool(f2.old_grey.get("alive", true)), "persistence: Old Grey stays dead")
	check(f2.kill_count(d.def.id) == kills_before, "persistence: kill counts")
	check(f2.get_save_key() == "fauna" and f2.is_in_group(&"persistent"), "persistence: persistent group, key 'fauna'")
	f2.queue_free()
	fauna.release_all()
	fauna.old_grey["alive"] = true


func _test_cost() -> void:
	Climate.hours = 22.0
	_env()
	var ids: Array[StringName] = [&"wolf", &"wolf", &"wolf", &"wolf", &"deer", &"deer", &"deer", &"bear", &"deer",
		&"wolf", &"deer", &"deer"]
	for i in ids.size():
		var a2 := TAU * float(i) / ids.size()
		fauna.spawn_animal(ids[i] if fauna.defs.has(ids[i]) else &"wolf", site + Vector3(sin(a2), 0.0, cos(a2)) * (15.0 + 3.0 * i), a2, 100 + i)
	for a in fauna.animals:
		a.awareness = 0.5
	for i in 30:
		fauna._physics_process(1.0 / 60.0)
	var objs := Performance.get_monitor(Performance.OBJECT_COUNT)
	var t0 := Time.get_ticks_usec()
	var n := 300
	for i in n:
		fauna._physics_process(1.0 / 60.0)
	var us := float(Time.get_ticks_usec() - t0) / n
	var objs2 := Performance.get_monitor(Performance.OBJECT_COUNT)
	print("FAUNA_COST 12 animals: %.0f us/frame (AI + perception + LOD + anim), objects %d -> %d" % [us, objs, objs2])
	check(us < 2500.0, "cost: 12 active animals under 2.5 ms/frame headless (%.0f us)" % us)
	check(objs2 - objs <= 2.0, "cost: no object allocations per frame (%d -> %d)" % [objs, objs2])
	fauna.release_all()

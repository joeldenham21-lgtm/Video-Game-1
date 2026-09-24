extends TestCase
## Player controller: pure movement math (PlayerMotion), API/persistence on a live Player, then the full
## scripted gameplay course (scenes/dev/player_test.tscn): speeds, surfaces, slopes, steps, falls,
## swimming, climbing, ladders, interaction and every tool type. Also reports the controller's cost.


func run() -> void:
	_motion_math()
	var course := (load("res://scenes/dev/player_test.tscn") as PackedScene).instantiate() as PlayerTestCourse
	add_child(course)
	await get_tree().physics_frame
	await get_tree().physics_frame
	await _api(course)
	await course.run_trials(self)
	var p := course.player
	print("PERF player _physics_process avg=%.3f ms peak=%.3f ms" % [p.perf_physics_us / 1000.0, p.perf_physics_peak_us / 1000.0])
	check(p.perf_physics_us < 500.0, "player _physics_process well under 0.5 ms (%.3f ms avg)" % (p.perf_physics_us / 1000.0))
	course.queue_free()


func _motion_math() -> void:
	check(PlayerMotion.gait_speed(PlayerMotion.Gait.WALK) == 1.4, "walk 1.4 m/s")
	check(PlayerMotion.gait_speed(PlayerMotion.Gait.JOG) == 3.2, "jog 3.2 m/s")
	check(PlayerMotion.gait_speed(PlayerMotion.Gait.SPRINT) == 5.2, "sprint 5.2 m/s")
	check(PlayerMotion.gait_speed(PlayerMotion.Gait.CROUCH) == 1.0, "crouch 1.0 m/s")
	var jv := PlayerMotion.jump_velocity()
	check(absf(jv * jv / (2.0 * PlayerMotion.GRAVITY) - 0.45) < 0.001, "jump velocity reaches 0.45 m (%.2f m/s)" % jv)
	check(PlayerMotion.fall_damage(6.9) == 0.0, "< 7 m/s landing is safe")
	check(PlayerMotion.fall_damage(16.0) >= 99.9, "16 m/s landing is lethal")
	var prev := 0.0
	var mono := true
	for i in 30:
		var d := PlayerMotion.fall_damage(7.0 + i * 0.35)
		mono = mono and d >= prev
		prev = d
	check(mono, "fall damage increases with impact speed")
	check(PlayerMotion.surface_grip(&"ice", false) < 0.2 and PlayerMotion.surface_grip(&"ice", true) > 0.8, "ice slippery without crampons")
	check(PlayerMotion.surface_slide_limit_deg(&"snow", false) == 40.0 and PlayerMotion.surface_slide_limit_deg(&"rock", false) == 50.0, "slide limits: snow 40°, rock 50°")
	check(PlayerMotion.slide_accel(45.0, PlayerMotion.surface_friction(&"snow")) > 4.0, "45° snow slides hard")
	check(PlayerMotion.slide_accel(5.0, 0.9) > 0.0, "slide acceleration never stalls")
	check(PlayerMotion.slope_speed_factor(30.0, 1.0) < 0.75 and PlayerMotion.slope_speed_factor(30.0, 0.0) == 1.0, "uphill slows, contouring doesn't")
	check(PlayerMotion.snow_speed_factor(PlayerMotion.snow_depth(1.0, 2600.0)) < 0.6, "deep alpine snow roughly halves speed")
	check(PlayerMotion.snow_depth(1.0, 1450.0) < 0.3, "valley snow is shallow")
	check(PlayerMotion.weight_speed_factor(30.0, 30.0) == 1.0 and PlayerMotion.weight_speed_factor(45.0, 30.0) < 0.5, "overweight slows")
	check(PlayerMotion.wading_factor(0.2) == 1.0 and PlayerMotion.wading_factor(1.2) < 0.5, "wading slows")
	var v := PlayerMotion.approach(Vector3.ZERO, Vector3(0, 0, -3.2), 10.0, 12.5, 0.1)
	check(is_equal_approx(v.length(), 1.0), "acceleration limits velocity change (%.2f)" % v.length())
	v = PlayerMotion.approach(Vector3(0, 0, -3.2), Vector3.ZERO, 10.0, 12.5, 0.1)
	check(is_equal_approx(v.length(), 1.95), "braking uses deceleration (%.2f)" % v.length())
	var c := PlayerMotion.pad_curve(Vector2(0.5, 0.0))
	check(c.x < 0.35 and is_equal_approx(PlayerMotion.pad_curve(Vector2(1.0, 0.0)).x, 1.0), "stick response curve")
	check(is_equal_approx(PlayerMotion.arrow_speed(0.0), 15.0) and is_equal_approx(PlayerMotion.arrow_speed(1.0), 58.0), "arrow speed 15–58 m/s")
	check(PlayerMotion.step_length(3.2) > 0.9 and PlayerMotion.step_length(3.2) < 1.2, "jogging stride ≈ 1 m")


func _api(course: PlayerTestCourse) -> void:
	var p := course.player
	check(p is CharacterBody3D and p.get_script().get_global_name() == &"Player", "Player is a CharacterBody3D with class_name Player")
	check(p.vitals != null and p.vitals.name == "Vitals", "Vitals child")
	check(p.get_camera() != null and is_equal_approx(p.get_camera().near, 0.05), "camera near 0.05")
	check(p.is_in_group(&"persistent") and p.get_save_key() == "player", "persistent key 'player'")
	check(p.collision_layer == 2, "player on physics layer 2")
	check(p.interactor.collision_mask == (1 | 8 | 16 | 64 | 512), "interaction ray hits layers 1,4,5,7,10")
	check(is_equal_approx(p.interactor.target_position.length(), 2.6), "interaction reach 2.6 m")
	# Equipment: clothing → insulation/windproof; gear tags.
	p.inventory.add(&"parka", 1)
	p.inventory.add(&"wool_hat", 1)
	p.inventory.add(&"crampons", 1)
	check(p.equip(&"parka") and p.equip(&"wool_hat"), "equip clothing")
	check(is_equal_approx(p.get_insulation(), 15.0), "insulation sums worn clothing (%.1f)" % p.get_insulation())
	check(p.get_windproof() > 0.7 and p.get_windproof() < 0.75, "windproof combines layers (%.2f)" % p.get_windproof())
	check(not p.inventory.has(&"parka"), "worn clothing leaves the pack")
	check(p.equip(&"crampons") and p.has_gear(&"crampons") and p.has_crampons(), "crampons → has_gear(crampons)")
	check(p.equipment[&"feet_addon"] == &"crampons", "crampons go on as a boot add-on")
	check(not p.has_gear(&"o2_mask"), "no O2 mask yet")
	p.inventory.add(&"o2_mask", 1)
	check(p.equip(&"o2_mask") and p.has_gear(&"o2_mask") and p.find_equipped(&"o2_mask") == &"mask", "O2 mask worn (mask slot)")
	p.unequip(&"face")
	check(not p.has_gear(&"o2_mask") and p.inventory.has(&"o2_mask"), "unequip(face) takes the O2 mask off")
	p.unequip(&"head")
	check(p.inventory.has(&"wool_hat") and is_equal_approx(p.get_insulation(), 12.0), "unequip returns the item")
	# Hotbar & active item.
	p.inventory.add(&"knife", 1)
	check(p.equip(&"knife") and p.get_active_item() == &"knife", "equip a tool → active item")
	p.select_hotbar(p.active_slot)
	check(p.get_active_item() == &"", "selecting the active slot again empties the hands")
	# Persistence roundtrip.
	p.equip(&"knife")
	p.vitals.food = 42.0
	p.vitals.add_effect(&"wet", 100.0, 0.5)
	p.teleport(Vector3(3.0, PlayerTestCourse.Y0 + 0.05, -1.0), 37.0)
	var data: Variant = JSON.parse_string(JSON.stringify(p.save_state()))
	var q := (load("res://scenes/player/player.tscn") as PackedScene).instantiate() as Player
	course.add_child(q)
	q.load_state(data)
	await get_tree().physics_frame
	check(q.global_position.distance_to(Vector3(3.0, PlayerTestCourse.Y0 + 0.05, -1.0)) < 0.1, "position restored")
	check(absf(q.get_yaw_deg() - 37.0) < 0.1, "yaw restored")
	check(is_equal_approx(q.vitals.food, 42.0) and q.vitals.has_effect(&"wet"), "vitals restored")
	check(q.equipment[&"body"] == &"parka" and q.has_crampons(), "equipment restored")
	check(q.inventory.has(&"knife") and q.hotbar.has(&"knife") and q.get_active_item() == &"knife", "inventory, hotbar and active item restored")
	q.queue_free()
	await get_tree().physics_frame
	# Tidy for the trials.
	p.unequip(&"body")
	p.unequip(&"feet_addon")
	p.select_hotbar(-1)
	p.hotbar.fill(&"")
	p.vitals.reset()
	Game.register_player(p)
	# Damage + death + respawn.
	p.take_damage(30.0, &"bite", null, p.global_position + Vector3.FORWARD)
	check(is_equal_approx(p.vitals.health, 70.0), "take_damage reduces health")
	check(p.vitals.has_effect(&"bleeding"), "a hard bite causes bleeding")
	p.take_damage(500.0, &"claw")
	check(p.is_dead() and p.vitals.death_cause == &"claw", "death with cause")
	p.respawn(Vector3(0.0, PlayerTestCourse.Y0 + 0.05, 0.0))
	check(not p.is_dead() and p.vitals.health == 100.0, "respawn restores the player")
	await get_tree().physics_frame

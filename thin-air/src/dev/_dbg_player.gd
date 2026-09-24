extends PlayerTestCourse
## TEMP debug harness (deleted before commit).

func _ready() -> void:
	super._ready()
	_dbg.call_deferred()


func _dbg() -> void:
	var mode := String(args.get("dbg", "snow"))
	await _frames(5)
	if mode == "snow":
		await _reset(Vector3(22.0, Y0 + 0.05, -4.5), 0.0)
		Input.action_press(&"move_forward")
		for i in 180:
			await get_tree().physics_frame
			if i % 6 == 0:
				print("%3d y=%.2f z=%.2f floor=%s slide=%s surf=%s n=%s v=%s" % [i, player.global_position.y - Y0, player.global_position.z, player.is_on_floor(), player.is_sliding, player.current_surface, player.get_floor_normal(), player.velocity])
	elif mode == "crate":
		var crate: RigidBody3D = null
		for c in get_children():
			if c is DevCrate:
				crate = c
				break
		await _wait(1.0)
		print("crate at ", crate.global_position, " held=", _held())
		await _reset(Vector3(crate.global_position.x, Y0 + 0.05, crate.global_position.z + 0.6), 0.0, -55.0)
		await _tap(&"crouch")
		await _wait(0.4)
		var cast := player.melee_cast
		cast.target_position = Vector3(0, 0, -1.25)
		cast.force_shapecast_update()
		print("cast hits: ", cast.get_collision_count())
		for i in cast.get_collision_count():
			print("  ", cast.get_collider(i), " ", cast.get_collision_point(i))
		var c0 := crate.global_position
		Input.action_press(&"use")
		for i in 20:
			await get_tree().process_frame
			print(i, " phase=", _held().get(&"phase"), " busy=", _held().busy)
		Input.action_release(&"use")
		await _wait(0.8)
		print("moved ", crate.global_position.distance_to(c0))
	elif mode == "step":
		player.set_meta(&"dbg_step", true)
		await _reset(Vector3(-30.0, Y0 + 0.05, -5.0), 0.0)
		Input.action_press(&"move_forward")
		for i in 60:
			await get_tree().physics_frame
			if i % 3 == 0:
				print("%3d y=%.3f z=%.3f floor=%s v=%s" % [i, player.global_position.y - Y0, player.global_position.z, player.is_on_floor(), player.velocity])
	elif mode == "climb":
		player.inventory.add(&"ice_axe", 1)
		await _reset(Vector3(-12.0, Y0 + 0.05, -6.8), 0.0)
		Input.action_press(&"move_forward")
		await _wait(0.6)
		await _tap(&"jump")
		for i in 700:
			await get_tree().physics_frame
			if i % 10 == 0:
				print("%3d y=%.2f z=%.2f state=%d chest=%s head=%s mantle=%s st=%.1f" % [i, player.global_position.y - Y0, player.global_position.z, player.move_state, player.climb_ray.is_colliding(), player.climb_ray_high.is_colliding(), player.mantle_ray.is_colliding(), player.vitals.stamina])
	get_tree().quit()

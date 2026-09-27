extends Animal
## Mountain goat: grazes alpine ledges and steep meadows (slope limit 58°), unhurried — it relies on terrain, not
## speed. When threatened it climbs: the flee direction is bent uphill along the terrain gradient, onto ground a
## predator (or the player) can't follow. Bleats when alarmed.


func flee_bias(away: Vector3) -> Vector3:
	var n := TerrainData.get_normal(global_position.x, global_position.z)
	var uphill := Vector3(-n.x, 0.0, -n.z)
	if uphill.length_squared() < 0.0004:
		return away
	return (away * 0.45 + uphill.normalized() * 0.9).normalized()


func start_flee() -> void:
	if state != State.FLEE:
		set_state(State.FLEE)
		vocal(&"goat_bleat", 0.0)


func flee_step() -> void:
	super.flee_step()
	target_speed = def.trot_speed * 1.4 if dist_to_player > 25.0 else def.run_speed

extends Animal
## Snowshoe hare (white winter coat by late October): feeds in cover, freezes flat when it notices something
## (relying on camouflage — sight range against it is short), and only bolts when the threat comes close or it is
## startled by noise, zig-zagging at up to 12 m/s. Squeals when caught.

var _zig := 1.0
var _zig_t := 0.0


func think(dt: float) -> void:
	if state == State.FREEZE:
		target_speed = 0.0
		if awareness > 0.85 or dist_to_player < 7.0 or fear > 0.35:
			start_flee()
		elif awareness < 0.2 and state_time > 4.0:
			set_state(State.GRAZE)
		return
	if (state == State.IDLE or state == State.GRAZE or state == State.WANDER) and awareness > 0.3 \
			and dist_to_player > 7.0 and fear < 0.3:
		set_state(State.FREEZE)
		return
	super.think(dt)


func flee_bias(away: Vector3) -> Vector3:
	_zig_t -= 0.1
	if _zig_t <= 0.0:
		_zig_t = rng.randf_range(4.0, 8.0)
		_zig = -_zig
	return away.rotated(Vector3.UP, 0.55 * _zig)


func start_flee() -> void:
	if state != State.FLEE:
		set_state(State.FLEE)
		fear = maxf(fear, 0.5)


func die(cause: StringName = &"") -> void:
	Audio.play_sfx(&"hare_squeal", global_position, 0.0, voice_pitch)
	super.die(cause)

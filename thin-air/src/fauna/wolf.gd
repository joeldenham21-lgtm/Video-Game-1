extends Animal
## Grey wolf. Group behaviour lives in WolfPack (src/fauna/wolf_pack.gd), which sets each member's goal, speed,
## gait and facing; this script adds the individual layer: howling (and joining a chorus), snarling while circling,
## the lunge-bite, injury reactions and a lone wolf's fallback (keep away, flee fire).

var _howl_at := -1.0


func on_activated() -> void:
	_howl_at = -1.0


func howl() -> void:
	target_speed = 0.0
	speed = 0.0
	play_override(C_HOWL, float(def.clip(C_HOWL).get("length", 4.0)))
	vocal(&"wolf_howl", 2.0)


func join_howl(delay: float) -> void:
	_howl_at = manager.now + delay


func think(dt: float) -> void:
	if _howl_at > 0.0 and manager.now >= _howl_at:
		_howl_at = -1.0
		if not is_attacking():
			play_override(C_HOWL, float(def.clip(C_HOWL).get("length", 4.0)) * rng.randf_range(0.85, 1.0))
			Audio.play_sfx(&"wolf_howl", global_position + Vector3(0.0, 0.9, 0.0), 0.0, voice_pitch * rng.randf_range(0.95, 1.08))
	if _override == C_HOWL:
		target_speed = 0.0
	if pack == null:
		# lone wolf: wary, keeps its distance, runs from fire and people
		if fire_threat > 0.2 or (awareness > 0.6 and dist_to_player < 40.0):
			if state != State.FLEE:
				set_state(State.FLEE)
			flee_step()
			target_speed = def.trot_speed * 1.6
		else:
			super.think(dt)


func idle_clip() -> StringName:
	match state:
		State.CIRCLE, State.ATTACK, State.CHARGE:
			return C_SNARL
		State.STALK:
			return C_LOOK
		State.FOLLOW:
			return C_SNIFF if fmod(manager.now * 0.1 + float(get_instance_id() % 7), 3.0) < 1.0 else C_IDLE
	return super.idle_clip()


func on_damaged(amount: float, _source: Node) -> void:
	fear = minf(1.0, fear + amount / def.health)
	if pack:
		pack.call(&"on_member_hurt", self, amount / def.health)
	elif health < def.health * 0.6:
		set_state(State.FLEE)

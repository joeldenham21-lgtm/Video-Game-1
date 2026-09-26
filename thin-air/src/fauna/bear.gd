extends Animal
## Grizzly bear. Forages (walk / sniff), notices the player (sight, a very good nose downwind, noise), stands its
## ground with huffs and a stare, and defends its space: inside ~25 m it charges. Most charges are BLUFFS — it
## pulls up 4–7 m short, roars, snarls and then backs off; a provoked bear (hurt, a grudge, the player keeps closing
## in, or Old Grey's temper) charges for real and mauls (claw swipes + bites) until the player is down or away, or
## until it is badly hurt. Fire does little; a flare-gun shot or a burning flare close by panics it (flees far).
## Old Grey (species "old_grey", same mesh, silvered/scarred coat, larger) lives near Ashford Mine and is persistent.

const TERRITORY := 25.0
const C_SNARL_B := &"snarl"

var old_grey := false
var bluffs := 0
var _real := false
var _standoff := 0.0


func on_activated() -> void:
	old_grey = def.id == &"old_grey"
	bluffs = 0
	_real = false
	if old_grey:
		persistent_id = "old_grey"


## Called by FaunaManager when (re)spawning Old Grey with his saved health.
func make_old_grey(saved_health: float) -> void:
	old_grey = true
	persistent_id = "old_grey"
	if saved_health > 0.0:
		health = minf(saved_health, def.health)


func _scared() -> bool:
	return fire_threat > (0.45 if old_grey else 0.3) or fear > 0.55


func think(dt: float) -> void:
	if _scared() and state != State.FLEE:
		set_state(State.FLEE)
		vocal(&"bear_huff", 2.0)
	match state:
		State.FLEE:
			flee_step()
			target_speed = def.run_speed * (0.85 if state_time < 6.0 else 0.4)
			if state_time > 12.0 and dist_to_player > 90.0 and fear < 0.3:
				home = global_position
				set_state(State.WANDER)
		State.IDLE, State.GRAZE, State.WANDER:
			target_speed = def.walk_speed * 0.8 if state == State.WANDER else 0.0
			if state_time > rng.randf_range(8.0, 16.0):
				_pick_wander()
			if state == State.WANDER and _arrived(2.0):
				set_state(State.GRAZE)
			if awareness > 0.5 and dist_to_player < 70.0:
				set_state(State.ALERT)
				vocal(&"bear_huff", 0.0)
		State.ALERT:
			target_speed = 0.0
			face(last_known)
			_standoff += dt
			var provoked := grudge > 0.2 or (old_grey and rng.randf() < dt * 0.08)
			if dist_to_player < TERRITORY * (1.3 if old_grey else 1.0) or provoked:
				_start_charge(provoked or dist_to_player < 7.0)
			elif state_time > 5.0 and rng.randf() < dt * 0.2:
				vocal(&"bear_huff", -2.0)
			if awareness < 0.2 and state_time > 8.0:
				set_state(State.WANDER)
				_pick_wander()
		State.CHARGE:
			target_pos = manager.player_pos
			target_speed = def.run_speed
			face_on = false
			var stop := rng.randf_range(4.0, 7.0) if not _real else 0.0
			if not _real and dist_to_player < stop:
				set_state(State.CIRCLE)
				speed *= 0.3
				vocal(&"bear_roar", 3.0)
			elif _real and dist_to_player < 12.0:
				set_state(State.ATTACK)
			if state_time > 12.0:
				set_state(State.ALERT)
		State.CIRCLE:
			# bluff stand-off: stop short, snarl and roar, then back away slowly
			target_speed = 0.0
			face(manager.player_pos)
			if state_time > 3.0:
				bluffs += 1
				set_state(State.RETREAT)
			elif dist_to_player < 3.0 or grudge > 0.25:
				_start_charge(true)
		State.RETREAT:
			var away := global_position - manager.player_pos
			away.y = 0.0
			target_pos = global_position + away.normalized() * 20.0
			target_speed = def.walk_speed
			if state_time > 15.0 or dist_to_player > 60.0:
				awareness *= 0.5
				set_state(State.WANDER)
				_pick_wander()
			elif dist_to_player < 10.0 and state_time > 3.0:
				_start_charge(bluffs >= 2 or old_grey)
		State.ATTACK:
			target_pos = manager.player_pos
			face(manager.player_pos)
			if is_attacking():
				target_speed = 0.0
			elif dist_to_player < def.attack_range + 0.8:
				target_speed = 0.0
				start_attack()
			else:
				target_speed = def.run_speed * 0.7 if dist_to_player > 4.0 else def.walk_speed
			if dist_to_player > 30.0 or not manager.player_valid:
				set_state(State.RETREAT)
			if health < def.health * 0.35:
				set_state(State.FLEE)
		_:
			super.think(dt)


func _start_charge(real: bool) -> void:
	_real = real
	set_state(State.CHARGE)
	vocal(&"bear_roar", 4.0)


func idle_clip() -> StringName:
	match state:
		State.CIRCLE:
			return C_SNARL_B
		State.ALERT:
			return C_LOOK
	return super.idle_clip()


func on_heard(pos: Vector3, loudness: float, k: float) -> void:
	# a gunshot / flare-gun report close by panics a bear
	if loudness > 1.2 and global_position.distance_to(pos) < 70.0:
		fear = minf(1.0, fear + 0.45 + 0.4 * k)


func on_damaged(amount: float, _source: Node) -> void:
	grudge = minf(1.0, grudge + amount / def.health * 2.0)
	if health < def.health * 0.35:
		set_state(State.FLEE)
	elif state != State.ATTACK:
		_start_charge(true)


func on_died() -> void:
	vocal(&"bear_roar", -2.0)

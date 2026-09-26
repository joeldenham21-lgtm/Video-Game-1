extends RefCounted
## Wolf pack brain (2–4 wolves). Shared memory (the pack knows what any member perceives), one leader, morale.
## Modes: ROAM (leader wanders, others follow in file; night howl chorus) → TRACK (trot toward the scent/sound)
## → STALK (low stalk gait, fanning out to ~30 m) → CIRCLE (orbit 15–22 m, snarling) → TEST (one wolf false-charges
## to ~3 m, barks, veers off) → ATTACK (one biter at a time: rush, lunge-bite, fall back) ; RETREAT when hurt, a
## member dies, morale breaks, or a torch/flare is waved or thrown at them. Courage grows at night, when the player is
## hurt/weak, and with pack size; fire, daylight and injuries sap it.

enum Mode { ROAM, TRACK, STALK, CIRCLE, TEST, ATTACK, RETREAT }

var members: Array[Animal] = []
var leader: Animal = null
var mode: Mode = Mode.ROAM
var mode_t := 0.0
var morale := 1.0
var awareness := 0.0
var last_known := Vector3.ZERO
var start_size := 0
var circle_ang := 0.0
var circle_dir := 1.0
var circle_r := 18.0
var biter: Animal = null
var tester: Animal = null
var test_phase := 0
var howl_t := 40.0
var roam_goal := Vector3.ZERO
var courage := 0.0
var rng := RandomNumberGenerator.new()
var _next_bite_t := 0.0
var _mode_len := 12.0


func add_member(w: Animal) -> void:
	members.append(w)
	w.pack = self
	if leader == null:
		leader = w
		roam_goal = w.global_position
		rng.seed = hash(Vector2i(int(w.global_position.x), int(w.global_position.z)))
		circle_dir = 1.0 if rng.randf() < 0.5 else -1.0
		howl_t = rng.randf_range(15.0, 60.0)
	start_size = maxi(start_size, members.size())


func remove_member(w: Animal) -> void:
	members.erase(w)
	if w.pack == self:
		w.pack = null
	if leader == w:
		leader = members[0] if not members.is_empty() else null
	if biter == w:
		biter = null
	if tester == w:
		tester = null


func size() -> int:
	return members.size()


func mode_name() -> String:
	return Mode.keys()[mode]


func on_member_died(w: Animal) -> void:
	remove_member(w)
	morale -= 0.5
	for m in members:
		m.vocal(&"wolf_yelp", -4.0)
	set_mode(Mode.RETREAT)


func on_member_hurt(w: Animal, frac: float) -> void:
	morale -= frac * 0.9
	if w == biter:
		biter = null
	if morale < 0.45 or w.health < w.def.health * 0.4:
		set_mode(Mode.RETREAT)


## A member howled: the others join the chorus.
func on_howl(w: Animal) -> void:
	for m in members:
		if m != w and m.has_method(&"join_howl"):
			m.call(&"join_howl", rng.randf_range(0.6, 2.6))


func set_mode(m: Mode) -> void:
	if m == mode:
		return
	mode = m
	mode_t = 0.0
	_mode_len = rng.randf_range(8.0, 16.0)
	biter = null
	tester = null
	test_phase = 0
	for w in members:
		w.stalk_gait = false
		w.face_on = false


func update(dt: float, mgr: FaunaManager) -> void:
	if members.is_empty():
		return
	mode_t += dt
	# shared memory
	var fire := 0.0
	var hurt := 0.0
	awareness = maxf(awareness - dt * 0.02, 0.0)
	for w in members:
		if w.awareness > awareness:
			awareness = w.awareness
			last_known = w.last_known
		fire = maxf(fire, w.fire_threat)
		hurt += 1.0 - w.health / maxf(w.def.health, 1.0)
	for w in members:
		if awareness > 0.3:
			w.awareness = maxf(w.awareness, awareness * 0.9)
			w.last_known = last_known
	var night := 1.0 - Climate.get_daylight()
	var sz := clampf(float(members.size()) / 3.0, 0.5, 1.3)
	var weak := 1.35 if mgr.player_health < 0.5 else 1.0
	var torch := 0.35 if mgr.player_has_fire else 1.0
	courage = morale * (0.3 + 0.6 * night) * sz * weak * torch - hurt * 0.3
	if mode != Mode.RETREAT:
		morale = minf(1.0, morale + dt * 0.004)
		if fire > 0.3 or morale < 0.3:
			if fire > 0.3:
				leader.vocal(&"wolf_yelp", -6.0)
			set_mode(Mode.RETREAT)
	var pd := mgr.player_pos.distance_to(leader.global_position) if mgr.player_valid else 1e9
	match mode:
		Mode.ROAM:
			_roam(dt, mgr, night)
			if awareness > 0.45 and mgr.player_valid:
				set_mode(Mode.TRACK if courage > 0.25 else Mode.RETREAT)
		Mode.TRACK:
			_all_to(last_known, 2.6, false, 6.0)
			if pd < 60.0 or (mgr.player_valid and leader.sees_player and pd < 90.0):
				set_mode(Mode.STALK)
			elif mode_t > 60.0 or awareness < 0.2:
				set_mode(Mode.ROAM)
		Mode.STALK:
			_stalk(mgr)
			if pd < 22.0 or mode_t > _mode_len + 6.0:
				set_mode(Mode.CIRCLE)
			if courage < 0.15 and mode_t > 6.0:
				set_mode(Mode.RETREAT)
		Mode.CIRCLE:
			_circle(dt, mgr, 18.0 + (8.0 if mgr.player_has_fire else 0.0))
			if mode_t > _mode_len:
				if courage > 0.45:
					set_mode(Mode.TEST)
				elif courage < 0.2 or mode_t > 45.0:
					set_mode(Mode.RETREAT)
		Mode.TEST:
			_test(dt, mgr)
		Mode.ATTACK:
			_attack(dt, mgr)
			if courage < 0.35 or mode_t > 45.0:
				set_mode(Mode.CIRCLE)
		Mode.RETREAT:
			morale = minf(1.0, morale + dt * 0.012)
			var from := last_known if not mgr.player_valid else mgr.player_pos
			if fire > 0.0:
				from = mgr.last_fire_pos
			for w in members:
				var away := w.global_position - from
				away.y = 0.0
				if away.length_squared() < 0.01:
					away = Vector3(1.0, 0.0, 0.0)
				w.target_pos = w.global_position + away.normalized() * 30.0
				w.target_speed = w.def.run_speed * (0.9 if pd < 60.0 else 0.35)
				w.set_state(Animal.State.RETREAT)
			if mode_t > 25.0 and pd > 110.0:
				awareness *= 0.4
				roam_goal = leader.global_position
				set_mode(Mode.ROAM)


func _roam(dt: float, mgr: FaunaManager, night: float) -> void:
	var lp := leader.global_position
	if Vector2(roam_goal.x - lp.x, roam_goal.z - lp.z).length() < 4.0 or mode_t > 50.0:
		mode_t = 0.0
		for i in 8:
			var a := rng.randf() * TAU
			var g := lp + Vector3(sin(a), 0.0, cos(a)) * rng.randf_range(40.0, 120.0)
			if leader.walkable_point(g):
				roam_goal = g
				break
	howl_t -= dt
	var howling := leader.current_clip() == Animal.C_HOWL
	if howl_t <= 0.0 and night > 0.5 and not howling:
		howl_t = rng.randf_range(70.0, 160.0)
		if leader.has_method(&"howl"):
			leader.call(&"howl")
	leader.target_pos = roam_goal
	leader.target_speed = 0.0 if howling else (leader.def.walk_speed if night < 0.5 else leader.def.trot_speed * 0.9)
	leader.set_state(Animal.State.FOLLOW)
	var prev := leader
	for w in members:
		if w == leader:
			continue
		var back := Vector3(sin(prev.yaw), 0.0, cos(prev.yaw))
		var slot := prev.global_position + back * 4.0
		var d := w.global_position.distance_to(slot)
		w.target_pos = slot
		w.target_speed = 0.0 if d < 1.5 or w.current_clip() == Animal.C_HOWL else clampf(d * 0.9, w.def.walk_speed, w.def.trot_speed * 1.3)
		w.set_state(Animal.State.FOLLOW)
		prev = w


func _all_to(p: Vector3, spd: float, stalk: bool, spread: float) -> void:
	var n := members.size()
	for i in n:
		var w := members[i]
		var off := Vector3(float(i) - float(n - 1) * 0.5, 0.0, 0.0).rotated(Vector3.UP, leader.yaw) * spread
		w.target_pos = p + off
		w.target_speed = spd
		w.stalk_gait = stalk
		w.set_state(Animal.State.STALK if stalk else Animal.State.FOLLOW)


func _stalk(mgr: FaunaManager) -> void:
	var n := members.size()
	var pp := mgr.player_pos
	var base := atan2(leader.global_position.x - pp.x, leader.global_position.z - pp.z)
	for i in n:
		var w := members[i]
		var a := base + (float(i) - float(n - 1) * 0.5) * 0.45
		var goal := pp + Vector3(sin(a), 0.0, cos(a)) * 28.0
		w.target_pos = goal
		var d := w.global_position.distance_to(goal)
		w.stalk_gait = d < 45.0
		w.target_speed = w.def.clip_speed(Animal.C_STALK, 0.5) if w.stalk_gait else w.def.trot_speed
		if d < 3.0:
			w.target_speed = 0.0
			w.face(pp)
		w.set_state(Animal.State.STALK)


func _circle(dt: float, mgr: FaunaManager, r: float) -> void:
	var n := members.size()
	var pp := mgr.player_pos
	circle_ang += dt * circle_dir * 2.2 / r
	for i in n:
		var w := members[i]
		if w.is_attacking():
			continue
		var a := circle_ang + TAU * float(i) / float(n) + 0.3 * sin(mode_t * 0.3 + float(i))
		var goal := pp + Vector3(sin(a), 0.0, cos(a)) * (r + 2.0 * sin(mode_t * 0.5 + float(i) * 1.7))
		if w != biter and w.dist_to_player < 5.0:
			# never cut through the player's space: step back out first
			var away := w.global_position - pp
			away.y = 0.0
			goal = pp + away.normalized() * r
		w.target_pos = goal
		w.target_speed = w.def.walk_speed * 1.1 if w.global_position.distance_to(goal) < 6.0 else w.def.trot_speed
		w.stalk_gait = false
		w.face(pp)
		w.set_state(Animal.State.CIRCLE)
		if w.dist_to_player < 12.0 and w.rng.randf() < dt * 0.15:
			w.vocal(&"wolf_growl", -3.0)


func _test(dt: float, mgr: FaunaManager) -> void:
	if tester == null or not is_instance_valid(tester) or tester.dead:
		tester = members[rng.randi() % members.size()]
		test_phase = 0
	_circle(dt, mgr, 15.0)
	var pp := mgr.player_pos
	var to := tester.global_position - pp
	to.y = 0.0
	if test_phase == 0:
		tester.target_pos = pp + to.normalized() * 2.8
		tester.target_speed = tester.def.run_speed * 0.8
		tester.face_on = false
		tester.set_state(Animal.State.CHARGE)
		if tester.dist_to_player < 4.5:
			test_phase = 1
			tester.vocal(&"wolf_bark", 0.0)
			var side := to.normalized().rotated(Vector3.UP, 1.2 * circle_dir)
			tester.target_pos = pp + side * 16.0
	elif test_phase == 1:
		tester.target_speed = tester.def.trot_speed * 1.3
		if tester.dist_to_player > 12.0:
			test_phase = 2
	if test_phase == 2 or mode_t > 20.0:
		if courage > 0.8 and mgr.player_valid:
			set_mode(Mode.ATTACK)
		else:
			set_mode(Mode.CIRCLE)


func _attack(dt: float, mgr: FaunaManager) -> void:
	_circle(dt, mgr, 11.0)
	var pp := mgr.player_pos
	if biter == null or not is_instance_valid(biter) or biter.dead:
		biter = null
		if mgr.now >= _next_bite_t:
			var best := -1.0
			for w in members:
				var s := w.health / w.def.health - w.dist_to_player * 0.01
				if s > best:
					best = s
					biter = w
	if biter == null:
		return
	var d := biter.dist_to_player
	if biter.is_attacking():
		biter.face(pp)
		return
	if biter.attack_cd > 0.0 and d < 4.0:
		# fall back after a bite, the next wolf goes in
		var away := biter.global_position - pp
		away.y = 0.0
		biter.target_pos = pp + away.normalized() * 11.0
		biter.target_speed = biter.def.trot_speed * 1.3
		biter = null
		_next_bite_t = mgr.now + rng.randf_range(1.5, 4.0)
		return
	biter.target_pos = pp
	biter.target_speed = biter.def.run_speed * 0.75 if d > 4.0 else biter.def.trot_speed
	biter.face(pp)
	biter.set_state(Animal.State.ATTACK)
	if d < biter.def.attack_range + 0.7:
		biter.target_speed = 0.0
		biter.start_attack()

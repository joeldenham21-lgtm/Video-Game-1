extends TestCase
## Vitals math: metabolism timing, warmth/fire/wet/immersion, hypothermia + frostbite, oxygen at altitude,
## stamina + exhaustion, bleeding/bandages, difficulty scaling, consumption, persistence, events.

var _fx_events: Array = []
var _deaths: Array[StringName] = []


func _make(diff := &"survivor") -> Vitals:
	var v := Vitals.new()
	v.auto_simulate = false
	add_child(v)
	v.difficulty = diff
	v.env_felt_temp = 18.0
	v.env_air_temp = 18.0
	v.env_altitude = 1450.0
	return v


## Simulates `seconds` of real time in 1 s steps (time_scale 1).
func _run(v: Vitals, seconds: float, step := 1.0) -> void:
	var t := 0.0
	while t < seconds and not v.dead:
		v.simulate(step)
		t += step


func run() -> void:
	Events.status_effect_changed.connect(func(id: StringName, on: bool) -> void: _fx_events.append([id, on]))
	Events.player_died.connect(func(c: StringName) -> void: _deaths.append(c))
	ItemDB.items[&"_t_ration"] = {"id": &"_t_ration", "category": "food", "stack": 10, "food": {"calories": 250, "water": -2}}
	ItemDB.items[&"_t_tea"] = {"id": &"_t_tea", "category": "drink", "stack": 5, "food": {"water": 30, "warmth": 15}}
	ItemDB.items[&"bandage"] = ItemDB.items.get(&"bandage", {"id": &"bandage", "category": "medical", "stack": 10})
	_metabolism()
	_warmth()
	_oxygen()
	_stamina()
	_injuries()
	_difficulty()
	_consumption()
	_persistence()
	ItemDB.items.erase(&"_t_ration")
	ItemDB.items.erase(&"_t_tea")


func _metabolism() -> void:
	var v := _make()
	v.food = 100.0
	v.water = 100.0
	v.env_exertion = 0.2
	var hours_per_s := v._hours_per_second()
	# Integrate until empty (big steps are fine: metabolism is linear).
	var t := 0.0
	var food_zero := -1.0
	var water_zero := -1.0
	while t < 60000.0 and (food_zero < 0.0 or water_zero < 0.0):
		v._simulate_metabolism(10.0 * hours_per_s)
		t += 10.0
		if food_zero < 0.0 and v.food <= 0.0:
			food_zero = t
		if water_zero < 0.0 and v.water <= 0.0:
			water_zero = t
	var food_days := food_zero * hours_per_s / 24.0
	var water_days := water_zero * hours_per_s / 24.0
	check(food_days > 2.1 and food_days < 2.9, "survivor starves in ~2.5 in-game days (%.2f)" % food_days)
	check(water_days > 1.2 and water_days < 1.8, "dehydrates in ~1.5 in-game days (%.2f)" % water_days)
	# Exertion burns more.
	var a := _make()
	var b := _make()
	a.env_exertion = 0.0
	b.env_exertion = 1.0
	a._simulate_metabolism(5.0)
	b._simulate_metabolism(5.0)
	check(b.food < a.food and b.water < a.water, "exertion burns food and water faster")
	# Starving hurts; no stamina regen at zero food.
	var s := _make()
	s.food = 0.0
	s.stamina = 50.0
	var h0 := s.health
	_run(s, 10.0)
	check(s.health < h0, "starvation drains health (%.2f)" % s.health)
	check(is_equal_approx(s.stamina, 50.0), "no stamina regen when starving")
	check(s.has_effect(&"starving"), "starving condition effect")
	for n in [a, b, s, v]:
		n.queue_free()


func _warmth() -> void:
	# Comfortable → stays warm.
	var v := _make()
	v.env_felt_temp = 20.0
	_run(v, 120.0)
	check(v.warmth > 99.0, "20 °C felt keeps warmth full (%.1f)" % v.warmth)
	# Freezing night → falls, then hypothermia damage and death by cold.
	var c := _make()
	c.env_felt_temp = -25.0
	c.env_air_temp = -25.0
	_run(c, 60.0)
	var w60 := c.warmth
	check(w60 < 90.0 and w60 > 60.0, "−25 °C: warmth drops steadily (%.1f after 60 s)" % w60)
	_run(c, 600.0)
	check(c.warmth < 15.0, "−25 °C: hypothermic within ~10 min (%.1f)" % c.warmth)
	check(c.has_effect(&"hypothermia"), "hypothermia effect")
	check(c.health < 100.0, "hypothermia damages health (%.1f)" % c.health)
	check(c.body_temp < 34.0, "body temperature falls (%.1f °C)" % c.body_temp)
	_run(c, 1200.0)
	check(c.dead and c.death_cause == &"cold", "freezing to death → cause cold (%s)" % c.death_cause)
	check(_deaths.has(&"cold"), "Events.player_died(cold) emitted")
	# Wet cools faster than dry.
	var dry := _make()
	var wet := _make()
	dry.env_felt_temp = -5.0
	wet.env_felt_temp = -5.0
	wet.add_effect(&"wet", 400.0, 1.0)
	_run(dry, 60.0)
	_run(wet, 60.0)
	check(wet.warmth < dry.warmth - 2.0, "wet clothes cool faster (%.1f vs %.1f)" % [wet.warmth, dry.warmth])
	# Fire warms even if Climate's felt value ignores it.
	var f := _make()
	f.warmth = 30.0
	f.env_felt_temp = -12.0
	f.env_air_temp = -10.0
	f.env_insulation = 4.0
	f.env_heat = 25.0
	_run(f, 90.0)
	check(f.warmth > 60.0, "a fire warms you up (%.1f)" % f.warmth)
	check(f.has_effect(&"warmed_up") or f.warmth < 92.0, "warmed_up near a fire when toasty")
	# Fire dries you out quickly.
	f.add_effect(&"wet", 300.0, 1.0)
	_run(f, 70.0)
	check(not f.has_effect(&"wet"), "drying by the fire removes wet")
	# Immersion in glacial water: wet immediately, dangerous within ~1–2 minutes.
	var i := _make()
	i.env_immersion = 1.0
	i.simulate(0.5)
	check(i.has_effect(&"wet"), "immersion soaks you")
	_run(i, 75.0)
	check(i.warmth < 30.0, "glacial water: warmth %.1f after 75 s" % i.warmth)
	# Frostbite from prolonged extreme cold, cured by warming up.
	var fb := _make()
	fb.env_felt_temp = -35.0
	fb.env_air_temp = -35.0
	fb.warmth = 20.0
	_run(fb, 240.0)
	check(fb.has_effect(&"frostbite"), "prolonged −35 °C causes frostbite")
	_run(fb, 300.0)
	check(fb.max_health < 100.0, "frostbite lowers max health (%.1f)" % fb.max_health)
	fb.dead = false
	fb.health = 50.0
	fb.env_felt_temp = 24.0
	fb.env_air_temp = 20.0
	fb.env_heat = 20.0
	_run(fb, 200.0)
	check(not fb.has_effect(&"frostbite"), "warming up cures frostbite")
	for n in [v, c, dry, wet, f, i, fb]:
		n.queue_free()


func _oxygen() -> void:
	var v := _make()
	v.env_altitude = 3400.0
	v.env_exertion = 0.9
	_run(v, 30.0)
	check(v.oxygen < 85.0, "exertion at 3,400 m drains oxygen (%.1f)" % v.oxygen)
	_run(v, 60.0)
	check(v.has_effect(&"hypoxic"), "hypoxic below 40")
	var o0 := v.oxygen
	v.env_o2_supply = true
	_run(v, 10.0)
	check(v.oxygen > o0 + 10.0, "O2 mask + bottle restores (%.1f → %.1f)" % [o0, v.oxygen])
	v.env_o2_supply = false
	v.env_altitude = 2400.0
	v.env_exertion = 0.0
	_run(v, 30.0)
	check(v.oxygen > 95.0 and not v.has_effect(&"hypoxic"), "descending recovers oxygen (%.1f)" % v.oxygen)
	var low := _make()
	low.env_altitude = 2000.0
	low.env_exertion = 1.0
	_run(low, 60.0)
	check(low.oxygen > 99.0, "no drain below 2,800 m")
	# Breath hold.
	var d := _make()
	d.env_head_underwater = true
	_run(d, 40.0)
	check(d.health < 100.0, "drowning after holding breath (%.1f)" % d.health)
	for n in [v, low, d]:
		n.queue_free()


func _stamina() -> void:
	var v := _make()
	check(v.use_stamina(30.0) and is_equal_approx(v.stamina, 70.0), "use_stamina spends")
	check(not v.use_stamina(80.0), "use_stamina refuses when short")
	v.drain_stamina(200.0)
	check(v.stamina == 0.0 and v.has_effect(&"exhausted"), "draining to 0 → exhausted")
	check(not v.can_sprint(), "exhausted can't sprint")
	v.simulate(0.5)
	check(v.stamina == 0.0, "regen waits a moment after exertion")
	_run(v, 3.0, 0.1)
	check(v.stamina > 20.0, "stamina regenerates (%.1f)" % v.stamina)
	_run(v, 2.0, 0.1)
	check(not v.has_effect(&"exhausted"), "exhausted clears once recovered")
	var hi := _make()
	hi.env_altitude = 3300.0
	check(hi.stamina_regen_multiplier() < v.stamina_regen_multiplier(), "thin air slows stamina recovery")
	for n in [v, hi]:
		n.queue_free()


func _injuries() -> void:
	var v := _make()
	v.add_effect(&"bleeding", 200.0, 1.0)
	_run(v, 10.0)
	var h := v.health
	check(h < 97.0, "bleeding drains health (%.1f)" % h)
	check(v.consume(&"bandage"), "bandage can be applied")
	check(not v.has_effect(&"bleeding"), "bandage stops bleeding")
	v.add_effect(&"sprain", 100.0, 1.0)
	check(v.movement_multiplier() < 0.8 and not v.can_sprint(), "sprain slows you and prevents sprinting")
	_run(v, 101.0)
	check(not v.has_effect(&"sprain"), "sprain heals with time")
	# Natural regeneration when fed, watered and warm.
	var r := _make()
	r.health = 50.0
	r.food = 90.0
	r.water = 90.0
	_run(r, 300.0)
	check(r.health > 55.0, "natural healing when fed/warm (%.1f)" % r.health)
	_fx_events.clear()
	var e := _make()
	e.add_effect(&"sick", 10.0)
	e.remove_effect(&"sick")
	check(_fx_events.has([&"sick", true]) and _fx_events.has([&"sick", false]), "status_effect_changed emitted on add/remove")
	for n in [v, r, e]:
		n.queue_free()


func _difficulty() -> void:
	var ex := _make(&"explorer")
	ex._simulate_metabolism(48.0)
	check(ex.food == 100.0 and ex.water == 100.0, "explorer: no hunger or thirst")
	check(is_equal_approx(ex.apply_damage(10.0, &"bite"), 6.0), "explorer: damage ×0.6")
	var wo := _make(&"whiteout")
	var sv := _make(&"survivor")
	wo._simulate_metabolism(10.0)
	sv._simulate_metabolism(10.0)
	check(wo.food < sv.food, "whiteout: faster metabolism")
	wo.env_felt_temp = -10.0
	sv.env_felt_temp = -10.0
	_run(wo, 60.0)
	_run(sv, 60.0)
	check(wo.warmth < sv.warmth, "whiteout: harsher cold")
	for n in [ex, wo, sv]:
		n.queue_free()


func _consumption() -> void:
	var v := _make()
	v.food = 40.0
	v.water = 40.0
	check(v.consume(&"_t_ration"), "consume a ration bar")
	check(absf(v.food - 52.5) < 0.01, "250 kcal = +12.5 food (%.2f)" % v.food)
	check(absf(v.water - 38.0) < 0.01, "dry food costs a little water")
	v.warmth = 50.0
	v.consume(&"_t_tea")
	check(v.water > 60.0 and v.warmth > 60.0 and v.has_effect(&"warmed_up"), "hot tea: water + warmth + warmed_up")
	check(not v.consume(&"_does_not_exist"), "unknown item consumes nothing")
	v.food = 95.0
	v.water = 90.0
	v.simulate(0.1)
	check(v.has_effect(&"well_fed"), "well_fed when food ≥ 80")
	v.queue_free()


func _persistence() -> void:
	var v := _make()
	v.health = 61.0
	v.food = 33.0
	v.water = 44.0
	v.warmth = 55.0
	v.add_effect(&"wet", 120.0, 0.6)
	v.add_effect(&"frostbite", INF, 0.5)
	var d: Variant = JSON.parse_string(JSON.stringify(v.save_state()))
	var w := _make()
	w.load_state(d)
	check(is_equal_approx(w.health, 61.0) and is_equal_approx(w.food, 33.0) and is_equal_approx(w.water, 44.0), "vitals roundtrip")
	check(w.has_effect(&"wet") and absf(w.get_effect_strength(&"wet") - 0.6) < 0.001, "timed effect roundtrip")
	check(w.has_effect(&"frostbite") and is_inf(float(w.effects[&"frostbite"]["time"])), "indefinite effect roundtrip")
	v.queue_free()
	w.queue_free()

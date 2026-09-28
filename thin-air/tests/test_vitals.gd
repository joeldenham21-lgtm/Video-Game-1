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
	await _night_one()
	_items_schema()
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
	# Kestrel Station (col, 2,950 m) is the Act 5 hub: walking about for a whole game day must not be fatal,
	# while the summit (3,452 m) without bottled oxygen is (regression: the col used to kill in ~13 minutes).
	var col := _make()
	col.env_altitude = 2951.0
	col.env_exertion = 0.38
	for _i in 12:
		col.food = 100.0; col.water = 100.0       # a fed, watered day: only oxygen is under test
		_run(col, 200.0, 2.0)
	check(not col.dead and col.oxygen > 40.0 and col.health > 99.0, "walking at the col settles above hypoxic (%.1f)" % col.oxygen)
	col.env_exertion = 0.9
	_run(col, 300.0)
	check(col.oxygen < 40.0 and col.health > 99.0, "sprinting at the col: hypoxic but not injured (%.1f)" % col.oxygen)
	var top := _make()
	top.env_altitude = 3452.0
	top.env_exertion = 0.5
	_run(top, 600.0)
	check(top.dead and top.death_cause == &"hypoxia", "summit push without O2 is fatal (%s)" % top.death_cause)
	var top_o2 := _make()
	top_o2.env_altitude = 3452.0
	top_o2.env_exertion = 0.5
	top_o2.env_o2_supply = true
	_run(top_o2, 600.0)
	check(not top_o2.dead and top_o2.oxygen > 95.0, "…and fine with mask + bottle (%.1f)" % top_o2.oxygen)
	col.queue_free(); top.queue_free(); top_o2.queue_free()
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


class _Fire extends Node3D:
	var heat_radius := 4.0
	var heat_celsius := 25.0        # campfire at full blaze (src/items/stations/campfire.gd)
	func is_heat_active() -> bool:
		return true


## Night 1 at the crash site in the starting clothes (field jacket, hiking pants, boots), snowing, 17:18 →
## 08:18, real Climate + terrain: without a fire hypothermia sets in before midnight and kills by dawn; a
## campfire 1.5 m away keeps you warm; Explorer's gentler cold is survivable. (Regression: warmth used to
## level off just above the hypothermia threshold, so night 1 was harmless, and every difficulty ended the
## night at the same warmth.) Also: a dusting of snow must not halve a parka's insulation.
func _night_one() -> void:
	if not TerrainData.is_loaded():
		check(true, "night one skipped (no terrain data)")
		return
	var saved := [Climate.hours, Climate.weather, Climate.day]
	Climate._set_weather_immediate(&"snow")
	Climate.day = 1
	var crash: Vector3 = TerrainData.get_poi(&"crash_site")["position"]
	crash.y = TerrainData.get_height(crash.x, crash.z) + 1.0
	var eq := {&"body": &"field_jacket", &"legs": &"hiking_pants", &"feet": &"boots"}
	var tot := ItemActions.clothing_totals(eq)
	var out := {}
	for case in ["nofire", "fire", "explorer"]:
		var v := _make(&"explorer" if case == "explorer" else &"survivor")
		var fire: _Fire = null
		if case == "fire":
			fire = _Fire.new()
			add_child(fire)
			fire.global_position = crash + Vector3(1.5, 0.0, 0.0)
			fire.add_to_group(&"heat_source")
		Climate._refresh_groups()
		var hps := v._hours_per_second()
		var hypo_at := -1.0
		var min_w := 100.0
		var t := 0.0
		while t < 15.0 / hps and not v.dead:
			Climate.hours = fposmod(17.3 + t * hps, 24.0)
			var wet := v.get_effect_strength(&"wet") if v.has_effect(&"wet") else 0.0
			v.env_air_temp = Climate.get_air_temperature(crash)
			v.env_felt_temp = Climate.felt_temperature(crash, float(tot["insulation"]), wet, float(tot["windproof"]))
			v.env_heat = Climate.get_heat_at(crash)
			v.env_insulation = float(tot["insulation"])
			v.env_waterproof = float(tot["waterproof"])
			v.env_precipitation = Climate.precipitation
			v.env_exertion = 0.1
			v.food = 80.0; v.water = 80.0
			v.simulate(2.0)
			t += 2.0
			min_w = minf(min_w, v.warmth)
			if hypo_at < 0.0 and v.warmth < 15.0:
				hypo_at = Climate.hours
		out[case] = [v.dead, v.health, min_w, hypo_at]
		if fire:
			fire.queue_free()
		v.queue_free()
		await get_tree().process_frame
	Climate._refresh_groups()
	var nf: Array = out["nofire"]
	check(nf[0] or nf[1] < 40.0, "night 1, snow, no fire: deadly by dawn (dead %s, hp %.0f)" % [nf[0], nf[1]])
	check(nf[3] > 20.0 or (nf[3] >= 0.0 and nf[3] < 1.0), "…but hypothermia only sets in after dark, leaving time to make fire (%.1f h)" % nf[3])
	var f: Array = out["fire"]
	check(not f[0] and f[1] > 99.0 and f[2] > 60.0, "night 1 by a campfire: warm all night (min warmth %.0f)" % f[2])
	var ex: Array = out["explorer"]
	check(not ex[0] and ex[2] > 30.0, "Explorer: the same night without fire is cold but survivable (min warmth %.0f)" % ex[2])
	var damp := Climate.felt_temperature(crash, 22.5, 0.1, 0.8)
	var soaked := Climate.felt_temperature(crash, 22.5, 1.0, 0.8)
	var dry := Climate.felt_temperature(crash, 22.5, 0.0, 0.8)
	check(dry - damp < 2.5 and damp - soaked > 10.0, "wetness is graded: damp %.1f, soaked %.1f, dry %.1f °C" % [damp, soaked, dry])
	check(is_equal_approx(Climate.get_felt_temperature(crash, 22.5, true, 0.8), soaked), "get_felt_temperature(wet=true) = fully soaked")
	Climate.hours = saved[0]
	Climate._set_weather_immediate(saved[1])
	Climate.day = saved[2]


func _consumption() -> void:
	var v := _make()
	v.food = 40.0
	v.water = 40.0
	check(v.consume(&"_t_ration"), "consume a ration bar")
	var kcal_pt := float(Vitals.TUNING[&"kcal_per_food_point"])
	check(absf(v.food - (40.0 + 250.0 / kcal_pt)) < 0.01, "250 kcal = +%.1f food without an explicit food value (%.2f)" % [250.0 / kcal_pt, v.food])
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


## Vitals.consume() against the real data/items.json food / drink / medical blocks.
func _items_schema() -> void:
	var v := _make()
	v.food = 30.0
	v.water = 30.0
	v.warmth = 50.0
	var mc: Dictionary = ItemDB.get_item(&"meat_cooked").get("food", {})
	check(v.consume(&"meat_cooked") and is_equal_approx(v.food, 30.0 + float(mc.get("food", 0.0))),
		"cooked meat adds its items.json food points (%.1f)" % v.food)
	check(v.warmth > 50.0 and v.has_effect(&"warmed_up"), "hot food warms you (items.json warmth %s)" % str(mc.get("warmth")))
	var tea: Dictionary = ItemDB.get_item(&"pine_tea").get("food", {})
	var w0 := v.water
	v.consume(&"pine_tea")
	check(is_equal_approx(v.water, minf(w0 + float(tea.get("water", 0.0)), 100.0)), "pine tea adds its water (%.1f)" % v.water)
	# raw_risk decides illness: 0 never, 1 always.
	ItemDB.items[&"_t_safe_raw"] = {"id": &"_t_safe_raw", "category": "food", "food": {"calories": 10, "raw": true, "raw_risk": 0.0}}
	ItemDB.items[&"_t_bad_raw"] = {"id": &"_t_bad_raw", "category": "food", "food": {"calories": 10, "raw": true, "raw_risk": 1.0}}
	for _i in 20:
		v.consume(&"_t_safe_raw")
	check(not v.has_effect(&"sick"), "raw_risk 0: never sick")
	v.consume(&"_t_bad_raw")
	check(v.has_effect(&"sick"), "raw_risk 1: sick")
	ItemDB.items.erase(&"_t_safe_raw")
	ItemDB.items.erase(&"_t_bad_raw")
	# Medical blocks: health, stops, warmth, effect + duration_minutes (game minutes).
	var m := _make()
	m.health = 40.0
	m.add_effect(&"bleeding", 200.0, 1.0)
	var fa: Dictionary = ItemDB.get_item(&"first_aid_kit").get("medical", {})
	check(m.consume(&"first_aid_kit") and is_equal_approx(m.health, 40.0 + float(fa.get("health", 0.0))) and not m.has_effect(&"bleeding"),
		"first aid kit: items.json health + stops bleeding (%.1f)" % m.health)
	m.add_effect(&"sprain", 300.0, 1.0)
	var slow := m.movement_multiplier()
	check(m.consume(&"painkillers") and m.has_effect(&"painkiller") and m.movement_multiplier() > slow,
		"painkillers: painkiller effect eases a sprain (%.2f → %.2f)" % [slow, m.movement_multiplier()])
	check(m.consume(&"splint") and not m.has_effect(&"sprain"), "splint stops a sprain")
	m.warmth = 40.0
	m.consume(&"emergency_blanket")
	var eb: Dictionary = ItemDB.get_item(&"emergency_blanket").get("medical", {})
	var secs := Climate.game_minutes_to_seconds(float(eb.get("duration_minutes", 0.0)))
	check(m.warmth > 55.0 and m.has_effect(&"warmed_up") and float(m.effects[&"warmed_up"]["time"]) >= secs - 0.01,
		"emergency blanket: warmth + warmed_up for its duration_minutes (%.0f s)" % secs)
	for n in [v, m]:
		n.queue_free()


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

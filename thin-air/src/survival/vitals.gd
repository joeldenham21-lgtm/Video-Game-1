class_name Vitals
extends Node
## Survival meters + status effects (DESIGN §4, CONTRACT §4). Lives as node "Vitals" under the Player.
##
## The Player writes the `env_*` inputs every physics tick (felt temperature, altitude, exertion…);
## `simulate(delta, time_scale)` integrates everything. Tests set `env_*` directly and call `simulate()`.
## Meters are 0..100. Metabolic rates are defined per in-game hour so sleeping (Climate.time_scale > 1)
## costs food/water realistically; stamina/oxygen/bleeding run on real seconds.

signal died(cause: StringName)
signal damaged(amount: float, type: StringName)

## All tunables. Rates: "/h" = per in-game hour, "/s" = per real second.
const TUNING := {
	# Metabolism — ~2.5 in-game days to starve, ~1.5 to dehydrate at typical activity (survivor).
	&"food_per_hour": 1.25,
	&"water_per_hour": 2.05,
	&"exertion_food_mult": 1.6,        # multiplier added at full exertion
	&"exertion_water_mult": 1.9,
	&"cold_food_mult": 0.6,            # shivering burns calories when warmth < 50
	&"altitude_water_mult": 0.45,      # dry thin air above 2,000 m
	&"kcal_per_food_point": 25.0,      # 100 food = 2,500 kcal (items.json "food" = calories / 25)
	&"ml_per_water_point": 25.0,       # 100 water = 2.5 L (used when an item gives water in mL)
	# Warmth: drifts toward a target implied by felt temperature.
	&"comfort_c": 20.0,                # felt °C at which warmth target = 100
	&"freezing_c": -20.0,              # felt °C at which warmth target = 0
	&"cooling_rate": 0.0055,           # fraction of the gap closed per second when cooling
	&"warming_rate": 0.016,            # … when warming
	&"wet_cooling_mult": 2.1,
	&"immersion_cooling_mult": 1.3,
	&"warmed_up_cooling_mult": 0.55,
	&"hypothermia_threshold": 15.0,
	&"hypothermia_damage": 0.4,        # hp/s at warmth 0
	&"frostbite_felt_c": -15.0,
	&"frostbite_exposure_s": 90.0,
	&"frostbite_max_health_loss": 25.0,
	&"frostbite_recover_warmth": 60.0,
	# Oxygen (SpO2 proxy).
	&"o2_ceiling": 2800.0,             # m — above this oxygen drains
	&"o2_drain_per_km": 0.42,          # /s at rest per 1,000 m above the ceiling… (scaled by exertion)
	&"o2_exertion_mult": 3.0,
	&"o2_recover": 1.6,                # /s below the ceiling
	&"o2_mask_restore": 2.4,           # /s with mask + bottle
	&"hypoxic_threshold": 40.0,
	&"hypoxia_damage": 0.7,            # hp/s below 15
	&"blackout_damage": 2.0,           # hp/s at 0
	# Stamina.
	&"stamina_regen": 17.0,            # /s idle
	&"stamina_regen_moving": 9.0,      # /s while jogging
	&"stamina_regen_delay": 0.9,       # s after spending stamina
	&"exhausted_recover": 30.0,        # stamina needed to shake off "exhausted"
	# Health.
	&"regen_per_hour": 2.0,            # natural healing when fed, watered, warm
	&"regen_sleep_per_hour": 6.0,
	&"starve_damage": 0.05,            # hp/s at food 0 (game-time scaled)
	&"thirst_damage": 0.1,
	&"bleed_damage": 0.35,             # hp/s at strength 1
	&"drown_breath_s": 28.0,
	&"drown_damage": 7.0,
	# Status effects.
	&"wet_duration": 480.0,            # s of drying left after full soak (fire ×6, shelter ×2 faster)
	&"sprain_duration": 360.0,
	&"bleed_duration": 240.0,
	&"sick_duration": 720.0,
	&"warmed_up_duration": 300.0,
	&"rested_duration": 1500.0,
	&"unsafe_water_sick_chance": 0.35,   # fallbacks when an item has no "raw_risk"
	&"raw_food_sick_chance": 0.3,
	&"painkiller_sprain_relief": 0.5,    # fraction of the sprain slow-down painkillers mask
	&"healing_regen_mult": 2.0,          # "healing" effect (herbal poultice) speeds natural regeneration
}

## Difficulty scaling (DESIGN §4: Explorer = no hunger/thirst, gentler cold; Whiteout = harsh).
const DIFFICULTY := {
	&"explorer": {&"metabolism": 0.0, &"cold": 0.6, &"damage": 0.6, &"o2": 0.8, &"stamina_regen": 1.15},
	&"survivor": {&"metabolism": 1.0, &"cold": 1.0, &"damage": 1.0, &"o2": 1.0, &"stamina_regen": 1.0},
	&"whiteout": {&"metabolism": 1.35, &"cold": 1.3, &"damage": 1.25, &"o2": 1.25, &"stamina_regen": 0.85},
}

## Condition-driven effects (on while the condition holds) vs timed ones (count down).
const CONDITION_EFFECTS: Array[StringName] = [&"hypoxic", &"hypothermia", &"well_fed", &"exhausted", &"starving", &"dehydrated"]

var health := 100.0
var food := 85.0
var water := 80.0
var warmth := 100.0
var oxygen := 100.0
var stamina := 100.0
var max_health := 100.0
var body_temp := 37.0
## id -> {"time": float (s remaining, INF = until cleared), "strength": float}
var effects: Dictionary = {}
var difficulty: StringName = &"survivor"
var dead := false
var death_cause: StringName = &""
var last_damage_type: StringName = &""
## Automatic simulation from _physics_process (only while Game is playing). Tests turn this off.
var auto_simulate := true

# ---- Environment inputs written by the Player ----
var env_altitude := 1450.0
var env_air_temp := 5.0            # °C
var env_felt_temp := 5.0           # °C (Climate.get_felt_temperature incl. insulation + wet)
var env_heat := 0.0                # °C from nearby fires (Climate.get_heat_at)
var env_shelter := 0.0             # 0..1
var env_insulation := 0.0          # °C equivalent of worn clothing
var env_waterproof := 0.0          # 0..1
var env_precipitation := 0.0       # 0..1 (falling snow wets you unless waterproof)
var env_exertion := 0.0            # 0..1 current physical effort
var env_immersion := 0.0           # 0..1 how much of the body is in water
var env_head_underwater := false
var env_o2_supply := false         # mask + bottle feeding oxygen
var env_sleeping := false
var env_moving := false

var frostbite_exposure := 0.0
var underwater_time := 0.0
var _stamina_idle := 0.0
var _warm_time := 0.0
var _frostbite_loss := 0.0
var _rng := RandomNumberGenerator.new()
var _expired: Array[StringName] = []


func _ready() -> void:
	_rng.seed = 0x7A11
	difficulty = StringName(Settings.get_value(&"difficulty", &"survivor"))
	if Game.difficulty != &"":
		difficulty = Game.difficulty
	if not Events.settings_changed.is_connected(_on_settings_changed):
		Events.settings_changed.connect(_on_settings_changed)


func _on_settings_changed() -> void:
	if Game.state != Game.State.PLAYING:
		difficulty = StringName(Settings.get_value(&"difficulty", difficulty))


func _physics_process(delta: float) -> void:
	if not auto_simulate or dead:
		return
	if Game.state != Game.State.PLAYING:
		return
	var ts := 1.0
	if &"time_scale" in Climate:
		ts = maxf(float(Climate.time_scale), 0.0)
	simulate(delta, ts)


# ------------------------------------------------------------------------------------------------
# Public API (CONTRACT §4)

func add_effect(id: StringName, duration: float, strength := 1.0) -> void:
	var was := effects.has(id)
	if was:
		var e: Dictionary = effects[id]
		e["time"] = maxf(float(e["time"]), duration)
		e["strength"] = maxf(float(e["strength"]), strength)
	else:
		effects[id] = {"time": duration, "strength": strength}
		Events.status_effect_changed.emit(id, true)


func remove_effect(id: StringName) -> void:
	if effects.erase(id):
		Events.status_effect_changed.emit(id, false)


func has_effect(id: StringName) -> bool:
	return effects.has(id)


func get_effect_strength(id: StringName) -> float:
	var e: Dictionary = effects.get(id, {})
	return float(e.get("strength", 0.0))


func is_dead() -> bool:
	return dead


## Spends `amount` stamina if available. Returns false (spending nothing) when too tired.
func use_stamina(amount: float) -> bool:
	if amount <= 0.0:
		return true
	if stamina < amount or has_effect(&"exhausted"):
		return false
	stamina -= amount
	_stamina_idle = 0.0
	if stamina <= 0.01:
		stamina = 0.0
		add_effect(&"exhausted", INF)
	return true


## Continuous drain (sprinting, climbing, swimming). Returns false once empty.
func drain_stamina(amount: float) -> bool:
	_stamina_idle = 0.0
	stamina = maxf(stamina - amount, 0.0)
	if stamina <= 0.0:
		add_effect(&"exhausted", INF)
		return false
	return true


func can_exert() -> bool:
	return stamina > 1.0 and not has_effect(&"exhausted")


## Applies damage of a CONTRACT damage type. Difficulty-scaled. Returns the damage actually dealt.
func apply_damage(amount: float, type: StringName) -> float:
	if dead or amount <= 0.0:
		return 0.0
	var dmg := amount * _diff(&"damage")
	health = maxf(health - dmg, 0.0)
	last_damage_type = type
	damaged.emit(dmg, type)
	if health <= 0.0:
		die(type)
	return dmg


func heal(amount: float) -> void:
	if dead:
		return
	health = minf(health + amount, max_health)


func die(cause: StringName) -> void:
	if dead:
		return
	dead = true
	health = 0.0
	death_cause = cause
	died.emit(cause)
	Events.player_died.emit(cause)


func revive(full := true) -> void:
	dead = false
	death_cause = &""
	if full:
		reset()


func reset() -> void:
	health = 100.0; max_health = 100.0; food = 85.0; water = 80.0; warmth = 100.0
	oxygen = 100.0; stamina = 100.0; body_temp = 37.0
	frostbite_exposure = 0.0; underwater_time = 0.0; _frostbite_loss = 0.0
	for id in effects.keys():
		remove_effect(id)


## Applies an item's food/drink/medical values (items.json, CONTRACT §6):
##   food:    {calories, food (points; else calories / kcal_per_food_point), water, warmth, health, stamina,
##             raw, raw_risk (chance of getting sick)}
##   medical: {health, stops: [effect ids], warmth, effect, duration_minutes (game minutes)}
## Returns false if the item has nothing to consume. Emits Events.item_consumed.
func consume(item_id: StringName) -> bool:
	var def: Dictionary = ItemDB.get_item(item_id)
	var f: Dictionary = def.get("food", {})
	var med: Dictionary = def.get("medical", {})
	var any := false
	var metab := _diff(&"metabolism")
	if not f.is_empty():
		any = true
		if metab > 0.0:
			var pts := float(f["food"]) if f.has("food") else float(f.get("calories", 0.0)) / float(TUNING[&"kcal_per_food_point"])
			food = clampf(food + pts, 0.0, 100.0)
			var w := float(f.get("water", 0.0))
			if absf(w) > 100.0:
				w /= float(TUNING[&"ml_per_water_point"])
			water = clampf(water + w, 0.0, 100.0)
		_add_warmth(float(f.get("warmth", 0.0)))
		health = clampf(health + float(f.get("health", 0.0)), 0.0, max_health)
		stamina = clampf(stamina + float(f.get("stamina", 0.0)), 0.0, 100.0)
		var sick_chance := 0.0
		if f.has("raw_risk"):
			sick_chance = float(f["raw_risk"])
		elif bool(f.get("raw", false)):
			sick_chance = float(TUNING[&"raw_food_sick_chance"])
		if bool(f.get("unsafe", false)) or (item_id == &"water_unsafe" and not f.has("raw_risk")):
			sick_chance = maxf(sick_chance, float(TUNING[&"unsafe_water_sick_chance"]))
		if sick_chance > 0.0 and _rng.randf() < sick_chance:
			add_effect(&"sick", float(TUNING[&"sick_duration"]))
	if not med.is_empty():
		any = true
		heal(float(med.get("health", med.get("heal", 0.0))))
		for c in med.get("stops", med.get("cures", [])):
			remove_effect(StringName(c))
		_add_warmth(float(med.get("warmth", 0.0)))
		var fx := StringName(med.get("effect", ""))
		if fx != &"":
			var secs := _game_minutes_to_seconds(float(med.get("duration_minutes", 60.0)))
			add_effect(fx, secs)
			if fx == &"painkiller" and has_effect(&"sprain"):
				var sp: Dictionary = effects[&"sprain"]
				sp["time"] = float(sp["time"]) * 0.75      # resting the joint without the pain
	else:
		# Items without a "medical" block (test stand-ins, older data): the well-known basics.
		var heal_amt := 0.0
		var cures: Array = []
		match item_id:
			&"bandage":
				cures = ["bleeding"]; heal_amt = 5.0
			&"first_aid_kit":
				cures = ["bleeding", "infection"]; heal_amt = 40.0
			&"splint":
				cures = ["sprain"]
			&"painkillers":
				heal_amt = 4.0
				add_effect(&"painkiller", _game_minutes_to_seconds(240.0))
			&"herbal_poultice":
				cures = ["infection"]; heal_amt = 12.0
		if heal_amt > 0.0 or not cures.is_empty():
			any = true
			heal(heal_amt)
			for c in cures:
				remove_effect(StringName(c))
	if any:
		Events.item_consumed.emit(item_id)
	return any


## Hot food/drink or a blanket: warmth now plus a "warmed up" spell; cold food (snow) takes warmth.
func _add_warmth(hot: float) -> void:
	if hot > 0.0:
		warmth = minf(warmth + hot, 100.0)
		add_effect(&"warmed_up", float(TUNING[&"warmed_up_duration"]) * clampf(hot / 15.0, 0.4, 1.5))
	elif hot < 0.0:
		warmth = maxf(warmth + hot, 0.0)


## Effect durations run on (time-scaled) seconds; item data gives game minutes.
func _game_minutes_to_seconds(minutes: float) -> float:
	if Climate.has_method(&"game_minutes_to_seconds"):
		return float(Climate.game_minutes_to_seconds(minutes))
	return (minutes / 60.0) / _hours_per_second()


# ------------------------------------------------------------------------------------------------
# Simulation

## Advances the simulation. `time_scale` is Climate.time_scale (sleeping fast-forwards metabolism).
func simulate(delta: float, time_scale := 1.0) -> void:
	if dead or delta <= 0.0:
		return
	var gdt := delta * time_scale                       # game-time seconds
	var hours := gdt * _hours_per_second()
	_simulate_metabolism(hours)
	_simulate_warmth(gdt, delta)
	_simulate_oxygen(delta)
	_simulate_stamina(delta)
	_simulate_effects(gdt, delta)
	_simulate_health(gdt, delta, hours)
	body_temp = 37.0 - (1.0 - warmth / 100.0) * 5.5
	_update_conditions()


func _hours_per_second() -> float:
	var day_min := 40.0
	if &"day_length_minutes" in Climate:
		day_min = maxf(float(Climate.day_length_minutes), 1.0)
	return 24.0 / (day_min * 60.0)


func _diff(key: StringName) -> float:
	var d: Dictionary = DIFFICULTY.get(difficulty, DIFFICULTY[&"survivor"])
	return float(d[key])


func _simulate_metabolism(hours: float) -> void:
	var metab := _diff(&"metabolism")
	if metab <= 0.0:
		food = 100.0
		water = 100.0
		return
	var ex := clampf(env_exertion, 0.0, 1.0)
	var fm := 1.0 + float(TUNING[&"exertion_food_mult"]) * ex
	if warmth < 50.0:
		fm += float(TUNING[&"cold_food_mult"]) * (50.0 - warmth) / 50.0
	if env_altitude > 2500.0:
		fm += 0.2
	var wm := 1.0 + float(TUNING[&"exertion_water_mult"]) * ex
	if env_altitude > 2000.0:
		wm += float(TUNING[&"altitude_water_mult"]) * clampf((env_altitude - 2000.0) / 1450.0, 0.0, 1.0)
	if has_effect(&"sick"):
		fm *= 1.6; wm *= 1.8
	if env_sleeping:
		fm *= 0.7; wm *= 0.6
	food = maxf(food - float(TUNING[&"food_per_hour"]) * fm * metab * hours, 0.0)
	water = maxf(water - float(TUNING[&"water_per_hour"]) * wm * metab * hours, 0.0)


## Warmth target (0..100, may go negative to drive a fast fall) for an effective felt temperature.
static func warmth_target(felt_c: float) -> float:
	var lo := float(TUNING[&"freezing_c"])
	var hi := float(TUNING[&"comfort_c"])
	return (felt_c - lo) / (hi - lo) * 100.0


## Effective felt temperature: Climate's felt value, never colder than the fire-warmed air (covers Climate
## implementations that do or don't fold fire heat into felt temperature, without double counting).
func effective_felt_temp() -> float:
	var felt := env_felt_temp
	if env_heat > 0.0:
		felt = maxf(felt, env_air_temp + env_insulation + env_heat)
	if env_immersion > 0.05:
		felt = lerpf(felt, PlayerMotion.immersion_temperature(), clampf(env_immersion, 0.0, 1.0))
	return felt


func _simulate_warmth(gdt: float, _rdt: float) -> void:
	var felt := effective_felt_temp()
	var target := warmth_target(felt)
	var cold_mult := _diff(&"cold")
	var rate: float
	if target < warmth:
		rate = float(TUNING[&"cooling_rate"]) * cold_mult
		if has_effect(&"wet"):
			rate *= float(TUNING[&"wet_cooling_mult"]) * get_effect_strength(&"wet") + (1.0 - get_effect_strength(&"wet"))
		if env_immersion > 0.05:
			rate *= lerpf(1.0, float(TUNING[&"immersion_cooling_mult"]), env_immersion)
		if has_effect(&"warmed_up"):
			rate *= float(TUNING[&"warmed_up_cooling_mult"])
		if env_exertion > 0.3:
			rate *= lerpf(1.0, 0.6, (env_exertion - 0.3) / 0.7)   # working keeps you warm
	else:
		rate = float(TUNING[&"warming_rate"])
		if env_heat > 2.0:
			rate *= 1.6
	var gap := target - warmth
	var step := gap * (1.0 - exp(-rate * gdt))
	warmth = clampf(warmth + step, 0.0, 100.0)
	# Being toasty by a fire gives "warmed up".
	if warmth > 92.0 and env_heat > 3.0:
		add_effect(&"warmed_up", 180.0)
	# Frostbite: prolonged extreme cold on extremities.
	var fb_felt := float(TUNING[&"frostbite_felt_c"])
	if felt < fb_felt and warmth < 35.0:
		frostbite_exposure += gdt * (1.0 + (fb_felt - felt) / 15.0)
		if frostbite_exposure > float(TUNING[&"frostbite_exposure_s"]):
			var strength := clampf((frostbite_exposure - float(TUNING[&"frostbite_exposure_s"])) / 240.0, 0.2, 1.0)
			add_effect(&"frostbite", INF, strength)
			effects[&"frostbite"]["strength"] = strength
	else:
		frostbite_exposure = maxf(frostbite_exposure - gdt * 0.5, 0.0)
	if has_effect(&"frostbite"):
		var target_loss := float(TUNING[&"frostbite_max_health_loss"]) * get_effect_strength(&"frostbite")
		_frostbite_loss = move_toward(_frostbite_loss, target_loss, gdt * 0.2)
		if warmth > float(TUNING[&"frostbite_recover_warmth"]):
			_warm_time += gdt
			if _warm_time > 60.0:
				remove_effect(&"frostbite")
				frostbite_exposure = 0.0
		else:
			_warm_time = 0.0
	else:
		_frostbite_loss = move_toward(_frostbite_loss, 0.0, gdt * 0.1)
	max_health = 100.0 - _frostbite_loss
	health = minf(health, max_health)


func _simulate_oxygen(dt: float) -> void:
	var ceiling := float(TUNING[&"o2_ceiling"])
	if env_head_underwater:
		return   # breath-hold handled in _simulate_health
	if env_o2_supply:
		oxygen = minf(oxygen + float(TUNING[&"o2_mask_restore"]) * dt, 100.0)
		return
	if env_altitude > ceiling:
		var km := (env_altitude - ceiling) / 1000.0
		var drain := float(TUNING[&"o2_drain_per_km"]) * km * (1.0 + float(TUNING[&"o2_exertion_mult"]) * env_exertion)
		# Resting lets SpO2 recover a little even up high (acclimatisation, slow breathing).
		if env_exertion < 0.05 and oxygen < 55.0:
			drain -= 0.25
		oxygen = clampf(oxygen - drain * _diff(&"o2") * dt, 0.0, 100.0)
	else:
		var rec := float(TUNING[&"o2_recover"]) * (1.4 if env_exertion < 0.1 else 1.0)
		oxygen = minf(oxygen + rec * dt, 100.0)


func _simulate_stamina(dt: float) -> void:
	_stamina_idle += dt
	if _stamina_idle < float(TUNING[&"stamina_regen_delay"]):
		return
	var regen := float(TUNING[&"stamina_regen_moving"]) if env_moving else float(TUNING[&"stamina_regen"])
	regen *= stamina_regen_multiplier()
	stamina = minf(stamina + regen * dt, 100.0)
	if has_effect(&"exhausted") and stamina >= float(TUNING[&"exhausted_recover"]):
		remove_effect(&"exhausted")


## Combined stamina regeneration multiplier from hunger, thirst, cold, altitude, sickness, rest.
func stamina_regen_multiplier() -> float:
	var m := _diff(&"stamina_regen")
	if _diff(&"metabolism") > 0.0:
		if food <= 0.0:
			return 0.0                         # DESIGN: no stamina regen when starving
		if food < 15.0:
			m *= 0.5
		if water < 15.0:
			m *= 0.6
	if warmth < 30.0:
		m *= lerpf(0.55, 1.0, warmth / 30.0)
	if env_altitude > 2000.0:
		m *= lerpf(1.0, 0.62, clampf((env_altitude - 2000.0) / 1450.0, 0.0, 1.0))
	if oxygen < float(TUNING[&"hypoxic_threshold"]):
		m *= 0.5
	if has_effect(&"sick"):
		m *= 0.6
	if has_effect(&"rested"):
		m *= 1.25
	if has_effect(&"well_fed"):
		m *= 1.1
	if env_immersion > 0.5:
		m *= 0.35
	return m


func _simulate_effects(gdt: float, rdt: float) -> void:
	# Wetness: soaking from water or falling snow (unless waterproof); drying by fire/shelter/time.
	if env_immersion > 0.05:
		add_effect(&"wet", float(TUNING[&"wet_duration"]), 1.0)
		effects[&"wet"]["time"] = float(TUNING[&"wet_duration"])
		effects[&"wet"]["strength"] = 1.0
	elif env_precipitation > 0.2 and env_shelter < 0.5:
		var soak := env_precipitation * (1.0 - env_waterproof) * gdt * 0.004
		if soak > 0.0:
			if not has_effect(&"wet"):
				add_effect(&"wet", 60.0, 0.1)
			var w: Dictionary = effects[&"wet"]
			w["strength"] = minf(float(w["strength"]) + soak, 1.0)
			w["time"] = maxf(float(w["time"]), float(w["strength"]) * float(TUNING[&"wet_duration"]))
	for id: StringName in effects:
		if CONDITION_EFFECTS.has(id):
			continue
		var e: Dictionary = effects[id]
		var t := float(e["time"])
		if is_inf(t):
			continue
		var speed := 1.0
		var dt := gdt
		if id == &"wet":
			if env_immersion > 0.05:
				continue
			speed = 1.0 + (5.0 if env_heat > 2.0 else 0.0) + (1.0 if env_shelter > 0.5 else 0.0)
			e["strength"] = clampf(t / float(TUNING[&"wet_duration"]), 0.05, float(e["strength"]))
		elif id == &"bleeding":
			dt = rdt
		t -= dt * speed
		e["time"] = t
		if t <= 0.0:
			_expired.append(id)
	if not _expired.is_empty():
		for id in _expired:
			remove_effect(id)
		_expired.clear()


func _simulate_health(gdt: float, rdt: float, hours: float) -> void:
	var metab := _diff(&"metabolism")
	# Starvation / dehydration.
	if metab > 0.0:
		if food <= 0.0:
			apply_damage(float(TUNING[&"starve_damage"]) * gdt, &"hunger")
		if water <= 0.0:
			apply_damage(float(TUNING[&"thirst_damage"]) * gdt, &"thirst")
	# Hypothermia.
	var ht := float(TUNING[&"hypothermia_threshold"])
	if warmth < ht:
		apply_damage(float(TUNING[&"hypothermia_damage"]) * (ht - warmth) / ht * gdt, &"cold")
	# Hypoxia.
	if oxygen <= 0.0:
		apply_damage(float(TUNING[&"blackout_damage"]) * rdt, &"hypoxia")
	elif oxygen < 15.0:
		apply_damage(float(TUNING[&"hypoxia_damage"]) * (15.0 - oxygen) / 15.0 * rdt, &"hypoxia")
	# Bleeding.
	if has_effect(&"bleeding"):
		apply_damage(float(TUNING[&"bleed_damage"]) * get_effect_strength(&"bleeding") * rdt, &"bleed")
	# Drowning (breath hold).
	if env_head_underwater:
		underwater_time += rdt
		oxygen = maxf(oxygen - 100.0 / float(TUNING[&"drown_breath_s"]) * rdt, 0.0)
		if underwater_time > float(TUNING[&"drown_breath_s"]):
			apply_damage(float(TUNING[&"drown_damage"]) * rdt, &"drown")
	else:
		underwater_time = 0.0
	if dead:
		return
	# Natural regeneration when the body's needs are met.
	var fed := metab <= 0.0 or (food > 35.0 and water > 35.0)
	if fed and warmth > 40.0 and oxygen > 55.0 and not has_effect(&"bleeding") and health < max_health:
		var per_h := float(TUNING[&"regen_sleep_per_hour"]) if env_sleeping else float(TUNING[&"regen_per_hour"])
		if has_effect(&"well_fed"):
			per_h *= 2.0
		if has_effect(&"rested"):
			per_h *= 1.5
		if has_effect(&"sick"):
			per_h *= 0.3
		if has_effect(&"healing"):
			per_h *= float(TUNING[&"healing_regen_mult"])
		heal(per_h * hours)


func _update_conditions() -> void:
	_set_condition(&"hypoxic", oxygen < float(TUNING[&"hypoxic_threshold"]))
	_set_condition(&"hypothermia", warmth < float(TUNING[&"hypothermia_threshold"]))
	var metab := _diff(&"metabolism") > 0.0
	_set_condition(&"well_fed", food >= 80.0 and (water >= 65.0 or not metab))
	_set_condition(&"starving", metab and food <= 0.0)
	_set_condition(&"dehydrated", metab and water <= 0.0)


func _set_condition(id: StringName, on: bool) -> void:
	if on == effects.has(id):
		return
	if on:
		effects[id] = {"time": INF, "strength": 1.0}
		Events.status_effect_changed.emit(id, true)
	else:
		remove_effect(id)


## Called by the sleep system (Events.sleep_ended) via the Player.
func on_slept(hours: float) -> void:
	if hours >= 2.0:
		add_effect(&"rested", float(TUNING[&"rested_duration"]) * clampf(hours / 7.0, 0.3, 1.2))
	stamina = 100.0


## Movement speed multiplier from status effects (sprain, hypothermia, exhaustion, frostbite).
func movement_multiplier() -> float:
	var m := 1.0
	if has_effect(&"sprain"):
		var slow := 1.0 - lerpf(0.85, 0.62, get_effect_strength(&"sprain"))
		if has_effect(&"painkiller"):
			slow *= 1.0 - float(TUNING[&"painkiller_sprain_relief"])
		m *= 1.0 - slow
	if warmth < float(TUNING[&"hypothermia_threshold"]):
		m *= lerpf(0.75, 1.0, warmth / float(TUNING[&"hypothermia_threshold"]))
	if oxygen < 15.0:
		m *= 0.8
	if has_effect(&"frostbite"):
		m *= 0.95
	return m


func can_sprint() -> bool:
	return can_exert() and not has_effect(&"sprain") and oxygen > 10.0


# ------------------------------------------------------------------------------------------------
# Persistence (called by the Player's save_state/load_state)

func save_state() -> Dictionary:
	var fx := {}
	for id: StringName in effects:
		if CONDITION_EFFECTS.has(id):
			continue
		var e: Dictionary = effects[id]
		var t := float(e["time"])
		fx[String(id)] = [-1.0 if is_inf(t) else t, float(e["strength"])]
	return {"health": health, "food": food, "water": water, "warmth": warmth, "oxygen": oxygen,
		"stamina": stamina, "frostbite_exposure": frostbite_exposure, "frostbite_loss": _frostbite_loss,
		"effects": fx}


func load_state(d: Dictionary) -> void:
	for id in effects.keys():
		remove_effect(id)
	health = float(d.get("health", 100.0)); food = float(d.get("food", 85.0)); water = float(d.get("water", 80.0))
	warmth = float(d.get("warmth", 100.0)); oxygen = float(d.get("oxygen", 100.0))
	stamina = float(d.get("stamina", 100.0))
	frostbite_exposure = float(d.get("frostbite_exposure", 0.0))
	_frostbite_loss = float(d.get("frostbite_loss", 0.0))
	max_health = 100.0 - _frostbite_loss
	var fx: Dictionary = d.get("effects", {})
	for k in fx:
		var a: Array = fx[k]
		var t := float(a[0])
		add_effect(StringName(k), INF if t < 0.0 else t, float(a[1]))
	dead = health <= 0.0
	_update_conditions()

class_name BuildTorchStand
extends BuildObject
## A pitch torch on a pole in a cairn: light (OmniLight3D, buildables.json light_radius) and a little heat
## (group "heat_source") for burn_minutes of game time, then it needs a fresh cloth + resin head. Wildlife
## treats it as fire (group "fire"). Rain and snow on an unsheltered torch shorten its life.

const HEAD := Vector3(0.02, 1.6, 0.01)

var lit := false
var minutes_left := 240.0
var heat_radius := 2.2
var heat_celsius := 0.0
## Keep burning when the game isn't PLAYING (dev scenes).
var always_simulate := false

var _fx: Dictionary = {}
var _light: OmniLight3D
var _loop: AudioStreamPlayer3D
var _last_h := -1.0
var _t := 0.0
var _mobile := false
var _noise := FastNoiseLite.new()


func _ready() -> void:
	model_glb = "camp_torch_stand.glb"
	surface = &"rock"
	super._ready()
	add_to_group(&"heat_source")
	add_to_group(&"fire")
	_mobile = Settings.is_mobile()
	minutes_left = float(ItemDB.get_buildable(&"torch_stand").get("burn_minutes", 240.0))
	_fx = BuildFX.torch_flame(self, HEAD + Vector3(0, 0.04, 0), 1.0, _mobile)
	_light = OmniLight3D.new()
	_light.name = "Light"
	_light.light_color = Color(1.0, 0.58, 0.27)
	_light.omni_range = float(ItemDB.get_buildable(&"torch_stand").get("light_radius", 8.0))
	_light.omni_attenuation = 1.25
	_light.light_energy = 0.0
	_light.shadow_enabled = not _mobile
	_light.shadow_bias = 0.08
	_light.distance_fade_enabled = true
	_light.distance_fade_begin = 45.0
	_light.distance_fade_length = 12.0
	_light.position = HEAD + Vector3(0.0, 0.25, 0.0)
	_light.visible = false
	add_child(_light)
	_noise.seed = get_instance_id() % 991
	_noise.frequency = 3.0
	_apply_lit()


func is_heat_active() -> bool:
	return lit


func set_lit(on: bool, quiet := false) -> void:
	if on and minutes_left <= 0.0:
		return
	if on == lit:
		return
	lit = on
	if not quiet:
		Audio.play_sfx(&"fire_ignite" if on else &"drop", global_position + HEAD, -6.0)
	_apply_lit()


func _apply_lit() -> void:
	heat_celsius = 6.0 if lit else 0.0
	if _fx.has("flames"):
		(_fx["flames"] as GPUParticles3D).emitting = lit
		(_fx["smoke"] as GPUParticles3D).emitting = lit
		(_fx["glow"] as Node3D).visible = lit
	if _light:
		_light.visible = lit
	if lit and _loop == null and is_inside_tree():
		_loop = Audio.play_loop(&"torch_loop", self, -8.0)
		if _loop:
			_loop.position = HEAD
	elif not lit and _loop:
		_loop.stop()
		_loop.queue_free()
		_loop = null


func _process(delta: float) -> void:
	_t += delta
	var r := BuildFX.game_hours_since(_last_h)
	_last_h = r[1]
	if lit and (always_simulate or Game.is_playing()):
		var minutes: float = float(r[0]) * 60.0
		var rate := 1.0
		var shelter := float(Climate.get_shelter_at(global_position + HEAD))
		if Climate.precipitation > 0.3 and shelter < 0.5:
			rate += 1.5 * Climate.precipitation
		minutes_left = maxf(0.0, minutes_left - minutes * rate)
		if minutes_left <= 0.0:
			set_lit(false)
			Game.notify("The torch stand has burnt out.", &"info")
	if lit and _light:
		var f := 0.85 + 0.15 * _noise.get_noise_1d(_t * 6.0) + 0.06 * _noise.get_noise_1d(_t * 23.0)
		_light.light_energy = 1.35 * f * clampf(minutes_left / 20.0, 0.35, 1.0)


func own_prompt(player: Node) -> String:
	if lit:
		return "Put out the torch"
	if minutes_left <= 0.0:
		var inv := ItemActions.inventory_of(player)
		if inv and inv.count(&"cloth") > 0 and inv.count(&"resin") > 0:
			return "Bind a new torch head (cloth, resin)"
		return "Torch burnt out (needs cloth + resin)"
	return "Light the torch stand"


func own_hold_time() -> float:
	return 0.9 if not lit and minutes_left > 0.0 else 0.0


func own_interact(player: Node) -> void:
	var inv := ItemActions.inventory_of(player)
	if lit:
		set_lit(false)
		return
	if minutes_left <= 0.0:
		if inv and inv.count(&"cloth") > 0 and inv.count(&"resin") > 0:
			inv.remove(&"cloth", 1)
			inv.remove(&"resin", 1)
			minutes_left = float(ItemDB.get_buildable(&"torch_stand").get("burn_minutes", 240.0))
			Audio.play_sfx(&"craft", global_position + HEAD, -4.0)
		return
	var res := ItemActions.try_ignite(inv, 1.0 - float(Climate.get_shelter_at(global_position + HEAD)))
	if bool(res.get("ok", false)):
		set_lit(true)
	else:
		Game.notify(String(res.get("text", "It won't catch.")), &"warning")


func save_extra() -> Dictionary:
	return {"lit": lit, "minutes": minutes_left}


func load_extra(d: Dictionary) -> void:
	minutes_left = float(d.get("minutes", minutes_left))
	set_lit(bool(d.get("lit", false)), true)


func collision_shapes() -> Array:
	var c := CylinderShape3D.new()
	c.radius = 0.28
	c.height = 0.45
	var p := CylinderShape3D.new()
	p.radius = 0.05
	p.height = 1.3
	return [[c, Transform3D(Basis.IDENTITY, Vector3(0.0, 0.22, 0.0))], [p, Transform3D(Basis.IDENTITY, Vector3(0.0, 1.05, 0.0))]]

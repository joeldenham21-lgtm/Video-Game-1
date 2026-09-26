class_name BuildSleep
extends CanvasLayer
## Sleeping in a bough bed or a hide bed: pick how long (1–12 h or "until dawn"), the screen fades, the clock
## jumps (Climate.advance_time — weather and snow keep going), metabolism runs for the skipped hours at the
## sleeping rate (Vitals.simulate with env_sleeping: food/water drain, rest, healing; warmth follows the bed,
## the shelter and the fire), Events.sleep_started/sleep_ended bracket it (the Player rests and wakes rested)
## and the game autosaves (Save.save_game). You can't sleep with a predator close or while freezing.
##
## sleep_now() is the synchronous core (used by the dialog and by tests).

const THREAT_RADIUS := 35.0
const FREEZING_WARMTH := 28.0
const FREEZING_FELT_C := -14.0
const SIM_STEPS := 48

static var _open: BuildSleep = null

var bed: Node3D = null
var player: Node = null
var hours := 8
var _panel: PanelContainer
var _hours_label: Label
var _fade: ColorRect
var _busy := false


## "" if the player may sleep here now, else the reason.
static func sleep_problem(p: Node, at: Vector3) -> String:
	if p == null:
		return "No one to sleep"
	var v: Vitals = p.get(&"vitals") if p.get(&"vitals") is Vitals else null
	if v:
		if v.is_dead():
			return "Dead"
		if v.warmth < FREEZING_WARMTH or v.env_felt_temp < FREEZING_FELT_C:
			return "Too cold to sleep. Get warm first."
	var tree := Engine.get_main_loop() as SceneTree
	if tree:
		for c in tree.get_nodes_in_group(&"creature"):
			if not (c is Node3D) or (c as Node3D).global_position.distance_to(at) > THREAT_RADIUS:
				continue
			if is_threat(c):
				return "You can't sleep with danger nearby."
	return ""


static func is_threat(c: Node) -> bool:
	if c.has_method(&"is_dead") and c.call(&"is_dead"):
		return false
	if c.has_method(&"is_threat"):
		return bool(c.call(&"is_threat"))
	var h: Variant = c.get(&"hostile")
	if h != null:
		return bool(h)
	var sp := String(c.get(&"species")) if c.get(&"species") != null else ""
	return sp in ["wolf", "grey_wolf", "bear", "grizzly", "old_grey"]


## Hours from now until 07:30 (the next morning).
static func hours_until_dawn() -> float:
	var h := float(Climate.hours)
	var target := 7.5
	var d := target - h
	if d <= 0.5:
		d += 24.0
	return d


## Sleeps `h` hours right now. quality 0..1 (bough bed 0.6, hide bed 1.0) keeps you warmer and rests better.
## Returns {"hours", "food", "water", "health", "saved"} deltas for feedback / tests.
static func sleep_now(p: Node, h: float, quality := 1.0, autosave := true) -> Dictionary:
	h = clampf(h, 0.5, 16.0)
	var v: Vitals = p.get(&"vitals") if p and p.get(&"vitals") is Vitals else null
	var before := {"food": v.food if v else 0.0, "water": v.water if v else 0.0, "health": v.health if v else 0.0}
	Events.sleep_started.emit(h)
	if v:
		v.env_sleeping = true
	Climate.advance_time(h)
	if v:
		# Bedding and a roof keep the sleeper's felt temperature up; everything else is the player's
		# last sampled climate (fire, shelter, clothing).
		var felt := v.env_felt_temp
		v.env_felt_temp = felt + 4.0 + 6.0 * clampf(quality, 0.0, 1.0)
		var exertion := v.env_exertion
		var moving := v.env_moving
		v.env_exertion = 0.0
		v.env_moving = false
		var hours_per_second := 24.0 / maxf(float(Climate.day_length_minutes) * 60.0, 1.0)
		var game_seconds := h / hours_per_second
		var per_step := game_seconds / float(SIM_STEPS)
		for _i in SIM_STEPS:
			v.simulate(0.25, per_step / 0.25)
		v.env_felt_temp = felt
		v.env_exertion = exertion
		v.env_moving = moving
		if quality < 0.8:
			# a bed of boughs on the ground: you wake stiff and a little chilled
			v.stamina = minf(v.stamina, 70.0 + 30.0 * quality)
	Events.sleep_ended.emit()
	if v:
		v.env_sleeping = false
	var saved := false
	if autosave and Game.world != null and Save.has_method(&"save_game"):
		saved = Save.save_game(0)
	return {"hours": h, "food": (v.food - before["food"]) if v else 0.0, "water": (v.water - before["water"]) if v else 0.0,
		"health": (v.health - before["health"]) if v else 0.0, "saved": saved}


## Opens the sleep dialog for `bed`.
static func open_for(bed_node: Node3D, p: Node) -> void:
	if _open != null and is_instance_valid(_open):
		return
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return
	var s := BuildSleep.new()
	s.bed = bed_node
	s.player = p
	tree.root.add_child(s)


func _ready() -> void:
	_open = self
	layer = 40
	process_mode = Node.PROCESS_MODE_ALWAYS
	hours = clampi(roundi(hours_until_dawn()), 1, 12)
	_build_ui()
	Events.ui_screen_opened.emit(&"sleep")


func _exit_tree() -> void:
	if _open == self:
		_open = null


func _build_ui() -> void:
	_fade = ColorRect.new()
	_fade.color = Color(0, 0, 0, 0)
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_fade)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override(&"panel", InvStyle.panel(InvStyle.BG, 8, InvStyle.LINE, 1, 22))
	center.add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override(&"separation", 14)
	_panel.add_child(v)
	var title := Label.new()
	title.text = "SLEEP"
	title.add_theme_font_override(&"font", InvStyle.caps_font("SemiBold", 3))
	title.add_theme_font_size_override(&"font_size", 22)
	title.add_theme_color_override(&"font_color", InvStyle.TEXT)
	v.add_child(title)
	var sub := Label.new()
	var bname := BuildCatalog.display_name(BuildingRoot.component_of(bed).id) if bed and BuildingRoot.component_of(bed) else "Bed"
	sub.text = "%s · it is %s" % [bname, Climate.get_time_string()]
	sub.add_theme_font_override(&"font", InvStyle.font("Regular"))
	sub.add_theme_font_size_override(&"font_size", 17)
	sub.add_theme_color_override(&"font_color", InvStyle.TEXT_DIM)
	v.add_child(sub)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override(&"separation", 18)
	v.add_child(row)
	var minus := Button.new()
	minus.text = "−"
	InvStyle.style_button(minus, "secondary", 26)
	minus.custom_minimum_size = Vector2(64, 56)
	minus.pressed.connect(func() -> void: _set_hours(hours - 1))
	row.add_child(minus)
	_hours_label = Label.new()
	_hours_label.custom_minimum_size = Vector2(220, 0)
	_hours_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hours_label.add_theme_font_override(&"font", InvStyle.font("SemiBold"))
	_hours_label.add_theme_font_size_override(&"font_size", 30)
	_hours_label.add_theme_color_override(&"font_color", InvStyle.TEXT)
	row.add_child(_hours_label)
	var plus := Button.new()
	plus.text = "+"
	InvStyle.style_button(plus, "secondary", 26)
	plus.custom_minimum_size = Vector2(64, 56)
	plus.pressed.connect(func() -> void: _set_hours(hours + 1))
	row.add_child(plus)
	var btns := HBoxContainer.new()
	btns.alignment = BoxContainer.ALIGNMENT_CENTER
	btns.add_theme_constant_override(&"separation", 12)
	v.add_child(btns)
	var dawn := Button.new()
	dawn.text = "Until dawn"
	InvStyle.style_button(dawn, "secondary", 18)
	dawn.pressed.connect(func() -> void: _set_hours(roundi(hours_until_dawn())))
	btns.add_child(dawn)
	var cancel := Button.new()
	cancel.text = "Cancel"
	InvStyle.style_button(cancel, "secondary", 18)
	cancel.pressed.connect(_close)
	btns.add_child(cancel)
	var ok := Button.new()
	ok.text = "Sleep"
	InvStyle.style_button(ok, "primary", 18)
	ok.pressed.connect(_confirm)
	btns.add_child(ok)
	_set_hours(hours)
	ok.grab_focus.call_deferred()


func _set_hours(h: int) -> void:
	hours = clampi(h, 1, 12)
	var wake := fposmod(float(Climate.hours) + hours, 24.0)
	_hours_label.text = "%d h  →  %02d:%02d" % [hours, int(wake), int(fposmod(wake * 60.0, 60.0))]


func _unhandled_input(event: InputEvent) -> void:
	if _busy:
		return
	if event.is_action_pressed(&"ui_cancel") or event.is_action_pressed(&"pause"):
		get_viewport().set_input_as_handled()
		_close()
	elif event.is_action_pressed(&"ui_left") or event.is_action_pressed(&"move_left"):
		_set_hours(hours - 1)
	elif event.is_action_pressed(&"ui_right") or event.is_action_pressed(&"move_right"):
		_set_hours(hours + 1)


func _close() -> void:
	Events.ui_screen_closed.emit(&"sleep")
	queue_free()


func _confirm() -> void:
	if _busy:
		return
	var why := sleep_problem(player, bed.global_position if bed else Vector3.ZERO)
	if why != "":
		Game.notify(why, &"warning")
		_close()
		return
	_busy = true
	_panel.visible = false
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", 1.0, 0.9)
	await tw.finished
	var q := float(ItemDB.get_buildable(BuildingRoot.component_of(bed).id).get("sleep_quality", 0.8)) if bed and BuildingRoot.component_of(bed) else 0.8
	var res := sleep_now(player, float(hours), q, true)
	await get_tree().create_timer(0.6).timeout
	Game.notify("You slept %d hours.%s" % [hours, "  Game saved." if bool(res.get("saved", false)) else ""], &"info")
	var tw2 := create_tween()
	tw2.tween_property(_fade, "color:a", 0.0, 1.4)
	await tw2.finished
	_close()

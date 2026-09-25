class_name DeathScreen
extends CanvasLayer
## Death screen: "You froze to death at 2,640 m." from the Events.player_died cause and the altitude, the day,
## time and how long you survived; Continue from last save (or Start again) / Main menu. The world behind
## drains to a dark, desaturated still.

const CAUSES := {
	&"cold": "You froze to death", &"hypothermia": "You froze to death", &"frostbite": "You froze to death",
	&"hunger": "You starved to death", &"starvation": "You starved to death", &"thirst": "You died of thirst",
	&"hypoxia": "The altitude took you", &"fall": "You fell to your death", &"drown": "You drowned",
	&"bleed": "You bled to death", &"fire": "You burned to death", &"bite": "You were killed by wolves",
	&"claw": "You were mauled by a bear", &"blunt": "You were killed", &"cut": "You were killed",
	&"pierce": "You were killed", &"avalanche": "You were buried by an avalanche",
}

var root: Control
var _backdrop: ColorRect
var _title: Label
var _sub: Label
var _buttons: Array[Button] = []


static func headline(cause: StringName, altitude: float) -> String:
	var base := String(CAUSES.get(cause, "You died"))
	return "%s at %s." % [base, UITheme.metres(altitude)]


func _ready() -> void:
	layer = 80
	process_mode = Node.PROCESS_MODE_ALWAYS
	_backdrop = ColorRect.new()
	_backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/ui/menus/blur_backdrop.gdshader")
	mat.set_shader_parameter("dim", 0.8)
	mat.set_shader_parameter("desat", 0.9)
	mat.set_shader_parameter("blur_lod", 2.0)
	mat.set_shader_parameter("tint", Vector3(0.01, 0.012, 0.016))
	mat.set_shader_parameter("fade", 0.0)
	_backdrop.material = mat
	add_child(_backdrop)
	root = Control.new()
	root.theme = UITheme.get_theme()
	add_child(root)
	var v := UITheme.vbox(10)
	v.name = "Column"
	root.add_child(v)
	_title = UITheme.label("", 52, UITheme.TEXT, "Light")
	_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_title.custom_minimum_size.x = 900
	v.add_child(_title)
	_sub = UITheme.label("", UITheme.FS_LEAD, UITheme.TEXT_DIM, "Regular")
	v.add_child(_sub)
	var sp := Control.new()
	sp.custom_minimum_size.y = 40
	v.add_child(sp)
	var row := UITheme.hbox(14)
	v.add_child(row)
	var cont := UITheme.button("Continue from last save" if Save.has_save(0) else "Start again", "PrimaryButton")
	cont.custom_minimum_size = Vector2(300, 56)
	cont.pressed.connect(_continue)
	row.add_child(cont)
	var menu := UITheme.button("Main menu")
	menu.custom_minimum_size = Vector2(200, 56)
	menu.pressed.connect(func() -> void: Game.quit_to_menu())
	row.add_child(menu)
	_buttons = [cont, menu]
	UISounds.wire(root)
	get_viewport().size_changed.connect(_layout)
	root.modulate.a = 0.0


func show_death(cause: StringName, altitude: float) -> void:
	_title.text = headline(cause, altitude)
	var alive := Game.playtime
	_sub.text = "Day %d  ·  %s  ·  survived %s" % [Climate.day, Climate.get_time_string(), UITheme.duration(alive)]
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Events.ui_screen_opened.emit(&"death")
	_layout()
	var mat := _backdrop.material as ShaderMaterial
	var tw := create_tween().set_parallel(true)
	tw.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	tw.tween_method(func(f: float) -> void: mat.set_shader_parameter("fade", f), 0.0, 1.0, 2.5)
	tw.tween_property(root, "modulate:a", 1.0, 1.6).set_delay(0.8)
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		_buttons[0].grab_focus.call_deferred()


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var col: Control = root.get_node("Column")
	col.size = col.get_combined_minimum_size()
	col.position = Vector2(clampf(root.size.x * 0.1, 60.0, 200.0), root.size.y * 0.5 - col.size.y * 0.5)


func _continue() -> void:
	Events.ui_screen_closed.emit(&"death")
	Game.respawn_after_death()


func _input(event: InputEvent) -> void:
	InputGlyphs.track(event)
	if (event is InputEventJoypadButton or event is InputEventKey) and (event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ui_up") or event.is_action_pressed(&"ui_left") or event.is_action_pressed(&"ui_right")):
		var f := get_viewport().gui_get_focus_owner()
		if f == null or not root.is_ancestor_of(f):
			_buttons[0].grab_focus()
			get_viewport().set_input_as_handled()

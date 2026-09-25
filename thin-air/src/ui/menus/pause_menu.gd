class_name PauseMenu
extends CanvasLayer
## Pause menu (Esc / Start / touch pause button): Resume, Save game (when allowed), Settings, Journal, Quit to
## main menu — over a frosted, dimmed view of the paused world. Shows where and when you are and the current
## objective. Pauses the tree via Game.set_paused; emits Events.ui_screen_opened/closed(&"pause").

const SCREEN := &"pause"

var is_open := false
var root: Control
var _backdrop: ColorRect
var _panel: Control
var _buttons: Array[Button] = []
var _save_btn: Button
var _save_note: Label
var _where: Label
var _objective: Label
var _saved_label: Label
var _settings: SettingsPanel
var _journal_open := false
var _tween: Tween
var _opened_frame := -10


func _ready() -> void:
	layer = 60
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()
	visible = false
	get_viewport().size_changed.connect(_layout)
	Events.game_saved.connect(func(_s: int) -> void: _refresh())


func _build() -> void:
	_backdrop = ColorRect.new()
	_backdrop.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://src/ui/menus/blur_backdrop.gdshader")
	_backdrop.material = mat
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_backdrop)
	root = Control.new()
	root.theme = UITheme.get_theme()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_panel = Control.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_panel)
	var v := UITheme.vbox(6)
	v.name = "Column"
	_panel.add_child(v)
	var title := UITheme.caps("Paused", 18, UITheme.ACCENT, 6)
	v.add_child(title)
	_where = UITheme.label("", UITheme.FS_SMALL, UITheme.TEXT_DIM)
	v.add_child(_where)
	var sp := Control.new()
	sp.custom_minimum_size.y = 26
	v.add_child(sp)
	for entry in [["Resume", close], ["Save game", _save], ["Settings", open_settings.bind("")],
			["Journal", _open_journal], ["Quit to main menu", _ask_quit]]:
		var b := UITheme.menu_button(entry[0])
		b.custom_minimum_size = Vector2(380, 56)
		b.pressed.connect(entry[1])
		v.add_child(b)
		_buttons.append(b)
		if entry[0] == "Save game":
			_save_btn = b
			_save_note = UITheme.label("", UITheme.FS_SMALL, UITheme.TEXT_DIM)
			_save_note.custom_minimum_size.x = 360
			_save_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			var nm := UITheme.margin(0)
			nm.add_theme_constant_override("margin_left", 25)
			nm.add_theme_constant_override("margin_bottom", 6)
			nm.add_child(_save_note)
			v.add_child(nm)
	# right: objective card
	var card := PanelContainer.new()
	card.name = "Card"
	card.theme_type_variation = &"CardPanel"
	card.custom_minimum_size.x = 420
	root.add_child(card)
	var cv := UITheme.vbox(8)
	card.add_child(cv)
	cv.add_child(UITheme.caps("Current objective", 13, UITheme.TEXT_DIM, 3))
	_objective = UITheme.label("", UITheme.FS_LEAD, UITheme.TEXT, "Light")
	_objective.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_objective.custom_minimum_size.x = 380
	cv.add_child(_objective)
	cv.add_child(UITheme.hline())
	_saved_label = UITheme.label("", UITheme.FS_SMALL, UITheme.TEXT_DIM)
	cv.add_child(_saved_label)
	UISounds.wire(root)
	_buttons[0].set_meta(&"back_sound", true)


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var W := root.size.x
	var H := root.size.y
	var col: Control = _panel.get_node("Column")
	var cs := col.get_combined_minimum_size()
	col.size = cs
	_panel.position = Vector2(clampf(W * 0.08, 48.0, 160.0), (H - cs.y) * 0.5)
	var card: Control = root.get_node("Card")
	card.size = card.get_combined_minimum_size()
	card.position = Vector2(W - card.size.x - clampf(W * 0.06, 40.0, 140.0), (H - card.size.y) * 0.5)
	card.visible = W > 1250.0


func open() -> void:
	if is_open:
		return
	is_open = true
	_opened_frame = Engine.get_process_frames()
	visible = true
	root.visible = true
	Game.set_paused(true)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Events.ui_screen_opened.emit(SCREEN)
	_refresh()
	_layout()
	_animate(true)
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		_buttons[0].grab_focus.call_deferred()


func close() -> void:
	if not is_open:
		return
	if _settings:
		_close_settings()
	is_open = false
	Settings.save()
	Game.set_paused(false)
	Events.ui_screen_closed.emit(SCREEN)
	_animate(false)


func _animate(opening: bool) -> void:
	if _tween:
		_tween.kill()
	var mat := _backdrop.material as ShaderMaterial
	_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	if opening:
		root.modulate.a = 0.0
		_tween.tween_property(root, "modulate:a", 1.0, 0.18)
		_tween.tween_method(func(f: float) -> void: mat.set_shader_parameter("fade", f), 0.0, 1.0, 0.2)
	else:
		_tween.tween_property(root, "modulate:a", 0.0, 0.12)
		_tween.tween_method(func(f: float) -> void: mat.set_shader_parameter("fade", f), 1.0, 0.0, 0.14)
		_tween.chain().tween_callback(func() -> void:
			if not is_open:
				visible = false)


## Saving from the menu: not in Whiteout (beds only), not while dead or in a cinematic, and only when a
## world exists. Game.flags["no_save"] lets story moments block it.
static func can_save() -> bool:
	if Game.world == null or Game.player == null:
		return false
	if Game.difficulty == &"whiteout":
		return false
	if bool(Game.get_flag(&"no_save", false)):
		return false
	var p: Node = Game.player
	if p.has_method("is_dead") and bool(p.call("is_dead")):
		return false
	return true


func _refresh() -> void:
	var parts: PackedStringArray = ["Day %d" % Climate.day, Climate.get_time_string()]
	if Game.player and is_instance_valid(Game.player):
		var pos: Vector3 = (Game.player as Node3D).global_position
		parts.append(UITheme.metres(pos.y))
		parts.append(UITheme.celsius(Climate.get_air_temperature(pos)))
	_where.text = "  ·  ".join(parts)
	var ok := can_save()
	_save_btn.disabled = not ok
	_save_note.get_parent().visible = not ok
	if not ok:
		_save_note.text = "On Whiteout you can only save by sleeping in a bed." if Game.difficulty == &"whiteout" else "You can't save right now."
	var obj := ""
	for o in Story.objectives:
		if not bool(o.get("done", false)):
			obj = String(o.get("text", ""))
	_objective.text = obj if obj != "" else "No open objectives."
	if Save.has_save(0):
		var info: Dictionary = Save.get_save_info(0)
		var ago := Time.get_unix_time_from_system() - float(info.get("timestamp", 0))
		_saved_label.text = "Last saved %s ago" % UITheme.duration(ago) if ago < 86400.0 * 2 else "Last saved on day %d" % int(info.get("day", 1))
	else:
		_saved_label.text = "Not saved yet"


func _save() -> void:
	if not can_save():
		return
	if Save.save_game(0):
		Game.notify("Game saved", &"save")
		_refresh()


func open_settings(tab_name := "") -> void:
	if _settings:
		return
	_panel.visible = false
	(root.get_node("Card") as Control).visible = false
	_settings = SettingsPanel.new()
	_settings.in_game = true
	add_child(_settings)
	_settings.closed.connect(_close_settings)
	if tab_name != "":
		var i := SettingsPanel.TABS.find(tab_name.capitalize())
		if i >= 0:
			_settings.call_deferred("_set_tab", i)


func _close_settings() -> void:
	if _settings:
		_settings.queue_free()
		_settings = null
	_panel.visible = true
	_layout()
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		_buttons[2].grab_focus.call_deferred()


func _open_journal() -> void:
	var hud := HUD.find()
	if hud == null:
		return
	if hud.journal == null or not is_instance_valid(hud.journal):
		hud.journal = hud._instance_scene(HUD.JOURNAL_SCENE)
	if hud.journal and hud.journal.has_method("open_from_pause"):
		_journal_open = true
		root.visible = false
		hud.journal.call("open_from_pause", self)


## Called by the journal when it closes after being opened from here.
func on_journal_closed() -> void:
	_journal_open = false
	root.visible = true
	if InputGlyphs.current() != InputGlyphs.TOUCH:
		_buttons[3].grab_focus.call_deferred()


func _ask_quit() -> void:
	var body := "Progress since your last save will be lost."
	if not Save.has_save(0):
		body = "You haven't saved. Your progress will be lost."
	var d := ConfirmDialog.ask(root, "Quit to main menu?", body, "Quit")
	d.confirmed.connect(func() -> void:
		is_open = false
		Events.ui_screen_closed.emit(SCREEN)
		Game.quit_to_menu())


func _input(event: InputEvent) -> void:
	if not is_open or _settings or _journal_open:
		return
	InputGlyphs.track(event)
	if Engine.get_process_frames() == _opened_frame:
		return
	if event.is_action_pressed(&"pause") or event.is_action_pressed(&"ui_cancel"):
		if root.get_children().any(func(c: Node) -> bool: return c is ConfirmDialog):
			return
		get_viewport().set_input_as_handled()
		UISounds.back()
		close()
	elif (event is InputEventJoypadButton or event is InputEventKey) and (event.is_action_pressed(&"ui_down") or event.is_action_pressed(&"ui_up")):
		var f := get_viewport().gui_get_focus_owner()
		if f == null or not root.is_ancestor_of(f):
			_buttons[0].grab_focus()
			get_viewport().set_input_as_handled()


func _process(_d: float) -> void:
	# touch pause button injects the action without an event
	if is_open and not _settings and not _journal_open and Engine.get_process_frames() != _opened_frame \
			and Input.is_action_just_pressed(&"pause"):
		close()

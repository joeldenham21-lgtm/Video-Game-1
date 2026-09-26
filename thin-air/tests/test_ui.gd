extends TestCase
## UI stream tests (CONTRACT §9): scripts compile, design system, input glyphs, HUD reacts to Events (prompt,
## notification, objective, subtitle, damage, status effects, screen effects, fade), settings screen writes
## Settings values and covers every CONTRACT key, map generation on the stub terrain, touch controls inject
## actions, focus navigation reaches every button of the menus.

const CONTRACT_KEYS := [&"render_scale", &"upscaler", &"msaa", &"taa", &"fxaa", &"shadow_quality", &"shadow_distance",
	&"view_distance", &"lod_bias", &"vegetation_density", &"grass_distance", &"tree_impostor_distance", &"volumetric_fog",
	&"ssao", &"ssil", &"ssr", &"glow", &"sky_quality", &"particles", &"dynamic_resolution", &"target_fps", &"max_fps",
	&"vsync", &"fov", &"mouse_sensitivity", &"look_sensitivity_touch", &"look_sensitivity_pad", &"invert_y", &"head_bob",
	&"vol_master", &"vol_music", &"vol_sfx", &"vol_ambience", &"vol_voice", &"subtitles", &"show_fps", &"touch_ui_scale",
	&"difficulty", &"language"]

var _saved_values := {}
var _saved_preset: StringName


func run() -> void:
	_saved_values = Settings.values.duplicate()
	_saved_preset = Settings.preset
	SettingsPanel.persist = false
	if FileAccess.file_exists(Settings.SAVE_PATH):
		_settings_mtime = FileAccess.get_modified_time(Settings.SAVE_PATH)
	_test_scripts_compile()
	_test_theme()
	_test_glyphs()
	await _test_hud()
	await _test_settings()
	await _test_map()
	await _test_touch()
	await _test_focus()
	_test_screens_misc()
	# leave the shared state as we found it
	Settings.values = _saved_values
	Settings.preset = _saved_preset
	Game.player = null
	Game.state = Game.State.BOOT
	Story.objectives.clear()


# ============================================================================================ compile

func _test_scripts_compile() -> void:
	var files: PackedStringArray = []
	_collect("res://src/ui", files)
	files.append("res://src/dev/ui_test.gd")
	var n := 0
	for f in files:
		if f.begins_with("res://src/ui/inventory"):
			continue
		var s: Script = load(f)
		check(s != null and s.can_instantiate(), "compiles: %s" % f)
		n += 1
	check(n >= 20, "found the UI scripts (%d)" % n)
	for sc in ["hud", "main_menu", "menu_vista", "pause_menu", "death_screen", "loading_screen", "journal", "map_screen", "touch_controls"]:
		var p := "res://scenes/ui/%s.tscn" % sc
		check(ResourceLoader.exists(p) and load(p) is PackedScene, "scene exists: %s" % p)
	var main := load("res://scenes/main.tscn") as PackedScene
	var mm := main.instantiate()
	check(mm is MainMenu, "scenes/main.tscn opens the main menu")
	mm.free()


func _collect(dir: String, out: PackedStringArray) -> void:
	for d in DirAccess.get_directories_at(dir):
		_collect(dir.path_join(d), out)
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd"):
			out.append(dir.path_join(f))


# ============================================================================================ theme / glyphs

func _test_theme() -> void:
	check(ResourceLoader.exists(UITheme.THEME_PATH), "assets/ui/theme.tres exists")
	check(String(ProjectSettings.get_setting("gui/theme/custom", "")) == UITheme.THEME_PATH, "project uses the UI theme")
	var th := load(UITheme.THEME_PATH) as Theme
	check(th != null and th.get_type_variation_base(&"PrimaryButton") == &"Button", "theme has PrimaryButton variation")
	check(th != null and th.has_stylebox("focus", "Button"), "theme has a visible focus style")
	check(UITheme.thousands(2431) == "2,431" and UITheme.thousands(512) == "512", "thousands separator")
	check(UITheme.celsius(-8.2) == "−8 °C" and UITheme.celsius(3.0) == "3 °C", "celsius uses a real minus sign")
	check(UITheme.metres(2640.4) == "2,640 m", "altitude format")
	check(UITheme.clock(17.4) == "17:24", "clock format")
	for ic in ["health", "food", "water", "warmth", "oxygen", "stamina", "wet", "bleeding", "sprain", "frostbite", "hypoxic",
			"sick", "well_fed", "warmed_up", "rested", "info", "item", "warning", "objective", "discovery", "blueprint",
			"jump", "crouch", "use", "aim", "interact", "inventory", "build", "journal", "map", "torch", "pause"]:
		check(UITheme.icon(ic) != null, "icon %s" % ic)


func _test_glyphs() -> void:
	var g := InputGlyphs.glyph(&"interact", InputGlyphs.KEYBOARD)
	check(g["kind"] == "key" and String(g["text"]) == "E", "keyboard glyph for interact is E (got %s)" % g["text"])
	g = InputGlyphs.glyph(&"interact", InputGlyphs.PAD)
	check(g["kind"] == "pad_button" and String(g["text"]) == "X", "pad glyph for interact is X")
	g = InputGlyphs.glyph(&"use", InputGlyphs.PAD)
	check(g["kind"] == "pad_axis" and String(g["text"]) == "RT", "pad glyph for use is RT")
	g = InputGlyphs.glyph(&"use", InputGlyphs.KEYBOARD)
	check(g["kind"] == "mouse" and String(g["text"]) == "LMB", "keyboard/mouse glyph for use is LMB")
	g = InputGlyphs.glyph(&"jump", InputGlyphs.TOUCH)
	check(g["kind"] == "touch" and String(g["icon"]) == "jump", "touch glyph is the button icon")
	g = InputGlyphs.glyph(&"map", InputGlyphs.PAD)
	check(g["kind"] == "pad_button" and int(g["index"]) == JOY_BUTTON_DPAD_DOWN, "map on the D-pad down")
	var seen: Array = []
	var cb := func(d: StringName) -> void: seen.append(d)
	InputGlyphs.bus().device_changed.connect(cb)
	InputGlyphs.device = InputGlyphs.KEYBOARD
	var jb := InputEventJoypadButton.new()
	jb.button_index = JOY_BUTTON_A
	jb.pressed = true
	InputGlyphs.track(jb)
	check(InputGlyphs.current() == InputGlyphs.PAD and seen.has(InputGlyphs.PAD), "pad input switches glyphs to the pad")
	var st := InputEventScreenTouch.new()
	st.pressed = true
	InputGlyphs.track(st)
	check(InputGlyphs.current() == InputGlyphs.TOUCH, "touch input switches to touch")
	var k := InputEventKey.new()
	k.pressed = true
	k.keycode = KEY_W
	InputGlyphs.track(k)
	check(InputGlyphs.current() == InputGlyphs.KEYBOARD, "keyboard input switches back")
	InputGlyphs.bus().device_changed.disconnect(cb)


# ============================================================================================ HUD

func _test_hud() -> void:
	InputGlyphs.device = InputGlyphs.KEYBOARD
	var mock: Node3D = load("res://src/dev/ui_test.gd").MockPlayer.new()
	add_child(mock)
	var cam := Camera3D.new()
	add_child(cam)
	mock.set("camera", cam)
	var v := Vitals.new()
	v.name = "Vitals"
	v.auto_simulate = false
	mock.add_child(v)
	mock.set("vitals", v)
	Game.register_player(mock)
	Game.state = Game.State.PLAYING
	var hud := (load("res://scenes/ui/hud.tscn") as PackedScene).instantiate() as HUD
	add_child(hud)
	await get_tree().process_frame
	check(HUD.find() == hud, "HUD.find() returns the HUD")
	# interaction prompt
	Events.interaction_prompt.emit("Pick up Stick", 0.0)
	check(hud.crosshair.prompt_text == "Pick up Stick", "prompt text shown")
	Events.interaction_prompt.emit("Light the fire", 1.5)
	Events.interaction_progress.emit(0.5)
	check(hud.crosshair.hold_time == 1.5 and absf(hud.crosshair.progress - 0.5) < 0.001, "hold prompt + progress ring")
	Events.interaction_progress.emit(-1.0)
	Events.interaction_prompt.emit("", 0.0)
	check(hud.crosshair.prompt_text == "" and hud.crosshair.progress < 0.0, "prompt hidden and ring cancelled")
	# notifications (merge item pickups, stack others)
	hud.toasts.clear()
	Events.notification.emit("+1 Stick", &"item")
	Events.notification.emit("+2 Stick", &"item")
	Events.notification.emit("New blueprint: Spear", &"blueprint")
	Events.notification.emit("Too cold", &"warning")
	check(hud.toasts.count() == 3, "toasts stack; repeated pickups merge (%d)" % hud.toasts.count())
	var merged := false
	for c in hud.toasts.find_children("*", "Label", true, false):
		if (c as Label).text == "+3 Stick":
			merged = true
	check(merged, "item toasts merge into +3 Stick")
	for i in 8:
		Events.notification.emit("Message %d" % i, &"info")
	check(hud.toasts.count() <= HUDToasts.MAX, "toast stack is capped")
	# objectives
	Story.objectives.clear()
	Story.add_objective(&"t_warm", "Get warm")
	check(hud.objectives.open_count() == 1, "objective added to tracker")
	Story.complete_objective(&"t_warm")
	check(hud.objectives.open_count() == 0, "objective completed in tracker")
	# subtitles
	Settings.values[&"subtitles"] = true
	Events.settings_changed.emit()
	Events.subtitle.emit("Mara Voss", "This is Kestrel Station.", 3.0)
	check(hud.subtitles.visible and hud.subtitles.current_text() == "This is Kestrel Station.", "subtitle shown")
	Settings.values[&"subtitles"] = false
	Events.settings_changed.emit()
	Events.subtitle.emit("Mara Voss", "Second line", 3.0)
	check(not hud.subtitles.visible, "subtitles respect the setting")
	Settings.values[&"subtitles"] = true
	Events.settings_changed.emit()
	# damage direction + red flash
	var src := Node3D.new()
	add_child(src)
	src.global_position = Vector3(5, 0, 0)
	Events.player_damaged.emit(20.0, &"bite", src)
	check(hud.damage.active_count() == 1, "directional damage marker")
	check(float(hud.screen_fx_values()["damage"]) > 0.5, "damage flash")
	Events.player_damaged.emit(5.0, &"cold", null)
	check(hud.damage.active_count() == 1, "non-directional damage adds no marker")
	var right := HUDDamageIndicator.screen_angle(Transform3D.IDENTITY, Vector3(5, 0, 0))
	check(absf(right - PI * 0.5) < 0.01, "attacker on the right points right")
	check(absf(HUDDamageIndicator.screen_angle(Transform3D.IDENTITY, Vector3(0, 0, -5))) < 0.01, "attacker ahead points up")
	# status effects
	v.add_effect(&"wet", 100.0)
	v.add_effect(&"bleeding", 50.0)
	hud.status.sync(v.effects)
	check(hud.status.active.has(&"wet") and hud.status.active.has(&"bleeding"), "status icons for wet and bleeding")
	check(hud.status.active[0] == &"bleeding", "dangerous effects first")
	v.remove_effect(&"wet")
	hud.status.sync(v.effects)
	check(not hud.status.active.has(&"wet"), "status icon removed")
	# vitals ring visibility logic
	var vd := hud.vitals
	vd.values[&"food"] = 100.0
	vd.altitude = 1500.0
	vd.values[&"oxygen"] = 100.0
	check(vd.wanted_alpha(&"food") == 0.0 and vd.wanted_alpha(&"oxygen") == 0.0, "full meters are hidden, oxygen hidden low down")
	vd.values[&"food"] = 70.0
	check(vd.wanted_alpha(&"food") > 0.0 and vd.wanted_alpha(&"food") < 1.0, "non-full meter shows dimmed")
	vd.values[&"food"] = 5.0
	check(vd.wanted_alpha(&"food") == 1.0 and vd.is_critical(&"food") and vd.color_for(&"food") == UITheme.CRITICAL, "critical meter is red and pulses")
	vd.altitude = 2900.0
	check(vd.wanted_alpha(&"oxygen") >= 0.0 and vd.color_for(&"oxygen") == UITheme.OXYGEN, "oxygen is cyan")
	vd.values[&"oxygen"] = 80.0
	check(vd.wanted_alpha(&"oxygen") > 0.0, "oxygen ring appears when not full")
	# screen effects from vitals
	v.health = 100.0; v.warmth = 100.0; v.oxygen = 100.0
	var fx := HUD.fx_targets(v)
	check(float(fx["frost"]) == 0.0 and float(fx["hypoxia"]) == 0.0 and float(fx["low_health"]) == 0.0, "no screen effects when well")
	v.warmth = 8.0; v.oxygen = 20.0; v.health = 15.0
	v.add_effect(&"wet", 200.0)
	fx = HUD.fx_targets(v)
	check(float(fx["frost"]) > 0.8 and float(fx["hypoxia"]) > 0.7 and float(fx["low_health"]) > 0.7 and float(fx["wet"]) > 0.5, "cold/hypoxia/injury/wet drive the effects")
	# fade API
	var tw := hud.fade_to_black(0.0)
	check(tw != null and hud.is_faded(), "fade_to_black")
	hud.fade_in(0.0)
	check(not hud.is_faded(), "fade_in")
	# hide HUD while a full-screen UI is open / photo mode
	Events.ui_screen_opened.emit(&"inventory")
	for i in 20:
		await get_tree().process_frame
	check(not hud.is_hud_visible(), "HUD hides under a full-screen UI")
	Events.ui_screen_closed.emit(&"inventory")
	hud.set_photo_mode(true)
	for i in 5:
		await get_tree().process_frame
	check(not hud.is_hud_visible(), "HUD hides in photo mode")
	hud.set_photo_mode(false)
	for i in 30:
		await get_tree().process_frame
	check(hud.is_hud_visible(), "HUD returns")
	# compass bearings
	check(absf(HUDCompass.bearing_of(Vector3(0, 0, -1))) < 0.01, "north is 0°")
	check(absf(HUDCompass.bearing_of(Vector3(1, 0, 0)) - 90.0) < 0.01, "east is 90°")
	check(HUD.poi_icon("kestrel_station") == "station" and HUD.poi_icon("loon_lake") == "lake", "POI icons")
	# death headline
	check(DeathScreen.headline(&"cold", 2640.0) == "You froze to death at 2,640 m.", "death headline")
	hud.queue_free()
	src.queue_free()
	await get_tree().process_frame
	Game.player = null
	mock.queue_free()
	cam.queue_free()


# ============================================================================================ settings

func _test_settings() -> void:
	var panel := SettingsPanel.new()
	add_child(panel)
	await get_tree().process_frame
	for k in CONTRACT_KEYS:
		check(panel.controls.has(k), "settings screen covers %s" % k)
	# slider writes a float
	var fov: HSlider = panel.controls[&"fov"]
	fov.value = 88.0
	check(absf(float(Settings.get_value(&"fov")) - 88.0) < 0.01, "fov slider writes Settings")
	# toggle writes a bool
	var inv: CheckButton = panel.controls[&"invert_y"]
	var was := bool(Settings.get_value(&"invert_y"))
	inv.button_pressed = not was
	check(bool(Settings.get_value(&"invert_y")) == (not was), "invert toggle writes Settings")
	# choice writes the option value with the right type
	var msaa: ChoiceSelector = panel.controls[&"msaa"]
	msaa.set_value(0)
	msaa.step(1)
	check(Settings.get_value(&"msaa") is int and int(Settings.get_value(&"msaa")) == 2, "MSAA selector writes an int")
	var up: ChoiceSelector = panel.controls[&"upscaler"]
	up.set_value(&"bilinear")
	up.disabled = false
	up.step(1)
	check(Settings.get_value(&"upscaler") is StringName and Settings.get_value(&"upscaler") == &"fsr", "upscaler selector writes a StringName")
	# preset applies everything and 'Custom' appears after a change
	var pre: ChoiceSelector = panel.controls[&"preset"]
	pre.set_value(&"low")
	pre.step(1)           # -> medium
	check(Settings.preset == &"medium" and float(Settings.get_value(&"render_scale")) == 1.0, "preset selector applies the preset")
	(panel.controls[&"shadow_distance"] as HSlider).value = 120.0
	check(pre.override_text == "Custom", "a changed value shows Custom")
	# audio volume applies
	(panel.controls[&"vol_music"] as HSlider).value = 0.3
	check(absf(float(Settings.get_value(&"vol_music")) - 0.3) < 0.001, "music volume writes Settings")
	# restore defaults
	panel.restore_defaults()
	check(absf(float(Settings.get_value(&"fov")) - float(Settings.COMMON[&"fov"])) < 0.01, "restore defaults resets fov")
	# every tab reachable
	for i in SettingsPanel.TABS.size():
		panel._set_tab(i)
		check(panel.tab == i, "settings tab %s" % SettingsPanel.TABS[i])
	panel.queue_free()
	await get_tree().process_frame


# ============================================================================================ map

func _test_map() -> void:
	TopoMap.clear_cache()
	var d := TopoMap.data()
	check(d.has("height_tex") and d["height_tex"] is Texture2D, "map height texture built on the stub terrain")
	var hp: Vector4 = d["hparams"]
	check(hp.w >= 2.0 and hp.z > 0.0, "map height params valid")
	var tex := d["height_tex"] as Texture2D
	check(tex.get_width() == int(hp.w), "texture size matches params")
	var img := tex.get_image()
	if img:
		check(absf(img.get_pixel(0, 0).r - TerrainData.get_height(-TerrainData.HALF, -TerrainData.HALF)) < 0.5, "map heights match TerrainData")
	check(TopoMap.data() == d, "map data cached for the session")
	var m := TopoMap.make_material()
	check(m.shader != null and m.get_shader_parameter("height_tex") != null, "map material ready")
	var c1 := TopoMap.contour_info(1500.0)
	var c2 := TopoMap.contour_info(1525.0)
	var c3 := TopoMap.contour_info(1450.0)
	check(c1[0] < 0.01 and c1[1] == true, "1,500 m is an index contour")
	check(absf(float(c2[0]) - 25.0) < 0.01, "1,525 m is halfway between contours")
	check(c3[0] < 0.01 and c3[1] == false, "1,450 m is a regular contour")
	var screen := (load("res://scenes/ui/map_screen.tscn") as PackedScene).instantiate() as MapScreen
	add_child(screen)
	await get_tree().process_frame
	var view := screen.view
	view.size = Vector2(800, 600)
	view.set_view(Vector2(100, -200), 2.0)
	var w := view.local_to_world(view.world_to_local(Vector2(333, -444)))
	check(w.distance_to(Vector2(333, -444)) < 0.01, "map world/screen transform round-trips")
	view.zoom_at(Vector2(400, 300), 1000.0)
	check(view.m_per_unit <= view.max_m_per_unit() + 0.001, "zoom out is clamped to the map")
	view.zoom_at(Vector2(400, 300), 0.00001)
	check(view.m_per_unit >= MapView.MIN_M_PER_UNIT - 0.001, "zoom in is clamped")
	var p: Node3D = load("res://src/dev/ui_test.gd").MockPlayer.new()
	check(not MapScreen.can_locate(p), "no compass: no position on the map")
	(p.get("inventory") as Inventory).add(&"compass", 1)
	check(MapScreen.can_locate(p), "with a compass the map shows you")
	p.free()
	screen.queue_free()
	await get_tree().process_frame


# ============================================================================================ touch

func _test_touch() -> void:
	InputGlyphs.device = InputGlyphs.TOUCH
	Game.state = Game.State.PLAYING
	var tc := (load("res://scenes/ui/touch_controls.tscn") as PackedScene).instantiate() as TouchControls
	add_child(tc)
	await get_tree().process_frame
	tc.set_active(true)
	for id in TouchControls.BUTTONS:
		var r := tc.button_radius(id)
		check(r > 0.0, "touch button %s laid out" % id)
	var xf := tc.root.get_global_transform_with_canvas()
	# jump: tap
	_touch(tc, 0, xf * tc.button_center(&"jump"), true)
	check(Input.is_action_pressed(&"jump"), "jump button presses jump")
	_touch(tc, 0, xf * tc.button_center(&"jump"), false)
	await get_tree().create_timer(0.15).timeout
	await get_tree().process_frame
	check(not Input.is_action_pressed(&"jump"), "jump released after the tap")
	# use: hold
	_touch(tc, 1, xf * tc.button_center(&"use"), true)
	await get_tree().create_timer(0.15).timeout
	check(Input.is_action_pressed(&"use"), "use is held while touched")
	_touch(tc, 1, xf * tc.button_center(&"use"), false)
	check(not Input.is_action_pressed(&"use"), "use released on lift")
	# floating stick
	var start := xf * Vector2(tc.root.size.x * 0.15, tc.root.size.y * 0.75)
	_touch(tc, 2, start, true)
	_drag(tc, 2, start + xf.basis_xform(Vector2(0, -TouchControls.STICK_R * tc.scale_k * 0.6)), Vector2(0, -40))
	check(Input.get_action_strength(&"move_forward") > 0.4, "stick pushes move_forward (%.2f)" % Input.get_action_strength(&"move_forward"))
	_drag(tc, 2, start + xf.basis_xform(Vector2(0, -TouchControls.STICK_R * tc.scale_k * 1.4)), Vector2(0, -60))
	check(Input.is_action_pressed(&"sprint"), "pushing past the rim sprints")
	_touch(tc, 2, start, false)
	check(not Input.is_action_pressed(&"move_forward") and not Input.is_action_pressed(&"sprint"), "stick released")
	# look drag on the right half, simultaneously with a held button (multi-touch)
	TouchLook.consume()
	_touch(tc, 3, xf * tc.button_center(&"aim"), true)
	var look_at := xf * Vector2(tc.root.size.x * 0.6, tc.root.size.y * 0.4)
	_touch(tc, 4, look_at, true)
	_drag(tc, 4, look_at + Vector2(30, 5), Vector2(30, 5))
	var ld := TouchLook.consume()
	check(ld.x > 0.0 and Input.is_action_pressed(&"aim"), "look drag and a held button at the same time")
	_touch(tc, 4, look_at, false)
	_touch(tc, 3, xf * tc.button_center(&"aim"), false)
	# interact pill
	Events.interaction_prompt.emit("Pick up Stick", 0.0)
	tc.root.queue_redraw()
	await get_tree().process_frame
	await get_tree().process_frame
	# blocked while a full-screen UI is open
	Events.ui_screen_opened.emit(&"journal")
	_touch(tc, 5, xf * tc.button_center(&"jump"), true)
	check(not Input.is_action_pressed(&"jump"), "touch controls are inert under a full-screen UI")
	_touch(tc, 5, xf * tc.button_center(&"jump"), false)
	Events.ui_screen_closed.emit(&"journal")
	Events.interaction_prompt.emit("", 0.0)
	tc.release_all()
	tc.queue_free()
	InputGlyphs.device = InputGlyphs.KEYBOARD
	await get_tree().process_frame


func _touch(tc: TouchControls, index: int, pos: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = index
	e.position = pos
	e.pressed = pressed
	tc._input(e)


func _drag(tc: TouchControls, index: int, pos: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = index
	e.position = pos
	e.relative = rel
	e.screen_relative = rel
	tc._input(e)


# ============================================================================================ focus

func _test_focus() -> void:
	InputGlyphs.device = InputGlyphs.PAD
	# main menu (without the 3D vista for speed): every entry reachable with down
	var menu := (load("res://scenes/ui/main_menu.tscn") as PackedScene).instantiate() as MainMenu
	add_child(menu)
	await get_tree().process_frame
	await get_tree().process_frame
	check(_reaches_all(menu.buttons), "main menu: focus reaches every button")
	menu.show_new_game()
	await get_tree().process_frame
	var ng: Array[Button] = []
	for c in menu.new_game_panel.find_children("*", "Button", true, false):
		ng.append(c as Button)
	check(ng.size() >= 5 and _reaches_all(ng), "new game panel: focus reaches every card and button")
	menu.queue_free()
	await get_tree().process_frame
	# pause menu
	var pm := (load("res://scenes/ui/pause_menu.tscn") as PackedScene).instantiate() as PauseMenu
	add_child(pm)
	await get_tree().process_frame
	pm.visible = true
	pm._layout()
	await get_tree().process_frame
	var pb: Array[Button] = []
	for b in pm._buttons:
		if not b.disabled:
			pb.append(b)
	check(_reaches_all(pb), "pause menu: focus reaches every enabled button")
	pm.queue_free()
	# settings: every option on every tab reachable
	var sp := SettingsPanel.new()
	add_child(sp)
	await get_tree().process_frame
	for t in SettingsPanel.TABS.size():
		sp._set_tab(t)
		await get_tree().process_frame
		var ctls: Array[Control] = []
		for spec in sp.SPECS[SettingsPanel.TABS[t]]:
			var c: Control = sp.controls.get(spec[0])
			if c and c.focus_mode != Control.FOCUS_NONE and c.is_visible_in_tree():
				ctls.append(c)
		check(_reaches_all(ctls), "settings %s: focus reaches every option" % SettingsPanel.TABS[t])
	sp.queue_free()
	# journal tabs have something focusable
	var j := (load("res://scenes/ui/journal.tscn") as PackedScene).instantiate() as Journal
	add_child(j)
	await get_tree().process_frame
	Story.found_logs.clear()
	Story.found_logs.append(&"log_burke_01")
	j.open("logs")
	await get_tree().process_frame
	await get_tree().process_frame
	var f := get_viewport().gui_get_focus_owner()
	check(f != null and j.root.is_ancestor_of(f), "journal focuses its first entry")
	check(j._reader_title.text == "Depot at Ashford", "log opens in the reader")
	for t in Journal.TABS.size():
		j._set_tab(t)
		await get_tree().process_frame
		check(j._pages[t].visible and j._pages[t].get_child_count() > 0, "journal tab %s builds" % Journal.TABS[t])
	j.close()
	j.queue_free()
	Story.found_logs.clear()
	InputGlyphs.device = InputGlyphs.KEYBOARD
	await get_tree().process_frame


## Walks focus with ui_down/ui_right neighbours (and Tab order) from the first control; true if all are visited.
func _reaches_all(ctls: Array) -> bool:
	if ctls.is_empty():
		return false
	var want := {}
	for c in ctls:
		want[c] = true
	var seen := {}
	var cur: Control = ctls[0]
	for i in ctls.size() * 3 + 4:
		if cur == null:
			break
		seen[cur] = true
		var nxt := cur.find_next_valid_focus()
		if nxt == null or nxt == cur:
			break
		cur = nxt
	var down_seen := {}
	cur = ctls[0]
	for i in ctls.size() * 2 + 4:
		if cur == null:
			break
		down_seen[cur] = true
		var nb := cur.find_valid_focus_neighbor(SIDE_BOTTOM)
		if nb == null or down_seen.has(nb):
			break
		cur = nb
	for c in want:
		if not seen.has(c) and not down_seen.has(c):
			print("  unreachable: ", (c as Control).name, " ", (c as Control).get_class())
			return false
	return true


# ============================================================================================ misc

var _settings_mtime := -1


func _settings_file_untouched() -> bool:
	return FileAccess.get_modified_time(Settings.SAVE_PATH) == _settings_mtime or _settings_mtime == -1


func _test_screens_misc() -> void:
	check(LoadingScreen.TIPS.size() >= 10, "loading screen has survival tips")
	var rows := CreditsRoll.licence_rows()
	check(rows.size() >= 3, "credits read assets/CREDITS.md rows (%d)" % rows.size())
	check(FieldNotes.entry(&"summit_relay")[0] == "Summit relay", "field note for a known scan")
	check(String(FieldNotes.entry(&"wolf_tracks")[0]) == "Grey wolf", "field note by keyword")
	check(PauseMenu.can_save() == false, "no saving without a world")
	check(not FileAccess.file_exists(Settings.SAVE_PATH) or _settings_file_untouched(), "tests leave user settings alone")
	var vista := (load("res://scenes/ui/menu_vista.tscn") as PackedScene).instantiate()
	check(vista is MenuVista, "menu vista scene")
	vista.free()

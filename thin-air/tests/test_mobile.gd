extends TestCase
## Mobile / controller QA regressions (S25 Ultra, touch + gamepad): real touch events go through
## Input.parse_input_event (as on a device, where Godot also emulates a mouse from the first finger),
## Settings auto-detect per GPU.


func run() -> void:
	await _test_emulated_mouse_does_not_fire_use()
	var prev_preset := Settings.preset
	var prev_values := Settings.values.duplicate()
	Settings.apply_preset(&"mobile_high", false)
	await _test_phone_scaled_layers()
	await _test_build_touch_block_clear_of_thumb_cluster()
	await _test_touch_subtitles_clear_of_thumb_cluster()
	_test_desktop_on_phone_preset()
	_test_auto_detect()
	Settings.values = prev_values
	Settings.preset = prev_preset


## Every full-screen UI layer is scaled for the phone like the HUD (UITheme.fit_root); the build picker,
## placement hint, sleep dialog and prologue/act-card overlay used to render at 1:1 (≈1 mm text on an S25 Ultra).
func _test_phone_scaled_layers() -> void:
	var want := UITheme.ui_scale(get_viewport().get_visible_rect().size, 1180.0, 620.0)
	check(want > 1.3, "mobile preset scales UI up (%.2f)" % want)
	var ui := BuildModeUI.new()
	add_child(ui)
	var r := ui.get_node("Root") as Control
	check(r != null and is_equal_approx(r.scale.x, want), "build UI root scaled for the phone (%.2f)" % (r.scale.x if r else 0.0))
	ui.queue_free()
	var ov: CanvasLayer = (load("res://src/story/cinematic_overlay.gd") as GDScript).new()
	add_child(ov)
	var want2 := UITheme.ui_scale(get_viewport().get_visible_rect().size, 1000.0, 560.0)
	var r2 := ov.get_child(0) as Control
	check(r2 != null and is_equal_approx(r2.scale.x, want2), "cinematic overlay (prologue subtitles, act cards) scaled for the phone")
	ov.queue_free()
	var sl := BuildSleep.new()
	add_child(sl)
	var r3 := sl.get_node("Root") as Control
	check(r3 != null and is_equal_approx(r3.scale.x, want2), "sleep dialog scaled for the phone")
	sl.queue_free()
	Events.ui_screen_closed.emit(&"sleep")
	await get_tree().process_frame


## While placing on touch, Rotate/Place/Menu/Exit sit in the free pocket of the thumb cluster instead of on
## top of the aim / torch buttons (a press there used to hit aim, which leaves build mode).
func _test_build_touch_block_clear_of_thumb_cluster() -> void:
	InputGlyphs.device = InputGlyphs.TOUCH
	Game.state = Game.State.PLAYING
	var tc := (load("res://scenes/ui/touch_controls.tscn") as PackedScene).instantiate() as TouchControls
	add_child(tc)
	check(get_tree().get_first_node_in_group(&"touch_controls") == tc, "touch controls are in the touch_controls group")
	var ui := BuildModeUI.new()
	add_child(ui)
	await get_tree().process_frame
	ui.set_selected(&"campfire")
	await get_tree().process_frame
	await get_tree().process_frame
	var txf := tc.root.get_global_transform_with_canvas()
	var tk := txf.x.length()
	var n := 0
	var clear := true
	for b in ui.find_children("*", "Button", true, false):
		var btn := b as Button
		if not btn.is_visible_in_tree() or btn.text == "Build":
			continue
		n += 1
		var rect := btn.get_global_rect()
		for id in TouchControls.BUTTONS:
			var c := txf * tc.button_center(id)
			var rad := tc.button_radius(id) * tk
			var closest := Vector2(clampf(c.x, rect.position.x, rect.end.x), clampf(c.y, rect.position.y, rect.end.y))
			if closest.distance_to(c) < rad:
				clear = false
				print("  overlap: build button '%s' %s vs touch %s" % [btn.text, rect, id])
		var vp := get_viewport().get_visible_rect()
		if not vp.encloses(rect):
			clear = false
			print("  off-screen: build button '%s' %s" % [btn.text, rect])
	check(n == 5, "five touch build buttons shown while placing (%d)" % n)
	check(clear, "touch build buttons don't cover the thumb cluster and stay on screen")
	ui.queue_free()
	tc.queue_free()
	InputGlyphs.device = InputGlyphs.KEYBOARD
	await get_tree().process_frame


## A long radio line in the touch layout wraps before it reaches the jump button (it used to run under the
## jump / use buttons, which cover the text).
func _test_touch_subtitles_clear_of_thumb_cluster() -> void:
	InputGlyphs.device = InputGlyphs.TOUCH
	var hud := (load("res://scenes/ui/hud.tscn") as PackedScene).instantiate() as HUD
	add_child(hud)
	await get_tree().process_frame
	await get_tree().process_frame
	check(hud.touch_mode and hud.touch_controls != null, "HUD in touch mode with touch controls")
	hud.subtitles.show_line("Mara Voss", "If anyone can hear this, this is Kestrel Station. Please respond, the generator is down and I'm running out of fuel.", 10.0)
	hud.fade_in(0.0)
	for i in 3:
		await get_tree().process_frame
	var tc := hud.touch_controls as TouchControls
	var txf := tc.root.get_global_transform_with_canvas()
	var jump_left := (txf * tc.button_center(&"jump")).x - tc.button_radius(&"jump") * txf.x.length()
	var r := hud.subtitles.get_global_rect()
	check(hud.subtitles.visible and r.end.x < jump_left, "touch subtitles end left of the jump button (%.0f < %.0f)" % [r.end.x, jump_left])
	hud.queue_free()
	InputGlyphs.device = InputGlyphs.KEYBOARD
	await get_tree().process_frame


## A desktop (this test machine) running a "Phone" quality preset still captures the mouse for mouse look and
## starts with keyboard glyphs; only a handheld device goes touch-first.
func _test_desktop_on_phone_preset() -> void:
	check(Settings.is_mobile(), "phone preset selects the cheap render paths (is_mobile)")
	check(not Settings.is_handheld(), "a desktop is not handheld, whatever the preset")
	check(Player.wants_mouse_capture(), "desktop on a phone preset still captures the mouse for mouse look")
	var prev := InputGlyphs.device
	InputGlyphs.device = &""
	check(InputGlyphs.current() == InputGlyphs.KEYBOARD, "desktop on a phone preset starts with keyboard/mouse glyphs")
	InputGlyphs.device = prev


## Settings auto-detect: S25 Ultra (Adreno 830) → mobile_high, MSI Cyborg 15 (RTX 4050/4060 laptop) → high.
func _test_auto_detect() -> void:
	var cases := [
		["Adreno (TM) 830", true, &"mobile_high"],                  # S25 Ultra, Vulkan
		["Qualcomm(R) Adreno(TM) 830 GPU", true, &"mobile_high"],   # other driver spelling
		["Adreno (TM) 750", true, &"mobile_high"],                  # S24 Ultra
		["Adreno (TM) 619", true, &"mobile_low"],
		["Mali-G57 MC2", true, &"mobile_low"],
		["Mali-G720-Immortalis MC12", true, &"mobile_high"],
		["NVIDIA GeForce RTX 4060 Laptop GPU", false, &"high"],     # MSI Cyborg 15 A13V
		["NVIDIA GeForce RTX 4050 Laptop GPU/PCIe/SSE2", false, &"high"],
		["Intel(R) Iris(R) Xe Graphics", false, &"low"],
		["llvmpipe (LLVM 15.0.7, 256 bits)", false, &"medium"],
	]
	for c in cases:
		var got: StringName = Settings.preset_for_gpu(String(c[0]), bool(c[1]))
		check(got == c[2], "auto-detect %s -> %s (got %s)" % [c[0], c[2], got])


func _screen_touch(index: int, pos: Vector2, pressed: bool, _tc: TouchControls = null) -> void:
	var e := InputEventScreenTouch.new()
	e.index = index
	e.position = get_viewport().get_final_transform() * pos      # canvas → window pixels, like a real touch
	e.pressed = pressed
	Input.parse_input_event(e)
	Input.flush_buffered_events()


## A finger on the move stick / look zone / a button must not also press `use` (LMB) through Godot's
## mouse-from-touch emulation: the player would swing the axe or loose an arrow on every first touch.
func _test_emulated_mouse_does_not_fire_use() -> void:
	InputGlyphs.device = InputGlyphs.TOUCH
	Game.state = Game.State.PLAYING
	var tc := (load("res://scenes/ui/touch_controls.tscn") as PackedScene).instantiate() as TouchControls
	add_child(tc)
	await get_tree().process_frame
	tc.set_active(true)
	var xf := tc.root.get_global_transform_with_canvas()
	var stick := xf * Vector2(tc.root.size.x * 0.15, tc.root.size.y * 0.75)
	_screen_touch(0, stick, true, tc)
	await get_tree().process_frame
	check(not Input.is_action_pressed(&"use"), "first finger on the move stick does not press use (emulated LMB)")
	_screen_touch(0, stick, false, tc)
	await get_tree().process_frame
	var look := xf * Vector2(tc.root.size.x * 0.6, tc.root.size.y * 0.4)
	_screen_touch(0, look, true, tc)
	await get_tree().process_frame
	check(not Input.is_action_pressed(&"use"), "first finger in the look zone does not press use")
	_screen_touch(0, look, false, tc)
	await get_tree().process_frame
	# the use button itself still works through the real event path
	_screen_touch(1, xf * tc.button_center(&"use"), true, tc)
	await get_tree().process_frame
	check(Input.is_action_pressed(&"use"), "use button presses use")
	_screen_touch(1, xf * tc.button_center(&"use"), false, tc)
	await get_tree().process_frame
	check(not Input.is_action_pressed(&"use"), "use released on lift")
	tc.release_all()
	tc.queue_free()
	InputGlyphs.device = InputGlyphs.KEYBOARD
	await get_tree().process_frame

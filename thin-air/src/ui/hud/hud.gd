class_name HUD
extends CanvasLayer
## In-world HUD (scenes/ui/hud.tscn = the world's "HUD" part, CONTRACT §4) and owner of the in-game screens.
##
## Shows: vitals rings + status effects (bottom left; top left with touch controls), compass strip with
## discovered POIs and the objective marker + altitude / air temperature / time readout (top), objective
## tracker and notification toasts (top right), centre dot with interaction prompt and hold ring, hotbar
## (bottom centre), subtitles, directional damage markers, and full-screen survival effects driven by the
## player's Vitals (frost as warmth drops, hypoxia tunnel, wet droplets, low-health desaturation with a
## heartbeat throb, red flash on hits). Hidden in photo mode, cinematics, on death and while a full-screen
## UI is open.
##
## Owns (instanced on demand): pause menu (pause), journal (journal), map (map / using the map item), death
## screen (Events.player_died), touch controls (phones / touchscreen use). Tracks journal stats in Game.flags.
##
## Public API (additive): HUD.find() -> HUD, fade_to_black(duration) -> Tween, fade_in(duration) -> Tween,
## is_faded(), set_photo_mode(on), open_journal(tab := ""), open_map(), open_pause(), toggle_hud(visible),
## notify(text, kind) (same as Game.notify), screen_fx_values() (tests).

const PAUSE_SCENE := "res://scenes/ui/pause_menu.tscn"
const JOURNAL_SCENE := "res://scenes/ui/journal.tscn"
const MAP_SCENE := "res://scenes/ui/map_screen.tscn"
const DEATH_SCENE := "res://scenes/ui/death_screen.tscn"
const TOUCH_SCENE := "res://scenes/ui/touch_controls.tscn"
const FX_SHADER := preload("res://src/ui/hud/screen_fx.gdshader")
## Screens that don't hide the HUD (build mode keeps it visible; "hud" is ours).
const OVERLAY_SCREENS: Array[StringName] = [&"build", &"hud", &"photo"]
const MAP_ITEMS: Array[StringName] = [&"map", &"survival_manual"]
const STAT_DISTANCE := &"stat_distance_m"
const STAT_MAX_ALT := &"stat_max_altitude"

static var _instance: HUD = null

var player: Node = null
var touch_mode := false
var photo_mode := false

# widgets
var root: Control
var fx_rect: ColorRect
var fx_mat: ShaderMaterial
var compass: HUDCompass
var readout: Label
var vitals: HUDVitals
var status: HUDStatusEffects
var crosshair: HUDCrosshair
var toasts: HUDToasts
var objectives: HUDObjectives
var subtitles: HUDSubtitles
var damage: HUDDamageIndicator
var hotbar: HUDHotbar
var fps_label: Label
var photo_hint: Label
var right_col: VBoxContainer
var fade_layer: CanvasLayer
var fade_rect: ColorRect

var pause_menu: Node = null
var journal: Node = null
var map_screen: Node = null
var death_screen: Node = null
var touch_controls: Node = null

var _screens := {}                   # open full-screen UIs (ui_screen_opened)
var _screen_closed_frame := -10
var _cinematic := false
var _dead := false
var _user_hidden := false
var _hud_alpha := 1.0
var _slow_t := 0.0
var _slow_dt := 0.0
var _stat_t := 0.0
var _last_pos := Vector3.INF
var _fx := {"frost": 0.0, "hypoxia": 0.0, "wet": 0.0, "low_health": 0.0, "damage": 0.0, "pulse": 0.0, "blackout": 0.0}
var _beat_t := 0.0
var _beat_phase := 0.0
var _time := 0.0
var _fade_tween: Tween
var _death_timer: SceneTreeTimer
var _map_use_armed := false


static func find() -> HUD:
	if _instance != null and is_instance_valid(_instance):
		return _instance
	return null


func _enter_tree() -> void:
	_instance = self
	add_to_group(&"hud")


func _exit_tree() -> void:
	if _instance == self:
		_instance = null


func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()
	_connect_events()
	get_viewport().size_changed.connect(_layout)
	InputGlyphs.bus().device_changed.connect(_on_device_changed)
	touch_mode = InputGlyphs.current() == InputGlyphs.TOUCH
	_apply_settings()
	_layout()
	if touch_mode:
		_ensure_touch_controls()
	objectives.sync_from(Story.objectives)
	# the world appears out of black (loading screen → world); story may immediately take over the fade
	fade_rect.color.a = 1.0
	fade_in(1.2)


# ============================================================================================== build

func _build() -> void:
	fx_rect = ColorRect.new()
	fx_rect.name = "ScreenFX"
	fx_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	fx_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fx_mat = ShaderMaterial.new()
	fx_mat.shader = FX_SHADER
	fx_mat.set_shader_parameter("frost_tex", load("res://assets/ui/fx/frost.png"))
	fx_mat.set_shader_parameter("drops_tex", load("res://assets/ui/fx/droplets.png"))
	fx_rect.material = fx_mat
	fx_rect.visible = false
	add_child(fx_rect)

	root = Control.new()
	root.name = "Root"
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UITheme.get_theme()
	add_child(root)

	damage = HUDDamageIndicator.new()
	damage.name = "Damage"
	root.add_child(damage)
	crosshair = HUDCrosshair.new()
	crosshair.name = "Crosshair"
	root.add_child(crosshair)
	compass = HUDCompass.new()
	compass.name = "Compass"
	root.add_child(compass)
	readout = UITheme.hud_label("", UITheme.FS_SMALL, Color(1, 1, 1, 0.82), "Medium")
	readout.name = "Readout"
	readout.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	readout.add_theme_font_override("font", UITheme.font("Medium"))
	root.add_child(readout)
	right_col = UITheme.vbox(18)
	right_col.name = "RightColumn"
	right_col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(right_col)
	objectives = HUDObjectives.new()
	objectives.name = "Objectives"
	right_col.add_child(objectives)
	toasts = HUDToasts.new()
	toasts.name = "Toasts"
	right_col.add_child(toasts)
	status = HUDStatusEffects.new()
	status.name = "Status"
	root.add_child(status)
	vitals = HUDVitals.new()
	vitals.name = "Vitals"
	root.add_child(vitals)
	hotbar = HUDHotbar.new()
	hotbar.name = "Hotbar"
	root.add_child(hotbar)
	subtitles = HUDSubtitles.new()
	subtitles.name = "Subtitles"
	root.add_child(subtitles)
	fps_label = UITheme.hud_label("", 14, Color(1, 1, 1, 0.7), "Medium")
	fps_label.add_theme_font_override("font", UITheme.mono_font())
	fps_label.name = "FPS"
	root.add_child(fps_label)
	photo_hint = UITheme.hud_label("", UITheme.FS_SMALL, Color(1, 1, 1, 0.8), "Medium")
	photo_hint.name = "PhotoHint"
	add_child(photo_hint)
	photo_hint.visible = false

	fade_layer = CanvasLayer.new()
	fade_layer.name = "Fade"
	fade_layer.layer = 95
	add_child(fade_layer)
	fade_rect = ColorRect.new()
	fade_rect.color = Color(0, 0, 0, 0)
	fade_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fade_layer.add_child(fade_rect)


func _layout() -> void:
	if root == null:
		return
	UITheme.fit_root(root, 1000.0, 560.0)
	var W := root.size.x
	var H := root.size.y
	var m := 34.0
	damage.position = Vector2.ZERO
	damage.size = root.size
	crosshair.position = Vector2.ZERO
	crosshair.size = root.size
	compass.size = Vector2(minf(640.0, W * 0.42), 64.0)
	compass.position = Vector2((W - compass.size.x) * 0.5, 14.0)
	readout.position = Vector2(W * 0.5 - 200.0, compass.position.y + compass.size.y + 2.0)
	readout.size = Vector2(400.0, 24.0)
	right_col.custom_minimum_size.x = 400.0
	right_col.size = Vector2(400.0, 10.0)
	right_col.position = Vector2(W - m - 400.0, 26.0)
	var hb_w := hotbar.custom_minimum_size.x
	hotbar.size = hotbar.custom_minimum_size
	vitals.size = vitals.custom_minimum_size
	if touch_mode:
		# pause button sits in the top-left corner; the right side belongs to the thumb cluster
		vitals.position = Vector2(m + 70.0, 20.0)
		status.position = Vector2(m + 70.0, 20.0 + vitals.size.y + 8.0)
		hotbar.position = Vector2((W - hb_w) * 0.5, H - hotbar.size.y - 22.0)
		# objectives under the status row on the left, toasts drop in under the compass
		_reparent(objectives, root)
		objectives.set_left_aligned(true)
		objectives.size = Vector2(360.0, 10.0)
		objectives.position = Vector2(m + 70.0, status.position.y + 46.0)
		right_col.position = Vector2((W - 400.0) * 0.5, readout.position.y + 34.0)
	else:
		_reparent(objectives, right_col)
		right_col.move_child(objectives, 0)
		objectives.set_left_aligned(false)
		vitals.position = Vector2(m, H - m - vitals.size.y + 10.0)
		status.position = Vector2(m, vitals.position.y - 48.0)
		hotbar.position = Vector2((W - hb_w) * 0.5, H - hotbar.size.y - 26.0)
	hotbar.interactive = touch_mode
	hotbar.always_visible = touch_mode
	crosshair.text_hidden = touch_mode
	fps_label.position = Vector2(12.0, 8.0)


func _reparent(n: Control, to: Node) -> void:
	if n.get_parent() == to:
		return
	if n.get_parent():
		n.get_parent().remove_child(n)
	to.add_child(n)


# ============================================================================================== events

func _connect_events() -> void:
	Events.interaction_prompt.connect(func(t: String, h: float) -> void: crosshair.set_prompt(t, h))
	Events.interaction_progress.connect(func(t: float) -> void: crosshair.set_progress(t))
	Events.notification.connect(func(t: String, k: StringName) -> void: toasts.push(t, k))
	Events.objective_added.connect(func(id: StringName, t: String) -> void: objectives.add_objective(id, t))
	Events.objective_completed.connect(func(id: StringName) -> void: objectives.complete_objective(id))
	Events.subtitle.connect(func(s: String, t: String, d: float) -> void: subtitles.show_line(s, t, d))
	Events.player_damaged.connect(_on_damaged)
	Events.player_died.connect(_on_died)
	Events.player_respawned.connect(_on_respawned)
	Events.ui_screen_opened.connect(_on_screen_opened)
	Events.ui_screen_closed.connect(_on_screen_closed)
	Events.cinematic_started.connect(func(_id: StringName) -> void: _cinematic = true)
	Events.cinematic_ended.connect(func(_id: StringName) -> void: _cinematic = false)
	Events.sleep_started.connect(func(_h: float) -> void: fade_to_black(1.5))
	Events.sleep_ended.connect(func() -> void: fade_in(2.0))
	Events.settings_changed.connect(_apply_settings)
	Events.game_loaded.connect(func(_s: int) -> void: objectives.sync_from(Story.objectives))
	Events.active_item_changed.connect(func(_id: StringName) -> void: hotbar.flash())
	Events.tree_felled.connect(func(_p: Vector3, _s: StringName) -> void: _bump_stat(&"stat_trees"))
	Events.animal_killed.connect(func(_s: StringName, _p: Vector3) -> void: _bump_stat(&"stat_animals"))
	Events.item_crafted.connect(func(_i: StringName, n: int) -> void: _bump_stat(&"stat_crafted", n))
	Events.structure_built.connect(func(_b: StringName, _n: Node3D) -> void: _bump_stat(&"stat_built"))


func _apply_settings() -> void:
	fps_label.visible = bool(Settings.get_value(&"show_fps", false))
	fx_mat.set_shader_parameter("high_quality", not Settings.is_mobile())
	_layout()


func _on_device_changed(d: StringName) -> void:
	var t := d == InputGlyphs.TOUCH
	if t == touch_mode:
		return
	touch_mode = t
	if t:
		_ensure_touch_controls()
	if touch_controls and touch_controls.has_method("set_active"):
		touch_controls.call("set_active", t)
	_layout()


func _on_screen_opened(sc: StringName) -> void:
	if OVERLAY_SCREENS.has(sc):
		return
	_screens[sc] = true


func _on_screen_closed(sc: StringName) -> void:
	if _screens.erase(sc):
		_screen_closed_frame = Engine.get_process_frames()


func _on_damaged(amount: float, type: StringName, source: Node) -> void:
	var directional := source is Node3D and is_instance_valid(source) and not [&"cold", &"hunger", &"thirst",
		&"hypoxia", &"bleed", &"drown", &"fall"].has(type)
	if directional:
		damage.add_hit((source as Node3D).global_position, amount)
	var k := clampf(amount / 22.0, 0.25, 1.0)
	if [&"cold", &"hunger", &"thirst", &"hypoxia", &"bleed"].has(type):
		k *= 0.3
	_fx["damage"] = maxf(float(_fx["damage"]), k)


func _on_died(cause: StringName) -> void:
	_dead = true
	crosshair.set_prompt("", 0.0)
	var alt := 0.0
	var p := _player()
	if p is Node3D:
		alt = (p as Node3D).global_position.y
	_death_timer = get_tree().create_timer(2.4, true, false, true)
	_death_timer.timeout.connect(func() -> void:
		if _dead:
			_show_death(cause, alt))


func _on_respawned() -> void:
	_dead = false
	if death_screen and is_instance_valid(death_screen):
		death_screen.queue_free()
		death_screen = null
	fade_in(1.5)


func _show_death(cause: StringName, alt: float) -> void:
	if death_screen and is_instance_valid(death_screen):
		return
	death_screen = _instance_scene(DEATH_SCENE)
	if death_screen and death_screen.has_method("show_death"):
		death_screen.call("show_death", cause, alt)


# ============================================================================================== public API

## Fades the whole screen to black over `duration` s. Await `.finished` on the returned tween.
func fade_to_black(duration := 1.0) -> Tween:
	return _fade_to(1.0, duration)


## Fades back in from black.
func fade_in(duration := 1.0) -> Tween:
	return _fade_to(0.0, duration)


func is_faded() -> bool:
	return fade_rect.color.a > 0.99


func _fade_to(a: float, duration: float) -> Tween:
	if _fade_tween and _fade_tween.is_valid():
		_fade_tween.kill()
	_fade_tween = create_tween()
	_fade_tween.set_pause_mode(Tween.TWEEN_PAUSE_PROCESS)
	if duration <= 0.0:
		fade_rect.color.a = a
		_fade_tween.tween_interval(0.0)
	else:
		_fade_tween.tween_property(fade_rect, "color:a", a, duration).set_trans(Tween.TRANS_SINE)
	return _fade_tween


func notify(text: String, kind: StringName = &"info") -> void:
	toasts.push(text, kind)


func set_photo_mode(on: bool) -> void:
	photo_mode = on
	photo_hint.visible = on
	if on:
		photo_hint.text = "Photo mode · %s to exit" % InputGlyphs.text_for(&"photo_mode")
		photo_hint.modulate.a = 1.0
		photo_hint.position = Vector2(24, 18)
		var tw := photo_hint.create_tween()
		tw.tween_interval(2.0)
		tw.tween_property(photo_hint, "modulate:a", 0.0, 0.8)
	if touch_controls and touch_controls.has_method("set_hidden_for_photo"):
		touch_controls.call("set_hidden_for_photo", on)


func toggle_hud(v: bool) -> void:
	_user_hidden = not v


func is_hud_visible() -> bool:
	return root.visible and _hud_alpha > 0.01


func screen_fx_values() -> Dictionary:
	return _fx.duplicate()


func open_pause() -> void:
	if pause_menu == null or not is_instance_valid(pause_menu):
		pause_menu = _instance_scene(PAUSE_SCENE)
	if pause_menu and pause_menu.has_method("open"):
		pause_menu.call("open")


func open_journal(tab := "") -> void:
	if journal == null or not is_instance_valid(journal):
		journal = _instance_scene(JOURNAL_SCENE)
	if journal and journal.has_method("open"):
		journal.call("open", tab)


func open_map() -> void:
	var p := _player()
	if p and not _has_any_item(p, MAP_ITEMS) and not bool(Game.get_flag(&"map_known", false)):
		toasts.push("You don't have a map.", &"info")
		return
	if map_screen == null or not is_instance_valid(map_screen):
		map_screen = _instance_scene(MAP_SCENE)
	if map_screen and map_screen.has_method("open"):
		map_screen.call("open")


func _instance_scene(path: String) -> Node:
	if not ResourceLoader.exists(path):
		push_warning("HUD: missing %s" % path)
		return null
	var n: Node = (load(path) as PackedScene).instantiate()
	add_child(n)
	return n


func _ensure_touch_controls() -> void:
	if touch_controls and is_instance_valid(touch_controls):
		return
	touch_controls = _instance_scene(TOUCH_SCENE)


# ============================================================================================== input

func can_open_screen() -> bool:
	return Game.state == Game.State.PLAYING and not get_tree().paused and _screens.is_empty() \
		and not _dead and not _cinematic and Engine.get_process_frames() - _screen_closed_frame > 1 \
		and _player() != null


func _unhandled_input(event: InputEvent) -> void:
	InputGlyphs.track(event)
	if event.is_echo():
		return
	if event.is_action_pressed(&"pause"):
		if photo_mode:
			set_photo_mode(false)
			get_viewport().set_input_as_handled()
		elif can_open_screen():
			open_pause()
			get_viewport().set_input_as_handled()
	elif event.is_action_pressed(&"journal") and can_open_screen():
		open_journal()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed(&"map") and can_open_screen():
		open_map()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed(&"photo_mode") and (can_open_screen() or photo_mode):
		set_photo_mode(not photo_mode)
		get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	# device tracking must see events even when a screen consumes them
	InputGlyphs.track(event)


## Touch buttons inject actions with Input.action_press (no InputEvent): poll those too.
func _poll_injected() -> void:
	if touch_controls == null or not touch_mode:
		return
	if Input.is_action_just_pressed(&"pause") and can_open_screen():
		open_pause()
	elif Input.is_action_just_pressed(&"journal") and can_open_screen():
		open_journal()
	elif Input.is_action_just_pressed(&"map") and can_open_screen():
		open_map()


# ============================================================================================== frame

func _player() -> Node:
	if player != null and is_instance_valid(player):
		return player
	var p: Node = Game.player
	if p != null and is_instance_valid(p):
		return p
	return null


func _process(delta: float) -> void:
	_time += delta
	_poll_injected()
	var p := _player()
	# ---- visibility
	var show := not (photo_mode or _cinematic or _dead or _user_hidden or not _screens.is_empty())
	_hud_alpha = move_toward(_hud_alpha, 1.0 if show else 0.0, delta * (5.0 if show else 12.0))
	root.modulate.a = _hud_alpha
	root.visible = _hud_alpha > 0.001
	# ---- map item: using the held map opens the map screen
	if p and can_open_screen() and p.has_method("get_active_item") and StringName(p.call("get_active_item")) == &"map":
		if Input.is_action_just_pressed(&"use"):
			_map_use_armed = true
		elif _map_use_armed and not Input.is_action_pressed(&"use"):
			_map_use_armed = false
			open_map()
	else:
		_map_use_armed = false
	if p == null:
		_update_fx(delta, null)
		_place_subtitles()
		return
	var p3 := p as Node3D
	var cam: Camera3D = p.call("get_camera") if p.has_method("get_camera") else get_viewport().get_camera_3d()
	damage.camera = cam
	# ---- compass (every frame, cheap: redraws only on change)
	if root.visible and cam:
		var fwd := -cam.global_transform.basis.z
		compass.set_state(HUDCompass.bearing_of(fwd), _poi_markers(p3.global_position), _objective_marker(p3.global_position))
	# ---- slow updates (10 Hz)
	_slow_t += delta
	_slow_dt += delta
	var v: Object = p.get("vitals")
	if _slow_t >= 0.1:
		_slow_t = 0.0
		if v:
			vitals.sample(v, p3.global_position.y, _slow_dt)
			var eff: Variant = v.get("effects")
			if eff is Dictionary:
				status.sync(eff)
		hotbar.sample(p)
		_update_readout(p3)
		if fps_label.visible:
			fps_label.text = "%d fps  %.1f ms" % [Engine.get_frames_per_second(), 1000.0 / maxf(1.0, Engine.get_frames_per_second())]
		_slow_dt = 0.0
	_update_fx(delta, v)
	_place_subtitles()
	# ---- stats (2 Hz)
	_stat_t += delta
	if _stat_t >= 0.5 and Game.state == Game.State.PLAYING:
		_stat_t = 0.0
		_track_stats(p3.global_position)


func _place_subtitles() -> void:
	if not subtitles.visible:
		return
	var sz := subtitles.get_combined_minimum_size()
	subtitles.size = sz
	var bottom := hotbar.position.y - (18.0 if hotbar.always_visible or hotbar.modulate.a > 0.0 else -40.0)
	subtitles.position = Vector2((root.size.x - sz.x) * 0.5, bottom - sz.y)


func _update_readout(p: Node3D) -> void:
	var pos := p.global_position
	var parts: PackedStringArray = []
	parts.append(UITheme.metres(pos.y))
	if Climate.has_method("get_air_temperature"):
		parts.append(UITheme.celsius(Climate.get_air_temperature(pos)))
	if Climate.has_method("get_time_string"):
		parts.append(Climate.get_time_string())
	readout.text = "     ".join(parts)


## Discovered POIs (Story.discovered_pois + TerrainData.get_poi) as compass markers.
func _poi_markers(from: Vector3) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for id in Story.discovered_pois:
		var poi: Dictionary = TerrainData.get_poi(id)
		if poi.is_empty() or not poi.has("position"):
			continue
		var pos: Vector3 = poi["position"]
		var d := pos - from
		var dist := Vector2(d.x, d.z).length()
		if dist < float(poi.get("radius", 20.0)) * 0.6:
			continue
		out.append({"bearing": HUDCompass.bearing_of(d), "distance": dist, "icon": poi_icon(String(id)),
			"label": String(poi.get("name", ""))})
	return out


## First open objective with a location: keys "position" (Vector3 or [x,y,z]), "poi" or "target" (POI id).
func _objective_marker(from: Vector3) -> Dictionary:
	var loc := objective_location()
	if loc == Vector3.INF:
		return {}
	var d := loc - from
	return {"bearing": HUDCompass.bearing_of(d), "distance": Vector2(d.x, d.z).length()}


static func objective_location() -> Vector3:
	for o in Story.objectives:
		if bool(o.get("done", false)):
			continue
		var p: Variant = o.get("position", null)
		if p is Vector3:
			return p
		if p is Array and (p as Array).size() >= 3:
			return Vector3(float(p[0]), float(p[1]), float(p[2]))
		var pid := String(o.get("poi", o.get("target", "")))
		if pid != "":
			var poi: Dictionary = TerrainData.get_poi(StringName(pid))
			if poi.has("position"):
				return poi["position"]
	return Vector3.INF


static func poi_icon(id: String) -> String:
	var s := id.to_lower()
	for pair in [["crash", "crash"], ["cabin", "cabin"], ["ranger", "cabin"], ["lake", "lake"], ["lookout", "lookout"],
			["mine", "mine"], ["station", "station"], ["relay", "station"], ["summit", "peak"], ["peak", "peak"],
			["bivouac", "camp"], ["camp", "camp"], ["cave", "cave"], ["icefall", "glacier"], ["glacier", "glacier"]]:
		if s.contains(pair[0]):
			return pair[1]
	return "poi"


func _has_any_item(p: Node, list: Array[StringName]) -> bool:
	var inv: Variant = p.get("inventory")
	if inv == null:
		return true
	for id in list:
		if (inv as Object).call("has", id, 1):
			return true
	var eq: Variant = p.get("equipment")
	if eq is Dictionary:
		for id in list:
			if (eq as Dictionary).values().has(id):
				return true
	return false


func _bump_stat(key: StringName, n := 1) -> void:
	Game.set_flag(key, int(Game.get_flag(key, 0)) + n)


func _track_stats(pos: Vector3) -> void:
	if _last_pos != Vector3.INF:
		var d := Vector2(pos.x - _last_pos.x, pos.z - _last_pos.z).length()
		if d < 30.0 and d > 0.05:      # ignore teleports / respawns
			Game.set_flag(STAT_DISTANCE, float(Game.get_flag(STAT_DISTANCE, 0.0)) + d)
	_last_pos = pos
	if pos.y > float(Game.get_flag(STAT_MAX_ALT, 0.0)):
		Game.set_flag(STAT_MAX_ALT, pos.y)


# ============================================================================================== screen effects

## Maps the player's Vitals to effect strengths (pure; tests call it).
static func fx_targets(v: Object) -> Dictionary:
	var out := {"frost": 0.0, "hypoxia": 0.0, "wet": 0.0, "low_health": 0.0, "blackout": 0.0}
	if v == null:
		return out
	var warmth := float(v.get("warmth"))
	var o2 := float(v.get("oxygen"))
	var hp := float(v.get("health"))
	out["frost"] = clampf((42.0 - warmth) / 37.0, 0.0, 1.0)
	out["hypoxia"] = clampf((62.0 - o2) / 52.0, 0.0, 1.0)
	out["blackout"] = clampf((10.0 - o2) / 10.0, 0.0, 1.0) * 0.85
	out["low_health"] = clampf((38.0 - hp) / 30.0, 0.0, 1.0)
	var eff: Variant = v.get("effects")
	if eff is Dictionary and (eff as Dictionary).has(&"wet"):
		var e: Dictionary = eff[&"wet"]
		var t := float(e.get("time", 0.0))
		out["wet"] = clampf(float(e.get("strength", 1.0)) * (t / 240.0 if t != INF else 1.0), 0.15, 1.0)
	return out


func _update_fx(delta: float, v: Object) -> void:
	var tgt := fx_targets(v) if not _dead else {"frost": _fx["frost"], "hypoxia": 0.0, "wet": 0.0, "low_health": 1.0, "blackout": 0.0}
	var strength := float(Settings.get_value(&"screen_fx", 1.0))
	for k in ["frost", "hypoxia", "wet", "low_health", "blackout"]:
		var rate := 0.25 if k == "frost" else 0.8
		_fx[k] = move_toward(float(_fx[k]), float(tgt[k]) * strength, delta * rate)
	_fx["damage"] = maxf(0.0, float(_fx["damage"]) - delta * 1.6)
	# heartbeat throb (lub-dub) in step with the player's heartbeat sound at low health
	var lh := float(_fx["low_health"])
	if lh > 0.0 and v != null:
		var hp := float(v.get("health"))
		var period := lerpf(0.75, 1.1, clampf(hp / 28.0, 0.0, 1.0))
		_beat_phase += delta / period
		if _beat_phase >= 1.0:
			_beat_phase -= 1.0
		var t1 := _beat_phase * period
		var t2 := t1 - 0.2
		_fx["pulse"] = exp(-t1 * 9.0) + (0.6 * exp(-t2 * 9.0) if t2 > 0.0 else 0.0)
	else:
		_fx["pulse"] = 0.0
	var active := false
	for k in ["frost", "hypoxia", "wet", "low_health", "damage", "blackout"]:
		if float(_fx[k]) > 0.004:
			active = true
			break
	# screen effects are part of the world view: keep them under menus but hide them in photo mode only if asked
	fx_rect.visible = active
	if active:
		var vp := get_viewport().get_visible_rect().size
		fx_mat.set_shader_parameter("aspect", vp.x / maxf(1.0, vp.y))
		fx_mat.set_shader_parameter("t", _time)
		for k in _fx:
			fx_mat.set_shader_parameter(k, float(_fx[k]))

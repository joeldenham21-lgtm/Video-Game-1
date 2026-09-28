extends Control
## First-launch download screen for the Lite build (scenes/ui/content_download.tscn). The main menu hands over
## to it while Content.needs_download(); it starts the download at once, shows progress, speed and time left,
## offers "Try again" after a failure (the download resumes), then mounts the pack and opens the main menu.

var root: Control
var _title: Label
var _body: Label
var _status: Label
var _line: Control
var _retry: Button
var _shown := 0.0
var _t := 0.0
var _rate := 0.0              # bytes/s, smoothed
var _rate_bytes := -1
var _rate_t := 0.0
var _leaving := false


func _ready() -> void:
	Game.state = Game.State.MENU
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.02, 0.024, 0.03)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var grad := TextureRect.new()
	var gt := GradientTexture2D.new()
	var g := Gradient.new()
	g.set_color(0, Color(0.09, 0.11, 0.14))
	g.set_color(1, Color(0.02, 0.024, 0.03))
	gt.gradient = g
	gt.fill_from = Vector2(0.5, 0.0)
	gt.fill_to = Vector2(0.5, 1.0)
	grad.texture = gt
	grad.set_anchors_preset(Control.PRESET_FULL_RECT)
	grad.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	add_child(grad)
	root = Control.new()
	root.theme = UITheme.get_theme()
	add_child(root)
	var v := UITheme.vbox(14)
	v.name = "Column"
	root.add_child(v)
	v.add_child(UITheme.caps("Thin Air", 16, UITheme.TEXT, 8, "Medium"))
	_title = UITheme.label("Downloading the mountain", UITheme.FS_H2, UITheme.TEXT, "Light")
	v.add_child(_title)
	_body = UITheme.label("", UITheme.FS_BODY, UITheme.TEXT_DIM, "Light")
	_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body.custom_minimum_size.x = 760
	_body.text = ("A one-time download of the game's terrain, textures, music and sound (%s). Wi-Fi is best. " +
		"Keep the app open — if it's interrupted, it picks up where it left off.") % Content.size_text()
	v.add_child(_body)
	var gap := Control.new()
	gap.custom_minimum_size.y = 18
	v.add_child(gap)
	_line = Control.new()
	_line.name = "Line"
	_line.custom_minimum_size = Vector2(760, 4)
	_line.draw.connect(_draw_line)
	v.add_child(_line)
	_status = UITheme.label("", UITheme.FS_SMALL, UITheme.TEXT_DIM, "Regular")
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size.x = 760
	v.add_child(_status)
	_retry = UITheme.menu_button("Try again")
	_retry.visible = false
	_retry.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_retry.pressed.connect(_start)
	v.add_child(_retry)
	get_viewport().size_changed.connect(_layout)
	_layout()
	Content.failed.connect(_on_failed)
	Content.verified.connect(_on_verified)
	DisplayServer.screen_set_keep_on(true)
	_start()


func _exit_tree() -> void:
	DisplayServer.screen_set_keep_on(false)


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var W := root.size.x
	var H := root.size.y
	var col: Control = root.get_node("Column")
	col.size = col.get_combined_minimum_size()
	var m := clampf(W * 0.08, 48.0, 160.0)
	col.position = Vector2(m, (H - col.size.y) * 0.5)


func _start() -> void:
	_retry.visible = false
	_title.text = "Downloading the mountain"
	_status.text = "Connecting…"
	_rate_bytes = -1
	_rate = 0.0
	if not Content.needs_download():
		_open_menu()
		return
	if Content.state == Content.State.READY:
		_on_verified()
		return
	Content.download()


func _process(delta: float) -> void:
	_t += delta
	var total := maxi(Content.total, 1)
	var p := clampf(float(Content.done) / total, 0.0, 1.0)
	_shown = move_toward(_shown, p, maxf(delta * 0.5, (p - _shown) * 0.2))
	_line.queue_redraw()
	if Content.state == Content.State.DOWNLOADING:
		_rate_t += delta
		if _rate_bytes < 0:
			_rate_bytes = Content.done
			_rate_t = 0.0
		elif _rate_t >= 1.0:
			var r := (Content.done - _rate_bytes) / _rate_t
			_rate = r if _rate <= 0.0 else lerpf(_rate, r, 0.3)
			_rate_bytes = Content.done
			_rate_t = 0.0
		var s := "%d of %d MB" % [roundi(Content.done / 1e6), roundi(Content.total / 1e6)]
		if _rate > 1000.0:
			var left := (Content.total - Content.done) / _rate
			s += "  ·  %.1f MB/s  ·  %s left" % [_rate / 1e6, _eta(left)]
		elif Content.done == 0:
			s = "Connecting…"
		_status.text = s
	elif Content.state == Content.State.VERIFYING:
		_status.text = "Checking the download…"


func _eta(seconds: float) -> String:
	if seconds >= 3600.0:
		return "%d h %d min" % [int(seconds / 3600.0), int(fmod(seconds, 3600.0) / 60.0)]
	if seconds >= 60.0:
		return "%d min" % ceili(seconds / 60.0)
	return "%d s" % maxi(ceili(seconds), 1)


func _draw_line() -> void:
	var w := _line.size.x
	_line.draw_rect(Rect2(Vector2.ZERO, Vector2(w, 3)), Color(1, 1, 1, 0.14))
	if Content.done > 0 or Content.state == Content.State.VERIFYING:
		_line.draw_rect(Rect2(Vector2.ZERO, Vector2(w * _shown, 3)), UITheme.ACCENT)
		return
	var ph := fposmod(_t * 0.45, 1.0)          # indeterminate sweep while connecting
	var seg := w * 0.28
	var x0 := -seg + (w + seg) * ph
	var a := maxf(0.0, x0)
	var b := minf(w, x0 + seg)
	if b > a:
		_line.draw_rect(Rect2(Vector2(a, 0), Vector2(b - a, 3)), UITheme.ACCENT)


func _on_failed(message: String) -> void:
	_title.text = "Download paused"
	_status.text = message
	_retry.visible = true
	_retry.grab_focus()
	_layout()


func _on_verified() -> void:
	_status.text = "Opening the mountain…"
	_shown = 1.0
	if Content.finish():
		_open_menu()


func _open_menu() -> void:
	if _leaving:
		return
	_leaving = true
	get_tree().change_scene_to_file.call_deferred(Game.MENU_SCENE)

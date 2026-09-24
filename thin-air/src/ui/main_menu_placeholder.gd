extends Control
## Placeholder main menu — replaced by the UI workstream (scenes/ui/main_menu.tscn).

func _ready() -> void:
	var ui_scene := "res://scenes/ui/main_menu.tscn"
	if ResourceLoader.exists(ui_scene):
		get_tree().change_scene_to_file.call_deferred(ui_scene)
		return
	Game.state = Game.State.MENU
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.04, 0.05, 0.06)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.add_theme_constant_override("separation", 14)
	add_child(box)
	var title := Label.new()
	title.text = "THIN AIR"
	title.add_theme_font_size_override("font_size", 64)
	box.add_child(title)
	for entry in [["New Game", Game.new_game], ["Continue", Game.continue_game], ["Quit", get_tree().quit]]:
		var b := Button.new()
		b.text = entry[0]
		b.custom_minimum_size = Vector2(320, 56)
		b.pressed.connect(entry[1])
		if entry[0] == "Continue":
			b.disabled = not Save.has_save(0)
		box.add_child(b)

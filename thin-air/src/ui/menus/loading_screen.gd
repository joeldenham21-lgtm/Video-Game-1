class_name LoadingScreen
extends CanvasLayer
## Loading screen (scenes/ui/loading_screen.tscn; Game instances it while the world loads): a full-bleed
## mountain vista (assets/ui/loading_vista.jpg, rendered from the menu vista), a subtle indeterminate
## progress line and rotating survival tips.

const TIPS := [
	"Wet clothes lose heat many times faster than dry ones. Dry off by a fire before you move on.",
	"Air cools about 6.5 °C for every 1,000 m you climb. Dress for where you're going, not where you are.",
	"Boil snow or stream water before you drink it. Raw water can make you sick.",
	"Wolves test you before they commit. Keep a fire lit or a flare in reach after dark.",
	"Above the treeline there is no firewood. Carry fuel before you climb.",
	"Above 2,800 m the air is thin. Rest often, and carry oxygen for the summit.",
	"Wind chill can make −5 °C feel like −20 °C. A windbreak or shelter changes everything.",
	"A lean-to and a fire will get you through a night. Sleeping in a bed lets you save.",
	"The survey scanner teaches you blueprints. Hold it on wreckage, tools and wildlife.",
	"Crampons and an ice axe are the only way up the icefall.",
	"Night is genuinely dark. Carry a torch, and mind the ground in front of you.",
	"Hot food and drink warm you from the inside for a while.",
	"Deep snow is slow and exhausting. Ridges and trails are faster.",
	"Bleeding won't stop on its own. Bandage it.",
	"The compass needle points to north. On the map, north is up.",
	"Blizzards above the treeline kill. When the sky closes in, dig in.",
]
const TIP_SECONDS := 7.0

var _tip: Label
var _line: Control
var _t := 0.0
var _tip_i := 0
var root: Control


func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	var bg := ColorRect.new()
	bg.color = Color(0.02, 0.024, 0.03)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var img_path := "res://assets/ui/loading_vista.jpg"
	if ResourceLoader.exists(img_path):
		var tr := TextureRect.new()
		tr.texture = load(img_path)
		tr.set_anchors_preset(Control.PRESET_FULL_RECT)
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		add_child(tr)
	# bottom gradient for legibility
	var grad := TextureRect.new()
	var gt := GradientTexture2D.new()
	var g := Gradient.new()
	g.set_color(0, Color(0.01, 0.012, 0.016, 0.0))
	g.set_color(1, Color(0.01, 0.012, 0.016, 0.85))
	gt.gradient = g
	gt.fill_from = Vector2(0, 0.45)
	gt.fill_to = Vector2(0, 1)
	grad.texture = gt
	grad.set_anchors_preset(Control.PRESET_FULL_RECT)
	grad.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	add_child(grad)
	root = Control.new()
	root.theme = UITheme.get_theme()
	add_child(root)
	var v := UITheme.vbox(10)
	v.name = "Column"
	root.add_child(v)
	v.add_child(UITheme.caps("Thin Air", 16, UITheme.TEXT, 8, "Medium"))
	_tip = UITheme.label("", UITheme.FS_LEAD, UITheme.TEXT, "Light")
	_tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_tip.custom_minimum_size.x = 820
	v.add_child(_tip)
	_line = Control.new()
	_line.name = "Line"
	_line.draw.connect(_draw_line)
	root.add_child(_line)
	var l := UITheme.caps("Loading", 13, UITheme.TEXT_DIM, 4)
	l.name = "LoadingLabel"
	root.add_child(l)
	_tip_i = int(Time.get_unix_time_from_system()) % TIPS.size()
	_tip.text = TIPS[_tip_i]
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	UITheme.fit_root(root, 1000.0, 560.0)
	var W := root.size.x
	var H := root.size.y
	var col: Control = root.get_node("Column")
	col.size = col.get_combined_minimum_size()
	var m := clampf(W * 0.06, 40.0, 120.0)
	col.position = Vector2(m, H - m - col.size.y)
	_line.position = Vector2(W - m - 240.0, H - m - 4.0)
	_line.size = Vector2(240.0, 3.0)
	var ll: Control = root.get_node("LoadingLabel")
	ll.size = ll.get_combined_minimum_size()
	ll.position = Vector2(W - m - ll.size.x, H - m - 30.0)


func _draw_line() -> void:
	var w := _line.size.x
	_line.draw_rect(Rect2(Vector2.ZERO, Vector2(w, 2)), Color(1, 1, 1, 0.14))
	var p := fposmod(_t * 0.45, 1.0)
	var seg := w * 0.28
	var x0 := -seg + (w + seg) * p
	var a := maxf(0.0, x0)
	var b := minf(w, x0 + seg)
	if b > a:
		_line.draw_rect(Rect2(Vector2(a, 0), Vector2(b - a, 2)), UITheme.ACCENT)


func _process(delta: float) -> void:
	_t += delta
	_line.queue_redraw()
	if fmod(_t, TIP_SECONDS) < delta:
		_tip_i = (_tip_i + 1) % TIPS.size()
		_tip.text = TIPS[_tip_i]

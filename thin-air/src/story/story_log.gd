class_name StoryLogProp
extends StaticBody3D
## A readable crew log at a Log_* socket (data/logs.json): a dictaphone for recordings, a logbook/notebook,
## a clipboard, or a loose sheet of paper; the station whiteboard is modelled on the wall, so it is an invisible
## reading volume. Interact → Story.find_log (journal + recording playback); documents open the journal.
## Small procedural meshes (a few dozen triangles), visibility-ranged, one shared material per kind.

var log_id: StringName
var kind := "paper"
var title := ""
var voiced := false

static var _mats: Dictionary = {}


func setup(id: StringName, info: Dictionary) -> void:
	log_id = id
	title = String(info.get("title", String(id).capitalize()))
	voiced = info.get("voice", null) != null
	kind = kind_for(id, info)
	name = "Log_%s" % String(id)
	collision_layer = 1 << 4
	collision_mask = 0
	add_to_group(&"interactable")
	add_to_group(&"story_log")
	var size := _build_visual()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size + Vector3(0.12, 0.12, 0.12)
	cs.shape = box
	cs.position.y = 0.0 if kind == "wall" else size.y * 0.5
	add_child(cs)


static func kind_for(id: StringName, info: Dictionary) -> String:
	var s := String(id)
	if String(info.get("kind", "")) == "recording" or info.get("voice", null) != null:
		return "dictaphone"
	if s.contains("whiteboard"):
		return "wall"
	if s.contains("fuel_log"):
		return "clipboard"
	if s.contains("logbook") or s.contains("notebook") or s.contains("diary"):
		return "book"
	return "paper"


func get_interact_prompt(_player: Node) -> String:
	var again := Story.found_logs.has(log_id)
	if voiced:
		return ("Play recording again: %s" if again else "Play recording: %s") % title
	return ("Read again: %s" if again else "Read: %s") % title


func interact(_player: Node) -> void:
	Story.find_log(log_id)
	Audio.play_sfx(&"radio_ptt" if voiced else &"pickup", global_position, -6.0)
	if not voiced:
		var hud := HUD.find()
		if hud:
			hud.open_journal("logs")



func _build_visual() -> Vector3:
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.visibility_range_end = 45.0
	mi.visibility_range_end_margin = 4.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var size := Vector3(0.21, 0.004, 0.297)
	match kind:
		"dictaphone":
			size = Vector3(0.048, 0.02, 0.115)
			var st := _box(size, _mat("plastic", Color(0.07, 0.075, 0.08), 0.55, 0.0))
			mi.mesh = st
			# red record LED + silver speaker grille
			var led := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 0.0035
			sm.height = 0.007
			sm.radial_segments = 6
			sm.rings = 3
			sm.material = _mat("led", Color(0.9, 0.08, 0.05), 0.3, 0.0, 2.5)
			led.mesh = sm
			led.position = Vector3(0.012, 0.021, -0.045)
			led.visibility_range_end = 25.0
			add_child(led)
			var grille := MeshInstance3D.new()
			grille.mesh = _box(Vector3(0.034, 0.002, 0.03), _mat("grille", Color(0.55, 0.56, 0.57), 0.4, 0.8))
			grille.position = Vector3(0.0, 0.021, 0.03)
			grille.visibility_range_end = 25.0
			add_child(grille)
		"book":
			size = Vector3(0.155, 0.022, 0.215)
			mi.mesh = _box(size, _mat("cover", Color(0.13, 0.19, 0.14), 0.8, 0.0))
			var pages := MeshInstance3D.new()
			pages.mesh = _box(Vector3(0.147, 0.016, 0.207), _mat("paper", Color(0.86, 0.84, 0.78), 0.9, 0.0))
			pages.position = Vector3(0.005, 0.011, 0.0)
			pages.visibility_range_end = 25.0
			add_child(pages)
		"clipboard":
			size = Vector3(0.23, 0.012, 0.32)
			mi.mesh = _box(size, _mat("board", Color(0.36, 0.25, 0.14), 0.7, 0.0))
			var sheet := MeshInstance3D.new()
			sheet.mesh = _box(Vector3(0.21, 0.002, 0.28), _mat("paper", Color(0.86, 0.84, 0.78), 0.9, 0.0))
			sheet.position = Vector3(0.0, 0.007, 0.012)
			add_child(sheet)
			var clip := MeshInstance3D.new()
			clip.mesh = _box(Vector3(0.08, 0.012, 0.03), _mat("grille", Color(0.55, 0.56, 0.57), 0.4, 0.8))
			clip.position = Vector3(0.0, 0.012, -0.14)
			add_child(clip)
		"wall":
			size = Vector3(0.9, 0.6, 0.1)
			mi.mesh = null
		_:
			mi.mesh = _box(size, _mat("paper", Color(0.86, 0.84, 0.78), 0.9, 0.0))
			mi.rotation.y = 0.2
	if mi.mesh:
		add_child(mi)
	else:
		mi.queue_free()
	# meshes are centred boxes: lift them so they rest on the socket
	for c in get_children():
		if c is MeshInstance3D:
			(c as MeshInstance3D).position.y += size.y * 0.5
	return size


static func _box(size: Vector3, m: Material) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	b.material = m
	return b


static func _mat(key: String, c: Color, rough: float, metal: float, emit := 0.0) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if emit > 0.0:
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = emit
	_mats[key] = m
	return m

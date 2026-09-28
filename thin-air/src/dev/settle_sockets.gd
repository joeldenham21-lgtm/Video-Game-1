extends Node
## Socket settle tool: snaps the Loot_* / Log_* markers of every story location (scenes/poi/<id>.tscn) down onto
## what is under them (SocketSupport: the location's render meshes + terrain at its world placement), so loot and
## crew logs rest on tables, shelves, floors and the ground instead of hovering where a socket height was guessed.
## Run after tools/blender/poi/build.py (which rewrites the scenes):
##   godot --headless --path thin-air res://scenes/dev/settle_sockets.tscn [-- --check]
## --check: report only (exit code 1 when a socket would move).

const TOL := 0.02


func _ready() -> void:
	var check := OS.get_cmdline_user_args().has("--check")
	var S = load("res://scenes/poi/structures.gd")
	var moved := 0
	for id: StringName in S.SITES:
		var path := "res://scenes/poi/%s.tscn" % id
		if not ResourceLoader.exists(path):
			continue
		var site := (load(path) as PackedScene).instantiate() as Node3D
		add_child(site)
		site.global_transform = S.placement(id)
		var d := SocketSupport.build_space(site)
		var text := FileAccess.get_file_as_string(ProjectSettings.globalize_path(path))
		var changed := false
		for m in SocketSupport.loose_sockets(site):
			var y := SocketSupport.support_y(d, m.global_position)
			if y == -INF:
				print("SETTLE %s %s: no support within %.1f m (left)" % [id, m.name, SocketSupport.REACH])
				continue
			var gap := m.global_position.y - y
			if absf(gap) <= TOL:
				continue
			moved += 1
			var ly := snappedf(m.position.y - gap, 0.001)
			print("SETTLE %s %s: %.3f -> %.3f (gap %.2f m)" % [id, m.name, m.position.y, ly, gap])
			if not check:
				var nt := _set_marker_y(text, String(m.name), ly)
				changed = changed or nt != text
				text = nt
		SocketSupport.free_space(d)
		site.queue_free()
		if changed:
			var f := FileAccess.open(ProjectSettings.globalize_path(path), FileAccess.WRITE)
			f.store_string(text)
			f.close()
	print("SETTLE done: %d socket(s) %s" % [moved, "off their support" if check else "moved"])
	get_tree().quit(1 if check and moved > 0 else 0)


## Rewrites the origin y of the Marker3D block `[node name="<n>" type="Marker3D" parent="Sockets"]`.
static func _set_marker_y(text: String, n: String, y: float) -> String:
	var head := '[node name="%s" type="Marker3D" parent="Sockets"]' % n
	var at := text.find(head)
	if at < 0:
		return text
	var t0 := text.find("transform = Transform3D(", at)
	var t1 := text.find(")", t0)
	if t0 < 0 or t1 < 0 or text.find("[node", at + head.length()) < t0:
		return text
	var inner := text.substr(t0 + 24, t1 - t0 - 24)
	var parts := inner.split(",")
	if parts.size() != 12:
		return text
	parts[10] = " " + String.num(y, 3)
	return text.substr(0, t0 + 24) + ",".join(parts) + text.substr(t1)

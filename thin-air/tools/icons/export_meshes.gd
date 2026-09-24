extends SceneTree
## Exports every item and buildable model for the icon renderer:
##   - assets/models/items/<id>.glb when that hero model exists (rendered as-is), else
##   - the procedural ItemVisuals model as OBJ (materials referenced by name from materials.json).
## Writes tools/icons/_cache/<id>.obj + tools/icons/_cache/manifest.json.
##
##   godot --headless --path thin-air -s $PWD/thin-air/tools/icons/export_meshes.gd -- [--ids=stick,log] [--detail=2]
## Run `godot --headless --path thin-air --import` first so class_names are registered.


const EXTRA_IDS: Array[String] = ["fabricator"]


func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var kv := String(a).trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var detail := float(args.get("detail", "2.0"))
	var out_dir := ProjectSettings.globalize_path("res://tools/icons/_cache")
	DirAccess.make_dir_recursive_absolute(out_dir)
	var items := _read("res://data/items.json")
	var builds := _read("res://data/buildables.json")
	var ids: Array[String] = []
	for k in items:
		ids.append(String(k))
	for k in builds:
		if not ids.has(String(k)):
			ids.append(String(k))
	for k in EXTRA_IDS:          # crafting stations that are neither items nor buildables
		if not ids.has(k):
			ids.append(k)
	if args.has("ids"):
		var want := String(args["ids"]).split(",")
		ids = ids.filter(func(x: String) -> bool: return want.has(x))
	var manifest := {}
	var total_tris := 0
	for id in ids:
		var cat := String((items.get(id, {}) as Dictionary).get("category", "placeable"))
		var entry := {"pose": ItemVisuals.icon_pose(StringName(id)), "category": cat}
		var glb := "res://assets/models/items/%s.glb" % id
		if FileAccess.file_exists(glb):
			entry["glb"] = ProjectSettings.globalize_path(glb)
		else:
			var b := ItemMeshBuilder.new(detail)
			if not ItemVisuals.populate(b, StringName(id), cat):
				continue
			b.recenter(true)
			total_tris += b.triangle_count()
			var mesh := b.commit(false)
			var path := out_dir.path_join(id + ".obj")
			_write_obj(mesh, path, id)
			entry["obj"] = path
			entry["tris"] = b.triangle_count()
		manifest[id] = entry
	var f := FileAccess.open(out_dir.path_join("manifest.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify(manifest, "\t"))
	f.close()
	print("exported %d models (%d triangles at detail %.1f) -> %s" % [manifest.size(), total_tris, detail, out_dir])
	quit()


func _read(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var d: Variant = JSON.parse_string(f.get_as_text())
	return d if d is Dictionary else {}


## Wavefront OBJ: one object per surface, `usemtl <material key>`. Godot's clockwise front faces are
## flipped to OBJ's counter-clockwise.
func _write_obj(mesh: ArrayMesh, path: String, id: String) -> void:
	var lines := PackedStringArray()
	lines.append("# THIN AIR procedural item model: %s" % id)
	var base := 1
	for si in mesh.get_surface_count():
		var arr := mesh.surface_get_arrays(si)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var n: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
		var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
		var key := mesh.surface_get_name(si)
		lines.append("o %s_%d" % [key, si])
		lines.append("usemtl %s" % key)
		for p in v:
			lines.append("v %.5f %.5f %.5f" % [p.x, p.y, p.z])
		for t in uv:
			lines.append("vt %.5f %.5f" % [t.x, 1.0 - t.y])
		for q in n:
			lines.append("vn %.4f %.4f %.4f" % [q.x, q.y, q.z])
		for k in range(0, idx.size(), 3):
			var a := idx[k] + base
			var b := idx[k + 2] + base
			var c := idx[k + 1] + base
			lines.append("f %d/%d/%d %d/%d/%d %d/%d/%d" % [a, a, a, b, b, b, c, c, c])
		base += v.size()
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string("\n".join(lines) + "\n")
	f.close()

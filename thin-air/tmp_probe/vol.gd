extends Node
func _ready():
	for n in ["boulder_a", "boulder_b", "outcrop_a", "rock_small_a", "talus_patch"]:
		var ms := VegLibrary.get_shared().meshes(StringName(n))
		if ms.is_empty():
			continue
		var m: Mesh = ms[0]
		for si in m.get_surface_count():
			var arr := m.surface_get_arrays(si)
			var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var nn: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
			var agree := 0
			var tot := 0
			for i in range(0, idx.size(), 3):
				var a := v[idx[i]]
				var b := v[idx[i + 1]]
				var c := v[idx[i + 2]]
				var fn := (b - a).cross(c - a)
				var vn := nn[idx[i]] + nn[idx[i + 1]] + nn[idx[i + 2]]
				tot += 1
				if fn.dot(vn) > 0.0:
					agree += 1
			print(n, " surf ", si, " cross/normal agree=", agree, "/", tot, " (0 = correct Godot CW front faces)")
	get_tree().quit()

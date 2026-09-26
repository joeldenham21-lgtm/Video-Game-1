extends Node
func _ready():
	for n in ["boulder_a", "boulder_b", "boulder_c", "outcrop_a", "outcrop_b", "rock_small_a", "rock_small_d", "talus_patch"]:
		var ms := VegLibrary.get_shared().meshes(StringName(n))
		for li in ms.size():
			var m: Mesh = ms[li]
			var arr := m.surface_get_arrays(0)
			var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
			var vol := 0.0
			for i in range(0, idx.size(), 3):
				vol += v[idx[i]].dot(v[idx[i + 1]].cross(v[idx[i + 2]])) / 6.0
			var bb := m.get_aabb()
			print(n, " LOD", li, " signed_vol=", snappedf(vol, 0.01), " aabb_vol*0.5=", snappedf(bb.size.x * bb.size.y * bb.size.z * 0.5, 0.01))
	get_tree().quit()

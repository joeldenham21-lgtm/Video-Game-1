class_name BuildBatcher
extends Node3D
## Draws every completed grid piece of every structure through shared MultiMeshes: one MultiMeshInstance3D per
## (64 m cluster, mesh). A player's base of several cabins — hundreds of pieces — costs a few dozen draw calls,
## while structures far apart still cull and pick mesh LODs independently. Structures submit their instance
## lists (structure-local transforms + per-instance seed / snow exposure) whenever they change.

const CLUSTER := 64.0
const VIS_RANGE_DESKTOP := 900.0
const VIS_RANGE_MOBILE := 420.0

var _by_structure: Dictionary = {}     # BuildStructure -> {"cluster": Vector2i, "inst": Dictionary}
var _clusters: Dictionary = {}         # Vector2i -> {mesh_name: MultiMeshInstance3D}
var _dirty: Dictionary = {}            # Vector2i -> true
var _flush_pending := false


static func cluster_of(pos: Vector3) -> Vector2i:
	return Vector2i(floori(pos.x / CLUSTER), floori(pos.z / CLUSTER))


## `inst`: mesh name -> Array of [Transform3D (structure-local), exposure, seed].
func submit(s: BuildStructure, inst: Dictionary) -> void:
	var c := cluster_of(s.global_position)
	var prev: Variant = _by_structure.get(s)
	if prev is Dictionary and (prev as Dictionary)["cluster"] != c:
		_dirty[(prev as Dictionary)["cluster"]] = true
	_by_structure[s] = {"cluster": c, "inst": inst}
	_dirty[c] = true
	_schedule()


func remove(s: BuildStructure) -> void:
	var prev: Variant = _by_structure.get(s)
	if prev is Dictionary:
		_dirty[(prev as Dictionary)["cluster"]] = true
		_by_structure.erase(s)
		_schedule()


func _schedule() -> void:
	if _flush_pending:
		return
	_flush_pending = true
	flush.call_deferred()


## Rebuilds the dirty clusters now.
func flush() -> void:
	_flush_pending = false
	for c in _dirty.keys():
		_rebuild_cluster(c)
	_dirty.clear()


func _rebuild_cluster(c: Vector2i) -> void:
	var merged := {}
	for s in _by_structure.keys():
		if not is_instance_valid(s):
			_by_structure.erase(s)
			continue
		var e: Dictionary = _by_structure[s]
		if e["cluster"] != c:
			continue
		var xf: Transform3D = (s as Node3D).global_transform
		var inst: Dictionary = e["inst"]
		for mesh_name in inst:
			if not merged.has(mesh_name):
				merged[mesh_name] = []
			for it in inst[mesh_name]:
				merged[mesh_name].append([xf * (it[0] as Transform3D), it[1], it[2]])
	var mmis: Dictionary = _clusters.get(c, {})
	for n in mmis.keys():
		if not merged.has(n):
			(mmis[n] as Node).queue_free()
			mmis.erase(n)
	var mobile := Settings.is_mobile()
	for n in merged:
		var mesh := BuildCatalog.get_mesh(n)
		if mesh == null:
			continue
		var list: Array = merged[n]
		var mmi: MultiMeshInstance3D = mmis.get(n)
		if mmi == null:
			mmi = MultiMeshInstance3D.new()
			mmi.name = "%s_%d_%d" % [n, c.x, c.y]
			mmi.visibility_range_end = VIS_RANGE_MOBILE if mobile else VIS_RANGE_DESKTOP
			mmi.visibility_range_end_margin = 20.0
			if mobile and (String(n).begins_with("stub_") or String(n).begins_with("footing") or String(n).begins_with("brace") \
					or String(n).ends_with("_pz") or String(n).ends_with("_nz")):
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mmi)
			mmis[n] = mmi
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = mesh
		mm.instance_count = list.size()
		for i in list.size():
			var it: Array = list[i]
			mm.set_instance_transform(i, it[0])
			mm.set_instance_custom_data(i, Color(float(it[2]), float(it[1]), 0.0, 1.0))
		mmi.multimesh = mm
	if mmis.is_empty():
		_clusters.erase(c)
	else:
		_clusters[c] = mmis


## MultiMeshInstance3Ds currently drawing structures (≈ draw calls per pass / surfaces).
func multimesh_count() -> int:
	var n := 0
	for c in _clusters:
		n += (_clusters[c] as Dictionary).size()
	return n


func multimesh_count_in(c: Vector2i) -> int:
	return (_clusters.get(c, {}) as Dictionary).size()


func instance_total() -> int:
	var n := 0
	for c in _clusters:
		for k in _clusters[c]:
			var mmi: MultiMeshInstance3D = _clusters[c][k]
			if is_instance_valid(mmi) and mmi.multimesh:
				n += mmi.multimesh.instance_count
	return n

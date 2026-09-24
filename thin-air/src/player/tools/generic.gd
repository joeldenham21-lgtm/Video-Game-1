extends HeldItem
## Fallback for items without a dedicated behaviour: shows assets/models/fp/<id>.glb, the item's world
## model scaled into the hand, or a wrapped bundle. No action.


func build_visual() -> void:
	rest_pos = Vector3(0.2, -0.34, 0.0)
	var holder := Node3D.new()
	holder.name = "Item"
	var basis := Basis.from_euler(Vector3(deg_to_rad(-10.0), deg_to_rad(-20.0), 0.0))
	holder.transform = Transform3D(basis, Vector3(0.16, -0.21, -0.36) - rest_pos)
	model.add_child(holder)
	var ext := FPModels.external(item_id)
	if ext == null:
		var model_path := String(def.get("model", ""))
		if model_path != "" and ResourceLoader.exists(model_path):
			var ps := load(model_path) as PackedScene
			if ps:
				ext = ps.instantiate() as Node3D
				FPModels._convert_tree(ext)
				_fit(ext, 0.16)
	if ext:
		holder.add_child(ext)
	else:
		var mi := MeshInstance3D.new()
		mi.mesh = FPModels.generic_mesh()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.add_child(mi)
	var arm := FPHands.make_arm(&"hold", false, Vector3(0.012, -0.03, 0.0), Vector3(0, 1, 0), basis.inverse() * Vector3(0.4, -0.55, 0.74))
	holder.add_child(arm)
	if viewmodel and viewmodel.has_method(&"register_arm"):
		viewmodel.call(&"register_arm", arm)


## Uniformly scales a node so its visual bounds fit within `size` metres.
static func _fit(n: Node3D, size: float) -> void:
	var aabb := AABB()
	var first := true
	for c in n.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		if mi.mesh:
			var a := mi.transform * mi.mesh.get_aabb()
			aabb = a if first else aabb.merge(a)
			first = false
	var m := maxf(aabb.size.x, maxf(aabb.size.y, aabb.size.z))
	if m > size and m > 0.0:
		n.scale = Vector3.ONE * (size / m)

@tool
extends EditorScenePostImport
## Post-import script for every Blender hero model (assets/models/items|fp|props/*.glb, set in each .import).
## The glbs carry only material NAMES (keys of the item material library scenes/items/materials/materials.json)
## so no texture is duplicated per model; here each surface gets the real library material (ItemMaterials),
## set on the mesh resource itself so every user of the mesh (pickups, carried logs, icons) sees it.
## Nodes named "*-col" / "*-colonly" are handled by Godot's name suffixes; "SOCKET_*" empties stay as Node3D.


func _post_import(scene: Node) -> Object:
	_bind(scene)
	return scene


func _bind(n: Node) -> void:
	var mi := n as MeshInstance3D
	if mi and mi.mesh:
		var mesh := mi.mesh
		for s in mesh.get_surface_count():
			var cur := mesh.surface_get_material(s)
			var key := _key_of(cur)
			if key != "" and ItemMaterials.has_material(StringName(key)):
				mesh.surface_set_material(s, ItemMaterials.get_material(StringName(key)))
	for c in n.get_children():
		_bind(c)


## Blender may suffix duplicates ("steel.001"); the key is the part before the dot.
static func _key_of(m: Material) -> String:
	if m == null:
		return ""
	return m.resource_name.get_slice(".", 0)

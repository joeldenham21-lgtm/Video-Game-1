class_name BuildCatalog
extends RefCounted
## What each buildable is to the building system (beyond data/buildables.json) and where its meshes are.
##
## kind: &"deck" (foundation / floor), &"wall" (walls, window/door walls, railings), &"roof", &"stairs",
## &"node" (pillars), &"door" (hangs in a doorway), &"free" (fires, furniture, shelters — own scene).
## Grid meshes come from assets/models/building/<family>.glb (tools/blender/building/build_all.py), looked up by
## node name and re-materialled through BuildMaterials once.

const MODEL_DIR := "res://assets/models/building/"

const PIECES := {
	&"log_foundation": {"kind": &"deck", "ground": true, "hammer": true, "surface": &"wood"},
	&"log_floor": {"kind": &"deck", "ground": false, "hammer": true, "surface": &"wood"},
	&"log_wall": {"kind": &"wall", "mesh": "wall", "closure": 1.0, "hammer": true, "surface": &"wood"},
	&"log_window_wall": {"kind": &"wall", "mesh": "window", "closure": 0.8, "hammer": true, "surface": &"wood"},
	&"log_doorway": {"kind": &"wall", "mesh": "doorway", "closure": 0.35, "hammer": true, "surface": &"wood"},
	&"log_railing": {"kind": &"wall", "mesh": "railing", "closure": 0.1, "partition": false, "hammer": true, "surface": &"wood"},
	&"door": {"kind": &"door", "hammer": true, "surface": &"wood"},
	&"log_roof": {"kind": &"roof", "hammer": true, "surface": &"wood"},
	&"log_stairs": {"kind": &"stairs", "hammer": true, "surface": &"wood"},
	&"log_pillar": {"kind": &"node", "hammer": true, "surface": &"wood"},
}

## Families by mesh-name prefix.
const FAMILY_PREFIX := [
	["wall_", "walls"], ["window_", "walls"], ["doorway_", "walls"], ["stub_", "walls"],
	["gable_", "gables"], ["roof_", "roof"], ["ridge_", "roof"],
	["deck_", "foundation"], ["sill", "foundation"], ["post_", "foundation"], ["footing", "foundation"],
	["floor", "misc"], ["stairs", "misc"], ["pillar", "misc"], ["railing", "misc"], ["door_leaf", "misc"],
]

static var _meshes: Dictionary = {}       # StringName -> Mesh
static var _families: Dictionary = {}     # family -> true once loaded
static var _scenes: Dictionary = {}       # path -> PackedScene


static func kind_of(id: StringName) -> StringName:
	return StringName(PIECES.get(id, {}).get("kind", &"free"))


static func is_grid(id: StringName) -> bool:
	var k := kind_of(id)
	return k != &"free"


static func info(id: StringName) -> Dictionary:
	return PIECES.get(id, {})


## Log construction needs a hammer in the pack; camp pieces are built by hand.
static func needs_hammer(id: StringName) -> bool:
	if PIECES.has(id):
		return bool(PIECES[id].get("hammer", false))
	return id == &"bed" or id == &"workbench"


static func closure_of(id: StringName) -> float:
	return float(PIECES.get(id, {}).get("closure", 0.0))


static func partitions(id: StringName) -> bool:
	return bool(PIECES.get(id, {}).get("partition", true))


static func cost_of(id: StringName) -> Dictionary:
	var b := ItemDB.get_buildable(id)
	var out := {}
	var c: Dictionary = b.get("cost", {})
	for k in c:
		out[StringName(k)] = int(c[k])
	return out


static func display_name(id: StringName) -> String:
	return String(ItemDB.get_buildable(id).get("name", String(id).capitalize()))


static func scene_path(id: StringName) -> String:
	return String(ItemDB.get_buildable(id).get("scene", "res://scenes/building/%s.tscn" % id))


static func scene_of(id: StringName) -> PackedScene:
	var p := scene_path(id)
	if _scenes.has(p):
		return _scenes[p]
	var ps: PackedScene = load(p) as PackedScene if ResourceLoader.exists(p) else null
	_scenes[p] = ps
	return ps


## Footprint size (m) for free pieces, from buildables.json "size".
static func size_of(id: StringName) -> Vector3:
	var s: Array = ItemDB.get_buildable(id).get("size", [1.0, 1.0, 1.0])
	if s.size() < 3:
		return Vector3.ONE
	return Vector3(float(s[0]), float(s[1]), float(s[2]))


# ---------------------------------------------------------------------------------------------- meshes

static func family_of(mesh_name: String) -> String:
	for fp in FAMILY_PREFIX:
		if mesh_name.begins_with(fp[0]):
			return fp[1]
	return ""


## A grid mesh by node name ("wall_even_a", "roof_peak_eave_b_pz", …), materials already assigned.
static func get_mesh(mesh_name: StringName) -> Mesh:
	if _meshes.has(mesh_name):
		return _meshes[mesh_name]
	var fam := family_of(String(mesh_name))
	if fam != "" and not _families.has(fam):
		load_family(fam)
	return _meshes.get(mesh_name, null)


static func load_family(fam: String) -> void:
	_families[fam] = true
	var path := MODEL_DIR + fam + ".glb"
	if not ResourceLoader.exists(path):
		push_warning("BuildCatalog: missing %s (run tools/blender/building/build_all.py)" % path)
		return
	var ps := load(path) as PackedScene
	if ps == null:
		return
	var inst := ps.instantiate()
	_collect(inst)
	inst.free()


static func _collect(n: Node) -> void:
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		var mesh := (n as MeshInstance3D).mesh
		for i in mesh.get_surface_count():
			var src := mesh.surface_get_material(i)
			var role := src.resource_name if src else "log"
			mesh.surface_set_material(i, BuildMaterials.for_role(role))
		_meshes[StringName(n.name)] = mesh
	for c in n.get_children():
		_collect(c)


## Instantiates a camp-piece model glb (materials re-assigned). Null if missing.
static func instantiate_model(glb: String) -> Node3D:
	var path := MODEL_DIR + glb
	if not ResourceLoader.exists(path):
		return null
	var ps := _scenes.get(path) as PackedScene
	if ps == null:
		ps = load(path) as PackedScene
		_scenes[path] = ps
	if ps == null:
		return null
	var n := ps.instantiate() as Node3D
	_apply_roles_once(n)
	return n


static func _apply_roles_once(n: Node) -> void:
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		var mesh := (n as MeshInstance3D).mesh
		if not mesh.has_meta(&"building_roles"):
			for i in mesh.get_surface_count():
				var src := mesh.surface_get_material(i)
				var role := src.resource_name if src else "log"
				mesh.surface_set_material(i, BuildMaterials.for_role(role))
			mesh.set_meta(&"building_roles", true)
	for c in n.get_children():
		_apply_roles_once(c)


## Mesh parts of a grid piece in the piece's local frame: [[mesh_name, Transform3D], ...].
static func piece_parts(id: StringName, slot: Vector3i, props: Dictionary) -> Array:
	var out: Array = []
	match id:
		&"log_foundation":
			var v := "a" if posmod((slot.x + slot.z) / 2, 2) == 0 else "b"
			out.append([StringName("deck_" + v), Transform3D.IDENTITY])
		&"log_floor":
			out.append([&"floor", Transform3D.IDENTITY])
		&"log_wall", &"log_window_wall", &"log_doorway":
			var parity := BuildGrid.edge_parity(slot)
			var base: String = PIECES[id]["mesh"]
			var n := "%s_%s" % [base, parity]
			if id == &"log_wall":
				n += "_a" if posmod((slot.x + slot.z + slot.y) / 2, 2) == 0 else "_b"
			out.append([StringName(n), Transform3D.IDENTITY])
		&"log_railing":
			out.append([&"railing", Transform3D.IDENTITY])
		&"log_roof":
			out.append([roof_mesh_name(props, slot, ""), Transform3D.IDENTITY])
		&"log_stairs":
			out.append([&"stairs", Transform3D.IDENTITY])
		&"log_pillar":
			out.append([&"pillar", Transform3D.IDENTITY])
	return out


static func roof_mesh_name(props: Dictionary, slot: Vector3i, region: String) -> StringName:
	var shape := String(props.get("shape", "slope"))
	var eave := int(props.get("tier", 0)) == 0
	var v := "a" if posmod((slot.x + slot.z) / 2, 2) == 0 else "b"
	var n := "roof_%s%s_%s" % [shape, "_eave" if eave else "", v]
	if region != "":
		n += "_" + region
	return StringName(n)

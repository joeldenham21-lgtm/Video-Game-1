class_name VegHarvest
extends Node3D
## Harvesting for the scatter (child "Harvest" of Vegetation). Receives hits / interactions from VegProxy
## bodies by instance id (CONTRACT.md §4 harvest_hit / interactables) and keeps all persistent state.
##
## Trees (Sons-of-the-Forest style): the first axe hit swaps the MultiMesh instance for a "hero" MeshInstance
## (LOD0, own render layer so the notch decal paints only this tree). HP scales with trunk diameter and wood
## density; each hit deepens the notch decal, throws wood chips and shakes the tree; below 30 % it creaks. At
## 0 HP: tree_crack, Events.tree_felled, the hero is clipped into a stump (+ end-grain cap, static collider)
## and a VegFelledTree rigid body topples away from the chopper, hits the ground, settles and is bucked into
## 'log' pickups. Saplings -> sticks. Shrubs: interact for berries / fibre / sticks, chop for sticks.
## Rocks: small ones are picked up (stone, some flint), boulders give stone/flint to a pickaxe until spent.
## Persistence: Vegetation.save_state()["harvest"] (felled/removed ids are in Vegetation.removed).

const Cat := VegScatter.Cat
const PICKUP_SCENE := "res://scenes/items/pickup.tscn"
const NOTCH_ALBEDO := "res://assets/textures/foliage/chop_notch_albedo.png"
const NOTCH_NORMAL := "res://assets/textures/foliage/chop_notch_normal.png"
## Render layer 19: chopped "hero" trees. Notch decals only affect this layer.
const HERO_LAYER := 1 << 18
const STUMP_VIS_RANGE := 110.0

## Interaction yields per shrub group: [item, min, max, uses, prompt, hold time]; chop: [item, min, max, uses].
const SHRUBS := {
	"huckleberry": {"interact": [&"berries", 3, 6, 1, "Pick huckleberries", 1.2], "chop": [&"stick", 1, 2, 2]},
	"willow": {"interact": [&"fiber", 1, 2, 2, "Strip willow bark", 1.5], "chop": [&"stick", 2, 3, 3]},
	"alder": {"interact": [&"stick", 1, 2, 2, "Break off branches", 1.0], "chop": [&"stick", 2, 3, 3]},
	"juniper": {"interact": [&"stick", 1, 1, 1, "Break off dry twigs", 1.0], "chop": [&"stick", 1, 2, 2]},
}
const BOULDER_YIELDS := 6
const BOULDER_SEG := 30.0
const FLINT_CHANCE := 0.18

class TreeState:
	var hp := 100.0
	var max_hp := 100.0
	var cut_h := 0.8          # world metres above the instance origin
	var dir := Vector3.BACK   # horizontal, from the trunk toward the chopper (notch side)
	var hero: MeshInstance3D
	var decal: Decal
	var base_xf := Transform3D.IDENTITY
	var shake := 0.0
	var shake_axis := Vector3.RIGHT
	var creaked := false

var vegetation: Node = null
var lib: VegLibrary
## Tests: replaces pickup spawning. func(id: StringName, count: int, pos: Vector3, impulse: Vector3) -> Node
var pickup_spawner: Callable

var trees: Dictionary = {}      # id -> TreeState (standing, notched)
var stumps: Dictionary = {}     # id -> {"cut": world cut height, "dir": Vector3}
var fallen: Dictionary = {}     # id -> VegFelledTree
var uses: Dictionary = {}       # id -> Vector3(interact uses, chop uses, accumulated damage)
var _stump_nodes: Dictionary = {}   # id -> Node3D (hero stump root)
var _profiles: Dictionary = {}  # kind -> PackedFloat32Array trunk radius per 5 cm (object space)
var _cap_mesh: ArrayMesh
var _chip_mat: StandardMaterial3D
var _chip_mesh: Mesh
var _puff_mat: StandardMaterial3D
var _notch_alb: Texture2D
var _notch_nrm: Texture2D
var _warned_pickup := false


func _ready() -> void:
	lib = VegLibrary.get_shared()
	_notch_alb = load(NOTCH_ALBEDO) if ResourceLoader.exists(NOTCH_ALBEDO) else null
	_notch_nrm = load(NOTCH_NORMAL) if ResourceLoader.exists(NOTCH_NORMAL) else null
	set_process(false)


# ---------------------------------------------------------------------------------------------- queries

## Tool family of an item id: &"axe", &"pickaxe", &"knife", or &"hand" (empty hands / other items).
func tool_family(tool_id: StringName) -> StringName:
	if tool_id == &"":
		return &"hand"
	var t: Variant = ItemDB.get_item(tool_id).get("tool", {})
	var ty := String((t as Dictionary).get("type", "")) if t is Dictionary else ""
	if ty == "":
		var n := String(tool_id)
		if n.contains("ice_axe") or n.contains("pick"):
			ty = "pickaxe"
		elif n.contains("axe") or n == "hatchet":
			ty = "axe"
		elif n.contains("knife") or n.contains("spear"):
			ty = "knife"
	match ty:
		"axe":
			return &"axe"
		"pickaxe", "ice_axe":
			return &"pickaxe"
		"knife", "spear":
			return &"knife"
	return &"hand"


func tool_type_for(_id: int, cat: int) -> StringName:
	match cat:
		Cat.TREE, Cat.SAPLING, Cat.DEADWOOD:
			return &"axe"
		Cat.ROCK_BIG:
			return &"pickaxe"
	return &"hand"


## Tree HP from trunk diameter (m) and wood density (kg/m3): hatchet (chop 22) ~7 hits on a 36 cm spruce,
## felling axe ~4, stone axe ~12.
static func tree_hp(dbh: float, density: float) -> float:
	return 25.0 + 900.0 * dbh * dbh * clampf(density / 600.0, 0.6, 1.3)


func _entry(id: int) -> Dictionary:
	if vegetation == null:
		return {}
	var f: Dictionary = vegetation.find_instance(id)
	if f.is_empty():
		return {}
	var cd: VegScatter.CellData = f["cell"]
	var i: int = f["index"]
	var kind: StringName = lib.kind_names[cd.kinds[i]]
	return {"id": id, "kind": kind, "cat": int(cd.cats[i]), "xf": VegScatter.transform_of(cd, i),
		"scale": cd.scale[i], "info": lib.info(kind)}


func _rng(id: int, salt: int) -> RandomNumberGenerator:
	var r := RandomNumberGenerator.new()
	r.seed = hash(Vector3i(id, salt, 0x5EED))
	return r


func _uses(id: int) -> Vector3:
	return uses.get(id, Vector3.ZERO)


# ---------------------------------------------------------------------------------------------- hits

func hit_instance(id: int, tool_id: StringName, power: float, hit_pos: Vector3, hit_normal: Vector3, player: Node) -> void:
	if vegetation == null or vegetation.removed.has(id):
		return
	var e := _entry(id)
	if e.is_empty():
		return
	var fam := tool_family(tool_id)
	match int(e["cat"]):
		Cat.TREE:
			if fam != &"hand":
				_chop_tree(e, power, hit_pos, hit_normal, player)
		Cat.SAPLING:
			if fam != &"hand":
				_chop_small(e, power, hit_pos, hit_normal, player, 8.0 + 30.0 * float(e["info"].get("dbh", 0.05)) * float(e["scale"]), &"stick", 2)
		Cat.SHRUB:
			if fam == &"hand":
				interact_instance(id, player)
			else:
				_chop_shrub(e, power, hit_pos, hit_normal, player)
		Cat.DEADWOOD:
			if fam != &"hand":
				_chop_deadwood(e, power, hit_pos, hit_normal, player)
		Cat.ROCK_BIG:
			if fam == &"pickaxe":
				_mine_rock(e, power, hit_pos, hit_normal)
		Cat.ROCK_SMALL:
			if fam == &"pickaxe":
				_take_small_rock(e, null, hit_pos)
			elif fam == &"hand":
				_take_small_rock(e, player, hit_pos)


# ---------------------------------------------------------------------------------------------- trees

func _chop_tree(e: Dictionary, power: float, hit_pos: Vector3, hit_normal: Vector3, player: Node) -> void:
	var id: int = e["id"]
	var st: TreeState = trees.get(id)
	var xf: Transform3D = e["xf"]
	var inf: Dictionary = e["info"]
	var s: float = e["scale"]
	if st == null:
		st = TreeState.new()
		st.max_hp = tree_hp(float(inf.get("dbh", 0.3)) * s, float(inf.get("wood_density", 550.0)))
		st.hp = st.max_hp
		st.cut_h = clampf(hit_pos.y - xf.origin.y, 0.45, 1.25)
		var from := _chopper_pos(player, hit_pos, hit_normal)
		st.dir = Vector3(from.x - xf.origin.x, 0.0, from.z - xf.origin.z).normalized()
		if st.dir.length_squared() < 0.5:
			st.dir = Vector3.BACK
		trees[id] = st
		_make_hero(id, e, st)
	st.hp -= maxf(power, 0.0)
	var progress := clampf(1.0 - st.hp / st.max_hp, 0.0, 1.0)
	_update_notch(st, e, progress)
	fx_chips(hit_pos, hit_normal, 1.0)
	if player == null:
		Audio.play_sfx(&"axe_hit_wood", hit_pos)
	st.shake = 1.0
	st.shake_axis = Vector3.UP.cross(-st.dir).normalized()
	set_process(true)
	if not st.creaked and st.hp < st.max_hp * 0.3 and st.hp > 0.0:
		st.creaked = true
		Audio.play_sfx(&"wood_creak", xf.origin + Vector3.UP * 4.0)
	if st.hp <= 0.0:
		fell(id, _chopper_pos(player, hit_pos, hit_normal))


func _chopper_pos(player: Node, hit_pos: Vector3, hit_normal: Vector3) -> Vector3:
	if player is Node3D and is_instance_valid(player):
		return (player as Node3D).global_position
	return hit_pos + hit_normal * 1.5


func _make_hero(id: int, e: Dictionary, st: TreeState) -> void:
	var ms := lib.meshes(e["kind"])
	if ms.is_empty():
		return
	var mi := MeshInstance3D.new()
	mi.name = "Tree_%d" % id
	mi.mesh = ms[0]
	mi.layers = 1 | HERO_LAYER
	add_child(mi)
	mi.global_transform = e["xf"]
	st.hero = mi
	st.base_xf = e["xf"]
	vegetation.hide_instance(id)
	if _notch_alb:
		var d := Decal.new()
		d.name = "Notch"
		d.texture_albedo = _notch_alb
		d.texture_normal = _notch_nrm
		d.cull_mask = HERO_LAYER
		d.normal_fade = 0.35
		d.upper_fade = 0.0
		d.lower_fade = 0.0
		d.albedo_mix = 1.0
		d.distance_fade_enabled = true
		d.distance_fade_begin = 35.0
		d.distance_fade_length = 10.0
		add_child(d)
		st.decal = d
	_update_notch(st, e, 0.0)


func _update_notch(st: TreeState, e: Dictionary, progress: float) -> void:
	if st.decal == null:
		return
	var xf: Transform3D = e["xf"]
	var r := _radius_at(e["kind"], st.cut_h / float(e["scale"])) * float(e["scale"])
	# decal: projects along -Y (toward the trunk axis from the chopper's side), X around the trunk, Z up/down
	var y := st.dir
	var x := Vector3.UP.cross(y).normalized()
	var z := x.cross(y).normalized()
	var depth_frac := 0.25 + 0.75 * progress
	st.decal.size = Vector3(r * 2.0 * (0.55 + 0.4 * depth_frac), r * 1.3, clampf(r * (0.35 + 1.1 * progress), 0.05, 0.6))
	st.decal.global_transform = Transform3D(Basis(x, y, z), xf.origin + Vector3.UP * st.cut_h + y * r * 0.5)
	st.decal.modulate = Color(1, 1, 1, clampf(0.55 + progress, 0.0, 1.0))


func _process(delta: float) -> void:
	var any := false
	for id in trees:
		var st: TreeState = trees[id]
		if st.shake <= 0.0 or st.hero == null:
			continue
		any = true
		st.shake = maxf(st.shake - delta * 1.6, 0.0)
		var a := sin(st.shake * 28.0) * st.shake * st.shake * 0.006
		st.hero.global_transform = Transform3D(Basis(st.shake_axis, a) * st.base_xf.basis, st.base_xf.origin)
	if not any:
		set_process(false)


## Fells a standing tree away from `from` (world position of the chopper).
func fell(id: int, from: Vector3) -> void:
	var e := _entry(id)
	if e.is_empty() or vegetation.removed.has(id):
		return
	var st: TreeState = trees.get(id)
	if st == null:
		st = TreeState.new()
		st.cut_h = 0.7
		st.dir = Vector3(from.x - e["xf"].origin.x, 0.0, from.z - e["xf"].origin.z).normalized()
		_make_hero(id, e, st)
	trees.erase(id)
	var xf: Transform3D = e["xf"]
	var inf: Dictionary = e["info"]
	var s: float = e["scale"]
	var cut_world := xf.origin + Vector3.UP * st.cut_h
	Audio.play_sfx(&"tree_crack", cut_world, 2.0)
	Events.tree_felled.emit(xf.origin, StringName(inf.get("species", "tree")))
	Events.noise_emitted.emit(cut_world, 45.0, self)
	vegetation.remove_instance(id)
	var r := _radius_at(e["kind"], st.cut_h / s) * s
	var stump := _make_stump(id, e, st.cut_h, st.hero, st.decal)
	stumps[id] = {"cut": st.cut_h, "dir": st.dir}
	var ms := lib.meshes(e["kind"])
	if ms.is_empty():
		return
	var ft := VegFelledTree.new()
	ft.name = "Felled_%d" % id
	add_child(ft)
	ft.setup(self, id, e["kind"], inf, ms[0], xf, st.cut_h, r, _cap())
	fallen[id] = ft
	var away := -st.dir
	if from.distance_squared_to(xf.origin) > 0.01:
		away = Vector3(xf.origin.x - from.x, 0.0, xf.origin.z - from.z).normalized()
	ft.start_fall(away, stump)
	Audio.play_sfx_attached(&"tree_fall", ft, 0.0)


func _make_stump(id: int, e: Dictionary, cut_h: float, hero: MeshInstance3D, decal: Decal) -> StaticBody3D:
	var xf: Transform3D = e["xf"]
	var s: float = e["scale"]
	var root := StaticBody3D.new()
	root.name = "Stump_%d" % id
	root.collision_layer = VegProxy.LAYER_VEGETATION
	root.collision_mask = 0
	root.set_meta(&"surface", &"wood")
	add_child(root)
	root.global_transform = Transform3D(Basis(), xf.origin)
	if hero == null:
		var ms := lib.meshes(e["kind"])
		if not ms.is_empty():
			hero = MeshInstance3D.new()
			hero.mesh = ms[0]
			hero.layers = 1 | HERO_LAYER
			add_child(hero)
			hero.global_transform = xf
	if hero:
		hero.name = "StumpMesh"
		hero.reparent(root)
		hero.global_transform = xf
		hero.set_instance_shader_parameter(&"clip_above", cut_h / s)
		hero.set_instance_shader_parameter(&"wind_scale", 0.0)
		hero.visibility_range_end = STUMP_VIS_RANGE
		hero.visibility_range_end_margin = 10.0
		hero.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	if decal:
		decal.reparent(root)
		decal.distance_fade_enabled = true
		decal.distance_fade_begin = 35.0
		decal.distance_fade_length = 10.0
	var r := _radius_at(e["kind"], cut_h / s) * s
	var cap := MeshInstance3D.new()
	cap.name = "Cap"
	cap.mesh = _cap()
	cap.position = Vector3(0.0, cut_h, 0.0)
	cap.scale = Vector3(r, 1.0, r)
	cap.visibility_range_end = STUMP_VIS_RANGE
	root.add_child(cap)
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = maxf(r, 0.05)
	cyl.height = cut_h + 0.3
	cs.shape = cyl
	cs.position = Vector3(0.0, (cut_h - 0.3) * 0.5, 0.0)
	root.add_child(cs)
	_stump_nodes[id] = root
	return root


## Trunk radius (object space) at object-space height y, measured from the LOD0 bark vertices.
func _radius_at(kind: StringName, y: float) -> float:
	var prof: PackedFloat32Array = _profiles.get(kind, PackedFloat32Array())
	if prof.is_empty():
		prof = _build_profile(kind)
		_profiles[kind] = prof
	var k := clampi(int(round(y / 0.05)), 0, prof.size() - 1)
	return prof[k]


func _build_profile(kind: StringName) -> PackedFloat32Array:
	var inf := lib.info(kind)
	var base_r := float(inf.get("trunk_radius", 0.15))
	var out := PackedFloat32Array()
	out.resize(60)       # 0 .. 3 m
	out.fill(base_r)
	var ms := lib.meshes(kind)
	if ms.is_empty():
		return out
	var m: Mesh = ms[0]
	var surf := -1
	for si in m.get_surface_count():
		var mat := m.surface_get_material(si)
		if mat and not String(mat.resource_name).begins_with("cards"):
			surf = si
			break
	if surf < 0:
		return out
	var verts: PackedVector3Array = m.surface_get_arrays(surf)[Mesh.ARRAY_VERTEX]
	var buckets: Array = []
	buckets.resize(60)
	for b in 60:
		buckets[b] = PackedFloat32Array()
	for v in verts:
		var k := int(round(v.y / 0.05))
		if k < 0 or k >= 60:
			continue
		var rr := Vector2(v.x, v.z).length()
		if rr < base_r * 2.6:
			(buckets[k] as PackedFloat32Array).append(rr)
	var last := base_r
	for b in 60:
		var arr: PackedFloat32Array = buckets[b]
		if arr.size() >= 4:
			arr.sort()
			last = arr[int(arr.size() * 0.7)]
		out[b] = last
	return out


## Unit end-grain disc (radius 1, facing +Y), UV 0..1 across (wood_endgrain is a full disc texture).
func _cap() -> ArrayMesh:
	if _cap_mesh:
		return _cap_mesh
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 20
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		for p in [Vector2.ZERO, Vector2(cos(a1), sin(a1)), Vector2(cos(a0), sin(a0))]:
			var q: Vector2 = p
			st.set_color(Color(0.0, 1.0, 0.0, 0.0))
			st.set_normal(Vector3.UP)
			st.set_tangent(Plane(1, 0, 0, 1))
			st.set_uv(Vector2(0.5 + 0.5 * q.x, 0.5 + 0.5 * q.y))
			st.set_uv2(Vector2.ZERO)
			st.add_vertex(Vector3(q.x, 0.004, q.y))
	_cap_mesh = st.commit()
	_cap_mesh.surface_set_material(0, lib.bark_material("wood_endgrain", Color(1, 1, 1), 0.0))
	return _cap_mesh


func on_tree_settled(ft: VegFelledTree) -> void:
	Audio.play_sfx(&"wood_creak", ft.global_position, -8.0)


func on_tree_bucked(ft: VegFelledTree) -> void:
	fallen.erase(ft.instance_id)


# ---------------------------------------------------------------------------------------------- small stuff

func _chop_small(e: Dictionary, power: float, hit_pos: Vector3, hit_normal: Vector3, _player: Node, hp: float,
		item: StringName, count: int) -> void:
	var id: int = e["id"]
	var u := _uses(id)
	u.z += power
	uses[id] = u
	fx_chips(hit_pos, hit_normal, 0.5)
	if u.z >= hp:
		uses.erase(id)
		vegetation.remove_instance(id)
		Audio.play_sfx(&"wood_creak", hit_pos, -6.0, 1.4)
		spawn_pickup(item, count, e["xf"].origin + Vector3.UP * 0.4, Vector3.UP * 0.8)
		Events.resource_harvested.emit(item, hit_pos)


func _shrub_group(e: Dictionary) -> String:
	var inf: Dictionary = e["info"]
	return String(inf.get("group", String(e["kind"]).get_slice("_", 0)))


func _chop_shrub(e: Dictionary, power: float, hit_pos: Vector3, hit_normal: Vector3, _player: Node) -> void:
	var id: int = e["id"]
	var def: Dictionary = SHRUBS.get(_shrub_group(e), SHRUBS["alder"])
	var c: Array = def["chop"]
	var u := _uses(id)
	u.z += power
	fx_chips(hit_pos, hit_normal, 0.35)
	if u.z < 10.0:
		uses[id] = u
		return
	u.z = 0.0
	u.y += 1.0
	var r := _rng(id, int(u.y))
	var n := r.randi_range(int(c[1]), int(c[2]))
	spawn_pickup(c[0], n, hit_pos + hit_normal * 0.3 + Vector3.UP * 0.2, hit_normal * 0.8 + Vector3.UP * 0.8)
	Events.resource_harvested.emit(c[0], hit_pos)
	if int(u.y) >= int(c[3]):
		uses.erase(id)
		vegetation.remove_instance(id)
	else:
		uses[id] = u


func _chop_deadwood(e: Dictionary, power: float, hit_pos: Vector3, hit_normal: Vector3, _player: Node) -> void:
	var id: int = e["id"]
	var inf: Dictionary = e["info"]
	if float(inf.get("length", 0.0)) <= 0.0:
		fx_chips(hit_pos, hit_normal, 0.4)
		return
	var u := _uses(id)
	if u.y >= 3.0:
		return
	u.z += power
	fx_chips(hit_pos, hit_normal, 0.7)
	if u.z >= 30.0:
		u.z = 0.0
		u.y += 1.0
		var r := _rng(id, int(u.y))
		spawn_pickup(&"stick", r.randi_range(1, 3), hit_pos + hit_normal * 0.4 + Vector3.UP * 0.3, Vector3.UP)
		if r.randf() < 0.6:
			spawn_pickup(&"bark", 1, hit_pos + hit_normal * 0.4 + Vector3.UP * 0.3, Vector3.UP * 0.8)
		Events.resource_harvested.emit(&"stick", hit_pos)
	uses[id] = u


func _mine_rock(e: Dictionary, power: float, hit_pos: Vector3, hit_normal: Vector3) -> void:
	var id: int = e["id"]
	var u := _uses(id)
	var inf: Dictionary = e["info"]
	var cap := 3 if bool(inf.get("talus", false)) else BOULDER_YIELDS
	fx_rock(hit_pos, hit_normal)
	if int(u.y) >= cap:
		return
	u.z += power
	if u.z >= BOULDER_SEG:
		u.z = 0.0
		u.y += 1.0
		var r := _rng(id, int(u.y))
		var item: StringName = &"flint" if r.randf() < FLINT_CHANCE else &"stone"
		spawn_pickup(item, 1, hit_pos + hit_normal * 0.35, hit_normal * 1.2 + Vector3.UP)
		Events.resource_harvested.emit(item, hit_pos)
	uses[id] = u


func _take_small_rock(e: Dictionary, player: Node, at: Vector3) -> void:
	var id: int = e["id"]
	var r := _rng(id, 7)
	var item: StringName = &"flint" if r.randf() < FLINT_CHANCE * 0.6 else &"stone"
	var n := 2 if float(e["scale"]) * float(e["info"].get("radius", 0.2)) > 0.32 else 1
	vegetation.remove_instance(id)
	if player:
		give(item, n, e["xf"].origin, player)
	else:
		spawn_pickup(item, n, at + Vector3.UP * 0.3, Vector3.UP * 0.5)
		Events.resource_harvested.emit(item, at)


# ---------------------------------------------------------------------------------------------- interaction

func interact_prompt(id: int, _player: Node) -> String:
	if vegetation == null or vegetation.removed.has(id):
		return ""
	var e := _entry(id)
	if e.is_empty():
		return ""
	var u := _uses(id)
	match int(e["cat"]):
		Cat.SHRUB:
			var def: Dictionary = SHRUBS.get(_shrub_group(e), {})
			if def.is_empty():
				return ""
			var it: Array = def["interact"]
			return String(it[4]) if int(u.x) < int(it[3]) else ""
		Cat.ROCK_SMALL:
			return "Pick up stone"
		Cat.ROCK_BIG:
			if bool(e["info"].get("talus", false)) and int(u.x) < 3:
				return "Gather stones"
		Cat.DEADWOOD:
			if float(e["info"].get("length", 0.0)) > 0.0 and int(u.x) < 2:
				return "Gather dry twigs"
	return ""


func interact_hold_time(id: int) -> float:
	var e := _entry(id)
	if e.is_empty():
		return 0.0
	if int(e["cat"]) == Cat.SHRUB:
		var def: Dictionary = SHRUBS.get(_shrub_group(e), {})
		if not def.is_empty():
			return float(def["interact"][5])
	if int(e["cat"]) == Cat.DEADWOOD:
		return 0.8
	return 0.0


func interact_instance(id: int, player: Node) -> void:
	if interact_prompt(id, player) == "":
		return
	var e := _entry(id)
	var u := _uses(id)
	var at: Vector3 = e["xf"].origin + Vector3.UP * 0.5
	match int(e["cat"]):
		Cat.SHRUB:
			var it: Array = SHRUBS[_shrub_group(e)]["interact"]
			u.x += 1.0
			uses[id] = u
			var r := _rng(id, 100 + int(u.x))
			give(it[0], r.randi_range(int(it[1]), int(it[2])), at, player)
			Audio.play_sfx(&"pickup", at, -6.0)
		Cat.ROCK_SMALL:
			_take_small_rock(e, player, at)
		Cat.ROCK_BIG:
			u.x += 1.0
			uses[id] = u
			var r2 := _rng(id, 200 + int(u.x))
			give(&"flint" if r2.randf() < FLINT_CHANCE else &"stone", 1, at, player)
		Cat.DEADWOOD:
			u.x += 1.0
			uses[id] = u
			var r3 := _rng(id, 300 + int(u.x))
			give(&"stick", r3.randi_range(1, 2), at, player)
			if r3.randf() < 0.35:
				give(&"tinder", 1, at, player)


# ---------------------------------------------------------------------------------------------- items

## Puts items straight into the player's inventory (overflow is dropped as a pickup).
func give(item: StringName, count: int, at: Vector3, player: Node) -> void:
	if count <= 0:
		return
	Events.resource_harvested.emit(item, at)
	var inv: Variant = player.get("inventory") if player else null
	if inv is Object and (inv as Object).has_method("add"):
		var left: int = inv.add(item, count)
		var got := count - left
		if got > 0:
			Events.item_picked_up.emit(item, got)
			var nm := String(ItemDB.get_item(item).get("name", String(item).capitalize()))
			Game.notify("+%d %s" % [got, nm], &"item")
		if left > 0:
			spawn_pickup(item, left, at, Vector3.UP * 0.5)
		return
	spawn_pickup(item, count, at, Vector3.UP * 0.5)


## Spawns a dropped pickup: the Items root's spawn_pickup when present, else pickup.tscn under this node.
func spawn_pickup(item: StringName, count: int, pos: Vector3, impulse := Vector3.ZERO) -> Node:
	if pickup_spawner.is_valid():
		return pickup_spawner.call(item, count, pos, impulse)
	var items_root: Node = null
	if Game.world and is_instance_valid(Game.world):
		items_root = Game.world.get_node_or_null("Items")
	if items_root == null and is_inside_tree():
		items_root = get_tree().get_first_node_in_group(&"items_root")
	if items_root and items_root.has_method("spawn_pickup"):
		return items_root.spawn_pickup(item, count, pos, impulse)
	if ResourceLoader.exists(PICKUP_SCENE):
		var p := (load(PICKUP_SCENE) as PackedScene).instantiate()
		p.set("item_id", item)
		p.set("count", count)
		p.set("dynamic", true)
		(items_root if items_root else self).add_child(p)
		if p is Node3D:
			(p as Node3D).global_position = pos
		if p is RigidBody3D:
			(p as RigidBody3D).apply_central_impulse(impulse * (p as RigidBody3D).mass)
		return p
	if not _warned_pickup:
		_warned_pickup = true
		push_warning("VegHarvest: no Items root / pickup scene; harvested items are not spawned")
	return null


# ---------------------------------------------------------------------------------------------- effects

func _chip_resources() -> void:
	if _chip_mat:
		return
	_chip_mat = StandardMaterial3D.new()
	_chip_mat.albedo_color = Color(0.86, 0.74, 0.55)
	_chip_mat.vertex_color_use_as_albedo = true
	_chip_mat.roughness = 0.85
	_chip_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var bm := BoxMesh.new()
	bm.size = Vector3(0.035, 0.006, 0.022)
	bm.material = _chip_mat
	_chip_mesh = bm
	_puff_mat = StandardMaterial3D.new()
	_puff_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_puff_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_puff_mat.vertex_color_use_as_albedo = true
	_puff_mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	_puff_mat.albedo_texture = _soft_dot()


func _soft_dot() -> Texture2D:
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(x - 15.5, y - 15.5).length() / 15.5
			img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - d, 0.0, 1.0) ** 2.0))
	return ImageTexture.create_from_image(img)


func _particles_budget() -> int:
	return int(Settings.get_value(&"particles", 2))


## Wood chips flying off an axe hit (one-shot CPUParticles3D, frees itself).
func fx_chips(at: Vector3, normal: Vector3, amount: float) -> void:
	if _particles_budget() <= 0 or not is_inside_tree():
		return
	_chip_resources()
	var p := CPUParticles3D.new()
	p.mesh = _chip_mesh
	p.amount = maxi(4, int(14.0 * amount * (1.0 if _particles_budget() >= 2 else 0.6)))
	p.one_shot = true
	p.explosiveness = 0.95
	p.lifetime = 1.1
	p.local_coords = false
	var n := normal if normal.length_squared() > 0.1 else Vector3.UP
	p.direction = (n.normalized() + Vector3.UP * 0.6).normalized()
	p.spread = 40.0
	p.initial_velocity_min = 1.8
	p.initial_velocity_max = 4.2
	p.gravity = Vector3(0.0, -9.8, 0.0)
	p.angular_velocity_min = -720.0
	p.angular_velocity_max = 720.0
	p.particle_flag_rotate_y = true
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.6
	var g := Gradient.new()
	g.set_color(0, Color(0.93, 0.83, 0.64))
	g.set_color(1, Color(0.62, 0.5, 0.36))
	p.color_initial_ramp = g
	add_child(p)
	p.global_position = at + n * 0.05
	p.emitting = true
	get_tree().create_timer(p.lifetime + 0.3, false).timeout.connect(p.queue_free)


func fx_rock(at: Vector3, normal: Vector3) -> void:
	if _particles_budget() <= 0 or not is_inside_tree():
		return
	_chip_resources()
	var p := CPUParticles3D.new()
	p.mesh = _chip_mesh
	p.amount = 8
	p.one_shot = true
	p.explosiveness = 1.0
	p.lifetime = 0.7
	p.local_coords = false
	p.direction = normal if normal.length_squared() > 0.1 else Vector3.UP
	p.spread = 50.0
	p.initial_velocity_min = 2.0
	p.initial_velocity_max = 4.0
	p.gravity = Vector3(0.0, -9.8, 0.0)
	p.scale_amount_min = 0.4
	p.scale_amount_max = 1.0
	p.color = Color(0.45, 0.44, 0.42)
	add_child(p)
	p.global_position = at
	p.emitting = true
	get_tree().create_timer(1.0, false).timeout.connect(p.queue_free)


## Snow / needle-litter puff where a felled crown hits the ground.
func fx_impact(at: Vector3, trunk_axis: Vector3, energy: float) -> void:
	if _particles_budget() <= 0 or not is_inside_tree():
		return
	_chip_resources()
	var sc: Variant = RenderingServer.global_shader_parameter_get(&"snow_cover")
	var snowy := at.y > 1750.0 or (sc is float and float(sc) > 0.3)
	var p := CPUParticles3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.2, 1.2)
	q.material = _puff_mat
	p.mesh = q
	p.amount = int(24 * clampf(energy, 0.5, 1.2))
	p.one_shot = true
	p.explosiveness = 0.9
	p.lifetime = 2.6
	p.local_coords = false
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	var ax := Vector3(trunk_axis.x, 0.0, trunk_axis.z).normalized()
	p.emission_box_extents = Vector3(2.5, 0.3, 2.5)
	p.direction = Vector3.UP
	p.spread = 70.0
	p.initial_velocity_min = 0.6
	p.initial_velocity_max = 2.4
	p.gravity = Vector3(0.0, -0.6, 0.0)
	p.damping_min = 0.8
	p.damping_max = 1.6
	p.scale_amount_min = 0.8
	p.scale_amount_max = 2.2
	var c := Color(0.92, 0.94, 0.97, 0.5) if snowy else Color(0.55, 0.5, 0.42, 0.35)
	var g := Gradient.new()
	g.set_color(0, c)
	g.set_color(1, Color(c.r, c.g, c.b, 0.0))
	p.color_ramp = g
	add_child(p)
	p.global_position = at
	if ax.length_squared() > 0.1:
		p.global_basis = Basis(Vector3.UP, atan2(ax.x, ax.z))
	p.emitting = true
	get_tree().create_timer(p.lifetime + 0.3, false).timeout.connect(p.queue_free)


# ---------------------------------------------------------------------------------------------- persistence

func save_state() -> Dictionary:
	var t := {}
	for id in trees:
		var st: TreeState = trees[id]
		t[str(id)] = {"hp": st.hp, "max": st.max_hp, "cut": st.cut_h, "dir": SaveUtil.v3(st.dir)}
	var sp := {}
	for id in stumps:
		sp[str(id)] = {"cut": float(stumps[id]["cut"]), "dir": SaveUtil.v3(stumps[id]["dir"])}
	var fl := {}
	for id in fallen:
		var ft: VegFelledTree = fallen[id]
		if is_instance_valid(ft):
			fl[str(id)] = ft.save_data()
	var us := {}
	for id in uses:
		var u: Vector3 = uses[id]
		us[str(id)] = [u.x, u.y, snappedf(u.z, 0.01)]
	return {"trees": t, "stumps": sp, "fallen": fl, "uses": us}


func clear_state() -> void:
	for id in trees:
		var st: TreeState = trees[id]
		if st.hero:
			st.hero.queue_free()
		if st.decal:
			st.decal.queue_free()
		if vegetation:
			vegetation.unhide_instance(id)
	trees.clear()
	for id in _stump_nodes:
		(_stump_nodes[id] as Node).queue_free()
	_stump_nodes.clear()
	stumps.clear()
	for id in fallen:
		if is_instance_valid(fallen[id]):
			(fallen[id] as Node).queue_free()
	fallen.clear()
	for c in get_children():
		if c is HingeJoint3D:
			c.queue_free()
	uses.clear()


func load_state(data: Dictionary) -> void:
	clear_state()
	for k in data.get("uses", {}):
		var a: Array = data["uses"][k]
		if a.size() >= 3:
			uses[int(k)] = Vector3(float(a[0]), float(a[1]), float(a[2]))
	for k in data.get("stumps", {}):
		var id := int(k)
		var d: Dictionary = data["stumps"][k]
		var e := _entry(id)
		if e.is_empty():
			continue
		stumps[id] = {"cut": float(d.get("cut", 0.7)), "dir": SaveUtil.to_v3(d.get("dir"), Vector3.BACK)}
		_make_stump(id, e, float(d.get("cut", 0.7)), null, null)
	for k in data.get("fallen", {}):
		var id := int(k)
		var d: Dictionary = data["fallen"][k]
		var e := _entry(id)
		if e.is_empty():
			continue
		var ms := lib.meshes(e["kind"])
		if ms.is_empty():
			continue
		var cut := float(stumps.get(id, {}).get("cut", 0.7))
		var s: float = e["scale"]
		var ft := VegFelledTree.new()
		ft.name = "Felled_%d" % id
		add_child(ft)
		ft.setup(self, id, e["kind"], e["info"], ms[0], e["xf"], cut, _radius_at(e["kind"], cut / s) * s, _cap())
		ft.restore_down(SaveUtil.to_xform(d.get("xf")), float(d.get("buck", cut / s)), int(d.get("logs", 1)),
			float(d.get("hp", 0.0)), bool(d.get("down", true)))
		fallen[id] = ft
	for k in data.get("trees", {}):
		var id := int(k)
		var d: Dictionary = data["trees"][k]
		var e := _entry(id)
		if e.is_empty() or vegetation.removed.has(id):
			continue
		var st := TreeState.new()
		st.max_hp = float(d.get("max", 100.0))
		st.hp = float(d.get("hp", st.max_hp))
		st.cut_h = float(d.get("cut", 0.8))
		st.dir = SaveUtil.to_v3(d.get("dir"), Vector3.BACK)
		trees[id] = st
		_make_hero(id, e, st)
		_update_notch(st, e, clampf(1.0 - st.hp / st.max_hp, 0.0, 1.0))

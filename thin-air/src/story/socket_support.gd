class_name SocketSupport
extends RefCounted
## What a loot / log socket of a story location rests on: the location's own render meshes (tables, shelves,
## bunks, crates, floors — most have no collider) and, outdoors, the terrain. Used by the socket settle tool
## (src/dev/settle_sockets.gd, which snaps Loot_*/Log_* markers of scenes/poi/*.tscn down onto their support) and
## by tests/test_poi_assets.gd (no hovering loot). The meshes go into a private physics space: usable at once,
## freed by free_space().

const REACH := 2.5          ## how far below a socket to look for support (m)
const FOOT := 0.08          ## half footprint of the 5 probe rays (a typical small item)


## Private physics space holding trimesh copies of the site's render meshes (placed site, world transforms).
static func build_space(site: Node3D) -> Dictionary:
	var ps := PhysicsServer3D
	var space := ps.space_create()
	ps.space_set_active(space, true)
	var bodies: Array[RID] = []
	var shapes: Array[Shape3D] = []
	for c in site.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		if mi.mesh == null:
			continue
		var shape := mi.mesh.create_trimesh_shape()
		if shape == null:
			continue
		shapes.append(shape)
		var body := ps.body_create()
		ps.body_set_mode(body, PhysicsServer3D.BODY_MODE_STATIC)
		ps.body_add_shape(body, shape.get_rid())
		ps.body_set_state(body, PhysicsServer3D.BODY_STATE_TRANSFORM, mi.global_transform)
		ps.body_set_space(body, space)
		bodies.append(body)
	return {"space": space, "bodies": bodies, "shapes": shapes, "outdoor": not bool(site.get(&"interior"))}


static func free_space(d: Dictionary) -> void:
	for b: RID in d.get("bodies", []):
		PhysicsServer3D.free_rid(b)
	if d.has("space"):
		PhysicsServer3D.free_rid(d["space"])
	d.clear()


## Height of the highest support under a socket at world point p (rays from 5 cm above it, over a small
## footprint), or -INF when nothing is within REACH.
static func support_y(d: Dictionary, p: Vector3) -> float:
	var st := PhysicsServer3D.space_get_direct_state(d["space"])
	var top := p.y + 0.05
	var best := -INF
	for o: Vector2 in [Vector2.ZERO, Vector2(-FOOT, -FOOT), Vector2(FOOT, -FOOT), Vector2(-FOOT, FOOT), Vector2(FOOT, FOOT)]:
		var x := p.x + o.x
		var z := p.z + o.y
		if st:
			var hit := st.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, top, z), Vector3(x, top - REACH, z)))
			if not hit.is_empty():
				best = maxf(best, (hit["position"] as Vector3).y)
		if bool(d.get("outdoor", false)) and TerrainData.is_loaded():
			var ty := TerrainData.get_height(x, z)
			if ty <= top and ty > top - REACH:
				best = maxf(best, ty)
	return best


## Sockets whose objects must rest on something: Loot_* and Log_* (except wall-mounted logs: the whiteboard).
static func loose_sockets(site: Node3D) -> Array[Marker3D]:
	var out: Array[Marker3D] = []
	var s := site.get_node_or_null(^"Sockets")
	if s == null:
		return out
	for c in s.get_children():
		var m := c as Marker3D
		if m == null:
			continue
		var n := String(m.name)
		if n.begins_with("Loot_"):
			out.append(m)
		elif n.begins_with("Log_") and m.has_meta(&"log_id"):
			var lid := StringName(m.get_meta(&"log_id"))
			if StoryLogProp.kind_for(lid, Story.get_log(lid) if Story.has_method(&"get_log") else {}) != "wall":
				out.append(m)
	return out

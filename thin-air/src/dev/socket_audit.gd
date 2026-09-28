extends Node
## Dev QA harness: audits every story location in the real world (headless): each story interactable (StoryUse,
## PoiDoor, StoryLog, world loot pickup) must be reachable by the player's interaction ray (2.6 m, layers 1,4,5,7,10)
## from some standing spot around it, and every Arrive_* socket must have floor under it. Loot must rest on
## something (not float) and not sit inside world geometry.
##   timeout 900 godot --headless --path thin-air res://scenes/dev/socket_audit.tscn [-- --site=kestrel_station]
## Prints "BAD ..." lines and "AUDIT RESULT PASS|FAIL".

const RAY_MASK := (1 << 0) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 9)
const FLOOR_MASK := (1 << 0) | (1 << 6)

var args := {}
var bad := 0


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var W: GDScript = load("res://src/world/world.gd")
	W.set(&"dev_no_player", true)
	Game.flags.clear()
	Game.set_flag(&"depot_open", true)
	var world := (load("res://scenes/world/world.tscn") as PackedScene).instantiate()
	add_child(world)
	_run.call_deferred()


func _run() -> void:
	for _i in 6:
		await get_tree().physics_frame
	var st := get_tree().get_first_node_in_group(&"poi_structures")
	st.call(&"apply_story_state")
	for _i in 4:
		await get_tree().physics_frame
	var space := (st as Node3D).get_world_3d().direct_space_state
	var n := 0
	for id: StringName in st.get(&"sites"):
		if args.has("site") and String(id) != args["site"]:
			continue
		var site: Node3D = st.get(&"sites")[id]
		for node in site.find_children("*", "", true, false):
			var kind := ""
			if node is StoryUse or node is PoiDoor or node.is_in_group(&"story_log"):
				kind = "use"
			elif node is ItemPickup:
				kind = "loot"
			elif node is Marker3D and String(node.name).begins_with("Arrive_") and node.name != &"Arrive_Default":
				kind = "arrive"
			if kind == "":
				continue
			n += 1
			_audit(space, String(id), node as Node3D, kind)
	print("audited %d nodes" % n)
	print("AUDIT RESULT %s" % ("FAIL" if bad > 0 else "PASS"))
	get_tree().quit(1 if bad > 0 else 0)


func _floor_below(space: PhysicsDirectSpaceState3D, p: Vector3, up := 0.6, down := 3.0, exclude: Array[RID] = []) -> Variant:
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * up, p + Vector3.DOWN * down, FLOOR_MASK, exclude)
	var r := space.intersect_ray(q)
	return r.get("position", null)


func _report(site: String, node: Node3D, msg: String) -> void:
	bad += 1
	print("BAD %s/%s %s at %s: %s" % [site, node.name, node.get_class() if not (node is ItemPickup) else String((node as ItemPickup).item_id),
		"(%.2f, %.2f, %.2f)" % [node.global_position.x, node.global_position.y, node.global_position.z], msg])


func _audit(space: PhysicsDirectSpaceState3D, site: String, node: Node3D, kind: String) -> void:
	var p := node.global_position
	if kind == "arrive":
		var f: Variant = _floor_below(space, p, 0.5, 1.5)
		if f == null:
			_report(site, node, "no floor under the arrival point")
		elif p.y - (f as Vector3).y > 0.4:
			_report(site, node, "arrival point %.2f m above the floor" % (p.y - (f as Vector3).y))
		return
	if node.is_in_group(&"story_log"):
		# logs handed over by an interactable they lie inside (Hale's notebook: "Kneel by Elias Hale")
		for key: String in Story.graph.uses:
			if key.begins_with(site + "/") and (Story.graph.uses[key] as Dictionary).get("logs", []).has(String(node.get(&"log_id"))):
				return
	var target_rid := (node as CollisionObject3D).get_rid() if node is CollisionObject3D else RID()
	if kind == "loot":
		var ex: Array[RID] = [target_rid]
		var f2: Variant = _floor_below(space, p, 0.3, 2.0, ex)
		# furniture is often visual-only: only clearly floating loot (or loot over nothing) counts
		if f2 == null or p.y - (f2 as Vector3).y > 1.3:
			_report(site, node, "floating (%s)" % ("nothing below" if f2 == null else "%.2f m above support" % (p.y - (f2 as Vector3).y)))
		var pq := PhysicsPointQueryParameters3D.new()
		pq.position = p + Vector3.UP * 0.08
		pq.collision_mask = FLOOR_MASK
		var inside := space.intersect_point(pq, 1)
		if not inside.is_empty():
			var col: Node = inside[0].get("collider")
			_report(site, node, "buried inside world geometry (%s)" % (str(col.get_path()).replace("/root/SocketAudit/World/Structures/", "") if col else "?"))
	# reachable: stand somewhere 0.6..1.9 m away on a floor with headroom, eye 1.62 m up, the interact ray hits it
	var aim := p
	for c in node.get_children():
		if c is CollisionShape3D:
			aim = (c as CollisionShape3D).global_position
			break
	for r in [0.8, 1.3, 1.9]:
		for k in 16:
			var a := TAU * k / 16.0
			var stand := Vector3(p.x + cos(a) * r, p.y, p.z + sin(a) * r)
			var f3: Variant = _floor_below(space, stand, 0.4, 3.5)
			if f3 == null:
				continue
			var eye: Vector3 = (f3 as Vector3) + Vector3.UP * 1.62
			# headroom: the standing capsule must not overlap the world
			var hq := PhysicsRayQueryParameters3D.create((f3 as Vector3) + Vector3.UP * 0.3, eye + Vector3.UP * 0.15, FLOOR_MASK)
			if not space.intersect_ray(hq).is_empty():
				continue
			if eye.distance_to(aim) > 2.55:
				continue
			var rq := PhysicsRayQueryParameters3D.create(eye, eye + (aim - eye).normalized() * 2.6, RAY_MASK)
			rq.collide_with_areas = false
			var hit := space.intersect_ray(rq)
			if hit.get("rid", RID()) == target_rid or hit.get("collider") == node:
				return
			# the player's interactor assist (src/player/interactor.gd): an interactable just behind a box it hit
			if not hit.is_empty() and PlayerInteractor._resolve(hit.get("collider")) == null:
				var sq := PhysicsShapeQueryParameters3D.new()
				var sp := SphereShape3D.new()
				sp.radius = PlayerInteractor.ASSIST_RADIUS
				sq.shape = sp
				sq.collision_mask = PlayerInteractor.ASSIST_MASK
				sq.transform = Transform3D(Basis(), (hit["position"] as Vector3) + (aim - eye).normalized() * PlayerInteractor.ASSIST_RADIUS * 0.8)
				for h2 in space.intersect_shape(sq, 8):
					if h2.get("collider") == node:
						return
	# what blocks it: the first hit of a ray from 1.5 m in front (socket -Z) at eye height
	var from := p + node.global_basis.z.normalized() * 1.5 + Vector3.UP * 0.4
	var bq := PhysicsRayQueryParameters3D.create(from, aim, RAY_MASK)
	var bh := space.intersect_ray(bq)
	var blk: Node = bh.get("collider")
	_report(site, node, "not reachable by the interaction ray from any standing spot (front ray hits %s)" % (
		str(blk.get_path()).replace("/root/SocketAudit/World/Structures/", "") if blk else "nothing"))

extends TestCase
## Water stream: meshes per lake/river, rendered levels == TerrainData.get_water_level at many sample points,
## buoyancy volumes (layer 6) + floating/sinking bodies, underwater detection, drinking helper, river flow,
## falls/audio sites, draw-call budget, Mobile shader paths free of screen/depth textures.
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_water.gd

var water: WaterSystem


func run() -> void:
	check(TerrainData.is_loaded(), "terrain data loaded")
	var ps: PackedScene = load("res://scenes/world/water.tscn")
	check(ps != null, "scenes/world/water.tscn loads")
	water = ps.instantiate() as WaterSystem
	check(water != null, "water.tscn root is WaterSystem")
	if water == null:
		return
	add_child(water)
	await get_tree().process_frame
	await get_tree().physics_frame
	_meshes()
	_lake_levels()
	_river_levels()
	_volumes()
	await _buoyancy()
	await _underwater()
	_drinking()
	_flow()
	_falls_budget()
	_shader_paths()


func _mesh_vertices(mi: MeshInstance3D) -> PackedVector3Array:
	if mi == null or mi.mesh == null or mi.mesh.get_surface_count() == 0:
		return PackedVector3Array()
	return mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]


func _meshes() -> void:
	var lakes: Array = TerrainData.get_lakes()
	var lv := _mesh_vertices(water.get_lake_mesh())
	check(lv.size() >= 3, "lake mesh has geometry (%d vertices)" % lv.size())
	for lk in lakes:
		var level := float(lk["level"])
		var c := Vector2(float(lk["x"]), float(lk["z"]))
		var r := float(lk["radius"]) * 1.6 + 10.0
		var n := 0
		for v in lv:
			if absf(v.y - level) < 0.001 and Vector2(v.x, v.z).distance_to(c) < r:
				n += 1
		check(n >= 3, "lake '%s' has a mesh at its level %.1f (%d vertices)" % [lk["id"], level, n])
	var rivers: Array = TerrainData.get_rivers()
	var all_rv := PackedVector3Array()
	for mi in water.get_river_meshes():
		all_rv.append_array(_mesh_vertices(mi))
	check(all_rv.size() > 1000, "river meshes have geometry (%d vertices in %d meshes)" % [all_rv.size(), water.get_river_meshes().size()])
	for rv in rivers:
		var pts: Array = rv["points"]
		var hits := 0
		var probes := 0
		for k in [pts.size() / 4, pts.size() / 2, (pts.size() * 3) / 4]:
			var p: Array = pts[k]
			var q := Vector2(float(p[0]), float(p[2]))
			probes += 1
			for v in all_rv:
				if Vector2(v.x, v.z).distance_to(q) < float(p[3]) * 0.5 + 1.5:
					hits += 1
					break
		check(hits == probes, "river '%s' has a ribbon along its polyline (%d/%d probes)" % [rv["id"], hits, probes])


## Every visible bit of lake surface (terrain more than 0.25 m below it) must be water to TerrainData at that
## height, and every point of the data polygon must be drawn.
func _lake_levels() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242
	for lk in TerrainData.get_lakes():
		var level := float(lk["level"])
		var poly := WaterBuilder.lake_polygon(lk)
		var mesh_poly := WaterBuilder.lake_mesh_polygon(lk)
		var bb := Rect2(mesh_poly[0], Vector2.ZERO)
		for q in mesh_poly:
			bb = bb.expand(q)
		var visible := 0
		var agree := 0
		var worst := 0.0
		var n := 0
		var ok := 0
		var covered := 0
		for _i in 3000:
			var q2 := Vector2(rng.randf_range(bb.position.x, bb.end.x), rng.randf_range(bb.position.y, bb.end.y))
			var wl := TerrainData.get_water_level(q2.x, q2.y)
			# drawn and visible (terrain > 0.25 m below the surface) → TerrainData must have water there
			if Geometry2D.is_point_in_polygon(q2, mesh_poly) and TerrainData.get_height(q2.x, q2.y) < level - 0.25:
				visible += 1
				if wl != -INF and wl >= level - 0.05:
					agree += 1
				else:
					worst = maxf(worst, level - TerrainData.get_height(q2.x, q2.y))
			# inside the data polygon → drawn, and the level is the lake's (or a river running into it: max)
			if Geometry2D.is_point_in_polygon(q2, poly):
				n += 1
				if wl >= level - 0.05 and wl != -INF:
					ok += 1
				if Geometry2D.is_point_in_polygon(q2, mesh_poly):
					covered += 1
		var frac := float(agree) / maxf(visible, 1)
		check(visible > 30 and frac >= 0.985,
			"lake '%s': drawn surface is water at level to get_water_level at %d/%d visible samples (%.1f%%, deepest miss %.2f m)" % [lk["id"], agree, visible, frac * 100.0, worst])
		check(n > 20 and ok == n and covered == n,
			"lake '%s': get_water_level >= %.1f at %d/%d points inside, mesh covers %d/%d" % [lk["id"], level, ok, n, covered, n])


## Rivers: (1) the drawn ribbon == WaterQuery.surface_at inside every quad; (2) TerrainData.get_water_level ==
## the drawn surface on gentle single-thread reaches; steep and braided reaches are reported (TerrainData takes
## the max over overlapping round-capped segments there, i.e. the level of a reach upstream).
func _river_levels() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	var n := 0
	var ok := 0
	for mi in water.get_river_meshes():
		var arr := mi.mesh.surface_get_arrays(0)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		for q in range(0, v.size(), 4):
			# a random point in the quad (a-left, a-right, b-left, b-right), inside the TerrainData width
			var u := rng.randf_range(0.2, 0.8)
			var w := rng.randf_range(0.1, 0.9)
			var p := v[q].lerp(v[q + 1], u).lerp(v[q + 2].lerp(v[q + 3], u), w)
			if TerrainData.get_height(p.x, p.z) > p.y - 0.1:
				continue            # not visible (bank / bar above the water)
			n += 1
			var s := WaterQuery.surface_at(p.x, p.z)
			if s != -INF and s >= p.y - 0.15:
				ok += 1
	check(n > 1000 and float(ok) / n >= 0.98, "drawn river surface == WaterQuery.surface_at at %d/%d visible samples" % [ok, n])
	var lake_polys: Array = []
	for lk in TerrainData.get_lakes():
		lake_polys.append(WaterBuilder.lake_polygon(lk))
	var total := 0
	var agree := 0
	var steep := 0
	var steep_ok := 0
	var braid := 0
	var braid_ok := 0
	var clamped := 0
	var sides := 0
	var sides_ok := 0
	var worst := 0.0
	for rv in TerrainData.get_rivers():
		for sec in WaterBuilder.river_sections(rv, lake_polys):
			var p: Vector3 = sec["p"]
			if sec["clamped"]:
				clamped += 1
				continue
			var wl := TerrainData.get_water_level(p.x, p.z)
			var good := wl != -INF and p.y <= wl + 0.05 and wl - p.y < 0.6
			if float(sec["slope"]) >= WaterBuilder.CASCADE_SLOPE:
				steep += 1
				steep_ok += 1 if good else 0
			elif sec["braided"]:
				braid += 1
				braid_ok += 1 if good else 0
				worst = maxf(worst, wl - p.y)
			else:
				total += 1
				agree += 1 if good else 0
			# half way to each bank: TerrainData reports water across the drawn width
			var d: Vector2 = sec["dir"]
			var hw: float = sec["hw"] - 0.8 - WaterBuilder.RIVER_EDGE_MARGIN
			for sd: float in [-0.5, 0.5]:
				var x: float = p.x - d.y * hw * sd
				var z: float = p.z + d.x * hw * sd
				sides += 1
				if TerrainData.get_water_level(x, z) != -INF:
					sides_ok += 1
	var frac := float(agree) / maxf(total, 1)
	check(total > 400 and frac >= 0.95, "TerrainData.get_water_level == drawn river surface at %d/%d gentle cross-sections (%.1f%%)" % [agree, total, frac * 100.0])
	print("INFO rivers: steep reaches agree at %d/%d, braided Hollow River at %d/%d (TerrainData up to %.1f m above the drawn water there)" % [steep_ok, steep, braid_ok, braid, worst])
	check(float(sides_ok) / maxf(sides, 1) >= 0.97, "river width: TerrainData has water at %d/%d half-bank samples" % [sides_ok, sides])
	check(clamped < total / 50, "data glitches seated on the channel: %d cross-sections (surface > %.1f m above both banks)" % [clamped, WaterBuilder.MAX_ABOVE_BED])


func _volumes() -> void:
	var vols := water.get_volumes()
	var lakes := 0
	var rivers := 0
	for v in vols:
		if v.is_lake:
			lakes += 1
		else:
			rivers += 1
	check(lakes == TerrainData.get_lakes().size(), "one buoyancy volume per lake (%d)" % lakes)
	check(rivers == TerrainData.get_rivers().size(), "one buoyancy volume per river (%d)" % rivers)
	var all_layer6 := true
	var items_mask := true
	for v in vols:
		all_layer6 = all_layer6 and v.collision_layer == 1 << 5 and v.monitorable
		items_mask = items_mask and (v.collision_mask & (1 << 3)) != 0 and v.monitoring
	check(all_layer6 and items_mask, "all volumes: layer 6, monitorable (player sensor), monitor items (layer 4)")
	var loon := TerrainData.get_lakes()[0] as Dictionary
	var found := false
	for v in vols:
		if v.is_lake and String(v.water_id) == String(loon["id"]):
			found = v.is_in_group(&"water") and absf(v.get_water_surface() - float(loon["level"])) < 0.001
	check(found, "Loon Lake volume is in group 'water' and reports its level to the player sensor")
	# the volume really covers the lake: physics point query at the lake centre just under the surface
	var space := get_viewport().world_3d.direct_space_state if get_viewport() else null
	if space:
		var q := PhysicsPointQueryParameters3D.new()
		q.position = Vector3(float(loon["x"]), float(loon["level"]) - 0.5, float(loon["z"]))
		q.collide_with_areas = true
		q.collide_with_bodies = false
		q.collision_mask = 1 << 5
		var hits := space.intersect_point(q, 8)
		check(hits.size() > 0, "point query under Loon Lake's surface hits a water volume (%d)" % hits.size())


func _buoyancy() -> void:
	var loon := TerrainData.get_lakes()[0] as Dictionary
	var level := float(loon["level"])
	var c := Vector3(float(loon["x"]), level, float(loon["z"]))
	var wood := _body(0.5, 22.0)        # 0.125 m³ box, ~0.07 m³ displacement estimate → floats
	var rock := _body(0.3, 80.0)        # dense → sinks
	add_child(wood)
	add_child(rock)
	wood.global_position = c + Vector3(3.0, -0.8, 0.0)
	rock.global_position = c + Vector3(-3.0, -0.3, 0.0)
	var info_w := WaterVolume.estimate_body(wood)
	var info_r := WaterVolume.estimate_body(rock)
	check(wood.mass / info_w.y < 1000.0 and rock.mass / info_r.y > 1000.0,
		"density estimate: wood %.0f kg/m³ floats, rock %.0f kg/m³ sinks" % [wood.mass / info_w.y, rock.mass / info_r.y])
	for _i in 150:
		await get_tree().physics_frame
	var wy := wood.global_position.y
	var ry := rock.global_position.y
	check(absf(wy - level) < 0.45, "wooden body floats at the surface after 2.5 s (y %.2f vs level %.2f)" % [wy, level])
	check(ry < level - 1.5, "dense body sinks (y %.2f, %.1f m under)" % [ry, level - ry])
	wood.queue_free()
	rock.queue_free()
	# river drift: a floating body in a creek is carried downstream
	var rv: Dictionary = TerrainData.get_rivers()[TerrainData.get_rivers().size() - 1]
	var pts: Array = rv["points"]
	var k := pts.size() / 2
	var pa := Vector3(float(pts[k][0]), float(pts[k][1]), float(pts[k][2]))
	var fl := WaterQuery.flow_at(pa + Vector3(0.0, -0.1, 0.0))
	check(fl.length() > 0.3, "river '%s' current at mid-course %.2f m/s" % [rv["id"], fl.length()])


func _body(size: float, mass: float) -> RigidBody3D:
	var rb := RigidBody3D.new()
	rb.mass = mass
	rb.collision_layer = 1 << 3
	rb.collision_mask = 1
	var cs := CollisionShape3D.new()
	var bx := BoxShape3D.new()
	bx.size = Vector3(size, size, size)
	cs.shape = bx
	rb.add_child(cs)
	return rb


func _underwater() -> void:
	var loon := TerrainData.get_lakes()[0] as Dictionary
	var level := float(loon["level"])
	var c := Vector3(float(loon["x"]), level, float(loon["z"]))
	check(absf(WaterUnderwater.depth_below_surface(c - Vector3(0, 2.0, 0)) - 2.0) < 0.01, "2 m under Loon Lake → depth 2")
	check(WaterUnderwater.depth_below_surface(c + Vector3(0, 0.5, 0)) < 0.0, "above the surface → not underwater")
	var land := TerrainData.get_poi(&"fire_lookout")["position"] as Vector3
	check(WaterUnderwater.depth_below_surface(land + Vector3(0, 1.0, 0)) < 0.0, "on land → not underwater")
	check(WaterQuery.is_underwater(c - Vector3(0, 1.0, 0)) and not WaterQuery.is_underwater(c + Vector3(0, 1.0, 0)),
		"WaterQuery.is_underwater agrees")
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = c - Vector3(0, 1.5, 0)
	cam.make_current()
	for _i in 4:
		await get_tree().process_frame
	check(water.is_camera_underwater(), "camera 1.5 m under the lake → underwater overlay on")
	var uw := water.get_underwater()
	check(uw != null and uw.depth > 1.2, "overlay depth %.2f m" % (uw.depth if uw else -1.0))
	cam.global_position = c + Vector3(0, 1.7, 0)
	for _i in 4:
		await get_tree().process_frame
	check(not water.is_camera_underwater(), "camera above the surface → overlay off")
	cam.queue_free()


func _drinking() -> void:
	var loon := TerrainData.get_lakes()[0] as Dictionary
	var poly := WaterBuilder.lake_polygon(loon)
	var ok := 0
	var n := 0
	for i in range(0, poly.size(), 6):
		var p := poly[i]
		# stand 0.8 m back from the polygon vertex, away from the lake centre
		var away := (p - Vector2(float(loon["x"]), float(loon["z"]))).normalized()
		var s := p + away * 0.3
		var feet := Vector3(s.x, TerrainData.get_height(s.x, s.y), s.y)
		n += 1
		if WaterQuery.is_drinkable_at(feet):
			ok += 1
	check(ok >= n * 0.8, "drinkable standing on Loon Lake's shore (%d/%d spots)" % [ok, n])
	var land := TerrainData.get_poi(&"fire_lookout")["position"] as Vector3
	check(not WaterQuery.is_drinkable_at(land), "not drinkable at the fire lookout")
	var rv: Dictionary = TerrainData.get_rivers()[2]
	var p2: Array = rv["points"][10]
	var bank := Vector3(float(p2[0]), float(p2[1]) + 0.3, float(p2[2]))
	check(WaterQuery.is_drinkable_at(bank), "drinkable on the lower Hollow River")


func _flow() -> void:
	var loon := TerrainData.get_lakes()[0] as Dictionary
	check(WaterQuery.flow_at(Vector3(float(loon["x"]), float(loon["level"]), float(loon["z"]))) == Vector3.ZERO,
		"no current in the middle of Loon Lake")
	var ok := 0
	var n := 0
	for rv in TerrainData.get_rivers():
		var pts: Array = rv["points"]
		var p: Array = pts[pts.size() / 3]
		var f := WaterQuery.flow_at(Vector3(float(p[0]), float(p[1]), float(p[2])))
		n += 1
		if f.length() > 0.3 and f.y <= 0.001:
			ok += 1
	check(ok == n, "every river flows downhill at a third of its course (%d/%d)" % [ok, n])
	check(WaterQuery.flow_speed(0.02, 12.0) < WaterQuery.flow_speed(0.4, 12.0), "steeper reaches run faster")


func _falls_budget() -> void:
	var falls := water.get_fall_sites()
	var n_fall := 0
	for f in falls:
		if f["kind"] == &"fall":
			n_fall += 1
	check(n_fall >= 1, "waterfalls found on steep reaches (%d falls, %d sites)" % [n_fall, falls.size()])
	var ids := {}
	for e in water.get_emitters():
		ids[e["id"]] = true
	check(ids.has(&"waterfall_loop"), "waterfall_loop emitters placed (%d emitters)" % water.get_emitters().size())
	var dc := water.water_draw_calls()
	check(dc <= 12, "lakes + rivers + mist ≤ 12 draw calls (%d)" % dc)


func _shader_paths() -> void:
	var inc := FileAccess.get_file_as_string("res://assets/shaders/water_lake.gdshaderinc")
	var mobile := FileAccess.get_file_as_string("res://assets/shaders/water_lake_mobile.gdshader")
	var river := FileAccess.get_file_as_string("res://assets/shaders/water_river.gdshader")
	var common := FileAccess.get_file_as_string("res://assets/shaders/water_common.gdshaderinc")
	var inside := false
	var leak := false
	for line in inc.split("\n"):
		var l := line.strip_edges()
		if l.begins_with("#ifdef WATER_SSR"):
			inside = true
		elif l.begins_with("#endif"):
			inside = false
		elif (l.contains("hint_screen_texture") or l.contains("hint_depth_texture") or l.contains("SCREEN_TEXTURE")
				or l.contains("DEPTH_TEXTURE")) and not inside:
			leak = true
	check(not leak and not mobile.contains("WATER_SSR"), "Mobile lake shader: no screen/depth texture reads")
	check(not river.contains("hint_screen_texture") and not river.contains("hint_depth_texture")
		and not common.contains("hint_screen_texture") and not common.contains("hint_depth_texture"),
		"river shader + common include: no screen/depth texture reads")
	check(water.lake_material.shader != null and water.river_material.shader != null, "water materials have shaders")

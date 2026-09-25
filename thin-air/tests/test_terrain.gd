extends TestCase
## Terrain data: loads, heights/normals sane, POI pads flat at their altitudes, golden path walkable,
## water levels, raycast, surfaces/biomes, global shader parameters.
## Run: timeout 180 godot --headless --path thin-air res://tests/test_runner.tscn -- --test=res://tests/test_terrain.gd

const POI_IDS: Array[StringName] = [&"crash_site", &"loon_lake", &"ranger_cabin", &"fire_lookout", &"ashford_mine",
	&"trapper_cabin", &"owens_bivouac", &"icefall", &"glacier_camp", &"ice_cave", &"kestrel_station", &"summit"]
const SURFACES: Array[StringName] = [&"snow", &"rock", &"scree", &"grass", &"forest", &"dirt", &"ice", &"gravel"]
const BIOMES: Array[StringName] = [&"valley", &"forest", &"subalpine", &"alpine", &"glacier", &"summit"]


func run() -> void:
	_data()
	_heights_normals()
	_pois()
	_golden_path()
	_water()
	_raycast()
	_surfaces()
	_globals()
	_speed()


func _data() -> void:
	check(TerrainData.is_loaded(), "terrain data loaded")
	check(TerrainData.heights.size() == TerrainData.SIZE * TerrainData.SIZE, "heightfield is 2049^2")
	check(TerrainData.min_height > 1250.0 and TerrainData.min_height < 1350.0,
		"lowest point ~1,300 m (%.1f)" % TerrainData.min_height)
	check(absf(TerrainData.max_height - 3452.0) < 2.0, "highest point is Mount Corrigan 3,452 m (%.1f)" % TerrainData.max_height)
	check(TerrainData.masks.size() == TerrainData.MASK_SIZE * TerrainData.MASK_SIZE * 4, "masks.bin loaded")
	check(TerrainData.masks2.size() == TerrainData.MASK_SIZE * TerrainData.MASK_SIZE * 4, "masks2.bin loaded")
	check(TerrainData.mid_heights.size() == TerrainData.MID_SIZE * TerrainData.MID_SIZE, "mid.f32 loaded")
	check(TerrainData.far_heights.size() == TerrainData.FAR_SIZE * TerrainData.FAR_SIZE, "far.f32 loaded")
	check(TerrainData.height_texture != null and TerrainData.mask_texture != null, "GPU textures built")
	check(TerrainData.normal_texture != null, "normal texture loaded")
	var sp: Dictionary = TerrainData.layout.get("spawn", {})
	check(not sp.is_empty(), "layout has spawn")
	if not sp.is_empty():
		var c: Vector3 = TerrainData.get_poi(&"crash_site")["position"]
		var s := Vector3(float(sp["x"]), 0.0, float(sp["z"]))
		check(Vector2(s.x - c.x, s.z - c.z).length() < 25.0, "spawn is at the crash site")
		# yaw 0 looks -Z; the spawn yaw must face the wreck
		var yaw := deg_to_rad(float(sp["yaw"]))
		var fwd := Vector2(-sin(yaw), -cos(yaw))
		var to := Vector2(c.x - s.x, c.z - s.z).normalized()
		check(fwd.dot(to) > 0.95, "spawn faces the wreck")


func _heights_normals() -> void:
	# bilinear sampling reproduces the grid exactly at vertices
	var i := 1000
	var j := 777
	var x := -TerrainData.HALF + i * TerrainData.CELL
	var z := -TerrainData.HALF + j * TerrainData.CELL
	check(is_equal_approx(TerrainData.get_height(x, z), TerrainData.heights[j * TerrainData.SIZE + i]),
		"get_height matches the grid at vertices")
	# clamps outside
	check(is_equal_approx(TerrainData.get_height(-5000.0, 0.0), TerrainData.get_height(-TerrainData.HALF, 0.0)),
		"get_height clamps outside the map")
	check(TerrainData.in_bounds(0, 0) and not TerrainData.in_bounds(1600, 0) and not TerrainData.in_bounds(0, 1500, 50.0),
		"in_bounds with margin")
	# extended heights continue the map smoothly across the edge
	var e_in := TerrainData.get_height(1535.0, 200.0)
	var e_out := TerrainData.get_height_extended(1541.0, 200.0)
	check(absf(e_in - e_out) < 25.0, "MID band continues the map edge (%.1f vs %.1f)" % [e_in, e_out])
	var rng := RandomNumberGenerator.new()
	rng.seed = 1234
	var ok_n := true
	var ok_s := true
	var ok_m := true
	var max_slope := 0.0
	for _k in 400:
		var px := rng.randf_range(-1500, 1500)
		var pz := rng.randf_range(-1500, 1500)
		var n := TerrainData.get_normal(px, pz)
		if absf(n.length() - 1.0) > 1e-3 or n.y <= 0.0:
			ok_n = false
		var sl := TerrainData.get_slope_deg(px, pz)
		max_slope = maxf(max_slope, sl)
		if sl < 0.0 or sl > 90.0:
			ok_s = false
		var m := TerrainData.get_masks(px, pz)
		for c in 4:
			if m[c] < 0.0 or m[c] > 1.0:
				ok_m = false
	check(ok_n, "normals are unit and point up")
	check(ok_s, "slopes in [0, 90] (max sampled %.1f)" % max_slope)
	check(ok_m, "masks in [0, 1]")
	# flat pad: normal is straight up
	var c2: Vector3 = TerrainData.get_poi(&"kestrel_station")["position"]
	check(TerrainData.get_normal(c2.x, c2.z).y > 0.99, "station pad normal points up")


func _pois() -> void:
	check(TerrainData.all_pois().size() >= POI_IDS.size(), "all POIs present (%d)" % TerrainData.all_pois().size())
	for id in POI_IDS:
		var p: Dictionary = TerrainData.get_poi(id)
		check(not p.is_empty(), "POI %s exists" % id)
		if p.is_empty():
			continue
		check(p.has("position") and p.has("radius") and p.has("name"), "POI %s has position/radius/name" % id)
	check(TerrainData.get_poi(&"nope").is_empty(), "unknown POI -> {}")
	# designed approximate positions (DESIGN.md §3) within 60 m
	var want := {&"crash_site": Vector2(-520, 820), &"loon_lake": Vector2(260, 640), &"ranger_cabin": Vector2(420, 520),
		&"fire_lookout": Vector2(-900, 260), &"ashford_mine": Vector2(820, -80), &"trapper_cabin": Vector2(-760, -260),
		&"owens_bivouac": Vector2(380, -520), &"icefall": Vector2(-60, -760), &"kestrel_station": Vector2(-360, -980),
		&"summit": Vector2(120, -1260)}
	for id in want:
		var p2: Vector3 = TerrainData.get_poi(id)["position"]
		check(Vector2(p2.x, p2.z).distance_to(want[id]) < 60.0, "POI %s at its designed position" % id)
	# pads: flat, at their listed altitude
	for p3 in TerrainData.all_pois():
		var r := float(p3.get("flat_radius", 0.0))
		var pos: Vector3 = p3["position"]
		if r <= 0.0:
			continue
		var gy := TerrainData.get_height(pos.x, pos.z)
		check(absf(gy - pos.y) < 1.0, "POI %s ground %.1f at listed altitude %.1f" % [p3["id"], gy, pos.y])
		var worst := 0.0
		var rr := r * 0.7
		for a in 16:
			var ang := TAU * a / 16.0
			for f in [0.3, 0.65, 1.0]:
				var q := Vector2(pos.x, pos.z) + Vector2(cos(ang), sin(ang)) * rr * f
				worst = maxf(worst, TerrainData.get_slope_deg(q.x, q.y))
				worst = maxf(worst, absf(TerrainData.get_height(q.x, q.y) - pos.y) / maxf(rr * f, 1.0) * 57.3)
		check(worst < 9.0, "POI %s pad is flat (worst %.1f deg within %.0f m)" % [p3["id"], worst, rr])
	# altitude bands from the design
	var alt := {&"crash_site": [1450.0, 1520.0], &"loon_lake": [1400.0, 1440.0], &"ashford_mine": [1900.0, 2000.0],
		&"owens_bivouac": [2250.0, 2350.0], &"kestrel_station": [2900.0, 3000.0], &"icefall": [2450.0, 2850.0],
		&"summit": [3440.0, 3460.0]}
	for id2 in alt:
		var y: float = TerrainData.get_poi(id2)["position"].y
		check(y >= alt[id2][0] and y <= alt[id2][1], "POI %s altitude %.0f in %s" % [id2, y, str(alt[id2])])


## The golden path (valley -> lake -> mine -> treeline -> icefall -> col -> summit) is walkable: along every
## golden trail the ground grade over 3 m stays <= 35 deg, except legs flagged as climbs (icefall, summit ridge).
func _golden_path() -> void:
	var trails: Array = TerrainData.get_trails()
	check(trails.size() >= 5, "trails in layout (%d)" % trails.size())
	var golden_ids := {}
	var reached := {}
	for tr in trails:
		if not bool(tr.get("golden", false)):
			continue
		golden_ids[tr["id"]] = true
		var pts: Array = tr.get("points", [])
		var worst := 0.0
		var worst_at := Vector2.ZERO
		var over := 0
		var total := 0
		var climb_worst := 0.0
		for k in range(pts.size() - 1):
			var a: Array = pts[k]
			var b: Array = pts[k + 1]
			var climb := (a.size() > 3 and int(a[3]) == 1) or (b.size() > 3 and int(b[3]) == 1)
			var pa := Vector2(float(a[0]), float(a[2]))
			var pb := Vector2(float(b[0]), float(b[2]))
			var L := pa.distance_to(pb)
			var steps := maxi(1, int(L / 3.0))
			for s in steps:
				var q0 := pa.lerp(pb, float(s) / steps)
				var q1 := pa.lerp(pb, float(s + 1) / steps)
				var d := q0.distance_to(q1)
				if d < 0.5:
					continue
				var g := rad_to_deg(atan(absf(TerrainData.get_height(q1.x, q1.y) - TerrainData.get_height(q0.x, q0.y)) / d))
				total += 1
				if climb:
					climb_worst = maxf(climb_worst, g)
					continue
				if g > worst:
					worst = g
					worst_at = q0
				if g > 35.0:
					over += 1
		for pid in POI_IDS:
			var pp: Vector3 = TerrainData.get_poi(pid)["position"]
			for e in [pts.front(), pts.back()]:
				if Vector2(float(e[0]), float(e[2])).distance_to(Vector2(pp.x, pp.z)) < 40.0:
					reached[pid] = true
		check(over == 0, "trail %s walkable: worst grade %.1f deg at %s (%d/%d steps > 35), climb legs max %.1f" % [
			tr["id"], worst, str(worst_at), over, total, climb_worst])
	for pid2 in [&"crash_site", &"ranger_cabin", &"ashford_mine", &"owens_bivouac", &"glacier_camp", &"kestrel_station",
			&"summit"]:
		check(reached.has(pid2), "golden trails reach %s" % pid2)
	check(golden_ids.size() >= 4, "golden trails present (%d)" % golden_ids.size())


func _water() -> void:
	var lake: Dictionary = TerrainData.get_poi(&"loon_lake")
	var lp: Vector3 = lake["position"]
	var lvl := TerrainData.get_water_level(lp.x, lp.z)
	check(absf(lvl - 1420.0) < 0.01, "Loon Lake level 1,420 m (%.2f)" % lvl)
	check(TerrainData.get_height(lp.x, lp.z) < lvl - 3.0, "lake bed well below the surface")
	check(TerrainData.is_in_water(Vector3(lp.x, lvl - 1.0, lp.z)), "is_in_water below the lake surface")
	check(not TerrainData.is_in_water(Vector3(lp.x, lvl + 1.0, lp.z)), "not in water above it")
	var c: Vector3 = TerrainData.get_poi(&"crash_site")["position"]
	check(TerrainData.get_water_level(c.x, c.z) == -INF, "no water at the crash site")
	check(TerrainData.get_water_level(5000.0, 0.0) == -INF, "no water outside the map")
	# every lake: shore ring above its level (no leaks), bed below
	for lk in TerrainData.get_lakes():
		var poly: Array = lk.get("polygon", [])
		if poly.size() < 3:
			continue
		var leaks := 0
		var cen := Vector2(float(lk["x"]), float(lk["z"]))
		for p in poly:
			var v := Vector2(float(p[0]), float(p[1]))
			var outp := v + (v - cen).normalized() * 6.0
			if TerrainData.get_height(outp.x, outp.y) < float(lk["level"]) - 0.05:
				leaks += 1
		check(leaks == 0, "lake %s shore holds its water (%d low points)" % [lk["id"], leaks])
	# rivers: surface heights decrease downstream and match get_water_level on the centreline
	for rv in TerrainData.get_rivers():
		var pts: Array = rv.get("points", [])
		var mono := true
		var match_ok := 0
		var n := 0
		var dry := 0
		for k in pts.size():
			var p: Array = pts[k]
			if k > 0 and float(p[1]) > float(pts[k - 1][1]) + 0.05:
				mono = false
			if k % 7 == 3:
				n += 1
				var wl := TerrainData.get_water_level(float(p[0]), float(p[2]))
				if absf(wl - float(p[1])) < 0.6:
					match_ok += 1
				if TerrainData.get_height(float(p[0]), float(p[2])) > float(p[1]) + 0.05:
					dry += 1
		check(mono, "river %s flows downhill" % rv["id"])
		check(n == 0 or match_ok >= n * 0.9, "river %s water level on its centreline (%d/%d)" % [rv["id"], match_ok, n])
		check(n == 0 or dry <= maxi(1, n / 20), "river %s bed below its surface (%d/%d dry)" % [rv["id"], dry, n])


func _raycast() -> void:
	var s: Vector3 = TerrainData.get_poi(&"summit")["position"]
	var r := TerrainData.raycast(s + Vector3(0, 200, 0), Vector3.DOWN, 500.0)
	check(bool(r.get("hit", false)) and absf((r["position"] as Vector3).y - TerrainData.get_height(s.x, s.z)) < 0.2,
		"raycast down onto the summit")
	var r2 := TerrainData.raycast(s + Vector3(0, 5, 0), Vector3.UP, 1000.0)
	check(not bool(r2.get("hit", false)), "raycast upward from the summit misses")
	# from the lake shore toward the north wall: hits the mountain
	var c: Vector3 = TerrainData.get_poi(&"ranger_cabin")["position"]
	var o := Vector3(c.x, TerrainData.get_height(c.x, c.z) + 2.0, c.z)
	var r3 := TerrainData.raycast(o, Vector3(0, 0.25, -1).normalized(), 4000.0)
	check(bool(r3.get("hit", false)), "raycast toward the north wall hits the mountain")
	if bool(r3.get("hit", false)):
		var hp: Vector3 = r3["position"]
		check(absf(hp.y - TerrainData.get_height(hp.x, hp.z)) < 0.3, "hit point lies on the surface")
		# nothing between: sample the segment
		var clear := true
		for k in range(1, 40):
			var q := o.lerp(hp, float(k) / 41.0)
			if q.y < TerrainData.get_height(q.x, q.z) - 0.3:
				clear = false
		check(clear, "raycast returns the first hit")
	var r4 := TerrainData.raycast(Vector3(0, 5000, 0), Vector3(1, -0.2, 0.3), 100.0)
	check(not bool(r4.get("hit", false)), "short ray in the sky misses")


func _surfaces() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	var seen := {}
	var all_valid := true
	for _k in 3000:
		var x := rng.randf_range(-1500, 1500)
		var z := rng.randf_range(-1500, 1500)
		var s := TerrainData.get_surface(x, z)
		if not SURFACES.has(s):
			all_valid = false
		seen[s] = int(seen.get(s, 0)) + 1
		if not BIOMES.has(TerrainData.get_biome(x, z)):
			all_valid = false
	print("surface distribution: ", seen)
	check(all_valid, "get_surface / get_biome return contract values")
	for want in [&"snow", &"rock", &"forest", &"grass", &"scree"]:
		check(seen.has(want), "surface %s occurs" % want)
	var s2: Vector3 = TerrainData.get_poi(&"summit")["position"]
	check(TerrainData.get_biome(s2.x, s2.z) == &"summit", "summit biome at the summit")
	var c: Vector3 = TerrainData.get_poi(&"crash_site")["position"]
	check(TerrainData.get_biome(c.x, c.z) == &"valley", "valley biome at the crash site")
	check(TerrainData.get_biome(-40.0, -740.0) == &"glacier", "glacier biome on the icefall")
	check(TerrainData.get_surface(-40.0, -740.0) in [&"ice", &"snow"], "ice/snow surface on the glacier")
	var st: Vector3 = TerrainData.get_poi(&"kestrel_station")["position"]
	check(TerrainData.get_biome(st.x, st.z) == &"alpine", "alpine biome at Kestrel Station")
	check(TerrainData.get_surface(st.x, st.z) in [&"snow", &"gravel", &"scree", &"rock"], "station pad surface")


func _globals() -> void:
	var names := RenderingServer.global_shader_parameter_get_list()
	for g in [&"terrain_height_tex", &"terrain_normal_tex", &"terrain_mask_tex", &"terrain_mask2_tex", &"terrain_params",
			&"terrain_shadow_tex", &"terrain_shadow_params"]:
		check(g in names, "global shader parameter %s declared" % g)


func _speed() -> void:
	var t0 := Time.get_ticks_usec()
	var acc := 0.0
	for k in 20000:
		acc += TerrainData.get_height(float(k % 3000) - 1500.0, float(k / 7 % 3000) - 1500.0)
	var t1 := Time.get_ticks_usec()
	var wet := 0
	for k in 5000:
		if TerrainData.get_water_level(float(k * 13 % 3000) - 1500.0, float(k * 7 % 3000) - 1500.0) > -INF:
			wet += 1
	var t2 := Time.get_ticks_usec()
	var us_h := float(t1 - t0) / 20000.0
	var us_w := float(t2 - t1) / 5000.0
	print("get_height %.2f us/call, get_water_level %.2f us/call (%d wet)" % [us_h, us_w, wet])
	check(us_h < 20.0, "get_height is fast (%.2f us)" % us_h)
	check(us_w < 60.0, "get_water_level is fast (%.2f us)" % us_w)
	check(acc != 0.0, "heights summed")

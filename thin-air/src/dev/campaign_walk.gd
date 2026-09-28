extends Node
## Dev QA harness: walks the golden-path trails of data/world_layout.json with the REAL Player controller on the
## REAL terrain collision (headless is fine: physics only). A simple steering bot holds move_forward toward a
## look-ahead point on the trail, taps jump when it stalls (step-ups, ice-axe climb grabs) and skips ahead when
## it is stuck for good, reporting every stall/skip/fall. Vitals are topped up (this checks geometry, not survival).
## Usage:
##   timeout 1800 godot --headless --path thin-air res://scenes/dev/campaign_walk.tscn -- \
##     --legs=valley_trail,ashford_road,burke_route,glacier_route,summit_ridge,summit_ridge:rev [--timescale=12]
##     [--gear=0] (no ice axe / crampons)  [--from=i] (start index on the first leg)  [--verbose]
## Prints "LEG <id> OK|FAIL ..." per leg and "WALK RESULT PASS|FAIL".

const STUCK_SKIP_S := 40.0
const LOOKAHEAD := 3.5

var args := {}
var world: Node3D
var player: Player
var _results: Array[String] = []
var _fail := false
var _falls: Array[String] = []


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var s := String(a).trim_prefix("--")
		var kv := s.split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var W: GDScript = load("res://src/world/world.gd")
	W.set(&"dev_no_player", false)
	Game.is_new_game = false
	Game.flags.clear()
	Climate.hours = 11.0
	Climate.set_weather(&"clear", 0.0)
	Climate.locked = true
	world = (load("res://scenes/world/world.tscn") as PackedScene).instantiate() as Node3D
	add_child(world)
	_run.call_deferred()


func _run() -> void:
	for _i in 10:
		await get_tree().physics_frame
	player = Game.player as Player
	if player == null:
		print("WALK RESULT FAIL (no player)")
		get_tree().quit(1)
		return
	Events.player_damaged.connect(func(amount: float, type: StringName, _src: Node) -> void:
		if type == &"fall":
			_falls.append("%.0f dmg at %s" % [amount, _fmt(player.global_position)]))
	# --gear=0 bare (acts 1-3), --gear=axe (Owen's ice axe, no crampons yet), default: axe + crampons + warm kit
	if args.get("gear", "1") != "0":
		var kit: Array[StringName] = [&"ice_axe"]
		if args.get("gear", "1") != "axe":
			kit.append_array([&"crampons", &"parka", &"wool_hat", &"insulated_pants"] as Array[StringName])
		for id: StringName in kit:
			player.inventory.add(id, 1)
			if id != &"ice_axe":
				player.equip(id)
	var ts := float(args.get("timescale", "12"))
	Engine.max_physics_steps_per_frame = int(ceil(ts)) + 2
	Engine.time_scale = ts
	var legs := String(args.get("legs", "valley_trail,ashford_road,burke_route,glacier_route,summit_ridge")).split(",")
	var first := true
	for leg in legs:
		var rev := leg.ends_with(":rev")
		var id := leg.trim_suffix(":rev")
		await _walk(id, rev, int(args.get("from", "0")) if first else 0)
		first = false
	Engine.time_scale = 1.0
	for r in _results:
		print(r)
	print("WALK RESULT %s" % ("FAIL" if _fail else "PASS"))
	get_tree().quit(1 if _fail else 0)


func _trail(id: String) -> Array:
	for t in TerrainData.layout.get("trails", []):
		if String(t.get("id", "")) == id:
			return t.get("points", [])
	return []


static func _fmt(p: Vector3) -> String:
	return "(%.0f, %.0f, %.0f)" % [p.x, p.y, p.z]


func _walk(id: String, rev: bool, from: int) -> void:
	var pts := _trail(id)
	if pts.is_empty():
		_results.append("LEG %s FAIL no such trail" % id)
		_fail = true
		return
	if rev:
		pts = pts.duplicate()
		pts.reverse()
	var P: Array[Vector3] = []
	var climb: Array[bool] = []
	for p in pts:
		P.append(Vector3(float(p[0]), float(p[1]), float(p[2])))
		climb.append(int(p[3]) != 0 if (p as Array).size() > 3 else false)
	if args.has("plan"):
		var planned := _plan(P, climb, args.get("gear", "1") != "0", tag_of(id, rev))
		if planned.is_empty():
			_fail = true
			return
		P = planned[0]
		climb = planned[1]
	var idx := clampi(from, 0, P.size() - 1)
	if from == 0:
		# the trail starts at the POI anchor (often inside a building): start at the pad's edge
		while idx < P.size() - 1 and Vector2(P[idx].x - P[0].x, P[idx].z - P[0].z).length() < 10.0:
			idx += 1
	var start := P[idx]
	start.y = TerrainData.get_height(start.x, start.z) + 0.3
	player.teleport(start, 0.0)
	player.velocity = Vector3.ZERO
	for _i in 3:
		await get_tree().physics_frame
	_falls.clear()
	var t := 0.0
	var best := idx
	var best_t := 0.0
	var stall_t := 0.0
	var skips: Array[String] = []
	var climbs := 0
	var slides := 0.0
	var was_climbing := false
	var last_pos := player.global_position
	var verbose := args.has("verbose")
	var log_t := 0.0
	var tag := "%s%s" % [id, ":rev" if rev else ""]
	var to := int(args.get("to", "100000"))
	# the trail ends at the POI anchor, often inside a building: arriving on the destination's flat pad (at pad
	# height, not on a switchback below it) counts as arrived
	var end_p := P[P.size() - 1]
	var arrive_r := 7.0
	for poi in TerrainData.all_pois():
		var pp: Vector3 = poi["position"]
		if Vector2(pp.x - end_p.x, pp.z - end_p.z).length() < 12.0:
			arrive_r = maxf(arrive_r, minf(float(poi.get("flat_radius", 0.0)) * 0.8, 30.0))
	while idx < mini(P.size() - 1, to):
		await get_tree().physics_frame
		var dt := get_physics_process_delta_time()
		t += dt
		_top_up()
		if args.has("nan") and fmod(t, 2.0) < dt * 1.01:
			_scan_nan()
		var pos := player.global_position
		# sequential pure pursuit: aim at the next trail point, advance when (nearly) reached; a later point within
		# a short arc counts too if it is at the same height (never jump across a switchback to the next leg)
		for j in range(idx + 1, mini(idx + 5, P.size())):
			if Vector2(P[j].x - pos.x, P[j].z - pos.z).length() < 1.7 and absf(P[j].y - pos.y) < 1.6:
				idx = j
		if idx > best:
			best = idx
			best_t = t
		var tgt := P[mini(idx + 1, P.size() - 1)]
		var d_end := Vector2(end_p.x - pos.x, end_p.z - pos.z).length()
		if (idx >= P.size() - 4 and d_end < 7.0) or (d_end < arrive_r and absf(pos.y - end_p.y) < 2.5):
			break
		var dx := tgt.x - pos.x
		var dz := tgt.z - pos.z
		var climbing := player.move_state == Player.Move.CLIMB
		var pitch := 0.0
		if climbing:
			pitch = 35.0
		player.set_look(rad_to_deg(atan2(-dx, -dz)), pitch)
		Input.action_press(&"move_forward")
		if climbing and not was_climbing:
			climbs += 1
		was_climbing = climbing
		if player.is_sliding:
			slides += dt
		# stalled: no horizontal/vertical progress
		var moved := pos.distance_to(last_pos)
		last_pos = pos
		if moved < 0.4 * dt:
			stall_t += dt
		else:
			stall_t = maxf(stall_t - dt * 0.5, 0.0)
		if (stall_t > 0.6 or climb[mini(idx + 1, P.size() - 1)]) and not climbing and fmod(t, 0.5) < dt * 1.01:
			Input.action_press(&"jump")
		else:
			Input.action_release(&"jump")
		if args.has("trace") and t < float(args["trace"]) and fmod(t, 0.25) < dt * 1.01:
			print("  t=%.2f idx %d pos (%.2f, %.2f, %.2f) v (%.2f, %.2f, %.2f) floor %s wall %s slide %s n %s surf %s state %d tgt (%.1f,%.1f)" % [
				t, idx, pos.x, pos.y, pos.z, player.velocity.x, player.velocity.y, player.velocity.z, player.is_on_floor(),
				player.is_on_wall(), player.is_sliding, str(player.get(&"_floor_normal")), player.current_surface, player.move_state, tgt.x, tgt.z])
		if verbose:
			log_t += dt
			if log_t > 20.0:
				log_t = 0.0
				print("  %s t=%.0fs idx %d/%d pos %s state %d slide %s" % [tag, t, idx, P.size(), _fmt(pos), player.move_state, player.is_sliding])
		# fallen far below the trail (slid off / fell)
		var below := P[idx].y - pos.y
		if t - best_t > STUCK_SKIP_S or below > 25.0:
			var why := "stuck" if below <= 25.0 else "fell %.0f m below" % below
			skips.append("%s at idx %d %s (trail y %.0f, slope %.0f°, surface %s)" % [why, idx, _fmt(pos), P[idx].y,
				TerrainData.get_slope_deg(pos.x, pos.z), TerrainData.get_surface(pos.x, pos.z)])
			var k := mini(idx + 12, P.size() - 1)
			var np := P[k]
			np.y = TerrainData.get_height(np.x, np.z) + 0.3
			Input.action_release(&"move_forward")
			player.teleport(np, 0.0)
			player.velocity = Vector3.ZERO
			idx = k
			best = k
			best_t = t
			stall_t = 0.0
			for _i in 3:
				await get_tree().physics_frame
			last_pos = player.global_position
			if skips.size() > 40:
				break
	Input.action_release(&"move_forward")
	Input.action_release(&"jump")
	var ok := skips.is_empty()
	if not ok:
		_fail = true
	var line := "LEG %s %s: %.0f s game time, %d/%d pts, climbs %d, sliding %.0f s, falls %d%s" % [tag,
		"OK" if ok else "FAIL", t, idx + 1, P.size(), climbs, slides, _falls.size(),
		"" if _falls.is_empty() else " " + str(_falls)]
	for s in skips:
		line += "\n    - " + s
	_results.append(line)
	print(line)


func _top_up() -> void:
	var v := player.vitals
	v.health = v.max_health
	v.stamina = 100.0
	v.warmth = 100.0
	v.oxygen = 100.0
	v.food = 100.0
	v.water = 100.0


func _scan_nan() -> void:
	for n in get_tree().root.find_children("*", "Node3D", true, false):
		var x := (n as Node3D).global_transform
		if not (x.origin.is_finite() and x.basis.x.is_finite() and x.basis.y.is_finite() and x.basis.z.is_finite()):
			print("NaN transform: ", n.get_path(), " ", (n as Node3D).transform)
			return


static func tag_of(id: String, rev: bool) -> String:
	return "%s%s" % [id, ":rev" if rev else ""]


## Grid path over the heightfield (1.5 m cells, AStarGrid2D) through cells the player can walk on (every triangle
## of the cell under the surface's slide limit), or climb (trail points flagged climb, with gear). Cheaper near the
## trail, so the path follows it where it can. Returns [points, climb flags] or [] (and reports) when cut.
func _plan(P: Array[Vector3], climb: Array[bool], gear: bool, tag: String) -> Array:
	var N := TerrainData.SIZE
	var C := TerrainData.CELL
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for p in P:
		lo = lo.min(Vector2(p.x, p.z))
		hi = hi.max(Vector2(p.x, p.z))
	var pad := float(args.get("pad", "60"))
	var margin := float(args.get("margin", "2"))
	var i0 := clampi(int((lo.x - pad + TerrainData.HALF) / C), 0, N - 2)
	var j0 := clampi(int((lo.y - pad + TerrainData.HALF) / C), 0, N - 2)
	var i1 := clampi(int((hi.x + pad + TerrainData.HALF) / C), 0, N - 2)
	var j1 := clampi(int((hi.y + pad + TerrainData.HALF) / C), 0, N - 2)
	var w := i1 - i0 + 1
	var h := j1 - j0 + 1
	var near := PackedByteArray()
	near.resize(w * h)
	for k in P.size():
		var a := P[k]
		var b := P[mini(k + 1, P.size() - 1)]
		var n := maxi(1, int(Vector2(b.x - a.x, b.z - a.z).length() / 0.75))
		for q in n + 1:
			var m := a.lerp(b, float(q) / n)
			var ci := int((m.x + TerrainData.HALF) / C) - i0
			var cj := int((m.z + TerrainData.HALF) / C) - j0
			for dj in range(-2, 3):
				for di in range(-2, 3):
					var x := ci + di
					var y := cj + dj
					if x >= 0 and y >= 0 and x < w and y < h:
						near[y * w + x] = maxi(near[y * w + x], 2 if (climb[k] and gear) else 1)
	var ag := AStarGrid2D.new()
	ag.region = Rect2i(0, 0, w, h)
	ag.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES
	ag.update()
	var H := TerrainData.heights
	var solid := 0
	for y in h:
		for x in w:
			var gi := i0 + x
			var gj := j0 + y
			var h00 := H[gj * N + gi]
			var h10 := H[gj * N + gi + 1]
			var h01 := H[(gj + 1) * N + gi]
			var h11 := H[(gj + 1) * N + gi + 1]
			# steepest triangle for either diagonal split: gradients of the 4 corner triangles
			# (the cell's split is unknown here: take the kinder of the two diagonal splits unless --strict)
			var ga := maxf(Vector2(h10 - h00, h01 - h00).length(), Vector2(h11 - h01, h11 - h10).length())
			var gb := maxf(Vector2(h10 - h00, h11 - h10).length(), Vector2(h11 - h01, h01 - h00).length())
			var g := maxf(ga, gb) if args.has("strict") else minf(ga, gb)
			var slope := rad_to_deg(atan(g / C))
			var wx := -TerrainData.HALF + (gi + 0.5) * C
			var wz := -TerrainData.HALF + (gj + 0.5) * C
			var surf := TerrainData.get_surface(wx, wz)
			var limit := PlayerMotion.surface_slide_limit_deg(surf, gear) - margin
			var nr := near[y * w + x]
			if slope > limit and nr != 2:
				ag.set_point_solid(Vector2i(x, y), true)
				solid += 1
				continue
			var wt := 1.0 + slope / 30.0 + (0.0 if nr > 0 else 1.5)
			if TerrainData.get_water_level(wx, wz) > (h00 + h11) * 0.5 + 0.6:
				wt += 6.0
			ag.set_point_weight_scale(Vector2i(x, y), wt)
	var s0 := Vector2i(int((P[0].x + TerrainData.HALF) / C) - i0, int((P[0].z + TerrainData.HALF) / C) - j0)
	var s1 := Vector2i(int((P[P.size() - 1].x + TerrainData.HALF) / C) - i0, int((P[P.size() - 1].z + TerrainData.HALF) / C) - j0)
	# anchors sit on POI pads (buildings): search the nearest free cell
	for pair in [[s0, 0], [s1, 1]]:
		var c: Vector2i = pair[0]
		if ag.is_point_solid(c):
			for r in range(1, 12):
				var found := false
				for dy in range(-r, r + 1):
					for dx in range(-r, r + 1):
						var c2 := c + Vector2i(dx, dy)
						if ag.region.has_point(c2) and not ag.is_point_solid(c2) and not found:
							c = c2
							found = true
				if found:
					break
		if int(pair[1]) == 0:
			s0 = c
		else:
			s1 = c
	var path := ag.get_id_path(s0, s1, true)
	if path.is_empty() or path[path.size() - 1] != s1:
		var last: Vector2i = path[path.size() - 1] if not path.is_empty() else s0
		var lw := Vector3(-TerrainData.HALF + (i0 + last.x + 0.5) * C, 0.0, -TerrainData.HALF + (j0 + last.y + 0.5) * C)
		lw.y = TerrainData.get_height(lw.x, lw.z)
		var bk := 0
		var bd := INF
		for k in P.size():
			var d := Vector2(P[k].x - lw.x, P[k].z - lw.z).length()
			if d < bd:
				bd = d
				bk = k
		var line := "LEG %s FAIL (plan): no walkable path; the walkable region ends at %s, %.0f m from trail idx %d/%d (%s)" % [
			tag, _fmt(lw), bd, bk, P.size(), _fmt(P[bk])]
		_results.append(line)
		print(line)
		return []
	var out: Array[Vector3] = []
	var cl: Array[bool] = []
	for k in range(0, path.size(), 2):
		var c: Vector2i = path[k]
		var wp := Vector3(-TerrainData.HALF + (i0 + c.x + 0.5) * C, 0.0, -TerrainData.HALF + (j0 + c.y + 0.5) * C)
		wp.y = TerrainData.get_height(wp.x, wp.z)
		out.append(wp)
		cl.append(near[c.y * w + c.x] == 2)
	print("PLAN %s: %d cells (%d solid), path %d waypoints" % [tag, w * h, solid, out.size()])
	return [out, cl]

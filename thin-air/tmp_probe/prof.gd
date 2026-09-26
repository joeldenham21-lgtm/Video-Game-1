extends Node
func _ready():
	var R := "/tmp/claude-0/-home-user-Video-Game-1/246debe6-7c87-536a-91a2-75e612e8ac3d/scratchpad/veg/realterrain/"
	var td: Node = (load(R + "terrain_data_real.gd") as GDScript).new()
	add_child(td)
	var ctx := VegScatter.make_context(VegLibrary.get_shared(), td, 1.0)
	var t0 := Time.get_ticks_usec()
	var n := 0
	for cz in range(26, 34):
		for cx in range(14, 22):
			n += VegScatter.generate_cell(ctx, cx, cz).size()
	var dt := (Time.get_ticks_usec() - t0) / 1000.0
	print("64 cells: %.0f ms (%.1f ms/cell), %d inst" % [dt, dt / 64.0, n])
	var N := 20000
	var ts := {}
	var t1 := Time.get_ticks_usec()
	for i in N: td.get_masks(-500.0 + i * 0.01, 800.0)
	ts["masks"] = Time.get_ticks_usec() - t1
	t1 = Time.get_ticks_usec()
	for i in N: td.get_height(-500.0 + i * 0.01, 800.0)
	ts["height"] = Time.get_ticks_usec() - t1
	t1 = Time.get_ticks_usec()
	for i in N: td.get_slope_deg(-500.0 + i * 0.01, 800.0)
	ts["slope"] = Time.get_ticks_usec() - t1
	t1 = Time.get_ticks_usec()
	for i in N: td.get_surface(-500.0 + i * 0.01, 800.0)
	ts["surface"] = Time.get_ticks_usec() - t1
	t1 = Time.get_ticks_usec()
	for i in N: td.get_water_level(-500.0 + i * 0.01, 800.0)
	ts["water"] = Time.get_ticks_usec() - t1
	t1 = Time.get_ticks_usec()
	for i in N: VegScatter.noise2(-500.0 + i * 0.01, 800.0, 38.0, 3)
	ts["noise2"] = Time.get_ticks_usec() - t1
	t1 = Time.get_ticks_usec()
	for i in N: VegScatter.excluded(ctx, -500.0 + i * 0.01, 800.0, 4.0)
	ts["excluded"] = Time.get_ticks_usec() - t1
	for k in ts:
		print("  %s: %.2f us/call" % [k, float(ts[k]) / N])
	get_tree().quit()

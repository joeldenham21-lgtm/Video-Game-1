extends Node
func _ready():
	var R := "/tmp/claude-0/-home-user-Video-Game-1/246debe6-7c87-536a-91a2-75e612e8ac3d/scratchpad/veg/realterrain/"
	var td: Node = (load(R + "terrain_data_real.gd") as GDScript).new()
	add_child(td)
	print("loaded=", td.is_loaded(), " layout pois=", td.layout.get("pois", []).size())
	var t0 := Time.get_ticks_msec()
	var veg: Node = (load("res://scenes/world/vegetation.tscn") as PackedScene).instantiate()
	veg.set("terrain_override", td)
	veg.set("sync_all", true)
	add_child(veg)
	print("total gen ms=", Time.get_ticks_msec() - t0, " instances=", veg.instance_count())
	var lib := VegLibrary.get_shared()
	var cats := {}
	var sp_alt := {}
	var bad_trail := 0
	var bad_pad := 0
	var bad_water := 0
	var n_tree := 0
	for cd in veg.cells:
		if cd == null:
			continue
		for i in cd.size():
			var c := int(cd.cats[i])
			cats[c] = cats.get(c, 0) + 1
			if c != 0:
				continue
			n_tree += 1
			var p: Vector3 = cd.pos[i]
			var band := int(p.y / 150.0) * 150
			var sp := String(lib.info(lib.kind_names[cd.kinds[i]]).get("species", ""))
			if not sp_alt.has(band):
				sp_alt[band] = {}
			sp_alt[band][sp] = sp_alt[band].get(sp, 0) + 1
			if td.get_trail_at(p.x, p.z):
				bad_trail += 1
			if td.get_water_level(p.x, p.z) > td.get_height(p.x, p.z) - 0.2:
				bad_water += 1
			for poi in td.layout.get("pois", []):
				if Vector2(p.x - float(poi["x"]), p.z - float(poi["z"])).length() < float(poi.get("flat_radius", 0.0)):
					bad_pad += 1
	print("cats=", cats, " trees=", n_tree, " on_trail=", bad_trail, " in_water=", bad_water, " on_pad=", bad_pad)
	var keys := sp_alt.keys()
	keys.sort()
	for k in keys:
		print("  alt ", k, ": ", sp_alt[k])
	get_tree().quit()

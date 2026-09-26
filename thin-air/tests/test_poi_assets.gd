extends TestCase
## Story-location scenes (scenes/poi/*.tscn, built by tools/blender/poi/build.py): every scene loads with a
## PoiSite root, has surface-tagged world collision, the gameplay sockets the story needs, Log_* sockets that name
## real logs, triangle budgets (exterior <= 120k, interior <= 150k at LOD0), a bounded number of surfaces (draw
## calls), <= 4 real-time lights near any light, visibility ranges on the merged meshes, and placement in the world.

const EXTERIOR_TRIS := 120000
const INTERIOR_TRIS := 150000
const MAX_SURFACES := 72
const SURFACES := ["wood", "metal", "rock", "snow", "ice", "gravel", "scree", "dirt", "grass", "forest", "water"]

const REQUIRED := {
	&"crash_site": ["Arrive_Wake", "Arrive_Default", "Use_Radio", "Log_dale_logbook", "Loot_FirstAid", "Loot_FlareGun",
		"Loot_SurvivalManual", "Loot_EmergencyBlanket", "Loot_Hatchet", "Loot_Backpack", "Loot_Scanner", "Spot_Dale"],
	&"kestrel_station": ["Arrive_Default", "Arrive_Heli", "Use_Generator", "Use_Radio", "Use_O2Concentrator", "Use_Door_Main",
		"Npc_Mara", "Loot_TransceiverModule", "Loot_BatteryPack", "Spot_Fabricator", "Log_hale_01", "Log_reyes_01",
		"Log_park_01", "Log_voss_01", "Log_hale_02", "Log_voss_02", "Log_reyes_02", "Log_station_whiteboard",
		"Log_station_fuel_log", "Log_relay_diagnostics"],
	&"ranger_cabin": ["Arrive_Default", "Use_Radio", "Use_Stove", "Use_Door_Cabin", "Use_Bed", "Loot_RadioHandheld",
		"Loot_Bow", "Log_ranger_logbook", "Log_ranger_note"],
	&"ashford_mine": ["Arrive_Default", "Arrive_FromMine", "Use_Door_Mine", "Log_miner_diary_1"],
	&"ashford_mine_interior": ["Arrive_FromPortal", "Use_Door_Exit", "Log_burke_01", "Log_miner_diary_2",
		"Log_miner_diary_3", "Log_burke_note", "Spot_Owen", "Loot_IceAxe", "Loot_Crampons", "Loot_ClimbingRope",
		"Loot_FuelCan_1"],
	&"summit_relay": ["Arrive_Default", "Use_Relay", "Use_BatteryBox", "Spot_HaleBody", "Log_hale_03", "Log_hale_notebook"],
	&"owens_bivouac": ["Arrive_Default", "Log_burke_02"],
	&"glacier_camp": ["Arrive_Default"],
	&"fire_lookout": ["Arrive_Default", "Use_FireFinder"],
	&"trapper_cabin": ["Arrive_Default"],
	&"ice_cave": ["Arrive_FromEntrance", "Use_Door_Exit", "Log_park_02"],
	&"ice_cave_entrance": ["Arrive_Default", "Use_Door_IceCave", "Log_park_03"],
}


func run() -> void:
	var logs := {}
	var lf := FileAccess.get_file_as_string("res://data/logs.json")
	var lv: Variant = JSON.parse_string(lf)
	if lv is Dictionary:
		logs = lv
	var S = load("res://scenes/poi/structures.gd")
	check(S != null, "structures.gd loads")
	for id: StringName in REQUIRED:
		var path := "res://scenes/poi/%s.tscn" % id
		var ps := load(path) as PackedScene
		check(ps != null, "%s loads" % path)
		if ps == null:
			continue
		var root := ps.instantiate() as Node3D
		check(root is PoiSite, "%s root is PoiSite" % id)
		if not (root is PoiSite):
			root.free()
			continue
		var site := root as PoiSite
		check(site.poi_id != &"", "%s has poi_id" % id)
		_check_collision(site, id)
		_check_sockets(site, id, logs)
		_check_meshes(site, id)
		_check_lights(site, id)
		# lights switch without errors (emissive materials duplicated per site)
		add_child(site)
		site.set_interior_lights(true)
		var li := site.get_node_or_null(^"Lights_Interior") as Node3D
		check(li == null or li.visible, "%s interior lights switch on" % id)
		site.set_interior_lights(false)
		var st := site.save_state()
		check(st.has("lights") and site.get_save_key().begins_with("poi_"), "%s persistence API" % id)
		site.queue_free()
		# world placement
		if TerrainData.is_loaded() and S.SITES.has(id):
			var xf: Transform3D = S.placement(id)
			check(xf != Transform3D.IDENTITY, "%s has a world placement" % id)
			if not site.interior:
				check(absf(xf.origin.y - TerrainData.get_height(xf.origin.x, xf.origin.z)) < 0.01,
					"%s sits on the terrain" % id)
			else:
				check(xf.origin.y < TerrainData.min_height - 100.0, "%s interior is below the terrain" % id)
	await get_tree().process_frame


func _check_collision(site: Node3D, id: StringName) -> void:
	var bodies := site.find_children("*", "StaticBody3D", true, false)
	var shapes := 0
	var ok_surface := true
	var ok_layer := true
	for b: StaticBody3D in bodies:
		if not b.has_meta(&"surface") or not SURFACES.has(String(b.get_meta(&"surface"))):
			ok_surface = false
		if b.collision_layer & 1 == 0:
			ok_layer = false
		for c in b.get_children():
			if c is CollisionShape3D and (c as CollisionShape3D).shape != null:
				shapes += 1
	check(bodies.size() > 0 and shapes >= 3, "%s has world collision (%d bodies, %d shapes)" % [id, bodies.size(), shapes])
	check(ok_surface, "%s collision bodies carry a footstep surface meta" % id)
	check(ok_layer, "%s collision on layer 1 (world)" % id)


func _check_sockets(site: PoiSite, id: StringName, logs: Dictionary) -> void:
	var names := {}
	for m in site.get_sockets(""):
		names[String(m.name)] = true
	var missing: Array[String] = []
	for r: String in REQUIRED[id]:
		if not names.has(r):
			missing.append(r)
	check(missing.is_empty(), "%s required sockets present %s" % [id, missing])
	var bad: Array[String] = []
	for n: String in names:
		if n.begins_with("Log_"):
			var m := site.get_socket(n)
			if not m.has_meta(&"log_id") or not logs.has(String(m.get_meta(&"log_id"))):
				bad.append(n)
		if not (n.begins_with("Log_") or n.begins_with("Loot_") or n.begins_with("Use_") or n.begins_with("Arrive_")
				or n.begins_with("Spot_") or n.begins_with("Npc_") or n.begins_with("Scan_")):
			bad.append(n)
	check(bad.is_empty(), "%s socket names follow the conventions / name real logs %s" % [id, bad])
	check(site.get_sockets("Arrive_").size() >= 1, "%s has an arrival point" % id)


func _check_meshes(site: PoiSite, id: StringName) -> void:
	var tris := 0
	var surfaces := 0
	var ranged := true
	var mats_ok := true
	for mi: MeshInstance3D in site.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			surfaces += 1
			var arr := mi.mesh.surface_get_arrays(i)
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			tris += idx.size() / 3 if idx.size() > 0 else (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size() / 3
			if mi.mesh.surface_get_material(i) == null:
				mats_ok = false
		if not site.interior and mi.name != &"main" and mi.visibility_range_end <= 0.0:
			ranged = false
	var budget := INTERIOR_TRIS if site.interior else EXTERIOR_TRIS
	check(tris > 500 and tris <= budget, "%s LOD0 triangles %d <= %d" % [id, tris, budget])
	check(surfaces <= MAX_SURFACES, "%s surfaces (draw calls) %d <= %d" % [id, surfaces, MAX_SURFACES])
	check(mats_ok, "%s every surface has a library material" % id)
	check(ranged, "%s detail meshes have visibility ranges" % id)


func _check_lights(site: Node3D, id: StringName) -> void:
	var lights := site.find_children("*", "Light3D", true, false)
	var worst := 0
	for a: Light3D in lights:
		var n := 0
		for b: Light3D in lights:
			if a.position.distance_to(b.position) < 7.0:
				n += 1
		worst = maxi(worst, n)
	check(worst <= 4, "%s <= 4 real-time lights per interior (worst cluster %d)" % [id, worst])

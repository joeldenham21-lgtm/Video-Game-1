extends Node3D
## World part "Structures" (src/world/world.gd PARTS -> scenes/poi/structures.tscn): instances every story
## location scene (scenes/poi/<id>.tscn, root PoiSite) at its anchor from data/world_layout.json via TerrainData:
## exteriors at the POI's flat pad (ground height at the anchor) with the yaw below; interiors (mine tunnels, ice
## cave) far below the terrain at INTERIOR_Y under their POI, entered through the Use_Door_* sockets of the
## exterior; entrances at the layout's portal point. Scenes that don't exist yet are skipped.
##
## Story stream additions (populate()):
##  * loot at the Loot_* sockets from data/loot.json (src/story/loot_tables.gd): frozen ItemPickups with stable
##    persist_ids (ItemsRoot remembers what was collected); quest items at fixed spots, seeded random
##    consumables otherwise; entries gated by a Game flag (Owen's padlocked depot) appear when it is set;
##  * readable logs at the Log_* sockets (src/story/story_log.gd → Story.find_log);
##  * scanner targets at Scan_* sockets and data/story.json "scans" (blueprint unlocks);
##  * story interactables from data/story.json "uses" (src/story/story_use.gd → Story.use_socket);
##  * Kestrel Station: fabricator at Spot_Fabricator, heat slots per module, generator loop, Mara's corner
##    (props, lamp, positional voice), summit relay status lamp; the rescue helicopter.
##  * travel(): door transitions with a fade (PoiDoor calls it), reverb/music per interior, Story "enter_<site>".
## Public API: get_site, get_socket, placement (static), travel, interior_at, apply_use, set_station_power,
## set_relay_online, spawn_helicopter, apply_story_state, loot_nodes.

const INTERIOR_Y := 800.0
const PICKUP_SCENE := "res://scenes/items/pickup.tscn"
const FABRICATOR_SCENE := "res://scenes/items/fabricator.tscn"
const HEAT_SCRIPT := "res://scenes/poi/poi_heat.gd"
const LOG_SCRIPT := preload("res://src/story/story_log.gd")
const USE_SCRIPT := preload("res://src/story/story_use.gd")
const SCAN_SCRIPT := preload("res://src/story/story_scannable.gd")
const LOOT := preload("res://src/story/loot_tables.gd")
const HELI_SCRIPT := preload("res://src/story/rescue_helicopter.gd")

## scene id -> [layout poi id, yaw (deg, Godot), kind ("pad" | "interior" | "adit" | "entrance")]
const SITES := {
	&"crash_site": [&"crash_site", 0.0, "pad"],
	&"ranger_cabin": [&"ranger_cabin", -50.0, "pad"],
	&"fire_lookout": [&"fire_lookout", 0.0, "pad"],
	&"ashford_mine": [&"ashford_mine", 0.0, "pad"],
	&"ashford_mine_interior": [&"ashford_mine", 0.0, "interior"],
	&"trapper_cabin": [&"trapper_cabin", 0.0, "pad"],
	&"owens_bivouac": [&"owens_bivouac", 0.0, "pad"],
	&"glacier_camp": [&"glacier_camp", 0.0, "pad"],
	&"ice_cave_entrance": [&"ice_cave", 0.0, "entrance"],
	&"ice_cave": [&"ice_cave", 0.0, "interior"],
	&"kestrel_station": [&"kestrel_station", 0.0, "pad"],
	&"summit_relay": [&"summit", 0.0, "pad"],
}

## Heat slots added to sites that have none of their own: site -> [[local pos, radius, °C, when]]
## ("power" = on with the station generator, "stove" = lit from the Use_Stove interactable).
const EXTRA_HEAT := {
	&"kestrel_station": [[Vector3(0.0, 3.0, 0.0), 6.5, 16.0, "power"], [Vector3(-10.5, 3.0, 0.0), 6.0, 14.0, "power"],
		[Vector3(10.5, 3.0, -1.0), 6.0, 16.0, "power"], [Vector3(12.05, 2.9, 3.5), 2.2, 9.0, "always"]],
}

var sites: Dictionary = {}   # scene id -> PoiSite

## Dev/QA filter: when non-empty only these scene ids are instanced (src/dev/poi_test.gd).
static var only_ids: Array[StringName] = []
## Dev/QA: false = bare location scenes (no loot, logs, story interactables).
static var populate_story := true

var _pickup_scene: PackedScene
var _gated: Array[Dictionary] = []          # loot waiting for a flag: {site, entry, parent}
var _loot_nodes: Array[Node] = []
var _power_heat: Array[Node] = []
var _stove_heat: Dictionary = {}            # site -> Array[Node]
var _stove_until: Dictionary = {}           # site -> abs hours
var _gen_loop: AudioStreamPlayer3D
var _relay_lamp: OmniLight3D
var _relay_mat: StandardMaterial3D
var _relay_state := 0                        # 0 off, 1 searching (amber blink), 2 online (green)
var _mara_lamp: OmniLight3D
var _travelling := false
var _t := 0.0
var _slow_t := 0.0


func _ready() -> void:
	add_to_group(&"poi_structures")
	for id: StringName in SITES:
		if not only_ids.is_empty() and not only_ids.has(id):
			continue
		var path := "res://scenes/poi/%s.tscn" % id
		if not ResourceLoader.exists(path):
			continue
		var xf := placement(id)
		if xf == Transform3D.IDENTITY and not TerrainData.is_loaded():
			continue
		var ps := load(path) as PackedScene
		if ps == null:
			push_warning("Structures: cannot load %s" % path)
			continue
		var node := ps.instantiate() as Node3D
		node.name = String(id)
		add_child(node)
		node.global_transform = xf
		sites[id] = node
	if populate_story:
		_pickup_scene = load(PICKUP_SCENE) as PackedScene if ResourceLoader.exists(PICKUP_SCENE) else null
		for id: StringName in sites:
			populate(id, sites[id])
		if Story.has_signal(&"story_event"):
			Story.story_event.connect(_on_story_event)
		Events.game_loaded.connect(func(_s: int) -> void: apply_story_state.call_deferred())
		apply_story_state.call_deferred()


func get_site(id: StringName) -> Node3D:
	return sites.get(id)


## A socket (Marker3D) of a placed location, e.g. get_socket(&"ashford_mine_interior", &"Arrive_FromPortal").
func get_socket(id: StringName, socket: StringName) -> Marker3D:
	var s := sites.get(id) as Node3D
	if s == null:
		return null
	return s.get_node_or_null(NodePath("Sockets/" + String(socket))) as Marker3D


## World transform of a location scene's root (its local origin = the POI anchor on the ground).
static func placement(id: StringName) -> Transform3D:
	var spec: Array = SITES.get(id, [])
	if spec.is_empty():
		return Transform3D.IDENTITY
	var poi: Dictionary = TerrainData.get_poi(spec[0])
	if poi.is_empty():
		return Transform3D.IDENTITY
	var p: Vector3 = poi["position"]
	var kind: String = spec[2]
	if kind == "entrance" and poi.has("entrance"):
		var e: Dictionary = poi["entrance"]
		p = Vector3(float(e["x"]), 0.0, float(e["z"]))
	if kind == "interior":
		p.y = INTERIOR_Y
	else:
		p.y = TerrainData.get_height(p.x, p.z)
	return Transform3D(Basis(Vector3.UP, deg_to_rad(float(spec[1]))), p)


## The interior location the point is in (they sit ~1 km under their POI), or &"".
func interior_at(p: Vector3) -> StringName:
	if p.y > INTERIOR_Y + 300.0:
		return &""
	var best := &""
	var bd := INF
	for id: StringName in sites:
		if String(SITES[id][2]) != "interior":
			continue
		var o := (sites[id] as Node3D).global_position
		var d := Vector2(p.x - o.x, p.z - o.z).length()
		if d < bd and d < 250.0:
			bd = d
			best = id
	return best


# ============================================================================================ populate

func populate(id: StringName, site: Node3D) -> void:
	_place_loot(id, site)
	_place_logs(id, site)
	_place_uses(id, site)
	_place_scans(id, site)
	_place_extras(id, site)


func _socket_xf(site: Node3D, socket: String, at: Variant = null) -> Transform3D:
	if at is Array and (at as Array).size() >= 3:
		return site.global_transform * Transform3D(Basis(), Vector3(float(at[0]), float(at[1]), float(at[2])))
	var m := site.get_node_or_null(NodePath("Sockets/" + socket)) as Node3D
	return m.global_transform if m else Transform3D.IDENTITY


func _place_loot(id: StringName, site: Node3D) -> void:
	if _pickup_scene == null:
		return
	var holder := Node3D.new()
	holder.name = "StoryLoot"
	site.add_child(holder)
	for socket: String in LOOT.site_sockets(id):
		var m := site.get_node_or_null(NodePath("Sockets/" + socket)) as Node3D
		if m == null:
			push_warning("Structures: %s has no socket %s for loot" % [id, socket])
			continue
		for e in LOOT.roll(id, socket):
			e["xf"] = m.global_transform
			var flag := StringName(e.get("requires_flag", &""))
			if flag != &"" and not bool(Game.get_flag(flag, false)):
				_gated.append({"site": id, "entry": e, "parent": holder})
				continue
			_spawn_loot(e, holder)


func _spawn_loot(e: Dictionary, parent: Node3D) -> ItemPickup:
	if not ItemDB.has_item(StringName(e["item"])) or ItemsRoot.is_key_collected(String(e["persist_id"])):
		return null
	var p := _pickup_scene.instantiate() as ItemPickup
	p.item_id = StringName(e["item"])
	p.count = int(e["count"])
	p.persist_id = String(e["persist_id"])
	p.freeze = true
	p.name = String(e["persist_id"]).replace(":", "_")
	var xf: Transform3D = e["xf"]
	parent.add_child(p)
	p.global_transform = Transform3D(xf.basis.orthonormalized(), xf * (e["offset"] as Vector3))
	_loot_nodes.append(p)
	return p


func loot_nodes() -> Array[Node]:
	var out: Array[Node] = []
	for n in _loot_nodes:
		if is_instance_valid(n) and not n.is_queued_for_deletion():
			out.append(n)
	return out


func _spawn_gated() -> void:
	var keep: Array[Dictionary] = []
	for g in _gated:
		var e: Dictionary = g["entry"]
		if bool(Game.get_flag(StringName(e["requires_flag"]), false)) and is_instance_valid(g["parent"]):
			_spawn_loot(e, g["parent"])
		else:
			keep.append(g)
	_gated = keep


func _place_logs(_id: StringName, site: Node3D) -> void:
	var s := site.get_node_or_null(^"Sockets")
	if s == null:
		return
	for m in s.get_children():
		if not (m is Marker3D) or not String(m.name).begins_with("Log_") or not m.has_meta(&"log_id"):
			continue
		var lid := StringName(m.get_meta(&"log_id"))
		var n := LOG_SCRIPT.new() as StaticBody3D
		n.call(&"setup", lid, Story.get_log(lid))
		site.add_child(n)
		n.global_transform = (m as Node3D).global_transform


func _place_uses(id: StringName, site: Node3D) -> void:
	var uses: Dictionary = Story.graph.uses if Story.graph else {}
	for key: String in uses:
		var parts := key.split("/")
		if parts.size() != 2 or StringName(parts[0]) != id:
			continue
		var cfg: Dictionary = uses[key]
		var xf := _socket_xf(site, parts[1], cfg.get("at", null))
		if xf == Transform3D.IDENTITY:
			push_warning("Structures: %s has no socket %s" % [id, parts[1]])
			continue
		var u := USE_SCRIPT.new() as StaticBody3D
		u.call(&"setup", id, StringName(parts[1]), cfg)
		site.add_child(u)
		u.global_transform = Transform3D(xf.basis.orthonormalized(), xf.origin)
		if cfg.has("at"):
			# custom points (depot locker, bunk) get a socket so the story can find them
			var mk := Marker3D.new()
			mk.name = parts[1]
			var sk := site.get_node_or_null(^"Sockets")
			if sk and sk.get_node_or_null(NodePath(parts[1])) == null:
				sk.add_child(mk)
				mk.global_transform = u.global_transform
			else:
				mk.free()


func _place_scans(id: StringName, site: Node3D) -> void:
	var scans: Dictionary = Story.graph.scans if Story.graph else {}
	var done := {}
	for key: String in scans:
		var parts := key.split("/")
		if parts.size() != 2 or StringName(parts[0]) != id:
			continue
		var cfg: Dictionary = scans[key]
		done[parts[1]] = true
		var unlocks: Array = cfg.get("unlocks", [])
		var off := LOOT._v3(cfg.get("offset", []))
		# a use at the same socket doubles as the scanner target (the ray would hit it first)
		var use := site.get_node_or_null(NodePath("Use_" + parts[1].trim_prefix("Use_")))
		if use and use.has_method(&"make_scannable"):
			use.call(&"make_scannable", StringName(cfg["id"]), String(cfg.get("name", "")), unlocks)
			continue
		var xf := _socket_xf(site, parts[1])
		if xf == Transform3D.IDENTITY:
			continue
		var sz: Array = cfg.get("size", [0.8, 0.8, 0.8])
		var n := SCAN_SCRIPT.new() as StaticBody3D
		n.call(&"setup", StringName(cfg["id"]), String(cfg.get("name", "")), unlocks, Vector3(float(sz[0]), float(sz[1]), float(sz[2])))
		site.add_child(n)
		n.global_transform = Transform3D(xf.basis.orthonormalized(), xf * off)
	# remaining Scan_* sockets: generic knowledge scans
	var s := site.get_node_or_null(^"Sockets")
	if s == null:
		return
	for m in s.get_children():
		var nm := String(m.name)
		if not nm.begins_with("Scan_") or done.has(nm):
			continue
		var n := SCAN_SCRIPT.new() as StaticBody3D
		n.call(&"setup", StringName("%s_%s" % [id, nm.trim_prefix("Scan_").to_snake_case()]), nm.trim_prefix("Scan_").capitalize(), [], Vector3(1.2, 1.2, 1.2))
		site.add_child(n)
		n.global_transform = (m as Node3D).global_transform


func _place_extras(id: StringName, site: Node3D) -> void:
	for h in EXTRA_HEAT.get(id, []):
		var heat := _make_heat(site, h[0], h[1], h[2])
		if h[3] == "power":
			_power_heat.append(heat)
		elif h[3] == "always":
			heat.call(&"set_active", true)
	match id:
		&"kestrel_station":
			var fab := _socket_xf(site, "Spot_Fabricator")
			if fab != Transform3D.IDENTITY and ResourceLoader.exists(FABRICATOR_SCENE):
				var f := (load(FABRICATOR_SCENE) as PackedScene).instantiate() as Node3D
				f.name = "Fabricator"
				site.add_child(f)
				f.global_transform = fab
			_build_mara_corner(site)
		&"summit_relay":
			_build_relay_lamp(site)
		&"crash_site":
			_build_radio_glow(site)
	# stoves in sites without a heat slot of their own
	for key: String in (Story.graph.uses if Story.graph else {}):
		var cfg: Dictionary = Story.graph.uses[key]
		if key.begins_with(String(id) + "/") and bool(cfg.get("add_heat", false)):
			var xf := _socket_xf(site, key.split("/")[1])
			var heat := _make_heat(site, site.global_transform.affine_inverse() * xf.origin, 4.0, 18.0)
			_stove_heat[id] = [heat]


func _make_heat(site: Node3D, local: Vector3, radius: float, celsius: float) -> Node3D:
	var n := Node3D.new()
	n.set_script(load(HEAT_SCRIPT))
	n.name = "StoryHeat"
	n.set(&"heat_radius", radius)
	n.set(&"heat_celsius", celsius)
	n.add_to_group(&"heat_source")
	site.add_child(n)
	n.position = local
	if Climate.has_method(&"refresh_sources"):
		Climate.refresh_sources()
	return n


## Mara's corner of the east module: her sleeping bag on the bunk, the handset she talks to you on, the propane
## heater and a hurricane lamp. She is heard (positional voice from Npc_Mara), not shown.
func _build_mara_corner(site: Node3D) -> void:
	var xf := _socket_xf(site, "Npc_Mara")
	if xf == Transform3D.IDENTITY:
		return
	var corner := Node3D.new()
	corner.name = "MaraCorner"
	site.add_child(corner)
	corner.global_transform = Transform3D(xf.basis.orthonormalized(), xf.origin)
	for spec in [["sleeping_bag", Vector3(0.0, -0.02, 0.0), 0.0], ["radio_set", Vector3(0.55, 0.0, -0.75), 1.2],
			["gas_cylinder", Vector3(-0.7, -0.62, 0.55), 0.0], ["lantern", Vector3(0.62, 0.0, 0.55), 0.4]]:
		var path := "res://scenes/props/%s.tscn" % spec[0]
		if not ResourceLoader.exists(path):
			continue
		var p := (load(path) as PackedScene).instantiate() as Node3D
		corner.add_child(p)
		p.position = spec[1]
		p.rotation.y = spec[2]
	_build_mara_curtain(corner)
	_mara_lamp = OmniLight3D.new()
	_mara_lamp.name = "MaraLamp"
	_mara_lamp.light_color = Color(1.0, 0.72, 0.42)
	_mara_lamp.light_energy = 0.9
	_mara_lamp.omni_range = 3.4
	_mara_lamp.omni_attenuation = 1.6
	_mara_lamp.shadow_enabled = false
	_mara_lamp.position = Vector3(0.62, 0.35, 0.55)
	_mara_lamp.distance_fade_enabled = true
	_mara_lamp.distance_fade_begin = 35.0
	_mara_lamp.distance_fade_length = 10.0
	corner.add_child(_mara_lamp)


## The Otter's avionics are still on the battery bus: the radio's amber panel glow is the only light in the
## wreck at dusk, and it draws the eye to the set that will receive Kestrel's beacon.
func _build_radio_glow(site: Node3D) -> void:
	var xf := _socket_xf(site, "Use_Radio")
	if xf == Transform3D.IDENTITY:
		return
	var l := OmniLight3D.new()
	l.name = "RadioGlow"
	l.light_color = Color(1.0, 0.62, 0.28)
	l.light_energy = 0.7
	l.omni_range = 2.6
	l.omni_attenuation = 1.4
	l.shadow_enabled = false
	l.distance_fade_enabled = true
	l.distance_fade_begin = 30.0
	l.distance_fade_length = 8.0
	site.add_child(l)
	l.global_position = xf.origin + xf.basis.z * 0.25 + Vector3.UP * 0.05
	var panel := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.12, 0.035)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.05, 0.03, 0.01)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.55, 0.18)
	m.emission_energy_multiplier = 2.2
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	q.material = m
	panel.mesh = q
	panel.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	panel.visibility_range_end = 40.0
	site.add_child(panel)
	panel.global_transform = Transform3D(xf.basis.orthonormalized(), xf.origin + xf.basis.z * 0.02)


## A wool blanket hung on a line across Mara's bunk for warmth. Her lamp is behind it: from the room you see
## the warm glow through the weave and the soft shadow of someone sitting up against the wall. No mesh of her.
func _build_mara_curtain(corner: Node3D) -> void:
	var w := 2.1
	var h := 2.05
	var mi := MeshInstance3D.new()
	mi.name = "Curtain"
	var q := QuadMesh.new()
	q.size = Vector2(w, h)
	var m := StandardMaterial3D.new()
	var n := 96
	var alb := Image.create(n, n, false, Image.FORMAT_RGB8)
	var emi := Image.create(n, n, false, Image.FORMAT_RGB8)
	for y in n:
		for x in n:
			var u := (float(x) + 0.5) / n
			var v := (float(y) + 0.5) / n
			var fold := 0.86 + 0.14 * sin(u * 38.0 + sin(v * 3.0) * 0.8)
			var sag := 1.0 - 0.1 * absf(sin(u * PI * 4.0)) * (1.0 - v)
			alb.set_pixel(x, y, Color(0.46, 0.39, 0.31) * fold * sag)
			# lamp glow behind the blanket (lower right) and the sitting figure's shadow
			var glow := clampf(1.0 - Vector2((u - 0.66) * 1.2, (v - 0.72) * 1.0).length() * 1.35, 0.0, 1.0)
			var head := Vector2((u - 0.42) / 0.075, (v - 0.37) / 0.095).length()
			var shoulders := Vector2((u - 0.43) / 0.2, (v - 0.56) / 0.12).length()
			var torso := 1.0 if (v > 0.56 and absf(u - 0.43) < 0.19 - (v - 0.56) * 0.08) else 2.0
			var neck := 1.0 if (v > 0.42 and v < 0.5 and absf(u - 0.425) < 0.035) else 2.0
			var d := minf(minf(head, shoulders), minf(torso, neck))
			var shadow := 1.0 - smoothstep(0.75, 1.25, d)
			var e := glow * glow * (1.0 - 0.85 * shadow) * fold
			emi.set_pixel(x, y, Color(1.0, 0.58, 0.26) * e)
	alb.generate_mipmaps()
	emi.generate_mipmaps()
	m.albedo_texture = ImageTexture.create_from_image(alb)
	m.emission_enabled = true
	m.emission_texture = ImageTexture.create_from_image(emi)
	m.emission = Color(1, 1, 1)
	# faint: interiors at night run at a high exposure, a strong emitter blows out to white
	m.emission_energy_multiplier = 0.2
	m.roughness = 1.0
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	q.material = m
	mi.mesh = q
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	mi.visibility_range_end = 60.0
	corner.add_child(mi)
	# floor is ~0.62 m under the bunk socket; the blanket hangs from a line 2.05 m up, north of the bunk
	mi.position = Vector3(0.0, -0.62 + h * 0.5, -1.15)
	mi.rotation.y = PI
	var line := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.004
	cm.bottom_radius = 0.004
	cm.height = w + 0.3
	cm.radial_segments = 4
	var lm := StandardMaterial3D.new()
	lm.albedo_color = Color(0.2, 0.2, 0.19)
	cm.material = lm
	line.mesh = cm
	line.rotation.z = PI * 0.5
	line.position = Vector3(0.0, -0.62 + h + 0.02, -1.15)
	corner.add_child(line)


func _build_relay_lamp(site: Node3D) -> void:
	var xf := _socket_xf(site, "Use_Relay")
	if xf == Transform3D.IDENTITY:
		return
	var holder := Node3D.new()
	holder.name = "RelayLamp"
	site.add_child(holder)
	holder.global_position = xf.origin + xf.basis.y * 0.25
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.025
	sm.height = 0.05
	_relay_mat = StandardMaterial3D.new()
	_relay_mat.albedo_color = Color(0.1, 0.1, 0.1)
	_relay_mat.emission_enabled = true
	_relay_mat.emission = Color(0.0, 0.0, 0.0)
	sm.material = _relay_mat
	mi.mesh = sm
	holder.add_child(mi)
	_relay_lamp = OmniLight3D.new()
	_relay_lamp.omni_range = 1.6
	_relay_lamp.light_energy = 0.0
	_relay_lamp.shadow_enabled = false
	holder.add_child(_relay_lamp)


# ============================================================================================ runtime

func _process(delta: float) -> void:
	_t += delta
	if _relay_state == 1 and _relay_mat:
		var on := fmod(_t, 0.9) < 0.45
		_relay_mat.emission = Color(1.0, 0.55, 0.05) * (3.0 if on else 0.0)
		_relay_lamp.light_color = Color(1.0, 0.55, 0.05)
		_relay_lamp.light_energy = 0.6 if on else 0.0
	_slow_t -= delta
	if _slow_t > 0.0:
		return
	_slow_t = 5.0
	if not _stove_until.is_empty():
		var now: float = Story.abs_hours()
		for sid in _stove_until.keys():
			if now >= float(_stove_until[sid]):
				_set_stove(sid, false)
				_stove_until.erase(sid)


func _on_story_event(ev: StringName) -> void:
	if String(ev).begins_with("flag:"):
		_spawn_gated()


## Reapply world state from Game flags / Story (new game, after a load).
func apply_story_state() -> void:
	_spawn_gated()
	set_station_power(bool(Game.get_flag(&"generator_running", false)), false)
	if bool(Game.get_flag(&"relay_online", false)):
		set_relay_online(true)


## Story interactables with a world effect (called by Story.use_socket after the bookkeeping).
func apply_use(site_id: StringName, socket: StringName, cfg: Dictionary, player: Node) -> void:
	var site := sites.get(site_id) as PoiSite
	match String(cfg.get("kind", "")):
		"stove":
			_set_stove(site_id, true)
			_stove_until[site_id] = Story.abs_hours() + float(cfg.get("heat_hours", 8.0))
			var m := get_socket(site_id, socket)
			if m:
				Audio.play_sfx(&"fire_ignite", m.global_position)
		"lights":
			if site:
				site.set_interior_lights(not site.interior_lights_on)
		"bed":
			var bs: Script = load("res://src/building/build_sleep.gd") if ResourceLoader.exists("res://src/building/build_sleep.gd") else null
			var node := site.get_node_or_null(NodePath("Use_" + String(socket).trim_prefix("Use_"))) as Node3D if site else null
			if bs and node and player:
				bs.call(&"open_for", node, player)
		"depot":
			var m2 := get_socket(site_id, socket)
			if m2:
				Audio.play_sfx(&"door_open_metal", m2.global_position)
			_spawn_gated()


func _set_stove(site_id: StringName, on: bool) -> void:
	var site := sites.get(site_id) as Node3D
	if site == null:
		return
	var nodes: Array = _stove_heat.get(site_id, [])
	if nodes.is_empty():
		for n in site.find_children("*", "", true, false):
			if n.is_in_group(&"heat_source") and n.has_method(&"set_active"):
				nodes.append(n)
		_stove_heat[site_id] = nodes
	for n in nodes:
		if is_instance_valid(n):
			n.call(&"set_active", on)


## Kestrel Station power: interior lights and emissive panels, module heaters, the fabricator (reads the
## Game flag), the generator's running loop (with the cranking intro when `with_start`).
func set_station_power(on: bool, with_start := true) -> void:
	var site := sites.get(&"kestrel_station") as PoiSite
	if site:
		site.set_interior_lights(on)
	for h in _power_heat:
		if is_instance_valid(h):
			h.call(&"set_active", on)
	if on and (_gen_loop == null or not is_instance_valid(_gen_loop)):
		var g := get_socket(&"kestrel_station", &"Use_Generator")
		if g and is_inside_tree():
			if with_start:
				_gen_loop = Audio.start_loop_with_intro(&"generator_start", &"generator_loop", g)
			else:
				_gen_loop = Audio.play_loop(&"generator_loop", g)
	elif not on and _gen_loop and is_instance_valid(_gen_loop):
		_gen_loop.queue_free()
		_gen_loop = null


func set_relay_online(on: bool) -> void:
	_relay_state = 2 if on else 0
	if _relay_mat == null:
		return
	_relay_mat.emission = Color(0.1, 1.0, 0.25) * 4.0 if on else Color.BLACK
	_relay_lamp.light_color = Color(0.2, 1.0, 0.35)
	_relay_lamp.light_energy = 0.8 if on else 0.0


func set_relay_searching() -> void:
	_relay_state = 1


## The dawn rescue: Rescue One-Six flies in from the south-west and lands on the helipad (Spot_Heli).
func spawn_helicopter() -> Node3D:
	var pad := get_socket(&"kestrel_station", &"Spot_Heli")
	if pad == null:
		return null
	var h := HELI_SCRIPT.new() as Node3D
	h.name = "RescueOneSix"
	add_child(h)
	h.call(&"start", pad.global_position, rad_to_deg(pad.global_rotation.y) + 90.0)
	return h


# ============================================================================================ travel

## Door transition between a location and its interior (PoiDoor → here): fade out, move, fade in.
func travel(player: Node, site: StringName, socket: StringName) -> void:
	if _travelling:
		return
	var m := get_socket(site, socket)
	if m == null:
		return
	_travelling = true
	var hud := HUD.find()
	if player.has_method(&"set_input_enabled"):
		player.call(&"set_input_enabled", false)
	if hud:
		await hud.fade_to_black(0.35).finished
	if player.has_method(&"teleport"):
		player.call(&"teleport", m.global_position + Vector3.UP * 0.05, rad_to_deg(m.global_rotation.y))
	elif player is Node3D:
		(player as Node3D).global_position = m.global_position
	Audio.play_sfx(&"door_close", m.global_position)
	var interior := String(SITES.get(site, ["", 0.0, ""])[2]) == "interior"
	var conf: Dictionary = (Story.graph.interiors.get(String(site), {}) if Story.graph else {}) as Dictionary
	Audio.set_environment_reverb(StringName(conf.get("reverb", "cave")) if interior else &"outdoor")
	Story.trigger(StringName("enter_%s" % site))
	await get_tree().process_frame
	await get_tree().process_frame
	if hud:
		hud.fade_in(0.6)
	if player.has_method(&"set_input_enabled"):
		player.call(&"set_input_enabled", true)
	_travelling = false

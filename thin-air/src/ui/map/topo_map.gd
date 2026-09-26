class_name TopoMap
extends RefCounted
## Map data built once per session from TerrainData (cached statically): the heightfield texture the map
## shader samples (TerrainData.height_texture, or one made from TerrainData.heights, or a coarse sampled
## grid on the stub terrain), surface masks, and vector features from the world layout (lakes, rivers,
## trails, POIs). Heavy work happens once; opening the map again is free.

const SHADER := preload("res://src/ui/map/topo_map.gdshader")
const STUB_RES := 129

static var _cache: Dictionary = {}


static func data() -> Dictionary:
	if not _cache.is_empty():
		return _cache
	_cache = build()
	return _cache


static func clear_cache() -> void:
	_cache = {}


## Builds the map data. Works on the stub terrain (flat, no layout) as well as the real heightfield.
static func build() -> Dictionary:
	var d := {}
	var tex: Texture2D = TerrainData.height_texture
	var hp := Vector4(-TerrainData.HALF, -TerrainData.HALF, TerrainData.CELL, TerrainData.SIZE)
	if tex == null and TerrainData.heights.size() == TerrainData.SIZE * TerrainData.SIZE:
		var img := Image.create_from_data(TerrainData.SIZE, TerrainData.SIZE, false, Image.FORMAT_RF, TerrainData.heights.to_byte_array())
		tex = ImageTexture.create_from_image(img)
	if tex == null:
		# stub terrain: sample the height function on a coarse grid
		var n := STUB_RES
		var cell := TerrainData.WORLD_SIZE / float(n - 1)
		var arr := PackedFloat32Array()
		arr.resize(n * n)
		for j in n:
			for i in n:
				arr[j * n + i] = TerrainData.get_height(-TerrainData.HALF + i * cell, -TerrainData.HALF + j * cell)
		tex = ImageTexture.create_from_image(Image.create_from_data(n, n, false, Image.FORMAT_RF, arr.to_byte_array()))
		hp = Vector4(-TerrainData.HALF, -TerrainData.HALF, cell, n)
	d["height_tex"] = tex
	d["hparams"] = hp
	d["mask_tex"] = TerrainData.mask_texture
	d["h_min"] = TerrainData.min_height
	d["h_max"] = maxf(TerrainData.max_height, TerrainData.min_height + 1.0)
	d["lakes"] = _lakes()
	d["rivers"] = _polylines("rivers")
	d["trails"] = _polylines("trails")
	return d


static func _lakes() -> Array:
	var out: Array = []
	for l in TerrainData.layout.get("lakes", []):
		var poly := PackedVector2Array()
		var p: Variant = l.get("polygon", null)
		if p is Array and (p as Array).size() >= 3:
			for q in p:
				poly.append(Vector2(float(q[0]), float(q[1])))
		else:
			var c := Vector2(float(l.get("x", 0.0)), float(l.get("z", 0.0)))
			var r := float(l.get("radius", 50.0))
			for k in 48:
				var a := TAU * k / 48.0
				poly.append(c + Vector2(cos(a), sin(a)) * r * (1.0 + 0.06 * sin(a * 3.0 + c.x)))
		out.append({"id": String(l.get("id", "")), "name": String(l.get("name", "")), "poly": poly})
	return out


static func _polylines(key: String) -> Array:
	var out: Array = []
	for r in TerrainData.layout.get(key, []):
		var pts := PackedVector2Array()
		var widths := PackedFloat32Array()
		var src: Variant = r.get("points", []) if r is Dictionary else r
		if not (src is Array):
			continue
		for q in src:
			if q is Array and (q as Array).size() >= 3:
				pts.append(Vector2(float(q[0]), float(q[2])))
				widths.append(float(q[3]) if (q as Array).size() > 3 else 3.0)
			elif q is Dictionary:
				pts.append(Vector2(float(q.get("x", 0.0)), float(q.get("z", 0.0))))
				widths.append(float(q.get("width", 3.0)))
		if pts.size() >= 2:
			out.append({"id": String(r.get("id", "")) if r is Dictionary else "", "points": pts, "widths": widths})
	return out


## Material for a rect showing the map (MapView sets the view uniforms).
static func make_material() -> ShaderMaterial:
	var d := data()
	var m := ShaderMaterial.new()
	m.shader = SHADER
	m.set_shader_parameter("height_tex", d["height_tex"])
	m.set_shader_parameter("hparams", d["hparams"])
	m.set_shader_parameter("has_masks", d["mask_tex"] != null)
	if d["mask_tex"] != null:
		m.set_shader_parameter("mask_tex", d["mask_tex"])
	m.set_shader_parameter("h_min", float(d["h_min"]))
	m.set_shader_parameter("h_max", float(d["h_max"]))
	m.set_shader_parameter("half_extent", TerrainData.HALF)
	return m


## CPU twin of the shader's contour test: distance (m) from h to the nearest contour and whether it's an index one.
static func contour_info(h: float, interval := 50.0, index_every := 5) -> Array:
	var k := h / interval
	var lvl := roundi(k)
	return [absf(k - lvl) * interval, posmod(lvl, index_every) == 0]

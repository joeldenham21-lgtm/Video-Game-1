extends RefCounted
## Dev-only spruce for the building QA scene (until the vegetation stream's trees are merged): a tapered
## trunk and drooping whorls of spruce-bough cards. One mesh, two surfaces.


static func conifer() -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	var height := 17.0
	var whorls := 22
	for w in whorls:
		var t := float(w) / float(whorls - 1)
		var y := lerpf(2.2, height - 0.6, t)
		var reach := lerpf(2.6, 0.35, pow(t, 0.85)) * rng.randf_range(0.85, 1.1)
		var n := 6 if t < 0.7 else 4
		for b in n:
			var a := TAU * (float(b) + rng.randf() * 0.6) / float(n) + float(w) * 0.9
			var dir := Vector3(cos(a), 0.0, sin(a))
			var droop := lerpf(-0.45, -0.15, t)
			var tip := Vector3(0.0, y, 0.0) + dir * reach + Vector3(0.0, droop * reach, 0.0)
			var base := Vector3(0.0, y + 0.05, 0.0)
			var along := (tip - base).normalized()
			var side := along.cross(Vector3.UP).normalized()
			var wdt := reach * 0.85
			# two crossed cards per branch (flat + tilted) so it reads from every side
			for k in 2:
				var s2 := side.rotated(along, 0.0 if k == 0 else 1.1)
				var nrm := s2.cross(along).normalized()
				if nrm.y < 0.0:
					nrm = -nrm
				var p0 := base - s2 * wdt * 0.5
				var p1 := base + s2 * wdt * 0.5
				var p2 := tip + s2 * wdt * 0.5
				var p3 := tip - s2 * wdt * 0.5
				var uvs := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
				var ps := [p0, p1, p2, p3]
				for idx in [0, 1, 2, 0, 2, 3]:
					st.set_normal((nrm + (ps[idx] as Vector3 - Vector3(0, y, 0)).normalized() * 0.5).normalized())
					st.set_uv(uvs[idx])
					st.add_vertex(ps[idx])
	var bough := st.commit()
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = load("res://assets/models/building/textures/spruce_bough_albedo.png")
	mat.normal_enabled = true
	mat.normal_texture = load("res://assets/models/building/textures/spruce_bough_normal.png")
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.4
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.roughness = 0.85
	mat.vertex_color_use_as_albedo = false
	mat.backlight_enabled = true
	mat.backlight = Color(0.1, 0.13, 0.05)
	mat.albedo_color = Color(0.85, 0.9, 0.85)
	bough.surface_set_material(0, mat)
	# trunk
	var tr := SurfaceTool.new()
	tr.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 7:
		var a0 := TAU * float(k) / 7.0
		var a1 := TAU * float(k + 1) / 7.0
		var r0 := 0.26
		var r1 := 0.03
		var q := [Vector3(cos(a0) * r0, 0.0, sin(a0) * r0), Vector3(cos(a1) * r0, 0.0, sin(a1) * r0),
			Vector3(cos(a1) * r1, height, sin(a1) * r1), Vector3(cos(a0) * r1, height, sin(a0) * r1)]
		for idx in [0, 2, 1, 0, 3, 2]:
			var v: Vector3 = q[idx]
			tr.set_normal(Vector3(v.x, 0.0, v.z).normalized())
			tr.set_uv(Vector2(float(k) / 7.0 * 1.6, v.y))
			tr.add_vertex(v)
	var mesh := tr.commit(bough)
	var bark := load("res://assets/materials/bark_spruce.tres") as Material
	mesh.surface_set_material(1, bark)
	return mesh

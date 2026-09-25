"""Hemi-octahedral impostor atlases for every full-size tree (Blender 4.0 + Cycles, headless).

blender -b -P thin-air/tools/blender/vegetation/impostors.py -- [--only=spruce_a] [--frames=8] [--tile=128] [--spp=16]

For each tree variant the LOD0 model is rebuilt (deterministic, trees.py), and FRAMES x FRAMES views over the
upper hemisphere are rendered in ONE orthographic Cycles render: every view is a copy of the tree rotated so
that looking straight down shows it from that frame's direction (and squeezed so the view's projected
cylinder extent fills its tile exactly). Needle cards are turned toward each frame's viewer and their normals
bent toward the crown exactly like foliage.gdshader, so the impostor lights like the real tree.

Frame math (Godot object space, Y up; mirrored in assets/shaders/impostor.gdshader):
  frame (i, j), g = (i, j) / (N - 1), e = 2g - 1, o = ((e.x + e.y) / 2, (e.x - e.y) / 2)
  d = normalize(o.x, 1 - |o.x| - |o.y|, o.y)                     view direction (object -> viewer)
  right = normalize(cross(Y, d)) (X if d ~ Y), up = cross(d, right)
  extents: Sx = 2 r * M,  Sy = (h * sqrt(1 - d.y^2) + 2 r * d.y) * M     (r crown radius, h height, M margin)
  tile uv: s = dot(P - c, right) / Sx + 0.5, t = 0.5 - dot(P - c, up) / Sy, tile (i, j) = column i, row j

Out: assets/textures/foliage/impostor_albedo.png (RGBA: albedo incl. AO, coverage) and impostor_normal.png
(RGB object-space normal * 0.5 + 0.5, A depth 0.5 + offset / max(Sx, Sy)), both stacked vertically (one
1024 px slice per tree) and imported as Texture2DArray; manifest "impostors" section with the layer map.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402
import trees  # noqa: E402
import bmats  # noqa: E402

MARGIN = 1.06
CROWN_BEND = 0.4       # foliage.gdshader crown_bend
CROWN_UP = 0.6         # foliage.gdshader crown_up
FACING = 0.85          # foliage.gdshader facing
AO_MIX = 0.7


# ------------------------------------------------------------------------------------------------ frame math (Godot)

def hemioct_decode(e):
	ox = (e[0] + e[1]) * 0.5
	oy = (e[0] - e[1]) * 0.5
	d = np.array([ox, 1.0 - abs(ox) - abs(oy), oy])
	return d / np.linalg.norm(d)


def frame_dir(i, j, n):
	g = np.array([i, j], dtype=np.float64) / (n - 1)
	return hemioct_decode(g * 2.0 - 1.0)


def frame_basis(d):
	Y = np.array([0.0, 1.0, 0.0])
	if abs(d[1]) > 0.999:
		right = np.array([1.0, 0.0, 0.0])
	else:
		right = np.cross(Y, d)
		right /= np.linalg.norm(right)
	up = np.cross(d, right)
	return right, up


def frame_extent(d, r, h):
	sx = 2.0 * r * MARGIN
	sy = (h * math.sqrt(max(0.0, 1.0 - d[1] * d[1])) + 2.0 * r * d[1]) * MARGIN
	return sx, sy


def g2b(v):
	"""Godot (x, y, z) -> Blender (x, -z, y)."""
	v = np.asarray(v, dtype=np.float64)
	return np.stack([v[..., 0], -v[..., 2], v[..., 1]], -1)


def b2g(v):
	v = np.asarray(v, dtype=np.float64)
	return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


# ------------------------------------------------------------------------------------------------ geometry

def mesh_arrays(md: vc.MeshData):
	"""Triangulated numpy arrays from MeshData (Blender space)."""
	co = np.asarray(md.co, dtype=np.float64)
	nrm = np.asarray(md.nrm, dtype=np.float64)
	uv0 = np.asarray(md.uv0, dtype=np.float64)
	col = np.asarray(md.col, dtype=np.float64)
	tris = []
	mats = []
	for f, m in zip(md.faces, md.mat):
		for k in range(1, len(f) - 1):
			tris.append((f[0], f[k], f[k + 1]))
			mats.append(m)
	return co, nrm, uv0, col, np.asarray(tris, dtype=np.int64), np.asarray(mats, dtype=np.int64)


def face_cards(co, nrm, uv0, col, tris, mats, view_g, partner):
	"""Axial facing + crown-bent normals of card vertices for a view direction (Godot object space)."""
	co_g = b2g(co)
	n_g = b2g(nrm)
	card_v = np.zeros(len(co), dtype=bool)
	card_v[np.unique(tris[mats == 1].ravel())] = True
	idx = np.nonzero(card_v)[0]
	if len(idx) == 0:
		return co, nrm
	# tangent (increasing U) per card vertex: from the card quad's vertices sharing a row -> use the
	# card geometry: vertices were emitted in (left, right) pairs per row, so the partner is idx ^ 1 in order
	out_co = co_g.copy()
	out_n = n_g.copy()
	width = col[:, 3] * 4.0
	uvx = uv0[:, 0]
	u0 = np.where(uvx < 0.5, 0.0, 0.5)
	x = (uvx - u0) * 2.0 - 0.5
	for vi in idx:
		pv = partner.get(int(vi), -1)
		if pv < 0 or not card_v[pv]:
			continue
		w0 = co_g[pv] - co_g[vi]
		if x[vi] > x[pv]:
			w0 = -w0
		ln = np.linalg.norm(w0)
		if ln < 1e-6:
			continue
		w0 /= ln
		n0 = n_g[vi]
		axis = np.cross(n0, w0)
		la = np.linalg.norm(axis)
		if la < 1e-6:
			continue
		axis /= la
		center = co_g[vi] - w0 * (x[vi] * width[vi])
		w1 = np.cross(axis, view_g)
		l1 = np.linalg.norm(w1)
		if l1 < 1e-4:
			w = w0
		else:
			w1 /= l1
			if np.dot(w1, w0) < 0:
				w1 = -w1
			k = FACING * np.clip((l1 - 0.02) / 0.18, 0, 1)
			k = k * k * (3 - 2 * k)
			w = w0 * (1 - k) + w1 * k
			w /= np.linalg.norm(w)
		p = center + w * (x[vi] * width[vi])
		n = np.cross(w, axis)
		n /= np.linalg.norm(n)
		if np.dot(n, view_g) < 0:
			n = -n
		radial = np.array([p[0], 0.0, p[2]])
		cr = radial + np.array([0.0, CROWN_UP * max(np.linalg.norm(radial), 0.35), 0.0])
		cr /= np.linalg.norm(cr)
		nb = n * (1 - CROWN_BEND) + cr * CROWN_BEND
		out_co[vi] = p
		out_n[vi] = nb / np.linalg.norm(nb)
	return g2b(out_co), g2b(out_n)


def make_object(name, co, nrm, uv0, col, tris, mats, materials):
	me = bpy.data.meshes.new(name)
	me.vertices.add(len(co))
	me.vertices.foreach_set("co", co.astype(np.float32).ravel())
	me.loops.add(len(tris) * 3)
	me.loops.foreach_set("vertex_index", tris.astype(np.int32).ravel())
	me.polygons.add(len(tris))
	me.polygons.foreach_set("loop_start", np.arange(0, len(tris) * 3, 3, dtype=np.int32))
	me.polygons.foreach_set("loop_total", np.full(len(tris), 3, dtype=np.int32))
	me.update(calc_edges=True)
	me.polygons.foreach_set("material_index", mats.astype(np.int32))
	me.polygons.foreach_set("use_smooth", np.ones(len(tris), dtype=bool))
	for m in materials:
		me.materials.append(m)
	uvl = me.uv_layers.new(name="UVMap")
	uvl.data.foreach_set("uv", uv0[tris.ravel()].astype(np.float32).ravel())
	ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
	ca.data.foreach_set("color", col.astype(np.float32).ravel())
	try:
		me.use_auto_smooth = True
	except AttributeError:
		pass
	me.normals_split_custom_set_from_vertices([tuple(n) for n in nrm])
	ob = bpy.data.objects.new(name, me)
	vc.link(ob)
	return ob


# ------------------------------------------------------------------------------------------------ render

def render_variant(name: str, n: int, tile: int, spp: int, cm, mm) -> dict:
	vc.reset_scene()
	var = trees.VARIANTS[name]
	sp = trees.SPECIES[var["sp"]]
	look = trees.LOOK.get(var["sp"], {})
	built = trees.build_variant(name, cm, mm)
	md = built["lods"][0]
	co, nrm, uv0, col, tris, mats = mesh_arrays(md)
	co_g = b2g(co)
	r = float(np.max(np.hypot(co_g[:, 0], co_g[:, 2]))) * 1.02
	y0 = max(float(co_g[:, 1].min()), 0.0)
	y1 = float(co_g[:, 1].max())
	h = y1 - y0
	c_g = np.array([0.0, (y0 + y1) * 0.5, 0.0])
	uvs = mm.get(sp["bark"], {}).get("uv1_scale", [2.0, 1.0])
	bt = look.get("bark_tint", [1, 1, 1])
	lt = look.get("leaf_tint", [1, 1, 1])
	mat_bark = bmats.bark_material(sp["bark"], tuple(bt), uvs, with_ao=True)
	mats_list = [mat_bark]
	if sp["cards"]:
		mats_list.append(bmats.card_material(sp["cards"], with_ao=True, tint=tuple(lt), ao_mix=AO_MIX))
	else:
		mats_list.append(mat_bark)
	S = 10.0                      # tile size in Blender world units
	W = n * S
	for j in range(n):
		for i in range(n):
			d = frame_dir(i, j, n)
			right, up = frame_basis(d)
			sx, sy = frame_extent(d, r, h)
			fco, fn = face_cards(co, nrm, uv0, col, tris, mats, d, md.partner)
			R = np.stack([g2b(right), g2b(up), g2b(d)])          # rows: object(Blender) -> view axes
			Sc = np.diag([S / sx, S / sy, 1.0])
			M3 = Sc @ R
			center = np.array([(i + 0.5 - n / 2) * S, (n / 2 - j - 0.5) * S, 0.0])
			t = center - M3 @ g2b(c_g)
			# bake the (non-uniform, view-space) transform into the vertices; normals only rotate, so the
			# normal pass is R * n_object exactly
			wco = fco @ M3.T + t
			wn = fn @ R.T
			make_object(f"f{i}_{j}", wco, wn, uv0, col, tris, mats, mats_list)
	sc = bpy.context.scene
	sc.render.engine = "CYCLES"
	sc.cycles.device = "CPU"
	sc.cycles.samples = spp
	sc.cycles.use_adaptive_sampling = False
	sc.cycles.use_denoising = False
	sc.cycles.max_bounces = 0
	sc.cycles.transparent_max_bounces = 48
	sc.cycles.pixel_filter_type = "BLACKMAN_HARRIS"
	sc.cycles.filter_width = 1.0
	sc.render.film_transparent = True
	sc.render.resolution_x = n * tile
	sc.render.resolution_y = n * tile
	sc.render.threads_mode = "FIXED"
	sc.render.threads = max(1, min(4, os.cpu_count() or 1))
	world = bpy.data.worlds.new("W")
	sc.world = world
	vl = sc.view_layers[0]
	vl.use_pass_diffuse_color = True
	vl.use_pass_normal = True
	vl.use_pass_z = True
	cd = bpy.data.cameras.new("Cam")
	cd.type = "ORTHO"
	cd.ortho_scale = W
	cd.clip_start = 1.0
	cd.clip_end = 400.0
	cam = bpy.data.objects.new("Cam", cd)
	cam.location = (0.0, 0.0, 200.0)
	vc.link(cam)
	sc.camera = cam
	out_dir = vc.ensure_dir(os.path.join(vc.CACHE, "impostors"))
	sc.use_nodes = True
	nt = sc.node_tree
	for nd in list(nt.nodes):
		nt.nodes.remove(nd)
	rl = nt.nodes.new("CompositorNodeRLayers")
	fo = nt.nodes.new("CompositorNodeOutputFile")
	fo.base_path = out_dir
	fo.format.file_format = "OPEN_EXR"
	fo.format.color_depth = "32"
	fo.format.color_mode = "RGBA"
	fo.file_slots.clear()
	for pname in ["Image", "DiffCol", "Normal", "Depth"]:
		fo.file_slots.new(pname)
		src = rl.outputs.get(pname) or (rl.outputs.get("Z") if pname == "Depth" else None)
		nt.links.new(src, fo.inputs[pname])
	for slot in fo.file_slots:
		slot.path = f"{name}_{slot.path}_"
	sc.frame_set(1)
	t0 = time.time()
	bpy.ops.render.render(write_still=False)
	print(f"[impostors] {name}: render {time.time() - t0:.1f}s")
	res = n * tile
	passes = {}
	for pname in ["Image", "DiffCol", "Normal", "Depth"]:
		img = bpy.data.images.load(os.path.join(out_dir, f"{name}_{pname}_0001.exr"), check_existing=False)
		img.colorspace_settings.name = "Non-Color"
		a = np.empty(res * res * 4, dtype=np.float32)
		img.pixels.foreach_get(a)
		passes[pname] = a.reshape(res, res, 4)[::-1].copy()
		bpy.data.images.remove(img)
	alb, nrd = post(passes, n, tile, S, r, h)
	return {"albedo": alb, "normal": nrd, "r": r, "h": h, "center_y": float(c_g[1]), "y0": y0}


def post(passes, n, tile, S, r, h):
	a = np.clip(passes["Image"][..., 3], 0.0, 1.0)
	cov = np.maximum(a, 1e-4)[..., None]
	alb = np.clip(passes["DiffCol"][..., :3] / cov, 0.0, 1.0)
	nw = passes["Normal"][..., :3] / cov
	z = passes["Depth"][..., 0]
	res = n * tile
	nrm_out = np.zeros((res, res, 3), dtype=np.float64)
	dep_out = np.full((res, res), 0.5, dtype=np.float64)
	for j in range(n):
		for i in range(n):
			d = frame_dir(i, j, n)
			right, up = frame_basis(d)
			sx, sy = frame_extent(d, r, h)
			R = np.stack([g2b(right), g2b(up), g2b(d)])
			ys, xs = slice(j * tile, (j + 1) * tile), slice(i * tile, (i + 1) * tile)
			nwt = nw[ys, xs]
			nb = nwt @ R                                         # R^T n_w (row-vector form)
			nb /= np.maximum(np.linalg.norm(nb, axis=-1, keepdims=True), 1e-6)
			nrm_out[ys, xs] = b2g(nb)
			zt = z[ys, xs]
			# camera at z=200 looking down; the pivot plane is z=0 -> depth offset = (Z - 200) world units
			off = np.where(a[ys, xs] > 0.01, zt - 200.0, 0.0)
			dep_out[ys, xs] = np.clip(0.5 + off / (2.0 * max(sx, sy)), 0.0, 1.0)
	# dilate per tile (never across tiles)
	alb_d = np.zeros_like(alb)
	nrm_d = np.zeros_like(nrm_out)
	for j in range(n):
		for i in range(n):
			ys, xs = slice(j * tile, (j + 1) * tile), slice(i * tile, (i + 1) * tile)
			at = a[ys, xs]
			alb_d[ys, xs] = dilate_tile(alb[ys, xs], at)
			nrm_d[ys, xs] = dilate_tile(nrm_out[ys, xs], at)
	nrm_d /= np.maximum(np.linalg.norm(nrm_d, axis=-1, keepdims=True), 1e-6)
	albedo = np.concatenate([srgb(alb_d), a[..., None]], -1)
	normal = np.concatenate([nrm_d * 0.5 + 0.5, dep_out[..., None]], -1)
	return albedo, normal


def dilate_tile(rgb, alpha, iters=24):
	w = (alpha > 0.3).astype(np.float64)
	c = rgb * w[..., None]
	if w.sum() == 0:
		return np.zeros_like(rgb) + 0.2
	for _ in range(iters):
		if w.min() > 0:
			break
		acc = np.zeros_like(c)
		wa = np.zeros_like(w)
		for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
			acc += np.roll(np.roll(c * w[..., None], dy, 0), dx, 1)
			wa += np.roll(np.roll(w, dy, 0), dx, 1)
		fill = (w == 0) & (wa > 0)
		c[fill] = acc[fill] / wa[fill][:, None]
		w = np.where(fill, 1.0, w)
	mean = (rgb * (alpha[..., None] > 0.3)).sum((0, 1)) / max(1, (alpha > 0.3).sum())
	c[w == 0] = mean
	return c


def srgb(x):
	x = np.clip(x, 0, 1)
	return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save_png(path, arr, srgb_space):
	h, w, ch = arr.shape
	img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True, float_buffer=False)
	img.colorspace_settings.name = "sRGB" if srgb_space else "Non-Color"
	buf = np.ones((h, w, 4), dtype=np.float32)
	buf[..., :ch] = arr
	img.pixels.foreach_set(buf[::-1].ravel())
	img.filepath_raw = path
	img.file_format = "PNG"
	img.save()
	bpy.data.images.remove(img)


def write_array_import(png: str, slices: int) -> None:
	imp = png + ".import"
	uid = None
	if os.path.exists(imp):
		for line in open(imp):
			if line.startswith("uid="):
				uid = line.strip()
	lines = ["[remap]", "", 'importer="2d_array_texture"', 'type="CompressedTexture2DArray"']
	if uid:
		lines.append(uid)
	lines += ["", "[params]", "", "compress/mode=2", "compress/high_quality=false", "compress/lossy_quality=0.7",
		"compress/hdr_compression=1", "compress/channel_pack=0", "mipmaps/generate=true", "mipmaps/limit=-1",
		"slices/horizontal=1", f"slices/vertical={slices}"]
	with open(imp, "w") as f:
		f.write("\n".join(lines) + "\n")


def main():
	a = vc.parse_args()
	n = int(a.get("frames", "8"))
	tile = int(a.get("tile", "128"))
	spp = int(a.get("spp", "16"))
	names = [k for k, v in trees.VARIANTS.items() if not v.get("sapling")]
	only = [s for s in a.get("only", "").split(",") if s]
	cm = trees.load_cards_meta()
	mm = trees.load_material_meta()
	cache = vc.ensure_dir(os.path.join(vc.CACHE, "impostors"))
	for name in names:
		if only and name not in only:
			continue
		t0 = time.time()
		res = render_variant(name, n, tile, spp, cm, mm)
		np.save(os.path.join(cache, f"{name}_albedo.npy"), res["albedo"].astype(np.float32))
		np.save(os.path.join(cache, f"{name}_normal.npy"), res["normal"].astype(np.float32))
		json.dump({k: res[k] for k in ("r", "h", "center_y", "y0")}, open(os.path.join(cache, f"{name}.json"), "w"))
		print(f"[impostors] {name} done in {time.time() - t0:.1f}s")
	# assemble every cached variant (in manifest order) into the two arrays
	layers = {}
	albs, nrms = [], []
	for name in names:
		p = os.path.join(cache, f"{name}_albedo.npy")
		if not os.path.exists(p):
			continue
		meta = json.load(open(os.path.join(cache, f"{name}.json")))
		layers[name] = {"layer": len(albs), "radius": round(meta["r"], 4), "height": round(meta["h"], 4),
			"center_y": round(meta["center_y"], 4)}
		albs.append(np.load(p))
		nrms.append(np.load(os.path.join(cache, f"{name}_normal.npy")))
	if not albs:
		return
	vc.ensure_dir(vc.TEX_FOLIAGE)
	pa = os.path.join(vc.TEX_FOLIAGE, "impostor_albedo.png")
	pn = os.path.join(vc.TEX_FOLIAGE, "impostor_normal.png")
	save_png(pa, np.concatenate(albs, 0), True)
	save_png(pn, np.concatenate(nrms, 0), False)
	write_array_import(pa, len(albs))
	write_array_import(pn, len(albs))
	mp = os.path.join(vc.MODELS_VEG, "vegetation.json")
	data = json.load(open(mp)) if os.path.exists(mp) else {}
	data["impostors"] = {"albedo": "res://assets/textures/foliage/impostor_albedo.png",
		"normal": "res://assets/textures/foliage/impostor_normal.png", "frames": n, "tile": tile,
		"margin": MARGIN, "layers": layers}
	json.dump(data, open(mp, "w"), indent=1, sort_keys=True)
	print(f"[impostors] packed {len(albs)} layers")


if __name__ == "__main__":
	main()

"""Rocks of a glaciated granite/gneiss range: boulders, outcrop slabs, small rocks, talus patches.

blender -b -P thin-air/tools/blender/vegetation/rocks.py -- [--only=boulder_a] [--bake=512]

Sculpting (all numpy, deterministic):
  1. dense sphere (or box for slabs) scaled to the rock's proportions
  2. joint planes: a Voronoi-like set of random planes clips the shape -> angular fracture faces
  3. crevices: distance-to-cell-edge of a 3D Voronoi field cuts thin cracks; fBm noise roughens faces
  4. erosion: curvature-weighted Laplacian smoothing rounds the exposed edges (convex) more than the faces
  5. base sunk below ground, bottom flattened
LOD0/1/2 = Blender Decimate (collapse) of the sculpt; the high-res sculpt is baked into a tangent normal map
per rock (Cycles, selected-to-active) so LOD0 keeps crack/grain detail at ~2-3k tris. Vertex colour G = AO
(cavity + ground contact). Surface texture = rock_boulder (world triplanar) in src/vegetation/shaders/rock.gdshader.
Out: assets/models/rocks/<name>.glb (+ <name>_normal.png) and manifest section "rocks".
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402

# size (x, y, z) in m (Blender Z up), planes = joint planes, crack = crevice depth, erode = rounding passes
ROCKS = {
	"boulder_a": dict(size=(2.6, 2.0, 1.7), planes=9, crack=0.035, erode=6, rough=0.035, tris=(2400, 700, 160), sink=0.25),
	"boulder_b": dict(size=(4.2, 3.1, 2.4), planes=12, crack=0.05, erode=5, rough=0.05, tris=(3000, 850, 200), sink=0.35),
	"boulder_c": dict(size=(1.6, 1.3, 1.1), planes=7, crack=0.025, erode=9, rough=0.025, tris=(1600, 480, 120), sink=0.15),
	"outcrop_a": dict(size=(7.5, 4.5, 2.6), planes=14, crack=0.07, erode=3, rough=0.06, tris=(3000, 900, 220), sink=0.8,
		slab=True, layers=4),
	"outcrop_b": dict(size=(5.5, 3.2, 3.4), planes=12, crack=0.06, erode=3, rough=0.05, tris=(2800, 850, 200), sink=0.7,
		slab=True, layers=3),
	"rock_small_a": dict(size=(0.55, 0.42, 0.3), planes=6, crack=0.008, erode=8, rough=0.01, tris=(420, 140, 48), sink=0.06),
	"rock_small_b": dict(size=(0.38, 0.33, 0.24), planes=6, crack=0.006, erode=10, rough=0.008, tris=(360, 120, 40), sink=0.05),
	"rock_small_c": dict(size=(0.8, 0.5, 0.35), planes=7, crack=0.01, erode=5, rough=0.012, tris=(480, 160, 52), sink=0.08),
	"rock_small_d": dict(size=(0.26, 0.2, 0.16), planes=5, crack=0.004, erode=10, rough=0.006, tris=(300, 100, 36), sink=0.03),
	"talus_patch": dict(size=(3.2, 2.6, 0.5), talus=True, tris=(2400, 800, 200), sink=0.1),
}


def sphere_grid(res: int):
	"""Cube-sphere (quads) with res x res per face -> verts on unit sphere, faces."""
	verts = []
	faces = []
	idx = {}

	def vid(p):
		key = tuple(np.round(p, 6))
		if key in idx:
			return idx[key]
		idx[key] = len(verts)
		verts.append(p)
		return idx[key]
	lin = np.linspace(-1, 1, res + 1)
	axes = [(0, 1, 2), (0, 2, 1), (1, 2, 0)]
	for a, b, c in axes:
		# quad normal = e_a x e_b; for the odd permutation (x, z, y) that is -e_c, so flip it there
		odd = (a, b, c) == (0, 2, 1)
		for sgn in (-1, 1):
			grid = np.zeros((res + 1, res + 1), dtype=np.int64)
			for i, u in enumerate(lin):
				for j, v in enumerate(lin):
					p = np.zeros(3)
					p[a] = u
					p[b] = v
					p[c] = sgn
					grid[i, j] = vid(p)
			for i in range(res):
				for j in range(res):
					q = (grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1])
					faces.append(q if (sgn > 0) != odd else q[::-1])
	V = np.array(verts, dtype=np.float64)
	V /= np.linalg.norm(V, axis=1, keepdims=True)
	return V, faces


def fbm3(P, rs, octaves=5, base=1.0):
	"""Cheap 3D fBm from random sinusoid sums (deterministic)."""
	out = np.zeros(len(P))
	amp = 1.0
	freq = base
	for _ in range(octaves):
		for _k in range(4):
			d = rs.normal(0, 1, 3)
			d /= np.linalg.norm(d)
			ph = rs.uniform(0, 6.283)
			out += amp * np.sin(P @ d * freq + ph) / 4.0
		amp *= 0.5
		freq *= 2.03
	return out


def voronoi_edge(P, seeds):
	"""Distance to the nearest Voronoi cell boundary (F2 - F1)/2 for points P."""
	d = np.linalg.norm(P[:, None, :] - seeds[None, :, :], axis=2)
	d.sort(axis=1)
	return (d[:, 1] - d[:, 0]) * 0.5


def neighbours(n, faces):
	nb = [set() for _ in range(n)]
	for f in faces:
		k = len(f)
		for i in range(k):
			nb[f[i]].add(f[(i + 1) % k])
			nb[f[i]].add(f[(i - 1) % k])
	return [np.array(sorted(s), dtype=np.int64) for s in nb]


def vertex_normals(V, faces):
	N = np.zeros_like(V)
	for f in faces:
		p = V[list(f)]
		n = np.cross(p[1] - p[0], p[2] - p[0])
		if len(f) == 4:
			n += np.cross(p[2] - p[0], p[3] - p[0])
		for i in f:
			N[i] += n
	return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


def sculpt(name: str, p: dict):
	rs = vc.rng("rock", name)
	res = 60 if max(p["size"]) > 1.0 else 30
	V, faces = sphere_grid(res)
	sx, sy, sz = p["size"]
	if p.get("slab"):
		# rounded box for slabs: push the sphere toward a superellipsoid
		V = np.sign(V) * np.abs(V) ** 0.45
	V = V * np.array([sx, sy, sz]) * 0.5
	V[:, 2] += sz * 0.5
	c = np.array([0.0, 0.0, sz * 0.5])
	# 2) joint planes (fracture faces)
	for k in range(p["planes"]):
		n = rs.normal(0, 1, 3)
		if k < 3 and p.get("slab"):
			n = np.array([rs.normal(0, 0.15), rs.normal(0, 0.15), 1.0])   # bedding planes on slabs
		n /= np.linalg.norm(n)
		extent = np.abs(n) @ (np.array([sx, sy, sz]) * 0.5)
		off = extent * rs.uniform(0.62, 0.9)
		dist = (V - c) @ n - off
		out = dist > 0
		V[out] -= np.outer(dist[out], n) * rs.uniform(0.85, 1.0)
	# slab bedding layers: steps
	if p.get("layers"):
		for k in range(p["layers"]):
			h = sz * (0.3 + 0.55 * k / p["layers"]) + rs.normal(0, 0.05)
			band = np.abs(V[:, 2] - h) < sz * 0.03
			V[band] -= (V[band] - np.array([c[0], c[1], V[band][:, 2].mean() if band.any() else 0])) * np.array([0.03, 0.03, 0.0])
	nb = neighbours(len(V), faces)
	# 3) crevices + roughness
	N = vertex_normals(V, faces)
	scale = max(sx, sy, sz)
	seeds = c + rs.uniform(-0.6, 0.6, (14, 3)) * np.array([sx, sy, sz])
	edge = voronoi_edge(V, seeds)
	crack = np.exp(-(edge / (0.025 * scale)) ** 2) * p["crack"]
	rough = fbm3(V / scale * 6.0, rs, 5) * p["rough"] + fbm3(V / scale * 25.0, rs, 3) * p["rough"] * 0.35
	V = V + N * (rough[:, None] - crack[:, None])
	# 4) erosion: rounds convex edges (weight by convexity)
	for it in range(p["erode"]):
		N = vertex_normals(V, faces)
		lap = np.array([V[nb[i]].mean(0) - V[i] if len(nb[i]) else np.zeros(3) for i in range(len(V))])
		convex = np.clip(-(lap * N).sum(1) / (0.01 * scale), 0.0, 1.0)
		V = V + lap * (0.25 + 0.5 * convex)[:, None]
	# 5) ground: sink and flatten the underside
	V[:, 2] -= p["sink"]
	under = V[:, 2] < -p["sink"] * 0.5
	V[under, 2] = -p["sink"] * 0.5 + (V[under, 2] + p["sink"] * 0.5) * 0.3
	return V, faces


def talus(name: str, p: dict):
	"""Patch of angular scree stones (a single mesh) lying on the ground."""
	rs = vc.rng("talus", name)
	allV = []
	allF = []
	off = 0
	sx, sy, _ = p["size"]
	for k in range(18):
		sub = {"size": tuple(rs.uniform(0.18, 0.55) * np.array([1.0, rs.uniform(0.6, 0.9), rs.uniform(0.35, 0.6)])),
			"planes": 6, "crack": 0.0, "erode": 2, "rough": 0.004, "sink": 0.03}
		V, F = sculpt(f"{name}_{k}", sub)
		ang = rs.uniform(0, 6.283)
		R = np.array([[math.cos(ang), -math.sin(ang), 0], [math.sin(ang), math.cos(ang), 0], [0, 0, 1]])
		V = V @ R.T + np.array([rs.normal(0, sx * 0.25), rs.normal(0, sy * 0.25), 0.0])
		allV.append(V)
		allF += [tuple(i + off for i in f) for f in F]
		off += len(V)
	return np.concatenate(allV), allF


def make_obj(name, V, F):
	me = bpy.data.meshes.new(name)
	me.from_pydata(V.tolist(), [], [list(f) for f in F])
	me.update()
	ob = bpy.data.objects.new(name, me)
	vc.link(ob)
	return ob


def decimated(src, name, tris):
	ob = src.copy()
	ob.data = src.data.copy()
	ob.name = name
	vc.link(ob)
	bpy.context.view_layer.objects.active = ob
	cur = sum(len(pp.vertices) - 2 for pp in ob.data.polygons)
	mod = ob.modifiers.new("dec", "DECIMATE")
	mod.ratio = min(1.0, tris / max(cur, 1))
	mod.use_collapse_triangulate = True
	bpy.ops.object.modifier_apply(modifier="dec")
	return ob


def set_ao_and_uv(ob, hi_V):
	me = ob.data
	n = len(me.vertices)
	co = np.empty(n * 3)
	me.vertices.foreach_get("co", co)
	co = co.reshape(-1, 3)
	# cavity from mesh curvature + ground contact darkening
	bm = bmesh.new()
	bm.from_mesh(me)
	bm.verts.ensure_lookup_table()
	cav = np.zeros(n)
	for v in bm.verts:
		if not v.link_edges:
			continue
		nbp = np.array([e.other_vert(v).co for e in v.link_edges])
		lap = nbp.mean(0) - np.array(v.co)
		cav[v.index] = float(np.dot(lap, np.array(v.normal)))
	bm.free()
	scale = max(np.ptp(co, axis=0))
	cavity = np.clip(0.5 + cav / (0.02 * scale), 0.0, 1.0)
	ground = np.clip((co[:, 2] + 0.05) / (0.25 * scale + 0.05), 0.0, 1.0)
	ao = np.clip((0.55 + 0.45 * (1.0 - cavity)) * (0.55 + 0.45 * ground), 0.2, 1.0)
	col = np.stack([np.zeros(n), ao, np.zeros(n), np.zeros(n)], 1)
	ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
	ca.data.foreach_set("color", col.astype(np.float32).ravel())
	me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
	# UVs for the baked normal map
	bpy.context.view_layer.objects.active = ob
	bpy.ops.object.select_all(action="DESELECT")
	ob.select_set(True)
	bpy.ops.object.mode_set(mode="EDIT")
	bpy.ops.mesh.select_all(action="SELECT")
	bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.01)
	bpy.ops.object.mode_set(mode="OBJECT")
	me.uv_layers[0].name = "UVMap"


def bake_normal(hi, lo, size: int, path: str):
	sc = bpy.context.scene
	sc.render.engine = "CYCLES"
	sc.cycles.device = "CPU"
	sc.cycles.samples = 1
	img = bpy.data.images.new(os.path.basename(path), size, size, alpha=False, float_buffer=False)
	img.colorspace_settings.name = "Non-Color"
	mat = bpy.data.materials.new("bake_" + lo.name)
	mat.use_nodes = True
	node = mat.node_tree.nodes.new("ShaderNodeTexImage")
	node.image = img
	mat.node_tree.nodes.active = node
	lo.data.materials.clear()
	lo.data.materials.append(mat)
	bpy.ops.object.select_all(action="DESELECT")
	hi.select_set(True)
	lo.select_set(True)
	bpy.context.view_layer.objects.active = lo
	sc.render.bake.use_selected_to_active = True
	sc.render.bake.cage_extrusion = 0.02 * max(lo.dimensions)
	sc.render.bake.max_ray_distance = 0.05 * max(lo.dimensions)
	sc.render.bake.margin = 8
	bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
	img.filepath_raw = path
	img.file_format = "PNG"
	img.save()
	lo.data.materials.clear()
	return img


def main():
	a = vc.parse_args()
	only = [s for s in a.get("only", "").split(",") if s] or list(ROCKS.keys())
	bake = int(a.get("bake", "512"))
	entries = {}
	vc.ensure_dir(vc.MODELS_ROCKS)
	for name in only:
		p = ROCKS[name]
		vc.reset_scene()
		V, F = talus(name, p) if p.get("talus") else sculpt(name, p)
		hi = make_obj(name + "_hi", V, F)
		hi.data.polygons.foreach_set("use_smooth", [True] * len(hi.data.polygons))
		lods = []
		for i, t in enumerate(p["tris"]):
			lo = decimated(hi, f"LOD{i}", t)
			set_ao_and_uv(lo, V)
			lods.append(lo)
		nrm_png = os.path.join(vc.MODELS_ROCKS, f"{name}_normal.png")
		small = max(p["size"]) < 1.0
		bake_normal(hi, lods[0], bake // 2 if small else bake, nrm_png)
		# final materials (names map to rock.gdshader in VegLibrary)
		mat = vc.simple_material("rock_" + name, (0.4, 0.4, 0.38, 1))
		for lo in lods:
			lo.data.materials.clear()
			lo.data.materials.append(mat)
		bpy.data.objects.remove(hi)
		path = os.path.join(vc.MODELS_ROCKS, f"{name}.glb")
		vc.export_glb(path, lods)
		vc.write_godot_scene_import(path)
		_write_normal_import(nrm_png)
		co = np.array([v.co for v in lods[0].data.vertices])
		dims = co.max(0) - co.min(0)
		entries[name] = {
			"path": "res://" + os.path.relpath(path, vc.PROJECT).replace(os.sep, "/"),
			"normal": "res://" + os.path.relpath(nrm_png, vc.PROJECT).replace(os.sep, "/"),
			"radius": round(float(max(dims[0], dims[1]) * 0.5), 3), "height": round(float(co[:, 2].max()), 3),
			"size": [round(float(d), 3) for d in dims], "talus": bool(p.get("talus", False)),
			"tris": [sum(len(pp.vertices) - 2 for pp in lo.data.polygons) for lo in lods],
			"yield": "stone" if max(p["size"]) < 1.0 else "none",
		}
		print(f"[rocks] {name}: tris {entries[name]['tris']} size {entries[name]['size']}")
	mp = os.path.join(vc.MODELS_VEG, "vegetation.json")
	data = json.load(open(mp)) if os.path.exists(mp) else {}
	data.setdefault("rocks", {}).update(entries)
	json.dump(data, open(mp, "w"), indent=1, sort_keys=True)


def _write_normal_import(png: str) -> None:
	imp = png + ".import"
	uid = None
	if os.path.exists(imp):
		for line in open(imp):
			if line.startswith("uid="):
				uid = line.strip()
	lines = ["[remap]", "", 'importer="texture"', 'type="CompressedTexture2D"']
	if uid:
		lines.append(uid)
	lines += ["", "[params]", "", "compress/mode=2", "compress/high_quality=false", "compress/lossy_quality=0.7",
		"compress/hdr_compression=1", "compress/normal_map=1", "compress/channel_pack=0", "mipmaps/generate=true",
		"mipmaps/limit=-1", "roughness/mode=1", 'roughness/src_normal=""', "process/fix_alpha_border=true",
		"process/premult_alpha=false", "process/normal_map_invert_y=false", "process/size_limit=0",
		"detect_3d/compress_to=0"]
	with open(imp, "w") as f:
		f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
	main()

"""Shrubs, ground plants and deadwood (Blender 4.0 headless, deterministic).

blender -b -P thin-air/tools/blender/vegetation/plants.py -- [--only=willow_a,log_a]

  willow_a / alder_a   young multi-stem shrubs (1.8-2.6 m), October: willow nearly bare, alder late leaves
  juniper_mat          common juniper, prostrate mat ~2.4 m across, 0.45 m high
  huckleberry_a        black huckleberry bush with red autumn leaves and a few berries (harvestable)
  grass_tuft_a/_b      dry grass card clusters, sedge_tuft, fern_clump (dead fronds) -> GPU ground cover
  log_a / log_b        fallen spruce (recent, bark on, branch stubs) / old silvered decayed log
  stump_a / stump_b    old axe-cut stump with end grain / natural broken snag stump
Vertex layout as trees (vegcommon.py). Manifest sections "plants", "groundcover", "deadwood".
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402
import trees  # noqa: E402

Z = np.array([0.0, 0.0, 1.0])


class Plant:
	"""Duck-types the bits of trees.Tree that the card/branch mesh writers use."""

	def __init__(self, name, H, R):
		self.name = name
		self.H = H
		self.R = R
		self.sapling = False

	def crown_ao(self, p):
		r = math.hypot(p[0], p[1])
		ao = 0.35 + 0.65 * min(r / max(self.R, 0.1), 1.0) ** 1.2
		ao *= 0.7 + 0.3 * min(max(p[2], 0.0) / max(self.H, 0.1), 1.0)
		return float(np.clip(ao, 0.2, 1.0))

	def crown_normal(self, p):
		v = np.array([p[0], p[1], max(p[2], 0.0) * 0.5 + 0.3])
		return vc.normalize(v)

	def _wind_weight(self, b, s):
		return float(np.clip(s ** 1.2 * min(1.0, 0.4 + b.L / 2.0), 0, 1))


def regions_of(card_set):
	cm = trees.load_cards_meta()
	return (cm.get(card_set, {}) or {}).get("regions") or {"long": {"uv": [0, 0, 0.5, 1]}, "short": {"uv": [0.5, 0, 1, 0.5]},
		"tip": {"uv": [0.5, 0.5, 1, 1]}}


def stem(rs, base, direction, length, bend, n=6):
	s = np.linspace(0, 1, n)
	d = vc.normalize(np.asarray(direction, dtype=np.float64))
	pts = base[None] + np.outer(s * length, d) + np.outer(s ** 2 * length, bend)
	pts += rs.normal(0, 0.012 * length, (n, 3)) * s[:, None]
	return pts


def mk_branch(pts, r0, r1, phase, z0=0.0):
	b = trees.Branch()
	b.pts = pts
	b.radii = np.linspace(r0, r1, len(pts))
	b.L = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
	b.phase = phase
	b.z0 = z0
	b.t = 0.5
	return b


def cards_along(md, plant, b, regions, rs, *, s0, spacing, scale, up_bias, region_long=0.6, segs=1, ao_mul=1.0):
	L = b.L
	s = s0 * L
	side = 1.0
	while s < L:
		p, tn = trees.Tree._branch_at(None, b, s)
		side = -side
		lat = vc.normalize(np.cross(Z, tn))
		if np.linalg.norm(np.cross(Z, tn)) < 1e-6:
			lat = np.array([1.0, 0.0, 0.0])
		a = math.radians(rs.uniform(25, 55)) * side
		d = vc.normalize(tn * math.cos(a) + lat * math.sin(a) + Z * up_bias)
		w = vc.normalize(np.cross(Z, d))
		if np.linalg.norm(np.cross(Z, d)) < 1e-6:
			w = lat
		roll = rs.normal(0, 0.6)
		w = vc.normalize(w * math.cos(roll) + np.cross(d, w) * math.sin(roll))
		n = vc.normalize(np.cross(d, w))
		if n[2] < 0:
			n, w = -n, -w
		sc = scale * rs.uniform(0.75, 1.15)
		region = "long" if rs.random() < region_long else ("short" if rs.random() < 0.5 else "tip")
		length = sc * (1.0 if region == "long" else 0.5)
		c = trees.Card(p, d, w, n, length, sc * 0.5, region, 0.05 * length, plant._wind_weight(b, s / L),
			min(1.0, plant._wind_weight(b, s / L) + 0.3), b.phase, p[2] / plant.H)
		trees.mesh_card(md, plant, c, regions, segs=segs)
		s += spacing * rs.uniform(0.7, 1.3)


def shrub(name, card_set, bark, H, R, nstems, spread, rs, card_scale, spacing, lod):
	plant = Plant(name, H, R)
	regions = regions_of(card_set)
	md = vc.MeshData()
	for k in range(nstems):
		az = 2 * math.pi * k / nstems + rs.normal(0, 0.3)
		out = rs.uniform(0.25, spread)
		L = H * rs.uniform(0.7, 1.12)
		d = np.array([math.cos(az) * out, math.sin(az) * out, 1.0])
		base = np.array([math.cos(az), math.sin(az), 0.0]) * rs.uniform(0.02, 0.12) - Z * 0.1
		pts = stem(rs, base, d, L, np.array([math.cos(az), math.sin(az), -0.25]) * 0.3)
		b = mk_branch(pts, 0.012 + 0.006 * H, 0.004, rs.random())
		if lod < 2:
			trees.mesh_branch(md, plant, b, 4 if lod == 0 else 3, 1.0 if lod == 0 else 0.7, 3 if lod == 0 else 1)
		cards_along(md, plant, b, regions, rs, s0=0.3 if lod == 0 else 0.45, spacing=spacing * (1.0 + lod * 0.9),
			scale=card_scale * (1.0 + lod * 0.45), up_bias=0.4)
	return md


def juniper(name, lod, rs):
	H, R = 0.45, 1.25
	plant = Plant(name, H, R)
	regions = regions_of("juniper")
	md = vc.MeshData()
	n = 11 if lod == 0 else 7
	for k in range(n):
		az = 2 * math.pi * k / n + rs.normal(0, 0.25)
		L = R * rs.uniform(0.7, 1.05)
		d = np.array([math.cos(az), math.sin(az), 0.18])
		pts = stem(rs, -Z * 0.05, d, L, Z * rs.uniform(0.1, 0.35) * L)
		b = mk_branch(pts, 0.018, 0.005, rs.random())
		if lod == 0:
			trees.mesh_branch(md, plant, b, 3, 0.8, 2)
		s = 0.08 * L
		while s < L:
			p, tn = trees.Tree._branch_at(None, b, s)
			for sd in (-1.0, 1.0):
				if lod > 0 and rs.random() < 0.45:
					continue
				lat = vc.normalize(np.cross(Z, tn))
				dd = vc.normalize(tn * 0.6 + lat * sd * 0.7 + Z * rs.uniform(0.15, 0.6))
				w = vc.normalize(np.cross(Z, dd))
				nn = vc.normalize(np.cross(dd, w))
				if nn[2] < 0:
					nn, w = -nn, -w
				sc = rs.uniform(0.4, 0.62) * (1.0 + 0.4 * lod)
				c = trees.Card(p, dd, w, nn, sc, sc * 0.5, "long" if rs.random() < 0.5 else "short", 0.02,
					0.2, 0.6, b.phase, p[2] / H)
				trees.mesh_card(md, plant, c, regions, segs=1)
			s += rs.uniform(0.13, 0.22) * (1.0 + 0.6 * lod)
	return md


def tuft(name, card_set, lod, rs, height, n_cards, spread):
	"""Crossed vertical cards (grass, sedge) around the origin. UV regions: long, short, tip."""
	plant = Plant(name, height, spread)
	regions = regions_of(card_set)
	md = vc.MeshData()
	n = n_cards if lod == 0 else max(2, n_cards // 2)
	for k in range(n):
		az = math.pi * k / n + rs.normal(0, 0.15)
		w = np.array([math.cos(az), math.sin(az), 0.0])
		lean = rs.normal(0, 0.12, 2)
		d = vc.normalize(np.array([lean[0], lean[1], 1.0]))
		nn = vc.normalize(np.cross(d, w))
		region = "long" if k % 2 == 0 else ("short" if k % 4 == 1 else "tip")
		hgt = height * (1.0 if region == "long" else 0.55) * rs.uniform(0.85, 1.1)
		wid = hgt * 0.5
		base = np.array([rs.normal(0, spread * 0.2), rs.normal(0, spread * 0.2), -0.03])
		row = []
		for y in (0.0, 0.5, 1.0):
			for x in (-0.5, 0.5):
				pos = base + d * (hgt * y) + w * (wid * x)
				u0, v0, u1, v1 = regions[region]["uv"]
				uv = (u0 + (x + 0.5) * (u1 - u0), (1.0 - v1) + y * (v1 - v0))
				ao = 0.45 + 0.55 * y
				nrm = vc.normalize(nn * 0.3 + Z * 0.7 + w * x * 0.4)
				row.append(md.add_vert(pos, nrm, uv, (y, 0.0), (y * y, ao, rs.random(), 0.0)))
		for i in range(2):
			a = row[i * 2:i * 2 + 2]
			b = row[i * 2 + 2:i * 2 + 4]
			md.add_face((a[0], a[1], b[1], b[0]), 1)
	return md


def fern(name, lod, rs):
	plant = Plant(name, 0.55, 0.6)
	regions = regions_of("fern")
	md = vc.MeshData()
	n = 7 if lod == 0 else 4
	for k in range(n):
		az = 2 * math.pi * k / n + rs.normal(0, 0.2)
		dh = np.array([math.cos(az), math.sin(az), 0.0])
		L = rs.uniform(0.55, 0.8)
		w = vc.normalize(np.cross(Z, dh))
		rows = []
		segs = 3 if lod == 0 else 2
		for i in range(segs + 1):
			y = i / segs
			# arching frond: rises then droops, some broken over
			ang = math.radians(rs.uniform(50, 65) - 95 * y ** 1.4)
			pos = dh * (L * 0.55 * math.sin(math.radians(55)) * y) + dh * (L * y * 0.45) * math.cos(ang) \
				+ Z * (L * 0.62 * math.sin(math.pi * 0.5 * y) * (1.0 - 0.45 * y)) - Z * 0.02
			r = []
			for x in (-0.5, 0.5):
				p = pos + w * (L * 0.45 * x * (1.0 - 0.3 * y))
				u0, v0, u1, v1 = regions["long" if k % 3 else "short"]["uv"]
				uv = (u0 + (x + 0.5) * (u1 - u0), (1.0 - v1) + y * (v1 - v0))
				nrm = vc.normalize(Z * 0.8 + dh * 0.3)
				r.append(md.add_vert(p, nrm, uv, (y, 0.0), (y * 0.8, 0.5 + 0.5 * y, rs.random(), 0.0)))
			rows.append(r)
		for i in range(segs):
			md.add_face((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]), 1)
	return md


# ------------------------------------------------------------------------------------------------ deadwood

def log_mesh(name, lod, rs, length, radius, broken_ends, stubs, sink):
	plant = Plant(name, radius * 2, length / 2)
	md = vc.MeshData()
	sides = [10, 7, 5][lod]
	rings = [14, 6, 3][lod]
	xs = np.linspace(-length / 2, length / 2, rings + 1)
	curve = vc.value_noise_1d(vc.seed_of(name, "curve"), 8)
	theta = np.linspace(0, 2 * math.pi, sides + 1)
	ring_ids = []
	for i, x in enumerate(xs):
		u = (x + length / 2) / length
		r = radius * (1.15 - 0.3 * u) * (1.0 + 0.04 * curve(u * 3))
		cy = 0.08 * curve(u * 1.3 + 0.5) * length * 0.05
		cz = r - sink + 0.04 * curve(u * 2.1 + 0.2)
		ring = []
		for j, th in enumerate(theta):
			jj = j % sides
			rr = r * (1.0 + 0.05 * math.sin(3 * theta[jj] + u * 7))
			if broken_ends and (i == 0 or i == rings):
				rr *= rs.uniform(0.75, 1.0)
			p = np.array([x, cy + rr * math.cos(theta[jj]), cz + rr * math.sin(theta[jj])])
			if broken_ends and (i == 0 or i == rings):
				p[0] += rs.uniform(-0.25, 0.25) * radius * 2 * (1 if i else -1)
			nrm = np.array([0.0, math.cos(theta[jj]), math.sin(theta[jj])])
			ao = 0.45 + 0.55 * np.clip((p[2] + 0.05) / (2 * radius), 0, 1)
			ring.append(md.add_vert(p, nrm, (th / (2 * math.pi) * round(2 * math.pi * radius / 0.5) * 0.5, x),
				(0.0, 0.0), (0.0, ao, 0.0, 0.0)))
		ring_ids.append(ring)
	for i in range(rings):
		for j in range(sides):
			a, b = ring_ids[i], ring_ids[i + 1]
			md.add_face((a[j], b[j], b[j + 1], a[j + 1]), 0)
	# end caps (end grain) as a separate material slot 1
	for end in (0, rings):
		ring = ring_ids[end]
		c = np.mean([md.co[k] for k in ring[:-1]], axis=0)
		sgn = -1.0 if end == 0 else 1.0
		cv = md.add_vert(c + np.array([sgn * 0.02, 0, 0]), (sgn, 0, 0), (0.5, 0.5), (0, 0), (0, 0.6, 0, 0))
		cap = []
		for j in range(sides + 1):
			jj = j % sides
			p = np.array(md.co[ring[jj]])
			uv = (0.5 + 0.5 * math.cos(theta[jj]), 0.5 + 0.5 * math.sin(theta[jj]))
			cap.append(md.add_vert(p, (sgn, 0, 0), uv, (0, 0), (0, 0.6, 0, 0)))
		for j in range(sides):
			if end == 0:
				md.add_face((cv, cap[j + 1], cap[j]), 1)
			else:
				md.add_face((cv, cap[j], cap[j + 1]), 1)
	# branch stubs
	if lod == 0 and stubs:
		for k in range(stubs):
			x = rs.uniform(-length * 0.35, length * 0.45)
			az = rs.uniform(0.3, 2.8)
			base = np.array([x, radius * 0.9 * math.cos(az), radius - sink + radius * 0.9 * math.sin(az)])
			d = vc.normalize(np.array([rs.uniform(0.2, 0.6), math.cos(az), math.sin(az)]))
			b = mk_branch(stem(rs, base, d, rs.uniform(0.2, 0.8), np.zeros(3), 3), 0.03, 0.012, 0.0)
			trees.mesh_branch(md, plant, b, 4, 1.0, 1)
	return md


def stump_mesh(name, lod, rs, height, radius, cut):
	plant = Plant(name, height, radius)
	md = vc.MeshData()
	sides = [12, 8, 6][lod]
	rings = [7, 3, 2][lod]
	theta = np.linspace(0, 2 * math.pi, sides + 1)
	lobe = rs.uniform(0, 6.28)
	ring_ids = []
	tops = []
	for i in range(rings + 1):
		z = -0.25 + (height + 0.25) * i / rings
		zz = max(z, 0.0)
		flare = 1.0 + 0.6 * math.exp(-zz / 0.25)
		ring = []
		for j, th in enumerate(theta):
			jj = j % sides
			r = radius * flare * (1.0 + 0.15 * math.exp(-zz / 0.3) * math.cos(5 * theta[jj] + lobe))
			zt = z
			if i == rings and not cut:
				zt = z + rs.uniform(-0.35, 0.25) * height * 0.6
			p = np.array([r * math.cos(theta[jj]), r * math.sin(theta[jj]), zt])
			ao = 0.5 + 0.5 * min(1.0, (z + 0.25) / 0.6)
			ring.append(md.add_vert(p, (math.cos(theta[jj]), math.sin(theta[jj]), 0.15),
				(th / (2 * math.pi) * max(1, round(2 * math.pi * radius / 0.5)) * 0.5, z), (0, 0), (0, ao, 0, 0)))
		ring_ids.append(ring)
	for i in range(rings):
		for j in range(sides):
			a, b = ring_ids[i], ring_ids[i + 1]
			md.add_face((a[j], a[j + 1], b[j + 1], b[j]), 0)
	top = ring_ids[-1]
	c = np.mean([md.co[k] for k in top[:-1]], axis=0)
	if cut:
		c[2] -= 0.01
	else:
		c[2] -= height * 0.15
	cv = md.add_vert(c, (0, 0, 1), (0.5, 0.5), (0, 0), (0, 0.7, 0, 0))
	cap = []
	for j in range(sides + 1):
		jj = j % sides
		p = np.array(md.co[top[jj]])
		cap.append(md.add_vert(p, (0, 0, 1), (0.5 + 0.5 * math.cos(theta[jj]), 0.5 + 0.5 * math.sin(theta[jj])), (0, 0),
			(0, 0.7, 0, 0)))
	for j in range(sides):
		md.add_face((cv, cap[j], cap[j + 1]), 1 if cut else 0)
	return md


PLANTS = {
	"willow_a": dict(section="plants", group="willow", card="willow", bark="bark_pine", H=2.3, R=1.3, harvest="shrub"),
	"alder_a": dict(section="plants", group="alder", card="alder", bark="bark_spruce", H=2.6, R=1.5, harvest="shrub"),
	"juniper_mat": dict(section="plants", group="juniper", card="juniper", bark="bark_spruce", H=0.45, R=1.3, harvest="shrub"),
	"huckleberry_a": dict(section="plants", group="huckleberry", card="huckleberry", bark="bark_pine", H=0.95, R=0.7,
		harvest="berries"),
	"grass_tuft_a": dict(section="groundcover", card="grass", H=0.55, R=0.25),
	"grass_tuft_b": dict(section="groundcover", card="grass", H=0.32, R=0.2),
	"sedge_tuft": dict(section="groundcover", card="sedge", H=0.45, R=0.2),
	"fern_clump": dict(section="groundcover", card="fern", H=0.5, R=0.6),
	"log_a": dict(section="deadwood", bark="bark_spruce", H=0.9, R=4.0, length=8.0, radius=0.24, harvest="log"),
	"log_b": dict(section="deadwood", bark="bark_dead", H=0.7, R=3.2, length=6.4, radius=0.2, harvest="log", moss=0.8),
	"stump_a": dict(section="deadwood", bark="bark_dead", H=0.5, R=0.45, radius=0.26, cut=True, harvest="stump"),
	"stump_b": dict(section="deadwood", bark="bark_dead", H=1.3, R=0.5, radius=0.3, cut=False, harvest="stump", moss=0.5),
}


def build_plant(name):
	p = PLANTS[name]
	lods = []
	for lod in range(3):
		rs = vc.rng("plant", name, lod if name.startswith(("grass", "sedge", "fern")) else 0)
		if name == "willow_a":
			md = shrub(name, "willow", p["bark"], p["H"], p["R"], [14, 10, 7][lod], 0.55, vc.rng("plant", name), 0.55, 0.22, lod)
		elif name == "alder_a":
			md = shrub(name, "alder", p["bark"], p["H"], p["R"], [11, 8, 6][lod], 0.5, vc.rng("plant", name), 0.62, 0.24, lod)
		elif name == "huckleberry_a":
			md = shrub(name, "huckleberry", p["bark"], p["H"], p["R"], [15, 10, 7][lod], 0.35, vc.rng("plant", name), 0.42, 0.13,
				lod)
		elif name == "juniper_mat":
			md = juniper(name, lod, vc.rng("plant", name))
		elif name == "grass_tuft_a":
			md = tuft(name, "grass", lod, rs, p["H"], 6, p["R"])
		elif name == "grass_tuft_b":
			md = tuft(name, "grass", lod, rs, p["H"], 4, p["R"])
		elif name == "sedge_tuft":
			md = tuft(name, "sedge", lod, rs, p["H"], 5, p["R"])
		elif name == "fern_clump":
			md = fern(name, lod, rs)
		elif name.startswith("log"):
			md = log_mesh(name, lod, vc.rng("plant", name), p["length"], p["radius"], True, 9 if name == "log_a" else 4,
				0.05 if name == "log_a" else 0.09)
		else:
			md = stump_mesh(name, lod, vc.rng("plant", name), p["H"], p["radius"], p["cut"])
		lods.append(md)
	return lods


def main():
	import bpy  # noqa: F401
	a = vc.parse_args()
	only = [s for s in a.get("only", "").split(",") if s] or list(PLANTS.keys())
	mp = os.path.join(vc.MODELS_VEG, "vegetation.json")
	data = json.load(open(mp)) if os.path.exists(mp) else {}
	for name in only:
		p = PLANTS[name]
		lods = build_plant(name)
		vc.reset_scene()
		if p["section"] == "deadwood":
			mats = [vc.simple_material(p["bark"], (0.3, 0.3, 0.3, 1)), vc.simple_material("wood_endgrain", (0.5, 0.4, 0.3, 1))]
		elif p["section"] == "groundcover":
			mats = [vc.simple_material("bark_none", (0.3, 0.3, 0.3, 1)), vc.simple_material("cards_" + p["card"], (0.3, 0.3, 0.1, 1))]
		else:
			mats = [vc.simple_material(p["bark"], (0.3, 0.3, 0.3, 1)), vc.simple_material("cards_" + p["card"], (0.3, 0.3, 0.1, 1))]
		objs = [md.to_object(f"LOD{i}", mats) for i, md in enumerate(lods)]
		path = os.path.join(vc.MODELS_VEG, f"{name}.glb")
		vc.export_glb(path, objs)
		vc.write_godot_scene_import(path)
		co = np.array(lods[0].co)
		row = {"path": "res://" + os.path.relpath(path, vc.PROJECT).replace(os.sep, "/"),
			"height": round(float(co[:, 2].max()), 3),
			"radius": round(float(max(np.abs(co[:, 0]).max(), np.abs(co[:, 1]).max())), 3),
			"tris": [md.tri_count() for md in lods], "harvest": p.get("harvest", ""), "bark": p.get("bark", ""),
			"moss": p.get("moss", 0.0)}
		if "group" in p:
			row["group"] = p["group"]
			row["species"] = p["group"]
			row["leaf_tint"] = [1.0, 1.0, 1.0]
			row["transl"] = 0.7
		if p["section"] == "groundcover":
			row["card"] = p["card"]
			row["leaf_tint"] = [1.0, 1.0, 1.0]
			row["transl"] = 0.8
		if p["section"] == "deadwood":
			row["length"] = p.get("length", 0.0)
			row["log_radius"] = p.get("radius", 0.0)
		data.setdefault(p["section"], {})[name] = row
		print(f"[plants] {name}: tris {row['tris']} h={row['height']} r={row['radius']}")
	json.dump(data, open(mp, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
	main()

"""OUT stage: surface masks, normals + AO, MID/FAR stitching, binary assets and data/world_layout.json.

Files (assets/terrain/):
  height.f32     2049^2 float32 LE, index j*2049+i, x = -1536 + 1.5 i, z = -1536 + 1.5 j      (CONTRACT §3)
  masks.bin      1025^2 RGBA8 (3 m): R snow, G rock, B alpine grass / meadow, A forest density
  masks2.bin     1025^2 RGBA8 (3 m): R scree/talus/moraine, G gravel (river bars, outwash), B glacier ice,
                 A wetness (water, shores, seeps)
  normal.png     2049^2 RGBA8: RGB world normal * 0.5 + 0.5 (Y up), A sky visibility (horizon AO)
  detail.png     2049^2 RGBA8: R trail/dirt, G rock band index (strata colour), B crevasse/serac, A cliff band
  mid.f32        1025^2 float32, 6 m, x/z in [-3072, 3072] (the map region equals height.f32 decimated)
  far.f32        1025^2 float32, 48 m, x/z in [-24576, 24576] (the MID region equals mid.f32 decimated)
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage

import design as D
import tlib
from fields import bilinear, blur, slope_deg, smoothstep

N, DX, X0 = 2049, 1.5, -1536.0


def _import_file(png, lossless=False):
	params = {
		"compress/mode": 0 if lossless else 2,
		"compress/high_quality": "true",
		"compress/lossy_quality": 0.7,
		"compress/hdr_compression": 1,
		"compress/normal_map": 2,
		"compress/channel_pack": 0,
		"mipmaps/generate": "true",
		"mipmaps/limit": -1,
		"roughness/mode": 1,
		"roughness/src_normal": '""',
		"process/fix_alpha_border": "false",
		"process/premult_alpha": "false",
		"process/normal_map_invert_y": "false",
		"process/size_limit": 0,
		"detect_3d/compress_to": 0,
	}
	imp = png + ".import"
	uid = None
	if os.path.exists(imp):
		import re
		m = re.search(r'^uid="(uid://[a-z0-9]+)"', open(imp).read(), re.M)
		uid = m.group(1) if m else None
	lines = ["[remap]", "", 'importer="texture"', 'type="CompressedTexture2D"']
	if uid:
		lines.append('uid="%s"' % uid)
	lines += ["", "[params]", ""] + ["%s=%s" % kv for kv in params.items()]
	open(imp, "w").write("\n".join(lines) + "\n")


def normals_world(h, cell):
	gz, gx = np.gradient(h.astype(np.float64), cell)
	n = np.stack([-gx, np.ones_like(gx), -gz], axis=-1)
	n /= np.linalg.norm(n, axis=-1, keepdims=True)
	return n


def down2(a):
	"""2049^2 -> 1025^2 vertex-aligned decimation with a [1 2 1]/4 filter."""
	b = ndimage.convolve1d(a.astype(np.float32), [0.25, 0.5, 0.25], axis=0, mode="nearest")
	b = ndimage.convolve1d(b, [0.25, 0.5, 0.25], axis=1, mode="nearest")
	return b[::2, ::2]


def compute_masks(F, log):
	h = F.h.astype(np.float32)
	X, Z = F.X, F.Z
	n = normals_world(blur(h, 1.0), DX)
	ny = n[..., 1]
	nz = n[..., 2]
	horiz = np.sqrt(np.maximum(1 - ny * ny, 1e-6))
	aspect_n = np.clip(-nz / horiz, -1, 1) * np.clip(horiz * 3.0, 0, 1)      # +1 north-facing
	wind = np.array([0.55, 0.0, -0.83])                                    # blows from SW toward NE
	windward = np.clip(-(n[..., 0] * wind[0] + n[..., 2] * wind[2]) / horiz, -1, 1) * np.clip(horiz * 3, 0, 1)
	slope = slope_deg(blur(h, 0.8), DX)
	slope_s = slope_deg(blur(h, 3.0), DX)
	lap = ndimage.laplace(blur(h, 4.0)) / (DX * DX)                        # + concave
	curv = np.clip(lap * 25.0, -1, 1)
	nz1 = F.noise(1 / 90.0, 4, seed=201)
	nz2 = F.noise(1 / 22.0, 3, seed=202)
	nz3 = F.noise(1 / 400.0, 3, seed=203)
	ice = F.masks["ice"]
	water = F.masks["water"]
	wet0 = F.masks["wet"]
	gravel0 = F.masks.get("gravel", np.zeros_like(h))
	trail = F.masks.get("trail", np.zeros_like(h))
	pad = F.masks.get("pad", np.zeros_like(h))
	moraine = F.masks["moraine"]
	cliffband = F.masks.get("cliffband", np.zeros_like(h))
	rockface = F.masks.get("rockface", np.zeros_like(h))
	deposit = F.masks.get("deposit", np.zeros_like(h))
	ice = ice * (1 - np.clip(pad * 1.5, 0, 1))
	log("   flow accumulation")
	h3 = h[::2, ::2]
	A3 = tlib.flow_mfd(blur(h3, 0.7), 3.0, 1.1) * 9.0
	A = np.repeat(np.repeat(A3, 2, 0), 2, 1)[:N, :N]
	logA = np.log10(np.maximum(A, 1.0))

	# ---- forest (A)
	treeline = D.TREELINE + 70.0 * nz3 - 70.0 * aspect_n + 25.0 * nz1
	f_alt = 1 - smoothstep(treeline - 160.0, treeline + 10.0, h)
	f_low = smoothstep(1290.0, 1330.0, h)
	f_slope = 1 - smoothstep(33.0, 43.0, slope_s)
	# avalanche chutes: concentrated flow on steep forested faces stays open
	chute = smoothstep(3.6, 4.6, logA) * smoothstep(26.0, 34.0, slope_s) * smoothstep(1500.0, 1700.0, h)
	chute = np.clip(blur(chute, 3.5) * 2.2, 0, 1)
	F.masks["chute"] = chute
	patch = smoothstep(-0.35, 0.25, nz1 * 0.7 + nz2 * 0.3 + 0.12)
	clear = np.zeros_like(h)
	for cx, cz, r in ((-520, 820, 120), (-900, 260, 45), (420, 520, 45), (820, -80, 70), (-760, -260, 32)):
		wob = 1 + 0.25 * nz1
		clear = np.maximum(clear, 1 - smoothstep(r * 0.7, r * 1.25, np.hypot(X - cx, Z - cz) / wob))
	near_water = np.clip(1 - F.masks.get("lake_shore_d", np.full_like(h, 99.0)) / 14.0, 0, 1) * (water < 0.5)
	forest = f_alt * f_low * f_slope * patch
	forest *= (1 - chute) * (1 - clear * 0.95) * (1 - np.clip(gravel0 * 1.5, 0, 1)) * (1 - water)
	forest *= (1 - np.clip(wet0 * 1.3, 0, 1)) * (1 - ice) * (1 - moraine) * (1 - near_water)
	forest *= (1 - np.clip(trail * 0.6 + pad, 0, 1))
	forest = np.clip(blur(forest, 1.2) * 1.15, 0, 1)

	# ---- rock (G)
	rock = smoothstep(36.0, 50.0, slope) * 0.85 + cliffband * 0.6 + rockface
	ridge = np.clip(-curv, 0, 1) * smoothstep(2200.0, 2700.0, h) * smoothstep(22.0, 36.0, slope)
	rock = rock + ridge * 0.5 + smoothstep(2450.0, 2800.0, h) * smoothstep(28.0, 40.0, slope) * 0.4
	rock = rock * (1 - ice) * (1 - water) * (1 - np.clip(deposit * 1.5, 0, 1) * 0.7)
	rock = np.clip(rock, 0, 1)

	# ---- snow (R): late October, snowline ~1,800 m, lower on shady north aspects, wind scoured ridges
	line = D.SNOWLINE + 60.0 * nz3 - 150.0 * aspect_n + 30.0 * nz1
	s_alt = smoothstep(line - 130.0, line + 200.0, h)
	s_slope = 1 - smoothstep(40.0, 56.0, slope)
	s_curv = 1 + 0.35 * np.clip(curv, -1, 1)
	wind_scour = np.clip(windward, 0, 1) * smoothstep(2500.0, 3000.0, h) * 0.45
	lee = np.clip(-windward, 0, 1) * smoothstep(2300.0, 2800.0, h) * 0.25
	snow = s_alt * s_slope * s_curv * (1 - wind_scour) + lee * s_slope
	dust = smoothstep(1550.0, 1800.0, h) * np.clip(aspect_n, 0, 1) * 0.35 * s_slope     # shaded dusting below
	snow = np.maximum(snow, dust)
	snow = snow * (1 - 0.45 * forest * (h < 2150))
	snow = np.where(ice > 0.5, np.maximum(snow, np.interp(h, [2400, 2600, 2800], [0.55, 0.8, 1.0])), snow)
	snow = snow * (1 - water) * (1 - F.masks.get("crevasse", np.zeros_like(h)) * 0.8)
	snow = np.clip(blur(snow, 0.8) + (nz2 * 0.12) * s_alt, 0, 1)

	# ---- grass / meadow (B)
	g_alt = 1 - smoothstep(2380.0, 2560.0, h)
	g_slope = 1 - smoothstep(30.0, 40.0, slope_s)
	grass = g_alt * g_slope * (1 - forest) * (1 - rock) * (1 - water)
	grass = grass * (1 - np.clip(gravel0 * 1.4, 0, 1)) * (1 - moraine * 0.8) * (1 - ice)
	grass = np.maximum(grass, chute * g_alt * 0.8)
	grass = np.clip(grass, 0, 1)

	# ---- scree (masks2 R): talus below cliffs, deposits, moraines, high debris slopes
	cliffs_near = blur(np.maximum(rock * smoothstep(40.0, 55.0, slope), cliffband), 6.0)
	scree = cliffs_near * smoothstep(24.0, 31.0, slope) * (1 - smoothstep(42.0, 50.0, slope)) * 1.6
	scree = scree + deposit * 0.8 + moraine * 0.9 + smoothstep(2300.0, 2600.0, h) * (1 - forest) * 0.35 * (1 - rock)
	scree = np.clip(scree * (1 - ice) * (1 - water) * (1 - forest * 0.9), 0, 1)

	# ---- gravel (G), wetness (A)
	gravel = np.clip(gravel0 + moraine * 0.35 * (h < 2500), 0, 1) * (1 - ice)
	seep = smoothstep(4.2, 5.4, logA) * (1 - smoothstep(12.0, 25.0, slope_s))
	wet = np.clip(np.maximum(wet0, seep * 0.6), 0, 1)

	masks = np.stack([snow, rock, grass, forest], axis=-1)
	masks2 = np.stack([scree, gravel, ice, wet], axis=-1)
	return masks.astype(np.float32), masks2.astype(np.float32), dict(A=A, curv=curv)


def to_u8(a):
	return np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)


def stitch(inner, inner_x0, inner_dx, outer, outer_x0, outer_dx, band=450.0):
	"""Insert `inner` (decimated) into `outer` and blend the outer grid toward the inner edge values
	over `band` metres outside the inner region, so the grids meet without steps."""
	step = int(round(outer_dx / inner_dx))
	sub = inner[::step, ::step]
	i0 = int(round((inner_x0 - outer_x0) / outer_dx))
	n = sub.shape[0]
	out = outer.astype(np.float64).copy()
	No = outer.shape[0]
	c = outer_x0 + np.arange(No) * outer_dx
	Xo, Zo = np.meshgrid(c, c)
	lo, hi = inner_x0, inner_x0 + (inner.shape[0] - 1) * inner_dx
	cx = np.clip(Xo, lo, hi)
	cz = np.clip(Zo, lo, hi)
	d = np.hypot(Xo - cx, Zo - cz)
	edge_inner = bilinear(inner, inner_x0, inner_dx, cx, cz)
	edge_outer = bilinear(outer, outer_x0, outer_dx, cx, cz)
	corr = (edge_inner - edge_outer) * (1 - smoothstep(0.0, band, d))
	out = out + np.where(d > 0, corr, 0.0)
	out[i0:i0 + n, i0:i0 + n] = sub
	return out.astype(np.float32)


def write_all(F, mid, far, root, layout_path, log, seed, preview_dir=None):
	assets = os.path.join(root, "assets", "terrain")
	os.makedirs(assets, exist_ok=True)
	h = F.h.astype(np.float32)
	log("OUT: masks")
	masks, masks2, extra = compute_masks(F, log)
	log("OUT: normals + AO")
	n = normals_world(h, DX)
	ao = tlib.horizon_ao(h, DX, 12, 420.0, 1.25)
	ao = np.clip(ao, 0, 1)
	nrm = np.concatenate([n * 0.5 + 0.5, ao[..., None]], axis=-1)
	Image.fromarray(to_u8(nrm), "RGBA").save(os.path.join(assets, "normal.png"), optimize=True)
	_import_file(os.path.join(assets, "normal.png"))
	strata = F.masks.get("cliffband", np.zeros_like(h))
	band_idx = (np.floor((h + 0.105 * F.X - 0.07 * F.Z) / 37.0) * 0.618) % 1.0
	det = np.stack([F.masks.get("trail", np.zeros_like(h)) * (1 - F.masks["water"]), band_idx.astype(np.float32),
					F.masks.get("crevasse", np.zeros_like(h)), strata], axis=-1)
	Image.fromarray(to_u8(det), "RGBA").save(os.path.join(assets, "detail.png"), optimize=True)
	_import_file(os.path.join(assets, "detail.png"))
	m1 = down2(masks[..., 0]), down2(masks[..., 1]), down2(masks[..., 2]), down2(masks[..., 3])
	m2 = down2(masks2[..., 0]), down2(masks2[..., 1]), down2(masks2[..., 2]), down2(masks2[..., 3])
	to_u8(np.stack(m1, -1)).tofile(os.path.join(assets, "masks.bin"))
	to_u8(np.stack(m2, -1)).tofile(os.path.join(assets, "masks2.bin"))
	h.astype("<f4").tofile(os.path.join(assets, "height.f32"))
	log("OUT: stitch MID / FAR")
	mid2 = stitch(h, X0, DX, mid, -3072.0, 6.0, band=500.0)
	far2 = stitch(mid2, -3072.0, 6.0, far, -24576.0, 48.0, band=2500.0)
	mid2.astype("<f4").tofile(os.path.join(assets, "mid.f32"))
	far2.astype("<f4").tofile(os.path.join(assets, "far.f32"))
	log("OUT: layout")
	layout = build_layout(F, h, masks, masks2, seed)
	with open(layout_path, "w") as f:
		json.dump(layout, f, indent=1)
	if preview_dir:
		import preview
		preview.render(h, DX, os.path.join(preview_dir, "out_map.png"), 1024, water=F.masks["water"],
					   masks=masks)
		np.save(os.path.join(os.path.dirname(__file__), "_cache", "masks_prev.npy"), masks)
		preview.views(h, X0, DX, os.path.join(preview_dir, "out"), masks=masks)
	sizes = {f: os.path.getsize(os.path.join(assets, f)) for f in os.listdir(assets) if not f.endswith(".import")}
	log("OUT: sizes MB " + ", ".join("%s %.1f" % (k, v / 1e6) for k, v in sorted(sizes.items())) +
		"  total %.1f" % (sum(sizes.values()) / 1e6))
	return layout


def build_layout(F, h, masks, masks2, seed):
	def H(x, z):
		return float(bilinear(h, X0, DX, x, z))

	pois = []
	for p in D.POIS:
		y = p["y"] if p["y"] is not None else H(p["x"], p["z"])
		if p.get("water"):
			y = D.LOON_LAKE["level"]
		q = dict(id=p["id"], name=p["name"], x=p["x"], y=round(y, 2), z=p["z"], radius=p["radius"],
				 flat_radius=p["flat_radius"], zone=p["zone"])
		for k in ("adit", "entrance"):
			if k in p:
				e = dict(p[k])
				e["y"] = round(H(e["x"], e["z"]), 2) if k != "adit" else p["y"]
				q[k] = e
		pois.append(q)
	# spawn: on the crash-site pad, 14 m SW of the wreck, facing it
	c = D.POI["crash_site"]
	sx, sz = c["x"] - 10.0, c["z"] + 10.0
	yaw = math.degrees(math.atan2(-(c["x"] - sx), -(c["z"] - sz)))
	spawn = dict(x=sx, y=round(H(sx, sz), 2), z=sz, yaw=round(yaw, 1), facing="crash_site")
	holes = [dict(h_) for h_ in D.HOLES]
	return dict(
		version=1,
		generator="tools/terrain/gen_terrain.py",
		seed=seed,
		map=dict(size=N, cell=DX, origin=[X0, X0], world_size=3072.0, min_height=round(float(h.min()), 2),
				 max_height=round(float(h.max()), 2),
				 files=dict(height="res://assets/terrain/height.f32", normal="res://assets/terrain/normal.png",
							masks="res://assets/terrain/masks.bin", masks2="res://assets/terrain/masks2.bin",
							detail="res://assets/terrain/detail.png"),
				 mid=dict(file="res://assets/terrain/mid.f32", size=1025, cell=6.0, origin=[-3072.0, -3072.0]),
				 far=dict(file="res://assets/terrain/far.f32", size=1025, cell=48.0, origin=[-24576.0, -24576.0]),
				 masks=dict(size=1025, cell=3.0, channels=["snow", "rock", "grass", "forest"]),
				 masks2=dict(size=1025, cell=3.0, channels=["scree", "gravel", "ice", "wet"])),
		pois=pois,
		lakes=F.lakes_out,
		rivers=F.rivers_out,
		trails=F.trails_out,
		golden_path=["crash_site", "ranger_cabin", "ashford_mine", "owens_bivouac", "glacier_camp", "icefall",
					 "kestrel_station", "summit"],
		spawn=spawn,
		zones=[dict(id=z["id"], name=z["name"], biome=z["biome"], polygon=[list(map(float, p)) for p in z["polygon"]])
			   for z in D.ZONES],
		biomes=dict(bands=[[b, t] for b, t in D.BIOME_BANDS], treeline=D.TREELINE, snowline=D.SNOWLINE),
		holes=holes,
	)

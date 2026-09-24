#!/usr/bin/env python3
"""THIN AIR — terrain layer generator (9 seamless PBR layers + packed Texture2DArray sources).

Layer order is FIXED (the terrain shader indexes by it):
  0 snow  1 rock  2 cliff  3 scree  4 gravel  5 grass  6 forest  7 dirt  8 ice

Outputs (thin-air/assets/textures/terrain/):
  <name>_albedo.png   sRGB, AO partially baked (terrain has no AO map)
  <name>_normal.png   OpenGL / Y+ tangent space, derived from the height field in metres (Sobel)
  <name>_roughness.png
  <name>_height.png   0..1 normalised over the layer's own relief (height_range_m in layers.json)
  terrain_albedo_height.png  1024 x 9216 (RGB albedo + A height), slices vertical = 9
  terrain_normal_rough.png   1024 x 9216 (RGB normal + A roughness)
  terrain_macro_noise.png    512² periodic macro variation (R 1 cycle, G 3 cycles, B 9 cycles per tile)
  layers.json

Usage:  python3 gen_terrain.py [--only snow,rock] [--preview] [--no-write] [--size 1024]
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as tl  # noqa: E402
import common as cm  # noqa: E402
import terrain_ground as tg  # noqa: E402
import godot_import as gi  # noqa: E402

OUT = os.path.join(cm.TEX_DIR, "terrain")

LAYERS = ["snow", "rock", "cliff", "scree", "gravel", "grass", "forest", "dirt", "ice"]
TILING_M = {"snow": 6.0, "rock": 4.0, "cliff": 8.0, "scree": 4.0, "gravel": 2.0, "grass": 3.0,
            "forest": 2.5, "dirt": 3.0, "ice": 6.0}


# =============================================================================================
# 0 SNOW — wind-packed alpine snow: dunes + sastrugi with slip faces, ripples, crust, sparkle
# =============================================================================================
def layer_snow(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	wx = tl.spectral(S, r, 1, 5, 1.5) * t.px(0.30)
	wy = tl.spectral(S, r, 1, 5, 1.5) * t.px(0.30)
	macro = tl.spectral(S, r, 1, 5, 1.6) * 0.022
	# drifts: anisotropic crests elongated along the wind (+x), with downwind slip faces
	s1 = tl.warp(tl.spectral(S, r, 3, 22, 1.4, stretch=3.0, angle=0.12), wx, wy)
	s1 = np.maximum(s1, -0.8) * 0.020
	s1 = tl.asym_dilate(s1, t.texel_m, 0.18, 0.35, axis=1, steps=20)
	# sastrugi: sharper, smaller erosional ridges, strength varies over the tile
	s2 = tl.warp(tl.spectral(S, r, 10, 45, 1.1, stretch=4.0, angle=0.08), wx * 0.7, wy * 0.7)
	s2 = tl.ridged(s2, 0.4) * 0.010
	s2 = tl.asym_dilate(s2, t.texel_m, 0.35, 0.12, axis=1, steps=12)
	smask = tl.smoothstep(-0.6, 1.0, tl.spectral(S, r, 1, 4, 1.4))
	# wind ripples (6–12 cm), perpendicular to wind, strongest in the lee of drifts
	rip = tl.warp(tl.spectral(S, r, 50, 100, 0.3, stretch=3.0, angle=math.pi / 2 + 0.12), wx * 0.4, wy * 0.4)
	rip = np.tanh(rip * 1.2) * 0.0012
	ripmask = tl.smoothstep(-0.3, 0.9, tl.spectral(S, r, 2, 8, 1.2)) * (1 - 0.5 * smask)
	# ablation scallops / pock-marks, snow grain
	scal = -np.maximum(tl.spectral(S, r, 25, 70, 0.6), 1.2) * 0.0015
	grain = tl.spectral(S, r, 220, 512, 0.0) * 0.00012
	height = macro + s1 + s2 * smask + rip * ripmask + scal + grain
	# albedo: slightly blue-white; wind crust a touch greyer; hollows slightly bluer (SSS read)
	col = tl.fill(S, tl.rgb(230, 234, 240))
	col *= np.exp(0.015 * tl.spectral(S, r, 1, 12, 1.2))[..., None]
	crust = tl.smoothstep(0.0, 1.0, tl.spectral(S, r, 2, 10, 1.3)) * smask
	col = tl.mix3(col, tl.rgb(218, 224, 233), crust * 0.5)
	hollow = tl.smoothstep(0.0, 0.004, tl.cavity(height, t.px(0.10)))
	col = tl.mix3(col, tl.rgb(208, 219, 236), hollow * 0.35)
	grit = (r.random(S) < 0.00025) * (0.3 + 0.7 * r.random(S))
	grit = tl.gauss(grit.astype(float), 0.6) * 4.0
	col = tl.mix3(col, tl.rgb(100, 95, 88), np.clip(grit, 0, 0.6))
	# roughness: powder 0.74, polished crust ~0.6; sparkle = sparse near-mirror crystal facets
	rough = 0.74 - 0.13 * crust + 0.03 * tl.spectral(S, r, 20, 200, 0.5)
	sparkle = r.random(S) < 0.02
	rough = np.where(sparkle, 0.08 + 0.10 * r.random(S), rough)
	tx = np.where(sparkle, (r.random(S) - 0.5) * 1.0, 0.0)
	ty = np.where(sparkle, (r.random(S) - 0.5) * 1.0, 0.0)
	return dict(albedo=col, height=height, rough=rough, tilt=(tx, ty), ao_bake=0.2, ao_radius=0.3,
	            albedo_target=0.80)


# =============================================================================================
# 1 ROCK — grey granite outcrop: joint sets with stepped slabs, exfoliation, grain, lichen
# =============================================================================================
def layer_rock(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	wrp = tl.spectral(S, r, 1, 10, 1.5) * 0.012
	# glacially smoothed bulges (roche moutonnée), 1–2 m scale
	height = tl.spectral(S, r, 1, 5, 1.6) * 0.05
	crack = np.zeros(S)
	edge_round = np.zeros(S)
	# one long master joint (wraps as a rational line, heavily wiggled so it does not read as a ruled line)
	jag = tl.spectral(S, r, 3, 24, 1.4) * 0.010 + tl.spectral(S, r, 40, 160, 1.0) * 0.0008
	dist, near, ramp, slab = tl.line_family(S, 1, 2, r.random(1), wrp + jag)
	d_m = dist * t.tile_w_m
	vis = tl.smoothstep(-0.9, 0.2, tl.spectral(S, r, 1, 4, 1.5))
	ww = 0.016 * (0.3 + 1.2 * tl.norm01(tl.spectral(S, r, 3, 24, 1.0)) ** 1.5)
	crack = np.maximum(crack, (1.0 - tl.smoothstep(ww * 0.4, ww, d_m)) * vis)
	height += (ramp - 0.5) * 0.05 * vis
	edge_round = np.maximum(edge_round, (1.0 - tl.smoothstep(0.0, 0.12, d_m)) * vis)
	# polygonal cooling/unloading joints (periodic Voronoi borders): only some borders are open, they meet at
	# T/Y junctions and terminate, and each block sits a few cm higher/lower than its neighbours
	for (cells, open_p, width, step, salt) in ((9, 0.45, 0.012, 0.025, 3), (32, 0.14, 0.005, 0.006, 5)):
		jx = tl.spectral(S, r, 2, 10, 1.4) * t.px(0.10) + tl.spectral(S, r, 20, 120, 1.0) * t.px(0.004)
		jy = tl.spectral(S, r, 2, 10, 1.4) * t.px(0.10) + tl.spectral(S, r, 20, 120, 1.0) * t.px(0.004)
		v = tl.worley(S, r, cells, k=2, sx=1.5, dx=jx, dy=jy)       # blocks elongated along the joint set
		d_m = v.edge * 0.5 * t.tile_w_m
		open_ = (tl.edge_pair_rand(v, salt) < open_p).astype(float)
		open_ = tl.gauss(open_, t.px(0.04))                      # joints taper out instead of stopping dead
		ww = width * (0.3 + 1.4 * tl.norm01(tl.spectral(S, r, 4, 40, 1.0)) ** 1.6)
		c = (1.0 - tl.smoothstep(ww * 0.4, ww, d_m)) * open_
		crack = np.maximum(crack, c)
		off = tl.gauss(r.normal(0, step, v.count)[v.cell], t.px(0.02))
		height += off
		edge_round = np.maximum(edge_round, (1.0 - tl.smoothstep(0.0, 0.10, d_m)) * open_)
	height -= edge_round ** 2 * 0.03 + crack * 0.05
	# exfoliation: thin sheets spalled off, leaving fresher stepped scars
	ex = tl.warp(tl.spectral(S, r, 2, 24, 1.3), *(tl.spectral(S, r, 4, 40, 1.2) * t.px(0.05) for _ in range(2)))
	scar = tl.smoothstep(0.85, 0.95, ex)
	scar2 = tl.smoothstep(1.35, 1.45, ex)
	height -= (scar + scar2) * 0.004
	# surface: weathered granular relief + pits
	height += tl.spectral(S, r, 2, 150, 1.4) * 0.008
	pits = tl.worley(S, r, 1500, k=1)
	pit = (1 - tl.smoothstep(0.0, 0.004, pits.f1)) * (r.random(pits.count)[pits.cell] < 0.35)
	height -= pit * 0.0012
	gcol, gmicro, mineral = cm.granite_grain(t, grain_m=0.0055, weather=0.45)
	height += gmicro * 0.0005
	# --- albedo
	col = gcol * 0.88 * np.exp(0.07 * tl.spectral(S, r, 1, 10, 1.3))[..., None]
	# fresh scars: less weathered (more speckle contrast, lighter)
	col = tl.mix3(col, gcol * 1.12, np.clip(scar + scar2, 0, 1) * 0.6)
	# weathering: faint iron staining + grey-black water tracks along joints
	stain = tl.smoothstep(0.5, 1.8, tl.spectral(S, r, 2, 16, 1.2))
	col = tl.mix3(col, tl.rgb(150, 132, 108), stain * 0.25)
	# dark organic/lichen staining seeping from the joints (dry, not wet: no roughness change)
	wet = tl.gauss(edge_round, t.px(0.03)) * tl.smoothstep(-0.3, 0.8, tl.spectral(S, r, 2, 12, 1.2))
	col = tl.mix3(col, tl.rgb(84, 80, 72), np.clip(wet, 0, 1) * 0.35)
	dark = tl.smoothstep(0.6, 1.8, tl.spectral(S, r, 2, 24, 1.1))
	col = tl.mix3(col, tl.rgb(92, 92, 90), dark * 0.3)
	# soil, grit and moss in cracks
	col = tl.mix3(col, tl.rgb(50, 44, 36), crack * 0.9)
	moss = crack * tl.smoothstep(0.0, 1.0, tl.spectral(S, r, 6, 40, 1.0))
	col = tl.mix3(col, tl.rgb(72, 78, 42), moss * 0.55)
	# lichen colonies — clustered, avoid fresh scars and cracks
	# pale crustose lichen mottling (large, low contrast) then discrete colonies
	mott = tl.smoothstep(0.2, 1.2, tl.warp(tl.spectral(S, r, 3, 40, 1.1), *(tl.spectral(S, r, 6, 60, 1.0) * 6 for _ in range(2))))
	col = tl.mix3(col, tl.rgb(176, 178, 170), mott * 0.35)
	mott_d = tl.smoothstep(0.5, 1.4, tl.spectral(S, r, 4, 50, 1.0))
	col = tl.mix3(col, tl.rgb(80, 78, 74), mott_d * 0.35)
	la, lcol, lrim, lsp = cm.lichen_colonies(t, coverage=0.30, mean_r_m=0.035,
	                                         mask=(1 - crack) * (1 - 0.9 * np.clip(scar + scar2, 0, 1)))
	col = tl.mix3(col, lcol, la * 0.9)
	col = tl.mix3(col, cm.LICHEN_PROTHALLUS, lrim * (lsp == 0) * 0.7)
	height += la * 0.0006
	rough = 0.80 + 0.04 * tl.spectral(S, r, 10, 200, 0.6)
	rough = np.where(mineral == 2, rough - 0.12, rough)
	rough = rough * (1 - la) + 0.88 * la
	rough = np.maximum(rough, crack * 0.95)
	return dict(albedo=col, height=height, rough=rough, ao_bake=0.45, ao_radius=0.12, albedo_target=0.26)


# =============================================================================================
# 2 CLIFF — dark fractured rock for steep faces: multi-scale planar facets, ledges, streaks
#           (image up = world up; streaks run down the image)
# =============================================================================================
def layer_cliff(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	wx = tl.spectral(S, r, 2, 12, 1.5) * px(0.05)
	wy = tl.spectral(S, r, 2, 12, 1.5) * px(0.05)
	# --- fractured relief: continuous facet envelopes (ridges + valleys, no stepped seams) at two scales
	f1 = tl.facet_envelope(S, r, 60, 0.25, 0.35, t.tile_w_m, sy=1.6, dx=wx, dy=wy, mode="max")
	f2 = tl.facet_envelope(S, r, 380, 0.25, 0.30, t.tile_w_m, sy=1.3, dx=wx, dy=wy, mode="min")
	f2 = tl.gauss(f2, 1.6)
	height = (f1 - f1.mean()) * 0.8 + (f2 - f2.mean()) * 0.45
	# bedding: soft terraces -> ledges with steep risers and leaning tops (image up = world up)
	yy, xx = t.grid()
	bed = yy * 7 + tl.spectral(S, r, 1, 5, 1.6) * 0.35 + 0.15 * np.sin(2 * np.pi * (xx + r.random()))
	fr = bed % 1.0
	terr = tl.smoothstep(0.0, 0.18, fr) * 0.07 - fr * 0.07       # ~7 cm step per band, sloping face
	bstrength = tl.smoothstep(-0.8, 0.6, tl.spectral(S, r, 1, 4, 1.5))
	height += terr * bstrength
	ledge_top = (1 - tl.smoothstep(0.0, 0.06, fr)) * bstrength
	# master joints: a few sub-vertical fractures, open and shadowed, plus one oblique set
	joint = np.zeros(S)
	for (p, q, n_l, width, step) in ((1, 0, 3, 0.03, 0.08), (1, 3, 1, 0.018, 0.04)):
		wig = tl.spectral(S, r, 2, 24, 1.5) * 0.008
		dist, near, ramp, slab = tl.line_family(S, p, q, r.random(n_l), wig)
		vis = tl.smoothstep(-0.2, 0.6, tl.spectral(S, r, 1, 5, 1.4))
		d_m = dist * t.tile_w_m
		ww = width * (0.3 + 1.2 * tl.norm01(tl.spectral(S, r, 3, 20, 1.2)) ** 2)
		joint = np.maximum(joint, (1.0 - tl.smoothstep(ww * 0.3, ww, d_m)) * vis)
		height += ramp * r.normal(0, step, n_l)[slab] * vis
	height -= joint * 0.1
	# rough rock skin
	height += tl.ridged(tl.warp(tl.spectral(S, r, 8, 80, 1.1), wx, wy), 0.6) * 0.012
	height += tl.spectral(S, r, 40, 450, 0.9) * 0.0025
	# --- albedo: dark grey metasediment with subtle warm/cool drift
	col = tl.fill(S, tl.rgb(100, 98, 94))
	warm = tl.spectral(S, r, 1, 6, 1.4)
	col = tl.mix3(col, col * np.array([1.07, 1.0, 0.92]), tl.smoothstep(0.0, 1.5, warm) * 0.7)
	col = tl.mix3(col, col * np.array([0.95, 1.01, 1.02]), tl.smoothstep(0.0, 1.5, -warm) * 0.7)
	col *= np.exp(0.06 * tl.spectral(S, r, 2, 40, 1.2) + 0.08 * tl.spectral(S, r, 150, 512, 0.2))[..., None]
	vein = tl.line_family(S, 1, 3, r.random(2), tl.spectral(S, r, 2, 20, 1.4) * 0.03)[0] * t.tile_w_m
	vein = (1 - tl.smoothstep(0.0, 0.01, vein)) * tl.patches(S, r, 1, 6, 0.4, 0.4)
	col = tl.mix3(col, tl.rgb(178, 176, 170), vein * 0.55)
	# fresh fracture scars on steep facets
	gx, gy = tl.grad(height, t.texel_m)
	fresh = tl.patches(S, r, 2, 16, 0.15, 0.3) * tl.smoothstep(0.2, 0.7, np.hypot(gx, gy))
	col = tl.mix3(col, tl.rgb(138, 138, 136), fresh * 0.4)
	# ledge tops: paler (dust, lichen); water/varnish streaks below ledges and joints
	col = tl.mix3(col, tl.rgb(132, 128, 120), ledge_top * 0.4)
	src = (ledge_top * 0.9 + joint * 0.5) * tl.patches(S, r, 4, 40, 0.5, 0.5)
	streak = tl.blur_dir(src, px(1.6), angle=math.pi / 2, taps=56, decay=2.6)
	streak = np.clip(tl.gauss_aniso(streak, 1.0, 2.2) * 1.8, 0, 1)
	varn = tl.patches(S, r, 3, 40, 0.3, 0.5, stretch=8, angle=math.pi / 2)
	col = tl.mix3(col, tl.rgb(46, 43, 40), np.clip(streak * 0.5 + varn * 0.22, 0, 0.7))
	rust = tl.blur_dir(tl.patches(S, r, 10, 80, 0.004, 0.2), px(1.0), math.pi / 2, 30, 1.5)
	col = tl.mix3(col, tl.rgb(122, 82, 52), np.clip(rust * 6, 0, 1) * 0.35)
	la, lcol, lrim, lsp = cm.lichen_colonies(t, coverage=0.07, mean_r_m=0.05, species_w=(0.2, 0.01, 0.3, 0.49),
	                                         mask=(1 - joint))
	col = tl.mix3(col, lcol, la * 0.65)
	col = tl.mix3(col, cm.LICHEN_PROTHALLUS, lrim * (lsp == 0) * 0.6)
	col = tl.mix3(col, tl.rgb(52, 48, 44), joint * 0.45)
	rough = 0.82 + 0.04 * tl.spectral(S, r, 10, 200, 0.5) - streak * 0.15 - fresh * 0.05
	rough = rough * (1 - la) + 0.9 * la
	return dict(albedo=col, height=height, rough=rough, ao_bake=0.55, ao_radius=0.3, albedo_target=0.12)


# =============================================================================================
# 8 ICE — bare glacier ice: ablation scallops, foliation & dirt bands, cracks, cryoconite holes
# =============================================================================================
def layer_ice(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	wx = tl.spectral(S, r, 1, 6, 1.5) * t.px(0.25)
	wy = tl.spectral(S, r, 1, 6, 1.5) * t.px(0.25)
	# melt surface: smooth irregular ablation hollows + meltwater runnels (downslope = +row)
	hol = tl.warp(tl.spectral(S, r, 4, 30, 1.4), wx * 0.4, wy * 0.4)
	runnel = tl.ridged(tl.warp(tl.spectral(S, r, 6, 40, 1.1, stretch=4.0, angle=math.pi / 2), wx, wy), 1.2)
	macro = tl.spectral(S, r, 1, 4, 1.6) * 0.02
	height = macro + hol * 0.012 - runnel * 0.006
	cup = tl.smoothstep(-1.2, 1.2, hol)                           # 0 in hollows .. 1 on humps
	# foliation: gently folded bands across the flow
	yy, xx = t.grid()
	fol = yy + tl.spectral(S, r, 1, 3, 1.6) * 0.02 + 0.015 * np.sin(2 * np.pi * (xx + r.random()))
	band = np.zeros(S)
	for k, a in ((5, 1.0), (11, 0.7), (23, 0.5), (47, 0.3)):
		band += a * np.sin(2 * np.pi * (k * fol + r.random()))
	band = tl.warp(band, wx * 0.2, wy * 0.2) + 0.6 * tl.spectral(S, r, 8, 60, 1.0)
	blue = tl.smoothstep(0.6, 1.8, band)                      # bubble-poor blue ice bands
	dirt = tl.smoothstep(1.3, 2.4, -band) * tl.smoothstep(-0.6, 0.8, tl.spectral(S, r, 3, 30, 1.2))
	# weathering crust: granular white rind on humps, thin/absent in wet hollows
	crust = tl.smoothstep(0.25, 1.05, cup + 0.22 * tl.spectral(S, r, 6, 60, 1.2)) * (1 - blue * 0.5)
	gran = tl.worley(S, r, 30000, k=2)
	granules = tl.smoothstep(0.0, 0.003, gran.edge) * 0.0012
	height += crust * (granules + tl.spectral(S, r, 120, 512, 0.3) * 0.0004) + tl.spectral(S, r, 20, 200, 1.2) * 0.001
	# cracks: a couple of long fractures + hairline network
	crk = np.zeros(S)
	for (p, q, nl, w) in ((1, 3, 2, 0.006), (2, 1, 1, 0.004)):
		d_, _, _, _ = tl.line_family(S, p, q, r.random(nl), tl.spectral(S, r, 2, 24, 1.4) * 0.016)
		vis = tl.smoothstep(0.0, 0.8, tl.spectral(S, r, 1, 5, 1.5))
		crk = np.maximum(crk, (1 - tl.smoothstep(0.0, w, d_ * t.tile_w_m)) * vis)
	height -= crk * 0.015
	# cryoconite holes: small round water-filled pits with dark sediment, favouring dirty bands
	holes = tl.worley(S, r, 500, k=1, dx=wx * 0.2, dy=wy * 0.2)
	hr = 0.005 + 0.018 * r.random(holes.count) ** 2
	hd = holes.f1 * t.tile_w_m / hr[holes.cell]
	keep = r.random(holes.count)[holes.cell] < (0.08 + 0.5 * dirt)
	hole = (1 - tl.smoothstep(0.75, 1.0, hd)) * keep
	height -= hole * 0.015
	# --- albedo
	white = tl.rgb(210, 220, 226)
	blue_c = tl.rgb(118, 158, 184)
	col = tl.fill(S, white)
	# bare (crust-free) ice shows the deeper blue; blue bands bluer still
	clear = (1 - crust) * 0.75 + blue * 0.4
	col = tl.mix3(col, blue_c, np.clip(clear, 0, 1) * 0.8)
	# bubble-rich foliation streaks inside the clear ice
	streaks = tl.smoothstep(0.8, 2.2, tl.spectral(S, r, 20, 200, 0.8, stretch=5.0, angle=0.05) + band * 0.3)
	col = tl.mix3(col, tl.rgb(190, 208, 218), streaks * (1 - crust) * 0.5)
	col = tl.mix3(col, tl.rgb(232, 236, 238), crust * granules / 0.0012 * 0.3)
	col *= np.exp(0.03 * tl.spectral(S, r, 3, 60, 1.1))[..., None]
	# dispersed fine grit (every glacier surface is dusty) + debris bands, collecting in runnels/hollows
	grit = tl.smoothstep(0.3, 2.0, tl.spectral(S, r, 60, 500, 0.3)) * (0.25 + 0.75 * dirt + 0.4 * (1 - cup))
	col = tl.mix3(col, tl.rgb(112, 106, 96), np.clip(dirt * 0.35 + grit * 0.35 + runnel * 0.15, 0, 0.7))
	# bubbles: tiny bright specks in clearer ice
	bdens = tl.smoothstep(0.3, 1.6, tl.spectral(S, r, 6, 40, 1.0, stretch=3.0, angle=0.05) + band * 0.3)
	bub = (r.random(S) < 0.0025 * bdens) * (1 - crust)
	col = tl.mix3(col, tl.rgb(226, 232, 236), np.clip(tl.gauss(bub.astype(float), 0.6) * 1.6, 0, 0.8))
	# cracks: white fractured planes with dark cores; cryoconite: black-brown sediment under water
	col = tl.mix3(col, tl.rgb(232, 238, 242), tl.gauss(crk, 1.5) * 0.5)
	col = tl.mix3(col, tl.rgb(60, 84, 100), crk * 0.5)
	col = tl.mix3(col, tl.rgb(40, 36, 32), hole * 0.85)
	rough = 0.45 * crust + 0.12 * (1 - crust) + 0.05 * tl.spectral(S, r, 20, 200, 0.5)
	rough = rough + dirt * 0.1 - runnel * 0.05
	rough = np.where(hole > 0.5, 0.04, rough)
	return dict(albedo=col, height=height, rough=rough, ao_bake=0.25, ao_radius=0.2, albedo_target=0.5)


# =============================================================================================
LAYER_FUNCS = {"snow": layer_snow, "rock": layer_rock, "cliff": layer_cliff, "scree": tg.layer_scree,
               "gravel": tg.layer_gravel, "grass": tg.layer_grass, "forest": tg.layer_forest, "dirt": tg.layer_dirt,
               "ice": layer_ice}


def finish(name: str, t: tl.Tex, d: dict) -> dict:
	"""Derive normal/AO, bake AO into albedo, normalise height, return 8-bit maps + stats."""
	h_m = d["height"]
	if "normal" in d:
		n = d["normal"]
	else:
		n = tl.normal_from_height(h_m, t.texel_m, d.get("normal_strength", 1.0))
	if "tilt" in d:
		n = tl.tilt_normals(n, *d["tilt"])
	ao = tl.horizon_ao(h_m, t.texel_m, d.get("ao_radius", 0.2))
	alb = d["albedo"] * tl.lerp(1.0, ao, d.get("ao_bake", 0.4))[..., None]
	alb = np.clip(alb, 0.0, 1.0)
	rough = np.clip(d["rough"], 0.02, 1.0)
	lo, hi = np.percentile(h_m, 0.05), np.percentile(h_m, 99.95)
	h01 = np.clip((h_m - lo) / max(hi - lo, 1e-9), 0, 1)
	rng = np.random.default_rng(tl.seed_of(name, 99))
	out = dict(
		albedo=tl.albedo_u8(alb, rng), normal=tl.normal_u8(n), rough=tl.gray_u8(rough, rng),
		height=tl.gray_u8(h01, rng),
		stats=dict(avg_albedo_linear=[round(float(x), 4) for x in alb.reshape(-1, 3).mean(0)],
		           roughness_avg=round(float(rough.mean()), 4), height_range_m=round(float(hi - lo), 4)),
		_lin=dict(albedo=alb, n=n, rough=rough, ao=ao))
	return out


def main() -> None:
	ap = argparse.ArgumentParser()
	ap.add_argument("--only", default="")
	ap.add_argument("--preview", action="store_true")
	ap.add_argument("--no-write", action="store_true")
	ap.add_argument("--size", type=int, default=1024)
	a = ap.parse_args()
	names = [s for s in a.only.split(",") if s] or LAYERS
	for name in names:
		t0 = time.time()
		t = tl.Tex(name=f"terrain_{name}", w=a.size, h=a.size, tile_w_m=TILING_M[name])
		d = LAYER_FUNCS[name](t)
		o = finish(name, t, d)
		st = o["stats"]
		print(f"{name:7s} {time.time() - t0:5.1f}s  albedo(lin)={st['avg_albedo_linear']}  rough={st['roughness_avg']}"
		      f"  relief={st['height_range_m']} m  target~{d.get('albedo_target')}")
		if a.preview:
			L = o["_lin"]
			img = tl.preview(L["albedo"], L["n"], L["rough"], None, reps=2, size=1024)
			print("  preview:", cm.save_preview(f"terrain_{name}", img))
			from PIL import Image
			Image.fromarray(o["albedo"]).save(os.path.join(cm.SCRATCH, f"terrain_{name}_albedo.jpg"), quality=90)
		if not a.no_write:
			for k, suffix in (("albedo", "albedo"), ("normal", "normal"), ("rough", "roughness"), ("height", "height")):
				tl.save_png(os.path.join(OUT, f"{name}_{suffix}.png"), o[k])
			p = lambda s: os.path.join(OUT, f"{name}_{s}.png")  # noqa: E731
			gi.texture(p("albedo"), "albedo")
			gi.texture(p("normal"), "normal")
			gi.texture(p("roughness"), "rough", normal_for_rough=p("normal"))
			gi.texture(p("height"), "height")
			update_layer_meta(name, st)
	if not a.no_write:
		pack_arrays()
		macro_noise()


# ---------------------------------------------------------------------------------------------
# packing / metadata
# ---------------------------------------------------------------------------------------------
SURFACE = {"snow": "snow", "rock": "rock", "cliff": "rock", "scree": "scree", "gravel": "gravel",
           "grass": "grass", "forest": "forest", "dirt": "dirt", "ice": "ice"}
LAYERS_JSON = os.path.join(OUT, "layers.json")


def _load_layers() -> list:
	if os.path.exists(LAYERS_JSON):
		import json
		with open(LAYERS_JSON) as f:
			return json.load(f)
	return []


def update_layer_meta(name: str, st: dict) -> None:
	rows = {r["name"]: r for r in _load_layers()}
	rows[name] = {
		"index": LAYERS.index(name), "name": name, "tiling_m": TILING_M[name],
		"avg_albedo_linear": st["avg_albedo_linear"], "roughness_avg": st["roughness_avg"],
		"height_range_m": st["height_range_m"], "surface": SURFACE[name],
	}
	tl.write_json(LAYERS_JSON, [rows[n] for n in LAYERS if n in rows])


def pack_arrays() -> None:
	"""Stack the 9 layers into the two Texture2DArray source strips (1024 x 9216)."""
	from PIL import Image
	missing = [n for n in LAYERS if not os.path.exists(os.path.join(OUT, f"{n}_albedo.png"))]
	if missing:
		print("pack: skipped, missing layers:", missing)
		return
	ah, nr = [], []
	for n in LAYERS:
		f = lambda s: np.array(Image.open(os.path.join(OUT, f"{n}_{s}.png")))  # noqa: E731
		alb, hgt, nor, rou = f("albedo"), f("height"), f("normal"), f("roughness")
		ah.append(np.dstack([alb[..., :3], hgt]))
		nr.append(np.dstack([nor[..., :3], rou]))
	pa = os.path.join(OUT, "terrain_albedo_height.png")
	pn = os.path.join(OUT, "terrain_normal_rough.png")
	tl.save_png(pa, np.concatenate(ah, 0))
	tl.save_png(pn, np.concatenate(nr, 0))
	gi.texture_array(pa, len(LAYERS))
	gi.texture_array(pn, len(LAYERS))
	for p in (pa, pn):
		print(f"pack: {os.path.basename(p)}  {os.path.getsize(p) / 1e6:.1f} MB")


def macro_noise(size: int = 512) -> None:
	"""Periodic large-scale variation for the terrain shader (sample at ~1/64–1/256 m, linear, no sRGB):
	R = 1 cycle/tile fBm, G = 3 cycles, B = 9 cycles — combine to break up layer tiling and tint."""
	r = np.random.default_rng(tl.seed_of("terrain_macro"))
	S = (size, size)
	chans = [tl.spectral(S, r, 1, 8, 1.6), tl.spectral(S, r, 3, 24, 1.4), tl.spectral(S, r, 9, 72, 1.2)]
	img = np.dstack([np.clip(0.5 + 0.18 * c, 0, 1) for c in chans])
	p = os.path.join(OUT, "terrain_macro_noise.png")
	tl.save_png(p, tl.to_u8(img))
	gi.texture(p, "mask")


if __name__ == "__main__":
	main()

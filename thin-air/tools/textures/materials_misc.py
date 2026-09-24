"""Mineral, textile, leather, rope, snow and ice material sets for THIN AIR."""
from __future__ import annotations

import math

import numpy as np

import common as cm
import materials_metal as mm
import texlib as tl


# =============================================================================================
def concrete(t: tl.Tex) -> dict:
	"""Weathered board-formed concrete: exposed aggregate, bugholes, faint form-board lines, streaks,
	efflorescence, hairline cracks. Used world-triplanar."""
	S = t.shape
	r = t.rng
	px = t.px
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	paste_h = tl.spectral(S, r, 2, 60, 1.3) * 0.0008 + tl.spectral(S, r, 100, 512, 0.4) * 0.0001
	# formwork boards: 13 boards per 2 m, slight step between them, faint grain print
	nb = 13
	bpos = (yy + 0.5) / t.h * nb + 0.5
	bid = np.floor(bpos).astype(int) % nb
	bstep = r.normal(0, 0.0006, nb)[bid]
	bline = 1 - tl.smoothstep(0.0, 0.03, np.abs(bpos - np.round(bpos)))
	grainp = tl.spectral(S, r, 20, 300, 0.6, stretch=10, angle=0.0) * 0.00012
	hc = tl.HeightCanvas(S, paste_h + bstep - bline * 0.0006 + grainp)
	n = 5000
	D = cm.powerlaw_sizes(r, n, 0.003, 0.02, 1.8)
	agg_col = np.stack([tl.rgb(120, 118, 112), tl.rgb(160, 156, 148), tl.rgb(96, 92, 86), tl.rgb(142, 130, 116),
	                    tl.rgb(176, 172, 164)])[r.integers(0, 5, n)] * np.exp(r.normal(0, 0.1, n))[:, None]
	for i in range(n):
		f = cm.round_stone(r, px(D[i] / 2), 0.6 + 0.4 * r.random(), r.random() * 3.14, D[i] * 0.3)
		cy, cx = r.random() * t.h, r.random() * t.w
		ix, py, px_ = hc.region(cy, cx, int(px(D[i] / 2) * 1.1) + 2, int(px(D[i] / 2) * 1.1) + 2)
		hc.stamp(ix, f(py, px_) - D[i] * 0.22 + paste_h[ix], i)
	height = hc.z
	agg = hc.id >= 0
	# bugholes (air voids)
	bh = tl.worley(S, r, 1800, k=1)
	br = 0.001 + 0.003 * r.random(bh.count) ** 2
	bug = (1 - tl.smoothstep(0.7, 1.0, bh.f1 * t.tile_w_m / br[bh.cell])) * (r.random(bh.count)[bh.cell] < 0.35)
	height -= bug * 0.002
	# hairline cracks
	ck = tl.worley(S, r, 25, k=2, dx=tl.spectral(S, r, 6, 60, 1.2) * 6, dy=tl.spectral(S, r, 6, 60, 1.2) * 6)
	crack = (1 - tl.smoothstep(0.0, 0.0012, ck.edge * t.tile_w_m / 2)) * (tl.edge_pair_rand(ck, 3) < 0.3)
	height -= crack * 0.001
	col = tl.fill(S, tl.rgb(138, 136, 130)) * np.exp(0.06 * tl.spectral(S, r, 2, 30, 1.2) + 0.05 * tl.spectral(S, r, 60, 400, 0.4))[..., None]
	col *= np.exp(r.normal(0, 0.03, nb)[bid])[..., None]
	col = np.where(agg[..., None], agg_col[np.maximum(hc.id, 0)], col)
	col = tl.mix3(col, tl.rgb(64, 62, 58), bug * 0.8 + crack * 0.6)
	# weathering: dark water streaks, efflorescence, rust spots, lichen specks
	streak = tl.patches(S, r, 4, 60, 0.3, 0.5, stretch=8, angle=math.pi / 2)
	col = tl.mix3(col, tl.rgb(96, 94, 90), streak * 0.3)
	eff = tl.patches(S, r, 3, 30, 0.1, 0.5, stretch=3, angle=math.pi / 2)
	col = tl.mix3(col, tl.rgb(190, 188, 182), eff * 0.3)
	la, lc, lrim, lsp = cm.lichen_colonies(t, coverage=0.02, mean_r_m=0.008, species_w=(0.0, 0.0, 0.6, 0.4))
	col = tl.mix3(col, lc, la * 0.6)
	rough = 0.88 + 0.05 * tl.spectral(S, r, 20, 200, 0.5) - streak * 0.08
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.006, ao_bake=0.3)


# =============================================================================================
def _weave(t: tl.Tex, r, period_px: float, slub: float = 0.2):
	"""Plain weave height (0..1) + per-thread ids. period_px = width of one thread."""
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	X = (xx + 0.5) / period_px + 0.5      # seam falls mid-thread
	Y = (yy + 0.5) / period_px + 0.5
	ix, iy = np.floor(X).astype(int), np.floor(Y).astype(int)
	fx, fy = X - ix, Y - iy
	nx, ny = int(round(t.w / period_px)), int(round(t.h / period_px))
	thick_w = 1 + slub * r.normal(0, 1, nx)[ix % nx] * 0.5
	thick_f = 1 + slub * r.normal(0, 1, ny)[iy % ny] * 0.5
	warp_p = np.sin(np.pi * fx) ** 0.7 * thick_w
	weft_p = np.sin(np.pi * fy) ** 0.7 * thick_f
	over = ((ix + iy) % 2) == 0
	# warp dips under the weft on alternate crossings (smooth undulation along its length)
	warp_h = warp_p * (0.55 + 0.45 * np.cos(np.pi * (Y - 0.5 + (ix % 2))))
	weft_h = weft_p * (0.55 + 0.45 * np.cos(np.pi * (X - 0.5 + (iy % 2) + 1)))
	h = np.maximum(warp_h, weft_h)
	is_warp = warp_h >= weft_h
	tid = np.where(is_warp, ix % nx, 10000 + iy % ny)
	return h, is_warp, tid


def canvas(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	weave, is_warp, tid = _weave(t, r, 4.0, 0.25)
	folds = tl.spectral(S, r, 2, 12, 1.6) * 0.0005
	crease = np.zeros(S)
	for (p, q) in ((1, 2), (2, -1), (1, 0)):
		d_, _, _, _ = tl.line_family(S, p, q, r.random(1), tl.spectral(S, r, 2, 20, 1.4) * 0.01)
		crease += np.exp(-(d_ * t.tile_w_m / 0.004) ** 2) * r.uniform(0.3, 1.0) * tl.smoothstep(-0.5, 0.5, tl.spectral(S, r, 1, 4, 1.5))
	height = weave * 0.00022 + folds - crease * 0.0004
	col = tl.fill(S, tl.rgb(116, 108, 78))
	ttone = np.exp(r.normal(0, 0.05, 20000))[np.where(tid >= 10000, tid - 10000 + 10000, tid)]
	col *= ttone[..., None] * (0.86 + 0.14 * weave)[..., None]
	col *= np.exp(0.06 * tl.spectral(S, r, 2, 30, 1.2))[..., None]
	# sun-faded patches, water tide-marks, mildew speckle, dirt
	fade = tl.smoothstep(0.0, 1.6, tl.spectral(S, r, 1, 8, 1.4))
	col = tl.mix3(col, tl.rgb(140, 134, 108), fade * 0.35)
	tide = tl.worley(S, r, 14, k=2, dx=tl.spectral(S, r, 4, 40, 1.2) * 20, dy=tl.spectral(S, r, 4, 40, 1.2) * 20)
	tm = (1 - tl.smoothstep(0.0, 0.004, np.abs(tide.f1 * t.tile_w_m - 0.06 - 0.03 * r.random(tide.count)[tide.cell]))) * \
		(r.random(tide.count)[tide.cell] < 0.5)
	col = tl.mix3(col, tl.rgb(84, 76, 54), tm * 0.5)
	mil = (r.random(S) < 0.02) * tl.smoothstep(1.2, 2.0, tl.spectral(S, r, 3, 30, 1.2))
	col = tl.mix3(col, tl.rgb(40, 40, 34), tl.gauss(mil.astype(float), 0.7) * 3)
	dirt = tl.smoothstep(0.6, 1.8, tl.spectral(S, r, 3, 40, 1.1))
	col = tl.mix3(col, tl.rgb(80, 70, 54), dirt * 0.3)
	rough = 0.9 - 0.05 * weave + 0.03 * dirt
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.002, ao_bake=0.25)


# =============================================================================================
def fabric_wool(t: tl.Tex) -> dict:
	"""Hand-knit stockinette wool blanket: V-stitches (64 wales x 80 courses per 30 cm), plied yarn twist,
	fibre halo, undyed oatmeal heathered yarn."""
	S = t.shape
	r = t.rng
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	ncol, nrow = 64, 80
	cw, rh = t.w / ncol, t.h / nrow
	best = np.zeros(S)
	leg_id = np.zeros(S, dtype=np.int64)
	twist = np.zeros(S)
	jit_c = r.normal(0, 0.04, (nrow, ncol))
	for drow in (-1, 0, 1):
		for side in (-1, 1):
			row = np.floor(yy / rh).astype(int) + drow
			col_ = np.floor(xx / cw).astype(int)
			cy = (row + 0.5) * rh
			cx = (col_ + 0.5) * cw
			# leg centre: offset to its side, leaning so that legs meet at the bottom (V)
			lx = cx + side * cw * 0.24
			ly = cy - rh * 0.1
			ang = side * 0.52
			dx = xx - lx
			dy = yy - ly
			ca, sa = math.cos(ang), math.sin(ang)
			u = (dx * ca + dy * sa) / (cw * 0.27)
			v = (-dx * sa + dy * ca) / (rh * 0.85)
			jr = jit_c[row % nrow, col_ % ncol]
			d = u * u + v * v * (1 + jr)
			prof = np.sqrt(np.clip(1 - d, 0, 1))
			# rows lower in the fabric sit on top of rows above them
			prof = prof * (1.0 - 0.08 * drow)
			upd = prof > best
			best = np.where(upd, prof, best)
			leg_id = np.where(upd, (row % nrow) * ncol * 2 + (col_ % ncol) * 2 + (side > 0), leg_id)
			twist = np.where(upd, np.sin((u * 3.0 + v * 6.0) * math.pi), twist)
	height = best * 0.0012 + twist * best * 0.00012
	halo = tl.spectral(S, r, 200, 512, 0.2)
	height += halo * 0.00004
	rowid = leg_id // (ncol * 2)
	stripe = np.zeros(S, dtype=bool)   # plain heathered yarn (reusable for blanket, sweater, hat)
	# undyed oatmeal/grey heather (natural sheep's wool): pale fibres with darker grey-brown flecks, so
	# albedo_color can tint it for other garments
	base = tl.rgb(146, 136, 120)
	light = tl.rgb(170, 160, 140)
	heather = tl.smoothstep(0.8, 1.6, tl.spectral(S, r, 80, 512, 0.2))
	col = tl.fill(S, base)
	col = tl.mix3(col, tl.rgb(96, 88, 78), heather * 0.55)
	col = np.where(stripe[..., None], tl.fill(S, light) * (0.9 + 0.1 * heather)[..., None], col)
	col *= np.exp(r.normal(0, 0.05, nrow * ncol * 2)[leg_id])[..., None]
	col *= (0.7 + 0.3 * best)[..., None]
	col *= np.exp(0.04 * tl.spectral(S, r, 2, 20, 1.3))[..., None]
	rough = 0.94 - 0.04 * best
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.003, ao_bake=0.35, rim=0.35, rim_tint=0.6)


# =============================================================================================
def fabric_nylon(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	cells = 60
	gx = np.abs(((xx + 0.5) / t.w * cells + 0.5) % 1.0 - 0.5)
	gy = np.abs(((yy + 0.5) / t.h * cells + 0.5) % 1.0 - 0.5)
	rip = np.maximum(tl.smoothstep(0.43, 0.49, gx), tl.smoothstep(0.43, 0.49, gy))
	fine = tl.spectral(S, r, 250, 512, 0.0)
	wrinkle = tl.spectral(S, r, 2, 10, 1.8) + 0.12 * tl.spectral(S, r, 8, 40, 1.4, stretch=3, angle=0.7)
	crease = np.zeros(S)
	for (p, q) in ((1, 1), (2, -1), (0, 1), (1, 3)):
		d_, _, _, _ = tl.line_family(S, p, q, r.random(1), tl.spectral(S, r, 2, 20, 1.4) * 0.02)
		crease += np.exp(-(d_ * t.tile_w_m / 0.0025) ** 2) * r.uniform(0.3, 1.0) * tl.smoothstep(-0.3, 0.6, tl.spectral(S, r, 1, 4, 1.5))
	height = wrinkle * 0.0005 - crease * 0.00012 + rip * 0.00004 + fine * 0.000005
	col = tl.fill(S, tl.rgb(142, 38, 32))
	col *= np.exp(0.05 * tl.spectral(S, r, 2, 20, 1.3))[..., None]
	col = tl.mix3(col, tl.rgb(168, 72, 62), tl.smoothstep(0.2, 1.6, tl.spectral(S, r, 1, 8, 1.4)) * 0.35)  # UV fade
	col *= (1 - 0.08 * rip)[..., None]
	abr = tl.patches(S, r, 8, 80, 0.04, 0.4) * tl.smoothstep(-0.5, 1.5, wrinkle) * 0.6
	col = tl.mix3(col, tl.rgb(172, 128, 118), abr * 0.4)
	dirt = tl.patches(S, r, 4, 40, 0.2, 0.6)
	col = tl.mix3(col, tl.rgb(92, 52, 44), dirt * 0.25)
	rough = 0.46 + 0.1 * rip + 0.25 * abr + 0.15 * dirt
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.004, ao_bake=0.2)


# =============================================================================================
def leather(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	peb = tl.worley(S, r, 60000, k=2, dx=tl.spectral(S, r, 20, 200, 1.0) * 1.5, dy=tl.spectral(S, r, 20, 200, 1.0) * 1.5)
	pebble = tl.smoothstep(0.0, 0.0022, peb.edge) ** 0.7
	flex = tl.ridged(tl.warp(tl.spectral(S, r, 6, 50, 1.2), *(tl.spectral(S, r, 4, 30, 1.2) * 10 for _ in range(2))), 1.5)
	deep = np.zeros(S)
	for (p, q) in ((1, 2), (3, 1)):
		d_, _, _, _ = tl.line_family(S, p, q, r.random(2), tl.spectral(S, r, 2, 24, 1.4) * 0.02)
		deep += np.exp(-(d_ * t.tile_w_m / 0.0015) ** 2) * tl.smoothstep(-0.3, 0.6, tl.spectral(S, r, 1, 4, 1.5))
	height = pebble * 0.0002 - flex * 0.00015 - deep * 0.0004 + tl.spectral(S, r, 1, 8, 1.6) * 0.0008
	col = tl.fill(S, tl.rgb(98, 62, 40)) * np.exp(0.07 * tl.spectral(S, r, 2, 30, 1.2))[..., None]
	burn = tl.patches(S, r, 2, 16, 0.4, 0.8)
	col = tl.mix3(col, tl.rgb(70, 44, 28), burn * 0.5)
	scuff = tl.patches(S, r, 6, 60, 0.08, 0.5) * 0.7 + mm.scratches(t, r, 70, (0.005, 0.04), 2, 0.3) * 0.4
	scuff = np.clip(scuff, 0, 1)
	col = tl.mix3(col, tl.rgb(136, 100, 72), scuff * 0.45)
	col *= (0.88 + 0.12 * pebble)[..., None]
	col = tl.mix3(col, tl.rgb(52, 32, 22), np.clip(deep, 0, 1) * 0.5 + flex * 0.15)
	rough = 0.55 - 0.12 * burn + 0.25 * scuff + 0.05 * (1 - pebble)
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.002, ao_bake=0.25)


# =============================================================================================
def hide(t: tl.Tex) -> dict:
	"""Raw (untanned) deer hide, flesh side, dried: blotchy thickness, veins, scraper marks, membrane sheen."""
	S = t.shape
	r = t.rng
	px = t.px
	thick = tl.spectral(S, r, 1, 16, 1.4)
	veins = tl.ridged(tl.warp(tl.spectral(S, r, 4, 40, 1.2), *(tl.spectral(S, r, 3, 20, 1.3) * px(0.02) for _ in range(2))), 3.0)
	vein = tl.smoothstep(0.82, 0.97, veins) * tl.smoothstep(-0.4, 0.8, tl.spectral(S, r, 2, 12, 1.3))
	scrape = tl.spectral(S, r, 10, 200, 0.8, stretch=8, angle=0.6)
	wrink = tl.ridged(tl.spectral(S, r, 20, 150, 1.0), 2.0)
	membrane = tl.patches(S, r, 3, 30, 0.3, 0.5)
	height = thick * 0.0012 + wrink * 0.0002 + scrape * 0.00008 + vein * 0.0002
	col = tl.fill(S, tl.rgb(190, 158, 112))
	col = tl.mix3(col, tl.rgb(156, 112, 66), tl.smoothstep(-0.6, 1.6, thick) * 0.7)
	col = tl.mix3(col, tl.rgb(150, 104, 76), vein * 0.5)
	col *= np.exp(0.05 * scrape + 0.04 * tl.spectral(S, r, 60, 400, 0.4))[..., None]
	stain = tl.patches(S, r, 4, 30, 0.05, 0.4)
	col = tl.mix3(col, tl.rgb(110, 62, 44), stain * 0.5)
	fat = tl.patches(S, r, 3, 24, 0.2, 0.6)
	col = tl.mix3(col, tl.rgb(200, 176, 110), fat * 0.3)
	rough = 0.66 - 0.28 * membrane - 0.1 * fat + 0.05 * wrink
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.004, ao_bake=0.2, subsurf=0.2)


# =============================================================================================
def rope(t: tl.Tex) -> dict:
	"""3-strand right-hand laid manila rope, 12 mm diameter: U spans 4 lay lengths (168 mm) along the rope,
	V spans the full circumference (37.7 mm). Strands, opposite-twisted yarns, hairy fibres."""
	S = t.shape
	r = t.rng
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	u = (xx + 0.5) / t.w
	v = (yy + 0.5) / t.h
	circ = 0.0377
	asp = circ / t.tile_w_m                       # tile height / width in metres
	phi = 3 * (v - 4 * u) + tl.spectral(S, r, 2, 20, 1.5, aspect=asp) * 0.03
	s = phi % 1.0
	strand = np.sin(np.pi * s) ** 0.45
	sid = np.floor(phi).astype(int) % 3
	# yarns twisted the other way inside each strand (~7 visible yarns per strand)
	psi = 21 * (v + 2 * u)
	yarn = 0.5 + 0.5 * np.cos(2 * np.pi * psi)
	fib = tl.spectral(S, r, 60, 512, 0.3, stretch=6, angle=math.atan2(1.0, 2.0 * asp), aspect=asp)
	hair = (r.random(S) < 0.01).astype(float)
	hair = np.clip(tl.blur_dir(hair, 10, angle=math.atan2(1, -4 * asp), taps=10) * 6, 0, 1)
	height = strand * 0.0022 + yarn * strand * 0.00025 + fib * 0.00004 + hair * 0.0002
	col = tl.fill(S, tl.rgb(178, 148, 102))
	col *= np.exp(r.normal(0, 0.05, 3)[sid])[..., None]
	col *= (0.42 + 0.58 * strand)[..., None] * (0.86 + 0.14 * yarn)[..., None]
	col *= np.exp(0.10 * fib)[..., None]
	col = tl.mix3(col, tl.rgb(206, 186, 146), hair * 0.5)
	dirt = tl.smoothstep(0.3, 1.8, tl.spectral(S, r, 2, 30, 1.2, aspect=asp))
	col = tl.mix3(col, tl.rgb(96, 80, 60), dirt * 0.35)
	rough = 0.88 + 0.05 * (1 - strand)
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.0015, ao_bake=0.3, texel_y_scale=asp)


# =============================================================================================
def rock_boulder(t: tl.Tex) -> dict:
	"""Granite boulder skin for rock meshes (world triplanar): isotropic weathered granite, spalled scars,
	pits, hairline fractures, heavy lichen mosaic."""
	S = t.shape
	r = t.rng
	px = t.px
	height = tl.spectral(S, r, 1, 6, 1.6) * 0.03 + tl.spectral(S, r, 4, 200, 1.3) * 0.008
	ex = tl.warp(tl.spectral(S, r, 2, 20, 1.3), *(tl.spectral(S, r, 4, 40, 1.2) * px(0.05) for _ in range(2)))
	scar = tl.smoothstep(0.9, 1.0, ex)
	scar2 = tl.smoothstep(1.4, 1.5, ex)
	height -= (scar + scar2) * 0.004
	fr = tl.worley(S, r, 30, k=2, dx=tl.spectral(S, r, 6, 60, 1.2) * px(0.01), dy=tl.spectral(S, r, 6, 60, 1.2) * px(0.01))
	frac = (1 - tl.smoothstep(0.0, 0.004, fr.edge * t.tile_w_m / 2)) * (tl.edge_pair_rand(fr, 2) < 0.3)
	height -= frac * 0.01
	pits = tl.worley(S, r, 2500, k=1)
	pit = (1 - tl.smoothstep(0.0, 0.003, pits.f1)) * (r.random(pits.count)[pits.cell] < 0.3)
	height -= pit * 0.002
	gcol, gmicro, mineral = cm.granite_grain(t, grain_m=0.005, weather=0.45)
	height += gmicro * 0.0004
	col = gcol * np.exp(0.06 * tl.spectral(S, r, 1, 10, 1.3))[..., None]
	col = tl.mix3(col, gcol * 1.12, np.clip(scar + scar2, 0, 1) * 0.6)
	col = tl.mix3(col, tl.rgb(150, 132, 108), tl.smoothstep(0.5, 1.8, tl.spectral(S, r, 2, 16, 1.2)) * 0.22)
	mott = tl.smoothstep(0.2, 1.2, tl.warp(tl.spectral(S, r, 3, 40, 1.1), *(tl.spectral(S, r, 6, 60, 1.0) * 6 for _ in range(2))))
	col = tl.mix3(col, tl.rgb(176, 178, 170), mott * 0.35)
	col = tl.mix3(col, tl.rgb(80, 78, 74), tl.smoothstep(0.5, 1.4, tl.spectral(S, r, 4, 50, 1.0)) * 0.3)
	la, lc, lrim, lsp = cm.lichen_colonies(t, coverage=0.32, mean_r_m=0.03, species_w=(0.42, 0.015, 0.36, 0.2), mask=(1 - frac) * (1 - 0.9 * np.clip(scar + scar2, 0, 1)))
	col = tl.mix3(col, lc, la * 0.9)
	col = tl.mix3(col, cm.LICHEN_PROTHALLUS, lrim * (lsp == 0) * 0.7)
	col = tl.mix3(col, tl.rgb(48, 44, 38), frac * 0.8 + pit * 0.4)
	height += la * 0.0005
	rough = 0.8 + 0.04 * tl.spectral(S, r, 10, 200, 0.6)
	rough = np.where(mineral == 2, rough - 0.12, rough)
	rough = rough * (1 - la) + 0.88 * la
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.03, ao_bake=0.3)


# =============================================================================================
def snow_packed(t: tl.Tex) -> dict:
	"""Dense settled snow on roofs/structures: granular, gently undulating, glazed melt-freeze patches,
	drip pits, sparkle."""
	S = t.shape
	r = t.rng
	height = tl.spectral(S, r, 1, 8, 1.6) * 0.006 + tl.spectral(S, r, 8, 60, 1.2) * 0.0012
	grain = tl.spectral(S, r, 150, 512, 0.1) * 0.00015
	glaze = tl.smoothstep(0.4, 1.4, tl.spectral(S, r, 2, 20, 1.3))
	pits = tl.worley(S, r, 600, k=1)
	pit = (1 - tl.smoothstep(0.0, 0.004, pits.f1)) * (r.random(pits.count)[pits.cell] < 0.3)
	height += grain * (1 - glaze) - pit * 0.003
	col = tl.fill(S, tl.rgb(228, 232, 238)) * np.exp(0.015 * tl.spectral(S, r, 2, 30, 1.2))[..., None]
	col = tl.mix3(col, tl.rgb(212, 222, 234), glaze * 0.4)
	col = tl.mix3(col, tl.rgb(200, 212, 228), pit * 0.5)
	grit = (r.random(S) < 0.0004).astype(float)
	col = tl.mix3(col, tl.rgb(110, 104, 96), np.clip(tl.gauss(grit, 0.6) * 4, 0, 0.6))
	rough = 0.72 - 0.4 * glaze + 0.03 * tl.spectral(S, r, 20, 200, 0.5)
	sparkle = r.random(S) < 0.02
	rough = np.where(sparkle, 0.08 + 0.1 * r.random(S), rough)
	tx = np.where(sparkle, (r.random(S) - 0.5) * 1.0, 0.0)
	ty = np.where(sparkle, (r.random(S) - 0.5) * 1.0, 0.0)
	return dict(albedo=col, height=height, rough=rough, tilt=(tx, ty), ao_radius=0.01, ao_bake=0.1, specular=0.3)


# =============================================================================================
def ice_clear(t: tl.Tex) -> dict:
	"""Clear black lake/river ice: dark water seen through, white bubble trains, white fracture planes,
	frost patches, skate-like scratches."""
	S = t.shape
	r = t.rng
	px = t.px
	col = tl.fill(S, tl.rgb(34, 48, 58)) * np.exp(0.10 * tl.spectral(S, r, 1, 12, 1.4))[..., None]
	# bubble trains: clusters of small bright dots in sheets
	bub_d = tl.patches(S, r, 3, 30, 0.35, 0.6)
	bub = (r.random(S) < 0.008 * bub_d).astype(float)
	bub = np.clip(tl.gauss(bub, 0.8) * 4, 0, 1)
	col = tl.mix3(col, tl.rgb(180, 196, 206), bub * 0.55)
	# fractures: long white planes (line families) + branching network
	fr = np.zeros(S)
	for (p, q, nl) in ((1, 2, 2), (3, -1, 1), (1, 0, 1)):
		d_, _, _, _ = tl.line_family(S, p, q, r.random(nl), tl.spectral(S, r, 2, 30, 1.3) * 0.02)
		vis = tl.smoothstep(-0.3, 0.5, tl.spectral(S, r, 1, 4, 1.5))
		fr = np.maximum(fr, np.exp(-(d_ * t.tile_w_m / 0.0008) ** 2) * vis)
	net = tl.worley(S, r, 40, k=2, dx=tl.spectral(S, r, 6, 60, 1.2) * 8, dy=tl.spectral(S, r, 6, 60, 1.2) * 8)
	netc = (1 - tl.smoothstep(0.0, 0.0008, net.edge * t.tile_w_m / 2)) * (tl.edge_pair_rand(net, 4) < 0.25)
	fr = np.maximum(fr, netc * 0.8)
	glow = tl.gauss(fr, 3.0) * 1.2
	col = tl.mix3(col, tl.rgb(120, 142, 156), np.clip(glow, 0, 0.45))
	col = tl.mix3(col, tl.rgb(196, 210, 220), fr * 0.6)
	frost = tl.patches(S, r, 2, 24, 0.12, 0.5, detail=0.9)
	col = tl.mix3(col, tl.rgb(150, 170, 184), frost * 0.3)
	scr = mm.scratches(t, r, 60, (0.05, 0.4), 1, 0.4, curve=0.4)
	col = tl.mix3(col, tl.rgb(170, 184, 192), scr * 0.4)
	height = tl.spectral(S, r, 1, 6, 1.6) * 0.0006 - fr * 0.0002 - scr * 0.00005 + frost * tl.spectral(S, r, 100, 512, 0.2) * 0.00005
	rough = 0.04 + 0.55 * frost + 0.25 * scr + 0.1 * fr
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.002, ao_bake=0.0, specular=0.25)

"""Bark & wood material sets for THIN AIR. Grain / fibre direction runs along V (image vertical)."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

import common as cm
import texlib as tl


def _rings_1d(rng, length: int, mean_w: float, var: float = 0.45, late: float = 0.3):
	"""Periodic 1D annual-ring profile sampled at `length` points: returns (phase 0..1 within ring, ring index).
	mean_w in samples."""
	n = max(3, int(round(length / mean_w)))
	w = rng.lognormal(0, var, n)
	b = np.concatenate([[0], np.cumsum(w)]) / w.sum() * length
	x = np.arange(length) + 0.5
	idx = np.clip(np.searchsorted(b, x, side="right") - 1, 0, n - 1)
	ph = (x - b[idx]) / (b[idx + 1] - b[idx])
	return ph, idx


def _ring_sample(ph1d: np.ndarray, coord: np.ndarray) -> np.ndarray:
	"""Periodic linear lookup of a 1D profile at fractional coordinates (in samples)."""
	L = len(ph1d)
	c = coord % L
	i0 = np.floor(c).astype(int) % L
	i1 = (i0 + 1) % L
	f = c - np.floor(c)
	return ph1d[i0] * (1 - f) + ph1d[i1] * f


def _late(ph, late=0.3, sharp=0.08):
	"""Earlywood (0) -> latewood (1) inside a ring phase, with a sharp boundary to the next ring."""
	return tl.smoothstep(1 - late, 1 - late + sharp, ph) * (1 - tl.smoothstep(0.985, 1.0, ph))


# =============================================================================================
def bark_spruce(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	asp = t.h / t.w
	# inner bark (exposed between flakes): dark reddish brown, fibrous; shallow vertical furrows
	furrow = tl.spectral(S, r, 2, 24, 1.3, stretch=5, angle=math.pi / 2, aspect=asp)
	base_h = furrow * 0.003 + tl.spectral(S, r, 60, 300, 0.8, stretch=4, angle=math.pi / 2, aspect=asp) * 0.0003
	hc = tl.HeightCanvas(S, base_h - 0.0015)
	n = 6000
	tone = np.empty(n)
	for i in range(n):
		R = px(0.006 + 0.010 * r.random())
		f, rmax = cm.angular_stone(r, R, 0.6 + 0.25 * r.random(), (r.random() - 0.5) * 0.8, 1.0)
		cy, cx = r.random() * t.h, r.random() * t.w
		ix, py, pxx = hc.region(cy, cx, int(rmax) + 2, int(rmax) + 2)
		foot = ~np.isnan(f(py, pxx))
		s = np.clip((py / rmax + 1) * 0.5, 0, 1)            # 0 top .. 1 bottom edge
		thick = 0.0008 + 0.0012 * r.random()
		curl = thick * 1.5 * tl.smoothstep(0.7, 1.0, s) * r.random()
		z0 = hc.z[ix].mean() + furrow[ix].mean() * 0.0005 + r.normal(0, 0.0005)
		surf = np.where(foot, z0 + thick * (0.3 + 0.7 * s) + curl, np.nan)
		hc.stamp(ix, surf, i)
		tone[i] = r.random()
	height = hc.z
	sid = hc.id
	on = sid >= 0
	sidc = np.maximum(sid, 0)
	pal = np.stack([tl.rgb(112, 100, 92), tl.rgb(100, 88, 80), tl.rgb(126, 116, 106), tl.rgb(108, 92, 84)])
	pid = (tone * 4).astype(int) % 4
	col = pal[pid[sidc]] * np.exp(r.normal(0, 0.06, n)[sidc])[..., None]
	# flake margins weather paler; a few fresh flakes show reddish undersides
	lo = height - tl.gauss(height, px(0.005))
	col = tl.mix3(col, tl.rgb(140, 132, 122), tl.smoothstep(0.0003, 0.0012, lo) * 0.3)
	inner = tl.fill(S, tl.rgb(80, 62, 52)) * np.exp(0.15 * tl.spectral(S, r, 30, 300, 0.6, aspect=asp))[..., None]
	fresh = tl.patches(S, r, 3, 30, 0.12, 0.3, aspect=asp)
	col = tl.mix3(col, tl.rgb(128, 86, 64), fresh * on * 0.7)
	col = np.where(on[..., None], col, inner)
	col *= np.exp(0.07 * tl.spectral(S, r, 1, 12, 1.3, aspect=asp) - 0.06 * np.clip(-furrow, 0, 2))[..., None]
	# pale crustose lichen and a greenish algal film in the furrows
	la, lc, lrim, lsp = cm.lichen_colonies(t, coverage=0.08, mean_r_m=0.01, species_w=(0.08, 0.02, 0.75, 0.15))
	col = tl.mix3(col, lc, la * 0.65)
	col = tl.mix3(col, tl.rgb(96, 104, 74), tl.patches(S, r, 2, 16, 0.15, 0.4, aspect=asp) * 0.25)
	rough = np.where(on, 0.86, 0.9) + 0.04 * tl.spectral(S, r, 20, 200, 0.5, aspect=asp)
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.008, ao_bake=0.35, normal_scale=1.0)


# =============================================================================================
def bark_pine(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	asp = t.h / t.w
	wx = tl.spectral(S, r, 3, 30, 1.3, aspect=asp) * px(0.006)
	wy = tl.spectral(S, r, 3, 30, 1.3, aspect=asp) * px(0.012)
	# plates elongated along the stem, separated by deep, near-vertical fissures that braid and rejoin
	plates = tl.worley(S, r, 46, k=2, sy=0.28, dx=wx, dy=wy, aspect=asp)
	e_m = plates.edge * t.tile_w_m
	fw = 0.006 + 0.012 * tl.norm01(tl.spectral(S, r, 3, 30, 1.0, aspect=asp))
	fiss = 1 - tl.smoothstep(fw * 0.35, fw, e_m)
	pid = plates.cell
	# plate body: convex, thick; stepped flaky "jigsaw" layers on top
	body = tl.smoothstep(0.0, 0.04, e_m) * 0.016 + r.normal(0, 0.004, plates.count)[pid]
	pieces = tl.worley(S, r, 1400, k=2, sy=0.7, dx=wx, dy=wy, aspect=asp)
	ped = pieces.edge * t.tile_w_m
	step = np.floor(r.random(pieces.count) * 4)[pieces.cell] * 0.001
	piece_line = 1 - tl.smoothstep(0.0, 0.0012, ped)
	wall = tl.spectral(S, r, 30, 250, 0.8, aspect=asp)
	height = body + step * (1 - fiss) - fiss * (0.024 + 0.004 * wall) - piece_line * 0.0007
	height += tl.spectral(S, r, 40, 256, 0.8, aspect=asp) * 0.0004
	# colour: cinnamon plates, each jigsaw piece its own tone; near-black fissures
	ptone = np.exp(r.normal(0, 0.12, pieces.count))[pieces.cell]
	pal = np.stack([tl.rgb(136, 90, 66), tl.rgb(150, 104, 76), tl.rgb(118, 80, 60), tl.rgb(116, 104, 96)])
	plate_pal = pal[r.choice(4, plates.count, p=[0.35, 0.25, 0.25, 0.15])][pid]
	col = plate_pal * ptone[..., None]
	col = tl.mix3(col, tl.rgb(70, 52, 42), piece_line * 0.45)
	col = tl.mix3(col, tl.rgb(38, 31, 27) * np.exp(0.2 * wall)[..., None], fiss)
	col *= np.exp(0.05 * tl.spectral(S, r, 1, 8, 1.3, aspect=asp))[..., None]
	# grey weathering on exposed plate faces, pale lichen crusts
	col = tl.mix3(col, tl.rgb(120, 112, 106), tl.patches(S, r, 2, 20, 0.25, 0.35, aspect=asp) * (1 - fiss) * 0.45)
	la, lc, lrim, lsp = cm.lichen_colonies(t, coverage=0.05, mean_r_m=0.012, species_w=(0.1, 0.0, 0.8, 0.1),
	                                       mask=1 - fiss)
	col = tl.mix3(col, lc, la * 0.6)
	rough = 0.82 + 0.1 * fiss + 0.03 * tl.spectral(S, r, 20, 200, 0.5, aspect=asp)
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.03, ao_bake=0.35)


# =============================================================================================
def bark_dead(t: tl.Tex) -> dict:
	"""Silvered snag: bark gone, weathered grain with raised latewood, long checks, engraver-beetle galleries."""
	S = t.shape
	r = t.rng
	px = t.px
	asp = t.h / t.w
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	# grain coordinate across the stem (x), wavy along y (periodic)
	wav = tl.spectral(S, r, 1, 10, 1.6, stretch=3, angle=math.pi / 2, aspect=asp) * px(0.006)
	g = xx + wav + 2.0 * np.sin(2 * np.pi * yy / t.h * 2 + r.random() * 6)
	ph1, idx1 = _rings_1d(r, t.w, px(0.0032))
	ph = _ring_sample(ph1, g)
	late = _late(ph, 0.35, 0.15)
	erode = tl.smoothstep(-1.0, 1.0, tl.spectral(S, r, 2, 20, 1.3, aspect=asp))
	height = late * (0.0005 + 0.0008 * erode) + tl.spectral(S, r, 2, 30, 1.4, stretch=5, angle=math.pi / 2, aspect=asp) * 0.002
	height += tl.spectral(S, r, 80, 400, 0.6, stretch=8, angle=math.pi / 2, aspect=asp) * 0.0003
	# checks (long cracks along the grain), tapering at both ends
	chk = np.zeros(S)
	for k in range(9):
		cx = r.random() * t.w
		cy = r.random() * t.h
		L = px(0.15 + 0.6 * r.random())
		wmax = px(0.0008 + 0.0035 * r.random() ** 2)
		dy = (yy - cy + t.h / 2) % t.h - t.h / 2
		dx = (g - cx + t.w / 2) % t.w - t.w / 2
		s = np.clip(1 - (dy / (L / 2)) ** 2, 0, 1)
		wv = wmax * s ** 0.7 + 0.3
		chk = np.maximum(chk, (1 - tl.smoothstep(wv * 0.3, wv, np.abs(dx))) * (s > 0) * (0.55 + 0.45 * r.random()))
	height -= chk * 0.006
	# engraver-beetle galleries (2 systems): egg gallery along grain + meandering larval tunnels
	gal = Image.new("L", (t.w * 3, t.h * 3), 0)
	d = ImageDraw.Draw(gal)
	for k in range(2):
		gx0 = t.w + r.random() * t.w
		gy0 = t.h + r.random() * t.h
		L = px(0.06 + 0.06 * r.random())
		d.line([(gx0, gy0 - L / 2), (gx0 + r.normal(0, 2), gy0 + L / 2)], fill=255, width=max(2, int(px(0.0025))))
		for j in range(int(18 + 16 * r.random())):
			sy_ = gy0 - L / 2 + r.random() * L
			side = 1 if r.random() < 0.5 else -1
			x, y = gx0, sy_
			a = 0.0 if side > 0 else math.pi
			a += r.normal(0, 0.3)
			ln = px(0.02 + 0.04 * r.random())
			pts = [(x, y)]
			for s_ in range(10):
				a += r.normal(0, 0.25)
				x += math.cos(a) * ln / 10
				y += math.sin(a) * ln / 10 + r.normal(0, 0.3)
				pts.append((x, y))
			for s_ in range(len(pts) - 1):
				wv = 1 + s_ * 0.25
				d.line([pts[s_], pts[s_ + 1]], fill=200, width=max(1, int(wv)))
	gal = np.array(gal, dtype=np.float64) / 255.0
	gal = gal.reshape(3, t.h, 3, t.w).sum(axis=(0, 2))       # fold the 3x3 canvas back onto the tile
	gal = np.clip(tl.gauss(gal, 0.6), 0, 1)
	height -= gal * 0.0012
	# colour: silver-grey with brown grain in the grooves
	col = tl.fill(S, tl.rgb(152, 148, 142))
	col = tl.mix3(col, tl.rgb(96, 88, 80), (1 - late) * (0.25 + 0.3 * erode))
	col *= np.exp(0.08 * tl.spectral(S, r, 2, 40, 1.2, stretch=4, angle=math.pi / 2, aspect=asp)
	              + 0.04 * tl.spectral(S, r, 60, 300, 0.4, aspect=asp))[..., None]
	col = tl.mix3(col, tl.rgb(174, 170, 164), tl.patches(S, r, 2, 12, 0.35, 0.4, aspect=asp) * 0.35)
	col = tl.mix3(col, tl.rgb(120, 104, 88), tl.patches(S, r, 3, 24, 0.2, 0.4, aspect=asp, stretch=4, angle=math.pi / 2) * 0.35)
	col = tl.mix3(col, tl.rgb(84, 70, 58), gal * 0.9)
	col = tl.mix3(col, tl.rgb(40, 34, 30), chk * 0.9)
	# faint green algae film in places
	col = tl.mix3(col, tl.rgb(112, 118, 96), tl.patches(S, r, 2, 16, 0.12, 0.4, aspect=asp) * 0.25)
	rough = 0.84 + 0.06 * (1 - late) + 0.08 * chk
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.008, ao_bake=0.3)


# =============================================================================================
def wood_log(t: tl.Tex) -> dict:
	"""Peeled, weathered spruce building log: drawknife facets, knots with deflected grain, checks,
	cambium remnants, faint blue-stain. U around the log, V along it."""
	S = t.shape
	r = t.rng
	px = t.px
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	# knots: deflect the grain around them
	knots = []
	gdef = np.zeros(S)
	for k in range(3):
		kx, ky = r.random() * t.w, r.random() * t.h
		rx, ry = px(0.014 + 0.012 * r.random()), px(0.02 + 0.018 * r.random())
		dx = (xx - kx + t.w / 2) % t.w - t.w / 2
		dy = (yy - ky + t.h / 2) % t.h - t.h / 2
		dd = (dx / (rx * 2.2)) ** 2 + (dy / (ry * 3.0)) ** 2
		gdef += np.sign(dx) * np.exp(-dd) * rx * 1.4
		knots.append((dx, dy, rx, ry))
	wav = tl.spectral(S, r, 1, 8, 1.6, stretch=4, angle=math.pi / 2) * px(0.01)
	g = xx + wav + gdef
	ph1, _ = _rings_1d(r, t.w, px(0.0045))
	ph = _ring_sample(ph1, g)
	late = _late(ph, 0.32, 0.12)
	# drawknife facets: flat strips across U, slightly concave, varying width
	fac_w = np.cumsum(r.uniform(px(0.03), px(0.08), 40))
	fac_w = fac_w[fac_w < t.w * 1.5]
	fac_w = fac_w / fac_w[-1] * t.w
	edges = np.concatenate([[0], fac_w])
	fid = np.clip(np.searchsorted(edges, xx + tl.spectral(S, r, 1, 6, 1.5, stretch=6, angle=math.pi / 2) * 3, side="right") - 1, 0, len(edges) - 2)
	fpos = (xx - edges[fid]) / (edges[fid + 1] - edges[fid])
	facet = -(1 - (2 * fpos - 1) ** 2) * 0.0014 + r.normal(0, 0.0007, len(edges))[fid]
	height = facet + late * 0.0005 + tl.spectral(S, r, 2, 40, 1.3, stretch=5, angle=math.pi / 2) * 0.0012
	height += tl.spectral(S, r, 80, 500, 0.5, stretch=6, angle=math.pi / 2) * 0.0002
	# checks along the log
	chk = np.zeros(S)
	for k in range(4):
		cx = r.random() * t.w
		cy = r.random() * t.h
		L = px(0.3 + 0.5 * r.random())
		wmax = px(0.0015 + 0.003 * r.random())
		dy = (yy - cy + t.h / 2) % t.h - t.h / 2
		dx = (g - cx + t.w / 2) % t.w - t.w / 2
		s = np.clip(1 - (dy / (L / 2)) ** 2, 0, 1)
		wv = wmax * np.sqrt(s) + 0.3
		chk = np.maximum(chk, (1 - tl.smoothstep(wv * 0.4, wv, np.abs(dx))) * (s > 0))
	height -= chk * 0.005
	# colour: golden tan weathering toward grey
	col = tl.fill(S, tl.rgb(168, 142, 108))
	col = tl.mix3(col, tl.rgb(122, 96, 68), late * 0.6)
	col *= np.exp(0.07 * tl.spectral(S, r, 1, 20, 1.2, stretch=4, angle=math.pi / 2)
	              + 0.04 * tl.spectral(S, r, 40, 300, 0.5, stretch=3, angle=math.pi / 2))[..., None]
	grey = tl.patches(S, r, 2, 14, 0.45, 0.5, stretch=3, angle=math.pi / 2)
	col = tl.mix3(col, tl.rgb(142, 136, 126), grey * 0.6)
	# blue-stain streaks along the grain
	blue = tl.patches(S, r, 3, 40, 0.12, 0.4, stretch=10, angle=math.pi / 2)
	col = tl.mix3(col, tl.rgb(118, 122, 124), blue * 0.4)
	# cambium / inner-bark remnants left by the drawknife
	camb = tl.patches(S, r, 3, 40, 0.06, 0.2, detail=0.4, stretch=12, angle=math.pi / 2)
	col = tl.mix3(col, tl.rgb(112, 80, 56), camb * 0.85)
	height += camb * 0.0006
	# knots: dark, ringed, slightly proud; a resin halo
	for dx, dy, rx, ry in knots:
		kd = np.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
		kin = 1 - tl.smoothstep(0.85, 1.0, kd)
		kr = 0.5 + 0.5 * np.cos(kd * 18)
		col = tl.mix3(col, tl.rgb(84, 56, 36) * (0.7 + 0.4 * kr)[..., None], kin * 0.92)
		kc = (1 - tl.smoothstep(0.02, 0.08, np.abs(np.sin(np.arctan2(dy, dx) * 2.5)))) * kin * tl.smoothstep(0.3, 0.9, kd)
		col = tl.mix3(col, tl.rgb(40, 30, 22), kc * 0.8)
		col = tl.mix3(col, tl.rgb(150, 104, 58), (1 - tl.smoothstep(1.0, 1.6, kd)) * (1 - kin) * 0.4)
		height += kin * 0.0008 - (1 - tl.smoothstep(0.0, 0.12, np.abs(kd - 1.0))) * 0.0006
	col = tl.mix3(col, tl.rgb(52, 40, 30), chk * 0.9)
	rough = 0.72 + 0.1 * grey + 0.05 * (1 - late) + 0.1 * chk
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.01, ao_bake=0.25)


# =============================================================================================
def wood_endgrain(t: tl.Tex) -> dict:
	"""Chainsawn log end: slightly eccentric pith, 90-ish rings narrowing outward, radial checks,
	sapwood, bark ring, blue-stain wedges, saw-chain ridges. Disc fills UV 0..1 (not tiling)."""
	S = t.shape
	r = t.rng
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	u = (xx + 0.5) / t.w - 0.5
	v = (yy + 0.5) / t.h - 0.5
	R_out = 0.485                                  # bark outer edge (UV)
	bark_t = 0.028 + 0.006 * np.sin(np.arctan2(v, u) * 5 + 1.3)
	R_wood = R_out - bark_t
	pcx, pcy = r.normal(0, 0.03), r.normal(0, 0.03)
	du, dv = u - pcx, v - pcy
	rad = np.sqrt(du * du + dv * dv)
	ang = np.arctan2(dv, du)
	# ring irregularity: low-order angular harmonics + noise
	shape = 1 + 0.035 * np.sin(2 * ang + r.random() * 6) + 0.02 * np.sin(3 * ang + r.random() * 6)
	radn = rad * shape + tl.spectral(S, r, 2, 20, 1.5) * 0.004
	# ring radii: wide juvenile rings, narrowing with age, climate noise
	nring = 95
	w = np.exp(-np.linspace(0, 1.6, nring)) * r.lognormal(0, 0.35, nring)
	bnd = np.concatenate([[0], np.cumsum(w)])
	bnd = bnd / bnd[-1] * 0.5
	ri = np.clip(np.searchsorted(bnd, radn, side="right") - 1, 0, nring - 1)
	ph = (radn - bnd[ri]) / (bnd[ri + 1] - bnd[ri])
	late = _late(np.clip(ph, 0, 1), 0.28, 0.12)
	wood_mask = rad < R_wood
	sap = tl.smoothstep(0.34, 0.40, radn)
	early_c = tl.lerp(tl.rgb(194, 160, 114), tl.rgb(210, 182, 138), sap[..., None])
	late_c = tl.lerp(tl.rgb(136, 96, 58), tl.rgb(158, 120, 80), sap[..., None])
	col = early_c + (late_c - early_c) * late[..., None]
	col *= np.exp(0.05 * tl.spectral(S, r, 4, 60, 1.0) + 0.05 * tl.spectral(S, r, 100, 512, 0.3))[..., None]
	# weathering: greyed, dirtier toward the rim
	col = tl.mix3(col, tl.rgb(150, 140, 126), tl.smoothstep(0.2, 0.47, rad) * 0.25)
	# blue-stain wedges from the rim
	bw = tl.smoothstep(0.8, 1.6, np.sin(ang * 3 + r.random() * 6) + 0.6 * tl.spectral(S, r, 3, 20, 1.2)) * tl.smoothstep(0.25, 0.45, rad)
	col = tl.mix3(col, tl.rgb(128, 132, 134), bw * 0.45)
	# saw-chain ridges: parallel slightly curved lines across the face
	saw = np.sin((u * 0.94 + 0.12 * v * v) * 2 * math.pi * 38 + tl.spectral(S, r, 2, 12, 1.4) * 0.8)
	height = saw * 0.00025 + late * 0.00015 + tl.spectral(S, r, 60, 400, 0.6) * 0.0002
	col *= (1 + saw[..., None] * 0.02)
	# radial checks: wedge cracks from the rim inward + a small pith check
	chk = np.zeros(S)
	jag = tl.spectral(S, r, 10, 80, 1.0)
	for k in range(int(r.integers(4, 7))):
		a0 = r.random() * 2 * math.pi
		depth = 0.12 + 0.28 * r.random()
		da = np.angle(np.exp(1j * (ang - a0 - jag * 0.0012 / np.maximum(rad, 0.05))))
		inner = R_wood - depth
		frac = np.clip((rad - inner) / depth, 0, 1)
		width = (0.0008 + 0.012 * frac ** 1.5) / np.maximum(rad, 0.01)
		c = (1 - tl.smoothstep(width * 0.5, width, np.abs(da))) * (rad > inner) * wood_mask
		chk = np.maximum(chk, c)
	pc = (1 - tl.smoothstep(0.001, 0.004, np.abs(dv * math.cos(1.1) - du * math.sin(1.1)))) * (rad < 0.06)
	chk = np.maximum(chk, pc * wood_mask)
	height -= chk * 0.01
	col = tl.mix3(col, tl.rgb(46, 34, 26), chk * 0.9)
	# pith
	col = tl.mix3(col, tl.rgb(110, 76, 46), 1 - tl.smoothstep(0.004, 0.009, rad))
	# inner bark (phloem) thin reddish layer, then scaly outer bark
	phl = (rad >= R_wood) & (rad < R_wood + 0.006)
	bark_col = tl.fill(S, tl.rgb(84, 70, 60)) * np.exp(0.2 * tl.spectral(S, r, 60, 300, 0.5))[..., None]
	col = np.where(phl[..., None], tl.fill(S, tl.rgb(120, 70, 48)), col)
	col = np.where((rad >= R_wood + 0.006)[..., None], bark_col, col)
	bark_h = -0.002 + tl.spectral(S, r, 40, 250, 0.8) * 0.0015
	height = np.where(rad >= R_wood, bark_h, height)
	rough = np.where(rad >= R_wood, 0.9, 0.78 + 0.08 * (1 - late)) + chk * 0.1
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.006, ao_bake=0.3)


# =============================================================================================
def _boards(t: tl.Tex, r, paint: bool = False) -> dict:
	"""Vertical board wall: returns height, wood colour, masks (gap, nail, board id...)."""
	S = t.shape
	px = t.px
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	xx = (xx + t.w * 0.043) % t.w          # keep board joints off the tile border
	widths = r.uniform(0.15, 0.26, 20)
	widths = widths[np.cumsum(widths) < t.tile_w_m + 0.1]
	widths = widths / widths.sum() * t.w
	edges = np.concatenate([[0], np.cumsum(widths)])
	nb = len(widths)
	bid = np.clip(np.searchsorted(edges, xx, side="right") - 1, 0, nb - 1)
	xl = (xx - edges[bid]) / widths[bid]                      # 0..1 across board
	# butt joints on a few boards
	joint_y = np.where(r.random(nb) < 0.35, r.random(nb) * t.h, -1e9)
	dyj = np.abs(((yy - joint_y[bid]) + t.h / 2) % t.h - t.h / 2)
	joint = (1 - tl.smoothstep(px(0.002), px(0.004), dyj)) * (joint_y[bid] > -1)
	segment = np.where(((yy - joint_y[bid]) % t.h) < t.h / 2, 0, 1) * (joint_y[bid] > -1)
	sid = bid * 2 + segment
	gap_w = r.uniform(px(0.003), px(0.009), nb)
	dist_edge = np.minimum(xx - edges[bid], edges[bid + 1] - xx)
	gap = 1 - tl.smoothstep(gap_w[bid] * 0.5, gap_w[bid], dist_edge)
	# grain: flat-sawn cathedrals (parabolic phase) with per-segment centre and offsets
	cen = r.uniform(0.2, 0.8, nb * 2)[sid]
	curv = r.uniform(4, 14, nb * 2)[sid]
	per = r.integers(1, 3, nb * 2)[sid]
	phase = ((xl - cen) ** 2 * curv + 0.35 * np.sin(2 * np.pi * (yy / t.h * per + r.random(nb * 2)[sid]))
	         + tl.spectral(S, r, 2, 30, 1.4, stretch=4, angle=math.pi / 2) * 0.12)
	ring_w = r.uniform(0.012, 0.03, nb * 2)[sid]
	ph = (phase / ring_w) % 1.0
	late = _late(ph, 0.3, 0.1)
	# weathered grey boards with brown/dark variation
	tones = np.stack([tl.rgb(128, 122, 114), tl.rgb(120, 104, 88), tl.rgb(150, 146, 140), tl.rgb(96, 88, 80),
	                  tl.rgb(136, 126, 112)])
	bcol = tones[r.choice(5, nb * 2, p=[0.3, 0.2, 0.2, 0.15, 0.15])][sid] * np.exp(r.normal(0, 0.07, nb * 2))[sid][..., None]
	col = bcol * (0.74 + 0.3 * late)[..., None]
	streaks = tl.patches(S, r, 3, 40, 0.3, 0.5, stretch=10, angle=math.pi / 2)
	col = tl.mix3(col, col * np.array([0.72, 0.7, 0.68]), streaks * 0.6)
	col *= np.exp(0.06 * tl.spectral(S, r, 2, 30, 1.2, stretch=5, angle=math.pi / 2)
	              + 0.05 * tl.spectral(S, r, 60, 400, 0.4, stretch=4, angle=math.pi / 2))[..., None]
	# cupping + raised latewood + splits
	cup = (np.abs(xl - 0.5) * 2) ** 2 * r.uniform(0.0005, 0.002, nb)[bid]
	height = cup + late * 0.0009 + tl.spectral(S, r, 4, 60, 1.2, stretch=6, angle=math.pi / 2) * 0.0006
	height += r.normal(0, 0.0015, nb * 2)[sid]
	split = np.zeros(S)
	for k in range(10):
		b = r.integers(0, nb)
		cx = edges[b] + widths[b] * r.uniform(0.2, 0.8)
		cy = r.random() * t.h
		L = px(0.1 + 0.4 * r.random())
		dy = (yy - cy + t.h / 2) % t.h - t.h / 2
		dx = (xx - cx + t.w / 2) % t.w - t.w / 2 + 0.6 * np.sin(dy / 40)
		s = np.clip(1 - (dy / (L / 2)) ** 2, 0, 1)
		wv = px(0.0025) * np.sqrt(s) + 0.3
		split = np.maximum(split, (1 - tl.smoothstep(wv * 0.4, wv, np.abs(dx))) * (s > 0) * (bid == b))
	# knots
	knot = np.zeros(S)
	for k in range(7):
		b = r.integers(0, nb)
		kx = edges[b] + widths[b] * r.uniform(0.25, 0.75)
		ky = r.random() * t.h
		rk = px(0.008 + 0.012 * r.random())
		dd = np.sqrt((((xx - kx + t.w / 2) % t.w - t.w / 2) / rk) ** 2 + ((((yy - ky) + t.h / 2) % t.h - t.h / 2) / (rk * 1.3)) ** 2)
		knot = np.maximum(knot, (1 - tl.smoothstep(0.8, 1.0, dd)) * (bid == b))
	col = tl.mix3(col, tl.rgb(70, 54, 42), knot * 0.85)
	height -= knot * 0.0006
	# nails: two rows (girts), two per board, rust bleeding downward
	nail = np.zeros(S)
	for row_y in (0.12, 0.62):
		for b in range(nb):
			for side in (0.22, 0.78):
				nx = edges[b] + widths[b] * (side + r.normal(0, 0.03))
				ny = (row_y + r.normal(0, 0.004)) * t.h
				dd = np.hypot((xx - nx + t.w / 2) % t.w - t.w / 2, ((yy - ny) + t.h / 2) % t.h - t.h / 2)
				nail = np.maximum(nail, 1 - tl.smoothstep(px(0.0035), px(0.0045), dd))
	rust = tl.blur_dir(nail, px(0.12), angle=math.pi / 2, taps=30, decay=3.0)
	rust = np.clip(tl.gauss_aniso(rust, 1.0, 3.0) * 3.0, 0, 1) * (1 - nail)
	col = tl.mix3(col, tl.rgb(104, 70, 48), rust * 0.6)
	col = tl.mix3(col, tl.rgb(62, 48, 40), nail)
	height += nail * 0.0008
	# gaps and joints
	col = tl.mix3(col, tl.rgb(24, 20, 18), np.clip(gap + joint, 0, 1) * 0.95)
	col = tl.mix3(col, tl.rgb(50, 42, 36), split * 0.9)
	height -= np.clip(gap + joint, 0, 1) * 0.012 + split * 0.003
	return dict(height=height, col=col, late=late, gap=np.clip(gap + joint, 0, 1), nail=nail, rust=rust,
	            split=split, knot=knot, bid=bid, xl=xl)


def wood_planks(t: tl.Tex) -> dict:
	b = _boards(t, t.rng)
	rough = 0.84 + 0.06 * (1 - b["late"]) + 0.1 * b["gap"] - 0.2 * b["nail"]
	metal = b["nail"] * 0.3
	return dict(albedo=b["col"], height=b["height"], rough=rough, metal=metal, ao_radius=0.02, ao_bake=0.3)


def wood_painted(t: tl.Tex) -> dict:
	r = t.rng
	S = t.shape
	b = _boards(t, r, paint=True)
	# paint survives in the middle of boards, peels along the grain; crackle (alligatoring) where thin
	peel = tl.spectral(S, r, 3, 60, 1.1, stretch=9, angle=math.pi / 2) + 0.45 * tl.spectral(S, r, 20, 250, 0.8, stretch=6, angle=math.pi / 2)
	peel = (peel - peel.mean()) / peel.std()
	edge_bias = (np.abs(b["xl"] - 0.5) * 2) ** 4 * 1.4 + b["late"] * 0.25
	keep = peel - edge_bias + 1.0
	paint = tl.smoothstep(0.0, 0.08, keep) * (1 - b["gap"])
	crk = tl.worley(S, r, 5000, k=2, sy=1.6)
	crackle = (1 - tl.smoothstep(0.0, 0.0012, crk.edge)) * tl.smoothstep(0.6, 0.0, keep)
	paint = paint * (1 - crackle * 0.9)
	red = tl.fill(S, tl.rgb(118, 50, 42)) * np.exp(0.08 * tl.spectral(S, r, 2, 40, 1.2) + 0.05 * tl.spectral(S, r, 80, 400, 0.4))[..., None]
	chalk = tl.smoothstep(-0.5, 1.5, tl.spectral(S, r, 2, 24, 1.2))
	red = tl.mix3(red, tl.rgb(146, 96, 86), chalk * 0.35)
	col = tl.mix3(b["col"], red, paint)
	col = tl.mix3(col, tl.rgb(104, 70, 48), b["rust"] * 0.5)
	col = tl.mix3(col, tl.rgb(62, 48, 40), b["nail"])
	# paint edge lip and thickness
	height = b["height"] + paint * 0.00025 + tl.gauss(paint, 0.7) * 0.0001
	rough = np.where(paint > 0.5, 0.62 + 0.15 * chalk, 0.86) + 0.1 * b["gap"] - 0.2 * b["nail"]
	return dict(albedo=col, height=height, rough=rough, metal=b["nail"] * 0.3, ao_radius=0.02, ao_bake=0.3)

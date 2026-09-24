"""THIN AIR terrain layers built from scattered objects: scree, gravel, grass, forest floor, trail dirt.

Stones are rasterised as real height stamps into a z-buffer (HeightCanvas: the visible surface is the max of
all stones and the fine matrix), thin things (grass blades, needles, twigs) are drawn into an ID buffer
(IdCanvas) with painter's order and then shaded per pixel from their analytic segment geometry.
Heights are in metres; normals come from those heights at the true texel size.
"""
from __future__ import annotations

import math

import numpy as np

import common as cm
import texlib as tl


# ---------------------------------------------------------------------------------------------
# lithologies for loose stones (sRGB) — granite dominant, as in the Aldous Range
# ---------------------------------------------------------------------------------------------
SCREE_LITH = [  # (weight, colour, speckle strength)
	(0.50, (150, 148, 142), 1.0),   # granodiorite, weathered
	(0.18, (112, 110, 106), 0.5),   # dark diorite / gneiss
	(0.14, (128, 118, 104), 0.4),   # iron-stained
	(0.10, (96, 98, 94), 0.3),      # greywacke / argillite
	(0.08, (176, 174, 168), 0.8),   # fresh, light (recent rockfall)
]
GRAVEL_LITH = [
	(0.26, (150, 146, 138), 0.9),   # granite
	(0.16, (86, 88, 84), 0.3),      # basalt / greenstone
	(0.12, (190, 184, 170), 0.2),   # quartzite / vein quartz
	(0.12, (120, 112, 100), 0.4),   # greywacke
	(0.05, (132, 108, 92), 0.3),    # red chert / jasper-ish, muted
	(0.10, (108, 114, 100), 0.4),   # greenschist
	(0.06, (156, 142, 120), 0.4),   # sandstone
	(0.06, (60, 60, 58), 0.2),      # black argillite
]


def _pick_lith(rng, table, n):
	w = np.array([x[0] for x in table])
	idx = rng.choice(len(table), size=n, p=w / w.sum())
	cols = np.stack([tl.rgb(*x[1]) for x in table])
	spk = np.array([x[2] for x in table])
	return idx, cols[idx], spk[idx]


# =============================================================================================
# 3 SCREE — angular talus 5–40 cm with dark gaps
# =============================================================================================
def layer_scree(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	fines = tl.spectral(S, r, 1, 16, 1.4) * 0.03 + tl.spectral(S, r, 60, 400, 0.6) * 0.002
	hc = tl.HeightCanvas(S, fines * 0.5 - 0.20)
	area = t.tile_w_m * t.tile_h_m
	n = 7000
	D = cm.powerlaw_sizes(r, n, 0.06, 0.45, alpha=0.9)
	cum = np.cumsum(np.pi * (D / 2) ** 2 * 0.75)
	n = min(len(D), int(np.searchsorted(cum, area * 3.2)) + 1)
	D = np.sort(D[:n])[::-1]
	rough_n = tl.spectral(S, r, 30, 400, 1.0)
	chip_n = tl.spectral(S, r, 60, 300, 0.8)
	thick_all = np.empty(n)
	for i in range(n):
		d_m = D[i]
		R_px = t.px(d_m / 2)
		thick = d_m * (0.22 + 0.25 * r.random())
		thick_all[i] = thick
		f, rmax = cm.angular_stone(r, R_px, 0.55 + 0.45 * r.random(), r.random() * math.pi, thick)
		cy, cx = r.random() * t.h, r.random() * t.w
		ix, py, px = hc.region(cy, cx, int(rmax) + 2, int(rmax) + 2)
		surf = f(py, px)
		under = hc.z[ix][~np.isnan(surf)]
		small = d_m < 0.16
		rest = np.percentile(under, 8 if small else 35) if under.size else -0.2
		if small:
			rest = min(rest, -0.13)            # small clasts trickle into the gaps, not onto big blocks
		z0 = max(rest, -0.16) - thick * ((0.4 if small else 0.25) + 0.2 * r.random()) + r.normal(0, 0.01)
		surf = surf + z0 + rough_n[ix] * thick * 0.015 + np.minimum(chip_n[ix], 0) * thick * 0.012
		hc.stamp(ix, surf, i)
	height = hc.z
	sid = hc.id
	stone = sid >= 0
	sidc = np.where(stone, sid, 0)
	lith, lcol, lspk = _pick_lith(r, SCREE_LITH, n)
	# stone colour: lithology × per-stone tone × speckle
	gcol, _, _ = cm.granite_grain(t, grain_m=0.006, weather=0.35)
	gnorm = gcol / np.maximum(gcol.mean(axis=(0, 1)), 1e-6)
	tone = np.exp(r.normal(0, 0.09, n))[sidc]
	col = lcol[sidc] * tone[..., None]
	col = col * tl.lerp(1.0, gnorm, lspk[sidc][..., None] * 0.25)
	col *= np.exp(0.10 * tl.spectral(S, r, 20, 200, 0.8))[..., None]
	# per-stone gradient (lighting-independent weathering: tops paler, undersides darker/stained)
	top = tl.smoothstep(-0.05, 0.05, height - (height * 0 + tl.gauss(height, t.px(0.1))))
	col *= (0.92 + 0.12 * top)[..., None]
	# lichen on larger, stable stones
	big = (D > 0.16) & (r.random(n) < 0.45) & (lith != 4)
	la, lc, lrim, lsp = cm.lichen_colonies(t, coverage=0.35, mean_r_m=0.025, mask=big[sidc] * stone)
	col = tl.mix3(col, lc, la * 0.85)
	col = tl.mix3(col, cm.LICHEN_PROTHALLUS, lrim * (lsp == 0) * 0.6 * big[sidc])
	# fines: dark grey-brown grit and soil
	fcol = tl.fill(S, tl.rgb(64, 61, 57)) * np.exp(0.2 * tl.spectral(S, r, 100, 512, 0.2) + 0.1 * tl.spectral(S, r, 2, 30, 1.0))[..., None]
	col = np.where(stone[..., None], col, fcol)
	rough = np.where(stone, 0.78 + 0.05 * rough_n.clip(-2, 2) * 0.5, 0.92)
	rough = rough * (1 - la) + 0.88 * la
	return dict(albedo=col, height=height, rough=rough, ao_bake=0.65, ao_radius=0.18, albedo_target=0.18)


# =============================================================================================
# 4 GRAVEL — rounded river / moraine gravel half-buried in silt
# =============================================================================================
def layer_gravel(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	silt = tl.spectral(S, r, 1, 12, 1.5) * 0.0025 + tl.spectral(S, r, 80, 500, 0.5) * 0.0003
	# faint desiccation cracks in the silt
	mc = tl.worley(S, r, 260, k=2, dx=tl.spectral(S, r, 8, 60, 1.2) * 4, dy=tl.spectral(S, r, 8, 60, 1.2) * 4)
	mcrack = (1 - tl.smoothstep(0.0, 0.0025, mc.edge * t.tile_w_m)) * tl.smoothstep(0.2, 1.0, tl.spectral(S, r, 1, 5, 1.4))
	silt -= mcrack * 0.0015
	hc = tl.HeightCanvas(S, silt)
	area = t.tile_w_m * t.tile_h_m
	n = 90000
	D = cm.powerlaw_sizes(r, n, 0.008, 0.09, alpha=1.7)
	cum = np.cumsum(np.pi * (D / 2) ** 2 * 0.8)
	n = min(len(D), int(np.searchsorted(cum, area * 2.0)) + 1)
	D = D[:n]
	for i in range(n):
		d_m = D[i]
		R_px = t.px(d_m / 2)
		asp = 0.55 + 0.45 * r.random()
		thick = d_m * asp * (0.35 + 0.25 * r.random())
		f = cm.round_stone(r, R_px, asp, r.random() * math.pi, thick, power=0.6 + 0.8 * r.random())
		cy, cx = r.random() * t.h, r.random() * t.w
		rr = int(R_px * 1.1) + 2
		ix, py, px = hc.region(cy, cx, rr, rr)
		surf = f(py, px) - thick * (0.15 + 0.35 * r.random())
		hc.stamp(ix, surf, i)
	height = hc.z
	sid = hc.id
	stone = sid >= 0
	sidc = np.where(stone, sid, 0)
	lith, lcol, lspk = _pick_lith(r, GRAVEL_LITH, n)
	tone = np.exp(r.normal(0, 0.14, n))[sidc]
	col = lcol[sidc] * tone[..., None]
	gcol, _, _ = cm.granite_grain(t, grain_m=0.0025, weather=0.3)
	gnorm = gcol / np.maximum(gcol.mean(axis=(0, 1)), 1e-6)
	col = col * tl.lerp(1.0, gnorm, lspk[sidc][..., None] * 0.7)
	col *= np.exp(0.08 * tl.spectral(S, r, 30, 300, 0.8))[..., None]
	# silt dust coating near the silt line
	above = height - silt
	dust = (1 - tl.smoothstep(0.0, 0.006, above)) * stone
	scol = tl.fill(S, tl.rgb(128, 123, 112)) * np.exp(0.05 * tl.spectral(S, r, 2, 40, 1.2) + 0.05 * tl.spectral(S, r, 120, 512, 0.2))[..., None]
	col = tl.mix3(col, scol, dust * 0.55)
	col = np.where(stone[..., None], col, scol)
	# damp patches (darker, smoother)
	wet = tl.patches(S, r, 3, 24, 0.25, 0.6, detail=0.8)
	col = col * (1 - 0.10 * wet)[..., None]
	col = tl.mix3(col, tl.rgb(70, 66, 58), mcrack * 0.6)
	rough = np.where(stone, 0.58 + 0.08 * r.random(n)[sidc], 0.9)
	rough = rough - wet * np.where(stone, 0.15, 0.2)
	return dict(albedo=col, height=height, rough=rough, ao_bake=0.5, ao_radius=0.04, albedo_target=0.2)


# =============================================================================================
# thin-object helpers (blades, needles, twigs)
# =============================================================================================
class Strokes:
	"""Accumulates polylines drawn into an IdCanvas; keeps per-segment geometry + per-object attributes."""

	def __init__(self, shape):
		self.canvas = tl.IdCanvas(shape)
		self.ax, self.ay, self.bx, self.by = [], [], [], []
		self.ha, self.hb, self.wd, self.obj, self.ta, self.tb = [], [], [], [], [], []
		self.n_obj = 0
		self.attrs: dict[str, list] = {}

	def new_obj(self, **attrs) -> int:
		for k, v in attrs.items():
			self.attrs.setdefault(k, []).append(v)
		self.n_obj += 1
		return self.n_obj - 1

	def poly(self, oid, pts, hs, width_px, radius_m=0.0):
		"""pts: list of (x, y) pixels; hs: height (m) at each point; draws each segment with its own id."""
		m = len(pts)
		L = [0.0]
		for i in range(1, m):
			L.append(L[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
		tot = max(L[-1], 1e-6)
		for i in range(m - 1):
			sid = len(self.ax)
			self.ax.append(pts[i][0]); self.ay.append(pts[i][1])
			self.bx.append(pts[i + 1][0]); self.by.append(pts[i + 1][1])
			self.ha.append(hs[i]); self.hb.append(hs[i + 1])
			self.wd.append(width_px); self.obj.append(oid)
			self.ta.append(L[i] / tot); self.tb.append(L[i + 1] / tot)
			self.canvas.line([pts[i], pts[i + 1]], sid, width=max(1, int(round(width_px))))

	def resolve(self, texel_m):
		"""Returns dict: valid mask, obj id per pixel, t along object (0 base..1 tip), height (m), across (-1..1)."""
		ids = self.canvas.array()
		A = lambda a: np.asarray(a, dtype=np.float64)  # noqa: E731
		ax, ay, bx, by = A(self.ax), A(self.ay), A(self.bx), A(self.by)
		ts, perp, valid = tl.seg_param(ids, ax, ay, bx, by, self.canvas.w, self.canvas.h)
		sid = np.where(valid, ids, 0)
		ha, hb, wd = A(self.ha)[sid], A(self.hb)[sid], A(self.wd)[sid]
		ta, tb = A(self.ta)[sid], A(self.tb)[sid]
		across = np.clip(perp / np.maximum(wd * 0.5 + 0.35, 0.5), -1, 1)
		hgt = ha + (hb - ha) * ts
		bulge = np.sqrt(np.clip(1 - across * across, 0, 1)) * wd * 0.5 * texel_m
		obj = np.asarray(self.obj, dtype=np.int64)[sid]
		return dict(valid=valid, obj=obj, t=ta + (tb - ta) * ts, height=hgt + bulge, across=across, seg=sid)

	def attr(self, name):
		return np.asarray(self.attrs[name])


def _curve(x0, y0, ang, length, bend, nseg, rng, wobble=0.15):
	pts = [(x0, y0)]
	a = ang
	step = length / nseg
	for _ in range(nseg):
		a += bend / nseg + rng.normal(0, wobble / nseg)
		x0 += math.cos(a) * step
		y0 += math.sin(a) * step
		pts.append((x0, y0))
	return pts


# =============================================================================================
# 5 GRASS — dry alpine meadow ground in late autumn (a ground texture; 3D grass is separate)
# =============================================================================================
def layer_grass(t: tl.Tex) -> dict:
	SS = 2
	T = tl.Tex(name=t.name + "_ss", w=t.w * SS, h=t.h * SS, tile_w_m=t.tile_w_m, seed=t.seed or tl.seed_of(t.name))
	S = T.shape
	r = T.rng
	px = T.px
	# soil + a few small stones
	soil_h = tl.spectral(S, r, 2, 40, 1.4) * 0.006 + tl.spectral(S, r, 100, 1000, 0.6) * 0.0006
	hc = tl.HeightCanvas(S, soil_h)
	for i in range(160):
		d = cm.powerlaw_sizes(r, 1, 0.01, 0.06, 2.0)[0]
		f = cm.round_stone(r, px(d / 2), 0.6 + 0.4 * r.random(), r.random() * 3.14, d * 0.3)
		cy, cx = r.random() * T.h, r.random() * T.w
		ix, py, pxx = hc.region(cy, cx, int(px(d / 2) * 1.1) + 2, int(px(d / 2) * 1.1) + 2)
		hc.stamp(ix, f(py, pxx) - d * 0.1, i)
	soil_col = tl.fill(S, tl.rgb(66, 54, 42)) * np.exp(0.15 * tl.spectral(S, r, 2, 60, 1.0) + 0.12 * tl.spectral(S, r, 200, 1000, 0.2))[..., None]
	stone_c = tl.rgb(128, 124, 116) * np.exp(r.normal(0, 0.15, 160))[:, None]
	soil_col = np.where((hc.id >= 0)[..., None], stone_c[np.maximum(hc.id, 0)], soil_col)
	base_h = hc.z

	st = Strokes(S)
	flow = tl.spectral((64, 64), r, 1, 6, 1.5)
	flow = tl.resample(flow, S) * 1.4
	# palette: bleached straw, tan, grey-dead, brown, olive (living bases)
	pal = np.stack([tl.rgb(178, 160, 120), tl.rgb(150, 128, 90), tl.rgb(132, 124, 108),
	                tl.rgb(112, 90, 62), tl.rgb(118, 116, 70), tl.rgb(168, 140, 96)])
	# 1) matted litter: long dead blades lying flat along a local flow
	n_lit = 26000
	for i in range(n_lit):
		x0, y0 = r.random() * T.w, r.random() * T.h
		a = flow[int(y0) % T.h, int(x0) % T.w] + r.normal(0, 0.5)
		L = px(0.03 + 0.09 * r.random())
		pts = _curve(x0, y0, a, L, r.normal(0, 0.5), 3, r)
		z = 0.002 + 0.008 * r.random()
		c = r.choice(6, p=[0.18, 0.22, 0.30, 0.22, 0.03, 0.05])
		oid = st.new_obj(col=c, tone=r.normal(0, 0.1), kind=0)
		st.poly(oid, pts, [z, z + 0.001, z + 0.001, z * 0.8], 1.4 + r.random() * 1.2)
	# 2) tussocks: blades radiating and arching outward from clump centres
	cent = tl.poisson_disc(r, 420, 0.034)
	for (cy, cx) in cent:
		cy *= T.h
		cx *= T.w
		h0 = 0.025 + 0.04 * r.random()
		nb = int(40 + 60 * r.random())
		dom = r.random() * 6.28
		lean = r.random() * 0.8          # tussocks flattened toward one side by snow/wind
		blades = []
		for b in range(nb):
			a = r.random() * 6.28
			a = a + lean * math.sin(dom - a) * 0.8
			L = px(0.05 + 0.11 * r.random() * (1 + 0.5 * lean * math.cos(a - dom)))
			upright = r.random() ** 2
			proj = L * (0.45 + 0.55 * (1 - upright))
			rad0 = px(0.004 + 0.012 * r.random())
			x0, y0 = cx + math.cos(a) * rad0, cy + math.sin(a) * rad0
			blades.append((proj, x0, y0, a, upright, L))
		blades.sort(key=lambda b: -b[0])
		c_base = r.choice(6, p=[0.35, 0.3, 0.12, 0.08, 0.1, 0.05])
		for proj, x0, y0, a, upright, L in blades:
			pts = _curve(x0, y0, a, proj, r.normal(0, 0.6), 4, r, 0.2)
			ztip = 0.003 + 0.012 * r.random()
			zb = h0 * (0.6 + 0.4 * upright)
			hs = [zb, zb * 0.85 + ztip * 0.15, zb * 0.55 + ztip * 0.45, zb * 0.25 + ztip * 0.75, ztip]
			c = c_base if r.random() < 0.6 else r.choice(6, p=[0.3, 0.3, 0.15, 0.1, 0.1, 0.05])
			oid = st.new_obj(col=c, tone=r.normal(0, 0.08), kind=1)
			st.poly(oid, pts, hs, 1.3 + r.random() * 1.4)
	# 3) autumn-red bearberry / crowberry leaves in small mats
	for k in range(60):
		cx, cy = r.random() * T.w, r.random() * T.h
		for j in range(int(6 + 14 * r.random())):
			lx, ly = cx + r.normal(0, px(0.02)), cy + r.normal(0, px(0.02))
			a = r.random() * 6.28
			L = px(0.008 + 0.01 * r.random())
			oid = st.new_obj(col=6 + (r.random() < 0.5), tone=r.normal(0, 0.12), kind=2)
			st.poly(oid, [(lx, ly), (lx + math.cos(a) * L, ly + math.sin(a) * L)], [0.012, 0.012], px(0.006))
	R = st.resolve(T.texel_m)
	valid = R["valid"]
	obj = R["obj"]
	pal_all = np.concatenate([pal, np.stack([tl.rgb(120, 40, 30), tl.rgb(88, 62, 40)])])
	ccol = pal_all[st.attr("col")[obj]] * np.exp(st.attr("tone")[obj])[..., None]
	# along-blade: bases darker/greener, tips bleached; leaves have a midrib
	kind = st.attr("kind")[obj]
	tt = R["t"]
	ccol = np.where((kind == 1)[..., None], ccol * (0.72 + 0.4 * tt)[..., None], ccol)
	ccol = np.where((kind == 1)[..., None] & (tt[..., None] < 0.25), tl.mix3(ccol, tl.rgb(96, 100, 58), (0.25 - tt) * 2.4), ccol)
	ccol *= (0.85 + 0.15 * (1 - np.abs(R["across"])))[..., None]
	h_obj = R["height"] + base_h * 0.0
	above = valid & (h_obj > base_h)
	height = np.where(above, h_obj, base_h)
	col = np.where(above[..., None], ccol, soil_col)
	rough = np.where(above, np.where(kind == 2, 0.55, 0.78), 0.9)
	# resolve supersampling: normals at full res, then box-filter everything
	n_hi = tl.normal_from_height(height, T.texel_m)
	n = tl.downsample(n_hi, SS)
	n /= np.linalg.norm(n, axis=-1, keepdims=True)
	return dict(albedo=tl.downsample(col, SS), height=tl.downsample(height, SS), rough=tl.downsample(rough, SS),
	            normal=n, ao_bake=0.55, ao_radius=0.05, albedo_target=0.16)


# =============================================================================================
# 6 FOREST — spruce forest floor: needle litter over duff, feather-moss cushions, fine twigs
#            (no cones/leaves: distinct objects would betray the tiling — 3D scatter adds those)
# =============================================================================================
def layer_forest(t: tl.Tex) -> dict:
	SS = 2
	T = tl.Tex(name=t.name + "_ss", w=t.w * SS, h=t.h * SS, tile_w_m=t.tile_w_m, seed=t.seed or tl.seed_of(t.name))
	S = T.shape
	r = T.rng
	px = T.px
	duff_h = tl.spectral(S, r, 2, 40, 1.4) * 0.006 + tl.spectral(S, r, 100, 1000, 0.5) * 0.0005
	duff_col = tl.fill(S, tl.rgb(54, 42, 33)) * np.exp(0.18 * tl.spectral(S, r, 3, 60, 1.1)
	                                                  + 0.2 * tl.spectral(S, r, 300, 1000, 0.1))[..., None]
	# moss density: soft-edged cushions (probability of fronds, not a hard mask)
	mden = tl.warp(tl.spectral(S, r, 4, 30, 1.3), *(tl.spectral(S, r, 8, 80, 1.1) * px(0.05) for _ in range(2)))
	moss_d = tl.smoothstep(0.5, 1.6, mden)
	moss_h = tl.gauss(moss_d, px(0.02)) ** 1.2 * (0.008 + 0.010 * tl.norm01(tl.spectral(S, r, 8, 80, 1.1)))
	# needle density: clumps and bare-ish duff spots at mid frequency
	nden = tl.smoothstep(-1.2, 0.8, tl.spectral(S, r, 6, 60, 1.2))
	st = Strokes(S)
	# palette: 0 old needle dark, 1 old grey-brown, 2 fresh rust-brown, 3 orange-brown, 4 twig grey, 5 twig brown,
	#          6 moss yellow-green tip, 7 moss olive, 8 moss dark, 9 bleached needle
	pal = np.stack([tl.rgb(62, 47, 36), tl.rgb(88, 76, 64), tl.rgb(108, 72, 48), tl.rgb(126, 86, 56),
	                tl.rgb(104, 98, 90), tl.rgb(82, 66, 54), tl.rgb(104, 106, 58), tl.rgb(72, 80, 44),
	                tl.rgb(46, 54, 32), tl.rgb(132, 116, 96)])

	def at(a, x, y):
		return a[int(y) % T.h, int(x) % T.w]

	def needle(x0, y0, z, c, a=None):
		a = r.random() * 6.28 if a is None else a
		L = px(0.012 + 0.012 * r.random())
		pts = _curve(x0, y0, a, L, r.normal(0, 0.3), 2, r, 0.1)
		oid = st.new_obj(col=c, tone=r.normal(0, 0.14), kind=0)
		st.poly(oid, pts, [z, z + 0.0005, z], 1.0 + 0.7 * r.random())

	# old decomposing needles (dense mat)
	for i in range(60000):
		x, y = r.random() * T.w, r.random() * T.h
		needle(x, y, at(duff_h, x, y) + 0.001 * r.random(), r.choice([0, 1, 5], p=[0.6, 0.3, 0.1]))
	# moss fronds: star-like shoots (a stem with 2–4 side branches), dense where moss_d is high
	cand = r.random((260000, 2))
	for cy, cx in cand:
		y, x = cy * T.h, cx * T.w
		d = at(moss_d, x, y)
		if r.random() > d:
			continue
		z = at(duff_h, x, y) + at(moss_h, x, y) * (0.75 + 0.25 * r.random())
		a = r.random() * 6.28
		L = px(0.005 + 0.007 * r.random())
		tip = r.random() < 0.3 + 0.4 * d
		c = 6 if tip else r.choice([7, 8], p=[0.6, 0.4])
		oid = st.new_obj(col=c, tone=r.normal(0, 0.12), kind=1)
		x1, y1 = x + math.cos(a) * L, y + math.sin(a) * L
		st.poly(oid, [(x, y), (x1, y1)], [z - 0.001, z], 1.5 + r.random())
		for b in range(2):
			ba = a + (0.7 if b == 0 else -0.7)
			bx, by = x + math.cos(a) * L * 0.5, y + math.sin(a) * L * 0.5
			st.poly(oid, [(bx, by), (bx + math.cos(ba) * L * 0.45, by + math.sin(ba) * L * 0.45)], [z - 0.0005, z - 0.0005], 1.2)
	# fresh needles on top (some lying on the moss), clumped by nden
	for i in range(70000):
		x, y = r.random() * T.w, r.random() * T.h
		if r.random() > 0.35 + 0.65 * at(nden, x, y):
			continue
		if r.random() < at(moss_d, x, y) * 0.55:
			continue
		z = at(duff_h, x, y) + at(moss_h, x, y) + 0.0015 + 0.002 * r.random()
		needle(x, y, z, r.choice([2, 3, 1, 9], p=[0.45, 0.2, 0.25, 0.1]))
	# fine twigs with side branches (thin, low contrast)
	for k in range(22):
		x, y = r.random() * T.w, r.random() * T.h
		a = r.random() * 6.28
		L = px(0.05 + 0.16 * r.random())
		wdt = px(0.002 + 0.003 * r.random())
		z = at(duff_h, x, y) + at(moss_h, x, y) + 0.004 + wdt * T.texel_m * 0.5
		pts = _curve(x, y, a, L, r.normal(0, 0.4), 6, r, 0.25)
		c = r.choice([4, 5])
		oid = st.new_obj(col=c, tone=r.normal(0, 0.1), kind=2)
		st.poly(oid, pts, [z + 0.0015 * math.sin(i) for i in range(len(pts))], wdt)
		for b in range(int(r.integers(1, 5))):
			j = int(r.integers(1, len(pts) - 1))
			ba = a + (1 if r.random() < 0.5 else -1) * (0.5 + 0.5 * r.random())
			bp = _curve(pts[j][0], pts[j][1], ba, L * (0.15 + 0.3 * r.random()), r.normal(0, 0.3), 3, r)
			oid = st.new_obj(col=c, tone=r.normal(0, 0.1), kind=2)
			st.poly(oid, bp, [z, z * 0.97, z * 0.94, z * 0.9], max(1.1, wdt * 0.55))
	R = st.resolve(T.texel_m)
	valid = R["valid"]
	obj = R["obj"]
	kind = st.attr("kind")[obj]
	ccol = pal[st.attr("col")[obj]] * np.exp(st.attr("tone")[obj])[..., None]
	bark = np.exp(0.25 * tl.spectral(S, r, 200, 1000, 0.3))
	ccol = np.where((kind == 2)[..., None], ccol * bark[..., None], ccol)
	ccol *= (0.8 + 0.2 * (1 - np.abs(R["across"]) ** 2))[..., None]
	obj_h = R["height"]
	ground_h = duff_h + moss_h
	ground_col = tl.mix3(duff_col, pal[8], moss_d * 0.7)
	above = valid & (obj_h > ground_h - 0.002)
	height = np.where(above, np.maximum(obj_h, ground_h), ground_h)
	col = np.where(above[..., None], ccol, ground_col)
	# damp shade in the lowest duff, slightly lighter dry litter on humps
	col *= (0.9 + 0.2 * tl.smoothstep(-0.006, 0.006, duff_h))[..., None]
	rough = np.where(above, np.select([kind == 0, kind == 1, kind == 2], [0.62, 0.82, 0.78], 0.7), 0.92)
	n_hi = tl.normal_from_height(height, T.texel_m)
	n = tl.downsample(n_hi, SS)
	n /= np.linalg.norm(n, axis=-1, keepdims=True)
	return dict(albedo=tl.downsample(col, SS), height=tl.downsample(height, SS), rough=tl.downsample(rough, SS),
	            normal=n, ao_bake=0.55, ao_radius=0.04, albedo_target=0.08)


# =============================================================================================
# 7 DIRT — compacted trail dirt / mud with embedded pebbles, damp hollows, bits of litter
# =============================================================================================
def layer_dirt(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	base = tl.spectral(S, r, 1, 6, 1.6) * 0.006 + tl.spectral(S, r, 6, 60, 1.2) * 0.003
	# trampled: elongated scuffs along the trail (image vertical), boot-compacted plates
	scuff = tl.spectral(S, r, 8, 120, 1.0, stretch=4, angle=math.pi / 2) * 0.0015
	plates = tl.worley(S, r, 500, k=2, dx=tl.spectral(S, r, 10, 80, 1.2) * 4, dy=tl.spectral(S, r, 10, 80, 1.2) * 4)
	pmask = tl.smoothstep(0.3, 1.2, tl.spectral(S, r, 2, 12, 1.3))
	pcrack = (1 - tl.smoothstep(0.0, 0.003, plates.edge * t.tile_w_m)) * pmask
	grain = tl.spectral(S, r, 150, 512, 0.2) * 0.0004 + tl.spectral(S, r, 40, 200, 0.8) * 0.0008
	# shallow damp hollows
	pud = tl.warp(tl.spectral(S, r, 3, 14, 1.4), *(tl.spectral(S, r, 10, 80, 1.2) * t.px(0.03) for _ in range(2)))
	basin = -tl.smoothstep(0.8, 2.0, pud) * 0.008
	soil = base + scuff + grain + basin - pcrack * 0.002
	hc = tl.HeightCanvas(S, soil)
	n = 4200
	D = cm.powerlaw_sizes(r, n, 0.006, 0.07, 1.6)
	for i in range(n):
		R_px = t.px(D[i] / 2)
		if r.random() < 0.65:
			f, rm = cm.angular_stone(r, R_px, 0.6 + 0.4 * r.random(), r.random() * 3.14, D[i] * 0.45)
		else:
			f = cm.round_stone(r, R_px, 0.6 + 0.4 * r.random(), r.random() * 3.14, D[i] * 0.45)
			rm = R_px
		cy, cx = r.random() * t.h, r.random() * t.w
		ix, py, px_ = hc.region(cy, cx, int(rm * 1.1) + 2, int(rm * 1.1) + 2)
		hc.stamp(ix, f(py, px_) + soil[ix] - D[i] * (0.1 + 0.2 * r.random()), i)
	height = hc.z
	sid = hc.id
	stone = sid >= 0
	moist = tl.smoothstep(0.2, 1.8, pud + 0.4 * tl.spectral(S, r, 6, 50, 1.1))
	dry = tl.fill(S, tl.rgb(98, 86, 72))
	damp = tl.fill(S, tl.rgb(70, 60, 50))
	col = tl.mix3(dry, damp, moist * 0.8)
	col *= np.exp(0.06 * tl.spectral(S, r, 3, 30, 1.2) + 0.10 * tl.spectral(S, r, 120, 512, 0.2))[..., None]
	# pale dusty silt on scuffed highs, organic dark in cracks/low ground
	col = tl.mix3(col, tl.rgb(128, 118, 104), tl.smoothstep(0.0, 0.003, scuff + grain) * (1 - moist) * 0.45)
	col = tl.mix3(col, tl.rgb(54, 45, 38), np.clip(pcrack * 0.6 + tl.smoothstep(0.0, 0.004, tl.cavity(height, t.px(0.02))) * 0.4, 0, 1))
	scol = np.stack([tl.rgb(128, 124, 116), tl.rgb(96, 94, 90), tl.rgb(140, 128, 110), tl.rgb(110, 104, 96)])
	sc = scol[r.integers(0, 4, n)] * np.exp(r.normal(0, 0.15, n))[:, None]
	sids = np.maximum(sid, 0)
	stone_col = sc[sids] * np.exp(0.12 * tl.spectral(S, r, 100, 512, 0.3))[..., None]
	# stones half-coated with mud near the soil line
	coat = 1 - tl.smoothstep(0.0, 0.004, height - soil)
	stone_col = tl.mix3(stone_col, col, coat * 0.6)
	col = np.where(stone[..., None], stone_col * (1 - 0.3 * moist)[..., None], col)
	# a little forest litter kicked onto the trail (thin needles, grass bits)
	st = Strokes(S)
	for i in range(900):
		x, y = r.random() * t.w, r.random() * t.h
		a = r.random() * 6.28
		L = t.px(0.012 + 0.03 * r.random())
		oid = st.new_obj(col=r.choice(3, p=[0.5, 0.3, 0.2]), kind=0)
		st.poly(oid, [(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)], [0.002, 0.002], 1.0)
	R = st.resolve(t.texel_m)
	dpal = np.stack([tl.rgb(104, 72, 48), tl.rgb(136, 122, 94), tl.rgb(74, 58, 44)])
	deb = R["valid"] & (moist < 0.7) & ~stone
	col = np.where(deb[..., None], tl.lerp(col, dpal[st.attr("col")[R["obj"]]], 0.8), col)
	height = np.where(deb, np.maximum(height, soil + 0.001), height)
	rough = 0.88 - 0.3 * moist + 0.03 * tl.spectral(S, r, 30, 300, 0.5)
	rough = np.where(stone, 0.72 - 0.2 * moist, rough)
	return dict(albedo=col, height=height, rough=rough, ao_bake=0.5, ao_radius=0.05, albedo_target=0.1)

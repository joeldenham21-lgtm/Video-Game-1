"""FINE stage: the playable 3,072 m map at 1.5 m (2049 x 2049).

Order: POI altitude corrections -> detail noise -> couloirs -> strata (cliff bands + ledges) -> glacier
(surface, icefall seracs, crevasses, lateral moraines) -> droplet + thermal erosion -> lake + rivers ->
terminal moraines + avalanche chutes -> trails (least-cost routed, grade limited) -> POI pads -> water re-check.
Every step records what it did in `ctx` (masks the OUT stage turns into textures and the layout).
"""
from __future__ import annotations

import math

import numpy as np
from scipy import ndimage

import design as D
import tlib
from fields import (bilinear, blur, closed_spline, open_spline, point_in_polygon, resample, slope_deg,
					smoothstep)

N, DX, X0 = 2049, 1.5, -1536.0


def coords():
	c = (X0 + np.arange(N) * DX).astype(np.float32)
	return np.meshgrid(c, c)


def to_ij(x, z):
	return int(round((x - X0) / DX)), int(round((z - X0) / DX))


def wendland(r):
	r = np.clip(r, 0.0, 1.0)
	return (1 - r) ** 4 * (4 * r + 1)


# ---------------------------------------------------------------------------------------------- polyline frame
class Frame:
	"""Nearest-sample frame of a dense polyline P (k x >=2: x, z, attrs...) inside a bounding box.
	Fields (all cropped to the box, see .sl): d distance, k sample index, side signed lateral offset,
	s arc length at the nearest sample."""

	def __init__(self, P, radius):
		self.P = P
		x0, x1 = P[:, 0].min() - radius, P[:, 0].max() + radius
		z0, z1 = P[:, 1].min() - radius, P[:, 1].max() + radius
		i0 = max(0, int((x0 - X0) / DX))
		i1 = min(N, int((x1 - X0) / DX) + 2)
		j0 = max(0, int((z0 - X0) / DX))
		j1 = min(N, int((z1 - X0) / DX) + 2)
		self.sl = (slice(j0, j1), slice(i0, i1))
		ii = np.round((P[:, 0] - X0) / DX).astype(np.int64) - i0
		jj = np.round((P[:, 1] - X0) / DX).astype(np.int64) - j0
		H, W = j1 - j0, i1 - i0
		ok = (ii >= 0) & (jj >= 0) & (ii < W) & (jj < H)
		mask = np.ones((H, W), bool)
		idx = np.full((H, W), -1, np.int64)
		ks = np.arange(len(P))[ok]
		mask[jj[ok], ii[ok]] = False
		idx[jj[ok], ii[ok]] = ks
		_, (J, I) = ndimage.distance_transform_edt(mask, return_indices=True)
		k = idx[J, I]
		cx = (X0 + (np.arange(i0, i1)) * DX)[None, :]
		cz = (X0 + (np.arange(j0, j1)) * DX)[:, None]
		px, pz = P[k, 0], P[k, 1]
		kn = np.clip(k + 1, 0, len(P) - 1)
		kp = np.clip(k - 1, 0, len(P) - 1)
		tx = P[kn, 0] - P[kp, 0]
		tz = P[kn, 1] - P[kp, 1]
		tl = np.maximum(np.hypot(tx, tz), 1e-6)
		tx, tz = tx / tl, tz / tl
		rx, rz = cx - px, cz - pz
		self.d = np.hypot(rx, rz)
		self.side = rx * (-tz) + rz * tx
		self.along = rx * tx + rz * tz          # > 0 beyond the last sample at the downstream end
		self.k = k
		seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
		self.S = np.concatenate([[0.0], np.cumsum(seg)])
		self.s = self.S[k]
		self.last = len(P) - 1

	def attr(self, a):
		return self.P[self.k, a]


def dense(pts, step=0.75, smooth=True):
	P = np.asarray(pts, dtype=np.float64)
	return open_spline(P, step) if smooth and len(P) > 2 else _lin(P, step)


def _lin(P, step):
	out = [P[0]]
	for k in range(len(P) - 1):
		a, b = P[k], P[k + 1]
		n = max(1, int(np.ceil(np.hypot(*(b[:2] - a[:2])) / step)))
		for s in range(1, n + 1):
			out.append(a + (b - a) * (s / n))
	return np.array(out)


# ---------------------------------------------------------------------------------------------- stage
class Fine:
	def __init__(self, mid, log, seed):
		self.log = log
		self.seed = seed
		self.X, self.Z = coords()
		self.h = resample(mid["h"], -3072.0, 6.0, X0, DX, N, order=3)
		self.hv = resample(mid["hv"], -3072.0, 6.0, X0, DX, N, order=1)
		self.masks = {}
		self.rivers_out = []
		self.lakes_out = []
		self.trails_out = []
		self.pois_out = []

	# ------------------------------------------------------------------ helpers
	def noise(self, freq, octaves=4, kind="fbm", seed=0, **kw):
		return tlib.noise(N, N, X0, X0, DX, freq, octaves, seed=self.seed + seed, kind=kind, **kw)

	def sample(self, x, z, h=None):
		return bilinear(self.h if h is None else h, X0, DX, x, z)

	# ------------------------------------------------------------------ 1. altitude corrections
	def correct_altitudes(self):
		"""Smoothly move the terrain so every POI (and the summit pyramid) sits near its design altitude
		before any detail/erosion is added; pads later only need small adjustments."""
		hb = blur(self.h, 6.0)
		corr = np.zeros_like(self.h, dtype=np.float64)
		wsum = np.zeros_like(corr)
		radii = dict(summit=420.0, kestrel_station=230.0, ashford_mine=170.0, fire_lookout=150.0,
					 owens_bivouac=160.0, glacier_camp=120.0, trapper_cabin=150.0, crash_site=190.0,
					 ranger_cabin=120.0, ice_cave=60.0)
		for p in D.POIS:
			if p["y"] is None or p["id"] not in radii:
				continue
			R = radii[p["id"]]
			delta = p["y"] - float(self.sample(p["x"], p["z"], hb))
			w = wendland(np.hypot(self.X - p["x"], self.Z - p["z"]) / R)
			if p["id"] == "summit":
				# raise the whole pyramid: the correction falls off with a sharper, peaked profile
				w = w ** 1.3
			corr += w * delta
			wsum += w
			self.log("   correct %-16s by %+7.1f m" % (p["id"], delta))
		# normalise where corrections overlap
		self.h = (self.h + corr / np.maximum(wsum, 1.0)).astype(np.float32)

	# ------------------------------------------------------------------ 2. detail + couloirs + strata
	def detail(self):
		h = self.h
		rel = np.clip((h - self.hv) / 250.0, 0.0, 1.0)
		s = slope_deg(blur(h, 2.0), DX)
		rid = self.noise(1 / 110.0, 5, "ridged", seed=31)
		fb = self.noise(1 / 22.0, 4, "fbm", seed=32)
		bumps = self.noise(1 / 7.0, 3, "fbm", seed=33)
		h = h + (rid - 0.45) * 6.0 * rel + fb * (0.25 + 1.1 * rel) + bumps * 0.18
		# dendritic gullies at 3 m, then a little fall-line texture
		from gen_terrain import face_structure, flow_carve
		h3 = h[::2, ::2]
		c3, _ = flow_carve(h3, 3.0, self.seed + 35, k=0.05, expo=0.42, cap=9.0, slope_lo=14.0, slope_hi=36.0,
						   width_cells=1.0, jitter=0.8)
		cut = resample(h3 - c3, X0, 3.0, X0, DX, N, order=1)
		h = h - cut
		h = face_structure(h, DX, self.seed + 34, [(5.0, 70.0, 0.9), (2.0, 30.0, 0.35)], slope_lo=32.0,
						   slope_hi=52.0, pre_blur=3.0)
		self.h = h.astype(np.float32)

	def strata(self):
		"""Tilted sedimentary bands: steep faces become cliff bands with snow-holding ledges (the look of the
		Canadian Rockies). Records hardness (cliff bands resist erosion)."""
		X, Z, h = self.X, self.Z, self.h
		warp = self.noise(1 / 700.0, 3, seed=41) * 22.0 + self.noise(1 / 170.0, 3, seed=42) * 4.0
		sc = (h + 0.105 * X - 0.07 * Z + warp).astype(np.float64)   # bands dip ~7 deg to the SW
		rng = np.random.default_rng(self.seed + 44)
		lo, hi = float(sc.min()) - 200.0, float(sc.max()) + 200.0
		thick = []
		edges = [lo]
		while edges[-1] < hi:
			t = rng.uniform(26.0, 88.0)
			thick.append(t)
			edges.append(edges[-1] + t)
		thick = np.array(thick)
		edges = np.array(edges)
		hardband = rng.random(len(thick)) < 0.5
		cfrac = rng.uniform(0.25, 0.45, len(thick))
		band = np.clip(np.searchsorted(edges, sc) - 1, 0, len(thick) - 1)
		T = thick[band]
		fr = (sc - edges[band]) / T
		cf = cfrac[band]
		r = 0.42
		# inclined scree ledge (lower part, rises at r x the face rate), cliff above (steeper), soft bands untouched
		g_ledge = r * fr
		g_cliff = r * (1 - cf) + (fr - (1 - cf)) * (1 - r * (1 - cf)) / cf
		kink = smoothstep(1 - cf - 0.06, 1 - cf + 0.06, fr)
		g = g_ledge * (1 - kink) + g_cliff * kink
		g = np.where(hardband[band], g, fr)
		delta = (g - fr) * T
		s = slope_deg(blur(h, 2.5), DX)
		w = smoothstep(30.0, 46.0, s) * (0.6 + 0.3 * smoothstep(2000.0, 2600.0, h))
		self.h = (h + delta * w).astype(np.float32)
		cliff = hardband[band] & (fr > 1 - cf)
		self.hard = np.where(cliff, 0.12, np.where(hardband[band], 0.6, 1.0)).astype(np.float32)
		self.strata_w = w.astype(np.float32)
		self.masks["cliffband"] = (cliff * w).astype(np.float32)

	# ------------------------------------------------------------------ 3. glacier
	def glacier(self):
		P = dense(D.MAP_VALLEYS["glacier"], 0.75)
		F = Frame(P, 180.0)
		sl = F.sl
		X, Z = self.X[sl], self.Z[sl]
		h = self.h[sl].astype(np.float64)
		ys = F.attr(2)
		w0 = F.attr(3)
		Ltot = F.S[-1]
		sn = F.s / Ltot                                           # 0 at the neve head, 1 at the snout
		wob = self.noise(1 / 220.0, 3, seed=51)[sl]
		w = w0 * (1.0 + 0.10 * wob)
		beyond = (F.k >= F.last - 1) & (F.along > 0)
		head = (F.k <= 1) & (F.along < 0)
		w = np.where(beyond, w0 * 0.55, np.where(head, w0 * 0.5, w))
		u = F.d / w
		inside = u < 1.0
		# cross profile: concave neve, convex tongue
		convex = np.interp(sn, [0.0, 0.3, 0.55, 1.0], [-5.0, -1.0, 4.0, 8.0])
		yi = ys + convex * (1.0 - np.clip(u, 0, 1) ** 2)
		# icefall: along-flow steps (serac tiers) between the icefall top and base control points
		S_top = _arc_at(P, F.S, -128, -878)
		S_base = _arc_at(P, F.S, 35, -625)
		inf = smoothstep(S_top - 25, S_top + 15, F.s) * (1 - smoothstep(S_base - 15, S_base + 30, F.s))
		tier = 7.0
		yt = np.floor(yi / tier) * tier + tier * smoothstep(0.55, 1.0, (yi / tier) % 1.0)
		sera = self.noise(1 / 9.0, 3, "ridged", seed=52)[sl]
		yi = yi + inf * ((yt - yi) * 0.75 + (sera - 0.4) * 3.2)
		# undulations on the tongue and neve
		yi = yi + self.noise(1 / 60.0, 3, seed=53)[sl] * 0.9 * (1 - inf)
		# crevasses: arcuate transverse (bowed up-glacier), chevron marginal
		wv = self.noise(1 / 80.0, 3, seed=54)[sl] * 6.0
		sa = F.s + 14.0 * np.clip(u, 0, 1) ** 2 + wv
		lam = np.where(inf > 0.3, 12.0, 38.0)
		ph = (sa / lam) % 1.0
		cw = np.where(inf > 0.3, 0.18, 0.06)
		trans = np.clip(1 - np.abs(ph - 0.5) / (cw * 0.5), 0, 1)
		patches = smoothstep(0.1, 0.45, self.noise(1 / 140.0, 3, seed=56)[sl])
		ext = np.clip(inf * 1.2 + smoothstep(0.62, 0.72, sn) * (1 - smoothstep(0.82, 0.9, sn)) * patches, 0, 1)
		mq = F.s - np.abs(F.side) * 0.95 + wv
		mph = (mq / 17.0) % 1.0
		marg = np.clip(1 - np.abs(mph - 0.5) / 0.05, 0, 1) * smoothstep(0.6, 0.85, u) * patches
		bridge = smoothstep(-0.15, 0.25, self.noise(1 / 35.0, 3, seed=55)[sl])
		crev = np.maximum(trans * ext, marg * 0.8 * (1 - inf)) * bridge * smoothstep(0.98, 0.9, u)
		depth = np.where(inf > 0.3, 7.0, 4.5)
		yi = yi - crev * depth
		# lateral moraines (big on the tongue, none against the neve rock walls) and the ice margin
		mh = np.interp(sn, [0.0, 0.45, 0.6, 1.0], [0.0, 2.0, 14.0, 20.0])
		dout = F.d - w
		mor = mh * np.exp(-((dout - 11.0) / 9.0) ** 2) + mh * 0.6 * np.exp(-((dout - 26.0) / 14.0) ** 2)
		# snout: the ice ends in a steep front above the forefield (the ice cave opens in it)
		front = beyond & inside
		yi = np.where(front, h + (yi - h) * smoothstep(1.0, 0.78, u), yi)
		y_edge = ys + convex * 0.0
		out_side = y_edge + mor
		lateral = (dout > 0) & (dout < 60) & ~beyond
		new = np.where(inside, yi, np.maximum(h, np.where(lateral, out_side, -1e9)))
		# inner moraine face: ice meets moraine steeply within the last 8 % of the width
		edge_blend = smoothstep(0.9, 1.0, u) * inside
		new = new + edge_blend * (mh * 0.35)
		# above the glacier (neve): walls stay; ensure ice never floats above bedrock edges weirdly
		self.h[sl] = new.astype(np.float32)
		ice = np.zeros((N, N), np.float32)
		ice[sl] = np.where(inside, 1.0, 0.0) * smoothstep(1.0, 0.9, u)
		self.masks["ice"] = ice
		mor_m = np.zeros((N, N), np.float32)
		mor_m[sl] = np.clip(mor / 8.0, 0, 1) * (~inside)
		self.masks["moraine"] = mor_m
		crev_m = np.zeros((N, N), np.float32)
		crev_m[sl] = crev * inside
		self.masks["crevasse"] = crev_m
		self.glacier_frame = F
		self.glacier_icefall = (S_top, S_base)

	# ------------------------------------------------------------------ 4. erosion
	def erode(self, drops):
		nodrop = (self.masks["ice"] > 0.2)
		lake_poly = closed_spline(D.LOON_LAKE["outline"], 256)
		inl = point_in_polygon(self.X, self.Z, lake_poly)
		nodrop |= inl
		hard = self.hard * self.strata_w + (1 - self.strata_w) * 0.9
		self.log("   droplets: %d" % drops)
		h0 = self.h.copy()
		h, ero, dep, flow = tlib.droplets(self.h, drops, seed=self.seed + 61, hscale=DX, hardness=hard,
										  nodrop=nodrop, inertia=0.25, capacity=2.0, min_capacity=0.005,
										  deposit=0.08, erode=0.12, evaporate=0.02, gravity=4.0, max_steps=90,
										  radius=2, max_erode_step=0.25)
		# keep ice untouched
		ice = self.masks["ice"] > 0.2
		h = np.where(ice, h0, h)
		self.log("   droplet net change: min %.1f max %.1f" % (float((h - h0).min()), float((h - h0).max())))
		self.log("   thermal (talus)")
		erod = np.clip(hard, 0.05, 1.0) * (1 - ice)
		h = tlib.thermal(h, DX, 36.0, 24, 0.35, erod=erod, fixed=ice.astype(np.uint8))
		self.masks["deposit"] = np.clip(blur(np.maximum(h - h0, 0.0), 1.5) / 1.5, 0, 1).astype(np.float32)
		self.masks["dep_drop"] = blur(dep, 1.0)
		self.masks["ero_drop"] = blur(ero, 1.0)
		self.masks["flow_drop"] = blur(flow, 1.0)
		self.h = h.astype(np.float32)

	# ------------------------------------------------------------------ 5. water
	def lake(self):
		L = D.LOON_LAKE
		level = L["level"]
		poly = closed_spline(L["outline"], 400)
		X, Z = self.X, self.Z
		inside = point_in_polygon(X, Z, poly)
		edge = np.ones((N, N), bool)
		pi = np.round((poly[:, 0] - X0) / DX).astype(int)
		pj = np.round((poly[:, 1] - X0) / DX).astype(int)
		dense_poly = _lin(np.vstack([poly, poly[:1]]), 0.7)
		pi = np.round((dense_poly[:, 0] - X0) / DX).astype(int)
		pj = np.round((dense_poly[:, 1] - X0) / DX).astype(int)
		edge[pj, pi] = False
		d = ndimage.distance_transform_edt(edge) * DX
		h = self.h.astype(np.float64)
		n1 = self.noise(1 / 70.0, 3, seed=71)
		depth = L["max_depth"] * np.clip(d / 110.0, 0, 1) ** 0.75 * (0.8 + 0.25 * n1)
		bed = level - 0.35 - depth - 0.02 * d
		h = np.where(inside, np.minimum(h, bed) * 0.3 + bed * 0.7, h)
		# shore: a gentle beach 0-35 m outside, never below the lake level (no leaks)
		sh = (~inside) & (d < 70)
		lo = level + 0.15 + 0.035 * d
		hi = level + 0.45 + 0.16 * d
		wsh = 1 - smoothstep(35.0, 70.0, d)
		hc = np.clip(h, lo, hi)
		h = np.where(sh, h + (hc - h) * wsh, h)
		self.h = h.astype(np.float32)
		wet = np.zeros((N, N), np.float32)
		wet = np.maximum(wet, np.where(inside, 1.0, np.clip(1 - d / 10.0, 0, 1)).astype(np.float32))
		self.masks["water"] = inside.astype(np.float32)
		self.masks["wet"] = np.maximum(self.masks.get("wet", np.zeros((N, N), np.float32)), wet)
		self.masks["lake_shore_d"] = np.where(inside, 0, d).astype(np.float32)
		self.lakes_out.append(dict(id=L["id"], name=L["name"], x=float(np.mean(poly[:, 0])),
								   z=float(np.mean(poly[:, 1])), level=level,
								   radius=float(np.max(np.hypot(poly[:, 0] - np.mean(poly[:, 0]),
																 poly[:, 1] - np.mean(poly[:, 1])))),
								   max_depth=L["max_depth"],
								   polygon=[[round(float(a), 1), round(float(b), 1)] for a, b in poly[::4]]))

	def tarns(self):
		for t in D.TARNS:
			x, z, r = t["x"], t["z"], t["radius"]
			rr = np.hypot(self.X - x, self.Z - z)
			m = rr < r * 3.5
			if not m.any():
				continue
			base = float(np.percentile(self.h[m & (rr < r * 1.3)], 30))
			level = round(base, 1) if t["level"] is None else t["level"]
			wob = self.noise(1 / 25.0, 2, seed=81 + int(x))
			rn = rr / (r * (1 + 0.18 * wob))
			bed = level - 0.3 - t["max_depth"] * np.clip(1 - rn, 0, 1) ** 0.6
			h = self.h.astype(np.float64)
			h = np.where(rn < 1, np.minimum(h, bed), h)
			rim = (rn >= 1) & (rn < 2.2)
			h = np.where(rim, np.maximum(h, level + 0.2 + (rn - 1) * r * 0.08), h)
			self.h = h.astype(np.float32)
			self.masks["water"] = np.maximum(self.masks["water"], (rn < 1).astype(np.float32))
			self.masks["wet"] = np.maximum(self.masks["wet"], np.clip(1.6 - rn, 0, 1).astype(np.float32))
			self.lakes_out.append(dict(id=t["id"], name=t["name"], x=x, z=z, level=level, radius=r,
									   max_depth=t["max_depth"]))

	def river(self, R):
		"""Carve one river/creek. The water surface is the downstream-monotone smoothed terrain profile."""
		pts = np.array([(p[0], p[1], p[2]) for p in R["points"]], dtype=np.float64)
		P = dense(pts, 0.75)
		kind = R["kind"]
		F = Frame(P, 90.0 if kind == "braided" else 30.0)
		sl = F.sl
		hs = self.h
		# centreline profile
		cy = self.sample(P[:, 0], P[:, 1], blur(hs, 1.0))
		prof = np.minimum.accumulate(cy)
		# lake connections: ends at / starts from lake level
		lvl = D.LOON_LAKE["level"]
		if R["id"] in ("hollow_river", "ashford_creek"):
			prof = np.maximum(prof, lvl + 0.05 * (np.arange(len(prof))[::-1] > 0))
			prof[-1] = lvl
		if R["id"] == "hollow_river_lower":
			prof = np.minimum(prof, lvl - 0.25)
		# smooth, keep monotone
		k = int(24 / 0.75) | 1
		prof = ndimage.uniform_filter1d(prof, k, mode="nearest")
		prof = np.minimum.accumulate(prof)
		# surface
		ys = prof[F.k]
		wv = P[F.k, 2]
		half = wv * 0.5
		d = F.d
		h = self.h[sl].astype(np.float64)
		if kind == "braided":
			bn = tlib.noise(h.shape[0], h.shape[1], 0, 0, 1.0, 1 / 14.0, 4, seed=self.seed + 91)
			# braids: noise stretched along the flow using (s, side) coordinates
			sa = F.s
			sd = F.side
			br = (np.sin(sa / 23.0 + 1.7 * np.sin(sd / 9.0 + sa / 61.0)) * 0.5 +
				  np.sin(sa / 41.0 - sd / 6.5) * 0.35 + bn * 0.35)
			bed = ys + np.clip(br * 0.55 + 0.05, -0.9, 0.55)
			u = d / np.maximum(half, 1.0)
			bank = ys + 0.5 + np.maximum(d - half, 0) * 0.12
			target = np.where(u < 1, bed, bank)
			wgt = 1 - smoothstep(half + 8.0, half + 40.0, d)
			h = np.where(u < 1, target, h + (np.minimum(h, target) - h) * wgt)
			wetm = np.clip(1.3 - u, 0, 1)
		else:
			depth = 0.45 if kind == "creek" else 1.3
			depth = depth + np.minimum(half * 0.04, 0.8)
			u = d / np.maximum(half, 0.8)
			bed = ys - depth * np.clip(1 - u ** 2, 0, 1) - 0.12
			bank = ys + 0.25 + np.maximum(d - half, 0) * (0.55 if kind == "creek" else 0.35)
			target = np.where(u < 1, bed, bank)
			wgt = 1 - smoothstep(half + 3.0, half + (10.0 if kind == "creek" else 18.0), d)
			h = np.where(u < 1, np.minimum(h, bed + 0.0), h + (np.minimum(h, target) - h) * wgt)
			wetm = np.clip(1.5 - u * 0.8, 0, 1) * (d < half + 4)
		self.h[sl] = h.astype(np.float32)
		wet = self.masks["wet"]
		wet[sl] = np.maximum(wet[sl], wetm.astype(np.float32))
		riv = self.masks.setdefault("river", np.zeros((N, N), np.float32))
		riv[sl] = np.maximum(riv[sl], (d < half + 1.0).astype(np.float32))
		gravel = self.masks.setdefault("gravel", np.zeros((N, N), np.float32))
		gw = (half + (35.0 if kind == "braided" else 4.0 if kind == "creek" else 8.0))
		gravel[sl] = np.maximum(gravel[sl], (1 - smoothstep(gw * 0.7, gw, d)).astype(np.float32))
		# layout polyline: sample every ~12 m (denser where steep)
		out = []
		last = -1e9
		for i in range(len(P)):
			s_i = F.S[i]
			steep = i > 0 and (prof[i - 1] - prof[i]) > 0.25
			if s_i - last >= 12.0 or i == len(P) - 1 or (steep and s_i - last >= 3.0):
				out.append([round(float(P[i, 0]), 1), round(float(prof[i]), 2), round(float(P[i, 1]), 1),
							round(float(P[i, 2]), 1)])
				last = s_i
		self.rivers_out.append(dict(id=R["id"], name=R["name"], kind=kind, points=out))

	# ------------------------------------------------------------------ 6. moraines, chutes, fans
	def forefield(self):
		"""Little Ice Age terminal moraine arcs below the snout, bare debris ground in the forefield."""
		sx, sz = 178.0, -470.0
		fx, fz = 0.25, 0.97                                     # flow direction at the snout (to the SSE)
		rx, rz = self.X - sx, self.Z - sz
		along = rx * fx + rz * fz
		lat = rx * fz - rz * fx
		wob = self.noise(1 / 50.0, 3, seed=101) * 8.0
		arcs = np.zeros_like(self.h, dtype=np.float64)
		for r0, hgt in ((48.0, 4.5), (86.0, 3.2), (132.0, 2.4)):
			rr = np.hypot(along * 1.0, lat * 0.62) + wob
			arcs += hgt * np.exp(-((rr - r0) / 6.5) ** 2) * (along > -10)
		zone = (along > -20) & (np.hypot(along, lat * 0.62) < 160)
		self.h = (self.h + arcs * zone * (1 - self.masks["ice"])).astype(np.float32)
		ff = np.clip(1 - np.hypot(np.maximum(along, 0), lat * 0.62) / 170.0, 0, 1) * (along > -30)
		self.masks["moraine"] = np.maximum(self.masks["moraine"], (ff * (1 - self.masks["ice"])).astype(np.float32))

	# ------------------------------------------------------------------ 7. trails
	def trails(self):
		# route on a 3 m grid for speed
		h3 = self.h[::2, ::2]
		n3 = h3.shape[0]
		pen = np.zeros_like(h3, dtype=np.float32)
		water = self.masks["water"][::2, ::2] > 0.5
		river = self.masks.get("river", np.zeros((N, N), np.float32))[::2, ::2] > 0.5
		ice = self.masks["ice"][::2, ::2] > 0.5
		s3 = slope_deg(blur(h3, 1.0), 3.0)
		pen += np.where(water, 400.0, 0.0) + np.where(river, 25.0, 0.0)
		pen += np.clip((s3 - 38.0) / 10.0, 0, 3) * 2.5          # hard to bench-cut across cliffs
		golden_pts = []
		for T in D.TRAILS:
			legs = T["legs"]
			pts_all = []
			climb_ranges = []
			cur = legs[0]["to"]
			for leg in legs[1:]:
				gmax = leg.get("max_grade_deg", T["max_grade_deg"])
				wps = [cur] + list(leg.get("via", [])) + [leg["to"]]
				leg_pts = []
				p_ice = np.where(ice, 0.0 if (leg.get("climb") or T["id"] in ("glacier_route", "summit_ridge")) else 30.0, 0.0)
				for a, b in zip(wps[:-1], wps[1:]):
					ia, ja = int(round((a[0] - X0) / 3.0)), int(round((a[1] - X0) / 3.0))
					ib, jb = int(round((b[0] - X0) / 3.0)), int(round((b[1] - X0) / 3.0))
					if leg.get("ridge"):
						I = np.linspace(ia, ib, max(2, int(np.hypot(ib - ia, jb - ja)) + 1)).round().astype(int)
						J = np.linspace(ja, jb, len(I)).round().astype(int)
					else:
						I, J = tlib.route(h3, 3.0, (ia, ja), (ib, jb), gmax * 0.92, wg=1.5, over=90.0,
										  penalty=pen + p_ice.astype(np.float32), margin=110)
					seg = np.stack([X0 + I * 3.0, X0 + J * 3.0], axis=1).astype(np.float64)
					if len(leg_pts):
						seg = seg[1:]
					leg_pts.extend(seg.tolist())
				if pts_all:
					leg_pts = leg_pts[1:]
				is_climb = 1.0 if (leg.get("climb") or T.get("climb")) else 0.0
				pts_all.extend([[p[0], p[1], is_climb] for p in leg_pts])
				cur = leg["to"]
			P = np.array(pts_all)
			P = _chaikin(P, 3)
			self._carve_trail(T, P)
			golden_pts.append((T, P))
		self.trail_paths = golden_pts

	def _carve_trail(self, T, P):
		P = _lin(P, 1.5)
		climb = P[:, 2] > 0.5
		P = P[:, :2]
		y = self.sample(P[:, 0], P[:, 1], blur(self.h, 1.5))
		# keep the path over water at the water surface (fords)
		k = max(3, int(12 / 1.5)) | 1
		ys = ndimage.uniform_filter1d(y, k, mode="nearest")
		# grade limit (forward/backward) so the tread never exceeds the trail's max grade
		g_walk = math.tan(math.radians(T["max_grade_deg"] + 3.0))
		g_climb = math.tan(math.radians(max([T["max_grade_deg"]] + [l.get("max_grade_deg", 0) for l in T["legs"]])))
		gm = np.where(climb, g_climb, g_walk)
		ds = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
		for _ in range(4):
			for i in range(1, len(ys)):
				g = gm[i] * ds[i - 1]
				ys[i] = min(max(ys[i], ys[i - 1] - g), ys[i - 1] + g)
			for i in range(len(ys) - 2, -1, -1):
				g = gm[i] * ds[i]
				ys[i] = min(max(ys[i], ys[i + 1] - g), ys[i + 1] + g)
		Q = np.column_stack([P, ys])
		F = Frame(Q, 12.0)
		sl = F.sl
		half = T["width"] * 0.5
		yt = F.attr(2)
		h = self.h[sl].astype(np.float64)
		d = F.d
		river = self.masks.get("river", np.zeros((N, N), np.float32))[sl] > 0.5
		water = self.masks["water"][sl] > 0.5
		shoulder = 5.0 if not T.get("climb") else 3.0
		w = 1 - smoothstep(half, half + shoulder, d)
		w = np.where(river | water, 0.0, w)
		# cut/fill slopes: pull the terrain toward the tread level with a cross-slope limit
		cut = yt + np.maximum(d - half, 0) * 1.1
		fill = yt - np.maximum(d - half, 0) * 0.9
		target = np.clip(h, fill, cut)
		target = np.where(d <= half, yt, target)
		h = h + (target - h) * np.clip(w * 1.6, 0, 1)
		self.h[sl] = h.astype(np.float32)
		tm = self.masks.setdefault("trail", np.zeros((N, N), np.float32))
		tread = (1 - smoothstep(half * 0.6, half + 0.8, d)) * (~(river | water))
		tm[sl] = np.maximum(tm[sl], tread.astype(np.float32))
		# layout: resample every ~8 m
		keep = [0]
		acc = 0.0
		for i in range(1, len(Q)):
			acc += ds[i - 1]
			if acc >= 8.0 or i == len(Q) - 1:
				keep.append(i)
				acc = 0.0
		self.trails_out.append(dict(id=T["id"], name=T["name"], golden=T.get("golden", False),
									width=T["width"], climb=bool(T.get("climb", False)),
									max_grade_deg=T["max_grade_deg"],
									points=[[round(float(Q[i, 0]), 1), round(float(Q[i, 2]), 2),
											 round(float(Q[i, 1]), 1), int(climb[i])] for i in keep]))

	# ------------------------------------------------------------------ 8. pads
	def pads(self):
		X, Z = self.X, self.Z
		for p in D.POIS:
			r = p["flat_radius"]
			if r <= 0 or p["y"] is None:
				continue
			y = p["y"]
			R = max(12.0, r * 1.1)
			wob = self.noise(1 / 30.0, 2, seed=111 + len(p["id"]))
			rr = np.hypot(X - p["x"], Z - p["z"])
			rrw = rr * (1 + 0.1 * wob)
			m = rrw < r + R
			if p["id"] == "summit":
				R = 10.0
			w = np.clip(1 - smoothstep(r, r + R, rrw), 0, 1)
			h = self.h.astype(np.float64)
			self.h = np.where(m, h + (y - h) * w, h).astype(np.float32)
			pm = self.masks.setdefault("pad", np.zeros((N, N), np.float32))
			pm[:] = np.maximum(pm, (1 - smoothstep(r * 0.7, r + 2.0, rrw)).astype(np.float32))
		self._mine_face()
		self._station_shelf()

	def _mine_face(self):
		"""Rock face behind the Ashford Mine bench: the adit portal sits at its foot."""
		p = D.POI["ashford_mine"]
		a = p["adit"]
		dx_, dz_ = a["dir"]
		rx, rz = self.X - a["x"], self.Z - a["z"]
		fwd = rx * dx_ + rz * dz_             # metres into the face
		lat = rx * (-dz_) + rz * dx_
		wlat = 1 - smoothstep(26.0, 55.0, np.abs(lat))
		face = p["y"] + np.where(fwd > 0, np.minimum(fwd * 3.2, 38.0 + fwd * 0.9), -1e9)
		face = face + self.noise(1 / 6.0, 3, "ridged", seed=121) * 1.6 * (fwd > 0)
		h = self.h.astype(np.float64)
		zone = (fwd > -1) & (fwd < 60) & (np.abs(lat) < 55)
		hn = np.where(zone, np.maximum(h, face * wlat + h * (1 - wlat)), h)
		self.h = hn.astype(np.float32)
		rk = self.masks.setdefault("rockface", np.zeros((N, N), np.float32))
		rk[:] = np.maximum(rk, (zone & (fwd > 0.5)).astype(np.float32) * wlat)

	def _station_shelf(self):
		pass

	# ------------------------------------------------------------------ 9. water consistency
	def water_recheck(self):
		"""After trails/pads: make sure the lake bed stays below its level and shores don't dip under it."""
		L = D.LOON_LAKE
		lvl = L["level"]
		inside = self.masks["water"] > 0.5
		d = self.masks["lake_shore_d"]
		h = self.h
		river = self.masks.get("river", np.zeros((N, N), np.float32)) > 0.5
		river = ndimage.binary_dilation(river, iterations=3)
		near = (~inside) & (d < 25) & (d > 0) & ~river
		h = np.where(near, np.maximum(h, lvl + 0.12 + 0.02 * d), h)
		self.h = h.astype(np.float32)


def _arc_at(P, S, x, z):
	i = int(np.argmin(np.hypot(P[:, 0] - x, P[:, 1] - z)))
	return float(S[i])


def _chaikin(P, it):
	P = np.asarray(P, dtype=np.float64)
	for _ in range(it):
		if len(P) < 3:
			return P
		Q = [P[0]]
		for a, b in zip(P[:-1], P[1:]):
			Q.append(0.75 * a + 0.25 * b)
			Q.append(0.25 * a + 0.75 * b)
		Q.append(P[-1])
		P = np.array(Q)
	return P

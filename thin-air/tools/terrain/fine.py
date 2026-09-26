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
		k0 = idx[J, I]
		cx = (X0 + (np.arange(i0, i1)) * DX)[None, :] + np.zeros((H, W))
		cz = (X0 + (np.arange(j0, j1)) * DX)[:, None] + np.zeros((H, W))
		seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
		self.S = np.concatenate([[0.0], np.cumsum(seg)])
		nP = len(P)
		# continuous nearest point: search the segments around the EDT's sample (the EDT only finds the nearest
		# marked cell, whose sample can be a few samples away from the true nearest point)
		step = max(float(np.median(seg)) if len(seg) else DX, 1e-3)
		Wn = int(np.ceil(DX * 1.6 / step)) + 2
		best = np.full((H, W), np.inf)
		kf = k0.astype(np.float64)
		for off in range(-Wn, Wn):
			ka = np.clip(k0 + off, 0, nP - 2)
			ax, az = P[ka, 0], P[ka, 1]
			bx, bz = P[ka + 1, 0], P[ka + 1, 1]
			abx, abz = bx - ax, bz - az
			l2 = np.maximum(abx * abx + abz * abz, 1e-12)
			t = np.clip(((cx - ax) * abx + (cz - az) * abz) / l2, 0.0, 1.0)
			dd = np.hypot(cx - (ax + t * abx), cz - (az + t * abz))
			m = dd < best
			best = np.where(m, dd, best)
			kf = np.where(m, ka + t, kf)
		self.kf = kf
		k = np.clip(np.round(kf).astype(np.int64), 0, nP - 1)
		ka = np.clip(np.floor(kf).astype(np.int64), 0, nP - 2)
		fr = kf - ka
		px = P[ka, 0] * (1 - fr) + P[ka + 1, 0] * fr
		pz = P[ka, 1] * (1 - fr) + P[ka + 1, 1] * fr
		tx = P[ka + 1, 0] - P[ka, 0]
		tz = P[ka + 1, 1] - P[ka, 1]
		tl = np.maximum(np.hypot(tx, tz), 1e-6)
		tx, tz = tx / tl, tz / tl
		rx, rz = cx - px, cz - pz
		self.d = np.hypot(rx, rz)
		self.side = rx * (-tz) + rz * tx
		# beyond the ends: signed distance past the first / last sample along the end tangent
		along_end = (cx - P[-1, 0]) * (P[-1, 0] - P[-2, 0]) / max(seg[-1], 1e-6) + \
			(cz - P[-1, 1]) * (P[-1, 1] - P[-2, 1]) / max(seg[-1], 1e-6)
		along_start = (cx - P[0, 0]) * (P[1, 0] - P[0, 0]) / max(seg[0], 1e-6) + \
			(cz - P[0, 1]) * (P[1, 1] - P[0, 1]) / max(seg[0], 1e-6)
		self.along = np.where(k >= nP - 2, along_end, np.where(k <= 1, along_start, 0.0))
		self.k = k
		self.s = np.interp(kf, np.arange(nP), self.S)
		self.last = nP - 1

	def interp(self, arr):
		"""Per-sample array interpolated at every cell's continuous nearest point."""
		arr = np.asarray(arr, dtype=np.float64)
		return np.interp(self.kf, np.arange(len(arr)), arr)

	def attr(self, a):
		return self.interp(self.P[:, a])


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
		fl = resample(mid["floor"].astype(np.float32), -3072.0, 6.0, X0, DX, N, order=1)
		self.floor_w = np.clip(blur(fl, 6.0) * 1.2, 0.0, 1.0).astype(np.float32)
		# POI pads: keep metre-scale detail, strata and erosion away so pads stay at their design height
		pz = np.zeros((N, N), np.float32)
		for p in D.POIS:
			if p["flat_radius"] > 0 and p["id"] != "summit":
				rr = np.hypot(self.X - p["x"], self.Z - p["z"])
				pz = np.maximum(pz, 1 - smoothstep(p["flat_radius"] + 5.0, p["flat_radius"] + 40.0, rr))
		self.pad_zone = pz.astype(np.float32)
		rw = mid["ramp"] if "ramp" in mid.files else np.zeros_like(mid["h"])
		self.ramp_w = np.clip(resample(rw, -3072.0, 6.0, X0, DX, N, order=1), 0.0, 1.0).astype(np.float32)
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

	# ------------------------------------------------------------------ 2. detail
	def detail(self):
		"""Metre-scale form on top of the 6 m macro terrain: fall-line gullies/couloirs/spurs (erosion noise,
		strongest on steep ground), rock-face roughness, hummocky ground everywhere."""
		h = self.h.astype(np.float64)
		hb = blur(self.h, 5.0)
		s = slope_deg(hb, DX)
		gz, gx = np.gradient(hb.astype(np.float64), DX)
		E = tlib.erosion_noise(gx, gz, X0, X0, DX, 1 / 150.0, 5, 0.5, 2.0, 0.7, 0.08, seed=self.seed + 31)
		steep = smoothstep(14.0, 42.0, s) * (1 - 0.6 * self.ramp_w)
		fl = np.maximum(self.floor_w, self.pad_zone)
		rock = smoothstep(38.0, 55.0, s) * (1 - fl) * (1 - self.ramp_w)
		h += E * (0.9 + 2.6 * steep + 2.5 * rock) * (1 - fl)
		# rock faces: ribs, buttresses and chimneys at 10-80 m (cliffs are rough at every scale)
		rid = self.noise(1 / 26.0, 4, "ridged", seed=32)
		rid2 = self.noise(1 / 75.0, 3, "ridged", seed=37)
		h += ((rid - 0.45) * 3.0 + (rid2 - 0.45) * 6.0) * rock
		h += self.noise(1 / 45.0, 3, seed=33) * (0.35 + 0.9 * steep) + self.noise(1 / 9.0, 3, seed=34) * 0.12
		# valley floors: terraces, old channels and hummocky ground rather than a flat plate
		h += fl * (self.noise(1 / 170.0, 3, seed=35) * 1.6 + self.noise(1 / 55.0, 3, seed=36) * 0.5)
		self.h = h.astype(np.float32)

	def strata(self):
		"""Tilted sedimentary bands: steep faces become cliff bands with snow-holding ledges (the look of the
		Canadian Rockies). Records hardness (cliff bands resist erosion)."""
		X, Z, h = self.X, self.Z, self.h
		warp = self.noise(1 / 700.0, 3, seed=41) * 30.0 + self.noise(1 / 170.0, 3, seed=42) * 6.0
		sc = (h + 0.105 * X - 0.07 * Z + warp).astype(np.float64)   # bands dip ~7 deg to the SW
		rng = np.random.default_rng(self.seed + 44)
		lo, hi = float(sc.min()) - 200.0, float(sc.max()) + 200.0
		thick = []
		edges = [lo]
		while edges[-1] < hi:
			t = rng.uniform(14.0, 46.0)
			thick.append(t)
			edges.append(edges[-1] + t)
		thick = np.array(thick)
		edges = np.array(edges)
		hardband = rng.random(len(thick)) < 0.55
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
		# massive faces vs banded faces: the strata show strongly in some places, hardly at all in others
		patch = smoothstep(-0.25, 0.35, self.noise(1 / 500.0, 3, seed=45))
		w = smoothstep(33.0, 50.0, s) * (0.4 + 0.4 * smoothstep(1900.0, 2600.0, h)) * (0.25 + 0.75 * patch)
		w = w * (1 - self.floor_w) * (1 - self.ramp_w) * (1 - self.pad_zone)
		self.h = (h + delta * w).astype(np.float32)
		cliff = hardband[band] & (fr > 1 - cf)
		self.hard = np.where(cliff, 0.12, np.where(hardband[band], 0.6, 1.0)).astype(np.float32)
		self.strata_w = w.astype(np.float32)
		self.masks["cliffband"] = (cliff * w).astype(np.float32)

	# ------------------------------------------------------------------ 3. glacier
	def glacier(self):
		"""Corrigan Glacier: a smooth ice surface along the designed glacier line (concave neve under the col,
		convex tongue), chaotic seracs in the icefall, shallow crevasse troughs (the crevasse pattern itself is
		drawn by the terrain shader from the detail map), lateral moraines on the tongue and a steep snout.
		The ice blends into the valley walls over the outer 15 % of its width; the neve fades into the snowfields
		under the col instead of ending in a cap."""
		P = dense(D.MAP_VALLEYS["glacier"], 0.75)
		F = Frame(P, 200.0)
		sl = F.sl
		h = self.h[sl].astype(np.float64)
		# smooth longitudinal profile (no kinks at the design control points)
		prof = ndimage.gaussian_filter1d(P[:, 2], 40.0 / 0.75, mode="nearest")
		ys = F.interp(prof)
		w0 = F.attr(3)
		Ltot = F.S[-1]
		sn = F.s / Ltot                                           # 0 at the neve head, 1 at the snout
		wob = self.noise(1 / 220.0, 3, seed=51)[sl]
		wob2 = self.noise(1 / 70.0, 2, seed=58)[sl]
		# the neve spreads into the cirque; margins wander (no ruler-straight ice edges)
		w = w0 * (1.0 + 0.35 * (1.0 - sn) ** 2) * (1.0 + 0.22 * wob + 0.07 * wob2)
		u = F.d / w
		head_d = np.where(F.k <= 1, np.maximum(-F.along, 0.0), 0.0)
		snout_d = np.where(F.k >= F.last - 1, np.maximum(F.along, 0.0), 0.0)
		# cross profile: concave neve, convex tongue
		convex = np.interp(sn, [0.0, 0.3, 0.55, 1.0], [-4.0, -1.0, 4.0, 7.0])
		yi = ys + convex * (1.0 - np.clip(u, 0, 1) ** 2)
		# icefall between its top and base control points: chaotic serac blocks and towers
		S_top = _arc_at(P, F.S, -128, -878)
		S_base = _arc_at(P, F.S, 35, -625)
		inf = smoothstep(S_top - 25, S_top + 15, F.s) * (1 - smoothstep(S_base - 15, S_base + 30, F.s))
		sera = self.noise(1 / 14.0, 3, "ridged", seed=52)[sl]
		blk = self.noise(1 / 38.0, 3, seed=57)[sl]
		yi = yi + inf * ((sera - 0.45) * 3.5 + blk * 2.5)
		# gentle undulations elsewhere
		yi = yi + self.noise(1 / 70.0, 3, seed=53)[sl] * 0.8 * (1 - inf)
		# crevasses: arcuate transverse (bowed down-glacier on the tongue), chevron marginal
		wv = self.noise(1 / 80.0, 3, seed=54)[sl] * 6.0
		sa = F.s + 14.0 * np.clip(u, 0, 1) ** 2 + wv
		lam = np.where(inf > 0.3, 13.0, 34.0)
		ph = (sa / lam) % 1.0
		cw = np.where(inf > 0.3, 0.2, 0.07)
		trans = np.clip(1 - np.abs(ph - 0.5) / (cw * 0.5), 0, 1)
		patches = smoothstep(0.1, 0.45, self.noise(1 / 140.0, 3, seed=56)[sl])
		ext = np.clip(inf * 1.2 + smoothstep(0.62, 0.72, sn) * (1 - smoothstep(0.82, 0.9, sn)) * patches, 0, 1)
		mq = F.s - np.abs(F.side) * 0.95 + wv
		mph = (mq / 17.0) % 1.0
		marg = np.clip(1 - np.abs(mph - 0.5) / 0.05, 0, 1) * smoothstep(0.6, 0.85, u) * patches
		bridge = smoothstep(-0.15, 0.25, self.noise(1 / 35.0, 3, seed=55)[sl])
		crev = np.maximum(trans * ext, marg * 0.8 * (1 - inf)) * bridge * (1 - smoothstep(0.85, 0.97, u))
		yi = yi - crev * np.where(inf > 0.3, 1.2, 0.6)
		# weight of the ice surface: soft margins, faded head, steep snout front
		wi = (1 - smoothstep(0.82, 1.0, u)) * (1 - smoothstep(0.0, 45.0, head_d))
		front = smoothstep(0.0, 1.0, 1 - snout_d / np.maximum(w * 0.35, 6.0))
		wi = wi * front
		# neve basin: above and around the upper glacier the snowpack buries the gullies - smooth broad snowfields
		# up to the headwall (no fall-line grooves radiating from the col)
		hb = blur(self.h, 10.0)[sl].astype(np.float64)
		nz = (1 - smoothstep(0.45, 0.7, sn)) * (1 - smoothstep(1.0, 1.9, u)) * (1 - smoothstep(60.0, 160.0, head_d))
		nz = np.clip(nz, 0.0, 1.0) * 0.9
		h = h * (1 - nz) + hb * nz
		new = h * (1 - wi) + yi * wi
		# lateral moraines on the tongue (sharp-crested ridges just outside the ice), none on the neve
		mh = np.interp(sn, [0.0, 0.45, 0.6, 1.0], [0.0, 2.0, 11.0, 16.0])
		dout = F.d - w
		mor = (mh * np.exp(-((dout - 10.0) / 8.0) ** 2) + mh * 0.5 * np.exp(-((dout - 24.0) / 12.0) ** 2))
		mor = mor * (1 - smoothstep(0.0, 30.0, snout_d)) * (dout > -4.0)
		new = np.maximum(new, np.minimum(h, ys + 2.0) + mor * (dout > 0)) * (dout > 0) + new * (dout <= 0)
		self.h[sl] = new.astype(np.float32)
		ice = np.zeros((N, N), np.float32)
		ice[sl] = np.clip(wi * 1.15, 0, 1)
		self.masks["ice"] = ice
		mor_m = np.zeros((N, N), np.float32)
		mor_m[sl] = np.clip(mor / 6.0, 0, 1) * (1 - np.clip(wi * 1.5, 0, 1))
		self.masks["moraine"] = mor_m
		crev_m = np.zeros((N, N), np.float32)
		crev_m[sl] = crev * wi
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
		h = h0 + (h - h0) * (1 - self.pad_zone)
		self.log("   droplet net change: min %.1f max %.1f" % (float((h - h0).min()), float((h - h0).max())))
		self.log("   thermal (talus)")
		erod = np.clip(hard, 0.05, 1.0) * (1 - ice) * (1 - self.pad_zone)
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
		# centreline profile: best downstream-monotone fit of the terrain (cuts bumps AND fills dips, so the
		# channel never becomes a trench through a spur nor a dam across a hollow)
		cy = self.sample(P[:, 0], P[:, 1], blur(hs, 2.0))
		prof = pava_decreasing(cy)
		# lake connections: ends at / starts from lake level
		lvl = D.LOON_LAKE["level"]
		if R["id"] in ("hollow_river", "ashford_creek", "east_creek"):
			prof = np.maximum(prof, lvl)
			prof[-1] = lvl
		if R["id"] == "hollow_river_lower":
			prof = np.minimum(prof, lvl - 0.25)
		# smooth, keep monotone
		k = int(30 / 0.75) | 1
		prof = ndimage.uniform_filter1d(prof, k, mode="nearest")
		prof = np.minimum.accumulate(prof)
		# surface
		ys = F.interp(prof)
		wv = F.interp(P[:, 2])
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
			ex = np.maximum(d - half, 0)
			target = np.clip(h, ys + 0.35 + ex * 0.01, ys + 0.5 + ex * 0.12)
			wgt = 1 - smoothstep(half + 8.0, half + 45.0, d)
			h = np.where(u < 1, bed, h + (target - h) * wgt)
			wetm = np.clip(1.3 - u, 0, 1)
		else:
			depth = 0.45 if kind == "creek" else 1.3
			depth = depth + np.minimum(half * 0.04, 0.8)
			u = d / np.maximum(half, 0.8)
			bed = ys - depth * np.clip(1 - u ** 2, 0, 1) - 0.12
			ex = np.maximum(d - half, 0)
			bank_tan = 0.62 if kind == "creek" else 0.38
			target = np.clip(h, ys + 0.2 + ex * 0.02, ys + 0.3 + ex * bank_tan)
			margin = 14.0 if kind == "creek" else 26.0
			wgt = 1 - smoothstep(half + 2.0, half + margin, d)
			h = np.where(u < 1, bed, h + (target - h) * wgt)
			wetm = np.clip(1.5 - u * 0.8, 0, 1) * (d < half + 4)
		self.h[sl] = h.astype(np.float32)
		wet = self.masks["wet"]
		wet[sl] = np.maximum(wet[sl], wetm.astype(np.float32))
		riv = self.masks.setdefault("river", np.zeros((N, N), np.float32))
		riv[sl] = np.maximum(riv[sl], (d < half + 1.0).astype(np.float32))
		# water surface around the channel (trail fords grade down to it)
		if not hasattr(self, "river_level"):
			self.river_level = np.full((N, N), np.nan, np.float32)
		rl = self.river_level[sl]
		near = d < half + 1.5
		self.river_level[sl] = np.where(near & (np.isnan(rl) | (ys > rl)), ys, rl).astype(np.float32)
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
						I, J = tlib.route_turn(h3, 3.0, (ia, ja), (ib, jb), gmax * 0.9, wg=1.5, over=600.0, turn_w=2.5,
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
		# fords: where the path crosses a stream the tread comes down to just above the water, approached at the
		# walking grade from both sides (banks are cut into a ramp instead of leaving a 5 m step)
		rlm = getattr(self, "river_level", None)
		if rlm is not None:
			ii = np.clip(np.round((P[:, 0] - X0) / DX).astype(int), 0, N - 1)
			jj = np.clip(np.round((P[:, 1] - X0) / DX).astype(int), 0, N - 1)
			f = rlm[jj, ii].astype(np.float64) + 0.3
			f = np.where(np.isnan(f), np.inf, f)
			if np.isfinite(f).any():
				cap = f.copy()
				for i in range(1, len(cap)):
					cap[i] = min(cap[i], cap[i - 1] + gm[i] * 0.8 * ds[i - 1])
				for i in range(len(cap) - 2, -1, -1):
					cap[i] = min(cap[i], cap[i + 1] + gm[i] * 0.8 * ds[i])
				ys = np.minimum(ys, cap)
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
		# cut/fill slopes: pull the terrain toward the tread level with a cross-slope limit. The tread never
		# cuts more than max_cut into the ground nor fills more than max_fill (a trail is a bench, not a trench):
		# where the graded profile would need more, the tread follows the ground (the router avoids those).
		max_cut, max_fill = (1.5, 1.0) if T.get("climb") else (8.0, 5.0)
		yt = np.clip(yt, h - max_cut, h + max_fill)
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
			if acc >= 3.0 or i == len(Q) - 1:
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
		# pads never fill a stream channel: their weight fades out over the 8 m next to any channel
		riv = self.masks.get("river", np.zeros((N, N), np.float32)) > 0.5
		dch = ndimage.distance_transform_edt(~riv) * DX
		self._river_clear = smoothstep(1.0, 8.0, dch).astype(np.float32)
		for p in D.POIS:
			r = p["flat_radius"]
			if r <= 0 or p["y"] is None:
				continue
			y = p["y"]
			rr = np.hypot(X - p["x"], Z - p["z"])
			# blend ring wide enough that it stays walkable (smoothstep's steepest part <= ~26 deg)
			ring = (rr > r + 10.0) & (rr < r + 14.0)
			dh = float(np.max(np.abs(self.h[ring] - y))) if ring.any() else 0.0
			R = float(np.clip(max(12.0, r * 1.1, dh * 3.0), 12.0, 90.0))
			if p["id"] == "summit":
				R = 10.0
			wob = self.noise(1 / 30.0, 2, seed=111 + len(p["id"]))
			rrw = rr * (1 + 0.1 * wob)
			m = rrw < r + R
			w = np.clip(1 - smoothstep(r, r + R, rrw), 0, 1)
			w = w * self._river_clear
			h = self.h.astype(np.float64)
			self.h = np.where(m, h + (y - h) * w, h).astype(np.float32)
			pm = self.masks.setdefault("pad", np.zeros((N, N), np.float32))
			pm[:] = np.maximum(pm, (1 - smoothstep(r * 0.7, r + 2.0, rrw)).astype(np.float32))
		self._summit_cap()
		self._mine_face()
		self._station_shelf()

	def _summit_cap(self):
		"""Mount Corrigan is the highest point: nothing within 450 m rises above a gentle cone from the summit."""
		p = D.POI["summit"]
		rr = np.hypot(self.X - p["x"], self.Z - p["z"])
		m = rr < 450.0
		cap = p["y"] - 0.05 - 0.06 * np.maximum(rr - p["flat_radius"], 0.0)
		h = self.h
		h[m] = np.minimum(h[m], cap[m])
		self.h = h

	def _mine_face(self):
		"""Rock face behind the Ashford Mine bench: the natural slope west of the bench is steepened into a
		~65 deg face (never more than 14 m proud of the natural ground); the adit portal sits at its foot."""
		p = D.POI["ashford_mine"]
		a = p["adit"]
		dx_, dz_ = a["dir"]
		rx, rz = self.X - a["x"], self.Z - a["z"]
		fwd = rx * dx_ + rz * dz_             # metres into the face
		lat = rx * (-dz_) + rz * dx_
		wlat = 1 - smoothstep(18.0, 42.0, np.abs(lat))
		wf = smoothstep(-2.0, 1.0, fwd) * (1 - smoothstep(26.0, 40.0, fwd))
		face = p["y"] + 0.4 + np.maximum(fwd, 0.0) * 2.2
		face = face + (self.noise(1 / 7.0, 3, "ridged", seed=121) - 0.45) * 1.8 + self.noise(1 / 20.0, 2, seed=122) * 1.2
		h = self.h.astype(np.float64)
		w = wlat * wf
		target = np.minimum(np.maximum(h, face), h + 14.0)
		self.h = (h + (target - h) * w).astype(np.float32)
		rk = self.masks.setdefault("rockface", np.zeros((N, N), np.float32))
		rk[:] = np.maximum(rk, (w * smoothstep(0.5, 2.0, fwd)).astype(np.float32))

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


def pava_decreasing(y):
	"""Least-squares non-increasing fit (pool-adjacent-violators)."""
	y = np.asarray(y, dtype=np.float64)
	vals = []
	wts = []
	lens = []
	for v in y:
		vals.append(v)
		wts.append(1.0)
		lens.append(1)
		while len(vals) > 1 and vals[-2] < vals[-1]:
			w = wts[-2] + wts[-1]
			v2 = (vals[-2] * wts[-2] + vals[-1] * wts[-1]) / w
			l2 = lens[-2] + lens[-1]
			vals.pop(); wts.pop(); lens.pop()
			vals[-1] = v2
			wts[-1] = w
			lens[-1] = l2
	return np.repeat(vals, lens)


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

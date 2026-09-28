"""FINE stage: the playable 3,072 m map at 1.5 m (2049 x 2049).

Order: POI altitude corrections -> summit pyramid -> strata (folded cliff bands + ledges) -> detail noise +
couloirs (cut through the strata) -> glacier
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
from fields import (bilinear, blur, closed_spline, open_spline, point_in_polygon, polyline_nearest, resample,
					slope_deg, smoothstep)

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
		# couloirs: incised fall-line gullies (3-9 m deep, 40-150 m apart) on steep faces, cutting through the
		# strata ledges (detail runs after strata) - their floors collect the snow on a face (outputs.py)
		E2 = tlib.erosion_noise(gx, gz, X0, X0, DX, 1 / 95.0, 3, 0.45, 2.0, 0.8, 0.08, seed=self.seed + 38)
		face = smoothstep(30.0, 44.0, s) * (1 - fl) * (1 - self.ramp_w) * smoothstep(1750.0, 2100.0, hb)
		h -= smoothstep(0.08, 0.7, -E2) * (3.0 + 6.0 * smoothstep(40.0, 55.0, s)) * face
		self.masks["couloir"] = np.maximum(self.masks.get("couloir", 0.0), smoothstep(0.1, 0.6, -E2) * face).astype(np.float32)
		# valley floors: terraces, old channels and hummocky ground rather than a flat plate
		h += fl * (self.noise(1 / 170.0, 3, seed=35) * 1.6 + self.noise(1 / 55.0, 3, seed=36) * 0.5)
		self.h = h.astype(np.float32)

	def summit_pyramid(self):
		"""Mount Corrigan's summit pyramid. The corrected macro surface is a smooth dome here; carve it into a
		real horn: sharp aretes along the designed summit crests (W ridge to the col = the golden path, N and E
		ridges), steep faces between them (each arete is a 'tent' of ~52-60 deg flanks, the faces are where two
		tents meet, so every face is slightly concave with a central couloir), radial couloirs incised into the
		faces and a small, blocky summit block. The faces only remove rock (never raise the glacier/cirques at
		their foot); near the top the aretes may be built up a little. Blended out by ~430 m (the station pad
		at 556 m is untouched)."""
		p = D.POI["summit"]
		sx, sz, sy = p["x"], p["z"], p["y"]
		R_in, R = 260.0, 430.0
		i0, i1 = max(0, int((sx - R - X0) / DX)), min(N, int((sx + R - X0) / DX) + 2)
		j0, j1 = max(0, int((sz - R - X0) / DX)), min(N, int((sz + R - X0) / DX) + 2)
		Xw, Zw = self.X[j0:j1, i0:i1].astype(np.float64), self.Z[j0:j1, i0:i1].astype(np.float64)
		hw = self.h[j0:j1, i0:i1].astype(np.float64)
		r = np.hypot(Xw - sx, Zw - sz)
		nz = lambda f, o, sd, kind="fbm": tlib.noise(j1 - j0, i1 - i0, float(Xw[0, 0]), float(Zw[0, 0]), DX, f, o,
													  seed=self.seed + sd, kind=kind)
		# aretes wander a little (never a ruler-straight crest), more further down
		wob = smoothstep(20.0, 200.0, r)
		qx = Xw + nz(1 / 120.0, 3, 131) * 9.0 * wob
		qz = Zw + nz(1 / 120.0, 3, 132) * 9.0 * wob
		kf = np.tan(np.radians(56.0 + 5.0 * nz(1 / 160.0, 3, 133)))
		# gendarmes and steps along the aretes, towers and bays on the flanks (applied to every tent)
		gend = (nz(1 / 30.0, 3, 138, "ridged") - 0.45) * 7.0 + nz(1 / 90.0, 3, 139) * 6.0
		gend = gend * smoothstep(12.0, 70.0, r)
		best = np.full(r.shape, -1e9)
		dmin = np.full(r.shape, 1e9)
		for name in ("summit_w", "summit_n", "summit_e"):
			pts = [(float(a[0]), float(a[1]), float(a[2])) for a in D.MAP_CRESTS[name]]
			if abs(pts[0][0] - sx) > 1 or abs(pts[0][1] - sz) > 1:
				pts = pts[::-1]
			pts[0] = (sx, sz, sy + 4.0)
			d, attrs, _ = polyline_nearest(qx, qz, pts)
			# the arete itself: a narrow rounded crest (2-4 m), then the flanks
			tent = attrs[0] + gend - kf * np.sqrt(d * d + 9.0) + 3.0 * kf
			best = np.maximum(best, tent)
			dmin = np.minimum(dmin, d)
		hp = best
		# radial couloirs on the faces: fall-line gully noise of the pyramid itself, incised only, deepest
		# mid-face (none on the aretes, none on the summit block)
		gz, gx = np.gradient(blur(hp.astype(np.float32), 2.0).astype(np.float64), DX)
		E = tlib.erosion_noise(gx, gz, float(Xw[0, 0]), float(Zw[0, 0]), DX, 1 / 70.0, 3, 0.5, 2.0, 0.8, 0.05,
							   seed=self.seed + 134)
		face = smoothstep(4.0, 18.0, dmin) * smoothstep(20.0, 80.0, r)
		hp = hp - smoothstep(0.05, 0.6, -E) * (5.0 + 9.0 * smoothstep(60.0, 280.0, r)) * face
		# buttresses / ribs between the couloirs and blocky summit rock
		hp = hp + ((nz(1 / 34.0, 3, 135, "ridged") - 0.45) * 5.0 + (nz(1 / 95.0, 2, 140, "ridged") - 0.45) * 8.0) * face
		blk = (1 - smoothstep(10.0, 45.0, r)) * smoothstep(4.0, 9.0, r)
		hp = hp + (nz(1 / 11.0, 2, 136, "ridged") - 0.5) * 2.4 * blk
		# faces carve (up to 140 m), aretes may add up to 20 m near the top, nothing is added lower down
		up = 20.0 * (1 - smoothstep(120.0, 260.0, r))
		target = np.clip(hp, hw - 140.0, hw + up)
		w = 1 - smoothstep(R_in, R, r * (1 + 0.12 * nz(1 / 200.0, 2, 137)))
		w = w * (1 - self.pad_zone[j0:j1, i0:i1]) * (1 - self.ramp_w[j0:j1, i0:i1] * 0.5)
		self.h[j0:j1, i0:i1] = (hw + (target - hw) * w).astype(np.float32)
		pm = np.zeros((N, N), np.float32)
		pm[j0:j1, i0:i1] = (w * smoothstep(2.0, 20.0, dmin) * (1 - blk)).astype(np.float32)
		self.masks["pyramid"] = pm
		cm = np.zeros((N, N), np.float32)
		cm[j0:j1, i0:i1] = (smoothstep(0.1, 0.6, -E) * face * w).astype(np.float32)
		self.masks["couloir"] = cm
		self.log("   summit pyramid: max %.1f, carved %.0f m max" % (float(self.h[j0:j1, i0:i1].max()),
																		float((hw - self.h[j0:j1, i0:i1]).max())))

	def strata(self):
		"""Tilted, folded sedimentary bands: steep faces get cliff bands with snow-holding ledges (the look of
		the Canadian Rockies) - but like real strata they dip, fold, vary in thickness (thin-bedded runs and
		massive walls), and their ledges pinch out along strike, so faces never read as level contour stripes.
		Couloirs cut through them afterwards (detail()). Records hardness (cliff bands resist erosion) and a
		per-band colour for the shader."""
		X, Z, h = self.X, self.Z, self.h
		warp = self.noise(1 / 700.0, 3, seed=41) * 30.0 + self.noise(1 / 170.0, 3, seed=42) * 6.0
		# folds: the dip changes over 0.5-2 km (up to ~15 deg extra), so neighbouring faces show different dips
		fold = self.noise(1 / 1600.0, 3, seed=46) * 90.0 + self.noise(1 / 480.0, 3, seed=47) * 22.0
		sc = (h + 0.105 * X - 0.07 * Z + warp + fold).astype(np.float64)   # regional dip ~7 deg to the SW
		rng = np.random.default_rng(self.seed + 44)
		lo, hi = float(sc.min()) - 200.0, float(sc.max()) + 200.0
		thick = []
		edges = [lo]
		while edges[-1] < hi:
			# thin-bedded runs (6-20 m) between massive units (30-80 m)
			t = rng.uniform(30.0, 80.0) if rng.random() < 0.3 else rng.uniform(6.0, 20.0)
			thick.append(t)
			edges.append(edges[-1] + t)
		thick = np.array(thick)
		edges = np.array(edges)
		hardband = rng.random(len(thick)) < 0.5
		cfrac = rng.uniform(0.3, 0.7, len(thick))
		bcol = rng.random(len(thick))
		band = np.clip(np.searchsorted(edges, sc) - 1, 0, len(thick) - 1)
		T = thick[band]
		fr = (sc - edges[band]) / T
		cf = cfrac[band]
		r = 0.5
		# inclined scree ledge (lower part, rises at r x the face rate), cliff above (steeper), soft bands untouched
		g_ledge = r * fr
		g_cliff = r * (1 - cf) + (fr - (1 - cf)) * (1 - r * (1 - cf)) / cf
		kink = smoothstep(1 - cf - 0.06, 1 - cf + 0.06, fr)
		g = g_ledge * (1 - kink) + g_cliff * kink
		# ledges pinch out along strike: where this noise is low the hard band is one continuous wall
		lc = smoothstep(-0.2, 0.3, self.noise(1 / 110.0, 3, seed=48) + 0.45 * self.noise(1 / 32.0, 2, seed=49))
		g = fr + (g - fr) * lc
		g = np.where(hardband[band], g, fr)
		delta = (g - fr) * T
		s = slope_deg(blur(h, 2.5), DX)
		# massive faces vs banded faces: the strata show strongly in some places, hardly at all in others
		patch = smoothstep(-0.25, 0.35, self.noise(1 / 500.0, 3, seed=45))
		# alpine faces only: below ~1,800 m the forested valley walls (and the valley trails) keep plain slopes
		w = smoothstep(33.0, 50.0, s) * (0.35 + 0.35 * smoothstep(1900.0, 2600.0, h)) * (0.2 + 0.8 * patch)
		w = w * smoothstep(1650.0, 1900.0, h)
		w = w * (1 - self.floor_w) * (1 - self.ramp_w) * (1 - self.pad_zone)
		self.h = (h + delta * w).astype(np.float32)
		cliff = hardband[band] & (fr > 1 - cf)
		self.hard = np.where(cliff, 0.12, np.where(hardband[band], 0.6, 1.0)).astype(np.float32)
		self.strata_w = w.astype(np.float32)
		self.masks["cliffband"] = (cliff * w * (0.4 + 0.6 * lc)).astype(np.float32)
		# rock colour per band (grey limestone / buff dolomite / dark shale), graded within the band
		self.band_col = np.clip(bcol[band] * 0.8 + 0.2 * fr + 0.08 * self.noise(1 / 60.0, 2, seed=50),
								0.0, 1.0).astype(np.float32)

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
		"""Trails as real mountain paths. Routing (3 m grid, tlib.route_trail) runs over the smoothed landform (the
		metre-scale relief is carved away anyway; over the icefall the serac field is averaged out): grade cost toward
		the leg's max grade, a bench-difficulty cost on steep hillsides and cliffs, turning paid per radian and
		cheaper on gentle ground (hairpins land on benches and ridge noses), and switchback legs never shorter than
		the trail's min_leg. Each trail is then carved as a bench (_carve_trail). Ridge legs (summit) are straight
		lines between their via points with a designed ramp profile; they are carved after the POI pads
		(ridge_trails) so the station pad's blend ring cannot steepen their foot."""
		self.trail_paths = []
		self._ridge_trails = []
		for order, T in enumerate(D.TRAILS):
			if any(leg.get("ridge") for leg in T["legs"][1:]):
				P = self._trail_points(T, None, None, None, None, None)
				self._carve_trail(T, P, order)
				self.trail_paths.append((T, P))
		ice_f = self.masks["ice"]
		hb = blur(self.h, 3.0)
		hr = hb + (blur(self.h, 7.0) - hb) * ice_f
		h3 = hr[::2, ::2].astype(np.float32)
		n3 = h3.shape[0]
		water = self.masks["water"][::2, ::2] > 0.5
		river = self.masks.get("river", np.zeros((N, N), np.float32))[::2, ::2] > 0.5
		ice = ice_f[::2, ::2] > 0.5
		s3 = slope_deg(h3, 3.0)
		pen = np.where(water, 400.0, 0.0) + np.where(river, 25.0, 0.0)
		self._river3 = river
		# a bench on a steep hillside means big cuts; faces over ~40 deg are avoided outright
		pen = pen + np.clip((s3 - 24.0) / 14.0, 0, 1) * 1.2 + np.clip((s3 - 38.0) / 8.0, 0, 3) * 4.0
		turnf = (0.35 + np.clip((s3 - 6.0) / 24.0, 0, 1) * 1.65).astype(np.float32)
		# side trails first, golden path last: where treads meet, the golden path's bench wins
		for order, T in sorted(enumerate(D.TRAILS), key=lambda ot: bool(ot[1].get("golden"))):
			if any(leg.get("ridge") for leg in T["legs"][1:]):
				continue
			P = self._trail_points(T, h3, pen, ice, turnf, n3)
			self._carve_trail(T, P, order)
			self.trail_paths.append((T, P))

	def _trail_points(self, T, h3, pen, ice, turnf, n3):
		"""Route one trail (all its legs) and return the smoothed centre line [x, z, max grade, width]."""
		if True:
			legs = T["legs"]
			pts_all = []
			ridge = False
			cur = legs[0]["to"]
			for leg in legs[1:]:
				gmax = leg.get("max_grade_deg", T["max_grade_deg"])
				wps = [cur] + list(leg.get("via", [])) + [leg["to"]]
				leg_pts = []
				if leg.get("road"):
					# a designed road (design.ROADS, graded into the macro terrain): its centre line as built
					road = next(r for r in D.ROADS if r["id"] == leg["road"])
					seg = D.road_polyline(road, 3.0)[:, :2]
					if pts_all:
						seg = seg[1:]
					w = leg.get("width", T["width"])
					pts_all.extend([[p[0], p[1], gmax, w] for p in seg.tolist()])
					cur = leg["to"]
					continue
				p_ice = np.where(ice, 0.0 if T["id"] in ("glacier_route", "summit_ridge") else 30.0, 0.0)
				# (dilated: a diagonal router step must not hop over a narrow channel for free)
				p_riv = (ndimage.binary_dilation(self._river3, iterations=2) * (T.get("river_pen", 25.0) - 25.0)
						 if h3 is not None and T.get("river_pen") else 0.0)
				min_leg = int(math.ceil(leg.get("min_leg", T.get("min_leg", 24.0)) / 3.0))
				sdir, sb = -1, 0
				used = np.zeros_like(h3, dtype=bool)
				for a, b in zip(wps[:-1], wps[1:]):
					ia, ja = int(round((a[0] - X0) / 3.0)), int(round((a[1] - X0) / 3.0))
					ib, jb = int(round((b[0] - X0) / 3.0)), int(round((b[1] - X0) / 3.0))
					if leg.get("ridge"):
						ridge = True
						I = J = None
					else:
						# keep off this leg's earlier segments (no out-and-back spikes at a via point)
						near_prev = ndimage.binary_dilation(used, iterations=4) if used.any() else used
						if near_prev.any():
							yy, xx = np.ogrid[:n3, :n3]
							near_prev = near_prev & ((yy - ja) ** 2 + (xx - ia) ** 2 > 36)
						# switchback legs must not run side by side closer than a bench allows: re-route with a
						# penalty on the later leg wherever the path comes back within ~8 m of itself
						extra = np.zeros_like(h3)
						best = None
						for _it in range(7):
							I, J = tlib.route_trail(h3, 3.0, (ia, ja), (ib, jb), gmax * 0.9, wg=1.5, over=600.0,
													turn_w=T.get("turn_w", 14.0), min_leg=min_leg,
													penalty=(pen + p_ice + near_prev * 3.0 + extra + p_riv).astype(np.float32),
													turnf=turnf, margin=70, start_dir=sdir, start_b=sb)
							bad = _self_conflicts(I, J)
							if best is None or bad.sum() < best[2].sum():
								best = (I, J, bad)
							if not bad.any():
								break
							m = np.zeros_like(h3, dtype=bool)
							m[J[bad], I[bad]] = True
							extra = extra + ndimage.binary_dilation(m, iterations=3) * 8.0
						I, J = best[0], best[1]
						sdir, sb = tlib.route_end_state(I, J, min_leg)
						used[J, I] = True
					if I is None:
						seg = np.array([a, b], dtype=np.float64)
					else:
						seg = np.stack([X0 + I * 3.0, X0 + J * 3.0], axis=1).astype(np.float64)
					if len(leg_pts):
						seg = seg[1:]
					leg_pts.extend(seg.tolist())
				if pts_all:
					leg_pts = leg_pts[1:]
				w = leg.get("width", T["width"])
				pts_all.extend([[p[0], p[1], gmax, w] for p in leg_pts])
				cur = leg["to"]
			P = np.array(pts_all)
			if ridge:
				return dense(P, 0.75)                     # smooth spline through the via points
			return _smooth_path(np.column_stack([_chaikin(P[:, :2], 3), _chaikin(P[:, 2:], 3)]))

	def ridge_trails(self):
		self.trails_out.sort(key=lambda t: t.pop("_order", 0) if "_order" in t else 0)

	def _ridge_profile(self, T, P, S, y):
		"""Designed tread profile of a ridge trail: the start pad's height out to ramp_start metres, then an even
		ramp to the end POI (end_y, reached ramp_end metres before the end), broken by an optional short climb step
		(a >= 60 deg face of step_h metres with level landings; flagged climb). Returns (ys, climb flags)."""
		R = T["ramp"]
		s0 = R.get("start", 50.0)
		s1 = S[-1] - R.get("end", 4.0)
		y0 = float(np.interp(s0, S, y))
		y1 = float(R["end_y"])
		st_h = float(R.get("step_h", 0.0))
		land = float(R.get("landing", 2.5))
		ys = np.where(S <= s0, y, 0.0)
		climb = np.zeros(len(S), bool)
		if st_h > 0:
			k = int(np.argmin(np.hypot(P[:, 0] - R["step_at"][0], P[:, 1] - R["step_at"][1])))
			ss = S[k]
			run = (s1 - s0) - 2 * land - 1.2
			g = (y1 - y0 - st_h) / run
			ya = y0 + g * (ss - land - s0)                 # foot of the step
			prof = np.where(S < ss - land, y0 + g * (S - s0),
				   np.where(S < ss, ya,
				   np.where(S < ss + 1.2, ya + st_h * (S - ss) / 1.2,
				   np.where(S < ss + 1.2 + land, ya + st_h, ya + st_h + g * (S - ss - 1.2 - land)))))
			climb = (S > ss - 3.0) & (S < ss + 1.2 + 1.0)
		else:
			g = (y1 - y0) / (s1 - s0)
			prof = y0 + g * (S - s0)
		ys = np.where(S <= s0, y, np.where(S >= s1, y1, prof))
		self.log("   %s: ridge ramp %.1f deg over %.0f m%s" % (T["id"], math.degrees(math.atan(g)), s1 - s0,
				 (", climb step %.1f m" % st_h) if st_h > 0 else ""))
		return ys, climb

	def _carve_trail(self, T, P, order=0):
		"""Bench carve. The tread (width per point, level across) follows a smoothed, grade-limited profile; the
		cells within the tread + 0.35 m (so every 1.5 m heightfield triangle the walker stands on lies on the level
		tread) are set to it. Beyond it cut and fill slopes are cones from the tread: they start as a rounded toe
		(~18 deg) and steepen within ~1.8 m to an angle ~16 deg (cut) / ~9 deg (fill) above the natural hillside's,
		so they always meet the hillside again within a few metres (computed as a chamfer envelope over all tread
		cells, so neighbouring switchback legs never fight). Ridge trails use their designed profile and build up
		an arete (fill flanks) where the ground is lower."""
		P = _lin(P, 0.75)
		gm = np.tan(np.radians(P[:, 2]))
		wid = P[:, 3]
		P = P[:, :2]
		ds = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
		S = np.concatenate([[0.0], np.cumsum(ds)])
		y = self.sample(P[:, 0], P[:, 1], blur(self.h, 2.0))
		ridge = "ramp" in T
		if not ridge:
			# switchback turns are level landings, a little wider than the tread (the two legs meet on one
			# platform instead of stepping past each other on the inside of the turn)
			hd = np.unwrap(np.arctan2(np.gradient(P[:, 1]), np.gradient(P[:, 0])))
			k6 = max(1, int(6.0 / 0.75))
			turn = np.zeros(len(P))
			turn[k6:-k6] = np.abs(hd[2 * k6:] - hd[:-2 * k6])
			apex = ndimage.maximum_filter1d((turn > math.radians(100.0)).astype(float), 2 * k6 + 1)
			apex = ndimage.uniform_filter1d(apex, k6, mode="nearest")
			gm = gm * (1 - apex) + np.minimum(gm, math.tan(math.radians(4.0))) * apex
			wid = wid + 2.0 * apex
		if ridge:
			ys, climb = self._ridge_profile(T, P, S, y)
		else:
			climb = np.zeros(len(P), bool)
			k = max(3, int(15 / 0.75)) | 1
			ys = ndimage.uniform_filter1d(ndimage.uniform_filter1d(y, k, mode="nearest"), k, mode="nearest")
			ys = _grade_limit(ys, gm, ds)
			# fords: where the path crosses a stream the tread meets the water: each crossing (a run of samples in the
			# channel) is one level ford just above the water, approached from both sides at <= 0.9 x the walking
			# grade (a perched creek is forded at its level, never tunnelled under nor stepped up onto)
			fset = self._ford_levels(P)
			if fset is not None:
				flo, cap = _ford_cones(fset, gm * 0.9, ds)
				ys = np.minimum(np.maximum(ys, flo), cap)
			# ease the grade limiter's kinks (never above the limit: re-limit after)
			ys = _grade_limit(ndimage.uniform_filter1d(ys, 7, mode="nearest"), gm, ds)
			if fset is not None:
				ys = _grade_limit(np.minimum(np.maximum(ys, flo), cap), gm, ds)
				bad = np.isfinite(fset) & (np.abs(ys - fset) > 0.15)
				if bad.any():
					self.log("   %s: WARNING %d ford samples off the water (worst %.1f m at %s)" % (
						T["id"], int(bad.sum()), float(np.abs(ys - fset)[bad].max()),
						str(P[np.argmax(np.where(bad, np.abs(ys - fset), 0))].round(0))))
		Q = np.column_stack([P, ys])
		reach = 220.0 if ridge else 40.0
		F = Frame(Q, reach)
		sl = F.sl
		half = F.interp(wid) * 0.5
		core = half + 0.35
		yt = F.attr(2)
		h = self.h[sl].astype(np.float64)
		d = F.d
		# beyond the path ends the tread does not continue (the POI pads take over there)
		endcap = np.where(F.k >= F.last - 1, np.maximum(F.along, 0.0), 0.0) + \
			np.where(F.k <= 1, np.maximum(-F.along, 0.0), 0.0)
		river = self.masks.get("river", np.zeros((N, N), np.float32))[sl] > 0.5
		water = self.masks["water"][sl] > 0.5
		rl_sl = getattr(self, "river_level", None)
		rl_sl = rl_sl[sl] if rl_sl is not None else np.full(d.shape, np.nan, np.float32)
		water = water & ~np.isfinite(rl_sl)                   # lake / tarn water; a stream's water is forded
		river = river | (self.masks["water"][sl] > 0.5)
		intread = (d <= core) & (endcap < 0.5) & ~water
		e = np.maximum(d - core, 0.0)
		sn = slope_deg(blur(self.h[sl], 2.0), DX)
		jit = self.noise(1 / 26.0, 2, seed=171)[sl] * 6.0
		t18 = math.tan(math.radians(18.0))
		if ridge:
			a_cut = np.clip(sn + 16.0 + jit, 45.0, 72.0)
			a_fill = np.clip(52.0 + jit * 1.2, 44.0, 62.0)
		else:
			a_cut = np.clip(sn + 16.0 + jit, 40.0, 72.0)
			a_fill = np.clip(sn + 9.0 + jit, 34.0, 66.0)
		tc, tf = np.tan(np.radians(a_cut)), np.tan(np.radians(a_fill))
		# toe: the slope beside the tread starts at ~18 deg and steepens to the cut / fill angle within 1.8 m
		u = np.clip(e / 1.8, 0.0, 1.0)
		Se = np.where(e < 1.8, 1.8 * (u ** 3 - 0.5 * u ** 4), 0.9 + (e - 1.8))
		cut = yt + e * t18 + (tc - t18) * Se
		fill = yt - e * t18 - (tf - t18) * Se
		# neighbouring legs (switchbacks) and the far side of hairpins: reconcile each envelope with every other
		# tread's (a cone at the full cut / fill angle), so no leg's bench digs into or buries the next one
		cut = np.where(intread, yt, cut)
		fill = np.where(intread, yt, fill)
		cut = _cone_env(cut, tc * DX, "min", 12)
		fill = _cone_env(fill, tf * DX, "max", 12)
		# the cut / fill only reach a band beside the tread (daylighting within a few metres on a hillside the
		# router chose; the ridge's arete flanks spread further), so a cone never shaves a distant cliff
		band_c = (8.0, 14.0)
		band_f = (150.0, 210.0) if ridge else (8.0, 14.0)
		w_c = 1 - smoothstep(band_c[0], band_c[1], e)
		w_f = 1 - smoothstep(band_f[0], band_f[1], e)
		target = h + np.maximum(fill - h, 0.0) * w_f
		target = target - np.maximum(target - cut, 0.0) * w_c
		target = np.where(intread, yt, target)
		# fords: the stream bed is never filled, but its banks are cut down to the tread
		# a shallow riffle under the tread: the bed there sits ~0.25 m under the water (0.45 m under the tread)
		rl = getattr(self, "river_level", None)
		rlv = rl[sl].astype(np.float64) - 0.25 if rl is not None else np.full_like(h, -np.inf)
		rlv = np.where(np.isnan(rlv), -np.inf, rlv)
		ford = np.minimum(np.maximum(np.minimum(h, yt), rlv), np.maximum(yt, rlv))
		ford = np.where(np.isfinite(rlv), ford, yt)          # banks (river mask, no water) take the tread
		# a level ford (tread at its water + 0.2): the channel under the tread is one level riffle even where the
		# creek is steep (a short pool; the water profile is levelled to match in _level_ford)
		pool = intread & river & np.isfinite(rlv) & (np.abs(yt - 0.2 - (rlv + 0.25)) < 3.0)
		if not ridge and getattr(self, "_crossings", None):
			near_x = np.zeros_like(pool)
			for kc in self._crossings:
				near_x |= np.abs(F.s - S[kc]) < 8.0
			pool &= near_x
		else:
			pool &= False
		ford = np.where(pool, yt - 0.45, ford)
		target = np.where(river, np.where(intread, ford, h), target)
		target = np.where(water, h, target)
		# an earlier trail's tread stays as it is outside this trail's own tread
		prev = self.masks.get("trail")
		if prev is not None:
			target = np.where((prev[sl] > 0.5) & ~intread, h, target)
		# slightly broken cut/fill faces (no machined planes), never inside the tread
		rough = ((self.noise(1 / 12.0, 2, seed=172)[sl] * 0.45 + self.noise(1 / 4.5, 2, seed=173)[sl] * 0.08) *
				 smoothstep(0.3, 1.5, e) * smoothstep(0.05, 0.6, np.abs(target - h)))
		new = target + rough * (~intread)
		dd = (new - h)[d < core + 16.0]
		self.log("   %s: bench cut max %.1f m, fill max %.1f m" % (T["id"], float(-dd.min()), float(dd.max())))
		if ridge:
			# the arete built over the neve head is rock and snow, not glacier ice
			up = np.clip(new - h, 0.0, None)
			for mk in ("ice", "crevasse"):
				if mk in self.masks:
					self.masks[mk][sl] *= (1 - smoothstep(0.5, 3.0, up)).astype(np.float32)
		self.h[sl] = new.astype(np.float32)
		if pool.any():
			rl[sl] = np.where(pool, yt - 0.2, rl[sl]).astype(np.float32)
		if not ridge:
			for kc in getattr(self, "_crossings", []):
				self._level_ford(P[kc, 0], P[kc, 1], float(ys[kc]) - 0.2, float(wid[kc]) * 0.5 + 0.05)
			self._crossings = []
		tz = self.masks.setdefault("trail_zone", np.zeros((N, N), np.float32))
		tz[sl] = np.maximum(tz[sl], ((1 - smoothstep(core + 2.0, core + 8.0, d)) * (endcap < 0.5)).astype(np.float32))
		tm = self.masks.setdefault("trail", np.zeros((N, N), np.float32))
		tread = (1 - smoothstep(half - 0.2, half + 0.5, d)) * (endcap < 0.5) * (~(river | water))
		tm[sl] = np.maximum(tm[sl], tread.astype(np.float32))
		if T.get("snow"):
			sm = self.masks.setdefault("trail_snow", np.zeros((N, N), np.float32))
			sm[sl] = np.maximum(sm[sl], (1 - smoothstep(half + 1.0, half + 4.0, d)).astype(np.float32))
		# layout: resample every ~3 m (and at every climb step edge)
		keep = [0]
		acc = 0.0
		for i in range(1, len(Q)):
			acc += ds[i - 1]
			if acc >= 3.0 or i == len(Q) - 1 or climb[i] != climb[i - 1]:
				keep.append(i)
				acc = 0.0
		self.trails_out.append(dict(id=T["id"], name=T["name"], golden=T.get("golden", False),
									width=T["width"], climb=bool(climb.any()),
									max_grade_deg=T.get("layout_grade_deg", T["max_grade_deg"]), _order=order,
									points=[[round(float(Q[i, 0]), 1), round(float(Q[i, 2]), 2),
											 round(float(Q[i, 1]), 1), int(climb[i])] for i in keep]))

	def _ford_levels(self, P):
		"""Per path sample: the ford tread height (water + 0.2 m) where the path is in a stream channel, NaN
		elsewhere. A crossing (a run of channel samples, gaps <= 2 samples bridged) is one level ford at its median
		water level; a run whose water level varies by more than 0.6 m (running along a steep creek) follows the
		water sample by sample."""
		rlm = getattr(self, "river_level", None)
		if rlm is None:
			return None
		ii = np.clip(np.round((P[:, 0] - X0) / DX).astype(int), 0, N - 1)
		jj = np.clip(np.round((P[:, 1] - X0) / DX).astype(int), 0, N - 1)
		lv = rlm[jj, ii].astype(np.float64)
		chan = (self.masks.get("river", np.zeros((N, N), np.float32))[jj, ii] > 0.5) & np.isfinite(lv)
		if not chan.any():
			return None
		runs, nr = ndimage.label(ndimage.binary_closing(chan, iterations=2) | chan)
		fset = np.full(len(P), np.nan)
		self._crossings = []
		for r in range(1, nr + 1):
			idx = np.nonzero((runs == r) & chan)[0]
			if len(idx) == 0:
				continue
			w = lv[idx]
			if (idx[-1] - idx[0]) * 0.75 <= 12.0:
				# a crossing: one level ford (on a steep creek the channel is levelled into a short pool under the
				# tread, see _level_ford)
				fset[idx[0]:idx[-1] + 1] = float(np.median(w)) + 0.2
				self._crossings.append(int(idx[(len(idx) - 1) // 2]))
			else:
				fset[idx] = w + 0.2
		return fset

	def _level_ford(self, x, z, level, b):
		"""The stream a trail fords at (x, z) runs level (water `level`) for +-b metres along its course there: the
		layout profile gets two points at that level at the pool's ends (upstream points never below it, downstream
		never above it, so it stays downstream-monotone)."""
		best = None
		for R in self.rivers_out:
			pts = np.array(R["points"], dtype=np.float64)
			if len(pts) < 2:
				continue
			a, c = pts[:-1][:, [0, 2]], pts[1:][:, [0, 2]]
			ab = c - a
			t = np.clip(((x - a[:, 0]) * ab[:, 0] + (z - a[:, 1]) * ab[:, 1]) / np.maximum((ab ** 2).sum(1), 1e-9), 0, 1)
			q = a + ab * t[:, None]
			d = np.hypot(q[:, 0] - x, q[:, 1] - z)
			k = int(np.argmin(d))
			if best is None or d[k] < best[0]:
				best = (float(d[k]), R, pts, k, float(t[k]))
		if best is None or best[0] > 8.0:
			return
		_, R, pts, k, t = best
		seg = np.hypot(*np.diff(pts[:, [0, 2]], axis=0).T)
		S = np.concatenate([[0.0], np.cumsum(seg)])
		sc = S[k] + t * seg[k]
		out = []
		for s_new in (sc - b, sc + b):
			if 0.0 < s_new < S[-1]:
				out.append([float(np.interp(s_new, S, pts[:, c])) for c in range(4)] + [s_new])
		keep = [list(p) + [s] for p, s in zip(pts.tolist(), S) if abs(s - sc) > b]
		allp = sorted(keep + out, key=lambda p: p[-1])
		res = []
		for p in allp:
			s = p[-1]
			y = level if abs(s - sc) <= b + 1e-6 else (max(p[1], level) if s < sc else min(p[1], level))
			res.append([round(p[0], 1), round(y, 2), round(p[2], 1), round(p[3], 1)])
		R["points"] = res

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
			# benches already carved stay as they are in the blend ring (the pad itself is always flat)
			tz = self.masks.get("trail_zone")
			if tz is not None:
				w = np.where(rrw < r, w, w * (1 - tz))
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


def _ford_cones(fset, g, ds):
	"""Floor and cap of a tread profile through fixed ford heights (NaN = free): the profile must leave / reach
	each ford at no more than grade g (tan, per sample) - max / min over fords of fset -+ g * distance."""
	flo = np.where(np.isfinite(fset), fset, -np.inf)
	cap = np.where(np.isfinite(fset), fset, np.inf)
	for i in range(1, len(fset)):
		flo[i] = max(flo[i], flo[i - 1] - g[i] * ds[i - 1])
		cap[i] = min(cap[i], cap[i - 1] + g[i] * ds[i - 1])
	for i in range(len(fset) - 2, -1, -1):
		flo[i] = max(flo[i], flo[i + 1] - g[i] * ds[i])
		cap[i] = min(cap[i], cap[i + 1] + g[i] * ds[i])
	return flo, cap


def _self_conflicts(I, J, gap=14, rad=3.7):
	"""Route cells (3 m grid) that come back within rad cells of an earlier part of the path more than gap cells
	of path before (stacked, side-by-side switchback legs). Returns a bool array over the path (the later cells)."""
	P = np.stack([I, J], axis=1).astype(np.float64)
	n = len(P)
	bad = np.zeros(n, bool)
	if n <= gap:
		return bad
	from scipy.spatial import cKDTree
	tree = cKDTree(P)
	for k, nb in enumerate(tree.query_ball_point(P, rad)):
		if any(k - q > gap for q in nb):
			bad[k] = True
	return bad


def _smooth_path(P, step=1.5, sigma=2.0):
	"""Resample a routed (3 m grid) path every `step` m and Gaussian-smooth it (sigma in samples), ends fixed:
	no grid staircase left in the tread (a level-across bench needs a smooth centre line)."""
	seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
	S = np.concatenate([[0.0], np.cumsum(seg)])
	s = np.linspace(0.0, S[-1], max(2, int(S[-1] / step) + 1))
	Q = np.column_stack([np.interp(s, S, P[:, c]) for c in range(P.shape[1])])
	if len(Q) > 8:
		for c in (0, 1):
			q = ndimage.gaussian_filter1d(Q[:, c], sigma, mode="nearest")
			w = np.clip(np.minimum(np.arange(len(Q)), np.arange(len(Q))[::-1]) / 6.0, 0.0, 1.0)
			Q[:, c] = Q[:, c] * (1 - w) + q * w
	return Q


def _grade_limit(ys, gm, ds, it=4):
	"""Forward/backward clamp so the profile never climbs or drops faster than gm (tan, per point)."""
	ys = np.array(ys, dtype=np.float64)
	for _ in range(it):
		for i in range(1, len(ys)):
			g = gm[i] * ds[i - 1]
			ys[i] = min(max(ys[i], ys[i - 1] - g), ys[i - 1] + g)
		for i in range(len(ys) - 2, -1, -1):
			g = gm[i] * ds[i]
			ys[i] = min(max(ys[i], ys[i + 1] - g), ys[i + 1] + g)
	return ys


_CONE_OFFS = [(0, 1, 1.0), (1, 0, 1.0), (0, -1, 1.0), (-1, 0, 1.0), (1, 1, 1.41421), (1, -1, 1.41421),
			  (-1, 1, 1.41421), (-1, -1, 1.41421), (1, 2, 2.23607), (2, 1, 2.23607), (-1, 2, 2.23607),
			  (2, -1, 2.23607), (1, -2, 2.23607), (-2, 1, 2.23607), (-1, -2, 2.23607), (-2, -1, 2.23607)]


def _cone_env(src, step, mode, iters):
	"""Chamfer (16-neighbour) cone envelope from the defined cells of src (NaN = free): mode "min" gives
	min over sources of (y + slope * distance) (cut limit), "max" gives max of (y - slope * distance) (fill limit).
	step = rise per cell of horizontal distance at the receiving cell (array)."""
	big = 1e9 if mode == "min" else -1e9
	env = np.where(np.isnan(src), big, src)
	H, W = env.shape
	for _ in range(iters):
		new = env.copy()
		for dj, di, L in _CONE_OFFS:
			sh = np.full_like(env, big)
			ys0, ys1 = max(dj, 0), H + min(dj, 0)
			xs0, xs1 = max(di, 0), W + min(di, 0)
			sh[ys0:ys1, xs0:xs1] = env[ys0 - dj:ys1 - dj, xs0 - di:xs1 - di]
			if mode == "min":
				np.minimum(new, sh + step * L, out=new)
			else:
				np.maximum(new, sh - step * L, out=new)
		if np.array_equal(new, env):
			break
		env = new
	return env


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

"""Vectorised polyline distance fields and small numpy helpers for the terrain generator."""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def grid(n, x0, dx):
	"""Coordinates of an n x n vertex grid starting at x0 with spacing dx. Returns (X, Z) float64 [j, i]."""
	c = x0 + np.arange(n) * dx
	return np.meshgrid(c, c)


def polyline_nearest(X, Z, pts, chunk=262144):
	"""Distance from every (X, Z) to a polyline and the attributes interpolated at the nearest point.
	pts: sequence of (x, z, a1, a2, ...). Returns (dist, attrs[k, ...], t_along_metres)."""
	P = np.asarray(pts, dtype=np.float64)
	shp = X.shape
	xf = X.ravel()
	zf = Z.ravel()
	n = xf.size
	na = P.shape[1] - 2
	dist = np.full(n, np.inf)
	attrs = np.zeros((na, n))
	along = np.zeros(n)
	seglen = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
	cum = np.concatenate([[0.0], np.cumsum(seglen)])
	for s0 in range(0, n, chunk):
		x = xf[s0:s0 + chunk]
		z = zf[s0:s0 + chunk]
		bd = np.full(x.size, np.inf)
		ba = np.zeros((na, x.size))
		bt = np.zeros(x.size)
		if len(P) == 1:
			bd = np.hypot(x - P[0, 0], z - P[0, 1])
			ba[:] = P[0, 2:, None]
		for k in range(len(P) - 1):
			ax, az = P[k, 0], P[k, 1]
			bx, bz = P[k + 1, 0], P[k + 1, 1]
			abx, abz = bx - ax, bz - az
			l2 = abx * abx + abz * abz
			t = np.clip(((x - ax) * abx + (z - az) * abz) / max(l2, 1e-9), 0.0, 1.0)
			d = np.hypot(x - (ax + t * abx), z - (az + t * abz))
			m = d < bd
			if not m.any():
				continue
			bd = np.where(m, d, bd)
			for a in range(na):
				v = P[k, 2 + a] + t * (P[k + 1, 2 + a] - P[k, 2 + a])
				ba[a] = np.where(m, v, ba[a])
			bt = np.where(m, cum[k] + t * seglen[k], bt)
		dist[s0:s0 + chunk] = bd
		attrs[:, s0:s0 + chunk] = ba
		along[s0:s0 + chunk] = bt
	return dist.reshape(shp), attrs.reshape((na,) + shp), along.reshape(shp)


def network_field(X, Z, polylines, halfwidth_index=None, eps=25.0, power=4.0):
	"""Soft-nearest combination over several polylines.
	Returns (d_min, blended value of attr 0, index of nearest polyline).
	If halfwidth_index is given, distances are reduced by that attribute (clamped at 0)."""
	dmin = np.full(X.shape, np.inf)
	wsum = np.zeros(X.shape)
	vsum = np.zeros(X.shape)
	nearest = np.zeros(X.shape, np.int32)
	for idx, pts in enumerate(polylines):
		d, a, _ = polyline_nearest(X, Z, pts)
		if halfwidth_index is not None:
			d = np.maximum(d - a[halfwidth_index], 0.0)
		w = 1.0 / (d + eps) ** power
		wsum += w
		vsum += w * a[0]
		m = d < dmin
		nearest[m] = idx
		dmin = np.minimum(dmin, d)
	return dmin, vsum / np.maximum(wsum, 1e-30), nearest


def open_spline(pts, step):
	"""Catmull-Rom through an open polyline (all columns interpolated), sampled every ~step metres."""
	P = np.asarray(pts, dtype=np.float64)
	if len(P) < 2:
		return P
	ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
	out = [P[0]]
	for k in range(1, len(ext) - 2):
		p0, p1, p2, p3 = ext[k - 1], ext[k], ext[k + 1], ext[k + 2]
		L = np.hypot(p2[0] - p1[0], p2[1] - p1[1])
		ns = max(1, int(np.ceil(L / step)))
		for s in range(1, ns + 1):
			t = s / ns
			t2, t3 = t * t, t * t * t
			q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
			# keep attributes (columns >= 2) linear to avoid overshoot in floor heights / widths
			q[2:] = p1[2:] + (p2[2:] - p1[2:]) * t
			out.append(q)
	return np.array(out)


class SkeletonField:
	"""Nearest-point field to a set of polylines via one Euclidean distance transform.
	Build once per grid; query at (possibly warped) positions with .query(xw, zw)."""

	def __init__(self, n, x0, dx, polylines, pad=0.35, smooth=True, step=None):
		self.dx = dx
		self.padn = int(n * pad)
		self.N = n + 2 * self.padn
		self.ox = x0 - self.padn * dx
		pts = []
		st = dx * 0.5 if step is None else step
		self.step = st
		for pl in polylines:
			P = open_spline(pl, st) if smooth and len(pl) > 2 else _dense_linear(pl, st)
			pts.append(P)
		P = np.vstack(pts)
		pid = np.concatenate([np.full(len(p), k) for k, p in enumerate(pts)])
		self.P = P
		self.pid = pid
		ii = np.round((P[:, 0] - self.ox) / dx).astype(np.int64)
		jj = np.round((P[:, 1] - self.ox) / dx).astype(np.int64)
		ok = (ii >= 0) & (jj >= 0) & (ii < self.N) & (jj < self.N)
		sidx = np.arange(len(P))[ok]
		P, ii, jj = P[ok], ii[ok], jj[ok]
		self.na = P.shape[1] - 2
		self.sidx = np.full((self.N, self.N), -1, np.int64)
		self.sidx[jj, ii] = sidx
		mask = np.ones((self.N, self.N), bool)
		mask[jj, ii] = False
		self.px = np.zeros((self.N, self.N), np.float32)
		self.pz = np.zeros((self.N, self.N), np.float32)
		self.attr = np.zeros((self.na, self.N, self.N), np.float32)
		self.px[jj, ii] = P[:, 0]
		self.pz[jj, ii] = P[:, 1]
		for a in range(self.na):
			self.attr[a, jj, ii] = P[:, 2 + a]
		_, idx = ndimage.distance_transform_edt(mask, return_indices=True)
		self.J = idx[0].astype(np.int32)
		self.I = idx[1].astype(np.int32)

	def query(self, x, z, exact=True):
		"""Distance to the skeleton and its attributes at the nearest point. exact: project onto the two
		polyline segments around the nearest sample (continuous distance + attributes, no Voronoi staircase)."""
		i = np.clip(np.round((x - self.ox) / self.dx).astype(np.int64), 0, self.N - 1)
		j = np.clip(np.round((z - self.ox) / self.dx).astype(np.int64), 0, self.N - 1)
		J = self.J[j, i]
		I = self.I[j, i]
		if not exact:
			d = np.hypot(x - self.px[J, I], z - self.pz[J, I])
			return d, self.attr[:, J, I]
		k = self.sidx[J, I]
		P, pid = self.P, self.pid
		nP = len(P)
		best_d = np.full(np.shape(x), np.inf)
		best_a = np.zeros((self.na,) + np.shape(x))
		W = int(np.ceil(self.dx * 1.6 / max(self.step, 1e-6))) + 2
		for off in range(-W, W):
			ka, kb = k + off, k + off + 1
			ka_c = np.clip(ka, 0, nP - 1)
			kb_c = np.clip(kb, 0, nP - 1)
			valid = (ka >= 0) & (kb < nP) & (pid[ka_c] == pid[kb_c])
			ax, az = P[ka_c, 0], P[ka_c, 1]
			bx, bz = P[kb_c, 0], P[kb_c, 1]
			abx, abz = bx - ax, bz - az
			l2 = np.maximum(abx * abx + abz * abz, 1e-12)
			t = np.clip(((x - ax) * abx + (z - az) * abz) / l2, 0.0, 1.0)
			t = np.where(valid, t, 0.0)
			qx = np.where(valid, ax + t * abx, P[k, 0])
			qz = np.where(valid, az + t * abz, P[k, 1])
			d = np.hypot(x - qx, z - qz)
			m = d < best_d
			best_d = np.where(m, d, best_d)
			for a in range(self.na):
				va = np.where(valid, P[ka_c, 2 + a] + t * (P[kb_c, 2 + a] - P[ka_c, 2 + a]), P[k, 2 + a])
				best_a[a] = np.where(m, va, best_a[a])
		return best_d, best_a


def _dense_linear(pts, step):
	P = np.asarray(pts, dtype=np.float64)
	if len(P) == 1:
		return P
	out = [P[0]]
	for k in range(len(P) - 1):
		a, b = P[k], P[k + 1]
		L = np.hypot(b[0] - a[0], b[1] - a[1])
		ns = max(1, int(np.ceil(L / step)))
		for s in range(1, ns + 1):
			out.append(a + (b - a) * (s / ns))
	return np.array(out)


def smoothstep(e0, e1, x):
	t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


def resample(a, src_x0, src_dx, dst_x0, dst_dx, dst_n, order=3):
	"""Resample a square grid onto another square grid (vertex-aligned coordinates)."""
	c = (dst_x0 + np.arange(dst_n) * dst_dx - src_x0) / src_dx
	J, I = np.meshgrid(c, c, indexing="ij")
	return ndimage.map_coordinates(a.astype(np.float64), [J, I], order=order, mode="nearest").astype(np.float32)


def slope_deg(h, cell):
	gz, gx = np.gradient(h.astype(np.float64), cell)
	return np.degrees(np.arctan(np.hypot(gx, gz))).astype(np.float32)


def normals(h, cell):
	gz, gx = np.gradient(h.astype(np.float64), cell)
	n = np.stack([-gx, np.ones_like(gx), -gz], axis=-1)
	n /= np.linalg.norm(n, axis=-1, keepdims=True)
	return n.astype(np.float32)


def blur(a, sigma):
	return ndimage.gaussian_filter(a.astype(np.float32), sigma, mode="nearest")


def point_in_polygon(X, Z, poly):
	"""Even-odd rule, vectorised. poly: sequence of (x, z)."""
	P = np.asarray(poly, dtype=np.float64)
	inside = np.zeros(X.shape, bool)
	n = len(P)
	for k in range(n):
		x1, z1 = P[k]
		x2, z2 = P[(k + 1) % n]
		cond = ((z1 > Z) != (z2 > Z))
		xint = x1 + (Z - z1) * (x2 - x1) / np.where(z2 - z1 == 0, 1e-12, z2 - z1)
		inside ^= cond & (X < xint)
	return inside


def closed_spline(pts, samples=256):
	"""Periodic Catmull-Rom through the given (x, z) points."""
	P = np.asarray(pts, dtype=np.float64)
	n = len(P)
	out = []
	per = samples // n + 1
	for k in range(n):
		p0, p1, p2, p3 = P[(k - 1) % n], P[k], P[(k + 1) % n], P[(k + 2) % n]
		for s in range(per):
			t = s / per
			t2, t3 = t * t, t * t * t
			out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
							  (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
	return np.array(out)


def densify(pts, step):
	"""Resample an open polyline (rows of floats) at ~step metres, interpolating all columns."""
	P = np.asarray(pts, dtype=np.float64)
	out = [P[0]]
	for k in range(len(P) - 1):
		a, b = P[k], P[k + 1]
		L = np.hypot(b[0] - a[0], b[1] - a[1])
		n = max(1, int(np.ceil(L / step)))
		for s in range(1, n + 1):
			out.append(a + (b - a) * (s / n))
	return np.array(out)


def bilinear(a, x0, dx, x, z):
	"""Bilinear sample of grid a (vertex-aligned, origin x0, spacing dx) at arrays x, z."""
	n = a.shape[0]
	fi = np.clip((np.asarray(x) - x0) / dx, 0, n - 1.0001)
	fj = np.clip((np.asarray(z) - x0) / dx, 0, n - 1.0001)
	i = fi.astype(int)
	j = fj.astype(int)
	u = fi - i
	v = fj - j
	return (a[j, i] * (1 - u) * (1 - v) + a[j, i + 1] * u * (1 - v) + a[j + 1, i] * (1 - u) * v +
			a[j + 1, i + 1] * u * v)

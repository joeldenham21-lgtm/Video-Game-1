"""Macro landform: designed skeleton -> smooth harmonic design surface -> steady-state stream-power landscape.

1. Constraints are rasterised from the skeletons in design.py at every pyramid level:
     valley floors (x, z, floor_y, half_width)  -> s = 0, Hv = floor (plus a gentle U-shaped rise)
     crest lines  (x, z, crest_y)                -> s = 1, Hc = crest
2. Three harmonic (Laplace) fields are solved with a coarse-to-fine Jacobi pyramid: s (0 valleys .. 1 crests),
   Hv (floor heights extended smoothly), Hc (crest heights extended smoothly). Harmonic fields have no
   medial-axis discontinuities, so the design surface h0 = Hv + (Hc - Hv) * P(s) is smooth everywhere.
3. The design surface seeds a steady-state stream-power landscape (tools/terrain/terrain_c.c spl_steady): every
   cell sits above its drainage receiver by dist * min(ks * A^-m, tan(max slope)). The steepness map ks is
   calibrated iteratively so the eroded landscape keeps the designed crest heights at large scale while the
   drainage network (dendritic valleys, spurs, sharp divides, concave profiles) emerges on its own.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

import tlib
from fields import SkeletonField, blur, grid, open_spline, resample, smoothstep


# -------------------------------------------------------------------------------------------- rasterising
def dense_poly(pl, step):
	P = np.asarray(pl, dtype=np.float64)
	if len(P) == 1:
		return P
	return open_spline(P, step) if len(P) > 2 else _lin(P, step)


def _lin(P, step):
	out = [P[0]]
	for k in range(len(P) - 1):
		a, b = P[k], P[k + 1]
		n = max(1, int(np.ceil(np.hypot(b[0] - a[0], b[1] - a[1]) / step)))
		for s in range(1, n + 1):
			out.append(a + (b - a) * (s / n))
	return np.array(out)


def _warped_grid(n, x0, dx, warp_fn):
	X, Z = grid(n, x0, dx)
	if warp_fn is not None:
		wx, wz = warp_fn(n, x0, dx)
		X = X + wx
		Z = Z + wz
	return X, Z


def raster_valleys(n, x0, dx, valleys, rise=0.08, min_hw=None, warp_fn=None, blend=0.35):
	"""Mask + floor value of valley floors (within half-width). Floors rise `rise` x half-width toward
	their edges (gently U-shaped). Where floors of different valleys overlap, their heights blend smoothly
	(weights fall off with distance relative to each valley's half-width) instead of switching at the medial
	axis, so joined floors never form steps. Returns (mask bool, value, dist_beyond_floor, halfwidth)."""
	if min_hw is None:
		min_hw = 0.75 * dx
	X, Z = _warped_grid(n, x0, dx, warp_fn)
	vals = np.zeros(X.shape)
	wsum = np.zeros(X.shape)
	dbest = np.full(X.shape, np.inf)
	hwbest = np.full(X.shape, min_hw)
	fbest = np.zeros(X.shape)
	mask = np.zeros(X.shape, bool)
	for pl in valleys:
		P = np.asarray(pl, dtype=np.float64)
		Fi = SkeletonField(n, x0, dx, [pl], pad=0.05, step=dx * 0.25)
		d, a = Fi.query(X, Z)
		hw = np.maximum(a[1], min_hw)
		# beyond either end the floor tapers off quickly (valley heads are bowls, not flat round caps)
		t0 = P[1, :2] - P[0, :2]
		t0 /= max(np.hypot(*t0), 1e-9)
		t1 = P[-1, :2] - P[-2, :2]
		t1 /= max(np.hypot(*t1), 1e-9)
		hw = np.maximum(hw * (1.0 - smoothstep(0.0, 0.8, _beyond_ends(X, Z, P, d, t0, t1) / hw)), min_hw)
		u = d / hw
		val = a[0] + rise * hw * np.clip(u, 0.0, 1.0) ** 2
		w = np.exp(-np.maximum(u - 0.5, 0.0) / blend) * (u < 1.6)
		vals += w * val
		wsum += w
		beyond = np.maximum(d - hw, 0.0)
		m = beyond < dbest
		dbest = np.where(m, beyond, dbest)
		hwbest = np.where(m, hw, hwbest)
		fbest = np.where(m, a[0], fbest)
		mask |= u <= 1.0
	val = np.where(wsum > 1e-9, vals / np.maximum(wsum, 1e-9), 0.0)
	raster_valleys.last_floor = fbest
	return mask, val.astype(np.float64), dbest, hwbest


def _beyond_ends(X, Z, P, d, t0, t1):
	"""Distance past the first / last point of a polyline, for cells whose nearest point is that end point
	(smoothly weighted so cells beside the line near its ends are not affected)."""
	e0 = np.hypot(X - P[0, 0], Z - P[0, 1])
	e1 = np.hypot(X - P[-1, 0], Z - P[-1, 1])
	b0 = np.maximum(-((X - P[0, 0]) * t0[0] + (Z - P[0, 1]) * t0[1]), 0.0)
	b1 = np.maximum((X - P[-1, 0]) * t1[0] + (Z - P[-1, 1]) * t1[1], 0.0)
	# the projection of the offset on the end tangent equals the distance only straight beyond the end;
	# weight by how "straight beyond" the cell is (cos of the angle) to keep the field continuous
	w0 = np.clip(b0 / np.maximum(e0, 1e-6), 0.0, 1.0) * (e0 <= d + 1e-3)
	w1 = np.clip(b1 / np.maximum(e1, 1e-6), 0.0, 1.0) * (e1 <= d + 1e-3)
	return np.maximum(b0 * w0 ** 2, b1 * w1 ** 2)


def valley_cone(n, x0, dx, valleys, cone_fn, warp_fn=None, soft=40.0):
	"""Lower envelope over valleys of floor(nearest point) + F(distance beyond the floor edge), with
	F rising at k_lo up to the cliff base H1 and at k_hi above. cone_fn(X, Z, floor) -> (k_lo, k_hi, H1)."""
	X, Z = _warped_grid(n, x0, dx, warp_fn)
	env = np.full(X.shape, np.inf)
	for pl in valleys:
		P = np.asarray(pl, dtype=np.float64)
		Fi = SkeletonField(n, x0, dx, [pl], pad=0.05, step=dx * 0.25)
		d, a = Fi.query(X, Z)
		hw = np.maximum(a[1], 0.75 * dx)
		t0 = P[1, :2] - P[0, :2]
		t0 /= max(np.hypot(*t0), 1e-9)
		t1 = P[-1, :2] - P[-2, :2]
		t1 /= max(np.hypot(*t1), 1e-9)
		hw = np.maximum(hw * (1.0 - smoothstep(0.0, 0.8, _beyond_ends(X, Z, P, d, t0, t1) / hw)), 0.75 * dx)
		dv = np.maximum(d - hw, 0.0)
		floor = a[0]
		k_lo, k_hi, H1 = cone_fn(X, Z, floor)
		D1 = np.maximum(H1 - floor, 0.0) / k_lo
		sp = soft * np.logaddexp(0.0, (dv - D1) / soft) - soft * np.logaddexp(0.0, -D1 / soft)
		env = np.minimum(env, floor + k_lo * dv + (k_hi - k_lo) * sp)
	return env


def raster_crests(n, x0, dx, crests, width=None, warp_fn=None):
	if width is None:
		width = 0.75 * dx
	F = SkeletonField(n, x0, dx, crests, pad=0.05, step=dx * 0.25)
	X, Z = _warped_grid(n, x0, dx, warp_fn)
	d, a = F.query(X, Z)
	return d <= width, a[0].astype(np.float64), d


# -------------------------------------------------------------------------------------------- harmonic
def _jacobi(u, fixed, val, iters, omega=1.0):
	for _ in range(iters):
		p = np.pad(u, 1, mode="edge")
		avg = 0.25 * (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:])
		u = u + omega * (avg - u)
		u[fixed] = val[fixed]
	return u


def harmonic(n, x0, dx, constraint_fn, iters_coarse=400, iters_fine=120, min_n=17):
	"""Solve Laplace(u) = 0 with Dirichlet constraints from constraint_fn(n, x0, dx) -> (mask, value) on an
	(n = 2^k + 1)^2 grid, coarse-to-fine. Neumann boundary where unconstrained."""
	levels = []
	m = n
	while m >= min_n:
		levels.append(m)
		if (m - 1) % 2:
			break
		m = (m - 1) // 2 + 1
	levels = levels[::-1]
	u = None
	for li, m in enumerate(levels):
		d = dx * (n - 1) / (m - 1)
		mask, val = constraint_fn(m, x0, d)
		if u is None:
			u = np.where(mask, val, float(np.mean(val[mask])) if mask.any() else 0.0)
			it = iters_coarse * 4
		else:
			u = resample(u, x0, dx * (n - 1) / (u.shape[0] - 1), x0, d, m, order=1).astype(np.float64)
			it = iters_coarse if li < len(levels) - 2 else iters_fine
		u = _jacobi(u.astype(np.float64), mask, val, it, omega=1.0)
	return u


# -------------------------------------------------------------------------------------------- design surface
def design_surface(n, x0, dx, valleys, crests, profile_exp=1.35, boundary=None, boundary_band=0.0, warp_fn=None,
				   profile_fn=None, s_mix=0.0, cone_fn=None):
	"""Returns dict(h0, s, Hv, Hc, floor_mask, dv) on an n x n grid.
	boundary: optional (h_outer array on the same grid) used as extra Dirichlet data on the outer ring of width
	boundary_band metres (so an inner domain matches its surroundings)."""
	X, Z = grid(n, x0, dx)
	edge = np.minimum(np.minimum(X - x0, x0 + (n - 1) * dx - X), np.minimum(Z - x0, x0 + (n - 1) * dx - Z))

	def ring(m, d):
		if boundary is None or boundary_band <= 0:
			return None
		Xm, Zm = grid(m, x0, d)
		e = np.minimum(np.minimum(Xm - x0, x0 + (m - 1) * d - Xm), np.minimum(Zm - x0, x0 + (m - 1) * d - Zm))
		return e <= boundary_band

	def bsample(m, d):
		return resample(boundary, x0, dx, x0, d, m, order=1)

	cache = {}

	def rv(m, d):
		key = ("v", m)
		if key not in cache:
			cache[key] = raster_valleys(m, x0, d, valleys, warp_fn=warp_fn)
			cache[("f", m)] = raster_valleys.last_floor
		return cache[key]

	def rc(m, d):
		key = ("c", m)
		if key not in cache:
			cache[key] = raster_crests(m, x0, d, crests, warp_fn=warp_fn)
		return cache[key]

	def c_s(m, _x0, d):
		vm = rv(m, d)[0]
		cm = rc(m, d)[0]
		val = np.where(cm, 1.0, 0.0)
		mask = vm | cm
		return mask, val

	def c_hv(m, _x0, d):
		vm, vv = rv(m, d)[:2]
		r = ring(m, d)
		if r is not None:
			# outer ring: floors of the surroundings are unknown; use the boundary's local minimum as floor
			bl = ndimage.minimum_filter(bsample(m, d), size=max(3, int(1500.0 / d)) | 1)
			vv = np.where(r & ~vm, bl, vv)
			vm = vm | r
		return vm, vv

	def c_hc(m, _x0, d):
		cm, cv = rc(m, d)[:2]
		r = ring(m, d)
		if r is not None:
			bl = ndimage.maximum_filter(bsample(m, d), size=max(3, int(1500.0 / d)) | 1)
			cv = np.where(r & ~cm, bl, cv)
			cm = cm | r
		return cm, cv

	s_h = np.clip(harmonic(n, x0, dx, c_s), 0.0, 1.0)
	# distance ratio: uniform valley-to-crest progression (the harmonic s bunches up next to the crests)
	_, _, dv_, _ = rv(n, dx)
	_, _, dc_ = rc(n, dx)
	s_d = dv_ / np.maximum(dv_ + dc_, 1e-6)
	s = np.clip(s_mix * s_d + (1 - s_mix) * s_h, 0.0, 1.0)
	Hv = harmonic(n, x0, dx, c_hv)
	Hc = harmonic(n, x0, dx, c_hc)
	Hc = np.maximum(Hc, Hv + 40.0)
	if profile_fn is not None:
		h0 = profile_fn(s, Hv, Hc)
	else:
		P = 0.25 * s + 0.75 * s ** profile_exp
		h0 = Hv + (Hc - Hv) * P
	vm, vv, dv, hw = rv(n, dx)
	h0 = np.where(vm, vv, h0)
	if cone_fn is not None:
		# valley walls: forested / talus slopes rise at most at k_lo from each floor edge until the cliff base,
		# then steepen to k_hi; the design surface is capped by the lower envelope of all valleys' cones
		# (crests too close to a floor come down; the envelope is continuous)
		cap = valley_cone(n, x0, dx, valleys, cone_fn, warp_fn=warp_fn)
		capped = h0 > cap
		h0 = np.minimum(h0, cap)
		# crest lines below the cone keep a harmonic cusp (thin blades): soften them where they stand proud
		near = blur(capped.astype(np.float32), 2.0) > 0.02
		h0 = np.where(near & ~capped, blur(h0.astype(np.float32), 1.2), h0)
		h0 = np.where(vm, vv, np.minimum(h0, cap))
	if boundary is not None and boundary_band > 0:
		w = 1.0 - smoothstep(0.0, boundary_band, edge)
		h0 = h0 * (1 - w) + boundary * w
	return dict(h0=h0.astype(np.float32), s=s.astype(np.float32), Hv=Hv.astype(np.float32),
				Hc=Hc.astype(np.float32), floor=vm, dv=dv.astype(np.float32), hw=hw.astype(np.float32))


def cliff_profile(s, Hv, Hc, H1, cot_lo=2.0, cot_hi=0.55, soft=80.0):
	"""Valley-to-crest profile with gentle (forested / talus) slopes below the cliff-base altitude H1 and steep
	walls above it: the horizontal 'cost' per metre of rise is cot_lo below H1 and cot_hi above (soft blend over
	+-soft metres). s (0 floor .. 1 crest) is the fraction of the total cost, inverted per cell."""
	Hv = Hv.astype(np.float64)
	Hc = np.maximum(Hc.astype(np.float64), Hv + 1.0)
	H1 = np.clip(H1, Hv, Hc)
	# cost with a smooth transition: integrate rate(h) = lo + (hi - lo) * smoothstep(H1 - soft, H1 + soft, h)
	levels = 48
	t = np.linspace(0.0, 1.0, levels)
	hs = Hv[None] + (Hc - Hv)[None] * t[:, None, None]
	rate = cot_lo + (cot_hi - cot_lo) * smoothstep(H1[None] - soft, H1[None] + soft, hs)
	dh = (Hc - Hv) / (levels - 1)
	G = np.concatenate([np.zeros((1,) + Hv.shape), np.cumsum(0.5 * (rate[1:] + rate[:-1]) * dh[None], axis=0)])
	T = G[-1]
	target = s * T
	# invert: find the level interval containing target
	k = np.clip((G < target[None]).sum(axis=0) - 1, 0, levels - 2)
	g0 = np.take_along_axis(G, k[None], 0)[0]
	g1 = np.take_along_axis(G, (k + 1)[None], 0)[0]
	f = np.clip((target - g0) / np.maximum(g1 - g0, 1e-9), 0.0, 1.0)
	return (Hv + (Hc - Hv) * (k + f) / (levels - 1)).astype(np.float32)


def terrace(h, x, z, w, seed, t_lo=90.0, t_hi=230.0, ledge_rate=0.42, cliff_lo=0.35, cliff_hi=0.5, dip=(0.06, -0.04),
			warp=None):
	"""Layer-cake benches: remaps height within bands of random thickness so each band is a gentle ledge (rising
	at ledge_rate x the local rate) topped by a steep cliff. Band surfaces dip gently (dip = dh/dx, dh/dz).
	Only redistributes slope along the profile: band boundaries keep their heights. w (0..1) blends it in."""
	sc = (h + dip[0] * x + dip[1] * z + (0.0 if warp is None else warp)).astype(np.float64)
	rng = np.random.default_rng(seed)
	lo, hi = float(sc.min()) - 300.0, float(sc.max()) + 300.0
	edges = [lo]
	while edges[-1] < hi:
		edges.append(edges[-1] + rng.uniform(t_lo, t_hi))
	edges = np.array(edges)
	thick = np.diff(edges)
	cfrac = rng.uniform(cliff_lo, cliff_hi, len(thick))
	band = np.clip(np.searchsorted(edges, sc) - 1, 0, len(thick) - 1)
	T = thick[band]
	fr = (sc - edges[band]) / T
	cf = cfrac[band]
	g_ledge = ledge_rate * fr
	g_cliff = ledge_rate * (1 - cf) + (fr - (1 - cf)) * (1 - ledge_rate * (1 - cf)) / cf
	kink = smoothstep(1 - cf - 0.04, 1 - cf + 0.04, fr)
	g = g_ledge * (1 - kink) + g_cliff * kink
	delta = (g - fr) * T
	return (h + delta * w).astype(np.float32), (fr > 1 - cf)


# -------------------------------------------------------------------------------------------- stream power
def spl_calibrated(h0, base, dx, fixed, m=0.45, tmax_deg=40.0, tmax_map=None, rounds=5, iters=14, seed=1,
				   rough=0.0, ks0=None, calib_sigma_m=500.0, noise_init=None, log=None, rexp=1.0):
	"""Steady-state stream-power landscape whose large-scale relief above `base` matches h0's.
	fixed: bool mask of outlet cells (kept at h0). Returns (h, area, ks)."""
	h0 = h0.astype(np.float32)
	fx = fixed.astype(np.uint8)
	ny, nx = h0.shape
	if noise_init is None:
		noise_init = np.zeros_like(h0)
	# first guess for ks from the design slope with a typical drainage area
	gz, gx = np.gradient(blur(h0, 2.0).astype(np.float64), dx)
	S = np.clip(np.hypot(gx, gz), 0.02, 1.2)
	if ks0 is None:
		ks = (S * (dx * dx * 30.0) ** m).astype(np.float32)
		ks = blur(ks, calib_sigma_m / dx * 0.5)
	else:
		ks = ks0.astype(np.float32)
	sig = calib_sigma_m / dx
	rel0 = blur(np.maximum(h0 - base, 0.0), sig) + 5.0
	h = (h0 + noise_init).astype(np.float32)
	area = None
	for r in range(rounds):
		h, area = tlib.spl_steady_rand(h0 + noise_init if r == 0 else h, dx, ks, fixed=fx, m=m, tmax_deg=tmax_deg,
									   tmax_map=tmax_map, iters=iters, damping=0.5, rexp=rexp, seed=seed + r)
		rel = blur(np.maximum(h - base, 0.0), sig) + 5.0
		ratio = np.clip(rel0 / rel, 0.5, 2.0)
		err = float(np.sqrt(np.mean((rel - rel0) ** 2)))
		if log:
			log("   spl round %d: relief rms error %.1f m" % (r, err))
		ks = (ks * ratio ** 0.9).astype(np.float32)
	return h, area, ks

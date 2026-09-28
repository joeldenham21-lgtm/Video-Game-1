#!/usr/bin/env python3
"""Golden-path trail QA on the generated terrain (no Godot needed).

    python3.12 thin-air/tools/terrain/trail_qa.py [--height F.f32] [--layout L.json] [--trail id] [--list]

For every golden trail of world_layout.json it walks the path every 0.5 m and reports what the Player's collision
sees: the steepest heightfield triangle (both diagonal splits of the 1.5 m cell, at lateral offsets up to +-0.6 m)
against the surface's slide limit (PlayerMotion: dirt 45, gravel 38, snow 40 / 48 with crampons, ice 26 / 50),
the bench cross-slope (+-1.5 m), the grade over 3 m, and the switchback geometry (hairpins, leg lengths, the
vertical spacing between turns, legs stacked closer than 8 m).
"""
from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
N, CELL, HALF = 2049, 1.5, 1536.0
MN, MCELL = 1025, 3.0


def load(height, masks, masks2):
	h = np.fromfile(height, np.float32).reshape(N, N)
	m = np.fromfile(masks, np.uint8).reshape(MN, MN, 4) if os.path.exists(masks) else None
	m2 = np.fromfile(masks2, np.uint8).reshape(MN, MN, 4) if os.path.exists(masks2) else None
	return h, m, m2


def bil(h, x, z):
	fx = np.clip((x + HALF) / CELL, 0, N - 1.001)
	fz = np.clip((z + HALF) / CELL, 0, N - 1.001)
	i = np.floor(fx).astype(int)
	j = np.floor(fz).astype(int)
	tx, tz = fx - i, fz - j
	return (h[j, i] * (1 - tx) * (1 - tz) + h[j, i + 1] * tx * (1 - tz) + h[j + 1, i] * (1 - tx) * tz
			+ h[j + 1, i + 1] * tx * tz)


def tri_slope(h, x, z):
	"""Slope (deg) of the triangle under (x, z) for both diagonal splits: (split a, split b)."""
	fx = np.clip((x + HALF) / CELL, 0, N - 1.001)
	fz = np.clip((z + HALF) / CELL, 0, N - 1.001)
	i = np.floor(fx).astype(int)
	j = np.floor(fz).astype(int)
	tx, tz = fx - i, fz - j
	h00, h10, h01, h11 = h[j, i], h[j, i + 1], h[j + 1, i], h[j + 1, i + 1]
	# split a: diagonal (0,0)-(1,1)
	lo = tx >= tz
	gxa = np.where(lo, h10 - h00, h11 - h01)
	gza = np.where(lo, h11 - h10, h01 - h00)
	# split b: diagonal (1,0)-(0,1)
	lob = tx + tz <= 1
	gxb = np.where(lob, h10 - h00, h11 - h01)
	gzb = np.where(lob, h01 - h00, h11 - h10)
	sa = np.degrees(np.arctan(np.hypot(gxa, gza) / CELL))
	sb = np.degrees(np.arctan(np.hypot(gxb, gzb) / CELL))
	return sa, sb


def surface_limit(h, m, m2, x, z, gear):
	"""PlayerMotion slide limit of get_surface() at (x, z) (approximation of TerrainData.get_surface)."""
	y = bil(h, x, z)
	if m is None:
		return np.where(y < 2300, 45.0, 38.0)
	i = np.clip(np.round((x + HALF) / MCELL).astype(int), 0, MN - 1)
	j = np.clip(np.round((z + HALF) / MCELL).astype(int), 0, MN - 1)
	snow = m[j, i, 0] / 255.0
	ice = m2[j, i, 2] / 255.0
	lim = np.where(y < 2300, 45.0, 38.0)                    # dirt / gravel trail tread
	lim = np.where(snow >= 0.6, 48.0 if gear else 40.0, lim)
	lim = np.where(ice > 0.5, np.where(snow > 0.82, 48.0 if gear else 40.0, 50.0 if gear else 26.0), lim)
	return lim


def resample(P, step):
	seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 2]))
	S = np.concatenate([[0.0], np.cumsum(seg)])
	s = np.arange(0.0, S[-1], step)
	out = np.column_stack([np.interp(s, S, P[:, c]) for c in range(P.shape[1])])
	k = np.interp(s, S, np.arange(len(P)))
	return out, s, k


def hairpins(Q, s, turn_deg=110.0, window=20.0):
	"""Arc positions of hairpins: net heading change > turn_deg within `window` metres of arc."""
	dx = np.gradient(Q[:, 0])
	dz = np.gradient(Q[:, 2])
	hd = np.unwrap(np.arctan2(dz, dx))
	out = []
	i = 0
	n = len(s)
	w = int(window / max(s[1] - s[0], 1e-3))
	while i < n - w:
		d = np.degrees(abs(hd[i + w] - hd[i]))
		if d > turn_deg:
			# centre of the turn: max curvature in the window
			seg = np.abs(np.gradient(hd[i:i + w + 1]))
			c = i + int(np.argmax(seg))
			out.append(c)
			i += w
		else:
			i += max(1, w // 8)
	return out


def analyse(h, m, m2, T, gear, verbose=False):
	P = np.array([[p[0], p[1], p[2], p[3] if len(p) > 3 else 0] for p in T["points"]], np.float64)
	Q, s, kidx = resample(P, 0.5)
	x, z = Q[:, 0], Q[:, 2]
	tx = np.gradient(x)
	tz = np.gradient(z)
	tl = np.maximum(np.hypot(tx, tz), 1e-6)
	nx, nz = -tz / tl, tx / tl
	worst_a = np.zeros(len(Q))
	worst_b = np.zeros(len(Q))
	for o in (-0.6, -0.3, 0.0, 0.3, 0.6):
		sa, sb = tri_slope(h, x + nx * o, z + nz * o)
		worst_a = np.maximum(worst_a, sa)
		worst_b = np.maximum(worst_b, sb)
	strict = np.maximum(worst_a, worst_b)
	kind = np.minimum(worst_a, worst_b)
	lim = surface_limit(h, m, m2, x, z, gear)
	climb = Q[:, 3] > 0.5
	cross = np.degrees(np.arctan(np.abs(bil(h, x + nx * 1.5, z + nz * 1.5) - bil(h, x - nx * 1.5, z - nz * 1.5)) / 3.0))
	yc = bil(h, x, z)
	g3 = np.zeros(len(Q))
	g3[:-6] = np.degrees(np.arctan(np.abs(yc[6:] - yc[:-6]) / 3.0))
	walk = ~climb
	hp = hairpins(Q, s)
	legs = np.diff([0.0] + [s[c] for c in hp] + [s[-1]])
	dy = np.abs(np.diff([yc[c] for c in hp])) if len(hp) > 1 else np.array([])
	# stacking: nearest trail point more than 40 m of arc away
	stack = np.full(len(Q), np.inf)
	sub = np.arange(0, len(Q), 4)
	for a in sub:
		far = np.abs(s - s[a]) > 40.0
		if far.any():
			stack[a] = np.min(np.hypot(x[far] - x[a], z[far] - z[a]))
	over = walk & (kind > lim)
	over_s = walk & (strict > lim)
	r = dict(id=T["id"], length=float(s[-1]), pts=len(P),
			 tri_kind_p99=float(np.percentile(kind[walk], 99)) if walk.any() else 0.0,
			 tri_kind_max=float(kind[walk].max()) if walk.any() else 0.0,
			 tri_strict_max=float(strict[walk].max()) if walk.any() else 0.0,
			 over_limit_m=float(over.sum() * 0.5), over_limit_strict_m=float(over_s.sum() * 0.5),
			 cross_p95=float(np.percentile(cross[walk], 95)) if walk.any() else 0.0,
			 cross_max=float(cross[walk].max()) if walk.any() else 0.0,
			 grade_max=float(g3[walk].max()) if walk.any() else 0.0,
			 grade_over30_m=float(((g3 > 30) & walk).sum() * 0.5),
			 climb_m=float(climb.sum() * 0.5),
			 hairpins=len(hp), leg_min=float(legs.min()) if len(legs) else 0.0,
			 leg_med=float(np.median(legs)) if len(legs) else 0.0,
			 turn_dy_min=float(dy.min()) if len(dy) else 0.0,
			 stacked_lt8_m=float((stack < 8.0).sum() * 2.0))
	# clusters of trouble (layout point index ranges)
	bad = over
	runs = []
	i = 0
	while i < len(bad):
		if bad[i]:
			j = i
			while j < len(bad) and bad[j:j + 6].any():
				j += 1
			runs.append((int(kidx[i]), int(kidx[min(j, len(bad) - 1)]), float(kind[i:j].max()), float(lim[i:j].min())))
			i = j
		else:
			i += 1
	r["bad_runs"] = runs
	if verbose:
		r["hairpin_idx"] = [int(kidx[c]) for c in hp]
		r["legs"] = [round(float(v), 1) for v in legs]
	return r


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--height", default=os.path.join(ROOT, "assets", "terrain", "height.f32"))
	ap.add_argument("--masks", default=os.path.join(ROOT, "assets", "terrain", "masks.bin"))
	ap.add_argument("--masks2", default=os.path.join(ROOT, "assets", "terrain", "masks2.bin"))
	ap.add_argument("--layout", default=os.path.join(ROOT, "data", "world_layout.json"))
	ap.add_argument("--trail", default=None)
	ap.add_argument("--nogear", action="store_true")
	ap.add_argument("-v", "--verbose", action="store_true")
	a = ap.parse_args()
	h, m, m2 = load(a.height, a.masks, a.masks2)
	L = json.load(open(a.layout))
	for T in L["trails"]:
		if a.trail and T["id"] != a.trail:
			continue
		if not a.trail and not T.get("golden"):
			continue
		gear = (not a.nogear) and T["id"] in ("glacier_route", "summit_ridge")
		r = analyse(h, m, m2, T, gear, a.verbose)
		runs = r.pop("bad_runs")
		print("%-14s len %5.0f m  tri(kind) p99 %4.1f max %4.1f strict max %4.1f | over limit %5.1f m (strict %5.1f m) | "
			  "cross p95 %4.1f max %4.1f | grade max %4.1f >30: %4.1f m | climb %5.1f m" % (
				  r["id"], r["length"], r["tri_kind_p99"], r["tri_kind_max"], r["tri_strict_max"], r["over_limit_m"],
				  r["over_limit_strict_m"], r["cross_p95"], r["cross_max"], r["grade_max"], r["grade_over30_m"],
				  r["climb_m"]))
		print("%-14s hairpins %d  leg min %.1f median %.1f  turn dy min %.1f  stacked(<8 m) %.0f m" % (
			"", r["hairpins"], r["leg_min"], r["leg_med"], r["turn_dy_min"], r["stacked_lt8_m"]))
		if runs:
			print("%-14s over-limit runs (idx a-b, worst, limit): %s" % ("", ", ".join(
				"%d-%d %.0f/%.0f" % q for q in runs[:14]) + (" ..." if len(runs) > 14 else "")))
		if a.verbose:
			print("  hairpins at idx", r["hairpin_idx"])
			print("  legs", r["legs"])


if __name__ == "__main__":
	main()

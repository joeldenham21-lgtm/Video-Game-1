#!/usr/bin/env python3
"""THIN AIR terrain generator (deterministic). See tools/README.md and design.py.

    python3.12 thin-air/tools/terrain/gen_terrain.py            # full run (~6-10 min), writes assets + layout
    python3.12 thin-air/tools/terrain/gen_terrain.py --stage mid --preview /tmp/p   # macro stages + previews

Stages (cached in tools/terrain/_cache/*.npz, re-run from any stage with --stage):
  far   48 m grid, +-24.6 km: regional valley network + background ranges, stream-power incision
  mid   6 m grid, +-3072 m: designed basin (valley/crest networks), incision at 12 m, detail noise
  fine  1.5 m grid, the map: detail noise, strata, glacier, droplet + thermal erosion, water, moraines,
        chutes, fans, trails, POI pads
  out   masks, AO/normals, MID/FAR stitching, world_layout.json, binary assets, previews
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import design as D  # noqa: E402
import tlib  # noqa: E402
from fields import (SkeletonField, bilinear, blur, grid, network_field, polyline_nearest, resample,  # noqa: E402
					slope_deg, smoothstep)

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSETS = os.path.join(ROOT, "assets", "terrain")
LAYOUT = os.path.join(ROOT, "data", "world_layout.json")
CACHE = os.path.join(HERE, "_cache")

SEED = 20261024
FAR_N, FAR_DX, FAR_X0 = 1025, 48.0, -24576.0
MID_N, MID_DX, MID_X0 = 1025, 6.0, -3072.0
FINE_N, FINE_DX, FINE_X0 = 2049, 1.5, -1536.0

T0 = time.time()


def log(*a):
	print("[%6.1fs]" % (time.time() - T0), *a, flush=True)


def cache_path(name):
	os.makedirs(CACHE, exist_ok=True)
	return os.path.join(CACHE, name + ".npz")


# ============================================================================================ design field
def design_height(n, x0, dx, background=True, seed=SEED):
	"""Macro landform from the valley and crest skeletons (design.py) on an n x n grid.
	Returns (h, d_v, h_v): height, distance beyond the valley floor half-width, and floor height."""
	X, Z = grid(n, x0, dx)
	r = np.maximum(np.abs(X), np.abs(Z))
	out_f = smoothstep(1550.0, 2700.0, r)
	w1x = tlib.noise(n, n, x0, x0, dx, 1 / 1700.0, 4, seed=seed + 1)
	w1z = tlib.noise(n, n, x0, x0, dx, 1 / 1700.0, 4, seed=seed + 2)
	w2x = tlib.noise(n, n, x0, x0, dx, 1 / 900.0, 4, seed=seed + 3)
	w2z = tlib.noise(n, n, x0, x0, dx, 1 / 900.0, 4, seed=seed + 4)
	wv = 14.0 + 300.0 * out_f
	wc = 110.0 + 420.0 * out_f
	valleys = list(D.MAP_VALLEYS.values()) + list(D.OUTER_VALLEYS.values())
	crests = list(D.MAP_CRESTS.values()) + list(D.OUTER_CRESTS.values())
	V = SkeletonField(n, x0, dx, valleys)
	dv, av = V.query(X + w1x * wv, Z + w1z * wv)
	av[1] = av[1] * (1.0 + 0.3 * tlib.noise(n, n, x0, x0, dx, 1 / 260.0, 3, seed=seed + 9))
	d_v = np.maximum(dv - av[1], 0.0)
	# floors are gently U-shaped (no flat discs): rise ~9 % of the half-width toward the floor edge
	u = np.clip(dv / np.maximum(av[1], 1.0), 0.0, 1.0)
	h_v = av[0].astype(np.float64) + 0.09 * av[1] * u * u
	C = SkeletonField(n, x0, dx, crests)
	dc, ac = C.query(X + (w2x * 0.6 + w1x * 0.4) * wc, Z + (w2z * 0.6 + w1z * 0.4) * wc)
	h_c = ac[0].astype(np.float64)
	# nearest-skeleton assignment is discontinuous at medial axes: soften it away from the skeletons
	h_v = h_v + (blur(h_v, 200.0 / dx) - h_v) * smoothstep(30.0, 350.0, d_v)
	h_c = h_c + (blur(h_c, 160.0 / dx) - h_c) * smoothstep(30.0, 350.0, dc)
	# crest line relief: small summits and notches along every ridge
	cr = tlib.noise(n, n, x0, x0, dx, 1 / 380.0, 4, seed=seed + 5, kind="ridged")
	h_c = h_c + (cr - 0.45) * 110.0 * (1.0 - out_f * 0.5)
	if background:
		hb = 2380.0 + 560.0 * tlib.noise(n, n, x0, x0, dx, 1 / 9000.0, 5, seed=seed + 6, kind="ridged") \
			- 300.0 * smoothstep(9000.0, 22000.0, np.hypot(X, Z))
		db = 2100.0 + 700.0 * tlib.noise(n, n, x0, x0, dx, 1 / 7000.0, 3, seed=seed + 7)
		wcw = 1.0 / (dc + 40.0) ** 3
		wbw = 1.0 / (db + 40.0) ** 3
		h_c = (wcw * h_c + wbw * hb) / (wcw + wbw)
		dc = np.minimum(dc, db)
	h_c = np.maximum(h_c, h_v + 60.0)
	t = d_v / (d_v + dc + 1e-3)
	f = 0.35 * (t * t * (3 - 2 * t)) + 0.65 * t ** 1.25
	rel = (h_c - h_v) * f
	E = tlib.noise_eroded(n, n, x0, x0, dx, 1 / 1150.0, 8, 0.5, 1.1, seed=seed + 8,
						  warpx=w2x * 120.0, warpz=w2z * 120.0)
	h = h_v + rel * (0.80 + 0.30 * E)
	return h.astype(np.float32), d_v.astype(np.float32), h_v.astype(np.float32)


def face_structure(h, dx, seed, scales, slope_lo=24.0, slope_hi=42.0, pre_blur=2.0):
	"""Couloirs, gullies and rock ribs on steep faces: white noise blurred to the feature width, then
	line-integral-convolved along the fall line. scales: [(width_m, length_m, amplitude_m), ...]."""
	hs = blur(h, pre_blur)
	s = slope_deg(hs, dx)
	w = smoothstep(slope_lo, slope_hi, s)
	rng = np.random.default_rng(seed)
	out = np.zeros_like(h, dtype=np.float32)
	for k, (width, length, amp) in enumerate(scales):
		src = rng.standard_normal(h.shape).astype(np.float32)
		src = blur(src, max(width / dx * 0.5, 0.5))
		src /= max(float(src.std()), 1e-6)
		l = tlib.lic_fall(hs, src, max(2, int(length / dx)))
		l /= max(float(l.std()), 1e-6)
		# sharpen ribs a little, keep couloirs rounded
		al = np.abs(l)
		l = np.sign(l) * np.where(l > 0, al ** 0.8, al ** 1.15)
		out += amp * l
	return (h + out * w).astype(np.float32)


def flow_carve(h, dx, seed, k=0.1, expo=0.42, cap=20.0, slope_lo=12.0, slope_hi=34.0, width_cells=1.2,
			   jitter=1.5, fixed=None):
	"""Dendritic gullies/couloirs/ravines: incise by k * A^expo (A = MFD drainage area in m^2), strongest on
	steep ground. One deterministic pass; widths follow the accumulated flow."""
	rng = np.random.default_rng(seed)
	hj = blur(h, 1.0) + blur(rng.standard_normal(h.shape).astype(np.float32), 2.0) * jitter
	A = tlib.flow_mfd(hj, dx, 1.25) * dx * dx
	s = slope_deg(blur(h, 2.0), dx)
	w = smoothstep(slope_lo, slope_hi, s)
	c = np.minimum(k * A ** expo, cap) * w
	# wider channels for bigger flow: blend two blurs weighted by size
	c1 = blur(c, width_cells)
	c2 = blur(c, width_cells * 3.0)
	big = smoothstep(4.0, 14.0, c2)
	c = c1 * (1 - big) + c2 * big
	if fixed is not None:
		c = c * (1 - fixed)
	return (h - c).astype(np.float32), A


def erode_macro(h, dx, count, seed, fixed=None, radius=2, erode=0.3, deposit=0.3, capacity=4.0, max_steps=60):
	"""Droplet erosion at macro scale. Heights are scaled by the cell size so gradients are O(1)."""
	h2, ero, dep, flow = tlib.droplets(h, count, seed=seed, hscale=dx, radius=radius, erode=erode, deposit=deposit,
									   capacity=capacity, max_steps=max_steps, evaporate=0.015, inertia=0.1,
									   gravity=4.0)
	if fixed is not None:
		h2 = np.where(fixed, h, h2)
	return h2, ero, dep, flow


# ============================================================================================ FAR
def stage_far(args):
	log("FAR: design field", FAR_N, "x", FAR_N, "@", FAR_DX, "m")
	h, d_v, h_v = design_height(FAR_N, FAR_X0, FAR_DX, background=True)
	log("FAR: erosion")
	h, _, _, _ = erode_macro(h, FAR_DX, args.far_drops, SEED + 11, radius=2)
	h = tlib.thermal(h, FAR_DX, 38.0, 4, 0.5)
	np.savez_compressed(cache_path("far"), h=h, d_v=d_v)
	log("FAR: done  min %.0f max %.0f" % (h.min(), h.max()))
	if args.preview:
		import preview
		preview.render(h, FAR_DX, os.path.join(args.preview, "far.png"), 1024)
	return h


# ============================================================================================ MID
def stage_mid(args):
	far = np.load(cache_path("far"))["h"]
	n12, dx12 = 513, 12.0
	log("MID: design field", n12, "@", dx12, "m")
	h, d_v, h_v = design_height(n12, MID_X0, dx12, background=True)
	X, Z = grid(n12, MID_X0, dx12)
	hf = resample(far, FAR_X0, FAR_DX, MID_X0, dx12, n12, order=3)
	edge = np.minimum(np.minimum(X - MID_X0, -MID_X0 - X), np.minimum(Z - MID_X0, -MID_X0 - Z))
	wb = 1.0 - smoothstep(150.0, 900.0, edge)
	h = (h * (1 - wb) + hf * wb).astype(np.float32)
	log("MID: upsample to 6 m + face structure")
	h6 = resample(h, MID_X0, dx12, MID_X0, MID_DX, MID_N, order=3)
	hv6 = resample(h_v, MID_X0, dx12, MID_X0, MID_DX, MID_N, order=1)
	dv6 = resample(d_v, MID_X0, dx12, MID_X0, MID_DX, MID_N, order=1)
	rel = np.clip((h6 - hv6) / 300.0, 0, 1)
	rid = tlib.noise(MID_N, MID_N, MID_X0, MID_X0, MID_DX, 1 / 180.0, 5, seed=SEED + 22, kind="ridged")
	h6 = (h6 + (rid - 0.45) * 16.0 * rel).astype(np.float32)
	fixed6 = (dv6 <= 0.0).astype(np.float32)
	h6, _ = flow_carve(h6, MID_DX, SEED + 14, k=0.075, expo=0.45, cap=38.0, width_cells=1.3, jitter=2.5,
					   fixed=blur(fixed6, 3.0))
	h6 = face_structure(h6, MID_DX, SEED + 13, [(60.0, 380.0, 5.0), (24.0, 240.0, 3.0), (10.0, 150.0, 1.6)],
						slope_lo=30.0, slope_hi=48.0)
	h6 = tlib.thermal(h6, MID_DX, 55.0, 2, 0.5)
	np.savez_compressed(cache_path("mid"), h=h6, hv=hv6, dv=dv6)
	log("MID: done  min %.0f max %.0f" % (h6.min(), h6.max()))
	if args.preview:
		import preview
		preview.render(h6, MID_DX, os.path.join(args.preview, "mid.png"), 1024)
		c = (MID_N - 1) // 4
		preview.render(h6[c:c + 513, c:c + 513], MID_DX, os.path.join(args.preview, "mid_map.png"), 1024)
	return h6


# ============================================================================================ FINE
def stage_fine(args):
	import pickle
	import fine as FN
	mid = np.load(cache_path("mid"))
	F = FN.Fine(mid, log, SEED)
	log("FINE: altitude corrections")
	F.correct_altitudes()
	log("FINE: detail + couloirs")
	F.detail()
	log("FINE: strata")
	F.strata()
	log("FINE: glacier")
	F.glacier()
	log("FINE: erosion")
	F.erode(args.fine_drops)
	F.log = None
	with open(os.path.join(CACHE, "fine_a.pkl"), "wb") as f:
		pickle.dump(F, f, protocol=4)
	F.log = log
	log("FINE: eroded  min %.0f max %.0f" % (F.h.min(), F.h.max()))


def stage_fine2(args):
	import pickle
	with open(os.path.join(CACHE, "fine_a.pkl"), "rb") as f:
		F = pickle.load(f)
	F.log = log
	log("FINE2: lake, tarns, rivers")
	F.lake()
	F.tarns()
	for R in D.RIVERS:
		F.river(R)
	F.forefield()
	log("FINE2: trails")
	F.trails()
	log("FINE2: pads")
	F.pads()
	F.water_recheck()
	F.log = None
	with open(os.path.join(CACHE, "fine_b.pkl"), "wb") as f:
		pickle.dump(F, f, protocol=4)
	np.savez_compressed(cache_path("fine"), h=F.h)
	log("FINE2: done  min %.0f max %.0f" % (F.h.min(), F.h.max()))
	if args.preview:
		import preview
		preview.render(F.h, 1.5, os.path.join(args.preview, "fine.png"), 1024, water=F.masks["water"])
		preview.views(F.h, -1536.0, 1.5, os.path.join(args.preview, "fine"))


# ============================================================================================ OUT
def stage_out(args):
	import pickle
	import outputs
	with open(os.path.join(CACHE, "fine_b.pkl"), "rb") as f:
		F = pickle.load(f)
	F.log = log
	mid = np.load(cache_path("mid"))["h"]
	far = np.load(cache_path("far"))["h"]
	os.makedirs(os.path.dirname(LAYOUT), exist_ok=True)
	outputs.write_all(F, mid, far, ROOT, LAYOUT, log, SEED, args.preview)


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--stage", default="far", help="first stage to run: far|mid|fine|out")
	ap.add_argument("--stop", default="out", help="last stage to run")
	ap.add_argument("--preview", default=None, help="directory for preview PNGs")
	ap.add_argument("--far-drops", type=int, default=300000)
	ap.add_argument("--mid-drops", type=int, default=350000)
	ap.add_argument("--fine-drops", type=int, default=1600000)
	args = ap.parse_args()
	if args.preview:
		os.makedirs(args.preview, exist_ok=True)
	order = ["far", "mid", "fine", "fine2", "out"]
	stages = {"far": stage_far, "mid": stage_mid, "fine": stage_fine, "fine2": stage_fine2, "out": stage_out}
	for s in order[order.index(args.stage):order.index(args.stop) + 1]:
		if s in stages:
			stages[s](args)
	log("all done")


if __name__ == "__main__":
	main()

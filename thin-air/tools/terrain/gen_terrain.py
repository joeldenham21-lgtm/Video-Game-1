#!/usr/bin/env python3
"""THIN AIR terrain generator (deterministic). See tools/README.md and design.py.

    python3.12 thin-air/tools/terrain/gen_terrain.py            # full run (~6-10 min), writes assets + layout
    python3.12 thin-air/tools/terrain/gen_terrain.py --stage mid --preview /tmp/p   # macro stages + previews

Stages (cached in tools/terrain/_cache/*.npz, re-run from any stage with --stage):
  far   48 m grid, +-24.6 km: designed skeleton near the map, a sea of ridged-noise peaks over the regional
        valley network further out, fall-line erosion noise
  mid   6 m grid, +-3072 m: harmonic design surface (macro.py) matched to FAR, sculpted with facets, ragged
        crests and fall-line gully/spur erosion noise
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
import macro  # noqa: E402
import tlib  # noqa: E402
from fields import blur, grid, resample, smoothstep  # noqa: E402

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


# ============================================================================================ helpers
def make_cone(n, x0, dx):
	"""cone_fn for macro.valley_cone: valley-wall slope limits (gentle below the cliff base, steep above; steeper
	walls around high floors - cirques, hanging valleys - and in the designed gorges)."""
	from fields import SkeletonField
	gz = {}

	def fn(X, Z, floor):
		m = X.shape[0]
		d = float(X[0, 1] - X[0, 0])
		key = (m, d)
		if key not in gz:
			w = np.zeros(X.shape)
			kg = np.zeros(X.shape)
			for gdef in D.GORGES:
				F = SkeletonField(m, float(X[0, 0]), d, [gdef["points"]], pad=0.05, step=d * 0.25)
				dd, _ = F.query(X, Z)
				wi = 1 - smoothstep(gdef["radius"] * 0.6, gdef["radius"], dd)
				kg = np.where(wi > w, np.tan(np.radians(gdef["deg"])), kg)
				w = np.maximum(w, wi)
			H1 = D.CLIFF_BASE + D.CLIFF_BASE_VAR * noise_on(m, float(X[0, 0]), d, 1 / 900.0, 3, 300)
			gz[key] = (w, kg, H1)
		w, kg, H1 = gz[key]
		lo = np.tan(np.radians(D.WALL_LO_DEG))
		k_lo = lo + (np.tan(np.radians(48.0)) - lo) * smoothstep(1900.0, 2500.0, floor)
		k_lo = k_lo * (1 - w) + kg * w
		k_hi = np.maximum(np.tan(np.radians(D.WALL_HI_DEG)), kg * w)
		return k_lo, k_hi, H1
	return fn


def grade_ramps(h, n, x0, dx, max_cross_deg=24.0):
	"""Grade the golden-path corridors (design.RAMPS): inside each corridor the surface follows the corridor's
	smooth longitudinal profile, keeping the natural cross shape but limited to max_cross_deg either side, so
	switchbacking trails fit without cliffs. Returns (h, corridor weight 0..1)."""
	from fields import SkeletonField
	X, Z = grid(n, x0, dx)
	h = h.astype(np.float64)
	wsum = np.zeros_like(h)
	kx = np.tan(np.radians(max_cross_deg))
	hs = blur(h.astype(np.float32), 20.0 / dx).astype(np.float64)
	for r in D.RAMPS:
		F = SkeletonField(n, x0, dx, [r["points"]], pad=0.05, step=dx * 0.25)
		d, a = F.query(X, Z)
		W = r["width"]
		w = 1 - smoothstep(W * 0.45, W, d)
		if not (w > 0).any():
			continue
		ys = a[0]
		target = ys + np.clip(hs - ys, -d * kx, d * kx) + (h - hs) * 0.35
		h = h + (target - h) * w
		wsum = np.maximum(wsum, w)
	return h.astype(np.float32), wsum.astype(np.float32)


def make_profile(n, x0, dx):
	"""profile_fn for macro.design_surface on this grid: cliff-base altitude with noise, raised along the ramps."""
	from fields import SkeletonField

	def fn(s, Hv, Hc):
		m = s.shape[0]
		d = dx * (n - 1) / (m - 1)
		H1 = D.CLIFF_BASE + D.CLIFF_BASE_VAR * noise_on(m, x0, d, 1 / 900.0, 3, 300)
		X, Z = grid(m, x0, d)
		for r in D.RAMPS:
			F = SkeletonField(m, x0, d, [[p[:2] for p in r["points"]]], pad=0.05, step=d * 0.25)
			dd, _ = F.query(X, Z)
			H1 = H1 + 1500.0 * (1 - smoothstep(r["width"] * 0.6, r["width"] + 60.0, dd))
		return macro.cliff_profile(s, Hv, Hc, H1)
	return fn



def gradient(h, dx, sigma=0.0):
	hb = blur(h, sigma) if sigma > 0 else h
	gz, gx = np.gradient(hb.astype(np.float64), dx)
	return gx.astype(np.float32), gz.astype(np.float32)


def noise_on(n, x0, dx, freq, octaves, seed, kind="fbm", **kw):
	return tlib.noise(n, n, x0, x0, dx, freq, octaves, seed=SEED + seed, kind=kind, **kw)


def sculpt(h0, s, rel, floor, n, x0, dx, seed, facet=0.05, crest=0.05, cascade=None, warp=350.0):
	"""Break the harmonic design surface into mountain form: large facet undulation (spurs/bowls), ragged
	crests (ridged noise near s = 1), then a cascade of fall-line gully/spur erosion noise from coarse to fine.
	Each level's gradient is taken from the result so far, so smaller gullies run down the flanks of the larger
	spurs: a branching (dendritic) hierarchy. Amplitudes scale with the local relief (crest - floor)."""
	if cascade is None:
		# (wavelength m, amplitude as fraction of relief, octaves); amplitude is also capped at 6 % of the
		# wavelength so gully flanks add at most ~20 deg of slope
		cascade = [(650.0, 0.05, 3), (260.0, 0.02, 3), (110.0, 0.008, 3)]
	wx = noise_on(n, x0, dx, 1 / 1800.0, 3, seed + 1) * warp
	wz = noise_on(n, x0, dx, 1 / 1800.0, 3, seed + 2) * warp
	body = smoothstep(0.0, 0.3, s) * (1 - smoothstep(0.85, 1.0, s) * 0.5)
	h = h0 + rel * facet * noise_on(n, x0, dx, 1 / 1400.0, 4, seed + 3, warpx=wx, warpz=wz) * body
	cr = smoothstep(0.55, 1.0, s)
	h = h + rel * crest * (noise_on(n, x0, dx, 1 / 380.0, 5, seed + 4, "ridged", warpx=wx * 0.4,
								   warpz=wz * 0.4) - 0.5) * cr
	# floors: noise tapers in over ~30 m instead of stopping at the floor edge
	fw = np.clip(blur(floor.astype(np.float32), 30.0 / dx) * 1.6, 0.0, 1.0)
	h = h0 + (h - h0) * (1 - fw)
	on = smoothstep(0.02, 0.3, s) * (1 - fw)
	for k, (scale, amp, octs) in enumerate(cascade):
		gx, gz = gradient(h, dx, max(scale / 8.0 / dx, 1.0))
		E = tlib.erosion_noise(gx, gz, x0, x0, dx, 1 / scale, octs, 0.45, 2.0, 0.5, 0.05, seed=SEED + seed + 5 + k)
		h = h + np.minimum(rel * amp, scale * 0.06) * E * on
	# gentle long-wave relief on the floors themselves (terraces, fans, old channels)
	h = h + fw * (noise_on(n, x0, dx, 1 / 320.0, 3, seed + 6) * 3.0)
	return h.astype(np.float32)


# ============================================================================================ FAR
def stage_far(args):
	"""Regional landscape (+-24.6 km, 48 m): designed valley network + a sea of peaks. Near the map the
	designed skeleton (crests + valleys) shapes the land; far away peaks come from ridged noise over the
	regional valleys' floors."""
	n, x0, dx = FAR_N, FAR_X0, FAR_DX
	log("FAR: design", n, "x", n, "@", dx, "m")
	valleys = list(D.MAP_VALLEYS.values()) + list(D.OUTER_VALLEYS.values())
	crests = list(D.MAP_CRESTS.values()) + list(D.OUTER_CRESTS.values())
	def warp_fn(m, wx0, d):
		# meanders for the regional valleys, none near the designed map
		Xm, Zm = grid(m, wx0, d)
		a = smoothstep(4000.0, 12000.0, np.maximum(np.abs(Xm), np.abs(Zm))) * 1500.0
		return (noise_on(m, wx0, d, 1 / 7000.0, 4, 90) * a, noise_on(m, wx0, d, 1 / 7000.0, 4, 91) * a)

	R = macro.design_surface(n, x0, dx, valleys, crests, profile_exp=1.9, warp_fn=warp_fn,
							 profile_fn=make_profile(n, x0, dx), cone_fn=make_cone(n, x0, dx))
	X, Z = grid(n, x0, dx)
	r = np.maximum(np.abs(X), np.abs(Z))
	# procedural ranges: floors from the harmonic Hv, peaks from ridged multifractal
	vm, _, dv, _ = macro.raster_valleys(n, x0, dx, valleys, warp_fn=warp_fn)
	wx = noise_on(n, x0, dx, 1 / 9000.0, 3, 101) * 1800.0
	wz = noise_on(n, x0, dx, 1 / 9000.0, 3, 102) * 1800.0
	Dm = 2200.0 + 700.0 * noise_on(n, x0, dx, 1 / 11000.0, 2, 103)
	sp = np.clip(dv / Dm, 0.0, 1.0) ** 0.62
	rid = noise_on(n, x0, dx, 1 / 6500.0, 7, 104, "ridged", warpx=wx, warpz=wz)
	relief = 1650.0 + 350.0 * noise_on(n, x0, dx, 1 / 14000.0, 2, 105)
	hp = R["Hv"] + relief * sp * (0.30 + 0.85 * rid)
	# near the map the design rules; blend to the procedural ranges 3.5 .. 6.5 km out
	w = smoothstep(3500.0, 6500.0, r)
	rel_d = np.maximum(R["Hc"] - R["Hv"], 60.0)
	hd = sculpt(R["h0"], R["s"], rel_d, R["floor"], n, x0, dx, 110, facet=0.08, crest=0.05, cascade=[])
	h = hd * (1 - w) + hp * w
	h = np.where(vm, R["h0"], h)
	gx, gz = gradient(h, dx, 1.5)
	E = tlib.erosion_noise(gx, gz, x0, x0, dx, 1 / 3200.0, 6, 0.5, 2.0, 0.7, 0.05, seed=SEED + 120)
	h = h + (relief * 0.10 * w + rel_d * 0.05 * (1 - w)) * E * smoothstep(0.05, 0.5, np.maximum(sp * w, R["s"] * (1 - w)))
	h = np.where(vm, R["h0"], h).astype(np.float32)
	h = tlib.thermal(h, dx, 52.0, 4, 0.5)
	np.savez_compressed(cache_path("far"), h=h)
	log("FAR: done  min %.0f max %.0f" % (h.min(), h.max()))
	if args.preview:
		import preview
		preview.render(h, dx, os.path.join(args.preview, "far.png"), 1024)
	return h


# ============================================================================================ MID
def stage_mid(args):
	"""+-3,072 m at 6 m: designed basin (harmonic design surface at 12 m, matched to FAR at the border),
	sculpted with facets, ragged crests and fall-line gully noise."""
	far = np.load(cache_path("far"))["h"]
	n12, dx12 = 513, 12.0
	log("MID: design", n12, "@", dx12, "m")
	valleys = list(D.MAP_VALLEYS.values()) + list(D.OUTER_VALLEYS.values())
	crests = list(D.MAP_CRESTS.values()) + list(D.OUTER_CRESTS.values())
	hf = resample(far, FAR_X0, FAR_DX, MID_X0, dx12, n12, order=3)
	R = macro.design_surface(n12, MID_X0, dx12, valleys, crests, profile_exp=1.9, boundary=hf, boundary_band=240.0,
							 profile_fn=make_profile(n12, MID_X0, dx12), cone_fn=make_cone(n12, MID_X0, dx12))
	log("MID: upsample to 6 m + sculpt")
	up = lambda a, o=3: resample(a, MID_X0, dx12, MID_X0, MID_DX, MID_N, order=o)
	h0, s, Hv, Hc = up(R["h0"]), np.clip(up(R["s"], 1), 0, 1), up(R["Hv"], 1), up(R["Hc"], 1)
	floor = up(R["floor"].astype(np.float32), 1) > 0.5
	dv = up(R["dv"], 1)
	rel = np.maximum(Hc - Hv, 60.0)
	h = sculpt(h0, s, rel, floor, MID_N, MID_X0, MID_DX, 200)
	# layer-cake benches and cliff bands above the cliff base (the Rockies' look; walkable ledges between walls)
	X6, Z6 = grid(MID_N, MID_X0, MID_DX)
	H1 = D.CLIFF_BASE + D.CLIFF_BASE_VAR * noise_on(MID_N, MID_X0, MID_DX, 1 / 900.0, 3, 300)
	slope6 = np.degrees(np.arctan(np.hypot(*gradient(h, MID_DX, 2.0))))
	wt = smoothstep(H1 - 80.0, H1 + 120.0, h) * smoothstep(28.0, 42.0, slope6) * (1 - floor)
	wt = wt * np.clip(0.55 + 0.6 * noise_on(MID_N, MID_X0, MID_DX, 1 / 700.0, 3, 240), 0.0, 1.0)
	h, _ = macro.terrace(h, X6, Z6, blur(wt, 2.0), SEED + 241,
						 warp=noise_on(MID_N, MID_X0, MID_DX, 1 / 600.0, 3, 242) * 25.0)
	# concave footslopes: fans / talus aprons ease every valley wall into its floor (no hard kink)
	Wf = 55.0 + 45.0 * noise_on(MID_N, MID_X0, MID_DX, 1 / 500.0, 3, 230) + 25.0 * np.clip(rel / 1200.0, 0, 1)
	t = np.clip(dv / np.maximum(Wf, 20.0), 0.0, 1.0)
	q = t * t * (2.0 - t)
	h = np.where(floor, h, Hv + (h - Hv) * q).astype(np.float32)
	h, ramp_w = grade_ramps(h, MID_N, MID_X0, MID_DX)
	# keep the outer ring equal to FAR
	X, Z = grid(MID_N, MID_X0, MID_DX)
	edge = np.minimum(np.minimum(X - MID_X0, -MID_X0 - X), np.minimum(Z - MID_X0, -MID_X0 - Z))
	hf6 = resample(far, FAR_X0, FAR_DX, MID_X0, MID_DX, MID_N, order=3)
	wb = 1.0 - smoothstep(60.0, 300.0, edge)
	h = (h * (1 - wb) + hf6 * wb).astype(np.float32)
	h = tlib.thermal(h, MID_DX, 55.0, 3, 0.5, fixed=floor.astype(np.uint8))
	np.savez_compressed(cache_path("mid"), h=h, hv=Hv, dv=dv, s=s, rel=rel, floor=floor, ramp=ramp_w)
	log("MID: done  min %.0f max %.0f" % (h.min(), h.max()))
	if args.preview:
		import preview
		preview.render(h, MID_DX, os.path.join(args.preview, "mid.png"), 1024)
		c = (MID_N - 1) // 4
		preview.render(h[c:c + 513, c:c + 513], MID_DX, os.path.join(args.preview, "mid_map.png"), 1024)
		preview.views(h, MID_X0, MID_DX, os.path.join(args.preview, "mid"))
	return h


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
	F.forefield()
	for R in D.RIVERS:
		F.river(R)
	log("FINE2: pads")
	F.pads()
	log("FINE2: trails")
	F.trails()
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

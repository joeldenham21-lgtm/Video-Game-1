"""Metal, rubber and glass material sets for THIN AIR.

Metals follow the metalness workflow: albedo of bare metal = its specular colour (aluminium ~0.91 linear,
zinc ~0.66, steel ~0.55), metallic = 1 there; paint, oxide, rust and grime are dielectric (metallic 0)."""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

import common as cm
import texlib as tl

ALU = tl.srgb_to_lin(np.array([245, 246, 247]) / 255.0) * 0.96
ALU_DULL = tl.srgb_to_lin(np.array([206, 208, 210]) / 255.0)
STEEL = tl.srgb_to_lin(np.array([176, 176, 174]) / 255.0)
ZINC = tl.srgb_to_lin(np.array([196, 200, 204]) / 255.0)


def scratches(t: tl.Tex, rng, n: int, len_m=(0.01, 0.12), width=1, bundle: float = 0.3,
              angle: float | None = None, curve: float = 0.15) -> np.ndarray:
	"""Wrap-around scratch mask (0..1) drawn with PIL; some scratches come in parallel bundles."""
	W, H = t.w, t.h
	img = Image.new("L", (W * 3, H * 3), 0)
	d = ImageDraw.Draw(img)
	i = 0
	while i < n:
		a = rng.random() * math.pi if angle is None else angle + rng.normal(0, 0.15)
		cx, cy = W + rng.random() * W, H + rng.random() * H
		k = int(rng.integers(3, 9)) if rng.random() < bundle else 1
		off = rng.normal(0, 1, 2)
		for j in range(k):
			L = t.px(rng.uniform(*len_m))
			x0 = cx + j * 2.5 * math.sin(a) + off[0] * j
			y0 = cy - j * 2.5 * math.cos(a) + off[1] * j
			pts = [(x0, y0)]
			aa = a
			for s in range(6):
				aa += rng.normal(0, curve / 6)
				pts.append((pts[-1][0] + math.cos(aa) * L / 6, pts[-1][1] + math.sin(aa) * L / 6))
			val = int(120 + 135 * rng.random())
			d.line(pts, fill=val, width=width)
			i += 1
	a = np.array(img, dtype=np.float64) / 255.0
	return np.clip(a.reshape(3, H, 3, W).max(axis=(0, 2)), 0, 1)


def dots(t: tl.Tex, pts_yx, radius_px: float) -> np.ndarray:
	"""Soft round dots at pixel positions (wrap-around) → mask 0..1 and dome height 0..1."""
	S = t.shape
	m = np.zeros(S)
	hc = tl.HeightCanvas(S, 0.0)
	for (y, x) in pts_yx:
		ix, py, px_ = hc.region(y, x, int(radius_px) + 2, int(radius_px) + 2)
		d = np.sqrt(py * py + px_ * px_) / radius_px
		dome = np.sqrt(np.clip(1 - d * d, 0, 1))
		m[ix] = np.maximum(m[ix], dome)
	return m


# =============================================================================================
def metal_aircraft(t: tl.Tex) -> dict:
	"""White-painted aluminium bush-plane skin (DHC-3 Otter style): lapped panels, rivet rows, chipped paint
	over zinc-chromate primer, grime in seams, oil streaks trailing aft (+U)."""
	S = t.shape
	r = t.rng
	px = t.px
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	# panel layout: 3 rows of panels, vertical seams staggered per row
	rows = np.sort(r.random(3)) * t.h
	rows = np.array([0.08, 0.41, 0.74]) * t.h + r.normal(0, 8, 3)
	ri = np.searchsorted(rows, yy, side="right") - 1
	ri = ri % 3
	seam_h = np.zeros(S)
	lap = np.zeros(S)
	for k, ry in enumerate(rows):
		dy = ((yy - ry) + t.h / 2) % t.h - t.h / 2
		seam_h = np.maximum(seam_h, 1 - tl.smoothstep(0.4, 1.4, np.abs(dy)))
		lap += np.where((dy > 0) & (dy < px(0.02)), 1.0, 0.0)     # overlap strip below each seam
	vseams = [np.sort((r.random(2) + np.arange(2)) / 2) * t.w for _ in range(3)]
	seam_v = np.zeros(S)
	for k in range(3):
		for vx in vseams[k]:
			dx = ((xx - vx) + t.w / 2) % t.w - t.w / 2
			seam_v = np.maximum(seam_v, (1 - tl.smoothstep(0.4, 1.4, np.abs(dx))) * (ri == k))
	seam = np.maximum(seam_h, seam_v)
	# rivets: along each seam (both sides) and along stringers every ~16 cm
	rp = []
	pitch = px(0.025)
	for ry in rows:
		for off in (-px(0.009), px(0.009)):
			x0 = r.random() * pitch
			for x in np.arange(x0, t.w, pitch):
				rp.append((ry + off, x))
	for k in range(3):
		y0, y1 = rows[k], rows[(k + 1) % 3] + (t.h if k == 2 else 0)
		for vx in vseams[k]:
			for off in (-px(0.009), px(0.009)):
				for y in np.arange(y0 + pitch, y1 - pitch * 0.5, pitch):
					rp.append((y % t.h, vx + off))
		for sy in np.arange(y0 + px(0.16), y1 - px(0.08), px(0.16)):
			for x in np.arange(r.random() * pitch * 1.4, t.w, pitch * 1.4):
				rp.append((sy % t.h, x))
	rivet = dots(t, rp, px(0.0032))
	# dents (oil-canning / hail)
	dents = tl.spectral(S, r, 2, 12, 1.6) * 0.0008 + np.minimum(tl.spectral(S, r, 6, 30, 1.2), 0) * 0.0004
	height = dents + lap * 0.0006 + rivet * 0.0007 - seam * 0.0005
	# paint: aged off-white, chalky, faint yellowing
	paint = tl.fill(S, tl.rgb(226, 224, 214)) * np.exp(0.02 * tl.spectral(S, r, 2, 30, 1.2) + 0.015 * tl.spectral(S, r, 100, 512, 0.2))[..., None]
	paint = tl.mix3(paint, tl.rgb(214, 210, 192), tl.smoothstep(0.0, 1.5, tl.spectral(S, r, 1, 8, 1.4)) * 0.4)
	# chips: near seams and rivets, plus random dings; primer ring (zinc chromate) then bare aluminium
	chipn = 0.6 * tl.spectral(S, r, 6, 90, 1.1) + 0.4 * tl.spectral(S, r, 60, 400, 0.6) + 3.5 * tl.gauss(seam, 5) + 1.5 * tl.gauss(rivet, 3)
	q1, q2 = np.quantile(chipn, [0.978, 0.986])
	chip = tl.smoothstep(q2, q2 + 0.05, chipn)
	primer = tl.smoothstep(q1, q1 + 0.05, chipn) * (1 - chip)
	scr = scratches(t, r, 50, (0.01, 0.12), 1, 0.35)
	bare = np.clip(chip + scr * 0.9, 0, 1)
	col = tl.mix3(paint, tl.rgb(160, 168, 98), primer)
	col = tl.mix3(col, ALU_DULL, bare)
	# grime: collects in seams, around rivets, and trails aft (+x) from them
	gsrc = np.clip(seam * 0.8 + rivet * 0.6, 0, 1)
	grime = tl.blur_dir(gsrc, px(0.12), angle=0.0, taps=40, decay=3.0) * 2.2
	grime = np.clip(tl.gauss(grime, 1.0) + tl.smoothstep(0.5, 2.0, tl.spectral(S, r, 3, 30, 1.2)) * 0.25, 0, 1)
	col = tl.mix3(col, tl.rgb(92, 88, 80), grime * 0.45)
	# oil streaks: few, long, brown-black, from seam points
	oil_src = np.zeros(S)
	for k in range(5):
		oy = rows[r.integers(0, 3)] + r.normal(0, 30)
		ox = r.random() * t.w
		oil_src[int(oy) % t.h, int(ox) % t.w] = 1.0
	oil = tl.blur_dir(tl.gauss(oil_src, 4) * 400, px(0.6), angle=0.03, taps=60, decay=2.0)
	oil = np.clip(tl.gauss_aniso(oil, 3, 1) * 1.6, 0, 1) * tl.smoothstep(-1, 1, tl.spectral(S, r, 8, 60, 1.0, stretch=6))
	col = tl.mix3(col, tl.rgb(54, 42, 30), oil * 0.7)
	col = tl.mix3(col, tl.rgb(60, 60, 58), seam * 0.6)
	col = tl.mix3(col, tl.rgb(110, 106, 98), np.clip(tl.gauss(rivet, 1.2) * 1.6 - rivet * 0.7, 0, 1) * 0.65)
	col = tl.mix3(col, tl.rgb(200, 200, 194), rivet * 0.5)
	rough = 0.42 + 0.12 * tl.norm01(tl.spectral(S, r, 2, 20, 1.2)) + 0.25 * grime - 0.2 * oil
	rough = np.where(bare > 0.5, 0.32, rough)
	metal = bare
	height -= chip * 0.00012 + primer * 0.00006
	return dict(albedo=col, height=height, rough=rough, metal=metal, ao_radius=0.004, ao_bake=0.15)


# =============================================================================================
def metal_bare(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	brush = tl.spectral(S, r, 60, 512, 0.2, stretch=12, angle=0.0)
	scr = scratches(t, r, 700, (0.01, 0.2), 1, 0.4)
	scr2 = scratches(t, r, 120, (0.05, 0.3), 1, 0.6, angle=0.3)
	oxid = tl.patches(S, r, 4, 60, 0.3, 0.6, detail=1.0)
	smudge = tl.smoothstep(-0.2, 1.2, tl.spectral(S, r, 4, 30, 1.2))
	col = tl.lerp(ALU, ALU_DULL, 0.35)[None, None, :] * np.ones(S + (3,))
	col *= np.exp(0.03 * brush)[..., None]
	col = tl.mix3(col, tl.rgb(196, 198, 198), oxid * 0.15)
	col = tl.mix3(col, ALU, np.clip(scr + scr2, 0, 1) * 0.5)
	rough = 0.42 + 0.04 * brush + 0.10 * oxid - 0.04 * smudge + 0.08 * np.clip(scr + scr2, 0, 1)
	metal = 1.0 - 0.12 * oxid
	# sheet flatness: only a faint waviness (strong low-frequency relief reads as dented, blotchy reflections)
	height = tl.spectral(S, r, 1, 8, 1.6) * 0.00012 - np.clip(scr + scr2, 0, 1) * 0.00004 + brush * 0.000003
	return dict(albedo=col, height=height, rough=rough, metal=metal, ao_radius=0.003, ao_bake=0.05)


# =============================================================================================
def metal_rusty(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	cover = tl.warp(tl.spectral(S, r, 2, 40, 1.1), *(tl.spectral(S, r, 8, 60, 1.2) * px(0.02) for _ in range(2)))
	rust = tl.patches(S, r, 2, 40, 0.975, 0.25)
	orange = tl.patches(S, r, 4, 60, 0.35, 0.5, detail=0.8)
	ochre = tl.patches(S, r, 6, 80, 0.07, 0.3, detail=0.8)
	# flaking scale plates and blisters
	scale = tl.worley(S, r, 1400, k=2, dx=tl.spectral(S, r, 10, 80, 1.1) * 4, dy=tl.spectral(S, r, 10, 80, 1.1) * 4)
	lifted = (r.random(scale.count) < 0.35)[scale.cell]
	plate_h = np.where(lifted, 0.0004 + 0.0003 * r.random(scale.count)[scale.cell], 0.0)
	plate_edge = 1 - tl.smoothstep(0.0, 0.002, scale.edge)
	blist = tl.worley(S, r, 3000, k=1)
	bl = np.clip(1 - blist.f1 / 0.006, 0, 1) ** 2 * (r.random(blist.count)[blist.cell] < 0.4) * 0.0005
	pits = tl.worley(S, r, 5000, k=1)
	pit = (1 - tl.smoothstep(0.0, 0.0022, pits.f1)) * (r.random(pits.count)[pits.cell] < 0.5)
	height = rust * (plate_h * (1 - plate_edge) + bl + tl.spectral(S, r, 60, 512, 0.5) * 0.0002) - pit * 0.0006
	height += tl.spectral(S, r, 1, 6, 1.6) * 0.0008
	dark = tl.fill(S, tl.rgb(66, 42, 30))
	col = tl.mix3(dark, tl.rgb(118, 62, 32), orange * 0.6)
	col = tl.mix3(col, tl.rgb(146, 100, 50), ochre * 0.5)
	col *= np.exp(0.16 * tl.spectral(S, r, 30, 500, 0.3) + 0.08 * tl.spectral(S, r, 2, 30, 1.2))[..., None]
	col = tl.mix3(col, tl.rgb(40, 26, 20), pit * 0.8 + plate_edge * lifted * 0.4)
	steel = STEEL * np.exp(0.1 * tl.spectral(S, r, 20, 200, 0.6))[..., None]
	millscale = tl.patches(S, r, 3, 30, 0.5, 0.5)
	steel = tl.mix3(steel, tl.rgb(60, 62, 66), millscale * 0.7)
	col = tl.mix3(steel, col, rust)
	rough = tl.lerp(0.45 + 0.2 * millscale, 0.9 + 0.05 * orange, rust)
	metal = (1 - rust) * (1 - 0.6 * millscale)
	return dict(albedo=col, height=height, rough=rough, metal=metal, ao_radius=0.004, ao_bake=0.25)


# =============================================================================================
def metal_corrugated(t: tl.Tex) -> dict:
	"""Galvanised corrugated sheet, 76 mm pitch x 18 mm depth (15 corrugations per 1.14 m tile), ridges along V."""
	S = t.shape
	r = t.rng
	px = t.px
	yy, xx = np.mgrid[0:t.h, 0:t.w].astype(np.float64)
	ncorr = 15
	phase = 2 * np.pi * (xx + 0.5) / t.w * ncorr
	corr = 0.009 * np.sin(phase)
	valley = tl.smoothstep(0.3, 1.0, -np.sin(phase))
	dents = tl.spectral(S, r, 1, 10, 1.6) * 0.0012
	# nails through the ridges on one purlin row, lead washers
	nail_y = 0.22 * t.h
	np_ = [(nail_y + r.normal(0, 2), (k + 0.25) * t.w / ncorr) for k in range(0, ncorr, 2)]
	nail = dots(t, np_, px(0.008))
	height = corr + dents + nail * 0.002
	# spangle
	sp = tl.worley(S, r, 7000, k=2)
	spv = r.normal(0, 1, sp.count)[sp.cell]
	weather = tl.patches(S, r, 2, 20, 0.5, 0.8)
	zinc = ZINC * (0.62 - 0.12 * weather)[..., None] / 0.62 * 0.8
	col = zinc * np.exp(0.05 * spv)[..., None]
	col *= np.exp(0.04 * tl.spectral(S, r, 20, 200, 0.6))[..., None]
	# white rust (zinc oxide) blooms, favouring valleys where water sits
	wr = tl.patches(S, r, 6, 100, 0.18, 0.5, detail=0.9) * (0.4 + 0.6 * valley)
	col = tl.mix3(col, tl.rgb(168, 170, 166), wr * 0.45)
	# red rust: around nails and random holes/scratches, streaking down the valleys
	src = nail * 0.9 + tl.patches(S, r, 10, 120, 0.01, 0.2) * 0.8
	streak = tl.blur_dir(src, px(0.7), angle=math.pi / 2, taps=70, decay=2.5)
	streak = tl.gauss_aniso(streak, 2.0, 1.0) * 5.0
	streak = np.clip(streak * (0.35 + 0.65 * valley) * tl.smoothstep(-1.0, 1.0, tl.spectral(S, r, 6, 60, 1.0, stretch=5, angle=math.pi / 2)), 0, 1)
	rustc = tl.mix3(tl.fill(S, tl.rgb(120, 58, 30)), tl.rgb(84, 46, 30), tl.norm01(tl.spectral(S, r, 20, 200, 0.6)))
	col = tl.mix3(col, rustc, streak * 0.85)
	col = tl.mix3(col, tl.rgb(96, 98, 100), nail)
	rough = 0.42 + 0.03 * spv.clip(-2, 2) + 0.18 * weather
	rough = tl.lerp(rough, 0.88, np.clip(wr * 0.8 + streak, 0, 1))
	metal = (1 - np.clip(wr * 0.8 + streak, 0, 1)) * 0.95
	return dict(albedo=col, height=height, rough=rough, metal=metal, ao_radius=0.02, ao_bake=0.15, normal_scale=1.0)


# =============================================================================================
def metal_painted_green(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	px = t.px
	peel = tl.spectral(S, r, 4, 80, 1.1) + 0.45 * tl.spectral(S, r, 60, 400, 0.5)
	q1, q2 = np.quantile(peel, [0.955, 0.975])
	chip = tl.smoothstep(q2, q2 + 0.04, peel)
	primer = tl.smoothstep(q1, q1 + 0.04, peel) * (1 - chip)
	scr = scratches(t, r, 60, (0.02, 0.15), 1, 0.35)
	bare = np.clip(chip + scr * 0.7, 0, 1)
	rust_c = tl.gauss(bare, 3) * 2.5
	rust = np.clip(rust_c, 0, 1) * (1 - bare * 0.3)
	streak = np.clip(tl.blur_dir(tl.gauss(chip, 2), px(0.25), angle=math.pi / 2, taps=40, decay=3.0) * 3, 0, 1) * (1 - chip)
	paint = tl.fill(S, tl.rgb(54, 74, 56)) * np.exp(0.04 * tl.spectral(S, r, 2, 30, 1.2) + 0.03 * tl.spectral(S, r, 80, 500, 0.3))[..., None]
	fade = tl.patches(S, r, 1, 10, 0.4, 0.8)
	paint = tl.mix3(paint, tl.rgb(80, 96, 78), fade * 0.2)
	col = tl.mix3(paint, tl.rgb(132, 60, 42), primer)
	col = tl.mix3(col, tl.rgb(116, 60, 34), np.clip(rust * 0.7 + streak * 0.5, 0, 1))
	col = tl.mix3(col, STEEL * 0.8, bare * (1 - np.clip(rust_c - 1.5, 0, 1)))
	dust = tl.patches(S, r, 3, 40, 0.25, 0.6)
	col = tl.mix3(col, tl.rgb(116, 110, 98), dust * 0.18)
	orange_peel = tl.spectral(S, r, 120, 400, 0.4) * 0.00002
	height = orange_peel + tl.spectral(S, r, 1, 8, 1.6) * 0.0005 - chip * 0.00015 - primer * 0.00007
	rough = 0.38 + 0.2 * fade + 0.2 * dust
	rough = np.where(primer > 0.5, 0.7, rough)
	rough = tl.lerp(rough, 0.88, np.clip(rust * 0.7 + streak * 0.5, 0, 1))
	rough = np.where(bare > 0.5, 0.42, rough)
	metal = bare * (1 - np.clip(rust_c - 1.5, 0, 1))
	return dict(albedo=col, height=height, rough=rough, metal=metal, ao_radius=0.003, ao_bake=0.1)


# =============================================================================================
def rubber(t: tl.Tex) -> dict:
	S = t.shape
	r = t.rng
	stip = tl.spectral(S, r, 150, 512, 0.2)
	wear = tl.patches(S, r, 3, 40, 0.3, 0.7)
	scuff = scratches(t, r, 60, (0.01, 0.08), 1, 0.3) * 0.6
	dust = tl.patches(S, r, 20, 200, 0.2, 0.6) * (1 - wear)
	ozone = tl.worley(S, r, 2500, k=2, sy=3.0)
	crack = (1 - tl.smoothstep(0.0, 0.0012, ozone.edge)) * tl.smoothstep(0.8, 1.6, tl.spectral(S, r, 2, 12, 1.3))
	col = tl.fill(S, tl.rgb(34, 34, 33)) * np.exp(0.06 * stip)[..., None]
	col = tl.mix3(col, tl.rgb(44, 43, 41), wear * 0.5)
	col = tl.mix3(col, tl.rgb(84, 80, 74), dust * 0.25)
	col = tl.mix3(col, tl.rgb(80, 80, 78), scuff * 0.5)
	col = tl.mix3(col, tl.rgb(16, 16, 16), crack)
	height = stip * 0.00003 * (1 - wear) + tl.spectral(S, r, 1, 8, 1.6) * 0.0004 - crack * 0.0003 - scuff * 0.00004
	rough = 0.82 - 0.22 * wear + 0.08 * dust + 0.05 * scuff
	return dict(albedo=col, height=height, rough=rough, ao_radius=0.003, ao_bake=0.1)


# =============================================================================================
def glass_grime(t: tl.Tex) -> dict:
	"""Dirty window glass: alpha = grime coverage over a faint base film; roughness smooth where clean.
	Old sheet glass also waves slightly (normal)."""
	S = t.shape
	r = t.rng
	px = t.px
	film = tl.smoothstep(-0.5, 1.8, tl.spectral(S, r, 1, 10, 1.4)) * 0.25
	src = (tl.smoothstep(1.4, 2.2, tl.spectral(S, r, 20, 160, 0.8))).astype(float)
	runs = tl.blur_dir(src, px(0.35), angle=math.pi / 2, taps=60, decay=2.2)
	runs = np.clip(tl.gauss_aniso(runs, 1.5, 0.6) * 3.0, 0, 1)
	spots = tl.worley(S, r, 900, k=1)
	sr = 0.002 + 0.005 * r.random(spots.count)[spots.cell]
	ring = (1 - tl.smoothstep(0.0, 0.0012, np.abs(spots.f1 - sr))) * (r.random(spots.count)[spots.cell] < 0.5)
	dust = tl.smoothstep(0.0, 1.8, tl.spectral(S, r, 40, 300, 0.6)) * 0.2
	smudge = tl.smoothstep(0.8, 1.8, tl.spectral(S, r, 6, 40, 1.1)) * 0.3
	grime = np.clip(film + runs * 0.5 + ring * 0.35 + dust + smudge, 0, 1)
	col = tl.fill(S, tl.rgb(118, 112, 100)) * np.exp(0.1 * tl.spectral(S, r, 10, 100, 0.8))[..., None]
	col = tl.mix3(col, tl.rgb(88, 84, 76), runs * 0.5)
	alpha = 0.12 + 0.75 * grime
	rough = 0.04 + 0.62 * grime
	wave = tl.spectral(S, r, 1, 6, 1.8, stretch=3, angle=0.0) * 0.00035
	height = wave + runs * 0.00002
	return dict(albedo=col, height=height, rough=rough, alpha=alpha, ao_radius=0.002, ao_bake=0.0, specular=0.5)

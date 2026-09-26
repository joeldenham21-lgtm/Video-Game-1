"""Axe notch decal (albedo+alpha, OpenGL normal) for trees being chopped (VegHarvest).

python3.12 thin-air/tools/vegetation/notch_texture.py
Out: assets/textures/foliage/chop_notch_albedo.png, chop_notch_normal.png (256 x 256, deterministic)

Layout (decal space: U around the trunk, V up the trunk, image row 0 = top):
  lens-shaped cut narrowing where the trunk curves away; upper face = the sloped chop face (pale sapwood,
  faceted by individual axe strikes, fibres running along the trunk), lower face = the level cut (end grain,
  growth rings), dark crease where they meet, torn bark fibres along the rim.
"""
import os

import numpy as np
from PIL import Image

N = 256
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "textures", "foliage")
rng = np.random.default_rng(1729)


def smooth_noise(shape, scale, octaves=4):
	out = np.zeros(shape, np.float32)
	amp = 1.0
	tot = 0.0
	for o in range(octaves):
		s = max(1, int(scale / (2 ** o)))
		g = rng.random((shape[0] // s + 2, shape[1] // s + 2)).astype(np.float32)
		img = Image.fromarray((g * 255).astype(np.uint8)).resize((shape[1] + 2 * s, shape[0] + 2 * s), Image.BICUBIC)
		a = np.asarray(img).astype(np.float32)[s:s + shape[0], s:s + shape[1]] / 255.0
		out += a * amp
		tot += amp
		amp *= 0.5
	return out / tot


def main():
	v, u = np.mgrid[0:N, 0:N].astype(np.float32)
	u = (u + 0.5) / N * 2.0 - 1.0          # -1..1 across
	v = 1.0 - (v + 0.5) / N * 2.0          # +1 top .. -1 bottom
	edge_n = smooth_noise((N, N), 12, 3)
	half = 0.92 * np.power(np.clip(1.0 - u * u, 0.0, 1.0), 0.55)
	crease = -0.28 + 0.05 * (smooth_noise((N, N), 40, 2) - 0.5)
	top = crease + (half - crease * 0.0) * 1.0 + 0.10 * (edge_n - 0.5)
	bot = crease - 0.38 * half + 0.06 * (edge_n - 0.5)
	inside = (v < top) & (v > bot)
	dist_top = top - v
	dist_bot = v - bot
	rim = np.minimum(dist_top, dist_bot)
	alpha = np.clip(rim / 0.05, 0.0, 1.0)
	upper = v >= crease
	# --- albedo (sRGB) ---
	sap = np.array([0.88, 0.79, 0.61], np.float32)
	fib = smooth_noise((N, N), 3, 2)
	fib_v = np.asarray(Image.fromarray((fib * 255).astype(np.uint8)).resize((N // 8, N), Image.BILINEAR).resize((N, N), Image.BILINEAR)).astype(np.float32) / 255.0
	# axe facets on the upper face: 5 planar strips with slightly different shade
	facet_id = np.floor((u * 0.9 + (v - crease) * 0.35 + 1.2) * 2.6).astype(np.int32)
	facet_shade = (np.sin(facet_id * 12.9898) * 43758.5453) % 1.0
	col = np.empty((N, N, 3), np.float32)
	up_col = sap[None, None, :] * (0.9 + 0.12 * facet_shade[..., None]) * (0.92 + 0.14 * fib_v[..., None])
	# lower face: end grain, growth rings (arcs around the trunk centre behind the decal)
	rr = np.sqrt(u * u + ((v - crease) * 3.0 + 2.2) ** 2)
	rings = 0.5 + 0.5 * np.sin(rr * 55.0 + 6.0 * smooth_noise((N, N), 20, 2))
	lo_col = np.array([0.80, 0.68, 0.50], np.float32)[None, None, :] * (0.86 + 0.12 * rings[..., None])
	col = np.where(upper[..., None], up_col, lo_col)
	# crease shadow and rim darkening (torn bark fibres)
	cz = np.exp(-((v - crease) / 0.035) ** 2)
	col *= (1.0 - 0.6 * cz)[..., None]
	rim_dark = np.clip(1.0 - rim / 0.07, 0.0, 1.0) * (0.5 + 0.5 * edge_n)
	bark = np.array([0.30, 0.24, 0.19], np.float32)[None, None, :]
	col = col * (1.0 - rim_dark[..., None] * 0.75) + bark * rim_dark[..., None] * 0.75
	alpha = np.where(inside, alpha, 0.0)
	# --- normal (tangent space, OpenGL: +Y = up the image) ---
	nx = 0.18 * (facet_shade - 0.5) + 0.25 * (fib_v - 0.5) * 0.4
	ny = np.where(upper, -0.55, 0.62)
	nz = np.ones_like(nx)
	nrm = np.stack([nx, ny, nz], -1)
	nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
	nrm = np.where(inside[..., None], nrm, np.array([0, 0, 1], np.float32))
	alb = np.concatenate([np.clip(col, 0, 1), alpha[..., None]], -1)
	os.makedirs(OUT, exist_ok=True)
	Image.fromarray((alb * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "chop_notch_albedo.png"))
	Image.fromarray(((nrm * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, "chop_notch_normal.png"))
	print("wrote chop_notch_albedo.png / chop_notch_normal.png")


if __name__ == "__main__":
	main()

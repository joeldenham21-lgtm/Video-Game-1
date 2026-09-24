"""Shared building blocks for THIN AIR texture generators: stones, lichen, mineral grain, output writers."""
from __future__ import annotations

import math
import os

import numpy as np

import texlib as tl

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.normpath(os.path.join(HERE, "..", ".."))           # thin-air/
TEX_DIR = os.path.join(PROJECT, "assets", "textures")
MAT_DIR = os.path.join(PROJECT, "assets", "materials")
SCRATCH = os.environ.get("TEX_PREVIEW_DIR", os.path.join(HERE, "_cache", "preview"))


# ---------------------------------------------------------------------------------------------
# lithology palettes (sRGB 0..255, measured-ish from photos of Coast Mountains / Rockies rock)
# ---------------------------------------------------------------------------------------------
GRANITE_FELDSPAR = tl.rgb(202, 200, 194)
GRANITE_KFELDSPAR = tl.rgb(208, 194, 182)
GRANITE_QUARTZ = tl.rgb(132, 133, 132)
GRANITE_BIOTITE = tl.rgb(36, 35, 33)
GRANITE_WEATHERED = tl.rgb(158, 156, 150)

LICHEN_MAP = tl.rgb(160, 168, 92)        # Rhizocarpon geographicum (yellow-green, dry)
LICHEN_ORANGE = tl.rgb(190, 112, 48)     # Xanthoria elegans
LICHEN_PALE = tl.rgb(170, 172, 158)      # Lecanora / Xanthoparmelia (pale grey-green)
LICHEN_DARK = tl.rgb(58, 54, 49)         # Umbilicaria / black crusts
LICHEN_PROTHALLUS = tl.rgb(26, 25, 24)


def granite_grain(t: tl.Tex, grain_m: float = 0.004, weather: float = 0.55, salt: int = 11,
                  shape=None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
	"""Salt-and-pepper granite crystal mosaic.
	Returns (albedo_lin HxWx3, micro_height (unitless -1..1), mineral id (0 fsp,1 kfsp,2 qtz,3 bt))."""
	shape = shape or t.shape
	h, w = shape
	rng = t.sub(salt)
	cells = int((t.tile_w_m / grain_m) ** 2 * (h / w))
	cells = max(64, min(cells, 400000))
	jit = tl.spectral(shape, rng, 20, 200, 1.0) * 0.8
	v = tl.worley(shape, rng, cells, k=2, dx=jit, dy=tl.spectral(shape, rng, 20, 200, 1.0) * 0.8,
	              aspect=h / w)
	cid = v.cell
	r = sub_rand(rng, v.count, cid)
	mineral = np.select([r < 0.50, r < 0.62, r < 0.88], [0, 1, 2], 3)
	pal = np.stack([GRANITE_FELDSPAR, GRANITE_KFELDSPAR, GRANITE_QUARTZ, GRANITE_BIOTITE])
	col = pal[mineral]
	# per-grain brightness jitter
	jb = sub_rand(rng, v.count, cid, salt=3)
	col = col * (0.82 + 0.36 * jb)[..., None]
	# weathering rind: blends toward uniform weathered grey
	wn = tl.norm01(tl.spectral(shape, rng, 2, 16, 1.0))
	wmix = np.clip(weather + (wn - 0.5) * 0.35, 0, 1)
	col = tl.mix3(col, GRANITE_WEATHERED, wmix)
	# grains: quartz stands proud, biotite/feldspar weather out, grain boundaries are pits
	relief = np.select([mineral == 2, mineral == 3], [0.8, -0.6], 0.0) + (jb - 0.5) * 0.4
	edge = tl.smoothstep(0.0, 0.35 / math.sqrt(cells), v.edge)
	micro = relief * edge - (1 - edge) * 0.7
	return col, micro, mineral


def sub_rand(rng, count, ids, salt=0):
	vals = np.random.default_rng(rng.integers(0, 2**31) + salt).random(count)
	return vals[ids]





def lichen_colonies(t: tl.Tex, coverage: float, mean_r_m: float, salt: int = 21,
                    species_w=(0.40, 0.04, 0.36, 0.20), mask: np.ndarray | None = None, shape=None,
                    cluster: float = 0.8, sigma: float = 0.75):
	"""Lobed, clustered lichen colonies with a broad (lognormal) size spread.
	Returns (alpha 0..1, colour HxWx3, rim 0..1 (black prothallus for map lichen), species id map)."""
	shape = shape or t.shape
	h, w = shape
	rng = t.sub(salt)
	area = t.tile_w_m * t.tile_w_m * h / w
	mean_area = math.pi * (mean_r_m ** 2) * math.exp(2 * sigma * sigma)
	n = max(6, int(coverage * area / mean_area * 2.6))
	wx = tl.spectral(shape, rng, 6, 90, 0.8) * t.px(mean_r_m) * 0.5
	wy = tl.spectral(shape, rng, 6, 90, 0.8) * t.px(mean_r_m) * 0.5
	v = tl.worley(shape, rng, n, k=1, dx=wx, dy=wy, aspect=h / w)
	cid = v.cell
	radii = np.clip(rng.lognormal(math.log(mean_r_m), sigma, n), mean_r_m * 0.15, mean_r_m * 5)
	dens = tl.norm01(tl.spectral(shape, rng, 1, 5, 1.4))
	sy = np.clip((v.seeds[:, 0] * h).astype(int), 0, h - 1)
	sx = np.clip((v.seeds[:, 1] * w).astype(int), 0, w - 1)
	p_alive = 0.38 * ((1 - cluster) + cluster * 2.2 * dens[sy, sx] ** 1.5)
	alive = rng.random(n) < p_alive
	species = rng.choice(4, size=n, p=np.array(species_w) / sum(species_w))
	d_m = v.f1 * t.tile_w_m
	r = radii[cid]
	lob = tl.spectral(shape, rng, 40, 300, 0.6) * 0.16
	rr = d_m / r + lob
	alpha = (1.0 - tl.smoothstep(0.85, 1.0, rr)) * alive[cid]
	if mask is not None:
		alpha *= mask
	rim = tl.smoothstep(0.80, 0.94, rr) * (1 - tl.smoothstep(0.96, 1.03, rr)) * alive[cid]
	pal = np.stack([LICHEN_MAP, LICHEN_ORANGE, LICHEN_PALE, LICHEN_DARK])
	col = pal[species[cid]]
	# per-colony tone + areolae speckle
	tone = rng.normal(0, 0.12, n)[cid]
	fine = tl.spectral(shape, rng, 150, 512, 0.3)
	col = col * np.exp(tone + 0.14 * fine)[..., None]
	# older centres fade / die back toward grey
	centre = 1 - tl.smoothstep(0.0, 0.55, rr)
	col = tl.mix3(col, LICHEN_PALE * 0.85, centre * 0.35 * (species[cid] == 0))
	alpha = alpha * (0.75 + 0.25 * tl.norm01(fine))
	return np.clip(alpha, 0, 1), col, rim, species[cid]


# ---------------------------------------------------------------------------------------------
# stones (angular talus + rounded pebbles), rasterised into a HeightCanvas
# ---------------------------------------------------------------------------------------------
def angular_stone(rng, R_px: float, aspect: float, rot: float, thick: float):
	"""Returns a function (py, px) -> height(px units) or NaN outside, for a faceted convex stone."""
	nv = rng.integers(5, 9)
	ang = np.sort(rng.random(nv) * 2 * math.pi)
	# enforce reasonable spread
	ang = np.linspace(0, 2 * math.pi, nv, endpoint=False) + (rng.random(nv) - 0.5) * (2 * math.pi / nv) * 0.7 + rng.random() * 6.28
	rad = R_px * (0.72 + 0.28 * rng.random(nv))
	vx = np.cos(ang) * rad
	vy = np.sin(ang) * rad * aspect
	c, s = math.cos(rot), math.sin(rot)
	vx, vy = vx * c - vy * s, vx * s + vy * c
	# edges (counter-clockwise order): inward normals
	ex = np.roll(vx, -1) - vx
	ey = np.roll(vy, -1) - vy
	L = np.hypot(ex, ey) + 1e-9
	# inward normal for CCW polygon in (x right, y down) screen coords: sign determined via centroid test
	nx, ny = -ey / L, ex / L
	cx0, cy0 = vx.mean(), vy.mean()
	sign = np.sign((cx0 - vx) * nx + (cy0 - vy) * ny)
	nx, ny = nx * sign, ny * sign
	slopes = thick / (R_px * (0.12 + 0.35 * rng.random(nv)))       # steep side facets (height per px)
	top_t = thick * (0.8 + 0.2 * rng.random())
	gx, gy = (rng.random(2) - 0.5) * 2 * thick / R_px * 0.45         # tilted top face
	# extra cutting planes → angular top facets (conchoidal fracture faces)
	nc = int(rng.integers(2, 5))
	ca = rng.random(nc) * 2 * math.pi
	cux, cuy = np.cos(ca), np.sin(ca)
	coff = (rng.random(nc) * 0.7 - 0.1) * R_px
	cslope = thick / R_px * (0.6 + 1.2 * rng.random(nc))
	clev = thick * (0.55 + 0.4 * rng.random(nc))

	def f(py, px):
		d = (px - vx[:, None, None]) * nx[:, None, None] + (py - vy[:, None, None]) * ny[:, None, None]
		inside = np.all(d > 0, axis=0)
		hgt = np.min(d * slopes[:, None, None], axis=0)
		hgt = np.minimum(hgt, top_t + gx * px + gy * py)
		proj = px[None] * cux[:, None, None] + py[None] * cuy[:, None, None]
		cut = clev[:, None, None] - cslope[:, None, None] * (proj - coff[:, None, None])
		hgt = np.minimum(hgt, np.min(cut, axis=0))
		return np.where(inside, hgt, np.nan)

	return f, rad.max()


def round_stone(rng, R_px: float, aspect: float, rot: float, thick: float, power: float = 0.7,
                wob=None):
	"""Ellipsoidal pebble with slight outline wobble. Returns f(py, px)."""
	c, s = math.cos(rot), math.sin(rot)
	k = rng.integers(2, 5)
	ph = rng.random(3) * 6.28
	amp = rng.random(3) * 0.08

	def f(py, px):
		u = (px * c + py * s) / R_px
		v = (-px * s + py * c) / (R_px * aspect)
		th = np.arctan2(v, u)
		wobble = 1 + amp[0] * np.sin(k * th + ph[0]) + amp[1] * np.sin((k + 1) * th + ph[1]) + amp[2] * np.sin(2 * th + ph[2])
		r2 = (u * u + v * v) / (wobble * wobble)
		inside = r2 < 1.0
		hgt = thick * np.power(np.clip(1.0 - r2, 0, 1), power * 0.5)
		return np.where(inside, hgt, np.nan)

	return f


def powerlaw_sizes(rng, n, dmin, dmax, alpha=2.0):
	"""Diameters with N(>D) ∝ D^-alpha between dmin and dmax (inverse CDF sampling)."""
	u = rng.random(n)
	a = dmin ** -alpha
	b = dmax ** -alpha
	return (a - u * (a - b)) ** (-1.0 / alpha)


# ---------------------------------------------------------------------------------------------
# output helpers
# ---------------------------------------------------------------------------------------------
def save_preview(name: str, img_u8: np.ndarray) -> str:
	os.makedirs(SCRATCH, exist_ok=True)
	p = os.path.join(SCRATCH, name + ".jpg")
	from PIL import Image
	Image.fromarray(img_u8).save(p, quality=88)
	return p

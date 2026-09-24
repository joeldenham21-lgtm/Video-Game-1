"""THIN AIR texture toolkit — periodic noise, primitive rasterisers and PBR map derivation.

Everything here is *periodic* (wraps on the tile edges) so every map built from it is seamless:
  * spectral(): FFT-filtered noise (band-limited / power-law / anisotropic) — periodic by construction
  * worley(): periodic Voronoi/Worley via scipy cKDTree(boxsize=...)
  * warp(): domain warping with grid-wrap sampling
  * Stamp / IdCanvas: wrap-around rasterisers for scattered objects (stones, needles, blades, flakes)
  * normal_from_height(): OpenGL (Y+) tangent-space normals from a height field in *metres*
  * horizon_ao(): horizon-based ambient occlusion from the same height field

Colours are handled in LINEAR space and written as sRGB. All randomness comes from
numpy.random.default_rng(seed) with seeds derived from the texture name, so output is bit-for-bit
deterministic across runs.
"""
from __future__ import annotations

import json
import math
import os
import zlib
from dataclasses import dataclass, field

import numpy as np
from numpy.fft import fftfreq, irfft2, rfft2, rfftfreq
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

F32 = np.float32


# ---------------------------------------------------------------------------------------------
# seeds, contexts
# ---------------------------------------------------------------------------------------------
def seed_of(name: str, salt: int = 0) -> int:
	return (zlib.crc32(name.encode("utf-8")) ^ (salt * 0x9E3779B1)) & 0xFFFFFFFF


@dataclass
class Tex:
	"""Generation context for one texture set."""
	name: str
	w: int = 1024
	h: int = 1024
	tile_w_m: float = 1.0          # real-world width of one repeat (metres)
	seed: int = 0
	rng: np.random.Generator = field(init=False)

	def __post_init__(self) -> None:
		self.rng = np.random.default_rng(self.seed or seed_of(self.name))

	@property
	def texel_m(self) -> float:
		return self.tile_w_m / self.w

	@property
	def tile_h_m(self) -> float:
		return self.texel_m * self.h

	@property
	def shape(self) -> tuple[int, int]:
		return (self.h, self.w)

	def px(self, metres: float) -> float:
		return metres / self.texel_m

	def sub(self, salt: int) -> np.random.Generator:
		return np.random.default_rng(seed_of(self.name, salt))

	def grid(self) -> tuple[np.ndarray, np.ndarray]:
		"""(y, x) pixel-centre coordinates in [0,1) tile units."""
		y = (np.arange(self.h, dtype=np.float64) + 0.5) / self.h
		x = (np.arange(self.w, dtype=np.float64) + 0.5) / self.w
		return np.meshgrid(y, x, indexing="ij")


# ---------------------------------------------------------------------------------------------
# colour
# ---------------------------------------------------------------------------------------------
def srgb_to_lin(c):
	c = np.asarray(c, dtype=np.float64)
	return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
	c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
	return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def rgb(r: float, g: float, b: float) -> np.ndarray:
	"""sRGB 0..255 -> linear float3."""
	return srgb_to_lin(np.array([r, g, b], dtype=np.float64) / 255.0)


def lerp(a, b, t):
	return a + (b - a) * t


def mix3(base: np.ndarray, col, t: np.ndarray) -> np.ndarray:
	"""Blend HxWx3 `base` toward colour/array `col` by HxW weight t."""
	col = np.asarray(col, dtype=np.float64)
	t = np.asarray(t, dtype=np.float64)[..., None]
	return base + (col - base) * t


def smoothstep(e0, e1, x):
	t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


def remap(x, a0, a1, b0=0.0, b1=1.0, clip=True):
	t = (np.asarray(x, dtype=np.float64) - a0) / (a1 - a0)
	if clip:
		t = np.clip(t, 0.0, 1.0)
	return b0 + (b1 - b0) * t


def norm01(x: np.ndarray) -> np.ndarray:
	lo, hi = float(x.min()), float(x.max())
	return (x - lo) / max(hi - lo, 1e-12)


def fill(shape, col) -> np.ndarray:
	out = np.empty(shape + (3,), dtype=np.float64)
	out[:] = np.asarray(col, dtype=np.float64)
	return out


def hue_jitter(col: np.ndarray, amount: np.ndarray) -> np.ndarray:
	"""Multiply a colour field by per-pixel tint noise (amount: HxWx3 in ~[-1,1] scaled)."""
	return col * np.exp(amount)


# ---------------------------------------------------------------------------------------------
# spectral (FFT) noise — periodic by construction
# ---------------------------------------------------------------------------------------------
_KCACHE: dict = {}


def _kgrid(h: int, w: int):
	key = (h, w)
	if key not in _KCACHE:
		ky = fftfreq(h) * h
		kx = rfftfreq(w) * w
		KY, KX = np.meshgrid(ky, kx, indexing="ij")
		_KCACHE[key] = (KY, KX)
	return _KCACHE[key]


def spectral(shape, rng: np.random.Generator, k0: float = 1.0, k1: float | None = None,
             slope: float = 1.0, stretch: float = 1.0, angle: float = 0.0,
             aspect: float = 1.0) -> np.ndarray:
	"""Zero-mean, unit-std periodic noise.

	k0..k1   frequency band in cycles per tile (soft edges);
	slope    amplitude ∝ k^-slope (0 = white-ish band, 1 = pink, 2 = brown/very smooth);
	stretch  >1 elongates features along `angle` (radians, 0 = along +x/columns);
	aspect   tile height/width in metres (for non-square tiles) so frequencies are isotropic in metres.
	"""
	h, w = shape
	if k1 is None:
		k1 = max(h, w) / 2
	white = rng.standard_normal(shape)
	F = rfft2(white)
	KY, KX = _kgrid(h, w)
	# convert to cycles per (tile width) so metres are isotropic for non-square tiles
	ky = KY / aspect if aspect != 1.0 else KY
	kx = KX
	if stretch != 1.0 or angle != 0.0:
		c, s = math.cos(angle), math.sin(angle)
		kpar = kx * c + ky * s
		kperp = -kx * s + ky * c
		k = np.sqrt((kpar * stretch) ** 2 + kperp ** 2)
	else:
		k = np.sqrt(kx * kx + ky * ky)
	k = np.maximum(k, 1e-6)
	lo = smoothstep(k0 * 0.6, k0, k) if k0 > 0 else 1.0
	hi = 1.0 - smoothstep(k1, k1 * 1.6, k)
	wgt = lo * hi * k ** (-slope)
	wgt[0, 0] = 0.0
	out = irfft2(F * wgt, s=shape)
	sd = out.std()
	return out / (sd if sd > 0 else 1.0)


def fbm(shape, rng, k0=2.0, k1=None, slope=1.2, **kw) -> np.ndarray:
	return spectral(shape, rng, k0, k1, slope, **kw)


def ridged(x: np.ndarray, sharp: float = 1.0) -> np.ndarray:
	"""Ridge transform of zero-mean noise → 0..1 with sharp crests."""
	r = 1.0 - np.abs(x) / (np.abs(x).max() + 1e-9)
	return r ** (1.0 + sharp)


def gauss(x: np.ndarray, sigma: float) -> np.ndarray:
	if sigma <= 0:
		return x
	if x.ndim == 3:
		return np.stack([ndimage.gaussian_filter(x[..., i], sigma, mode="wrap") for i in range(x.shape[2])], -1)
	return ndimage.gaussian_filter(x, sigma, mode="wrap")


def gauss_aniso(x: np.ndarray, sy: float, sx: float) -> np.ndarray:
	return ndimage.gaussian_filter(x, (sy, sx), mode="wrap")


def blur_dir(x: np.ndarray, length_px: float, angle: float = math.pi / 2, taps: int = 16,
             decay: float = 0.0) -> np.ndarray:
	"""Directional (motion) blur along angle, one-sided (streaks run from source toward +dir)."""
	acc = np.zeros_like(x, dtype=np.float64)
	wsum = 0.0
	c, s = math.cos(angle), math.sin(angle)
	for i in range(taps):
		t = length_px * i / max(taps - 1, 1)
		wgt = math.exp(-decay * i / taps)
		acc += np.roll(np.roll(x, int(round(t * s)), 0), int(round(t * c)), 1) * wgt
		wsum += wgt
	return acc / wsum


# ---------------------------------------------------------------------------------------------
# warping / sampling
# ---------------------------------------------------------------------------------------------
def warp(field_: np.ndarray, dx: np.ndarray, dy: np.ndarray, order: int = 1) -> np.ndarray:
	"""Sample field at (y+dy, x+dx) pixels with wrap-around."""
	h, w = field_.shape[:2]
	yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
	coords = [yy + dy, xx + dx]
	if field_.ndim == 3:
		return np.stack([ndimage.map_coordinates(field_[..., i], coords, order=order, mode="grid-wrap")
		                 for i in range(field_.shape[2])], -1)
	return ndimage.map_coordinates(field_, coords, order=order, mode="grid-wrap")


def resample(field_: np.ndarray, shape, order: int = 1) -> np.ndarray:
	"""Periodic resize (e.g. a 256² noise to 1024²)."""
	h, w = field_.shape[:2]
	H, W = shape
	yy = (np.arange(H) + 0.5) * h / H - 0.5
	xx = (np.arange(W) + 0.5) * w / W - 0.5
	Y, X = np.meshgrid(yy, xx, indexing="ij")
	if field_.ndim == 3:
		return np.stack([ndimage.map_coordinates(field_[..., i], [Y, X], order=order, mode="grid-wrap")
		                 for i in range(field_.shape[2])], -1)
	return ndimage.map_coordinates(field_, [Y, X], order=order, mode="grid-wrap")


def downsample(x: np.ndarray, f: int) -> np.ndarray:
	"""Box-filter downsample by integer factor (supersampling resolve)."""
	h, w = x.shape[:2]
	if x.ndim == 3:
		return x.reshape(h // f, f, w // f, f, x.shape[2]).mean(axis=(1, 3))
	return x.reshape(h // f, f, w // f, f).mean(axis=(1, 3))


# ---------------------------------------------------------------------------------------------
# Worley / Voronoi (periodic)
# ---------------------------------------------------------------------------------------------
@dataclass
class Voronoi:
	d: np.ndarray          # (H, W, k) distances in tile-width units (stretched metric)
	idx: np.ndarray        # (H, W, k) seed indices
	seeds: np.ndarray      # (N, 2) seeds (y, x) in [0,1)
	count: int

	@property
	def f1(self):
		return self.d[..., 0]

	@property
	def f2(self):
		return self.d[..., 1]

	@property
	def edge(self):
		"""F2-F1: 0 on cell borders."""
		return self.d[..., 1] - self.d[..., 0]

	@property
	def cell(self):
		return self.idx[..., 0]


def worley(shape, rng, count: int, k: int = 2, sy: float = 1.0, sx: float = 1.0,
           dy: np.ndarray | None = None, dx: np.ndarray | None = None, seeds: np.ndarray | None = None,
           aspect: float = 1.0) -> Voronoi:
	"""Periodic Voronoi. sy/sx >1 squash the metric in that axis (cells elongate along the other).
	dy/dx: optional domain warp in *pixels*. aspect = tile_h/tile_w in metres for non-square tiles."""
	h, w = shape
	if seeds is None:
		seeds = rng.random((count, 2))
	box = np.array([sy * aspect, sx], dtype=np.float64)
	tree = cKDTree(seeds * box, boxsize=box)
	y = (np.arange(h, dtype=np.float64) + 0.5)
	x = (np.arange(w, dtype=np.float64) + 0.5)
	Y, X = np.meshgrid(y, x, indexing="ij")
	if dy is not None:
		Y = Y + dy
	if dx is not None:
		X = X + dx
	pts = np.stack([(Y / h) % 1.0 * box[0], (X / w) % 1.0 * box[1]], -1).reshape(-1, 2)
	pts = np.minimum(pts, box - 1e-9)
	d, idx = tree.query(pts, k=k, workers=-1)
	if k == 1:
		d = d[:, None]
		idx = idx[:, None]
	return Voronoi(d.reshape(h, w, k), idx.reshape(h, w, k), seeds, len(seeds))


def poisson_disc(rng, count: int, min_dist: float, tries: int = 30) -> np.ndarray:
	"""Periodic dart-throwing in [0,1)^2 — returns up to `count` points (y, x)."""
	pts = []
	cand = rng.random((count * tries, 2))
	tree_pts = np.empty((0, 2))
	accepted = []
	# simple grid acceleration
	cell = min_dist / math.sqrt(2)
	g = int(math.ceil(1.0 / cell))
	grid: dict = {}
	for p in cand:
		gy, gx = int(p[0] * g) % g, int(p[1] * g) % g
		ok = True
		for oy in (-2, -1, 0, 1, 2):
			for ox in (-2, -1, 0, 1, 2):
				q = grid.get(((gy + oy) % g, (gx + ox) % g))
				if q is None:
					continue
				d = np.abs(p - q)
				d = np.minimum(d, 1 - d)
				if d[0] * d[0] + d[1] * d[1] < min_dist * min_dist:
					ok = False
					break
			if not ok:
				break
		if ok:
			grid[(gy, gx)] = p
			accepted.append(p)
			if len(accepted) >= count:
				break
	return np.array(accepted)


# ---------------------------------------------------------------------------------------------
# wrap-around rasterisers
# ---------------------------------------------------------------------------------------------
class HeightCanvas:
	"""Z-buffer style compositing of object height stamps with wrap-around, tracking object ids."""

	def __init__(self, shape, base: np.ndarray | float = 0.0):
		self.h, self.w = shape
		if np.isscalar(base):
			self.z = np.full(shape, float(base), dtype=np.float64)
		else:
			self.z = np.array(base, dtype=np.float64)
		self.id = np.full(shape, -1, dtype=np.int32)
		self.local = {}  # optional extra channels: name -> array

	def channel(self, name: str, init: float = 0.0) -> np.ndarray:
		if name not in self.local:
			self.local[name] = np.full((self.h, self.w), init, dtype=np.float64)
		return self.local[name]

	def region(self, cy: float, cx: float, ry: int, rx: int):
		"""Index arrays (wrapped) for a box centred at pixel (cy, cx) with half-size (ry, rx), plus local
		coordinates (py, px) of each pixel relative to the centre (float pixels)."""
		y0 = int(math.floor(cy)) - ry
		x0 = int(math.floor(cx)) - rx
		ys = np.arange(y0, y0 + 2 * ry + 2)
		xs = np.arange(x0, x0 + 2 * rx + 2)
		py = (ys + 0.5 - cy)[:, None]
		px = (xs + 0.5 - cx)[None, :]
		return np.ix_(ys % self.h, xs % self.w), py, px

	def stamp(self, ix, surf: np.ndarray, oid: int, extra: dict | None = None, mode: str = "max") -> np.ndarray:
		"""Write surf (NaN = not covered) where it is above current z. Returns the written mask."""
		cur = self.z[ix]
		valid = ~np.isnan(surf)
		if mode == "max":
			m = valid & (surf > cur)
		else:  # "over" painter's
			m = valid
		if not m.any():
			return m
		cur = np.where(m, surf, cur)
		self.z[ix] = cur
		ids = self.id[ix]
		ids[m] = oid
		self.id[ix] = ids
		if extra:
			for k, v in extra.items():
				ch = self.channel(k)
				c = ch[ix]
				if np.isscalar(v):
					c[m] = v
				else:
					c[m] = v[m]
				ch[ix] = c
		return m


class IdCanvas:
	"""Painter's-algorithm ID buffer drawn with PIL (int32), with wrap-around for primitives crossing edges.
	Use for thin things (needles, grass blades, fibres) where drawing thousands of lines must be fast."""

	def __init__(self, shape):
		self.h, self.w = shape
		self.img = Image.new("I", (self.w, self.h), -1)
		self.draw = ImageDraw.Draw(self.img)

	def _offsets(self, xs, ys, pad):
		x0, x1 = min(xs) - pad, max(xs) + pad
		y0, y1 = min(ys) - pad, max(ys) + pad
		oxs = [0]
		oys = [0]
		if x0 < 0:
			oxs.append(self.w)
		if x1 >= self.w:
			oxs.append(-self.w)
		if y0 < 0:
			oys.append(self.h)
		if y1 >= self.h:
			oys.append(-self.h)
		return [(ox, oy) for ox in oxs for oy in oys]

	def line(self, pts, oid: int, width: int = 1):
		xs = [p[0] for p in pts]
		ys = [p[1] for p in pts]
		for ox, oy in self._offsets(xs, ys, width + 1):
			self.draw.line([(x + ox, y + oy) for x, y in pts], fill=int(oid), width=int(width), joint="curve")

	def polygon(self, pts, oid: int):
		xs = [p[0] for p in pts]
		ys = [p[1] for p in pts]
		for ox, oy in self._offsets(xs, ys, 1):
			self.draw.polygon([(x + ox, y + oy) for x, y in pts], fill=int(oid))

	def ellipse(self, cx, cy, rx, ry, oid: int):
		for ox, oy in self._offsets([cx - rx, cx + rx], [cy - ry, cy + ry], 1):
			self.draw.ellipse([cx - rx + ox, cy - ry + oy, cx + rx + ox, cy + ry + oy], fill=int(oid))

	def array(self) -> np.ndarray:
		return np.array(self.img, dtype=np.int32)


def seg_param(ids: np.ndarray, ax: np.ndarray, ay: np.ndarray, bx: np.ndarray, by: np.ndarray, w: int, h: int):
	"""For each pixel covered by segment id (>=0), return (t along segment 0..1, signed perpendicular distance
	in pixels) — with wrap-aware deltas. ax..by are per-segment endpoint arrays (pixels)."""
	H, W = ids.shape
	yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
	yy += 0.5
	xx += 0.5
	valid = ids >= 0
	sid = np.where(valid, ids, 0)
	Ax, Ay, Bx, By = ax[sid], ay[sid], bx[sid], by[sid]
	dx = xx - Ax
	dy = yy - Ay
	dx -= np.round(dx / w) * w
	dy -= np.round(dy / h) * h
	ex, ey = Bx - Ax, By - Ay
	L2 = np.maximum(ex * ex + ey * ey, 1e-9)
	t = np.clip((dx * ex + dy * ey) / L2, 0.0, 1.0)
	L = np.sqrt(L2)
	perp = (dx * ey - dy * ex) / L
	return t, perp, valid


# ---------------------------------------------------------------------------------------------
# PBR derivation
# ---------------------------------------------------------------------------------------------
def grad(h_m: np.ndarray, texel_m: float, texel_y_m: float | None = None):
	"""Sobel gradient (d/dx columns, d/drow) in metres/metre, periodic."""
	ty = texel_y_m or texel_m
	gx = ndimage.sobel(h_m, axis=1, mode="wrap") / (8.0 * texel_m)
	gy = ndimage.sobel(h_m, axis=0, mode="wrap") / (8.0 * ty)
	return gx, gy


def normal_from_height(h_m: np.ndarray, texel_m: float, strength: float = 1.0,
                       texel_y_m: float | None = None) -> np.ndarray:
	"""OpenGL-convention (Y+ = towards the top of the image) tangent-space normal, float HxWx3 unit vectors."""
	gx, gr = grad(h_m, texel_m, texel_y_m)
	nx = -gx * strength
	ny = gr * strength          # rows grow downward: +Y (up the image) is -row
	nz = np.ones_like(nx)
	n = np.stack([nx, ny, nz], -1)
	return n / np.linalg.norm(n, axis=-1, keepdims=True)


def blend_normals(base: np.ndarray, detail: np.ndarray) -> np.ndarray:
	"""Reoriented normal mapping (RNM) blend of two unit tangent-space normal fields."""
	t = base + np.array([0.0, 0.0, 1.0])
	u = detail * np.array([-1.0, -1.0, 1.0])
	r = t * np.sum(t * u, -1, keepdims=True) / t[..., 2:3] - u
	return r / np.linalg.norm(r, axis=-1, keepdims=True)


def tilt_normals(n: np.ndarray, tx: np.ndarray, ty: np.ndarray) -> np.ndarray:
	out = n.copy()
	out[..., 0] += tx
	out[..., 1] += ty
	return out / np.linalg.norm(out, axis=-1, keepdims=True)


def horizon_ao(h_m: np.ndarray, texel_m: float, radius_m: float, dirs: int = 12, steps: int = 10,
               strength: float = 1.0) -> np.ndarray:
	"""Horizon-based AO (cosine weighted per slice, flat-normal approximation). 1 = unoccluded."""
	h = h_m.astype(np.float64)
	rpx = max(radius_m / texel_m, 1.5)
	dists = np.unique(np.round(np.geomspace(1.0, rpx, steps)).astype(int))
	acc = np.zeros_like(h)
	for a in range(dirs):
		ang = 2 * math.pi * (a + 0.5) / dirs
		c, s = math.cos(ang), math.sin(ang)
		mt = np.zeros_like(h)
		for d in dists:
			oy, ox = int(round(d * s)), int(round(d * c))
			if oy == 0 and ox == 0:
				continue
			sh = np.roll(np.roll(h, -oy, 0), -ox, 1)
			dist_m = math.hypot(oy, ox) * texel_m
			# fall off contribution with distance so far geometry occludes less (finite radius)
			fall = 1.0 - (math.hypot(oy, ox) / (rpx + 1.0)) ** 2
			np.maximum(mt, (sh - h) / dist_m * fall, out=mt)
		sin_h = mt / np.sqrt(1.0 + mt * mt)
		acc += 1.0 - sin_h
	ao = acc / dirs
	return np.clip(1.0 - (1.0 - ao) * strength, 0.0, 1.0)


def cavity(h_m: np.ndarray, sigma_px: float) -> np.ndarray:
	"""Positive in pits/cracks, negative on convex bumps (metres)."""
	return gauss(h_m, sigma_px) - h_m


def curvature(h_m: np.ndarray, texel_m: float) -> np.ndarray:
	return ndimage.laplace(h_m, mode="wrap") / (texel_m * texel_m)


# ---------------------------------------------------------------------------------------------
# IO
# ---------------------------------------------------------------------------------------------
def _dither(shape, rng, amp=0.5 / 255.0):
	return (rng.random(shape) - rng.random(shape)) * amp


def to_u8(x: np.ndarray, rng: np.random.Generator | None = None) -> np.ndarray:
	x = np.asarray(x, dtype=np.float64)
	if rng is not None:
		x = x + _dither(x.shape, rng)
	return np.clip(np.round(x * 255.0), 0, 255).astype(np.uint8)


def save_png(path: str, arr_u8: np.ndarray) -> None:
	os.makedirs(os.path.dirname(path), exist_ok=True)
	mode = {2: "L", 3: "RGB", 4: "RGBA"}[arr_u8.ndim if arr_u8.ndim == 2 else arr_u8.shape[2] + 0]
	if arr_u8.ndim == 3:
		mode = "RGB" if arr_u8.shape[2] == 3 else "RGBA"
	Image.fromarray(arr_u8, mode).save(path, optimize=True, compress_level=9)


def albedo_u8(lin: np.ndarray, rng) -> np.ndarray:
	return to_u8(lin_to_srgb(np.clip(lin, 0.0, 1.0)), rng)


def normal_u8(n: np.ndarray) -> np.ndarray:
	return to_u8(n * 0.5 + 0.5)


def gray_u8(v: np.ndarray, rng=None) -> np.ndarray:
	return to_u8(np.clip(v, 0.0, 1.0), rng)


def load_png(path: str) -> np.ndarray:
	return np.array(Image.open(path))


def write_json(path: str, data) -> None:
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, "w") as f:
		json.dump(data, f, indent=1)
		f.write("\n")


# ---------------------------------------------------------------------------------------------
# quick CPU preview (lit tile, 2x2 to expose seams) — for fast iteration without Godot
# ---------------------------------------------------------------------------------------------
def aces(x):
	x = np.maximum(x, 0.0)
	return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)


def preview(albedo_lin: np.ndarray, n: np.ndarray, rough: np.ndarray, ao: np.ndarray | None = None,
            metal: np.ndarray | None = None, sun=(-0.55, 0.45, 0.70), reps: int = 2, size: int = 1024,
            exposure: float = 0.9) -> np.ndarray:
	"""Returns an sRGB uint8 image: the material lit by a low sun + sky (ACES), tiled reps x reps."""
	L = np.array(sun, dtype=np.float64)
	L /= np.linalg.norm(L)
	V = np.array([0.0, 0.0, 1.0])
	H = (L + V) / np.linalg.norm(L + V)
	nd = np.clip(np.sum(n * L, -1), 0, 1)
	nh = np.clip(np.sum(n * H, -1), 0, 1)
	a = np.clip(rough, 0.03, 1.0) ** 2
	a2 = a * a
	D = a2 / (math.pi * (nh * nh * (a2 - 1) + 1) ** 2)
	metal = np.zeros_like(rough) if metal is None else metal
	f0 = lerp(np.full(albedo_lin.shape, 0.04), albedo_lin, metal[..., None])
	spec = D[..., None] * f0 * 0.25 * nd[..., None]
	diff = albedo_lin * (1 - metal[..., None])
	ao_ = np.ones_like(rough) if ao is None else ao
	sky = np.array([0.36, 0.42, 0.52]) * (0.6 + 0.4 * n[..., 2:3]) * ao_[..., None]
	sunc = np.array([2.3, 2.15, 1.95])
	col = diff * (sunc * nd[..., None] + sky) + spec * sunc + 0.25 * f0 * ao_[..., None]
	col = aces(col * exposure)
	col = np.tile(col, (reps, reps, 1))
	img = Image.fromarray(to_u8(lin_to_srgb(col)))
	if img.size[0] != size:
		img = img.resize((size, int(size * img.size[1] / img.size[0])), Image.LANCZOS)
	return np.array(img)


# ---------------------------------------------------------------------------------------------
# periodic line families (joints, fractures, boards) and helpers
# ---------------------------------------------------------------------------------------------
def line_family(shape, p: int, q: int, offsets, warp_: np.ndarray | None = None, aspect: float = 1.0):
	"""Parallel lines p*x + q*y ≡ c (mod 1) on the torus (x, y in tile units).
	Returns (dist_tile, nearest_index, slab_ramp 0..1 between consecutive lines, slab_index)."""
	h, w = shape
	y = (np.arange(h) + 0.5) / h
	x = (np.arange(w) + 0.5) / w
	Y, X = np.meshgrid(y, x, indexing="ij")
	phi = p * X + q * Y
	if warp_ is not None:
		phi = phi + warp_
	phi = phi % 1.0
	c = np.sort(np.asarray(offsets, dtype=np.float64) % 1.0)
	norm = math.hypot(p, q / aspect) if (p or q) else 1.0
	i = np.searchsorted(c, phi, side="right") - 1
	i_lo = i % len(c)
	lo = c[i_lo]
	hi = c[(i_lo + 1) % len(c)]
	span = (hi - lo) % 1.0
	span = np.where(span == 0, 1.0, span)
	ramp = ((phi - lo) % 1.0) / span
	d_lo = (phi - lo) % 1.0
	d_hi = (hi - phi) % 1.0
	dist = np.minimum(d_lo, d_hi) / norm
	nearest = np.where(d_lo <= d_hi, i_lo, (i_lo + 1) % len(c))
	return dist, nearest, ramp, i_lo


def wrap_delta(a: np.ndarray, b) -> np.ndarray:
	"""Shortest periodic difference a-b in tile units."""
	d = a - b
	return d - np.round(d)


def asym_dilate(h_m: np.ndarray, texel_m: float, slope: float, dist_m: float, axis: int = 1,
                steps: int = 24) -> np.ndarray:
	"""Max-plus dilation downwind: h'(x) = max_d h(x - d) - slope*d. Creates dune-like slip faces
	downwind (+axis) of crests. Periodic."""
	out = h_m.copy()
	for i in range(1, steps + 1):
		d = dist_m * i / steps
		px_ = int(round(d / texel_m))
		if px_ == 0:
			continue
		np.maximum(out, np.roll(h_m, px_, axis) - slope * d, out=out)
	return out


def patches(shape, rng, k0: float, k1: float, coverage: float, soft: float = 0.25, detail: float = 0.6,
            aspect: float = 1.0, stretch: float = 1.0, angle: float = 0.0) -> np.ndarray:
	"""Natural-looking patch mask (0..1) covering roughly `coverage` of the tile: multi-scale noise with
	fractal detail on the edges and soft transitions (avoids the 'camouflage blob' look of a single band)."""
	base = spectral(shape, rng, k0, k1, 1.3, stretch=stretch, angle=angle, aspect=aspect)
	det = spectral(shape, rng, k1, min(k1 * 10, max(shape) / 2), 0.7, aspect=aspect)
	f = base + detail * det
	f = (f - f.mean()) / (f.std() + 1e-9)
	thr = float(np.quantile(f, 1.0 - coverage))
	return smoothstep(thr - soft, thr + soft, f)


def facet_envelope(shape, rng, count: int, slope_sd: float, cone: float, tile_w_m: float, k: int = 6,
                   sy: float = 1.0, dx=None, dy=None, mode: str = "max") -> np.ndarray:
	"""Continuous faceted surface (metres): upper (or lower) envelope of randomly tilted cones
	h_i(p) = g_i·(p - s_i) - cone*|p - s_i| over the k nearest seeds. Unlike piecewise planes there are no
	height steps at cell borders — only creases (ridges for 'max', valleys for 'min'), like fractured rock."""
	v = worley(shape, rng, count, k=k, sy=sy, dx=dx, dy=dy)
	h, w = shape
	Y, X = np.meshgrid((np.arange(h) + 0.5) / h, (np.arange(w) + 0.5) / w, indexing="ij")
	if dy is not None:
		Y = Y + dy / h
	if dx is not None:
		X = X + dx / w
	gx = rng.normal(0, slope_sd, v.count)
	gy = rng.normal(0, slope_sd, v.count)
	best = np.full(shape, -np.inf if mode == "max" else np.inf)
	for j in range(k):
		ids = v.idx[..., j]
		ddx = wrap_delta(X, v.seeds[ids, 1]) * tile_w_m
		ddy = wrap_delta(Y, v.seeds[ids, 0]) * tile_w_m
		dist = np.sqrt(ddx * ddx + (ddy * sy) ** 2)
		val = gx[ids] * ddx + gy[ids] * ddy - cone * dist
		if mode == "max":
			np.maximum(best, val, out=best)
		else:
			val = -val
			np.minimum(best, val, out=best)
	return best


def edge_pair_rand(v: "Voronoi", salt: int = 0) -> np.ndarray:
	"""Per-pixel random value identifying the Voronoi edge (pair of nearest cells) — for masking a subset
	of cell borders (open fractures, board joints)."""
	a = np.minimum(v.idx[..., 0], v.idx[..., 1]).astype(np.uint64)
	b = np.maximum(v.idx[..., 0], v.idx[..., 1]).astype(np.uint64)
	key = a * np.uint64(1000003) + b * np.uint64(7919) + np.uint64(salt * 104729 + 17)
	key = (key * np.uint64(2654435761)) % np.uint64(4294967296)
	key ^= key >> np.uint64(13)
	key = (key * np.uint64(2246822519)) % np.uint64(4294967296)
	return key.astype(np.float64) / 4294967296.0


def planar_cells(shape, rng, count: int, slope_sd: float, offset_sd: float, tile_w_m: float,
                 sy: float = 1.0, sx: float = 1.0, dx=None, dy=None, aspect: float = 1.0):
	"""Piecewise-planar height (metres): each Voronoi cell is a randomly tilted plane — fractured rock facets.
	Returns (height, voronoi)."""
	v = worley(shape, rng, count, k=2, sy=sy, sx=sx, dx=dx, dy=dy, aspect=aspect)
	h, w = shape
	Y, X = np.meshgrid((np.arange(h) + 0.5) / h, (np.arange(w) + 0.5) / w, indexing="ij")
	cid = v.cell
	sd = v.seeds
	gx = rng.normal(0, slope_sd, v.count)
	gy = rng.normal(0, slope_sd, v.count)
	off = rng.normal(0, offset_sd, v.count)
	ddx = wrap_delta(X, sd[cid, 1]) * tile_w_m
	ddy = wrap_delta(Y, sd[cid, 0]) * tile_w_m * aspect
	return off[cid] + gx[cid] * ddx + gy[cid] * ddy, v

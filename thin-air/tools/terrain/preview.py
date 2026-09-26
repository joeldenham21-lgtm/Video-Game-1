"""Quick CPU previews of heightfields: hillshade + hypsometric tint + snow/forest hints (for QA and docs)."""
from __future__ import annotations

import numpy as np
from PIL import Image


def hillshade(h, cell, az_deg=315.0, alt_deg=35.0, zf=1.0):
	gz, gx = np.gradient(h.astype(np.float64) * zf, cell)
	az = np.radians(az_deg)
	alt = np.radians(alt_deg)
	# light direction: azimuth measured clockwise from north (-z); x east, z south
	lx, lz, ly = np.sin(az) * np.cos(alt), -np.cos(az) * np.cos(alt), np.sin(alt)
	n = np.stack([-gx, np.ones_like(gx), -gz])
	n /= np.linalg.norm(n, axis=0)
	return np.clip(n[0] * lx + n[1] * ly + n[2] * lz, 0, 1)


def tint(h, slope, masks=None):
	"""Photo-ish colour: forest greens low, rock greys, snow above ~1800 m on gentle slopes."""
	c = np.zeros(h.shape + (3,))
	lo = np.array([0.30, 0.33, 0.22])
	fo = np.array([0.10, 0.16, 0.10])
	ro = np.array([0.42, 0.40, 0.37])
	sn = np.array([0.92, 0.94, 0.97])
	t = np.clip((h - 1300) / 1000, 0, 1)[..., None]
	c[:] = lo * (1 - t) + fo * t
	rock = np.clip((slope - 40) / 10, 0, 1)[..., None]
	alp = np.clip((h - 2150) / 150, 0, 1)[..., None]
	c = c * (1 - alp) + ro * alp * 0.8 + lo * alp * 0.2
	c = c * (1 - rock) + ro * rock
	snow = (np.clip((h - 1850) / 250, 0, 1) * np.clip((48 - slope) / 12, 0, 1))[..., None]
	if masks is not None:
		snow = masks[..., 0:1]
		forest = masks[..., 3:4]
		c = c * (1 - forest * 0.8) + fo * forest * 0.8
	c = c * (1 - snow) + sn * snow
	return c


def yaw_to(x0, z0, x1, z1):
	return float(np.degrees(np.arctan2(-(x1 - x0), -(z1 - z0))))


# Standard QA viewpoints: (name, x, z, height above ground, look-at (x, z, y) or (yaw, pitch))
VIEWS = [
	("crash_n", -520, 820, 1.7, (120, -1260, 2800)),
	("lake_n", 300, 780, 1.7, (-60, -760, 2300)),
	("aerial_s", 0, 2600, 900, (0, -600, 1500)),
	("summit_s", 120, -1245, 1.7, (0, 600, 1700)),
	("col_e", -360, -960, 1.7, (400, -700, 2600)),
	("mine_w", 840, -60, 1.7, (-300, 200, 1900)),
]


def views(h, x0, dx, prefix, W=480, H=270, masks=None, sun=(0.45, 0.55, 0.35), fog=0.00011, which=None):
	import tlib
	from fields import bilinear
	from PIL import Image
	tiles = []
	for name, x, z, up, tgt in VIEWS:
		if which and name not in which:
			continue
		gy = float(bilinear(h, x0, dx, x, z))
		y = gy + up
		yaw = yaw_to(x, z, tgt[0], tgt[1])
		dist = np.hypot(tgt[0] - x, tgt[1] - z)
		pitch = float(np.degrees(np.arctan2(tgt[2] - y, dist)))
		img = tlib.render_persp(h, x0, dx, (x, y, z, yaw, pitch), 62.0, sun, W, H, fog, masks)
		tm = img * 1.25
		tm = (tm * (2.51 * tm + 0.03)) / (tm * (2.43 * tm + 0.59) + 0.14)
		tiles.append(Image.fromarray((np.clip(tm, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)))
	cols = 2
	rows = (len(tiles) + 1) // 2
	sheet = Image.new("RGB", (W * cols, H * rows))
	for k, t in enumerate(tiles):
		sheet.paste(t, ((k % cols) * W, (k // cols) * H))
	sheet.save(prefix + "_views.png")
	return prefix + "_views.png"


def render(h, cell, path, size=1024, water=None, masks=None, az=300.0, alt=32.0):
	from fields import slope_deg
	s = slope_deg(h, cell)
	hs = hillshade(h, cell, az, alt)
	amb = 0.35
	col = tint(h, s, masks) * (amb + (1 - amb) * hs[..., None])
	if water is not None:
		wm = water[..., None]
		col = col * (1 - wm) + np.array([0.12, 0.28, 0.33]) * wm * (0.6 + 0.4 * hs[..., None])
	img = Image.fromarray((np.clip(col, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))
	if img.width != size:
		img = img.resize((size, size), Image.LANCZOS)
	img.save(path)
	return path

#!/usr/bin/env python3
"""Seam QA: for every tileable map, compare the wrap-around neighbour difference (last→first column/row)
with the mean interior neighbour difference. Same statistic as tests/test_textures.gd. Also reports a
per-pixel 'phase-matched' variant (seam vs. the columns one tile-period of any regular pattern away) so
regular patterns (weaves, boards) are not flagged falsely.
Usage: python3 check_seams.py [set ...]"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

import common as cm


def ratios(a: np.ndarray):
	"""Two seam statistics per axis (both ~1 for a seamless map, >> 1 for a real discontinuity):
	  local  = |x[-1]-x[0]| / mean(|x[-2]-x[-1]|, |x[0]-x[1]|)      (robust for smooth, non-periodic content)
	  phase  = |x[-1]-x[0]| / mean over k=1..7 of |x[kw/8-1]-x[kw/8]|  (robust for regular patterns: same phase)
	A seam is only suspicious when BOTH exceed the threshold. Returns (min_x, min_y)."""
	a = a.astype(np.float64)
	if a.ndim == 2:
		a = a[..., None]
	a = a[..., :3]
	h, w = a.shape[:2]
	d = lambda p, q: np.abs(p - q).sum(-1).mean()  # noqa: E731
	sx = d(a[:, -1], a[:, 0])
	lx = sx / max(0.5 * (d(a[:, -2], a[:, -1]) + d(a[:, 0], a[:, 1])), 1e-9)
	px_ = sx / max(np.mean([d(a[:, w * k // 8 - 1], a[:, w * k // 8]) for k in range(1, 8)]), 1e-9)
	sy = d(a[-1], a[0])
	ly = sy / max(0.5 * (d(a[-2], a[-1]) + d(a[0], a[1])), 1e-9)
	py_ = sy / max(np.mean([d(a[h * k // 8 - 1], a[h * k // 8]) for k in range(1, 8)]), 1e-9)
	return min(lx, px_), min(ly, py_)


def main():
	sets = sys.argv[1:]
	files = []
	cat = json.load(open(os.path.join(cm.MAT_DIR, "materials.json")))
	for n, info in cat.items():
		if sets and n not in sets:
			continue
		if not info.get("tiling", True):
			continue
		files += [os.path.join(cm.TEX_DIR, n, f"{n}_{m}.png") for m in ("albedo", "normal", "orm")]
	if not sets or "terrain" in sets:
		files += sorted(glob.glob(os.path.join(cm.TEX_DIR, "terrain", "*_*.png")))
	for f in files:
		if "terrain_" in os.path.basename(f):
			continue
		rx, ry = ratios(np.array(Image.open(f)))
		flag = "  <-- CHECK" if max(rx, ry) > 1.8 else ""
		print(f"{os.path.relpath(f, cm.TEX_DIR):45s} seam continuity x={rx:4.2f} y={ry:4.2f}{flag}")


if __name__ == "__main__":
	main()

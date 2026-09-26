"""Contact sheet of foliage card atlases: albedo over grey | simple lit preview | normal map.

python3 thin-air/tools/vegetation/card_preview.py spruce,fir out.jpg [--size=512]
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "textures", "foliage")


def main():
	names = sys.argv[1].split(",")
	out = sys.argv[2]
	size = 512
	for a in sys.argv[3:]:
		if a.startswith("--size="):
			size = int(a[7:])
	rows = []
	for n in names:
		a = Image.open(os.path.join(ROOT, n + "_albedo.png")).convert("RGBA").resize((size, size), Image.LANCZOS)
		nm = Image.open(os.path.join(ROOT, n + "_normal.png")).convert("RGB").resize((size, size), Image.LANCZOS)
		a = np.asarray(a).astype(np.float32) / 255
		nm = np.asarray(nm).astype(np.float32) / 255
		bg = np.ones_like(a[..., :3]) * np.array([0.78, 0.8, 0.82])
		al = a[..., 3:]
		comp = a[..., :3] * al + bg * (1 - al)
		N = nm * 2 - 1
		L = np.array([-0.4, 0.5, 0.75])
		L /= np.linalg.norm(L)
		lit = np.clip((N * L).sum(-1), 0, 1)[..., None] * 1.6 + 0.25
		lin = np.clip((a[..., :3] ** 2.2) * lit * 2.0, 0, 1) ** (1 / 2.2)
		comp2 = lin * al + bg * (1 - al)
		rows.append(np.concatenate([comp, comp2, nm], 1))
	img = np.concatenate(rows, 0)
	Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out, quality=88)


if __name__ == "__main__":
	main()

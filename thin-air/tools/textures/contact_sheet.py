#!/usr/bin/env python3
"""Dev helper: tile the CPU previews (from --preview runs) into one labelled contact sheet for quick review.
Usage: python3 contact_sheet.py out.jpg name1 name2 ... [--cell 384] [--cols 4]"""
import os
import sys

from PIL import Image, ImageDraw

import common as cm


def main() -> None:
	args = [a for a in sys.argv[1:] if not a.startswith("--")]
	cell = 384
	cols = 4
	for a in sys.argv[1:]:
		if a.startswith("--cell="):
			cell = int(a[7:])
		if a.startswith("--cols="):
			cols = int(a[7:])
	out, names = args[0], args[1:]
	rows = (len(names) + cols - 1) // cols
	sheet = Image.new("RGB", (cols * cell, rows * cell), (20, 20, 20))
	d = ImageDraw.Draw(sheet)
	for i, n in enumerate(names):
		p = os.path.join(cm.SCRATCH, n + ".jpg")
		if not os.path.exists(p):
			continue
		im = Image.open(p).convert("RGB")
		im = im.crop((0, 0, im.width // 2, im.height // 2)) if "--full" not in sys.argv else im
		im = im.resize((cell, cell), Image.LANCZOS)
		x, y = (i % cols) * cell, (i // cols) * cell
		sheet.paste(im, (x, y))
		d.rectangle([x, y, x + 8 * len(n) + 8, y + 16], fill=(0, 0, 0))
		d.text((x + 4, y + 2), n, fill=(255, 255, 255))
	sheet.save(out, quality=90)
	print(out)


if __name__ == "__main__":
	main()

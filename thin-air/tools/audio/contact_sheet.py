#!/usr/bin/env python3
"""Stack spectrogram PNGs (from build_sfx.py --preview) into one sheet per prefix for visual QA.

python3.12 thin-air/tools/audio/contact_sheet.py <preview_dir> <out.png> [prefix ...]
"""
import glob
import os
import sys

from PIL import Image


def main():
	src, out = sys.argv[1], sys.argv[2]
	prefixes = sys.argv[3:] or [""]
	files = []
	for p in prefixes:
		files += sorted(glob.glob(os.path.join(src, p + "*.png")))
	ims = [Image.open(f).convert("RGB") for f in files]
	if not ims:
		sys.exit("no images")
	cols = 2 if len(ims) > 4 else 1
	w = max(i.width for i in ims)
	h = max(i.height for i in ims)
	rows = (len(ims) + cols - 1) // cols
	sheet = Image.new("RGB", (w * cols, h * rows), (0, 0, 0))
	for k, im in enumerate(ims):
		sheet.paste(im, ((k % cols) * w, (k // cols) * h))
	scale = min(1.0, 1800 / sheet.width, 2400 / sheet.height)
	if scale < 1.0:
		sheet = sheet.resize((int(sheet.width * scale), int(sheet.height * scale)), Image.LANCZOS)
	sheet.save(out)
	print(out, sheet.size, len(ims))


if __name__ == "__main__":
	main()

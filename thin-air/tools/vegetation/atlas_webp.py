"""Re-encodes the impostor atlases written by tools/blender/vegetation/impostors.py as lossless WebP (the albedo
halves in size; pixels are bit-identical) and points the manifest at them. Run after impostors.py:

python3.12 thin-air/tools/vegetation/atlas_webp.py
"""
import json
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
FOL = os.path.join(ROOT, "assets", "textures", "foliage")
MANIFEST = os.path.join(ROOT, "assets", "models", "vegetation", "vegetation.json")


def convert(name: str) -> None:
	png = os.path.join(FOL, name + ".png")
	webp = os.path.join(FOL, name + ".webp")
	if not os.path.exists(png):
		return
	Image.open(png).save(webp, lossless=True, quality=100, method=4, exact=True)
	# keep the import settings (2D array slices, compression) and the uid
	imp_png = png + ".import"
	old_uid = None
	if os.path.exists(webp + ".import"):
		for ln in open(webp + ".import"):
			if ln.startswith("uid="):
				old_uid = ln.strip()
	if os.path.exists(imp_png):
		lines = [ln for ln in open(imp_png).read().splitlines()
			if not ln.startswith(("path", "source_file", "dest_files", "metadata", '"imported', '"vram', "}"))]
		if old_uid and not any(ln.startswith("uid=") for ln in lines):
			lines.insert(lines.index('type="CompressedTexture2DArray"') + 1, old_uid)
		txt = "\n".join(lines)
		while "\n\n\n" in txt:
			txt = txt.replace("\n\n\n", "\n\n")
		txt = txt.replace("[deps]\n\n", "")
		open(webp + ".import", "w").write(txt.rstrip("\n") + "\n")
		os.remove(imp_png)
	os.remove(png)
	print(f"{name}: {os.path.getsize(webp) / 1e6:.1f} MB webp")


def main() -> None:
	for n in ("impostor_albedo", "impostor_normal"):
		convert(n)
	data = json.load(open(MANIFEST))
	imp = data.get("impostors", {})
	for k in ("albedo", "normal"):
		if k in imp:
			imp[k] = imp[k].replace(".png", ".webp")
	json.dump(data, open(MANIFEST, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
	main()

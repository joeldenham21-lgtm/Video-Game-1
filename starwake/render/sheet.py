"""Contact sheet of stills: python render/sheet.py out.png a.png b.png ..."""
import sys
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
cols = 2
rows = (len(ims) + 1) // 2
sheet = Image.new("RGB", (w * cols, h * rows))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im.resize((w, h)), (x, y))
    d.text((x + 6, y + 4), f.split("/")[-1], fill=(255, 255, 0))
sheet.save(out)

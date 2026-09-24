#!/usr/bin/env python3
"""THIN AIR — finish raw icon renders into assets/icons/<id>.png (256x256 RGBA).

Crops each Cycles render (tools/icons/_cache/raw/<id>.png) to the object (ignoring the faint contact shadow),
centres it with a consistent margin, downsamples with Lanczos and applies a light unsharp mask. Also draws
assets/icons/_unknown.png (the fallback used by ItemDB.get_icon). Writes Godot .import files (lossless + mipmaps).

    python3.12 thin-air/tools/icons/finish_icons.py [ids...]
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(HERE, "_cache", "raw")
OUT = os.path.join(ROOT, "assets", "icons")
SIZE = 256
MARGIN = 0.07


def write_import(path):
    with open(path + ".import", "w") as f:
        f.write('[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\n\n[params]\n\n')
        f.write("compress/mode=0\nmipmaps/generate=true\nprocess/fix_alpha_border=true\ndetect_3d/compress_to=0\n")


def finish(src, dst):
    im = Image.open(src).convert("RGBA")
    a = np.asarray(im)[..., 3].astype(np.float32) / 255.0
    solid = a > 0.55                   # the object; the shadow catcher is mostly below this
    ys, xs = np.nonzero(solid)
    if len(xs) == 0:
        ys, xs = np.nonzero(a > 0.05)
    if len(xs) == 0:
        return False
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    # include a little of the shadow below the object
    y1 = min(im.height, y1 + int((y1 - y0) * 0.06) + 2)
    w, h = x1 - x0, y1 - y0
    side = int(max(w, h) / (1.0 - 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im.crop((x0, y0, x1, y1)), ((side - w) // 2, (side - h) // 2))
    # premultiply for clean resampling, then un-premultiply
    arr = np.asarray(canvas).astype(np.float32) / 255.0
    rgb = arr[..., :3] * arr[..., 3:4]
    pm = Image.fromarray((np.dstack([rgb, arr[..., 3]]) * 255 + 0.5).astype(np.uint8), "RGBA")
    small = pm.resize((SIZE, SIZE), Image.LANCZOS)
    s = np.asarray(small).astype(np.float32) / 255.0
    alpha = s[..., 3:4]
    col = np.where(alpha > 1e-4, s[..., :3] / np.maximum(alpha, 1e-4), 0.0)
    out = Image.fromarray((np.clip(np.dstack([col, alpha]), 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    rgbim = out.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    out = Image.merge("RGBA", (*rgbim.split(), out.split()[3]))
    out.save(dst, optimize=True)
    write_import(dst)
    return True


def unknown_icon(dst):
    """Fallback icon: a stencilled supply crate outline with a question mark, in the UI's muted tone."""
    s = SIZE * 2
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = (206, 212, 218, 230)
    d.rounded_rectangle([96, 150, s - 96, s - 110], radius=26, outline=c, width=14)
    d.line([(96, 230), (s - 96, 230)], fill=c, width=10)
    try:
        f = ImageFont.truetype(os.path.join(ROOT, "assets", "fonts", "IBMPlexSans-Bold.ttf"), 190)
        tw = d.textlength("?", font=f)
        d.text(((s - tw) / 2, 212), "?", font=f, fill=c)
    except Exception:
        pass
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im.save(dst, optimize=True)
    write_import(dst)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    ids = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(RAW) if f.endswith(".png"))
    n = 0
    for i in ids:
        if finish(os.path.join(RAW, i + ".png"), os.path.join(OUT, i + ".png")):
            n += 1
    unknown_icon(os.path.join(OUT, "_unknown.png"))
    print("finished", n, "icons")

"""Building-stream textures (deterministic).

    python3.12 thin-air/tools/blender/building/gen_textures.py

Writes assets/models/building/textures/:
  spruce_bough_albedo.png   RGBA, 512 px = 0.55 m: a flat spruce bough (stem, side twigs, needles), alpha coverage
  spruce_bough_normal.png   OpenGL tangent normal from a needle height map
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "assets", "models", "building", "textures")
SS = 4           # supersampling
N = 512


def bough():
    rng = random.Random(31)
    W = N * SS
    col = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    hgt = Image.new("L", (W, W), 0)
    dc = ImageDraw.Draw(col)
    dh = ImageDraw.Draw(hgt)

    def needle_colour(t, shade):
        g = rng.uniform(0.85, 1.15) * shade
        base = (0.085 + 0.045 * t, 0.15 + 0.05 * t, 0.10 + 0.03 * t)
        return tuple(int(max(0, min(255, 255 * c * g))) for c in base) + (255,)

    def draw_twig(x0, y0, ang, length, width, depth):
        steps = int(length / (3 * SS)) + 2
        pts = []
        for i in range(steps + 1):
            t = i / steps
            a = ang + 0.25 * math.sin(t * 2.5 + depth) * (1 - t)
            pts.append((x0 + math.cos(a) * length * t, y0 + math.sin(a) * length * t))
        # twig first: needles hide most of it, as on a real bough
        dc.line(pts, fill=(62, 44, 30, 255), width=int(width))
        dh.line(pts, fill=230, width=int(width))
        # needles along the twig: radiate forward on both sides, shorter toward the tip
        for i in range(1, steps + 1):
            t = i / steps
            px, py = pts[i]
            a = ang
            for side in (-1, 1):
                for k in range(2):
                    nl = (26 + rng.uniform(-6, 8)) * SS * (1.0 - 0.45 * t) * (0.8 if depth else 1.0)
                    na = a + side * rng.uniform(0.55, 1.05) - 0.25 * side * k
                    ex, ey = px + math.cos(na) * nl, py + math.sin(na) * nl
                    shade = 0.75 + 0.5 * rng.random()
                    dc.line([(px, py), (ex, ey)], fill=needle_colour(t, shade), width=int(2.2 * SS))
                    dh.line([(px, py), (ex, ey)], fill=int(150 + 80 * shade), width=int(2.2 * SS))
                    # a pale growth tip on some needles
                    if rng.random() < 0.25:
                        dc.line([(ex - (ex - px) * 0.25, ey - (ey - py) * 0.25), (ex, ey)],
                                fill=(int(0.2 * 255), int(0.27 * 255), int(0.14 * 255), 255), width=int(2 * SS))
        return pts

    # main stem bottom-centre to the top, side twigs alternating, sub-twigs on the longer ones
    stem = draw_twig(W * 0.5, W * 0.98, -math.pi / 2 + rng.uniform(-0.05, 0.05), W * 0.93, 3.2 * SS, 0)
    for i in range(3, len(stem) - 2, 2):
        t = i / len(stem)
        x, y = stem[i]
        for side in (-1, 1):
            if rng.random() < 0.15:
                continue
            ang = -math.pi / 2 + side * rng.uniform(0.75, 1.05)
            L = W * (0.42 - 0.3 * t) * rng.uniform(0.8, 1.1)
            tw = draw_twig(x, y, ang, L, 2.2 * SS, 1)
            for j in range(3, len(tw) - 1, 4):
                if rng.random() < 0.5:
                    sx, sy = tw[j]
                    draw_twig(sx, sy, ang - side * rng.uniform(0.6, 0.9), L * 0.35, 1.6 * SS, 2)
    col = col.resize((N, N), Image.LANCZOS)
    hgt = hgt.resize((N, N), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.8))
    a = np.asarray(col).astype(np.float32) / 255.0
    alpha = a[..., 3]
    # un-premultiply the downsampled colour and bleed it outward so mips don't fringe dark
    rgb = a[..., :3]
    mask = alpha > 0.02
    rgb[mask] = rgb[mask] / alpha[mask, None]
    fill = rgb.copy()
    for _ in range(12):
        blur = np.asarray(Image.fromarray((fill * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2))).astype(np.float32) / 255.0
        fill = np.where(mask[..., None], rgb, blur)
    out = np.concatenate([np.clip(fill, 0, 1), alpha[..., None]], axis=-1)
    Image.fromarray((out * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "spruce_bough_albedo.png"))
    h = np.asarray(hgt).astype(np.float32) / 255.0
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    s = 2.5
    nx, ny, nz = -gx * s, gy * s, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    Image.fromarray((nrm * 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "spruce_bough_normal.png"))


def main():
    os.makedirs(OUT, exist_ok=True)
    bough()
    print("textures ->", OUT)


main()

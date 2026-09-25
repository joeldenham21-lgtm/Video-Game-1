#!/usr/bin/env python3
"""THIN AIR — HUD screen-effect textures (assets/ui/fx/*.png), deterministic.

frost.png    512² tileable. R = low-frequency coverage field (where the frost front advances first),
             G = ice-crystal detail (dendritic feathers: stems with 60° side branches, like window frost),
             B = fine grain (sparkle/relief). Used by src/ui/hud/screen_fx.gdshader at the screen edges.
droplets.png 512² tileable. RG = droplet surface normal (0.5 = flat), B = coverage (soft-edged), A = per-drop
             random rank, so wetness 0..1 reveals drops progressively (a drop shows when A < wetness).

Usage: python3.12 thin-air/tools/ui/gen_fx_textures.py
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "ui", "fx")
N = 512
rng = np.random.default_rng(0x7A11A1)


def fbm(n: int, beta: float = 2.2, low_cut: float = 2.0) -> np.ndarray:
    """Tileable 1/f^beta noise (spectral synthesis), normalised to 0..1. low_cut = lowest frequency (cycles)."""
    white = rng.standard_normal((n, n))
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    fr = np.sqrt(fx * fx + fy * fy)
    amp = np.where(fr >= low_cut, 1.0 / np.maximum(fr, 1e-6) ** (beta * 0.5), 0.0)
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * amp))
    out -= out.min()
    out /= out.max()
    return out


def draw_line(img: np.ndarray, x0: float, y0: float, x1: float, y1: float, w: float, v: float) -> None:
    """Anti-aliased thick line with wrap-around (tileable)."""
    n = img.shape[0]
    L = max(1.0, math.hypot(x1 - x0, y1 - y0))
    steps = int(L * 1.5) + 1
    r = int(math.ceil(w + 1))
    for s in range(steps + 1):
        t = s / steps
        cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        ix, iy = int(cx), int(cy)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                px, py = ix + dx, iy + dy
                d = math.hypot(px + 0.5 - cx, py + 0.5 - cy)
                a = max(0.0, min(1.0, w - d + 0.5))
                if a > 0:
                    yy, xx = py % n, px % n
                    img[yy, xx] = max(img[yy, xx], a * v)


def feather(img: np.ndarray, x: float, y: float, ang: float, length: float, w: float, depth: int) -> None:
    ex, ey = x + math.cos(ang) * length, y + math.sin(ang) * length
    draw_line(img, x, y, ex, ey, w, 0.55 + 0.45 * rng.random())
    if depth <= 0 or length < 6:
        return
    k = int(length / 7)
    for i in range(1, k):
        t = i / k
        bx, by = x + (ex - x) * t, y + (ey - y) * t
        sub = length * (0.34 * (1 - t) + 0.08) * (0.6 + 0.5 * rng.random())
        for side in (-1, 1):
            if rng.random() < 0.85:
                feather(img, bx, by, ang + side * math.radians(60 + rng.normal(0, 4)), sub, max(0.5, w * 0.6), depth - 1)


def gen_frost() -> None:
    cover = fbm(N, beta=2.6, low_cut=2.0)
    detail = np.zeros((N, N), np.float64)
    # stems grow roughly along the local gradient of the coverage field (fronts), plus random stars
    for _ in range(90):
        x, y = rng.random() * N, rng.random() * N
        ang = rng.random() * math.tau
        feather(detail, x, y, ang, 30 + rng.random() * 70, 1.1, 2)
    for _ in range(40):  # six-armed stellar crystals
        x, y = rng.random() * N, rng.random() * N
        a0 = rng.random() * math.tau
        L = 8 + rng.random() * 16
        for k in range(6):
            feather(detail, x, y, a0 + k * math.pi / 3, L, 0.8, 1)
    detail = ndimage.gaussian_filter(detail, 0.6, mode="wrap")
    detail = np.clip(detail / max(detail.max(), 1e-6), 0, 1)
    grain = fbm(N, beta=1.2, low_cut=24.0)
    img = np.stack([cover, detail, grain], -1)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, "frost.png"))


def gen_droplets() -> None:
    nrm = np.zeros((N, N, 2), np.float64)
    cov = np.zeros((N, N), np.float64)
    rank = np.ones((N, N), np.float64)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64) + 0.5
    drops = []
    for i in range(420):
        r = float(np.clip(rng.lognormal(math.log(4.2), 0.45), 1.6, 15.0))
        drops.append((rng.random() * N, rng.random() * N, r, rng.random(), 1.0 + (rng.random() * 1.6 if r > 6 else 0.0)))
    # big drops last so they sit on top
    drops.sort(key=lambda d: d[2])
    for cx, cy, r, rk, stretch in drops:
        dx = (xx - cx + N / 2) % N - N / 2
        dy = (yy - cy + N / 2) % N - N / 2
        # elongated downward for heavier drops (runs)
        dy_s = np.where(dy > 0, dy / stretch, dy)
        d = np.sqrt(dx * dx + dy_s * dy_s) / r
        m = d < 1.0
        if not m.any():
            continue
        h = np.sqrt(np.clip(1 - d * d, 0, 1))
        edge = np.clip((1.0 - d) * r * 0.9, 0, 1)
        nx, ny = dx / r, dy_s / r
        sel = m & (edge > cov * 0.5)
        nrm[sel, 0] = nx[sel] * (1 - h[sel] * 0.3)
        nrm[sel, 1] = ny[sel] * (1 - h[sel] * 0.3)
        cov[sel] = np.maximum(cov[sel], edge[sel])
        rank[sel] = np.minimum(rank[sel], rk)
    rgba = np.zeros((N, N, 4), np.float64)
    rgba[..., 0] = np.clip(nrm[..., 0] * 0.5 + 0.5, 0, 1)
    rgba[..., 1] = np.clip(nrm[..., 1] * 0.5 + 0.5, 0, 1)
    rgba[..., 2] = cov
    rgba[..., 3] = rank
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "droplets.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    gen_frost()
    gen_droplets()
    print("wrote", OUT)

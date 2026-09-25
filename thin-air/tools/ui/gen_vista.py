#!/usr/bin/env python3.12
"""THIN AIR — stand-in mountain range for the menu vista (assets/ui/vista/*), used only when the real terrain
(TerrainData, terrain stream) is not available. Laid out like DESIGN §3 (valley + Loon Lake in the south, the
Corrigan massif and summit to the north), 12 km square at 12 m cells.

Pipeline (numpy, deterministic): designed macro relief (peaks joined by arêtes, a glaciated valley) +
derivative-damped ridged fBm (erosion-like gullies) scaled by relief → thermal erosion (talus) → a few rounds
of stream-power incision from D8 flow accumulation → surface masks from altitude/slope/aspect/flow.

Outputs:
  vista_height.png   RG8 = 16-bit height, h = H_MIN + (R*256 + G) / 65535 * (H_MAX - H_MIN)
  vista_normal.png   RGB8 world normal * 0.5 + 0.5 (Y up)
  vista_masks.png    RGBA8: R snow, G rock, B scree/gully, A forest

Usage: python3.12 thin-air/tools/ui/gen_vista.py [--preview out.png]
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "ui", "vista")
N = 1024
CELL = 12.0
EXT = N * CELL
H_MIN, H_MAX = 1200.0, 3600.0
rng = np.random.default_rng(20261024)

xs = (np.arange(N) - N / 2 + 0.5) * CELL
X, Z = np.meshgrid(xs, xs)          # X east, Z south (+Z), rows = z


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------ noise
_PERM = np.random.default_rng(99).permutation(256)
_PERM = np.concatenate([_PERM, _PERM])
_GRAD = np.array([[np.cos(a), np.sin(a)] for a in np.linspace(0, 2 * np.pi, 16, endpoint=False)])


def perlin(px, pz):
    ix = np.floor(px).astype(np.int64)
    iz = np.floor(pz).astype(np.int64)
    fx = px - ix
    fz = pz - iz
    ix &= 255
    iz &= 255

    def g(ox, oz):
        hsh = _PERM[_PERM[(ix + ox) & 255] + ((iz + oz) & 255)] & 15
        gv = _GRAD[hsh]
        return gv[..., 0] * (fx - ox) + gv[..., 1] * (fz - oz)

    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    a = g(0, 0); b = g(1, 0); c = g(0, 1); d = g(1, 1)
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41


def ridged(px, pz, octaves=6, gain=0.5, lac=2.03):
    """Musgrave ridged multifractal, 0..~1."""
    total = np.zeros_like(px)
    weight = np.ones_like(px)
    amp = 1.0
    norm = 0.0
    ang = 0.0
    for o in range(octaves):
        ca, sa = np.cos(ang), np.sin(ang)
        qx = px * ca - pz * sa + 13.7 * o
        qz = px * sa + pz * ca - 7.9 * o
        n = 1.0 - np.abs(perlin(qx, qz))
        n = n * n * weight
        weight = np.clip(n * 1.8, 0, 1)
        total += n * amp
        norm += amp
        amp *= gain
        px, pz = px * lac, pz * lac
        ang += 0.7
    return total / norm


def fbm(px, pz, octaves=5):
    total = np.zeros_like(px)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * perlin(px + 3.1 * o, pz - 1.7 * o)
        norm += amp
        amp *= 0.5
        px, pz = px * 2.0, pz * 2.0
    return total / norm


# ------------------------------------------------------------------------------------------ relief
def macro(X, Z):
    h = np.full(X.shape, 1360.0)
    peaks = [(120, -1260, 3452, 1400), (-1700, -1900, 2950, 1200), (1800, -2300, 3080, 1300),
             (-2700, 200, 2650, 1200), (2800, 350, 2560, 1200), (-600, -3600, 3150, 1600),
             (1300, -4200, 2900, 1500), (-4200, -1800, 2800, 1600), (4300, -1500, 2750, 1600),
             (-4600, 2400, 2500, 1400), (4500, 2600, 2450, 1400), (0, 4600, 2350, 1700), (-900, -300, 2250, 800),
             (1100, -200, 2300, 800)]
    acc = np.zeros(X.shape)
    kk = 1.0 / 90.0                       # smooth max (log-sum-exp) so the massifs merge without facet seams
    for px, pz, ph, rad in peaks:
        d = np.sqrt((X - px) ** 2 + (Z - pz) ** 2)
        cone = (ph - 1360.0) * np.clip(1.0 - d / (rad * 2.6), 0, 1) ** 1.6
        acc += np.exp(cone * kk)
    h = 1360.0 + np.log(acc) / kk
    h = np.maximum(h, 1360.0)
    meander = 260.0 * fbm(X / 2600.0 + 11.0, np.zeros_like(X) + 0.5, 3)
    dv = np.abs(Z - 700.0 + 0.08 * X + meander)
    valley = smoothstep(200.0, 1400.0, dv)
    h = 1360.0 + (h - 1360.0) * (0.15 + 0.85 * valley)
    return h, valley


def thermal(h, cell, iters=40, talus_deg=38.0):
    t = np.tan(np.radians(talus_deg)) * cell
    for _ in range(iters):
        moved = np.zeros_like(h)
        for dz, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            nb = np.roll(np.roll(h, dz, 0), dx, 1)
            diff = h - nb - t
            m = np.where(diff > 0, diff * 0.12, 0.0)
            moved -= m
            moved += np.roll(np.roll(m, -dz, 0), -dx, 1)
        h = h + moved
    return h


def receivers(h, cell):
    n = h.shape[0]
    offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    idx = np.arange(n * n).reshape(n, n)
    best = np.zeros_like(h)
    rec = idx.copy()
    dist = np.full(h.shape, cell)
    for dz, dx in offs:
        nb = np.roll(np.roll(h, -dz, 0), -dx, 1)
        dd = cell * (1.4142 if dz and dx else 1.0)
        s = (h - nb) / dd
        better = s > best
        best = np.where(better, s, best)
        rec = np.where(better, np.roll(np.roll(idx, -dz, 0), -dx, 1), rec)
        dist = np.where(better, dd, dist)
    for sl in (np.s_[0, :], np.s_[-1, :], np.s_[:, 0], np.s_[:, -1]):
        rec[sl] = idx[sl]
    return rec.ravel(), dist.ravel(), best


def stream_power(h, cell, iters=24, k=0.0045, m=0.5, dt=1.0):
    """Implicit stream-power incision (Braun & Willett 2013), no uplift: carves dendritic valleys and arêtes."""
    n = h.shape[0]
    area = None
    jitter = np.random.default_rng(5).random(h.shape) * 0.05
    for it in range(iters):
        rec, dist, _ = receivers(h + jitter, cell)
        hf = h.ravel().copy()
        order = np.argsort(-hf, kind="stable")
        area = np.full(n * n, cell * cell)
        rl = rec.tolist(); ol = order.tolist(); al = area.tolist()
        for i in ol:
            r = rl[i]
            if r != i:
                al[r] += al[i]
        area = np.array(al)
        F = (k * dt * area ** m / dist).tolist()
        hl = hf.tolist()
        for i in reversed(ol):
            r = rl[i]
            if r != i:
                hl[i] = (hl[i] + F[i] * hl[r]) / (1.0 + F[i])
        h = np.array(hl).reshape(n, n)
        if it % 6 == 5:
            h = thermal(h, cell, iters=3, talus_deg=40.0)
    return h, area.reshape(n, n)


def main():
    os.makedirs(OUT, exist_ok=True)
    # coarse stage (24 m) for relief + erosion, then upsample and add fine detail
    nc = N // 2
    cc = CELL * 2
    xc = (np.arange(nc) - nc / 2 + 0.5) * cc
    XC, ZC = np.meshgrid(xc, xc)
    print("macro relief…")
    env_h, valley = macro(XC, ZC)
    env = np.clip((env_h - 1360.0) / (3452.0 - 1360.0), 0.0, 1.0)      # where the mountains stand, 0..1
    s = 1.0 / 3400.0
    wx = XC * s + 0.45 * fbm(XC * s * 0.8, ZC * s * 0.8, 3)
    wz = ZC * s + 0.45 * fbm(XC * s * 0.8 + 5.2, ZC * s * 0.8 + 1.3, 3)
    r = ridged(wx, wz, 7, gain=0.52)
    # ridged relief shaped by the envelope: sharp arêtes and cirques where the massifs are, rolling below
    h = 1360.0 + 2150.0 * env ** 1.1 * (0.45 + 0.75 * r) + 160.0 * r * valley
    h = h * (0.0 + 1.0) + (env_h - h) * 0.25                            # keep the designed summits
    h = np.maximum(h, 1360.0)
    print("thermal erosion (coarse)…")
    h = thermal(h, cc, iters=25, talus_deg=44.0)
    print("upsample + detail…")
    h = ndimage.zoom(h, 2, order=3)
    valley = ndimage.zoom(valley, 2, order=1)
    relief = np.clip((h - 1400.0) / 1700.0, 0.0, 1.0)
    h = h + fbm(X / 180.0, Z / 180.0, 4) * (4.0 + 26.0 * relief) + (ridged(X / 700.0, Z / 700.0, 4) - 0.4) * 60.0 * relief
    # valley floor, Loon Lake basin
    dl = np.sqrt((X - 260) ** 2 + (Z - 640) ** 2)
    floor = 1392.0 + 0.004 * (X + 6000.0)
    h = np.where(valley < 0.3, floor + (h - floor) * smoothstep(0.02, 0.3, valley), h)
    h = np.where(dl < 320, np.minimum(h, 1414.0 + (dl / 320.0) ** 2 * 26.0), h)
    h = thermal(h, CELL, iters=10, talus_deg=45.0)
    print("fine flow accumulation…")
    rec, dist, _ = receivers(h, CELL)
    order = np.argsort(-h.ravel(), kind="stable").tolist()
    rl = rec.tolist()
    al = [CELL * CELL] * (N * N)
    for i in order:
        rr = rl[i]
        if rr != i:
            al[rr] += al[i]
    area = np.array(al).reshape(N, N) / (CELL * CELL)
    h = ndimage.gaussian_filter(h, 0.6)
    h = np.clip(h, H_MIN, H_MAX)
    # ---- normals
    gz, gx = np.gradient(h, CELL)
    nrm = np.stack([-gx, np.ones_like(h), -gz], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    slope = 1.0 - nrm[..., 1]
    slope_deg = np.degrees(np.arccos(np.clip(nrm[..., 1], -1, 1)))
    # ---- masks
    n1 = fbm(X / 900.0 + 3.0, Z / 900.0, 4) * 0.5 + 0.5
    snowline = 1820.0 + 260.0 * (n1 - 0.5)
    north = np.clip(-nrm[..., 2], 0, 1)                    # north-facing keeps snow (normal toward −Z)
    snow = smoothstep(snowline - 140, snowline + 160, h + 90 * north) * (1.0 - smoothstep(36.0, 50.0, slope_deg + 6 * (n1 - 0.5)))
    snow = np.maximum(snow, 0.35 * smoothstep(0.55, 0.8, n1) * (1 - smoothstep(25, 40, slope_deg)) * (h > 1450))
    gully = smoothstep(4.0, 7.0, np.log10(area * CELL * CELL + 1.0)) * smoothstep(18, 32, slope_deg)
    rock = smoothstep(33.0, 46.0, slope_deg + 8 * (n1 - 0.5)) * (1 - snow * 0.6)
    scree = np.clip(gully * (1 - snow) + smoothstep(26, 34, slope_deg) * smoothstep(1900, 2300, h) * (1 - snow) * 0.6, 0, 1)
    forest = (1 - smoothstep(1980.0, 2180.0, h + 120 * (n1 - 0.5))) * smoothstep(1398.0, 1440.0, h) \
        * (1 - smoothstep(30.0, 40.0, slope_deg)) * smoothstep(0.35, 0.6, fbm(X / 260.0, Z / 260.0, 3) * 0.5 + 0.55)
    forest *= (dl > 330)
    masks = np.stack([snow, rock, scree, forest], -1)
    # ---- write
    q = np.round((h - H_MIN) / (H_MAX - H_MIN) * 65535.0).astype(np.uint32)
    rg = np.zeros((N, N, 3), np.uint8)
    rg[..., 0] = (q >> 8).astype(np.uint8)
    rg[..., 1] = (q & 255).astype(np.uint8)
    Image.fromarray(rg, "RGB").save(os.path.join(OUT, "vista_height.png"), optimize=True)
    Image.fromarray((nrm * 0.5 + 0.5).clip(0, 1).__mul__(255).round().astype(np.uint8), "RGB").save(os.path.join(OUT, "vista_normal.png"), optimize=True)
    Image.fromarray((masks.clip(0, 1) * 255).round().astype(np.uint8), "RGBA").save(os.path.join(OUT, "vista_masks.png"), optimize=True)
    print(f"height {h.min():.0f}..{h.max():.0f} m; wrote {OUT}")
    if "--preview" in sys.argv:
        out = sys.argv[sys.argv.index("--preview") + 1]
        light = np.clip(nrm @ np.array([-0.6, 0.55, -0.3]) / np.linalg.norm([-0.6, 0.55, -0.3]), 0, 1)
        col = np.stack([light] * 3, -1) * 0.8 + 0.1
        col = col * (1 - forest[..., None] * 0.6) + snow[..., None] * 0.2
        Image.fromarray((col.clip(0, 1) * 255).astype(np.uint8)).resize((768, 768)).save(out)
        print("preview", out)


if __name__ == "__main__":
    main()

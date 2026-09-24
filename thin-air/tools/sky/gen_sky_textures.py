#!/usr/bin/env python3
"""THIN AIR — procedural sky textures (all original, deterministic).

Writes into thin-air/assets/textures/sky/:
  cloud_noise.png   512² RGBA tileable: R Perlin-Worley (cloud shapes), G Worley billows, B detail fbm,
                    A cirrus streaks (anisotropic).
  moon_albedo.png   512² RGBA near-side orthographic albedo (celestial north up, Mare Crisium right),
                    real maria layout, highlands cratering, Tycho/Copernicus/Kepler ray systems. A = disk mask.
  stars.png         2048×1024 RGBA equirect in equatorial coords (x = RA 0→24h eastward, y = Dec +90→−90).
                    Each texel holds the brightest star whose PSF reaches it: R,G = tangent-plane offset
                    (east, north) of the star from the texel centre in [−0.25°, 0.25°], B = 1 + (V + 2)·25
                    (0 = empty), A = B−V colour index mapped −0.4…2.0 → 0…255. Sample with texelFetch.
  milky_way.png     2048×1024 RGB equirect (same mapping), naked-eye Milky Way in galactic coordinates:
                    bulge, Great Rift, Cygnus/Scutum/Sagittarius star clouds, dust mottling, M31, clusters.
  flakes.png        256² RGBA 4×4 atlas of soft snowflake sprites (white, alpha = coverage).
  blue_noise.png    64² L8 void-and-cluster blue noise (dither).
Usage: python3 tools/sky/gen_sky_textures.py
"""
import math
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "textures", "sky"))
os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(20251029)


# ============================================================================================ noise helpers
def tile_perlin(n, period, rng):
    """Tileable 2D gradient noise sampled on an n×n grid with `period` cells."""
    ang = rng.uniform(0, 2 * np.pi, (period, period))
    gx, gy = np.cos(ang), np.sin(ang)
    x = np.arange(n) * period / n
    X, Y = np.meshgrid(x, x, indexing="xy")
    xi = np.floor(X).astype(int)
    yi = np.floor(Y).astype(int)
    xf = X - xi
    yf = Y - yi

    def grad(ix, iy, dx, dy):
        ix %= period
        iy %= period
        return gx[iy, ix] * dx + gy[iy, ix] * dy

    def fade(t):
        return t * t * t * (t * (t * 6 - 15) + 10)

    n00 = grad(xi, yi, xf, yf)
    n10 = grad(xi + 1, yi, xf - 1, yf)
    n01 = grad(xi, yi + 1, xf, yf - 1)
    n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
    u, v = fade(xf), fade(yf)
    return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v


def tile_fbm(n, base, octaves, rng, gain=0.5):
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * tile_perlin(n, base * 2 ** o, rng)
        tot += amp
        amp *= gain
    return out / tot


def tile_worley(n, cells, rng):
    """Tileable F1 Worley distance (0 at feature points), normalised to ~[0, 1]."""
    pts = rng.uniform(0, 1, (cells, cells, 2))
    x = (np.arange(n) + 0.5) / n * cells
    X, Y = np.meshgrid(x, x, indexing="xy")
    cx = np.floor(X).astype(int)
    cy = np.floor(Y).astype(int)
    best = np.full((n, n), 9.0)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            ix = cx + ox
            iy = cy + oy
            p = pts[iy % cells, ix % cells]
            dx = ix + p[..., 0] - X
            dy = iy + p[..., 1] - Y
            best = np.minimum(best, np.sqrt(dx * dx + dy * dy))
    return np.clip(best / 0.9, 0, 1)


def remap(v, lo, hi, nlo=0.0, nhi=1.0):
    return nlo + (v - lo) * (nhi - nlo) / (hi - lo)


def norm01(a):
    a = a - a.min()
    return a / max(a.max(), 1e-9)


def perlin_xy(X, Y, px, py, rng):
    """Tileable gradient noise at lattice coordinates (X, Y) with periods (px, py)."""
    ang = rng.uniform(0, 2 * np.pi, (py, px))
    gxx, gyy = np.cos(ang), np.sin(ang)
    xi = np.floor(X).astype(int)
    yi = np.floor(Y).astype(int)
    xf = X - xi
    yf = Y - yi

    def g(ix, iy, dx, dy):
        return gxx[iy % py, ix % px] * dx + gyy[iy % py, ix % px] * dy

    f = lambda t: t * t * t * (t * (t * 6 - 15) + 10)
    u, v = f(xf), f(yf)
    return (g(xi, yi, xf, yf) * (1 - u) + g(xi + 1, yi, xf - 1, yf) * u) * (1 - v) + \
           (g(xi, yi + 1, xf, yf - 1) * (1 - u) + g(xi + 1, yi + 1, xf - 1, yf - 1) * u) * v


def vnoise3(P, freq, seed):
    """Smooth value noise on 3D points P[...,3] (|P| <= 1), roughly in [0, 1]."""
    rng = np.random.default_rng(seed)
    G = int(2 * freq) + 4
    lat = rng.random((G, G, G))
    Q = P * freq + freq + 1.0
    i = np.floor(Q).astype(int)
    f = Q - i
    f = f * f * (3.0 - 2.0 * f)
    x, y, z = i[..., 0], i[..., 1], i[..., 2]
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    c000 = lat[x, y, z]; c100 = lat[x + 1, y, z]; c010 = lat[x, y + 1, z]; c110 = lat[x + 1, y + 1, z]
    c001 = lat[x, y, z + 1]; c101 = lat[x + 1, y, z + 1]; c011 = lat[x, y + 1, z + 1]; c111 = lat[x + 1, y + 1, z + 1]
    c00 = c000 * (1 - fx) + c100 * fx
    c10 = c010 * (1 - fx) + c110 * fx
    c01 = c001 * (1 - fx) + c101 * fx
    c11 = c011 * (1 - fx) + c111 * fx
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz


def fbm3(P, base, octaves, seed, gain=0.5):
    out = np.zeros(P.shape[:-1])
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * (vnoise3(P, base * 2 ** o, seed + 17 * o) * 2.0 - 1.0)
        tot += amp
        amp *= gain
    return out / tot


# ============================================================================================ clouds
def gen_clouds():
    n = 512
    rng = np.random.default_rng(11)
    perlin = norm01(tile_fbm(n, 4, 6, rng, 0.55))
    worley_low = 1.0 - (0.625 * tile_worley(n, 6, rng) + 0.25 * tile_worley(n, 12, rng) + 0.125 * tile_worley(n, 24, rng))
    worley_low = norm01(worley_low)
    # Perlin-Worley (Schneider): billowy but connected shapes
    pw = norm01(remap(perlin, worley_low - 1.0, 1.0, 0.0, 1.0).clip(0, 1) * 0.6 + perlin * 0.4)
    billow = norm01(1.0 - (0.6 * tile_worley(n, 16, rng) + 0.3 * tile_worley(n, 32, rng) + 0.1 * tile_worley(n, 64, rng)))
    detail = norm01(tile_fbm(n, 16, 4, rng, 0.5))
    # Cirrus: fibrous strands along x (the shader aligns x with the wind), curved by a low-frequency
    # warp, gathered into patches ("mares' tails" and veils), with fine hair-like texture.
    rr = np.random.default_rng(99)
    u = np.arange(n) / n
    X, Y = np.meshgrid(u, u, indexing="xy")
    # Flow warp (two octaves each axis) bends the fibres into hooks and swirls.
    wx = perlin_xy(X * 2, Y * 2, 2, 2, rr) * 0.11 + perlin_xy(X * 5, Y * 5, 5, 5, rr) * 0.035
    wy = perlin_xy(X * 2, Y * 2, 2, 2, rr) * 0.11 + perlin_xy(X * 5, Y * 5, 5, 5, rr) * 0.035
    Xw = (X + wx) % 1.0
    Yw = (Y + wy) % 1.0
    fib = np.zeros((n, n))
    for (px, py, a) in [(4, 12, 1.0), (8, 24, 0.55), (16, 48, 0.3), (32, 96, 0.16)]:
        fib += a * (1.0 - np.abs(perlin_xy(Xw * px, Yw * py, px, py, rr)) * 1.5)
    fib = norm01(fib) ** 2.4
    # Patches: tufts and veils separated by clear sky.
    patch = norm01(perlin_xy(X * 3, Y * 3, 3, 3, rr) + 0.5 * perlin_xy(X * 6, Y * 6, 6, 6, rr) + 0.25 * perlin_xy(X * 12, Y * 12, 12, 12, rr))
    patch = np.clip((patch - 0.42) / 0.33, 0, 1)
    patch = patch * patch * (3 - 2 * patch)
    ci = np.clip((fib * 0.8 + 0.2 * norm01(tile_fbm(n, 8, 3, rr))) * patch * 1.3, 0, 1)
    img = np.stack([pw, billow, detail, norm01(ci)], axis=-1)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "cloud_noise.png"))
    print("cloud_noise.png")


# ============================================================================================ moon
MARIA = [  # (lat, lon east+, radius deg (1° ≈ 30 km), darkness) — real near-side maria
    (32.8, -15.6, 19.0, 1.0),                                                   # Imbrium
    (28.0, 17.5, 11.2, 0.95),                                                   # Serenitatis
    (8.5, 31.4, 13.5, 1.05), (2.0, 22.0, 6.0, 1.0), (15.0, 36.0, 6.0, 1.0),     # Tranquillitatis
    (17.0, 59.1, 9.0, 1.05),                                                    # Crisium
    (-7.8, 51.3, 12.0, 0.85), (-1.0, 47.0, 6.0, 0.85),                          # Fecunditatis
    (-15.2, 35.5, 5.8, 0.9),                                                    # Nectaris
    (-21.3, -16.6, 11.5, 0.8), (-10.0, -23.0, 6.5, 0.85),                       # Nubium, Cognitum
    (-24.4, -38.6, 6.8, 0.95), (7.5, -30.9, 8.5, 0.9),                          # Humorum, Insularum
    (18.0, -57.0, 16.0, 0.95), (0.0, -50.0, 13.0, 0.95), (30.0, -52.0, 12.0, 0.95),   # Procellarum
    (-8.0, -44.0, 10.0, 0.9), (42.0, -42.0, 8.0, 0.9), (10.0, -64.0, 11.0, 0.9), (-16.0, -50.0, 6.0, 0.8),
    (56.0, -40.0, 4.2, 0.8), (57.0, -30.0, 4.2, 0.8), (58.0, -20.0, 4.2, 0.8), (58.0, -10.0, 4.2, 0.8),  # Frigoris
    (58.5, 0.0, 4.2, 0.8), (58.0, 10.0, 4.2, 0.8), (57.0, 20.0, 4.2, 0.8), (56.0, 30.0, 4.0, 0.75),
    (13.3, 3.6, 4.2, 0.9), (2.4, 1.7, 3.2, 0.85), (10.9, -8.8, 3.8, 0.85),    # Vaporum, Medii, Aestuum
    (44.1, -31.5, 4.8, 0.95), (38.0, 29.0, 4.8, 0.75),                         # Iridum, Somniorum
    (1.3, 87.0, 6.0, 0.8), (13.3, 86.0, 5.0, 0.8),                              # Smythii, Marginis
    (-5.2, -68.6, 2.6, 1.15), (51.6, -9.4, 1.4, 1.15),                          # Grimaldi, Plato
]
RAY_CRATERS = [  # (lat, lon, crater radius deg, ray length deg, brightness, n rays)
    (-43.3, -11.4, 1.4, 55.0, 1.0, 26), (9.6, -20.1, 1.5, 22.0, 0.75, 22), (8.1, -38.0, 0.6, 14.0, 0.6, 16),
    (23.7, -47.4, 0.7, 10.0, 0.9, 12), (16.1, 46.8, 0.5, 14.0, 0.55, 10), (-9.0, 36.0, 0.4, 8.0, 0.35, 8),
    (22.0, 30.0, 0.35, 6.0, 0.3, 6), (-27.0, -5.0, 0.3, 6.0, 0.3, 6),
]


def sph_dist(lat1, lon1, lat2, lon2):
    a = np.sin(lat1) * np.sin(lat2) + np.cos(lat1) * np.cos(lat2) * np.cos(lon1 - lon2)
    return np.arccos(np.clip(a, -1, 1))


def gen_moon():
    n = 512
    y = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(y, -y, indexing="xy")        # Y up = lunar north, X right = Mare Crisium side
    r2 = X * X + Y * Y
    inside = r2 <= 1.0
    Z = np.sqrt(np.clip(1 - r2, 0, 1))
    P = np.stack([X, Y, Z], axis=-1)
    rng = np.random.default_rng(7)
    # warped sphere position → organic, merged maria outlines
    Pw = P + 0.10 * np.stack([fbm3(P, 3, 4, 101), fbm3(P, 3, 4, 202), fbm3(P, 3, 4, 303)], axis=-1)
    Pw /= np.linalg.norm(Pw, axis=-1, keepdims=True) + 1e-9
    lat = np.arcsin(np.clip(Pw[..., 1], -1, 1))
    lon = np.arctan2(Pw[..., 0], Pw[..., 2])
    field = np.zeros_like(X)
    for (la, lo, rad, dark) in MARIA:
        d = np.degrees(sph_dist(lat, lon, np.radians(la), np.radians(lo))) / rad
        field += (dark * np.exp(-d * d * 0.9)) ** 4  # soft-max union (p = 4)
    field = field ** 0.25 + 0.16 * fbm3(P, 10, 4, 404)
    mare = np.clip((field - 0.40) / 0.22, 0, 1)
    mare = mare * mare * (3 - 2 * mare)
    # highlands: mottled, bright; maria: darker with lava-flow variation
    hi = 1.0 + 0.09 * fbm3(P, 6, 5, 505) + 0.05 * fbm3(P, 28, 3, 606)
    mv = 0.47 + 0.07 * fbm3(P, 9, 4, 707) + 0.03 * fbm3(P, 40, 2, 808)
    alb = hi * (1 - mare) + mv * mare
    # small fresh craters: bright specks with soft halos (mostly in the highlands)
    lat0 = np.arcsin(np.clip(P[..., 1], -1, 1))
    lon0 = np.arctan2(P[..., 0], P[..., 2])
    for k in range(700):
        cla = math.degrees(math.asin(rng.uniform(-1, 1)))
        clo = rng.uniform(-88, 88)
        rad = min(0.25 * (1.0 / (0.03 + rng.random())) ** 0.5, 1.6)
        cx = math.cos(math.radians(cla)) * math.sin(math.radians(clo))
        cy = math.sin(math.radians(cla))
        rpx = rad * 3 / 57.3 * n / 2 * 2.0 + 3
        px = int((cx + 1) / 2 * n)
        py = int((1 - cy) / 2 * n)
        x0, x1 = max(0, int(px - rpx)), min(n, int(px + rpx) + 1)
        y0, y1 = max(0, int(py - rpx)), min(n, int(py + rpx) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        on_mare = mare[min(max(py, 0), n - 1), min(max(px, 0), n - 1)]
        if on_mare > 0.5 and rng.random() < 0.6:
            continue
        sl = (slice(y0, y1), slice(x0, x1))
        d = np.degrees(sph_dist(lat0[sl], lon0[sl], math.radians(cla), math.radians(clo))) / rad
        amp = rng.uniform(0.03, 0.14) * (1.0 if rng.random() < 0.8 else 2.0)
        alb[sl] += amp * np.exp(-d * d * 2.0) + 0.3 * amp * np.exp(-d * 0.9)
    # ray craters: long, thin, faint streaks + bright nimbus
    for (la, lo, rad, length, bright, nrays) in RAY_CRATERS:
        d = np.degrees(sph_dist(lat0, lon0, math.radians(la), math.radians(lo)))
        la1, lo1 = math.radians(la), math.radians(lo)
        brg = np.arctan2(np.sin(lon0 - lo1) * np.cos(lat0), math.cos(la1) * np.sin(lat0) - math.sin(la1) * np.cos(lat0) * np.cos(lon0 - lo1))
        rays = np.zeros_like(d)
        for k in range(nrays):
            b0 = rng.uniform(-np.pi, np.pi)
            wdeg = rng.uniform(0.35, 1.1) * (1.0 + rad * 0.3)
            L = length * rng.uniform(0.35, 1.0)
            db = np.angle(np.exp(1j * (brg - b0)))
            cross = np.abs(d * np.sin(db))
            along = np.clip(1 - d / L, 0, 1) ** 1.5 * (np.cos(db) > 0)
            rays = np.maximum(rays, np.exp(-(cross / wdeg) ** 2) * along * rng.uniform(0.5, 1.0))
        rays *= 0.7 + 0.6 * np.clip(fbm3(P, 30, 2, 909 + int(abs(la) * 10)) + 0.5, 0, 1)
        nimbus = np.exp(-np.maximum(d - rad, 0) / (rad * 1.8 + 0.4))
        crater = np.exp(-(d / rad) ** 2 * 1.2)
        alb += bright * (0.16 * rays * (d > rad * 1.2) + 0.22 * nimbus + 0.35 * crater)
    alb = np.clip(alb, 0.15, 3.0)
    alb = alb / np.percentile(alb[inside], 99.7)
    alb = np.clip(alb, 0, 1) * 0.92
    # subtle colour: Tranquillitatis/Fecunditatis bluish, Imbrium/Serenitatis brownish, warm grey overall
    blue = np.exp(-(np.degrees(sph_dist(lat, lon, math.radians(5), math.radians(35))) / 15) ** 2)
    col = np.stack([alb * 1.0, alb * 0.975, alb * 0.94], axis=-1)
    col[..., 2] *= 1.0 + 0.05 * mare * blue
    col[..., 0] *= 1.0 + 0.03 * mare * (1 - blue)
    a = np.clip((1.0 - np.sqrt(r2)) * n * 0.5, 0, 1)
    img = np.concatenate([np.clip(col, 0, 1), a[..., None]], axis=-1)
    img[..., :3] = np.where(img[..., :3] <= 0.0031308, img[..., :3] * 12.92, 1.055 * np.power(img[..., :3], 1 / 2.4) - 0.055)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "moon_albedo.png"))
    print("moon_albedo.png")


# ============================================================================================ stars
# name, RA h, RA m, Dec °, Dec ', V, B−V   (J2000, rounded)
BRIGHT_STARS = """
Dubhe 11 03.7 61 45 1.79 1.07|Merak 11 01.8 56 23 2.37 -0.02|Phecda 11 53.8 53 42 2.44 0.04|Megrez 12 15.4 57 02 3.31 0.08
Alioth 12 54.0 55 58 1.77 -0.02|Mizar 13 23.9 54 56 2.23 0.02|Alcor 13 25.2 54 59 3.99 0.16|Alkaid 13 47.5 49 19 1.86 -0.19
TaniaB 10 17.1 42 55 3.45 0.03|TaniaA 10 22.3 41 30 3.05 1.59|Talitha 08 59.2 48 02 3.14 0.19|AlulaB 11 18.5 33 06 3.49 1.40
psiUMa 11 09.7 44 30 3.01 1.14|thetaUMa 09 32.9 51 41 3.17 0.46|Muscida 08 30.3 60 43 3.36 0.85
Polaris 02 31.8 89 16 1.98 0.60|Kochab 14 50.7 74 09 2.08 1.47|Pherkad 15 20.7 71 50 3.05 0.05|epsUMi 16 46.0 82 02 4.21 0.89
Yildun 17 32.2 86 35 4.35 0.02|zetaUMi 15 44.1 77 48 4.29 0.04|etaUMi 16 17.5 75 45 4.95 0.37
Schedar 00 40.5 56 32 2.24 1.17|Caph 00 09.2 59 09 2.28 0.34|Navi 00 56.7 60 43 2.47 -0.15|Ruchbah 01 25.8 60 14 2.68 0.13
Segin 01 54.4 63 40 3.37 -0.15|Alderamin 21 18.6 62 35 2.45 0.22|Alfirk 21 28.7 70 34 3.23 -0.22|Errai 23 39.3 77 38 3.21 1.03
zetaCep 22 10.9 58 12 3.35 1.57|deltaCep 22 29.2 58 25 4.07 0.60|iotaCep 22 49.7 66 12 3.52 1.05
Deneb 20 41.4 45 17 1.25 0.09|Sadr 20 22.2 40 15 2.23 0.67|Aljanah 20 46.2 33 58 2.48 1.03|Fawaris 19 45.0 45 08 2.87 -0.03
Albireo 19 30.7 27 58 3.08 1.13|zetaCyg 21 12.9 30 14 3.21 0.99|etaCyg 19 56.3 35 05 3.89 1.02
Vega 18 36.9 38 47 0.03 0.00|Sheliak 18 50.1 33 22 3.52 0.00|Sulafat 18 59.0 32 41 3.25 -0.05|epsLyr 18 44.3 39 40 4.67 0.18
zetaLyr 18 44.8 37 36 4.36 0.19|delta2Lyr 18 54.5 36 54 4.30 1.68
Altair 19 50.8 08 52 0.76 0.22|Tarazed 19 46.3 10 37 2.72 1.52|Alshain 19 55.3 06 24 3.71 0.86|zetaAql 19 05.4 13 52 2.99 0.01
deltaAql 19 25.5 03 07 3.36 0.32|lambdaAql 19 06.2 -04 53 3.43 -0.09|thetaAql 20 11.3 -00 49 3.24 -0.07
Kornephoros 16 30.2 21 29 2.77 0.95|zetaHer 16 41.3 31 36 2.81 0.65|piHer 17 15.0 36 49 3.16 1.44|etaHer 16 42.9 38 55 3.48 0.92
epsHer 17 00.3 30 56 3.92 -0.01|deltaHer 17 15.0 24 50 3.14 0.08|Rasalgethi 17 14.6 14 23 3.35 1.44|muHer 17 46.5 27 43 3.42 0.75
Alphecca 15 34.7 26 43 2.23 -0.02|betaCrB 15 27.8 29 06 3.68 0.28|gammaCrB 15 42.7 26 18 3.84 0.00
Arcturus 14 15.7 19 11 -0.05 1.23|Izar 14 45.0 27 04 2.37 0.97|Muphrid 13 54.7 18 24 2.68 0.58|Seginus 14 32.1 38 18 3.03 0.19
Nekkar 15 01.9 40 23 3.50 0.97|deltaBoo 15 15.5 33 19 3.47 0.95|rhoBoo 14 31.8 30 22 3.58 1.30
Eltanin 17 56.6 51 29 2.24 1.52|Rastaban 17 30.4 52 18 2.79 0.98|Altais 19 12.6 67 40 3.07 1.00|Aldhibah 17 08.8 65 43 3.17 -0.12
etaDra 16 24.0 61 31 2.73 0.91|Thuban 14 04.4 64 23 3.65 -0.05|iotaDra 15 24.9 58 58 3.29 1.16|Grumium 17 53.5 56 52 3.75 1.18
kappaDra 12 33.5 69 47 3.87 -0.13|lambdaDra 11 31.4 69 20 3.84 1.62
Mirfak 03 24.3 49 52 1.79 0.48|Algol 03 08.2 40 57 2.12 -0.05|zetaPer 03 54.1 31 53 2.85 0.12|epsPer 03 57.9 40 01 2.89 -0.18
gammaPer 03 04.8 53 30 2.93 0.70|deltaPer 03 42.9 47 47 3.01 -0.13|rhoPer 03 05.2 38 50 3.39 1.65|etaPer 02 50.7 55 54 3.76 1.68
nuPer 03 45.2 42 35 3.77 0.42
Capella 05 16.7 46 00 0.08 0.80|Menkalinan 05 59.5 44 57 1.90 0.08|thetaAur 05 59.7 37 13 2.62 -0.08|Hassaleh 04 57.0 33 10 2.69 1.53
Almaaz 05 02.0 43 49 3.03 0.54|etaAur 05 06.5 41 14 3.17 -0.18|zetaAur 05 02.5 41 05 3.75 1.22|Elnath 05 26.3 28 36 1.65 -0.13
Aldebaran 04 35.9 16 31 0.86 1.54|zetaTau 05 37.6 21 09 3.00 -0.19|theta2Tau 04 28.7 15 52 3.40 0.18|epsTau 04 28.6 19 11 3.53 1.01
gammaTau 04 19.8 15 38 3.65 0.99|delta1Tau 04 22.9 17 33 3.76 0.98|lambdaTau 04 00.7 12 29 3.47 -0.12
Alcyone 03 47.5 24 06 2.87 -0.09|Atlas 03 49.2 24 03 3.62 -0.08|Electra 03 44.9 24 07 3.70 -0.11|Maia 03 45.8 24 22 3.87 -0.07
Merope 03 46.3 23 57 4.18 -0.06|Taygeta 03 45.2 24 28 4.30 -0.11|Pleione 03 49.2 24 08 5.05 -0.08|Celaeno 03 44.8 24 17 5.45 -0.04
Asterope 03 45.9 24 33 5.76 -0.06
Rigel 05 14.5 -08 12 0.13 -0.03|Betelgeuse 05 55.2 07 24 0.50 1.85|Bellatrix 05 25.1 06 21 1.64 -0.22|Alnilam 05 36.2 -01 12 1.69 -0.18
Alnitak 05 40.8 -01 57 1.77 -0.21|Mintaka 05 32.0 -00 18 2.23 -0.22|Saiph 05 47.8 -09 40 2.07 -0.18|Meissa 05 35.1 09 56 3.39 -0.18
Hatysa 05 35.4 -05 55 2.77 -0.24|pi3Ori 04 49.8 06 58 3.19 0.45|etaOri 05 24.5 -02 24 3.36 -0.17
Pollux 07 45.3 28 02 1.14 1.00|Castor 07 34.6 31 53 1.58 0.03|Alhena 06 37.7 16 24 1.93 0.00|Tejat 06 23.0 22 31 2.88 1.64
Mebsuta 06 43.9 25 08 2.98 1.40|Wasat 07 20.1 21 59 3.53 0.34|Propus 06 14.9 22 30 3.28 1.60|xiGem 06 45.3 12 54 3.36 0.43
kappaGem 07 44.4 24 24 3.57 0.93
Procyon 07 39.3 05 13 0.34 0.42|Gomeisa 07 27.2 08 17 2.89 -0.10
Sirius 06 45.1 -16 43 -1.46 0.00|Adhara 06 58.6 -28 58 1.50 -0.21|Wezen 07 08.4 -26 24 1.83 0.68|Mirzam 06 22.7 -17 57 1.98 -0.23
Aludra 07 24.1 -29 18 2.45 -0.08|Furud 06 20.3 -30 04 3.02 -0.19|omicron2CMa 07 03.0 -23 50 3.02 -0.08|sigmaCMa 07 01.7 -27 56 3.47 1.73
Arneb 05 32.7 -17 49 2.58 0.21|Nihal 05 28.2 -20 46 2.84 0.82|epsLep 05 05.5 -22 22 3.19 1.46|muLep 05 12.9 -16 12 3.29 -0.11
Cursa 05 07.9 -05 05 2.79 0.13|Zaurak 03 58.0 -13 31 2.95 1.59|deltaEri 03 43.2 -09 46 3.54 0.92
Regulus 10 08.4 11 58 1.35 -0.11|Denebola 11 49.1 14 34 2.13 0.09|Algieba 10 20.0 19 50 2.08 1.13|Zosma 11 14.2 20 31 2.56 0.12
Chertan 11 14.2 15 26 3.33 0.00|etaLeo 10 07.3 16 46 3.49 -0.03|Adhafera 10 16.7 23 25 3.44 0.31|RasElased 09 45.9 23 46 2.98 0.81
muLeo 09 52.8 26 00 3.88 1.22|betaCnc 08 16.5 09 11 3.52 1.48|Alphard 09 27.6 -08 40 1.98 1.44
Spica 13 25.2 -11 10 0.97 -0.23|Porrima 12 41.7 -01 27 2.74 0.36|Vindemiatrix 13 02.2 10 58 2.83 0.94|deltaVir 12 55.6 03 24 3.38 1.58
zetaVir 13 34.7 -00 36 3.37 0.11|Gienah 12 15.8 -17 33 2.59 -0.11|Kraz 12 34.4 -23 24 2.65 0.89|Algorab 12 29.9 -16 31 2.94 -0.05
Minkar 12 10.1 -22 37 3.00 1.33|Zubeneschamali 15 17.0 -09 23 2.61 -0.07|Zubenelgenubi 14 50.9 -16 02 2.75 0.15
Antares 16 29.4 -26 26 0.96 1.83|Dschubba 16 00.3 -22 37 2.29 -0.12|Acrab 16 05.4 -19 48 2.62 -0.07|sigmaSco 16 21.2 -25 36 2.89 0.13
piSco 15 58.9 -26 07 2.89 -0.19|tauSco 16 35.9 -28 13 2.82 -0.25
Rasalhague 17 34.9 12 34 2.08 0.15|Sabik 17 10.4 -15 44 2.43 0.06|YedPrior 16 14.3 -03 42 2.74 1.58|Cebalrai 17 43.5 04 34 2.77 1.16
zetaOph 16 37.2 -10 34 2.56 0.02|kappaOph 16 57.7 09 23 3.20 1.15|YedPost 16 18.3 -04 42 3.24 0.97|Unukalhai 15 44.3 06 26 2.63 1.17
etaSer 18 21.3 -02 54 3.26 0.94
Nunki 18 55.3 -26 18 2.05 -0.13|KausBor 18 28.0 -25 25 2.81 1.04|Ascella 19 02.6 -29 53 2.60 0.08|KausMed 18 21.0 -29 50 2.70 1.38
phiSgr 18 45.7 -26 59 3.17 -0.11|tauSgr 19 06.9 -27 40 3.32 1.19
DenebAlgedi 21 47.0 -16 08 2.85 0.29|Dabih 20 21.0 -14 47 3.08 0.79|Sadalsuud 21 31.6 -05 34 2.87 0.83|Sadalmelik 22 05.8 -00 19 2.95 0.98
Skat 22 54.7 -15 49 3.27 0.08|Fomalhaut 22 57.6 -29 37 1.16 0.09
Enif 21 44.2 09 53 2.39 1.53|Scheat 23 03.8 28 05 2.42 1.67|Markab 23 04.8 15 12 2.49 -0.04|Algenib 00 13.2 15 11 2.83 -0.23
Matar 22 43.0 30 13 2.94 0.86|Homam 22 41.5 10 50 3.40 -0.09|Biham 22 10.2 06 12 3.53 0.08
Alpheratz 00 08.4 29 05 2.06 -0.11|Mirach 01 09.7 35 37 2.05 1.58|Almach 02 03.9 42 20 2.10 1.37|deltaAnd 00 39.3 30 52 3.27 1.28
betaTri 02 09.5 34 59 3.00 0.14|Mothallah 01 53.1 29 35 3.41 0.49
Hamal 02 07.2 23 28 2.01 1.15|Sheratan 01 54.6 20 48 2.64 0.13|Mesarthim 01 53.5 19 18 3.88 -0.04
Diphda 00 43.6 -17 59 2.04 1.02|Menkar 03 02.3 04 05 2.54 1.64|etaCet 01 08.6 -10 11 3.45 1.16|tauCet 01 44.1 -15 56 3.50 0.72
alphaLyn 09 21.1 34 24 3.14 1.55|betaCam 05 03.4 60 27 4.03 0.92|CorCaroli 12 56.0 38 19 2.90 -0.12|betaCom 13 11.9 27 53 4.26 0.57
Rotanev 20 37.5 14 36 3.63 0.44|Sualocin 20 39.6 15 55 3.77 -0.06|gammaDel 20 46.7 16 07 3.90 1.00|gammaSge 19 58.8 19 29 3.47 1.57
"""


def parse_bright():
    out = []
    for item in BRIGHT_STARS.replace("\n", "|").split("|"):
        f = item.split()
        if len(f) != 7:
            continue
        name, rh, rm, dd, dm, v, bv = f
        ra = (float(rh) + float(rm) / 60.0) * 15.0
        sgn = -1.0 if dd.startswith("-") else 1.0
        dec = sgn * (abs(float(dd)) + float(dm) / 60.0)
        out.append((ra, dec, float(v), float(bv)))
    return out


def radec_to_vec(ra_deg, dec_deg):
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


# Galactic <-> equatorial (J2000)
_RA_NGP, _DEC_NGP, _L_NCP = math.radians(192.85948), math.radians(27.12825), math.radians(122.93192)


def eq_to_gal(ra_deg, dec_deg):
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    sb = np.sin(dec) * math.sin(_DEC_NGP) + np.cos(dec) * math.cos(_DEC_NGP) * np.cos(ra - _RA_NGP)
    b = np.arcsin(np.clip(sb, -1, 1))
    y = np.cos(dec) * np.sin(ra - _RA_NGP)
    x = np.sin(dec) * math.cos(_DEC_NGP) - np.cos(dec) * math.sin(_DEC_NGP) * np.cos(ra - _RA_NGP)
    l = _L_NCP - np.arctan2(y, x)
    return np.degrees(np.mod(l, 2 * np.pi)), np.degrees(b)


STAR_W, STAR_H = 2048, 1024
STAR_REACH_DEG = 0.25


def gen_stars():
    rng = np.random.default_rng(424242)
    stars = parse_bright()
    bright_n = len(stars)
    # procedural stars 2.8 .. 7.6 mag: log10 N(<m) ≈ 0.48 m + 0.8 over the whole sky
    def n_brighter(m):
        return 10 ** (0.48 * m + 0.8)
    n_proc = int(n_brighter(7.6) - n_brighter(2.8))
    # candidate positions uniform on the sphere, accepted with galactic-latitude weighting
    cand = int(n_proc * 2.6)
    z = rng.uniform(-1, 1, cand)
    ra = rng.uniform(0, 360, cand)
    dec = np.degrees(np.arcsin(z))
    _, b = eq_to_gal(ra, dec)
    w = 0.45 + 1.1 * np.exp(-np.abs(b) / 12.0) + 0.4 * np.exp(-np.abs(b) / 4.0)
    keep = rng.uniform(0, w.max(), cand) < w
    ra, dec, b = ra[keep][:n_proc], dec[keep][:n_proc], b[keep][:n_proc]
    u = rng.uniform(0, 1, ra.size)
    # invert cumulative counts between 2.8 and 7.6
    lo, hi = n_brighter(2.8), n_brighter(7.6)
    mags = (np.log10(lo + u * (hi - lo)) - 0.8) / 0.48
    # colour: mostly A–K; faint stars skew to G/K; some M giants, few B
    bv = np.clip(rng.normal(0.65, 0.42, ra.size), -0.3, 1.9)
    bv = np.where(rng.random(ra.size) < 0.06, rng.uniform(1.4, 1.9, ra.size), bv)
    allstars = [(r, d, m, c) for r, d, m, c in zip(ra, dec, mags, bv)] + stars
    # sort faint → bright so brighter stars overwrite
    allstars.sort(key=lambda s: -s[2])
    tex = np.zeros((STAR_H, STAR_W, 4), np.uint8)
    tex[..., 0] = 128
    tex[..., 1] = 128
    texmag = np.full((STAR_H, STAR_W), 99.0)
    dx_ra = 360.0 / STAR_W
    dy_dec = 180.0 / STAR_H
    for (r, d, m, c) in allstars:
        cosd = max(math.cos(math.radians(d)), 1e-3)
        reach_ra = min(180.0, STAR_REACH_DEG / cosd)
        y0 = int(math.floor((90.0 - (d + STAR_REACH_DEG)) / dy_dec))
        y1 = int(math.floor((90.0 - (d - STAR_REACH_DEG)) / dy_dec))
        x0 = int(math.floor((r - reach_ra) / dx_ra))
        x1 = int(math.floor((r + reach_ra) / dx_ra))
        for yy in range(max(0, y0), min(STAR_H - 1, y1) + 1):
            dec_c = 90.0 - (yy + 0.5) * dy_dec
            cosc = math.cos(math.radians(dec_c))
            for xx in range(x0, x1 + 1):
                xw = xx % STAR_W
                if texmag[yy, xw] <= m:
                    continue
                ra_c = (xx + 0.5) * dx_ra
                dra = (r - ra_c + 180.0) % 360.0 - 180.0
                east = dra * cosc
                north = d - dec_c
                if abs(east) > STAR_REACH_DEG or abs(north) > STAR_REACH_DEG:
                    continue
                if east * east + north * north > STAR_REACH_DEG ** 2 * 1.2:
                    continue
                texmag[yy, xw] = m
                tex[yy, xw, 0] = int(round((east / STAR_REACH_DEG * 0.5 + 0.5) * 255))
                tex[yy, xw, 1] = int(round((north / STAR_REACH_DEG * 0.5 + 0.5) * 255))
                tex[yy, xw, 2] = int(np.clip(round(1 + (m + 2.0) * 25.0), 1, 255))
                tex[yy, xw, 3] = int(np.clip(round((c + 0.4) / 2.4 * 255), 0, 255))
    Image.fromarray(tex, "RGBA").save(os.path.join(OUT, "stars.png"))
    print("stars.png (%d bright + %d procedural)" % (bright_n, ra.size))


# ============================================================================================ milky way
def smooth_interp(x, xp, fp):
    return np.interp(x, xp, fp, period=360.0)


def gen_milky_way():
    W, H = 2048, 1024
    ra = (np.arange(W) + 0.5) / W * 360.0
    dec = 90.0 - (np.arange(H) + 0.5) / H * 180.0
    RA, DEC = np.meshgrid(ra, dec, indexing="xy")
    l, b = eq_to_gal(RA, DEC)
    lw = (l + 180.0) % 360.0 - 180.0     # −180..180, 0 = galactic centre
    P = radec_to_vec(RA, DEC)            # noise on the sphere: no pole artefacts
    n1 = fbm3(P, 5, 5, 11, 0.55)         # large patches
    n2 = fbm3(P, 18, 4, 22, 0.55)        # star-cloud knots
    n3 = fbm3(P, 60, 3, 33, 0.5)         # fine graininess
    nd = fbm3(P, 9, 5, 44, 0.6)          # dark nebulae
    lp = [0, 15, 25, 35, 50, 65, 78, 95, 120, 150, 180, 210, 240, 270, 285, 300, 315, 330, 345, 360]
    ap = [1.0, 0.80, 0.85, 0.55, 0.45, 0.55, 0.62, 0.42, 0.34, 0.26, 0.20, 0.22, 0.26, 0.36, 0.55, 0.60, 0.58, 0.72, 0.85, 1.0]
    wp = [8.0, 6.0, 5.0, 4.5, 4.2, 4.6, 5.0, 4.4, 4.0, 3.6, 3.6, 3.8, 4.0, 4.5, 5.0, 5.0, 5.5, 6.2, 7.5, 8.0]
    amp = smooth_interp(l, lp, ap)
    wid = smooth_interp(l, lp, wp) * (1.0 + 0.35 * n1)
    core = np.exp(-0.5 * (b / wid) ** 2)
    halo = np.exp(-np.abs(b) / (wid * 3.0))
    disk = amp * (core * (0.55 + 0.9 * np.clip(n1 + 0.5, 0, 1.2) + 0.5 * n2) + 0.22 * halo * (1 + 0.5 * n1))
    bulge = 0.85 * np.exp(-((lw / 12.0) ** 2 + ((b + 3.0) / 8.5) ** 2)) * (0.8 + 0.4 * n2)
    clouds = 0.40 * np.exp(-(((lw - 27) / 4.5) ** 2 + ((b + 2.5) / 2.8) ** 2))        # Scutum
    clouds += 0.50 * np.exp(-(((lw - 2) / 5.0) ** 2 + ((b + 4.5) / 3.0) ** 2))         # Sagittarius
    clouds += 0.32 * np.exp(-(((lw - 75) / 6.5) ** 2 + ((b - 1.0) / 3.5) ** 2))        # Cygnus
    clouds += 0.18 * np.exp(-(((lw - 12) / 3.0) ** 2 + ((b + 1.0) / 2.0) ** 2))        # M24/M17 region
    bright = (disk + bulge + clouds) * (0.85 + 0.35 * n3)
    # dust: Great Rift (Cygnus → Aquila → Sagittarius), Ophiuchus, Taurus–Auriga, Cepheus, noise nebulae
    rift_b = np.interp(lw, [-10, 0, 20, 40, 60, 80, 95], [0.5, 2.0, 1.5, 0.8, 0.3, 1.5, 3.0])
    rift_w = np.interp(lw, [-10, 0, 20, 40, 60, 80, 95], [1.6, 3.0, 2.6, 2.4, 2.0, 2.2, 1.2])
    rift_on = np.interp(lw, [-20, -8, 0, 82, 95, 105], [0, 0.6, 0.95, 0.95, 0.5, 0])
    rift_w = rift_w * (1.0 + 0.5 * n2)
    dust = rift_on * np.exp(-0.5 * ((b - rift_b - 1.2 * n1) / rift_w) ** 2)
    dust += 0.75 * np.exp(-(((lw - 3) / 8.0) ** 2 + ((b - 13.0) / 5.5) ** 2))          # rho Oph / Pipe
    dust += 0.40 * np.exp(-(((lw - 172) / 12.0) ** 2 + ((b + 14.0) / 6.0) ** 2))        # Taurus
    dust += 0.30 * np.exp(-(((lw - 110) / 10.0) ** 2 + ((b - 12.0) / 5.0) ** 2))        # Cepheus flare
    dust += 0.9 * np.clip((nd - 0.05) / 0.35, 0, 1) * np.exp(-np.abs(b) / 7.0)
    dust = np.clip(dust * (0.75 + 0.5 * np.clip(n3 + 0.5, 0, 1)), 0, 2)
    bright = bright * np.exp(-2.4 * dust)

    def blob(ra0, dec0, a, bmin, pa, s):
        dra = ((RA - ra0 + 180) % 360 - 180) * np.cos(np.radians(dec0))
        ddec = DEC - dec0
        p = np.radians(pa)
        x = dra * np.sin(p) + ddec * np.cos(p)
        y = dra * np.cos(p) - ddec * np.sin(p)
        return s * np.exp(-0.5 * ((x / a) ** 2 + (y / bmin) ** 2)) * (np.abs(ddec) < 12)
    bright += blob(10.68, 41.27, 1.2, 0.35, 38, 0.30) + blob(10.68, 41.27, 0.22, 0.10, 38, 0.45)   # M31
    bright += blob(35.0, 57.1, 0.35, 0.3, 0, 0.22)        # h & chi Persei
    bright += blob(130.1, 19.7, 0.45, 0.45, 0, 0.12)      # Beehive
    bright += blob(83.8, -5.4, 0.25, 0.2, 0, 0.16)        # Orion Nebula
    bright = np.clip(bright, 0, None)
    bright /= np.percentile(bright, 99.97)
    bright = np.clip(bright, 0, 1)
    warm = np.array([1.0, 0.87, 0.70])
    cool = np.array([0.85, 0.90, 1.0])
    core_w = np.clip(np.exp(-(lw / 38.0) ** 2 - (b / 25.0) ** 2) * 1.15, 0, 1)[..., None]
    col = bright[..., None] * (warm * core_w + cool * (1 - core_w))
    col *= 1.0 - np.clip(dust, 0, 1)[..., None] * np.array([0.05, 0.10, 0.18])     # reddening
    col = np.clip(col, 0, 1)
    srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(col, 1 / 2.4) - 0.055)
    Image.fromarray((srgb * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(OUT, "milky_way.png"))
    print("milky_way.png")


# ============================================================================================ flakes & blue noise
def gen_flakes():
    n, cell = 256, 64
    rng = np.random.default_rng(5)
    img = np.zeros((n, n), np.float32)
    yy, xx = np.meshgrid(np.arange(cell) + 0.5, np.arange(cell) + 0.5, indexing="ij")
    for i in range(16):
        cx, cy = i % 4, i // 4
        a = np.zeros((cell, cell), np.float32)
        nblob = 1 if i < 5 else int(rng.integers(2, 6))
        for _ in range(nblob):
            ox = rng.normal(0, 5.5 if nblob > 1 else 0)
            oy = rng.normal(0, 5.5 if nblob > 1 else 0)
            r = rng.uniform(7, 13) if nblob > 1 else rng.uniform(12, 17)
            d = np.sqrt((xx - 32 - ox) ** 2 + (yy - 32 - oy) ** 2) / r
            a = np.maximum(a, np.clip(1 - d, 0, 1) ** 1.6)
        # soft outer glow + tiny crystalline sparkle texture
        a = np.clip(a * 1.15, 0, 1)
        img[cy * cell:(cy + 1) * cell, cx * cell:(cx + 1) * cell] = a
    rgba = np.zeros((n, n, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (img * 255 + 0.5).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "flakes.png"))
    print("flakes.png")


def gen_blue_noise():
    n = 64
    rng = np.random.default_rng(3)
    sigma = 1.5
    k = np.fft.fftfreq(n)
    KX, KY = np.meshgrid(k, k)
    gauss_f = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (KX ** 2 + KY ** 2))

    def energy(bits):
        return np.real(np.fft.ifft2(np.fft.fft2(bits) * gauss_f))

    total = n * n
    bits = np.zeros((n, n))
    init = rng.choice(total, total // 10, replace=False)
    bits.flat[init] = 1
    # relax initial pattern
    for _ in range(200):
        e = energy(bits)
        cluster = np.argmax(np.where(bits == 1, e, -1e9))
        bits.flat[cluster] = 0
        e = energy(bits)
        void = np.argmin(np.where(bits == 0, e, 1e9))
        if void == cluster:
            bits.flat[cluster] = 1
            break
        bits.flat[void] = 1
    rank = np.zeros(total, int)
    proto = bits.copy()
    ones = int(proto.sum())
    b = proto.copy()
    for r in range(ones - 1, -1, -1):
        e = energy(b)
        c = np.argmax(np.where(b == 1, e, -1e9))
        b.flat[c] = 0
        rank[c] = r
    b = proto.copy()
    for r in range(ones, total):
        e = energy(b)
        v = np.argmin(np.where(b == 0, e, 1e9))
        b.flat[v] = 1
        rank[v] = r
    img = (rank.reshape(n, n) * 256 // total).astype(np.uint8)
    Image.fromarray(img, "L").save(os.path.join(OUT, "blue_noise.png"))
    print("blue_noise.png")


if __name__ == "__main__":
    import sys
    todo = sys.argv[1:] or ["clouds", "moon", "stars", "milky_way", "flakes", "blue_noise"]
    for t in todo:
        globals()["gen_" + t]()

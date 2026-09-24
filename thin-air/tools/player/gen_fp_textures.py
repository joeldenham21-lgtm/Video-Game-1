#!/usr/bin/env python3
"""Seamless PBR texture sets for the first-person viewmodel (hands, tools) + particle sprites.

Deterministic (fixed seeds). Writes to thin-air/scenes/player/textures/:
  <set>_albedo.png, <set>_normal.png (OpenGL / Y+), <set>_orm.png (R occlusion, G roughness, B metallic)
Run from the repo root:  python3 thin-air/tools/player/gen_fp_textures.py
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "scenes", "player", "textures")
OUT = os.path.normpath(OUT)


# ----------------------------------------------------------------------------------------------
# Periodic noise helpers (FFT-filtered white noise tiles seamlessly by construction)

def spectral(n, beta, seed, sx=1.0, sy=1.0, lo=0.0, hi=1e9):
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((n, n))
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.fftfreq(n)[None, :] * n
    f = np.sqrt((fx * sx) ** 2 + (fy * sy) ** 2)
    f[0, 0] = 1.0
    filt = 1.0 / np.power(f, beta / 2.0)
    filt[(f < lo) | (f > hi)] = 0.0
    filt[0, 0] = 0.0
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def norm01(a):
    a = a - a.min()
    return a / max(a.max(), 1e-9)


def blur(a, r):
    """Periodic gaussian blur via FFT."""
    n = a.shape[0]
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    g = np.exp(-2.0 * (np.pi ** 2) * (r ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def normal_from_height(h, strength):
    # OpenGL convention: +Y (green) points "up" the image (toward row 0).
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], axis=-1)
    return ((n * 0.5 + 0.5) * 255.0).clip(0, 255).astype(np.uint8)


def cavity_ao(h, r=3.0, strength=1.2):
    b = blur(h, r)
    ao = 1.0 - np.clip((b - h) * strength * 4.0, 0.0, 1.0)
    return np.clip(ao, 0.0, 1.0)


def save_rgb(name, rgb, quality=90):
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255.0).astype(np.uint8), "RGB")
    if name.endswith(".jpg"):
        img.save(os.path.join(OUT, name), quality=quality, subsampling=0)
    else:
        img.save(os.path.join(OUT, name), optimize=True)


def save_rgba(name, rgba):
    Image.fromarray((np.clip(rgba, 0, 1) * 255.0).astype(np.uint8), "RGBA").save(os.path.join(OUT, name), optimize=True)


def save_set(prefix, albedo, height, rough, metal, nstrength, ao=None):
    # JPEG keeps the repo small; Godot re-encodes to VRAM formats on import anyway.
    save_rgb(prefix + "_albedo.jpg", albedo, 90)
    Image.fromarray(normal_from_height(height, nstrength), "RGB").save(
        os.path.join(OUT, prefix + "_normal.jpg"), quality=95, subsampling=0)
    if ao is None:
        ao = cavity_ao(height)
    orm = np.stack([ao, np.clip(rough, 0.03, 1.0), np.clip(metal, 0.0, 1.0)], axis=-1)
    save_rgb(prefix + "_orm.jpg", orm, 90)


def lerp_color(t, stops):
    """Map t (HxW 0..1) through colour stops [(pos, (r,g,b)), ...]."""
    t = np.clip(t, 0.0, 1.0)
    out = np.zeros(t.shape + (3,))
    pos = [s[0] for s in stops]
    cols = [np.array(s[1], dtype=float) for s in stops]
    for i in range(len(stops) - 1):
        a, b = pos[i], pos[i + 1]
        m = (t >= a) & (t <= b)
        k = ((t - a) / max(b - a, 1e-9))[..., None]
        out[m] = (cols[i] * (1 - k) + cols[i + 1] * k)[m]
    return out


def srgb(c):
    return tuple(x / 255.0 for x in c)


# ----------------------------------------------------------------------------------------------
# Sets

def wood(prefix, n, seed, dark, light, rough_base, knots=True):
    # Grain runs along V (rows) — lofted handles map V along their length.
    warp = spectral(n, 2.6, seed, sx=0.08, sy=1.0)            # slow wandering of the growth rings
    fine = spectral(n, 1.4, seed + 1, sx=0.15, sy=1.0)
    xx = np.mgrid[0:n, 0:n][1] / n
    ring_coord = xx * 14.0 + warp * 3.0 + fine * 0.35          # 14 growth rings across the tile
    frac = ring_coord - np.floor(ring_coord)
    latewood = np.exp(-((frac - 0.15) / 0.07) ** 2) + 0.35 * np.exp(-((frac - 0.55) / 0.18) ** 2)
    latewood = np.clip(latewood, 0, 1)
    pores = spectral(n, 0.2, seed + 2, sx=0.3, sy=1.0)
    pores = np.clip((pores - 0.72) / 0.28, 0, 1) * (0.4 + latewood * 0.6)
    t = np.clip(1.0 - latewood * 0.75 - fine * 0.25 + 0.15, 0, 1)
    if knots:
        yy, xx2 = np.mgrid[0:n, 0:n] / n
        rng = np.random.default_rng(seed + 9)
        for _ in range(2):
            cx, cy = rng.random(), rng.random()
            dx = np.minimum(np.abs(xx2 - cx), 1 - np.abs(xx2 - cx))
            dy = np.minimum(np.abs(yy - cy), 1 - np.abs(yy - cy))
            d = np.sqrt((dx * 3.0) ** 2 + (dy * 1.3) ** 2)
            k = np.exp(-(d * 30.0) ** 2)
            t = np.clip(t * (1 - k * 0.8), 0, 1)
    albedo = lerp_color(t, [(0.0, dark), (0.6, tuple((a + b) / 2 for a, b in zip(dark, light))), (1.0, light)])
    albedo *= (1.0 - pores[..., None] * 0.3)
    grime = spectral(n, 3.0, seed + 5)
    albedo *= (0.8 + 0.2 * grime[..., None])
    height = -latewood * 0.5 + fine * 0.4 - pores * 0.8
    rough = rough_base + 0.14 * latewood + 0.15 * pores
    save_set(prefix, albedo, height, rough, np.zeros_like(t), 5.0)


def steel(prefix, n, seed):
    base = spectral(n, 2.6, seed)
    mid = spectral(n, 1.6, seed + 1)
    # Hammer peen dimples: soft circular dents.
    rng = np.random.default_rng(seed + 2)
    yy, xx = np.mgrid[0:n, 0:n] / n
    dents = np.zeros((n, n))
    for _ in range(90):
        cx, cy, r = rng.random(), rng.random(), rng.uniform(0.02, 0.06)
        dx = np.minimum(np.abs(xx - cx), 1 - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), 1 - np.abs(yy - cy))
        d = np.sqrt(dx * dx + dy * dy) / r
        dents += np.clip(1 - d * d, 0, 1) ** 2
    scale = (spectral(n, 2.0, seed + 3) > 0.6).astype(float)
    scale = blur(scale, 1.5)
    t = norm01(base * 0.6 + mid * 0.4)
    albedo = lerp_color(t, [(0.0, srgb((46, 46, 48))), (0.5, srgb((78, 78, 80))), (1.0, srgb((104, 103, 101)))])
    albedo = albedo * (1 - scale[..., None] * 0.45) + np.array(srgb((58, 42, 34)))[None, None, :] * scale[..., None] * 0.3
    height = -dents * 0.5 + mid * 0.3 + scale * 0.2
    rough = 0.42 + 0.25 * scale + 0.12 * (1 - t)
    metal = 0.95 - 0.6 * scale
    save_set(prefix, albedo, height, rough, metal, 4.0)


def leather(prefix, n, seed, col_dark, col_light):
    cells = spectral(n, 1.0, seed, lo=40, hi=140)
    grain = np.abs(cells - 0.5) * 2.0
    grain = 1.0 - grain
    wrinkles = spectral(n, 2.8, seed + 1, sx=1.0, sy=0.35)
    creases = np.abs(spectral(n, 2.2, seed + 2) - 0.5) < 0.018
    creases = blur(creases.astype(float), 1.2)
    wear = spectral(n, 3.2, seed + 3)
    t = norm01(wrinkles * 0.5 + wear * 0.5)
    albedo = lerp_color(t, [(0.0, col_dark), (1.0, col_light)])
    albedo *= (0.9 + 0.1 * grain[..., None])
    albedo *= (1 - creases[..., None] * 0.35)
    # Scuffed high spots are lighter and drier.
    scuff = np.clip((wear - 0.62) * 3.0, 0, 1)
    albedo = albedo * (1 - scuff[..., None] * 0.35) + np.array(col_light)[None, None, :] * 1.25 * scuff[..., None] * 0.35
    height = grain * 0.35 + wrinkles * 0.5 - creases * 0.8
    rough = 0.62 + 0.18 * scuff - 0.08 * grain
    save_set(prefix, albedo, height, rough, np.zeros_like(t), 5.0)


def fabric(prefix, n, seed, weave=64, ripstop=8):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    k = 2 * np.pi * weave / n
    warp = (np.sin(xx * k) * 0.5 + 0.5)
    weft = (np.sin(yy * k) * 0.5 + 0.5)
    checker = (np.sin(xx * k * 0.5) * np.sin(yy * k * 0.5) > 0).astype(float)
    tex = warp * checker + weft * (1 - checker)
    grid = np.zeros((n, n))
    if ripstop:
        rk = 2 * np.pi * ripstop / n
        grid = np.clip((np.cos(xx * rk) - 0.985) * 40, 0, 1) + np.clip((np.cos(yy * rk) - 0.985) * 40, 0, 1)
        grid = np.clip(grid, 0, 1)
    folds = spectral(n, 3.0, seed)
    dirt = spectral(n, 2.4, seed + 1)
    t = 0.72 + 0.12 * tex + 0.1 * folds - 0.1 * grid
    albedo = np.stack([t, t, t], axis=-1) * (0.9 + 0.1 * dirt[..., None])
    height = tex * 0.5 + grid * 0.6 + folds * 0.8
    rough = 0.78 - 0.06 * tex
    save_set(prefix, albedo, height, rough, np.zeros_like(t), 2.4)


def knit(prefix, n, seed):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    ribs = np.abs(np.sin(xx * 2 * np.pi * 24 / n))
    loops = np.abs(np.sin((yy + np.sin(xx * 2 * np.pi * 48 / n) * 3) * 2 * np.pi * 40 / n))
    fuzz = spectral(n, 0.6, seed)
    h = ribs * 0.6 + loops * 0.3 + fuzz * 0.2
    t = 0.7 + 0.2 * ribs * loops + 0.1 * fuzz
    albedo = np.stack([t, t, t], axis=-1)
    save_set(prefix, albedo, h, 0.92 - 0.05 * ribs, np.zeros_like(t), 3.5)


def rubber(prefix, n, seed):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    # Diamond knurl for grips.
    a = np.sin((xx + yy) * 2 * np.pi * 20 / n)
    b = np.sin((xx - yy) * 2 * np.pi * 20 / n)
    knurl = np.clip(a * b, 0, 1)
    noise = spectral(n, 2.0, seed)
    t = 0.09 + 0.05 * noise + 0.03 * knurl
    albedo = np.stack([t, t, t * 1.05], axis=-1)
    save_set(prefix, albedo, knurl * 0.7 + noise * 0.3, 0.72 - 0.1 * knurl, np.zeros_like(t), 3.0)


def aluminium(prefix, n, seed):
    brushed = spectral(n, 1.4, seed, sx=0.02, sy=1.0)
    scratches = spectral(n, 0.4, seed + 1, sx=1.0, sy=0.03)
    scratches = np.clip((scratches - 0.8) * 5, 0, 1)
    t = 0.75 + 0.15 * brushed + 0.1 * scratches
    albedo = np.stack([t, t, t], axis=-1)
    save_set(prefix, albedo, brushed * 0.3 - scratches * 0.3, 0.32 + 0.12 * brushed - 0.1 * scratches, np.full_like(t, 1.0), 1.0)


def plastic(prefix, n, seed):
    stipple = spectral(n, 0.2, seed)
    wear = spectral(n, 3.0, seed + 1)
    t = 0.85 + 0.1 * stipple + 0.05 * wear
    albedo = np.stack([t, t, t], axis=-1)
    scuff = np.clip((wear - 0.7) * 3, 0, 1)
    save_set(prefix, albedo * (1 - 0.15 * scuff[..., None]), stipple * 0.4, 0.55 + 0.15 * stipple + 0.2 * scuff, np.zeros_like(t), 1.2)


def canvas(prefix, n, seed):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    k = 2 * np.pi * 96 / n
    tex = (np.sin(xx * k) * np.sin(yy * k)) * 0.5 + 0.5
    slub = spectral(n, 1.2, seed, sx=1.0, sy=0.1)
    dirt = spectral(n, 2.6, seed + 1)
    t = 0.8 + 0.1 * tex + 0.1 * slub - 0.12 * dirt
    albedo = np.stack([t, t * 0.97, t * 0.9], axis=-1)
    save_set(prefix, albedo, tex * 0.6 + slub * 0.4, 0.88 + 0.05 * dirt, np.zeros_like(t), 2.6)


def topo_map(name, n, seed):
    """A believable 1:50,000 topographic sheet: contours, forest tint, glacier, river, grid, margins."""
    h = spectral(n, 3.4, seed)
    h = norm01(blur(h, 3.0))
    paper = np.array(srgb((236, 230, 212)))
    img = np.ones((n, n, 3)) * paper
    forest = (h < 0.45) & (spectral(n, 2.5, seed + 1) > 0.42)
    img[forest] = img[forest] * 0.5 + np.array(srgb((196, 222, 176))) * 0.5
    glacier = h > 0.78
    img[glacier] = img[glacier] * 0.3 + np.array(srgb((236, 244, 250))) * 0.7
    lvl = h * 40.0
    frac = np.abs(lvl - np.round(lvl))
    contour = np.clip(1 - frac / 0.06, 0, 1)
    index = (np.round(lvl) % 5 == 0) & (frac < 0.09)
    brown = np.array(srgb((160, 105, 60)))
    blue_c = np.array(srgb((70, 130, 190)))
    img = img * (1 - contour[..., None] * 0.55) + brown * contour[..., None] * 0.55
    img[index] = img[index] * 0.3 + brown * 0.7
    glc = glacier & (contour > 0.3)
    img[glc] = img[glc] * 0.4 + blue_c * 0.6
    # River along the valley bottom.
    water = h < 0.14
    img[water] = np.array(srgb((150, 196, 228)))
    # UTM-style grid.
    yy, xx = np.mgrid[0:n, 0:n]
    grid = ((xx % (n // 8)) < 2) | ((yy % (n // 8)) < 2)
    img[grid] = img[grid] * 0.55 + np.array(srgb((40, 90, 160))) * 0.45
    # Margins, folds, creases, wear.
    m = n // 28
    img[:m, :] = paper; img[-m:, :] = paper; img[:, :m] = paper; img[:, -m:] = paper
    fold = (np.abs(xx - n // 2) < 2) | (np.abs(yy - n // 2) < 2) | (np.abs(xx - n // 4) < 1) | (np.abs(xx - 3 * n // 4) < 1)
    img[fold] *= 0.86
    stain = spectral(n, 3.0, seed + 7)
    img *= (0.92 + 0.08 * stain[..., None])
    save_rgb(name, img, 88)


def screen_grid(name, n):
    """Scanner display base: dark glass with a faint grid."""
    yy, xx = np.mgrid[0:n, 0:n]
    g = ((xx % 32) == 0) | ((yy % 32) == 0)
    img = np.zeros((n, n, 3)) + np.array([0.02, 0.05, 0.05])
    img[g] = [0.05, 0.16, 0.14]
    save_rgb(name, img)


def flame_sprite(name, w, h, seed):
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = (xx + 0.5) / w * 2 - 1
    v = 1 - (yy + 0.5) / h            # 0 bottom .. 1 top
    noise = spectral(max(w, h), 1.8, seed)[:h, :w]
    width = 0.55 * np.clip(1 - v, 0, 1) ** 0.6 * (0.8 + 0.4 * np.sin(v * 3.1))
    d = np.abs(u + (noise - 0.5) * 0.25 * v) / np.maximum(width, 1e-3)
    a = np.clip(1 - d, 0, 1) ** 1.3 * np.clip(v * 6, 0, 1) * np.clip((1 - v) * 1.4, 0, 1)
    a *= 0.75 + 0.25 * noise
    core = np.clip(1 - d * 1.6, 0, 1) * np.clip(1 - v * 1.3, 0, 1)
    rgb = np.stack([np.ones_like(a), 0.55 + 0.45 * core, 0.2 + 0.6 * core], axis=-1)
    save_rgba(name, np.concatenate([rgb, a[..., None]], axis=-1))


def smoke_sprite(name, n, seed):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    u = (xx + 0.5) / n * 2 - 1
    v = (yy + 0.5) / n * 2 - 1
    r = np.sqrt(u * u + v * v)
    noise = spectral(n, 2.2, seed)
    a = np.clip(1 - r, 0, 1) ** 1.5 * (0.45 + 0.55 * noise)
    a = np.clip(a * 1.3, 0, 1)
    rgb = np.ones((n, n, 3)) * (0.85 + 0.15 * noise[..., None])
    save_rgba(name, np.concatenate([rgb, a[..., None]], axis=-1))


def spark_sprite(name, n):
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    u = (xx + 0.5) / n * 2 - 1
    v = (yy + 0.5) / n * 2 - 1
    r = np.sqrt(u * u + v * v)
    a = np.exp(-(r * 3.2) ** 2)
    rgb = np.ones((n, n, 3))
    save_rgba(name, np.concatenate([rgb, a[..., None]], axis=-1))


def main():
    os.makedirs(OUT, exist_ok=True)
    wood("wood_ash", 512, 11, srgb((122, 90, 58)), srgb((196, 160, 112)), 0.5)
    wood("wood_dark", 512, 23, srgb((58, 36, 22)), srgb((122, 82, 50)), 0.45)
    wood("wood_raw", 512, 31, srgb((84, 66, 50)), srgb((150, 126, 98)), 0.78, knots=True)
    steel("steel", 512, 41)
    leather("leather", 512, 51, srgb((98, 70, 44)), srgb((168, 128, 84)))
    leather("leather_dark", 512, 57, srgb((34, 26, 20)), srgb((74, 56, 40)))
    fabric("fabric", 512, 61, weave=32, ripstop=4)
    knit("knit", 512, 71)
    rubber("rubber", 512, 81)
    aluminium("aluminium", 512, 91)
    plastic("plastic", 512, 101)
    canvas("canvas", 512, 111)
    topo_map("map_albedo.jpg", 1024, 121)
    screen_grid("screen_albedo.png", 128)
    flame_sprite("flame.png", 64, 128, 131)
    smoke_sprite("smoke.png", 128, 141)
    spark_sprite("spark.png", 32)
    print("wrote textures to", OUT)


if __name__ == "__main__":
    main()

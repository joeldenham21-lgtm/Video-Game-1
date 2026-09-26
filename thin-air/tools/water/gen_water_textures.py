#!/usr/bin/env python3
"""THIN AIR — water textures (deterministic, re-runnable).

    python3.12 thin-air/tools/water/gen_water_textures.py [--preview]

Writes assets/textures/water/:
  water_ripple_a_normal.png  512² tangent-space normal (OpenGL Y+), wind waves: directional spectrum,
                             wavelengths ~1/40..1/3 of the tile (the shader tiles it at ~9 m)
  water_ripple_b_normal.png  512² capillary / cat's-paw ripples, near-isotropic, short wavelengths
                             (the shader tiles it at ~2.3 m and scrolls it across the first map)
  water_foam.png             512² R = foam/bubble lattice (Worley edges x fBm), G = streak noise for
                             flow-stretched river foam, B = soft cloud noise (rime/skim-ice mottling), A = 1
  water_mist.png             128² RGBA soft spray puff for waterfall mist particles
All maps are exactly periodic (built in the Fourier domain / on a torus), so they tile seamlessly.
"""
import argparse
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "assets", "textures", "water")
N = 512


def spectrum_height(n, seed, k_peak, k_lo, k_hi, wind_dir, directional, power=3.5):
    """Periodic height field from a Phillips-like wave spectrum (k in cycles per tile)."""
    rng = np.random.default_rng(seed)
    kx = np.fft.fftfreq(n, 1.0 / n)
    kz = np.fft.fftfreq(n, 1.0 / n)
    KX, KZ = np.meshgrid(kx, kz)
    k = np.sqrt(KX ** 2 + KZ ** 2)
    k[0, 0] = 1.0
    # Phillips-ish: exp(-(kp/k)^2) / k^power, band-limited
    amp = np.exp(-(k_peak / k) ** 2) / k ** power
    amp *= np.exp(-(k / k_hi) ** 2)
    amp[k < k_lo] = 0.0
    if directional > 0.0:
        c = (KX * wind_dir[0] + KZ * wind_dir[1]) / k
        spread = np.abs(c) ** (2.0 * directional) * 0.85 + 0.15
        amp *= spread
    amp[0, 0] = 0.0
    phase = rng.uniform(0, 2 * np.pi, (n, n))
    g = rng.normal(size=(n, n))
    F = np.sqrt(amp) * g * np.exp(1j * phase)
    h = np.real(np.fft.ifft2(F))
    # derivatives in the Fourier domain (exactly periodic)
    dhdx = np.real(np.fft.ifft2(F * 2j * np.pi * KX / n))
    dhdz = np.real(np.fft.ifft2(F * 2j * np.pi * KZ / n))
    return h, dhdx, dhdz


def to_normal_png(dhdx, dhdz, slope_rms_target):
    s = np.sqrt(np.mean(dhdx ** 2 + dhdz ** 2))
    dx = dhdx / s * slope_rms_target
    dz = dhdz / s * slope_rms_target
    # tangent-space normal: +X right (u), +Y up in the image = -v (OpenGL); heightfield normal (-dh/dx, -dh/dv, 1)
    nx = -dx
    ny = dz            # image v grows downward; OpenGL convention flips it
    nz = np.ones_like(nx)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
    return (np.clip(rgb, 0, 1) * 255.0 + 0.5).astype(np.uint8)


def periodic_noise(n, seed, k_lo, k_hi, power=2.0):
    rng = np.random.default_rng(seed)
    kx = np.fft.fftfreq(n, 1.0 / n)
    KX, KZ = np.meshgrid(kx, kx)
    k = np.sqrt(KX ** 2 + KZ ** 2)
    k[0, 0] = 1.0
    amp = 1.0 / k ** power
    amp[(k < k_lo) | (k > k_hi)] = 0.0
    amp[0, 0] = 0.0
    F = np.sqrt(amp) * (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n)))
    h = np.real(np.fft.ifft2(F))
    h -= h.min()
    return h / max(h.max(), 1e-9)


def periodic_worley_edges(n, cells, seed):
    """Distance to the cell border (F2 - F1) on a torus: bright thin bubble walls."""
    rng = np.random.default_rng(seed)
    pts = rng.uniform(0, 1, (cells, 2))
    ys, xs = np.mgrid[0:n, 0:n] / float(n)
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    for p in pts:
        dx = np.abs(xs - p[0]); dx = np.minimum(dx, 1.0 - dx)
        dy = np.abs(ys - p[1]); dy = np.minimum(dy, 1.0 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        m = d < f1
        f2 = np.where(m, f1, np.minimum(f2, d))
        f1 = np.where(m, d, f1)
    e = (f2 - f1) * np.sqrt(cells)
    return np.clip(e, 0, 1)


def gen_foam(n):
    walls_big = 1.0 - np.clip(periodic_worley_edges(n, 90, 11) / 0.16, 0, 1)
    walls_small = 1.0 - np.clip(periodic_worley_edges(n, 420, 12) / 0.2, 0, 1)
    fbm = periodic_noise(n, 13, 2, 90, 1.6)
    fbm2 = periodic_noise(n, 14, 4, 160, 1.2)
    foam = np.clip((walls_big * 0.7 + walls_small * 0.55) * (0.35 + fbm) + (fbm2 - 0.5) * 0.35, 0, 1)
    foam = np.clip((foam - 0.12) / 0.8, 0, 1) ** 1.1
    # streaks: noise stretched along +v (river flow axis in UV space), still periodic
    rng = np.random.default_rng(15)
    kx = np.fft.fftfreq(n, 1.0 / n)
    KX, KZ = np.meshgrid(kx, kx)
    amp = np.exp(-(KZ / 3.0) ** 2) * np.exp(-(KX / 70.0) ** 2) / (1.0 + np.abs(KX)) ** 0.6
    amp[0, 0] = 0
    F = amp * (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n)))
    st = np.real(np.fft.ifft2(F))
    st = (st - st.min()) / (st.max() - st.min())
    cloud = periodic_noise(n, 16, 1, 40, 2.2)
    rgba = np.stack([foam, st, cloud, np.ones_like(foam)], -1)
    return (rgba * 255 + 0.5).astype(np.uint8)


def gen_mist(n=128):
    ys, xs = (np.mgrid[0:n, 0:n] + 0.5) / n * 2.0 - 1.0
    r = np.sqrt(xs ** 2 + ys ** 2)
    base = np.clip(1.0 - r, 0, 1) ** 1.6
    nz = periodic_noise(n, 21, 2, 24, 1.8)
    a = np.clip(base * (0.55 + 0.9 * nz) - 0.05, 0, 1)
    a = a / max(a.max(), 1e-6)
    rgb = np.ones((n, n, 3)) * np.array([0.94, 0.96, 0.98])
    rgba = np.concatenate([rgb, a[..., None]], -1)
    return (rgba * 255 + 0.5).astype(np.uint8)


def write_import(path, normal=False, mipmaps=True, vram=True):
    """Godot import settings: VRAM compressed + mipmaps (BC5/RGTC for normal maps)."""
    src = "res://" + os.path.relpath(path, ROOT).replace(os.sep, "/")
    txt = f"""[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="{src}"

[params]

compress/mode={2 if vram else 0}
compress/high_quality=false
compress/lossy_quality=0.7
compress/uastc_level=0
compress/rdo_quality_loss=0.0
compress/hdr_compression=1
compress/normal_map={1 if normal else 2}
compress/channel_pack=0
mipmaps/generate={'true' if mipmaps else 'false'}
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/channel_remap/red=0
process/channel_remap/green=1
process/channel_remap/blue=2
process/channel_remap/alpha=3
process/fix_alpha_border=true
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
"""
    ipath = path + ".import"
    if os.path.exists(ipath):
        # keep an existing uid line so references stay stable
        old = open(ipath).read()
        for line in old.splitlines():
            if line.startswith("uid="):
                txt = txt.replace('type="CompressedTexture2D"\n', 'type="CompressedTexture2D"\n' + line + "\n", 1)
                break
    with open(ipath, "w") as f:
        f.write(txt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="also write a contact sheet to tools/water/_cache")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    wind = np.array([0.8, 0.6])
    _, ax, az = spectrum_height(N, 1, k_peak=9.0, k_lo=2.0, k_hi=120.0, wind_dir=wind, directional=1.5)
    # add a weaker cross-sea so it never reads as corduroy
    _, bx, bz = spectrum_height(N, 2, k_peak=14.0, k_lo=3.0, k_hi=150.0, wind_dir=np.array([-0.5, 0.86]),
                                directional=1.0)
    a_img = to_normal_png(ax + 0.45 * bx, az + 0.45 * bz, 0.30)
    _, cx, cz = spectrum_height(N, 3, k_peak=30.0, k_lo=8.0, k_hi=220.0, wind_dir=wind, directional=0.35,
                                power=3.0)
    b_img = to_normal_png(cx, cz, 0.26)
    foam = gen_foam(N)
    mist = gen_mist()
    files = {
        "water_ripple_a_normal.png": (a_img, True),
        "water_ripple_b_normal.png": (b_img, True),
        "water_foam.png": (foam, False),
        "water_mist.png": (mist, False),
    }
    for name, (img, is_normal) in files.items():
        p = os.path.join(OUT, name)
        Image.fromarray(img).save(p, optimize=True)
        write_import(p, normal=is_normal, vram=True)
        print("wrote", os.path.relpath(p, ROOT), img.shape)
    if args.preview:
        cache = os.path.join(HERE, "_cache")
        os.makedirs(cache, exist_ok=True)
        tiles = [a_img, b_img, foam[..., :3], np.repeat(foam[..., 1:2], 3, -1)]
        sheet = np.concatenate([np.concatenate([t, t], 0) for t in tiles], 1)
        Image.fromarray(sheet).resize((sheet.shape[1] // 2, sheet.shape[0] // 2)).save(os.path.join(cache, "sheet.jpg"))
        print("preview", os.path.join(cache, "sheet.jpg"))


if __name__ == "__main__":
    main()

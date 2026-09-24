#!/usr/bin/env python3
"""THIN AIR — procedural PBR textures for items, props and the campfire FX.

Deterministic (seeded) and re-runnable. Writes into thin-air/scenes/items/materials/tex/ and
thin-air/scenes/items/fx/, plus Godot .import files (VRAM compressed + mipmaps; normal maps flagged).

    python3 thin-air/tools/icons/gen_item_textures.py            # everything
    python3 thin-air/tools/icons/gen_item_textures.py bark knit  # only some sets

Conventions: tileable unless noted, 512x512, sRGB albedo, OpenGL (Y+) normal maps,
ORM = R ambient occlusion, G roughness, B metallic (Godot ORMMaterial3D / glTF).
"""
import os, sys, math, zlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "scenes", "items", "materials", "tex")
FX = os.path.join(ROOT, "scenes", "items", "fx")
FONTS = os.path.join(ROOT, "assets", "fonts")
N = 512

# ------------------------------------------------------------------------------------------ noise kit

def rng(seed):
    return np.random.default_rng(seed)


def spectral(n, seed, beta=2.0, lo=1.0, hi=None, aniso=(1.0, 1.0), m=None):
    """Tileable noise via FFT with a 1/f^beta power spectrum, band-limited to [lo, hi] cycles/tile.
    aniso scales frequencies per axis (x, y): aniso=(1, 8) stretches features 8x along y (vertical streaks).
    Returns float array normalised to 0..1."""
    m = m or n
    r = rng(seed)
    white = r.standard_normal((m, n))
    F = np.fft.fft2(white)
    fy = np.fft.fftfreq(m) * m
    fx = np.fft.fftfreq(n) * n
    FX, FY = np.meshgrid(fx, fy)
    rad = np.sqrt((FX * aniso[0]) ** 2 + (FY * aniso[1]) ** 2)
    amp = np.where(rad < 1e-6, 0.0, 1.0 / np.maximum(rad, 1e-6) ** (beta / 2.0))
    amp = np.where(rad < lo, amp * (rad / lo) ** 4, amp)
    if hi is not None:
        amp = np.where(rad > hi, amp * np.exp(-((rad - hi) / (0.25 * hi + 1e-6)) ** 2), amp)
    out = np.real(np.fft.ifft2(F * amp))
    return norm(out)


def norm(a):
    a = a - a.min()
    mx = a.max()
    return a / mx if mx > 0 else a


def worley(n, count, seed, aniso=(1.0, 1.0), m=None):
    """Tileable cellular noise. Returns (F1, F2, cell_id) with distances in pixels."""
    m = m or n
    r = rng(seed)
    pts = r.random((count, 2)) * np.array([n, m])
    yy, xx = np.mgrid[0:m, 0:n].astype(np.float32)
    f1 = np.full((m, n), 1e9, np.float32)
    f2 = np.full((m, n), 1e9, np.float32)
    cid = np.zeros((m, n), np.int32)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xx - px)
        dx = np.minimum(dx, n - dx) * aniso[0]
        dy = np.abs(yy - py)
        dy = np.minimum(dy, m - dy) * aniso[1]
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, i, cid)
        f1 = np.where(closer, d, f1)
    return f1, f2, cid


def warp(a, dx, dy):
    """Tileable domain warp by per-pixel offsets (pixels)."""
    m, n = a.shape
    yy, xx = np.mgrid[0:m, 0:n]
    x = (xx + dx).astype(np.int64) % n
    y = (yy + dy).astype(np.int64) % m
    return a[y, x]


def blur(a, px):
    im = Image.fromarray((np.clip(a, 0, 1) * 65535).astype(np.uint16))
    # wrap-around blur: tile 3x3, blur, crop
    m, n = a.shape
    big = np.tile(a, (3, 3))
    imb = Image.fromarray((np.clip(big, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(px))
    out = np.asarray(imb, np.float32)[m:2 * m, n:2 * n] / 255.0
    return out


def blur_f(a, px):
    """Float precision wrap-around gaussian blur via FFT."""
    m, n = a.shape
    fy = np.fft.fftfreq(m)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * (px ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    gr = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -gx * strength
    ny = gr * strength          # OpenGL: +Y is "up" in texture space (rows grow downward)
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1)


def ao_from_height(h, radius=6.0, strength=1.2):
    low = blur_f(h, radius)
    occ = np.clip(1.0 - (low - h) * strength * 4.0, 0.0, 1.0)
    return occ


def lerp(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) == np.ndim(a) - 1 or (np.ndim(t) == 2 and np.ndim(a) == 3) else t
    return a + (b - a) * t


def col(*rgb):
    return np.array(rgb, np.float32)


def ramp(t, stops):
    """t: HxW 0..1 ; stops: [(pos, (r,g,b)), ...] -> HxWx3 (linear interpolation in sRGB space)."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    ps = [s[0] for s in stops]
    cs = [np.array(s[1], np.float32) for s in stops]
    for c in range(3):
        out[..., c] = np.interp(t, ps, [x[c] for x in cs])
    return out


def save_rgb(path, rgb, alpha=None):
    """PNG when there is alpha, otherwise high-quality 4:4:4 JPEG (the repo stays small; Godot re-encodes to
    VRAM formats on import anyway)."""
    rgb8 = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    if alpha is not None:
        a8 = (np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(np.dstack([rgb8, a8]), "RGBA").save(path, optimize=True)
    elif path.endswith(".jpg"):
        Image.fromarray(rgb8, "RGB").save(path, quality=92, subsampling=0)
    else:
        Image.fromarray(rgb8, "RGB").save(path, optimize=True)


def ext_for(alpha):
    return ".png" if alpha is not None else ".jpg"


def save_normal(path, nrm):
    save_rgb(path, nrm * 0.5 + 0.5)


def save_orm(path, ao, rough, metal):
    save_rgb(path, np.stack([ao, rough, metal], -1))


def write_import(path, normal=False, lossless=False, mipmaps=True):
    mode = 0 if lossless else 2
    with open(path + ".import", "w") as f:
        f.write('[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\n\n[params]\n\n')
        f.write("compress/mode=%d\n" % mode)
        f.write("compress/high_quality=false\n")
        f.write("compress/normal_map=%d\n" % (1 if normal else 2))
        f.write("mipmaps/generate=%s\n" % ("true" if mipmaps else "false"))
        f.write("roughness/mode=0\n")
        f.write("process/fix_alpha_border=true\n")
        f.write("detect_3d/compress_to=0\n")


def out_set(name, albedo, normal=None, orm=None, alpha=None):
    os.makedirs(TEX, exist_ok=True)
    p = os.path.join(TEX, name + "_albedo" + ext_for(alpha))
    save_rgb(p, albedo, alpha)
    write_import(p)
    if normal is not None:
        p = os.path.join(TEX, name + "_normal.jpg")
        save_normal(p, normal)
        write_import(p, normal=True)
    if orm is not None:
        p = os.path.join(TEX, name + "_orm.jpg")
        save_rgb(p, orm)
        write_import(p)
    print("tex", name)


def orm_stack(ao, rough, metal):
    return np.stack([ao, rough, metal], -1)


def font(size, weight="SemiBold"):
    path = os.path.join(FONTS, "IBMPlexSans-%s.ttf" % weight)
    return ImageFont.truetype(path, size)


def mono(size):
    return ImageFont.truetype(os.path.join(FONTS, "IBMPlexMono-Medium.ttf"), size)

# ------------------------------------------------------------------------------------------ wood

def gen_bark():
    """Conifer (spruce/fir) bark along V: vertical furrows between ridges of small flaking scales; grey-brown
    crests, dark furrows, reddish inner bark where scales have flaked; a little lichen."""
    rid = spectral(N, 11, beta=2.6, lo=4, aniso=(1.0, 7.0))
    ridges = np.clip((1.0 - np.abs(rid * 2 - 1)) * 1.5 - 0.2, 0, 1)        # 1 on crests, 0 in furrows
    f1, f2, cid = worley(N, 900, 12, aniso=(1.0, 0.75))
    cell_edge = np.clip((f2 - f1) / 3.5, 0, 1)
    dome = 1.0 - np.clip(f1 / 11.0, 0, 1)
    cr = rng(14).random(900)[cid]
    flaked = (cr > 0.94).astype(np.float32) * ridges
    detail = spectral(N, 13, beta=1.4, lo=20)
    streak = spectral(N, 15, beta=2.2, lo=2, aniso=(1.0, 5.0))
    h = 0.55 * ridges + 0.22 * dome * np.sqrt(cell_edge) * (0.3 + 0.7 * ridges) + 0.1 * detail + 0.08 * streak - 0.12 * flaked
    crest = ramp(cr * 0.5 + detail * 0.3 + streak * 0.2, [(0, (0.25, 0.21, 0.18)), (0.5, (0.36, 0.31, 0.27)), (1, (0.46, 0.41, 0.36))])
    furrow = col(0.11, 0.07, 0.05)
    inner = col(0.38, 0.24, 0.17)
    t = np.clip(ridges * 1.3, 0, 1)[..., None]
    alb = furrow * (1 - t) + crest * t
    alb = alb * (0.72 + 0.28 * np.sqrt(cell_edge))[..., None]
    alb = alb * (1 - flaked[..., None]) + inner * (0.8 + 0.4 * detail[..., None]) * flaked[..., None]
    lichen = np.clip((spectral(N, 16, beta=2.4, lo=3) - 0.66) * 5.0, 0, 1) * ridges
    alb = alb * (1 - lichen[..., None] * 0.5) + col(0.55, 0.58, 0.48) * lichen[..., None] * 0.5
    ao = ao_from_height(h, 5, 1.6)
    rough = np.clip(0.84 + 0.12 * (1 - ridges) - 0.08 * lichen, 0, 1)
    out_set("bark", alb * ao[..., None] ** 0.5, normal_from_height(h, 8.0), orm_stack(ao, rough, np.zeros_like(h)))


def wood_grain(seed, rings=22.0):
    """Longitudinal grain along V (image rows): returns height/pattern 0..1."""
    wv = spectral(N, seed, beta=3.6, lo=1, aniso=(1.0, 3.0)) - 0.5
    fibers = spectral(N, seed + 1, beta=1.2, lo=16, aniso=(1.0, 20.0))
    x = np.linspace(0, 1, N, endpoint=False)[None, :].repeat(N, 0)
    phase = (x * rings + wv * 2.2 + fibers * 0.15) % 1.0
    late = np.clip((phase - 0.62) / 0.3, 0, 1) ** 1.5 * np.clip((1.0 - phase) / 0.08, 0, 1)
    return late, fibers, wv


def gen_wood():
    """Split/shaved spruce: pale, straight grain with darker latewood lines."""
    late, fibers, wv = wood_grain(21, 18.0)
    mottled = spectral(N, 24, beta=2.2, lo=2, aniso=(1.0, 3.0))
    alb = ramp(0.55 * (1 - late) + 0.25 * fibers + 0.2 * mottled,
               [(0, (0.50, 0.36, 0.22)), (0.55, (0.72, 0.58, 0.40)), (1, (0.84, 0.72, 0.54))])
    h = 0.5 * fibers + 0.25 * (1 - late) + 0.25 * mottled
    ao = ao_from_height(h, 3, 0.6)
    rough = np.clip(0.62 + 0.18 * late + 0.1 * fibers, 0, 1)
    out_set("wood", alb, normal_from_height(h, 2.2), orm_stack(ao, rough, np.zeros_like(h)))


def gen_endgrain():
    """Log end: sawn/axe-cut spruce rings, radial checking, darker heartwood. Not tileable (planar on caps)."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cx = cy = N / 2
    ang = np.arctan2(yy - cy, xx - cx)
    wob = spectral(N, 31, beta=3.2, lo=1) - 0.5
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (N / 2) + wob * 0.05
    rings = (r * 26.0) % 1.0
    late = np.clip((rings - 0.78) / 0.14, 0, 1) * np.clip((1.0 - rings) / 0.08, 0, 1)
    fine = spectral(N, 32, beta=1.4, lo=30)
    heart = np.clip(1.0 - r * 1.6, 0, 1)
    base = ramp(0.6 * (1 - late) + 0.25 * fine + 0.15 * (1 - heart),
                [(0, (0.46, 0.33, 0.20)), (0.5, (0.70, 0.56, 0.37)), (1, (0.82, 0.70, 0.52))])
    base = base * (1 - heart[..., None] * 0.25) + col(0.55, 0.36, 0.2) * heart[..., None] * 0.25
    # radial drying checks
    chk = np.zeros_like(r)
    rs = rng(33)
    for _ in range(7):
        a0 = rs.uniform(-math.pi, math.pi)
        da = np.angle(np.exp(1j * (ang - a0)))
        width = 0.006 + 0.004 * rs.random()
        chk = np.maximum(chk, np.clip(1 - np.abs(da) / width, 0, 1) * np.clip((r - 0.35) * 2.0, 0, 1))
    saw = (np.sin((xx + yy * 0.2) * 0.9 + wob * 20) * 0.5 + 0.5) * 0.08
    alb = base * (1 - chk[..., None] * 0.8) * (0.95 + saw[..., None])
    rim = np.clip((r - 0.93) / 0.07, 0, 1)
    alb = alb * (1 - rim[..., None]) + col(0.28, 0.2, 0.14) * rim[..., None]
    h = 0.6 * (1 - late) + 0.3 * fine - chk * 0.8 + saw
    ao = ao_from_height(h, 3, 0.8)
    rough = np.clip(0.8 + 0.1 * late, 0, 1)
    out_set("endgrain", alb, normal_from_height(h, 2.0), orm_stack(ao, rough, np.zeros_like(h)))


def gen_charred():
    """Burnt wood: black alligator char with grey ash edges; emission mask for glowing embers."""
    f1, f2, cid = worley(N, 90, 41, aniso=(1.0, 0.55))
    crack = np.clip(1.0 - (f2 - f1) / 6.0, 0, 1) ** 2
    detail = spectral(N, 42, beta=1.8, lo=6)
    h = (1 - crack) * 0.8 + detail * 0.2
    ash = np.clip((spectral(N, 43, beta=2.0, lo=2) - 0.55) * 3.0, 0, 1)
    alb = ramp(detail, [(0, (0.025, 0.022, 0.02)), (1, (0.075, 0.065, 0.058))])
    alb = alb * (1 - ash[..., None]) + col(0.42, 0.40, 0.38) * ash[..., None] * (0.6 + 0.4 * detail[..., None])
    alb = alb * (1 - crack[..., None] * 0.7)
    ao = ao_from_height(h, 4, 1.0)
    rough = np.clip(0.88 + 0.1 * ash, 0, 1)
    out_set("charred", alb, normal_from_height(h, 6.0), orm_stack(ao, rough, np.zeros_like(h)))
    glow = crack * np.clip(spectral(N, 44, beta=2.0, lo=2) * 1.6 - 0.35, 0, 1) * (1 - ash)
    glow_rgb = ramp(glow, [(0, (0, 0, 0)), (0.4, (0.55, 0.08, 0.0)), (0.8, (1.0, 0.35, 0.05)), (1, (1.0, 0.7, 0.3))])
    p = os.path.join(TEX, "charred_emission.jpg")
    save_rgb(p, glow_rgb)
    write_import(p)

# ------------------------------------------------------------------------------------------ stone

def gen_granite():
    """River granite: interlocking crystals (grey quartz, white and pink feldspar, black biotite), soft
    weathering stains, water-polished."""
    f1, f2, cid = worley(N, 4200, 55)
    grain = spectral(N, 51, beta=0.6, lo=60)
    mid = spectral(N, 52, beta=1.8, lo=6)
    big = spectral(N, 53, beta=2.6, lo=1)
    mineral = rng(56).random(4200)[cid]
    shade = rng(57).random(4200)[cid]
    biotite = (mineral < 0.12).astype(np.float32)
    pink = ((mineral >= 0.12) & (mineral < 0.24)).astype(np.float32)
    quartz = ((mineral >= 0.24) & (mineral < 0.5)).astype(np.float32)
    base = ramp(0.6 * big + 0.4 * mid, [(0, (0.50, 0.49, 0.47)), (1, (0.66, 0.65, 0.62))])
    xtal = base * (0.92 + 0.16 * shade[..., None])
    xtal = xtal * (1 - biotite[..., None] * 0.8) + col(0.08, 0.08, 0.08) * biotite[..., None] * 0.8
    xtal = xtal * (1 - quartz[..., None] * 0.35) + col(0.44, 0.44, 0.45) * quartz[..., None] * 0.35
    xtal = xtal * (1 - pink[..., None] * 0.35) + col(0.70, 0.58, 0.53) * pink[..., None] * 0.35
    for c in range(3):
        xtal[..., c] = blur_f(xtal[..., c], 0.7)
    alb = xtal * 0.78 + base * 0.22
    feld = pink
    alb = alb * (0.94 + 0.12 * grain[..., None])
    stain = np.clip((big - 0.5) * 2, 0, 1)
    alb = alb * (1 - stain[..., None] * 0.18) + col(0.45, 0.38, 0.30) * stain[..., None] * 0.18
    h = 0.5 * mid + 0.3 * big + 0.2 * grain - 0.2 * biotite
    ao = ao_from_height(h, 6, 0.8)
    rough = np.clip(0.62 + 0.18 * (1 - mid) - 0.12 * quartz, 0, 1)
    out_set("granite", alb, normal_from_height(h, 3.5), orm_stack(ao, rough, np.zeros_like(h)))


def gen_chert():
    """Chert/flint: dark glassy blue-grey with mottling and conchoidal ripples."""
    mott = spectral(N, 61, beta=2.4, lo=1)
    fine = spectral(N, 62, beta=1.2, lo=20)
    alb = ramp(mott * 0.8 + fine * 0.2, [(0, (0.07, 0.075, 0.085)), (0.6, (0.16, 0.165, 0.18)), (1, (0.30, 0.29, 0.28))])
    ripple = np.sin(spectral(N, 63, beta=3.0, lo=1) * 60.0) * 0.5 + 0.5
    h = 0.6 * ripple * 0.3 + 0.4 * mott
    rough = np.clip(0.28 + 0.12 * fine, 0, 1)
    out_set("chert", alb, normal_from_height(h, 2.5), orm_stack(np.ones_like(h), rough, np.zeros_like(h)))


def gen_ash():
    """Campfire bed / dirt: grey-white ash, charcoal crumbs, dark scorched soil. Tileable."""
    big = spectral(N, 71, beta=2.4, lo=1)
    mid = spectral(N, 72, beta=1.6, lo=6)
    f1, f2, cid = worley(N, 400, 73)
    crumbs = np.clip(1 - f1 / 5.0, 0, 1) * (rng(74).random(400)[cid] > 0.6)
    ashy = np.clip((big - 0.35) * 2.2, 0, 1)
    alb = ramp(mid, [(0, (0.10, 0.09, 0.085)), (1, (0.22, 0.20, 0.18))])
    alb = alb * (1 - ashy[..., None]) + ramp(mid, [(0, (0.45, 0.44, 0.42)), (1, (0.66, 0.65, 0.63))]) * ashy[..., None]
    alb = alb * (1 - crumbs[..., None] * 0.9) + col(0.03, 0.028, 0.026) * crumbs[..., None] * 0.9
    h = 0.5 * mid + 0.3 * big + 0.4 * crumbs
    ao = ao_from_height(h, 4, 1.0)
    out_set("ash", alb, normal_from_height(h, 4.0), orm_stack(ao, np.full_like(h, 0.95), np.zeros_like(h)))


def gen_forest_floor():
    """Montane forest floor: dark humus, spruce needles, twigs, a little moss. Used by dev scenes/props."""
    base_n = spectral(N, 81, beta=2.2, lo=2)
    alb = ramp(base_n, [(0, (0.12, 0.09, 0.07)), (1, (0.24, 0.19, 0.14))])
    h = base_n * 0.4
    im = Image.new("L", (N, N), 0)
    cim = Image.new("RGB", (N, N), (0, 0, 0))
    d = ImageDraw.Draw(im)
    dc = ImageDraw.Draw(cim)
    rs = rng(82)
    for _ in range(2600):   # needles
        x, y = rs.random(2) * N
        a = rs.uniform(0, math.pi)
        l = rs.uniform(7, 14)
        x2, y2 = x + math.cos(a) * l, y + math.sin(a) * l
        shade = rs.uniform(0.45, 1.0)
        c = (int(150 * shade), int(95 * shade), int(55 * shade)) if rs.random() > 0.25 else (int(70 * shade), int(62 * shade), int(40 * shade))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=int(200 * shade), width=1)
                dc.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=c, width=1)
    for _ in range(40):     # twigs
        x, y = rs.random(2) * N
        a = rs.uniform(0, math.pi)
        l = rs.uniform(25, 70)
        x2, y2 = x + math.cos(a) * l, y + math.sin(a) * l
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=255, width=3)
                dc.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=(70, 52, 38), width=3)
    mask = np.asarray(im, np.float32) / 255.0
    ccol = np.asarray(cim, np.float32) / 255.0
    alb = alb * (1 - (mask > 0)[..., None] * 0.9) + ccol * (mask > 0)[..., None] * 0.9
    moss = np.clip((spectral(N, 83, beta=2.6, lo=2) - 0.66) * 4, 0, 1)
    alb = alb * (1 - moss[..., None] * 0.7) + col(0.2, 0.26, 0.1) * moss[..., None] * 0.7
    h = h + mask * 0.5 + moss * 0.3
    ao = ao_from_height(h, 3, 1.4)
    out_set("forest_floor", alb * ao[..., None] ** 0.6, normal_from_height(h, 5.0), orm_stack(ao, np.full_like(h, 0.92), np.zeros_like(h)))

# ------------------------------------------------------------------------------------------ metal

def gen_steel():
    """Worn steel: brushed streaks, fine scratches, grime in low spots."""
    brush = spectral(N, 91, beta=1.0, lo=20, aniso=(1.0, 0.04))
    big = spectral(N, 92, beta=2.4, lo=1)
    im = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(im)
    rs = rng(93)
    for _ in range(260):
        x, y = rs.random(2) * N
        a = rs.uniform(0, math.pi)
        l = rs.uniform(10, 80)
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(x + ox, y + oy), (x + ox + math.cos(a) * l, y + oy + math.sin(a) * l)], fill=int(rs.uniform(80, 255)), width=1)
    scr = np.asarray(im, np.float32) / 255.0
    grime = np.clip((big - 0.6) * 2.5, 0, 1)
    alb = ramp(brush * 0.6 + big * 0.4, [(0, (0.46, 0.46, 0.47)), (1, (0.66, 0.66, 0.67))])
    alb = alb * (1 - grime[..., None] * 0.5) + col(0.18, 0.16, 0.14) * grime[..., None] * 0.5
    alb = alb + scr[..., None] * 0.1
    rough = np.clip(0.34 + 0.14 * brush + 0.3 * grime - 0.15 * scr, 0, 1)
    metal = np.clip(1.0 - grime * 0.5, 0, 1)
    h = brush * 0.3 - scr * 0.3
    out_set("steel", alb, normal_from_height(h, 1.5), orm_stack(np.ones_like(h), rough, metal))


def gen_aluminium():
    brush = spectral(N, 101, beta=0.8, lo=30, aniso=(1.0, 0.03))
    big = spectral(N, 102, beta=2.2, lo=2)
    dent = spectral(N, 103, beta=3.0, lo=1)
    alb = ramp(brush * 0.5 + big * 0.5, [(0, (0.72, 0.73, 0.74)), (1, (0.86, 0.87, 0.88))])
    rough = np.clip(0.3 + 0.15 * brush + 0.15 * big, 0, 1)
    h = brush * 0.2 + dent * 0.6
    out_set("aluminium", alb, normal_from_height(h, 2.0), orm_stack(np.ones_like(h), rough, np.ones_like(h)))


def gen_paint():
    """Painted metal (tinted per material): grime, edge wear and chips showing steel."""
    big = spectral(N, 111, beta=2.2, lo=2)
    f1, f2, cid = worley(N, 160, 112)
    chip_sel = rng(113).random(160)[cid] > 0.82
    chip = np.clip(1 - f1 / 9.0, 0, 1) * chip_sel
    chip = (chip > 0.25).astype(np.float32)
    grime = np.clip((big - 0.55) * 2.0, 0, 1)
    fine = spectral(N, 114, beta=1.0, lo=40)
    alb = np.ones((N, N, 3), np.float32) * (0.9 - 0.12 * fine)[..., None]
    alb = alb * (1 - grime[..., None] * 0.35)
    alb = alb * (1 - chip[..., None]) + col(0.32, 0.32, 0.33) * chip[..., None]
    rough = np.clip(0.42 + 0.2 * grime + 0.1 * fine - 0.1 * chip, 0, 1)
    metal = chip * 0.8
    h = (1 - chip) * 0.4 + fine * 0.1
    out_set("paint", alb, normal_from_height(h, 2.0), orm_stack(np.ones_like(h), rough, metal))


def gen_rust():
    big = spectral(N, 121, beta=2.2, lo=2)
    mid = spectral(N, 122, beta=1.4, lo=12)
    pits = np.clip((spectral(N, 123, beta=0.8, lo=50) - 0.7) * 4, 0, 1)
    alb = ramp(0.6 * mid + 0.4 * big, [(0, (0.18, 0.08, 0.04)), (0.5, (0.42, 0.20, 0.08)), (1, (0.62, 0.36, 0.16))])
    alb = alb * (1 - pits[..., None] * 0.6)
    bare = np.clip((0.25 - big) * 4, 0, 1)
    alb = alb * (1 - bare[..., None]) + col(0.35, 0.33, 0.32) * bare[..., None]
    rough = np.clip(0.8 + 0.15 * mid - 0.4 * bare, 0, 1)
    metal = bare * 0.7
    h = mid * 0.5 + big * 0.3 - pits * 0.4
    out_set("rust", alb, normal_from_height(h, 4.0), orm_stack(ao_from_height(h, 3, 1), rough, metal))


def gen_plastic():
    """Moulded plastic: faint orange-peel texture + scuffs (tinted per material)."""
    peel = spectral(N, 131, beta=1.0, lo=40)
    scuff = np.clip((spectral(N, 132, beta=1.2, lo=10, aniso=(1.0, 0.2)) - 0.72) * 4, 0, 1)
    alb = np.ones((N, N, 3), np.float32) * (0.92 - 0.05 * peel - 0.12 * scuff)[..., None]
    rough = np.clip(0.42 + 0.1 * peel + 0.25 * scuff, 0, 1)
    out_set("plastic", alb, normal_from_height(peel * 0.3, 1.5), orm_stack(np.ones_like(peel), rough, np.zeros_like(peel)))

# ------------------------------------------------------------------------------------------ textiles & organics

def gen_weave():
    """Plain-weave fabric (nylon/canvas), grey — tinted per material."""
    p = 8.0
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    i = np.floor(xx / p)
    j = np.floor(yy / p)
    fx = (xx / p) % 1.0
    fy = (yy / p) % 1.0
    warp_prof = 1 - (2 * fx - 1) ** 2
    weft_prof = 1 - (2 * fy - 1) ** 2
    warp_top = ((i + j) % 2) == 0
    h = np.where(warp_top, warp_prof * (0.7 + 0.3 * np.sin(fy * math.pi)), weft_prof * (0.7 + 0.3 * np.sin(fx * math.pi)))
    fuzz = spectral(N, 141, beta=1.0, lo=60)
    slub = spectral(N, 142, beta=2.0, lo=2, aniso=(1.0, 0.1))
    h = h * 0.8 + fuzz * 0.2
    alb = np.ones((N, N, 3), np.float32) * (0.62 + 0.3 * h + 0.08 * slub)[..., None]
    ao = ao_from_height(h, 2, 0.6)
    rough = np.clip(0.8 - 0.1 * h, 0, 1)
    out_set("weave", alb * ao[..., None], normal_from_height(h, 3.0), orm_stack(ao, rough, np.zeros_like(h)))


def gen_knit():
    """Stockinette knit: columns of V stitches (wool hat, sweater), grey — tinted per material."""
    w, hgt = 32.0, 26.0     # 16 stitch columns x ~20 rows per tile
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cx = (xx % w) / w           # 0..1 inside the stitch cell
    cy = (yy % hgt) / hgt       # 0 top .. 1 bottom

    def seg_dist(px, py, ax, ay, bx, by):
        vx, vy = bx - ax, by - ay
        t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
        dx, dy = px - (ax + vx * t), py - (ay + vy * t)
        return np.sqrt((dx * w) ** 2 + (dy * hgt) ** 2), t

    st = np.zeros((N, N), np.float32)
    rad = 0.2 * w
    for oy in (-1.0, 0.0, 1.0):       # legs reach into the rows above and below
        py = cy + oy
        for (ax, bx) in ((0.5, 0.06), (0.5, 0.94)):
            d, t = seg_dist(cx, py, ax, 1.05, bx, -0.2)
            prof = np.sqrt(np.clip(1 - (d / rad) ** 2, 0, 1))
            ply = 0.85 + 0.15 * np.sin(t * 18.0 + (ax - bx) * 3.0)     # twisted plies along the leg
            st = np.maximum(st, prof * ply)
    fuzz = spectral(N, 151, beta=1.1, lo=50)
    h = st * 0.85 + fuzz * 0.15
    alb = np.ones((N, N, 3), np.float32) * (0.45 + 0.5 * h)[..., None]
    ao = ao_from_height(h, 2, 0.9)
    out_set("knit", alb * ao[..., None], normal_from_height(h, 4.0), orm_stack(ao, np.full_like(h, 0.95), np.zeros_like(h)))


def gen_fur():
    """Deer/wolf fur: directional hair along -V, clumped, dark roots and pale tips."""
    hair = spectral(N, 161, beta=0.8, lo=40, aniso=(1.0, 10.0))
    clump_f1, clump_f2, cid = worley(N, 110, 162, aniso=(1.0, 0.45))
    clump = np.clip(clump_f1 / 30.0, 0, 1)
    tone = spectral(N, 163, beta=2.4, lo=1)
    h = hair * 0.7 + (1 - clump) * 0.3
    alb = ramp(0.55 * h + 0.45 * tone, [(0, (0.12, 0.09, 0.07)), (0.45, (0.36, 0.28, 0.21)), (0.8, (0.56, 0.47, 0.38)), (1, (0.74, 0.68, 0.60))])
    ao = ao_from_height(h, 3, 1.4)
    out_set("fur", alb * ao[..., None] ** 0.7, normal_from_height(h, 5.0), orm_stack(ao, np.full_like(h, 0.9), np.zeros_like(h)))


def gen_leather():
    f1, f2, cid = worley(N, 900, 171)
    peb = np.clip(f1 / 9.0, 0, 1)
    wr = spectral(N, 172, beta=2.6, lo=3, aniso=(1.0, 0.35))
    tone = spectral(N, 173, beta=2.2, lo=2)
    h = (1 - peb) * 0.4 + wr * 0.6
    alb = ramp(0.6 * tone + 0.4 * (1 - peb), [(0, (0.22, 0.12, 0.06)), (1, (0.46, 0.29, 0.16))])
    ao = ao_from_height(h, 3, 1.0)
    rough = np.clip(0.55 + 0.25 * peb, 0, 1)
    out_set("leather", alb * ao[..., None] ** 0.6, normal_from_height(h, 3.0), orm_stack(ao, rough, np.zeros_like(h)))


def gen_suede():
    """Flesh side of smoked hide / buckskin: soft, fibrous, tan with smoke stains."""
    fib = spectral(N, 181, beta=1.0, lo=40)
    tone = spectral(N, 182, beta=2.4, lo=1)
    smoke = np.clip((spectral(N, 183, beta=2.8, lo=1) - 0.5) * 2, 0, 1)
    alb = ramp(0.7 * tone + 0.3 * fib, [(0, (0.52, 0.40, 0.28)), (1, (0.74, 0.62, 0.46))])
    alb = alb * (1 - smoke[..., None] * 0.35) + col(0.38, 0.25, 0.14) * smoke[..., None] * 0.35
    h = fib * 0.5 + tone * 0.5
    out_set("suede", alb, normal_from_height(h, 2.0), orm_stack(np.ones_like(h), np.full_like(h, 0.93), np.zeros_like(h)))


def gen_meat():
    """Raw venison (deep red, lean, glossy) and cooked (seared brown, charred edges)."""
    fib = spectral(N, 191, beta=1.3, lo=20, aniso=(1.0, 0.1))
    tone = spectral(N, 192, beta=2.2, lo=2)
    fat = np.clip((spectral(N, 193, beta=2.0, lo=4, aniso=(1.0, 0.5)) - 0.74) * 6, 0, 1)
    alb = ramp(0.5 * tone + 0.5 * fib, [(0, (0.22, 0.02, 0.025)), (0.6, (0.40, 0.05, 0.05)), (1, (0.55, 0.12, 0.10))])
    alb = alb * (1 - fat[..., None]) + col(0.85, 0.78, 0.70) * fat[..., None]
    h = fib * 0.6 + tone * 0.4 + fat * 0.2
    rough = np.clip(0.28 + 0.2 * fib, 0, 1)
    out_set("meat_raw", alb, normal_from_height(h, 3.0), orm_stack(np.ones_like(h), rough, np.zeros_like(h)))
    char = np.clip((spectral(N, 194, beta=1.8, lo=4) - 0.58) * 4, 0, 1)
    alb2 = ramp(0.5 * tone + 0.5 * fib, [(0, (0.14, 0.06, 0.03)), (0.6, (0.30, 0.14, 0.06)), (1, (0.46, 0.25, 0.11))])
    alb2 = alb2 * (1 - fat[..., None] * 0.6) + col(0.62, 0.45, 0.22) * fat[..., None] * 0.6
    alb2 = alb2 * (1 - char[..., None] * 0.85) + col(0.03, 0.02, 0.015) * char[..., None] * 0.85
    h2 = h + char * 0.3
    rough2 = np.clip(0.55 + 0.3 * char, 0, 1)
    out_set("meat_cooked", alb2, normal_from_height(h2, 4.0), orm_stack(np.ones_like(h), rough2, np.zeros_like(h)))


def gen_fish():
    """Bull trout skin mapped around the body: u = around (0 belly, 0.5 back), v = along the body.
    Not tileable in v. Plus a cooked variant."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    u = xx / N
    back = 0.5 - np.abs(u - 0.5)          # 0 at belly (u=0/1), 0.5 at back (u=0.5)
    back = back * 2.0                      # 0..1
    base = ramp(back, [(0, (0.86, 0.84, 0.80)), (0.35, (0.66, 0.66, 0.60)), (0.62, (0.36, 0.38, 0.28)), (1, (0.16, 0.18, 0.13))])
    f1, f2, cid = worley(N, 260, 201)
    spots = np.clip(1 - f1 / 5.5, 0, 1) * (back > 0.3) * (rng(202).random(260)[cid] > 0.35)
    base = base * (1 - spots[..., None] * 0.6) + col(0.86, 0.80, 0.62) * spots[..., None] * 0.6
    scale = spectral(N, 203, beta=0.6, lo=80) * 0.1
    alb = base * (0.95 + scale[..., None])
    h = scale + spots * 0.1
    out_set("fish", alb, normal_from_height(h, 2.0), orm_stack(np.ones_like(h), np.full_like(h, 0.3), np.zeros_like(h)))
    char = np.clip((spectral(N, 204, beta=1.8, lo=4) - 0.55) * 3, 0, 1)
    alb2 = ramp(back, [(0, (0.72, 0.58, 0.38)), (0.6, (0.46, 0.34, 0.18)), (1, (0.30, 0.22, 0.12))])
    alb2 = alb2 * (1 - char[..., None] * 0.8) + col(0.05, 0.035, 0.02) * char[..., None] * 0.8
    out_set("fish_cooked", alb2, normal_from_height(h + char * 0.3, 3.0), orm_stack(np.ones_like(h), np.full_like(h, 0.6), np.zeros_like(h)))


def gen_rope():
    """Three-strand twisted rope along V (tube UVs: u around, v along), grey — tinted per material."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    strands = 3.0
    twist = (xx / N * strands + yy / N * 6.0) % 1.0
    prof = np.sin(twist * math.pi) ** 0.6
    fib = spectral(N, 211, beta=1.0, lo=16, aniso=(1.0, 6.0))
    h = prof * 0.8 + fib * 0.2
    alb = np.ones((N, N, 3), np.float32) * (0.5 + 0.45 * h)[..., None]
    ao = ao_from_height(h, 2, 1.0)
    out_set("rope", alb * ao[..., None], normal_from_height(h, 5.0), orm_stack(ao, np.full_like(h, 0.9), np.zeros_like(h)))


def gen_grass():
    """Dry fibre / grass stalks along V (fibre bundles, tinder, bough bed)."""
    st = spectral(N, 221, beta=0.8, lo=12, aniso=(1.0, 30.0))
    tone = spectral(N, 222, beta=2.0, lo=2, aniso=(1.0, 5.0))
    alb = ramp(0.6 * st + 0.4 * tone, [(0, (0.30, 0.25, 0.14)), (0.6, (0.62, 0.53, 0.33)), (1, (0.80, 0.72, 0.50))])
    out_set("grass", alb, normal_from_height(st, 3.0), orm_stack(np.ones_like(st), np.full_like(st, 0.85), np.zeros_like(st)))


def gen_paper():
    fib = spectral(N, 231, beta=0.9, lo=40)
    tone = spectral(N, 232, beta=2.6, lo=1)
    stain = np.clip((tone - 0.6) * 2.0, 0, 1)
    alb = ramp(fib * 0.4 + tone * 0.6, [(0, (0.80, 0.77, 0.69)), (1, (0.92, 0.90, 0.84))])
    alb = alb * (1 - stain[..., None] * 0.25) + col(0.66, 0.55, 0.38) * stain[..., None] * 0.25
    out_set("paper", alb, normal_from_height(fib * 0.4, 1.0), orm_stack(np.ones_like(fib), np.full_like(fib, 0.9), np.zeros_like(fib)))


def gen_birch():
    """Paper birch bark along U (lenticels run around the trunk): chalky white, dark horizontal lenticels,
    peeling tan curls, black scars."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    tone = spectral(N, 281, beta=2.4, lo=2, aniso=(6.0, 1.0))
    alb = ramp(tone, [(0, (0.80, 0.78, 0.72)), (1, (0.93, 0.92, 0.88))])
    im = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(im)
    rs = rng(282)
    for _ in range(420):
        x, y = rs.random(2) * N
        l = rs.uniform(8, 46)
        w = int(rs.integers(1, 4))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(x + ox, y + oy), (x + ox + l, y + oy)], fill=int(rs.uniform(120, 255)), width=w)
    len_m = np.asarray(im, np.float32) / 255.0
    alb = alb * (1 - len_m[..., None] * 0.75) + col(0.18, 0.15, 0.13) * len_m[..., None] * 0.75
    peel = np.clip((spectral(N, 283, beta=2.2, lo=3, aniso=(5.0, 1.0)) - 0.7) * 5, 0, 1)
    alb = alb * (1 - peel[..., None] * 0.6) + col(0.72, 0.52, 0.38) * peel[..., None] * 0.6
    scar = np.clip((spectral(N, 284, beta=2.6, lo=2) - 0.8) * 8, 0, 1)
    alb = alb * (1 - scar[..., None] * 0.9) + col(0.08, 0.07, 0.06) * scar[..., None] * 0.9
    h = tone * 0.3 - len_m * 0.4 + peel * 0.4
    out_set("birch", alb, normal_from_height(h, 3.0), orm_stack(ao_from_height(h, 3, 1), np.full_like(h, 0.8), np.zeros_like(h)))


def gen_blanket():
    """Trade point blanket: felted cream wool, four bands (green, red, yellow, indigo) across V."""
    fuzz = spectral(N, 291, beta=1.0, lo=40)
    felt = spectral(N, 292, beta=2.0, lo=4)
    alb = ramp(felt * 0.5 + fuzz * 0.5, [(0, (0.80, 0.76, 0.66)), (1, (0.92, 0.89, 0.80))])
    yy = np.mgrid[0:N, 0:N][0].astype(np.float32) / N
    bands = [(0.10, 0.155, (0.12, 0.40, 0.25)), (0.18, 0.235, (0.62, 0.10, 0.09)),
             (0.26, 0.315, (0.86, 0.66, 0.12)), (0.34, 0.395, (0.14, 0.18, 0.36))]
    wob = (spectral(N, 293, beta=2.0, lo=6) - 0.5) * 0.006
    for a, b, c in bands:
        m = np.clip(np.minimum((yy + wob - a) / 0.004, (b - yy - wob) / 0.004), 0, 1)
        alb = alb * (1 - m[..., None]) + col(*c) * (0.85 + 0.3 * fuzz[..., None]) * m[..., None]
    h = fuzz * 0.6 + felt * 0.4
    out_set("blanket", alb, normal_from_height(h, 2.0), orm_stack(np.ones_like(h), np.full_like(h, 0.95), np.zeros_like(h)))


def gen_snow():
    big = spectral(N, 301, beta=2.6, lo=1)
    grains = spectral(N, 302, beta=0.4, lo=80)
    alb = ramp(big * 0.7 + grains * 0.3, [(0, (0.80, 0.84, 0.90)), (1, (0.96, 0.97, 0.99))])
    h = big * 0.6 + grains * 0.4
    out_set("snow", alb, normal_from_height(h, 3.0), orm_stack(ao_from_height(h, 4, 0.6), np.clip(0.55 + 0.3 * grains, 0, 1), np.zeros_like(h)))


def gen_bone():
    tone = spectral(N, 241, beta=2.2, lo=2, aniso=(1.0, 3.0))
    pores = np.clip((spectral(N, 242, beta=0.7, lo=60) - 0.7) * 5, 0, 1)
    alb = ramp(tone, [(0, (0.70, 0.64, 0.52)), (1, (0.88, 0.84, 0.75))]) * (1 - pores[..., None] * 0.2)
    out_set("bone", alb, normal_from_height(tone * 0.4 - pores * 0.2, 2.0), orm_stack(np.ones_like(tone), np.full_like(tone, 0.55), np.zeros_like(tone)))

# ------------------------------------------------------------------------------------------ prints & labels (not tileable)

def text_center(d, cx, y, s, f, fill):
    w = d.textlength(s, font=f)
    d.text((cx - w / 2, y), s, font=f, fill=fill)


def gen_labels():
    os.makedirs(TEX, exist_ok=True)
    grain = (spectral(N, 251, beta=1.0, lo=40) * 0.06)[..., None]

    def finish(name, im, rough=0.6, metal=0.0, n_strength=0.8):
        a = np.asarray(im.convert("RGB"), np.float32) / 255.0
        a = np.clip(a * (0.97 + grain), 0, 1)
        h = spectral(N, zlib.crc32(name.encode()) % 1000, beta=2.4, lo=2) * 0.3
        out_set(name, a)   # flat prints: scalar roughness/metallic in the material, no normal map

    # Beans can label (wraps around: u = around, v = up). Red band, cream panel, typography.
    im = Image.new("RGB", (N, N), (178, 36, 30))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 150, N, 362], fill=(238, 228, 204))
    d.rectangle([0, 140, N, 150], fill=(215, 170, 60))
    d.rectangle([0, 362, N, 372], fill=(215, 170, 60))
    for cx in (128, 384):
        text_center(d, cx, 170, "BAKED", font(58, "Bold"), (150, 30, 24))
        text_center(d, cx, 232, "BEANS", font(58, "Bold"), (150, 30, 24))
        text_center(d, cx, 302, "in tomato sauce · 398 mL", font(18, "Medium"), (70, 50, 40))
        text_center(d, cx, 60, "PRAIRIE", font(34, "SemiBold"), (245, 230, 200))
    finish("label_beans", im, 0.5)

    # Emergency ration wrapper (foil-backed), u along the bar, v across.
    im = Image.new("RGB", (N, N), (205, 208, 210))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 96, N, 416], fill=(28, 72, 140))
    text_center(d, N / 2, 130, "EMERGENCY", font(64, "Bold"), (245, 245, 240))
    text_center(d, N / 2, 205, "FOOD RATION", font(52, "SemiBold"), (245, 245, 240))
    text_center(d, N / 2, 280, "400 kcal · 5 YEAR SHELF LIFE", font(22, "Medium"), (220, 225, 235))
    d.rectangle([150, 330, 362, 380], outline=(245, 245, 240), width=3)
    text_center(d, N / 2, 338, "USCG APPROVED", font(22, "SemiBold"), (245, 245, 240))
    finish("label_ration", im, 0.3, 0.6)

    # Pill bottle label (u around, v up)
    im = Image.new("RGB", (N, N), (242, 242, 238))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 60, N, 130], fill=(230, 110, 30))
    for cx in (128, 384):
        text_center(d, cx, 150, "IBUPROFEN", font(44, "Bold"), (40, 40, 45))
        text_center(d, cx, 210, "200 mg · 50 tablets", font(24, "Medium"), (70, 70, 75))
        text_center(d, cx, 72, "PAIN RELIEF", font(34, "SemiBold"), (255, 255, 255))
    finish("label_pills", im, 0.35)

    # First aid box lid (planar): white cross on red
    im = Image.new("RGB", (N, N), (170, 26, 24))
    d = ImageDraw.Draw(im)
    d.rectangle([N / 2 - 46, 120, N / 2 + 46, 392], fill=(245, 245, 242))
    d.rectangle([120, N / 2 - 46, 392, N / 2 + 46], fill=(245, 245, 242))
    text_center(d, N / 2, 420, "FIRST AID", font(40, "Bold"), (245, 245, 242))
    finish("label_firstaid", im, 0.4)

    # Keycard
    im = Image.new("RGB", (N, N), (236, 238, 240))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, N, 120], fill=(22, 60, 96))
    d.text((28, 30), "KESTREL STATION", font=font(46, "Bold"), fill=(240, 244, 248))
    d.rectangle([28, 160, 188, 360], fill=(150, 160, 170))
    d.ellipse([68, 190, 148, 270], fill=(110, 118, 126))
    d.rectangle([60, 280, 156, 360], fill=(110, 118, 126))
    d.text((214, 170), "DR. E. HALE", font=font(40, "SemiBold"), fill=(30, 34, 40))
    d.text((214, 226), "TEAM LEAD", font=font(28, "Medium"), fill=(80, 86, 94))
    d.text((214, 280), "ACCESS: ALL AREAS", font=font(26, "Medium"), fill=(170, 40, 30))
    d.rectangle([0, 430, N, 470], fill=(22, 60, 96))
    finish("label_keycard", im, 0.25)

    # Matchbox label
    im = Image.new("RGB", (N, N), (224, 196, 60))
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, N - 20, N - 20], outline=(150, 30, 20), width=10)
    d.polygon([(N / 2, 120), (N / 2 + 60, 260), (N / 2, 330), (N / 2 - 60, 260)], fill=(200, 50, 20))
    d.polygon([(N / 2, 190), (N / 2 + 28, 262), (N / 2, 300), (N / 2 - 28, 262)], fill=(250, 190, 40))
    text_center(d, N / 2, 350, "STRIKE", font(56, "Bold"), (120, 25, 18))
    text_center(d, N / 2, 410, "ANYWHERE", font(40, "SemiBold"), (120, 25, 18))
    finish("label_matches", im, 0.8)

    # Book covers: survival manual (weathered green) and pilot logbook (black)
    im = Image.new("RGB", (N, N), (46, 78, 58))
    d = ImageDraw.Draw(im)
    d.rectangle([34, 34, N - 34, N - 34], outline=(214, 196, 140), width=4)
    text_center(d, N / 2, 110, "WILDERNESS", font(52, "Bold"), (230, 214, 160))
    text_center(d, N / 2, 172, "SURVIVAL", font(52, "Bold"), (230, 214, 160))
    text_center(d, N / 2, 240, "HANDBOOK", font(34, "Medium"), (230, 214, 160))
    d.ellipse([N / 2 - 70, 300, N / 2 + 70, 440], outline=(230, 214, 160), width=4)
    d.polygon([(N / 2, 318), (N / 2 + 22, 370), (N / 2, 420), (N / 2 - 22, 370)], fill=(230, 214, 160))
    finish("label_manual", im, 0.85)
    im = Image.new("RGB", (N, N), (26, 26, 28))
    d = ImageDraw.Draw(im)
    d.rectangle([60, 180, N - 60, 300], fill=(210, 205, 190))
    text_center(d, N / 2, 196, "PILOT LOGBOOK", font(40, "Bold"), (30, 30, 32))
    text_center(d, N / 2, 250, "D. MORROW · C-FKDM", font(26, "Medium"), (60, 60, 62))
    finish("label_logbook", im, 0.7)

    # Topographic map sheet: contours from a synthetic DEM, lakes, grid, pencil circle.
    dem = spectral(N, 261, beta=3.4, lo=1)
    lv = dem * 30.0
    contour = np.clip(1.0 - np.abs(lv - np.round(lv)) / 0.06, 0, 1)
    idx = np.clip(1.0 - np.abs(lv / 5.0 - np.round(lv / 5.0)) / 0.02, 0, 1)
    paper = ramp(spectral(N, 262, beta=2.2, lo=2), [(0, (0.86, 0.84, 0.76)), (1, (0.93, 0.91, 0.85))])
    forest = (dem < 0.55)[..., None] * col(0.72, 0.84, 0.64) + (dem >= 0.55)[..., None] * col(1, 1, 1)
    glacier = (dem > 0.8)[..., None]
    a = paper * forest
    a = np.where(glacier, paper * col(0.88, 0.94, 1.0), a)
    lake = (dem < 0.17)[..., None]
    a = np.where(lake, col(0.55, 0.72, 0.86), a)
    brown = col(0.62, 0.40, 0.22)
    a = a * (1 - contour[..., None] * 0.55) + brown * contour[..., None] * 0.55
    a = a * (1 - idx[..., None] * 0.6) + brown * 0.8 * idx[..., None] * 0.6
    yy, xx = np.mgrid[0:N, 0:N]
    grid = ((xx % 128) < 2) | ((yy % 128) < 2)
    a = np.where(grid[..., None], a * 0.55 + col(0.2, 0.3, 0.6) * 0.45, a)
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.ellipse([300, 330, 380, 390], outline=(70, 70, 75), width=3)
    d.text((388, 340), "cabin?", font=font(22, "Italic"), fill=(70, 70, 75))
    # folds
    fold = np.ones((N, N), np.float32)
    fold[:, 254:258] = 0.82
    fold[126:130, :] = 0.86
    fold[382:386, :] = 0.86
    a = np.asarray(im, np.float32) / 255.0 * fold[..., None]
    fold_h = np.zeros((N, N), np.float32)
    fold_h[:, 250:262] = np.hanning(12)[None, :]
    out_set("print_map", a, normal_from_height(-fold_h * 2.0, 2.0), orm_stack(np.ones((N, N)), np.full((N, N), 0.85), np.zeros((N, N))))

    # PCB (electronics): green solder mask, traces, pads, chips
    rs = rng(271)
    im = Image.new("RGB", (N, N), (22, 86, 44))
    d = ImageDraw.Draw(im)
    for _ in range(90):
        x, y = rs.integers(0, N, 2)
        pts = [(int(x), int(y))]
        for _ in range(rs.integers(2, 5)):
            if rs.random() < 0.5:
                x = int(np.clip(x + rs.integers(-120, 120), 0, N))
            else:
                y = int(np.clip(y + rs.integers(-120, 120), 0, N))
            pts.append((int(x), int(y)))
        d.line(pts, fill=(40, 130, 70), width=int(rs.integers(2, 5)))
    for _ in range(140):
        x, y = rs.integers(0, N, 2)
        d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(200, 180, 120))
    for _ in range(9):
        x, y = rs.integers(20, N - 100, 2)
        w, h = rs.integers(40, 90, 2)
        d.rectangle([x, y, x + w, y + h], fill=(22, 22, 24))
        for k in range(int(x) + 4, int(x + w) - 2, 8):
            d.rectangle([k, y - 5, k + 3, y], fill=(190, 190, 195))
            d.rectangle([k, y + h, k + 3, y + h + 5], fill=(190, 190, 195))
    finish("print_pcb", im, 0.35, 0.1)

    # Scanner / radio screen: dark glass with a faint UI and a crack
    im = Image.new("RGB", (N, N), (8, 14, 18))
    d = ImageDraw.Draw(im)
    for k in range(0, N, 32):
        d.line([(0, k), (N, k)], fill=(14, 30, 34), width=1)
    d.ellipse([146, 146, 366, 366], outline=(40, 150, 160), width=3)
    d.line([(256, 146), (256, 366)], fill=(40, 150, 160), width=2)
    d.text((24, 20), "SCAN READY", font=mono(30), fill=(80, 200, 210))
    d.text((24, 450), "SIG --  BAT 41%", font=mono(26), fill=(60, 160, 170))
    crack = [(420, 0), (380, 90), (402, 150), (330, 260), (350, 330), (270, 512)]
    d.line(crack, fill=(170, 190, 200), width=2)
    d.line([(380, 90), (470, 140), (512, 130)], fill=(150, 170, 180), width=1)
    finish("print_screen", im, 0.08)

    # Battery wrap (u around, v up)
    im = Image.new("RGB", (N, N), (24, 24, 26))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, N, 90], fill=(170, 120, 40))
    for cx in (128, 384):
        text_center(d, cx, 170, "LITHIUM", font(48, "Bold"), (230, 230, 230))
        text_center(d, cx, 240, "D · 3.6V", font(40, "SemiBold"), (200, 160, 70))
    finish("label_battery", im, 0.35, 0.2)

    # Jerrycan stencil (Canadian convention: diesel cans are yellow) / O2 cylinder label
    im = Image.new("RGB", (N, N), (206, 160, 30))
    d = ImageDraw.Draw(im)
    text_center(d, N / 2, 150, "DIESEL", font(110, "Bold"), (24, 22, 20))
    text_center(d, N / 2, 300, "5 L · FLAMMABLE", font(40, "SemiBold"), (24, 22, 20))
    finish("label_diesel", im, 0.5)
    im = Image.new("RGB", (N, N), (236, 236, 232))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, N, 150], fill=(26, 120, 60))
    for cx in (128, 384):
        text_center(d, cx, 200, "OXYGEN", font(56, "Bold"), (26, 120, 60))
        text_center(d, cx, 270, "USP · 200 bar", font(26, "Medium"), (60, 60, 62))
    finish("label_o2", im, 0.3, 0.3)

# ------------------------------------------------------------------------------------------ campfire FX

def periodic_noise3(n, t, seed, beta=2.2, aniso=(1.0, 1.0, 1.0)):
    r = rng(seed)
    white = r.standard_normal((t, n, n))
    F = np.fft.fftn(white)
    ft = np.fft.fftfreq(t)[:, None, None] * t
    fy = np.fft.fftfreq(n)[None, :, None] * n
    fx = np.fft.fftfreq(n)[None, None, :] * n
    rad = np.sqrt((fx * aniso[0]) ** 2 + (fy * aniso[1]) ** 2 + (ft * aniso[2]) ** 2)
    amp = np.where(rad < 1e-6, 0, 1.0 / np.maximum(rad, 1e-6) ** (beta / 2))
    out = np.real(np.fft.ifftn(F * amp))
    out -= out.min()
    return out / out.max()


def gen_fx():
    os.makedirs(FX, exist_ok=True)
    # Flame flipbook: 4x4 frames of 128px, looping (time-periodic 3D noise scrolled upward).
    fr, grid, T = 128, 4, 16
    noise = periodic_noise3(fr, T, 301, beta=2.0, aniso=(1.0, 1.8, 0.9))
    fine = periodic_noise3(fr, T, 302, beta=1.2, aniso=(1.0, 1.6, 1.4))
    yy, xx = np.mgrid[0:fr, 0:fr].astype(np.float32)
    u = (xx + 0.5) / fr - 0.5
    v = 1.0 - (yy + 0.5) / fr          # 0 bottom, 1 top
    sheet = np.zeros((fr * grid, fr * grid, 4), np.float32)
    for k in range(T):
        # scroll the noise upward over the loop: sample row offset proportional to k
        shift = int(k * fr / T)
        n1 = np.roll(noise[k], -shift, axis=0)
        n2 = np.roll(fine[k], -shift * 2, axis=0)
        turb = n1 * 0.7 + n2 * 0.3
        width = 0.36 * (1.0 - v) ** 0.7 + 0.02
        wob = (turb - 0.5) * 0.22 * v
        body = np.clip(1.0 - np.abs(u + wob) / np.maximum(width, 1e-3), 0, 1)
        body *= np.clip(v * 8.0, 0, 1)                           # soft base
        body = body ** 1.2
        heat = body * (0.55 + 0.9 * turb) - v * 0.55
        inten = np.clip(heat * 1.8, 0, 1)
        core = np.clip((inten - 0.55) * 2.2, 0, 1)
        rgb = ramp(inten, [(0, (0.35, 0.03, 0.0)), (0.3, (0.9, 0.22, 0.02)), (0.6, (1.0, 0.55, 0.12)), (0.85, (1.0, 0.82, 0.45)), (1, (1.0, 0.95, 0.8))])
        rgb = rgb * (1 - core[..., None] * 0.3) + core[..., None] * 0.3
        a = np.clip(inten * 1.3, 0, 1)
        gx, gy = k % grid, k // grid
        sheet[gy * fr:(gy + 1) * fr, gx * fr:(gx + 1) * fr, :3] = rgb
        sheet[gy * fr:(gy + 1) * fr, gx * fr:(gx + 1) * fr, 3] = a
    p = os.path.join(FX, "flame_sheet.png")
    save_rgb(p, sheet[..., :3], sheet[..., 3])
    write_import(p, lossless=False)
    print("fx flame_sheet")

    # Smoke puffs: 2x2 variants, 256 px each, soft billowy fbm in a round falloff.
    sz = 256
    sheet = np.zeros((sz * 2, sz * 2, 4), np.float32)
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32)
    rr = np.sqrt(((xx + 0.5) / sz - 0.5) ** 2 + ((yy + 0.5) / sz - 0.5) ** 2) * 2
    for k in range(4):
        n = spectral(sz, 310 + k, beta=2.4, lo=2) * 0.7 + spectral(sz, 320 + k, beta=1.6, lo=6) * 0.3
        fall = np.clip(1.0 - rr, 0, 1) ** 1.5
        dens = np.clip((n * 1.4 - 0.35) * fall * 1.8, 0, 1)
        dens = blur_f(dens, 1.2)
        shade = 0.65 + 0.35 * np.clip(n * 1.2 - (yy / sz) * 0.2, 0, 1)
        gx, gy = k % 2, k // 2
        sheet[gy * sz:(gy + 1) * sz, gx * sz:(gx + 1) * sz, :3] = shade[..., None]
        sheet[gy * sz:(gy + 1) * sz, gx * sz:(gx + 1) * sz, 3] = np.clip(dens, 0, 1)
    p = os.path.join(FX, "smoke_sheet.png")
    save_rgb(p, sheet[..., :3], sheet[..., 3])
    write_import(p)
    print("fx smoke_sheet")

    # Ember / spark and soft glow sprites
    for name, size, power in (("ember", 64, 2.2), ("glow", 128, 1.6)):
        yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
        r = np.sqrt(((xx + 0.5) / size - 0.5) ** 2 + ((yy + 0.5) / size - 0.5) ** 2) * 2
        a = np.clip(1 - r, 0, 1) ** power
        p = os.path.join(FX, name + ".png")
        save_rgb(p, np.ones((size, size, 3)), a)
        write_import(p)
    print("fx sprites")


SETS = {
    "bark": gen_bark, "wood": gen_wood, "endgrain": gen_endgrain, "charred": gen_charred, "granite": gen_granite,
    "chert": gen_chert, "ash": gen_ash, "forest_floor": gen_forest_floor, "steel": gen_steel, "aluminium": gen_aluminium,
    "paint": gen_paint, "rust": gen_rust, "plastic": gen_plastic, "weave": gen_weave, "knit": gen_knit, "fur": gen_fur,
    "leather": gen_leather, "suede": gen_suede, "meat": gen_meat, "fish": gen_fish, "rope": gen_rope, "grass": gen_grass,
    "paper": gen_paper, "bone": gen_bone, "birch": gen_birch, "blanket": gen_blanket, "snow": gen_snow,
    "labels": gen_labels, "fx": gen_fx,
}

if __name__ == "__main__":
    which = sys.argv[1:] or list(SETS.keys())
    for w in which:
        SETS[w]()

"""THIN AIR — POI textures (deterministic).

    python3.12 thin-air/tools/blender/poi/gen_textures.py

Writes assets/models/poi/textures/:
  poi_noise.png            256 px tileable value-noise (R) for snow patchiness in the POI shaders
  poi_decals_albedo.png    2048x1024 RGBA atlas: registration C-FKTL, cockpit instrument panel, radio faces,
                           signage (station, mine, ranger, hazards), whiteboard, topographic map, calendar,
                           paper, screens, stencils. Alpha = paint coverage (scissored in poi_decal.gdshader).
  tools/blender/poi/decals.json  atlas regions {name: [x0, y0, x1, y1]} in pixels (top-left origin), read by the
                           Blender scripts (plib decal UVs)
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "assets", "models", "poi", "textures")
FONTS = os.path.join(ROOT, "assets", "fonts")
W, H = 2048, 1024


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def value_noise(n, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells))
    x = np.arange(n) * cells / n
    i0 = np.floor(x).astype(int)
    f = x - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


def noise_png():
    n = 256
    acc = np.zeros((n, n))
    amp = 1.0
    tot = 0.0
    for o, c in enumerate((4, 8, 16, 32, 64)):
        acc += value_noise(n, c, 11 + o) * amp
        tot += amp
        amp *= 0.55
    acc /= tot
    acc = (acc - acc.min()) / (acc.max() - acc.min())
    Image.fromarray((acc * 255).astype(np.uint8), "L").save(os.path.join(OUT, "poi_noise.png"))


REG = {}


def region(name, x0, y0, w, h):
    REG[name] = [x0, y0, x0 + w, y0 + h]
    return (x0, y0, x0 + w, y0 + h)


def wear_mask(w, h, seed, amount=0.25, scale=8):
    """1 = paint kept. Speckled / chipped wear."""
    n = value_noise(max(w, h), scale, seed)[:h, :w] * 0.6 + value_noise(max(w, h), scale * 6, seed + 1)[:h, :w] * 0.4
    return (n > amount).astype(np.float32)


def paste_rgba(atlas, img, box, wear=None):
    x0, y0, x1, y1 = box
    img = img.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    if wear is not None:
        a = np.array(img).astype(np.float32)
        a[..., 3] *= wear
        img = Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA")
    atlas.alpha_composite(img, (x0, y0))


def text_center(d, box, txt, f, fill, dy=0):
    x0, y0, x1, y1 = box
    bb = d.textbbox((0, 0), txt, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text((x0 + (x1 - x0 - tw) / 2 - bb[0], y0 + (y1 - y0 - th) / 2 - bb[1] + dy), txt, font=f, fill=fill)


def gauge(d, cx, cy, r, rng, label):
    d.ellipse((cx - r - 5, cy - r - 5, cx + r + 5, cy + r + 5), fill=(28, 28, 30, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(12, 12, 13, 255), outline=(70, 70, 72, 255), width=2)
    for k in range(0, 31):
        a = math.radians(-225 + 270 * k / 30)
        r0 = r * (0.78 if k % 5 == 0 else 0.86)
        d.line((cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * r * 0.95, cy + math.sin(a) * r * 0.95),
               fill=(225, 225, 215, 255), width=3 if k % 5 == 0 else 1)
    # coloured arcs
    d.arc((cx - r * 0.95, cy - r * 0.95, cx + r * 0.95, cy + r * 0.95), -200, -120, fill=(40, 160, 60, 255), width=4)
    d.arc((cx - r * 0.95, cy - r * 0.95, cx + r * 0.95, cy + r * 0.95), -60, -45, fill=(190, 40, 30, 255), width=4)
    a = math.radians(-225 + 270 * rng.random())
    d.line((cx, cy, cx + math.cos(a) * r * 0.8, cy + math.sin(a) * r * 0.8), fill=(240, 240, 230, 255), width=4)
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=(60, 60, 60, 255))
    f = font("IBMPlexSans-Bold.ttf", max(10, int(r * 0.22)))
    text_center(d, (cx - r, cy + r * 0.25, cx + r, cy + r * 0.6), label, f, (220, 220, 210, 255))


def build_atlas():
    rng = random.Random(7)
    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(atlas)

    # --- registration (fuselage) --------------------------------------------------------------------------
    b = region("reg_cfktl", 0, 0, 1024, 200)
    im = Image.new("RGBA", (1024, 200), (0, 0, 0, 0))
    di = ImageDraw.Draw(im)
    text_center(di, (0, 0, 1024, 200), "C-FKTL", font("Inter-Bold.otf", 190), (20, 22, 26, 255), dy=4)
    paste_rgba(atlas, im, b, wear_mask(1024, 200, 3, 0.12, 20))
    b = region("reg_cfktl_red", 0, 200, 1024, 200)
    im = Image.new("RGBA", (1024, 200), (0, 0, 0, 0))
    di = ImageDraw.Draw(im)
    text_center(di, (0, 0, 1024, 200), "C-FKTL", font("Inter-Bold.otf", 190), (150, 22, 20, 255), dy=4)
    paste_rgba(atlas, im, b, wear_mask(1024, 200, 4, 0.12, 20))

    # --- cockpit instrument panel ------------------------------------------------------------------------
    b = region("otter_panel", 1024, 0, 768, 320)
    x0, y0 = b[0], b[1]
    d.rounded_rectangle((x0, y0, x0 + 767, y0 + 319), 18, fill=(38, 40, 42, 255))
    labels = ["AIRSPEED", "ATTITUDE", "ALTITUDE", "MANIFOLD", "TURN", "HEADING", "V/SPEED", "RPM", "OIL T", "FUEL"]
    for i, lab in enumerate(labels[:8]):
        cx = x0 + 70 + (i % 4) * 128
        cy = y0 + 78 + (i // 4) * 150
        gauge(d, cx, cy, 52, rng, lab)
    # radio stack
    for k in range(3):
        ry = y0 + 22 + k * 96
        d.rectangle((x0 + 560, ry, x0 + 750, ry + 82), fill=(18, 18, 20, 255), outline=(80, 80, 80, 255))
        d.rectangle((x0 + 575, ry + 14, x0 + 690, ry + 44), fill=(28, 8, 6, 255))
        txt = ["126.70", "122.80", "5.0150"][k]
        d.text((x0 + 580, ry + 14), txt, font=font("IBMPlexMono-Medium.ttf", 26), fill=(255, 120, 60, 255))
        for kk in range(2):
            d.ellipse((x0 + 700 + kk * 0, ry + 50 - kk * 36, x0 + 730 + kk * 0, ry + 80 - kk * 36),
                      fill=(55, 55, 58, 255), outline=(120, 120, 120, 255))
        d.text((x0 + 580, ry + 54), ["COM 1", "COM 2", "HF"][k], font=font("IBMPlexSans-Bold.ttf", 16),
               fill=(200, 200, 190, 255))
    # --- small otter stencils ----------------------------------------------------------------------------
    b = region("otter_nostep", 1792, 0, 256, 64)
    text_center(d, b, "NO STEP", font("IBMPlexSans-Bold.ttf", 44), (25, 25, 25, 255))
    b = region("otter_exit", 1792, 64, 256, 64)
    text_center(d, b, "EMERGENCY EXIT", font("IBMPlexSans-Bold.ttf", 28), (170, 25, 20, 255))
    b = region("otter_elt", 1792, 128, 256, 64)
    d.rectangle(b, fill=(230, 120, 20, 255))
    text_center(d, b, "ELT  >  ON / ARM", font("IBMPlexSans-Bold.ttf", 24), (15, 15, 15, 255))
    b = region("otter_fuel", 1792, 192, 256, 64)
    text_center(d, b, "100LL AVGAS", font("IBMPlexSans-Bold.ttf", 34), (200, 30, 20, 255))
    b = region("otter_wing_reg", 1792, 256, 256, 64)
    text_center(d, b, "C-FKTL", font("Inter-Bold.otf", 56), (20, 22, 26, 255))

    # --- HF radio face -------------------------------------------------------------------------------------
    b = region("radio_face", 1024, 320, 384, 160)
    x0, y0 = b[0], b[1]
    d.rectangle((x0, y0, x0 + 383, y0 + 159), fill=(52, 56, 52, 255))
    d.rectangle((x0 + 20, y0 + 20, x0 + 200, y0 + 70), fill=(20, 30, 18, 255))
    d.text((x0 + 30, y0 + 24), "5.0150", font=font("IBMPlexMono-Medium.ttf", 38), fill=(120, 220, 110, 255))
    for k in range(4):
        cx = x0 + 240 + (k % 2) * 80
        cy = y0 + 45 + (k // 2) * 70
        d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), fill=(22, 22, 22, 255), outline=(150, 150, 140, 255), width=2)
        d.line((cx, cy, cx + 18 * math.cos(k * 1.3), cy + 18 * math.sin(k * 1.3)), fill=(220, 220, 210, 255), width=3)
    d.text((x0 + 20, y0 + 90), "SPILSBURY  SBX-11A", font=font("IBMPlexSans-Bold.ttf", 22), fill=(220, 220, 205, 255))
    d.text((x0 + 20, y0 + 120), "VOL   SQL   CH   PWR", font=font("IBMPlexSans-Medium.ttf", 18), fill=(200, 200, 190, 255))

    # --- signage ----------------------------------------------------------------------------------------------
    b = region("sign_kestrel", 0, 400, 1024, 256)
    x0, y0 = b[0], b[1]
    d.rectangle((x0, y0, x0 + 1023, y0 + 255), fill=(18, 44, 86, 255))
    d.rectangle((x0 + 10, y0 + 10, x0 + 1013, y0 + 245), outline=(235, 235, 230, 255), width=5)
    text_center(d, (x0, y0 + 20, x0 + 1024, y0 + 150), "KESTREL STATION", font("Inter-Bold.otf", 110),
                (240, 240, 235, 255))
    text_center(d, (x0, y0 + 150, x0 + 1024, y0 + 230), "ALDOUS RANGE GLACIOLOGY FIELD STATION  ·  EL. 2950 m",
                font("IBMPlexSans-Medium.ttf", 34), (215, 225, 235, 255))

    b = region("sign_mine", 0, 656, 1024, 200)
    im = Image.new("RGBA", (1024, 200), (0, 0, 0, 0))
    di = ImageDraw.Draw(im)
    text_center(di, (0, 0, 1024, 130), "ASHFORD GOLD MINES LTD.", font("IBMPlexSans-Bold.ttf", 84), (228, 222, 205, 255))
    text_center(di, (0, 120, 1024, 200), "No. 1 ADIT          EST. 1932", font("IBMPlexSans-SemiBold.ttf", 52),
                (228, 222, 205, 255))
    paste_rgba(atlas, im, b, wear_mask(1024, 200, 9, 0.38, 14))

    b = region("sign_danger", 1024, 480, 512, 256)
    x0, y0 = b[0], b[1]
    im = Image.new("RGBA", (512, 256), (238, 236, 228, 255))
    di = ImageDraw.Draw(im)
    di.rectangle((0, 0, 511, 90), fill=(180, 26, 22, 255))
    text_center(di, (0, 0, 512, 90), "DANGER", font("Inter-Bold.otf", 76), (250, 250, 245, 255))
    text_center(di, (0, 95, 512, 170), "OLD MINE WORKINGS", font("IBMPlexSans-Bold.ttf", 44), (20, 20, 20, 255))
    text_center(di, (0, 170, 512, 250), "KEEP OUT  ·  STAY ALIVE", font("IBMPlexSans-Bold.ttf", 36), (20, 20, 20, 255))
    paste_rgba(atlas, im, b, wear_mask(512, 256, 12, 0.18, 12))

    b = region("sign_ranger", 1536, 480, 512, 192)
    x0, y0 = b[0], b[1]
    im = Image.new("RGBA", (512, 192), (0, 0, 0, 0))
    di = ImageDraw.Draw(im)
    text_center(di, (0, 8, 512, 100), "LOON LAKE", font("IBMPlexSans-Bold.ttf", 70), (226, 190, 70, 255))
    text_center(di, (0, 100, 512, 180), "RANGER STATION", font("IBMPlexSans-Bold.ttf", 50), (226, 190, 70, 255))
    paste_rgba(atlas, im, b, wear_mask(512, 192, 14, 0.15, 16))

    b = region("sign_diesel", 1536, 672, 256, 128)
    d.rectangle(b, fill=(200, 30, 24, 255))
    text_center(d, (b[0], b[1], b[2], b[1] + 80), "DIESEL", font("Inter-Bold.otf", 60), (250, 250, 245, 255))
    text_center(d, (b[0], b[1] + 76, b[2], b[3]), "NO SMOKING", font("IBMPlexSans-Bold.ttf", 28), (250, 250, 245, 255))

    b = region("sign_hv", 1792, 672, 256, 128)
    d.rectangle(b, fill=(245, 200, 30, 255))
    d.polygon([(b[0] + 40, b[1] + 100), (b[0] + 70, b[1] + 20), (b[0] + 100, b[1] + 100)], outline=(15, 15, 15, 255),
              width=6)
    d.text((b[0] + 62, b[1] + 42), "!", font=font("Inter-Bold.otf", 50), fill=(15, 15, 15, 255))
    d.text((b[0] + 112, b[1] + 22), "DANGER", font=font("Inter-Bold.otf", 34), fill=(15, 15, 15, 255))
    d.text((b[0] + 112, b[1] + 66), "HIGH VOLTAGE", font=font("IBMPlexSans-Bold.ttf", 20), fill=(15, 15, 15, 255))

    b = region("sign_relay", 1536, 800, 512, 128)
    d.rectangle(b, fill=(240, 240, 235, 255))
    d.rectangle((b[0], b[1], b[2], b[1] + 44), fill=(20, 60, 130, 255))
    text_center(d, (b[0], b[1], b[2], b[1] + 44), "KESTREL RELAY  KR-1", font("Inter-Bold.otf", 34), (250, 250, 250, 255))
    text_center(d, (b[0], b[1] + 44, b[2], b[1] + 88), "AUTHORIZED PERSONNEL ONLY", font("IBMPlexSans-Bold.ttf", 30),
                (20, 20, 20, 255))
    text_center(d, (b[0], b[1] + 86, b[2], b[3]), "RF EXPOSURE ABOVE THIS POINT", font("IBMPlexSans-Medium.ttf", 26),
                (160, 30, 20, 255))

    b = region("plate_lab", 1536, 928, 170, 48)
    b2 = region("plate_bunk", 1706, 928, 170, 48)
    b3 = region("plate_main", 1876, 928, 170, 48)
    for bb, txt in ((b, "A · LAB"), (b2, "C · BUNKS"), (b3, "B · MAIN")):
        d.rectangle(bb, fill=(240, 240, 235, 255), outline=(30, 30, 30, 255), width=3)
        text_center(d, bb, txt, font("IBMPlexSans-Bold.ttf", 28), (20, 20, 20, 255))
    b = region("hazard", 1536, 976, 512, 48)
    for k in range(-2, 24):
        x = b[0] + k * 32
        d.polygon([(x, b[3]), (x + 16, b[3]), (x + 16 + 48, b[1]), (x + 48, b[1])], fill=(20, 20, 20, 255))
    # fill background yellow under stripes
    sub = atlas.crop(b)
    bg = Image.new("RGBA", sub.size, (238, 190, 30, 255))
    bg.alpha_composite(sub)
    atlas.paste(bg, b[:2])

    # --- whiteboard -----------------------------------------------------------------------------------------
    b = region("whiteboard", 1024, 736, 512, 288)
    x0, y0 = b[0], b[1]
    d.rectangle((x0, y0, x0 + 511, y0 + 287), fill=(236, 238, 236, 255))
    lines = [("RELAY DOWN since 7 Oct - ice on dish?", (30, 60, 160)),
             ("Gen #2: 190 L diesel left  (~9 days)", (20, 20, 20)),
             ("Hale + Park -> summit when wind < 40", (170, 30, 30)),
             ("O2 concentrator: filter changed 2 Oct", (20, 20, 20)),
             ("DON'T use icefall line - seracs moving", (170, 30, 30)),
             ("Stake survey: 14/22 done", (30, 60, 160)),
             ("Heli: Terrace 1 Nov (weather)", (20, 20, 20))]
    f = font("IBMPlexSans-Italic.ttf", 25)
    for i, (txt, c) in enumerate(lines):
        yy = y0 + 14 + i * 38
        xx = x0 + 16 + rng.randint(-4, 6)
        d.text((xx, yy), txt, font=f, fill=(*c, 255))
    # a sketch: glacier profile
    pts = [(x0 + 330 + k * 18, y0 + 250 - 40 * math.exp(-((k - 5) ** 2) / 10.0)) for k in range(10)]
    d.line(pts, fill=(30, 60, 160, 255), width=3)

    # --- topographic map ------------------------------------------------------------------------------------
    b = region("topo_map", 0, 856, 256, 168)
    x0, y0 = b[0], b[1]
    n = value_noise(256, 5, 21)[:168, :256] * 0.7 + value_noise(256, 12, 22)[:168, :256] * 0.3
    img = np.zeros((168, 256, 4), np.uint8)
    img[..., 0] = 236
    img[..., 1] = 230
    img[..., 2] = 210
    img[..., 3] = 255
    lv = (n * 24).astype(int)
    edge = np.zeros_like(lv, bool)
    edge[:, 1:] |= lv[:, 1:] != lv[:, :-1]
    edge[1:, :] |= lv[1:, :] != lv[:-1, :]
    img[edge] = (150, 100, 60, 255)
    img[n < 0.28] = (130, 170, 200, 255)
    img[n > 0.78] = (240, 244, 248, 255)
    for k in range(0, 256, 32):
        img[:, k] = (90, 110, 160, 255)
    for k in range(0, 168, 32):
        img[k, :] = (90, 110, 160, 255)
    atlas.paste(Image.fromarray(img, "RGBA"), (x0, y0))

    # --- calendar, paper, crate stencil, terminal screen ---------------------------------------------------------
    b = region("calendar", 256, 856, 112, 168)
    x0, y0 = b[0], b[1]
    d.rectangle(b, fill=(245, 243, 236, 255))
    d.rectangle((x0, y0, x0 + 111, y0 + 70), fill=(70, 110, 140, 255))
    d.text((x0 + 10, y0 + 76), "OCTOBER", font=font("IBMPlexSans-Bold.ttf", 18), fill=(160, 30, 30, 255))
    for r_ in range(5):
        for c in range(7):
            d.rectangle((x0 + 6 + c * 14, y0 + 100 + r_ * 12, x0 + 18 + c * 14, y0 + 110 + r_ * 12),
                        outline=(120, 120, 120, 255))
    b = region("paper", 368, 856, 112, 168)
    x0, y0 = b[0], b[1]
    d.rectangle(b, fill=(240, 236, 222, 255))
    for k in range(12):
        d.line((x0 + 8, y0 + 14 + k * 12, x0 + 8 + rng.randint(50, 96), y0 + 14 + k * 12), fill=(40, 40, 70, 255), width=2)
    b = region("stencil_kestrel", 480, 856, 288, 84)
    text_center(d, (b[0], b[1], b[2], b[1] + 50), "KESTREL STN", font("Inter-Bold.otf", 44), (25, 25, 25, 255))
    text_center(d, (b[0], b[1] + 46, b[2], b[3]), "THIS SIDE UP  ·  FRAGILE", font("IBMPlexSans-Bold.ttf", 22),
                (25, 25, 25, 255))
    b = region("stencil_ashford", 480, 940, 288, 84)
    text_center(d, (b[0], b[1], b[2], b[1] + 50), "POWDER", font("Inter-Bold.otf", 50), (170, 30, 20, 255))
    text_center(d, (b[0], b[1] + 48, b[2], b[3]), "KEEP LOCKED", font("IBMPlexSans-Bold.ttf", 26), (170, 30, 20, 255))
    b = region("screen_terminal", 768, 856, 256, 168)
    x0, y0 = b[0], b[1]
    d.rectangle(b, fill=(8, 16, 22, 255))
    f = font("IBMPlexMono-Regular.ttf", 13)
    for k, txt in enumerate(["KR-1 LINK .... NO CARRIER", "AWS  T -18.4C  W 22m/s NW", "P 702 hPa  RH 81%",
                             "GEN2  OFF   BATT 11.6V", "O2C   STANDBY", "> retry uplink", "  timeout (30s)", "> _"]):
        d.text((x0 + 8, y0 + 8 + k * 19), txt, font=f, fill=(120, 230, 200, 255))
    b = region("gen_panel", 1408, 320, 256, 160)
    x0, y0 = b[0], b[1]
    d.rectangle(b, fill=(40, 44, 48, 255))
    gauge(d, x0 + 60, y0 + 62, 42, rng, "VOLTS")
    gauge(d, x0 + 160, y0 + 62, 42, rng, "AMPS")
    d.rectangle((x0 + 205, y0 + 18, x0 + 245, y0 + 48), fill=(15, 15, 15, 255))
    d.text((x0 + 208, y0 + 24), "0417", font=font("IBMPlexMono-Medium.ttf", 16), fill=(230, 230, 220, 255))
    d.text((x0 + 16, y0 + 118), "START   RUN   STOP", font=font("IBMPlexSans-Bold.ttf", 22), fill=(230, 230, 220, 255))
    d.ellipse((x0 + 212, y0 + 100, x0 + 244, y0 + 132), fill=(190, 30, 25, 255))
    b = region("label_o2", 1664, 320, 128, 160)
    d.rectangle(b, fill=(30, 120, 60, 255))
    text_center(d, (b[0], b[1] + 10, b[2], b[1] + 80), "O₂", font("Inter-Bold.otf", 60), (250, 250, 250, 255))
    text_center(d, (b[0], b[1] + 80, b[2], b[3] - 10), "OXYGEN", font("IBMPlexSans-Bold.ttf", 24), (250, 250, 250, 255))
    b = region("sign_drift2", 1792, 320, 256, 96)
    im = Image.new("RGBA", (256, 96), (0, 0, 0, 0))
    di = ImageDraw.Draw(im)
    text_center(di, (0, 0, 256, 96), "No. 2 DRIFT", font("IBMPlexSans-Bold.ttf", 44), (230, 120, 30, 255))
    paste_rgba(atlas, im, b, wear_mask(256, 96, 31, 0.3, 10))
    b = region("paint_arrow", 1792, 416, 256, 64)
    im = Image.new("RGBA", (256, 64), (0, 0, 0, 0))
    di = ImageDraw.Draw(im)
    di.polygon([(10, 24), (180, 24), (180, 6), (246, 32), (180, 58), (180, 40), (10, 40)], fill=(235, 110, 20, 255))
    paste_rgba(atlas, im, b, wear_mask(256, 64, 33, 0.25, 8))
    return atlas


def main():
    os.makedirs(OUT, exist_ok=True)
    noise_png()
    atlas = build_atlas()
    # Bleed colour under transparent texels so mip levels don't fringe dark.
    a = np.array(atlas).astype(np.float32)
    rgb = Image.fromarray(a[..., :3].astype(np.uint8), "RGB")
    mask = a[..., 3] > 0
    blur = np.array(rgb.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    wsum = np.array(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(
        np.float32) / 255.0
    fill = blur / np.maximum(wsum[..., None], 1e-3)
    a[..., :3] = np.where(mask[..., None], a[..., :3], fill.clip(0, 255))
    Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "poi_decals_albedo.png"),
                                                                  optimize=True)
    with open(os.path.join(HERE, "decals.json"), "w") as fh:
        json.dump({"size": [W, H], "regions": REG}, fh, indent=1)
    print("[poi] textures ->", OUT, len(REG), "decal regions")


if __name__ == "__main__":
    main()

"""STARWAKE -- the edit.

SHOTS is the picture cut in order. Each shot names a scene shader,
its duration, shader params, grade, and the dialogue cues that land
in it (line id, seconds from shot start).
"""
from collections import OrderedDict
import os
from PIL import Image, ImageDraw, ImageFont

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")


def _font(name, size, weight=None):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    if weight is not None:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


def spaced(draw, xy, text, font, fill, spacing, anchor_center=True):
    """Draw text with extra letter spacing, centred on xy."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - total / 2 if anchor_center else xy[0]
    for ch, w in zip(text, widths):
        draw.text((x, xy[1]), ch, font=font, fill=fill, anchor="lm")
        x += w + spacing


def title_card(W, H, sub=None):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = H / 804
    spaced(d, (W / 2, H * .5), "STARWAKE", _font("Cinzel[wght].ttf", int(118 * s), 500),
           (255, 236, 205, 255), int(34 * s))
    if sub:
        spaced(d, (W / 2, H * .64), sub, _font("CormorantGaramond[wght].ttf", int(30 * s), 500),
               (200, 215, 240, 235), int(9 * s))
    return img


def hud_text(W, H):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = H / 804
    f = _font("Marcellus-Regular.ttf", int(17 * s))
    col = (120, 220, 255, 210)
    d.text((W * .5 + 0.60 * H, H * .5 + 0.10 * H), "COMMS  \u00b7  THRONE FLAGSHIP", font=f, fill=col, anchor="lm")
    d.text((W * .5 - 0.80 * H, H * .5 - 0.33 * H), "KESSAR  \u00b7  STELLAR OUTPUT  0.00%", font=f, fill=col, anchor="lm")
    d.text((W * .5 - 0.80 * H, H * .5 - 0.30 * H), "SURFACE  \u2212214 \u00b0C", font=f, fill=col, anchor="lm")
    return img


def caption(text, y=0.86, size=26):
    def make(W, H):
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        s = H / 804
        spaced(d, (W / 2, H * y), text, _font("CormorantGaramond[wght].ttf", int(size * s), 500), (235, 238, 245, 255), int(10 * s))
        return img
    return make


def text_card(lines):
    def make(W, H):
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        s = H / 804
        y = H * .5 - (len(lines) - 1) * 26 * s
        for i, ln in enumerate(lines):
            f = _font("CormorantGaramond[wght].ttf", int((40 if i == 0 else 30) * s), 500)
            spaced(d, (W / 2, y), ln, f, (225, 232, 245, 255), int(6 * s))
            y += 52 * s
        return img
    return make


CREDITS = [
    ("title", "STARWAKE"), ("gap", ""),
    ("head", "Written, Directed & Rendered by"), ("name", "Claude"), ("gap", ""),
    ("small", "Made in loving homage to the films of Steven Spielberg,"),
    ("small", "the music of John Williams, the photography of Janusz Kami\u0144ski,"),
    ("small", "the sound of Ben Burtt, and the editing of Michael Kahn."), ("gap", ""),
    ("head", "THE CAST"), ("gap", ""),
    ("role", "Ilune  \u2014  voiced by Kokoro \u201cEmma\u201d"),
    ("role", "Commander Asha Venn  \u2014  voiced by Kokoro \u201cHeart\u201d"),
    ("role", "Young Asha  \u2014  voiced by Kokoro \u201cHeart\u201d"),
    ("role", "Her Father  \u2014  voiced by Kokoro \u201cFenrir\u201d"),
    ("role", "Nim  \u2014  who only knows the words it hears"),
    ("role", "Grand Admiral Varro Kade  \u2014  voiced by Kokoro \u201cGeorge\u201d"),
    ("role", "Lieutenant Jax Orren  \u2014  voiced by Kokoro \u201cMichael\u201d"),
    ("role", "Sable  \u2014  voiced by Kokoro \u201cKore\u201d"),
    ("role", "Harvest Officer  \u2014  voiced by Kokoro \u201cEcho\u201d"), ("gap", ""),
    ("head", "The Star Song"), ("name", "hummed by a voice built in code"), ("gap", ""),
    ("head", "Original Score"), ("name", "composed in code, performed by FluidSynth"), ("gap", ""),
    ("head", "Visual Effects"), ("name", "every frame raymarched in GLSL on a CPU"), ("gap", ""),
    ("head", "Built with free and open tools"),
    ("small", "Kokoro-82M text-to-speech (Apache 2.0)  \u00b7  FluidSynth & FluidR3 GM soundfont (MIT)"),
    ("small", "Mesa llvmpipe  \u00b7  moderngl  \u00b7  NumPy  \u00b7  SciPy  \u00b7  SoX  \u00b7  FFmpeg"),
    ("small", "Cinzel & Cormorant Garamond typefaces (SIL Open Font License)"), ("gap", ""), ("gap", ""),
    ("name", "Every star is a song."), ("gap", ""), ("gap", ""),
]


def credits_final_offset():
    """Scroll offset (in 804-line pixels) that parks the last credit at screen centre."""
    y = 804.0
    for kind, txt in CREDITS:
        if txt == "Every star is a song.":
            return y - 804 / 2
        y += 56 * (1.6 if kind == "title" else 1.0)
    return y


def credits_roll(W, H):
    s = H / 804
    sizes = dict(title=(("Cinzel[wght].ttf", 70, 500), 26, (255, 236, 205, 255)),
                 head=(("CormorantGaramond[wght].ttf", 26, 600), 6, (170, 190, 225, 255)),
                 name=(("CormorantGaramond[wght].ttf", 36, 500), 4, (240, 240, 250, 255)),
                 role=(("CormorantGaramond[wght].ttf", 30, 500), 2, (230, 232, 245, 255)),
                 small=(("CormorantGaramond[wght].ttf", 24, 500), 1, (190, 200, 220, 255)),
                 gap=(None, 0, None))
    step = 56 * s
    total = int(H * 2 + step * len(CREDITS))
    img = Image.new("RGBA", (W, total), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = H
    for kind, txt in CREDITS:
        font, sp, fill = sizes[kind]
        if font:
            f = _font(font[0], int(font[1] * s), font[2])
            spaced(d, (W / 2, y), txt, f, fill, int(sp * s))
        y += step * (1.6 if kind == "title" else 1.0)
    return img

SHOTS = OrderedDict()


def shot(sid, shader, dur, lines=(), **kw):
    kw.update(shader=shader, dur=dur, lines=list(lines))
    SHOTS[sid] = kw


# ======================================================== PROLOGUE
shot("S01", "galaxy.glsl", 14.0, [("N1", 3.2), ("N2", 6.6)], rscale=0.6,
     params=dict(uP0=(1, 0, 0, 1), uP1=(1.0, 0.42, 0.6, 0.9)),
     fade_in=3.5, grade=dict(bloom=0.12, streak=0.25, gain=(1.0, 0.98, 1.05)))
shot("S02", "galaxy.glsl", 9.0, [("N3", 1.2)], rscale=0.6, params=dict(uP0=(1, 0, 1, 1), uP1=(1.0, 0.42, 0.6, 0.0)),
     grade=dict(bloom=0.12, streak=0.25))
shot("S06", "galaxy.glsl", 8.0, [], rscale=0.6, params=dict(uP0=(1, 0, 0, .12), uP1=(0.85, 0.5, 2.2, 0.3)),
     grade=dict(bloom=0.12, streak=0.3))
shot("S07", "title.glsl", 10.0, [], params=dict(uP0=(0, 0, 0, 0)), fade_out=1.5,
     text=dict(make=lambda W, H: title_card(W, H), gain=[(0, 0), (3.1, 0), (4.2, 1.6), (6, 1.25), (10, 1.1)]),
     grade=dict(bloom=0.18, streak=0.6, streak_thresh=0.9))
shot("S03", "space.glsl", 11.0, [],
     params=dict(uP0=(3, 0, 0, 0)), grade=dict(bloom=0.07, streak=0.15, streak_tint=(1.0, 0.6, 0.35)))
shot("S04", "space.glsl", 6.0, [],
     params=dict(uP0=(4, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4, streak_tint=(1.0, 0.6, 0.35)))
shot("S05", "space.glsl", 11.0, [("N4", 2.0)],
     params=dict(uP0=(5, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.3, streak_tint=(1.0, 0.6, 0.35)))
shot("S08", "space.glsl", 13.0, [("H1", 3.5), ("K1", 9.2)],
     params=dict(uP0=(6, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.3),
     text=dict(make=caption("TWENTY YEARS LATER"), gain=[(0, 0), (0.8, 0), (1.8, 0.9), (4.5, 0.9), (5.8, 0)]))

shot("S09", "space.glsl", 12.0, [("A1", 1.5)], params=dict(uP0=(7, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.3))
shot("S10", "cockpit.glsl", 12.0, [("K2", 0.8), ("A2", 2.8), ("K3", 4.2)],
     text=dict(make=lambda W, H: hud_text(W, H), gain=[(0, 0.6), (12, 0.6)]),
     grade=dict(bloom=0.1, streak=0.2, vig=0.8))
shot("S11", "space.glsl", 10.0, [("A3", 0.3), ("K4", 1.8), ("A4", 7.3)], params=dict(uP0=(8, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.3))
shot("S12", "space.glsl", 9.0, [("J1", 0.4), ("A5", 5.15)], params=dict(uP0=(9, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.4))
shot("S13", "warp.glsl", 5.0, [], grade=dict(bloom=0.14, streak=0.5), mb=3)
shot("S14", "space.glsl", 16.0, [("A6", 3.4)], params=dict(uP0=(10, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4))
shot("S15", "space.glsl", 12.0, [("A7", 0.8), ("S1", 3.0), ("J3", 9.9)], params=dict(uP0=(11, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.3))
shot("S16", "space.glsl", 9.0, [("A8", 0.4), ("A9", 1.8)], params=dict(uP0=(12, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4))
shot("S30", "space.glsl", 13.0, [("K5", 5.0), ("K6", 9.5)], params=dict(uP0=(13, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4))
shot("S31", "space.glsl", 11.0, [("H2", 1.0)], params=dict(uP0=(14, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.3))

shot("S17", "veyra.glsl", 14.0, [], rscale=0.6, params=dict(uP0=(1, 0, 0, 0)), grade=dict(bloom=0.1, streak=0.2, streak_tint=(1.0, 0.7, 0.5), exposure=0.85, contrast=1.1, sat=1.15))
shot("S16", "veyra.glsl", 9.0, [("A8", 0.4), ("A9", 1.8)], rscale=0.6, params=dict(uP0=(3, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.3, streak_tint=(1.0, 0.7, 0.5)))
shot("S18", "veyra.glsl", 7.5, [("S2", 0.9), ("A10", 4.35), ("J4", 6.05)], rscale=0.6, params=dict(uP0=(4, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.35))
shot("S19", "veyra.glsl", 6.0, [], rscale=0.6, params=dict(uP0=(5, 0, 0, 0)), fade_out=1.2, grade=dict(bloom=0.14, streak=0.3))
shot("S20", "veyra.glsl", 12.0, [("A11", 7.5)], rscale=0.6, params=dict(uP0=(2, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))

shot("S21", "veyra.glsl", 12.0, [("I1", 7.0)], rscale=0.6, params=dict(uP0=(6, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))
shot("S22", "veyra.glsl", 8.0, [("A12", 0.5), ("I2", 2.5), ("A13", 5.6)], rscale=0.6, params=dict(uP0=(7, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))
shot("S23", "eye.glsl", 5.5, [("I3", 1.3)], grade=dict(bloom=0.12, streak=0.2, vig=0.85))
shot("S24", "veyra.glsl", 13.0, [("I4", 1.0)], rscale=0.6, params=dict(uP0=(8, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))
shot("S25", "veyra.glsl", 14.5, [("A14", 0.5), ("I5", 9.5), ("I6", 12.1)], rscale=0.6, params=dict(uP0=(9, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))
shot("S26", "chamber.glsl", 12.0, [("I7", 8.0)], params=dict(uP0=(1, 0, 0, 0)), grade=dict(bloom=0.16, streak=0.3, streak_tint=(0.5, 1.0, 0.9)))
shot("S27", "chamber.glsl", 6.0, [], params=dict(uP0=(2, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.35, streak_tint=(0.5, 1.0, 0.9), exposure=0.8))
shot("S28", "core.glsl", 12.0, [("I8", 1.2), ("A15", 7.6)], params=dict(uP0=(1, 0, 0, 0)), fade_in=0.4, fade_out=0.6, grade=dict(bloom=0.16, streak=0.35, streak_tint=(1.0, 0.6, 0.4), ca=3.0))
shot("S29", "chamber.glsl", 7.0, [("I9", 1.4)], params=dict(uP0=(3, 0, 0, 0)), grade=dict(bloom=0.16, streak=0.3, streak_tint=(0.5, 1.0, 0.9)))
shot("S32", "veyra.glsl", 12.0, [("I10", 6.0)], rscale=0.6, params=dict(uP0=(10, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.3, streak_tint=(1.0, 0.6, 0.4)))
shot("S33", "veyra.glsl", 10.0, [], rscale=0.6, params=dict(uP0=(11, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.35, streak_tint=(1.0, 0.6, 0.4)))
shot("S34", "space.glsl", 11.5, [("K7", 0.5), ("A16", 8.4)], params=dict(uP0=(15, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4))
shot("S35", "space.glsl", 10.0, [("K8", 0.3), ("S3", 5.4)], params=dict(uP0=(16, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4))
shot("S36", "space.glsl", 8.0, [("J5", 0.2), ("A17", 3.9), ("J6", 4.9)], params=dict(uP0=(17, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4))
shot("S37", "core.glsl", 9.0, [("S4", 1.0), ("K9", 5.3)], params=dict(uP0=(2, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4, streak_tint=(1.0, 0.6, 0.4), exposure=0.6, contrast=1.15), mb=2)
shot("S38", "core.glsl", 4.0, [("A18", 0.8)], params=dict(uP0=(3, 0, 0, 0)), sdur=8.0, grade=dict(bloom=0.16, streak=0.4))
shot("V2", "visor.glsl", 13.0, [("A22", 1.2), ("HUM3", 3.0), ("A19", 10.6)], params=dict(uP0=(2, 0, 0, 0)), grade=dict(bloom=0.16, streak=0.35, streak_tint=(1.0, 0.6, 0.4), vig=0.8))
shot("S38b", "core.glsl", 3.7, [], params=dict(uP0=(3, 0, 0, 0)), toff=4.3, sdur=8.0, grade=dict(bloom=0.16, streak=0.4))
shot("S39", "core.glsl", 6.0, [], params=dict(uP0=(4, 0, 0, 0)), grade=dict(bloom=0.2, streak=0.5))
shot("S40", "space.glsl", 12.0, [], params=dict(uP0=(18, 0, 0, 0)), grade=dict(bloom=0.16, streak=0.5))
shot("S41", "galaxy.glsl", 10.0, [], rscale=0.6, params=dict(uP0=(.12, 1, 0, 1), uP1=(0.85, 0.5, 2.6, -0.25)),
     grade=dict(bloom=0.14, streak=0.35, streak_tint=(1.0, 0.8, 0.5)))
shot("S42", "space.glsl", 12.0, [], params=dict(uP0=(19, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.4, streak_tint=(1.0, 0.7, 0.45), exposure=0.7))
shot("S43", "veyra.glsl", 24.0, [("J7", 0.5), ("I11", 3.6), ("M3", 13.8), ("A20", 18.6), ("M4", 19.8), ("I12", 21.0)], rscale=0.6, params=dict(uP0=(12, 0, 0, 0)), grade=dict(bloom=0.12, streak=0.3, streak_tint=(1.0, 0.75, 0.5)))

shot("S44", "title.glsl", 8.0, [], params=dict(uP0=(1, 0, 0, 0)), fade_in=0.5, fade_out=1.0,
     text=dict(make=lambda W, H: title_card(W, H, "EVERY STAR IS A SONG"), gain=[(0, 0), (2.8, 0), (4, 1.4), (8, 1.2)]),
     grade=dict(bloom=0.18, streak=0.6, streak_thresh=0.9))
shot("S45", "title.glsl", 48.0, [], params=dict(uP0=(1, 1, 0, 0)), fade_in=1.0, fade_out=3.0,
     text=dict(make=credits_roll, gain=[(0, 1.0), (48, 1.0)],
               scroll=[(0, 0), (41, credits_final_offset()), (48, credits_final_offset())]),
     grade=dict(bloom=0.08, streak=0.2, exposure=1.0))

# ---- the Spielberg pass: a cold open on Kessar, reactions before reveals, a child, a song
shot("K1", "kessar.glsl", 11.0, [("Y1", 5.0)], params=dict(uP0=(1, 0, 0, 0)), fade_in=1.0,
     text=dict(make=caption("KESSAR"), gain=[(0, 0), (1.0, 0), (2.0, 0.85), (4.2, 0.85), (5.2, 0)]),
     grade=dict(bloom=0.14, streak=0.3, streak_tint=(1.0, 0.55, 0.35)))
shot("K2", "kessar.glsl", 17.0, [("F1", 0.6), ("Y2", 3.0), ("F2", 5.4), ("HUM1", 10.8)], params=dict(uP0=(2, 0, 0, 0)),
     grade=dict(bloom=0.14, streak=0.3, streak_tint=(1.0, 0.55, 0.35)))
shot("K3", "kessar.glsl", 13.0, [("HUM1b", 0.8), ("F3", 5.2)], params=dict(uP0=(3, 0, 0, 0)), fade_out=1.0,
     grade=dict(bloom=0.14, streak=0.35, streak_tint=(1.0, 0.55, 0.35)))
shot("V1", "visor.glsl", 6.0, [("J2", 2.2)], params=dict(uP0=(1, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.3, vig=0.8))
shot("C1", "veyra.glsl", 9.0, [("M1", 1.4), ("A11b", 4.0), ("M2", 6.2)], rscale=0.6, params=dict(uP0=(14, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))
shot("H3", "veyra.glsl", 18.5, [("HUM2", 0.6), ("A21", 7.4), ("I13", 9.3)], rscale=0.6, params=dict(uP0=(13, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.25))
shot("K5", "kessar.glsl", 10.0, [], params=dict(uP0=(5, 0, 0, 0)), grade=dict(bloom=0.14, streak=0.35, streak_tint=(1.0, 0.75, 0.45), exposure=0.72, contrast=1.12, sat=1.1))

ORDER = ["S01", "S02", "S03", "S04", "K1", "K2", "K3", "S05", "S06", "S07",
         "S08", "S09", "S10", "S11", "S12", "S13",
         "V1", "S14", "S15", "S16", "S17", "S18", "S19", "S20", "C1", "S21", "S22", "S23", "H3", "S24", "S25",
         "S26", "S27", "S28", "S29",
         "S30", "S31", "S32", "S33", "S34", "S35", "S36", "S37", "S38", "V2", "S38b", "S39", "S40", "S41", "S42", "K5",
         "S43", "S44", "S45"]


def timeline_starts():
    assert sorted(ORDER) == sorted(SHOTS), set(ORDER) ^ set(SHOTS)
    items = [(k, SHOTS.pop(k)) for k in ORDER]
    SHOTS.update(items)
    t = 0.0
    for sid, s in SHOTS.items():
        s["start"] = t
        t += s["dur"]
    return t


TOTAL = timeline_starts()

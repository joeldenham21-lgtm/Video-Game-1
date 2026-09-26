#!/usr/bin/env python3
"""THIN AIR — UI line-icon set (assets/ui/icons/*.svg).

One visual language for every HUD / menu / touch icon: 24-unit grid, 1.75 stroke, round caps and joins,
white strokes (tinted in Godot with modulate), a few solid shapes where a filled mark reads better
(bleeding drop, play/stop, markers). Original geometry written for the project.

Usage (from repo root):
    python3 thin-air/tools/ui/gen_icons.py                 # write the SVGs
    python3 thin-air/tools/ui/gen_icons.py --fix-imports   # after `godot --import`: 4x raster + mipmaps
    python3 thin-air/tools/ui/gen_icons.py --sheet out.png # contact sheet via ImageMagick (QA)
"""
from __future__ import annotations

import math
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "ui", "icons")
STROKE = 1.75


def P(d: str, fill: bool = False, w: float = STROKE) -> str:
    if fill:
        return f'<path d="{d}" fill="#fff" stroke="#fff" stroke-width="{w * 0.5:.2f}" stroke-linejoin="round"/>'
    return f'<path d="{d}"/>' if w == STROKE else f'<path d="{d}" stroke-width="{w}"/>'


def C(cx: float, cy: float, r: float, fill: bool = False) -> str:
    if fill:
        return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#fff" stroke="none"/>'
    return f'<circle cx="{cx}" cy="{cy}" r="{r}"/>'


def R(x: float, y: float, w: float, h: float, rx: float = 0.0, fill: bool = False, rot: float = 0.0) -> str:
    t = f' transform="rotate({rot} 12 12)"' if rot else ""
    f = ' fill="#fff" stroke="none"' if fill else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"{f}{t}/>'


def polar(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def snowflake(cx=12.0, cy=12.0, r=9.0, branch=2.6) -> str:
    parts = []
    for k in range(3):
        a = 90 + k * 60
        x0, y0 = polar(cx, cy, r, a)
        x1, y1 = polar(cx, cy, r, a + 180)
        parts.append(f"M {x0:.2f} {y0:.2f} L {x1:.2f} {y1:.2f}")
    for k in range(6):
        a = 90 + k * 60
        bx, by = polar(cx, cy, r * 0.62, a)
        for s in (-1, 1):
            ex, ey = polar(bx, by, branch, a + s * 45)
            parts.append(f"M {bx:.2f} {by:.2f} L {ex:.2f} {ey:.2f}")
    return P(" ".join(parts))


def gear() -> str:
    pts = []
    teeth = 8
    for i in range(teeth * 4):
        a = i * 360.0 / (teeth * 4) - 90 + 360.0 / (teeth * 8)
        r = 9.2 if (i % 4) in (1, 2) else 7.2
        pts.append(polar(12, 12, r, a))
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
    return P(d) + C(12, 12, 3.0)


def sun(cx=12.0, cy=12.0) -> str:
    rays = []
    for k in range(8):
        a = k * 45
        x0, y0 = polar(cx, cy, 6.6, a)
        x1, y1 = polar(cx, cy, 9.4, a)
        rays.append(f"M {x0:.2f} {y0:.2f} L {x1:.2f} {y1:.2f}")
    return C(cx, cy, 4.0) + P(" ".join(rays))


def virus() -> str:
    spokes = []
    dots = []
    for k in range(8):
        a = k * 45
        x0, y0 = polar(12, 12, 5.4, a)
        x1, y1 = polar(12, 12, 7.9, a)
        spokes.append(f"M {x0:.2f} {y0:.2f} L {x1:.2f} {y1:.2f}")
        dx, dy = polar(12, 12, 8.9, a)
        dots.append(C(round(dx, 2), round(dy, 2), 1.15, True))
    return C(12, 12, 5.4) + P(" ".join(spokes)) + "".join(dots) + C(10.3, 11, 0.9, True) + C(13.5, 13.2, 0.9, True)


def drop(cx: float, cy: float, s: float) -> str:
    """Droplet path centred on the round part (cx, cy) of radius s."""
    top = cy - s * 2.1
    return (f"M {cx:.2f} {top:.2f} C {cx:.2f} {top:.2f} {cx - s:.2f} {cy - s * 0.9:.2f} {cx - s:.2f} {cy:.2f} "
            f"A {s:.2f} {s:.2f} 0 0 0 {cx + s:.2f} {cy:.2f} C {cx + s:.2f} {cy - s * 0.9:.2f} {cx:.2f} {top:.2f} {cx:.2f} {top:.2f} Z")


THERMO = (P("M 10.1 14.6 V 5.4 A 1.9 1.9 0 0 1 13.9 5.4 V 14.6") + P("M 10.1 14.6 A 3.6 3.6 0 1 0 13.9 14.6")
          + P("M 12 17.2 V 9.2", w=2.2))
LUNGS = (P("M 12 3 V 10.5 M 12 10.5 L 10.4 12.2 M 12 10.5 L 13.6 12.2")
         + P("M 9.6 7 C 6.2 7.6 4 12 4 16.8 C 4 19.4 5.6 20.6 7.6 19.8 L 9.4 19.1 C 10 18.9 10.4 18.3 10.4 17.6 V 7.9 C 10.4 7.3 10.1 6.9 9.6 7 Z")
         + P("M 14.4 7 C 17.8 7.6 20 12 20 16.8 C 20 19.4 18.4 20.6 16.4 19.8 L 14.6 19.1 C 14 18.9 13.6 18.3 13.6 17.6 V 7.9 C 13.6 7.3 13.9 6.9 14.4 7 Z"))
RUNNER = (C(14.6, 4.4, 1.9) + P("M 13.1 8.1 L 10.6 13.4 L 13.6 15.9 L 12.6 21")
          + P("M 10.6 13.4 L 7.6 16.8 L 4.4 16.8") + P("M 13.1 8.1 L 16.2 11 L 19.2 10.2")
          + P("M 13.1 8.1 L 9.6 8.6 L 7.6 11.2"))
MOUNTAIN = P("M 2.5 20 L 9.2 7.5 L 13.2 13.6 L 15.6 10.2 L 21.5 20 Z") + P("M 7.3 11.1 L 9.2 12.6 L 10.9 10.6")
FLAME = (P("M 12 21 C 8 21 5.5 18.3 5.5 14.8 C 5.5 11 8.6 8.9 9.5 5.2 C 11.6 6.8 12.2 9 11.9 11 C 13.6 10.1 14.6 8 14.3 6 "
           "C 17 8 18.5 11.4 18.5 14.8 C 18.5 18.3 16 21 12 21 Z")
         + P("M 12 21 C 10.3 21 9.3 19.9 9.3 18.5 C 9.3 16.7 10.8 15.6 11.5 13.9 C 13.3 15.1 14.7 16.6 14.7 18.5 C 14.7 19.9 13.7 21 12 21 Z"))
BACKPACK = (P("M 6 9.2 C 6 6.7 8 5 10.2 5 H 13.8 C 16 5 18 6.7 18 9.2 V 19 C 18 20.1 17.1 21 16 21 H 8 C 6.9 21 6 20.1 6 19 Z")
            + P("M 9.6 5 V 3.3 H 14.4 V 5") + P("M 6 11.4 H 18") + P("M 8.8 14.4 H 15.2 V 18.2 H 8.8 Z"))
HOUSE = P("M 3.5 11 L 12 4 L 20.5 11") + P("M 5.6 9.4 V 20 H 18.4 V 9.4") + P("M 10 20 V 14.6 H 14 V 20")

ICONS: dict[str, str] = {
    # vitals
    "health": P("M 12 20.3 C 12 20.3 3.5 15 3.5 9.2 C 3.5 6.3 5.7 4.2 8.3 4.2 C 10 4.2 11.3 5.1 12 6.4 "
                "C 12.7 5.1 14 4.2 15.7 4.2 C 18.3 4.2 20.5 6.3 20.5 9.2 C 20.5 15 12 20.3 12 20.3 Z"),
    "food": P("M 7.2 3 V 9.2 M 5 3 V 8 A 2.2 2.2 0 0 0 9.4 8 V 3 M 7.2 10.3 V 21")
            + P("M 17.2 21 V 3 C 15.1 4.5 14.5 8.2 14.5 12.4 H 17.2"),
    "water": P(drop(12, 14.6, 6.2)),
    "warmth": THERMO + P("M 16 6.5 H 17.6 M 16 9.5 H 17.6 M 16 12.5 H 17.6"),
    "oxygen": LUNGS,
    "stamina": RUNNER,
    # status effects
    "wet": P(drop(7.6, 9.2, 2.6)) + P(drop(16.4, 9.2, 2.6)) + P(drop(12, 17.6, 2.6)),
    "bleeding": P(drop(12, 14.6, 6.2), fill=True),
    "sprain": R(3.2, 8.4, 17.6, 7.2, 3.6, rot=-45) + P("M 9.2 9.2 L 14.8 14.8", w=0.01)
              + C(10.6, 13.4, 0.8, True) + C(13.4, 10.6, 0.8, True) + C(12, 12, 0.8, True)
              + P("M 7.8 11.4 L 12.6 16.2 M 11.4 7.8 L 16.2 12.6"),
    "frostbite": snowflake(),
    "hypoxic": MOUNTAIN + C(6.5, 3.8, 0.9, True) + C(10.5, 2.9, 0.9, True) + C(14.5, 3.8, 0.9, True),
    "hypothermia": THERMO + snowflake(18.2, 5.8, 3.6, 1.2),
    "sick": virus(),
    "well_fed": P("M 4 11 H 20 C 20 15.4 16.4 19 12 19 C 7.6 19 4 15.4 4 11 Z") + P("M 9 21.2 H 15")
                + P("M 9.2 3.6 C 8.3 5 10.1 6 9.2 7.6 M 12.6 3.6 C 11.7 5 13.5 6 12.6 7.6 M 16 3.6 C 15.1 5 16.9 6 16 7.6"),
    "warmed_up": FLAME,
    "rested": P("M 19.6 14.6 A 8.4 8.4 0 1 1 9.4 4.4 A 6.7 6.7 0 0 0 19.6 14.6 Z"),
    "exhausted": R(2.8, 7.5, 16.4, 9, 1.8) + P("M 21.2 10.4 V 13.6") + R(5.1, 9.8, 3.1, 4.4, 0.6, fill=True),
    "starving": P("M 4 11 H 20 C 20 15.4 16.4 19 12 19 C 7.6 19 4 15.4 4 11 Z") + P("M 9 21.2 H 15") + P("M 4.5 4 L 19.5 19"),
    "dehydrated": P(drop(12, 14.6, 6.2)) + P("M 4.5 4 L 19.5 19"),
    "pill": R(3.4, 8.6, 17.2, 6.8, 3.4, rot=-40) + P("M 12 7.2 L 12 16.8", w=0.01) + P("M 10.35 9.9 L 13.65 14.1"),
    "leaf": P("M 5 19 C 5 10 10 4.6 19.4 4.6 C 19.4 14 14 19 5 19 Z") + P("M 5 19 L 14.4 9.6"),
    # notifications
    "info": C(12, 12, 9) + P("M 12 11 V 16.6") + C(12, 7.8, 1.1, True),
    "warning": P("M 12 3.6 L 21.3 19.8 H 2.7 Z") + P("M 12 9.8 V 14.2") + C(12, 17, 1.1, True),
    "objective": P("M 5.2 21 V 3.4") + P("M 5.2 4.4 C 8.2 2.9 10.7 5.9 14.1 4.4 C 16.1 3.7 17.6 3.9 19.1 4.4 V 13 "
                                        "C 17.6 12.5 16.1 12.3 14.1 13 C 10.7 14.5 8.2 11.5 5.2 13"),
    "discovery": P("M 12 21.5 C 12 21.5 5 14.6 5 9.6 A 7 7 0 0 1 19 9.6 C 19 14.6 12 21.5 12 21.5 Z") + C(12, 9.6, 2.5),
    "item": BACKPACK,
    "blueprint": P("M 5 3 H 14.8 L 19 7.2 V 21 H 5 Z") + P("M 14.8 3 V 7.2 H 19") + P("M 8.2 17.6 L 11.6 10.8 L 15 17.6")
                 + P("M 9.4 15 H 13.8"),
    "log": R(2.8, 5.6, 18.4, 12.8, 2) + C(8.4, 11, 2.1) + C(15.6, 11, 2.1) + P("M 8.4 13.1 H 15.6")
           + P("M 6.4 18.4 L 7.9 15.8 H 16.1 L 17.6 18.4"),
    "radio": R(6.8, 7, 10.4, 14, 1.6) + P("M 9.4 7 V 2.6") + P("M 9.6 10.6 H 14.4 M 9.6 13.2 H 14.4") + C(12, 17.1, 1.3),
    "check_circle": C(12, 12, 9) + P("M 8 12.5 L 11 15.4 L 16.4 9.2"),
    "save": C(12, 12, 9) + P("M 8 12.5 L 11 15.4 L 16.4 9.2"),
    # touch / actions
    "jump": P("M 6 12.6 L 12 6.6 L 18 12.6") + P("M 6 18.2 L 12 12.2 L 18 18.2"),
    "crouch": P("M 6 5.8 L 12 11.8 L 18 5.8") + P("M 6 11.4 L 12 17.4 L 18 11.4"),
    "use": P("M 4.6 20.2 L 14.6 10.2") + P("M 12.3 7.9 L 14.9 5.3 C 17 5.6 18.7 7.3 19 9.4 L 16.4 12 Z"),
    "aim": C(12, 12, 7) + P("M 12 2.4 V 6.2 M 12 17.8 V 21.6 M 2.4 12 H 6.2 M 17.8 12 H 21.6") + C(12, 12, 1.0, True),
    "interact": P("M 7.2 12.6 V 6.6 A 1.45 1.45 0 0 1 10.1 6.6 V 11 M 10.1 10.6 V 4.6 A 1.45 1.45 0 0 1 13 4.6 V 10.6 "
                  "M 13 10.6 V 5.6 A 1.45 1.45 0 0 1 15.9 5.6 V 11.2 M 15.9 11.2 V 8.2 A 1.45 1.45 0 0 1 18.8 8.2 V 14 "
                  "C 18.8 18 16.3 21 12.5 21 C 9.6 21 8.1 19.6 6.6 17.5 L 4.2 13.7 A 1.45 1.45 0 0 1 6.7 12.2 L 7.2 12.9"),
    "inventory": BACKPACK,
    "build": P("M 12.8 11.2 L 4.9 19.1 A 1.4 1.4 0 0 0 6.9 21.1 L 14.8 13.2") + P("M 10.6 6.6 L 14.2 3 L 21 9.8 L 18.2 12.6 "
                                                                                     "L 16.6 11 L 14.6 13 L 11 9.4 L 12.9 7.5 Z"),
    "journal": P("M 3.6 4.6 H 9.8 C 11 4.6 12 5.6 12 6.8 V 20.2 C 12 19.2 11.2 18.6 10 18.6 H 3.6 Z")
               + P("M 20.4 4.6 H 14.2 C 13 4.6 12 5.6 12 6.8 V 20.2 C 12 19.2 12.8 18.6 14 18.6 H 20.4 Z"),
    "map": P("M 3 6 L 9 3.6 L 15 6 L 21 3.6 V 18 L 15 20.4 L 9 18 L 3 20.4 Z") + P("M 9 3.6 V 18 M 15 6 V 20.4"),
    "torch": P("M 6.6 4.6 H 17.4 L 15.2 10.8 H 8.8 Z") + P("M 8.8 10.8 V 20 C 8.8 20.6 9.2 21 9.8 21 H 14.2 C 14.8 21 15.2 20.6 15.2 20 V 10.8")
             + P("M 12 13.8 V 16.2") + P("M 12 1.4 V 2.6 M 7.6 1.8 L 8.2 2.8 M 16.4 1.8 L 15.8 2.8"),
    "pause": P("M 9 5 V 19 M 15 5 V 19", w=2.6),
    "sprint": RUNNER,
    # UI
    "settings": gear(),
    "back": P("M 19 12 H 5 M 11 6 L 5 12 L 11 18"),
    "close": P("M 6 6 L 18 18 M 18 6 L 6 18"),
    "check": P("M 5 12.6 L 10 17.4 L 19 7.2"),
    "chevron_left": P("M 15 5 L 8 12 L 15 19"),
    "chevron_right": P("M 9 5 L 16 12 L 9 19"),
    "chevron_up": P("M 5 15 L 12 8 L 19 15"),
    "chevron_down": P("M 5 9 L 12 16 L 19 9"),
    "play": P("M 8 5 L 19 12 L 8 19 Z", fill=True),
    "stop": R(6.8, 6.8, 10.4, 10.4, 1.2, fill=True),
    "lock": R(5, 10.8, 14, 10.2, 2) + P("M 8 10.8 V 8 A 4 4 0 0 1 16 8 V 10.8") + C(12, 15.4, 1.3, True),
    "clock": C(12, 12, 9) + P("M 12 7 V 12 L 15.4 14.2"),
    "sun": sun(),
    "altitude": MOUNTAIN,
    "temperature": THERMO,
    "route": P("M 5.5 18.6 C 10 18.6 8 12 12 12 C 16 12 14 5.4 18.5 5.4") + C(5.5, 18.6, 1.6, True) + C(18.5, 5.4, 1.6, True),
    "scan": P("M 4 8.4 V 4 H 8.4 M 15.6 4 H 20 V 8.4 M 20 15.6 V 20 H 15.6 M 8.4 20 H 4 V 15.6") + P("M 4 12 H 20"),
    "quit": P("M 12 3 V 11 M 7.2 5.8 A 8 8 0 1 0 16.8 5.8"),
    "compass": C(12, 12, 9) + P("M 12 5.6 L 14.2 12 L 12 18.4 L 9.8 12 Z") + P("M 12 5.6 L 14.2 12 L 9.8 12 Z", fill=True),
    "calendar": R(3.6, 5, 16.8, 15.6, 2) + P("M 3.6 9.8 H 20.4 M 8 3 V 6.6 M 16 3 V 6.6"),
    "grid": R(4, 4, 16, 16, 1.5) + P("M 12 4 V 20 M 4 12 H 20"),
    "locate": C(12, 12, 6.4) + C(12, 12, 1.8, True) + P("M 12 2.4 V 5.6 M 12 18.4 V 21.6 M 2.4 12 H 5.6 M 18.4 12 H 21.6"),
    "plus": P("M 12 5 V 19 M 5 12 H 19"),
    "minus": P("M 5 12 H 19"),
    "player_arrow": P("M 12 3 L 18.5 20 L 12 16.4 L 5.5 20 Z", fill=True),
    "recording": R(3, 6, 18, 12, 2) + C(8.4, 12, 2.4) + C(15.6, 12, 2.4) + P("M 8.4 14.4 H 15.6"),
    "document": P("M 6 3 H 14.5 L 18.5 7 V 21 H 6 Z") + P("M 14.5 3 V 7 H 18.5") + P("M 9 11.4 H 15.5 M 9 14.6 H 15.5 M 9 17.8 H 13"),
    "stats": P("M 4 20 H 20") + P("M 7 20 V 13 M 12 20 V 6 M 17 20 V 10", w=2.4),
    "notes": P("M 5.5 3.5 H 18.5 V 20.5 H 5.5 Z") + P("M 8.5 8 H 15.5 M 8.5 11.5 H 15.5 M 8.5 15 H 12.5"),
    # map / compass markers
    "poi": P("M 12 3.6 L 20.4 12 L 12 20.4 L 3.6 12 Z"),
    "marker_objective": P("M 12 3.6 L 20.4 12 L 12 20.4 L 3.6 12 Z", fill=True),
    "cabin": HOUSE,
    "mine": P("M 3.8 10.2 Q 11 2.8 20 6.6") + P("M 11.4 5.4 L 16.6 20.6"),
    "station": P("M 12 9.6 V 21 M 8 21 L 12 9.6 L 16 21 M 9.3 17 H 14.7") + P("M 8.6 7 A 4.8 4.8 0 0 1 15.4 7 M 6 4.2 A 8.4 8.4 0 0 1 18 4.2")
               + C(12, 9.4, 1.2, True),
    "peak": MOUNTAIN,
    "camp": P("M 2.8 20 L 12 4.8 L 21.2 20 Z") + P("M 9.5 20 L 12 14.6 L 14.5 20"),
    "crash": P("M 12 2.4 C 12.8 2.4 13.3 3.4 13.3 5 V 9.5 L 21 14 V 16 L 13.3 13.6 V 18 L 15.5 19.8 V 21.3 L 12 20.3 L 8.5 21.3 "
               "V 19.8 L 10.7 18 V 13.6 L 3 16 V 14 L 10.7 9.5 V 5 C 10.7 3.4 11.2 2.4 12 2.4 Z"),
    "lake": P("M 3 9.6 C 5 8.1 7 8.1 9 9.6 C 11 11.1 13 11.1 15 9.6 C 17 8.1 19 8.1 21 9.6")
            + P("M 3 15 C 5 13.5 7 13.5 9 15 C 11 16.5 13 16.5 15 15 C 17 13.5 19 13.5 21 15"),
    "cave": P("M 3 20 C 3 12 7 5 12 5 C 17 5 21 12 21 20") + P("M 8 20 C 8 15.6 9.8 12 12 12 C 14.2 12 16 15.6 16 20") + P("M 2 20 H 22"),
    "lookout": P("M 7 21 L 9.4 10 M 17 21 L 14.6 10 M 8.3 15.5 H 15.7") + P("M 6.6 10 H 17.4 V 6 H 6.6 Z") + P("M 5.4 6 L 12 2.4 L 18.6 6"),
    "glacier": P("M 2.5 19 L 8 9 L 11 13 L 14.5 6.5 L 21.5 19 Z") + P("M 6 19 L 10 14.8 L 13 17 L 17 13 M 11.6 11.6 L 14.5 9.4 L 16.8 11.5"),
}


def write_svgs() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, body in ICONS.items():
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" '
               f'stroke="#fff" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{body}</svg>\n')
        with open(os.path.join(OUT, name + ".svg"), "w") as f:
            f.write(svg)
    print(f"wrote {len(ICONS)} icons to {OUT}")


def fix_imports() -> None:
    n = 0
    for fn in sorted(os.listdir(OUT)):
        if not fn.endswith(".svg.import"):
            continue
        p = os.path.join(OUT, fn)
        s = open(p).read()
        s2 = re.sub(r"svg/scale=[0-9.]+", "svg/scale=4.0", s)
        s2 = re.sub(r"mipmaps/generate=\w+", "mipmaps/generate=true", s2)
        s2 = re.sub(r"process/fix_alpha_border=\w+", "process/fix_alpha_border=true", s2)
        if s2 != s:
            open(p, "w").write(s2)
            n += 1
    print(f"patched {n} import files (re-run godot --import)")


def sheet(out: str) -> None:
    tmp = "/tmp/_icons_sheet"
    os.makedirs(tmp, exist_ok=True)
    files = []
    for name in ICONS:
        src = os.path.join(OUT, name + ".svg")
        png = os.path.join(tmp, name + ".png")
        s = open(src).read().replace('stroke="#fff"', 'stroke="#222"').replace('fill="#fff"', 'fill="#222"')
        open(os.path.join(tmp, name + ".svg"), "w").write(s)
        subprocess.run(["convert", "-background", "white", "-density", "384", os.path.join(tmp, name + ".svg"),
                        "-resize", "96x96", png], check=True)
        files.append(png)
    subprocess.run(["montage", *files, "-tile", "12x", "-geometry", "96x96+8+8", "-label", "%t", out], check=True)
    print("sheet:", out)


if __name__ == "__main__":
    if "--fix-imports" in sys.argv:
        fix_imports()
    elif "--sheet" in sys.argv:
        sheet(sys.argv[sys.argv.index("--sheet") + 1])
    else:
        write_svgs()

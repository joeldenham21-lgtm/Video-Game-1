"""Reusable set-dressing props for the story locations (Blender space, Z up, base at z = 0, front = -Y).

Each returns a plib.Mesh in local space; place with Site.add(mesh, M). Real-world dimensions throughout.
"""
import math

from mathutils import Vector

import plib as P
from plib import box, cyl, lathe, rod, tube, merge, T, RX, RY, RZ, rnd

RED = (0.5, 0.05, 0.04)
ORANGE = (0.75, 0.25, 0.04)
YELLOW = (0.75, 0.55, 0.06)
OLIVE = (0.28, 0.3, 0.18)
BLUE = (0.08, 0.16, 0.38)
GREEN = (0.1, 0.24, 0.12)
GREY = (0.45, 0.45, 0.45)
BLACK = (0.04, 0.04, 0.04)
WHITE = (0.85, 0.85, 0.83)


def decal_uv(name):
    """Blender UVs (bl, br, tr, tl) of an atlas region (tools/blender/poi/decals.json)."""
    import json
    import os
    if not hasattr(decal_uv, "_d"):
        decal_uv._d = json.load(open(os.path.join(P.HERE, "decals.json")))
    d = decal_uv._d
    Wd, Hd = d["size"]
    x0, y0, x1, y1 = d["regions"][name]
    u0, u1 = x0 / Wd, x1 / Wd
    v0, v1 = 1.0 - y1 / Hd, 1.0 - y0 / Hd
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def decal(name, w, h, mat="decal", flags=0):
    """Atlas decal quad, w x h metres, facing -Y (lying in the XZ plane at y = 0), centred at the origin."""
    return P.quad((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2), mat,
                  decal_uv(name), flags=flags)


def crate(w=0.8, d=0.6, h=0.6, mat="wood_fresh", tint=(1, 1, 1), lid=True, stencil=None):
    """Slatted wooden shipping crate: corner battens + board faces."""
    me = P.Mesh()
    t = 0.018
    me.extend(box(w - 0.05, d - 0.05, h - 0.03, mat, 'x', tint=tint).transformed(T(0, 0, h / 2)))
    # battens on the long faces and top edges
    for sy in (-1, 1):
        for sx in (-1, 1):
            me.extend(box(0.07, t * 2, h, mat, 'z', tint=tint).transformed(T(sx * (w / 2 - 0.035), sy * d / 2, h / 2)))
        me.extend(box(w, t * 2, 0.07, mat, 'x', tint=tint).transformed(T(0, sy * d / 2, h - 0.035)))
        me.extend(box(w, t * 2, 0.07, mat, 'x', tint=tint).transformed(T(0, sy * d / 2, 0.035)))
    for sx in (-1, 1):
        me.extend(box(t * 2, d, 0.07, mat, 'y', tint=tint).transformed(T(sx * w / 2, 0, h - 0.035)))
    if not lid:
        P.remove_faces(me, lambda c, i: c.z > h - 0.02 and abs(c.x) < w / 2 - 0.06 and abs(c.y) < d / 2 - 0.02)
        me.extend(box(w - 0.1, d - 0.1, 0.02, mat, 'x', tint=(tint[0] * .5, tint[1] * .5, tint[2] * .5))
                  .transformed(T(0, 0, h * 0.55)))
    if stencil:
        me.extend(decal(stencil, min(w * 0.8, 0.6), min(w * 0.8, 0.6) * 0.29).transformed(T(0, -d / 2 - 0.021, h * 0.5)))
    return me


def jerrycan(tint=RED, mat="paint_metal"):
    me = box(0.34, 0.165, 0.46, mat, tint=tint, seg=0.2).transformed(T(0, 0, 0.23))
    me.extend(tube([(-0.12, 0, 0.46), (-0.12, 0, 0.53), (0.06, 0, 0.53), (0.06, 0, 0.46)], 0.012, mat, 6, tint=tint))
    me.extend(cyl(0.025, 0.06, "metal_dark", 8).transformed(T(0.13, 0, 0.44) @ RY(25)))
    return me


def barrel(tint=(0.3, 0.1, 0.08), mat="paint_metal", rust=False, lying=False):
    r = 0.29
    prof = [(0.0, 0.0), (r - 0.01, 0.0), (r, 0.02), (r, 0.28), (r + 0.012, 0.29), (r, 0.30), (r, 0.58),
            (r + 0.012, 0.59), (r, 0.6), (r, 0.86), (r - 0.01, 0.88), (r - 0.02, 0.875), (0.0, 0.875)]
    me = lathe(prof, "metal_rusty" if rust else mat, 18, tint=(1, 1, 1) if rust else tint)
    me.extend(cyl(0.03, 0.012, "metal_dark", 8).transformed(T(0.17, 0, 0.873)))
    if lying:
        me = me.transformed(T(0, 0, r) @ RY(90) @ T(0, 0, -0.44))
    return me


def duffel(length=0.9, r=0.2, mat="canvas", tint=(1, 1, 1), squash=0.7):
    prof = [(0.0, -length / 2)]
    for k in range(1, 5):
        a = k / 4 * math.pi / 2
        prof.append((r * math.sin(a), -length / 2 + r * (1 - math.cos(a))))
    for k in range(4, -1, -1):
        a = k / 4 * math.pi / 2
        prof.append((r * math.sin(a), length / 2 - r * (1 - math.cos(a))))
    me = lathe(prof, mat, 12, tint=tint)
    me.displace(lambda p: Vector((0, 0, 0)) + Vector((p.x * 0.0, p.y * 0.0, 0)) + Vector((0, 0, 0)))
    me = me.transformed(T(0, 0, r * squash) @ P.S(1, 1, squash) @ RY(90))
    # straps
    for x in (-length * 0.2, length * 0.2):
        me.extend(tube([(x, -r * 0.9, r * squash * 1.2), (x, 0, r * squash * 2.02), (x, r * 0.9, r * squash * 1.2)],
                       0.012, "leather", 5))
    return me


def backpack(tint=(0.5, 0.08, 0.05), mat="nylon", open_=False):
    me = box(0.34, 0.22, 0.55, mat, tint=tint, seg=0.12).transformed(T(0, 0, 0.29))
    me.displace(lambda p: Vector((0, (0.03 if p.y > 0 else -0.02) * math.sin(p.z * 5.0), 0)))
    me.extend(box(0.26, 0.08, 0.2, mat, tint=tint).transformed(T(0, -0.14, 0.24)))
    for sx in (-0.1, 0.1):
        me.extend(P.strip_tube([(sx, 0.11, 0.5), (sx, 0.16, 0.35), (sx, 0.13, 0.1)], 0.045, 0.01, "nylon",
                               tint=(0.05, 0.05, 0.05)))
    return me


def toolbox(tint=RED):
    me = box(0.5, 0.22, 0.2, "paint_metal", tint=tint).transformed(T(0, 0, 0.1))
    me.extend(tube([(-0.15, 0, 0.2), (-0.15, 0, 0.26), (0.15, 0, 0.26), (0.15, 0, 0.2)], 0.01, "metal_dark", 6))
    return me


def hard_case(w=0.6, d=0.4, h=0.22, tint=ORANGE):
    me = box(w, d, h, "plastic", tint=tint, seg=0.2).transformed(T(0, 0, h / 2))
    for x in (-w * 0.3, w * 0.3):
        me.extend(box(0.06, 0.02, 0.05, "metal_dark").transformed(T(x, -d / 2 - 0.008, h * 0.62)))
    me.extend(box(0.16, 0.03, 0.025, "plastic", tint=(0.05, 0.05, 0.05)).transformed(T(0, -d / 2 - 0.02, h * 0.8)))
    return me


def first_aid(w=0.36, h=0.26, d=0.1):
    me = box(w, d, h, "plastic", tint=(0.85, 0.85, 0.82)).transformed(T(0, 0, h / 2))
    me.extend(box(0.12, 0.004, 0.035, "plastic", tint=(0.6, 0.02, 0.02), flags=P.F_NOAO).transformed(T(0, -d / 2 - 0.002, h / 2)))
    me.extend(box(0.035, 0.004, 0.12, "plastic", tint=(0.6, 0.02, 0.02), flags=P.F_NOAO).transformed(T(0, -d / 2 - 0.002, h / 2)))
    return me


def gas_bottle(h=0.9, r=0.11, tint=(0.1, 0.35, 0.12), valve=True):
    prof = [(0, 0), (r * 0.9, 0), (r, 0.03), (r, h - r * 1.2), (r * 0.7, h - r * 0.45), (r * 0.25, h - 0.02),
            (0.02, h), (0, h)]
    me = lathe(prof, "paint_metal", 14, tint=tint)
    if valve:
        me.extend(cyl(0.02, 0.07, "metal_bare", 8).transformed(T(0, 0, h - 0.01)))
        me.extend(cyl(0.035, 0.012, "metal_dark", 10).transformed(T(0, 0, h + 0.06)))
    return me


def lantern(lit_mat="lamp"):
    """Hurricane (kerosene) lantern, 0.33 m tall, bail up."""
    me = cyl(0.075, 0.07, "paint_metal", 12, tint=(0.35, 0.06, 0.04))
    me.extend(lathe([(0.0, 0.07), (0.045, 0.075), (0.06, 0.14), (0.045, 0.2), (0.0, 0.205)], "glass", 10,
                    flags=P.F_NOAO))
    me.extend(cyl(0.012, 0.03, lit_mat, 6).transformed(T(0, 0, 0.1)))
    me.extend(lathe([(0.07, 0.2), (0.05, 0.24), (0.02, 0.26), (0.0, 0.265)], "paint_metal", 12,
                    tint=(0.35, 0.06, 0.04)))
    for a in (0, 120, 240):
        me.extend(rod((0.07 * math.cos(math.radians(a)), 0.07 * math.sin(math.radians(a)), 0.07),
                      (0.05 * math.cos(math.radians(a)), 0.05 * math.sin(math.radians(a)), 0.21), 0.004, "metal_dark", 4))
    me.extend(tube([(-0.07, 0, 0.2)] + [(-0.07 * math.cos(math.pi * k / 8), 0, 0.2 + 0.1 * math.sin(math.pi * k / 8))
                                       for k in range(9)], 0.003, "metal_dark", 4))
    return me


def chair(tint=(1, 1, 1), mat="wood_log"):
    me = P.Mesh()
    for sx in (-0.19, 0.19):
        for sy in (-0.19, 0.19):
            me.extend(box(0.04, 0.04, 0.45, mat, tint=tint).transformed(T(sx, sy, 0.225)))
        me.extend(box(0.04, 0.04, 0.5, mat, tint=tint).transformed(T(sx, 0.19, 0.7)))
    me.extend(box(0.44, 0.42, 0.03, mat, 'x', tint=tint).transformed(T(0, 0, 0.46)))
    for z in (0.62, 0.82):
        me.extend(box(0.38, 0.025, 0.07, mat, 'x', tint=tint).transformed(T(0, 0.19, z)))
    me.extend(box(0.38, 0.02, 0.02, mat, 'x', tint=tint).transformed(T(0, -0.19, 0.15)))
    return me


def table(w=1.2, d=0.75, h=0.75, mat="wood_log", tint=(1, 1, 1)):
    me = box(w, d, 0.04, mat, 'x', tint=tint).transformed(T(0, 0, h - 0.02))
    for sx in (-1, 1):
        for sy in (-1, 1):
            me.extend(box(0.06, 0.06, h - 0.04, mat, tint=tint).transformed(T(sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), (h - 0.04) / 2)))
        me.extend(box(0.03, d - 0.14, 0.08, mat, 'y', tint=tint).transformed(T(sx * (w / 2 - 0.06), 0, h - 0.1)))
    for sy in (-1, 1):
        me.extend(box(w - 0.14, 0.03, 0.08, mat, 'x', tint=tint).transformed(T(0, sy * (d / 2 - 0.06), h - 0.1)))
    return me


def bench(w=1.4, d=0.32, h=0.45, mat="wood_log"):
    me = box(w, d, 0.05, mat, 'x').transformed(T(0, 0, h - 0.025))
    for sx in (-1, 1):
        me.extend(box(0.05, d - 0.04, h - 0.05, mat).transformed(T(sx * (w / 2 - 0.1), 0, (h - 0.05) / 2)))
    return me


def shelf(w=1.0, h=1.6, d=0.3, levels=4, mat="wood_fresh", tint=(1, 1, 1)):
    me = P.Mesh()
    for sx in (-1, 1):
        me.extend(box(0.025, d, h, mat, 'z', tint=tint).transformed(T(sx * (w / 2 - 0.0125), 0, h / 2)))
    for k in range(levels):
        z = 0.08 + (h - 0.12) * k / (levels - 1)
        me.extend(box(w - 0.05, d, 0.022, mat, 'x', tint=tint).transformed(T(0, 0, z)))
    me.extend(box(w, 0.012, h, mat, 'z', tint=(tint[0] * .7, tint[1] * .7, tint[2] * .7)).transformed(T(0, d / 2 - 0.006, h / 2)))
    return me


def bunk(w=0.9, l=2.0, h=0.45, mat="wood_log", mattress_tint=(0.45, 0.38, 0.3), blanket=True, double=False):
    me = P.Mesh()
    levels = [h, h + 1.05] if double else [h]
    top = levels[-1] + (0.35 if double else 0.4)
    for sx in (-1, 1):
        for sy in (-1, 1):
            me.extend(box(0.08, 0.08, top, mat).transformed(T(sx * (w / 2 - 0.04), sy * (l / 2 - 0.04), top / 2)))
    for z in levels:
        for sx in (-1, 1):
            me.extend(box(0.05, l, 0.14, mat, 'y').transformed(T(sx * (w / 2 - 0.025), 0, z - 0.07)))
        for sy in (-1, 1):
            me.extend(box(w, 0.05, 0.14, mat, 'x').transformed(T(0, sy * (l / 2 - 0.025), z - 0.07)))
        for k in range(9):
            me.extend(box(w - 0.1, 0.1, 0.02, mat, 'x').transformed(T(0, -l / 2 + 0.15 + k * (l - 0.3) / 8, z - 0.03)))
        m = box(w - 0.12, l - 0.12, 0.1, "canvas", seg=0.3, tint=mattress_tint)
        m.displace(lambda p: Vector((0, 0, 0.02 * P.nz(p, 3.1) if p.z > 0 else 0)))
        me.extend(m.transformed(T(0, 0, z + 0.03)))
        if blanket:
            bl = box(w - 0.08, l * 0.62, 0.03, "wool", seg=0.25, tint=(0.55, 0.12, 0.1))
            bl.displace(lambda p: Vector((0, 0, 0.025 * P.nz(p, 4.0, 3.0))))
            me.extend(bl.transformed(T(0, -l * 0.17, z + 0.1)))
        pl = box(w * 0.6, 0.35, 0.1, "canvas", seg=0.1, tint=(0.8, 0.78, 0.72))
        pl.displace(lambda p: Vector((0, 0, -0.03 * abs(p.x) * 3)))
        me.extend(pl.transformed(T(0, l / 2 - 0.3, z + 0.12)))
    return me


def wood_stove(tint=(0.08, 0.08, 0.08), pipe_h=2.2):
    """Box (barrel-less) cast/plate-steel airtight stove, 0.7 m long, legs, stovepipe to `pipe_h` above base."""
    me = box(0.5, 0.7, 0.45, "metal_dark", 'y', seg=0.2, tint=tint).transformed(T(0, 0, 0.47))
    for sx in (-1, 1):
        for sy in (-1, 1):
            me.extend(box(0.05, 0.05, 0.25, "metal_dark", tint=tint).transformed(T(sx * 0.2, sy * 0.3, 0.125)))
    me.extend(box(0.3, 0.02, 0.24, "metal_dark", tint=(0.12, 0.12, 0.12)).transformed(T(0, -0.36, 0.46)))
    me.extend(rod((0.12, -0.38, 0.52), (0.12, -0.42, 0.52), 0.012, "metal_bare", 6))
    me.extend(box(0.52, 0.72, 0.02, "metal_dark", tint=tint).transformed(T(0, 0, 0.705)))
    me.extend(cyl(0.075, pipe_h - 0.71, "metal_dark", 12, tint=(0.1, 0.1, 0.1)).transformed(T(0, 0.18, 0.71)))
    me.extend(cyl(0.085, 0.03, "metal_dark", 12).transformed(T(0, 0.18, 0.95)))   # damper collar
    return me


def woodpile(w=2.4, h=1.2, d=0.45, seed_=3, cols=None):
    """Stacked split firewood (rows of split rounds) with end-grain faces towards +-Y."""
    me = P.Mesh()
    P.seed(seed_)
    r = 0.07
    z = r
    row = 0
    while z < h:
        x = -w / 2 + r
        while x < w / 2 - r:
            rr = r * P.rnd(0.8, 1.15)
            n = 5 if P.rnd() < 0.6 else 6
            piece = cyl(rr, d * P.rnd(0.9, 1.05), "wood_log", n, cap_mat="wood_endgrain", smooth_=False,
                        a0=P.rnd(0, 60), tint=(P.rnd(0.85, 1.05),) * 3)
            me.extend(piece.transformed(T(x, -d / 2, z) @ RX(-90) @ RZ(P.rnd(0, 360))))
            x += rr * 2.0
        z += r * 1.75
        row += 1
    return me


def snowshoes():
    me = P.Mesh()
    for sx in (-0.14, 0.14):
        pts = [(sx + 0.12 * math.sin(2 * math.pi * k / 16) * (0.6 if math.cos(2 * math.pi * k / 16) < 0 else 1.0),
                0.4 * math.cos(2 * math.pi * k / 16), 0.0) for k in range(17)]
        me.extend(tube(pts, 0.012, "wood_log", 5))
        for k in range(5):
            me.extend(rod((sx - 0.1, -0.2 + k * 0.1, 0), (sx + 0.1, -0.2 + k * 0.1, 0), 0.004, "leather", 3))
    return me


def leghold_trap(open_=True):
    me = P.Mesh()
    me.extend(box(0.14, 0.05, 0.012, "metal_rusty").transformed(T(0, 0, 0.006)))
    for sx in (-1, 1):
        pts = [(sx * 0.06 * math.cos(math.pi * k / 8 - math.pi / 2), 0.07 * math.sin(math.pi * k / 8 - math.pi / 2) * (1 if open_ else 0.2),
                0.01 + (0.0 if open_ else 0.06 * math.sin(math.pi * k / 8))) for k in range(9)]
        me.extend(tube(pts, 0.006, "metal_rusty", 5))
    me.extend(tube([(0.07, 0, 0.01), (0.22, 0.02, 0.01), (0.3, -0.05, 0.005)], 0.004, "metal_rusty", 4))
    return me


def ladder(h=3.0, w=0.45, mat="wood_log", rung=0.3):
    me = P.Mesh()
    for sx in (-1, 1):
        me.extend(box(0.05, 0.08, h, mat).transformed(T(sx * w / 2, 0, h / 2)))
    k = 0
    z = rung
    while z < h - 0.1:
        me.extend(cyl(0.02, w, mat, 6).transformed(T(-w / 2, 0, z) @ RY(90)))
        z += rung
    return me


def radio_desk_set():
    """HF base-station radio set on a desk top: transceiver, power supply, mic on stand (base at z = 0)."""
    me = box(0.42, 0.3, 0.16, "paint_metal", tint=(0.3, 0.33, 0.3)).transformed(T(0, 0, 0.08))
    me.extend(decal("radio_face", 0.4, 0.15).transformed(T(0, -0.151, 0.08)))
    me.extend(box(0.22, 0.25, 0.12, "paint_metal", tint=(0.12, 0.12, 0.12)).transformed(T(0.36, 0.02, 0.06)))
    me.extend(cyl(0.05, 0.02, "metal_dark", 10).transformed(T(-0.33, -0.05, 0)))
    me.extend(rod((-0.33, -0.05, 0.02), (-0.33, -0.05, 0.14), 0.006, "metal_dark"))
    me.extend(box(0.05, 0.04, 0.09, "plastic", tint=(0.05, 0.05, 0.05)).transformed(T(-0.33, -0.05, 0.18)))
    me.extend(tube([(-0.33, -0.03, 0.14), (-0.3, 0.05, 0.05), (-0.2, 0.12, 0.02), (-0.1, 0.14, 0.05)], 0.005,
                   "rubber", 4))
    return me


def splinter_top(r, mat="wood_fresh", h=0.35, n=9, seed_=0.0):
    """Jagged splintered break of a round trunk (spikes), base at z = 0."""
    me = P.Mesh()
    P.seed(int(seed_ * 100) + 5)
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * P.rnd(0.35, 0.9)
        x, y = math.cos(a) * rr, math.sin(a) * rr
        hh = h * P.rnd(0.3, 1.0)
        me.extend(cyl(r * 0.28, hh, mat, 4, r2=r * 0.02, caps=False, smooth_=False, a0=P.rnd(0, 90))
                  .transformed(T(x, y, -0.02) @ RX(P.rnd(-12, 12)) @ RY(P.rnd(-12, 12))))
    me.extend(cyl(r * 0.98, 0.01, "wood_endgrain", 10, cap_mat="wood_endgrain").transformed(T(0, 0, -0.01)))
    return me


def dome_tent(a=1.1, b=0.75, h=1.05, tint=(0.85, 0.55, 0.05), vestibule=True, sag=0.06, res=12, seed_=0.0):
    """Geodesic mountaineering tent: fly over a 2a x 2b ellipse, crossing poles, vestibule on -Y, guy points.
    Returns (mesh, guy anchor points on the fly)."""
    me = P.Mesh()
    rings = []
    for j in range(res + 1):
        r = j / res
        ring = []
        for i in range(24):
            ang = 2 * math.pi * i / 24
            x = math.cos(ang) * a * (1 - r * r) ** 0.5 if False else math.cos(ang) * a * (1 - r)
            y = math.sin(ang) * b * (1 - r)
            if vestibule and math.sin(ang) < -0.3:
                y -= 0.55 * (-math.sin(ang) - 0.3) * (1 - r) ** 1.5
            z = h * (1 - (1 - r) ** 2) ** 0.62
            # fabric sags between the poles (poles run along the diagonals)
            pole = abs(math.sin(2 * ang))
            z -= sag * (1 - pole) * math.sin(math.pi * r) * 1.2
            z += 0.012 * P.nz((x, y, seed_), 6.0)
            ring.append(Vector((x, y, max(0.0, z))))
        rings.append(ring)
    fly = P.loft(rings, "nylon_paint_2s", True, True, tint)
    if P.face_normal(fly, 3).z < 0:
        P.flip(fly)
    me.extend(fly)
    # poles (visible sleeves) along the two diagonals
    for s_ in (1, -1):
        pts = []
        for k in range(13):
            t = k / 12
            ang = math.atan2(b, a * s_)
            rr = 1 - 2 * abs(t - 0.5)
            u = (t - 0.5) * 2
            x = u * a * math.cos(math.atan(b / a)) * s_ * 0.98
            y = u * b * math.sin(math.atan(b / a)) * 0.98
            z = h * (1 - u * u) ** 0.62 + 0.01
            pts.append(Vector((x, y, z)))
        me.extend(tube(pts, 0.012, "nylon", 5, tint=(0.15, 0.15, 0.15)))
    anchors = [Vector((a * 0.9, b * 0.9, h * 0.45)), Vector((-a * 0.9, b * 0.9, h * 0.45)),
               Vector((a * 0.9, -b * 0.9, h * 0.45)), Vector((-a * 0.9, -b * 0.9, h * 0.45))]
    return me, anchors


def zarges_box(w=0.8, d=0.55, h=0.45):
    """Ribbed aluminium expedition case."""
    me = box(w, d, h, "metal_bare", 'x', tint=(0.85, 0.85, 0.85)).transformed(T(0, 0, h / 2))
    for z in (h * 0.25, h * 0.6):
        me.extend(box(w + 0.01, d + 0.01, 0.025, "metal_bare", 'x', tint=(0.75, 0.75, 0.75)).transformed(T(0, 0, z)))
    for sx in (-1, 1):
        me.extend(box(0.12, 0.03, 0.03, "metal_dark").transformed(T(sx * w * 0.3, -d / 2 - 0.02, h * 0.85)))
    return me


def stove_canister():
    """Mountaineering canister stove with a pot on it."""
    me = lathe([(0.0, 0.0), (0.05, 0.0), (0.055, 0.02), (0.055, 0.08), (0.03, 0.1), (0.0, 0.1)], "paint_metal", 10,
               tint=(0.1, 0.25, 0.55))
    me.extend(cyl(0.012, 0.04, "metal_bare", 6).transformed(T(0, 0, 0.1)))
    for k in range(3):
        a = math.radians(k * 120)
        me.extend(rod((0, 0, 0.14), (0.07 * math.cos(a), 0.07 * math.sin(a), 0.15), 0.004, "metal_bare", 4))
    me.extend(cyl(0.08, 0.11, "metal_bare", 14, tint=(0.8, 0.8, 0.8)).transformed(T(0, 0, 0.15)))
    return me


def rime(me_src, wind_dir, amount=1.0, seed_=0, step=0.18, mat="rime"):
    """Rime-ice feathers growing INTO the wind from the windward faces of `me_src` (a Mesh): small wedges
    extending up to ~0.35 m * amount toward -wind_dir. Returns a new Mesh."""
    out = P.Mesh()
    wdir = Vector(wind_dir).normalized()
    into = -wdir
    P.seed(seed_ + 17)
    acc = 0.0
    for fi, f in enumerate(me_src.f):
        n = P.face_normal(me_src, fi)
        facing = n.dot(into)
        if facing < 0.25:
            continue
        c = sum((me_src.v[j] for j in f), Vector()) / len(f)
        # area-proportional sampling
        area = 0.0
        for k in range(1, len(f) - 1):
            area += (me_src.v[f[k]] - me_src.v[f[0]]).cross(me_src.v[f[k + 1]] - me_src.v[f[0]]).length * 0.5
        acc += area * facing
        while acc > step * step:
            acc -= step * step
            L = amount * P.rnd(0.06, 0.35) * facing
            w = L * P.rnd(0.35, 0.6)
            base = c + (me_src.v[f[P._rng.randrange(len(f))]] - c) * P.rnd(0.0, 0.8)
            tip = base + into * L + Vector((0, 0, P.rnd(-0.02, 0.05)))
            side = into.cross(Vector((0, 0, 1)))
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            side.normalize()
            up = side.cross(into).normalized()
            q = [base + side * w * 0.5, base + up * w * 0.4, base - side * w * 0.5, base - up * w * 0.4]
            ids = [out.vert(p) for p in q]
            t = out.vert(tip)
            for k in range(4):
                out.face([ids[k], ids[(k + 1) % 4], t], [(0, 0), (w, 0), (w / 2, L)], mat, True, (0.95, 0.97, 1.0), P.F_EXP)
    return out

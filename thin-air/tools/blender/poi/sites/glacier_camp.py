"""Glacier camp on the Corrigan Glacier (~2,500 m): two expedition dome tents behind a snow wall, aluminium
Zarges cases and a fuel drum, a snowmobile under a lashed tarp with a Nansen sled, avalanche/ice probes, bamboo
wands with flags, a mass-balance stake with a GPS mast, snow drifts."""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube


def snowmobile_under_tarp(tint=(0.12, 0.2, 0.45)):
    """A snowmobile shape (skis + tracks show) with a tarp draped and lashed over it; along X, front +X."""
    me = P.Mesh()
    for sy in (-0.45, 0.45):
        me.extend(box(1.3, 0.14, 0.04, "plastic", 'x', tint=(0.1, 0.1, 0.1)).transformed(T(1.1, sy, 0.05)))
        me.extend(tube([(1.75, sy, 0.05), (1.85, sy, 0.12), (1.82, sy, 0.2)], 0.02, "plastic", 5, tint=(0.1, 0.1, 0.1)))
        me.extend(rod((1.0, sy, 0.07), (0.9, sy * 0.7, 0.45), 0.03, "metal_dark", 6))
    me.extend(box(2.0, 0.55, 0.3, "rubber", 'x').transformed(T(-0.4, 0, 0.18)))
    # tarp: a draped heightfield over the body
    def drape(x, y):
        body = 0.0
        if -1.45 < x < 1.35:
            body = 1.05 * max(0.0, 1 - (abs(y) / 0.62) ** 3) * (1 - max(0.0, (x - 0.6) / 0.8) ** 2)
            if x < -0.2:
                body *= 0.85
        return max(0.08, body) + 0.02 * P.nz((x, y, 0), 4.0)
    tarp = P.heightpatch(3.2, 1.7, 0.12, drape, "nylon_paint_2s", tint=tint, cx=-0.05)
    me.extend(tarp)
    for x in (-0.9, 0.2):
        me.extend(tube([(x, -0.85, 0.05), (x, -0.6, 0.9), (x, 0.0, 1.07), (x, 0.6, 0.9), (x, 0.85, 0.05)], 0.008, "rope", 4,
                       tint=(0.9, 0.85, 0.2)))
    return me


def nansen_sled(L=2.4):
    me = P.Mesh()
    for sy in (-0.3, 0.3):
        me.extend(tube([(-L / 2, sy, 0.03), (L / 2 - 0.1, sy, 0.03), (L / 2 + 0.1, sy, 0.2)], 0.025, "wood_log", 6))
        for x in (-0.9, -0.3, 0.3, 0.9):
            me.extend(rod((x, sy, 0.03), (x, sy, 0.22), 0.02, "wood_log", 5))
        me.extend(rod((-L / 2, sy, 0.22), (L / 2 - 0.1, sy, 0.22), 0.02, "wood_log", 5))
    for x in (-0.9, -0.3, 0.3, 0.9):
        me.extend(rod((x, -0.32, 0.22), (x, 0.32, 0.22), 0.02, "wood_log", 5))
    return me


def build():
    s = P.Site("glacier_camp", seed_=73)
    s.bucket("main", vis_end=900.0)
    s.bucket("detail", vis_end=90.0)
    G = P.Ground("glacier_camp")
    # snow wall (west, windward) in an arc
    for k in range(9):
        a = math.radians(120 + k * 14)
        x, y = 4.2 * math.cos(a), 4.2 * math.sin(a)
        for row in range(2):
            s.add(box(0.4, 0.55, 0.3, "snow_packed", 'x', tint=(0.97, 0.98, 1.0)), T(x, y, G.h(x, y) + 0.15 + row * 0.3) @ RZ(math.degrees(a)), "main")
    s.col_box("snow", Vector((-3.6, 0.0, G.h(-3.6, 0) + 0.3)), (0.5, 7.5, 0.6))
    tents = []
    for k, (x, y, yaw, tint) in enumerate(((-0.8, 1.6, 10, (0.85, 0.6, 0.06)), (1.6, -0.6, -25, (0.85, 0.25, 0.05)))):
        tent, anchors = PR.dome_tent(1.3, 0.9, 1.2, tint, seed_=k + 2.0)
        Mt = T(x, y, G.h(x, y)) @ RZ(yaw)
        s.add(tent, Mt, "main")
        s.add(P.heightpatch(3.2, 2.4, 0.4, lambda u, v: 0.02, "snow"), Mt, "main")
        s.col_box("wood", Mt @ Vector((0, 0, 0.5)), (2.3, 1.6, 1.0), Mt)
        for j, a in enumerate(anchors):
            wa = Mt @ a
            g = wa + (wa - (Mt @ Vector((0, 0, 0.5)))).normalized() * 1.2
            g.z = G.h(g.x, g.y)
            s.add(AR.guy(wa, g, 0.0, 0.003, 2, "rope"), None, "detail")
            s.add(rod(g, g + Vector((0, 0, 0.35)), 0.012, "metal_bare", 4), None, "detail")
        s.shelter("Shelter_Tent%d" % (k + 1), Mt @ Vector((0, 0, 0)), (2.2, 1.6, 1.1), 0.75, yaw=yaw)
        tents.append(Mt)
    # cases, drum, probes, wands, mass-balance stake with GPS
    for k, (x, y, a) in enumerate(((2.6, 2.6, 15), (3.3, 2.1, -20), (2.9, 2.4, 60))):
        s.add(PR.zarges_box(), T(x, y, G.h(x, y) + (0.45 if k == 2 else 0)) @ RZ(a), "main")
    s.col_box("metal", Vector((3.0, 2.4, G.h(3.0, 2.4) + 0.45)), (1.6, 1.2, 0.9))
    s.add(PR.barrel((0.1, 0.3, 0.12)), T(-2.4, -2.6, G.h(-2.4, -2.6)), "main")
    s.col_box("metal", Vector((-2.4, -2.6, G.h(-2.4, -2.6) + 0.44)), (0.6, 0.6, 0.88))
    for k in range(5):
        x, y = -1.0 + k * 0.18, -3.2 + k * 0.05
        s.add(rod((x, y, G.h(x, y) - 0.4), (x + 0.05, y, G.h(x, y) + 2.2), 0.007, "metal_bare", 4), None, "detail")
    SX, SY = 6.5, -3.5
    sz = G.h(SX, SY)
    s.add(rod((SX, SY, sz - 0.5), (SX, SY, sz + 2.6), 0.03, "galvanized", 6), None, "main")
    s.add(lathe([(0.0, 0.0), (0.09, 0.0), (0.1, 0.05), (0.0, 0.08)], "plastic", 10, tint=(0.9, 0.9, 0.88)), T(SX, SY, sz + 2.6), "main")
    s.add(box(0.2, 0.12, 0.25, "plastic", tint=(0.85, 0.85, 0.82)), T(SX, SY - 0.1, sz + 1.3), "main")
    for k in range(8):
        a = math.radians(k * 45 + 10)
        p = Vector((9.0 * math.cos(a), 9.0 * math.sin(a), 0))
        p.z = G.h(p.x, p.y)
        s.add(rod(p, p + Vector((0.02, 0, 1.7)), 0.012, "wood_log", 4, tint=(0.9, 0.85, 0.6)), None, "detail")
        s.add(P.quad(p + Vector((0.02, 0, 1.7)), p + Vector((0.35, 0.05, 1.66)), p + Vector((0.35, 0.05, 1.46)),
                     p + Vector((0.02, 0, 1.5)), "nylon_paint_2s", tint=(0.9, 0.3, 0.04) if k % 2 else (0.1, 0.25, 0.7)), None, "detail")
    # snowmobile under the tarp, sled alongside
    MX, MY = -1.4, -4.8
    Ms = T(MX, MY, G.h(MX, MY)) @ RZ(-15)
    s.add(snowmobile_under_tarp(), Ms, "main")
    s.col_box("metal", Ms @ Vector((0.0, 0.0, 0.5)), (3.0, 1.3, 1.0), Ms)
    s.add(nansen_sled(), Ms @ T(-0.3, -1.4, 0), "main")
    s.add(PR.zarges_box(0.7, 0.5, 0.4), Ms @ T(-0.3, -1.4, 0.24), "main")
    s.add(PR.duffel(0.8, 0.2, "nylon", (0.1, 0.1, 0.1)), Ms @ T(0.5, -1.4, 0.24) @ RZ(90), "main")
    s.col_box("wood", Ms @ Vector((0.0, -1.4, 0.35)), (2.4, 0.8, 0.7), Ms)
    # drifts
    for k, (x, y, rx, ry, h) in enumerate(((5.0, 1.0, 1.8, 3.0, 0.5), (-5.2, -0.5, 1.2, 3.5, 0.7), (2.0, 5.0, 3.0, 1.2, 0.4))):
        s.add(P.heightpatch(rx * 2.2, ry * 2.2, 0.45, lambda u, v, rx=rx, ry=ry, h=h: h * max(0.0, 1 - (u / rx) ** 2 - (v / ry) ** 2) ** 0.8 - 0.04,
                            "snow"), T(x, y, G.h(x, y)), "main")
    s.marker("Arrive_Default", (0.0, -9.0, G.h(0.0, -9.0)), 0)
    s.marker("Loot_Tent1", tents[0] @ Vector((0, 0, 0.2)), 0)
    s.marker("Loot_Tent2", tents[1] @ Vector((0, 0, 0.2)), 0)
    s.marker("Loot_Cases", (2.9, 2.4, G.h(2.9, 2.4) + 1.0), 0)
    s.marker("Loot_Sled", Ms @ Vector((0.0, -1.4, 0.7)), 0)
    s.marker("Use_Snowmobile", Ms @ Vector((0.9, -0.8, 0.6)), 0)
    s.marker("Use_GPS", (SX, SY - 0.3, sz + 1.3), 0)
    return [s]

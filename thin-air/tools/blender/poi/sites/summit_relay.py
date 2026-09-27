"""Summit relay KR-1 on Mount Corrigan (3,452 m): a 15 m galvanised triangular lattice mast on a rock-bolted
footing with panel antennas, a 1.2 m microwave dish (ice-loaded, knocked off its azimuth), VHF whips, lightning
rod, equipment enclosures and cable ladder, three guy sets to rock anchors, a small insulated relay hut in the lee
(east) with the battery box and solar panels, a survey cairn. Everything carries rime ice grown into the
prevailing west-north-west wind (feathers point upwind). Hale lies in the lee of the hut.
"""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube

WIND = Vector((0.93, -0.36, 0.0)).normalized()     # wind blows TOWARD east-south-east (from WNW)


def panel_antenna(h=1.3, w=0.3, d=0.12):
    me = box(w, d, h, "plastic", 'z', tint=(0.85, 0.85, 0.82)).transformed(T(0, 0, 0))
    for z in (-h * 0.3, h * 0.3):
        me.extend(rod((0, d / 2, z), (0, d / 2 + 0.25, z), 0.02, "galvanized", 6))
    return me


def build():
    s = P.Site("summit_relay", seed_=67)
    s.bucket("main", vis_end=2500.0)
    s.bucket("detail", vis_end=140.0)
    s.bucket("rime", vis_end=160.0, shadow=False)
    G = P.Ground("summit")
    H = 15.0
    mast = AR.lattice_mast(H, 0.65, "galvanized", 0.035, 0.014, 1.0, 3)
    mast.extend(rod((0, 0, H), (0, 0, H + 1.8), 0.015, "metal_bare", 6))
    mast.extend(box(1.2, 1.2, 0.5, "concrete", seg=0.4).transformed(T(0, 0, -0.1)))
    # antennas: two panels at the top (one knocked askew), VHF whips, the dish
    ant = P.Mesh()
    ant.extend(panel_antenna().transformed(T(0.35, 0.3, H - 1.0) @ RZ(35)))
    ant.extend(panel_antenna().transformed(T(-0.4, 0.15, H - 1.2) @ RZ(160) @ RX(14)))
    for k, a in enumerate((20, 140, 260)):
        x, y = 0.28 * math.cos(math.radians(a)), 0.28 * math.sin(math.radians(a))
        ant.extend(rod((x, y, H - 0.2), (x * 1.8, y * 1.8, H + 1.4), 0.012, "metal_bare", 5))
    dish = lathe([(0.0, 0.0), (0.2, 0.01), (0.4, 0.05), (0.6, 0.12), (0.62, 0.15), (0.0, 0.14)], "paint_gloss", 20,
                 tint=(0.85, 0.85, 0.83))
    dish.extend(cyl(0.63, 0.25, "plastic", 20, tint=(0.8, 0.8, 0.78)).transformed(T(0, 0, 0.12)))
    dish.extend(box(0.35, 0.35, 0.25, "metal_bare").transformed(T(0, 0, -0.15)))
    ant.extend(dish.transformed(T(0.1, -0.55, 11.0) @ RZ(-150) @ RX(-78) @ RY(12)))
    ant.extend(rod((0.0, -0.3, 11.0), (0.1, -0.55, 11.0), 0.05, "galvanized", 6))
    # equipment enclosures + cable ladder
    for z in (2.0, 3.1):
        ant.extend(box(0.5, 0.25, 0.7, "paint_metal", tint=(0.8, 0.8, 0.78)).transformed(T(0.0, -0.45, z)))
    ant.extend(box(0.12, 0.03, H - 1.5, "galvanized", 'z').transformed(T(-0.15, -0.28, (H - 1.5) / 2 + 1.0)))
    for k in range(6):
        ant.extend(tube([(-0.12 + 0.02 * k, -0.3, 1.0), (-0.12 + 0.02 * k, -0.3, H - 0.8)], 0.01, "rubber", 4))
    ant.extend(PR.decal("sign_relay", 0.6, 0.15).transformed(T(0.0, -0.576, 2.6)))
    s.add(mast, None, "main")
    s.add(ant, None, "main")
    s.col_box("metal", Vector((0, 0, H / 2)), (0.7, 0.7, H))
    s.col_box("metal", Vector((0, -0.45, 2.5)), (0.5, 0.3, 1.8))
    # guys: three directions, two levels, to rock-bolt anchors on the real slopes
    guys = P.Mesh()
    for k, a in enumerate((80.0, 200.0, 320.0)):
        ax = 7.5 * math.cos(math.radians(a))
        ay = 7.5 * math.sin(math.radians(a))
        az = G.h(ax, ay)
        for lvl in (6.5, 12.5):
            guys.extend(AR.guy((0.25 * math.cos(math.radians(a)), 0.25 * math.sin(math.radians(a)), lvl), (ax, ay, az + 0.25), 0.01, 0.006, 6))
        guys.extend(box(0.3, 0.3, 0.3, "metal_rusty").transformed(T(ax, ay, az + 0.1)))
        guys.extend(P.blob((0, 0, 0), (0.9, 0.8, 0.5), "rock", 9, 0.3, k * 2.0, rings=5).transformed(T(ax, ay, az - 0.15)))
    s.add(guys, None, "detail")
    # relay hut in the lee (east), battery box, solar panels on a frame
    HX, HY = 4.2, -1.4
    hz = G.h(HX, HY)
    hut = P.Mesh()
    W, D, Hh = 2.2, 1.7, 2.0
    for (sx, sy, w, d) in ((0, -D / 2, W, 0.08), (0, D / 2, W, 0.08), (-W / 2, 0, 0.08, D), (W / 2, 0, 0.08, D)):
        hut.extend(box(w, d, Hh, "panel", 'z', seg=0.5, tint=(0.86, 0.86, 0.82)).transformed(T(sx, sy, Hh / 2)))
    hut.extend(box(W + 0.3, D + 0.3, 0.1, "metal_corrugated", 'x', tint=(0.8, 0.8, 0.8)).transformed(T(0, 0, Hh + 0.08) @ RY(-5)))
    hut.extend(AR.door_leaf(0.75, 1.75, 0.05, "paint_metal", (0.7, 0.7, 0.68)).transformed(T(0.3, -D / 2 - 0.05, 0.02)))
    hut.extend(box(W + 0.4, D + 0.4, 0.25, "concrete", seg=0.6).transformed(T(0, 0, 0.0)))
    for k in range(6):
        hut.extend(box(0.05, 0.03, Hh - 0.1, "panel", 'z', tint=(0.8, 0.8, 0.76)).transformed(T(-W / 2 + 0.2 + k * 0.36, D / 2 + 0.045, Hh / 2)))
        hut.extend(box(0.03, 0.05, Hh - 0.1, "panel", 'z', tint=(0.8, 0.8, 0.76)).transformed(T(-W / 2 - 0.045, -D / 2 + 0.15 + k * 0.28, Hh / 2)))
    hut.extend(box(0.35, 0.06, 0.25, "metal_bare").transformed(T(-0.6, -D / 2 - 0.04, 1.55)))
    for k in range(5):
        hut.extend(box(0.3, 0.02, 0.012, "metal_dark").transformed(T(-0.6, -D / 2 - 0.075, 1.46 + k * 0.045)))
    hut.extend(PR.decal("sign_relay", 0.6, 0.15).transformed(T(0.3, -D / 2 - 0.052, 1.95)))
    hut.extend(tube([(-W / 2 - 0.02, 0.3, 1.8), (-2.0, 0.6, 1.5), (-3.9, 1.3, 1.6), (-0.1, -0.35, 1.5)], 0.02, "rubber", 5).transformed(T(0, 0, 0)))
    s.add(hut, T(HX, HY, hz) @ RZ(8), "main")
    lee = P.heightpatch(3.2, 3.0, 0.3, lambda u, v: max(0.0, 0.55 * (1 - (u / 1.6) ** 2) * (1 - max(0.0, v / 1.5)) * min(1.0, (v + 1.5) / 0.8)) - 0.03,
                        "snow", smooth_=True)
    s.add(lee, T(HX + 2.4, HY + 0.2, G.h(HX + 2.4, HY + 0.2)) @ RZ(8 - 90), "main")
    s.col_box("metal", Vector((HX, HY, hz + Hh / 2)), (W, D, Hh + 0.3), RZ(8))
    bb = box(1.0, 0.6, 0.6, "plastic", tint=(0.15, 0.15, 0.15)).transformed(T(0, 0, 0.3))
    bb.extend(box(0.9, 0.1, 0.05, "plastic", tint=(0.9, 0.7, 0.1)).transformed(T(0, -0.31, 0.45)))
    s.add(bb, T(HX + 1.9, HY + 0.3, G.h(HX + 1.9, HY + 0.3)) @ RZ(8), "main")
    s.col_box("plastic" if False else "metal", Vector((HX + 1.9, HY + 0.3, G.h(HX + 1.9, HY + 0.3) + 0.3)), (1.0, 0.6, 0.6))
    SPX, SPY = HX + 1.0, HY - 2.6
    spz = G.h(SPX, SPY)
    for i in range(2):
        pn = box(1.0, 1.65, 0.04, "solar_cell", 'y')
        pn.extend(box(1.04, 1.69, 0.03, "metal_bare").transformed(T(0, 0, -0.03)))
        s.add(pn, T(SPX - 0.55 + i * 1.1, SPY, spz + 1.1) @ RX(-72), "main")
    for x in (SPX - 1.0, SPX + 1.0):
        s.add(rod((x, SPY + 0.25, spz - 0.2), (x, SPY + 0.25, spz + 1.8), 0.035, "galvanized", 6), None, "main")
    s.col_box("metal", Vector((SPX, SPY, spz + 1.0)), (2.2, 0.6, 2.0))
    # survey cairn: a squat pile of angular frost-shattered blocks with the brass survey disc on a bolt
    cz = G.h(-2.2, 1.6)
    for k in range(26):
        hz = P.rnd(0.0, 1.0) ** 1.4 * 1.15
        rr = (1.0 - hz / 1.3) * 0.65 * P.rnd(0.3, 1.0)
        a = P.rnd(0, 2 * math.pi)
        sz = P.rnd(0.14, 0.28)
        blk = box(sz * P.rnd(1.0, 1.6), sz * P.rnd(0.8, 1.3), sz * P.rnd(0.6, 0.9), "rock", 'x', tint=(0.8, 0.8, 0.78))
        blk.displace(lambda p, k=k: Vector((0.02 * P.nz(p, 9.0, k), 0.02 * P.nz(p, 9.0, k + 1), 0.015 * P.nz(p, 9.0, k + 2))))
        s.add(blk, T(-2.2 + math.cos(a) * rr, 1.6 + math.sin(a) * rr, cz + 0.08 + hz) @ RZ(P.rnd(0, 180)) @ RX(P.rnd(-15, 15)) @ RY(P.rnd(-15, 15)), "main")
    s.add(cyl(0.045, 0.01, "metal_bare", 12, tint=(0.8, 0.6, 0.3)), T(-1.55, 1.6, cz + 0.02), "detail")
    s.col_box("rock", Vector((-2.2, 1.6, cz + 0.6)), (1.2, 1.2, 1.2))
    # rime on everything exposed, grown into the wind
    rimed = P.Mesh()
    for src, amt, sd in ((mast, 1.0, 1), (ant, 0.9, 2), (guys, 0.5, 3)):
        rimed.extend(PR.rime(src, WIND, amt, sd, step=0.12))
    rimed.extend(PR.rime(hut.transformed(T(HX, HY, hz) @ RZ(8)), WIND, 0.6, 4, step=0.2))
    s.add(rimed, None, "rime")
    # sockets
    s.marker("Arrive_Default", (0.5, 12.0, G.h(0.5, 12.0)), 180)
    s.marker("Use_Relay", (0.0, -0.8, 2.3), 0)
    s.marker("Use_Antenna", (0.0, -0.9, 1.2), 0)
    s.marker("Use_BatteryBox", (HX + 1.9, HY - 0.4, G.h(HX + 1.9, HY + 0.3) + 0.6), 0)
    s.marker("Use_Door_Hut", (HX + 0.3, HY - 1.2, hz + 1.0), 0)
    s.marker("Spot_HaleBody", (HX + 1.6, HY + 1.6, G.h(HX + 1.6, HY + 1.6) + 0.05), 200)
    s.marker("Log_hale_03", (HX + 1.2, HY + 1.3, G.h(HX + 1.2, HY + 1.3) + 0.1), 200)
    s.marker("Log_hale_notebook", (HX + 1.7, HY + 1.5, G.h(HX + 1.7, HY + 1.5) + 0.25), 200)
    s.marker("Spot_Transmit", (0.0, -1.6, 0.0), 0)
    s.shelter("Shelter_Lee", Vector((HX + 1.4, HY + 1.4, G.h(HX + 1.4, HY + 1.4))), (2.4, 2.4, 2.0), 0.35)
    return [s]

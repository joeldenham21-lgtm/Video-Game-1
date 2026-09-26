"""Trapper's cabin (~1,737 m): a small 1950s saddle-notched log cabin gone to ruin - the ridge sags, part of the
roof has fallen in, the door hangs from one hinge, the window is empty. Inside: a rusted barrel stove on stones,
a pole bunk with a rotten mattress, shelf of rusted tins, leghold traps hung on nails; outside: snowshoes on the
wall, fur stretching boards, a rotten woodpile, a chopping block and the food cache high on four tin-banded poles."""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube

X0, X1 = -1.8, 1.8
Y0, Y1 = -1.5, 1.5
R = 0.13
WH = 1.9
OLD = (0.62, 0.6, 0.57)


def build():
    s = P.Site("trapper_cabin", seed_=83)
    s.bucket("main", vis_end=700.0)
    s.bucket("detail", vis_end=80.0)
    s.bucket("interior", vis_end=25.0)
    G = P.Ground("trapper_cabin")
    step = R * 1.78
    door = (0.4, 1.15, 0.1, 1.7)
    win = (0.9, 1.5, 0.8, 1.35)
    walls = [(T(X0, Y0, 0.1), X1 - X0, [door], None), (T(X1, Y1, 0.1) @ RZ(180), X1 - X0, [], None),
             (T(X0, Y1, 0.1) @ RZ(-90), Y1 - Y0, [win], R + step / 2), (T(X1, Y0, 0.1) @ RZ(90), Y1 - Y0, [], R + step / 2)]
    for k, (M, L, ops, z0) in enumerate(walls):
        me, cols = AR.log_wall(L, WH, R, ops, seed_=60 + k, ext=0.28, z_start=z0, chink=False)
        me.set_tint(OLD)
        s.add(me, M, "main")
        for c, size in cols:
            s.col_box("wood", M @ c, size, M)
    # sagging ridge, one roof panel partly caved in (boards over poles, rotten)
    PL = 0.1 + WH + 0.05
    rise = 1.0
    for sy in (-1, 1):
        for j in range(9):
            x = X0 - 0.35 + j * (X1 - X0 + 0.7) / 8
            sag = 0.35 * math.sin(math.pi * (j / 8))
            if sy > 0 and 3 <= j <= 5:
                continue
            p0 = Vector((x, sy * (Y1 + 0.4), PL - 0.2))
            p1 = Vector((x, 0.0, PL + rise - sag))
            s.add(rod(p0, p1, 0.05, "bark_dead", 5, tint=(0.8, 0.8, 0.8)), None, "main")
        # boards along the slope
        for i in range(7):
            t0 = i / 7
            y = sy * (Y1 + 0.4) * (1 - t0)
            z = PL - 0.2 + (rise + 0.2) * t0
            bd = box(X1 - X0 + 0.7, 0.26, 0.03, "wood_planks", 'x', seg=0.5, tint=(0.6, 0.58, 0.55))
            bd.displace(lambda p, i=i: Vector((0, 0, -0.35 * math.sin(math.pi * (p.x - X0 + 0.35) / (X1 - X0 + 0.7)) * (1 - i / 9))))
            if sy > 0 and 1 <= i <= 4:
                P.remove_faces(bd, lambda c, _i, i=i: abs(c.x) < 0.9 - 0.15 * i)
            ang = math.degrees(math.atan2(rise + 0.2, Y1 + 0.4)) * sy
            s.add(bd, T(0, y, z + 0.08) @ RX(ang), "main")
    # fallen boards and a broken pole inside
    for k in range(4):
        s.add(box(1.4, 0.24, 0.03, "wood_planks", 'x', tint=(0.55, 0.52, 0.5)), T(P.rnd(-0.6, 0.6), 0.5 + P.rnd(-0.3, 0.3), 0.2 + k * 0.05) @ RZ(P.rnd(-30, 30)) @ RX(P.rnd(-25, 25)), "interior")
    s.col_box("wood", Vector((0, 0, PL + 0.4)), (X1 - X0 + 0.6, Y1 - Y0 + 0.6, 0.3))
    # gable ends: vertical boards, a few missing
    for sx in (-1, 1):
        for j in range(10):
            y = Y0 - 0.1 + j * 0.34
            hgt = max(0.05, rise * (1 - abs(y) / (Y1 + 0.3)) - 0.1)
            if j in (3, 7) and sx > 0:
                continue
            s.add(box(0.03, 0.32, hgt, "wood_planks", 'z', tint=(0.6, 0.58, 0.55)), T(sx * (X1 - X0) / 2, y, PL + hgt / 2), "main")
    # floor of split poles (half rotten)
    s.add(box(X1 - X0 - 0.2, Y1 - Y0 - 0.2, 0.05, "wood_planks", 'y', seg=0.6, tint=(0.5, 0.47, 0.44)), T(0, 0, 0.12), "main")
    s.col_box("wood", Vector((0, 0, 0.07)), (X1 - X0, Y1 - Y0, 0.14))
    # door hanging from one hinge
    dr = P.Mesh()
    for j in range(4):
        dr.extend(box(0.18, 0.04, 1.55, "wood_planks", 'z', tint=(0.55, 0.52, 0.5)).transformed(T(0.1 + j * 0.19, 0, 0.8)))
    dr.extend(box(0.7, 0.03, 0.1, "wood_planks", 'x', tint=(0.5, 0.48, 0.45)).transformed(T(0.4, 0.03, 1.2) @ RY(30)))
    s.add(dr, T(X0 + 0.4, Y0 - 0.1, 0.25) @ RZ(-50) @ RY(9), "main")
    # interior
    st = lathe([(0.0, 0.0), (0.28, 0.0), (0.28, 0.75), (0.0, 0.75)], "metal_rusty", 14).transformed(T(0, 0, 0.29) @ RY(90) @ T(0, 0, -0.37))
    st.extend(cyl(0.06, 1.7, "metal_rusty", 8).transformed(T(0.2, 0, 0.55) @ RY(-4)))
    for k in range(4):
        st.extend(P.blob((0, 0, 0), (0.14, 0.12, 0.1), "rock", 6, 0.3, k, rings=3).transformed(T(-0.3 + (k % 2) * 0.6, -0.2 + (k // 2) * 0.4, 0.05)))
    s.add(st, T(1.1, 0.8, 0.14), "interior")
    s.col_box("metal", Vector((1.1, 0.8, 0.45)), (0.8, 0.6, 0.6))
    bunk = P.Mesh()
    for sx in (-1, 1):
        bunk.extend(rod((sx * 0.35, -0.95, 0.45), (sx * 0.35, 0.95, 0.45), 0.05, "bark_dead", 6))
        for sy in (-0.9, 0.9):
            bunk.extend(rod((sx * 0.35, sy, 0.0), (sx * 0.35, sy, 0.5), 0.05, "bark_dead", 6))
    mat = box(0.65, 1.8, 0.08, "canvas", 'y', seg=0.3, tint=(0.35, 0.3, 0.22))
    mat.displace(lambda p: Vector((0, 0, 0.04 * P.nz(p, 3.0, 5.0))))
    bunk.extend(mat.transformed(T(0, 0, 0.52)))
    s.add(bunk, T(-1.2, 0.5, 0.14), "interior")
    s.col_box("wood", Vector((-1.2, 0.5, 0.45)), (0.8, 1.9, 0.5))
    sh = PR.shelf(0.9, 0.6, 0.25, 2, "wood_planks", (0.6, 0.55, 0.5))
    for j in range(4):
        sh.extend(cyl(0.045, 0.11, "metal_rusty", 8).transformed(T(-0.3 + j * 0.2, 0, 0.1)))
    s.add(sh, T(0.3, Y1 - 0.2, 0.9) @ RZ(180), "interior")
    for k in range(3):
        s.add(PR.leghold_trap(open_=False).transformed(RX(90)), T(-0.4 + k * 0.35, Y1 - 0.14, 1.35), "interior")
        s.add(rod((-0.4 + k * 0.35, Y1 - 0.13, 1.45), (-0.4 + k * 0.35, Y1 - 0.2, 1.45), 0.006, "metal_rusty", 4), None, "interior")
    s.add(PR.leghold_trap(), T(0.2, -0.6, 0.15) @ RZ(40), "interior")
    # outside: snowshoes on the wall, stretchers, woodpile, block, the cache
    s.add(PR.snowshoes().transformed(RX(90)), T(X1 + 0.18, 0.2, 1.1) @ RZ(90), "detail")
    for k in range(3):
        sb = P.slab([(-0.1, 0.0), (0.1, 0.0), (0.06, 1.1), (0.0, 1.2), (-0.06, 1.1)], 0.02, "wood_planks", tint=(0.65, 0.6, 0.55))
        s.add(sb, T(X1 + 0.2, -0.9 + k * 0.28, 0.2) @ RZ(90) @ RX(-6), "detail")
    s.add(PR.woodpile(1.8, 0.8, 0.4, seed_=21), T(X0 - 0.6, 0.3, 0.02) @ RZ(90), "main")
    s.col_box("wood", Vector((X0 - 0.6, 0.3, 0.4)), (0.45, 1.8, 0.8))
    s.add(cyl(0.25, 0.45, "wood_log", 9, cap_mat="wood_endgrain", tint=OLD), T(-1.0, -3.2, G.h(-1.0, -3.2)), "detail")
    CX, CY = 4.8, 3.2
    cz = G.h(CX, CY)
    cache = P.Mesh()
    for sx in (-0.8, 0.8):
        for sy in (-0.7, 0.7):
            cache.extend(rod((sx, sy, -0.3), (sx, sy, 3.0), 0.1, "bark_dead", 7, tint=OLD))
            cache.extend(cyl(0.105, 0.5, "metal_corrugated", 8, caps=False).transformed(T(sx, sy, 1.4)))
    cache.extend(box(1.9, 1.7, 0.12, "wood_planks", 'x', tint=OLD).transformed(T(0, 0, 3.0)))
    for sy in (-0.7, 0.7):
        cache.extend(box(1.6, 0.05, 0.9, "wood_planks", 'x', tint=OLD).transformed(T(0, sy, 3.5)))
    for sx in (-0.75, 0.75):
        cache.extend(box(0.05, 1.4, 0.9, "wood_planks", 'y', tint=OLD).transformed(T(sx, 0, 3.5)))
    rf, rr = AR.gable_roof(1.7, 1.5, 35, 0.25, 0.06, "wood_planks", "wood_planks", (0.55, 0.52, 0.5))
    cache.extend(rf.transformed(T(0, 0, 3.95)))
    cache.extend(PR.ladder(3.2, 0.4, "bark_dead").transformed(T(0, -1.6, 0) @ RX(-18) @ RZ(0)).transformed(T(1.6, 0.4, -0.1)) if False else
                 PR.ladder(3.2, 0.4, "bark_dead").transformed(T(2.1, -0.4, -0.1) @ RZ(90) @ RY(-60) @ RZ(-90)).transformed(T(0, 0, 0)))
    s.add(cache, T(CX, CY, cz), "main")
    for sx in (-0.8, 0.8):
        for sy in (-0.7, 0.7):
            s.col_box("wood", Vector((CX + sx, CY + sy, cz + 1.5)), (0.2, 0.2, 3.0))
    s.col_box("wood", Vector((CX, CY, cz + 3.5)), (1.9, 1.7, 1.1))
    s.marker("Arrive_Default", (1.0, -6.0, G.h(1.0, -6.0)), 0)
    s.marker("Use_Door_Cabin", (X0 + 0.8, Y0 - 0.2, 1.0), 180)
    s.marker("Use_Stove", (1.1, 0.4, 0.6), 0)
    s.marker("Loot_Shelf", (0.3, Y1 - 0.3, 1.1), 180)
    s.marker("Loot_Traps", (-0.05, Y1 - 0.3, 1.3), 180)
    s.marker("Loot_Snowshoes", (X1 + 0.35, 0.2, 1.1), -90)
    s.marker("Loot_Cache", (CX, CY, cz + 3.2), 0)
    s.marker("Loot_Bunk", (-1.2, 0.5, 0.75), 0)
    s.probe("Probe_Cabin", Vector((0, 0, 1.2)), (3.4, 2.8, 2.4), ambient=(0.1, 0.1, 0.11))
    s.shelter("Shelter_Cabin", Vector((0, 0, 0.14)), (3.3, 2.7, 1.9), 0.55)
    return [s]

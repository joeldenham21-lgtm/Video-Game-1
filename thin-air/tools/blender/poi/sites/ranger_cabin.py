"""Loon Lake ranger cabin (~1,425 m): a saddle-notched log cabin with a covered porch facing the lake.

Local frame: the porch / door faces -Y (the placement yaw turns it south-west to Loon Lake, 34 m away and 5 m
lower). Inside: airtight wood stove (heat-source slot), built-in bunk, table and two chairs under the side
window, shelves, radio desk with the HF set under the east window, lantern hooks on the tie beams, coats,
washstand, map and calendar. Outside: woodpile under the eave, rain barrel, chopping block, outhouse, HF wire
antenna on a pole, a sign at the trail, stone fire ring and an upturned canvas canoe on log rests at the shore.
"""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube

X0, X1 = -3.2, 3.2       # wall centre lines
Y0, Y1 = -2.0, 3.2
R = 0.15                 # log radius
BASE = 0.15              # wall base (sill)
FLOOR = 0.42             # floor top
WALL_H = 2.55
PLATE = BASE + WALL_H + 0.1
YAW = -50.0


def canoe(L=4.9, beam=0.88, depth=0.34, tint=(0.42, 0.06, 0.04)):
    """Canvas-covered cedar canoe, right side up (keel at z = 0), bow/stern along +-X."""
    rings = []
    n = 14
    for k in range(n + 1):
        t = k / n
        x = -L / 2 + L * t
        w = beam / 2 * math.sin(math.pi * t) ** 0.62
        sheer = depth + 0.14 * (2 * t - 1) ** 4
        pts = []
        for j in range(9):
            a = math.pi * j / 8
            y = -math.cos(a) * max(w, 0.01)
            z = sheer - (sheer - 0.0) * math.sin(a) ** 1.4 * (0.25 + 0.75 * math.sin(math.pi * t) ** 0.4)
            pts.append(Vector((x, y, z)))
        rings.append(pts)
    hull = P.loft(rings, "wood_paint_2s", closed=False, smooth_=True, tint=tint)
    me = P.Mesh().extend(hull)
    gun = [Vector((r_[0].x, r_[0].y, r_[0].z)) for r_ in rings]
    gun2 = [Vector((r_[-1].x, r_[-1].y, r_[-1].z)) for r_ in rings]
    me.extend(tube(gun, 0.018, "wood_log", 5))
    me.extend(tube(gun2, 0.018, "wood_log", 5))
    for x in (-1.2, 0.0, 1.2):
        me.extend(box(0.05, beam * 0.9 * math.sin(math.pi * (x + L / 2) / L), 0.02, "wood_log", 'y').transformed(T(x, 0, depth - 0.02)))
    return me


def build():
    s = P.Site("ranger_cabin", seed_=41)
    s.bucket("main", vis_end=900.0)
    s.bucket("detail", vis_end=100.0)
    s.bucket("interior", vis_end=35.0)
    s.bucket("ground", vis_end=200.0, shadow=False)
    G = P.Ground("ranger_cabin", yaw=YAW)
    step = R * 1.78
    L_fb = X1 - X0
    L_side = Y1 - Y0
    door = (1.0, 1.9, 0.2, 2.25)
    front_win = (3.6, 4.6, 1.0, 1.85)
    back_win = (1.4, 2.2, 1.15, 1.8)
    left_win = (2.1, 3.1, 1.0, 1.85)
    right_win = (2.1, 2.9, 1.1, 1.8)
    walls = [
        ("front", T(X0, Y0, BASE), L_fb, [door, front_win], None),
        ("back", T(X1, Y1, BASE) @ RZ(180), L_fb, [back_win], None),
        ("left", T(X0, Y1, BASE) @ RZ(-90), L_side, [left_win], R + step / 2),
        ("right", T(X1, Y0, BASE) @ RZ(90), L_side, [right_win], R + step / 2),
    ]
    for k, (name, M, L, ops, z0) in enumerate(walls):
        me, cols = AR.log_wall(L, WALL_H, R, ops, seed_=k + 3, ext=0.32, z_start=z0)
        s.add(me, M, "main")
        for c, size in cols:
            s.col_box("wood", M @ c, size, M)
        for (a, b, z_a, z_b) in ops:
            if (a, b, z_a, z_b) == door:
                # door bucks + plank door, ajar
                s.add(box(0.08, 0.3, z_b - z_a, "wood_planks", 'z').transformed(T(a - 0.04, 0, z_a + (z_b - z_a) / 2)), M, "main")
                s.add(box(0.08, 0.3, z_b - z_a, "wood_planks", 'z').transformed(T(b + 0.04, 0, z_a + (z_b - z_a) / 2)), M, "main")
                s.add(box(b - a + 0.16, 0.3, 0.1, "wood_planks", 'x').transformed(T((a + b) / 2, 0, z_b + 0.05)), M, "main")
                leaf = P.Mesh()
                for j in range(5):
                    leaf.extend(box(0.175, 0.045, z_b - z_a - 0.02, "wood_planks", 'z', tint=(0.85, 0.8, 0.72)).transformed(
                        T(0.09 + j * 0.178, 0, (z_b - z_a) / 2)))
                for zz in (0.3, z_b - z_a - 0.35):
                    leaf.extend(box(0.85, 0.03, 0.12, "wood_planks", 'x').transformed(T(0.45, 0.04, zz)))
                leaf.extend(rod((0.78, -0.03, 1.0), (0.78, -0.09, 1.0), 0.012, "metal_dark"))
                s.add(leaf, M @ T(a, 0.05, z_a) @ RZ(-70), "main")
            else:
                s.add(AR.window(b - a, z_b - z_a, 0.3, "wood_paint", (0.82, 0.8, 0.72), "glass", bars=1),
                      M @ T((a + b) / 2, 0, z_a), "main")
    # sill logs on foundation stones, plank floor, tie beams
    for (p0, p1) in (((X0 - 0.3, Y0, 0.0), (X1 + 0.3, Y0, 0.0)), ((X0 - 0.3, Y1, 0.0), (X1 + 0.3, Y1, 0.0))):
        s.add(rod(p0, p1, 0.17, "wood_log", 10, cap_mat="wood_endgrain"), T(0, 0, 0.12), "main")
    for x in (X0, 0.0, X1):
        for y in (Y0, Y1):
            s.add(P.blob((0, 0, 0), (0.3, 0.28, 0.2), "rock", 8, 0.3, x + y, rings=4), T(x, y, -0.02), "main")
    s.add(box(L_fb - 0.3, L_side - 0.3, 0.05, "wood_planks", 'y', seg=0.8, flags=P.F_NOEXP), T(0, (Y0 + Y1) / 2, FLOOR - 0.025), "main")
    s.col_box("wood", Vector((0, (Y0 + Y1) / 2, FLOOR / 2)), (L_fb, L_side, FLOOR))
    for y in (0.0, 2.0):
        s.add(rod((X0 - 0.2, y, PLATE - 0.15), (X1 + 0.2, y, PLATE - 0.15), 0.1, "wood_log", 8, cap_mat="wood_endgrain"), None, "main")
    # roof: gable along X, green-painted corrugated steel over board decking, gable ends in vertical boards
    pitch = 32.0
    roof, rise = AR.gable_roof(L_fb + 0.3, L_side, pitch, 0.55, 0.1, "metal_corrugated", "wood_planks", (0.45, 0.58, 0.44),
                               under_mat="wood_planks")
    Mr = T(0, (Y0 + Y1) / 2, PLATE)
    s.add(roof, Mr, "main")
    half = L_side / 2 + 0.55
    for sy in (-1, 1):
        ang = -sy * pitch
        s.col_box("metal", Mr @ Vector((0, sy * half / 2, rise - (half / 2) * math.tan(math.radians(pitch)) + 0.05)),
                  (L_fb + 1.4, half / math.cos(math.radians(pitch)), 0.12), RX(ang))
    for sx in (-1, 1):
        tri = P.slab([(-L_side / 2, 0), (L_side / 2, 0), (0, rise)], 0.04, "wood_planks", grain_z=True)
        s.add(tri, T(sx * (L_fb / 2) + (0 if sx > 0 else -0.04), (Y0 + Y1) / 2, PLATE) @ RZ(90), "main")
    for j in range(4):
        y = Y0 + 0.2 + j * (L_side - 0.4) / 3
        s.add(box(0.07, 0.07, 0.07, "wood_log"), T(X0, y, PLATE), "detail")
    # rafters visible inside
    for k in range(6):
        x = X0 + 0.4 + k * (L_fb - 0.8) / 5
        for sy in (-1, 1):
            p0 = Vector((x, (Y0 + Y1) / 2 + sy * (L_side / 2), PLATE))
            p1 = Vector((x, (Y0 + Y1) / 2, PLATE + rise - 0.05))
            s.add(AR.beam(p0, p1, 0.06, 0.14, "wood_log") if hasattr(AR, "beam") else P.beam(p0, p1, 0.06, 0.14, "wood_log"), None, "interior")
    # stovepipe through the roof with a rain cap
    SX, SY = 2.25, 2.35
    pipe_top = PLATE + rise * (1 - abs(SY - (Y0 + Y1) / 2) / (L_side / 2)) + 0.9
    s.add(cyl(0.075, pipe_top - (FLOOR + 1.0), "metal_dark", 10, tint=(0.25, 0.25, 0.25)), T(SX, SY + 0.18, FLOOR + 1.0), "main")
    s.add(lathe([(0.0, 0.0), (0.2, 0.0), (0.0, 0.14)], "metal_dark", 10, tint=(0.3, 0.3, 0.3)), T(SX, SY + 0.18, pipe_top + 0.12), "main")

    # ------------------------------------------------------------------ porch
    PY0, PY1 = Y0 - 2.1, Y0 - 0.2
    s.add(box(L_fb + 0.6, PY1 - PY0, 0.05, "wood_planks", 'x', seg=0.8), T(0, (PY0 + PY1) / 2, FLOOR - 0.025), "main")
    s.col_box("wood", Vector((0, (PY0 + PY1) / 2, FLOOR / 2)), (L_fb + 0.6, PY1 - PY0, FLOOR))
    for x in (X0 - 0.1, -1.1, 1.1, X1 + 0.1):
        s.add(rod((x, PY0 + 0.15, 0), (x, PY0 + 0.15, FLOOR), 0.1, "wood_log", 8), None, "main")
        s.add(rod((x, PY0 + 0.15, FLOOR), (x, PY0 + 0.15, PLATE - 0.2), 0.085, "wood_log", 8), None, "main")
        s.col_box("wood", Vector((x, PY0 + 0.15, PLATE / 2)), (0.18, 0.18, PLATE))
    s.add(rod((X0 - 0.4, PY0 + 0.15, PLATE - 0.2), (X1 + 0.4, PY0 + 0.15, PLATE - 0.2), 0.1, "wood_log", 8,
              cap_mat="wood_endgrain"), None, "main")
    porch_pitch = 14.0
    plen = (Y0 - 0.55 - PY0 + 0.4) / math.cos(math.radians(porch_pitch))
    pr = box(L_fb + 1.0, plen, 0.08, "metal_corrugated", 'y', seg=1.2, tint=(0.45, 0.58, 0.44), mats={'-z': "wood_planks"})
    pz = PLATE - 0.1 + (Y0 - 0.55 - (PY0 - 0.4)) / 2 * math.tan(math.radians(porch_pitch))
    s.add(pr, T(0, (Y0 - 0.55 + PY0 - 0.4) / 2, pz) @ RX(porch_pitch), "main")
    s.col_box("metal", Vector((0, (Y0 - 0.55 + PY0 - 0.4) / 2, pz)), (L_fb + 1.0, plen, 0.1), RX(porch_pitch))
    for k in range(2):
        s.add(box(1.6, 0.3, 0.05, "wood_planks", 'x'), T(-1.45, PY0 - 0.2 - k * 0.3, FLOOR - 0.15 - k * 0.14), "main")
        s.col_box("wood", Vector((-1.45, PY0 - 0.2 - k * 0.3, (FLOOR - 0.15 - k * 0.14) / 2)), (1.6, 0.3, FLOOR - 0.15 - k * 0.14 + 0.03))
    s.add(PR.bench(1.6, 0.35), T(1.6, Y0 - 0.45, FLOOR), "detail")
    s.add(PR.decal("sign_ranger", 1.1, 0.41).transformed(T(0, 0, 0)), T(1.45, Y0 - 0.33, 2.3), "detail")

    # ------------------------------------------------------------------ interior
    Fz = FLOOR
    stove = PR.wood_stove(pipe_h=1.0 + 0.05)
    s.add(stove, T(SX, SY, Fz), "interior")
    s.add(box(1.1, 1.1, 0.02, "metal_dark", 'x', tint=(0.3, 0.3, 0.3)), T(SX, SY, Fz + 0.01), "interior")
    s.col_box("metal", Vector((SX, SY, Fz + 0.36)), (0.55, 0.75, 0.72))
    s.add(PR.crate(0.6, 0.45, 0.5, "wood_planks", lid=False), T(SX - 0.9, SY + 0.35, Fz) @ RZ(5), "interior")
    s.add(PR.woodpile(0.5, 0.35, 0.4, seed_=5), T(SX - 0.9, SY + 0.35, Fz + 0.12) @ RZ(90), "interior")
    s.heat_source("Heat_Stove", Vector((SX, SY, Fz + 0.5)), 5.0, 20.0, False)
    # bunk along the back wall
    s.add(PR.bunk(0.85, 2.0, 0.45, "wood_log", (0.4, 0.35, 0.28)), T(-2.0, 2.55, Fz) @ RZ(90), "interior")
    s.col_box("wood", Vector((-2.0, 2.55, Fz + 0.3)), (2.0, 0.85, 0.6))
    # bow pegs above the bunk
    for x in (-2.5, -1.5):
        s.add(rod((x, Y1 - 0.12, Fz + 1.55), (x, Y1 - 0.25, Fz + 1.6), 0.015, "wood_log", 5), None, "interior")
    # table + chairs under the left window
    s.add(PR.table(1.1, 0.75, 0.74, "wood_planks", (0.9, 0.85, 0.8)), T(-2.45, 0.6, Fz) @ RZ(90), "interior")
    s.col_box("wood", Vector((-2.45, 0.6, Fz + 0.37)), (0.75, 1.1, 0.74))
    s.add(PR.chair(), T(-1.8, 0.2, Fz) @ RZ(80), "interior")
    s.add(PR.chair(), T(-2.3, -0.2, Fz) @ RZ(-10), "interior")
    s.add(PR.lantern(), T(-2.5, 0.8, Fz + 0.74), "interior")
    s.add(cyl(0.05, 0.1, "metal_dark", 10, tint=(0.25, 0.3, 0.45)), T(-2.3, 0.35, Fz + 0.74), "interior")
    s.add(box(0.2, 0.28, 0.01, "decal", flags=P.F_NOAO), T(-2.4, 0.5, Fz + 0.745) @ RZ(12), "interior")
    # radio desk under the east window
    s.add(PR.table(1.2, 0.6, 0.76, "wood_planks", (0.85, 0.8, 0.75)), T(2.65, 0.9, Fz) @ RZ(90), "interior")
    s.col_box("wood", Vector((2.65, 0.9, Fz + 0.38)), (0.6, 1.2, 0.76))
    s.add(PR.radio_desk_set(), T(2.7, 1.05, Fz + 0.76) @ RZ(90), "interior")
    s.add(PR.chair(), T(2.05, 0.8, Fz) @ RZ(-100), "interior")
    s.add(box(0.28, 0.2, 0.03, "leather", tint=(0.2, 0.25, 0.15)), T(2.62, 0.35, Fz + 0.775) @ RZ(8), "interior")
    # shelves by the door with cans, jars
    sh = PR.shelf(1.0, 1.7, 0.32, 4, "wood_planks")
    for lv in range(3):
        for j in range(5):
            tint = ((0.6, 0.15, 0.1), (0.75, 0.7, 0.4), (0.3, 0.4, 0.55), (0.7, 0.7, 0.7))[(lv + j) % 4]
            sh.extend(cyl(0.045, 0.11, "paint_metal", 8, tint=tint).transformed(T(-0.36 + j * 0.18, 0, 0.1 + lv * 0.53)))
    s.add(sh, T(2.85, -1.2, Fz) @ RZ(90), "interior")
    s.col_box("wood", Vector((2.85, -1.2, Fz + 0.85)), (0.32, 1.0, 1.7))
    # coats, washstand, map, calendar
    for k, tint in enumerate(((0.3, 0.33, 0.2), (0.55, 0.1, 0.05))):
        s.add(box(0.45, 0.14, 0.8, "canvas", 'z', seg=0.25, tint=tint).transformed(T(0, 0, -0.4)), T(-2.9, -1.5 + k * 0.5, Fz + 1.8) @ RZ(90), "interior")
    s.add(PR.table(0.5, 0.4, 0.8, "wood_planks"), T(-0.7, Y0 + 0.4, Fz), "interior")
    s.add(lathe([(0.0, 0.0), (0.12, 0.01), (0.16, 0.08), (0.15, 0.09), (0.0, 0.03)], "paint_metal", 12, tint=(0.8, 0.8, 0.75)),
          T(-0.7, Y0 + 0.4, Fz + 0.8), "interior")
    s.add(PR.decal("topo_map", 0.9, 0.6).transformed(RZ(90)), T(X0 + 0.16, 1.0, Fz + 1.55), "interior")
    s.add(PR.decal("calendar", 0.25, 0.37).transformed(RZ(-90)), T(X1 - 0.16, -0.3, Fz + 1.5), "interior")
    # hanging lanterns on the tie beams (hooks)
    for (x, y) in ((-1.0, 0.0), (1.2, 2.0)):
        s.add(rod((x, y, PLATE - 0.25), (x, y, PLATE - 0.55), 0.004, "metal_dark", 4), None, "interior")
        s.add(PR.lantern(), T(x, y, PLATE - 0.85), "interior")
    s.light("Lantern", Vector((-1.0, 0.0, PLATE - 0.72)), (1.0, 0.7, 0.4), 1.2, 7.0, shadow=True)
    s.probe("Probe_Cabin", Vector((0, (Y0 + Y1) / 2, 1.6)), (L_fb - 0.2, L_side - 0.2, 2.8), ambient=(0.05, 0.045, 0.04))
    s.shelter("Shelter_Cabin", Vector((0, (Y0 + Y1) / 2, FLOOR)), (L_fb - 0.3, L_side - 0.3, 2.6), 1.0)
    s.shelter("Shelter_Porch", Vector((0, (PY0 + PY1) / 2, FLOOR)), (L_fb, PY1 - PY0, 2.2), 0.35)

    # ------------------------------------------------------------------ yard
    # woodpile under the west eave, chopping block, rain barrel
    s.add(PR.woodpile(3.0, 1.3, 0.45, seed_=11), T(X0 - 0.75, 0.6, 0.05) @ RZ(90), "main")
    s.col_box("wood", Vector((X0 - 0.75, 0.6, 0.7)), (0.5, 3.0, 1.4))
    blk = PR.splinter_top(0.0, "wood_log", 0.0) if False else cyl(0.3, 0.55, "wood_log", 10, cap_mat="wood_endgrain")
    s.add(blk, T(X0 - 1.6, -2.8, G.h(X0 - 1.6, -2.8)), "detail")
    s.col_box("wood", Vector((X0 - 1.6, -2.8, 0.27)), (0.55, 0.55, 0.55))
    s.add(PR.barrel((0.25, 0.3, 0.2), rust=True), T(X1 + 0.5, Y0 - 0.1, 0), "detail")
    s.col_box("metal", Vector((X1 + 0.5, Y0 - 0.1, 0.44)), (0.6, 0.6, 0.88))
    # outhouse behind, NE
    OX, OY = 5.8, 9.0
    oz = G.h(OX, OY)
    Mo = T(OX, OY, oz) @ RZ(200)
    ow = P.Mesh()
    for sx, sy, w_, d_ in ((-0.6, 0, 0.05, 1.2), (0.6, 0, 0.05, 1.2), (0, 0.6, 1.2, 0.05)):
        ow.extend(box(w_, d_, 2.0, "wood_planks", 'z', seg=0.6).transformed(T(sx, sy, 1.0 + (0.1 if sy else 0))))
    for x in (-0.35, 0.35):
        ow.extend(box(0.5 if x < 0 else 0.5, 0.05, 2.0, "wood_planks", 'z').transformed(T(x, -0.6, 1.0)))
    ow.extend(box(1.5, 1.5, 0.05, "metal_corrugated", 'y', tint=(0.45, 0.58, 0.44)).transformed(T(0, 0, 2.18) @ RX(-8)))
    ow.extend(box(1.2, 1.2, 0.05, "wood_planks").transformed(T(0, 0, 0.1)))
    ow.extend(box(1.1, 0.5, 0.45, "wood_planks").transformed(T(0, 0.3, 0.33)))
    s.add(ow, Mo, "main")
    s.col_box("wood", Mo @ Vector((0, 0, 1.1)), (1.25, 1.25, 2.2), Mo)
    # HF antenna: pole behind the cabin, wire to the gable
    AX, AY = 1.5, 14.0
    az = G.h(AX, AY)
    s.add(cyl(0.09, 9.0, "wood_log", 8, r2=0.06), T(AX, AY, az - 0.5), "main")
    s.add(AR.guy((X1 + 0.2, (Y0 + Y1) / 2, PLATE + rise - 0.2), (AX, AY, az + 8.3), 0.02, 0.003, 10, "metal_dark"), None, "detail")
    s.add(AR.guy((X1 - 0.2, (Y0 + Y1) / 2, PLATE + rise - 0.2), (X1 + 0.6, Y1 - 0.4, PLATE + 0.6), 0.0, 0.004, 3, "rubber"), None, "detail")
    # trail sign
    TX, TY = -3.0, -9.5
    tz = G.h(TX, TY)
    for dx in (-0.55, 0.55):
        s.add(rod((TX + dx, TY, tz - 0.2), (TX + dx, TY, tz + 1.6), 0.06, "wood_log", 8), None, "main")
    s.add(box(1.3, 0.06, 0.5, "wood_planks", 'x', tint=(0.45, 0.35, 0.25)), T(TX, TY, tz + 1.3), "main")
    s.add(PR.decal("sign_ranger", 1.2, 0.45), T(TX, TY - 0.035, tz + 1.3), "detail")
    s.col_box("wood", Vector((TX, TY, tz + 0.8)), (1.3, 0.15, 1.6))
    # stone fire ring towards the lake
    FX, FY = 4.5, -12.0
    fz = G.h(FX, FY)
    for k in range(11):
        a = 2 * math.pi * k / 11
        s.add(P.blob((0, 0, 0), (0.2, 0.16, 0.14), "rock", 7, 0.3, k * 2.3, rings=4), T(FX + 0.7 * math.cos(a), FY + 0.7 * math.sin(a), fz), "detail")
    s.add(P.heightpatch(1.2, 1.2, 0.3, lambda x, y: 0.02, "dirt", tint=(0.25, 0.22, 0.2)), T(FX, FY, fz), "ground")
    for k in range(3):
        s.add(cyl(0.18, 0.4, "wood_log", 8, cap_mat="wood_endgrain"), T(FX + 1.7 * math.cos(k * 2.1 + 0.4), FY + 1.7 * math.sin(k * 2.1 + 0.4), fz), "detail")
    # canoe upturned on two log rests at the shore
    CX, CY = -1.0, -32.5
    cz = G.h(CX, CY)
    Gs = G.slope_frame(CX, CY, 1.5)
    Mc = T(CX, CY, cz) @ Gs @ RZ(95)
    for x in (-1.4, 1.4):
        s.add(rod((x, -0.6, 0.12), (x, 0.6, 0.12), 0.12, "wood_log", 8, cap_mat="wood_endgrain"), Mc, "main")
    s.add(canoe(), Mc @ T(0, 0, 0.24 + 0.36) @ RX(180), "main")
    s.col_box("wood", Mc @ Vector((0, 0, 0.4)), (4.9, 0.9, 0.5), Mc)
    s.add(box(0.12, 1.5, 0.03, "wood_log", 'y'), Mc @ T(0.3, 0.75, 0.02) @ RZ(70), "detail")

    # ------------------------------------------------------------------ sockets
    s.marker("Arrive_Default", (-1.2, -9.0, G.h(-1.2, -9.0)), 0)
    s.marker("Use_Door_Cabin", (-1.75, Y0 - 0.15, FLOOR + 1.0), 180)
    s.marker("Use_Stove", (SX - 0.2, SY - 0.45, FLOOR + 0.6), 180)
    s.marker("Use_Radio", (2.6, 1.05, FLOOR + 1.0), -90)
    s.marker("Use_Bed", (-2.0, 2.55, FLOOR + 0.6), 0)
    s.marker("Use_Lantern", (-1.0, 0.0, PLATE - 0.72), 0)
    s.marker("Log_ranger_logbook", (2.62, 0.35, FLOOR + 0.8), -90)
    s.marker("Log_ranger_note", (-2.4, 0.5, FLOOR + 0.76), 0)
    s.marker("Loot_RadioHandheld", (2.65, 1.5, FLOOR + 0.78), -90)
    s.marker("Loot_Bow", (-2.0, Y1 - 0.2, FLOOR + 1.58), 180)
    s.marker("Loot_Shelf_1", (2.8, -1.2, FLOOR + 1.15), -90)
    s.marker("Loot_Shelf_2", (2.8, -1.2, FLOOR + 0.6), -90)
    s.marker("Loot_Table", (-2.2, 0.8, FLOOR + 0.76), 0)
    s.marker("Loot_Woodpile", (X0 - 1.1, 0.6, 0.3), 90)
    s.marker("Loot_Outhouse", (OX, OY, oz + 0.6), 0)
    s.marker("Spot_Canoe", (CX, CY - 1.2, cz), 0)
    s.marker("Spot_Campfire", (FX, FY, fz), 0)
    return [s]

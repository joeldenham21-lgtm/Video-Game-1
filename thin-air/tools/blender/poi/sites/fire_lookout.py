"""Fire lookout on the knoll (~1,716 m): a 12 m battered timber tower (four legs, girts, X-bracing, concrete
footings) with switch-back stair flights around the inside of the frame, a catwalk with railing around a 4.3 m
L-4 style glazed cab under a hip roof, lightning rod and ground cable. Inside: the Osborne fire finder on its
pedestal in the centre, a cot, propane stove, shelf, lightning stool with glass insulator feet, log table."""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube

TIM = (0.8, 0.74, 0.66)
H = 12.0
B0, B1 = 3.2, 2.2         # leg half-spread at base / top
CAB = 4.3
PAINT = (0.86, 0.86, 0.82)
GREEN = (0.22, 0.34, 0.24)


def leg_xy(sx, sy, z):
    h = P.lerp(B0, B1, z / H)
    return Vector((sx * h, sy * h, z))


def build():
    s = P.Site("fire_lookout", seed_=79)
    s.bucket("main", vis_end=2200.0)
    s.bucket("detail", vis_end=120.0)
    s.bucket("interior", vis_end=30.0)
    G = P.Ground("fire_lookout")
    tw = P.Mesh()
    for sx in (-1, 1):
        for sy in (-1, 1):
            tw.extend(P.beam(leg_xy(sx, sy, -0.1), leg_xy(sx, sy, H), 0.26, 0.26, "wood_log", tint=TIM, end_mat="wood_endgrain"))
            tw.extend(box(0.7, 0.7, 0.5, "concrete", seg=0.35).transformed(T(leg_xy(sx, sy, 0.0) + Vector((0, 0, 0.05)))))
            s.col_box("wood", (leg_xy(sx, sy, 0) + leg_xy(sx, sy, H)) / 2, (0.3, 0.3, H), P.look_basis(leg_xy(sx, sy, H) - leg_xy(sx, sy, 0)) @ RZ(0))
    for k in range(5):
        z = k * 3.0 + 0.4 if k < 4 else H - 0.2
        for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            tw.extend(P.beam(leg_xy(a[0], a[1], z), leg_xy(b[0], b[1], z), 0.16, 0.2, "wood_log", tint=TIM, end_mat="wood_endgrain"))
            if k < 4:
                z2 = min(H - 0.2, z + 3.0)
                tw.extend(rod(leg_xy(a[0], a[1], z + 0.1), leg_xy(b[0], b[1], z2 - 0.1), 0.018, "metal_rusty", 5))
                tw.extend(rod(leg_xy(b[0], b[1], z + 0.1), leg_xy(a[0], a[1], z2 - 0.1), 0.018, "metal_rusty", 5))
    s.add(tw, None, "main")
    # stairs: four flights climbing clockwise inside the frame, landings in the corners
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    st_all = P.Mesh()
    for k in range(4):
        z0 = k * 3.0
        z1 = z0 + 3.0
        c0 = corners[k]
        c1 = corners[(k + 1) % 4]
        inset = 0.75
        a = leg_xy(c0[0], c0[1], z0) * 1.0
        b = leg_xy(c1[0], c1[1], z1)
        a = Vector((a.x - c0[0] * inset, a.y - c0[1] * inset, z0))
        b = Vector((b.x - c1[0] * inset, b.y - c1[1] * inset, z1))
        d = b - a
        run = Vector((d.x, d.y, 0)).length
        st, col = AR.stair(0.75, 3.0, run - 0.9, "wood_log", 0.05, tint=TIM)
        yaw = math.degrees(math.atan2(-d.x, d.y))
        Ms = T(a.x, a.y, z0) @ RZ(yaw) @ T(0, 0.45, 0)
        st_all.extend(st.transformed(Ms))
        c, size, R = col
        s.col_box("wood", Ms @ c, size, Ms @ R)
        # landing at the top corner
        lp = Vector((b.x, b.y, z1))
        st_all.extend(box(1.1, 1.1, 0.06, "wood_planks", 'x', tint=TIM).transformed(T(lp.x, lp.y, z1 - 0.03)))
        s.col_box("wood", Vector((lp.x, lp.y, z1 - 0.05)), (1.1, 1.1, 0.1))
        st_all.extend(AR.railing([a + Vector((0, 0, 0)), b], 0.95, "wood_log", 0.03, 2.0, TIM).transformed(
            T(0, 0, 0)).transformed(T(0, 0, 0)) if False else AR.railing([Vector((a.x, a.y, z0)), Vector((b.x, b.y, z1))], 0.95, "wood_log", 0.025, 2.5, TIM))
    s.add(st_all, None, "main")
    # cab deck + catwalk
    deck_w = CAB + 1.8
    s.add(box(deck_w, deck_w, 0.12, "wood_planks", 'x', seg=1.2, tint=TIM), T(0, 0, H + 0.06), "main")
    for sx in (-1, 1):
        s.add(box(deck_w + 0.2, 0.2, 0.25, "wood_log", 'x', tint=TIM), T(0, sx * deck_w / 2, H - 0.12), "main")
        s.add(box(0.2, deck_w + 0.2, 0.25, "wood_log", 'y', tint=TIM), T(sx * deck_w / 2, 0, H - 0.12), "main")
    s.col_box("wood", Vector((0, 0, H + 0.05)), (deck_w, deck_w, 0.14))
    hw = deck_w / 2 - 0.05
    rail = AR.railing([(-hw, -hw, H + 0.12), (hw, -hw, H + 0.12), (hw, hw, H + 0.12), (-hw, hw, H + 0.12), (-hw, -hw + 1.0, H + 0.12)],
                      1.05, "wood_log", 0.03, 1.5, TIM)
    s.add(rail, None, "main")
    for (x, y, w_, d_) in ((0, -hw, deck_w, 0.1), (hw, 0, 0.1, deck_w), (0, hw, deck_w, 0.1), (-hw, 0.5, 0.1, deck_w - 1.0)):
        s.col_box("wood", Vector((x, y, H + 0.6)), (w_, d_, 1.1))
    # trap hatch at the top of the last flight (north-west corner) - open
    s.add(box(1.0, 1.0, 0.05, "wood_planks", tint=TIM), T(-B1 + 0.75, B1 - 0.3, H + 0.6) @ RX(-80), "detail")
    # cab: lower wall panels, continuous glazing with mullions, hip roof
    c = CAB / 2
    cab = P.Mesh()
    door_side = 0
    for k, (start, theta) in enumerate((((-c, -c), 0), ((c, -c), 90), ((c, c), 180), ((-c, c), -90))):
        ops = [(1.7, 2.6, 0.0, 2.05)] if k == 0 else []
        me, cols = AR.wall(CAB, 1.0, 0.1, [(1.7, 2.6, 0.0, 1.0)] if k == 0 else [], "wood_paint", "wood_fresh", PAINT, (0.9, 0.85, 0.75), 1.0)
        Mw = T(start[0], start[1], H + 0.12) @ RZ(theta)
        cab.extend(me.transformed(Mw))
        for cc, size in cols:
            s.col_box("wood", Mw @ cc, size, Mw)
        # glazing band 1.0 - 2.25 m, mullions every ~0.72 m
        n = 6
        for j in range(n + 1):
            u = CAB * j / n
            cab.extend(box(0.06, 0.1, 1.25, "wood_paint", 'z', tint=PAINT).transformed(Mw @ T(u, 0, 1.0 + 0.625)))
        for j in range(n):
            u0 = CAB * j / n + 0.03
            u1 = CAB * (j + 1) / n - 0.03
            if k == 0 and 1.6 < (u0 + u1) / 2 < 2.7:
                continue
            g = P.quad((u0, 0, 1.02), (u1, 0, 1.02), (u1, 0, 2.23), (u0, 0, 2.23), "glass", flags=P.F_NOAO | P.F_NOEXP)
            cab.extend(g.transformed(Mw))
        cab.extend(box(CAB, 0.14, 0.08, "wood_paint", 'x', tint=PAINT).transformed(Mw @ T(CAB / 2, 0, 1.0)))
        cab.extend(box(CAB, 0.14, 0.1, "wood_paint", 'x', tint=PAINT).transformed(Mw @ T(CAB / 2, 0, 2.3)))
        s.col_box("wood", Mw @ Vector((CAB / 2, 0, 1.7)), (CAB, 0.1, 1.3), Mw) if k != 0 else (
            s.col_box("wood", Mw @ Vector((0.85, 0, 1.7)), (1.7, 0.1, 1.3), Mw), s.col_box("wood", Mw @ Vector((3.45, 0, 1.7)), (1.7, 0.1, 1.3), Mw))
    # door (glazed upper half), hip roof
    cab.extend(AR.door_leaf(0.85, 2.05, 0.05, "wood_paint", PAINT, window_=True).transformed(T(-c + 2.15, -c, H + 0.12)))
    s.add(cab, None, "main")
    rh = 1.3
    roof = P.Mesh()
    ov = 0.55
    R0 = c + ov
    apex = Vector((0, 0, H + 0.12 + 2.35 + rh))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        b = math.radians(45 + 90 * (k + 1))
        p0 = Vector((math.cos(a) * R0 * math.sqrt(2), math.sin(a) * R0 * math.sqrt(2), H + 0.12 + 2.35 - 0.15))
        p1 = Vector((math.cos(b) * R0 * math.sqrt(2), math.sin(b) * R0 * math.sqrt(2), H + 0.12 + 2.35 - 0.15))
        tri = P.Mesh()
        ids = [tri.vert(p0), tri.vert(p1), tri.vert(apex)]
        tri.face(ids, [(0, 0), ((p1 - p0).length, 0), ((p1 - p0).length / 2, 2.0)], "wood_paint", False, GREEN)
        tri.face(ids[::-1], [(0, 0), ((p1 - p0).length, 0), ((p1 - p0).length / 2, 2.0)], "wood_planks", False, (0.8, 0.75, 0.65))
        roof.extend(tri)
    roof.extend(rod(apex, apex + Vector((0, 0, 1.2)), 0.012, "metal_bare", 5))
    roof.extend(tube([apex + Vector((0, 0, 0.05)), Vector((R0, R0, H + 2.3)), leg_xy(1, 1, H - 1.0), leg_xy(1, 1, 0.3)], 0.006, "metal_bare", 4))
    s.add(roof, None, "main")
    s.col_box("wood", Vector((0, 0, H + 2.6 + rh / 2)), (CAB + 1.0, CAB + 1.0, rh))
    s.add(box(CAB - 0.1, CAB - 0.1, 0.03, "wood_fresh", 'x', tint=(0.9, 0.85, 0.75), flags=P.F_NOEXP), T(0, 0, H + 2.44), "interior")
    # interior: fire finder, cot, stove, stool, shelf
    I = T(0, 0, H + 0.12)
    ff = cyl(0.09, 1.0, "wood_log", 10, tint=TIM)
    ff.extend(cyl(0.42, 0.06, "wood_fresh", 24, tint=(0.85, 0.8, 0.7)).transformed(T(0, 0, 1.0)))
    ff.extend(PR.decal("topo_map", 0.6, 0.6).transformed(T(0, 0, 1.062) @ RX(-90)))
    ring = cyl(0.41, 0.02, "metal_bare", 32, caps=False, tint=(0.75, 0.6, 0.35))
    ff.extend(ring.transformed(T(0, 0, 1.06)))
    for a, hh in ((0, 0.14), (180, 0.1)):
        x, y = 0.4 * math.cos(math.radians(a + 30)), 0.4 * math.sin(math.radians(a + 30))
        ff.extend(box(0.02, 0.05, hh, "metal_bare", tint=(0.75, 0.6, 0.35)).transformed(T(x, y, 1.08 + hh / 2) @ RZ(a + 30)))
    for k in range(3):
        a = math.radians(k * 120)
        ff.extend(rod((0, 0, 0.02), (0.35 * math.cos(a), 0.35 * math.sin(a), 0.0), 0.03, "wood_log", 5))
    s.add(ff, I, "interior")
    s.col_box("wood", I @ Vector((0, 0, 0.55)), (0.85, 0.85, 1.1))
    s.add(PR.bunk(0.8, 1.9, 0.45, "metal_bare", (0.4, 0.4, 0.35)), I @ T(c - 0.55, 0.6, 0), "interior")
    s.col_box("wood", I @ Vector((c - 0.55, 0.6, 0.3)), (0.8, 1.9, 0.6))
    s.add(PR.table(0.8, 0.5, 0.75, "wood_fresh"), I @ T(-c + 0.35, 0.8, 0) @ RZ(90), "interior")
    s.add(PR.stove_canister(), I @ T(-c + 0.35, 1.0, 0.75), "interior")
    s.add(box(0.25, 0.3, 0.02, "decal", flags=P.F_NOAO), I @ T(-c + 0.35, 0.5, 0.755), "interior")
    stool = box(0.35, 0.35, 0.03, "wood_fresh").transformed(T(0, 0, 0.55))
    for sx in (-0.13, 0.13):
        for sy in (-0.13, 0.13):
            stool.extend(rod((sx, sy, 0.12), (sx, sy, 0.54), 0.018, "wood_log", 5))
            stool.extend(lathe([(0.0, 0.0), (0.05, 0.0), (0.04, 0.1), (0.0, 0.12)], "glass", 8, flags=P.F_NOAO).transformed(T(sx, sy, 0)))
    s.add(stool, I @ T(-0.9, -0.9, 0), "interior")
    s.add(PR.shelf(0.9, 0.9, 0.25, 3, "wood_fresh"), I @ T(-0.7, c - 0.2, 0.0) @ RZ(180), "interior")
    s.add(PR.lantern(), I @ T(-0.5, c - 0.2, 0.9), "interior")
    s.light("Lantern", I @ Vector((-0.5, c - 0.25, 1.15)), (1.0, 0.72, 0.42), 1.0, 6.0)
    s.probe("Probe_Cab", I @ Vector((0, 0, 1.2)), (CAB, CAB, 2.4), ambient=(0.12, 0.12, 0.13))
    s.shelter("Shelter_Cab", I @ Vector((0, 0, 0)), (CAB - 0.2, CAB - 0.2, 2.3), 1.0)
    s.marker("Arrive_Default", (2.0, -7.0, G.h(2.0, -7.0)), 0)
    s.marker("Arrive_Cab", (0.8, -1.0, H + 0.14), 0)
    s.marker("Use_FireFinder", (0.0, -0.55, H + 1.2), 0)
    s.marker("Use_Door_Cab", (-c + 2.15, -c - 0.15, H + 1.1), 0)
    s.marker("Use_Bed", (c - 0.55, 0.6, H + 0.7), 0)
    s.marker("Loot_Table", (-c + 0.35, 0.6, H + 0.9), 90)
    s.marker("Loot_Shelf", (-0.7, c - 0.3, H + 0.6), 180)
    s.marker("Scan_FireFinder", (0.0, 0.0, H + 1.3), 0)
    return [s]

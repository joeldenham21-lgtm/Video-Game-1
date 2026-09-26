"""Kestrel Station: glaciology field station on the col below Mount Corrigan (~2,950 m).

Three insulated prefab modules (A lab - west, B main: boot room / galley / comms - centre, C bunks - east) on steel
stilts so drifting snow blows through underneath, joined by enclosed walkways; exterior stairs to the doors; a
generator shed (diesel genset, day tank, battery bank, workbench) with two double-walled fuel tanks; a timber
helipad with markings and a windsock; weather mast (AWS), VSAT dish, solar array, antennas, cable run on posts,
route-marker wands towards the glacier, snow drifts in the lee. Interiors fully furnished; lights and windows come
on with power (PoiSite.set_interior_lights), a battery lantern burns in Mara's bunk room.
"""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube

F = 1.85          # module floor top
WH = 2.5          # wall height (floor to ceiling plate)
MW, ML = 4.2, 11.0
WT = 0.16
RED = (0.46, 0.075, 0.05)
TRIM = (0.85, 0.85, 0.82)
INWALL = (0.82, 0.8, 0.74)
MODS = {"A": -10.5, "B": 0.0, "C": 10.5}
WALK_Y = (0.6, 2.4)
DOOR_Y = (1.05, 1.95)


def add_wall(s, M, start, theta, L, H, openings, mat_out="paint_metal", mat_in="paint_metal", tint_out=RED,
             tint_in=INWALL, t=WT, bucket="main", surface="metal", seg=1.2, windows=True):
    me, cols = AR.wall(L, H, t, [(a, b, c, d) for a, b, c, d, *_ in openings], mat_out, mat_in, tint_out, tint_in, seg)
    W = M @ T(start[0], start[1], start[2] if len(start) > 2 else 0.0) @ RZ(theta)
    s.add(me, W, bucket)
    for c, size in cols:
        s.col_box(surface, W @ c, size, W)
    if windows:
        for o in openings:
            a, b, z0, z1 = o[:4]
            kind = o[4] if len(o) > 4 else "window"
            if kind == "window":
                s.add(AR.window(b - a, z1 - z0, t, "paint_metal", TRIM, "glass_lit"), W @ T((a + b) / 2, 0, z0), bucket)
    return W


def module(s, key, cx, openings, roof=True):
    """One prefab module centred at (cx, 0); openings per wall: dict side -> [(u0, u1, z0, z1, kind)]."""
    M = T(cx, 0, 0)
    hx, hy = MW / 2, ML / 2
    add_wall(s, M, (-hx, hy, F), -90, ML, WH, openings.get("W", []))
    add_wall(s, M, (hx, -hy, F), 90, ML, WH, openings.get("E", []))
    add_wall(s, M, (-hx, -hy, F), 0, MW, WH, openings.get("S", []))
    add_wall(s, M, (hx, hy, F), 180, MW, WH, openings.get("N", []))
    # floor, ceiling, chassis
    s.add(box(MW - WT, ML - WT, 0.06, "vinyl_floor", 'y', seg=1.5, flags=P.F_NOEXP), M @ T(0, 0, F - 0.03), "main")
    s.add(box(MW + 0.1, ML + 0.1, 0.22, "paint_metal", 'y', tint=(0.25, 0.25, 0.25), seg=2.0), M @ T(0, 0, F - 0.17), "main")
    s.col_box("metal", M @ Vector((0, 0, F - 0.14)), (MW + 0.1, ML + 0.1, 0.28))
    ceil = box(MW - WT, ML - WT, 0.04, "paint_metal", 'y', tint=(0.9, 0.9, 0.88), seg=1.5, flags=P.F_NOEXP)
    s.add(ceil, M @ T(0, 0, F + WH - 0.02), "main")
    for sx in (-1, 1):
        s.add(box(0.14, ML + 0.3, 0.26, "metal_dark", 'y', tint=(0.6, 0.6, 0.6)), M @ T(sx * 1.55, 0, F - 0.41), "main")
    # stilts (square hollow sections) with footing pads and X-bracing between pairs
    ys = [-4.6, -1.55, 1.55, 4.6]
    for sx in (-1, 1):
        for y in ys:
            s.add(box(0.18, 0.18, F - 0.54, "galvanized", 'z'), M @ T(sx * 1.55, y, (F - 0.54) / 2), "main")
            s.add(box(0.5, 0.5, 0.05, "galvanized", 'x'), M @ T(sx * 1.55, y, 0.025), "main")
            s.col_box("metal", M @ Vector((sx * 1.55, y, (F - 0.54) / 2)), (0.2, 0.2, F - 0.54))
        for a, b in zip(ys, ys[1:]):
            s.add(rod((sx * 1.55, a, 0.2), (sx * 1.55, b, F - 0.6), 0.018, "galvanized", 5), M, "main")
            s.add(rod((sx * 1.55, b, 0.2), (sx * 1.55, a, F - 0.6), 0.018, "galvanized", 5), M, "main")
    # roof: shallow gable along Y, metal standing seam, with snow load edges
    if roof:
        rise = 0.35
        half = MW / 2 + 0.25
        L = ML + 0.4
        for sx in (-1, 1):
            ang = math.degrees(math.atan2(rise, half))
            slab = box(math.hypot(half, rise), L, 0.1, "metal_corrugated", 'x', seg=1.5, tint=(0.8, 0.8, 0.8))
            s.add(slab, M @ T(sx * half / 2, 0, F + WH + 0.08 + rise / 2) @ RY(sx * -ang), "main")
            s.col_box("metal", M @ Vector((sx * half / 2, 0, F + WH + 0.1 + rise / 2)), (half, L, 0.12), RY(sx * -ang))
        # gable end infill
        for sy in (-1, 1):
            tri = P.slab([(-half, 0), (half, 0), (0, rise)], 0.05, "paint_metal", tint=RED)
            s.add(tri, M @ T(0, sy * (ML / 2) - (0.05 if sy > 0 else 0), F + WH + 0.03), "main")
    # vertical panel-joint trims on the long walls, corner trims
    for sx in (-1, 1):
        for k in range(10):
            y = -ML / 2 + (k + 0.5) * ML / 10
            s.add(box(0.03, 0.05, WH, "paint_metal", 'z', tint=(0.35, 0.06, 0.04)), M @ T(sx * (hx + 0.09), y, F + WH / 2), "detail")
    for sx in (-1, 1):
        for sy in (-1, 1):
            s.add(box(0.12, 0.12, WH + 0.1, "paint_metal", 'z', tint=TRIM), M @ T(sx * (hx + 0.02), sy * (hy + 0.02), F + WH / 2), "main")
    return M


def ext_stair(s, top, direction, rise, width=1.0, landing=(1.4, 1.4)):
    """Landing at a door (top = door sill point on the wall, direction = outward yaw deg) + stair to the ground."""
    x, y, z = top
    Mo = T(x, y, 0) @ RZ(direction)
    lw, ld = landing
    s.add(box(lw, ld, 0.06, "galvanized", 'x', tint=(0.8, 0.8, 0.8)), Mo @ T(0, -ld / 2, z - 0.03), "main")
    s.col_box("metal", Mo @ Vector((0, -ld / 2, z - 0.05)), (lw, ld, 0.1), Mo)
    for sx in (-1, 1):
        s.add(rod((sx * (lw / 2 - 0.05), -ld + 0.05, 0), (sx * (lw / 2 - 0.05), -ld + 0.05, z - 0.06), 0.05, "galvanized", 8), Mo, "main")
    run = rise * 1.25
    st, col = AR.stair(width, rise, run, "galvanized")
    Ms = Mo @ T(lw / 2 - width / 2 - 0.02, -ld, 0) @ RZ(180) @ T(0, 0, 0)
    # stair descends away from the landing: flip so it climbs towards the landing
    Ms = Mo @ T(lw / 2 - width / 2 - 0.02, -ld - run, 0)
    s.add(st, Ms, "main")
    c, size, R = col
    s.col_box("metal", Ms @ c, size, Ms @ R)
    rail = AR.railing([(lw / 2, -ld, z), (lw / 2, 0, z)], 1.0)
    rail.extend(AR.railing([(-lw / 2, 0, z), (-lw / 2, -ld, z), (lw / 2 - width - 0.02, -ld, z)], 1.0))
    rail.extend(AR.railing([(lw / 2 + 0.03, -ld - run, 0.0), (lw / 2 + 0.03, -ld, z)], 1.0, posts_every=2.0))
    s.add(rail, Mo, "detail")
    return Mo


def walkway(s, x0, x1):
    """Enclosed corridor between two modules (x0 < x1) at WALK_Y, floor at F."""
    L = x1 - x0
    ya, yb = WALK_Y
    w = yb - ya
    H = 2.25
    M = T(x0, 0, 0)
    add_wall(s, M, (0, ya, F), 0, L, H, [(L / 2 - 0.4, L / 2 + 0.4, 1.0, 1.6, "window")], tint_out=(0.8, 0.8, 0.78))
    add_wall(s, M, (L, yb, F), 180, L, H, [(L / 2 - 0.4, L / 2 + 0.4, 1.0, 1.6, "window")], tint_out=(0.8, 0.8, 0.78))
    s.add(box(L, w, 0.06, "vinyl_floor", 'x', flags=P.F_NOEXP), M @ T(L / 2, (ya + yb) / 2, F - 0.03), "main")
    s.col_box("metal", M @ Vector((L / 2, (ya + yb) / 2, F - 0.08)), (L, w + 0.2, 0.16))
    s.add(box(L, w + 0.3, 0.12, "metal_corrugated", 'x', tint=(0.8, 0.8, 0.8)), M @ T(L / 2, (ya + yb) / 2, F + H + 0.06), "main")
    s.col_box("metal", M @ Vector((L / 2, (ya + yb) / 2, F + H + 0.06)), (L, w + 0.3, 0.12))
    s.add(box(L, w, 0.03, "paint_metal", 'x', tint=(0.9, 0.9, 0.88), flags=P.F_NOEXP), M @ T(L / 2, (ya + yb) / 2, F + H - 0.02), "main")
    s.add(box(L, w, 0.3, "paint_metal", 'x', tint=(0.25, 0.25, 0.25)), M @ T(L / 2, (ya + yb) / 2, F - 0.2), "main")
    for x in (1.2, L - 1.2):
        for y in (ya + 0.2, yb - 0.2):
            s.add(box(0.14, 0.14, F - 0.35, "galvanized"), M @ T(x, y, (F - 0.35) / 2), "main")
    s.add(box(0.5, 0.2, 0.05, "lamp", flags=P.F_NOAO), M @ T(L / 2, (ya + yb) / 2, F + H - 0.05), "interior")


def parka(tint):
    me = box(0.5, 0.18, 0.75, "nylon", 'z', seg=0.2, tint=tint)
    me.displace(lambda p: Vector((0.03 * P.nz(p, 5.0), 0.02 * P.nz(p, 4.0, 2.0), 0)))
    me.extend(box(0.14, 0.14, 0.6, "nylon", 'z', tint=tint).transformed(T(-0.3, 0, 0.0) @ RY(8)))
    me.extend(box(0.14, 0.14, 0.6, "nylon", 'z', tint=tint).transformed(T(0.3, 0, 0.0) @ RY(-8)))
    me.extend(lathe([(0.0, 0.3), (0.13, 0.33), (0.15, 0.45), (0.1, 0.52), (0.0, 0.53)], "wool", 8, tint=(0.35, 0.32, 0.28)))
    return me.transformed(T(0, 0, -0.35))


def computer(screen_decal=True):
    me = box(0.52, 0.04, 0.34, "plastic", 'x', tint=(0.08, 0.08, 0.08)).transformed(T(0, 0.0, 0.3))
    me.extend(box(0.06, 0.06, 0.12, "plastic", tint=(0.08, 0.08, 0.08)).transformed(T(0, 0.04, 0.08)))
    me.extend(box(0.22, 0.16, 0.02, "plastic", tint=(0.08, 0.08, 0.08)).transformed(T(0, 0.05, 0.01)))
    if screen_decal:
        me.extend(PR.decal("screen_terminal", 0.46, 0.29, "decal_lit").transformed(T(0, -0.022, 0.3)))
    me.extend(box(0.44, 0.15, 0.025, "plastic", 'x', tint=(0.12, 0.12, 0.12)).transformed(T(0, -0.25, 0.012)))
    return me


def lab_bench(L=1.8):
    me = box(L, 0.7, 0.04, "plastic", 'x', tint=(0.55, 0.57, 0.55)).transformed(T(0, 0, 0.9))
    me.extend(box(L - 0.04, 0.62, 0.84, "paint_metal", 'x', tint=(0.75, 0.75, 0.72), seg=0.6).transformed(T(0, 0.03, 0.44)))
    for k in range(int(L / 0.6)):
        x = -L / 2 + 0.3 + k * 0.6
        me.extend(box(0.12, 0.02, 0.02, "metal_bare").transformed(T(x, -0.3, 0.75)))
    return me


def instrument(w, d, h, tint=(0.8, 0.8, 0.78)):
    me = box(w, d, h, "plastic", tint=tint).transformed(T(0, 0, h / 2))
    me.extend(box(w * 0.5, 0.01, h * 0.35, "screen", flags=P.F_NOAO).transformed(T(-w * 0.15, -d / 2 - 0.005, h * 0.6)))
    for k in range(3):
        me.extend(cyl(0.015, 0.02, "plastic", 8, tint=(0.1, 0.1, 0.1)).transformed(T(w * 0.25, -d / 2, h * (0.3 + k * 0.2)) @ RX(90)))
    return me


def generator_set():
    """Diesel genset on a skid (~2.4 x 0.9 m): engine, radiator, alternator, control panel. Base z = 0, faces -Y."""
    me = box(2.4, 0.95, 0.14, "paint_metal", 'x', tint=(0.12, 0.12, 0.12)).transformed(T(0, 0, 0.07))
    Y = (0.72, 0.52, 0.06)
    me.extend(box(1.0, 0.7, 0.75, "paint_metal", 'x', tint=Y, seg=0.4).transformed(T(-0.2, 0, 0.52)))
    me.extend(box(0.9, 0.55, 0.3, "paint_metal", 'x', tint=Y).transformed(T(-0.2, 0, 1.05)))
    me.extend(box(0.12, 0.8, 0.95, "paint_metal", 'z', tint=(0.1, 0.1, 0.1)).transformed(T(-0.95, 0, 0.62)))
    me.extend(box(0.02, 0.7, 0.8, "metal_dark").transformed(T(-1.02, 0, 0.62)))
    me.extend(cyl(0.3, 0.75, "paint_metal", 16, tint=(0.15, 0.2, 0.35)).transformed(T(0.35, 0, 0.5) @ RY(90)))
    me.extend(box(0.45, 0.6, 0.55, "paint_metal", tint=(0.15, 0.2, 0.35)).transformed(T(0.95, 0, 0.45)))
    me.extend(box(0.5, 0.18, 0.42, "paint_metal", tint=(0.2, 0.2, 0.2)).transformed(T(0.9, -0.4, 1.0)))
    me.extend(PR.decal("gen_panel", 0.44, 0.28).transformed(T(0.9, -0.492, 1.02)))
    me.extend(tube([(-0.35, 0.2, 1.2), (-0.35, 0.3, 1.5), (-0.35, 0.3, 2.35)], 0.05, "metal_rusty", 8))
    for k in range(6):
        me.extend(cyl(0.035, 0.06, "metal_dark", 6).transformed(T(-0.55 + k * 0.14, 0.05, 1.2)))
    return me


def fuel_tank(L=3.0, r=0.6, tint=(0.8, 0.8, 0.78)):
    me = cyl(r, L, "paint_metal", 20, tint=tint, vseg=3).transformed(T(-L / 2, 0, 0) @ RY(90))
    for sx in (-1, 1):
        me.extend(lathe([(0.0, 0.0), (r, 0.0), (r * 0.9, 0.12), (0.0, 0.16)], "paint_metal", 20, tint=tint).transformed(
            T(sx * L / 2, 0, 0) @ RY(sx * 90)))
        me.extend(box(0.15, 2 * r + 0.1, 0.5, "metal_dark").transformed(T(sx * L * 0.3, 0, -r + 0.05)))
    me.extend(cyl(0.12, 0.2, "paint_metal", 10, tint=tint).transformed(T(0.4, 0, r - 0.05)))
    me.extend(tube([(0.9, 0, r - 0.05), (0.9, 0, r + 0.35), (0.9, 0.15, r + 0.4)], 0.02, "metal_bare", 6))
    me = me.transformed(T(0, 0, r + 0.45))
    for sx in (-1, 1):
        me.extend(box(0.12, 1.2, 0.45, "wood_log", 'y').transformed(T(sx * L * 0.3, 0, 0.225)))
    return me


def build():
    s = P.Site("kestrel_station", seed_=31)
    s.bucket("main", vis_end=1600.0)
    s.bucket("detail", vis_end=120.0)
    s.bucket("interior", vis_end=45.0)
    s.bucket("ground", vis_end=400.0, shadow=False)
    s.meta["lights_on"] = False

    # ---------------------------------------------------------------- modules
    win = lambda u0: (u0, u0 + 0.7, 1.0, 1.6, "window")
    door = lambda u0, w=0.9: (u0, u0 + w, 0.0, 2.05, "door")
    mid = (DOOR_Y[0] + 5.5, DOOR_Y[1] + 5.5)       # E wall u = y + 5.5 ; W wall u = 5.5 - y
    midw = (5.5 - DOOR_Y[1], 5.5 - DOOR_Y[0])
    # A lab (west): windows both sides, walkway door on E, emergency door on N
    module(s, "A", MODS["A"], {
        "W": [win(1.2), win(3.8), win(6.4), win(9.0)],
        "E": [win(1.4), win(3.8), (mid[0], mid[1], 0.0, 2.05, "door"), win(8.4)],
        "N": [door(1.65)], "S": [win(1.75)]})
    # B main: walkway doors both sides, main door S, window N over the radio desk
    module(s, "B", MODS["B"], {
        "W": [win(1.0), (midw[0], midw[1], 0.0, 2.05, "door"), win(5.9), win(8.9)],
        "E": [win(1.4), win(4.0), (mid[0], mid[1], 0.0, 2.05, "door"), win(8.9)],
        "S": [door(1.65)], "N": [win(1.75)]})
    # C bunks (east)
    module(s, "C", MODS["C"], {
        "W": [win(1.3), (midw[0], midw[1], 0.0, 2.05, "door"), win(7.6)],
        "E": [win(2.0), win(5.0), win(8.2)],
        "N": [door(1.65)], "S": [win(1.75)]})
    walkway(s, MODS["A"] + MW / 2, MODS["B"] - MW / 2)
    walkway(s, MODS["B"] + MW / 2, MODS["C"] - MW / 2)
    # exterior doors (insulated, closed) + stairs
    for key, sy, yaw in (("B", -1, 0), ("A", 1, 180), ("C", 1, 180)):
        cx = MODS[key]
        dx = cx - 2.1 + 1.65 + 0.45 if sy < 0 else cx + 2.1 - 1.65 - 0.45
        y = sy * (ML / 2)
        leaf = AR.door_leaf(0.9, 2.05, 0.07, "paint_metal", (0.85, 0.85, 0.82), window_=True)
        s.add(leaf, T(dx, y + sy * 0.0, F) @ RZ(yaw), "main")
        ext_stair(s, (dx, y + sy * 0.05, F), yaw, F, landing=(1.5, 1.4))
    s.add(PR.decal("sign_kestrel", 2.4, 0.6).transformed(T(0, -ML / 2 - WT / 2 - 0.012, F + WH + 0.1) @ RZ(0)), None, "main")
    for key, dname in (("A", "plate_lab"), ("B", "plate_main"), ("C", "plate_bunk")):
        cx = MODS[key]
        yy = -ML / 2 - WT / 2 - 0.012
        s.add(PR.decal(dname, 0.5, 0.14), T(cx - 1.0 if key == "B" else cx, yy, F + 2.1), "detail")

    # ---------------------------------------------------------------- B interior: boot room / galley / comms
    B = T(MODS["B"], 0, F)
    # partitions (plywood), with doorways
    for yw, gap in ((-3.6, (0.2, 1.1)), (2.8, (-0.6, 0.3))):
        me, cols = AR.wall(MW - WT, 2.45, 0.08, [(gap[0] + 2.02, gap[1] + 2.02, 0.0, 2.0)], "wood_fresh", "wood_fresh",
                           (0.95, 0.92, 0.85), (0.95, 0.92, 0.85), 1.2)
        W = B @ T(-2.02, yw, 0)
        s.add(me, W, "interior")
        for c, size in cols:
            s.col_box("wood", W @ c, size, W)
    # boot room: bench, hooks with parkas, boots, shelf
    s.add(PR.bench(1.4, 0.35), B @ T(1.7, -4.6, 0) @ RZ(90), "interior")
    s.col_box("wood", B @ Vector((1.7, -4.6, 0.22)), (0.35, 1.4, 0.45))
    for k, tint in enumerate(((0.55, 0.1, 0.05), (0.1, 0.18, 0.42), (0.6, 0.35, 0.05))):
        s.add(parka(tint), B @ T(1.95, -5.1 + k * 0.45, 1.6) @ RZ(90), "interior")
        s.add(rod((2.02, -5.1 + k * 0.45, 1.75), (1.9, -5.1 + k * 0.45, 1.8), 0.012, "metal_bare"), B, "interior")
        s.add(box(0.12, 0.3, 0.14, "leather", tint=(0.25, 0.2, 0.15)), B @ T(1.5 + 0.02 * k, -5.2 + k * 0.4, 0.07) @ RZ(8 * k), "interior")
    s.add(PR.shelf(1.2, 1.9, 0.35, 4, tint=(0.9, 0.85, 0.75)), B @ T(-1.8, -4.6, 0) @ RZ(-90), "interior")
    s.add(PR.hard_case(0.5, 0.35, 0.2, (0.7, 0.25, 0.04)), B @ T(-1.75, -4.8, 0.52) @ RZ(-90), "interior")
    # galley: counter + sink + stove + cabinets along the west wall; fridge
    ctr = box(0.65, 3.0, 0.9, "wood_fresh", 'y', seg=0.6, tint=(0.8, 0.75, 0.68))
    ctr.extend(box(0.68, 3.02, 0.04, "plastic", 'y', tint=(0.3, 0.32, 0.3)).transformed(T(0, 0, 0.47)))
    ctr.extend(box(0.45, 0.5, 0.02, "metal_bare").transformed(T(0.02, 0.7, 0.49)))
    ctr.extend(box(0.5, 0.6, 0.04, "metal_dark", tint=(0.2, 0.2, 0.2)).transformed(T(0.02, -0.7, 0.51)))
    for k in range(4):
        ctr.extend(cyl(0.07, 0.015, "metal_dark", 10, tint=(0.1, 0.1, 0.1)).transformed(T(-0.12 + (k % 2) * 0.24, -0.84 + (k // 2) * 0.28, 0.53)))
    s.add(ctr, B @ T(-1.72, -1.8, 0.45), "interior")
    s.col_box("wood", B @ Vector((-1.72, -1.8, 0.47)), (0.68, 3.0, 0.94))
    s.add(box(0.38, 3.0, 0.7, "wood_fresh", 'y', tint=(0.8, 0.75, 0.68)), B @ T(-1.85, -1.8, 1.9), "interior")
    s.add(box(0.7, 0.7, 1.8, "paint_gloss", 'z', tint=(0.85, 0.85, 0.83)), B @ T(-1.7, 0.05, 0.9), "interior")
    s.col_box("metal", B @ Vector((-1.7, 0.05, 0.9)), (0.7, 0.7, 1.8))
    # dining table + chairs, mugs
    s.add(PR.table(1.6, 0.85, 0.75, "wood_fresh", (0.9, 0.85, 0.75)), B @ T(0.7, -1.4, 0) @ RZ(90), "interior")
    s.col_box("wood", B @ Vector((0.7, -1.4, 0.38)), (0.85, 1.6, 0.76))
    for k, (x, y, a) in enumerate(((0.05, -2.0, -90), (0.05, -0.9, -80), (1.35, -1.9, 95), (1.4, -0.8, 60))):
        s.add(PR.chair((0.75, 0.75, 0.75), "paint_metal"), B @ T(x, y, 0) @ RZ(a), "interior")
    for k in range(3):
        s.add(cyl(0.045, 0.1, "plastic", 10, tint=((0.7, 0.1, 0.1), (0.9, 0.9, 0.85), (0.1, 0.2, 0.5))[k]),
              B @ T(0.5 + k * 0.2, -1.8 + k * 0.4, 0.76), "interior")
    # whiteboard on the east wall
    s.add(box(0.03, 1.5, 0.9, "paint_gloss", tint=(0.9, 0.9, 0.9)), B @ T(2.0, -0.6, 1.5), "interior")
    s.add(PR.decal("whiteboard", 1.42, 0.8).transformed(RZ(90)), B @ T(1.982, -0.6, 1.5), "interior")
    # O2 concentrator + bottle rack (comms corner)
    o2 = box(0.4, 0.35, 0.65, "plastic", tint=(0.85, 0.85, 0.82)).transformed(T(0, 0, 0.325))
    o2.extend(box(0.2, 0.01, 0.1, "screen", flags=P.F_NOAO).transformed(T(0, -0.18, 0.55)))
    o2.extend(PR.decal("label_o2", 0.12, 0.15).transformed(T(0.1, -0.178, 0.35)))
    o2.extend(tube([(0.12, -0.1, 0.62), (0.3, -0.3, 0.55), (0.5, -0.35, 0.3), (0.7, -0.2, 0.05)], 0.008, "plastic", 5,
                   tint=(0.7, 0.8, 0.9)))
    s.add(o2, B @ T(1.65, 3.4, 0) @ RZ(90), "interior")
    rack = box(0.9, 0.3, 0.05, "paint_metal", 'x', tint=(0.2, 0.3, 0.2)).transformed(T(0, 0, 0.9))
    rack.extend(box(0.9, 0.3, 0.05, "paint_metal", 'x', tint=(0.2, 0.3, 0.2)).transformed(T(0, 0, 0.3)))
    for k in range(5):
        rack.extend(PR.gas_bottle(0.8, 0.075, (0.1, 0.35, 0.12) if k != 3 else (0.85, 0.85, 0.85)).transformed(T(-0.36 + k * 0.18, 0.0, 0.02)))
    s.add(rack, B @ T(1.72, 4.4, 0) @ RZ(90), "interior")
    s.col_box("metal", B @ Vector((1.7, 3.9, 0.5)), (0.45, 1.5, 1.0))
    # comms: radio desk along the north wall, rack, map table
    desk = PR.table(1.9, 0.7, 0.76, "wood_fresh", (0.85, 0.8, 0.7))
    s.add(desk, B @ T(-0.8, 5.0, 0), "interior")
    s.col_box("wood", B @ Vector((-0.8, 5.0, 0.38)), (1.9, 0.7, 0.76))
    s.add(PR.radio_desk_set(), B @ T(-1.2, 5.05, 0.76) @ RZ(0), "interior")
    s.add(computer(), B @ T(-0.3, 5.15, 0.76), "interior")
    s.add(PR.chair((0.2, 0.2, 0.2), "paint_metal"), B @ T(-0.9, 4.3, 0) @ RZ(170), "interior")
    crack = box(0.6, 0.8, 1.9, "paint_metal", 'z', tint=(0.1, 0.1, 0.1)).transformed(T(0, 0, 0.95))
    for k in range(7):
        crack.extend(box(0.52, 0.02, 0.12, "paint_metal", 'x', tint=(0.25, 0.25, 0.27)).transformed(T(0, -0.41, 0.35 + k * 0.2)))
        crack.extend(box(0.03, 0.01, 0.02, "led_red" if k % 3 == 0 else "screen", flags=P.F_NOAO).transformed(T(0.18, -0.42, 0.35 + k * 0.2)))
    crack.extend(box(0.45, 0.35, 0.18, "plastic", tint=(0.85, 0.85, 0.82)).transformed(T(0, 0.0, 1.99)))
    crack.extend(box(0.3, 0.2, 0.01, "decal", flags=P.F_NOAO).transformed(T(0, -0.1, 2.085)))
    s.add(crack, B @ T(1.6, 4.75, 0) @ RZ(90), "interior")
    s.col_box("metal", B @ Vector((1.6, 4.75, 0.95)), (0.8, 0.6, 1.9))
    mt = PR.table(1.2, 0.9, 0.9, "wood_fresh", (0.85, 0.8, 0.7))
    mt.extend(PR.decal("topo_map", 1.1, 0.72).transformed(T(0, 0, 0.905) @ RX(-90)))
    s.add(mt, B @ T(0.2, 3.5, 0) @ RZ(90), "interior")
    s.col_box("wood", B @ Vector((0.2, 3.5, 0.45)), (0.9, 1.2, 0.9))
    for L_, pos in (("L_Galley", (0.3, -1.2)), ("L_Comms", (0.0, 4.1))):
        s.add(box(0.9, 0.25, 0.05, "lamp", flags=P.F_NOAO), B @ T(pos[0], pos[1], 2.42), "interior")
    s.light("Galley", B @ Vector((0.3, -1.2, 2.2)), (1.0, 0.86, 0.7), 1.6, 7.0)
    s.light("Comms", B @ Vector((0.0, 4.1, 2.2)), (1.0, 0.9, 0.78), 1.3, 5.5)

    # ---------------------------------------------------------------- A interior: lab
    A = T(MODS["A"], 0, F)
    for k, y in enumerate((-3.6, -1.6, 2.4)):
        s.add(lab_bench(1.9), A @ T(1.72, y, 0) @ RZ(90), "interior")
        s.col_box("metal", A @ Vector((1.72, y, 0.46)), (0.7, 1.9, 0.92))
    for k, y in enumerate((-3.6, 0.4)):
        s.add(lab_bench(1.9), A @ T(-1.72, y, 0) @ RZ(-90), "interior")
        s.col_box("metal", A @ Vector((-1.72, y, 0.46)), (0.7, 1.9, 0.92))
    s.add(instrument(0.5, 0.4, 0.35), A @ T(1.7, -4.0, 0.92) @ RZ(90), "interior")
    s.add(instrument(0.35, 0.3, 0.25, (0.3, 0.32, 0.35)), A @ T(1.7, -3.2, 0.92) @ RZ(90), "interior")
    s.add(instrument(0.6, 0.45, 0.45, (0.85, 0.85, 0.8)), A @ T(-1.7, -3.9, 0.92) @ RZ(-90), "interior")
    s.add(computer(), A @ T(1.75, 2.4, 0.92) @ RZ(90), "interior")
    s.add(PR.chair((0.2, 0.2, 0.2), "paint_metal"), A @ T(1.1, 2.3, 0) @ RZ(-80), "interior")
    # ice-core freezer + core tubes, sample shelves at the north end
    fz = box(1.4, 0.7, 0.85, "paint_gloss", 'x', tint=(0.88, 0.88, 0.86)).transformed(T(0, 0, 0.425))
    fz.extend(box(0.3, 0.02, 0.06, "plastic", tint=(0.2, 0.2, 0.2)).transformed(T(0, -0.36, 0.78)))
    s.add(fz, A @ T(-1.65, 2.6, 0) @ RZ(-90), "interior")
    s.col_box("metal", A @ Vector((-1.65, 2.6, 0.43)), (0.7, 1.4, 0.86))
    for k in range(5):
        s.add(cyl(0.05, 1.0, "plastic", 10, tint=(0.8, 0.85, 0.9)), A @ T(-1.9 + k * 0.001, 1.6 + k * 0.12, 0.93) @ RX(90) @ RZ(0) @ T(0, 0, -0.5), "interior")
    for x in (-1.2, 0.0, 1.2):
        sh = PR.shelf(1.1, 2.0, 0.4, 5, "paint_metal", (0.7, 0.7, 0.72))
        for lv in range(4):
            for j in range(3):
                sh.extend(box(0.28, 0.3, 0.22, "plastic", tint=((0.8, 0.8, 0.75), (0.2, 0.35, 0.6), (0.85, 0.55, 0.1))[(lv + j) % 3]).transformed(
                    T(-0.35 + j * 0.35, 0, 0.1 + lv * 0.47 + 0.12)))
        s.add(sh, A @ T(x, 5.1, 0) @ RZ(180), "interior")
    s.col_box("metal", A @ Vector((0, 5.1, 1.0)), (3.4, 0.4, 2.0))
    s.add(PR.decal("topo_map", 1.2, 0.8).transformed(RZ(-90)), A @ T(-1.985, -1.3, 1.55), "interior")
    s.add(box(0.8, 0.25, 0.05, "lamp", flags=P.F_NOAO), A @ T(0, 0, 2.42), "interior")
    s.light("Lab", A @ Vector((0.0, 0.0, 2.2)), (0.95, 0.95, 1.0), 1.8, 8.0)

    # ---------------------------------------------------------------- C interior: bunks
    C = T(MODS["C"], 0, F)
    for k, y in enumerate((-3.5, 2.6)):
        s.add(PR.bunk(0.9, 2.0, 0.42, "wood_fresh", (0.25, 0.3, 0.45), True, double=True), C @ T(1.55, y, 0), "interior")
        s.col_box("wood", C @ Vector((1.55, y, 0.35)), (0.9, 2.0, 0.7))
        s.col_box("wood", C @ Vector((1.55, y, 1.45)), (0.9, 2.0, 0.12))
    # Mara's lower bunk: sleeping bag, splinted-leg pillow pile, kit
    bag = box(0.7, 1.9, 0.18, "nylon", 'y', seg=0.25, tint=(0.7, 0.3, 0.05))
    bag.displace(lambda p: Vector((0, 0, 0.05 * P.nz(p, 3.0, 7.0) if p.z > 0 else 0)))
    s.add(bag, C @ T(1.55, -3.5, 0.62), "interior")
    s.add(PR.first_aid(), C @ T(0.6, -4.6, 0.0) @ RZ(20), "interior")
    for k in range(4):
        s.add(box(0.5, 0.5, 1.9, "paint_metal", 'z', tint=((0.35, 0.4, 0.45), (0.3, 0.35, 0.4))[k % 2]), C @ T(-1.8, -4.4 + k * 0.52, 0.95), "interior")
    s.col_box("metal", C @ Vector((-1.8, -3.6, 0.95)), (0.5, 2.1, 1.9))
    s.add(PR.table(0.9, 0.6, 0.74, "wood_fresh"), C @ T(-1.5, 1.0, 0) @ RZ(90), "interior")
    s.add(PR.chair(), C @ T(-0.9, 1.1, 0) @ RZ(80), "interior")
    s.add(PR.lantern(), C @ T(-1.45, 0.9, 0.74), "interior")
    s.add(tube([(-2.0, -1.0, 2.0), (0.0, -0.2, 1.95), (2.0, 0.6, 2.0)], 0.004, "rope", 4), C, "interior")
    for k in range(3):
        s.add(box(0.35, 0.02, 0.45, "wool_2s" if False else "canvas", tint=(0.5, 0.45, 0.4)), C @ T(-1.2 + k * 0.8, -0.8 + k * 0.3, 1.72), "interior")
    s.add(box(0.8, 0.25, 0.05, "lamp", flags=P.F_NOAO), C @ T(0, 0, 2.42), "interior")
    s.light("Bunks", C @ Vector((0.0, 0.0, 2.2)), (1.0, 0.85, 0.68), 1.3, 7.0)
    s.light("Lantern", C @ Vector((-1.45, 0.9, 0.95)), (1.0, 0.72, 0.42), 0.9, 4.5, group="Lights_Lantern")
    for key, c in (("A", A), ("B", B), ("C", C)):
        s.probe("Probe_" + key, c @ Vector((0, 0, 1.25)), (MW, ML, 2.5), ambient=(0.04, 0.045, 0.05), energy=1.0)
        s.shelter("Shelter_" + key, c @ Vector((0, 0, 0)), (MW - 0.3, ML - 0.3, 2.5), 1.0)

    # ---------------------------------------------------------------- generator shed + fuel
    GX, GY = 9.0, -16.0
    Gm = T(GX, GY, 0)
    SW, SL, SH = 3.8, 5.2, 2.6
    base = 0.25
    shed_col = (0.3, 0.36, 0.26)
    add_wall(s, Gm, (-SW / 2, SL / 2, base), -90, SL, SH, [(1.6, 2.3, 1.0, 1.5, "window")], "metal_painted_green",
             "wood_fresh", (1, 1, 1), (0.9, 0.85, 0.75))
    add_wall(s, Gm, (SW / 2, -SL / 2, base), 90, SL, SH, [(0.8, 1.6, 0.9, 1.4, "vent"), (3.2, 4.0, 1.0, 1.5, "window")],
             "metal_painted_green", "wood_fresh", (1, 1, 1), (0.9, 0.85, 0.75))
    add_wall(s, Gm, (-SW / 2, -SL / 2, base), 0, SW, SH, [], "metal_painted_green", "wood_fresh", (1, 1, 1), (0.9, 0.85, 0.75))
    add_wall(s, Gm, (SW / 2, SL / 2, base), 180, SW, SH, [(1.1, 2.1, 0.0, 2.05, "door")], "metal_painted_green", "wood_fresh",
             (1, 1, 1), (0.9, 0.85, 0.75))
    s.add(box(SW + 0.2, SL + 0.2, base, "wood_planks", 'y', seg=1.0), Gm @ T(0, 0, base / 2), "main")
    s.col_box("wood", Gm @ Vector((0, 0, base / 2)), (SW + 0.2, SL + 0.2, base))
    roof, rise = AR.gable_roof(SL, SW, 18, 0.35, 0.1, "metal_corrugated")
    s.add(roof, Gm @ T(0, 0, base + SH) @ RZ(90), "main")
    s.col_box("metal", Gm @ Vector((0, 0, base + SH + rise / 2)), (SW + 0.7, SL + 0.7, rise + 0.1))
    for sy in (-1, 1):
        tri = P.slab([(-SW / 2, 0), (SW / 2, 0), (0, rise)], 0.05, "metal_painted_green")
        s.add(tri, Gm @ T(0, sy * SL / 2 - (0.05 if sy > 0 else 0), base + SH), "main")
    # door ajar, signs
    s.add(AR.door_leaf(1.0, 2.05, 0.06, "metal_painted_green"), Gm @ T(-0.1, SL / 2 + 0.03, base) @ RZ(180 - 55) @ T(-0.5, 0, 0), "main")
    s.add(PR.decal("sign_hv", 0.4, 0.2), Gm @ T(0.9, SL / 2 + 0.09, base + 1.6) @ RZ(180), "detail")
    Gi = Gm @ T(0, 0, base)
    s.add(generator_set(), Gi @ T(-0.55, -0.6, 0) @ RZ(90), "interior")
    s.col_box("metal", Gi @ Vector((-0.55, -0.6, 0.6)), (1.0, 2.4, 1.2))
    s.add(box(0.5, 1.0, 0.7, "paint_metal", tint=(0.75, 0.75, 0.72)), Gi @ T(-1.5, 1.7, 0.35), "interior")
    wb = PR.table(1.6, 0.6, 0.9, "wood_fresh")
    wb.extend(box(0.12, 0.2, 0.12, "metal_dark", tint=(0.2, 0.3, 0.5)).transformed(T(0.6, 0, 0.96)))
    wb.extend(PR.toolbox((0.6, 0.05, 0.03)).transformed(T(-0.4, 0.05, 0.9)))
    wb.extend(box(0.22, 0.3, 0.01, "decal", flags=P.F_NOAO).transformed(T(0.1, -0.05, 0.905)))
    s.add(wb, Gi @ T(1.55, 0.9, 0) @ RZ(90), "interior")
    s.col_box("wood", Gi @ Vector((1.55, 0.9, 0.45)), (0.6, 1.6, 0.9))
    bat = PR.shelf(1.4, 1.2, 0.45, 3, "paint_metal", (0.3, 0.3, 0.3))
    for lv in range(2):
        for j in range(4):
            bat.extend(box(0.3, 0.2, 0.25, "plastic", tint=(0.08, 0.08, 0.08)).transformed(T(-0.48 + j * 0.32, 0, 0.1 + lv * 0.55 + 0.13)))
    s.add(bat, Gi @ T(1.6, -1.6, 0) @ RZ(90), "interior")
    for k in range(3):
        s.add(PR.jerrycan((0.5, 0.05, 0.03) if k else (0.1, 0.3, 0.1)), Gi @ T(-1.55, -2.2 + k * 0.4, 0) @ RZ(90), "interior")
    s.add(box(0.6, 0.25, 0.05, "lamp", flags=P.F_NOAO), Gi @ T(0, 0, SH - 0.08), "interior")
    s.light("Generator", Gi @ Vector((0.0, 0.0, SH - 0.3)), (1.0, 0.92, 0.8), 1.5, 6.0)
    s.probe("Probe_Shed", Gi @ Vector((0, 0, 1.3)), (SW, SL, SH), ambient=(0.04, 0.045, 0.05))
    s.shelter("Shelter_Shed", Gi @ Vector((0, 0, 0)), (SW - 0.2, SL - 0.2, SH), 0.9)
    # fuel tanks on saddles, drums on a pallet, fuel line to the shed
    for k in range(2):
        tk = fuel_tank()
        s.add(tk, T(GX - 5.2, GY - 1.4 + k * 1.6, 0) @ RZ(90), "main")
        s.col_box("metal", Vector((GX - 5.2, GY - 1.4 + k * 1.6, 1.05)), (1.25, 3.0, 1.25))
        s.add(PR.decal("sign_diesel", 0.5, 0.25).transformed(RZ(-90)), T(GX - 5.2 + 0.62, GY - 1.4 + k * 1.6, 1.05), "detail")
    s.add(tube([(GX - 4.6, GY - 0.6, 0.6), (GX - 3.0, GY - 0.6, 0.3), (GX - SW / 2 - 0.05, GY - 0.6, 0.5)], 0.025, "metal_bare", 6), None, "detail")
    pal = box(1.2, 1.2, 0.14, "wood_fresh", 'x')
    for k in range(4):
        pal.extend(PR.barrel((0.1, 0.25, 0.1) if k < 3 else (0.45, 0.06, 0.04)).transformed(T(-0.3 + (k % 2) * 0.6, -0.3 + (k // 2) * 0.6, 0.07)))
    s.add(pal, T(GX + 3.4, GY + 1.0, 0.07) @ RZ(12), "main")
    s.col_box("metal", Vector((GX + 3.4, GY + 1.0, 0.5)), (1.25, 1.25, 1.0), RZ(12))
    # cable run on posts from the shed to module B
    posts = [Vector((GX - 0.5, GY + SL / 2 + 0.5, 0)), Vector((6.0, -9.5, 0)), Vector((3.0, -6.2, 0))]
    for p in posts:
        s.add(box(0.1, 0.1, 1.6, "wood_log"), T(p.x, p.y, 0.8), "detail")
    s.add(tube([p + Vector((0, 0, 1.55)) for p in posts] + [Vector((1.8, -5.6, F - 0.3))], 0.02, "rubber", 5), None, "detail")

    # ---------------------------------------------------------------- helipad + windsock
    HX, HY = -23.0, -17.0
    Hm = T(HX, HY, 0)
    # the crew keeps the pad swept: no snow on the deck or its markings (F_NOEXP)
    s.add(box(14.0, 14.0, 0.14, "wood_planks", 'y', seg=1.5, flags=P.F_NOEXP), Hm @ T(0, 0, 0.3), "main")
    for k in range(5):
        s.add(box(14.0, 0.25, 0.25, "wood_log", 'x'), Hm @ T(0, -6.5 + k * 3.25, 0.12), "main")
    s.col_box("wood", Hm @ Vector((0, 0, 0.19)), (14.0, 14.0, 0.38))
    paint = lambda sx, sy, sz, tint: box(sx, sy, 0.006, "wood_paint", 'x', tint=tint, flags=P.F_NOEXP)
    Y_ = (0.85, 0.62, 0.08)
    for sy in (-1, 1):
        s.add(paint(13.4, 0.3, 0, Y_), Hm @ T(0, sy * 6.7, 0.372), "main")
        s.add(paint(0.3, 13.4, 0, Y_), Hm @ T(sy * 6.7, 0, 0.372), "main")
    WH_ = (0.95, 0.95, 0.92)
    s.add(paint(0.6, 4.0, 0, WH_), Hm @ T(-1.2, 0, 0.373), "main")
    s.add(paint(0.6, 4.0, 0, WH_), Hm @ T(1.2, 0, 0.373), "main")
    s.add(paint(1.8, 0.6, 0, WH_), Hm @ T(0, 0, 0.374), "main")
    ring = P.Mesh()
    for k in range(32):
        a0 = 2 * math.pi * k / 32
        a1 = 2 * math.pi * (k + 1) / 32
        for r0, r1 in ((4.6, 5.0),):
            q = [(r0 * math.cos(a0), r0 * math.sin(a0), 0), (r1 * math.cos(a0), r1 * math.sin(a0), 0),
                 (r1 * math.cos(a1), r1 * math.sin(a1), 0), (r0 * math.cos(a1), r0 * math.sin(a1), 0)]
            ids = [ring.vert(p) for p in q]
            ring.face(ids, [(p[0], p[1]) for p in q], "wood_paint", False, Y_, P.F_NOEXP)
    s.add(ring, Hm @ T(0, 0, 0.374), "main")
    # windsock
    wx, wy = HX + 8.5, HY + 6.0
    s.add(rod((wx, wy, 0), (wx, wy, 4.5), 0.04, "galvanized", 8), None, "main")
    sock_rings = []
    for k in range(6):
        t_ = k / 5
        r = P.lerp(0.22, 0.09, t_)
        c = Vector((wx + 0.1 + 1.8 * t_, wy + 0.3 * t_, 4.35 - 0.5 * t_ * t_))
        sock_rings.append([c + Vector((0, math.cos(2 * math.pi * j / 10) * r, math.sin(2 * math.pi * j / 10) * r)) for j in range(10)])

    def sock_tint(k, i):
        return (0.85, 0.3, 0.04) if k % 2 == 0 else (0.9, 0.9, 0.88)
    s.add(P.loft(sock_rings, "nylon_paint_2s", tints=sock_tint), None, "main")
    s.col_box("wood", Vector((wx, wy, 2.25)), (0.1, 0.1, 4.5))

    # ---------------------------------------------------------------- weather mast (AWS), dish, solar, antennas
    MX, MY = 17.0, 9.0
    s.add(cyl(0.05, 10.0, "galvanized", 10), T(MX, MY, 0), "main")
    s.add(box(0.8, 0.8, 0.3, "concrete", seg=0.4), T(MX, MY, 0.1), "main")
    s.col_box("metal", Vector((MX, MY, 5.0)), (0.12, 0.12, 10.0))
    arm = rod((MX - 0.8, MY, 9.6), (MX + 0.8, MY, 9.6), 0.02, "galvanized", 6)
    arm.extend(rod((MX + 0.8, MY, 9.6), (MX + 0.8, MY, 9.9), 0.01, "metal_bare", 6))
    for k in range(3):
        a = math.radians(k * 120)
        p = Vector((MX + 0.8 + 0.12 * math.cos(a), MY + 0.12 * math.sin(a), 9.92))
        arm.extend(rod((MX + 0.8, MY, 9.92), p, 0.004, "metal_bare", 4))
        arm.extend(lathe([(0.0, 0.0), (0.04, 0.01), (0.045, 0.04), (0.0, 0.04)], "plastic", 8, tint=(0.1, 0.1, 0.1)).transformed(
            T(p) @ RY(90) @ RX(90)))
    arm.extend(rod((MX - 0.8, MY, 9.6), (MX - 0.8, MY, 9.8), 0.01, "metal_bare", 6))
    arm.extend(box(0.5, 0.02, 0.12, "plastic", tint=(0.1, 0.1, 0.1)).transformed(T(MX - 0.95, MY, 9.82)))
    for k in range(7):
        arm.extend(cyl(0.12 - k * 0.004, 0.03, "plastic", 12, tint=(0.9, 0.9, 0.88)).transformed(T(MX + 0.2, MY + 0.25, 7.4 + k * 0.05)))
    arm.extend(box(0.45, 0.25, 0.55, "plastic", tint=(0.88, 0.88, 0.85)).transformed(T(MX, MY - 0.2, 1.6)))
    arm.extend(box(0.8, 0.04, 0.55, "solar_cell").transformed(T(MX, MY - 0.2, 3.2) @ RX(-60)))
    s.add(arm, None, "main")
    for k in range(3):
        a = math.radians(90 + k * 120)
        s.add(AR.guy((MX, MY, 8.0), (MX + 6.0 * math.cos(a), MY + 6.0 * math.sin(a), 0.1)), None, "detail")
        s.add(box(0.2, 0.2, 0.3, "concrete"), T(MX + 6.0 * math.cos(a), MY + 6.0 * math.sin(a), 0.05), "detail")
    # VSAT dish on a pedestal (1.8 m), pointing low to the south
    DX, DY = 5.0, 9.5
    dish = lathe([(0.0, 0.0), (0.3, 0.02), (0.6, 0.08), (0.9, 0.18), (0.88, 0.2), (0.6, 0.1), (0.3, 0.04), (0.0, 0.02)],
                 "paint_gloss", 24, tint=(0.88, 0.88, 0.86))
    dish.extend(rod((0.0, 0.0, 0.0), (0.0, 0.0, 0.85), 0.02, "galvanized", 6))
    dish.extend(box(0.08, 0.1, 0.18, "plastic", tint=(0.1, 0.1, 0.1)).transformed(T(0, 0, 0.9)))
    s.add(cyl(0.08, 1.6, "galvanized", 10), T(DX, DY, 0), "main")
    s.add(dish, T(DX, DY, 1.9) @ RZ(180) @ RX(-65), "main")
    s.col_box("metal", Vector((DX, DY, 0.8)), (0.2, 0.2, 1.6))
    # solar array: 2 x 4 panels on a rack tilted 60 deg to the south
    SX, SY = -9.0, -12.5
    for i in range(4):
        for j in range(2):
            pn = box(1.0, 1.65, 0.04, "solar_cell", 'y')
            pn.extend(box(1.04, 1.69, 0.03, "metal_bare").transformed(T(0, 0, -0.03)))
            s.add(pn, T(SX - 1.6 + i * 1.07, SY, 0.9 + j * 1.45) @ RX(-60) @ T(0, 0, 0), "main")
    for i in range(3):
        x = SX - 1.6 + i * 1.6
        s.add(rod((x, SY + 0.4, 0), (x, SY + 0.4, 2.3), 0.04, "galvanized", 6), None, "main")
        s.add(rod((x, SY - 0.6, 0), (x, SY - 0.6, 0.6), 0.04, "galvanized", 6), None, "main")
    s.col_box("metal", Vector((SX, SY, 1.4)), (4.4, 1.6, 2.8), RX(-30))
    # antennas: VHF whip on B, HF vertical on C, dipole wire B -> weather mast
    s.add(rod((0.8, 3.0, F + WH + 0.4), (0.8, 3.0, F + WH + 3.4), 0.012, "metal_bare", 6), None, "main")
    s.add(rod((MODS["C"], 4.0, F + WH + 0.4), (MODS["C"], 4.0, F + WH + 6.4), 0.02, "galvanized", 6), None, "main")
    s.add(AR.guy((-0.5, 4.0, F + WH + 1.0), (MX, MY, 9.3), 0.02, 0.004, 8, "rope"), None, "detail")

    # ---------------------------------------------------------------- route wands, crates, drifts
    for k in range(9):
        p = Vector((-6.0 - k * 4.5, 14.0 + k * 3.2, 0))
        s.add(rod(p, p + Vector((0.05, 0.02, 1.9)), 0.012, "wood_log", 5), None, "detail")
        fl = P.quad(p + Vector((0.05, 0.02, 1.9)), p + Vector((0.4, 0.1, 1.85)), p + Vector((0.4, 0.1, 1.62)),
                    p + Vector((0.05, 0.02, 1.66)), "nylon_paint_2s", tint=(0.9, 0.3, 0.04), two_sided=False)
        s.add(fl, None, "detail")
    for k, (x, y, a) in enumerate(((4.5, -7.8, 10), (5.4, -8.4, -20), (4.9, -8.1, 30))):
        s.add(PR.crate(1.0, 0.7, 0.6 if k < 2 else 0.5, "wood_fresh", stencil="stencil_kestrel"), T(x, y, 0.6 * (k == 2)) @ RZ(a), "detail")
        s.col_box("wood", Vector((x, y, 0.3 + 0.6 * (k == 2))), (1.0, 0.7, 0.6), RZ(a))
    # drifts: lee (east) side tails, windward scoops
    drifts = [((MODS["A"] + 3.8, 2.0), (2.2, 5.5, 0.9)), ((MODS["C"] + 4.5, -1.0), (2.8, 6.0, 1.1)),
              ((GX + 2.8, GY + 0.5), (1.6, 3.4, 0.9)), ((-15.0, -5.0), (3.0, 2.0, 0.5)), ((22.0, -3.0), (4.0, 2.5, 0.6)),
              ((MODS["B"] + 3.0, -7.5), (2.0, 1.5, 0.45))]
    for k, ((x, y), rr) in enumerate(drifts):
        dr = P.heightpatch(rr[0] * 2.2, rr[1] * 2.2, 0.45, lambda u, v, rr=rr, k=k: rr[2] * max(0.0, 1.0 - (u / rr[0]) ** 2 - (v / rr[1]) ** 2) ** 0.8
                           * (1 + 0.15 * P.nz((u, v, k), 0.7)) - 0.05, "snow", smooth_=True)
        s.add(dr, T(x, y, 0) @ RZ(P.rnd(-15, 15)), "ground")
    s.occluders.extend(box(80, 80, 0.1, "snow").transformed(T(0, 0, -0.1)))

    # ---------------------------------------------------------------- sockets
    Bm = MODS["B"]
    s.marker("Arrive_Default", (Bm + 0.5, -ML / 2 - 5.5, 0.0), 0)
    s.marker("Arrive_Heli", (HX, HY, 0.38), 90)
    s.marker("Use_Door_Main", (Bm - 2.1 + 1.65 + 0.45, -ML / 2 - 0.05, F + 1.0), 180)
    s.marker("Use_Door_Lab", (MODS["A"] + 2.1 - 1.65 - 0.45, ML / 2 + 0.05, F + 1.0), 0)
    s.marker("Use_Door_Bunks", (MODS["C"] + 2.1 - 1.65 - 0.45, ML / 2 + 0.05, F + 1.0), 0)
    s.marker("Use_Door_Generator", (GX + 0.4, GY + SL / 2 + 0.1, base + 1.0), 0)
    s.marker("Use_Generator", (GX - 0.95, GY - 0.6 + 0.9, base + 1.0), 90)
    s.marker("Use_Radio", (Bm - 1.2, 4.95, F + 0.9), 0)
    s.marker("Use_CommsRack", (Bm + 1.2, 4.75, F + 1.1), -90)
    s.marker("Use_O2Concentrator", (Bm + 1.45, 3.4, F + 0.6), -90)
    s.marker("Use_O2Rack", (Bm + 1.45, 4.4, F + 0.8), -90)
    s.marker("Use_Fuel_Tank", (GX - 4.5, GY - 0.6, 1.0), -90)
    s.marker("Spot_Fabricator", (MODS["A"] - 0.3, -4.6, F), 0)
    s.marker("Npc_Mara", (MODS["C"] + 1.55, -3.5, F + 0.62), 0)
    s.marker("Log_hale_01", (MODS["A"] + 1.6, 2.1, F + 0.93), -90)
    s.marker("Log_reyes_01", (GX + 1.55, GY + 1.2, base + 0.92), -90)
    s.marker("Log_park_01", (Bm + 1.25, 4.6, F + 1.2), -90)
    s.marker("Log_voss_01", (MODS["C"] - 1.4, 1.2, F + 0.76), 0)
    s.marker("Log_hale_02", (Bm + 1.7, -4.3, F + 0.46), 90)
    s.marker("Log_voss_02", (Bm + 0.2, 3.4, F + 0.92), 0)
    s.marker("Log_reyes_02", (GX - 0.6, GY + SL / 2 + 0.25, base + 1.3), 180)
    s.marker("Log_station_whiteboard", (Bm + 1.95, -0.6, F + 1.5), 90)
    s.marker("Log_station_fuel_log", (GX + 1.5, GY + 0.6, base + 0.92), -90)
    s.marker("Log_relay_diagnostics", (Bm + 1.6, 4.75, F + 2.1), -90)
    s.marker("Loot_TransceiverModule", (MODS["A"] + 0.0, 5.0, F + 1.02), 180)
    s.marker("Loot_BatteryPack", (GX + 1.6, GY - 1.6, base + 0.7), -90)
    s.marker("Loot_Galley", (Bm - 1.72, -2.6, F + 0.95), 90)
    s.marker("Loot_BootRoom", (Bm - 1.75, -4.8, F + 1.0), 90)
    s.marker("Loot_Keycard", (Bm - 0.3, 4.95, F + 0.77), 0)
    s.marker("Loot_Lab", (MODS["A"] - 1.7, -3.2, F + 0.95), -90)
    s.marker("Spot_Heli", (HX, HY, 0.37), 0)
    return [s]

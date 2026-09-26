"""Ashford Mine (1932-1941 gold mine camp, east flank ~1,950 m) + the Ashford adit interior.

Exterior (anchor = pad centre; the adit portal sits 36 m west at the toe of an 18 m rock slope and faces east):
timbered portal with lagging and a plank door in a rock collar, a waste-rock causeway carrying the 24-inch track
from the portal to a timber ore bin and chute at its end, a side-dump ore car, a timber headframe over a cribbed
shaft collar with its sheave wheel, the remains of the hoist house with a rusted steam hoist and boiler, a collapsed
log bunkhouse, and scattered iron. Interior (placed at y 800 by scenes/poi/structures.gd, entered through
Use_Door_Mine): ~150 m of drift built from the tunnel kit - timbered and bare-rock straights, bends, a junction, the
powder-house alcove, the crosscut to Owen's depot chamber (orange-painted timbers), a ladder raise, a stope
chamber with stulls, and No. 2 drift ending in a collapse. Ice and icicles near the portal, drips and pools deeper.
"""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube

TIMBER = (0.78, 0.72, 0.64)
ORANGE = (0.85, 0.32, 0.05)
ROCK_T = (1.0, 1.0, 1.0)


# ================================================================== tunnel kit

def tunnel_ring(p, t, w=1.9, h=2.45, noise=0.12, seed_=0.0, floor_noise=0.03):
    """Cross-section around point p (floor centre) facing along t: flat floor, near-vertical walls, arched back."""
    t = Vector(t).normalized()
    side = Vector((-t.y, t.x, 0)).normalized()
    up = Vector((0, 0, 1))
    pts = []
    prof = [(-0.0, 0.0), (0.45, -0.01), (0.95, 0.02), (1.0, 0.45), (1.0, 1.1), (0.97, 1.55), (0.82, 1.95), (0.5, 2.25),
            (0.0, 2.35), (-0.5, 2.25), (-0.82, 1.95), (-0.97, 1.55), (-1.0, 1.1), (-1.0, 0.45), (-0.95, 0.02),
            (-0.45, -0.01)]
    for k, (a, b) in enumerate(prof):
        q = p + side * (a * w / 2) + up * (b * h / 2.35)
        nn = noise if b > 0.1 else floor_noise
        d = P.fbm(q, 0.9, 3, seed_) * nn
        q = q + (side * a + up * (b - 1.1) * 0.5).normalized() * d if b > 0.1 else q + up * d
        pts.append(q)
    return pts


def tunnel(path, w=1.9, h=2.45, seed_=0.0, step=0.8, mat="rock_cliff", tint=ROCK_T, open_ends=True):
    """Rock tunnel along a polyline (floor centre points). Faces point inwards."""
    pts = [Vector(p) for p in path]
    dense = []
    for a, b in zip(pts, pts[1:]):
        n = max(1, int((b - a).length / step))
        for k in range(n):
            dense.append(a.lerp(b, k / n))
    dense.append(pts[-1])
    rings = []
    for i, p in enumerate(dense):
        t = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)])
        rings.append(tunnel_ring(p, t, w, h, 0.13, seed_))
    me = P.loft(rings, mat, True, True, tint)
    # make faces point inwards (towards the tunnel axis)
    fi = len(me.f) // 2
    c = sum((me.v[j] for j in me.f[fi]), Vector()) / len(me.f[fi])
    k = fi // len(rings[0])
    axis = dense[min(k, len(dense) - 1)] + Vector((0, 0, 1.2))
    if P.face_normal(me, fi).dot(axis - c) < 0:
        P.flip(me)
    return me, dense


def timber_set(p, t, w=1.75, h=2.25, tint=TIMBER, lag=True, paint=None, seed_=0):
    """Post-and-cap timber set at p facing along t (square-hewn 0.2 m timbers, battered posts) + lagging."""
    t = Vector(t).normalized()
    side = Vector((-t.y, t.x, 0))
    me = P.Mesh()
    P.seed(seed_)
    for sx in (-1, 1):
        b = p + side * sx * (w / 2)
        top = p + side * sx * (w / 2 - 0.08) + Vector((0, 0, h))
        tt = tint if not paint or (sx > 0) else paint
        me.extend(P.beam(b, top, 0.2, 0.2, "wood_log", up=t, tint=tt, end_mat="wood_endgrain"))
    cap = p + Vector((0, 0, h + 0.1))
    me.extend(P.beam(cap - side * (w / 2 + 0.15), cap + side * (w / 2 + 0.15), 0.22, 0.2, "wood_log", up=(0, 0, 1),
                     tint=paint or tint, end_mat="wood_endgrain"))
    if lag:
        for k in range(5):
            x = -w / 2 + 0.1 + k * (w - 0.2) / 4
            q = cap + side * x + Vector((0, 0, 0.13))
            me.extend(P.beam(q - t * 0.85, q + t * 0.85, 0.16, 0.05, "wood_planks", up=(0, 0, 1), tint=tint))
    return me


def rails(path, gauge=0.61, tie_every=0.65, tint=(1, 1, 1), ties=True):
    me = P.Mesh()
    pts = [Vector(p) for p in path]
    for sx in (-1, 1):
        line = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = Vector((-t.y, t.x, 0))
            line.append(p + side * sx * gauge / 2 + Vector((0, 0, 0.1)))
        me.extend(P.strip_tube(line, 0.05, 0.07, "metal_rusty"))
    if ties:
        acc = 0.0
        for a, b in zip(pts, pts[1:]):
            L = (b - a).length
            t = (b - a).normalized()
            side = Vector((-t.y, t.x, 0))
            d = (tie_every - acc) % tie_every
            while d < L:
                q = a + t * d
                me.extend(P.beam(q - side * 0.55 + Vector((0, 0, 0.03)), q + side * 0.55 + Vector((0, 0, 0.03)), 0.14, 0.07,
                                 "wood_log", tint=(0.55, 0.5, 0.45)))
                d += tie_every
            acc = (acc + L) % tie_every
    return me


def ore_car(tint=(1, 1, 1)):
    """1930s side-dump ore car, 1.4 m body on a 24-inch gauge truck; along X, base z = 0 (rail tops at 0.17)."""
    me = P.Mesh()
    body = [(-0.45, 0.35), (0.45, 0.35), (0.62, 0.95), (-0.62, 0.95)]
    b = P.slab([(y, z) for y, z in body], 1.4, "metal_rusty", tint=tint)
    me.extend(b.transformed(T(-0.7, 0, 0) @ RZ(-90) @ T(0, 0, 0)).transformed(RZ(0)))
    me.extend(box(1.5, 0.9, 0.12, "metal_rusty").transformed(T(0, 0, 0.3)))
    for sx in (-0.45, 0.45):
        for sy in (-0.305, 0.305):
            me.extend(cyl(0.16, 0.06, "metal_rusty", 12).transformed(T(sx, sy + (0.03 if sy > 0 else -0.03), 0.17) @ RX(90)))
        me.extend(rod((sx, -0.36, 0.17), (sx, 0.36, 0.17), 0.03, "metal_rusty", 6))
    me.extend(box(0.12, 0.2, 0.12, "metal_rusty").transformed(T(0.8, 0, 0.3)))
    me.extend(box(0.12, 0.2, 0.12, "metal_rusty").transformed(T(-0.8, 0, 0.3)))
    return me


# ================================================================== exterior

def build_exterior():
    s = P.Site("ashford_mine", seed_=53)
    s.bucket("main", vis_end=900.0)
    s.bucket("detail", vis_end=110.0)
    s.bucket("interior", vis_end=40.0)
    s.bucket("ground", vis_end=300.0, shadow=False)
    G = P.Ground("ashford_mine")
    PX, PY = -36.6, 6.0              # portal face (toe of the slope), facing +X
    pz = G.h(PX + 1.0, PY)

    # ---- portal: tunnel stub into the slope, timber sets, collar timbers, lagging, plank door
    stub_path = [Vector((PX + 1.4, PY, pz)), Vector((PX - 9.0, PY, pz - 0.1))]
    stub, dense = tunnel(stub_path, 2.2, 2.7, seed_=2.0, mat="rock_t")
    s.add(stub, None, "main")
    for k in range(6):
        x = PX + 0.8 - k * 1.5
        s.add(timber_set(Vector((x, PY, pz)), (-1, 0, 0), 1.95, 2.3, seed_=k), None, "main")
    # heavy portal frame, head block, retaining crib walls either side
    F = P.Mesh()
    for sy in (-1, 1):
        F.extend(P.beam((PX + 1.3, PY + sy * 1.15, pz - 0.2), (PX + 1.3, PY + sy * 1.1, pz + 2.6), 0.3, 0.3, "wood_log", tint=TIMBER,
                        end_mat="wood_endgrain"))
        for k in range(7):
            z = pz + 0.15 + k * 0.33
            F.extend(P.beam((PX + 1.5, PY + sy * 1.35, z), (PX + 1.5, PY + sy * (3.2 + 0.25 * k), z), 0.28, 0.28, "wood_log",
                            tint=TIMBER, end_mat="wood_endgrain"))
            F.extend(P.beam((PX + 0.3, PY + sy * (3.0 + 0.25 * k), z + 0.16), (PX + 1.7, PY + sy * (3.0 + 0.25 * k), z + 0.16), 0.24, 0.24,
                            "wood_log", tint=TIMBER, end_mat="wood_endgrain"))
    F.extend(P.beam((PX + 1.35, PY - 1.6, pz + 2.72), (PX + 1.35, PY + 1.6, pz + 2.72), 0.34, 0.32, "wood_log", tint=TIMBER,
                    end_mat="wood_endgrain"))
    for k in range(7):
        F.extend(P.beam((PX + 1.6, PY - 1.5 + k * 0.5, pz + 2.95), (PX - 2.0, PY - 1.5 + k * 0.5, pz + 3.1), 0.2, 0.2, "wood_log",
                        tint=(0.7, 0.66, 0.6)))
    s.add(F, None, "main")
    s.add(PR.decal("sign_mine", 2.6, 0.5).transformed(RZ(90)), T(PX + 1.53, PY, pz + 3.3), "main")
    s.add(box(0.05, 2.8, 0.6, "wood_planks", 'y', tint=(0.5, 0.45, 0.4)), T(PX + 1.5, PY, pz + 3.3), "main")
    s.add(PR.decal("sign_danger", 0.7, 0.35).transformed(RZ(90)), T(PX + 1.52, PY - 0.75, pz + 1.3), "detail")
    # plank door set 8 m in (to the tunnel interior), slightly open
    DX = PX - 7.6
    door = P.Mesh()
    for j in range(7):
        door.extend(box(0.06, 0.26, 2.1, "wood_planks", 'z', tint=(0.6, 0.55, 0.5)).transformed(T(0, -0.78 + j * 0.26, 1.05)))
    for zz in (0.35, 1.75):
        door.extend(box(0.05, 1.8, 0.14, "wood_planks", 'y', tint=(0.55, 0.5, 0.45)).transformed(T(0.06, 0, zz)))
    door.extend(P.beam((0.07, -0.8, 0.35), (0.07, 0.8, 1.75), 0.05, 0.14, "wood_planks", up=(1, 0, 0), tint=(0.55, 0.5, 0.45)))
    s.add(door, T(DX, PY, pz), "main")
    s.col_box("wood", Vector((DX, PY, pz + 1.1)), (0.2, 2.0, 2.2))
    # collision of the stub: floor + walls + roof
    for x0, x1 in ((PX + 1.4, DX),):
        cx = (x0 + x1) / 2
        L = abs(x1 - x0)
        s.col_box("rock", Vector((cx, PY, pz - 0.15)), (L, 2.4, 0.3))
        s.col_box("rock", Vector((cx, PY + 1.15, pz + 1.3)), (L, 0.3, 2.8))
        s.col_box("rock", Vector((cx, PY - 1.15, pz + 1.3)), (L, 0.3, 2.8))
        s.col_box("rock", Vector((cx, PY, pz + 2.6)), (L, 2.4, 0.3))
    # rock collar around the portal (hides the terrain cut-out edge)
    for k in range(14):
        a = math.radians(-100 + k * 200 / 13)
        c = Vector((PX + 0.2 + P.rnd(-0.4, 0.3), PY + math.cos(a) * 2.9, pz + 1.3 + math.sin(a) * 2.4 + 1.2))
        s.add(P.blob((0, 0, 0), (P.rnd(0.8, 1.4), P.rnd(0.9, 1.5), P.rnd(0.7, 1.2)), "rock", 9, 0.35, k * 1.3, rings=5),
              T(c) @ RZ(P.rnd(0, 360)), "main")
    # ice at the portal mouth: icicles from the lagging, floor glaze
    for k in range(16):
        x = PX + 1.4 - P.rnd(0, 2.5)
        y = PY + P.rnd(-1.0, 1.0)
        L = P.rnd(0.15, 0.7)
        s.add(cyl(0.03 + L * 0.04, L, "ice_floor", 5, r2=0.002, caps=False), T(x, y, pz + 2.52) @ RX(180), "detail")
    s.add(P.heightpatch(4.0, 1.6, 0.4, lambda x, y: 0.02 + 0.01 * P.nz((x, y, 0), 2.0), "ice_floor"), T(PX - 0.5, PY, pz), "detail")

    # ---- waste-rock causeway with the track to the ore bin
    CY = PY
    cx0, cx1 = PX + 1.4, 8.0
    ch = pz + 0.0
    rings = []
    n = 22
    for k in range(n + 1):
        x = cx0 + (cx1 - cx0) * k / n
        top = max(ch, 0.0) + 0.05 * P.nz((x, 0, 0), 0.8)
        g = G.h(x, CY)
        hh = max(0.3, top - g + 1.2) if x > PX + 6 else top - g + 1.2
        rr = []
        for (u, v) in ((-4.6, -0.3), (-3.2, 0.5), (-1.6, 1.0), (1.6, 1.0), (3.2, 0.5), (4.6, -0.3)):
            yy = CY + u * (1 + 0.08 * P.nz((x, u, 0), 0.6))
            zz = g + (v / 1.0) * (hh if v > 0 else 0.3) + 0.08 * P.nz((x, u, 3), 1.2)
            rr.append(Vector((x, yy, zz)))
        rings.append(rr)
    dump = P.loft(rings, "gravel", closed=False, smooth_=True, tint=(0.9, 0.78, 0.66))
    if P.face_normal(dump, len(dump.f) // 2).z < 0:
        P.flip(dump)
    s.add(dump, None, "ground")
    top_z = G.h(0, CY) + 1.2
    track = [Vector((PX - 7.0, PY, pz)), Vector((PX + 1.4, PY, pz)), Vector((PX + 6.0, CY, top_z - 0.05)), Vector((cx1 + 2.5, CY, top_z - 0.05))]
    s.add(rails(track), None, "detail")
    s.col_box("gravel", Vector(((PX + 6.0 + cx1) / 2, CY, top_z - 0.35)), (cx1 - PX - 6.0, 3.3, 0.6))
    for sy in (-1, 1):
        s.col_box("gravel", Vector(((PX + 6.0 + cx1) / 2, CY + sy * 2.6, top_z - 0.75)), (cx1 - PX - 6.0, 2.4, 0.4), RX(sy * 24))
    ang = math.degrees(math.atan2(top_z - pz, 4.6))
    s.col_box("gravel", Vector((PX + 3.7, PY, (pz + top_z) / 2 - 0.3)), (4.8, 3.3, 0.6), RY(-ang))
    # ore car on the causeway near the portal, tipped slightly
    s.add(ore_car(), T(PX + 9.0, CY, top_z + 0.0) @ RZ(0) @ RX(3), "main")
    s.col_box("metal", Vector((PX + 9.0, CY, top_z + 0.6)), (1.5, 1.2, 1.0))
    # ore bin and chute at the causeway end
    BX = cx1 + 3.5
    bin_ = P.Mesh()
    for sx in (-1, 1):
        for sy in (-1, 1):
            bin_.extend(P.beam((BX + sx * 1.4, CY + sy * 1.4, G.h(BX + sx * 1.4, CY + sy * 1.4) - 0.2),
                               (BX + sx * 1.4, CY + sy * 1.4, top_z + 1.6), 0.25, 0.25, "wood_log", tint=TIMBER, end_mat="wood_endgrain"))
    for k in range(9):
        z = top_z - 1.2 + k * 0.32
        for sy in (-1, 1):
            bin_.extend(box(3.0, 0.07, 0.3, "wood_planks", 'x', tint=TIMBER).transformed(T(BX, CY + sy * 1.5, z)))
        if k > 2:
            bin_.extend(box(0.07, 3.0, 0.3, "wood_planks", 'y', tint=TIMBER).transformed(T(BX + 1.5, CY, z)))
    bin_.extend(box(3.1, 3.1, 0.08, "wood_planks", 'y', tint=(0.6, 0.55, 0.5)).transformed(T(BX, CY, top_z - 1.3) @ RY(-18)))
    ch_ = P.Mesh()
    ch_.extend(box(3.2, 0.9, 0.06, "wood_planks", 'x', tint=TIMBER).transformed(T(0, 0, 0)))
    for sy in (-1, 1):
        ch_.extend(box(3.2, 0.06, 0.4, "wood_planks", 'x', tint=TIMBER).transformed(T(0, sy * 0.45, 0.2)))
    ch_.extend(box(0.06, 0.95, 0.6, "metal_rusty").transformed(T(1.6, 0, 0.25) @ RY(25)))
    bin_.extend(ch_.transformed(T(BX + 2.9, CY, top_z - 1.9) @ RY(28)))
    s.add(bin_, None, "main")
    s.col_box("wood", Vector((BX, CY, top_z + 0.2)), (3.1, 3.1, 3.2))
    for k in range(10):
        s.add(P.blob((0, 0, 0), (0.3, 0.25, 0.2), "rock", 7, 0.3, k * 3.1, rings=4),
              T(BX + 4.8 + P.rnd(-1, 1.5), CY + P.rnd(-1.4, 1.4), G.h(BX + 4.8, CY)), "detail")

    # ---- headframe over the shaft (2-post with backlegs), shaft collar cribbing, sheave
    HX, HY = 4.0, -12.0
    hz = G.h(HX, HY)
    hf = P.Mesh()
    Hh = 11.0
    for sy in (-1, 1):
        hf.extend(P.beam((HX - 1.2, HY + sy * 1.3, hz), (HX - 1.2, HY + sy * 1.1, hz + Hh), 0.3, 0.3, "wood_log", tint=TIMBER, end_mat="wood_endgrain"))
        hf.extend(P.beam((HX + 1.2, HY + sy * 1.3, hz), (HX + 1.2, HY + sy * 1.1, hz + Hh), 0.3, 0.3, "wood_log", tint=TIMBER, end_mat="wood_endgrain"))
        hf.extend(P.beam((HX + 7.5, HY + sy * 1.5, hz), (HX + 0.8, HY + sy * 1.1, hz + Hh - 0.4), 0.3, 0.3, "wood_log", tint=TIMBER, end_mat="wood_endgrain"))
        for k in range(4):
            z = hz + 1.5 + k * 2.6
            hf.extend(P.beam((HX - 1.3, HY + sy * 1.2, z), (HX + 1.3, HY + sy * 1.2, z), 0.2, 0.2, "wood_log", tint=TIMBER))
            if k < 3:
                hf.extend(P.beam((HX - 1.2, HY + sy * 1.25, z), (HX + 1.2, HY + sy * 1.2, z + 2.6), 0.14, 0.14, "wood_log", tint=TIMBER))
    for k in range(4):
        z = hz + 1.5 + k * 2.6
        for sx in (-1, 1):
            hf.extend(P.beam((HX + sx * 1.2, HY - 1.3, z), (HX + sx * 1.2, HY + 1.3, z), 0.2, 0.2, "wood_log", tint=TIMBER))
    hf.extend(box(3.0, 3.0, 0.12, "wood_planks", 'x', tint=TIMBER).transformed(T(HX, HY, hz + Hh)))
    # sheave wheel
    sh = cyl(0.9, 0.12, "metal_rusty", 24, caps=False).transformed(RX(90) @ T(0, 0, -0.06))
    sh.extend(cyl(0.8, 0.12, "metal_rusty", 24, caps=False).transformed(RX(90) @ T(0, 0, -0.06)))
    for k in range(6):
        a = math.radians(k * 30)
        sh.extend(rod((-0.8 * math.cos(a), 0, -0.8 * math.sin(a)), (0.8 * math.cos(a), 0, 0.8 * math.sin(a)), 0.03, "metal_rusty", 5))
    sh.extend(cyl(0.12, 0.3, "metal_rusty", 10).transformed(RX(90) @ T(0, 0, -0.15)))
    hf.extend(sh.transformed(T(HX + 0.3, HY, hz + Hh + 0.95) @ RZ(90)))
    for sy in (-0.3, 0.3):
        hf.extend(box(0.6, 0.12, 0.8, "wood_log", tint=TIMBER).transformed(T(HX + 0.3, HY + sy, hz + Hh + 0.4)))
    s.add(hf, None, "main")
    for sx in (-1.2, 1.2):
        for sy in (-1.2, 1.2):
            s.col_box("wood", Vector((HX + sx, HY + sy, hz + Hh / 2)), (0.32, 0.32, Hh))
    # shaft collar: timber cribbing, black void, rotten cover planks
    col = P.Mesh()
    for k in range(3):
        z = hz + k * 0.28
        for sy in (-1, 1):
            col.extend(P.beam((HX - 1.5, HY + sy * 1.0, z + 0.14), (HX + 1.5, HY + sy * 1.0, z + 0.14), 0.28, 0.28, "wood_log", tint=TIMBER,
                              end_mat="wood_endgrain"))
        for sx in (-1, 1):
            col.extend(P.beam((HX + sx * 1.2, HY - 1.3, z + 0.28), (HX + sx * 1.2, HY + 1.3, z + 0.28), 0.28, 0.28, "wood_log", tint=TIMBER,
                              end_mat="wood_endgrain"))
    col.extend(box(2.1, 1.7, 0.05, "metal_dark", tint=(0.01, 0.01, 0.01), flags=P.F_NOAO | P.F_NOEXP).transformed(T(HX, HY, hz - 0.3)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            col.extend(box(0.02, 1.7, 1.2, "rock_t", tint=(0.2, 0.2, 0.2)).transformed(T(HX + sx * 1.05, HY, hz + 0.3)) if sy > 0 else
                       box(2.1, 0.02, 1.2, "rock_t", tint=(0.2, 0.2, 0.2)).transformed(T(HX, HY + sx * 0.85, hz + 0.3)))
    for k in range(5):
        if k in (1, 3):
            continue
        col.extend(box(0.28, 2.0, 0.06, "wood_planks", 'y', tint=(0.5, 0.45, 0.4)).transformed(T(HX - 0.9 + k * 0.45, HY, hz + 0.86) @ RX(P.rnd(-4, 4))))
    col.extend(box(0.28, 1.2, 0.06, "wood_planks", 'y', tint=(0.5, 0.45, 0.4)).transformed(T(HX - 0.45, HY - 0.9, hz + 0.3) @ RX(-38)))
    s.add(col, None, "main")
    s.col_box("wood", Vector((HX, HY, hz + 0.45)), (3.1, 2.6, 0.9))
    # ---- hoist ruin: steam hoist drum on a frame, boiler, cable to the sheave, fallen roof over it
    WX, WY = HX + 10.5, HY
    wz = G.h(WX, WY)
    ho = P.Mesh()
    ho.extend(box(2.6, 1.6, 0.5, "concrete", tint=(0.7, 0.68, 0.62)).transformed(T(0, 0, 0.25)))
    ho.extend(cyl(0.5, 1.2, "metal_rusty", 18).transformed(T(0, -0.6, 1.0) @ RX(-90)))
    for sy in (-1, 1):
        ho.extend(lathe([(0.0, 0.0), (0.62, 0.0), (0.62, 0.05), (0.0, 0.05)], "metal_rusty", 18).transformed(T(0, sy * 0.65, 1.0) @ RX(90)))
        ho.extend(box(1.4, 0.12, 0.9, "metal_rusty").transformed(T(0, sy * 0.78, 0.8)))
    ho.extend(cyl(0.53, 1.18, "rope", 18, caps=False, tint=(0.3, 0.27, 0.25)).transformed(T(0, -0.59, 1.0) @ RX(-90)))
    s.add(ho, T(WX, WY, wz) @ RZ(90), "main")
    s.col_box("metal", Vector((WX, WY, wz + 0.8)), (1.8, 2.6, 1.6))
    s.add(tube([(WX - 0.4, WY, wz + 1.5), (HX + 3.0, HY, hz + 7.0), (HX + 0.3, HY, hz + Hh + 1.85)], 0.018, "metal_rusty", 5), None, "detail")
    s.add(tube([(HX + 0.3 - 0.9, HY, hz + Hh + 0.95), (HX - 0.6, HY, hz + 2.0)], 0.018, "metal_rusty", 5), None, "detail")
    bo = cyl(0.65, 3.6, "metal_rusty", 18, vseg=3).transformed(T(-1.8, 0, 0) @ RY(90))
    bo.extend(box(3.8, 1.3, 0.7, "concrete", tint=(0.55, 0.35, 0.28)).transformed(T(0, 0, -0.85)))
    bo.extend(cyl(0.2, 3.5, "metal_rusty", 10).transformed(T(1.6, 0, 0.5) @ RY(80)))
    s.add(bo, T(WX + 1.5, WY + 4.2, wz + 1.2) @ RZ(8), "main")
    s.col_box("metal", Vector((WX + 1.5, WY + 4.2, wz + 0.9)), (3.8, 1.4, 1.8), RZ(8))
    # hoist house remains: corner posts, collapsed roof slab, a standing wall
    for (dx, dy) in ((-2.2, -2.0), (2.2, -2.0), (2.2, 2.0)):
        s.add(P.beam((WX + dx, WY + dy, wz), (WX + dx, WY + dy, wz + 3.0), 0.18, 0.18, "wood_log", tint=TIMBER), None, "main")
    wall_, cols_ = AR.wall(4.4, 3.0, 0.05, [(1.6, 2.4, 1.2, 2.0)], "wood_planks", "wood_planks", TIMBER, TIMBER, 1.5)
    s.add(wall_, T(WX - 2.2, WY - 2.0, wz), "main")
    for c, size in cols_:
        s.col_box("wood", T(WX - 2.2, WY - 2.0, wz) @ c, size)
    rf = box(5.0, 3.2, 0.06, "metal_corrugated", 'y', seg=1.0, tint=(0.7, 0.62, 0.55))
    rf.displace(lambda p: Vector((0, 0, 0.12 * P.nz(p, 0.9, 5.0))))
    s.add(rf, T(WX, WY + 1.2, wz + 1.6) @ RX(28) @ RY(-6), "main")

    # ---- collapsed log bunkhouse
    BHX, BHY = -12.0, -16.0
    bz = G.h(BHX, BHY)
    Mb = T(BHX, BHY, bz) @ RZ(8)
    bl = 8.0
    bw = 5.0
    for k, (M, L, hgt, z0, ops) in enumerate((
            (T(-bl / 2, -bw / 2, 0), bl, 1.9, None, [(2.0, 2.9, 0.1, 1.9)]),
            (T(bl / 2, bw / 2, 0) @ RZ(180), bl, 1.2, None, []),
            (T(-bl / 2, bw / 2, 0) @ RZ(-90), bw, 2.1, 0.14 * 1.78 / 2 + 0.14, [(1.8, 2.6, 0.9, 1.6)]),
            (T(bl / 2, -bw / 2, 0) @ RZ(90), bw, 0.8, 0.14 * 1.78 / 2 + 0.14, []))):
        me, cols = AR.log_wall(L, hgt, 0.14, ops, seed_=20 + k, ext=0.3, z_start=z0)
        # ragged tops: drop logs above a noisy height
        P.remove_faces(me, lambda c, i, L=L, hgt=hgt, k=k: c.z > hgt * (0.7 + 0.3 * P.nz((c.x, k, 0), 0.4)) and c.z > 0.5)
        s.add(me, Mb @ M, "main")
        for c, size in cols:
            s.col_box("wood", Mb @ M @ c, size, Mb @ M)
    # roof collapsed into the room: two broken slabs of boards
    r1 = box(4.5, 3.4, 0.05, "wood_planks", 'y', seg=0.8, tint=(0.6, 0.55, 0.5))
    r1.displace(lambda p: Vector((0, 0, 0.1 * P.nz(p, 0.8, 1.0))))
    s.add(r1, Mb @ T(-1.3, 0.3, 0.95) @ RX(-16) @ RY(12), "main")
    s.col_box("wood", Mb @ Vector((-1.3, 0.3, 0.95)), (4.5, 3.4, 0.1), Mb @ RX(-16) @ RY(12))
    r2 = box(3.4, 3.0, 0.05, "wood_planks", 'y', seg=0.8, tint=(0.6, 0.55, 0.5))
    s.add(r2, Mb @ T(2.3, -0.5, 0.7) @ RX(12) @ RY(-20), "main")
    for k in range(5):
        s.add(P.beam((P.rnd(-3, 3), P.rnd(-2, 2), 0.1), (P.rnd(-3, 3), P.rnd(-2, 2), P.rnd(0.2, 1.4)), 0.12, 0.12, "wood_log", tint=TIMBER),
              Mb, "main")
    s.add(PR.bunk(0.8, 1.9, 0.4, "wood_log", (0.3, 0.26, 0.2), blanket=False), Mb @ T(-3.3, 1.2, 0) @ RZ(90) @ RX(4), "interior")
    s.add(PR.bunk(0.8, 1.9, 0.4, "wood_log", (0.3, 0.26, 0.2), blanket=False), Mb @ T(2.9, 1.3, 0) @ RZ(90), "interior")
    st = PR.wood_stove((0.25, 0.14, 0.1), 1.2)
    s.add(st, Mb @ T(0.8, 1.8, 0) @ RZ(90) @ RY(8), "interior")
    s.add(PR.barrel(rust=True, lying=True), Mb @ T(4.8, -3.2, 0) @ RZ(30), "detail")
    s.add(tube([(-1.0, -1.0, 0.05), (0.2, -0.6, 0.1), (1.0, -1.4, 0.05)], 0.02, "metal_rusty", 5), Mb, "detail")

    # ---- scattered iron, drill steel, a wheelbarrow, rail lengths
    iron = P.Mesh()
    for k in range(8):
        x, y = P.rnd(-8, 14), P.rnd(-24, 16)
        if abs(y - CY) < 3.5:
            continue
        iron.extend(rod((0, 0, 0.03), (P.rnd(1.5, 3.5), 0, 0.03), 0.03, "metal_rusty", 5).transformed(T(x, y, G.h(x, y)) @ RZ(P.rnd(0, 180))))
    for k in range(3):
        x, y = -4.0 + k * 0.4, -3.0
        iron.extend(P.strip_tube([(x, y, G.h(x, y) + 0.04), (x + 4.0, y + 0.6, G.h(x + 4, y) + 0.04)], 0.05, 0.07, "metal_rusty"))
    wb = P.Mesh()
    wb.extend(P.slab([(-0.35, 0.25), (0.35, 0.25), (0.45, 0.6), (-0.5, 0.6)], 0.6, "metal_rusty").transformed(T(0, -0.3, 0)))
    wb.extend(cyl(0.18, 0.06, "metal_rusty", 10).transformed(T(0.55, 0, 0.18) @ RX(90)))
    for sy in (-0.25, 0.25):
        wb.extend(rod((0.55, sy * 0.6, 0.18), (-1.0, sy, 0.45), 0.02, "wood_log", 5))
    iron.extend(wb.transformed(T(-6.0, -6.0, G.h(-6, -6)) @ RZ(40) @ RX(12)))
    for k in range(3):
        x, y = 12.0 + k * 0.7, -2.0 + k * 0.2
        iron.extend(PR.barrel(rust=True, lying=k == 1).transformed(T(x, y, G.h(x, y)) @ RZ(k * 40)))
    s.add(iron, None, "detail")

    # ---- sockets
    s.marker("Arrive_Default", (26.0, -18.0, G.h(26.0, -18.0)), 90)
    s.marker("Arrive_FromMine", (PX + 3.0, PY, pz), -90)
    s.marker("Use_Door_Mine", (DX + 0.25, PY, pz + 1.1), 90)
    s.marker("Log_miner_diary_1", (BHX + 2.9 * math.cos(math.radians(8)) - 1.3 * math.sin(math.radians(8)),
                                   BHY + 2.9 * math.sin(math.radians(8)) + 1.3 * math.cos(math.radians(8)), bz + 0.1), 0)
    s.marker("Loot_Bunkhouse", (BHX - 3.0, BHY + 1.5, bz + 0.5), 0)
    s.marker("Loot_Hoist", (WX - 1.5, WY - 1.2, wz + 0.3), 0)
    s.marker("Loot_OreCar", (PX + 9.0, CY, top_z + 0.9), 0)
    s.marker("Scan_Headframe", (HX, HY + 1.8, hz + 1.5), 0)
    s.marker("Scan_Boiler", (WX + 1.5, WY + 3.2, wz + 1.2), 0)
    s.marker("Spot_Campfire", (-2.0, 12.0, G.h(-2.0, 12.0)), 0)
    s.marker("Spot_OldGrey", (-20.0, 18.0, G.h(-20.0, 18.0)), 180)
    s.shelter("Shelter_Portal", Vector((PX - 3.5, PY, pz)), (6.0, 2.0, 2.4), 0.7)
    return s


# ================================================================== interior (y 800)

def build_interior():
    s = P.Site("ashford_mine_interior", ground=False, interior=True, seed_=59)
    s.bucket("main", vis_end=220.0)     # interiors sit 1 km under the terrain: never drawn from the surface
    s.bucket("detail", vis_end=45.0)
    # Local frame: origin = inside face of the portal door; the adit runs west (-X).
    main = [Vector((0.5, 0, 0)), Vector((-12.0, 0, 0)), Vector((-30.0, 0.0, 0)), Vector((-46.0, 1.5, 0)),
            Vector((-58.0, 1.0, 0.0))]
    drift2 = [Vector((-58.0, 1.0, 0.0)), Vector((-66.0, 5.0, 0.0)), Vector((-74.0, 12.0, 0.0)), Vector((-86.0, 16.0, 0.0)),
              Vector((-96.0, 16.5, 0.0))]
    cross = [Vector((-30.0, 0.0, 0)), Vector((-30.5, -8.0, 0)), Vector((-31.0, -14.0, 0))]
    powder = [Vector((-12.0, 0.0, 0)), Vector((-12.2, 4.2, 0))]
    stope_c = Vector((-80.0, 13.8, 0.0))
    segs = []
    for k, (path, w, h, sd) in enumerate(((main, 2.0, 2.5, 1.0), (drift2, 1.9, 2.45, 2.0), (cross, 1.9, 2.4, 3.0),
                                           (powder, 1.7, 2.2, 4.0))):
        me, dense = P.Mesh(), None
        me, dense = tunnel(path, w, h, sd, 0.8, "rock_cliff")
        segs.append((me, dense, path, w))
    # cut junction openings: main at the crosscut / powder alcove; main end joins drift2
    def cut(me, center, direction, radius):
        d = Vector(direction).normalized()
        return P.remove_faces(me, lambda c, i: (c - center).dot(d) > 0.3 and ((c - center) - d * (c - center).dot(d)).length < radius
                              and (c - center).length < 3.0)
    cut(segs[0][0], Vector((-30.0, 0, 1.2)), (0, -1, 0), 1.25)
    cut(segs[0][0], Vector((-12.0, 0, 1.1)), (0, 1, 0), 1.15)
    # the crosscut / alcove tubes start on the main drift's axis: drop their faces inside the main drift
    P.remove_faces(segs[2][0], lambda c, i: c.y > -1.05)
    P.remove_faces(segs[3][0], lambda c, i: c.y < 0.95)
    # No. 2 drift runs through the stope: drop its faces inside the chamber
    SU = (Vector((-86.0, 16.0, 0)) - Vector((-74.0, 12.0, 0))).normalized()
    P.remove_faces(segs[1][0], lambda c, i: abs((c - stope_c).dot(SU)) < 5.2 and c.x < -73.5)
    # the main drift ends in a stope-side pillar: No. 2 drift continues from its end (same section)
    for me, dense, path, w in segs:
        s.add(me, None, "main")
    # stope chamber: a big irregular room around stope_c
    rings = []
    for k in range(9):
        t = k / 8
        a = (t - 0.5) * 12.0
        p = stope_c + SU * a
        wd = 3.0 + 4.0 * math.sin(math.pi * t) ** 0.7
        ht = 2.6 + 3.8 * math.sin(math.pi * t) ** 0.6
        rings.append(tunnel_ring(p, SU, wd, ht, 0.35, 7.0 + k * 0.1, 0.08))
    stope = P.loft(rings, "rock_cliff", True, True, ROCK_T)
    fi = len(stope.f) // 2
    c = sum((stope.v[j] for j in stope.f[fi]), Vector()) / len(stope.f[fi])
    if P.face_normal(stope, fi).dot((stope_c + Vector((0, 0, 1.5))) - c) < 0:
        P.flip(stope)
    s.add(stope, None, "main")
    # dead ends / caps: collapse at the end of No. 2 drift, face at the powder alcove end, depot chamber
    end2 = drift2[-1]
    for k in range(18):
        p = end2 + Vector((P.rnd(-2.2, 0.8), P.rnd(-0.9, 0.9), P.rnd(0.0, 1.8)))
        s.add(P.blob((0, 0, 0), (P.rnd(0.3, 0.8), P.rnd(0.3, 0.7), P.rnd(0.25, 0.6)), "rock_cliff", 8, 0.35, k * 2.1, tint=ROCK_T, rings=5),
              T(p), "main")
    for k in range(4):
        a = end2 + Vector((P.rnd(-3, -0.5), P.rnd(-0.8, 0.8), 0.2))
        s.add(P.beam(a, a + Vector((P.rnd(0.5, 1.5), P.rnd(-0.6, 0.6), P.rnd(0.8, 1.8))), 0.18, 0.18, "wood_log", tint=TIMBER), None, "main")
    s.add(P.blob((0, 0, 0), (1.3, 1.2, 1.4), "rock_cliff", 10, 0.2, 3.0, tint=ROCK_T), T(end2 + Vector((-1.0, 0, 1.0))), "main")
    s.add(P.blob((0, 0, 0), (0.9, 1.1, 1.3), "rock_cliff", 10, 0.2, 4.0, tint=ROCK_T), T(powder[-1] + Vector((0, 0.6, 1.0))), "main")
    # Owen's depot chamber at the end of the crosscut
    dc = cross[-1] + Vector((0, -2.2, 0))
    rings = []
    for k in range(6):
        t = k / 5
        p = cross[-1] + Vector((0, -4.6 * t, 0))
        wd = 2.0 + 3.0 * math.sin(math.pi * t) ** 0.6
        rings.append(tunnel_ring(p, (0, -1, 0), wd, 2.6 + 0.4 * math.sin(math.pi * t), 0.15, 9.0 + k, 0.03))
    dch = P.loft(rings, "rock_cliff", True, True, ROCK_T, cap1=True)
    fi = len(dch.f) // 2
    c = sum((dch.v[j] for j in dch.f[fi]), Vector()) / len(dch.f[fi])
    if P.face_normal(dch, fi).dot(dc + Vector((0, 0, 1.3)) - c) < 0:
        P.flip(dch)
    s.add(dch, None, "main")

    # timber sets: first 14 m of the main drift, the crosscut (orange paint on the first two), No. 2 drift in bad ground
    def sets_along(path, spacing, x_from, x_to, paint_first=0, seed_=0):
        dense = []
        pts = [Vector(p) for p in path]
        acc = 0.0
        k = 0
        for a, b in zip(pts, pts[1:]):
            L = (b - a).length
            t = (b - a).normalized()
            d = (spacing - acc) % spacing
            while d < L:
                dist = sum((pp - qq).length for pp, qq in zip(pts, pts[1:])) if False else None
                q = a + t * d
                pos = (q - pts[0]).length
                if x_from <= pos <= x_to:
                    s.add(timber_set(q, t, 1.8, 2.22, paint=ORANGE if k < paint_first else None, seed_=seed_ + k), None, "main")
                    k += 1
                d += spacing
            acc = (acc + L) % spacing
    sets_along(main, 1.6, 0.0, 14.0, seed_=1)
    sets_along(cross, 1.8, 1.5, 12.0, paint_first=2, seed_=40)
    sets_along(drift2, 1.5, 2.0, 30.0, seed_=80)
    sets_along(powder, 1.4, 1.0, 3.5, seed_=120)
    # rails: main drift + No. 2 drift + crosscut spur
    s.add(rails(main[:-1] + [main[-1]] + drift2[1:-1], tint=(1, 1, 1)), None, "main")
    s.add(rails(cross[:2]), None, "main")
    s.add(ore_car(), T(-50.0, 1.35, 0.0) @ RZ(4), "main")
    s.col_box("metal", Vector((-50.0, 1.35, 0.55)), (1.5, 1.0, 1.0), RZ(4))
    # stulls across the stope, old chute, rubble
    for k in range(6):
        p = stope_c + Vector((-4.0 + k * 1.6, 0.6 * k - 1.5, 2.0 + (k % 2) * 1.4))
        side = Vector((-0.3, 0.8, 0.0)).normalized()
        s.add(rod(p - side * 3.2, p + side * 3.2, 0.14, "wood_log", 8, cap_mat="wood_endgrain", tint=TIMBER), None, "main")
    for k in range(10):
        p = stope_c + Vector((P.rnd(-5, 5), P.rnd(-2.5, 2.5), 0))
        s.add(P.blob((0, 0, 0), (P.rnd(0.4, 1.0), P.rnd(0.4, 0.9), P.rnd(0.2, 0.5)), "rock_cliff", 8, 0.3, k * 1.9, tint=ROCK_T, rings=4),
              T(p), "main")
    # ladder raise above the main drift near its end
    RX_ = Vector((-55.0, 1.2, 2.3))
    crib = P.Mesh()
    for k in range(10):
        z = k * 0.3
        for sy in (-1, 1):
            crib.extend(box(1.6, 0.2, 0.2, "wood_log", 'x', tint=TIMBER, end_mat="wood_endgrain").transformed(T(0, sy * 0.7, z)))
            crib.extend(box(0.2, 1.6, 0.2, "wood_log", 'y', tint=TIMBER, end_mat="wood_endgrain").transformed(T(sy * 0.7, 0, z + 0.15)))
    crib.extend(box(1.4, 1.4, 0.05, "metal_dark", tint=(0.01, 0.01, 0.01), flags=P.F_NOAO).transformed(T(0, 0, 3.1)))
    s.add(crib, T(RX_), "main")
    s.add(PR.ladder(4.8, 0.45), T(RX_ + Vector((0.45, 0, -2.3))) @ RZ(90) @ RX(-6), "main")
    s.col_box("wood", RX_ + Vector((0.5, 0, 0.1)), (0.12, 0.5, 4.8))

    # ice near the portal: icicles and a glazed floor for the first 18 m; drips and pools deeper
    for k in range(40):
        x = -P.rnd(0.5, 18.0)
        y = P.rnd(-0.8, 0.8)
        L = P.rnd(0.1, 0.6) * (1.0 - (-x) / 22.0)
        s.add(cyl(0.02 + L * 0.05, L, "ice_floor", 5, r2=0.002, caps=False), T(x, y, 2.28 + 0.1 * P.rnd()) @ RX(180), "detail")
    s.add(P.heightpatch(16.0, 1.5, 0.5, lambda x, y: 0.03 + 0.01 * P.nz((x, y, 0), 1.3), "ice_floor"), T(-8.5, 0, 0), "main")
    for k, (c_, r_) in enumerate(((Vector((-36.0, 0.7, 0)), 0.9), (Vector((-68.0, 7.0, 0)), 1.1), (Vector((-88.0, 16.0, 0)), 1.3),
                                  (stope_c + Vector((2.0, 1.0, 0)), 1.6))):
        pool = P.heightpatch(r_ * 2, r_ * 1.4, 0.3, lambda x, y: 0.04, "water", flags=P.F_NOAO)
        P.remove_faces(pool, lambda c, i, r_=r_: (c.x / r_) ** 2 + (c.y / (r_ * 0.7)) ** 2 > 1.0)
        s.add(pool, T(c_), "main")
        s.add(cyl(0.003, 0.35, "water", 4), T(c_ + Vector((0.2, 0.1, 2.0))), "detail")

    # powder alcove: plank door (ajar), crates stencilled POWDER
    pa = powder[0] + Vector((0, 1.7, 0))
    pdoor = P.Mesh()
    for j in range(5):
        pdoor.extend(box(0.2, 0.05, 1.9, "wood_planks", 'z', tint=(0.55, 0.5, 0.45)).transformed(T(-0.4 + j * 0.2, 0, 0.95)))
    s.add(pdoor, T(pa + Vector((-0.4, 0, 0))) @ RZ(-65) @ T(0.4, 0, 0), "main")
    for sx in (-0.75, 0.75):
        s.add(box(0.18, 0.18, 2.1, "wood_log", tint=TIMBER), T(pa + Vector((sx, 0, 1.05))), "main")
    s.add(box(1.7, 0.2, 0.2, "wood_log", tint=TIMBER), T(pa + Vector((0, 0, 2.15))), "main")
    for k in range(3):
        s.add(PR.crate(0.6, 0.4, 0.35, "wood_planks", tint=(0.8, 0.7, 0.55), stencil="stencil_ashford"),
              T(powder[-1] + Vector((P.rnd(-0.4, 0.4), -0.8 - k * 0.1, 0.35 * (k == 2)))) @ RZ(180 + P.rnd(-10, 10)), "main")

    # Owen's depot: tarp, table, cases, 4 x 20 L fuel cans, rope, sleeping pad, battery lantern (on)
    dp = cross[-1] + Vector((0, -2.4, 0))
    tarp = P.heightpatch(2.6, 2.0, 0.25, lambda x, y: 0.02 + 0.015 * P.nz((x, y, 0), 3.0), "nylon_paint_2s", tint=(0.1, 0.2, 0.55))
    s.add(tarp, T(dp + Vector((0.3, 0, 0))), "main")
    s.add(PR.hard_case(0.8, 0.45, 0.35, (0.75, 0.3, 0.04)), T(dp + Vector((0.9, 0.4, 0.02))) @ RZ(80), "main")
    s.add(PR.hard_case(0.6, 0.4, 0.25, (0.12, 0.12, 0.12)), T(dp + Vector((0.9, 0.4, 0.37))) @ RZ(75), "main")
    for k in range(4):
        s.add(PR.jerrycan((0.5, 0.06, 0.03)), T(dp + Vector((-0.7 + (k % 2) * 0.38, -0.6 + (k // 2) * 0.2, 0.02))) @ RZ(90), "main")
    coil = P.Mesh()
    for k in range(6):
        coil.extend(tube([Vector((0.22 * math.cos(a / 8 * 2 * math.pi), 0.22 * math.sin(a / 8 * 2 * math.pi), 0.02 + k * 0.022)) for a in range(9)],
                         0.011, "rope", 5, tint=(0.95, 0.35, 0.1)))
    s.add(coil, T(dp + Vector((0.2, -0.7, 0.02))), "main")
    pad = box(0.55, 1.8, 0.03, "plastic", 'y', tint=(0.1, 0.35, 0.12))
    s.add(pad, T(dp + Vector((-0.4, 0.5, 0.04))) @ RZ(8), "main")
    s.add(PR.lantern(), T(dp + Vector((0.95, 0.45, 0.62))), "main")
    s.add(PR.decal("paint_arrow", 0.6, 0.15).transformed(RZ(180)), T(Vector((-29.4, -1.02, 1.5))) @ RZ(0), "main")
    s.add(PR.decal("sign_drift2", 0.8, 0.3), T(Vector((-60.2, 3.0, 2.1))) @ RZ(-60), "main")
    # entrance door (inside face) + daylight spill
    idoor = P.Mesh()
    for j in range(7):
        idoor.extend(box(0.06, 0.26, 2.1, "wood_planks", 'z', tint=(0.6, 0.55, 0.5)).transformed(T(0, -0.78 + j * 0.26, 1.05)))
    s.add(idoor, T(0.6, 0, 0), "main")
    s.col_box("wood", Vector((0.6, 0, 1.1)), (0.2, 2.2, 2.2))

    # collision: floor, back and wall boxes along every segment; walls split around junction mouths
    def seg_boxes(path, w, h, gaps=(), skip=None):
        """gaps: [(x_along_world_x or point, radius, side)] - wall pieces within `radius` of the point on `side`
        (+1 = right of travel... side vector (-d.y, d.x)) are left open."""
        pts = [Vector(p) for p in path]
        for a, b in zip(pts, pts[1:]):
            d = b - a
            L = d.length
            Rm = P.look_basis(d, (0, 0, 1))
            side = Vector((-d.y, d.x, 0)).normalized()
            tdir = d.normalized()
            pieces = [(0.0, L)]
            if skip:
                pieces = [(0.0, L)]
            def cutp(pcs, t0, t1):
                out = []
                for u0, u1 in pcs:
                    if t1 <= u0 or t0 >= u1:
                        out.append((u0, u1))
                        continue
                    if t0 > u0:
                        out.append((u0, t0))
                    if t1 < u1:
                        out.append((t1, u1))
                return out
            fl = list(pieces)
            if skip:
                for q, r in skip:
                    t = (Vector(q) - a).dot(tdir)
                    fl = cutp(fl, t - r, t + r)
            for u0, u1 in fl:
                if u1 - u0 < 0.05:
                    continue
                c = a + tdir * ((u0 + u1) / 2)
                s.col_box("rock", c + Vector((0, 0, -0.15)), (w + 0.6, 0.3, (u1 - u0) + 0.5), Rm)
                s.col_box("rock", c + Vector((0, 0, h + 0.15)), (w + 0.6, 0.3, (u1 - u0) + 0.5), Rm)
            for sx in (-1, 1):
                wp = list(fl)
                for q, r, sd in gaps:
                    if sd != sx:
                        continue
                    t = (Vector(q) - a).dot(tdir)
                    wp = cutp(wp, t - r, t + r)
                for u0, u1 in wp:
                    if u1 - u0 < 0.05:
                        continue
                    c = a + tdir * ((u0 + u1) / 2)
                    s.col_box("rock", c + side * sx * (w / 2 + 0.15) + Vector((0, 0, h / 2)), (0.3, h, u1 - u0), Rm)
    seg_boxes(main, 2.0, 2.45, gaps=[((-30.0, 0, 0), 1.0, 1), ((-12.0, 0, 0), 0.9, -1)])
    seg_boxes(drift2, 1.9, 2.4, skip=[(stope_c, 5.0)])
    seg_boxes([Vector((-30.0, -1.0, 0))] + cross[1:], 1.9, 2.35)
    seg_boxes([Vector((-12.0, 1.0, 0)), powder[-1]], 1.7, 2.2)
    # stope chamber: floor, sides, end walls with the drift openings
    SR = P.look_basis(Vector((SU.x, SU.y, 0)), (0, 0, 1))
    s.col_box("rock", stope_c + Vector((0, 0, -0.2)), (7.5, 0.4, 12.4), SR)
    s.col_box("rock", stope_c + Vector((0, 0, 6.0)), (7.5, 0.4, 12.4), SR)
    sv = Vector((-SU.y, SU.x, 0))
    for sx in (-1, 1):
        s.col_box("rock", stope_c + sv * sx * 3.5 + Vector((0, 0, 3.0)), (0.4, 6.0, 12.0), SR)
        for se in (-1, 1):
            s.col_box("rock", stope_c + SU * se * 6.1 + sv * sx * 2.2 + Vector((0, 0, 3.0)), (2.6, 6.0, 0.4), SR)
        s.col_box("rock", stope_c + SU * sx * 6.1 + Vector((0, 0, 4.4)), (1.8, 3.2, 0.4), SR)
    # depot chamber and the dead ends
    s.col_box("rock", dc + Vector((0, 0, -0.15)), (5.2, 5.0, 0.3))
    s.col_box("rock", dc + Vector((0, 0, 3.0)), (5.2, 5.0, 0.3))
    for sx in (-1, 1):
        s.col_box("rock", dc + Vector((sx * 2.4, 0, 1.4)), (0.4, 4.6, 2.8))
    s.col_box("rock", dc + Vector((0, -2.6, 1.4)), (5.0, 0.4, 2.8))
    s.col_box("rock", end2 + Vector((-0.5, 0, 1.2)), (1.2, 2.4, 2.6))
    s.col_box("rock", powder[-1] + Vector((0, 0.3, 1.1)), (2.0, 0.4, 2.4))

    # sockets
    s.marker("Arrive_FromPortal", (-1.2, 0.0, 0.05), 90)
    s.marker("Use_Door_Exit", (0.35, 0.0, 1.1), -90)
    s.marker("Log_burke_01", (-30.8, -2.5, 1.4), 0)
    s.marker("Log_miner_diary_2", (pa.x, pa.y - 0.2, 1.2), 0)
    s.marker("Log_miner_diary_3", (end2.x + 2.2, end2.y, 0.1), 90)
    s.marker("Log_burke_note", (-43.0, 1.3, 0.05), 0)
    s.marker("Spot_Owen", (-43.8, 1.6, 0.05), 90)
    s.marker("Loot_IceAxe", (dp.x + 0.9, dp.y + 0.4, 0.65), 0)
    s.marker("Loot_Crampons", (dp.x + 0.9, dp.y + 0.4, 0.4), 0)
    s.marker("Loot_ClimbingRope", (dp.x + 0.2, dp.y - 0.7, 0.15), 0)
    for k in range(4):
        s.marker("Loot_FuelCan_%d" % (k + 1), (dp.x - 0.7 + (k % 2) * 0.38, dp.y - 0.6 + (k // 2) * 0.2, 0.5), 0)
    s.marker("Loot_Powder", (powder[-1].x, powder[-1].y - 0.9, 0.5), 0)
    s.marker("Use_Ladder_Raise", (RX_.x + 0.5, RX_.y, 1.0), -90)
    s.marker("Spot_Stope", (stope_c.x, stope_c.y, 0.1), 0)
    # lights: grey daylight spilling through the door gap, Owen's lantern still glowing faintly
    s.light("Daylight", Vector((0.2, 0.0, 1.9)), (0.7, 0.8, 1.0), 0.6, 9.0, kind="spot", yaw=90, pitch=-20, angle=50,
            group="Lights_Always", attenuation=1.5)
    s.light("DepotLantern", dp + Vector((0.95, 0.45, 0.85)), (1.0, 0.72, 0.42), 0.35, 5.0, group="Lights_Always", shadow=True)
    s.probe("Probe_Mine", Vector((-48, 6, 2.0)), (110, 44, 9), ambient=(0.004, 0.004, 0.005), energy=1.0, intensity=0.3)
    s.shelter("Shelter_Mine", Vector((-48, 6, 0.0)), (110, 44, 6.0), 1.0)
    return s


def build_kit():
    """The tunnel kit as separate pieces (one MeshInstance3D each, 6 m grid, portal faces along -X / +X):
    kit_straight (timbered), kit_straight_rock, kit_bend (90 deg left), kit_junction (T), kit_dead_end,
    kit_stope (chamber with stulls), kit_raise (ladder raise). Laid out 12 m apart along +Y for preview/reuse."""
    s = P.Site("ashford_tunnel_kit", ground=False, interior=True, seed_=61)
    pieces = []

    def piece(name, fn, k):
        off = Vector((0, k * 12.0, 0))
        s.bucket(name, vis_end=220.0)
        fn(name, off)
        pieces.append(name)

    def straight(name, off, timbered=True):
        me, dense = tunnel([off + Vector((3, 0, 0)), off + Vector((-3, 0, 0))], 2.0, 2.45, 11.0 + off.y)
        s.add(me, None, name)
        if timbered:
            for k in range(4):
                s.add(timber_set(off + Vector((2.4 - k * 1.6, 0, 0)), (-1, 0, 0), 1.8, 2.22, seed_=k), None, name)
        s.add(rails([off + Vector((3, 0, 0)), off + Vector((-3, 0, 0))]), None, name)
    piece("kit_straight", lambda n, o: straight(n, o, True), 0)
    piece("kit_straight_rock", lambda n, o: straight(n, o, False), 1)

    def bend(name, off):
        pts = [off + Vector((3, 0, 0))] + [off + Vector((0, 3, 0)) + Vector((3 * math.cos(math.radians(-90 - a)), 0, 0)) * 0 +
                                            Vector((3 * math.sin(math.radians(a)), -3 * math.cos(math.radians(a)), 0)) for a in range(15, 91, 15)]
        pts = [off + Vector((3, 0, 0)), off + Vector((0.0, 0, 0))] + [off + Vector((-3 * math.sin(math.radians(a)), 3 - 3 * math.cos(math.radians(a)), 0)) for a in range(15, 91, 15)]
        me, dense = tunnel(pts, 2.0, 2.45, 12.0 + off.y)
        s.add(me, None, name)
        s.add(rails(pts), None, name)
    piece("kit_bend", bend, 2)

    def junction(name, off):
        me, dense = tunnel([off + Vector((3, 0, 0)), off + Vector((-3, 0, 0))], 2.0, 2.45, 13.0)
        P.remove_faces(me, lambda c, i: c.y < -0.7 and abs(c.x - off.x) < 1.05 and c.z < 2.3)
        br, _d = tunnel([off + Vector((0, 0, 0)), off + Vector((0, -3.5, 0))], 1.9, 2.4, 14.0)
        P.remove_faces(br, lambda c, i: c.y - off.y > -1.0)
        s.add(me, None, name)
        s.add(br, None, name)
    piece("kit_junction", junction, 3)

    def dead_end(name, off):
        me, dense = tunnel([off + Vector((3, 0, 0)), off + Vector((-2.5, 0, 0))], 2.0, 2.45, 15.0)
        s.add(me, None, name)
        s.add(P.blob((0, 0, 0), (1.2, 1.3, 1.4), "rock_cliff", 10, 0.2, 5.0), T(off + Vector((-2.8, 0, 1.1))), name)
        for k in range(8):
            s.add(P.blob((0, 0, 0), (P.rnd(0.2, 0.5),) * 2 + (P.rnd(0.15, 0.3),), "rock_cliff", 7, 0.3, k * 1.7, rings=4),
                  T(off + Vector((P.rnd(-2.4, -1.0), P.rnd(-0.7, 0.7), 0))), name)
    piece("kit_dead_end", dead_end, 4)

    def stope(name, off):
        rings = []
        for k in range(9):
            t = k / 8
            p = off + Vector(((t - 0.5) * 10.0, 0, 0))
            rings.append(tunnel_ring(p, (1, 0, 0), 3.0 + 4.0 * math.sin(math.pi * t) ** 0.7, 2.6 + 3.8 * math.sin(math.pi * t) ** 0.6,
                                     0.35, 21.0 + k * 0.1, 0.08))
        me = P.loft(rings, "rock_cliff", True, True, ROCK_T)
        fi = len(me.f) // 2
        c = sum((me.v[j] for j in me.f[fi]), Vector()) / len(me.f[fi])
        if P.face_normal(me, fi).dot(off + Vector((0, 0, 1.5)) - c) < 0:
            P.flip(me)
        s.add(me, None, name)
        for k in range(5):
            p = off + Vector((-3.2 + k * 1.6, 0.0, 2.0 + (k % 2) * 1.3))
            s.add(rod(p - Vector((0, 3.0, 0)), p + Vector((0, 3.0, 0)), 0.14, "wood_log", 8, cap_mat="wood_endgrain", tint=TIMBER), None, name)
    piece("kit_stope", stope, 5)

    def raise_(name, off):
        straight(name, off, True)
        crib = P.Mesh()
        for k in range(10):
            z = 2.3 + k * 0.3
            for sy in (-1, 1):
                crib.extend(box(1.6, 0.2, 0.2, "wood_log", 'x', tint=TIMBER, end_mat="wood_endgrain").transformed(T(off + Vector((0, sy * 0.7, z)))))
                crib.extend(box(0.2, 1.6, 0.2, "wood_log", 'y', tint=TIMBER, end_mat="wood_endgrain").transformed(T(off + Vector((sy * 0.7, 0, z + 0.15)))))
        s.add(crib, None, name)
        s.add(PR.ladder(5.2, 0.45), T(off + Vector((0.45, 0, 0))) @ RZ(90) @ RX(-6), name)
    piece("kit_raise", raise_, 6)
    s.marker("Arrive_KitPreview", (8.0, 36.0, 0.0), 90)
    s.meta["poi_id"] = "ashford_tunnel_kit"
    return s


def build():
    return [build_exterior(), build_interior(), build_kit()]

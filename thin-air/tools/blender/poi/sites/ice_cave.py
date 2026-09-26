"""Ice cave under the Corrigan Glacier snout (~2,400 m).

ice_cave_entrance - the mouth at the snout: a scalloped blue-ice arch out of the glacier front, moraine boulders,
    the meltwater stream running out over gravel; placed at the layout's cave entrance, facing south (-Y).
ice_cave - the interior (placed at y 800 below its POI, entered via Use_Door_IceCave): a winding ~50 m passage of
    translucent blue ice (poi_ice shader: fake transmitted daylight, strata/bubbles in depth, wet gloss) over a
    rock-and-gravel bed with a meltwater channel and pools, icicles and an ice column, opening into a domed
    chamber where June Park camped (mat, sleeping bag, stove, food bag).
"""
import math

from mathutils import Vector

import plib as P
import props as PR
import arch as AR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube


def ice_ring(p, t, w, h, seed_, noise=0.25):
    """Irregular vaulted ice section (floor points flat): returns (ring points, floor flags)."""
    t = Vector(t).normalized()
    side = Vector((-t.y, t.x, 0)).normalized()
    pts = []
    n = 16
    for k in range(n):
        a = math.pi * k / (n - 1)          # 0 .. pi over the vault
        x = -math.cos(a) * w / 2
        z = math.sin(a) ** 0.8 * h
        q = p + side * x + Vector((0, 0, z))
        d = P.fbm(q, 0.45, 3, seed_) * noise * w * 0.5
        q += (side * (-math.cos(a)) + Vector((0, 0, math.sin(a)))).normalized() * d
        pts.append(q)
    # floor back across (slightly dished)
    for k in range(1, 5):
        u = k / 5
        x = w / 2 - u * w
        pts.append(p + side * x + Vector((0, 0, -0.08 * math.sin(math.pi * u) + 0.03 * P.nz(p + side * x, 1.5, seed_))))
    return pts


def ice_passage(path, widths, heights, seed_, step=0.9):
    pts = [Vector(p) for p in path]
    dense = []
    wd = []
    hd = []
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        n = max(1, int((b - a).length / step))
        for k in range(n):
            dense.append(a.lerp(b, k / n))
            wd.append(P.lerp(widths[i], widths[i + 1], k / n))
            hd.append(P.lerp(heights[i], heights[i + 1], k / n))
    dense.append(pts[-1])
    wd.append(widths[-1])
    hd.append(heights[-1])
    rings = []
    for i, p in enumerate(dense):
        t = dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]
        rings.append(ice_ring(p, t, wd[i], hd[i], seed_ + i * 0.01))
    nv = 16

    def mats(k, i):
        return "ice_cave" if i < nv - 1 else "scree"
    me = P.loft(rings, "ice_cave", True, True, mats=mats)
    fi = 3
    c = sum((me.v[j] for j in me.f[fi]), Vector()) / len(me.f[fi])
    if P.face_normal(me, fi).dot((dense[0] + Vector((0, 0, hd[0] * 0.5))) - c) < 0:
        P.flip(me)
    # glow: brighter where the ice is thin (near the roof, towards the entrance)
    L = len(rings) - 1
    for i, f in enumerate(me.f):
        if me.m[i] != "ice_cave":
            continue
        k = i // (len(rings[0]))
        cz = sum(me.v[j].z for j in f) / len(f)
        g = 0.55 + 0.45 * P.smooth(0.3, 3.0, cz) + 0.25 * (1.0 - k / max(1, L))
        me.t[i] = (g, g, g)
    return me, dense, wd, hd


def build_interior():
    s = P.Site("ice_cave", ground=False, interior=True, seed_=89)
    s.bucket("main", vis_end=0.0)
    s.bucket("detail", vis_end=40.0)
    # Local frame: origin = inside of the mouth transition; the passage winds north (+Y).
    path = [Vector((0, 0, 0)), Vector((0.5, 7, 0.2)), Vector((-2.0, 15, 0.5)), Vector((-1.0, 24, 0.7)), Vector((2.5, 31, 0.9)),
            Vector((3.0, 36, 1.0))]
    widths = [3.6, 3.2, 2.8, 3.4, 3.0, 4.0]
    heights = [3.2, 2.8, 2.5, 3.0, 2.8, 3.6]
    me, dense, wd, hd = ice_passage(path, widths, heights, 1.0)
    s.add(me, None, "main")
    # domed chamber at the end
    cc = Vector((3.5, 42.0, 1.0))
    rings = []
    for k in range(9):
        t = k / 8
        p = cc + Vector((0, (t - 0.5) * 10.0, 0))
        wdt = 3.8 + 5.0 * math.sin(math.pi * t) ** 0.6
        hgt = 3.4 + 2.6 * math.sin(math.pi * t) ** 0.7
        rings.append(ice_ring(p, (0, 1, 0), wdt, hgt, 5.0 + k * 0.1, 0.3))
    nv = 16
    ch = P.loft(rings, "ice_cave", True, True, cap1=True, mats=lambda k, i: "ice_cave" if i < nv - 1 else "scree")
    fi = 3
    c = sum((ch.v[j] for j in ch.f[fi]), Vector()) / len(ch.f[fi])
    if P.face_normal(ch, fi).dot(cc + Vector((0, 0, 2.0)) - c) < 0:
        P.flip(ch)
    for i, f in enumerate(ch.f):
        if ch.m[i] == "ice_cave":
            cz = sum(ch.v[j].z for j in f) / len(f) - cc.z
            g = 0.7 + 0.6 * P.smooth(1.0, 5.0, cz)
            ch.t[i] = (g, g, g)
    s.add(ch, None, "main")
    # meltwater channel + pools, boulders, icicles, an ice column
    chan = []
    for i, p in enumerate(dense):
        t = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        side = Vector((-t.y, t.x, 0))
        off = side * (0.6 * math.sin(i * 0.4))
        chan.append(p + off + Vector((0, 0, 0.01)))
    for a, b in zip(chan, chan[1:]):
        d = b - a
        side = Vector((-d.y, d.x, 0)).normalized() * 0.35
        s.add(P.quad(a - side, a + side, b + side, b - side, "water", flags=P.F_NOAO), None, "main")
    for k, (p, r) in enumerate(((cc + Vector((2.2, 2.0, 0.02)), 1.2), (Vector((-1.5, 17.0, 0.55)), 0.7))):
        pool = P.heightpatch(r * 2, r * 1.4, 0.3, lambda x, y: 0.0, "water", flags=P.F_NOAO)
        P.remove_faces(pool, lambda c, i, r=r: (c.x / r) ** 2 + (c.y / (r * 0.7)) ** 2 > 1.0)
        s.add(pool, T(p), "main")
    for k in range(14):
        i = P._rng.randrange(len(dense))
        p = dense[i] + Vector((P.rnd(-1.0, 1.0), P.rnd(-0.5, 0.5), 0))
        s.add(P.blob((0, 0, 0), (P.rnd(0.15, 0.5), P.rnd(0.15, 0.45), P.rnd(0.1, 0.3)), "rock", 7, 0.3, k * 1.3, rings=4), T(p), "detail")
    for k in range(45):
        i = P._rng.randrange(len(dense))
        p = dense[i] + Vector((P.rnd(-0.8, 0.8), P.rnd(-0.4, 0.4), hd[i] * 0.93))
        L = P.rnd(0.1, 0.8)
        s.add(cyl(0.02 + L * 0.06, L, "ice_cave", 5, r2=0.003, caps=False, tint=(1.1, 1.1, 1.1)), T(p) @ RX(180), "detail")
    col = lathe([(0.0, 0.0), (0.45, 0.0), (0.3, 0.6), (0.18, 1.4), (0.14, 2.2), (0.2, 3.0), (0.4, 3.6), (0.0, 3.8)], "ice_cave", 12,
                tint=(1.2, 1.2, 1.2))
    col.displace(lambda p: Vector((0.05 * P.nz(p, 2.0, 1.0), 0.05 * P.nz(p, 2.0, 2.0), 0)))
    s.add(col, T(cc + Vector((-3.0, 1.5, -0.05))), "main")
    s.col_box("ice", cc + Vector((-3.0, 1.5, 1.8)), (0.6, 0.6, 3.6))
    # June's camp
    J = cc + Vector((1.5, -1.0, 0.0))
    s.add(box(0.55, 1.85, 0.02, "plastic", 'y', tint=(0.6, 0.5, 0.1)), T(J + Vector((0, 0, 0.02))) @ RZ(18), "main")
    bag = box(0.7, 1.9, 0.2, "nylon", 'y', seg=0.25, tint=(0.12, 0.35, 0.7))
    bag.displace(lambda p: Vector((0, 0, 0.06 * P.nz(p, 3.0, 4.0) if p.z > 0 else 0)))
    s.add(bag, T(J + Vector((0.05, 0.1, 0.13))) @ RZ(18), "main")
    s.add(PR.stove_canister(), T(J + Vector((0.8, 0.9, 0.0))), "main")
    s.add(PR.duffel(0.45, 0.13, "nylon", (0.6, 0.1, 0.05)), T(J + Vector((-0.7, 0.8, 0.0))) @ RZ(40), "main")
    s.add(PR.backpack((0.15, 0.2, 0.25)), T(J + Vector((-0.6, -0.9, 0.0))) @ RZ(-30) @ RX(-10), "main")
    for k in range(3):
        s.add(cyl(0.035, 0.18, "metal_bare", 8, tint=(0.8, 0.8, 0.8) if k else (0.7, 0.1, 0.1)), T(J + Vector((1.0 + k * 0.1, 1.2, 0.0))), "detail")
    # collision: floor + walls + vault along the passage, chamber boxes
    for a, b, w, h in zip(dense, dense[1:], wd, hd):
        d = b - a
        L = d.length
        c = (a + b) / 2
        Rm = P.look_basis(Vector((d.x, d.y, 0)), (0, 0, 1))
        s.col_box("rock", c + Vector((0, 0, -0.15)), (w, 0.3, L + 0.4), Rm)
        s.col_box("ice", c + Vector((0, 0, h + 0.1)), (w, 0.3, L + 0.4), Rm)
        side = Vector((-d.y, d.x, 0)).normalized()
        for sx in (-1, 1):
            s.col_box("ice", c + side * sx * (w / 2 - 0.1) + Vector((0, 0, h / 2)), (0.3, h, L + 0.2), Rm)
    s.col_box("rock", cc + Vector((0, 0, -0.15)), (9.0, 10.0, 0.3))
    s.col_box("ice", cc + Vector((0, 0, 6.2)), (9.0, 10.0, 0.3))
    for sx in (-1, 1):
        s.col_box("ice", cc + Vector((sx * 4.6, 0, 3.0)), (0.3, 10.0, 6.0))
    s.col_box("ice", cc + Vector((0, 5.1, 3.0)), (9.0, 0.3, 6.0))
    for sx in (-1, 1):
        s.col_box("ice", cc + Vector((sx * 2.9, -5.0, 3.0)), (2.6, 0.3, 6.0))
    s.col_box("ice", Vector((0, -0.6, 1.6)), (3.8, 0.3, 3.4))
    s.marker("Arrive_FromEntrance", (0.0, 1.2, 0.05), 0)
    s.marker("Use_Door_Exit", (0.0, 0.2, 1.1), 180)
    s.marker("Log_park_02", J + Vector((0.4, -0.9, 0.05)), 18)
    s.marker("Loot_Camp", J + Vector((-0.7, 0.8, 0.3)), 0)
    s.marker("Loot_Stove", J + Vector((0.8, 0.9, 0.2)), 0)
    s.marker("Spot_Chamber", cc, 0)
    s.light("IceGlow", cc + Vector((0, 0, 3.8)), (0.45, 0.75, 1.0), 0.7, 11.0, group="Lights_Always")
    s.light("PassageGlow", Vector((0, 12.0, 2.3)), (0.45, 0.75, 1.0), 0.45, 9.0, group="Lights_Always")
    s.probe("Probe_Cave", Vector((1.5, 24.0, 2.5)), (14, 54, 8), ambient=(0.02, 0.04, 0.06), intensity=0.6)
    s.shelter("Shelter_Cave", Vector((1.5, 24.0, 0.0)), (14, 54, 6), 0.9)
    return s


def build_entrance():
    s = P.Site("ice_cave_entrance", seed_=97)
    s.bucket("main", vis_end=1200.0)
    s.bucket("detail", vis_end=90.0)
    G = P.Ground("ice_cave", at=(172.0, -470.0))
    # arch: an ice passage stub from the snout outward (mouth at y = -3.5) running 7 m into the slope
    z0 = G.h(0, -3.0)
    path = [Vector((0, -3.8, z0)), Vector((0, 0.0, z0 + 0.1)), Vector((0.3, 6.0, z0 + 0.3))]
    me, dense, wd, hd = ice_passage(path, [4.4, 3.8, 3.4], [3.6, 3.2, 3.0], 12.0, 0.8)
    s.add(me, None, "main")
    # glacier front around the mouth: big scalloped ice slabs rising into the slope
    for k in range(9):
        a = math.radians(-80 + k * 20)
        c = Vector((math.sin(a) * 4.2, -3.2 + abs(math.sin(a)) * 1.4, z0 + 2.4 + math.cos(a) * 2.2))
        blob = P.blob((0, 0, 0), (P.rnd(1.6, 2.6), P.rnd(1.4, 2.0), P.rnd(1.6, 2.4)), "ice_cave", 12, 0.25, k * 3.3, rings=7, flat_bottom=False)
        blob.set_tint((0.8, 0.8, 0.8))
        s.add(blob, T(c) @ RZ(P.rnd(0, 360)), "main")
    # moraine boulders, gravel apron, the meltwater stream
    for k in range(16):
        x, y = P.rnd(-7, 7), P.rnd(-10, -3)
        s.add(P.blob((0, 0, 0), (P.rnd(0.3, 1.1), P.rnd(0.3, 0.9), P.rnd(0.2, 0.7)), "rock", 8, 0.3, k * 1.9, rings=5), T(x, y, G.h(x, y) - 0.1), "main")
    s.add(P.heightpatch(8.0, 7.0, 0.5, lambda x, y: G.h(x, y - 6.5) + 0.03, "scree", smooth_=True), T(0, -6.5, 0), "main")
    for a, b in zip(dense, dense[1:]):
        pass
    stream = [Vector((0.2, 3.0, z0 + 0.06)), Vector((0.0, -3.5, z0 + 0.03))] + [Vector((0.6 * math.sin(k), -3.5 - k * 1.2, 0)) for k in range(1, 8)]
    for i in range(2, len(stream)):
        stream[i].z = G.h(stream[i].x, stream[i].y) + 0.04
    for a, b in zip(stream, stream[1:]):
        d = b - a
        side = Vector((-d.y, d.x, 0)).normalized() * 0.4
        s.add(P.quad(a - side, a + side, b + side, b - side, "water", flags=P.F_NOAO), None, "main")
    # the note weighted with a stone at the mouth
    s.add(box(0.21, 0.3, 0.004, "decal", flags=P.F_NOAO), T(-1.2, -4.2, G.h(-1.2, -4.2) + 0.02) @ RZ(20), "detail")
    s.add(P.blob((0, 0, 0), (0.12, 0.1, 0.07), "rock", 6, 0.3, 2.0, rings=3), T(-1.15, -4.15, G.h(-1.2, -4.2) + 0.05), "detail")
    for a, b, w, h in zip(dense, dense[1:], wd, hd):
        d = b - a
        L = d.length
        c = (a + b) / 2
        Rm = P.look_basis(Vector((d.x, d.y, 0)), (0, 0, 1))
        s.col_box("rock", c + Vector((0, 0, -0.15)), (w, 0.3, L + 0.4), Rm)
        s.col_box("ice", c + Vector((0, 0, h + 0.1)), (w, 0.3, L + 0.4), Rm)
        side = Vector((-d.y, d.x, 0)).normalized()
        for sx in (-1, 1):
            s.col_box("ice", c + side * sx * (w / 2 - 0.1) + Vector((0, 0, h / 2)), (0.3, h, L + 0.2), Rm)
    s.col_box("ice", Vector((0.3, 6.2, z0 + 1.6)), (3.6, 0.4, 3.2))
    s.marker("Arrive_Default", (0.5, -9.0, G.h(0.5, -9.0)), 0)
    s.marker("Arrive_FromIceCave", (0.0, -2.5, z0 + 0.05), 180)
    s.marker("Use_Door_IceCave", (0.2, 5.4, z0 + 1.2), 0)
    s.marker("Log_park_03", (-1.2, -4.2, G.h(-1.2, -4.2) + 0.05), 20)
    s.shelter("Shelter_Mouth", Vector((0.1, 1.5, z0)), (3.4, 7.0, 3.0), 0.6)
    return s


def build():
    return [build_interior(), build_entrance()]

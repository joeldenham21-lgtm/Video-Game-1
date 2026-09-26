"""Crash site: DHC-3 Otter C-FKTL, forced landing in the western valley meadow (~1,480 m).

The Otter came in from the south-east along the meadow, clipped spruce tops on the approach, touched down hard,
lost the left main gear, dug in, broke its back behind the wing and slewed. The forward fuselage (cockpit + cabin)
lies on its crushed belly, nose down in the turf with the engine pushed up and left and the prop blades curled;
the right wing tore off at the root and lies upside down beside the trail; the left wing is still attached but its
outer panel folded down at the broken lift strut, the tip in the grass. The tail section lies on its side behind
the break. Belly tanks ruptured: avgas sheen in the furrow. Cargo spilled from the open break.

Aircraft frame "A": x forward (nose +x), y left, z up; fuselage datum z = 0 (belly -1.0, roof +1.0).
"""
import math

from mathutils import Matrix, Vector

import plib as P
import props as PR
from plib import T, RX, RY, RZ, box, cyl, lathe, rod, tube, loft

WHITE = (1.0, 1.0, 1.0)
RED = (0.5, 0.045, 0.035)
GREYB = (0.8, 0.8, 0.78)
INNER = (0.42, 0.47, 0.38)     # zinc-chromate green interior

SIDE_F = [0.0, 0.18, 0.36, 0.40, 0.43, 0.64, 0.93, 1.0]   # fractional side stations (stripes, windows)
WIN_F = (0.64, 0.93)                                        # window band (fraction of the side)
CABIN_WINDOWS = [(2.75, 3.25), (1.95, 2.45), (1.15, 1.65), (0.35, 0.85)]
COCKPIT_WINDOW = (3.72, 4.28)
AFT_WINDOWS = [(-1.25, -1.75)]


def sec(x):
    """(half width, bottom z, top z, corner radius) of the fuselage at station x."""
    if x >= 3.6:
        t = min(1.0, (x - 3.6) / 1.3)
        hw = P.lerp(0.82, 0.70, t)
        zb = P.lerp(-1.0, -0.62, P.smooth(0, 1, t))
        zt = P.lerp(1.0, 0.76, min(1.0, (x - 3.6) / 0.95))
        rc = P.lerp(0.28, 0.33, t)
    elif x >= -1.0:
        hw, zb, zt, rc = 0.82, -1.0, 1.0, 0.28
    else:
        t = min(1.0, (-1.0 - x) / 5.4)
        hw = P.lerp(0.82, 0.1, t ** 0.9)
        zb = P.lerp(-1.0, 0.28, t ** 0.85)
        zt = P.lerp(1.0, 0.78, t)
        rc = P.lerp(0.28, 0.07, t)
    return hw, zb, zt, rc


def ring(x, inset=0.0):
    hw, zb, zt, rc = sec(x)
    hw -= inset
    zb += inset
    zt -= inset
    rc = max(0.02, rc - inset)
    pts = []
    # bottom (centre -> +y)
    for f in (0.0, 0.5):
        pts.append((f * (hw - rc), zb))
    # bottom-left corner
    for k in range(4):
        a = -math.pi / 2 + (k / 3) * math.pi / 2
        pts.append((hw - rc + rc * math.cos(a), zb + rc + rc * math.sin(a)))
    # left side up (fractional stations, skipping the ends already on the arcs)
    s0, s1 = zb + rc, zt - rc
    for f in SIDE_F[1:-1]:
        pts.append((hw, s0 + (s1 - s0) * f))
    for k in range(4):
        a = (k / 3) * math.pi / 2
        pts.append((hw - rc + rc * math.cos(a), zt - rc + rc * math.sin(a)))
    for f in (0.5, 0.0, -0.5):
        pts.append((f * (hw - rc), zt))
    for k in range(4):
        a = math.pi / 2 + (k / 3) * math.pi / 2
        pts.append((-(hw - rc) + rc * math.cos(a), zt - rc + rc * math.sin(a)))
    for f in reversed(SIDE_F[1:-1]):
        pts.append((-hw, s0 + (s1 - s0) * f))
    for k in range(4):
        a = math.pi + (k / 3) * math.pi / 2
        pts.append((-(hw - rc) + rc * math.cos(a), zb + rc + rc * math.sin(a)))
    pts.append((-0.5 * (hw - rc), zb))
    return [Vector((x, y, z)) for y, z in pts]


def side_frac(p):
    hw, zb, zt, rc = sec(p.x)
    s0, s1 = zb + rc, zt - rc
    return (p.z - s0) / max(1e-6, s1 - s0)


def in_window(c, windows, inner=False):
    hw = sec(c.x)[0]
    if abs(c.y) < hw - 0.08:
        return False
    f = side_frac(c)
    if not (WIN_F[0] - 0.01 < f < WIN_F[1] + 0.01):
        return False
    return any(min(a, b) < c.x < max(a, b) for a, b in windows)


def livery(c):
    """Paint of a skin face by its centre (A frame)."""
    hw, zb, zt, rc = sec(c.x)
    if c.x > 4.9:
        return RED
    if abs(c.y) > hw - 0.05:
        f = side_frac(c)
        if 0.18 < f < 0.36 or 0.40 < f < 0.43:
            return RED
    if c.z < zb + 0.02:
        return GREYB
    return WHITE


def xs_between(a, b, step, extra=()):
    xs = set()
    n = max(1, int(abs(b - a) / step))
    for k in range(n + 1):
        xs.add(round(a + (b - a) * k / n, 4))
    for e in extra:
        if min(a, b) <= e <= max(a, b):
            xs.add(round(e, 4))
    return sorted(xs)


def skin(xs, jag_first=None, jag_last=None, seed_=0.0, crumple=None):
    """Outer + inner skin between the given stations, windows cut, torn ends jagged (A frame)."""
    rings_o = []
    rings_i = []
    for k, x in enumerate(xs):
        ro = ring(x)
        ri = ring(x, 0.045)
        jag = None
        if k == 0 and jag_first is not None:
            jag = jag_first
        if k == len(xs) - 1 and jag_last is not None:
            jag = jag_last
        if jag is not None:
            for i in range(len(ro)):
                d = jag * (0.55 * P.nz((i * 0.61, seed_, 0.3), 1.0) + 0.45 * math.sin(i * 2.3 + seed_))
                ro[i].x += d
                ri[i].x += d
        rings_o.append(ro)
        rings_i.append(ri)
    wins = CABIN_WINDOWS + [COCKPIT_WINDOW] + AFT_WINDOWS

    def tint_o(k, i):
        c = (rings_o[k][i] + rings_o[k + 1][(i + 1) % len(rings_o[k])]) * 0.5
        return livery(c)

    outer = loft(rings_o, "metal_aircraft", True, False, tints=tint_o, jitter=0.0)
    inner = loft(rings_i, "paint_metal", True, False, tint=INNER, jitter=0.0)
    P.flip(inner)
    # orientation: outer faces must point away from the axis
    fi = len(outer.f) // 3
    c = sum((outer.v[j] for j in outer.f[fi]), Vector()) / len(outer.f[fi])
    if P.face_normal(outer, fi).dot(Vector((0, c.y, c.z))) < 0:
        P.flip(outer)
        P.flip(inner)
    P.remove_faces(outer, lambda c, i: in_window(c, wins))
    P.remove_faces(inner, lambda c, i: in_window(c, wins, True))
    # torn edge: connect outer and inner at the jagged ends
    edge = P.Mesh()
    for k, jag in ((0, jag_first), (len(xs) - 1, jag_last)):
        if jag is None:
            continue
        ro, ri = rings_o[k], rings_i[k]
        n = len(ro)
        for i in range(n):
            q = [ro[i], ro[(i + 1) % n], ri[(i + 1) % n], ri[i]]
            ids = [edge.vert(p) for p in q]
            edge.face(ids if k else ids[::-1], [(0, 0), (0.1, 0), (0.1, 0.05), (0, 0.05)], "metal_bare", False)
    me = P.merge(outer, inner, edge)
    if crumple:
        me.displace(crumple)
    # window glass + frames
    for a, b in wins:
        if not (min(xs) < min(a, b) and max(a, b) < max(xs)):
            continue
        for side in (1, -1):
            if (a, b) == (0.35, 0.85) and side == -1:
                continue            # this one shattered on impact
            x0, x1 = min(a, b), max(a, b)
            hw = sec((x0 + x1) / 2)[0]
            _hw, zb, zt, rc = sec((x0 + x1) / 2)
            s0, s1 = zb + rc, zt - rc
            z0 = s0 + (s1 - s0) * WIN_F[0]
            z1 = s0 + (s1 - s0) * WIN_F[1]
            y = side * (hw - 0.02)
            g = P.quad((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1), "glass", flags=P.F_NOAO | P.F_NOEXP)
            if side < 0:
                P.flip(g)
            me.extend(g)
    return me


def crumple_nose(p):
    if p.x < 3.3:
        return Vector((0, 0, 0))
    k = P.smooth(3.3, 4.9, p.x)
    n = P.fbm(p, 2.3, 3, 4.0)
    return Vector((-0.12 * k * (1 + n), 0.05 * k * n, (0.09 * n - 0.04) * k * (1.0 if p.z < 0 else 0.5)))


def airfoil(c, t, n=9, sym=False):
    """Clark-Y-ish section: list of (x, z) around, LE at x = 0, TE at x = -c."""
    up = []
    lo = []
    for k in range(n + 1):
        s = k / n
        x = (1 - math.cos(s * math.pi)) / 2
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        camber = 0.0 if sym else 0.035 * math.sin(math.pi * x) * (1 - x * 0.3)
        up.append((-x * c, (camber + yt) * c))
        lo.append((-x * c, (camber - yt * (0.35 if not sym else 1.0)) * c))
    pts = up[::-1] + lo[1:-1]
    return pts


def wing_panel(y0, y1, chord=1.98, t=0.16, seg=0.9, tip_red=False, cap0=True, cap1=True, stations=None):
    """Wing panel along +y from y0 to y1 (A-frame orientation, LE at x = 0)."""
    af = airfoil(chord, t)
    ys = stations or [y0 + (y1 - y0) * k / max(1, int(abs(y1 - y0) / seg)) for k in range(int(abs(y1 - y0) / seg) + 1)]
    rings = [[Vector((x, y, z)) for x, z in af] for y in ys]

    def tints(k, i):
        yy = (ys[k] + ys[k + 1]) / 2
        return RED if tip_red and yy > 7.9 else WHITE
    me = loft(rings, "metal_aircraft", True, False, tints=tints, cap0=cap0, cap1=cap1, jitter=0.0)
    fi = 1
    if P.face_normal(me, fi).z < 0:
        P.flip(me)
    return me


def strut(p0, p1, w=0.11, t=0.045):
    return P.strip_tube([p0, p1], t, w, "metal_aircraft", tint=GREYB)


def blade(bend=0.0, twist=18.0, length=1.6, seed_=0.0):
    """Prop blade along +z from the hub (r 0.18 -> length), chord in x-y plane; bent back (-x) by `bend`."""
    rings = []
    rs = [0.18, 0.35, 0.55, 0.75, 0.95, 1.15, 1.35, 1.52, length]
    for r in rs:
        ch = 0.26 * (1 - 0.35 * (r / length) ** 2)
        th = 0.05 * (1 - 0.7 * r / length) + 0.012
        tw = math.radians(twist * (1 - r / length) + 12)
        pts = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            u = math.cos(a) * ch / 2
            v = math.sin(a) * th / 2
            pts.append(Vector((u * math.sin(tw) + v * math.cos(tw), u * math.cos(tw) - v * math.sin(tw), r)))
        b = max(0.0, r - 0.55)
        off = Vector((-bend * b * b * 1.3, bend * 0.25 * b * b, -bend * 0.35 * b * b))
        rings.append([p + off for p in pts])
    me = loft(rings, "metal_bare", True, True, cap1=True, tint=(0.35, 0.36, 0.37), jitter=0.0)
    # yellow tips (1.4 m on)
    for i, f in enumerate(me.f):
        c = sum((me.v[j] for j in f), Vector()) / len(f)
        if c.z > 1.4 + (-0.35 * bend * 1.0):
            me.t[i] = (0.75, 0.55, 0.05)
    return me


def engine(site, W, bucket):
    """Radial engine, torn cowling, prop (A frame, thrust line z = 0.1)."""
    zc = 0.1
    E = W @ T(0, 0, zc)
    # cowling: upper 230 deg, crumpled, pushed up/left
    cow = cyl(0.68, 1.0, "metal_aircraft", 22, caps=False, a0=-20, arc=230, vseg=3, tint=RED, smooth_=True)
    cow.extend(cyl(0.66, 0.08, "metal_aircraft", 22, r2=0.54, caps=False, a0=-20, arc=230, tint=RED).transformed(T(0, 0, 1.0)))
    cow.displace(lambda p: Vector((0.05 * P.nz(p, 3.0, 2.0), 0.05 * P.nz(p, 3.0, 5.0), 0.06 * P.nz(p, 2.0, 9.0))))
    inner = cyl(0.66, 1.0, "metal_dark", 22, caps=False, a0=-20, arc=230, vseg=1, tint=(0.4, 0.4, 0.4))
    P.flip(inner)
    cow.extend(inner)
    Mc = E @ T(4.88, 0.05, 0.08) @ RZ(6) @ RY(90) @ RX(8)
    site.add(cow, Mc, bucket)
    # crankcase + 9 finned cylinders
    eng = lathe([(0.0, 0.0), (0.3, 0.0), (0.34, 0.12), (0.3, 0.38), (0.22, 0.46), (0.12, 0.62), (0.0, 0.64)],
                "metal_dark", 16, tint=(0.5, 0.5, 0.5))
    for k in range(9):
        a = 2 * math.pi * k / 9 + 0.2
        cy = cyl(0.075, 0.34, "metal_dark", 8, tint=(0.45, 0.45, 0.45))
        for f in range(5):
            cy.extend(cyl(0.1, 0.012, "metal_dark", 8, tint=(0.4, 0.4, 0.4)).transformed(T(0, 0, 0.05 + f * 0.055)))
        cy.extend(cyl(0.06, 0.1, "metal_dark", 8, tint=(0.3, 0.3, 0.3)).transformed(T(0, 0, 0.34)))
        eng.extend(cy.transformed(T(0, 0, 0.22) @ RZ(math.degrees(a)) @ RY(90) @ T(0, 0, 0.2)))
    # exhaust collector
    pts = [Vector((0.5 * math.cos(2 * math.pi * k / 12), 0.5 * math.sin(2 * math.pi * k / 12), 0.05)) for k in range(10)]
    eng.extend(tube(pts, 0.035, "metal_rusty", 6))
    site.add(eng, E @ T(4.95, 0.04, 0.08) @ RZ(5) @ RY(90) @ RX(10), bucket)
    # prop hub + blades: one blade dug into the turf (curled back hard), two bent back
    hub = lathe([(0.0, -0.1), (0.16, -0.1), (0.2, 0.0), (0.18, 0.18), (0.12, 0.28), (0.0, 0.32)], "metal_bare", 12,
                tint=(0.5, 0.5, 0.52))
    ph = RZ(0)
    for k, bend in enumerate((0.95, 0.35, 0.55)):
        a = 200 + k * 120
        hub.extend(blade(bend, seed_=k).transformed(RZ(0) @ RX(0) @ RY(0) @ Matrix.Rotation(math.radians(a), 4, 'Z')
                                                    @ RX(-90)))
    site.add(hub, E @ T(6.02, 0.1, 0.12) @ RZ(8) @ RY(90) @ RX(6), bucket)


def wheel(r=0.4, w=0.24):
    tire = lathe([(0.17, -w / 2), (0.32, -w / 2), (r - 0.02, -w * 0.42), (r, -w * 0.2), (r, w * 0.2),
                  (r - 0.02, w * 0.42), (0.32, w / 2), (0.17, w / 2)], "rubber", 18)
    tire.extend(lathe([(0.0, -0.08), (0.18, -0.09), (0.18, 0.09), (0.0, 0.08)], "paint_metal", 12, tint=(0.8, 0.8, 0.8)))
    return tire


def spruce_top(length, r, seed_):
    """A snapped-off spruce top lying on the ground: tapering trunk + drooping branch whorls (bark only;
    needles mostly stripped by the impact) with the splintered break at z = 0 end."""
    P.seed(seed_)
    me = cyl(r, length, "bark_spruce", 8, r2=0.01, caps=False)
    me.extend(PR.splinter_top(r, seed_=seed_ * 0.1).transformed(RX(180)))
    z = 0.4
    while z < length - 0.3:
        rr = r * (1 - z / length)
        for k in range(4):
            a = P.rnd(0, 360)
            L = 0.25 + 1.1 * (1 - z / length) * P.rnd(0.7, 1.1)
            d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), -0.35))
            p0 = Vector((0, 0, z))
            me.extend(rod(p0, p0 + d.normalized() * L, max(0.008, rr * 0.25), "bark_dead", 4, caps=False))
        z += P.rnd(0.35, 0.55)
    return me


def build():
    s = P.Site("crash_site", seed_=17)
    s.bucket("main", vis_end=900.0)
    s.bucket("detail", vis_end=90.0)
    s.bucket("interior", vis_end=35.0, shadow=True)
    s.bucket("ground", vis_end=220.0, shadow=False)
    G = P.Ground("crash_site")

    # --- forward fuselage -----------------------------------------------------------------------------------
    yaw = 152.0
    Wf = T(1.5, 1.0, 0.78) @ RZ(yaw) @ RY(4.0) @ RX(-4.5)
    wins = CABIN_WINDOWS + [COCKPIT_WINDOW]
    edges = [w for ab in wins for w in ab]
    xs = xs_between(0.1, 4.9, 0.3, edges + [3.6, 4.55])
    fwd = skin(xs, jag_first=0.2, seed_=1.3, crumple=crumple_nose)
    # firewall cap (behind the engine) and buckled floor
    fw = [p for p in ring(4.9, 0.0)]
    cap = P.Mesh()
    ids = [cap.vert(p) for p in fw]
    cap.face(ids, [(p.y, p.z) for p in fw], "metal_dark", False, (0.35, 0.35, 0.35))
    cap.displace(crumple_nose)
    if P.face_normal(cap, 0).x < 0:
        P.flip(cap)
    s.add(fwd, Wf, "main")
    s.add(cap, Wf, "main")
    floor = P.heightpatch(4.6, 1.5, 0.3, lambda x, y: 0.05 * P.nz((x, y, 0), 1.3, 2.0) + 0.04 * max(0, -x - 1.6),
                          "metal_bare", tint=(0.55, 0.55, 0.55), smooth_=False, cx=2.2)
    s.add(floor, Wf @ T(0, 0, -0.93), "interior")
    # windscreen: two panes, right one shattered (a jagged remnant)
    for side in (1, -1):
        hw4, zb4, zt4, rc4 = sec(4.5)
        p0 = Vector((4.52, side * 0.05, 0.8))
        p1 = Vector((4.52, side * (hw4 - 0.12), 0.78))
        p2 = Vector((3.64, side * (0.62), 0.97))
        p3 = Vector((3.64, side * 0.05, 0.99))
        g = P.quad(p0, p1, p2, p3, "glass", flags=P.F_NOAO | P.F_NOEXP)
        if side < 0:
            P.flip(g)
            g = P.quad(p0, p0.lerp(p1, 0.6), p0.lerp(p2, 0.35), p0.lerp(p3, 0.5), "glass", flags=P.F_NOAO | P.F_NOEXP)
            P.flip(g)
        g.displace(crumple_nose)
        s.add(g, Wf, "main")
    s.add(box(0.9, 0.05, 0.05, "paint_metal", 'x', tint=(0.2, 0.2, 0.2)).transformed(
        T(4.08, 0, 0.9) @ RY(-20)), Wf, "main")
    # roof skin over the windscreen frame / cabin roof panel between windscreen and wing
    # (wing sits on the roof from x 1.32 to 3.3)

    # --- engine + prop --------------------------------------------------------------------------------------
    engine(s, Wf, "main")

    # --- wings ------------------------------------------------------------------------------------------------
    wing_z = 1.0
    LE = 3.3
    # left wing: inner panel fixed, outer panel folded down at the broken strut station
    inner_l = wing_panel(0.82, 3.4, stations=[0.82, 1.7, 2.6, 3.4], cap0=True, cap1=False)
    s.add(inner_l, Wf @ T(LE, 0, wing_z), "main")
    outer_l = wing_panel(3.4, 8.85, stations=[3.4, 4.3, 5.2, 6.1, 7.0, 7.9, 8.4, 8.85], tip_red=True, cap0=False)
    outer_l.displace(lambda p: Vector((0, 0, 0.04 * P.nz(p, 1.5, 7.0) * P.smooth(3.4, 4.2, p.y))))
    hinge = Wf @ T(LE, 3.4, wing_z) @ RX(-27) @ RZ(-4) @ T(-LE, -3.4, -wing_z)
    s.add(outer_l, hinge @ T(LE, 0, wing_z), "main")
    # torn skin at the fold
    for k in range(5):
        fr = P.quad((0, 0, 0), (0.35, 0, 0), (0.3, 0.25, 0.05), (0.02, 0.3, 0.08), "metal_aircraft",
                    flags=0, two_sided=True)
        s.add(fr, Wf @ T(LE - 0.2 - k * 0.38, 3.35, wing_z + 0.12) @ RX(-35 - k * 7) @ RZ(k * 9), "detail")
    # left strut: buckled in two
    a0 = Vector((2.3, 0.8, -0.72))
    a1 = Vector((2.35, 3.35, wing_z - 0.05))
    mid = a0.lerp(a1, 0.55) + Vector((-0.25, 0.1, -0.35))
    s.add(strut(a0, mid), Wf, "main")
    s.add(strut(mid + Vector((0.05, 0.05, 0.02)), mid + Vector((0.2, 0.95, 0.5))), Wf, "main")
    # right wing root stub (torn at the root) + stub of the strut
    stub = wing_panel(-1.3, -0.82, stations=[-1.3, -0.82], cap0=False, cap1=True)
    stub.displace(lambda p: Vector((0, 0.12 * P.nz(p, 5.0, 3.0) if p.y < -1.0 else 0, 0)))
    s.add(stub, Wf @ T(LE, 0, wing_z), "main")
    s.add(strut(Vector((2.3, -0.8, -0.72)), Vector((2.1, -1.7, -0.5))), Wf, "main")
    # detached right wing, upside down beside the trail, root torn, strut still hanging on it
    Wr = T(-9.5, 6.5, 0.0) @ RZ(58) @ RX(180) @ RY(-3)
    rw = wing_panel(-8.85, -1.2, stations=[-8.85, -8.4, -7.9, -7.0, -6.1, -5.2, -4.3, -3.4, -2.5, -1.2],
                    tip_red=False)
    for i, f in enumerate(rw.f):
        c = sum((rw.v[j] for j in f), Vector()) / len(f)
        if c.y < -7.9:
            rw.t[i] = RED
    rw.displace(lambda p: Vector((0, 0.18 * P.nz(p, 4.0, 1.0) * P.smooth(-2.2, -1.2, p.y), 0.05 * P.nz(p, 2.0, 4.0))))
    lo, hi = rw.transformed(Wr).bounds()
    Wr = T(0, 0, -lo.z - 0.04) @ Wr
    s.add(rw, Wr, "main")
    s.add(strut(Vector((-0.9, -3.4, -0.05)), Vector((-1.2, -1.4, -1.9))), Wr, "main")
    s.add(PR.decal("otter_wing_reg", 2.4, 0.6).transformed(T(-0.95, -5.6, 0.0) @ RX(-90) @ RZ(90)),
          Wr @ T(0, 0, -0.105), "detail")
    # ribs sticking out of the torn root
    for k in range(4):
        rib = box(0.02, 0.4, 0.18, "metal_bare", tint=(0.6, 0.6, 0.6))
        s.add(rib, Wr @ T(-0.3 - k * 0.45, -1.1, 0.05) @ RX(P.rnd(-20, 20)), "detail")
    s.col_box("metal", Wr @ Vector((-1.0, -5.0, 0.05)), (1.9, 7.6, 0.26), Wr)

    # --- tail section: broken off, lying on its right side behind the break ----------------------------------
    edges_a = [w for ab in AFT_WINDOWS for w in ab]
    xs_a = xs_between(-6.4, -0.25, 0.35, edges_a)
    aft = skin(xs_a, jag_last=0.22, seed_=4.1)
    fin_poly = [(-4.7, 0.9), (-5.9, 2.55), (-6.55, 2.6), (-6.7, 0.85), (-6.3, 0.72)]
    fin = P.slab(fin_poly, 0.1, "metal_aircraft", tint=WHITE, jitter=0.0)
    for i, f in enumerate(fin.f):
        c = sum((fin.v[j] for j in f), Vector()) / len(f)
        if c.z > 1.7:
            fin.t[i] = RED
    aft.extend(fin.transformed(T(0, -0.05, 0) @ RX(0)))
    aft.extend(P.slab([(-3.2, 0.95), (-4.8, 1.25), (-4.8, 0.9)], 0.06, "metal_aircraft", tint=WHITE).transformed(T(0, -0.03, 0)))
    for sy in (1, -1):
        hs = wing_panel(0, 3.1, chord=1.25, t=0.1, stations=[0.0, 0.8, 1.6, 2.4, 3.1])
        if sy < 0:
            hs = hs.transformed(P.S(1, -1, 1))
        aft.extend(hs.transformed(T(-5.15, sy * 0.1, 0.62)))
    tw = wheel(0.16, 0.1)
    aft.extend(tw.transformed(T(-5.9, 0, 0.1) @ RX(90)))
    aft.extend(rod((-5.6, 0, 0.35), (-5.9, 0, 0.1), 0.03, "metal_dark"))
    for sy in (1, -1):
        reg = PR.decal("reg_cfktl", 2.2, 0.43).transformed(T(-3.0, sy * 0.001, 0.0) @ RZ(0 if sy < 0 else 180))
        hw = sec(-3.0)[0]
        aft.extend(reg.transformed(T(0, sy * (hw + 0.012) - sy * 0.001, 0.12)))
    Wa = T(-3.4, -2.2, 0.0) @ RZ(yaw + 32) @ RX(-21) @ RY(3)
    lo, hi = aft.transformed(Wa).bounds()
    Wa = T(0, 0, -lo.z - 0.12) @ Wa
    s.add(aft, Wa, "main")
    for x0 in (-0.9, -2.4, -3.9):
        s.col_box("metal", Wa @ Vector((x0, 0, 0.15)), (1.5, 1.3, 1.6), Wa)

    # registration on the forward fuselage sides is aft of the break (on the tail section); forward: stencils
    s.add(PR.decal("otter_exit", 0.5, 0.12).transformed(T(0.5, -0.83, 0.1) @ RZ(0)), Wf, "detail")

    # --- interior: cockpit ---------------------------------------------------------------------------------------
    I = Wf
    for sy, tilt in ((0.38, 0), (-0.38, 9)):
        seat = P.Mesh()
        seat.extend(box(0.46, 0.46, 0.1, "leather", 'x', seg=0.2).transformed(T(0, 0, 0.45)))
        seat.extend(box(0.1, 0.46, 0.62, "leather", 'z', seg=0.2).transformed(T(-0.24, 0, 0.8) @ RY(-12)))
        for dx in (-0.18, 0.18):
            for dy in (-0.18, 0.18):
                seat.extend(rod((dx, dy, 0.0), (dx, dy, 0.4), 0.015, "metal_bare"))
        seat.displace(lambda p: Vector((0, 0, 0.02 * P.nz(p, 6.0))))
        s.add(seat, I @ T(3.72, sy, -0.95) @ RY(tilt), "interior")
        s.col_box("metal", I @ Vector((3.72, sy, -0.5)), (0.5, 0.5, 0.2), I)
    # instrument panel + glare shield + control column with two wheels
    pnl = box(0.12, 1.3, 0.42, "paint_metal", 'y', tint=(0.12, 0.12, 0.12))
    s.add(pnl, I @ T(4.42, 0, 0.3) @ RY(-12), "interior")
    s.add(PR.decal("otter_panel", 1.2, 0.5, "decal").transformed(RZ(90)), I @ T(4.355, 0, 0.3) @ RY(-12) @ T(-0.001, 0, 0),
          "interior")
    s.add(box(0.35, 1.36, 0.04, "leather", 'y', tint=(0.3, 0.3, 0.3)), I @ T(4.36, 0, 0.55) @ RY(10), "interior")
    col = rod((4.3, 0, -0.9), (4.1, 0, 0.0), 0.035, "paint_metal", tint=(0.1, 0.1, 0.1))
    col.extend(rod((4.1, 0.38, 0.05), (4.1, -0.38, 0.05), 0.025, "paint_metal", tint=(0.1, 0.1, 0.1)))
    for sy in (0.38, -0.38):
        pts = [Vector((4.02, sy + 0.16 * math.cos(math.radians(a)), 0.1 + 0.12 * math.sin(math.radians(a))))
               for a in range(200, 341, 20)]
        col.extend(tube(pts, 0.016, "paint_metal", 6, tint=(0.08, 0.08, 0.08)))
        col.extend(rod((4.1, sy, 0.05), (4.02, sy, 0.1), 0.02, "paint_metal", tint=(0.1, 0.1, 0.1)))
    s.add(col, I, "interior")
    # overhead throttle quadrant (Otter levers are in the roof)
    oq = box(0.35, 0.18, 0.08, "paint_metal", tint=(0.1, 0.1, 0.1))
    for k, tt in enumerate(((0.1, 0.1, 0.1), (0.35, 0.05, 0.03), (0.05, 0.1, 0.35))):
        oq.extend(rod((0.0, -0.05 + k * 0.05, -0.04), (0.06, -0.05 + k * 0.05, -0.16), 0.008, "metal_bare"))
        oq.extend(box(0.04, 0.03, 0.03, "plastic", tint=tt).transformed(T(0.06, -0.05 + k * 0.05, -0.17)))
    s.add(oq, I @ T(3.95, 0, 0.93), "interior")
    # hand mic on its coiled cord hanging from the panel
    mic = box(0.05, 0.03, 0.08, "plastic", tint=(0.05, 0.05, 0.05)).transformed(T(4.2, -0.12, -0.35))
    cord = [Vector((4.35, -0.05 + 0.02 * math.sin(k * 1.9), 0.1 - k * 0.035)) for k in range(12)]
    cord[-1] = Vector((4.2, -0.12, -0.31))
    mic.extend(tube(cord, 0.006, "rubber", 4))
    s.add(mic, I, "interior")
    # --- interior: cabin (fold-down canvas bench, cargo, first-aid kit, loose gear) ------------------------------
    bench = P.Mesh()
    for x in (0.6, 1.4, 2.2, 3.0):
        bench.extend(rod((x, 0.72, -0.5), (x, 0.4, -0.5), 0.014, "metal_bare"))
        bench.extend(rod((x, 0.4, -0.5), (x, 0.4, -0.92), 0.014, "metal_bare"))
    bench.extend(rod((0.4, 0.4, -0.5), (3.2, 0.4, -0.5), 0.014, "metal_bare"))
    bench.extend(box(2.8, 0.34, 0.012, "canvas", 'x', seg=0.4, tint=(0.4, 0.42, 0.3)).transformed(T(1.8, 0.56, -0.49)))
    bench.extend(box(2.8, 0.012, 0.45, "canvas", 'x', seg=0.4, tint=(0.4, 0.42, 0.3)).transformed(T(1.8, 0.75, -0.25)))
    s.add(bench, I, "interior")
    s.add(PR.first_aid(), I @ T(2.6, -0.72, -0.1) @ RZ(90) @ RX(0), "interior")
    cargo = P.Mesh()
    cargo.extend(PR.crate(0.8, 0.6, 0.55, stencil="stencil_kestrel").transformed(T(2.5, -0.35, -0.92) @ RZ(8)))
    cargo.extend(PR.crate(0.6, 0.5, 0.45).transformed(T(2.45, -0.3, -0.37) @ RZ(-14) @ RY(6)))
    cargo.extend(PR.crate(0.7, 0.5, 0.5, lid=False).transformed(T(1.4, -0.4, -0.92) @ RZ(28) @ RX(4)))
    cargo.extend(PR.hard_case(0.62, 0.42, 0.24).transformed(T(0.8, 0.1, -0.9) @ RZ(-35)))
    cargo.extend(PR.duffel(0.95, 0.2, "canvas", (0.6, 0.62, 0.5)).transformed(T(1.1, 0.45, -0.92) @ RZ(80)))
    cargo.extend(PR.jerrycan((0.45, 0.05, 0.03)).transformed(T(3.1, -0.55, -0.92) @ RZ(20)))
    cargo.extend(PR.toolbox().transformed(T(0.35, -0.5, -0.92) @ RZ(-50)))
    # cargo net strap hanging loose
    cargo.extend(tube([(3.2, 0.7, 0.6), (2.9, 0.3, 0.1), (2.7, -0.2, -0.3), (2.3, -0.55, -0.6)], 0.012, "rope", 5))
    s.add(cargo, I, "interior")
    s.col_box("wood", I @ Vector((2.5, -0.35, -0.64)), (0.85, 0.65, 0.56), I @ RZ(8))
    s.col_box("wood", I @ Vector((1.4, -0.4, -0.67)), (0.75, 0.55, 0.5), I @ RZ(28))
    # --- fuselage collision (A frame boxes) ---------------------------------------------------------------------
    for c, sz in (((2.4, 0, -0.98), (5.0, 1.64, 0.12)),        # floor
                  ((2.5, 0.81, 0), (4.8, 0.06, 2.0)),           # left wall
                  ((2.5, -0.81, 0), (4.8, 0.06, 2.0)),          # right wall
                  ((2.4, 0, 1.02), (5.0, 1.64, 0.1)),           # roof
                  ((4.75, 0, -0.1), (0.5, 1.5, 1.8)),           # firewall / panel
                  ((5.45, 0, 0.1), (1.2, 1.35, 1.35))):         # engine
        s.col_box("metal", Wf @ Vector(c), sz, Wf)
    s.col_box("metal", Wf @ Vector((2.3, 0, 1.18)), (1.98, 1.8, 0.3), Wf)                       # wing centre
    s.col_box("metal", Wf @ Vector((2.3, 2.1, 1.18)), (1.98, 2.6, 0.3), Wf)
    s.col_box("metal", hinge @ Vector((2.3, 6.1, 1.18)), (1.98, 5.4, 0.3), hinge)

    # --- ground: gouge, berms, turf clods, fuel sheen -------------------------------------------------------------
    tr_dir = Vector((math.cos(math.radians(yaw + 180 + 8)), math.sin(math.radians(yaw + 180 + 8)), 0))
    side = Vector((-tr_dir.y, tr_dir.x, 0))
    # main furrow behind the fuselage, curving (plane slewed), ~26 m long
    path = []
    for k in range(14):
        t_ = k / 13
        p = Vector((1.5, 1.0, 0)) + tr_dir * (1.0 + 26.0 * t_) + side * (2.5 * t_ * t_)
        path.append(p)
    fur = P.Mesh()
    for k in range(len(path) - 1):
        a, b = path[k], path[k + 1]
        w = 1.6 - 0.9 * k / 13
        for j in range(4):
            u0, u1 = -1 + j / 2.0, -1 + (j + 1) / 2.0
            prof = lambda u: (-0.12 * (1 - u * u) if abs(u) < 1 else 0) + (0.08 if 0.7 < abs(u) <= 1.0 else 0)
            qa = [a + side * (u0 * w), a + side * (u1 * w)]
            qb = [b + side * (u1 * w), b + side * (u0 * w)]
            pts = [qa[0] + Vector((0, 0, prof(u0) + G.h(qa[0].x, qa[0].y))), qa[1] + Vector((0, 0, prof(u1) + G.h(qa[1].x, qa[1].y))),
                   qb[0] + Vector((0, 0, prof(u1) + G.h(qb[0].x, qb[0].y))), qb[1] + Vector((0, 0, prof(u0) + G.h(qb[1].x, qb[1].y)))]
            ids = [fur.vert(p + Vector((0, 0, 0.03))) for p in pts]
            fur.face(ids, [(p.x, p.y) for p in pts], "dirt", True)
    s.add(fur, None, "ground")
    # spoil berms and turf clods
    P.seed(5)
    for k in range(34):
        t_ = P.rnd(0.02, 1.0)
        p = Vector((1.5, 1.0, 0)) + tr_dir * (1.0 + 26.0 * t_) + side * (2.5 * t_ * t_ + P.rnd(-2.6, 2.6))
        sz = P.rnd(0.18, 0.5) * (1.4 - t_ * 0.6)
        mat = "dirt" if P.rnd() < 0.55 else "grass_t"
        s.add(P.blob((0, 0, 0), (sz, sz * P.rnd(0.6, 1.0), sz * 0.45), mat, 7, 0.3, k * 1.7, rings=4),
              T(p.x, p.y, G.h(p.x, p.y)) @ RZ(P.rnd(0, 360)), "ground")
    # berm heaped against the crushed nose
    nose = Wf @ Vector((5.6, 0, -0.8))
    s.add(P.blob((0, 0, 0), (1.3, 0.9, 0.45), "dirt", 12, 0.25, 3.0, rings=6), T(nose.x, nose.y, 0.0) @ RZ(yaw), "ground")
    brk = Wf @ Vector((0.0, 0.0, -1.0))
    # avgas sheen on the standing water in the furrow and under the break
    for k, (off, r) in enumerate(((0.0, 1.6), (3.5, 1.1), (6.5, 0.9))):
        c = Vector((brk.x, brk.y, 0)) + tr_dir * (1.0 + off)
        sheen = P.heightpatch(r * 2.2, r * 1.4, 0.35, lambda x, y: 0.0, "fuel_sheen", flags=P.F_NOAO | P.F_EXP,
                              smooth_=False)
        P.remove_faces(sheen, lambda c_, i, r=r: (c_.x / (r * 1.1)) ** 2 + (c_.y / (r * 0.7)) ** 2 > 1.0 + 0.3 * P.nz(c_, 1.7, k))
        s.add(sheen, T(c.x, c.y, G.h(c.x, c.y) - 0.05) @ RZ(math.degrees(math.atan2(tr_dir.y, tr_dir.x))), "detail")

    # --- debris trail ------------------------------------------------------------------------------------------
    P.seed(23)
    deb = P.Mesh()
    along = lambda d, o=0.0: Vector((1.5, 1.0, 0)) + tr_dir * d + side * o
    # left main gear: leg + wheel, torn off at touchdown (far end of the trail)
    gp = along(24.0, 1.8)
    gear = wheel().transformed(T(0, 0, 0.4) @ RX(90))
    gear.extend(tube([(0, 0.12, 0.4), (0.3, 0.3, 0.9), (0.4, 0.35, 1.35)], 0.05, "paint_metal", 8, tint=(0.2, 0.2, 0.2)))
    gear.extend(PR.splinter_top(0.05, "metal_bare", 0.08).transformed(T(0.4, 0.35, 1.35)))
    s.add(gear, T(gp.x, gp.y, G.h(gp.x, gp.y) - 0.05) @ RZ(35) @ RY(62) @ T(0, 0, 0), "main")
    s.col_box("metal", (gp.x, gp.y, G.h(gp.x, gp.y) + 0.25), (0.9, 0.9, 0.5))
    # right gear folded under the fuselage
    s.add(wheel().transformed(T(0, 0, 0) @ RX(90) @ RZ(0)), Wf @ T(3.1, -1.05, -0.78) @ RZ(-15) @ RX(-25), "main")
    # lower cowling panel, crumpled
    cp = cyl(0.68, 0.9, "metal_aircraft", 12, caps=False, a0=200, arc=130, tint=RED, smooth_=True)
    cp.displace(lambda p: Vector((0.08 * P.nz(p, 3, 1), 0.08 * P.nz(p, 3, 2), 0.1 * P.nz(p, 2, 3))))
    back = cyl(0.66, 0.9, "metal_dark", 12, caps=False, a0=200, arc=130, tint=(0.4, 0.4, 0.4))
    back.displace(lambda p: Vector((0.08 * P.nz(p, 3, 1), 0.08 * P.nz(p, 3, 2), 0.1 * P.nz(p, 2, 3))))
    P.flip(back)
    cp.extend(back)
    q = along(9.0, -2.2)
    s.add(cp, T(q.x, q.y, G.h(q.x, q.y) + 0.62) @ RZ(70) @ RY(95), "main")
    # pilot door torn off
    door = box(1.0, 0.04, 1.0, "metal_aircraft", 'x', seg=0.35)
    door.extend(P.quad((-0.3, -0.03, 0.05), (0.3, -0.03, 0.05), (0.3, -0.03, 0.4), (-0.3, -0.03, 0.4), "glass",
                       flags=P.F_NOAO | P.F_NOEXP))
    door.displace(lambda p: Vector((0, 0.05 * P.nz(p, 2.5, 8.0), 0)))
    q = along(14.0, 2.6)
    s.add(door, T(q.x, q.y, G.h(q.x, q.y) + 0.06) @ RZ(20) @ RX(86), "main")
    s.col_box("metal", (q.x, q.y, G.h(q.x, q.y) + 0.06), (1.0, 1.0, 0.1), RZ(20))
    # skin fragments, fairings, a seat cushion, spilled cargo along the trail
    for k in range(22):
        d = P.rnd(3.0, 30.0)
        q = along(d, P.rnd(-4.5, 4.5))
        w_ = P.rnd(0.15, 0.6)
        frag = P.quad((0, 0, 0), (w_, 0, 0), (w_ * 0.8, w_ * P.rnd(0.4, 0.9), 0), (0.05, w_ * 0.6, 0),
                      "metal_aircraft", tint=RED if P.rnd() < 0.3 else WHITE, two_sided=True)
        frag.displace(lambda p: Vector((0, 0, 0.06 * P.nz(p, 5.0, k))))
        deb.extend(frag.transformed(T(q.x, q.y, G.h(q.x, q.y) + 0.03) @ RZ(P.rnd(0, 360)) @ RX(P.rnd(-25, 25))))
    for k in range(6):
        q = along(P.rnd(4.0, 20.0), P.rnd(-3.0, 3.0))
        deb.extend(box(P.rnd(0.02, 0.05), P.rnd(0.4, 1.1), 0.02, "metal_bare").transformed(
            T(q.x, q.y, G.h(q.x, q.y) + 0.02) @ RZ(P.rnd(0, 360))))
    q = along(6.0, 3.0)
    deb.extend(PR.crate(0.7, 0.5, 0.5, lid=False, tint=(0.95, 0.95, 0.95)).transformed(T(q.x, q.y, G.h(q.x, q.y) - 0.03) @ RZ(40) @ RY(-12)))
    s.col_box("wood", (q.x, q.y, G.h(q.x, q.y) + 0.22), (0.72, 0.52, 0.5), RZ(40))
    q = along(4.2, -1.4)
    deb.extend(PR.duffel(0.9, 0.22, "nylon", (0.2, 0.3, 0.6)).transformed(T(q.x, q.y, G.h(q.x, q.y)) @ RZ(-20)))
    q = along(11.0, -1.0)
    bp = along(11.0, -1.0)
    deb.extend(PR.backpack().transformed(T(q.x, q.y, G.h(q.x, q.y) + 0.05) @ RZ(120) @ RX(-80)))
    q = along(2.4, 1.6)
    deb.extend(PR.crate(0.6, 0.45, 0.4).transformed(T(q.x, q.y, G.h(q.x, q.y) - 0.02) @ RZ(-65) @ RX(8)))
    s.col_box("wood", (q.x, q.y, G.h(q.x, q.y) + 0.2), (0.62, 0.47, 0.4), RZ(-65))
    q = along(7.5, 0.8)
    deb.extend(PR.jerrycan((0.1, 0.25, 0.1)).transformed(T(q.x, q.y, G.h(q.x, q.y) + 0.08) @ RZ(10) @ RY(88)))
    s.add(deb, None, "detail")

    # --- the approach: spruce tops snapped by the wing (lying in the meadow) + splintered snags -------------------
    for k, (d, o, L, r) in enumerate(((31.0, -1.5, 5.5, 0.11), (35.0, 2.2, 4.2, 0.09), (38.5, -3.0, 6.0, 0.12),
                                      (27.5, 3.8, 3.0, 0.07))):
        q = along(d, o)
        top = spruce_top(L, r, 40 + k)
        s.add(top, T(q.x, q.y, G.h(q.x, q.y) + r * 0.8) @ RZ(math.degrees(math.atan2(-tr_dir.y, -tr_dir.x)) + P.rnd(-40, 40))
              @ RY(88) , "main")
    for k, (d, o, H, r) in enumerate(((42.0, -4.5, 7.5, 0.2), (44.0, 3.2, 9.0, 0.24), (47.0, -1.0, 6.0, 0.18))):
        q = along(d, o)
        snag = cyl(r, H, "bark_spruce", 9, r2=r * 0.7, caps=False)
        snag.extend(PR.splinter_top(r * 0.7, "wood_fresh", 0.6, seed_=k + 0.3).transformed(T(0, 0, H)))
        s.add(snag, T(q.x, q.y, G.h(q.x, q.y) - 0.3), "main")
        s.col_box("wood", (q.x, q.y, G.h(q.x, q.y) + H / 2), (r * 1.6, r * 1.6, H))

    # --- sockets ------------------------------------------------------------------------------------------------
    def A(x, y, z):
        return Wf @ Vector((x, y, z))
    ay = yaw - 90.0      # Godot yaw of the aircraft's nose (+x) direction
    s.marker("Arrive_Wake", A(1.6, 0.2, -0.9), ay + 0)
    s.marker("Arrive_Default", A(-2.0, 0.0, -0.9), ay + 180)
    s.marker("Spot_Dale", A(3.72, 0.38, -0.4), ay)
    s.marker("Use_Radio", A(4.33, -0.1, 0.25), ay + 180)
    s.marker("Log_dale_logbook", A(3.9, 0.74, -0.55), ay)
    s.marker("Loot_FirstAid", A(2.6, -0.66, -0.0), ay)
    s.marker("Loot_SurvivalManual", A(3.45, -0.38, -0.45), ay)
    s.marker("Loot_FlareGun", A(4.2, -0.5, -0.6), ay)
    s.marker("Loot_EmergencyBlanket", A(1.8, 0.5, -0.46), ay)
    s.marker("Loot_Hatchet", A(3.05, -0.55, -0.4), ay)
    s.marker("Loot_Scanner", A(0.8, 0.1, -0.62), ay)
    s.marker("Loot_Cargo_1", A(2.5, -0.35, -0.3), ay)
    s.marker("Loot_Cargo_2", A(1.4, -0.4, -0.45), ay)
    bpp = Vector((bp.x, bp.y, G.h(bp.x, bp.y) + 0.2))
    s.marker("Loot_Backpack", bpp, 0)
    q = along(6.0, 3.0)
    s.marker("Loot_Crate_Trail", Vector((q.x, q.y, G.h(q.x, q.y) + 0.5)), 0)
    s.marker("Scan_Engine", A(5.4, 0.0, 0.1), ay)
    s.marker("Scan_Wing", Wr @ Vector((-1.0, -5.0, 0.2)), 0)
    fp = Vector((4.5, -4.5, 0.0))
    s.marker("Spot_Campfire", Vector((fp.x, fp.y, G.h(fp.x, fp.y))), 0)
    # the cabin keeps some of the weather off
    ctr = A(2.0, 0, -0.95)
    s.shelter("Shelter_Cabin", ctr, (3.8, 1.5, 1.8), 0.6, yaw=yaw)
    s.probe("Probe_Cabin", A(2.3, 0, 0.0), (4.6, 4.6, 2.2), ambient=(0.09, 0.095, 0.1), energy=1.0)
    return [s]

"""Architecture helpers for the story locations: walls with openings, windows, doors, stairs, railings, roofs,
log walls, lattice masts. Blender space (Z up). Functions return plib.Mesh (and collision boxes where noted as
lists of (center Vector, size Vector) in the same local frame)."""
import math

from mathutils import Vector

import plib as P
from plib import box, cyl, rod, tube, T, RX, RY, RZ


def wall(L, H, t, openings=(), mat_out="paint_metal", mat_in=None, tint_out=(1, 1, 1), tint_in=(1, 1, 1),
         seg=1.2, reveal_mat=None, flags_out=0, flags_in=P.F_NOEXP, uvo=None):
    """Wall along +X (0..L), z 0..H, thickness t centred on y = 0; outer face towards -Y, inner towards +Y.
    openings: [(x0, x1, z0, z1), ...]. Returns (mesh, cols)."""
    mat_in = mat_in or mat_out
    reveal_mat = reveal_mat or mat_in
    xs = {0.0, L}
    zs = {0.0, H}
    for x0, x1, z0, z1 in openings:
        xs.update((x0, x1))
        zs.update((z0, z1))
    # subdivide for AO resolution
    def refine(vals, step):
        vals = sorted(vals)
        out = [vals[0]]
        for a, b in zip(vals, vals[1:]):
            n = max(1, int(math.ceil((b - a) / step - 1e-6)))
            for k in range(1, n + 1):
                out.append(a + (b - a) * k / n)
        return out
    xs = refine(xs, seg)
    zs = refine(zs, seg)

    def inside(cx, cz):
        return any(x0 < cx < x1 and z0 < cz < z1 for x0, x1, z0, z1 in openings)
    me = P.Mesh()
    if uvo is None:
        uvo = (P.rnd(0, 4), P.rnd(0, 4))
    for side, y, mat, tint, fl in ((-1, -t / 2, mat_out, tint_out, flags_out), (1, t / 2, mat_in, tint_in, flags_in)):
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                cx = (xs[i] + xs[i + 1]) / 2
                cz = (zs[j] + zs[j + 1]) / 2
                if inside(cx, cz):
                    continue
                q = [(xs[i], y, zs[j]), (xs[i + 1], y, zs[j]), (xs[i + 1], y, zs[j + 1]), (xs[i], y, zs[j + 1])]
                ids = [me.vert(p) for p in q]
                uvs = [(p[0] * -side + uvo[0], p[2] + uvo[1]) for p in q]
                if side > 0:
                    ids.reverse()
                    uvs.reverse()
                me.face(ids, uvs, mat, False, tint, fl)
    # reveals (jambs, sill, head) inside every opening
    for x0, x1, z0, z1 in openings:
        for a, b, n in (((x0, z0), (x0, z1), (1, 0)), ((x1, z1), (x1, z0), (-1, 0)), ((x1, z0), (x0, z0), (0, 1)),
                        ((x0, z1), (x1, z1), (0, -1))):
            q = [(a[0], -t / 2, a[1]), (b[0], -t / 2, b[1]), (b[0], t / 2, b[1]), (a[0], t / 2, a[1])]
            ids = [me.vert(p) for p in q]
            ln = math.hypot(b[0] - a[0], b[1] - a[1])
            me.face(ids, [(0, 0), (ln, 0), (ln, t), (0, t)], reveal_mat, False, tint_in, 0)
            fn = P.face_normal(me, len(me.f) - 1)
            if fn.x * n[0] + fn.z * n[1] < 0:
                me.f[-1].reverse()
                me.uv[-1].reverse()
    # top & ends
    for q in ([(0, -t / 2, H), (L, -t / 2, H), (L, t / 2, H), (0, t / 2, H)],):
        ids = [me.vert(p) for p in q]
        me.face(ids, [(p[0], p[1]) for p in q], mat_out, False, tint_out, 0)
    # collision: vertical strips between openings (full height where no opening)
    cols = []
    xs2 = sorted({0.0, L} | {o[0] for o in openings} | {o[1] for o in openings})
    for a, b in zip(xs2, xs2[1:]):
        cx = (a + b) / 2
        holes = [o for o in openings if o[0] < cx < o[1]]
        zz = [0.0]
        for o in sorted(holes, key=lambda o: o[2]):
            zz += [o[2], o[3]]
        zz.append(H)
        for k in range(0, len(zz), 2):
            z0, z1 = zz[k], zz[k + 1]
            if z1 - z0 > 0.05:
                cols.append((Vector((cx, 0, (z0 + z1) / 2)), Vector((b - a, t, z1 - z0))))
    return me, cols


def window(w, h, depth=0.12, frame="paint_metal", frame_tint=(0.9, 0.9, 0.88), glass="glass", bars=0, fw=0.05,
           sill=True):
    """Window unit filling an opening w x h, centred on x, bottom at z = 0, in a wall of `depth` (y)."""
    me = P.Mesh()
    for (cx, cz, sx, sz) in ((0, fw / 2, w, fw), (0, h - fw / 2, w, fw), (-w / 2 + fw / 2, h / 2, fw, h),
                             (w / 2 - fw / 2, h / 2, fw, h)):
        me.extend(box(sx, 0.06, sz, frame, 'x' if sx > sz else 'z', tint=frame_tint).transformed(T(cx, 0, cz)))
    for k in range(bars):
        x = -w / 2 + w * (k + 1) / (bars + 1)
        me.extend(box(0.03, 0.05, h - fw, frame, 'z', tint=frame_tint).transformed(T(x, 0, h / 2)))
    g = P.quad((-w / 2 + fw, 0, fw), (w / 2 - fw, 0, fw), (w / 2 - fw, 0, h - fw), (-w / 2 + fw, 0, h - fw), glass,
               flags=P.F_NOAO | P.F_NOEXP)
    me.extend(g)
    if sill:
        me.extend(box(w + 0.08, depth * 0.5 + 0.06, 0.03, frame, 'x', tint=frame_tint).transformed(T(0, -depth * 0.25 - 0.03, -0.015)))
    return me


def door_leaf(w=0.9, h=2.0, t=0.06, mat="paint_metal", tint=(1, 1, 1), handle_side=1, window_=False):
    me = box(w, t, h, mat, 'z', tint=tint, seg=0.5).transformed(T(0, 0, h / 2))
    hx = handle_side * (w / 2 - 0.09)
    for sy in (-1, 1):
        me.extend(rod((hx, sy * t / 2, h * 0.47), (hx, sy * (t / 2 + 0.05), h * 0.47), 0.012, "metal_bare"))
        me.extend(rod((hx, sy * (t / 2 + 0.05), h * 0.47), (hx - handle_side * 0.12, sy * (t / 2 + 0.05), h * 0.47),
                      0.012, "metal_bare"))
    if window_:
        me.extend(P.quad((-0.15, -t / 2 - 0.003, h * 0.62), (0.15, -t / 2 - 0.003, h * 0.62), (0.15, -t / 2 - 0.003, h * 0.85),
                         (-0.15, -t / 2 - 0.003, h * 0.85), "glass", flags=P.F_NOAO | P.F_NOEXP))
    return me


def stair(width, rise, run, mat="galvanized", tread_t=0.04, stringer_mat=None, tint=(1, 1, 1), open_=True):
    """Straight stair climbing along +Y from (0,0,0) to (0, run, rise), centred on x. Returns (mesh, ramp col)."""
    n = max(2, int(round(rise / 0.19)))
    me = P.Mesh()
    sm = stringer_mat or mat
    L = math.hypot(run, rise)
    ang = math.degrees(math.atan2(rise, run))
    for sx in (-1, 1):
        me.extend(box(0.05, L + 0.2, 0.22, sm, 'y', tint=tint).transformed(
            T(sx * (width / 2 + 0.025), run / 2, rise / 2) @ RX(ang)))
    for k in range(n):
        z = rise * (k + 1) / n - tread_t / 2
        y = run * (k + 0.5) / n
        me.extend(box(width, run / n + 0.03, tread_t, mat, 'x', tint=tint).transformed(T(0, y, z)))
        if not open_:
            me.extend(box(width, 0.02, rise / n, mat, 'x', tint=tint).transformed(T(0, run * k / n, rise * (k + 0.5) / n)))
    col = (Vector((0, run / 2, rise / 2 - 0.06)), Vector((width, L, 0.12)), RX(ang))
    return me, col


def railing(pts, h=1.0, mat="galvanized", r=0.022, posts_every=1.2, tint=(1, 1, 1), mid=True):
    me = P.Mesh()
    pts = [Vector(p) for p in pts]
    top = [p + Vector((0, 0, h)) for p in pts]
    me.extend(tube(top, r, mat, 6, tint=tint))
    if mid:
        me.extend(tube([p + Vector((0, 0, h * 0.5)) for p in pts], r * 0.8, mat, 6, tint=tint))
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.ceil((b - a).length / posts_every)))
        for k in range(n + 1):
            if k == n and b is not pts[-1]:
                continue
            p = a.lerp(b, k / n)
            me.extend(rod(p, p + Vector((0, 0, h)), r * 1.1, mat, 6, tint=tint))
    return me


def gable_roof(L, W, pitch_deg, over=0.4, t=0.12, mat="metal_corrugated", fascia="wood_planks", tint=(1, 1, 1),
               ridge_axis='x', uvo=None, under_mat=None):
    """Two sloped slabs over a W (y) x L (x) footprint whose eaves sit at z = 0; ridge along X at the centre.
    Returns (mesh, ridge height)."""
    me = P.Mesh()
    half = W / 2 + over
    rise = (W / 2) * math.tan(math.radians(pitch_deg))
    slope_len = half / math.cos(math.radians(pitch_deg))
    for sy in (-1, 1):
        slab = box(L + 2 * over, slope_len, t, mat, 'y', seg=1.5, tint=tint,
                   mats={'-z': under_mat} if under_mat else None)
        ang = -sy * pitch_deg
        cy = sy * half / 2
        cz = rise - (half / 2) * math.tan(math.radians(pitch_deg)) + t / 2
        me.extend(slab.transformed(T(0, cy, cz - over * 0 ) @ RX(ang)))
        me.extend(box(L + 2 * over, 0.03, 0.18, fascia, 'x').transformed(
            T(0, sy * (half - 0.0), rise - half * math.tan(math.radians(pitch_deg)) - 0.05)))
    return me, rise


def log_course(L, r, mat="wood_log", ext=0.25, seed_=0, taper=0.0):
    """One horizontal log along +X from -ext to L + ext, axis at z = 0 (UV U around, V along)."""
    P.seed(seed_)
    me = cyl(r, L + 2 * ext, mat, 10, r2=r * (1 - taper), cap_mat="wood_endgrain", a0=P.rnd(0, 36))
    me.displace(lambda p: Vector((P.nz(p, 1.3, seed_) * 0.01, P.nz(p, 1.1, seed_ + 3) * 0.01, 0)))
    return me.transformed(T(-ext, 0, 0) @ RY(90))


def log_wall(L, H, r=0.14, openings=(), seed_=0, ext=0.25, mat="wood_log", chink=True, z_start=None):
    """Stacked logs along +X (0..L), courses every ~1.75 r from z = r. Logs are split around openings
    (x0, x1, z0, z1). Returns (mesh, cols)."""
    me = P.Mesh()
    step = r * 1.78
    z = r if z_start is None else z_start
    k = 0
    while z < H:
        segs = [(0.0, L, ext, ext)]
        for x0, x1, z0, z1 in openings:
            if z0 - r * 0.5 < z < z1 + r * 0.5:
                new = []
                for a, b, ea, eb in segs:
                    if x1 <= a or x0 >= b:
                        new.append((a, b, ea, eb))
                        continue
                    if x0 > a:
                        new.append((a, x0, ea, 0.0))
                    if x1 < b:
                        new.append((x1, b, 0.0, eb))
                segs = new
        for a, b, ea, eb in segs:
            ln = b - a
            if ln < 0.15:
                continue
            # logs run past the corners (ea / eb) where they notch over the crossing wall
            lg = log_course(ln + ea + eb, r, mat, 0.0, seed_ * 97 + k * 3 + int(a * 10))
            me.extend(lg.transformed(T(a - ea, 0, z)))
        if chink:
            for a, b, ea, eb in segs:
                if b - a > 0.2:
                    me.extend(box(b - a, r * 0.9, 0.05, "concrete", 'x', tint=(0.75, 0.7, 0.62)).transformed(
                        T((a + b) / 2, 0, z + r * 0.9)))
        z += step
        k += 1
    cols = wall(L, H, r * 1.6, openings)[1]
    return me, cols


def lattice_mast(h, w, mat="galvanized", leg_r=0.03, brace_r=0.012, bay=1.0, legs=3, tint=(1, 1, 1), taper=1.0):
    """Triangular (or square) lattice tower centred on the origin: legs + zig-zag bracing + rungs."""
    me = P.Mesh()
    R = w / math.sqrt(3) if legs == 3 else w / math.sqrt(2)

    def leg_pt(i, z):
        a = 2 * math.pi * i / legs + (math.pi / 2 if legs == 3 else math.pi / 4)
        rr = R * P.lerp(1.0, taper, z / h)
        return Vector((math.cos(a) * rr, math.sin(a) * rr, z))
    for i in range(legs):
        me.extend(rod(leg_pt(i, 0), leg_pt(i, h), leg_r, mat, 6, tint=tint))
    nb = max(1, int(round(h / bay)))
    for k in range(nb):
        z0 = h * k / nb
        z1 = h * (k + 1) / nb
        for i in range(legs):
            j = (i + 1) % legs
            me.extend(rod(leg_pt(i, z0), leg_pt(j, z1), brace_r, mat, 4, tint=tint, caps=False))
            me.extend(rod(leg_pt(i, z1), leg_pt(j, z1), brace_r, mat, 4, tint=tint, caps=False))
    return me


def guy(p0, p1, sag=0.03, r=0.005, n=6, mat="metal_bare"):
    p0 = Vector(p0)
    p1 = Vector(p1)
    pts = []
    for k in range(n + 1):
        t = k / n
        p = p0.lerp(p1, t)
        p.z -= sag * (p1 - p0).length * 4 * t * (1 - t)
        pts.append(p)
    return tube(pts, r, mat, 4, smooth_=True)

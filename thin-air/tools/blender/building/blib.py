"""THIN AIR building pieces: geometry library (Blender 4.0, headless).

Everything is authored in GODOT coordinates (Y up, -Z forward, metres) into a `Soup` (polygon soup with
per-corner normal / UV / UV2 / colour), converted to Blender (x, -z, y) only when a mesh object is made.

Vertex attributes (read by src/building/shaders/building.gdshaderinc):
  UV   metres: U around a log (arc length) / across a board, V along the grain.  Endgrain faces: 0..1 disc.
  UV2  (seed_u, seed_v): a per-part random offset for bark patches / grain variation.
  COLOR r = ambient occlusion (analytic), g = build step 0..1 (order parts appear while a frame is filled),
        b = bark density (log) / weathering (boards), a = surface flag: 0 wood, 0.5 endgrain, 1 chinking.
"""
import math
import random

import bpy
from mathutils import Vector, Matrix

FLAG_WOOD = 0.0
FLAG_END = 0.5
FLAG_CHINK = 1.0


def V(x, y=None, z=None):
    if y is None:
        return Vector(x)
    return Vector((x, y, z))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def vnoise1(x, seed):
    """Smooth 1D value noise in [-1, 1]."""
    i = math.floor(x)
    f = x - i
    def h(n):
        r = random.Random((int(n) * 73856093) ^ (seed * 19349663))
        return r.uniform(-1.0, 1.0)
    u = f * f * (3.0 - 2.0 * f)
    return lerp(h(i), h(i + 1), u)


class Corner:
    __slots__ = ("p", "n", "uv", "uv2", "col")

    def __init__(self, p, n, uv, uv2, col):
        self.p = p
        self.n = n
        self.uv = uv
        self.uv2 = uv2
        self.col = col


class Soup:
    """Polygon soup. faces: list of (corners, material_name)."""

    def __init__(self):
        self.faces = []

    def add(self, corners, mat):
        if len(corners) >= 3:
            self.faces.append((corners, mat))

    def extend(self, other, xf=None):
        for corners, mat in other.faces:
            if xf is None:
                self.faces.append((corners, mat))
            else:
                self.faces.append(([_xf_corner(c, xf) for c in corners], mat))

    def transformed(self, xf):
        s = Soup()
        s.extend(self, xf)
        return s

    def tri_count(self):
        return sum(len(c) - 2 for c, _m in self.faces)

    def set_step(self, step):
        for corners, _m in self.faces:
            for c in corners:
                c.col = (c.col[0], step, c.col[2], c.col[3])
        return self

    def clip(self, plane_n, plane_d, cap_mat=None, cap_flag=FLAG_END, cap_uv_scale=None):
        """Keeps the part with dot(n, p) <= d. Returns cut edges (for capping by the caller)."""
        out = []
        segs = []
        for corners, mat in self.faces:
            res, seg = _clip_poly(corners, plane_n, plane_d)
            if len(res) >= 3:
                out.append((res, mat))
            if seg:
                segs.append(seg)
        self.faces = out
        return segs


def _xf_corner(c, xf):
    rot = xf.to_3x3()
    n = (rot @ c.n)
    if n.length > 1e-9:
        n.normalize()
    return Corner(xf @ c.p, n, c.uv, c.uv2, c.col)


def _lerp_corner(a, b, t):
    n = a.n.lerp(b.n, t)
    if n.length > 1e-9:
        n.normalize()
    return Corner(a.p.lerp(b.p, t), n,
                  (lerp(a.uv[0], b.uv[0], t), lerp(a.uv[1], b.uv[1], t)), a.uv2,
                  tuple(lerp(a.col[i], b.col[i], t) for i in range(4)))


def _clip_poly(corners, n, d):
    res = []
    seg = []
    m = len(corners)
    for i in range(m):
        a = corners[i]
        b = corners[(i + 1) % m]
        da = n.dot(a.p) - d
        db = n.dot(b.p) - d
        if da <= 0.0:
            res.append(a)
        if (da <= 0.0) != (db <= 0.0):
            t = da / (da - db)
            c = _lerp_corner(a, b, t)
            res.append(c)
            seg.append(c.p.copy())
    return res, seg


def cap_from_segments(soup, segs, plane_n, mat, uv2, col, flag=FLAG_END, disc_radius=None, seed=0):
    """Fills the hole left by clip() (convex cross-section): fan around the centroid, endgrain disc UVs."""
    pts = []
    for s in segs:
        for p in s:
            if not any((p - q).length < 1e-5 for q in pts):
                pts.append(p)
    if len(pts) < 3:
        return
    c = Vector((0, 0, 0))
    for p in pts:
        c += p
    c /= len(pts)
    n = plane_n.normalized()
    a = (Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))).cross(n).normalized()
    b = n.cross(a).normalized()
    pts.sort(key=lambda p: math.atan2((p - c).dot(b), (p - c).dot(a)))
    rad = disc_radius or max((p - c).length for p in pts)
    rr = random.Random(seed)
    rot = rr.uniform(0, math.tau)
    off = (rr.uniform(-0.05, 0.05), rr.uniform(-0.05, 0.05))
    def disc_uv(p):
        x = (p - c).dot(a) / (2.0 * rad)
        y = (p - c).dot(b) / (2.0 * rad)
        cr, sr = math.cos(rot), math.sin(rot)
        return (0.5 + off[0] + x * cr - y * sr, 0.5 + off[1] + x * sr + y * cr)
    colf = (col[0], col[1], col[2], flag)
    center = Corner(c, n.copy(), disc_uv(c), uv2, colf)
    for i in range(len(pts)):
        p0 = pts[i]
        p1 = pts[(i + 1) % len(pts)]
        soup.add([center, Corner(p0, n.copy(), disc_uv(p0), uv2, colf), Corner(p1, n.copy(), disc_uv(p1), uv2, colf)], mat)


# ============================================================================================ frames

def frame_from_axis(axis, up_hint=None):
    t = axis.normalized()
    up = up_hint or Vector((0, 1, 0))
    if abs(t.dot(up)) > 0.95:
        up = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 0, 1))
    u = up.cross(t).normalized()     # side
    v = t.cross(u).normalized()      # "up" around the axis
    return t, u, v


# ============================================================================================ logs

def log(soup, p0, p1, r0, r1=None, *, sides=14, seg=0.3, seed=0, mat="log", bark=0.35, step=0.0,
        ao_up=0.0, ao_down=0.0, cap0=True, cap1=True, wobble=0.006, bulge=0.035, ellipse=0.03,
        profile="round", flat_face=None, u_scale=1.0, end_nominal=True, sag=0.0, up_hint=None,
        end_bevel=0.012):
    """A debarked building log / pole / split log from p0 to p1 (Godot coords).

    profile: "round" | "half" (split log, flat face toward `flat_face` direction vector).
    ao_up / ao_down: darken the parts of the surface that face a neighbour above / below (stacked courses).
    end_nominal: radius noise fades to 0 at both ends (clean butt joints with the next piece).
    """
    p0 = V(p0)
    p1 = V(p1)
    r1 = r0 if r1 is None else r1
    rng = random.Random(seed)
    axis = p1 - p0
    L = axis.length
    t, u, v = frame_from_axis(axis, up_hint)
    if flat_face is not None:
        # rotate the frame so that +v points to the flat face
        ff = V(flat_face)
        ff = (ff - t * ff.dot(t)).normalized()
        v = ff
        u = v.cross(t).normalized()
    n_rings = max(2, int(math.ceil(L / seg)) + 1)
    uv2 = (rng.uniform(0.0, 50.0), rng.uniform(0.0, 50.0))
    v_off = rng.uniform(0.0, 10.0)
    ph1 = rng.uniform(0, math.tau)
    ph2 = rng.uniform(0, math.tau)
    nseed = rng.randint(0, 1 << 20)
    # cross-section profile: list of (angle, is_flat_point)
    if profile == "half":
        arc = [math.pi * i / (sides // 2) for i in range(sides // 2 + 1)]   # 0..pi on the round side (-v half)
        angles = [a + math.pi for a in arc]                                   # pi..2pi  (v<0 side)
    else:
        angles = [math.tau * i / sides for i in range(sides + 1)]
    rings = []
    for ri in range(n_rings):
        s = ri / (n_rings - 1)
        centre = p0 + axis * s
        if sag != 0.0:
            centre += v * (-sag * math.sin(math.pi * s))
        fade = smoothstep(0.0, 0.18, s) * smoothstep(1.0, 0.82, s) if end_nominal else 1.0
        centre += (u * vnoise1(s * 2.3 + 11.0, nseed) + v * vnoise1(s * 2.1 + 3.0, nseed + 7)) * wobble * fade * min(1.0, L / 1.5)
        rad = lerp(r0, r1, s) * (1.0 + bulge * vnoise1(s * L * 1.7, nseed + 3) * fade)
        rings.append((centre, rad, s))
    def section_point(centre, rad, a, s):
        e = 1.0 + ellipse * math.cos(2.0 * a + ph1) + 0.012 * math.cos(3.0 * a + ph2) \
            + 0.01 * vnoise1(a * 2.0 + s * 5.0, nseed + 21)
        d = u * math.cos(a) + v * math.sin(a)
        return centre + d * (rad * e), d
    # side
    prev = None
    for ri, (centre, rad, s) in enumerate(rings):
        row = []
        arc_len = 0.0
        last = None
        for ai, a in enumerate(angles):
            p, d = section_point(centre, rad, a, s)
            if last is not None:
                arc_len += (p - last).length
            last = p
            nrm = d.copy()
            ao = 1.0
            ny = nrm.dot(Vector((0, 1, 0)))
            if ao_up > 0.0 and ny > 0.0:
                ao -= ao_up * smoothstep(0.35, 1.0, ny)
            if ao_down > 0.0 and ny < 0.0:
                ao -= ao_down * smoothstep(0.35, 1.0, -ny)
            ao -= 0.12 * smoothstep(0.5, 1.0, -ny)   # undersides slightly darker anyway
            b = bark * (0.6 + 0.4 * smoothstep(-0.2, -0.9, ny))
            row.append(Corner(p, nrm, (arc_len * u_scale, s * L + v_off), uv2, (max(ao, 0.25), step, b, FLAG_WOOD)))
        if prev is not None:
            for ai in range(len(angles) - 1):
                a0 = prev[ai]; a1 = prev[ai + 1]; b0 = row[ai]; b1 = row[ai + 1]
                soup.add([a0, b0, b1, a1], mat)
        prev = row
    # flat face of a split log
    if profile == "half":
        for ri in range(len(rings) - 1):
            c0, r_0, s0 = rings[ri]
            c1, r_1, s1 = rings[ri + 1]
            pa0, _ = section_point(c0, r_0, math.pi, s0)
            pb0, _ = section_point(c0, r_0, 2.0 * math.pi, s0)
            pa1, _ = section_point(c1, r_1, math.pi, s1)
            pb1, _ = section_point(c1, r_1, 2.0 * math.pi, s1)
            nrm = v.copy()
            w = (pa0 - pb0).length
            col = (1.0, step, 0.0, FLAG_WOOD)
            soup.add([Corner(pb0, nrm, (0.0, s0 * L + v_off), uv2, col), Corner(pb1, nrm, (0.0, s1 * L + v_off), uv2, col),
                      Corner(pa1, nrm, (w, s1 * L + v_off), uv2, col), Corner(pa0, nrm, (w, s0 * L + v_off), uv2, col)], mat)
    # end caps (slightly chamfered rim so the endgrain edge catches light)
    for which, do in ((0, cap0), (1, cap1)):
        if not do:
            continue
        centre, rad, s = rings[0] if which == 0 else rings[-1]
        nrm = -t if which == 0 else t
        cap_angles = angles[:-1] if profile != "half" else angles
        pts = [section_point(centre, rad, a, s)[0] for a in cap_angles]
        cseed = seed * 31 + which
        rr = random.Random(cseed)
        rot = rr.uniform(0, math.tau)
        def duv(p):
            q = p - centre
            x = q.dot(u) / (2.0 * rad * 1.05)
            y = q.dot(v) / (2.0 * rad * 1.05)
            cr, sr = math.cos(rot), math.sin(rot)
            return (0.5 + x * cr - y * sr, 0.5 + x * sr + y * cr)
        col = (1.0, step, 0.0, FLAG_END)
        # chamfer ring
        inner = [centre + (p - centre) * (1.0 - end_bevel / max(rad, 0.02)) + nrm * end_bevel * 0.6 for p in pts]
        m = len(pts)
        rng_cap = range(m) if profile != "half" else range(m - 1)
        for i in rng_cap:
            j = (i + 1) % m
            n0 = ((pts[i] - centre).normalized() + nrm).normalized()
            n1 = ((pts[j] - centre).normalized() + nrm).normalized()
            cs = [Corner(pts[i], n0, duv(pts[i]), uv2, col), Corner(inner[i], nrm, duv(inner[i]), uv2, col),
                  Corner(inner[j], nrm, duv(inner[j]), uv2, col), Corner(pts[j], n1, duv(pts[j]), uv2, col)]
            if which == 1:
                cs.reverse()
            soup.add(cs, mat)
        cc = centre + nrm * end_bevel * 0.6
        for i in rng_cap:
            j = (i + 1) % m
            cs = [Corner(cc, nrm, duv(cc), uv2, col), Corner(inner[j], nrm, duv(inner[j]), uv2, col),
                  Corner(inner[i], nrm, duv(inner[i]), uv2, col)]
            if which == 1:
                cs.reverse()
            soup.add(cs, mat)
    return soup


def fix_winding(soup, centre_hint=None):
    """Makes every face's winding agree with its corner normals (counter-clockwise seen from outside)."""
    for corners, _m in soup.faces:
        if len(corners) < 3:
            continue
        a, b, c = corners[0].p, corners[1].p, corners[2].p
        fn = (b - a).cross(c - a)
        avg = Vector((0, 0, 0))
        for k in corners:
            avg += k.n
        if fn.dot(avg) < 0.0:
            corners.reverse()
    return soup


# ============================================================================================ boards

def board(soup, centre, size, rot=None, *, mat="planks", seed=0, step=0.0, weather=0.3, bevel=0.006,
          grain_axis=2, ao_bottom=0.35, uv_off=None, taper=0.0):
    """A sawn/split board: box with small chamfers. size = (sx, sy, sz) in its local frame, grain along
    local axis `grain_axis` (0 x, 1 y, 2 z) -> texture V. `taper` thins the +grain end (shakes)."""
    rng = random.Random(seed)
    sx, sy, sz = size
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    rot = rot or Matrix.Identity(3)
    c = V(centre)
    uv2 = (rng.uniform(0, 50), rng.uniform(0, 50))
    off = uv_off if uv_off is not None else (rng.uniform(0, 4.0), rng.uniform(0, 4.0))
    b = min(bevel, hx * 0.45, hy * 0.45, hz * 0.45) if bevel > 0.0 else 0.0
    # local corner generator
    def P(x, y, z):
        # taper along grain toward + end
        g = (x, y, z)[grain_axis]
        gl = (hx, hy, hz)[grain_axis]
        k = 1.0 - taper * ((g / gl) * 0.5 + 0.5) if gl > 0 else 1.0
        if grain_axis != 1:
            y = y * k if y > 0 else y
        return c + rot @ Vector((x, y, z))
    def uvmap(x, y, z, nrm_axis):
        # planar: V along grain axis, U along the other in-plane axis
        coords = [x + hx, y + hy, z + hz]
        vv = coords[grain_axis]
        other = [i for i in range(3) if i != grain_axis and i != nrm_axis]
        uu = coords[other[0]] if other else 0.0
        return (uu + off[0], vv + off[1])
    faces = []
    X = (-hx, hx); Y = (-hy, hy); Z = (-hz, hz)
    # six faces, each inset by the chamfer
    def quad(nrm_axis, sign):
        pts = []
        if nrm_axis == 0:
            x = hx * sign
            q = [(x, -hy + b, -hz + b), (x, -hy + b, hz - b), (x, hy - b, hz - b), (x, hy - b, -hz + b)]
        elif nrm_axis == 1:
            y = hy * sign
            q = [(-hx + b, y, -hz + b), (hx - b, y, -hz + b), (hx - b, y, hz - b), (-hx + b, y, hz - b)]
        else:
            z = hz * sign
            q = [(-hx + b, -hy + b, z), (-hx + b, hy - b, z), (hx - b, hy - b, z), (hx - b, -hy + b, z)]
        return q
    for axis in range(3):
        for sign in (-1, 1):
            q = quad(axis, sign)
            nloc = [0, 0, 0]
            nloc[axis] = sign
            nrm = (rot @ Vector(nloc)).normalized()
            ao = 1.0 - (ao_bottom if (axis == 1 and sign < 0) else 0.0)
            flag = FLAG_END if axis == grain_axis else FLAG_WOOD
            cs = []
            for (x, y, z) in q:
                uv = uvmap(x, y, z, axis)
                if flag == FLAG_END:
                    uv = ((x + hx) / max(sx, 1e-3) * 0.3 + 0.35, (y + hy) / max(sy, 1e-3) * 0.3 + 0.35) if axis == 2 else \
                         ((z + hz) / max(sz, 1e-3) * 0.3 + 0.35, (y + hy) / max(sy, 1e-3) * 0.3 + 0.35)
                cs.append(Corner(P(x, y, z), nrm.copy(), uv, uv2, (ao, step, weather, flag)))
            faces.append(cs)
    # chamfer strips along the 12 edges (approximate: connect adjacent face quads)
    for f in faces:
        soup.add(f, mat)
    if bevel > 1e-4 and b > 1e-4:
        _box_chamfers(soup, P, hx, hy, hz, b, rot, uvmap, uv2, step, weather, mat)
    return soup


def _box_chamfers(soup, P, hx, hy, hz, b, rot, uvmap, uv2, step, weather, mat):
    # 12 edge strips + 8 corner triangles
    col = (0.9, step, weather, FLAG_WOOD)
    sgn = (-1, 1)
    # edges parallel to x
    for sy in sgn:
        for sz in sgn:
            n = (rot @ Vector((0, sy, sz))).normalized()
            a = [(-hx + b, sy * hy, sz * (hz - b)), (hx - b, sy * hy, sz * (hz - b)),
                 (hx - b, sy * (hy - b), sz * hz), (-hx + b, sy * (hy - b), sz * hz)]
            cs = [Corner(P(*p), n.copy(), uvmap(*p, 1), uv2, col) for p in a]
            _orient(cs, n)
            soup.add(cs, mat)
    for sx in sgn:
        for sz in sgn:
            n = (rot @ Vector((sx, 0, sz))).normalized()
            a = [(sx * hx, -hy + b, sz * (hz - b)), (sx * hx, hy - b, sz * (hz - b)),
                 (sx * (hx - b), hy - b, sz * hz), (sx * (hx - b), -hy + b, sz * hz)]
            cs = [Corner(P(*p), n.copy(), uvmap(*p, 0), uv2, col) for p in a]
            _orient(cs, n)
            soup.add(cs, mat)
    for sx in sgn:
        for sy in sgn:
            n = (rot @ Vector((sx, sy, 0))).normalized()
            a = [(sx * hx, sy * (hy - b), -hz + b), (sx * hx, sy * (hy - b), hz - b),
                 (sx * (hx - b), sy * hy, hz - b), (sx * (hx - b), sy * hy, -hz + b)]
            cs = [Corner(P(*p), n.copy(), uvmap(*p, 0), uv2, col) for p in a]
            _orient(cs, n)
            soup.add(cs, mat)
    for sx in sgn:
        for sy in sgn:
            for sz in sgn:
                n = (rot @ Vector((sx, sy, sz))).normalized()
                a = [(sx * hx, sy * (hy - b), sz * (hz - b)), (sx * (hx - b), sy * hy, sz * (hz - b)),
                     (sx * (hx - b), sy * (hy - b), sz * hz)]
                cs = [Corner(P(*p), n.copy(), uvmap(*p, 0), uv2, col) for p in a]
                _orient(cs, n)
                soup.add(cs, mat)


def _orient(cs, n):
    a, b, c = cs[0].p, cs[1].p, cs[2].p
    if (b - a).cross(c - a).dot(n) < 0.0:
        cs.reverse()


# ============================================================================================ stones

def stone(soup, centre, radius, *, seed=0, squash=(1.0, 0.6, 0.85), rot_y=None, mat="stone", step=0.0,
          subdiv=None, rough=0.22, flat_bottom=True):
    """Irregular field stone: noise-displaced icosphere, optionally flattened underneath."""
    rng = random.Random(seed)
    if subdiv is None:
        subdiv = 2 if radius > 0.2 else 1
    verts, faces = _icosphere(subdiv)
    c = V(centre)
    ry = rng.uniform(0, math.tau) if rot_y is None else rot_y
    R = Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 3, 'X')
    # low-frequency lumps: a few random planes that chop the sphere (angular "cut stone" feel)
    planes = [(Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized(), rng.uniform(0.62, 0.9))
              for _ in range(6)]
    pos = []
    for p in verts:
        d = p.copy()
        k = 1.0 + rough * (vnoise1(d.x * 2.1 + d.z * 1.3 + 5.0, seed) * 0.6 + vnoise1(d.y * 2.7 - d.x * 0.7, seed + 9) * 0.4)
        q = d * k
        for pn, pd in planes:
            dist = q.dot(pn)
            if dist > pd:
                q -= pn * (dist - pd) * 0.85
        q = Vector((q.x * squash[0], q.y * squash[1], q.z * squash[2]))
        if flat_bottom and q.y < -0.55 * squash[1]:
            q.y = -0.55 * squash[1] + (q.y + 0.55 * squash[1]) * 0.25
        pos.append(c + R @ (q * radius))
    # normals by averaging
    nrm = [Vector((0, 0, 0)) for _ in pos]
    for f in faces:
        a, b, cc = pos[f[0]], pos[f[1]], pos[f[2]]
        fn = (b - a).cross(cc - a)
        for i in f:
            nrm[i] += fn
    for n in nrm:
        if n.length > 1e-9:
            n.normalize()
    uv2 = (rng.uniform(0, 50), rng.uniform(0, 50))
    for f in faces:
        cs = []
        for i in f:
            p = pos[i]
            ao = 1.0 - 0.45 * smoothstep(0.2, -0.9, nrm[i].y)
            cs.append(Corner(p, nrm[i].copy(), (p.x, p.z), uv2, (ao, step, 0.0, 0.0)))
        soup.add(cs, mat)
    return soup


def _icosphere(sub):
    t = (1.0 + 5 ** 0.5) / 2.0
    vs = [Vector(v).normalized() for v in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
                                         (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    fs = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
          (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10),
          (8, 6, 7), (9, 8, 1)]
    for _ in range(sub):
        cache = {}
        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                vs.append(((vs[a] + vs[b]) * 0.5).normalized())
                cache[k] = len(vs) - 1
            return cache[k]
        nf = []
        for a, b, c in fs:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        fs = nf
    # glTF / Godot want counter-clockwise front faces seen from outside: these are CCW for +outward normal
    return vs, fs


# ============================================================================================ rope

def rope_segment(soup, p0, p1, radius=0.009, *, sides=6, seed=0, mat="rope", step=0.0, twist=True):
    """Rope from p0 to p1 (rope material: U = metres along, V = 0..1 around)."""
    p0 = V(p0); p1 = V(p1)
    axis = p1 - p0
    L = axis.length
    if L < 1e-4:
        return soup
    t, u, v = frame_from_axis(axis)
    n = max(2, int(L / 0.05) + 1)
    rng = random.Random(seed)
    uv2 = (rng.uniform(0, 50), rng.uniform(0, 50))
    prev = None
    for i in range(n):
        s = i / (n - 1)
        c = p0 + axis * s
        row = []
        for k in range(sides + 1):
            a = math.tau * k / sides
            d = u * math.cos(a) + v * math.sin(a)
            row.append(Corner(c + d * radius, d.copy(), (s * L, k / sides), uv2, (0.85, step, 0.0, 0.0)))
        if prev:
            for k in range(sides):
                soup.add([prev[k], row[k], row[k + 1], prev[k + 1]], mat)
        prev = row
    return soup


def lashing(soup, centre, axis_a, axis_b, r_a, r_b, *, wraps=5, seed=0, step=0.0, radius=0.007):
    """X-lashing where two poles cross: a few rope loops around the joint (approximation)."""
    c = V(centre)
    a = V(axis_a).normalized()
    b = V(axis_b).normalized()
    n = a.cross(b)
    if n.length < 1e-4:
        n = Vector((0, 1, 0))
    n.normalize()
    rng = random.Random(seed)
    rr = max(r_a, r_b) + radius
    for w in range(wraps):
        off = (w - (wraps - 1) * 0.5) * radius * 2.2
        # loop around pole a (in the plane perpendicular to a), offset along b
        for (ax, other, ro) in ((a, b, r_a), (b, a, r_b)):
            t, u, v = frame_from_axis(ax)
            pts = []
            for k in range(13):
                ang = math.tau * k / 12
                pts.append(c + other * off + (u * math.cos(ang) + v * math.sin(ang)) * (ro + radius + 0.004))
            for k in range(12):
                rope_segment(soup, pts[k], pts[k + 1], radius, sides=5, seed=seed + w * 13 + k, step=step)
    return soup


# ============================================================================================ cards (alpha)

def card(soup, centre, right, up, w, h, *, mat="bough", uv_rect=(0, 0, 1, 1), step=0.0, normal=None, ao=1.0,
         bend=0.0, segs=1):
    """Alpha card (double-sided in the material). uv_rect in 0..1 atlas space."""
    c = V(centre); r = V(right).normalized(); up_v = V(up).normalized()
    n = normal if normal is not None else r.cross(up_v).normalized()
    u0, v0, u1, v1 = uv_rect
    rows = []
    for j in range(segs + 1):
        t = j / segs
        y = (t - 0.5) * h
        droop = -bend * (t * t) * h
        row = []
        for i in range(2):
            x = (i - 0.5) * w
            p = c + r * x + up_v * y + n * droop
            row.append(Corner(p, n.copy(), (lerp(u0, u1, i), lerp(v1, v0, t)), (0.0, 0.0), (ao, step, 0.0, 0.0)))
        rows.append(row)
    for j in range(segs):
        soup.add([rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]], mat)
    return soup


# ============================================================================================ export

MATERIAL_ORDER = ["log", "planks", "stone", "rope", "bough", "hide", "wool", "metal", "metal_dark", "cloth",
                  "meat", "fx", "snow", "water", "coal", "bark"]


def to_object(name, soup, collection=None):
    """Builds a Blender mesh object from a Soup (Godot coords -> Blender coords)."""
    fix_winding(soup)
    tri_faces = []
    for corners, mat in soup.faces:
        if len(corners) > 4:
            for i in range(1, len(corners) - 1):
                tri_faces.append(([corners[0], corners[i], corners[i + 1]], mat))
        else:
            tri_faces.append((corners, mat))
    soup = Soup()
    soup.faces = tri_faces
    vkey = {}
    verts = []
    faces = []
    loop_n = []
    loop_uv = []
    loop_uv2 = []
    loop_col = []
    face_mat = []
    mats = []
    for corners, mat in soup.faces:
        idx = []
        for c in corners:
            bp = (c.p.x, -c.p.z, c.p.y)
            k = (round(bp[0], 5), round(bp[1], 5), round(bp[2], 5))
            if k not in vkey:
                vkey[k] = len(verts)
                verts.append(bp)
            idx.append(vkey[k])
        # drop degenerate faces (repeated vertex)
        if len(set(idx)) < 3:
            continue
        if len(set(idx)) != len(idx):
            # remove consecutive duplicates
            clean_i = []
            clean_c = []
            for i2, c2 in zip(idx, corners):
                if clean_i and clean_i[-1] == i2:
                    continue
                clean_i.append(i2); clean_c.append(c2)
            if clean_i[0] == clean_i[-1]:
                clean_i.pop(); clean_c.pop()
            if len(clean_i) < 3:
                continue
            idx, corners = clean_i, clean_c
        faces.append(idx)
        for c in corners:
            loop_n.append((c.n.x, -c.n.z, c.n.y))
            loop_uv.append((c.uv[0], 1.0 - c.uv[1]))
            loop_uv2.append((c.uv2[0], 1.0 - c.uv2[1]))
            loop_col.append(c.col)
        if mat not in mats:
            mats.append(mat)
        face_mat.append(mats.index(mat))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update(calc_edges=True)
    uvl = me.uv_layers.new(name="UVMap")
    uvl2 = me.uv_layers.new(name="UV2")
    for i, l in enumerate(me.loops):
        uvl.data[i].uv = loop_uv[i]
        uvl2.data[i].uv = loop_uv2[i]
    ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='CORNER')
    for i in range(len(me.loops)):
        ca.data[i].color = loop_col[i]
    me.color_attributes.active_color = ca
    try:
        me.color_attributes.render_color_index = 0
    except Exception:
        pass
    for i, p in enumerate(me.polygons):
        p.material_index = face_mat[i]
        p.use_smooth = True
    for m in mats:
        me.materials.append(get_material(m))
    me.use_auto_smooth = True
    me.normals_split_custom_set(loop_n)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


_MATS = {}


def get_material(name):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    # Vertex colour hooked up so the glTF exporter writes COLOR_0.
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 0.0
    nt.links.new(vc.outputs["Color"], mix.inputs[2])
    base = {"log": (0.45, 0.33, 0.22), "planks": (0.4, 0.37, 0.33), "stone": (0.4, 0.4, 0.4),
            "rope": (0.55, 0.45, 0.3), "bough": (0.1, 0.18, 0.08)}.get(name, (0.5, 0.5, 0.5))
    mix.inputs[1].default_value = (*base, 1.0)
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    _MATS[name] = m
    return m


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
              export_normals=True, export_tangents=True, export_texcoords=True, export_materials='EXPORT',
              export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
              export_lights=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 4, 'Y')


def translate(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))

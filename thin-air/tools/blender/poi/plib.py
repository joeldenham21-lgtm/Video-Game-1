"""THIN AIR — POI architecture library (Blender 4.0, headless).

Authoring space is Blender's: Z up, +Y = north (Godot -Z), +X = east, metres. The glTF exporter converts to
Godot's Y-up. Every location is a `Site`: geometry is accumulated as polygon soups (`Mesh`) in named
*buckets* (one MeshInstance3D each, merged per material = one draw call per material per bucket), plus
collision boxes (surface-tagged), Marker3D sockets, lights, reflection probes and shelter volumes. `Site.build()`
bakes vertex colours, exports assets/models/poi/<id>.glb (+ .import with library-material remaps) and writes
scenes/poi/<id>.tscn (an inherited scene of the glb).

Mesh conventions (read by assets/models/poi/shaders/poi_common.gdshaderinc):
  UV     metres (materials scale by 1/tile); V along the grain for wood; decal materials use atlas UVs 0..1.
  COLOR  rgb = paint tint x baked ambient occlusion x grime (linear), a = sky exposure (0 under roofs /
         inside, 1 open to the sky) -> where snow settles and rain wets.
"""
import math
import os
import random

import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_MODELS = os.path.join(ROOT, "assets", "models", "poi")
OUT_SCENES = os.path.join(ROOT, "scenes", "poi")

F_NOAO = 1       # skip baked AO (glass, emissive, decals floating on a surface)
F_NOEXP = 2      # never exposed (no snow / wet)
F_EXP = 4        # always fully exposed

_rng = random.Random(1)


def seed(s):
    _rng.seed(s)


def rnd(a=0.0, b=1.0):
    return _rng.uniform(a, b)


def rchoice(seq):
    return _rng.choice(seq)


def V(x, y=0.0, z=0.0):
    if isinstance(x, (tuple, list, Vector)):
        return Vector(x)
    return Vector((x, y, z))


def T(x=0.0, y=0.0, z=0.0):
    if isinstance(x, (tuple, list, Vector)):
        return Matrix.Translation(Vector(x))
    return Matrix.Translation(Vector((x, y, z)))


def RX(d):
    return Matrix.Rotation(math.radians(d), 4, 'X')


def RY(d):
    return Matrix.Rotation(math.radians(d), 4, 'Y')


def RZ(d):
    return Matrix.Rotation(math.radians(d), 4, 'Z')


def S(x, y=None, z=None):
    if y is None:
        y = x
        z = x
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = x, y, z
    return m


def TR(loc=(0, 0, 0), rot=(0, 0, 0)):
    """Translation @ Z @ Y @ X rotation (degrees)."""
    return T(loc) @ RZ(rot[2]) @ RY(rot[1]) @ RX(rot[0])


def look_basis(fwd, up=(0, 0, 1)):
    """4x4 rotation whose local +Z = fwd (for tubes/cylinders pointing along a direction)."""
    f = Vector(fwd).normalized()
    u = Vector(up)
    if abs(f.dot(u.normalized())) > 0.99:
        u = Vector((1, 0, 0)) if abs(f.x) < 0.9 else Vector((0, 1, 0))
    x = u.cross(f).normalized()
    y = f.cross(x).normalized()
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2] = x[i], y[i], f[i]
    return m


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))) if b != a else (1.0 if x >= b else 0.0)
    return t * t * (3.0 - 2.0 * t)


def nz(p, scale=1.0, seed_=0.0):
    """Perlin noise in [-1, 1] at a point."""
    return noise.noise(Vector((p[0] * scale + seed_ * 17.31, p[1] * scale - seed_ * 9.7, p[2] * scale + seed_ * 3.3)))


def fbm(p, scale=1.0, octaves=3, seed_=0.0):
    a = 0.0
    amp = 1.0
    tot = 0.0
    s = scale
    for i in range(octaves):
        a += nz(p, s, seed_ + i * 5.1) * amp
        tot += amp
        amp *= 0.5
        s *= 2.03
    return a / tot


# ------------------------------------------------------------------------------------------------ Mesh soup

class Mesh:
    """Indexed polygon soup. Per face: vertex indices, per-corner UVs, material, smooth flag, tint, flags."""

    def __init__(self):
        self.v = []
        self.f = []
        self.uv = []
        self.m = []
        self.s = []
        self.t = []
        self.fl = []

    def vert(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, uvs, mat, smooth_=False, tint=(1.0, 1.0, 1.0), flags=0):
        if len(idx) < 3:
            return
        self.f.append(list(idx))
        self.uv.append([tuple(u) for u in uvs])
        self.m.append(mat)
        self.s.append(smooth_)
        self.t.append(tuple(tint))
        self.fl.append(flags)

    def extend(self, other, M=None, tint=None, mat=None, flags=None):
        off = len(self.v)
        if M is None:
            self.v.extend(p.copy() for p in other.v)
        else:
            self.v.extend(M @ p for p in other.v)
        flip = M is not None and M.to_3x3().determinant() < 0.0
        for i in range(len(other.f)):
            idx = [j + off for j in other.f[i]]
            uvs = list(other.uv[i])
            if flip:
                idx.reverse()
                uvs.reverse()
            self.f.append(idx)
            self.uv.append(uvs)
            self.m.append(mat if mat else other.m[i])
            self.s.append(other.s[i])
            t = other.t[i]
            if tint is not None:
                t = (t[0] * tint[0], t[1] * tint[1], t[2] * tint[2])
            self.t.append(t)
            self.fl.append(other.fl[i] if flags is None else (other.fl[i] | flags))
        return self

    def transformed(self, M):
        return Mesh().extend(self, M)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def set_mat(self, mat):
        self.m = [mat] * len(self.f)
        return self

    def set_tint(self, tint):
        self.t = [tuple(tint)] * len(self.f)
        return self

    def add_flags(self, fl):
        self.fl = [x | fl for x in self.fl]
        return self

    def displace(self, fn):
        """fn(Vector) -> Vector offset (applied to every vertex)."""
        self.v = [p + fn(p) for p in self.v]
        return self

    def bounds(self):
        if not self.v:
            return Vector((0, 0, 0)), Vector((0, 0, 0))
        lo = Vector((min(p.x for p in self.v), min(p.y for p in self.v), min(p.z for p in self.v)))
        hi = Vector((max(p.x for p in self.v), max(p.y for p in self.v), max(p.z for p in self.v)))
        return lo, hi


def _jit(tint, j):
    if j <= 0.0:
        return tuple(tint)
    k = 1.0 + rnd(-j, j)
    return (tint[0] * k, tint[1] * k, tint[2] * k)


# ------------------------------------------------------------------------------------------------ primitives
# All return a Mesh in local space. Use Site.add(mesh, M) to place.

_BOX_FACES = (
    # name, origin corner (in units of half extents), a dir, b dir
    ("+x", (1, -1, -1), (0, 1, 0), (0, 0, 1)),
    ("-x", (-1, 1, -1), (0, -1, 0), (0, 0, 1)),
    ("+y", (1, 1, -1), (-1, 0, 0), (0, 0, 1)),
    ("-y", (-1, -1, -1), (1, 0, 0), (0, 0, 1)),
    ("+z", (-1, -1, 1), (1, 0, 0), (0, 1, 0)),
    ("-z", (-1, 1, -1), (1, 0, 0), (0, -1, 0)),
)


def box(sx, sy, sz, mat, grain='z', seg=0.0, tint=(1, 1, 1), jitter=0.05, mats=None, skip=(), uvo=None,
        end_mat=None, flags=0, taper=None):
    """Box centred at the origin. grain: local axis the texture V follows ('x','y','z').
    seg: max grid cell size (m) for AO resolution (0 = one quad per face). mats: {'+z': mat, ...} overrides.
    end_mat: material for the faces perpendicular to the grain (UV 0..1 across the face, e.g. wood_endgrain).
    taper: (kx, ky) scale of the +z end (pyramids, tapered posts)."""
    me = Mesh()
    h = Vector((sx * 0.5, sy * 0.5, sz * 0.5))
    g = {'x': 0, 'y': 1, 'z': 2}[grain]
    if uvo is None:
        uvo = (rnd(0, 4), rnd(0, 4))
    tint = _jit(tint, jitter)
    for name, o, a, b in _BOX_FACES:
        if name in skip:
            continue
        a = Vector(a)
        b = Vector(b)
        origin = Vector((o[0] * h.x, o[1] * h.y, o[2] * h.z))
        la = abs(a.x) * sx + abs(a.y) * sy + abs(a.z) * sz
        lb = abs(b.x) * sx + abs(b.y) * sy + abs(b.z) * sz
        nu = max(1, int(math.ceil(la / seg - 1e-6))) if seg > 0 else 1
        nv = max(1, int(math.ceil(lb / seg - 1e-6))) if seg > 0 else 1
        ai = max(range(3), key=lambda i: abs(a[i]))
        bi = max(range(3), key=lambda i: abs(b[i]))
        fmat = (mats or {}).get(name, mat)
        is_end = ai != g and bi != g
        if is_end and end_mat and not (mats and name in mats):
            fmat = end_mat
        base = len(me.v)
        for j in range(nv + 1):
            for i in range(nu + 1):
                p = origin + a * (la * i / nu) + b * (lb * j / nv)
                if taper and p.z > 0:
                    p = Vector((p.x * taper[0], p.y * taper[1], p.z))
                me.v.append(p)
        for j in range(nv):
            for i in range(nu):
                q = [base + j * (nu + 1) + i, base + j * (nu + 1) + i + 1,
                     base + (j + 1) * (nu + 1) + i + 1, base + (j + 1) * (nu + 1) + i]
                uvs = []
                for k in q:
                    p = me.v[k]
                    if is_end and end_mat and fmat == end_mat:
                        s_ = (p - origin).dot(a) / la
                        t_ = (p - origin).dot(b) / lb
                        uvs.append((s_, t_))
                        continue
                    s_ = p.dot(a)
                    t_ = p.dot(b)
                    if ai == g:
                        uvs.append((t_ + uvo[0], s_ + uvo[1]))
                    else:
                        uvs.append((s_ + uvo[0], t_ + uvo[1]))
                me.face(q, uvs, fmat, False, tint, flags)
    return me


def cyl(r, h, mat, n=12, r2=None, caps=True, cap_mat=None, tint=(1, 1, 1), jitter=0.04, smooth_=True,
        flags=0, a0=0.0, arc=360.0, vseg=1, uvo=None):
    """Cylinder/cone along +Z from z=0 to z=h. U = arc length (m), V = height. cap_mat 'wood_endgrain' gets a
    0..1 disc mapping, others planar metres."""
    me = Mesh()
    r2 = r if r2 is None else r2
    tint = _jit(tint, jitter)
    full = abs(arc - 360.0) < 1e-6
    cols = n if full else n + 1
    if uvo is None:
        uvo = (rnd(0, 4), rnd(0, 4))
    rings = []
    for j in range(vseg + 1):
        t = j / vseg
        rr = lerp(r, r2, t)
        ring = []
        for i in range(cols):
            ang = math.radians(a0 + arc * i / n)
            ring.append(me.vert((math.cos(ang) * rr, math.sin(ang) * rr, h * t)))
        rings.append(ring)
    circ = 2 * math.pi * max(r, r2) * (arc / 360.0)
    for j in range(vseg):
        for i in range(n):
            i2 = (i + 1) % cols if full else i + 1
            q = [rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]]
            u0 = circ * i / n + uvo[0]
            u1 = circ * (i + 1) / n + uvo[0]
            v0 = h * j / vseg + uvo[1]
            v1 = h * (j + 1) / vseg + uvo[1]
            me.face(q, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], mat, smooth_, tint, flags)
    if caps and full:
        cm = cap_mat or mat
        for j, rr, top in ((0, r, False), (vseg, r2, True)):
            if rr <= 1e-5:
                continue
            idx = list(rings[j])
            if not top:
                idx.reverse()
            uvs = []
            for k in idx:
                p = me.v[k]
                if cm == 'wood_endgrain':
                    uvs.append((0.5 + p.x / (2 * rr), 0.5 + p.y / (2 * rr)))
                else:
                    uvs.append((p.x + uvo[0], p.y + uvo[1]))
            me.face(idx, uvs, cm, False, tint, flags)
    return me


def lathe(profile, mat, n=16, tint=(1, 1, 1), jitter=0.03, smooth_=True, flags=0, a0=0.0):
    """Surface of revolution around +Z. profile: [(r, z), ...] bottom -> top. r = 0 ends close to a point."""
    me = Mesh()
    tint = _jit(tint, jitter)
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([me.vert((0, 0, z))])
        else:
            rings.append([me.vert((math.cos(math.radians(a0) + 2 * math.pi * i / n) * r,
                                   math.sin(math.radians(a0) + 2 * math.pi * i / n) * r, z)) for i in range(n)])
    rmax = max(r for r, z in profile)
    vacc = [0.0]
    for k in range(1, len(profile)):
        vacc.append(vacc[-1] + math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]))
    circ = 2 * math.pi * rmax
    for k in range(len(profile) - 1):
        ra, rb = rings[k], rings[k + 1]
        for i in range(n):
            u0 = circ * i / n
            u1 = circ * (i + 1) / n
            if len(ra) == 1 and len(rb) == 1:
                continue
            if len(ra) == 1:
                me.face([ra[0], rb[(i + 1) % n], rb[i]][::-1], [(u0, vacc[k]), (u0, vacc[k + 1]), (u1, vacc[k + 1])],
                        mat, smooth_, tint, flags)
            elif len(rb) == 1:
                me.face([ra[i], ra[(i + 1) % n], rb[0]], [(u0, vacc[k]), (u1, vacc[k]), (u0, vacc[k + 1])],
                        mat, smooth_, tint, flags)
            else:
                me.face([ra[i], ra[(i + 1) % n], rb[(i + 1) % n], rb[i]],
                        [(u0, vacc[k]), (u1, vacc[k]), (u1, vacc[k + 1]), (u0, vacc[k + 1])], mat, smooth_, tint, flags)
    return me


def loft(rings, mat, closed=True, smooth_=True, tint=(1, 1, 1), jitter=0.03, cap0=False, cap1=False,
         flags=0, cap_mat=None, tints=None, mats=None):
    """Skin consecutive rings (lists of Vectors, equal counts). U = arc length around the ring (m), V = distance
    along the ring centroids (m). tints/mats: optional per-band (ring k -> k+1) and per-column callables
    f(k, i) -> tint / material for liveries."""
    me = Mesh()
    tint = _jit(tint, jitter)
    idx = []
    for ring in rings:
        idx.append([me.vert(p) for p in ring])
    nr = len(rings[0])
    cent = [sum((Vector(p) for p in ring), Vector()) / len(ring) for ring in rings]
    vacc = [0.0]
    for k in range(1, len(rings)):
        vacc.append(vacc[-1] + (cent[k] - cent[k - 1]).length)
    uacc = []
    for ring in rings:
        acc = [0.0]
        cnt = nr + (1 if closed else 0)
        for i in range(1, cnt):
            acc.append(acc[-1] + (Vector(ring[i % nr]) - Vector(ring[i - 1])).length)
        uacc.append(acc)
    ncols = nr if closed else nr - 1
    for k in range(len(rings) - 1):
        for i in range(ncols):
            i2 = (i + 1) % nr
            q = [idx[k][i], idx[k][i2], idx[k + 1][i2], idx[k + 1][i]]
            uvs = [(uacc[k][i], vacc[k]), (uacc[k][i + 1], vacc[k]), (uacc[k + 1][i + 1], vacc[k + 1]),
                   (uacc[k + 1][i], vacc[k + 1])]
            t = tints(k, i) if tints else tint
            m = mats(k, i) if mats else mat
            me.face(q, uvs, m, smooth_, t, flags)
    for use, k, rev in ((cap0, 0, True), (cap1, len(rings) - 1, False)):
        if not use:
            continue
        ids = list(idx[k])
        if rev:
            ids.reverse()
        c = cent[k]
        me.face(ids, [((me.v[j] - c).x, (me.v[j] - c).y + (me.v[j] - c).z) for j in ids], cap_mat or mat, False,
                tint, flags)
    return me


def _frames(path):
    """Parallel-transport frames along a polyline: list of (tangent, normal, binormal)."""
    pts = [Vector(p) for p in path]
    tans = []
    for i in range(len(pts)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tans.append(t.normalized())
    up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(up).normalized()
    out = []
    for i, t in enumerate(tans):
        if i > 0:
            nrm = nrm - t * nrm.dot(t)
            if nrm.length < 1e-6:
                nrm = t.cross(up)
            nrm.normalize()
        out.append((t, nrm, t.cross(nrm).normalized()))
    return out


def tube(path, r, mat, n=8, tint=(1, 1, 1), jitter=0.03, caps=False, flags=0, smooth_=True):
    """Round tube along a polyline. r: float or per-point list. U around (m), V along (m)."""
    pts = [Vector(p) for p in path]
    fr = _frames(pts)
    rings = []
    for i, p in enumerate(pts):
        rr = r[i] if isinstance(r, (list, tuple)) else r
        t, nn, bb = fr[i]
        rings.append([p + (nn * math.cos(2 * math.pi * j / n) + bb * math.sin(2 * math.pi * j / n)) * rr
                      for j in range(n)])
    return loft(rings, mat, True, smooth_, tint, jitter, caps, caps, flags)


def strip_tube(path, w, h, mat, tint=(1, 1, 1), flags=0):
    """Rectangular section swept along a polyline (straps, cables, rails)."""
    pts = [Vector(p) for p in path]
    fr = _frames(pts)
    rings = []
    for i, p in enumerate(pts):
        t, nn, bb = fr[i]
        rings.append([p + nn * (-w / 2) + bb * (-h / 2), p + nn * (w / 2) + bb * (-h / 2), p + nn * (w / 2) + bb * (h / 2),
                      p + nn * (-w / 2) + bb * (h / 2)])
    return loft(rings, mat, True, False, tint, 0.02, True, True, flags)


def beam(p0, p1, w, h, mat, up=(0, 0, 1), tint=(1, 1, 1), jitter=0.06, end_mat=None, seg=0.0, flags=0, roll=0.0):
    """Rectangular timber between two points (w across, h along `up`), grain along its length."""
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = p1 - p0
    L = d.length
    M = T((p0 + p1) * 0.5) @ look_basis(d, up) @ RZ(roll)
    return box(w, h, L, mat, 'z', seg, tint, jitter, end_mat=end_mat, flags=flags).transformed(M)


def rod(p0, p1, r, mat, n=8, tint=(1, 1, 1), caps=True, cap_mat=None, jitter=0.03, flags=0, r2=None):
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = p1 - p0
    return cyl(r, d.length, mat, n, r2, caps, cap_mat, tint, jitter, True, flags).transformed(T(p0) @ look_basis(d))


def quad(p0, p1, p2, p3, mat, uvs=None, tint=(1, 1, 1), flags=0, two_sided=False):
    me = Mesh()
    ids = [me.vert(p) for p in (p0, p1, p2, p3)]
    if uvs is None:
        a = Vector(p1) - Vector(p0)
        b = Vector(p3) - Vector(p0)
        uvs = [(0, 0), (a.length, 0), (a.length, b.length), (0, b.length)]
    me.face(ids, uvs, mat, False, tint, flags)
    if two_sided:
        me.face(ids[::-1], uvs[::-1], mat, False, tint, flags)
    return me


def _ear_clip(poly):
    """Triangulates a simple 2D polygon (CCW). Returns index triples."""
    n = len(poly)
    idx = list(range(n))
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    if area < 0:
        idx.reverse()
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        found = False
        for k in range(len(idx)):
            a, b, c = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            pa, pb, pc = poly[a], poly[b], poly[c]
            cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
            if cr <= 1e-12:
                continue
            ok = True
            for j in idx:
                if j in (a, b, c):
                    continue
                p = poly[j]
                d1 = (pb[0] - pa[0]) * (p[1] - pa[1]) - (pb[1] - pa[1]) * (p[0] - pa[0])
                d2 = (pc[0] - pb[0]) * (p[1] - pb[1]) - (pc[1] - pb[1]) * (p[0] - pb[0])
                d3 = (pa[0] - pc[0]) * (p[1] - pc[1]) - (pa[1] - pc[1]) * (p[0] - pc[0])
                if d1 >= 0 and d2 >= 0 and d3 >= 0:
                    ok = False
                    break
            if ok:
                tris.append((a, b, c))
                idx.pop(k)
                found = True
                break
        if not found:
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def slab(poly, depth, mat, tint=(1, 1, 1), jitter=0.04, side_mat=None, flags=0, grain_z=True, uvo=None):
    """2D polygon in the XZ plane (x, z pairs) extruded along +Y by `depth` (y from 0 to depth).
    Front (-Y) and back faces UV (x, z); sides U along the depth, V along the edge (or z when grain_z)."""
    me = Mesh()
    tint = _jit(tint, jitter)
    if uvo is None:
        uvo = (rnd(0, 4), rnd(0, 4))
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    pts = list(poly) if area > 0 else list(reversed(poly))
    f = [me.vert((x, 0.0, z)) for x, z in pts]
    b = [me.vert((x, depth, z)) for x, z in pts]
    tris = _ear_clip(pts)
    for a_, b_, c_ in tris:
        # front face normal -Y: CCW in (x, z) seen from -Y is clockwise in Blender -> order a, c, b? (x right, z up
        # seen from -Y looking +Y: right-handed x,z with view along +y gives normal -y for CCW (x,z)).
        me.face([f[a_], f[b_], f[c_]], [(pts[k][0] + uvo[0], pts[k][1] + uvo[1]) for k in (a_, b_, c_)], mat, False,
                tint, flags)
        me.face([b[c_], b[b_], b[a_]], [(pts[k][0] + uvo[0], pts[k][1] + uvo[1]) for k in (c_, b_, a_)], mat, False,
                tint, flags)
    sm = side_mat or mat
    acc = 0.0
    for i in range(n):
        j = (i + 1) % n
        el = math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])
        if grain_z:
            uvs = [(0 + uvo[0], pts[i][1]), (0 + uvo[0], pts[j][1]), (depth + uvo[0], pts[j][1]), (depth + uvo[0], pts[i][1])]
        else:
            uvs = [(0, acc), (0, acc + el), (depth, acc + el), (depth, acc)]
        me.face([f[i], f[j], b[j], b[i]][::-1], uvs[::-1], sm, False, tint, flags)
        acc += el
    # verify orientation: front face normal should be -Y
    return me


def heightpatch(w, d, res, fn, mat, tint=(1, 1, 1), flags=0, smooth_=True, uvs_scale=1.0, cx=0.0, cy=0.0):
    """Grid w x d (m) centred at (cx, cy), z = fn(x, y) (x, y in patch-local metres from the centre)."""
    me = Mesh()
    nx = max(1, int(round(w / res)))
    ny = max(1, int(round(d / res)))
    ids = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = -w / 2 + w * i / nx
            y = -d / 2 + d * j / ny
            row.append(me.vert((x + cx, y + cy, fn(x, y))))
        ids.append(row)
    for j in range(ny):
        for i in range(nx):
            q = [ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]]
            me.face(q, [(me.v[k].x * uvs_scale, me.v[k].y * uvs_scale) for k in q], mat, smooth_, tint, flags)
    return me


def blob(center, radii, mat, n=10, rough=0.25, seed_=0.0, tint=(1, 1, 1), flat_bottom=True, rings=7, flags=0):
    """Irregular rock / snow lump: a noisy ellipsoid (UV box-ish from position, metres)."""
    me = Mesh()
    c = Vector(center)
    ids = []
    for j in range(rings + 1):
        th = math.pi * j / rings
        row = []
        for i in range(n):
            ph = 2 * math.pi * i / n
            d = Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
            k = 1.0 + rough * fbm(d * 1.7, 1.0, 3, seed_)
            p = Vector((d.x * radii[0] * k, d.y * radii[1] * k, d.z * radii[2] * k))
            if flat_bottom and p.z < -radii[2] * 0.25:
                p.z = -radii[2] * 0.25 + (p.z + radii[2] * 0.25) * 0.15
            row.append(me.vert(c + p))
        ids.append(row)
    for j in range(rings):
        for i in range(n):
            i2 = (i + 1) % n
            q = [ids[j][i], ids[j + 1][i], ids[j + 1][i2], ids[j][i2]]
            uvs = []
            for kk in q:
                p = me.v[kk] - c
                uvs.append((p.x + p.y * 0.7, p.z + p.y * 0.3))
            me.face(q, uvs, mat, True, tint, flags)
    return me


def merge(*meshes):
    out = Mesh()
    for m in meshes:
        out.extend(m)
    return out


# ------------------------------------------------------------------------------------------------ Site

def _to_godot_basis(M3):
    C = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
    return C @ M3 @ C.transposed()


def _to_godot_pos(p):
    return Vector((p[0], p[2], -p[1]))


def gd_transform(M):
    """Blender-space 4x4 -> Godot Transform3D(...) string."""
    B = _to_godot_basis(M.to_3x3())
    o = _to_godot_pos(M.to_translation())
    vals = [B[0][0], B[0][1], B[0][2], B[1][0], B[1][1], B[1][2], B[2][0], B[2][1], B[2][2], o.x, o.y, o.z]
    return "Transform3D(%s)" % ", ".join(_f(v) for v in vals)


def _f(v):
    s = "%.5f" % v
    s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Site:
    def __init__(self, sid, ground=True, interior=False, seed_=1):
        self.id = sid
        self.buckets = {}
        self.ranges = {}
        self.shadow = {}
        self.cols = []
        self.markers = []
        self.lights = []
        self.probes = []
        self.shelters = []
        self.heat = []
        self.doors = []
        self.extra = []
        self.ground = ground
        self.interior = interior
        self.occluders = Mesh()   # geometry that only shadows the AO bake (terrain stand-ins)
        self.meta = {}
        seed(seed_)

    # geometry ---------------------------------------------------------------------------------------------
    def bucket(self, name, vis_end=0.0, shadow=True, vis_begin=0.0):
        if name not in self.buckets:
            self.buckets[name] = Mesh()
            self.ranges[name] = (vis_begin, vis_end)
            self.shadow[name] = shadow
        return self.buckets[name]

    def add(self, mesh, M=None, bucket="main", tint=None, mat=None, flags=None):
        if bucket not in self.buckets:
            self.bucket(bucket)
        self.buckets[bucket].extend(mesh, M, tint, mat, flags)
        return mesh

    # collision ----------------------------------------------------------------------------------------------
    def col_box(self, surface, center, size, rot=None):
        """Oriented collision box. rot: 3x3/4x4 rotation (Blender space) or None."""
        R = Matrix.Identity(4) if rot is None else (rot.to_4x4() if len(rot) == 3 else rot.copy())
        R.translation = Vector((0, 0, 0))
        M = T(center) @ R
        self.cols.append((surface, M, Vector(size)))

    def col_beam(self, surface, p0, p1, w, h, up=(0, 0, 1)):
        p0 = Vector(p0)
        p1 = Vector(p1)
        d = p1 - p0
        self.col_box(surface, (p0 + p1) * 0.5, (w, h, d.length), look_basis(d, up))

    def col_mesh_box(self, surface, mesh, M=None, pad=0.0):
        """Axis-aligned (in the mesh's local frame) bounding box of `mesh`, placed with M."""
        lo, hi = mesh.bounds()
        c = (lo + hi) * 0.5
        size = hi - lo + Vector((pad, pad, pad))
        M = M or Matrix.Identity(4)
        self.col_box(surface, M @ c, size, M)

    # sockets / lights -----------------------------------------------------------------------------------------
    def marker(self, name, loc, yaw=0.0, pitch=0.0):
        """Marker3D socket. yaw (deg) like the Godot player: 0 faces north (+Y here), 90 faces west."""
        self.markers.append((name, T(loc) @ RZ(yaw) @ RX(pitch)))

    def light(self, name, loc, color=(1.0, 0.8, 0.6), energy=1.0, rng=6.0, kind="omni", shadow=False,
              yaw=0.0, pitch=-90.0, angle=45.0, group="Lights_Interior", attenuation=1.0, visible=True):
        self.lights.append(dict(name=name, M=T(loc) @ RZ(yaw) @ RX(pitch), color=color, energy=energy, range=rng,
                                kind=kind, shadow=shadow, angle=angle, group=group, att=attenuation,
                                visible=visible))

    def probe(self, name, center, size, ambient=(0.05, 0.05, 0.06), energy=1.0, interior=True, intensity=1.0):
        self.probes.append(dict(name=name, center=Vector(center), size=Vector(size), ambient=ambient,
                                energy=energy, interior=interior, intensity=intensity))

    def shelter(self, name, center, size, factor=1.0, yaw=0.0):
        self.shelters.append(dict(name=name, M=T(center) @ RZ(yaw), size=Vector(size), factor=factor))

    def door(self, name, loc, yaw, size, target_site, target_socket, prompt="Enter", locked_flag=""):
        """Interactable transition (scenes/poi/poi_door.gd) on layer 5 at loc; box size (w, d, h) in the door's frame."""
        self.doors.append(dict(name=name, M=T(loc) @ RZ(yaw), size=Vector(size), site=target_site, socket=target_socket,
                               prompt=prompt, flag=locked_flag))

    def heat_source(self, name, loc, radius=4.0, celsius=18.0, active=False):
        self.heat.append(dict(name=name, loc=Vector(loc), radius=radius, celsius=celsius, active=active))

    # stats -----------------------------------------------------------------------------------------------------
    def tris(self, buckets=None):
        return sum(m.tris() for k, m in self.buckets.items() if buckets is None or k in buckets)


# ------------------------------------------------------------------------------------------------ vertex bake

def _hemi_dirs(n, seed_):
    r = random.Random(seed_)
    out = []
    k = int(math.sqrt(n))
    for i in range(k):
        for j in range(k):
            u = (i + r.random()) / k
            v = (j + r.random()) / k
            ph = 2 * math.pi * v
            st = math.sqrt(u)
            out.append(Vector((st * math.cos(ph), st * math.sin(ph), math.sqrt(max(0.0, 1 - u)))))
    return out


def _cone_dirs(n, half_deg, seed_):
    r = random.Random(seed_)
    out = []
    ch = math.cos(math.radians(half_deg))
    for i in range(n):
        z = lerp(ch, 1.0, (i + r.random()) / n)
        ph = 2 * math.pi * ((i * 0.618034 + r.random() * 0.2) % 1.0)
        s = math.sqrt(max(0.0, 1 - z * z))
        out.append(Vector((s * math.cos(ph), s * math.sin(ph), z)))
    return out


def bake_colors(site, near=0.9, far=24.0, n_near=16, n_far=9, n_up=7, verbose=True):
    """Per face-corner linear colours: tint x AO x openness x grime; alpha = sky exposure."""
    import time
    t0 = time.time()
    verts = []
    polys = []
    for m in list(site.buckets.values()) + [site.occluders]:
        off = len(verts)
        verts.extend(m.v)
        for f in m.f:
            polys.append([i + off for i in f])
    if site.ground:
        g = 300.0
        off = len(verts)
        verts.extend([Vector((-g, -g, -0.03)), Vector((g, -g, -0.03)), Vector((g, g, -0.03)), Vector((-g, g, -0.03))])
        polys.append([off, off + 1, off + 2, off + 3])
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    hemi = _hemi_dirs(n_near, 3)
    hemi_far = _hemi_dirs(n_far, 5)
    up = _cone_dirs(n_up, 55.0, 7)
    out = {}
    cache = {}
    nrays = 0
    for bname, m in site.buckets.items():
        cols = []
        for fi, f in enumerate(m.f):
            fl = m.fl[fi]
            tint = m.t[fi]
            # Newell normal
            nrm = Vector((0, 0, 0))
            for a in range(len(f)):
                p = m.v[f[a]]
                q = m.v[f[(a + 1) % len(f)]]
                nrm.x += (p.y - q.y) * (p.z + q.z)
                nrm.y += (p.z - q.z) * (p.x + q.x)
                nrm.z += (p.x - q.x) * (p.y + q.y)
            if nrm.length < 1e-12:
                nrm = Vector((0, 0, 1))
            nrm.normalize()
            fc = []
            for vi in f:
                p = m.v[vi]
                if fl & F_NOAO and fl & (F_NOEXP | F_EXP):
                    fc.append((tint[0], tint[1], tint[2], 0.0 if fl & F_NOEXP else 1.0))
                    continue
                key = (bname, vi, round(nrm.x, 1), round(nrm.y, 1), round(nrm.z, 1))
                res = cache.get(key)
                if res is None:
                    rot = nrm.to_track_quat('Z', 'Y').to_matrix()
                    spin = Matrix.Rotation((vi * 2.39996) % (2 * math.pi), 3, 'Z')
                    R = rot @ spin
                    o = p + nrm * 0.015
                    hit = 0
                    for d in hemi:
                        dd = R @ d
                        loc, _n, _i, dist = bvh.ray_cast(o, dd, near)
                        if loc is not None:
                            hit += 1.0 - (dist / near) * 0.5
                    ao = 1.0 - hit / len(hemi)
                    op = 1.0
                    if not site.interior:
                        hf = 0
                        for d in hemi_far:
                            loc, _n, _i, dist = bvh.ray_cast(o + (R @ d) * near * 0.5, R @ d, far)
                            if loc is not None:
                                hf += 1
                        op = 1.0 - hf / len(hemi_far)
                    ex = 0.0
                    o2 = p + nrm * 0.05 + Vector((0, 0, 0.02))
                    for d in up:
                        loc, _n, _i, dist = bvh.ray_cast(o2, d, 80.0)
                        if loc is None:
                            ex += 1
                    ex /= len(up)
                    nrays += len(hemi) + (0 if site.interior else len(hemi_far)) + len(up)
                    res = (ao, op, ex)
                    cache[key] = res
                ao, op, ex = res
                if fl & F_NOAO:
                    k = 1.0
                else:
                    k = (0.28 + 0.72 * ao ** 1.3) * (0.66 + 0.34 * op)
                    if site.ground and not site.interior:
                        # grime / splash-back near the ground
                        k *= 0.82 + 0.18 * smooth(0.0, 0.7, p.z)
                if fl & F_NOEXP:
                    ex = 0.0
                elif fl & F_EXP:
                    ex = 1.0
                fc.append((tint[0] * k, tint[1] * k, tint[2] * k, ex))
            cols.append(fc)
        out[bname] = cols
    if verbose:
        print("[poi] %s: baked %d rays in %.1fs" % (site.id, nrays, time.time() - t0))
    return out


# ------------------------------------------------------------------------------------------------ export

_BMATS = {}


def _bmat(name):
    if name in _BMATS:
        return _BMATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    _BMATS[name] = m
    return m


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    _BMATS.clear()


def to_object(name, m, cols):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in m.v], [], m.f)
    me.update(calc_edges=True)
    # Create every layer first, then fetch fresh references: adding a layer reallocates the CustomData arrays
    # and silently invalidates older Python handles (writes would land in the wrong layer).
    me.uv_layers.new(name="UVMap")
    me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='CORNER')
    uvl = me.uv_layers["UVMap"]
    ca = me.color_attributes["Col"]
    nloops = len(me.loops)
    uv_flat = [0.0] * (nloops * 2)
    col_flat = [0.0] * (nloops * 4)
    mats = []
    mat_idx = []
    for pi, poly in enumerate(me.polygons):
        ls = poly.loop_start
        for k in range(poly.loop_total):
            u, v = m.uv[pi][k]
            uv_flat[(ls + k) * 2] = u
            uv_flat[(ls + k) * 2 + 1] = v
            c = cols[pi][k]
            col_flat[(ls + k) * 4:(ls + k) * 4 + 4] = c
        if m.m[pi] not in mats:
            mats.append(m.m[pi])
        mat_idx.append(mats.index(m.m[pi]))
    uvl.data.foreach_set("uv", uv_flat)
    ca.data.foreach_set("color", col_flat)
    me.polygons.foreach_set("material_index", mat_idx)
    me.polygons.foreach_set("use_smooth", [bool(x) for x in m.s])
    me.color_attributes.active_color = ca
    try:
        me.color_attributes.render_color_index = 0
    except Exception:
        pass
    for mt in mats:
        me.materials.append(_bmat(mt))
    me.use_auto_smooth = True
    me.auto_smooth_angle = math.radians(38.0)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, mats


def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
              export_normals=True, export_tangents=False, export_texcoords=True, export_materials='EXPORT',
              export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
              export_lights=False, export_image_format='NONE')
    try:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    except TypeError:
        kw.pop("export_image_format", None)
        bpy.ops.export_scene.gltf(**kw)


def remove_faces(me, pred):
    """Drops faces for which pred(center, face_index) is True (vertices stay; unused ones are harmless)."""
    keep = []
    for i, f in enumerate(me.f):
        c = sum((me.v[j] for j in f), Vector()) / len(f)
        if not pred(c, i):
            keep.append(i)
    me.f = [me.f[i] for i in keep]
    me.uv = [me.uv[i] for i in keep]
    me.m = [me.m[i] for i in keep]
    me.s = [me.s[i] for i in keep]
    me.t = [me.t[i] for i in keep]
    me.fl = [me.fl[i] for i in keep]
    return me


def flip(me):
    me.f = [list(reversed(f)) for f in me.f]
    me.uv = [list(reversed(u)) for u in me.uv]
    return me


def face_normal(me, i):
    f = me.f[i]
    n = Vector((0, 0, 0))
    for a in range(len(f)):
        p = me.v[f[a]]
        q = me.v[f[(a + 1) % len(f)]]
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))


# ------------------------------------------------------------------------------------------------ terrain

class Ground:
    """Real terrain heights around a POI (assets/terrain/height.f32 + data/world_layout.json), relative to the
    anchor height, in the site's local frame (Blender axes; the site is placed with Godot yaw `yaw`).
    Falls back to flat ground when the terrain files are missing."""
    _H = None

    def __init__(self, poi_id, yaw=0.0, at=None):
        import json
        self.ok = False
        self.yaw = math.radians(yaw)
        try:
            import numpy as np
            if Ground._H is None:
                Ground._H = np.fromfile(os.path.join(ROOT, "assets", "terrain", "height.f32"),
                                        dtype=np.float32).reshape(2049, 2049)
            L = json.load(open(os.path.join(ROOT, "data", "world_layout.json")))
            p = [q for q in L["pois"] if q["id"] == poi_id][0]
            if at:
                p = dict(p)
                p["x"], p["z"] = at
            self.ax, self.az = p["x"], p["z"]
            self.base = self._hw(self.ax, self.az)
            self.ok = True
        except Exception as e:  # noqa: BLE001
            print("[poi] Ground: flat fallback for", poi_id, e)

    def _hw(self, x, z):
        H = Ground._H
        i = min(max((x + 1536.0) / 1.5, 0.0), 2047.999)
        j = min(max((z + 1536.0) / 1.5, 0.0), 2047.999)
        i0, j0 = int(i), int(j)
        fx, fz = i - i0, j - j0
        return float(H[j0, i0] * (1 - fx) * (1 - fz) + H[j0, i0 + 1] * fx * (1 - fz) + H[j0 + 1, i0] * (1 - fx) * fz
                     + H[j0 + 1, i0 + 1] * fx * fz)

    def world(self, lx, ly):
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        bx, by = lx * c - ly * s, lx * s + ly * c
        return self.ax + bx, self.az - by

    def h(self, lx, ly):
        if not self.ok:
            return 0.0
        x, z = self.world(lx, ly)
        return self._hw(x, z) - self.base

    def slope_frame(self, lx, ly, d=0.6):
        """4x4 rotation tilting +Z to the local ground normal at (lx, ly)."""
        hx = (self.h(lx + d, ly) - self.h(lx - d, ly)) / (2 * d)
        hy = (self.h(lx, ly + d) - self.h(lx, ly - d)) / (2 * d)
        n = Vector((-hx, -hy, 1.0)).normalized()
        q = Vector((0, 0, 1)).rotation_difference(n)
        return q.to_matrix().to_4x4()

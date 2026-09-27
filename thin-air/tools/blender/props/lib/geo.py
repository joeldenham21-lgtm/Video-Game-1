"""THIN AIR props — geometry builder.

Models are authored in GODOT space (metres, +Y up, -Z forward, +X right) so first-person frames and
item orientations can be written exactly as the game code expects them; `MB.to_object()` converts to
Blender space (x, -z, y) and the glTF exporter (+Y up) converts back.

`MB` collects vertices and faces. Every face carries a material key and two UV sets:
  tile  - metric texture coordinates (1 unit = 1 m) used to sample tiling library textures when baking;
  atlas - the layout that gets packed into the model's unique 0..1 atlas (defaults to tile; primitives may
          split long islands so packing stays dense).
Primitives: lathe, tube (swept section along a path), prism (extruded outline), slab (two-sided shaped
blade with thickness function), box, grid sheets and noise blobs. Object-level helpers apply Blender
modifiers (bevel, subdivision, decimate, remesh, displace, solidify, boolean) without operators.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector, noise

TAU = math.tau


def V(x, y=None, z=None):
    if y is None:
        return Vector(x)
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))) if e1 != e0 else (1.0 if x >= e1 else 0.0)
    return t * t * (3.0 - 2.0 * t)


def clamp(x, a, b):
    return max(a, min(b, x))


def rot(axis, deg):
    """Rotation matrix (4x4) about a Godot-space axis ('X','Y','Z' or vector)."""
    if isinstance(axis, str):
        axis = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[axis]
    return Matrix.Rotation(math.radians(deg), 4, Vector(axis))


def trs(t=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    """Translate * RotZ*RotY*RotX (degrees, Godot euler order YXZ-ish is irrelevant here) * Scale."""
    m = Matrix.Translation(Vector(t))
    m = m @ rot("Y", r[1]) @ rot("X", r[0]) @ rot("Z", r[2])
    sc = Matrix.Diagonal((s[0], s[1], s[2], 1.0)) if not isinstance(s, (int, float)) else Matrix.Diagonal((s, s, s, 1.0))
    return m @ sc


def basis_from(x=None, y=None, z=None, origin=(0, 0, 0)):
    """4x4 matrix from two or three axis vectors (the third is derived)."""
    if x is not None:
        x = Vector(x).normalized()
    if y is not None:
        y = Vector(y).normalized()
    if z is not None:
        z = Vector(z).normalized()
    if x is None:
        x = y.cross(z).normalized()
        z = x.cross(y).normalized()
    elif y is None:
        y = z.cross(x).normalized()
        z = x.cross(y).normalized()
    elif z is None:
        z = x.cross(y).normalized()
        y = z.cross(x).normalized()
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0] = x[i]
        m[i][1] = y[i]
        m[i][2] = z[i]
        m[i][3] = origin[i]
    return m


class Face:
    __slots__ = ("idx", "mat", "uvt", "uva", "smooth")

    def __init__(self, idx, mat, uvt, uva, smooth):
        self.idx = idx
        self.mat = mat
        self.uvt = uvt
        self.uva = uva
        self.smooth = smooth


class MB:
    """Mesh builder in Godot space."""

    def __init__(self):
        self.v = []
        self.f = []
        self.vcol = {}   # vertex index -> (r,g,b) optional mask colour (e.g. honed edge = red)

    # ---------------------------------------------------------------- raw
    def add(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, mat, uvt=None, uva=None, smooth=True):
        idx = tuple(idx)
        if uvt is None:
            uvt = tuple((0.0, 0.0) for _ in idx)
        if uva is None:
            uva = uvt
        self.f.append(Face(idx, mat, tuple(tuple(u) for u in uvt), tuple(tuple(u) for u in uva), smooth))

    def merge(self, other, m=None):
        base = len(self.v)
        for p in other.v:
            self.v.append((m @ p) if m is not None else p.copy())
        for fc in other.f:
            self.f.append(Face(tuple(i + base for i in fc.idx), fc.mat, fc.uvt, fc.uva, fc.smooth))
        for k, c in other.vcol.items():
            self.vcol[k + base] = c
        return self

    def xform(self, m, start=0):
        """Transforms vertices from index `start` (a section just built)."""
        m = Matrix(m)
        for i in range(start, len(self.v)):
            self.v[i] = m @ self.v[i]
        return self

    def mark(self):
        return len(self.v), len(self.f)

    def deform(self, fn, start=0):
        for i in range(start, len(self.v)):
            self.v[i] = Vector(fn(self.v[i]))
        return self

    def set_mat(self, mat, face_start=0):
        for fc in self.f[face_start:]:
            fc.mat = mat
        return self

    def tris(self):
        return sum(len(fc.idx) - 2 for fc in self.f)

    def bounds(self):
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for p in self.v:
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        return lo, hi

    # ---------------------------------------------------------------- primitives
    def lathe(self, profile, seg=24, mat="default", m=None, a0=0.0, a1=TAU, uv_scale=1.0, cap_min=0.0005,
              smooth=True, chunk=None, flip=False):
        """Surface of revolution about +Y. profile: [(r, y), ...] bottom->top. Radii <= cap_min close to a
        pole. tile UV: u = arc length (m) at the average radius, v = profile length (m)."""
        s0 = len(self.v)
        full = abs((a1 - a0) - TAU) < 1e-6
        nseg = seg
        cols = nseg if full else nseg + 1
        rings = []
        rmean = max(1e-4, sum(p[0] for p in profile) / len(profile))
        vlen = [0.0]
        for i in range(1, len(profile)):
            d = math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1])
            vlen.append(vlen[-1] + d)
        for (r, y) in profile:
            if r <= cap_min:
                rings.append([self.add((0.0, y, 0.0))])
                continue
            ring = []
            for j in range(cols):
                a = a0 + (a1 - a0) * j / nseg
                ring.append(self.add((math.cos(a) * r, y, -math.sin(a) * r)))
            rings.append(ring)
        arc = (a1 - a0) * rmean * uv_scale
        for i in range(len(profile) - 1):
            ra, rb = rings[i], rings[i + 1]
            va, vb = vlen[i] * uv_scale, vlen[i + 1] * uv_scale
            ca = 0.0
            if chunk:
                ca = math.floor(va / chunk) * chunk * 0.0
            for j in range(nseg):
                j1 = (j + 1) % cols if full else j + 1
                u0 = arc * j / nseg
                u1 = arc * (j + 1) / nseg
                if len(ra) == 1 and len(rb) == 1:
                    continue
                if len(ra) == 1:
                    idx = (ra[0], rb[j], rb[j1])
                    uv = ((0.5 * (u0 + u1), va), (u0, vb), (u1, vb))
                elif len(rb) == 1:
                    idx = (ra[j], ra[j1], rb[0])
                    uv = ((u0, va), (u1, va), (0.5 * (u0 + u1), vb))
                else:
                    idx = (ra[j], ra[j1], rb[j1], rb[j])
                    uv = ((u0, va), (u1, va), (u1, vb), (u0, vb))
                if flip:
                    idx = tuple(reversed(idx))
                    uv = tuple(reversed(uv))
                self.face(idx, mat, uv, None, smooth)
        if m is not None:
            self.xform(m, s0)
        return s0

    def disc(self, r, y, seg=24, mat="default", up=True, m=None, r_in=0.0):
        """Flat cap (n-gon or annulus) facing +Y (up=True) or -Y. tile UV = planar metres."""
        s0 = len(self.v)
        outer = [self.add((math.cos(TAU * j / seg) * r, y, -math.sin(TAU * j / seg) * r)) for j in range(seg)]
        uvo = [(0.5 + math.cos(TAU * j / seg) * r, 0.5 + math.sin(TAU * j / seg) * r) for j in range(seg)]
        if r_in <= 0.0:
            idx = outer if up else list(reversed(outer))
            uv = uvo if up else list(reversed(uvo))
            self.face(idx, mat, uv, None, False)
        else:
            inner = [self.add((math.cos(TAU * j / seg) * r_in, y, -math.sin(TAU * j / seg) * r_in)) for j in range(seg)]
            uvi = [(0.5 + math.cos(TAU * j / seg) * r_in, 0.5 + math.sin(TAU * j / seg) * r_in) for j in range(seg)]
            for j in range(seg):
                j1 = (j + 1) % seg
                idx = (outer[j], outer[j1], inner[j1], inner[j])
                uv = (uvo[j], uvo[j1], uvi[j1], uvi[j])
                if not up:
                    idx = tuple(reversed(idx))
                    uv = tuple(reversed(uv))
                self.face(idx, mat, uv, None, False)
        if m is not None:
            self.xform(m, s0)
        return s0

    def tube(self, path, radius, seg=12, mat="default", closed=False, cap0=True, cap1=True, up=None,
             section=None, twist=0.0, uv_scale=1.0, chunk=None, smooth=True, cap_mat=None, u_offset=0.0):
        """Sweeps a cross-section along `path` (list of points). radius: float, list of floats or list of
        (rx, ry) per point (rx along the frame's side axis, ry along its normal axis). `section`: optional
        list of unit 2D points (closed polygon, CCW) replacing the circle. Frames are parallel-transported
        from `up`. tile UV: u around (m), v along (m). `chunk`: split atlas islands every N metres."""
        s0 = len(self.v)
        pts = [Vector(p) for p in path]
        n = len(pts)
        if n < 2:
            return s0
        if isinstance(radius, (int, float)):
            radius = [radius] * n
        elif isinstance(radius, tuple) and len(radius) == 2 and all(isinstance(r, (int, float)) for r in radius):
            radius = [radius] * n          # a tuple (rx, ry) = one elliptical radius; lists are per point
        rad = [(r, r) if isinstance(r, (int, float)) else (r[0], r[1]) for r in radius]
        if section is None:
            section = [(math.cos(TAU * j / seg), math.sin(TAU * j / seg)) for j in range(seg)]
        seg = len(section)
        # tangents
        tang = []
        for i in range(n):
            if closed:
                t = pts[(i + 1) % n] - pts[i - 1]
            elif i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            if t.length < 1e-9:
                t = Vector((0, 1, 0))
            tang.append(t.normalized())
        # parallel transport
        if up is None:
            up = Vector((0, 0, 1)) if abs(tang[0].z) < 0.9 else Vector((1, 0, 0))
        up = Vector(up)
        nrm = (up - tang[0] * up.dot(tang[0])).normalized()
        frames = []
        for i in range(n):
            if i > 0:
                a = tang[i - 1]
                b = tang[i]
                ax = a.cross(b)
                if ax.length > 1e-9:
                    ang = a.angle(b)
                    nrm = Matrix.Rotation(ang, 3, ax.normalized()) @ nrm
                nrm = (nrm - b * nrm.dot(b)).normalized()
            side = nrm.cross(tang[i]).normalized()
            if twist:
                tw = math.radians(twist) * i / max(1, n - 1)
                c, s = math.cos(tw), math.sin(tw)
                nrm2 = nrm * c + side * s
                side2 = side * c - nrm * s
                frames.append((side2, nrm2))
            else:
                frames.append((side, nrm))
        # section perimeter for UV
        per = []
        acc = 0.0
        rmean = sum((r[0] + r[1]) * 0.5 for r in rad) / n
        for j in range(seg + 1):
            per.append(acc)
            a = section[j % seg]
            b = section[(j + 1) % seg]
            acc += math.hypot(b[0] - a[0], b[1] - a[1]) * rmean
        rings = []
        for i in range(n):
            side, nr = frames[i]
            ring = []
            for j in range(seg):
                sx, sy = section[j]
                ring.append(self.add(pts[i] + side * (sx * rad[i][0]) + nr * (sy * rad[i][1])))
            rings.append(ring)
        vl = [0.0]
        for i in range(1, n):
            vl.append(vl[-1] + (pts[i] - pts[i - 1]).length)
        if closed:
            vl.append(vl[-1] + (pts[0] - pts[-1]).length)
        segs = n if closed else n - 1
        for i in range(segs):
            i1 = (i + 1) % n
            va, vb = vl[i] * uv_scale, vl[i + 1] * uv_scale
            if chunk:
                k = math.floor(vl[i] / chunk)
                ao = k * chunk * uv_scale
                aa, ab = va - ao, vb - ao
                ua_off = k * (per[-1] * uv_scale + 0.05)
            else:
                aa, ab, ua_off = va, vb, 0.0
            for j in range(seg):
                j1 = (j + 1) % seg
                u0 = per[j] * uv_scale + u_offset
                u1 = per[j + 1] * uv_scale + u_offset
                idx = (rings[i][j], rings[i][j1], rings[i1][j1], rings[i1][j])
                uvt = ((u0, va), (u1, va), (u1, vb), (u0, vb))
                uva = ((u0 + ua_off, aa), (u1 + ua_off, aa), (u1 + ua_off, ab), (u0 + ua_off, ab))
                self.face(idx, mat, uvt, uva, smooth)
        if not closed:
            cm = cap_mat or mat
            for (ring, ci, flip) in ((rings[0], 0, True), (rings[-1], n - 1, False)):
                if (ci == 0 and not cap0) or (ci == n - 1 and not cap1):
                    continue
                side, nr = frames[ci]
                uv = [(section[j][0] * rad[ci][0] + 0.5, section[j][1] * rad[ci][1] + 0.5) for j in range(seg)]
                idx = list(ring)
                if flip:
                    idx.reverse()
                    uv.reverse()
                # frame handedness: side x nrm = tangent -> ring CCW around +tangent
                self.face(idx, cm, uv, None, False)
        return s0

    def box(self, size, center=(0, 0, 0), mat="default", m=None, uv_scale=1.0, faces="xXyYzZ"):
        """Axis-aligned box (6 quads, metric box-projected UVs)."""
        s0 = len(self.v)
        hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
        c = Vector(center)
        P = [c + Vector((sx * hx, sy * hy, sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        ids = [self.add(p) for p in P]

        def I(sx, sy, sz):
            return ids[(0 if sx < 0 else 4) + (0 if sy < 0 else 2) + (0 if sz < 0 else 1)]
        quads = {
            "X": [I(1, -1, 1), I(1, -1, -1), I(1, 1, -1), I(1, 1, 1)],
            "x": [I(-1, -1, -1), I(-1, -1, 1), I(-1, 1, 1), I(-1, 1, -1)],
            "Y": [I(-1, 1, 1), I(1, 1, 1), I(1, 1, -1), I(-1, 1, -1)],
            "y": [I(-1, -1, -1), I(1, -1, -1), I(1, -1, 1), I(-1, -1, 1)],
            "Z": [I(-1, -1, 1), I(1, -1, 1), I(1, 1, 1), I(-1, 1, 1)],
            "z": [I(1, -1, -1), I(-1, -1, -1), I(-1, 1, -1), I(1, 1, -1)],
        }
        for k in faces:
            q = quads[k]
            uv = [self._proj_uv(self.v[i], k.upper(), uv_scale) for i in q]
            self.face(q, mat, uv, None, False)
        if m is not None:
            self.xform(m, s0)
        return s0

    @staticmethod
    def _proj_uv(p, axis, s=1.0):
        if axis == "X":
            return (p.z * s, p.y * s)
        if axis == "Y":
            return (p.x * s, p.z * s)
        return (p.x * s, p.y * s)

    def prism(self, outline, depth, mat="default", m=None, cap_mat=None, uv_scale=1.0, z0=None, smooth_sides=False,
              side_mat=None):
        """Extrudes a closed 2D outline (x, y; CCW) along Z from z0 (default -depth/2) to z0 + depth."""
        s0 = len(self.v)
        z0 = -depth * 0.5 if z0 is None else z0
        z1 = z0 + depth
        n = len(outline)
        back = [self.add((x, y, z0)) for (x, y) in outline]
        front = [self.add((x, y, z1)) for (x, y) in outline]
        cm = cap_mat or mat
        self.face(front, cm, [(x * uv_scale, y * uv_scale) for (x, y) in outline], None, False)
        self.face(list(reversed(back)), cm, [(-x * uv_scale, y * uv_scale) for (x, y) in reversed(outline)], None, False)
        acc = 0.0
        sm = side_mat or mat
        for i in range(n):
            j = (i + 1) % n
            d = math.hypot(outline[j][0] - outline[i][0], outline[j][1] - outline[i][1])
            idx = (back[i], back[j], front[j], front[i])
            uv = ((acc * uv_scale, z0 * uv_scale), ((acc + d) * uv_scale, z0 * uv_scale),
                  ((acc + d) * uv_scale, z1 * uv_scale), (acc * uv_scale, z1 * uv_scale))
            self.face(idx, sm, uv, None, smooth_sides)
            acc += d
        if m is not None:
            self.xform(m, s0)
        return s0

    def slab(self, shape, thick, nu, nv, mat="default", m=None, mask=None, uv_scale=1.0, edge_mat=None):
        """Two-sided shaped plate (blades, axe heads). shape(u,v)->(x,y) in the plate plane; thick(u,v)->
        full thickness along Z. mask(u,v)->0..1 stored as vertex colour R (honed edge / wear). Rim closes it."""
        s0 = len(self.v)
        top = []
        bot = []
        for i in range(nu + 1):
            u = i / nu
            rt, rb = [], []
            for j in range(nv + 1):
                v = j / nv
                x, y = shape(u, v)
                t = max(thick(u, v), 1e-5) * 0.5
                a = self.add((x, y, t))
                b = self.add((x, y, -t))
                if mask is not None:
                    c = mask(u, v)
                    self.vcol[a] = (c, 0, 0)
                    self.vcol[b] = (c, 0, 0)
                rt.append(a)
                rb.append(b)
            top.append(rt)
            bot.append(rb)
        P = self.v
        for i in range(nu):
            for j in range(nv):
                q = (top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1])
                self.face(q, mat, [(P[k].x * uv_scale, P[k].y * uv_scale) for k in q])
                q2 = (bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], bot[i][j])
                self.face(q2, mat, [(-P[k].x * uv_scale, P[k].y * uv_scale) for k in q2])
        em = edge_mat or mat
        # rim: walk the border u=0 (v up), v=1 (u up), u=1 (v down), v=0 (u down)
        border = [(0, j) for j in range(nv + 1)] + [(i, nv) for i in range(1, nu + 1)] + \
                 [(nu, j) for j in range(nv - 1, -1, -1)] + [(i, 0) for i in range(nu - 1, 0, -1)]
        acc = 0.0
        for k in range(len(border)):
            a = border[k]
            b = border[(k + 1) % len(border)]
            ta, tb = top[a[0]][a[1]], top[b[0]][b[1]]
            ba, bb = bot[a[0]][a[1]], bot[b[0]][b[1]]
            d = (P[tb] - P[ta]).length
            q = (ta, tb, bb, ba)
            ha = (P[ta] - P[ba]).length
            hb = (P[tb] - P[bb]).length
            uv = ((acc * uv_scale, 0), ((acc + d) * uv_scale, 0), ((acc + d) * uv_scale, hb * uv_scale),
                  (acc * uv_scale, ha * uv_scale))
            self.face(q, em, uv)
            acc += d
        if m is not None:
            self.xform(m, s0)
        return s0

    def grid(self, w, h, nx, ny, mat="default", fn=None, m=None, two_sided=False, back_mat=None, thickness=0.0,
             uv_scale=1.0, uv01=False):
        """Sheet in the XZ plane (y up) from -w/2..w/2, -h/2..h/2. fn(u, v, p) -> displaced point.
        two_sided: adds a back face offset by `thickness` along -normal (for paper/cloth)."""
        s0 = len(self.v)
        ids = []
        for i in range(nx + 1):
            col = []
            for j in range(ny + 1):
                u, v = i / nx, j / ny
                p = Vector(((u - 0.5) * w, 0.0, (v - 0.5) * h))
                if fn:
                    p = Vector(fn(u, v, p))
                col.append(self.add(p))
            ids.append(col)

        def uvf(i, j):
            if uv01:
                return (i / nx, 1.0 - j / ny)
            return ((i / nx - 0.5) * w * uv_scale, (0.5 - j / ny) * h * uv_scale)
        for i in range(nx):
            for j in range(ny):
                q = (ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j])
                self.face(q, mat, [uvf(i, j), uvf(i, j + 1), uvf(i + 1, j + 1), uvf(i + 1, j)])
        if two_sided:
            nrm = self._grid_normals(ids, nx, ny)
            bids = []
            for i in range(nx + 1):
                col = []
                for j in range(ny + 1):
                    col.append(self.add(self.v[ids[i][j]] - nrm[i][j] * thickness))
                bids.append(col)
            bm_ = back_mat or mat
            for i in range(nx):
                for j in range(ny):
                    q = (bids[i][j], bids[i + 1][j], bids[i + 1][j + 1], bids[i][j + 1])
                    self.face(q, bm_, [(-uvf(i, j)[0], uvf(i, j)[1]), (-uvf(i + 1, j)[0], uvf(i + 1, j)[1]),
                                       (-uvf(i + 1, j + 1)[0], uvf(i + 1, j + 1)[1]), (-uvf(i, j + 1)[0], uvf(i, j + 1)[1])])
            if thickness > 0.0:
                border = [(i, 0) for i in range(nx)] + [(nx, j) for j in range(ny)] + \
                         [(i, ny) for i in range(nx, 0, -1)] + [(0, j) for j in range(ny, 0, -1)]
                for k in range(len(border)):
                    a = border[k]
                    b = border[(k + 1) % len(border)]
                    q = (ids[a[0]][a[1]], bids[a[0]][a[1]], bids[b[0]][b[1]], ids[b[0]][b[1]])
                    self.face(q, bm_, [(k * 0.01, 0), (k * 0.01, thickness), ((k + 1) * 0.01, thickness), ((k + 1) * 0.01, 0)])
        if m is not None:
            self.xform(m, s0)
        return s0

    def _grid_normals(self, ids, nx, ny):
        out = []
        for i in range(nx + 1):
            col = []
            for j in range(ny + 1):
                a = self.v[ids[min(i + 1, nx)][j]] - self.v[ids[max(i - 1, 0)][j]]
                b = self.v[ids[i][min(j + 1, ny)]] - self.v[ids[i][max(j - 1, 0)]]
                n = b.cross(a)
                col.append(n.normalized() if n.length > 1e-12 else Vector((0, 1, 0)))
            out.append(col)
        return out

    def blob(self, center, radii, subdiv=3, mat="default", amp=0.0, freq=4.0, seed=0, octaves=3, m=None,
             flat_bottom=None, fn=None):
        """Noise-displaced ellipsoid from an icosphere (organic lumps: stones, resin, berries, meat).
        tile UVs are box-projected (materials on blobs should use object-space box mapping)."""
        s0 = len(self.v)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        bm.verts.ensure_lookup_table()
        idmap = {}
        c = Vector(center)
        off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
        for bv in bm.verts:
            d = bv.co.normalized()
            n = 0.0
            if amp:
                a = 1.0
                f = freq
                for _ in range(octaves):
                    n += noise.noise(d * f + off) * a
                    a *= 0.5
                    f *= 2.07
            r = 1.0 + amp * n
            p = Vector((d.x * radii[0] * r, d.y * radii[1] * r, d.z * radii[2] * r))
            if fn:
                p = Vector(fn(p, d))
            if flat_bottom is not None and p.y < -radii[1] * flat_bottom:
                p.y = -radii[1] * flat_bottom + (p.y + radii[1] * flat_bottom) * 0.15
            idmap[bv.index] = self.add(c + p)
        for bf in bm.faces:
            q = [idmap[v.index] for v in bf.verts]
            nrm = bf.normal
            ax = "X" if abs(nrm.x) >= max(abs(nrm.y), abs(nrm.z)) else ("Y" if abs(nrm.y) >= abs(nrm.z) else "Z")
            uv = [self._proj_uv(self.v[k], ax) for k in q]
            self.face(q, mat, uv)
        bm.free()
        if m is not None:
            self.xform(m, s0)
        return s0

    # ---------------------------------------------------------------- output
    def to_object(self, name, mats, smooth_angle=40.0, collection=None):
        """Creates a Blender object (Blender space). `mats`: callable key -> bpy material."""
        me = bpy.data.meshes.new(name)
        verts = [(p.x, -p.z, p.y) for p in self.v]
        faces = [fc.idx for fc in self.f]
        me.from_pydata(verts, [], faces)
        keys = []
        for fc in self.f:
            if fc.mat not in keys:
                keys.append(fc.mat)
        for k in keys:
            me.materials.append(mats(k))
        mi = {k: i for i, k in enumerate(keys)}
        uvt = me.uv_layers.new(name="tile")
        uva = me.uv_layers.new(name="atlas")
        li = 0
        for pi, fc in enumerate(self.f):
            poly = me.polygons[pi]
            poly.material_index = mi[fc.mat]
            poly.use_smooth = fc.smooth
            for k in range(len(fc.idx)):
                uvt.data[poly.loop_start + k].uv = fc.uvt[k]
                uva.data[poly.loop_start + k].uv = fc.uva[k]
        if self.vcol:
            ca = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
            for i in range(len(self.v)):
                c = self.vcol.get(i, (0, 0, 0))
                ca.data[i].color = (c[0], c[1], c[2], 1.0)
        me.validate(clean_customdata=False)
        me.update()
        if hasattr(me, "use_auto_smooth"):
            me.use_auto_smooth = True
            me.auto_smooth_angle = math.radians(smooth_angle)
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob


# ====================================================================== object helpers

def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True
    return ob


def bevel(ob, width, segments=2, angle=40.0, profile=0.5, clamp=True, apply=True, harden=False):
    md = ob.modifiers.new("Bevel", "BEVEL")
    md.width = width
    md.segments = segments
    md.limit_method = "ANGLE"
    md.angle_limit = math.radians(angle)
    md.profile = profile
    md.use_clamp_overlap = clamp
    md.harden_normals = harden
    md.miter_outer = "MITER_ARC"
    if apply:
        apply_modifiers(ob)
    return ob


def subsurf(ob, levels=1, apply=True, crease_edges=None):
    md = ob.modifiers.new("Subsurf", "SUBSURF")
    md.levels = levels
    md.render_levels = levels
    md.uv_smooth = "PRESERVE_BOUNDARIES"
    md.boundary_smooth = "ALL"
    if apply:
        apply_modifiers(ob)
    return ob


def decimate(ob, ratio=None, target_tris=None, apply=True):
    if target_tris is not None:
        cur = count_tris(ob)
        if cur <= target_tris:
            return ob
        ratio = target_tris / cur
    md = ob.modifiers.new("Decimate", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = max(0.02, min(1.0, ratio))
    md.use_collapse_triangulate = False
    if apply:
        apply_modifiers(ob)
    return ob


def weld(ob, dist=1e-5):
    md = ob.modifiers.new("Weld", "WELD")
    md.merge_threshold = dist
    apply_modifiers(ob)
    return ob


def solidify(ob, thickness, offset=-1.0, apply=True):
    md = ob.modifiers.new("Solidify", "SOLIDIFY")
    md.thickness = thickness
    md.offset = offset
    md.use_even_offset = True
    md.use_quality_normals = True
    if apply:
        apply_modifiers(ob)
    return ob


def remesh(ob, voxel, apply=True):
    md = ob.modifiers.new("Remesh", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = voxel
    md.use_smooth_shade = True
    if apply:
        apply_modifiers(ob)
    return ob


def boolean(ob, cutter, op="DIFFERENCE", apply=True, remove_cutter=True):
    md = ob.modifiers.new("Bool", "BOOLEAN")
    md.operation = op
    md.object = cutter
    md.solver = "EXACT"
    if apply:
        apply_modifiers(ob)
    if remove_cutter:
        me = cutter.data
        bpy.data.objects.remove(cutter, do_unlink=True)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return ob


def weighted_normals(ob, weight=50, apply=True):
    if hasattr(ob.data, "use_auto_smooth"):
        ob.data.use_auto_smooth = True
    md = ob.modifiers.new("WN", "WEIGHTED_NORMAL")
    md.weight = weight
    md.keep_sharp = True
    if apply:
        apply_modifiers(ob)
    return ob


def count_tris(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def join(objs, name):
    """Joins objects (same UV layer names) into the first; returns it renamed."""
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        objs[0].data.name = name
        return objs[0]
    target = objs[0]
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def mesh_noise(ob, amp, freq=10.0, seed=0, octaves=2, axis_mask=(1, 1, 1)):
    """Displaces vertices along their normals with Perlin noise (Blender space, object local)."""
    me = ob.data
    off = Vector((seed * 1.7, seed * 2.9, seed * 4.3))
    for v in me.vertices:
        n = 0.0
        a = 1.0
        f = freq
        for _ in range(octaves):
            n += noise.noise(v.co * f + off) * a
            a *= 0.5
            f *= 2.0
        d = v.normal * (n * amp)
        v.co.x += d.x * axis_mask[0]
        v.co.y += d.y * axis_mask[1]
        v.co.z += d.z * axis_mask[2]
    me.update()
    return ob


def ob_bounds(ob):
    """World-space (Blender) bounds of an object's mesh."""
    mw = ob.matrix_world
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for v in ob.data.vertices:
        w = mw @ v.co
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def godot_bounds(ob):
    lo, hi = ob_bounds(ob)
    # Blender (x, y, z) -> Godot (x, z, -y)
    return Vector((lo.x, lo.z, -hi.y)), Vector((hi.x, hi.z, -lo.y))


def translate_mesh(ob, gd_offset):
    """Moves mesh data by a Godot-space offset."""
    d = Vector((gd_offset[0], -gd_offset[2], gd_offset[1]))
    ob.data.transform(Matrix.Translation(d))
    ob.data.update()


def transform_mesh(ob, gd_matrix):
    """Applies a Godot-space 4x4 transform to the mesh data."""
    C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # godot -> blender
    Ci = C.inverted()
    ob.data.transform(C @ Matrix(gd_matrix) @ Ci)
    ob.data.update()


def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def empty(name, gd_pos, gd_basis=None, collection=None, size=0.02):
    """A socket empty at a Godot-space position (optional Godot-space 3x3/4x4 basis)."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = size
    C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    m = Matrix.Translation(Vector(gd_pos))
    if gd_basis is not None:
        m = m @ Matrix(gd_basis).to_4x4()
    e.matrix_world = C @ m @ C.inverted()
    (collection or bpy.context.scene.collection).objects.link(e)
    return e

"""THIN AIR fauna pipeline: shared library (Blender 4.0 Python, numpy).

A creature is described in "G-space" (Godot axes: +X right, +Y up, +Z back; the animal faces -Z,
metres, feet on y = 0) as a list of anatomical SDF primitives (tapered capsules = round cones,
ellipsoids, smooth-subtracted sockets), each owned by a bone and tagged with a coat region.

Pipeline (build_creature):
  1. SDF: smooth union (polynomial smin) of the primitives, fine value-noise skin displacement.
  2. Surface nets on a regular grid (numpy, vectorised) -> watertight quad mesh; Laplacian smoothing with
     re-projection onto the SDF; Blender decimate (collapse) to the target triangle count.
  3. Separate parts: lower jaw (own SDF so the mouth can open), ears (thin cupped shells), eyeballs.
  4. Armature (edit bones from the spec) + skin weights from primitive ownership: soft-min of the per-primitive
     distances, accumulated per bone (joints blend exactly where the anatomy blends).
  5. Smart-UV unwrap; the coat texture is BAKED by rasterising every triangle in UV space and evaluating the
     species' pattern function on the rest-pose 3D position/normal/region of each texel (RGB coat, A = fur length).
  6. Clips: procedural pose functions + planar 2-bone leg IK with pole vectors, driven by quadruped gait
     phase tables (lateral-sequence walk, diagonal trot, rotary gallop, stot, half-bound ...); written straight
     into action F-curves (quaternions kept hemisphere-continuous), one NLA track per action.
  7. glTF binary export (+Y up, -Z forward) and a JSON sidecar (clip lengths, native speeds, events, UV scale).

Everything is deterministic (seeded noise). See tools/README.md (fauna rows).
"""
import bpy
import math
import os
import json
import time
import numpy as np
from mathutils import Vector, Matrix, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))          # thin-air/
MODEL_DIR = os.path.join(ROOT, "assets", "models", "fauna")
TEX_DIR = os.path.join(ROOT, "assets", "textures", "fauna")
FPS = 30


def log(*a):
    print("[fauna]", *a, flush=True)


# ============================================================================================ math utils
def G(x, y, z):
    """G-space (Godot) -> Blender coordinates."""
    return Vector((x, -z, y))


def g_arr_to_b(P):
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], axis=1)


def b_arr_to_g(P):
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)


def rot_euler(deg):
    """Rotation matrix (G-space) from XYZ euler degrees; columns = local axes."""
    rx, ry, rz = [math.radians(d) for d in deg]
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return (Rz @ Ry @ Rx).astype(np.float32)


def clamp01(x):
    return min(max(x, 0.0), 1.0)


def sstep(x):
    x = clamp01(x)
    return x * x * (3.0 - 2.0 * x)


def keys(k, s):
    """Piecewise smoothstep interpolation through [(s, value), ...] (s ascending)."""
    if s <= k[0][0]:
        return k[0][1]
    for i in range(1, len(k)):
        if s <= k[i][0]:
            a, b = k[i - 1], k[i]
            t = (s - a[0]) / max(b[0] - a[0], 1e-9)
            return a[1] + (b[1] - a[1]) * sstep(t)
    return k[-1][1]


def pulse(t, t0, t1):
    """0 -> 1 -> 0 bump over [t0, t1] (sin^2)."""
    if t <= t0 or t >= t1:
        return 0.0
    return math.sin(math.pi * (t - t0) / (t1 - t0)) ** 2


# ============================================================================================ noise
def _hash3(ix, iy, iz, seed):
    n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761 & 0x7FFFFFFF)
    n = n & 0x7FFFFFFF
    n = (n ^ (n >> 13)) * 1274126177
    n = n & 0x7FFFFFFF
    n = n ^ (n >> 16)
    return (n & 0xFFFF).astype(np.float32) / 65535.0


def vnoise(P, freq, seed=0):
    """Smooth 3D value noise in [0,1] at points P (N,3)."""
    p = P.astype(np.float64) * freq + seed * 3.17
    i = np.floor(p).astype(np.int64)
    f = (p - i).astype(np.float32)
    u = f * f * (3.0 - 2.0 * f)
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    out = 0.0
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1.0 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1.0 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1.0 - u[:, 2]
                out = out + wx * wy * wz * _hash3(x + dx, y + dy, z + dz, seed)
    return out


def fbm(P, freq, octaves=4, seed=0, gain=0.5):
    s, a, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * vnoise(P, freq * (2.0 ** o), seed + o * 31)
        tot += a
        a *= gain
    return s / tot


# ============================================================================================ SDF
def sd_round_cone(P, a, b, r1, r2):
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    q = pa * l2 - y[:, None] * ba[None, :]
    x2 = np.einsum("ij,ij->i", q, q)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d_b = np.sqrt(x2 + z2) * il2 - r2
    d_a = np.sqrt(x2 + y2) * il2 - r1
    d_m = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_m)).astype(np.float32)


def sd_ellipsoid(P, c, r, R=None):
    q = P - np.asarray(c, np.float32)
    if R is not None:
        q = q @ R
    r = np.asarray(r, np.float32)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return (k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)).astype(np.float32)


def smin(a, b, k):
    if k <= 1e-6:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Prim:
    """An anatomical SDF primitive. kind: 'cone' (a, b, ra, rb) | 'ell' (c, r, rot) | 'sph' (c, r).
    k = blend radius into what came before; sub = smooth subtraction; bone = skin owner; region = coat tag."""

    def __init__(self, kind, bone, region="body", k=0.02, sub=False, tau=None, **p):
        self.kind, self.bone, self.region, self.k, self.sub, self.p = kind, bone, region, k, sub, p
        self.tau = tau if tau is not None else max(k * 0.45, 0.006)
        self.R = rot_euler(p["rot"]) if kind == "ell" and "rot" in p else None

    def eval(self, P):
        p = self.p
        if self.kind == "cone":
            return sd_round_cone(P, p["a"], p["b"], p["ra"], p["rb"])
        if self.kind == "ell":
            return sd_ellipsoid(P, p["c"], p["r"], self.R)
        if self.kind == "sph":
            return (np.linalg.norm(P - np.asarray(p["c"], np.float32), axis=1) - p["r"]).astype(np.float32)
        raise ValueError(self.kind)

    def aabb(self):
        p = self.p
        if self.kind == "cone":
            a, b = np.asarray(p["a"]), np.asarray(p["b"])
            r = max(p["ra"], p["rb"])
            return np.minimum(a, b) - r, np.maximum(a, b) + r
        c = np.asarray(p["c"])
        r = max(p["r"]) if self.kind == "ell" else p["r"]
        return c - r, c + r


def mirror(prims_fn):
    """Call prims_fn(side, x_sign, suffix) for L (+x) and R (-x); returns the concatenated list."""
    return prims_fn(1.0, ".L") + prims_fn(-1.0, ".R")


def sdf_eval(prims, P, cull=None):
    """Smooth union/subtraction of prims at P. cull = (lo, hi) AABB of P to skip far primitives."""
    d = None
    for pr in prims:
        if cull is not None:
            lo, hi = pr.aabb()
            m = pr.k + 0.02
            if np.any(lo - m > cull[1]) or np.any(hi + m < cull[0]):
                continue
        v = pr.eval(P)
        if d is None:
            d = v if not pr.sub else np.full(len(P), 1.0, np.float32)
            continue
        d = smax(d, -v, pr.k) if pr.sub else smin(d, v, pr.k)
    if d is None:
        d = np.full(len(P), 1.0, np.float32)
    return d


def sdf_grid(prims, h, pad=0.03, disp=None):
    los, his = zip(*[p.aabb() for p in prims if not p.sub])
    lo = np.min(np.array(los), axis=0) - pad
    hi = np.max(np.array(his), axis=0) + pad
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = lo[0] + np.arange(n[0]) * h
    ys = lo[1] + np.arange(n[1]) * h
    zs = lo[2] + np.arange(n[2]) * h
    F = np.empty((n[0], n[1], n[2]), np.float32)
    slab = max(1, int(600000 // (n[1] * n[2])))
    for i0 in range(0, n[0], slab):
        i1 = min(n[0], i0 + slab)
        X, Y, Z = np.meshgrid(xs[i0:i1], ys, zs, indexing="ij")
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1).astype(np.float32)
        cull = (np.array([xs[i0], ys[0], zs[0]]), np.array([xs[i1 - 1], ys[-1], zs[-1]]))
        d = sdf_eval(prims, P, cull)
        if disp is not None:
            d = d + disp(P)
        F[i0:i1] = d.reshape(i1 - i0, n[1], n[2])
    log("grid", tuple(n), "cells", int(np.prod(n)))
    return F, lo.astype(np.float32), h


# ============================================================================================ surface nets
_CO = np.array([(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)])
_EDGES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def surface_nets(F, origin, h):
    s = F < 0.0
    nx, ny, nz = F.shape
    c = [s[o[0]:nx - 1 + o[0], o[1]:ny - 1 + o[1], o[2]:nz - 1 + o[2]] for o in _CO]
    anyin = c[0].copy()
    allin = c[0].copy()
    for a in c[1:]:
        anyin |= a
        allin &= a
    active = anyin & ~allin
    I, J, K = np.nonzero(active)
    nv = len(I)
    idx = np.full(active.shape, -1, np.int64)
    idx[I, J, K] = np.arange(nv)
    acc = np.zeros((nv, 3), np.float32)
    cnt = np.zeros(nv, np.float32)
    for a, b in _EDGES:
        oa, ob = _CO[a], _CO[b]
        fa = F[I + oa[0], J + oa[1], K + oa[2]]
        fb = F[I + ob[0], J + ob[1], K + ob[2]]
        m = (fa < 0) != (fb < 0)
        t = np.where(m, fa / np.where(m, fa - fb, 1.0), 0.0)
        p = oa[None, :] + t[:, None] * (ob - oa)[None, :]
        acc[m] += p[m]
        cnt[m] += 1.0
    V = origin + (np.stack([I, J, K], 1).astype(np.float32) + acc / np.maximum(cnt, 1.0)[:, None]) * h
    quads = []
    # x-edges: cells (i, j-1, k-1), (i, j, k-1), (i, j, k), (i, j-1, k); outward normal +x when first inside
    e = s[:-1, 1:-1, 1:-1] != s[1:, 1:-1, 1:-1]
    i, j, k = np.nonzero(e)
    j += 1
    k += 1
    q = np.stack([idx[i, j - 1, k - 1], idx[i, j, k - 1], idx[i, j, k], idx[i, j - 1, k]], 1)
    quads.append(np.where(s[i, j, k][:, None], q, q[:, ::-1]))
    # y-edges: cells (i-1, j, k-1), (i-1, j, k), (i, j, k), (i, j, k-1)
    e = s[1:-1, :-1, 1:-1] != s[1:-1, 1:, 1:-1]
    i, j, k = np.nonzero(e)
    i += 1
    k += 1
    q = np.stack([idx[i - 1, j, k - 1], idx[i - 1, j, k], idx[i, j, k], idx[i, j, k - 1]], 1)
    quads.append(np.where(s[i, j, k][:, None], q, q[:, ::-1]))
    # z-edges: cells (i-1, j-1, k), (i, j-1, k), (i, j, k), (i-1, j, k)
    e = s[1:-1, 1:-1, :-1] != s[1:-1, 1:-1, 1:]
    i, j, k = np.nonzero(e)
    i += 1
    j += 1
    q = np.stack([idx[i - 1, j - 1, k], idx[i, j - 1, k], idx[i, j, k], idx[i - 1, j, k]], 1)
    quads.append(np.where(s[i, j, k][:, None], q, q[:, ::-1]))
    Q = np.concatenate(quads, 0)
    Q = Q[np.all(Q >= 0, axis=1)]
    return V, Q


def relax_project(V, Q, prims, iters=3, lam=0.5, disp=None):
    """Laplacian smoothing, each pass followed by a Newton projection back onto the SDF surface."""
    n = len(V)
    E = np.concatenate([Q[:, [0, 1]], Q[:, [1, 2]], Q[:, [2, 3]], Q[:, [3, 0]]], 0)

    def sdf(P):
        d = sdf_eval(prims, P)
        return d + disp(P) if disp is not None else d

    for _ in range(iters):
        acc = np.zeros_like(V)
        cnt = np.zeros(n, np.float32)
        np.add.at(acc, E[:, 0], V[E[:, 1]])
        np.add.at(acc, E[:, 1], V[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1.0)
        np.add.at(cnt, E[:, 1], 1.0)
        V = V + lam * (acc / np.maximum(cnt, 1.0)[:, None] - V)
        for _p in range(2):
            d = sdf(V)
            eps = 0.0015
            g = np.stack([sdf(V + np.array([eps, 0, 0], np.float32)) - sdf(V - np.array([eps, 0, 0], np.float32)),
                          sdf(V + np.array([0, eps, 0], np.float32)) - sdf(V - np.array([0, eps, 0], np.float32)),
                          sdf(V + np.array([0, 0, eps], np.float32)) - sdf(V - np.array([0, 0, eps], np.float32))], 1)
            g /= np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
            V = V - np.clip(d, -0.01, 0.01)[:, None] * g
    return V.astype(np.float32)


# ============================================================================================ Blender helpers
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images):
        for x in list(c):
            c.remove(x)


def mesh_from_arrays(name, Vg, faces):
    me = bpy.data.meshes.new(name)
    Vb = g_arr_to_b(Vg)
    me.from_pydata([tuple(v) for v in Vb.tolist()], [], [tuple(f) for f in np.asarray(faces).tolist()])
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def decimate_to_tris(Vg, Q, target_tris):
    obj = mesh_from_arrays("tmp_dec", Vg, Q)
    cur = len(Q) * 2
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, target_tris / max(cur, 1))
    mod.use_collapse_triangulate = True
    tri = obj.modifiers.new("tri", "TRIANGULATE")
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    me.calc_loop_triangles()
    nvt = len(me.vertices)
    co = np.empty(nvt * 3, np.float32)
    me.vertices.foreach_get("co", co)
    T = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", T)
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(me)
    return b_arr_to_g(co.reshape(-1, 3)), T.reshape(-1, 3)


def sdf_part(prims, h, target_tris, smooth_iters=3, disp=None):
    t0 = time.time()
    F, org, h = sdf_grid(prims, h, disp=disp)
    V, Q = surface_nets(F, org, h)
    del F
    V = relax_project(V, Q, prims, iters=smooth_iters, disp=disp)
    V2, T = decimate_to_tris(V, Q, target_tris)
    log("part: %d verts %d quads -> %d verts %d tris (%.1fs)" % (len(V), len(Q), len(V2), len(T), time.time() - t0))
    return V2, T


def uv_sphere(center, r, nu=10, nv=8):
    V = []
    F = []
    for j in range(nv + 1):
        th = math.pi * j / nv
        for i in range(nu):
            ph = 2 * math.pi * i / nu
            V.append((center[0] + r * math.sin(th) * math.cos(ph), center[1] + r * math.cos(th),
                      center[2] + r * math.sin(th) * math.sin(ph)))
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            c = (j + 1) * nu + (i + 1) % nu
            d = (j + 1) * nu + i
            F.append((a, d, c))
            F.append((a, c, b))
    return np.array(V, np.float32), np.array(F, np.int32)


def ear_shell(base, axis, back, height, width, thick=0.004, cup=1.0, na=9, nu=7, tip_bend=0.0):
    """Cupped ear: a half cone open toward -back, thickness closed at the rim. G-space arrays."""
    base = np.asarray(base, np.float32)
    ax = np.asarray(axis, np.float32)
    ax /= np.linalg.norm(ax)
    bk = np.asarray(back, np.float32)
    bk = bk - ax * (bk @ ax)
    bk /= np.linalg.norm(bk)
    sd = np.cross(ax, bk)
    A = math.radians(105.0)
    rings_o, rings_i = [], []
    for ui in range(nu):
        u = ui / (nu - 1)
        r = 0.5 * width * (1.0 - u) ** 0.85 + 0.0015
        cen = base + ax * (height * u) + bk * (tip_bend * u * u * height)
        ro, ri = [], []
        for ai in range(na):
            a = -A + 2 * A * ai / (na - 1)
            d = bk * math.cos(a) * cup + sd * math.sin(a)
            ro.append(cen + d * r)
            ri.append(cen + d * max(r - thick * (1.0 - 0.6 * u), 0.0006))
        rings_o.append(ro)
        rings_i.append(ri)
    V = [p for ring in rings_o for p in ring] + [p for ring in rings_i for p in ring]
    off = nu * na
    F = []
    for ui in range(nu - 1):
        for ai in range(na - 1):
            a = ui * na + ai
            b = a + 1
            c = a + na + 1
            d = a + na
            F.append((a, b, c, d))                       # outer
            F.append((off + a, off + d, off + c, off + b))  # inner (reversed)
    for ui in range(nu - 1):                             # rims at both edges
        a0 = ui * na
        F.append((a0, a0 + na, off + a0 + na, off + a0))
        a1 = ui * na + na - 1
        F.append((a1, off + a1, off + a1 + na, a1 + na))
    Ft = []
    for f in F:
        Ft.append((f[0], f[1], f[2]))
        Ft.append((f[0], f[2], f[3]))
    return np.array(V, np.float32), np.array(Ft, np.int32)


# ============================================================================================ armature
def build_armature(name, bones):
    """bones: list of (name, head_g, tail_g, parent or None, deform)."""
    data = bpy.data.armatures.new(name + "_arm")
    obj = bpy.data.objects.new(name + "_rig", data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, h, t, par, dfm in bones:
        eb = data.edit_bones.new(bn)
        eb.head = G(*h)
        eb.tail = G(*t)
        eb.use_deform = dfm
        d = (eb.tail - eb.head).normalized()
        eb.align_roll(Vector((0, 1, 0)) if abs(d.z) > 0.7 else Vector((0, 0, 1)))
    for bn, h, t, par, dfm in bones:
        if par:
            data.edit_bones[bn].parent = data.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def skin_weights(Vg, prims, bone_names, max_inf=4, extra=None):
    """Per-vertex bone weights from soft-min primitive ownership. Returns (N, B) float32."""
    D = np.stack([p.eval(Vg) for p in prims if not p.sub], 1)
    live = [p for p in prims if not p.sub]
    tau = np.array([p.tau for p in live], np.float32)
    dmin = D.min(1, keepdims=True)
    W = np.exp(-(D - dmin) / tau[None, :])
    B = np.zeros((len(Vg), len(bone_names)), np.float32)
    bi = {b: i for i, b in enumerate(bone_names)}
    for j, p in enumerate(live):
        B[:, bi[p.bone]] += W[:, j]
    return normalize_top(B, max_inf)


def normalize_top(B, max_inf=4):
    if B.shape[1] > max_inf:
        thr = -np.sort(-B, axis=1)[:, max_inf - 1:max_inf]
        B = np.where(B >= thr, B, 0.0)
    B = np.where(B < 0.02 * B.max(1, keepdims=True), 0.0, B)
    return (B / np.maximum(B.sum(1, keepdims=True), 1e-9)).astype(np.float32)


def region_weights(Vg, prims, regions):
    live = [p for p in prims if not p.sub]
    D = np.stack([p.eval(Vg) for p in live], 1)
    dmin = D.min(1, keepdims=True)
    W = np.exp(-(D - dmin) / 0.012)
    R = np.zeros((len(Vg), len(regions)), np.float32)
    ri = {r: i for i, r in enumerate(regions)}
    for j, p in enumerate(live):
        R[:, ri[p.region]] += W[:, j]
    return R / np.maximum(R.sum(1, keepdims=True), 1e-9)


# ============================================================================================ texture bake
def bake_texture(me, Vg, Ng, Rg, size, pattern, regions, seed=0):
    """Rasterise triangles in UV space; evaluate pattern(P, N, R) -> (rgb, furlen) per texel."""
    t0 = time.time()
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    nl = len(me.loops)
    uv = np.empty(nl * 2, np.float32)
    uvl.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    nt = len(me.loop_triangles)
    LT = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", LT)
    LT = LT.reshape(-1, 3)
    VT = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", VT)
    VT = VT.reshape(-1, 3)
    W = H = size
    pos = np.zeros((H, W, 3), np.float32)
    nrm = np.zeros((H, W, 3), np.float32)
    reg = np.zeros((H, W, Rg.shape[1]), np.float32)
    mask = np.zeros((H, W), bool)
    area3 = 0.0
    areauv = 0.0
    for t in range(nt):
        tuv = uv[LT[t]] * np.array([W, H], np.float32) - 0.5
        vi = VT[t]
        p3 = Vg[vi]
        area3 += 0.5 * np.linalg.norm(np.cross(p3[1] - p3[0], p3[2] - p3[0]))
        e1 = tuv[1] - tuv[0]
        e2 = tuv[2] - tuv[0]
        den = e1[0] * e2[1] - e1[1] * e2[0]
        areauv += abs(den) * 0.5 / (W * H)
        if abs(den) < 1e-12:
            continue
        x0 = max(int(math.floor(tuv[:, 0].min())) - 1, 0)
        x1 = min(int(math.ceil(tuv[:, 0].max())) + 1, W - 1)
        y0 = max(int(math.floor(tuv[:, 1].min())) - 1, 0)
        y1 = min(int(math.ceil(tuv[:, 1].max())) + 1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1, dtype=np.float32), np.arange(y0, y1 + 1, dtype=np.float32))
        dx = xs - tuv[0, 0]
        dy = ys - tuv[0, 1]
        b1 = (dx * e2[1] - dy * e2[0]) / den
        b2 = (e1[0] * dy - e1[1] * dx) / den
        b0 = 1.0 - b1 - b2
        tol = -0.6 / max(math.sqrt(abs(den)), 1.0)
        inside = (b0 >= tol) & (b1 >= tol) & (b2 >= tol)
        if not inside.any():
            continue
        yy = ys[inside].astype(int)
        xx = xs[inside].astype(int)
        w = np.stack([b0[inside], b1[inside], b2[inside]], 1).clip(0, 1)
        w /= w.sum(1, keepdims=True)
        pos[yy, xx] = w @ p3
        nrm[yy, xx] = w @ Ng[vi]
        reg[yy, xx] = w @ Rg[vi]
        mask[yy, xx] = True
    idx = np.nonzero(mask)
    P = pos[idx]
    N = nrm[idx]
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
    R = {r: reg[idx][:, i] for i, r in enumerate(regions)}
    rgb, fl = pattern(P, N, R)
    img = np.zeros((H, W, 4), np.float32)
    img[idx[0], idx[1], :3] = np.clip(rgb, 0, 1)
    img[idx[0], idx[1], 3] = np.clip(fl, 0, 1)
    # dilate islands (mip bleeding)
    m = mask.copy()
    for _ in range(12):
        acc = np.zeros_like(img)
        cnt = np.zeros((H, W), np.float32)
        for sy, sx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            acc += np.roll(np.roll(img * m[..., None], sy, 0), sx, 1)
            cnt += np.roll(np.roll(m.astype(np.float32), sy, 0), sx, 1)
        grow = (~m) & (cnt > 0)
        img[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
    img[~m] = img[m].mean(0)
    uv_m = math.sqrt(area3 / max(areauv, 1e-9))
    log("bake %dx%d: %d tris, %.1f%% texels, uv unit = %.3f m (%.1fs)" % (W, H, nt, 100.0 * mask.mean(), uv_m,
                                                                          time.time() - t0))
    return img, uv_m


def save_png(img, path):
    H, W = img.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), W, H, alpha=True)
    im.pixels.foreach_set(img.astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def strand_texture(path, size=512, cells=128, seed=5):
    """Tileable fur strand map: R = strand height (per strand), G = distance to strand centre (0..1),
    B = clump noise. Shared by every species' fur shells."""
    rng = np.random.default_rng(seed)
    cs = size // cells
    cen = rng.random((cells, cells, 2)).astype(np.float32) * 0.8 + 0.1
    hgt = (0.55 + 0.45 * rng.random((cells, cells))).astype(np.float32)
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    cx = (xs // cs).astype(int)
    cy = (ys // cs).astype(int)
    best = np.full((size, size), 9.0, np.float32)
    bh = np.zeros((size, size), np.float32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            nx_ = (cx + ox) % cells
            ny_ = (cy + oy) % cells
            px = (cx + ox + cen[ny_, nx_, 0]) * cs
            py = (cy + oy + cen[ny_, nx_, 1]) * cs
            d = np.sqrt((xs - px) ** 2 + (ys - py) ** 2) / (cs * 0.75)
            m = d < best
            best = np.where(m, d, best)
            bh = np.where(m, hgt[ny_, nx_], bh)
    # clump noise: tileable value noise on a 16-cell lattice
    g = rng.random((16, 16)).astype(np.float32)
    u = xs / size * 16
    v = ys / size * 16
    i0 = np.floor(u).astype(int)
    j0 = np.floor(v).astype(int)
    fu = u - i0
    fv = v - j0
    fu = fu * fu * (3 - 2 * fu)
    fv = fv * fv * (3 - 2 * fv)
    a = g[j0 % 16, i0 % 16]
    b = g[j0 % 16, (i0 + 1) % 16]
    c = g[(j0 + 1) % 16, i0 % 16]
    d = g[(j0 + 1) % 16, (i0 + 1) % 16]
    clump = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
    img = np.zeros((size, size, 4), np.float32)
    img[..., 0] = bh
    img[..., 1] = np.clip(best, 0, 1)
    img[..., 2] = clump
    img[..., 3] = 1.0
    save_png(img, path)


# ============================================================================================ rig / pose
def qx(deg):
    return Quaternion((1, 0, 0), math.radians(deg))


def qyaw(deg):
    return Quaternion((0, 0, 1), math.radians(deg))


def qroll(deg):
    return Quaternion((0, 1, 0), math.radians(deg))


def qeul(pitch=0.0, yaw=0.0, roll=0.0):
    return qyaw(yaw) @ qx(pitch) @ qroll(roll)


class Rig:
    def __init__(self, arm_obj):
        self.obj = arm_obj
        self.rest = {}
        self.parent = {}
        self.length = {}
        self.names = []
        for b in arm_obj.data.bones:
            self.rest[b.name] = b.matrix_local.copy()
            self.parent[b.name] = b.parent.name if b.parent else None
            self.length[b.name] = b.length
            self.names.append(b.name)
        self.rest_q = {n: self.rest[n].to_quaternion() for n in self.names}
        self.rest_rel = {}
        for n in self.names:
            p = self.parent[n]
            self.rest_rel[n] = (self.rest[p].inverted() @ self.rest[n]) if p else self.rest[n].copy()
        self.clear()

    def clear(self):
        self.rot = {n: Quaternion() for n in self.names}
        self.loc = {n: Vector() for n in self.names}

    def M(self, n):
        p = self.parent[n]
        base = self.M(p) if p else Matrix.Identity(4)
        return base @ self.rest_rel[n] @ Matrix.Translation(self.loc[n]) @ self.rot[n].to_matrix().to_4x4()

    def head(self, n):
        return self.M(n).translation.copy()

    def tail(self, n):
        return self.M(n) @ Vector((0, self.length[n], 0))

    def rest_head(self, n):
        return self.rest[n].translation.copy()

    def rest_tail(self, n):
        return self.rest[n] @ Vector((0, self.length[n], 0))

    def arm_rot(self, n, q):
        """Rotation about armature-space axes (at rest orientation) composed onto the bone's local pose."""
        r = self.rest_q[n]
        self.rot[n] = self.rot[n] @ (r.inverted() @ q @ r)

    def arm_loc(self, n, d):
        self.loc[n] = self.loc[n] + self.rest_q[n].inverted() @ d

    def aim(self, n, direction):
        p = self.parent[n]
        base = (self.M(p) if p else Matrix.Identity(4)) @ self.rest_rel[n] @ Matrix.Translation(self.loc[n])
        ld = base.to_3x3().inverted() @ direction
        if ld.length < 1e-9:
            return
        self.rot[n] = Vector((0, 1, 0)).rotation_difference(ld.normalized())


def two_bone(S, W, l1, l2, pole):
    u = W - S
    d = u.length
    u.normalize()
    d = min(max(d, abs(l1 - l2) * 1.02 + 1e-4), (l1 + l2) * 0.9995)
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    sa = math.sqrt(max(0.0, 1.0 - ca * ca))
    v = pole - u * pole.dot(u)
    if v.length < 1e-6:
        v = Vector((0, 1, 0))
    v.normalize()
    E = S + (u * ca + v * sa) * l1
    Wr = S + u * d
    return E, Wr


class Pose:
    def __init__(self):
        self.rot = {}        # bone -> list of armature-axis quaternions (composed in order)
        self.loc = {}        # bone -> armature-space offset
        self.feet = {}       # leg -> dict(fwd, lift, side, theta, phi, mode)
        self.scap = {}       # leg -> degrees (+ = distal end forward)

    def r(self, bone, q):
        if bone is None:
            return
        self.rot.setdefault(bone, []).append(q)

    def l(self, bone, v):
        self.loc[bone] = self.loc.get(bone, Vector()) + v


def solve_pose(rig, spec, pose):
    rig.clear()
    for b, v in pose.loc.items():
        rig.arm_loc(b, v)
    for b, qs in pose.rot.items():
        for q in qs:
            rig.arm_rot(b, q)
    for leg, L in spec["legs"].items():
        ch = L["chain"]
        f = pose.feet.get(leg, {})
        front = L["front"]
        k = 0
        if front and L.get("scapula", True):
            rig.arm_rot(ch[0], qx(pose.scap.get(leg, 0.0)))
            k = 1
        upper, lower, meta, paw = ch[k], ch[k + 1], ch[k + 2], ch[k + 3]
        S = rig.head(upper)
        F0 = L["F0"]
        lpaw = rig.length[paw]
        phi0 = L["phi0"]
        phi = f.get("phi", phi0)
        theta = f.get("theta", L["theta0"])
        fwd = f.get("fwd", 0.0)
        lift = f.get("lift", 0.0)
        side = f.get("side", 0.0)
        Fg = F0 + Vector((side * L["x_sign"], fwd, lift + lpaw * (math.sin(math.radians(phi)) - math.sin(math.radians(phi0)))))
        if f.get("mode") == "body":
            # feet ride with the body (lying down, airborne): transform the target by the body's pose delta
            anchor = ch[0] if not front else spec["chest_bone"]
            anchor = spec["pelvis_bone"] if not front else spec["chest_bone"]
            Md = rig.M(anchor) @ rig.rest[anchor].inverted()
            Fg = Md @ Fg
            bodyrot = Md.to_quaternion()
        else:
            bodyrot = Quaternion()
        th = math.radians(theta)
        m = bodyrot @ Vector((0, math.sin(th), -math.cos(th)))
        W = Fg - m * rig.length[meta]
        pole = bodyrot @ Vector((0, -1.0 if front else 1.0, 0.0 if front else 0.15))
        pole = pole + bodyrot @ Vector((L["x_sign"] * 0.05, 0, 0))
        E, Wr = two_bone(S, W, rig.length[upper], rig.length[lower], pole)
        rig.aim(upper, E - S)
        rig.aim(lower, Wr - E)
        rig.aim(meta, m)
        ph = math.radians(phi)
        rig.aim(paw, bodyrot @ Vector((0, math.cos(ph), -math.sin(ph))))


# ============================================================================================ gaits & clips
def gait_feet(spec, g, t, T, pose, stride_scale=1.0):
    """Fill pose.feet / pose.scap for a gait at time t. g: gait dict (v, duty, phases, lift_f, lift_h ...)."""
    duty = g["duty"]
    E = g["v"] * duty * T * stride_scale
    for leg, L in spec["legs"].items():
        p = (t / T + g["phases"][leg]) % 1.0
        front = L["front"]
        lift = g["lift_f"] if front else g["lift_h"]
        th_st = L["theta_stance"]
        th_sw = L["theta_swing"]
        phi0 = L["phi0"]
        pbo = L.get("phi_break", 55.0)
        if p < duty:
            u = p / duty
            fwd = E * (0.5 - u)
            bo = sstep((u - 0.72) / 0.28) * g.get("breakover", 1.0)
            phi = phi0 + (pbo - phi0) * bo
            theta = th_st[0] + (th_st[1] - th_st[0]) * u
            lf = 0.0
        else:
            s = (p - duty) / (1.0 - duty)
            fwd = E * (-0.5 + sstep(s))
            pbo_eff = phi0 + (pbo - phi0) * g.get("breakover", 1.0)
            phi = keys([(0.0, pbo_eff), (0.35, g.get("phi_swing", L.get("phi_swing", 75.0))), (0.8, phi0 + 10.0),
                        (1.0, phi0)], s)
            theta = L["theta0"] + (keys(th_sw, s) - L["theta0"]) * g.get("swing_scale", 1.0)
            lf = lift * math.sin(math.pi * s) ** 0.85
        pose.feet[leg] = dict(fwd=fwd + g.get("reach_f" if front else "reach_h", 0.0), lift=lf, theta=theta, phi=phi,
                              side=g.get("splay", 0.0))
        if front:
            pose.scap[leg] = g.get("scap_amp", 10.0) * fwd / max(E * 0.5, 1e-3)


def body_common(spec, pose, neck=0.0, head=0.0, tail=0.0, ears=0.0, jaw=0.0, drop=0.0, pelvis_pitch=0.0,
                chest_pitch=0.0, head_yaw=0.0, tail_yaw=0.0, fwd=0.0):
    b = spec["bones"]
    pose.l(b["pelvis"], Vector((0, fwd, -drop)))
    pose.r(b["pelvis"], qx(pelvis_pitch))
    pose.r(b["chest"], qx(chest_pitch))
    nb = b["neck"]
    for i, n in enumerate(nb):
        pose.r(n, qeul(neck / len(nb), head_yaw * 0.35 / len(nb)))
    pose.r(b["head"], qeul(head, head_yaw * 0.65))
    tb = b["tail"]
    for i, n in enumerate(tb):
        w = (0.55, 0.25, 0.12, 0.08)[i] if len(tb) == 4 else 1.0 / len(tb)
        pose.r(n, qeul(tail * w, tail_yaw * (0.4 + 0.3 * i) / max(len(tb) * 0.7, 1)))
    for e in b["ears"]:
        pose.r(e, qx(ears))
    if b.get("jaw"):
        pose.r(b["jaw"], qx(-jaw))


def clip_gait(spec, g):
    T = g["T"]

    def f(t, pose):
        ph = t / T
        gait_feet(spec, g, t, T, pose)
        b = spec["bones"]
        bob = g.get("bob", 0.0) * math.cos(2 * math.pi * (g.get("bob_freq", 2) * ph - g.get("bob_phase", 0.0)))
        pitch = g.get("pitch_amp", 0.0) * math.sin(2 * math.pi * (ph - g.get("pitch_phase", 0.0)))
        roll = g.get("roll_amp", 0.0) * math.sin(2 * math.pi * ph)
        yaw = g.get("yaw_amp", 0.0) * math.sin(2 * math.pi * ph + 0.5)
        flex = g.get("flex_amp", 0.0) * math.cos(2 * math.pi * (ph - g.get("flex_phase", 0.0)))
        head_bob = g.get("head_bob", 0.0) * math.sin(2 * math.pi * (g.get("bob_freq", 2) * ph + 0.15))
        pose.l(b["pelvis"], Vector((0, 0, bob)))
        pose.r(b["pelvis"], qeul(pitch + flex, yaw, roll))
        for s_ in b["spine"]:
            pose.r(s_, qeul(-flex * 0.9 / len(b["spine"]), -yaw * 0.6 / len(b["spine"]), -roll * 0.5 / len(b["spine"])))
        pose.r(b["chest"], qx(-flex * 0.3 + g.get("chest_pitch", 0.0)))
        tail_flut = g.get("tail_flutter", 0.0) * math.sin(2 * math.pi * (2 * ph + 0.3))
        body_common(spec, pose, neck=g.get("neck", 0.0) + head_bob - pitch * 0.5 + flex * 0.4,
                    head=g.get("head", 0.0) - head_bob * 0.6, tail=g.get("tail", 0.0) + tail_flut,
                    ears=g.get("ears", 0.0), drop=g.get("drop", 0.0), jaw=g.get("jaw", 0.0),
                    tail_yaw=g.get("tail_sway", 0.0) * math.sin(2 * math.pi * ph + 1.0),
                    head_yaw=-yaw * 0.5)

    return f


def ground_feet(spec, pose, **over):
    for leg, L in spec["legs"].items():
        d = dict(theta=L["theta0"], phi=L["phi0"])
        d.update(over.get(leg, {}))
        pose.feet[leg] = d


def clip_idle(spec, c):
    D = c["dur"]

    def f(t, pose):
        ground_feet(spec, pose)
        br = math.sin(2 * math.pi * 3 * t / D)
        b = spec["bones"]
        pose.r(b["spine"][-1], qx(0.8 * br))
        pose.l(b["pelvis"], Vector((0, 0, 0.002 * br)))
        flick_l = pulse(t, 0.3 * D, 0.36 * D)
        flick_r = pulse(t, 0.7 * D, 0.75 * D)
        hy = 7.0 * math.sin(2 * math.pi * t / D)
        body_common(spec, pose, neck=c.get("neck", 0.0) + 2.0 * math.sin(2 * math.pi * 2 * t / D),
                    head=c.get("head", -4.0), tail=c.get("tail", 0.0), head_yaw=hy,
                    tail_yaw=6.0 * math.sin(2 * math.pi * t / D + 0.7), ears=c.get("ears", 0.0))
        if len(b["ears"]) == 2:
            pose.r(b["ears"][0], qeul(28.0 * flick_l, 18.0 * flick_l))
            pose.r(b["ears"][1], qeul(28.0 * flick_r, -18.0 * flick_r))

    return f


def clip_sniff(spec, c):
    D = c["dur"]

    def f(t, pose):
        ground_feet(spec, pose)
        u = t / D
        down = keys([(0, 0.85), (0.15, 1.0), (0.85, 1.0), (1.0, 0.85)], u)
        sweep = 12.0 * math.sin(2 * math.pi * u)
        jit = 1.6 * math.sin(2 * math.pi * 7 * u)
        body_common(spec, pose, neck=c.get("neck", -42.0) * down, head=c.get("head", -22.0) * down + jit,
                    head_yaw=sweep, tail=c.get("tail", 8.0), ears=c.get("ears", -6.0),
                    tail_yaw=5.0 * math.sin(2 * math.pi * u), chest_pitch=-3.0 * down)

    return f


def clip_look(spec, c):
    D = c["dur"]

    def f(t, pose):
        ground_feet(spec, pose)
        u = t / D
        hy = keys([(0, 0), (0.18, 32), (0.42, 32), (0.55, 0), (0.7, -32), (0.9, -32), (1.0, 0)], u)
        body_common(spec, pose, neck=c.get("neck", 16.0), head=c.get("head", -8.0), head_yaw=hy,
                    tail=c.get("tail", -12.0), ears=c.get("ears", -12.0))

    return f


def clip_howl(spec, c):
    D = c["dur"]

    def f(t, pose):
        ground_feet(spec, pose)
        u = t / D
        up = keys([(0, 0), (0.15, 1), (0.85, 1), (1, 0)], u)
        jaw = up * (10.0 + 5.0 * math.sin(2 * math.pi * 1.5 * u)) * keys([(0, 0), (0.18, 0), (0.25, 1), (0.8, 1), (0.88, 0), (1, 0)], u)
        body_common(spec, pose, neck=c.get("neck", 38.0) * up, head=c.get("head", 22.0) * up, jaw=jaw,
                    ears=12.0 * up, tail=c.get("tail", 18.0) * up, chest_pitch=5.0 * up, drop=0.02 * up)

    return f


def clip_snarl(spec, c):
    D = c["dur"]

    def f(t, pose):
        ground_feet(spec, pose, **c.get("feet", {}))
        u = t / D
        trem = math.sin(2 * math.pi * 11 * u)
        b = spec["bones"]
        pose.r(b["spine"][-1], qx(0.6 * trem))
        body_common(spec, pose, neck=c.get("neck", -18.0), head=c.get("head", 14.0) + 0.7 * trem,
                    jaw=c.get("jaw", 9.0) + 1.5 * trem, ears=c.get("ears", 45.0), tail=c.get("tail", -22.0),
                    drop=c.get("drop", 0.05), chest_pitch=-4.0, fwd=0.02,
                    head_yaw=4.0 * math.sin(2 * math.pi * u))

    return f


def clip_attack(spec, c):
    D = c["dur"]

    def f(t, pose):
        u = t / D
        load = keys([(0, 0), (0.28, 1), (0.36, 0.3), (0.55, 0), (1, 0)], u)
        lunge = keys([(0, 0), (0.28, 0), (0.48, 1), (0.62, 0.9), (1, 0)], u)
        jaw = keys([(0, 0), (0.2, 6), (0.4, 30), (0.5, 30), (0.54, 2), (0.7, 6), (1, 0)], u)
        reach = c.get("reach", 0.3)
        feet = {}
        for leg, L in spec["legs"].items():
            if L["front"]:
                feet[leg] = dict(fwd=reach * lunge, lift=0.2 * lunge + 0.02 * load, theta=L["theta0"] - 50.0 * lunge,
                                 phi=L["phi0"] + 20.0 * lunge)
            else:
                feet[leg] = dict(fwd=-0.05 * load + 0.12 * lunge, lift=0.0, theta=L["theta0"] + 15.0 * lunge,
                                 phi=L["phi0"] + 30.0 * lunge)
        ground_feet(spec, pose, **feet)
        body_common(spec, pose, neck=-10.0 * load + 8.0 * lunge, head=10.0 * load - 6.0 * lunge, jaw=jaw,
                    ears=35.0 * max(load, lunge), tail=-15.0 * lunge, drop=0.09 * load - 0.06 * lunge,
                    fwd=-0.05 * load + c.get("lunge_fwd", 0.28) * lunge, pelvis_pitch=6.0 * lunge,
                    chest_pitch=4.0 * lunge - 4.0 * load)

    return f


def clip_hit(spec, c):
    D = c["dur"]

    def f(t, pose):
        ground_feet(spec, pose)
        u = t / D
        k = keys([(0, 0), (0.12, 1), (0.4, 0.6), (1, 0)], u)
        b = spec["bones"]
        pose.l(b["pelvis"], Vector((0.03 * k, -0.04 * k, -0.03 * k)))
        pose.r(b["pelvis"], qeul(0, 6.0 * k, -5.0 * k))
        pose.r(b["spine"][-1], qeul(-3.0 * k, 8.0 * k))
        body_common(spec, pose, neck=8.0 * k, head=14.0 * k, ears=40.0 * k, jaw=12.0 * k, tail=12.0 * k,
                    head_yaw=-10.0 * k)

    return f


def clip_death(spec, c):
    D = c["dur"]

    def f(t, pose):
        u = t / D
        buckle = keys([(0, 0), (0.22, 1), (1, 1)], u)
        roll = keys([(0, 0), (0.18, 0), (0.62, 1), (1, 1)], u)
        settle = keys([(0, 0), (0.55, 0), (1, 1)], u)
        b = spec["bones"]
        lie_h = c.get("lie_height", 0.14)
        pel_h = spec["pelvis_height"]
        drop = buckle * 0.18 + roll * max(pel_h - lie_h - 0.18, 0.0)
        pose.l(b["pelvis"], Vector((0.1 * roll * c.get("side_shift", 1.0), 0, -drop)))
        pose.r(b["pelvis"], qroll(84.0 * roll))
        for s_ in b["spine"]:
            pose.r(s_, qx(-3.0 * buckle))
        feet = {}
        for leg, L in spec["legs"].items():
            relax = roll
            if L["front"]:
                feet[leg] = dict(mode="body" if roll > 0.0 else None, fwd=0.12 * relax - 0.05 * buckle * (1 - roll),
                                 lift=0.06 * relax + 0.12 * buckle * (1 - roll), theta=L["theta0"] - 25.0 * relax,
                                 phi=L["phi0"] + 40.0 * relax)
            else:
                feet[leg] = dict(mode="body" if roll > 0.0 else None, fwd=-0.08 * relax, lift=0.08 * relax + 0.1 * buckle * (1 - roll),
                                 theta=L["theta0"] + 25.0 * relax, phi=L["phi0"] + 45.0 * relax)
            if roll <= 0.0:
                feet[leg].pop("mode")
        ground_feet(spec, pose, **feet)
        body_common(spec, pose, neck=-25.0 * buckle + 10.0 * roll - 6.0 * settle, head=-10.0 * buckle + 5.0 * settle,
                    ears=30.0 * roll, jaw=6.0 * settle, tail=12.0 * roll, tail_yaw=-10.0 * roll)

    return f


CLIP_KINDS = {"gait": clip_gait, "idle": clip_idle, "sniff": clip_sniff, "look": clip_look, "howl": clip_howl,
              "snarl": clip_snarl, "attack": clip_attack, "hit": clip_hit, "death": clip_death}


def bake_clips(arm_obj, spec):
    rig = Rig(arm_obj)
    ad = arm_obj.animation_data_create()
    meta = {}
    for name, c in spec["clips"].items():
        kind = c["kind"]
        if kind == "gait":
            dur = c["T"]
        else:
            dur = c["dur"]
        fn = c["fn"](spec, c) if "fn" in c else CLIP_KINDS[kind](spec, c)
        nf = int(round(dur * FPS))
        frames = {n: [] for n in rig.names}
        locs = []
        prev = {n: None for n in rig.names}
        for fi in range(nf + 1):
            t = (fi % nf) * dur / nf if c.get("loop", True) else fi * dur / nf
            pose = Pose()
            fn(t, pose)
            solve_pose(rig, spec, pose)
            for n in rig.names:
                q = rig.rot[n].normalized()
                if prev[n] is not None and prev[n].dot(q) < 0:
                    q = -q
                prev[n] = q
                frames[n].append(q)
            locs.append(rig.loc[spec["bones"]["pelvis"]].copy())
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        for n in rig.names:
            dp = 'pose.bones["%s"].rotation_quaternion' % n
            arr = np.array([[q.w, q.x, q.y, q.z] for q in frames[n]], np.float32)
            if np.allclose(arr, arr[0:1], atol=1e-5) and n != spec["bones"]["pelvis"]:
                if np.allclose(arr[0], [1, 0, 0, 0], atol=1e-5):
                    continue
            for i in range(4):
                fc = act.fcurves.new(dp, index=i, action_group=n)
                fc.keyframe_points.add(nf + 1)
                co = np.empty((nf + 1) * 2, np.float32)
                co[0::2] = np.arange(nf + 1)
                co[1::2] = arr[:, i]
                fc.keyframe_points.foreach_set("co", co)
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
                fc.update()
        pb = spec["bones"]["pelvis"]
        L = np.array([[v.x, v.y, v.z] for v in locs], np.float32)
        for i in range(3):
            fc = act.fcurves.new('pose.bones["%s"].location' % pb, index=i, action_group=pb)
            fc.keyframe_points.add(nf + 1)
            co = np.empty((nf + 1) * 2, np.float32)
            co[0::2] = np.arange(nf + 1)
            co[1::2] = L[:, i]
            fc.keyframe_points.foreach_set("co", co)
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
            fc.update()
        tr = ad.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, act)
        tr.mute = True
        m = dict(length=dur, loop=bool(c.get("loop", True)))
        if kind == "gait":
            m["speed"] = c["v"]
        for k_ in ("events", "move"):
            if k_ in c:
                m[k_] = c[k_]
        meta[name] = m
    ad.action = None
    for pbn in arm_obj.pose.bones:
        pbn.rotation_mode = "QUATERNION"
        pbn.rotation_quaternion = Quaternion()
        pbn.location = Vector()
    return meta


# ============================================================================================ build
def prepare_legs(spec, rig):
    for leg, L in spec["legs"].items():
        ch = L["chain"]
        paw = ch[-1]
        meta = ch[-2]
        L["F0"] = rig.rest_head(paw)
        L["x_sign"] = 1.0 if L["F0"].x > 0 else -1.0
        d = rig.rest_tail(meta) - rig.rest_head(meta)
        L["theta0"] = math.degrees(math.atan2(d.y, -d.z))
        dp = rig.rest_tail(paw) - rig.rest_head(paw)
        L["phi0"] = math.degrees(math.atan2(-dp.z, dp.y))
        L.setdefault("theta_stance", (L["theta0"], L["theta0"] + L.get("theta_push", 16.0)))
        if "theta_swing_rel" in L:
            L["theta_swing"] = [(s_, L["theta0"] + d_) for s_, d_ in L["theta_swing_rel"]]


def build_creature(spec):
    t0 = time.time()
    reset_scene()
    name = spec["name"]
    os.makedirs(MODEL_DIR, exist_ok=True)
    os.makedirs(TEX_DIR, exist_ok=True)
    parts_V, parts_T, parts_W, parts_R, parts_mat = [], [], [], [], []
    bone_names = [b[0] for b in spec["skeleton"]]
    regions = spec["regions"]
    body = spec["body"]()
    disp = spec.get("disp")
    V, T = sdf_part(body, spec["h"], spec["tris"], disp=disp)
    parts_V.append(V)
    parts_T.append(T)
    parts_W.append(skin_weights(V, body, bone_names))
    parts_R.append(region_weights(V, body, regions))
    parts_mat.append(np.zeros(len(T), np.int32))
    for extra in spec.get("parts", []):
        pr = extra["prims"]()
        V, T = sdf_part(pr, extra["h"], extra["tris"])
        W = skin_weights(V, pr, bone_names)
        parts_V.append(V)
        parts_T.append(T)
        parts_W.append(W)
        parts_R.append(region_weights(V, pr, regions))
        parts_mat.append(np.zeros(len(T), np.int32))
    for m in spec.get("meshes", []):
        V, T, bw, reg, mat = m()
        parts_V.append(V)
        parts_T.append(T)
        W = np.zeros((len(V), len(bone_names)), np.float32)
        for bn, w in bw.items():
            W[:, bone_names.index(bn)] = w
        parts_W.append(normalize_top(W))
        R = np.zeros((len(V), len(regions)), np.float32)
        R[:, regions.index(reg)] = 1.0
        parts_R.append(R)
        parts_mat.append(np.full(len(T), mat, np.int32))
    off = 0
    allT = []
    for V, T in zip(parts_V, parts_T):
        allT.append(T + off)
        off += len(V)
    Vg = np.concatenate(parts_V, 0)
    Tg = np.concatenate(allT, 0)
    Wg = np.concatenate(parts_W, 0)
    Rg = np.concatenate(parts_R, 0)
    Mg = np.concatenate(parts_mat, 0)
    # drop degenerate triangles (repeated indices / zero area): Blender would silently remove them and the
    # per-face arrays + glTF export would go out of sync (empty primitive)
    e1 = Vg[Tg[:, 1]] - Vg[Tg[:, 0]]
    e2 = Vg[Tg[:, 2]] - Vg[Tg[:, 0]]
    area = np.linalg.norm(np.cross(e1, e2), axis=1)
    ok = (Tg[:, 0] != Tg[:, 1]) & (Tg[:, 1] != Tg[:, 2]) & (Tg[:, 0] != Tg[:, 2]) & (area > 1e-12)
    if not ok.all():
        log("dropping %d degenerate triangles" % int((~ok).sum()))
        Tg = Tg[ok]
        Mg = Mg[ok]
    # drop duplicate triangles (same vertex set, any winding): overlapping primitives (claw cones) produce them,
    # Blender's validate() merges them and the per-face arrays would no longer match -> exporter
    # 'Array length mismatch' and an EMPTY mesh in the glb
    key = np.sort(Tg, axis=1)
    _, first = np.unique(key, axis=0, return_index=True)
    if len(first) != len(Tg):
        first = np.sort(first)
        log("dropping %d duplicate triangles" % (len(Tg) - len(first)))
        Tg = Tg[first]
        Mg = Mg[first]
    obj = mesh_from_arrays(name, Vg, Tg)
    me = obj.data
    if me.validate(verbose=False):
        log("mesh.validate() changed the mesh: %d -> %d polygons" % (len(Tg), len(me.polygons)))
    # rebuild per-polygon material indices from the (validated) polygon list, keyed by the sorted vertex triple
    mat_of = {tuple(k): int(m) for k, m in zip(np.sort(Tg, axis=1).tolist(), Mg.tolist())}
    npoly = len(me.polygons)
    PV = np.empty(npoly * 3, np.int32)
    me.polygons.foreach_get("vertices", PV)
    PV = np.sort(PV.reshape(-1, 3), axis=1)
    Mp = [mat_of.get(tuple(r), 0) for r in PV.tolist()]
    Tg = PV  # keep the triangle list in sync for the metadata (count only; winding not used after this)
    me.polygons.foreach_set("use_smooth", [True] * npoly)
    me.polygons.foreach_set("material_index", Mp)
    for mn in spec.get("materials", ["fur", "eye"]):
        mat = bpy.data.materials.new(mn)
        me.materials.append(mat)
    me.update()
    # UVs
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62.0), island_margin=0.006, area_weight=0.0,
                             scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    except Exception as ex:  # noqa: BLE001
        log("pack_islands failed:", ex)
    bpy.ops.object.mode_set(mode="OBJECT")
    # normals (rest pose) for the pattern
    nv = len(me.vertices)
    nb = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get("normal", nb)
    Ng = b_arr_to_g(nb.reshape(-1, 3))
    img, uv_m = bake_texture(me, Vg, Ng, Rg, spec["tex"], spec["pattern"], regions)
    save_png(img, os.path.join(TEX_DIR, name + "_albedo.png"))
    for tex_name, pat in spec.get("extra_coats", {}).items():
        img2, _ = bake_texture(me, Vg, Ng, Rg, spec["tex"], pat, regions)
        save_png(img2, os.path.join(TEX_DIR, tex_name + "_albedo.png"))
    # armature + weights
    arm = build_armature(name, spec["skeleton"])
    for i, bn in enumerate(bone_names):
        col = Wg[:, i]
        nz = np.nonzero(col > 0.0)[0]
        if len(nz) == 0:
            continue
        vg = obj.vertex_groups.new(name=bn)
        for vi in nz.tolist():
            vg.add([vi], float(col[vi]), "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    rig = Rig(arm)
    prepare_legs(spec, rig)
    spec["pelvis_height"] = rig.rest_head(spec["bones"]["pelvis"]).z
    clips = bake_clips(arm, spec)
    # export
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    obj.select_set(True)
    path = os.path.join(MODEL_DIR, name + ".glb")
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_animations=True,
              export_animation_mode="ACTIONS", export_skins=True, export_morph=False,
              export_materials="PLACEHOLDER", export_yup=True, export_apply=False, export_force_sampling=True,
              export_frame_step=1, export_anim_single_armature=True, export_reset_pose_bones=True,
              export_texcoords=True, export_normals=True, export_def_bones=False, export_optimize_animation_size=False)
    bpy.ops.export_scene.gltf(**kw)
    meta = dict(species=name, clips=clips, uv_meters=uv_m, tris=int(len(Tg)), verts=int(len(Vg)),
                bones=bone_names, height=float(Vg[:, 1].max()), length=float(Vg[:, 2].max() - Vg[:, 2].min()),
                width=float(Vg[:, 0].max() - Vg[:, 0].min()))
    meta.update(spec.get("meta", {}))
    with open(os.path.join(MODEL_DIR, name + ".json"), "w") as fh:
        json.dump(meta, fh, indent=1, sort_keys=True)
    log("%s: %d tris, %d verts, %d clips -> %s (%.1fs)" % (name, len(Tg), len(Vg), len(clips), path, time.time() - t0))
    return obj, arm


def preview_render(obj, arm, path, clip=None, frame=0, cam_loc=(2.2, -1.2, 0.9), target=(0, 0, 0.5), res=(640, 400),
                   lens=50):
    """Workbench shape check (dev only)."""
    sc = bpy.context.scene
    if clip:
        arm.animation_data.action = bpy.data.actions[clip]
        sc.frame_set(frame)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = lens
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = Vector(cam_loc)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    img = bpy.data.images.load(os.path.join(TEX_DIR, obj.name + "_albedo.png"))
    for mat in obj.data.materials:
        mat.use_nodes = True
        nt = mat.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(tex.outputs[0], nt.nodes["Principled BSDF"].inputs[0])
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)

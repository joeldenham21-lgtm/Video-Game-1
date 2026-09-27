"""Ambient birds: common raven (Corvus corax, 0.62 m long, 1.25 m span, wedge tail, heavy bill, fingered wing tips)
and golden eagle (Aquila chrysaetos, 0.85 m, 2.1 m span, long broad wings with 6–7 deeply slotted primaries,
rounded tail). Static meshes in gliding pose (G-space, facing -Z, wings along ±X); the flap is done in
fur_bird.gdshader. SDF body + head + bill, planform sheets for wings and tail."""
import math
import os
import bpy
import numpy as np
import flib
from flib import Prim


def _sheet(outline_fn, nu, nv):
    """Grid sheet: outline_fn(u, v) -> (x, y, z) for u, v in [0, 1]."""
    V = []
    for j in range(nv + 1):
        for i in range(nu + 1):
            V.append(outline_fn(i / nu, j / nv))
    F = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            F.append((a, a + 1, a + nu + 2))
            F.append((a, a + nu + 2, a + nu + 1))
    return np.array(V, np.float32), np.array(F, np.int32)


def _feather(root, tip, w0, w1, n=4):
    root = np.asarray(root, np.float32)
    tip = np.asarray(tip, np.float32)
    d = tip - root
    side = np.array([-d[2], 0.0, d[0]], np.float32)
    side /= np.linalg.norm(side) + 1e-9

    def f(u, v):
        w = w0 + (w1 - w0) * u
        tipround = 1.0 - (max(u - 0.8, 0.0) / 0.2) ** 2 * 0.7
        p = root + d * u + side * (v - 0.5) * w * tipround
        p[1] -= 0.012 * u * u            # slight droop
        return tuple(p)

    return _sheet(f, n, 1)


def _wing(sx, span, chord, fingers, finger_len, sweep=0.03, droop=0.0):
    """Half wing on side sx (+1 / -1): inner wing sheet + fingered primaries."""
    xs = 0.05 * span / 0.62
    hand = xs + (span - xs) * 0.62

    def f(u, v):
        x = xs + (hand - xs) * u
        le = -0.06 * chord / 0.22 - sweep * u
        te = le + chord * (1.0 - 0.18 * u)
        z = le + (te - le) * v
        y = droop * u * u - 0.004 * math.sin(math.pi * v)
        return (sx * x, y, z)

    V, T = _sheet(f, 8, 4)
    Vs, Ts, off = [V], [T], len(V)
    le_h = -0.06 * chord / 0.22 - sweep
    te_h = le_h + chord * 0.82
    for i in range(fingers):
        t = i / max(fingers - 1, 1)
        rz = le_h + (te_h - le_h) * (0.12 + 0.6 * t)
        root = (sx * (hand - 0.01), droop, rz)
        tip = (sx * (span - finger_len * 0.25 * t), droop - 0.01, rz + finger_len * (0.05 + 0.5 * t) - 0.02)
        FV, FT = _feather(root, tip, chord * 0.2, chord * 0.12)
        Vs.append(FV)
        Ts.append(FT + off)
        off += len(FV)
    return np.concatenate(Vs), np.concatenate(Ts)


def _tail(z0, length, w0, w1, wedge):
    def f(u, v):
        z = z0 + length * u
        w = w0 + (w1 - w0) * u
        if wedge:
            z += length * 0.25 * (1.0 - abs(v - 0.5) * 2.0) * u   # wedge: centre feathers longest
        else:
            z += length * 0.12 * (1.0 - (2.0 * (v - 0.5)) ** 2) * u  # rounded fan
        return ((v - 0.5) * w, -0.005 * u, z)

    return _sheet(f, 4, 6)


def build(name, s, body_prims, span, chord, fingers, finger_len, tail, h, tris):
    V, T = flib.sdf_part(body_prims, h, tris, smooth_iters=2)
    parts = [(V, T)]
    for sx in (1.0, -1.0):
        parts.append(_wing(sx, span, chord, fingers, finger_len, droop=0.01 * s))
    parts.append(tail)
    Vs, Ts, off = [], [], 0
    for v, t in parts:
        Vs.append(v)
        Ts.append(t + off)
        off += len(v)
    obj = flib.mesh_from_arrays(name, np.concatenate(Vs), np.concatenate(Ts))
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    mat = bpy.data.materials.new("feathers")
    obj.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(flib.MODEL_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_animations=False,
                              export_materials="PLACEHOLDER", export_yup=True, export_normals=True,
                              export_texcoords=False)
    flib.log("%s: %d tris -> %s" % (name, sum(len(t) for _, t in parts), path))


def build_all():
    flib.reset_scene()
    raven = [
        Prim("ell", "b", "b", k=0.0, c=(0, 0, 0.0), r=(0.055, 0.052, 0.15)),
        Prim("ell", "b", "b", k=0.03, c=(0, 0.018, -0.16), r=(0.036, 0.038, 0.048)),
        Prim("ell", "b", "b", k=0.02, c=(0, -0.005, -0.12), r=(0.04, 0.04, 0.05)),
        Prim("cone", "b", "b", k=0.012, a=(0, 0.018, -0.195), b=(0, 0.006, -0.262), ra=0.017, rb=0.004),
    ]
    build("raven", 1.0, raven, 0.62, 0.22, 5, 0.2, _tail(0.1, 0.2, 0.06, 0.13, True), 0.004, 900)
    flib.reset_scene()
    k = 1.55
    eagle = [
        Prim("ell", "b", "b", k=0.0, c=(0, 0, 0.0), r=(0.075 * k / 1.4, 0.07 * k / 1.4, 0.2)),
        Prim("ell", "b", "b", k=0.04, c=(0, 0.025, -0.22), r=(0.045, 0.047, 0.06)),
        Prim("ell", "b", "b", k=0.03, c=(0, 0.0, -0.16), r=(0.055, 0.055, 0.07)),
        Prim("cone", "b", "b", k=0.012, a=(0, 0.022, -0.265), b=(0, 0.0, -0.31), ra=0.019, rb=0.005),
    ]
    build("eagle", k, eagle, 1.05, 0.36, 7, 0.34, _tail(0.14, 0.26, 0.1, 0.2, False), 0.005, 1000)

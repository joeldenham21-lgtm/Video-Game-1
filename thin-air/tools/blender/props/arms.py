"""THIN AIR — first-person gloved hands (one posed mesh per grip), written to assets/models/fp/arms.glb.

The poses, knuckle layout, segment lengths and grip points are the exact data of src/player/fp/fp_hands.gd
(POSES / FINGERS / THUMB_*), so every tool script that places a hand by its grip point keeps working. Instead of
the runtime tube fingers, each pose is modelled as one volume: palm with thenar/hypothenar pads, webbing,
padded phalanges with knuckle swell, then voxel-remeshed (seamless unions), relaxed, given leather creases
over the flexed joints and a baggy-glove wobble, and decimated to ~5k triangles.

Frame (right hand, Godot space): wrist at the origin, fingers toward -Z, back of the hand +Y, thumb on -X.
Output nodes: Hand_<pose> (one surface named "leather"; the viewmodel overrides it with the glove / mitt / skin
material of the equipped gloves). Left hands are mirrored at runtime.

    blender -b -P thin-air/tools/blender/props/build.py -- --set=arms
"""
import math

import bpy
from mathutils import Matrix, Vector, noise

from lib import common as C
from lib.geo import MB

FINGERS = [
    {"mcp": (-0.0285, 0.0015, -0.0815), "len": [0.043, 0.026, 0.023], "r0": 0.0104, "r1": 0.0091},
    {"mcp": (-0.0095, 0.0025, -0.0855), "len": [0.048, 0.030, 0.024], "r0": 0.0108, "r1": 0.0094},
    {"mcp": (0.0105, 0.0015, -0.0825), "len": [0.045, 0.028, 0.023], "r0": 0.0102, "r1": 0.009},
    {"mcp": (0.0285, -0.0005, -0.0755), "len": [0.035, 0.021, 0.020], "r0": 0.0092, "r1": 0.0081},
]
THUMB_BASE = Vector((-0.022, -0.009, -0.014))
THUMB_LEN = [0.042, 0.032, 0.027]
THUMB_R = [0.0152, 0.0122, 0.0108, 0.0098]
THUMB_R_GLOVE = [0.0158, 0.0128, 0.0111, 0.0096]

POSES = {
    "relaxed": {"fingers": [[-3, 16, 26, 14], [0, 20, 30, 16], [3, 24, 34, 18], [7, 28, 38, 20]],
                "thumb": [(-0.72, -0.3, -0.62), (-0.42, -0.38, -0.82), (-0.25, -0.42, -0.87)]},
    "grip": {"fingers": [[-2, 62, 88, 42], [0, 66, 90, 44], [2, 70, 92, 46], [5, 74, 94, 48]],
             "thumb": [(-0.62, -0.5, -0.6), (-0.05, -0.72, -0.69), (0.42, -0.62, -0.66)]},
    "grip_loose": {"fingers": [[-2, 52, 76, 36], [0, 56, 78, 38], [2, 60, 80, 40], [5, 64, 84, 42]],
                   "thumb": [(-0.66, -0.45, -0.6), (-0.22, -0.66, -0.72), (0.18, -0.64, -0.75)]},
    "fist": {"fingers": [[-2, 86, 100, 62], [0, 88, 102, 64], [2, 90, 104, 66], [5, 92, 106, 68]],
             "thumb": [(-0.55, -0.55, -0.62), (0.12, -0.72, -0.68), (0.62, -0.5, -0.6)]},
    "open": {"fingers": [[-8, 4, 6, 4], [-2, 4, 6, 4], [4, 5, 7, 4], [10, 6, 8, 5]],
             "thumb": [(-0.8, -0.2, -0.56), (-0.66, -0.2, -0.72), (-0.55, -0.2, -0.81)]},
    "hold": {"fingers": [[-4, 34, 44, 24], [-1, 38, 46, 26], [2, 42, 48, 28], [6, 46, 50, 30]],
             "thumb": [(-0.7, -0.42, -0.58), (-0.3, -0.56, -0.77), (-0.05, -0.58, -0.81)]},
    "hook": {"fingers": [[-2, 18, 82, 58], [0, 20, 84, 60], [2, 24, 86, 62], [5, 70, 96, 60]],
             "thumb": [(-0.7, -0.35, -0.62), (-0.3, -0.5, -0.81), (-0.08, -0.55, -0.83)]},
    "pinch": {"fingers": [[-2, 44, 62, 30], [0, 58, 86, 44], [2, 64, 90, 46], [5, 70, 94, 48]],
              "thumb": [(-0.68, -0.46, -0.57), (-0.2, -0.62, -0.76), (0.18, -0.6, -0.78)]},
}

TARGET_TRIS = 5200
VOXEL = 0.0012


def _catmull(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
                  (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


def _smooth(pts, sub):
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for k in range(sub):
            out.append(_catmull(p0, p1, p2, p3, k / sub))
    out.append(pts[-1])
    return out


def _rotated(v, axis, ang):
    return Matrix.Rotation(ang, 3, axis) @ v


def _section(n=14, dorsal=0.9, palmar=1.06, ex=2.0):
    """Unit cross-section (x = side, y = dorsal/+Y): flatter back, fuller pads; ex > 2 = boxier."""
    out = []
    for j in range(n):
        a = math.tau * j / n
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2.0 / ex), c)
        y = math.copysign(abs(s) ** (2.0 / ex), s)
        out.append((x, y * (dorsal if y > 0 else palmar)))
    return out


def finger_chain(i, angles):
    """Joint positions (Godot space) of finger i for [spread, mcp, pip, dip] (same maths as FPHands._finger)."""
    f = FINGERS[i]
    spread = math.radians(-angles[0])
    d = _rotated(Vector((0, 0, -1)), Vector((0, 1, 0)), spread)
    lateral = _rotated(Vector((1, 0, 0)), Vector((0, 1, 0)), spread)
    mcp = Vector(f["mcp"])
    joints = [mcp - d * 0.014, mcp]
    p = mcp.copy()
    dirs = []
    for k in range(3):
        d = _rotated(d, lateral, -math.radians(angles[k + 1]))
        p = p + d * f["len"][k]
        joints.append(p.copy())
        dirs.append(d.copy())
    return joints, dirs, lateral


def thumb_chain(dirs):
    joints = [THUMB_BASE.copy()]
    p = THUMB_BASE.copy()
    for k in range(3):
        p = p + Vector(dirs[k]).normalized() * THUMB_LEN[k]
        joints.append(p.copy())
    return joints


def _dome(path, rad, cap_len_scale=0.95, steps=4):
    """Extends a path past its end with a rounded (hemispherical) closing, shrinking the radius."""
    d = (path[-1] - path[-2]).normalized()
    r_end = rad[-1]
    rx = r_end[0] if isinstance(r_end, tuple) else r_end
    ry = r_end[1] if isinstance(r_end, tuple) else r_end
    base = path[-1]
    L = max(rx, ry) * cap_len_scale
    for k in range(1, steps + 1):
        t = k / steps
        a = t * math.pi * 0.5
        s = max(math.cos(a), 0.12)
        path.append(base + d * (math.sin(a) * L))
        rad.append((rx * s, ry * s))


def build_hand(pose_name):
    pose = POSES[pose_name]
    mb = MB()
    up = Vector((0, 1, 0))
    # ---- palm: a padded, slightly boxy loaf from inside the gauntlet to the knuckle line.
    palm_path = []
    palm_rad = []
    for (z, w, h, xo, yo) in ((0.02, 0.0265, 0.0178, 0.0, -0.0008), (0.004, 0.0292, 0.0181, 0.0, -0.0006),
                              (-0.018, 0.0345, 0.0182, -0.0006, -0.0005), (-0.04, 0.0395, 0.0172, 0.0, -0.0002),
                              (-0.058, 0.0418, 0.0158, 0.0005, 0.0), (-0.07, 0.0418, 0.0142, 0.0005, 0.0003),
                              (-0.078, 0.0395, 0.0122, 0.0005, 0.0005)):
        palm_path.append(Vector((xo, yo, z)))
        palm_rad.append((w, h))
    mb.tube(palm_path, palm_rad, mat="leather", section=_section(24, 0.84, 1.04, 2.5), up=up)
    # ---- hypothenar pad (outer heel of the palm, +X) and thenar pad (thumb ball).
    mb.tube([Vector((0.022, -0.006, 0.006)), Vector((0.027, -0.007, -0.02)), Vector((0.026, -0.006, -0.048))],
            [(0.011, 0.0115), (0.0125, 0.0125), (0.0095, 0.0095)], seg=12, mat="leather", up=up)
    tj = thumb_chain(pose["thumb"])
    # thenar mass: the thumb metacarpal sits INSIDE the palm's padded edge, not as a free tube
    mb.tube([Vector((-0.008, -0.009, 0.004)), THUMB_BASE.lerp(tj[1], 0.35) + Vector((0.004, -0.001, 0.0)),
             tj[1] + Vector((0.003, 0.0005, 0.0))],
            [(0.0155, 0.0135), (0.0168, 0.0142), (0.0118, 0.0106)], seg=14, mat="leather", up=up)
    # first web space (thumb <-> index), thin and taut
    idx_root = Vector(FINGERS[0]["mcp"]) + Vector((-0.004, -0.003, 0.012))
    web_mid = idx_root.lerp(tj[1], 0.5) + Vector((0.0, -0.002, 0.004))
    mb.tube([idx_root, web_mid, tj[1] + (tj[2] - tj[1]) * 0.25], [(0.0085, 0.006), (0.0082, 0.0055), (0.0075, 0.006)],
            seg=12, mat="leather", up=up)
    # ---- fingers (+ webbing between the proximal phalanges).
    web_pts = []
    for i in range(4):
        joints, dirs, lateral = finger_chain(i, pose["fingers"][i])
        f = FINGERS[i]
        path = _smooth(joints, 5)
        rad = []
        n = len(path)
        for k in range(n):
            t = k / (n - 1)
            r = f["r0"] * 1.04 + (f["r1"] - f["r0"] * 1.04) * t
            # knuckle swell at MCP / PIP / DIP, slimmer between (phalanx waist)
            sw = 0.0
            for (jt, amt) in ((0.2, 0.0011), (0.6, 0.0009), (0.83, 0.0006)):
                sw += math.exp(-((t - jt) / 0.055) ** 2) * amt
            waist = -0.00045 * math.sin(max(0.0, min(1.0, (t - 0.2) / 0.4)) * math.pi)
            rr = r + sw + waist
            rad.append((rr * 1.02, rr * 0.93))
        _dome(path, rad, 1.0, 5)
        mb.tube(path, rad, mat="leather", section=_section(14, 0.9, 1.08, 2.3), up=up)
        web_pts.append((joints[1] + dirs[0] * 0.012, dirs[0]))
    # webbing: a flat band joining the finger roots on the palm side
    wp = [p + Vector((0, -0.004, 0.0)) for (p, _d) in web_pts]
    wp = [wp[0] + (wp[0] - wp[1]) * 0.15] + wp + [wp[-1] + (wp[-1] - wp[-2]) * 0.15]
    mb.tube(_smooth(wp, 3), [(0.0075, 0.0068)] * len(_smooth(wp, 3)), seg=10, mat="leather",
            up=Vector((0, 0, -1)))
    # ---- thumb
    tpath = _smooth(tj, 5)
    trad = []
    for k in range(len(tpath)):
        t = k / (len(tpath) - 1)
        x = t * (len(THUMB_R) - 1)
        i0 = min(int(x), len(THUMB_R) - 2)
        r = THUMB_R_GLOVE[i0] + (THUMB_R_GLOVE[i0 + 1] - THUMB_R_GLOVE[i0]) * (x - i0)
        r += math.exp(-((t - 0.66) / 0.06) ** 2) * 0.0007
        trad.append((r * 1.05, r * 0.9))
    _dome(tpath, trad, 1.0, 5)
    tup = Vector((-0.55, 0.75, 0.2)).normalized()
    mb.tube(tpath, trad, mat="leather", section=_section(14, 0.9, 1.08, 2.2), up=tup)

    ob = mb.to_object("Hand_" + pose_name, C.mat)
    # ---- one seamless volume
    rm = ob.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = VOXEL
    rm.adaptivity = 0.0
    rm.use_smooth_shade = True
    sm = ob.modifiers.new("relax", "LAPLACIANSMOOTH")
    sm.iterations = 6
    sm.lambda_factor = 0.8
    sm.use_volume_preserve = True
    sm.use_normalized = True
    import time
    t0 = time.time()
    _apply_all(ob)
    t1 = time.time()
    _creases(ob, pose)
    print("    remesh+relax %.1fs (%d verts), creases %.1fs" % (t1 - t0, len(ob.data.vertices), time.time() - t1))
    dec = ob.modifiers.new("decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = min(1.0, TARGET_TRIS / max(1, C.tris([ob])))
    dec.use_collapse_triangulate = True
    _apply_all(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.clear()
    ob.data.materials.append(C.mat("leather"))
    return ob


def _apply_all(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = ob.name
    bpy.data.meshes.remove(old)


def _creases(ob, pose):
    """Leather creases across the back of each flexed joint + a soft baggy wobble (numpy, Godot space)."""
    import numpy as np
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    nr = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    me.vertices.foreach_get("normal", nr)
    co = co.reshape(n, 3)
    nr = nr.reshape(n, 3)
    P = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)          # Blender -> Godot
    N = np.stack([nr[:, 0], nr[:, 2], -nr[:, 1]], 1)
    disp = np.zeros(n)
    dorsal = np.clip(N[:, 1], 0.0, 1.0)
    palmar = np.clip(-N[:, 1], 0.0, 1.0)
    for i in range(4):
        joints, dirs, lateral = finger_chain(i, pose["fingers"][i])
        bends = pose["fingers"][i][1:]
        for (jp, d, bend, reach) in ((joints[1], dirs[0], bends[0], 0.0105), (joints[2], dirs[1], bends[1], 0.0085),
                                     (joints[3], dirs[2], bends[2], 0.0075)):
            jp = np.array(jp[:])
            d = np.array(d[:])
            rel = P - jp
            along = rel @ d
            radial = np.linalg.norm(rel - np.outer(along, d), axis=1)
            m = (radial < reach * 1.9) & (np.abs(along) < 0.012)
            flex = min(1.0, max(0.0, bend / 90.0))
            ridge = np.cos(along / 0.0032 * np.pi) * np.exp(-(along / 0.0065) ** 2)
            dd = 0.00042 * flex * dorsal * ridge - 0.00055 * flex * palmar * np.exp(-(along / 0.0018) ** 2)
            disp += np.where(m, dd, 0.0)
    # baggy glove: smooth sine-lattice wobble (deterministic, no per-vertex Python)
    w = (np.sin(P[:, 0] * 610.0 + np.sin(P[:, 2] * 420.0) * 1.3) * np.sin(P[:, 2] * 520.0 + 1.7) *
         np.cos(P[:, 1] * 470.0 + 0.4))
    disp += w * 0.00018
    co += nr * disp[:, None]
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def build_all(out_dir, only=None):
    objs = []
    for name in POSES:
        if only and name not in only:
            continue
        ob = build_hand(name)
        objs.append(ob)
        print("  Hand_%s: %d tris" % (name, C.tris([ob])))
    return objs

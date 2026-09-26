"""THIN AIR — world props for story locations and loot (real-world scale, resting on y = 0, centred in XZ).

Each builder returns objects + physics metadata; build.py exports assets/models/props/<id>.glb and writes
scenes/props/<id>.tscn: StaticBody3D on layer 1 (world dressing) or RigidBody3D on layer 4 (light physics props,
asleep until touched), with primitive collision shapes (default: the model's bounding box).
Leaning props (pickaxe, shovel) are authored leaning toward -Z: put their back against a wall.
"""
import math

import bpy
from mathutils import Matrix, Vector, noise

from lib import common as C
from lib import registry as R
from lib.geo import MB, smoothstep, lerp
import models_tools as TOOLS


def _noise_split(mb, f0, mat, freq=6.0, thresh=0.25, seed=0.0, bias=None):
    """Re-materials faces where 3D noise at the face centre exceeds thresh (rust patches, wear)."""
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for fc in mb.f[f0:]:
        c = sum((mb.v[i] for i in fc.idx), Vector()) / len(fc.idx)
        n = noise.noise(c * freq + off) + 0.5 * noise.noise(c * freq * 2.3 + off * 2.0)
        if bias:
            n += bias(c)
        if n > thresh:
            fc.mat = mat


def _plank_box(mb, size, center, mat, gap=0.006, n=3, axis="x", thick=0.018):
    """A face of parallel planks (a crate side) as separate boards with small gaps."""
    sx, sy, sz = size
    cx, cy, cz = center
    if axis == "x":       # boards run along X, stacked in Y
        h = (sy - gap * (n - 1)) / n
        for i in range(n):
            y = cy - sy / 2 + h / 2 + i * (h + gap)
            mb.box((sx, h, thick), (cx, y, cz), mat=mat)
    else:                 # boards run along Z, side by side in X (lids / bottoms)
        w = (sx - gap * (n - 1)) / n
        for i in range(n):
            x = cx - sx / 2 + w / 2 + i * (w + gap)
            mb.box((w, thick, sz), (x, cy, cz), mat=mat)


def _text(body, size, gd_matrix, mat, extrude=0.0015):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 2
    tob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(tob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    bpy.data.objects.remove(tob, do_unlink=True)
    ob = bpy.data.objects.new("text", me)
    bpy.context.scene.collection.objects.link(ob)
    # font space (XY, facing +Z Blender) -> Godot XY facing +Z, then the Godot placement
    me.transform(Matrix.Rotation(math.radians(90), 4, "X"))
    C.gd_transform_object(ob, gd_matrix)
    me.materials.append(C.mat(mat))
    me.uv_layers.new(name="UVMap")
    return ob


def _box_col(size, pos, yaw=0.0):
    return {"type": "box", "size": [round(x, 4) for x in size], "pos": [round(x, 4) for x in pos], "yaw": yaw}


# ================================================================================================ crates

def _crate(open_lid):
    mb = MB()
    L, H, W = 0.8, 0.5, 0.5
    t = 0.018
    f0 = len(mb.f)
    # sides (3 boards each), ends
    for sz in (-1, 1):
        _plank_box(mb, (L - 0.004, H - 0.03, t), (0.0, H / 2 + 0.005, sz * (W / 2 - t / 2)), "wood_weathered", n=3)
    for sx in (-1, 1):
        mb.box((t, H - 0.03, W - 2 * t), (sx * (L / 2 - t / 2), H / 2 + 0.005, 0.0), mat="wood_weathered")
    mb.box((L - 2 * t, t, W - 2 * t), (0.0, 0.03, 0.0), mat="wood_weathered")          # floor
    # corner battens + skids
    for sx in (-1, 1):
        for sz in (-1, 1):
            mb.box((0.045, H, 0.022), (sx * (L / 2 - 0.0225), H / 2, sz * (W / 2 + 0.011)), mat="wood")
        mb.box((0.07, 0.03, W + 0.04), (sx * (L / 2 - 0.08), 0.015, 0.0), mat="wood")
    # horizontal battens top & bottom on the long sides
    for sz in (-1, 1):
        for y in (0.045, H - 0.02):
            mb.box((L - 0.09, 0.04, 0.02), (0.0, y, sz * (W / 2 + 0.01)), mat="wood")
    _noise_split(mb, f0, "wood_pale", freq=4.0, thresh=0.42, seed=2.0)
    lid_y = H + t / 2 + 0.002
    lid = MB()
    _plank_box(lid, (L, t, W + 0.03), (0.0, 0.0, 0.0), "wood_weathered", n=4, axis="z")
    for x in (-L / 2 + 0.06, L / 2 - 0.06):
        lid.box((0.06, 0.02, W - 0.02), (x, -0.019, 0.0), mat="wood")
    if open_lid:
        # lid pried off, leaning against the crate's long side
        lid.xform(R.T(0.0, 0.24, W / 2 + 0.147) @ R.rot("X", -115.0))
        # straw packing peeking out
        mb.blob((0.0, H - 0.05, 0.0), (L / 2 - 0.05, 0.05, W / 2 - 0.05), subdiv=3, mat="grass", amp=0.35,
                freq=6.0, seed=4)
    else:
        lid.xform(R.T(0.0, lid_y, 0.0))
    mb.merge(lid)
    ob = R.obj(mb, "crate", smooth_angle=30)
    R.rest_on_ground([ob])
    cols = [_box_col((L, H + 0.02, W + 0.04), (0.0, (H + 0.02) / 2, 0.0))]
    if open_lid:
        cols.append(_box_col((L, 0.04, W + 0.03), (0.0, 0.24, W / 2 + 0.147)))
        cols[1]["pitch"] = -115.0
    return {"objects": [ob], "collision": cols, "body": "static"}


R.prop("crate_closed")(lambda: _crate(False))
R.prop("crate_open")(lambda: _crate(True))


# ================================================================================================ drums, cans, cylinders

@R.prop("oil_drum")
def oil_drum():
    """205 L steel drum, faded blue paint rusting through: rolling hoops, chimes, two bungs."""
    mb = MB()
    r, h = 0.286, 0.88
    # dense rings so per-face rust patches read as blotches, not stripes
    prof = [(0.0001, 0.004)] + [(r * k / 5, 0.004) for k in range(1, 5)] + \
        [(r - 0.012, 0.004), (r - 0.004, 0.0), (r + 0.004, 0.012), (r, 0.022)]
    y = 0.022
    for yh in (0.3, 0.58, 1.0):
        top = h * yh - 0.018 if yh < 1.0 else h - 0.022
        while y + 0.035 < top:
            y += 0.035
            prof.append((r, y))
        if yh < 1.0:                                # the two rolling hoops
            prof += [(r, h * yh - 0.018), (r + 0.011, h * yh - 0.006), (r + 0.011, h * yh + 0.006), (r, h * yh + 0.018)]
            y = h * yh + 0.018
    prof += [(r, h - 0.022), (r + 0.004, h - 0.012), (r - 0.004, h), (r - 0.012, h - 0.004)]
    prof += [(r * k / 5, h - 0.004) for k in range(4, 0, -1)] + [(0.0001, h - 0.004)]
    f0 = len(mb.f)
    mb.lathe(prof, seg=36, mat="paint_blue")
    _noise_split(mb, f0, "rust", freq=11.0, thresh=0.3, seed=1.0,
                 bias=lambda c: 0.35 * (1.0 - smoothstep(0.0, 0.25, c.y)) + 0.25 * smoothstep(0.8, 0.88, c.y))
    for (x, z, rr) in ((0.17, 0.05, 0.03), (-0.19, -0.02, 0.018)):
        mb.lathe([(0.0001, 0.0), (rr, 0.0), (rr, 0.012), (0.0001, 0.012)], seg=12, mat="rust",
                 m=R.T(x, h - 0.006, z))
    ob = R.obj(mb, "oil_drum", smooth_angle=35)
    return {"objects": [ob], "collision": [{"type": "cylinder", "radius": r + 0.01, "height": h, "pos": [0, h / 2, 0]}],
            "body": "static"}


@R.prop("jerrycan")
def jerrycan20():
    """20 L NATO jerrycan, army olive: three-handle top, X pressings, mid seam, spout with cam lever."""
    mb = MB()
    Lx, Hy, Wz = 0.345, 0.47, 0.165
    sec = []
    for j in range(32):
        a = j / 32 * math.tau
        c, s = math.cos(a), math.sin(a)
        sec.append((math.copysign(abs(c) ** (2 / 7.0), c), math.copysign(abs(s) ** (2 / 7.0), s)))
    path = [Vector((0, y, 0)) for y in (0.0, 0.008, 0.025, Hy - 0.04, Hy - 0.015, Hy)]
    rad = [(Lx / 2 - 0.01, Wz / 2 - 0.008), (Lx / 2 - 0.002, Wz / 2 - 0.001), (Lx / 2, Wz / 2), (Lx / 2, Wz / 2),
           (Lx / 2 - 0.005, Wz / 2 - 0.005), (Lx / 2 - 0.016, Wz / 2 - 0.016)]
    f0 = len(mb.f)
    mb.tube(path, rad, section=sec, mat="paint_olive", up=(0, 0, 1))
    seam = []
    for j in range(56):
        a = j / 56 * math.tau
        c, s = math.cos(a), math.sin(a)
        seam.append(Vector((math.copysign(abs(c) ** (2 / 7.0), c) * (Lx / 2 + 0.003),
                            Hy / 2 + math.copysign(abs(s) ** (2 / 7.0), s) * (Hy / 2 + 0.002), 0.0)))
    mb.tube(seam, (0.004, 0.006), seg=6, mat="paint_olive", closed=True, up=(0, 0, 1))
    for sz in (-1, 1):
        zf = sz * (Wz / 2 + 0.0015)
        for (a, b) in (((-0.12, 0.06), (0.12, 0.38)), ((-0.12, 0.38), (0.12, 0.06))):
            mb.tube([Vector((a[0], a[1], zf)), Vector((b[0], b[1], zf))], (0.009, 0.003), seg=8, mat="paint_olive",
                    up=(0, 0, sz))
    for hx in (-0.09, -0.02, 0.05):                 # three handles
        mb.tube([Vector((hx - 0.018, Hy - 0.005, 0)), Vector((hx - 0.014, Hy + 0.035, 0)),
                 Vector((hx + 0.014, Hy + 0.035, 0)), Vector((hx + 0.018, Hy - 0.005, 0))], (0.006, 0.01), seg=8,
                mat="paint_olive", up=(0, 0, 1))
    sx = 0.13
    mb.lathe([(0.0001, Hy - 0.012), (0.026, Hy - 0.012), (0.026, Hy + 0.02), (0.023, Hy + 0.027), (0.0001, Hy + 0.027)],
             seg=18, mat="paint_olive", m=R.T(sx, 0, 0))
    mb.tube([Vector((sx - 0.025, Hy + 0.03, 0.0)), Vector((sx - 0.06, Hy + 0.04, 0.0))], (0.005, 0.01), seg=8,
            mat="steel_dark", up=(0, 0, 1))
    _noise_split(mb, f0, "rust", freq=18.0, thresh=0.55, seed=5.0)
    ob = R.obj(mb, "jerrycan", bevel=0.001, bevel_segments=1)
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 18.0}


@R.prop("gas_cylinder")
def gas_cylinder():
    """20 lb propane cylinder (camp/station): white body, foot ring, protective collar with hand holes, valve."""
    mb = MB()
    r = 0.152
    mb.lathe([(0.0001, 0.035), (0.09, 0.035), (0.135, 0.05), (r, 0.09), (r, 0.36), (0.135, 0.41), (0.09, 0.43),
              (0.0001, 0.435)], seg=32, mat="paint_white")
    mb.lathe([(0.12, 0.0), (0.126, 0.0), (0.126, 0.05), (0.12, 0.05), (0.12, 0.0)], seg=32, mat="paint_white")       # foot ring
    mb.lathe([(0.075, 0.42), (0.082, 0.42), (0.082, 0.54), (0.075, 0.54), (0.075, 0.42)], seg=28, mat="paint_white")  # collar
    mb.lathe([(0.0001, 0.43), (0.016, 0.43), (0.016, 0.49), (0.022, 0.5), (0.022, 0.515), (0.0001, 0.515)], seg=14,
             mat="brass")
    mb.lathe([(0.0001, 0.515), (0.03, 0.515), (0.03, 0.53), (0.0001, 0.53)], seg=14, mat="plastic_black")
    ob = R.obj(mb, "gas_cylinder", bevel=0.0008, bevel_segments=1)
    return {"objects": [ob], "collision": [{"type": "cylinder", "radius": r, "height": 0.54, "pos": [0, 0.27, 0]}],
            "body": "rigid", "mass": 17.0}


# ================================================================================================ boxes

@R.prop("toolbox")
def toolbox():
    """Red steel cantilever toolbox with a folding handle and two latches."""
    mb = MB()
    L, H, W = 0.5, 0.21, 0.22
    mb.box((L, H * 0.62, W), (0, H * 0.31, 0), mat="paint_red")
    lid = [(-L / 2, H * 0.62), (L / 2, H * 0.62), (L / 2 - 0.02, H), (-L / 2 + 0.02, H)]
    mb.prism([(x, y) for (x, y) in lid], W, mat="paint_red")
    mb.tube([Vector((-0.1, H, 0)), Vector((-0.1, H + 0.04, 0)), Vector((0.1, H + 0.04, 0)), Vector((0.1, H, 0))],
            0.007, seg=8, mat="plastic_black")
    for x in (-0.16, 0.16):
        mb.box((0.03, 0.05, 0.006), (x, H * 0.6, W / 2 + 0.003), mat="steel")
    mb.box((L + 0.004, 0.006, W + 0.004), (0, H * 0.62, 0), mat="steel_dark")
    ob = R.obj(mb, "toolbox", bevel=0.0025, bevel_segments=2)
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 9.0}


@R.prop("ammo_box")
def ammo_box():
    """Steel .50 cal ammunition can (army olive): lid with cam latch and folding carry handle."""
    mb = MB()
    L, H, W = 0.3, 0.19, 0.155
    f0 = len(mb.f)
    mb.box((L, H - 0.02, W), (0, (H - 0.02) / 2, 0), mat="paint_olive")
    mb.box((L + 0.01, 0.028, W + 0.01), (0, H - 0.014, 0), mat="paint_olive")
    mb.box((0.04, 0.05, 0.012), (L / 2 + 0.006, H - 0.03, 0), mat="paint_olive")                   # latch
    mb.tube([Vector((-0.07, H, 0)), Vector((-0.06, H + 0.03, 0)), Vector((0.06, H + 0.03, 0)), Vector((0.07, H, 0))],
            (0.006, 0.01), seg=8, mat="paint_olive", up=(0, 0, 1))
    for sz in (-1, 1):                                                                              # stiffening ribs
        for x in (-0.09, 0.0, 0.09):
            mb.box((0.012, H - 0.06, 0.004), (x, (H - 0.02) / 2, sz * (W / 2 + 0.002)), mat="paint_olive")
    _noise_split(mb, f0, "rust", freq=22.0, thresh=0.62, seed=8.0)
    ob = R.obj(mb, "ammo_box", bevel=0.0015, bevel_segments=1)
    t = _text("CARTRIDGES CAL .50", 0.016, R.T(0.0, 0.1, W / 2 + 0.0015), "paint_yellow", extrude=0.0003)
    R.rest_on_ground([ob, t])
    return {"objects": [ob, t], "body": "rigid", "mass": 7.0}


@R.prop("cardboard_box")
def cardboard_box():
    """A taped cardboard carton with slightly bulged sides and a crushed corner."""
    mb = MB()
    L, H, W = 0.46, 0.3, 0.32
    s0 = len(mb.v)
    f0 = len(mb.f)
    for (size, c) in (((L, H, W), (0, H / 2, 0)),):
        # subdivided box for the bulge
        mb.grid(L, W, 8, 6, mat="cardboard", m=R.T(0, H, 0))
        mb.grid(L, W, 8, 6, mat="cardboard", m=R.rot("X", 180))
        mb.grid(L, H, 8, 6, mat="cardboard", m=R.T(0, H / 2, W / 2) @ R.rot("X", 90))
        mb.grid(L, H, 8, 6, mat="cardboard", m=R.T(0, H / 2, -W / 2) @ R.rot("X", -90))
        mb.grid(H, W, 6, 6, mat="cardboard", m=R.T(L / 2, H / 2, 0) @ R.rot("Z", -90))
        mb.grid(H, W, 6, 6, mat="cardboard", m=R.T(-L / 2, H / 2, 0) @ R.rot("Z", 90))

    def bulge(p):
        q = Vector(p)
        fx = 1.0 - (2 * p.x / L) ** 2
        fz = 1.0 - (2 * p.z / W) ** 2
        fy = 1.0 - (2 * (p.y - H / 2) / H) ** 2
        q.x += math.copysign(0.008 * fz * fy, p.x) if abs(p.x) > L / 2 - 1e-4 else 0.0
        q.z += math.copysign(0.008 * fx * fy, p.z) if abs(p.z) > W / 2 - 1e-4 else 0.0
        if p.y > H - 1e-4:
            q.y -= 0.01 * fx * fz
        if p.x > L / 2 - 0.12 and p.y > H - 0.1 and p.z > W / 2 - 0.12:                           # crushed corner
            k = smoothstep(L / 2 - 0.12, L / 2, p.x) * smoothstep(W / 2 - 0.12, W / 2, p.z) * smoothstep(H - 0.1, H, p.y)
            q.y -= 0.03 * k
            q.x -= 0.012 * k
        return q
    mb.deform(bulge, s0)
    mb.box((0.05, 0.002, W + 0.004), (0, H + 0.001 - 0.01, 0), mat="tape_silver")
    ob = R.obj(mb, "cardboard_box", smooth_angle=45)
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 3.0}


@R.prop("first_aid_box")
def first_aid_box():
    """Wall-mounted steel first-aid cabinet (white, green cross), back at z = 0 (mount on a wall facing +Z)."""
    mb = MB()
    L, H, D = 0.36, 0.44, 0.12
    mb.box((L, H, D), (0, H / 2, D / 2), mat="paint_white")
    mb.box((L - 0.02, H - 0.02, 0.008), (0, H / 2, D + 0.004), mat="paint_white")
    for (w, h) in ((0.13, 0.04), (0.04, 0.13)):
        mb.box((w, h, 0.002), (0, H / 2 + 0.02, D + 0.0085), mat="paint_green")
    mb.box((0.012, 0.05, 0.012), (L / 2 - 0.03, H / 2, D + 0.012), mat="steel")
    ob = R.obj(mb, "first_aid_box", bevel=0.002, bevel_segments=1)
    t = _text("FIRST AID", 0.03, R.T(0.0, 0.07, D + 0.009), "paint_green", extrude=0.0004)
    R.rest_on_ground([ob, t], center_xz=False)
    return {"objects": [ob, t], "body": "static"}


# ================================================================================================ camp gear

@R.prop("tarp")
def tarp():
    """Blue poly tarp thrown over a stack of gear: draped sheet with folds pooling on the ground."""
    mb = MB()
    W, D = 2.4, 1.8

    def drape(u, v, p):
        x, z = p.x, p.z
        # the hidden load: a rounded box 1.1 x 0.6 x 0.8 under the centre
        bx, bz, bh = 0.55, 0.4, 0.6
        dx = max(0.0, abs(x) - bx)
        dz = max(0.0, abs(z) - bz)
        d = math.hypot(dx, dz)
        h = bh * math.exp(-(d / 0.25) ** 2) if d > 0 else bh
        h = max(h, 0.0)
        h -= 0.035 * (abs(x) < bx and abs(z) < bz) * (math.sin(x * 9.0) * 0.5 + 0.5)
        folds = 0.025 * math.sin(x * 7.0 + z * 3.0) * math.cos(z * 5.0 - x * 2.0) * (1.0 - min(1.0, h / bh))
        h += folds + 0.02 * noise.noise(Vector((x * 2.5, z * 2.5, 0.7))) + 0.012
        return Vector((x + 0.03 * math.sin(z * 4.0), max(h, 0.008), z + 0.03 * math.sin(x * 3.0)))

    mb.grid(W, D, 28, 21, mat="weave_blue", fn=drape, two_sided=True, thickness=0.002)
    # grommet rope trailing off one corner
    mb.tube([Vector((W / 2 - 0.05, 0.02, D / 2 - 0.05)), Vector((W / 2 + 0.15, 0.012, D / 2 + 0.05)),
             Vector((W / 2 + 0.3, 0.01, D / 2 - 0.05))], 0.004, seg=6, mat="rope")
    ob = R.obj(mb, "tarp", smooth_angle=70)
    R.rest_on_ground([ob])
    return {"objects": [ob], "collision": [_box_col((1.2, 0.62, 0.9), (0, 0.31, 0))], "body": "static"}


@R.prop("backpack_dropped")
def backpack_dropped():
    """A canvas rucksack dropped on its back: main bag, lid flap, front pocket, straps and buckles."""
    mb = MB()
    sec = TOOLS._round_rect_section(6, 2.8)
    body = [Vector((0, 0.0, z)) for z in (-0.26, -0.24, -0.1, 0.12, 0.24, 0.27)]
    mb.tube(body, [(0.13, 0.08), (0.155, 0.1), (0.16, 0.11), (0.155, 0.105), (0.145, 0.095), (0.12, 0.07)],
            section=sec, mat="weave_olive", up=(0, 1, 0))
    s0 = len(mb.v)
    mb.blob((0.0, 0.1, 0.2), (0.15, 0.03, 0.1), subdiv=3, mat="weave_olive", amp=0.05, seed=2)       # lid flap
    mb.blob((0.0, 0.1, -0.08), (0.11, 0.045, 0.1), subdiv=3, mat="weave_olive", amp=0.04, seed=3,
            flat_bottom=0.6)                                                                         # front pocket
    for x in (-0.07, 0.07):                                                                          # lid straps
        mb.tube([Vector((x, 0.13, 0.24)), Vector((x, 0.145, 0.12)), Vector((x, 0.13, 0.02)),
                 Vector((x, 0.11, -0.04))], (0.013, 0.0025), seg=6, mat="strap_black", up=(0, 1, 0))
        mb.box((0.028, 0.008, 0.02), (x, 0.14, 0.03), mat="plastic_black")
    for x in (-0.08, 0.08):                                                                          # shoulder straps
        mb.tube([Vector((x, -0.1, 0.22)), Vector((x * 1.4, -0.14, 0.12)), Vector((x * 1.6, -0.1, -0.1)),
                 Vector((x * 2.1, -0.08, -0.28)), Vector((x * 2.6, -0.1, -0.36))], (0.028, 0.006), seg=6,
                mat="strap_black", up=(0, 1, 0))
    ob = R.obj(mb, "backpack_dropped", smooth_angle=60)
    R.xform([ob], R.rot("Z", 8))
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 6.0}


@R.prop("sleeping_bag")
def sleeping_bag():
    """An unrolled mummy sleeping bag lying flat: quilted baffles, hood, side zip."""
    mb = MB()
    L = 2.05
    path, rad = [], []
    for i in range(41):
        f = i / 40
        x = lerp(-L / 2, L / 2, f)
        w = 0.21 + 0.07 * math.sin(min(1.0, f / 0.75) * math.pi * 0.6) - 0.1 * smoothstep(0.85, 1.0, f)
        w *= 1.0 - 0.28 * smoothstep(0.15, 0.0, f)
        baffle = 1.0 + 0.06 * abs(math.sin(f * 40.0))
        path.append(Vector((x, 0.1, 0.0)))
        rad.append((w * baffle, 0.1 * baffle * (1.0 - 0.3 * smoothstep(0.9, 1.0, f))))
    mb.tube(path, rad, seg=18, mat="weave_red", up=(0, 1, 0))
    mb.tube([Vector((lerp(-L / 2 + 0.1, L / 2 - 0.25, f / 20), 0.1 + 0.075, 0.1)) for f in range(21)], (0.003, 0.003),
            seg=5, mat="plastic_black")
    ob = R.obj(mb, "sleeping_bag", smooth_angle=70)
    R.xform([ob], Matrix.Diagonal((1.0, 0.85, 1.0, 1.0)))
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "static"}


@R.prop("camp_stove")
def camp_stove():
    """Two-burner liquid-fuel camp stove (Coleman type): green case, open lid + wind flaps, grate, tank."""
    mb = MB()
    L, H, W = 0.56, 0.11, 0.3
    mb.box((L, H, W), (0, H / 2, 0), mat="paint_green")
    mb.box((L - 0.02, 0.006, W - 0.02), (0, H + 0.002, 0), mat="steel_dark")
    mb.box((L, 0.3, 0.012), (0, H + 0.15, -W / 2 - 0.004), mat="paint_green")                   # lid up
    for sx in (-1, 1):                                                                           # wind flaps
        mb.box((0.012, 0.16, W - 0.02), (sx * (L / 2 + 0.004), H + 0.08, 0), mat="paint_green")
    for bx in (-0.13, 0.13):                                                                      # burners
        mb.lathe([(0.0001, H), (0.06, H), (0.062, H + 0.018), (0.05, H + 0.022), (0.0001, H + 0.022)], seg=20,
                 mat="steel_black", m=R.T(bx, 0.0, 0.02))
    for k in range(7):                                                                            # grate
        z = -0.1 + k * 0.035
        mb.tube([Vector((-L / 2 + 0.03, H + 0.03, z)), Vector((L / 2 - 0.03, H + 0.03, z))], 0.0022, seg=5,
                mat="steel")
    mb.lathe([(0.0001, 0.0), (0.045, 0.0), (0.045, 0.2), (0.0001, 0.2)], seg=18, mat="paint_red",
             m=R.T(-L / 2 + 0.02, 0.055, W / 2 + 0.05) @ R.rot("Z", 90))                             # fuel tank
    mb.box((0.03, 0.05, 0.03), (-L / 2 + 0.03, 0.08, W / 2 + 0.005), mat="brass")
    ob = R.obj(mb, "camp_stove", bevel=0.0015, bevel_segments=1)
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 5.5}


@R.prop("lantern")
def lantern_prop():
    objs = TOOLS.build_lantern()
    R.rest_on_ground(objs)
    return {"objects": objs, "body": "rigid", "mass": 1.4,
            "collision": [{"type": "cylinder", "radius": 0.065, "height": 0.25, "pos": [0, 0.125, 0]}]}


@R.prop("radio_set")
def radio_set():
    """Field HF transceiver (station/ranger cabin): olive steel case, front panel with meter, dial, knobs,
    toggle switches, and a handset on a coiled cord."""
    mb = MB()
    L, H, D = 0.42, 0.2, 0.3
    f0 = len(mb.f)
    mb.box((L, H, D), (0, H / 2, 0), mat="paint_olive")
    mb.box((L - 0.01, H - 0.01, 0.006), (0, H / 2, D / 2 + 0.003), mat="paint_black")
    _noise_split(mb, f0, "steel_dark", freq=25.0, thresh=0.7, seed=3.0)
    mb.box((0.1, 0.06, 0.004), (-0.12, H * 0.66, D / 2 + 0.007), mat="glass")                   # meter window
    mb.box((0.096, 0.056, 0.002), (-0.12, H * 0.66, D / 2 + 0.0055), mat="paper")
    mb.box((0.14, 0.035, 0.004), (0.08, H * 0.7, D / 2 + 0.007), mat="plastic_amber")           # dial scale
    for (x, y, r) in ((-0.15, 0.05, 0.016), (-0.09, 0.05, 0.016), (0.02, 0.055, 0.024), (0.12, 0.05, 0.016),
                      (0.17, 0.05, 0.012)):
        mb.lathe([(0.0001, 0.0), (r, 0.0), (r, 0.018), (r * 0.8, 0.024), (0.0001, 0.024)], seg=16, mat="plastic_black",
                 m=R.T(x, y, D / 2 + 0.006) @ R.rot("X", 90))
    for x in (-0.035, -0.012):
        mb.tube([Vector((x, 0.12, D / 2 + 0.006)), Vector((x, 0.128, D / 2 + 0.024))], 0.0022, seg=6, mat="steel")
    for sx in (-1, 1):                                                                            # carry handles
        mb.tube([Vector((sx * (L / 2), 0.14, -0.08)), Vector((sx * (L / 2 + 0.025), 0.14, -0.06)),
                 Vector((sx * (L / 2 + 0.025), 0.14, 0.06)), Vector((sx * (L / 2), 0.14, 0.08))], 0.006, seg=6,
                mat="steel_dark")
    # handset lying beside the set + coiled cord
    hs = R.T(L / 2 + 0.12, 0.022, 0.05) @ R.rot("Y", 20)
    s0 = len(mb.v)
    mb.tube([Vector((-0.1, 0.0, 0)), Vector((-0.085, 0.012, 0)), Vector((0.085, 0.012, 0)), Vector((0.1, 0.0, 0))],
            (0.018, 0.022), seg=12, mat="plastic_black", up=(0, 1, 0))
    mb.xform(hs, s0)
    coil = [Vector((L / 2 + 0.03 + t * 0.05, 0.03 + 0.012 * math.sin(t * 60.0), 0.08 + 0.012 * math.cos(t * 60.0)))
            for t in [i / 120 for i in range(121)]]
    mb.tube(coil, 0.0022, seg=4, mat="plastic_black")
    ob = R.obj(mb, "radio_set", bevel=0.0015, bevel_segments=1)
    t = _text("KESTREL STN  HF-1", 0.012, R.T(0.08, H * 0.36, D / 2 + 0.0065), "paint_white", extrude=0.0003)
    R.rest_on_ground([ob, t])
    return {"objects": [ob, t], "body": "static"}


# ================================================================================================ mine

@R.prop("ore_cart")
def ore_cart():
    """Gold-rush era side-tipping ore car: riveted steel hopper on a timber frame, four flanged wheels."""
    mb = MB()
    f0 = len(mb.f)
    y0, y1 = 0.36, 0.86
    b0, b1 = (0.42, 0.26), (0.55, 0.36)
    sec = TOOLS._round_rect_section(6, 9.0)
    ys = [y0, y0 + 0.1, y1 - 0.1, y1]
    outer = [(lerp(b0[0], b1[0], (y - y0) / (y1 - y0)), lerp(b0[1], b1[1], (y - y0) / (y1 - y0))) for y in ys]
    mb.tube([Vector((0, y, 0)) for y in ys], outer, section=sec, mat="rust", up=(0, 0, 1), cap1=False)
    fi = len(mb.f)
    inner = [(rx - 0.012, rz - 0.012) for (rx, rz) in outer]
    mb.tube([Vector((0, y + (0.012 if i == 0 else 0.0), 0)) for i, y in enumerate(ys)], inner, section=sec, mat="rust",
            up=(0, 0, 1), cap1=False)
    for fc in mb.f[fi:]:                     # inner wall faces inward
        fc.idx = tuple(reversed(fc.idx))
        fc.uvt = tuple(reversed(fc.uvt))
        fc.uva = tuple(reversed(fc.uva))
    # top rim
    for sz in (-1, 1):
        mb.box((b1[0] * 2 + 0.02, 0.025, 0.025), (0, y1, sz * b1[1]), mat="rust")
    for sx in (-1, 1):
        mb.box((0.025, 0.025, b1[1] * 2 + 0.02), (sx * b1[0], y1, 0), mat="rust")
    # rivet rows (little studs) along the rim
    for i in range(12):
        x = lerp(-0.5, 0.5, i / 11)
        for sz in (-1, 1):
            mb.box((0.009, 0.009, 0.006), (x, y1 - 0.04, sz * (b1[1] + 0.002)), mat="rust")
    # timber frame + axles + wheels (track gauge 0.61 m)
    for sz in (-1, 1):
        mb.box((1.1, 0.1, 0.1), (0, 0.3, sz * 0.2), mat="wood_weathered")
    for ax in (-0.33, 0.33):
        mb.tube([Vector((ax, 0.17, -0.36)), Vector((ax, 0.17, 0.36))], 0.025, seg=10, mat="steel_dark")
        for sz in (-1, 1):
            w = MB()
            w.lathe([(0.03, -0.035), (0.17, -0.035), (0.17, 0.0), (0.155, 0.0), (0.155, 0.035), (0.03, 0.035)],
                    seg=24, mat="steel_dark")
            w.lathe([(0.0001, -0.02), (0.05, -0.02), (0.05, 0.02), (0.0001, 0.02)], seg=12, mat="steel_dark")
            w.xform(R.T(ax, 0.17, sz * 0.305) @ R.rot("X", 90 if sz > 0 else -90))
            mb.merge(w)
    _noise_split(mb, f0, "steel_dark", freq=3.0, thresh=0.35, seed=6.0)
    ob = R.obj(mb, "ore_cart", bevel=0.002, bevel_segments=1)
    R.rest_on_ground([ob], center_xz=True)
    return {"objects": [ob], "collision": [_box_col((1.14, 0.9, 0.76), (0, 0.45, 0))], "body": "static"}


@R.prop("mine_rails")
def mine_rails():
    """A 3 m section of narrow-gauge (610 mm) mine track: two rusted T-rails spiked to rough timber ties."""
    mb = MB()
    Lz = 3.0
    rail = [(-0.03, 0.0), (0.03, 0.0), (0.03, 0.008), (0.006, 0.014), (0.006, 0.05), (0.018, 0.056), (0.018, 0.07),
            (-0.018, 0.07), (-0.018, 0.056), (-0.006, 0.05), (-0.006, 0.014), (-0.03, 0.008)]
    for sx in (-1, 1):
        mb.prism(rail, Lz, mat="rust", m=R.T(sx * 0.305, 0.12, 0), smooth_sides=False)
    for k in range(6):
        z = -Lz / 2 + 0.25 + k * 0.5
        yaw = 3.0 * math.sin(k * 2.7)
        tie = MB()
        tie.box((1.1, 0.12, 0.16), (0, 0.06, 0), mat="wood_dark")
        tie.xform(R.T(0.02 * math.sin(k * 5.1), 0, z) @ R.rot("Y", yaw))
        mb.merge(tie)
        for sx in (-1, 1):
            for dx in (-0.04, 0.04):
                mb.box((0.014, 0.02, 0.014), (sx * 0.305 + dx, 0.13, z), mat="rust")
    ob = R.obj(mb, "mine_rails", smooth_angle=30)
    R.rest_on_ground([ob])
    return {"objects": [ob], "collision": [_box_col((1.1, 0.19, Lz), (0, 0.095, 0))], "body": "static"}


def _leaning(objs, lean_deg, name):
    """Stand a tool (handle +Y, head at the bottom) leaning back toward -Z by lean_deg; origin at the foot."""
    R.xform(objs, R.rot("X", -lean_deg))
    R.rest_on_ground(objs)
    lo, hi = C.gd_bounds(objs)
    return {"objects": objs, "collision": [_box_col(hi - lo, (lo + hi) * 0.5)], "body": "static"}


@R.prop("pickaxe_leaning")
def pickaxe_leaning():
    mb = MB()
    TOOLS._handle(mb, 0.9, 0.019, 0.014, 0.008, "wood_weathered", top_flare=True)
    # pick head: a curved bar, point one side, chisel the other (fp convention: across -Z/+Z at the top)
    head = []
    for i in range(15):
        t = lerp(-1.0, 1.0, i / 14)
        head.append(Vector((0.0, 0.88 - 0.05 * t * t, t * 0.3)))
    mb.tube(head, [(0.014 * (1.0 - 0.8 * abs(t) ** 3) + 0.003, 0.02 * (1.0 - 0.75 * abs(t) ** 3) + 0.003)
                   for t in [lerp(-1.0, 1.0, i / 14) for i in range(15)]], seg=10, mat="rust", up=(1, 0, 0))
    mb.box((0.04, 0.06, 0.05), (0, 0.885, 0), mat="rust")
    ob = R.obj(mb, "pickaxe", bevel=0.001)
    R.xform([ob], R.rot("X", 180))                              # head down on the ground, handle up
    return _leaning([ob], 18.0, "pickaxe_leaning")


@R.prop("shovel_leaning")
def shovel_leaning():
    mb = MB()
    mb.tube([Vector((0, 0.3 + f * 0.8 / 10, 0)) for f in range(11)], 0.017, seg=12, mat="wood_weathered",
            up=(0, 0, -1))
    # D-grip
    mb.tube([Vector((0, 1.1, 0)), Vector((-0.06, 1.16, 0)), Vector((-0.06, 1.24, 0)), Vector((0.06, 1.24, 0)),
             Vector((0.06, 1.16, 0)), Vector((0, 1.1, 0))], 0.011, seg=8, mat="wood_weathered")
    # blade: a dished round-point spade (grid shaped + solidified)
    def blade(u, v, p):
        w = 0.12 * (1.0 - 0.75 * smoothstep(0.55, 1.0, u) ** 1.4) + 0.001
        x = (v - 0.5) * 2.0 * w
        y = 0.32 - u * 0.3
        z = -0.025 * (1.0 - ((v - 0.5) * 2.0) ** 2)
        return Vector((x, y, z))
    mb.grid(1.0, 1.0, 12, 8, mat="rust", fn=blade, two_sided=True, thickness=0.002)
    mb.lathe([(0.02, 0.26), (0.024, 0.3), (0.019, 0.36), (0.018, 0.4)], seg=12, mat="rust")   # socket
    ob = R.obj(mb, "shovel", smooth_angle=45)
    return _leaning([ob], 18.0, "shovel_leaning")


# ================================================================================================ trail & winter gear

@R.prop("snowshoes")
def snowshoes():
    """A pair of traditional ash-frame snowshoes with rawhide lacing, lying side by side."""
    objs = []
    for (ox, yaw) in ((-0.16, -4.0), (0.17, 6.0)):
        mb = MB()
        L, Wd = 1.0, 0.27
        frame = []
        for i in range(48):
            a = i / 48 * math.tau
            x = math.sin(a) * Wd / 2 * (1.0 - 0.55 * max(0.0, -math.cos(a)) ** 1.5)
            z = -math.cos(a) * L / 2
            frame.append(Vector((x, 0.0 + 0.04 * smoothstep(0.25, 0.5, -z / L) ** 2 * (1 if -z > 0 else 0), z)))
        mb.tube(frame, (0.009, 0.012), seg=8, mat="wood_handle", closed=True, up=(0, 1, 0))
        for zc in (-0.18, 0.2):
            half = Wd / 2 * (1.0 - 0.3 * abs(zc) / 0.5)
            mb.tube([Vector((-half, 0.0, zc)), Vector((half, 0.0, zc))], (0.008, 0.01), seg=6, mat="wood_handle",
                    up=(0, 1, 0))
        # lacing: a coarse grid of rawhide strips in the centre, finer mesh at toe/heel
        for k in range(9):
            x = lerp(-0.11, 0.11, k / 8)
            mb.tube([Vector((x, 0.002, -0.17)), Vector((x, 0.002, 0.19))], (0.0022, 0.001), seg=4, mat="sinew",
                    up=(0, 1, 0))
        for k in range(10):
            z = lerp(-0.16, 0.18, k / 9)
            mb.tube([Vector((-0.125, 0.003, z)), Vector((0.125, 0.003, z))], (0.0022, 0.001), seg=4, mat="sinew",
                    up=(0, 1, 0))
        # binding
        mb.box((0.1, 0.012, 0.12), (0, 0.012, -0.02), mat="leather_dark")
        ob = R.obj(mb, "snowshoe", smooth_angle=50)
        R.xform([ob], R.T(ox, 0, 0) @ R.rot("Y", yaw))
        objs.append(ob)
    R.rest_on_ground(objs)
    return {"objects": objs, "body": "rigid", "mass": 2.4}


@R.prop("trail_sign")
def trail_sign():
    """Routed park trail sign: stained post, board with cream lettering and an arrow."""
    mb = MB()
    mb.box((0.1, 1.55, 0.1), (0, 0.775, 0), mat="wood_dark")
    mb.lathe([(0.0001, 1.55), (0.072, 1.55), (0.0001, 1.6)], seg=4, mat="wood_dark", m=R.rot("Y", 45))
    mb.box((0.62, 0.2, 0.035), (0.2, 1.3, 0.068), mat="wood_dark")
    mb.prism([(0.51, 1.2), (0.6, 1.3), (0.51, 1.4)], 0.035, mat="wood_dark", m=R.T(0, 0, 0.068))
    mb.box((0.62, 0.16, 0.035), (-0.1, 0.98, 0.068), mat="wood_dark")
    ob = R.obj(mb, "trail_sign", bevel=0.003, bevel_segments=1)
    t1 = _text("LOON LAKE", 0.075, R.T(0.17, 1.33, 0.0862), "paint_yellow", extrude=0.0006)
    t2 = _text("2.4 km", 0.05, R.T(0.17, 1.255, 0.0862), "paint_yellow", extrude=0.0006)
    t3 = _text("< ASHFORD MINE 6 km", 0.042, R.T(-0.1, 0.98, 0.0862), "paint_yellow", extrude=0.0006)
    objs = [ob, t1, t2, t3]
    R.rest_on_ground(objs, center_xz=False)
    return {"objects": objs, "collision": [_box_col((0.12, 1.6, 0.12), (0, 0.8, 0))], "body": "static"}


@R.prop("rope_coil")
def rope_coil():
    """A coiled climbing rope, loosely hanked on the ground."""
    mb = MB()
    pts = []
    turns = 9
    for i in range(turns * 24 + 1):
        t = i / 24 * math.tau
        r = 0.17 + 0.012 * math.sin(t * 0.37) + 0.006 * (i % 24 == 0)
        y = 0.012 + 0.011 * (i / 24) + 0.004 * math.sin(t * 1.7)
        pts.append(Vector((math.cos(t) * r, y, math.sin(t) * r * 0.92)))
    mb.tube(pts, 0.0052, seg=6, mat="rope_red")
    tail = [pts[-1], Vector((0.25, 0.01, 0.1)), Vector((0.35, 0.006, 0.25))]
    mb.tube(tail, 0.0052, seg=6, mat="rope_red")
    ob = R.obj(mb, "rope_coil", smooth_angle=60)
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 3.5}


@R.prop("antlers")
def antlers():
    """A shed mule-deer antler (forked tines), bleached, lying in the grass."""
    mb = MB()

    def branch(a, b, r0, r1, bend):
        pts = []
        for i in range(9):
            t = i / 8
            p = a.lerp(b, t) + Vector((0, math.sin(t * math.pi) * bend, 0))
            pts.append(p)
        mb.tube(pts, [lerp(r0, r1, i / 8) for i in range(9)], seg=8, mat="bone")
    base = Vector((0, 0.02, 0))
    beam_end = Vector((0.32, 0.1, 0.12))
    branch(base, beam_end, 0.022, 0.012, 0.05)
    fork = base.lerp(beam_end, 0.55) + Vector((0, 0.03, 0))
    branch(fork, fork + Vector((0.12, 0.2, -0.05)), 0.013, 0.004, 0.02)
    branch(beam_end, beam_end + Vector((0.12, 0.08, 0.1)), 0.012, 0.004, 0.02)
    branch(beam_end, beam_end + Vector((0.05, 0.16, -0.06)), 0.011, 0.004, 0.02)
    branch(base + Vector((0.05, 0.01, 0.0)), base + Vector((0.12, 0.1, -0.1)), 0.012, 0.004, 0.01)
    mb.blob((0, 0.02, 0), (0.03, 0.02, 0.03), subdiv=2, mat="bone", amp=0.2, seed=7)                  # burr
    ob = R.obj(mb, "antlers", smooth_angle=60)
    R.xform([ob], R.rot("Z", 70))
    R.rest_on_ground([ob])
    return {"objects": [ob], "body": "rigid", "mass": 0.8}

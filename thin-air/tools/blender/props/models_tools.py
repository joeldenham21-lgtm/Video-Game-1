"""THIN AIR — hero models of the held tools.

Each builder authors the tool once in its FIRST-PERSON frame, the frame src/player/fp/fp_models.gd and the tool
scripts (src/player/tools/*.gd) use: handle along +Y from the butt (y = 0), business end toward -Z, flat faces
+-X; knives/spears lie along Z (tip -Z). Dimensions match the procedural models so every hand grip point,
flame socket and screen quad stays where the scripts expect it. The same geometry, laid flat (registry.lay_item),
is the world/pickup/icon model assets/models/items/<id>.glb.
"""
import math

from mathutils import Matrix, Vector

from lib import registry as R
from lib.geo import MB, smoothstep, lerp

# plate space (x = blade direction, y = up, z = thickness) -> fp space (blade -Z, up +Y, thickness +X)
PLATE_TO_FP = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))


def _plate(y=0.0, z=0.0):
    return R.T(0.0, y, z) @ PLATE_TO_FP


def _split_mat(mb, f0, test, mat):
    """Re-assigns the material of faces (from index f0) whose centroid passes test(centroid)."""
    for fc in mb.f[f0:]:
        c = Vector((0, 0, 0))
        for i in fc.idx:
            c += mb.v[i]
        c /= len(fc.idx)
        if test(c):
            fc.mat = mat


def _handle(mb, length, depth, width, curve, mat, knob=True, top_flare=True):
    """Axe/hammer handle along +Y: oval (deeper toward the blade, -Z), S-curve, fawn-foot knob, slim throat."""
    path, rad = [], []
    n = 22
    for i in range(n + 1):
        f = i / n
        y = f * length
        z = math.sin(f * math.pi) * curve - ((0.0065 * (1.0 - smoothstep(0.0, 0.07, f))) if knob else 0.0)
        swell = (1.0 - smoothstep(0.0, 0.07, f)) * 0.26 if knob else 0.0
        neck = 1.0 - 0.14 * smoothstep(0.5, 0.82, f)
        if top_flare:
            neck += 0.12 * smoothstep(0.86, 0.95, f)
        grip = 1.0 + 0.05 * math.sin(min(1.0, f / 0.35) * math.pi)
        path.append(Vector((0.0, y, z)))
        rad.append((width * (1.0 + swell * 0.55) * neck * grip, depth * (1.0 + swell) * neck * grip))
    mb.tube(path, rad, seg=16, mat=mat, up=(0, 0, -1))
    return path


# ============================================================================================ axes

def _axe_head(mb, y, poll, bit, top_fn, bot_fn, thick_fn, body="steel_dark", edge="steel", hone_u=0.86, nu=26):
    f0 = len(mb.f)

    def shape(u, v):
        x = lerp(poll, bit, u)
        top = top_fn(u)
        bot = bot_fn(u)
        yy = lerp(bot, top, v)
        bow = 1.0 - (2.0 * v - 1.0) ** 2
        x += 0.008 * bow * smoothstep(0.84, 1.0, u)
        return (x, yy)

    def thick(u, v):
        rnd = 1.0 - 0.28 * abs(2.0 * v - 1.0) ** 6
        hone = 1.0 - 0.7 * smoothstep(hone_u, 1.0, u)
        return thick_fn(u) * hone * rnd

    mb.slab(shape, thick, nu, 8, mat=body, m=_plate(y))
    lim = lerp(poll, bit, hone_u)
    _split_mat(mb, f0, lambda c: -c.z > lim, edge)


def build_axe(kind):
    mb = MB()
    if kind == "hatchet":
        L, head_y = 0.40, 0.37
        _handle(mb, L, 0.0165, 0.0115, 0.01, "wood_handle")
        _axe_head(mb, head_y, -0.036, 0.104,
                  lambda u: 0.021 + 0.012 * smoothstep(0.4, 1.0, u),
                  lambda u: -0.021 + 0.004 * smoothstep(0.2, 0.45, u) - 0.043 * smoothstep(0.42, 1.0, u) ** 1.6,
                  lambda u: 0.027 * (1.0 - smoothstep(0.3, 0.95, u)) + 0.0022 + 0.004 * (1.0 - smoothstep(0.0, 0.12, u)))
    else:   # felling axe: a long double-tapered Hudson Bay-ish head on a 31" haft
        L, head_y = 0.78, 0.75
        _handle(mb, L, 0.019, 0.0135, 0.012, "wood_handle")
        _axe_head(mb, head_y, -0.05, 0.135,
                  lambda u: 0.026 + 0.028 * smoothstep(0.3, 1.0, u) ** 1.3,
                  lambda u: -0.026 - 0.028 * smoothstep(0.3, 1.0, u) ** 1.3,
                  lambda u: 0.031 * (1.0 - smoothstep(0.25, 0.95, u)) + 0.0024 + 0.005 * (1.0 - smoothstep(0.0, 0.12, u)))
    # hardwood wedge showing on top of the eye
    mb.box((0.004, 0.006, 0.026 if kind == "hatchet" else 0.03), (0.0, L - 0.002, 0.0), mat="wood_dark")
    return [R.obj(mb, kind, bevel=0.0007, bevel_segments=2)]


def build_stone_axe():
    mb = MB()
    L = 0.5
    # a crooked, bark-stripped branch handle
    path, rad = [], []
    for i in range(17):
        f = i / 16
        path.append(Vector((math.sin(f * 7.0) * 0.004, f * L, math.sin(f * 4.0 + 1.0) * 0.006)))
        r = 0.0152 - f * 0.002 + 0.0012 * math.exp(-((f - 0.3) / 0.05) ** 2)
        rad.append((r, r * 1.06))
    mb.tube(path, rad, seg=12, mat="wood_weathered", up=(0, 0, -1))
    hy = L - 0.07
    # ground-stone celt through the split haft
    f0 = len(mb.f)

    def shape(u, v):
        x = lerp(-0.03, 0.088, u)
        h = 0.025 + 0.012 * math.sin(u * math.pi) + 0.0025 * math.sin(u * 17.0 + v * 5.0)
        bow = 1.0 - (2.0 * v - 1.0) ** 2
        return (x + 0.012 * bow * smoothstep(0.7, 1.0, u), lerp(-h, h, v))

    def thick(u, v):
        t = 0.036 * (1.0 - smoothstep(0.3, 1.0, u)) + 0.0035
        return t * (1.0 - 0.4 * abs(2.0 * v - 1.0) ** 2.5) * (1.0 + 0.08 * math.sin(u * 29.0 + v * 13.0))

    mb.slab(shape, thick, 18, 8, mat="granite_dark", m=_plate(hy))
    # rawhide lashing: crossed wraps binding the celt into the split
    for k in range(6):
        yy = hy - 0.036 + k * 0.0135
        tilt = 0.3 if k % 2 == 0 else -0.3
        ring = []
        for i in range(20):
            a = i / 20 * math.tau
            ring.append(Vector((math.cos(a) * 0.0195, yy + math.sin(a) * tilt * 0.022, math.sin(a) * 0.0215)))
        mb.tube(ring, 0.0028, seg=6, mat="sinew", closed=True)
    return [R.obj(mb, "stone_axe", bevel=0.0006)]


# ============================================================================================ knives

def build_knife(stone=False):
    mb = MB()
    blade = 0.09 if stone else 0.105
    f0 = len(mb.f)

    def shape(u, v):
        x = u * blade
        if stone:
            spine = 0.012 * (1.0 - u ** 2.2) + 0.0012 * math.sin(u * 25.0)
            edge = -0.012 * (1.0 - u ** 1.6) + 0.0014 * math.sin(u * 31.0)
        else:
            spine = 0.0105 - 0.0105 * smoothstep(0.6, 1.0, u) ** 1.35
            edge = -0.0115 + 0.011 * smoothstep(0.42, 1.0, u) ** 2.1
            edge += 0.0018 * (1.0 - smoothstep(0.0, 0.06, u))      # choil
        return (x, lerp(edge, spine, v))

    def thick(u, v):
        if stone:
            return (0.0075 * (1.0 - abs(2.0 * v - 1.0)) ** 0.8 + 0.0008) * (1.0 - 0.5 * u ** 3)
        grind = smoothstep(0.0, 0.42, v)                          # scandi grind: flat to the edge bevel
        return (0.0006 + 0.0026 * grind) * (1.0 - 0.55 * u ** 5)

    mb.slab(shape, thick, 22, 8, mat="chert" if stone else "steel", m=PLATE_TO_FP)
    if not stone:
        # brass guard
        mb.box((0.0135, 0.029, 0.0055), (0.0, -0.0025, 0.0028), mat="brass")
    # handle along +Z
    path, rad = [], []
    for i in range(15):
        f = i / 14
        z = 0.006 + f * 0.108
        sw = math.sin(f * math.pi) * 0.0024
        pom = smoothstep(0.84, 1.0, f) * 0.0014
        path.append(Vector((0.0, -0.001 - math.sin(f * math.pi) * 0.0014, z)))
        rad.append((0.0084 + sw * 0.6 + pom, 0.0114 + sw + pom))
    hm = "sinew" if stone else "wood_dark"
    mb.tube(path, rad, seg=16, mat=hm, up=(0, 1, 0))
    if stone:
        # the flake is set into a split stick and wrapped with sinew
        for k in range(9):
            zz = 0.012 + k * 0.0065
            ring = [Vector((math.cos(i / 16 * math.tau) * 0.0094, math.sin(i / 16 * math.tau) * 0.0124 - 0.001,
                            zz + math.sin(i / 16 * math.tau) * 0.002)) for i in range(16)]
            mb.tube(ring, 0.0016, seg=5, mat="sinew", closed=True)
    else:
        for zz in (0.036, 0.086):                  # brass rivets through the scales
            mb.tube([Vector((-0.0094, -0.0012, zz)), Vector((0.0094, -0.0012, zz))], 0.0022, seg=10, mat="brass")
    return [R.obj(mb, "stone_knife" if stone else "knife", bevel=0.0003, bevel_segments=1)]


# ============================================================================================ spear

def build_spear():
    mb = MB()
    fwd, back = 1.15, 0.75
    path, rad = [], []
    for i in range(25):
        f = i / 24
        path.append(Vector((math.sin(f * 9.0) * 0.002, math.sin(f * 5.0) * 0.002, lerp(back, -fwd, f))))
        r = 0.0142 - f * 0.0022
        rad.append((r, r))
    mb.tube(path, rad, seg=12, mat="wood_pale", up=(0, 1, 0))

    def shape(u, v):
        w = 0.022 * math.sin(u ** 0.7 * math.pi) * (1.0 - 0.3 * u) + 0.0012 * math.sin(u * 30.0 + v * 7.0)
        return (u * 0.15, lerp(-w, w, v))

    def thick(u, v):
        return 0.0068 * (1.0 - abs(2.0 * v - 1.0)) * math.sin(u ** 0.6 * math.pi * 0.95) + 0.0007

    mb.slab(shape, thick, 16, 8, mat="chert", m=R.T(0, 0, -fwd + 0.045) @ PLATE_TO_FP @ R.rot("X", 90))
    for k in range(7):
        zz = -fwd + 0.036 + k * 0.0105
        ring = [Vector((math.cos(i / 14 * math.tau) * 0.0145, math.sin(i / 14 * math.tau) * 0.0145,
                        zz + math.sin(i / 14 * math.tau) * 0.004)) for i in range(14)]
        mb.tube(ring, 0.0024, seg=5, mat="sinew", closed=True)
    return [R.obj(mb, "spear", bevel=0.0004, bevel_segments=1)]


# ============================================================================================ torch, flare, lantern

def build_torch():
    mb = MB()
    path, rad = [], []
    for i in range(15):
        f = i / 14
        path.append(Vector((math.sin(f * 6.0) * 0.003, f * 0.5, math.cos(f * 5.0) * 0.003)))
        r = 0.0168 - f * 0.0022
        rad.append((r, r))
    mb.tube(path, rad, seg=12, mat="wood_weathered", up=(0, 0, -1))
    # resin-soaked cloth strips wound around the head (y 0.40 .. 0.56)
    s0 = len(mb.v)
    prof = [(0.0001, 0.388), (0.02, 0.392), (0.028, 0.405), (0.032, 0.43), (0.034, 0.47), (0.033, 0.51),
            (0.03, 0.54), (0.022, 0.558), (0.0001, 0.565)]
    f0 = len(mb.f)
    mb.lathe(prof, seg=18, mat="cloth_pitch")

    def lump(p):
        a = math.atan2(p.z, p.x)
        wrap = 0.0022 * math.sin(p.y * 260.0 + a * 1.0)            # the strip edges spiral round
        n = 0.0016 * math.sin(a * 5.0 + p.y * 90.0) * math.cos(a * 3.0 - p.y * 60.0)
        rr = math.hypot(p.x, p.z)
        if rr < 1e-4:
            return p
        k = (rr + wrap + n) / rr
        return Vector((p.x * k, p.y, p.z * k))
    mb.deform(lump, s0)
    _split_mat(mb, f0, lambda c: c.y > 0.535, "charred")
    # two wire ties
    for yy in (0.405, 0.535):
        ring = [Vector((math.cos(i / 18 * math.tau) * (0.029 if yy < 0.5 else 0.027), yy,
                        math.sin(i / 18 * math.tau) * (0.029 if yy < 0.5 else 0.027))) for i in range(18)]
        mb.tube(ring, 0.0014, seg=5, mat="steel_dark", closed=True)
    return [R.obj(mb, "torch")]


def build_flare():
    mb = MB()
    mb.lathe([(0.0001, 0.0), (0.0135, 0.0), (0.0135, 0.235), (0.0122, 0.2395), (0.0001, 0.2395)], seg=20,
             mat="flare_paper")
    # printed safety band + black end plug (ribbed) + striker cap stuck on the base
    mb.lathe([(0.01375, 0.12), (0.01375, 0.16)], seg=20, mat="paint_white")
    mb.lathe([(0.0001, -0.016), (0.0142, -0.016), (0.0149, -0.012)] +
             [(0.0149 if k % 2 == 0 else 0.0144, -0.008 + k * 0.004) for k in range(9)] +
             [(0.0149, 0.03), (0.0137, 0.032)], seg=20, mat="plastic_black")
    mb.disc(0.0126, 0.2396, seg=20, mat="striker")
    return [R.obj(mb, "flare", bevel=0.0003, bevel_segments=1)]


def build_lantern():
    """Hurricane lantern (Dietz-style): fount, globe, guard wires, the two air tubes, top cap and bail."""
    mb = MB()
    mb.lathe([(0.0001, 0.0), (0.05, 0.0), (0.054, 0.006), (0.056, 0.028), (0.052, 0.04), (0.044, 0.048),
              (0.03, 0.05), (0.0001, 0.05)], seg=28, mat="paint_red")
    mb.lathe([(0.0001, 0.049), (0.018, 0.049), (0.02, 0.058), (0.012, 0.064), (0.0001, 0.064)], seg=16, mat="brass")
    mb.tube([Vector((0.02, 0.056, 0.0)), Vector((0.034, 0.056, 0.0))], 0.0022, seg=8, mat="brass")   # wick key
    mb.disc(0.0026, 0.056, seg=8, mat="brass", m=R.T(0.034, 0.0, 0.0) @ R.rot("Z", 90) @ R.T(0, -0.056, 0))
    mb.lathe([(0.03, 0.052), (0.038, 0.07), (0.042, 0.11), (0.037, 0.155), (0.029, 0.17)], seg=24, mat="glass")
    for k in range(4):                                             # guard wires
        a = k / 4 * math.tau + math.pi / 4
        c, s = math.cos(a), math.sin(a)
        mb.tube([Vector((c * 0.044, 0.048, s * 0.044)), Vector((c * 0.047, 0.11, s * 0.047)),
                 Vector((c * 0.042, 0.168, s * 0.042))], 0.0022, seg=6, mat="steel_dark")
    for yy, rr in ((0.075, 0.041), (0.145, 0.04)):
        mb.tube([Vector((math.cos(i / 20 * math.tau) * rr, yy, math.sin(i / 20 * math.tau) * rr))
                 for i in range(20)], 0.0018, seg=5, mat="steel_dark", closed=True)
    mb.lathe([(0.0001, 0.166), (0.045, 0.166), (0.046, 0.175), (0.036, 0.19), (0.018, 0.2), (0.014, 0.212),
              (0.0001, 0.212)], seg=24, mat="paint_red")
    for sx in (-1, 1):                                             # side air tubes (the "hurricane")
        mb.tube([Vector((sx * 0.05, 0.03, 0.0)), Vector((sx * 0.06, 0.05, 0.0)), Vector((sx * 0.062, 0.15, 0.0)),
                 Vector((sx * 0.05, 0.176, 0.0)), Vector((sx * 0.03, 0.188, 0.0))], 0.0055, seg=10, mat="paint_red")
    bail = [Vector((math.cos(a) * 0.064, 0.19 + math.sin(a) * 0.06, 0.0))
            for a in [i / 16 * math.pi for i in range(17)]]
    mb.tube(bail, 0.0019, seg=6, mat="galvanized")
    return [R.obj(mb, "lantern", bevel=0.0004, bevel_segments=1)]


# ============================================================================================ ice axe

def build_ice_axe():
    mb = MB()
    L = 0.56
    mb.tube([Vector((0, 0.03 + f * (L - 0.03) / 10, 0)) for f in range(11)], [(0.0105, 0.0145)] * 11, seg=16,
            mat="anodized_blue", up=(0, 0, -1))
    grip = [Vector((0, 0.035 + f * 0.013, 0)) for f in range(11)]
    mb.tube(grip, [(0.0118 + math.sin(f / 10 * math.pi) * 0.0008, 0.0158 + math.sin(f / 10 * math.pi) * 0.0008)
                   for f in range(11)], seg=16, mat="rubber", up=(0, 0, -1))
    # ferrule + spike
    mb.tube([Vector((0, 0.04, 0)), Vector((0, 0.012, 0)), Vector((0, -0.012, 0)), Vector((0, -0.036, 0))],
            [(0.0112, 0.0152), (0.0098, 0.0125), (0.0055, 0.0065), (0.0009, 0.0009)], seg=14, mat="steel",
            up=(0, 0, -1))
    hy = L - 0.012
    # head block + carabiner hole collar
    mb.box((0.019, 0.042, 0.032), (0.0, hy + 0.002, 0.0), mat="steel")

    def pick_shape(u, v):
        x = u * 0.15
        droop = -0.034 * u ** 1.6
        h = 0.012 * (1.0 - u) + 0.0035
        yy = lerp(-h, h * 0.6, v) + droop
        if v < 0.2 and u > 0.45:                                    # teeth on the underside of the outer half
            yy -= 0.0024 * max(0.0, math.sin(u * 150.0))
        return (x + 0.012, yy)

    mb.slab(pick_shape, lambda u, v: 0.0062 * (1.0 - 0.55 * u) + 0.0006, 22, 5, mat="steel", m=_plate(hy + 0.01))

    def adze_shape(u, v):
        x = 0.012 + u * 0.07
        w = 0.013 + 0.012 * u
        return (x, lerp(-w, w, v))

    mb.slab(adze_shape, lambda u, v: 0.0055 * (1.0 - 0.7 * u) + 0.0006, 12, 5, mat="steel",
            m=R.T(0, hy + 0.012, 0) @ R.rot("X", -8) @ Matrix(((0, 1, 0, 0), (0, 0, 1, 0), (1, 0, 0, 0), (0, 0, 0, 1))))
    # leash ring at the head
    mb.tube([Vector((0.0, hy - 0.012 + math.sin(i / 16 * math.tau) * 0.009, math.cos(i / 16 * math.tau) * 0.009 + 0.021))
             for i in range(16)], 0.0017, seg=6, mat="steel_dark", closed=True)
    return [R.obj(mb, "ice_axe", bevel=0.0005, bevel_segments=1)]


# ============================================================================================ devices

def _round_rect_section(n=6, ex=4.0):
    out = []
    for j in range(n * 4):
        a = math.tau * j / (n * 4)
        c, s = math.cos(a), math.sin(a)
        out.append((math.copysign(abs(c) ** (2.0 / ex), c), math.copysign(abs(s) ** (2.0 / ex), s)))
    return out


def build_scanner(with_screen=True):
    """Rugged handheld survey scanner: yellow shell, black rubber bumpers, recessed screen (the script lays its
    live screen quad over it at (0, 0.098, 0.0196)), keypad, stub antenna and a sensor window on the back."""
    mb = MB()
    sec = _round_rect_section(6, 5.0)
    body = [Vector((0, 0.0, 0)), Vector((0, 0.004, 0)), Vector((0, 0.02, 0)), Vector((0, 0.15, 0)),
            Vector((0, 0.164, -0.002)), Vector((0, 0.168, -0.003))]
    rad = [(0.038, 0.014), (0.043, 0.0165), (0.046, 0.019), (0.046, 0.019), (0.044, 0.0195), (0.041, 0.018)]
    mb.tube(body, rad, section=sec, mat="plastic_yellow", up=(0, 0, 1))
    for (y0, y1) in ((0.006, 0.056), (0.134, 0.161)):
        mb.tube([Vector((0, y0, 0)), Vector((0, y0 + 0.004, 0)), Vector((0, y1 - 0.004, 0)), Vector((0, y1, 0))],
                [(0.046, 0.0192), (0.0488, 0.0208), (0.0488, 0.0208), (0.046, 0.0192)], section=sec, mat="rubber",
                up=(0, 0, 1))
    # screen: bezel + display (0..1 UVs for the printed screen texture)
    # (kept behind z = 0.0196, where the fp script lays its live screen quad)
    mb.box((0.084, 0.1, 0.001), (0.0, 0.098, 0.0188), mat="plastic_black")
    if with_screen:
        mb.grid(0.074, 0.088, 1, 1, mat="print_screen", uv01=True,
                m=R.T(0.0, 0.098, 0.01945) @ R.rot("X", 90))
    # keypad on the grip band
    for i, x in enumerate((-0.022, 0.0, 0.022)):
        mb.lathe([(0.0001, 0.0), (0.0062, 0.0), (0.0058, 0.0022), (0.0001, 0.0025)], seg=12,
                 mat="plastic_grey" if i != 1 else "plastic_orange", m=R.T(x, 0.031, 0.0205) @ R.rot("X", 90))
    # antenna + sensor window
    mb.tube([Vector((0.03, 0.158, -0.004)), Vector((0.03, 0.19, -0.004)), Vector((0.03, 0.215, -0.004))],
            [0.0058, 0.0046, 0.0038], seg=10, mat="rubber", cap1=True)
    mb.lathe([(0.0001, 0.0), (0.014, 0.0), (0.0145, 0.004), (0.0001, 0.004)], seg=20, mat="plastic_black",
             m=R.T(-0.012, 0.13, -0.0188) @ R.rot("X", -90))
    mb.disc(0.0105, 0.0042, seg=20, mat="lens", m=R.T(-0.012, 0.13, -0.0188) @ R.rot("X", -90))
    return [R.obj(mb, "survey_scanner", bevel=0.0006, bevel_segments=2)]


def build_canteen(fp_offset=0.0):
    """Aluminium bush canteen in an olive wool cover (snap flap), screw cap on a keeper chain."""
    mb = MB()
    sec = _round_rect_section(6, 2.3)
    oy = fp_offset
    body = [Vector((0, oy + 0.0, 0)), Vector((0, oy + 0.02, 0)), Vector((0, oy + 0.14, 0)), Vector((0, oy + 0.168, 0)),
            Vector((0, oy + 0.18, 0)), Vector((0, oy + 0.186, 0))]
    mb.tube(body, [(0.062, 0.03), (0.07, 0.036), (0.07, 0.036), (0.052, 0.028), (0.022, 0.017), (0.016, 0.015)],
            section=sec, mat="aluminium", up=(0, 0, 1))
    cov = [Vector((0, oy - 0.004, 0)), Vector((0, oy + 0.018, 0)), Vector((0, oy + 0.13, 0)), Vector((0, oy + 0.146, 0))]
    mb.tube(cov, [(0.063, 0.032), (0.0735, 0.039), (0.0735, 0.039), (0.069, 0.036)], section=sec, mat="weave_olive",
            up=(0, 0, 1))
    # belt-loop panel on the back and the snap tab
    mb.box((0.05, 0.1, 0.004), (0.0, oy + 0.085, -0.041), mat="weave_olive")
    mb.box((0.022, 0.03, 0.003), (0.0, oy + 0.14, -0.043), mat="weave_olive")
    mb.lathe([(0.0001, 0.0), (0.0045, 0.0), (0.0045, 0.002), (0.0001, 0.0025)], seg=10, mat="brass",
             m=R.T(0.0, oy + 0.135, -0.0445) @ R.rot("X", -90))
    # neck thread + cap
    mb.lathe([(0.0001, oy + 0.184), (0.0175, oy + 0.184), (0.0185, oy + 0.188)] +
             [(0.0185 if k % 2 == 0 else 0.0178, oy + 0.19 + k * 0.0022) for k in range(9)] +
             [(0.0175, oy + 0.211), (0.012, oy + 0.214), (0.0001, oy + 0.214)], seg=20, mat="plastic_black")
    chain = [Vector((0.017 + 0.004 * math.sin(t * 3.0), oy + 0.2 - t * 0.035, 0.012 + 0.01 * t)) for t in
             [i / 8 for i in range(9)]]
    mb.tube(chain, 0.0011, seg=4, mat="steel_dark")
    return [R.obj(mb, "canteen", bevel=0.0006, bevel_segments=1)]


# ============================================================================================ registration

BUILDERS = {
    "hatchet": lambda: build_axe("hatchet"),
    "felling_axe": lambda: build_axe("felling_axe"),
    "stone_axe": build_stone_axe,
    "knife": lambda: build_knife(False),
    "stone_knife": lambda: build_knife(True),
    "spear": build_spear,
    "torch": build_torch,
    "flare": build_flare,
    "lantern": build_lantern,
    "ice_axe": build_ice_axe,
    "survey_scanner": lambda: build_scanner(False),
    "canteen": lambda: build_canteen(-0.09),
}

# How each tool lies on the ground (extra rotation applied after FP_TO_LYING, Godot space).
LYING = {
    # knives/spears are authored along Z: turn them so the long axis runs along X, flat side up
    "knife": Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))),
    "stone_knife": Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))),
    "spear": Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))),
}
UPRIGHT = {"lantern", "canteen"}      # stand on their base
SIDE = {"survey_scanner", "flare", "torch"}


def _register():
    for tid, fn in BUILDERS.items():
        R.fp(tid)(lambda fn=fn: {"objects": fn()})

        def item_fn(tid=tid, fn=fn):
            objs = build_canteen(0.0) if tid == "canteen" else (build_scanner(True) if tid == "survey_scanner" else fn())
            if tid in UPRIGHT:
                R.rest_on_ground(objs)
            elif tid in LYING:
                R.xform(objs, LYING[tid])
                R.rest_on_ground(objs)
            elif tid == "survey_scanner":
                R.xform(objs, R.rot("X", -90))           # lying on its back, screen up
                R.rest_on_ground(objs)
            else:
                R.lay_item(objs)
            return {"objects": objs}
        R.item(tid)(item_fn)


_register()

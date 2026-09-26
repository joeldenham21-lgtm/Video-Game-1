"""THIN AIR — hero world/pickup models for resources and food (resting on y = 0, centred in XZ, real scale).

Only items whose procedural ItemVisuals stand-in did not read as the real thing get a hero model here (the
rest keep their procedural model, which the icon/pickup pipeline uses automatically when no glb exists).
"""
import math

import bmesh
import bpy
from mathutils import Vector, noise

from lib import common as C
from lib import registry as R
from lib.geo import MB, smoothstep, lerp


def _faces_by_normal(mb, f0, test, mat):
    for fc in mb.f[f0:]:
        p = [mb.v[i] for i in fc.idx]
        n = (p[1] - p[0]).cross(p[2] - p[0])
        if n.length > 1e-12 and test(n.normalized(), sum(p, Vector()) / len(p)):
            fc.mat = mat


# ------------------------------------------------------------------------------------------ stone, flint

@R.item("stone")
def stone():
    mb = MB()
    mb.blob((0, 0, 0), (0.056, 0.036, 0.046), subdiv=3, mat="granite", amp=0.11, freq=1.4, seed=3, octaves=3,
            flat_bottom=0.72)
    ob = R.obj(mb, "stone", smooth_angle=80)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


@R.item("flint")
def flint():
    """Chert nodule with conchoidal flake scars: a lumpy core cut by a few planes (the knapped faces)."""
    mb = MB()
    mb.blob((0, 0, 0), (0.042, 0.026, 0.032), subdiv=3, mat="chert", amp=0.14, freq=1.8, seed=11, octaves=3)
    ob = R.obj(mb, "flint", smooth_angle=30)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    cuts = [((0.02, 0.0, 0.004), (0.9, 0.3, 0.2)), ((-0.018, 0.006, 0.0), (-0.8, 0.5, -0.1)),
            ((0.0, 0.0, 0.021), (0.1, 0.35, 0.95)), ((0.006, 0.014, -0.012), (0.3, 0.9, -0.4))]
    for co, no in cuts:
        # Godot-space plane -> Blender space
        cob = Vector((co[0], -co[2], co[1]))
        nob = Vector((no[0], -no[2], no[1])).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=cob, plane_no=nob, clear_outer=True)
        edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgeloop_fill(bm, edges=edges)
    for f in bm.faces:
        f.material_index = 0
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    C.finish(ob, 28)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


# ------------------------------------------------------------------------------------------ meat

def _steak(cooked):
    mb = MB()
    shrink = 0.9 if cooked else 1.0

    def flat(p, d):
        # cut faces: flatten top/bottom to a ~24 mm slab with soft rounded rims
        lim = 0.0115 * shrink
        y = p.y
        if abs(y) > lim * 0.7:
            y = math.copysign(lim * 0.7 + (abs(y) - lim * 0.7) * 0.25, y)
        # a lobed, irregular outline (a cut of the round, not an ellipse)
        a = math.atan2(p.z, p.x)
        k = 1.0 + 0.07 * math.sin(a * 3.0 + 0.6) + 0.04 * math.sin(a * 5.0 + 2.1)
        return Vector((p.x * k, y, p.z * k))

    f0 = len(mb.f)
    mb.blob((0, 0, 0), (0.085 * shrink, 0.02, 0.06 * shrink), subdiv=4, mat="meat_cooked" if cooked else "meat_raw",
            amp=0.06, freq=2.0, seed=5, fn=flat)
    if cooked:
        # seared rim: the sides of the steak char darker than the faces
        _faces_by_normal(mb, f0, lambda n, c: abs(n.y) < 0.45, "charred")
    # round-steak bone: a small ring of bone with marrow, through the slab
    bx, bz = 0.028 * shrink, -0.012 * shrink
    mb.lathe([(0.0001, -0.0105), (0.0125, -0.0105), (0.0128, 0.0105), (0.0001, 0.0105)], seg=16, mat="bone",
             m=R.T(bx, 0.0, bz))
    mb.disc(0.0072, 0.0107, seg=14, mat="meat_cooked" if cooked else "berry", m=R.T(bx, 0.0, bz))
    ob = R.obj(mb, "meat_cooked" if cooked else "meat_raw", smooth_angle=70)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


R.item("meat_raw")(lambda: _steak(False))
R.item("meat_cooked")(lambda: _steak(True))


# ------------------------------------------------------------------------------------------ bone

@R.item("bone")
def bone():
    """Deer cannon bone (metatarsal): long straight shaft, flat proximal end, paired distal condyles."""
    mb = MB()
    L = 0.24
    path, rad = [], []
    for i in range(25):
        f = i / 24
        x = lerp(-L / 2, L / 2, f)
        flare0 = smoothstep(0.12, 0.0, f)
        flare1 = smoothstep(0.86, 1.0, f)
        r = 0.0095 + 0.009 * flare0 ** 1.5 + 0.0075 * flare1 ** 1.5
        path.append(Vector((x, 0.0, 0.0015 * math.sin(f * math.pi))))
        rad.append((r * 1.12, r * 0.92))
    sec = [(math.cos(a), math.sin(a) * (0.82 if math.sin(a) > 0 and abs(math.cos(a)) < 0.35 else 1.0))
           for a in [j / 16 * math.tau for j in range(16)]]          # the dorsal groove
    mb.tube(path, rad, section=sec, mat="bone", up=(0, 1, 0))
    for sz in (-1, 1):                                              # distal condyles
        mb.blob((L / 2 + 0.004, 0.0, sz * 0.0085), (0.013, 0.0145, 0.0095), subdiv=2, mat="bone", amp=0.05, seed=sz + 4)
    mb.blob((-L / 2 - 0.001, 0.0, 0.0), (0.006, 0.0175, 0.02), subdiv=2, mat="bone", amp=0.04, seed=9)
    ob = R.obj(mb, "bone", smooth_angle=70)
    R.xform([ob], R.rot("Y", 12))
    R.rest_on_ground([ob])
    return {"objects": [ob]}


# ------------------------------------------------------------------------------------------ feather

@R.item("feather")
def feather():
    """Grouse flight feather: tapering quill (rachis) with an asymmetric, slightly cupped two-sided vane."""
    mb = MB()
    L = 0.17

    def rachis(u):
        return Vector((u * L, 0.0035 * math.sin(u * math.pi), 0.012 * u * u))

    mb.tube([rachis(i / 20) for i in range(21)], [0.0019 - 0.0015 * (i / 20) for i in range(21)], seg=6,
            mat="bone", up=(0, 1, 0))
    for side, width in ((1, 0.019), (-1, 0.0095)):
        def vane(u, v, p, side=side, width=width):
            uu = 0.18 + u * 0.82
            w = width * math.sin(min(1.0, (uu - 0.16) / 0.3) * math.pi * 0.5) * (1.0 - smoothstep(0.82, 1.0, uu) * 0.85)
            base = rachis(uu)
            tip_shift = v * 0.018                                      # barbs sweep toward the tip
            q = rachis(min(1.0, uu + tip_shift / L))
            n = Vector((-0.024 * uu, 0.0, 1.0)).normalized() * side
            split = 0.0
            if side > 0 and 0.52 < uu < 0.56:                          # a natural split in the vane
                split = -0.002 * v
            return (base.lerp(q, 0.8) + n * (v * w) + Vector((split, -0.0022 * v * v, 0.0)))
        mb.grid(1.0, 1.0, 22, 3, mat="feather", fn=vane, two_sided=True, thickness=0.0003)
    ob = R.obj(mb, "feather", smooth_angle=60)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


# ------------------------------------------------------------------------------------------ cloth rag

@R.item("cloth")
def cloth():
    """A torn flannel rag, loosely crumpled (two-sided sheet with ragged edges)."""
    mb = MB()
    W, H = 0.34, 0.24

    def crumple(u, v, p):
        x, z = p.x, p.z
        # ragged border
        edge = min(u, 1 - u, v, 1 - v)
        if edge < 0.02:
            j = noise.noise(Vector((u * 9.0, v * 9.0, 1.3))) * 0.012
            x += j
            z += noise.noise(Vector((u * 9.0, v * 9.0, 7.3))) * 0.012
        h = 0.012 * math.sin(u * 7.0 + v * 2.0) * math.sin(v * 5.0 + 1.0)
        h += 0.018 * math.exp(-((u - 0.35) ** 2 + (v - 0.6) ** 2) / 0.02)
        h += 0.01 * noise.noise(Vector((u * 4.0, v * 4.0, 3.7)))
        # a fold: one corner flipped back over
        if u > 0.72 and v < 0.3:
            t = smoothstep(0.72, 0.9, u) * smoothstep(0.3, 0.05, v)
            x -= t * 0.05
            h += t * 0.014
        return Vector((x, max(h, 0.0) + 0.0015, z))

    mb.grid(W, H, 20, 14, mat="weave_plaid", fn=crumple, two_sided=True, thickness=0.0018)
    ob = R.obj(mb, "cloth", smooth_angle=70)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


# ------------------------------------------------------------------------------------------ jerrycan

@R.item("fuel_can")
def fuel_can():
    """5-litre steel jerrycan (diesel yellow): pressed X panels, the welded mid seam, carry handle, spout + cam
    lever cap, diesel label."""
    mb = MB()
    Lx, Hy, Wz = 0.25, 0.30, 0.11
    sec = []
    for j in range(32):
        a = j / 32 * math.tau
        c, s = math.cos(a), math.sin(a)
        sec.append((math.copysign(abs(c) ** (2 / 7.0), c), math.copysign(abs(s) ** (2 / 7.0), s)))
    # body: rounded box swept upward; the top shoulders roll in
    path = [Vector((0, y, 0)) for y in (0.0, 0.006, 0.02, Hy - 0.03, Hy - 0.012, Hy)]
    rad = [(Lx / 2 - 0.008, Wz / 2 - 0.006), (Lx / 2 - 0.002, Wz / 2 - 0.001), (Lx / 2, Wz / 2), (Lx / 2, Wz / 2),
           (Lx / 2 - 0.004, Wz / 2 - 0.004), (Lx / 2 - 0.012, Wz / 2 - 0.012)]
    mb.tube(path, rad, section=sec, mat="paint_yellow", up=(0, 0, 1))
    # welded seam around the middle (XY plane at z = 0) — the jerrycan's signature rim
    seam = []
    for j in range(48):
        a = j / 48 * math.tau
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2 / 7.0), c) * (Lx / 2 + 0.002)
        y = Hy / 2 + math.copysign(abs(s) ** (2 / 7.0), s) * (Hy / 2 + 0.001)
        seam.append(Vector((x, y, 0.0)))
    mb.tube(seam, (0.0035, 0.0045), seg=6, mat="paint_yellow", closed=True, up=(0, 0, 1))
    # pressed X on both faces
    for sz in (-1, 1):
        zf = sz * (Wz / 2 + 0.0012)
        for (a, b) in (((-0.085, 0.045), (0.085, 0.235)), ((-0.085, 0.235), (0.085, 0.045))):
            mb.tube([Vector((a[0], a[1], zf)), Vector((b[0], b[1], zf))], (0.006, 0.0022), seg=8, mat="paint_yellow",
                    up=(0, 0, sz))
        # label on +Z face
    mb.grid(0.1, 0.07, 1, 1, mat="label_diesel", uv01=True, m=R.T(0.0, 0.14, Wz / 2 + 0.0036) @ R.rot("X", 90))
    # carry handle (a folded strap bridge over the top)
    hp = [Vector((-0.07, Hy - 0.004, 0)), Vector((-0.06, Hy + 0.03, 0)), Vector((0.03, Hy + 0.03, 0)),
          Vector((0.04, Hy - 0.004, 0))]
    mb.tube(hp, (0.0045, 0.012), seg=10, mat="paint_yellow", up=(0, 0, 1))
    # spout + cam-lever cap at the front corner
    sx = 0.085
    mb.lathe([(0.0001, Hy - 0.01), (0.021, Hy - 0.01), (0.021, Hy + 0.012), (0.019, Hy + 0.018), (0.0001, Hy + 0.018)],
             seg=18, mat="paint_yellow", m=R.T(sx, 0, 0) @ R.rot("Z", -12) @ R.T(0, 0, 0))
    mb.tube([Vector((sx - 0.02, Hy + 0.02, 0.0)), Vector((sx - 0.045, Hy + 0.026, 0.0))], (0.004, 0.008), seg=8,
            mat="steel_dark", up=(0, 0, 1))
    ob = R.obj(mb, "fuel_can", bevel=0.0008, bevel_segments=1)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


# ------------------------------------------------------------------------------------------ packs

def _pack(kind):
    """Upright rucksacks, back panel toward -Z: canvas daypack (backpack), the crash-torn version, and a tall
    expedition pack with lid, ice-axe loop, compression straps and a foam pad strapped underneath."""
    from models_tools import _round_rect_section
    mb = MB()
    tall = kind == "expedition_pack"
    H = 0.72 if tall else 0.5
    Wd = 0.33 if tall else 0.3
    D = 0.24 if tall else 0.19
    body_mat = {"backpack": "weave_olive", "backpack_torn": "weave_khaki", "expedition_pack": "weave_red"}[kind]
    sec = _round_rect_section(6, 3.0)
    ys = [0.0, 0.02, 0.1, H * 0.5, H * 0.85, H - 0.02, H]
    rad = [(Wd * 0.42, D * 0.38), (Wd * 0.48, D * 0.46), (Wd * 0.5, D * 0.5), (Wd * 0.5, D * 0.52),
           (Wd * 0.47, D * 0.48), (Wd * 0.4, D * 0.4), (Wd * 0.3, D * 0.3)]
    s0 = len(mb.v)
    f0 = len(mb.f)
    mb.tube([Vector((0, y, 0.0)) for y in ys], rad, section=sec, mat=body_mat, up=(0, 0, 1))
    # soft sag: the canvas bellies forward and slumps
    def sag(p):
        f = max(0.0, min(1.0, p.y / H))
        k = 0.012 * math.sin(f * math.pi) * (1 if p.z > 0 else 0)
        return Vector((p.x * (1.0 + 0.03 * math.sin(f * 7.0)), p.y, p.z + k))
    mb.deform(sag, s0)
    if kind == "backpack_torn":
        # ripped seam: a dark gash on the front and charred scuffs (it came through the crash)
        mb.box((0.012, 0.16, 0.004), (0.06, H * 0.55, D * 0.52), mat="weave_charcoal")
        from models_props import _noise_split
        _noise_split(mb, f0, "charred", freq=14.0, thresh=0.55, seed=3.0)
    # lid flap + buckles
    mb.blob((0.0, H - 0.03, D * 0.12), (Wd * 0.46, 0.05 if not tall else 0.07, D * 0.5), subdiv=3, mat=body_mat,
            amp=0.04, seed=6)
    for x in (-Wd * 0.22, Wd * 0.22):
        mb.tube([Vector((x, H + 0.01, D * 0.3)), Vector((x, H - 0.05, D * 0.62)), Vector((x, H * 0.62, D * 0.58))],
                (0.012, 0.0022), seg=6, mat="strap_black", up=(0, 0, 1))
        mb.box((0.026, 0.02, 0.008), (x, H * 0.62, D * 0.58), mat="plastic_black")
    # front pocket (daypacks) / ice-axe loop + compression straps (expedition)
    if tall:
        for y in (H * 0.35, H * 0.6):
            mb.tube([Vector((-Wd * 0.5, y, 0.0)), Vector((-Wd * 0.4, y, D * 0.5)), Vector((Wd * 0.4, y, D * 0.5)),
                     Vector((Wd * 0.5, y, 0.0))], (0.011, 0.002), seg=6, mat="strap_black", up=(0, 1, 0))
        mb.lathe([(0.0001, -Wd * 0.5), (0.06, -Wd * 0.5), (0.06, Wd * 0.5), (0.0001, Wd * 0.5)], seg=16,
                 mat="plastic_yellow", m=R.T(0.0, -0.04, D * 0.1) @ R.rot("Z", 90))          # foam pad under the pack
        mb.tube([Vector((0.0, 0.12, D * 0.53)), Vector((0.0, 0.07, D * 0.56))], 0.006, seg=6, mat="strap_black")
    else:
        mb.blob((0.0, H * 0.3, D * 0.5), (Wd * 0.36, H * 0.2, 0.045), subdiv=3, mat=body_mat, amp=0.03, seed=8)
    # shoulder straps + hip belt on the back (-Z)
    for x in (-0.07, 0.07):
        mb.tube([Vector((x, H * 0.88, -D * 0.5)), Vector((x * 1.3, H * 0.75, -D * 0.62)), Vector((x * 1.6, H * 0.4, -D * 0.64)),
                 Vector((x * 2.0, H * 0.15, -D * 0.55))], (0.03, 0.008), seg=6, mat="strap_black", up=(0, 0, -1))
    if tall:
        mb.tube([Vector((-Wd * 0.62, 0.1, -D * 0.2)), Vector((-Wd * 0.4, 0.08, -D * 0.6)), Vector((Wd * 0.4, 0.08, -D * 0.6)),
                 Vector((Wd * 0.62, 0.1, -D * 0.2))], (0.045, 0.01), seg=6, mat="strap_black", up=(0, 1, 0))
    ob = R.obj(mb, kind, smooth_angle=60)
    R.rest_on_ground([ob])
    return {"objects": [ob]}


for _k in ("backpack", "backpack_torn", "expedition_pack"):
    R.item(_k)(lambda _k=_k: _pack(_k))


@R.item("o2_mask")
def o2_mask():
    """Mountaineering oxygen mask: soft silicone face cup, reservoir valve, head harness, regulator hose."""
    mb = MB()
    s0 = len(mb.v)
    mb.lathe([(0.0001, 0.0), (0.028, 0.004), (0.045, 0.02), (0.055, 0.05), (0.057, 0.075), (0.052, 0.09),
              (0.046, 0.094), (0.044, 0.086), (0.048, 0.07), (0.046, 0.045), (0.034, 0.02), (0.0001, 0.012)], seg=24,
             mat="silicone_dark")
    # nose narrowing: squash the cup into a face shape (taller than wide, pointed at the nose)
    def face(p):
        f = p.y / 0.095
        return Vector((p.x * (0.86 - 0.22 * f * (1 if p.z < 0 else 0.6)), p.y * 0.62, p.z * 1.1))
    mb.deform(face, s0)
    mb.lathe([(0.0001, -0.018), (0.022, -0.018), (0.024, -0.004), (0.017, 0.004), (0.0001, 0.004)], seg=18,
             mat="plastic_black")                                                        # exhale valve
    mb.lathe([(0.0001, -0.02), (0.018, -0.02), (0.018, -0.019), (0.0001, -0.019)], seg=18, mat="plastic_orange")
    mb.tube([Vector((0.0, -0.012, 0.018)), Vector((0.0, -0.03, 0.06)), Vector((0.03, 0.0, 0.12)),
             Vector((0.07, 0.06, 0.16)), Vector((0.14, 0.086, 0.2)), Vector((0.22, 0.086, 0.21))], 0.0075, seg=8,
            mat="silicone_dark")                                                         # hose, draped to the ground
    for k in range(10):                                                                     # hose ribs
        t = k / 9
        c = Vector((0.0, -0.03, 0.06)).lerp(Vector((0.03, 0.0, 0.12)), t)
        mb.tube([c + Vector((math.cos(a) * 0.0085, 0, math.sin(a) * 0.0085)) for a in [i / 8 * math.tau for i in range(8)]],
                0.0012, seg=4, mat="silicone_dark", closed=True)
    for y in (0.03, 0.075):                                                                 # harness straps
        for sx in (-1, 1):
            mb.tube([Vector((sx * 0.055, y, 0.035)), Vector((sx * 0.09, lerp(y, 0.092, 0.45), 0.08)),
                     Vector((sx * 0.1, lerp(y, 0.092, 0.85), 0.15)), Vector((sx * 0.06, 0.092, 0.21))],
                    (0.009, 0.0018), seg=6, mat="strap_black", up=(0, 1, 0))
    ob = R.obj(mb, "o2_mask", smooth_angle=60)
    R.xform([ob], R.rot("X", 180))                     # lying face-down, harness and hose splayed on the ground
    R.rest_on_ground([ob])
    return {"objects": [ob]}

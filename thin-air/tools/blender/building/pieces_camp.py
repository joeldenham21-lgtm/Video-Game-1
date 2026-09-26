"""Free-placed camp pieces (origin on the ground, front = +Z, real-world scale).

Each family writes camp_<name>.glb with a "Model" part (+ named extra parts the piece script toggles).
"""
import math
import random

from mathutils import Vector, Matrix

import blib
from blib import Soup, Corner, V, log, board, stone, rope_segment, card, lashing, smoothstep, lerp


def _pole(s, a, b, r, seed, step=0.0, bark=0.95, sides=8, seg=0.45, cap0=True, cap1=True):
    """Unpeeled sapling pole (mostly bark)."""
    log(s, a, b, r, r * 0.85, seed=seed, bark=bark, step=step, sides=sides, seg=seg, bulge=0.05, wobble=0.012,
        cap0=cap0, cap1=cap1, end_nominal=False, end_bevel=0.004)


def _ring_stones(s, radius, courses, seed, h0=0.0, size=0.16, count=None, squash=(1.2, 0.62, 0.9), step0=0.0, step1=1.0,
                 inward=True):
    rng = random.Random(seed)
    y = h0
    for c in range(courses):
        n = count or max(6, int(math.tau * radius / (size * 1.9)))
        off = rng.uniform(0, math.tau)
        sz = size * (1.0 - 0.12 * c)
        for i in range(n):
            a = off + math.tau * (i + (0.5 if c % 2 else 0.0)) / n + rng.uniform(-0.06, 0.06)
            r = radius + rng.uniform(-0.03, 0.03) - (0.02 * c if inward else 0.0)
            p = (math.cos(a) * r, y + sz * squash[1] * 0.55, math.sin(a) * r)
            stp = lerp(step0, step1, (c + i / n) / courses)
            stone(s, p, sz * rng.uniform(0.85, 1.15), seed=seed * 100 + c * 37 + i, squash=squash,
                  rot_y=-a + rng.uniform(-0.3, 0.3), step=stp)
        y += sz * squash[1] * 1.05


# ============================================================================================ fire pit

def fire_pit():
    s = Soup()
    # a shallow scooped hearth with a dry-stone wall two to three courses high
    _ring_stones(s, 0.66, 3, 11, h0=-0.04, size=0.17, step0=0.0, step1=0.8)
    # ash + char bed
    rng = random.Random(3)
    for i in range(12):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.0, 0.42)
        stone(s, (math.cos(a) * r, 0.0, math.sin(a) * r), rng.uniform(0.05, 0.1), seed=500 + i,
              squash=(1.4, 0.35, 1.2), mat="coal", step=0.9)
    # a couple of half-burnt logs crossing the pit
    for i, (a0, a1) in enumerate(((0.3, 3.5), (1.9, 5.0))):
        p0 = (math.cos(a0) * 0.5, 0.07, math.sin(a0) * 0.5)
        p1 = (math.cos(a1) * 0.18, 0.1, math.sin(a1) * 0.18)
        log(s, p0, p1, 0.055, 0.045, seed=40 + i, bark=0.8, step=0.95, sides=8, seg=0.3)
    return {"Model": s}


# ============================================================================================ torch stand

def torch_stand():
    s = Soup()
    _ring_stones(s, 0.2, 3, 21, h0=-0.03, size=0.13, count=6, squash=(1.1, 0.7, 1.0), step0=0.0, step1=0.5)
    stone(s, (0.0, 0.3, 0.0), 0.11, seed=90, squash=(1.0, 0.6, 1.0), step=0.5)
    _pole(s, (0.0, -0.1, 0.0), (0.02, 1.62, 0.01), 0.035, seed=7, step=0.6, bark=0.9)
    # resin-soaked cloth head, lashed with rope
    head = Soup()
    rng = random.Random(4)
    for k in range(5):
        y = 1.5 + k * 0.035
        log(head, (0.02, y, 0.01), (0.02, y + 0.05, 0.01), 0.055 - 0.004 * abs(k - 2), 0.05 - 0.004 * abs(k - 2),
            seed=60 + k, bark=0.0, sides=10, seg=0.1, up_hint=Vector((1, 0, 0)), mat="cloth", step=0.9,
            wobble=0.0, bulge=0.1, ellipse=0.08)
    s.extend(head)
    for k in range(3):
        y = 1.46 + k * 0.012
        rope_segment(s, (0.058, y, -0.03), (0.058, y, 0.05), 0.006, step=0.95)
    return {"Model": s}


# ============================================================================================ drying rack

def drying_rack():
    s = Soup()
    W = 1.9
    H = 1.62
    # two A-frame ends: pairs of poles crossing near the top, lashed
    for i, x in enumerate((-W / 2, W / 2)):
        for side in (-1, 1):
            foot = (x + side * 0.02, -0.08, side * 0.5)
            top = (x - side * 0.02, H + 0.12, -side * 0.08)
            _pole(s, foot, top, 0.035, seed=10 + i * 3 + side, step=0.1 + 0.1 * i)
        lashing(s, (x, H, 0.0), (0, 0.4, 1), (0, 0.4, -1), 0.035, 0.035, wraps=3, seed=30 + i, step=0.5)
    # ridge pole in the crotches + two lower rails
    _pole(s, (-W / 2 - 0.15, H + 0.02, 0.0), (W / 2 + 0.15, H + 0.02, 0.0), 0.03, seed=40, step=0.55)
    for z, y, sd in ((0.28, 0.95, 41), (-0.28, 0.95, 42)):
        _pole(s, (-W / 2 - 0.05, y, z), (W / 2 + 0.05, y, z), 0.022, seed=sd, step=0.7)
    out = {"Model": s}
    # meat strips hanging over the ridge (script shows/hides and colours them)
    rng = random.Random(8)
    for i in range(6):
        m = Soup()
        x = -0.75 + i * 0.3 + rng.uniform(-0.04, 0.04)
        L = rng.uniform(0.28, 0.38)
        for side in (-1, 1):
            # a strip draped over the pole on both sides
            rot = Matrix.Rotation(side * 0.18, 3, 'X')
            board(m, (x, H - L * 0.5 + 0.01, side * 0.035), (0.055, L, 0.012), rot, mat="meat", seed=80 + i * 2 + side,
                  grain_axis=1, step=1.0, bevel=0.003)
        out["Meat%d" % i] = m
    # a hide stretched on the rails (lower front)
    h = Soup()
    hw, hh = 1.2, 0.7
    rng = random.Random(12)
    rows = 5
    cols = 8
    pts = []
    for j in range(rows + 1):
        row = []
        for i in range(cols + 1):
            u = i / cols
            v = j / rows
            edge = min(u, 1 - u, v, 1 - v)
            wob = 0.03 * math.sin(u * 9 + v * 4) * (1 - smoothstep(0.0, 0.15, edge) * 0.4)
            x = (u - 0.5) * hw * (0.85 + 0.15 * math.sin(v * math.pi))
            y = 0.95 - v * hh + wob
            z = 0.3 + 0.02 * math.sin(u * math.pi) + wob * 0.3
            row.append(Vector((x, y, z)))
        pts.append(row)
    uv2 = (3.0, 7.0)
    for j in range(rows):
        for i in range(cols):
            q = [pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]]
            n = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
            if n.z < 0:
                n = -n
            cs = [Corner(p, n.copy(), (p.x, p.y), uv2, (1.0, 1.0, 0.0, 0.0)) for p in q]
            h.add(cs, "hide")
            cs2 = [Corner(p + n * -0.004, -n, (p.x, p.y), uv2, (0.8, 1.0, 0.0, 0.0)) for p in reversed(q)]
            h.add(cs2, "hide")
    for k in range(4):
        u = k / 3.0
        x = (u - 0.5) * hw * 0.9
        rope_segment(h, (x, 0.95, 0.3), (x, 0.97, 0.28), 0.005, step=1.0)
    out["Hide0"] = h
    return out


# ============================================================================================ snow melter

def snow_melter():
    s = Soup()
    # two dry-stone piers
    for i, x in enumerate((-0.4, 0.4)):
        rng = random.Random(70 + i)
        for c in range(3):
            for k in range(2):
                stone(s, (x + rng.uniform(-0.05, 0.05), 0.06 + c * 0.12, -0.12 + k * 0.24), 0.12, seed=700 + i * 20 + c * 3 + k,
                      squash=(1.1, 0.55, 0.95), step=0.1 + 0.1 * c)
    # folded aluminium trough (salvaged aircraft skin): a V/U section with end plates, slight tilt to a spout
    t = Soup()
    L = 1.05
    prof = [(-0.2, 0.18), (-0.16, 0.04), (-0.08, 0.0), (0.08, 0.0), (0.16, 0.04), (0.2, 0.18)]
    y0 = 0.42
    tilt = 0.04
    rows = 8
    for side in (1, -1):
        for j in range(rows):
            for k in range(len(prof) - 1):
                x0 = -L / 2 + L * j / rows
                x1 = -L / 2 + L * (j + 1) / rows
                a = prof[k]
                b = prof[k + 1]
                q = [Vector((x0, y0 + a[1] - tilt * (x0 + L / 2), a[0])), Vector((x1, y0 + a[1] - tilt * (x1 + L / 2), a[0])),
                     Vector((x1, y0 + b[1] - tilt * (x1 + L / 2), b[0])), Vector((x0, y0 + b[1] - tilt * (x0 + L / 2), b[0]))]
                n = (q[1] - q[0]).cross(q[3] - q[0]).normalized() * side
                off = n * 0.0 if side == 1 else Vector((0, 0, 0))
                pts = q if side == 1 else list(reversed(q))
                cs = [Corner(p + (Vector((0, -0.003, 0)) if side == -1 else Vector()), n.copy(), (p.x, p.z + p.y),
                             (1.0, 2.0), (0.9, 0.6, 0.0, 0.0)) for p in pts]
                t.add(cs, "metal")
    # end plates
    for xe, sgn in ((-L / 2, -1), (L / 2, 1)):
        pts = [Vector((xe, y0 + p[1] - tilt * (xe + L / 2), p[0])) for p in prof]
        c = sum(pts, Vector()) / len(pts)
        for side in (1, -1):
            n = Vector((sgn * side, 0, 0))
            for k in range(len(pts) - 1):
                tri = [c, pts[k], pts[k + 1]] if side * sgn > 0 else [c, pts[k + 1], pts[k]]
                t.add([Corner(p, n.copy(), (p.z, p.y), (1.0, 2.0), (0.8, 0.6, 0.0, 0.0)) for p in tri], "metal")
    # spout (a rolled lip at the low end) + wire bail
    log(t, (L / 2 - 0.02, y0 - tilt * L + 0.02, 0.0), (L / 2 + 0.1, y0 - tilt * L - 0.01, 0.0), 0.02, 0.018, seed=3,
        bark=0.0, mat="metal", sides=8, step=0.7)
    for x in (-0.35, 0.35):
        rope_segment(t, (x, y0 + 0.19 - tilt * (x + L / 2), -0.2), (x, y0 + 0.19 - tilt * (x + L / 2), 0.2), 0.003,
                     step=0.8)
    s.extend(t)
    out = {"Model": s}
    # snow heap and water surface (script toggles / scales)
    sn = Soup()
    rng = random.Random(9)
    for i in range(7):
        stone(sn, (-0.3 + i * 0.1 + rng.uniform(-0.03, 0.03), y0 + 0.08, rng.uniform(-0.06, 0.06)), 0.12, seed=900 + i,
              squash=(1.2, 0.6, 1.0), mat="snow", step=1.0, rough=0.35)
    out["Snow"] = sn
    w = Soup()
    q = [Vector((-L / 2 + 0.02, y0 + 0.06, -0.12)), Vector((L / 2 - 0.02, y0 + 0.06 - tilt * L, -0.12)),
         Vector((L / 2 - 0.02, y0 + 0.06 - tilt * L, 0.12)), Vector((-L / 2 + 0.02, y0 + 0.06, 0.12))]
    w.add([Corner(p, Vector((0, 1, 0)), (p.x, p.z), (0, 0), (1, 1, 0, 0)) for p in q], "water")
    out["Water"] = w
    return out


# ============================================================================================ beds

def _bough_layer(s, x0, x1, z0, z1, y, seed, step=0.5, count=26, tilt=0.35):
    """Spruce boughs laid shingle-fashion (butts toward the foot) — alpha cards."""
    rng = random.Random(seed)
    for i in range(count):
        x = rng.uniform(x0 + 0.1, x1 - 0.1)
        z = rng.uniform(z0 + 0.08, z1 - 0.08)
        ang = rng.uniform(-0.5, 0.5) + (math.pi / 2)
        L = rng.uniform(0.5, 0.7)
        w = L * 0.75
        d = Vector((math.cos(ang), 0.0, math.sin(ang)))
        up = (d + Vector((0, rng.uniform(0.15, tilt), 0))).normalized()
        right = up.cross(Vector((0, 1, 0))).normalized()
        if right.length < 0.1:
            right = Vector((1, 0, 0))
        n = right.cross(up).normalized()
        if n.y < 0:
            n = -n
        card(s, (x, y + rng.uniform(0.0, 0.08), z), right, up, w, L, mat="bough", step=step, normal=n, bend=0.12, segs=2)


def bough_bed():
    s = Soup()
    Lx, Lz = 2.0, 0.95
    # four side logs pegged into a rectangle on the ground
    for i, (a, b, r) in enumerate((((-Lx / 2, 0.07, -Lz / 2), (Lx / 2, 0.07, -Lz / 2), 0.075),
                                   ((-Lx / 2, 0.07, Lz / 2), (Lx / 2, 0.07, Lz / 2), 0.075),
                                   ((-Lx / 2 + 0.05, 0.16, -Lz / 2 - 0.05), (-Lx / 2 + 0.05, 0.16, Lz / 2 + 0.05), 0.07),
                                   ((Lx / 2 - 0.05, 0.16, -Lz / 2 - 0.05), (Lx / 2 - 0.05, 0.16, Lz / 2 + 0.05), 0.07))):
        _pole(s, a, b, r, seed=5 + i, step=0.1 + 0.05 * i, bark=0.9, sides=10)
    for i, (x, z) in enumerate(((-Lx / 2 - 0.1, -Lz / 2 - 0.1), (Lx / 2 + 0.1, Lz / 2 + 0.1),
                                (-Lx / 2 - 0.1, Lz / 2 + 0.1), (Lx / 2 + 0.1, -Lz / 2 - 0.1))):
        _pole(s, (x, -0.1, z), (x, 0.18, z), 0.025, seed=20 + i, step=0.3)
    _bough_layer(s, -Lx / 2, Lx / 2, -Lz / 2, Lz / 2, 0.12, 1, step=0.55, count=30)
    _bough_layer(s, -Lx / 2, Lx / 2, -Lz / 2, Lz / 2, 0.2, 2, step=0.85, count=26)
    return {"Model": s}


def bed():
    s = Soup()
    Lx, Lz, H = 2.05, 1.0, 0.42
    # four corner posts, side rails notched in, a slat base
    for i, (x, z) in enumerate(((-Lx / 2, -Lz / 2), (Lx / 2, -Lz / 2), (Lx / 2, Lz / 2), (-Lx / 2, Lz / 2))):
        top = H + (0.28 if x < 0 else 0.1)
        log(s, (x, 0.0, z), (x, top, z), 0.07, 0.065, seed=30 + i, bark=0.2, sides=10, seg=0.3, step=0.1,
            up_hint=Vector((1, 0, 0)))
    for z in (-Lz / 2, Lz / 2):
        log(s, (-Lx / 2 - 0.02, H - 0.08, z), (Lx / 2 + 0.02, H - 0.08, z), 0.065, 0.06, seed=40 + int(z * 10), bark=0.2,
            sides=10, seg=0.35, step=0.25)
    for x in (-Lx / 2, Lx / 2):
        log(s, (x, H - 0.02, -Lz / 2 - 0.02), (x, H - 0.02, Lz / 2 + 0.02), 0.06, 0.06, seed=50 + int(x * 10), bark=0.2,
            sides=10, seg=0.35, step=0.25)
    log(s, (-Lx / 2, H + 0.2, -Lz / 2), (-Lx / 2, H + 0.2, Lz / 2), 0.055, 0.055, seed=58, bark=0.2, sides=10, step=0.3)
    for i in range(7):
        x = -Lx / 2 + 0.2 + i * (Lx - 0.4) / 6
        board(s, (x, H - 0.03, 0.0), (0.12, 0.03, Lz - 0.06), seed=60 + i, grain_axis=2, step=0.4, weather=0.2)
    # hide-covered bough mattress: a soft pillowy box
    m = Soup()
    mx, mz, my = Lx - 0.16, Lz - 0.12, 0.16
    nx, nz = 12, 6
    y0 = H
    grid = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            u = i / nx
            v = j / nz
            bulge = math.sin(u * math.pi) ** 0.35 * math.sin(v * math.pi) ** 0.35
            x = (u - 0.5) * mx
            z = (v - 0.5) * mz
            y = y0 + 0.02 + my * bulge + 0.01 * math.sin(u * 17 + v * 11)
            row.append(Vector((x, y, z)))
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            n = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
            if n.y < 0:
                n = -n
                q = list(reversed(q))
            m.add([Corner(p, n.copy(), (p.x, p.z), (5.0, 1.0), (1.0, 0.7, 0.0, 0.0)) for p in q], "hide")
    s.extend(m)
    # folded wool blanket at the foot + a rolled pillow at the head
    board(s, (0.62, H + 0.19, 0.0), (0.5, 0.06, Lz - 0.18), seed=70, mat="wool", grain_axis=2, step=0.95, bevel=0.02)
    log(s, (-Lx / 2 + 0.28, H + 0.2, -0.3), (-Lx / 2 + 0.28, H + 0.2, 0.3), 0.07, 0.07, seed=71, bark=0.0, mat="wool",
        sides=10, step=1.0, bulge=0.1, ellipse=0.15)
    _bough_layer(s, -0.5, 0.5, -Lz / 2 - 0.05, -Lz / 2 + 0.05, H + 0.08, 9, step=0.8, count=4, tilt=0.2)
    return {"Model": s}


# ============================================================================================ lean-to

def lean_to():
    s = Soup()
    W = 3.0
    ridge_h = 1.75
    depth = 2.0
    # forked uprights at the front corners
    for i, x in enumerate((-W / 2 + 0.1, W / 2 - 0.1)):
        _pole(s, (x, -0.2, 0.9), (x + 0.03, ridge_h + 0.18, 0.92), 0.055, seed=3 + i, step=0.05)
        _pole(s, (x + 0.02, ridge_h - 0.05, 0.92), (x + 0.12, ridge_h + 0.25, 0.94), 0.03, seed=9 + i, step=0.1)
    _pole(s, (-W / 2 - 0.15, ridge_h + 0.04, 0.92), (W / 2 + 0.15, ridge_h + 0.04, 0.92), 0.05, seed=12, step=0.2)
    for i, x in enumerate((-W / 2 + 0.1, W / 2 - 0.1)):
        lashing(s, (x, ridge_h + 0.04, 0.92), (1, 0, 0), (0, 1, 0), 0.05, 0.055, wraps=3, seed=40 + i, step=0.25)
    # rafters from the ridge down to the ground behind
    rng = random.Random(5)
    n = 8
    for i in range(n):
        x = -W / 2 + 0.15 + i * (W - 0.3) / (n - 1) + rng.uniform(-0.04, 0.04)
        _pole(s, (x, ridge_h + 0.12, 1.05), (x + rng.uniform(-0.05, 0.05), -0.1, 0.92 - depth), 0.03, seed=20 + i,
              step=0.3 + 0.2 * i / n)
    # purlin poles across the rafters
    for k in range(3):
        t = (k + 1) / 4.0
        y = ridge_h + 0.12 - t * (ridge_h + 0.2) + 0.05
        z = 1.05 - t * (depth + 0.13)
        _pole(s, (-W / 2, y, z), (W / 2, y, z), 0.022, seed=60 + k, step=0.55)
    # bark slabs shingled on the roof, then spruce boughs on top
    slope = Vector((0, -(ridge_h + 0.2), -(depth + 0.13))).normalized()
    side = Vector((1, 0, 0))
    nrm = side.cross(slope).normalized()
    if nrm.y < 0:
        nrm = -nrm
    rows = 7
    for r in range(rows):
        t0 = r / rows
        base = Vector((0, ridge_h + 0.16, 1.07)) + slope * (t0 * (depth + ridge_h) * 0.74)
        cols = 8
        for c in range(cols):
            x = -W / 2 + 0.2 + c * (W - 0.4) / (cols - 1) + rng.uniform(-0.1, 0.1)
            w = rng.uniform(0.3, 0.48)
            L = rng.uniform(0.55, 0.85)
            twist = rng.uniform(-0.18, 0.18)
            sd = (side * math.cos(twist) + slope * math.sin(twist)).normalized()
            dn = (slope * math.cos(twist) - side * math.sin(twist)).normalized()
            cen = base + Vector((x, 0, 0)) + slope * (L * 0.45) + nrm * (0.035 + 0.012 * r + 0.01 * (c % 2))
            _bark_slab(s, cen, sd, dn, nrm, w, L, seed=100 + r * 10 + c, step=0.55 + 0.25 * r / rows)
    # spruce boughs thatched thickly over the bark, butts up and tips down like shingles, in overlapping rows
    for row in range(9):
        t = row / 8.0
        n_row = 13
        for i in range(n_row):
            x = -W / 2 + 0.05 + (i + (0.5 if row % 2 else 0.0)) * (W - 0.1) / n_row + rng.uniform(-0.08, 0.08)
            cen = Vector((x, ridge_h + 0.16, 1.07)) + slope * (t * (depth + ridge_h) * 0.72 + 0.1) \
                + nrm * (0.1 + 0.015 * row + rng.uniform(0.0, 0.05))
            up = (-slope + Vector((rng.uniform(-0.35, 0.35), 0, 0))).normalized()
            r2 = up.cross(nrm).normalized()
            L = rng.uniform(0.8, 1.15)
            card(s, cen, r2, up, L * 0.75, L, mat="bough", step=0.8 + 0.2 * t, normal=nrm, bend=0.12, segs=2)
    # boughs leaned against the two triangular ends
    for side in (-1, 1):
        for i in range(9):
            t = rng.uniform(0.1, 0.9)
            y = (ridge_h + 0.1) * (1.0 - t) * rng.uniform(0.5, 0.95)
            z = 1.0 - t * (depth + 0.1)
            cen = Vector((side * (W / 2 + 0.05), y * 0.6 + 0.2, z))
            nrm2 = Vector((side, 0.2, 0)).normalized()
            up = Vector((0, 1, rng.uniform(-0.4, 0.4))).normalized()
            r2 = up.cross(nrm2).normalized()
            L = rng.uniform(0.7, 1.0)
            card(s, cen, r2, up, L * 0.75, L, mat="bough", step=0.95, normal=nrm2, bend=0.08, segs=2)
    return {"Model": s}


def _bark_slab(s, cen, side, down, nrm, w, L, seed, step):
    """Curved slab of spruce bark (bark material, UV in metres), convex side up."""
    rng = random.Random(seed)
    nu, nv = 5, 3
    uv2 = (rng.uniform(0, 30), rng.uniform(0, 30))
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u = i / nu - 0.5
            v = j / nv - 0.5
            curl = 0.06 * (1.0 - (2 * u) ** 2)
            p = cen + side * (u * w) + down * (v * L) + nrm * (curl + rng.uniform(-0.005, 0.005))
            row.append(p)
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            n = (q[1] - q[0]).cross(q[3] - q[0]).normalized()
            if n.dot(nrm) < 0:
                n = -n
            top = [Corner(p, n.copy(), ((p - cen).dot(side), (p - cen).dot(down)), uv2, (1.0, step, 0.0, 0.0)) for p in q]
            s.add(top, "bark")
            bot = [Corner(p - n * 0.012, -n, ((p - cen).dot(side), (p - cen).dot(down)), uv2, (0.6, step, 0.0, 0.0))
                   for p in reversed(q)]
            s.add(bot, "bark")


# ============================================================================================ rope ladder

def rope_ladder():
    s = Soup()
    L = 4.0
    # anchor stake driven into the ledge, the ropes tied round it
    _pole(s, (0.0, -0.35, 0.18), (0.0, 0.35, 0.16), 0.04, seed=1, step=0.0)
    for x in (-0.2, 0.2):
        rope_segment(s, (x * 0.4, 0.2, 0.17), (x, 0.0, 0.02), 0.009, step=0.1)
        pts = []
        for i in range(21):
            t = i / 20
            pts.append(Vector((x, -t * L, 0.02 + 0.02 * math.sin(t * 3.1))))
        for i in range(20):
            rope_segment(s, pts[i], pts[i + 1], 0.009, sides=6, step=0.2 + 0.6 * i / 20)
    n = int(L / 0.32)
    for k in range(n):
        y = -0.3 - k * 0.32
        z = 0.02 + 0.02 * math.sin((-y / L) * 3.1)
        _pole(s, (-0.24, y, z), (0.24, y, z), 0.018, seed=10 + k, step=0.25 + 0.7 * k / n, bark=0.6, sides=6)
        for x in (-0.2, 0.2):
            rope_segment(s, (x, y + 0.025, z), (x, y - 0.025, z), 0.012, sides=6, step=0.3 + 0.7 * k / n)
    return {"Model": s}


# ============================================================================================ stone windbreak

def stone_windbreak():
    s = Soup()
    rng = random.Random(17)
    # a shallow arc of dry-stone, thick at the base, battered inward, chest high
    courses = 6
    y = -0.05
    for c in range(courses):
        sz = 0.2 - c * 0.018
        n = 9 - (c // 2)
        width = 1.25 - c * 0.04
        for row in (-1, 1):
            for i in range(n):
                t = (i + (0.5 if c % 2 else 0.0)) / n
                x = (t - 0.5) * 2.0 * width
                z = 0.18 * (1.0 - (x / 1.3) ** 2) + row * (0.2 - c * 0.02)
                stone(s, (x + rng.uniform(-0.03, 0.03), y + sz * 0.35, z), sz * rng.uniform(0.85, 1.15), seed=c * 50 + i * 2 + row,
                      squash=(1.3, 0.62, 0.9), rot_y=rng.uniform(-0.3, 0.3), step=c / courses)
        y += sz * 0.62
    return {"Model": s}


FAMILIES = {
    "camp_fire_pit": fire_pit,
    "camp_torch_stand": torch_stand,
    "camp_drying_rack": drying_rack,
    "camp_snow_melter": snow_melter,
    "camp_bough_bed": bough_bed,
    "camp_bed": bed,
    "camp_lean_to": lean_to,
    "camp_rope_ladder": rope_ladder,
    "camp_windbreak": stone_windbreak,
}

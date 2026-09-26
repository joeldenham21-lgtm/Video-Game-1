"""Grid-snapped log construction pieces (see src/building/build_grid.gd for the matching constants).

Conventions (Godot coords, metres):
  * grid cell 2 m; a piece's origin is the centre of its cell / edge / node at the level's deck height (y = 0).
  * walls run along local X from x = -1 to +1, centred on z = 0; "even" walls (along the structure's X axis)
    have full logs at y = 0.135 + 0.27 k; "odd" walls (along Z) a half log at y = 0 and logs at 0.27 k, so
    corners interleave by half a course (saddle-notched corners). Wall top (plate) ~2.44.
  * roofs rise toward local +X by 1.35 m per 2 m cell (34 deg) above the plate; origin at the plate top.
  * directional pieces (stairs, doors) rise / open toward local +X.
"""
import math
import random

from mathutils import Vector, Matrix

import blib
from blib import Soup, Corner, V, log, board, stone, rope_segment, card, smoothstep, lerp

CELL = 2.0
HALF = 1.0
COURSE = 0.27
LOG_R = 0.145
WALL_TOP = 2.44
LEVEL_H = 2.6
ROOF_RISE = 1.35
ROOF_SLOPE = ROOF_RISE / CELL
DECK_R = 1.0 / 7.0                     # puncheon (split log) half-width: 7 across a cell
SILL_R = 0.15
SILL_Y = -DECK_R - SILL_R              # sill log centre
POST_TOP = SILL_Y - SILL_R + 0.02
POST_R = 0.15
EAVE = 0.5                             # eave overhang (horizontal)
GABLE_OVER = 0.35                      # roof overhang past the gable wall
DOOR_W = 0.96
DOOR_H = 1.88
WIN_W = 0.80


def course_list(parity):
    """[(y_centre, kind)] kind: 'full' | 'half_down' (flat face down) | 'half_up' (flat face up)."""
    if parity == "even":
        return [(0.135 + COURSE * k, "full") for k in range(9)]
    out = [(0.0, "half_down")]
    out += [(COURSE * k, "full") for k in range(1, 9)]
    out.append((2.43, "half_up"))
    return out


def gable_courses(parity, y_max):
    if parity == "even":
        out = []
        k = 9
        while 0.135 + COURSE * k - LOG_R * 0.6 < y_max:
            out.append((0.135 + COURSE * k, "full"))
            k += 1
        return out
    out = [(2.43, "half_down")]
    k = 10
    while COURSE * k - LOG_R * 0.6 < y_max:
        out.append((COURSE * k, "full"))
        k += 1
    return out


def _log_course(soup, y, kind, x0, x1, seed, step, cap0=True, cap1=True, bark=0.4, ao_up=0.4, ao_down=0.4, r=LOG_R):
    rr = random.Random(seed)
    rad = r * rr.uniform(0.93, 1.05)
    if kind == "full":
        log(soup, (x0, y, 0.0), (x1, y, 0.0), rad, rad * rr.uniform(0.97, 1.0), seed=seed, bark=bark * rr.uniform(0.6, 1.4),
            step=step, ao_up=ao_up, ao_down=ao_down, cap0=cap0, cap1=cap1, sides=14, seg=0.3, bulge=0.05, wobble=0.012)
    else:
        face = (0, -1, 0) if kind == "half_down" else (0, 1, 0)
        log(soup, (x0, y, 0.0), (x1, y, 0.0), rad, rad, seed=seed, bark=bark, step=step, profile="half",
            flat_face=face, ao_up=ao_up, ao_down=ao_down, cap0=cap0, cap1=cap1, sides=14, seg=0.34)


def _chink(soup, x0, x1, y, step, depth=0.094, h=0.05, seed=0):
    """Mortar/moss chinking in the groove between two courses, both faces of the wall."""
    rng = random.Random(seed)
    uv2 = (rng.uniform(0, 50), rng.uniform(0, 50))
    n_seg = max(2, int((x1 - x0) / 0.25))
    for side in (-1.0, 1.0):
        nrm = Vector((0, 0, side))
        prev = None
        for i in range(n_seg + 1):
            x = lerp(x0, x1, i / n_seg)
            bul = 0.006 * blib.vnoise1(x * 3.0, seed + int(side * 5))
            z = side * (depth + bul)
            col = (0.75, step, 0.0, blib.FLAG_CHINK)
            a = Corner(Vector((x, y - h, z * 0.93)), (nrm + Vector((0, -0.6, 0))).normalized(), (x, 0.0), uv2, col)
            b = Corner(Vector((x, y, z)), nrm.copy(), (x, h), uv2, (0.85, step, 0.0, blib.FLAG_CHINK))
            c = Corner(Vector((x, y + h, z * 0.93)), (nrm + Vector((0, 0.6, 0))).normalized(), (x, 2 * h), uv2, col)
            row = [a, b, c]
            if prev:
                soup.add([prev[0], row[0], row[1], prev[1]], "log")
                soup.add([prev[1], row[1], row[2], prev[2]], "log")
            prev = row


def wall(kind, parity, seed):
    """kind: 'wall' | 'window' | 'door'. Returns Soup."""
    s = Soup()
    courses = course_list(parity)
    n = len(courses)
    door_top = DOOR_H
    win_lo, win_hi = (0.82, 1.61) if parity == "even" else (0.685, 1.475)
    cut_w = DOOR_W * 0.5 if kind == "door" else WIN_W * 0.5

    def in_opening_bottom(bottom, top):
        if kind == "door":
            return bottom < door_top - 0.01
        if kind == "window":
            return win_lo - 0.05 < (bottom + top) * 0.5 < win_hi + 0.05
        return False

    for i, (y, ck) in enumerate(courses):
        step = i / max(1, n - 1)
        sd = seed * 100 + i
        bottom = y if ck == "half_down" else y - LOG_R
        top = y if ck == "half_up" else y + LOG_R
        cs = Soup()
        if in_opening_bottom(bottom, top):
            _log_course(cs, y, ck, -HALF, -cut_w, sd, step, cap0=True, cap1=True)
            _log_course(cs, y, ck, cut_w, HALF, sd + 50, step, cap0=True, cap1=True)
        else:
            _log_course(cs, y, ck, -HALF, HALF, sd, step, cap0=True, cap1=True)
        _grime(cs, y)
        s.extend(cs)
        if i < n - 1:
            yc = (y + courses[i + 1][0]) * 0.5
            split = (kind == "door" and yc < door_top) or (kind == "window" and win_lo - 0.02 < yc < win_hi + 0.02)
            if split:
                _chink(s, -HALF, -cut_w, yc, step, seed=sd)
                _chink(s, cut_w, HALF, yc, step, seed=sd + 1)
            else:
                _chink(s, -HALF, HALF, yc, step, seed=sd)
    if kind == "door":
        _door_frame(s, parity, seed)
    if kind == "window":
        _window_frame(s, win_lo, win_hi, seed)
    return s


def _door_frame(s, parity, seed):
    w = DOOR_W * 0.5
    depth = 0.30
    top = DOOR_H
    for side in (-1, 1):
        board(s, (side * (w + 0.03), top * 0.5, 0.0), (0.06, top, depth), seed=seed + side, grain_axis=1,
              step=0.4, weather=0.45, ao_bottom=0.0)
    board(s, (0.0, top + 0.035, 0.0), (DOOR_W + 0.12, 0.07, depth), seed=seed + 7, grain_axis=0, step=0.8, weather=0.45)
    if parity == "odd":
        # header block filling the higher odd opening down to the common door height
        board(s, (0.0, top + 0.07 + 0.03, 0.0), (DOOR_W + 0.02, 0.07, depth - 0.02), seed=seed + 8, grain_axis=0,
              step=0.85, weather=0.4)
    # worn split-log threshold
    log(s, (-w - 0.02, 0.0, 0.0), (w + 0.02, 0.0, 0.0), 0.075, seed=seed + 9, profile="half", flat_face=(0, 1, 0),
        step=0.1, bark=0.0, sides=10)


def _window_frame(s, lo, hi, seed):
    w = WIN_W * 0.5
    depth = 0.30
    h = hi - lo
    for side in (-1, 1):
        board(s, (side * (w + 0.03), (lo + hi) * 0.5, 0.0), (0.06, h + 0.1, depth), seed=seed + side, grain_axis=1,
              step=0.5, weather=0.45)
    board(s, (0.0, lo - 0.03, 0.02), (WIN_W + 0.16, 0.06, depth + 0.06), seed=seed + 3, grain_axis=0, step=0.35,
          weather=0.5)
    board(s, (0.0, hi + 0.03, 0.0), (WIN_W + 0.12, 0.06, depth), seed=seed + 4, grain_axis=0, step=0.7, weather=0.45)
    # a plank shutter, swung open flat against the outside wall (+Z face), hung on strap hinges
    sh = Soup()
    for i in range(4):
        x = -w + 0.1 + i * 0.2
        board(sh, (x, (lo + hi) * 0.5, 0.0), (0.19, h + 0.02, 0.03), seed=seed + 20 + i, grain_axis=1, step=0.9,
              weather=0.7)
    for yy in (lo + 0.12, hi - 0.12):
        board(sh, (0.0, yy, -0.028), (WIN_W - 0.04, 0.09, 0.025), seed=seed + 30 + int(yy * 10), grain_axis=0,
              step=0.9, weather=0.7)
    # rotate about the hinge (left jamb, outside face) by ~170 deg so it lies against the wall
    hinge = Vector((-w - 0.06, 0.0, 0.2))
    xf = Matrix.Translation(hinge) @ Matrix.Rotation(math.radians(-172), 4, 'Y') @ Matrix.Translation(-hinge) \
        @ Matrix.Translation(Vector((0.0, 0.0, 0.2)))
    s.extend(sh, xf)


def _grime(soup, y):
    """Splash and moss darkening on the lowest courses (baked into the AO channel)."""
    k = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.7, y))
    if k >= 0.999:
        return
    for corners, _m in soup.faces:
        for c in corners:
            c.col = (c.col[0] * k, c.col[1], c.col[2], c.col[3])


def wall_stub(parity, seed, length=0.32):
    """Log ends projecting past a corner node (the node is at x = 0, logs run toward +X)."""
    s = Soup()
    courses = course_list(parity)
    n = len(courses)
    for i, (y, ck) in enumerate(courses):
        rr = random.Random(seed * 100 + i)
        L = length * rr.uniform(0.78, 1.16)
        cs = Soup()
        _log_course(cs, y, ck, 0.0, L, seed * 100 + i, i / max(1, n - 1), cap0=False, cap1=True, bark=0.25)
        _grime(cs, y)
        s.extend(cs)
    return s


def gable(parity, shape, tier, seed):
    """Log infill between the plate and the roof underside on a wall under a roof piece's side.

    shape 'slope': roof underside rises from y = WALL_TOP + tier*RISE (x=-1) to + RISE (x=+1).
    shape 'peak' : rises to the ridge at x = 0 then falls again (a peak piece at `tier`)."""
    s = Soup()
    base = WALL_TOP + 0.02 + tier * ROOF_RISE
    if shape == "slope":
        y_max = base + ROOF_RISE
        planes = [(Vector((-ROOF_SLOPE, 1.0, 0.0)), base + ROOF_SLOPE * 1.0)]   # y - slope*(x+1) <= base
    else:
        y_max = base + ROOF_RISE * 0.5
        planes = [(Vector((-ROOF_SLOPE, 1.0, 0.0)), base + ROOF_SLOPE * 1.0),
                  (Vector((ROOF_SLOPE, 1.0, 0.0)), base + ROOF_SLOPE * 1.0)]
    courses = gable_courses(parity, y_max)
    n = len(courses)
    for i, (y, ck) in enumerate(courses):
        # skip courses that would be entirely above the roof
        lowest_top = min(base + ROOF_SLOPE * (x + 1.0) if shape == "slope" else base + ROOF_SLOPE * (1.0 - abs(x))
                         for x in (-1.0, 0.0, 1.0))
        top_here = max(base + ROOF_SLOPE * (x + 1.0) if shape == "slope" else base + ROOF_SLOPE * (1.0 - abs(x))
                       for x in (-1.0, 0.0, 1.0))
        if y - LOG_R * 0.5 > top_here:
            continue
        ls = Soup()
        _log_course(ls, y, ck, -HALF, HALF, seed * 100 + i, 0.2 + 0.8 * i / max(1, n), cap0=True, cap1=True, bark=0.3)
        for (pn, pd) in planes:
            nn = pn.normalized()
            dd = pd / pn.length
            segs = ls.clip(nn, dd)
            if segs:
                blib.cap_from_segments(ls, segs, nn, "log", (0.3, 0.7), (1.0, 0.2 + 0.8 * i / max(1, n), 0.0, 0.0),
                                       seed=seed * 7 + i)
        s.extend(ls)
        if i < n - 1:
            yc = (y + courses[i + 1][0]) * 0.5
            cs = Soup()
            _chink(cs, -HALF, HALF, yc, 0.2 + 0.8 * i / max(1, n), seed=seed * 3 + i)
            for (pn, pd) in planes:
                cs.clip(pn.normalized(), pd / pn.length - 0.02)
            s.extend(cs)
    return s


# ============================================================================================ decks

def foundation_deck(seed):
    """Puncheon floor: 7 split logs, flat face up at y = 0, running along Z across the sills."""
    s = Soup()
    for i in range(7):
        x = -HALF + DECK_R * (2 * i + 1)
        rr = random.Random(seed * 31 + i)
        r = DECK_R * rr.uniform(0.985, 1.0)
        log(s, (x, 0.0, -HALF), (x, 0.0, HALF), r, r, seed=seed * 31 + i, profile="half", flat_face=(0, 1, 0),
            bark=0.45, step=i / 6.0, sides=12, seg=0.4, wobble=0.003, bulge=0.012, ellipse=0.01,
            up_hint=Vector((0, 1, 0)))
    return s


def sill(seed):
    s = Soup()
    log(s, (-HALF, SILL_Y, 0.0), (HALF, SILL_Y, 0.0), SILL_R, SILL_R * 0.97, seed=seed, bark=0.5, sides=14, seg=0.34)
    return s


def post(length, seed):
    """Stilt post: top at y = 0, bottom at y = -length (scaled to fit by the structure)."""
    s = Soup()
    log(s, (0.0, 0.0, 0.0), (0.0, -length, 0.0), POST_R * 0.95, POST_R * 1.05, seed=seed, bark=0.55, sides=12,
        seg=0.4, up_hint=Vector((1, 0, 0)))
    return s


def brace(seed):
    """Diagonal stilt brace: a pole from x = -1 to +1 (stretched between two posts by the structure)."""
    s = Soup()
    log(s, (-HALF, 0.0, 0.0), (HALF, 0.0, 0.0), 0.075, 0.068, seed=seed, bark=0.7, sides=10, seg=0.4, wobble=0.015)
    return s


def footing(seed):
    s = Soup()
    stone(s, (0.0, 0.02, 0.0), 0.36, seed=seed, squash=(1.1, 0.42, 0.95), subdiv=2)
    return s


def floor_deck(seed):
    """Upper floor: boards on three half-log joists (top at y = 0, joists rest on the walls below)."""
    s = Soup()
    for j, x in enumerate((-0.66, 0.0, 0.66)):
        log(s, (x, -0.045, -HALF), (x, -0.045, HALF), 0.11, 0.11, seed=seed * 5 + j, profile="half",
            flat_face=(0, 1, 0), bark=0.35, step=j / 6.0, sides=10, seg=0.5, up_hint=Vector((0, 1, 0)))
    for i in range(8):
        x = -HALF + 0.125 + i * 0.25
        board(s, (x, -0.0225, 0.0), (0.245, 0.045, 2.0), seed=seed * 17 + i, grain_axis=2, step=0.4 + 0.6 * i / 7,
              weather=0.15, ao_bottom=0.45)
    return s


# ============================================================================================ roof

def _roof_y(x, shape, eave):
    if shape == "slope":
        return 0.02 + ROOF_SLOPE * (x + 1.0)
    return 0.02 + ROOF_SLOPE * (1.0 - abs(x))


def _shake_rows(shape, eave, variant, z0, z1):
    """Shake layout (list of boards) covering x in the piece (+ eave) and z in [z0, z1] (before clipping)."""
    rng = random.Random(1000 + variant * 77 + (0 if shape == "slope" else 500) + (3 if eave else 0))
    out = []
    ang = math.atan(ROOF_SLOPE)
    ca = math.cos(ang)
    exposure = 0.24
    length = 0.56
    sides = [1] if shape == "slope" else [1, -1]    # peak: two slopes mirrored about x = 0
    for side in sides:
        # along-slope parameter s from the eave (or low edge) to the ridge/high edge
        if shape == "slope":
            x_lo = -HALF - (EAVE if eave else 0.0)
            x_hi = HALF
        else:
            x_lo = -HALF - (EAVE if eave else 0.0)
            x_hi = 0.0
        s_len = (x_hi - x_lo) / ca
        rows = int(math.ceil(s_len / exposure)) + 1
        for r in range(rows):
            s_butt = r * exposure - (0.0 if not eave else 0.0)
            z = z0 - rng.uniform(0.0, 0.15)
            while z < z1 + 0.2:
                w = rng.uniform(0.11, 0.21)
                zc = z + w * 0.5
                L = length * rng.uniform(0.92, 1.05)
                out.append((side, s_butt, zc, w, L, rng.randint(0, 1 << 30), rng.uniform(-0.03, 0.03),
                            rng.uniform(0.012, 0.018)))
                z += w + rng.uniform(0.004, 0.012)
            # starter course: doubled at the eave
            if eave and r == 0:
                z = z0 - rng.uniform(0.0, 0.1)
                while z < z1 + 0.2:
                    w = rng.uniform(0.12, 0.2)
                    out.append((side, -0.015, z + w * 0.5, w, length * 0.7, rng.randint(0, 1 << 30), 0.0, 0.01))
                    z += w + 0.006
    return out


def roof(shape, eave, variant, region):
    """Roof piece. shape 'slope' | 'peak'; eave: tier-0 overhang; region 'main' | 'pz' | 'nz' (gable overhang)."""
    s = Soup()
    ang = math.atan(ROOF_SLOPE)
    ca, sa = math.cos(ang), math.sin(ang)
    if region == "main":
        z0, z1 = -HALF, HALF
    elif region == "pz":
        z0, z1 = HALF, HALF + GABLE_OVER
    else:
        z0, z1 = -HALF - GABLE_OVER, -HALF
    zr0, zr1 = -HALF - GABLE_OVER - 0.3, HALF + GABLE_OVER + 0.3
    sides = [1] if shape == "slope" else [1, -1]
    x_lo = -HALF - (EAVE if eave else 0.0)
    step_base = 0.0
    # --- purlin (slope: at the high edge x = +1) / ridge pole (peak: x = 0)
    px = HALF if shape == "slope" else 0.0
    py = _roof_y(px, shape, eave) - 0.12
    pz0, pz1 = (z0, z1) if region == "main" else ((HALF, HALF + GABLE_OVER + 0.12) if region == "pz" else (-HALF - GABLE_OVER - 0.12, -HALF))
    log(s, (px, py, pz0), (px, py, pz1), 0.12, 0.115, seed=variant * 13 + (1 if shape == "peak" else 0),
        bark=0.45, step=0.0, cap0=(region == "nz"), cap1=(region == "pz"), sides=12, seg=0.35,
        up_hint=Vector((0, 1, 0)))
    # --- sheathing boards running down the slope
    bs = Soup()
    for side in sides:
        x_end = HALF if shape == "slope" else 0.0
        if side == -1:
            # mirrored half of a peak
            pass
        run = (x_end - x_lo)
        slen = run / ca
        z = zr0
        k = 0
        rngb = random.Random(variant * 101 + side)
        while z < zr1:
            w = rngb.uniform(0.2, 0.27)
            zc = z + w * 0.5
            mid_x = (x_lo + x_end) * 0.5
            y = _roof_y(mid_x, "slope", eave) if shape == "slope" else 0.02 + ROOF_SLOPE * (mid_x + 1.0)
            rot = Matrix.Rotation(ang, 3, 'Z')
            cen = Vector((mid_x, y + 0.0125 / ca, zc))
            if side == -1:
                cen = Vector((-mid_x, y + 0.0125 / ca, zc))
                rot = Matrix.Rotation(-ang, 3, 'Z')
            board(bs, cen, (slen, 0.025, w - 0.006), rot, seed=variant * 1000 + k + (500 if side < 0 else 0),
                  grain_axis=0, step=0.1, weather=0.1, ao_bottom=0.1, bevel=0.0)
            z += w
            k += 1
    # --- shakes
    for (side, s_butt, zc, w, L, sd, tw, th) in _shake_rows(shape, eave, variant, zr0, zr1):
        # along-slope centre of this shake
        sc = s_butt + L * 0.5
        x = x_lo + sc * ca
        y = 0.02 + (x - (-HALF)) * ROOF_SLOPE if True else 0.0
        y = 0.02 + ROOF_SLOPE * (x + 1.0)
        tilt = ang - 0.02
        rot = Matrix.Rotation(tilt, 3, 'Z') @ Matrix.Rotation(tw, 3, 'Y')
        # the butt rests on the course below, so shakes lie a touch flatter than the roof
        cen = Vector((x, y + 0.025 / ca + th * 0.5 + 0.009, zc))
        if side == -1:
            cen.x = -cen.x
            rot = Matrix.Rotation(-tilt, 3, 'Z') @ Matrix.Rotation(-tw, 3, 'Y')
        sh = Soup()
        # grain along local -X (toward the butt at the bottom); taper so the upper end is thin
        board(sh, cen, (L, th, w), rot, seed=sd, grain_axis=0, step=min(1.0, 0.2 + 0.8 * sc / 2.6),
              weather=0.85, ao_bottom=0.5, bevel=0.0)
        if shape == "peak":
            # each slope's top course stops at the ridge (the ridge cap covers the joint)
            n_side = Vector((float(side), 0.0, 0.0))
            segs = sh.clip(n_side, 0.015)
            if segs:
                blib.cap_from_segments(sh, segs, n_side, "planks", (0.2, 0.9), (0.9, 0.5, 0.8, blib.FLAG_WOOD))
        bs.extend(sh)
    # clip everything to the region (z) and to the piece's x range
    def clip_plane(sp, n, d):
        segs = sp.clip(n, d)
        if segs:
            blib.cap_from_segments(sp, segs, n, "planks", (0.2, 0.9), (0.9, 0.5, 0.8, blib.FLAG_WOOD))
    clip_plane(bs, Vector((0, 0, 1)), z1)
    clip_plane(bs, Vector((0, 0, -1)), -z0)
    if shape == "slope":
        clip_plane(bs, Vector((1, 0, 0)), HALF)
    s.extend(bs)
    # ridge cap on a peak: two boards forming an inverted V
    if shape == "peak":
        _ridge_cap(s, z0, z1, variant, base_y=_roof_y(0.0, "peak", eave))
    return s


def _ridge_cap(s, z0, z1, variant, base_y, x=0.0):
    ang = math.atan(ROOF_SLOPE)
    ca = math.cos(ang)
    for side in (1, -1):
        rot = Matrix.Rotation(-side * ang, 3, 'Z')
        cen = Vector((x + side * 0.1 * ca, base_y + 0.085 - 0.1 * math.sin(ang), (z0 + z1) * 0.5))
        board(s, cen, (0.24, 0.028, z1 - z0), rot, seed=variant * 3 + side, grain_axis=2, step=1.0, weather=0.9,
              bevel=0.004)


def ridge_cap(region, variant):
    """Cap for two slope pieces meeting high edge to high edge (placed on the shared edge, x = 0)."""
    s = Soup()
    if region == "main":
        z0, z1 = -HALF, HALF
    elif region == "pz":
        z0, z1 = HALF, HALF + GABLE_OVER
    else:
        z0, z1 = -HALF - GABLE_OVER, -HALF
    _ridge_cap(s, z0, z1, variant, base_y=0.02 + ROOF_RISE, x=0.0)
    return s


# ============================================================================================ misc structure

def stairs(seed):
    """Two log stringers and split-log treads: rises 2.6 m over 4 m toward +X, bottom edge at x = -1."""
    s = Soup()
    rise = LEVEL_H
    run = 2.0 * CELL
    n = 13
    ang = math.atan2(rise, run)
    for side in (-1, 1):
        z = side * 0.58
        log(s, (-HALF, 0.05, z), (-HALF + run, rise - 0.05, z), 0.1, 0.095, seed=seed + side * 3, bark=0.4,
            sides=12, seg=0.4)
    for i in range(n):
        t = (i + 0.5) / n
        x = -HALF + run * t
        y = rise * (i + 1) / n - 0.06
        log(s, (x, y, -0.66), (x, y, 0.66), 0.1, 0.1, seed=seed * 50 + i, profile="half", flat_face=(0, 1, 0),
            bark=0.3, step=i / (n - 1), sides=10, seg=0.5)
    return s


def pillar(seed):
    s = Soup()
    log(s, (0.0, 0.0, 0.0), (0.0, WALL_TOP, 0.0), 0.14, 0.13, seed=seed, bark=0.35, sides=14, seg=0.4,
        up_hint=Vector((1, 0, 0)))
    stone(s, (0.0, -0.03, 0.0), 0.2, seed=seed + 1, squash=(1.1, 0.35, 1.0))
    return s


def railing(seed):
    s = Soup()
    for i, x in enumerate((-0.92, 0.92)):
        log(s, (x, 0.0, 0.0), (x, 1.02, 0.0), 0.06, 0.055, seed=seed + i, bark=0.5, sides=10, seg=0.4,
            up_hint=Vector((1, 0, 0)), step=0.2)
    log(s, (-HALF, 0.98, 0.0), (HALF, 0.98, 0.0), 0.055, 0.05, seed=seed + 5, bark=0.5, sides=10, seg=0.4, step=0.7)
    log(s, (-HALF, 0.5, 0.0), (HALF, 0.5, 0.0), 0.045, 0.045, seed=seed + 6, bark=0.6, sides=8, seg=0.4, step=0.5)
    blib.lashing(s, (-0.92, 0.98, 0.0), (1, 0, 0), (0, 1, 0), 0.055, 0.06, wraps=3, seed=seed, step=0.9)
    blib.lashing(s, (0.92, 0.98, 0.0), (1, 0, 0), (0, 1, 0), 0.055, 0.06, wraps=3, seed=seed + 1, step=0.9)
    return s


def door_leaf(seed):
    """Plank door hinged at x = 0 (leaf extends to +X), bottom at y = 0.01, faces +Z (outside)."""
    s = Soup()
    W = DOOR_W - 0.02
    H = DOOR_H - 0.02
    nb = 5
    bw = W / nb
    for i in range(nb):
        board(s, (bw * (i + 0.5), 0.01 + H * 0.5, 0.0), (bw - 0.006, H, 0.04), seed=seed + i, grain_axis=1,
              step=i / nb, weather=0.55)
    # battens + diagonal brace on the inside (-Z)
    for yy in (0.3, H - 0.3):
        board(s, (W * 0.5, yy, -0.035), (W - 0.1, 0.12, 0.03), seed=seed + int(yy * 100), grain_axis=0, step=1.0,
              weather=0.5)
    brace_len = math.hypot(W - 0.2, H - 0.72)
    ang = math.atan2(H - 0.72, W - 0.2)
    board(s, (W * 0.5, H * 0.5, -0.035), (brace_len, 0.1, 0.028), Matrix.Rotation(ang, 3, 'Z'), seed=seed + 99,
          grain_axis=0, step=1.0, weather=0.5)
    # leather strap hinges
    for yy in (0.3, H - 0.3):
        board(s, (0.18, yy, 0.024), (0.36, 0.05, 0.006), seed=seed + 7, mat="hide", grain_axis=0, step=1.0)
        log(s, (0.0, yy - 0.04, 0.0), (0.0, yy + 0.04, 0.0), 0.022, 0.022, seed=seed + 8, bark=0.0, sides=8,
            up_hint=Vector((1, 0, 0)), step=1.0, mat="hide")
    # carved wooden handle + latch bar
    log(s, (W - 0.13, 1.0, 0.03), (W - 0.13, 1.16, 0.03), 0.02, 0.02, seed=seed + 11, bark=0.0, sides=8,
        up_hint=Vector((1, 0, 0)), step=1.0)
    for yy in (0.99, 1.17):
        board(s, (W - 0.13, yy, 0.03 - 0.01), (0.03, 0.03, 0.045), seed=seed + 12, grain_axis=2, step=1.0)
    board(s, (W - 0.1, 1.05, -0.05), (0.32, 0.04, 0.025), seed=seed + 13, grain_axis=0, step=1.0, weather=0.3)
    return s

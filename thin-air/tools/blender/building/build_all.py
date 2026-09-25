"""Builds every building-piece .glb into assets/models/building/.

    blender -b -P thin-air/tools/blender/building/build_all.py -- [--only walls,roof,...] [--stats]

Deterministic (all randomness is seeded). Families -> files:
  walls.glb       wall/window/door bodies (even/odd courses, 2 plain variants) + corner stubs
  gables.glb      gable infill under roof ends (slope t0..t2, peak t0..t1, even/odd)
  roof.glb        roof slope / peak (with and without eave, 2 variants) + gable-end overhang strips + ridge caps
  foundation.glb  puncheon deck (2 variants), sill, stilt posts (3 lengths), footing stone
  misc.glb        upper floor, stairs, pillar, railing, door leaf
  camp_*.glb      free-placed camp pieces (see pieces_camp.py)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import blib  # noqa: E402
import pieces_structure as ps  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "assets", "models", "building")


def fam_walls():
    out = {}
    for parity in ("even", "odd"):
        for v, seed in (("a", 11), ("b", 23)):
            out["wall_%s_%s" % (parity, v)] = ps.wall("wall", parity, seed + (0 if parity == "even" else 100))
        out["window_%s" % parity] = ps.wall("window", parity, 37 + (0 if parity == "even" else 100))
        out["doorway_%s" % parity] = ps.wall("door", parity, 41 + (0 if parity == "even" else 100))
        out["stub_%s" % parity] = ps.wall_stub(parity, 53 + (0 if parity == "even" else 100))
    return out


def fam_gables():
    out = {}
    for parity in ("even", "odd"):
        po = 0 if parity == "even" else 100
        for t in range(3):
            out["gable_slope_t%d_%s" % (t, parity)] = ps.gable(parity, "slope", t, 61 + t + po)
        for t in range(2):
            out["gable_peak_t%d_%s" % (t, parity)] = ps.gable(parity, "peak", t, 71 + t + po)
    return out


def fam_roof():
    out = {}
    for shape in ("slope", "peak"):
        for eave in (False, True):
            for v in (0, 1):
                base = "roof_%s%s_%s" % (shape, "_eave" if eave else "", "ab"[v])
                for region in ("main", "pz", "nz"):
                    name = base if region == "main" else base + "_" + region
                    out[name] = ps.roof(shape, eave, v, region)
    for region in ("main", "pz", "nz"):
        out["ridge_cap" if region == "main" else "ridge_cap_" + region] = ps.ridge_cap(region, 3)
    return out


def fam_foundation():
    out = {"deck_a": ps.foundation_deck(5), "deck_b": ps.foundation_deck(9), "sill": ps.sill(13)}
    for name, L, sd in (("post_s", 0.8, 17), ("post_m", 1.6, 19), ("post_l", 3.2, 29)):
        out[name] = ps.post(L, sd)
    out["footing"] = ps.footing(31)
    return out


def fam_misc():
    return {"floor": ps.floor_deck(7), "stairs": ps.stairs(3), "pillar": ps.pillar(43), "railing": ps.railing(47),
            "door_leaf": ps.door_leaf(59)}


FAMILIES = {
    "walls": fam_walls,
    "gables": fam_gables,
    "roof": fam_roof,
    "foundation": fam_foundation,
    "misc": fam_misc,
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    stats = "--stats" in argv
    for a in argv:
        if a.startswith("--only="):
            only = a.split("=", 1)[1].split(",")
    try:
        import pieces_camp
        FAMILIES.update(pieces_camp.FAMILIES)
    except ImportError as e:
        print("pieces_camp not available:", e)
    os.makedirs(OUT, exist_ok=True)
    for fam, fn in FAMILIES.items():
        if only and fam not in only:
            continue
        t0 = time.time()
        blib.clear_scene()
        parts = fn()
        objs = []
        tris = 0
        for name, soup in parts.items():
            tris += soup.tri_count()
            if stats:
                print("   %-28s %6d tris" % (name, soup.tri_count()))
            objs.append(blib.to_object(name, soup))
        path = os.path.join(OUT, fam + ".glb")
        blib.export_glb(path, objs)
        print("[building] %-12s %3d meshes %7d tris  %.1fs -> %s" % (fam, len(objs), tris, time.time() - t0, path))


main()

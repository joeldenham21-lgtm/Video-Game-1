"""Build fauna models: blender -b -P tools/blender/fauna/build_fauna.py -- wolf deer ... [--preview=DIR]
Writes assets/models/fauna/<sp>.glb + <sp>.json and assets/textures/fauna/<sp>_albedo.png (+ fur_strands.png)."""
import os
import sys
import importlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import flib  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
preview = None
names = []
for a in argv:
    if a.startswith("--preview="):
        preview = a.split("=", 1)[1]
    else:
        names.append(a)
if not names:
    names = ["wolf"]
os.makedirs(flib.TEX_DIR, exist_ok=True)
if "strands" in names or not os.path.exists(os.path.join(flib.TEX_DIR, "fur_strands.png")):
    flib.strand_texture(os.path.join(flib.TEX_DIR, "fur_strands.png"))
    names = [n for n in names if n != "strands"]
for n in names:
    if n == "birds":
        importlib.import_module("sp_birds").build_all()
        continue
    mod = importlib.import_module("sp_" + n)
    obj, arm = flib.build_creature(mod.SPEC)
    if preview:
        os.makedirs(preview, exist_ok=True)
        L = mod.SPEC.get("preview_scale", 1.0)
        shots = mod.SPEC.get("preview", [("idle", 0), ("walk", 7), ("trot", 4), ("gallop", 3), ("stalk", 10),
                                          ("howl", 60), ("attack", 14), ("death", 50)])
        for clip, fr in shots:
            flib.preview_render(obj, arm, os.path.join(preview, "%s_%s.png" % (n, clip)), clip, fr,
                                cam_loc=(2.6 * L, -0.3 * L, 0.75 * L), target=(0, -0.05 * L, 0.5 * L), lens=45)
        hd = mod.SPEC.get("head_view", ((0.75, 1.45, 0.95), (0.0, 0.55, 0.78)))
        flib.preview_render(obj, arm, os.path.join(preview, "%s_head.png" % n), "idle", 0, cam_loc=hd[0],
                            target=hd[1], lens=50)

"""THIN AIR props — build driver (Blender 4.x, headless, deterministic).

    blender -b -P thin-air/tools/blender/props/build.py -- --set=arms|items|fp|props|all [--only=id,id]
                                                          [--preview=/abs/dir]

  arms   -> assets/models/fp/arms.glb                    (posed gloved hands, see arms.py)
  items  -> assets/models/items/<id>.glb                 (world/pickup/icon models, lying on y = 0, centred)
  fp     -> assets/models/fp/<id>.glb                    (first-person frames of the held tools)
  props  -> assets/models/props/<id>.glb + scenes/props/<id>.tscn (world props with collision)

Every glb gets a minimal .import that runs scenes/props/prop_import.gd (binds the item material library).
--preview renders a quick Cycles lineup of what was built (QA only).
"""
import importlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPTS = {}
for a in argv:
    k, _, v = a.lstrip("-").partition("=")
    OPTS[k] = v or "1"
SET = OPTS.get("set", "all")
ONLY = [x for x in OPTS.get("only", "").split(",") if x]
MODELS = os.path.join(C.ROOT, "assets", "models")
REPORT = os.path.join(HERE, "_report.json")


def _load_report():
    if os.path.exists(REPORT):
        with open(REPORT) as f:
            return json.load(f)
    return {}


def _save_report(r):
    with open(REPORT, "w") as f:
        json.dump(r, f, indent=1, sort_keys=True)


def run_arms(report):
    import arms
    importlib.reload(arms)
    C.reset()
    objs = arms.build_all(None, ONLY or None)
    path = os.path.join(MODELS, "fp", "arms.glb")
    if not ONLY:
        C.export_glb(objs, path)
    report["fp/arms"] = {"tris": C.tris(objs), "nodes": [o.name for o in objs]}
    if "preview" in OPTS:
        for i, o in enumerate(objs):      # side by side for the QA render only (after export)
            o.location.x = (i % 4) * 0.16
            o.location.z = -(i // 4) * 0.16
    return objs


def run_registry(kind, report):
    """items / fp / props: modules register builders with lib.registry."""
    from lib import registry
    for mod in ("models_tools", "models_items", "models_props"):   # registration side effects
        try:
            importlib.import_module(mod)
        except ModuleNotFoundError as e:
            if e.name != mod:
                raise
    out = []
    for mid, fn in sorted(registry.MODELS[kind].items()):
        if ONLY and mid not in ONLY:
            continue
        C.reset()
        res = fn()
        objs = res["objects"]
        path = os.path.join(MODELS, kind, mid + ".glb")
        C.export_glb(objs, path)
        lo, hi = C.gd_bounds(objs)
        entry = {"tris": C.tris(objs), "size": [round(hi[i] - lo[i], 4) for i in range(3)],
                 "min": [round(lo[i], 4) for i in range(3)]}
        for k in ("sockets", "collision", "body", "mass"):
            if k in res:
                entry[k] = res[k]
        report["%s/%s" % (kind, mid)] = entry
        print("  %s/%s: %d tris, size %s" % (kind, mid, entry["tris"], entry["size"]))
        if kind == "props":
            registry.write_prop_scene(mid, entry)
        out.append((mid, objs))
    return out


def preview(built, out_dir):
    """Quick Cycles lineup render of the built objects (for QA)."""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.view_settings.view_transform = "AgX" if "AgX" in [e.identifier for e in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 600
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.52, 0.55, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    scene.collection.objects.link(sun)
    bpy.context.view_layer.update()
    objs = [o for o in scene.objects if o.type == "MESH"]
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    ctr = (lo + hi) * 0.5
    size = max((hi - lo).length, 0.05)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    d = Vector([float(x) for x in OPTS.get("view", "0.9,-1.4,0.9").split(",")]).normalized()
    cam.location = ctr + d * size * float(OPTS.get("dist", "1.6"))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(out_dir, "preview_%s.png" % SET)
    bpy.ops.render.render(write_still=True)


def main():
    report = _load_report()
    built = []
    if SET in ("arms", "all"):
        run_arms(report)
    for kind in ("fp", "items", "props"):
        if SET in (kind, "all"):
            built += run_registry(kind, report)
    _save_report(report)
    if "preview" in OPTS:
        preview(built, OPTS["preview"])


main()

"""THIN AIR props — shared Blender helpers: scene reset, library-named materials, finishing and glTF export.

Materials: every surface is named after a key of the item material library
(scenes/items/materials/materials.json). The glb carries only that NAME (a flat placeholder colour), no
textures; Godot's post-import script (scenes/props/prop_import.gd) swaps in the real ItemMaterials material and
the icon renderer (tools/icons/render_icons.py) rebuilds it from the same JSON. UVs are metric (1 unit = 1 m)
except label parts (0..1), exactly as the procedural ItemVisuals models.
"""
import json
import math
import os

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROPS = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(PROPS, "..", "..", ".."))          # thin-air/
MATDEF = os.path.join(ROOT, "scenes", "items", "materials", "materials.json")
IMPORT_SCRIPT = "res://scenes/props/prop_import.gd"

with open(MATDEF) as _f:
    LIB = {k: v for k, v in json.load(_f).items() if not k.startswith("_")}


def _resolve(key):
    d = LIB.get(key)
    if d is None:
        return {}
    if "base" in d:
        m = dict(_resolve(d["base"]))
        m.update({k: v for k, v in d.items() if k != "base"})
        return m
    return dict(d)


def reset():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


_warned = set()


def mat(key):
    """Placeholder material named after a library key (viewport/base colour from the library tint)."""
    if key not in LIB and key not in _warned:
        _warned.add(key)
        print("WARNING: material key '%s' is not in materials.json" % key)
    m = bpy.data.materials.get(key)
    if m is None:
        m = bpy.data.materials.new(key)
        d = _resolve(key)
        t = d.get("tint", [0.6, 0.6, 0.6])
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in t[:3]]
        m.diffuse_color = (lin[0], lin[1], lin[2], 1.0)
        m.roughness = float(d.get("roughness", 0.7))
        m.metallic = float(d.get("metallic", 0.0)) if not d.get("orm") else 0.0
    return m


def finish(ob, smooth_angle=40.0, keep_atlas=False):
    """Drops the atlas UV set (no bake), names the metric set UVMap, sets auto-smooth normals."""
    me = ob.data
    if not keep_atlas and "atlas" in me.uv_layers:
        me.uv_layers.remove(me.uv_layers["atlas"])
    if "tile" in me.uv_layers:
        me.uv_layers["tile"].name = "UVMap"
    if "mask" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["mask"])
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(smooth_angle)
    return ob


def tris(objs):
    n = 0
    for o in objs:
        if o.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def export_glb(objs, path):
    """Exports the given objects (and their children) to a .glb (Y up, applied modifiers, no textures)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    sel = []
    for o in objs:
        sel.append(o)
        sel.extend(o.children_recursive)
    for o in sel:
        o.select_set(True)
    bpy.context.view_layer.objects.active = sel[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_colors=False, export_attributes=False, export_extras=False, export_cameras=False,
        export_lights=False, export_animations=False, export_skins=False, export_morph=False,
        export_image_format="NONE" if _has_image_none() else "AUTO")
    write_import(path)


def _has_image_none():
    try:
        props = bpy.ops.export_scene.gltf.get_rna_type().properties["export_image_format"]
        return "NONE" in [e.identifier for e in props.enum_items]
    except Exception:
        return False


def write_import(glb_path, extra_params=""):
    """Writes a minimal .import next to a new glb so Godot runs the material post-import script (Godot fills
    in every other parameter with its defaults on the first import). Existing .import files are patched."""
    imp = glb_path + ".import"
    if os.path.exists(imp):
        txt = open(imp).read()
        if IMPORT_SCRIPT in txt:
            return
        if 'import_script/path=""' in txt:
            txt = txt.replace('import_script/path=""', 'import_script/path="%s"' % IMPORT_SCRIPT)
            open(imp, "w").write(txt)
            return
    with open(imp, "w") as f:
        f.write('[remap]\n\nimporter="scene"\nimporter_version=1\ntype="PackedScene"\n\n[params]\n\n')
        f.write('import_script/path="%s"\n' % IMPORT_SCRIPT)
        f.write('meshes/generate_lods=true\nmeshes/create_shadow_meshes=true\nmeshes/light_baking=0\n')
        f.write(extra_params)


# ------------------------------------------------------------------------------ Godot-space helpers
C_GD2BL = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def socket(name, gd_pos, gd_basis=None, parent=None):
    """An empty (exported as a Node3D) at a Godot-space position/basis, parented to `parent`."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    m = Matrix.Translation(Vector(gd_pos))
    if gd_basis is not None:
        m = m @ Matrix(gd_basis).to_4x4()
    e.matrix_world = C_GD2BL @ m @ C_GD2BL.inverted()
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        mw = e.matrix_world.copy()
        e.parent = parent
        e.matrix_world = mw
    return e


def gd_transform_object(ob, gd_matrix):
    """Applies a Godot-space 4x4 transform to an object's mesh data."""
    ob.data.transform(C_GD2BL @ Matrix(gd_matrix) @ C_GD2BL.inverted())
    ob.data.update()


def gd_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            g = Vector((w.x, w.z, -w.y))
            lo = Vector((min(lo.x, g.x), min(lo.y, g.y), min(lo.z, g.z)))
            hi = Vector((max(hi.x, g.x), max(hi.y, g.y), max(hi.z, g.z)))
    return lo, hi

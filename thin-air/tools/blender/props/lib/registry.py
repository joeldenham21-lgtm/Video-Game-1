"""Model registry + helpers shared by models_*.py, and the world-prop scene writer.

Builders are plain functions returning {"objects": [bpy objects], optional "collision": [...], "body": "static" |
"rigid", "mass": kg, "sockets": {...}}. Geometry is authored in Godot space with lib.geo.MB and converted with
`obj()`; `lay_item()` turns a tool authored in its first-person frame into the lying world/pickup pose.
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

from . import common as C
from .geo import MB

MODELS = {"items": {}, "fp": {}, "props": {}}


def item(*ids):
    def deco(fn):
        for i in ids:
            MODELS["items"][i] = (lambda i=i: fn(i)) if fn.__code__.co_argcount else fn
        return fn
    return deco


def fp(*ids):
    def deco(fn):
        for i in ids:
            MODELS["fp"][i] = (lambda i=i: fn(i)) if fn.__code__.co_argcount else fn
        return fn
    return deco


def prop(*ids):
    def deco(fn):
        for i in ids:
            MODELS["props"][i] = (lambda i=i: fn(i)) if fn.__code__.co_argcount else fn
        return fn
    return deco


# ------------------------------------------------------------------------------------------- objects

def obj(mb, name, smooth_angle=35.0, bevel=0.0, bevel_segments=2, subsurf=0, weighted=False):
    """MB -> finished Blender object (optional bevel / subdivision / weighted normals, applied)."""
    ob = mb.to_object(name, C.mat, smooth_angle=smooth_angle)
    if bevel > 0.0:
        md = ob.modifiers.new("bevel", "BEVEL")
        md.width = bevel
        md.segments = bevel_segments
        md.limit_method = "ANGLE"
        md.angle_limit = math.radians(35.0)
        md.harden_normals = False
    if subsurf:
        md = ob.modifiers.new("subsurf", "SUBSURF")
        md.levels = subsurf
        md.render_levels = subsurf
    if weighted:
        md = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
        md.keep_sharp = True
    if ob.modifiers:
        apply(ob)
    C.finish(ob, smooth_angle)
    return ob


def apply(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = ob.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    for o in objs:
        C.finish(o)
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    target = objs[0]
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def xform(objs, gd_matrix):
    for o in objs:
        if o.type == "MESH":
            C.gd_transform_object(o, gd_matrix)


def rest_on_ground(objs, center_xz=True):
    """Moves meshes so the lowest point is y = 0 and (optionally) the XZ bounds are centred."""
    lo, hi = C.gd_bounds(objs)
    off = Vector((-(lo.x + hi.x) * 0.5 if center_xz else 0.0, -lo.y, -(lo.z + hi.z) * 0.5 if center_xz else 0.0))
    xform(objs, Matrix.Translation(off))


# fp frame (handle +Y from the butt, blade/business end -Z, flat faces +-X) -> lying on the ground:
# handle along +X, flat side up.
FP_TO_LYING = Matrix(((0, 1, 0, 0), (1, 0, 0, 0), (0, 0, -1, 0), (0, 0, 0, 1)))


def lay_item(objs, extra=None):
    xform(objs, FP_TO_LYING if extra is None else Matrix(extra) @ FP_TO_LYING)
    rest_on_ground(objs)
    return objs


def rot(axis, deg):
    ax = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[axis] if isinstance(axis, str) else axis
    return Matrix.Rotation(math.radians(deg), 4, Vector(ax))


def T(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


# ------------------------------------------------------------------------------------------- prop scenes

SCENES = os.path.join(C.ROOT, "scenes", "props")


def _fmt(v):
    return "%.5g" % v


def _basis_str(yaw_deg=0.0, pitch_deg=0.0, roll_deg=0.0):
    m = (rot("Y", yaw_deg) @ rot("X", pitch_deg) @ rot("Z", roll_deg)).to_3x3()
    # Godot Transform3D(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz): columns x, y, z
    cols = [m.col[0], m.col[1], m.col[2]]
    return ", ".join(_fmt(c[i]) for c in cols for i in range(3))


def write_prop_scene(pid, entry):
    """scenes/props/<id>.tscn: StaticBody3D (layer 1) or RigidBody3D (layer 4 physics prop) + model + shapes."""
    os.makedirs(SCENES, exist_ok=True)
    body = entry.get("body", "static")
    shapes = entry.get("collision") or [{"type": "box", "size": entry["size"],
                                         "pos": [entry["min"][0] + entry["size"][0] * 0.5,
                                                 entry["min"][1] + entry["size"][1] * 0.5,
                                                 entry["min"][2] + entry["size"][2] * 0.5]}]
    lines = ['[gd_scene load_steps=%d format=3]' % (2 + len(shapes)), '',
             '[ext_resource type="PackedScene" path="res://assets/models/props/%s.glb" id="1_model"]' % pid, '']
    for i, s in enumerate(shapes):
        if s["type"] == "box":
            lines += ['[sub_resource type="BoxShape3D" id="shape_%d"]' % i,
                      'size = Vector3(%s)' % ", ".join(_fmt(x) for x in s["size"]), '']
        elif s["type"] == "cylinder":
            lines += ['[sub_resource type="CylinderShape3D" id="shape_%d"]' % i,
                      'height = %s' % _fmt(s["height"]), 'radius = %s' % _fmt(s["radius"]), '']
        elif s["type"] == "sphere":
            lines += ['[sub_resource type="SphereShape3D" id="shape_%d"]' % i, 'radius = %s' % _fmt(s["radius"]), '']
    name = "".join(p.capitalize() for p in pid.split("_"))
    if body == "rigid":
        lines += ['[node name="%s" type="RigidBody3D"]' % name,
                  'collision_layer = 8', 'collision_mask = 585',
                  'mass = %s' % _fmt(entry.get("mass", 5.0)), 'can_sleep = true', 'sleeping = true', '']
    else:
        lines += ['[node name="%s" type="StaticBody3D"]' % name, 'collision_layer = 1', 'collision_mask = 0', '']
    lines += ['[node name="Model" parent="." instance=ExtResource("1_model")]', '']
    for i, s in enumerate(shapes):
        p = s.get("pos", [0, 0, 0])
        lines += ['[node name="Shape%d" type="CollisionShape3D" parent="."]' % i,
                  'transform = Transform3D(%s, %s)' % (_basis_str(s.get("yaw", 0.0), s.get("pitch", 0.0),
                                                                   s.get("roll", 0.0)),
                                                       ", ".join(_fmt(x) for x in p)),
                  'shape = SubResource("shape_%d")' % i, '']
    with open(os.path.join(SCENES, pid + ".tscn"), "w") as f:
        f.write("\n".join(lines))

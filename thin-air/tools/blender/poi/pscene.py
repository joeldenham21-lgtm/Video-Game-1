"""THIN AIR — POI export: material library variants (.tres), glb .import remaps, inherited .tscn scenes.

Material names used by the Blender scripts map 1:1 to assets/models/poi/materials/<name>.tres (ShaderMaterials on
assets/models/poi/shaders/*.gdshader that reuse the shared texture library in assets/textures/). The glb's
.import file remaps every glTF material to those .tres files, so the glb itself carries geometry only.
"""
import json
import math
import os

import plib
from plib import ROOT, OUT_MODELS, OUT_SCENES, gd_transform, _f

MAT_DIR = os.path.join(OUT_MODELS, "materials")
RES_MAT = "res://assets/models/poi/materials/%s.tres"
RES_SH = "res://assets/models/poi/shaders/%s.gdshader"
NOISE = "res://assets/models/poi/textures/poi_noise.png"
DECALS = "res://assets/models/poi/textures/poi_decals_albedo.png"

_LOGS = json.load(open(os.path.join(ROOT, "data", "logs.json")))
_LIBJ = json.load(open(os.path.join(ROOT, "assets", "materials", "materials.json")))
_TERJ = {d["name"]: d for d in json.load(open(os.path.join(ROOT, "assets", "textures", "terrain", "layers.json")))}


def lib(name, **kw):
    j = _LIBJ[name]
    d = dict(kind="surface", albedo="res://assets/textures/%s/%s_albedo.png" % (name, name),
             orm="res://assets/textures/%s/%s_orm.png" % (name, name),
             normal="res://assets/textures/%s/%s_normal.png" % (name, name),
             uv=tuple(j.get("uv1_scale", [1.0, 1.0])[:2]))
    d.update(kw)
    return d


def ter(name, **kw):
    t = 1.0 / _TERJ[name]["tiling_m"]
    d = dict(kind="surface", albedo="res://assets/textures/terrain/%s_albedo.png" % name,
             orm="res://assets/textures/terrain/%s_roughness.png" % name,
             normal="res://assets/textures/terrain/%s_normal.png" % name, uv=(t, t), orm_is_rough=True)
    d.update(kw)
    return d


def two(d):
    d = dict(d)
    d["kind"] = "surface2s"
    return d


MATS = {
    # wood
    "wood_planks": lib("wood_planks"),
    "wood_log": lib("wood_log"),
    "wood_endgrain": lib("wood_endgrain", uv=(1.0, 1.0)),
    "wood_painted": lib("wood_painted"),
    "wood_paint_white": lib("wood_painted", desat=1.0, lum=1.9, tint=(0.93, 0.92, 0.88)),
    "wood_paint": lib("wood_painted", desat=1.0, lum=1.9),                   # colour from vertex tint
    "wood_paint_2s": two(lib("wood_painted", desat=1.0, lum=1.9)),
    "wood_old": lib("wood_log", desat=0.6, lum=1.05, rough_add=0.05),      # silvered, weathered timber
    "wood_dark": lib("wood_planks", tint=(0.62, 0.55, 0.47)),
    "wood_fresh": lib("wood_log", tint=(1.12, 1.0, 0.86), rough_add=-0.05),  # sawn lumber, plywood
    "bark_dead": lib("bark_dead"),
    "bark_spruce": lib("bark_spruce"),
    "bark_pine": lib("bark_pine"),
    # metal
    "metal_aircraft": lib("metal_aircraft"),
    "metal_bare": lib("metal_bare"),
    "metal_corrugated": lib("metal_corrugated"),
    "metal_rusty": lib("metal_rusty"),
    "metal_painted_green": lib("metal_painted_green"),
    "paint_metal": lib("metal_painted_green", desat=1.0, lum=3.0),          # repaint via vertex tint
    "metal_dark": lib("metal_bare", tint=(0.32, 0.31, 0.3), rough_add=0.15),  # blued/black steel, cast iron
    "galvanized": lib("metal_corrugated", normal_strength=0.25),
    # fabric, soft
    # taut fabric sheds snow: tents, tarps and bags only hold a little in their folds
    "canvas": lib("canvas", snow_accept=0.35),
    "canvas_2s": two(lib("canvas", snow_accept=0.35)),
    "nylon": lib("fabric_nylon", snow_accept=0.25),
    "nylon_2s": two(lib("fabric_nylon", snow_accept=0.25)),
    "nylon_paint_2s": two(lib("fabric_nylon", desat=1.0, lum=2.6, snow_accept=0.25)),   # tents/tarps: tint colour
    "wool": lib("fabric_wool"),
    "leather": lib("leather"),
    "rope": lib("rope"),
    "rubber": lib("rubber"),
    "hide": lib("hide"),
    "panel": lib("rubber", desat=1.0, lum=4.6, rough_mul=0.75, normal_strength=0.15),   # FRP wall lining
    "rock_cliff": ter("cliff", tint=(1.25, 1.22, 1.18), rough_mul=0.8),                   # dark wet tunnel rock
    "plastic": lib("rubber", desat=1.0, lum=4.2, rough_mul=0.62, normal_strength=0.3),
    # mineral
    "concrete": lib("concrete"),
    "vinyl_floor": lib("concrete", desat=1.0, lum=1.0, rough_mul=0.5, normal_strength=0.2,
                       tint=(0.55, 0.52, 0.47)),
    "snow_packed": lib("snow_packed", snow_accept=0.0),
    "rime": two(lib("snow_packed", snow_accept=0.0, tint=(0.93, 0.96, 1.0), rough_mul=0.9)),
    "rock": lib("rock_boulder"),
    "gravel": ter("gravel"),
    "waste_rock": ter("scree", tint=(1.25, 1.1, 0.95), snow_accept=0.45),      # mine dump: wind-scoured, warm
    "tailings": ter("dirt", tint=(1.9, 1.15, 0.6), snow_accept=0.3),           # iron-stained fines below the bin
    "dirt": ter("dirt"),
    "rock_t": ter("rock"),
    "scree": ter("scree"),
    "snow": ter("snow", snow_accept=0.0),
    "grass_t": ter("grass"),
    "forest_t": ter("forest"),
    # special
    "glass": dict(kind="glass"),
    "glass_lit": dict(kind="glass", glow=2.6, frost=0.3),
    "lamp": dict(kind="surface", albedo=None, color=(0.9, 0.88, 0.8), emission=(1.0, 0.78, 0.5), emission_energy=5.0,
                 lit_param=True, snow_accept=0.0),
    "flame": dict(kind="surface", albedo=None, color=(1.0, 0.8, 0.5), emission=(1.0, 0.62, 0.28), emission_energy=4.0,
                  snow_accept=0.0),                                             # always-burning lantern / stove glow
    "screen": dict(kind="surface", albedo=None, color=(0.02, 0.025, 0.03), rough=0.12,
                   emission=(0.35, 0.62, 0.8), emission_energy=0.9, lit_param=True, snow_accept=0.0),
    "led_red": dict(kind="surface", albedo=None, color=(0.3, 0.02, 0.02), rough=0.3, emission=(1.0, 0.08, 0.05),
                    emission_energy=3.0, lit_param=True, snow_accept=0.0),
    "solar_cell": dict(kind="surface", albedo=None, color=(0.012, 0.018, 0.045), rough=0.12, snow_accept=0.6),
    "paint_gloss": lib("metal_painted_green", desat=1.0, lum=3.0, rough_mul=0.55, normal_strength=0.3),
    "decal": dict(kind="decal"),
    "decal_lit": dict(kind="decal", emission_energy=0.35, lit_param=True),
    "ice_cave": dict(kind="ice"),
    "ice_floor": lib("ice_clear", snow_accept=0.0, rough_mul=0.8),
    "fuel_sheen": dict(kind="sheen"),
    "water": dict(kind="water"),
}

# Surfaces that toggle with the site's interior lights (PoiSite.set_interior_lights)
LIT_MATS = [k for k, v in MATS.items() if v.get("lit_param") or v.get("glow")]


def _vec(v):
    return ", ".join(_f(x) for x in v)


def write_material(name):
    spec = MATS[name]
    os.makedirs(MAT_DIR, exist_ok=True)
    kind = spec["kind"]
    ext = []
    params = []

    def res(path, typ="Texture2D"):
        i = len(ext) + 1
        ext.append('[ext_resource type="%s" path="%s" id="%d"]' % (typ, path, i))
        return 'ExtResource("%d")' % i

    if kind in ("surface", "surface2s"):
        sh = res(RES_SH % ("poi_surface" if kind == "surface" else "poi_surface_2s"), "Shader")
        if spec.get("albedo"):
            params.append(("albedo_tex", res(spec["albedo"])))
            params.append(("orm_tex", res(spec["orm"])))
            params.append(("normal_tex", res(spec["normal"])))
            params.append(("uv_scale", "Vector2(%s)" % _vec(spec.get("uv", (1, 1)))))
        params.append(("noise_tex", res(NOISE)))
        tint = spec.get("tint", spec.get("color", (1, 1, 1)))
        params.append(("tint", "Color(%s, 1)" % _vec(tint)))
        if spec.get("desat"):
            params.append(("desaturate", _f(spec["desat"])))
            params.append(("lum_norm", _f(spec.get("lum", 1.0))))
        if not spec.get("albedo"):
            params.append(("rough_mul", "0.0"))
            params.append(("rough_add", _f(spec.get("rough", 0.5))))
            params.append(("metal_mul", "0.0"))
            params.append(("normal_strength", "0.0"))
        else:
            for k, p in (("rough_mul", "rough_mul"), ("rough_add", "rough_add"), ("metal_mul", "metal_mul"),
                         ("normal_strength", "normal_strength")):
                if k in spec:
                    params.append((p, _f(spec[k])))
            if spec.get("orm_is_rough"):
                params.append(("orm_is_rough", "true"))
        if "snow_accept" in spec:
            params.append(("snow_accept", _f(spec["snow_accept"])))
        if spec.get("emission"):
            params.append(("emission_color", "Color(%s, 1)" % _vec(spec["emission"])))
            params.append(("emission_energy", _f(spec.get("emission_energy", 1.0))))
    elif kind == "decal":
        sh = res(RES_SH % "poi_decal", "Shader")
        params.append(("atlas", res(DECALS)))
        params.append(("noise_tex", res(NOISE)))
        if spec.get("emission_energy"):
            params.append(("emission_energy", _f(spec["emission_energy"])))
    elif kind == "glass":
        sh = res(RES_SH % "poi_glass", "Shader")
        params.append(("grime_tex", res("res://assets/textures/glass_grime/glass_grime_albedo.png")))
        if spec.get("glow"):
            params.append(("glow_energy", _f(spec["glow"])))
        if spec.get("frost"):
            params.append(("frost", _f(spec["frost"])))
    elif kind == "ice":
        sh = res(RES_SH % "poi_ice", "Shader")
        params.append(("noise_tex", res(NOISE)))
        params.append(("ice_normal", res("res://assets/textures/terrain/ice_normal.png")))
        params.append(("ice_albedo", res("res://assets/textures/terrain/ice_albedo.png")))
    elif kind == "sheen":
        sh = res(RES_SH % "poi_sheen", "Shader")
        params.append(("noise_tex", res(NOISE)))
    elif kind == "water":
        sh = res(RES_SH % "poi_water", "Shader")
        params.append(("noise_tex", res(NOISE)))
    else:
        raise ValueError(kind)
    lines = ["[gd_resource type=\"ShaderMaterial\" format=3]", ""]
    lines += ext
    lines += ["", "[resource]", 'resource_name = "%s"' % name, "render_priority = 0", "shader = %s" % sh]
    for k, v in params:
        lines.append("shader_parameter/%s = %s" % (k, v))
    with open(os.path.join(MAT_DIR, name + ".tres"), "w") as fh:
        fh.write("\n".join(lines) + "\n")


def write_import(glb_res, mats, path):
    sub = ",\n".join('"%s": {\n"use_external/enabled": true,\n"use_external/path": "%s"\n}' % (m, RES_MAT % m)
                     for m in sorted(mats))
    txt = """[remap]

importer="scene"
importer_version=1
type="PackedScene"

[deps]

source_file="%s"

[params]

nodes/root_type=""
nodes/root_name=""
nodes/apply_root_scale=true
nodes/root_scale=1.0
nodes/import_as_skeleton_bones=false
nodes/use_name_suffixes=false
nodes/use_node_type_suffixes=false
meshes/ensure_tangents=true
meshes/generate_lods=true
meshes/create_shadow_meshes=true
meshes/light_baking=1
meshes/lightmap_texel_size=0.2
meshes/force_disable_compression=false
skins/use_named_skins=true
animation/import=false
import_script/path=""
materials/extract=0
_subresources={
"materials": {
%s
}
}
gltf/naming_version=2
gltf/embedded_image_handling=1
""" % (glb_res, sub)
    # Keep the uid Godot assigned on a previous import so scenes referencing it stay valid.
    if os.path.exists(path):
        old = open(path).read()
        for line in old.splitlines():
            if line.startswith("uid="):
                txt = txt.replace('type="PackedScene"\n', 'type="PackedScene"\n%s\n' % line, 1)
                break
        # Unchanged params: leave Godot's file alone (avoids needless reimports / diffs).
        if all(('"use_external/path": "%s"' % (RES_MAT % m)) in old for m in mats) and \
                old.count("use_external/enabled") == len(mats):
            return
    with open(path, "w") as fh:
        fh.write(txt)


class Tscn:
    def __init__(self):
        self.ext = []
        self.sub = []
        self.nodes = []
        self._shapes = {}

    def ext_res(self, typ, path):
        for i, (t, p) in enumerate(self.ext):
            if p == path:
                return 'ExtResource("%d")' % (i + 1)
        self.ext.append((typ, path))
        return 'ExtResource("%d")' % len(self.ext)

    def box_shape(self, size):
        key = tuple(round(x, 3) for x in size)
        if key not in self._shapes:
            sid = "Box_%d" % len(self._shapes)
            self._shapes[key] = sid
            self.sub.append('[sub_resource type="BoxShape3D" id="%s"]\nsize = Vector3(%s)\n' % (sid, _vec(key)))
        return 'SubResource("%s")' % self._shapes[key]

    def node(self, header, props=()):
        self.nodes.append((header, list(props)))

    def text(self):
        out = ["[gd_scene format=3]", ""]
        for i, (t, p) in enumerate(self.ext):
            out.append('[ext_resource type="%s" path="%s" id="%d"]' % (t, p, i + 1))
        out.append("")
        out += self.sub
        for header, props in self.nodes:
            out.append(header)
            for k, v in props:
                out.append("%s = %s" % (k, v))
            out.append("")
        return "\n".join(out)


def _gsize(size, M):
    """Box size is given in the local frame of M (Blender axes): Godot local axes map x->x, y->-z, z->y."""
    return (size[0], size[2], size[1])


def write_scene(site, glb_res, mats_by_bucket):
    t = Tscn()
    glb = t.ext_res("PackedScene", glb_res)
    script = t.ext_res("Script", "res://scenes/poi/poi_site.gd")
    t.node('[node name="%s" instance=%s]' % (site.id, glb),
           [("script", script), ("poi_id", '&"%s"' % site.meta.get("poi_id", site.id)),
            ("interior", "true" if site.interior else "false"),
            ("lit_materials", "PackedStringArray(%s)" % ", ".join('"%s"' % m for m in sorted(
                set(m for ms in mats_by_bucket.values() for m in ms if m in LIT_MATS)))),
            ("interior_lights_on", "true" if site.meta.get("lights_on") else "false")])
    for b in site.buckets:
        if not site.buckets[b].f:
            continue
        begin, end = site.ranges[b]
        props = []
        if end > 0:
            props.append(("visibility_range_end", _f(end)))
            props.append(("visibility_range_end_margin", _f(max(2.0, end * 0.08))))
        if begin > 0:
            props.append(("visibility_range_begin", _f(begin)))
            props.append(("visibility_range_begin_margin", _f(max(1.0, begin * 0.08))))
        if not site.shadow[b]:
            props.append(("cast_shadow", "0"))
        if props:
            t.node('[node name="%s" parent="."]' % b, props)
    # collision, grouped per footstep surface
    if site.cols:
        t.node('[node name="Collision" type="Node3D" parent="."]')
        by = {}
        for surf, M, size in site.cols:
            by.setdefault(surf, []).append((M, size))
        for surf, lst in sorted(by.items()):
            bn = "Body_" + surf
            t.node('[node name="%s" type="StaticBody3D" parent="Collision"]' % bn,
                   [("collision_mask", "0"), ("metadata/surface", '&"%s"' % surf)])
            for i, (M, size) in enumerate(lst):
                t.node('[node name="S%d" type="CollisionShape3D" parent="Collision/%s"]' % (i, bn),
                       [("transform", gd_transform(M)), ("shape", t.box_shape(_gsize(size, M)))])
    if site.markers:
        t.node('[node name="Sockets" type="Node3D" parent="."]')
        seen = set()
        for name, M in site.markers:
            assert name not in seen, "duplicate socket " + name
            seen.add(name)
            props = [("transform", gd_transform(M))]
            if name.startswith("Log_"):
                # exact data/logs.json id (sockets drop a leading "log_": Log_hale_01 -> log_hale_01)
                lid = name[4:] if name[4:] in _LOGS else "log_" + name[4:]
                assert lid in _LOGS, "unknown log id for socket " + name
                props.append(("metadata/log_id", '&"%s"' % lid))
            t.node('[node name="%s" type="Marker3D" parent="Sockets"]' % name, props)
    groups = {}
    for L in site.lights:
        groups.setdefault(L["group"], []).append(L)
    for g, lst in groups.items():
        t.node('[node name="%s" type="Node3D" parent="." groups=["local_light"]]' % g,
               [("visible", "true" if (g != "Lights_Interior" or site.meta.get("lights_on")) else "false")])
        for L in lst:
            typ = "OmniLight3D" if L["kind"] == "omni" else "SpotLight3D"
            props = [("transform", gd_transform(L["M"])), ("light_color", "Color(%s, 1)" % _vec(L["color"])),
                     ("light_energy", _f(L["energy"])), ("shadow_enabled", "true" if L["shadow"] else "false"),
                     ("distance_fade_enabled", "true"), ("distance_fade_begin", "30.0"),
                     ("distance_fade_length", "10.0")]
            if not L["visible"]:
                props.append(("visible", "false"))
            if L["kind"] == "omni":
                props += [("omni_range", _f(L["range"])), ("omni_attenuation", _f(L["att"]))]
            else:
                props += [("spot_range", _f(L["range"])), ("spot_angle", _f(L["angle"])),
                          ("spot_attenuation", _f(L["att"]))]
            t.node('[node name="%s" type="%s" parent="%s"]' % (L["name"], typ, g), props)
    for P in site.probes:
        c = plib._to_godot_pos(P["center"])
        s = P["size"]
        t.node('[node name="%s" type="ReflectionProbe" parent="."]' % P["name"],
               [("transform", "Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, %s)" % _vec(c)),
                ("size", "Vector3(%s)" % _vec((s[0], s[2], s[1]))),
                ("interior", "true" if P["interior"] else "false"),
                ("intensity", _f(P["intensity"])),
                ("ambient_mode", "2"), ("ambient_color", "Color(%s, 1)" % _vec(P["ambient"])),
                ("ambient_color_energy", _f(P["energy"])), ("box_projection", "true"),
                ("max_distance", _f(max(s[0], s[1], s[2]) + 10.0))])
    if site.shelters:
        sh = t.ext_res("Script", "res://scenes/poi/poi_shelter.gd")
        for S_ in site.shelters:
            t.node('[node name="%s" type="Area3D" parent="." groups=["shelter"]]' % S_["name"],
                   [("transform", gd_transform(S_["M"])), ("collision_layer", "128"), ("collision_mask", "0"),
                    ("monitoring", "false"), ("monitorable", "false"), ("script", sh),
                    ("shelter_factor", _f(S_["factor"]))])
            t.node('[node name="Shape" type="CollisionShape3D" parent="%s"]' % S_["name"],
                   [("transform", "Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, %s, 0)" % _f(S_["size"][2] * 0.5)),
                    ("shape", t.box_shape((S_["size"][0], S_["size"][2], S_["size"][1])))])
    if site.heat:
        hs = t.ext_res("Script", "res://scenes/poi/poi_heat.gd")
        for H in site.heat:
            p = plib._to_godot_pos(H["loc"])
            t.node('[node name="%s" type="Node3D" parent="." groups=["heat_source"]]' % H["name"],
                   [("transform", "Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, %s)" % _vec(p)), ("script", hs),
                    ("heat_radius", _f(H["radius"])), ("heat_celsius", _f(H["celsius"])),
                    ("active", "true" if H["active"] else "false")])
    if site.doors:
        ds = t.ext_res("Script", "res://scenes/poi/poi_door.gd")
        for D in site.doors:
            props = [("transform", gd_transform(D["M"])), ("collision_layer", "16"), ("collision_mask", "0"), ("script", ds),
                     ("target_site", '&"%s"' % D["site"]), ("target_socket", '&"%s"' % D["socket"]),
                     ("prompt", '"%s"' % D["prompt"])]
            if D["flag"]:
                props.append(("locked_flag", '&"%s"' % D["flag"]))
            t.node('[node name="%s" type="StaticBody3D" parent="." groups=["interactable"]]' % D["name"], props)
            sz = D["size"]
            t.node('[node name="Shape" type="CollisionShape3D" parent="%s"]' % D["name"],
                   [("shape", t.box_shape((sz[0], sz[2], sz[1])))])
    for header, props in site.extra:
        t.node(header, props)
    os.makedirs(OUT_SCENES, exist_ok=True)
    with open(os.path.join(OUT_SCENES, site.id + ".tscn"), "w") as fh:
        fh.write(t.text())


def build(site, bake=True):
    """Bake vertex colours, export the glb, write materials / .import / .tscn. Returns stats dict."""
    import time
    t0 = time.time()
    dropped = plib.clean(site)
    if dropped:
        print("[poi] %s: dropped %d degenerate faces" % (site.id, dropped))
    cols = plib.bake_colors(site) if bake else {
        b: [[(*m.t[i], 1.0)] * len(m.f[i]) for i in range(len(m.f))] for b, m in site.buckets.items()}
    os.makedirs(OUT_MODELS, exist_ok=True)
    glb_path = os.path.join(OUT_MODELS, site.id + ".glb")
    mats_by_bucket = plib.write_glb(glb_path, site.buckets, cols)
    all_mats = set(m for ms in mats_by_bucket.values() for m in ms)
    glb_res = "res://assets/models/poi/%s.glb" % site.id
    for m in all_mats:
        write_material(m)
    write_import(glb_res, all_mats, glb_path + ".import")
    write_scene(site, glb_res, mats_by_bucket)
    stats = dict(id=site.id, tris={b: m.tris() for b, m in site.buckets.items()}, total=site.tris(),
                 surfaces={b: len(v) for b, v in mats_by_bucket.items()}, cols=len(site.cols),
                 markers=len(site.markers), lights=len(site.lights), secs=round(time.time() - t0, 1),
                 glb_kb=os.path.getsize(glb_path) // 1024)
    print("[poi] %(id)s: %(total)d tris %(tris)s surfaces %(surfaces)s cols %(cols)d markers %(markers)d "
          "lights %(lights)d glb %(glb_kb)d KB (%(secs)ss)" % stats)
    return stats

"""THIN AIR — icon renderer (Blender 4.x, Cycles, headless).

Renders every model listed in tools/icons/_cache/manifest.json (written by export_meshes.gd) with a studio
light rig, soft contact shadow and AgX view transform, to tools/icons/_cache/raw/<id>.png (512 px, alpha).
Hero models (assets/models/items/<id>.glb) are imported as-is; procedural OBJs get their materials rebuilt
from scenes/items/materials/materials.json so icons match the in-game materials exactly.
Then tools/icons/finish_icons.py crops/scales them into assets/icons/<id>.png (256 px).

    blender -b -P thin-air/tools/icons/render_icons.py -- [--ids=a,b] [--samples=48] [--size=512]
"""
import bpy, sys, os, json, math
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CACHE = os.path.join(HERE, "_cache")
RAW = os.path.join(CACHE, "raw")
MATDEF = os.path.join(ROOT, "scenes", "items", "materials", "materials.json")
TEXDIR = os.path.join(ROOT, "scenes", "items", "materials", "tex")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opts = {}
for a in argv:
    k, _, v = a.lstrip("-").partition("=")
    opts[k] = v or "1"
SAMPLES = int(opts.get("samples", "128"))
SIZE = int(opts.get("size", "512"))

with open(os.path.join(CACHE, "manifest.json")) as f:
    manifest = json.load(f)
with open(MATDEF) as f:
    MATS = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
ids = sorted(manifest.keys())
if "ids" in opts:
    want = opts["ids"].split(",")
    ids = [i for i in ids if i in want]
os.makedirs(RAW, exist_ok=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def resolve(key):
    d = MATS.get(key)
    if d is None:
        return None
    if "base" in d:
        m = dict(resolve(d["base"]) or {})
        for k, v in d.items():
            if k != "base":
                m[k] = v
        return m
    return dict(d)


_img_cache = {}


def img(name, noncolor=False):
    key = (name, noncolor)
    if key in _img_cache:
        return _img_cache[key]
    im = bpy.data.images.load(os.path.join(TEXDIR, name), check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    _img_cache[key] = im
    return im


_mat_cache = {}


def build_material(key):
    if key in _mat_cache:
        return _mat_cache[key]
    d = resolve(key)
    mat = bpy.data.materials.new("M_" + key)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    if d is None:
        bsdf.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
        _mat_cache[key] = mat
        return mat
    tint = d.get("tint", [1, 1, 1])
    tint_lin = [srgb_to_linear(min(c, 1.0)) * (c if c > 1.0 else 1.0) for c in tint[:3]]
    alpha = tint[3] if len(tint) > 3 else 1.0
    uvs = float(d.get("uv", 4.0))
    tri = bool(d.get("triplanar", False))
    # texture coordinates
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (uvs, uvs, uvs)
    nt.links.new(tc.outputs["Object" if tri else "UV"], mp.inputs["Vector"])

    def tex(name, noncolor):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img(name, noncolor)
        t.interpolation = "Smart"
        if tri:
            t.projection = "BOX"
            t.projection_blend = 0.3
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        return t

    if d.get("albedo"):
        ta = tex(d["albedo"], False)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(ta.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = (*tint_lin, 1.0)
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*tint_lin, 1.0)
    rough = float(d.get("roughness", 1.0 if d.get("orm") else 0.8))
    metal = float(d.get("metallic", 1.0 if d.get("orm") else 0.0))
    if d.get("orm"):
        to = tex(d["orm"], True)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(to.outputs["Color"], sep.inputs["Color"])
        mr = nt.nodes.new("ShaderNodeMath")
        mr.operation = "MULTIPLY"
        mr.use_clamp = True
        nt.links.new(sep.outputs["Green"], mr.inputs[0])
        mr.inputs[1].default_value = rough
        nt.links.new(mr.outputs[0], bsdf.inputs["Roughness"])
        mm = nt.nodes.new("ShaderNodeMath")
        mm.operation = "MULTIPLY"
        mm.use_clamp = True
        nt.links.new(sep.outputs["Blue"], mm.inputs[0])
        mm.inputs[1].default_value = metal
        nt.links.new(mm.outputs[0], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Roughness"].default_value = min(rough, 1.0)
        bsdf.inputs["Metallic"].default_value = min(metal, 1.0)
    if d.get("normal"):
        tn = tex(d["normal"], True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = float(d.get("normal_strength", 1.0))
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # "thin" glass (PET bottles, lantern chimneys) renders as a clear alpha shell so the contents stay lit: Cycles
    # with refractive caustics off would otherwise leave anything inside a refractive shell unlit (black).
    if d.get("glass") and d.get("thin"):
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["IOR"].default_value = float(d.get("ior", 1.45))
        bsdf.inputs["Roughness"].default_value = min(rough, 1.0)
        bsdf.inputs["Base Color"].default_value = (*[min(1.0, c * 1.05) for c in tint_lin], 1.0)
        lp = nt.nodes.new("ShaderNodeLightPath")
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        tr.inputs["Color"].default_value = (*[min(1.0, c * 1.05) for c in tint_lin], 1.0)
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lp.outputs["Is Shadow Ray"], mix.inputs["Fac"])
        nt.links.new(bsdf.outputs["BSDF"], mix.inputs[1])
        nt.links.new(tr.outputs["BSDF"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    elif d.get("glass"):
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["IOR"].default_value = float(d.get("ior", 1.45))
        bsdf.inputs["Roughness"].default_value = min(rough, 1.0)
        bsdf.inputs["Base Color"].default_value = (*[min(1.0, c * 1.05) for c in tint_lin], 1.0)
    elif d.get("transparent") and alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    if d.get("emission") or d.get("emission_color"):
        ec = d.get("emission_color", [1, 1, 1])
        bsdf.inputs["Emission Color"].default_value = (*[srgb_to_linear(c) for c in ec[:3]], 1.0)
        if d.get("emission"):
            te = tex(d["emission"], False)
            nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = float(d.get("emission_energy", 1.0)) * 0.6
    _mat_cache[key] = mat
    return mat


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    # This Blender build ships without OpenImageDenoise: rely on adaptive sampling + the 2x downsample.
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.filter_width = 1.2
    sc.cycles.max_bounces = 6
    sc.cycles.transmission_bounces = 6
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.film_transparent = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        sc.view_settings.view_transform = "Filmic"
    sc.view_settings.exposure = -0.1
    world = bpy.data.worlds.new("Studio")
    sc.world = world
    world.use_nodes = True
    world.cycles.sampling_method = "MANUAL"
    world.cycles.sample_map_resolution = 256
    wn = world.node_tree
    bg = wn.nodes["Background"]
    # soft vertical gradient: brighter above (overcast sky), darker below
    tc = wn.nodes.new("ShaderNodeTexCoord")
    sep = wn.nodes.new("ShaderNodeSeparateXYZ")
    ramp = wn.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.10, 0.10, 0.11, 1)
    ramp.color_ramp.elements[1].position = 0.9
    ramp.color_ramp.elements[1].color = (0.62, 0.66, 0.72, 1)
    mapr = wn.nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = -1.0
    mapr.inputs["From Max"].default_value = 1.0
    wn.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    wn.links.new(sep.outputs["Z"], mapr.inputs["Value"])
    wn.links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    wn.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.32
    # light rig (object will be normalised to radius 1 around the origin)
    def area(name, loc, size, energy, color=(1, 1, 1), shape="RECTANGLE", size_y=None):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.color = color
        ld.shape = shape
        ld.size = size
        ld.size_y = size_y or size
        ob = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(ob)
        ob.location = loc
        d = (Vector((0, 0, 0.3)) - Vector(loc)).normalized()
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return ob
    area("Key", (-3.4, -3.8, 3.6), 2.6, 620, (1.0, 0.96, 0.9))
    area("Fill", (4.2, -3.0, 1.4), 3.5, 260, (0.86, 0.92, 1.0))
    area("Rim", (1.2, 4.0, 3.2), 2.0, 520, (1.0, 0.98, 0.95))
    area("Top", (0.0, 0.0, 6.0), 5.0, 50)
    # camera
    cd = bpy.data.cameras.new("Cam")
    cd.lens = 85
    cd.sensor_width = 36
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam, None


def clear_model():
    for ob in list(bpy.data.objects):
        if ob.get("icon_model"):
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def import_model(entry):
    before = set(bpy.data.objects)
    if entry.get("glb"):
        bpy.ops.import_scene.gltf(filepath=entry["glb"])
    else:
        bpy.ops.wm.obj_import(filepath=entry["obj"], forward_axis="NEGATIVE_Z", up_axis="Y")
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        o["icon_model"] = True
        if o.type == "MESH" and not entry.get("glb"):
            for slot in o.material_slots:
                if slot.material is not None:
                    key = slot.material.name.split(".")[0]
                    slot.material = build_material(key)
            for poly in o.data.polygons:
                poly.use_smooth = True
    return [o for o in new if o.type == "MESH"]


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def render_one(id, entry, cam, plane):
    clear_model()
    objs = import_model(entry)
    if not objs:
        print("skip", id)
        return
    root = bpy.data.objects.new("Root", None)
    root["icon_model"] = True
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    pose = entry.get("pose", {})
    root.rotation_euler = (0, 0, math.radians(float(pose.get("yaw", 0.0))))
    bpy.context.view_layer.update()
    lo, hi = world_bbox(objs)
    center = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 1e-4)
    s = 1.0 / radius
    root.scale = (s, s, s)
    root.location = (-center.x * s, -center.y * s, -lo.z * s)
    bpy.context.view_layer.update()
    lo, hi = world_bbox(objs)
    mid = (lo + hi) * 0.5
    elev = math.radians(float(pose.get("elev", 45.0)))
    fov = 2 * math.atan(18.0 / 85.0)
    dist = 1.08 / math.sin(fov / 2)
    dirv = Vector((0, -math.cos(elev), math.sin(elev)))
    cam.location = mid + dirv * dist
    cam.rotation_euler = (-dirv).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = os.path.join(RAW, id + ".png")
    bpy.ops.render.render(write_still=True)
    print("rendered", id)


cam, plane = setup_scene()
for i, id in enumerate(ids):
    render_one(id, manifest[id], cam, plane)

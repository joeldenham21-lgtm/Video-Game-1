"""Shared helpers for the THIN AIR vegetation generators (Blender 4.0, run headless).

Everything is deterministic: every random stream is a numpy Generator seeded from a stable string hash,
geometry is built from numpy arrays (no operator-order dependence), and exports use fixed glTF settings.

Conventions (CONTRACT §7): metres, +Y up in Godot (Blender +Z up; the glTF exporter converts), -Z forward.
Vertex data layout shared by every tree/plant mesh (read by assets/shaders/foliage.gdshader + bark.gdshader):
  COLOR_0.r  wind weight: 0 at the trunk/branch base -> 1 at branch tips (branch sway amplitude)
  COLOR_0.g  ambient occlusion baked from crown depth (1 = open, ~0.25 = deep inside the crown)
  COLOR_0.b  per-branch random phase 0..1 (desynchronises branch sway)
  COLOR_0.a  cards: card width / 4 m (the foliage shader rebuilds the card centre line from it and turns
             the card about its long axis toward the viewer); 0 on bark
  UV1 (TEXCOORD_1) .x  normalised height in the tree 0..1 (trunk bend weight), .y  branch-attach height 0..1
"""
from __future__ import annotations

import hashlib
import math
import os
import sys

import bpy
import bmesh  # noqa: F401  (used by callers)
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))          # thin-air/
CACHE = os.path.join(PROJECT, "tools", "vegetation", "_cache")
MODELS_VEG = os.path.join(PROJECT, "assets", "models", "vegetation")
MODELS_ROCKS = os.path.join(PROJECT, "assets", "models", "rocks")
TEX_FOLIAGE = os.path.join(PROJECT, "assets", "textures", "foliage")


def args_after_dashes() -> list[str]:
	argv = sys.argv
	return argv[argv.index("--") + 1:] if "--" in argv else []


def parse_args() -> dict:
	out = {}
	for a in args_after_dashes():
		a = a.lstrip("-")
		if "=" in a:
			k, v = a.split("=", 1)
			out[k] = v
		else:
			out[a] = "1"
	return out


def seed_of(*parts) -> int:
	h = hashlib.sha1("/".join(str(p) for p in parts).encode()).digest()
	return int.from_bytes(h[:8], "little")


def rng(*parts) -> np.random.Generator:
	return np.random.default_rng(seed_of(*parts))


def ensure_dir(p: str) -> str:
	os.makedirs(p, exist_ok=True)
	return p


# ------------------------------------------------------------------------------------------------ scene

def reset_scene() -> None:
	bpy.ops.wm.read_factory_settings(use_empty=True)
	for c in list(bpy.data.collections):
		bpy.data.collections.remove(c)


def link(obj: bpy.types.Object) -> bpy.types.Object:
	bpy.context.scene.collection.objects.link(obj)
	return obj


# ------------------------------------------------------------------------------------------------ mesh builder

class MeshData:
	"""Accumulates triangles/quads with per-corner attributes, then emits a Blender mesh.

	Vertices are stored per vertex; faces are index tuples. Attributes: normal (custom split normals),
	uv0, uv1, color (RGBA). Material index per face.
	"""

	def __init__(self):
		self.co: list = []
		self.nrm: list = []
		self.uv0: list = []
		self.uv1: list = []
		self.col: list = []
		self.faces: list = []
		self.mat: list = []
		self.partner: dict = {}     # card vertex -> the other vertex of its row (card width axis)

	def add_vert(self, co, nrm, uv0=(0.0, 0.0), uv1=(0.0, 0.0), col=(1.0, 1.0, 0.0, 0.0)) -> int:
		self.co.append(tuple(float(c) for c in co))
		n = np.asarray(nrm, dtype=np.float64)
		ln = np.linalg.norm(n)
		self.nrm.append(tuple(n / ln) if ln > 1e-9 else (0.0, 0.0, 1.0))
		self.uv0.append((float(uv0[0]), float(uv0[1])))
		self.uv1.append((float(uv1[0]), float(uv1[1])))
		self.col.append(tuple(float(c) for c in col))
		return len(self.co) - 1

	def add_face(self, idx, mat: int = 0) -> None:
		self.faces.append(tuple(idx))
		self.mat.append(mat)

	def extend(self, other: "MeshData") -> None:
		off = len(self.co)
		self.co += other.co
		self.nrm += other.nrm
		self.uv0 += other.uv0
		self.uv1 += other.uv1
		self.col += other.col
		self.faces += [tuple(i + off for i in f) for f in other.faces]
		self.mat += other.mat
		for k, v in other.partner.items():
			self.partner[k + off] = v + off

	def tri_count(self) -> int:
		return sum(len(f) - 2 for f in self.faces)

	def to_object(self, name: str, materials: list) -> bpy.types.Object:
		me = bpy.data.meshes.new(name)
		me.from_pydata(self.co, [], self.faces)
		me.update(calc_edges=True)
		for m in materials:
			me.materials.append(m)
		if self.mat:
			me.polygons.foreach_set("material_index", self.mat)
		# UV layers (per loop)
		loops_v = np.zeros(len(me.loops), dtype=np.int64)
		me.loops.foreach_get("vertex_index", loops_v)
		uv0 = np.asarray(self.uv0, dtype=np.float32)[loops_v]
		uv1 = np.asarray(self.uv1, dtype=np.float32)[loops_v]
		l0 = me.uv_layers.new(name="UVMap")
		l0.data.foreach_set("uv", uv0.ravel())
		l1 = me.uv_layers.new(name="UV2")
		l1.data.foreach_set("uv", uv1.ravel())
		me.uv_layers.active_index = 0
		# vertex colours (point domain, float -> glTF COLOR_0)
		ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
		ca.data.foreach_set("color", np.asarray(self.col, dtype=np.float32).ravel())
		me.color_attributes.active_color = ca
		try:
			me.color_attributes.render_color_index = 0
		except Exception:
			pass
		# custom normals
		me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
		try:
			me.use_auto_smooth = True    # Blender < 4.1
		except AttributeError:
			pass
		me.normals_split_custom_set_from_vertices([tuple(n) for n in self.nrm])
		me.validate(clean_customdata=False)
		ob = bpy.data.objects.new(name, me)
		link(ob)
		return ob


# ------------------------------------------------------------------------------------------------ math

def normalize(v):
	v = np.asarray(v, dtype=np.float64)
	n = np.linalg.norm(v, axis=-1, keepdims=True)
	return v / np.maximum(n, 1e-12)


def perp(v):
	"""Some unit vector perpendicular to v."""
	v = normalize(v)
	a = np.array([0.0, 0.0, 1.0]) if abs(v[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
	return normalize(np.cross(v, a))


def rot_axis(axis, ang):
	"""Rotation matrix (3x3) about unit axis by ang radians."""
	axis = normalize(axis)
	x, y, z = axis
	c, s = math.cos(ang), math.sin(ang)
	C = 1 - c
	return np.array([
		[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
		[y * x * C + z * s, c + y * y * C, y * z * C - x * s],
		[z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def smoothstep(a, b, x):
	t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
	return t * t * (3 - 2 * t)


def value_noise_1d(seed: int, n: int = 64):
	"""Returns a smooth periodic 1-D noise function f(t) (t in any range) with ~unit variance."""
	r = np.random.default_rng(seed).standard_normal(n)

	def f(t):
		t = np.asarray(t, dtype=np.float64) * n
		i0 = np.floor(t).astype(np.int64)
		fr = t - i0
		fr = fr * fr * (3 - 2 * fr)
		return r[i0 % n] * (1 - fr) + r[(i0 + 1) % n] * fr
	return f


# ------------------------------------------------------------------------------------------------ export

def export_glb(path: str, objects: list, extra_uv: bool = True) -> None:
	ensure_dir(os.path.dirname(path))
	bpy.ops.object.select_all(action="DESELECT")
	for o in objects:
		o.select_set(True)
	bpy.context.view_layer.objects.active = objects[0]
	kw = dict(
		filepath=path,
		export_format="GLB",
		use_selection=True,
		export_apply=True,
		export_texcoords=True,
		export_normals=True,
		export_tangents=True,
		export_materials="EXPORT",
		export_yup=True,
		export_extras=False,
		export_cameras=False,
		export_lights=False,
		export_animations=False,
		export_skins=False,
		export_morph=False,
	)
	# Blender 4.0: vertex colours flag
	try:
		bpy.ops.export_scene.gltf(export_colors=True, **kw)
	except TypeError:
		bpy.ops.export_scene.gltf(**kw)


def simple_material(name: str, color=(0.5, 0.5, 0.5, 1.0)) -> bpy.types.Material:
	m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
	m.use_nodes = True
	bsdf = m.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = color
	return m


def write_godot_scene_import(glb_abs: str, lods: bool = False, shadow_meshes: bool = False) -> None:
	"""Writes a .glb.import that keeps our authored LODs (no auto LOD) and skips shadow-mesh merging (they
	break alpha-tested card shadows). Godot fills in uid/paths on the next --import."""
	imp = glb_abs + ".import"
	uid = None
	if os.path.exists(imp):
		for line in open(imp):
			if line.startswith("uid="):
				uid = line.strip()
	lines = ["[remap]", "", 'importer="scene"', 'importer_version=1', 'type="PackedScene"']
	if uid:
		lines.append(uid)
	lines += ["", "[params]", "",
		"nodes/root_type=\"\"", "nodes/root_name=\"\"", "nodes/apply_root_scale=true", "nodes/root_scale=1.0",
		"meshes/ensure_tangents=true", f"meshes/generate_lods={'true' if lods else 'false'}",
		f"meshes/create_shadow_meshes={'true' if shadow_meshes else 'false'}", "meshes/light_baking=0",
		"meshes/lightmap_texel_size=0.2", "meshes/force_disable_compression=false",
		"skins/use_named_skins=true", "animation/import=false", "import_script/path=\"\"",
		"_subresources={}", "gltf/naming_version=1", "gltf/embedded_image_handling=1"]
	with open(imp, "w") as f:
		f.write("\n".join(lines) + "\n")

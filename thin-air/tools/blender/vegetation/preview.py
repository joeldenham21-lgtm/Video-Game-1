"""Cycles lineup preview of generated vegetation (QA only, not shipped).

blender -b -P thin-air/tools/blender/vegetation/preview.py -- --only=spruce_a,fir_a --lod=0 --out=/tmp/p.png
  [--res=960x540] [--spp=24] [--cam=dist,height,pitch_deg] [--sun=elev,az]
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vegcommon as vc  # noqa: E402
import trees  # noqa: E402
import bmats  # noqa: E402

BARK_TINT = {"bark_spruce": (1.0, 1.0, 1.0), "bark_pine": (1.0, 1.0, 1.0), "bark_dead": (1.0, 1.0, 1.0)}


def tree_objects(name: str, lod: int, offset_x: float, cm, mm):
	built = trees.build_variant(name, cm, mm)
	sp = trees.SPECIES[trees.VARIANTS[name]["sp"]]
	uvs = mm.get(sp["bark"], {}).get("uv1_scale", [2.0, 1.0])
	mats = [bmats.bark_material(sp["bark"], BARK_TINT.get(sp["bark"], (1, 1, 1)), uvs),
		bmats.card_material(sp["cards"]) if sp["cards"] else bmats.bark_material(sp["bark"])]
	ob = built["lods"][lod].to_object(name, mats)
	ob.location.x = offset_x
	return ob, built["meta"]


def main():
	a = vc.parse_args()
	names = [s for s in a.get("only", "spruce_a").split(",") if s]
	lod = int(a.get("lod", "0"))
	out = a.get("out", "/tmp/veg_preview.png")
	rx, ry = [int(x) for x in a.get("res", "960x540").split("x")]
	vc.reset_scene()
	cm = trees.load_cards_meta()
	mm = trees.load_material_meta()
	x = 0.0
	metas = []
	for i, n in enumerate(names):
		if i > 0:
			x += metas[-1]["crown_radius"] + 1.5
		ob, meta = tree_objects(n, lod, 0.0, cm, mm)
		x += meta["crown_radius"] if i > 0 else 0.0
		ob.location.x = x
		metas.append(meta)
	width = x
	hmax = max(m["height"] for m in metas)
	# ground
	bpy.ops.mesh.primitive_plane_add(size=400, location=(width / 2, 0, 0))
	g = bpy.context.active_object
	gm = bpy.data.materials.new("ground")
	gm.use_nodes = True
	gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.075, 0.05, 1)
	gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
	g.data.materials.append(gm)
	# sky + sun
	sc = bpy.context.scene
	world = bpy.data.worlds.new("sky")
	world.use_nodes = True
	nt = world.node_tree
	sky = nt.nodes.new("ShaderNodeTexSky")
	sky.sky_type = "NISHITA"
	elev, az = [float(v) for v in a.get("sun", "28,135").split(",")]
	sky.sun_elevation = math.radians(elev)
	sky.sun_rotation = math.radians(az)
	sky.altitude = 1500
	nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
	nt.nodes["Background"].inputs["Strength"].default_value = 0.25
	sc.world = world
	sun = bpy.data.lights.new("sun", "SUN")
	sun.energy = 2.2
	sun.angle = math.radians(0.6)
	so = bpy.data.objects.new("sun", sun)
	so.rotation_euler = (math.radians(90 - elev), 0, math.radians(az + 90))
	vc.link(so)
	# camera
	dist, ch, pitch = [float(v) for v in a.get("cam", f"{max(width, hmax) * 1.25 + 8},{hmax * 0.42},4").split(",")]
	cd = bpy.data.cameras.new("cam")
	cd.lens = 35
	cam = bpy.data.objects.new("cam", cd)
	cam.location = (width / 2, -dist, ch)
	cam.rotation_euler = (math.radians(90 + pitch), 0, 0)
	vc.link(cam)
	sc.camera = cam
	sc.render.engine = "CYCLES"
	sc.cycles.device = "CPU"
	sc.cycles.samples = int(a.get("spp", "24"))
	sc.cycles.use_denoising = False
	sc.cycles.max_bounces = 4
	sc.cycles.transparent_max_bounces = 24
	sc.render.resolution_x = rx
	sc.render.resolution_y = ry
	sc.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
	sc.render.filepath = out
	sc.render.image_settings.file_format = "PNG"
	bpy.ops.render.render(write_still=True)
	print("[preview] wrote", out, [m["tris"] for m in metas])


if __name__ == "__main__":
	main()

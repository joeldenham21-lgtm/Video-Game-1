#!/usr/bin/env python3
"""THIN AIR — PBR material library generator.

For every set writes assets/textures/<set>/<set>_{albedo,normal,orm[,height]}.png (+ hand-written .import files)
and assets/materials/<set>.tres (ORMMaterial3D), plus assets/materials/materials.json (the catalogue).

UV convention for meshes (Blender scripts): **1 UV unit = 1 metre** unless the set says otherwise. The .tres
uv1_scale converts metres to texture repeats (1 / tile size). Exceptions:
  * rope          — U = metres along the rope, V = 0..1 once around the circumference
  * wood_endgrain — whole log end-cap disc mapped to UV 0..1 (not tiling)
  * rock_boulder, snow_packed, concrete — world-space triplanar (mesh UVs ignored)
Grain / fibre / streak direction is along V (image vertical) for bark, wood, planks, corrugation and rope strands.

Usage:  python3 gen_materials.py [--only a,b] [--preview] [--no-write]
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as tl  # noqa: E402
import common as cm  # noqa: E402
import godot_import as gi  # noqa: E402
import materials_wood as mw  # noqa: E402
import materials_metal as mm  # noqa: E402
import materials_misc as mx  # noqa: E402

# name -> (function, width px, height px, tile width m, options)
#   options: triplanar, tiling (False for decals/end caps), normal_scale, uv (explicit uv1_scale), height (write
#   height map), transparent, desc, cull_disabled
SETS: dict[str, tuple] = {
	"bark_spruce": (mw.bark_spruce, 512, 1024, 0.5, dict(desc="Engelmann/white spruce: thin grey-brown scales")),
	"bark_pine": (mw.bark_pine, 512, 1024, 0.6, dict(desc="mature pine: cinnamon plates, black fissures")),
	"bark_dead": (mw.bark_dead, 512, 1024, 0.5, dict(desc="silvered snag wood, checks, beetle galleries")),
	"wood_log": (mw.wood_log, 1024, 1024, 1.0, dict(desc="peeled, weathered building log (grain along V)")),
	"wood_endgrain": (mw.wood_endgrain, 1024, 1024, 0.42, dict(tiling=False, uv=(1.0, 1.0),
	                  desc="log end cap disc (UV 0..1), rings, radial checks, saw marks")),
	"wood_planks": (mw.wood_planks, 1024, 1024, 2.0, dict(desc="old weathered cabin boards, vertical")),
	"wood_painted": (mw.wood_painted, 1024, 1024, 2.0, dict(desc="chipped dull-red painted boards")),
	"metal_aircraft": (mm.metal_aircraft, 1024, 1024, 1.5, dict(desc="white-painted aluminium skin, rivets, grime")),
	"metal_bare": (mm.metal_bare, 1024, 1024, 1.0, dict(desc="scratched, oxidised aluminium")),
	"metal_rusty": (mm.metal_rusty, 1024, 1024, 1.0, dict(desc="rusted steel plate")),
	"metal_corrugated": (mm.metal_corrugated, 1024, 1024, 1.14, dict(desc="galvanised corrugated sheet, rust streaks",
	                     height=True)),
	"metal_painted_green": (mm.metal_painted_green, 1024, 1024, 1.0, dict(desc="industrial green enamel, chipped")),
	"concrete": (mx.concrete, 1024, 1024, 2.0, dict(triplanar=True, desc="weathered cast concrete")),
	"canvas": (mx.canvas, 1024, 1024, 0.5, dict(desc="heavy cotton duck tarp / tent, olive-khaki")),
	"fabric_wool": (mx.fabric_wool, 1024, 1024, 0.3, dict(desc="hand-knit wool blanket, heathered")),
	"fabric_nylon": (mx.fabric_nylon, 1024, 1024, 0.3, dict(desc="ripstop nylon parka shell, expedition red")),
	"leather": (mx.leather, 1024, 1024, 0.3, dict(desc="worn brown leather")),
	"hide": (mx.hide, 1024, 1024, 0.6, dict(desc="raw hide, flesh side, dried")),
	"rope": (mx.rope, 1024, 1024, 0.168, dict(uv=(1.0 / 0.168, 1.0), height=True,
	         desc="3-strand manila rope, U along rope (m), V around (0..1)")),
	"rock_boulder": (mx.rock_boulder, 1024, 1024, 3.0, dict(triplanar=True, height=True,
	                 desc="lichen-spotted granite for rock meshes (triplanar)")),
	"snow_packed": (mx.snow_packed, 1024, 1024, 2.0, dict(triplanar=True, desc="dense snow on roofs/structures")),
	"ice_clear": (mx.ice_clear, 1024, 1024, 1.0, dict(desc="clear lake/river ice, bubbles, white cracks")),
	"rubber": (mm.rubber, 1024, 1024, 0.5, dict(desc="black rubber, scuffed and dusty")),
	"glass_grime": (mm.glass_grime, 1024, 1024, 1.0, dict(transparent=True, cull_disabled=True,
	                desc="window glass: grime film / streaks (alpha) + roughness")),
}


def finish(name: str, t: tl.Tex, d: dict) -> dict:
	h_m = d["height"]
	ty = t.texel_m * d.get("texel_y_scale", 1.0)
	if "normal" in d:
		n = d["normal"]
	else:
		n = tl.normal_from_height(h_m, t.texel_m, 1.0, texel_y_m=ty)
	if "tilt" in d:
		n = tl.tilt_normals(n, *d["tilt"])
	ao = tl.horizon_ao(h_m, t.texel_m, d.get("ao_radius", 0.02), strength=d.get("ao_strength", 1.0))
	if "ao_mul" in d:
		ao = ao * d["ao_mul"]
	alb = np.clip(d["albedo"] * tl.lerp(1.0, ao, d.get("ao_bake", 0.2))[..., None], 0, 1)
	rough = np.clip(d["rough"], 0.02, 1.0)
	metal = np.clip(d.get("metal", np.zeros_like(rough)), 0, 1)
	rng = np.random.default_rng(tl.seed_of(name, 7))
	out = dict(albedo=tl.albedo_u8(alb, rng), normal=tl.normal_u8(n),
	           orm=np.dstack([tl.gray_u8(ao), tl.gray_u8(rough, rng), tl.gray_u8(metal)]),
	           _lin=dict(albedo=alb, n=n, rough=rough, ao=ao, metal=metal))
	if "alpha" in d:
		out["albedo"] = np.dstack([out["albedo"], tl.gray_u8(d["alpha"], rng)])
	lo, hi = np.percentile(h_m, 0.05), np.percentile(h_m, 99.95)
	out["height"] = tl.gray_u8(np.clip((h_m - lo) / max(hi - lo, 1e-9), 0, 1), rng)
	out["stats"] = dict(avg_albedo_linear=[round(float(x), 4) for x in alb.reshape(-1, 3).mean(0)],
	                    roughness_avg=round(float(rough.mean()), 3), metal_avg=round(float(metal.mean()), 3),
	                    height_range_m=round(float(hi - lo), 5))
	return out


def write_tres(name: str, spec: tuple, d: dict) -> None:
	fn, w, h, tile_w, opt = spec
	tile_h = tile_w * h / w
	tdir = f"res://assets/textures/{name}/{name}"
	uv = opt.get("uv") or (1.0 / tile_w, 1.0 / tile_h)
	tri = opt.get("triplanar", False)
	ext = [("albedo", f"{tdir}_albedo.png"), ("orm", f"{tdir}_orm.png"), ("normal", f"{tdir}_normal.png")]
	lines = [f'[gd_resource type="ORMMaterial3D" load_steps={len(ext) + 1} format=3]', ""]
	for i, (k, p) in enumerate(ext):
		lines.append(f'[ext_resource type="Texture2D" path="{p}" id="{i + 1}_{k}"]')
	lines += ["", "[resource]", f'resource_name = "{name}"']
	if opt.get("transparent"):
		lines += ["transparency = 1", "depth_draw_mode = 1"]
	if opt.get("cull_disabled"):
		lines.append("cull_mode = 2")
	# ORMMaterial3D only applies the R (occlusion) channel when ao_enabled is set; ao_light_affect stays 0 so the
	# baked occlusion darkens ambient/sky light only (direct sun is shadowed by real geometry).
	lines += ['albedo_texture = ExtResource("1_albedo")',
	          'orm_texture = ExtResource("2_orm")',
	          "ao_enabled = true",
	          "normal_enabled = true",
	          f"normal_scale = {d.get('normal_scale', 1.0):.3f}",
	          'normal_texture = ExtResource("3_normal")']
	if d.get("specular") is not None:
		lines.append(f"metallic_specular = {d['specular']:.3f}")
	if d.get("subsurf"):
		lines += ["subsurf_scatter_enabled = true", f"subsurf_scatter_strength = {d['subsurf']:.3f}"]
	if d.get("rim"):
		lines += ["rim_enabled = true", f"rim = {d['rim']:.3f}", f"rim_tint = {d.get('rim_tint', 0.5):.3f}"]
	if tri:
		s = 1.0 / tile_w
		lines += [f"uv1_scale = Vector3({s:.5f}, {s:.5f}, {s:.5f})", "uv1_triplanar = true",
		          "uv1_triplanar_sharpness = 4.0", "uv1_world_triplanar = true"]
	else:
		lines.append(f"uv1_scale = Vector3({uv[0]:.5f}, {uv[1]:.5f}, 1)")
	lines.append("texture_filter = 5")
	os.makedirs(cm.MAT_DIR, exist_ok=True)
	with open(os.path.join(cm.MAT_DIR, f"{name}.tres"), "w") as f:
		f.write("\n".join(lines) + "\n")


def main() -> None:
	ap = argparse.ArgumentParser()
	ap.add_argument("--only", default="")
	ap.add_argument("--preview", action="store_true")
	ap.add_argument("--no-write", action="store_true")
	a = ap.parse_args()
	names = [s for s in a.only.split(",") if s] or list(SETS)
	catalog_path = os.path.join(cm.MAT_DIR, "materials.json")
	catalog = {}
	if os.path.exists(catalog_path):
		import json
		catalog = json.load(open(catalog_path))
	for name in names:
		spec = SETS[name]
		fn, w, h, tile_w, opt = spec
		t0 = time.time()
		t = tl.Tex(name=name, w=w, h=h, tile_w_m=tile_w)
		d = fn(t)
		o = finish(name, t, d)
		st = o["stats"]
		print(f"{name:20s} {time.time() - t0:5.1f}s  albedo={st['avg_albedo_linear']} rough={st['roughness_avg']}"
		      f" metal={st['metal_avg']} relief={st['height_range_m']}m")
		if a.preview:
			L = o["_lin"]
			img = tl.preview(L["albedo"], L["n"], L["rough"], L["ao"], L["metal"], reps=2 if opt.get("tiling", True) else 1,
			                 size=1024)
			print("  preview:", cm.save_preview(f"mat_{name}", img))
		if a.no_write:
			continue
		base = os.path.join(cm.TEX_DIR, name, name)
		tl.save_png(base + "_albedo.png", o["albedo"])
		tl.save_png(base + "_normal.png", o["normal"])
		tl.save_png(base + "_orm.png", o["orm"])
		gi.texture(base + "_albedo.png", "albedo")
		gi.texture(base + "_normal.png", "normal")
		gi.texture(base + "_orm.png", "orm", normal_for_rough=base + "_normal.png")
		if opt.get("height"):
			tl.save_png(base + "_height.png", o["height"])
			gi.texture(base + "_height.png", "height")
		write_tres(name, spec, d)
		tile_h = tile_w * h / w
		catalog[name] = {
			"material": f"res://assets/materials/{name}.tres", "size_px": [w, h],
			"tile_m": [round(tile_w, 4), round(tile_h, 4)], "tiling": opt.get("tiling", True),
			"triplanar": opt.get("triplanar", False), "uv1_scale": [round(1 / tile_w, 5), round(1 / tile_h, 5)]
			if not opt.get("uv") else [round(opt["uv"][0], 5), round(opt["uv"][1], 5)],
			"transparent": opt.get("transparent", False), "desc": opt.get("desc", ""), **st,
		}
	if not a.no_write:
		tl.write_json(catalog_path, {k: catalog[k] for k in sorted(catalog)})


if __name__ == "__main__":
	main()

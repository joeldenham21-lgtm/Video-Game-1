"""Hand-written Godot 4.7 .import files so every texture imports VRAM-compressed with mipmaps on the first
`godot --import`, with the right flags per map type (normal maps → RGTC/BC5-style, ORM roughness filtered by
the normal map's variance for specular anti-aliasing, packed terrain arrays → Texture2DArray).

Godot rewrites these files on import (adding uid/paths); the params below are what matter. If an existing
.import already carries a uid we keep it so references stay stable across regenerations.
"""
from __future__ import annotations

import os
import re

from common import PROJECT


def res_path(abs_path: str) -> str:
	rel = os.path.relpath(abs_path, PROJECT).replace(os.sep, "/")
	return "res://" + rel


def _existing_uid(imp: str) -> str | None:
	if not os.path.exists(imp):
		return None
	m = re.search(r'^uid="(uid://[a-z0-9]+)"', open(imp).read(), re.M)
	return m.group(1) if m else None


def _write(imp: str, header: str, params: dict) -> None:
	uid = _existing_uid(imp)
	lines = ["[remap]", "", header]
	if uid:
		lines.append(f'uid="{uid}"')
	lines += ["", "[params]", ""]
	for k, v in params.items():
		lines.append(f"{k}={v}")
	with open(imp, "w") as f:
		f.write("\n".join(lines) + "\n")


def texture(png_abs: str, kind: str, normal_for_rough: str | None = None, high_quality: bool = False) -> None:
	"""kind: albedo | normal | orm | rough | height | mask"""
	params = {
		"compress/mode": 2,                    # VRAM compressed (BC/ETC2/ASTC)
		"compress/high_quality": "true" if high_quality else "false",
		"compress/lossy_quality": 0.7,
		"compress/hdr_compression": 1,
		"compress/normal_map": 1 if kind == "normal" else 2,   # 1 = enable, 2 = disable
		"compress/channel_pack": 0,
		"mipmaps/generate": "true",
		"mipmaps/limit": -1,
		"roughness/mode": 1,                   # disabled unless an ORM with a normal map
		"roughness/src_normal": '""',
		"process/fix_alpha_border": "true",
		"process/premult_alpha": "false",
		"process/normal_map_invert_y": "false",
		"process/size_limit": 0,
		"detect_3d/compress_to": 0,
	}
	if kind == "orm" and normal_for_rough:
		params["roughness/mode"] = 3           # roughness lives in the Green channel
		params["roughness/src_normal"] = f'"{res_path(normal_for_rough)}"'
	if kind == "rough" and normal_for_rough:
		params["roughness/mode"] = 6           # grayscale roughness map
		params["roughness/src_normal"] = f'"{res_path(normal_for_rough)}"'
	_write(png_abs + ".import", 'importer="texture"\ntype="CompressedTexture2D"', params)


def texture_array(png_abs: str, slices_v: int, slices_h: int = 1, high_quality: bool = True) -> None:
	params = {
		"compress/mode": 2,
		"compress/high_quality": "true" if high_quality else "false",
		"compress/lossy_quality": 0.7,
		"compress/hdr_compression": 1,
		"compress/channel_pack": 0,
		"mipmaps/generate": "true",
		"mipmaps/limit": -1,
		"slices/horizontal": slices_h,
		"slices/vertical": slices_v,
	}
	_write(png_abs + ".import", 'importer="2d_array_texture"\ntype="CompressedTexture2DArray"', params)


def keep(png_abs: str) -> None:
	"""Not imported as a texture (source/reference only)."""
	with open(png_abs + ".import", "w") as f:
		f.write('[remap]\n\nimporter="keep"\n')

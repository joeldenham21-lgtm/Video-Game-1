#!/usr/bin/env python3
"""Sets the Godot import parameters the sky textures need (run after the first `godot --import`,
then re-import). Data textures stay lossless and keep their alpha untouched."""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "textures", "sky"))

FLAGS = {
    "stars.png": {"compress/mode": "0", "mipmaps/generate": "false", "process/fix_alpha_border": "false"},
    "cloud_noise.png": {"compress/mode": "0", "mipmaps/generate": "true", "process/fix_alpha_border": "false"},
    "moon_albedo.png": {"compress/mode": "0", "mipmaps/generate": "true"},
    "milky_way.png": {"compress/mode": "2", "compress/high_quality": "true", "mipmaps/generate": "true"},
    "blue_noise.png": {"compress/mode": "0", "mipmaps/generate": "false"},
    "flakes.png": {"compress/mode": "0", "mipmaps/generate": "true"},
}

for name, flags in FLAGS.items():
    path = os.path.join(TEX, name + ".import")
    if not os.path.exists(path):
        print("missing", path)
        continue
    s = open(path).read()
    flags = dict(flags)
    flags["detect_3d/compress_to"] = "0"
    for k, v in flags.items():
        pat = re.compile("^" + re.escape(k) + "=.*$", re.M)
        if pat.search(s):
            s = pat.sub(k + "=" + v, s)
        else:
            s = s.rstrip("\n") + "\n" + k + "=" + v + "\n"
    open(path, "w").write(s)
    print("set", name)

"""Builds the story-location architecture (THIN AIR, stream "poi").

    blender -b -P thin-air/tools/blender/poi/build.py -- [--only=crash_site,kestrel_station] [--nobake]

Each module in sites/ exposes build() -> list[plib.Site]; every Site becomes assets/models/poi/<id>.glb
(+ .import remapping its materials to assets/models/poi/materials/*.tres) and scenes/poi/<id>.tscn.
Run `python3.12 thin-air/tools/blender/poi/gen_textures.py` first (decal atlas + noise), then
`godot --headless --path thin-air --import`.
"""
import importlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "sites"))

import pscene  # noqa: E402

SITES = ["crash_site", "kestrel_station", "ranger_cabin", "ashford_mine", "summit_relay", "owens_bivouac",
         "glacier_camp", "fire_lookout", "trapper_cabin", "ice_cave", "_test"]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    bake = "--nobake" not in argv
    for a in argv:
        if a.startswith("--only="):
            only = a.split("=", 1)[1].split(",")
    stats_path = os.path.join(HERE, "stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    for mod_name in SITES:
        if only is None and mod_name.startswith("_"):
            continue
        if only and mod_name not in only:
            continue
        try:
            mod = importlib.import_module(mod_name)
        except ModuleNotFoundError as e:
            print("[poi] skip %s (%s)" % (mod_name, e))
            continue
        t0 = time.time()
        for site in mod.build():
            st = pscene.build(site, bake)
            if not mod_name.startswith("_"):
                stats[site.id] = st
        print("[poi] %s done in %.1fs" % (mod_name, time.time() - t0))
    with open(stats_path, "w") as fh:
        json.dump(stats, fh, indent=1, sort_keys=True)


main()

# THIN AIR — asset credits

Only our own generated content, CC0, or OFL fonts (CONTRACT §7). One row per source; workstreams append.

| Assets | Source | License |
|---|---|---|
| `assets/textures/**` (terrain layers, packed terrain arrays, PBR material maps), `assets/materials/**` | Procedurally generated in-house by `tools/textures/*.py` (numpy/scipy/Pillow, no photographs or third-party textures) | Original work of the THIN AIR project |
| `assets/terrain/**` (heightfields, masks, normal/detail maps), `data/world_layout.json` | Procedurally generated in-house by `tools/terrain/*.py` + `terrain_c.c` (designed skeleton, harmonic interpolation, erosion simulation; no DEM or third-party data) | Original work of the THIN AIR project |

# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Item textures + campfire FX | `python3.12 thin-air/tools/icons/gen_item_textures.py [set ...]` | `scenes/items/materials/tex/*` (PBR sets for the item material library `scenes/items/materials/materials.json`), `scenes/items/fx/` flame flipbook, smoke puffs, ember/glow sprites |
| Item icon meshes | `godot --headless --path thin-air --import` then `godot --headless --path thin-air -s $PWD/thin-air/tools/icons/export_meshes.gd [-- --ids=a,b]` | `tools/icons/_cache/<id>.obj` + `manifest.json` (procedural `ItemVisuals` models; uses `assets/models/items/<id>.glb` instead when a hero model exists) |
| Item icon renders | `blender -b -P thin-air/tools/icons/render_icons.py -- [--ids=a,b] [--samples=96]` | `tools/icons/_cache/raw/<id>.png` (Cycles studio rig, 512 px, materials rebuilt from `materials.json`) |
| Item icon finish | `python3.12 thin-air/tools/icons/finish_icons.py [ids ...]` | `assets/icons/<id>.png` (256 px RGBA, cropped/centred/sharpened) + `assets/icons/_unknown.png` |
| Items dev scene / shots | `DISPLAY=:99 godot --path thin-air --fixed-fps 30 --resolution 1280x720 res://scenes/dev/items_test.tscn -- --shot=<campfire_night\|ui_inventory\|ui_equipment\|ui_crafting\|ui_container\|pickups> --save=<abs.jpg>` | `docs/shots/items_*.jpg` (add `--preset=mobile_high --rendering-method mobile` for the phone layout) |

Workstreams append their generators to this table.

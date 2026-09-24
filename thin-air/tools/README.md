# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Viewmodel textures (player) | `python3 thin-air/tools/player/gen_fp_textures.py` → import → `python3 thin-air/tools/player/gen_fp_textures.py --fix-imports` → import | `scenes/player/textures/*` (512² seamless PBR sets: wood ash/dark/raw, steel, stone, leather, fabric, knit, rubber, aluminium, plastic, canvas; topo map; flame/smoke/spark sprites). Needs numpy + PIL (`python3.12` in this container). |

Workstreams append their generators to this table.

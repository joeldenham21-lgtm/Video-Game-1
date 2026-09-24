# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| SFX + ambience synthesis (Audio) | `python3.12 thin-air/tools/audio/build_sfx.py [--only ids] [--preview DIR]` then `python3.12 thin-air/tools/audio/set_loop_flags.py` and `godot --headless --path thin-air --import` | `assets/audio/sfx/*.ogg`, `assets/audio/ambience/*.ogg`, `data/sfx.json` (≈2 min, 4 cores) |
| Voice casting analysis (Audio) | `python3.12 thin-air/tools/audio/voice/cast_voices.py` · `python3.12 thin-air/tools/audio/voice/audition.py DIR` | `tools/audio/_cache/casting.json`, audition WAV/PNGs |
| Voice lines, logs, prologue (Audio) | `python3.12 thin-air/tools/audio/voice/build_voice.py [--only ids] [--preview DIR]` (script: `tools/audio/voice/script.py`) | `assets/audio/voice/*.ogg`, `data/voice.json`, `data/logs.json` (≈10 min first run with parallel piper, ≈7 min re-process from the TTS cache; `--only ids --with-prologue` for quick edits) |
| Audio QA (Audio) | `python3.12 thin-air/tools/audio/qa_audio.py [--out DIR]` | loudness/true-peak/channels/loop-seam report + sox spectrograms |

Workstreams append their generators to this table.

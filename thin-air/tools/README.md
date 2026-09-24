# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Sky: atmosphere LUT (1/2) | `python3 thin-air/tools/sky/gen_atmosphere.py` (numpy+scipy; ~90 s) | `tools/sky/_cache/atmosphere_{lut,cpu}.bin` + `atmosphere_meta.json`: spectral (31 λ) Rayleigh + Mie + ozone single scattering with Hillaire-2020 multiple scattering, 4 camera altitudes × 64 sun elevations |
| Sky: atmosphere LUT (2/2) | `DISPLAY=:99 godot --path thin-air -s $PWD/thin-air/tools/sky/bake_sky_resources.gd` (needs a real renderer, not `--headless`, so the 3D texture can be read back) | `assets/textures/sky/atmosphere_lut.res` (ImageTexture3D 64×64×256 RGBE9995), `atmosphere_cpu.res` (Image, CPU lighting tables) |
| Sky: textures | `python3 thin-air/tools/sky/gen_sky_textures.py [clouds moon stars milky_way flakes blue_noise]` | `assets/textures/sky/`: `cloud_noise.png` (Perlin-Worley / billow / detail / cirrus), `moon_albedo.png` (near-side maria + ray craters), `stars.png` (≈230 real bright stars + ≈26k procedural, equatorial), `milky_way.png` (galactic model: bulge, Great Rift, star clouds, M31), `flakes.png`, `blue_noise.png` |
| Sky: import flags | `python3 thin-air/tools/sky/set_import_flags.py` then `godot --headless --path thin-air --import` | lossless / no-mipmap / untouched-alpha import settings for the sky data textures |
| Sky: look-dev renders | `DISPLAY=:99 godot --path thin-air --rendering-method forward_plus\|mobile --write-movie /tmp/s.png --fixed-fps 30 --quit-after 12 --resolution 1280x720 res://scenes/dev/sky_test.tscn -- --hours=16.75 --weather=clear --look=300,5 [--day=N --moon=0.5 --aurora=0.8 --preset=P --perf]` (see header of `src/dev/sky_test.gd`) | sky/weather frames over a procedural mountain backdrop; the last PNG is the settled frame (`docs/shots/sky_*.jpg`) |

Workstreams append their generators to this table.

# assets/terrain — procedural terrain textures

All images in this directory are ORIGINAL, procedurally generated for
ELDERFALL by `tools/texgen.mjs` (layered toroidal value/fbm noise, domain
warp, Worley cracks, and stroke/splat synthesis — no photos, no third-party
assets). They are ours; treat them as CC0-equivalent within this project.

Regenerate any time with:

    npm i --no-save sharp pngjs
    node tools/texgen.mjs            # all sets
    node tools/texgen.mjs grass rock # specific sets

Contents (all seamless/tileable):

| files | material | size |
|---|---|---|
| `grass_d.jpg` / `grass_n.jpg`   | meadow turf (albedo + tangent normal) | 1024 |
| `forest_d.jpg` / `forest_n.jpg` | forest-floor leaf litter | 1024 |
| `rock_d.jpg` / `rock_n.jpg`     | grey cliff stone, strata + cracks | 1024 |
| `dirt_d.jpg` / `dirt_n.jpg`     | packed earth path with pebbles | 1024 |
| `snow_d.jpg` / `snow_n.jpg`     | wind-rippled snow | 1024 |
| `sand_d.jpg` / `sand_n.jpg`     | wet lake-shore sand | 1024 |
| `macro_n.jpg`                   | shared large-scale normal variation | 512 |
| `noise.jpg`                     | shared RGB fbm (splat dither / UV breakup) | 512 |

Normal maps are tangent-space, OpenGL convention (green = +Y / up).

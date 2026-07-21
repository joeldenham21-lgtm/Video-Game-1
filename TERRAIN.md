# ELDERFALL — Photoreal Terrain Contract (wave 6)

Goal: ground that reads like well-modded Skyrim under the real lighting —
tiled PBR-style textures with normal maps, splat-blended by biome, replacing
flat vertex colors ON DESKTOP (ultra/high desktop tiers). Mobile keeps the
current vertex-color path untouched (quality gate: `g.quality.desktop`).

Two agents, strict ownership:
- TEXGEN agent: `tools/texgen.mjs` (new, node script) + generated
  `assets/terrain/*.jpg` (checked into the repo)
- TERRAIN agent: `src/world.js` terrain material/geometry changes ONLY
  (do not touch vegetation/water/far-shell/mega-peaks beyond what's listed)

## TEXGEN — tools/texgen.mjs
Node script (run once, commit outputs) generating SIX seamless 1024×1024
material sets in assets/terrain/, JPEG q82 via `sharp` (npm i --no-save
sharp pngjs). Each set: `<name>_d.jpg` (albedo), `<name>_n.jpg` (tangent
normal from a synthesized height field via Sobel, Y-up green), plus ONE
shared `macro_n.jpg` (large-scale normal variation) and `noise.jpg`
(RGB fbm for splat dithering).
Sets & looks (photo-grade, MUTED dark-fantasy palette — study real photo
references from memory; layered multi-octave value noise + domain warp;
ALL seamless via toroidal sampling):
1. `grass` — dense meadow turf seen from above: directional blade streaks
   (anisotropic noise stretched 4:1 with per-patch rotation), 3 green-olive
   hues + dry-straw flecks (8%), tiny dark soil gaps, clover dots; height
   field = blade clumps for the normal map.
2. `forest` — forest floor: leaf-litter clutter (overlapping soft ovals in
   umber/sienna), patches of dark moss, twigs (thin bright streaks),
   scattered pebbles.
3. `rock` — grey cliff stone: ridged fbm strata with domain warp, crack
   veins (inverted ridged noise, dark), lichen speckle (grey-green 4%),
   strong normal relief.
4. `dirt` — packed earth path: fine granular noise + wheel-rut smoothing
   along one axis, embedded pebbles (rounded bumps in normal), subtle
   moisture mottling.
5. `snow` — wind-rippled snow: soft dune ripples (low-freq anisotropic),
   sparkle flecks (1% bright pixels), faint blue shadow tint in recesses.
6. `sand` — wet lake shore: fine ripples + darker moisture bands + tiny
   shell/pebble flecks.
Quality bar: each albedo must survive being tiled 3×3 at full-screen
without an OBVIOUS repeat (verify: montage a 3×3 tile with sharp and READ
the image). Total payload target ≤ 4.5MB.

## TERRAIN — src/world.js (desktop path only)
- Keep chunk geometry/pooling EXACTLY as is, but on desktop: (a) compute
  SMOOTH normals (geometry.computeVertexNormals, flatShading OFF for the
  terrain material only), (b) add a `splat` BufferAttribute (vec4) per
  vertex + a second vec2 for {snow,sand} — or pack 6 weights into two vec3
  attributes — weights derived from the existing biome/height/slope logic
  (grass, forest, rock, dirt-path?, snow, sand). Dirt weight: along the
  existing road/path lines near the village if cheaply derivable, else
  from MARSH biome → dirt. Keep vertex COLOR attribute too (used as a
  subtle 20% tint multiply for macro variation and to keep the painted AO).
- Material: ONE custom ShaderMaterial (Lambert-style lighting: use
  three's lights uniforms via `lights: true` + the `<lights_lambert_*>`
  chunks pattern, or build from MeshLambertMaterial.onBeforeCompile —
  onBeforeCompile on a MeshLambertMaterial is STRONGLY RECOMMENDED: you
  keep shadows, fog, and the new point lights for free) injecting: 6-way
  splat texture blend (2 texture reads per set: albedo + normal; use a
  weight threshold to skip sets with ~zero weight via uniform branching —
  or accept 12 reads, fine on desktop), tiling ~1/6 world-units, macro
  normal at 1/90 scale, tiling breakup: rotate/offset UVs per 30u cell by
  the noise texture (classic anti-tiling), normal mapping in world-space
  approximation (derive TBN from terrain normal + world axes — terrain is
  a heightfield so tangent = normalize(cross(N, Z-axis)) works).
- Slope rule: rock weight overrides where slope steep (normal.y < 0.72),
  blended over 0.1; snow accumulates on low-slope high-altitude only.
- The far shell keeps vertex colors (distance hides it) but darken its
  palette to match the textured near ground (compare screenshots!).
- Mobile/`!desktop`: zero changes — same Lambert vertexColors flatShading
  material as today (branch at material creation).
- Shadows: terrain still receiveShadow; verify the splat shader keeps
  shadow reception (onBeforeCompile path keeps it automatically).
- Perf: desktop budget +≤2ms GPU — verify draw calls unchanged (same
  chunks, one material). If the 12-sampler count exceeds mobile-safe
  limits it's fine — this material only exists on desktop.
- Acceptance (READ screenshots): standing in the meadow at noon and at
  golden hour, the ground must show blade-level detail with normal-mapped
  relief and NO visible tiling grid; path near village reads as packed
  dirt; cliffs show rock strata on steep faces; snowline blends naturally;
  compare against a 'before' screenshot — the difference should be
  night-and-day.

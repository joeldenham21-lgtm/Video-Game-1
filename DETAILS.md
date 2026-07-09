# ELDERFALL — Ambient Micro-Detail Layer Spec (src/details.js)

Addendum to CONTRACT.md + EXPANSION.md — ALL their rules apply. One agent
owns `src/details.js`. main.js will call `g.details = createDetails(g)` after
the other expansion modules and `g.details.update(dt)` in the loop.

`export function createDetails(g) → { update(dt), wind: { dir, gust } }`
Also set `g.wind = <that same wind object>` in the factory (dir: THREE.Vector3
horizontal unit, gust: 0..1 scalar) so future systems can share it.

## Budget architecture (hard limits: ≤12 draw calls, ≤1.5ms/frame CPU)
- POOL A — one THREE.BatchedMesh (Lambert, vertexColors): ALL rigid critters +
  moving props (rats, frogs, crows, chickens, cat, squirrel, eagle, snake segs,
  sign boards, chime tubes, weathervane, bucket, mole mounds, generic chore-
  villager parts, tent flap, shutters, laundry/flag cloth if done as rigid
  slats is NOT ok — cloth uses small vertex-grid meshes merged into ≤2 extra
  draw calls). BatchedMesh is in r160 (verified). Per-frame matrix writes for
  visible instances only.
- POOL B — one InstancedMesh double-sided 2-tri diamond quad, instance color:
  flutter things (moths, bats, petals, dandelion seeds, woodpecker flit).
- POOL C — THREE.Points additive (per-point size/color): glints, sparks,
  motes, dew, glitter path, shooting stars, breath fog, spindrift, wisp,
  stone motes.
- POOL D — THREE.Points normal blend, dark: ants, gnats, dust puffs, grain.
- POOL E — LineSegments transparent: cobwebs, spider silk, rope, ice crack.
- POOL F — InstancedMesh flat ring, transparent: water rings, puddles,
  footprint ovals.
- Bespoke allowed: aurora ribbon ShaderMaterial (1 draw call), cloud-shadow
  soft quad (1).
- ONE spatial activation system: hand-placed + seeded detail "actors" activate
  within 40u of player (sky/peak items exempt), round-robin update in 3
  buckets (1/3 per frame), all typed-array writes, zero per-frame allocation.
- OWN tiny WebAudio context for micro-sounds (bell, creaks, chimes, clucks,
  croaks, caws, squeaks, knocks, hoots, howl-answer, hum, splashes, whooshes),
  lazily created on first pointerdown (never throws, master gain ~0.35,
  simple synthesis: osc/noise/bandpass/metal-partials; add a cheap feedback-
  delay verb). Keep it quiet and tasteful — these sit UNDER g.audio's mix.
  Positional: scale volume by 1/distance and pan by camera-relative azimuth
  (StereoPannerNode), throttled.

## What to build (from ranked research — implement ALL of these 40):
1. GLOBAL GUST BUS first: gust(t) = layered snoise via core.fbm over time;
   everything below samples it so the world breathes coherently.
2. Moths orbiting lit windows/lanterns at night (find light positions via
   fixed offsets from core.POI.village; attracted to g.pointLight when torch on).
3. Noon bell: 4 metal strikes at dayFrac≈0.5 (+ scatter any nearby pool-B
   birds… just scare fauna via a brief repulse point you own).
4. Creaking hanging inn/forge sign: hinge swing from gust, creak at swing apex.
5. **Ants on logs**: two opposing lanes of dark points along baked splines on
   3-4 fallen logs/stumps (place your own log props via POOL A near forest
   paths — don't depend on world's scatter).
6. Anvil cadence at the forge: generic smith figure (your own, only if no NPC
   within 3u — check g.quests?.npcs lazily) OR just animated hammer prop +
   clang + orange sparks, 3-hit rhythm with shuffle pauses, daytime.
7. Window candle flicker: your own small emissive window-glow quads placed at
   village house positions (don't touch structures' meshes), ±12% snoise
   flicker, one goes dark & relights occasionally.
8. Wind chimes at inn door: 5 tubes, pendulum phases, gust-triggered 2-4
   pentatonic plucks, verb-heavy.
9. Chicken flock (4) near the well: peck/scratch/wander, dust puffs, flee-flap
   + clucks from player.
10. Sun/moon glitter path on Mirrormere: ~80 additive points along the
    reflection azimuth, per-point blink, low sun angles / night moon only.
11. Dew sparkle at dawn (0.2<dayFrac<0.3): ~120 grass-top glints within 25u.
12. Shooting stars at night: streak + fading tail every 40-120s; 1/10 big.
13. Rats behind the inn at night: dash-pause-dash between barrels, squeak+
    vanish when close.
14. Aurora over Drakespire: 1 ribbon shader (green→purple snoise curtains),
    deep night, seeded some-nights-only.
15. Crows at ruins/fences: hop-turn, caw with big verb at ruins, flush and
    resettle when approached.
16. Frogs at lake edge: dusk croak chorus call-answer; hop-plop + ring when
    approached (silence-as-you-near is the tell).
17. Fish jump enhancement: parabola leap + droplet sparkle + ring every
    20-60s (yours, independent of fauna's).
18. Laundry line behind inn: 3 cloth grids, gust traveling wave, wet flap
    sound on hard gusts.
19. Chore villager (ONE generic figure you own, simple A-to-B walking):
    morning chicken-feeding (grain arc, chickens converge), dusk lantern-
    lighting round (your candle-glow quads ramp as it passes), afternoon
    firewood splitting (thock + flying chips). One figure, three scheduled
    rituals — the "village is alive" backbone.
20. Gust leaf-bursts: on gust spikes, 12-15 leaf quads burst from nearest
    forest edge + swelling whoosh scaled by gust.
21. Cobweb glints in ruin doorways: strand fans + grazing-angle glint, gentle
    sway.
22. Weathervane on Greywatch tower: slerp to wind dir with overshoot wobble,
    faint squeak on big swings.
23. Player breath fog: cold nights + peak altitude, soft pale puffs ahead of
    camera every ~3s.
24. Bats at dusk from the ruins: 8 erratic flappers figure-eighting 90s,
    faint high chitters.
25. Water striders in the shallows: dark dots darting with micro-rings.
26. Well bucket: idle gust sway; every few minutes autonomous crank cycle
    (rope line, ratchet clicks, distant splash).
27. Ember pops from campfires (village hearth + bandit camp + breadcrumb
    fires — fixed positions from POIs): spark arcs + crack sound every 4-9s.
28. Eagle circling Drakespire: 60u thermal spiral, rare piercing cry, glide
    with occasional flap. Visible from the valley.
29. Shutter rattle on strong gusts: 2-3 loose shutter flaps + knock-knock.
30. Snake through meadow grass (rare): segmented slither crossing paths, dry
    rustle.
31. Dust motes in forge/inn doorway during golden hours.
32. Squirrel spiral up a pine when approached (forest cells), scrabble sound.
33. Puddle shimmer near the well + midday sparrow bath (flutter jitter +
    chirps).
34. Spider on a thread from the inn eave: descends/rewinds, only when player
    stands still >5s nearby.
35. Gnat columns under big oaks, dispersing through-walk with whine dip.
36. Spindrift off Drakespire's crest: white points streaming with gust,
    dawn/dusk backlit.
37. Dock rope creak + lap-slaps when standing on Mirrormere docks (+0.3°
    dock-area tilt illusion via your own thin overlay plank? skip the tilt if
    it needs structures' meshes — sound alone).
38. Owl at night + the ANSWERED wolf howl (howl far south, second howl
    answering farther, every few nights).
39. Will-o'-wisp at marsh edge at night: drifting additive blob that always
    recedes; never explained.
40. Standing-stone midnight motes: rising cold-blue points inside the circle
    + quiet 55Hz hum within 10u (0.98<dayFrac or <0.04).
41. Ice crack event on the peak snowfield: rare deep whoom-crack + hairline
    dark line underfoot 10s.
42. Footstep dust puffs + fading footprint ovals (8s, ring buffer 12) on
    village paths; white-rimmed snow prints on the peak.
43. Cloud shadow drift: one 60u soft dark quad sliding with wind, day only.
44. Mole hills: 2-3/day daytime meadow mounds scale up with dirt puff.
45. Dragonflies over lake reeds: hover-dart-hover with 20Hz wing shimmer.

Skipped by design (do NOT do): rain system, grass-parting shader patch,
chimney-smoke bending (cross-module — handled separately by the boss).

## Placement & independence rules
- Position everything from core.POIS / core.terrainHeight / hash2 seeds and
  your OWN props. NEVER traverse or mutate other modules' meshes. NEVER
  depend on structures/quests internals — lazy-read g.quests?.npcs positions
  only to AVOID overlapping the real NPCs.
- Time-gate by g.time.dayFrac; distance-gate by player position; keep the
  whole layer's update ≤1.5ms (profile mentally: 3-bucket round robin, 10Hz
  logic for most actors).
- Village-density bias: most actors live in/near Emberhollow so the hub feels
  richest; wilderness gets the lonely/mythic ones (wisp, aurora, eagle, owl,
  howl, spindrift, ice crack).
- g.paused: freeze behavior, keep gentle idle sway. Serialize nothing.

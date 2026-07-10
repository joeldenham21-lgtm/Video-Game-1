# ELDERFALL — Next-Level Contract (wave 4: desktop cinematic tier)

Addendum to CONTRACT.md (all rules apply unless stated). Desktop is now a
first-class target: `g.quality = {tier, shadows, desktop, ultra}` — `ultra`
is the desktop default (postprocessing allowed FOR ULTRA ONLY; mobile path
must remain untouched). Boss has already wired main.js: the five stub
modules below are constructed after forge and updated after it; the render
call is `g.postfx.render()` when present (falls back to renderer.render).

Camera handoff (already implemented): set `g.cameraLock = 'cinema'|'photo'`
→ player freezes input/camera writes and combat hides the viewmodel +
ignores combat input. RESTORE `g.cameraLock = null` when done; the camera
transform you leave behind is overwritten by player next frame (return it
roughly to eye position to avoid a visible snap).

File ownership (STRICT, one agent each):
- POSTFX: `src/postfx.js` (replace stub)
- CINEMA: `src/cinema.js` (replace stub)
- WEATHER: `src/weather.js` (replace stub)
- DICE: `src/dice.js` (replace stub)
- EXPLORE: `src/explore.js` (replace stub) + scoped `src/ui.js` additions
- MUSIC: `src/audio.js` (edit — preserve everything)

## POSTFX — src/postfx.js
`createPostfx(g) → { update(dt), render(), setEnabled(on) }`
- ONLY active when `g.quality.ultra` (else `render` property must be absent
  or falsy-check: simplest — if not ultra, return `{update(){}}` with NO
  render key so main falls back).
- Vendored passes exist: `vendor/postprocessing/{EffectComposer,RenderPass,
  ShaderPass,OutputPass,UnrealBloomPass,Pass,MaskPass}.js` and
  `vendor/shaders/{CopyShader,LuminosityHighPassShader,OutputShader}.js`.
  Import with relative paths (`../vendor/postprocessing/EffectComposer.js`).
- Chain: RenderPass → UnrealBloomPass (threshold ~0.82, strength ~0.55,
  radius ~0.4 — tune so ONLY emissives bloom: enchanted blades, fires,
  windows, aurora, sun glow; daytime terrain must NOT glow) → custom grade
  ShaderPass (filmic S-curve contrast +6%, saturation ×1.05, subtle
  vignette 0.22 at corners, very faint film grain 0.015 driven by uTime) →
  OutputPass. IMPORTANT with r160: when composer handles output, set
  renderer.toneMapping exposure interplay carefully — RenderPass renders
  HDR; keep ACES in OutputPass via renderer settings (test visually!).
- Handle resize (composer.setSize on window resize + when renderer
  setPixelRatio changes — poll size each frame cheaply and resize when
  changed). Respect adaptive resScale (composer.setPixelRatio same as
  renderer's current).
- Perf guard: if frame EMA > 20ms for 5s at ultra, drop bloom resolution
  (bloomPass.resolution halve) then disable bloom, notify once
  ("Graphics auto-tuned"). Expose setEnabled for the settings row EXPLORE
  adds.
- Verify by screenshot: night village (windows/lanterns bloom), enchanted
  blade glow, noon (no over-glow).

## CINEMA — src/cinema.js
`createCinema(g) → { update(dt) }`
- **Letterbox**: two black bars (DOM, smooth 0.35s slide) shown during any
  cinematic.
- **Dialogue cameras**: on `dialogueStart {npc}` (payload has npc with
  .group Object3D — quests NPCs expose group; guard missing): cameraLock
  'cinema', dolly the camera over 0.8s to an over-the-shoulder ¾ framing:
  position ≈ npc pos + offset (2.2u back-right of player-npc axis, eye
  1.55u), lookAt npc head (pos + 1.6u). Subtle slow drift while talking
  (breathing dolly ±0.08u). On `dialogueEnd`: glide back to player eye
  position over 0.5s then release cameraLock. Skip entirely if npc has no
  position (books etc. don't emit dialogueStart — only quests does).
- **Boss intros**: on `bossBar {name}` first-time-per-boss (track in
  g.flags.cinemaSeen): 2.6s intro — cameraLock, letterbox, camera swings
  to frame the boss from 8-12u (find enemy via g.enemies.list matching
  name), boss title card DOM: huge serif name + epithet subline (VHASTRIX
  — THE EMBER TYRANT; LORD MORVANE — THE THIRST BELOW; THE BARROW LORD —
  KING OF DUST; STONEBRIDGE TROLL — THE TOLL; VARGR REDFANG — YOUR DEATH,
  REMEMBERED; echoes get "ECHO OF …"), drakeRoar/type sfx via g.audio.
  Player invulnerable during intro (set a flag combat's tryBlock can't see
  — simplest: end intro if playerDamaged fires; ALSO hard-cap duration).
  Skippable on any key/tap.
- **Quest-complete vista**: on `questCompleted` for MAIN quests only
  (quest id contains 'main'; guard): 2s slow 25° orbital pan around the
  player + letterbox, golden flash handled by ui already.
- **EPILOGUE SLIDESHOW** (the crown): when the final main quest completes
  (drakeDead set during a questCompleted, or explicit flag from quests —
  detect: questCompleted event AND g.flags.drakeDead): after the
  celebration dialogue ends (wait for !g.paused), fade to black, then
  Witcher-style ending cards: full-screen sepia/parchment panels (CSS
  painted-look: layered gradients + vignette + a large emblem glyph per
  card), each with 2-4 sentences of narration reflecting the player's
  actual flags — cards for: the village saved (always), the witch
  (croneChoice peace → she trades openly / witchDead → her hut stands
  empty), Morvane (morvanePact vs morvaneDead — the pact card should
  sting), Vargr (vargrDead vs vargrWins>0 alive — 'somewhere he sharpens
  his blade and remembers'), the amulet (amuletReturned/kept/sold), the
  Wardstones, and a final 'the road goes on' card teasing hunts/blood
  moons. Advance on tap/key or 9s auto; music: g.audio keeps playing.
  End: fade back to gameplay, notify 'Elderfall — thank you for playing
  (the world continues)'. Runs ONCE (flag epilogueSeen), re-watchable from
  pause menu?? no — keep once; journal is enough.
- All DOM self-injected, parchment/serif styling consistent with ui.js.

## WEATHER — src/weather.js
`createWeather(g) → { update(dt), state }` — state: 'clear'|'overcast'|'rain'|'storm'
- Seeded fronts: hash by (dayCount, segment-of-day) → weather persists
  20-40 game-minutes; clear 55%, overcast 20%, rain 17%, storm 8%. Expose
  `g.weather.state` + `intensity` 0..1 (others may read).
- RAIN: pooled streak particles (LineSegments or stretched quads, ~400)
  in a 24u box around the camera, fall 18u/s + wind shear from g.wind;
  ground splash rings reuse own small ring pool (~30). Fade in/out 8s.
- STORM: rain ×1.6 + lightning: every 6-18s a sky flash (brief fullscreen
  additive white-blue overlay 80ms + second echo flash) then thunder via
  g.audio.play('thunder') delayed 0.5-3s by distance; occasional visible
  jagged bolt (own LineSegments, 0.12s) striking far terrain.
- Audio: rain bed via g.audio? audio.js owns ambience — MUSIC agent adds
  `setRain(level)` API; call it lazily if present (g.audio.setRain?.(x)).
- Sky coupling WITHOUT editing sky.js: dim scene during rain by lerping
  a exposed multiplier — sky already reads overcast internally; simplest:
  add a translucent grey dome-tint DOM overlay? NO — instead: modulate
  renderer.toneMappingExposure ×(1 − 0.25×intensity) smoothly (restore on
  clear) and raise scene.fog density by pulling fog.near/far in by up to
  35% while raining (save originals each frame from sky's values — apply
  AFTER sky.update since weather updates later in the loop — verify order:
  weather updates after forge, sky before — OK).
- No rain indoors: skip emitters when camera is under a structure roof —
  approximation: skip when inside village building colliders? Buildings
  aren't enterable; skip this.
- Blood-moon nights (g.enemies?.bloodMoon active via notify? read
  g.flags?) — don't fight the red mood: force 'clear' while a blood moon
  is active if detectable (check g.flags for the moon-active flag enemies
  uses; else skip).

## DICE — src/dice.js
`createDice(g) → { update(dt) }` — Witcher-1-style dice poker.
- Interactable "🎲 Dice Poker — Bram" at a tavern-side table position
  (near Bram's post, offset so both reachable). Also Fenwick plays when
  he's stopped (optional, same panel, different taunts).
- Rules: 5 dice each, ante (10/25/50g selectable), roll → hold/reroll one
  time each, hands ranked poker-style (pair…five of a kind). Opponent AI:
  simple EV (keeps pairs+, rerolls rest), light personality taunts.
- Panel: parchment table felt, 3D-looking CSS dice (2D unicode/SVG pips
  fine but styled richly), roll animation (dice tumble via CSS keyframes +
  audio 'uiClick' rattles ×3), win/lose flourish + gold exchange through
  g.player.addGold (bet held at start; guard gold ≥ ante). g.paused while
  open. Track record in g.flags.dice = {w,l,gold}.
- Bram's dialogue: do NOT edit quests.js — your interactable is separate.

## EXPLORE — src/explore.js + scoped ui.js additions
`createExplore(g) → { update(dt) }`
- **Fast travel signposts**: one carved signpost prop (own low-poly:
  post + 2-3 direction fingers) at each major POI (village, ruins, stones,
  tower, camp, shrine, witch hut ~(-260,-520), stonebridge (330,-260),
  lake dock) + interactable "Signpost — Travel" ENABLED only for
  discovered POIs (g.flags.discovered) and no aggroed enemy within 30u
  (check g.enemies.list aggro; notify 'Enemies nearby' if blocked). Panel:
  list of discovered destinations w/ distances; select → fade to black
  0.5s, teleport player (safe offset from POI center, terrainHeight+0.1),
  advance g.time.dayFrac by distance/3000 of a day (min 0.01), fade in.
  Emits nothing; save-safe (position persists already).
- **Hunter senses** (V key hold / double-tap compass on mobile): 4s pulse
  — desaturate/darken overlay (CSS backdrop-filter grayscale(0.6)
  brightness(0.8), radial clear center), and DOM pips projected over:
  interactables within 30u (gold ✦), the active hunt target direction
  (red ☠), live enemies within 40u (faint red dots) — project via
  camera (Vector3.project, guard behind-camera), update each frame while
  active, 8s cooldown, soft whoosh (g.audio.play('wheelOpen')).
- **Photo mode** (P key / pause-menu button): g.paused=true +
  cameraLock='photo'; free-fly camera (WASD+QE up/down+mouse look, shift
  fast) starting at current eye; HUD hidden (add a body class ui.css
  respects — coordinate: add the class 'ef-photo' to document.body and in
  your scoped ui.js addition hide #hud children except nothing), controls
  overlay (small hints), time-of-day scrub slider (drives g.time.dayFrac
  live — sky updates even paused? sky.update receives dt but reads dayFrac
  — paused freezes updates in most modules BUT main still calls sky.update
  every frame with dt; dayFrac changes reflect — VERIFY visually),
  FOV slider (camera.fov 40-100 + updateProjectionMatrix, restore on
  exit), 'Capture' button → canvas.toBlob PNG download 'elderfall.png'
  (needs preserveDrawingBuffer=false workaround: render explicitly right
  before toBlob via g.postfx?.render() || renderer.render, then toBlob
  synchronously — test it works!). Exit (Esc/P) restores fov/camera/HUD/
  pause.
- **ui.js scoped additions ONLY**: (1) pause menu rows: 'Photo Mode'
  button (calls g.explore.openPhoto?.() — expose it), 'FOV' slider
  (55-95, persists localStorage 'elderfall_fov', applied to camera base
  fov — coordinate with player's sprint FOV kick which lerps around a
  base: player reads camera.fov once at boot... check player.js — if it
  caches baseFov, expose g.baseFov instead and have your slider set
  camera.fov AND g.baseFov guarded), (2) 'ef-photo' body class hides #hud.
  Keep every existing behavior.

## MUSIC — src/audio.js (edit, preserve all)
- **Location themes**: gentle motif variation by region (read player pos
  lazily): village = warmer major-leaning lute voicings; ruins/cemetery =
  sparse minor + low drone; lake = slower, airy; mountains = open fifths.
  Crossfade over 6s on region change (region check every 2s).
- **Combat intensity tiers**: current drums+drone = tier 1; add tier 2
  (≥3 aggroed or elite: + syncopated second drum + tremolo string synth)
  and boss tier (bossBar active: + slow choir-ish pad — detuned voices
  through formant-ish filters — and deeper hits). Crossfade cleanly.
- **Fiddle**: a bowed-string lead synth (sawtooth through bandpass with
  slow vibrato + bow-noise transient) that trades phrases with the lute
  during day exploration (sparse — one phrase per 20-40s max).
- **setRain(level)**: rain bed (filtered pink noise, level 0..1) +
  distant intermittent rumble at level>0.7. Exposed on the returned api.
- Keep the mix restrained; silence is still golden.

## Verification (each agent)
node --check every touched file; Playwright desktop viewport 1600×900
(pattern test/dbg.mjs, chromium /opt/pw-browsers/chromium, swiftshader
args, ?debug, #btn-new, wait 12s): drive YOUR feature end-to-end,
screenshot, READ the screenshot, iterate. Zero console errors. Do not
commit; do not touch files beyond your ownership.

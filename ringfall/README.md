# RINGFALL

A first-person roguelite arena shooter for **phone and laptop browsers**. One self-contained HTML file: no install, no downloads, no asset files. Everything you see and hear (geometry, textures, the gas giant, the soundtrack) is generated in code at load time.

> Halcyon Ring has fallen silent. The Choir — porcelain machines that sing each other into existence — have taken the station.
> You are Unit Seven. Descend ten floors to the Core and end the song.

**Play:** open `ringfall/index.html` in any modern browser (Chrome, Safari, Edge, Firefox), or serve the repo and visit `/ringfall/`.

## How it plays

- **Ten floors, two bosses.** Each floor is a floating platform above a gas giant, with jump pads, high ledges and cover, fought in waves. Floor 5 is **the Conductor**; floor 10 is **the Heart of the Choir**. Beat it and endless mode opens.
- **Shoot → crack → shatter.** Damaged constructs crack (◆). Punch them to *shatter* them: a lunge, a burst of porcelain and repair orbs. Aggression is how you heal.
- **Punch their shots back.** Sentinel orbs and boss volleys can be knocked back with a well-timed punch for massive damage.
- **Move like you mean it.** Dash (you can't be hit mid-dash), double jump, jump pads, and rocket jumps with the Nova Launcher.
- **Overdrive.** Deal damage to charge it, then slow the world to a crawl while you move at full speed.
- **Augments.** After every floor you pick 1 of 3 upgrades (27 in all: chain lightning, exploding corpses, blade dashes, a phoenix revive…). Every run builds differently.
- **Style rank.** Stylish kills (aerial, core shots, shatters, deflects, multi-kills) raise you from D to SSS, which multiplies your score.

Four weapons: **Pulse Carbine**, **Scattergun**, **Arc Lance** (pierces every enemy in a line; unlocked after floor 2) and **Nova Launcher** (splash plus rocket jumps; unlocked from the Conductor).

Five enemy types: Mites (dive-bombing swarm), Sentinels (orb turrets), Lancers (snipers with a visible red lock-on), Brutes (armoured chargers; bait them into walls) and Wardens (shield the others; kill them first). Elite variants show up later.

## Controls

| | Phone / tablet | Keyboard + mouse | Controller |
|---|---|---|---|
| Move | left thumb (floating stick) | WASD | left stick |
| Aim | drag right side | mouse (click to capture) | right stick |
| Fire | **automatic when on target**, or hold ◎ | left click | RT |
| Scope | — | right click | LT |
| Jump / double jump | ⌃⌃ | Space | A |
| Dash | ≫ | Shift | B |
| Punch / shatter / deflect | ✊ | F or E | RB |
| Overdrive | ⚡ (when lit) | Q | LB |
| Weapons | ⇄ | 1–4, mouse wheel | Y |
| Reload | ↻ | R | X |
| Pause | top-left | Esc | Start |

Touch devices get aim assist (slowdown and a gentle pull toward targets) and bullet magnetism. Auto-fire, sensitivity, left-handed layout, FOV, graphics quality and volumes are all in Settings.

## Performance

The renderer targets 60 fps on mid-range phones:

- HDR pipeline (MSAA, dual-filter bloom, ACES tone mapping, chromatic aberration, vignette), with every pass sized for mobile GPUs.
- **Adaptive resolution:** internal resolution drops when frames run long and recovers when they're steady. On *Auto* it steps quality down as a last resort.
- Static arena geometry is merged per material; particles, beams, decals, debris, projectiles and pickups are instanced (one draw call each).
- All shaders are compiled at boot so the first fight doesn't hitch.

Quality presets: Low / Medium / High / Ultra (Settings → Graphics quality). Phones start on Medium, desktops on High.

## Building

```sh
cd ringfall
npm install          # esbuild + three.js (dev only)
node build.mjs       # → index.html (standalone) + dist/artifact.html (fragment for hosted viewers)
node build.mjs --dev --serve   # unminified, inline sourcemaps, http://localhost:8080
```

Source layout:

```
src/main.js            boot, game-state flow, main loop, time control (overdrive / slow-mo / hitstop)
src/engine/            renderer + post-processing, unified input (touch / mouse / gamepad)
src/world/             sky shader, procedural textures, arena layouts + builder, collision, stage lighting
src/game/              player, weapons + viewmodels, enemies + models, bosses, projectiles, pickups,
                       augments, style meter, director (floors/waves), story, settings
src/fx/                instanced particles, beams, point-light pool, decals, debris
src/ui/                HUD, menus, styles
src/audio.js           procedural Web Audio SFX + adaptive generative music
test/                  headless screenshot + bot playtest scripts (Playwright)
```

Tests: `node test/playtest.mjs --god --seconds=120` has a bot play the game headless (fast-sim) and reports floors, kills and errors. `node test/shot.mjs --phone --desktop` takes screenshots.

## Credits

Code, art and sound: procedural, written for this project. Rendering: [three.js](https://threejs.org) r160 (MIT), bundled. UI type: Chakra Petch and Share Tech Mono (Google Fonts, SIL OFL), with system fallbacks offline.

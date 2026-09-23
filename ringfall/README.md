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

## Graphics and performance

Quality is picked from the GPU on first run: RTX/Radeon-class laptops and desktops get **Ultra**, recent flagship phones (Adreno 7xx/8xx, Apple GPUs, Mali-G7xx+) get **High**, and everything else gets Medium or Low. You can change it any time in Settings → Graphics quality.

- **Frame pipeline:** half-res depth prepass → SSAO with a depth-aware blur → HDR world render with MSAA → viewmodel → dual-filter bloom → sun shafts → AgX filmic tone mapping with light grain and vignette.
- **Materials and lighting:** procedural PBR plating (albedo, normal, roughness and metalness), with clear-coated decks and glazed porcelain constructs on High and Ultra. Reflections come from a capture of the arena itself, not just the sky. Warm practical lights sit on the pillars, and shadows go up to 4096².
- **Bloom:** restrained and thresholded, so only the brightest cores, muzzle flashes and the star glow.
- **Adaptive resolution:** internal resolution drops when frames run long and recovers when they're steady. On *Auto*, quality steps down only after several seconds of sustained slowdown. One-off hitches (tab switch, GC) are ignored.
- **Draw calls:** static arena geometry is merged per material. Particles, beams, decals, debris, projectiles and pickups are instanced, one draw call each.
- **No first-fight hitch:** all shaders are compiled at boot. The light count is fixed, so nothing recompiles mid-fight.

## Audio

**Music:** an orchestral score played by real instruments. Every note comes from recordings of real players: string sections, horns, trumpets, trombones, tuba, woodwinds, harp, a Steinway grand, pipe organ, timpani and orchestral percussion. The recordings are the CC0 [VS Chamber Orchestra 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) and [Versilian Community Sample Library](https://github.com/sgossner/VCSL).

The pieces are written out note by note and rendered offline (see `tools/score/`):

| Piece | Where | Key / tempo | Writing |
|---|---|---|---|
| Halcyon | title | D minor, 68 | Cello theme under a violin halo, then the horn with a violin descant |
| Aperture | sector 1 | E minor, 128 | Spiccato ostinato; the horns turn the title motif into a battle theme |
| Choir Nave | sector 2 | C♯ minor, 6/8 | Pipe organ, a horn chant over a trombone chorale, Phrygian darkening |
| The Conductor | first boss | G minor, 144 | 16th-note violin engine, horn and trumpet fanfare |
| Heart of the Choir | final boss | D minor, 80 | Organ and full orchestra; timpani heartbeat; the title theme returns |
| Halcyon, Restored | victory | D major, 72 | The theme in major, then a bittersweet G → Gm → D ending |

- **Adaptive layers:** each combat and boss piece is three stems (bed, pulse, drive) that fade in and out with the fight's intensity.
- **Stingers:** in the key of whatever is playing, for wave starts, sector clears, boss defeats, augment picks and death.
- **Loops:** sample-accurate. Each file carries a sync click that absorbs the MP3 decoder's delay.
- **Loading:** files are downloaded in the order they're heard. Only the current and next pieces stay decoded, which saves memory on phones.
- **Fallback:** if the files can't load (for example when the page is opened from disk), a procedural score takes over.

**Sound effects:** synthesised live with Web Audio. They are built from noise bursts, body resonances, mechanical clicks and a room tail. A limiter and a gentle high-shelf keep sustained fire from getting harsh. Loops are capped per sound and stop themselves if the game stops updating them.

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
src/audio.js           Web Audio engine: synthesised SFX, recorded-score player (adaptive stems), procedural fallback score
music/                 rendered score (MP3 stems + stingers) and its manifest
tools/score/           the score: note-by-note compositions, sampler/reverb renderer, analysis tools
test/                  headless screenshot + bot playtest scripts (Playwright)
```

Tests: `node test/playtest.mjs --god --seconds=120` has a bot play the game headless (fast-sim) and reports floors, kills and errors. `node test/shot.mjs --phone --desktop` takes screenshots.

## Credits

Code, art, sound effects and score: written for this project. Orchestral samples: VS Chamber Orchestra 2 CE and Versilian Community Sample Library by Versilian Studios (CC0). Rendering: [three.js](https://threejs.org) r160 (MIT), bundled. UI type: Chakra Petch and Share Tech Mono (Google Fonts, SIL OFL), with system fallbacks offline.

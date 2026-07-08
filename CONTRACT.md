# ELDERFALL — Engine Contract (v1)

You are one of several builder agents. You own EXACTLY ONE file in `src/`.
Read this whole document + `src/core.js` before writing code. Other agents
build the other modules simultaneously against this same contract — if you
deviate from a signature, integration breaks.

## The game

**Elderfall** — an open-world first-person fantasy RPG for MOBILE BROWSERS
(and desktop), inspired by Skyrim / The Witcher 3 / LOTR. Low-poly,
vertex-colored, flat-shaded art style pushed through ACES tone mapping —
think "stylized epic": golden sunsets, fog-shrouded ruins, a huge mountain
(Drakespire) always on the northern horizon.

Design pillars (from research — follow these):
- **Weenies**: landmarks must read as silhouettes on the horizon.
- **Discovery**: entering a named POI radius → chime + banner (handled via `discover` event).
- **Combat juice**: hitstop, screen shake, layered sound, flinches, particles on EVERY hit.
- **Golden hour bias**: dawn/dusk last long and look gorgeous. Nights are dark and dangerous.
- **Minimal HUD**: Skyrim-style top compass strip, bars fade when full, center dot crosshair.

## Hard technical rules (mobile GPU budgets)

- Target: mid-range Android, 60fps. Total draw calls ≤ ~120, tris on screen ≤ ~350k.
- NO textures except tiny procedural CanvasTextures where specified. Vertex colors + `flatShading: true` everywhere. Materials: `MeshLambertMaterial` (or custom ShaderMaterial where specified). NO MeshStandardMaterial.
- NO postprocessing, NO EffectComposer, NO additional lights (sun + hemisphere exist in sky.js; ONE shared PointLight `g.pointLight` exists, owned by combat.js).
- NO three.js addons/examples imports — ONLY `import * as THREE from 'three'` (import map provided) and `import { ... } from './core.js'`. Do NOT import other src modules.
- ZERO per-frame allocations in `update()`: preallocate temp Vector3s etc. at module scope. Create geometry/materials once.
- Everything deterministic from `core.js` seeds — no `Math.random()` for world placement (fine for transient VFX).
- No external network fetches, no asset files. Everything procedural.
- Plain modern JS (ES2020 modules). No TypeScript syntax. Your file must parse standalone.
- Do not touch `renderer` settings, `scene.fog` (sky.js owns fog), or camera projection (player owns camera transform; main owns FOV base).

## Shared context object `g`

`main.js` creates one context object and passes it to every factory:

```js
g = {
  scene, camera, renderer, canvas,          // three.js basics (camera: PerspectiveCamera)
  events,                                   // event bus from core.makeEvents()
  time: { elapsed, dt, rawDt, dayFrac, dayLength, timeScale },
  quality: { tier: 'high'|'low', shadows: boolean },
  flags: {},                                // shared persistent key/value store (saved)
  colliders: [],                            // static cylinders {x, z, r, hMin?, hMax?} — structures pushes, player/enemies avoid
  interactables: [],                        // {pos: Vector3, radius, label, prompt?, onInteract(), enabled?:()=>bool}
  paused: false,                            // menus/dialogue → gameplay updates freeze
  pointLight,                               // one shared THREE.PointLight, intensity 0 initially — combat.js drives it
  // subsystems (assigned in this order during boot):
  audio, world, sky, structures, player, enemies, combat, quests, ui, save
}
```

- `time.dt` is timeScale-adjusted (slow-mo aware); `rawDt` is real. Clamped ≤ 0.05.
- `dayFrac`: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Full cycle `dayLength` = 720s.
- Subsystems may be `undefined` during your factory call — only access `g.<other>` inside `update()`/event handlers/callbacks, NEVER at factory time. Exception: factories may access `g.scene/camera/renderer/events/time/quality/flags/colliders/interactables/pointLight` immediately.
- In `update(dt)`: if `g.paused`, gameplay logic must freeze (visual idle anims may continue). `dt` you receive is already scaled.

## Events (exact names)

| event | payload | emitted by |
|---|---|---|
| `attackSwing` | `{weapon, heavy}` | combat |
| `hitLanded` | `{pos:Vector3, kill:bool, heavy:bool}` | combat |
| `parry` | `{}` | combat |
| `enemyKilled` | `{type, name, pos:{x,y,z}, xp}` | enemies |
| `spawnLoot` | `{pos:{x,y,z}, kind:'gold'|'potion'|'item', amount, itemId?}` | enemies/structures |
| `pickup` | `{kind, amount, itemId?}` | combat (loot system) |
| `playerDamaged` | `{amount, fromPos?}` | player |
| `playerDied` | `{}` | player |
| `levelUp` | `{level}` | player |
| `footstep` | `{surface:'grass'|'stone'|'water'|'sand'}` | player |
| `equip` | `{id}` | combat |
| `discover` | `{poi}` (entry from core.POIS) | quests |
| `questStarted` / `questUpdated` / `questCompleted` | `{quest, text?}` | quests |
| `dialogueStart` | `{npc, node}` (see quests spec) | quests (via ui request) |
| `dialogueEnd` | `{}` | ui |
| `combatState` | `{inCombat:bool}` | enemies |
| `notify` | `{text, sub?}` | anyone (ui shows toast) |
| `bossBar` | `{name, hp, maxHp}` or `null` | enemies (ui shows boss bar) |
| `chestOpened` | `{id}` | structures |
| `gameLoaded` / `gameSaved` | `{}` | save |

## Module specifications

### 1. `src/world.js` — terrain, vegetation, water
`export function createWorld(g) → { update(dt) }`
- Chunked terrain: chunk = 64u, PlaneGeometry 32×32 segments inner (5×5 grid around player), 16×16 outer ring (7×7 total). Pool + recycle. Heights from `core.terrainHeight`; per-vertex colors from `core.biomeAt` + height/slope banding (meadow greens, forest darker green, rock greys, snow white, sand, marsh). Jitter color per vertex with `hash2` for richness. `flatShading: true`, `vertexColors: true`, MeshLambertMaterial (one shared). Max 1 chunk (re)build per frame.
- **Far shell**: one static 4400×4400 mesh, 128×128 segs, built once at load (may take ~100ms), same coloring (coarser), `position.y -= 0.5`, `material.polygonOffset` to avoid z-fight. This makes Drakespire visible from everywhere — critical.
- Vegetation: GLOBAL InstancedMeshes (`frustumCulled = false`), fixed capacity: pine trees ~650 (two geoms: pine + oak-ish leaf blob), rocks ~450, grass tufts ~3500 (cross of 2-3 low triangles, opaque, vertex colored), bushes ~250, flowers ~200. Scatter deterministically per chunk cell via `hash2` scaled by biome (forest: dense trees; meadow: grass+flowers; rocky/snow: rocks, sparse snow pines). Refill instance matrices incrementally when player crosses a 32u boundary (spread work across frames, ≤1ms/frame). Trees within ~240u, grass within ~70u. No trees/grass inside POI radii (`core.POIS` with flatten) or below WATER_LEVEL+1.
- Water: one 1200×1200 plane (64×64 segs) at `WATER_LEVEL`, follows player snapped to 8u, custom ShaderMaterial: 3 summed sines vertex displacement, fragment = deep/shallow blue gradient + fresnel toward sky horizon color + moving sparkle noise, `transparent`, opacity ~0.86. Uniform `uTime` advanced in update; uniform `uSunDir` (read `g.sky.sunDir` lazily in update, guard undefined).
- Vertex-color ambient occlusion: darken forest-floor verts slightly.

### 2. `src/sky.js` — sky dome, lighting, day/night, weather
`export function createSky(g) → { update(dt), sunDir: THREE.Vector3, sunLight, horizonColor: THREE.Color }`
- Dome: SphereGeometry(1900, 32, 15) BackSide ShaderMaterial: 3-stop vertical gradient (uniforms horizon/mid/zenith colors), soft sun disc + wide warm glow via `dot(dir, uSunDir)`, procedural star hash (fade by sun elevation), 2-layer drifting fbm clouds tinted by sun color. Dome follows camera x/z.
- Moon: soft disc opposite-ish the sun (offset), simple sprite or in-shader.
- Day/night from `g.time.dayFrac`. Color keyframes: night (deep indigo, starry) → dawn (long! rose/amber) → day (bright cyan-blue) → dusk (long! burnt orange/purple) → night. Sun elevation = sin curve; azimuth sweeps E→W.
- Lights: `DirectionalLight` (warm white day ~2.8 intensity, amber at golden hour, off at night; moonlight = cool dim ~0.35 blue at night) + `HemisphereLight` (sky/ground tints follow palette, 0.5–1.0). 
- Fog: `g.scene.fog = new THREE.Fog(...)` created here; per-frame set `fog.color` = horizon color; near ~180, far ~1500 day; near 60/far 500 at night (interpolate smoothly). Also set `g.scene.background` = horizon-ish color (or keep dome covering all).
- Expose `sunDir` (unit Vector3, updated in place) and `horizonColor` (THREE.Color updated in place) for water/others.
- Weather: subtle — slow cloud-density cycles via noise over `time.elapsed` (clear ↔ overcast tint). Optional light rain state: dim light, desaturate, (particle rain optional if cheap). Keep simple and robust.
- Shadows (only if `g.quality.shadows`): configure sunLight.castShadow, 1024 PCF map, ortho frustum ±45u snapped to texel grid, following `g.camera` position. Terrain does NOT cast (receives only).

### 3. `src/player.js` — first-person controller, stats
`export function createPlayer(g) → player`
```js
player = {
  update(dt), position: THREE.Vector3, velocity: THREE.Vector3,
  yaw, pitch, onGround, inWater, isBlocking,           // isBlocking SET BY combat
  stats: { hp, maxHp:100, stamina, maxStamina:100, mana, maxMana:60,
           level:1, xp:0, xpNext:100, gold:25, potions:2 },
  bonus: { dmg:0, maxHp:0 },                            // quest rewards add here
  damage(amount, fromPos?), heal(n), addXP(n), addGold(n),
  addShake(strength),                                   // screen shake impulse 0..1
  respawn(),                                            // at village, half hp
  eyeHeight: 1.7, radius: 0.45,
  serialize() → obj, deserialize(obj),
}
```
- Reads `g.ui.input` (guard undefined first frames). Look: `input.look.dx/dy` are per-frame radians-ish deltas (ui pre-scales by sensitivity); apply to yaw/pitch, clamp pitch ±1.35rad. Move: `input.move` x=strafe y=forward in [-1,1]. Walk 4.6u/s, sprint 7.6 (needs stamina>0, drains 12/s, regen 16/s after 0.8s delay; jump costs 12). Acceleration ~40, ground friction ~10. Gravity 22, jump vel 7.6. 
- Ground = `terrainHeight(x,z)`; slide down slopes > ~0.75 steepness. Cylinder colliders in `g.colliders`: push-out horizontally (respect hMin/hMax vs player feet Y if present).
- Water (`y_feet < WATER_LEVEL`): move ×0.45, no jump but small buoyant float, can't sink deeper than ~1.4 below surface (auto-float), sprint disabled.
- Camera: `g.camera` positioned at `position + eyeHeight` with head-bob (subtle, speed-scaled; emit `footstep` on bob troughs with surface from biome/structure), landing dip, sprint FOV +6 lerp (base FOV read once from camera), damage shake via addShake; shake decays exp; applied as small random camera rotation offset.
- Blocking (set by combat): move ×0.5. Blocked hits cost stamina instead of hp (combat handles logic, player exposes state).
- Fall damage > 12 m/s impact. `damage()`: applies armor-free hp loss, emits `playerDamaged`, addShake; hp ≤ 0 → emit `playerDied` once (ui shows death screen, calls respawn()).
- Level: `addXP` → level-up at xpNext (×1.35/level), +10 maxHp +8 stamina +6 mana, full heal, emit `levelUp`.
- Spawn at (6, terrainHeight, 14) facing village center; `respawn()` there.

### 4. `src/combat.js` — weapons, viewmodel, projectiles, loot, particles
`export function createCombat(g) → { update(dt), equip(id), current, WEAPONS }`
- Weapons: `sword` (light 14 / heavy 26 dmg, range 2.9, arc 65°), `bow` (hold to draw 0.9s, arrow projectile, 10–34 dmg by draw, gravity drop), `fire` (fireball projectile, mana 14, 30 AoE dmg r=3.5, explosion), `heal` (mana 20, +35 hp, green swirl), `torch` (light source; can bash 6 dmg), `potion` (consume one of stats.potions → +45 hp). Aldric's Ember (quest sword): if `g.flags.hasAldricSword`, sword gets +10 dmg and ember particles — check flag in update/equip.
- Viewmodel: procedural low-poly right arm + weapon meshes parented to `g.camera` (bottom-right), subtle sway from look deltas + bob. Procedural animation curves: idle sway → swing arcs (light 0.32s, heavy 0.55s + windup), bow draw pull, cast push. Torch has flame (small particle flicker + drives `g.pointLight` warm, radius ~9, follows camera; also fireball in flight takes over the light briefly).
- Attacks: input mapping done here from `g.ui.input`: `attackPressed`(tap)=light; hold ≥0.35s then release=heavy (sword). Stamina: light 10, heavy 22 (skip attack if <cost). Hit test at swing apex: `g.enemies.queryHit(camPos, camDir, range, arc)` → for each: `g.enemies.damage(e, dmg×(1+g.player.bonus.dmg), dir, {heavy})`. On any hit: **hitstop** (set `g.time.timeScale=0.05` for 70ms — main restores via combat, implement with a timer you own: store `g.hitstopUntil = performance.now()+70`... NO — implement: combat sets `g.requestHitstop(ms)` provided by main), `g.player.addShake(heavy?0.5:0.25)`, spark/blood particles at hit point, sounds via `g.audio.play('hitFlesh')`.
- Block/parry: while `input.blockHeld` set `g.player.isBlocking=true`. Parry window: if an enemy hit arrives ≤0.22s after block started (enemies call `g.combat.tryBlock(dmg)` — expose it: returns `{blocked, parried}`), parry → enemy staggered via return value, spark burst, `parry` event, brief 0.3× slow-mo 250ms via `g.requestHitstop(250)`.
- Projectiles: pooled arrows (thin box+fins) & fireballs (glowing sphere + trail particles); gravity for arrows; collide vs enemies (`queryHit` point test — add `g.enemies.queryPoint(pos, r)`), terrain (`terrainHeight`), max life 6s. Fireball explosion: AoE damage all in r=3.5, particle burst, light flash.
- Loot pickups: listen `spawnLoot`; floating bobbing icons (gold=small coin octahedron, potion=red flask, item=glowing rune). Magnet toward player <3.5u, collect <1.2u → emit `pickup`, apply: gold→`addGold`, potion→`stats.potions++`, item→set `g.flags['item_'+itemId]=true`. Pool ≤ 40.
- Particles: ONE pooled Points system (~300 verts, vertexColors, additive) for sparks/blood/embers/heal swirl/explosions. API internal.
- `equip(id)`: switch viewmodel (quick lower/raise 0.25s), emit `equip`. Start with sword. Hotbar ids: `['sword','bow','fire','heal','torch','potion']` (potion = use, doesn't stay equipped; auto-return to previous).

### 5. `src/enemies.js` — AI, models, spawning, boss, nemesis
`export function createEnemies(g) → { update(dt), list, spawnAt(type,x,z)→enemy, queryHit(origin,dir,range,halfAngle)→enemy[], queryPoint(pos,r)→enemy[], damage(enemy,amount,dir?,opts?), countAlive(type), bossAlive(), serialize(), deserialize(o) }`
- Types & stats (hp/dmg/speed/xp): `wolf` 30/8/6.2/20 (packs 2-3, flee <25% hp, howl), `goblin` 40/10/4.4/25 (jittery, zigzag), `bandit` 70/14/4.8/40 (blocks sometimes), `skeleton` 55/12/3.6/35 (ruins, night; rattle), `barrowlord` 260/22/3.2/150 (mini-boss in ruins crypt, big skeleton, summons 2 skeletons at half hp), `drake` 700/28/8(fly)/500 (boss at Drakespire: circles overhead, swoop attacks, fire breath = line of fire particles + damage ticks; lands at 40% hp for melee phase; emits `bossBar` updates while player within 120u, `bossBar:null` when dead/far).
- Nemesis: bandit lord **Vargr Redfang** at Redfang Camp (bandit ×2.2 stats, red plume). If he kills the player: `g.flags.vargrWins=(count+1)`, next encounter he has +15% hp/dmg per win and taunt via `notify` ("Vargr Redfang remembers you"), visible scar (extra red stripe per win). His death sets `g.flags.vargrDead=true` (stays dead).
- Models: procedural low-poly from boxes/cones/spheres per type (≤7 meshes per enemy, shared geometries/materials across instances — build geometry library ONCE). Distinct silhouettes + colors. Blob shadow: shared radial-gradient CanvasTexture quad at feet.
- Animation (procedural, no bones): leg/arm swing sin while moving, idle breathe, attack windup **telegraph 0.55s** (lean back / raise weapon, audio cue) then strike lunge, flinch on damage (interrupt windup if `opts.heavy` or parried), stagger 1.2s on parry, death: fall over + sink after 6s → despawn, emit `enemyKilled`, emit `spawnLoot` (gold always; potion 25%; wolves drop `itemId:'pelt'` items).
- AI: wander near home → aggro if player within sightR (14–22u; ×1.6 at night; drake 90) & rough LOS (skip if terrain blocks: sample 3 points) → chase (terrainHeight-following, avoid water depth >1, colliders push-out) → attack range → telegraph → strike: if player within reach+0.6 → `const res = g.combat.tryBlock(dmg)`; if `res.parried` → stagger self; else if `res.blocked` → half stamina cost handled there, no hp; else `g.player.damage(dmg, myPos)`. De-aggro >45u (drake 160), heal slowly at home.
- `combatState` event: emit `{inCombat:true}` when ≥1 aggroed & alive, false 5s after none (drives music).
- Spawning: seeded home-spawns: wolves in forests/meadow packs (~14 packs across map via hash grid), goblins near rocks/night wilderness, skeletons at ruins (+night respawn), bandits ×4 + Vargr at camp, barrowlord in crypt area of ruins, drake at peak. Respawn timer 180s (not bosses/Vargr). Active cap ~10 within 260u of player; despawn >320u (bosses persist). Floating HP bar: shared CanvasTexture billboard above enemy, only when hp<max & player <40u & aggroed.
- Damage numbers optional: skip. Keep `damage()` applying flinch, knockback impulse along dir, hp, death.

### 6. `src/structures.js` — village, ruins, tower, camp, POI props, chests
`export function createStructures(g) → { update(dt) }`
- **Emberhollow village**: 8-10 timber-frame houses (box walls + prism roofs, vertex-colored plaster/timber/thatch), inn with sign, blacksmith awning + anvil, market stalls, stone well, lantern posts (emissive amber at night — check dayFrac), fences, dirt paths (flat ring-strips slightly above ground), chimney smoke (tiny pooled particle columns, day+evening).
- **Barrowdeep Ruins**: broken circle of columns + arches, collapsed walls, crypt: sunken stone stair pit (dig into terrain visually with walls; terrain is flattened there) leading to small enclosed barrow chamber (walls+roof) where the barrowlord + Aldric sword chest live. Mossy dark stone.
- **The Wardstones**: 5 monoliths (3-6m) in circle, carved rune faces (emissive cyan when `g.flags.stonesCleansed`, else dull).
- **Greywatch Tower**: 14m stone cylinder + crenellations, external spiral stone stair (walkable: add collider steps? simpler — ramp of thin boxes the player can walk up via terrain? Player only collides with terrain+cylinders, so make stairs a helix RAMP and expose `g.flags` no—) **Do this**: register the stair as a series of small cylinder colliders is NOT walkable. Instead expose two interactables: "Climb the tower" at base → teleport player to top platform; "Descend" at top. Beacon brazier on top (interactable for quest: `g.flags.beaconLit=true` → big flame + smoke + emissive; quests handles the quest logic via flag).
- **Redfang Camp**: 3 tents (cone/prism canvas), campfire (flame particles + emissive log glow), weapon rack, cage with door (interactable if quest flag), skull totems.
- **Shrine of Aldric**: small stone altar + statue + offering bowl (interactable blessing: once/day +20 maxstamina buff 300s → just notify + flag).
- **Breadcrumbs** (seeded ~18 spots via hash on 200u grid, excluding POI radii): cart wrecks, lone campfires w/ bedroll, small stone cairns, 1-2 fishing docks at Mirrormere shore, hunter's stand. Each has a chest OR loot bag OR note.
- **Chests** (~10 total incl. POIs): box + lid, interactable "Open Chest" → lid animates, emit `chestOpened {id}`, emit `spawnLoot` (gold 15-60 seeded, potion 50%), one-time via `g.flags['chest_'+id]`. The Aldric chest (crypt) sets `g.flags.aldricChestOpened` and spawns `itemId:'aldricSword'` item loot.
- Push cylinder colliders (`{x,z,r}`) for houses (use 2-3 per rectangular house), tower, monoliths, big columns, tents. Register interactables (chests, tower climb, brazier, shrine, cage).
- Merge aggressively: per-POI static Groups; share geometries/materials; total structures draw calls target ≤ 70 (frustum culling helps — set proper bounds). Windows: emissive quads that brighten at night (update ≤1×/s).
- Torches/campfires: NO real lights — emissive cones + particle flames + a fake ground-glow disc.

### 7. `src/ui.js` — ALL DOM/HUD/input/menus/weapon wheel
`export function createUI(g) → { update(dt), input, openDialogue(npc, tree), closeDialogue(), showBanner(title, sub) }`
- Injects ALL CSS (one `<style>`) + DOM into `#hud` (empty div in index.html). Fantasy styling: serif display font (system: Georgia/'Times New Roman'), parchment/dark-leather panels, gold accents, subtle borders. Must look POLISHED — this is the player's constant view. Safe-area insets respected (`env(safe-area-inset-*)`).
- **input** object (single source; both touch AND keyboard/mouse):
```js
input = { move:{x,y}, look:{dx,dy}, jumpPressed, attackPressed, attackHeld, attackReleased,
          blockHeld, interactPressed, sprintOn, hotkeySelected /* id|null, consumed by combat */,
          endFrame() /* clears *Pressed/*Released + look deltas; main calls LAST each frame */ }
```
- Touch (Pointer Events, track pointerId): left 45% = floating joystick (appears at touch point, r=64px, deadzone 0.12); right side drag = look (sensitivity ~0.0035 rad/px × user setting). Buttons bottom-right cluster: ATTACK (large, 76px), BLOCK, JUMP; WHEEL button (opens weapon wheel); SPRINT toggle on joystick side; contextual INTERACT pill appears center-bottom when `g.interactables` in range (label like "⚷ Open Chest"). Tap ATTACK=press+release same frame is fine (set attackPressed & attackReleased; combat handles). Hold ATTACK sets attackHeld for heavy/bow-draw. `touch-action:none` etc.
- Desktop: WASD/Space/Shift, mouse pointer-lock on canvas click, LMB attack, RMB block, E interact, Q or Tab hold = weapon wheel, 1-6 hotkeys, J journal, Esc pause. Show appropriate hint text by input type detected.
- **Weapon wheel**: hold WHEEL (or Q): radial 6 segments (sword/bow/fire/heal/torch/potion with icons — draw icons as inline SVG or canvas), time slows (`g.requestSlowmo(0.15)` while open — provided by main; release → restore), drag/mouse toward segment highlights, release selects → set `input.hotkeySelected = id`. Show mana/potion counts on segments.
- **HUD**: bottom-left bars hp (red)/stamina (green)/mana (blue) — slide-fade out when full & >4s out of combat; gold + potion counters; XP thin bar; level badge. Compass strip top-center: cardinal letters + discovered-POI icons + gold quest marker (from `g.quests.markerPos()`, guard undefined) with edge clamping; boss bar (listens `bossBar`); crosshair dot that swells near interactables; damage red vignette flash on `playerDamaged` (+ directional hint optional); hit-marker tick on `hitLanded` (× on kill); low-hp pulsing vignette <30%.
- **Banners/toasts**: `discover` → big centered location-name banner (serif, letter-spaced, fade 3s) — audio plays sting itself. `questStarted/Updated/Completed` → side toast w/ objective text. `notify` → toast. `levelUp` → golden flash + "Level N".
- **Dialogue**: `openDialogue(npc, tree)` — bottom panel: speaker name, typed-out text (~35 chars/s, tap skips), 2-4 choice buttons; `g.paused=true` during (set false + emit `dialogueEnd` on close). Tree format (from quests): `{ nodes: { id: { text, speaker?, choices: [{label, next?, if?():bool, do?()}] } }, start:'id' }` — `if` hides choice, `do` runs on pick, `next:null` ends.
- **Journal** (button 📜 / J): panel listing active quest + objective, completed quests, discovered locations. 
- **Pause menu** (⚙/Esc): Resume, Save Game (`g.save.save()` → toast), Load, New Game (confirm → `g.save.clear()` + reload), quality toggle High/Low (`g.flags.qualityPref` + reload note), look sensitivity slider, invert-Y, Fullscreen button (`requestFullscreen` on documentElement — important for mobile immersion). `g.paused=true` while open.
- **Death screen**: on `playerDied`: dark fade "You Have Fallen" + respawn button → `g.player.respawn()`, fade in.
- First interaction anywhere: call `g.audio.unlock()` once.
- Performance: batch DOM writes; update bars/compass at most every other frame; use transforms not layout.

### 8. `src/quests.js` — NPCs, dialogue data, quest chain, discovery + `src/save.js`
`export function createQuests(g) → { update(dt), markerPos()→Vector3|null, serialize(), deserialize(o), npcs }`
- **NPCs** (procedural villager models — reuse humanoid style; ≤6 parts; distinct clothes colors; blob shadow; idle wander small radius in village, face player when <4u, subtle bob): Elder **Maera** (by the well), blacksmith **Torvald** (forge), hunter **Sylva** (village edge), innkeeper **Bram** (inn door), farmer **Wendel**. Interactables ("Talk — Maera") → `g.ui.openDialogue(npc, treeFor(npc))`.
- **Dialogue trees**: data-driven per NPC per quest-state (see ui format). Write flavorful, concise fantasy dialogue (Witcher-style small human stories). At least one meaningful choice per side quest with a visible consequence (flag → later dialogue/reward changes).
- **Main quest** (5 acts, gate progression by flags/events):
  1. *Embers at Dusk* — auto-start 8s in (notify → talk to Maera). She speaks of a drake razing farms; asks player to light Greywatch beacon.
  2. *The Silent Watch* — reach tower (marker), find watchman's fate (note interactable), light brazier (`beaconLit`) → goblin ambush wave (spawn via `g.enemies.spawnAt` ×3) → survive → return to Maera.
  3. *The Blade of Aldric* — Maera: only Aldric's blade can pierce drakehide. Marker → ruins crypt; kill barrowlord (listen enemyKilled type), open chest, get sword (`hasAldricSword` via `pickup` itemId `aldricSword`) → return; Torvald rekindles it (short scene → flag, +ember VFX note).
  4. *Ward of Stones* — cleanse Wardstones: interact at stones → wave of skeletons ×4 (+2 at night) → survive → `stonesCleansed=true` (stones glow) → Maera.
  5. *Drakespire* — climb, slay drake **Vhastrix**; on kill → return → celebration dialogue, `notify` "Dragonslayer of Emberhollow", big reward (300g), fireworks-ish particle at village? (skip if costly). 
- **Side quests**: *Fangs in the Fold* (Sylva: 5 wolf pelts via `pickup` itemId 'pelt' count → choice: reward gold OR her recurve technique = `bonus.dmg += 0.1` for bow... simplify: +0.08 all dmg); *The Redfang Debt* (Bram owes Vargr — choice: pay 60g peaceful (camp becomes non-hostile flag) OR kill Vargr; consequences in later dialogue + inn discount = potions cheaper... simplify: Bram gifts 3 potions); *The Mirrormere Light* (Wendel's late wife's amulet at lake dock chest; return it OR keep (sell value 80g) — returning: he lights a lantern at his house every night thereafter (flag → structures lantern? just dialogue change + reward 30g + he wears it)). Buy potions from Bram anytime (20g) via dialogue choice `do`.
- **Discovery**: each frame (throttled 0.5s) check player vs `core.POIS` radius+30; first entry → mark discovered in `g.flags.discovered={}` → emit `discover`.
- `markerPos()`: active objective world pos (Vector3, reused instance) or null.
- Quest state machine serializable; wave-spawn helpers; objective text strings for ui/journal.

**ALSO write `src/save.js`** (same agent):
`export function createSave(g) → { save(), load()→bool, hasSave(), clear() }`
- localStorage `elderfall_save_v1`: `{ version, flags, time:{dayFrac}, player: player.serialize(), quests: quests.serialize(), enemies: enemies.serialize(), equipped: combat.current }`. `load()` applies via deserialize + `combat.equip`; guard every field (missing subsystem data must not throw). Autosave every 60s (skip if paused or player dead) + on `questCompleted`. Emit `gameSaved`/`gameLoaded`.

### 9. `src/audio.js` — procedural WebAudio: SFX, generative music, ambience
`export function createAudio(g) → { update(dt), play(name, opts?), unlock() }`
- One AudioContext (created lazily in `unlock()` on first gesture; every method no-ops safely before). Master chain: compressor → gain (0.8).
- **SFX** (synthesized: osc + noise buffers + envelopes; pitch jitter ±6% each play): `swing`, `swingHeavy`, `hitFlesh` (layered thud+crunch), `hitClang`, `block`, `parry` (bright metallic ring), `bowDraw`, `bowShoot`, `arrowHit`, `fireCast` (whoosh), `fireExplode` (boom + crackle), `heal` (soft chime swell), `potion` (glug), `footstep_grass/stone/sand/water` (filtered noise taps), `pickupCoin` (coin tink), `pickupItem`, `chestOpen` (creak), `discover` (**bright harp-like ascending arpeggio — the discovery sting, make it beautiful**), `questDone` (short fanfare, 3-note brass-ish), `questStart`, `levelUp` (rising shimmer), `uiClick`, `wheelOpen`, `hurt` (dull thump + grunt-ish filtered saw), `death` (low drone), `wolfHowl`, `skeletonRattle`, `goblinCackle`, `drakeRoar` (big layered roar: detuned saws + noise + pitch drop), `thunder`.
- Auto-wire events → sfx: subscribe to `hitLanded`(flesh/clang by kill?), `parry`, `enemyKilled` (small kill accent), `playerDamaged`→hurt, `pickup` (coin/item), `discover`, `questStarted/Completed`, `levelUp`, `equip` (soft schwing), `chestOpened`, `playerDied`, `footstep` (by surface, quiet). Combat/others may also call `play` directly for weapon-specifics (bowDraw etc.).
- **Music** (generative, seeded, signature instrument = plucked "lute" via Karplus-Strong or triangle+decay): exploration-day: slow warm pad progression (i.e. C–Am–F–G at ~50bpm feel) + sparse lute phrases with long rests (silence is fine!); night: darker minor pad, rarer notes, more air; combat (on `combatState`): low pulsing drum (filtered noise kick ~110bpm) + tense drone crossfade in 1s, out 5s after false. Boss (bossBar non-null): add urgency layer. Crossfade via gain nodes; schedule with lookahead timer (not per-frame).
- **Ambience**: wind (looped filtered noise; volume/brightness rise with player altitude + at night), day birds (random chirp synth every 4-12s, only in forest/meadow), night crickets (pulsing filtered tone), water lap when near WATER_LEVEL±3 horizontal ~<20u of water (approx: player y low), ruins/crypt eerie shimmer when near ruins POI. Read `g.player.position`, `g.time.dayFrac` in update (throttle 0.25s).
- Keep total simultaneous voices bounded (~16); reuse buffers; no per-play buffer allocation for noise (pre-render 2-3 noise buffers at unlock).

## Update order (main.js runs this — FYI)
`player → world → sky → structures → enemies → combat → quests → audio → ui → input.endFrame() → render`

## Provided by main.js
- `g.requestHitstop(ms)` — brief timeScale dip (combat calls).
- `g.requestSlowmo(factor)` / `g.releaseSlowmo()` — weapon wheel (ui calls).
- Adaptive resolution, resize, boot/title screen, error overlay (`?debug`).

## Style
- File header comment. Clean, commented where non-obvious. It's fine to be 500-900 lines; COMPLETE beats stubbed. Never leave TODOs — implement everything you promise.
- Test your logic mentally against this contract; exact API names matter more than internal elegance.

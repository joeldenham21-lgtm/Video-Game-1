# ELDERFALL — Art Overhaul & Combat SOTA Contract (wave 2)

Addendum to CONTRACT.md + EXPANSION.md. The game now has REAL CC0 assets
(KayKit) managed by `src/assets.js` (read it). You are EDITING existing
modules you own for this wave — preserve all existing gameplay logic,
events, and APIs; replace/upgrade visuals and add the specified mechanics.

## g.assets API (already built — use it)
- `await g.assets.char(name)` → `{scene, animations}` — fresh skinned clone +
  SHARED AnimationClip array. Names: knight, barbarian, mage, rogue,
  rogue_hooded, skeleton_warrior, skeleton_mage, skeleton_rogue,
  skeleton_minion, fox.
- `g.assets.charSync(name)` → same or `null` if not yet loaded.
- IMPORTANT: verify exact filenames with `ls assets/<pack>/` before coding —
  dungeon files are `<name>.gltf.glb` (e.g. `chest.glb`, `banner_red.gltf.glb`),
  hexagon/halloween/furniture are `<name>.gltf` + sidecar `.bin`.
- `await g.assets.prop('dungeon/chest.glb')` / `propSync(rel)` →
  Object3D clone. Packs: `dungeon/*` (203 pieces: walls/columns/arches/
  chests/barrels/banners/torches/bones), `halloween/*` (crypt, coffins,
  graves, fences, candles, lanterns, pumpkins, dead trees), `furniture/*`
  (tables, chairs, shelves, beds, rugs), `hexagon/building_*_red.gltf`
  (blacksmith, tavern, church, home_A/B (4 colors), well, windmill,
  watermill, market, mine, lumbermill, castle, tower_A/B, barracks,
  archeryrange, bridge_A/B, destroyed), `hexagon/decoration/props/*`
  (crates, barrels, buckets, flags), `hexagon/decoration/nature/*`
  (hills/mountains with trees — mostly unused; our terrain is procedural).
- `g.assets.tint(root, '#88ff88', {emissive?, emissiveIntensity?, opacity?})`
  → cached material variants. Use for enemy recolors/ghosts.
- Async pattern (REQUIRED — assets stream in): create your logic object with
  an empty THREE.Group immediately; when char()/prop() resolves, attach the
  model. Gameplay must work (colliders, AI, interactables) even before the
  mesh arrives. Never `await` inside factory — fire promises, attach in
  `.then`.
- Characters/props load with MeshLambertMaterial + the pack's texture; DO NOT
  replace materials except via tint(). castShadow already set.
- Hexagon buildings sit on a hexagonal ground tile base — SINK the base ~0.35u
  into terrain (position.y -= 0.35) and it reads perfectly on any slope.
  Scale: hexagon buildings are ~1u tall as authored for tabletop scale —
  measure with Box3 and scale so doors are ~2.2u tall (scale ≈ 6-9, TUNE by
  eye against the 1.7u player eye height). Same for dungeon pieces (authored
  ~real scale, ~1-2× tune) and characters (KayKit chars are ~1.9u tall as
  authored at scale 1 — verify with Box3, target ~1.8u humans).

## Animation state machines (characters)
Every character clone: `mixer = new THREE.AnimationMixer(scene)`; build a
clip map by name from `animations`. Available clips (75, shared by ALL
KayKit chars, adventurers AND skeletons): Idle, Walking_A/B/C,
Walking_Backwards, Running_A/B, Running_Strafe_Left/Right,
1H_Melee_Attack_Chop/Slice_Diagonal/Slice_Horizontal/Stab,
2H_Melee_Attack_Chop/Slice/Spin/Spinning/Stab, 2H_Melee_Idle,
Unarmed_Melee_Attack_Punch_A/B/Kick, Block, Blocking, Block_Attack,
Block_Hit, Dodge_Forward/Backward/Left/Right, Hit_A/B, Death_A/B (+_Pose),
Spellcast_Long/Raise/Shoot, Spellcasting, Cheer, Interact, PickUp, Throw,
Use_Item, Jump_Start/Idle/Land/Full_Long/Full_Short, Sit_Chair_*/Sit_Floor_*,
Lie_*, T-Pose, 1H/2H_Ranged_Aiming/Shoot/Shooting/Reload.
Fox clips: Survey, Walk, Run.
- Crossfade transitions (0.15-0.25s), `mixer.update(dt)` (respect g.paused &
  hitstop timeScale — pass scaled dt). LOD: skip mixer.update every other
  frame beyond 40u, every 4th beyond 80u.
- Root motion: NOT used — drive position yourself, play locomotion clips at
  speed-matched timeScale (walk clip ≈ 2.2u/s, run ≈ 5.5u/s as authored —
  set clip.timeScale = actualSpeed/reference so feet don't slide).

## Module assignments

### enemies.js — full roster rework (one agent)
Replace ALL procedural enemy models with animated KayKit characters (keep
every existing API, event, AI structure, spawn system, serialize):
- wolf → fox model, tint grey-brown, ×1.35, Run/Walk/Survey clips.
- goblin → skeleton_minion tinted sickly green (#7fae5a), jittery, ×0.85.
- bandit → rogue (leather tint), Vargr → rogue ×1.15 with red tint + scars
  (emissive red stripes via tint on win-count).
- skeleton → skeleton_warrior; skeleton archer (NEW) → skeleton_rogue with
  ranged arrow attacks (1H_Ranged clips, reuse combat-style projectile you
  own or simple raycast bolt + tracer).
- barrowlord → skeleton_warrior ×1.6, crowned (attach dungeon prop if one
  fits, else tint gold).
- NEW **wraith** → skeleton_mage, tint(#9fd8ff, emissive #66ccff, opacity
  0.55), floats (no ground clamp ±0.4 hover sine), Spellcast bolts, night +
  ruins/wardstones only, immune to arrows (notify hint once), weak to fire.
- NEW **vampire thrall** → rogue_hooded tinted pale (#cfd4e6) crimson accents;
  night-only around the NEW cemetery POI (structures adds it by the ruins);
  fast dodges (Dodge clips), drains hp on hit (heals self).
- NEW **vampire lord Morvane** → rogue_hooded ×1.12, mini-boss in the crypt
  at night: teleport-blink (fade out/in 6u away, particle burst), summons 2
  thralls at half hp, bossBar. Drops `itemId:'bloodseal'` (quests may use
  later; flag).
- NEW **witch Grimhilde** → mage tinted dark violet + emissive green hands;
  at the NEW witch hut POI (structures): Spellcast_Shoot green bolts that
  arc, cackle audio, retreats while casting. Neutral until attacked OR quest
  says hostile (check `g.flags.witchHostile`; default neutral wandering).
- NEW **troll** → barbarian ×2.3 tinted stone-grey (#8a9086), 2H_Melee clips
  slowed 0.8×, guards Stonebridge (NEW bridge POI on the road to the ruins,
  structures adds): huge telegraphs (1.0s), ground-slam AoE (radial particle
  ring + knockback via player.damage + velocity push), heavy knockback,
  400 hp, 40 dmg, drops big gold + `itemId:'trollheart'`.
- NEW **werewolf** → barbarian ×1.25 tinted dark umber (#5a4636), hunched
  (rotate spine bone found by name 'Spine'/'spine' if present else tilt root
  +0.35 rad), Unarmed punch/kick clips at 1.3× speed, lopes with Running_A
  1.2×; spawns ONLY at night in the forest (2 max), howls (wolfHowl), flees
  at dawn (despawn with notify "The beast escapes into the dawn...").
- Drake Vhastrix: keep flight logic; rebuild body visual — better procedural
  (sleeker neck/tail/wing membranes, emissive eye + throat glow before fire
  breath) OR skeletal composite from parts; your call, make it MENACING.
- Guards (2, friendly, non-combat) → knight at village gates, Idle/Walking
  patrol. Purely atmospheric (no combat AI needed).
- Blob shadows stay. HP bars stay. Telegraph→strike timing stays fair.
- All melee humanoids: play matching clip for telegraph (windup portion) and
  strike; Hit_A/B on flinch; Death_A/B on death (fall, sink after 6s);
  Block/Block_Hit for bandits that block; Dodge_* for thralls.

### structures.js — real buildings + new POIs (one agent)
Replace procedural buildings with assets (keep ALL colliders/interactables/
chests/flames/quest hooks; adjust collider radii to new footprints):
- Village: tavern (inn — keep sign hook), blacksmith, church (NEW small
  chapel), well, market ×2, home_A/B in mixed colors ×6, windmill on the
  hill edge (rotate its blades slowly in update — find by name/position,
  spin around local axis), fences from halloween fence pieces, lantern posts
  (halloween lantern_standing), crates/barrels (hexagon props) scattered.
- Barrowdeep Ruins: dungeon pieces — broken walls/columns/arches, the crypt
  as a real enclosed chamber (dungeon walls + floor + stairs), torch props,
  bone piles, coffins; PLUS NEW **cemetery** ring around it: halloween
  graves/gravestones/fences/dead trees/crypt building (this is vampire
  territory at night — enemies.js spawns there).
- NEW POI **Witch Hut** at (-260, -520) forest: home_B_green sunk + skewed
  0.06 rad (crooked), cauldron (dungeon pot if exists else barrel + green
  emissive glow disc + bubbling particles), mushroom circle, hanging bones.
  Register in a new exported const so quests can reference; also push a
  discover-able entry via g.flags? NO — add to core? NOT yours. Hardcode
  position; quests agent gets the same coordinates in its brief.
- NEW POI **Stonebridge** at (330, -260) on the ruins road: bridge_A scaled
  across a dip (sink ends), troll lives beneath (enemies.js has the coords).
- Greywatch tower → tower_B_red scaled + castle piece? Keep climb teleport +
  brazier logic.
- Redfang camp: keep tents procedural if no asset fits, add crates/barrels/
  flag props, cage stays.
- Inn interior corner (visible through door? buildings are solid) — instead:
  furniture as OUTDOOR dressing: benches/tables outside tavern, market
  stalls with crates, bookshelf inside church doorway alcove (books module
  already placed its own lecterns — don't collide with those spots).
- Chimney smoke, emissive windows at night: KEEP (attach smoke emitters to
  new chimney positions; window glow = small emissive quads on building
  faces).
- Breadcrumb POIs: upgrade cart wrecks with crate/barrel props, cairns stay
  procedural stone.

### quests.js — NPC visuals + 3 new quest lines (one agent)
- Villagers → KayKit chars with color tints: Maera (mage, grey robes tint),
  Torvald (barbarian, leather apron tint #7a5230), Sylva (rogue, forest
  green), Bram (knight-no-helmet? knight tinted warm), Wendel (rogue_hooded
  earth tones). Idle/Walking_A wander, Interact clip when talked to, face
  player. Keep ALL dialogue/quests/serialization.
- NEW side quests (with meaningful choices, consequences, great dialogue):
  1. *The Crone of the Pines* — villagers whisper the witch curses cattle.
     Investigate: her hut, her side of the story (she heals, not curses).
     CHOICE: expose the real cause (a sick well — interact) and reconcile
     village+witch (she becomes a vendor: potions 15g + a unique charm), OR
     side with fearful villagers and drive her out/kill (`witchHostile`,
     loot her cauldron, village "grateful" but Maera disapproves).
  2. *Blood Below the Barrows* — Bram's night terrors: a guest went missing
     near the cemetery. Track at night → vampire lord Morvane in the crypt.
     CHOICE: destroy him, OR accept his bargain (spare him → he gifts
     `bloodseal` = +15% night damage, but a villager disappears each dawn…
     3 days later quest re-opens to finish him; guilt dialogue).
  3. *The Toll of Stonebridge* — troll blocks the ruins road. CHOICE: pay
     30g toll (he lets you pass, hilarious grunt dialogue via notify), fight
     him, OR (if trollheart NOT taken) bring him 3 fish… simplify: pay or
     fight; paying twice → he "respects coin", stands aside permanently.
- Wire quest markers, journal text, discovery of new spots (use notify +
  markers even though they're not core.POIS).

### combat.js — STATE-OF-THE-ART upgrade (one agent)
Keep everything working; add (all tuned for mobile touch + desktop):
- **Dodge**: double-tap a move direction (or desktop Alt/C) → dodge roll
  that direction: 0.32s, i-frames 0.25s, stamina 18, camera dip+FOV kick.
  **Perfect dodge** (enemy strike lands during your i-frames) → 0.35× slow-mo
  1.2s (Witcher) + notify-free golden vignette flash (tell ui via event
  `perfectDodge` — ui already shows generic effects on events it knows; ok
  to just do camera/time effects yourself).
- **Combo chains** (sword): light-light-light alternates Slice_Horizontal/
  Diagonal/Chop viewmodel arcs with escalating dmg (×1/×1.1/×1.25) within
  1.1s windows; 3rd hit small AoE cleave + bigger shake.
- **Counter prompt** (Mordor): when an enemy telegraph targets you in range,
  emit a brief window where BLOCK tap = instant parry-counter (auto riposte
  hit ×2 dmg + stagger). Visual cue: enemies.js already telegraphs; you
  detect via g.enemies.list state (telegraphing && target dist < 3.5) — show
  cue by pulsing g.pointLight? NO — emit event `counterWindow` {open:bool};
  ui shows a ⚔ flash above crosshair (ADD tiny handler in your own injected
  overlay div — allowed for this one cue).
- **Finishers**: killing blow with melee at <35% player-relative overkill →
  120ms hitstop + 0.3× slow-mo 0.6s + zoom FOV −8 pulse (kill-cam feel).
- **New weapons** (wheel grows to 8 slots — coordinate: ui.js agent updates
  wheel to support 8; you define): `axe` (2H: slower 0.5s, 34 dmg, big
  cleave arc, staggers), `greatsword` (2H: 0.62s, 42 dmg, Spin heavy =
  360° AoE), `frost` spell (18 mana: cone slow 45% 3s + 18 dmg, ice mist
  particles), `lightning` (22 mana: instant chain bolt up to 3 enemies,
  jagged line renderer flash, big crack sound via 'thunder').
- Viewmodel: attach REAL weapon meshes — extract from dungeon pack props if
  suitable (there are sword/axe/weapon props in dungeon pack: check
  `dungeon/sword*.gltf`, `axe*`, `weapon*`; else keep improved procedural
  blades with asset-quality proportions). First-person arms stay procedural
  (KayKit chars are third-person rigs).
- Respect ALL rpg.mult hooks (meleeDmg, attackSpeed, etc.) and emit
  `spellCast` for every spell (fire/heal/frost/lightning).

### ui.js — wheel 8 slots + hints (one agent, small)
- Weapon wheel: support 8 segments (sword, axe, greatsword, bow, fire,
  frost, lightning, heal) + torch & potion moved to quick-buttons beside the
  wheel button (tiny torch toggle + potion button with count).
- Add dodge control: double-tap joystick direction detection is combat's;
  YOU add a small DODGE button (mobile, between BLOCK and JUMP) setting
  `input.dodgePressed` (+ direction from current move vector; expose in
  input contract: `dodgePressed` cleared in endFrame; desktop key C/Alt).
- Show counter-prompt cue on `counterWindow` event (⚔ pulse above
  crosshair) and perfect-dodge golden flash on `perfectDodge`.
- Journal gains a "Bestiary" tab: list enemy types killed (listen
  enemyKilled, count per type, flavor line each — write 14 short entries).

## Rules
- ALL existing events/APIs keep working. Do not rename anything.
- Asset pop-in must be graceful (logic-first, mesh-on-arrival).
- Draw calls: characters are 1-3 draw calls each (KayKit atlas); watch
  structure counts — reuse propSync clones which share materials; total
  budget now ≤ 220 draw calls (flagship target).
- `node --check` your file; report deviations.

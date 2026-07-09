# ELDERFALL — Smithing, Enchanting, Economy & Endgame Contract (wave 3)

Addendum to CONTRACT.md / EXPANSION.md / ASSETS-ART.md — all rules apply.
Three agents. File ownership (STRICT):
- FORGE agent: `src/forge.js` (new) + `src/combat.js` (scoped additions only)
- ECONOMY agent: `src/economy.js` (new) + `src/quests.js` (vendor dialogue hooks only)
- ENDGAME agent: `src/enemies.js` + `src/rpg.js` (balance constants + listed features)
main.js wiring (boss does it): `g.economy = createEconomy(g)` then
`g.forge = createForge(g)` after g.details; update calls after details.

Persistence: ALL state under `g.flags` (materials, upgrades, enchants, tomes,
rep, hunts, prices seed by day index). Everything must survive save/load.

## Shared: materials registry (economy owns, others read via g.economy)
`g.economy.MATERIALS` = { id: {name, value, desc} }:
iron_ore 8, iron_ingot 20, silver_ore 18, silver_ingot 45, leather 12,
pelt 10 (existing wolf drop), ancient_bone 15, ember_crystal 40,
frost_shard 40, storm_core 60, blood_gem 55, troll_heart 120,
drake_scale 150, wardstone_dust 30, plus VALUABLES (sell-only): old_goblet 25,
silver_ring 35, rune_trinket 50.
API: `g.economy.give(id, n)`, `count(id)`, `take(id, n)→bool`,
`gold` helpers proxy to player. Sources: ENDGAME agent adds material drops
per enemy type (wolves→pelt exists, skeletons→ancient_bone, wraiths→
frost_shard 40%, vampires→blood_gem 45%, troll→troll_heart, drake→
drake_scale ×3, elites→guaranteed roll); ECONOMY adds 8 seeded ore-vein
interactables (iron in rocky areas, silver on high slopes; mine → 2-4 ore,
respawn 1 game-day, small pick-axe swing sound via existing sfx) and
valuables to ~40% of chests (listen `chestOpened`).

## FORGE agent — src/forge.js + combat.js hooks
**forge.js** exports `createForge(g) → { update(dt), openForge(), openEnchant(site) }`
- Forge interactable at Torvald's smithy position (register your own,
  "⚒ Use the Forge", radius 3, near POI.village offset matching quests'
  Torvald post — pick (POI.village.x-18, z-12) area). Enchant interactables:
  at the Wardstones center (enabled only when `g.flags.stonesCleansed`) and
  at the witch hut cauldron (enabled when crone peace path flag set —
  inspect quests.js for the exact flag name).
- **Smithing panel** (own DOM/CSS, parchment/ember styling consistent with
  ui.js): smelt (2 iron_ore→1 iron_ingot, 2 silver_ore→1 silver_ingot, small
  fee 5g), tan (2 pelt→1 leather), and per-weapon upgrade track for the 8
  wheel weapons + torch: tiers Fine(+12% dmg; 2 iron_ingot+40g),
  Tempered(+25%; 4 ingot+1 leather+120g, player level≥5),
  Masterwork(+40%; 6 ingot+type-rare+300g, lvl≥10 — type-rare: melee=
  troll_heart? NO, keep troll_heart for Legendary; use: melee=silver_ingot×2,
  bow=ancient_bone×3, spells N/A), Legendary(+60%; troll_heart OR
  drake_scale + 800g, lvl≥15). Bow upgradeable; spells/heal/torch NOT
  (magic upgrades via tomes). WEIGHTY UX: select weapon → see recipe →
  HOLD the forge button 1.2s → anvil clang ×3 (audio 'hitClang' or details
  synth NO — use g.audio.play('hitClang') timed), spark burst toast
  "⚒ Fine Longsword forged". No confirmation spam, no partial tiers.
- **Enchanting panel**: one enchant per weapon (replace = full cost again):
  flametongue (burn 4dmg/s 2s; ember_crystal+wardstone_dust+150g),
  frostbite (slow 25% 1.5s; frost_shard+dust+150g), stormbrand (10% chance
  small chain arc 8dmg; storm_core+dust+220g), bloodthirst (heal 12% of
  dmg dealt; blood_gem+dust+220g), gravebane (+35% dmg vs skeleton/wraith/
  barrowlord/vampire types; silver_ingot+ancient_bone×2+dust+180g).
  Ritual UX: hold 1.5s, rising chime (audio 'heal' + 'levelUp'), rune-circle
  flash.
- **Spell tomes** (4 pickups you place, glowing book meshes + interactables):
  Twin Flame (crypt near Aldric chest), Deep Winter (tower top), Storm Court
  (drake perch at Drakespire), Rites of Mending (witch hut shelf). Reading →
  parchment overlay (brief, style like books.js) → flag `tome_fire2` etc,
  notify "Your Fireball is now Greater Fireball". Wardstone blessing: pray
  interactable at stones post-cleanse → 300s +15% spellDmg buff (flag+timer).
  Drake kill (`enemyKilled` type drake) → permanent `cinder` flag +15% fire.
- State: `g.flags.forge = { tiers: {sword:0..4,...}, enchants: {sword:'flametongue'|null,...} }`.
- Expose for combat: `g.forge.tierOf(id)`, `g.forge.enchantOf(id)`,
  `g.forge.dmgMult(id)` (1 + tier bonuses), `g.forge.spellTier(school)→1|2`.

**combat.js scoped additions (do NOT restructure anything else):**
- Damage: multiply weapon dmg by `g.forge?.dmgMult(current) ?? 1`; spells
  check `g.forge?.spellTier(school)`: fire2 = +40% dmg + 3 bomblets on
  explode; frost2 = slow 45%→60%, +50% duration + brittle (+15% dmg taken
  3s); lightning2 = 5 chain targets; heal2 = +regen 4hp/s 5s.
- On-hit enchant procs (query enchantOf(current)): burn ticks, slow, chain
  arc (reuse lightning visuals small), lifesteal heal, gravebane multiplier
  vs undead types.
- VISUALS (the point!): a `refreshWeaponLook()` applied whenever equip/tier/
  enchant changes: tier 1: brighter steel (material color lerp toward
  0xd8dde4); tier 2: thin emissive edge-line (emissive 0x222833,
  intensity 0.5) + darkened guard; tier 3: gold guard/pommel accents
  (tint) + very subtle scale ×1.04; tier 4: faint ember rune particles
  (reuse your pooled particles, 1-2/s) + slow emissive pulse. Enchants:
  blade emissive tint per school (flame 0xff5a22, frost 0x66ccff, storm
  0xb18cff, blood 0xaa1133, grave 0x9fffcE... use 0x9fffce) intensity ~0.55
  + 2-3 school-colored wisp particles/s along the blade + slightly stronger
  during swings. Subtle > over-the-top. Bow: enchant = arrow trail color.
- Emit `weaponForged {id,tier}` / `weaponEnchanted {id,school}` events
  (audio may hook later; toast handled by forge panel).

## ECONOMY agent — src/economy.js + quests.js vendor hooks
**economy.js** exports `createEconomy(g) → { update(dt), MATERIALS, give, take, count, priceOf(id, vendor, buying), openShop(vendorId), rep() }`
- Inventory under `g.flags.materials`. Toast on first-of-kind pickup.
  Listen `enemyKilled`/`spawnLoot`/`pickup` — material itemIds from enemies
  flow into inventory automatically (coordinate ids with ENDGAME agent:
  pelt, ancient_bone, frost_shard, blood_gem, troll_heart, drake_scale,
  ember_crystal, storm_core).
- **Vendors**: torvald (buys ores/ingots/leather/bones at good rates, sells
  iron_ore 9g, iron_ingot 22g, leather 14g, silver_ore 20g),
  bram (sells potions 20g — MIGRATE the existing potion purchase to the
  shop; buys valuables well), sylva (sells leather/pelt, buys pelts +20%),
  grimhilde (peace path only: sells wardstone_dust 35g, ember_crystal 45g,
  frost_shard 45g; buys reagents), fenwick (wandering merchant: walks the
  village↔bridge road on a day schedule, procedural rogue-tinted NPC you
  own with a pack mule? keep simple: NPC + crate; stock rotates daily: one
  random rare material + one spell-tome HINT note (sells map-note 50g
  revealing a tome location as a compass marker flag), buys ANYTHING at 55%).
- **Barter panel** (own DOM/CSS matching ui.js): two columns buy/sell with
  counts, prices, gold; tap row = trade 1 (hold = ×5); clean, no spam.
- **Pricing**: base value; sell to vendor = 45% × (1+rep) × daily; buy =
  110% × (1−rep) × daily. rep = 0.05 × questCompleted count (cap 0.25),
  track via event. daily = seeded ±15% per vendor per game-day (hash2 of
  day index) — vendors display a one-line "market mood" ("Torvald pays
  well for bone today").
- **Ore veins**: 8 seeded interactable rock-vein props (iron ×5 rocky/forest
  edges, silver ×3 high slopes h>55): mine 2-4 ore + rare gem 8%,
  respawns next game-day. Simple sparkling mineral vein mesh (own).
- Chest valuables: listen `chestOpened` → 40% add a valuable + toast.
- **quests.js hooks (scoped!)**: add a "Trade" choice to Torvald/Bram/
  Sylva/Grimhilde(peace) dialogue trees calling `g.economy.openShop(id)`;
  REPLACE Bram's hardcoded 20g potion `do` with the shop. Do not touch
  anything else in quests.js.

## ENDGAME agent — src/enemies.js + src/rpg.js
**enemies.js**:
- **Zoned scaling**: enemy hp/dmg ×= zone(level): zones = safe fields
  (village r<250: ×1 flat), mid (default: ×(1+0.04×(playerLevel−1)) cap
  ×1.8), north mountains + cemetery at night (×1.25 floor, scale cap ×2.4),
  post-drake everywhere +15%. XP rewards scale with the multiplier.
- **Elites**: 8% of non-boss spawns (deterministic roll): prefix name (Dire
  Wolf, Goblin Chief, Gravebound Skeleton...), ×2.5 hp ×1.5 dmg ×1.15 size,
  emissive eye glow, guaranteed material drop + ×3 gold + bonus xp; show
  name via existing hp-bar label if present (else notify on aggro once).
- **Material drops** (coordinate ids with economy): skeletons→ancient_bone
  60%, wraith→frost_shard 40%, thrall/Morvane→blood_gem 45/100%,
  troll→troll_heart, drake→drake_scale×3, goblin→iron_ore 25%,
  bandit→old_goblet 15%, elite→guaranteed.
- **Hunt Board** (`g.flags.mainQuestAct >= 3` — inspect quests.js for the
  actual act flag; fall back to beaconLit): interactable board at the inn
  (own small prop): 3 rotating bounties/game-day: named elite at a seeded
  wilderness spot (compass marker via your own marker export
  `huntMarkerPos()` — ui already reads g.quests.markerPos, so instead emit
  `notify` with direction text AND spawn the target with a taller aggro
  radius; simplest correct: expose `g.enemies.activeHunt = {name, x, z}`
  and ALSO register a discover-style toast). Kill → 150-400g + rare
  material + hunt xp; board refreshes daily. Endless midgame loop.
- **Blood Moon**: after `drakeDead`/`vhastrixDead` flag (inspect quests/
  enemies for actual flag): every ~3rd night 22:00-04:00, red-tinted notify
  "The Blood Moon rises", spawn waves (skeletons/werewolves/thralls ×8-12,
  elites likely) converging on the village edge (NOT inside — guards +
  villagers safe zone r 40), ×2 loot. End at dawn with "The village
  endures" + gold bonus per kill.
- **Trial of Echoes**: post-drake interactable at Shrine of Aldric:
  dialogue-free menu via notify + interact cycles? Cleaner: register 5
  interactables "Challenge: Echo of <Boss>" (visible post-drake) → spawns
  empowered echo (×1.6 stats, ghostly blue tint) of barrowlord/Vargr/
  troll/Morvane/Vhastrix at the shrine clearing → kill = 500g + unique
  notify title, repeatable with +20% stats each clear (flag counter).
**rpg.js** (balance constants only + one feature):
- Verify perk-point pacing: with the new xp sources target roughly level
  16-20 after full content clear; adjust xpNext growth 1.35→1.32 if needed.
- Add `mult('goldFind')` already exists — ensure elites/hunts respect it
  (enemies applies it to gold drops: coordinate — enemies multiplies gold
  by `g.rpg?.mult('goldFind') ?? 1`).
- Skill xp from smithing/enchanting: listen `weaponForged` (+60 xp split
  blade/marksman by weapon) and `weaponEnchanted` (+80 sorcery).

## Balance targets (all agents keep in mind)
- Gold income ~; 60-100g per POI clear early, 200-400 mid. Sinks: potions 20,
  Fine 40+mats, Tempered 120, Masterwork 300, Legendary 800, enchants
  150-220, tolls/fees. Player should afford Fine ~lvl 4, Tempered ~lvl 8,
  Masterwork ~lvl 13, Legendary ~lvl 18.
- Player dps roughly ×3.2 from lvl 1→20 via skills+perks+tiers; enemy scale
  cap ×2.4 keeps late fights challenging but winnable; elites/echoes/blood
  moons provide the "someone stronger" at every stage.
- Nothing grindy: every material has 2+ sources; no upgrade needs >2 rare
  hunts.

## Verification (each agent)
`node --check` your files + a scratchpad Playwright run (pattern
test/dbg.mjs): boot, grant yourself materials/gold via g, exercise your
panels/systems end-to-end, screenshot your UI, confirm zero console errors.

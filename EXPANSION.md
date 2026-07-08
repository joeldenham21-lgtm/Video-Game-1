# ELDERFALL — Expansion Contract (addendum to CONTRACT.md)

Read CONTRACT.md first — ALL its technical rules apply (mobile budgets, no
addons, no external assets, vertex colors, no per-frame allocations, only
import 'three' and './core.js', own exactly your file(s)). These are NEW
modules added after v1. `main.js` will construct them AFTER the v1 set:
`... g.save = createSave(g); g.rpg = createRPG(g); g.books = createBooks(g);
g.fauna = createFauna(g); g.voice = createVoice(g);` and call their
`update(dt)` after `g.ui.update` each frame. Subsystems may be undefined at
factory time — bind lazily. Everything must degrade gracefully if another
expansion module is absent (`g.rpg?.mult(...) ?? 1` style is used by callers).

New events:
| event | payload | emitted by |
|---|---|---|
| `dialogueLine` | `{speaker, text}` | ui (wired by boss) — fires when a dialogue node's text starts typing |
| `skillUp` | `{skill, level}` | rpg |
| `perkUnlocked` | `{perk}` | rpg |
| `bookRead` | `{id, title, first:bool}` | books |
| `spellCast` | `{school:'fire'|'heal', cost}` | combat (wired by boss) |

Persistence: put ALL your durable state under `g.flags.<yourModule>` (plain
JSON) — save.js already persists g.flags wholesale. Also expose
`serialize()/deserialize(o)` if you keep state outside flags.

---

## src/rpg.js — learn-by-doing skills + constellation perk trees
`export function createRPG(g) → { update(dt), addSkillXP(id, xp), mult(name)→number, has(perkId)→bool, points, skills, serialize(), deserialize(o), openTree(), closeTree() }`

**Skills** (level 1–100, xp curve `needed = 60 * 1.11^level`, diminishing):
`blade`, `marksman`, `sorcery`, `vitality`, `athletics`, `shadow`.
XP sources (subscribe to events / poll g.player in update):
- blade: `hitLanded` while equipped weapon is sword/torch (poll `g.combat.current`), bonus on `parry`.
- marksman: `hitLanded` with bow; more for kills (`enemyKilled` while bow equipped).
- sorcery: `spellCast` (by cost).
- vitality: `playerDamaged` (by amount), blocking hits.
- athletics: seconds spent sprinting / jumps landed (poll player.velocity & onGround transitions).
- shadow: seconds moving while `g.player.sneaking` (boss wires sneaking flag) within 25u of a living non-aggroed enemy; big chunk on sneak kills.
- ALL skills: `questCompleted` +40 to the 2 lowest, `discover` +15 to lowest. (No grinding needed — playing the game levels you.)
Each skill level: tiny passive (+0.4%/lvl to that skill's core multiplier). `skillUp` event → ui toast text like "Blade improved (23)". Every skill level ALSO grants `g.player.addXP(8)` so doing things levels your character (Skyrim-style, but generous).

**Perks**: +1 point per `levelUp` (and +1 per 10 skill levels gained total). 6 trees × 8 perks, tiered (require skill level 20/40/60/80 + prerequisite perk). Every perk is MECHANICAL, not a stat stick. Required set (id → effect, all queried via `mult`/`has` by boss-wired code):
- blade: `bld_edge`(+15% melee), `bld_flow`(light hits refund 5 stamina on hit), `bld_heavy`(+35% heavy dmg), `bld_riposte`(after parry, next hit ×3 crit), `bld_cleave`(melee arc +25°, hits +1 target), `bld_bleed`(heavies bleed 6dmg/3s), `bld_dance`(+20% attack speed), `bld_master`(capstone: kills refresh 25% stamina, +25% melee).
- marksman: `mrk_draw`(+20% bow dmg), `mrk_speed`(draw 25% faster), `mrk_eagle`(capstone-tier: holding full draw slows time 0.45× up to 1.5s), `mrk_pierce`(arrows pass through first target), `mrk_recover`(30% arrows refund stamina... arrows are free — instead: full-draw shots +30% crit), `mrk_knees`(hits slow enemies 30% 2s), `mrk_double`(capstone: every 3rd arrow forks into two), `mrk_calm`(no bob while drawing).
- sorcery: `src_kindle`(+20% spell dmg), `src_thrift`(-25% mana cost), `src_ember`(fire leaves burning ground 4s), `src_surge`(mana regens 2× out of combat), `src_twin`(capstone: fireballs launch twinned), `src_mend`(heal also +15 stamina), `src_ward`(blocking costs mana not stamina when mana>20), `src_arch`(capstone: +40% spell dmg, spells stagger).
- vitality: `vit_stone`(+25 maxHp), `vit_thick`(-15% dmg taken), `vit_potent`(potions +50% effect), `vit_grit`(blocked hits build rage: next attack +40%), `vit_stand`(no stagger while blocking), `vit_thorns`(blockers reflect 20% melee), `vit_second`(capstone: fatal hit → 1hp + 3s invuln, once per 300s), `vit_titan`(capstone: +50 maxHp, knockback immune).
- athletics: `ath_wind`(+10% move speed), `ath_lungs`(+30 stamina), `ath_surefoot`(no fall damage under 20m/s), `ath_leap`(+30% jump), `ath_sprintstrike`(attacks while sprinting +30%), `ath_swim`(swim at full speed), `ath_runner`(capstone: sprint costs 40% less), `ath_flash`(capstone: double-tap jump = air dash, 8s cd).
- shadow: `shd_soft`(sneak 35% harder to detect), `shd_blade`(sneak melee ×3), `shd_bolt`(sneak bow ×2.5), `shd_night`(+15% dmg at night), `shd_pockets`(+30% gold found), `shd_ghost`(kills while undetected don't alert others), `shd_assassin`(capstone: sneak melee ×6), `shd_veil`(capstone: standing still crouched 2s → near-invisible until you move).
`mult(name)` composes relevant skill passives + perks for: `meleeDmg, heavyDmg, bowDmg, drawSpeed, spellDmg, spellCost, maxHp, maxStamina, dmgTaken, moveSpeed, sprintCost, jumpPower, potionPower, sneakDetect, sneakMeleeMult, sneakBowMult, goldFind, attackSpeed, critChance` (return 1 or additive-composed factor; unknown name → 1). `has(id)` for binary perks. Cheap: recompute cached table only when perks/skills change.

**Tree UI**: you own it — inject your own DOM/CSS (style must match ui.js's parchment/gold fantasy language). A "✦ Skills" button top-right (badge when points>0); full-screen starfield constellation panel: 6 clickable skill constellations → perk node graph (SVG lines, star nodes, locked/unlockable/owned states), skill level + xp bar per skill, point counter, tap perk → detail card → hold-to-unlock. `g.paused=true` while open. Buttery, AAA-feeling. Also listen `levelUp` → pulse the button.

## src/books.js — lore library, reading UI, codex, secrets
`export function createBooks(g) → { update(dt) }`
- ~16 books, each with real content (150–400 words, GOOD fantasy writing — history, myth, humor, tragedy): e.g. *The Drake Wars, Vol I/II*, *Aldric, the Ember King*, *On the Wardstones*, *A Shepherd's Almanac*, *The Ballad of Greywatch*, *Bestiarum Elderfallis I/II*, *A Child's Diary* (found in the ruins — tragic), *Redfang: A Warning*, *The Angler of Mirrormere*, *Songs of Emberhollow*, *On Sneaking and Shadows* (skill book: +120 shadow xp first read), *The Bladesman's Primer* (+120 blade), *Meditations on Flame* (+120 sorcery), and ***The Gravedigger's Confession*** — clues to buried treasure: reading it spawns a "Disturbed Earth" interactable at a fixed spot (pick coordinates ~(430,-80), dig → big gold + unique amulet item flag `g.flags.gravekeepersCharm` = +10% gold find, notify).
- Placement: interactable book meshes (small procedural box+cover, slight tilt) on tables/shelves in village houses (coordinate with structures' house positions via POI.village offsets — pick sensible fixed offsets; books float 0 above terrainHeight-based supports you create: a tiny lectern/shelf prop is fine), in the inn, ruins crypt, tower top, camp, breadcrumb cairns. "Read <title>" prompt.
- Reading UI (own DOM/CSS): parchment overlay, serif text, page-turn for long books, close button; `g.paused=true` while reading; `bookRead` event; found-book ids in `g.flags.books`.
- Codex: a "📖 Codex" tab-button inside your reading UI listing all found books (reopenable) + counts (X/16). Discovering all 16 → notify + `g.flags.loremaster=true` (+1 perk point via emitting custom logic: just call `g.rpg?.addSkillXP` big bonus to lowest… keep simple: notify + 200 gold).

## src/fauna.js — ambient life (the world must feel ALIVE)
`export function createFauna(g) → { update(dt) }`
Research-backed ambient-life techniques, all pooled + instanced, LOD'd by distance, near-player bubble only (≤120u), throttled AI at 10Hz:
- **Birds**: flocks (Points or tiny instanced tri-pairs, ~3 flocks × 12) doing boid-lite loops; burst from trees with wing-flutter sound hook (`g.audio.play('uiClick')` NO — no suitable sfx: flutter via short noise… audio has no flutter; skip sound or reuse 'footstep_grass' quietly) when player < 8u of their tree. Perch at dawn/dusk.
- **Butterflies** (day, meadow/flowers): ~24 instanced quads, sine wander, pair-chasing.
- **Fireflies** (night, forest/marsh edges): ~40 additive glow points, slow drift + pulse — magical at dusk near the village.
- **Fish**: ripple rings + splash breaks on Mirrormere surface (expanding fading ring meshes, ~30s cadence, more at dawn/dusk); jumping fish arc (small dark spline hop).
- **Falling leaves** in forest (drifting instanced quads, autumn-gold, sparse), **pollen/dust motes** floating in golden hour light shafts (additive points near player, only 0.2<dayFrac<0.35 and 0.65<0.8), **dandelion seeds** on wind gusts in meadow.
- **Crickets/cicada visual**: none needed (audio has it). **Wind gusts**: brief coordinated grass-color-independent sway impulse — can't touch world.js; do a gust particle streak instead (subtle).
- Everything reacts: butterflies/birds scatter from the player and from `hitLanded` positions, fireflies dodge the torch's pointLight position.
Zero interactions with combat/AI systems; purely additive; every element distance-culled and disabled when not in its biome/time window. Target: whole module ≤ 8 draw calls, ≤ 1ms/frame.

## src/voice.js — voiced dialogue via Web Speech API
`export function createVoice(g) → { update(dt), speak(speaker, text), stop(), enabled }`
- `speechSynthesis` TTS. On first `voices` availability (async `voiceschanged`), build a deterministic per-character voice map: prefer local en-* voices; assign distinct voice+pitch+rate per speaker name hash — Maera (elder: lower rate 0.85, pitch 0.8), Torvald (deep: pitch 0.6, rate 0.9), Sylva (pitch 1.15, rate 1.0), Bram (pitch 0.9, rate 1.1 jovial), Wendel (pitch 0.95, rate 0.85 weary), Vargr/narrator fallback gravel (pitch 0.5, rate 0.85). Unknown speakers → hash-picked stable config.
- Listen to `dialogueLine {speaker, text}` → `stop()` then `speak(...)`. Strip markup. Also `dialogueEnd` → stop(). Queue-safe, never throws if synthesis unavailable (feature-detect; `enabled=false` then).
- Respect toggle `g.flags.voiceOff` (checked per line). Keep utterance volume 0.9. Cancel on pause menu open (poll g.paused edge in update).
- No DOM. ~120 lines. Graceful everywhere (iOS quirk: resume synthesis on visibilitychange).

## Boss-wired integration (FYI — do NOT do this yourselves)
main.js constructs + updates the four modules; ui.js gets a `dialogueLine`
emit + a Voice toggle + sneak (crouch) button wiring `g.player.sneaking`;
player.js consumes `mult('moveSpeed'|'maxHp'|...)`; combat.js consumes
dmg/cost/draw mults + `spellCast` emit + sneak multipliers; enemies.js
consumes `sneakDetect` in aggro checks. All via optional chaining with
safe fallbacks.

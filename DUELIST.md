# ELDERFALL — Duelist AI Contract (the hagraven feeling)

One agent, owns src/enemies.js edits ONLY (launch after the terror agent
lands). Design goal, in the director's words: an enemy deep in the
mountains that a level-50 player expects to steamroll — and it dodge-rolls
their magic, reads their swings, and fights strategically. Worthy opponents
at ANY level.

Hooks already in place (combat.js, committed):
- `g.combat.getProjectiles(out)` — fills caller-owned array with live player
  projectiles {x,y,z,vx,vy,vz,kind:'arrow'|'fireball'} (frost/lightning are
  instant — treat casts via events instead).
- Events: `attackSwing {weapon, heavy}` (every player swing/cast/shot),
  `potionUsed {left}`, plus existing `spellCast {school, cost}`.
- Player state: `g.player.stats.stamina`, `g.player.isBlocking`,
  `g.player.position/velocity`.
- KayKit clips on every humanoid rig: Dodge_Left/Right/Backward/Forward,
  Block, Block_Hit, plus their attack sets.

## The Duelist layer (per-enemy `duelist` profile on TYPES)
Tiers: `null` (beasts/heavies: wolf pack behavior + troll stay as-is),
`basic` (goblin, skeleton, thrall), `skilled` (bandit, skelarcher, werewolf,
witch), `master` (vargr, morvane, palerider, undergloom? NO — undergloom
stays an unstoppable wall; NOT drake). Elites upgrade one tier.

1. **PROJECTILE EVASION** (poll getProjectiles at 10Hz per aggroed duelist):
   compute closest-approach of each projectile's ray to the enemy within the
   next 1.2s; if threat < bodyR+0.6: roll reaction = tierBase ×
   distanceFactor (time-to-impact > 0.55s → full chance; < 0.25s → near
   zero) × levelScale (the world-scaling multiplier — high-level worlds
   dodge MORE: worthy at any level). tierBase: basic 0.35, skilled 0.6,
   master 0.85. On success: Dodge_Left/Right (pick the side away from the
   projectile's lateral drift) with a 4.5u/s burst for 0.3s + the dodge clip
   at matching speed; cooldown 1.6-3.2s by tier (spam still lands
   sometimes). Witch/morvane/palerider: blink-teleport (existing teleT
   visuals) instead of rolling, 4-6u lateral. Frost/lightning (hitscan-ish):
   dodge on the `spellCast` event itself — a 0.18s pre-window where a
   skilled+ duelist already in motion sidesteps the aim line (only if
   currently strafing; feels like they saw it coming, not like rollback).
2. **WHIFF PUNISH**: on `attackSwing` when this duelist is inside the
   player's forward arc at melee range and its dodge is off cooldown:
   skilled+ chance 0.4/0.7 → Dodge_Backward hop (2.8u) THEN immediate
   counter-lunge: telegraph shortened to 0.22s, +15% damage, distinct audio
   ('swingHeavy'). This is the fencing loop — punish spam, reward feints
   (player who baits the hop can heavy the recovery).
3. **ATTACK TOKENS** (group tactics — kills the conga-line): global cap of
   2 concurrent melee attackers on the player; others enter FLANK state:
   pick a slot on a 6-point ring around the player (±60°..±180°), path to
   it (terrain-aware), strafe-face the player (Running_Strafe clips), and
   swap in when a token frees (attacker killed/retreats). Ranged enemies
   never take tokens — they maintain 10-16u, kiting away when closed
   (backpedal + occasional Dodge_Backward), and PREFER HIGH GROUND: when
   repositioning, sample 5 candidate points and pick the highest
   terrainHeight within range.
4. **LINE-OF-SIGHT DENIAL**: a duelist below 35% hp that has taken
   projectile damage this fight retreats THROUGH cover: pick a waypoint
   that puts a collider (building/rock, from g.colliders, r>1.2) on the
   segment between player and itself, heal-tick there (existing home-heal
   logic), re-engage at 60%+. Master tier does this proactively between
   attack tokens.
5. **ADAPTATION** (per-enemy fight memory, cleared on de-aggro): count
   player melee swings vs projectile casts vs bow shots this fight. If
   projectiles > 60% of actions: raise evasion tierBase one step + widen
   threat window. If melee > 60%: bandits/vargr raise Block usage (existing
   Block clip + tryBlock-style mitigation: 50% damage reduction while
   blocking, breaks on heavy) and add FEINTS (master only): start telegraph,
   cancel at 60%, re-strike after 0.35s — devastating vs panic blockers,
   readable by patient ones (the cancel has a distinct sound cue —
   'uiClick' quiet — and slight head-tilt pose).
6. **PRESSURE READS**: `potionUsed` → all aggroed duelists gain 1.4× speed
   for 2.5s and the nearest token-holder attacks immediately (interrupt
   drinking = punished). Player stamina < 18 → skilled+ press (attack
   cooldowns ×0.7) with an audible aggression bark (goblinCackle/skitter by
   type, quiet). Player blocking > 2.5s continuously → next attacker feints
   (see 5) or kicks (Unarmed kick clip, 4 dmg, breaks block stance:
   isBlocking bypass on that hit — tryBlock opts.kick? combat's tryBlock
   returns {blocked...}; simplest: that hit calls g.player.damage directly
   with a 'guardbreak' notify, small damage, plus stamina -20).
7. **FAIRNESS RAILS** (critical — worthy, not cheap): every defensive
   reaction has cooldown + chance (never 100%); dodges have recovery frames
   (0.25s post-dodge where the duelist can't attack and takes +20% damage —
   skilled players punish the dodge itself); feints ≤1 per 6s per enemy;
   token flankers never attack from behind simultaneously with a frontal
   attacker (max 1 rear attack per 3s); all reaction rolls use seeded
   per-enemy rng (deterministic per fight seed) so it's testable.
8. **TELLS**: every layer has a readable animation/audio tell (dodge wind,
   feint head-tilt + click, flank strafe posture, kite backpedal). The
   player must always be able to LEARN the duelist.

Perf: all polling 10Hz staggered, zero allocations (reuse module arrays),
skip everything beyond 60u or when !aggro. Serialize nothing (fight memory
is transient).

Verify (Playwright): stage fights vs a skilled bandit: (a) fire 6 arrows
from 15u — expect 2-4 dodged (log enemy positions vs projectile paths);
(b) melee-spam — expect hop-backs + counter-lunges; (c) 5-enemy group —
verify ≤2 attackers + flankers on ring slots (log positions); (d) potion
mid-fight — verify speed burst + immediate attack; (e) low-hp retreat puts
a collider on the LOS segment (assert geometrically); screenshot the flank
ring and a mid-dodge frame. READ screenshots. Zero console errors,
node --check. Report status + tuning notes + deviations.

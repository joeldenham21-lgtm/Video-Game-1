# ⚔️ ELDERFALL — A Tale of Emberhollow

> **Also in this repo: [RINGFALL](ringfall/README.md)**, a first-person roguelite arena shooter for phone and laptop. It's a single self-contained file: open `ringfall/index.html`.

An **open-world, first-person fantasy RPG that runs in your phone's browser**. No install, no app store — just open the link and play. Inspired by Skyrim, The Witcher 3, and Middle-earth.

> **▶ PLAY IT:** enable GitHub Pages for this repo (Settings → Pages → Source: *GitHub Actions*), push, and open
> **`https://<your-username>.github.io/Video-Game-1/`** on your phone.
> Or run locally: `npx serve .` and open the URL. (The game is plain static files — any web server works.)

Best experienced **fullscreen, landscape, with headphones**. There's a fullscreen button in the pause menu (⚙).

---

## 🗺️ The World

A hand-seeded realm you can walk end to end — and always, on the northern horizon, the mountain **Drakespire**, where something with wings is waiting.

| Place | What awaits |
|---|---|
| **Emberhollow** | Your village. Five townsfolk with troubles of their own, an inn, a forge, warm windows at night. |
| **Greywatch Tower** | The beacon has gone dark. Someone should find out why. |
| **Barrowdeep Ruins** | A crypt beneath broken arches. The dead keep an old king's sword. |
| **The Wardstones** | A stone circle whose wards have failed. Cleanse it — at night, if you dare. |
| **Redfang Camp** | Bandits, and their lord **Vargr Redfang** — who *remembers* every time he kills you, and returns stronger and scarred. |
| **Mirrormere** | A cold lake with a lost keepsake beneath its docks. |
| **Drakespire** | The end of the road. Bring Aldric's blade. |

Plus wolves in the pines, goblins in the rocks, chests and cairns and cart wrecks tucked along every path.

## 🎮 Controls

**Phone** — left thumb: floating joystick · right thumb: look · big button: attack (hold = heavy) · shield: block/parry · radial button: **weapon wheel** (time slows) · contextual pill: interact.

**Desktop** — WASD + mouse (click to capture) · LMB attack · RMB block · **Q** weapon wheel · **E** interact · **1–6** hotkeys · **J** journal · **Esc** menu.

## ✨ Features

- **Real CC0 art**: professionally rigged KayKit characters (75 animations each), 400+ building/dungeon/cemetery props, all repainted with a dark-fantasy grade — plus a dense procedural wilderness (50+ tree, bush, and rock varieties in seeded groves, fallen logs, glowing mushrooms)
- Full **day/night cycle** with long golden hours, dark dangerous nights, aurora some nights over Drakespire, shooting stars, fog-shrouded distance
- **State-of-the-art combat**: 8-weapon wheel with bullet-time (sword · axe · greatsword · bow · fire · frost · chain lightning · heal), dodge rolls with i-frames, perfect-dodge slow-mo, 3-hit combos, Mordor-style counter prompts, kill-cam finishers, hitstop + parry sparks
- **16+ enemy types**: wolves, goblins, bandits, skeletons & archers, wraiths, werewolves (night forests), vampire thralls, trolls, witches, elite variants with names — plus bosses: the Barrowlord, vampire lord Morvane, the nemesis Vargr Redfang who *remembers killing you*, and the drake Vhastrix
- **Blacksmithing & enchanting**: 4 weighty upgrade tiers at Torvald's forge (each visually altering your weapon), 5 school enchants with glowing blades at the cleansed Wardstones, hidden spell tomes that upgrade your magic
- **Global economy**: 5 vendors with daily price moods + a wandering merchant, mining veins, materials & valuables, village reputation discounts
- **Learn-by-doing skills** (Skyrim-style, less grind): 6 skills leveled by use, 48-perk constellation trees, playstyle-changing capstones
- **Endless endgame**: the whole world scales with you (encounter design makes danger zones dangerous — never stat walls), daily Hunt Board bounties, Blood Moon village sieges, and the Trial of Echoes boss rematches
- **Living world**: 45+ ambient micro-details — ants on logs, creaking inn signs, a noon bell, moths at windows, chickens, the answered wolf howl at night, a villager who feeds the hens at dawn
- **16 readable lore books**, a bestiary, buried treasure, secrets, physics props you can send flying
- **Voiced dialogue** (system speech synthesis, per-character voices) + generative music & 100% synthesized audio
- 5-act main quest + 6 side quests with real choices and consequences
- **Save/load** (autosaves every minute), quality toggle, adaptive resolution

## 🛠️ Tech

Plain ES modules + [three.js](https://threejs.org) r160 (vendored, MIT license). No build step, no bundler, no assets. Chunked vertex-colored terrain with LOD + a static far shell, global InstancedMesh vegetation pools, shader sky dome, fresnel water, pooled particles/projectiles, WebAudio synthesis — tuned for ~60fps on mid-range phones (≤120 draw calls, ACES tone mapping, capped DPR with dynamic resolution).

```
index.html         shell + title screen
src/core.js        seeded noise, terrain function, POIs, event bus  ← single source of truth
src/main.js        boot, game loop, hitstop/slow-mo, adaptive resolution
src/world.js       terrain chunks, far shell, vegetation, water
src/sky.js         sky shader, sun/moon/stars/clouds, lighting, fog
src/player.js      first-person controller, stats, leveling
src/combat.js      weapons, viewmodel, projectiles, loot, particles
src/enemies.js     AI, procedural monsters, bosses, the nemesis
src/structures.js  village, ruins, tower, camp, chests
src/quests.js      NPCs, dialogue, quest chain
src/ui.js          HUD, touch controls, weapon wheel, menus
src/audio.js       procedural SFX + generative music
src/save.js        localStorage persistence
```

Dev: `node test/smoke.mjs` boots the game headless and screenshots it.

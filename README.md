# ⚔️ ELDERFALL — A Tale of Emberhollow

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

- Full **day/night cycle** with long golden hours, dark dangerous nights, drifting clouds, stars, fog-shrouded distance
- **Weapon wheel** (sword · bow · fireball · heal · torch · potion) with bullet-time
- **Combat juice**: hitstop, screen shake, parry sparks with slow-mo, readable enemy telegraphs, stamina rhythm
- **Skyrim-style compass**, discovery banners with a harp sting, quest markers, journal
- **5-act main quest** + side quests with real choices and consequences, a nemesis who remembers you, a dragon boss with a health bar
- XP, levels, gold, loot, one-time chests, a legendary sword to earn
- **Generative music & 100% procedural audio** — lute phrases over warm pads, combat drums, wind that rises with altitude, crickets at night
- **Save/load** (autosaves every minute), quality toggle, adaptive resolution for weaker phones
- Zero downloads at runtime: every model, texture, and sound is generated procedurally. One vendored library (three.js, MIT).

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

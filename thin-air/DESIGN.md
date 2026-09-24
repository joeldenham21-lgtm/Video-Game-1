# THIN AIR — Game Design

> *Subnautica's awe and dread of the unknown, set in the high mountains. Sons of the Forest's hands-on
> survival, logging and building. Everything grounded, everything realistic.*

First-person open-world survival. Godot 4.7. Targets: **Samsung Galaxy S25 Ultra** (Android, Mobile renderer,
touch or gamepad) and **MSI Cyborg 15 A13V** (Windows, Forward+ renderer, RTX 4050/4060 laptop GPU,
keyboard/mouse or gamepad).

## 1. Pillars

1. **Altitude is depth.** Subnautica pulls you deeper; THIN AIR pulls you higher. Every 500 m climbed is
   colder, windier, thinner and more beautiful. Progress is gated by gear, not walls: warmth for the
   treeline, crampons + ice axe for the icefall, bottled oxygen above 2,800 m.
2. **Consistently realistic.** One visual language: physically based materials, real-world scale
   (1 unit = 1 m, altitude shown in metres above sea level), real snow/rock/forest/ice behaviour, believable
   weather. No stylised assets, no cartoon colours, no magic. Danger comes from cold, falls, storms,
   hunger, and wildlife.
3. **Hands-on survival.** Chop real trees that fall and split into logs. Build a log shelter piece by
   piece. Boil snow for water. Cook meat on a fire. Craft from what you carry.
4. **Wonder and dread.** Long golden dawns over the glacier, the Milky Way at 3,000 m, aurora on clear
   winter nights — and wolves answering each other in the dark valley below. The Station's silence.
5. **A human story told through the world.** Radio transmissions, voice logs, notes, and one voice on the
   radio who needs you.

## 2. Story

**You are Sam Calder**, a communications technician contracted to repair the satellite relay of
**Kestrel Station**, a glaciology research station on the col below **Mount Corrigan (3,452 m)** in the
remote **Aldous Range**, northern British Columbia. The station went silent 19 days ago.

**Prologue (black screen, audio only).** Cockpit radio of a DHC-3 Otter bush plane (pilot *Dale Morrow*)
talking to *Terrace Dispatch*: worsening weather, carb icing, engine rough-running, a failed restart,
"brace, brace, brace". Impact.

**Act 1 — The Crash (valley, ~1,480 m).** You wake at dusk in the broken fuselage, snow falling. Dale is
dead. Objectives teach survival: *Get warm* (gather sticks + stones → campfire), *Salvage the wreck*
(first-aid kit, flare gun, survival manual, emergency blanket, hatchet, torn backpack, the damaged
**survey scanner** you were bringing to the station). The cockpit radio still receives a weak automated
beacon from Kestrel Station — and, once, a woman's voice breaking through the static.

**Act 2 — Hollow Creek (forest & lake, ~1,450 m).** The survival manual's map marks a ranger cabin at
**Loon Lake**. There: a two-way handheld radio, a bow, supplies. You reach **Dr. Mara Voss**, glaciologist,
the last one left at Kestrel Station: injured leg, running out of fuel. The pass to the station is cut by
the **Corrigan Icefall**. The station's safety lead, *Owen Burke*, kept a mountaineering depot at the
abandoned **Ashford Mine** on the east flank: ice axe, crampons, rope, and generator fuel.

**Act 3 — Ashford Mine (east flank, ~1,950 m).** A gold-rush era camp: collapsed bunkhouse, headframe,
ore chutes, and a timbered adit running into the mountain. Inside: dark, cold, dripping tunnels; Owen's depot;
signs of what killed him — the enormous old grizzly the station crew called **Old Grey**. Fuel canisters.

**Act 4 — Above the Trees (alpine & glacier, 2,100–2,900 m).** No firewood above the treeline. You need
insulated clothing (hides, wool blanket, parka) and fuel for a stove. Crevasses on the glacier; the icefall
must be climbed with ice axe + crampons.

**Act 5 — Kestrel Station (col, ~2,950 m).** Three prefab modules, a generator shed, a helipad, a weather
mast. Mara is alive. Restart the generator: heat, light, and the **oxygen concentrator** (refills O2
bottles). Mara explains: team lead *Dr. Elias Hale* went up to the summit relay during the storm to fix
the ice-damaged antenna and never came back. Engineer *Tomas Reyes* and technician *June Park* tried to
descend through the icefall to get help. The relay needs a replacement **transceiver module** (station stores)
and a **battery pack**.

**Act 6 — The Summit (3,452 m).** Oxygen, crampons, rope. A final storm. Hale's body near the mast with his
last log. Repair the relay, transmit: *"Terrace Rescue, this is Kestrel Station…"*. Rescue can't fly until the
storm breaks: **survive the night** at the station with Mara. **Dawn**: rotor sound over the ridge, the
helicopter lands on the pad. Credits over the range at sunrise.

Crew logs found in the world tell what happened (see `data/logs.json`): Hale (lead), Voss (glaciologist,
alive), Reyes (engineer), Park (technician), Burke (safety/mountaineer). Also: Dale's flight notes,
a 1930s Ashford miner's diary, a ranger's logbook.

## 3. The World

A single seamless 3,072 m × 3,072 m map (heightmap 2049², 1.5 m cells), 1,300 m → 3,452 m altitude.
North is −Z. Natural boundary: impassable ridges and a river gorge, with far ranges beyond (horizon mesh).

| Zone | Alt (m) | Look | Key places |
|---|---|---|---|
| **Valley floor** (south) | 1,300–1,550 | Braided glacial river, gravel bars, meadows, dense spruce/fir forest, Loon Lake | Crash site (W meadow), Ranger cabin (lake shore), fire lookout (knoll) |
| **Montane forest** | 1,550–2,100 | Steep forested slopes, avalanche chutes, boulder fields, creeks, waterfalls | Ashford Mine (E flank), trapper's cabin, caves |
| **Subalpine / treeline** | 2,100–2,450 | Stunted whitebark pine, larch, krummholz, alpine meadows, talus | Owen's bivouac, rock shelter |
| **Alpine & glacier** | 2,450–3,000 | Snowfields, moraines, **Corrigan Glacier**, crevasses, **Icefall**, tarns | Glacier camp, ice cave |
| **Col & summit** | 2,900–3,452 | Wind-scoured rock, cornices, summit pyramid | **Kestrel Station** (col), **Summit relay** |

Approximate POI positions (x, z) — exact values are generated into `data/world_layout.json`:
crash site (−520, 820) · Loon Lake centre (260, 640) · ranger cabin (420, 520) · fire lookout (−900, 260) ·
Ashford Mine portal (820, −80) · trapper's cabin (−760, −260) · Owen's bivouac (380, −520) ·
icefall (−60, −760) · Kestrel Station (−360, −980) · summit (120, −1260).

## 4. Survival systems

| Meter | Drains from | Restored by | At zero |
|---|---|---|---|
| **Health** | falls, animals, cold, starvation, thirst, hypoxia, bleeding | rest, food, bandages, first aid | death |
| **Food** (calories) | time, exertion, cold | meat, fish, berries, mushrooms, rations | health drain, no stamina regen |
| **Water** | time, exertion, altitude, eating dry food | boiled snow/water, streams (risk), canteen | health drain |
| **Warmth** (body heat) | air temp (lapse rate −6.5 °C/1000 m), wind chill, being wet, night, storms | fire, shelter, clothing insulation, hot food/drink, sleeping in a bed | hypothermia: health drain, shivering, blurred vision |
| **Oxygen** (SpO2) | altitude > 2,800 m (faster with exertion) | descending, O2 bottles (mask), resting | hypoxia: blackout, health drain |
| **Stamina** | sprint, climb, swim, chop, deep snow | rest | cannot sprint/climb; fall when climbing |

Status effects: **Wet** (swimming, blizzard → rapid heat loss), **Bleeding** (animal bites → bandage),
**Sprain** (bad fall → slower), **Frostbite** (prolonged extreme cold → reduced max health), **Well-fed**,
**Warmed up**, **Rested**, **Hypoxic**. Difficulty: *Explorer* (no hunger/thirst, gentler cold),
*Survivor* (default), *Whiteout* (harsh).

**Temperature model.** Air °C = base(day-of-season, hour) − 6.5 × (alt−1,300)/1,000 − weather penalty;
felt °C = air − wind chill (exposure-weighted) + fire heat + shelter bonus + clothing insulation.
Warmth meter drifts toward the "comfort" implied by felt °C.

## 5. Gear, crafting, building

- **Inventory**: weight-limited slot inventory (24 slots; backpack upgrades to 36). Quick-select hotbar
  (6). Equipment slots: head, face, body, legs, hands, feet, back.
- **Crafting**: *hand* (anytime), *campfire* (cook, boil), *workbench* (built), *station fabricator*
  (repaired). Blueprints unlock by picking up materials, reading manuals/notes, and **scanning** with the
  survey scanner (Subnautica-style: hold on wreckage/objects/creatures to learn).
- **Tools**: stone axe → hatchet → felling axe; knife; spear; bow + arrows; torch; flares; flare gun;
  lantern; ice axe; crampons; rope; O2 mask + bottles; canteen; cooking pot; binoculars; map + compass.
- **Clothing**: parka, wool sweater, thermal base layer, hide coat, fur hat, gloves, mountaineering boots,
  goggles (reduce whiteout), each with insulation + wind-proofing values.
- **Building (Sons of the Forest style)**: logs from felled trees. Snap-grid log foundation, floor, wall,
  window wall, door, roof, stairs; lean-to shelter; campfire; stone fire pit; drying rack; storage box;
  workbench; snow-melter; bed (sleep + save); torch stand.

## 6. Wildlife

| Species | Where | Behaviour |
|---|---|---|
| **Grey wolf** | valley & forest, packs of 2–4 | Hunt at dusk/night; stalk, circle, test you; fear fire and flares; flee when the pack is hurt |
| **Grizzly bear** | forest, meadows; **Old Grey** near the mine | Territorial; bluff charges; deadly; can be scared by flare gun |
| **Mule deer / elk** | meadows, forest edges | Graze, alert, flee; food + hide |
| **Mountain goat** | alpine cliffs | Graze on ledges, flee uphill; food + wool |
| **Snowshoe hare** | forest, meadows | Skittish; snares/arrows |
| **Raven / golden eagle** | sky | Ambient; ravens gather over carcasses (hint) |

Animals perceive by sight (cone, light level, crouch), hearing (noise events: sprinting, chopping,
gunfire) and **smell (wind direction matters)**.

## 7. Weather & time

40-minute day (configurable). Clear / cloudy / overcast / light snow / blizzard / valley fog; wind speed
and direction drive wind chill, particle snow, cloud motion, grass/tree sway, audio. Blizzards reduce
visibility to < 30 m and are lethal above the treeline without shelter. Night is genuinely dark (torch/
lantern needed) except under a moon; stars and the Milky Way at altitude; occasional aurora.

## 8. Presentation

- **Look**: late autumn / early winter in the Canadian Rockies. Snow on everything above ~1,800 m, dusting
  below. Physically based sky, volumetric fog (desktop), AgX tone mapping, restrained colour grading.
- **HUD**: minimal. Compass strip with bearings + discovered POIs; altitude (m ASL) and air temperature
  readout; vitals only appear when not full or when changing; centre dot; context prompts. Hides entirely
  in photo mode.
- **Audio**: layered wind by altitude/exposure; footsteps per surface (snow, rock, scree, grass, forest
  floor, wood, ice, water); creaking trees; distant avalanches; fire crackle; radio static; breath gets
  heavier with altitude. **Original score**: sparse, emotional, piano + strings + choir pads + low brass,
  adaptive (day exploration, night, forest, high altitude, station, danger, blizzard, summit, finale).
- **Voice**: radio transmissions and crew logs are voiced (neural TTS, processed as radio/dictaphone audio),
  always subtitled.

## 9. Controls

| Action | Keyboard/Mouse | Gamepad | Touch |
|---|---|---|---|
| Move / look | WASD / mouse | L stick / R stick | left floating stick / right drag |
| Sprint / crouch / jump | Shift / C or Ctrl / Space | L3 / B / A | buttons |
| Use tool / attack | LMB | RT | use button |
| Aim / block / alt | RMB | LT | aim button (context) |
| Interact | E (hold for timed) | X | context button |
| Inventory & crafting | Tab / I | Y | bag button |
| Hotbar | 1–6, wheel | LB/RB | hotbar strip |
| Build mode | B | D-pad up | hammer button |
| Journal / map | J / M | Back / D-pad down | journal button |
| Pause | Esc | Start | pause button |

## 10. Platform targets

| | S25 Ultra (Android) | MSI Cyborg 15 A13V (Windows) |
|---|---|---|
| Renderer | Mobile (Vulkan) | Forward+ (Vulkan/D3D12) |
| Resolution | ~0.6 × 1440p render scale + FSR1, MSAA 2× | native 1080p, TAA or FSR2 Quality |
| Target | 60 fps (dynamic resolution) | 90–144 fps High; 60+ Ultra |
| Fog | depth + height fog | volumetric fog |
| GI/AO | none / baked-in AO in materials | SSAO, SSIL (Ultra) |
| Shadows | 2 cascades, 2048, 120 m | 4 cascades, 4096, 400 m |
| Vegetation | impostors beyond 70 m, grass 25 m | impostors beyond 160 m, grass 60 m |

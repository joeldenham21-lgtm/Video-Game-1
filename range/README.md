# RANGE — KD 600

A browser first-person shooting-range sandbox built on three.js (r160) whose whole point is
three things: **realistic exterior/terminal ballistics**, **detailed weapon models**, and
**physically driven gun-handling animation**. The setting is deliberately plain: a covered
firing line and a known-distance range out to 600 m.

Open `range/index.html` from any static web server (for example `npx serve .` in the repo
root, then `http://localhost:3000/range/`). Everything — geometry, textures, sounds — is
generated procedurally at load; nothing is downloaded.

## What is simulated

### Exterior ballistics (`src/ballistics.js`)
* Point-mass trajectory integrated with **RK4 on 0.4 ms sub-steps** for every round fired.
* **G1 and G7 standard drag functions** (Mach-dependent Cd tables) with published ballistic
  coefficients per load (M855, M193, Mk 262, 9 mm 115/124/147 gr, M80, M118LR, 6.5 CM 140 gr).
* Muzzle velocity derived from the actual barrel length of the weapon.
* Atmosphere from temperature, altitude/pressure and humidity (density and speed of sound).
* Wind as a vector (drag acts on air-relative velocity), with optional gusts.
* **Coriolis** (full 3-D, latitude and range azimuth) and **gyroscopic spin drift**
  (Miller stability factor from the barrel twist, Litz drift model).
* Sights are **zeroed** at a chosen distance under standard conditions by solving the
  bore elevation numerically; the line of sight, not the bore, sits on the camera axis, so
  sight height over bore, cant (lean with Q/E), turret clicks and environment changes all
  shift impacts the way they do on a real range.
* Dispersion = rifle mechanical accuracy ⊕ ammunition accuracy, applied as a Gaussian cone.

### Terminal ballistics
* Every collider carries a material and thickness. Impacts use a closed-form **Poncelet
  penetration** model (soil, concrete, plywood, pine, mild steel, AR500, cardboard …) with the
  real path length through the collider; bullets exit and continue with the residual velocity.
* **Ricochet** below a material/velocity dependent grazing angle; deformed bullets get more
  drag and lose stability. Steel plates take the bullet's momentum as a physical impulse.

### Weapons (`src/weapons/`)
Modelled procedurally at real dimensions (metres), with animatable part rigs:
* **M4A1-pattern carbine** — 14.5" barrel, A2 flash hider, 13" M-LOK rail with real slots,
  flat-top upper with a T2-style reflex sight (66 mm over bore), functioning charging handle,
  bolt carrier visible through the ejection port, dust cover that pops open on the first shot,
  selector (safe / semi / auto), trigger, mag release, bolt catch, 30-round polymer magazine.
* **G17-pattern 9 mm pistol** — slide with a real cut ejection port, Browning tilting barrel,
  visible recoil spring assembly, three-dot sights, slide stop that locks back on empty.
* **R700-pattern precision rifle (.308 / 6.5 CM)** — 24" heavy barrel in an aluminium chassis,
  bolt with 90° lift and 95 mm travel, 10-round box, 34 mm 3-15×50 scope in a one-piece mount.

### Optics (`src/optics.js`)
* The reflex sight draws a **truly collimated dot**: it is rendered where the eye→lens ray is
  parallel to the line of sight, so it stays on target as the head moves.
* The scope renders the world a second time along its optical axis. The ocular shader maps
  eye rays to apparent angles, clips to the exit-pupil cone (**scope shadow** when your eye is
  off axis or at the wrong eye relief), draws a first-focal-plane mil reticle with wind-hold
  dots, and adds edge chromatic aberration. Magnification 3–15× with the mouse wheel.

### Handling animation (`src/viewmodel.js`, `src/recoil.js`, `src/sequences.js`, `src/hands.js`)
* **Recoil is computed, not keyframed**: free-recoil impulse from bullet + powder mass, the
  reciprocating mass (bolt carrier / slide) simulated on its spring with end-of-stroke impacts
  (the AR's double thump, the pistol's delayed slap), muzzle rise from the bore height above the
  support point, and a shooter modelled as translational + rotational mass-spring-dampers.
  The visible carrier / slide position is that simulation; full-auto cyclic rate emerges from it
  (~850 rpm on the carbine).
* Trigger travel → sear break → lock time → primer → barrel time → muzzle exit are explicit.
* Keyframed handling sequences with real events: tactical and empty reloads (bolt release
  slap vs. slide rack), charging-handle pull, press check, bolt cycle with extraction and
  ejection at the end of travel, inspect, draw/holster.
* Procedural sway (noise + breathing, breath hold, winded), walk bob, look lag, ADS transitions,
  muzzle-blocked lowering, lean/cant, crouch.
* Articulated gloved hands with finger poses that follow the trigger and the reload.

### Range, physics, effects, audio
* Rapier (WASM) rigid bodies: every ejected case is a physical cylinder, dropped magazines are
  boxes, gongs hang on revolute joints and swing with the hit, the spinner spins, the popper
  falls and resets. Ray casts against the same world drive bullet impacts.
* Muzzle flash + smoke, material-specific impact particles, brass tinkle, bullet holes in
  paper with group size measured in cm and MOA, paint splats on steel.
* 100 % synthesised audio (WebAudio DSP at load): layered gunshots, a synthetic covered-line
  impulse response, the far-berm echo, every click and clack of the actions, impacts delayed by
  distance / speed of sound (a 500 m gong rings after the bullet's flight *and* the sound's
  return), optional hearing protection with a threshold shift when it is off.
* Ballistic computer (H): live range card under the current atmosphere, holds in mil, laser
  rangefinder (N), shot report with impact chain, slow motion (T), shot trace replay (L).

## Controls
LMB fire · RMB aim · WASD move · Shift sprint / hold breath · C crouch · Q/E lean · R reload ·
X charge / cycle bolt · Z press check · V safety / fire mode · B ammo type (next mag) ·
F inspect · 1 2 3 weapons · [ ] elevation · ; ' windage · wheel magnification · N rangefinder ·
H ballistic computer · L traces · T slow motion · P hearing protection · K reset targets ·
F1 help · Esc settings (wind, temperature, altitude, humidity, latitude, azimuth, zero distance…).

## Layout
```
range/
  index.html          shell, HUD styles, settings menu
  src/ballistics.js   drag tables, atmosphere, RK4 projectile, zero solver, penetration, ricochet
  src/cartridges.js   cartridge data (masses, BCs, MVs, case dimensions)
  src/recoil.js       recoil + reciprocating-mass action simulation
  src/viewmodel.js    first-person rig, fire control, handling state machine
  src/sequences.js    keyframed reload / charge / bolt / inspect sequences
  src/hands.js        procedural articulated hands
  src/weapons/        ar15.js, pistol.js, bolt.js (procedural models + part rigs)
  src/gunparts.js     geometry helpers (lathe, profiles, picatinny rail, cartridges)
  src/materials.js    procedural PBR materials and textures
  src/optics.js       reflex-dot and scope shaders / render-to-texture
  src/projectiles.js  bullet manager: sub-stepped integration + ray casts + impacts
  src/physics.js      Rapier wrapper
  src/world.js        the range
  src/targets.js      paper, gongs, plates, popper, spinner
  src/effects.js      particles, flash, streaks, brass, dropped mags
  src/audio.js        synthesised sound engine
  src/player.js       controller
  src/hud.js          overlay + ballistic computer
  test/               node ballistics checks, geometry checks, Playwright smoke test & viewers
  vendor/             three.js addons (r160) and rapier3d-compat
```

## Tests
```
node range/test/ballistics.mjs                                  # trajectory / penetration sanity vs. published data
node --import ./range/test/register.mjs range/test/geometry.mjs # geometry helper conventions
node range/test/smoke.mjs                                       # headless Playwright: boots, shoots, reloads, screenshots
node range/test/shots.mjs   / node range/test/fpshots.mjs        # weapon and first-person viewers → screenshots
```

# THIN AIR — asset & project tools

Everything under `tools/` is ignored by Godot (`.gdignore`). Every generator is deterministic and re-runnable.

| Tool | Command (from repo root) | Output |
|---|---|---|
| Project settings | `godot --headless --path thin-air -s $PWD/thin-air/tools/godot/setup_project.gd` | `project.godot` input map, layers, autoloads, shader globals; `assets/audio/bus_layout.tres` |
| Original score (music) | `python3.12 thin-air/tools/music/build.py [cue ...]` (`--qa-only` = score checks + MIDI export, no audio), then `godot --headless --path thin-air --import` and `godot --headless --path thin-air -s $PWD/thin-air/tools/music/verify_godot.gd` | `assets/audio/music/*.ogg` (+ `.import`, loop flags), `data/music.json`, `tools/music/midi/*.mid` (readable scores); QA pictures/reports in `tools/music/_cache/qa/` (git-ignored). See "Music" below. |

Workstreams append their generators to this table.

## Music (`tools/music/`)

Every note of the score is composed by hand in `tools/music/cues/*.py` (no generated notes). The
leitmotif "Thin Air" (a rising fifth, then a stepwise climb to the octave) and its forms are
documented in `cues/common.py`. Notation (`Part.phrase`) is bar-checked: a misplaced `|` fails the build.

Pipeline (`lib/`): score model + tempo maps (`score.py`) -> seconds-based MIDI per part, humanised
about ±10 ms / velocity, attack-compensated for slow sampled strings (`midi.py`, `render.py`) ->
fluidsynth stems (48 kHz, MuseScore_General_Full.sf3, cached by MIDI hash) + numpy synth layers
(`synth.py`: detuned-saw pads with filter sweeps, drones, glass partials, noise 'air', plucks, booms,
cymbals) -> mix: EQ, pan/width, synthetic stereo hall IR (frequency-dependent RT60, pre-delay)
convolution -> loop folding (tails wrap onto the loop start; periodic layers are sample-periodic) ->
slow leveler (one-shots) + bus compressor -> BS.1770 loudness (-18 LUFS cues, -16 stingers) +
4x-oversampled true-peak limiter (<= -1 dBTP) -> 44.1 kHz (FFT-periodic resampling for loops) ->
OGG Vorbis q6, verified with `ffmpeg ebur128`. `.import` files set `loop=true` for loops (Godot
restarts at sample 0, `loop_offset=0`; `bpm`/`beat_count` stay 0 so the loop point is the file end).

QA (`lib/qa.py`, printed by every build): instrument ranges, parallel 5ths/8ves between all voice
pairs and inside chord parts (declared doublings exempt), thirds below C3 / seconds below C4,
texture density; loop-seam continuity; spectrogram + loudness-envelope PNGs per cue.
Listening aids (`analyze.py`, on the cached renders): `bands [cue..]` octave-band balance vs 1 kHz +
stereo correlation, `clicks <cue>` broadband-click scan of the master and every stem,
`section <cue> <beat0> <beat1>` approximate loudness of each part inside a passage (finds a part
that buries another, e.g. a timpani heartbeat over the horn calls).
Requires `python3.12` (the system python that has numpy/scipy), fluidsynth, sox, ffmpeg.

| Cue (`data/music.json` key) | Title | Form | Length | Key / tempo |
|---|---|---|---|---|
| `menu` | Thin Air (main theme) | one-shot: solo piano → celli → strings/harp → choir + horns climax → piano coda | 2:41 | D Dorian, 58–68 BPM rubato |
| `explore` | Open Country | loop, piano + harp + soft strings, lots of air | 3:20 | G Lydian, 72 |
| `forest` | Under the Canopy | loop, pizzicato 'footsteps', clarinet/flute/bassoon, low strings | 3:00 | E Dorian, 66 (3/4) |
| `night` | Long Night | loop, dark saw pad, distant piano fragments, celesta, glass stars | 3:00 | D Aeolian, 56 |
| `alpine` | Thin Air (Altitude) | loop, high strings, solo violin, choir oohs, glass, thin air noise | 3:00 | E Lydian, 60 |
| `station` | Kestrel Station | loop, electric piano, solo cello (theme inverted), pad, beacon pings | 2:31 | F# minor, 70 |
| `danger` | Hunted | loop, spiccato/pizz ostinato, corrupted-fifth brass, taiko/timpani/bass drum | 1:30 | C Phrygian, 120 |
| `blizzard` | Whiteout | loop, string clusters swelling and collapsing, low drones, storm noise | 2:00 | B clusters, 60 |
| `summit` | The Summit | one-shot: build on a D pedal → E-major tutti statement ×2 → release | 2:25 | D minor → E major, 66–72 |
| `finale` | Dawn over the Aldous Range | one-shot: the theme resolved in D major, piano → strings → warm tutti → piano | 2:56 | D major, 66–72 |
| `stinger_discovery` / `_danger` / `_objective` / `_death` / `_blueprint` | stingers | one-shots, 5–10 s, -16 LUFS | | |

Loops are mastered so the file end flows into sample 0; the Audio director (`src/audio/`) may cross-fade
on `phrase_starts_s` (every 4 bars) listed per cue in `data/music.json`.

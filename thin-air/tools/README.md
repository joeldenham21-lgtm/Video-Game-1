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
Requires `python3.12` (the system python that has numpy/scipy), fluidsynth, sox, ffmpeg.

# RINGFALL score

The soundtrack is composed as note-by-note scores (`tracks/*.mjs`) and rendered offline. The renderer plays them with CC0 orchestral recordings from Versilian Studios: VSCO-2 CE and VCSL.

```sh
npm run score:samples   # sparse-clone only the instruments used (~1.7 GB)
npm run score           # render every piece and stinger, then copy them into ../../music with the manifest
```

## How a piece is made

- **Notation:** `lib/score.mjs` turns strings like `mf D4/q E4/e F4/e | A4/h.` into events. It supports dynamics, accents, ties and chords. `ost()` builds ostinatos over a harmony and `grid()` builds percussion patterns.
- **Harmony:** `lib/harmony.mjs` parses chord symbols and leads the voices of pads and chorales smoothly.
- **Sampler:** `lib/sampler.mjs` maps samples by pitch, dynamic layer and round robin.
  - Pitch offsets are checked with YIN. Timpani use their own spectral principal-tone estimate from the 1 : 1.5 : 2 mode pattern.
  - Slurred notes enter after the bow or breath attack and hand over with a short release.
  - Long holds crossfade-loop, and solo basses and horns can be doubled into sections.
  - Timing, velocity and length are humanised.
- **Render:** `lib/render.mjs` applies each part's expression curve, EQ and stage seating.
  - Parts are summed into stems (bed, pulse and drive, or main), each with a convolution hall reverb.
  - Everything is folded onto one period so every loop is exactly periodic, then loudness-matched and limited on tiled periods.
  - Each MP3 starts with a sync click for sample-exact loop points in the browser.
- **Checking without speakers:**
  - `analyze.mjs` shows per-bar chroma (which notes sound) and checks the loop seam.
  - `spectro.mjs` writes spectrogram PNGs.
  - `bands.mjs` shows octave-band tonal balance.

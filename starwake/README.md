# STARWAKE

An original science-fiction short film, about 8½ minutes long, in 2.39:1 widescreen at 1920×804 and 24 fps.

A pilot of the empire that devours stars is sent to find its next meal: a young blue sun and the living ocean-moon that sings to it. What she finds there is the only thing that can undo her own world's death.

- **Watch:** [`STARWAKE.mp4`](STARWAKE.mp4). It has soft English subtitles you can switch on in your player.
- **Read:** [`SCREENPLAY.md`](SCREENPLAY.md).

No stock footage, stock sound, samples of recorded audio, or pre-made 3D models were used anywhere in the film:

| Department | How it was made |
|---|---|
| Story & screenplay | Written from scratch for this film (`script.py` holds every spoken line) |
| Picture | Every frame is raymarched in GLSL shaders on the CPU (Mesa llvmpipe through moderngl), then passed through an HDR post pipeline: bloom, anamorphic lens streaks, ACES tonemapping, grading, chromatic aberration and film grain (`render/`) |
| Cast | Six characters voiced with the open-source Kokoro-82M neural TTS model, each with their own treatment: comms radio, a ship-AI voice, the Aurai's doubled cathedral voice (`audio/voices.py`) |
| Score | 22 cues and four leitmotifs, composed in code against the picture and performed by FluidSynth with the FluidR3 GM orchestral soundfont, in a convolution concert hall (`audio/music.py`) |
| Sound design | About 150 effects synthesized from noise and oscillators: warp jumps, the Starmaw's drone, lightning, lasers, explosions, the glowing sea, the Heartseed (`audio/sfx.py`) |
| Mix | Dialogue-driven ducking with at least 9 dB of clearance under every line, bus compression, and loudness mastered to -16 LUFS (`audio/mix.py`) |
| Edit | 45 shots; the edit decision list lives in `timeline.py` |

## Rebuilding the film

These steps assume Ubuntu 24.04 with Python 3.11.

```bash
sudo apt-get install ffmpeg fluidsynth fluid-soundfont-gm sox libegl1 libgl1-mesa-dri
pip install moderngl numpy scipy pillow kokoro-onnx soundfile mido

# voice model (Apache 2.0), about 350 MB
mkdir -p models && cd models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cd ..

python audio/voices.py      # record the cast
python audio/music.py       # perform the score
python audio/sfx.py         # sound design
python audio/mix.py         # final mix + subtitles
python render/queue.py      # render all 45 shots (a few hours on 4 CPU cores)
python assemble.py          # conform, master, and encode
```

Other useful render commands:

- Preview any moment of any shot: `python render/render.py S17 --still 3,7 --scale 0.4`
- Render one shot: `python render/render.py S17`

## Credits

- **Fonts:** Cinzel and Cormorant Garamond, both under the SIL Open Font License.
- **Soundfont:** FluidR3_GM (MIT).
- **Voices:** Kokoro-82M (Apache 2.0).

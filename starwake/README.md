# STARWAKE

An original science-fiction short film, about 10 minutes long, in 2.39:1 widescreen at 1920×804 and 24 fps. It was made in homage to Steven Spielberg's films: the sense of wonder, a child's eye, the absent father, and the reaction shot before the reveal. The score follows the leitmotif tradition of John Williams, the grade takes after Janusz Kamiński's backlit photography, and the sound design draws on Ben Burtt's organic signature sounds.

A pilot of the empire that devours stars is sent to find its next meal: a young blue sun and the living ocean-moon that sings to it. What she finds there is the only thing that can undo her own world's death.

- **Watch:** [`STARWAKE.mp4`](STARWAKE.mp4). It has soft English subtitles you can switch on in your player.
- **Read:** [`SCREENPLAY.md`](SCREENPLAY.md).

No stock footage, stock sound, samples of recorded audio, or pre-made 3D models were used anywhere in the film:

| Department | How it was made |
|---|---|
| Story & screenplay | Written from scratch for this film (`script.py` holds every spoken line). A four-note "star song" is set up on a rooftop in the cold open and pays off at the climax |
| Picture | Every frame is raymarched in GLSL shaders on the CPU (Mesa llvmpipe through moderngl), then passed through an HDR post pipeline: bloom, anamorphic lens streaks, ACES tonemapping, grading, chromatic aberration and film grain (`render/`) |
| Cast | Nine characters voiced with the open-source Kokoro-82M neural TTS model, each with their own treatment: comms radio, a ship-AI voice, the Aurai's doubled cathedral voice, and Nim, who can only echo Asha's own voice back (`audio/voices.py`). The humming of the star song comes from a small voice model built in code (`audio/hum.py`) |
| Score | Composed in code against the picture and performed by FluidSynth with the FluidR3 GM orchestral soundfont, in a convolution concert hall (`audio/music.py`). The main theme grows out of the star song. There is also a Phrygian 5/4 motif for the Hollow Throne, a Lydian motif for the Aurai, and a march for the battle. At the climax the orchestra answers each note Asha hums |
| Sound design | About 150 effects synthesized from noise and oscillators: warp jumps, the Starmaw's drone, lightning, lasers, explosions, the glowing sea, the Heartseed (`audio/sfx.py`) |
| Mix | Dialogue-driven ducking with at least 9 dB of clearance under every line, bus compression, and loudness mastered to -16 LUFS (`audio/mix.py`) |
| Edit | 54 shots; the edit decision list lives in `timeline.py` |
| Grade | A film-lab finish in `assemble.py`: a slightly bleached print look, red halation around highlights, and a pixel of gate weave |

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
python audio/hum.py         # hum the star song
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

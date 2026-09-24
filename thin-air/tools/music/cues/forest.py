"""FOREST - montane forest. E Dorian (C# warmth, C natural for shadow), 3/4, 66 BPM, 66 bars = 3:00 loop.

Low, warm, a little uneasy. Pizzicato celli/basses walk like careful footsteps; violas and celli
hold soft thirds; the clarinet sings in its dark chalumeau/throat register; the flute answers.
A low numpy drone on E (periodic over the loop) is the forest floor.

  1-8    intro     footsteps + inner-string thirds
  9-24   A         clarinet: the fifth (E-B) then a Dorian turn; second phrase reaches D and slides
                   C# -> C (the shadow under the trees)
  25-32  B         flute answers (G-D fifth), harp arpeggios, arco basses
  33-40  C         mystery: F major over an E pedal (Phrygian). Bassoon plays the fifth F-C, then E-B,
                   and sighs B-C-B; clarinet low; harp harmonics
  41-56  A'        clarinet melody returns with a flute counter-melody (contrary motion, checked)
  57-66  outro     footsteps and thirds dissolve; one last distant clarinet fifth; back to bar 1
"""
from score import Cue
from synth import Drone
from common import arp

EM, C, D, AM, GB, BM, F = "E2 B2", "C2 G2", "D2 A2", "A1 E2", "B1 G2", "B1 F#2", "F1 C2"


def build() -> Cue:
    c = Cue("forest", bpm=66, meter=3, key="E Dorian", loop=True, bars=66, title="Under the Canopy",
            intensity=0.3, rt60=3.0, predelay_ms=26, wet_db=-4.5, tail_s=9.0, ir_brightness=0.35)
    cbp = c.part("cb_pizz", "cb_pizz", gain_db=1.0, qa_voice=False)
    vcp = c.part("vc_pizz", "vc_pizz", gain_db=-8.0, qa_voice=False)
    vc = c.part("vc", "vc", gain_db=1.0)
    vla = c.part("vla", "vla", gain_db=1.0)
    cb = c.part("cb", "cb", gain_db=-1.0)
    cl = c.part("clarinet", "clarinet", gain_db=0.0)
    fl = c.part("flute", "flute", gain_db=-2.0)
    bsn = c.part("bassoon", "bassoon", gain_db=-3.0)
    harp = c.part("harp", "harp", gain_db=-5.0)
    c.add(Drone("drone", pitches=[("E2", 0.0), ("B2", -7.0)], continuous=True, brightness=0.18,
                breathe_hz=0.045, breathe_depth=0.45, gain_db=-17.0, send=0.35, lp=900, hp=35))

    # ---------------------------------------------------------------- footsteps (pizzicato)
    def steps(start, chords, vel_cb=58, vel_vc=50):
        cbp.phrase(start, f"@{vel_cb} " + arp(chords, "0:1 r:2"))
        vcp.phrase(start, f"@{vel_vc} " + arp(chords, "r:2 1:1"))

    steps(0, [EM, "x", C, "x", EM, "x", D, "x"], 54, 44)                                  # 1-8
    steps(24, [EM, "x", C, "x", D, "x", EM, "x", EM, "x", AM, "x", C, D, EM, "x"])       # 9-24
    steps(120, [EM, "x", C, "x", D, "x", EM, "x", EM, "x", AM, "x", C, D, EM, "x"])      # 41-56
    steps(168, [EM, "x", C, "x", EM, "x", D, "x", EM, "x"], 52, 42)                      # 57-66

    # ---------------------------------------------------------------- inner strings (thirds)
    vc.phrase(6, "G3:3 | ~:3 | G3:3 | ~:3 | G3:3 | F#3:3 |")                              # 3-8
    vla.phrase(6, "C4:3 | ~:3 | B3:3 | ~:3 | D4:3 | ~:3 |")
    vc.phrase(24, "G3:3 | ~:3 | G3:3 | ~:3 | F#3:3 | ~:3 | G3:3 | ~:3 | "
                  "G3:3 | ~:3 | A3:3 | ~:3 | E3:3 | F#3:3 | G3:3 | ~:3 |")                  # 9-24
    vla.phrase(24, "B3:3 | ~:3 | C4:3 | ~:3 | D4:3 | ~:3 | B3:3 | ~:3 | "
                   "B3:3 | ~:3 | C4:3 | ~:3 | C4:3 | D4:3 | B3:3 | ~:3 |")
    vc.phrase(72, "E3:3 | ~:3 | D3:3 | ~:3 | E3:3 | ~:3 | D3:3 | ~:3 |")                  # 25-32
    vla.phrase(72, "G3:3 | ~:3 | G3:3 | ~:3 | A3:3 | ~:3 | D4:3 | A3:3 |")
    vc.phrase(96, "A3:3 | ~:3 | G3:3 | ~:3 | A3:3 | ~:3 | G3:3 | ~:3 |")                  # 33-40
    vla.phrase(96, "C4:3 | ~:3 | B3:3 | ~:3 | C4:3 | ~:3 | B3:3 | ~:3 |")
    vc.phrase(120, "G3:3 | ~:3 | G3:3 | ~:3 | F#3:3 | ~:3 | G3:3 | ~:3 | "
                   "G3:3 | ~:3 | A3:3 | ~:3 | E3:3 | F#3:3 | G3:3 | ~:3 |")                 # 41-56
    vla.phrase(120, "B3:3 | ~:3 | C4:3 | ~:3 | D4:3 | ~:3 | B3:3 | ~:3 | "
                    "B3:3 | ~:3 | C4:3 | ~:3 | C4:3 | D4:3 | B3:3 | ~:3 |")
    vc.phrase(168, "G3:3 | ~:3 | G3:3 | ~:3 | G3:3 | ~:3 | F#3:3 | ~:3 |")                 # 57-64
    vla.phrase(168, "B3:3 | ~:3 | C4:3 | ~:3 | B3:3 | ~:3 | D4:3 | ~:3 |")
    cb.phrase(72, "C2:3 | ~:3 | B1:3 | ~:3 | A1:3 | ~:3 | B1:3 | D2:3 |")                  # 25-32 arco
    cb.phrase(96, "E1:3 | ~:3 | ~:3 | ~:3 | ~:3 | ~:3 | ~:3 | ~:3 |")                      # 33-40 pedal

    # ---------------------------------------------------------------- winds
    cl_a = ("r:1 E4:1 B4:1 | C#5:2 B4:1 | A4:2 G4:1 | E4:3 | F#4:1 G4:1 A4:1 | D4:2 E4:1 | B3:3 | ~:3 | "
            "r:1 E4:1 B4:1 | D5:2 C#5:1 | C5:2 B4:1 | A4:3 | G4:1 A4:1 B4:1 | F#4:2 A4:1 | G4:2 F#4:1 | E4:3 |")
    cl.phrase(24, cl_a)
    cl.phrase(120, cl_a)
    cl.phrase(96, "r:3 | E4:3 | ~:3 | D4:3 | r:3 | E4:3 | F#4:3 | ~:3 |")                  # C, low
    cl.phrase(180, "r:1 E4:1 B4:1 | ~:3 |")                                              # last call
    fl.phrase(72, "r:1 G4:1 D5:1 | E5:2 D5:1 | B4:3 | A4:1 B4:1 D5:1 | C5:2 B4:1 | A4:3 | "
                  "F#4:1 A4:1 B4:1 | A4:3 |")
    fl.phrase(120, "r:3 | E5:3 | E5:3 | C5:3 | A4:3 | D5:3 | G4:2 A4:1 | B4:3 | "
                   "r:3 | G5:2 E5:1 | E5:3 | C5:2 D5:1 | E5:3 | D5:2 C5:1 | B4:3 | ~:3 |")
    bsn.phrase(96, "F2:1 C3:2 | ~:3 | E2:1 B2:2 | ~:3 | F2:1 C3:2 | ~:3 | E2:1 B2:1 C3:1 | B2:3 |")

    # ---------------------------------------------------------------- harp
    harp.phrase(72, "@46 " + arp(["C3 G3 E4", "C3 G3 D4", "D3 G3 D4", "x", "E3 A3 C4", "x",
                                  "D3 F#3 B3", "D3 A3 F#4"], "0:1 1:1 2:1"), arch=6)
    harp.phrase(96, "@40 r:2 B5:1 | r:3 | r:1 E6:1 r:1 | r:3 | r:2 B5:1 | r:3 | r:1 E6:1 r:1 | r:3 |")
    harp.phrase(141, "@38 r:2 B5:1 | r:3 | r:3 | r:1 E6:1 r:1 |")

    # ---------------------------------------------------------------- dynamics
    vc.dyn((6, "n"), (12, "pp"), (24, "pp"), (40, "p"), (70, "p"), (96, "pp"), (118, "pp"), (140, "p"),
           (166, "pp"), (180, "pp"), (192, "n"))
    vla.dyn((6, "n"), (12, "pp"), (24, "pp"), (40, "p"), (70, "p"), (96, "pp"), (118, "pp"), (140, "p"),
            (166, "pp"), (180, "pp"), (192, "n"))
    cb.dyn((72, "pp"), (84, "p"), (94, "pp"), (96, "pp"), (110, "p"), (120, "n"))
    cl.dyn((24, "mp"), (36, "mf"), (44, "mp"), (48, "mp"), (60, "mf"), (70, "p"), (96, "pp"), (118, "p"),
           (120, "mp"), (132, "mf"), (144, "mp"), (156, "mf"), (166, "p"), (180, "pp"), (186, "n"))
    fl.dyn((72, "p"), (80, "mp"), (90, "p"), (120, "p"), (135, "mp"), (150, "mf"), (160, "mp"), (168, "p"))
    bsn.dyn((96, "p"), (108, "mp"), (114, "p"), (118, "pp"))
    return c

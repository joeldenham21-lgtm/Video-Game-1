"""ALPINE - above the trees. E Lydian (A#), 4/4, 60 BPM, 45 bars = 3:00 loop.

Thin air: almost no bass. High violin dyads, choir 'oohs', a bowed-glass pad, numpy glass partials
and a faint band of high 'air'. A solo violin keeps attempting the ascent (E-B, C#-D#...) and runs
out of breath on D# - the leading tone - until the swell at bar 33, where it finally reaches E and
soars to the Lydian F#. Then it thins out again.

  1-8    Emaj9 / F#/E shimmer (Lydian II over the tonic); violin: the fifth, then a faltering climb
  9-16   choir enters: C#m9 - F#6/9 - Bsus2 - Emaj7
  17-24  G#m7 - F#add9 - E/G# - C#m7; the violin's fifth on D#, then climb stops at D#
  25-32  the thinnest air: E pedal, glass, harp harmonics, fragments
  33-40  the swell: the climb completes E-B-C#-D#-E and rises to F#
  41-45  thins out to the opening shimmer
"""
from score import Cue
from synth import Drone, Glass, NoiseSwell


def build() -> Cue:
    c = Cue("alpine", bpm=60, meter=4, key="E Lydian", loop=True, bars=45, title="Thin Air (Altitude)",
            intensity=0.3, rt60=4.2, predelay_ms=40, wet_db=-2.5, tail_s=12.0, ir_brightness=0.7,
            ir_seed=17)
    vs = c.part("vln_solo", "vln_solo", gain_db=-1.0, send=0.55, lp=9000, shelf=[("high", 4000, -2.5)])
    v1 = c.part("vln1", "vln1", gain_db=-3.0)
    v2 = c.part("vln2", "vln2", gain_db=-1.0)
    vla = c.part("vla", "vla", gain_db=-2.0)
    cb = c.part("cb", "cb", gain_db=2.0)
    ch = c.part("choir", "choir_ooh", gain_db=-3.0)
    bg = c.part("bowed_glass", "bowed_glass", gain_db=3.0, qa_voice=False)
    harp = c.part("harp", "harp", gain_db=6.0, send=0.7)
    cel = c.part("celesta", "celesta", gain_db=-6.0, send=0.8, delay=(0.5, 0.35, 0.3))

    L = 45 * 4
    c.add(Drone("drone", pitches=[("E2", 0.0), ("B2", -6.0)], continuous=True, brightness=0.1,
                breathe_hz=0.03, breathe_depth=0.5, gain_db=-16.0, send=0.4, lp=700))
    c.add(NoiseSwell("air", continuous=True, bands=[
        (5200, 2.2, [(0, -42), (40, -38), (96, -32), (128, -31), (140, -40), (L, -42)]),
        (9500, 2.8, [(0, -46), (60, -42), (100, -36), (128, -35), (150, -44), (L, -46)])],
        gain_db=0.0, send=0.5, hp=2500))
    c.add(Glass("glass", notes=[
        ("G#6", 4, 8, -8), ("D#7", 18, 6, -12), ("F#6", 48, 8, -9), ("C#7", 54, 6, -12),
        ("B6", 96, 6, -7), ("E6", 102, 8, -9), ("D#7", 110, 6, -11), ("G#6", 116, 8, -9),
        ("E7", 132, 6, -13), ("B6", 164, 10, -9), ("G#6", 170, 8, -11)],
        attack=2.5, release=5.0, gain_db=-7.0, send=0.8, dry_db=-3.0, hp=600))

    # ---------------------------------------------------------------- 1-8 shimmer
    v1.phrase(0, "[B5,D#6]:4 | ~:4 | [A#5,C#6]:4 | ~:4 | [B5,D#6]:4 | ~:4 | [A#5,C#6]:4 | ~:4 |")
    v2.phrase(0, "F#5:4 | ~:4 | F#5:4 | ~:4 | F#5:4 | ~:4 | F#5:4 | ~:4 |")
    bg.phrase(0, "[E4,B4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    vs.phrase(8, "E5:1 B5:3 | r:4 | r:4 | r:4 | C#6:2 r:2 | D#6:3 r:1 |")
    harp.phrase(4, "@44 r:2 G#6:2 | r:4 | r:4 | r:4 | r:1 D#6:3 |")
    # ---------------------------------------------------------------- 9-16 choir
    ch.phrase(32, "[G#4,B4,D#5]:4 | ~:4 | [A#4,C#5,D#5]:4 | ~:4 | [F#4,B4,C#5]:4 | ~:4 | "
                  "[G#4,B4,E5]:4 | ~:4 |")
    v1.phrase(32, "[G#5,B5]:4 | ~:4 | [A#5,D#6]:4 | ~:4 | [F#5,B5]:4 | ~:4 | [G#5,D#6]:4 | ~:4 |")
    vla.phrase(32, "C#4:4 | ~:4 | A#3:4 | ~:4 | B3:4 | ~:4 | G#3:4 | ~:4 |")
    vs.phrase(32, "E5:1 B5:3 | ~:4 | C#6:2 r:2 | r:4 |")
    # ---------------------------------------------------------------- 17-24
    ch.phrase(64, "[G#4,B4,D#5]:4 | ~:4 | [A#4,C#5,F#5]:4 | ~:4 | [G#4,B4,E5]:4 | ~:4 | ~:4 | ~:4 |")
    v1.phrase(64, "[B5,D#6]:4 | ~:4 | [A#5,D#6]:4 | ~:4 | [G#5,B5]:4 | ~:4 | [G#5,C#6]:4 | ~:4 |")
    vla.phrase(64, "G#3:4 | ~:4 | A#3:4 | ~:4 | B3:4 | ~:4 | G#3:4 | ~:4 |")
    vs.phrase(64, "D#5:1 A#5:3 | ~:4 | r:4 | r:4 | E5:1 B5:3 | C#6:1.5 D#6:0.5 r:2 | r:4 | r:4 |")
    # ---------------------------------------------------------------- 25-32 thinnest
    bg.phrase(96, "[E4,B4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    vs.phrase(104, "E5:1 B5:3 | r:4 | r:4 | r:4 | r:2 C#6:2 | r:4 |")
    harp.phrase(100, "@40 r:1 E6:3 | r:4 | r:4 | r:2 B5:2 |")
    cel.phrase(116, "@36 r:2 E7:0.5 B6:0.5 G#6:1 |")
    # ---------------------------------------------------------------- 33-40 the swell
    ch.phrase(128, "[G#4,B4,D#5]:4 | ~:4 | [A#4,C#5,E5]:4 | ~:4 | [G#4,B4,E5]:4 | ~:4 | "
                   "[F#4,B4,E5]:4 | [F#4,B4,D#5]:4 |")
    v1.phrase(128, "[B5,D#6]:4 | ~:4 | [A#5,C#6]:4 | ~:4 | [G#5,B5]:4 | ~:4 | [F#5,B5]:4 | ~:4 |")
    v2.phrase(128, "F#5:4 | ~:4 | F#5:4 | ~:4 | F#5:4 | ~:4 | F#5:4 | ~:4 |")
    vla.phrase(128, "E4:4 | ~:4 | E4:4 | ~:4 | E4:4 | ~:4 | E4:4 | B3:4 |")
    cb.phrase(128, "E2:4 | ~:4 | ~:4 | ~:4 | C#2:4 | ~:4 | B1:4 | ~:4 |")
    vs.phrase(128, "E5:1 B5:3 | C#6:1.5 D#6:0.5 E6:2 | F#6:4 | ~:2 E6:2 | D#6:4 | C#6:2 B5:2 | B5:4 | ~:2 r:2 |")
    # ---------------------------------------------------------------- 41-45 thin out
    ch.phrase(160, "[G#4,B4,D#5]:4 | ~:4 | ~:2 r:2 |")
    v1.phrase(160, "[B5,D#6]:4 | ~:4 | ~:4 | ~:4 | r:4 |")
    bg.phrase(160, "[E4,B4]:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    vs.phrase(168, "r:1 E5:1 B5:2 | ~:4 |")
    harp.phrase(172, "@38 r:2 G#6:2 |")

    # ---------------------------------------------------------------- dynamics
    vs.dyn((8, "p"), (11, "mp"), (16, "p"), (32, "p"), (36, "mp"), (44, "p"), (64, "mp"), (72, "p"),
           (80, "mp"), (86, "p"), (104, "pp"), (124, "pp"), (128, "mp"), (134, "mf"), (140, "f"),
           (146, "mf"), (152, "mp"), (158, "p"), (168, "pp"), (176, "n"))
    v1.dyn((0, "pp"), (28, "pp"), (32, "p"), (60, "p"), (64, "p"), (80, "mp"), (92, "pp"), (96, "n"),
           (126, "n"), (128, "p"), (136, "mp"), (144, "mf"), (156, "mp"), (160, "p"), (172, "pp"), (176, "n"))
    v2.dyn((0, "pp"), (30, "pp"), (32, "n"), (126, "n"), (128, "p"), (140, "mp"), (158, "p"), (160, "n"))
    vla.dyn((32, "pp"), (48, "p"), (60, "pp"), (64, "pp"), (80, "p"), (94, "pp"), (96, "n"), (126, "n"),
            (128, "p"), (144, "mp"), (158, "p"), (160, "n"))
    cb.dyn((128, "pp"), (140, "p"), (152, "pp"), (160, "n"))
    ch.dyn((32, "pp"), (40, "p"), (56, "mp"), (62, "p"), (64, "p"), (80, "mp"), (92, "pp"), (96, "n"),
           (126, "n"), (128, "p"), (138, "mf"), (146, "f"), (154, "mf"), (160, "p"), (170, "n"))
    bg.dyn((0, "p"), (28, "pp"), (32, "n"), (94, "n"), (96, "pp"), (112, "p"), (126, "pp"), (128, "n"),
           (158, "n"), (160, "pp"), (176, "p"), (180, "p"))
    return c

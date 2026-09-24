"""STATION - Kestrel Station. F# minor -> a hint of A major, 4/4, 70 BPM, 44 bars = 2:31 loop.

Melancholic: a tine electric piano with a gentle broken-chord figure, a warm numpy pad, and a solo
cello singing the theme's INVERSION (falling fifth, stepwise descent: loss). A soft sine 'beacon'
pings every two bars in the quiet sections - the station's automated beacon heard at the crash.

  1-8    EP figure alone (F#m9 - Dmaj7 - A/C# - Esus4 E - F#m - Dmaj7 - Bm7 - C#sus4 C#), beacon
  9-16   the cello's inversion C#-F#-E-D-C#
  17-24  EP melody: the rising fifth A-E twice, but the climb falls back; cello counter-line
  25-32  the station's silence: sparse chords, pad, beacon
  33-40  hope: A major. The EP completes the whole ascent A-E-F#-G#-A; strings and cello warm it
  41-44  a deceptive turn (D - E - F#m) folds back into the opening figure
"""
from score import Cue
from synth import Glass, SawPad
from common import bar_pedal


def build() -> Cue:
    c = Cue("station", bpm=70, meter=4, key="F# minor", loop=True, bars=44, title="Kestrel Station",
            intensity=0.2, rt60=2.8, predelay_ms=24, wet_db=-5.0, tail_s=10.0, ir_brightness=0.45,
            ir_seed=23)
    ep = c.part("ep", "ep", gain_db=5.0, shelf=[("high", 5000, -2.0)])
    epl = c.part("ep_lh", "ep", gain_db=1.0, pan=-0.1, shelf=[("high", 5000, -2.0)])
    vcs = c.part("vc_solo", "vc_solo", gain_db=1.0, lp=6500, shelf=[("high", 2800, -4.0)])
    vln2 = c.part("vln2", "vln2", gain_db=-1.0)
    vla = c.part("vla", "vla", gain_db=-1.0)

    # ---------------------------------------------------------------- A (1-8) EP figure
    fig_lh = ("[F#2,C#3]:4 | [D2,A2]:4 | [C#2,A2]:4 | [E2,B2]:4 | [F#2,C#3]:4 | [D2,A2]:4 | "
              "[B1,F#2]:4 | [C#2,G#2]:4 |")
    fig_rh = ("r:1 C#5:1 G#4:1 A4:1 | r:1 C#5:1 F#4:1 A4:1 | r:1 C#5:1 E4:1 A4:1 | "
              "r:1 B4:1 E4:1 A4:0.5 G#4:0.5 | r:1 C#5:1 G#4:1 A4:1 | r:1 C#5:1 F#4:1 A4:1 | "
              "r:1 D5:1 F#4:1 A4:1 | r:1 F#4:1 E#4:2 |")
    epl.phrase(0, "@44 " + fig_lh)
    ep.phrase(0, "@46 " + fig_rh, arch=6)
    # ---------------------------------------------------------------- B (9-16) cello inversion
    epl.phrase(32, "@42 " + fig_lh.replace("[D2,A2]:4 | [C#2,A2]", "D2:4 | [C#2,A2]", 1))
    ep.phrase(32, "@40 " + fig_rh, arch=5)
    vcs.phrase(32, "C#4:1 F#3:3 | E3:1.5 D3:0.5 C#3:2 | E3:2 A3:1 G#3:1 | B3:3 r:1 | "
                   "C#4:1 F#3:3 | A3:1.5 G#3:0.5 F#3:2 | D4:2 C#4:1 B3:1 | G#3:2 E#3:2 |")
    # ---------------------------------------------------------------- C (17-24) EP melody
    epl.phrase(64, "@42 [D2,A2]:4 | [C#2,A2]:4 | [B1,F#2]:4 | [F#2,C#3]:4 | [D2,A2]:4 | [E2,B2]:4 | "
                   "[F#2,C#3]:4 | ~:4 |")
    ep.phrase(64, "@50 r:1 A4:1 E5:2 | D5:1.5 C#5:0.5 A4:2 | r:1 B4:1 F#5:2 | E5:2 C#5:2 | "
                  "r:1 A4:1 E5:2 | F#5:1.5 G#5:0.5 E5:2 | C#5:4 | r:4 |", arch=6)
    vcs.phrase(64, "F#3:4 | E3:4 | D3:4 | C#3:4 | D3:2 F#3:2 | G#3:2 B3:2 | A3:4 | ~:2 r:2 |")
    # ---------------------------------------------------------------- D (25-32) silence
    ep.phrase(96, "@34 [F#3,A3,C#4,G#4]:4 | [D3,A3,C#4,F#4]:4 | r:4 | [D3,A3,C#4,E4]:4 | "
                  "[B2,F#3,A3,D4]:4 | [C#3,G#3,F#4]:4 | [F#3,A3,C#4]:4 | r:4 |")
    # ---------------------------------------------------------------- E (33-40) hope
    epl.phrase(128, "@44 [A2,E3]:4 | [G#2,E3]:4 | [F#2,C#3]:4 | [D2,A2]:4 | [A2,E3]:4 | [E2,B2]:4 | "
                    "[D2,A2]:4 | [E2,B2]:4 |")
    ep.phrase(128, "@52 r:1 A4:1 E5:2 | F#5:1.5 G#5:0.5 A5:2 | B5:2 A5:1 G#5:1 | F#5:4 | "
                   "r:1 A4:1 E5:2 | F#5:1.5 G#5:0.5 A5:1 B5:1 | C#6:2.5 B5:0.5 A5:0.5 G#5:0.5 | "
                   "A5:2 G#5:2 |", arch=8)
    vcs.phrase(128, "A3:4 | B3:4 | A3:4 | F#3:4 | E3:4 | G#3:4 | F#3:4 | E3:4 |")
    vla.phrase(128, "C#4:4 | B3:4 | C#4:4 | A3:4 | C#4:4 | B3:4 | A3:4 | B3:4 |")
    vln2.phrase(128, "E4:4 | E4:4 | F#4:4 | D4:4 | E4:4 | E4:4 | F#4:4 | G#4:4 |")
    # ---------------------------------------------------------------- F (41-44) turn back
    epl.phrase(160, "@40 [D2,A2]:4 | [E2,B2]:4 | [F#2,C#3]:4 | ~:4 |")
    ep.phrase(160, "@42 r:2 F#5:1 E5:1 | D5:2 C#5:2 | r:1 C#5:1 G#4:1 A4:1 | r:4 |")
    for p in (ep, epl):
        bar_pedal(p, 1, 44)

    # ---------------------------------------------------------------- pad + beacon
    pad = []
    prog = [(1, ["F#2", "C#3", "A3"]), (2, ["D2", "A2", "F#3"]), (3, ["C#2", "A2", "E3"]),
            (4, ["E2", "B2", "G#3"]), (5, ["F#2", "C#3", "A3"]), (6, ["D2", "A2", "F#3"]),
            (7, ["B1", "F#2", "D3"]), (8, ["C#2", "G#2", "E#3"])]
    for base in (0, 8):
        for bar, notes in prog:
            for k, p in enumerate(notes):
                pad.append((p, (base + bar - 1) * 4, 4.4, [-3, -6, -9][k]))
    for bar, notes in [(17, ["D2", "A2", "F#3"]), (18, ["C#2", "A2", "E3"]), (19, ["B1", "F#2", "D3"]),
                       (20, ["F#2", "C#3", "A3"]), (21, ["D2", "A2", "F#3"]), (22, ["E2", "B2", "G#3"]),
                       (23, ["F#2", "C#3", "A3"]), (24, ["F#2", "C#3", "A3"]),
                       (25, ["F#2", "C#3", "A3"]), (26, ["D2", "A2", "F#3"]), (27, ["F#2", "C#3", "A3"]),
                       (28, ["D2", "A2", "E3"]), (29, ["B1", "F#2", "D3"]), (30, ["C#2", "G#2", "F#3"]),
                       (31, ["F#2", "C#3", "A3"]), (32, ["F#2", "C#3", "A3"]),
                       (33, ["A2", "E3", "C#4"]), (34, ["G#2", "E3", "B3"]), (35, ["F#2", "C#3", "A3"]),
                       (36, ["D2", "A2", "F#3"]), (37, ["A2", "E3", "C#4"]), (38, ["E2", "B2", "G#3"]),
                       (39, ["D2", "A2", "F#3"]), (40, ["E2", "B2", "G#3"]),
                       (41, ["D2", "A2", "F#3"]), (42, ["E2", "B2", "G#3"]), (43, ["F#2", "C#3", "A3"]),
                       (44, ["F#2", "C#3", "A3"])]:
        for k, p in enumerate(notes):
            pad.append((p, (bar - 1) * 4, 4.4, [-3, -6, -9][k]))
    c.add(SawPad("pad", notes=pad, voices=4, detune_cents=7, attack=1.6, release=2.4,
                 cutoff=[(0, 700), (64, 1000), (96, 650), (128, 1300), (160, 800), (176, 700)],
                 resonance=0.6, sine_mix=0.6, gain_db=-13.0, send=0.45, hp=45, seed=31))
    pings = [("C#6", b * 8, 0.25, -12 if b % 2 else -15) for b in range(0, 4)]
    pings += [("C#6", 96 + b * 8, 0.25, -11 if b % 2 else -14) for b in range(0, 4)]
    pings += [("C#6", 160 + b * 8, 0.25, -13) for b in range(0, 2)]
    c.add(Glass("beacon", notes=pings, partials=[(1.0, 1.0), (2.0, 0.08), (3.0, 0.02)], attack=0.004,
                release=2.4, shimmer_depth=0.0, gain_db=-7.0, send=0.6, dry_db=-2.0, hp=400))

    # ---------------------------------------------------------------- dynamics
    vcs.dyn((32, "mp"), (36, "mf"), (40, "mp"), (44, "p"), (48, "mp"), (54, "mf"), (60, "mp"), (63, "p"),
            (64, "p"), (80, "mp"), (92, "p"), (95, "n"), (128, "p"), (140, "mp"), (156, "p"), (160, "n"))
    vla.dyn((128, "pp"), (140, "p"), (156, "pp"), (160, "n"))
    vln2.dyn((128, "pp"), (140, "p"), (156, "pp"), (160, "n"))
    return c

"""EXPLORE - day exploration. G (Lydian colour, C#/F# over C), 4/4, 72 BPM, 60 bars = 3:20 loop.

Open 'stacked-fifth' left-hand voicings (G-D-A, E-B-F#, C-G-D) leave the thirds to the melody:
the air is thin. Every phrase opens with the rising fifth; at bar 10 the full ascent G-D-E-F#-G
appears for the first time in the game.

  1-8    A    piano alone: four fifth-calls, each answered by a falling line
  9-16   A'   the ascent (bar 10); celli + violas enter under it, pianissimo
  17-24  B    1st violins sing the fifth-and-climb in long notes; harp takes the arpeggios;
              violas hold G as a pedal for seven bars; the piano only answers
  25-32  B'   the melody passes to the celli (tenor register); violins become a high halo
  33-40  C    'the clearing': almost nothing. Piano fifth-calls, harp echoes a fifth higher,
              pianissimo violins. Silence is part of the music.
  41-48  A''  the piano melody an octave lower (warmer), celli/basses underneath, harp glints
  49-56  D    2nd violins recall the fifth; piano and harp close; strings fade
  57-60  T    piano alone on C(#11) -> G, falling F#-E-D; flows back into bar 1
"""
from score import Cue
from common import arp, bar_pedal

G, GB, EM, C, AM, BM, DS, D = ("G2 D3 A3", "B1 G2 D3", "E2 B2 F#3", "C2 G2 D3", "A1 E2 B2",
                               "B1 F#2 D3", "D2 A2 G3", "D2 A2 E3")
# harp arpeggios sit an octave higher, clear of the celli
hEM, hC, hGB, hAM, hDS, hD, hBM, hG = ("E3 B3 F#4", "E3 G3 D4", "D3 G3 D4", "C3 E3 C4", "D3 G3 A4",
                                        "D3 A3 F#4", "D3 A3 F#4", "G3 D4 A4")


def build() -> Cue:
    c = Cue("explore", bpm=72, meter=4, key="G Lydian", loop=True, bars=60, title="Open Country",
            intensity=0.25, rt60=3.3, predelay_ms=30, wet_db=-4.0, tail_s=10.0)
    warm = [("high", 4200, -3.0)]
    pno = c.part("pno", "piano", gain_db=0.0, shelf=warm)
    pnl = c.part("pno_lh", "piano", gain_db=-3.5, pan=-0.08, shelf=warm)
    harp = c.part("harp", "harp", gain_db=-6.0)
    vln1 = c.part("vln1", "vln1_fast", gain_db=-1.0)
    vln1p = c.part("vln1_pad", "vln1", gain_db=-2.0)
    vln2 = c.part("vln2", "vln2", gain_db=-2.5)
    vln2f = c.part("vln2_frag", "vln2_fast", gain_db=-2.0)
    vla = c.part("vla", "vla", gain_db=0.0)
    vc = c.part("vc", "vc", gain_db=-2.0)
    vcm = c.part("vc_mel", "vc_fast", gain_db=0.0)
    cb = c.part("cb", "cb", gain_db=0.0)

    # ------------------------------------------------------------------ piano
    pnl.phrase(0, "@38 " + arp([G, "x", EM, "x", C, "x", DS, D], "0:1 1:1 2:2"), arch=6)
    pno.phrase(0, "@50 r:1 D5:1 A5:2 | G5:1.5 F#5:0.5 D5:2 | r:1 B4:1 F#5:2 | E5:3 r:1 | "
                  "r:1 E5:1 B5:2 | A5:1.5 G5:0.5 F#5:2 | r:1 A5:1 G5:1 E5:1 | D5:2 r:2 |", arch=6)
    # A' - the ascent
    pnl.phrase(32, "@36 " + arp([G, GB, C, AM, EM, C, DS, D], "0:2 1:2"), arch=5)
    pno.phrase(32, "@48 r:1 G4:1 D5:2 | E5:1.5 F#5:0.5 G5:2 | r:2 B5:1 A5:1 | G5:3 r:1 | "
                   "r:1 B4:1 F#5:2 | G5:1.5 E5:0.5 B4:2 | r:1 A4:1 D5:1 E5:1 | F#5:3 r:1 |", arch=7)
    # B - answers only
    pno.phrase(64, "@40 r:4 | r:4 | r:4 | r:2 B5:1 A5:1 | r:4 | r:4 | r:4 | r:2 A5:1 D6:1 |")
    # B'
    pno.phrase(96, "@38 r:4 | r:4 | r:4 | r:1 E5:1 B5:2 | r:4 | r:4 | r:4 | r:4 |")
    # C - the clearing
    pno.phrase(128, "@36 r:1 G4:1 D5:2 | r:4 | r:4 | r:2 F#5:1 E5:1 | r:1 G4:1 D5:2 | r:4 | r:4 | r:4 |")
    pnl.phrase(128, "@30 [G1,D2]:4 | ~:4 | [C2,G2]:4 | ~:4 | [G1,D2]:4 | ~:4 | [C2,G2]:4 | ~:4 |")
    # A'' - an octave lower
    pnl.phrase(160, "@34 " + arp([G, "x", EM, "x", C, "x", DS, D], "0:1 1:1 2:2"), arch=5)
    pno.phrase(160, "@46 r:1 D4:1 A4:2 | G4:1.5 F#4:0.5 D4:2 | r:1 B3:1 F#4:2 | E4:3 r:1 | "
                    "r:1 E4:1 B4:2 | A4:1.5 G4:0.5 F#4:2 | r:1 A4:1 B4:1 D5:1 | E5:2 r:2 |", arch=6)
    # D
    pno.phrase(192, "@44 r:4 | r:4 | r:4 | r:4 | r:1 E5:1 B5:2 | A5:2 F#5:2 | G5:4 | r:4 |")
    # T - back to the top
    pnl.phrase(224, "@32 " + arp([C, "x", G, "x"], "0:1 1:1 2:2"))
    pno.phrase(224, "@38 r:2 F#5:1 E5:1 | D5:4 | r:4 | r:4 |")
    for p in (pno, pnl):
        bar_pedal(p, 1, 60)

    # ------------------------------------------------------------------ harp
    harp.phrase(64, "@46 " + arp([hEM, hC, hGB, hAM, hEM, hC, hDS, hD], "0:1 1:1 2:1 1:1"), arch=6)
    harp.phrase(96, "@44 " + arp([hC, hD, hBM, hEM, hAM, hC, hDS, hD], "0:1 1:1 2:1 1:1"), arch=6)
    harp.phrase(128, "@40 r:4 | r:2 D5:1 A5:1 | r:4 | r:3 B5:1 | r:4 | r:2 D5:1 A5:1 | r:4 | r:2 G5:1 D6:1 |")
    harp.phrase(160, "@38 r:4 | r:4 | r:4 | r:3 B5:1 | r:4 | r:3 F#6:1 | r:4 | r:2 A5:1 E6:1 |")
    harp.phrase(192, "@42 " + arp([hEM, hC, hGB, hAM, hC, hD, hG, "x"], "0:1 1:1 2:2"), arch=4)

    # ------------------------------------------------------------------ strings
    # A' (9-16)
    vc.phrase(32, "G2:4 | D3:4 | C3:4 | A2:4 | E3:4 | C3:4 | D3:4 | D3:4 |")
    vla.phrase(32, "D4:4 | D4:4 | E4:4 | E4:4 | B3:4 | E4:4 | G4:4 | F#4:4 |")
    # B (17-24): 1st violins, augmented fifth-and-climb
    vln1.phrase(64, "E4:2 B4:2 | C5:3 D5:1 | E5:4 | ~:2 D5:1 C5:1 | B4:2 F#5:2 | G5:3 A5:1 | "
                    "B5:2 A5:1 G5:1 | F#5:4 |")
    vln2.phrase(64, "D4:4 | E4:4 | D4:4 | E4:4 | D4:4 | E4:4 | D4:4 | D4:4 |")
    vla.phrase(64, "G3:4 | G3:4 | G3:4 | G3:4 | G3:4 | G3:4 | G3:4 | A3:4 |")
    vc.phrase(64, "B2:4 | B2:4 | D3:4 | C3:4 | E3:4 | B2:4 | A2:4 | A2:4 |")
    cb.phrase(64, "E2:4 | C2:4 | B1:4 | A1:4 | E2:4 | C2:4 | D2:4 | D2:4 |")
    # B' (25-32): celli take the melody, violins a high halo
    vcm.phrase(96, "E4:1.5 D4:0.5 B3:2 | D4:1.5 E4:0.5 F#4:2 | F#4:1 E4:1 D4:2 | B3:4 | "
                   "C4:1.5 D4:0.5 E4:2 | G4:2 F#4:1 E4:1 | A4:2 G4:1 E4:1 | F#4:2 E4:1 D4:1 |")
    vln1p.phrase(96, "E5:4 | F#5:4 | F#5:4 | E5:4 | G5:4 | E5:4 | D5:4 | F#5:4 |")
    vln2.phrase(96, "B4:4 | A4:4 | B4:4 | B4:4 | E5:4 | B4:4 | A4:4 | A4:4 |")
    vla.phrase(96, "B3:4 | F#3:4 | F#3:4 | G3:4 | A3:4 | G3:4 | G3:4 | F#3:4 |")
    cb.phrase(96, "C2:4 | D2:4 | B1:4 | E2:4 | C2:4 | C2:4 | D2:4 | D2:4 |")
    # C (33-40): the clearing
    vln1p.phrase(128, "B5:4 | ~:4 | B5:4 | ~:4 | A5:4 | ~:4 | B5:4 | ~:4 |")
    vla.phrase(128, "D4:4 | ~:4 | E4:4 | ~:4 | B3:4 | ~:4 | E4:4 | ~:4 |")
    cb.phrase(128, "G1:4 | ~:4 | C2:4 | ~:4 | G1:4 | ~:4 | C2:4 | ~:4 |")
    # A'' (41-48)
    cb.phrase(160, "G1:4 | ~:4 | E2:4 | ~:4 | C2:4 | ~:4 | D2:4 | ~:4 |")
    vln2.phrase(160, "B5:4 | ~:4 | B5:4 | ~:4 | B5:4 | ~:4 | A5:4 | ~:4 |")
    # D (49-56)
    vln2f.phrase(192, "B4:2 F#5:2 | E5:4 | D5:2 E5:1 G5:1 | E5:4 |")
    vc.phrase(192, "E3:4 | E3:4 | G2:4 | C3:4 | E3:4 | A2:4 | D3:4 | ~:4 |")
    vla.phrase(192, "G3:4 | G3:4 | G3:4 | G3:4 | G3:4 | F#3:4 | G3:4 | ~:4 |")
    cb.phrase(192, "E2:4 | C2:4 | B1:4 | A1:4 | C2:4 | D2:4 | G1:4 | ~:4 |")

    # dynamics
    vc.dyn((32, "pp"), (40, "p"), (60, "p"), (64, "p"), (84, "mp"), (95, "p"), (160, "pp"), (176, "p"),
           (190, "pp"), (192, "p"), (208, "p"), (222, "pp"), (226, "n"))
    vla.dyn((32, "pp"), (44, "p"), (60, "pp"), (64, "pp"), (80, "p"), (96, "p"), (124, "p"), (128, "pp"),
            (156, "pp"), (160, "n"), (192, "pp"), (204, "p"), (216, "pp"), (226, "n"))
    vln1.dyn((64, "p"), (72, "mp"), (78, "p"), (84, "mp"), (88, "mf"), (94, "mp"), (96, "p"))
    vln1p.dyn((96, "pp"), (108, "p"), (124, "pp"), (128, "ppp"), (144, "pp"), (158, "ppp"), (160, "n"))
    vln2.dyn((64, "pp"), (88, "p"), (96, "pp"), (112, "p"), (126, "pp"), (160, "ppp"), (176, "pp"),
             (190, "ppp"), (192, "n"))
    vln2f.dyn((192, "p"), (200, "mp"), (206, "p"), (208, "pp"))
    vcm.dyn((96, "mp"), (104, "mf"), (108, "mp"), (112, "p"), (116, "mp"), (120, "mf"), (126, "p"))
    cb.dyn((64, "pp"), (80, "p"), (96, "p"), (124, "pp"), (160, "pp"), (192, "p"), (216, "pp"), (226, "n"))
    return c

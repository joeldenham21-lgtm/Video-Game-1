"""MENU - "Thin Air" (main theme). D Dorian, 4/4, rubato around 64-68 BPM, ~2:45, not a loop.

Form
  1-4    Intro: solo piano, the bare rising fifth called twice from far away over open fifths.
  5-12   A1: solo piano states the whole theme (antecedent Dorian B natural, consequent Aeolian Bb).
  13-20  A2: celli sing the theme; violas/2nd violins hold a pianissimo 'halo' high above; the piano
         answers the celli's fifths in the gaps.
  21-28  B: relative major. 1st violins sequence the fifth upward (F-C, Bb-F) over a held F in the
         celli, harp arpeggios, choir 'oohs' swell in, horns join on the A-major dominant; broadening.
  29-36  A3: the climax. Theme in violins (octaves), choir 'aahs' + horns in harmony, cello
         counter-melody in contrary motion, rolling piano, harp, timpani. Ends in D MAJOR (Picardy).
  37-42  Coda: strings dissolve; piano alone. The climb (D A B C) stops one step short of the octave
         and the piece ends on an open D-A-E: the summit is not reached yet.
"""
from score import Cue
from common import THEME_A, THEME_B, bar_pedal, roll


def build() -> Cue:
    c = Cue("menu", bpm=58, meter=4, key="D Dorian", loop=False, bars=42, kind="oneshot",
            title="Thin Air", intensity=0.2, tail_s=7.0, rt60=3.7, predelay_ms=34, wet_db=-3.5,
            fade_out_s=2.0, leveler=dict(threshold_db=-6.0, ratio=1.6, attack_ms=1500.0, release_ms=4000.0),
            qa_ok=["vc/cb at bar 28"])   # celli double the basses for the approach to the climax
    # rubato tempo map
    t = c.tempo
    t.set(15.0, 56, ramp=True)          # the intro breathes out
    t.set(16.0, 64)                      # A1
    t.set(44.0, 64).set(47.9, 57, ramp=True)   # ritenuto into A2
    t.set(48.0, 66)
    t.set(76.0, 66).set(79.9, 60, ramp=True)   # breath before B
    t.set(80.0, 66)
    t.set(104.0, 66).set(111.9, 58, ramp=True)  # allargando into the climax
    t.set(112.0, 68)
    t.set(140.0, 68).set(143.9, 60, ramp=True)
    t.set(144.0, 62)
    t.set(152.0, 60).set(164.0, 46, ramp=True)  # final ritardando

    warm = [("high", 3800, -3.5)]
    pno = c.part("pno", "piano", gain_db=0.0, shelf=warm)
    pnl = c.part("pno_lh", "piano", gain_db=-2.0, pan=-0.05, shelf=warm)
    harp = c.part("harp", "harp", gain_db=-5.5)
    vln1 = c.part("vln1", "vln1_fast", gain_db=0.0)
    vln2 = c.part("vln2", "vln2_fast", gain_db=-1.5, doubles="vln1")
    vln2h = c.part("vln2_halo", "vln2", gain_db=3.0)
    vla = c.part("vla", "vla", gain_db=-2.0)
    vc = c.part("vc", "vc_fast", gain_db=0.0)
    cb = c.part("cb", "cb", gain_db=-3.0)
    ooh = c.part("choir_ooh", "choir_ooh", gain_db=-4.0)
    aah = c.part("choir_aah", "choir_aah", gain_db=-5.5)
    hn = c.part("horns", "horns", gain_db=-5.0)
    timp = c.part("timp", "timpani", gain_db=-13.0)

    # ---------------------------------------------------------------- piano
    # intro (bars 1-4): the fifth, called from far away
    pno.phrase(0, "@38 r:1 D5:1 A5:2 | E5:3 r:1 | r:1 D5:1 A5:2 | G5:2 E5:1 r:1 |")
    pnl.phrase(0, "@32 [D2,A2]:4 | ~:4 | [Bb1,F2]:4 | [C2,G2]:4 |")
    # A1 (bars 5-12): the theme, solo
    pno.phrase(16, "@50 " + THEME_A + THEME_B, arch=9)
    pnl.phrase(16, "@40 D2:1 A2:1 F3:1 A3:1 | B1:1 G2:1 D3:1 G3:1 | C2:1 G2:1 E3:1 G3:1 | "
                   "A1:1 E2:1 C3:1 G3:1 | D2:1 A2:1 F3:1 A3:1 | Bb1:1 F2:1 D3:1 A3:1 | "
                   "G1:1 D2:1 Bb2:1 A3:1 | D2:1 A2:1 E3:1 A3:1 |")
    # A2 (bars 13-20): answers in the gaps of the cello line
    pno.phrase(48, "@40 r:1.5 D5:0.5 A5:2 | r:4 | r:4 | r:1 A4:0.5 E5:0.5 G5:2 | "
                   "r:1.5 D5:0.5 A5:2 | r:3 E6:1@32 | r:4 | r:1 A5:1 D6:1 E6:1 |")
    # B (bars 21-28): tacet, then a rising A-major arpeggio hands over to the climax
    pno.phrase(108, "@46 r:2 A4:0.5 C#5:0.5 E5:0.5 A5:0.5 |")
    # A3 (bars 29-36): rolling left hand (bar 35 is a G9sus colour, no low Bb against the celli)
    pnl.phrase(112, "@54 D2:0.5 A2:0.5 D3:0.5 F3:0.5 A3:0.5 F3:0.5 D3:0.5 A2:0.5 | "
                    "B1:0.5 G2:0.5 D3:0.5 G3:0.5 B3:0.5 G3:0.5 D3:0.5 G2:0.5 | "
                    "C2:0.5 G2:0.5 C3:0.5 E3:0.5 G3:0.5 E3:0.5 C3:0.5 G2:0.5 | "
                    "C2:0.5 G2:0.5 C3:0.5 E3:0.5 A3:0.5 E3:0.5 C3:0.5 G2:0.5 | "
                    "D2:0.5 A2:0.5 D3:0.5 F3:0.5 A3:0.5 F3:0.5 D3:0.5 A2:0.5 | "
                    "Bb1:0.5 F2:0.5 D3:0.5 F3:0.5 A3:0.5 F3:0.5 D3:0.5 F2:0.5 | "
                    "G1:0.5 D2:0.5 G2:0.5 D3:0.5 F3:0.5 A3:0.5 F3:0.5 D3:0.5 | "
                    "D2:0.5 A2:0.5 D3:0.5 F#3:0.5 A3:0.5 F#3:0.5 D3:0.5 A2:0.5 |", arch=10)
    # coda (bars 37-42): alone again; the climb stops short and hangs on D-A-E
    pno.phrase(144, "@36 r:1 D5:1 A5:2 | F#5:3 r:1 | r:1 D4:1 A4:2 | B4:1.5 C5:0.5 r:2 | "
                    "[E5,A5]:4@30 | ~:4 |")
    pnl.phrase(144, "@30 [D2,A2]:4 | ~:4 | [Bb1,F2]:4 | [G1,D2]:4 | [D2,A2]:4@26 | ~:4 |")
    for p in (pno, pnl):
        bar_pedal(p, 1, 40)
        p.pedal(c.bar(41), c.bar(43))

    # ---------------------------------------------------------------- strings
    # A2: celli sing the theme; halo above; basses hold C under the A-minor bar (no octaves)
    vc.phrase(48, THEME_A + THEME_B, transpose=-12)
    vc.dyn((48, "p"), (52, "mp"), (56, "mf"), (60, "p"), (64, "p"), (68, "mp"), (72, "mf"), (76, "mp"),
           (80, "p"))
    vla.phrase(48, "A4:4 | G4:4 | G4:4 | G4:4 | F4:4 | A4:4 | Bb4:4 | A4:4 |")
    vln2h.phrase(48, "E5:4 | B4:4 | E5:4 | C5:4 | E5:4 | D5:4 | D5:4 | E5:4 |")
    vln2h.dyn((48, "pp"), (76, "pp"), (80, "p"), (82, "n"))
    cb.phrase(48, "D2:4 | B1:4 | C2:4 | C2:4 | D2:4 | Bb1:4 | G1:4 | D2:4 |")
    # B: relative major, the fifth sequenced upward in the 1st violins over a held F in the celli
    vln1.phrase(80, "F4:1 C5:3 | D5:1.5 E5:0.5 F5:2 | G5:2 F5:1 D5:1 | E5:4 | "
                    "Bb4:1 F5:3 | G5:1.5 F5:0.5 E5:2 | A5:2 G5:1 F5:1 | E5:2 C#5:2 |")
    vln2.phrase(80, "D4:4 | C4:4 | D4:4 | C4:4 | D4:1 A4:3 | C5:4 | Bb4:4 | A4:4 |")
    vla.phrase(80, "A3:4 | A3:4 | Bb3:4 | G3:4 | A3:4 | E3:4 | F3:4 | D4:2 C#4:2 |")
    vc.phrase(80, "F3:4 | F3:4 | F3:4 | E3:4 | D3:4 | C3:4 | G2:4 | A2:4 |")
    cb.phrase(80, "Bb1:4 | A1:4 | G1:4 | C2:4 | Bb1:4 | A1:4 | G1:4 | A1:4 |")
    # A3: climax - theme in octaves, cello counter-melody in contrary motion
    vln1.phrase(112, THEME_A + THEME_B + " ~:4 | ~:2 r:2 |", transpose=12)
    vln2.phrase(112, THEME_A + THEME_B + " A4:4 | ~:2 r:2 |")
    vla.phrase(112, "A3:4 | D4:4 | G4:4 | E4:4 | A4:4 | A4:4 | D4:4 | D4:4 | ~:4 | ~:2 r:2 |")
    vc.phrase(112, "A3:2 F3:2 | D3:2 B3:2 | E3:2 G3:2 | C3:2 E3:2 | F3:2 A3:2 | D3:2 F3:2 | "
                   "G2:2 D3:2 | F#3:4 | D3:4 | ~:2 r:2 |")
    cb.phrase(112, "D2:4 | B1:4 | C2:4 | C2:4 | D2:4 | Bb1:4 | G1:4 | D2:4 | ~:4 | ~:2 r:2 |")

    vln1.dyn((80, "p"), (84, "mp"), (92, "mf"), (96, "mp"), (104, "mf"), (111, "f"), (112, "f"),
             (128, "f"), (136, "ff"), (140, "f"), (144, "mp"), (148, "pp"), (152, "n"))
    vln2.dyn((80, "p"), (96, "mp"), (111, "mf"), (112, "mf"), (136, "f"),
             (140, "mf"), (144, "p"), (150, "n"))
    vla.dyn((48, "pp"), (78, "pp"), (80, "p"), (100, "mp"), (112, "mf"), (136, "f"), (140, "mf"),
            (144, "p"), (150, "n"))
    vc.dyn((80, "p"), (96, "mp"), (108, "mf"), (112, "mf"), (136, "f"), (144, "mp"), (148, "p"),
           (152, "n"))
    cb.dyn((48, "pp"), (80, "p"), (104, "mp"), (112, "mf"), (136, "f"), (144, "p"), (152, "n"))

    # ---------------------------------------------------------------- choir, horns, harp, timpani
    ooh.phrase(96, "[D4,F4,Bb4]:4 | [C4,E4,G4]:4 | [Bb3,D4,G4]:4 | [A3,D4,E4]:2 [A3,C#4,E4]:2 |")
    ooh.dyn((96, "n"), (100, "p"), (108, "mp"), (111.5, "mf"), (112.5, "p"), (113, "n"))
    aah.phrase(112, "[A3,D4,F4]:4 | [B3,D4,G4]:4 | [C4,E4,G4]:4 | [C4,E4,A4]:4 | [D4,F4,A4]:4 | "
                    "[D4,F4,A4]:4 | [D4,F4,A4]:4 | [D4,F#4,A4]:4 | ~:4 |")
    aah.dyn((112, "mp"), (116, "mf"), (132, "f"), (138, "ff"), (140, "f"), (144, "mp"), (148, "n"))
    hn.phrase(108, "[A3,E4]:4 | [F3,D4]:4 | [G3,D4]:4 | [G3,C4]:4 | "
                   "[A3,C4]:4 | [F3,A3]:4 | [F3,A3]:4 | [F3,A3]:4 | [F#3,A3]:4 | ~:2 r:2 |")
    hn.dyn((108, "p"), (111, "mf"), (112, "mf"), (132, "f"), (140, "mf"), (144, "p"), (146, "n"))

    harp.phrase(80, "@52 Bb2:0.5 F3:0.5 A3:0.5 D4:0.5 F4:2 | A2:0.5 F3:0.5 C4:0.5 E4:0.5 A4:2 | "
                    "G2:0.5 D3:0.5 F3:0.5 Bb3:0.5 D4:2 | C3:0.5 G3:0.5 D4:0.5 E4:0.5 G4:2 | "
                    "F3:0.5 C4:0.5 D4:0.5 F4:0.5 A4:2 | E3:0.5 A3:0.5 C4:0.5 E4:0.5 G4:2 | "
                    "G2:0.5 D3:0.5 F3:0.5 Bb3:0.5 A4:2 | A2:0.5 E3:0.5 A3:0.5 C#4:0.5 E4:2 |")
    harp.phrase(112, "@60 {D4,A4,D5,F5}:2 {A4,D5,E5,A5}:2 | {G4,B4,D5,G5}:2 {B4,D5,G5,B5}:2 | "
                     "{G4,C5,E5,G5}:2 {C5,E5,G5,C6}:2 | {E4,A4,C5,E5}:2 {G4,C5,E5,A5}:2 | "
                     "{D4,A4,D5,F5}:2 {F4,A4,D5,A5}:2 | {D4,F4,A4,D5}:2 {F4,A4,D5,F5}:2 | "
                     "{D4,G4,A4,D5}:2 {F4,A4,C5,F5}:2 | {D4,F#4,A4,D5}:4 |")

    roll(timp, "A2", 109.0, 3.0, 26, 70)
    timp.note("D2", 112, 2, 74)
    timp.note("D2", 128, 2, 54)
    roll(timp, "G2", 138.0, 2.0, 36, 84)
    timp.note("D2", 140, 4, 90)
    return c

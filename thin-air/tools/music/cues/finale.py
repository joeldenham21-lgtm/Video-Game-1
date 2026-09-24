"""FINALE - rescue at dawn / credits. D major, 4/4, 66-72 BPM, 48 bars, ~2:55, not a loop.

The theme, finally resolved: its Dorian B natural and Aeolian Bb become D major's B and C#, and the
climb reaches the octave.

  1-8    A    solo piano: the theme in D major (D-A, B-C#-D, E-D-C#, A | D-A, B-C#-D-E, F#-E-D-C#, D)
  9-16   A'   1st violins take it an octave higher; celli answer in contrary motion; harp; piano
  17-24  B    'homecoming': celli sing a falling fifth (D-G) and climb back up; horns join them;
              violins hold a high halo; the piano answers in the gaps
  25-32  A''  warm tutti (no bombast): violins in octaves, choir 'oohs', horn counter-line, harp,
              soft timpani, full IV-V-I cadence
  33-40  C    bridge: the fifth sequenced upward in the violins (G-D, D-A), flute doubling
  41-44       a solo violin sings the consequent over the piano (G with the Lydian C# at bar 42)
  45-48       the piano alone completes the ascent D-A-B-C#-D over G(#11) -> D. Dawn.
"""
from score import Cue
from synth import Glass
from common import THEME_B_MAJOR, bar_pedal, roll

THEME_A_MAJOR = "D4:1 A4:3 | B4:1.5 C#5:0.5 D5:2 | E5:2 D5:1 C#5:1 | A4:4 |"
LH_A = ("D2:1 A2:1 F#3:1 A3:1 | B1:1 F#2:1 D3:1 A3:1 | A1:1 E2:1 A2:1 E3:1 | F#2:1 C#3:1 E3:1 A3:1 | "
        "G1:1 D2:1 D3:1 F#3:1 | E2:1 B2:1 D3:1 G3:1 | B1:1 F#2:1 A1:1 E2:1 | D2:1 A2:1 F#3:1 A3:1 |")
HARP = {"D": "D3 A3 D4 F#4 A4 D5 F#5 A5", "Bm7": "F#3 B3 D4 F#4 A4 D5 F#5 A5",
        "A": "E3 A3 C#4 E4 A4 C#5 E5 A5", "F#m7": "F#2 C#3 A3 E4 A4 C#5 E5 A5",
        "Gmaj7": "D3 G3 B3 F#4 B4 D5 F#5 B5", "Em7": "E3 B3 D4 G4 B4 D5 G5 B5",
        "G": "G2 D3 G3 B3 D4 G4 B4 D5", "D/F#": "F#2 D3 A3 D4 F#4 A4 D5 F#5",
        "Bm": "F#3 B3 D4 F#4 B4 D5 F#5 B5"}


def _eighths(spec: str) -> str:
    return " ".join(f"{p}:0.5" for p in spec.split()) + " |"


def build() -> Cue:
    c = Cue("finale", bpm=66, meter=4, key="D major", loop=False, bars=48, kind="oneshot",
            title="Dawn over the Aldous Range", intensity=0.5, tail_s=9.0, rt60=3.8, predelay_ms=34,
            wet_db=-3.5, fade_out_s=3.0, ir_seed=41, ir_brightness=0.55,
            leveler=dict(threshold_db=-6.0, ratio=1.5, attack_ms=1500.0, release_ms=4000.0))
    t = c.tempo
    t.set(28.0, 66).set(31.9, 62, ramp=True)
    t.set(32.0, 70)
    t.set(96.0, 72)
    t.set(156.0, 72).set(159.9, 64, ramp=True)
    t.set(160.0, 66)
    t.set(176.0, 64).set(188.0, 50, ramp=True)

    warm = [("high", 4000, -3.0)]
    pno = c.part("pno", "piano", gain_db=0.0, shelf=warm)
    pnl = c.part("pno_lh", "piano", gain_db=-2.5, pan=-0.06, shelf=warm)
    harp = c.part("harp", "harp", gain_db=-4.0)
    v1 = c.part("vln1", "vln1_fast", gain_db=0.0)
    v2 = c.part("vln2", "vln2_fast", gain_db=-1.5, doubles=[("vln1", 96, 128)])
    v1p = c.part("vln1_pad", "vln1", gain_db=-3.0)
    v2p = c.part("vln2_pad", "vln2", gain_db=-3.0)
    vla = c.part("vla", "vla", gain_db=-3.0)
    vc = c.part("vc", "vc_fast", gain_db=0.0)
    cb = c.part("cb", "cb", gain_db=-3.0)
    hn = c.part("horns", "horns", gain_db=-3.0, doubles=[("vc", 80, 96)])
    fl = c.part("flute", "flute", gain_db=-4.0, doubles="vln1")
    ch = c.part("choir", "choir_ooh", gain_db=-4.0)
    vs = c.part("vln_solo", "vln_solo", gain_db=0.0, lp=9000, shelf=[("high", 4000, -2.5)])
    cel = c.part("celesta", "celesta", gain_db=-4.0, send=0.7)
    timp = c.part("timp", "timpani", gain_db=-9.0)

    # ================================================================ A (1-8): solo piano
    pno.phrase(0, "@52 " + THEME_A_MAJOR + THEME_B_MAJOR, arch=9)
    pnl.phrase(0, "@40 " + LH_A)
    # ================================================================ A' (9-16)
    v1.phrase(32, THEME_A_MAJOR + THEME_B_MAJOR, transpose=12)
    pnl.phrase(32, "@36 " + LH_A)
    vc.phrase(32, "F#3:4 | D3:2 F#3:2 | C#3:2 E3:2 | E3:4 | G3:2 B3:2 | E3:2 G3:2 | D4:2 C#4:2 | A3:4 |")
    v2p.phrase(32, "F#4:4 | F#4:4 | A4:4 | A4:4 | B4:4 | B4:4 | B4:2 C#5:2 | F#4:4 |")
    cb.phrase(32, "D2:4 | B1:4 | A1:4 | F#1:4 | G1:4 | E2:4 | B1:2 A1:2 | D2:4 |")
    harp.phrase(32, "@48 " + " ".join(_eighths(HARP[h]) for h in
                                      ("D", "Bm7", "A", "F#m7", "Gmaj7", "Em7", "Bm7", "D")), arch=6)
    # ================================================================ B (17-24): homecoming
    vc.phrase(64, "D4:1 G3:3 | A3:1.5 B3:0.5 A3:2 | G3:1 B3:1 E4:2 | C#4:3 r:1 | D4:1 G3:3 | "
                  "F#3:1.5 G3:0.5 A3:2 | B3:1 E4:1 G4:1 F#4:1 | E4:4 |")
    hn.phrase(80, "D4:1 G3:3 | F#3:1.5 G3:0.5 A3:2 | B3:1 E4:1 G4:1 F#4:1 | E4:4 |")
    v1p.phrase(64, "D5:4 | D5:4 | E5:4 | E5:4 | G5:4 | D5:4 | G5:4 | E5:4 |")
    v2p.phrase(64, "B4:4 | A4:4 | B4:4 | A4:4 | B4:4 | A4:4 | G4:4 | A4:4 |")
    cb.phrase(64, "G1:4 | F#1:4 | E2:4 | A1:4 | G1:4 | A1:4 | E2:4 | A1:4 |")
    pnl.phrase(64, "@34 [G2,D3]:4 | [F#2,D3]:4 | [E2,B2]:4 | [A2,E3]:4 | [G2,D3]:4 | [A1,D2]:4 | "
                   "[E2,B2]:4 | [A2,E3]:4 |")
    pno.phrase(64, "@40 r:4 | r:2 D6:1 A5:1 | r:4 | r:1 E5:1 A5:1 C#6:1 | r:4 | r:2 A5:1 F#5:1 | r:4 | "
                   "r:1 C#5:1 E5:1 A5:1 |")
    # ================================================================ A'' (25-32): warm tutti
    v1.phrase(96, THEME_A_MAJOR + THEME_B_MAJOR, transpose=12)
    v2.phrase(96, THEME_A_MAJOR + THEME_B_MAJOR)
    ch.phrase(96, "[A3,D4,F#4]:4 | [B3,D4,F#4]:4 | [A3,E4,A4]:4 | [A3,C#4,E4]:4 | [B3,D4,G4]:4 | "
                  "[B3,D4,G4]:4 | [B3,D4,F#4]:2 [A3,E4,A4]:2 | [A3,D4,F#4]:4 |")
    hn.phrase(96, "A3:4 | D4:4 | A3:4 | E4:4 | D4:4 | D4:4 | D4:4 | D4:4 |")
    vla.phrase(96, "D4:4 | D4:4 | C#4:4 | C#4:4 | B3:4 | B3:4 | D4:2 E4:2 | F#4:4 |")
    vc.phrase(96, "F#3:4 | D3:4 | A3:4 | A3:4 | B3:4 | G3:4 | D3:2 C#3:2 | A2:4 |")
    cb.phrase(96, "D2:4 | B1:4 | A1:4 | F#1:4 | G1:4 | E2:4 | B1:2 A1:2 | D2:4 |")
    pnl.phrase(96, "@46 " + " ".join(_eighths(x) for x in (
        "D2 A2 D3 F#3 A3 F#3 D3 A2", "B1 F#2 D3 F#3 B3 F#3 D3 F#2", "A1 E2 A2 E3 A3 E3 A2 E2",
        "F#1 C#2 F#2 C#3 E3 C#3 F#2 C#2", "G1 D2 G2 D3 F#3 D3 G2 D2", "E2 B2 E3 G3 B3 G3 E3 B2",
        "B1 F#2 D3 F#3 A1 E2 E3 A3", "D2 A2 D3 F#3 A3 F#3 D3 A2")), arch=8)
    harp.phrase(96, "@56 {D4,F#4,A4,D5}:2 {A4,D5,F#5,A5}:2 | {B3,D4,F#4,B4}:2 {F#4,B4,D5,F#5}:2 | "
                    "{A3,E4,A4,C#5}:2 {C#4,E4,A4,E5}:2 | {A3,C#4,F#4,A4}:2 {C#4,F#4,A4,C#5}:2 | "
                    "{B3,D4,G4,B4}:2 {D4,G4,B4,D5}:2 | {B3,E4,G4,B4}:2 {E4,G4,B4,E5}:2 | "
                    "{B3,D4,F#4,B4}:2 {A3,C#4,E4,A4}:2 | {D4,F#4,A4,D5}:4 |")
    roll(timp, "A2", 92.0, 4.0, 22, 60)
    timp.note("D2", 96, 2, 64)
    roll(timp, "A2", 124.0, 4.0, 26, 66)
    timp.note("D2", 128, 3, 70)
    # ================================================================ C (33-40): bridge
    v1.phrase(128, "G4:1 D5:3 | E5:1.5 F#5:0.5 A5:2 | B5:2 A5:1 G5:1 | E5:4 | D5:1 A5:3 | "
                   "B5:1.5 C#6:0.5 D6:2 | E6:2 D6:1 B5:1 | A5:2 G5:1 E5:1 |")
    fl.phrase(144, "D5:1 A5:3 | B5:1.5 C#6:0.5 D6:2 | E6:2 D6:1 B5:1 | A5:2 G5:1 E5:1 |")
    v2p.phrase(128, "B4:4 | A4:4 | G4:4 | A4:4 | D5:4 | D5:4 | D5:4 | C#5:4 |")
    vla.phrase(128, "D4:4 | D4:4 | B3:4 | C#4:4 | D4:4 | D4:4 | B3:4 | C#4:4 |")
    vc.phrase(128, "G3:4 | F#3:4 | E3:4 | E3:4 | G3:4 | D3:4 | G3:4 | A3:4 |")
    cb.phrase(128, "B1:4 | F#1:4 | E2:4 | A1:4 | B1:4 | B1:4 | E2:4 | A1:4 |")
    harp.phrase(128, "@50 " + " ".join(_eighths(HARP[h]) for h in
                                       ("G", "D/F#", "Em7", "A", "G", "Bm", "Em7", "A")), arch=6)
    # ================================================================ 41-48: the ending
    vs.phrase(160, THEME_B_MAJOR, transpose=12)
    pnl.phrase(160, "@34 [D2,A2]:4 | [G1,D2]:4 | [B1,F#2]:4 | [D2,A2]:4 | [D2,A2]:4 | [G1,D2]:4 | "
                    "[D2,A2]:4 | ~:4 |")
    pno.phrase(160, "@36 [F#4,A4]:4 | [G4,B4]:4 | [F#4,A4]:4 | [F#4,A4]:4 | "
                    "r:1 D5:1 A5:2 | B5:1.5 C#6:0.5 D6:2 | [F#5,A5,D6]:4@34 | ~:4 |")
    v1p.phrase(160, "A5:4 | G5:4 | F#5:4 | F#5:4 | A5:4 | B5:4 | A5:4 | ~:4 |")
    vla.phrase(160, "D4:4 | D4:4 | D4:4 | D4:4 | F#4:4 | G4:4 | F#4:4 | ~:4 |")
    cb.phrase(160, "D2:4 | G1:4 | B1:4 | D2:4 | D2:4 | G1:4 | D2:4 | ~:4 |")
    cel.phrase(184, "@34 r:1 A6:1 D7:2 |")
    c.add(Glass("dawn", notes=[("A6", 176, 12, -10), ("F#6", 180, 10, -12), ("D7", 184, 8, -13)],
                attack=2.5, release=6.0, gain_db=-9.0, send=0.8, dry_db=-4.0, hp=700))
    for p in (pno, pnl):
        bar_pedal(p, 1, 6)
        p.pedal_changes([24.0, 26.0], 28.0)
        bar_pedal(p, 8, 30)
        p.pedal_changes([120.0, 122.0], 124.0)
        bar_pedal(p, 32, 46)
        p.pedal(184.0, 196.0)

    # ================================================================ dynamics
    v1.dyn((32, "mp"), (40, "mf"), (48, "mp"), (56, "mf"), (60, "mp"), (63, "p"), (96, "f"), (112, "f"),
           (120, "ff"), (126, "f"), (128, "mf"), (136, "mf"), (144, "f"), (152, "mf"), (158, "mp"))
    v2.dyn((96, "mf"), (120, "f"), (126, "mf"), (128, "n"))
    fl.dyn((144, "mp"), (152, "mf"), (158, "mp"))
    vc.dyn((32, "mp"), (48, "mf"), (60, "mp"), (64, "mf"), (72, "f"), (78, "mf"), (80, "mf"), (88, "f"),
           (94, "mf"), (96, "mf"), (120, "f"), (128, "mp"), (152, "mf"), (158, "p"), (160, "n"))
    hn.dyn((80, "mp"), (88, "mf"), (94, "mp"), (96, "mf"), (120, "f"), (126, "mf"), (128, "n"))
    v1p.dyn((64, "p"), (80, "mp"), (94, "p"), (96, "n"), (158, "n"), (160, "pp"), (176, "p"), (188, "pp"),
            (191.5, "n"))
    v2p.dyn((32, "p"), (48, "mp"), (62, "p"), (64, "p"), (80, "mp"), (95, "p"), (96, "n"), (126, "n"),
            (128, "p"), (144, "mp"), (158, "p"), (160, "n"))
    vla.dyn((96, "mf"), (120, "f"), (126, "mf"), (128, "p"), (144, "mp"), (158, "p"), (160, "pp"),
            (176, "p"), (188, "pp"), (191.5, "n"))
    cb.dyn((32, "p"), (64, "p"), (80, "mp"), (96, "mf"), (120, "f"), (128, "mp"), (158, "p"), (160, "pp"),
           (188, "pp"), (191.5, "n"))     # the strings dissolve under the piano's last chord
    ch.dyn((96, "mp"), (108, "mf"), (120, "f"), (126, "mf"), (128, "n"))
    vs.dyn((160, "mp"), (166, "mf"), (170, "mp"), (175, "p"))
    return c

"""SUMMIT - the climax. D minor -> E major, 4/4, 66 -> 72 BPM, 38 bars, ~2:25, not a loop.

The last climb in the storm, the relay, the sky breaking open.

  1-8    BUILD 1 (D pedal, wind): celli spiccato on the fifth D-A-D-A, timpani heartbeat, choir hum
         Dm - Bb/D - C/D - Dm; the horns call rising fifths: D-A, F-C, G-D, A-E (the ascent)
  9-16   BUILD 2: horns state the theme (Dorian antecedent, Aeolian consequent), tremolo violins
         climb A-B-C-C-D-D-E-F#, choir 'aahs', trombones, harp; C -> Bsus4-B pivot, timpani roll and
         cymbal swell; the wind is cut off -
  17-24  BREAKTHROUGH, E major: the theme in major (with the Lydian #11) in three octaves - horns
         (low unison), 2nd violins, 1st violins - SATB choir chorale, harp, timpani, crash
  25-32  second statement an octave higher (violins + trumpet), horns climb E-F#-G#-A-B in long
         notes against it; allargando to a high E (bar 32)
  33-38  RELEASE: sunrise. Strings and choir pianissimo; the piano finally completes the ascent
         alone (E-B, C#-D#-E); glass shimmer
"""
from score import Cue
from synth import Cymbal, Glass, NoiseSwell, Pluck
from common import roll

# statement chorale (checked for parallels by the QA pass)
S1_CHOIR = ("[E3,B3,E4,G#4]:4 | [C#3,A3,E4,A4]:4 | [D#3,F#3,F#4,A4]:4 | [E3,G#3,E4,G#4]:4 | "
            "[C#3,G#3,E4,B4]:4 | [A2,A3,E4,B4]:4 | [B2,F#3,E4,B4]:2 [B2,F#3,D#4,B4]:2 | [E3,G#3,E4,B4]:4 |")
S2_CHOIR = ("[C#3,G#3,E4,C#5]:4 | [A2,A3,E4,C#5]:4 | [G#2,B3,E4,B4]:4 | [F#2,A3,E4,C#5]:4 | "
            "[C#3,G#3,E4,C#5]:4 | [A2,A3,E4,C#5]:4 | [B2,F#3,E4,B4]:2 [B2,F#3,D#4,B4]:2 | [E3,G#3,E4,B4]:4 |")
MEL1 = ("E4:1 B4:3 | C#5:1.5 D#5:0.5 E5:2 | F#5:2 E5:1 D#5:1 | B4:4 | E4:1 B4:3 | "
        "C#5:1.5 D#5:0.5 E5:1 F#5:1 | G#5:2.5 F#5:0.5 E5:0.5 D#5:0.5 | E5:4 |")
MEL2 = ("E5:1 B5:3 | C#6:1.5 D#6:0.5 E6:2 | F#6:2 E6:1 B5:1 | A5:1.5 B5:0.5 C#6:2 | E5:1 B5:3 | "
        "C#6:1.5 D#6:0.5 E6:1 F#6:1 | G#6:2.5 F#6:0.5 E6:0.5 D#6:0.5 | E6:4 |")
HARP_S = {
    "E": "E3 B3 E4 G#4 B4 E5 G#5 B5", "A/C#": "C#3 A3 E4 A4 C#5 E5 A5 C#6",
    "B/D#": "D#3 B3 F#4 B4 D#5 F#5 B5 D#6", "C#m7": "C#3 G#3 E4 G#4 B4 E5 G#5 B5",
    "A9": "A2 E3 A3 C#4 E4 B4 C#5 E5", "Bsus": "B2 F#3 B3 E4 F#4 B4 D#5 F#5",
    "C#m": "C#3 G#3 C#4 E4 G#4 C#5 E5 G#5", "A": "A2 E3 A3 C#4 E4 A4 C#5 E5",
    "E/G#": "G#2 E3 B3 E4 G#4 B4 E5 G#5", "F#m7": "F#2 C#3 A3 E4 A4 C#5 E5 A5",
    "Dm": "D3 A3 D4 F4 A4 D5 F5 A5", "Bb": "Bb2 F3 D4 F4 A4 D5 F5 A5",
    "C": "C3 G3 C4 E4 G4 C5 E5 G5", "B": "B2 F#3 B3 D#4 F#4 B4 D#5 F#5",
}
OST = {"Dm": "D3 A3 D4 A3", "G/B": "B2 G3 D4 G3", "C": "C3 G3 C4 G3", "Am": "A2 E3 A3 E3",
       "Bb": "Bb2 F3 Bb3 F3", "Bsus": "B2 F#3 B3 F#3"}


def _eighths(spec: str) -> str:
    return " ".join(f"{p}:0.5" for p in spec.split()) + " |"


def build() -> Cue:
    c = Cue("summit", bpm=66, meter=4, key="D minor -> E major", loop=False, bars=38, kind="oneshot",
            title="The Summit", intensity=1.0, tail_s=8.0, qa_ok=["choir/horns at bar 16 beat 3"], rt60=3.6, predelay_ms=30, wet_db=-4.0,
            fade_out_s=2.5, ir_seed=37, leveler=dict(threshold_db=-8.0, ratio=1.8, attack_ms=1500.0, release_ms=4000.0),
            comp=dict(threshold_db=2.0, ratio=2.0, attack_ms=30.0,
                                                  release_ms=400.0))
    t = c.tempo
    t.set(48.0, 66).set(63.9, 70, ramp=True)
    t.set(64.0, 72)
    t.set(116.0, 72).set(123.9, 62, ramp=True)
    t.set(124.0, 60)
    t.set(128.0, 58)

    vcs = c.part("vc_spicc", "vc_spicc", gain_db=2.0, qa_voice=False)   # the ostinato drives the build
    vc = c.part("vc", "vc", gain_db=-1.0, doubles=[("cb", 64, 160), ("tuba", 64, 130), ("trombones", 64, 130)])
    cb = c.part("cb", "cb", gain_db=-2.0)
    vla = c.part("vla", "vla", gain_db=-3.0)
    vlat = c.part("vla_trem", "vla_trem", gain_db=-4.0, qa_voice=False)
    v1t = c.part("vln1_trem", "vln1_trem", gain_db=-3.0)
    v2t = c.part("vln2_trem", "vln2_trem", gain_db=-4.0)
    v1 = c.part("vln1", "vln1_fast", gain_db=0.0)
    v2 = c.part("vln2", "vln2_fast", gain_db=-1.0, doubles="vln1")
    v1p = c.part("vln1_pad", "vln1", gain_db=-4.0)
    ooh = c.part("choir_ooh", "choir_ooh", gain_db=-5.0)
    aah = c.part("choir", "choir_aah", gain_db=-3.0)
    hn = c.part("horns", "horns", gain_db=0.0, doubles=[("vln1", 64, 96), ("vln2", 64, 96)])
    tpt = c.part("trumpet", "trumpet", gain_db=-5.0, doubles=[("vln2", 96, 128), ("vln1", 96, 128)])
    tbn = c.part("trombones", "trombones", gain_db=-3.0, doubles=[("cb", 48, 130), ("tuba", 48, 130)])
    tuba = c.part("tuba", "tuba", gain_db=-5.0, doubles="cb")
    harp = c.part("harp", "harp", gain_db=-3.0)
    pno = c.part("piano", "piano", gain_db=-3.0, qa_voice=False)
    pnr = c.part("piano_rh", "piano", gain_db=0.0, shelf=[("high", 4200, -2.5)])
    timp = c.part("timp", "timpani", gain_db=-8.0)       # heartbeat under the horns, not over them

    # ================================================================= BUILD 1 (1-8)
    for bar in range(8):
        vcs.phrase(bar * 4, _eighths("D3 A3 D4 A3 D3 A3 D4 A3"), vel=58 + bar * 3)
        timp.phrase(bar * 4, f"@{40 + bar * 3} D2:2 D2:2 |")
    cb.phrase(0, "D2:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    ooh.phrase(0, "[D4,F4,A4]:4 | ~:4 | [D4,F4,Bb4]:4 | ~:4 | [E4,G4,C5]:4 | ~:4 | [F4,A4,D5]:4 | ~:4 |")
    hn.phrase(0, "r:4 | D3:1 A3:3 | r:4 | F3:1 C4:3 | r:4 | G3:1 D4:3 | r:4 | A3:1 E4:3 |")
    # ================================================================= BUILD 2 (9-16)
    chords2 = ["Dm", "G/B", "C", "Am", "Dm", "Bb", "C", "Bsus"]
    for k, ch in enumerate(chords2):
        vcs.phrase(32 + k * 4, _eighths(OST[ch] + " " + OST[ch]), vel=70 + k * 3)
    hn.phrase(32, "D4:1 A4:3 | B4:1.5 C5:0.5 D5:2 | E5:2 D5:1 C5:1 | A4:4 | "
                  "D4:1 A4:3 | Bb4:1.5 C5:0.5 D5:1 E5:1 | F5:2 E5:1 D5:1 | E5:2 D#5:2 |")
    v1t.phrase(32, "A4:4 | D5:4 | C5:4 | C5:4 | F5:4 | F5:4 | E5:4 | F#5:4 |")
    v2t.phrase(32, "F4:4 | G4:4 | G4:4 | A4:4 | A4:4 | D4:4 | G4:4 | B4:4 |")
    vla.phrase(32, "D4:4 | D4:4 | G4:4 | G4:4 | F4:4 | F4:4 | F4:4 | D#4:4 |")
    cb.phrase(32, "D2:4 | B1:4 | C2:4 | C2:4 | D2:4 | Bb1:4 | C2:4 | B1:4 |")
    tuba.phrase(48, "D2:4 | Bb1:4 | C2:4 | B1:4 |")
    tbn.phrase(48, "[F3,A3]:4 | [F3,A3]:4 | [C3,E3]:4 | [B2,F#3]:4 |")
    aah.phrase(48, "[D4,F4,A4]:4 | [D4,F4,A4]:4 | [E4,G4,C5]:4 | [F#4,B4,E5]:2 [F#4,B4,D#5]:2 |")
    harp.phrase(48, "@62 " + " ".join(_eighths(HARP_S[h]) for h in ("Dm", "Bb", "C", "B")))
    pno.phrase(48, "@78 [D1,D2]:4 | [Bb0,Bb1]:4 | [C1,C2]:4 | [B0,B1]:4 |")
    timp.note("D2", 32, 2, 72)
    timp.note("D2", 48, 2, 82)
    roll(timp, "B2", 56.0, 8.0, 40, 112)
    # ================================================================= STATEMENT 1 (17-24) E major
    s1 = ["E", "A/C#", "B/D#", "E", "C#m7", "A9", "Bsus", "E"]
    hn.phrase(64, MEL1, transpose=-12)
    v2.phrase(64, MEL1)
    v1.phrase(64, MEL1, transpose=12)
    aah.phrase(64, S1_CHOIR)
    tbn.phrase(64, "[E3,G#3]:4 | [C#3,A3]:4 | [D#3,F#3]:4 | [E3,G#3]:4 | [C#3,G#3]:4 | [A2,A3]:4 | "
                   "[B2,F#3]:4 | [E3,G#3]:4 |")
    cb.phrase(64, "E2:4 | C#2:4 | D#2:4 | E2:4 | C#2:4 | A1:4 | B1:4 | E2:4 |")
    tuba.phrase(64, "E2:4 | C#2:4 | D#2:4 | E2:4 | C#2:4 | A1:4 | B1:4 | E2:4 |")
    vc.phrase(64, "E3:2 G#3:2 | C#3:2 E3:2 | D#3:2 F#3:2 | E3:2 B2:2 | C#3:2 E3:2 | A2:2 E3:2 | "
                  "B2:2 F#3:2 | E3:4 |")
    vlat.phrase(64, "E4:4 | ~:4 | F#4:4 | E4:4 | ~:4 | ~:4 | ~:2 D#4:2 | E4:4 |")
    harp.phrase(64, "@70 " + " ".join(_eighths(HARP_S[h]) for h in s1))
    pno.phrase(64, "@84 [E1,E2]:4 | [C#1,C#2]:4 | [D#1,D#2]:4 | [E1,E2]:4 | [C#1,C#2]:4 | [A0,A1]:4 | "
                   "[B0,B1]:4 | [E1,E2]:4 |")
    timp.note("E2", 64, 2, 110)
    timp.note("B2", 72, 2, 92)
    timp.note("E2", 80, 2, 100)
    roll(timp, "B2", 90.0, 6.0, 50, 104)
    # ================================================================= STATEMENT 2 (25-32)
    s2 = ["C#m", "A", "E/G#", "F#m7", "C#m", "A", "Bsus", "E"]
    v1.phrase(96, MEL2)
    v2.phrase(96, MEL2, transpose=-12)
    tpt.phrase(96, MEL2, transpose=-12)
    hn.phrase(96, "E4:4 | E4:4 | E4:4 | E4:3 F#4:1 | G#4:4 | A4:4 | A4:2 B4:2 | G#4:4 |")
    aah.phrase(96, S2_CHOIR + " ~:4 |")
    tbn.phrase(96, "[C#3,G#3]:4 | [A2,A3]:4 | [G#2,B3]:4 | [F#2,A3]:4 | [C#3,G#3]:4 | [A2,A3]:4 | "
                   "[B2,F#3]:4 | [E3,G#3]:4 | ~:2 r:2 |")
    cb.phrase(96, "C#2:4 | A1:4 | G#1:4 | F#1:4 | C#2:4 | A1:4 | B1:4 | E2:4 |")
    tuba.phrase(96, "C#2:4 | A1:4 | G#1:4 | F#1:4 | C#2:4 | A1:4 | B1:4 | E2:4 | ~:2 r:2 |")
    vc.phrase(96, "C#3:2 G#3:2 | A2:2 E3:2 | G#2:2 E3:2 | F#2:2 C#3:2 | C#3:2 G#3:2 | A2:2 E3:2 | "
                  "B2:2 F#3:2 | E3:4 |")
    vlat.phrase(96, "E4:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:2 D#4:2 | E4:4 |")
    harp.phrase(96, "@74 " + " ".join(_eighths(HARP_S[h]) for h in s2))
    pno.phrase(96, "@90 [C#1,C#2]:4 | [A0,A1]:4 | [G#1,G#2]:4 | [F#1,F#2]:4 | [C#1,C#2]:4 | [A0,A1]:4 | "
                   "[B0,B1]:4 | [E1,E2]:4 |")
    timp.note("C#3", 96, 2, 100)
    timp.note("B2", 104, 2, 92)
    timp.note("C#3", 112, 2, 104)
    roll(timp, "B2", 116.0, 8.0, 56, 118)
    timp.note("E2", 124, 4, 122)
    # ================================================================= RELEASE (33-38)
    v1p.phrase(128, "G#5:4 | ~:4 | A5:4 | G#5:4 | ~:4 | ~:2 r:2 |")
    v2t.phrase(128, "E5:4 | ~:4 | E5:4 | E5:4 | ~:4 | ~:2 r:2 |")
    vla.phrase(128, "B4:4 | ~:4 | C#5:4 | B4:4 | ~:4 | ~:2 r:2 |")
    vc.phrase(128, "E3:4 | ~:4 | A2:4 | E3:4 | ~:4 | ~:2 r:2 |")
    cb.phrase(128, "E2:4 | ~:4 | A1:4 | E2:4 | ~:4 | ~:2 r:2 |")
    ooh.phrase(128, "[E4,G#4,B4]:4 | ~:4 | [E4,A4,B4]:4 | [E4,G#4,B4]:4 | ~:4 | ~:2 r:2 |")
    pnr.phrase(128, "@54 r:1 E5:1 B5:2 | F#5:3 r:1 | r:1 E5:1 B5:2 | C#6:1.5 D#6:0.5 E6:2 | ~:4 | ~:4 |")
    pno.phrase(128, "@46 [E2,B2]:4 | ~:4 | [A2,E3]:4 | [E2,B2]:4 | ~:4 | ~:4 |")
    for p in (pno, pnr):
        p.pedal(128, 136)
        p.pedal(136, 140)
        p.pedal(140, 156)
    harp.phrase(140, "@44 " + _eighths(HARP_S["E"]))
    c.add(Glass("sunrise", notes=[("E6", 128, 14, -9), ("B6", 132, 14, -11), ("G#6", 138, 12, -12)],
                attack=3.0, release=6.0, gain_db=-8.0, send=0.8, dry_db=-4.0, hp=700))
    c.add(NoiseSwell("wind", bands=[
        (380, 1.4, [(0, -48), (16, -40), (48, -32), (62, -27), (63.5, -30), (64, -70), (132, -70),
                    (138, -52), (156, -52)]),
        (1100, 2.0, [(0, -52), (16, -44), (48, -35), (62, -30), (63.5, -33), (64, -72), (132, -72),
                     (138, -56), (156, -56)]),
        (3200, 2.6, [(0, -56), (32, -48), (62, -36), (63.5, -40), (64, -76), (156, -76)])],
        gain_db=-2.0, send=0.35, hp=100))
    c.add(Cymbal("cymbal", swells=[(56.0, 64.0, -8.0), (116.0, 124.0, -7.0)], crashes=[(96.0, -12.0)],
                 gain_db=-8.0, send=0.5, hp=300))
    pl = []
    for bar in range(16):
        spec = "D3 A3 D4 A3" if bar < 8 else OST[chords2[bar - 8]]
        for k, p in enumerate((spec + " " + spec).split()):
            pl.append((p, bar * 4 + k * 0.5, 0.3, -12 + bar * 0.4 + (2 if k % 4 == 0 else 0)))
    c.add(Pluck("pluck", notes=pl, decay=0.12, cutoff=900, sub=0.4, gain_db=-8.0, send=0.25, hp=40))

    # ================================================================= dynamics
    ooh.dyn((0, "p"), (16, "mp"), (30, "mf"), (32, "n"), (126, "n"), (128, "mp"), (140, "p"), (150, "n"))
    hn.dyn((4, "mp"), (12, "mp"), (20, "mf"), (28, "mf"), (32, "mf"), (44, "f"), (56, "f"), (63, "ff"),
           (64, "ff"), (92, "ff"), (96, "f"), (112, "ff"), (124, "fff"), (127, "f"), (128, "n"))
    v1t.dyn((32, "mp"), (48, "mf"), (60, "f"), (63.5, "ff"), (64, "n"))
    v2t.dyn((32, "mp"), (48, "mf"), (60, "f"), (63.5, "ff"), (64, "n"), (126, "n"), (128, "p"),
            (140, "p"), (150, "n"))
    vla.dyn((32, "mp"), (48, "mf"), (63, "f"), (64, "n"), (126, "n"), (128, "p"), (140, "mp"), (150, "n"))
    vlat.dyn((64, "f"), (92, "f"), (96, "ff"), (124, "fff"), (127, "f"), (128, "n"))
    v1.dyn((64, "ff"), (92, "f"), (96, "ff"), (116, "ff"), (124, "fff"), (127, "f"), (128, "n"))
    v2.dyn((64, "ff"), (92, "f"), (96, "ff"), (124, "fff"), (127, "f"), (128, "n"))
    v1p.dyn((128, "p"), (136, "mp"), (144, "p"), (150, "n"))
    tpt.dyn((96, "f"), (116, "ff"), (124, "ff"), (127, "mf"), (128, "n"))
    aah.dyn((48, "mp"), (56, "f"), (63, "ff"), (64, "ff"), (92, "f"), (96, "ff"), (124, "fff"),
            (130, "mf"), (132, "n"))
    tbn.dyn((48, "mf"), (60, "f"), (64, "f"), (92, "f"), (96, "ff"), (124, "fff"), (129, "mf"), (130, "n"))
    tuba.dyn((48, "mf"), (60, "f"), (64, "f"), (96, "ff"), (124, "fff"), (129, "mf"), (130, "n"))
    vc.dyn((64, "f"), (96, "ff"), (124, "fff"), (127, "mf"), (128, "p"), (140, "mp"), (150, "n"))
    cb.dyn((0, "p"), (16, "mp"), (32, "mp"), (48, "mf"), (64, "f"), (96, "ff"), (124, "fff"), (127, "mf"),
           (128, "pp"), (140, "p"), (150, "n"))
    return c

"""BLIZZARD - whiteout. Clusters around B, 4/4, 60 BPM, 30 bars = 2:00 loop.

No melody, no pulse: six gusts. Each is a swell of sustained string clusters (semitone/whole-tone
stacks) that shifts upward from gust to gust; tremolo violas and basses, low trombones and a dark
male choir join the big ones. Under everything a B/C/F# drone rubs, and three bands of periodic
noise (tuned to the gusts) blow through. The horns try the leitmotif's fifth and it bends into the
tritone B-F, sliding to F#. Gust 4 is the eye of the storm; gust 5 the worst; gust 6 falls back
into gust 1 across the loop.

  gust   bars    cluster top           peak
  1      1-5     B5 C6                 mf
  2      6-10    C6 C#6                f
  3      11-16   C#6 D6 E6             ff  (horns: B-F-F#)
  4      17-20   F#6 alone (eye)       p
  5      21-26   D6 Eb6 F6             fff (horns again, timpani roll, choir)
  6      27-30   C6 C#6 -> B5 C6       p
"""
from score import Cue
from synth import Drone, NoiseSwell
from common import roll

GUSTS = [(0, 20, 8, "mf"), (20, 40, 30, "f"), (40, 64, 52, "ff"), (64, 80, 72, "p"),
         (80, 104, 94, "fff"), (104, 120, 110, "mp")]


def build() -> Cue:
    c = Cue("blizzard", bpm=60, meter=4, key="B (clusters)", loop=True, bars=30, title="Whiteout",
            intensity=0.75, rt60=4.0, predelay_ms=30, wet_db=-3.0, tail_s=10.0, ir_brightness=0.35,
            ir_seed=31, comp=dict(threshold_db=2.0, ratio=2.0, attack_ms=60.0, release_ms=600.0))
    v1 = c.part("vln1", "vln1", gain_db=-3.0, qa_voice=False)
    v2 = c.part("vln2", "vln2", gain_db=-4.0, qa_voice=False)
    vla = c.part("vla_trem", "vla_trem", gain_db=-4.0, qa_voice=False)
    vc = c.part("vc", "vc", gain_db=-3.0, qa_voice=False)
    cb = c.part("cb_trem", "cb_trem", gain_db=-4.0, qa_voice=False)
    tbn = c.part("trombones", "trombones", gain_db=-6.0, qa_voice=False)
    ch = c.part("choir", "choir_aah", gain_db=-7.0, qa_voice=False)
    hn = c.part("horns", "horns", gain_db=-3.0, dry_db=-3.0, send=0.65)
    timp = c.part("timp", "timpani", gain_db=-8.0)

    v1.phrase(0, "[B5,C6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | [C6,C#6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "[C#6,D6,E6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | F#6:4 | ~:4 | ~:4 | ~:4 | "
                 "[D6,Eb6,F6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | [C6,C#6]:4 | ~:4 | [B5,C6]:4 | ~:4 |")
    v2.phrase(0, "F#5:4 | ~:4 | ~:4 | ~:4 | ~:4 | [F#5,G5]:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "[G5,A5]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | r:4 | r:4 | r:4 | r:4 | "
                 "[A5,Bb5]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | G5:4 | ~:4 | F#5:4 | ~:4 |")
    vla.phrase(0, "[E4,F4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | [F4,F#4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                  "[F#4,G4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | r:4 | r:4 | r:4 | r:4 | "
                  "[G4,Ab4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | [F4,F#4]:4 | ~:4 | [E4,F4]:4 | ~:4 |")
    vc.phrase(0, "B2:4 | ~:4 | ~:4 | ~:4 | ~:4 | [B2,C3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "[C3,C#3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | B2:4 | ~:4 | ~:4 | ~:4 | "
                 "[C3,Db3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | [B2,C3]:4 | ~:4 | B2:4 | ~:4 |")
    cb.phrase(0, "B1:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    tbn.phrase(40, "[B2,C3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    tbn.phrase(80, "[B2,C3,F3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    ch.phrase(40, "[E3,F3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    ch.phrase(80, "[F#3,G3,C4]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    hn.phrase(48, "B3:1 F4:3 | F#4:4 |")
    hn.phrase(84, "B3:2 F4:2 | ~:4 | F#4:4 | ~:2 r:2 |")

    # gust contours: string clusters swell together, each part slightly offset (the wind moves)
    def gusts(part, scale=1.0, lag=0.0, floor="pp"):
        pts = []
        for (a, b, peak_at, peak) in GUSTS:
            pts += [(a + lag, floor), (peak_at + lag, peak), (b - 2 + lag, "p")]
        part.dyn(*pts)
    gusts(v1, lag=0.0)
    gusts(v2, lag=0.5)
    gusts(vla, lag=1.0)
    gusts(vc, lag=0.5, floor="p")
    gusts(cb, lag=0.0, floor="p")
    tbn.dyn((40, "n"), (52, "f"), (62, "pp"), (64, "n"), (80, "n"), (94, "ff"), (102, "p"), (104, "n"))
    ch.dyn((40, "n"), (52, "mf"), (62, "pp"), (64, "n"), (80, "n"), (94, "f"), (102, "pp"), (104, "n"))
    hn.dyn((48, "mf"), (50, "f"), (54, "mf"), (56, "n"), (84, "mf"), (90, "ff"), (94, "f"), (98, "mp"),
           (100, "n"))
    roll(timp, "F#2", 88.0, 6.0, 24, 96)
    timp.note("B2", 94, 4, 100)

    L = 120
    c.add(Drone("drone", pitches=[("B1", 0.0), ("C2", -9.0), ("F#1", -5.0)], continuous=True,
                brightness=0.3, breathe_hz=0.05, breathe_depth=0.3, gain_db=-16.0, send=0.3, lp=500))
    bands = []
    for fc, q, base, gain in ((350, 1.4, -34, 0), (900, 2.0, -36, 2), (2400, 2.6, -40, 3)):
        pts = [(0, base)]
        for (a, b, peak_at, peak) in GUSTS:
            top = {"p": 4, "mp": 6, "mf": 8, "f": 11, "ff": 14, "fff": 16}[peak] + gain
            pts += [(a + 1, base), (peak_at + 1.5, base + top), (b - 1, base + 1)]
        pts.append((L, base))
        bands.append((fc, q, pts))
    c.add(NoiseSwell("storm", continuous=True, bands=bands, gain_db=-4.0, send=0.35, hp=120))
    return c

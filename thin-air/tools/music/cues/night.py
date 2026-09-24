"""NIGHT - cold, sparse. D Aeolian with Phrygian Eb, 4/4, 56 BPM, 42 bars = 3:00 loop.

A dark detuned-saw pad (numpy, low-passed, filter slowly breathing) and contrabasses hold six-bar
chords; far away, a felt piano (quiet dry signal, long echo) remembers fragments of the theme and
never finishes them. Celesta and glass 'stars' appear rarely. Most bars contain no new note.

  pad:  Dm(add9) | Bbmaj7 | Gm(add9) | Dm7 | Ebmaj7(#11) (Phrygian cold) | Bbmaj7 | Asus4 -> (Dm)
  1-12   the fifth D-A alone; a Bb-A sigh
  13-24  the theme's falling line F-E... stops before D
  25-30  Eb major: a distant horn calls D-A (a #11 against Eb), celesta answers
  31-36  once, the hopeful B natural begins the climb (B-C) - and stops
  37-42  A (sus4) - the loop falls back into D minor
"""
from score import Cue
from synth import Glass, SawPad


def build() -> Cue:
    c = Cue("night", bpm=56, meter=4, key="D Aeolian", loop=True, bars=42, title="Long Night",
            intensity=0.15, rt60=4.6, predelay_ms=45, wet_db=-2.5, tail_s=14.0, ir_brightness=0.3,
            ir_seed=11)
    pno = c.part("pno", "mellow_piano", gain_db=9.0, dry_db=-6.0, send=0.75,
                 delay=(0.535, 0.38, 0.32), qa_voice=False)
    cel = c.part("celesta", "celesta", gain_db=1.0, dry_db=-6.0, send=0.8, delay=(0.402, 0.4, 0.35))
    cb = c.part("cb", "cb", gain_db=2.0)
    hn = c.part("horn", "horns", gain_db=4.0, dry_db=-8.0, send=0.85, lp=2400)

    B = 4  # beats per bar
    chords = [  # (first bar, bars, voicing)
        (1, 6, ["D2", "A2", "F3", "E4"]),
        (7, 6, ["Bb1", "F2", "D3", "A3"]),
        (13, 6, ["G1", "D2", "Bb2", "A3"]),
        (19, 6, ["D2", "A2", "F3", "C4"]),
        (25, 6, ["Eb2", "Bb2", "G3", "D4"]),
        (31, 6, ["Bb1", "F2", "D3", "A3"]),
        (37, 6, ["A1", "E2", "D3", "A3"]),
    ]
    pad_notes = []
    for first, n, voicing in chords:
        for k, p in enumerate(voicing):
            lvl = [-2.0, -5.0, -7.0, -10.0][k]
            pad_notes.append((p, (first - 1) * B, n * B + 1.0, lvl))
    # the loop folds the last chord's release onto bar 1, so the pad never stops
    c.add(SawPad("pad", notes=pad_notes, voices=5, detune_cents=11, attack=5.0, release=6.0,
                 cutoff=[(0, 380), (24, 720), (48, 420), (84, 640), (100, 900), (120, 520), (144, 760),
                         (168, 380)],
                 resonance=0.8, sine_mix=0.5, gain_db=-4.0, send=0.55, hp=40, seed=21))
    c.add(Glass("stars", notes=[("A6", 34, 10, -6), ("E6", 38, 8, -9), ("D7", 102, 12, -8),
                                ("A6", 108, 8, -10), ("E7", 146, 10, -11), ("A6", 150, 8, -8)],
                attack=3.0, release=5.0, gain_db=-8.0, send=0.9, dry_db=-6.0, hp=900))

    # basses double the pad's roots, pianissimo
    cb.phrase(0, "D2:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | Bb1:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "G1:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | D2:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "Eb2:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | Bb1:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                 "A1:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    cb.dyn((0, "pp"), (12, "p"), (24, "pp"), (48, "p"), (72, "pp"), (96, "p"), (120, "pp"), (144, "p"),
           (160, "pp"), (168, "pp"))

    # distant piano: fragments
    pno.phrase(0, "@34 r:4 | r:1 D5:1 A5:2 | r:4 | r:4 | r:2 E5:2 | r:4 | "
                  "r:4 | r:1 Bb4:1 A4:2 | r:4 | r:4 | r:2 D5:1 A5:1 | r:4 | "
                  "[D2,A2]:4@30 | r:4 | r:1 F5:1 E5:2 | r:4 | r:4 | r:4 | "
                  "r:4 | r:1 D5:1 A5:2 | r:4 | r:3 G5:1 | F5:2 E5:2 | r:4 | "
                  "r:4 | r:4 | r:1 G5:1 D6:2 | r:4 | Bb5:3 r:1 | r:4 | "
                  "r:4 | r:4 | r:1 D5:1 A5:2 | r:4 | B4:1.5 C5:0.5 r:2 | r:4 | "
                  "r:4 | r:4 | r:2 A4:2 | ~:4 | r:4 | r:4 |")
    for k in range(42):
        pno.pedal(k * B, (k + 1) * B)
    cel.phrase(12, "@40 r:2 A6:0.5 D7:0.5 E7:1 |")
    cel.phrase(64, "@36 r:1 D7:0.5 A6:0.5 F6:2 |")
    cel.phrase(116, "@38 r:2 E7:0.5 D7:0.5 A6:1 |")
    cel.phrase(148, "@34 r:1 A6:1 r:2 |")
    hn.phrase(96, "D3:1 A3:3 | ~:2 r:2 |")
    hn.dyn((96, "pp"), (99, "p"), (102, "pp"), (104, "n"))
    return c

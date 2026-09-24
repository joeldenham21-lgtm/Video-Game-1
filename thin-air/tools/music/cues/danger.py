"""DANGER - predators. C minor / Phrygian with the tritone, 4/4, 120 BPM, 45 bars = 1:30 loop.

A 3+3+2 ostinato (solo cello + solo bass spiccato, basses pizzicato on the accents, a muted synth
pluck) under pulsing violas/2nd violins a minor second apart and a tremolo violin cluster. The
brass play the CORRUPTED FIFTH: the leitmotif's fifth bent into a tritone that slides up a semitone
(C-F#-G). Taiko, concert bass drum, timpani, sub booms. Mid-loop the music drops to a heartbeat of
pizzicato and a high whine - the animal circling - before building again.

  harmony (2-bar cells): C | Ab | C | Ab F# C | C Db C F# G | (drop: C) | Ab F# Db C | C
  1-8    ostinato alone, pluck + spiccato basses; violas pulse from bar 5
  9-16   celli join, trombones/tuba: C-F#-G, then F#-C-C#; taiko 3+3+2; tremolo cluster
  17-24  peak: horns take the corrupted fifth (C-F#-G, Db-G-Ab); timpani, bass drum, boom
  25-32  drop: a hit, then almost nothing
  33-40  second build: trombones Ab-D-Eb, horns F#-C-C#, Db-G-Ab, C-F#-G
  41-45  back to the bare ostinato (flows into bar 1)
"""
from score import Cue
from synth import Boom, Drone, Pluck
from common import roll

CELLS = {  # 3+3+2 eighths, accent on 1, 4, 7; last group bites a semitone above the root
    "C": ["C2", "G1", "C2", "C2", "G1", "C2", "Db2", "C2"],
    "Ab": ["Ab1", "Eb2", "Ab1", "Ab1", "Eb2", "Ab1", "A1", "Ab1"],
    "F#": ["F#1", "C#2", "F#1", "F#1", "C#2", "F#1", "G1", "F#1"],
    "Db": ["Db2", "Ab1", "Db2", "Db2", "Ab1", "Db2", "D2", "Db2"],
    "G": ["G1", "D2", "G1", "G1", "D2", "G1", "Ab1", "G1"],
}
PULSE = {"C": ("G3", "Ab3"), "Ab": ("C4", "Db4"), "F#": ("C#4", "D4"), "Db": ("Ab3", "A3"), "G": ("G3", "Ab3")}
HARM = (["C"] * 4 + ["Ab"] * 2 + ["C"] * 2 +                    # 1-8
        ["C"] * 2 + ["Ab"] * 2 + ["F#"] * 2 + ["C"] * 2 +       # 9-16
        ["C"] * 2 + ["Db"] * 2 + ["C"] * 2 + ["F#", "G"] +      # 17-24
        ["C"] * 8 +                                            # 25-32
        ["Ab"] * 2 + ["F#"] * 2 + ["Db"] * 2 + ["C"] * 2 +      # 33-40
        ["C"] * 5)                                             # 41-45
# ostinato base velocity per bar (0 = tacet)
VEL = [60] * 8 + [70] * 8 + [88] * 8 + [0] * 8 + [78] * 8 + [62] * 5


def _cell(h, vel, shift=0, accents_only=False):
    notes = CELLS[h]
    toks = []
    for k, n in enumerate(notes):
        acc = k in (0, 3, 6)
        if accents_only:
            if k == 0:
                toks.append(f"{n}:1.5@{vel}'")
            elif k == 3:
                toks.append(f"{n}:1.5@{vel}'")
            elif k == 6:
                toks.append(f"{n}:1@{vel}'")
            continue
        toks.append(f"{n}:0.5@{vel + (14 if acc else 0)}'")
    s = " ".join(toks) + " |"
    return s


def build() -> Cue:
    c = Cue("danger", bpm=120, meter=4, key="C Phrygian", loop=True, bars=45, title="Hunted",
            intensity=0.9, rt60=2.4, predelay_ms=18, wet_db=-6.0, tail_s=6.0, ir_brightness=0.4,
            ir_seed=29, comp=dict(threshold_db=1.0, ratio=2.2, attack_ms=20.0, release_ms=250.0),
            qa_ok=["trombones/horns", "tuba/horns"])   # brass state the motif in octaves on purpose
    cbs = c.part("cb_spicc", "cb_spicc", gain_db=0.0, qa_voice=False)
    vcs = c.part("vc_spicc", "vc_spicc", gain_db=-2.0, qa_voice=False)
    cbp = c.part("cb_pizz", "cb_pizz", gain_db=0.0, qa_voice=False)
    vla = c.part("vla_pulse", "vla_fast", gain_db=-4.0, qa_voice=False, legato=0.0)
    v2 = c.part("vln2_pulse", "vln2_fast", gain_db=-5.0, qa_voice=False, legato=0.0)
    trem = c.part("vln1_trem", "vln1_trem", gain_db=-6.0, qa_voice=False)
    vcl = c.part("vc_cluster", "vc", gain_db=-6.0, qa_voice=False)
    tbn = c.part("trombones", "trombones", gain_db=-1.0)
    tuba = c.part("tuba", "tuba", gain_db=-3.0, doubles="trombones")
    hn = c.part("horns", "horns", gain_db=-1.0)
    taiko = c.part("taiko", "taiko", gain_db=-4.0)
    bd = c.part("bass_drum", "bass_drum", gain_db=-4.0)
    timp = c.part("timp", "timpani", gain_db=-5.0)

    pluck = []
    for bar, (h, v) in enumerate(zip(HARM, VEL)):
        b0 = bar * 4
        if v:
            cbs.phrase(b0, _cell(h, v))
            if 8 <= bar < 24 or 32 <= bar < 40:
                vcs.phrase(b0, _cell(h, v - 6), transpose=12)
                cbp.phrase(b0, _cell(h, v + 6, accents_only=True))
            if bar >= 4 and not (24 <= bar < 32):
                lo, hi = PULSE[h]
                vla.phrase(b0, " ".join([f"{lo}:0.5"] * 8) + " |", vel=v - 10)
                if bar >= 8:
                    v2.phrase(b0, " ".join([f"{hi}:0.5"] * 8) + " |", vel=v - 12)
        else:
            # the drop: pizzicato heartbeat on the accents only
            cbp.phrase(b0, _cell(h, 54, accents_only=True))
        lvl = {0: -4, 60: -8, 70: -6, 88: -3, 78: -5, 62: -8}[v]
        for k, n in enumerate(CELLS[h]):
            if v == 0 and k not in (0, 3, 6):
                continue
            pluck.append((n, b0 + 0.5 * k, 0.32, lvl + (2 if k in (0, 3, 6) else 0) - (6 if v == 0 else 0)))
    c.add(Pluck("pluck", notes=pluck, decay=0.13, cutoff=700, sub=0.7, gain_db=-4.0, send=0.25, hp=30))
    c.add(Drone("sub", pitches=[("C2", 0.0), ("Db2", -9.0)], continuous=True, brightness=0.2,
                breathe_hz=0.12, breathe_depth=0.4, gain_db=-22.0, send=0.2, lp=300))
    c.add(Boom("boom", hits=[(64, 0.0), (96, 2.0), (128, -1.0)], gain_db=-6.0, send=0.35))

    # tremolo cluster and the drop's cello cluster
    trem.phrase(32, "[C6,Db6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                    "[G5,Ab5,C6,Db6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                    "[C6,Db6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | "
                    "[G5,Ab5,C6,Db6]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    trem.dyn((32, "pp"), (60, "mp"), (64, "mf"), (88, "f"), (95.5, "f"), (96, "pp"), (124, "p"), (128, "mf"),
             (156, "f"), (160, "p"), (162, "n"))
    vcl.phrase(96, "[C3,Db3]:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 | ~:4 |")
    vcl.dyn((96, "pp"), (112, "p"), (126, "mp"), (128, "n"))
    for p in (vla, v2):
        p.dyn((16, "pp"), (32, "p"), (60, "mf"), (64, "f"), (95.5, "f"), (96, "n"), (127, "n"), (128, "mf"),
              (156, "f"), (160, "mp"), (172, "p"), (180, "pp"))
    vla.dyn((180, "pp"), (184, "pp"))

    # brass: the corrupted fifth
    tbn.phrase(32, "C3:1 F#3:3 | G3:4 | r:4 | r:4 | F#2:1 C3:3 | C#3:4 | r:4 | r:4 |")
    tuba.phrase(32, "C2:1 F#2:3 | G2:4 | r:4 | r:4 | F#1:1 C2:3 | C#2:4 | r:4 | r:4 |")
    tbn.phrase(72, "Db3:1 G3:3 | Ab3:4 | r:4 | r:4 |")
    tuba.phrase(72, "Db2:1 G2:3 | Ab2:4 | r:4 | r:4 |")
    tbn.phrase(128, "Ab2:1 D3:3 | Eb3:4 | r:4 | r:4 | Db3:1 G3:3 | Ab3:4 | C3:1 F#3:3 | G3:4 |")
    tuba.phrase(128, "Ab1:1 D2:3 | Eb2:4 | r:4 | r:4 | Db2:1 G2:3 | Ab2:4 | C2:1 F#2:3 | G2:4 |")
    tbn.dyn((32, "f"), (33, "p"), (38, "f"), (40, "mp"), (48, "f"), (49, "p"), (54, "f"), (56, "mp"),
            (72, "f"), (73, "mp"), (78, "ff"), (80, "mf"), (128, "f"), (129, "p"), (134, "f"), (136, "mp"),
            (144, "f"), (145, "mp"), (150, "f"), (152, "f"), (153, "mp"), (158, "ff"), (160, "p"))
    tuba.dyn((32, "f"), (33, "p"), (38, "f"), (40, "mp"), (48, "f"), (49, "p"), (54, "f"), (56, "mp"),
             (72, "f"), (73, "mp"), (78, "ff"), (80, "mf"), (128, "f"), (129, "p"), (134, "f"), (136, "mp"),
             (144, "f"), (145, "mp"), (150, "f"), (152, "f"), (153, "mp"), (158, "ff"), (160, "p"))
    hn.phrase(64, "C4:1 F#4:3 | G4:4 | Db4:1 G4:3 | Ab4:4 | C4:1 F#4:3 | G4:2 F#4:2 | F#4:4 | G4:4 |")
    hn.phrase(136, "F#3:1 C4:3 | C#4:4 | Db4:1 G4:3 | Ab4:4 | C4:1 F#4:3 | G4:4 |")
    hn.dyn((64, "f"), (68, "mf"), (72, "f"), (76, "mf"), (80, "f"), (86, "mf"), (88, "f"), (95.5, "ff"),
           (96, "n"), (136, "mf"), (144, "f"), (152, "f"), (156, "ff"), (160, "mp"), (162, "n"))

    # percussion
    taiko.phrase(0, "@56 C3:4 | r:4 | r:4 | r:4 | C3:4 | r:4 | r:4 | r:4 |")
    for bar in list(range(8, 24)) + list(range(32, 40)):
        v = 70 if bar < 16 else (92 if bar < 24 else 84)
        fill = bar in (15, 23, 39)
        if fill:
            taiko.phrase(bar * 4, f"@{v} C3:1.5 C3:1.5 C3:0.25 C3:0.25 C3:0.25 C3:0.25 |")
        else:
            taiko.phrase(bar * 4, f"@{v} C3:1.5 C3:1.5@{v - 12} G2:1@{v - 6} |")
    for bar in range(24, 32):
        taiko.phrase(bar * 4, "@46 G2:4 |")
    for bar in (0, 4, 8, 12, 16, 18, 20, 22, 32, 34, 36, 38):
        bd.note("C3", bar * 4, 2, 70 if bar < 16 else 92)
    bd.note("C3", 96, 4, 110)
    roll(timp, "G2", 56.0, 8.0, 30, 96)
    for bar in range(16, 24):
        timp.note("C3", bar * 4, 1, 88)
        timp.note("G2", bar * 4 + 3, 1, 76)
    roll(timp, "G2", 120.0, 8.0, 26, 92)
    for bar in range(32, 40):
        timp.note("C3", bar * 4, 1, 80)
    return c

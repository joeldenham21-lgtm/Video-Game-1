"""STINGERS - short one-shots (4-10 s), mastered to -16 LUFS. All built on the leitmotif.

  discovery   D Lydian wonder: harp sweeps up through G#, celesta calls the fifth D-A high above,
              strings and choir bloom on Dmaj9(#11)
  danger      the CORRUPTED FIFTH sforzando: trombones/tuba C-F# snapping to G/Db, taiko + bass drum
              + sub boom, a tremolo cluster that swells and is cut off
  objective   warm affirmation: horns play the ascent resolved (D-A, B-C#-D) over D major, harp roll
  death       the INVERSION: celli fall A-D then descend C-Bb-A over a low piano cluster and a dark
              choir chord; everything sinks
  blueprint   bright and quick: celesta + vibraphone run the climb D-A-B-C#-D in sixteenths, soft pad
"""
from score import Cue
from synth import Boom, Glass, Pluck


def _stinger(name, bpm, bars, title, intensity, tail, **kw):
    return Cue(name, bpm=bpm, meter=4, key=kw.pop("key", "D"), loop=False, bars=bars, kind="stinger",
               title=title, intensity=intensity, tail_s=tail, target_lufs=-16.0, fade_out_s=1.0, max_s=10.0,
               **kw)


def discovery() -> Cue:
    c = _stinger("stinger_discovery", 72, 2, "Discovery", 0.3, 4.5, key="D Lydian", rt60=3.6, wet_db=-2.5,
                 predelay_ms=36, ir_seed=51)
    # the harp sweep leads in; the string/choir bloom must be felt under it, not buried
    harp = c.part("harp", "harp", gain_db=-3.5)
    cel = c.part("celesta", "celesta", gain_db=-1.0, send=0.7, delay=(0.42, 0.35, 0.3))
    v1 = c.part("vln1", "vln1", gain_db=-0.5, attack_ms=40)
    v2 = c.part("vln2", "vln2", gain_db=-1.5, attack_ms=40)
    vla = c.part("vla", "vla", gain_db=-2.5)
    ch = c.part("choir", "choir_ooh", gain_db=-2.5)
    cb = c.part("cb", "cb", gain_db=-2.0)
    harp.phrase(0, "@58 D3:0.25 A3:0.25 D4:0.25 E4:0.25 G#4:0.25 A4:0.25 C#5:0.25 E5:0.25 "
                   "G#5:0.25 A5:0.25 C#6:0.25 E6:1.25 | r:4 |")
    cel.phrase(0, "@52 r:2 D6:1 A6:1 | E7:2@40 r:2 |")
    v1.phrase(0, "[A5,C#6]:4 | ~:3 r:1 |")
    v2.phrase(0, "[E5,G#5]:4 | ~:3 r:1 |")
    vla.phrase(0, "[F#4,A4]:4 | ~:3 r:1 |")
    ch.phrase(0, "[D4,F#4,A4]:4 | ~:3 r:1 |")
    cb.phrase(0, "D2:4 | ~:3 r:1 |")
    for p, peak in ((v1, "mf"), (v2, "mp"), (vla, "mp"), (ch, "mp"), (cb, "p")):
        p.dyn((0, "pp"), (2.5, peak), (5.0, "p"), (7.0, "n"))
    c.add(Glass("shimmer", notes=[("A6", 1.5, 3, -8), ("E7", 2.5, 3, -12)], attack=0.8, release=3.0,
                gain_db=-8.0, send=0.8, hp=900))
    return c


def danger() -> Cue:
    c = _stinger("stinger_danger", 90, 2, "Danger", 0.95, 3.5, key="C Phrygian", rt60=2.4, wet_db=-5.0,
                 predelay_ms=16, ir_seed=53, comp=dict(threshold_db=1.0, ratio=2.5, attack_ms=10.0,
                                                       release_ms=200.0))
    tbn = c.part("trombones", "trombones", gain_db=0.0, qa_voice=False)
    tuba = c.part("tuba", "tuba", gain_db=-2.0, qa_voice=False)
    hn = c.part("horns", "horns", gain_db=-2.0, qa_voice=False)
    trem = c.part("vln_trem", "vln1_trem", gain_db=-3.0, qa_voice=False)
    vlat = c.part("vla_trem", "vla_trem", gain_db=-4.0, qa_voice=False)
    taiko = c.part("taiko", "taiko", gain_db=0.0)
    bd = c.part("bass_drum", "bass_drum", gain_db=0.0)
    cbs = c.part("cb_spicc", "cb_spicc", gain_db=0.0, qa_voice=False)
    tbn.phrase(0, "C3:0.5 F#3:2.5 [G3,Db4]:1 | ~:2 r:2 |")
    tuba.phrase(0, "C2:0.5 F#2:2.5 G2:1 | ~:2 r:2 |")
    hn.phrase(0, "r:3 [F#4,G4]:1 | ~:2 r:2 |")
    for p in (tbn, tuba):
        p.dyn((0, "ff"), (0.6, "p"), (2.9, "ff"), (3.0, "fff"), (4.5, "f"), (6.0, "n"))
    hn.dyn((3.0, "ff"), (4.5, "mf"), (6.0, "n"))
    trem.phrase(0, "[C6,Db6]:3 r:1 | r:4 |")
    trem.dyn((0, "pp"), (2.9, "ff"), (3.0, "n"))
    vlat.phrase(0, "[F#4,G4]:3 r:1 | r:4 |")
    vlat.dyn((0, "p"), (2.9, "f"), (3.0, "n"))
    taiko.phrase(0, "@112 C3:1.5 C3:0.5@80 C3:0.25@70 C3:0.25@84 C3:0.25@96 C3:0.25@108 G2:1@124 | r:4 |")
    bd.phrase(0, "@118 C3:3 C3:1@127 | r:4 |")
    cbs.phrase(0, "@100 C2:0.5' r:2.5 G1:1^ | r:4 |")
    c.add(Boom("boom", hits=[(0.0, 0.0), (3.0, 1.0)], gain_db=-4.0, send=0.3))
    c.add(Pluck("pluck", notes=[("C2", 0, 0.4, -2), ("G1", 3.0, 0.8, 0)], decay=0.25, cutoff=500, sub=0.8,
                gain_db=-6.0, send=0.2))
    return c


def objective() -> Cue:
    c = _stinger("stinger_objective", 76, 2, "Objective", 0.35, 4.0, key="D major", rt60=3.2, wet_db=-3.5,
                 predelay_ms=30, ir_seed=57)
    hn = c.part("horns", "horns", gain_db=0.0)
    v1 = c.part("vln1", "vln1", gain_db=-4.0)
    vla = c.part("vla", "vla", gain_db=-5.0)
    vc = c.part("vc", "vc", gain_db=-4.0, doubles="cb")
    cb = c.part("cb", "cb", gain_db=-6.0)
    harp = c.part("harp", "harp", gain_db=-6.5)       # the horns carry the ascent; harp colours the arrival
    hn.phrase(0, "D4:1 A4:2 B4:0.5 C#5:0.5 | D5:4 |")
    hn.dyn((0, "mp"), (2.5, "mf"), (4.5, "mf"), (6.5, "p"), (8, "n"))
    v1.phrase(0, "F#5:4 | A5:4 |")
    vla.phrase(0, "A4:4 | F#4:4 |")
    vc.phrase(0, "D3:2 G3:2 | A3:0.5 F#3:3.5 |")
    cb.phrase(0, "D2:2 G1:2 | A1:0.5 D2:3.5 |")
    for p in (v1, vla, vc, cb):
        p.dyn((0, "pp"), (3, "mp"), (5, "mp"), (7.5, "n"))
    harp.phrase(4, "@56 {D3,A3,D4,F#4,A4,D5,F#5}:4 |")
    return c


def death() -> Cue:
    c = _stinger("stinger_death", 56, 2, "Death", 0.6, 5.5, key="D Aeolian", rt60=4.4, wet_db=-3.0,
                 predelay_ms=40, ir_seed=59, ir_brightness=0.25,
                 master_eq=dict(hp=34))   # keep the thud's body, drop sub-30 Hz rumble that eats headroom
    pno = c.part("piano", "piano", gain_db=0.0, shelf=[("high", 3000, -6.0)], qa_voice=False)
    vc = c.part("vc", "vc_fast", gain_db=0.0)
    cb = c.part("cb", "cb", gain_db=-3.0)
    ch = c.part("choir", "choir_aah", gain_db=-6.0, qa_voice=False)
    pno.phrase(0, "@70 [D1,A1,Eb2]:4 | ~:4 |")
    pno.pedal(0, 9)
    vc.phrase(0, "A3:1 D3:2 C3:1 | Bb2:1 A2:3 |")
    vc.dyn((0, "mf"), (2, "mp"), (4, "p"), (7.5, "n"))
    cb.phrase(0, "D2:4 | ~:3.5 r:0.5 |")
    cb.dyn((0, "p"), (4, "pp"), (7.5, "n"))
    ch.phrase(0, "[D3,F3,Bb3]:4 | [D3,F3,A3]:3.5 r:0.5 |")
    ch.dyn((0, "n"), (1.5, "p"), (4, "mp"), (7.5, "n"))
    c.add(Boom("thud", hits=[(0.0, -3.0)], f_start=48, f_end=30, decay=2.6, click_db=-30, gain_db=-6.0,
               send=0.4))
    return c


def blueprint() -> Cue:
    c = _stinger("stinger_blueprint", 100, 2, "Blueprint", 0.25, 3.0, key="D major", rt60=2.6, wet_db=-4.0,
                 predelay_ms=24, ir_seed=61, ir_brightness=0.7)
    cel = c.part("celesta", "celesta", gain_db=0.0, send=0.55)
    vib = c.part("vibes", "vibes", gain_db=-3.0)
    pad = c.part("pad", "warm_pad", gain_db=-7.0)
    cel.phrase(0, "@60 D5:0.25 A5:0.25 B5:0.25 C#6:0.25 D6:1 A6:2@48 | r:4 |")
    vib.phrase(0, "@50 r:0.5 A4:0.25 B4:0.25 C#5:0.25 D5:0.75 [F#5,A5,E6]:2 | r:4 |")
    pad.phrase(0, "[D4,A4,E5]:3 r:1 | r:4 |")
    pad.dyn((0, "p"), (1.5, "mp"), (3.5, "pp"))
    c.add(Glass("glint", notes=[("D7", 1.0, 1.5, -10), ("A6", 1.25, 1.5, -12)], attack=0.02, release=2.0,
                shimmer_depth=0.0, gain_db=-8.0, send=0.6, hp=1200))
    return c


def build_all() -> list[Cue]:
    return [discovery(), danger(), objective(), death(), blueprint()]

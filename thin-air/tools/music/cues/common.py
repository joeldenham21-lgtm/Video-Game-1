"""Shared musical material for the THIN AIR score.

THE LEITMOTIF - "Thin Air" (the ascent)
    A rising perfect fifth (the breath before a climb) followed by a stepwise climb to the octave.
    In D:   D4 . A4 ~~~ | B4 . C5 D5 ~ |            (Dorian B natural = hope)
            D4 . A4 ~~~ | Bb4 . C5 D5 E5 |          (Aeolian Bb = grief, E = Lydian #11 over Bb)
    Forms used across the cues:
      PRIME       full 8-bar theme (menu, summit, finale)
      FIFTH       the bare rising fifth, the "call" (night piano, horn calls, stingers)
      CLIMB       the step climb alone, often left unfinished (alpine: the climb falters)
      INVERSION   falling fifth + stepwise descent = loss (station, death stinger)
      CORRUPTED   the fifth bent into a tritone that slides up a semitone (danger, blizzard)
    Harmony of the theme (antecedent | consequent):
      Dm(add9) - G/B - C - Am7 | Dm - Bbmaj7(#11) - Gm9 - D(sus2 / major at the summit & finale)
"""
from __future__ import annotations

THEME_A = "D4:1 A4:3 | B4:1.5 C5:0.5 D5:2 | E5:2 D5:1 C5:1 | A4:4 |"
THEME_B = "D4:1 A4:3 | Bb4:1.5 C5:0.5 D5:1 E5:1 | F5:2.5 E5:0.5 D5:0.5 C5:0.5 | D5:4 |"
# major (resolved) form of the consequent: the climb finally lands with a leading tone
THEME_B_MAJOR = "D4:1 A4:3 | B4:1.5 C#5:0.5 D5:1 E5:1 | F#5:2.5 E5:0.5 D5:0.5 C#5:0.5 | D5:4 |"


def arp(chords: list[str], pattern: str) -> str:
    """Arrange chords into an arpeggio phrase string. chords: one voicing per bar, e.g. 'G2 D3 A3'.
    pattern: tokens 'index:dur' (index into the voicing, low->high) or 'r:dur'; one bar's worth.
    'x' as a chord repeats the previous voicing. Returns notation with bar lines."""
    out = []
    prev = None
    for ch in chords:
        notes = prev if ch == "x" else ch.split()
        prev = notes
        bar = []
        for tok in pattern.split():
            idx, dur = tok.split(":")
            if idx == "r":
                bar.append(f"r:{dur}")
            else:
                bar.append(f"{notes[int(idx) % len(notes)]}:{dur}")
        out.append(" ".join(bar) + " |")
    return " ".join(out)


def roll(part, pitch: str, start: float, dur: float, v0: float, v1: float, rate: float = 11.0,
         accent_end: bool = False) -> None:
    """Timpani / drum roll: evenly spaced strokes (rate per beat-second is resolved by the cue's
    tempo) with a velocity ramp v0 -> v1. Deterministic; the renderer adds human timing."""
    cue = part.cue
    t0, t1 = cue.sec(start), cue.sec(start + dur)
    n = max(2, int((t1 - t0) * rate))
    for k in range(n):
        u = k / (n - 1)
        # map evenly spaced seconds back to beats
        target = t0 + (t1 - t0) * k / n
        lo, hi = start, start + dur
        for _ in range(30):
            mid = (lo + hi) / 2
            if cue.sec(mid) < target:
                lo = mid
            else:
                hi = mid
        b = (lo + hi) / 2
        part.note(pitch, b, (dur / n) * 1.6, v0 + (v1 - v0) * u)
    if accent_end:
        part.note(pitch, start + dur, 1.0, min(127, v1 + 10))


def bar_pedal(part, first_bar: int, last_bar: int, per_bar: int = 1) -> None:
    """Re-pedal at every bar (or half bar with per_bar=2) between bars first..last inclusive."""
    cue = part.cue
    step = cue.meter / per_bar
    beats = []
    b = cue.bar(first_bar)
    end = cue.bar(last_bar + 1)
    while b < end - 1e-6:
        beats.append(b)
        b += step
    part.pedal_changes(beats, end)

"""Pitch names <-> MIDI numbers, dynamics, and orchestral ranges used by the QA pass."""
from __future__ import annotations

import re

_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_NOTE_RE = re.compile(r"^([A-Ga-g])(bb|b|##|#|x)?(-?\d)$")
_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def P(name: str | int) -> int:
    """'C4' -> 60 (scientific pitch, middle C = C4)."""
    if isinstance(name, int):
        return name
    m = _NOTE_RE.match(name.strip())
    if not m:
        raise ValueError(f"bad pitch name {name!r}")
    step, acc, octv = m.groups()
    n = _STEP[step.upper()] + 12 * (int(octv) + 1)
    n += {None: 0, "#": 1, "##": 2, "x": 2, "b": -1, "bb": -2}[acc]
    return n


def name(p: int) -> str:
    return f"{_NAMES[p % 12]}{p // 12 - 1}"


# Dynamics -> controller value (CC2 on "Expr." presets / CC11 otherwise) and piano velocity.
DYN = {"n": 8, "ppp": 28, "pp": 40, "p": 54, "mp": 68, "mf": 82, "f": 98, "ff": 112, "fff": 124}
VEL = {"ppp": 22, "pp": 32, "p": 44, "mp": 56, "mf": 68, "f": 84, "ff": 100, "fff": 114}


def dyn(v) -> float:
    if isinstance(v, str):
        return float(DYN[v])
    return float(v)


# Comfortable written->sounding ranges (MIDI, sounding pitch) for the QA range check.
RANGES = {
    "violin": (55, 96), "viola": (48, 86), "cello": (36, 76), "contrabass": (28, 55),
    "flute": (60, 93), "clarinet": (50, 89), "oboe": (58, 89), "english_horn": (52, 81),
    "bassoon": (34, 72), "horn": (35, 77), "trombone": (40, 74), "tuba": (26, 60),
    "trumpet": (54, 82), "harp": (24, 103), "celesta": (60, 108), "piano": (21, 108),
    "timpani": (38, 60), "choir_s": (60, 81), "choir_a": (53, 74), "choir_t": (48, 69),
    "choir_b": (40, 64), "choir": (40, 81), "glock": (79, 108), "vibes": (53, 89),
    "ep": (28, 96), "pad": (24, 100), "bells": (60, 84), "perc": (0, 127),
}

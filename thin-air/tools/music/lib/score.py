"""Score model: Cue -> Parts (MIDI instruments) + synth layers, with a compact, bar-checked notation.

Notation used by Part.phrase(start_beat, text):
    tokens are whitespace separated; durations are in beats (quarter notes), sticky until changed.
    D4:1          note D4 for one beat               r:2        rest two beats
    [D3,A3,F4]:4  chord                              {D3,A3,F4}:4  rolled chord (arpeggiated upward)
    ~:2           tie: extend the previous note/chord by two beats
    D4:1@70       per-note velocity                  @70 / @mp  sticky velocity (number or dynamic word)
    suffixes      '  staccato   _  tenuto/legato (overlap)   >  accent   ^  marcato
    !mp           dynamics controller point (CC2 on Expr presets, CC11 otherwise) at the cursor;
                  consecutive points are joined by straight ramps, so '!p ... !f' is a crescendo.
    |             bar check: the cursor must sit on a bar line of the cue's metre, otherwise the
                  build fails. This catches rhythm-arithmetic mistakes in hand-written parts.
Durations accept decimals or fractions ('1.5', '3/2', '1/3').
"""
from __future__ import annotations

import random
import re
import zlib
from dataclasses import dataclass, field
from fractions import Fraction

from theory import DYN, P, VEL, dyn

# ---------------------------------------------------------------------------------------------
# Instrument presets (MuseScore_General_Full.sf3). dyn_cc: controller used for dynamics.
# 'range' keys theory.RANGES for the QA pass. send = reverb send (0..1). hp/lp in Hz.
# ---------------------------------------------------------------------------------------------
INSTR: dict[str, dict] = {
    # keyboards / plucked / mallets
    "piano":        dict(program=0, bank=0, dyn_cc=None, range="piano", pan=0.0, width=0.85, send=0.34, hp=38, human_ms=9, pedal=True),
    "mellow_piano": dict(program=0, bank=8, dyn_cc=None, range="piano", pan=0.0, width=0.85, send=0.36, hp=38, human_ms=9, pedal=True),
    "celesta":      dict(program=8, bank=0, dyn_cc=None, range="celesta", pan=0.25, width=0.5, send=0.55, hp=180, human_ms=8),
    "glock":        dict(program=9, bank=0, dyn_cc=None, range="glock", pan=0.3, width=0.4, send=0.55, hp=300, human_ms=6),
    "vibes":        dict(program=11, bank=0, dyn_cc=None, range="vibes", pan=0.2, width=0.6, send=0.45, hp=90, human_ms=8),
    "tubular":      dict(program=14, bank=0, dyn_cc=None, range="bells", pan=0.3, width=0.5, send=0.55, hp=120, human_ms=4),
    "church_bell":  dict(program=14, bank=8, dyn_cc=None, range="bells", pan=0.0, width=0.5, send=0.6, hp=80, human_ms=4),
    "harp":         dict(program=46, bank=0, dyn_cc=None, range="harp", pan=-0.35, width=0.55, send=0.45, hp=45, human_ms=10, roll_ms=38),
    "ep":           dict(program=4, bank=0, dyn_cc=None, range="ep", pan=0.0, width=0.8, send=0.30, hp=40, human_ms=9, pedal=True),
    "ep_detuned":   dict(program=4, bank=8, dyn_cc=None, range="ep", pan=0.0, width=0.9, send=0.30, hp=40, human_ms=9, pedal=True),
    # string sections (Expr presets: CC2 dynamics with timbre)
    "vln1":       dict(program=49, bank=21, dyn_cc=2, range="violin", pan=-0.48, width=0.45, send=0.42, hp=160, human_ms=12, legato=0.08),
    "vln1_fast":  dict(program=48, bank=21, dyn_cc=2, range="violin", pan=-0.48, width=0.45, send=0.40, hp=160, human_ms=10, legato=0.04),
    "vln1_trem":  dict(program=44, bank=21, dyn_cc=2, range="violin", pan=-0.48, width=0.45, send=0.42, hp=160, human_ms=12),
    "vln2":       dict(program=49, bank=26, dyn_cc=2, range="violin", pan=-0.22, width=0.45, send=0.42, hp=150, human_ms=12, legato=0.08),
    "vln2_fast":  dict(program=48, bank=26, dyn_cc=2, range="violin", pan=-0.22, width=0.45, send=0.40, hp=150, human_ms=10, legato=0.04),
    "vln2_trem":  dict(program=44, bank=26, dyn_cc=2, range="violin", pan=-0.22, width=0.45, send=0.42, hp=150, human_ms=12),
    "vla":        dict(program=49, bank=31, dyn_cc=2, range="viola", pan=0.14, width=0.45, send=0.40, hp=110, human_ms=12, legato=0.08),
    "vla_fast":   dict(program=48, bank=31, dyn_cc=2, range="viola", pan=0.14, width=0.45, send=0.38, hp=110, human_ms=10, legato=0.04),
    "vla_trem":   dict(program=44, bank=31, dyn_cc=2, range="viola", pan=0.14, width=0.45, send=0.40, hp=110, human_ms=12),
    "vc":         dict(program=49, bank=41, dyn_cc=2, range="cello", pan=0.34, width=0.45, send=0.36, hp=45, human_ms=12, legato=0.08),
    "vc_fast":    dict(program=48, bank=41, dyn_cc=2, range="cello", pan=0.34, width=0.45, send=0.34, hp=45, human_ms=9, legato=0.03),
    "vc_trem":    dict(program=44, bank=41, dyn_cc=2, range="cello", pan=0.34, width=0.45, send=0.36, hp=45, human_ms=12),
    "cb":         dict(program=49, bank=51, dyn_cc=2, range="contrabass", pan=0.5, width=0.35, send=0.30, hp=28, human_ms=12, legato=0.08),
    "cb_fast":    dict(program=48, bank=51, dyn_cc=2, range="contrabass", pan=0.5, width=0.35, send=0.28, hp=28, human_ms=9, legato=0.03),
    "cb_trem":    dict(program=44, bank=51, dyn_cc=2, range="contrabass", pan=0.5, width=0.35, send=0.30, hp=28, human_ms=12),
    "vln_pizz":   dict(program=45, bank=20, dyn_cc=None, range="violin", pan=-0.4, width=0.4, send=0.40, hp=150, human_ms=10),
    "vla_pizz":   dict(program=45, bank=30, dyn_cc=None, range="viola", pan=0.14, width=0.4, send=0.40, hp=100, human_ms=10),
    "vc_pizz":    dict(program=45, bank=40, dyn_cc=None, range="cello", pan=0.3, width=0.4, send=0.36, hp=45, human_ms=10),
    "cb_pizz":    dict(program=45, bank=50, dyn_cc=None, range="contrabass", pan=0.45, width=0.35, send=0.32, hp=30, human_ms=10),
    # plain GM solo strings articulate short notes crisply (on/gap ~6-11 dB vs ~0 dB for sections)
    "vc_spicc":   dict(program=42, bank=0, dyn_cc=11, range="cello", pan=0.3, width=0.35, send=0.30, hp=45, human_ms=7),
    "cb_spicc":   dict(program=43, bank=0, dyn_cc=11, range="contrabass", pan=0.45, width=0.3, send=0.28, hp=28, human_ms=7),
    "vln_solo":   dict(program=40, bank=17, dyn_cc=2, range="violin", pan=-0.2, width=0.25, send=0.42, hp=180, human_ms=10, legato=0.06),
    "vc_solo":    dict(program=42, bank=17, dyn_cc=2, range="cello", pan=0.18, width=0.25, send=0.38, hp=55, human_ms=10, legato=0.06),
    # choir
    "choir_aah":  dict(program=52, bank=17, dyn_cc=2, range="choir", pan=0.0, width=0.9, send=0.55, hp=110, human_ms=14, legato=0.1),
    "choir_ooh":  dict(program=53, bank=17, dyn_cc=2, range="choir", pan=0.0, width=0.9, send=0.58, hp=110, human_ms=14, legato=0.1),
    # brass
    "horns":      dict(program=60, bank=17, dyn_cc=2, range="horn", pan=-0.12, width=0.5, send=0.50, hp=55, human_ms=12, legato=0.06),
    "trombones":  dict(program=57, bank=17, dyn_cc=2, range="trombone", pan=0.22, width=0.4, send=0.46, hp=45, human_ms=12, legato=0.05),
    "tuba":       dict(program=58, bank=17, dyn_cc=2, range="tuba", pan=0.32, width=0.3, send=0.40, hp=28, human_ms=12, legato=0.05),
    "trumpet":    dict(program=56, bank=17, dyn_cc=2, range="trumpet", pan=0.05, width=0.3, send=0.48, hp=160, human_ms=10, legato=0.05),
    # woodwinds
    "flute":      dict(program=73, bank=17, dyn_cc=2, range="flute", pan=-0.1, width=0.25, send=0.46, hp=200, human_ms=10, legato=0.05),
    "clarinet":   dict(program=71, bank=17, dyn_cc=2, range="clarinet", pan=0.1, width=0.25, send=0.42, hp=120, human_ms=10, legato=0.05),
    "oboe":       dict(program=68, bank=17, dyn_cc=2, range="oboe", pan=-0.05, width=0.25, send=0.42, hp=200, human_ms=10, legato=0.05),
    "english_horn": dict(program=69, bank=17, dyn_cc=2, range="english_horn", pan=0.05, width=0.25, send=0.42, hp=140, human_ms=10, legato=0.05),
    "bassoon":    dict(program=70, bank=17, dyn_cc=2, range="bassoon", pan=0.18, width=0.25, send=0.40, hp=45, human_ms=10, legato=0.05),
    # pads (GM)
    "warm_pad":   dict(program=89, bank=17, dyn_cc=2, range="pad", pan=0.0, width=1.0, send=0.40, hp=70, human_ms=0, legato=0.15),
    "halo_pad":   dict(program=94, bank=17, dyn_cc=2, range="pad", pan=0.0, width=1.0, send=0.45, hp=90, human_ms=0, legato=0.15),
    "bowed_glass": dict(program=92, bank=17, dyn_cc=2, range="pad", pan=0.0, width=1.0, send=0.55, hp=150, human_ms=0, legato=0.15),
    "space_voice": dict(program=91, bank=17, dyn_cc=2, range="pad", pan=0.0, width=1.0, send=0.55, hp=120, human_ms=0, legato=0.15),
    "orch_pad":   dict(program=48, bank=8, dyn_cc=11, range="pad", pan=0.0, width=1.0, send=0.40, hp=60, human_ms=0, legato=0.15),
    # percussion
    "timpani":    dict(program=47, bank=0, dyn_cc=None, range="timpani", pan=0.1, width=0.5, send=0.42, hp=30, human_ms=6),
    "taiko":      dict(program=116, bank=0, dyn_cc=None, range="perc", pan=-0.1, width=0.6, send=0.45, hp=30, human_ms=5),
    "bass_drum":  dict(program=116, bank=8, dyn_cc=None, range="perc", pan=0.0, width=0.6, send=0.45, hp=25, human_ms=4),
    "orch_kit":   dict(program=48, bank=128, dyn_cc=None, range="perc", pan=0.0, width=0.7, send=0.45, hp=25, human_ms=5, drum=True),
}


# Attack compensation (ms): note-ons are sent this much early so the audible onset of slow-attack
# samples lands on the beat (measured with tools/music survey: time to ~40-70 % of peak level).
ATTACK_COMP = {
    "vln1": 160, "vln2": 110, "vla": 80, "vc": 90, "cb": 110,
    "vln1_fast": 60, "vln2_fast": 50, "vla_fast": 35, "vc_fast": 50, "cb_fast": 45,
    "vln1_trem": 60, "vln2_trem": 60, "vla_trem": 50, "vc_trem": 55, "cb_trem": 45,
    "vln_solo": 55, "vc_solo": 60, "choir_aah": 110, "choir_ooh": 35, "horns": 25,
    "oboe": 60, "english_horn": 80, "warm_pad": 120, "halo_pad": 80, "bowed_glass": 90,
    "orch_pad": 60, "space_voice": 20, "flute": 15, "clarinet": 15, "bassoon": 15, "trombones": 15,
}


# ---------------------------------------------------------------------------------------------
class TempoMap:
    """Beat -> seconds. Points (beat, bpm, ramp): 'ramp' means tempo glides linearly (in beats) from
    the previous point to this one; otherwise the tempo steps at this beat."""

    def __init__(self, bpm: float):
        self.points: list[tuple[float, float, bool]] = [(0.0, float(bpm), False)]
        self._cache = None

    def set(self, beat: float, bpm: float, ramp: bool = False) -> "TempoMap":
        self.points.append((float(beat), float(bpm), ramp))
        self.points.sort(key=lambda p: p[0])
        self._cache = None
        return self

    def bpm_at(self, beat: float) -> float:
        pts = self.points
        prev = pts[0]
        for p in pts[1:]:
            if beat < p[0]:
                if p[2]:
                    u = (beat - prev[0]) / max(1e-9, p[0] - prev[0])
                    return prev[1] + (p[1] - prev[1]) * u
                return prev[1]
            prev = p
        return prev[1]

    def _build(self):
        step = 1.0 / 96.0
        end = max(p[0] for p in self.points) + 1.0
        n = int(end / step) + 2
        secs = [0.0]
        for i in range(n):
            b = (i + 0.5) * step
            secs.append(secs[-1] + step * 60.0 / self.bpm_at(b))
        self._cache = (step, secs)

    def sec(self, beat: float) -> float:
        if self._cache is None:
            self._build()
        step, secs = self._cache
        if beat <= 0:
            return beat * 60.0 / self.points[0][1]
        i = int(beat / step)
        if i + 1 < len(secs):
            u = beat / step - i
            return secs[i] + (secs[i + 1] - secs[i]) * u
        last = self.points[-1][1]
        return secs[-1] + (beat - (len(secs) - 1) * step) * 60.0 / last


# ---------------------------------------------------------------------------------------------
@dataclass
class Note:
    pitch: int
    beat: float
    dur: float
    vel: float
    art: str = ""          # "'" staccato, '_' tenuto, '>' accent, '^' marcato
    roll: int = 0          # index within a rolled chord
    chord: int = 0         # size of chord it belongs to (1 = single)
    top: bool = True       # highest note of its chord


_TOKEN_NOTE = re.compile(r"^(?P<body>\[[^\]]+\]|\{[^}]+\}|[A-Ga-g](?:bb|b|##|#|x)?-?\d|r|~)"
                         r"(?::(?P<dur>[0-9./]+))?(?:@(?P<vel>[a-z]+|\d+))?(?P<art>['_>^]*)$")


def _parse_dur(s: str) -> float:
    return float(Fraction(s))


class Part:
    def __init__(self, cue: "Cue", name: str, preset: str, **kw):
        self.cue = cue
        self.name = name
        self.preset = preset
        cfg = dict(INSTR[preset])
        cfg.update(kw)
        self.program: int = cfg.pop("program")
        self.bank: int = cfg.pop("bank")
        self.dyn_cc = cfg.pop("dyn_cc")
        self.range_key: str = cfg.pop("range")
        self.pan: float = cfg.pop("pan", 0.0)
        self.width: float = cfg.pop("width", 0.6)
        self.send: float = cfg.pop("send", 0.35)
        self.dry_db: float = cfg.pop("dry_db", 0.0)
        self.gain_db: float = cfg.pop("gain_db", 0.0)
        self.hp = cfg.pop("hp", None)
        self.lp = cfg.pop("lp", None)
        self.shelf = cfg.pop("shelf", None)          # list of (kind 'low'|'high', freq, gain_db)
        self.peaks = cfg.pop("peaks", None)          # list of (freq, gain_db, q)
        self.human_ms: float = cfg.pop("human_ms", 10)
        self.vel_rand: float = cfg.pop("vel_rand", 3.0)
        self.legato: float = cfg.pop("legato", 0.0)  # extra beats * dur fraction added to sustain
        self.roll_ms: float = cfg.pop("roll_ms", 40)
        self.pedal_ok: bool = cfg.pop("pedal", False)
        self.drum: bool = cfg.pop("drum", False)
        self.tail_s: float = cfg.pop("tail_s", 6.0)
        self.transpose: int = cfg.pop("transpose", 0)
        self.predelay_ms: float = cfg.pop("predelay_ms", 0.0)   # extra delay on the reverb send
        self.delay = cfg.pop("delay", None)          # (time_s, feedback, mix) for a soft echo
        self.qa_voice: bool = cfg.pop("qa_voice", True)  # take part in the voice-leading check
        self.doubles: str | None = cfg.pop("doubles", None)   # name of part it doubles (exempt parallels)
        self.attack_ms: float = cfg.pop("attack_ms", ATTACK_COMP.get(preset, 0.0))
        if cfg:
            raise ValueError(f"unknown part options {list(cfg)}")
        self.notes: list[Note] = []
        self.dyn_pts: list[tuple[float, float]] = []
        self.cc_events: list[tuple[float, int, float]] = []
        self.pedals: list[tuple[float, float]] = []
        self._vel = 64.0
        self._dur = 1.0

    # ---- writing ------------------------------------------------------------------------
    def phrase(self, start: float, text: str, vel=None, transpose: int = 0, arch: float = 0.0) -> float:
        """Parse compact notation starting at `start` (beats). Returns the end cursor."""
        if vel is not None:
            self._vel = float(VEL[vel]) if isinstance(vel, str) else float(vel)
        cur = float(start)
        meter = self.cue.meter
        last: list[Note] = []
        new_notes: list[Note] = []
        for tok in text.replace("|", " | ").split():
            if tok == "|":
                pos = round(cur / meter, 6)
                if abs(pos - round(pos)) > 1e-6:
                    raise ValueError(f"{self.cue.name}/{self.name}: bar check failed at beat {cur:.4f} "
                                     f"(bar {cur / meter + 1:.3f}) in phrase starting {start}")
                continue
            if tok.startswith("@"):
                v = tok[1:]
                self._vel = float(VEL[v]) if v in VEL else float(v)
                continue
            if tok.startswith("!"):
                self.dyn_pts.append((cur, dyn(tok[1:])))
                continue
            m = _TOKEN_NOTE.match(tok)
            if not m:
                raise ValueError(f"{self.cue.name}/{self.name}: cannot parse token {tok!r}")
            body, d, v, art = m.group("body"), m.group("dur"), m.group("vel"), m.group("art") or ""
            if d:
                self._dur = _parse_dur(d)
            dur = self._dur
            if body == "r":
                cur += dur
                last = []
                continue
            if body == "~":
                for n in last:
                    n.dur += dur
                cur += dur
                continue
            vel_n = self._vel
            if v:
                vel_n = float(VEL[v]) if v in VEL else float(v)
            if ">" in art:
                vel_n += 14
            if "^" in art:
                vel_n += 18
            rolled = body.startswith("{")
            if body[0] in "[{":
                pitches = [P(x) for x in re.split(r"[,\s]+", body[1:-1].strip()) if x]
            else:
                pitches = [P(body)]
            pitches = sorted(pitches)
            last = []
            for k, p in enumerate(pitches):
                n = Note(p + transpose + self.transpose, cur, dur, vel_n, art,
                         roll=(k if rolled else 0), chord=len(pitches), top=(k == len(pitches) - 1))
                self.notes.append(n)
                new_notes.append(n)
                last.append(n)
            cur += dur
        if arch and new_notes:
            span = max(1e-6, cur - start)
            import math
            for n in new_notes:
                n.vel += arch * math.sin(math.pi * (n.beat - start) / span)
        return cur

    def note(self, pitch, beat: float, dur: float, vel=64, art: str = "") -> None:
        v = float(VEL[vel]) if isinstance(vel, str) else float(vel)
        self.notes.append(Note(P(pitch) + self.transpose, float(beat), float(dur), v, art))

    def dyn(self, *pts) -> "Part":
        """dyn((beat, 'p'), (beat, 'mf'), ...) - controller breakpoints joined by ramps."""
        for b, v in pts:
            self.dyn_pts.append((float(b), dyn(v)))
        return self

    def cc(self, beat: float, number: int, value: float) -> None:
        self.cc_events.append((float(beat), number, value))

    def pedal(self, down: float, up: float) -> None:
        self.pedals.append((float(down), float(up)))

    def pedal_changes(self, beats: list[float], end: float) -> None:
        """Legato pedalling: re-pedal at each beat in `beats` (up just before, down just after)."""
        for a, b in zip(beats, list(beats[1:]) + [end]):
            self.pedals.append((a, b))

    # ---- rendering helpers ---------------------------------------------------------------
    def rng(self) -> random.Random:
        return random.Random(zlib.crc32(f"{self.cue.name}/{self.name}".encode()))

    def last_beat(self) -> float:
        ends = [n.beat + n.dur for n in self.notes]
        ends += [p[0] for p in self.dyn_pts] + [p[1] for p in self.pedals]
        return max(ends) if ends else 0.0


@dataclass
class Cue:
    name: str
    bpm: float
    meter: int = 4
    key: str = ""
    loop: bool = False
    bars: int = 0
    intensity: float = 0.5
    title: str = ""
    kind: str = "loop"                   # loop | oneshot | stinger
    tail_s: float = 8.0                  # rendered after the last event (one-shots) / folded (loops)
    target_lufs: float = -18.0
    rt60: float = 3.4
    predelay_ms: float = 32.0
    wet_db: float = -4.0
    ir_seed: int = 7
    ir_brightness: float = 0.5
    # bus compressor; threshold_db is relative to the target loudness (RMS dBFS ~ LUFS here)
    comp: dict = field(default_factory=lambda: dict(threshold_db=3.0, ratio=1.7, attack_ms=40.0, release_ms=500.0))
    master_eq: dict = field(default_factory=dict)
    leveler: dict | None = None          # optional slow compressor for long one-shots (see render.py)
    fade_out_s: float = 0.0              # one-shots: fade at the very end of the tail
    notes: str = ""                      # composer's notes (goes into QA report)
    qa_ok: list = field(default_factory=list)   # substrings of QA lines that are intentional

    def __post_init__(self):
        self.tempo = TempoMap(self.bpm)
        self.parts: dict[str, Part] = {}
        self.synths: list = []

    def part(self, name: str, preset: str, **kw) -> Part:
        p = Part(self, name, preset, **kw)
        self.parts[name] = p
        return p

    def add(self, layer) -> None:
        self.synths.append(layer)

    def sec(self, beat: float) -> float:
        return self.tempo.sec(beat)

    @property
    def length_beats(self) -> float:
        return float(self.bars * self.meter)

    def bar(self, n: int) -> float:
        """1-based bar number -> beat."""
        return float((n - 1) * self.meter)

    def loop_seconds(self) -> float:
        return self.sec(self.length_beats)

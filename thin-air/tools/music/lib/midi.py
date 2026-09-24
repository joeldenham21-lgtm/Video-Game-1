"""Minimal, dependency-free Standard MIDI File (type 1) writer.

Timing model: the whole score is converted to absolute SECONDS in Python (tempo maps, rubato and
humanisation are all resolved before writing). The file is written at a fixed 60 BPM with 1000 PPQ,
so one tick is exactly one millisecond. That keeps fluidsynth's rendering sample-predictable and lets
the mixer line every stem up without having to re-derive a tempo map.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

PPQ = 1000                 # ticks per quarter
TEMPO_US = 1_000_000       # 60 BPM -> 1 tick == 1 ms


def _vlq(n: int) -> bytes:
    """Variable-length quantity."""
    n = max(0, int(n))
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


@dataclass
class MidiTrack:
    channel: int = 0
    # (tick, order, bytes). order sorts simultaneous events: 0 bank/program, 1 CC, 2 note-off, 3 note-on
    events: list = field(default_factory=list)
    end_tick: int = 0

    def program(self, t: float, program: int, bank: int = 0) -> None:
        tick = _tick(t)
        ch = self.channel
        self.events.append((tick, 0, bytes([0xB0 | ch, 0, bank & 0x7F])))
        self.events.append((tick, 0, bytes([0xB0 | ch, 32, 0])))
        self.events.append((tick, 0, bytes([0xC0 | ch, program & 0x7F])))

    def cc(self, t: float, number: int, value: float) -> None:
        v = int(round(min(127, max(0, value))))
        self.events.append((_tick(t), 1, bytes([0xB0 | self.channel, number & 0x7F, v])))

    def pitch_bend(self, t: float, semis: float, bend_range: float = 2.0) -> None:
        v = int(round(8192 + 8191 * max(-1.0, min(1.0, semis / bend_range))))
        self.events.append((_tick(t), 1, bytes([0xE0 | self.channel, v & 0x7F, (v >> 7) & 0x7F])))

    def note(self, t: float, dur: float, pitch: int, vel: int) -> None:
        on = _tick(t)
        off = max(on + 1, _tick(t + dur))
        p = int(pitch) & 0x7F
        v = int(min(127, max(1, round(vel))))
        self.events.append((on, 3, bytes([0x90 | self.channel, p, v])))
        self.events.append((off, 2, bytes([0x80 | self.channel, p, 0])))

    def extend_to(self, t: float) -> None:
        self.end_tick = max(self.end_tick, _tick(t))

    def encode(self) -> bytes:
        evs = sorted(self.events, key=lambda e: (e[0], e[1]))
        data = bytearray()
        last = 0
        for tick, _o, msg in evs:
            data += _vlq(tick - last) + msg
            last = tick
        end = max(self.end_tick, last)
        data += _vlq(end - last) + b"\xFF\x2F\x00"
        return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def _tick(t: float) -> int:
    return int(round(max(0.0, t) * 1000.0))


def fix_overlaps(notes: list) -> list:
    """notes: list of (start_s, dur_s, pitch, vel). Same-pitch notes on one channel must not overlap
    (the first note-off would cut the second). Truncate the earlier note 2 ms before the later onset."""
    by_pitch: dict = {}
    for n in sorted(notes, key=lambda n: (n[2], n[0])):
        by_pitch.setdefault(n[2], []).append(list(n))
    out = []
    for lst in by_pitch.values():
        for a, b in zip(lst, lst[1:]):
            if a[0] + a[1] > b[0] - 0.002:
                a[1] = max(0.01, b[0] - 0.002 - a[0])
        out.extend(tuple(x) for x in lst)
    return sorted(out, key=lambda n: n[0])


def write_file(path: str, tracks: list) -> bytes:
    """Write a type-1 SMF: a conductor track (60 BPM) + the given MidiTracks. Returns the bytes."""
    conductor = bytearray()
    conductor += _vlq(0) + b"\xFF\x51\x03" + TEMPO_US.to_bytes(3, "big")
    conductor += _vlq(0) + b"\xFF\x58\x04" + bytes([4, 2, 24, 8])
    conductor += _vlq(0) + b"\xFF\x2F\x00"
    chunks = [b"MTrk" + struct.pack(">I", len(conductor)) + bytes(conductor)]
    chunks += [t.encode() for t in tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), PPQ)
    blob = header + b"".join(chunks)
    with open(path, "wb") as f:
        f.write(blob)
    return blob

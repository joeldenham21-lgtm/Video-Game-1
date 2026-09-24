"""Export a Cue as a readable multi-track MIDI score (for DAWs / notation software).

Unlike the render MIDI (seconds-based, humanised, one part per file) this is beat-based with the real
tempo map and time signature, one named track per part, notes exactly as composed. Numpy synth layers
are not representable and are listed in a text meta event instead.
"""
from __future__ import annotations

import struct

from midi import _vlq

PPQ = 480


def _track(events: list, name: str) -> bytes:
    """events: (tick, order, bytes)."""
    data = bytearray()
    nm = name.encode("ascii", "replace")[:60]
    data += _vlq(0) + b"\xFF\x03" + _vlq(len(nm)) + nm
    last = 0
    for tick, _o, msg in sorted(events, key=lambda e: (e[0], e[1])):
        data += _vlq(tick - last) + msg
        last = tick
    data += _vlq(0) + b"\xFF\x2F\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def export_score_midi(cue, path: str) -> None:
    tk = lambda beat: max(0, int(round(beat * PPQ)))  # noqa: E731
    cond = []
    # tempo map: steps, with ramps approximated every 1/4 beat
    pts = cue.tempo.points
    end_beat = max([cue.length_beats] + [p.last_beat() for p in cue.parts.values()])
    b = 0.0
    last_bpm = None
    while b <= end_beat:
        bpm = cue.tempo.bpm_at(b + 1e-6)
        if last_bpm is None or abs(bpm - last_bpm) > 0.05:
            us = int(round(60_000_000 / bpm))
            cond.append((tk(b), 0, b"\xFF\x51\x03" + us.to_bytes(3, "big")))
            last_bpm = bpm
        b += 0.25
    cond.append((0, 0, b"\xFF\x58\x04" + bytes([cue.meter, 2, 24, 8])))
    info = f"THIN AIR - {cue.title or cue.name} ({cue.key}). Original score. Synth layers: " + \
           ", ".join(type(s).__name__ + ":" + s.name for s in cue.synths)
    txt = info.encode("ascii", "replace")[:250]
    cond.append((0, 0, b"\xFF\x01" + _vlq(len(txt)) + txt))
    tracks = [_track(cond, cue.name)]
    ch_iter = iter([c for c in range(16) if c != 9])
    for name, p in cue.parts.items():
        ch = 9 if p.drum else next(ch_iter, 15)
        ev = [(0, 0, bytes([0xB0 | ch, 0, p.bank & 0x7F])), (0, 0, bytes([0xC0 | ch, p.program & 0x7F]))]
        if p.dyn_cc:
            dp = sorted(p.dyn_pts) or [(0.0, 78.0)]
            ev.append((0, 1, bytes([0xB0 | ch, p.dyn_cc, int(dp[0][1])])))
            for (b0, v0), (b1, v1) in zip(dp, dp[1:]):
                n = max(1, int((b1 - b0) * 4))
                for k in range(n + 1):
                    bb = b0 + (b1 - b0) * k / n
                    ev.append((tk(bb), 1, bytes([0xB0 | ch, p.dyn_cc, int(round(v0 + (v1 - v0) * k / n))])))
        for (down, up) in p.pedals:
            ev.append((tk(down) + 20, 1, bytes([0xB0 | ch, 64, 127])))
            ev.append((max(0, tk(up) - 10), 1, bytes([0xB0 | ch, 64, 0])))
        for n in p.notes:
            on, off = tk(n.beat), max(tk(n.beat) + 1, tk(n.beat + n.dur))
            v = int(max(1, min(127, round(n.vel))))
            ev.append((on, 3, bytes([0x90 | ch, n.pitch & 0x7F, v])))
            ev.append((off, 2, bytes([0x80 | ch, n.pitch & 0x7F, 0])))
        tracks.append(_track(ev, name))
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ)
    with open(path, "wb") as f:
        f.write(header + b"".join(tracks))

"""Score & audio QA. We cannot listen, so we check the note data like a copyist/orchestrator would and
look at pictures of the audio."""
from __future__ import annotations

import os
import subprocess

import numpy as np

from score import Cue
from theory import RANGES, name

PERC = {"perc", "timpani"}
# parts whose lines are compared pairwise for parallel perfect intervals
VOICE_FAMILIES = ("violin", "viola", "cello", "contrabass", "horn", "trombone", "tuba", "trumpet",
                  "choir", "choir_s", "choir_a", "choir_t", "choir_b", "flute", "clarinet", "oboe",
                  "english_horn", "bassoon")


def _line(part, use_top: bool):
    """Monophonic reduction: at each onset keep the top (or bottom) note of simultaneous notes."""
    by_beat: dict = {}
    for n in part.notes:
        k = round(n.beat, 4)
        by_beat.setdefault(k, []).append(n)
    out = []
    for b in sorted(by_beat):
        ns = by_beat[b]
        n = max(ns, key=lambda x: x.pitch) if use_top else min(ns, key=lambda x: x.pitch)
        out.append((b, b + n.dur, n.pitch))
    return out


def _pitch_at(line, beat):
    for (a, b, p) in line:
        if a <= beat + 1e-6 < b:
            return p
    return None


def check_score(cue: Cue) -> list[str]:
    rep: list[str] = []
    bar = lambda b: f"bar {int(b // cue.meter) + 1} beat {(b % cue.meter) + 1:g}"  # noqa: E731
    # 1) ranges
    for pn, part in cue.parts.items():
        lo, hi = RANGES.get(part.range_key, (0, 127))
        bad = [n for n in part.notes if not (lo <= n.pitch <= hi)]
        for n in bad[:6]:
            rep.append(f"RANGE {pn}: {name(n.pitch)} at {bar(n.beat)} outside {name(lo)}-{name(hi)}")
    # 2) parallel perfect fifths / octaves between sustained-instrument lines
    voices = [(pn, p) for pn, p in cue.parts.items()
              if p.qa_voice and p.range_key in VOICE_FAMILIES and p.notes]
    lines = {}
    for pn, p in voices:
        low = p.range_key in ("cello", "contrabass", "tuba", "bassoon", "choir_b", "trombone")
        lines[pn] = _line(p, use_top=not low)
    names = [v[0] for v in voices]

    def doubling(p, other, t):
        d = p.doubles
        if d is None:
            return False
        if isinstance(d, str):
            return d == other
        return any(nm == other and s <= t < e for (nm, s, e) in d)

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            pa, pb = cue.parts[a], cue.parts[b]
            la, lb = lines[a], lines[b]
            onsets = sorted({x[0] for x in la} | {x[0] for x in lb})
            prev = None
            for t in onsets:
                if doubling(pa, b, t) or doubling(pb, a, t):
                    prev = None
                    continue
                x, y = _pitch_at(la, t), _pitch_at(lb, t)
                if x is None or y is None:
                    prev = None
                    continue
                if prev:
                    px, py = prev
                    if px != x and py != y:
                        iv0, iv1 = abs(px - py) % 12, abs(x - y) % 12
                        if iv0 == iv1 and iv0 in (0, 7) and (x - px) * (y - py) > 0:
                            kind = "5ths" if iv0 == 7 else "8ves"
                            rep.append(f"PARALLEL {kind} {a}/{b} at {bar(t)}: "
                                       f"{name(px)}-{name(py)} -> {name(x)}-{name(y)}")
                prev = (x, y)
    # 2b) inner voices of chordal parts (choir / horn pairs / divisi): voice k = k-th lowest note of
    #     consecutive chords of equal size
    for pn, p in voices:
        by_beat: dict = {}
        for nn in p.notes:
            by_beat.setdefault(round(nn.beat, 4), []).append(nn.pitch)
        seq = [(b, sorted(v)) for b, v in sorted(by_beat.items())]
        for (b0, c0), (b1, c1) in zip(seq, seq[1:]):
            if len(c0) != len(c1) or len(c0) < 2:
                continue
            for i in range(len(c0)):
                for j in range(i + 1, len(c0)):
                    if c0[i] == c1[i] or c0[j] == c1[j]:
                        continue
                    iv0, iv1 = (c0[j] - c0[i]) % 12, (c1[j] - c1[i]) % 12
                    if iv0 == iv1 and iv0 in (0, 7) and (c1[i] - c0[i]) * (c1[j] - c0[j]) > 0:
                        rep.append(f"PARALLEL {'5ths' if iv0 == 7 else '8ves'} inside {pn} at {bar(b1)}: "
                                   f"{name(c0[i])}/{name(c0[j])} -> {name(c1[i])}/{name(c1[j])}")
    # 3) muddy low intervals (thirds with the lower note below C3, seconds below C4) across the
    #    tonal texture at every onset (percussion/pads/cluster-marked parts excluded)
    tonal = [p for p in cue.parts.values() if p.range_key not in PERC and p.range_key != "pad"
             and p.qa_voice]
    onsets = sorted({round(n.beat, 4) for p in tonal for n in p.notes})
    muddy = 0
    for t in onsets:
        sounding = sorted({n.pitch for p in tonal for n in p.notes if n.beat <= t + 1e-6 < n.beat + n.dur})
        for lo_p, hi_p in zip(sounding, sounding[1:]):
            iv = hi_p - lo_p
            if (iv in (3, 4) and lo_p < 48) or (iv in (1, 2) and lo_p < 60):
                muddy += 1
                if muddy <= 12:
                    rep.append(f"LOW-INTERVAL {name(lo_p)}-{name(hi_p)} at {bar(t)}")
    if muddy > 12:
        rep.append(f"LOW-INTERVAL ... {muddy} total")
    # 4) density: most simultaneous pitches and busiest bar (onsets)
    maxpoly, at = 0, 0.0
    for t in onsets:
        k = len({(n.pitch) for p in tonal for n in p.notes if n.beat <= t + 1e-6 < n.beat + n.dur})
        if k > maxpoly:
            maxpoly, at = k, t
    per_bar: dict = {}
    for p in cue.parts.values():
        for n in p.notes:
            per_bar[int(n.beat // cue.meter)] = per_bar.get(int(n.beat // cue.meter), 0) + 1
    busiest = max(per_bar.items(), key=lambda kv: kv[1]) if per_bar else (0, 0)
    total = sum(len(p.notes) for p in cue.parts.values())
    secs = cue.sec(cue.length_beats)
    empty = sum(1 for b in range(cue.bars) if per_bar.get(b, 0) == 0)
    rep.append(f"DENSITY max {maxpoly} distinct pitches at {bar(at)}; busiest bar {busiest[0] + 1} "
               f"({busiest[1]} onsets); {total} notes over {secs:.0f}s = {total / max(1, secs):.2f}/s; "
               f"bars without onsets: {empty}/{cue.bars}")
    out = []
    for line in rep:
        if any(s in line for s in cue.qa_ok):
            out.append("(ok) " + line)
        else:
            out.append(line)
    return out


def spectrogram(wav: str, png: str, title: str) -> None:
    subprocess.run(["sox", wav, "-n", "remix", "1,2", "spectrogram", "-o", png, "-x", "1400", "-y", "400",
                    "-z", "95", "-t", title], check=False, capture_output=True)


def envelope_png(x: np.ndarray, sr: int, png: str, marks: list[float] | None = None, title: str = "") -> None:
    """Short-term loudness-ish envelope (dB) with bar/section markers."""
    from PIL import Image, ImageDraw
    W, H = 1400, 260
    hop = max(1, len(x) // W)
    m = np.sqrt(np.mean((x[: hop * W] ** 2).reshape(W, hop, -1).mean(axis=2), axis=1) + 1e-12)
    pk = np.max(np.abs(x[: hop * W]).reshape(W, hop, -1).max(axis=2), axis=1) + 1e-12
    img = Image.new("RGB", (W, H), (18, 20, 24))
    d = ImageDraw.Draw(img)
    for dbv in (-12, -24, -36, -48, -60):
        y = int(-dbv / 66 * H)
        d.line([(0, y), (W, y)], fill=(40, 44, 52))
        d.text((2, y - 11), f"{dbv}", fill=(90, 96, 110))
    for i in range(W):
        yp = int(min(H, -20 * np.log10(pk[i]) / 66 * H))
        yr = int(min(H, -20 * np.log10(m[i]) / 66 * H))
        d.line([(i, H), (i, yp)], fill=(60, 90, 130))
        d.line([(i, H), (i, yr)], fill=(120, 180, 230))
    for t in marks or []:
        xx = int(t * sr / hop)
        if 0 <= xx < W:
            d.line([(xx, 0), (xx, H)], fill=(200, 120, 60))
    d.text((6, 4), title, fill=(230, 230, 230))
    img.save(png)


def seam_report(path_ogg: str) -> str:
    """Decode the OGG and compare the loop seam (last->first sample) with typical sample steps."""
    import tempfile
    from dsp import read_wav
    tmp = tempfile.mktemp(suffix=".wav", dir=os.path.dirname(path_ogg))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path_ogg, "-c:a", "pcm_f32le", tmp], check=True)
    sr, x = read_wav(tmp)
    os.remove(tmp)
    d = np.abs(np.diff(x, axis=0)).max(axis=1)
    seam = float(np.max(np.abs(x[0] - x[-1])))
    p999 = float(np.percentile(d, 99.9))
    # RMS continuity over 50 ms either side of the seam
    w = int(0.05 * sr)
    r_end = float(np.sqrt(np.mean(x[-w:] ** 2)))
    r_start = float(np.sqrt(np.mean(x[:w] ** 2)))
    return (f"seam step {seam:.5f} (99.9th pct step {p999:.5f}); rms end {20 * np.log10(r_end + 1e-12):.1f} dB "
            f"vs start {20 * np.log10(r_start + 1e-12):.1f} dB; samples {len(x)} @ {sr}")

#!/usr/bin/env python3
"""THIN AIR score - listening aids for people (and agents) who cannot listen.

    python3.12 thin-air/tools/music/analyze.py bands  [cue ...]        # octave-band balance of masters
    python3.12 thin-air/tools/music/analyze.py clicks <cue>            # broadband clicks: master + each stem
    python3.12 thin-air/tools/music/analyze.py section <cue> <b0> <b1> # per-part loudness in a beat window

Works on the renders cached by build.py (tools/music/_cache/<cue>_master.wav and stems), so run a
build first. 'bands' prints power per octave relative to 1 kHz (pink noise reads flat; orchestral
music typically falls away above 2 kHz), plus L/R correlation and side/mid ratio. 'clicks' flags
50 ms windows whose >9 kHz peak is far above the window median (note onsets of harp/timpani/taiko
show up in stems too - judge by the master line). 'section' approximates each part's level in the
mix (calibration + part gain, no EQ/pan) to spot a part that buries another.
"""
from __future__ import annotations

import importlib
import os
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, os.path.join(HERE, "cues"))

import dsp  # noqa: E402
import render  # noqa: E402

CACHE = os.path.join(HERE, "_cache")
BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


def load_cue(name: str):
    mod = importlib.import_module("stingers" if name.startswith("stinger_") else name)
    cues = mod.build_all() if hasattr(mod, "build_all") else [mod.build()]
    for c in cues:
        if c.name == name:
            return c
    raise SystemExit(f"unknown cue {name}")


def bands(names: list[str]) -> None:
    print(f"{'cue':20}" + "".join(f"{b:>7}" for b in BANDS) + "   corr  side/mid dB")
    for name in names:
        path = os.path.join(CACHE, f"{name}_master.wav")
        if not os.path.exists(path):
            print(f"{name:20} (no master in _cache - build it first)")
            continue
        sr, x = dsp.read_wav(path)
        f, p = signal.welch(x.mean(axis=1), fs=sr, nperseg=8192)
        lv = []
        for b in BANDS:
            sel = (f >= b / 2 ** 0.5) & (f < b * 2 ** 0.5)
            lv.append(10 * np.log10(p[sel].sum() + 1e-20))
        ref = lv[BANDS.index(1000)]
        corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1])
        side = np.mean(((x[:, 0] - x[:, 1]) / 2) ** 2)
        mid = np.mean(((x[:, 0] + x[:, 1]) / 2) ** 2) + 1e-20
        print(f"{name:20}" + "".join(f"{v - ref:7.1f}" for v in lv) + f"  {corr:5.2f} {10 * np.log10(side / mid):8.1f}")


def _scan(x: np.ndarray, sr: int, label: str, t_off: float = 0.0) -> None:
    m = x.mean(axis=1) if x.ndim == 2 else x
    h = np.abs(signal.sosfilt(signal.butter(4, 9000, "hp", fs=sr, output="sos"), m))
    w = int(0.05 * sr)
    k = len(h) // w
    blk = h[: k * w].reshape(k, w)
    pk, med = blk.max(axis=1), np.median(blk, axis=1) + 1e-9
    hits = [(i * w / sr - t_off, 20 * np.log10(pk[i] / med[i]), 20 * np.log10(pk[i]))
            for i in range(k) if pk[i] / med[i] > 30 and pk[i] > 1e-4]
    if hits:
        print(f"{label:14} " + " ".join(f"{t:.2f}s(+{r:.0f}dB, hf {a:.0f})" for t, r, a in hits[:10]))


def clicks(name: str) -> None:
    cue = load_cue(name)
    sr, x = dsp.read_wav(os.path.join(CACHE, f"{name}_master.wav"))
    _scan(x, sr, "MASTER")
    for pn, p in cue.parts.items():
        blob, _end, path = render.part_to_midi(p)
        _scan(render.fluid_render(path, blob), render.SR, pn, render.PRE)


def section(name: str, b0: float, b1: float) -> None:
    cue = load_cue(name)
    sr = render.SR
    i0 = int((render.PRE + cue.sec(b0)) * sr)
    i1 = int((render.PRE + cue.sec(b1)) * sr)
    rows = []
    for pn, p in cue.parts.items():
        blob, _end, path = render.part_to_midi(p)
        x = render.fluid_render(path, blob)[i0:i1] * dsp.db(render.calibration(p) + p.gain_db)
        if len(x) > sr and np.any(x):
            rows.append((dsp.lufs(x, sr), pn))
    n = int((render.PRE + cue.sec(cue.length_beats) + 20) * sr)
    loop_len = int(round(cue.loop_seconds() * sr)) if cue.loop else None
    for layer in cue.synths:
        x = layer.render(cue, sr, n, render.PRE, loop_len)[i0:i1] * dsp.db(layer.gain_db - 12.0)
        if np.any(x):
            rows.append((dsp.lufs(x, sr), layer.name + " (synth)"))
    print(f"{name} beats {b0:g}-{b1:g} ({cue.sec(b0):.1f}-{cue.sec(b1):.1f} s), approx. LUFS per part:")
    for lv, pn in sorted(rows, reverse=True):
        if lv > -69:
            print(f"   {pn:20} {lv:6.1f}")


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd, args = argv[0], argv[1:]
    if cmd == "bands":
        bands(args or [f[:-11] for f in sorted(os.listdir(CACHE)) if f.endswith("_master.wav")])
    elif cmd == "clicks" and args:
        clicks(args[0])
    elif cmd == "section" and len(args) == 3:
        section(args[0], float(args[1]), float(args[2]))
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""QA for every shipped sound: decodes the OGGs actually referenced by data/sfx.json and data/voice.json.

Checks: ffmpeg ebur128 integrated loudness + true peak (no clipping), channel layout (positional SFX mono,
ambience beds / prologue stereo), duration sanity, loop seam continuity (decoded end → start), and writes
sox spectrograms + per-category contact sheets for visual review.

  python3.12 thin-air/tools/audio/qa_audio.py [--out DIR] [--no-spectrograms]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib import aio, dsp  # noqa: E402

PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))


def channels(path: str) -> int:
	out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate",
		"-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip().split(",")
	return int(out[1]) if len(out) > 1 else int(out[0])


def check(args):
	res, loop, want_stereo, out_dir, spectro = args
	path = os.path.join(PROJECT, res[len("res://"):])
	r = {"file": res, "ok": True, "issues": []}
	if not os.path.exists(path):
		r["ok"] = False
		r["issues"].append("missing")
		return r
	ch = channels(path)
	x = aio.read_any(path, 44100, ch)
	r["channels"] = ch
	r["dur"] = round(len(x) / 44100.0, 2)
	e = aio.ebur128(path)
	r["I"], r["TP"] = e["I"], e["TP"]
	if e["TP"] is not None and e["TP"] > -0.5:
		r["issues"].append(f"true peak {e['TP']} dBTP")
	if want_stereo is True and ch != 2:
		r["issues"].append("expected stereo")
	if want_stereo is False and ch != 1:
		r["issues"].append("expected mono")
	if r["dur"] < 0.015 or r["dur"] > 240:
		r["issues"].append(f"duration {r['dur']}")
	if loop:
		m = x if x.ndim == 1 else x.mean(axis=1)
		seam = dsp.loop_seam_error(m)
		r["seam"] = round(seam, 2)
		# also compare short-term level across the seam (no audible bump)
		k = 4410
		a = float(np.sqrt(np.mean(m[-k:] ** 2)) + 1e-9)
		b = float(np.sqrt(np.mean(m[:k] ** 2)) + 1e-9)
		r["seam_level_db"] = round(20 * np.log10(b / a), 1)
		# event-based loops (waves, drips) may legitimately start an event at the loop point; only the
		# sample discontinuity matters there. Steady beds must also match in level across the seam.
		event_based = any(k in path for k in ("lake", "cave", "drip", "radio_static"))
		if seam > 4.0 or (not event_based and abs(r["seam_level_db"]) > 4.0):
			r["issues"].append(f"loop seam {seam:.1f} / {r['seam_level_db']} dB")
	if spectro:
		png = os.path.join(out_dir, os.path.basename(path).replace(".ogg", ".png"))
		aio.spectrogram_png(path, png, os.path.basename(path), 700, 220)
	r["ok"] = not r["issues"]
	return r


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--out", default="/tmp/thin-air-audio-qa")
	ap.add_argument("--no-spectrograms", action="store_true")
	a = ap.parse_args()
	os.makedirs(a.out, exist_ok=True)
	jobs = []
	sfx = json.load(open(os.path.join(PROJECT, "data", "sfx.json")))
	for sid, e in sfx.items():
		bed = e.get("category") == "bed"
		for f in e["files"]:
			jobs.append((f, bool(e.get("loop")), True if bed else (False if e.get("max_distance", 0) > 0 else None), a.out,
				not a.no_spectrograms))
	vpath = os.path.join(PROJECT, "data", "voice.json")
	if os.path.exists(vpath):
		for lid, e in json.load(open(vpath)).items():
			jobs.append((e["file"], False, True if lid == "prologue" else False, a.out, not a.no_spectrograms))
	with Pool(4) as p:
		results = p.map(check, jobs, chunksize=4)
	bad = [r for r in results if not r["ok"]]
	loud = [r["I"] for r in results if r.get("I") is not None]
	print(f"checked {len(results)} files, {len(bad)} with issues; loudness range {min(loud):.1f} .. {max(loud):.1f} LUFS; "
		f"max true peak {max(r['TP'] for r in results if r.get('TP') is not None):.2f} dBTP")
	for r in bad:
		print("ISSUE", r["file"], r["issues"])
	seams = [r for r in results if "seam" in r]
	if seams:
		print("loops:", ", ".join(f"{os.path.basename(r['file'])}={r['seam']}/{r['seam_level_db']}dB" for r in seams))
	with open(os.path.join(a.out, "qa_report.json"), "w") as f:
		json.dump(results, f, indent=1)
	print("report:", os.path.join(a.out, "qa_report.json"))


if __name__ == "__main__":
	main()

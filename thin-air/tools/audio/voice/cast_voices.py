#!/usr/bin/env python3
"""Voice casting analysis for piper's LibriTTS model (904 speakers).

Renders two test sentences per candidate speaker (one batch, model loaded once), then measures:
  F0 median (YIN), pitch range (semitone IQR), spectral centroid, tilt (low/high energy ratio),
  speaking rate (s per syllable proxy), harmonicity (voiced-frame YIN aperiodicity).
Writes tools/audio/_cache/casting.json and prints a table sorted by F0.

  python3.12 thin-air/tools/audio/voice/cast_voices.py [--n 90]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "_cache", "casting")
PIPER = "/opt/piper/piper/piper"
MODEL = "/opt/piper/en-us-libritts-high.onnx"

TEST = [
	"If you can hear me, the ranger cabin on Loon Lake has a radio. Channel six.",
	"We lost the satellite link at four in the morning, and nobody has come up the mountain since.",
]
SYLLABLES = 18 + 25


def yin(x: np.ndarray, sr: int, fmin=60.0, fmax=420.0, frame=0.04, hop=0.01, thresh=0.15):
	n = int(frame * sr)
	h = int(hop * sr)
	tau_min = int(sr / fmax)
	tau_max = int(sr / fmin)
	f0s, aper = [], []
	for s in range(0, len(x) - n - tau_max, h):
		fr = x[s:s + n + tau_max]
		if np.sqrt(np.mean(fr[:n] ** 2)) < 0.01:
			continue
		d = np.zeros(tau_max)
		for tau in range(1, tau_max):
			diff = fr[:n] - fr[tau:tau + n]
			d[tau] = np.dot(diff, diff)
		cm = d[1:] * np.arange(1, tau_max) / (np.cumsum(d[1:]) + 1e-12)
		cm = np.concatenate([[1.0], cm])
		cand = np.where(cm[tau_min:] < thresh)[0]
		if len(cand) == 0:
			continue
		t = cand[0] + tau_min
		while t + 1 < tau_max and cm[t + 1] < cm[t]:
			t += 1
		f0s.append(sr / t)
		aper.append(cm[t])
	return np.array(f0s), np.array(aper)


def analyse(path: str) -> dict:
	sr, x = wavfile.read(path)
	x = x.astype(np.float64) / 32768.0
	dur = len(x) / sr
	f0, ap = yin(x, sr)
	X = np.abs(np.fft.rfft(x * np.hanning(len(x))))
	f = np.fft.rfftfreq(len(x), 1 / sr)
	cen = float(np.sum(f * X) / np.sum(X))
	lo = float(np.sum(X[(f > 100) & (f < 1000)] ** 2))
	hi = float(np.sum(X[(f > 3000) & (f < 8000)] ** 2))
	return {
		"dur": dur,
		"f0": float(np.median(f0)) if len(f0) else 0.0,
		"f0_iqr_st": float(12 * np.log2(np.percentile(f0, 90) / np.percentile(f0, 10))) if len(f0) > 5 else 0.0,
		"centroid": cen,
		"tilt_db": float(10 * np.log10(lo / (hi + 1e-12))),
		"aper": float(np.median(ap)) if len(ap) else 1.0,
		"voiced": len(f0),
	}


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--n", type=int, default=90)
	ap.add_argument("--ids", default="")
	a = ap.parse_args()
	os.makedirs(CACHE, exist_ok=True)
	rng = np.random.default_rng(7)
	if a.ids:
		ids = [int(s) for s in a.ids.split(",")]
	else:
		ids = sorted(set([int(v) for v in list(range(0, 904, 904 // a.n)) + list(rng.integers(0, 904, a.n // 3))]))
	lines = []
	for sid in ids:
		out = os.path.join(CACHE, f"s{sid:03d}.wav")
		if not os.path.exists(out):
			lines.append(json.dumps({"text": " ".join(TEST), "speaker_id": sid, "output_file": out}))
	if lines:
		subprocess.run([PIPER, "--model", MODEL, "--json-input", "-q", "--sentence_silence", "0.3"],
			input="\n".join(lines) + "\n", text=True, check=True)
	res = {}
	for sid in ids:
		out = os.path.join(CACHE, f"s{sid:03d}.wav")
		m = analyse(out)
		m["rate"] = SYLLABLES / m["dur"]
		res[sid] = m
	with open(os.path.join(CACHE, "..", "casting.json"), "w") as f:
		json.dump(res, f, indent=1)
	print(f"{'id':>4} {'F0':>6} {'rangeST':>7} {'cent':>6} {'tilt':>6} {'aper':>5} {'syl/s':>6}")
	for sid, m in sorted(res.items(), key=lambda kv: kv[1]["f0"]):
		print(f"{sid:4d} {m['f0']:6.1f} {m['f0_iqr_st']:7.1f} {m['centroid']:6.0f} {m['tilt_db']:6.1f} {m['aper']:5.2f} {m['rate']:6.2f}")


if __name__ == "__main__":
	main()

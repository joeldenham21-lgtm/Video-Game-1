#!/usr/bin/env python3
"""Build every registered SFX/ambience asset and write thin-air/data/sfx.json.

Usage (from repo root; this container needs python3.12 for numpy):
  python3.12 thin-air/tools/audio/build_sfx.py                 # everything
  python3.12 thin-air/tools/audio/build_sfx.py --only step_snow,wolf_howl --preview /tmp/prev
  python3.12 thin-air/tools/audio/build_sfx.py --list

Deterministic: every variation is seeded from (id, index). Loudness is normalised per category (catalog.py).
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import time
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib import dsp, loud, aio, spec as specpng  # noqa: E402
from catalog import REG, CATEGORIES  # noqa: E402

PROJECT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA_JSON = os.path.join(PROJECT, "data", "sfx.json")
GEN_MODULES = ["gen.footsteps", "gen.human", "gen.tools", "gen.nature", "gen.fauna", "gen.birds", "gen.ui",
	"gen.machines", "gen.ambience"]


def load_generators():
	for m in GEN_MODULES:
		try:
			importlib.import_module(m)
		except ModuleNotFoundError as e:
			if e.name == m:
				continue
			raise


def res_path(spec, i: int) -> str:
	if spec.n == 1:
		name = f"{spec.id}.ogg"
	else:
		name = f"{spec.id}_{i + 1:02d}.ogg"
	sub = spec.folder
	return f"res://assets/audio/{sub}/{name}"


def abs_path(res: str) -> str:
	return os.path.join(PROJECT, res[len("res://"):])


def render_one(args):
	sid, i, preview = args
	load_generators()
	spec = REG[sid]
	cat = CATEGORIES[spec.cat]
	r = dsp.rng_for(sid, i)
	x = np.asarray(spec.fn(r, i), dtype=float)
	if spec.stereo and x.ndim == 1:
		x = dsp.to_stereo(x)
	if not spec.stereo and x.ndim == 2:
		x = np.mean(x, axis=1)
	x = dsp.dc_block(x) if not spec.loop else x - np.mean(x, axis=0)
	if not spec.loop:
		x = dsp.trim(x, -70.0, 0.001, 0.03)
		x = dsp.fade(x, 0.0005, 0.02)
	target = spec.target if spec.target is not None else cat["target"]
	mode = cat["mode"] if not spec.loop else "integrated"
	dur = len(x) / dsp.SR
	if mode == "momentary" and dur < 0.45:
		mode = "short"
	if mode == "integrated" and dur < 1.0:
		mode = "momentary"
	# Vorbis overshoots noise-like material by ~1.5 dB: keep more headroom on loops/beds
	ceiling = -2.5 if (spec.loop or spec.stereo) else -1.0
	y = loud.normalize_loudness(x, target, mode, ceiling, 6.0 if spec.loop else 3.0)
	out = abs_path(res_path(spec, i))
	aio.write_ogg(out, y, spec.quality)
	stats = {
		"id": sid, "i": i, "file": res_path(spec, i), "dur": round(dur, 3),
		"lufs_i": round(loud.integrated_lufs(y), 1), "lufs_m": round(loud.momentary_max_lufs(y), 1),
		"tp": round(loud.true_peak_db(y), 2),
	}
	if spec.loop:
		stats["seam"] = round(dsp.loop_seam_error(y), 2)
	if preview:
		os.makedirs(preview, exist_ok=True)
		wav = os.path.join(preview, f"{sid}_{i + 1:02d}.wav")
		aio.write_wav(wav, y, bits=16)
		specpng.render(y, os.path.join(preview, f"{sid}_{i + 1:02d}.png"), f"{sid} {i + 1}",
			width=min(1100, max(420, int(dur * 600))), height=200)
	return stats


def entry_for(spec) -> dict:
	cat = CATEGORIES[spec.cat]
	e = {
		"files": [res_path(spec, i) for i in range(spec.n)],
		"bus": cat["bus"],
		"volume_db": 0.0,
		"pitch_var": cat["pitch_var"],
		"max_distance": cat["max_distance"],
		"unit_size": cat["unit_size"],
		"loop": spec.loop,
		"cooldown": cat["cooldown"],
		"max_voices": cat["max_voices"],
		"category": spec.cat,
	}
	for k, v in spec.meta.items():
		e[k] = v
	return e


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--only", default="")
	ap.add_argument("--preview", default="")
	ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2)))
	ap.add_argument("--list", action="store_true")
	ap.add_argument("--no-json", action="store_true")
	a = ap.parse_args()
	load_generators()
	if a.list:
		for sid, s in sorted(REG.items()):
			print(f"{sid:28s} n={s.n:2d} cat={s.cat:10s} loop={s.loop} stereo={s.stereo}")
		return
	ids = sorted(REG) if not a.only else [s.strip() for s in a.only.split(",") if s.strip()]
	for sid in ids:
		if sid not in REG:
			sys.exit(f"unknown id {sid}")
	jobs = [(sid, i, a.preview) for sid in ids for i in range(REG[sid].n)]
	t0 = time.time()
	with Pool(a.jobs) as p:
		results = p.map(render_one, jobs, chunksize=1)
	bad = 0
	for s in results:
		flag = ""
		if s["tp"] > -0.9:
			flag += " PEAK!"
			bad += 1
		if "seam" in s and s["seam"] > 4.0:
			flag += " SEAM!"
		print(f"{s['id']:26s} {s['i'] + 1:2d} {s['dur']:6.2f}s  I={s['lufs_i']:6.1f}  M={s['lufs_m']:6.1f}  TP={s['tp']:6.2f}"
			+ (f"  seam={s['seam']}" if "seam" in s else "") + flag)
	print(f"rendered {len(results)} files in {time.time() - t0:.1f}s, {bad} peak warnings")
	if a.no_json:
		return
	data = {}
	if os.path.exists(DATA_JSON):
		with open(DATA_JSON) as f:
			data = json.load(f)
	for sid in ids:
		data[sid] = entry_for(REG[sid])
	# drop entries whose generator no longer exists
	for sid in list(data):
		if sid not in REG:
			del data[sid]
	os.makedirs(os.path.dirname(DATA_JSON), exist_ok=True)
	with open(DATA_JSON, "w") as f:
		json.dump(dict(sorted(data.items())), f, indent=1)
		f.write("\n")
	print("wrote", DATA_JSON, len(data), "ids")


if __name__ == "__main__":
	main()

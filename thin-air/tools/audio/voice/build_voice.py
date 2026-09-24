#!/usr/bin/env python3
"""Render every voice line in voice/script.py with piper (LibriTTS, CC BY 4.0), process it for its medium
(radio / weak beacon / dictaphone / cockpit intercom / in person / automated weather), normalise to
-18 LUFS, and write assets/audio/voice/*.ogg + data/voice.json + data/logs.json. Also builds the complete
prologue scene (voice/prologue.py).

  python3.12 thin-air/tools/audio/voice/build_voice.py [--only id1,id2 [--with-prologue]] [--preview DIR] [--no-prologue]

TTS renders are cached in tools/audio/_cache/tts (keyed by speaker, settings and text).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, TOOLS)

from lib import dsp, loud, aio, voicefx as VF, spec as specpng  # noqa: E402
from lib.dsp import SR, ns, place  # noqa: E402
from voice import script as S  # noqa: E402

PROJECT = os.path.abspath(os.path.join(TOOLS, "..", ".."))
OUT_DIR = os.path.join(PROJECT, "assets", "audio", "voice")
CACHE = os.path.join(TOOLS, "_cache", "tts")
PIPER = "/opt/piper/piper/piper"
MODEL = "/opt/piper/en-us-libritts-high.onnx"

# Casting (see docs/audio_notes.md): LibriTTS speaker index + delivery settings.
CAST = {
	"dale": {"sid": 432, "length": 1.08, "noise": 0.62, "noise_w": 0.75, "female": False},
	"dispatch": {"sid": 620, "length": 0.98, "noise": 0.6, "noise_w": 0.7, "female": True},
	"mara": {"sid": 240, "length": 1.05, "noise": 0.7, "noise_w": 0.85, "female": True},
	"hale": {"sid": 738, "length": 1.12, "noise": 0.62, "noise_w": 0.8, "female": False},
	"reyes": {"sid": 402, "length": 0.96, "noise": 0.72, "noise_w": 0.85, "female": False},
	"park": {"sid": 850, "length": 1.0, "noise": 0.68, "noise_w": 0.8, "female": True},
	"burke": {"sid": 800, "length": 1.06, "noise": 0.62, "noise_w": 0.7, "female": False},
	"rescue": {"sid": 750, "length": 1.0, "noise": 0.55, "noise_w": 0.7, "female": False},
	"heli": {"sid": 20, "length": 0.98, "noise": 0.55, "noise_w": 0.7, "female": False},
	"awos": {"sid": 500, "length": 1.12, "noise": 0.25, "noise_w": 0.3, "female": False},
}
# Slower, more careful delivery for the heavy moments.
PACE = {"log_hale_03": 1.12, "log_park_03": 1.08, "mara_owen_found": 1.08, "mara_hale_found": 1.1,
	"mara_ending": 1.1, "mara_last_night": 1.06, "pro_22": 1.05, "log_voss_04": 1.04, "mara_ice_cave": 1.06}
TARGET = {"radio": -18.0, "radio_weak": -19.0, "dictaphone": -18.0, "in_person": -18.0, "cockpit": -18.0,
	"radio_tx": -18.0, "awos": -20.0}
QUALITY = 2.6


def split_say(s: str) -> tuple[str, str]:
	if "|" in s:
		d, say = s.split("|", 1)
		return d.strip(), say.strip()
	return s.strip(), s.strip()


def clean_tts(s: str) -> str:
	s = s.replace("—", ", ").replace("…", ". ").replace("’", "'").replace("‘", "'")
	s = re.sub(r"\s+", " ", s)
	return s.strip()


def tts_key(spk: str, pace: float, say: str) -> str:
	c = CAST[spk]
	h = hashlib.sha1(f"{c['sid']}|{c['length'] * pace:.3f}|{c['noise']}|{c['noise_w']}|{say}".encode()).hexdigest()[:16]
	return os.path.join(CACHE, spk, f"{h}.wav")


def iter_utterances(line):
	for p in line["parts"]:
		if isinstance(p, str):
			yield line["speaker"], p
		elif p[0] == "say":
			yield p[1], p[2]


def render_tts(lines) -> None:
	groups: dict = {}
	for line in lines:
		pace = PACE.get(line["id"], 1.0)
		for spk, text in iter_utterances(line):
			_, say = split_say(text)
			say = clean_tts(say)
			path = tts_key(spk, pace, say)
			if not os.path.exists(path):
				groups.setdefault((spk, pace), []).append((say, path))
	# one piper process per chunk of ~12 sentences, several in parallel (piper itself is mostly single-threaded)
	chunks = []
	for (spk, pace), jobs in groups.items():
		os.makedirs(os.path.join(CACHE, spk), exist_ok=True)
		for k in range(0, len(jobs), 12):
			chunks.append((spk, pace, jobs[k:k + 12]))

	def run(chunk):
		spk, pace, jobs = chunk
		c = CAST[spk]
		payload = "\n".join(json.dumps({"text": s, "speaker_id": c["sid"], "output_file": p + ".part"}) for s, p in jobs) + "\n"
		print(f"piper: {spk} x{len(jobs)} (pace {pace})", flush=True)
		subprocess.run([PIPER, "--model", MODEL, "--json-input", "-q", "--length_scale", f"{c['length'] * pace:.3f}",
			"--noise_scale", str(c["noise"]), "--noise_w", str(c["noise_w"]), "--sentence_silence", "0.32"],
			input=payload, text=True, check=True, capture_output=True)
		for _, p in jobs:          # atomic: an interrupted render never leaves a truncated cache entry
			if os.path.exists(p + ".part"):
				os.replace(p + ".part", p)

	from concurrent.futures import ThreadPoolExecutor
	with ThreadPoolExecutor(max_workers=max(1, min(4, os.cpu_count() or 1))) as ex:
		list(ex.map(run, chunks))


def load_tts(spk: str, pace: float, text: str) -> np.ndarray:
	_, say = split_say(text)
	sr, x = wavfile.read(tts_key(spk, pace, clean_tts(say)))
	x = x.astype(np.float64) / 32768.0
	return VF.trim_tts(VF.to44k(x, sr))


def gap_after(text: str, r) -> float:
	t = text.rstrip()
	base = 0.5 if t.endswith("?") else 0.42 if t.endswith(".") or t.endswith("!") else 0.28
	return base + 0.12 * (r.random() - 0.5)


# ------------------------------------------------------------------------------------------------ assembly

def build_timeline(line, r):
	"""Returns items: [{type: speech|click|drop|breath, t, d, spk, audio?, text?, n?}], total length."""
	pace = PACE.get(line["id"], 1.0)
	items = []
	t = 0.35
	prev_text = None
	pending_breath = False
	after_event = False
	for p in line["parts"]:
		if isinstance(p, str) or p[0] == "say":
			spk, text = (line["speaker"], p) if isinstance(p, str) else (p[1], p[2])
			disp, _ = split_say(text)
			a = load_tts(spk, pace, text)
			if prev_text is not None and not after_event:
				t += gap_after(prev_text, r)
			elif after_event:
				t += 0.12
			if pending_breath:
				b = VF.breath(r, CAST.get(spk, {}).get("female", False), 1.0, 0.34)
				items.append({"type": "breath", "t": max(0.0, t - 0.08), "d": 0.34, "spk": spk, "audio": b})
				t += 0.3
				pending_breath = False
			items.append({"type": "speech", "t": t, "d": len(a) / SR, "spk": spk, "audio": a, "text": disp})
			t += len(a) / SR
			prev_text = disp
			after_event = False
		elif p[0] == "pause":
			t += float(p[1])
			after_event = True
		elif p[0] == "breath":
			pending_breath = True
		elif p[0] == "click":
			t += 0.55
			items.append({"type": "click", "t": t, "n": int(p[1]), "d": 0.3 * int(p[1])})
			t += 0.3 * int(p[1]) + 0.25
			after_event = True
		elif p[0] == "drop":
			items.append({"type": "drop", "t": t, "d": float(p[1])})
			t += float(p[1])
			after_event = True
	return items, t + 0.6


def transmissions(items):
	"""Group speech into radio transmissions: a new one after a click exchange, a pause > 1.4 s, or a speaker change."""
	tx = []
	cur = None
	last_end = -10.0
	last_spk = None
	for it in items:
		if it["type"] == "click":
			cur = None
			continue
		if it["type"] not in ("speech", "drop", "breath"):
			continue
		spk = it.get("spk", last_spk)
		if cur is None or it["t"] - last_end > 1.4 or (it["type"] == "speech" and spk != cur["spk"]):
			cur = {"spk": spk, "t0": it["t"], "t1": it["t"] + it["d"], "items": []}
			tx.append(cur)
		cur["items"].append(it)
		cur["t1"] = max(cur["t1"], it["t"] + it["d"])
		last_end = cur["t1"]
		if it["type"] == "speech":
			last_spk = spk
	return tx


def clicks_audio(r, n: int) -> np.ndarray:
	out = dsp.zeros(0.3 * n + 0.1)
	for k in range(n):
		place(out, VF.ptt_click(r, 0.9), 0.3 * k)
		place(out, VF.ptt_click(r, 0.5), 0.3 * k + 0.12 + 0.03 * r.random())
	return out


def process_line(line, r, engine=None):
	kind = line["kind"]
	items, total = build_timeline(line, r)
	n = ns(total + 1.0)
	out = np.zeros(n)
	if kind in ("radio", "radio_weak", "awos"):
		weak = {"radio": 0.0, "radio_weak": 0.65, "awos": 0.45}[kind]
		for tx in transmissions(items):
			spk = tx["spk"]
			t0 = tx["t0"] - 0.12
			L = ns(tx["t1"] - t0 + 0.12)
			dry = np.zeros(L)
			drops = []
			for it in tx["items"]:
				if it["type"] in ("speech", "breath"):
					a = it["audio"] if it["type"] == "speech" else it["audio"] * 0.02
					if kind == "awos" and it["type"] == "speech":
						a = VF.awos_voice(a, r)
					place(dry, a, it["t"] - t0)
				elif it["type"] == "drop":
					drops.append((it["t"] - t0, it["d"]))
			w = weak
			if spk in ("rescue", "heli") and kind == "radio":
				w = 0.25
			if spk == "dispatch" and kind == "radio":
				w = 0.15
			proc = VF.radio_voice(dry, r, w, dropouts=drops)
			lvl = np.std(proc) + 1e-9
			seg = np.zeros(L + ns(0.4))
			place(seg, VF.squelch_open(r, lvl * 1.6), 0)
			place(seg, proc, ns(0.05))
			place(seg, VF.squelch_tail(r, lvl * 1.8), L + ns(0.02))
			place(out, seg, t0 - 0.05)
		for it in items:
			if it["type"] == "click":
				c = clicks_audio(r, it["n"])
				place(out, c * np.std(out[out != 0]) * 6 if np.any(out) else c * 0.1, it["t"])
	else:
		dry = np.zeros(n)
		for it in items:
			if it["type"] == "speech":
				place(dry, it["audio"], it["t"])
			elif it["type"] == "breath":
				place(dry, it["audio"] * 0.035, it["t"])
		if kind == "dictaphone":
			out = VF.dictaphone(dry, r, wind=float(line.get("wind", 0.0)), cave=float(line.get("cave", 0.0)))
			shift = 0.45     # dictaphone lead-in
			for it in items:
				it["t"] += shift
		elif kind == "in_person":
			out = VF.in_person(dry, r)
		elif kind in ("cockpit", "radio_tx"):
			out = VF.intercom_voice(dry, r)
			if kind == "radio_tx":
				place(out, VF.ptt_click(r, 0.05), max(0.0, items[0]["t"] - 0.15))
	# trim trailing silence only (the timeline stays exact for subtitles)
	a = np.abs(out)
	idx = np.where(a > np.max(a) * 0.0005)[0]
	if len(idx):
		out = dsp.fade(out[:min(len(out), idx[-1] + ns(0.3))], 0.0, 0.05)
	return out, items, kind


def segments_for(items, line, total: float):
	segs = []
	for it in items:
		if it["type"] == "speech":
			segs.append({"t": round(it["t"], 3), "d": round(it["d"], 3), "text": it["text"],
				"speaker": S.SPEAKERS[it["spk"]]["name"]})
		elif it["type"] == "click":
			segs.append({"t": round(it["t"], 3), "d": 1.0, "speaker": "Sam",
				"text": "[keys the radio]" if it["n"] == 1 else "[keys the radio twice]"})
	# subtitle duration: audio + hold, readable, not running into the next caption
	for k, s in enumerate(segs):
		nxt = segs[k + 1]["t"] if k + 1 < len(segs) else total
		want = max(s["d"] + 0.6, len(s["text"]) / 17.0)
		s["d"] = round(max(0.8, min(want, nxt - s["t"] - 0.05 if nxt - s["t"] > 0.9 else want)), 2)
	return segs


def full_text(line) -> str:
	out = []
	for p in line["parts"]:
		if isinstance(p, str):
			out.append(split_say(p)[0])
		elif p[0] == "say":
			out.append(f"{S.SPEAKERS[p[1]]['name']}: {split_say(p[2])[0]}")
		elif p[0] == "click":
			out.append("[keys the radio]" if p[1] == 1 else "[keys the radio twice]")
	return " ".join(out)


def build_one(args):
	line, preview = args
	r = dsp.rng_for("voice", line["id"])
	x, items, kind = process_line(line, r)
	y = loud.normalize_loudness(x, TARGET[kind], "integrated", -1.0, 2.0)
	path = os.path.join(OUT_DIR, f"{line['id']}.ogg")
	y = y * aio.write_ogg_checked(path, y, QUALITY, -1.0)
	dur = len(y) / SR
	segs = segments_for(items, line, dur)
	if preview:
		os.makedirs(preview, exist_ok=True)
		aio.write_wav(os.path.join(preview, f"{line['id']}.wav"), y, bits=16)
		specpng.render(y, os.path.join(preview, f"{line['id']}.png"), line["id"], min(1400, int(dur * 60) + 300), 180)
	return {"id": line["id"], "file": f"res://assets/audio/voice/{line['id']}.ogg", "speaker": S.SPEAKERS[line["speaker"]]["name"],
		"speaker_id": line["speaker"], "text": full_text(line), "radio": kind in ("radio", "radio_weak", "awos"),
		"kind": kind, "duration_s": round(dur, 2), "segments": segs,
		"lufs": round(loud.integrated_lufs(y), 1), "tp": round(loud.true_peak_db(y), 1)}


def _first_onset(y: np.ndarray) -> float:
	env = dsp.rms_envelope(y, 0.02)
	thr = np.max(env) * 0.12
	idx = np.where(env > thr)[0]
	return idx[0] / SR if len(idx) else 0.0


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--only", default="")
	ap.add_argument("--preview", default="")
	ap.add_argument("--no-prologue", action="store_true")
	ap.add_argument("--with-prologue", action="store_true", help="also rebuild the prologue scene with --only")
	ap.add_argument("--jobs", type=int, default=4)
	a = ap.parse_args()
	lines = S.LINES
	if a.only:
		want = set(a.only.split(","))
		lines = [l for l in lines if l["id"] in want]
	render_tts(S.LINES if not a.only else lines)
	os.makedirs(OUT_DIR, exist_ok=True)
	with Pool(a.jobs) as p:
		results = p.map(build_one, [(l, a.preview) for l in lines], chunksize=1)
	vj_path = os.path.join(PROJECT, "data", "voice.json")
	data = {}
	if os.path.exists(vj_path):
		with open(vj_path) as f:
			data = json.load(f)
	for res in results:
		print(f"{res['id']:22s} {res['kind']:10s} {res['duration_s']:6.1f}s  I={res['lufs']:6.1f}  TP={res['tp']:5.1f}")
		res = dict(res)
		res.pop("lufs")
		res.pop("tp")
		rid = res.pop("id")
		data[rid] = res
	if (not a.no_prologue and not a.only) or a.with_prologue:
		from voice import prologue
		data["prologue"] = prologue.build(a.preview)
		print("prologue", data["prologue"]["duration_s"], "s")
	valid = {l["id"] for l in S.LINES} | {"prologue"}
	data = {k: v for k, v in data.items() if k in valid}
	with open(vj_path, "w") as f:
		json.dump(dict(sorted(data.items())), f, indent=1, ensure_ascii=False)
		f.write("\n")
	write_logs(data)
	print("wrote", vj_path, len(data), "lines")


def write_logs(voice: dict) -> None:
	logs = {}
	by_id = {l["id"]: l for l in S.LINES}
	for lid, L in S.LOGS.items():
		e = {"title": L["title"], "author": L["author"], "date": L["date"], "voice": L.get("voice"),
			"location_hint": L.get("location_hint", "")}
		if L.get("voice"):
			line = by_id[L["voice"]]
			paras = []
			cur = []
			for p in line["parts"]:
				if isinstance(p, str):
					cur.append(split_say(p)[0])
				elif p[0] == "pause" and p[1] >= 0.6 and cur:
					paras.append(" ".join(cur))
					cur = []
			if cur:
				paras.append(" ".join(cur))
			e["text"] = "\n\n".join(paras)
			e["kind"] = "recording"
		else:
			e["text"] = L["text"]
			e["kind"] = "document"
		logs[lid] = e
	with open(os.path.join(PROJECT, "data", "logs.json"), "w") as f:
		json.dump(logs, f, indent=1, ensure_ascii=False)
		f.write("\n")


if __name__ == "__main__":
	main()

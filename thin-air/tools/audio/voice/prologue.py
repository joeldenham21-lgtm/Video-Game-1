"""The prologue as one continuous stereo scene (black screen, audio only): cockpit of the DHC-3 Otter heard
through Sam's headset — the R-1340 radial, slipstream, Dale on the intercom, Terrace Dispatch on the radio —
then induction icing, rough running, backfires, the engine quitting, a windmilling prop, restart attempts,
the mayday, the stall horn and the forced landing into timber.

Built by build_voice.py → assets/audio/voice/prologue.ogg + voice.json["prologue"] (segments carry speakers).
"""
from __future__ import annotations

import math
import os

import numpy as np

from lib import dsp, loud, aio, voicefx as VF, models as M, spec as specpng
from lib.dsp import SR, ns, place, tvec
from voice import script as S

# (line id, gap before it in seconds)
SEQUENCE = [
	("pro_01", 3.2), ("pro_02", 2.2), ("pro_03", 1.0), ("pro_04", 0.8), ("pro_05", 1.1), ("pro_06", 0.9),
	("pro_07", 1.3), ("pro_08", 1.2), ("pro_09", 4.5), ("pro_10", 8.0), ("pro_11", 2.8), ("pro_12", 2.2),
	("pro_13", 1.0), ("pro_14", 0.8), ("pro_15", 4.0), ("pro_16", 3.2), ("pro_17", 1.4), ("pro_18", 1.6),
	("pro_19", 1.0), ("pro_20", 2.6), ("pro_21", 3.0), ("pro_22", 4.2),
]


def _voice(line, r):
	from voice.build_voice import build_timeline, transmissions
	items, total = build_timeline(line, r)
	n = ns(total + 0.6)
	dry = np.zeros(n)
	for it in items:
		if it["type"] == "speech":
			place(dry, it["audio"], it["t"])
	kind = line["kind"]
	if kind in ("cockpit", "radio_tx"):
		out = VF.intercom_voice(dry, r)
		if kind == "radio_tx":
			place(out, VF.ptt_click(r, 0.04), max(0.0, items[0]["t"] - 0.12))
		return out, items
	weak = 0.65 if kind == "radio_weak" else 0.15
	out = np.zeros(n + ns(0.5))
	for tx in transmissions(items):
		t0 = tx["t0"] - 0.1
		L = ns(tx["t1"] - t0 + 0.1)
		seg_dry = np.zeros(L)
		drops = []
		for it in tx["items"]:
			if it["type"] == "speech":
				place(seg_dry, it["audio"], it["t"] - t0)
			elif it["type"] == "drop":
				drops.append((it["t"] - t0, it["d"]))
		proc = VF.radio_voice(seg_dry, r, weak, dropouts=drops)
		lvl = np.std(proc) + 1e-9
		seg = np.zeros(L + ns(0.4))
		place(seg, VF.squelch_open(r, lvl * 1.4), 0)
		place(seg, proc, ns(0.05))
		place(seg, VF.squelch_tail(r, lvl * 1.6), L + ns(0.02))
		place(out, seg, max(0.0, t0 - 0.05))
	return out, items


def _curve(t: np.ndarray, pts) -> np.ndarray:
	return np.interp(t, [p[0] for p in pts], [p[1] for p in pts])


def engine_track(r, dur: float, ev: dict):
	"""Time-varying R-1340 + prop + slipstream, stereo, as heard inside the cabin through a headset."""
	n = ns(dur)
	t = tvec(n)
	T_rough, T_power, T_quit = ev["rough"], ev["power"], ev["quit"]
	T_hit = ev["hit"]
	rpm = _curve(t, [(0, 2000), (T_rough, 2000), (T_power, 1880), (T_quit - 1.0, 1650), (T_quit + 2.5, 1150),
		(T_hit - 6, 1000), (T_hit, 850), (T_hit + 0.3, 0), (dur, 0)])
	power = _curve(t, [(0, 0.0), (2.5, 1.0), (T_rough, 1.0), (T_power, 0.85), (T_quit - 1.0, 0.45), (T_quit, 0.0), (dur, 0.0)])
	misfire = _curve(t, [(0, 0.0), (T_rough, 0.0), (T_rough + 6, 0.06), (T_power, 0.18), (T_quit - 1.0, 0.5), (T_quit, 1.0), (dur, 1.0)])
	airspeed = _curve(t, [(0, 0.0), (2.5, 1.0), (T_quit, 1.0), (T_quit + 4, 0.95), (T_hit - 4, 1.05), (T_hit - 1.2, 0.8), (T_hit, 0.7), (T_hit + 0.2, 0.0), (dur, 0.0)])
	# restart coughs: brief catches when Dale primes and switches mags
	for tc in ev.get("coughs", []):
		k = (t > tc) & (t < tc + 0.6)
		power = np.where(k, np.maximum(power, 0.7 * np.exp(-((t - tc - 0.25) / 0.2) ** 2)), power)
		misfire = np.where(k, 0.45, misfire)
		rpm = np.where(k, rpm + 250 * np.exp(-((t - tc - 0.3) / 0.25) ** 2), rpm)
	# firing pulses (9 cylinders, 4-stroke: 4.5 firings per revolution)
	pulses = np.zeros(n + ns(0.02))
	pulse = np.exp(-np.arange(ns(0.006)) / ns(0.0015))
	tt = 0.0
	backfires = []
	while tt < dur:
		i = int(tt * SR)
		if i >= n:
			break
		rp = rpm[i]
		if rp < 200:
			tt += 0.01
			continue
		if power[i] > 0.01 and r.random() > misfire[i]:
			place(pulses, pulse * power[i] * (1 + 0.08 * r.standard_normal()), i)
		elif power[i] > 0.05 and misfire[i] > 0.1 and r.random() < 0.012:
			backfires.append(tt)
		tt += 1.0 / (rp / 60.0 * 4.5)
	pulses = pulses[:n]
	exhaust = dsp.lp(pulses, 1300, 2) * 1.6
	exhaust = dsp.resonator_bank(exhaust, [95.0, 190.0, 310.0], [0.12, 0.08, 0.05], [1.0, 0.5, 0.3]) + exhaust * 0.6
	# propeller: geared 2:3, 3 blades → BPF = rpm/60 * 2/3 * 3
	bpf = rpm / 60.0 * 2.0
	ph = dsp.phase_from_f(bpf)
	prop_amp = 0.25 + 0.75 * np.clip(power + 0.3 * (rpm > 300), 0, 1)
	prop = sum(np.sin(h * ph + h) / h for h in range(1, 9)) * 0.45 * prop_amp * (rpm > 300)
	out = np.zeros((n, 2))
	for c in range(2):
		slip = dsp.lp(dsp.pink(n, r), 900) * airspeed ** 2 * 0.45
		slip += dsp.bp(dsp.pink(n, r), 1200, 4000) * airspeed ** 3 * 0.06
		out[:, c] = exhaust + prop + slip
	for tb in backfires:
		b = dsp.lp(dsp.click(r, 0.02, 60, 3000, 1.0), 1800) * 2.5
		place(out[:, 0], b, tb)
		place(out[:, 1], b * 0.9, tb + 0.0004)
	# cabin rattles
	for tr in dsp.poisson_times(dur, 0.25, r):
		g = M.gear_rattle(r, 0.3, 0.6) * 0.05
		place(out[:, int(r.random() * 2)], g, float(tr))
	# headset: passive cups roll off the highs and much of the level
	for c in range(2):
		out[:, c] = dsp.lp(out[:, c], 2600, 2)
	return out


def build(preview: str = "") -> dict:
	r = dsp.rng_for("prologue")
	by_id = {l["id"]: l for l in S.LINES}
	placed = []
	t = 0.0
	for lid, gap in SEQUENCE:
		t += gap
		audio, items = _voice(by_id[lid], r)
		placed.append((lid, t, audio, items))
		t += len(audio) / SR - 0.35
	start = {lid: t0 for lid, t0, _, _ in placed}
	end = {lid: t0 + len(a) / SR for lid, t0, a, _ in placed}
	brace_t = start["pro_22"]
	crash_start = brace_t - 1.2
	t_hit = crash_start + 3.5        # main impact inside plane_crash
	ev = {"rough": end["pro_09"] + 4.0, "power": start["pro_12"], "quit": end["pro_15"] + 0.8, "hit": t_hit,
		"coughs": [start["pro_16"] + 3.0, start["pro_16"] + 4.6, end["pro_17"] + 0.4]}
	dur = t_hit + 9.0
	mix = engine_track(r, dur, ev) * 0.22
	# crash sequence (stall horn, trees, impact, slide, ticking)
	from gen.machines import plane_crash
	crash = plane_crash(dsp.rng_for("plane_crash", 7), 0)
	crash = dsp.reverb(crash, dsp.make_ir(1.2, r, 0.01, 6000, 2000, stereo=True, early=[(0.03, 0.3)]), 0.25)
	place(mix, crash * 0.9, crash_start)
	segs = []
	for lid, t0, audio, items in placed:
		st = np.stack([audio, audio], axis=1)
		place(mix, st * 0.55, t0)
		for it in items:
			if it["type"] == "speech":
				segs.append({"t": round(t0 + it["t"], 3), "d": round(it["d"] + 0.6, 2), "text": it["text"],
					"speaker": S.SPEAKERS[it["spk"]]["name"]})
	# fade the scene out on the aftermath
	n = len(mix)
	k = ns(3.0)
	mix[-k:] *= np.linspace(1, 0, k)[:, None] ** 2
	y = loud.normalize_loudness(mix, -18.0, "integrated", -1.0, 4.0)
	path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "audio", "voice", "prologue.ogg")
	y = y * aio.write_ogg_checked(os.path.abspath(path), y, 3.5, -1.0)
	for k2, s in enumerate(segs):
		nxt = segs[k2 + 1]["t"] if k2 + 1 < len(segs) else n / SR
		s["d"] = round(max(0.8, min(s["d"], nxt - s["t"] - 0.05)), 2)
	if preview:
		aio.write_wav(os.path.join(preview, "prologue.wav"), y, bits=16)
		specpng.render(y, os.path.join(preview, "prologue.png"), "prologue", 1600, 220)
	text = " ".join(f"{s['speaker']}: {s['text']}" for s in segs)
	return {"file": "res://assets/audio/voice/prologue.ogg", "speaker": "Dale Morrow", "speaker_id": "dale",
		"text": text, "radio": True, "kind": "scene", "duration_s": round(n / SR, 2), "segments": segs,
		"events": {"engine_rough": round(ev["rough"], 2), "engine_quit": round(ev["quit"], 2),
			"brace": round(brace_t, 2), "impact": round(t_hit, 2)}}

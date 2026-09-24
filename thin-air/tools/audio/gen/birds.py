"""Resident late-October birds of northern BC forests/alpine (syrinx modelled as near-pure FM tones with weak
harmonics, amplitude envelopes, buzz AM where the real call is harmonic-rich). Contours follow field-guide
spectrograms. All rendered with a light forest/valley room so they sit as distant ambience.
"""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, voc
from lib.dsp import SR, ns, place, tvec
from catalog import sfx


def _note(r, dur, f_pts, amp_pts=None, harm=(1.0, 0.06, 0.015), am_hz: float = 0.0, am_depth: float = 0.0,
		noise: float = 0.01, jitter: float = 0.004) -> np.ndarray:
	n = ns(dur)
	f = voc.curve(n, f_pts) * voc.micro(n, r, jitter, 25)
	amp = voc.curve(n, amp_pts or [(0, 0), (min(0.015, dur * 0.2), 1), (dur * 0.75, 0.85), (dur, 0)], "lin")
	ph = dsp.phase_from_f(f)
	x = np.zeros(n)
	for k, h in enumerate(harm, start=1):
		if h > 0:
			x += h * np.sin(k * ph + r.random() * 6.28) * (f * k < dsp.NYQ * 0.9)
	if am_hz > 0:
		x *= 1 - am_depth * (0.5 + 0.5 * np.sin(dsp.phase_from_f(np.full(n, am_hz))))
	if noise > 0:
		x += dsp.bp(r.standard_normal(n), max(200, float(np.min(f)) * 0.7), min(18000, float(np.max(f)) * 1.4)) * noise
	return x * amp


def _stack(r, dur, f0_pts, center: float, width: float, amp_pts=None, am_hz: float = 0.0, am_depth: float = 0.0,
		noise: float = 0.05) -> np.ndarray:
	"""Harmonic-rich note (buzzy 'dee', nasal 'yank'): harmonics weighted by a Gaussian band around `center`."""
	n = ns(dur)
	f0 = voc.curve(n, f0_pts) * voc.micro(n, r, 0.006, 20)
	ph = dsp.phase_from_f(f0)
	x = np.zeros(n)
	for k in range(1, 40):
		fk = f0 * k
		if np.min(fk) > dsp.NYQ * 0.9:
			break
		g = np.exp(-0.5 * ((fk - center) / width) ** 2)
		x += g * np.sin(k * ph + r.random() * 6.28)
	amp = voc.curve(n, amp_pts or [(0, 0), (0.01, 1), (dur * 0.8, 0.8), (dur, 0)], "lin")
	if am_hz > 0:
		x *= 1 - am_depth * (0.5 + 0.5 * np.sin(dsp.phase_from_f(np.full(n, am_hz))))
	x = x / (np.std(x) + 1e-9)
	x += dsp.bp(r.standard_normal(n), center - width, center + width) * noise * 3
	return x * amp


def _forest(r, x, t60: float = 1.0, wet: float = 0.22):
	ir = dsp.make_ir(t60, r, 0.012, 7000, 2500, early=[(0.021, 0.3), (0.047, 0.2), (0.09, 0.12)], hp_hz=300)
	return dsp.reverb(x, ir, wet)


def _seq(total: float, parts) -> np.ndarray:
	out = dsp.zeros(total)
	for t0, x, g in parts:
		place(out, x * g, t0)
	return out


# ------------------------------------------------------------------------------------------------ songbirds

def chickadee_feebee(r):
	s = 1 + 0.03 * r.standard_normal()
	fee = _note(r, 0.32, [(0, 4050 * s), (0.3, 3950 * s), (0.32, 3900 * s)])
	bee = _note(r, 0.34, [(0, 3480 * s), (0.12, 3420 * s), (0.16, 3330 * s), (0.2, 3440 * s), (0.34, 3400 * s)],
		[(0, 0), (0.02, 1), (0.14, 0.9), (0.16, 0.45), (0.2, 0.95), (0.3, 0.8), (0.34, 0)])
	return _seq(1.0, [(0.02, fee, 1.0), (0.44, bee, 0.85)])


def chickadee_call(r):
	"""chick-a-dee-dee-dee: two fast descending 'chick' notes then harsh harmonic 'dee' notes."""
	parts = []
	t = 0.02
	for k in range(2):
		c = _note(r, 0.035, [(0, 7600 - 800 * k), (0.035, 4200 - 300 * k)], harm=(1.0, 0.2, 0.05), noise=0.03)
		parts.append((t, c, 0.8))
		t += 0.06
	for k in range(3 + r.integers(0, 3)):
		d = _stack(r, 0.13, [(0, 430), (0.13, 400)], 3800, 1100, am_hz=90, am_depth=0.3)
		parts.append((t + 0.03, d, 0.55))
		t += 0.16 + 0.02 * r.random()
	return _seq(t + 0.2, parts)


def nuthatch_yank(r):
	"""Red-breasted nuthatch: nasal tin-horn 'yank' notes."""
	parts = []
	t = 0.02
	for k in range(3 + r.integers(0, 3)):
		y = _stack(r, 0.09, [(0, 820), (0.03, 900), (0.09, 860)], 2400, 1100, noise=0.03)
		parts.append((t, y, 0.8))
		t += 0.3 + 0.12 * r.random()
	return _seq(t + 0.2, parts)


def kinglet_tsee(r):
	"""Golden-crowned kinglet: very high thin 'tsee-tsee-tsee'."""
	parts = []
	t = 0.02
	for k in range(3):
		f = 7600 - 150 * k
		parts.append((t, _note(r, 0.075, [(0, f), (0.075, f - 400)], harm=(1.0, 0.02)), 0.7))
		t += 0.12
	return _seq(t + 0.15, parts)


def crossbill_kip(r):
	"""White-winged crossbill flight calls: dry 'chet chet'."""
	parts = []
	t = 0.02
	for k in range(2 + r.integers(0, 3)):
		parts.append((t, _note(r, 0.045, [(0, 4800), (0.02, 3600), (0.045, 3100)], harm=(1.0, 0.25, 0.1), noise=0.08), 0.8))
		t += 0.14 + 0.08 * r.random()
	return _seq(t + 0.15, parts)


def junco_chip(r):
	parts = []
	t = 0.02
	for k in range(1 + r.integers(0, 3)):
		parts.append((t, _note(r, 0.03, [(0, 6800), (0.03, 5200)], harm=(1.0, 0.3), noise=0.12), 0.8))
		t += 0.35 + 0.3 * r.random()
	return _seq(t + 0.1, parts)


def grayjay_whistle(r):
	"""Canada (gray) jay: soft, sad descending whistle 'wheee-oo'."""
	w = _note(r, 0.55, [(0, 2700), (0.12, 2850), (0.55, 1900)], [(0, 0), (0.05, 1), (0.4, 0.8), (0.55, 0)],
		harm=(1.0, 0.12, 0.03), noise=0.03)
	return _seq(0.8, [(0.02, w, 1.0)])


SONGS = [chickadee_feebee, chickadee_feebee, chickadee_call, chickadee_call, nuthatch_yank, kinglet_tsee,
	crossbill_kip, junco_chip, grayjay_whistle]


@sfx("bird_chirp", n=9, cat="bird", target=-20.0)
def bird_chirp(r, i):
	return _forest(r, SONGS[i](r))


# ------------------------------------------------------------------------------------------------ night / other

def _hoot(r, d, f, a=1.0):
	return _note(r, d, [(0, f * 0.96), (d * 0.4, f * 1.02), (d, f * 0.94)],
		[(0, 0), (d * 0.3, 1), (d * 0.7, 0.9), (d, 0)], harm=(1.0, 0.1, 0.02), noise=0.02) * a


@sfx("amb_owl", n=5, cat="amb_event", target=-19.0, max_distance=500.0, unit_size=30.0)
def amb_owl(r, i):
	"""0,1: great horned owl 'hoo h'HOO hoo hoo'; 2: boreal owl staccato; 3,4: northern saw-whet toots."""
	if i < 2:
		f = (300 if i == 0 else 360) * (0.97 + 0.06 * r.random())
		parts = [(0.05, _hoot(r, 0.28, f), 0.8), (0.58, _hoot(r, 0.12, f * 1.02), 0.7), (0.72, _hoot(r, 0.42, f * 1.04), 1.0),
			(1.35, _hoot(r, 0.3, f), 0.8), (1.85, _hoot(r, 0.3, f * 0.98), 0.75)]
		x = _seq(2.6, parts)
	elif i == 2:
		parts = []
		t = 0.05
		for k in range(24):
			parts.append((t, _hoot(r, 0.055, 720 + 10 * r.random()), 0.4 + 0.6 * k / 24))
			t += 0.085
		x = _seq(t + 0.3, parts)
	else:
		parts = []
		t = 0.05
		for k in range(8 + r.integers(0, 5)):
			parts.append((t, _hoot(r, 0.11, 1120 + 15 * r.random()), 1.0))
			t += 0.5 + 0.03 * r.random()
		x = _seq(t + 0.3, parts)
	return _forest(r, x, 1.2, 0.18)


@sfx("amb_woodpecker", n=3, cat="amb_event", target=-19.0, max_distance=400.0, unit_size=25.0)
def amb_woodpecker(r, i):
	"""Hairy / American three-toed woodpecker drumming on a dead snag, then a sharp 'peek'."""
	out = dsp.zeros(2.2)
	rate = 18 + 8 * r.random()
	beats = int(rate * (0.9 + 0.4 * r.random()))
	from lib import models as M
	fr, t60, amps = M.wood_modes(r, 650 + 400 * r.random(), 5, 1.4)
	for k in range(beats):
		exc = np.zeros(ns(0.08))
		exc[:ns(0.0008)] = 1.0
		b = dsp.resonator_bank(dsp.lp(exc, 6000), fr, t60, amps)
		place(b, dsp.click(r, 0.001, 1500, 9000) * 0.3, 0)
		place(out, b * (1 - 0.35 * k / beats) * (0.85 + 0.3 * r.random()), 0.05 + k / rate)
	if i != 2:
		pk = _note(r, 0.05, [(0, 5200), (0.05, 4300)], harm=(1.0, 0.4, 0.15), noise=0.1)
		place(out, pk * 0.8, 0.05 + beats / rate + 0.5)
	return _forest(r, out, 1.2, 0.3)


@sfx("amb_ptarmigan", n=2, cat="amb_event", target=-21.0, max_distance=250.0, unit_size=15.0)
def amb_ptarmigan(r, i):
	"""White-tailed ptarmigan on alpine scree: soft clucks 'cuk-cuk' building into a cackle."""
	parts = []
	t = 0.05
	for k in range(5 + r.integers(0, 5)):
		d = 0.05 + 0.03 * r.random()
		f = 900 + 250 * r.random() + 30 * k
		parts.append((t, _stack(r, d, [(0, f), (d, f * 0.85)], 1800, 900, noise=0.2), 0.7))
		t += 0.16 - 0.008 * k + 0.03 * r.random()
	if i == 1:
		parts.append((t + 0.1, _stack(r, 0.35, [(0, 1100), (0.35, 800)], 2000, 1000, am_hz=35, am_depth=0.6, noise=0.2), 0.8))
		t += 0.5
	return _forest(r, _seq(t + 0.2, parts), 2.0, 0.2)


@sfx("amb_nutcracker", n=2, cat="amb_event", target=-19.0, max_distance=400.0, unit_size=25.0)
def amb_nutcracker(r, i):
	"""Clark's nutcracker (subalpine whitebark pine): grating, drawn-out 'kraaaa'."""
	parts = []
	t = 0.05
	for k in range(1 + i):
		d = 0.55 + 0.2 * r.random()
		x = _stack(r, d, [(0, 950), (0.1, 1050), (d, 880)], 2300, 1300, am_hz=48, am_depth=0.5, noise=0.35)
		parts.append((t, x, 1.0))
		t += d + 0.35
	return _forest(r, _seq(t + 0.2, parts), 1.8, 0.25)

"""Interface, survey-scanner device and radio sounds. Understated and tactile: real switch clicks, a small
piezo transducer in a plastic housing, a VHF handheld's squelch — nothing synthy or 'sci-fi'."""
from __future__ import annotations

import math

import numpy as np

from lib import dsp, models as M
from lib.dsp import SR, ns, place, tvec
from catalog import sfx


def _switch(r, body_hz: float = 2600, bright: float = 1.0, soft: float = 0.0) -> np.ndarray:
	"""Tactile switch: actuation click + return, each a micro-transient through a small housing resonance."""
	out = dsp.zeros(0.05)
	for k, (t0, a) in enumerate([(0.0, 1.0), (0.004 + 0.002 * r.random(), 0.45)]):
		c = dsp.click(r, 0.0008, 1200 * bright, 12000 * bright, 2.5) * a
		c = dsp.mix(c, dsp.resonator_bank(c, [body_hz, body_hz * 2.3], [0.012, 0.006], [0.6, 0.3]))
		place(out, c, t0)
	if soft > 0:
		out = dsp.lp(out, 6000 - 3000 * soft)
	return out


@sfx("ui_click", n=3, cat="ui")
def ui_click(r, i):
	return _switch(r, 2400 + 400 * i + 100 * r.random())


@sfx("ui_hover", n=2, cat="ui", target=-35.0, cooldown=0.04)
def ui_hover(r, i):
	x = dsp.click(r, 0.0006, 3000, 12000, 3.0)
	x = dsp.mix(x, dsp.resonator(x, 4200 + 400 * i, 0.006) * 0.5)
	return dsp.pad_to(x, ns(0.02))


@sfx("ui_back", n=2, cat="ui", target=-29.0)
def ui_back(r, i):
	return _switch(r, 1300 + 150 * i, 0.7, 0.6)


def _glass(r, f0: float, dur: float = 0.8, damp: float = 1.0) -> np.ndarray:
	ratios = np.array([1.0, 2.32, 4.25, 6.63])
	fr = f0 * ratios * (1 + 0.004 * r.standard_normal(4))
	t60 = np.array([0.7, 0.35, 0.2, 0.12]) / damp
	return dsp.modal(ns(dur), fr, t60, [1.0, 0.35, 0.15, 0.06], r=r)


@sfx("notify", n=2, cat="ui", target=-26.0)
def notify(r, i):
	"""Soft muted tap on a small glass/metal body, a fourth apart — calm, unobtrusive."""
	f = [1560.0, 1390.0][i]
	out = dsp.zeros(0.9)
	place(out, _glass(r, f, 0.8, 1.6) + 0, 0.0)
	place(out, _glass(r, f * 4 / 3, 0.7, 1.8) * 0.7, 0.085)
	place(out, dsp.lp(dsp.click(r, 0.001, 800, 5000), 3000) * 0.3, 0.0)
	return dsp.lp(out, 7000)


def _piezo(r, f: float, dur: float, level: float = 1.0) -> np.ndarray:
	"""Piezo buzzer (square-ish drive) in a small plastic housing: odd harmonics, housing resonance, fast edges."""
	n = ns(dur)
	t = tvec(n)
	ph = 2 * math.pi * f * t
	sq = np.sin(ph) + np.sin(3 * ph) / 3 * 0.6 + np.sin(5 * ph) / 5 * 0.3
	env = np.clip(t / 0.002, 0, 1) * np.clip((dur - t) / 0.003, 0, 1)
	x = sq * env
	x = dsp.peak_eq(x, 3100, 6, 2.0)
	x = dsp.bp(x, 700, 9000, 2)
	return x * level


@sfx("blueprint", n=2, cat="device", target=-22.0, max_distance=0.0)
def blueprint(r, i):
	"""Survey scanner: data captured — two quick rising piezo chirps + relay click."""
	out = dsp.zeros(0.5)
	place(out, _switch(r, 1800, 0.8) * 0.5, 0.0)
	place(out, _piezo(r, 2400, 0.06), 0.03)
	place(out, _piezo(r, 3200, 0.09), 0.12)
	if i == 1:
		place(out, _piezo(r, 3600, 0.05) * 0.8, 0.24)
	return out


@sfx("scan_done", n=2, cat="device", target=-22.0, max_distance=0.0)
def scan_done(r, i):
	out = dsp.zeros(0.6)
	for k, f in enumerate([2000, 2520, 3000] if i == 0 else [2240, 3000]):
		place(out, _piezo(r, f, 0.07), 0.02 + 0.1 * k)
	return out


@sfx("scan_loop", n=1, cat="device", loop=True, target=-26.0, max_distance=12.0, unit_size=1.2)
def scan_loop(r, i):
	"""Scanner working: faint electronics whine, a measuring sweep each second through the tiny speaker,
	and sparse acquisition ticks. Exactly periodic (4 x 1.0 s)."""
	L = ns(4.0)
	t = tvec(L)
	x = np.zeros(L)
	# 1 s sweep repeated: frequency ramps 1.1 -> 2.2 kHz, soft
	period = L // 4
	tp = (np.arange(L) % period) / period
	f = 1100 * 2 ** tp
	ph = 2 * math.pi * np.cumsum(f) / SR
	sweep = np.sin(ph) * np.sin(math.pi * tp) ** 2 * 0.18
	# make the phase continuous across the loop by using per-period resets at zero amplitude (env is 0 there)
	x += sweep
	whine = np.sin(2 * math.pi * dsp.per_freq(15700, L) * t) * 0.004 + np.sin(2 * math.pi * dsp.per_freq(120, L) * t) * 0.02
	x += whine
	ev = np.zeros(L + ns(0.05))
	for tt in dsp.poisson_times(4.0, 9, r):
		place(ev, dsp.click(r, 0.0007, 2000, 9000) * (0.2 + 0.3 * r.random()), float(tt))
	x += dsp.fold(ev, L)
	x += dsp.per_noise(L, r, [100, 2000, 8000, 20000], [-30, -20, -24, -40]) * 0.01
	return dsp.circ(x, lambda z: dsp.bp(z, 250, 12000, 2))


# ------------------------------------------------------------------------------------------------ radio

def _vhf_noise(r, dur: float, strength: float = 1.0) -> np.ndarray:
	"""FM receiver noise with no carrier: de-emphasised hiss band-limited to the audio passband, plus
	impulsive clicks; slightly 'fluttery' (multipath picket-fencing)."""
	n = ns(dur)
	x = dsp.bp(dsp.pink(n, r) + 0.6 * r.standard_normal(n), 300, 3400, 3)
	x = dsp.lp(x, 2600, 1)
	flutter = np.clip(1 + 0.35 * dsp.smooth_noise(n, r, 12), 0.2, 1.8)
	x *= flutter
	for tt in dsp.poisson_times(dur, 6, r):
		place(x, dsp.click(r, 0.001, 400, 3400) * 3 * r.random(), float(tt))
	return x * strength


def _squelch_tail(r, dur: float = 0.18) -> np.ndarray:
	n = ns(dur)
	return _vhf_noise(r, dur) * dsp.env_points(n, [(0, 0), (0.005, 1), (dur * 0.7, 0.9), (dur, 0)]) * 1.2


def _ptt_click(r) -> np.ndarray:
	c = dsp.click(r, 0.0015, 200, 3400, 2.0)
	return dsp.mix(c, dsp.resonator(c, 900, 0.01) * 0.6)


@sfx("radio_static", n=3, cat="radio")
def radio_static(r, i):
	"""A burst of open-squelch static (1.5-3 s): squelch opens, hiss with multipath flutter, closes."""
	dur = [1.6, 2.4, 3.0][i]
	out = dsp.zeros(dur + 0.1)
	place(out, _ptt_click(r) * 0.6, 0.0)
	n = ns(dur)
	body = _vhf_noise(r, dur) * dsp.env_points(n, [(0, 0), (0.01, 1), (dur - 0.05, 1), (dur, 0)])
	if i == 2:
		# a fragment of an unintelligible distant carrier (heterodyne whistle + muffled modulation)
		t = tvec(n)
		wh = np.sin(2 * math.pi * (1100 + 40 * np.sin(2 * math.pi * 0.3 * t)) * t) * 0.08 * dsp.env_points(n, [(0, 0), (0.6, 0), (1.0, 1), (2.2, 1), (2.6, 0), (dur, 0)])
		body += wh
	place(out, body, 0.01)
	place(out, _ptt_click(r) * 0.4, dur)
	return out


@sfx("radio_static_loop", n=1, cat="radio", loop=True, target=-28.0)
def radio_static_loop(r, i):
	L = ns(6.0)
	x = dsp.per_noise(L, r, [100, 300, 1000, 2600, 3400, 5000], [-40, 0, 0, -3, -12, -40])
	fl = np.clip(1 + 0.3 * dsp.per_smooth(L, r, 10), 0.2, 1.8)
	x = x * fl
	ev = np.zeros(L + ns(0.01))
	for tt in dsp.poisson_times(6.0, 5, r):
		place(ev, dsp.click(r, 0.001, 400, 3400) * 3 * r.random(), float(tt))
	return x + dsp.fold(ev, L)


@sfx("radio_beep", n=3, cat="radio")
def radio_beep(r, i):
	"""0: handheld roger beep + squelch tail; 1: channel select blip; 2: station beacon telemetry burst (AFSK)."""
	out = dsp.zeros(0.9)
	if i == 0:
		place(out, _piezo(r, 1000, 0.12, 0.8), 0.0)
		place(out, _squelch_tail(r) * 0.6, 0.14)
	elif i == 1:
		place(out, _switch(r, 1500, 0.7) * 0.8, 0.0)
		place(out, _piezo(r, 1480, 0.05, 0.6), 0.02)
	else:
		# Bell-202 AFSK: 1200/2200 Hz at 1200 baud, band-limited like a receiver
		n = ns(0.45)
		bits = r.integers(0, 2, int(0.45 * 1200) + 1)
		f = np.where(np.repeat(bits, int(SR / 1200) + 1)[:n] > 0, 1200.0, 2200.0)
		afsk = np.sin(dsp.phase_from_f(f)) * dsp.env_points(n, [(0, 0), (0.01, 1), (0.44, 1), (0.45, 0)])
		place(out, _ptt_click(r) * 0.5, 0.0)
		place(out, dsp.bp(afsk, 300, 3400, 2) * 0.7 + 0, 0.02)
		place(out, _squelch_tail(r) * 0.5, 0.48)
	return out


@sfx("radio_squelch", n=3, cat="radio")
def radio_squelch(r, i):
	"""Squelch tail after a transmission ends (the 'kssh')."""
	out = dsp.zeros(0.3)
	place(out, _squelch_tail(r, 0.12 + 0.08 * i), 0.0)
	return out


@sfx("radio_ptt", n=2, cat="radio")
def radio_ptt(r, i):
	return dsp.pad_to(_ptt_click(r), ns(0.04))

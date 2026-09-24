"""Voice processing chains: VHF radio (handheld / aviation), weak-signal beacon, microcassette dictaphone,
headset intercom, in-person room, synthetic automated weather voice. All mono float @ 44.1 kHz."""
from __future__ import annotations

import math

import numpy as np
from scipy import signal

from . import dsp, models as M, voc
from .dsp import SR, ns, place, tvec


def to44k(x: np.ndarray, sr: int) -> np.ndarray:
	if sr == SR:
		return x.astype(np.float64)
	g = math.gcd(sr, SR)
	return signal.resample_poly(x.astype(np.float64), SR // g, sr // g)


def trim_tts(x: np.ndarray, pad: float = 0.03) -> np.ndarray:
	a = np.abs(x)
	thr = np.max(a) * 0.01
	idx = np.where(a > thr)[0]
	if len(idx) == 0:
		return x
	s = max(0, idx[0] - ns(pad))
	e = min(len(x), idx[-1] + ns(pad * 2))
	return dsp.fade(x[s:e], 0.004, 0.02)


def band(x: np.ndarray, lo: float, hi: float, order: int = 4) -> np.ndarray:
	sos = signal.butter(order, [lo, hi], btype="bandpass", fs=SR, output="sos")
	return signal.sosfilt(sos, x)


# ------------------------------------------------------------------------------------------------ breath

def breath(r, female: bool, level: float = 1.0, dur: float = 0.32) -> np.ndarray:
	"""Soft inhale through the mouth before a phrase."""
	n = ns(dur)
	forms = voc.vowel_formants("e", 1.15 if female else 1.0, (0, -3, -8, -12, -16))
	x = voc.shaped_noise(n, r, forms, 1.0)
	x = dsp.hp(x, 500)
	env = voc.curve(n, [(0, 0), (dur * 0.5, 1.0), (dur * 0.85, 0.7), (dur, 0)], "lin")
	x = x / (np.std(x) + 1e-9) * env
	return x * level


# ------------------------------------------------------------------------------------------------ radio

def ptt_click(r, level: float = 1.0) -> np.ndarray:
	"""Push-to-talk switch on the handheld (mechanical, close to the ear, not through the radio)."""
	out = dsp.zeros(0.03)
	for t0, a in [(0.0, 1.0), (0.005, 0.4)]:
		c = dsp.click(r, 0.0008, 800, 9000, 2.5) * a
		c = dsp.mix(c, dsp.resonator_bank(c, [1400, 3100], [0.012, 0.006], [0.7, 0.3]))
		place(out, c, t0)
	return out * level


def fm_noise(r, dur: float) -> np.ndarray:
	n = ns(dur)
	x = dsp.pink(n, r) + 0.7 * r.standard_normal(n)
	x = band(x, 300, 3400, 3)
	x = dsp.lp(x, 2800, 1)
	x *= np.clip(1 + 0.3 * dsp.smooth_noise(n, r, 14), 0.3, 1.8)
	return x / (np.std(x) + 1e-9)


def squelch_open(r, level: float) -> np.ndarray:
	"""Carrier arriving: a short burst of noise before the capture effect quiets it."""
	d = 0.07 + 0.03 * r.random()
	n = ns(d)
	return fm_noise(r, d) * dsp.env_points(n, [(0, 0), (0.004, 1), (d * 0.6, 0.6), (d, 0)]) * level


def squelch_tail(r, level: float) -> np.ndarray:
	"""Carrier dropping: the classic 'kssh' before the squelch closes."""
	d = 0.13 + 0.08 * r.random()
	n = ns(d)
	return fm_noise(r, d) * dsp.env_points(n, [(0, 0.3), (0.01, 1), (d * 0.8, 0.9), (d, 0)]) * level


def radio_voice(x: np.ndarray, r, weak: float = 0.0, drive: float = 2.0, hiss_db: float = -36.0,
		dropouts=()) -> np.ndarray:
	"""A received VHF-FM transmission: 300-3400 Hz, AGC/limiter, clipping, small-speaker colour, and a noise
	floor that rises with weak signal (capture effect), multipath flutter and dropouts."""
	y = band(x, 280, 3500, 4)
	y = dsp.peak_eq(y, 1800, 4.0, 1.2)
	y = dsp.peak_eq(y, 2900, 2.5, 1.5)
	y = dsp.compress(y, -26.0, 5.0, 0.003, 0.08, 0.0)
	y = y / (np.max(np.abs(y)) + 1e-9)
	y = np.tanh(y * drive) / np.tanh(drive)
	n = len(y)
	env = dsp.rms_envelope(y, 0.05)
	env = env / (np.max(env) + 1e-9)
	noise = fm_noise(r, n / SR)
	# capture effect: with a strong carrier the receiver is quiet; weak carrier lets noise through
	# noise std relative to a unit-peak voice (speech RMS ≈ 0.25): weak 0.65 → ≈ 12 dB SNR
	floor = dsp.db(hiss_db) + weak * 0.05
	mask = floor * (1.0 - 0.6 * np.clip(env * 3, 0, 1)) + weak * 0.035
	y = y * (1.0 - 0.1 * weak)
	if weak > 0:
		fl = np.clip(1 + 0.5 * weak * dsp.smooth_noise(n, r, 6.0), 0.1, 1.6)
		y = y * fl
		# micro-dropouts (picket fencing)
		for tt in dsp.poisson_times(n / SR, 1.2 * weak, r):
			i = ns(float(tt))
			k = ns(0.03 + 0.08 * r.random())
			y[i:i + k] *= 0.1
			mask[i:i + k] += 0.08 * weak
	for (t0, d) in dropouts:
		i = ns(t0)
		k = ns(d)
		w = np.ones(k)
		w[:ns(0.02)] = np.linspace(1, 0, ns(0.02))
		w[ns(0.02):] = 0.0
		y[i:i + k] *= w[:len(y[i:i + k])]
		mask[i:i + k] = np.maximum(mask[i:i + k], 0.16)
	out = y + noise * mask
	for tt in dsp.poisson_times(n / SR, 3 + 12 * weak, r):
		place(out, dsp.click(r, 0.0008, 400, 3400) * (0.1 + 0.4 * weak) * r.random(), float(tt))
	return band(out, 250, 3600, 2)


# ------------------------------------------------------------------------------------------------ intercom

def intercom_voice(x: np.ndarray, r) -> np.ndarray:
	"""Pilot's boom mic through the aircraft intercom to the passenger headset."""
	y = band(x, 160, 5500, 3)
	y = dsp.peak_eq(y, 2500, 3.0, 1.0)
	y = dsp.compress(y, -24.0, 3.0, 0.005, 0.1)
	y = y / (np.max(np.abs(y)) + 1e-9)
	return np.tanh(y * 1.3) / np.tanh(1.3)


# ------------------------------------------------------------------------------------------------ dictaphone

def record_button(r, stop: bool = False) -> np.ndarray:
	"""Microcassette recorder key: plastic clunk + mechanism."""
	out = dsp.zeros(0.12)
	c = dsp.click(r, 0.003, 300, 7000, 1.4)
	c = dsp.mix(c, dsp.resonator_bank(c, [650, 1500, 3200], [0.03, 0.02, 0.01], [1.0, 0.6, 0.3]))
	place(out, c, 0.0)
	place(out, dsp.click(r, 0.002, 800, 6000) * 0.4, 0.035 if not stop else 0.02)
	return out


def dictaphone(x: np.ndarray, r, room: str = "station", wind: float = 0.0, cave: float = 0.0) -> np.ndarray:
	"""Microcassette voice memo: small room, handheld mic, AGC pumping, 200-6500 Hz, wow & flutter, hiss,
	record/stop key clunks and a moment of handling."""
	lead, tail = 0.45, 0.4
	n = len(x) + ns(lead + tail)
	v = np.zeros(n)
	place(v, x, lead)
	# acoustic space
	if cave > 0:
		# small ice cave: hard, bright ice walls but a snow floor that soaks up the highs (Sabine RT ~1.2 s);
		# dense early reflections, no long low-end build-up that would smear the words
		ir = dsp.make_ir(1.2, r, 0.01, 6500, 1800, early=[(0.006, 0.5), (0.013, 0.4), (0.021, 0.3)], hp_hz=220)
		v = dsp.reverb(v, ir, 0.17 * cave)[:n]
		for tt in dsp.poisson_times(n / SR, 0.6, r):
			place(v, dsp.reverb(M.drop_plink(r, 1.2), ir, 0.4)[:ns(1.5)] * 0.02, float(tt))
	elif wind > 0:
		pass
	else:
		ir = dsp.make_ir(0.35, r, 0.003, 7000, 3000, early=[(0.003, 0.4), (0.007, 0.3), (0.011, 0.2)], hp_hz=150)
		v = dsp.reverb(v, ir, 0.12)[:n]
	room_tone = dsp.lp(dsp.pink(n, r), 900) * 0.004 if cave <= 0 else dsp.lp(dsp.brown(n, r), 300) * 0.003
	v = v + room_tone
	if wind > 0:
		# wind across the recorder's mic: low-frequency buffeting that the AGC fights
		g = np.exp(0.35 * dsp.smooth_noise(n, r, 0.3))
		w = dsp.lp(dsp.pink(n, r), 350) * g ** 2 * 0.012 * wind
		w += dsp.lp(r.standard_normal(n), 120) * np.clip(g - 1.0, 0, None) * 0.03 * wind
		v = v + w
	# handheld mic: slight proximity warmth, then recorder bandwidth
	v = dsp.shelf(v, 200, 2.0, False)
	v = band(v, 180, 6500, 3)
	v = dsp.lp(v, 5200, 1)
	# AGC: pumps the room tone up in pauses
	v = dsp.compress(v, -32.0, 3.5, 0.01, 0.4, 0.0)
	# tape transport: wow (capstan eccentricity) and flutter
	t = tvec(n)
	rate = 1.0 + 0.0025 * np.sin(2 * math.pi * 0.62 * t + r.random() * 6) + 0.0009 * np.sin(2 * math.pi * 7.3 * t) \
		+ 0.0006 * dsp.smooth_noise(n, r, 12)
	v = dsp.varispeed(v, rate)
	n2 = len(v)
	hiss = dsp.hp(dsp.pink(n2, r), 2500) * 0.0025
	motor = np.sin(2 * math.pi * 1180 * tvec(n2)) * 0.0004
	v = v + hiss + motor
	# keys and handling
	lvl = np.percentile(np.abs(v), 99) + 1e-9
	place(v, record_button(r) * lvl * 0.5, 0.0)
	place(v, M.cloth_rustle(r, 0.3, 0.8, 0.3) * lvl * 0.08, 0.08)
	place(v, record_button(r, True) * lvl * 0.5, n2 / SR - 0.12)
	return v


# ------------------------------------------------------------------------------------------------ in person

def in_person(x: np.ndarray, r, warm_hum: bool = False) -> np.ndarray:
	"""Mara in the station module, a couple of metres away: small insulated room, faint room tone."""
	ir = dsp.make_ir(0.38, r, 0.004, 8000, 3000, early=[(0.004, 0.4), (0.009, 0.3), (0.015, 0.25), (0.022, 0.15)], hp_hz=120)
	y = dsp.reverb(x, ir, 0.2)
	y = dsp.lp(y, 11000, 1)
	n = len(y)
	tone = dsp.lp(dsp.pink(n, r), 600) * 0.002
	return y + tone


# ------------------------------------------------------------------------------------------------ automated weather

def awos_voice(x: np.ndarray, r) -> np.ndarray:
	"""Old concatenative/synthetic weather voice: 8 kHz, 8-bit µ-law character, flat prosody."""
	y = signal.resample_poly(x, 8000, SR)
	y = y / (np.max(np.abs(y)) + 1e-9)
	mu = 255.0
	c = np.sign(y) * np.log1p(mu * np.abs(y)) / np.log1p(mu)
	c = np.round(c * 127) / 127
	y = np.sign(c) * ((1 + mu) ** np.abs(c) - 1) / mu
	return signal.resample_poly(y, SR, 8000)

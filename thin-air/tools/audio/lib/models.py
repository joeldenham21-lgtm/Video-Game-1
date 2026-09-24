"""Physically-informed sound models: impacts, modal objects, granular media, bubbles, friction, air."""
from __future__ import annotations

import math

import numpy as np

from . import dsp
from .dsp import SR, ns, place, tvec


# ------------------------------------------------------------------------------------------ modal objects

BEAM_RATIOS = np.array([1.0, 2.756, 5.404, 8.933, 13.34, 18.64])      # free-free Euler beam
PLATE_RATIOS = np.array([1.0, 1.52, 2.03, 2.44, 3.01, 3.62, 4.18, 4.96, 5.78, 6.58, 7.44, 8.35])
STONE_RATIOS = np.array([1.0, 1.61, 2.27, 2.93, 3.71, 4.52, 5.63])


def wood_modes(r: np.random.Generator, f0: float, n: int = 6, damping: float = 1.0):
	"""Modes of a log/plank. Wood is lossy: t60 falls with frequency (loss factor ~0.01-0.02)."""
	fr = BEAM_RATIOS[:n] * f0 * (1 + 0.04 * r.standard_normal(n))
	# add a few torsional/secondary modes
	extra = f0 * np.array([1.6, 3.9, 7.1]) * (1 + 0.05 * r.standard_normal(3))
	fr = np.concatenate([fr, extra])
	eta = 0.018 * damping
	t60 = np.clip(2.2 / (math.pi * eta * fr), 0.01, 0.9)
	amps = 1.0 / (1 + np.arange(len(fr)) * 0.45) * (0.6 + 0.4 * r.random(len(fr)))
	return fr, t60, amps


def metal_modes(r: np.random.Generator, f0: float, n: int = 12, t60_base: float = 1.2, kind: str = "plate"):
	ratios = PLATE_RATIOS if kind == "plate" else np.array([1.0, 2.76, 5.40, 8.93, 13.3, 18.6, 26.0, 34.1])
	ratios = ratios[:n]
	fr = ratios * f0 * (1 + 0.012 * r.standard_normal(len(ratios)))
	t60 = t60_base * (fr[0] / fr) ** 0.35 * (0.7 + 0.6 * r.random(len(fr)))
	amps = (0.5 + r.random(len(fr))) / (1 + 0.25 * np.arange(len(fr)))
	return fr, t60, amps


def stone_ping(r: np.random.Generator, size_cm: float = 3.0, strength: float = 1.0, dur: float = 0.08) -> np.ndarray:
	"""Small stone struck: short, inharmonic, bright (f ∝ 1/size)."""
	f0 = 9000.0 / max(size_cm, 0.4) * (0.8 + 0.4 * r.random())
	fr = STONE_RATIOS * f0 * (1 + 0.05 * r.standard_normal(len(STONE_RATIOS)))
	t60 = np.clip(0.035 * (3.0 / size_cm) ** -0.3 * (f0 / fr) ** 0.5, 0.004, 0.12)
	amps = r.random(len(fr)) ** 1.5
	n = ns(dur)
	x = dsp.modal(n, fr, t60, amps, r=r)
	place(x, dsp.click(r, 0.0015, 2000, 12000) * 0.8, 0)
	return x * strength


def rock_knock(r: np.random.Generator, size_m: float = 0.3, dur: float = 0.25) -> np.ndarray:
	"""Larger rock knock (dull, heavily damped, low modes)."""
	f0 = 700.0 / max(size_m, 0.05) * (0.8 + 0.4 * r.random())
	fr = STONE_RATIOS * f0
	t60 = np.clip(0.06 * (f0 / fr), 0.01, 0.2)
	n = ns(dur)
	x = dsp.modal(n, fr, t60, r.random(len(fr)) + 0.2, r=r)
	place(x, dsp.lp(dsp.click(r, 0.006, 80, 6000), 3000) * 2, 0)
	return x


# ------------------------------------------------------------------------------------------ footwear

def boot_thud(r: np.random.Generator, weight: float = 1.0, hardness: float = 0.5, dur: float = 0.18) -> np.ndarray:
	"""Heel/sole contact: body mass-spring thump (60-140 Hz) + rubber slap (mid)."""
	n = ns(dur)
	t = tvec(n)
	f = (70 + 60 * hardness) * (0.9 + 0.2 * r.random())
	body = np.sin(2 * math.pi * f * t * (1 - 0.25 * t / dur)) * np.exp(-t / (0.018 + 0.02 * (1 - hardness)))
	body *= np.clip(t / 0.003, 0, 1)
	slap = dsp.bp(r.standard_normal(n), 250 + 400 * hardness, 1800 + 2500 * hardness, 2) * np.exp(-t / (0.006 + 0.004 * (1 - hardness)))
	return (body * 0.9 + slap * (0.25 + 0.5 * hardness)) * weight


def cloth_rustle(r: np.random.Generator, dur: float = 0.3, amount: float = 1.0, bright: float = 0.5) -> np.ndarray:
	"""Fabric (nylon shell/wool) movement: crackly band-limited noise bursts."""
	n = ns(dur)
	base = dsp.bp(r.standard_normal(n), 900 + 1500 * bright, 7000 + 5000 * bright, 2)
	env = np.abs(dsp.smooth_noise(n, r, 40)) ** 1.5
	env *= dsp.hann_env(n)
	# micro crinkles
	crink = np.zeros(n)
	for tt in dsp.poisson_times(dur, 120 * amount, r):
		place(crink, dsp.click(r, 0.002, 2500, 11000) * (0.3 + r.random()), float(tt))
	crink *= dsp.hann_env(n)
	return (base * env * 0.5 + crink * 0.35) * amount


def gear_rattle(r: np.random.Generator, dur: float = 0.25, amount: float = 1.0) -> np.ndarray:
	"""Backpack buckles/carabiners/zip pulls jingling."""
	n = ns(dur)
	out = np.zeros(n)
	for tt in dsp.poisson_times(dur * 0.7, 25 * amount, r):
		fr, t60, amps = metal_modes(r, 2200 + 2500 * r.random(), 6, 0.08)
		m = dsp.modal(ns(0.1), fr, t60, amps, r=r) * (0.2 + 0.6 * r.random())
		place(out, m, float(tt))
	return out * amount


# ------------------------------------------------------------------------------------------ granular media

def granular(r: np.random.Generator, dur: float, rate_env: np.ndarray, grain_fn, amp_sigma: float = 0.8) -> np.ndarray:
	"""Poisson grain cloud: rate_env (per-sample grains/s) controls density; grain_fn(r) -> grain array."""
	n = ns(dur)
	out = np.zeros(n)
	rmax = float(np.max(rate_env)) + 1e-6
	t = 0.0
	while True:
		t += r.exponential(1.0 / rmax)
		if t >= dur:
			break
		i = int(t * SR)
		if r.random() < rate_env[min(i, n - 1)] / rmax:
			a = math.exp(amp_sigma * r.standard_normal())  # log-normal: few big fractures
			place(out, grain_fn(r) * a, i)
	return out


def snow_grain(r: np.random.Generator, cold: float = 0.0) -> np.ndarray:
	"""Snow bond fracture: short band-limited crackle, centre log-uniform ~0.7-4.5 kHz (colder = higher)."""
	d = 0.001 + 0.003 * r.random()
	fc = math.exp(r.uniform(math.log(700), math.log(4500))) * (1 + 0.5 * cold)
	n = ns(d)
	x = r.standard_normal(n) * np.exp(-np.arange(n) / (n / 3.5))
	return dsp.bp(x, fc / 1.6, min(fc * 1.6, 16000), 2)


def snow_squeak(r: np.random.Generator, dur: float, f0: float) -> np.ndarray:
	"""Cold-snow squeak: quasi-periodic stick-slip fracture chain (pitched crunch, ~ 0.5-1.5 kHz)."""
	n = ns(dur)
	f = f0 * (1 + 0.25 * dsp.smooth_noise(n, r, 25)) * np.linspace(1.08, 0.9, n)
	x = stick_slip(r, f, jitter=0.18)
	x = dsp.resonator_bank(x, [f0 * 1.0, f0 * 2.1, f0 * 3.3, 4200], [0.01, 0.008, 0.006, 0.004], [1.0, 0.6, 0.35, 0.3])
	x *= dsp.hann_env(n) ** 0.6
	return x


# ------------------------------------------------------------------------------------------ friction

def stick_slip(r: np.random.Generator, f: np.ndarray, jitter: float = 0.1, pulse_ms: float = 0.3) -> np.ndarray:
	"""Stick-slip friction: impulse train at rate f(t) with timing/amp irregularity (creaks, squeaks)."""
	n = len(f)
	out = np.zeros(n)
	pw = max(2, int(pulse_ms * SR / 1000))
	pulse = np.hanning(pw * 2)[pw:] * np.sign(np.linspace(1, -0.4, pw))
	t = 0.0
	while True:
		i = int(t * SR)
		if i >= n:
			break
		ff = max(float(f[i]), 3.0)
		T = 1.0 / ff * (1 + jitter * r.standard_normal())
		if ff > 3.5:
			place(out, pulse * (0.6 + 0.8 * r.random()), i)
		t += max(T, 1.0 / 4000)
	return out


def creak(r: np.random.Generator, dur: float, f_start: float, f_end: float, modes, jitter: float = 0.12,
		wobble: float = 0.2) -> np.ndarray:
	"""Wood/metal creak: stick-slip excitation through the structure's modes."""
	n = ns(dur)
	fc = np.geomspace(f_start, f_end, n) * (1 + wobble * dsp.smooth_noise(n, r, 3.0) * 0.5)
	exc = stick_slip(r, fc, jitter)
	env = dsp.env_points(n, [(0, 0), (dur * 0.12, 1), (dur * 0.7, 0.8 + 0.2 * r.random()), (dur, 0)])
	exc *= env * (1 + 0.4 * dsp.smooth_noise(n, r, 6))
	fr, t60, amps = modes
	return dsp.resonator_bank(exc, fr, t60, amps)


def scrape(r: np.random.Generator, dur: float, lo: float = 800, hi: float = 7000, grit: float = 200) -> np.ndarray:
	"""Rough surface scrape: dense grit micro-impacts (random centre freqs) over a soft pink-ish friction bed."""
	n = ns(dur)
	base = dsp.lp(dsp.hp(dsp.pink(n, r), lo, 2), hi, 2) * (0.5 + 0.5 * np.abs(dsp.smooth_noise(n, r, 40)))
	g = np.zeros(n)
	for tt in dsp.poisson_times(dur, grit, r):
		fc = math.exp(r.uniform(math.log(lo * 1.2), math.log(hi)))
		d = ns(0.0006 + 0.0015 * r.random())
		c = r.standard_normal(d) * np.exp(-np.arange(d) / (d / 3.0))
		place(g, dsp.bp(c, fc / 1.5, min(fc * 1.5, 18000), 2) * r.random() ** 2, float(tt))
	g = g / (np.std(g) + 1e-9) * (np.std(base) + 1e-9) if np.any(g) else g
	return base * 0.35 + g * 0.8


# ------------------------------------------------------------------------------------------ water

def bubble(r: np.random.Generator, radius_mm: float, amp: float = 1.0, rise: float = 0.1, dur: float | None = None,
		damp: float = 1.0) -> np.ndarray:
	"""Minnaert bubble (van den Doel 2005): f0 = 3.26/r, damping d = 0.043 f + 0.0014 f^1.5, rising pitch."""
	rad = radius_mm / 1000.0
	f0 = 3.26 / rad
	f0 = min(f0, 16000.0)
	d = (0.043 * f0 + 0.0014 * f0 ** 1.5) * damp
	L = dur or min(0.25, 7.0 / d)
	n = ns(L)
	t = tvec(n)
	sigma = rise * d
	f = f0 * (1 + sigma * t)
	ph = dsp.phase_from_f(f)
	env = np.exp(-d * t)
	# rapid onset (bubble pinch-off)
	env *= np.clip(t * f0 / 1.5, 0, 1)
	return amp * rad ** 0.5 * 40.0 * np.sin(ph) * env


def bubble_field(r: np.random.Generator, dur: float, rate, rmin: float = 0.4, rmax: float = 8.0,
		alpha: float = 2.6, rise: float = 0.1, amp: float = 1.0, rate_env: np.ndarray | None = None) -> np.ndarray:
	"""Population of bubbles; radius pdf ∝ r^-alpha between rmin..rmax (mm)."""
	n = ns(dur)
	out = np.zeros(n)
	times = dsp.poisson_times(dur, rate, r)
	for tt in times:
		if rate_env is not None and r.random() > rate_env[min(int(tt * SR), n - 1)]:
			continue
		u = r.random()
		a1 = 1 - alpha
		rad = ((rmax ** a1 - rmin ** a1) * u + rmin ** a1) ** (1 / a1)
		place(out, bubble(r, rad, amp * (0.3 + r.random()), rise * (0.5 + r.random())), float(tt))
	return out


def drop_plink(r: np.random.Generator, size: float = 1.0) -> np.ndarray:
	"""Water drop into a pool: impact tick + entrained bubble with strongly rising pitch."""
	rad = (1.5 + 2.5 * r.random()) / size
	b = bubble(r, rad, 1.0, rise=0.25 + 0.3 * r.random(), dur=0.06, damp=1.3)
	tick = dsp.click(r, 0.0015, 1500, 9000) * 0.15
	out = np.zeros(len(b) + ns(0.01))
	place(out, tick, 0)
	place(out, b, ns(0.002 + 0.004 * r.random()))
	return out


def splash_body(r: np.random.Generator, size: float = 1.0, dur: float = 1.2) -> np.ndarray:
	"""Object entering water: slap + cavity collapse (big bubble) + bubble cloud + spray patter."""
	n = ns(dur)
	out = np.zeros(n)
	t = tvec(n)
	slap = dsp.bp(r.standard_normal(ns(0.05)), 200, 6000, 2) * np.exp(-np.arange(ns(0.05)) / ns(0.008))
	place(out, slap * 1.2 * size, 0)
	# cavity collapse: low "bloop"
	place(out, bubble(r, 8 + 12 * size * r.random(), 1.0 * size, rise=0.4, dur=0.12, damp=4.0), 0.03 + 0.04 * r.random())
	# bubble cloud decaying
	rate_env = np.exp(-t / (0.15 + 0.2 * size))
	out += bubble_field(r, dur, 900 * size, 0.6, 10.0, 2.4, 0.15, 0.5, rate_env)
	# spray: droplets falling back (0.15..0.6 s)
	for tt in dsp.poisson_times(0.6 * size, 160 * size, r, 0.12):
		if tt < dur:
			place(out, drop_plink(r, 1.8) * 0.12, float(tt))
	# turbulent wash
	wash = dsp.lp(r.standard_normal(n), 1800) * np.exp(-t / (0.12 * size + 0.05)) * 0.35
	return out + wash


# ------------------------------------------------------------------------------------------ air

def whoosh(r: np.random.Generator, dur: float, peak: float = 0.5, f_lo: float = 250, f_hi: float = 1600,
		q: float = 1.2, tone: float = 0.0) -> np.ndarray:
	"""Object swung through air: velocity profile v(t) (bell); band-pass centre ∝ v, level ∝ v^3."""
	n = ns(dur)
	t = tvec(n) / dur
	v = np.exp(-((t - peak) / 0.22) ** 2)
	fc = f_lo + (f_hi - f_lo) * v
	x = dsp.tv_bandpass(r.standard_normal(n), fc, q)
	x += dsp.tv_bandpass(r.standard_normal(n), fc * 2.2, q * 1.5) * 0.3
	if tone > 0:
		x += np.sin(dsp.phase_from_f(fc * 1.5)) * tone * 0.2
	return x * v ** 2.5


def gust_envelope(n: int, r: np.random.Generator, mean: float = 0.6, depth: float = 0.4, rate: float = 0.12) -> np.ndarray:
	"""Wind gust envelope: slow random with occasional stronger gusts."""
	e = mean + depth * dsp.smooth_noise(n, r, rate) * 0.6 + depth * 0.4 * dsp.smooth_noise(n, r, rate * 3.5)
	return np.clip(e, 0.05, 2.0)


def crackle_burst(r: np.random.Generator, strength: float = 1.0) -> np.ndarray:
	"""Fire crackle: resin/steam pocket rupture — a few micro-clicks within ~5-30 ms."""
	n = ns(0.04)
	out = np.zeros(n)
	k = 1 + r.poisson(2.0 * strength)
	for _ in range(k):
		c = dsp.click(r, 0.0006 + 0.002 * r.random(), 600 + 1500 * r.random(), 5000 + 9000 * r.random(), 1.5)
		place(out, c * (0.3 + r.random()), int(r.random() * n * 0.7))
	return out * strength

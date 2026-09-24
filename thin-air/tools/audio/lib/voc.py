"""Source-filter vocal synthesis for animals and non-verbal human sounds.

Two sources:
  * additive harmonic source (clean tonal calls: howls, whistles, bird song, bleats) with per-harmonic gains
    read from a time-varying spectral envelope (tilt + formants), jitter/shimmer, subharmonics (roughness)
  * glottal pulse train (growls, croaks, grunts: irregular, pressed phonation) through a time-varying
    formant filter bank
plus an aspiration/turbulence noise source shaped by the same envelope.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.interpolate import PchipInterpolator

from . import dsp
from .dsp import SR, ns


def curve(n: int, pts, kind: str = "pchip") -> np.ndarray:
	"""Smooth curve through (t_seconds, value) points; monotone-preserving (no overshoot)."""
	order = np.argsort([p[0] for p in pts], kind="stable")
	ts = np.array([pts[k][0] for k in order], float) * SR
	vs = np.array([pts[k][1] for k in order], float)
	for k in range(1, len(ts)):          # enforce strictly increasing breakpoints
		if ts[k] <= ts[k - 1]:
			ts[k] = ts[k - 1] + 1.0
	x = np.arange(n)
	if kind == "lin" or len(pts) < 3:
		return np.interp(x, ts, vs)
	return PchipInterpolator(ts, vs, extrapolate=False)(np.clip(x, ts[0], ts[-1]))


def micro(n: int, r: np.random.Generator, amount: float = 0.01, rate: float = 8.0) -> np.ndarray:
	"""Micro-prosody: 1/f-ish random pitch drift (multiplicative, around 1)."""
	a = dsp.smooth_noise(n, r, rate) * 0.6 + dsp.smooth_noise(n, r, rate * 4) * 0.3 + dsp.smooth_noise(n, r, rate * 0.25)
	return 1.0 + amount * a / 1.2


def vibrato(n: int, rate: float, depth: float, r: np.random.Generator, onset: float = 0.3) -> np.ndarray:
	t = dsp.tvec(n)
	rr = rate * (1 + 0.1 * dsp.smooth_noise(n, r, 1.0))
	ph = dsp.phase_from_f(rr, r.random() * 6.28)
	ramp = np.clip(t / max(onset, 1e-3), 0, 1)
	return 1.0 + depth * np.sin(ph) * ramp


def _env_at(f: np.ndarray, formants, tilt_db_oct: float, f_ref: float) -> np.ndarray:
	return dsp.formant_gain(f, formants, tilt_db_oct, f_ref)


def additive(f0: np.ndarray, amp: np.ndarray, formants, r: np.random.Generator, tilt: float = -12.0,
		f_ref: float = 300.0, kmax: int = 50, fmax: float = 14000.0, shimmer: float = 0.04,
		sub: float | np.ndarray = 0.0, h1: float = 1.0, noise: float | np.ndarray = 0.0, noise_tilt: float = -3.0,
		noise_formants=None, harm_jitter: float = 0.0) -> np.ndarray:
	"""Harmonic source with time-varying spectral envelope + shaped aspiration noise."""
	n = len(f0)
	ph = dsp.phase_from_f(f0)
	out = np.zeros(n)
	fcap = min(fmax, dsp.NYQ * 0.9)
	shim = (1.0 + shimmer * dsp.smooth_noise(n, r, 25.0)) if shimmer > 0 else 1.0
	for k in range(1, kmax + 1):
		fk = f0 * k
		if np.min(fk) >= fcap:
			break
		g = _env_at(fk, formants, tilt, f_ref)
		if k == 1:
			g = g * h1
		g = np.where(fk < fcap, g, 0.0) * np.clip((fcap - fk) / (0.1 * fcap), 0, 1)
		dph = harm_jitter * dsp.smooth_noise(n, r, 12.0) if harm_jitter > 0 else 0.0
		out += g * np.sin(k * ph + r.random() * 6.283 + dph)
	sub_arr = np.broadcast_to(np.asarray(sub, float), (n,))
	if np.max(sub_arr) > 0:
		for k in range(1, kmax // 2):
			fk = f0 * (k - 0.5)
			if np.min(fk) >= fcap:
				break
			g = _env_at(fk, formants, tilt, f_ref) * sub_arr
			out += g * np.sin((k - 0.5) * ph + r.random() * 6.283)
	out *= shim
	noise_arr = np.broadcast_to(np.asarray(noise, float), (n,))
	if np.max(noise_arr) > 0:
		nf = noise_formants if noise_formants is not None else formants
		out_n = shaped_noise(n, r, nf, noise_tilt, f_ref)
		# scale noise relative to the harmonic part's RMS
		hr = np.sqrt(np.mean(out ** 2)) + 1e-9
		nr = np.sqrt(np.mean(out_n ** 2)) + 1e-9
		out = out + out_n * (hr / nr) * noise_arr
	return out * amp


def shaped_noise(n: int, r: np.random.Generator, formants, tilt: float = -3.0, f_ref: float = 300.0,
		nfft: int = 1024, hop: int = 256) -> np.ndarray:
	"""White noise shaped by a time-varying formant envelope (formant params may be per-sample arrays)."""
	x = r.standard_normal(n)

	def gain(f, t):
		idx = np.clip((t * SR).astype(int), 0, n - 1)
		G = np.zeros((len(f), len(t)))
		# evaluate envelope for each frame using the formant values at that frame
		for j, i in enumerate(idx):
			fr = []
			for F, B, Gd in formants:
				Fv = float(np.asarray(F)[i]) if np.ndim(F) else float(F)
				Bv = float(np.asarray(B)[i]) if np.ndim(B) else float(B)
				Gv = float(np.asarray(Gd)[i]) if np.ndim(Gd) else float(Gd)
				fr.append((Fv, Bv, Gv))
			G[:, j] = dsp.formant_gain(np.maximum(f, 1.0), fr, tilt, f_ref)
		return G
	return dsp.stft_shape(x, gain, nfft, hop)


def pulse_source(f0: np.ndarray, r: np.random.Generator, jitter: float = 0.02, shimmer: float = 0.15,
		oq: float = 0.55, skew: float = 3.0, irregular: float = 0.0) -> np.ndarray:
	"""Glottal pulses; `irregular` adds random skipped/doubled pulses (creaky, growly phonation)."""
	n = len(f0)
	out = np.zeros(n)
	t = 0.0
	flip = False
	while True:
		i = int(t * SR)
		if i >= n:
			break
		f = max(float(f0[i]), 15.0)
		T = (1.0 / f) * (1.0 + jitter * r.standard_normal())
		if irregular > 0 and r.random() < irregular:
			T *= 1.6 + r.random() * 0.8          # skipped cycle (subharmonic)
		flip = not flip
		L = max(4, int(T * SR * oq))
		u = np.linspace(0, 1, L)
		rise = np.sin(math.pi * np.clip(u, 0, 1) ** (1.0 / skew)) ** 2
		d = np.gradient(rise)
		a = (1.0 + shimmer * r.standard_normal()) * (0.75 if (irregular > 0 and flip) else 1.0)
		dsp.place(out, d * a, i)
		t += max(T, 1.0 / 3000)
	return out


def filtered_voice(src: np.ndarray, formants_filter, tilt_lp: float | None = None) -> np.ndarray:
	"""Run a source through a time-varying formant filter bank: [(F, BW, gain_linear)]."""
	y = dsp.formant_filter(src, formants_filter)
	if tilt_lp:
		y = dsp.lp(y, tilt_lp, 1)
	return y


# ---------------------------------------------------------------------------------------- vowel tables

# Adult male-ish formants (Hz, bandwidth Hz). Used for grunts/breaths (scaled per speaker).
VOWELS = {
	"a": [(730, 90), (1090, 110), (2440, 160), (3400, 250), (4200, 300)],
	"ah": [(640, 80), (1190, 100), (2390, 150), (3400, 250), (4200, 300)],
	"uh": [(570, 80), (1250, 100), (2500, 150), (3400, 250), (4300, 300)],
	"o": [(450, 70), (850, 90), (2600, 150), (3400, 250), (4200, 300)],
	"u": [(300, 60), (870, 90), (2240, 150), (3300, 250), (4200, 300)],
	"e": [(530, 70), (1840, 110), (2480, 150), (3500, 250), (4300, 300)],
	"i": [(270, 60), (2290, 120), (3010, 180), (3600, 250), (4400, 300)],
	"schwa": [(500, 80), (1500, 100), (2500, 150), (3500, 250), (4300, 300)],
	"ng": [(250, 60), (1100, 200), (2300, 200), (3300, 300), (4300, 300)],
	"hiss": [(1800, 1200), (3500, 1500), (6000, 2500), (8500, 3000), (11000, 3000)],
}


def vowel_formants(v: str, scale: float = 1.0, gains_db=(0, -4, -10, -16, -20)):
	return [(F * scale, B * scale, g) for (F, B), g in zip(VOWELS[v], gains_db)]


def morph(n: int, seq, scale: float = 1.0, gains_db=(0, -4, -10, -16, -20)):
	"""Time-varying formants from a sequence [(t_seconds, vowel), ...] → [(F(n), B(n), G)]."""
	out = []
	for k in range(5):
		F = curve(n, [(t, VOWELS[v][k][0] * scale) for t, v in seq], "lin")
		B = curve(n, [(t, VOWELS[v][k][1] * scale) for t, v in seq], "lin")
		out.append((F, B, gains_db[k]))
	return out

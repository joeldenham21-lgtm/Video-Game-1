"""THIN AIR audio DSP toolkit (numpy/scipy). Deterministic building blocks for physically-informed SFX.

All signals are float64 numpy arrays at SR (mono: shape (n,), stereo: shape (n, 2)).
"""
from __future__ import annotations

import math
import zlib

import numpy as np
from scipy import signal

SR = 44100
NYQ = SR / 2.0


# ----------------------------------------------------------------------------------------------- basics

def rng_for(*keys) -> np.random.Generator:
	"""Stable RNG from arbitrary keys (strings/ints)."""
	s = "|".join(str(k) for k in keys).encode()
	return np.random.default_rng(zlib.crc32(s) ^ 0x5EED1234)


def secs(n: int) -> float:
	return n / SR


def ns(seconds: float) -> int:
	return max(1, int(round(seconds * SR)))


def tvec(n: int) -> np.ndarray:
	return np.arange(n) / SR


def zeros(seconds: float) -> np.ndarray:
	return np.zeros(ns(seconds))


def db(x: float) -> float:
	return 10.0 ** (x / 20.0)


def to_db(x: float) -> float:
	return 20.0 * math.log10(max(x, 1e-12))


def place(dst: np.ndarray, src: np.ndarray, at: float | int, gain: float = 1.0) -> None:
	"""Mix src into dst starting at `at` (seconds if float, samples if int)."""
	i = ns(at) if isinstance(at, float) else int(at)
	if i >= len(dst) or i + len(src) <= 0:
		return
	s0 = max(0, -i)
	i0 = max(0, i)
	n = min(len(dst) - i0, len(src) - s0)
	if n > 0:
		seg = src[s0:s0 + n]
		# never leave a truncated tail (click): fade the last 6 ms if the source ends above -50 dB of its peak
		k = min(n // 4, 265)
		if k > 8:
			pk = float(np.max(np.abs(seg))) + 1e-12
			if float(np.max(np.abs(seg[-k:]))) > pk * 0.003:
				seg = seg.copy()
				w = np.cos(np.linspace(0, math.pi / 2, k)) ** 2
				seg[-k:] = (seg[-k:].T * w).T
		dst[i0:i0 + n] += seg * gain


def mix(*xs) -> np.ndarray:
	"""Sum signals of different lengths (zero-padded to the longest)."""
	n = max(len(x) for x in xs)
	out = np.zeros((n,) + xs[0].shape[1:])
	for x in xs:
		out[:len(x)] += x
	return out


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
	if len(x) >= n:
		return x[:n]
	out = np.zeros((n,) + x.shape[1:])
	out[:len(x)] = x
	return out


# ----------------------------------------------------------------------------------------------- noise

def white(n: int, r: np.random.Generator) -> np.ndarray:
	return r.standard_normal(n)


def colored(n: int, r: np.random.Generator, slope_db_oct: float) -> np.ndarray:
	"""Noise with a spectral slope in dB/octave (−3 pink, −6 brown). Unit RMS."""
	m = 1 << int(math.ceil(math.log2(max(n, 16))))
	spec = np.fft.rfft(r.standard_normal(m))
	f = np.fft.rfftfreq(m, 1.0 / SR)
	f[0] = f[1]
	spec *= (f / 1000.0) ** (slope_db_oct / 6.0206)
	x = np.fft.irfft(spec, m)[:n]
	return x / (np.std(x) + 1e-12)


def pink(n: int, r: np.random.Generator) -> np.ndarray:
	return colored(n, r, -3.0)


def brown(n: int, r: np.random.Generator) -> np.ndarray:
	return colored(n, r, -6.0)


def smooth_noise(n: int, r: np.random.Generator, rate_hz: float) -> np.ndarray:
	"""Band-limited random curve (≈ changes at rate_hz), zero mean unit-ish std. Cubic-interpolated."""
	k = max(4, int(n / SR * rate_hz) + 4)
	pts = r.standard_normal(k)
	xs = np.linspace(0, n - 1, k)
	from scipy.interpolate import CubicSpline
	return CubicSpline(xs, pts)(np.arange(n))


def spectral_noise(n: int, r: np.random.Generator, freqs, gains_db) -> np.ndarray:
	"""Stationary noise with a spectrum interpolated (log-f) through (freqs, gains_db). Unit RMS."""
	m = 1 << int(math.ceil(math.log2(max(n, 16))))
	spec = np.fft.rfft(r.standard_normal(m))
	f = np.fft.rfftfreq(m, 1.0 / SR)
	g = np.interp(np.log(np.maximum(f, 1.0)), np.log(np.asarray(freqs, float)), np.asarray(gains_db, float))
	spec *= 10 ** (g / 20.0)
	x = np.fft.irfft(spec, m)[:n]
	return x / (np.std(x) + 1e-12)


# ----------------------------------------------------------------------------------------------- filters

def _sos(kind: str, f, order: int):
	if kind in ("bandpass", "bandstop"):
		lo, hi = f
		lo = max(5.0, lo)
		hi = min(NYQ * 0.98, hi)
		return signal.butter(order, [lo, hi], btype=kind, fs=SR, output="sos")
	return signal.butter(order, min(max(f, 5.0), NYQ * 0.98), btype=kind, fs=SR, output="sos")


def lp(x, f, order=2):
	return signal.sosfilt(_sos("lowpass", f, order), x, axis=0)


def hp(x, f, order=2):
	return signal.sosfilt(_sos("highpass", f, order), x, axis=0)


def bp(x, lo, hi, order=2):
	return signal.sosfilt(_sos("bandpass", (lo, hi), order), x, axis=0)


def lp0(x, f, order=2):
	"""Zero-phase low-pass (for envelopes/control signals)."""
	return signal.sosfiltfilt(_sos("lowpass", f, order), x, axis=0)


def peak_eq(x, f0, gain_db, q=1.0):
	A = 10 ** (gain_db / 40.0)
	w = 2 * math.pi * f0 / SR
	alpha = math.sin(w) / (2 * q)
	b = [1 + alpha * A, -2 * math.cos(w), 1 - alpha * A]
	a = [1 + alpha / A, -2 * math.cos(w), 1 - alpha / A]
	return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def shelf(x, f0, gain_db, high=True, s=0.8):
	A = 10 ** (gain_db / 40.0)
	w = 2 * math.pi * f0 / SR
	cw, sw = math.cos(w), math.sin(w)
	alpha = sw / 2 * math.sqrt((A + 1 / A) * (1 / s - 1) + 2)
	sa = 2 * math.sqrt(A) * alpha
	if high:
		b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
		a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
	else:
		b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
		a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
	return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


def resonator(x, f, t60, gain=1.0):
	"""Two-pole resonator (constant peak gain-ish) with decay time t60 (s)."""
	r = 10 ** (-3.0 / (t60 * SR)) if t60 > 0 else 0.0
	w = 2 * math.pi * min(f, NYQ * 0.97) / SR
	b0 = (1 - r * r) * 0.5
	return signal.lfilter([b0 * gain, 0, -b0 * gain], [1, -2 * r * math.cos(w), r * r], x, axis=0)


def resonator_bank(x, freqs, t60s, gains):
	out = np.zeros_like(x, dtype=float)
	for f, t, g in zip(freqs, t60s, gains):
		if f < NYQ * 0.95:
			out += resonator(x, f, t, g)
	return out


def tv_lowpass(x: np.ndarray, cutoff: np.ndarray, block: int = 256) -> np.ndarray:
	"""Time-varying 2nd-order low-pass (cutoff per sample, evaluated per block)."""
	out = np.zeros_like(x)
	zi = np.zeros((1, 2))
	for i in range(0, len(x), block):
		c = float(np.clip(np.mean(cutoff[i:i + block]), 20.0, NYQ * 0.95))
		sos = signal.butter(2, c, btype="lowpass", fs=SR, output="sos")
		y, zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
		out[i:i + block] = y
	return out


def tv_bandpass(x: np.ndarray, center: np.ndarray, q: float | np.ndarray, block: int = 256) -> np.ndarray:
	"""Time-varying resonant band-pass (RBJ constant 0 dB peak), per-block coefficients with state carry."""
	out = np.zeros_like(x)
	zi = np.zeros(2)
	qa = np.broadcast_to(np.asarray(q, float), x.shape) if np.ndim(q) else None
	for i in range(0, len(x), block):
		f = float(np.clip(np.mean(center[i:i + block]), 20.0, NYQ * 0.9))
		qq = float(np.mean(qa[i:i + block])) if qa is not None else float(q)
		w = 2 * math.pi * f / SR
		alpha = math.sin(w) / (2 * qq)
		b = np.array([alpha, 0.0, -alpha])
		a = np.array([1 + alpha, -2 * math.cos(w), 1 - alpha])
		y, zi = signal.lfilter(b / a[0], a / a[0], x[i:i + block], zi=zi)
		out[i:i + block] = y
	return out


def formant_filter(src: np.ndarray, formants, block: int = 128) -> np.ndarray:
	"""Parallel time-varying formant bank. formants: list of (freq_curve, bw_curve, gain_curve) arrays/scalars."""
	n = len(src)
	out = np.zeros(n)
	for fc, bw, g in formants:
		fc = np.broadcast_to(np.asarray(fc, float), (n,))
		bw = np.broadcast_to(np.asarray(bw, float), (n,))
		g = np.broadcast_to(np.asarray(g, float), (n,))
		zi = np.zeros(2)
		y = np.zeros(n)
		for i in range(0, n, block):
			f = float(np.clip(fc[i], 30.0, NYQ * 0.9))
			b_ = float(max(bw[i], 10.0))
			r = math.exp(-math.pi * b_ / SR)
			w = 2 * math.pi * f / SR
			a1, a2 = -2 * r * math.cos(w), r * r
			b0 = (1 - r) * math.sqrt(1 - 2 * r * math.cos(2 * w) + r * r)
			seg, zi = signal.lfilter([b0], [1, a1, a2], src[i:i + block], zi=zi)
			y[i:i + block] = seg
		out += y * g
	return out


# ----------------------------------------------------------------------------------------------- envelopes

def env_points(n: int, pts, curve: str = "lin") -> np.ndarray:
	"""Breakpoint envelope. pts = [(t_seconds, value), ...]. curve 'lin' or 'exp' (dB-space)."""
	ts = np.array([p[0] for p in pts]) * SR
	vs = np.array([p[1] for p in pts], float)
	x = np.arange(n)
	if curve == "exp":
		return 10 ** (np.interp(x, ts, 20 * np.log10(np.maximum(vs, 1e-6))) / 20.0) * (np.interp(x, ts, vs) > 0)
	return np.interp(x, ts, vs)


def env_ad(n: int, attack: float, decay_t60: float, hold: float = 0.0) -> np.ndarray:
	t = tvec(n)
	a = np.clip(t / max(attack, 1e-5), 0, 1)
	a = np.sin(a * math.pi / 2) ** 2
	d = np.where(t < attack + hold, 1.0, 10 ** (-3.0 * (t - attack - hold) / max(decay_t60, 1e-4)))
	return a * d


def hann_env(n: int) -> np.ndarray:
	return np.hanning(n) if n > 2 else np.ones(n)


def fade(x: np.ndarray, fin: float = 0.002, fout: float = 0.01) -> np.ndarray:
	x = x.copy()
	a, b = ns(fin), ns(fout)
	if a > 1 and a < len(x):
		w = np.sin(np.linspace(0, math.pi / 2, a)) ** 2
		x[:a] = (x[:a].T * w).T
	if b > 1 and b < len(x):
		w = np.cos(np.linspace(0, math.pi / 2, b)) ** 2
		x[-b:] = (x[-b:].T * w).T
	return x


# ----------------------------------------------------------------------------------------------- events

def poisson_times(duration: float, rate, r: np.random.Generator, t0: float = 0.0) -> np.ndarray:
	"""Event times of a (possibly inhomogeneous) Poisson process. rate: float or callable(t)->rate."""
	if callable(rate):
		# thinning
		grid = np.linspace(0, duration, 200)
		rmax = max(1e-6, float(np.max([rate(g) for g in grid])) * 1.2)
		times = []
		t = 0.0
		while True:
			t += r.exponential(1.0 / rmax)
			if t >= duration:
				break
			if r.random() < rate(t) / rmax:
				times.append(t)
		return np.array(times) + t0
	nexp = r.poisson(rate * duration)
	return np.sort(r.random(nexp) * duration) + t0


def click(r: np.random.Generator, dur: float = 0.004, lo: float = 1500, hi: float = 9000, sharp: float = 1.0) -> np.ndarray:
	"""A tiny broadband fracture click (filtered noise burst with fast exponential decay)."""
	n = ns(dur)
	x = r.standard_normal(n) * np.exp(-np.arange(n) / (n / (4.0 * sharp)))
	return bp(x, lo, hi, 2)


def modal(n: int, freqs, t60s, amps, phases=None, r: np.random.Generator | None = None) -> np.ndarray:
	"""Sum of exponentially-decaying sinusoids (struck object modes)."""
	t = tvec(n)
	out = np.zeros(n)
	for i, (f, d, a) in enumerate(zip(freqs, t60s, amps)):
		if f >= NYQ * 0.95:
			continue
		# struck object: displacement starts at zero (sine phase 0); tiny random sign for variety
		ph = phases[i] if phases is not None else (math.pi if (r is not None and r.random() < 0.5) else 0.0)
		out += a * np.sin(2 * math.pi * f * t + ph) * np.exp(-6.9078 * t / max(d, 1e-4))
	k = min(n, 13)
	out[:k] *= np.linspace(0, 1, k)
	return out


def modal_excite(exc: np.ndarray, freqs, t60s, gains) -> np.ndarray:
	return resonator_bank(exc, freqs, t60s, gains)


# ----------------------------------------------------------------------------------------------- oscillators

def phase_from_f(f: np.ndarray, phase0: float = 0.0) -> np.ndarray:
	return phase0 + 2 * math.pi * np.cumsum(f) / SR


def harmonic_tone(f0: np.ndarray, amp: np.ndarray, env_fn, kmax: int = 60, fmax: float = 16000.0,
		r: np.random.Generator | None = None, shimmer: float = 0.0) -> np.ndarray:
	"""Additive harmonic source. env_fn(freq_array (n,), k) -> linear gain array for harmonic k."""
	n = len(f0)
	ph = phase_from_f(f0)
	out = np.zeros(n)
	for k in range(1, kmax + 1):
		fk = f0 * k
		if np.min(fk) >= min(fmax, NYQ * 0.92):
			break
		g = env_fn(fk, k)
		g = np.where(fk < min(fmax, NYQ * 0.92), g, 0.0)
		if shimmer > 0 and r is not None:
			g = g * (1.0 + shimmer * smooth_noise(n, r, 30.0))
		p0 = r.random() * 2 * math.pi if r is not None else 0.0
		out += g * np.sin(k * ph + p0)
	return out * amp


def formant_gain(f: np.ndarray, formants, tilt_db_oct: float = -12.0, f_ref: float = 200.0) -> np.ndarray:
	"""Spectral envelope: glottal tilt + sum of resonance peaks. formants: [(F, BW, gain_db) or arrays]."""
	g = np.zeros_like(f, dtype=float)
	for F, B, G in formants:
		F = np.asarray(F, float)
		B = np.asarray(B, float)
		# 2-pole resonance magnitude normalized to 1 at F
		h = 1.0 / np.sqrt((1 - (f / F) ** 2) ** 2 + (f * B / (F * F)) ** 2) * (B / F)
		g = g + h * db(G) if np.ndim(G) == 0 else g + h * 10 ** (np.asarray(G) / 20)
	tilt = (np.maximum(f, 1.0) / f_ref) ** (tilt_db_oct / 6.0206)
	return g * np.minimum(tilt, 4.0)


def lf_pulse_train(f0: np.ndarray, r: np.random.Generator, jitter: float = 0.01, oq: float = 0.6,
		skew: float = 3.0) -> np.ndarray:
	"""Glottal flow-derivative pulse train (Rosenberg-like), jittered, for voiced sources (growls, croaks)."""
	n = len(f0)
	out = np.zeros(n)
	t = 0.0
	while True:
		i = int(t * SR)
		if i >= n:
			break
		f = max(float(f0[i]), 20.0)
		T = (1.0 / f) * (1.0 + jitter * r.standard_normal())
		T = max(T, 1.0 / 2000.0)
		L = int(T * SR * oq)
		if L >= 4:
			u = np.linspace(0, 1, L)
			# asymmetric pulse derivative: rise then sharp closure
			rise = np.sin(math.pi * u ** (1.0 / skew)) ** 2
			d = np.gradient(rise)
			place(out, d * (0.8 + 0.4 * r.random()), i)
		t += T
	return out


# ----------------------------------------------------------------------------------------------- time-varying spectrum

def stft_shape(x: np.ndarray, gain_fn, nfft: int = 1024, hop: int = 256) -> np.ndarray:
	"""Shape x by a time-varying magnitude gain_fn(freqs (F,), times (T,)) -> (F, T)."""
	f, t, Z = signal.stft(x, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary="even")
	G = gain_fn(f, t)
	_, y = signal.istft(Z * G, fs=SR, nperseg=nfft, noverlap=nfft - hop, boundary=True)
	return pad_to(y, len(x))


# ----------------------------------------------------------------------------------------------- dynamics & fx

def softclip(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
	return np.tanh(x * drive) / np.tanh(drive) if drive > 0 else x


def envelope_follow(x: np.ndarray, attack: float, release: float) -> np.ndarray:
	"""Peak envelope follower (vectorised approximation via scipy for release, max for attack)."""
	a = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)
	# one-pole smoothing with different attack/release: loop in blocks for speed
	ga = math.exp(-1.0 / (attack * SR))
	gr = math.exp(-1.0 / (release * SR))
	out = np.empty_like(a)
	e = 0.0
	for i in range(len(a)):
		v = a[i]
		e = ga * e + (1 - ga) * v if v > e else gr * e + (1 - gr) * v
		out[i] = e
	return out


def rms_envelope(x: np.ndarray, win: float = 0.02) -> np.ndarray:
	m = x if x.ndim == 1 else np.mean(x, axis=1)
	w = ns(win)
	k = np.ones(w) / w
	return np.sqrt(np.convolve(m * m, k, mode="same") + 1e-12)


def compress(x: np.ndarray, thresh_db: float, ratio: float, attack: float = 0.005, release: float = 0.08,
		makeup_db: float = 0.0) -> np.ndarray:
	env = rms_envelope(x, attack * 4)
	env = lp0(env, 1.0 / (release * 2 * math.pi) * 3, 1)
	lev = 20 * np.log10(np.maximum(env, 1e-9))
	over = np.maximum(lev - thresh_db, 0)
	gain_db = -over * (1 - 1.0 / ratio) + makeup_db
	g = 10 ** (gain_db / 20)
	return (x.T * g).T


def varispeed(x: np.ndarray, rate: np.ndarray) -> np.ndarray:
	"""Read x at a variable playback rate (array per output sample). Linear interpolation."""
	pos = np.cumsum(rate)
	pos = pos - pos[0]
	pos = pos[pos < len(x) - 1]
	i = pos.astype(int)
	fr = pos - i
	if x.ndim == 1:
		return x[i] * (1 - fr) + x[i + 1] * fr
	return (x[i].T * (1 - fr) + x[i + 1].T * fr).T


def resample(x: np.ndarray, factor: float) -> np.ndarray:
	"""Pitch/time scale by factor (>1 = higher & shorter)."""
	n = int(len(x) / factor)
	return signal.resample(x, n, axis=0) if n > 0 else x[:1]


def delay(x: np.ndarray, seconds: float, gain: float = 1.0) -> np.ndarray:
	d = ns(seconds)
	out = np.zeros((len(x) + d,) + x.shape[1:])
	out[d:] = x * gain
	return out


def fir_conv(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
	return signal.fftconvolve(x, ir, mode="full")


def make_ir(t60: float, r: np.random.Generator, predelay: float = 0.01, lp_start: float = 9000,
		lp_end: float = 2500, early=(), stereo: bool = False, density_ms: float = 0.0, hp_hz: float = 80) -> np.ndarray:
	"""Synthetic reverb IR: exponentially decaying noise, darkening over time, optional early reflections."""
	n = ns(predelay + t60 * 1.1)
	chans = 2 if stereo else 1
	out = np.zeros((n, chans))
	for c in range(chans):
		t = tvec(n)
		tail = r.standard_normal(n) * np.exp(-6.9078 * np.maximum(t - predelay, 0) / t60)
		tail[t < predelay] = 0
		# darkening: crossfade between two low-passed versions
		a = lp(tail, lp_start, 2)
		b = lp(tail, lp_end, 2)
		mix = np.clip((t - predelay) / max(t60 * 0.5, 1e-3), 0, 1)
		tail = a * (1 - mix) + b * mix
		tail = hp(tail, hp_hz, 2)
		for (dt, g) in early:
			k = ns(dt + (0.0007 * r.standard_normal() if c else 0.0))
			if k < n:
				tail[k] += g * (1 if r.random() > 0.3 else -1) * 3.0
		out[:, c] = tail
	out /= np.sqrt(np.sum(out ** 2) / chans) + 1e-12
	return out[:, 0] if not stereo else out


def reverb(x: np.ndarray, ir: np.ndarray, wet: float, dry: float = 1.0) -> np.ndarray:
	if x.ndim == 1 and ir.ndim == 1:
		w = fir_conv(x, ir)
		out = pad_to(x * dry, len(w))
		return out + w * wet
	if x.ndim == 1:
		x = np.stack([x, x], axis=1)
	if ir.ndim == 1:
		ir = np.stack([ir, ir], axis=1)
	w = np.stack([fir_conv(x[:, c], ir[:, c]) for c in range(2)], axis=1)
	out = pad_to(x * dry, len(w))
	return out + w * wet


def air_absorb(x: np.ndarray, distance_m: float) -> np.ndarray:
	"""Approximate air absorption + ground effect for a source at distance (m)."""
	if distance_m <= 5:
		return x
	fc = max(1200.0, 20000.0 / (1.0 + distance_m / 60.0))
	y = lp(x, fc, 2)
	return y


def pan_stereo(x: np.ndarray, pan: float) -> np.ndarray:
	"""Equal-power pan, pan in [-1, 1]."""
	a = (pan + 1) * math.pi / 4
	return np.stack([x * math.cos(a), x * math.sin(a)], axis=1)


def widen(x_l: np.ndarray, x_r: np.ndarray, width: float = 1.0) -> np.ndarray:
	m = (x_l + x_r) * 0.5
	s = (x_l - x_r) * 0.5 * width
	return np.stack([m + s, m - s], axis=1)


def to_stereo(x: np.ndarray) -> np.ndarray:
	return x if x.ndim == 2 else np.stack([x, x], axis=1)


# ----------------------------------------------------------------------------------------------- loops

def make_loop(x: np.ndarray, xfade: float) -> np.ndarray:
	"""Make x seamlessly loopable: the tail (length xfade) is equal-power crossfaded into the head.
	Returns len(x) - xfade samples. The sample after the last output sample is exactly x[L] (continuity)."""
	k = ns(xfade)
	L = len(x) - k
	out = x[:L].copy()
	w = np.linspace(0, 1, k)
	fi = np.sin(w * math.pi / 2)
	fo = np.cos(w * math.pi / 2)
	head = x[:k]
	tail = x[L:L + k]
	if x.ndim == 1:
		out[:k] = head * fi + tail * fo
	else:
		out[:k] = (head.T * fi + tail.T * fo).T
	return out


def loop_seam_error(x: np.ndarray) -> float:
	"""Discontinuity at the loop point relative to typical sample-to-sample change (≈1 = seamless)."""
	m = x if x.ndim == 1 else np.mean(x, axis=1)
	d = np.abs(np.diff(m))
	typical = np.percentile(d, 90) + 1e-12
	return float(abs(m[0] - m[-1]) / typical)


# ----------------------------------------------------------------------------------------------- utility

def normalize_peak(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
	p = np.max(np.abs(x)) + 1e-12
	return x * (db(peak_db) / p)


def trim(x: np.ndarray, thresh_db: float = -60.0, pre: float = 0.002, post: float = 0.02) -> np.ndarray:
	a = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)
	p = np.max(a) + 1e-12
	idx = np.where(a > p * db(thresh_db))[0]
	if len(idx) == 0:
		return x
	s = max(0, idx[0] - ns(pre))
	e = min(len(x), idx[-1] + ns(post))
	return x[s:e]


def dc_block(x: np.ndarray) -> np.ndarray:
	return hp(x, 15.0, 1)


def crossfade_concat(a: np.ndarray, b: np.ndarray, xf: float) -> np.ndarray:
	k = ns(xf)
	k = min(k, len(a), len(b))
	w = np.linspace(0, 1, k)
	mid = a[-k:] * np.cos(w * math.pi / 2) + b[:k] * np.sin(w * math.pi / 2)
	return np.concatenate([a[:-k], mid, b[k:]])


# ----------------------------------------------------------------------------------------------- circular (loop-exact)

def per_noise(L: int, r: np.random.Generator, freqs=None, gains_db=None, slope_db_oct: float = 0.0) -> np.ndarray:
	"""Noise that is exactly periodic with period L samples (built in the frequency domain). Unit RMS."""
	spec = np.fft.rfft(r.standard_normal(L))
	f = np.fft.rfftfreq(L, 1.0 / SR)
	f[0] = f[1] if len(f) > 1 else 1.0
	if freqs is not None:
		g = np.interp(np.log(np.maximum(f, 1.0)), np.log(np.asarray(freqs, float)), np.asarray(gains_db, float))
		spec *= 10 ** (g / 20.0)
	if slope_db_oct:
		spec *= (f / 1000.0) ** (slope_db_oct / 6.0206)
	spec[0] = 0
	x = np.fft.irfft(spec, L)
	return x / (np.std(x) + 1e-12)


def per_smooth(L: int, r: np.random.Generator, rate_hz: float) -> np.ndarray:
	"""Periodic smooth random curve (period L), ~unit std, bandwidth ≈ rate_hz."""
	spec = np.fft.rfft(r.standard_normal(L))
	f = np.fft.rfftfreq(L, 1.0 / SR)
	spec *= np.exp(-(f / max(rate_hz, 1e-3)) ** 2)
	spec[0] = 0
	x = np.fft.irfft(spec, L)
	return x / (np.std(x) + 1e-12)


def per_freq(f: float, L: int) -> float:
	"""Nearest frequency that completes an integer number of cycles in L samples."""
	k = max(1, round(f * L / SR))
	return k * SR / L


def circ(x: np.ndarray, fn) -> np.ndarray:
	"""Apply a (causal, IIR) processing fn to a periodic signal in steady state: fn(tile x3)[L:2L]."""
	L = len(x)
	y = fn(np.concatenate([x, x, x], axis=0))
	return y[L:2 * L]


def fold(x: np.ndarray, L: int) -> np.ndarray:
	"""Wrap everything past L back onto the start (circular accumulation of events)."""
	out = x[:L].copy()
	k = L
	while k < len(x):
		m = min(L, len(x) - k)
		out[:m] += x[k:k + m]
		k += L
	return out
